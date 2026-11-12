import { useMemo, useRef, useState } from 'react'
import { Crosshair, MapPin } from '@phosphor-icons/react'
import { saveFootprint } from '../lib/repo'
import { useNav, useRefresh, useI18n, useToast } from '../lib/app-context'
import { todayStart } from '../lib/utils'
import { getBestFix, isNative } from '../lib/native'
import { searchPoi, type PoiItem } from '../lib/cloud'
import { CHINA_CITIES } from '../lib/chinaCities'
import { EditorScreen, FormBlock } from '../components/EditorScreen'
import { Field } from '../components/ui'

export function FootprintEditor() {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { tr } = useI18n()

  const [placeName, setPlaceName] = useState('')
  const [city, setCity] = useState('')
  const [note, setNote] = useState('')
  const [latitude, setLatitude] = useState(0)
  const [longitude, setLongitude] = useState(0)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // 输入法下 state 可能滞后，保存时以 DOM 值为准
  const placeRef = useRef<HTMLInputElement>(null)
  const [poiQuery, setPoiQuery] = useState('')
  const [poiResults, setPoiResults] = useState<PoiItem[]>([])
  const [poiLoading, setPoiLoading] = useState(false)

  const runPoiSearch = async () => {
    const query = poiQuery.trim() || '景区'
    setPoiLoading(true)
    try {
      const results = await searchPoi(
        query,
        latitude !== 0 ? latitude : undefined,
        longitude !== 0 ? longitude : undefined,
      )
      setPoiResults(results)
      if (results.length === 0) toast(tr('附近没搜到，换个关键词试试'))
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('搜索失败'))
    } finally {
      setPoiLoading(false)
    }
  }

  // 输入城市时给出匹配项，选中后可继续选区县
  const cityMatches = useMemo(() => {
    const query = city.trim()
    if (!query) return []
    return CHINA_CITIES.filter(
      (item) => item.name.includes(query) || item.short.includes(query),
    ).slice(0, 6)
  }, [city])

  const [pickedCity, setPickedCity] = useState<(typeof CHINA_CITIES)[number] | null>(null)

  const locate = async () => {
    setLocating(true)

    // App 内优先走原生定位：不依赖 Google Play 服务，且会自动降级到网络定位
    if (isNative()) {
      const fix = await getBestFix()
      setLocating(false)
      if (fix) {
        setLatitude(fix.latitude)
        setLongitude(fix.longitude)
        toast(tr('已取到当前位置'))
      } else {
        toast(tr('定位失败，可手动填写地点'))
      }
      return
    }

    if (!('geolocation' in navigator)) {
      setLocating(false)
      toast(tr('当前环境不支持定位，可手动填写'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude)
        setLongitude(position.coords.longitude)
        setLocating(false)
        toast(tr('已取到当前位置'))
      },
      () => {
        setLocating(false)
        toast(tr('定位失败，可手动填写地点'))
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60_000 },
    )
  }

  const save = async () => {
    // 以输入框实际值为准：部分输入法下 React state 会滞后
    const placeValue = (placeRef.current?.value ?? placeName).trim()
    if (!placeValue) {
      setError(tr('先填一个地点名称'))
      return
    }
    setError('')
    setSaving(true)
    try {
      await saveFootprint({
        id: '',
        tripId: '',
        placeName: placeValue,
        city: city.trim(),
        latitude,
        longitude,
        note: note.trim(),
        visitedAt: todayStart(),
        createdAt: 0,
      })
      bump()
      toast(tr('已记录足迹'))
      nav.back()
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('保存失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  const hasCoord = latitude !== 0 || longitude !== 0

  return (
    <EditorScreen
      title={tr('地点打卡')}
      onBack={() => nav.back()}
      onSave={save}
      saving={saving}
    >
      <FormBlock title={tr('地点')}>
        <Field label={tr('地点名称')} error={error}>
          <input
            ref={placeRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            className={error ? 'input border-danger' : 'input'}
            value={placeName}
            placeholder={tr('例如「函馆山」')}
            onChange={(event) => {
              setPlaceName(event.target.value)
              if (error) setError('')
            }}
          />
        </Field>
        <div className="space-y-2 rounded-2xl border border-line bg-surface p-3">
          <p className="text-note font-medium text-ink">{tr('搜索附近的地点')}</p>
          <p className="text-caption leading-4 text-ink-3">
            {latitude === 0 && longitude === 0
              ? tr('先点下方「使用当前位置」，才能搜索周边景点、街道和建筑')
              : tr('例如「宽窄巷子」「人民公园」「博物馆」')}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              className="input"
              value={poiQuery}
              placeholder={tr('景点 / 街道 / 建筑')}
              onChange={(event) => setPoiQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runPoiSearch()
              }}
            />
            <button
              type="button"
              className="btn-ghost h-[46px] shrink-0 px-3"
              disabled={poiLoading}
              onClick={runPoiSearch}
            >
              {poiLoading ? tr('搜索中…') : tr('搜索')}
            </button>
          </div>
          {/* 分类快捷：比自由输入命中率高，能直接看到周边的学校/公园等 */}
          <div className="flex flex-wrap gap-1.5">
            {['学校', '公园', '景点', '医院', '餐厅', '商场', '地铁站'].map((label) => (
              <button
                key={label}
                type="button"
                className="chip px-2 py-1 text-caption"
                disabled={poiLoading}
                onClick={async () => {
                  setPoiQuery(label)
                  setPoiLoading(true)
                  try {
                    const results = await searchPoi(
                      label,
                      latitude !== 0 ? latitude : undefined,
                      longitude !== 0 ? longitude : undefined,
                    )
                    setPoiResults(results)
                    if (results.length === 0) toast(tr('附近没搜到，换个关键词试试'))
                  } catch (error) {
                    toast(error instanceof Error ? error.message : tr('搜索失败'))
                  } finally {
                    setPoiLoading(false)
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {poiResults.length > 0 ? (
            <ul className="space-y-1">
              {poiResults.map((item) => (
                <li key={`${item.name}-${item.latitude}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setPlaceName(item.name)
                      setLatitude(item.latitude)
                      setLongitude(item.longitude)
                      setPoiResults([])
                      toast(tr('已填入「{name}」', { name: item.name }))
                    }}
                    className="press w-full rounded-xl border border-line px-2.5 py-2 text-left"
                  >
                    <span className="block truncate text-body-sm text-ink">{item.name}</span>
                    <span className="mt-0.5 block truncate text-caption text-ink-3">
                      {item.displayName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Field
          label={tr('城市')}
          hint={tr('填写城市名会自动归入省份，点亮足迹地图')}
        >
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            className="input"
            value={city}
            placeholder={tr('例如「杭州」「大理」')}
            onChange={(event) => {
              setCity(event.target.value)
              // 改了城市就清掉之前选的区县，否则区县列表会一直停在旧城市
              setPickedCity(null)
            }}
          />
        </Field>
        {cityMatches.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {cityMatches.map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() => {
                  setCity(item.name)
                  setPickedCity(item)
                }}
                className={
                  city === item.name
                    ? 'chip chip-active px-2 py-1 text-caption'
                    : 'chip px-2 py-1 text-caption'
                }
              >
                {item.name}
              </button>
            ))}
          </div>
        ) : null}
        {pickedCity && pickedCity.districts.length > 0 ? (
          <div className="space-y-1.5 rounded-2xl border border-line bg-surface p-2.5">
            <p className="text-caption text-ink-3">
              {tr('选择区县（可选，会填到地点名称与坐标）')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {pickedCity.districts.map((district) => (
                <button
                  key={district.name}
                  type="button"
                  onClick={() => {
                    if (!placeName.trim()) setPlaceName(district.name)
                    setLatitude(district.lat)
                    setLongitude(district.lng)
                    toast(tr('已选择「{name}」', { name: district.name }))
                  }}
                  className="chip px-2 py-1 text-caption"
                >
                  {district.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <Field label={tr('备注')}>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            className="input"
            value={note}
            placeholder={tr('例如「夜景，风很大」')}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </FormBlock>

      <FormBlock title={tr('坐标')} hint={hasCoord ? tr('已记录') : tr('可选')}>
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
              {locating ? tr('定位中…') : tr('使用当前位置')}
            </span>
            <span className="mt-0.5 block text-note tabular-nums text-ink-3">
              {hasCoord
                ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
                : tr('允许定位后可在地图中查看这个地点')}
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
            {tr('清除坐标')}
          </button>
        ) : null}
      </FormBlock>
    </EditorScreen>
  )
}