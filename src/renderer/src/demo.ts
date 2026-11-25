import type {
  ImportFilesResult,
  KnowledgeQueryResult,
  ModelProviderSettings,
  OrganizeResult,
  PageDiffResult,
  PageVersionSnapshot,
  ProgressEvent,
  SchemaEntityRecord,
  SchemaOverview,
  SearchHit,
  StorageDomain,
  WikiLintFixResult,
  WikiLintReport,
  WikiPage,
  WorkflowAction,
  WorkspaceApi,
  WorkspaceSnapshot
} from '../../shared/types'

/**
 * A deliberately in-memory preview backend. It is used only by the standalone
 * Vite development server; Electron and production builds always use localWiki
 * or the real HTTP API. This lets reviewers exercise the complete interface
 * without a model service or a writable knowledge-base directory.
 */
export function createDemoApi(): WorkspaceApi {
  const now = Date.now()
  const iso = (offsetMinutes = 0) => new Date(now - offsetMinutes * 60_000).toISOString()
  const modelProvider = {
    mode: 'cloud' as const,
    provider: 'openai' as const,
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    lllmBaseUrl: '',
    lllmModel: 'deepseek-reasoner',
    llmBaseUrl: '',
    llmModel: 'deepseek-chat',
    vmBaseUrl: '',
    visionModel: 'qwen-vl-max',
    embeddingModel: 'text-embedding-3-small',
    rerankBaseUrl: '',
    rerankModel: 'BAAI/bge-reranker-v2-m3',
    remoteServerUrl: '',
    apiKeySet: true,
    lllmApiKeySet: false,
    llmApiKeySet: false,
    vmApiKeySet: false,
    rerankApiKeySet: false,
    remoteServerTokenSet: false,
    profiles: {
      cloud: {
        provider: 'openai' as const, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
        lllmBaseUrl: '', lllmModel: 'deepseek-reasoner', llmBaseUrl: '', llmModel: 'deepseek-chat', vmBaseUrl: '',
        visionModel: 'qwen-vl-max', embeddingModel: 'text-embedding-3-small', remoteServerUrl: '',
        apiKeySet: true, lllmApiKeySet: false, llmApiKeySet: false, vmApiKeySet: false, rerankApiKeySet: false, remoteServerTokenSet: false
      },
      lan_gpu: {
        provider: 'openai' as const, baseUrl: 'http://192.168.1.20:8000/v1', model: 'Qwen3-14B',
        lllmBaseUrl: '', lllmModel: 'Qwen3-32B', llmBaseUrl: '', llmModel: 'Qwen3-14B', vmBaseUrl: '',
        visionModel: 'Qwen2.5-VL-7B', embeddingModel: 'BAAI/bge-m3', remoteServerUrl: '',
        apiKeySet: false, lllmApiKeySet: false, llmApiKeySet: false, vmApiKeySet: false, rerankApiKeySet: false, remoteServerTokenSet: false
      },
      local: {
        provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.5:9b',
        lllmBaseUrl: '', lllmModel: 'qwen3.5:9b', llmBaseUrl: '', llmModel: 'qwen3.5:9b', vmBaseUrl: '',
        visionModel: 'qwen2.5vl:7b', embeddingModel: '', remoteServerUrl: '',
        apiKeySet: false, lllmApiKeySet: false, llmApiKeySet: false, vmApiKeySet: false, rerankApiKeySet: false, remoteServerTokenSet: false
      }
    }
  }
  const isEn = (() => {
    try {
      return window.localStorage.getItem('zhixu-locale') === 'en'
    } catch {
      return false
    }
  })()

  const sources = isEn
    ? {
        gateway: {
          file: 'specs/API-Gateway-Rate-Limit-Policy-v2.md', locator: 'Section 3 · Token Bucket & Circuit Breaker',
          excerpt: 'Public API routes enforce 1200 req/min per tenant with a burst cap of 200. Upstream 5xx spikes above 5% for 30s trigger circuit opening.'
        },
        runbook: {
          file: 'ops/Production-Incident-Runbook.docx', locator: 'Section 2 · P1 Triage & Rollback',
          excerpt: 'For P1 latency regressions, verify gateway error rate and DB pool saturation first, then execute canary rollback within 10 minutes.'
        },
        backup: {
          file: 'infra/PostgreSQL-Backup-DR-Guide.pdf', locator: 'Page 14 · Point-in-Time Recovery',
          excerpt: 'Continuous WAL archiving targets RPO <= 60s and RTO <= 15m; quarterly restore drills validate checksums in an isolated staging cluster.'
        }
      }
    : {
        gateway: {
          file: '规范文档/API网关限流与熔断规范-v2.md', locator: '第三章 · 令牌桶与熔断策略',
          excerpt: '公网租户接口默认限流 1200 次/分钟（突发上限 200），上游 5xx 错误率连续 30 秒超过 5% 自动触发熔断降级。'
        },
        runbook: {
          file: '运维手册/生产集群故障应急处置规程.docx', locator: '第二节 · P1 定位与回滚',
          excerpt: '发生 P1 延迟抖动时优先核查网关错误率与数据库连接池水位，10 分钟内未收敛立即执行灰度回滚并保留现场日志。'
        },
        backup: {
          file: '架构资料/PostgreSQL备份与容灾演练报告.pdf', locator: '第 14 页 · 时间点恢复',
          excerpt: 'WAL 连续归档确保 RPO <= 60 秒、RTO <= 15 分钟；每季度在隔离预发环境执行全量恢复与校验和演练。'
        }
      }

  const initialPages: WikiPage[] = isEn
    ? [
        {
          slug: 'index', title: 'ZHIXU Knowledge Index', summary: 'Enterprise engineering standards, incident runbooks, and DR procedures.',
          content: '# ZHIXU Knowledge Index\n\nStructured, auditable engineering knowledge compiled from immutable local source files.\n\n## Core Topics\n\n- [API Gateway Rate-Limit Policy](api-gateway-ratelimit)\n- [Production Incident Runbook](k8s-incident-runbook)\n- [PostgreSQL Backup & DR SOP](postgres-backup-dr)\n\nEvery answer traces back to verified source excerpts with explicit applicability and gaps.',
          sources: [], links: ['api-gateway-ratelimit', 'k8s-incident-runbook', 'postgres-backup-dr'], updatedAt: iso(15), pageType: 'index', status: 'published', evidenceLevel: 'official_doc', applicability: 'Workspace overview', modelVersion: 'deepseek-reasoner', reviewedBy: 'zhixu', reviewedAt: iso(20), hasPublishedVersion: true, storageDomain: 'foundation', accessLevel: 'internal', versionLabel: 'V1.2', schemaEntities: ['ZHIXU', 'Engineering Standards']
        },
        {
          slug: 'api-gateway-ratelimit', title: 'API Gateway Rate-Limit Policy', summary: 'Tenant quotas, burst caps, and upstream 5xx circuit-breaker thresholds.',
          content: '## Rate-Limit Quotas\n\nPublic tenant routes enforce **1,200 req/min** sustained rate with a **200** burst cap via token bucket.\n\n## Circuit Breaker\n\n1. Monitor upstream 5xx error ratio across rolling 30-second windows.\n2. Open circuit when error rate exceeds **5%**; serve cached fallback or `503 Retry-After`.\n3. Probe half-open recovery with 10% traffic after 60 seconds.\n\n> Production overrides require security approval and changelog audit.',
          sources: [sources.gateway], links: ['k8s-incident-runbook'], updatedAt: iso(38), pageType: 'regulation', status: 'published', evidenceLevel: 'official_doc', applicability: 'All production edge gateways', modelVersion: 'deepseek-reasoner', reviewedBy: 'zhixu', reviewedAt: iso(35), hasPublishedVersion: true, storageDomain: 'domain_knowledge', accessLevel: 'internal', versionLabel: 'V2.1', schemaEntities: ['API Gateway', 'Rate Limit', 'Circuit Breaker']
        },
        {
          slug: 'k8s-incident-runbook', title: 'Production Incident Runbook', summary: 'P1 triage checklist, canary rollback window, and postmortem closure.',
          content: '## P1 Triage Steps\n\n1. Check gateway 5xx rate and p99 latency on the primary dashboard.\n2. Inspect PostgreSQL connection pool saturation and slow-query locks.\n3. Trigger canary rollback within **10 minutes** if mitigation does not converge.\n\n## Related Standards\n\nSee [API Gateway Rate-Limit Policy](api-gateway-ratelimit) for automatic breaker behavior.',
          sources: [sources.runbook], links: ['api-gateway-ratelimit'], updatedAt: iso(95), pageType: 'protocol', status: 'published', evidenceLevel: 'operational_doc', applicability: 'On-call SRE & backend teams', modelVersion: 'deepseek-chat', reviewedBy: 'reviewer01', reviewedAt: iso(90), hasPublishedVersion: true, storageDomain: 'cases', accessLevel: 'internal', versionLabel: 'V1.4', schemaEntities: ['P1 Incident', 'Canary Rollback', 'SRE']
        },
        {
          slug: 'postgres-backup-dr', title: 'PostgreSQL Backup & DR SOP', summary: 'WAL archiving targets (RPO <= 60s, RTO <= 15m) and quarterly restore drills.',
          content: '## Recovery Objectives\n\n- **RPO**: <= 60 seconds via continuous WAL archiving.\n- **RTO**: <= 15 minutes using warm standby promotion.\n\n## Quarterly Validation\n\nRun automated checksum verification in an isolated staging cluster before signing off quarterly compliance.\n\n## Review Note\n\nAuto-compiled from DR drill report; verify cluster storage quotas before publishing.',
          sources: [sources.backup], links: ['k8s-incident-runbook'], updatedAt: iso(8), pageType: 'case', status: 'moderating', evidenceLevel: 'field_record', applicability: 'Primary relational databases', modelVersion: 'deepseek-reasoner', reviewedBy: null, reviewedAt: null, hasPublishedVersion: false, storageDomain: 'cases', accessLevel: 'internal', versionLabel: 'V0.3', workflowNote: 'Pending SRE moderation', schemaEntities: ['PostgreSQL', 'WAL Archiving', 'Disaster Recovery']
        }
      ]
    : [
        {
          slug: 'index', title: '知序知识导览', summary: '汇集研发规范、运维应急规程与容灾实践的企业知识入口。',
          content: '# 知序知识导览\n\n这里沉淀研发架构规范、生产应急处置与数据库容灾演练知识。\n\n## 推荐入口\n\n- [API 网关限流与熔断规范](api-gateway-ratelimit)\n- [生产集群故障应急处置规程](k8s-incident-runbook)\n- [PostgreSQL 备份与容灾方案](postgres-backup-dr)\n\n所有回答都可追溯至原始依据，并明确适用条件与待核查缺口。',
          sources: [], links: ['api-gateway-ratelimit', 'k8s-incident-runbook', 'postgres-backup-dr'], updatedAt: iso(15), pageType: 'index', status: 'published', evidenceLevel: 'official_doc', applicability: '知识库导览', modelVersion: 'deepseek-reasoner', reviewedBy: 'zhixu', reviewedAt: iso(20), hasPublishedVersion: true, storageDomain: 'foundation', accessLevel: 'internal', versionLabel: 'V1.2', schemaEntities: ['知序知识库', '研发规范']
        },
        {
          slug: 'api-gateway-ratelimit', title: 'API 网关限流与熔断规范', summary: '租户限流配额、突发上限与上游 5xx 熔断降级阈值规范。',
          content: '## 限流配额\n\n公网租户接口默认按令牌桶执行 **1200 次/分钟** 稳态限流，突发上限 **200**。\n\n## 熔断策略\n\n1. 按 30 秒滑动窗口监控上游 5xx 错误率。\n2. 错误率超过 **5%** 自动触发熔断，返回降级缓存或 `503 Retry-After`。\n3. 60 秒后进入半开状态，放行 10% 探针流量验证恢复。\n\n> 生产环境配额调整须经安全评审并留痕。',
          sources: [sources.gateway], links: ['k8s-incident-runbook'], updatedAt: iso(38), pageType: 'regulation', status: 'published', evidenceLevel: 'official_doc', applicability: '生产边缘网关', modelVersion: 'deepseek-reasoner', reviewedBy: 'zhixu', reviewedAt: iso(35), hasPublishedVersion: true, storageDomain: 'domain_knowledge', accessLevel: 'internal', versionLabel: 'V2.1', schemaEntities: ['API 网关', '令牌桶限流', '熔断降级']
        },
        {
          slug: 'k8s-incident-runbook', title: '生产集群故障应急处置规程', summary: 'P1 故障排查顺序、10 分钟灰度回滚红线与复盘闭环流程。',
          content: '## P1 排查顺序\n\n1. 优先查看主看板网关 5xx 错误率与 p99 延迟变化。\n2. 核查 PostgreSQL 连接池水位与慢查询锁等待。\n3. 若 **10 分钟** 内未收敛，立即执行灰度回滚并保留现场日志。\n\n关联规范：[API 网关限流与熔断规范](api-gateway-ratelimit)。',
          sources: [sources.runbook], links: ['api-gateway-ratelimit'], updatedAt: iso(95), pageType: 'protocol', status: 'published', evidenceLevel: 'operational_doc', applicability: '值班 SRE 与后端团队', modelVersion: 'deepseek-chat', reviewedBy: 'reviewer01', reviewedAt: iso(90), hasPublishedVersion: true, storageDomain: 'cases', accessLevel: 'internal', versionLabel: 'V1.4', schemaEntities: ['P1 故障', '灰度回滚', 'SRE']
        },
        {
          slug: 'postgres-backup-dr', title: 'PostgreSQL 备份与容灾方案', summary: 'WAL 连续归档指标（RPO <= 60s、RTO <= 15m）与季度演练要求。',
          content: '## 容灾目标\n\n- **RPO**：借助 WAL 连续归档控制在 60 秒以内。\n- **RTO**：通过热备切换控制在 15 分钟以内。\n\n## 季度恢复演练\n\n每季度在隔离预发环境自动执行全量恢复与校验和比对，归档演练记录。\n\n## 待审核说明\n\n本页由容灾演练报告自动整理，请核对最新存储配额后审批发布。',
          sources: [sources.backup], links: ['k8s-incident-runbook'], updatedAt: iso(8), pageType: 'case', status: 'moderating', evidenceLevel: 'field_record', applicability: '核心关系型数据库', modelVersion: 'deepseek-reasoner', reviewedBy: null, reviewedAt: null, hasPublishedVersion: false, storageDomain: 'cases', accessLevel: 'internal', versionLabel: 'V0.3', workflowNote: '等待 SRE 初审', schemaEntities: ['PostgreSQL', 'WAL 归档', '容灾恢复']
        }
      ]

  let snapshot: WorkspaceSnapshot = {
    root: isEn ? 'demo-enterprise-kb' : '演示知识库 · 企业研发', modelProvider, models: ['deepseek-chat', 'deepseek-reasoner', 'qwen-vl-max'], modelOnline: true,
    deploymentMode: 'cloud', remoteConnected: false, fileCount: 3, pendingCount: 0, draftCount: 1, pendingDeleteCount: 0, deletedCount: 0, publishedCount: 2,
    chunkCount: 86, entityCount: 12, mutualLinkCount: 18, cachedEmbeddingCount: 86,
    adminAuth: {
      authenticated: false,
      user: null,
      users: [],
      serverAuthEnforced: true
    },
    sourceFiles: [
      { path: sources.gateway.file, size: 386_240, mtime: now - 40 * 60_000, indexed: true, mediaKind: 'document' },
      { path: sources.runbook.file, size: 1_260_480, mtime: now - 96 * 60_000, indexed: true, mediaKind: 'document' },
      { path: sources.backup.file, size: 4_285_600, mtime: now - 9 * 60_000, indexed: true, mediaKind: 'document' }
    ],
    pages: initialPages,
    runs: [{
      id: 'demo-run-1', createdAt: iso(110), summary: isEn ? 'Compiled enterprise engineering docs\nGenerated 3 wiki pages' : '整理企业研发资料\n生成 3 个知识页面', model: 'deepseek-reasoner', filesChanged: 3, changesCount: 3, undone: false, gitCommit: '8e3f7b29a164',
      changes: initialPages.slice(1).map(page => ({ slug: page.slug, title: page.title, action: 'create' as const }))
    }],
    modelCalls: [
      { id: 'call-1', createdAt: iso(37), taskType: isEn ? 'Wiki Compile' : '知识整理', provider: 'OpenAI-API', model: 'deepseek-reasoner', durationMs: 2840, status: 'ok', detail: isEn ? 'Verified excerpts & scope' : '保留引用与适用范围' },
      { id: 'call-2', createdAt: iso(108), taskType: isEn ? 'Entity Index' : '实体关联', provider: 'OpenAI-API', model: 'text-embedding-3-small', durationMs: 468, status: 'ok', detail: isEn ? 'Built 18 mutual links' : '建立 18 条双向关联' }
    ], feedbacks: []
  }
  const listeners = new Set<(event: ProgressEvent) => void>()
  const importedText = new Map<string, string>()
  let cancelRequested = false
  let sequence = 1
  const clone = <T,>(value: T): T => structuredClone(value)
  const pause = (ms = 220) => new Promise(resolve => setTimeout(resolve, ms))
  const emit = (event: ProgressEvent) => listeners.forEach(listener => listener(event))
  const refreshCounts = () => {
    const contentPages = snapshot.pages.filter(page => page.slug !== 'index')
    snapshot.fileCount = snapshot.sourceFiles.length
    snapshot.pendingCount = snapshot.sourceFiles.filter(file => !file.indexed).length
    snapshot.draftCount = contentPages.filter(page => ['draft', 'moderating', 'validating'].includes(page.status)).length
    snapshot.publishedCount = contentPages.filter(page => page.status === 'published').length
  }
  const keywords: Record<string, string> = {
    'api-gateway-ratelimit': 'api gateway rate limit circuit breaker 5xx 限流 熔断 网关 令牌桶',
    'k8s-incident-runbook': 'incident p1 rollback canary sre kubernetes 故障 回滚 应急 排查',
    'postgres-backup-dr': 'postgres postgresql wal rpo rto backup dr 备份 容灾 数据库 恢复'
  }
  const queryScore = (page: WikiPage, query: string) => {
    const haystack = `${page.title} ${page.summary} ${page.content} ${keywords[page.slug] ?? ''}`.toLowerCase()
    const normalized = query.trim().toLowerCase()
    if (!normalized) return 0
    if (haystack.includes(normalized)) return 20
    const tokens = normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9]+/giu) ?? []
    return tokens.reduce((score, token) => score + (haystack.includes(token) ? 4 : 0), 0) +
      [...new Set(normalized.replace(/\s/g, ''))].reduce((score, char) => score + (/[\p{Script=Han}]/u.test(char) && haystack.includes(char) ? 0.6 : 0), 0)
  }
  const search = (query: string, options?: { includeDrafts?: boolean; includeSources?: boolean; domain?: StorageDomain }): SearchHit[] => {
    const hits = snapshot.pages.filter(page => page.slug !== 'index')
      .filter(page => options?.includeDrafts || page.status === 'published')
      .filter(page => !options?.domain || page.storageDomain === options.domain)
      .map(page => ({ page, score: queryScore(page, query) })).filter(item => item.score > 1)
      .sort((a, b) => b.score - a.score)
      .map(({ page, score }): SearchHit => ({
        id: `demo-hit-${page.slug}`, kind: 'wiki', slug: page.slug, title: page.title,
        snippet: page.summary, score: Number(Math.min(.99, .62 + score / 100).toFixed(2)), status: page.status,
        pageType: page.pageType, evidenceLevel: page.evidenceLevel, storageDomain: page.storageDomain, reranked: true,
        matchedEntities: page.schemaEntities?.slice(0, 3)
      }))
    if (options?.includeSources && hits.length) {
      const page = snapshot.pages.find(item => item.slug === hits[0].slug)
      const source = page?.sources[0]
      if (source) hits.push({ id: `demo-chunk-${hits[0].slug}`, kind: 'chunk', file: source.file, locator: source.locator, headingPath: ['原始资料'], title: source.file.split('/').pop() ?? source.file, snippet: source.excerpt, score: .78, status: 'raw', storageDomain: page.storageDomain })
    }
    return hits
  }
  const lint = (): WikiLintReport => {
    const contentPages = snapshot.pages.filter(page => page.slug !== 'index')
    const issues = contentPages.flatMap(page => {
      const result = []
      if (!page.sources.length) result.push({ id: `source-${page.slug}`, severity: 'error' as const, category: 'no_sources' as const, slug: page.slug, title: page.title, message: '本页缺少可核验的原始依据。' })
      if (page.status !== 'published' && page.status !== 'archived') result.push({ id: `draft-${page.slug}`, severity: 'info' as const, category: 'draft_backlog' as const, slug: page.slug, title: page.title, message: '页面正在审核流程中，发布后才参与默认问答。' })
      const broken = page.links.find(link => !snapshot.pages.some(item => item.slug === link))
      if (broken) result.push({ id: `link-${page.slug}`, severity: 'warning' as const, category: 'broken_link' as const, slug: page.slug, title: page.title, message: `关联页面 ${broken} 不存在，可执行安全修复。` })
      return result
    })
    return { checkedAt: new Date().toISOString(), totalPages: contentPages.length, publishedCount: snapshot.publishedCount, draftCount: snapshot.draftCount, issues }
  }
  const transition = (page: WikiPage, action: WorkflowAction) => {
    const next: Partial<Record<WorkflowAction, WikiPage['status']>> = {
      submit_moderation: 'moderating', refuse_moderation: 'draft', submit_validation: 'validating', refuse_validation: 'draft',
      publish: 'published', unpublish: 'draft', archive: 'archived', publish_from_archive: 'published'
    }
    page.status = next[action] ?? page.status
    page.updatedAt = new Date().toISOString()
    if (page.status === 'published') { page.reviewedBy = '演示审核员'; page.reviewedAt = new Date().toISOString(); page.hasPublishedVersion = true }
  }

  return {
    getSnapshot: async () => { await pause(120); return clone(snapshot) },
    selectWorkspace: async () => null,
    importDroppedFiles: async (files: File[]): Promise<ImportFilesResult> => {
      await pause()
      const imported: string[] = []
      const skipped: string[] = []
      for (const file of files) {
        if (!/\.(pdf|docx|md|markdown|txt|html?|csv|json|ya?ml|png|jpe?g|webp)$/i.test(file.name)) { skipped.push(`${file.name}（不支持的文件格式）`); continue }
        if (snapshot.sourceFiles.some(item => item.path === file.name)) { skipped.push(`${file.name}（已存在）`); continue }
        imported.push(file.name)
        snapshot.sourceFiles.unshift({ path: file.name, size: file.size, mtime: file.lastModified || Date.now(), indexed: false, mediaKind: /\.(png|jpe?g|webp)$/i.test(file.name) ? 'image' : 'document' })
        if (/\.(md|markdown|txt)$/i.test(file.name)) importedText.set(file.name, await file.text())
      }
      refreshCounts()
      return { imported, skipped, snapshot: clone(snapshot) }
    },
    removeSource: async file => {
      snapshot.sourceFiles = snapshot.sourceFiles.filter(item => item.path !== file)
      refreshCounts(); return clone(snapshot)
    },
    organize: async (): Promise<OrganizeResult> => {
      cancelRequested = false
      const pending = snapshot.sourceFiles.filter(file => !file.indexed)
      if (!pending.length) return { status: 'unchanged', message: '资料没有变化，无需重新整理', snapshot: clone(snapshot) }
      const created: { slug: string; title: string; action: 'create' | 'update' }[] = []
      const stages: ProgressEvent['stage'][] = ['scan', 'chunk', 'notes', 'schema', 'wiki', 'save']
      for (let index = 0; index < stages.length; index += 1) {
        emit({ stage: stages[index], message: ['扫描资料与变更', '切分原文并保留定位', '提取主题知识', '建立实体与双向关联', '生成待审核知识页面', '保存版本与整理记录'][index], current: index + 1, total: stages.length })
        await pause(260)
        if (cancelRequested) return { status: 'cancelled', message: '已取消整理，原始资料与现有页面未改变', snapshot: clone(snapshot) }
      }
      for (const file of pending) {
        const base = file.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '新资料'
        const slug = `imported-${Date.now()}-${sequence++}`
        const excerpt = importedText.get(file.path)?.trim().slice(0, 180) || `已从 ${file.path} 提取资料，当前为演示预览生成的待审核知识。`
        snapshot.pages.unshift({
          slug, title: base, summary: excerpt.slice(0, 100), content: `## 资料摘要\n\n${excerpt}\n\n## 审核提示\n\n请核对原文、补充适用范围后发布。`, sources: [{ file: file.path, locator: '全文 · 自动定位', excerpt }], links: ['index'], updatedAt: new Date().toISOString(), pageType: 'synthesis', status: 'draft', evidenceLevel: 'synthesis_draft', applicability: '待人工核验', modelVersion: snapshot.modelProvider.model, reviewedBy: null, reviewedAt: null, hasPublishedVersion: false, storageDomain: 'domain_knowledge', accessLevel: 'internal', versionLabel: 'V0.1', schemaEntities: ['新增资料']
        })
        file.indexed = true
        created.push({ slug, title: base, action: 'create' })
      }
      snapshot.chunkCount += pending.length * 9
      snapshot.entityCount += pending.length
      snapshot.mutualLinkCount += pending.length * 2
      snapshot.runs.unshift({ id: `demo-run-${Date.now()}`, createdAt: new Date().toISOString(), summary: `整理 ${pending.length} 份新资料\n生成 ${created.length} 个待审核页面`, model: snapshot.modelProvider.model, filesChanged: pending.length, changesCount: created.length, undone: false, gitCommit: 'demo9a7c42e8', changes: created })
      snapshot.modelCalls.unshift({ id: `call-${Date.now()}`, createdAt: new Date().toISOString(), taskType: '知识整理', provider: 'Ollama', model: snapshot.modelProvider.model, durationMs: 1560, status: 'ok', detail: '演示流程完成' })
      refreshCounts()
      return { status: 'completed', message: `整理完成：新增 ${created.length} 个页面，已进入审核中心`, snapshot: clone(snapshot) }
    },
    cancelOrganize: async () => { cancelRequested = true },
    undoRun: async runId => {
      const run = snapshot.runs.find(item => item.id === runId)
      if (run && !run.undone) {
        run.undone = true
        const createdSlugs = run.changes.filter(change => change.action === 'create').map(change => change.slug)
        snapshot.pages = snapshot.pages.filter(page => !createdSlugs.includes(page.slug) || page.slug === 'postgres-backup-dr' || page.slug === 'api-gateway-ratelimit' || page.slug === 'k8s-incident-runbook')
        refreshCounts()
      }
      return clone(snapshot)
    },
    saveManualPage: async input => {
      const slug = input.slug || `note-${Date.now()}`
      const now = new Date().toISOString()
      const idx = snapshot.pages.findIndex(p => p.slug === slug)
      const next: WikiPage = {
        slug,
        title: input.title.trim(),
        summary: input.summary.trim() || input.content.slice(0, 80),
        content: input.content,
        sources: input.sources ?? (idx >= 0 ? snapshot.pages[idx].sources : []),
        links: idx >= 0 ? snapshot.pages[idx].links : [],
        updatedAt: now,
        pageType: input.pageType ?? (idx >= 0 ? snapshot.pages[idx].pageType : 'concept'),
        status: input.publishImmediately ? 'published' : 'draft',
        evidenceLevel: 'field_record',
        applicability: input.applicability ?? '人工维护',
        modelVersion: 'manual:zhixu',
        reviewedBy: input.publishImmediately ? 'zhixu' : null,
        reviewedAt: input.publishImmediately ? now : null,
        storageDomain: input.storageDomain ?? 'foundation',
        versionLabel: input.publishImmediately ? 'V1.0' : 'V0.1'
      }
      if (idx >= 0) snapshot.pages[idx] = next
      else snapshot.pages.push(next)
      refreshCounts()
      return { slug, snapshot: clone(snapshot) }
    },
    publishPage: async slug => {
      const page = snapshot.pages.find(item => item.slug === slug); if (page) transition(page, 'publish')
      refreshCounts(); return clone(snapshot)
    },
    publishAllDrafts: async () => {
      snapshot.pages.forEach(page => { if (['draft', 'moderating', 'validating'].includes(page.status)) transition(page, 'publish') })
      refreshCounts(); return clone(snapshot)
    },
    transitionWorkflow: async (slug, action) => {
      const page = snapshot.pages.find(item => item.slug === slug); if (page) transition(page, action)
      refreshCounts(); return clone(snapshot)
    },
    purgeDeletedPage: async slug => {
      snapshot.pages = snapshot.pages.filter(item => item.slug !== slug)
      refreshCounts(); return clone(snapshot)
    },
    listPageVersions: async (slug): Promise<PageVersionSnapshot[]> => {
      const page = snapshot.pages.find(item => item.slug === slug)
      return page ? [
        { id: 'version-current', slug, versionLabel: page.versionLabel ?? 'V1.0', status: page.status === 'published' ? 'published' : 'candidate', createdAt: page.updatedAt, createdBy: page.reviewedBy ?? '知序 ZHIXU', note: '当前工作版本', evalScore: 92, evalNote: '引用完整', title: page.title, summary: page.summary },
        { id: 'version-previous', slug, versionLabel: 'V1.0', status: 'archived', createdAt: iso(1440), createdBy: '知识管理员', note: '首次发布基线', evalScore: 88, evalNote: '人工审核通过', title: page.title, summary: page.summary }
      ] : []
    },
    rollbackPageVersion: async (slug, versionLabel) => {
      const page = snapshot.pages.find(item => item.slug === slug)
      if (page) { page.versionLabel = versionLabel; page.updatedAt = new Date().toISOString(); page.status = 'draft'; page.workflowNote = '由历史版本回滚，需重新审核' }
      refreshCounts(); return clone(snapshot)
    },
    getPageDiff: async (slug): Promise<PageDiffResult> => ({ slug, hasBaseline: true, addedLines: 2, removedLines: 1, hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' ## 核心要点', '-按通用描述整理。', '+保留原文定位和适用范围。', '+发布前由业务人员完成审核。'] }] }),
    runLint: async () => { await pause(180); return lint() },
    fixLint: async (): Promise<WikiLintFixResult> => {
      let filesChanged = 0
      snapshot.pages.forEach(page => {
        const valid = page.links.filter(link => snapshot.pages.some(item => item.slug === link))
        if (valid.length !== page.links.length) { page.links = valid; filesChanged += 1 }
      })
      return { filesChanged, ghostLinksStripped: filesChanged, canonicalizedLinks: 0, report: lint() }
    },
    getSchemaOverview: async (): Promise<SchemaOverview> => {
      const entities: SchemaEntityRecord[] = isEn
        ? [
            { id: 'entity-gateway', name: 'API Gateway', spgType: 'ConceptType', storageDomain: 'domain_knowledge', description: 'Edge traffic throttling and upstream circuit breaker controls', chunkCount: 12, wikiSlugs: ['api-gateway-ratelimit', 'k8s-incident-runbook'] },
            { id: 'entity-sre', name: 'P1 Incident', spgType: 'StandardType', storageDomain: 'cases', description: 'Production incident triage and canary rollback procedure', chunkCount: 9, wikiSlugs: ['k8s-incident-runbook'] },
            { id: 'entity-pg', name: 'PostgreSQL DR', spgType: 'ConceptType', storageDomain: 'cases', description: 'Continuous WAL archiving and quarterly recovery validation', chunkCount: 16, wikiSlugs: ['postgres-backup-dr'] }
          ]
        : [
            { id: 'entity-gateway', name: 'API 网关', spgType: 'ConceptType', storageDomain: 'domain_knowledge', description: '边缘限流配额与上游熔断降级控制', chunkCount: 12, wikiSlugs: ['api-gateway-ratelimit', 'k8s-incident-runbook'] },
            { id: 'entity-sre', name: 'P1 故障', spgType: 'StandardType', storageDomain: 'cases', description: '生产集群故障排查顺序与灰度回滚闭环', chunkCount: 9, wikiSlugs: ['k8s-incident-runbook'] },
            { id: 'entity-pg', name: 'PostgreSQL 容灾', spgType: 'ConceptType', storageDomain: 'cases', description: 'WAL 连续归档与季度恢复校验演练', chunkCount: 16, wikiSlugs: ['postgres-backup-dr'] }
          ]
      return { domainCounts: { foundation: 1, domain_knowledge: snapshot.pages.filter(page => page.storageDomain === 'domain_knowledge').length, cases: 2, concrete_media: 3, permissions: 1, versions: snapshot.pages.length * 2 }, chunkCount: snapshot.chunkCount, entityCount: snapshot.entityCount, mutualLinkCount: snapshot.mutualLinkCount, entities }
    },
    searchKnowledge: async (query, options) => { await pause(420); return clone(search(query, options)) },
    askKnowledge: async (question, options): Promise<KnowledgeQueryResult> => {
      await pause(720)
      const hits = search(question, options)
      const wikiHits = hits.filter(hit => hit.kind === 'wiki').slice(0, 2)
      const pages = wikiHits.map(hit => snapshot.pages.find(page => page.slug === hit.slug)).filter((page): page is WikiPage => Boolean(page))
      const citations = pages.flatMap(page => page.sources.map((source, index) => ({ label: `[${index + 1}] ${page.title}`, kind: 'wiki' as const, slug: page.slug, file: source.file, locator: source.locator, excerpt: source.excerpt })))
      return {
        conclusion: pages.length ? `根据当前已发布的知识，${pages.map(page => `《${page.title}》指出：${page.summary.replace(/[。；]+$/, '')}`).join('；')}。实际执行时应以对应的批复文件、属地制度和项目设计为准。` : '当前知识范围内没有找到足够依据，暂不生成确定性结论。请调整关键词、扩大检索范围，或先导入并整理相关资料。',
        applicability: pages.length ? [...new Set(pages.map(page => page.applicability))].join('；') : '证据不足，无法判断适用条件。',
        citations, conflicts: pages.length > 1 ? '不同资料的管理层级与适用场景可能不同，应分别核验。' : '当前证据中未发现明显冲突。',
        missingInfo: '具体数值、时间和责任主体仍需查阅原文确认。', knowledgeVersion: `演示知识快照 · ${new Date().toLocaleDateString('zh-CN')}`,
        insufficientEvidence: !pages.length, hits
      }
    },
    submitFeedback: async entry => {
      snapshot.feedbacks.unshift({ id: `feedback-${Date.now()}`, createdAt: new Date().toISOString(), ...entry })
      return clone(snapshot)
    },
    setModel: async (settings: ModelProviderSettings) => {
      const mode = settings.mode ?? 'local'
      const current = snapshot.modelProvider.profiles[mode]
      const nextProfile = {
        ...current,
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model || current.model,
        visionModel: settings.visionModel ?? current.visionModel,
        embeddingModel: settings.embeddingModel ?? current.embeddingModel,
        rerankBaseUrl: settings.rerankBaseUrl ?? current.rerankBaseUrl,
        rerankModel: settings.rerankModel ?? current.rerankModel,
        remoteServerUrl: settings.remoteServerUrl ?? current.remoteServerUrl,
        apiKeySet: Boolean(settings.apiKey) || current.apiKeySet,
        rerankApiKeySet: Boolean(settings.rerankApiKey) || current.rerankApiKeySet,
        remoteServerTokenSet: Boolean(settings.remoteServerToken) || current.remoteServerTokenSet
      }
      snapshot.modelProvider = { ...snapshot.modelProvider, ...nextProfile, mode, profiles: { ...snapshot.modelProvider.profiles, [mode]: nextProfile } }
      snapshot.deploymentMode = mode
      snapshot.models = settings.provider === 'ollama' ? ['qwen3:14b', 'qwen2.5vl:7b', 'BAAI/bge-m3'] : [nextProfile.model]
      return clone(snapshot)
    },
    refreshModels: async () => { await pause(300); snapshot.modelOnline = true; return clone(snapshot) },
    openSource: async file => {
      const page = snapshot.pages.find(item => item.sources.some(source => source.file === file))
      const text = page?.sources.find(source => source.file === file)?.excerpt ?? importedText.get(file) ?? `演示资料：${file}`
      const url = URL.createObjectURL(new Blob([`${file}\n\n${text}`], { type: 'text/plain;charset=utf-8' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${file.split('/').pop() ?? 'source'}.txt`; anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    adminLogin: async (username, password) => {
      if (username !== 'zhixu' || password !== '123456789') throw new Error('管理员账号或密码错误')
      const user = { username: 'zhixu', role: 'superadmin' as const, createdAt: iso(1440), lastLoginAt: new Date().toISOString() }
      snapshot.adminAuth = { authenticated: true, user, users: [user], serverAuthEnforced: true }
      return clone(snapshot)
    },
    adminLogout: async () => {
      snapshot.adminAuth = { authenticated: false, user: null, users: [], serverAuthEnforced: true }
      return clone(snapshot)
    },
    adminChangePassword: async () => clone(snapshot),
    adminCreateUser: async (username, _password, role) => {
      snapshot.adminAuth.users.push({ username, role, createdAt: new Date().toISOString(), lastLoginAt: null })
      return clone(snapshot)
    },
    adminDeleteUser: async username => {
      snapshot.adminAuth.users = snapshot.adminAuth.users.filter(u => u.username !== username)
      return clone(snapshot)
    },
    onProgress: listener => { listeners.add(listener); return () => listeners.delete(listener) }
  }
}
