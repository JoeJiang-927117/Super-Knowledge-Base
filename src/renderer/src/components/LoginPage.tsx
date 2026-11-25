import { CircleAlert, Eye, EyeOff, KeyRound, LoaderCircle, Minus, Moon, Square, Sun, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import logo from '../assets/zhixu-icon.png'
import wallpaperSky from '../assets/wallpaper-sky.jpg'
import wallpaperSunset from '../assets/wallpaper-sunset.jpg'
import { useI18n } from '../i18n'

type Props = {
  theme: 'light' | 'dark'
  needsSetup?: boolean
  minPasswordLength?: number
  error: string
  onClearError: () => void
  onToggleTheme: (next: 'light' | 'dark') => void
  onSetup?: (username: string, password: string) => Promise<void>
  onLogin: (username: string, password: string) => Promise<void>
  windowControls?: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
  }
}

export default function LoginPage({
  theme,
  needsSetup = false,
  minPasswordLength = 12,
  error,
  onClearError,
  onToggleTheme,
  onSetup,
  onLogin,
  windowControls
}: Props) {
  const { locale, setLocale, tx } = useI18n()
  const [username, setUsername] = useState('zhixu')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [scene, setScene] = useState<'sky' | 'sunset'>(theme === 'dark' ? 'sunset' : 'sky')

  const activeWallpaper = scene === 'sky' ? wallpaperSky : wallpaperSunset

  function switchScene(next: 'sky' | 'sunset') {
    setScene(next)
    onToggleTheme(next === 'sunset' ? 'dark' : 'light')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!username.trim() || !password || submitting) return
    onClearError()
    setLocalError('')
    if (needsSetup) {
      if (password.length < minPasswordLength) {
        setLocalError(
          locale === 'en'
            ? `Password must be at least ${minPasswordLength} characters.`
            : `初始密码长度至少 ${minPasswordLength} 位`
        )
        return
      }
      if (password !== confirmPassword) {
        setLocalError(tx('两次输入的密码不一致', 'Passwords do not match'))
        return
      }
    }
    setSubmitting(true)
    try {
      if (needsSetup && onSetup) {
        await onSetup(username.trim(), password)
      } else {
        await onLogin(username.trim(), password)
      }
      setPassword('')
      setConfirmPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={`login-screen scene-${scene}`}>
      {/* Full-window soft atmospheric wallpaper backdrop */}
      <div
        className="login-backdrop"
        style={{ backgroundImage: `url(${activeWallpaper})` }}
        aria-hidden="true"
      />
      <div className="login-backdrop-scrim" aria-hidden="true" />

      {/* Top draggable titlebar with native controls */}
      <header className="login-topbar">
        <div className="login-topbar-brand">
          <img src={logo} alt={tx('知序', 'ZHIXU')} />
          <span>{tx('知序 ZHIXU', 'ZHIXU')}</span>
        </div>
        <div className="login-topbar-actions">
          <div className="scene-switch" role="group" aria-label={tx('语言切换', 'Language')}>
            <button
              type="button"
              className={locale === 'zh' ? 'active' : ''}
              onClick={() => setLocale('zh')}
            >
              中文
            </button>
            <button
              type="button"
              className={locale === 'en' ? 'active' : ''}
              onClick={() => setLocale('en')}
            >
              EN
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

      {/* Center Split Commercial Showcase Card */}
      <main className="login-stage">
        <div className="login-showcase">
          {/* Left Portrait Photography Showcase (native 9:16 crispness) */}
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

          {/* Right Clean Glass Login Form */}
          <form className="login-form-pane" onSubmit={event => void handleSubmit(event)}>
            <div className="login-form-head">
              <img src={logo} alt={tx('知序', 'ZHIXU')} />
              <h1>{needsSetup ? tx('初始化管理员', 'Initialize Superadmin') : tx('登录知序', 'Sign in to ZHIXU')}</h1>
            </div>

            {(localError || error) && (
              <div className="login-error" role="alert">
                <CircleAlert />
                <span>{localError || error}</span>
              </div>
            )}

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
                <label htmlFor="login-password">
                  {needsSetup
                    ? locale === 'en'
                      ? `New Password (min ${minPasswordLength} chars)`
                      : `设置初始密码（至少 ${minPasswordLength} 位）`
                    : tx('密码', 'Password')}
                </label>
                <div className="pwd-wrap">
                  <input
                    id="login-password"
                    className="login-input"
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={
                      needsSetup
                        ? locale === 'en'
                          ? `At least ${minPasswordLength} chars (letters + digits)`
                          : `至少 ${minPasswordLength} 位（字母+数字/符号）`
                        : tx('输入密码', 'Enter password')
                    }
                    autoComplete={needsSetup ? 'new-password' : 'current-password'}
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

              {needsSetup && (
                <div className="field-row">
                  <label htmlFor="login-confirm-password">{tx('确认密码', 'Confirm Password')}</label>
                  <input
                    id="login-confirm-password"
                    className="login-input"
                    type={showPwd ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder={tx('再次输入初始密码', 'Re-enter password')}
                    autoComplete="new-password"
                  />
                </div>
              )}
            </div>

            <button
              className="btn-primary login-submit"
              type="submit"
              disabled={submitting || !username.trim() || !password || (needsSetup && !confirmPassword)}
            >
              {submitting ? <LoaderCircle className="spin" /> : <KeyRound />}
              {submitting
                ? tx('正在验证…', 'Verifying…')
                : needsSetup
                  ? tx('创建管理员并进入', 'Create Admin & Sign In')
                  : tx('登录工作台', 'Sign In')}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
