import { useEffect, useState } from 'react'
import { Trash } from '@phosphor-icons/react'
import type { Trip } from '../lib/types'
import { deleteTrip, getProfile, getTrip, saveTrip } from '../lib/repo'
import { useNav, useRefresh, useToast } from '../lib/app-context'
import {
  addDays,
  coverClass,
  formatDate,
  fromDateInputValue,
  todayStart,
  toDateInputValue,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { EditorScreen, FormBlock } from '../components/EditorScreen'
import { ConfirmDialog, Field } from '../components/ui'

export function TripEditor({ id }: { id?: string }) {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()

  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [original, setOriginal] = useState<Trip | null>(null)

  const [title, setTitle] = useState('')
  const [destination, setDestination] = useState('')
  const [startDate, setStartDate] = useState(todayStart())
  const [endDate, setEndDate] = useState(addDays(todayStart(), 3))
  const [note, setNote] = useState('')
  const [cover, setCover] = useState(0)
  const [error, setError] = useState('')

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
      }
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [id])

  const save = async () => {
    if (!title.trim()) {
      setError('给这段旅程起个名字')
      return
    }
    setError('')
    setSaving(true)
    try {
      const profile = await getProfile()
      const start = startDate || todayStart()
      const end = endDate && endDate >= start ? endDate : start
      const saved = await saveTrip({
        id: original?.id ?? '',
        title: title.trim(),
        destination: destination.trim(),
        startDate: start,
        endDate: end,
        note: note.trim(),
        cover,
        ownerId: original?.ownerId ?? profile.id,
        inviteCode: original?.inviteCode ?? '',
        createdAt: original?.createdAt ?? 0,
        updatedAt: 0,
        syncState: 1,
      })
      bump()
      toast('旅程已保存')
      if (id) {
        nav.back()
      } else {
        nav.navigate({ name: 'trip', id: saved.id, tab: 'timeline' })
      }
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!original) return
    await deleteTrip(original.id)
    bump()
    toast('旅程已删除')
    nav.navigate({ name: 'trips' })
  }

  return (
    <EditorScreen
      title={id ? '编辑旅行' : '新建旅行'}
      onBack={() => nav.back()}
      onSave={save}
      saving={saving}
      saveDisabled={loading}
    >
      <FormBlock title="基本信息">
        <Field label="旅行名称" error={error} hint={error ? undefined : '例如「北海道夏日纪行」'}>
          <input
            className={cn('input', error && 'border-danger')}
            value={title}
            maxLength={40}
            placeholder="给这段旅程起个名字"
            onChange={(event) => {
              setTitle(event.target.value)
              if (error) setError('')
            }}
          />
        </Field>
        <Field label="目的地" hint="城市或地区，会显示在封面上">
          <input
            className="input"
            value={destination}
            maxLength={40}
            placeholder="例如「日本 · 北海道」"
            onChange={(event) => setDestination(event.target.value)}
          />
        </Field>
      </FormBlock>

      <FormBlock title="日期">
        <div className="grid grid-cols-2 gap-3">
          <Field label="开始">
            <input
              type="date"
              className="input"
              value={toDateInputValue(startDate)}
              onChange={(event) => setStartDate(fromDateInputValue(event.target.value))}
            />
          </Field>
          <Field label="结束">
            <input
              type="date"
              className="input"
              value={toDateInputValue(endDate)}
              onChange={(event) => setEndDate(fromDateInputValue(event.target.value))}
            />
          </Field>
        </div>
        <p className="text-[11.5px] text-ink-3">
          {startDate > 0 && endDate > 0
            ? `${formatDate(startDate)} — ${formatDate(endDate)}`
            : '设置日期后，记录会自动按天归组'}
        </p>
      </FormBlock>

      <FormBlock title="封面与备注">
        <div className="space-y-2">
          <span className="field-label">封面</span>
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((index) => (
              <button
                key={index}
                type="button"
                aria-label={`封面样式 ${index + 1}`}
                onClick={() => setCover(index)}
                className={cn(
                  'press h-12 flex-1 rounded-xl',
                  coverClass(index),
                  cover === index && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                )}
              />
            ))}
          </div>
        </div>
        <Field label="旅行备注" hint="写给这段旅程的一句话">
          <textarea
            className="input-area"
            rows={3}
            value={note}
            maxLength={160}
            placeholder="比如：从札幌一路到函馆，海风、拉面和一整夜的路灯。"
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </FormBlock>

      {original ? (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="press mx-auto flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12.5px] text-ink-3 hover:text-danger"
        >
          <Trash size={14} />
          删除这段旅程
        </button>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="删除这段旅程？"
        message="旅程下的图文、账目、清单与足迹都会一并删除，且无法恢复。"
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </EditorScreen>
  )
}