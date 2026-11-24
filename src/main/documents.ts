import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import mammoth from 'mammoth'
import type { DocumentChunkRecord } from '../shared/types'
import { buildStructuredRecursiveChunks, groupChunksForLlmWindow } from './chunker'
import type { WikiModelClient } from './model'
import { parsePptxBuffer, parseXlsxBuffer } from './ooxml'
import { classifyFileStorageDomain } from './schema'

export type DocumentSegment = {
  locator: string
  text: string
  blockKind?: 'text' | 'table' | 'visual'
}

export type LocalDocument = {
  path: string
  hash: string
  size: number
  mtime: number
  mediaKind: 'document' | 'image'
  segments: DocumentSegment[]
  chunks: DocumentChunkRecord[]
  text: string
}

export type ScannedFile = Pick<LocalDocument, 'path' | 'hash' | 'size' | 'mtime' | 'mediaKind'>

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export const SUPPORTED_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.csv',
  '.json',
  '.yaml',
  '.yml',
  '.html',
  '.htm',
  ...IMAGE_EXTENSIONS
])
export const EXCLUDED_DIRS = new Set(['.localwiki', 'wiki', 'node_modules', '.git', '.svn', '.hg', 'dist', 'out'])
export const MAX_FILE_SIZE = 20 * 1024 * 1024
export const MAX_DEPTH = 16

export function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase())
}

export function isSupportedFile(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filename).toLowerCase())
}

export type WorkspaceFileStat = {
  path: string
  size: number
  mtime: number
  mediaKind: 'document' | 'image'
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function mergeLocators(first: string, second: string): string {
  if (first === second) return first
  const pageMatchA = /^第\s*(\d+)\s*页$/.exec(first)
  const pageMatchB = /^第\s*(\d+)\s*页$/.exec(second)
  if (pageMatchA && pageMatchB) {
    return `第 ${pageMatchA[1]}–${pageMatchB[1]} 页`
  }
  const lineMatchA = /^第\s*(\d+)[–-](\d+)\s*行$/.exec(first)
  const lineMatchB = /^第\s*(\d+)[–-](\d+)\s*行$/.exec(second)
  if (lineMatchA && lineMatchB) {
    return `第 ${lineMatchA[1]}–${lineMatchB[2]} 行`
  }
  return `${first} / ${second}`
}

export async function listWorkspaceFiles(root: string): Promise<{ files: WorkspaceFileStat[]; warnings: string[] }> {
  const files: WorkspaceFileStat[] = []
  const warnings: string[] = []

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await walk(path.join(directory, entry.name), depth + 1)
        }
        continue
      }
      if (!entry.isFile() || !isSupportedFile(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      const stat = await fs.stat(absolute)
      if (stat.size > MAX_FILE_SIZE) {
        warnings.push(`${path.relative(root, absolute)} 超过 20 MB，已跳过`)
        continue
      }
      files.push({
        path: path.relative(root, absolute).replaceAll('\\', '/'),
        size: stat.size,
        mtime: stat.mtimeMs,
        mediaKind: isImageFile(entry.name) ? 'image' : 'document'
      })
    }
  }

  await walk(root, 0)
  files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
  return { files, warnings }
}

export async function scanWorkspace(root: string): Promise<{ files: ScannedFile[]; warnings: string[] }> {
  const { files: stats, warnings } = await listWorkspaceFiles(root)
  const files: ScannedFile[] = []
  for (const item of stats) {
    const absolute = path.join(root, ...item.path.split('/'))
    const buffer = await fs.readFile(absolute)
    files.push({
      ...item,
      hash: createHash('sha256').update(buffer).digest('hex')
    })
  }
  return { files, warnings }
}

function mimeForImage(ext: string): string {
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

export async function readDocument(
  root: string,
  file: ScannedFile,
  visionClient?: WikiModelClient,
  signal?: AbortSignal
): Promise<LocalDocument> {
  const absolute = path.join(root, ...file.path.split('/'))
  const extension = path.extname(file.path).toLowerCase()
  let segments: DocumentSegment[]

  if (IMAGE_EXTENSIONS.has(extension)) {
    const buffer = await fs.readFile(absolute)
    const sizeKb = (buffer.length / 1024).toFixed(1)
    let observation: string | null = null
    if (visionClient) {
      observation = await visionClient.analyzeImage(
        buffer.toString('base64'),
        mimeForImage(extension),
        '请客观描述这张图片中的关键主体、文字、图表数据、异常特征或操作场景，仅陈述图像中可见信息，不要编造，用简洁中文分条列出。',
        signal
      )
    }
    const visualText = observation
      ? `视觉资产：${file.path}（${extension.slice(1).toUpperCase()}，${sizeKb} KB）\n视觉解析记录：\n${observation}`
      : `视觉资产：${file.path}（${extension.slice(1).toUpperCase()}，${sizeKb} KB）。原始图像已安全归档至“具体+图+元数据”存储域，等待视觉模型（VM）补充观察描述。`
    segments = [{ locator: '图像资产', text: visualText, blockKind: 'visual' }]
  } else if (extension === '.pdf') {
    segments = await readPdf(absolute)
  } else if (extension === '.docx') {
    segments = textSegments(await readDocxText(absolute))
  } else if (extension === '.xlsx') {
    segments = parseXlsxBuffer(await fs.readFile(absolute))
  } else if (extension === '.pptx') {
    segments = parsePptxBuffer(await fs.readFile(absolute))
  } else if (extension === '.html' || extension === '.htm') {
    segments = textSegments(htmlToStructuredText(await fs.readFile(absolute, 'utf8')))
  } else {
    segments = textSegments(await fs.readFile(absolute, 'utf8'))
  }

  const text = segments.map(segment => segment.text).join('\n')
  if (!normalizeText(text)) throw new Error(`${file.path} 没有可读取的文字`)

  const storageDomain = classifyFileStorageDomain(file.path, IMAGE_EXTENSIONS.has(extension))
  const chunks = buildStructuredRecursiveChunks(file.path, segments, { storageDomain })

  return {
    ...file,
    mediaKind: IMAGE_EXTENSIONS.has(extension) ? 'image' : 'document',
    segments,
    chunks,
    text
  }
}

async function readDocxText(filename: string): Promise<string> {
  try {
    const htmlResult = await mammoth.convertToHtml({ path: filename })
    const structured = htmlToStructuredText(htmlResult.value)
    if (normalizeText(structured)) return structured
  } catch {
    // Fall back to raw text extraction below.
  }
  const rawResult = await mammoth.extractRawText({ path: filename })
  return rawResult.value
}

function htmlToStructuredText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, inner) => `\n${'#'.repeat(Number(level))} ${stripHtmlTags(inner).trim()}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner) => `\n- ${stripHtmlTags(inner).trim()}`)
    .replace(/<\/(t[dh])>/gi, ' | ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|pre|table|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]+>/g, '')
}

async function readPdf(filename: string): Promise<DocumentSegment[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fs.readFile(filename))
  const loadingTask = getDocument({ data, disableFontFace: true })
  const document = await loadingTask.promise
  const segments: DocumentSegment[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      let pageText = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        const piece = item.str
        if (!piece) {
          if ('hasEOL' in item && item.hasEOL) pageText += '\n'
          continue
        }
        if (pageText && !/\s$/.test(pageText) && !/^\s/.test(piece)) {
          const prevChar = pageText[pageText.length - 1]
          const nextChar = piece[0]
          const isCjkBoundary =
            /[\p{Script=Han}\p{P}]/u.test(prevChar) && /[\p{Script=Han}\p{P}]/u.test(nextChar)
          if (!isCjkBoundary) pageText += ' '
        }
        pageText += piece
        if ('hasEOL' in item && item.hasEOL) pageText += '\n'
      }
      if (normalizeText(pageText)) segments.push({ locator: `第 ${pageNumber} 页`, text: pageText })
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }
  return segments
}

function textSegments(text: string): DocumentSegment[] {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const segments: DocumentSegment[] = []
  const blockSize = 80
  for (let start = 0; start < lines.length; start += blockSize) {
    const end = Math.min(start + blockSize, lines.length)
    const block = lines.slice(start, end).join('\n')
    if (normalizeText(block)) {
      segments.push({ locator: `第 ${start + 1}–${end} 行`, text: block })
    }
  }
  return segments
}

export function chunkDocument(document: LocalDocument, maxChars = 11000): string[] {
  if (document.chunks.length) {
    return groupChunksForLlmWindow(document.chunks, maxChars)
  }
  const chunks: string[] = []
  let current = ''
  const append = (value: string) => {
    if (current && current.length + value.length > maxChars) {
      chunks.push(current)
      current = ''
    }
    current += value
  }

  for (const segment of document.segments) {
    const label = `\n[位置：${segment.locator}]\n`
    if (segment.text.length + label.length <= maxChars) {
      append(label + segment.text)
      continue
    }
    for (let offset = 0; offset < segment.text.length; offset += maxChars - label.length) {
      append(label + segment.text.slice(offset, offset + maxChars - label.length))
    }
  }
  if (current) chunks.push(current)
  return chunks
}

export function locateExcerpt(document: LocalDocument, excerpt: string): string | null {
  const needle = normalizeText(excerpt)
  if (needle.length < 6) return null

  const normalizedSegments = document.segments.map(segment => ({
    locator: segment.locator,
    norm: normalizeText(segment.text),
    compact: normalizeForMatch(segment.text)
  }))

  for (const segment of normalizedSegments) {
    if (segment.norm.includes(needle)) return segment.locator
  }

  for (let i = 0; i < normalizedSegments.length - 1; i += 1) {
    const combined = `${normalizedSegments[i].norm} ${normalizedSegments[i + 1].norm}`
    if (combined.includes(needle)) {
      return mergeLocators(normalizedSegments[i].locator, normalizedSegments[i + 1].locator)
    }
  }

  const compactNeedle = normalizeForMatch(excerpt)
  if (compactNeedle.length < 6) return null

  for (const segment of normalizedSegments) {
    if (segment.compact.includes(compactNeedle)) return segment.locator
  }

  for (let i = 0; i < normalizedSegments.length - 1; i += 1) {
    const combinedCompact = `${normalizedSegments[i].compact}${normalizedSegments[i + 1].compact}`
    if (combinedCompact.includes(compactNeedle)) {
      return mergeLocators(normalizedSegments[i].locator, normalizedSegments[i + 1].locator)
    }
  }

  return null
}
