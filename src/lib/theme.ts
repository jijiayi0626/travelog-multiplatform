export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'travelog.theme'
const MEDIA = '(prefers-color-scheme: dark)'

export function getThemeMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY)
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

export function applyInitialTheme(): void {
  applyTheme(getThemeMode())
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
  applyTheme(mode)
}

export function subscribeSystemTheme(callback: () => void): () => void {
  const media = window.matchMedia(MEDIA)
  const handler = () => {
    if (getThemeMode() === 'system') {
      callback()
    }
  }
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}

export function currentTheme(): 'light' | 'dark' {
  return resolve(getThemeMode())
}