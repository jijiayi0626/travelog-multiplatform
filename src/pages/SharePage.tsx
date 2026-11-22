import { useEffect, useMemo, useState } from 'react'
import { CalendarBlank, Copy, MapPin, ShareNetwork } from '@phosphor-icons/react'
import type { SharedTrip, SharedTripPlan } from '../lib/cloud'
import { fetchSharedTrip } from '../lib/cloud'
import { useI18n, useToast } from '../lib/app-context'
import { cn } from '../lib/cn'
import { PLAN_KIND_COLOR, PLAN_KIND_LABEL, copyText, coverClass, formatDate } from '../lib/utils'

export function SharePage({ code }: { code: string }) {
  const { tr } = useI18n()
  const toast = useToast()
  const [data, setData] = useState<SharedTrip | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetchSharedTrip(code)
      .then((result) => {
        if (alive) setData(result)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [code])

  const groups = useMemo(() => {
    const map = new Map<number, SharedTripPlan[]>()
    for (const plan of data?.plans ?? []) {
      const list = map.get(plan.dayIndex)
      if (list) list.push(plan)
      else map.set(plan.dayIndex, [plan])
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [data])

  const copyInvite = async () => {
    const ok = await copyText(code)
    toast(ok ? tr('邀请码已复制，打开旅记 App 会自动提示加入') : tr('复制失败，请手动记录邀请码'))
  }

  if (loading) {
    return (
      <div className="space-y-4 pt-5">
        <div className="skeleton h-[172px] rounded-[1.6rem]" />
        <div className="skeleton h-4 w-40" />
        <div className="skeleton h-24 rounded-2xl" />
      </div>
    )
  }

  if (failed || !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink-3">
          <ShareNetwork size={22} />
        </span>
        <p className="text-title font-semibold tracking-tight text-ink">{tr('分享链接无效或已取消')}</p>
        <p className="max-w-[32ch] text-body-sm leading-6 text-ink-3">
          {tr('请向分享者确认链接是否仍然有效。')}
        </p>
      </div>
    )
  }

  const { trip, plans } = data

  return (
    <div className="space-y-4 pb-6 pt-4">
      <div className="flex items-center gap-1.5 text-caption text-ink-3">
        <ShareNetwork size={13} />
        {tr('只读分享')}
      </div>

      <section
        className={cn('relative overflow-hidden rounded-[1.6rem] p-5 text-white', coverClass(trip.cover))}
      >
        {trip.coverImage ? (
          <>
            <img
              src={trip.coverImage}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
            <span className="absolute inset-0 bg-black/40" />
          </>
        ) : null}
        <span className="cover-texture pointer-events-none absolute inset-0" />
        <h1 className="relative max-w-[22ch] text-heading font-semibold leading-tight tracking-tight">
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
          <p className="relative mt-3 max-w-[60ch] text-body-sm leading-5 text-[var(--on-cover-muted)]">
            {trip.note}
          </p>
        ) : null}
      </section>

      {plans.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-surface text-ink-3">
            <CalendarBlank size={20} />
          </span>
          <p className="text-body font-medium text-ink">{tr('这个行程还没有公开日程')}</p>
          <p className="text-note text-ink-3">{tr('分享者排好日程后，这里会自动更新。')}</p>
        </div>
      ) : (
        groups.map(([dayIndex, dayPlans]) => (
          <section key={dayIndex} className="card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-body font-semibold tracking-tight text-ink">
                {tr('第 {n} 天', { n: dayIndex })}
              </h2>
              <span className="text-caption text-ink-3">{tr('{n} 条日程', { n: dayPlans.length })}</span>
            </div>
            <div className="space-y-2.5">
              {dayPlans.map((plan, index) => (
                <article
                  key={`${dayIndex}-${index}-${plan.title}`}
                  className="flex gap-3 border-t border-line pt-2.5 first:border-0 first:pt-0"
                >
                  <span className="w-11 shrink-0 pt-0.5 text-caption tabular-nums text-ink-3">
                    {plan.time || '—'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-body-sm font-medium', plan.done ? 'text-ink-3 line-through' : 'text-ink')}>
                      {plan.title || tr('未命名日程')}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-3">
                      <span className="inline-flex items-center gap-1">
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: PLAN_KIND_COLOR[plan.kind] }}
                        />
                        {tr(PLAN_KIND_LABEL[plan.kind])}
                      </span>
                      {plan.place ? <span className="truncate">{plan.place}</span> : null}
                    </div>
                    {plan.note ? (
                      <p className="mt-1 line-clamp-2 text-caption leading-4 text-ink-3">{plan.note}</p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}

      <section className="card space-y-3 p-5 text-center">
        <p className="text-title font-semibold tracking-tight text-ink">{tr('一起编辑这趟旅程')}</p>
        <p className="mx-auto max-w-[34ch] text-note leading-5 text-ink-3">
          {tr('复制邀请码，在旅记 App 里打开就会自动提示加入；也可以手动在「旅伴」页输入。')}
        </p>
        <button type="button" className="btn-primary w-full" onClick={copyInvite}>
          <Copy size={16} />
          {tr('加入这个行程')}
        </button>
        <p className="text-caption leading-4 text-ink-3">
          {tr('需要先安装旅记 App 并登录。邀请码 {code} 仅用于加入当前行程。', { code })}
        </p>
      </section>
    </div>
  )
}
