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
  const sources = {
    flow: {
      file: '政策规范/河湖生态流量保障实施方案.md', locator: '第三章 · 生态流量保障',
      excerpt: '以保障河湖基本生态用水为目标，明确控制断面、目标水位与监测要求，建立预警和调度机制。'
    },
    river: {
      file: '业务资料/河湖长制工作手册.docx', locator: '第二节 · 巡河与问题处置',
      excerpt: '巡河发现的问题应记录位置、时间与现场情况，按职责分派、限期整改并留存复核材料。'
    },
    wetland: {
      file: '项目资料/湿地修复案例集.pdf', locator: '第 12 页 · 近自然修复',
      excerpt: '修复措施应优先保护原有水文过程，采用本地植物群落，减少硬质工程对生境的扰动。'
    }
  }
  const initialPages: WikiPage[] = [
    {
      slug: 'index', title: '知序知识导览', summary: '从生态保护到修复实践，连接制度、技术与案例。',
      content: '# 知序知识导览\n\n这里沉淀河湖治理、湿地修复与生态价值实现的业务知识。\n\n## 推荐入口\n\n- [河湖生态流量保障](ecological-flow)\n- [河湖长巡河工作规程](river-chief)\n- [湿地近自然修复](wetland-restoration)\n\n所有回答都应能回到原始依据，并明确适用条件与待核查信息。',
      sources: [], links: ['ecological-flow', 'river-chief', 'wetland-restoration'], updatedAt: iso(15), pageType: 'index', status: 'published', evidenceLevel: 'official_doc', applicability: '知识库导览', modelVersion: 'qwen3:14b', reviewedBy: '知识管理员', reviewedAt: iso(20), hasPublishedVersion: true, storageDomain: 'foundation', accessLevel: 'internal', versionLabel: 'V1.2', schemaEntities: ['知序知识库', '生态系统']
    },
    {
      slug: 'ecological-flow', title: '河湖生态流量保障', summary: '控制断面、目标水位、监测预警与生态调度的业务要点。',
      content: '## 保障目标\n\n保障河湖基本生态用水，维持河道连通性和必要的生态水文过程。\n\n## 实施要点\n\n1. 明确控制断面与保障目标。\n2. 建立日常监测、阈值预警和信息报送机制。\n3. 统筹生活、生产与生态用水，按预案开展生态调度。\n\n> 具体目标值应以批复文件和属地管理要求为准，不能由通用知识页替代。',
      sources: [sources.flow], links: ['river-chief'], updatedAt: iso(38), pageType: 'regulation', status: 'published', evidenceLevel: 'official_doc', applicability: '纳入生态流量保障范围的河湖', modelVersion: 'qwen3:14b', reviewedBy: '知识管理员', reviewedAt: iso(35), hasPublishedVersion: true, storageDomain: 'domain_knowledge', accessLevel: 'internal', versionLabel: 'V2.1', schemaEntities: ['生态流量', '控制断面', '生态调度']
    },
    {
      slug: 'river-chief', title: '河湖长巡河工作规程', summary: '从现场记录到任务分派、整改复核的闭环处置流程。',
      content: '## 巡河记录\n\n记录时间、河段、问题位置、现场描述和影像资料，确保问题可以定位与复核。\n\n## 闭环处置\n\n- 按职责分派问题并明确办理时限。\n- 整改完成后上传前后对比材料。\n- 复核未通过的事项退回继续办理。\n\n关联知识：[河湖生态流量保障](ecological-flow)。',
      sources: [sources.river], links: ['ecological-flow'], updatedAt: iso(95), pageType: 'protocol', status: 'published', evidenceLevel: 'operational_doc', applicability: '日常巡河与问题交办', modelVersion: 'qwen3:14b', reviewedBy: '业务审核员', reviewedAt: iso(90), hasPublishedVersion: true, storageDomain: 'cases', accessLevel: 'internal', versionLabel: 'V1.4', schemaEntities: ['河湖长制', '巡河', '整改闭环']
    },
    {
      slug: 'wetland-restoration', title: '湿地近自然修复', summary: '水文过程优先、乡土植物配置与低扰动修复的案例经验。',
      content: '## 修复原则\n\n先诊断水文条件和退化原因，再确定保护、自然恢复或辅助修复措施。\n\n## 案例经验\n\n优先保留原有地形和水系，选用适地乡土植物，控制硬质铺装及过度景观化。\n\n## 待审核说明\n\n本页由案例资料自动整理，技术指标须结合项目设计文件核验后使用。',
      sources: [sources.wetland], links: ['ecological-flow'], updatedAt: iso(8), pageType: 'case', status: 'moderating', evidenceLevel: 'field_record', applicability: '退化湿地方案比选；非设计替代文件', modelVersion: 'qwen3:14b', reviewedBy: null, reviewedAt: null, hasPublishedVersion: false, storageDomain: 'cases', accessLevel: 'internal', versionLabel: 'V0.3', workflowNote: '等待业务初审', schemaEntities: ['湿地修复', '水文过程', '乡土植物']
    }
  ]
  let snapshot: WorkspaceSnapshot = {
    root: '演示知识库 · 知序主题', modelProvider, models: ['deepseek-chat', 'deepseek-reasoner', 'qwen-vl-max'], modelOnline: true,
    deploymentMode: 'cloud', remoteConnected: false, fileCount: 3, pendingCount: 0, draftCount: 1, pendingDeleteCount: 0, deletedCount: 0, publishedCount: 2,
    chunkCount: 86, entityCount: 12, mutualLinkCount: 18, cachedEmbeddingCount: 86,
    adminAuth: {
      authenticated: false,
      user: null,
      users: [],
      serverAuthEnforced: true
    },
    sourceFiles: [
      { path: sources.flow.file, size: 386_240, mtime: now - 40 * 60_000, indexed: true, mediaKind: 'document' },
      { path: sources.river.file, size: 1_260_480, mtime: now - 96 * 60_000, indexed: true, mediaKind: 'document' },
      { path: sources.wetland.file, size: 4_285_600, mtime: now - 9 * 60_000, indexed: true, mediaKind: 'document' }
    ],
    pages: initialPages,
    runs: [{
      id: 'demo-run-1', createdAt: iso(110), summary: '整理知序主题资料\n生成 3 个知识页面', model: 'qwen3:14b', filesChanged: 3, changesCount: 3, undone: false, gitCommit: '8e3f7b29a164',
      changes: initialPages.slice(1).map(page => ({ slug: page.slug, title: page.title, action: 'create' as const }))
    }],
    modelCalls: [
      { id: 'call-1', createdAt: iso(37), taskType: '知识整理', provider: 'Ollama', model: 'qwen3:14b', durationMs: 2840, status: 'ok', detail: '保留引用与适用范围' },
      { id: 'call-2', createdAt: iso(108), taskType: '实体关联', provider: 'Ollama', model: 'BAAI/bge-m3', durationMs: 468, status: 'ok', detail: '建立 18 条双向关联' }
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
    'ecological-flow': '生态 流量 水位 补水 调度 监测 预警 断面 河湖 用水',
    'river-chief': '河湖长 巡河 巡查 问题 整改 复核 分派 闭环 河段',
    'wetland-restoration': '湿地 修复 生境 水文 植物 近自然 案例 退化'
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
        snapshot.pages = snapshot.pages.filter(page => !createdSlugs.includes(page.slug) || page.slug === 'wetland-restoration' || page.slug === 'ecological-flow' || page.slug === 'river-chief')
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
      const entities: SchemaEntityRecord[] = [
        { id: 'entity-flow', name: '生态流量', spgType: 'ConceptType', storageDomain: 'domain_knowledge', description: '维持河湖生态系统所需的水量与水文过程', chunkCount: 12, wikiSlugs: ['ecological-flow', 'river-chief'] },
        { id: 'entity-river', name: '河湖长制', spgType: 'StandardType', storageDomain: 'cases', description: '河湖管理保护与问题闭环处置制度', chunkCount: 9, wikiSlugs: ['river-chief'] },
        { id: 'entity-wetland', name: '湿地修复', spgType: 'ConceptType', storageDomain: 'cases', description: '以水文恢复和生境改善为核心的修复实践', chunkCount: 16, wikiSlugs: ['wetland-restoration'] }
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
