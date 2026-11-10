import { useCallback, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarBlank,
  Copy,
  MapPin,
  PencilSimple,
  Plus,
  Trash,
  UsersThree,
  Wallet,
} from '@phosphor-icons/react'
import type { ChecklistItem, Expense, Member, Moment, TabKey, Trip } from '../lib/types'
import {
  addMember,
  categoryStats,
  checklistProgress,
  deleteChecklistItem,
  deleteTrip,
  getTrip,
  groupMoments,
  listChecklist,
  listExpenses,
  listMembers,
  listMoments,
  removeMember,
  saveChecklistItem,
  sumExpense,
} from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useNav, useRefresh, useToast } from '../lib/app-context'
import {
  copyText,
  coverClass,
  formatDate,
  formatMoney,
  tripDayCount,
  tripStatusOf,
  STATUS_LABEL,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { CategoryBar, ChecklistRow, ExpenseRow, MemberRow, MomentCard } from '../components/cards'
import { Avatar, ConfirmDialog, EmptyState, IconButton, SegmentedTabs, SkeletonList, StatTile } from '../components/ui'
import { CATEGORY_LABEL, CATEGORY_COLOR } from '../lib/utils'

interface DetailData {
  trip: Trip | undefined
  moments: Moment[]
  expenses: Expense[]
  checklist: ChecklistItem[]
  members: Member[]
}

const EMPTY: DetailData = {
  trip: undefined,
  moments: [],
  expenses: [],
  checklist: [],
  members: [],
}

const TAB_OPTIONS: Array<{ value: TabKey; label: string }> = [
  { value: 'timeline', label: '时间线' },
  { value: 'ledger', label: '账本' },
  { value: 'checklist', label: '清单' },
  { value: 'members', label: '旅伴' },
]

export function TripDetailPage({ tripId, tab }: { tripId: string; tab: TabKey }) {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const [newCheck, setNewCheck] = useState('')
  const [newMember, setNewMember] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const loader = useCallback(async (): Promise<DetailData> => {
    const [trip, moments, expenses, checklist, members] = await Promise.all([
      getTrip(tripId),
      listMoments(tripId),
      listExpenses(tripId),
      listChecklist(tripId),
      listMembers(tripId),
    ])
    return { trip, moments, expenses, checklist, members }
  }, [tripId])

  const { data, loading } = useLoader(loader, EMPTY, tripId)
  const { trip, moments, expenses, checklist, members } = data

  const groups = useMemo(() => groupMoments(moments), [moments])
  const progress = checklistProgress(checklist)
  const stats = useMemo(() => categoryStats(expenses), [expenses])
  const total = sumExpense(expenses)

  const switchTab = (next: TabKey) => nav.navigate({ name: 'trip', id: tripId, tab: next })

  const addChecklist = async () => {
    const title = newCheck.trim()
    if (!title) {
      toast('先写点什么，再添加')
      return
    }
    const item: ChecklistItem = {
      id: '',
      tripId,
      title,
      done: false,
      createdAt: Date.now(),
    }
    await saveChecklistItem(item)
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
        <span className="min-w-0 truncate text-[12px] text-ink-3">
          行程 / <span className="text-ink-2">{trip.title}</span>
        </span>
      </div>

      <section className={cn('relative mt-3 overflow-hidden rounded-[1.6rem] p-5 text-white', coverClass(trip.cover))}>
        <span className="cover-texture pointer-events-none absolute inset-0" />
        <div className="relative flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-medium tracking-wide',
              status === 'ongoing' ? 'bg-accent text-white' : 'bg-white/14 text-white/85',
            )}
          >
            {STATUS_LABEL[status]}
          </span>
          {days > 0 ? (
            <span className="text-[11.5px] text-white/60">共 {days} 天</span>
          ) : null}
        </div>
        <h1 className="relative mt-8 max-w-[22ch] text-[25px] font-semibold leading-tight tracking-tight sm:text-[30px]">
          {trip.title || '未命名旅程'}
        </h1>
        <div className="relative mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/70">
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
          <p className="relative mt-3 max-w-[60ch] text-[12.5px] leading-5 text-white/65">{trip.note}</p>
        ) : null}
        <button
          type="button"
          onClick={() => nav.navigate({ name: 'tripEditor', id: trip.id })}
          className="press absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/14 px-3 py-1.5 text-[11.5px] text-white backdrop-blur-sm"
        >
          <PencilSimple size={13} />
          编辑
        </button>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-4 border-y border-line py-4 lg:hidden">
        <StatTile label="图文记录" value={`${moments.length} 条`} />
        <StatTile label="花费合计" value={`¥${formatMoney(total)}`} />
        <StatTile label="清单完成" value={`${progress.done}/${progress.total}`} />
        <StatTile label="同行旅伴" value={`${members.length} 人`} />
      </div>

      <div className="mt-4 lg:grid lg:grid-cols-[1.7fr_1fr] lg:gap-6">
        <div className="min-w-0">
          <SegmentedTabs value={tab} options={TAB_OPTIONS} onChange={switchTab} className="max-w-[420px]" />

          <div className="mt-4">
            {tab === 'timeline' ? (
              <TimelineTab
                groups={groups}
                onAdd={() => nav.navigate({ name: 'momentEditor', tripId })}
                onOpen={(momentId) => nav.navigate({ name: 'momentEditor', tripId, momentId })}
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
            <h2 className="text-[12px] font-semibold tracking-tight text-ink">旅程概览</h2>
            <dl className="mt-3 space-y-2.5 text-[12.5px]">
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
          </div>

          <div className="card p-4">
            <h2 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-tight text-ink">
              <UsersThree size={14} />
              一起编辑
            </h2>
            <p className="mt-1.5 text-[11.5px] leading-4 text-ink-3">
              把邀请码发给旅伴。本地模式下会先记录在设备上，接入云端后即可同步。
            </p>
            <button
              type="button"
              onClick={copyInvite}
              className="press mt-3 flex w-full items-center justify-between rounded-xl border border-line bg-paper-2 px-3 py-2.5 text-left"
            >
              <span className="font-mono text-[15px] tracking-[0.18em] text-ink">{trip.inviteCode}</span>
              <Copy size={14} className="text-ink-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="press flex w-full items-center justify-center gap-1.5 rounded-full border border-line py-2.5 text-[12.5px] text-ink-3 hover:text-danger"
          >
            <Trash size={14} />
            删除这段旅程
          </button>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="删除这段旅程？"
        message="旅程下的图文、账目、清单与足迹都会一并删除，且无法恢复。"
        onConfirm={doDeleteTrip}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}

function TimelineTab({
  groups,
  onAdd,
  onOpen,
}: {
  groups: Array<{ dayIndex: number; moments: Moment[] }>
  onAdd: () => void
  onOpen: (momentId: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-ink-3">
          {groups.length > 0 ? `${groups.length} 天有记录` : '还没有记录'}
        </span>
        <button type="button" className="btn-ghost h-8 px-3 text-[12px]" onClick={onAdd}>
          <Plus size={13} weight="bold" />
          添加记录
        </button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<PencilSimple size={20} />}
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
        groups.map((group) => (
          <section key={group.dayIndex} className="space-y-2.5">
            <div className="flex items-center gap-3">
              <span className="text-[12px] font-medium text-accent">
                第 {group.dayIndex} 天
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="space-y-3">
              {group.moments.map((moment) => (
                <MomentCard key={moment.id} moment={moment} onOpen={() => onOpen(moment.id)} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

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
          <p className="text-[11px] tracking-wide text-ink-3">总支出</p>
          <p className="mt-1 text-[30px] font-semibold leading-none tabular-nums tracking-tight text-ink">
            <span className="mr-1 text-[15px] font-normal text-ink-3">¥</span>
            {formatMoney(total)}
          </p>
        </div>
        <button type="button" className="btn-ghost h-8 px-3 text-[12px]" onClick={onAdd}>
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
          icon={<Wallet size={20} />}
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
            <ExpenseRow
              key={expense.id}
              expense={expense}
              onOpen={() => onOpen(expense.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ChecklistTab({
  items,
  progress,
  value,
  onChange,
  onAdd,
  onToggle,
  onDelete,
}: {
  items: ChecklistItem[]
  progress: { done: number; total: number }
  value: string
  onChange: (value: string) => void
  onAdd: () => void
  onToggle: (item: ChecklistItem, done: boolean) => void
  onDelete: (item: ChecklistItem) => void
}) {
  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between text-[11.5px] text-ink-3">
        <span>
          已完成 {progress.done}/{progress.total}
        </span>
        {progress.total > 0 ? (
          <span className="tabular-nums">{Math.round((progress.done / progress.total) * 100)}%</span>
        ) : null}
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
          <span className="block text-[11px] text-ink-3">邀请码</span>
          <span className="mt-0.5 block font-mono text-[16px] tracking-[0.2em] text-ink">{inviteCode}</span>
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
        <p className="flex items-center gap-2 text-[12px] font-medium text-ink">
          <Avatar name="云端" size={22} />
          多人同步
        </p>
        <p className="mt-1.5 text-[11.5px] leading-4 text-ink-3">
          当前为本地档案，成员与邀请码保存在本机。接入后端后，旅伴可通过邀请码加入并实时同步。
        </p>
      </div>
    </div>
  )
}

