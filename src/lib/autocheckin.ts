import { listFootprints, listTrips, saveFootprint } from './repo'
import { tripStatusOf } from './utils'
import { CHINA_CITIES } from './chinaCities'
import {
  clearNativeWatch,
  isNative,
  requestLocationPermission,
  watchNativeFix,
  type Fix,
} from './native'

export interface AutoCheckinSettings {
  enabled: boolean
  radius: number
  cooldownMs: number
  /** 常驻地（家 / 公司）坐标，附近不自动打卡 */
  homeLat?: number
  homeLng?: number
  homeRadius?: number
}

const KEY = 'travelog.autocheckin'
const DEFAULT: AutoCheckinSettings = {
  enabled: false,
  radius: 200,
  cooldownMs: 6 * 60 * 60 * 1000,
  homeRadius: 500,
}

export function getAutoCheckinSettings(): AutoCheckinSettings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT, ...(JSON.parse(raw) as Partial<AutoCheckinSettings>) } : { ...DEFAULT }
  } catch {
    return { ...DEFAULT }
  }
}

export function setAutoCheckinSettings(patch: Partial<AutoCheckinSettings>): AutoCheckinSettings {
  const next = { ...getAutoCheckinSettings(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

type FootprintLite = {
  id: string
  placeName: string
  city: string
  latitude: number
  longitude: number
}

let watchId: number | null = null
let nativeWatchId: string | null = null
let lastHit: { key: string; at: number } | null = null
let cache: { at: number; footprints: FootprintLite[]; tripId: string } | null = null

async function loadCache(): Promise<{ footprints: FootprintLite[]; tripId: string }> {
  if (cache && Date.now() - cache.at < 30000) return cache
  const [footprints, trips] = await Promise.all([listFootprints(), listTrips()])
  const ongoing = trips.find((trip) => tripStatusOf(trip.startDate, trip.endDate) === 'ongoing')
  cache = {
    at: Date.now(),
    footprints: footprints
      .filter((item) => item.latitude !== 0 || item.longitude !== 0)
      .map((item) => ({
        id: item.id,
        placeName: item.placeName,
        city: item.city,
        latitude: item.latitude,
        longitude: item.longitude,
      })),
    tripId: ongoing?.id ?? '',
  }
  return cache
}

export interface AutoCheckinEvent {
  type: 'checked' | 'nearby' | 'error' | 'started'
  place?: string
  distance?: number
  message?: string
}

function nearestCity(
  latitude: number,
  longitude: number,
): { item: (typeof CHINA_CITIES)[number]; distance: number } | null {
  let best: { item: (typeof CHINA_CITIES)[number]; distance: number } | null = null
  for (const item of CHINA_CITIES) {
    const distance = distanceMeters(latitude, longitude, item.lat, item.lng)
    if (!best || distance < best.distance) best = { item, distance }
  }
  return best
}

function cooled(key: string, cooldownMs: number): boolean {
  const now = Date.now()
  if (lastHit && lastHit.key === key && now - lastHit.at < cooldownMs) return false
  lastHit = { key, at: now }
  return true
}

async function record(
  placeName: string,
  city: string,
  fix: Fix,
  tripId: string,
  note: string,
): Promise<void> {
  const now = Date.now()
  await saveFootprint({
    id: '',
    tripId,
    placeName,
    city,
    latitude: fix.latitude,
    longitude: fix.longitude,
    note,
    visitedAt: now,
    createdAt: now,
  })
  cache = null
}

export interface AutoCheckinStatus {
  running: boolean
  lastFixAt: number
  latitude: number
  longitude: number
  lastMatch: string
  lastEvent: string
  lastEventAt: number
}

let status: AutoCheckinStatus = {
  running: false,
  lastFixAt: 0,
  latitude: 0,
  longitude: 0,
  lastMatch: '',
  lastEvent: '',
  lastEventAt: 0,
}

export function getAutoCheckinStatus(): AutoCheckinStatus {
  return { ...status, running: isAutoCheckinRunning() }
}

function noteEvent(text: string): void {
  status.lastEvent = text
  status.lastEventAt = Date.now()
}

/** 命中已知地点用其名称；否则用最近国内城市识别周边地名 */
async function handleFix(
  fix: Fix,
  settings: AutoCheckinSettings,
  listener?: (event: AutoCheckinEvent) => void,
): Promise<void> {
  status.lastFixAt = Date.now()
  status.latitude = fix.latitude
  status.longitude = fix.longitude

  // 常驻地（家 / 公司）附近不打卡，避免一直记录同一个地方
  if (settings.homeLat != null && settings.homeLng != null) {
    const homeRadius = settings.homeRadius ?? 500
    const toHome = distanceMeters(fix.latitude, fix.longitude, settings.homeLat, settings.homeLng)
    if (toHome <= homeRadius) {
      status.lastMatch = `常驻地范围内（${Math.round(toHome)} 米），跳过`
      noteEvent('常驻地免打扰')
      return
    }
  }

  const { footprints, tripId } = await loadCache()

  let nearest: { item: FootprintLite; distance: number } | null = null
  for (const item of footprints) {
    const distance = distanceMeters(fix.latitude, fix.longitude, item.latitude, item.longitude)
    if (!nearest || distance < nearest.distance) nearest = { item, distance }
  }

  if (nearest && nearest.distance <= settings.radius) {
    status.lastMatch = `地点：${nearest.item.placeName}（${Math.round(nearest.distance)} 米）`
    if (!cooled(nearest.item.placeName, settings.cooldownMs)) {
      noteEvent('命中已知地点，但仍在冷却')
      return
    }
    await record(nearest.item.placeName, nearest.item.city, fix, tripId, '自动打卡')
    noteEvent(`已打卡：${nearest.item.placeName}`)
    listener?.({ type: 'checked', place: nearest.item.placeName, distance: nearest.distance })
    return
  }

  const city = nearestCity(fix.latitude, fix.longitude)
  if (!city) {
    status.lastMatch = '未匹配到城市'
    noteEvent('未匹配到城市')
    return
  }
  if (city.distance > 50000) {
    status.lastMatch = `城市：${city.item.name}（${(city.distance / 1000).toFixed(1)} 公里）`
    noteEvent('最近城市超过 50 公里，不打卡')
    return
  }

  // 优先用该市最近的区县，能精确到「龙泉驿区附近」而不是「成都附近」
  let district: { name: string; distance: number } | null = null
  for (const item of city.item.districts) {
    const distance = distanceMeters(fix.latitude, fix.longitude, item.lat, item.lng)
    if (!district || distance < district.distance) district = { name: item.name, distance }
  }

  const placeName =
    district && district.distance <= 25000 ? `${district.name}附近` : `${city.item.short}附近`
  status.lastMatch = `${placeName}（${(city.distance / 1000).toFixed(1)} 公里）`

  const key = `city:${city.item.name}`
  if (!cooled(key, settings.cooldownMs)) {
    noteEvent('该城市已打卡，冷却中')
    return
  }
  await record(placeName, city.item.name, fix, tripId, '自动打卡（周边地名）')
  noteEvent(`已打卡：${placeName}`)
  listener?.({ type: 'checked', place: placeName, distance: city.distance })
}

/**
 * 原生端走 Capacitor Geolocation（WebView 的 navigator.geolocation 在部分机型不可用），
 * 浏览器端继续用 navigator.geolocation。返回停止函数。
 */
export function startAutoCheckin(listener?: (event: AutoCheckinEvent) => void): () => void {
  const settings = getAutoCheckinSettings()
  if (!settings.enabled) return () => {}
  if (isAutoCheckinRunning()) return () => stopAutoCheckin()

  listener?.({ type: 'started' })

  if (isNative()) {
    void (async () => {
      const allowed = await requestLocationPermission()
      if (!allowed) {
        listener?.({ type: 'error', message: '未授予定位权限，请在系统设置里打开' })
        return
      }
      nativeWatchId = await watchNativeFix(
        (fix) => {
          void handleFix(fix, settings, listener).catch((error) =>
            listener?.({ type: 'error', message: (error as Error).message }),
          )
        },
        (message) => listener?.({ type: 'error', message }),
      )
      if (!nativeWatchId) listener?.({ type: 'error', message: '无法启动原生定位' })
    })()
    return () => stopAutoCheckin()
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    listener?.({ type: 'error', message: '当前环境不支持定位' })
    return () => {}
  }

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const fix = { latitude: position.coords.latitude, longitude: position.coords.longitude }
      void handleFix(fix, settings, listener).catch((error) =>
        listener?.({ type: 'error', message: (error as Error).message }),
      )
    },
    (error) => listener?.({ type: 'error', message: error.message }),
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 },
  )

  return () => stopAutoCheckin()
}

export function stopAutoCheckin(): void {
  if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId)
  }
  watchId = null
  if (nativeWatchId) {
    void clearNativeWatch(nativeWatchId)
    nativeWatchId = null
  }
  cache = null
  lastHit = null
}

export function isAutoCheckinRunning(): boolean {
  return watchId !== null || nativeWatchId !== null
}