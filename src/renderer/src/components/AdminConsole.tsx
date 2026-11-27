import {
  Check, KeyRound, LogOut, RotateCcw, Shield, ShieldCheck, Sliders, Trash2, UserPlus, Users
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { AdminRole, ModelProviderSettings, WikiPage, WorkspaceSnapshot, WorkflowAction } from '../../../shared/types'
import { useI18n } from '../i18n'
import { workflowStatusLabel } from '../labels'
import SpotlightCard from './SpotlightCard'

type Props = {
  snapshot: WorkspaceSnapshot
  theme?: 'light' | 'dark'
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
  theme = 'dark',
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
        <SpotlightCard theme={theme} className="admin-gate-minimal" intensity={0.14} borderGlow={0.55}>
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
        </SpotlightCard>
      </section>
    )
  }

  return (
    <section className="page-container admin-minimal">
      <header className="admin-minimal-head">
        <div className="admin-minimal-title">
          <span className="admin-minimal-kicker">SYSTEM · GOVERNANCE</span>
          <h1>{tx('系统后台', 'Admin Console')}</h1>
          <div className="admin-minimal-meta">
            <span>{adminAuth.user.username}</span>
            <span>·</span>
            <span>{adminAuth.user.role === 'superadmin' ? tx('超级管理员', 'Superadmin') : tx('审核员', 'Reviewer')}</span>
            <span>·</span>
            <span>{snapshot.modelOnline ? tx('模型就绪', 'Model Ready') : tx('待配置', 'Setup Needed')}</span>
          </div>
        </div>
        <div className="head-actions">
          <button className="btn-secondary btn-sm" onClick={onOpenSettings}><Sliders /> {tx('模型与 MCP', 'Models & MCP')}</button>
          <button className="btn-secondary btn-sm" onClick={() => void onLogout()}><LogOut /> {tx('退出', 'Sign Out')}</button>
        </div>
      </header>

      <div className="admin-tab-bar" role="tablist">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>{tx('总览', 'Overview')}</button>
        <button className={tab === 'recycle' ? 'active' : ''} onClick={() => setTab('recycle')}>
          {tx('回收站', 'Recycle Bin')}{pendingDeletePages.length + deletedPages.length > 0 ? ` (${pendingDeletePages.length + deletedPages.length})` : ''}
        </button>
        <button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>
          {tx('账号', 'Accounts')}
        </button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
          {tx('审计', 'Audit')}
        </button>
      </div>

      {tab === 'overview' && (
        <div className="admin-minimal-grid">
          <SpotlightCard theme={theme} className="admin-spotlight-card" intensity={0.12} borderGlow={0.5}>
            <div className="panel-card-head">
              <h2>{tx('模型路由', 'Model Routing')}</h2>
              <button className="btn-secondary btn-xs" onClick={onOpenSettings}><Sliders /> {tx('配置', 'Configure')}</button>
            </div>
            <div className="tier-mono-grid">
              <div className="tier-mono-item">
                <span>LLLM · Synthesis</span>
                <strong>{snapshot.modelProvider.lllmModel || snapshot.modelProvider.model}</strong>
              </div>
              <div className="tier-mono-item">
                <span>LLM · Retrieval</span>
                <strong>{snapshot.modelProvider.llmModel || snapshot.modelProvider.model}</strong>
              </div>
              <div className="tier-mono-item">
                <span>VM · Vision OCR</span>
                <strong>{snapshot.modelProvider.visionModel || tx('未配置', 'Not configured')}</strong>
              </div>
            </div>
          </SpotlightCard>

          <SpotlightCard theme={theme} className="admin-spotlight-card" intensity={0.12} borderGlow={0.5}>
            <div className="panel-card-head">
              <h2>{tx('安全边界', 'Security Boundaries')}</h2>
              <span className="minimal-status-dot"><ShieldCheck /> {tx('正常', 'Active')}</span>
            </div>
            <div className="security-mono-list">
              <div><Check /><span>{tx('默认绑定 127.0.0.1，外网强制 12 位强密码与服务端 RBAC', 'Loopback-first bind with mandatory 12-char auth & server RBAC on 0.0.0.0')}</span></div>
              <div><Check /><span>{tx('原始文件 SHA-256 只读追踪，绝不改写原件', 'Original files stay strictly read-only with SHA-256 verification')}</span></div>
              <div><Check /><span>{tx('AI 删除强制拦截至待删审批与回收站', 'AI delete proposals intercepted into Pending Delete & Recycle Bin')}</span></div>
              <div><Check /><span>{tx('MCP 写入强制锁定为草稿状态，保留已发布基线', 'MCP agent writes hard-locked to Draft status, preserving baselines')}</span></div>
            </div>
          </SpotlightCard>
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
                <label htmlFor="new-pwd">{tx('新密码（至少 12 位）', 'New Password (min 12 chars)')}</label>
                <input id="new-pwd" className="text-input" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
              </div>
              <button className="btn-primary btn-sm" type="submit" disabled={submitting || !oldPwd || newPwd.length < 12}>
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
                  <input id="create-pwd" className="text-input" type="password" value={newUserPwd} onChange={e => setNewUserPwd(e.target.value)} placeholder={tx('至少 12 位（字母+数字/符号）', 'Min 12 chars (letters + digits)')} />
                </div>
                <div className="field-row">
                  <label htmlFor="create-role">{tx('角色', 'Role')}</label>
                  <select id="create-role" className="text-input" value={newUserRole} onChange={e => setNewUserRole(e.target.value as AdminRole)}>
                    <option value="reviewer">{tx('审核员', 'Reviewer')}</option>
                    <option value="superadmin">{tx('超级管理员', 'Superadmin')}</option>
                  </select>
                </div>
                <button className="btn-primary btn-sm" type="submit" disabled={submitting || !newUsername.trim() || newUserPwd.length < 12}>
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
