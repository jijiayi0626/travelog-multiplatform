import { useCallback, useMemo, useState } from 'react'
import { ArrowsDownUp, Export, Plus } from '@phosphor-icons/react'
import type { Expense, ExpenseCategory, TripView } from '../lib/types'
import { categoryStats, listExpenses, listTrips, monthlyStats, sumExpenseCny } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useNav, useToast } from '../lib/app-context'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  csvEscape,
  downloadText,
  formatCny,
  formatDateCn,
  monthKey,
  monthLabel,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { CategoryBar, ExpenseRow } from '../components/cards'
import { CategoryLegend, DonutChart, MonthBars } from '../components/charts'
import { EmptyState, IconButton, SkeletonList } from '../components/ui'
import { EmptyArt } from '../components/EmptyArt'

export function ExpensesPage() {
  const nav = useNav()
  const toast = useToast()
  const loader = useCallback(async () => {
    const [expenses, trips] = await Promise.all([listExpenses(), listTrips()])
    return { expenses, trips }
  }, [])
  const { data, loading } = useLoader(
    loader,
    { expenses: [] as Expense[], trips: [] as TripView[] },
    'all-expenses',
  )

  const [tripFilter, setTripFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExpenseCategory>('all')
  const [monthFilter, setMonthFilter] = useState('all')

  const filtered = useMemo(
    () =>
      data.expenses.filter(
        (expense) =>
          (tripFilter === 'all' || expense.tripId === tripFilter) &&
          (categoryFilter === 'all' || expense.category === categoryFilter) &&
          (monthFilter === 'all' || monthKey(expense.spentAt || expense.createdAt) === monthFilter),
      ),
    [data.expenses, tripFilter, categoryFilter, monthFilter],
  )

  const tripTitle = useMemo(() => {
    const map = new Map<string, string>()
    for (const trip of data.trips) map.set(trip.id, trip.title)
    return map
  }, [data.trips])

  const monthOptions = useMemo(() => {
    const keys = new Set(data.expenses.map((expense) => monthKey(expense.spentAt || expense.createdAt)))
    return [...keys].sort().reverse()
  }, [data.expenses])

  const total = sumExpenseCny(filtered)
  const stats = useMemo(() => categoryStats(filtered), [filtered])
  const months = useMemo(() => monthlyStats(filtered, 6), [filtered])

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast('当前筛选没有可导出的账目')
      return
    }
    const rows: string[][] = [['日期', '旅行', '分类', '备注', '金额', '币种', '折合人民币']]
    for (const expense of filtered) {
      rows.push([
        formatDateCn(expense.spentAt),
        tripTitle.get(expense.tripId) ?? '',
        CATEGORY_LABEL[expense.category],
        expense.note,
        String(expense.amount),
        expense.currency ?? 'CNY',
        (expense.amountCny ?? 0).toFixed(2),
      ])
    }
    const csv = '\ufeff' + rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')
    downloadText(`travelog-expenses-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8')
    toast('CSV 已导出')
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 pt-4">
        <div className="min-w-0">
          <p className="text-[10.5px] uppercase tracking-[0.22em] text-ink-3">Ledger</p>
          <h1 className="mt-1.5 text-[27px] font-semibold leading-none tracking-tight text-ink sm:text-[32px]">
            账本
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton label="导出 CSV" onClick={exportCsv}>
            <Export size={17} />
          </IconButton>
          <button
            type="button"
            className="btn-primary"
            onClick={() => nav.navigate({ name: 'expenseEditor', tripId: '' })}
          >
            <Plus size={16} weight="bold" />
            记一笔
          </button>
        </div>
      </header>

      <section className="border-y border-line py-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] tracking-wide text-ink-3">当前筛选合计</p>
            <p className="mt-1 truncate text-[34px] font-semibold leading-none tabular-nums tracking-tight text-ink sm:text-[42px]">
              {formatCny(total)}
            </p>
          </div>
          <p className="shrink-0 text-right text-[11.5px] leading-4 text-ink-3">
            {filtered.length} 笔
            <br />
            共 {data.trips.length} 段旅程
          </p>
        </div>
      </section>

      <div className="space-y-2.5">
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <span className="shrink-0 text-[11px] text-ink-3">旅行</span>
          <select
            value={tripFilter}
            onChange={(event) => setTripFilter(event.target.value)}
            className="chip shrink-0 appearance-none pr-6"
            aria-label="按旅行筛选"
          >
            <option value="all">全部旅行</option>
            {data.trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.title}
              </option>
            ))}
          </select>
          <select
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
            className="chip shrink-0 appearance-none pr-6"
            aria-label="按月份筛选"
          >
            <option value="all">全部月份</option>
            {monthOptions.map((key) => (
              <option key={key} value={key}>
                {key.slice(0, 4)} 年 {monthLabel(key)}
              </option>
            ))}
          </select>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-ink-3">
            <ArrowsDownUp size={13} />
            <span className="text-[11px]">按时间</span>
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={cn('chip', categoryFilter === 'all' && 'chip-active')}
          >
            全部分类
          </button>
          {CATEGORY_ORDER.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategoryFilter(item)}
              className={cn('chip', categoryFilter === item && 'chip-active')}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: categoryFilter === item ? '#fff' : CATEGORY_COLOR[item] }}
              />
              {CATEGORY_LABEL[item]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          {filtered.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <section className="card p-4">
                <h2 className="text-[12px] font-semibold tracking-tight text-ink">分类占比</h2>
                <div className="mt-3 flex items-center gap-4">
                  <DonutChart stats={stats} total={total} size={132} thickness={12} />
                  <CategoryLegend stats={stats} />
                </div>
              </section>

              <section className="card p-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-[12px] font-semibold tracking-tight text-ink">近 6 个月</h2>
                  <span className="text-[10.5px] text-ink-3">人民币</span>
                </div>
                <div className="mt-4">
                  <MonthBars data={months} />
                </div>
              </section>
            </div>
          ) : null}

          <div className="lg:grid lg:grid-cols-[1.6fr_1fr] lg:gap-6">
            <section className="min-w-0">
              <h2 className="text-[12px] font-semibold tracking-tight text-ink">明细</h2>
              {filtered.length === 0 ? (
                <EmptyState
                  icon={<EmptyArt variant="wallet" />}
                  title="当前筛选没有账目"
                  hint="换个筛选条件，或者记一笔新的花费。"
                  action={
                    <button
                      type="button"
                      className="btn-primary mt-1"
                      onClick={() => nav.navigate({ name: 'expenseEditor', tripId: '' })}
                    >
                      <Plus size={15} weight="bold" />
                      记一笔
                    </button>
                  }
                />
              ) : (
                <div className="mt-2 divide-y divide-line">
                  {filtered.map((expense) => (
                    <div key={expense.id} className="py-1.5">
                      <ExpenseRow
                        expense={expense}
                        onOpen={() =>
                          nav.navigate({
                            name: 'expenseEditor',
                            tripId: expense.tripId,
                            expenseId: expense.id,
                          })
                        }
                      />
                      <p className="pl-[52px] text-[10.5px] text-ink-3">
                        {tripTitle.get(expense.tripId) ?? '未关联旅程'} · {formatDateCn(expense.spentAt)}
                        {expense.currency && expense.currency !== 'CNY'
                          ? ` · 折合 ${formatCny(expense.amountCny ?? 0)}`
                          : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <aside className="mt-5 space-y-3 lg:mt-0">
              <div className="card p-4">
                <h2 className="text-[12px] font-semibold tracking-tight text-ink">分类明细</h2>
                <div className="mt-3 space-y-3">
                  {stats.length === 0 ? (
                    <p className="text-[12px] text-ink-3">还没有账目。</p>
                  ) : (
                    stats.map((stat) => (
                      <CategoryBar
                        key={stat.category}
                        label={CATEGORY_LABEL[stat.category]}
                        color={CATEGORY_COLOR[stat.category]}
                        amount={stat.amount}
                        count={stat.count}
                        ratio={stat.ratio}
                      />
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11.5px] leading-4 text-ink-3">
                  多币种按固定离线汇率折算：1 JPY ≈ ¥0.048，1 USD ≈ ¥7.2。
                  只用于本地统计，不参与真实结算。
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}