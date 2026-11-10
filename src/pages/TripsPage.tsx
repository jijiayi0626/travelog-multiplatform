import { Compass, Plus } from '@phosphor-icons/react'
import { useLoader } from '../lib/hooks'
import { listTrips } from '../lib/repo'
import { useNav } from '../lib/app-context'
import type { TripView } from '../lib/types'
import { formatMoney, tripDayCount } from '../lib/utils'
import { TripCard } from '../components/cards'
import { EmptyState, SkeletonList } from '../components/ui'

export function TripsPage() {
  const { data: trips, loading } = useLoader(() => listTrips(), [] as TripView[], 'trips')
  const nav = useNav()

  const totalDays = trips.reduce((sum, trip) => sum + tripDayCount(trip.startDate, trip.endDate), 0)
  const totalSpent = trips.reduce((sum, trip) => sum + trip.expenseTotal, 0)

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 pt-4">
        <div className="min-w-0">
          <p className="text-[10.5px] uppercase tracking-[0.22em] text-ink-3">Your journeys</p>
          <h1 className="mt-1.5 text-[27px] font-semibold leading-none tracking-tight text-ink sm:text-[32px]">
            我的旅行
          </h1>
        </div>
        <button
          type="button"
          className="btn-primary shrink-0"
          onClick={() => nav.navigate({ name: 'tripEditor' })}
        >
          <Plus size={16} weight="bold" />
          新建
        </button>
      </header>

      {!loading && trips.length > 0 ? (
        <div className="flex divide-x divide-line border-y border-line py-3.5">
          <div className="min-w-0 flex-1 pr-3">
            <p className="text-[10.5px] tracking-wide text-ink-3">旅程</p>
            <p className="mt-1 text-[17px] font-semibold tabular-nums tracking-tight text-ink">
              {trips.length}
              <span className="ml-0.5 text-[11px] font-normal text-ink-3">段</span>
            </p>
          </div>
          <div className="min-w-0 flex-1 px-3">
            <p className="text-[10.5px] tracking-wide text-ink-3">在路上</p>
            <p className="mt-1 text-[17px] font-semibold tabular-nums tracking-tight text-ink">
              {totalDays}
              <span className="ml-0.5 text-[11px] font-normal text-ink-3">天</span>
            </p>
          </div>
          <div className="min-w-0 flex-1 pl-3">
            <p className="text-[10.5px] tracking-wide text-ink-3">总花费</p>
            <p className="mt-1 truncate text-[17px] font-semibold tabular-nums tracking-tight text-ink">
              ¥ {formatMoney(totalSpent)}
            </p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <SkeletonList rows={2} />
      ) : trips.length === 0 ? (
        <EmptyState
          icon={<Compass size={20} />}
          title="还没有旅行记录"
          hint="新建一段旅程，把照片、地点和花费都收进来。"
          action={
            <button
              type="button"
              className="btn-primary mt-1"
              onClick={() => nav.navigate({ name: 'tripEditor' })}
            >
              <Plus size={16} weight="bold" />
              新建第一段旅程
            </button>
          }
        />
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-2">
          {trips.map((trip, index) => (
            <div key={trip.id}>
              <TripCard
                trip={trip}
                index={index}
                onOpen={() => nav.navigate({ name: 'trip', id: trip.id, tab: 'timeline' })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}