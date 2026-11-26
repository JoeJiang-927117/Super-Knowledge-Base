import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AdminRole,
  ImportFilesResult,
  ModelProviderSettings,
  OrganizeResult,
  PageDiffResult,
  PageVersionSnapshot,
  ProgressEvent,
  SchemaOverview,
  StorageDomain,
  WikiLintFixResult,
  WikiLintReport,
  WorkflowAction,
  WorkspaceSnapshot
} from '../shared/types'
import { AdminAuthManager, defaultAdminFilePath } from './admin-auth'
import { EXCLUDED_DIRS, isSupportedFile, listWorkspaceFiles, MAX_DEPTH, MAX_FILE_SIZE } from './documents'
import { fixWikiLint, runWikiLint } from './linter'
import { createTierModelClient, defaultModelSettings, normalizeModelSettings, publicModelSettings } from './model'
import { assertPermission, permissionForWorkflowAction } from './rbac'
import { askKnowledgeBase, searchKnowledge } from './search'
import { WikiStore } from './store'
import { organizeWorkspace } from './wiki-engine'

type Settings = {
  root: string | null
  model: ModelProviderSettings
}

let settings: Settings = { root: null, model: defaultModelSettings() }
let store: WikiStore | null = null
let adminAuth: AdminAuthManager | null = null
let mainWindow: BrowserWindow | null = null
let activeController: AbortController | null = null
let cachedModels: string[] = []
let modelOnline = false
let remoteConnected = false

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function normalizeSettings(raw: Partial<Settings>): Settings {
  const rawModel =
    typeof raw.model === 'string'
      ? ({ ...defaultModelSettings(), model: raw.model } as Partial<ModelProviderSettings>)
      : (raw.model as Partial<ModelProviderSettings> | undefined)
  return {
    root: typeof raw.root === 'string' ? raw.root : null,
    model: normalizeModelSettings(rawModel)
  }
}

async function loadSettings(): Promise<void> {
  try {
    settings = normalizeSettings(JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as Partial<Settings>)
  } catch {
    settings = { root: null, model: defaultModelSettings() }
  }
}

async function saveSettings(): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}

function currentReviewer(): string {
  return adminAuth?.getDesktopUser()?.username ?? 'zhixu'
}

function getRemoteServerConfig(): { url: string; token: string } | null {
  const mode = settings.model.mode ?? 'cloud'
  if (mode === 'local') return null
  const url = settings.model.remoteServerUrl?.trim().replace(/\/+$/, '') ?? ''
  if (!url || !/^https?:\/\//i.test(url)) return null
  return {
    url,
    token: settings.model.remoteServerToken?.trim() ?? ''
  }
}

async function remoteRequest<T>(
  endpoint: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const cfg = getRemoteServerConfig()
  if (!cfg) throw new Error('未配置远程知序知识库服务器地址')
  const response = await fetch(`${cfg.url}${endpoint}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
      ...init?.headers
    },
    signal: init?.signal ?? AbortSignal.timeout(init?.timeoutMs ?? 60_000)
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`远程服务器返回 ${response.status}：${detail}`)
  }
  return (await response.json()) as T
}

async function openStore(root: string): Promise<void> {
  if (path.parse(root).root === root) throw new Error('请选择一个知识库资料文件夹，不要直接选择整个磁盘')
  store?.close()
  store = new WikiStore(root)
  await store.initialize()
  settings.root = root
  await saveSettings()
}

async function tryStartLocalOllama(baseUrl: string): Promise<void> {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(baseUrl.trim())) return
  const homeDir = app.getPath('home')
  const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')
  const candidateExe = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe')
  const ollamaExe = existsSync(candidateExe) ? candidateExe : 'ollama'

  let modelsDir = process.env.OLLAMA_MODELS || ''
  let keepAlive = process.env.OLLAMA_KEEP_ALIVE || '5m'

  const onDemandScript = path.join(homeDir, '.ollama', 'on-demand', 'start.ps1')
  if (existsSync(onDemandScript)) {
    try {
      const scriptText = await fs.readFile(onDemandScript, 'utf8')
      const modelsMatch = /\$env:OLLAMA_MODELS\s*=\s*['"]([^'"]+)['"]/i.exec(scriptText)
      if (modelsMatch?.[1]) modelsDir = modelsMatch[1]
      const keepAliveMatch = /\$env:OLLAMA_KEEP_ALIVE\s*=\s*['"]([^'"]+)['"]/i.exec(scriptText)
      if (keepAliveMatch?.[1]) keepAlive = keepAliveMatch[1]
    } catch {
      // Ignore script parse error.
    }
  }

  try {
    const child = spawn(ollamaExe, ['serve'], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        OLLAMA_HOST: '127.0.0.1:11434',
        OLLAMA_KEEP_ALIVE: keepAlive,
        ...(modelsDir ? { OLLAMA_MODELS: modelsDir } : {})
      }
    })
    child.unref()
  } catch {
    return
  }

  const normalizedUrl = baseUrl.trim().replace(/\/+$/, '') || 'http://127.0.0.1:11434'
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 400))
    try {
      const res = await fetch(`${normalizedUrl}/api/version`, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return
    } catch {
      // Wait for Ollama startup.
    }
  }
}

async function refreshModels(): Promise<void> {
  const remoteCfg = getRemoteServerConfig()
  if (remoteCfg) {
    try {
      const remoteSnap = await remoteRequest<WorkspaceSnapshot>('/api/models', { method: 'POST', timeoutMs: 12_000 })
      cachedModels = remoteSnap.models ?? []
      modelOnline = Boolean(remoteSnap.modelOnline)
      remoteConnected = true
      return
    } catch {
      remoteConnected = false
      cachedModels = []
      modelOnline = false
      return
    }
  }

  remoteConnected = false
  try {
    const client = createTierModelClient(settings.model, 'LLM')
    if (settings.model.provider === 'ollama') {
      try {
        cachedModels = await client.listModels()
      } catch {
        if ((settings.model.mode ?? 'cloud') === 'local') {
          await tryStartLocalOllama(settings.model.baseUrl)
          cachedModels = await client.listModels()
        } else {
          throw new Error('远程 Ollama 服务不可达')
        }
      }
      modelOnline = true
      if (!cachedModels.includes(settings.model.model) && cachedModels.length) {
        const nextModel = cachedModels.find(m => !/(embed|bge|nomic|vl|vision)/i.test(m)) ?? cachedModels[0]
        settings.model = normalizeModelSettings(
          { ...settings.model, model: nextModel, llmModel: nextModel },
          settings.model
        )
        await saveSettings()
      }
      return
    }
    try {
      cachedModels = await client.listModels()
      modelOnline = true
    } catch {
      cachedModels = []
      modelOnline = Boolean(
        settings.model.baseUrl.trim() &&
          (settings.model.llmModel?.trim() || settings.model.model.trim()) &&
          (settings.model.mode === 'lan_gpu' || settings.model.apiKey.trim() || settings.model.llmApiKey?.trim())
      )
    }
  } catch {
    cachedModels = []
    modelOnline = false
  }
}

function defaultWorkspaceRoot(): string {
  return path.join(app.getPath('documents'), '知序知识库')
}

async function ensureDefaultStore(): Promise<void> {
  if (store) return
  const target = settings.root || defaultWorkspaceRoot()
  await fs.mkdir(target, { recursive: true })
  await openStore(target)
}

async function snapshot(): Promise<WorkspaceSnapshot> {
  const activeAdmin = adminAuth?.getDesktopUser() ?? null
  const remoteCfg = getRemoteServerConfig()
  if (remoteCfg) {
    try {
      const remoteSnap = await remoteRequest<WorkspaceSnapshot>('/api/snapshot', { timeoutMs: 12_000 })
      remoteConnected = true
      return {
        ...remoteSnap,
        modelProvider: publicModelSettings(settings.model),
        deploymentMode: settings.model.mode ?? 'cloud',
        remoteConnected: true,
        adminAuth: adminAuth ? adminAuth.getState(activeAdmin, true) : remoteSnap.adminAuth
      }
    } catch {
      remoteConnected = false
    }
  }

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
    root: settings.root,
    modelProvider: publicModelSettings(settings.model),
    models: cachedModels,
    modelOnline,
    deploymentMode: settings.model.mode ?? 'cloud',
    remoteConnected,
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
      ? adminAuth.getState(activeAdmin, true)
      : { authenticated: false, user: null, users: [], serverAuthEnforced: true },
    sourceFiles,
    pages,
    runs: store?.getRuns() ?? [],
    modelCalls: store?.getModelCalls(30) ?? [],
    feedbacks: store?.getFeedbacks(20) ?? []
  }
}

function isInsideDirectory(parentDir: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(targetPath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function importPathsToWorkspace(inputPaths: string[]): Promise<ImportFilesResult> {
  const remoteCfg = getRemoteServerConfig()
  if (remoteCfg) {
    const imported: string[] = []
    const skipped: string[] = []
    for (const rawPath of inputPaths) {
      if (typeof rawPath !== 'string' || !rawPath.trim()) continue
      const resolved = path.resolve(rawPath)
      try {
        const stat = await fs.stat(resolved)
        if (!stat.isFile() || !isSupportedFile(resolved)) {
          skipped.push(`${path.basename(resolved)}（远程上传仅支持单文件或受支持格式）`)
          continue
        }
        if (stat.size > MAX_FILE_SIZE) {
          skipped.push(`${path.basename(resolved)}（超过 20 MB）`)
          continue
        }
        const contentBase64 = (await fs.readFile(resolved)).toString('base64')
        await remoteRequest('/api/upload', {
          method: 'POST',
          body: JSON.stringify({ fileName: path.basename(resolved), contentBase64 }),
          timeoutMs: 30_000
        })
        imported.push(path.basename(resolved))
      } catch {
        skipped.push(`${path.basename(resolved)}（上传失败）`)
      }
    }
    return { imported, skipped, snapshot: await snapshot() }
  }

  await ensureDefaultStore()
  if (!store) throw new Error('无法初始化本地知识库目录')
  const rootDir = store.root
  const imported: string[] = []
  const skipped: string[] = []

  async function copySupportedFile(srcPath: string, relativeDest: string): Promise<void> {
    const fileName = path.basename(srcPath)
    if (!isSupportedFile(fileName)) {
      skipped.push(`${relativeDest}（不支持的文件格式）`)
      return
    }
    const stat = await fs.stat(srcPath)
    if (stat.size > MAX_FILE_SIZE) {
      skipped.push(`${relativeDest}（超过 20 MB）`)
      return
    }
    if (isInsideDirectory(rootDir, srcPath)) {
      const rel = path.relative(rootDir, srcPath).replaceAll('\\', '/')
      if (!imported.includes(rel)) imported.push(rel)
      return
    }
    const destPath = path.resolve(rootDir, ...relativeDest.split('/'))
    if (!isInsideDirectory(rootDir, destPath)) return
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    await fs.copyFile(srcPath, destPath)
    imported.push(relativeDest)
  }

  async function walkImportedDir(dirPath: string, relativePrefix: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const fullPath = path.join(dirPath, entry.name)
      const rel = `${relativePrefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await walkImportedDir(fullPath, rel, depth + 1)
        }
        continue
      }
      if (entry.isFile()) {
        await copySupportedFile(fullPath, rel)
      }
    }
  }

  for (const rawPath of inputPaths) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) continue
    const resolved = path.resolve(rawPath)
    try {
      const stat = await fs.lstat(resolved)
      if (stat.isSymbolicLink()) continue
      if (stat.isFile()) {
        await copySupportedFile(resolved, path.basename(resolved))
      } else if (stat.isDirectory()) {
        if (isInsideDirectory(rootDir, resolved)) continue
        await walkImportedDir(resolved, path.basename(resolved), 0)
      }
    } catch {
      skipped.push(`${path.basename(resolved)}（无法读取）`)
    }
  }

  return {
    imported,
    skipped,
    snapshot: await snapshot()
  }
}

function sendProgress(event: ProgressEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workspace:progress', event)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    frame: false,
    title: '知序 ZHIXU',
    icon: path.join(__dirname, '../../assets/zhixu-icon.png'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

async function applyModelSettings(input: Partial<ModelProviderSettings>): Promise<WorkspaceSnapshot> {
  const next = normalizeModelSettings(input, settings.model)
  if (!next.remoteServerUrl) {
    createTierModelClient(next, 'LLM')
  }
  settings.model = next
  await saveSettings()
  await refreshModels()
  return await snapshot()
}

app.whenReady().then(async () => {
  adminAuth = new AdminAuthManager(defaultAdminFilePath(app.getPath('userData')))
  await adminAuth.initialize()
  await loadSettings()
  if (settings.root) {
    try {
      await openStore(settings.root)
    } catch {
      settings.root = null
      store = null
    }
  }
  if (!store) {
    try {
      await ensureDefaultStore()
    } catch {
      // Fall back to null root if Documents folder is inaccessible.
    }
  }
  await refreshModels()
  createWindow()

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())

  ipcMain.handle('workspace:snapshot', async () => await snapshot())
  ipcMain.handle('workspace:select', async () => {
    if (activeController) throw new Error('请先取消当前整理')
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择知识库资料文件夹',
      buttonLabel: '使用此文件夹',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    await openStore(result.filePaths[0])
    return await snapshot()
  })
  ipcMain.handle('workspace:import-files', async (_event, paths: string[]) => {
    if (activeController) throw new Error('正在整理知识库，请稍后再导入文件')
    if (!Array.isArray(paths) || !paths.length) {
      return { imported: [], skipped: [], snapshot: await snapshot() }
    }
    return importPathsToWorkspace(paths)
  })
  ipcMain.handle('workspace:remove-source', async (_event, file: string) => {
    assertPermission(adminAuth?.getDesktopUser()?.role, 'manage_sources', '删除原始资料')
    if (getRemoteServerConfig()) {
      await remoteRequest('/api/remove-source', { method: 'POST', body: JSON.stringify({ file }) })
      return await snapshot()
    }
    if (!store) throw new Error('尚未打开知识库')
    if (activeController) throw new Error('请先完成或取消当前整理')
    const absolute = path.resolve(store.root, ...file.split('/'))
    const relative = path.relative(store.root, absolute)
    const segments = relative.split(/[\\/]/).filter(Boolean)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || segments.some(seg => seg.startsWith('.'))) {
      throw new Error('无效的资料路径')
    }
    await fs.rm(absolute, { force: true })
    store.deleteFileChunks(file)
    return await snapshot()
  })
  ipcMain.handle('workspace:organize', async (): Promise<OrganizeResult> => {
    if (getRemoteServerConfig()) {
      sendProgress({ stage: 'scan', message: '正在调用远程知序服务器执行整理...', current: 0, total: 1 })
      const remoteRes = await remoteRequest<OrganizeResult>('/api/organize', { method: 'POST', timeoutMs: 600_000 })
      return { ...remoteRes, snapshot: await snapshot() }
    }
    await ensureDefaultStore()
    if (!store) throw new Error('无法打开知识库资料文件夹')
    if (activeController) throw new Error('已有整理任务正在进行')
    if (!modelOnline) {
      sendProgress({ stage: 'scan', message: '正在连接模型服务...', current: 0, total: 1 })
      await refreshModels()
    }
    if (!modelOnline) throw new Error('无法连接当前模型服务，请先在设置或后台管理中配置外部 API / 模型接口')
    const controller = new AbortController()
    activeController = controller
    try {
      const result = await organizeWorkspace(store, settings.model, sendProgress, controller.signal)
      return { ...result, snapshot: await snapshot() }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { status: 'cancelled', message: '已取消整理，原始资料和现有知识库未改变', snapshot: await snapshot() }
      }
      throw error
    } finally {
      activeController = null
    }
  })
  ipcMain.handle('workspace:cancel', async () => {
    if (getRemoteServerConfig()) {
      await remoteRequest('/api/cancel', { method: 'POST' }).catch(() => undefined)
      return
    }
    activeController?.abort()
  })
  ipcMain.handle('workspace:undo', async (_event, runId: string) => {
    if (getRemoteServerConfig()) {
      await remoteRequest('/api/undo', { method: 'POST', body: JSON.stringify({ runId }) })
      return await snapshot()
    }
    if (!store) throw new Error('尚未打开知识库')
    if (activeController) throw new Error('请先完成或取消当前整理')
    await store.undo(runId)
    return await snapshot()
  })
  ipcMain.handle('workspace:save-page', async (_event, input: import('../shared/types').ManualPageInput) => {
    if (getRemoteServerConfig()) {
      const res = await remoteRequest<{ slug: string; snapshot: WorkspaceSnapshot }>('/api/pages/save', {
        method: 'POST',
        body: JSON.stringify({ ...input, author: currentReviewer() })
      })
      return { slug: res.slug, snapshot: await snapshot() }
    }
    if (!store) throw new Error('尚未打开知识库')
    if (activeController) throw new Error('请先完成或取消当前整理')
    const saved = await store.saveManualPage(input, currentReviewer())
    return { slug: saved.slug, snapshot: await snapshot() }
  })
  ipcMain.handle('workspace:publish-page', async (_event, slug: string) => {
    if (getRemoteServerConfig()) {
      await remoteRequest('/api/publish', { method: 'POST', body: JSON.stringify({ slug, reviewer: currentReviewer() }) })
      return await snapshot()
    }
    if (!store) throw new Error('尚未打开知识库')
    if (activeController) throw new Error('请先完成或取消当前整理')
    await store.publishPage(slug, currentReviewer())
    return await snapshot()
  })
  ipcMain.handle('workspace:publish-all', async () => {
    if (getRemoteServerConfig()) {
      await remoteRequest('/api/publish-all', { method: 'POST' })
      return await snapshot()
    }
    if (!store) throw new Error('尚未打开知识库')
    if (activeController) throw new Error('请先完成或取消当前整理')
    await store.publishAllDrafts(currentReviewer())
    return await snapshot()
  })
  ipcMain.handle(
    'workspace:transition-workflow',
    async (_event, slug: string, action: WorkflowAction, note?: string) => {
      assertPermission(adminAuth?.getDesktopUser()?.role, permissionForWorkflowAction(action), `工作流操作:${action}`)
      if (getRemoteServerConfig()) {
        await remoteRequest('/api/workflow/transition', {
          method: 'POST',
          body: JSON.stringify({ slug, action, note })
        })
        return await snapshot()
      }
      if (!store) throw new Error('尚未打开知识库')
      if (activeController) throw new Error('请先完成或取消当前整理')
      await store.transitionWorkflow(slug, action, currentReviewer(), note ?? '')
      return await snapshot()
    }
  )
  ipcMain.handle('workspace:purge-deleted', async (_event, slug: string) => {
    assertPermission(adminAuth?.getDesktopUser()?.role, 'manage_versions_high_risk', '彻底清理回收站页面')
    if (getRemoteServerConfig()) {
      await remoteRequest('/api/pages/purge', { method: 'POST', body: JSON.stringify({ slug }) })
      return await snapshot()
    }
    if (!store) throw new Error('尚未打开知识库')
    if (activeController) throw new Error('请先完成或取消当前整理')
    await store.purgeDeletedPage(slug, currentReviewer())
    return await snapshot()
  })
  ipcMain.handle('workspace:list-versions', async (_event, slug: string): Promise<PageVersionSnapshot[]> => {
    if (getRemoteServerConfig()) {
      return remoteRequest(`/api/versions?slug=${encodeURIComponent(slug)}`)
    }
    if (!store) throw new Error('尚未打开知识库')
    return store.listPageVersions(slug)
  })
  ipcMain.handle('workspace:rollback-version', async (_event, slug: string, versionLabel: string) => {
    assertPermission(adminAuth?.getDesktopUser()?.role, 'manage_versions_high_risk', '回滚历史版本')
    if (getRemoteServerConfig()) {
      await remoteRequest('/api/versions/rollback', {
        method: 'POST',
        body: JSON.stringify({ slug, versionLabel })
      })
      return await snapshot()
    }
    if (!store) throw new Error('尚未打开知识库')
    if (activeController) throw new Error('请先完成或取消当前整理')
    await store.rollbackPageVersion(slug, versionLabel, currentReviewer())
    return await snapshot()
  })
  ipcMain.handle('workspace:page-diff', async (_event, slug: string): Promise<PageDiffResult> => {
    if (getRemoteServerConfig()) {
      return remoteRequest(`/api/diff?slug=${encodeURIComponent(slug)}`)
    }
    if (!store) throw new Error('尚未打开知识库')
    return store.getPageDiff(slug)
  })
  ipcMain.handle('workspace:lint', async (): Promise<WikiLintReport> => {
    if (getRemoteServerConfig()) {
      return remoteRequest('/api/lint')
    }
    if (!store) throw new Error('尚未打开知识库')
    return runWikiLint(store)
  })
  ipcMain.handle('workspace:lint-fix', async (): Promise<WikiLintFixResult> => {
    if (getRemoteServerConfig()) {
      return remoteRequest('/api/lint/fix', { method: 'POST' })
    }
    if (!store) throw new Error('尚未打开知识库')
    if (activeController) throw new Error('请先完成或取消当前整理')
    return fixWikiLint(store)
  })
  ipcMain.handle('workspace:schema-overview', async (): Promise<SchemaOverview> => {
    if (getRemoteServerConfig()) {
      return remoteRequest('/api/v1/schema')
    }
    if (!store) throw new Error('尚未打开知识库')
    return store.getSchemaOverview()
  })
  ipcMain.handle('workspace:graph', async (_event, maxEntities?: number) => {
    if (getRemoteServerConfig()) {
      const q = typeof maxEntities === 'number' ? `?maxEntities=${Math.round(maxEntities)}` : ''
      return remoteRequest(`/api/v1/graph${q}`)
    }
    if (!store) throw new Error('尚未打开知识库')
    return store.getKnowledgeGraph(typeof maxEntities === 'number' ? maxEntities : 90)
  })
  ipcMain.handle(
    'workspace:search',
    async (_event, query: string, options?: { includeDrafts?: boolean; includeSources?: boolean; domain?: StorageDomain }) => {
      if (getRemoteServerConfig()) {
        return remoteRequest('/api/v1/search', { method: 'POST', body: JSON.stringify({ query, ...options }) })
      }
      if (!store) throw new Error('尚未打开知识库')
      return searchKnowledge(store, settings.model, query, options)
    }
  )
  ipcMain.handle(
    'workspace:ask',
    async (
      _event,
      question: string,
      options?: {
        includeDrafts?: boolean
        includeSources?: boolean
        domain?: StorageDomain
        history?: import('../shared/types').QaHistoryTurn[]
      }
    ) => {
      if (getRemoteServerConfig()) {
        return remoteRequest('/api/v1/ask', { method: 'POST', body: JSON.stringify({ question, ...options }), timeoutMs: 120_000 })
      }
      if (!store) throw new Error('尚未打开知识库')
      if (!modelOnline) await refreshModels()
      if (!modelOnline) throw new Error('无法连接当前模型服务，请检查模型设置')
      return askKnowledgeBase(store, settings.model, question, options)
    }
  )
  ipcMain.handle(
    'workspace:feedback',
    async (
      _event,
      entry: { question: string; rating: 'helpful' | 'needs_fix'; comment: string; citedSlugs: string[] }
    ) => {
      if (getRemoteServerConfig()) {
        await remoteRequest('/api/v1/feedback', { method: 'POST', body: JSON.stringify(entry) })
        return await snapshot()
      }
      if (!store) throw new Error('尚未打开知识库')
      store.recordFeedback(entry)
      return await snapshot()
    }
  )
  ipcMain.handle('workspace:set-model', async (_event, input: Partial<ModelProviderSettings>) => {
    assertPermission(adminAuth?.getDesktopUser()?.role, 'manage_models', '修改模型配置')
    if (!input || typeof input !== 'object') throw new Error('模型设置格式无效')
    return applyModelSettings(input)
  })
  ipcMain.handle('workspace:refresh-models', async () => {
    await refreshModels()
    return await snapshot()
  })
  ipcMain.handle('workspace:open-source', async (_event, file: string) => {
    const remoteCfg = getRemoteServerConfig()
    if (remoteCfg) {
      const tokenParam = remoteCfg.token ? `&token=${encodeURIComponent(remoteCfg.token)}` : ''
      await shell.openExternal(`${remoteCfg.url}/api/source?file=${encodeURIComponent(file)}${tokenParam}`)
      return
    }
    if (!store) throw new Error('尚未打开知识库')
    const absolute = path.resolve(store.root, ...file.split('/'))
    const relative = path.relative(store.root, absolute)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('无效的资料路径')
    const error = await shell.openPath(absolute)
    if (error) throw new Error(error)
  })

  // ===== Admin Management IPC Handlers =====
  ipcMain.handle('admin:enter-local', async () => {
    if (!adminAuth) throw new Error('管理员认证服务未就绪')
    adminAuth.enterLocalPasswordless()
    return await snapshot()
  })
  ipcMain.handle('admin:setup', async (_event, username: string, password: string) => {
    if (!adminAuth) throw new Error('管理员认证服务未就绪')
    await adminAuth.setupInitialAdmin(username, password)
    return await snapshot()
  })
  ipcMain.handle('admin:login', async (_event, username: string, password: string) => {
    if (!adminAuth) throw new Error('管理员认证服务未就绪')
    await adminAuth.login(username, password, 'desktop')
    return await snapshot()
  })
  ipcMain.handle('admin:logout', async () => {
    adminAuth?.logout()
    return await snapshot()
  })
  ipcMain.handle('admin:change-password', async (_event, oldPassword: string, newPassword: string) => {
    if (!adminAuth) throw new Error('管理员认证服务未就绪')
    const active = adminAuth.getDesktopUser()
    if (!active) throw new Error('请先登录后台管理员账号')
    await adminAuth.changePassword(active.username, oldPassword, newPassword)
    return await snapshot()
  })
  ipcMain.handle('admin:create-user', async (_event, username: string, password: string, role: AdminRole) => {
    if (!adminAuth) throw new Error('管理员认证服务未就绪')
    await adminAuth.createUser(adminAuth.getDesktopUser(), username, password, role)
    return await snapshot()
  })
  ipcMain.handle('admin:delete-user', async (_event, username: string) => {
    if (!adminAuth) throw new Error('管理员认证服务未就绪')
    await adminAuth.deleteUser(adminAuth.getDesktopUser(), username)
    return await snapshot()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  store?.close()
  store = null
  app.quit()
})
