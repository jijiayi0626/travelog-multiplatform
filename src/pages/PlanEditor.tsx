import { useEffect, useState } from 'react'
import { CheckCircle, Trash } from '@phosphor-icons/react'
import type { Plan, PlanKind, Trip } from '../lib/types'
import { deletePlan, getTrip, listPlans, savePlan } from '../lib/repo'
import { useNav, useRefresh, useToast } from '../lib/app-context'
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
      setError('写下这一步要做什么')
      return
    }
    setError('')
    setSaving(true)
    try {
      await savePlan({
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
      toast(original ? '计划已更新' : '已加入日程')
      nav.back()
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!original) return
    await deletePlan(original.id)
    bump()
    toast('计划已删除')
    nav.back()
  }

  return (
    <EditorScreen
      title={planId ? '编辑计划' : '添加计划'}
      onBack={() => nav.back()}
      onSave={save}
      saving={saving}
      saveDisabled={loading}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent">
          第 {day} 天
        </span>
        {trip ? <span className="truncate">{trip.title}</span> : null}
        {trip && trip.startDate > 0 ? (
          <>
            <span className="h-3 w-px bg-line" />
            <span>{formatDate(trip.startDate)} 出发</span>
          </>
        ) : null}
      </div>

      <FormBlock title="安排">
        <Field label="内容" error={error} hint={error ? undefined : '例如「地中美术馆」'}>
          <input
            className={cn('input', error && 'border-danger')}
            value={title}
            maxLength={40}
            placeholder="这一步要做什么"
            onChange={(event) => {
              setTitle(event.target.value)
              if (error) setError('')
            }}
          />
        </Field>

        <div className="grid grid-cols-[auto_1fr] gap-3">
          <Field label="第几天">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="前一天"
                onClick={() => setDay((value) => Math.max(1, value - 1))}
                className="press flex h-11 w-9 items-center justify-center rounded-xl border border-line text-ink-2"
              >
                −
              </button>
              <span className="w-10 text-center text-[16px] font-semibold tabular-nums text-ink">
                {day}
              </span>
              <button
                type="button"
                aria-label="后一天"
                onClick={() => setDay((value) => Math.min(maxDay, value + 1))}
                className="press flex h-11 w-9 items-center justify-center rounded-xl border border-line text-ink-2"
              >
                +
              </button>
            </div>
          </Field>
          <Field label="时间" hint="可留空">
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
              className={cn('chip px-2.5 py-1 text-[11.5px]', time === item && 'chip-active')}
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
                    'press h-7 w-7 rounded-full text-[11.5px] tabular-nums',
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

      <FormBlock title="类型">
        <div className="flex flex-wrap gap-2">
          {PLAN_KIND_ORDER.map((item) => {
            const active = item === kind
            return (
              <button
                key={item}
                type="button"
                onClick={() => setKind(item)}
                className={cn(
                  'press inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[12.5px]',
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

      <FormBlock title="地点与备注">
        <Field label="地点" hint="会显示在日程右侧">
          <input
            className="input"
            value={place}
            maxLength={40}
            placeholder="例如「直岛 · Benesse House」"
            onChange={(event) => setPlace(event.target.value)}
          />
        </Field>
        <Field label="备注">
          <textarea
            className="input-area"
            rows={3}
            value={note}
            maxLength={140}
            placeholder="预约信息、交通班次、要带的东西…"
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </FormBlock>

      {original ? (
        <>
          <button
            type="button"
            onClick={() => setDone((value) => !value)}
            className={cn(
              'press mx-auto flex items-center gap-2 rounded-full border px-4 py-2 text-[12.5px]',
              done ? 'border-transparent bg-accent text-white' : 'border-line text-ink-2',
            )}
          >
            <CheckCircle size={15} weight={done ? 'fill' : 'regular'} />
            {done ? '已完成（点按取消）' : '标记为已完成'}
          </button>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="press mx-auto flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12.5px] text-ink-3 hover:text-danger"
          >
            <Trash size={14} />
            删除这条计划
          </button>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="删除这条计划？"
        message={original ? `「${original.title}」会从日程中移除。` : ''}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </EditorScreen>
  )
}