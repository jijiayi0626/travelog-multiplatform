import { useCallback, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarBlank,
  CalendarCheck,
  CaretDown,
  CaretUp,
  Copy,
  DotsThree,
  DownloadSimple,
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
  groupPlans,
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
  savePlan,
  sumExpenseCny,
  togglePlan,
  CHECKLIST_TEMPLATES,
  PLAN_TEMPLATES,
} from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { answerTripQuestion, generatePlan, generatePackingList } from '../lib/ai'
import { useNav, useRefresh, useI18n, useToast } from '../lib/app-context'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  PLAN_KIND_COLOR,
  PLAN_KIND_LABEL,
  STATUS_LABEL,
  copyText,
  coverClass,
  dayIndexOfDate,
  downloadText,
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
  const { tr } = useI18n()
  const [newCheck, setNewCheck] = useState('')
  const [newMember, setNewMember] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [aiPackingBusy, setAiPackingBusy] = useState(false)
  const [qaOpen, setQaOpen] = useState(false)
  const [qaText, setQaText] = useState('')
  const [qaAnswer, setQaAnswer] = useState('')
  const [qaBusy, setQaBusy] = useState(false)
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
      toast(tr('先写点什么，再添加'))
      return
    }
    await saveChecklistItem({ id: '', tripId, title, done: false, createdAt: Date.now() })
    setNewCheck('')
    bump()
  }

  const aiPacking = async () => {
    if (aiPackingBusy || !trip) return
    setAiPackingBusy(true)
    try {
      const month = trip.startDate > 0 ? new Date(trip.startDate).getMonth() + 1 : undefined
      const items = await generatePackingList({
        destination: trip.destination || trip.title,
        days: tripDayCount(trip.startDate, trip.endDate),
        month,
        note: trip.note,
      })
      const existing = new Set(checklist.map((item) => item.title))
      let added = 0
      for (const title of items) {
        if (existing.has(title)) continue
        existing.add(title)
        await saveChecklistItem({ id: '', tripId, title, done: false, createdAt: Date.now() + added })
        added += 1
      }
      bump()
      toast(added > 0 ? tr('已生成 {n} 项', { n: added }) : tr('清单里已经有这些了'))
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('生成失败'))
    } finally {
      setAiPackingBusy(false)
    }
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
      toast(tr('请输入旅伴昵称'))
      return
    }
    await addMember(tripId, name)
    setNewMember('')
    bump()
    toast(tr('已把 {name} 加入旅程', { name }))
  }

  const copyInvite = async () => {
    if (!trip) return
    const ok = await copyText(trip.inviteCode)
    toast(ok ? tr('邀请码已复制') : tr('复制失败，请手动记录'))
  }

  const exportMarkdown = () => {
    const md: string[] = []
    md.push(`# ${trip?.title || '未命名旅程'}`, '')
    md.push(
      `> ${trip?.destination || '目的地待定'} · ${formatDate(trip?.startDate ?? 0)} — ${formatDate(trip?.endDate ?? 0)}`,
    )
    if (trip?.note) md.push('', trip.note)
    md.push('')
    md.push(`- 行程天数：${days} 天`)
    md.push(`- 日程完成：${planProgress.done}/${planProgress.total}`)
    md.push(`- 花费合计：¥${formatMoney(total)}`)
    if (trip?.budget) md.push(`- 预算：¥${formatMoney(trip.budget)}`)
    if (trip?.inviteCode) md.push(`- 邀请码：${trip.inviteCode}`)

    if (plans.length > 0) {
      md.push('', '## 日程')
      for (const group of groupPlans(plans)) {
        md.push('', `### 第 ${group.dayIndex} 天`)
        for (const plan of group.plans) {
          const time = plan.time ? `${plan.time} ` : ''
          const place = plan.place ? `（${plan.place}）` : ''
          md.push(`- ${plan.done ? '[x]' : '[ ]'} ${time}${plan.title}${place}`)
        }
      }
    }

    if (moments.length > 0) {
      md.push('', '## 记录')
      for (const group of groups) {
        for (const moment of group.moments) {
          md.push('', `### 第 ${group.dayIndex} 天 · ${moment.locationName || '未标注地点'}`, '', moment.content)
          if (moment.photos.length > 0) {
            md.push('', `> ${moment.photos.length} 张照片已存于应用内`)
          }
        }
      }
    }

    if (expenses.length > 0) {
      md.push('', '## 账本')
      for (const expense of expenses) {
        md.push(
          `- ${expense.note || CATEGORY_LABEL[expense.category]} — ¥${formatMoney(expense.amount)}`,
        )
      }
    }

    if (checklist.length > 0) {
      md.push('', '## 清单')
      for (const item of checklist) {
        md.push(`- ${item.done ? '[x]' : '[ ]'} ${item.title}`)
      }
    }

    downloadText(`${trip?.title || 'trip'}.md`, md.join('\n'), 'text/markdown;charset=utf-8')
    toast(tr('Markdown 已导出'))
  }

  const copyTrip = async () => {
    const copy = await duplicateTrip(tripId)
    if (!copy) return
    bump()
    toast(tr('旅程已复制（含清单与日程）'))
    nav.navigate({ name: 'trip', id: copy.id, tab: 'plan' })
  }

  const doDeleteTrip = async () => {
    await deleteTrip(tripId)
    bump()
    toast(tr('旅程已删除'))
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
          title={tr('这段旅程不存在了')}
          hint={tr('可能已被删除，回到列表看看其他旅程。')}
          action={
            <button type="button" className="btn-ghost mt-1" onClick={() => nav.navigate({ name: 'trips' })}>
              {tr('回到行程')}
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
        <IconButton label={tr('返回')} onClick={() => nav.navigate({ name: 'trips' })}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="min-w-0 truncate text-note text-ink-3">
          {tr('行程')} / <span className="text-ink-2">{trip.title}</span>
        </span>
        <button
          type="button"
          onClick={exportMarkdown}
          aria-label={tr('导出为 Markdown')}
          className="press ml-auto hidden h-8 shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 text-caption text-ink-2 hover:text-ink sm:flex"
        >
          <DownloadSimple size={13} />
          {tr('导出')}
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={tr('更多操作')}
          className="press ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 hover:text-ink sm:ml-1"
        >
          <DotsThree size={18} weight="bold" />
        </button>
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
            {tr(STATUS_LABEL[status])}
          </span>
          {days > 0 ? <span className="text-note text-[var(--on-cover-muted)]">{tr('共 {n} 天', { n: days })}</span> : null}
        </div>
        <h1 className="relative mt-8 max-w-[22ch] text-heading font-semibold leading-tight tracking-tight sm:text-display">
          {trip.title || tr('未命名旅程')}
        </h1>
        <div className="relative mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-note text-[var(--on-cover-muted)]">
          <span className="inline-flex items-center gap-1">
            <MapPin size={13} />
            {trip.destination || tr('目的地待定')}
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
          {tr('编辑')}
        </button>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-4 border-y border-line py-4 lg:hidden">
        <StatTile
          label={tr('日程')}
          value={`${planProgress.done}/${planProgress.total}`}
          sub={planProgress.total > 0 ? tr('已完成') : tr('待安排')}
        />
        <StatTile label={tr('图文记录')} value={tr('{n} 条', { n: moments.length })} />
        <StatTile label={tr('花费合计')} value={`¥${formatMoney(total)}`} />
        <StatTile label={tr('同行旅伴')} value={tr('{n} 人', { n: members.length })} />
      </div>

      {trip.budget && trip.budget > 0 ? (
        <div className="mt-3 lg:hidden">
          <BudgetBar spent={total} budget={trip.budget} />
        </div>
      ) : null}

      <div className="mt-4 lg:grid lg:grid-cols-[1.7fr_1fr] lg:gap-6">
        <div className="min-w-0">
          <SegmentedTabs
            value={tab}
            options={TAB_OPTIONS.map((option) => ({ ...option, label: tr(option.label) }))}
            onChange={switchTab}
            className="max-w-[480px]"
          />

          <div className="mt-4">
            {tab === 'plan' ? (
              <PlanTab
                plans={plans}
                startDate={trip.startDate}
                endDate={trip.endDate}
                dayCount={days}
                destination={trip.destination || trip.title}
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
                  toast(tr('计划已删除'))
                }}
                onTemplate={async (key) => {
                  const added = await applyPlanTemplate(tripId, key, days)
                  bump()
                  toast(
                    added > 0
                      ? tr('已排入 {n} 条日程', { n: added })
                      : tr('模板内容已在日程里'),
                  )
                }}
                onAIPlan={async (style) => {
                  const items = await generatePlan({
                    destination: trip.destination || trip.title,
                    days: Math.max(days, 1),
                    style,
                    budget: trip.budget ? `¥${trip.budget}` : undefined,
                  })
                  for (const item of items) {
                    await savePlan({
                      id: '',
                      tripId,
                      dayIndex: item.dayIndex,
                      time: item.time,
                      title: item.title,
                      place: item.place,
                      kind: item.kind,
                      note: item.note,
                      done: false,
                      order: Number.NaN,
                      createdAt: 0,
                    })
                  }
                  bump()
                  toast(tr('AI 已排入 {n} 条日程', { n: items.length }))
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
                onAIGenerate={aiPacking}
                aiBusy={aiPackingBusy}
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
            <h2 className="text-note font-semibold tracking-tight text-ink">{tr('旅程概览')}</h2>
            <dl className="mt-3 space-y-2.5 text-body-sm">
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">{tr('日程完成')}</dt>
                <dd className="tabular-nums text-ink">
                  {planProgress.done}/{planProgress.total}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">{tr('图文记录')}</dt>
                <dd className="tabular-nums text-ink">{moments.length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">{tr('花费合计')}</dt>
                <dd className="tabular-nums text-ink">¥ {formatMoney(total)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">{tr('清单完成')}</dt>
                <dd className="tabular-nums text-ink">
                  {progress.done}/{progress.total}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">{tr('旅伴')}</dt>
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
              {tr('一起编辑')}
            </h2>
            <p className="mt-1.5 text-note leading-4 text-ink-3">
              {tr('把邀请码发给旅伴。本地模式下会先记录在设备上，接入云端后即可同步。')}
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
            {tr('复制这段旅程')}
          </button>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="press flex w-full items-center justify-center gap-1.5 rounded-full border border-line py-2.5 text-body-sm text-ink-3 hover:text-danger"
          >
            <Trash size={14} />
            {tr('删除这段旅程')}
          </button>
        </aside>
      </div>

      <Sheet open={menuOpen} title={tr('旅程操作')} onClose={() => setMenuOpen(false)}>
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              nav.navigate({ name: 'tripEditor', id: trip.id })
            }}
            className="press flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left text-body text-ink hover:bg-paper-2"
          >
            <PencilSimple size={16} className="text-ink-3" />
            {tr('编辑旅程')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              exportMarkdown()
            }}
            className="press flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left text-body text-ink hover:bg-paper-2"
          >
            <DownloadSimple size={16} className="text-ink-3" />
            {tr('导出 Markdown')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              copyTrip()
            }}
            className="press flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left text-body text-ink hover:bg-paper-2"
          >
            <Copy size={16} className="text-ink-3" />
            {tr('复制这段旅程')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              setQaOpen(true)
            }}
            className="press flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left text-body text-ink hover:bg-paper-2"
          >
            <Sparkle size={16} className="text-ink-3" />
            {tr('问问 AI')}
          </button>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              setConfirmDelete(true)
            }}
            className="press flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left text-body text-danger hover:bg-danger/10"
          >
            <Trash size={16} />
            {tr('删除这段旅程')}
          </button>
        </div>
      </Sheet>

      <Sheet open={qaOpen} title={tr('问问 AI')} onClose={() => setQaOpen(false)}>
        <div className="space-y-3">
          <p className="text-note leading-5 text-ink-3">
            {tr('只根据这趟旅程的数据回答，数据里没有的会直说不知道。需要先登录云同步。')}
          </p>
          <div className="flex gap-2">
            <input
              className="input"
              value={qaText}
              placeholder={tr('例如「这趟花了多少」「哪天花得最多」')}
              onChange={(event) => setQaText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !qaBusy) {
                  event.currentTarget.blur()
                  void (async () => {
                    setQaBusy(true)
                    setQaAnswer('')
                    try {
                      const byCategory = stats
                        .map((item) => `${tr(CATEGORY_LABEL[item.category])} ${formatMoney(item.amount)}`)
                        .join('、')
                      const context = [
                        `旅程：${trip.title}`,
                        `目的地：${trip.destination || '未填'}`,
                        `日期：${formatDate(trip.startDate)} — ${formatDate(trip.endDate)}（${days} 天）`,
                        `日程：共 ${planProgress.total} 条，已完成 ${planProgress.done} 条`,
                        `图文记录：${moments.length} 条`,
                        `花费合计：${formatMoney(total)}${byCategory ? `（${byCategory}）` : ''}`,
                        trip.budget ? `预算：${formatMoney(trip.budget)}` : '',
                      ]
                        .filter(Boolean)
                        .join('\n')
                      setQaAnswer(await answerTripQuestion(context, qaText))
                    } catch (error) {
                      toast(error instanceof Error ? error.message : tr('生成失败'))
                    } finally {
                      setQaBusy(false)
                    }
                  })()
                }
              }}
            />
            <button
              type="button"
              className="btn-primary h-[46px] shrink-0 px-4"
              disabled={qaBusy}
              onClick={async () => {
                setQaBusy(true)
                setQaAnswer('')
                try {
                  const byCategory = stats
                    .map((item) => `${tr(CATEGORY_LABEL[item.category])} ${formatMoney(item.amount)}`)
                    .join('、')
                  const context = [
                    `旅程：${trip.title}`,
                    `目的地：${trip.destination || '未填'}`,
                    `日期：${formatDate(trip.startDate)} — ${formatDate(trip.endDate)}（${days} 天）`,
                    `日程：共 ${planProgress.total} 条，已完成 ${planProgress.done} 条`,
                    `图文记录：${moments.length} 条`,
                    `花费合计：${formatMoney(total)}${byCategory ? `（${byCategory}）` : ''}`,
                    trip.budget ? `预算：${formatMoney(trip.budget)}` : '',
                  ]
                    .filter(Boolean)
                    .join('\n')
                  setQaAnswer(await answerTripQuestion(context, qaText))
                } catch (error) {
                  toast(error instanceof Error ? error.message : tr('生成失败'))
                } finally {
                  setQaBusy(false)
                }
              }}
            >
              {qaBusy ? tr('思考中…') : tr('提问')}
            </button>
          </div>
          {qaAnswer ? (
            <p className="rounded-xl bg-accent-soft/60 px-3 py-2.5 text-body-sm leading-6 text-ink">{qaAnswer}</p>
          ) : null}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        title={tr('删除这段旅程？')}
        message={tr('旅程下的日程、图文、账目、清单与足迹都会一并删除，且无法恢复。')}
        onConfirm={doDeleteTrip}
        onClose={() => setConfirmDelete(false)}
      />

      <Sheet
        open={checklistTemplateOpen}
        title={tr('套用清单模板')}
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
                toast(
                  added > 0 ? tr('已添加 {n} 项', { n: added }) : tr('模板内容已在清单里'),
                )
              }}
              className="press w-full rounded-2xl border border-line bg-surface p-3 text-left"
            >
              <span className="block text-body font-medium text-ink">{tr(item.label)}</span>
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
  destination,
  onAdd,
  onOpen,
  onToggle,
  onMove,
  onDelete,
  onTemplate,
  onAIPlan,
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
  onAIPlan: (style: string) => Promise<void>
  onCreateMoment: (plan: Plan) => void
  destination: string
}) {
  const { tr } = useI18n()
  const toast = useToast()
  const [templateOpen, setTemplateOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiStyle, setAiStyle] = useState('轻松')
  const [aiBusy, setAiBusy] = useState(false)
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
            onClick={() => setAiOpen(true)}
            aria-label={tr('让 AI 排一份行程')}
            className="press inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-note text-accent hover:border-accent"
          >
            <Sparkle size={12} weight="fill" />
            {tr('AI')}
          </button>
          <button
            type="button"
            onClick={() => setTemplateOpen(true)}
            className="press rounded-full border border-line px-2.5 py-1.5 text-note text-ink-2 hover:text-ink"
          >
            {tr('套用模板')}
          </button>
          <button type="button" className="btn-ghost h-8 px-3 text-note" onClick={() => onAdd(defaultDay)}>
            <Plus size={13} weight="bold" />
            {tr('添加')}
          </button>
        </div>
      </div>

      {plans.length > 0 ? (
        <div className="rounded-xl border border-line bg-surface px-3 pb-2 pt-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-caption tracking-wide text-ink-3">{tr('每日安排密度')}</span>
            <span className="text-caption text-ink-3">{tr('{n} 天', { n: dayCount })}</span>
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
          title={tr('还没有排日程')}
          hint={tr('按天排好要去的地方、吃的东西和住的地方，出发后一条条勾掉。')}
          action={
            <div className="mt-1 flex gap-2">
              <button type="button" className="btn-primary" onClick={() => onAdd(defaultDay)}>
                <Plus size={15} weight="bold" />
                {tr('添加第一条')}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setTemplateOpen(true)}>
                {tr('套用模板')}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setAiOpen(true)}>
                <Sparkle size={14} weight="fill" />
                {tr('AI 排行程')}
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
                  <h3 className="shrink-0 text-body-sm font-semibold text-accent">{tr('第 {n} 天', { n: group.dayIndex })}</h3>
                  {isToday ? (
                    <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-caption font-medium text-white">
                      {tr('今天')}
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
                    aria-label={tr('给第 {n} 天添加安排', { n: group.dayIndex })}
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

      <Sheet open={aiOpen} title={tr('让 AI 排一份行程')} onClose={() => setAiOpen(false)}>
        <div className="space-y-3">
          <p className="text-note leading-5 text-ink-3">
            {tr('根据目的地「{dest}」和 {n} 天行程生成逐日安排，生成后仍可逐条修改。', {
              dest: destination || tr('未填写'),
              n: dayCount,
            })}
          </p>
          <div className="space-y-1.5">
            <span className="field-label">{tr('偏好')}</span>
            <div className="flex flex-wrap gap-1.5">
              {['轻松', '紧凑', '亲子', '美食', '摄影', '人文'].map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setAiStyle(style)}
                  className={cn('chip px-2.5 py-1 text-note', aiStyle === style && 'chip-active')}
                >
                  {tr(style)}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="btn-primary w-full"
            disabled={aiBusy}
            onClick={async () => {
              setAiBusy(true)
              try {
                await onAIPlan(aiStyle)
                setAiOpen(false)
              } catch (error) {
                toast(error instanceof Error ? error.message : tr('生成失败'))
              } finally {
                setAiBusy(false)
              }
            }}
          >
            <Sparkle size={15} weight="fill" />
            {aiBusy ? tr('生成中…') : tr('生成行程')}
          </button>
          <p className="text-caption leading-4 text-ink-3">
            {tr('需要先在「我的 → 云同步」登录，并由服务端配置 Workers AI 或 OpenAI 密钥。')}
          </p>
        </div>
      </Sheet>

      <Sheet open={templateOpen} title={tr('套用日程模板')} onClose={() => setTemplateOpen(false)}>
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
                <span className="text-body font-medium text-ink">{tr(item.label)}</span>
                <span className="shrink-0 text-caption text-ink-3">{tr('{n} 条', { n: item.items.length })}</span>
              </span>
              <span className="mt-0.5 block text-note text-ink-3">{tr(item.hint)}</span>
            </button>
          ))}
          <p className="px-1 pt-1 text-caption leading-4 text-ink-3">
            {tr('模板只会补进已有的计划，不会覆盖你手动添加的内容。')}
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
  const { tr } = useI18n()
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
              {tr(PLAN_KIND_LABEL[plan.kind])}
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
            aria-label={tr('写一条记录')}
            onClick={onRecord}
            className="press flex h-7 items-center gap-1 rounded-full border border-line px-2 text-caption text-ink-2 hover:text-accent"
          >
            <PencilSimple size={10} />
            {tr('记录')}
          </button>
        ) : null}
        <button
          type="button"
          aria-label={plan.done ? tr('标记为未完成') : tr('标记为完成')}
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
            aria-label={tr('上移')}
            onClick={onMoveUp}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:text-ink"
          >
            <CaretUp size={11} />
          </button>
          <button
            type="button"
            aria-label={tr('下移')}
            onClick={onMoveDown}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:text-ink"
          >
            <CaretDown size={11} />
          </button>
        </div>
        <button
          type="button"
          aria-label={tr('删除计划')}
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
  const { tr } = useI18n()
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
            {groups.length > 0 ? tr('{n} 天有记录', { n: groups.length }) : tr('还没有记录')}
          </span>
          {groups.length > 0 ? (
            <span className="flex items-end gap-[3px]" aria-hidden="true">
              {groups.map((group) => (
                <span
                  key={group.dayIndex}
                  className="w-1.5 rounded-sm bg-accent/60"
                  style={{ height: `${Math.min(4 + group.moments.length * 3, 16)}px` }}
                  title={tr('第 {n} 天 · {v} 条', { n: group.dayIndex, v: group.moments.length })}
                />
              ))}
            </span>
          ) : null}
        </div>
        <button type="button" className="btn-ghost h-8 shrink-0 px-3 text-note" onClick={onAdd}>
          <Plus size={13} weight="bold" />
          {tr('添加记录')}
        </button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<EmptyArt variant="notebook" />}
          title={tr('用照片和文字留住这一刻')}
          hint={tr('每条记录可以带最多 9 张照片，按天自动归组。')}
          action={
            <button type="button" className="btn-primary mt-1" onClick={onAdd}>
              <Plus size={15} weight="bold" />
              {tr('写第一条记录')}
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
                <span className="shrink-0 text-note font-medium text-accent">{tr('第 {n} 天', { n: group.dayIndex })}</span>
                <span className="shrink-0 text-caption text-ink-3">{tr('{n} 条', { n: group.moments.length })}</span>
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
  const { tr } = useI18n()
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="text-caption tracking-wide text-ink-3">{tr('总支出')}</p>
          <p className="mt-1 text-display font-semibold leading-none tabular-nums tracking-tight text-ink">
            <span className="mr-1 text-body-lg font-normal text-ink-3">¥</span>
            {formatMoney(total)}
          </p>
        </div>
        <button type="button" className="btn-ghost h-8 px-3 text-note" onClick={onAdd}>
          <Wallet size={13} />
          {tr('记一笔')}
        </button>
      </div>

      {stats.length > 0 ? (
        <div className="space-y-2.5">
          {stats.map((stat) => (
            <CategoryBar
              key={stat.category}
              label={tr(CATEGORY_LABEL[stat.category])}
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
          title={tr('这趟旅程还没有账目')}
          hint={tr('记下车票、住宿和一顿夜宵，回程就知道钱花在哪了。')}
          action={
            <button type="button" className="btn-primary mt-1" onClick={onAdd}>
              <Plus size={15} weight="bold" />
              {tr('记第一笔')}
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
  onAIGenerate,
  aiBusy,
}: {
  items: ChecklistItem[]
  progress: { done: number; total: number }
  value: string
  onChange: (value: string) => void
  onAdd: () => void
  onToggle: (item: ChecklistItem, done: boolean) => void
  onDelete: (item: ChecklistItem) => void
  onTemplate: () => void
  onAIGenerate: () => void
  aiBusy: boolean
}) {
  const { tr } = useI18n()
  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between text-note text-ink-3">
        <span>
          {tr('已完成 {done}/{total}', { done: progress.done, total: progress.total })}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onAIGenerate}
            disabled={aiBusy}
            className="press inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-1 text-caption text-accent hover:border-accent disabled:opacity-60"
          >
            <Sparkle size={12} weight="fill" />
            {aiBusy ? tr('生成中…') : tr('AI 打包')}
          </button>
          <button
            type="button"
            onClick={onTemplate}
            className="press rounded-full border border-line px-2.5 py-1 text-caption text-ink-2 hover:text-ink"
          >
            {tr('套用模板')}
          </button>
        </div>
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
          placeholder={tr('添加一项待办，比如「提前买好 JR Pass」')}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="submit" className="btn-primary h-[46px] shrink-0 px-4">
          <Plus size={15} weight="bold" />
          {tr('添加')}
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          icon={<Plus size={20} />}
          title={tr('清单是空的')}
          hint={tr('出发前把要带的东西都勾上。')}
        />
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
  const { tr } = useI18n()
  return (
    <div className="space-y-3.5">
      <button
        type="button"
        onClick={onCopy}
        className="press flex w-full items-center justify-between rounded-2xl border border-line bg-paper-2 px-3.5 py-3 text-left"
      >
        <span>
          <span className="block text-caption text-ink-3">{tr('邀请码')}</span>
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
          placeholder={tr('旅伴昵称')}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="submit" className="btn-primary h-[46px] shrink-0 px-4">
          <Plus size={15} weight="bold" />
          {tr('添加')}
        </button>
      </form>

      {members.length === 0 ? (
        <EmptyState
          icon={<UsersThree size={20} />}
          title={tr('还没有旅伴')}
          hint={tr('添加同行的人，一起编辑这段旅程。')}
        />
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
          <Avatar name={tr('云端')} size={22} />
          {tr('多人同步')}
        </p>
        <p className="mt-1.5 text-note leading-4 text-ink-3">
          {tr('当前为本地档案，成员与邀请码保存在本机。接入后端后，旅伴可通过邀请码加入并实时同步。')}
        </p>
      </div>
    </div>
  )
}