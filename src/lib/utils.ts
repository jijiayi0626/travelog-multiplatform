import type { ExpenseCategory, TripStatus } from './types'

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
