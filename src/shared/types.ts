export type SourceReference = {
  file: string
  locator: string
  excerpt: string
}

export type WikiPageType =
  | 'concept'
  | 'synthesis'
  | 'protocol'
  | 'regulation'
  | 'ops'
  | 'entity'
  | 'case'
  | 'pond'
  | 'index'

/**
 * Six central storage domains:
 * 权限 / 基础 / 案例 / 具体+图+元数据 / 专业知识 / 版本
 */
export type StorageDomain =
  | 'permissions'
  | 'foundation'
  | 'cases'
  | 'concrete_media'
  | 'domain_knowledge'
  | 'versions'

export type AccessLevel = 'public' | 'internal' | 'restricted'

export type SpgTypeKind = 'EntityType' | 'ConceptType' | 'EventType' | 'IndexType' | 'StandardType'

/**
 * XWiki PublicationWorkflow states + deletion approval & recycle bin:
 * draft -> moderating -> validating -> published -> archived
 * AI delete suggestion -> pending_delete -> (confirm_delete) deleted | (reject_delete) draft/published
 */
export type WikiPageStatus =
  | 'draft'
  | 'moderating'
  | 'validating'
  | 'published'
  | 'archived'
  | 'pending_delete'
  | 'deleted'

export type WorkflowAction =
  | 'submit_moderation'
  | 'refuse_moderation'
  | 'submit_validation'
  | 'refuse_validation'
  | 'publish'
  | 'unpublish'
  | 'archive'
  | 'publish_from_archive'
  | 'confirm_delete'
  | 'reject_delete'
  | 'restore_deleted'

export type EvidenceLevel = 'official_doc' | 'operational_doc' | 'synthesis_draft' | 'field_record'

export type WikiPage = {
  slug: string
  title: string
  summary: string
  content: string
  sources: SourceReference[]
  links: string[]
  updatedAt: string
  pageType: WikiPageType
  status: WikiPageStatus
  evidenceLevel: EvidenceLevel
  applicability: string
  modelVersion: string
  reviewedBy: string | null
  reviewedAt: string | null
  hasPublishedVersion?: boolean
  storageDomain?: StorageDomain
  accessLevel?: AccessLevel
  versionLabel?: string
  workflowNote?: string | null
  schemaEntities?: string[]
}

export type PageVersionSnapshot = {
  id: string
  slug: string
  versionLabel: string
  status: 'candidate' | 'published' | 'archived'
  createdAt: string
  createdBy: string
  note: string
  evalScore: number | null
  evalNote: string | null
  title: string
  summary: string
}

export type DocumentChunkRecord = {
  chunkId: string
  file: string
  chunkIndex: number
  locator: string
  headingPath: string[]
  blockKind: 'text' | 'table' | 'visual'
  content: string
  charCount: number
  storageDomain: StorageDomain
}

export type SchemaEntityRecord = {
  id: string
  name: string
  spgType: SpgTypeKind
  storageDomain: StorageDomain
  description: string
  chunkCount: number
  wikiSlugs: string[]
}

export type SchemaOverview = {
  domainCounts: Record<StorageDomain, number>
  chunkCount: number
  entityCount: number
  mutualLinkCount: number
  entities: SchemaEntityRecord[]
}

export type KnowledgeGraphNode = {
  id: string
  label: string
  kind: 'wiki' | 'entity'
  storageDomain: StorageDomain
  slug?: string
  status?: WikiPageStatus
  summary?: string
  chunkCount?: number
  degree: number
}

export type KnowledgeGraphEdge = {
  source: string
  target: string
  relation: 'wikilink' | 'defines' | 'mentions' | 'belongs_to'
  weight: number
}

export type KnowledgeGraphData = {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  domainCounts: Record<StorageDomain, number>
  totalWikiPages: number
  totalEntities: number
  totalMutualLinks: number
}

export type QaFeedbackEntry = {
  id: string
  createdAt: string
  question: string
  rating: 'helpful' | 'needs_fix'
  comment: string
  citedSlugs: string[]
}

export type PageDiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export type PageDiffResult = {
  slug: string
  hasBaseline: boolean
  hunks: PageDiffHunk[]
  addedLines: number
  removedLines: number
}

export type RunChange = {
  slug: string
  title: string
  action: 'create' | 'update' | 'delete'
}

export type OrganizeRun = {
  id: string
  createdAt: string
  summary: string
  model: string
  filesChanged: number
  changesCount: number
  undone: boolean
  gitCommit?: string | null
  changes: RunChange[]
}

export type ModelCallRecord = {
  id: string
  createdAt: string
  taskType: string
  provider: string
  model: string
  durationMs: number
  status: 'ok' | 'error'
  detail: string
}

export type WikiLintIssue = {
  id: string
  severity: 'error' | 'warning' | 'info'
  category:
    | 'orphan'
    | 'no_sources'
    | 'broken_link'
    | 'draft_backlog'
    | 'stale_source'
    | 'duplicate_title'
    | 'schema_violation'
  slug: string
  title: string
  message: string
}

export type WikiLintReport = {
  checkedAt: string
  totalPages: number
  publishedCount: number
  draftCount: number
  issues: WikiLintIssue[]
}

export type WikiLintFixResult = {
  filesChanged: number
  ghostLinksStripped: number
  canonicalizedLinks: number
  report: WikiLintReport
}

export type SearchHit = {
  id: string
  kind: 'wiki' | 'source' | 'chunk'
  slug?: string
  file?: string
  locator?: string
  headingPath?: string[]
  title: string
  snippet: string
  score: number
  status: 'published' | 'draft' | 'moderating' | 'validating' | 'archived' | 'pending_delete' | 'deleted' | 'raw'
  pageType?: string
  evidenceLevel?: string
  storageDomain?: StorageDomain
  reranked?: boolean
  matchedEntities?: string[]
}

export type KnowledgeCitation = {
  label: string
  kind: 'wiki' | 'source' | 'chunk'
  slug?: string
  file?: string
  locator?: string
  excerpt: string
  isFallback?: boolean
}

export type KnowledgeQueryResult = {
  conclusion: string
  applicability: string
  citations: KnowledgeCitation[]
  conflicts: string
  missingInfo: string
  knowledgeVersion: string
  insufficientEvidence: boolean
  hits: SearchHit[]
}

export type ModelProvider = 'ollama' | 'openai'

/**
 * Three simultaneous runtime/deployment profiles (External API / Cloud first):
 * - cloud:   External API / Cloud server (default priority)
 * - lan_gpu: Dedicated LAN GPU server (vLLM / Ollama / BGE / Reranker / optional remote ZHIXU server)
 * - local:   Local PC (Ollama on-demand)
 */
export type DeploymentMode = 'cloud' | 'lan_gpu' | 'local'

export type ModelTier = 'LLLM' | 'LLM' | 'VM'

export type DeploymentEndpointProfile = {
  provider: ModelProvider
  baseUrl: string
  apiKey: string
  /** Standard LLM (问答 / 笔记提取) — synced with llmModel */
  model: string
  /** LLLM (强推理 / 长上下文 Wiki 综合整理) */
  lllmBaseUrl?: string
  lllmApiKey?: string
  lllmModel?: string
  /** LLM (标准对话 / 检索问答 / 摘要提取) */
  llmBaseUrl?: string
  llmApiKey?: string
  llmModel?: string
  /** VM (视觉多模态模型 — 图片/图表理解) */
  vmBaseUrl?: string
  vmApiKey?: string
  visionModel?: string
  embeddingModel?: string
  rerankBaseUrl?: string
  rerankApiKey?: string
  rerankModel?: string
  remoteServerUrl?: string
  remoteServerToken?: string
}

export type DeploymentEndpointProfileSnapshot = Omit<
  DeploymentEndpointProfile,
  'apiKey' | 'lllmApiKey' | 'llmApiKey' | 'vmApiKey' | 'rerankApiKey' | 'remoteServerToken'
> & {
  apiKeySet: boolean
  lllmApiKeySet: boolean
  llmApiKeySet: boolean
  vmApiKeySet: boolean
  rerankApiKeySet: boolean
  remoteServerTokenSet: boolean
}

export type ModelProviderSettings = {
  mode?: DeploymentMode
  provider: ModelProvider
  baseUrl: string
  apiKey: string
  model: string
  lllmBaseUrl?: string
  lllmApiKey?: string
  lllmModel?: string
  llmBaseUrl?: string
  llmApiKey?: string
  llmModel?: string
  vmBaseUrl?: string
  vmApiKey?: string
  visionModel?: string
  embeddingModel?: string
  rerankBaseUrl?: string
  rerankApiKey?: string
  rerankModel?: string
  remoteServerUrl?: string
  remoteServerToken?: string
  profiles?: Partial<Record<DeploymentMode, DeploymentEndpointProfile>>
}

export type ModelProviderSnapshot = Omit<
  ModelProviderSettings,
  'apiKey' | 'lllmApiKey' | 'llmApiKey' | 'vmApiKey' | 'rerankApiKey' | 'remoteServerToken' | 'profiles'
> & {
  mode: DeploymentMode
  apiKeySet: boolean
  lllmApiKeySet: boolean
  llmApiKeySet: boolean
  vmApiKeySet: boolean
  rerankApiKeySet: boolean
  remoteServerTokenSet: boolean
  profiles: Record<DeploymentMode, DeploymentEndpointProfileSnapshot>
}

export type AdminRole = 'superadmin' | 'reviewer'

export type AdminUserRecord = {
  username: string
  role: AdminRole
  createdAt: string
  lastLoginAt: string | null
}

export type AdminAuthState = {
  authenticated: boolean
  passwordRequired?: boolean
  needsSetup?: boolean
  minPasswordLength?: number
  user: AdminUserRecord | null
  users: AdminUserRecord[]
  serverAuthEnforced: boolean
}

export type SourceFileStatus = {
  path: string
  size: number
  mtime: number
  indexed: boolean
  mediaKind?: 'document' | 'image'
}

export type WorkspaceSnapshot = {
  root: string | null
  modelProvider: ModelProviderSnapshot
  models: string[]
  modelOnline: boolean
  deploymentMode: DeploymentMode
  remoteConnected: boolean
  fileCount: number
  pendingCount: number
  draftCount: number
  pendingDeleteCount: number
  deletedCount: number
  publishedCount: number
  chunkCount: number
  entityCount: number
  mutualLinkCount: number
  cachedEmbeddingCount: number
  adminAuth: AdminAuthState
  sourceFiles: SourceFileStatus[]
  pages: WikiPage[]
  runs: OrganizeRun[]
  modelCalls: ModelCallRecord[]
  feedbacks: QaFeedbackEntry[]
}

export type ImportFilesResult = {
  imported: string[]
  skipped: string[]
  snapshot: WorkspaceSnapshot
}

export type OrganizeResult = {
  status: 'completed' | 'unchanged' | 'cancelled'
  message: string
  snapshot: WorkspaceSnapshot
}

export type ProgressEvent = {
  stage: 'scan' | 'chunk' | 'notes' | 'schema' | 'wiki' | 'save'
  message: string
  current: number
  total: number
}

export type QaHistoryTurn = {
  question: string
  conclusion: string
}

export type ManualPageInput = {
  slug?: string
  title: string
  summary: string
  content: string
  applicability?: string
  pageType?: WikiPageType
  storageDomain?: StorageDomain
  sources?: SourceReference[]
  publishImmediately?: boolean
  note?: string
}

export type WorkspaceApi = {
  windowControls?: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
  }
  getSnapshot: () => Promise<WorkspaceSnapshot>
  selectWorkspace: () => Promise<WorkspaceSnapshot | null>
  importDroppedFiles: (files: File[]) => Promise<ImportFilesResult>
  removeSource: (file: string) => Promise<WorkspaceSnapshot>
  organize: () => Promise<OrganizeResult>
  cancelOrganize: () => Promise<void>
  undoRun: (runId: string) => Promise<WorkspaceSnapshot>
  saveManualPage: (input: ManualPageInput) => Promise<{ slug: string; snapshot: WorkspaceSnapshot }>
  publishPage: (slug: string) => Promise<WorkspaceSnapshot>
  publishAllDrafts: () => Promise<WorkspaceSnapshot>
  transitionWorkflow: (slug: string, action: WorkflowAction, note?: string) => Promise<WorkspaceSnapshot>
  purgeDeletedPage: (slug: string) => Promise<WorkspaceSnapshot>
  listPageVersions: (slug: string) => Promise<PageVersionSnapshot[]>
  rollbackPageVersion: (slug: string, versionLabel: string) => Promise<WorkspaceSnapshot>
  getPageDiff: (slug: string) => Promise<PageDiffResult>
  runLint: () => Promise<WikiLintReport>
  fixLint: () => Promise<WikiLintFixResult>
  getSchemaOverview: () => Promise<SchemaOverview>
  getKnowledgeGraph: (maxEntities?: number) => Promise<KnowledgeGraphData>
  searchKnowledge: (
    query: string,
    options?: { includeDrafts?: boolean; includeSources?: boolean; domain?: StorageDomain }
  ) => Promise<SearchHit[]>
  askKnowledge: (
    question: string,
    options?: { includeDrafts?: boolean; includeSources?: boolean; domain?: StorageDomain; history?: QaHistoryTurn[] }
  ) => Promise<KnowledgeQueryResult>
  submitFeedback: (entry: {
    question: string
    rating: 'helpful' | 'needs_fix'
    comment: string
    citedSlugs: string[]
  }) => Promise<WorkspaceSnapshot>
  setModel: (settings: ModelProviderSettings) => Promise<WorkspaceSnapshot>
  refreshModels: () => Promise<WorkspaceSnapshot>
  openSource: (file: string) => Promise<void>
  adminEnterLocal?: () => Promise<WorkspaceSnapshot>
  adminSetup?: (username: string, password: string) => Promise<WorkspaceSnapshot>
  adminLogin: (username: string, password: string) => Promise<WorkspaceSnapshot>
  adminLogout: () => Promise<WorkspaceSnapshot>
  adminChangePassword: (oldPassword: string, newPassword: string) => Promise<WorkspaceSnapshot>
  adminCreateUser: (username: string, password: string, role: AdminRole) => Promise<WorkspaceSnapshot>
  adminDeleteUser: (username: string) => Promise<WorkspaceSnapshot>
  onProgress: (listener: (event: ProgressEvent) => void) => () => void
}
