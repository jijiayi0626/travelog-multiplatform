import { useCallback, useMemo, useState } from 'react'
import { useLoader } from '../lib/hooks'
import {
  ArrowLeft,
  CalendarBlank,
  DownloadSimple,
  MapPin,
  NavigationArrow,
  Plus,
  Trophy,
} from '@phosphor-icons/react'
import type { Footprint, Moment, TripView } from '../lib/types'
import { listAllMoments, listFootprints, listTrips } from '../lib/repo'
import { useI18n, useNav, useToast } from '../lib/app-context'
import { provinceOfFootprint } from '../lib/province'
import { openAmapNav } from '../lib/amap'
import { canvasToPng, sharePngBlob } from '../lib/share-image'
import { formatDate, formatDateCn, monthKey } from '../lib/utils'
import { cn } from '../lib/cn'
import { EmptyState, IconButton, StatTile } from '../components/ui'
import { EmptyArt } from '../components/EmptyArt'

interface CityStamp {
  city: string
  first: number
  last: number
  visits: number
  trips: number
  photos: number
  items: Footprint[]
}

const FONT =
  "'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', system-ui, -apple-system, 'Segoe UI', sans-serif"

function bareName(value: string): string {
  return value.trim().replace(/[市省区县]$/u, '')
}

function stampRotation(index: number): number {
  return ((index % 5) - 2) * 2.2
}

export function PassportPage() {
  const nav = useNav()
  const toast = useToast()
  const { tr } = useI18n()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [thisYear] = useState(() => new Date().getFullYear())

  const loader = useCallback(async () => {
    const [footprints, trips, moments] = await Promise.all([
      listFootprints(),
      listTrips(),
      listAllMoments(),
    ])
    return { footprints, trips, moments }
  }, [])
  const { data, loading } = useLoader(
    loader,
    {
      footprints: [] as Footprint[],
      trips: [] as TripView[],
      moments: [] as Moment[],
    },
    'passport',
  )

  const stamps = useMemo(() => {
    const map = new Map<string, CityStamp>()
    const tripIdsByCity = new Map<string, Set<string>>()
    for (const footprint of data.footprints) {
      const city = (footprint.city || footprint.placeName || '').trim() || tr('未标注城市')
      let stamp = map.get(city)
      if (!stamp) {
        stamp = { city, first: footprint.visitedAt, last: footprint.visitedAt, visits: 0, trips: 0, photos: 0, items: [] }
        map.set(city, stamp)
      }
      stamp.visits += 1
      stamp.first = Math.min(stamp.first || footprint.visitedAt, footprint.visitedAt)
      stamp.last = Math.max(stamp.last, footprint.visitedAt)
      stamp.items.push(footprint)
      if (footprint.tripId) {
        const ids = tripIdsByCity.get(city) ?? new Set<string>()
        ids.add(footprint.tripId)
        tripIdsByCity.set(city, ids)
      }
    }

    for (const [city, stamp] of map) {
      const bare = bareName(city)
      const ids = tripIdsByCity.get(city) ?? new Set<string>()
      const relatedTrips = data.trips.filter(
        (trip) =>
          ids.has(trip.id) ||
          (bare.length > 0 &&
            (bareName(trip.destination).includes(bare) || bare.includes(bareName(trip.destination)))),
      )
      stamp.trips = relatedTrips.length
      const relatedTripIds = new Set(relatedTrips.map((trip) => trip.id))
      stamp.photos = data.moments
        .filter((moment) => {
          const place = bareName(moment.locationName)
          const byName = place.length > 0 && (place.includes(bare) || bare.includes(place))
          return byName || relatedTripIds.has(moment.tripId)
        })
        .reduce((sum, moment) => sum + (moment.photos?.length ?? 0), 0)
    }

    return [...map.values()].sort((a, b) => b.visits - a.visits || b.last - a.last)
  }, [data, tr])

  const provinceCount = useMemo(() => {
    const set = new Set<string>()
    for (const footprint of data.footprints) {
      const province = provinceOfFootprint(footprint)
      if (province) set.add(province.short)
    }
    return set.size || stamps.length
  }, [data.footprints, stamps.length])

  const streakMonths = useMemo(() => {
    const keys = [...new Set(data.footprints.map((item) => monthKey(item.visitedAt)))].sort()
    let best = 0
    let run = 0
    let previous = -1
    for (const key of keys) {
      const [year, month] = key.split('-').map(Number)
      const index = year * 12 + (month - 1)
      run = previous >= 0 && index === previous + 1 ? run + 1 : 1
      best = Math.max(best, run)
      previous = index
    }
    return best
  }, [data.footprints])

  const newCitiesThisYear = stamps.filter(
    (stamp) => stamp.first > 0 && new Date(stamp.first).getFullYear() === thisYear,
  ).length

  const badges = useMemo(
    () => [
      { key: 'first', label: tr('首次出行'), achieved: data.footprints.length > 0 || data.trips.length > 0 },
      { key: '3city', label: tr('3 座城市'), achieved: stamps.length >= 3 },
      { key: '5city', label: tr('5 座城市'), achieved: stamps.length >= 5 },
      { key: '10city', label: tr('10 座城市'), achieved: stamps.length >= 10 },
      { key: 'streak', label: tr('连续 3 个月'), achieved: streakMonths >= 3 },
      { key: 'repeat', label: tr('单城 3 次'), achieved: stamps.some((stamp) => stamp.visits >= 3) },
    ],
    [tr, data.footprints.length, data.trips.length, stamps, streakMonths],
  )

  const exportPoster = async () => {
    if (stamps.length === 0 || exporting) return
    setExporting(true)
    try {
      const width = 1080
      const height = 1440
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas unavailable')

      ctx.fillStyle = '#f7f3e8'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#0f766e'
      ctx.fillRect(0, 0, width, 16)

      ctx.fillStyle = '#8a8272'
      ctx.font = `600 28px ${FONT}`
      ctx.fillText('TRAVELOG · CITY PASSPORT', 88, 136)

      ctx.fillStyle = '#1b1a16'
      ctx.font = `700 84px ${FONT}`
      ctx.fillText(tr('城市护照'), 88, 246)

      ctx.fillStyle = '#5f594c'
      ctx.font = `400 32px ${FONT}`
      ctx.fillText(
        tr('{cities} 座城市 · {provinces} 个省份 · 连续 {months} 个月', {
          cities: stamps.length,
          provinces: provinceCount,
          months: streakMonths,
        }),
        88,
        312,
      )

      ctx.strokeStyle = '#d8cfb9'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(88, 356)
      ctx.lineTo(width - 88, 356)
      ctx.stroke()

      const columns = 4
      const cellWidth = (width - 176) / columns
      const cellHeight = 214
      const radius = 82
      const shown = stamps.slice(0, 20)
      const colors = ['#0f766e', '#9a3412', '#1e40af', '#7c2d12', '#3f6212', '#6b21a8']
      shown.forEach((stamp, index) => {
        const column = index % columns
        const row = Math.floor(index / columns)
        const cx = 88 + cellWidth * column + cellWidth / 2
        const cy = 356 + 60 + cellHeight * row + radius
        const color = colors[index % colors.length]

        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(((index % 5) - 2) * 0.025)
        ctx.strokeStyle = color
        ctx.globalAlpha = 0.85
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.arc(0, 0, radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 0.16
        ctx.fillStyle = color
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = color
        ctx.textAlign = 'center'
        const name = stamp.city.length > 6 ? `${stamp.city.slice(0, 6)}…` : stamp.city
        ctx.font = `700 ${name.length > 4 ? 26 : 32}px ${FONT}`
        ctx.fillText(name, 0, 4)
        ctx.font = `400 18px ${FONT}`
        ctx.fillStyle = '#6b6456'
        ctx.fillText(tr('首访 {month}', { month: formatDate(stamp.first).slice(0, 7) }), 0, 38)
        ctx.fillText(tr('{n} 次', { n: stamp.visits }), 0, 64)
        ctx.restore()
      })

      if (stamps.length > shown.length) {
        ctx.fillStyle = '#8a8272'
        ctx.font = `400 26px ${FONT}`
        ctx.fillText(tr('另有 {n} 座城市', { n: stamps.length - shown.length }), 88, height - 150)
      }

      ctx.textAlign = 'left'
      ctx.fillStyle = '#8a8272'
      ctx.font = `400 28px ${FONT}`
      ctx.fillText(tr('旅记 Travelog · 记录每一座到过的城市'), 88, height - 74)

      const blob = await canvasToPng(canvas)
      await sharePngBlob(blob, 'travelog-passport.png')
      toast(tr('护照长图已生成，可分享或保存'))
    } catch {
      toast(tr('生成失败，请重试'))
    } finally {
      setExporting(false)
    }
  }

  const expandedStamp = stamps.find((stamp) => stamp.city === expanded) ?? null

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-5 pb-6">
      <div className="flex items-center gap-2.5 pt-3">
        <IconButton label={tr('返回')} onClick={() => nav.back()}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="text-note text-ink-3">
          {tr('我的')} / <span className="text-ink-2">{tr('城市护照')}</span>
        </span>
      </div>

      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">City passport</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink">
            {tr('城市护照')}
          </h1>
        </div>
        <button
          type="button"
          className="btn-ghost h-9 shrink-0 px-3 text-note"
          onClick={() => nav.navigate({ name: 'monthly' })}
        >
          <CalendarBlank size={15} />
          {tr('本月月报')}
        </button>
      </header>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-24 rounded-2xl" />
          <div className="skeleton h-64 rounded-2xl" />
        </div>
      ) : stamps.length === 0 ? (
        <EmptyState
          icon={<EmptyArt variant="pin" />}
          title={tr('护照上还没有印章')}
          hint={tr('打卡第一个地点后，城市会变成护照印章，记录你的到访次数与时间。')}
          action={
            <button
              type="button"
              className="btn-primary mt-1"
              onClick={() => {
                nav.navigate({ name: 'footprintEditor' })
              }}
            >
              <Plus size={15} weight="bold" />
              {tr('去记录足迹')}
            </button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-4 divide-x divide-line border-y border-line py-3.5">
            <div className="min-w-0 pr-3">
              <StatTile label={tr('城市')} value={String(stamps.length)} />
            </div>
            <div className="min-w-0 px-3">
              <StatTile label={tr('省份')} value={String(provinceCount)} />
            </div>
            <div className="min-w-0 px-3">
              <StatTile label={tr('连续打卡')} value={tr('{n} 月', { n: streakMonths })} />
            </div>
            <div className="min-w-0 pl-3">
              <StatTile label={tr('今年新增')} value={String(newCitiesThisYear)} />
            </div>
          </div>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center gap-1.5">
              <Trophy size={15} className="text-accent" />
              <p className="text-body font-medium text-ink">{tr('旅行徽章')}</p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {badges.map((badge) => (
                <div
                  key={badge.key}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center',
                    badge.achieved
                      ? 'border-accent/35 bg-accent-soft text-accent'
                      : 'border-line bg-paper-2/40 text-ink-3',
                  )}
                >
                  <Trophy size={16} weight={badge.achieved ? 'fill' : 'regular'} />
                  <span className="text-caption leading-4">{badge.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-body font-medium text-ink">{tr('护照印章')}</p>
              <span className="text-caption text-ink-3">
                {tr('点击印章查看足迹')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {stamps.map((stamp, index) => (
                <button
                  key={stamp.city}
                  type="button"
                  onClick={() =>
                    setExpanded((current) => (current === stamp.city ? null : stamp.city))
                  }
                  className={cn(
                    'press relative flex aspect-square flex-col items-center justify-center rounded-full border-2 px-3 text-center transition-colors',
                    expanded === stamp.city
                      ? 'border-accent bg-accent-soft'
                      : 'border-accent/30 bg-surface hover:border-accent/60',
                  )}
                  style={{ transform: `rotate(${stampRotation(index)}deg)` }}
                >
                  <span className="line-clamp-1 text-body-sm font-semibold text-accent">
                    {stamp.city.length > 6 ? `${stamp.city.slice(0, 6)}…` : stamp.city}
                  </span>
                  <span className="mt-0.5 text-[10px] tabular-nums text-ink-3">
                    {tr('首访 {month}', { month: formatDate(stamp.first).slice(0, 7) })}
                  </span>
                  <span className="mt-0.5 text-[10px] tabular-nums text-ink-3">
                    {tr('{n} 次 · {p} 照', { n: stamp.visits, p: stamp.photos })}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {expandedStamp ? (
            <section className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-body font-medium text-ink">
                  {expandedStamp.city}
                </p>
                <span className="shrink-0 text-caption text-ink-3">
                  {tr('{v} 次到访 · {t} 段行程 · {p} 张照片', {
                    v: expandedStamp.visits,
                    t: expandedStamp.trips,
                    p: expandedStamp.photos,
                  })}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {expandedStamp.items.map((footprint) => (
                  <div
                    key={footprint.id}
                    className="flex items-center gap-2 rounded-xl bg-paper-2/50 px-3 py-2"
                  >
                    <MapPin size={14} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate text-body-sm text-ink">
                      {footprint.placeName}
                    </span>
                    <span className="shrink-0 text-caption tabular-nums text-ink-3">
                      {formatDateCn(footprint.visitedAt)}
                    </span>
                    {footprint.latitude !== 0 || footprint.longitude !== 0 ? (
                      <button
                        type="button"
                        aria-label={tr('导航')}
                        onClick={() =>
                          openAmapNav(
                            footprint.latitude,
                            footprint.longitude,
                            footprint.placeName,
                          )
                        }
                        className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-accent hover:bg-accent-soft"
                      >
                        <NavigationArrow size={13} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <button
            type="button"
            className="btn-primary h-11 w-full"
            disabled={exporting}
            onClick={() => void exportPoster()}
          >
            <DownloadSimple size={16} />
            {exporting ? tr('正在生成…') : tr('生成护照长图')}
          </button>
        </>
      )}
    </div>
  )
}
