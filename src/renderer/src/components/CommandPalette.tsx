import {
  BookOpen, CheckCheck, FileText, FolderOpen, History, LayoutDashboard,
  Moon, Search, Settings2, Shield, ShieldCheck, Sparkles, Sun, Upload
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { WikiPage } from '../../../shared/types'

export type CommandItem = {
  id: string
  group: '操作' | '导航' | '知识页面'
  label: string
  meta?: string
  icon: typeof Search
  run: () => void
}

type Props = {
  open: boolean
  pages: WikiPage[]
  theme: 'light' | 'dark'
  onClose: () => void
  onNavigate: (view: 'home' | 'knowledge' | 'review' | 'health' | 'activity' | 'admin') => void
  onOpenPage: (slug: string) => void
  onImport: () => void
  onOrganize: () => void
  onOpenSettings: () => void
  onSelectWorkspace: () => void
  onToggleTheme: () => void
}

export default function CommandPalette({
  open,
  pages,
  theme,
  onClose,
  onNavigate,
  onOpenPage,
  onImport,
  onOrganize,
  onOpenSettings,
  onSelectWorkspace,
  onToggleTheme
}: Props) {
  const [term, setTerm] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTerm('')
    setActiveIndex(0)
    window.setTimeout(() => inputRef.current?.focus(), 20)
  }, [open])

  const items = useMemo<CommandItem[]>(() => {
    const actions: CommandItem[] = [
      { id: 'act-import', group: '操作', label: '导入资料', meta: 'PDF / DOCX / MD / 图片', icon: Upload, run: onImport },
      { id: 'act-organize', group: '操作', label: '更新知识库', meta: '增量编译 Wiki', icon: Sparkles, run: onOrganize },
      { id: 'act-settings', group: '操作', label: '模型接口设置', meta: 'LLLM / LLM / VM', icon: Settings2, run: onOpenSettings },
      { id: 'act-workspace', group: '操作', label: '切换知识库目录', icon: FolderOpen, run: onSelectWorkspace },
      {
        id: 'act-theme',
        group: '操作',
        label: theme === 'dark' ? '切换浅色外观' : '切换深色外观',
        icon: theme === 'dark' ? Sun : Moon,
        run: onToggleTheme
      }
    ]
    const navs: CommandItem[] = [
      { id: 'nav-home', group: '导航', label: '工作台', icon: LayoutDashboard, run: () => onNavigate('home') },
      { id: 'nav-knowledge', group: '导航', label: '知识库', icon: BookOpen, run: () => onNavigate('knowledge') },
      { id: 'nav-review', group: '导航', label: '审核队列', icon: CheckCheck, run: () => onNavigate('review') },
      { id: 'nav-health', group: '导航', label: '知识体检', icon: ShieldCheck, run: () => onNavigate('health') },
      { id: 'nav-activity', group: '导航', label: '版本审计', icon: History, run: () => onNavigate('activity') },
      { id: 'nav-admin', group: '导航', label: '系统后台', icon: Shield, run: () => onNavigate('admin') }
    ]
    const docItems: CommandItem[] = pages.slice(0, 60).map(page => ({
      id: `page-${page.slug}`,
      group: '知识页面',
      label: page.title,
      meta: page.versionLabel ?? 'V1.0',
      icon: FileText,
      run: () => onOpenPage(page.slug)
    }))
    const all = [...actions, ...navs, ...docItems]
    const q = term.trim().toLocaleLowerCase('zh-CN')
    if (!q) return all.slice(0, 14)
    return all.filter(item => `${item.label} ${item.meta ?? ''} ${item.group}`.toLocaleLowerCase('zh-CN').includes(q)).slice(0, 18)
  }, [pages, term, theme, onImport, onNavigate, onOpenPage, onOpenSettings, onOrganize, onSelectWorkspace, onToggleTheme])

  useEffect(() => {
    setActiveIndex(0)
  }, [term])

  if (!open) return null

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(prev => (items.length ? (prev + 1) % items.length : 0))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(prev => (items.length ? (prev - 1 + items.length) % items.length : 0))
      return
    }
    if (event.key === 'Enter' && items[activeIndex]) {
      event.preventDefault()
      items[activeIndex].run()
      onClose()
    }
  }

  return (
    <div className="cmd-backdrop" onClick={onClose}>
      <div className="cmd-modal" role="dialog" aria-label="快捷命令" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-row">
          <Search />
          <input
            ref={inputRef}
            value={term}
            onChange={e => setTerm(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索页面或执行命令…"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="cmd-list">
          {items.length ? (
            items.map((item, idx) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  className={idx === activeIndex ? 'active' : ''}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    item.run()
                    onClose()
                  }}
                >
                  <Icon />
                  <span className="cmd-label">{item.label}</span>
                  <span className="cmd-group">{item.meta || item.group}</span>
                </button>
              )
            })
          ) : (
            <div className="cmd-empty">无匹配结果</div>
          )}
        </div>
      </div>
    </div>
  )
}
