import { useEffect, useRef, useState } from 'react'
import { ImageSquare, Plus, Trash } from '@phosphor-icons/react'
import type { Moment, Photo, Trip } from '../lib/types'
import { deleteMoment, getTrip, listMoments, saveMoment } from '../lib/repo'
import { useNav, useRefresh, useToast } from '../lib/app-context'
import { compressImage, dayIndexInTrip, uid } from '../lib/utils'
import { EditorScreen, FormBlock } from '../components/EditorScreen'
import { ConfirmDialog, Field } from '../components/ui'
import { PhotoStrip } from '../components/cards'

const MAX_PHOTOS = 9

export function MomentEditor({ tripId, momentId }: { tripId: string; momentId?: string }) {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const fileRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [original, setOriginal] = useState<Moment | null>(null)
  const [trip, setTrip] = useState<Trip | undefined>(undefined)

  const [content, setContent] = useState('')
  const [locationName, setLocationName] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [dayIndex, setDayIndex] = useState(1)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const loadedTrip = await getTrip(tripId)
      if (!alive) return
      setTrip(loadedTrip)

      if (momentId) {
        const moments = await listMoments(tripId)
        const target = moments.find((item) => item.id === momentId)
        if (target) {
          setOriginal(target)
          setContent(target.content)
          setLocationName(target.locationName)
          setPhotos(target.photos ?? [])
          setDayIndex(target.dayIndex || 1)
        }
      } else if (loadedTrip) {
        const day = dayIndexInTrip(loadedTrip.startDate, Date.now())
        setDayIndex(day > 0 ? day : 1)
      }
      if (alive) setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [tripId, momentId])

  const pickPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const next = [...photos]
      for (const file of Array.from(files)) {
        if (next.length >= MAX_PHOTOS) break
        const src = await compressImage(file)
        next.push({ id: uid(), src })
      }
      setPhotos(next)
    } catch {
      toast('图片处理失败，换一张试试')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const save = async () => {
    if (!content.trim() && photos.length === 0) {
      setError('至少写一句文字或加一张照片')
      return
    }
    setError('')
    setSaving(true)
    try {
      await saveMoment({
        id: original?.id ?? '',
        tripId,
        dayIndex,
        content: content.trim(),
        locationName: locationName.trim(),
        latitude: original?.latitude ?? 0,
        longitude: original?.longitude ?? 0,
        createdAt: original?.createdAt ?? 0,
        updatedAt: 0,
        syncState: 1,
        photos,
      })
      bump()
      toast('记录已保存')
      nav.back()
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!original) return
    await deleteMoment(original.id)
    bump()
    toast('记录已删除')
    nav.back()
  }

  return (
    <EditorScreen
      title={momentId ? '编辑记录' : '添加记录'}
      onBack={() => nav.back()}
      onSave={save}
      saving={saving}
      saveDisabled={loading || uploading}
    >
      <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent">
          第 {dayIndex} 天
        </span>
        {trip ? <span className="truncate">{trip.title}</span> : null}
      </div>

      <FormBlock title="这一刻">
        <Field label="文字" error={error}>
          <textarea
            className={error ? 'input-area border-danger' : 'input-area'}
            rows={6}
            value={content}
            placeholder="记录下此刻的心情和故事…"
            onChange={(event) => {
              setContent(event.target.value)
              if (error) setError('')
            }}
          />
        </Field>
        <Field label="地点" hint="会显示在记录上方，可用于之后整理足迹">
          <input
            className="input"
            value={locationName}
            placeholder="例如「小樽运河」"
            onChange={(event) => setLocationName(event.target.value)}
          />
        </Field>
      </FormBlock>

      <FormBlock title="照片" hint={`${photos.length}/${MAX_PHOTOS}`}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => pickPhotos(event.target.files)}
        />
        {photos.length > 0 ? (
          <PhotoStrip
            photos={photos}
            onRemove={(photoId) => setPhotos((previous) => previous.filter((item) => item.id !== photoId))}
          />
        ) : null}
        <button
          type="button"
          disabled={photos.length >= MAX_PHOTOS || uploading}
          onClick={() => fileRef.current?.click()}
          className="press flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-paper-2/40 py-3 text-[12.5px] text-ink-2 disabled:opacity-50"
        >
          {uploading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" />
              处理中…
            </>
          ) : (
            <>
              {photos.length >= MAX_PHOTOS ? <ImageSquare size={16} /> : <Plus size={16} weight="bold" />}
              {photos.length >= MAX_PHOTOS ? '已达到 9 张上限' : '从相册选择照片'}
            </>
          )}
        </button>
        <p className="text-[11px] leading-4 text-ink-3">
          照片会压缩后保存在本地，不会上传到任何服务器。
        </p>
      </FormBlock>

      {original ? (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="press mx-auto flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12.5px] text-ink-3 hover:text-danger"
        >
          <Trash size={14} />
          删除这条记录
        </button>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="删除这条记录？"
        message="记录里的文字和照片都会一并删除。"
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </EditorScreen>
  )
}