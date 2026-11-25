import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Locale = 'zh' | 'en'

type I18nContextValue = {
  locale: Locale
  setLocale: (next: Locale) => void
  toggleLocale: () => void
  tx: (zh: string, en: string) => string
  formatDate: (input: string | number | Date) => string
}

const STORAGE_KEY = 'zhixu-locale'

const zhDateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
const enDateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

export function formatLocalizedDate(input: string | number | Date, locale: Locale = 'zh'): string {
  const date = input instanceof Date ? input : new Date(input)
  return (locale === 'en' ? enDateFormatter : zhDateFormatter).format(date)
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh',
  setLocale: () => {},
  toggleLocale: () => {},
  tx: zh => zh,
  formatDate: input => formatLocalizedDate(input, 'zh')
})

function readInitialLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'zh') return saved
  } catch {}
  return 'zh'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale)

  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
    document.documentElement.dataset.locale = locale
    try {
      window.localStorage.setItem(STORAGE_KEY, locale)
    } catch {}
  }, [locale])

  const setLocale = useCallback((next: Locale) => setLocaleState(next), [])
  const toggleLocale = useCallback(() => setLocaleState(prev => (prev === 'zh' ? 'en' : 'zh')), [])
  const tx = useCallback((zh: string, en: string) => (locale === 'en' ? en : zh), [locale])
  const formatDate = useCallback((input: string | number | Date) => formatLocalizedDate(input, locale), [locale])

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, toggleLocale, tx, formatDate }),
    [locale, setLocale, toggleLocale, tx, formatDate]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
