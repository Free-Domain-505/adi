import { createContext, useCallback, useContext, useEffect, useMemo, useState, type Context, type ReactNode } from 'react'
import { toast } from '../lib/toast'

export type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const THEME_CONTEXT_KEY = Symbol.for('animestream.ThemeContext')
const globalWithThemeContext = globalThis as typeof globalThis & {
  [THEME_CONTEXT_KEY]?: Context<ThemeContextValue | null>
}
const ThemeContext = (globalWithThemeContext[THEME_CONTEXT_KEY] ??= createContext<ThemeContextValue | null>(null))
const STORAGE_KEY = 'zenkai-theme'

function applyTheme() {
  document.documentElement.classList.add('dark')
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', '#050506')
  try {
    localStorage.setItem(STORAGE_KEY, 'dark')
  } catch {
    /* ignore */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme] = useState<Theme>('dark')

  useEffect(() => {
    applyTheme()
  }, [])

  const setTheme = useCallback((t: Theme) => {
    if (t === 'light') {
      toast('White mode is not available', 'info')
      applyTheme()
      return
    }
    applyTheme()
  }, [])

  const toggle = useCallback(() => {
    toast('White mode is not available', 'info')
    applyTheme()
  }, [])

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
