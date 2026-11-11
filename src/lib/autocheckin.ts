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
}

const KEY = 'travelog.autocheckin'
const DEFAULT: AutoCheckinSettings = {
  enabled: false,
  radius: 200,
  cooldownMs: 6 * 60 * 60 * 1000,
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

function nearestCity(latitude: number, longitude: number): { short: string; city: string; distance: number } | null {
  let best: { short: string; city: string; distance: number } | null = null
  for (const item of CHINA_CITIES) {
    const distance = distanceMeters(latitude, longitude, item.lat, item.lng)
    if (!best || distance < best.distance) best = { short: item.short, city: item.name, distance }
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

/** 命中已知地点用其名称；否则用最近国内城市识别周边地名 */
async function handleFix(
  fix: Fix,
  settings: AutoCheckinSettings,
  listener?: (event: AutoCheckinEvent) => void,
): Promise<void> {
  const { footprints, tripId } = await loadCache()

  let nearest: { item: FootprintLite; distance: number } | null = null
  for (const item of footprints) {
    const distance = distanceMeters(fix.latitude, fix.longitude, item.latitude, item.longitude)
    if (!nearest || distance < nearest.distance) nearest = { item, distance }
  }

  if (nearest && nearest.distance <= settings.radius) {
    if (!cooled(nearest.item.placeName, settings.cooldownMs)) return
    await record(nearest.item.placeName, nearest.item.city, fix, tripId, '自动打卡')
    listener?.({ type: 'checked', place: nearest.item.placeName, distance: nearest.distance })
    return
  }

  const city = nearestCity(fix.latitude, fix.longitude)
  if (!city || city.distance > 30000) return
  const key = `city:${city.city}`
  if (!cooled(key, settings.cooldownMs)) return
  const placeName = `${city.short}附近`
  await record(placeName, city.city, fix, tripId, '自动打卡（周边地名）')
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