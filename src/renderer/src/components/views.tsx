import {
  ArrowRight, ArrowUpRight, Check, CircleAlert, Clock3, Edit3, FileDiff, FileText, GitCommitHorizontal,
  History, Link2, LoaderCircle, Network, RefreshCw, RotateCcw, Save, ShieldAlert, ShieldCheck, Sparkles, X
} from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import type {
  ManualPageInput, ModelCallRecord, OrganizeRun, PageDiffResult, PageVersionSnapshot, SchemaOverview,
  StorageDomain, WikiLintReport, WikiPage, WorkflowAction
} from '../../../shared/types'
import { useI18n } from '../i18n'
import { actionName, evidenceLevelLabel, lintCategoryLabel, severityLabel, storageDomainLabel, workflowStatusLabel } from '../labels'
import { MarkdownView } from './MarkdownView'

type PageViewProps = {
  page: WikiPage
  pages: WikiPage[]
  initialEditing?: boolean
  onNavigate: (slug: string) => void
  onOpenSource: (file: string) => void
  onPublish: (slug: string) => void
  onSaveManualPage: (input: ManualPageInput) => Promise<void>
  onTransitionWorkflow: (slug: string, action: WorkflowAction, note?: string) => void
  onLoadDiff: (slug: string) => Promise<PageDiffResult>
  onLoadVersions: (slug: string) => Promise<PageVersionSnapshot[]>
  onRollbackVersion: (slug: string, versionLabel: string) => void
}

export function PageView({
  page,
  pages,
  initialEditing = false,
  onNavigate,
  onOpenSource,
  onPublish,
  onSaveManualPage,
  onTransitionWorkflow,
  onLoadDiff,
  onLoadVersions,
  onRollbackVersion
}: PageViewProps) {
  const { locale, tx, formatDate } = useI18n()
  const related = page.links.map(slug => pages.find(item => item.slug === slug)).filter((item): item is WikiPage => Boolean(item))
  const backlinks = pages.filter(item => item.slug !== page.slug && item.links.includes(page.slug))
  const [inspectorTab, setInspectorTab] = useState<'sources' | 'graph' | 'versions'>('sources')
  const [showDiff, setShowDiff] = useState(false)
  const [diffData, setDiffData] = useState<PageDiffResult | null>(null)
  const [versions, setVersions] = useState<PageVersionSnapshot[]>([])
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(false)

  const [editing, setEditing] = useState(initialEditing)
  const [saving, setSaving] = useState(false)
  const [draftTitle, setDraftTitle] = useState(page.title)
  const [draftSummary, setDraftSummary] = useState(page.summary)
  const [draftApplicability, setDraftApplicability] = useState(page.applicability)
  const [draftDomain, setDraftDomain] = useState<StorageDomain>(page.storageDomain ?? 'foundation')
  const [draftContent, setDraftContent] = useState(page.content)

  useEffect(() => {
    setShowDiff(false)
    setDiffData(null)
    setVersions([])
    setInspectorTab('sources')
    setEditing(initialEditing)
    setDraftTitle(page.title)
    setDraftSummary(page.summary)
    setDraftApplicability(page.applicability)
    setDraftDomain(page.storageDomain ?? 'foundation')
    setDraftContent(page.content)
  }, [page.slug, page.updatedAt, initialEditing])

  async function saveEdit(publishImmediately: boolean) {
    if (!draftTitle.trim() || !draftContent.trim() || saving) return
    setSaving(true)
    try {
      await onSaveManualPage({
        slug: page.slug === '__new__' ? undefined : page.slug,
        title: draftTitle,
        summary: draftSummary,
        applicability: draftApplicability,
        storageDomain: draftDomain,
        content: draftContent,
        publishImmediately
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void saveEdit(false)
    }
  }

  async function toggleDiff() {
    if (showDiff) {
      setShowDiff(false)
      return
    }
    setLoadingDiff(true)
    try {
      setDiffData(await onLoadDiff(page.slug))
      setShowDiff(true)
    } finally {
      setLoadingDiff(false)
    }
  }

  async function openVersionsTab() {
    setInspectorTab('versions')
    if (versions.length || loadingVersions) return
    setLoadingVersions(true)
    try {
      setVersions(await onLoadVersions(page.slug))
    } finally {
      setLoadingVersions(false)
    }
  }

  if (editing) {
    return (
      <div className="editor-studio">
        <header className="editor-topbar">
          <div className="editor-topbar-left">
            <span className="status-pill draft">{page.slug === '__new__' ? tx('新建页面', 'New Page') : tx('编辑模式', 'Editing')}</span>
            <span className="muted-text mono">{tx('Ctrl+S 保存草稿', 'Ctrl+S Save Draft')}</span>
          </div>
          <div className="head-actions">
            <button className="btn-secondary btn-sm" onClick={() => setEditing(false)} disabled={saving}><X /> {tx('取消', 'Cancel')}</button>
            <button className="btn-secondary btn-sm" onClick={() => void saveEdit(false)} disabled={saving || !draftTitle.trim() || !draftContent.trim()}>
              {saving ? <LoaderCircle className="spin" /> : <Save />} {tx('保存草稿', 'Save Draft')}
            </button>
            <button className="btn-primary btn-sm" onClick={() => void saveEdit(true)} disabled={saving || !draftTitle.trim() || !draftContent.trim()}>
              <Check /> {tx('保存并发布', 'Save & Publish')}
            </button>
          </div>
        </header>

        <div className="editor-meta-bar">
          <input
            className="text-input editor-title-input"
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            placeholder={tx('页面标题', 'Page title')}
          />
          <select
            className="text-input editor-domain-input"
            value={draftDomain}
            onChange={e => setDraftDomain(e.target.value as StorageDomain)}
          >
            <option value="foundation">{storageDomainLabel('foundation', locale)}</option>
            <option value="domain_knowledge">{storageDomainLabel('domain_knowledge', locale)}</option>
            <option value="cases">{storageDomainLabel('cases', locale)}</option>
            <option value="concrete_media">{storageDomainLabel('concrete_media', locale)}</option>
            <option value="permissions">{storageDomainLabel('permissions', locale)}</option>
          </select>
          <input
            className="text-input"
            value={draftSummary}
            onChange={e => setDraftSummary(e.target.value)}
            placeholder={tx('一句话摘要', 'One-line summary')}
          />
          <input
            className="text-input"
            value={draftApplicability}
            onChange={e => setDraftApplicability(e.target.value)}
            placeholder={tx('适用条件', 'Applicability')}
          />
        </div>

        <div className="editor-split">
          <textarea
            className="editor-textarea mono"
            value={draftContent}
            onChange={e => setDraftContent(e.target.value)}
            onKeyDown={handleEditorKeyDown}
            placeholder={tx('使用 Markdown 编写正文，支持 [[页面slug]] 双向引用…', 'Write in Markdown; use [[page-slug]] for wikilinks…')}
          />
          <div className="editor-preview">
            <MarkdownView content={draftContent || tx('*预览区*', '*Preview*')} onNavigate={onNavigate} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="doc-studio">
      <article className="doc-reader">
        <header className="doc-header">
          <div className="doc-tags">
            <span className={`status-pill ${page.status}`}>{workflowStatusLabel(page.status, locale)}</span>
            <span className="meta-pill">{page.versionLabel ?? 'V1.0'}</span>
            <span className="meta-pill">{storageDomainLabel(page.storageDomain ?? 'foundation', locale)}</span>
            <span className="meta-pill">{evidenceLevelLabel(page.evidenceLevel, locale)}</span>
          </div>

          <h1 tabIndex={-1}>{page.title}</h1>
          {page.summary && <p className="doc-summary">{page.summary}</p>}

          <div className="doc-meta-strip">
            <span><Clock3 /> {formatDate(page.updatedAt)}</span>
            <span><Link2 /> {locale === 'en' ? `${page.sources.length} sources` : `${page.sources.length} 条依据`}</span>
            {page.applicability && <span>{tx('适用：', 'Scope: ')}{page.applicability}</span>}
          </div>

          {page.slug !== 'index' && (
            <div className="doc-action-bar">
              <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
                <Edit3 /> {tx('编辑', 'Edit')}
              </button>
              <button className={`btn-secondary btn-sm ${showDiff ? 'is-active' : ''}`} onClick={() => void toggleDiff()} disabled={loadingDiff}>
                <FileDiff /> {showDiff ? tx('收起差异', 'Hide Diff') : tx('对比差异', 'View Diff')}
              </button>
              <button className="btn-secondary btn-sm" onClick={() => void openVersionsTab()}>
                <History /> {tx('版本历史', 'Versions')}
              </button>
              <span className="toolbar-sep" />
              {page.status === 'draft' && (
                <>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'submit_moderation')}>{tx('提交初审', 'Moderate')}</button>
                  <button className="btn-primary btn-sm" onClick={() => onPublish(page.slug)}><Check /> {tx('发布', 'Publish')}</button>
                </>
              )}
              {page.status === 'moderating' && (
                <>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'refuse_moderation', tx('初审退回', 'Returned from moderation'))}>{tx('退回草稿', 'Return Draft')}</button>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'submit_validation')}>{tx('提交终审', 'Validate')}</button>
                  <button className="btn-primary btn-sm" onClick={() => onPublish(page.slug)}><Check /> {tx('发布', 'Publish')}</button>
                </>
              )}
              {page.status === 'validating' && (
                <>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'refuse_validation', tx('终审驳回', 'Rejected in validation'))}>{tx('驳回草稿', 'Reject Draft')}</button>
                  <button className="btn-primary btn-sm" onClick={() => onPublish(page.slug)}><Check /> {tx('终审发布', 'Final Publish')}</button>
                </>
              )}
              {page.status === 'published' && (
                <>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'unpublish', tx('撤回修订', 'Unpublished for revision'))}>{tx('撤回修订', 'Unpublish')}</button>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'archive', tx('人工归档', 'Archived manually'))}>{tx('归档', 'Archive')}</button>
                  <button className="btn-secondary btn-sm danger-outline" onClick={() => onTransitionWorkflow(page.slug, 'confirm_delete', tx('人工移入回收站', 'Moved to recycle bin'))}>{tx('移入回收站', 'Recycle')}</button>
                </>
              )}
              {page.status === 'archived' && (
                <button className="btn-primary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'publish_from_archive')}>
                  <RotateCcw /> {tx('恢复发布', 'Restore & Publish')}
                </button>
              )}
              {page.status === 'pending_delete' && (
                <>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'reject_delete', tx('人工驳回删除并保留', 'Delete rejected manually'))}>
                    <RotateCcw /> {tx('驳回删除', 'Keep Page')}
                  </button>
                  <button className="btn-danger btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'confirm_delete', tx('人工确认移入回收站', 'Confirmed move to recycle bin'))}>
                    {tx('确认移入回收站', 'Move to Recycle Bin')}
                  </button>
                </>
              )}
              {page.status === 'deleted' && (
                <button className="btn-primary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'restore_deleted', tx('从回收站恢复为草稿', 'Restored as draft'))}>
                  <RotateCcw /> {tx('从回收站恢复', 'Restore Draft')}
                </button>
              )}
            </div>
          )}

          {loadingDiff && <div className="inline-loading"><LoaderCircle className="spin" /> {tx('读取差异…', 'Loading diff…')}</div>}
          {showDiff && diffData && (
            <div className="diff-panel">
              <div className="diff-panel-head">
                <span>{diffData.hasBaseline ? tx('与已发布基线对比', 'Diff vs Published Baseline') : tx('新建页面', 'New Page')}</span>
                <span className="mono">+{diffData.addedLines} / −{diffData.removedLines}</span>
              </div>
              {diffData.hunks.length ? (
                <pre className="diff-code">
                  {diffData.hunks.map((hunk, index) => (
                    <div key={index}>
                      <div className="diff-hunk-header">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</div>
                      {hunk.lines.map((line, lineIndex) => (
                        <div key={lineIndex} className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : 'diff-ctx'}>{line}</div>
                      ))}
                    </div>
                  ))}
                </pre>
              ) : (
                <p className="diff-empty">{tx('与已发布基线一致', 'Matches published baseline')}</p>
              )}
            </div>
          )}
        </header>

        <MarkdownView content={page.content} onNavigate={onNavigate} />
      </article>

      <aside className="doc-inspector" aria-label={tx('页面检查器', 'Page Inspector')}>
        <div className="inspector-tabs" role="tablist">
          <button className={inspectorTab === 'sources' ? 'active' : ''} onClick={() => setInspectorTab('sources')}>
            {tx('依据', 'Sources')} ({page.sources.length})
          </button>
          <button className={inspectorTab === 'graph' ? 'active' : ''} onClick={() => setInspectorTab('graph')}>
            {tx('关联', 'Graph')} ({related.length + backlinks.length})
          </button>
          <button className={inspectorTab === 'versions' ? 'active' : ''} onClick={() => void openVersionsTab()}>
            {tx('版本', 'Versions')}
          </button>
        </div>

        <div className="inspector-body">
          {inspectorTab === 'sources' && (
            page.sources.length ? (
              <div className="source-list">
                {page.sources.map((source, index) => (
                  <button className="source-card" key={`${source.file}-${index}`} onClick={() => onOpenSource(source.file)}>
                    <span className="source-file"><FileText /> {source.file}</span>
                    <span className="source-locator">{source.locator}</span>
                    <q>{source.excerpt}</q>
                    <span className="source-open">{tx('打开原件', 'Open Source')} <ArrowUpRight /></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="inspector-empty"><CircleAlert /> {page.slug === 'index' ? tx('导览汇总页', 'Directory Index') : tx('暂无引用', 'No citations')}</div>
            )
          )}

          {inspectorTab === 'graph' && (
            <div className="inspector-graph">
              {!!page.schemaEntities?.length && (
                <section>
                  <h3>{tx('知识实体', 'Entities')} ({page.schemaEntities.length})</h3>
                  <div className="entity-chip-list">
                    {page.schemaEntities.map(entity => <span key={entity}>{entity}</span>)}
                  </div>
                </section>
              )}
              <section>
                <h3>{tx('正向引用', 'Outgoing Links')} ({related.length})</h3>
                {related.length ? (
                  <div className="relation-list">
                    {related.map(item => (
                      <button key={item.slug} onClick={() => onNavigate(item.slug)}>
                        <span>{item.title}</span><ArrowRight />
                      </button>
                    ))}
                  </div>
                ) : <div className="inspector-empty">{tx('无', 'None')}</div>}
              </section>
              <section>
                <h3>{tx('反向链接', 'Backlinks')} ({backlinks.length})</h3>
                {backlinks.length ? (
                  <div className="relation-list">
                    {backlinks.map(item => (
                      <button key={item.slug} onClick={() => onNavigate(item.slug)}>
                        <span>{item.title}</span><ArrowRight />
                      </button>
                    ))}
                  </div>
                ) : <div className="inspector-empty"><Network /> {tx('无', 'None')}</div>}
              </section>
            </div>
          )}

          {inspectorTab === 'versions' && (
            loadingVersions ? (
              <div className="inline-loading"><LoaderCircle className="spin" /> {tx('加载版本…', 'Loading versions…')}</div>
            ) : versions.length ? (
              <ul className="version-list">
                {versions.map(version => (
                  <li key={version.id}>
                    <div>
                      <strong>{version.versionLabel}</strong>
                      <span className="version-kind-tag">
                        {version.status === 'published' ? tx('正式', 'Release') : version.status === 'candidate' ? tx('候补', 'Candidate') : tx('归档', 'Archived')}
                      </span>
                      {version.evalScore !== null && <span className="version-eval-tag">{version.evalScore}</span>}
                      <small>{version.note || version.createdBy} · {formatDate(version.createdAt)}</small>
                    </div>
                    <button className="btn-secondary btn-xs" onClick={() => onRollbackVersion(page.slug, version.versionLabel)}>{tx('回滚', 'Rollback')}</button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="inspector-empty">{tx('暂无历史版本', 'No version history')}</div>
            )
          )}
        </div>
      </aside>
    </div>
  )
}

export function HealthView({
  report,
  schemaOverview,
  loading,
  fixing,
  onRefresh,
  onFixLint,
  onOpenPage,
  onPublishAll
}: {
  report: WikiLintReport | null
  schemaOverview: SchemaOverview | null
  loading: boolean
  fixing: boolean
  onRefresh: () => void
  onFixLint: () => void
  onOpenPage: (slug: string) => void
  onPublishAll: () => void
}) {
  const { locale, tx } = useI18n()
  return (
    <section className="page-container">
      <header className="page-head">
        <h1>{tx('知识体检', 'Health Check')}</h1>
        <div className="head-actions">
          <button className="btn-secondary btn-sm" onClick={onFixLint} disabled={fixing || loading}>
            {fixing ? <LoaderCircle className="spin" /> : <Sparkles />} {tx('修复断链', 'Fix Broken Links')}
          </button>
          {report && report.draftCount > 0 && (
            <button className="btn-secondary btn-sm" onClick={onPublishAll}><Check /> {tx('全部发布', 'Publish All')}</button>
          )}
          <button className="btn-primary btn-sm" onClick={onRefresh} disabled={loading}>
            {loading ? <LoaderCircle className="spin" /> : <RefreshCw />} {tx('重新体检', 'Run Check')}
          </button>
        </div>
      </header>

      {schemaOverview && (
        <div className="kpi-grid cols-6">
          {(['foundation', 'domain_knowledge', 'cases', 'concrete_media', 'permissions', 'versions'] as StorageDomain[]).map(domain => (
            <div className="kpi-cell" key={domain}>
              <span>{storageDomainLabel(domain, locale)}</span>
              <strong>{schemaOverview.domainCounts[domain] ?? 0}</strong>
            </div>
          ))}
        </div>
      )}

      {report && (
        <>
          <div className="kpi-grid cols-4">
            <div className="kpi-cell"><span>{tx('主题页面', 'Pages')}</span><strong>{report.totalPages}</strong></div>
            <div className="kpi-cell"><span>{tx('已发布', 'Published')}</span><strong>{report.publishedCount}</strong></div>
            <div className="kpi-cell"><span>{tx('待审核', 'Pending')}</span><strong>{report.draftCount}</strong></div>
            <div className="kpi-cell"><span>{tx('待处理项', 'Issues')}</span><strong>{report.issues.length}</strong></div>
          </div>

          {!report.issues.length ? (
            <div className="empty-box"><ShieldCheck /><h2>{tx('状态良好', 'All Checks Passed')}</h2></div>
          ) : (
            <div className="data-table">
              <div className="table-head cols-issue">
                <span>{tx('级别', 'Severity')}</span>
                <span>{tx('问题详情', 'Issue')}</span>
                <span>{tx('操作', 'Action')}</span>
              </div>
              {report.issues.map(issue => (
                <div className="table-row cols-issue" key={issue.id}>
                  <span className="issue-sev">
                    <i className={`sev-dot ${issue.severity}`} />
                    {severityLabel(issue.severity, locale)} · {lintCategoryLabel(issue.category, locale)}
                  </span>
                  <div className="issue-main">
                    <strong>{issue.title}</strong>
                    <small>{issue.message}</small>
                  </div>
                  <div>
                    <button className="btn-secondary btn-xs" onClick={() => onOpenPage(issue.slug)}>{tx('处理', 'Open')} <ArrowRight /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!report && !loading && <div className="empty-box muted"><ShieldAlert /><h2>{tx('点击重新体检', 'Run Health Check')}</h2></div>}
    </section>
  )
}

export function ActivityView({
  runs,
  modelCalls,
  onUndo
}: {
  runs: OrganizeRun[]
  modelCalls: ModelCallRecord[]
  onUndo: (run: OrganizeRun) => void
}) {
  const { locale, tx, formatDate } = useI18n()
  const latestActive = runs.find(run => !run.undone)
  return (
    <section className="page-container">
      <header className="page-head">
        <h1>{tx('版本审计', 'Version Audit')}</h1>
      </header>

      {!runs.length && <div className="empty-box muted"><History /><h2>{tx('暂无整理记录', 'No compile history')}</h2></div>}

      <div className="audit-list">
        {runs.map(run => (
          <article className={`panel-card ${run.undone ? 'is-muted' : ''}`} key={run.id}>
            <div className="panel-card-head">
              <div>
                <span className="mono muted-text">{formatDate(run.createdAt)}</span>
                <h2>{run.summary.split('\n')[0]}</h2>
              </div>
              <div className="head-actions">
                <span className={`status-pill ${run.undone ? 'archived' : 'published'}`}>
                  {run.undone ? tx('已撤销', 'Reverted') : tx('已完成', 'Completed')}
                </span>
                {latestActive?.id === run.id && (
                  <button className="btn-secondary btn-xs" onClick={() => onUndo(run)}>
                    <RotateCcw /> {tx('撤销', 'Undo')}
                  </button>
                )}
              </div>
            </div>

            <div className="run-meta-bar">
              <span>{locale === 'en' ? `${run.filesChanged} source files` : `${run.filesChanged} 份原件变化`}</span>
              <span>{locale === 'en' ? `${run.changesCount} page changes` : `${run.changesCount} 个页面变更`}</span>
              <span className="mono">{run.model}</span>
              {run.gitCommit && <span className="mono"><GitCommitHorizontal /> {run.gitCommit.slice(0, 7)}</span>}
            </div>

            {run.changes.length > 0 && (
              <ul className="change-list">
                {run.changes.map((change, index) => (
                  <li key={`${change.slug}-${index}`}>
                    <span className={`change-action ${change.action}`}>{actionName(change.action, locale)}</span>
                    <span>{change.title}</span>
                    <code className="mono">{change.slug}</code>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>

      {modelCalls.length > 0 && (
        <details className="panel-card lineage-drawer">
          <summary>{tx('模型调用记录', 'Model Call Log')} ({modelCalls.length})</summary>
          <ul className="change-list">
            {modelCalls.map(call => (
              <li key={call.id}>
                <span className={`change-action ${call.status === 'ok' ? 'create' : 'delete'}`}>
                  {call.status === 'ok' ? tx('成功', 'OK') : tx('失败', 'ERR')}
                </span>
                <span>{call.taskType} · {call.model}</span>
                <code className="mono">{call.durationMs}ms · {call.detail}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
