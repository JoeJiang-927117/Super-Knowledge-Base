import { CircleAlert, Eye, EyeOff, KeyRound, LoaderCircle, Minus, Moon, Square, Sun, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import logo from '../assets/zhixu-icon.png'
import wallpaperSky from '../assets/wallpaper-sky.jpg'
import wallpaperSunset from '../assets/wallpaper-sunset.jpg'

type Props = {
  theme: 'light' | 'dark'
  error: string
  onClearError: () => void
  onToggleTheme: (next: 'light' | 'dark') => void
  onLogin: (username: string, password: string) => Promise<void>
  windowControls?: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
  }
}

export default function LoginPage({
  theme,
  error,
  onClearError,
  onToggleTheme,
  onLogin,
  windowControls
}: Props) {
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
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
          <img src={logo} alt="知序" />
          <span>知序 ZHIXU</span>
        </div>
        <div className="login-topbar-actions">
          <div className="scene-switch" role="group" aria-label="壁纸切换">
            <button
              type="button"
              className={scene === 'sky' ? 'active' : ''}
              onClick={() => switchScene('sky')}
            >
              <Sun /> 晴空
            </button>
            <button
              type="button"
              className={scene === 'sunset' ? 'active' : ''}
              onClick={() => switchScene('sunset')}
            >
              <Moon /> 暮光
            </button>
          </div>
          {windowControls && (
            <div className="login-win-controls">
              <button type="button" onClick={() => void windowControls.minimize()} aria-label="最小化"><Minus /></button>
              <button type="button" onClick={() => void windowControls.toggleMaximize()} aria-label="最大化"><Square /></button>
              <button type="button" className="win-close" onClick={() => void windowControls.close()} aria-label="关闭"><X /></button>
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
                <img src={logo} alt="知序" />
                <div>
                  <strong>知序 ZHIXU</strong>
                  <span>PRO DESKTOP</span>
                </div>
              </div>
              <div className="visual-dots" aria-label="切换壁纸">
                <button
                  type="button"
                  className={scene === 'sky' ? 'active' : ''}
                  onClick={() => switchScene('sky')}
                  aria-label="晴空壁纸"
                />
                <button
                  type="button"
                  className={scene === 'sunset' ? 'active' : ''}
                  onClick={() => switchScene('sunset')}
                  aria-label="暮光壁纸"
                />
              </div>
            </div>
          </div>

          {/* Right Clean Glass Login Form */}
          <form className="login-form-pane" onSubmit={event => void handleSubmit(event)}>
            <div className="login-form-head">
              <img src={logo} alt="知序" />
              <h1>登录知序</h1>
            </div>

            {error && (
              <div className="login-error" role="alert">
                <CircleAlert />
                <span>{error}</span>
              </div>
            )}

            <div className="login-fields">
              <div className="field-row">
                <label htmlFor="login-username">账号</label>
                <input
                  id="login-username"
                  className="login-input"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="输入账号"
                  autoComplete="username"
                  autoFocus
                />
              </div>

              <div className="field-row">
                <label htmlFor="login-password">密码</label>
                <div className="pwd-wrap">
                  <input
                    id="login-password"
                    className="login-input"
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="输入密码"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="pwd-toggle"
                    onClick={() => setShowPwd(prev => !prev)}
                    aria-label={showPwd ? '隐藏密码' : '显示密码'}
                  >
                    {showPwd ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </div>
            </div>

            <button
              className="btn-primary login-submit"
              type="submit"
              disabled={submitting || !username.trim() || !password}
            >
              {submitting ? <LoaderCircle className="spin" /> : <KeyRound />}
              {submitting ? '正在验证…' : '登录工作台'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
