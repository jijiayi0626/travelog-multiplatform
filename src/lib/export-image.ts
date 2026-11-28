import type { Trip } from './types'
import { getLang, translateText } from './i18n'
import { formatDate, formatMoney } from './utils'
import {
  getPosterTemplate,
  renderPoster,
  type PosterData,
  type PosterTemplate,
} from './poster'

/** 首图统计：天数、日程数、记录数、总花费（人民币） */
export interface TripPosterStats {
  days: number
  plans: number
  moments: number
  total: number
}

function tr(zh: string, vars?: Record<string, string | number>): string {
  return translateText(getLang(), zh, vars)
}

/**
 * 生成 1080×1440 的行程分享长图，共用 poster 渲染层的三套模板。
 * template 缺省读取 localStorage 里用户上次选中的模板。
 * 调用方负责把 Blob 分享或下载。
 */
export async function renderTripPoster(
  trip: Trip,
  stats: TripPosterStats,
  template: PosterTemplate = getPosterTemplate(),
): Promise<Blob> {
  const title = trip.title.trim() || tr('未命名旅程')
  const destination = trip.destination.trim() || tr('目的地待定')
  const range =
    trip.startDate > 0 ? `${formatDate(trip.startDate)} — ${formatDate(trip.endDate)}` : ''

  const data: PosterData = {
    kind: 'trip',
    eyebrow: 'TRAVELOG · TRIP POSTER',
    title,
    subtitle: range ? `${destination} · ${range}` : destination,
    stats: [
      { label: tr('天数'), value: stats.days > 0 ? tr('{n} 天', { n: stats.days }) : '—' },
      { label: tr('日程'), value: stats.plans > 0 ? tr('{n} 条', { n: stats.plans }) : '—' },
      { label: tr('记录'), value: stats.moments > 0 ? tr('{n} 条', { n: stats.moments }) : '—' },
    ],
    money: { label: tr('总花费'), value: `¥${formatMoney(stats.total)}` },
    cities: [destination],
    footer: tr('旅记 Travelog · 记录每一段旅程'),
  }

  return renderPoster(data, template)
}
