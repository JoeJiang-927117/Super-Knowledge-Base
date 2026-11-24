/**
 * Zhixu Hybrid Retrieval Engine (BM25 + Persistent SQLite Vector Cache + TF-IDF Mutual-Index + Adaptive Reranker).
 *
 * Architecture:
 * - Persistent SQLite vector cache (`embeddings` table) with no 240-document ceiling
 * - In-memory Orama index cached per (store.root, store.getRevision(), scopeKey)
 * - Honest QA citations: never pads citations when `insufficientEvidence: true`; marks fallback candidates explicitly
 * - Routes QA generation through the LLM tier
 */

import { createHash } from 'node:crypto'
import { create, insertMultiple, search, type AnyOrama } from '@orama/orama'
import { z } from 'zod'
import type {
  KnowledgeCitation,
  KnowledgeQueryResult,
  ModelProviderSettings,
  QaHistoryTurn,
  SearchHit,
  StorageDomain,
  WikiPage
} from '../shared/types'
import { createTierModelClient, describeModel } from './model'
import type { CachedEmbeddingEntry, WikiStore } from './store'

type SearchOptions = {
  includeDrafts?: boolean
  includeSources?: boolean
  domain?: StorageDomain
  limit?: number
  history?: QaHistoryTurn[]
}

type IndexedDocument = {
  id: string
  kind: 'wiki' | 'source' | 'chunk'
  slug: string
  file: string
  locator: string
  headingPath: string[]
  title: string
  summary: string
  content: string
  status: 'published' | 'draft' | 'moderating' | 'validating' | 'archived' | 'pending_delete' | 'raw'
  pageType: string
  evidenceLevel: string
  applicability: string
  storageDomain: StorageDomain
  embedding?: number[]
}

type CachedOramaEntry = {
  key: string
  db: AnyOrama
  docsById: Map<string, IndexedDocument>
  vectorDim: number | null
}

const oramaCache = new Map<string, CachedOramaEntry>()
const MAX_CACHE_ENTRIES = 8
const EMBED_BATCH_SIZE = 32

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
const CJK_REGEX = /[\u4e00-\u9fff]/
const ZH_STOPWORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也',
  '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那',
  '什么', '怎么', '多少', '哪些', '如何', '为什么', '吗', '呢', '吧', '啊', '与', '及', '或',
  '被', '把', '让', '对', '为', '以', '之', '其', '于', '而', '但', '并', '且', '从', '中'
])

function chineseTokenizer(text: string): string[] {
  if (!text) return []
  const tokens: string[] = []
  const seen = new Set<string>()
  const push = (token: string) => {
    if (!token || ZH_STOPWORDS.has(token) || seen.has(token)) return
    seen.add(token)
    tokens.push(token)
  }

  for (const { segment, isWordLike } of segmenter.segment(String(text).toLowerCase())) {
    if (!isWordLike) continue
    if (ZH_STOPWORDS.has(segment)) continue
    push(segment)
    if (CJK_REGEX.test(segment) && segment.length >= 3) {
      for (let i = 0; i + 1 < segment.length; i += 1) {
        push(segment.slice(i, i + 2))
      }
    }
  }
  return tokens
}

const AnswerResultSchema = z.object({
  conclusion: z.string(),
  applicability: z.string(),
  conflicts: z.string(),
  missingInfo: z.string(),
  insufficientEvidence: z.boolean(),
  citedIds: z.array(z.string())
})

const ANSWER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    conclusion: { type: 'string' },
    applicability: { type: 'string' },
    conflicts: { type: 'string' },
    missingInfo: { type: 'string' },
    insufficientEvidence: { type: 'boolean' },
    citedIds: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['conclusion', 'applicability', 'conflicts', 'missingInfo', 'insufficientEvidence', 'citedIds'],
  additionalProperties: false
}

function docEmbedText(doc: IndexedDocument): string {
  return `${doc.title}\n${doc.summary}\n${doc.content.slice(0, 1200)}`
}

function contentSha1(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

async function getOrBuildOramaIndex(
  store: WikiStore,
  modelSettings: ModelProviderSettings,
  options: SearchOptions
): Promise<{ db: AnyOrama; docsById: Map<string, IndexedDocument>; vectorDim: number | null }> {
  const embedModelId =
    modelSettings.embeddingModel?.trim() || (modelSettings.provider === 'ollama' ? 'ollama:auto' : '')
  const cacheKey = `${store.root}|rev=${store.getRevision()}|d=${Boolean(options.includeDrafts)}|s=${Boolean(options.includeSources)}|dom=${options.domain ?? ''}|emb=${embedModelId}`

  const hit = oramaCache.get(cacheKey)
  if (hit) {
    return { db: hit.db, docsById: hit.docsById, vectorDim: hit.vectorDim }
  }

  const docs: IndexedDocument[] = []

  const publishedPages = store.getPublishedPages().filter(page => page.slug !== 'index')
  for (const page of publishedPages) {
    docs.push(wikiPageToDoc(page, 'published'))
  }

  if (options.includeDrafts) {
    const pendingPages = store
      .getPages()
      .filter(
        (page): page is WikiPage & { status: 'draft' | 'moderating' | 'validating' | 'pending_delete' } =>
          page.slug !== 'index' &&
          (page.status === 'draft' ||
            page.status === 'moderating' ||
            page.status === 'validating' ||
            page.status === 'pending_delete')
      )
    for (const page of pendingPages) {
      docs.push(wikiPageToDoc(page, page.status))
    }
  }

  if (options.includeSources) {
    const storedChunks = store.getChunks()
    if (storedChunks.length > 0) {
      for (const chunk of storedChunks) {
        docs.push({
          id: `chunk:${chunk.chunkId}`,
          kind: 'chunk',
          slug: '',
          file: chunk.file,
          locator: chunk.locator,
          headingPath: chunk.headingPath,
          title: chunk.headingPath.length ? `${chunk.file} · ${chunk.headingPath.join(' / ')}` : chunk.file,
          summary: chunk.content.replace(/\s+/g, ' ').trim().slice(0, 180),
          content: chunk.content,
          status: 'raw',
          pageType: chunk.blockKind === 'visual' ? 'visual_asset' : chunk.blockKind === 'table' ? 'raw_table' : 'raw_chunk',
          evidenceLevel: 'raw_evidence',
          applicability: '',
          storageDomain: chunk.storageDomain
        })
      }
    } else {
      const files = store.getFiles()
      for (const file of files) {
        const pointsText = file.notes.keyPoints.map(kp => `${kp.point}（原文：${kp.excerpt}）`).join('\n')
        const content = [file.notes.summaries.join('\n'), file.notes.topics.join('、'), pointsText]
          .filter(Boolean)
          .join('\n')
        if (!content.trim()) continue
        docs.push({
          id: `source:${file.path}`,
          kind: 'source',
          slug: '',
          file: file.path,
          locator: '知识笔记',
          headingPath: [],
          title: file.path,
          summary: file.notes.summaries[0] ?? '',
          content,
          status: 'raw',
          pageType: 'raw_source',
          evidenceLevel: 'raw_evidence',
          applicability: '',
          storageDomain: 'foundation'
        })
      }
    }
  }

  const filteredDocs = options.domain ? docs.filter(doc => doc.storageDomain === options.domain) : docs

  // Persistent SQLite vector embedding hydration (no 240-doc cap!)
  let vectorDim: number | null = null
  if (filteredDocs.length > 0 && embedModelId) {
    try {
      const cachedMap = store.getCachedEmbeddings(embedModelId)
      const missing: { doc: IndexedDocument; text: string; hash: string }[] = []

      for (const doc of filteredDocs) {
        const text = docEmbedText(doc)
        const hash = contentSha1(text)
        const cached = cachedMap.get(doc.id)
        if (cached && cached.contentHash === hash && cached.vector.length > 0) {
          doc.embedding = cached.vector
        } else {
          missing.push({ doc, text, hash })
        }
      }

      if (missing.length > 0) {
        const client = createTierModelClient(modelSettings, 'LLM')
        const toPersist: CachedEmbeddingEntry[] = []
        let embedSupported = true

        for (let offset = 0; offset < missing.length && embedSupported; offset += EMBED_BATCH_SIZE) {
          const batch = missing.slice(offset, offset + EMBED_BATCH_SIZE)
          const vectors = await client.embed(batch.map(item => item.text))
          if (!vectors || vectors.length !== batch.length || !vectors[0]?.length) {
            embedSupported = false
            break
          }
          batch.forEach((item, idx) => {
            item.doc.embedding = vectors[idx]
            toPersist.push({
              docKey: item.doc.id,
              model: embedModelId,
              contentHash: item.hash,
              vector: vectors[idx]
            })
          })
        }

        if (toPersist.length > 0) {
          store.upsertCachedEmbeddings(toPersist)
        }
      }

      // Only enable Orama vector field if all indexed docs share the same vector dimension
      const firstDim = filteredDocs[0]?.embedding?.length ?? 0
      if (firstDim > 0 && filteredDocs.every(doc => doc.embedding?.length === firstDim)) {
        vectorDim = firstDim
      } else {
        for (const doc of filteredDocs) {
          delete doc.embedding
        }
      }
    } catch {
      vectorDim = null
      for (const doc of filteredDocs) {
        delete doc.embedding
      }
    }
  }

  const schema: Record<string, unknown> = {
    kind: 'enum',
    slug: 'string',
    file: 'string',
    title: 'string',
    summary: 'string',
    content: 'string',
    status: 'enum',
    pageType: 'enum',
    evidenceLevel: 'enum',
    storageDomain: 'enum'
  }
  if (vectorDim) {
    schema.embedding = `vector[${vectorDim}]`
  }

  const db = create({
    schema: schema as Parameters<typeof create>[0]['schema'],
    components: {
      tokenizer: {
        language: 'zh',
        normalizationCache: new Map(),
        tokenize: chineseTokenizer
      }
    }
  })

  if (filteredDocs.length) {
    await insertMultiple(db, filteredDocs)
  }

  const docsById = new Map(filteredDocs.map(doc => [doc.id, doc]))
  if (oramaCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = oramaCache.keys().next().value
    if (oldestKey) oramaCache.delete(oldestKey)
  }
  oramaCache.set(cacheKey, { key: cacheKey, db, docsById, vectorDim })

  return { db, docsById, vectorDim }
}

function wikiPageToDoc(
  page: WikiPage,
  status: 'published' | 'draft' | 'moderating' | 'validating' | 'pending_delete'
): IndexedDocument {
  const sourceExcerpts = page.sources.map(s => `${s.file} ${s.locator}: ${s.excerpt}`).join('\n')
  const entitiesText = page.schemaEntities?.length ? `\n实体与概念：${page.schemaEntities.join('、')}` : ''
  return {
    id: `${status}:${page.slug}`,
    kind: 'wiki',
    slug: page.slug,
    file: page.sources[0]?.file ?? '',
    locator: page.sources[0]?.locator ?? '',
    headingPath: [],
    title: page.title,
    summary: page.summary,
    content: `${page.content}${entitiesText}\n${sourceExcerpts}`,
    status,
    pageType: page.pageType,
    evidenceLevel: page.evidenceLevel,
    applicability: page.applicability,
    storageDomain: page.storageDomain ?? 'foundation'
  }
}

function computeMutualIndexBoosts(
  store: WikiStore,
  query: string
): { wikiBoosts: Map<string, { score: number; entities: string[] }>; chunkBoosts: Map<string, { score: number; entities: string[] }> } {
  const wikiBoosts = new Map<string, { score: number; entities: string[] }>()
  const chunkBoosts = new Map<string, { score: number; entities: string[] }>()
  const normQuery = query.normalize('NFKC').toLowerCase()
  const queryTokens = new Set(chineseTokenizer(query))
  const entities = store.getSchemaEntities()
  if (!entities.length) return { wikiBoosts, chunkBoosts }

  const matchedEntityById = new Map<string, string>()
  for (const ent of entities) {
    const normName = ent.name.normalize('NFKC').toLowerCase()
    if (normName.length >= 2 && (normQuery.includes(normName) || queryTokens.has(normName))) {
      matchedEntityById.set(ent.id, ent.name)
    }
  }
  if (!matchedEntityById.size) return { wikiBoosts, chunkBoosts }

  const links = store.getMutualIndexLinks()
  for (const link of links) {
    const entName = matchedEntityById.get(link.entityId)
    if (!entName) continue
    const targetMap = link.targetKind === 'wiki' ? wikiBoosts : chunkBoosts
    const entry = targetMap.get(link.targetId) ?? { score: 0, entities: [] }
    entry.score += link.weight * 0.15
    if (!entry.entities.includes(entName)) entry.entities.push(entName)
    targetMap.set(link.targetId, entry)
  }

  return { wikiBoosts, chunkBoosts }
}

async function searchKnowledgeWithMeta(
  store: WikiStore,
  modelSettings: ModelProviderSettings,
  query: string,
  options: SearchOptions = {}
): Promise<{ hits: SearchHit[]; usedVector: boolean; usedReranker: boolean; usedMutualIndex: boolean }> {
  const trimmed = query.trim()
  if (!trimmed) return { hits: [], usedVector: false, usedReranker: false, usedMutualIndex: false }

  const { db, docsById, vectorDim } = await getOrBuildOramaIndex(store, modelSettings, options)
  const allowedStatuses: string[] = ['published']
  if (options.includeDrafts) allowedStatuses.push('draft', 'moderating', 'validating', 'pending_delete')
  if (options.includeSources) allowedStatuses.push('raw')

  const finalLimit = options.limit ?? 10
  const recallLimit = Math.max(finalLimit * 3, 20)
  const client = createTierModelClient(modelSettings, 'LLM')

  let queryVector: number[] | null = null
  if (vectorDim) {
    try {
      const embedded = await client.embed([trimmed])
      if (embedded?.[0]?.length === vectorDim) queryVector = embedded[0]
    } catch {
      queryVector = null
    }
  }

  const results = await search(
    db,
    queryVector
      ? {
          mode: 'hybrid',
          term: trimmed,
          vector: { value: queryVector, property: 'embedding' },
          where: { status: { in: allowedStatuses } },
          limit: recallLimit,
          boost: { title: 3, summary: 2, content: 1 }
        }
      : {
          term: trimmed,
          where: { status: { in: allowedStatuses } },
          limit: recallLimit,
          boost: { title: 3, summary: 2, content: 1 }
        }
  )

  const { wikiBoosts, chunkBoosts } = computeMutualIndexBoosts(store, trimmed)
  let usedMutualIndex = false

  type Candidate = {
    doc: IndexedDocument
    baseScore: number
    mutualBoost: number
    matchedEntities: string[]
  }

  const candidateMap = new Map<string, Candidate>()
  let maxBase = 0
  for (const hit of results.hits) {
    const doc = hit.document as unknown as IndexedDocument
    if (hit.score > maxBase) maxBase = hit.score
    const boostInfo =
      doc.kind === 'wiki'
        ? wikiBoosts.get(doc.slug)
        : doc.kind === 'chunk'
          ? chunkBoosts.get(doc.id.replace(/^chunk:/, ''))
          : undefined
    if (boostInfo) usedMutualIndex = true
    candidateMap.set(doc.id, {
      doc,
      baseScore: hit.score,
      mutualBoost: boostInfo?.score ?? 0,
      matchedEntities: boostInfo?.entities ?? []
    })
  }

  for (const [slug, boostInfo] of wikiBoosts.entries()) {
    for (const statusPrefix of allowedStatuses) {
      const id = `${statusPrefix}:${slug}`
      if (candidateMap.has(id)) continue
      const doc = docsById.get(id)
      if (!doc) continue
      usedMutualIndex = true
      candidateMap.set(id, {
        doc,
        baseScore: maxBase > 0 ? maxBase * 0.35 : 0.35,
        mutualBoost: boostInfo.score,
        matchedEntities: boostInfo.entities
      })
    }
  }

  const candidates = [...candidateMap.values()]
  if (!candidates.length) {
    return { hits: [], usedVector: Boolean(queryVector), usedReranker: false, usedMutualIndex }
  }

  const normDenom = maxBase > 0 ? maxBase : 1
  const lexicalNorm = candidates.map(c => Math.min(1, c.baseScore / normDenom))

  let usedReranker = false
  let rerankScores: number[] | null = null
  if (modelSettings.rerankModel?.trim()) {
    const docTexts = candidates.map(c => `${c.doc.title}\n${c.doc.summary}\n${c.doc.content.slice(0, 1400)}`)
    rerankScores = await client.rerank(trimmed, docTexts)
    if (rerankScores && rerankScores.length === candidates.length) {
      usedReranker = true
    }
  }

  const scored = (() => {
    // RRF (Reciprocal Rank Fusion) + Exact Numeric/Technical Literal Boost
    const RRF_K = 40
    const lexicalOrder = candidates
      .map((c, i) => ({ i, v: c.baseScore }))
      .sort((a, b) => b.v - a.v)
    const lexicalRank = new Map(lexicalOrder.map((e, rank) => [e.i, rank + 1]))

    const mutualOrder = candidates
      .map((c, i) => ({ i, v: c.mutualBoost }))
      .filter(e => e.v > 0)
      .sort((a, b) => b.v - a.v)
    const mutualRank = new Map(mutualOrder.map((e, rank) => [e.i, rank + 1]))

    const rerankRank =
      usedReranker && rerankScores
        ? new Map(
            candidates
              .map((_, i) => ({ i, v: rerankScores![i] }))
              .sort((a, b) => b.v - a.v)
              .map((e, rank) => [e.i, rank + 1])
          )
        : null

    // Extract high-precision literal tokens (IPs, ports, numbers+units, versions, quoted phrases)
    const exactLiterals = [
      ...new Set(
        (trimmed.match(/(?:\d{1,3}(?:\.\d{1,3}){3}|v?\d+(?:\.\d+)+|\d+\s*(?:小时|分钟|秒|天|米|万|%|MB|GB|KB|端口)?|[A-Za-z0-9_-]{4,})/gi) ?? [])
          .map(s => s.trim().toLowerCase())
          .filter(s => s.length >= 2)
      )
    ]
    const normQuery = trimmed.toLowerCase()

    return candidates.map((cand, idx) => {
      const hay = `${cand.doc.title} ${cand.doc.summary} ${cand.doc.content}`.toLowerCase()
      let exactBonus = 0
      if (normQuery.length >= 3 && hay.includes(normQuery)) {
        exactBonus += 0.22
      }
      if (exactLiterals.length) {
        const matchedCount = exactLiterals.filter(lit => hay.includes(lit)).length
        exactBonus += (matchedCount / exactLiterals.length) * 0.24
      }

      const rrfLex = 1 / (RRF_K + (lexicalRank.get(idx) ?? candidates.length + 1))
      const rrfMut = mutualRank.has(idx) ? 1 / (RRF_K + mutualRank.get(idx)!) : 0
      const rrfRerank = rerankRank ? 1 / (RRF_K + (rerankRank.get(idx) ?? candidates.length + 1)) : 0
      const rrfScore = usedReranker
        ? (0.25 * rrfLex + 0.2 * rrfMut + 0.55 * rrfRerank) * RRF_K
        : (0.68 * rrfLex + 0.32 * rrfMut) * RRF_K

      const baseBlend =
        usedReranker && rerankScores
          ? 0.28 * lexicalNorm[idx] + 0.52 * rerankScores[idx] + 0.2 * rrfScore + cand.mutualBoost + exactBonus
          : 0.62 * lexicalNorm[idx] + 0.38 * rrfScore + cand.mutualBoost + exactBonus

      return { cand, finalScore: baseBlend }
    })
  })()

  scored.sort((a, b) => b.finalScore - a.finalScore)

  const hits: SearchHit[] = scored.slice(0, finalLimit).map(({ cand, finalScore }) => {
    const doc = cand.doc
    const snippetSource = doc.summary || doc.content.replace(/\s+/g, ' ').trim()
    return {
      id: doc.id,
      kind: doc.kind,
      slug: doc.slug || undefined,
      file: doc.file || undefined,
      locator: doc.locator || undefined,
      headingPath: doc.headingPath.length ? doc.headingPath : undefined,
      title: doc.title,
      snippet: snippetSource.slice(0, 220),
      score: Number(finalScore.toFixed(4)),
      status: doc.status,
      pageType: doc.pageType,
      evidenceLevel: doc.evidenceLevel,
      storageDomain: doc.storageDomain,
      reranked: usedReranker,
      matchedEntities: cand.matchedEntities.length ? cand.matchedEntities : undefined
    }
  })

  return {
    hits,
    usedVector: Boolean(queryVector),
    usedReranker,
    usedMutualIndex
  }
}

export async function searchKnowledge(
  store: WikiStore,
  modelSettings: ModelProviderSettings,
  query: string,
  options: SearchOptions = {}
): Promise<SearchHit[]> {
  const { hits } = await searchKnowledgeWithMeta(store, modelSettings, query, options)
  return hits
}

export async function askKnowledgeBase(
  store: WikiStore,
  modelSettings: ModelProviderSettings,
  question: string,
  options: SearchOptions = {}
): Promise<KnowledgeQueryResult> {
  const trimmed = question.trim()
  if (!trimmed) {
    throw new Error('请输入要检索或提问的问题')
  }

  const recentHistory = (options.history ?? []).slice(-3)
  const isFollowUp =
    recentHistory.length > 0 &&
    (trimmed.length <= 18 || /^(那|它|这个|这些|上面|刚才|如果|还有|继续|再|怎么|为什么)/.test(trimmed))
  const retrievalQuery = isFollowUp
    ? `${recentHistory[recentHistory.length - 1].question} ${trimmed}`.slice(0, 240)
    : trimmed

  const { hits, usedVector, usedReranker, usedMutualIndex } = await searchKnowledgeWithMeta(
    store,
    modelSettings,
    retrievalQuery,
    { ...options, limit: 6 }
  )
  const pagesBySlug = new Map(store.getPages().map(p => [p.slug, p]))
  const publishedBySlug = new Map(store.getPublishedPages().map(p => [p.slug, p]))
  const filesByPath = new Map(store.getFiles().map(f => [f.path, f]))
  const chunksById = new Map(store.getChunks().map(c => [`chunk:${c.chunkId}`, c]))

  const modeParts = [usedVector ? 'RRF 混合向量' : 'RRF 中文分词']
  if (usedMutualIndex) modeParts.push('互索引')
  if (usedReranker) modeParts.push('Sigmoid 精排')
  const modeLabel = modeParts.join(' + ')
  const scopeLabel = options.includeDrafts ? '含待审草稿' : '仅已发布正式知识'

  if (!hits.length) {
    return {
      conclusion: '当前知识库中未检索到与该问题直接相关的已审核知识或证据，无法给出可靠结论。',
      applicability: '请先导入相关文档并完成整理，或勾选包含待审核/联合原文后再试。',
      citations: [],
      conflicts: '无',
      missingInfo: '缺乏直接支撑该问题的已发布知识页或原文依据。',
      knowledgeVersion: `${describeModel(modelSettings, 'LLM')} · ${modeLabel} · ${scopeLabel}`,
      insufficientEvidence: true,
      hits: []
    }
  }

  const evidenceBlocks: string[] = []
  const citationMap = new Map<string, KnowledgeCitation>()

  for (const hit of hits) {
    if (hit.kind === 'wiki' && hit.slug) {
      const page = hit.status === 'published' ? publishedBySlug.get(hit.slug) : pagesBySlug.get(hit.slug)
      if (!page) continue
      evidenceBlocks.push(
        `[ID: ${hit.id}] 类型: Wiki(${page.pageType}) | 状态: ${page.status} | 版本: ${page.versionLabel ?? 'V1.0'} | 证据等级: ${page.evidenceLevel} | 适用条件: ${page.applicability || '通用'}\n标题: ${page.title}\n摘要: ${page.summary}\n正文:\n${page.content.slice(0, 2600)}\n来源: ${page.sources.map(s => `${s.file}#${s.locator}: ${s.excerpt}`).join('；')}`
      )
      citationMap.set(hit.id, {
        label: page.title,
        kind: 'wiki',
        slug: page.slug,
        file: page.sources[0]?.file,
        locator: page.sources[0]?.locator,
        excerpt: page.sources[0]?.excerpt || page.summary
      })
    } else if (hit.kind === 'chunk') {
      const chunk = chunksById.get(hit.id)
      if (!chunk) continue
      const heading = chunk.headingPath.length ? ` | 章节: ${chunk.headingPath.join(' > ')}` : ''
      evidenceBlocks.push(
        `[ID: ${hit.id}] 类型: 原始结构化切块(${chunk.blockKind}) | 文件: ${chunk.file} | 位置: ${chunk.locator}${heading}\n内容:\n${chunk.content.slice(0, 1800)}`
      )
      citationMap.set(hit.id, {
        label: chunk.headingPath.length ? `${chunk.file} · ${chunk.headingPath[chunk.headingPath.length - 1]}` : chunk.file,
        kind: 'chunk',
        file: chunk.file,
        locator: chunk.locator,
        excerpt: chunk.content.replace(/\s+/g, ' ').trim().slice(0, 240)
      })
    } else if (hit.kind === 'source' && hit.file) {
      const file = filesByPath.get(hit.file)
      if (!file) continue
      const pts = file.notes.keyPoints.slice(0, 8).map(kp => `- ${kp.point}（原文：${kp.excerpt}）`).join('\n')
      evidenceBlocks.push(
        `[ID: ${hit.id}] 类型: 原始资料笔记 | 文件: ${file.path}\n摘要: ${file.notes.summaries.join('；')}\n要点:\n${pts}`
      )
      citationMap.set(hit.id, {
        label: file.path,
        kind: 'source',
        file: file.path,
        locator: '知识笔记',
        excerpt: file.notes.keyPoints[0]?.excerpt || file.notes.summaries[0] || ''
      })
    }
  }

  const client = createTierModelClient(modelSettings, 'LLM')
  const startedAt = Date.now()
  try {
    const rawResponse = await client.generateJson<unknown>(
      [
        {
          role: 'system',
          content: `你是严谨的知识库问答引擎。严格基于提供的检索证据回答问题，禁止编造或使用证据之外的常识推测。
要求：
1. 若证据不足以回答问题，将 insufficientEvidence 设为 true，citedIds 返回空数组 []，并在 conclusion 中明确说明“依据不足”与缺口所在。
2. conclusion 给出清晰直接的结论；applicability 说明适用条件与前提；conflicts 说明不同来源间是否有矛盾（无矛盾填“无”）；missingInfo 说明还缺哪些现场或前置条件（无填“无”）。
3. citedIds 必须填写实际引用的证据 [ID: ...] 标识。`
        },
        {
          role: 'user',
          content: `${
            recentHistory.length
              ? `前序对话上下文（仅用于理解指代，结论仍须严格以检索证据为准）：\n${recentHistory
                  .map((t, i) => `第 ${i + 1} 轮 问：${t.question}\n答：${t.conclusion.slice(0, 260)}`)
                  .join('\n')}\n\n`
              : ''
          }当前用户问题：${trimmed}\n\n检索到的知识证据：\n${evidenceBlocks.join('\n\n---\n\n')}`
        }
      ],
      ANSWER_JSON_SCHEMA
    )

    const parsed = AnswerResultSchema.parse(rawResponse)
    store.recordModelCall({
      taskType: 'LLM:knowledge_qa',
      provider: modelSettings.provider,
      model: client.modelName,
      durationMs: Date.now() - startedAt,
      status: 'ok',
      detail: `hits=${hits.length}, cited=${parsed.citedIds.length}, vec=${usedVector}, rerank=${usedReranker}, mutual=${usedMutualIndex}`
    })

    const explicitCitations = parsed.citedIds
      .map(id => citationMap.get(id))
      .filter((item): item is KnowledgeCitation => Boolean(item))

    // Fix P2: Never fabricate citations when evidence is insufficient; label fallback candidates honestly.
    let finalCitations: KnowledgeCitation[]
    if (parsed.insufficientEvidence) {
      finalCitations = explicitCitations
    } else if (explicitCitations.length > 0) {
      finalCitations = explicitCitations
    } else {
      finalCitations = [...citationMap.values()].slice(0, 3).map(item => ({
        ...item,
        label: `${item.label}（检索参考候选）`,
        isFallback: true
      }))
    }

    return {
      conclusion: parsed.conclusion.trim(),
      applicability: parsed.applicability.trim() || '未限定特定条件',
      citations: finalCitations,
      conflicts: parsed.conflicts.trim() || '无',
      missingInfo: parsed.missingInfo.trim() || '无',
      knowledgeVersion: `${describeModel(modelSettings, 'LLM')} · ${modeLabel} · ${scopeLabel}`,
      insufficientEvidence: parsed.insufficientEvidence,
      hits
    }
  } catch (error) {
    store.recordModelCall({
      taskType: 'LLM:knowledge_qa',
      provider: modelSettings.provider,
      model: client.modelName,
      durationMs: Date.now() - startedAt,
      status: 'error',
      detail: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}
