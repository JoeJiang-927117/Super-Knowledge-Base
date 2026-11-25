import {
  BookOpen, CheckCheck, FileText, FolderOpen, History, Languages, LayoutDashboard,
  Moon, Search, Settings2, Shield, ShieldCheck, Sparkles, Sun, Upload
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { WikiPage } from '../../../shared/types'
import { useI18n } from '../i18n'

export type CommandItem = {
  id: string
  group: string
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
  const { locale, toggleLocale, tx } = useI18n()
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
    const grpAction = tx('操作', 'Actions')
    const grpNav = tx('导航', 'Navigation')
    const grpPage = tx('知识页面', 'Pages')

    const actions: CommandItem[] = [
      { id: 'act-import', group: grpAction, label: tx('导入资料', 'Import Files'), meta: tx('PDF / DOCX / XLSX / PPTX / 图片', 'PDF / DOCX / XLSX / PPTX / Images'), icon: Upload, run: onImport },
      { id: 'act-organize', group: grpAction, label: tx('更新知识库', 'Compile Knowledge Base'), meta: tx('增量编译 Wiki', 'Incremental Wiki Build'), icon: Sparkles, run: onOrganize },
      { id: 'act-settings', group: grpAction, label: tx('模型接口设置', 'Model API Settings'), meta: 'LLLM / LLM / VM', icon: Settings2, run: onOpenSettings },
      { id: 'act-workspace', group: grpAction, label: tx('切换知识库目录', 'Switch Workspace Folder'), icon: FolderOpen, run: onSelectWorkspace },
      {
        id: 'act-theme',
        group: grpAction,
        label: theme === 'dark' ? tx('切换浅色外观', 'Switch to Light Mode') : tx('切换深色外观', 'Switch to Dark Mode'),
        icon: theme === 'dark' ? Sun : Moon,
        run: onToggleTheme
      },
      {
        id: 'act-lang',
        group: grpAction,
        label: locale === 'zh' ? 'Switch to English' : '切换为简体中文',
        meta: locale === 'zh' ? 'EN' : '中文',
        icon: Languages,
        run: toggleLocale
      }
    ]
    const navs: CommandItem[] = [
      { id: 'nav-home', group: grpNav, label: tx('工作台', 'Workspace'), icon: LayoutDashboard, run: () => onNavigate('home') },
      { id: 'nav-knowledge', group: grpNav, label: tx('知识库', 'Knowledge'), icon: BookOpen, run: () => onNavigate('knowledge') },
      { id: 'nav-review', group: grpNav, label: tx('审核队列', 'Review Queue'), icon: CheckCheck, run: () => onNavigate('review') },
      { id: 'nav-health', group: grpNav, label: tx('知识体检', 'Health Check'), icon: ShieldCheck, run: () => onNavigate('health') },
      { id: 'nav-activity', group: grpNav, label: tx('版本审计', 'Version Audit'), icon: History, run: () => onNavigate('activity') },
      { id: 'nav-admin', group: grpNav, label: tx('系统后台', 'Admin Console'), icon: Shield, run: () => onNavigate('admin') }
    ]
    const docItems: CommandItem[] = pages.slice(0, 60).map(page => ({
      id: `page-${page.slug}`,
      group: grpPage,
      label: page.title,
      meta: page.versionLabel ?? 'V1.0',
      icon: FileText,
      run: () => onOpenPage(page.slug)
    }))
    const all = [...actions, ...navs, ...docItems]
    const q = term.trim().toLocaleLowerCase(locale === 'en' ? 'en-US' : 'zh-CN')
    if (!q) return all.slice(0, 14)
    return all.filter(item => `${item.label} ${item.meta ?? ''} ${item.group}`.toLocaleLowerCase(locale === 'en' ? 'en-US' : 'zh-CN').includes(q)).slice(0, 18)
  }, [pages, term, theme, locale, tx, toggleLocale, onImport, onNavigate, onOpenPage, onOpenSettings, onOrganize, onSelectWorkspace, onToggleTheme])

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
      <div className="cmd-modal" role="dialog" aria-label={tx('快捷命令', 'Command Palette')} onClick={e => e.stopPropagation()}>
        <div className="cmd-input-row">
          <Search />
          <input
            ref={inputRef}
            value={term}
            onChange={e => setTerm(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={tx('搜索页面或执行命令…', 'Search pages or run commands…')}
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
            <div className="cmd-empty">{tx('无匹配结果', 'No matching results')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
