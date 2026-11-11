import { listFootprints, listTrips, saveFootprint } from './repo'
import { tripStatusOf } from './utils'

export interface AutoCheckinSettings {
  enabled: boolean
  /** 触发半径（米） */
  radius: number
  /** 同一地点再次打卡的最小间隔（毫秒） */
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

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

/**
 * 开始后台定位。命中 200m 内的已知地点时自动补一条足迹。
 * 返回停止函数；未开启或浏览器不支持时返回空函数。
 */
export function startAutoCheckin(listener?: (event: AutoCheckinEvent) => void): () => void {
  const settings = getAutoCheckinSettings()
  if (!settings.enabled) return () => {}
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    listener?.({ type: 'error', message: '当前环境不支持定位' })
    return () => {}
  }
  if (watchId !== null) return () => stopAutoCheckin()

  listener?.({ type: 'started' })

  watchId = navigator.geolocation.watchPosition(
    async (position) => {
      const { latitude, longitude } = position.coords
      try {
        const { footprints, tripId } = await loadCache()
        let nearest: { item: FootprintLite; distance: number } | null = null
        for (const item of footprints) {
          const distance = distanceMeters(latitude, longitude, item.latitude, item.longitude)
          if (!nearest || distance < nearest.distance) nearest = { item, distance }
        }
        if (!nearest || nearest.distance > settings.radius) return

        const key = nearest.item.placeName
        const now = Date.now()
        if (lastHit && lastHit.key === key && now - lastHit.at < settings.cooldownMs) {
          return
        }
        lastHit = { key, at: now }

        await saveFootprint({
          id: '',
          tripId,
          placeName: nearest.item.placeName,
          city: nearest.item.city,
          latitude,
          longitude,
          note: '自动打卡',
          visitedAt: now,
          createdAt: now,
        })
        cache = null
        listener?.({ type: 'checked', place: nearest.item.placeName, distance: nearest.distance })
      } catch (error) {
        listener?.({ type: 'error', message: (error as Error).message })
      }
    },
    (error) => {
      listener?.({ type: 'error', message: error.message })
    },
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 },
  )

  return () => stopAutoCheckin()
}

export function stopAutoCheckin(): void {
  if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId)
  }
  watchId = null
}

export function isAutoCheckinRunning(): boolean {
  return watchId !== null
}