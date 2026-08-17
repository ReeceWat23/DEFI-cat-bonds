import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { themes, DEFAULT_THEME } from './tokens'

const STORAGE_KEY = 'rhodex-theme'
const ThemeContext = createContext(null)

function applyTheme(themeId) {
  const theme = themes[themeId] ?? themes[DEFAULT_THEME]
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--rhodex-${key}`, value)
  }
  root.setAttribute('data-theme', theme.id)
}

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME
    return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME
  })

  useEffect(() => {
    applyTheme(themeId)
    window.localStorage.setItem(STORAGE_KEY, themeId)
  }, [themeId])

  const value = useMemo(() => ({
    themeId,
    theme: themes[themeId] ?? themes[DEFAULT_THEME],
    setTheme: (id) => themes[id] && setThemeId(id),
    themes: Object.values(themes),
  }), [themeId])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
