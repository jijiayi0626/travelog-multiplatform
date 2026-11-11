import type { Currency, ExpenseCategory, PlanKind, TripStatus } from './types'

const DAY = 24 * 60 * 60 * 1000

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`
}

export function formatDate(timestamp: number): string {
  if (timestamp <= 0) return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`
}

export function formatDateCn(timestamp: number): string {
  if (timestamp <= 0) return ''
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatDateLong(timestamp: number): string {
  if (timestamp <= 0) return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function formatMoney(amount: number): string {
  const fixed = Math.abs(amount).toFixed(2)
  const [integerPart, decimalPart] = fixed.split('.')
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${amount < 0 ? '-' : ''}${grouped}.${decimalPart}`
}

export function tripDayCount(startDate: number, endDate: number): number {
  if (startDate <= 0 || endDate <= 0 || endDate < startDate) return 0
  return Math.floor((endDate - startDate) / DAY) + 1
}

export function dayIndexInTrip(startDate: number, timestamp: number): number {
  if (startDate <= 0 || timestamp < startDate) return 0
  return Math.floor((timestamp - startDate) / DAY) + 1
}

export function tripStatusOf(startDate: number, endDate: number): TripStatus {
  const now = Date.now()
  if (startDate <= 0 || endDate <= 0) return 'planned'
  if (now < startDate) return 'planned'
  if (now > endDate + DAY) return 'finished'
  return 'ongoing'
}

export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function todayStart(): number {
  return startOfDay(Date.now())
}

export function addDays(base: number, days: number): number {
  return base + days * DAY
}

export function toDateInputValue(timestamp: number): string {
  if (timestamp <= 0) return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function fromDateInputValue(value: string): number {
  if (!value) return 0
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1).getTime()
}

export const CATEGORY_ORDER: ExpenseCategory[] = [
  'food',
  'transport',
  'stay',
  'ticket',
  'shopping',
  'other',
]

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  food: '餐饮',
  transport: '交通',
  stay: '住宿',
  ticket: '门票',
  shopping: '购物',
  other: '其他',
}

export const CATEGORY_COLOR: Record<ExpenseCategory, string> = {
  food: '#b45309',
  transport: '#0f766e',
  stay: '#4b5563',
  ticket: '#15803d',
  shopping: '#9d174d',
  other: '#6b7280',
}

export const STATUS_LABEL: Record<TripStatus, string> = {
  planned: '计划中',
  ongoing: '进行中',
  finished: '已结束',
}

/* ---------------- 行程计划 ---------------- */

export const PLAN_KIND_ORDER: PlanKind[] = ['transport', 'activity', 'food', 'stay', 'shopping']

export const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  transport: '交通',
  activity: '游玩',
  food: '用餐',
  stay: '住宿',
  shopping: '购物',
}

export const PLAN_KIND_COLOR: Record<PlanKind, string> = {
  transport: '#0f766e',
  activity: '#b45309',
  food: '#9d174d',
  stay: '#4b5563',
  shopping: '#15803d',
}

/** '09:30:00' / '9:30' / '09.30' → '09:30'，非法输入返回空串 */
export function normalizeClock(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  const matched = raw.match(/^(\d{1,2})[:：.]?(\d{2})?$/)
  if (!matched) return ''
  const hour = Number(matched[1])
  const minute = matched[2] ? Number(matched[2]) : 0
  if (hour > 23 || minute > 59) return ''
  return `${pad2(hour)}:${pad2(minute)}`
}

export function clockToMinutes(value: string): number {
  if (!value) return Number.MAX_SAFE_INTEGER
  const [hour, minute] = value.split(':').map(Number)
  return (hour || 0) * 60 + (minute || 0)
}

export function nowClock(): string {
  const date = new Date()
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 今天在旅程中是第几天（1 开始），不在范围内返回 0 或负数 */
export function dayIndexOfDate(startDate: number, timestamp = Date.now()): number {
  if (startDate <= 0) return 0
  return Math.floor((startOfDay(timestamp) - startOfDay(startDate)) / DAY) + 1
}

export function coverClass(seed: number): string {
  return `cover-${Math.abs(seed) % 5}`
}

export function coverSeed(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return hash % 5
}

export function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 1)
}

export async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
    createImageBitmap(file),
  )
  const maxSide = 1440
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('canvas unavailable')
  }
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.82)
}

export function assetUrl(relative: string): string {
  return `${import.meta.env.BASE_URL}${relative.replace(/^\/+/, '')}`
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minute = 60 * 1000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`
  return formatDateCn(timestamp)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 回退到 execCommand
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/* ---------------- 货币 ---------------- */

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  CNY: '¥',
  JPY: '¥',
  USD: '$',
  EUR: '€',
  THB: '฿',
}

export const CURRENCY_LABEL: Record<Currency, string> = {
  CNY: '人民币',
  JPY: '日元',
  USD: '美元',
  EUR: '欧元',
  THB: '泰铢',
}

/** 固定的离线汇率（1 单位外币 ≈ N 人民币），仅用于本地统计展示 */
export const CURRENCY_RATE_TO_CNY: Record<Currency, number> = {
  CNY: 1,
  JPY: 0.048,
  USD: 7.2,
  EUR: 7.8,
  THB: 0.2,
}

export const CURRENCY_ORDER: Currency[] = ['CNY', 'JPY', 'USD', 'EUR', 'THB']

export function toCny(amount: number, currency: Currency = 'CNY'): number {
  return amount * CURRENCY_RATE_TO_CNY[currency]
}

export function formatCurrency(amount: number, currency: Currency = 'CNY'): string {
  return `${CURRENCY_SYMBOL[currency]}${formatMoney(amount)}`
}

export function formatCny(amount: number): string {
  return `¥${formatMoney(amount)}`
}

/* ---------------- 时间聚合 ---------------- */

export function monthKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

export function monthLabel(key: string): string {
  const [, month] = key.split('-')
  return `${Number(month)}月`
}

export function lastMonths(count: number): string[] {
  const now = new Date()
  const keys: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${date.getFullYear()}-${pad2(date.getMonth() + 1)}`)
  }
  return keys
}

export function daysUntil(timestamp: number): number {
  const today = startOfDay(Date.now())
  return Math.round((startOfDay(timestamp) - today) / DAY)
}

export function countdownText(startDate: number): string {
  const days = daysUntil(startDate)
  if (days > 1) return `还有 ${days} 天出发`
  if (days === 1) return '明天出发'
  if (days === 0) return '今天出发'
  return ''
}

/* ---------------- 文件 ---------------- */

export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file, 'utf-8')
  })
}