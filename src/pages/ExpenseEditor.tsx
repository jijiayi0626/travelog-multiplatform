import { useEffect, useState } from 'react'
import { Trash } from '@phosphor-icons/react'
import type { Currency, Expense, ExpenseCategory, Trip } from '../lib/types'
import { deleteExpense, getTrip, listExpenses, saveExpense } from '../lib/repo'
import { useNav, useRefresh, useI18n, useToast } from '../lib/app-context'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CURRENCY_LABEL,
  CURRENCY_ORDER,
  CURRENCY_RATE_TO_CNY,
  CURRENCY_SYMBOL,
  formatDate,
  formatMoney,
  fromDateInputValue,
  todayStart,
  toDateInputValue,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { guessCategory } from '../lib/ai'
import { EditorScreen, FormBlock } from '../components/EditorScreen'
import { ConfirmDialog, Field } from '../components/ui'
import { CategoryGlyph } from '../components/Icons'

export function ExpenseEditor({ tripId, expenseId }: { tripId: string; expenseId?: string }) {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { tr } = useI18n()

  const [loading, setLoading] = useState(Boolean(expenseId))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [original, setOriginal] = useState<Expense | null>(null)
  const [trip, setTrip] = useState<Trip | undefined>(undefined)

  const [amountText, setAmountText] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('food')
  const [note, setNote] = useState('')
  const [spentAt, setSpentAt] = useState(todayStart())
  const [currency, setCurrency] = useState<Currency>('CNY')
  const [error, setError] = useState('')
  const [recent, setRecent] = useState<Expense[]>([])
  const [categoryTouched, setCategoryTouched] = useState(Boolean(expenseId))
  const [autoHint, setAutoHint] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (tripId) {
        const loaded = await getTrip(tripId)
        if (alive) setTrip(loaded)
      }
      if (expenseId) {
        const expenses = await listExpenses(tripId || undefined)
        const target = expenses.find((item) => item.id === expenseId)
        if (target && alive) {
          setOriginal(target)
          setAmountText(String(target.amount))
          setCategory(target.category)
          setNote(target.note)
          setSpentAt(target.spentAt || todayStart())
          setCurrency(target.currency ?? 'CNY')
        }
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [tripId, expenseId])

  useEffect(() => {
    let alive = true
    listExpenses(tripId || undefined).then((list) => {
      if (!alive) return
      const unique: Expense[] = []
      for (const item of list) {
        if (!unique.some((u) => u.amount === item.amount && u.category === item.category)) {
          unique.push(item)
        }
        if (unique.length >= 3) break
      }
      setRecent(unique)
    })
    return () => {
      alive = false
    }
  }, [tripId])

  const save = async () => {
    const amount = Number.parseFloat(amountText)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(tr('请输入大于 0 的金额'))
      return
    }
    setError('')
    setSaving(true)
    try {
      await saveExpense({
        id: original?.id ?? '',
        tripId: original?.tripId ?? tripId,
        amount: Math.round(amount * 100) / 100,
        category,
        note: note.trim(),
        spentAt,
        currency,
        createdAt: original?.createdAt ?? 0,
        syncState: 1,
      })
      bump()
      toast(tr('账目已保存'))
      nav.back()
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('保存失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!original) return
    await deleteExpense(original.id)
    bump()
    toast(tr('账目已删除'))
    nav.back()
  }

  return (
    <EditorScreen
      title={expenseId ? tr('编辑账目') : tr('记一笔')}
      onBack={() => nav.back()}
      onSave={save}
      saving={saving}
      saveDisabled={loading}
    >
      <FormBlock title={trip ? trip.title : tr('全部旅行')}>
        <Field label={tr('金额')} error={error}>
          <div className="flex items-end gap-2 border-b border-line pb-2">
            <span className="pb-1.5 text-heading-sm font-normal text-ink-3">{CURRENCY_SYMBOL[currency]}</span>
            <input
              className="w-full bg-transparent text-display-lg font-semibold leading-none tabular-nums tracking-tight text-ink outline-none placeholder:text-ink-3/60"
              inputMode="decimal"
              value={amountText}
              placeholder="0.00"
              onChange={(event) => {
                setAmountText(event.target.value.replace(/[^\d.]/g, ''))
                if (error) setError('')
              }}
            />
          </div>
        </Field>

        <div className="flex flex-wrap gap-1.5 pt-1">
          {CURRENCY_ORDER.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCurrency(item)}
              className={cn('chip px-2.5 py-1 text-note', currency === item && 'chip-active')}
            >
              {item}
            </button>
          ))}
        </div>
        {currency !== 'CNY' && amountText ? (
          <p className="text-note text-ink-3">
            {tr('约 ¥{amount} · {currency}按离线汇率折算', {
              amount: formatMoney(
                Number.parseFloat(amountText || '0') * CURRENCY_RATE_TO_CNY[currency],
              ),
              currency: CURRENCY_LABEL[currency],
            })}
          </p>
        ) : null}

        {recent.length > 0 ? (
          <div className="space-y-1.5 border-t border-line pt-2.5">
            <span className="field-label">{tr('再来一笔')}</span>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setAmountText(String(item.amount))
                    setCategory(item.category)
                    setNote(item.note)
                    setCurrency(item.currency ?? 'CNY')
                  }}
                  className="press chip px-2.5 py-1 text-note"
                >
                  {CATEGORY_LABEL[item.category]} · {item.currency && item.currency !== 'CNY' ? item.currency + ' ' : '¥'}{formatMoney(item.amount)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </FormBlock>

      <FormBlock title={tr('分类')}>
        {autoHint ? <p className="text-caption text-accent">{autoHint}</p> : null}
        <div className="flex flex-wrap gap-2">
          {CATEGORY_ORDER.map((item) => {
            const active = item === category
            return (
              <button
                key={item}
                type="button"
                onClick={() => {
                setCategory(item)
                setCategoryTouched(true)
                setAutoHint('')
              }}
                className={cn(
                  'press inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-body-sm',
                  active ? 'border-transparent text-white' : 'border-line bg-surface text-ink-2',
                )}
                style={active ? { backgroundColor: CATEGORY_COLOR[item] } : undefined}
              >
                <CategoryGlyph category={item} size={15} />
                {CATEGORY_LABEL[item]}
              </button>
            )
          })}
        </div>
      </FormBlock>

      <FormBlock title={tr('明细')}>
        <Field label={tr('日期')}>
          <input
            type="date"
            className="input"
            value={toDateInputValue(spentAt)}
            onChange={(event) => setSpentAt(fromDateInputValue(event.target.value))}
          />
        </Field>
        <Field
          label={tr('备注')}
          hint={spentAt > 0 ? tr('记账日期 {date}', { date: formatDate(spentAt) }) : undefined}
        >
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            className="input"
            value={note}
            maxLength={60}
            placeholder={tr('例如「海鲜烧烤 · 两人」')}
            onChange={(event) => setNote(event.target.value)}
            onBlur={async (event) => {
              const value = event.target.value.trim()
              if (!value || categoryTouched) return
              const parsed = Number.parseFloat(amountText || '0')
              const hit = await guessCategory(value, parsed > 0 ? parsed : undefined)
              if (hit) {
                setCategory(hit)
                setAutoHint(tr('AI 归类为「{name}」，点分类可改', { name: CATEGORY_LABEL[hit] }))
              }
            }}
          />
        </Field>
      </FormBlock>

      {original ? (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="press mx-auto flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-body-sm text-ink-3 hover:text-danger"
        >
          <Trash size={14} />
{tr('删除这笔账目')}
        </button>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={tr('删除这笔账目？')}
        message={tr('删除后金额统计会立即更新。')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </EditorScreen>
  )
}