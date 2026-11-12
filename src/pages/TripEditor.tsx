import { useEffect, useRef, useState } from 'react'
import { Sparkle, Trash } from '@phosphor-icons/react'
import type { Currency, Trip, TripTemplate } from '../lib/types'
import { applyChecklistTemplate, applyPlanTemplate, deleteTrip, getProfile, getTrip, saveTrip } from '../lib/repo'
import { suggestTripNote } from '../lib/ai'
import { useNav, useRefresh, useI18n, useToast } from '../lib/app-context'
import {
  addDays,
  coverClass,
  compressImage,
  CURRENCY_LABEL,
  CURRENCY_ORDER,
  formatDate,
  fromDateInputValue,
  todayStart,
  toDateInputValue,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { EditorScreen, FormBlock } from '../components/EditorScreen'
import { ConfirmDialog, Field } from '../components/ui'

const TEMPLATE_COVER: Record<TripTemplate, number> = {
  blank: 0,
  city: 1,
  beach: 3,
  road: 2,
  ski: 4,
}

export function TripEditor({ id, template }: { id?: string; template?: TripTemplate }) {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { tr } = useI18n()

  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [original, setOriginal] = useState<Trip | null>(null)

  const [title, setTitle] = useState('')
  const [destination, setDestination] = useState('')
  const [startDate, setStartDate] = useState(todayStart())
  const [endDate, setEndDate] = useState(addDays(todayStart(), 3))
  const [note, setNote] = useState('')
  const [cover, setCover] = useState(template ? TEMPLATE_COVER[template] : 0)
  const [coverImage, setCoverImage] = useState('')
  const [currency, setCurrency] = useState<Currency>('CNY')
  const [budgetText, setBudgetText] = useState('')
  const [error, setError] = useState('')
  const [aiNoteBusy, setAiNoteBusy] = useState(false)
  // WebView 中文输入法下 onChange 可能滞后，保存时以 DOM 实际值为准
  const titleRef = useRef<HTMLInputElement>(null)
  const destinationRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    getTrip(id).then((trip) => {
      if (!alive) return
      if (trip) {
        setOriginal(trip)
        setTitle(trip.title)
        setDestination(trip.destination)
        setStartDate(trip.startDate || todayStart())
        setEndDate(trip.endDate || addDays(trip.startDate || todayStart(), 3))
        setNote(trip.note)
        setCover(trip.cover)
        setCoverImage(trip.coverImage ?? '')
        setCurrency(trip.currency ?? 'CNY')
        setBudgetText(trip.budget && trip.budget > 0 ? String(trip.budget) : '')
      }
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => {
      alive = false
    }
  }, [id])

  const save = async () => {
    // 以输入框实际值为准：部分输入法下 React state 会滞后
    const titleValue = (titleRef.current?.value ?? title).trim()
    const destinationValue = (destinationRef.current?.value ?? destination).trim()
    if (!titleValue) {
      setError(tr('给这段旅程起个名字'))
      return
    }
    setError('')
    setSaving(true)
    try {
      const profile = await getProfile()
      const budgetValue = Number.parseFloat(budgetText)
      const start = startDate || todayStart()
      const end = endDate && endDate >= start ? endDate : start
      const saved = await saveTrip({
        id: original?.id ?? '',
        title: titleValue,
        destination: destinationValue,
        startDate: start,
        endDate: end,
        note: note.trim(),
        cover,
        coverImage: coverImage || undefined,
        ownerId: original?.ownerId ?? profile.id,
        inviteCode: original?.inviteCode ?? '',
        createdAt: original?.createdAt ?? 0,
        updatedAt: 0,
        syncState: 1,
        budget: Number.isFinite(budgetValue) && budgetValue > 0 ? budgetValue : 0,
        currency,
        template: original?.template ?? template ?? 'blank',
      })

      if (!id && template && template !== 'blank') {
        const days = Math.floor((end - start) / 864e5) + 1
        await applyPlanTemplate(saved.id, template, days)
        await applyChecklistTemplate(saved.id, template)
      }

      bump()
      toast(tr('旅程已保存'))
      if (id) {
        nav.back()
      } else {
        nav.navigate({ name: 'trip', id: saved.id, tab: 'plan' })
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('保存失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!original) return
    await deleteTrip(original.id)
    bump()
    toast(tr('旅程已删除'))
    nav.navigate({ name: 'trips' })
  }

  return (
    <EditorScreen
      title={id ? tr('编辑旅行') : tr('新建旅行')}
      onBack={() => nav.back()}
      onSave={save}
      saving={saving}
      saveDisabled={loading}
    >
      <FormBlock title={tr('基本信息')}>
        <Field
          label={tr('旅行名称')}
          error={error}
          hint={error ? undefined : tr('例如「北海道夏日纪行」')}
        >
          <input
            ref={titleRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            className={cn('input', error && 'border-danger')}
            value={title}
            maxLength={40}
            placeholder={tr('给这段旅程起个名字')}
            onChange={(event) => {
              setTitle(event.target.value)
              if (error) setError('')
            }}
          />
        </Field>
        <Field label={tr('目的地')} hint={tr('城市或地区，会显示在封面上')}>
          <input
            ref={destinationRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            className="input"
            value={destination}
            maxLength={40}
            placeholder={tr('例如「日本 · 北海道」')}
            onChange={(event) => setDestination(event.target.value)}
          />
        </Field>
      </FormBlock>

      <FormBlock title={tr('日期')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('开始')}>
            <input
              type="date"
              className="input"
              value={toDateInputValue(startDate)}
              onChange={(event) => setStartDate(fromDateInputValue(event.target.value))}
            />
          </Field>
          <Field label={tr('结束')}>
            <input
              type="date"
              className="input"
              value={toDateInputValue(endDate)}
              onChange={(event) => setEndDate(fromDateInputValue(event.target.value))}
            />
          </Field>
        </div>
        <p className="text-note text-ink-3">
          {startDate > 0 && endDate > 0
            ? tr('{start} — {end} · 约 {n} 天', {
                start: formatDate(startDate),
                end: formatDate(endDate),
                n: Math.max(Math.floor((endDate - startDate) / 864e5) + 1, 1),
              })
            : tr('设置日期后，记录会自动按天归组')}
        </p>
      </FormBlock>

      <FormBlock title={tr('预算')} hint={tr('可选')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('预算金额')} hint={tr('按人民币计算')}>
            <input
              className="input"
              inputMode="decimal"
              value={budgetText}
              placeholder={tr('例如 12000')}
              onChange={(event) => setBudgetText(event.target.value.replace(/[^\d.]/g, ''))}
            />
          </Field>
          <Field label={tr('当地货币')}>
            <select
              className="input"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
            >
              {CURRENCY_ORDER.map((item) => (
                <option key={item} value={item}>
                  {item} · {CURRENCY_LABEL[item]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="text-note leading-4 text-ink-3">
          {tr('账目按当地货币录入，会按离线汇率折算成人民币汇总；预算进度会显示在旅程概览里。')}
        </p>
      </FormBlock>

      <FormBlock title={tr('封面与备注')}>
        <div className="space-y-2">
          <span className="field-label">{tr('封面')}</span>
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((index) => (
              <button
                key={index}
                type="button"
                aria-label={tr('封面样式 {n}', { n: index + 1 })}
                onClick={() => setCover(index)}
                className={cn(
                  'press h-12 flex-1 rounded-xl',
                  coverClass(index),
                  cover === index && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="btn-ghost h-9 cursor-pointer px-3 text-caption">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  try {
                    setCoverImage(await compressImage(file))
                  } catch {
                    toast(tr('图片处理失败，换一张试试'))
                  } finally {
                    event.target.value = ''
                  }
                }}
              />
              {coverImage ? tr('更换封面图片') : tr('上传封面图片')}
            </label>
            {coverImage ? (
              <>
                <img src={coverImage} alt="" className="h-9 w-14 rounded-lg object-cover" />
                <button
                  type="button"
                  className="press text-caption text-ink-3 hover:text-danger"
                  onClick={() => setCoverImage('')}
                >
                  {tr('移除')}
                </button>
              </>
            ) : null}
          </div>
        </div>
        <Field label={tr('旅行备注')} hint={tr('写给这段旅程的一句话')}>
          <div className="space-y-2">
            <textarea
              className="input-area"
              rows={3}
              value={note}
              maxLength={160}
              placeholder={tr('比如：从札幌一路到函馆，海风、拉面和一整夜的路灯。')}
              onChange={(event) => setNote(event.target.value)}
            />
            <button
              type="button"
              disabled={aiNoteBusy}
              onClick={async () => {
                setAiNoteBusy(true)
                try {
                  const days =
                    startDate > 0 && endDate > 0
                      ? Math.max(Math.floor((endDate - startDate) / 864e5) + 1, 1)
                      : 3
                  const text = await suggestTripNote(destination || title || '这次旅行', days)
                  setNote(text)
                } catch (error) {
                  toast(error instanceof Error ? error.message : tr('生成失败'))
                } finally {
                  setAiNoteBusy(false)
                }
              }}
              className="press inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-1 text-caption text-accent disabled:opacity-60"
            >
              <Sparkle size={12} weight="fill" />
              {aiNoteBusy ? tr('生成中…') : tr('AI 生成')}
            </button>
          </div>
        </Field>
      </FormBlock>

      {!id && template && template !== 'blank' ? (
        <div className="rounded-2xl border border-line bg-surface p-3.5">
          <p className="text-note font-medium text-ink">{tr('已选择模板')}</p>
          <p className="mt-1 text-note leading-4 text-ink-3">
            {tr('保存后会自动排入「{name}」的日程与打包清单，之后都能单独修改。', {
              name: tr(
                template === 'city'
                  ? '城市漫步'
                  : template === 'beach'
                    ? '海岛度假'
                    : template === 'road'
                      ? '自驾公路'
                      : '滑雪',
              ),
            })}
          </p>
        </div>
      ) : null}

      {original ? (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="press mx-auto flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-body-sm text-ink-3 hover:text-danger"
        >
          <Trash size={14} />
{tr('删除这段旅程')}
        </button>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={tr('删除这段旅程？')}
        message={tr('旅程下的日程、图文、账目、清单与足迹都会一并删除，且无法恢复。')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </EditorScreen>
  )
}