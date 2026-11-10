import { useCallback, useMemo } from 'react'
import { Plus, Wallet } from '@phosphor-icons/react'
import type { Expense, Trip } from '../lib/types'
import { categoryStats, listExpenses, listTrips, sumExpense } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useNav } from '../lib/app-context'
import { CATEGORY_COLOR, CATEGORY_LABEL, formatDateCn, formatMoney } from '../lib/utils'
import { CategoryBar, ExpenseRow } from '../components/cards'
import { EmptyState, SkeletonList } from '../components/ui'

export function ExpensesPage() {
  const nav = useNav()

  const loader = useCallback(async () => {
    const [expenses, trips] = await Promise.all([listExpenses(), listTrips()])
    return { expenses, trips }
  }, [])

  const { data, loading } = useLoader(loader, { expenses: [] as Expense[], trips: [] as Trip[] }, 'all-expenses')
  const { expenses, trips } = data

  const total = sumExpense(expenses)
  const stats = useMemo(() => categoryStats(expenses), [expenses])
  const tripTitle = useMemo(() => {
    const map = new Map<string, string>()
    for (const trip of trips) map.set(trip.id, trip.title)
    return map
  }, [trips])

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 pt-4">
        <div className="min-w-0">
          <p className="text-[10.5px] uppercase tracking-[0.22em] text-ink-3">Ledger</p>
          <h1 className="mt-1.5 text-[27px] font-semibold leading-none tracking-tight text-ink sm:text-[32px]">
            账本
          </h1>
        </div>
        <button
          type="button"
          className="btn-primary shrink-0"
          onClick={() => nav.navigate({ name: 'expenseEditor', tripId: '' })}
        >
          <Plus size={16} weight="bold" />
          记一笔
        </button>
      </header>

      <section className="border-y border-line py-4">
        <p className="text-[11px] tracking-wide text-ink-3">全部旅行合计</p>
        <p className="mt-1 text-[36px] font-semibold leading-none tabular-nums tracking-tight text-ink sm:text-[44px]">
          <span className="mr-1.5 text-[17px] font-normal text-ink-3">¥</span>
          {formatMoney(total)}
        </p>
        <p className="mt-2 text-[12px] text-ink-3">
          {expenses.length} 笔记录 · 覆盖 {trips.length} 段旅程
        </p>
      </section>

      {loading ? (
        <SkeletonList rows={3} />
      ) : (
        <div className="lg:grid lg:grid-cols-[1.7fr_1fr] lg:gap-6">
          <div className="min-w-0">
            <h2 className="text-[12px] font-semibold tracking-tight text-ink">明细</h2>
            <div className="mt-2 divide-y divide-line">
              {expenses.length === 0 ? (
                <EmptyState
                  icon={<Wallet size={20} />}
                  title="还没有记账"
                  hint="记下车票、住宿和一顿夜宵，回程就知道钱花在哪了。"
                  action={
                    <button
                      type="button"
                      className="btn-primary mt-1"
                      onClick={() => nav.navigate({ name: 'expenseEditor', tripId: '' })}
                    >
                      <Plus size={15} weight="bold" />
                      记第一笔
                    </button>
                  }
                />
              ) : (
                expenses.map((expense) => (
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
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <aside className="mt-5 space-y-3 lg:mt-0">
            <div className="card p-4">
              <h2 className="text-[12px] font-semibold tracking-tight text-ink">分类占比</h2>
              <div className="mt-3 space-y-3">
                {stats.length === 0 ? (
                  <p className="text-[12px] text-ink-3">记一笔之后，这里会出现分类占比。</p>
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
          </aside>
        </div>
      )}
    </div>
  )
}