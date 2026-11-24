/**
 * Zhixu Zero-Dependency OOXML Parser (.xlsx & .pptx).
 *
 * Uses Node.js native `node:zlib` + pure-TypeScript ZIP Central Directory reader:
 * - `.xlsx`: extracts shared strings, resolves worksheet names via workbook relationships,
 *   expands sparse cell references (`A1`, `D1`), and emits clean Markdown tables per sheet.
 * - `.pptx`: extracts slides in numeric order (`slide1.xml`..`slideN.xml`) including text runs,
 *   tables, and matching speaker notes (`notesSlideN.xml`).
 */

import { inflateRawSync } from 'node:zlib'

export type OoxmlSegment = {
  locator: string
  text: string
  blockKind?: 'text' | 'table'
}

const MAX_ENTRY_BYTES = 25 * 1024 * 1024

/**
 * Minimal, zip-bomb-safe ZIP archive reader for OOXML packages.
 */
export function extractZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  // Locate End of Central Directory (EOCD) signature 0x06054b50 from the tail
  const minPos = Math.max(0, buffer.length - 65557)
  let eocdOffset = -1
  for (let pos = buffer.length - 22; pos >= minPos; pos -= 1) {
    if (buffer.readUInt32LE(pos) === 0x06054b50) {
      eocdOffset = pos
      break
    }
  }
  if (eocdOffset < 0) {
    throw new Error('无效的压缩文档格式（未找到 ZIP 中央目录）')
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16)
  let ptr = cdOffset

  for (let i = 0; i < totalEntries && ptr + 46 <= buffer.length; i += 1) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) break
    const method = buffer.readUInt16LE(ptr + 10)
    const compressedSize = buffer.readUInt32LE(ptr + 20)
    const uncompressedSize = buffer.readUInt32LE(ptr + 24)
    const nameLen = buffer.readUInt16LE(ptr + 28)
    const extraLen = buffer.readUInt16LE(ptr + 30)
    const commentLen = buffer.readUInt16LE(ptr + 32)
    const localHeaderOffset = buffer.readUInt32LE(ptr + 42)
    const name = buffer.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8').replaceAll('\\', '/')
    ptr += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/') || uncompressedSize > MAX_ENTRY_BYTES) continue
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue

    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) continue

    const slice = buffer.subarray(dataStart, dataEnd)
    if (method === 0) {
      entries.set(name, Buffer.from(slice))
    } else if (method === 8) {
      try {
        entries.set(name, inflateRawSync(slice, { maxOutputLength: MAX_ENTRY_BYTES }))
      } catch {
        // Skip malformed or oversized entry cleanly
      }
    }
  }
  return entries
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function colRefToIndex(ref: string): number {
  const letters = /^([A-Z]+)/i.exec(ref)?.[1]?.toUpperCase() ?? ''
  let col = 0
  for (let i = 0; i < letters.length; i += 1) {
    col = col * 26 + (letters.charCodeAt(i) - 64)
  }
  return Math.max(0, col - 1)
}

function escapeMdCell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1]
    const parts: string[] = []
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
    let tm: RegExpExecArray | null
    while ((tm = tRe.exec(inner)) !== null) {
      parts.push(decodeXmlEntities(tm[1]))
    }
    out.push(parts.join(''))
  }
  return out
}

function resolveWorkbookSheets(entries: Map<string, Buffer>): { name: string; target: string }[] {
  const wbXml = entries.get('xl/workbook.xml')?.toString('utf8') ?? ''
  const relsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''

  const relMap = new Map<string, string>()
  const relRe = /<Relationship\b[^>]*>/g
  let rm: RegExpExecArray | null
  while ((rm = relRe.exec(relsXml)) !== null) {
    const tag = rm[0]
    const id = /\bId="([^"]+)"/.exec(tag)?.[1]
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1]
    if (id && target) {
      const normalized = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`
      relMap.set(id, normalized)
    }
  }

  const sheets: { name: string; target: string }[] = []
  const sheetRe = /<sheet\b[^>]*>/g
  let sm: RegExpExecArray | null
  while ((sm = sheetRe.exec(wbXml)) !== null) {
    const tag = sm[0]
    const name = decodeXmlEntities(/\bname="([^"]+)"/.exec(tag)?.[1] ?? `Sheet${sheets.length + 1}`)
    const rid = /\br:id="([^"]+)"/.exec(tag)?.[1]
    const target = (rid ? relMap.get(rid) : undefined) ?? `xl/worksheets/sheet${sheets.length + 1}.xml`
    if (entries.has(target)) sheets.push({ name, target })
  }

  if (!sheets.length) {
    const fallback = [...entries.keys()]
      .filter(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
      .sort((a, b) => Number(/\d+/.exec(a)?.[0] ?? 0) - Number(/\d+/.exec(b)?.[0] ?? 0))
    for (const key of fallback) {
      sheets.push({ name: key.split('/').pop()!.replace(/\.xml$/i, ''), target: key })
    }
  }
  return sheets
}

/**
 * Parse an `.xlsx` workbook buffer into structured Markdown table segments per worksheet.
 */
export function parseXlsxBuffer(buffer: Buffer): OoxmlSegment[] {
  const entries = extractZipEntries(buffer)
  const sharedStrings = entries.has('xl/sharedStrings.xml')
    ? parseSharedStrings(entries.get('xl/sharedStrings.xml')!.toString('utf8'))
    : []
  const sheets = resolveWorkbookSheets(entries)
  const segments: OoxmlSegment[] = []

  for (const sheet of sheets) {
    const xml = entries.get(sheet.target)?.toString('utf8') ?? ''
    const rows: string[][] = []
    let maxCols = 0

    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
    let rowMatch: RegExpExecArray | null
    while ((rowMatch = rowRe.exec(xml)) !== null) {
      const rowCells = new Map<number, string>()
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g
      let cellMatch: RegExpExecArray | null
      let fallbackCol = 0

      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        const attrs = cellMatch[1]
        const body = cellMatch[2]
        const ref = /\br="([^"]+)"/.exec(attrs)?.[1]
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? ''
        const colIdx = ref ? colRefToIndex(ref) : fallbackCol
        fallbackCol = colIdx + 1

        let val = ''
        if (type === 's') {
          const idx = Number(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '-1')
          val = idx >= 0 && idx < sharedStrings.length ? sharedStrings[idx] : ''
        } else if (type === 'inlineStr') {
          const parts: string[] = []
          const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
          let tm: RegExpExecArray | null
          while ((tm = tRe.exec(body)) !== null) parts.push(decodeXmlEntities(tm[1]))
          val = parts.join('')
        } else if (type === 'b') {
          val = /<v\b[^>]*>1<\/v>/.test(body) ? 'TRUE' : 'FALSE'
        } else {
          const rawV = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
          val = decodeXmlEntities(rawV)
        }

        const clean = escapeMdCell(val)
        if (clean) {
          rowCells.set(colIdx, clean)
          if (colIdx + 1 > maxCols) maxCols = colIdx + 1
        }
      }

      if (rowCells.size > 0) {
        const dense: string[] = []
        for (let c = 0; c < maxCols; c += 1) {
          dense.push(rowCells.get(c) ?? '')
        }
        rows.push(dense)
      }
    }

    if (!rows.length || maxCols === 0) continue
    // Normalize every row to maxCols and render clean Markdown table
    const normalizedRows = rows.map(r => {
      const padded = [...r]
      while (padded.length < maxCols) padded.push('')
      return padded
    })
    const header = normalizedRows[0]
    const sep = header.map(() => '---')
    const mdLines = [
      `## ${sheet.name}`,
      `| ${header.join(' | ')} |`,
      `| ${sep.join(' | ')} |`,
      ...normalizedRows.slice(1).map(r => `| ${r.join(' | ')} |`)
    ]
    segments.push({
      locator: `工作表：${sheet.name}`,
      text: mdLines.join('\n'),
      blockKind: 'table'
    })
  }

  return segments
}

function extractDrawingParagraphs(xml: string): string[] {
  const paragraphs: string[] = []
  const pRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g
  let pm: RegExpExecArray | null
  while ((pm = pRe.exec(xml)) !== null) {
    const runs: string[] = []
    const tRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g
    let tm: RegExpExecArray | null
    while ((tm = tRe.exec(pm[1])) !== null) {
      runs.push(decodeXmlEntities(tm[1]))
    }
    const line = runs.join('').replace(/\s+/g, ' ').trim()
    if (line) paragraphs.push(line)
  }
  return paragraphs
}

/**
 * Parse a `.pptx` deck buffer into ordered slide segments (with speaker notes when present).
 */
export function parsePptxBuffer(buffer: Buffer): OoxmlSegment[] {
  const entries = extractZipEntries(buffer)
  const slideKeys = [...entries.keys()]
    .filter(k => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => Number(/\d+/.exec(a)?.[0] ?? 0) - Number(/\d+/.exec(b)?.[0] ?? 0))

  const segments: OoxmlSegment[] = []
  for (const key of slideKeys) {
    const slideNum = Number(/\d+/.exec(key)?.[0] ?? segments.length + 1)
    const xml = entries.get(key)!.toString('utf8')
    const lines = extractDrawingParagraphs(xml)

    const notesKey = `ppt/notesSlides/notesSlide${slideNum}.xml`
    const notesXml = entries.get(notesKey)?.toString('utf8')
    const notesLines = notesXml ? extractDrawingParagraphs(notesXml).filter(l => l !== String(slideNum)) : []

    if (!lines.length && !notesLines.length) continue
    const title = lines[0] ?? `第 ${slideNum} 页`
    const body = lines.slice(1)
    const parts = [`## ${title}`, ...body]
    if (notesLines.length) {
      parts.push('', `演讲备注：${notesLines.join(' ')}`)
    }
    segments.push({
      locator: `第 ${slideNum} 页幻灯片`,
      text: parts.join('\n'),
      blockKind: 'text'
    })
  }
  return segments
}
