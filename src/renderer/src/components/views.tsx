import {
  ArrowRight, ArrowUpRight, Check, CircleAlert, Clock3, Edit3, FileDiff, FileText, GitCommitHorizontal,
  History, Link2, LoaderCircle, Network, RefreshCw, RotateCcw, Save, ShieldAlert, ShieldCheck, Sparkles, X
} from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import type {
  ManualPageInput, ModelCallRecord, OrganizeRun, PageDiffResult, PageVersionSnapshot, SchemaOverview,
  StorageDomain, WikiLintReport, WikiPage, WorkflowAction
} from '../../../shared/types'
import { MarkdownView } from './MarkdownView'
import { actionName, dateFormatter, evidenceLevelLabel, lintCategoryLabel, severityLabel, storageDomainLabel, workflowStatusLabel } from '../labels'

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
            <span className="status-pill draft">{page.slug === '__new__' ? '新建页面' : '编辑模式'}</span>
            <span className="muted-text mono">Ctrl+S 保存草稿</span>
          </div>
          <div className="head-actions">
            <button className="btn-secondary btn-sm" onClick={() => setEditing(false)} disabled={saving}><X /> 取消</button>
            <button className="btn-secondary btn-sm" onClick={() => void saveEdit(false)} disabled={saving || !draftTitle.trim() || !draftContent.trim()}>
              {saving ? <LoaderCircle className="spin" /> : <Save />} 保存草稿
            </button>
            <button className="btn-primary btn-sm" onClick={() => void saveEdit(true)} disabled={saving || !draftTitle.trim() || !draftContent.trim()}>
              <Check /> 保存并发布
            </button>
          </div>
        </header>

        <div className="editor-meta-bar">
          <input
            className="text-input editor-title-input"
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            placeholder="页面标题"
          />
          <select
            className="text-input editor-domain-input"
            value={draftDomain}
            onChange={e => setDraftDomain(e.target.value as StorageDomain)}
          >
            <option value="foundation">基础</option>
            <option value="domain_knowledge">专业知识</option>
            <option value="cases">案例</option>
            <option value="concrete_media">具体+图+元数据</option>
            <option value="permissions">权限</option>
          </select>
          <input
            className="text-input"
            value={draftSummary}
            onChange={e => setDraftSummary(e.target.value)}
            placeholder="一句话摘要"
          />
          <input
            className="text-input"
            value={draftApplicability}
            onChange={e => setDraftApplicability(e.target.value)}
            placeholder="适用条件"
          />
        </div>

        <div className="editor-split">
          <textarea
            className="editor-textarea mono"
            value={draftContent}
            onChange={e => setDraftContent(e.target.value)}
            onKeyDown={handleEditorKeyDown}
            placeholder="使用 Markdown 编写正文，支持 [[页面slug]] 双向引用…"
          />
          <div className="editor-preview">
            <MarkdownView content={draftContent || '*预览区*'} onNavigate={onNavigate} />
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
            <span className={`status-pill ${page.status}`}>{workflowStatusLabel(page.status)}</span>
            <span className="meta-pill">{page.versionLabel ?? 'V1.0'}</span>
            <span className="meta-pill">{storageDomainLabel(page.storageDomain ?? 'foundation')}</span>
            <span className="meta-pill">{evidenceLevelLabel(page.evidenceLevel)}</span>
          </div>

          <h1 tabIndex={-1}>{page.title}</h1>
          {page.summary && <p className="doc-summary">{page.summary}</p>}

          <div className="doc-meta-strip">
            <span><Clock3 /> {dateFormatter.format(new Date(page.updatedAt))}</span>
            <span><Link2 /> {page.sources.length} 条依据</span>
            {page.applicability && <span>适用：{page.applicability}</span>}
          </div>

          {page.slug !== 'index' && (
            <div className="doc-action-bar">
              <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
                <Edit3 /> 编辑
              </button>
              <button className={`btn-secondary btn-sm ${showDiff ? 'is-active' : ''}`} onClick={() => void toggleDiff()} disabled={loadingDiff}>
                <FileDiff /> {showDiff ? '收起差异' : '对比差异'}
              </button>
              <button className="btn-secondary btn-sm" onClick={() => void openVersionsTab()}>
                <History /> 版本历史
              </button>
              <span className="toolbar-sep" />
              {page.status === 'draft' && (
                <>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'submit_moderation')}>提交初审</button>
                  <button className="btn-primary btn-sm" onClick={() => onPublish(page.slug)}><Check /> 发布</button>
                </>
              )}
              {page.status === 'moderating' && (
                <>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'refuse_moderation', '初审退回')}>退回草稿</button>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'submit_validation')}>提交终审</button>
                  <button className="btn-primary btn-sm" onClick={() => onPublish(page.slug)}><Check /> 发布</button>
                </>
              )}
              {page.status === 'validating' && (
                <>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'refuse_validation', '终审驳回')}>驳回草稿</button>
                  <button className="btn-primary btn-sm" onClick={() => onPublish(page.slug)}><Check /> 终审发布</button>
                </>
              )}
              {page.status === 'published' && (
                <>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'unpublish', '撤回修订')}>撤回修订</button>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'archive', '人工归档')}>归档</button>
                  <button className="btn-secondary btn-sm danger-outline" onClick={() => onTransitionWorkflow(page.slug, 'confirm_delete', '人工移入回收站')}>移入回收站</button>
                </>
              )}
              {page.status === 'archived' && (
                <button className="btn-primary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'publish_from_archive')}>
                  <RotateCcw /> 恢复发布
                </button>
              )}
              {page.status === 'pending_delete' && (
                <>
                  <button className="btn-secondary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'reject_delete', '人工驳回删除并保留')}>
                    <RotateCcw /> 驳回删除
                  </button>
                  <button className="btn-danger btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'confirm_delete', '人工确认移入回收站')}>
                    确认移入回收站
                  </button>
                </>
              )}
              {page.status === 'deleted' && (
                <button className="btn-primary btn-sm" onClick={() => onTransitionWorkflow(page.slug, 'restore_deleted', '从回收站恢复为草稿')}>
                  <RotateCcw /> 从回收站恢复
                </button>
              )}
            </div>
          )}

          {loadingDiff && <div className="inline-loading"><LoaderCircle className="spin" /> 读取差异…</div>}
          {showDiff && diffData && (
            <div className="diff-panel">
              <div className="diff-panel-head">
                <span>{diffData.hasBaseline ? '与已发布基线对比' : '新建页面'}</span>
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
                <p className="diff-empty">与已发布基线一致</p>
              )}
            </div>
          )}
        </header>

        <MarkdownView content={page.content} onNavigate={onNavigate} />
      </article>

      <aside className="doc-inspector" aria-label="页面检查器">
        <div className="inspector-tabs" role="tablist">
          <button className={inspectorTab === 'sources' ? 'active' : ''} onClick={() => setInspectorTab('sources')}>
            依据 ({page.sources.length})
          </button>
          <button className={inspectorTab === 'graph' ? 'active' : ''} onClick={() => setInspectorTab('graph')}>
            关联 ({related.length + backlinks.length})
          </button>
          <button className={inspectorTab === 'versions' ? 'active' : ''} onClick={() => void openVersionsTab()}>
            版本
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
                    <span className="source-open">打开原件 <ArrowUpRight /></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="inspector-empty"><CircleAlert /> {page.slug === 'index' ? '导览汇总页' : '暂无引用'}</div>
            )
          )}

          {inspectorTab === 'graph' && (
            <div className="inspector-graph">
              {!!page.schemaEntities?.length && (
                <section>
                  <h3>知识实体 ({page.schemaEntities.length})</h3>
                  <div className="entity-chip-list">
                    {page.schemaEntities.map(entity => <span key={entity}>{entity}</span>)}
                  </div>
                </section>
              )}
              <section>
                <h3>正向引用 ({related.length})</h3>
                {related.length ? (
                  <div className="relation-list">
                    {related.map(item => (
                      <button key={item.slug} onClick={() => onNavigate(item.slug)}>
                        <span>{item.title}</span><ArrowRight />
                      </button>
                    ))}
                  </div>
                ) : <div className="inspector-empty">无</div>}
              </section>
              <section>
                <h3>反向链接 ({backlinks.length})</h3>
                {backlinks.length ? (
                  <div className="relation-list">
                    {backlinks.map(item => (
                      <button key={item.slug} onClick={() => onNavigate(item.slug)}>
                        <span>{item.title}</span><ArrowRight />
                      </button>
                    ))}
                  </div>
                ) : <div className="inspector-empty"><Network /> 无</div>}
              </section>
            </div>
          )}

          {inspectorTab === 'versions' && (
            loadingVersions ? (
              <div className="inline-loading"><LoaderCircle className="spin" /> 加载版本…</div>
            ) : versions.length ? (
              <ul className="version-list">
                {versions.map(version => (
                  <li key={version.id}>
                    <div>
                      <strong>{version.versionLabel}</strong>
                      <span className="version-kind-tag">{version.status === 'published' ? '正式' : version.status === 'candidate' ? '候补' : '归档'}</span>
                      {version.evalScore !== null && <span className="version-eval-tag">{version.evalScore}</span>}
                      <small>{version.note || version.createdBy} · {dateFormatter.format(new Date(version.createdAt))}</small>
                    </div>
                    <button className="btn-secondary btn-xs" onClick={() => onRollbackVersion(page.slug, version.versionLabel)}>回滚</button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="inspector-empty">暂无历史版本</div>
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
  return (
    <section className="page-container">
      <header className="page-head">
        <h1>知识体检</h1>
        <div className="head-actions">
          <button className="btn-secondary btn-sm" onClick={onFixLint} disabled={fixing || loading}>
            {fixing ? <LoaderCircle className="spin" /> : <Sparkles />} 修复断链
          </button>
          {report && report.draftCount > 0 && (
            <button className="btn-secondary btn-sm" onClick={onPublishAll}><Check /> 全部发布</button>
          )}
          <button className="btn-primary btn-sm" onClick={onRefresh} disabled={loading}>
            {loading ? <LoaderCircle className="spin" /> : <RefreshCw />} 重新体检
          </button>
        </div>
      </header>

      {schemaOverview && (
        <div className="kpi-grid cols-6">
          {(['foundation', 'domain_knowledge', 'cases', 'concrete_media', 'permissions', 'versions'] as StorageDomain[]).map(domain => (
            <div className="kpi-cell" key={domain}>
              <span>{storageDomainLabel(domain)}</span>
              <strong>{schemaOverview.domainCounts[domain] ?? 0}</strong>
            </div>
          ))}
        </div>
      )}

      {report && (
        <>
          <div className="kpi-grid cols-4">
            <div className="kpi-cell"><span>主题页面</span><strong>{report.totalPages}</strong></div>
            <div className="kpi-cell"><span>已发布</span><strong>{report.publishedCount}</strong></div>
            <div className="kpi-cell"><span>待审核</span><strong>{report.draftCount}</strong></div>
            <div className="kpi-cell"><span>待处理项</span><strong>{report.issues.length}</strong></div>
          </div>

          {!report.issues.length ? (
            <div className="empty-box"><ShieldCheck /><h2>状态良好</h2></div>
          ) : (
            <div className="data-table">
              <div className="table-head cols-issue">
                <span>级别</span>
                <span>问题详情</span>
                <span>操作</span>
              </div>
              {report.issues.map(issue => (
                <div className="table-row cols-issue" key={issue.id}>
                  <span className="issue-sev">
                    <i className={`sev-dot ${issue.severity}`} />
                    {severityLabel(issue.severity)} · {lintCategoryLabel(issue.category)}
                  </span>
                  <div className="issue-main">
                    <strong>{issue.title}</strong>
                    <small>{issue.message}</small>
                  </div>
                  <div>
                    <button className="btn-secondary btn-xs" onClick={() => onOpenPage(issue.slug)}>处理 <ArrowRight /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!report && !loading && <div className="empty-box muted"><ShieldAlert /><h2>点击重新体检</h2></div>}
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
  const latestActive = runs.find(run => !run.undone)
  return (
    <section className="page-container">
      <header className="page-head">
        <h1>版本审计</h1>
      </header>

      {!runs.length && <div className="empty-box muted"><History /><h2>暂无整理记录</h2></div>}

      <div className="audit-list">
        {runs.map(run => (
          <article className={`panel-card ${run.undone ? 'is-muted' : ''}`} key={run.id}>
            <div className="panel-card-head">
              <div>
                <span className="mono muted-text">{dateFormatter.format(new Date(run.createdAt))}</span>
                <h2>{run.summary.split('\n')[0]}</h2>
              </div>
              <div className="head-actions">
                <span className={`status-pill ${run.undone ? 'archived' : 'published'}`}>
                  {run.undone ? '已撤销' : '已完成'}
                </span>
                {latestActive?.id === run.id && (
                  <button className="btn-secondary btn-xs" onClick={() => onUndo(run)}>
                    <RotateCcw /> 撤销
                  </button>
                )}
              </div>
            </div>

            <div className="run-meta-bar">
              <span>{run.filesChanged} 份原件变化</span>
              <span>{run.changesCount} 个页面变更</span>
              <span className="mono">{run.model}</span>
              {run.gitCommit && <span className="mono"><GitCommitHorizontal /> {run.gitCommit.slice(0, 7)}</span>}
            </div>

            {run.changes.length > 0 && (
              <ul className="change-list">
                {run.changes.map((change, index) => (
                  <li key={`${change.slug}-${index}`}>
                    <span className={`change-action ${change.action}`}>{actionName(change.action)}</span>
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
          <summary>模型调用记录 ({modelCalls.length})</summary>
          <ul className="change-list">
            {modelCalls.map(call => (
              <li key={call.id}>
                <span className={`change-action ${call.status === 'ok' ? 'create' : 'delete'}`}>
                  {call.status === 'ok' ? '成功' : '失败'}
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
