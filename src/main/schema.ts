/**
 * Zhixu Knowledge Schema & Boundary-Aware TF-IDF Mutual Index Engine (v2).
 *
 * Key engineering upgrades over naive substring entity linking:
 * - Strict ASCII word-boundary matching so short technical tokens (`port`, `net`, `api`)
 *   never falsely match unrelated substrings (`import`, `network`, `rapid`).
 * - Automatic parenthetical alias extraction & canonical merging (e.g. `标准操作规程（SOP）` -> `SOP`).
 * - TF-IDF × positional weight scoring (heading hit boost + sublinear term-frequency saturation)
 *   for higher-precision multi-hop retrieval ranking.
 */

import { createHash } from 'node:crypto'
import type {
  AccessLevel,
  DocumentChunkRecord,
  SchemaEntityRecord,
  SpgTypeKind,
  StorageDomain,
  WikiPage,
  WikiPageType
} from '../shared/types'

export type SpgTypeDefinition = {
  name: string
  nameZh: string
  spgKind: SpgTypeKind
  storageDomain: StorageDomain
  pageTypes: WikiPageType[]
  hypernymPredicate?: 'isA' | 'locateAt' | 'mannerOf'
  requiredFields: ('title' | 'summary' | 'sources' | 'applicability')[]
  description: string
}

export const STORAGE_DOMAIN_LABELS: Record<StorageDomain, string> = {
  permissions: '权限',
  foundation: '基础',
  cases: '案例',
  concrete_media: '具体+图+元数据',
  domain_knowledge: '专业知识',
  versions: '版本'
}

export const SPG_SCHEMA_REGISTRY: SpgTypeDefinition[] = [
  {
    name: 'PermissionPolicy',
    nameZh: '权限与准入规则',
    spgKind: 'StandardType',
    storageDomain: 'permissions',
    pageTypes: [],
    requiredFields: ['title', 'summary'],
    description: '页面访问级别与审核审批权限边界。'
  },
  {
    name: 'FoundationConcept',
    nameZh: '基础概念与总览',
    spgKind: 'ConceptType',
    storageDomain: 'foundation',
    pageTypes: ['concept', 'index'],
    hypernymPredicate: 'isA',
    requiredFields: ['title', 'summary', 'sources'],
    description: '领域术语、定义与目录总览。'
  },
  {
    name: 'FieldCase',
    nameZh: '实践案例与现场记录',
    spgKind: 'EventType',
    storageDomain: 'cases',
    pageTypes: ['case', 'pond'],
    requiredFields: ['title', 'summary', 'sources'],
    description: '案例复盘、故障处置与现场实操记录。'
  },
  {
    name: 'ConcreteEntityAndMedia',
    nameZh: '具体实体、图像与元数据',
    spgKind: 'EntityType',
    storageDomain: 'concrete_media',
    pageTypes: ['entity', 'ops'],
    requiredFields: ['title', 'summary', 'sources'],
    description: '具体设备、对象、图像视觉解析及元数据。'
  },
  {
    name: 'ProfessionalKnowledge',
    nameZh: '专业规范与方法论',
    spgKind: 'ConceptType',
    storageDomain: 'domain_knowledge',
    pageTypes: ['protocol', 'regulation', 'synthesis'],
    hypernymPredicate: 'mannerOf',
    requiredFields: ['title', 'summary', 'sources', 'applicability'],
    description: '标准操作规程（SOP）、法规标准与跨文档综合。'
  },
  {
    name: 'VersionSnapshot',
    nameZh: '版本基线记录',
    spgKind: 'IndexType',
    storageDomain: 'versions',
    pageTypes: [],
    requiredFields: ['title', 'summary'],
    description: '已发布基线、候补版本及评测留存。'
  }
]

const PAGE_TYPE_TO_DOMAIN: Record<WikiPageType, StorageDomain> = {
  index: 'foundation',
  concept: 'foundation',
  case: 'cases',
  pond: 'cases',
  entity: 'concrete_media',
  ops: 'concrete_media',
  protocol: 'domain_knowledge',
  regulation: 'domain_knowledge',
  synthesis: 'domain_knowledge'
}

export function classifyPageStorageDomain(page: Pick<WikiPage, 'pageType' | 'title' | 'summary' | 'content'>): StorageDomain {
  if (page.pageType && PAGE_TYPE_TO_DOMAIN[page.pageType]) {
    const base = PAGE_TYPE_TO_DOMAIN[page.pageType]
    if (/(权限|访问控制|保密|角色|审批策略|rbac)/i.test(`${page.title} ${page.summary}`)) {
      return 'permissions'
    }
    return base
  }
  return 'foundation'
}

export function classifyFileStorageDomain(filePath: string, isImage = false): StorageDomain {
  if (isImage) return 'concrete_media'
  const lower = filePath.toLowerCase()
  if (/(权限|rbac|auth|policy|acl|permission)/i.test(lower)) return 'permissions'
  if (/(案例|case|复盘|故障|塘口|现场|日志|incident)/i.test(lower)) return 'cases'
  if (/(规范|标准|sop|规程|协议|法规|protocol|regulation|manual|工艺)/i.test(lower)) return 'domain_knowledge'
  if (/(设备|参数|清单|图谱|资产|图片|media|metadata|配置)/i.test(lower)) return 'concrete_media'
  return 'foundation'
}

export function inferAccessLevel(page: Pick<WikiPage, 'storageDomain' | 'title' | 'summary'>): AccessLevel {
  const text = `${page.title} ${page.summary}`
  if (/(机密|绝密|restricted|仅管理员|密码|密钥)/i.test(text)) return 'restricted'
  if (page.storageDomain === 'permissions' || /(内部|internal|审批)/i.test(text)) return 'internal'
  return 'internal'
}

export function validatePageAgainstSchema(page: WikiPage): string[] {
  if (page.slug === 'index') return []
  const errors: string[] = []
  const domain = page.storageDomain ?? classifyPageStorageDomain(page)
  const spec = SPG_SCHEMA_REGISTRY.find(item => item.storageDomain === domain)
  if (!page.title.trim()) errors.push('缺少标题')
  if (!page.summary.trim()) errors.push('缺少摘要')
  if (spec?.requiredFields.includes('applicability') && !page.applicability?.trim()) {
    errors.push('专业知识类页面缺少适用条件标注')
  }
  if (page.accessLevel && !['public', 'internal', 'restricted'].includes(page.accessLevel)) {
    errors.push(`非法权限值：${page.accessLevel}`)
  }
  return errors
}

export type MutualIndexLink = {
  entityId: string
  targetKind: 'chunk' | 'wiki'
  targetId: string
  relation: 'mentions' | 'defines' | 'belongs_to'
  weight: number
}

export type MutualIndexBuildResult = {
  entities: SchemaEntityRecord[]
  links: MutualIndexLink[]
  pageEntitiesMap: Map<string, string[]>
}

function entityIdFor(name: string): string {
  const norm = name.normalize('NFKC').trim().toLowerCase()
  return `ent_${createHash('sha1').update(norm).digest('hex').slice(0, 12)}`
}

function inferEntitySpgType(pageType?: WikiPageType): SpgTypeKind {
  if (pageType === 'case' || pageType === 'pond') return 'EventType'
  if (pageType === 'entity' || pageType === 'ops') return 'EntityType'
  if (pageType === 'regulation' || pageType === 'protocol') return 'StandardType'
  return 'ConceptType'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract canonical entity name + any parenthetical alias (e.g. `标准操作规程（SOP）` -> `['标准操作规程', 'sop']`).
 */
export function extractEntityAliases(rawName: string): { canonical: string; aliases: string[] } {
  const cleaned = rawName.normalize('NFKC').trim()
  const match = /^(.+?)\s*[（(]([^（）()]{2,28})[）)]$/.exec(cleaned)
  if (!match) {
    const lower = cleaned.toLowerCase()
    return { canonical: cleaned, aliases: lower.length >= 2 ? [lower] : [] }
  }
  const mainPart = match[1].trim()
  const innerPart = match[2].trim()
  const aliases = new Set<string>()
  if (cleaned.length >= 2) aliases.add(cleaned.toLowerCase())
  if (mainPart.length >= 2) aliases.add(mainPart.toLowerCase())
  if (innerPart.length >= 2) aliases.add(innerPart.toLowerCase())
  return { canonical: mainPart.length >= 2 ? mainPart : cleaned, aliases: [...aliases] }
}

type CompiledMatcher = {
  entityId: string
  terms: { term: string; regex: RegExp | null }[]
}

function compileTermMatcher(term: string): { term: string; regex: RegExp | null } {
  const isPureAsciiToken = /^[a-z0-9._-]+$/i.test(term)
  if (isPureAsciiToken) {
    return {
      term,
      regex: new RegExp(`(?<![a-z0-9_])${escapeRegExp(term)}(?![a-z0-9_])`, 'gi')
    }
  }
  return { term, regex: null }
}

function countTermHits(haystack: string, compiled: { term: string; regex: RegExp | null }): number {
  if (compiled.regex) {
    compiled.regex.lastIndex = 0
    let count = 0
    while (compiled.regex.exec(haystack) !== null) {
      count += 1
      if (count >= 12) break
    }
    return count
  }
  let count = 0
  let pos = 0
  while ((pos = haystack.indexOf(compiled.term, pos)) !== -1) {
    count += 1
    pos += compiled.term.length
    if (count >= 12) break
  }
  return count
}

/**
 * Build boundary-aware, alias-merged, TF-IDF-weighted Mutual Index connecting:
 *   Wiki Page (defines/mentions) <-> Canonical Schema Entity <-> Document Chunks (mentions/belongs_to)
 */
export function buildMutualIndex(
  pages: WikiPage[],
  chunks: DocumentChunkRecord[],
  fileTopicsByPath: Map<string, string[]>
): MutualIndexBuildResult {
  const entitiesById = new Map<string, SchemaEntityRecord>()
  const aliasSetByEntity = new Map<string, Set<string>>()
  const links: MutualIndexLink[] = []
  const seenLink = new Set<string>()
  const pageEntitiesMap = new Map<string, string[]>()

  const addLink = (link: MutualIndexLink) => {
    const key = `${link.entityId}|${link.targetKind}|${link.targetId}|${link.relation}`
    if (seenLink.has(key)) return
    seenLink.add(key)
    links.push(link)
  }

  const upsertEntity = (
    rawName: string,
    spgType: SpgTypeKind,
    storageDomain: StorageDomain,
    description: string
  ): SchemaEntityRecord | null => {
    const trimmed = rawName.trim().slice(0, 64)
    if (trimmed.length < 2) return null
    const { canonical, aliases } = extractEntityAliases(trimmed)
    const id = entityIdFor(canonical)
    let rec = entitiesById.get(id)
    if (!rec) {
      rec = {
        id,
        name: canonical,
        spgType,
        storageDomain,
        description: description.slice(0, 200),
        chunkCount: 0,
        wikiSlugs: []
      }
      entitiesById.set(id, rec)
      aliasSetByEntity.set(id, new Set<string>())
    }
    const aliasSet = aliasSetByEntity.get(id)!
    for (const a of aliases) {
      if (a.length >= 2) aliasSet.add(a)
    }
    return rec
  }

  // 1. Register entities from Wiki pages & explicit schemaEntities
  for (const page of pages) {
    if (page.slug === 'index') continue
    const domain = page.storageDomain ?? classifyPageStorageDomain(page)
    const spgType = inferEntitySpgType(page.pageType)
    const names = new Set<string>([page.title, ...(page.schemaEntities ?? [])])
    const pageEntNames: string[] = []

    for (const rawName of names) {
      const entity = upsertEntity(rawName, spgType, domain, page.summary)
      if (!entity) continue
      if (!entity.wikiSlugs.includes(page.slug)) {
        entity.wikiSlugs.push(page.slug)
      }
      pageEntNames.push(entity.name)
      addLink({
        entityId: entity.id,
        targetKind: 'wiki',
        targetId: page.slug,
        relation: rawName === page.title ? 'defines' : 'mentions',
        weight: rawName === page.title ? 1.0 : 0.72
      })
    }
    pageEntitiesMap.set(page.slug, [...new Set(pageEntNames)])
  }

  // 2. Register topics extracted from Stage-1 notes
  for (const [filePath, topics] of fileTopicsByPath.entries()) {
    const domain = classifyFileStorageDomain(filePath)
    for (const topic of topics) {
      upsertEntity(topic, 'ConceptType', domain, `提取自 ${filePath}`)
    }
  }

  // 3. Compile boundary-aware matchers & run two-pass TF-IDF weighted chunk linking
  const matchers: CompiledMatcher[] = []
  for (const [entityId, aliasSet] of aliasSetByEntity.entries()) {
    const terms = [...aliasSet].map(compileTermMatcher)
    if (terms.length) matchers.push({ entityId, terms })
  }

  type RawHit = { entityId: string; chunkId: string; tf: number; headingHit: boolean }
  const rawHits: RawHit[] = []
  const docFreq = new Map<string, number>()

  for (const chunk of chunks) {
    const headingNorm = chunk.headingPath.join(' ').normalize('NFKC').toLowerCase()
    const bodyNorm = chunk.content.normalize('NFKC').toLowerCase()

    for (const matcher of matchers) {
      let tf = 0
      let headingHit = false
      for (const compiled of matcher.terms) {
        const bodyCount = countTermHits(bodyNorm, compiled)
        if (bodyCount > 0) tf += bodyCount
        if (!headingHit && headingNorm && countTermHits(headingNorm, compiled) > 0) {
          headingHit = true
        }
      }
      if (tf > 0 || headingHit) {
        rawHits.push({ entityId: matcher.entityId, chunkId: chunk.chunkId, tf: Math.max(1, tf), headingHit })
        docFreq.set(matcher.entityId, (docFreq.get(matcher.entityId) ?? 0) + 1)
      }
    }
  }

  const totalChunks = Math.max(1, chunks.length)
  for (const hit of rawHits) {
    const entity = entitiesById.get(hit.entityId)
    if (!entity) continue
    entity.chunkCount += 1
    const df = docFreq.get(hit.entityId) ?? 1
    const idf = Math.log((totalChunks + 1) / (df + 1)) + 1
    const tfScore = 1 + Math.log(hit.tf)
    const rawWeight = tfScore * idf * (hit.headingHit ? 1.35 : 1.0)
    // Smooth saturation into [0.30, 1.00]
    const weight = Number(Math.min(1.0, Math.max(0.3, rawWeight / (rawWeight + 1.4))).toFixed(3))

    addLink({
      entityId: hit.entityId,
      targetKind: 'chunk',
      targetId: hit.chunkId,
      relation: 'mentions',
      weight
    })
  }

  // 4. Cross-link verified source excerpts to chunks
  const chunkIdsByFile = new Map<string, DocumentChunkRecord[]>()
  for (const chunk of chunks) {
    const list = chunkIdsByFile.get(chunk.file) ?? []
    list.push(chunk)
    chunkIdsByFile.set(chunk.file, list)
  }
  for (const page of pages) {
    if (page.slug === 'index') continue
    const { canonical } = extractEntityAliases(page.title)
    const titleId = entityIdFor(canonical)
    if (!entitiesById.has(titleId)) continue
    for (const src of page.sources) {
      const fileChunks = chunkIdsByFile.get(src.file) ?? []
      const normExcerpt = src.excerpt.normalize('NFKC').slice(0, 24).toLowerCase()
      for (const chunk of fileChunks) {
        if (normExcerpt.length >= 6 && chunk.content.normalize('NFKC').toLowerCase().includes(normExcerpt)) {
          addLink({
            entityId: titleId,
            targetKind: 'chunk',
            targetId: chunk.chunkId,
            relation: 'belongs_to',
            weight: 0.92
          })
        }
      }
    }
  }

  const entities = [...entitiesById.values()].sort(
    (a, b) => b.wikiSlugs.length * 3 + b.chunkCount - (a.wikiSlugs.length * 3 + a.chunkCount)
  )

  return { entities, links, pageEntitiesMap }
}
