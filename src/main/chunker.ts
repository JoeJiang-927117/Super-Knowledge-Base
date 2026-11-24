/**
 * Zhixu Structure-Aware Semantic Chunker (知序自研结构感知语义切块引擎 v2).
 *
 * Key engineering upgrades over naive heading/regex splitters:
 * - Stateful fenced-code-block tracker (` ``` ` / `~~~`): never misclassifies `#` comments
 *   or numbered lines inside code blocks as headings, and preserves language fences across splits.
 * - IP / version / decimal-safe sentence boundary scanner (`192.168.1.100`, `v2.0`, `3.14` stay intact).
 * - Markdown table header propagation when splitting oversized tables.
 * - Micro-chunk coalescing under matching heading paths to eliminate noisy tiny shards.
 */

import { createHash } from 'node:crypto'
import type { DocumentChunkRecord, StorageDomain } from '../shared/types'

export type SegmentInput = {
  locator: string
  text: string
  blockKind?: 'text' | 'table' | 'visual'
}

export type ChunkingOptions = {
  maxChunkChars?: number
  minChunkChars?: number
  overlapChars?: number
  maxHeadingDepth?: number
  storageDomain?: StorageDomain
}

type LineKind = 'heading' | 'text' | 'table' | 'code'

type ParsedLine = {
  index: number
  text: string
  locator: string
  kind: LineKind
  headingLevel: number // 1..6 for heading, 99 otherwise
  codeFenceLang?: string
}

type SectionNode = {
  level: number
  title: string
  titleLine?: ParsedLine
  lines: ParsedLine[]
  children: SectionNode[]
}

type ContentBlock = {
  headingPath: string[]
  lines: ParsedLine[]
  kind: 'text' | 'table' | 'code'
  codeFenceLang?: string
}

const BODY_LEVEL = 99
const FENCE_OPEN_RE = /^(\s*)(`{3,}|~{3,})([^\n]*)$/

function detectHeadingLevel(line: string): number {
  const trimmed = line.trim()
  if (!trimmed) return BODY_LEVEL
  const mdMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed)
  if (mdMatch) return mdMatch[1].length

  if (trimmed.length <= 64) {
    if (/^第[一二三四五六七八九十百千0-9]+[章节篇部]\s*\S*/.test(trimmed)) return 1
    if (/^[一二三四五六七八九十]+[、.．]\s*\S+/.test(trimmed)) return 2
    if (/^（[一二三四五六七八九十0-9]+）\s*\S+/.test(trimmed)) return 3
    const numMatch = /^(\d+(?:\.\d+){0,3})[、.\s]\s*([^\d].{1,52})$/.exec(trimmed)
    if (numMatch && !/[。；！？:：]$/.test(trimmed)) {
      return Math.min(4, numMatch[1].split('.').length)
    }
  }
  return BODY_LEVEL
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 3
}

/**
 * Stateful line classifier: tracks fenced code blocks so internal `#` comments,
 * shell scripts, and YAML lines are never mistaken for document headings.
 */
function parseSegmentsToLines(segments: SegmentInput[]): ParsedLine[] {
  const parsed: ParsedLine[] = []
  let activeFenceChar: '`' | '~' | null = null
  let activeFenceLen = 0
  let activeFenceLang = ''

  for (const seg of segments) {
    const rawLines = seg.text.replaceAll('\r\n', '\n').split('\n')
    for (const rawLine of rawLines) {
      const fenceMatch = FENCE_OPEN_RE.exec(rawLine)

      if (!activeFenceChar && fenceMatch) {
        activeFenceChar = fenceMatch[2][0] as '`' | '~'
        activeFenceLen = fenceMatch[2].length
        activeFenceLang = fenceMatch[3].trim()
        parsed.push({
          index: parsed.length,
          text: rawLine,
          locator: seg.locator,
          kind: 'code',
          headingLevel: BODY_LEVEL,
          codeFenceLang: activeFenceLang
        })
        continue
      }

      if (activeFenceChar) {
        parsed.push({
          index: parsed.length,
          text: rawLine,
          locator: seg.locator,
          kind: 'code',
          headingLevel: BODY_LEVEL,
          codeFenceLang: activeFenceLang
        })
        const trimmed = rawLine.trim()
        const closingRe = activeFenceChar === '`' ? /^`{3,}$/ : /^~{3,}$/
        if (closingRe.test(trimmed) && trimmed.length >= activeFenceLen) {
          activeFenceChar = null
          activeFenceLen = 0
          activeFenceLang = ''
        }
        continue
      }

      const level = detectHeadingLevel(rawLine)
      if (level !== BODY_LEVEL) {
        parsed.push({
          index: parsed.length,
          text: rawLine,
          locator: seg.locator,
          kind: 'heading',
          headingLevel: level
        })
        continue
      }

      parsed.push({
        index: parsed.length,
        text: rawLine,
        locator: seg.locator,
        kind: isMarkdownTableLine(rawLine) ? 'table' : 'text',
        headingLevel: BODY_LEVEL
      })
    }
  }

  return parsed
}

function buildSectionTree(lines: ParsedLine[], maxDepth: number): SectionNode {
  const root: SectionNode = { level: 0, title: '', lines: [], children: [] }
  const stack: SectionNode[] = [root]

  for (const line of lines) {
    if (line.kind !== 'heading' || line.headingLevel > maxDepth) {
      stack[stack.length - 1].lines.push(line)
      continue
    }
    while (stack.length > 1 && line.headingLevel <= stack[stack.length - 1].level) {
      stack.pop()
    }
    const node: SectionNode = {
      level: line.headingLevel,
      title: line.text.replace(/^#{1,6}\s+/, '').trim(),
      titleLine: line,
      lines: [],
      children: []
    }
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  }

  return root
}

function collectContentBlocks(node: SectionNode, ancestors: string[], out: ContentBlock[]): void {
  const headingPath = node.level >= 1 && node.title ? [...ancestors, node.title] : ancestors

  if (node.lines.length > 0) {
    let activeKind: 'text' | 'table' | 'code' | null = null
    let activeLang = ''
    let bucket: ParsedLine[] = []

    const flush = () => {
      if (!bucket.length || !activeKind) return
      const joined = bucket.map(l => l.text).join('\n').trim()
      if (joined) {
        out.push({
          headingPath,
          lines: bucket,
          kind: activeKind,
          codeFenceLang: activeKind === 'code' ? activeLang : undefined
        })
      }
      bucket = []
    }

    for (const line of node.lines) {
      const kind: 'text' | 'table' | 'code' = line.kind === 'table' ? 'table' : line.kind === 'code' ? 'code' : 'text'
      if (activeKind && kind !== activeKind) flush()
      activeKind = kind
      if (kind === 'code' && line.codeFenceLang) activeLang = line.codeFenceLang
      bucket.push(line)
    }
    flush()
  } else if (node.children.length === 0 && node.titleLine && headingPath.length > 0) {
    out.push({
      headingPath,
      lines: [node.titleLine],
      kind: 'text'
    })
  }

  for (const child of node.children) {
    collectContentBlocks(child, headingPath, out)
  }
}

/**
 * Domain-safe sentence scanner:
 * Splits on Chinese terminators (`。！？；`), newlines, or English sentence-ending `.!?`
 * followed by whitespace while protecting decimals (`3.14`), IPs (`192.168.1.100`), and versions (`v2.0`).
 */
export function splitSentencesSafe(text: string, hardLimit: number): string[] {
  const sentences: string[] = []
  let start = 0
  const n = text.length

  const pushSlice = (raw: string) => {
    const clean = raw.trim()
    if (!clean) return
    if (clean.length <= hardLimit) {
      sentences.push(clean)
      return
    }
    for (let offset = 0; offset < clean.length; offset += hardLimit) {
      const piece = clean.slice(offset, offset + hardLimit).trim()
      if (piece) sentences.push(piece)
    }
  }

  for (let i = 0; i < n; i += 1) {
    const ch = text[i]
    const prev = i > 0 ? text[i - 1] : ''
    const next = i + 1 < n ? text[i + 1] : ''

    const isCjkEnd = ch === '。' || ch === '！' || ch === '？' || ch === '；'
    const isNewline = ch === '\n'
    const isAsciiEnd =
      (ch === '!' || ch === '?' || ch === '.') &&
      (next === '' || /\s/.test(next)) &&
      // Protect decimals, IP octets, and numbered list markers like `1.` or `v2.0`
      !(ch === '.' && (/\d/.test(prev) || /[a-zA-Z]/.test(prev) && i >= 2 && text[i - 2] === '.'))

    if (isCjkEnd || isNewline || isAsciiEnd) {
      pushSlice(text.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < n) pushSlice(text.slice(start))
  return sentences
}

function splitTextBlock(text: string, maxChars: number, overlapChars: number): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxChars) return [trimmed]

  const paragraphs = trimmed.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const units: string[] = []
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      units.push(para)
    } else {
      units.push(...splitSentencesSafe(para, Math.max(200, maxChars - 80)))
    }
  }

  const slices: string[] = []
  let acc: string[] = []
  let accLen = 0

  for (const unit of units) {
    if (acc.length > 0 && accLen + unit.length + 1 > maxChars) {
      slices.push(acc.join('\n').trim())
      const carry: string[] = []
      let carryLen = 0
      for (let i = acc.length - 1; i >= 0; i -= 1) {
        if (carryLen >= overlapChars) break
        carry.unshift(acc[i])
        carryLen += acc[i].length + 1
      }
      acc = carry
      accLen = carryLen
    }
    acc.push(unit)
    accLen += unit.length + 1
  }

  if (acc.length > 0) {
    const tail = acc.join('\n').trim()
    if (tail) slices.push(tail)
  }
  return slices
}

function splitTableBlock(text: string, maxChars: number): string[] {
  const rows = text.split('\n').map(r => r.trim()).filter(Boolean)
  if (rows.length <= 3 || text.length <= maxChars) return [text.trim()]

  const hasSep = /^\|[\s:-]+\|/.test(rows[1] ?? '')
  const header = hasSep ? rows.slice(0, 2) : rows.slice(0, 1)
  const body = hasSep ? rows.slice(2) : rows.slice(1)
  const headerText = header.join('\n')

  const slices: string[] = []
  let acc: string[] = [headerText]
  let accLen = headerText.length

  for (const row of body) {
    if (acc.length > 1 && accLen + row.length + 1 > maxChars) {
      slices.push(acc.join('\n'))
      acc = [headerText]
      accLen = headerText.length
    }
    acc.push(row)
    accLen += row.length + 1
  }
  if (acc.length > 1 || slices.length === 0) slices.push(acc.join('\n'))
  return slices
}

function splitCodeBlock(text: string, maxChars: number, lang?: string): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return [trimmed]
  const lines = trimmed.split('\n')
  const openFence = /^(`{3,}|~{3,})/.test(lines[0] ?? '') ? lines[0] : `\`\`\`${lang ?? ''}`
  const closeFence = /^(`{3,}|~{3,})$/.test(lines[lines.length - 1]?.trim() ?? '') ? lines[lines.length - 1].trim() : '```'
  const inner = lines.slice(
    /^(`{3,}|~{3,})/.test(lines[0] ?? '') ? 1 : 0,
    /^(`{3,}|~{3,})$/.test(lines[lines.length - 1]?.trim() ?? '') ? -1 : undefined
  )
  const budget = Math.max(240, maxChars - openFence.length - closeFence.length - 4)
  const slices: string[] = []
  let acc: string[] = []
  let accLen = 0
  for (const line of inner) {
    if (acc.length > 0 && accLen + line.length + 1 > budget) {
      slices.push(`${openFence}\n${acc.join('\n')}\n${closeFence}`)
      acc = []
      accLen = 0
    }
    acc.push(line)
    accLen += line.length + 1
  }
  if (acc.length > 0) slices.push(`${openFence}\n${acc.join('\n')}\n${closeFence}`)
  return slices
}

function stableChunkId(file: string, index: number, content: string): string {
  const hash = createHash('sha1').update(`${file}#${index}#${content.slice(0, 240)}`).digest('hex').slice(0, 12)
  return `chk_${hash}_${index}`
}

/**
 * Main entry point: Structure-aware, code-fence-safe, micro-chunk-coalescing chunker.
 */
export function buildStructuredRecursiveChunks(
  file: string,
  segments: SegmentInput[],
  options: ChunkingOptions = {}
): DocumentChunkRecord[] {
  const maxChunkChars = options.maxChunkChars ?? 1400
  const minChunkChars = options.minChunkChars ?? 160
  const overlapChars = options.overlapChars ?? 140
  const maxHeadingDepth = options.maxHeadingDepth ?? 4
  const storageDomain = options.storageDomain ?? 'foundation'

  const chunks: DocumentChunkRecord[] = []
  const seenContentHash = new Set<string>()
  let chunkIndex = 0

  const textSegments: SegmentInput[] = []
  for (const seg of segments) {
    if (seg.blockKind === 'visual') {
      const content = seg.text.trim()
      if (!content) continue
      chunks.push({
        chunkId: stableChunkId(file, chunkIndex, content),
        file,
        chunkIndex,
        locator: seg.locator,
        headingPath: ['视觉资产', file],
        blockKind: 'visual',
        content,
        charCount: content.length,
        storageDomain: 'concrete_media'
      })
      chunkIndex += 1
    } else {
      textSegments.push(seg)
    }
  }

  if (!textSegments.length) return chunks

  const parsedLines = parseSegmentsToLines(textSegments)
  const tree = buildSectionTree(parsedLines, maxHeadingDepth)
  const rawBlocks: ContentBlock[] = []
  collectContentBlocks(tree, [], rawBlocks)

  // Micro-chunk coalescing: merge tiny adjacent text blocks sharing the same heading path
  const blocks: ContentBlock[] = []
  for (const block of rawBlocks) {
    const prev = blocks[blocks.length - 1]
    const prevTextLen = prev ? prev.lines.reduce((sum, l) => sum + l.text.length + 1, 0) : 0
    const curTextLen = block.lines.reduce((sum, l) => sum + l.text.length + 1, 0)
    if (
      prev &&
      prev.kind === 'text' &&
      block.kind === 'text' &&
      prev.headingPath.join('>') === block.headingPath.join('>') &&
      (prevTextLen < minChunkChars || curTextLen < minChunkChars) &&
      prevTextLen + curTextLen <= maxChunkChars - 120
    ) {
      prev.lines = [...prev.lines, ...block.lines]
    } else {
      blocks.push({ ...block, lines: [...block.lines] })
    }
  }

  for (const block of blocks) {
    const rawText = block.lines.map(l => l.text).join('\n').trim()
    if (!rawText) continue
    const firstLocator = block.lines[0]?.locator ?? textSegments[0].locator
    const lastLocator = block.lines[block.lines.length - 1]?.locator ?? firstLocator
    const locator = firstLocator === lastLocator ? firstLocator : `${firstLocator} ~ ${lastLocator}`
    const prefix = block.headingPath.length ? `[章节：${block.headingPath.join(' > ')}]\n` : ''
    const budget = Math.max(300, maxChunkChars - prefix.length)

    const pieces =
      block.kind === 'table'
        ? splitTableBlock(rawText, budget)
        : block.kind === 'code'
          ? splitCodeBlock(rawText, budget, block.codeFenceLang)
          : splitTextBlock(rawText, budget, overlapChars)

    for (const piece of pieces) {
      const fullContent = prefix ? `${prefix}${piece}` : piece
      const dedupeKey = createHash('sha1').update(fullContent).digest('hex')
      if (seenContentHash.has(dedupeKey)) continue
      seenContentHash.add(dedupeKey)

      chunks.push({
        chunkId: stableChunkId(file, chunkIndex, fullContent),
        file,
        chunkIndex,
        locator,
        headingPath: block.headingPath,
        blockKind: block.kind === 'table' ? 'table' : 'text',
        content: fullContent,
        charCount: fullContent.length,
        storageDomain
      })
      chunkIndex += 1
    }
  }

  return chunks
}

/**
 * Group fine-grained retrieval chunks into larger LLM-note windows (~10,000 chars)
 * while respecting structural boundaries.
 */
export function groupChunksForLlmWindow(chunks: DocumentChunkRecord[], maxWindowChars = 10000): string[] {
  const windows: string[] = []
  let current = ''

  for (const chunk of chunks) {
    const section = `\n[位置：${chunk.locator}${chunk.headingPath.length ? ` | 章节：${chunk.headingPath.join(' > ')}` : ''}]\n${chunk.content}`
    if (current && current.length + section.length > maxWindowChars) {
      windows.push(current.trim())
      current = ''
    }
    current += section
  }
  if (current.trim()) windows.push(current.trim())
  return windows
}
