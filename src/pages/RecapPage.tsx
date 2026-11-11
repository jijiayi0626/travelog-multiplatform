import { useCallback, useMemo, useState } from 'react'
import { ArrowLeft, CaretLeft, CaretRight, Sparkle } from '@phosphor-icons/react'
import type { Expense, Footprint, Moment, TripView } from '../lib/types'
import { listAllMoments, listExpenses, listFootprints, listTrips } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useI18n, useNav } from '../lib/app-context'
import { summarizeVisits } from '../lib/province'
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  formatCny,
  formatDate,
  monthKey,
  tripDayCount,
  tripStatusOf,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { CategoryLegend, DonutChart, MonthBars } from '../components/charts'
import { EmptyState, IconButton, StatTile } from '../components/ui'
import { EmptyArt } from '../components/EmptyArt'
import { categoryStats } from '../lib/repo'

const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

export function RecapPage() {
  const nav = useNav()
  const { t, tr } = useI18n()
  const loader = useCallback(async () => {
    const [trips, expenses, moments, footprints] = await Promise.all([
      listTrips(),
      listExpenses(),
      listAllMoments(),
      listFootprints(),
    ])
    return { trips, expenses, moments, footprints }
  }, [])
  const { data, loading } = useLoader(
    loader,
    {
      trips: [] as TripView[],
      expenses: [] as Expense[],
      moments: [] as Moment[],
      footprints: [] as Footprint[],
    },
    'recap',
  )

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const trip of data.trips) {
      if (trip.startDate > 0) set.add(new Date(trip.startDate).getFullYear())
    }
    for (const expense of data.expenses) {
      set.add(new Date(expense.spentAt || expense.createdAt).getFullYear())
    }
    if (set.size === 0) set.add(new Date().getFullYear())
    return [...set].sort((a, b) => b - a)
  }, [data])

  const [year, setYear] = useState<number>(() => new Date().getFullYear())
  const activeYear = years.includes(year) ? year : years[0]

  const yearTrips = useMemo(
    () => data.trips.filter((trip) => new Date(trip.startDate || trip.createdAt).getFullYear() === activeYear),
    [data.trips, activeYear],
  )
  const yearExpenses = useMemo(
    () =>
      data.expenses.filter(
        (expense) => new Date(expense.spentAt || expense.createdAt).getFullYear() === activeYear,
      ),
    [data.expenses, activeYear],
  )
  const yearMoments = useMemo(
    () => data.moments.filter((moment) => new Date(moment.createdAt).getFullYear() === activeYear),
    [data.moments, activeYear],
  )
  const yearFootprints = useMemo(
    () => data.footprints.filter((item) => new Date(item.visitedAt).getFullYear() === activeYear),
    [data.footprints, activeYear],
  )

  const totalDays = yearTrips.reduce((sum, trip) => sum + tripDayCount(trip.startDate, trip.endDate), 0)
  const totalCny = yearExpenses.reduce((sum, item) => sum + (item.amountCny ?? 0), 0)
  const photos = yearMoments.reduce((sum, item) => sum + item.photos.length, 0)
  const cities = new Set(yearFootprints.map((item) => item.city).filter(Boolean)).size
  const provinces = summarizeVisits(data.footprints).visited.size

  const months = useMemo(() => {
    const totals = MONTHS.map((_, index) => ({ key: `${activeYear}-${index + 1}`, label: MONTHS[index], amount: 0 }))
    for (const expense of yearExpenses) {
      const key = monthKey(expense.spentAt || expense.createdAt)
      const target = totals.find((item) => item.key === key)
      if (target) target.amount += expense.amountCny ?? 0
    }
    return totals
  }, [yearExpenses, activeYear])

  const stats = useMemo(() => categoryStats(yearExpenses), [yearExpenses])

  const longest = useMemo(() => {
    let best: TripView | undefined
    let bestDays = 0
    for (const trip of yearTrips) {
      const days = tripDayCount(trip.startDate, trip.endDate)
      if (days > bestDays) {
        best = trip
        bestDays = days
      }
    }
    return best ? { trip: best, days: bestDays } : null
  }, [yearTrips])

  const busiestMonth = useMemo(() => {
    let index = -1
    let max = 0
    months.forEach((item, i) => {
      if (item.amount > max) {
        max = item.amount
        index = i
      }
    })
    return index >= 0 ? { label: MONTHS[index], amount: max } : null
  }, [months])

  const hasData = yearTrips.length > 0 || yearExpenses.length > 0 || yearMoments.length > 0

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-5 pb-4">
      <div className="flex items-center gap-2.5 pt-3">
        <IconButton label={tr('返回')} onClick={() => nav.back()}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="text-note text-ink-3">
          {tr('我的')} / <span className="text-ink-2">{tr('年度回顾')}</span>
        </span>
      </div>

      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Year in review</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink">
            {activeYear} {t('recap.title')}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="上一年"
            disabled={!years.includes(activeYear - 1)}
            onClick={() => setYear(activeYear - 1)}
            className="press flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink-2 disabled:opacity-40"
          >
            <CaretLeft size={14} />
          </button>
          <button
            type="button"
            aria-label="下一年"
            disabled={!years.includes(activeYear + 1)}
            onClick={() => setYear(activeYear + 1)}
            className="press flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink-2 disabled:opacity-40"
          >
            <CaretRight size={14} />
          </button>
        </div>
      </header>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-24 rounded-2xl" />
          <div className="skeleton h-40 rounded-2xl" />
        </div>
      ) : !hasData ? (
        <EmptyState
          icon={<EmptyArt variant="notebook" />}
          title={`${activeYear} 年还没有旅行`}
          hint="记录一次旅程，这里会自动汇总成年度回顾。"
          action={
            <button
              type="button"
              className="btn-primary mt-1"
              onClick={() => nav.navigate({ name: 'tripEditor' })}
            >
              新建旅程
            </button>
          }
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-3.5">
              <StatTile label="旅行" value={`${yearTrips.length} 段`} />
            </div>
            <div className="card p-3.5">
              <StatTile label="在路上" value={`${totalDays} 天`} />
            </div>
            <div className="card p-3.5">
              <StatTile label="城市" value={`${cities} 座`} />
            </div>
            <div className="card p-3.5">
              <StatTile label="照片" value={`${photos} 张`} />
            </div>
          </section>

          <section className="card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-note font-semibold tracking-tight text-ink">全年花费</h2>
              <span className="text-caption text-ink-3">人民币</span>
            </div>
            <p className="mt-1 text-display font-semibold leading-none tabular-nums tracking-tight text-ink">
              {formatCny(totalCny)}
            </p>
            <div className="mt-4">
              <MonthBars data={months} height={110} currentKey={monthKey(Date.now())} />
            </div>
            {busiestMonth ? (
              <p className="mt-2 text-caption text-ink-3">
                {busiestMonth.label} 月花得最多，{formatCny(busiestMonth.amount)}
              </p>
            ) : null}
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="card p-4">
              <h2 className="text-note font-semibold tracking-tight text-ink">花在哪</h2>
              {stats.length > 0 ? (
                <div className="mt-3 flex items-center gap-4">
                  <DonutChart stats={stats} total={totalCny} size={124} thickness={11} />
                  <CategoryLegend stats={stats} />
                </div>
              ) : (
                <p className="mt-3 text-note text-ink-3">这一年还没有账目</p>
              )}
            </section>

            <section className="card space-y-3 p-4">
              <h2 className="text-note font-semibold tracking-tight text-ink">这一刻</h2>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Sparkle size={17} weight="fill" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body text-ink">
                    {longest
                      ? `最长的一段是「${longest.trip.title}」，${longest.days} 天`
                      : '还没有旅程记录'}
                  </p>
                  <p className="mt-0.5 text-caption text-ink-3">
                    去过 {provinces} 个省级行政区 · {yearMoments.length} 条记录
                  </p>
                </div>
              </div>
              {yearTrips.length > 0 ? (
                <div className="space-y-1.5 border-t border-line pt-3">
                  {yearTrips.slice(0, 4).map((trip) => (
                    <button
                      key={trip.id}
                      type="button"
                      onClick={() => nav.navigate({ name: 'trip', id: trip.id, tab: 'plan' })}
                      className="press flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-left hover:bg-paper-2"
                    >
                      <span className={cn('h-8 w-8 shrink-0 rounded-lg', `cover-${trip.cover}`)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-note text-ink">{trip.title}</span>
                        <span className="block truncate text-caption text-ink-3">
                          {formatDate(trip.startDate)} · {STATUS_LABEL[tripStatusOf(trip.startDate, trip.endDate)]}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          </div>

          {stats.length === 0 ? null : (
            <p className="text-center text-caption text-ink-3">
              数据来自本机记录，{CATEGORY_LABEL[stats[0].category]}是这一年花得最多的一类
            </p>
          )}
        </>
      )}
    </div>
  )
}