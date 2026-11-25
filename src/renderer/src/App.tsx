import {
  ArrowRight, ArrowUp, BookmarkPlus, BookOpen, Check, CheckCheck, ChevronRight, CircleAlert, Clock3,
  FileText, FolderOpen, History, Languages, Layers, LayoutDashboard, LoaderCircle, Minus, Moon,
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
import BootLoader from './components/BootLoader'
import CommandPalette from './components/CommandPalette'
import LoginPage from './components/LoginPage'
import SettingsDialog, { fillDraftFromMode } from './components/SettingsDialog'
import { ActivityView, HealthView, PageView } from './components/views'
import { useI18n } from './i18n'
import { folderName, providerLabel, storageDomainLabel, workflowStatusLabel } from './labels'

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

export default function App() {
  const { locale, toggleLocale, tx, formatDate } = useI18n()
  const api = useMemo(() => getWorkspaceApi(), [])
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [bootMinElapsed, setBootMinElapsed] = useState(false)
  const [bootDone, setBootDone] = useState(false)
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

  const newPageTemplate = useMemo<WikiPage>(
    () => ({
      slug: '__new__',
      title: '',
      summary: '',
      content: locale === 'en' ? '## Overview\n\n' : '## 概述\n\n',
      sources: [],
      links: [],
      updatedAt: new Date().toISOString(),
      pageType: 'concept',
      status: 'draft',
      evidenceLevel: 'field_record',
      applicability: locale === 'en' ? 'General' : '通用',
      modelVersion: 'manual',
      reviewedBy: null,
      reviewedAt: null,
      storageDomain: 'foundation',
      versionLabel: 'V0.1'
    }),
    [locale]
  )

  const viewTitles = useMemo<Record<View, string>>(
    () => ({
      home: tx('工作台', 'Workspace'),
      knowledge: tx('知识库', 'Knowledge'),
      review: tx('审核队列', 'Review Queue'),
      health: tx('知识体检', 'Health Check'),
      activity: tx('版本审计', 'Version Audit'),
      admin: tx('系统后台', 'Admin Console')
    }),
    [tx]
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem('zhixu-theme', theme)
    } catch {}
  }, [theme])

  useEffect(() => {
    const timer = window.setTimeout(() => setBootMinElapsed(true), 950)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!snapshot || !bootMinElapsed) return
    const fade = window.setTimeout(() => setBootDone(true), 220)
    return () => window.clearTimeout(fade)
  }, [snapshot, bootMinElapsed])

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
    document.title = `${viewTitles[view]} — ${locale === 'en' ? 'ZHIXU' : '知序 ZHIXU'}`
  }, [view, viewTitles, locale])

  const pages = useMemo(() => (snapshot?.pages ?? []).filter(p => p.status !== 'deleted'), [snapshot])
  const selectedPage = (snapshot?.pages ?? []).find(page => page.slug === selectedSlug) ?? null
  const reviewPages = useMemo(
    () => pages.filter(page => page.slug !== 'index' && ['draft', 'moderating', 'validating', 'pending_delete'].includes(page.status)),
    [pages]
  )
  const filteredKnowledgePages = useMemo(() => {
    const lc = locale === 'en' ? 'en-US' : 'zh-CN'
    const term = query.trim().toLocaleLowerCase(lc)
    return pages.filter(page => {
      if (knowledgeFilter === 'published' && page.status !== 'published') return false
      if (knowledgeFilter === 'review' && !['draft', 'moderating', 'validating', 'pending_delete'].includes(page.status)) return false
      if (!term) return true
      return `${page.title} ${page.summary} ${page.content}`.toLocaleLowerCase(lc).includes(term)
    })
  }, [pages, query, knowledgeFilter, locale])
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
      setNotice(input.publishImmediately ? tx('页面已保存并发布', 'Page saved & published') : tx('已保存为知识草稿', 'Saved as draft'))
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
        setNotice(tx('知识库目录已更新', 'Workspace folder updated'))
      } else if (next) {
        setNotice(`${tx('当前目录：', 'Workspace: ')}${next.root ?? folderName(next.root ?? '')}`)
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
        setNotice(
          locale === 'en'
            ? `Imported ${result.imported.length} file(s)${result.skipped.length ? `, skipped ${result.skipped.length}` : ''}`
            : `已导入 ${result.imported.length} 份资料${result.skipped.length ? `，跳过 ${result.skipped.length} 项` : ''}`
        )
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
    setProgress({ stage: 'scan', message: tx('准备扫描资料', 'Scanning source files'), current: 0, total: 1 })
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
      setNotice(tx('状态已更新', 'Status updated'))
    } catch (reason) {
      showError(reason)
    }
  }

  async function publishAllDrafts() {
    try {
      setSnapshot(await api.publishAllDrafts())
      setNotice(tx('全部待审页面已发布', 'All pending pages published'))
    } catch (reason) {
      showError(reason)
    }
  }

  async function rollbackVersion(slug: string, versionLabel: string) {
    const msg =
      locale === 'en'
        ? `Roll back to ${versionLabel}? Current version will be backed up.`
        : `确认回滚至 ${versionLabel}？当前版本会自动备份。`
    if (!window.confirm(msg)) return
    try {
      setSnapshot(await api.rollbackPageVersion(slug, versionLabel))
      setNotice(locale === 'en' ? `Rolled back to ${versionLabel}` : `已回滚至 ${versionLabel}`)
    } catch (reason) {
      showError(reason)
    }
  }

  async function undoRun(run: OrganizeRun) {
    const title = run.summary.split('\n')[0]
    const msg =
      locale === 'en'
        ? `Revert page changes from "${title}"?`
        : `撤销“${title}”产生的页面变更？`
    if (!window.confirm(msg)) return
    try {
      setSnapshot(await api.undoRun(run.id))
      setNotice(tx('已撤销这次整理', 'Compile run reverted'))
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
      setNotice(
        result.filesChanged
          ? locale === 'en'
            ? `Fixed ${result.filesChanged} page(s)`
            : `已修复 ${result.filesChanged} 篇页面`
          : tx('无断链需要修复', 'No broken links to fix')
      )
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
      setNotice(tx('模型接口设置已保存', 'Model API settings saved'))
    } catch (reason) {
      showError(reason)
    }
  }

  async function adminSetup(username: string, password: string) {
    setError('')
    try {
      if (!api.adminSetup) throw new Error('Setup not supported')
      setSnapshot(await api.adminSetup(username, password))
      setNotice(locale === 'en' ? `Initialized superadmin ${username}` : `已初始化超级管理员 ${username}`)
    } catch (reason) {
      showError(reason)
    }
  }

  async function adminLogin(username: string, password: string) {
    setError('')
    try {
      setSnapshot(await api.adminLogin(username, password))
      setNotice(locale === 'en' ? `Signed in as ${username}` : `已登录管理员 ${username}`)
    } catch (reason) {
      showError(reason)
    }
  }

  async function adminLogout() {
    try {
      setSnapshot(await api.adminLogout())
      setNotice(tx('已退出后台', 'Signed out'))
    } catch (reason) {
      showError(reason)
    }
  }

  async function adminChangePassword(oldPassword: string, newPassword: string) {
    setError('')
    try {
      setSnapshot(await api.adminChangePassword(oldPassword, newPassword))
      setNotice(tx('密码已更新', 'Password updated'))
    } catch (reason) {
      showError(reason)
    }
  }

  async function adminCreateUser(username: string, password: string, role: AdminRole) {
    setError('')
    try {
      setSnapshot(await api.adminCreateUser(username, password, role))
      setNotice(locale === 'en' ? `Created account ${username}` : `已创建账号 ${username}`)
    } catch (reason) {
      showError(reason)
    }
  }

  async function adminDeleteUser(username: string) {
    setError('')
    try {
      setSnapshot(await api.adminDeleteUser(username))
      setNotice(locale === 'en' ? `Deleted account ${username}` : `已删除账号 ${username}`)
    } catch (reason) {
      showError(reason)
    }
  }

  async function purgeDeletedPage(slug: string) {
    setError('')
    try {
      setSnapshot(await api.purgeDeletedPage(slug))
      setNotice(tx('已彻底清理', 'Permanently purged'))
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
          comment: rating === 'helpful' ? tx('回答准确', 'Accurate answer') : tx('需要核查补充', 'Needs verification'),
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
    const mdLines =
      locale === 'en'
        ? [
            `## Conclusion\n\n${ans.conclusion}`,
            ans.applicability ? `\n## Applicability\n\n${ans.applicability}` : '',
            ans.conflicts && ans.conflicts !== '无' && ans.conflicts !== 'None' ? `\n## Conflicts\n\n${ans.conflicts}` : '',
            ans.missingInfo && ans.missingInfo !== '无' && ans.missingInfo !== 'None' ? `\n## Gaps\n\n${ans.missingInfo}` : ''
          ].filter(Boolean)
        : [
            `## 核心结论\n\n${ans.conclusion}`,
            ans.applicability ? `\n## 适用条件\n\n${ans.applicability}` : '',
            ans.conflicts && ans.conflicts !== '无' ? `\n## 冲突说明\n\n${ans.conflicts}` : '',
            ans.missingInfo && ans.missingInfo !== '无' ? `\n## 待补充项\n\n${ans.missingInfo}` : ''
          ].filter(Boolean)
    const sources = ans.citations
      .filter(c => c.file && c.excerpt)
      .map(c => ({ file: c.file!, locator: c.locator ?? tx('问答引用', 'Q&A Citation'), excerpt: c.excerpt ?? '' }))
    try {
      const res = await api.saveManualPage({
        title: turn.question.slice(0, 48),
        summary: ans.conclusion.replace(/\s+/g, ' ').slice(0, 110),
        content: mdLines.join('\n'),
        applicability: ans.applicability,
        sources,
        publishImmediately: false,
        note: tx('由工作台问答一键沉淀', 'Saved from Q&A workspace')
      })
      setSnapshot(res.snapshot)
      setThread(prev => prev.map(t => (t.id === turnId ? { ...t, savedSlug: res.slug } : t)))
      setNotice(tx('已沉淀为知识草稿', 'Saved as knowledge draft'))
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

  if (!snapshot || !bootDone) {
    return <BootLoader exiting={Boolean(snapshot && bootMinElapsed)} />
  }

  if (!snapshot.adminAuth.authenticated) {
    return (
      <LoginPage
        theme={theme}
        needsSetup={Boolean(snapshot.adminAuth.needsSetup)}
        minPasswordLength={snapshot.adminAuth.minPasswordLength ?? 12}
        error={error}
        onClearError={() => setError('')}
        onToggleTheme={next => setTheme(next)}
        onSetup={adminSetup}
        onLogin={adminLogin}
        windowControls={api.windowControls}
      />
    )
  }

  const navItems: { id: View; label: string; icon: typeof LayoutDashboard; badge?: number }[] = [
    { id: 'home', label: viewTitles.home, icon: LayoutDashboard },
    { id: 'knowledge', label: viewTitles.knowledge, icon: BookOpen, badge: snapshot.publishedCount },
    { id: 'review', label: viewTitles.review, icon: CheckCheck, badge: snapshot.draftCount },
    { id: 'health', label: viewTitles.health, icon: ShieldCheck },
    { id: 'activity', label: viewTitles.activity, icon: History },
    { id: 'admin', label: viewTitles.admin, icon: Shield, badge: snapshot.pendingDeleteCount || undefined }
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
            <img src={logo} alt={tx('知序', 'ZHIXU')} />
            <span className="brand-title">{tx('知序', 'ZHIXU')}</span>
            <span className="brand-ver">PRO</span>
          </button>
          <button className="icon-btn-sm" onClick={() => setSidebarOpen(false)} aria-label={tx('收起侧栏', 'Collapse sidebar')} title={tx('收起侧栏', 'Collapse sidebar')}>
            <PanelLeftClose />
          </button>
        </div>

        <div className="sidebar-controls">
          <button className="cmd-trigger" onClick={() => setCmdOpen(true)}>
            <Search />
            <span>{tx('快速检索…', 'Quick search…')}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button className="workspace-switcher" onClick={() => void selectWorkspace()} title={snapshot.root ?? tx('选择知识库目录', 'Select workspace folder')}>
            <FolderOpen />
            <span>{snapshot.root ? folderName(snapshot.root) : tx('选择目录', 'Select folder')}</span>
            <ChevronRight />
          </button>
        </div>

        <nav className="nav-section" aria-label={tx('主导航', 'Primary navigation')}>
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
            <span>{tx('最近文档', 'Recent Pages')}</span>
            <button onClick={() => navigate('knowledge')}>{tx('全部', 'All')}</button>
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
              <div className="tree-empty">{tx('暂无文档', 'No pages yet')}</div>
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          <button className="btn-primary btn-block btn-sm" onClick={() => fileInput.current?.click()} disabled={importing}>
            {importing ? <LoaderCircle className="spin" /> : <Upload />}
            {importing ? tx('导入中…', 'Importing…') : tx('导入资料', 'Import Files')}
          </button>
          <button className="model-footer-row" onClick={openSettings} title={tx('配置 LLLM / LLM / VM', 'Configure LLLM / LLM / VM')}>
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
              <button className="icon-btn-sm" onClick={() => setSidebarOpen(true)} aria-label={tx('展开侧栏', 'Expand sidebar')} title={tx('展开侧栏', 'Expand sidebar')}>
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
                  <button className="crumb-reset" onClick={resetConversation}>
                    {tx('新对话', 'New Thread')} ({thread.length})
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="titlebar-right">
            <button className="tier-pill-btn" onClick={openSettings} title={tx('点击配置 LLLM / LLM / VM', 'Configure LLLM / LLM / VM')}>
              <i className={snapshot.modelOnline ? 'online' : ''} />
              <span>{providerLabel(snapshot.modelProvider, locale)}</span>
            </button>

            {busy ? (
              <button className="btn-secondary btn-sm" onClick={() => void api.cancelOrganize()}>
                <Square /> {tx('取消整理', 'Cancel')}
              </button>
            ) : (
              <button className="btn-primary btn-sm" onClick={() => void organize()} disabled={!snapshot.fileCount}>
                <Sparkles /> {snapshot.pages.length ? tx('更新知识库', 'Compile Wiki') : tx('开始整理', 'Build Wiki')}
              </button>
            )}

            <button
              className="lang-btn"
              onClick={toggleLocale}
              aria-label={tx('切换语言', 'Switch language')}
              title={locale === 'zh' ? 'Switch to English' : '切换为简体中文'}
            >
              <Languages />
              <span>{locale === 'zh' ? 'EN' : '中文'}</span>
            </button>

            <button
              className="icon-btn-sm"
              onClick={() => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))}
              aria-label={tx('切换主题', 'Toggle theme')}
              title={theme === 'light' ? tx('切换深色模式', 'Switch to Dark Mode') : tx('切换浅色模式', 'Switch to Light Mode')}
            >
              {theme === 'light' ? <Moon /> : <Sun />}
            </button>

            <button className="icon-btn-sm" onClick={openSettings} aria-label={tx('设置', 'Settings')} title={tx('模型接口设置', 'Model API Settings')}>
              <Settings2 />
            </button>

            {api.windowControls && (
              <div className="win-controls" aria-label={tx('窗口控制', 'Window controls')}>
                <button onClick={() => void api.windowControls?.minimize()} aria-label={tx('最小化', 'Minimize')}><Minus /></button>
                <button onClick={() => void api.windowControls?.toggleMaximize()} aria-label={tx('最大化', 'Maximize')}><Square /></button>
                <button className="win-close" onClick={() => void api.windowControls?.close()} aria-label={tx('关闭', 'Close')}><X /></button>
              </div>
            )}
          </div>
        </header>

        {busy && (
          <div className="progress-bar-dock">
            <div className="progress-row">
              <LoaderCircle className="spin" />
              <span>{progress?.message ?? tx('正在整理', 'Compiling')}</span>
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
                    <span>{tx('已发布', 'Published')}</span><strong>{snapshot.publishedCount}</strong>
                  </button>
                  <button className="kpi-cell clickable" onClick={() => navigate('review')}>
                    <span>{tx('待审核', 'Pending')}</span><strong>{snapshot.draftCount}</strong>
                  </button>
                  <div className="kpi-cell"><span>{tx('原件资料', 'Sources')}</span><strong>{snapshot.fileCount}</strong></div>
                  <div className="kpi-cell"><span>{tx('结构切块', 'Chunks')}</span><strong>{snapshot.chunkCount}</strong></div>
                  <div className="kpi-cell"><span>{tx('持久向量', 'Vectors')}</span><strong>{snapshot.cachedEmbeddingCount}</strong></div>
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
                                <strong><Sparkles /> {tx('回答', 'Answer')}</strong>
                                <span className="mono muted-text">{turn.answer.knowledgeVersion}</span>
                              </div>
                              <p className="answer-body">{turn.answer.conclusion}</p>
                              <div className="answer-meta-grid">
                                <div><h3>{tx('适用条件', 'Applicability')}</h3><p>{turn.answer.applicability}</p></div>
                                <div><h3>{tx('冲突与缺失', 'Conflicts & Gaps')}</h3><p>{turn.answer.conflicts} · {turn.answer.missingInfo}</p></div>
                              </div>
                              {turn.answer.citations.length > 0 && (
                                <div className="citation-list">
                                  <h3>{tx('引用来源', 'Citations')}</h3>
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
                                  <Check /> {tx('有帮助', 'Helpful')}
                                </button>
                                <button className={turn.feedback === 'needs_fix' ? 'active' : ''} onClick={() => void sendFeedback(turn.id, 'needs_fix')} disabled={turn.feedback !== null}>
                                  <CircleAlert /> {tx('需修正', 'Needs Fix')}
                                </button>
                                {turn.savedSlug ? (
                                  <button className="btn-saved" onClick={() => openPage(turn.savedSlug!)}>
                                    <Check /> {tx('查看沉淀草稿', 'Open Draft')}
                                  </button>
                                ) : (
                                  <button className="save-draft-btn" onClick={() => void saveAnswerAsDraft(turn.id)}>
                                    <BookmarkPlus /> {tx('沉淀为草稿', 'Save as Draft')}
                                  </button>
                                )}
                              </div>
                            </article>
                          )}

                          {turn.hits && (
                            <div className="evidence-section">
                              <div className="section-bar">
                                <h3>{tx('命中证据', 'Matched Evidence')} ({turn.hits.length})</h3>
                              </div>
                              {turn.hits.length ? (
                                <div className="data-table">
                                  {turn.hits.map(hit => (
                                    <div className="table-row cols-evidence" key={hit.id}>
                                      <span className="meta-pill">
                                        {hit.kind === 'wiki' ? 'Wiki' : hit.kind === 'chunk' ? tx('切块', 'Chunk') : tx('笔记', 'Note')} · {hit.score}
                                      </span>
                                      <div className="evidence-copy">
                                        <strong>{highlightQueryTerms(hit.title, turn.question)}</strong>
                                        <p>{highlightQueryTerms(hit.snippet, turn.question)}</p>
                                        {!!hit.matchedEntities?.length && <small>{tx('实体：', 'Entities: ')}{hit.matchedEntities.join(' / ')}</small>}
                                      </div>
                                      <div>
                                        {hit.kind === 'wiki' && hit.slug ? (
                                          <button className="btn-secondary btn-xs" onClick={() => openPage(hit.slug!)}>{tx('打开', 'Open')}</button>
                                        ) : hit.file ? (
                                          <button className="btn-secondary btn-xs" onClick={() => void openSource(hit.file!)}>{tx('原件', 'Source')}</button>
                                        ) : null}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="empty-inline">{tx('未命中相关证据', 'No matching evidence')}</div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}

                      {qaLoading && (
                        <div className="inline-loading stream-loading">
                          <LoaderCircle className="spin" />
                          <span>{tx('正在结合上下文检索并生成回答…', 'Retrieving context and generating answer…')}</span>
                        </div>
                      )}
                      <div ref={streamEndRef} />
                    </div>
                  ) : qaLoading ? (
                    <div className="inline-loading stream-loading">
                      <LoaderCircle className="spin" />
                      <span>{tx('正在检索并生成回答…', 'Searching and generating answer…')}</span>
                    </div>
                  ) : (
                    <div className="workspace-overview">
                      <div className="quick-strip">
                        <button className="quick-tile" onClick={() => fileInput.current?.click()}>
                          <Upload />
                          <div><strong>{tx('导入资料', 'Import Files')}</strong><small>{tx('PDF / DOCX / XLSX / PPTX / 图片', 'PDF / DOCX / XLSX / PPTX / Images')}</small></div>
                          <ArrowRight />
                        </button>
                        <button className="quick-tile" onClick={startNewManualPage}>
                          <Plus />
                          <div><strong>{tx('新建知识页', 'New Wiki Page')}</strong><small>{tx('内置分栏 Markdown 编辑', 'Split Markdown Editor')}</small></div>
                          <ArrowRight />
                        </button>
                        <button className="quick-tile" onClick={() => navigate('review')}>
                          <CheckCheck />
                          <div><strong>{tx('审核队列', 'Review Queue')}</strong><small>{locale === 'en' ? `${snapshot.draftCount} pending` : `${snapshot.draftCount} 项待审批`}</small></div>
                          <ArrowRight />
                        </button>
                      </div>

                      <div className="section-bar">
                        <h3>{tx('最近更新文档', 'Recently Updated')}</h3>
                        <button className="link-btn" onClick={() => navigate('knowledge')}>{tx('进入知识库', 'Browse All')}</button>
                      </div>

                      {recentPages.length ? (
                        <div className="data-table">
                          <div className="table-head cols-doc">
                            <span>{tx('标题', 'Title')}</span>
                            <span>{tx('知识域', 'Domain')}</span>
                            <span>{tx('状态', 'Status')}</span>
                            <span>{tx('更新时间', 'Updated')}</span>
                          </div>
                          {recentPages.map(page => (
                            <button className="table-row cols-doc clickable-row" key={page.slug} onClick={() => openPage(page.slug)}>
                              <span className="doc-cell-title"><FileText /> {page.title}</span>
                              <span className="muted-text">{storageDomainLabel(page.storageDomain ?? 'foundation', locale)}</span>
                              <span><em className={`status-pill ${page.status}`}>{workflowStatusLabel(page.status, locale)}</em></span>
                              <span className="mono muted-text">{formatDate(page.updatedAt)}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-box muted">
                          <BookOpen />
                          <h2>{tx('暂无知识页面', 'No knowledge pages')}</h2>
                          <div className="head-actions">
                            <button className="btn-primary btn-sm" onClick={() => fileInput.current?.click()}>
                              <Plus /> {tx('导入资料', 'Import Files')}
                            </button>
                            <button className="btn-secondary btn-sm" onClick={startNewManualPage}>
                              <Plus /> {tx('新建页面', 'New Page')}
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
                      placeholder={tx('输入问题检索或向知识库提问（Enter 发送，Shift+Enter 换行）…', 'Search or ask the knowledge base (Enter to ask, Shift+Enter for newline)…')}
                      aria-label={tx('向知识库提问', 'Ask the knowledge base')}
                      rows={2}
                    />
                    <div className="composer-bar">
                      <div className="composer-left">
                        <button className="icon-btn-sm" onClick={() => fileInput.current?.click()} title={tx('导入资料', 'Import Files')}>
                          <Paperclip />
                        </button>
                        <button
                          className={`toggle-chip ${includeSources ? 'active' : ''}`}
                          onClick={() => setIncludeSources(!includeSources)}
                        >
                          <Layers /> {tx('原文切块', 'Source Chunks')}
                        </button>
                        <button
                          className={`toggle-chip ${includeDrafts ? 'active' : ''}`}
                          onClick={() => setIncludeDrafts(!includeDrafts)}
                        >
                          {tx('含待审', 'Include Drafts')}
                        </button>
                        <select
                          className="domain-select"
                          aria-label={tx('知识域', 'Knowledge domain')}
                          value={domain}
                          onChange={event => setDomain(event.target.value as StorageDomain | '')}
                        >
                          <option value="">{tx('全部知识域', 'All Domains')}</option>
                          <option value="foundation">{tx('基础概念', 'Foundation')}</option>
                          <option value="domain_knowledge">{tx('专业知识', 'Domain Knowledge')}</option>
                          <option value="cases">{tx('案例复盘', 'Cases')}</option>
                          <option value="concrete_media">{tx('图像与实体', 'Media & Entities')}</option>
                          <option value="permissions">{tx('权限规范', 'Permissions')}</option>
                        </select>
                      </div>
                      <div className="composer-right">
                        <button className="btn-secondary btn-sm" onClick={() => void runSearch()} disabled={!question.trim() || qaLoading}>
                          <Search /> {tx('检索', 'Search')}
                        </button>
                        <button className="btn-primary btn-sm" onClick={() => void runAsk()} disabled={!question.trim() || qaLoading}>
                          {qaLoading ? <LoaderCircle className="spin" /> : <ArrowUp />} {tx('提问', 'Ask')}
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
                      {snapshot.modelOnline ? tx('服务在线', 'Online') : tx('待配置', 'Setup Needed')}
                    </span>
                    <button
                      className="dock-theme-chip"
                      onClick={() => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))}
                      title={tx('切换晴空 / 暮光', 'Switch Sky / Sunset')}
                    >
                      {theme === 'light' ? <Moon /> : <Sun />}
                    </button>
                  </div>
                  <div className="dock-visual-foot">
                    <strong>{snapshot.root ? folderName(snapshot.root) : tx('知序工作区', 'ZHIXU Workspace')}</strong>
                    <span className="mono">{snapshot.adminAuth.user?.username ?? 'zhixu'}</span>
                  </div>
                </div>

                <section className="dock-section">
                  <div className="dock-head">
                    <h3>{tx('三类接口路由', '3-Tier Routing')}</h3>
                    <button className="link-btn" onClick={openSettings}>{tx('配置', 'Edit')}</button>
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
                      <span>{snapshot.modelProvider.visionModel || tx('未配置', 'Not set')}</span>
                    </button>
                  </div>
                </section>

                <section className="dock-section">
                  <div className="dock-head">
                    <h3>{tx('待审队列', 'Pending Review')} ({reviewPages.length})</h3>
                    {reviewPages.length > 0 && <button className="link-btn" onClick={() => navigate('review')}>{tx('全部', 'All')}</button>}
                  </div>
                  {reviewPages.length ? (
                    <div className="dock-queue-list">
                      {reviewPages.slice(0, 6).map(page => (
                        <button key={page.slug} onClick={() => openPage(page.slug)}>
                          <span className="dock-q-title">{page.title}</span>
                          <em className={`status-pill ${page.status}`}>{workflowStatusLabel(page.status, locale)}</em>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="dock-empty">{tx('无待审核项', 'Queue clear')}</div>
                  )}
                </section>

                <section className="dock-section">
                  <div className="dock-head"><h3>{tx('知识底座', 'Index Metrics')}</h3></div>
                  <div className="stat-kv-list">
                    <div><span>{tx('Schema 实体', 'Schema Entities')}</span><strong className="mono">{snapshot.entityCount}</strong></div>
                    <div><span>{tx('双向互索引', 'Mutual Links')}</span><strong className="mono">{snapshot.mutualLinkCount}</strong></div>
                    <div><span>{tx('待删审批', 'Pending Delete')}</span><strong className="mono">{snapshot.pendingDeleteCount}</strong></div>
                    <div><span>{tx('回收站', 'Recycle Bin')}</span><strong className="mono">{snapshot.deletedCount}</strong></div>
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
                      <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tx('筛选页面…', 'Filter pages…')} />
                    </div>
                    <button className="btn-primary btn-xs" onClick={startNewManualPage} title={tx('新建知识页面', 'New Wiki Page')}>
                      <Plus /> {tx('新建', 'New')}
                    </button>
                  </div>
                  <div className="seg-tabs">
                    <button className={knowledgeFilter === 'all' ? 'active' : ''} onClick={() => setKnowledgeFilter('all')}>{tx('全部', 'All')}</button>
                    <button className={knowledgeFilter === 'published' ? 'active' : ''} onClick={() => setKnowledgeFilter('published')}>{tx('已发布', 'Published')}</button>
                    <button className={knowledgeFilter === 'review' ? 'active' : ''} onClick={() => setKnowledgeFilter('review')}>{tx('待审', 'Review')}</button>
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
                        <span>{workflowStatusLabel(page.status, locale)}</span>
                        <span>· {locale === 'en' ? `${page.sources.length} src` : `${page.sources.length} 依据`}</span>
                      </div>
                    </button>
                  ))}
                  {!filteredKnowledgePages.length && <div className="tree-empty">{tx('无匹配页面', 'No matching pages')}</div>}
                </div>
              </aside>

              <div className="doc-main-pane">
                {creatingNewPage ? (
                  <PageView
                    page={newPageTemplate}
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
                    <h2>{tx('暂无知识页面', 'No knowledge pages')}</h2>
                    <div className="head-actions">
                      <button className="btn-primary btn-sm" onClick={() => fileInput.current?.click()}>
                        <Plus /> {tx('导入资料', 'Import Files')}
                      </button>
                      <button className="btn-secondary btn-sm" onClick={startNewManualPage}>
                        <Plus /> {tx('新建页面', 'New Page')}
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
                <h1>{tx('审核队列', 'Review Queue')} ({reviewPages.length})</h1>
                {reviewPages.some(p => p.status !== 'pending_delete') && (
                  <button className="btn-primary btn-sm" onClick={() => void publishAllDrafts()}>
                    <CheckCheck /> {tx('全部发布', 'Publish All')}
                  </button>
                )}
              </header>

              {reviewPages.length ? (
                <div className="data-table">
                  <div className="table-head cols-review">
                    <span>{tx('页面', 'Page')}</span>
                    <span>{tx('状态', 'Status')}</span>
                    <span>{tx('依据', 'Sources')}</span>
                    <span>{tx('更新时间', 'Updated')}</span>
                    <span>{tx('操作', 'Actions')}</span>
                  </div>
                  {reviewPages.map(page => (
                    <div className="table-row cols-review" key={page.slug}>
                      <button className="review-cell-main" onClick={() => openPage(page.slug)}>
                        <strong>{page.title}</strong>
                        <small>{page.workflowNote || page.summary}</small>
                      </button>
                      <span><em className={`status-pill ${page.status}`}>{workflowStatusLabel(page.status, locale)}</em></span>
                      <span className="mono muted-text">{page.sources.length}</span>
                      <span className="mono muted-text"><Clock3 className="inline-ico" /> {formatDate(page.updatedAt)}</span>
                      <div className="row-actions">
                        <button className="btn-secondary btn-xs" onClick={() => openPage(page.slug)}>{tx('详情', 'View')}</button>
                        {page.status === 'pending_delete' ? (
                          <>
                            <button className="btn-secondary btn-xs" onClick={() => void transitionWorkflow(page.slug, 'reject_delete', tx('驳回删除', 'Rejected deletion'))}>{tx('保留', 'Keep')}</button>
                            <button className="btn-danger btn-xs" onClick={() => void transitionWorkflow(page.slug, 'confirm_delete', tx('确认移入回收站', 'Moved to recycle bin'))}>{tx('移入回收站', 'Recycle')}</button>
                          </>
                        ) : (
                          <button className="btn-primary btn-xs" onClick={() => void transitionWorkflow(page.slug, 'publish')}>{tx('发布', 'Publish')}</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-box"><CheckCheck /><h2>{tx('暂无待审核项', 'No items pending review')}</h2></div>
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
                setNotice(tx('模型接口设置已保存', 'Model API settings saved'))
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
          <strong>{tx('松手导入资料', 'Drop files to import')}</strong>
          <span>{tx('PDF / DOCX / XLSX / PPTX / MD / TXT / HTML / 图片', 'PDF / DOCX / XLSX / PPTX / MD / TXT / HTML / Images')}</span>
        </div>
      )}

      {error && (
        <div className="toast error-toast" role="alert">
          <CircleAlert />
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label={tx('关闭', 'Close')}><X /></button>
        </div>
      )}

      {notice && (
        <div className="toast success-toast" role="status">
          <Check />
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label={tx('关闭', 'Close')}><X /></button>
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
