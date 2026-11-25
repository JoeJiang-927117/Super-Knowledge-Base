import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type {
  AdminRole,
  AdminUserRecord,
  DeploymentMode,
  ModelProviderSettings,
  OrganizeResult,
  ProgressEvent,
  StorageDomain,
  WorkflowAction,
  WorkspaceSnapshot
} from '../shared/types'
import { AdminAuthManager, AuthHttpError, defaultAdminFilePath, isLoopbackHost, MIN_PASSWORD_LENGTH } from '../main/admin-auth'
import { isSupportedFile, listWorkspaceFiles, MAX_FILE_SIZE } from '../main/documents'
import { fixWikiLint, runWikiLint } from '../main/linter'
import { createTierModelClient, defaultModelSettings, normalizeModelSettings, publicModelSettings } from '../main/model'
import { assertPermission, ForbiddenError, permissionForWorkflowAction } from '../main/rbac'
import { askKnowledgeBase, searchKnowledge } from '../main/search'
import { WikiStore } from '../main/store'
import { organizeWorkspace } from '../main/wiki-engine'

const root = path.resolve(process.env.ZHIXU_ROOT ?? process.cwd())
// Fix P0: Default bind to 127.0.0.1 instead of 0.0.0.0; require explicit ZHIXU_HOST=0.0.0.0 to expose externally.
const host = process.env.ZHIXU_HOST?.trim() || '127.0.0.1'
const port = Number(process.env.ZHIXU_PORT ?? 8787)
const configuredToken = process.env.ZHIXU_SERVER_TOKEN?.trim() ?? ''
const allowUnauthExplicit = process.env.ZHIXU_ALLOW_UNAUTHENTICATED === 'true' && (host === '127.0.0.1' || host === 'localhost')
// Fix P0: Enforce server auth by default. Auto-generate a strong runtime token if ZHIXU_SERVER_TOKEN is not provided.
const serverToken = configuredToken || (allowUnauthExplicit ? '' : `zhixu_srv_${randomBytes(18).toString('hex')}`)
const corsOriginConfig = process.env.ZHIXU_CORS_ORIGIN?.trim() ?? ''
const publicDirectory = path.resolve(__dirname, '../renderer')

let modelSettings: ModelProviderSettings = modelSettingsFromEnvironment()
let store: WikiStore | null = null
let adminAuth: AdminAuthManager | null = null
let activeController: AbortController | null = null
let cachedModels: string[] = []
let modelOnline = false
const progressClients = new Set<http.ServerResponse>()

function modelSettingsFromEnvironment(): ModelProviderSettings {
  const defaults = defaultModelSettings()
  const modeRaw = process.env.ZHIXU_MODE as DeploymentMode | undefined
  const mode: DeploymentMode = modeRaw === 'cloud' || modeRaw === 'lan_gpu' || modeRaw === 'local' ? modeRaw : 'cloud'
  return normalizeModelSettings({
    mode,
    provider: process.env.ZHIXU_PROVIDER === 'ollama' ? 'ollama' : 'openai',
    baseUrl: process.env.ZHIXU_MODEL_BASE_URL ?? defaults.baseUrl,
    apiKey: process.env.ZHIXU_API_KEY ?? '',
    model: process.env.ZHIXU_MODEL ?? defaults.model,
    lllmBaseUrl: process.env.ZHIXU_LLLM_BASE_URL ?? '',
    lllmApiKey: process.env.ZHIXU_LLLM_API_KEY ?? '',
    lllmModel: process.env.ZHIXU_LLLM_MODEL ?? defaults.lllmModel,
    llmBaseUrl: process.env.ZHIXU_LLM_BASE_URL ?? '',
    llmApiKey: process.env.ZHIXU_LLM_API_KEY ?? '',
    llmModel: process.env.ZHIXU_LLM_MODEL ?? process.env.ZHIXU_MODEL ?? defaults.llmModel,
    vmBaseUrl: process.env.ZHIXU_VM_BASE_URL ?? '',
    vmApiKey: process.env.ZHIXU_VM_API_KEY ?? '',
    visionModel: process.env.ZHIXU_VISION_MODEL ?? defaults.visionModel,
    embeddingModel: process.env.ZHIXU_EMBEDDING_MODEL ?? defaults.embeddingModel,
    rerankBaseUrl: process.env.ZHIXU_RERANK_BASE_URL ?? '',
    rerankApiKey: process.env.ZHIXU_RERANK_API_KEY ?? '',
    rerankModel: process.env.ZHIXU_RERANK_MODEL ?? ''
  })
}

async function openStore(directory: string): Promise<void> {
  if (path.parse(directory).root === directory) throw new Error('ZHIXU_ROOT 不能指向整个磁盘')
  store?.close()
  store = new WikiStore(directory)
  await store.initialize()
  const sessionTtlMs = process.env.ZHIXU_SESSION_TTL_MS ? Number(process.env.ZHIXU_SESSION_TTL_MS) : undefined
  const maxFailedAttempts = process.env.ZHIXU_LOGIN_MAX_ATTEMPTS ? Number(process.env.ZHIXU_LOGIN_MAX_ATTEMPTS) : undefined
  const lockoutMs = process.env.ZHIXU_LOGIN_LOCKOUT_MS ? Number(process.env.ZHIXU_LOGIN_LOCKOUT_MS) : undefined
  const progressiveDelayBaseMs = process.env.ZHIXU_LOGIN_DELAY_MS ? Number(process.env.ZHIXU_LOGIN_DELAY_MS) : undefined
  adminAuth = new AdminAuthManager(defaultAdminFilePath(path.join(directory, '.localwiki')), {
    sessionTtlMs: sessionTtlMs && sessionTtlMs > 0 ? sessionTtlMs : undefined,
    maxFailedAttempts: maxFailedAttempts && maxFailedAttempts > 0 ? maxFailedAttempts : undefined,
    lockoutMs: lockoutMs && lockoutMs > 0 ? lockoutMs : undefined,
    progressiveDelayBaseMs: progressiveDelayBaseMs !== undefined && !Number.isNaN(progressiveDelayBaseMs) ? progressiveDelayBaseMs : undefined
  })
  await adminAuth.initialize({
    bindHost: host,
    requireSeedPasswordOnNetwork: true
  })
}

async function refreshModels(): Promise<void> {
  try {
    const client = createTierModelClient(modelSettings, 'LLM')
    if (modelSettings.provider === 'ollama') {
      cachedModels = await client.listModels()
      modelOnline = true
      if (!cachedModels.includes(modelSettings.model) && cachedModels.length) {
        modelSettings = normalizeModelSettings({ ...modelSettings, model: cachedModels[0], llmModel: cachedModels[0] }, modelSettings)
      }
      return
    }
    try {
      cachedModels = await client.listModels()
    } catch {
      cachedModels = []
    }
    modelOnline = Boolean(modelSettings.baseUrl.trim() && (modelSettings.llmModel?.trim() || modelSettings.model.trim()))
  } catch {
    cachedModels = []
    modelOnline = false
  }
}

async function snapshot(activeAdmin: AdminUserRecord | null = null): Promise<WorkspaceSnapshot> {
  const indexedByPath = new Map((store?.getFiles() ?? []).map(file => [file.path, file]))
  const scanned = store ? (await listWorkspaceFiles(store.root)).files : []
  const sourceFiles = scanned.map(file => {
    const prev = indexedByPath.get(file.path)
    const indexed = Boolean(prev && prev.size === file.size && Math.abs(prev.mtime - file.mtime) < 2)
    return { ...file, indexed }
  })
  const pages = store?.getPages() ?? []
  const activePages = pages.filter(page => page.slug !== 'index' && page.status !== 'deleted')
  const overview = store?.getSchemaOverview()
  return {
    root,
    modelProvider: publicModelSettings(modelSettings),
    models: cachedModels,
    modelOnline,
    deploymentMode: modelSettings.mode ?? 'cloud',
    remoteConnected: true,
    fileCount: sourceFiles.length,
    pendingCount: sourceFiles.filter(file => !file.indexed).length,
    draftCount: activePages.filter(
      page =>
        page.status === 'draft' ||
        page.status === 'moderating' ||
        page.status === 'validating' ||
        page.status === 'pending_delete'
    ).length,
    pendingDeleteCount: activePages.filter(page => page.status === 'pending_delete').length,
    deletedCount: pages.filter(page => page.status === 'deleted').length,
    publishedCount: activePages.filter(page => page.status === 'published').length,
    chunkCount: overview?.chunkCount ?? 0,
    entityCount: overview?.entityCount ?? 0,
    mutualLinkCount: overview?.mutualLinkCount ?? 0,
    cachedEmbeddingCount: store?.getCachedEmbeddingCount() ?? 0,
    adminAuth: adminAuth
      ? adminAuth.getState(activeAdmin, Boolean(serverToken))
      : { authenticated: false, user: null, users: [], serverAuthEnforced: Boolean(serverToken) },
    sourceFiles,
    pages,
    runs: store?.getRuns() ?? [],
    modelCalls: store?.getModelCalls(30) ?? [],
    feedbacks: store?.getFeedbacks(20) ?? []
  }
}

async function applyModelSettings(
  input: Partial<ModelProviderSettings>,
  activeAdmin: AdminUserRecord | null
): Promise<WorkspaceSnapshot> {
  const next = normalizeModelSettings(input, modelSettings)
  createTierModelClient(next, 'LLM')
  modelSettings = next
  await refreshModels()
  return snapshot(activeAdmin)
}

function sendProgress(event: ProgressEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`
  for (const response of progressClients) {
    try {
      response.write(payload)
    } catch {
      progressClients.delete(response)
    }
  }
}

function corsHeaders(request?: http.IncomingMessage): Record<string, string> {
  const origin = request?.headers.origin ?? ''
  let allowOrigin = ''
  if (corsOriginConfig) {
    const allowed = corsOriginConfig.split(',').map(s => s.trim()).filter(Boolean)
    if (allowed.includes('*')) allowOrigin = '*'
    else if (origin && allowed.includes(origin)) allowOrigin = origin
  } else if (origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
    allowOrigin = origin
  }
  return {
    ...(allowOrigin ? { 'access-control-allow-origin': allowOrigin, vary: 'Origin' } : {}),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  }
}

function sendJson(request: http.IncomingMessage, response: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(request)
  })
  response.end(body)
}

function clientIpFromRequest(request: http.IncomingMessage): string {
  const remote = request.socket.remoteAddress ?? 'unknown'
  if (process.env.ZHIXU_TRUST_PROXY === 'true') {
    const xff = request.headers['x-forwarded-for']
    const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]
    if (first?.trim()) return first.trim()
  }
  return remote
}

function sendError(request: http.IncomingMessage, response: http.ServerResponse, error: unknown, defaultStatus = 400): void {
  const message = error instanceof Error ? error.message : String(error)
  let status = defaultStatus
  const extraHeaders: Record<string, string> = {}
  if (error instanceof ForbiddenError) {
    status = error.statusCode
  } else if (error instanceof AuthHttpError) {
    status = error.statusCode
    if (error.retryAfterSec) extraHeaders['retry-after'] = String(error.retryAfterSec)
  }
  const body = JSON.stringify({ error: message })
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(request),
    ...extraHeaders
  })
  response.end(body)
}

function extractRequestToken(request: http.IncomingMessage, url: URL): string {
  const header = request.headers.authorization ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const queryToken = url.searchParams.get('token')?.trim() ?? ''
  return bearer || queryToken
}

function authenticateRequest(
  request: http.IncomingMessage,
  url: URL
): { ok: boolean; adminUser: AdminUserRecord | null; viaServerToken: boolean; token: string } {
  const token = extractRequestToken(request, url)
  const adminUser = adminAuth?.verifySessionToken(token) ?? null
  if (adminUser) {
    return { ok: true, adminUser, viaServerToken: false, token }
  }
  if (!serverToken) {
    return { ok: true, adminUser: null, viaServerToken: false, token }
  }
  if (token) {
    const a = Buffer.from(token, 'utf8')
    const b = Buffer.from(serverToken, 'utf8')
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { ok: true, adminUser: null, viaServerToken: true, token }
    }
  }
  return { ok: false, adminUser: null, viaServerToken: false, token }
}

async function readBody(request: http.IncomingMessage, maxBytes = 28 * 1024 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('请求内容过大')
    chunks.push(buffer)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

async function handleSource(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<void> {
  if (!store) throw new Error('尚未打开知识库')
  const file = url.searchParams.get('file') ?? ''
  const absolute = path.resolve(store.root, ...file.split('/'))
  const relative = path.relative(store.root, absolute)
  const segments = relative.split(/[\\/]/).filter(Boolean)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || segments.some(seg => seg.startsWith('.'))) {
    throw new Error('无效的资料路径')
  }
  const info = await fs.stat(absolute)
  if (!info.isFile()) throw new Error('资料不是文件')
  const type = contentType(absolute)
  response.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(absolute))}`,
    'cache-control': 'no-store',
    ...corsHeaders(request)
  })
  createReadStream(absolute).pipe(response)
}

async function handleApi(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<void> {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(request))
    response.end()
    return
  }

  // Public health endpoint (never leaks sensitive config)
  if (url.pathname === '/api/v1/health' && request.method === 'GET') {
    sendJson(request, response, 200, {
      ok: true,
      mode: modelSettings.mode ?? 'cloud',
      modelOnline,
      authEnabled: Boolean(serverToken),
      needsSetup: adminAuth?.needsSetup() ?? false
    })
    return
  }

  // Public auth status endpoint (for initial setup screen)
  if (url.pathname === '/api/auth/status' && request.method === 'GET') {
    sendJson(request, response, 200, {
      needsSetup: adminAuth?.needsSetup() ?? false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      authEnabled: Boolean(serverToken)
    })
    return
  }

  // Initial superadmin setup (only permitted when zero accounts exist on loopback)
  if (url.pathname === '/api/auth/setup' && request.method === 'POST') {
    if (!adminAuth) throw new Error('管理员认证服务尚未初始化')
    if (!isLoopbackHost(host)) {
      throw new ForbiddenError('非本机监听模式禁止通过 HTTP 初始化管理员，请使用 ZHIXU_ADMIN_PASSWORD 环境变量启动')
    }
    const body = await readBody(request, 64 * 1024)
    const username = typeof body.username === 'string' ? body.username : 'zhixu'
    const password = typeof body.password === 'string' ? body.password : ''
    const { token, user } = await adminAuth.setupInitialAdmin(username, password)
    sendJson(request, response, 200, { token, user, snapshot: await snapshot(user) })
    return
  }

  // Public admin login endpoint (rate-limited, issues session Bearer token)
  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    if (!adminAuth) throw new Error('管理员认证服务尚未初始化')
    const body = await readBody(request, 64 * 1024)
    const username = typeof body.username === 'string' ? body.username : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const { token, user } = await adminAuth.login(username, password, clientIpFromRequest(request))
    sendJson(request, response, 200, { token, user, snapshot: await snapshot(user) })
    return
  }

  const auth = authenticateRequest(request, url)
  if (!auth.ok) {
    sendJson(request, response, 401, { error: '未授权访问：请先通过管理员账号登录或携带有效的服务器访问令牌' })
    return
  }
  const effectiveRole: AdminRole | null = auth.adminUser
    ? auth.adminUser.role
    : auth.viaServerToken || !serverToken
      ? 'superadmin'
      : null
  // Authoritative server-side actor identity; never trust client-supplied reviewer/author fields.
  const actorName = auth.adminUser?.username ?? 'server-token'

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    adminAuth?.logout(auth.token)
    sendJson(request, response, 200, { ok: true, snapshot: await snapshot(null) })
    return
  }

  if (url.pathname === '/api/auth/change-password' && request.method === 'POST') {
    if (!adminAuth || !auth.adminUser) throw new Error('请先使用管理员账号登录')
    const body = await readBody(request, 64 * 1024)
    await adminAuth.changePassword(
      auth.adminUser.username,
      typeof body.oldPassword === 'string' ? body.oldPassword : '',
      typeof body.newPassword === 'string' ? body.newPassword : ''
    )
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/auth/users' && request.method === 'POST') {
    if (!adminAuth || !auth.adminUser) throw new Error('请先使用管理员账号登录')
    const body = await readBody(request, 64 * 1024)
    await adminAuth.createUser(
      auth.adminUser,
      typeof body.username === 'string' ? body.username : '',
      typeof body.password === 'string' ? body.password : '',
      (body.role === 'superadmin' ? 'superadmin' : 'reviewer') as AdminRole
    )
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/auth/users/delete' && request.method === 'POST') {
    if (!adminAuth || !auth.adminUser) throw new Error('请先使用管理员账号登录')
    const body = await readBody(request, 64 * 1024)
    await adminAuth.deleteUser(auth.adminUser, typeof body.username === 'string' ? body.username : '')
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/events' && request.method === 'GET') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      ...corsHeaders(request)
    })
    response.write(': connected\n\n')
    progressClients.add(response)
    request.on('close', () => progressClients.delete(response))
    return
  }

  if (url.pathname === '/api/snapshot' && request.method === 'GET') {
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/workspace' && request.method === 'POST') {
    sendJson(request, response, 200, { root, message: '服务器模式请通过 ZHIXU_ROOT 设置资料目录' })
    return
  }

  if (url.pathname === '/api/upload' && request.method === 'POST') {
    assertPermission(effectiveRole, 'manage_sources', '上传资料')
    if (!store) throw new Error('尚未打开知识库')
    const body = await readBody(request)
    const fileName = typeof body.fileName === 'string' ? path.basename(body.fileName.trim()) : ''
    const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : ''
    if (!fileName || fileName.startsWith('.') || !isSupportedFile(fileName)) throw new Error('不支持的文件格式')
    const buffer = Buffer.from(contentBase64, 'base64')
    if (buffer.length > MAX_FILE_SIZE) throw new Error('文件超过 20 MB 上限')
    const dest = path.resolve(store.root, fileName)
    const rel = path.relative(store.root, dest)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('非法文件名')
    await fs.writeFile(dest, buffer)
    sendJson(request, response, 200, { ok: true, file: fileName, snapshot: await snapshot(auth.adminUser) })
    return
  }

  if (url.pathname === '/api/remove-source' && request.method === 'POST') {
    assertPermission(effectiveRole, 'manage_sources', '删除原始资料')
    if (!store) throw new Error('尚未打开知识库')
    const body = await readBody(request)
    const file = typeof body.file === 'string' ? body.file : ''
    const absolute = path.resolve(store.root, ...file.split('/'))
    const relative = path.relative(store.root, absolute)
    const segments = relative.split(/[\\/]/).filter(Boolean)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || segments.some(seg => seg.startsWith('.'))) {
      throw new Error('无效的资料路径')
    }
    await fs.rm(absolute, { force: true })
    store.deleteFileChunks(file)
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/models' && request.method === 'POST') {
    assertPermission(effectiveRole, 'manage_models', '刷新模型列表')
    await refreshModels()
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/model' && request.method === 'POST') {
    assertPermission(effectiveRole, 'manage_models', '修改模型配置')
    const body = await readBody(request)
    sendJson(request, response, 200, await applyModelSettings(body as Partial<ModelProviderSettings>, auth.adminUser))
    return
  }

  if (url.pathname === '/api/organize' && request.method === 'POST') {
    assertPermission(effectiveRole, 'manage_organize', '触发知识库整理')
    if (!store) throw new Error('尚未打开知识库')
    if (activeController) throw new Error('已有整理任务正在进行')
    if (!modelOnline) await refreshModels()
    if (!modelOnline) throw new Error('无法连接当前模型服务，请检查模型设置')
    const controller = new AbortController()
    activeController = controller
    try {
      const result = await organizeWorkspace(store, modelSettings, sendProgress, controller.signal)
      sendJson(request, response, 200, { ...result, snapshot: await snapshot(auth.adminUser) } satisfies OrganizeResult)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        sendJson(request, response, 200, {
          status: 'cancelled',
          message: '已取消整理，原始资料和现有知识库未改变',
          snapshot: await snapshot(auth.adminUser)
        } satisfies OrganizeResult)
        return
      }
      throw error
    } finally {
      activeController = null
    }
    return
  }

  if (url.pathname === '/api/cancel' && request.method === 'POST') {
    assertPermission(effectiveRole, 'manage_organize', '取消整理')
    activeController?.abort()
    sendJson(request, response, 200, { ok: true })
    return
  }

  if (url.pathname === '/api/undo' && request.method === 'POST') {
    assertPermission(effectiveRole, 'manage_organize', '撤销整理记录')
    if (!store) throw new Error('尚未打开知识库')
    if (activeController) throw new Error('请先完成或取消当前整理')
    const body = await readBody(request)
    if (typeof body.runId !== 'string') throw new Error('缺少整理记录 ID')
    await store.undo(body.runId)
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/publish' && request.method === 'POST') {
    assertPermission(effectiveRole, 'review', '发布页面')
    if (!store) throw new Error('尚未打开知识库')
    const body = await readBody(request)
    if (typeof body.slug !== 'string') throw new Error('缺少页面 slug')
    await store.publishPage(body.slug, actorName)
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/publish-all' && request.method === 'POST') {
    assertPermission(effectiveRole, 'manage_organize', '批量发布全部草稿')
    if (!store) throw new Error('尚未打开知识库')
    await store.publishAllDrafts(actorName)
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/workflow/transition' && request.method === 'POST') {
    if (!store) throw new Error('尚未打开知识库')
    const body = await readBody(request)
    if (typeof body.slug !== 'string' || typeof body.action !== 'string') throw new Error('缺少 slug 或 action')
    const action = body.action as WorkflowAction
    assertPermission(effectiveRole, permissionForWorkflowAction(action), `工作流操作:${action}`)
    await store.transitionWorkflow(
      body.slug,
      action,
      actorName,
      typeof body.note === 'string' ? body.note : ''
    )
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/pages/save' && request.method === 'POST') {
    assertPermission(effectiveRole, 'edit_draft', '保存知识页面')
    if (!store) throw new Error('尚未打开知识库')
    if (activeController) throw new Error('请先完成或取消当前整理')
    const body = await readBody(request)
    if (typeof body.title !== 'string' || typeof body.content !== 'string') {
      throw new Error('缺少页面标题或正文')
    }
    const publishImmediately = Boolean(body.publishImmediately)
    if (publishImmediately) assertPermission(effectiveRole, 'review', '保存并发布页面')
    const saved = await store.saveManualPage(
      {
        slug: typeof body.slug === 'string' ? body.slug : undefined,
        title: body.title,
        summary: typeof body.summary === 'string' ? body.summary : '',
        content: body.content,
        applicability: typeof body.applicability === 'string' ? body.applicability : undefined,
        pageType: typeof body.pageType === 'string' ? (body.pageType as import('../shared/types').WikiPageType) : undefined,
        storageDomain: typeof body.storageDomain === 'string' ? (body.storageDomain as StorageDomain) : undefined,
        sources: Array.isArray(body.sources) ? (body.sources as import('../shared/types').SourceReference[]) : undefined,
        publishImmediately,
        note: typeof body.note === 'string' ? body.note : undefined
      },
      actorName
    )
    sendJson(request, response, 200, { slug: saved.slug, snapshot: await snapshot(auth.adminUser) })
    return
  }

  if (url.pathname === '/api/pages/purge' && request.method === 'POST') {
    assertPermission(effectiveRole, 'manage_versions_high_risk', '彻底清理回收站页面')
    if (!store) throw new Error('尚未打开知识库')
    const body = await readBody(request)
    if (typeof body.slug !== 'string') throw new Error('缺少页面 slug')
    await store.purgeDeletedPage(body.slug, actorName)
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/versions' && request.method === 'GET') {
    if (!store) throw new Error('尚未打开知识库')
    const slug = url.searchParams.get('slug') ?? ''
    sendJson(request, response, 200, store.listPageVersions(slug))
    return
  }

  if (url.pathname === '/api/versions/rollback' && request.method === 'POST') {
    assertPermission(effectiveRole, 'manage_versions_high_risk', '回滚历史版本')
    if (!store) throw new Error('尚未打开知识库')
    const body = await readBody(request)
    if (typeof body.slug !== 'string' || typeof body.versionLabel !== 'string') {
      throw new Error('缺少 slug 或 versionLabel')
    }
    await store.rollbackPageVersion(body.slug, body.versionLabel, actorName)
    sendJson(request, response, 200, await snapshot(auth.adminUser))
    return
  }

  if (url.pathname === '/api/diff' && request.method === 'GET') {
    if (!store) throw new Error('尚未打开知识库')
    const slug = url.searchParams.get('slug') ?? ''
    sendJson(request, response, 200, store.getPageDiff(slug))
    return
  }

  if ((url.pathname === '/api/lint' || url.pathname === '/api/v1/lint') && request.method === 'GET') {
    if (!store) throw new Error('尚未打开知识库')
    sendJson(request, response, 200, await runWikiLint(store))
    return
  }

  if ((url.pathname === '/api/lint/fix' || url.pathname === '/api/v1/lint/fix') && request.method === 'POST') {
    assertPermission(effectiveRole, 'manage_organize', '自动修复断链')
    if (!store) throw new Error('尚未打开知识库')
    sendJson(request, response, 200, await fixWikiLint(store))
    return
  }

  if (url.pathname === '/api/v1/schema' && request.method === 'GET') {
    if (!store) throw new Error('尚未打开知识库')
    sendJson(request, response, 200, store.getSchemaOverview())
    return
  }

  if (url.pathname === '/api/v1/pages' && request.method === 'GET') {
    if (!store) throw new Error('尚未打开知识库')
    const includeDrafts = url.searchParams.get('includeDrafts') === 'true'
    sendJson(request, response, 200, includeDrafts ? store.getPages() : store.getPublishedPages())
    return
  }

  if (url.pathname === '/api/v1/candidates' && request.method === 'GET') {
    if (!store) throw new Error('尚未打开知识库')
    sendJson(request, response, 200, store.listAllCandidateVersions(50))
    return
  }

  if (url.pathname === '/api/v1/evaluate' && request.method === 'POST') {
    if (!store) throw new Error('尚未打开知识库')
    const body = await readBody(request)
    if (typeof body.slug !== 'string' || typeof body.versionLabel !== 'string' || typeof body.score !== 'number') {
      throw new Error('缺少 slug、versionLabel 或 score')
    }
    const updated = store.evaluateVersionCandidate(
      body.slug,
      body.versionLabel,
      body.score,
      typeof body.note === 'string' ? body.note : ''
    )
    sendJson(request, response, 200, updated)
    return
  }

  if (url.pathname === '/api/v1/feedback' && request.method === 'POST') {
    if (!store) throw new Error('尚未打开知识库')
    const body = await readBody(request)
    const entry = store.recordFeedback({
      question: typeof body.question === 'string' ? body.question : '',
      rating: body.rating === 'needs_fix' ? 'needs_fix' : 'helpful',
      comment: typeof body.comment === 'string' ? body.comment : '',
      citedSlugs: Array.isArray(body.citedSlugs) ? body.citedSlugs.filter((s): s is string => typeof s === 'string') : []
    })
    sendJson(request, response, 200, entry)
    return
  }

  if (url.pathname === '/api/v1/search' && request.method === 'POST') {
    if (!store) throw new Error('尚未打开知识库')
    const body = await readBody(request)
    const query = typeof body.query === 'string' ? body.query : ''
    const hits = await searchKnowledge(store, modelSettings, query, {
      includeDrafts: Boolean(body.includeDrafts),
      includeSources: Boolean(body.includeSources),
      domain: typeof body.domain === 'string' ? (body.domain as StorageDomain) : undefined
    })
    sendJson(request, response, 200, hits)
    return
  }

  if (url.pathname === '/api/v1/ask' && request.method === 'POST') {
    if (!store) throw new Error('尚未打开知识库')
    if (!modelOnline) await refreshModels()
    if (!modelOnline) throw new Error('无法连接当前模型服务，请检查模型设置')
    const body = await readBody(request)
    const question = typeof body.question === 'string' ? body.question : ''
    const history = Array.isArray(body.history)
      ? body.history
          .filter(
            (item): item is { question: string; conclusion: string } =>
              Boolean(item) && typeof (item as Record<string, unknown>).question === 'string' && typeof (item as Record<string, unknown>).conclusion === 'string'
          )
          .slice(-5)
      : undefined
    const answer = await askKnowledgeBase(store, modelSettings, question, {
      includeDrafts: Boolean(body.includeDrafts),
      includeSources: Boolean(body.includeSources),
      domain: typeof body.domain === 'string' ? (body.domain as StorageDomain) : undefined,
      history
    })
    sendJson(request, response, 200, answer)
    return
  }

  if (url.pathname === '/api/source' && request.method === 'GET') {
    await handleSource(request, response, url)
    return
  }

  sendJson(request, response, 404, { error: '接口不存在' })
}

function contentType(file: string): string {
  const extension = path.extname(file).toLowerCase()
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8'
  }
  return types[extension] ?? 'application/octet-stream'
}

async function serveStatic(response: http.ServerResponse, pathname: string): Promise<void> {
  const safePath = pathname === '/' ? '/index.html' : pathname
  const candidate = path.resolve(publicDirectory, `.${safePath}`)
  const relative = path.relative(publicDirectory, candidate)
  const target = !relative || relative.startsWith('..') || path.isAbsolute(relative)
    ? path.join(publicDirectory, 'index.html')
    : candidate
  try {
    const stat = await fs.stat(target)
    if (stat.isFile()) {
      response.writeHead(200, { 'content-type': contentType(target) })
      createReadStream(target).pipe(response)
      return
    }
  } catch {
    // Fall back to SPA index.html
  }
  const indexHtml = path.join(publicDirectory, 'index.html')
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  createReadStream(indexHtml).pipe(response)
}

async function main(): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  await openStore(root)
  await refreshModels()

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`)
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(request, response, url)
      } else {
        await serveStatic(response, url.pathname)
      }
    } catch (error) {
      sendError(request, response, error)
    }
  })

  server.listen(port, host, () => {
    console.log(`[知序 ZHIXU Server] 已启动：http://${host}:${port}`)
    console.log(`[知序 ZHIXU Server] 知识库目录：${root}`)
    console.log(`[知序 ZHIXU Server] 模式：${modelSettings.mode} | LLM：${modelSettings.llmModel} | LLLM：${modelSettings.lllmModel} | VM：${modelSettings.visionModel}`)
    if (!configuredToken && serverToken) {
      console.log(`[知序 ZHIXU Server] 未设置 ZHIXU_SERVER_TOKEN，已自动启用强制鉴权。临时访问令牌：${serverToken}`)
      if (adminAuth?.needsSetup()) {
        console.log(`[知序 ZHIXU Server] 首次启动尚未设置管理员密码，请通过本机登录页完成超级管理员初始化`)
      }
    } else {
      console.log(`[知序 ZHIXU Server] 强制鉴权：${serverToken ? '已开启' : '仅本地显式关闭'}`)
    }
  })
}

main().catch(error => {
  console.error('[知序 ZHIXU Server] 启动失败：', error)
  process.exit(1)
})
