import { ArrowRight, CircleAlert, Eye, EyeOff, KeyRound, Minus, Moon, Square, Sun, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import logo from '../assets/zhixu-icon.png'
import wallpaperSky from '../assets/wallpaper-sky.jpg'
import wallpaperSunset from '../assets/wallpaper-sunset.jpg'
import { useI18n } from '../i18n'
import { ZhixuIsoLoader } from './BootLoader'

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
  const [scene, setScene] = useState<'sky' | 'sunset'>(theme === 'dark' ? 'sunset' : 'sky')

  const activeWallpaper = scene === 'sky' ? wallpaperSky : wallpaperSunset

  function switchScene(next: 'sky' | 'sunset') {
    setScene(next)
    onToggleTheme(next === 'sunset' ? 'dark' : 'light')
  }

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

  return (
    <div className={`login-screen scene-${scene}`}>
      <div
        className="login-backdrop"
        style={{ backgroundImage: `url(${activeWallpaper})` }}
        aria-hidden="true"
      />
      <div className="login-backdrop-scrim" aria-hidden="true" />

      <header className="login-topbar">
        <div className="login-topbar-brand">
          <img src={logo} alt={tx('知序', 'ZHIXU')} />
          <span>{tx('知序 ZHIXU', 'ZHIXU')}</span>
        </div>
        <div className="login-topbar-actions">
          <div className="scene-switch" role="group" aria-label={tx('语言切换', 'Language')}>
            <button
              type="button"
              className={locale === 'en' ? 'active' : ''}
              onClick={() => setLocale('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={locale === 'zh' ? 'active' : ''}
              onClick={() => setLocale('zh')}
            >
              中文
            </button>
          </div>
          <div className="scene-switch" role="group" aria-label={tx('壁纸切换', 'Theme wallpaper')}>
            <button
              type="button"
              className={scene === 'sky' ? 'active' : ''}
              onClick={() => switchScene('sky')}
            >
              <Sun /> {tx('晴空', 'Sky')}
            </button>
            <button
              type="button"
              className={scene === 'sunset' ? 'active' : ''}
              onClick={() => switchScene('sunset')}
            >
              <Moon /> {tx('暮光', 'Sunset')}
            </button>
          </div>
          {windowControls && (
            <div className="login-win-controls">
              <button type="button" onClick={() => void windowControls.minimize()} aria-label={tx('最小化', 'Minimize')}><Minus /></button>
              <button type="button" onClick={() => void windowControls.toggleMaximize()} aria-label={tx('最大化', 'Maximize')}><Square /></button>
              <button type="button" className="win-close" onClick={() => void windowControls.close()} aria-label={tx('关闭', 'Close')}><X /></button>
            </div>
          )}
        </div>
      </header>

      <main className="login-stage">
        <div className="login-showcase">
          <div className="login-visual">
            <img src={activeWallpaper} alt="" />
            <div className="login-visual-overlay" />
            <div className="login-visual-bottom">
              <div className="visual-badge">
                <img src={logo} alt={tx('知序', 'ZHIXU')} />
                <div>
                  <strong>{tx('知序 ZHIXU', 'ZHIXU')}</strong>
                  <span>PRO DESKTOP</span>
                </div>
              </div>
              <div className="visual-dots" aria-label={tx('切换壁纸', 'Switch wallpaper')}>
                <button
                  type="button"
                  className={scene === 'sky' ? 'active' : ''}
                  onClick={() => switchScene('sky')}
                  aria-label={tx('晴空壁纸', 'Sky wallpaper')}
                />
                <button
                  type="button"
                  className={scene === 'sunset' ? 'active' : ''}
                  onClick={() => switchScene('sunset')}
                  aria-label={tx('暮光壁纸', 'Sunset wallpaper')}
                />
              </div>
            </div>
          </div>

          <form
            className={`login-form-pane ${!passwordRequired ? 'is-welcome-mode' : ''}`}
            onSubmit={event => void handleSubmit(event)}
          >
            <div className="login-form-head">
              <img src={logo} alt={tx('知序', 'ZHIXU')} />
              <h1>{passwordRequired ? tx('登录知序', 'Sign in to ZHIXU') : tx('知序 ZHIXU', 'ZHIXU')}</h1>
            </div>

            {error && (
              <div className="login-error" role="alert">
                <CircleAlert />
                <span>{error}</span>
              </div>
            )}

            {passwordRequired && (
              <div className="login-fields">
                <div className="field-row">
                  <label htmlFor="login-username">{tx('账号', 'Username')}</label>
                  <input
                    id="login-username"
                    className="login-input"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder={tx('输入账号', 'Enter username')}
                    autoComplete="username"
                    autoFocus
                  />
                </div>

                <div className="field-row">
                  <label htmlFor="login-password">{tx('密码', 'Password')}</label>
                  <div className="pwd-wrap">
                    <input
                      id="login-password"
                      className="login-input"
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={tx('输入密码', 'Enter password')}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="pwd-toggle"
                      onClick={() => setShowPwd(prev => !prev)}
                      aria-label={showPwd ? tx('隐藏密码', 'Hide password') : tx('显示密码', 'Show password')}
                    >
                      {showPwd ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <button
              className="btn-primary login-submit"
              type="submit"
              disabled={submitting || (passwordRequired && (!username.trim() || !password))}
              autoFocus={!passwordRequired}
            >
              {submitting ? (
                <ZhixuIsoLoader size="xs" />
              ) : passwordRequired ? (
                <KeyRound />
              ) : (
                <ArrowRight />
              )}
              {submitting
                ? tx('正在进入…', 'Entering…')
                : passwordRequired
                  ? tx('登录工作台', 'Sign In')
                  : tx('进入 ZHIXU', 'Enter ZHIXU')}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
