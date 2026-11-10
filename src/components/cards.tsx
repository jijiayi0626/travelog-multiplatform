import {
  ArrowUpRight,
  CalendarBlank,
  Check,
  MapPin,
  NavigationArrow,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react'
import type { ChecklistItem, Expense, Footprint, Member, Moment, Photo, TripView, TripStatus } from '../lib/types'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  coverClass,
  formatDate,
  formatDateCn,
  formatMoney,
  formatTime,
  tripDayCount,
  tripStatusOf,
  STATUS_LABEL,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { CategoryGlyph } from './Icons'
import { Avatar } from './ui'

const STATUS_STYLE: Record<TripStatus, string> = {
  ongoing: 'bg-accent text-white',
  planned: 'bg-white/16 text-white',
  finished: 'bg-white/10 text-white/80',
}

export function TripCard({
  trip,
  onOpen,
  index = 0,
}: {
  trip: TripView
  onOpen: () => void
  index?: number
}) {
  const status = tripStatusOf(trip.startDate, trip.endDate)
  const days = tripDayCount(trip.startDate, trip.endDate)
  const cover = coverClass(trip.cover)

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'rise press group relative flex w-full flex-col overflow-hidden rounded-[1.5rem] text-left',
        cover,
      )}
      style={{
        animationDelay: `${index * 70}ms`,
        boxShadow: '0 22px 46px -30px rgba(8, 33, 31, 0.85)',
        minHeight: 196,
      }}
    >
      <span className="cover-texture pointer-events-none absolute inset-0" />
      <span className="relative flex items-start justify-between gap-3 p-4">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-medium tracking-wide',
            STATUS_STYLE[status],
          )}
        >
          {status === 'ongoing' ? (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
          ) : null}
          {STATUS_LABEL[status]}
        </span>
        <span className="translate-y-[-2px] text-white/45 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:translate-y-[-4px]">
          <ArrowUpRight size={18} weight="bold" />
        </span>
      </span>

      <span className="relative mt-auto flex flex-col gap-1 p-4 pt-10">
        <span className="text-[19px] font-semibold leading-snug tracking-tight text-white">
          {trip.title || '未命名旅程'}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-white/70">
          <span className="inline-flex items-center gap-1">
            <MapPin size={12} />
            {trip.destination || '目的地待定'}
          </span>
          {trip.startDate > 0 ? (
            <span className="inline-flex items-center gap-1">
              <CalendarBlank size={12} />
              {formatDate(trip.startDate)}
              {days > 0 ? ` · ${days} 天` : ''}
            </span>
          ) : null}
        </span>
        <span className="mt-2 flex items-center gap-3 text-[11px] text-white/60 tabular-nums">
          <span>{trip.momentCount} 条记录</span>
          <span className="h-3 w-px bg-white/20" />
          <span>¥ {formatMoney(trip.expenseTotal)}</span>
        </span>
      </span>
    </button>
  )
}

export function MomentCard({
  moment,
  onOpen,
}: {
  moment: Moment
  onOpen: () => void
}) {
  const photos = moment.photos ?? []
  return (
    <article className="card press group cursor-pointer overflow-hidden" onClick={onOpen}>
      {photos.length > 0 ? (
        <div
          className={cn(
            'grid gap-px bg-line',
            photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
          )}
        >
          {photos.slice(0, 4).map((photo) => (
            <img
              key={photo.id}
              src={photo.src}
              alt={photo.caption ?? moment.locationName}
              className={cn(
                'w-full object-cover',
                photos.length === 1 ? 'aspect-[3/2]' : 'aspect-square',
              )}
              loading="lazy"
            />
          ))}
        </div>
      ) : null}
      <div className="space-y-2 p-4">
        <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
          <span className="tabular-nums">{formatTime(moment.createdAt)}</span>
          {moment.locationName ? (
            <>
              <span className="h-3 w-px bg-line" />
              <span className="inline-flex items-center gap-1 truncate text-accent">
                <MapPin size={11} />
                {moment.locationName}
              </span>
            </>
          ) : null}
          <PencilSimple
            size={13}
            className="ml-auto text-ink-3 opacity-0 transition-opacity group-hover:opacity-100"
          />
        </div>
        <p className="text-[14.5px] leading-6 text-ink">{moment.content}</p>
      </div>
    </article>
  )
}

export function ExpenseRow({
  expense,
  onOpen,
}: {
  expense: Expense
  onOpen?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="press flex w-full items-center gap-3 rounded-2xl px-1 py-2 text-left disabled:cursor-default"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${CATEGORY_COLOR[expense.category]}14`, color: CATEGORY_COLOR[expense.category] }}
      >
        <CategoryGlyph category={expense.category} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">
          {CATEGORY_LABEL[expense.category]}
        </span>
        <span className="block truncate text-[12px] text-ink-3">
          {expense.note || formatDateCn(expense.spentAt)}
        </span>
      </span>
      <span className="shrink-0 text-[14px] font-medium tabular-nums text-ink">
        ¥ {formatMoney(expense.amount)}
      </span>
    </button>
  )
}

export function CategoryBar({
  label,
  color,
  amount,
  count,
  ratio,
}: {
  label: string
  color: string
  amount: number
  count: number
  ratio: number
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[68px] shrink-0 text-[12.5px] text-ink-2">{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-2">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(ratio * 100, 3)}%`, backgroundColor: color }}
        />
      </span>
      <span className="w-[86px] shrink-0 text-right text-[12px] tabular-nums text-ink-3">
        {count} 笔 · ¥{formatMoney(amount)}
      </span>
    </div>
  )
}

export function ChecklistRow({
  item,
  onToggle,
  onDelete,
}: {
  item: ChecklistItem
  onToggle: (done: boolean) => void
  onDelete: () => void
}) {
  return (
    <div className="group flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5">
      <button
        type="button"
        aria-label={item.done ? '标记为未完成' : '标记为完成'}
        onClick={() => onToggle(!item.done)}
        className={cn(
          'press flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
          item.done ? 'border-accent bg-accent text-white' : 'border-line bg-paper-2 text-transparent',
        )}
      >
        <Check size={13} weight="bold" />
      </button>
      <button
        type="button"
        onClick={() => onToggle(!item.done)}
        className={cn(
          'min-w-0 flex-1 truncate text-left text-[14px]',
          item.done ? 'text-ink-3 line-through' : 'text-ink',
        )}
      >
        {item.title}
      </button>
      <button
        type="button"
        aria-label="删除"
        onClick={onDelete}
        className="press flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:text-danger"
      >
        <Trash size={15} />
      </button>
    </div>
  )
}

export function FootprintRow({
  footprint,
  onOpenMap,
  onDelete,
}: {
  footprint: Footprint
  onOpenMap: () => void
  onDelete?: () => void
}) {
  const hasCoord = footprint.latitude !== 0 || footprint.longitude !== 0
  return (
    <div className="card flex items-center gap-3 p-3.5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <MapPin size={19} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-medium text-ink">{footprint.placeName}</p>
        <p className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-3">
          {footprint.city ? <span>{footprint.city}</span> : null}
          <span>{formatDateCn(footprint.visitedAt)}</span>
          {hasCoord ? (
            <span className="tabular-nums">
              {footprint.latitude.toFixed(2)}, {footprint.longitude.toFixed(2)}
            </span>
          ) : null}
        </p>
      </div>
      {hasCoord ? (
        <button
          type="button"
          aria-label="在地图中查看"
          onClick={onOpenMap}
          className="press flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-2"
        >
          <NavigationArrow size={15} />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          aria-label="删除足迹"
          onClick={onDelete}
          className="press flex h-9 w-9 items-center justify-center rounded-full text-ink-3 hover:text-danger"
        >
          <Trash size={15} />
        </button>
      ) : null}
    </div>
  )
}

export function MemberRow({ member, onRemove }: { member: Member; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5">
      <Avatar name={member.name} size={38} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{member.name}</p>
        <p className="text-[11.5px] text-ink-3">{member.role === 'owner' ? '创建者' : '成员'}</p>
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="press text-[12px] text-ink-3 hover:text-danger"
        >
          移除
        </button>
      ) : null}
    </div>
  )
}

export function PhotoStrip({ photos, onRemove }: { photos: Photo[]; onRemove?: (id: string) => void }) {
  if (photos.length === 0) return null
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {photos.map((photo) => (
        <span key={photo.id} className="relative">
          <img
            src={photo.src}
            alt={photo.caption ?? ''}
            className="aspect-square w-full rounded-xl object-cover"
          />
          {onRemove ? (
            <button
              type="button"
              aria-label="移除照片"
              onClick={() => onRemove(photo.id)}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white text-[12px]"
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}