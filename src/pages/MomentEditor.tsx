import { useEffect, useRef, useState } from 'react'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import {
  Camera as CameraIcon,
  ImageSquare,
  Microphone,
  Plus,
  Sparkle,
  StopCircle,
  Trash,
} from '@phosphor-icons/react'
import type { Moment, Photo, Trip } from '../lib/types'
import { deleteMoment, getTrip, listMoments, saveMoment } from '../lib/repo'
import { deleteCloudPhoto, isSignedIn } from '../lib/cloud'
import { useNav, useRefresh, useI18n, useToast } from '../lib/app-context'
import { compressDataUrl, compressImage, dayIndexInTrip, tripDayCount, uid } from '../lib/utils'
import { polishMoment } from '../lib/ai'
import { readFileDate, readFileGps } from '../lib/exif'
import { locateProvince } from '../lib/province'
import { locateCity } from '../lib/chinaCities'
import { isNative } from '../lib/native'
import { isVoskModelReady, startOfflineListening } from '../lib/offline-speech'
import { cn } from '../lib/cn'
import { EditorScreen, FormBlock } from '../components/EditorScreen'
import { ConfirmDialog, Field } from '../components/ui'
import { PhotoStrip } from '../components/cards'

const MAX_PHOTOS = 9
const TAG_PRESETS = ['美食', '散步', '风景', '住宿', '交通', '购物', '夜生活', '拍照']

/** 浏览器语音识别的最小类型，避免引入额外的 DOM 类型依赖 */
interface SpeechRecognitionResultLike {
  transcript: string
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

/** 语音失败时留一条可查的记录，方便在开发者模式里定位 */
function logVoiceError(message: string): void {
  console.warn('[travelog:voice]', message)
  try {
    localStorage.setItem('travelog.voiceLastError', `${new Date().toLocaleString()} ${message}`)
  } catch {
    /* 隐私模式写不了就算了 */
  }
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

export function MomentEditor({ tripId, momentId }: { tripId: string; momentId?: string }) {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { tr } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

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
  // 原生包走系统语音识别；浏览器不支持时，若已下载离线模型仍可回退
  const [offlineReady, setOfflineReady] = useState(false)
  const [offlinePrompt, setOfflinePrompt] = useState(false)
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const nativeListenersRef = useRef<Array<{ remove: () => Promise<void> }>>([])
  const nativeStoppingRef = useRef(false)
  const offlineStopRef = useRef<(() => Promise<void>) | null>(null)
  const offlineStartingRef = useRef(false)
  const offlineCancelledRef = useRef(false)
  // Vosk 的 partial 会在每个停顿后重置，需要单独累积已确定的分段
  const offlineFinalTextRef = useRef('')
  // 输入法下 state 可能滞后，保存时以 DOM 值为准
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const locationRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void isVoskModelReady().then((value) => {
      if (alive) setOfflineReady(value)
    })
    return () => {
      alive = false
    }
  }, [])

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

  const clearNativeListeners = () => {
    const listeners = nativeListenersRef.current
    nativeListenersRef.current = []
    for (const listener of listeners) void listener.remove().catch(() => undefined)
  }

  /**
   * 插件的 stop() 在 Android 上不会 resolve，所以不能 await；
   * 先立刻恢复按钮状态，再等一小会儿收最终识别结果，最后移除监听。
   */
  const stopNativeListening = () => {
    if (nativeStoppingRef.current) return
    nativeStoppingRef.current = true
    setListening(false)
    void import('@capacitor-community/speech-recognition')
      .then(({ SpeechRecognition: NativeSpeech }) => NativeSpeech.stop())
      .catch(() => undefined)
    window.setTimeout(() => {
      clearNativeListeners()
      nativeStoppingRef.current = false
    }, 1200)
  }

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      recognitionRef.current = null
      if (offlineStopRef.current) {
        void offlineStopRef.current()
        offlineStopRef.current = null
      }
      if (nativeListenersRef.current.length > 0) {
        void import('@capacitor-community/speech-recognition')
          .then(({ SpeechRecognition: NativeSpeech }) => NativeSpeech.stop())
          .catch(() => undefined)
        for (const listener of nativeListenersRef.current) void listener.remove()
        nativeListenersRef.current = []
      }
    }
  }, [])

  const stopOfflineListening = () => {
    const stop = offlineStopRef.current
    offlineStopRef.current = null
    setListening(false)
    if (stop) void stop()
  }

  /** 用本地 Vosk 模型识别；partial 实时覆盖，最终结果替换 partial */
  const beginOfflineListening = async () => {
    offlineStartingRef.current = true
    offlineCancelledRef.current = false
    offlineFinalTextRef.current = ''
    const base = content
    setListening(true)
    toast(tr('正在加载离线语音模型，请稍候…'))
    try {
      const stop = await startOfflineListening({
        onResult: (text, isFinal) => {
          const value = text.trim()
          if (!value) return
          if (isFinal) offlineFinalTextRef.current += value
          const merged = `${offlineFinalTextRef.current}${isFinal ? '' : value}`
          if (!merged) return
          setContent(base ? `${base.trimEnd()}\n${merged}` : merged)
          if (error) setError('')
        },
        onError: (message) => {
          logVoiceError(`offline: ${message}`)
          toast(tr('离线语音识别失败：{msg}', { msg: message }))
          setListening(false)
        },
      })
      if (offlineCancelledRef.current) {
        offlineCancelledRef.current = false
        await stop()
        return
      }
      offlineStopRef.current = stop
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logVoiceError(`offline: ${message}`)
      toast(message)
      setListening(false)
    } finally {
      offlineStartingRef.current = false
    }
  }

  /** 系统语音不可用时：已下载模型就直接回退，否则引导去下载 */
  const fallbackToOffline = async () => {
    const ready = offlineReady || (await isVoskModelReady())
    if (!ready) {
      setOfflinePrompt(true)
      return
    }
    if (!offlineReady) setOfflineReady(true)
    await beginOfflineListening()
  }

  /** 点一下开始，再点一下停；第一次会申请麦克风权限 */
  const toggleListening = async () => {
    if (listening) {
      if (offlineStopRef.current) {
        stopOfflineListening()
        return
      }
      if (offlineStartingRef.current) {
        offlineCancelledRef.current = true
        setListening(false)
        return
      }
      if (isNative()) {
        stopNativeListening()
        return
      }
      recognitionRef.current?.stop()
      return
    }

    if (isNative()) {
      try {
        const { SpeechRecognition: NativeSpeech } = await import(
          '@capacitor-community/speech-recognition'
        )
        const available = await NativeSpeech.available()
        if (!available.available) {
          logVoiceError('native: 系统没有可用的语音识别服务')
          await fallbackToOffline()
          return
        }
        let permission = (await NativeSpeech.checkPermissions()).speechRecognition
        if (permission !== 'granted') {
          permission = (await NativeSpeech.requestPermissions()).speechRecognition
        }
        if (permission !== 'granted') {
          logVoiceError(`native: 麦克风权限 ${permission}`)
          toast(tr('需要麦克风权限才能语音输入'))
          return
        }

        const base = content
        let gotResult = false
        const partial = await NativeSpeech.addListener('partialResults', (data) => {
          const text = (data.matches?.[0] || '').trim()
          if (!text) return
          gotResult = true
          setContent(base ? `${base.trimEnd()}\n${text}` : text)
          if (error) setError('')
        })
        const state = await NativeSpeech.addListener('listeningState', (data) => {
          if (data.status === 'stopped' && !nativeStoppingRef.current) {
            setListening(false)
            clearNativeListeners()
          }
        })
        nativeListenersRef.current = [partial, state]
        // partialResults 模式下 start() 不会 resolve，不能 await
        setListening(true)
        void NativeSpeech.start({
          language: 'zh-CN',
          maxResults: 5,
          partialResults: true,
          popup: false,
        }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          logVoiceError(`native start: ${message}`)
          setListening(false)
          clearNativeListeners()
          toast(tr('语音识别失败：{msg}', { msg: message }))
        })

        // start() 在 partialResults 模式下不 resolve；用系统监听状态兜底检测启动失败
        window.setTimeout(() => {
          if (nativeStoppingRef.current || gotResult) return
          void NativeSpeech.isListening()
            .then(({ listening: active }) => {
              if (active) return
              logVoiceError('native: 启动后未进入监听状态')
              setListening(false)
              clearNativeListeners()
              toast(tr('语音识别没有启动，请检查系统语音服务'))
            })
            .catch(() => {
              /* 旧版本插件没有 isListening 时忽略 */
            })
        }, 6000)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logVoiceError(`native: ${message}`)
        setListening(false)
        clearNativeListeners()
        toast(tr('语音识别失败：{msg}', { msg: message }))
      }
      return
    }

    const Recognition = getSpeechRecognition()
    if (!Recognition) {
      await fallbackToOffline()
      return
    }
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((track) => track.stop())
      }
    } catch {
      toast(tr('需要麦克风权限才能语音输入'))
      return
    }

    const recognition = new Recognition()
    const base = content
    recognition.lang = 'zh-CN'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      let text = ''
      for (let i = 0; i < event.results.length; i += 1) {
        text += event.results[i]?.[0]?.transcript ?? ''
      }
      const value = text.trim()
      if (!value) return
      setContent(base ? `${base.trimEnd()}\n${value}` : value)
      if (error) setError('')
    }
    recognition.onerror = (event) => {
      const message = event?.error || 'unknown'
      logVoiceError(`web: ${message}`)
      setListening(false)
      recognitionRef.current = null
      if (
        message === 'not-allowed' ||
        message === 'service-not-allowed' ||
        message === 'audio-capture'
      ) {
        // 避免随后的 onend 把离线识别的 listening 状态重置掉
        recognition.onend = null
        void fallbackToOffline()
        return
      }
      if (message === 'no-speech' || message === 'aborted') {
        toast(tr('没能听清，请再试一次'))
      } else {
        toast(tr('语音识别失败：{msg}', { msg: message }))
      }
    }
    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      recognitionRef.current = null
      setListening(false)
    }
  }

  const pickPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const next = [...photos]
      let gpsHit: { lat: number; lng: number } | null = null
      let dateHit: number | null = null
      for (const file of Array.from(files)) {
        if (next.length >= MAX_PHOTOS) break
        if (!coords && !gpsHit) {
          const gps = await readFileGps(file)
          if (gps) gpsHit = { lat: gps.latitude, lng: gps.longitude }
        }
        if (!dateHit) {
          const taken = await readFileDate(file)
          if (taken) dateHit = taken
        }
        const src = await compressImage(file)
        next.push({ id: uid(), src })
      }
      setPhotos(next)

      let dayHit = 0
      if (dateHit && !momentId && trip && trip.startDate > 0) {
        const index = dayIndexInTrip(trip.startDate, dateHit)
        const max = tripDayCount(trip.startDate, trip.endDate)
        if (index >= 1 && (!max || index <= max)) dayHit = index
      }
      if (dayHit > 0) {
        setDayIndex(dayHit)
        toast(tr('已按照片拍摄日期归入第 {n} 天', { n: dayHit }))
      }

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
      if (cameraRef.current) cameraRef.current.value = ''
    }
  }

  /** 原生拍照：压缩后按与相册选择相同的 Photo 结构追加 */
  const capturePhoto = async () => {
    if (photos.length >= MAX_PHOTOS || uploading) return
    if (!isNative()) {
      cameraRef.current?.click()
      return
    }
    setUploading(true)
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
      const src = await compressDataUrl(`data:${mime};base64,${photo.base64String}`)
      setPhotos((previous) =>
        previous.length >= MAX_PHOTOS ? previous : [...previous, { id: uid(), src }],
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/cancel/i.test(message)) toast(tr('未获得相机权限'))
    } finally {
      setUploading(false)
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
      // 编辑时移除的照片同步清理 R2，避免孤儿文件持续占用空间
      if (original && isSignedIn() && navigator.onLine) {
        const kept = new Set(photos.map((photo) => photo.cloudId).filter(Boolean))
        for (const photo of original.photos ?? []) {
          if (photo.cloudId && !kept.has(photo.cloudId)) {
            void deleteCloudPhoto(photo.cloudId).catch(() => undefined)
          }
        }
      }
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
    const cloudIds = (original.photos ?? []).map((photo) => photo.cloudId).filter(Boolean) as string[]
    await deleteMoment(original.id)
    if (isSignedIn() && navigator.onLine) {
      for (const cloudId of cloudIds) void deleteCloudPhoto(cloudId).catch(() => undefined)
    }
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
                onClick={toggleListening}
                aria-label={listening ? tr('停止语音输入') : tr('语音输入')}
                className={cn(
                  'press inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption',
                  listening
                    ? 'border-transparent bg-accent-soft text-accent'
                    : 'border-line text-ink-2 hover:text-accent',
                )}
              >
                {listening ? <StopCircle size={11} weight="fill" /> : <Microphone size={11} />}
                {listening ? tr('点击停止') : tr('语音')}
              </button>
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
            type="text"
            inputMode="text"
            autoComplete="off"
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
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => pickPhotos(event.target.files)}
        />
        {photos.length > 0 ? (
          <PhotoStrip
            photos={photos}
            onRemove={(photoId) => setPhotos((previous) => previous.filter((item) => item.id !== photoId))}
          />
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={photos.length >= MAX_PHOTOS || uploading}
            onClick={() => fileRef.current?.click()}
            className="press flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-paper-2/40 py-3 text-body-sm text-ink-2 disabled:opacity-50"
          >
            {photos.length >= MAX_PHOTOS ? <ImageSquare size={16} /> : <Plus size={16} weight="bold" />}
            {photos.length >= MAX_PHOTOS ? tr('已达到 9 张上限') : tr('从相册选择')}
          </button>
          <button
            type="button"
            disabled={photos.length >= MAX_PHOTOS || uploading}
            onClick={() => void capturePhoto()}
            className="press flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-paper-2/40 py-3 text-body-sm text-ink-2 disabled:opacity-50"
          >
            {uploading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" />
                {tr('处理中…')}
              </>
            ) : (
              <>
                <CameraIcon size={16} />
                {tr('拍照')}
              </>
            )}
          </button>
        </div>
        <p className="text-caption leading-4 text-ink-3">
          {tr('照片会压缩后保存在本地，登录云同步后自动上传到云端。')}
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

      <ConfirmDialog
        open={offlinePrompt}
        title={tr('语音服务不可用')}
        message={tr('当前设备语音服务不可用，可下载离线语音模型')}
        confirmText={tr('去下载')}
        tone="accent"
        onClose={() => setOfflinePrompt(false)}
        onConfirm={() => nav.navigate({ name: 'ocrModel' })}
      />
    </EditorScreen>
  )
}