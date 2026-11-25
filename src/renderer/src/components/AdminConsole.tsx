import {
  Check, KeyRound, LogOut, RotateCcw, Shield, ShieldCheck, Sliders, Trash2, UserPlus, Users
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { AdminRole, ModelProviderSettings, WikiPage, WorkspaceSnapshot, WorkflowAction } from '../../../shared/types'
import wallpaperSky from '../assets/wallpaper-sky.jpg'
import wallpaperSunset from '../assets/wallpaper-sunset.jpg'
import { useI18n } from '../i18n'
import { workflowStatusLabel } from '../labels'

type Props = {
  snapshot: WorkspaceSnapshot
  onLogin: (username: string, password: string) => Promise<void>
  onLogout: () => Promise<void>
  onChangePassword: (oldPassword: string, newPassword: string) => Promise<void>
  onCreateUser: (username: string, password: string, role: AdminRole) => Promise<void>
  onDeleteUser: (username: string) => Promise<void>
  onOpenSettings: () => void
  onSaveModelSettings: (next: ModelProviderSettings) => Promise<void>
  onTransitionWorkflow: (slug: string, action: WorkflowAction, note?: string) => Promise<void>
  onPurgeDeleted: (slug: string) => Promise<void>
  onOpenPage: (slug: string) => void
}

export default function AdminConsole({
  snapshot,
  onLogin,
  onLogout,
  onChangePassword,
  onCreateUser,
  onDeleteUser,
  onOpenSettings,
  onTransitionWorkflow,
  onPurgeDeleted,
  onOpenPage
}: Props) {
  const { locale, tx, formatDate } = useI18n()
  const [username, setUsername] = useState('zhixu')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<'overview' | 'recycle' | 'accounts' | 'audit'>('overview')

  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newUserPwd, setNewUserPwd] = useState('')
  const [newUserRole, setNewUserRole] = useState<AdminRole>('reviewer')

  const { adminAuth } = snapshot
  const pendingDeletePages = snapshot.pages.filter(p => p.status === 'pending_delete')
  const deletedPages = snapshot.pages.filter(p => p.status === 'deleted')

  async function handleLoginSubmit(event: FormEvent) {
    event.preventDefault()
    if (!username.trim() || !password) return
    setSubmitting(true)
    try {
      await onLogin(username.trim(), password)
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleChangePwd(event: FormEvent) {
    event.preventDefault()
    if (!oldPwd || !newPwd) return
    setSubmitting(true)
    try {
      await onChangePassword(oldPwd, newPwd)
      setOldPwd('')
      setNewPwd('')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCreateAccount(event: FormEvent) {
    event.preventDefault()
    if (!newUsername.trim() || !newUserPwd) return
    setSubmitting(true)
    try {
      await onCreateUser(newUsername.trim(), newUserPwd, newUserRole)
      setNewUsername('')
      setNewUserPwd('')
    } finally {
      setSubmitting(false)
    }
  }

  if (!adminAuth.authenticated || !adminAuth.user) {
    return (
      <section className="admin-inline-gate">
        <div className="admin-gate-split">
          <div className="admin-gate-art">
            <img src={wallpaperSunset} alt="" />
            <div className="admin-gate-art-overlay" />
          </div>
          <form className="admin-gate-form" onSubmit={event => void handleLoginSubmit(event)}>
            <div className="admin-login-icon"><Shield /></div>
            <h1>{tx('管理员验证', 'Admin Verification')}</h1>
            <div className="field-row">
              <label htmlFor="admin-user">{tx('账号', 'Username')}</label>
              <input
                id="admin-user"
                className="text-input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="field-row">
              <label htmlFor="admin-pass">{tx('密码', 'Password')}</label>
              <input
                id="admin-pass"
                className="text-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button className="btn-primary btn-block" type="submit" disabled={submitting || !username.trim() || !password}>
              <KeyRound /> {submitting ? tx('验证中…', 'Verifying…') : tx('登录后台', 'Sign In')}
            </button>
          </form>
        </div>
      </section>
    )
  }

  return (
    <section className="page-container admin-executive">
      {/* Panoramic Sunset Architectural Executive Hero Banner */}
      <header className="admin-hero" style={{ backgroundImage: `url(${wallpaperSunset})` }}>
        <div className="admin-hero-scrim" />
        <div className="admin-hero-content">
          <div className="admin-hero-top">
            <div className="admin-identity">
              <span className="admin-avatar"><Shield /></span>
              <div>
                <h1>{tx('系统控制中心', 'Admin Control Center')}</h1>
                <div className="admin-identity-meta">
                  <span className="hero-badge">{adminAuth.user.username}</span>
                  <span className="hero-badge subtle">{adminAuth.user.role === 'superadmin' ? tx('超级管理员', 'Superadmin') : tx('审核员', 'Reviewer')}</span>
                  <span className="hero-badge ok"><ShieldCheck /> {tx('鉴权保护已启用', 'Auth Guard Active')}</span>
                </div>
              </div>
            </div>
            <div className="head-actions">
              <button className="hero-glass-btn" onClick={onOpenSettings}><Sliders /> {tx('模型接口', 'Model API')}</button>
              <button className="hero-glass-btn danger" onClick={() => void onLogout()}><LogOut /> {tx('退出登录', 'Sign Out')}</button>
            </div>
          </div>

          <div className="admin-hero-kpis">
            <div className="hero-kpi"><span>{tx('已发布知识', 'Published')}</span><strong>{snapshot.publishedCount}</strong></div>
            <div className="hero-kpi"><span>{tx('持久向量', 'Vectors')}</span><strong>{snapshot.cachedEmbeddingCount}</strong></div>
            <div className="hero-kpi"><span>{tx('待删审批', 'Pending Del')}</span><strong>{snapshot.pendingDeleteCount}</strong></div>
            <div className="hero-kpi"><span>{tx('回收站', 'Recycle Bin')}</span><strong>{snapshot.deletedCount}</strong></div>
            <div className="hero-kpi"><span>{tx('后台账号', 'Accounts')}</span><strong>{adminAuth.users.length}</strong></div>
          </div>
        </div>
      </header>

      <div className="admin-tab-bar" role="tablist">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>{tx('系统总览', 'Overview')}</button>
        <button className={tab === 'recycle' ? 'active' : ''} onClick={() => setTab('recycle')}>
          {tx('待删与回收站', 'Recycle Bin')} ({pendingDeletePages.length + deletedPages.length})
        </button>
        <button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>
          {tx('账号安全', 'Accounts')} ({adminAuth.users.length})
        </button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
          {tx('调用与反馈', 'Audit & Feedback')} ({snapshot.modelCalls.length})
        </button>
      </div>

      {tab === 'overview' && (
        <div className="admin-overview-grid">
          <div className="stack-md">
            <article className="panel-card exec-card">
              <div className="panel-card-head">
                <h2>{tx('三类 API 路由', '3-Tier API Routing')}</h2>
                <button className="btn-secondary btn-xs" onClick={onOpenSettings}><Sliders /> {tx('编辑接口', 'Configure')}</button>
              </div>
              <div className="tier-grid-3">
                <div className="tier-card accent-lllm">
                  <span className="tier-badge lllm">LLLM</span>
                  <strong>{snapshot.modelProvider.lllmModel || snapshot.modelProvider.model}</strong>
                  <small className="mono">{snapshot.modelProvider.lllmBaseUrl || snapshot.modelProvider.baseUrl}</small>
                </div>
                <div className="tier-card accent-llm">
                  <span className="tier-badge llm">LLM</span>
                  <strong>{snapshot.modelProvider.llmModel || snapshot.modelProvider.model}</strong>
                  <small className="mono">{snapshot.modelProvider.llmBaseUrl || snapshot.modelProvider.baseUrl}</small>
                </div>
                <div className="tier-card accent-vm">
                  <span className="tier-badge vm">VM</span>
                  <strong>{snapshot.modelProvider.visionModel || tx('未配置', 'Not configured')}</strong>
                  <small className="mono">{snapshot.modelProvider.vmBaseUrl || snapshot.modelProvider.baseUrl}</small>
                </div>
              </div>
            </article>

            <article className="panel-card exec-card">
              <div className="panel-card-head">
                <h2>{tx('安全与治理策略', 'Security & Governance')}</h2>
                <span className="status-pill published"><ShieldCheck /> {tx('运行正常', 'Healthy')}</span>
              </div>
              <div className="security-grid">
                <div className="security-item">
                  <Check />
                  <span>
                    {locale === 'en' ? (
                      <>Server binds <code className="mono">127.0.0.1</code> by default + mandatory Bearer auth</>
                    ) : (
                      <>服务端默认绑定 <code className="mono">127.0.0.1</code> + 强制鉴权</>
                    )}
                  </span>
                </div>
                <div className="security-item"><Check /><span>{tx('AI 删除拦截：待删审批 → 回收站', 'AI Delete Guard: Approval → Recycle Bin')}</span></div>
                <div className="security-item"><Check /><span>{tx('SQLite 持久化向量缓存', 'Persistent SQLite Vector Cache')}</span></div>
                <div className="security-item"><Check /><span>{tx('证据不足不补全伪引用', 'Strict Refusal Without Evidence')}</span></div>
              </div>
            </article>
          </div>

          {/* Right Vertical Sky Visual Status Card */}
          <aside className="admin-side-visual" style={{ backgroundImage: `url(${wallpaperSky})` }}>
            <div className="admin-side-scrim" />
            <div className="admin-side-body">
              <span className="side-status-pill">
                <i className={snapshot.modelOnline ? 'online' : ''} />
                {snapshot.modelOnline ? tx('模型服务在线', 'Model Online') : tx('待配置密钥', 'API Key Needed')}
              </span>
              <div className="admin-side-metrics">
                <div><span>{tx('原件资料', 'Source Files')}</span><strong className="mono">{snapshot.fileCount}</strong></div>
                <div><span>{tx('结构切块', 'Chunks')}</span><strong className="mono">{snapshot.chunkCount}</strong></div>
                <div><span>{tx('知识实体', 'Entities')}</span><strong className="mono">{snapshot.entityCount}</strong></div>
                <div><span>{tx('双向互索引', 'Mutual Links')}</span><strong className="mono">{snapshot.mutualLinkCount}</strong></div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {tab === 'recycle' && (
        <div className="two-col-grid">
          <article className="panel-card exec-card">
            <div className="panel-card-head">
              <h2>{tx('待删审批', 'Pending Delete')} ({pendingDeletePages.length})</h2>
            </div>
            {pendingDeletePages.length ? (
              <ul className="item-list">
                {pendingDeletePages.map((page: WikiPage) => (
                  <li key={page.slug}>
                    <div>
                      <strong>{page.title}</strong>
                      <span className="status-pill pending_delete">{workflowStatusLabel(page.status, locale)}</span>
                      <small>{page.workflowNote || tx('待审批', 'Pending approval')}</small>
                    </div>
                    <div className="row-actions">
                      <button className="btn-secondary btn-xs" onClick={() => onOpenPage(page.slug)}>{tx('查看', 'View')}</button>
                      <button className="btn-secondary btn-xs" onClick={() => void onTransitionWorkflow(page.slug, 'reject_delete', tx('管理员驳回删除', 'Rejected by admin'))}>
                        <RotateCcw /> {tx('保留', 'Keep')}
                      </button>
                      <button className="btn-danger btn-xs" onClick={() => void onTransitionWorkflow(page.slug, 'confirm_delete', tx('移入回收站', 'Moved to recycle bin'))}>
                        <Trash2 /> {tx('移入回收站', 'Recycle')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-inline">{tx('无待审批删除', 'No pending deletions')}</div>
            )}
          </article>

          <article className="panel-card exec-card">
            <div className="panel-card-head">
              <h2>{tx('回收站', 'Recycle Bin')} ({deletedPages.length})</h2>
            </div>
            {deletedPages.length ? (
              <ul className="item-list">
                {deletedPages.map((page: WikiPage) => (
                  <li key={page.slug}>
                    <div>
                      <strong>{page.title}</strong>
                      <span className="status-pill deleted">{tx('回收站', 'Recycle Bin')}</span>
                      <small>{page.reviewedBy || tx('管理员', 'Admin')} · {formatDate(page.updatedAt)}</small>
                    </div>
                    <div className="row-actions">
                      <button className="btn-secondary btn-xs" onClick={() => void onTransitionWorkflow(page.slug, 'restore_deleted', tx('恢复为草稿', 'Restored as draft'))}>
                        <RotateCcw /> {tx('恢复', 'Restore')}
                      </button>
                      <button
                        className="btn-secondary btn-xs danger-outline"
                        onClick={() => {
                          if (window.confirm(locale === 'en' ? `Permanently purge "${page.title}"?` : `彻底清理「${page.title}」？`)) void onPurgeDeleted(page.slug)
                        }}
                      >
                        <Trash2 /> {tx('清理', 'Purge')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-inline">{tx('回收站为空', 'Recycle bin is empty')}</div>
            )}
          </article>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="stack-md">
          <article className="panel-card exec-card">
            <div className="panel-card-head">
              <h2><Users /> {tx('后台账号', 'Admin Accounts')} ({adminAuth.users.length})</h2>
            </div>
            <ul className="item-list">
              {adminAuth.users.map(user => (
                <li key={user.username}>
                  <div>
                    <strong>{user.username}</strong>
                    <span className="meta-pill">{user.role === 'superadmin' ? tx('超级管理员', 'Superadmin') : tx('审核员', 'Reviewer')}</span>
                    <small>{tx('最近登录：', 'Last login: ')}{user.lastLoginAt ? formatDate(user.lastLoginAt) : tx('未登录', 'Never')}</small>
                  </div>
                  {adminAuth.user?.role === 'superadmin' && user.username !== adminAuth.user.username && (
                    <button className="btn-secondary btn-xs danger-outline" onClick={() => void onDeleteUser(user.username)}>
                      <Trash2 /> {tx('删除', 'Delete')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </article>

          <div className="two-col-grid">
            <form className="panel-card exec-card stack-sm" onSubmit={event => void handleChangePwd(event)}>
              <h2><KeyRound /> {tx('修改密码', 'Change Password')}</h2>
              <div className="field-row">
                <label htmlFor="old-pwd">{tx('原密码', 'Current Password')}</label>
                <input id="old-pwd" className="text-input" type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} />
              </div>
              <div className="field-row">
                <label htmlFor="new-pwd">{tx('新密码（至少 6 位）', 'New Password (min 6 chars)')}</label>
                <input id="new-pwd" className="text-input" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
              </div>
              <button className="btn-primary btn-sm" type="submit" disabled={submitting || !oldPwd || newPwd.length < 6}>
                {tx('更新密码', 'Update Password')}
              </button>
            </form>

            {adminAuth.user.role === 'superadmin' && (
              <form className="panel-card exec-card stack-sm" onSubmit={event => void handleCreateAccount(event)}>
                <h2><UserPlus /> {tx('新增账号', 'Add Account')}</h2>
                <div className="field-row">
                  <label htmlFor="create-user">{tx('账号名', 'Username')}</label>
                  <input id="create-user" className="text-input" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="reviewer01" />
                </div>
                <div className="field-row">
                  <label htmlFor="create-pwd">{tx('初始密码', 'Initial Password')}</label>
                  <input id="create-pwd" className="text-input" type="password" value={newUserPwd} onChange={e => setNewUserPwd(e.target.value)} placeholder={tx('至少 6 位', 'Min 6 characters')} />
                </div>
                <div className="field-row">
                  <label htmlFor="create-role">{tx('角色', 'Role')}</label>
                  <select id="create-role" className="text-input" value={newUserRole} onChange={e => setNewUserRole(e.target.value as AdminRole)}>
                    <option value="reviewer">{tx('审核员', 'Reviewer')}</option>
                    <option value="superadmin">{tx('超级管理员', 'Superadmin')}</option>
                  </select>
                </div>
                <button className="btn-primary btn-sm" type="submit" disabled={submitting || !newUsername.trim() || newUserPwd.length < 6}>
                  {tx('创建账号', 'Create Account')}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="stack-md">
          <article className="panel-card exec-card">
            <div className="panel-card-head">
              <h2>{tx('模型调用记录', 'Model Call Log')} ({snapshot.modelCalls.length})</h2>
            </div>
            {snapshot.modelCalls.length ? (
              <ul className="change-list">
                {snapshot.modelCalls.map(call => (
                  <li key={call.id}>
                    <span className={`change-action ${call.status === 'ok' ? 'create' : 'delete'}`}>
                      {call.status === 'ok' ? tx('成功', 'OK') : tx('失败', 'ERR')}
                    </span>
                    <span>{call.taskType} · {call.model}</span>
                    <code className="mono">{call.durationMs}ms · {call.detail}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-inline">{tx('暂无记录', 'No records yet')}</div>
            )}
          </article>

          <article className="panel-card exec-card">
            <div className="panel-card-head">
              <h2>{tx('问答反馈', 'Q&A Feedback')} ({snapshot.feedbacks.length})</h2>
            </div>
            {snapshot.feedbacks.length ? (
              <ul className="item-list">
                {snapshot.feedbacks.map(fb => (
                  <li key={fb.id}>
                    <div>
                      <strong>{fb.question}</strong>
                      <span className={`status-pill ${fb.rating === 'needs_fix' ? 'moderating' : 'published'}`}>
                        {fb.rating === 'helpful' ? tx('有帮助', 'Helpful') : tx('需修正', 'Needs Fix')}
                      </span>
                      <small>{fb.comment} · {formatDate(fb.createdAt)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-inline">{tx('暂无反馈', 'No feedback yet')}</div>
            )}
          </article>
        </div>
      )}
    </section>
  )
}
