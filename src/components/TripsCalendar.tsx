import { useMemo, useState } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import type { Moment, Plan, TripView } from '../lib/types'
import { cn } from '../lib/cn'
import { PLAN_KIND_COLOR, formatDateCn, startOfDay, todayStart } from '../lib/utils'
import { useI18n } from '../lib/app-context'

const WEEKDAYS_ZH = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface DayBucket {
  key: number
  trips: TripView[]
  plans: Array<Plan & { tripTitle: string }>
  moments: Moment[]
}

function dayKey(timestamp: number): number {
  return startOfDay(timestamp)
}

export function TripsCalendar({
  trips,
  moments,
  plans,
  onSelectDay,
}: {
  trips: TripView[]
  moments: Moment[]
  plans: Plan[]
  onSelectDay: (bucket: DayBucket) => void
}) {
  const { tr, lang } = useI18n()
  const weekdays = lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_ZH
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })

  const buckets = useMemo(() => {
    const map = new Map<number, DayBucket>()
    const ensure = (key: number): DayBucket => {
      let bucket = map.get(key)
      if (!bucket) {
        bucket = { key, trips: [], plans: [], moments: [] }
        map.set(key, bucket)
      }
      return bucket
    }

    for (const trip of trips) {
      if (trip.startDate <= 0 || trip.endDate <= 0) continue
      const start = dayKey(trip.startDate)
      const end = dayKey(trip.endDate)
      for (let time = start; time <= end; time += 864e5) {
        const bucket = ensure(time)
        if (!bucket.trips.some((item) => item.id === trip.id)) bucket.trips.push(trip)
      }
    }

    for (const plan of plans) {
      const trip = trips.find((item) => item.id === plan.tripId)
      if (!trip || trip.startDate <= 0) continue
      const key = dayKey(trip.startDate + (plan.dayIndex - 1) * 864e5)
      ensure(key).plans.push({ ...plan, tripTitle: trip.title })
    }

    for (const moment of moments) {
      ensure(dayKey(moment.createdAt)).moments.push(moment)
    }

    return map
  }, [trips, moments, plans])

  const { year, month } = cursor
  const firstDay = new Date(year, month, 1)
  // 周一为一周起点
  const offset = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = todayStart()

  const cells = useMemo(() => {
    const list: Array<{ date: number; inMonth: boolean }> = []
    for (let i = 0; i < offset; i++) {
      list.push({ date: new Date(year, month, i - offset + 1).getTime(), inMonth: false })
    }
    for (let day = 1; day <= daysInMonth; day++) {
      list.push({ date: new Date(year, month, day).getTime(), inMonth: true })
    }
    while (list.length % 7 !== 0) {
      const last = list[list.length - 1].date
      list.push({ date: last + 864e5, inMonth: false })
    }
    return list
  }, [year, month, offset, daysInMonth])

  const monthTrips = useMemo(
    () =>
      trips.filter((trip) => {
        if (trip.startDate <= 0) return false
        const start = new Date(trip.startDate)
        const end = new Date(trip.endDate || trip.startDate)
        return (
          (start.getFullYear() === year && start.getMonth() === month) ||
          (end.getFullYear() === year && end.getMonth() === month) ||
          (start < new Date(year, month, 1) && end > new Date(year, month + 1, 0))
        )
      }),
    [trips, year, month],
  )

  const shift = (delta: number) => {
    setCursor((current) => {
      const date = new Date(current.year, current.month + delta, 1)
      return { year: date.getFullYear(), month: date.getMonth() }
    })
  }

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={tr('上个月')}
            onClick={() => shift(-1)}
            className="press flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink-2"
          >
            <CaretLeft size={14} />
          </button>
          <span className="min-w-[96px] text-center text-body-lg font-semibold tabular-nums tracking-tight text-ink">
            {tr('{year} 年 {month} 月', { year, month: month + 1 })}
          </span>
          <button
            type="button"
            aria-label={tr('下个月')}
            onClick={() => shift(1)}
            className="press flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink-2"
          >
            <CaretRight size={14} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            const now = new Date()
            setCursor({ year: now.getFullYear(), month: now.getMonth() })
          }}
          className="press rounded-full border border-line px-2.5 py-1 text-caption text-ink-2"
        >
          {tr('回到本月')}
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {weekdays.map((day) => (
          <span key={day} className="text-center text-caption text-ink-3">
            {day}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell) => {
          const bucket = buckets.get(dayKey(cell.date))
          const isToday = dayKey(cell.date) === today
          const date = new Date(cell.date)
          const trip = bucket?.trips[0]
          const planCount = bucket?.plans.length ?? 0
          const hasContent = Boolean(bucket && (bucket.trips.length || planCount || bucket.moments.length))

          return (
            <button
              key={cell.date}
              type="button"
              onClick={() => bucket && onSelectDay(bucket)}
              className={cn(
                'relative flex h-[52px] flex-col items-center justify-start rounded-lg pt-1 transition-colors',
                !cell.inMonth && 'opacity-35',
                hasContent ? 'bg-accent-soft/60 hover:bg-accent-soft' : 'hover:bg-paper-2',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-note tabular-nums',
                  isToday ? 'bg-accent font-medium text-white' : 'text-ink',
                )}
              >
                {date.getDate()}
              </span>
              {cell.inMonth && trip ? (
                <span
                  className={cn('mt-0.5 h-[3px] w-5 rounded-full', `cover-${trip.cover}`)}
                  aria-hidden="true"
                />
              ) : (
                <span className="mt-0.5 h-[3px] w-5" aria-hidden="true" />
              )}
              {cell.inMonth && planCount > 0 ? (
                <span className="mt-0.5 flex gap-0.5" aria-label={tr('{n} 条日程', { n: planCount })}>
                  {bucket?.plans.slice(0, 3).map((plan) => (
                    <span
                      key={plan.id}
                      className="h-1 w-1 rounded-full"
                      style={{ backgroundColor: PLAN_KIND_COLOR[plan.kind] }}
                    />
                  ))}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {monthTrips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {monthTrips.map((trip) => (
            <span
              key={trip.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-caption text-ink-2"
            >
              <span className={cn('h-2 w-2 rounded-full', `cover-${trip.cover}`)} />
              {trip.title}
              <span className="text-ink-3">{tr('{date} 起', { date: formatDateCn(trip.startDate) })}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="pt-1 text-center text-caption text-ink-3">{tr('这个月还没有安排')}</p>
      )}
    </div>
  )
}

export type { DayBucket }