import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkBadge01Icon, FingerPrintIcon } from '@hugeicons/core-free-icons'
import { ArrowRight, CircleAlert, Eye, EyeOff, KeyRound, Minus, Moon, Square, Sun, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import logo from '../assets/zhixu-icon.png'
import { useI18n } from '../i18n'
import { ZhixuIsoLoader } from './BootLoader'
import ReflectiveCard from './ReflectiveCard'
import ShinyText from './ShinyText'

type Props = {
  theme: 'light' | 'dark'
  passwordRequired?: boolean
  error: string
  onClearError: () => void
  onToggleTheme: (next: 'light' | 'dark') => void
  onEnterLocal?: () => Promise<void>
  onLogin: (username: string, password: string) => Promise<void>
  windowControls?: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
  }
}

export default function LoginPage({
  theme,
  passwordRequired = false,
  error,
  onClearError,
  onToggleTheme,
  onEnterLocal,
  onLogin,
  windowControls
}: Props) {
  const { locale, setLocale, tx } = useI18n()
  const [username, setUsername] = useState('zhixu')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleEnterLocal() {
    if (submitting || !onEnterLocal) return
    onClearError()
    setSubmitting(true)
    try {
      await onEnterLocal()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!passwordRequired) {
      await handleEnterLocal()
      return
    }
    if (!username.trim() || !password || submitting) return
    onClearError()
    setSubmitting(true)
    try {
      await onLogin(username.trim(), password)
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  const isDark = theme === 'dark'

  return (
    <div className={`vault-entry theme-${theme}`}>
      <div className="vault-grid-bg" aria-hidden="true" />
      <div className="vault-spotlight" aria-hidden="true" />

      <header className="vault-topbar">
        <div className="vault-brand-lockup">
          <img src={logo} alt={tx('知序', 'ZHIXU')} />
          <span className="vault-brand-word">ZHIXU</span>
          <span className="vault-brand-sep">/</span>
          <span className="vault-brand-sub">{tx('知识库架构引擎', 'KNOWLEDGE ENGINE')}</span>
        </div>

        <div className="vault-topbar-actions">
          <div className="vault-pill-switch" role="group" aria-label={tx('语言切换', 'Language')}>
            <button type="button" className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>
              EN
            </button>
            <button type="button" className={locale === 'zh' ? 'active' : ''} onClick={() => setLocale('zh')}>
              中文
            </button>
          </div>
          <div className="vault-pill-switch" role="group" aria-label={tx('外观切换', 'Theme')}>
            <button type="button" className={isDark ? 'active' : ''} onClick={() => onToggleTheme('dark')}>
              <Moon /> {tx('曜石', 'Obsidian')}
            </button>
            <button type="button" className={!isDark ? 'active' : ''} onClick={() => onToggleTheme('light')}>
              <Sun /> {tx('陶白', 'Alabaster')}
            </button>
          </div>
          {windowControls && (
            <div className="vault-win-controls">
              <button type="button" onClick={() => void windowControls.minimize()} aria-label={tx('最小化', 'Minimize')}>
                <Minus />
              </button>
              <button type="button" onClick={() => void windowControls.toggleMaximize()} aria-label={tx('最大化', 'Maximize')}>
                <Square />
              </button>
              <button type="button" className="win-close" onClick={() => void windowControls.close()} aria-label={tx('关闭', 'Close')}>
                <X />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="vault-stage">
        <section className="vault-editorial">
          <div className="vault-eyebrow">
            <span className="vault-eyebrow-dot" />
            <span>EDITION 0.3 · APACHE-2.0 · LOCAL-FIRST</span>
          </div>

          <h1 className="vault-headline">
            {locale === 'en' ? (
              <>
                KNOWLEDGE,
                <br />
                <ShinyText
                  text="ARCHITECTED."
                  color={isDark ? '#a1a1aa' : '#52525b'}
                  shineColor={isDark ? '#ffffff' : '#111114'}
                  speed={3.2}
                  delay={1.4}
                  shineWidth={28}
                />
              </>
            ) : (
              <>
                知序 ·
                <br />
                <ShinyText
                  text="秩序即知识。"
                  color={isDark ? '#a1a1aa' : '#52525b'}
                  shineColor={isDark ? '#ffffff' : '#111114'}
                  speed={3.2}
                  delay={1.4}
                  shineWidth={28}
                />
              </>
            )}
          </h1>

          <p className="vault-manifesto">
            {tx(
              '将散落的 PDF、Office 与 Markdown 编译为不可篡改、Git 溯源的本地知识架构，同时服务于人工研判与 MCP 智能体。',
              'Compile raw PDFs, Office suites, and Markdown into an immutable, Git-versioned local knowledge monolith—built for human review and MCP agents.'
            )}
          </p>

          <div className="vault-spec-strip">
            <div>
              <span>01 STORAGE</span>
              <strong>Markdown + SQLite</strong>
            </div>
            <div>
              <span>02 LEDGER</span>
              <strong>Git Rollback</strong>
            </div>
            <div>
              <span>03 BRIDGE</span>
              <strong>Stdio MCP</strong>
            </div>
            <div>
              <span>04 SOURCE</span>
              <strong>SHA-256 Read-Only</strong>
            </div>
          </div>

          <form className="vault-access-form" onSubmit={event => void handleSubmit(event)}>
            {error && (
              <div className="vault-error" role="alert">
                <CircleAlert />
                <span>{error}</span>
              </div>
            )}

            {passwordRequired && (
              <div className="vault-cred-grid">
                <label className="vault-field">
                  <span>{tx('管理员账号', 'ACCOUNT')}</span>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="zhixu"
                    autoComplete="username"
                    required
                  />
                </label>

                <label className="vault-field">
                  <span>{tx('访问密钥', 'PASSWORD')}</span>
                  <div className="vault-pwd-wrap">
                    <KeyRound />
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={tx('输入管理员密码', 'Enter administrator password')}
                      autoComplete="current-password"
                      autoFocus
                      required
                    />
                    <button
                      type="button"
                      className="vault-pwd-eye"
                      onClick={() => setShowPwd(v => !v)}
                      aria-label={showPwd ? tx('隐藏密码', 'Hide password') : tx('显示密码', 'Show password')}
                    >
                      {showPwd ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                </label>
              </div>
            )}

            <div className="vault-cta-row">
              <button
                type="submit"
                className="vault-enter-btn"
                disabled={submitting || (passwordRequired && (!username.trim() || !password))}
              >
                {submitting ? (
                  <>
                    <ZhixuIsoLoader size="xs" />
                    <span>{passwordRequired ? tx('正在校验密钥…', 'Verifying…') : tx('正在开启知识库…', 'Opening Vault…')}</span>
                  </>
                ) : (
                  <>
                    <span>{passwordRequired ? tx('解锁并进入 ZHIXU', 'Unlock ZHIXU') : tx('进入 ZHIXU', 'Enter ZHIXU')}</span>
                    <ArrowRight />
                  </>
                )}
              </button>
              <span className="vault-cta-note">
                {passwordRequired
                  ? tx('网络部署模式 · 已启用 RBAC 与登录防爆破', 'Network guard active · RBAC & rate limiting enforced')
                  : tx('本地零云端 · 原文件 100% 只读不动', 'Zero cloud dependency · Original files stay read-only')}
              </span>
            </div>
          </form>
        </section>

        <section className="vault-monolith-stage" aria-label={tx('知序金属身份卡', 'ZHIXU Metallic Vault Card')}>
          <ReflectiveCard
            theme={theme}
            tint={isDark ? '#e6e7ec' : '#ffffff'}
            metalness={1}
            roughness={0.28}
            blurStrength={6}
            grayscale={1}
            warp={0.55}
            warpScale={1.05}
            shine={1.2}
            bevel={3}
            glare={0.58}
            tiltStrength={11}
            width={344}
            height={472}
            radius={24}
          >
            <div className="reflective-card__header">
              <span className="reflective-card__badge">
                <HugeiconsIcon icon={CheckmarkBadge01Icon} size={16} strokeWidth={1.8} />
                {tx('SHA-256 可溯源', 'SHA-256 Verified')}
              </span>
              <span className="reflective-card__status">
                <span className="reflective-card__dot" />
                {tx('本地就绪', 'Vault Ready')}
              </span>
            </div>

            <div className="vault-card-medallion">
              <div className="vault-card-ring" />
              <img src={logo} alt="ZHIXU" className="vault-card-emblem" />
            </div>

            <div className="reflective-card__identity">
              <h3 className="reflective-card__name">ZHIXU VAULT</h3>
              <p className="reflective-card__role">
                {tx('本地 AI 知识编译器 · 可审计百科', 'Local AI Knowledge Compiler')}
              </p>
            </div>

            <div className="reflective-card__footer">
              <div className="reflective-card__id">
                <span className="reflective-card__label">{tx('架构内核 · 版本', 'CORE LEDGER · EDITION')}</span>
                <span className="reflective-card__value">MD · SQLITE · GIT · MCP</span>
              </div>
              <span className="reflective-card__tile">
                <HugeiconsIcon icon={FingerPrintIcon} size={22} strokeWidth={1.6} />
              </span>
            </div>
          </ReflectiveCard>
        </section>
      </main>
    </div>
  )
}
