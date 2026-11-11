import { useCallback, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarBlank,
  CalendarCheck,
  CaretDown,
  CaretUp,
  Copy,
  MapPin,
  PencilSimple,
  Plus,
  Sparkle,
  Trash,
  UsersThree,
  Wallet,
} from '@phosphor-icons/react'
import type { ChecklistItem, Expense, Member, Moment, Photo, Plan, TabKey, Trip } from '../lib/types'
import {
  addMember,
  applyChecklistTemplate,
  applyPlanTemplate,
  categoryStats,
  checklistProgress,
  deleteChecklistItem,
  deletePlan,
  deleteTrip,
  duplicateTrip,
  getTrip,
  groupMoments,
  listChecklist,
  listExpenses,
  listMembers,
  listMoments,
  listPlans,
  movePlan,
  nextPlanOf,
  planSummary,
  removeMember,
  saveChecklistItem,
  sumExpenseCny,
  togglePlan,
  CHECKLIST_TEMPLATES,
  PLAN_TEMPLATES,
} from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useNav, useRefresh, useToast } from '../lib/app-context'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  PLAN_KIND_COLOR,
  PLAN_KIND_LABEL,
  STATUS_LABEL,
  copyText,
  coverClass,
  dayIndexOfDate,
  formatDate,
  formatDateCn,
  formatMoney,
  tripDayCount,
  tripStatusOf,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { CategoryBar, ChecklistRow, ExpenseRow, MemberRow, MomentCard } from '../components/cards'
import { BudgetBar, HeatStrip } from '../components/charts'
import { Lightbox } from '../components/Lightbox'
import { EmptyArt } from '../components/EmptyArt'
import { PlanGlyph } from '../components/Icons'
import {
  Avatar,
  ConfirmDialog,
  EmptyState,
  IconButton,
  SegmentedTabs,
  Sheet,
  SkeletonList,
  StatTile,
} from '../components/ui'

interface DetailData {
  trip: Trip | undefined
  moments: Moment[]
  expenses: Expense[]
  checklist: ChecklistItem[]
  members: Member[]
  plans: Plan[]
}

const EMPTY: DetailData = {
  trip: undefined,
  moments: [],
  expenses: [],
  checklist: [],
  members: [],
  plans: [],
}

const TAB_OPTIONS: Array<{ value: TabKey; label: string }> = [
  { value: 'plan', label: '日程' },
  { value: 'timeline', label: '时间线' },
  { value: 'ledger', label: '账本' },
  { value: 'checklist', label: '清单' },
  { value: 'members', label: '旅伴' },
]

const DAY_MS = 864e5

export function TripDetailPage({ tripId, tab }: { tripId: string; tab: TabKey }) {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const [newCheck, setNewCheck] = useState('')
  const [newMember, setNewMember] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [checklistTemplateOpen, setChecklistTemplateOpen] = useState(false)
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null)

  const loader = useCallback(async (): Promise<DetailData> => {
    const [trip, moments, expenses, checklist, members, plans] = await Promise.all([
      getTrip(tripId),
      listMoments(tripId),
      listExpenses(tripId),
      listChecklist(tripId),
      listMembers(tripId),
      listPlans(tripId),
    ])
    return { trip, moments, expenses, checklist, members, plans }
  }, [tripId])

  const { data, loading } = useLoader(loader, EMPTY, tripId)
  const { trip, moments, expenses, checklist, members, plans } = data

  const groups = useMemo(() => groupMoments(moments), [moments])
  const progress = checklistProgress(checklist)
  const planProgress = planSummary(plans)
  const stats = useMemo(() => categoryStats(expenses), [expenses])
  const total = sumExpenseCny(expenses)

  const switchTab = (next: TabKey) => nav.navigate({ name: 'trip', id: tripId, tab: next })

  const addChecklist = async () => {
    const title = newCheck.trim()
    if (!title) {
      toast('先写点什么，再添加')
      return
    }
    await saveChecklistItem({ id: '', tripId, title, done: false, createdAt: Date.now() })
    setNewCheck('')
    bump()
  }

  const toggleChecklist = async (item: ChecklistItem, done: boolean) => {
    await saveChecklistItem({ ...item, done })
    bump()
  }

  const removeChecklist = async (item: ChecklistItem) => {
    await deleteChecklistItem(item.id)
    bump()
  }

  const inviteMember = async () => {
    const name = newMember.trim()
    if (!name) {
      toast('请输入旅伴昵称')
      return
    }
    await addMember(tripId, name)
    setNewMember('')
    bump()
    toast(`已把 ${name} 加入旅程`)
  }

  const copyInvite = async () => {
    if (!trip) return
    const ok = await copyText(trip.inviteCode)
    toast(ok ? '邀请码已复制' : '复制失败，请手动记录')
  }

  const copyTrip = async () => {
    const copy = await duplicateTrip(tripId)
    if (!copy) return
    bump()
    toast('旅程已复制（含清单与日程）')
    nav.navigate({ name: 'trip', id: copy.id, tab: 'plan' })
  }

  const doDeleteTrip = async () => {
    await deleteTrip(tripId)
    bump()
    toast('旅程已删除')
    nav.navigate({ name: 'trips' })
  }

  if (loading) {
    return (
      <div className="space-y-4 pt-4">
        <div className="skeleton h-[168px] rounded-[1.5rem]" />
        <SkeletonList rows={2} />
      </div>
    )
  }

  if (!trip) {
    return (
      <div className="pt-6">
        <EmptyState
          icon={<MapPin size={22} />}
          title="这段旅程不存在了"
          hint="可能已被删除，回到列表看看其他旅程。"
          action={
            <button type="button" className="btn-ghost mt-1" onClick={() => nav.navigate({ name: 'trips' })}>
              回到行程
            </button>
          }
        />
      </div>
    )
  }

  const status = tripStatusOf(trip.startDate, trip.endDate)
  const days = tripDayCount(trip.startDate, trip.endDate)

  return (
    <div className="pb-2">
      <div className="flex items-center gap-2.5 pt-3">
        <IconButton label="返回" onClick={() => nav.navigate({ name: 'trips' })}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="min-w-0 truncate text-note text-ink-3">
          行程 / <span className="text-ink-2">{trip.title}</span>
        </span>
      </div>

      <section className={cn('relative mt-3 overflow-hidden rounded-[1.6rem] p-5 text-white', coverClass(trip.cover))}>
        <span className="cover-texture pointer-events-none absolute inset-0" />
        <div className="relative flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-1 text-caption font-medium tracking-wide',
              status === 'ongoing' ? 'bg-accent text-white' : 'bg-white/15 text-[var(--on-cover-strong)]',
            )}
          >
            {STATUS_LABEL[status]}
          </span>
          {days > 0 ? <span className="text-note text-[var(--on-cover-muted)]">共 {days} 天</span> : null}
        </div>
        <h1 className="relative mt-8 max-w-[22ch] text-heading font-semibold leading-tight tracking-tight sm:text-display">
          {trip.title || '未命名旅程'}
        </h1>
        <div className="relative mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-note text-[var(--on-cover-muted)]">
          <span className="inline-flex items-center gap-1">
            <MapPin size={13} />
            {trip.destination || '目的地待定'}
          </span>
          {trip.startDate > 0 ? (
            <span className="inline-flex items-center gap-1">
              <CalendarBlank size={13} />
              {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
            </span>
          ) : null}
        </div>
        {trip.note ? (
          <p className="relative mt-3 max-w-[60ch] text-body-sm leading-5 text-[var(--on-cover-muted)]">{trip.note}</p>
        ) : null}
        <button
          type="button"
          onClick={() => nav.navigate({ name: 'tripEditor', id: trip.id })}
          className="press absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-note text-white backdrop-blur-sm"
        >
          <PencilSimple size={13} />
          编辑
        </button>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-4 border-y border-line py-4 lg:hidden">
        <StatTile
          label="日程"
          value={`${planProgress.done}/${planProgress.total}`}
          sub={planProgress.total > 0 ? '已完成' : '待安排'}
        />
        <StatTile label="图文记录" value={`${moments.length} 条`} />
        <StatTile label="花费合计" value={`¥${formatMoney(total)}`} />
        <StatTile label="同行旅伴" value={`${members.length} 人`} />
      </div>

      {trip.budget && trip.budget > 0 ? (
        <div className="mt-3 lg:hidden">
          <BudgetBar spent={total} budget={trip.budget} />
        </div>
      ) : null}

      <div className="mt-4 lg:grid lg:grid-cols-[1.7fr_1fr] lg:gap-6">
        <div className="min-w-0">
          <SegmentedTabs value={tab} options={TAB_OPTIONS} onChange={switchTab} className="max-w-[480px]" />

          <div className="mt-4">
            {tab === 'plan' ? (
              <PlanTab
                plans={plans}
                startDate={trip.startDate}
                endDate={trip.endDate}
                dayCount={days}
                onAdd={(dayIndex) => nav.navigate({ name: 'planEditor', tripId, dayIndex })}
                onOpen={(planId) => nav.navigate({ name: 'planEditor', tripId, planId })}
                onToggle={async (plan, done) => {
                  await togglePlan(plan, done)
                  bump()
                }}
                onMove={async (planId, delta) => {
                  await movePlan(tripId, planId, delta)
                  bump()
                }}
                onDelete={async (plan) => {
                  await deletePlan(plan.id)
                  bump()
                  toast('计划已删除')
                }}
                onTemplate={async (key) => {
                  const added = await applyPlanTemplate(tripId, key, days)
                  bump()
                  toast(added > 0 ? `已排入 ${added} 条日程` : '模板内容已在日程里')
                }}
                onCreateMoment={() => nav.navigate({ name: 'momentEditor', tripId })}
              />
            ) : null}

            {tab === 'timeline' ? (
              <TimelineTab
                groups={groups}
                onAdd={() => nav.navigate({ name: 'momentEditor', tripId })}
                onOpen={(momentId) => nav.navigate({ name: 'momentEditor', tripId, momentId })}
                onPhoto={(moment, index) => setLightbox({ photos: moment.photos, index })}
              />
            ) : null}

            {tab === 'ledger' ? (
              <LedgerTab
                expenses={expenses}
                total={total}
                stats={stats}
                onAdd={() => nav.navigate({ name: 'expenseEditor', tripId })}
                onOpen={(expenseId) => nav.navigate({ name: 'expenseEditor', tripId, expenseId })}
              />
            ) : null}

            {tab === 'checklist' ? (
              <ChecklistTab
                items={checklist}
                progress={progress}
                value={newCheck}
                onChange={setNewCheck}
                onAdd={addChecklist}
                onToggle={toggleChecklist}
                onDelete={removeChecklist}
                onTemplate={() => setChecklistTemplateOpen(true)}
              />
            ) : null}

            {tab === 'members' ? (
              <MembersTab
                members={members}
                inviteCode={trip.inviteCode}
                value={newMember}
                onChange={setNewMember}
                onAdd={inviteMember}
                onRemove={async (member) => {
                  await removeMember(member.id)
                  bump()
                }}
                onCopy={copyInvite}
              />
            ) : null}
          </div>
        </div>

        <aside className="hidden space-y-3 lg:block">
          <div className="card p-4">
            <h2 className="text-note font-semibold tracking-tight text-ink">旅程概览</h2>
            <dl className="mt-3 space-y-2.5 text-body-sm">
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">日程完成</dt>
                <dd className="tabular-nums text-ink">
                  {planProgress.done}/{planProgress.total}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">图文记录</dt>
                <dd className="tabular-nums text-ink">{moments.length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">花费合计</dt>
                <dd className="tabular-nums text-ink">¥ {formatMoney(total)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">清单完成</dt>
                <dd className="tabular-nums text-ink">
                  {progress.done}/{progress.total}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">旅伴</dt>
                <dd className="tabular-nums text-ink">{members.length}</dd>
              </div>
            </dl>
            {trip.budget && trip.budget > 0 ? (
              <div className="mt-3 border-t border-line pt-3">
                <BudgetBar spent={total} budget={trip.budget} />
              </div>
            ) : null}
          </div>

          <div className="card p-4">
            <h2 className="flex items-center gap-1.5 text-note font-semibold tracking-tight text-ink">
              <UsersThree size={14} />
              一起编辑
            </h2>
            <p className="mt-1.5 text-note leading-4 text-ink-3">
              把邀请码发给旅伴。本地模式下会先记录在设备上，接入云端后即可同步。
            </p>
            <button
              type="button"
              onClick={copyInvite}
              className="press mt-3 flex w-full items-center justify-between rounded-xl border border-line bg-paper-2 px-3 py-2.5 text-left"
            >
              <span className="font-mono text-body-lg tracking-[0.18em] text-ink">{trip.inviteCode}</span>
              <Copy size={14} className="text-ink-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={copyTrip}
            className="press flex w-full items-center justify-center gap-1.5 rounded-full border border-line py-2.5 text-body-sm text-ink-2 hover:text-ink"
          >
            <Copy size={14} />
            复制这段旅程
          </button>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="press flex w-full items-center justify-center gap-1.5 rounded-full border border-line py-2.5 text-body-sm text-ink-3 hover:text-danger"
          >
            <Trash size={14} />
            删除这段旅程
          </button>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="删除这段旅程？"
        message="旅程下的日程、图文、账目、清单与足迹都会一并删除，且无法恢复。"
        onConfirm={doDeleteTrip}
        onClose={() => setConfirmDelete(false)}
      />

      <Sheet
        open={checklistTemplateOpen}
        title="套用清单模板"
        onClose={() => setChecklistTemplateOpen(false)}
      >
        <div className="space-y-2">
          {CHECKLIST_TEMPLATES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={async () => {
                const added = await applyChecklistTemplate(tripId, item.key)
                setChecklistTemplateOpen(false)
                bump()
                toast(added > 0 ? `已添加 ${added} 项` : '模板内容已在清单里')
              }}
              className="press w-full rounded-2xl border border-line bg-surface p-3 text-left"
            >
              <span className="block text-body font-medium text-ink">{item.label}</span>
              <span className="mt-0.5 block truncate text-note text-ink-3">{item.items.join(' · ')}</span>
            </button>
          ))}
        </div>
      </Sheet>

      {lightbox ? (
        <Lightbox photos={lightbox.photos} startIndex={lightbox.index} onClose={() => setLightbox(null)} />
      ) : null}
    </div>
  )
}

/* ---------------- 日程 ---------------- */

function PlanTab({
  plans,
  startDate,
  endDate,
  dayCount,
  onAdd,
  onOpen,
  onToggle,
  onMove,
  onDelete,
  onTemplate,
  onCreateMoment,
}: {
  plans: Plan[]
  startDate: number
  endDate: number
  dayCount: number
  onAdd: (dayIndex: number) => void
  onOpen: (planId: string) => void
  onToggle: (plan: Plan, done: boolean) => void
  onMove: (planId: string, delta: number) => void
  onDelete: (plan: Plan) => void
  onTemplate: (key: string) => void
  onCreateMoment: (plan: Plan) => void
}) {
  const [templateOpen, setTemplateOpen] = useState(false)
  const todayIndex = dayIndexOfDate(startDate)
  const progress = planSummary(plans)
  const next = nextPlanOf(plans, startDate, endDate)
  const groups = useMemo(() => {
    const map = new Map<number, Plan[]>()
    for (const plan of plans) {
      const bucket = map.get(plan.dayIndex)
      if (bucket) bucket.push(plan)
      else map.set(plan.dayIndex, [plan])
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([dayIndex, items]) => ({ dayIndex, items }))
  }, [plans])

  const ratio = progress.total > 0 ? progress.done / progress.total : 0
  const defaultDay = todayIndex > 0 ? Math.min(todayIndex, Math.max(dayCount, 1)) : 1
  const heat = Array.from({ length: Math.min(Math.max(dayCount, 1), 14) }).map(
    (_, index) => plans.filter((plan) => plan.dayIndex === index + 1).length,
  )

  return (
    <div className="space-y-3.5">
      {next ? (
        <button
          type="button"
          onClick={() => onOpen(next.id)}
          className="press relative w-full overflow-hidden rounded-[1.25rem] border border-accent/25 bg-accent-soft/70 p-4 text-left"
        >
          <span className="flex items-center gap-1.5 text-caption uppercase tracking-[0.16em] text-accent">
            <Sparkle size={12} weight="fill" />
            下一步
          </span>
          <p className="mt-1.5 flex items-baseline gap-2 text-title font-semibold tracking-tight text-ink">
            {next.time ? <span className="tabular-nums text-accent">{next.time}</span> : null}
            <span className="min-w-0 truncate">{next.title}</span>
          </p>
          <p className="mt-0.5 truncate text-note text-ink-2">
            第 {next.dayIndex} 天
            {next.place ? ` · ${next.place}` : ''}
            {next.note ? ` · ${next.note}` : ''}
          </p>
        </button>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-note text-ink-3">
          <CalendarCheck size={14} className="shrink-0" />
          <span className="shrink-0 tabular-nums">
            {progress.done}/{progress.total} 已完成
          </span>
          <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-paper-2">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${ratio * 100}%` }}
            />
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setTemplateOpen(true)}
            className="press rounded-full border border-line px-2.5 py-1.5 text-note text-ink-2 hover:text-ink"
          >
            套用模板
          </button>
          <button type="button" className="btn-ghost h-8 px-3 text-note" onClick={() => onAdd(defaultDay)}>
            <Plus size={13} weight="bold" />
            添加
          </button>
        </div>
      </div>

      {plans.length > 0 ? (
        <div className="rounded-xl border border-line bg-surface px-3 pb-2 pt-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-caption tracking-wide text-ink-3">每日安排密度</span>
            <span className="text-caption text-ink-3">{dayCount} 天</span>
          </div>
          <HeatStrip
            values={heat}
            labels={heat.map((_, index) => `${index + 1}`)}
            todayIndex={todayIndex}
          />
        </div>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState
          icon={<EmptyArt variant="compass" />}
          title="还没有排日程"
          hint="按天排好要去的地方、吃的东西和住的地方，出发后一条条勾掉。"
          action={
            <div className="mt-1 flex gap-2">
              <button type="button" className="btn-primary" onClick={() => onAdd(defaultDay)}>
                <Plus size={15} weight="bold" />
                添加第一条
              </button>
              <button type="button" className="btn-ghost" onClick={() => setTemplateOpen(true)}>
                套用模板
              </button>
            </div>
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => {
            const isToday = group.dayIndex === todayIndex
            const doneCount = group.items.filter((item) => item.done).length
            return (
              <section key={group.dayIndex}>
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="shrink-0 text-body-sm font-semibold text-accent">第 {group.dayIndex} 天</h3>
                  {isToday ? (
                    <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-caption font-medium text-white">
                      今天
                    </span>
                  ) : null}
                  {startDate > 0 ? (
                    <span className="shrink-0 text-caption tabular-nums text-ink-3">
                      {formatDateCn(startDate + (group.dayIndex - 1) * DAY_MS)}
                    </span>
                  ) : null}
                  <span className="h-px flex-1 bg-line" />
                  <span className="shrink-0 text-caption tabular-nums text-ink-3">
                    {doneCount}/{group.items.length}
                  </span>
                  <button
                    type="button"
                    aria-label={`给第 ${group.dayIndex} 天添加安排`}
                    onClick={() => onAdd(group.dayIndex)}
                    className="press flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-accent"
                  >
                    <Plus size={13} />
                  </button>
                </div>

                <ul className="pl-1">
                  {group.items.map((plan, index) => (
                    <PlanRow
                      key={plan.id}
                      plan={plan}
                      last={index === group.items.length - 1}
                      onOpen={() => onOpen(plan.id)}
                      onToggle={() => onToggle(plan, !plan.done)}
                      onMoveUp={() => onMove(plan.id, -1)}
                      onMoveDown={() => onMove(plan.id, 1)}
                      onDelete={() => onDelete(plan)}
                      onRecord={() => onCreateMoment(plan)}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      <Sheet open={templateOpen} title="套用日程模板" onClose={() => setTemplateOpen(false)}>
        <div className="space-y-2">
          {PLAN_TEMPLATES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setTemplateOpen(false)
                onTemplate(item.key)
              }}
              className="press w-full rounded-2xl border border-line bg-surface p-3 text-left"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-body font-medium text-ink">{item.label}</span>
                <span className="shrink-0 text-caption text-ink-3">{item.items.length} 条</span>
              </span>
              <span className="mt-0.5 block text-note text-ink-3">{item.hint}</span>
            </button>
          ))}
          <p className="px-1 pt-1 text-caption leading-4 text-ink-3">
            模板只会补进已有的计划，不会覆盖你手动添加的内容。
          </p>
        </div>
      </Sheet>
    </div>
  )
}

function PlanRow({
  plan,
  last,
  onOpen,
  onToggle,
  onMoveUp,
  onMoveDown,
  onDelete,
  onRecord,
}: {
  plan: Plan
  last: boolean
  onOpen: () => void
  onToggle: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onRecord: () => void
}) {
  const color = PLAN_KIND_COLOR[plan.kind]
  return (
    <li className="group relative flex gap-2.5">
      <div className="flex w-[46px] shrink-0 justify-end pt-1.5">
        <span className={cn('text-caption tabular-nums', plan.done ? 'text-ink-3/70 line-through' : 'text-ink-3')}>
          {plan.time || '—'}
        </span>
      </div>

      <div className="relative flex w-3 shrink-0 flex-col items-center">
        <span
          className="mt-2 h-2 w-2 shrink-0 rounded-full ring-2 ring-surface"
          style={{ backgroundColor: plan.done ? 'var(--color-line)' : color }}
        />
        {!last ? <span className="mt-0.5 w-px flex-1 bg-line" /> : null}
      </div>

      <div className="min-w-0 flex-1 pb-3">
        <button type="button" onClick={onOpen} className="block w-full text-left">
          <span
            className={cn(
              'block truncate text-body font-medium',
              plan.done ? 'text-ink-3 line-through' : 'text-ink',
            )}
          >
            {plan.title}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-caption">
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5"
              style={{ backgroundColor: `${color}16`, color }}
            >
              <PlanGlyph kind={plan.kind} size={11} />
              {PLAN_KIND_LABEL[plan.kind]}
            </span>
            {plan.place ? <span className="truncate text-ink-3">{plan.place}</span> : null}
          </span>
          {plan.note ? (
            <span className="mt-1 block line-clamp-2 text-caption leading-4 text-ink-3">{plan.note}</span>
          ) : null}
        </button>
      </div>

      <div className="flex shrink-0 items-start gap-0.5 pt-1">
        {plan.done ? (
          <button
            type="button"
            aria-label="写一条记录"
            onClick={onRecord}
            className="press flex h-7 items-center gap-1 rounded-full border border-line px-2 text-caption text-ink-2 hover:text-accent"
          >
            <PencilSimple size={10} />
            记录
          </button>
        ) : null}
        <button
          type="button"
          aria-label={plan.done ? '标记为未完成' : '标记为完成'}
          onClick={onToggle}
          className={cn(
            'press flex h-7 w-7 items-center justify-center rounded-full border transition-colors',
            plan.done
              ? 'border-accent bg-accent text-white'
              : 'border-line bg-surface text-ink-3 hover:border-accent hover:text-accent',
          )}
        >
          {plan.done ? (
            <CalendarCheck size={13} weight="bold" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          )}
        </button>
        <div className="flex flex-col opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            aria-label="上移"
            onClick={onMoveUp}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:text-ink"
          >
            <CaretUp size={11} />
          </button>
          <button
            type="button"
            aria-label="下移"
            onClick={onMoveDown}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:text-ink"
          >
            <CaretDown size={11} />
          </button>
        </div>
        <button
          type="button"
          aria-label="删除计划"
          onClick={onDelete}
          className="flex h-7 w-6 items-center justify-center rounded text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
        >
          <Trash size={12} />
        </button>
      </div>
    </li>
  )
}

/* ---------------- 时间线 ---------------- */

function TimelineTab({
  groups,
  onAdd,
  onOpen,
  onPhoto,
}: {
  groups: Array<{ dayIndex: number; moments: Moment[] }>
  onAdd: () => void
  onOpen: (momentId: string) => void
  onPhoto: (moment: Moment, index: number) => void
}) {
  const [collapsed, setCollapsed] = useState<number[]>([])
  const toggle = (day: number) => {
    setCollapsed((previous) =>
      previous.includes(day) ? previous.filter((item) => item !== day) : [...previous, day],
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-note text-ink-3">
            {groups.length > 0 ? `${groups.length} 天有记录` : '还没有记录'}
          </span>
          {groups.length > 0 ? (
            <span className="flex items-end gap-[3px]" aria-hidden="true">
              {groups.map((group) => (
                <span
                  key={group.dayIndex}
                  className="w-1.5 rounded-sm bg-accent/60"
                  style={{ height: `${Math.min(4 + group.moments.length * 3, 16)}px` }}
                  title={`第 ${group.dayIndex} 天 · ${group.moments.length} 条`}
                />
              ))}
            </span>
          ) : null}
        </div>
        <button type="button" className="btn-ghost h-8 shrink-0 px-3 text-note" onClick={onAdd}>
          <Plus size={13} weight="bold" />
          添加记录
        </button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<EmptyArt variant="notebook" />}
          title="用照片和文字留住这一刻"
          hint="每条记录可以带最多 9 张照片，按天自动归组。"
          action={
            <button type="button" className="btn-primary mt-1" onClick={onAdd}>
              <Plus size={15} weight="bold" />
              写第一条记录
            </button>
          }
        />
      ) : (
        groups.map((group) => {
          const isCollapsed = collapsed.includes(group.dayIndex)
          return (
            <section key={group.dayIndex} className="space-y-2.5">
              <button
                type="button"
                onClick={() => toggle(group.dayIndex)}
                className="group flex w-full items-center gap-3 py-0.5 text-left"
                aria-expanded={!isCollapsed}
              >
                <span className="shrink-0 text-note font-medium text-accent">第 {group.dayIndex} 天</span>
                <span className="shrink-0 text-caption text-ink-3">{group.moments.length} 条</span>
                <span className="h-px flex-1 bg-line" />
                <CaretDown
                  size={13}
                  className={cn(
                    'shrink-0 text-ink-3 transition-transform duration-200',
                    isCollapsed && '-rotate-90',
                  )}
                />
              </button>
              {!isCollapsed ? (
                <div className="space-y-3">
                  {group.moments.map((moment) => (
                    <MomentCard
                      key={moment.id}
                      moment={moment}
                      onOpen={() => onOpen(moment.id)}
                      onPhoto={(index) => onPhoto(moment, index)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          )
        })
      )}
    </div>
  )
}

/* ---------------- 账本 ---------------- */

function LedgerTab({
  expenses,
  total,
  stats,
  onAdd,
  onOpen,
}: {
  expenses: Expense[]
  total: number
  stats: ReturnType<typeof categoryStats>
  onAdd: () => void
  onOpen: (expenseId: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="text-caption tracking-wide text-ink-3">总支出</p>
          <p className="mt-1 text-display font-semibold leading-none tabular-nums tracking-tight text-ink">
            <span className="mr-1 text-body-lg font-normal text-ink-3">¥</span>
            {formatMoney(total)}
          </p>
        </div>
        <button type="button" className="btn-ghost h-8 px-3 text-note" onClick={onAdd}>
          <Wallet size={13} />
          记一笔
        </button>
      </div>

      {stats.length > 0 ? (
        <div className="space-y-2.5">
          {stats.map((stat) => (
            <CategoryBar
              key={stat.category}
              label={CATEGORY_LABEL[stat.category]}
              color={CATEGORY_COLOR[stat.category]}
              amount={stat.amount}
              count={stat.count}
              ratio={stat.ratio}
            />
          ))}
        </div>
      ) : null}

      {expenses.length === 0 ? (
        <EmptyState
          icon={<EmptyArt variant="wallet" />}
          title="这趟旅程还没有账目"
          hint="记下车票、住宿和一顿夜宵，回程就知道钱花在哪了。"
          action={
            <button type="button" className="btn-primary mt-1" onClick={onAdd}>
              <Plus size={15} weight="bold" />
              记第一笔
            </button>
          }
        />
      ) : (
        <div className="divide-y divide-line">
          {expenses.map((expense) => (
            <ExpenseRow key={expense.id} expense={expense} onOpen={() => onOpen(expense.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------------- 清单 ---------------- */

function ChecklistTab({
  items,
  progress,
  value,
  onChange,
  onAdd,
  onToggle,
  onDelete,
  onTemplate,
}: {
  items: ChecklistItem[]
  progress: { done: number; total: number }
  value: string
  onChange: (value: string) => void
  onAdd: () => void
  onToggle: (item: ChecklistItem, done: boolean) => void
  onDelete: (item: ChecklistItem) => void
  onTemplate: () => void
}) {
  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between text-note text-ink-3">
        <span>
          已完成 {progress.done}/{progress.total}
        </span>
        <button
          type="button"
          onClick={onTemplate}
          className="press rounded-full border border-line px-2.5 py-1 text-caption text-ink-2 hover:text-ink"
        >
          套用模板
        </button>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          onAdd()
        }}
      >
        <input
          className="input"
          placeholder="添加一项待办，比如「提前买好 JR Pass」"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="submit" className="btn-primary h-[46px] shrink-0 px-4">
          <Plus size={15} weight="bold" />
          添加
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState icon={<Plus size={20} />} title="清单是空的" hint="出发前把要带的东西都勾上。" />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              onToggle={(done) => onToggle(item, done)}
              onDelete={() => onDelete(item)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------------- 旅伴 ---------------- */

function MembersTab({
  members,
  inviteCode,
  value,
  onChange,
  onAdd,
  onRemove,
  onCopy,
}: {
  members: Member[]
  inviteCode: string
  value: string
  onChange: (value: string) => void
  onAdd: () => void
  onRemove: (member: Member) => void
  onCopy: () => void
}) {
  return (
    <div className="space-y-3.5">
      <button
        type="button"
        onClick={onCopy}
        className="press flex w-full items-center justify-between rounded-2xl border border-line bg-paper-2 px-3.5 py-3 text-left"
      >
        <span>
          <span className="block text-caption text-ink-3">邀请码</span>
          <span className="mt-0.5 block font-mono text-title tracking-[0.2em] text-ink">{inviteCode}</span>
        </span>
        <Copy size={15} className="text-ink-3" />
      </button>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          onAdd()
        }}
      >
        <input
          className="input"
          placeholder="旅伴昵称"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="submit" className="btn-primary h-[46px] shrink-0 px-4">
          <Plus size={15} weight="bold" />
          添加
        </button>
      </form>

      {members.length === 0 ? (
        <EmptyState icon={<UsersThree size={20} />} title="还没有旅伴" hint="添加同行的人，一起编辑这段旅程。" />
      ) : (
        <div className="space-y-2">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              onRemove={member.role === 'owner' ? undefined : () => onRemove(member)}
            />
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface p-3.5">
        <p className="flex items-center gap-2 text-note font-medium text-ink">
          <Avatar name="云端" size={22} />
          多人同步
        </p>
        <p className="mt-1.5 text-note leading-4 text-ink-3">
          当前为本地档案，成员与邀请码保存在本机。接入后端后，旅伴可通过邀请码加入并实时同步。
        </p>
      </div>
    </div>
  )
}