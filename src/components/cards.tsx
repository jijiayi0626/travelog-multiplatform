import {
  ArrowUpRight,
  CalendarBlank,
  Check,
  MapPin,
  NavigationArrow,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react'
import type {
  ChecklistItem,
  Expense,
  Footprint,
  Member,
  Moment,
  Photo,
  TripStatus,
  TripView,
} from '../lib/types'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CURRENCY_SYMBOL,
  countdownText,
  coverClass,
  formatDate,
  formatDateCn,
  formatMoney,
  formatTime,
  STATUS_LABEL,
  tripDayCount,
  tripStatusOf,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { useI18n } from '../lib/app-context'
import { CategoryGlyph } from './Icons'
import { Avatar } from './ui'

const STATUS_STYLE: Record<TripStatus, string> = {
  ongoing: 'bg-accent text-white',
  planned: 'bg-white/20 text-white',
  finished: 'bg-white/12 text-[var(--on-cover-strong)]',
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
  const { tr } = useI18n()
  const status = tripStatusOf(trip.startDate, trip.endDate)
  const days = tripDayCount(trip.startDate, trip.endDate)
  const cover = coverClass(trip.cover)
  const countdown = status === 'planned' ? countdownText(trip.startDate) : ''

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
      {trip.coverImage ? (
        <>
          <img src={trip.coverImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <span className="absolute inset-0 bg-black/35" />
        </>
      ) : null}
      <span className="relative flex items-start justify-between gap-3 p-4">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium tracking-wide',
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
        <span className="translate-y-[-2px] text-[var(--on-cover-muted)] transition-transform duration-300 group-hover:translate-x-0.5 group-hover:translate-y-[-4px]">
          <ArrowUpRight size={18} weight="bold" />
        </span>
      </span>

      <span className="relative mt-auto flex flex-col gap-1 p-4 pt-10">
        <span className="text-heading-sm font-semibold leading-snug tracking-tight text-white">
          {trip.title || tr('未命名旅程')}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-note text-[var(--on-cover-muted)]">
          <span className="inline-flex items-center gap-1">
            <MapPin size={12} />
            {trip.destination || tr('目的地待定')}
          </span>
          {trip.startDate > 0 ? (
            <span className="inline-flex items-center gap-1">
              <CalendarBlank size={12} />
              {formatDate(trip.startDate)}
              {days > 0 ? ` · ${tr('{n} 天', { n: days })}` : ''}
            </span>
          ) : null}
        </span>
        <span className="mt-2 flex items-center gap-2.5 text-caption tabular-nums text-[var(--on-cover-muted)]">
          {countdown ? (
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[var(--on-cover-strong)]">{countdown}</span>
          ) : null}
          {trip.planCount > 0 ? (
            <span>
              {tr('日程 {done}/{total}', { done: trip.planDoneCount, total: trip.planCount })}
            </span>
          ) : null}
          <span>{tr('{n} 条记录', { n: trip.momentCount })}</span>
          <span className="h-3 w-px bg-white/20" />
          <span>¥ {formatMoney(trip.expenseTotalCny)}</span>
        </span>
      </span>
    </button>
  )
}

export function MomentCard({
  moment,
  onOpen,
  onPhoto,
}: {
  moment: Moment
  onOpen: () => void
  onPhoto?: (index: number) => void
}) {
  const photos = moment.photos ?? []
  return (
    <article className="card press group cursor-pointer overflow-hidden" onClick={onOpen}>
      {photos.length > 0 ? (
        <div className={cn('grid gap-px bg-line', photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
          {photos.slice(0, 4).map((photo, index) => (
            <img
              key={photo.id}
              src={photo.src}
              alt={photo.caption ?? moment.locationName}
              className={cn(
                'w-full cursor-zoom-in object-cover transition-transform duration-500 group-hover:scale-[1.02]',
                photos.length === 1 ? 'aspect-[3/2]' : 'aspect-square',
              )}
              loading="lazy"
              onClick={(event) => {
                if (!onPhoto) return
                event.stopPropagation()
                onPhoto(index)
              }}
            />
          ))}
        </div>
      ) : null}
      <div className="space-y-2 p-4">
        <div className="flex items-center gap-2 text-note text-ink-3">
          <span className="tabular-nums">{formatTime(moment.createdAt)}</span>
          {moment.locationName ? (
            <>
              <span className="h-3 w-px bg-line" />
              <span className="inline-flex min-w-0 items-center gap-1 truncate text-accent">
                <MapPin size={11} />
                {moment.locationName}
              </span>
            </>
          ) : null}
          <PencilSimple
            size={13}
            className="ml-auto shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100"
          />
        </div>
        <p className="text-body leading-6 text-ink">{moment.content}</p>
        {(moment.tags ?? []).length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {(moment.tags ?? []).map((tag) => (
              <span key={tag} className="rounded-full bg-paper-2 px-2 py-0.5 text-caption text-ink-3">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}

export function ExpenseRow({ expense, onOpen }: { expense: Expense; onOpen?: () => void }) {
  const foreign = expense.currency && expense.currency !== 'CNY'
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="press flex w-full items-center gap-3 rounded-2xl px-1 py-2 text-left disabled:cursor-default"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{
          backgroundColor: `${CATEGORY_COLOR[expense.category]}18`,
          color: CATEGORY_COLOR[expense.category],
        }}
      >
        <CategoryGlyph category={expense.category} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink">
          {CATEGORY_LABEL[expense.category]}
        </span>
        <span className="block truncate text-note text-ink-3">
          {expense.note || formatDateCn(expense.spentAt)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-body font-medium tabular-nums text-ink">
          {foreign
            ? `${CURRENCY_SYMBOL[expense.currency as keyof typeof CURRENCY_SYMBOL]}${formatMoney(expense.amount)}`
            : `¥ ${formatMoney(expense.amount)}`}
        </span>
        {foreign ? (
          <span className="block text-caption tabular-nums text-ink-3">
            {expense.currency} · ≈ ¥{formatMoney(expense.amountCny ?? 0)}
          </span>
        ) : null}
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
  const { tr } = useI18n()
  return (
    <div className="flex items-center gap-3">
      <span className="w-[60px] shrink-0 text-body-sm text-ink-2">{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-2">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(ratio * 100, 3)}%`, backgroundColor: color }}
        />
      </span>
      <span className="w-[92px] shrink-0 text-right text-note tabular-nums text-ink-3">
        {tr('{n} 笔 · ¥{amount}', { n: count, amount: formatMoney(amount) })}
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
  const { tr } = useI18n()
  return (
    <div className="group flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5">
      <button
        type="button"
        aria-label={item.done ? tr('标记为未完成') : tr('标记为完成')}
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
          'min-w-0 flex-1 truncate text-left text-body',
          item.done ? 'text-ink-3 line-through' : 'text-ink',
        )}
      >
        {item.title}
      </button>
      <button
        type="button"
        aria-label={tr('删除')}
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
  const { tr } = useI18n()
  const hasCoord = footprint.latitude !== 0 || footprint.longitude !== 0
  return (
    <div className="card flex items-center gap-3 p-3.5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <MapPin size={19} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-ink">{footprint.placeName}</p>
        <p className="mt-0.5 flex items-center gap-2 text-note text-ink-3">
          {footprint.city ? <span>{footprint.city}</span> : null}
          <span>{formatDateCn(footprint.visitedAt)}</span>
          {hasCoord ? (
            <span className="hidden tabular-nums sm:inline">
              {footprint.latitude.toFixed(2)}, {footprint.longitude.toFixed(2)}
            </span>
          ) : null}
        </p>
      </div>
      {hasCoord ? (
        <button
          type="button"
          aria-label={tr('在地图中查看')}
          onClick={onOpenMap}
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-2"
        >
          <NavigationArrow size={15} />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          aria-label={tr('删除足迹')}
          onClick={onDelete}
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-danger"
        >
          <Trash size={15} />
        </button>
      ) : null}
    </div>
  )
}

export function MemberRow({ member, onRemove }: { member: Member; onRemove?: () => void }) {
  const { tr } = useI18n()
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5">
      <Avatar name={member.name} size={38} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-ink">{member.name}</p>
        <p className="truncate text-note text-ink-3">
          {member.role === 'owner' ? tr('创建者') : tr('成员')}
          {member.contact ? ` · ${member.contact}` : ''}
        </p>
        {member.note ? (
          <p className="mt-0.5 truncate text-caption text-ink-3">{member.note}</p>
        ) : null}
      </div>
      {onRemove ? (
        <button type="button" onClick={onRemove} className="press text-note text-ink-3 hover:text-danger">
          {tr('移除')}
        </button>
      ) : null}
    </div>
  )
}

export function PhotoStrip({ photos, onRemove }: { photos: Photo[]; onRemove?: (id: string) => void }) {
  const { tr } = useI18n()
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
              aria-label={tr('移除照片')}
              onClick={() => onRemove(photo.id)}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-note text-white"
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}