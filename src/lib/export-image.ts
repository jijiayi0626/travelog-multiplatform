import type { Trip } from './types'
import { getLang, translateText } from './i18n'
import { formatDate, formatMoney } from './utils'

/** 首图统计：天数、日程数、记录数、总花费（人民币） */
export interface TripPosterStats {
  days: number
  plans: number
  moments: number
  total: number
}

const WIDTH = 1080
const HEIGHT = 1440
const MARGIN = 88
const CONTENT_WIDTH = WIDTH - MARGIN * 2

const FONT =
  "'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif"

/** 与 index.css 的 cover-0 ~ cover-4 保持一致的封面配色 */
const COVER_GRADIENTS: Array<[string, string, string]> = [
  ['#2563eb', '#1e3a8a', '#0f1b3d'],
  ['#0ea5e9', '#0369a1', '#082f49'],
  ['#f59e0b', '#b45309', '#451a03'],
  ['#14b8a6', '#0f766e', '#042f2e'],
  ['#6366f1', '#4338ca', '#1e1b4b'],
]

function tr(zh: string, vars?: Record<string, string | number>): string {
  return translateText(getLang(), zh, vars)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

/** 中文按字断行，英文尽量在空格处断行 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of text.replace(/\s+/g, ' ').trim()) {
    const next = line + char
    if (line && ctx.measureText(next).width > maxWidth) {
      if (/[A-Za-z0-9]/.test(char)) {
        const cut = line.lastIndexOf(' ')
        if (cut > 0) {
          lines.push(line.slice(0, cut))
          line = `${line.slice(cut + 1)}${char}`
          continue
        }
      }
      lines.push(line)
      line = char === ' ' ? '' : char
      continue
    }
    line = next
  }
  if (line) lines.push(line)
  return lines.length > 0 ? lines : ['']
}

function clampLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  maxLines: number,
  maxWidth: number,
): string[] {
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1)
  }
  kept[maxLines - 1] = `${last}…`
  return kept
}

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
  weight = 700,
): number {
  let size = startSize
  while (size > 48) {
    ctx.font = `${weight} ${size}px ${FONT}`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 4
  }
  return size
}

/**
 * 生成 1080×1440 的行程海报。纯 canvas 绘制，不依赖网络图片。
 * 调用方负责把 Blob 分享或下载。
 */
export async function renderTripPoster(trip: Trip, stats: TripPosterStats): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')

  const palette = COVER_GRADIENTS[Math.abs(trip.cover) % COVER_GRADIENTS.length]
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
  background.addColorStop(0, palette[0])
  background.addColorStop(0.58, palette[1])
  background.addColorStop(1, palette[2])
  ctx.fillStyle = background
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // 柔和光斑，让纯色渐变更有层次
  const glow = ctx.createRadialGradient(WIDTH * 0.86, 130, 0, WIDTH * 0.86, 130, 620)
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.24)')
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const glowBottom = ctx.createRadialGradient(80, HEIGHT - 120, 0, 80, HEIGHT - 120, 560)
  glowBottom.addColorStop(0, 'rgba(255, 255, 255, 0.12)')
  glowBottom.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = glowBottom
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // 装饰圆环
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(WIDTH - 40, 40, 220, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(WIDTH - 40, 40, 300, 0, Math.PI * 2)
  ctx.stroke()

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // 顶部标识
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.font = `600 28px ${FONT}`
  ctx.fillText('TRAVELOG · TRIP POSTER', MARGIN, 140)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.fillRect(MARGIN, 168, 96, 4)

  // 标题
  const title = trip.title.trim() || tr('未命名旅程')
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 88px ${FONT}`
  const titleLines = clampLines(ctx, wrapText(ctx, title, CONTENT_WIDTH), 3, CONTENT_WIDTH)
  let cursor = 300
  for (const line of titleLines) {
    ctx.fillText(line, MARGIN, cursor)
    cursor += 108
  }

  // 目的地
  cursor += 12
  const destination = trip.destination.trim() || tr('目的地待定')
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
  ctx.font = `500 42px ${FONT}`
  ctx.fillText(clampLines(ctx, wrapText(ctx, destination, CONTENT_WIDTH), 1, CONTENT_WIDTH)[0], MARGIN, cursor)

  // 日期范围
  const range = trip.startDate > 0 ? `${formatDate(trip.startDate)} — ${formatDate(trip.endDate)}` : ''
  if (range) {
    cursor += 60
    ctx.fillStyle = 'rgba(255, 255, 255, 0.64)'
    ctx.font = `400 32px ${FONT}`
    ctx.fillText(range, MARGIN, cursor)
  }

  // 分隔线
  cursor += 58
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(MARGIN, cursor)
  ctx.lineTo(WIDTH - MARGIN, cursor)
  ctx.stroke()

  // 三项概览
  const statsY = cursor + 92
  const columns: Array<{ label: string; value: string }> = [
    { label: tr('天数'), value: stats.days > 0 ? tr('{n} 天', { n: stats.days }) : '—' },
    { label: tr('日程'), value: stats.plans > 0 ? tr('{n} 条', { n: stats.plans }) : '—' },
    { label: tr('记录'), value: stats.moments > 0 ? tr('{n} 条', { n: stats.moments }) : '—' },
  ]
  const columnWidth = (WIDTH - MARGIN * 2) / 3
  columns.forEach((column, index) => {
    const x = MARGIN + columnWidth * index
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(column.label, x, statsY)
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 64px ${FONT}`
    ctx.fillText(column.value, x, statsY + 82)
  })

  // 总花费卡片
  const cardY = statsY + 150
  const cardHeight = 250
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
  roundRect(ctx, MARGIN, cardY, CONTENT_WIDTH, cardHeight, 32)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.lineWidth = 2
  roundRect(ctx, MARGIN, cardY, CONTENT_WIDTH, cardHeight, 32)
  ctx.stroke()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.62)'
  ctx.font = `500 30px ${FONT}`
  ctx.fillText(tr('总花费'), MARGIN + 48, cardY + 76)

  const amount = `¥${formatMoney(stats.total)}`
  const amountSize = fitFontSize(ctx, amount, CONTENT_WIDTH - 96, 104)
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${amountSize}px ${FONT}`
  ctx.fillText(amount, MARGIN + 48, cardY + 184)

  // 页脚
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(MARGIN, HEIGHT - 140)
  ctx.lineTo(WIDTH - MARGIN, HEIGHT - 140)
  ctx.stroke()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.font = `600 36px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText('旅记 Travelog', WIDTH / 2, HEIGHT - 76)
  ctx.textAlign = 'left'

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('poster generation failed'))
    }, 'image/png')
  })
}
