import { useEffect, useRef, useState } from 'react'
import { ImageSquare, Plus, Sparkle, Trash } from '@phosphor-icons/react'
import type { Moment, Photo, Trip } from '../lib/types'
import { deleteMoment, getTrip, listMoments, saveMoment } from '../lib/repo'
import { useNav, useRefresh, useI18n, useToast } from '../lib/app-context'
import { compressImage, dayIndexInTrip, uid } from '../lib/utils'
import { polishMoment } from '../lib/ai'
import { readFileGps } from '../lib/exif'
import { locateProvince } from '../lib/province'
import { locateCity } from '../lib/chinaCities'
import { cn } from '../lib/cn'
import { EditorScreen, FormBlock } from '../components/EditorScreen'
import { ConfirmDialog, Field } from '../components/ui'
import { PhotoStrip } from '../components/cards'

const MAX_PHOTOS = 9
const TAG_PRESETS = ['美食', '散步', '风景', '住宿', '交通', '购物', '夜生活', '拍照']

export function MomentEditor({ tripId, momentId }: { tripId: string; momentId?: string }) {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { tr } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(Boolean(momentId))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [original, setOriginal] = useState<Moment | null>(null)
  const [trip, setTrip] = useState<Trip | undefined>(undefined)

  const [content, setContent] = useState('')
  const [previousContent, setPreviousContent] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [polishing, setPolishing] = useState(false)
  const [locationName, setLocationName] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [dayIndex, setDayIndex] = useState(1)
  const [tags, setTags] = useState<string[]>([])
  const [customTag, setCustomTag] = useState('')
  const [error, setError] = useState('')
  // 输入法下 state 可能滞后，保存时以 DOM 值为准
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const locationRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
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
            if (target.latitude !== 0 || target.longitude !== 0) {
              setCoords({ lat: target.latitude, lng: target.longitude })
            }
            setPhotos(target.photos ?? [])
            setDayIndex(target.dayIndex || 1)
            setTags(target.tags ?? [])
          }
        } else if (loadedTrip) {
          const day = dayIndexInTrip(loadedTrip.startDate, Date.now())
          setDayIndex(day > 0 ? day : 1)
        }
      } catch {
        // 读取失败也要放开保存，避免按钮永久禁用
      } finally {
        if (alive) setLoading(false)
      }
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
      let gpsHit: { lat: number; lng: number } | null = null
      for (const file of Array.from(files)) {
        if (next.length >= MAX_PHOTOS) break
        if (!coords && !gpsHit) {
          const gps = await readFileGps(file)
          if (gps) gpsHit = { lat: gps.latitude, lng: gps.longitude }
        }
        const src = await compressImage(file)
        next.push({ id: uid(), src })
      }
      setPhotos(next)

      if (gpsHit) {
        setCoords(gpsHit)
        if (!locationName.trim()) {
          const province = locateProvince(gpsHit.lat, gpsHit.lng)
          const located = locateCity(gpsHit.lat, gpsHit.lng, province?.short)
          if (located?.city) setLocationName(located.city.short)
        }
        toast(tr('已从照片读取拍摄位置'))
      }
    } catch {
      toast(tr('图片处理失败，换一张试试'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const polish = async () => {
    if (!content.trim()) {
      toast(tr('先写几句再润色'))
      return
    }
    setPolishing(true)
    try {
      const before = content
      const text = await polishMoment(content, {
        trip: trip?.title,
        location: locationName,
        date: original ? undefined : undefined,
      })
      setPreviousContent(before)
      setContent(text)
      toast(tr('已润色，可撤销'))
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('润色失败'))
    } finally {
      setPolishing(false)
    }
  }

  const save = async () => {
    // 以 DOM 实际值为准：部分输入法下 React state 会滞后
    const contentValue = (contentRef.current?.value ?? content).trim()
    const locationValue = (locationRef.current?.value ?? locationName).trim()
    if (!contentValue && photos.length === 0) {
      setError(tr('至少写一句文字或加一张照片'))
      return
    }
    setError('')
    setSaving(true)
    try {
      await saveMoment({
        id: original?.id ?? '',
        tripId,
        dayIndex,
        content: contentValue,
        locationName: locationValue,
        latitude: coords?.lat ?? original?.latitude ?? 0,
        longitude: coords?.lng ?? original?.longitude ?? 0,
        createdAt: original?.createdAt ?? 0,
        updatedAt: 0,
        syncState: 1,
        photos,
        tags,
      })
      bump()
      toast(tr('记录已保存'))
      nav.back()
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('保存失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!original) return
    await deleteMoment(original.id)
    bump()
    toast(tr('记录已删除'))
    nav.back()
  }

  return (
    <EditorScreen
      title={momentId ? tr('编辑记录') : tr('添加记录')}
      onBack={() => nav.back()}
      onSave={save}
      saving={saving}
      saveDisabled={loading || uploading}
    >
      <div className="flex items-center gap-2 text-note text-ink-3">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent">
          {tr('第 {n} 天', { n: dayIndex })}
        </span>
        {trip ? <span className="truncate">{trip.title}</span> : null}
      </div>

      <FormBlock title={tr('这一刻')}>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className={cn('field-label', error && 'text-danger')}>{error || tr('文字')}</span>
            <span className="flex items-center gap-2">
              {previousContent !== null ? (
                <button
                  type="button"
                  onClick={() => {
                    setContent(previousContent)
                    setPreviousContent(null)
                    toast(tr('已还原'))
                  }}
                  className="press text-caption text-ink-3 hover:text-ink"
                >
{tr('撤销')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={polish}
                disabled={polishing || !content.trim()}
                className="press inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-caption text-ink-2 disabled:opacity-40 hover:text-accent"
              >
                <Sparkle size={11} weight="fill" />
                {polishing ? tr('润色中…') : tr('AI 润色')}
              </button>
            </span>
          </div>
          <textarea
            ref={contentRef}
            className={error ? 'input-area border-danger' : 'input-area'}
            rows={6}
            value={content}
            placeholder={tr('记录下此刻的心情和故事…')}
            onChange={(event) => {
              setContent(event.target.value)
              if (error) setError('')
            }}
          />
        </div>
        <Field
          label={tr('地点')}
          hint={tr('会显示在记录上方，可用于之后整理足迹')}
        >
          <input
            ref={locationRef}
            type="text"
            inputMode="text"
            className="input"
            value={locationName}
            placeholder={tr('例如「小樽运河」')}
            onChange={(event) => setLocationName(event.target.value)}
          />
        </Field>

        <div className="space-y-2">
          <span className="field-label">{tr('标签')}</span>
          <div className="flex flex-wrap gap-1.5">
            {TAG_PRESETS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  setTags((previous) =>
                    previous.includes(tag) ? previous.filter((item) => item !== tag) : [...previous, tag],
                  )
                }
                className={cn('chip px-2.5 py-1 text-note', tags.includes(tag) && 'chip-active')}
              >
                #{tag}
              </button>
            ))}
          </div>
          <input
            className="input h-10 text-body-sm"
            value={customTag}
            placeholder={tr('自定义标签，回车添加')}
            onChange={(event) => setCustomTag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              const value = customTag.trim().replace(/^#/, '')
              if (!value) return
              setTags((previous) => (previous.includes(value) ? previous : [...previous, value]))
              setCustomTag('')
            }}
          />
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-caption text-ink-2"
                >
                  #{tag}
                  <button
                    type="button"
                    aria-label={tr('移除标签 {tag}', { tag })}
                    onClick={() => setTags((previous) => previous.filter((item) => item !== tag))}
                    className="text-ink-3 hover:text-danger"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </FormBlock>

      <FormBlock title={tr('照片')} hint={`${photos.length}/${MAX_PHOTOS}`}>
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
          className="press flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-paper-2/40 py-3 text-body-sm text-ink-2 disabled:opacity-50"
        >
          {uploading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" />
              {tr('处理中…')}
            </>
          ) : (
            <>
              {photos.length >= MAX_PHOTOS ? <ImageSquare size={16} /> : <Plus size={16} weight="bold" />}
              {photos.length >= MAX_PHOTOS ? tr('已达到 9 张上限') : tr('从相册选择照片')}
            </>
          )}
        </button>
        <p className="text-caption leading-4 text-ink-3">
          {tr('照片会压缩后保存在本地，不会上传到任何服务器。')}
        </p>
      </FormBlock>

      {original ? (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="press mx-auto flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-body-sm text-ink-3 hover:text-danger"
        >
          <Trash size={14} />
{tr('删除这条记录')}
        </button>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={tr('删除这条记录？')}
        message={tr('记录里的文字和照片都会一并删除。')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </EditorScreen>
  )
}