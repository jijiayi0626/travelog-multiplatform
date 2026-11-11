import { useState } from 'react'
import { Crosshair, MapPin } from '@phosphor-icons/react'
import { saveFootprint } from '../lib/repo'
import { useNav, useRefresh, useToast } from '../lib/app-context'
import { todayStart } from '../lib/utils'
import { EditorScreen, FormBlock } from '../components/EditorScreen'
import { Field } from '../components/ui'

export function FootprintEditor() {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()

  const [placeName, setPlaceName] = useState('')
  const [city, setCity] = useState('')
  const [note, setNote] = useState('')
  const [latitude, setLatitude] = useState(0)
  const [longitude, setLongitude] = useState(0)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const locate = () => {
    if (!('geolocation' in navigator)) {
      toast('当前环境不支持定位，可手动填写')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude)
        setLongitude(position.coords.longitude)
        setLocating(false)
        toast('已取到当前位置')
      },
      () => {
        setLocating(false)
        toast('定位失败，可手动填写地点')
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    )
  }

  const save = async () => {
    if (!placeName.trim()) {
      setError('先填一个地点名称')
      return
    }
    setError('')
    setSaving(true)
    try {
      await saveFootprint({
        id: '',
        tripId: '',
        placeName: placeName.trim(),
        city: city.trim(),
        latitude,
        longitude,
        note: note.trim(),
        visitedAt: todayStart(),
        createdAt: 0,
      })
      bump()
      toast('已记录足迹')
      nav.back()
    } finally {
      setSaving(false)
    }
  }

  const hasCoord = latitude !== 0 || longitude !== 0

  return (
    <EditorScreen
      title="地点打卡"
      onBack={() => nav.back()}
      onSave={save}
      saving={saving}
    >
      <FormBlock title="地点">
        <Field label="地点名称" error={error}>
          <input
            className={error ? 'input border-danger' : 'input'}
            value={placeName}
            placeholder="例如「函馆山」"
            onChange={(event) => {
              setPlaceName(event.target.value)
              if (error) setError('')
            }}
          />
        </Field>
        <Field label="城市" hint="填写城市名会自动归入省份，点亮足迹地图">
          <input
            className="input"
            value={city}
            placeholder="例如「杭州」「大理」"
            onChange={(event) => setCity(event.target.value)}
            list="city-suggestions"
          />
          <datalist id="city-suggestions">
            {['北京', '上海', '广州', '深圳', '杭州', '成都', '大理', '厦门', '西安', '南京', '重庆', '青岛', '长沙', '武汉'].map(
              (item) => (
                <option key={item} value={item} />
              ),
            )}
          </datalist>
        </Field>
        <Field label="备注">
          <input
            className="input"
            value={note}
            placeholder="例如「夜景，风很大」"
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </FormBlock>

      <FormBlock title="坐标" hint={hasCoord ? '已记录' : '可选'}>
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className="press flex w-full items-center gap-3 rounded-xl border border-line bg-paper-2/50 px-3.5 py-3 text-left disabled:opacity-60"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-accent">
            {locating ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            ) : (
              <Crosshair size={17} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body-sm font-medium text-ink">
              {locating ? '定位中…' : '使用当前位置'}
            </span>
            <span className="mt-0.5 block text-note tabular-nums text-ink-3">
              {hasCoord
                ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
                : '允许定位后可在地图中查看这个地点'}
            </span>
          </span>
          <MapPin size={16} className="shrink-0 text-ink-3" />
        </button>
        {hasCoord ? (
          <button
            type="button"
            onClick={() => {
              setLatitude(0)
              setLongitude(0)
            }}
            className="press self-start text-note text-ink-3 underline-offset-2 hover:text-danger hover:underline"
          >
            清除坐标
          </button>
        ) : null}
      </FormBlock>
    </EditorScreen>
  )
}