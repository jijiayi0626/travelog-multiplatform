import { useEffect, useState } from 'react'
import { CheckCircle, Trash } from '@phosphor-icons/react'
import type { Plan, PlanKind, Trip } from '../lib/types'
import { deletePlan, getTrip, listPlans, savePlan } from '../lib/repo'
import { useNav, useRefresh, useI18n, useToast } from '../lib/app-context'
import {
  PLAN_KIND_COLOR,
  PLAN_KIND_LABEL,
  PLAN_KIND_ORDER,
  formatDate,
  normalizeClock,
  tripDayCount,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { EditorScreen, FormBlock } from '../components/EditorScreen'
import { ConfirmDialog, Field } from '../components/ui'
import { PlanGlyph } from '../components/Icons'
import { Bell } from '@phosphor-icons/react'
import {
  cancelPlanReminder,
  ensureNotificationPermission,
  getReminderPrefs,
  schedulePlanReminder,
} from '../lib/reminder'

const QUICK_TIMES = ['08:00', '09:30', '12:00', '15:00', '18:30', '21:00']

export function PlanEditor({
  tripId,
  planId,
  dayIndex,
}: {
  tripId: string
  planId?: string
  dayIndex?: number
}) {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { tr } = useI18n()

  const [loading, setLoading] = useState(Boolean(planId))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [original, setOriginal] = useState<Plan | null>(null)
  const [trip, setTrip] = useState<Trip | undefined>(undefined)

  const [day, setDay] = useState(dayIndex ?? 1)
  const [time, setTime] = useState('')
  const [kind, setKind] = useState<PlanKind>('activity')
  const [title, setTitle] = useState('')
  const [place, setPlace] = useState('')
  const [note, setNote] = useState('')
  const [done, setDone] = useState(false)
  const [remind, setRemind] = useState(() => getReminderPrefs().enabled)
  const [lead, setLead] = useState(() => getReminderPrefs().leadMinutes)
  const [error, setError] = useState('')

  const maxDay = Math.max(trip ? tripDayCount(trip.startDate, trip.endDate) : 0, 1)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const loadedTrip = await getTrip(tripId)
      if (!alive) return
      setTrip(loadedTrip)
      if (planId) {
        const plans = await listPlans(tripId)
        const target = plans.find((item) => item.id === planId)
        if (target && alive) {
          setOriginal(target)
          setDay(target.dayIndex)
          setTime(target.time)
          setKind(target.kind)
          setTitle(target.title)
          setPlace(target.place)
          setNote(target.note)
          setDone(target.done)
        }
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [tripId, planId])

  const save = async () => {
    if (!title.trim()) {
      setError(tr('写下这一步要做什么'))
      return
    }
    setError('')
    setSaving(true)
    try {
      const saved = await savePlan({
        id: original?.id ?? '',
        tripId,
        dayIndex: Math.min(Math.max(day, 1), 99),
        time: normalizeClock(time) || time.trim(),
        title: title.trim(),
        place: place.trim(),
        kind,
        note: note.trim(),
        done: original ? done : false,
        order: original?.order ?? Number.NaN,
        createdAt: original?.createdAt ?? 0,
      })
      bump()
      toast(original ? tr('计划已更新') : tr('已加入日程'))
      nav.back()
      // 通知属于增强项：放到导航之后异步处理，避免权限弹窗阻塞保存
      if (remind && trip) {
        void (async () => {
          try {
            const allowed = await ensureNotificationPermission()
            if (allowed) await schedulePlanReminder(saved, trip, lead)
          } catch {
            /* 忽略通知失败 */
          }
        })()
      }
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!original) return
    await deletePlan(original.id)
    await cancelPlanReminder(original.id)
    bump()
    toast(tr('计划已删除'))
    nav.back()
  }

  return (
    <EditorScreen
      title={planId ? tr('编辑计划') : tr('添加计划')}
      onBack={() => nav.back()}
      onSave={save}
      saving={saving}
      saveDisabled={loading}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-note text-ink-3">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent">
          {tr('第 {n} 天', { n: day })}
        </span>
        {trip ? <span className="truncate">{trip.title}</span> : null}
        {trip && trip.startDate > 0 ? (
          <>
            <span className="h-3 w-px bg-line" />
            <span>{tr('{date} 出发', { date: formatDate(trip.startDate) })}</span>
          </>
        ) : null}
      </div>

      <FormBlock title={tr('安排')}>
        <Field
          label={tr('内容')}
          error={error}
          hint={error ? undefined : tr('例如「地中美术馆」')}
        >
          <input
            className={cn('input', error && 'border-danger')}
            value={title}
            maxLength={40}
            placeholder={tr('这一步要做什么')}
            onChange={(event) => {
              setTitle(event.target.value)
              if (error) setError('')
            }}
          />
        </Field>

        <div className="grid grid-cols-[auto_1fr] gap-3">
          <Field label={tr('第几天')}>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={tr('前一天')}
                onClick={() => setDay((value) => Math.max(1, value - 1))}
                className="press flex h-11 w-9 items-center justify-center rounded-xl border border-line text-ink-2"
              >
                −
              </button>
              <span className="w-10 text-center text-title font-semibold tabular-nums text-ink">
                {day}
              </span>
              <button
                type="button"
                aria-label={tr('后一天')}
                onClick={() => setDay((value) => Math.min(maxDay, value + 1))}
                className="press flex h-11 w-9 items-center justify-center rounded-xl border border-line text-ink-2"
              >
                +
              </button>
            </div>
          </Field>
          <Field label={tr('时间')} hint={tr('可留空')}>
            <input
              type="time"
              className="input tabular-nums"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_TIMES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTime(item)}
              className={cn('chip px-2.5 py-1 text-note', time === item && 'chip-active')}
            >
              {item}
            </button>
          ))}
        </div>

        {maxDay > 1 ? (
          <div className="flex flex-wrap gap-1.5 border-t border-line pt-2.5">
            {Array.from({ length: Math.min(maxDay, 12) }).map((_, index) => {
              const value = index + 1
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDay(value)}
                  className={cn(
                    'press h-7 w-7 rounded-full text-note tabular-nums',
                    day === value ? 'bg-accent text-white' : 'bg-paper-2 text-ink-2',
                  )}
                >
                  {value}
                </button>
              )
            })}
          </div>
        ) : null}
      </FormBlock>

      <FormBlock title={tr('类型')}>
        <div className="flex flex-wrap gap-2">
          {PLAN_KIND_ORDER.map((item) => {
            const active = item === kind
            return (
              <button
                key={item}
                type="button"
                onClick={() => setKind(item)}
                className={cn(
                  'press inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-body-sm',
                  active ? 'border-transparent text-white' : 'border-line bg-surface text-ink-2',
                )}
                style={active ? { backgroundColor: PLAN_KIND_COLOR[item] } : undefined}
              >
                <PlanGlyph kind={item} size={15} />
                {PLAN_KIND_LABEL[item]}
              </button>
            )
          })}
        </div>
      </FormBlock>

      <FormBlock title={tr('地点与备注')}>
        <Field label={tr('地点')} hint={tr('会显示在日程右侧')}>
          <input
            className="input"
            value={place}
            maxLength={40}
            placeholder={tr('例如「直岛 · Benesse House」')}
            onChange={(event) => setPlace(event.target.value)}
          />
        </Field>
        <Field label={tr('备注')}>
          <textarea
            className="input-area"
            rows={3}
            value={note}
            maxLength={140}
            placeholder={tr('预约信息、交通班次、要带的东西…')}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </FormBlock>

      <FormBlock title={tr('提醒')}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-body text-ink">
              <Bell size={14} className="text-ink-3" />
              {tr('出发前提醒')}
            </p>
            <p className="mt-0.5 text-caption text-ink-3">
              {trip && trip.startDate > 0
                ? tr('按第 {n} 天的 {time} 提前提醒', {
                    n: day,
                    time: time || tr('设定时间'),
                  })
                : tr('先给旅程设置日期，提醒才有意义')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRemind((value) => !value)}
            aria-pressed={remind}
            className={cn(
              'press relative h-6 w-11 shrink-0 rounded-full transition-colors',
              remind ? 'bg-accent' : 'bg-paper-2',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                remind ? 'left-[22px]' : 'left-0.5',
              )}
            />
          </button>
        </div>
        {remind ? (
          <div className="flex flex-wrap gap-1.5">
            {[5, 15, 30, 60].map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => setLead(minutes)}
                className={cn('chip px-2.5 py-1 text-caption', lead === minutes && 'chip-active')}
              >
                {tr('提前 {n} 分钟', { n: minutes })}
              </button>
            ))}
          </div>
        ) : null}
      </FormBlock>

      {original ? (
        <>
          <button
            type="button"
            onClick={() => setDone((value) => !value)}
            className={cn(
              'press mx-auto flex items-center gap-2 rounded-full border px-4 py-2 text-body-sm',
              done ? 'border-transparent bg-accent text-white' : 'border-line text-ink-2',
            )}
          >
            <CheckCircle size={15} weight={done ? 'fill' : 'regular'} />
            {done ? tr('已完成（点按取消）') : tr('标记为已完成')}
          </button>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="press mx-auto flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-body-sm text-ink-3 hover:text-danger"
          >
            <Trash size={14} />
{tr('删除这条计划')}
          </button>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={tr('删除这条计划？')}
        message={
          original ? tr('「{name}」会从日程中移除。', { name: original.title }) : ''
        }
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </EditorScreen>
  )
}