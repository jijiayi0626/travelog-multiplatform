import { useEffect, useRef, useState } from 'react'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Microphone, Receipt, StopCircle, Trash } from '@phosphor-icons/react'
import type { Currency, Expense, ExpenseCategory, Member, Trip } from '../lib/types'
import {
  deleteExpense,
  getTrip,
  listExpenses,
  listMembers,
  saveExpense,
  sumExpenseCny,
} from '../lib/repo'
import { useNav, useRefresh, useI18n, useToast } from '../lib/app-context'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CURRENCY_LABEL,
  CURRENCY_ORDER,
  CURRENCY_RATE_TO_CNY,
  CURRENCY_SYMBOL,
  compressImage,
  formatDate,
  formatMoney,
  fromDateInputValue,
  todayStart,
  toDateInputValue,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { parseReceiptText, recognizeReceiptText } from '../lib/receipt-ocr'
import { isOcrModelReady, OCR_MODEL_SIZE_MB } from '../lib/ocr-model'
import { guessCategory } from '../lib/ai'
import { isNative } from '../lib/native'
import { isVoskModelReady, startOfflineListening } from '../lib/offline-speech'
import { parseExpenseSpeech } from '../lib/expense-speech'
import { startSystemVoice } from '../lib/speech'
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
  const [members, setMembers] = useState<Member[]>([])
  const [payerId, setPayerId] = useState('')
  const [receiptBusy, setReceiptBusy] = useState(false)
  const [modelPrompt, setModelPrompt] = useState(false)
  const receiptRef = useRef<HTMLInputElement>(null)

  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceStarting, setVoiceStarting] = useState(false)
  const [voicePrompt, setVoicePrompt] = useState(false)
  const voiceStopRef = useRef<(() => void) | null>(null)
  const voiceOfflineStopRef = useRef<(() => Promise<void>) | null>(null)
  const voiceHeardRef = useRef('')
  const voiceOfflineFinalRef = useRef('')
  const voiceCancelledRef = useRef(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (tripId) {
        const loaded = await getTrip(tripId)
        if (alive) setTrip(loaded)
        const tripMembers = await listMembers(tripId)
        if (alive) {
          setMembers(tripMembers)
          const owner = tripMembers.find((member) => member.role === 'owner') ?? tripMembers[0]
          if (owner) setPayerId(owner.id)
        }
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
          setPayerId(target.payerId ?? '')
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
      const targetTripId = original?.tripId ?? tripId
      await saveExpense({
        id: original?.id ?? '',
        tripId: targetTripId,
        amount: Math.round(amount * 100) / 100,
        category,
        note: note.trim(),
        spentAt,
        currency,
        payerId: payerId || undefined,
        payerName: members.find((member) => member.id === payerId)?.name,
        createdAt: original?.createdAt ?? 0,
        syncState: 1,
      })
      bump()
      const nextExpenses = await listExpenses(targetTripId || undefined)
      const spent = sumExpenseCny(nextExpenses)
      if (trip && trip.budget && trip.budget > 0 && spent > trip.budget) {
        toast(
          tr('已超出预算 ¥{amount}', {
            amount: formatMoney(spent - trip.budget),
          }),
        )
      } else {
        toast(tr('账目已保存'))
      }
      nav.back()
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('保存失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  const recognizeReceipt = async (source: File | string | undefined) => {
    if (!source) return
    setReceiptBusy(true)
    try {
      const image = typeof source === 'string' ? source : await compressImage(source)
      const result = parseReceiptText(await recognizeReceiptText(image))
      if (!result) {
        toast(tr('没识别到金额，请手动填写'))
        return
      }
      setAmountText(String(result.amount))
      setCurrency(result.currency)
      setCategory(result.category)
      setCategoryTouched(true)
      setAutoHint('')
      if (result.note) setNote(result.note)
      if (result.spentAt) setSpentAt(result.spentAt)
      if (error) setError('')
      toast(
        tr('已识别：{currency} {amount}', {
          currency: result.currency,
          amount: formatMoney(result.amount),
        }),
      )
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('识别失败，请重试'))
    } finally {
      setReceiptBusy(false)
      if (receiptRef.current) receiptRef.current.value = ''
    }
  }

  const startReceiptScan = async () => {
    if (!isOcrModelReady()) {
      setModelPrompt(true)
      return
    }
    if (!isNative()) {
      receiptRef.current?.click()
      return
    }
    setReceiptBusy(true)
    try {
      const permission = await Camera.requestPermissions({ permissions: ['camera'] })
      if (permission.camera !== 'granted') {
        toast(tr('未获得相机权限'))
        return
      }
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.Base64,
        quality: 80,
        correctOrientation: true,
      })
      if (!photo.base64String) return
      const mime = photo.format ? `image/${photo.format}` : 'image/jpeg'
      await recognizeReceipt(`data:${mime};base64,${photo.base64String}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 用户取消拍摄时不打扰
      if (!/cancel/i.test(message)) toast(tr('未获得相机权限'))
    } finally {
      setReceiptBusy(false)
    }
  }

  const applyVoiceExpense = (raw: string) => {
    const text = raw.trim()
    if (!text) {
      toast(tr('没听清，请再试一次'))
      return
    }
    const parsed = parseExpenseSpeech(text)
    if (parsed.amount > 0) {
      setAmountText(String(parsed.amount))
      if (parsed.note) setNote(parsed.note)
      setCategory(parsed.category)
      setCategoryTouched(true)
      setAutoHint('')
      if (error) setError('')
      // 只填入表单让用户确认，不直接保存
      toast(
        tr('已识别：{note} ¥{amount}', {
          note: parsed.note || tr('一笔'),
          amount: parsed.amount,
        }),
      )
      return
    }
    if (parsed.note) setNote(parsed.note)
    toast(tr('没识别到金额，请手动填写'))
  }

  const finishVoice = () => {
    const heard = voiceHeardRef.current
    voiceHeardRef.current = ''
    voiceOfflineFinalRef.current = ''
    setVoiceListening(false)
    setVoiceStarting(false)
    applyVoiceExpense(heard)
  }

  const stopVoice = () => {
    const stop = voiceStopRef.current
    voiceStopRef.current = null
    stop?.()
    const offlineStop = voiceOfflineStopRef.current
    voiceOfflineStopRef.current = null
    if (offlineStop) {
      void offlineStop()
    } else {
      // 模型还在加载时也要标记取消，避免加载完成后继续占用麦克风
      voiceCancelledRef.current = true
    }
    finishVoice()
  }

  /** 用本地 Vosk 模型识别；partial 实时覆盖，最终结果追加 */
  const startOfflineVoice = async () => {
    setVoiceStarting(true)
    setVoiceListening(true)
    voiceHeardRef.current = ''
    voiceOfflineFinalRef.current = ''
    voiceCancelledRef.current = false
    toast(tr('正在加载离线语音模型，请稍候…'))
    try {
      const stop = await startOfflineListening({
        onResult: (text, isFinal) => {
          const value = text.trim()
          if (!value) return
          if (isFinal) voiceOfflineFinalRef.current += value
          voiceHeardRef.current = `${voiceOfflineFinalRef.current}${isFinal ? '' : value}`
        },
        onError: (message) => {
          toast(tr('离线语音识别失败：{msg}', { msg: message }))
          setVoiceListening(false)
          setVoiceStarting(false)
        },
      })
      if (voiceCancelledRef.current) {
        voiceCancelledRef.current = false
        await stop()
        return
      }
      voiceOfflineStopRef.current = stop
      setVoiceStarting(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('离线语音启动失败'))
      setVoiceListening(false)
      setVoiceStarting(false)
    }
  }

  /** 系统语音不可用：模型已下载就直接回退，否则引导去下载 */
  const fallbackToOfflineVoice = async () => {
    const ready = await isVoskModelReady()
    if (!ready) {
      setVoicePrompt(true)
      return
    }
    await startOfflineVoice()
  }

  const startSystemVoiceForExpense = async () => {
    const result = await startSystemVoice({
      onPartial: (text) => {
        voiceHeardRef.current = text
      },
      onError: (message) => {
        voiceStopRef.current = null
        voiceHeardRef.current = ''
        setVoiceListening(false)
        setVoiceStarting(false)
        toast(tr('语音识别失败：{msg}', { msg: message }))
      },
      onUnavailable: () => {
        voiceStopRef.current = null
        voiceHeardRef.current = ''
        setVoiceListening(false)
        setVoiceStarting(false)
        void fallbackToOfflineVoice()
      },
      onEnd: () => {
        voiceStopRef.current = null
        finishVoice()
      },
    })
    if (result.ok) {
      voiceStopRef.current = result.stop
      setVoiceListening(true)
      setVoiceStarting(false)
      return
    }
    voiceStopRef.current = null
    setVoiceListening(false)
    setVoiceStarting(false)
    if (result.kind === 'permission') {
      toast(tr('需要麦克风权限才能语音记账'))
      return
    }
    toast(tr('系统语音不可用，改用离线语音'))
    await fallbackToOfflineVoice()
  }

  /** 点一下开始，再点一下停止；优先系统语音，不可用时回退离线识别 */
  const toggleVoiceExpense = async () => {
    if (voiceListening) {
      stopVoice()
      return
    }
    if (voiceStarting) return
    voiceHeardRef.current = ''
    voiceOfflineFinalRef.current = ''
    setVoiceStarting(true)
    try {
      await startSystemVoiceForExpense()
    } catch (error) {
      setVoiceListening(false)
      setVoiceStarting(false)
      toast(error instanceof Error ? error.message : tr('语音识别失败'))
    }
  }

  useEffect(() => {
    return () => {
      voiceStopRef.current?.()
      voiceStopRef.current = null
      if (voiceOfflineStopRef.current) {
        void voiceOfflineStopRef.current()
        voiceOfflineStopRef.current = null
      } else {
        voiceCancelledRef.current = true
      }
    }
  }, [])

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
              className="min-w-0 flex-1 bg-transparent text-display-lg font-semibold leading-none tabular-nums tracking-tight text-ink outline-none placeholder:text-ink-3/60"
              inputMode="decimal"
              value={amountText}
              placeholder="0.00"
              onChange={(event) => {
                setAmountText(event.target.value.replace(/[^\d.]/g, ''))
                if (error) setError('')
              }}
            />
            <button
              type="button"
              disabled={voiceStarting}
              onClick={() => void toggleVoiceExpense()}
              aria-label={voiceListening ? tr('停止语音记账') : tr('语音记账')}
              className={cn(
                'press mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border disabled:opacity-50',
                voiceListening
                  ? 'border-transparent bg-accent-soft text-accent'
                  : 'border-line text-ink-2 hover:text-accent',
              )}
            >
              {voiceStarting ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" />
              ) : voiceListening ? (
                <StopCircle size={19} weight="fill" />
              ) : (
                <Microphone size={19} />
              )}
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between gap-2">
          <span className="text-caption leading-4 text-ink-3">
            {tr('拍下小票，自动填金额和分类')}
          </span>
          <button
            type="button"
            disabled={receiptBusy}
            onClick={() => void startReceiptScan()}
            className="press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-note text-ink-2 disabled:opacity-50 hover:text-accent"
          >
            {receiptBusy ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" />
            ) : (
              <Receipt size={14} />
            )}
            {receiptBusy ? tr('识别中…') : tr('拍小票识别')}
          </button>
          <input
            ref={receiptRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => recognizeReceipt(event.target.files?.[0])}
          />
        </div>

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

      {members.length > 0 ? (
        <FormBlock title={tr('谁付款')}>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setPayerId('')}
              className={cn('chip px-2.5 py-1 text-note', !payerId && 'chip-active')}
            >
              {tr('不指定')}
            </button>
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => setPayerId(member.id)}
                className={cn('chip px-2.5 py-1 text-note', payerId === member.id && 'chip-active')}
              >
                {member.name}
                {member.role === 'owner' ? tr('（我）') : ''}
              </button>
            ))}
          </div>
          <p className="text-caption text-ink-3">
            {tr('用于同行分摊，不指定则不参与结算。')}
          </p>
        </FormBlock>
      ) : null}

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
        open={modelPrompt}
        title={tr('需要先下载识别模型')}
        message={tr('中文识别模型约 {size}MB，只需下载一次，之后拍小票全程离线识别。', {
          size: OCR_MODEL_SIZE_MB,
        })}
        confirmText={tr('去下载模型')}
        tone="accent"
        onClose={() => setModelPrompt(false)}
        onConfirm={() => nav.navigate({ name: 'ocrModel' })}
      />

      <ConfirmDialog
        open={voicePrompt}
        title={tr('系统语音服务不可用')}
        message={tr('系统语音服务不可用，请下载离线语音模型')}
        confirmText={tr('去下载')}
        tone="accent"
        onClose={() => setVoicePrompt(false)}
        onConfirm={() => nav.navigate({ name: 'ocrModel' })}
      />

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