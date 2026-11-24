import {
  ArrowRight, ArrowUp, BookmarkPlus, BookOpen, Check, CheckCheck, ChevronRight, CircleAlert, Clock3,
  FileText, FolderOpen, History, Layers, LayoutDashboard, LoaderCircle, Minus, Moon,
  PanelLeftClose, PanelLeftOpen, Paperclip, Plus, Search, Settings2, Shield, ShieldCheck,
  Sparkles, Square, Sun, Upload, X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type {
  AdminRole, KnowledgeQueryResult, ManualPageInput, ModelProviderSettings, OrganizeRun, ProgressEvent,
  SchemaOverview, SearchHit, StorageDomain, WikiLintReport, WikiPage, WorkflowAction, WorkspaceSnapshot
} from '../../shared/types'
import { getWorkspaceApi } from './api'
import logo from './assets/zhixu-icon.png'
import wallpaperSky from './assets/wallpaper-sky.jpg'
import wallpaperSunset from './assets/wallpaper-sunset.jpg'
import AdminConsole from './components/AdminConsole'
import CommandPalette from './components/CommandPalette'
import LoginPage from './components/LoginPage'
import SettingsDialog, { fillDraftFromMode } from './components/SettingsDialog'
import { ActivityView, HealthView, PageView } from './components/views'
import { dateFormatter, folderName, providerLabel, storageDomainLabel, workflowStatusLabel } from './labels'

type View = 'home' | 'knowledge' | 'review' | 'health' | 'activity' | 'admin'
type QueryOptions = { includeDrafts: boolean; includeSources: boolean; domain?: StorageDomain }
type ThemeMode = 'light' | 'dark'
type QaTurnItem = {
  id: string
  question: string
  answer: KnowledgeQueryResult | null
  hits: SearchHit[] | null
  feedback: 'helpful' | 'needs_fix' | null
  savedSlug?: string
}

function highlightQueryTerms(text: string, query: string): ReactNode {
  const tokens = [
    ...new Set(
      query
        .trim()
        .split(/[\s,，。；、？！?!]+/)
        .map(t => t.trim())
        .filter(t => t.length >= 2)
    )
  ].slice(0, 6)
  if (!tokens.length) return text
  const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(re)
  return parts.map((part, idx) =>
    idx % 2 === 1 ? (
      <mark key={idx} className="hit-hl">{part}</mark>
    ) : (
      part
    )
  )
}

const NEW_PAGE_TEMPLATE: WikiPage = {
  slug: '__new__',
  title: '',
  summary: '',
  content: '## 概述\n\n',
  sources: [],
  links: [],
  updatedAt: new Date().toISOString(),
  pageType: 'concept',
  status: 'draft',
  evidenceLevel: 'field_record',
  applicability: '通用',
  modelVersion: 'manual',
  reviewedBy: null,
  reviewedAt: null,
  storageDomain: 'foundation',
  versionLabel: 'V0.1'
}

const viewTitles: Record<View, string> = {
  home: '工作台',
  knowledge: '知识库',
  review: '审核队列',
  health: '知识体检',
  activity: '版本审计',
  admin: '系统后台'
}

export default function App() {
  const api = useMemo(() => getWorkspaceApi(), [])
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [view, setView] = useState<View>('home')
  const [selectedSlug, setSelectedSlug] = useState('index')
  const [query, setQuery] = useState('')
  const [knowledgeFilter, setKnowledgeFilter] = useState<'all' | 'published' | 'review'>('all')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return window.localStorage.getItem('zhixu-theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [lintReport, setLintReport] = useState<WikiLintReport | null>(null)
  const [schemaOverview, setSchemaOverview] = useState<SchemaOverview | null>(null)
  const [lintLoading, setLintLoading] = useState(false)
  const [lintFixing, setLintFixing] = useState(false)
  const [modelDraft, setModelDraft] = useState<ModelProviderSettings>({
    mode: 'cloud',
    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    model: ''
  })
  const [question, setQuestion] = useState('')
  const [thread, setThread] = useState<QaTurnItem[]>([])
  const [creatingNewPage, setCreatingNewPage] = useState(false)
  const [qaLoading, setQaLoading] = useState(false)
  const [includeDrafts, setIncludeDrafts] = useState(false)
  const [includeSources, setIncludeSources] = useState(true)
  const [domain, setDomain] = useState<StorageDomain | ''>('')
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const streamEndRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem('zhixu-theme', theme)
    } catch {}
  }, [theme])

  useEffect(() => {
    void api.getSnapshot().then(setSnapshot).catch(showError)
    return api.onProgress(setProgress)
  }, [api])

  useEffect(() => {
    const prevent = (event: globalThis.DragEvent) => event.preventDefault()
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCmdOpen(prev => !prev)
      }
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    document.title = `${viewTitles[view]} — 知序 ZHIXU`
  }, [view])

  const pages = useMemo(() => (snapshot?.pages ?? []).filter(p => p.status !== 'deleted'), [snapshot])
  const selectedPage = (snapshot?.pages ?? []).find(page => page.slug === selectedSlug) ?? null
  const reviewPages = useMemo(
    () => pages.filter(page => page.slug !== 'index' && ['draft', 'moderating', 'validating', 'pending_delete'].includes(page.status)),
    [pages]
  )
  const filteredKnowledgePages = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('zh-CN')
    return pages.filter(page => {
      if (knowledgeFilter === 'published' && page.status !== 'published') return false
      if (knowledgeFilter === 'review' && !['draft', 'moderating', 'validating', 'pending_delete'].includes(page.status)) return false
      if (!term) return true
      return `${page.title} ${page.summary} ${page.content}`.toLocaleLowerCase('zh-CN').includes(term)
    })
  }, [pages, query, knowledgeFilter])
  const recentPages = useMemo(() => pages.filter(page => page.slug !== 'index').slice(0, 8), [pages])
  const queryOptions: QueryOptions = { includeDrafts, includeSources, domain: domain || undefined }

  function showError(reason: unknown) {
    const message = reason instanceof Error ? reason.message : String(reason)
    setError(message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
  }

  function resetConversation() {
    setView('home')
    setQuestion('')
    setThread([])
    window.setTimeout(() => composerInput.current?.focus(), 40)
  }

  function navigate(next: View) {
    setView(next)
    setCreatingNewPage(false)
    if (next === 'knowledge' && !pages.some(page => page.slug === selectedSlug)) {
      setSelectedSlug(pages[0]?.slug ?? 'index')
    }
    if (next === 'health') void refreshLint()
  }

  function openPage(slug: string) {
    setCreatingNewPage(false)
    setSelectedSlug(slug)
    setView('knowledge')
  }

  function startNewManualPage() {
    setCreatingNewPage(true)
    setView('knowledge')
  }

  async function saveManualPage(input: ManualPageInput) {
    setError('')
    try {
      const res = await api.saveManualPage(input)
      setSnapshot(res.snapshot)
      setCreatingNewPage(false)
      setSelectedSlug(res.slug)
      setView('knowledge')
      setNotice(input.publishImmediately ? '页面已保存并发布' : '已保存为知识草稿')
    } catch (reason) {
      showError(reason)
      throw reason
    }
  }

  async function selectWorkspace() {
    setError('')
    try {
      const next = await api.selectWorkspace()
      if (next?.pages) {
        setSnapshot(next)
        setSelectedSlug('index')
        setNotice('知识库目录已更新')
      } else if (next) {
        setNotice(`当前目录：${next.root ?? folderName(next.root ?? '')}`)
      }
    } catch (reason) {
      showError(reason)
    }
  }

  async function importFiles(files: File[]) {
    if (!files.length) return
    setImporting(true)
    setError('')
    try {
      const result = await api.importDroppedFiles(files)
      setSnapshot(result.snapshot)
      if (result.imported.length) {
        setNotice(`已导入 ${result.imported.length} 份资料${result.skipped.length ? `，跳过 ${result.skipped.length} 项` : ''}`)
      } else if (result.skipped.length) {
        showError(result.skipped.join('\n'))
      }
    } catch (reason) {
      showError(reason)
    } finally {
      setImporting(false)
    }
  }

  async function organize() {
    setBusy(true)
    setNotice('')
    setError('')
    setProgress({ stage: 'scan', message: '准备扫描资料', current: 0, total: 1 })
    try {
      const result = await api.organize()
      setSnapshot(result.snapshot)
      setNotice(result.message)
    } catch (reason) {
      showError(reason)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function transitionWorkflow(slug: string, action: WorkflowAction, note?: string) {
    setError('')
    try {
      setSnapshot(await api.transitionWorkflow(slug, action, note))
      setNotice('状态已更新')
    } catch (reason) {
      showError(reason)
    }
  }

  async function publishAllDrafts() {
    try {
      setSnapshot(await api.publishAllDrafts())
      setNotice('全部待审页面已发布')
    } catch (reason) {
      showError(reason)
    }
  }

  async function rollbackVersion(slug: string, versionLabel: string) {
    if (!window.confirm(`确认回滚至 ${versionLabel}？当前版本会自动备份。`)) return
    try {
      setSnapshot(await api.rollbackPageVersion(slug, versionLabel))
      setNotice(`已回滚至 ${versionLabel}`)
    } catch (reason) {
      showError(reason)
    }
  }

  async function undoRun(run: OrganizeRun) {
    if (!window.confirm(`撤销“${run.summary.split('\n')[0]}”产生的页面变更？`)) return
    try {
      setSnapshot(await api.undoRun(run.id))
      setNotice('已撤销这次整理')
    } catch (reason) {
      showError(reason)
    }
  }

  async function refreshLint() {
    setLintLoading(true)
    setError('')
    try {
      const [report, overview] = await Promise.all([api.runLint(), api.getSchemaOverview().catch(() => null)])
      setLintReport(report)
      setSchemaOverview(overview)
    } catch (reason) {
      showError(reason)
    } finally {
      setLintLoading(false)
    }
  }

  async function runLintFix() {
    setLintFixing(true)
    try {
      const result = await api.fixLint()
      setLintReport(result.report)
      setSnapshot(await api.getSnapshot())
      setNotice(result.filesChanged ? `已修复 ${result.filesChanged} 篇页面` : '无断链需要修复')
    } catch (reason) {
      showError(reason)
    } finally {
      setLintFixing(false)
    }
  }

  function openSettings() {
    if (!snapshot) return
    setModelDraft(fillDraftFromMode(snapshot, snapshot.modelProvider.mode ?? 'cloud'))
    settingsDialog.current?.showModal()
  }

  async function saveModelSettings() {
    try {
      setSnapshot(await api.setModel(modelDraft))
      settingsDialog.current?.close()
      setNotice('模型接口设置已保存')
    } catch (reason) {
      showError(reason)
    }
  }

  async function adminLogin(username: string, password: string) {
    setError('')
    try {
      setSnapshot(await api.adminLogin(username, password))
      setNotice(`已登录管理员 ${username}`)
    } catch (reason) {
      showError(reason)
    }
  }

  async function adminLogout() {
    try {
      setSnapshot(await api.adminLogout())
      setNotice('已退出后台')
    } catch (reason) {
      showError(reason)
    }
  }

  async function adminChangePassword(oldPassword: string, newPassword: string) {
    setError('')
    try {
      setSnapshot(await api.adminChangePassword(oldPassword, newPassword))
      setNotice('密码已更新')
    } catch (reason) {
      showError(reason)
    }
  }

  async function adminCreateUser(username: string, password: string, role: AdminRole) {
    setError('')
    try {
      setSnapshot(await api.adminCreateUser(username, password, role))
      setNotice(`已创建账号 ${username}`)
    } catch (reason) {
      showError(reason)
    }
  }

  async function adminDeleteUser(username: string) {
    setError('')
    try {
      setSnapshot(await api.adminDeleteUser(username))
      setNotice(`已删除账号 ${username}`)
    } catch (reason) {
      showError(reason)
    }
  }

  async function purgeDeletedPage(slug: string) {
    setError('')
    try {
      setSnapshot(await api.purgeDeletedPage(slug))
      setNotice('已彻底清理')
    } catch (reason) {
      showError(reason)
    }
  }

  async function refreshModels() {
    try {
      setSnapshot(await api.refreshModels())
    } catch (reason) {
      showError(reason)
    }
  }

  async function openSource(file: string) {
    try {
      await api.openSource(file)
    } catch (reason) {
      showError(reason)
    }
  }

  async function runAsk() {
    if (!question.trim() || qaLoading) return
    const currentQuestion = question.trim()
    setQaLoading(true)
    setQuestion('')
    const history = thread
      .filter(t => t.answer && !t.answer.insufficientEvidence)
      .slice(-3)
      .map(t => ({ question: t.question, conclusion: t.answer!.conclusion }))
    try {
      const result = await api.askKnowledge(currentQuestion, { ...queryOptions, history })
      setThread(prev => [
        ...prev,
        { id: `turn-${Date.now()}`, question: currentQuestion, answer: result, hits: result.hits, feedback: null }
      ])
      window.setTimeout(() => streamEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60)
    } catch (reason) {
      showError(reason)
    } finally {
      setQaLoading(false)
    }
  }

  async function runSearch() {
    if (!question.trim() || qaLoading) return
    const currentQuestion = question.trim()
    setQaLoading(true)
    setQuestion('')
    try {
      const resHits = await api.searchKnowledge(currentQuestion, queryOptions)
      setThread(prev => [
        ...prev,
        { id: `turn-${Date.now()}`, question: currentQuestion, answer: null, hits: resHits, feedback: null }
      ])
      window.setTimeout(() => streamEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60)
    } catch (reason) {
      showError(reason)
    } finally {
      setQaLoading(false)
    }
  }

  async function sendFeedback(turnId: string, rating: 'helpful' | 'needs_fix') {
    const turn = thread.find(t => t.id === turnId)
    if (!turn?.answer) return
    try {
      setSnapshot(
        await api.submitFeedback({
          question: turn.question,
          rating,
          comment: rating === 'helpful' ? '回答准确' : '需要核查补充',
          citedSlugs: turn.answer.citations.map(c => c.slug).filter((s): s is string => Boolean(s))
        })
      )
      setThread(prev => prev.map(t => (t.id === turnId ? { ...t, feedback: rating } : t)))
    } catch (reason) {
      showError(reason)
    }
  }

  async function saveAnswerAsDraft(turnId: string) {
    const turn = thread.find(t => t.id === turnId)
    if (!turn?.answer) return
    const ans = turn.answer
    const mdLines = [
      `## 核心结论\n\n${ans.conclusion}`,
      ans.applicability ? `\n## 适用条件\n\n${ans.applicability}` : '',
      ans.conflicts && ans.conflicts !== '无' ? `\n## 冲突说明\n\n${ans.conflicts}` : '',
      ans.missingInfo && ans.missingInfo !== '无' ? `\n## 待补充项\n\n${ans.missingInfo}` : ''
    ].filter(Boolean)
    const sources = ans.citations
      .filter(c => c.file && c.excerpt)
      .map(c => ({ file: c.file!, locator: c.locator ?? '问答引用', excerpt: c.excerpt ?? '' }))
    try {
      const res = await api.saveManualPage({
        title: turn.question.slice(0, 48),
        summary: ans.conclusion.replace(/\s+/g, ' ').slice(0, 110),
        content: mdLines.join('\n'),
        applicability: ans.applicability,
        sources,
        publishImmediately: false,
        note: '由工作台问答一键沉淀'
      })
      setSnapshot(res.snapshot)
      setThread(prev => prev.map(t => (t.id === turnId ? { ...t, savedSlug: res.slug } : t)))
      setNotice('已沉淀为知识草稿')
    } catch (reason) {
      showError(reason)
    }
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void runAsk()
    }
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current += 1
    setDragActive(true)
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) setDragActive(false)
  }

  async function handleFileDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setDragActive(false)
    await importFiles(Array.from(event.dataTransfer.files))
  }

  if (!snapshot) {
    return (
      <main className="boot-screen">
        <img src={logo} alt="知序" />
        <LoaderCircle className="spin" />
      </main>
    )
  }

  if (!snapshot.adminAuth.authenticated) {
    return (
      <LoginPage
        theme={theme}
        error={error}
        onClearError={() => setError('')}
        onToggleTheme={next => setTheme(next)}
        onLogin={adminLogin}
        windowControls={api.windowControls}
      />
    )
  }

  const navItems: { id: View; label: string; icon: typeof LayoutDashboard; badge?: number }[] = [
    { id: 'home', label: '工作台', icon: LayoutDashboard },
    { id: 'knowledge', label: '知识库', icon: BookOpen, badge: snapshot.publishedCount },
    { id: 'review', label: '审核队列', icon: CheckCheck, badge: snapshot.draftCount },
    { id: 'health', label: '知识体检', icon: ShieldCheck },
    { id: 'activity', label: '版本审计', icon: History },
    { id: 'admin', label: '系统后台', icon: Shield, badge: snapshot.pendingDeleteCount || undefined }
  ]

  return (
    <div
      className={`studio-shell ${sidebarOpen ? '' : 'sidebar-collapsed'} ${dragActive ? 'is-dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={event => void handleFileDrop(event)}
    >
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        multiple
        accept=".pdf,.docx,.xlsx,.pptx,.md,.markdown,.txt,.html,.htm,.csv,.json,.yaml,.yml,.png,.jpg,.jpeg,.webp"
        onChange={event => {
          void importFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />

      {/* Unified Commercial Sidebar */}
      <aside className="studio-sidebar">
        <div className="sidebar-brand-bar">
          <button className="brand-home-btn" onClick={resetConversation}>
            <img src={logo} alt="知序" />
            <span className="brand-title">知序</span>
            <span className="brand-ver">PRO</span>
          </button>
          <button className="icon-btn-sm" onClick={() => setSidebarOpen(false)} aria-label="收起侧栏" title="收起侧栏">
            <PanelLeftClose />
          </button>
        </div>

        <div className="sidebar-controls">
          <button className="cmd-trigger" onClick={() => setCmdOpen(true)}>
            <Search />
            <span>快速检索…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button className="workspace-switcher" onClick={() => void selectWorkspace()} title={snapshot.root ?? '选择知识库目录'}>
            <FolderOpen />
            <span>{snapshot.root ? folderName(snapshot.root) : '选择目录'}</span>
            <ChevronRight />
          </button>
        </div>

        <nav className="nav-section" aria-label="主导航">
          {navItems.map(item => {
            const Icon = item.icon
            const active = view === item.id
            return (
              <button
                key={item.id}
                className={`nav-row ${active ? 'active' : ''}`}
                onClick={() => (item.id === 'home' ? navigate('home') : navigate(item.id))}
                aria-current={active ? 'page' : undefined}
              >
                <Icon />
                <span>{item.label}</span>
                {!!item.badge && <em className="nav-count">{item.badge}</em>}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-tree">
          <div className="tree-heading">
            <span>最近文档</span>
            <button onClick={() => navigate('knowledge')}>全部</button>
          </div>
          <div className="tree-list">
            {recentPages.length ? (
              recentPages.map(page => (
                <button
                  key={page.slug}
                  className={selectedSlug === page.slug && view === 'knowledge' ? 'active' : ''}
                  onClick={() => openPage(page.slug)}
                >
                  <FileText />
                  <span>{page.title}</span>
                  {page.status !== 'published' && <i className={`dot ${page.status}`} />}
                </button>
              ))
            ) : (
              <div className="tree-empty">暂无文档</div>
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          <button className="btn-primary btn-block btn-sm" onClick={() => fileInput.current?.click()} disabled={importing}>
            {importing ? <LoaderCircle className="spin" /> : <Upload />}
            {importing ? '导入中…' : '导入资料'}
          </button>
          <button className="model-footer-row" onClick={openSettings} title="配置 LLLM / LLM / VM">
            <i className={snapshot.modelOnline ? 'online' : ''} />
            <span>{snapshot.modelProvider.model}</span>
            <Settings2 />
          </button>
        </div>
      </aside>

      {/* Elevated Inset Commercial Canvas */}
      <section className="studio-frame">
        <header className="studio-titlebar">
          <div className="titlebar-left">
            {!sidebarOpen && (
              <button className="icon-btn-sm" onClick={() => setSidebarOpen(true)} aria-label="展开侧栏" title="展开侧栏">
                <PanelLeftOpen />
              </button>
            )}
            <div className="breadcrumb">
              <span className="crumb-root">{viewTitles[view]}</span>
              {view === 'knowledge' && selectedPage && (
                <>
                  <ChevronRight />
                  <strong>{selectedPage.title}</strong>
                </>
              )}
              {view === 'home' && thread.length > 0 && (
                <>
                  <ChevronRight />
                  <button className="crumb-reset" onClick={resetConversation}>新对话 ({thread.length})</button>
                </>
              )}
            </div>
          </div>

          <div className="titlebar-right">
            <button className="tier-pill-btn" onClick={openSettings} title="点击配置 LLLM / LLM / VM">
              <i className={snapshot.modelOnline ? 'online' : ''} />
              <span>{providerLabel(snapshot.modelProvider)}</span>
            </button>

            {busy ? (
              <button className="btn-secondary btn-sm" onClick={() => void api.cancelOrganize()}>
                <Square /> 取消整理
              </button>
            ) : (
              <button className="btn-primary btn-sm" onClick={() => void organize()} disabled={!snapshot.fileCount}>
                <Sparkles /> {snapshot.pages.length ? '更新知识库' : '开始整理'}
              </button>
            )}

            <button
              className="icon-btn-sm"
              onClick={() => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))}
              aria-label="切换主题"
              title={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
            >
              {theme === 'light' ? <Moon /> : <Sun />}
            </button>

            <button className="icon-btn-sm" onClick={openSettings} aria-label="设置" title="模型接口设置">
              <Settings2 />
            </button>

            {api.windowControls && (
              <div className="win-controls" aria-label="窗口控制">
                <button onClick={() => void api.windowControls?.minimize()} aria-label="最小化"><Minus /></button>
                <button onClick={() => void api.windowControls?.toggleMaximize()} aria-label="最大化"><Square /></button>
                <button className="win-close" onClick={() => void api.windowControls?.close()} aria-label="关闭"><X /></button>
              </div>
            )}
          </div>
        </header>

        {busy && (
          <div className="progress-bar-dock">
            <div className="progress-row">
              <LoaderCircle className="spin" />
              <span>{progress?.message ?? '正在整理'}</span>
              <small className="mono">{progress && progress.total > 1 ? `${progress.current} / ${progress.total}` : ''}</small>
            </div>
            <progress max={progress?.total ?? 1} value={progress?.current || undefined} />
          </div>
        )}

        <main className={`studio-main view-${view}`} tabIndex={-1}>
          {/* VIEW 1: Commercial Operations + AI Copilot Workspace */}
          {view === 'home' && (
            <div className="copilot-layout">
              <div className="copilot-primary">
                <div className="kpi-grid cols-5 compact-kpi">
                  <button className="kpi-cell clickable" onClick={() => navigate('knowledge')}>
                    <span>已发布</span><strong>{snapshot.publishedCount}</strong>
                  </button>
                  <button className="kpi-cell clickable" onClick={() => navigate('review')}>
                    <span>待审核</span><strong>{snapshot.draftCount}</strong>
                  </button>
                  <div className="kpi-cell"><span>原件资料</span><strong>{snapshot.fileCount}</strong></div>
                  <div className="kpi-cell"><span>结构切块</span><strong>{snapshot.chunkCount}</strong></div>
                  <div className="kpi-cell"><span>持久向量</span><strong>{snapshot.cachedEmbeddingCount}</strong></div>
                </div>

                <div className="copilot-stream">
                  {thread.length > 0 ? (
                    <div className="qa-thread">
                      {thread.map(turn => (
                        <div className="qa-turn" key={turn.id}>
                          <div className="qa-prompt-bar">
                            <span className="qa-tag">Q</span>
                            <h2>{turn.question}</h2>
                          </div>

                          {turn.answer && (
                            <article className={`answer-panel ${turn.answer.insufficientEvidence ? 'is-warn' : ''}`}>
                              <div className="answer-panel-head">
                                <strong><Sparkles /> 回答</strong>
                                <span className="mono muted-text">{turn.answer.knowledgeVersion}</span>
                              </div>
                              <p className="answer-body">{turn.answer.conclusion}</p>
                              <div className="answer-meta-grid">
                                <div><h3>适用条件</h3><p>{turn.answer.applicability}</p></div>
                                <div><h3>冲突与缺失</h3><p>{turn.answer.conflicts} · {turn.answer.missingInfo}</p></div>
                              </div>
                              {turn.answer.citations.length > 0 && (
                                <div className="citation-list">
                                  <h3>引用来源</h3>
                                  {turn.answer.citations.map((citation, index) => (
                                    <button
                                      key={index}
                                      onClick={() =>
                                        citation.kind === 'wiki' && citation.slug
                                          ? openPage(citation.slug)
                                          : citation.file
                                            ? void openSource(citation.file)
                                            : undefined
                                      }
                                    >
                                      <FileText />
                                      <span>{citation.label}</span>
                                      <small>{citation.locator}</small>
                                      <ArrowRight />
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="feedback-bar">
                                <button className={turn.feedback === 'helpful' ? 'active' : ''} onClick={() => void sendFeedback(turn.id, 'helpful')} disabled={turn.feedback !== null}>
                                  <Check /> 有帮助
                                </button>
                                <button className={turn.feedback === 'needs_fix' ? 'active' : ''} onClick={() => void sendFeedback(turn.id, 'needs_fix')} disabled={turn.feedback !== null}>
                                  <CircleAlert /> 需修正
                                </button>
                                {turn.savedSlug ? (
                                  <button className="btn-saved" onClick={() => openPage(turn.savedSlug!)}>
                                    <Check /> 查看沉淀草稿
                                  </button>
                                ) : (
                                  <button className="save-draft-btn" onClick={() => void saveAnswerAsDraft(turn.id)}>
                                    <BookmarkPlus /> 沉淀为草稿
                                  </button>
                                )}
                              </div>
                            </article>
                          )}

                          {turn.hits && (
                            <div className="evidence-section">
                              <div className="section-bar">
                                <h3>命中证据 ({turn.hits.length})</h3>
                              </div>
                              {turn.hits.length ? (
                                <div className="data-table">
                                  {turn.hits.map(hit => (
                                    <div className="table-row cols-evidence" key={hit.id}>
                                      <span className="meta-pill">
                                        {hit.kind === 'wiki' ? 'Wiki' : hit.kind === 'chunk' ? '切块' : '笔记'} · {hit.score}
                                      </span>
                                      <div className="evidence-copy">
                                        <strong>{highlightQueryTerms(hit.title, turn.question)}</strong>
                                        <p>{highlightQueryTerms(hit.snippet, turn.question)}</p>
                                        {!!hit.matchedEntities?.length && <small>实体：{hit.matchedEntities.join(' / ')}</small>}
                                      </div>
                                      <div>
                                        {hit.kind === 'wiki' && hit.slug ? (
                                          <button className="btn-secondary btn-xs" onClick={() => openPage(hit.slug!)}>打开</button>
                                        ) : hit.file ? (
                                          <button className="btn-secondary btn-xs" onClick={() => void openSource(hit.file!)}>原件</button>
                                        ) : null}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="empty-inline">未命中相关证据</div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}

                      {qaLoading && (
                        <div className="inline-loading stream-loading">
                          <LoaderCircle className="spin" />
                          <span>正在结合上下文检索并生成回答…</span>
                        </div>
                      )}
                      <div ref={streamEndRef} />
                    </div>
                  ) : qaLoading ? (
                    <div className="inline-loading stream-loading">
                      <LoaderCircle className="spin" />
                      <span>正在检索并生成回答…</span>
                    </div>
                  ) : (
                    <div className="workspace-overview">
                      <div className="quick-strip">
                        <button className="quick-tile" onClick={() => fileInput.current?.click()}>
                          <Upload />
                          <div><strong>导入资料</strong><small>PDF / DOCX / XLSX / PPTX / 图片</small></div>
                          <ArrowRight />
                        </button>
                        <button className="quick-tile" onClick={startNewManualPage}>
                          <Plus />
                          <div><strong>新建知识页</strong><small>内置分栏 Markdown 编辑</small></div>
                          <ArrowRight />
                        </button>
                        <button className="quick-tile" onClick={() => navigate('review')}>
                          <CheckCheck />
                          <div><strong>审核队列</strong><small>{snapshot.draftCount} 项待审批</small></div>
                          <ArrowRight />
                        </button>
                      </div>

                      <div className="section-bar">
                        <h3>最近更新文档</h3>
                        <button className="link-btn" onClick={() => navigate('knowledge')}>进入知识库</button>
                      </div>

                      {recentPages.length ? (
                        <div className="data-table">
                          <div className="table-head cols-doc">
                            <span>标题</span>
                            <span>知识域</span>
                            <span>状态</span>
                            <span>更新时间</span>
                          </div>
                          {recentPages.map(page => (
                            <button className="table-row cols-doc clickable-row" key={page.slug} onClick={() => openPage(page.slug)}>
                              <span className="doc-cell-title"><FileText /> {page.title}</span>
                              <span className="muted-text">{storageDomainLabel(page.storageDomain ?? 'foundation')}</span>
                              <span><em className={`status-pill ${page.status}`}>{workflowStatusLabel(page.status)}</em></span>
                              <span className="mono muted-text">{dateFormatter.format(new Date(page.updatedAt))}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-box muted">
                          <BookOpen />
                          <h2>暂无知识页面</h2>
                          <div className="head-actions">
                            <button className="btn-primary btn-sm" onClick={() => fileInput.current?.click()}>
                              <Plus /> 导入资料
                            </button>
                            <button className="btn-secondary btn-sm" onClick={startNewManualPage}>
                              <Plus /> 新建页面
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Docked Commercial Command Composer */}
                <div className="docked-composer">
                  <div className="composer-box">
                    <textarea
                      ref={composerInput}
                      value={question}
                      onChange={event => setQuestion(event.target.value)}
                      onKeyDown={composerKeyDown}
                      placeholder="输入问题检索或向知识库提问（Enter 发送，Shift+Enter 换行）…"
                      aria-label="向知识库提问"
                      rows={2}
                    />
                    <div className="composer-bar">
                      <div className="composer-left">
                        <button className="icon-btn-sm" onClick={() => fileInput.current?.click()} title="导入资料">
                          <Paperclip />
                        </button>
                        <button
                          className={`toggle-chip ${includeSources ? 'active' : ''}`}
                          onClick={() => setIncludeSources(!includeSources)}
                        >
                          <Layers /> 原文切块
                        </button>
                        <button
                          className={`toggle-chip ${includeDrafts ? 'active' : ''}`}
                          onClick={() => setIncludeDrafts(!includeDrafts)}
                        >
                          含待审
                        </button>
                        <select
                          className="domain-select"
                          aria-label="知识域"
                          value={domain}
                          onChange={event => setDomain(event.target.value as StorageDomain | '')}
                        >
                          <option value="">全部知识域</option>
                          <option value="foundation">基础概念</option>
                          <option value="domain_knowledge">专业知识</option>
                          <option value="cases">案例复盘</option>
                          <option value="concrete_media">图像与实体</option>
                          <option value="permissions">权限规范</option>
                        </select>
                      </div>
                      <div className="composer-right">
                        <button className="btn-secondary btn-sm" onClick={() => void runSearch()} disabled={!question.trim() || qaLoading}>
                          <Search /> 检索
                        </button>
                        <button className="btn-primary btn-sm" onClick={() => void runAsk()} disabled={!question.trim() || qaLoading}>
                          {qaLoading ? <LoaderCircle className="spin" /> : <ArrowUp />} 提问
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Operations Dock */}
              <aside className="copilot-dock">
                <div
                  className="dock-visual-card"
                  style={{ backgroundImage: `url(${theme === 'dark' ? wallpaperSunset : wallpaperSky})` }}
                >
                  <div className="dock-visual-scrim" />
                  <div className="dock-visual-meta">
                    <span className="dock-visual-status">
                      <i className={snapshot.modelOnline ? 'online' : ''} />
                      {snapshot.modelOnline ? '服务在线' : '待配置'}
                    </span>
                    <button
                      className="dock-theme-chip"
                      onClick={() => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))}
                      title="切换晴空 / 暮光"
                    >
                      {theme === 'light' ? <Moon /> : <Sun />}
                    </button>
                  </div>
                  <div className="dock-visual-foot">
                    <strong>{snapshot.root ? folderName(snapshot.root) : '知序工作区'}</strong>
                    <span className="mono">{snapshot.adminAuth.user?.username ?? 'zhixu'}</span>
                  </div>
                </div>

                <section className="dock-section">
                  <div className="dock-head">
                    <h3>三类接口路由</h3>
                    <button className="link-btn" onClick={openSettings}>配置</button>
                  </div>
                  <div className="tier-mini-list">
                    <button className="tier-mini-row" onClick={openSettings}>
                      <span className="tier-badge lllm">LLLM</span>
                      <span>{snapshot.modelProvider.lllmModel || snapshot.modelProvider.model}</span>
                    </button>
                    <button className="tier-mini-row" onClick={openSettings}>
                      <span className="tier-badge llm">LLM</span>
                      <span>{snapshot.modelProvider.llmModel || snapshot.modelProvider.model}</span>
                    </button>
                    <button className="tier-mini-row" onClick={openSettings}>
                      <span className="tier-badge vm">VM</span>
                      <span>{snapshot.modelProvider.visionModel || '未配置'}</span>
                    </button>
                  </div>
                </section>

                <section className="dock-section">
                  <div className="dock-head">
                    <h3>待审队列 ({reviewPages.length})</h3>
                    {reviewPages.length > 0 && <button className="link-btn" onClick={() => navigate('review')}>全部</button>}
                  </div>
                  {reviewPages.length ? (
                    <div className="dock-queue-list">
                      {reviewPages.slice(0, 6).map(page => (
                        <button key={page.slug} onClick={() => openPage(page.slug)}>
                          <span className="dock-q-title">{page.title}</span>
                          <em className={`status-pill ${page.status}`}>{workflowStatusLabel(page.status)}</em>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="dock-empty">无待审核项</div>
                  )}
                </section>

                <section className="dock-section">
                  <div className="dock-head"><h3>知识底座</h3></div>
                  <div className="stat-kv-list">
                    <div><span>Schema 实体</span><strong className="mono">{snapshot.entityCount}</strong></div>
                    <div><span>双向互索引</span><strong className="mono">{snapshot.mutualLinkCount}</strong></div>
                    <div><span>待删审批</span><strong className="mono">{snapshot.pendingDeleteCount}</strong></div>
                    <div><span>回收站</span><strong className="mono">{snapshot.deletedCount}</strong></div>
                  </div>
                </section>
              </aside>
            </div>
          )}

          {/* VIEW 2: Commercial 3-Pane Knowledge Studio */}
          {view === 'knowledge' && (
            <div className="knowledge-studio">
              <aside className="doc-list-pane">
                <div className="doc-list-top">
                  <div className="doc-search-row">
                    <div className="search-input-wrap">
                      <Search />
                      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="筛选页面…" />
                    </div>
                    <button className="btn-primary btn-xs" onClick={startNewManualPage} title="新建知识页面">
                      <Plus /> 新建
                    </button>
                  </div>
                  <div className="seg-tabs">
                    <button className={knowledgeFilter === 'all' ? 'active' : ''} onClick={() => setKnowledgeFilter('all')}>全部</button>
                    <button className={knowledgeFilter === 'published' ? 'active' : ''} onClick={() => setKnowledgeFilter('published')}>已发布</button>
                    <button className={knowledgeFilter === 'review' ? 'active' : ''} onClick={() => setKnowledgeFilter('review')}>待审</button>
                  </div>
                </div>
                <div className="doc-list-scroll">
                  {filteredKnowledgePages.map(page => (
                    <button
                      key={page.slug}
                      className={`doc-list-item ${selectedSlug === page.slug ? 'active' : ''}`}
                      onClick={() => setSelectedSlug(page.slug)}
                    >
                      <div className="doc-item-row">
                        <strong>{page.title}</strong>
                        <span className="mono">{page.versionLabel ?? 'V1.0'}</span>
                      </div>
                      <div className="doc-item-sub">
                        <span className={`dot ${page.status}`} />
                        <span>{workflowStatusLabel(page.status)}</span>
                        <span>· {page.sources.length} 依据</span>
                      </div>
                    </button>
                  ))}
                  {!filteredKnowledgePages.length && <div className="tree-empty">无匹配页面</div>}
                </div>
              </aside>

              <div className="doc-main-pane">
                {creatingNewPage ? (
                  <PageView
                    page={NEW_PAGE_TEMPLATE}
                    pages={pages}
                    initialEditing={true}
                    onNavigate={openPage}
                    onOpenSource={file => void openSource(file)}
                    onPublish={slug => void transitionWorkflow(slug, 'publish')}
                    onSaveManualPage={saveManualPage}
                    onTransitionWorkflow={(slug, action, note) => void transitionWorkflow(slug, action, note)}
                    onLoadDiff={api.getPageDiff}
                    onLoadVersions={api.listPageVersions}
                    onRollbackVersion={(slug, version) => void rollbackVersion(slug, version)}
                  />
                ) : selectedPage ? (
                  <PageView
                    page={selectedPage}
                    pages={pages}
                    onNavigate={openPage}
                    onOpenSource={file => void openSource(file)}
                    onPublish={slug => void transitionWorkflow(slug, 'publish')}
                    onSaveManualPage={saveManualPage}
                    onTransitionWorkflow={(slug, action, note) => void transitionWorkflow(slug, action, note)}
                    onLoadDiff={api.getPageDiff}
                    onLoadVersions={api.listPageVersions}
                    onRollbackVersion={(slug, version) => void rollbackVersion(slug, version)}
                  />
                ) : (
                  <div className="empty-box muted">
                    <BookOpen />
                    <h2>暂无知识页面</h2>
                    <div className="head-actions">
                      <button className="btn-primary btn-sm" onClick={() => fileInput.current?.click()}>
                        <Plus /> 导入资料
                      </button>
                      <button className="btn-secondary btn-sm" onClick={startNewManualPage}>
                        <Plus /> 新建页面
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VIEW 3: Enterprise Review Table */}
          {view === 'review' && (
            <section className="page-container">
              <header className="page-head">
                <h1>审核队列 ({reviewPages.length})</h1>
                {reviewPages.some(p => p.status !== 'pending_delete') && (
                  <button className="btn-primary btn-sm" onClick={() => void publishAllDrafts()}>
                    <CheckCheck /> 全部发布
                  </button>
                )}
              </header>

              {reviewPages.length ? (
                <div className="data-table">
                  <div className="table-head cols-review">
                    <span>页面</span>
                    <span>状态</span>
                    <span>依据</span>
                    <span>更新时间</span>
                    <span>操作</span>
                  </div>
                  {reviewPages.map(page => (
                    <div className="table-row cols-review" key={page.slug}>
                      <button className="review-cell-main" onClick={() => openPage(page.slug)}>
                        <strong>{page.title}</strong>
                        <small>{page.workflowNote || page.summary}</small>
                      </button>
                      <span><em className={`status-pill ${page.status}`}>{workflowStatusLabel(page.status)}</em></span>
                      <span className="mono muted-text">{page.sources.length}</span>
                      <span className="mono muted-text"><Clock3 className="inline-ico" /> {dateFormatter.format(new Date(page.updatedAt))}</span>
                      <div className="row-actions">
                        <button className="btn-secondary btn-xs" onClick={() => openPage(page.slug)}>详情</button>
                        {page.status === 'pending_delete' ? (
                          <>
                            <button className="btn-secondary btn-xs" onClick={() => void transitionWorkflow(page.slug, 'reject_delete', '驳回删除')}>保留</button>
                            <button className="btn-danger btn-xs" onClick={() => void transitionWorkflow(page.slug, 'confirm_delete', '确认移入回收站')}>移入回收站</button>
                          </>
                        ) : (
                          <button className="btn-primary btn-xs" onClick={() => void transitionWorkflow(page.slug, 'publish')}>发布</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-box"><CheckCheck /><h2>暂无待审核项</h2></div>
              )}
            </section>
          )}

          {view === 'health' && (
            <HealthView
              report={lintReport}
              schemaOverview={schemaOverview}
              loading={lintLoading}
              fixing={lintFixing}
              onRefresh={() => void refreshLint()}
              onFixLint={() => void runLintFix()}
              onOpenPage={openPage}
              onPublishAll={() => void publishAllDrafts().then(refreshLint)}
            />
          )}

          {view === 'activity' && (
            <ActivityView runs={snapshot.runs} modelCalls={snapshot.modelCalls} onUndo={run => void undoRun(run)} />
          )}

          {view === 'admin' && (
            <AdminConsole
              snapshot={snapshot}
              onLogin={adminLogin}
              onLogout={adminLogout}
              onChangePassword={adminChangePassword}
              onCreateUser={adminCreateUser}
              onDeleteUser={adminDeleteUser}
              onOpenSettings={openSettings}
              onSaveModelSettings={async next => {
                setSnapshot(await api.setModel(next))
                setNotice('模型接口设置已保存')
              }}
              onTransitionWorkflow={transitionWorkflow}
              onPurgeDeleted={purgeDeletedPage}
              onOpenPage={openPage}
            />
          )}
        </main>
      </section>

      {dragActive && (
        <div className="drop-overlay">
          <Upload />
          <strong>松手导入资料</strong>
          <span>PDF / DOCX / XLSX / PPTX / MD / TXT / HTML / 图片</span>
        </div>
      )}

      {error && (
        <div className="toast error-toast" role="alert">
          <CircleAlert />
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="关闭"><X /></button>
        </div>
      )}

      {notice && (
        <div className="toast success-toast" role="status">
          <Check />
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="关闭"><X /></button>
        </div>
      )}

      <CommandPalette
        open={cmdOpen}
        pages={pages}
        theme={theme}
        onClose={() => setCmdOpen(false)}
        onNavigate={navigate}
        onOpenPage={openPage}
        onImport={() => fileInput.current?.click()}
        onOrganize={() => void organize()}
        onOpenSettings={openSettings}
        onSelectWorkspace={() => void selectWorkspace()}
        onToggleTheme={() => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))}
      />

      <SettingsDialog
        dialogRef={settingsDialog}
        snapshot={snapshot}
        draft={modelDraft}
        onDraftChange={setModelDraft}
        onClose={() => settingsDialog.current?.close()}
        onSave={() => void saveModelSettings()}
        onRefreshModels={() => void refreshModels()}
        onSelectWorkspace={() => {
          settingsDialog.current?.close()
          void selectWorkspace()
        }}
      />
    </div>
  )
}
