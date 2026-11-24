import {
  Check, KeyRound, LogOut, RotateCcw, Shield, ShieldCheck, Sliders, Trash2, UserPlus, Users
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { AdminRole, ModelProviderSettings, WikiPage, WorkspaceSnapshot, WorkflowAction } from '../../../shared/types'
import wallpaperSky from '../assets/wallpaper-sky.jpg'
import wallpaperSunset from '../assets/wallpaper-sunset.jpg'
import { dateFormatter, workflowStatusLabel } from '../labels'

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
            <h1>管理员验证</h1>
            <div className="field-row">
              <label htmlFor="admin-user">账号</label>
              <input
                id="admin-user"
                className="text-input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="field-row">
              <label htmlFor="admin-pass">密码</label>
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
              <KeyRound /> {submitting ? '验证中…' : '登录后台'}
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
                <h1>系统控制中心</h1>
                <div className="admin-identity-meta">
                  <span className="hero-badge">{adminAuth.user.username}</span>
                  <span className="hero-badge subtle">{adminAuth.user.role === 'superadmin' ? '超级管理员' : '审核员'}</span>
                  <span className="hero-badge ok"><ShieldCheck /> 鉴权保护已启用</span>
                </div>
              </div>
            </div>
            <div className="head-actions">
              <button className="hero-glass-btn" onClick={onOpenSettings}><Sliders /> 模型接口</button>
              <button className="hero-glass-btn danger" onClick={() => void onLogout()}><LogOut /> 退出登录</button>
            </div>
          </div>

          <div className="admin-hero-kpis">
            <div className="hero-kpi"><span>已发布知识</span><strong>{snapshot.publishedCount}</strong></div>
            <div className="hero-kpi"><span>持久向量</span><strong>{snapshot.cachedEmbeddingCount}</strong></div>
            <div className="hero-kpi"><span>待删审批</span><strong>{snapshot.pendingDeleteCount}</strong></div>
            <div className="hero-kpi"><span>回收站</span><strong>{snapshot.deletedCount}</strong></div>
            <div className="hero-kpi"><span>后台账号</span><strong>{adminAuth.users.length}</strong></div>
          </div>
        </div>
      </header>

      <div className="admin-tab-bar" role="tablist">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>系统总览</button>
        <button className={tab === 'recycle' ? 'active' : ''} onClick={() => setTab('recycle')}>
          待删与回收站 ({pendingDeletePages.length + deletedPages.length})
        </button>
        <button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>
          账号安全 ({adminAuth.users.length})
        </button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
          调用与反馈 ({snapshot.modelCalls.length})
        </button>
      </div>

      {tab === 'overview' && (
        <div className="admin-overview-grid">
          <div className="stack-md">
            <article className="panel-card exec-card">
              <div className="panel-card-head">
                <h2>三类 API 路由</h2>
                <button className="btn-secondary btn-xs" onClick={onOpenSettings}><Sliders /> 编辑接口</button>
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
                  <strong>{snapshot.modelProvider.visionModel || '未配置'}</strong>
                  <small className="mono">{snapshot.modelProvider.vmBaseUrl || snapshot.modelProvider.baseUrl}</small>
                </div>
              </div>
            </article>

            <article className="panel-card exec-card">
              <div className="panel-card-head">
                <h2>安全与治理策略</h2>
                <span className="status-pill published"><ShieldCheck /> 运行正常</span>
              </div>
              <div className="security-grid">
                <div className="security-item"><Check /><span>服务端默认绑定 <code className="mono">127.0.0.1</code> + 强制鉴权</span></div>
                <div className="security-item"><Check /><span>AI 删除拦截：待删审批 → 回收站</span></div>
                <div className="security-item"><Check /><span>SQLite 持久化向量缓存</span></div>
                <div className="security-item"><Check /><span>证据不足不补全伪引用</span></div>
              </div>
            </article>
          </div>

          {/* Right Vertical Sky Visual Status Card */}
          <aside className="admin-side-visual" style={{ backgroundImage: `url(${wallpaperSky})` }}>
            <div className="admin-side-scrim" />
            <div className="admin-side-body">
              <span className="side-status-pill">
                <i className={snapshot.modelOnline ? 'online' : ''} />
                {snapshot.modelOnline ? '模型服务在线' : '待配置密钥'}
              </span>
              <div className="admin-side-metrics">
                <div><span>原件资料</span><strong className="mono">{snapshot.fileCount}</strong></div>
                <div><span>结构切块</span><strong className="mono">{snapshot.chunkCount}</strong></div>
                <div><span>知识实体</span><strong className="mono">{snapshot.entityCount}</strong></div>
                <div><span>双向互索引</span><strong className="mono">{snapshot.mutualLinkCount}</strong></div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {tab === 'recycle' && (
        <div className="two-col-grid">
          <article className="panel-card exec-card">
            <div className="panel-card-head">
              <h2>待删审批 ({pendingDeletePages.length})</h2>
            </div>
            {pendingDeletePages.length ? (
              <ul className="item-list">
                {pendingDeletePages.map((page: WikiPage) => (
                  <li key={page.slug}>
                    <div>
                      <strong>{page.title}</strong>
                      <span className="status-pill pending_delete">{workflowStatusLabel(page.status)}</span>
                      <small>{page.workflowNote || '待审批'}</small>
                    </div>
                    <div className="row-actions">
                      <button className="btn-secondary btn-xs" onClick={() => onOpenPage(page.slug)}>查看</button>
                      <button className="btn-secondary btn-xs" onClick={() => void onTransitionWorkflow(page.slug, 'reject_delete', '管理员驳回删除')}>
                        <RotateCcw /> 保留
                      </button>
                      <button className="btn-danger btn-xs" onClick={() => void onTransitionWorkflow(page.slug, 'confirm_delete', '移入回收站')}>
                        <Trash2 /> 移入回收站
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-inline">无待审批删除</div>
            )}
          </article>

          <article className="panel-card exec-card">
            <div className="panel-card-head">
              <h2>回收站 ({deletedPages.length})</h2>
            </div>
            {deletedPages.length ? (
              <ul className="item-list">
                {deletedPages.map((page: WikiPage) => (
                  <li key={page.slug}>
                    <div>
                      <strong>{page.title}</strong>
                      <span className="status-pill deleted">回收站</span>
                      <small>{page.reviewedBy || '管理员'} · {dateFormatter.format(new Date(page.updatedAt))}</small>
                    </div>
                    <div className="row-actions">
                      <button className="btn-secondary btn-xs" onClick={() => void onTransitionWorkflow(page.slug, 'restore_deleted', '恢复为草稿')}>
                        <RotateCcw /> 恢复
                      </button>
                      <button
                        className="btn-secondary btn-xs danger-outline"
                        onClick={() => {
                          if (window.confirm(`彻底清理「${page.title}」？`)) void onPurgeDeleted(page.slug)
                        }}
                      >
                        <Trash2 /> 清理
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-inline">回收站为空</div>
            )}
          </article>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="stack-md">
          <article className="panel-card exec-card">
            <div className="panel-card-head">
              <h2><Users /> 后台账号 ({adminAuth.users.length})</h2>
            </div>
            <ul className="item-list">
              {adminAuth.users.map(user => (
                <li key={user.username}>
                  <div>
                    <strong>{user.username}</strong>
                    <span className="meta-pill">{user.role === 'superadmin' ? '超级管理员' : '审核员'}</span>
                    <small>最近登录：{user.lastLoginAt ? dateFormatter.format(new Date(user.lastLoginAt)) : '未登录'}</small>
                  </div>
                  {adminAuth.user?.role === 'superadmin' && user.username !== adminAuth.user.username && (
                    <button className="btn-secondary btn-xs danger-outline" onClick={() => void onDeleteUser(user.username)}>
                      <Trash2 /> 删除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </article>

          <div className="two-col-grid">
            <form className="panel-card exec-card stack-sm" onSubmit={event => void handleChangePwd(event)}>
              <h2><KeyRound /> 修改密码</h2>
              <div className="field-row">
                <label htmlFor="old-pwd">原密码</label>
                <input id="old-pwd" className="text-input" type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} />
              </div>
              <div className="field-row">
                <label htmlFor="new-pwd">新密码（至少 6 位）</label>
                <input id="new-pwd" className="text-input" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
              </div>
              <button className="btn-primary btn-sm" type="submit" disabled={submitting || !oldPwd || newPwd.length < 6}>
                更新密码
              </button>
            </form>

            {adminAuth.user.role === 'superadmin' && (
              <form className="panel-card exec-card stack-sm" onSubmit={event => void handleCreateAccount(event)}>
                <h2><UserPlus /> 新增账号</h2>
                <div className="field-row">
                  <label htmlFor="create-user">账号名</label>
                  <input id="create-user" className="text-input" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="reviewer01" />
                </div>
                <div className="field-row">
                  <label htmlFor="create-pwd">初始密码</label>
                  <input id="create-pwd" className="text-input" type="password" value={newUserPwd} onChange={e => setNewUserPwd(e.target.value)} placeholder="至少 6 位" />
                </div>
                <div className="field-row">
                  <label htmlFor="create-role">角色</label>
                  <select id="create-role" className="text-input" value={newUserRole} onChange={e => setNewUserRole(e.target.value as AdminRole)}>
                    <option value="reviewer">审核员</option>
                    <option value="superadmin">超级管理员</option>
                  </select>
                </div>
                <button className="btn-primary btn-sm" type="submit" disabled={submitting || !newUsername.trim() || newUserPwd.length < 6}>
                  创建账号
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
              <h2>模型调用记录 ({snapshot.modelCalls.length})</h2>
            </div>
            {snapshot.modelCalls.length ? (
              <ul className="change-list">
                {snapshot.modelCalls.map(call => (
                  <li key={call.id}>
                    <span className={`change-action ${call.status === 'ok' ? 'create' : 'delete'}`}>
                      {call.status === 'ok' ? '成功' : '失败'}
                    </span>
                    <span>{call.taskType} · {call.model}</span>
                    <code className="mono">{call.durationMs}ms · {call.detail}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-inline">暂无记录</div>
            )}
          </article>

          <article className="panel-card exec-card">
            <div className="panel-card-head">
              <h2>问答反馈 ({snapshot.feedbacks.length})</h2>
            </div>
            {snapshot.feedbacks.length ? (
              <ul className="item-list">
                {snapshot.feedbacks.map(fb => (
                  <li key={fb.id}>
                    <div>
                      <strong>{fb.question}</strong>
                      <span className={`status-pill ${fb.rating === 'needs_fix' ? 'moderating' : 'published'}`}>
                        {fb.rating === 'helpful' ? '有帮助' : '需修正'}
                      </span>
                      <small>{fb.comment} · {dateFormatter.format(new Date(fb.createdAt))}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-inline">暂无反馈</div>
            )}
          </article>
        </div>
      )}
    </section>
  )
}
