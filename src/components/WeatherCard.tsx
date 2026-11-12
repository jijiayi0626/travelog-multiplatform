import { useEffect, useState } from 'react'
import { CloudSun, Drop, Wind } from '@phosphor-icons/react'
import { fetchWeather, geocode, type WeatherNow } from '../lib/cloud'
import { useI18n } from '../lib/app-context'
import { cn } from '../lib/cn'

const WEATHER_LABEL: Record<number, string> = {
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '有雾',
  48: '雾凇',
  51: '毛毛雨',
  53: '小雨',
  55: '中雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨',
  81: '强阵雨',
  82: '暴雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷阵雨',
  96: '雷阵雨伴冰雹',
  99: '强雷雨',
}

function describe(code: number): string {
  return WEATHER_LABEL[code] ?? '未知'
}

function isWet(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95
}

/** 常见国家的中文 → open-meteo 英文名，避免「高松」错配到四川 */
const COUNTRY_HINT: Record<string, string> = {
  日本: 'Japan',
  韩国: 'South Korea',
  泰国: 'Thailand',
  越南: 'Vietnam',
  新加坡: 'Singapore',
  马来西亚: 'Malaysia',
  印尼: 'Indonesia',
  菲律宾: 'Philippines',
  中国: 'China',
}

/**
 * 行程天气：用目的地做地理编码，再拉未来几天预报。
 * 目的地常写成「日本 · 高松 / 直岛」，逐个候选查询，并用国家名校验；
 * 都失败则静默隐藏，不打扰主流程。
 */
export function WeatherCard({ destination, className }: { destination: string; className?: string }) {
  const { tr } = useI18n()
  const [weather, setWeather] = useState<WeatherNow | null>(null)
  const [place, setPlace] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const raw = destination.trim()
    if (!raw) {
      setWeather(null)
      return
    }

    // 「日本 · 高松 / 直岛」→ 先试具体地名，再试整串
    const parts = raw
      .split(/[·,，/|、\s]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
    const countryKey = Object.keys(COUNTRY_HINT).find((key) => raw.includes(key))
    const country = countryKey ? COUNTRY_HINT[countryKey] : ''

    // 中文城市名在 open-meteo 常查不到、或错配到国内同名地点；
    // 常见境外目的地补英文名，优先用它查询，能精确到市
    const ALIAS: Record<string, string> = {
      北海道: 'Hokkaido',
      高松: 'Takamatsu',
      直岛: 'Naoshima',
      京都: 'Kyoto',
      东京: 'Tokyo',
      大阪: 'Osaka',
      札幌: 'Sapporo',
      冲绳: 'Okinawa',
      福冈: 'Fukuoka',
      首尔: 'Seoul',
      釜山: 'Busan',
      曼谷: 'Bangkok',
      清迈: 'Chiang Mai',
      台北: 'Taipei',
      香港: 'Hong Kong',
      澳门: 'Macau',
    }
    const cityCandidates: Array<{ query: string; label: string }> = []
    for (const name of parts.reverse()) {
      if (ALIAS[name]) cityCandidates.push({ query: ALIAS[name], label: name })
      cityCandidates.push({ query: name, label: name })
    }
    const candidates = [...cityCandidates, { query: raw, label: raw }].filter(
      (item, index, list) => list.findIndex((other) => other.query === item.query) === index,
    )

    let alive = true
    setLoading(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          for (const candidate of candidates) {
            if (!alive) return
            const geo = await geocode(candidate.query)
            if (!geo.found || geo.latitude == null || geo.longitude == null) continue
            if (countryKey) {
              // 后端用 language=zh，country 可能返回「日本」而不是「Japan」
              const got = (geo.country || '').toLowerCase()
              const ok = got.includes(countryKey) || got.includes(country.toLowerCase())
              if (got && !ok) continue
            }
            const next = await fetchWeather(geo.latitude, geo.longitude, 5)
            if (!alive) return
            setPlace(geo.name || candidate.label)
            setWeather(next)
            return
          }
          setWeather(null)
        } catch {
          if (alive) setWeather(null)
        } finally {
          if (alive) setLoading(false)
        }
      })()
    }, 400)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [destination])

  if (!weather || loading) return null

  return (
    <section className={cn('card p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-note font-semibold text-ink">
            <CloudSun size={15} className="text-accent" />
            {tr('目的地天气')} · {place}
          </p>
          <p className="mt-1 text-caption text-ink-3">
            {tr('未来 3 天预报，出行前再确认一次')}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-title font-semibold tabular-nums leading-none text-ink">
            {Math.round(weather.temperature)}°
          </p>
          <p className="mt-1 text-caption text-ink-3">{describe(weather.weatherCode)}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {weather.days.slice(0, 3).map((day) => (
          <div
            key={day.date}
            className={cn(
              'rounded-xl border px-2 py-2 text-center',
              isWet(day.code) ? 'border-accent/30 bg-accent-soft/50' : 'border-line bg-paper-2',
            )}
          >
            <p className="text-caption text-ink-3">{day.date.slice(5)}</p>
            <p className="mt-0.5 text-body-sm font-medium tabular-nums text-ink">
              {Math.round(day.max)}° / {Math.round(day.min)}°
            </p>
            <p className="mt-0.5 truncate text-caption text-ink-2">{describe(day.code)}</p>
            <p className="mt-0.5 flex items-center justify-center gap-0.5 text-caption tabular-nums text-ink-3">
              <Drop size={10} />
              {Math.round(day.rain)}%
            </p>
          </div>
        ))}
      </div>

      <p className="mt-2 flex items-center gap-1 text-caption text-ink-3">
        <Wind size={11} />
        {tr('风速 {v} km/h · 湿度 {h}%', {
          v: Math.round(weather.wind),
          h: Math.round(weather.humidity),
        })}
      </p>
    </section>
  )
}