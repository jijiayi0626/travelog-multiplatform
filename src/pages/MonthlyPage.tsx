import { useCallback, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  DownloadSimple,
  Images,
  MapPin,
  Plus,
  Wallet,
} from '@phosphor-icons/react'
import type { Expense, Footprint, Moment, TripView } from '../lib/types'
import {
  categoryStats,
  listAllMoments,
  listExpenses,
  listFootprints,
  listTrips,
} from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useI18n, useNav, useToast } from '../lib/app-context'
import { canvasToPng, sharePngBlob } from '../lib/share-image'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  formatCny,
  formatDate,
  monthKey,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { EmptyState, IconButton, StatTile } from '../components/ui'
import { EmptyArt } from '../components/EmptyArt'

const FONT =
  "'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif"

function formatMonthCursor(year: number, month: number): string {
  return `${year} 年 ${month + 1} 月`
}

export function MonthlyPage() {
  const nav = useNav()
  const toast = useToast()
  const { tr } = useI18n()
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [exporting, setExporting] = useState(false)
  const [now] = useState(() => new Date())

  const loader = useCallback(async () => {
    const [footprints, trips, moments, expenses] = await Promise.all([
      listFootprints(),
      listTrips(),
      listAllMoments(),
      listExpenses(),
    ])
    return { footprints, trips, moments, expenses }
  }, [])
  const { data, loading } = useLoader(
    loader,
    {
      footprints: [] as Footprint[],
      trips: [] as TripView[],
      moments: [] as Moment[],
      expenses: [] as Expense[],
    },
    'monthly',
  )

  const monthStart = new Date(cursor.year, cursor.month, 1).getTime()
  const monthEnd = new Date(cursor.year, cursor.month + 1, 1).getTime()
  const key = monthKey(monthStart)

  const monthFootprints = useMemo(
    () => data.footprints.filter((item) => item.visitedAt >= monthStart && item.visitedAt < monthEnd),
    [data.footprints, monthStart, monthEnd],
  )
  const monthMoments = useMemo(
    () => data.moments.filter((item) => item.createdAt >= monthStart && item.createdAt < monthEnd),
    [data.moments, monthStart, monthEnd],
  )
  const monthTrips = useMemo(
    () =>
      data.trips.filter(
        (trip) => trip.startDate > 0 && trip.startDate < monthEnd && trip.endDate >= monthStart,
      ),
    [data.trips, monthStart, monthEnd],
  )
  const monthExpenses = useMemo(
    () =>
      data.expenses.filter((expense) => {
        const timestamp = expense.spentAt || expense.createdAt
        return timestamp >= monthStart && timestamp < monthEnd
      }),
    [data.expenses, monthStart, monthEnd],
  )

  const cities = useMemo(() => {
    const set = new Set<string>()
    for (const footprint of monthFootprints) {
      const city = (footprint.city || '').trim()
      if (city) set.add(city)
    }
    for (const trip of monthTrips) {
      const destination = trip.destination.trim()
      if (destination) set.add(destination)
    }
    return [...set]
  }, [monthFootprints, monthTrips])

  const photos = monthMoments.reduce((sum, moment) => sum + (moment.photos?.length ?? 0), 0)
  const spend = monthExpenses.reduce((sum, expense) => sum + (expense.amountCny ?? 0), 0)
  const categories = useMemo(() => categoryStats(monthExpenses), [monthExpenses])
  const hasData =
    monthFootprints.length > 0 ||
    monthMoments.length > 0 ||
    monthTrips.length > 0 ||
    monthExpenses.length > 0

  const shiftMonth = (delta: number) => {
    setCursor((current) => {
      const date = new Date(current.year, current.month + delta, 1)
      return { year: date.getFullYear(), month: date.getMonth() }
    })
  }

  const exportPoster = async () => {
    if (!hasData || exporting) return
    setExporting(true)
    try {
      const width = 1080
      const height = 1440
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas unavailable')

      ctx.fillStyle = '#f6f5f1'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#0f766e'
      ctx.fillRect(0, 0, width, 14)

      ctx.fillStyle = '#6b6f78'
      ctx.font = `600 28px ${FONT}`
      ctx.fillText('TRAVELOG · MONTHLY REPORT', 88, 136)

      ctx.fillStyle = '#1a1d26'
      ctx.font = `700 92px ${FONT}`
      ctx.fillText(tr('{month} 旅行月报', { month: formatMonthCursor(cursor.year, cursor.month) }), 88, 252)

      ctx.fillStyle = '#5f6570'
      ctx.font = `400 30px ${FONT}`
      ctx.fillText(
        cities.length > 0
          ? tr('走过 {n} 座城市', { n: cities.length })
          : tr('这个月还没有出门'),
        88,
        310,
      )

      const tiles: Array<[string, string]> = [
        [tr('城市'), String(cities.length)],
        [tr('行程'), String(monthTrips.length)],
        [tr('记录'), String(monthMoments.length)],
        [tr('照片'), String(photos)],
      ]
      tiles.forEach(([label, value], index) => {
        const x = 88 + (index % 4) * 226
        ctx.fillStyle = '#8a8f99'
        ctx.font = `500 28px ${FONT}`
        ctx.fillText(label, x, 408)
        ctx.fillStyle = '#1a1d26'
        ctx.font = `700 64px ${FONT}`
        ctx.fillText(value, x, 482)
      })

      ctx.strokeStyle = '#dcd9d0'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(88, 528)
      ctx.lineTo(width - 88, 528)
      ctx.stroke()

      ctx.fillStyle = '#6b6f78'
      ctx.font = `500 30px ${FONT}`
      ctx.fillText(tr('本月花费'), 88, 596)
      ctx.fillStyle = '#1a1d26'
      ctx.font = `700 84px ${FONT}`
      ctx.fillText(formatCny(spend), 88, 690)

      const top = categories.slice(0, 5)
      if (top.length > 0) {
        ctx.fillStyle = '#6b6f78'
        ctx.font = `500 28px ${FONT}`
        ctx.fillText(tr('分类占比'), 88, 776)
        top.forEach((item, index) => {
          const y = 830 + index * 86
          const ratio = spend > 0 ? item.amount / spend : 0
          ctx.fillStyle = '#5f6570'
          ctx.font = `500 28px ${FONT}`
          ctx.fillText(CATEGORY_LABEL[item.category], 88, y)
          ctx.fillStyle = '#e2ded4'
          ctx.fillRect(260, y - 22, 560, 16)
          ctx.fillStyle = CATEGORY_COLOR[item.category]
          ctx.fillRect(260, y - 22, Math.max(560 * ratio, 6), 16)
          ctx.fillStyle = '#8a8f99'
          ctx.font = `400 26px ${FONT}`
          ctx.textAlign = 'right'
          ctx.fillText(
            `${formatCny(item.amount)} · ${Math.round(ratio * 100)}%`,
            width - 88,
            y,
          )
          ctx.textAlign = 'left'
        })
      }

      if (cities.length > 0) {
        ctx.fillStyle = '#6b6f78'
        ctx.font = `500 28px ${FONT}`
        ctx.fillText(cities.slice(0, 8).join(' · '), 88, height - 170)
      }

      ctx.fillStyle = '#9a9faa'
      ctx.font = `400 26px ${FONT}`
      ctx.fillText(tr('旅记 Travelog · 记录每一段旅程'), 88, height - 82)

      const blob = await canvasToPng(canvas)
      await sharePngBlob(blob, `travelog-monthly-${key}.png`)
      toast(tr('月报长图已生成，可分享或保存'))
    } catch {
      toast(tr('生成失败，请重试'))
    } finally {
      setExporting(false)
    }
  }

  const isCurrentMonth =
    now.getFullYear() === cursor.year && now.getMonth() === cursor.month

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-5 pb-6">
      <div className="flex items-center gap-2.5 pt-3">
        <IconButton label={tr('返回')} onClick={() => nav.back()}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="text-note text-ink-3">
          {tr('城市护照')} / <span className="text-ink-2">{tr('旅行月报')}</span>
        </span>
      </div>

      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Monthly report</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink">
            {tr('旅行月报')}
          </h1>
        </div>
        <button
          type="button"
          className="btn-ghost h-9 shrink-0 px-3 text-note"
          onClick={() => nav.navigate({ name: 'passport' })}
        >
          <CalendarBlank size={15} />
          {tr('城市护照')}
        </button>
      </header>

      <section className="flex items-center justify-between rounded-2xl border border-line bg-surface px-2 py-2.5">
        <button
          type="button"
          aria-label={tr('上个月')}
          onClick={() => shiftMonth(-1)}
          className="press flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2"
        >
          <CaretLeft size={16} />
        </button>
        <div className="text-center">
          <p className="text-title font-semibold tabular-nums tracking-tight text-ink">
            {formatMonthCursor(cursor.year, cursor.month)}
          </p>
          <p className="mt-0.5 text-caption text-ink-3">
            {isCurrentMonth ? tr('本月') : tr('历史月份')}
          </p>
        </div>
        <button
          type="button"
          aria-label={tr('下个月')}
          onClick={() => shiftMonth(1)}
          className="press flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2"
        >
          <CaretRight size={16} />
        </button>
      </section>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-24 rounded-2xl" />
          <div className="skeleton h-40 rounded-2xl" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="card p-3.5">
              <StatTile label={tr('城市')} value={String(cities.length)} />
            </div>
            <div className="card p-3.5">
              <StatTile label={tr('行程')} value={String(monthTrips.length)} />
            </div>
            <div className="card p-3.5">
              <StatTile label={tr('记录')} value={String(monthMoments.length)} />
            </div>
            <div className="card p-3.5">
              <StatTile label={tr('照片')} value={String(photos)} />
            </div>
          </div>

          {!hasData ? (
            <EmptyState
              icon={<EmptyArt variant="pin" />}
              title={tr('这个月还没有记录')}
              hint={tr('写下一条记录或打卡一个地点，月报就会自动汇总。')}
              action={
                <button
                  type="button"
                  className="btn-primary mt-1"
                  onClick={() => nav.navigate({ name: 'trips' })}
                >
                  <Plus size={15} weight="bold" />
                  {tr('去看看行程')}
                </button>
              }
            />
          ) : (
            <>
              <section className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-center gap-1.5">
                  <MapPin size={15} className="text-accent" />
                  <p className="text-body font-medium text-ink">{tr('到过的城市')}</p>
                </div>
                {cities.length > 0 ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {cities.map((city) => (
                      <span
                        key={city}
                        className="rounded-full border border-line bg-paper-2/50 px-2.5 py-1 text-note text-ink-2"
                      >
                        {city}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-note text-ink-3">{tr('这个月没有打卡地点')}</p>
                )}
              </section>

              <section className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <Wallet size={15} className="text-accent" />
                    <p className="text-body font-medium text-ink">{tr('本月花费')}</p>
                  </div>
                  <p className="text-title font-semibold tabular-nums tracking-tight text-ink">
                    {formatCny(spend)}
                  </p>
                </div>
                {categories.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {categories.map((item) => {
                      const ratio = spend > 0 ? item.amount / spend : 0
                      return (
                        <div key={item.category} className="flex items-center gap-2.5">
                          <span className="w-[52px] shrink-0 text-body-sm text-ink-2">
                            {CATEGORY_LABEL[item.category]}
                          </span>
                          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-2">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${Math.max(ratio * 100, 3)}%`,
                                backgroundColor: CATEGORY_COLOR[item.category],
                              }}
                            />
                          </span>
                          <span className="w-[110px] shrink-0 text-right text-caption tabular-nums text-ink-3">
                            {formatCny(item.amount)} · {Math.round(ratio * 100)}%
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-note text-ink-3">{tr('这个月还没有账目')}</p>
                )}
              </section>

              <section className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-center gap-1.5">
                  <Images size={15} className="text-accent" />
                  <p className="text-body font-medium text-ink">{tr('本月片段')}</p>
                </div>
                <div className="mt-2 space-y-1.5">
                  {monthMoments.slice(0, 5).map((moment) => (
                    <div
                      key={moment.id}
                      className={cn(
                        'flex items-center gap-2 rounded-xl bg-paper-2/50 px-3 py-2',
                        moment.content ? '' : 'opacity-70',
                      )}
                    >
                      <span className="shrink-0 text-caption tabular-nums text-ink-3">
                        {formatDate(moment.createdAt)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-body-sm text-ink">
                        {moment.content || moment.locationName || tr('照片')}
                      </span>
                      {moment.photos.length > 0 ? (
                        <span className="shrink-0 text-caption text-ink-3">
                          {tr('{n} 张', { n: moment.photos.length })}
                        </span>
                      ) : null}
                    </div>
                  ))}
                  {monthMoments.length === 0 ? (
                    <p className="text-note text-ink-3">{tr('这个月还没有记录')}</p>
                  ) : null}
                </div>
              </section>

              <button
                type="button"
                className="btn-primary h-11 w-full"
                disabled={exporting}
                onClick={() => void exportPoster()}
              >
                <DownloadSimple size={16} />
                {exporting ? tr('正在生成…') : tr('生成本月月报长图')}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
