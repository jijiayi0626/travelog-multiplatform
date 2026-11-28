/**
 * 统一分享长图（1080×1440）渲染层。
 *
 * 三套风格差异明显，而不是简单换色：
 *  - magazine：旅行杂志内页，衬线大标题、留白、细分割线、巨大数字统计。
 *  - boarding：登机牌，圆角票根、虚线撕口、左右两栏、条形码、等宽数字。
 *  - passport：护照印章，米色纸张纹理、城市圆形印章、手写感标题、做旧边框。
 *
 * 全部使用系统字体栈，不加载外链字体；所有文字都会换行 / 截断，避免溢出。
 */
import { getLang, translateText } from './i18n'
import { canvasToPng } from './share-image'

export type PosterTemplate = 'magazine' | 'boarding' | 'passport'
export type PosterKind = 'passport' | 'monthly' | 'trip'

export const POSTER_TEMPLATE_KEY = 'travelog.posterTemplate'

export interface PosterTemplateOption {
  value: PosterTemplate
  label: string
  hint: string
}

export const POSTER_TEMPLATE_OPTIONS: PosterTemplateOption[] = [
  { value: 'magazine', label: '杂志', hint: '衬线大标题' },
  { value: 'boarding', label: '登机牌', hint: '票根条形码' },
  { value: 'passport', label: '护照印章', hint: '纸张圆章' },
]

const TEMPLATES: PosterTemplate[] = ['magazine', 'boarding', 'passport']

export function getPosterTemplate(): PosterTemplate {
  try {
    const stored = localStorage.getItem(POSTER_TEMPLATE_KEY)
    if (stored && (TEMPLATES as string[]).includes(stored)) return stored as PosterTemplate
  } catch {
    /* 隐私模式下 localStorage 不可用 */
  }
  return 'magazine'
}

export function setPosterTemplate(template: PosterTemplate): void {
  try {
    localStorage.setItem(POSTER_TEMPLATE_KEY, template)
  } catch {
    /* 忽略写入失败 */
  }
}

export interface PosterStat {
  label: string
  value: string
}

export interface PosterStamp {
  city: string
  visits: number
  /** 首访月份，如 2025-11；没有则为空字符串 */
  first?: string
  photos?: number
}

export interface PosterCategory {
  label: string
  value: string
  ratio: number
  color: string
}

export interface PosterData {
  kind: PosterKind
  eyebrow: string
  title: string
  subtitle: string
  stats: PosterStat[]
  stamps?: PosterStamp[]
  cities?: string[]
  categories?: PosterCategory[]
  money?: { label: string; value: string }
  footnote?: string
  footer: string
}

const W = 1080
const H = 1440
const M = 96

const SANS =
  "'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif"
const SERIF =
  "'Songti SC', 'STSong', 'Noto Serif SC', 'Source Han Serif SC', Georgia, 'Times New Roman', serif"
const MONO =
  "'SF Mono', 'SFMono-Regular', Menlo, Consolas, 'Roboto Mono', ui-monospace, monospace"
const HAND = "'Kaiti SC', 'STKaiti', 'KaiTi', 'Songti SC', 'Noto Serif SC', serif"

function tr(zh: string, vars?: Record<string, string | number>): string {
  return translateText(getLang(), zh, vars)
}

function fontOf(weight: string | number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`
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
  let last = kept[maxLines - 1] ?? ''
  while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1)
  }
  kept[maxLines - 1] = `${last}…`
  return kept
}

/** 单行截断（按当前字体测量） */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let value = text
  while (value.length > 0 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1)
  }
  return `${value}…`
}

/** 在给定字体族下把单行文字缩到 maxWidth 以内 */
function fitSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
  weight: string | number,
  family: string,
): number {
  let size = startSize
  while (size > 20) {
    ctx.font = fontOf(weight, size, family)
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 2
  }
  return size
}

/** 确定性伪随机，保证同一张图纹理 / 条码稳定 */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function serialOf(data: PosterData): string {
  const serial = hashString(`${data.kind}|${data.title}|${data.subtitle}`) % 10000
  return serial.toString().padStart(4, '0')
}

function drawBarcode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  seed: number,
  color: string,
): void {
  const rand = seeded(seed)
  ctx.fillStyle = color
  let cursor = x
  while (cursor < x + width - 3) {
    const bar = 2 + Math.floor(rand() * 6)
    const gap = 2 + Math.floor(rand() * 5)
    if (rand() > 0.32) {
      ctx.fillRect(cursor, y, Math.min(bar, x + width - cursor), height)
    }
    cursor += bar + gap
  }
}

/* ------------------------------------------------------------------ */
/* 杂志风                                                              */
/* ------------------------------------------------------------------ */

function renderMagazine(ctx: CanvasRenderingContext2D, data: PosterData): void {
  const INK = '#1b1a16'
  const MUTED = '#736b5b'
  const LINE = '#d3c9b4'
  const ACCENT = '#8a4b2a'
  const contentWidth = W - M * 2

  ctx.fillStyle = '#f7f2e7'
  ctx.fillRect(0, 0, W, H)

  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.fillRect(M, 96, 96, 3)
  ctx.fillStyle = MUTED
  ctx.font = fontOf(600, 24, SANS)
  ctx.fillText(ellipsize(ctx, data.eyebrow, contentWidth), M, 152)

  let y = 300
  let titleSize = 100
  ctx.font = fontOf(700, titleSize, SERIF)
  let titleLines = wrapText(ctx, data.title || ' ', contentWidth)
  if (titleLines.length > 2) {
    titleSize = 80
    ctx.font = fontOf(700, titleSize, SERIF)
    titleLines = wrapText(ctx, data.title || ' ', contentWidth)
  }
  titleLines = clampLines(ctx, titleLines, 2, contentWidth)
  ctx.fillStyle = INK
  for (const line of titleLines) {
    ctx.fillText(line, M, y)
    y += titleSize * 1.12
  }

  y += 14
  ctx.fillStyle = MUTED
  ctx.font = `italic 400 34px ${SERIF}`
  const subtitleLines = clampLines(ctx, wrapText(ctx, data.subtitle, contentWidth), 2, contentWidth)
  for (const line of subtitleLines) {
    ctx.fillText(line, M, y)
    y += 48
  }

  y += 20
  ctx.fillStyle = LINE
  ctx.fillRect(M, y, contentWidth, 1)
  y += 16

  const hero = data.money ?? data.stats[0]
  const restStats = data.money ? data.stats : data.stats.slice(1)

  if (hero) {
    y += 30
    ctx.fillStyle = MUTED
    ctx.font = fontOf(500, 26, SANS)
    ctx.fillText(ellipsize(ctx, hero.label, contentWidth), M, y)
    const heroText = hero.value || '0'
    const heroSize = fitSize(ctx, heroText, contentWidth, 188, 600, SERIF)
    ctx.fillStyle = INK
    ctx.font = fontOf(600, heroSize, SERIF)
    y += heroSize * 0.86
    ctx.fillText(ellipsize(ctx, heroText, contentWidth), M, y)
    y += 34
  }

  if (restStats.length > 0) {
    const columns = Math.min(restStats.length, 4)
    const columnWidth = contentWidth / columns
    restStats.slice(0, columns).forEach((stat, index) => {
      const x = M + columnWidth * index
      const inner = columnWidth - 28
      ctx.textAlign = 'left'
      ctx.fillStyle = MUTED
      ctx.font = fontOf(500, 23, SANS)
      ctx.fillText(ellipsize(ctx, stat.label, inner), x, y)
      const valueSize = fitSize(ctx, stat.value, inner, 58, 600, SERIF)
      ctx.fillStyle = INK
      ctx.font = fontOf(600, valueSize, SERIF)
      ctx.fillText(ellipsize(ctx, stat.value, inner), x, y + 58)
    })
    y += 112
  }

  const bottom = H - 214

  if (data.categories && data.categories.length > 0 && y + 60 < bottom) {
    ctx.fillStyle = MUTED
    ctx.font = fontOf(500, 23, SANS)
    ctx.fillText(tr('分类占比'), M, y)
    y += 34
    for (const item of data.categories.slice(0, 5)) {
      if (y + 46 > bottom) break
      ctx.textAlign = 'left'
      ctx.fillStyle = INK
      ctx.font = fontOf(400, 32, SERIF)
      ctx.fillText(ellipsize(ctx, item.label, contentWidth - 300), M, y)
      ctx.textAlign = 'right'
      ctx.fillStyle = MUTED
      ctx.font = fontOf(400, 24, MONO)
      ctx.fillText(item.value, W - M, y)
      ctx.textAlign = 'left'
      ctx.fillStyle = LINE
      ctx.fillRect(M, y + 18, contentWidth, 3)
      ctx.fillStyle = ACCENT
      ctx.fillRect(M, y + 18, Math.max(contentWidth * item.ratio, 6), 3)
      y += 62
    }
  }

  if (data.stamps && data.stamps.length > 0) {
    const rowHeight = 56
    const columnWidth = (contentWidth - 40) / 2
    const maxRows = Math.max(0, Math.floor((bottom - y) / rowHeight))
    const shown = data.stamps.slice(0, maxRows * 2)
    shown.forEach((stamp, index) => {
      const column = index % 2
      const row = Math.floor(index / 2)
      const x = M + column * (columnWidth + 40)
      const lineY = y + row * rowHeight
      ctx.textAlign = 'left'
      ctx.fillStyle = INK
      ctx.font = fontOf(400, 30, SERIF)
      ctx.fillText(ellipsize(ctx, stamp.city, columnWidth - 110), x, lineY)
      ctx.textAlign = 'right'
      ctx.fillStyle = MUTED
      ctx.font = fontOf(400, 22, MONO)
      ctx.fillText(
        stamp.visits > 0 ? tr('{n} 次', { n: stamp.visits }) : tr('到访'),
        x + columnWidth,
        lineY,
      )
      ctx.textAlign = 'left'
      ctx.fillStyle = LINE
      ctx.fillRect(x, lineY + 14, columnWidth, 1)
    })
    y += maxRows * rowHeight
    if (data.stamps.length > shown.length) {
      ctx.fillStyle = MUTED
      ctx.font = fontOf(400, 25, SANS)
      ctx.fillText(
        tr('另有 {n} 座城市', { n: data.stamps.length - shown.length }),
        M,
        Math.min(y + 6, bottom),
      )
    }
  } else if (data.cities && data.cities.length > 0) {
    const maxLines = Math.max(1, Math.floor((bottom - y) / 50))
    ctx.fillStyle = INK
    ctx.font = fontOf(400, 34, SERIF)
    const lines = clampLines(
      ctx,
      wrapText(ctx, data.cities.join(' · '), contentWidth),
      maxLines,
      contentWidth,
    )
    for (const line of lines) {
      ctx.fillText(line, M, y)
      y += 50
    }
  }

  ctx.fillStyle = LINE
  ctx.fillRect(M, H - 150, contentWidth, 1)
  if (data.footnote) {
    ctx.fillStyle = MUTED
    ctx.font = fontOf(400, 25, SANS)
    ctx.fillText(ellipsize(ctx, data.footnote, contentWidth), M, H - 112)
  }
  ctx.fillStyle = MUTED
  ctx.font = fontOf(500, 25, SANS)
  ctx.fillText(ellipsize(ctx, data.footer, contentWidth - 250), M, H - 62)
  ctx.textAlign = 'right'
  ctx.fillStyle = ACCENT
  ctx.font = fontOf(600, 23, SANS)
  ctx.fillText(`TRAVELOG No.${serialOf(data)}`, W - M, H - 62)
  ctx.textAlign = 'left'
}

/* ------------------------------------------------------------------ */
/* 登机牌                                                              */
/* ------------------------------------------------------------------ */

function renderBoarding(ctx: CanvasRenderingContext2D, data: PosterData): void {
  const INK = '#14212c'
  const MUTED = '#8b8577'
  const ACCENT = '#d4553d'
  const CARD_X = 56
  const CARD_Y = 64
  const CARD_W = W - 112
  const CARD_H = H - 128
  const RADIUS = 44

  const background = ctx.createLinearGradient(0, 0, W, H)
  background.addColorStop(0, '#12354f')
  background.addColorStop(0.55, '#0e2740')
  background.addColorStop(1, '#081827')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, W, H)

  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 2
  for (let i = 0; i < 4; i++) {
    ctx.beginPath()
    ctx.arc(W - 60, 120 + i * 130, 180 + i * 60, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 36
  ctx.shadowOffsetY = 16
  ctx.fillStyle = '#fbfaf5'
  roundRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, RADIUS)
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, RADIUS)
  ctx.clip()
  ctx.fillStyle = ACCENT
  ctx.fillRect(CARD_X, CARD_Y, CARD_W, 10)
  ctx.restore()
  ctx.strokeStyle = '#e2ddcf'
  ctx.lineWidth = 2
  roundRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, RADIUS)
  ctx.stroke()

  const tearX = CARD_X + CARD_W * 0.68
  ctx.fillStyle = '#0d2336'
  ctx.beginPath()
  ctx.arc(tearX, CARD_Y, 24, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(tearX, CARD_Y + CARD_H, 24, 0, Math.PI * 2)
  ctx.fill()
  ctx.setLineDash([14, 12])
  ctx.strokeStyle = '#c9c4b7'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(tearX, CARD_Y + 50)
  ctx.lineTo(tearX, CARD_Y + CARD_H - 50)
  ctx.stroke()
  ctx.setLineDash([])

  /* 左栏：票面主体 */
  const LX = CARD_X + 56
  const LW = tearX - LX - 40
  ctx.textAlign = 'left'

  ctx.fillStyle = INK
  ctx.font = fontOf(700, 25, SANS)
  ctx.fillText('BOARDING PASS', LX, CARD_Y + 88)
  ctx.textAlign = 'right'
  ctx.fillStyle = MUTED
  ctx.font = fontOf(600, 22, MONO)
  ctx.fillText('TRAVELOG', tearX - 40, CARD_Y + 88)
  ctx.textAlign = 'left'

  let y = CARD_Y + 158
  ctx.fillStyle = MUTED
  ctx.font = fontOf(500, 21, MONO)
  ctx.fillText(ellipsize(ctx, data.eyebrow, LW), LX, y)

  y += 78
  let titleSize = 60
  ctx.font = fontOf(700, titleSize, SANS)
  let titleLines = wrapText(ctx, data.title || ' ', LW)
  if (titleLines.length > 2) {
    titleSize = 48
    ctx.font = fontOf(700, titleSize, SANS)
    titleLines = wrapText(ctx, data.title || ' ', LW)
  }
  titleLines = clampLines(ctx, titleLines, 2, LW)
  ctx.fillStyle = INK
  for (const line of titleLines) {
    ctx.fillText(line, LX, y)
    y += titleSize * 1.16
  }

  y += 4
  ctx.fillStyle = '#5c6672'
  ctx.font = fontOf(400, 25, SANS)
  const subtitleLines = clampLines(ctx, wrapText(ctx, data.subtitle, LW), 2, LW)
  for (const line of subtitleLines) {
    ctx.fillText(line, LX, y)
    y += 36
  }

  y += 16
  ctx.setLineDash([6, 8])
  ctx.strokeStyle = '#ddd8ca'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(LX, y)
  ctx.lineTo(tearX - 40, y)
  ctx.stroke()
  ctx.setLineDash([])

  const shownStats = data.stats.slice(0, 4)
  const statTop = y + 86
  const statColWidth = LW / 2
  shownStats.forEach((stat, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = LX + statColWidth * column
    const lineY = statTop + row * 118
    ctx.textAlign = 'left'
    ctx.fillStyle = MUTED
    ctx.font = fontOf(500, 19, MONO)
    ctx.fillText(ellipsize(ctx, stat.label, statColWidth - 20), x, lineY)
    const size = fitSize(ctx, stat.value || '—', statColWidth - 24, 52, 700, MONO)
    ctx.fillStyle = INK
    ctx.font = fontOf(700, size, MONO)
    ctx.fillText(ellipsize(ctx, stat.value || '—', statColWidth - 24), x, lineY + 54)
  })
  let contentY = statTop + Math.ceil(shownStats.length / 2) * 118 + 14
  const contentBottom = CARD_Y + CARD_H - 120

  if (data.categories && data.categories.length > 0) {
    for (const item of data.categories.slice(0, 4)) {
      if (contentY + 46 > contentBottom) break
      ctx.textAlign = 'left'
      ctx.fillStyle = INK
      ctx.font = fontOf(500, 26, SANS)
      ctx.fillText(ellipsize(ctx, item.label, 140), LX, contentY)
      const barX = LX + 150
      const barW = Math.max(LW - 340, 120)
      ctx.fillStyle = '#e6e1d4'
      ctx.fillRect(barX, contentY - 18, barW, 12)
      ctx.fillStyle = item.color
      ctx.fillRect(barX, contentY - 18, Math.max(barW * item.ratio, 6), 12)
      ctx.textAlign = 'right'
      ctx.fillStyle = MUTED
      ctx.font = fontOf(500, 21, MONO)
      ctx.fillText(item.value, LX + LW, contentY)
      ctx.textAlign = 'left'
      contentY += 66
    }
  } else if (data.stamps && data.stamps.length > 0) {
    for (const stamp of data.stamps.slice(0, 6)) {
      if (contentY + 46 > contentBottom) break
      ctx.textAlign = 'left'
      ctx.fillStyle = INK
      ctx.font = fontOf(500, 28, SANS)
      ctx.fillText(ellipsize(ctx, stamp.city, LW - 170), LX, contentY)
      ctx.textAlign = 'right'
      ctx.fillStyle = MUTED
      ctx.font = fontOf(500, 22, MONO)
      ctx.fillText(
        stamp.visits > 0 ? tr('{n} 次', { n: stamp.visits }) : tr('到访'),
        LX + LW,
        contentY,
      )
      ctx.textAlign = 'left'
      ctx.fillStyle = '#e6e1d4'
      ctx.fillRect(LX, contentY + 12, LW, 1)
      contentY += 54
    }
  } else if (data.cities && data.cities.length > 0) {
    ctx.fillStyle = INK
    ctx.font = fontOf(400, 26, SANS)
    const lines = clampLines(
      ctx,
      wrapText(ctx, data.cities.join(' · '), LW),
      Math.max(1, Math.floor((contentBottom - contentY) / 40)),
      LW,
    )
    for (const line of lines) {
      ctx.fillText(line, LX, contentY)
      contentY += 40
    }
  }

  if (data.footnote) {
    ctx.fillStyle = MUTED
    ctx.font = fontOf(400, 22, SANS)
    ctx.fillText(ellipsize(ctx, data.footnote, LW), LX, CARD_Y + CARD_H - 92)
  }
  ctx.fillStyle = MUTED
  ctx.font = fontOf(500, 22, SANS)
  ctx.fillText(ellipsize(ctx, data.footer, LW), LX, CARD_Y + CARD_H - 52)

  /* 右栏：票根存根 */
  const SX = tearX + 42
  const SW = CARD_X + CARD_W - 48 - SX
  ctx.textAlign = 'left'
  ctx.fillStyle = MUTED
  ctx.font = fontOf(500, 19, MONO)
  ctx.fillText('STUB', SX, CARD_Y + 96)
  ctx.fillStyle = INK
  ctx.font = fontOf(700, 30, MONO)
  ctx.fillText(`No.${serialOf(data)}`, SX, CARD_Y + 138)

  const stubRows: PosterStat[] = data.money
    ? [data.money, ...data.stats.slice(0, 2)]
    : data.stats.slice(0, 3)
  let stubY = CARD_Y + 226
  for (const row of stubRows) {
    ctx.fillStyle = MUTED
    ctx.font = fontOf(500, 17, MONO)
    ctx.fillText(ellipsize(ctx, row.label, SW), SX, stubY)
    const size = fitSize(ctx, row.value || '—', SW, 32, 700, MONO)
    ctx.fillStyle = INK
    ctx.font = fontOf(700, size, MONO)
    ctx.fillText(ellipsize(ctx, row.value || '—', SW), SX, stubY + 34)
    stubY += 98
  }

  drawBarcode(
    ctx,
    SX,
    CARD_Y + CARD_H - 210,
    SW,
    72,
    hashString(`${data.title}${serialOf(data)}`),
    INK,
  )
  ctx.fillStyle = MUTED
  ctx.font = fontOf(400, 18, MONO)
  ctx.fillText(`${serialOf(data)} · TRV`, SX, CARD_Y + CARD_H - 118)

  ctx.save()
  ctx.translate(CARD_X + CARD_W - 26, CARD_Y + CARD_H / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#b9b2a1'
  ctx.font = fontOf(600, 20, MONO)
  ctx.fillText('TRAVELOG · 旅记', 0, 0)
  ctx.restore()
  ctx.textAlign = 'left'
}

/* ------------------------------------------------------------------ */
/* 护照印章                                                            */
/* ------------------------------------------------------------------ */

function renderPassport(ctx: CanvasRenderingContext2D, data: PosterData): void {
  const INK = '#3b3327'
  const MUTED = '#7c6a4c'
  const AGE = '#a08a5e'
  const contentWidth = W - 192
  const stampColors = ['#9a3412', '#1e40af', '#3f6212', '#6b21a8', '#0f766e', '#7c2d12']

  ctx.fillStyle = '#efe5cf'
  ctx.fillRect(0, 0, W, H)

  const rand = seeded(hashString(data.title) || 20241128)
  for (let i = 0; i < 2400; i++) {
    const x = rand() * W
    const y = rand() * H
    const radius = 0.3 + rand() * 1.7
    ctx.fillStyle = `rgba(90,70,40,${0.02 + rand() * 0.05})`
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  const vignette = ctx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.75)
  vignette.addColorStop(0, 'rgba(120,90,50,0)')
  vignette.addColorStop(1, 'rgba(90,65,30,0.18)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, W, H)

  ctx.strokeStyle = AGE
  ctx.lineWidth = 4
  roundRect(ctx, 40, 40, W - 80, H - 80, 10)
  ctx.stroke()
  ctx.lineWidth = 1.5
  roundRect(ctx, 56, 56, W - 112, H - 112, 6)
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.fillStyle = MUTED
  ctx.font = fontOf(600, 24, SANS)
  ctx.fillText(ellipsize(ctx, data.eyebrow, contentWidth), M, 158)

  let y = 292
  let titleSize = 96
  ctx.font = fontOf(700, titleSize, HAND)
  let titleLines = wrapText(ctx, data.title || ' ', contentWidth)
  if (titleLines.length > 2) {
    titleSize = 78
    ctx.font = fontOf(700, titleSize, HAND)
    titleLines = wrapText(ctx, data.title || ' ', contentWidth)
  }
  titleLines = clampLines(ctx, titleLines, 2, contentWidth)
  ctx.fillStyle = INK
  for (const line of titleLines) {
    ctx.fillText(line, M, y)
    y += titleSize * 1.12
  }

  y += 2
  ctx.fillStyle = MUTED
  ctx.font = fontOf(400, 34, HAND)
  const subtitleLines = clampLines(ctx, wrapText(ctx, data.subtitle, contentWidth), 2, contentWidth)
  for (const line of subtitleLines) {
    ctx.fillText(line, M, y)
    y += 44
  }

  ctx.strokeStyle = AGE
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(M, y + 14)
  ctx.lineTo(W - M, y + 14)
  ctx.stroke()

  const sourceStamps: PosterStamp[] =
    data.stamps && data.stamps.length > 0
      ? data.stamps
      : (data.cities ?? []).map((city) => ({ city, visits: 0, first: '' }))

  const columns = 4
  const gridTop = Math.min(Math.max(y + 96, 548), 636)
  const available = 1078 - gridTop
  let rows = 3
  let radius = 73
  if (3 * (radius * 2 + 18) - 18 > available) {
    radius = Math.max(54, Math.floor((available - 36) / 6))
    if (3 * (radius * 2 + 18) - 18 > available) {
      rows = 2
      radius = 73
    }
  }
  if (available < radius * 2 + 40) rows = 1
  const maxStamps = columns * rows
  const cellWidth = (W - 2 * M) / columns
  const centerY0 = gridTop + radius + 8
  const rowGap = rows > 1 ? (1078 - radius - centerY0) / (rows - 1) : 0
  const shown = sourceStamps.slice(0, maxStamps)

  if (shown.length === 0) {
    ctx.fillStyle = MUTED
    ctx.font = fontOf(400, 40, HAND)
    ctx.textAlign = 'center'
    ctx.fillText(tr('还没有印章'), W / 2, gridTop + 120)
    ctx.textAlign = 'left'
  }

  shown.forEach((stamp, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const cx = M + cellWidth * column + cellWidth / 2
    const cy = centerY0 + rowGap * row
    const color = stampColors[index % stampColors.length]

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(((index % 5) - 2) * 0.045)

    ctx.globalAlpha = 0.85
    ctx.strokeStyle = color
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.stroke()

    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(0, 0, radius - 10, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1

    ctx.textAlign = 'center'
    ctx.fillStyle = color
    const nameSize = stamp.city.length > 4 ? 24 : 30
    ctx.font = fontOf(700, nameSize, HAND)
    ctx.fillText(ellipsize(ctx, stamp.city, radius * 2 - 30), 0, -2)

    if (stamp.first) {
      ctx.fillStyle = MUTED
      ctx.font = fontOf(500, 17, SANS)
      ctx.fillText(ellipsize(ctx, stamp.first, radius * 2 - 24), 0, 28)
    }
    ctx.fillStyle = color
    ctx.font = fontOf(600, 20, MONO)
    ctx.fillText(
      stamp.visits > 0 ? tr('{n} 次', { n: stamp.visits }) : tr('到访'),
      0,
      stamp.first ? 52 : 32,
    )
    ctx.restore()
  })

  let infoY = 1102
  if (sourceStamps.length > shown.length) {
    ctx.textAlign = 'left'
    ctx.fillStyle = MUTED
    ctx.font = fontOf(400, 26, HAND)
    ctx.fillText(tr('另有 {n} 座城市', { n: sourceStamps.length - shown.length }), M, infoY)
    infoY += 44
  }

  if (data.money) {
    ctx.textAlign = 'left'
    ctx.fillStyle = INK
    ctx.font = fontOf(600, 40, HAND)
    ctx.fillText(
      ellipsize(ctx, `${data.money.label}  ${data.money.value}`, contentWidth),
      M,
      infoY,
    )
    infoY += 50
  }

  if (data.categories && data.categories.length > 0) {
    const line = data.categories
      .slice(0, 4)
      .map((item) => `${item.label} ${item.value}`)
      .join('  ·  ')
    ctx.textAlign = 'left'
    ctx.fillStyle = MUTED
    ctx.font = fontOf(400, 28, HAND)
    const lines = clampLines(
      ctx,
      wrapText(ctx, line, contentWidth),
      infoY > 1180 ? 1 : 2,
      contentWidth,
    )
    for (const text of lines) {
      ctx.fillText(text, M, infoY)
      infoY += 40
    }
  } else if (data.stats.length > 0) {
    const line = data.stats.map((stat) => `${stat.label} ${stat.value}`).join('  ·  ')
    ctx.fillStyle = MUTED
    ctx.font = fontOf(400, 30, HAND)
    ctx.fillText(ellipsize(ctx, line, contentWidth), M, infoY)
    infoY += 42
  }

  ctx.fillStyle = MUTED
  ctx.font = fontOf(400, 26, HAND)
  ctx.fillText(ellipsize(ctx, data.footer, contentWidth - 160), M, H - 96)
  ctx.textAlign = 'right'
  ctx.fillStyle = AGE
  ctx.font = fontOf(600, 22, SANS)
  ctx.fillText(`TRAVELOG · ${serialOf(data)}`, W - M, H - 96)
  ctx.textAlign = 'left'
}

/* ------------------------------------------------------------------ */

/** 按模板把海报数据画到 1080×1440 画布并导出 PNG。 */
export async function renderPoster(data: PosterData, template: PosterTemplate): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.textBaseline = 'alphabetic'

  if (template === 'boarding') renderBoarding(ctx, data)
  else if (template === 'passport') renderPassport(ctx, data)
  else renderMagazine(ctx, data)

  return canvasToPng(canvas)
}
