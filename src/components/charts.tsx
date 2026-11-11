import type { CategoryStat, MonthStat } from '../lib/types'
import { CATEGORY_COLOR, CATEGORY_LABEL, formatCny, formatMoney } from '../lib/utils'
import { cn } from '../lib/cn'
import { CategoryGlyph } from './Icons'

export function DonutChart({
  stats,
  size = 148,
  thickness = 13,
  total,
}: {
  stats: CategoryStat[]
  size?: number
  thickness?: number
  total: number
}) {
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const sum = stats.reduce((value, item) => value + item.amount, 0)
  let offset = 0
  const segments = stats.map((stat) => {
    const length = (stat.amount / Math.max(sum, 1)) * circumference
    const segment = { stat, length, offset }
    offset += length
    return segment
  })

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="分类占比">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-paper-2)"
          strokeWidth={thickness}
        />
        {segments.map((segment) => (
          <circle
            key={segment.stat.category}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={CATEGORY_COLOR[segment.stat.category]}
            strokeWidth={thickness}
            strokeDasharray={`${Math.max(segment.length - 1.5, 0)} ${circumference}`}
            strokeDashoffset={-segment.offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-caption tracking-wide text-ink-3">合计</span>
        <span className="mt-0.5 text-body-lg font-semibold tabular-nums tracking-tight text-ink">
          ¥{formatMoney(total)}
        </span>
      </div>
    </div>
  )
}

export function CategoryLegend({ stats }: { stats: CategoryStat[] }) {
  const sum = stats.reduce((value, item) => value + item.amount, 0)
  return (
    <ul className="min-w-0 flex-1 space-y-1.5">
      {stats.slice(0, 6).map((stat) => (
        <li key={stat.category} className="flex items-center gap-2 text-note">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: CATEGORY_COLOR[stat.category] }}
          />
          <span className="inline-flex items-center gap-1 text-ink-2">
            <CategoryGlyph category={stat.category} size={12} />
            {CATEGORY_LABEL[stat.category]}
          </span>
          <span className="ml-auto tabular-nums text-ink-3">
            {Math.round((stat.amount / Math.max(sum, 1)) * 100)}%
          </span>
        </li>
      ))}
    </ul>
  )
}

export function MonthBars({
  data,
  height = 96,
  currentKey,
}: {
  data: MonthStat[]
  height?: number
  currentKey?: string
}) {
  const max = Math.max(...data.map((item) => item.amount), 1)
  const barArea = height - 18
  return (
    <div className="flex items-stretch gap-1.5">
      {data.map((item, index) => {
        const percent = item.amount > 0 ? Math.max((item.amount / max) * 100, 4) : 0
        const isCurrent = currentKey ? item.key === currentKey : index === data.length - 1
        return (
          <div key={item.key} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="relative flex w-full items-end justify-center" style={{ height: barArea }}>
              {item.amount > 0 ? (
                <div
                  className={cn(
                    'w-full max-w-[26px] rounded-t-[5px] transition-colors',
                    isCurrent ? 'bg-accent' : 'bg-accent/25 group-hover:bg-accent/45',
                  )}
                  style={{ height: `${percent}%` }}
                  title={`${item.label} · ${formatCny(item.amount)}`}
                />
              ) : (
                <div className="h-[2px] w-full max-w-[26px] rounded-full bg-line" />
              )}
            </div>
            <span className={cn('text-caption', isCurrent ? 'text-accent' : 'text-ink-3')}>
              {item.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  if (budget <= 0) return null
  const ratio = spent / budget
  const over = spent > budget
  const remain = budget - spent
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-caption">
        <span className="text-ink-3">预算 ¥{formatMoney(budget)}</span>
        <span className={cn('tabular-nums', over ? 'text-danger' : 'text-ink-2')}>
          {over ? `超支 ¥${formatMoney(Math.abs(remain))}` : `剩余 ¥${formatMoney(remain)}`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-paper-2">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            over ? 'bg-danger' : ratio > 0.85 ? 'bg-warn' : 'bg-accent',
          )}
          style={{ width: `${Math.min(Math.max(ratio * 100, 2), 100)}%` }}
        />
      </div>
    </div>
  )
}

/** 每日记录热力条：values 为每天记录数 */
export function HeatStrip({
  values,
  labels,
  todayIndex,
}: {
  values: number[]
  labels?: string[]
  todayIndex?: number
}) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-1">
      {values.map((value, index) => {
        const height = value > 0 ? 5 + (value / max) * 17 : 3
        const isToday = todayIndex === index + 1
        return (
          <div key={index} className="group relative flex flex-1 flex-col items-center gap-1">
            <span
              className={cn(
                'w-full rounded-[3px] transition-colors',
                isToday
                  ? 'bg-accent'
                  : value > 0
                    ? 'bg-accent/55 group-hover:bg-accent/75'
                    : 'bg-line',
              )}
              style={{ height }}
            />
            {labels ? <span className="text-caption text-ink-3">{labels[index]}</span> : null}
            <span className="pointer-events-none absolute -top-7 z-10 hidden whitespace-nowrap rounded-md bg-ink px-1.5 py-0.5 text-caption text-paper group-hover:block">
              第 {index + 1} 天 · {value} 条
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function MiniSpark({ values, height = 34 }: { values: number[]; height?: number }) {
  const max = Math.max(...values, 1)
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100
      const y = 100 - (value / max) * 100
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }} className="w-full">
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}