import { useCallback, useMemo, useState } from 'react'
import { ArrowRight, ArrowsDownUp, MagnifyingGlass, Plus, Sparkle, X } from '@phosphor-icons/react'
import type { Moment, Plan, TripStatus, TripTemplate, TripView } from '../lib/types'
import { listAllMoments, listAllPlans, listTrips, memoriesOf } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useNav, useSearch } from '../lib/app-context'
import {
  daysUntil,
  dayIndexOfDate,
  formatCny,
  formatDateCn,
  PLAN_KIND_COLOR,
  tripDayCount,
  tripStatusOf,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { TripCard } from '../components/cards'
import { EmptyState, IconButton, Sheet, SkeletonList } from '../components/ui'
import { EmptyArt } from '../components/EmptyArt'

const TEMPLATES: Array<{ value: TripTemplate; label: string; hint: string; cover: number }> = [
  { value: 'blank', label: '空白旅程', hint: '从一张白纸开始', cover: 0 },
  { value: 'city', label: '城市漫步', hint: '适合周末两三天', cover: 1 },
  { value: 'beach', label: '海岛度假', hint: '泳衣、防晒、浮潜', cover: 3 },
  { value: 'road', label: '自驾公路', hint: '证件、离线地图', cover: 2 },
  { value: 'ski', label: '滑雪', hint: '雪镜、护具、保暖', cover: 4 },
]

const STATUS_FILTERS: Array<{ value: 'all' | TripStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'planned', label: '计划中' },
  { value: 'ongoing', label: '进行中' },
  { value: 'finished', label: '已结束' },
]

export function TripsPage() {
  const loader = useCallback(async () => {
    const [trips, moments, plans] = await Promise.all([listTrips(), listAllMoments(), listAllPlans()])
    return { trips, moments, plans }
  }, [])
  const { data, loading } = useLoader(
    loader,
    { trips: [] as TripView[], moments: [] as Moment[], plans: [] as Plan[] },
    'trips',
  )
  const nav = useNav()
  const openSearch = useSearch()

  const [status, setStatus] = useState<'all' | TripStatus>('all')
  const [sortBy, setSortBy] = useState<'date' | 'spend' | 'title'>('date')
  const [templateOpen, setTemplateOpen] = useState(false)

  const trips = data.trips
  const memories = useMemo(() => memoriesOf(data.moments, trips), [data.moments, trips])

  const filtered = useMemo(() => {
    const list = trips.filter((trip) =>
      status === 'all' ? true : tripStatusOf(trip.startDate, trip.endDate) === status,
    )
    return [...list].sort((a, b) => {
      if (sortBy === 'spend') return b.expenseTotalCny - a.expenseTotalCny
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'zh-CN')
      return (b.startDate || b.createdAt) - (a.startDate || a.createdAt)
    })
  }, [trips, status, sortBy])

  const totalDays = trips.reduce((sum, trip) => sum + tripDayCount(trip.startDate, trip.endDate), 0)
  const totalSpent = trips.reduce((sum, trip) => sum + trip.expenseTotalCny, 0)

  // 正在进行的旅程优先；否则挑 30 天内最近出发的一段
  const contextTrip = useMemo(() => {
    const ongoing = trips.find((trip) => tripStatusOf(trip.startDate, trip.endDate) === 'ongoing')
    if (ongoing) return { trip: ongoing, kind: 'ongoing' as const }
    const upcoming = trips
      .filter((trip) => {
        const status = tripStatusOf(trip.startDate, trip.endDate)
        const left = daysUntil(trip.startDate)
        return status === 'planned' && left >= 0 && left <= 30
      })
      .sort((a, b) => a.startDate - b.startDate)[0]
    return upcoming ? { trip: upcoming, kind: 'upcoming' as const } : null
  }, [trips])

  const contextPlans = useMemo(() => {
    if (!contextTrip) return []
    const day =
      contextTrip.kind === 'ongoing'
        ? dayIndexOfDate(contextTrip.trip.startDate)
        : 1
    return data.plans
      .filter((plan) => plan.tripId === contextTrip.trip.id && plan.dayIndex === day)
      .slice(0, 3)
  }, [contextTrip, data.plans])

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 pt-4">
        <div className="min-w-0">
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Your journeys</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
            我的旅行
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton label="搜索" onClick={openSearch}>
            <MagnifyingGlass size={17} />
          </IconButton>
          <button type="button" className="btn-primary" onClick={() => setTemplateOpen(true)}>
            <Plus size={16} weight="bold" />
            新建
          </button>
        </div>
      </header>

      {!loading && trips.length > 0 ? (
        <div className="flex divide-x divide-line border-y border-line py-3.5">
          <div className="min-w-0 flex-1 pr-3">
            <p className="text-caption tracking-wide text-ink-3">旅程</p>
            <p className="mt-1 text-title font-semibold tabular-nums tracking-tight text-ink">
              {trips.length}
              <span className="ml-0.5 text-caption font-normal text-ink-3">段</span>
            </p>
          </div>
          <div className="min-w-0 flex-1 px-3">
            <p className="text-caption tracking-wide text-ink-3">在路上</p>
            <p className="mt-1 text-title font-semibold tabular-nums tracking-tight text-ink">
              {totalDays}
              <span className="ml-0.5 text-caption font-normal text-ink-3">天</span>
            </p>
          </div>
          <div className="min-w-0 flex-1 pl-3">
            <p className="text-caption tracking-wide text-ink-3">总花费</p>
            <p className="mt-1 truncate text-title font-semibold tabular-nums tracking-tight text-ink">
              {formatCny(totalSpent)}
            </p>
          </div>
        </div>
      ) : null}

      {!loading && contextTrip ? (
        <button
          type="button"
          onClick={() =>
            nav.navigate({ name: 'trip', id: contextTrip.trip.id, tab: 'plan' })
          }
          className="press w-full overflow-hidden rounded-[1.3rem] border border-line bg-surface text-left shadow-lift"
        >
          <span className="flex items-center gap-2 border-b border-line bg-paper-2/50 px-4 py-2.5">
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-caption font-medium',
                contextTrip.kind === 'ongoing'
                  ? 'bg-accent text-white'
                  : 'bg-accent-soft text-accent',
              )}
            >
              {contextTrip.kind === 'ongoing'
                ? `今天 · 第 ${Math.max(dayIndexOfDate(contextTrip.trip.startDate), 1)} 天`
                : `还有 ${daysUntil(contextTrip.trip.startDate)} 天出发`}
            </span>
            <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-ink">
              {contextTrip.trip.title}
            </span>
            <ArrowRight size={13} className="shrink-0 text-ink-3" />
          </span>
          <span className="block space-y-2 px-4 py-3">
            {contextPlans.length > 0 ? (
              contextPlans.map((plan) => (
                <span key={plan.id} className="flex items-center gap-2.5 text-note">
                  <span className="w-[36px] shrink-0 tabular-nums text-ink-3">
                    {plan.time || '—'}
                  </span>
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: PLAN_KIND_COLOR[plan.kind] }}
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      plan.done ? 'text-ink-3 line-through' : 'text-ink',
                    )}
                  >
                    {plan.title}
                  </span>
                  {plan.place ? (
                    <span className="shrink-0 truncate text-caption text-ink-3">{plan.place}</span>
                  ) : null}
                </span>
              ))
            ) : (
              <span className="block text-note text-ink-3">
                {contextTrip.kind === 'ongoing' ? '今天还没有安排，点开补一条' : '还没排日程，点开套用模板'}
              </span>
            )}
          </span>
        </button>
      ) : null}

      {!loading && memories.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-note font-semibold tracking-tight text-ink">
              <Sparkle size={13} className="text-warn" weight="fill" />
              {memories[0]?.yearsAgo > 0 ? '往年今日' : '最近的回忆'}
            </h2>
            <button
              type="button"
              onClick={() => nav.navigate({ name: 'album' })}
              className="press inline-flex items-center gap-0.5 text-caption text-ink-3 hover:text-ink"
            >
              相册
              <ArrowRight size={11} />
            </button>
          </div>

          <div className="hide-scrollbar -mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
            {memories.map((item) => {
              const cover = item.moment.photos[0]?.src
              return (
                <button
                  key={item.moment.id}
                  type="button"
                  onClick={() =>
                    nav.navigate({ name: 'trip', id: item.moment.tripId, tab: 'timeline' })
                  }
                  className={cn(
                    'press relative shrink-0 snap-start overflow-hidden rounded-[1.15rem] border border-line bg-surface text-left',
                    memories.length === 1 ? 'w-full' : 'w-[228px]',
                  )}
                >
                  <span className="relative block h-[104px] w-full overflow-hidden bg-paper-2">
                    {cover ? (
                      <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <span className="cover-texture absolute inset-0 block bg-accent/20" />
                    )}
                    <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-caption text-[var(--on-cover-strong)] backdrop-blur-sm">
                      {item.yearsAgo > 0 ? `${item.yearsAgo} 年前` : formatDateCn(item.moment.createdAt)}
                    </span>
                  </span>
                  <span className="block p-3">
                    <span className="block truncate text-body-sm font-medium text-ink">
                      {item.moment.locationName || item.trip?.title || '一段回忆'}
                    </span>
                    <span className="mt-0.5 block truncate text-caption text-ink-3">
                      {item.trip?.destination || item.trip?.title}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        <div className="flex shrink-0 gap-1.5">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setStatus(item.value)}
              className={cn('chip', status === item.value && 'chip-active')}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-ink-3">
          <ArrowsDownUp size={13} />
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as 'date' | 'spend' | 'title')}
            aria-label="排序方式"
            className="cursor-pointer appearance-none bg-transparent pr-1 text-note text-ink-3 outline-none"
          >
            <option value="date">按日期</option>
            <option value="spend">按花费</option>
            <option value="title">按名称</option>
          </select>
        </span>
      </div>

      {loading ? (
        <SkeletonList rows={2} />
      ) : trips.length === 0 ? (
        <EmptyState
          icon={<EmptyArt />}
          title="还没有旅行记录"
          hint="新建一段旅程，把日程、照片、地点和花费都收进来。"
          action={
            <button type="button" className="btn-primary mt-1" onClick={() => setTemplateOpen(true)}>
              <Plus size={16} weight="bold" />
              新建第一段旅程
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<X size={20} />}
          title="这个状态下没有旅程"
          hint="换个筛选条件，或者新建一段。"
          action={
            <button type="button" className="btn-ghost mt-1" onClick={() => setStatus('all')}>
              查看全部
            </button>
          }
        />
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-2">
          {filtered.map((trip, index) => (
            <TripCard
              key={trip.id}
              trip={trip}
              index={index}
              onOpen={() => nav.navigate({ name: 'trip', id: trip.id, tab: 'plan' })}
            />
          ))}
        </div>
      )}

      <Sheet open={templateOpen} title="从模板开始" onClose={() => setTemplateOpen(false)}>
        <div className="space-y-2">
          {TEMPLATES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setTemplateOpen(false)
                nav.navigate({ name: 'tripEditor', template: item.value })
              }}
              className="press flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left"
            >
              <span className={cn('h-12 w-12 shrink-0 rounded-xl', `cover-${item.cover}`)} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-ink">{item.label}</span>
                <span className="block text-note text-ink-3">{item.hint}</span>
              </span>
              <Plus size={15} className="shrink-0 text-ink-3" />
            </button>
          ))}
        </div>
        <p className="px-1 pt-3 text-caption leading-4 text-ink-3">
          选模板会自动套用对应的日程与打包清单，之后都能单独修改。
        </p>
      </Sheet>
    </div>
  )
}