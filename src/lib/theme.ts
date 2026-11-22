export type ThemeMode = 'light' | 'dark' | 'system' | 'schedule'
export type AccentName = 'blue' | 'teal' | 'amber' | 'slate' | 'rose'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeSchedule {
  start: string
  end: string
}

const THEME_KEY = 'travelog.theme'
const ACCENT_KEY = 'travelog.accent'
const SCHEDULE_KEY = 'travelog.themeSchedule'
const MEDIA = '(prefers-color-scheme: dark)'
const DEFAULT_SCHEDULE: ThemeSchedule = { start: '20:00', end: '07:00' }

export const ACCENTS: Array<{ value: AccentName; label: string; swatch: string }> = [
  { value: 'blue', label: '海蓝', swatch: '#2563eb' },
  { value: 'teal', label: '青碧', swatch: '#0f766e' },
  { value: 'amber', label: '琥珀', swatch: '#b45309' },
  { value: 'slate', label: '石墨', swatch: '#475569' },
  { value: 'rose', label: '玫瑰', swatch: '#9f1239' },
]

export function getThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' || stored === 'schedule'
    ? stored
    : 'system'
}

function isValidClock(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function getThemeSchedule(): ThemeSchedule {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCHEDULE_KEY) || '{}') as Partial<ThemeSchedule>
    return {
      start: isValidClock(parsed.start) ? parsed.start : DEFAULT_SCHEDULE.start,
      end: isValidClock(parsed.end) ? parsed.end : DEFAULT_SCHEDULE.end,
    }
  } catch {
    return { ...DEFAULT_SCHEDULE }
  }
}

export function setThemeSchedule(patch: Partial<ThemeSchedule>): void {
  const next = { ...getThemeSchedule(), ...patch }
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(next))
  applyTheme(getThemeMode())
}

function minutesOf(clock: string): number {
  const [hour, minute] = clock.split(':').map((part) => Number.parseInt(part, 10))
  return hour * 60 + minute
}

function inSchedule(schedule: ThemeSchedule, now = new Date()): boolean {
  const current = now.getHours() * 60 + now.getMinutes()
  const start = minutesOf(schedule.start)
  const end = minutesOf(schedule.end)
  if (start === end) return false
  return start < end ? current >= start && current < end : current >= start || current < end
}

function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return window.matchMedia(MEDIA).matches ? 'dark' : 'light'
  }
  if (mode === 'schedule') {
    return inSchedule(getThemeSchedule()) ? 'dark' : 'light'
  }
  return mode
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolve(mode)
}

export function getAccent(): AccentName {
  const stored = localStorage.getItem(ACCENT_KEY)
  return stored === 'blue' || stored === 'teal' || stored === 'amber' || stored === 'slate' || stored === 'rose'
    ? stored
    : 'blue'
}

export function applyAccent(accent: AccentName): void {
  document.documentElement.dataset.accent = accent
}

export function applyInitialTheme(): void {
  applyTheme(getThemeMode())
  applyAccent(getAccent())
  watchSchedule()
}

let scheduleTimer: number | null = null
let lastResolved: ResolvedTheme | null = null

/** 定时深色：每分钟检查一次，跨过设定时间点时切换并通知界面 */
function watchSchedule(): void {
  if (scheduleTimer !== null) return
  lastResolved = resolve('light')
  scheduleTimer = window.setInterval(() => {
    if (getThemeMode() !== 'schedule') return
    const next = resolve('schedule')
    if (next === lastResolved) return
    lastResolved = next
    applyTheme('schedule')
    window.dispatchEvent(new CustomEvent('travelog:theme-changed', { detail: next }))
  }, 30_000)
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(THEME_KEY, mode)
  applyTheme(mode)
  lastResolved = resolve(mode)
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

export function currentTheme(): ResolvedTheme {
  return resolve(getThemeMode())
}