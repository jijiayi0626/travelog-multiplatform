export type ThemeMode = 'light' | 'dark' | 'system'
export type AccentName = 'teal' | 'amber' | 'slate' | 'rose'

const THEME_KEY = 'travelog.theme'
const ACCENT_KEY = 'travelog.accent'
const MEDIA = '(prefers-color-scheme: dark)'

export const ACCENTS: Array<{ value: AccentName; label: string; swatch: string }> = [
  { value: 'teal', label: '墨绿', swatch: '#0f766e' },
  { value: 'amber', label: '琥珀', swatch: '#b45309' },
  { value: 'slate', label: '石墨', swatch: '#475569' },
  { value: 'rose', label: '玫瑰', swatch: '#9f1239' },
]

export function getThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia(MEDIA).matches ? 'dark' : 'light'
  }
  return mode
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolve(mode)
}

export function getAccent(): AccentName {
  const stored = localStorage.getItem(ACCENT_KEY)
  return stored === 'teal' || stored === 'amber' || stored === 'slate' || stored === 'rose'
    ? stored
    : 'teal'
}

export function applyAccent(accent: AccentName): void {
  document.documentElement.dataset.accent = accent
}

export function applyInitialTheme(): void {
  applyTheme(getThemeMode())
  applyAccent(getAccent())
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(THEME_KEY, mode)
  applyTheme(mode)
}

export function setAccent(accent: AccentName): void {
  localStorage.setItem(ACCENT_KEY, accent)
  applyAccent(accent)
}

export function subscribeSystemTheme(callback: () => void): () => void {
  const media = window.matchMedia(MEDIA)
  const handler = () => {
    if (getThemeMode() === 'system') callback()
  }
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}

export function currentTheme(): 'light' | 'dark' {
  return resolve(getThemeMode())
}