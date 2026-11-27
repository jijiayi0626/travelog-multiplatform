import { listFootprints, listTrips, saveFootprint } from './repo'
import { tripStatusOf } from './utils'
import { CHINA_CITIES } from './chinaCities'
import { reverseGeocode } from './cloud'
import {
  clearNativeWatch,
  getBestFix,
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
): { short: string; province: string; city: string; distance: number } | null {
  let best: { short: string; province: string; city: string; distance: number } | null = null
  for (const item of CHINA_CITIES) {
    const distance = distanceMeters(latitude, longitude, item.lat, item.lng)
    if (!best || distance < best.distance) {
      best = { short: item.short, province: item.province, city: item.name, distance }
    }
  }
  return best
}

/** 城市名归一化：去掉行政级别后缀，便于「杭州」「杭州市」互相比较 */
function normalizeCityKey(name: string): string {
  return String(name || '')
    .trim()
    .replace(/(特别行政区|自治州|地区|市|区|县|盟|州)$/g, '')
}

/** 把反查结果对齐到本地城市库里的规范名称（如「杭州」→「杭州市」） */
function canonicalCityName(raw: string, fallback: string): string {
  const name = String(raw || '').trim()
  if (!name) return fallback
  const key = normalizeCityKey(name)
  const hit = CHINA_CITIES.find(
    (item) =>
      item.name === name ||
      item.short === name ||
      (key.length > 0 && normalizeCityKey(item.name) === key),
  )
  return hit ? hit.name : name
}

const UNLOCKED_CITIES_KEY = 'travelog.unlockedCities'

function readUnlockedCities(): string[] {
  try {
    const raw = localStorage.getItem(UNLOCKED_CITIES_KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.map((item) => String(item)) : []
  } catch {
    return []
  }
}

/** 标记城市已提示过；已存在时返回 false，保证同一城市只弹一次 */
function markCityUnlocked(cityName: string): boolean {
  const key = normalizeCityKey(cityName)
  if (!key) return false
  const list = readUnlockedCities()
  if (list.some((item) => normalizeCityKey(item) === key)) return false
  list.push(cityName)
  try {
    localStorage.setItem(UNLOCKED_CITIES_KEY, JSON.stringify(list))
  } catch {
    return false
  }
  return true
}

/** 打卡成功且城市此前未出现在足迹里时，通知界面弹出新城市解锁 */
function unlockIfNewCity(cityName: string, province: string, footprints: FootprintLite[]): void {
  const key = normalizeCityKey(cityName)
  if (!key) return
  const visited = footprints.some(
    (item) => normalizeCityKey(item.city || item.placeName) === key,
  )
  if (visited) return
  if (!markCityUnlocked(cityName)) return
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('travelog:newCity', { detail: { city: cityName, province } }),
    )
  }
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

/** 自动打卡统一记录城市名；命中已知地点只用于提前判断，不再拼区县/街道 */
async function handleFix(
  fix: Fix,
  settings: AutoCheckinSettings,
  listener?: (event: AutoCheckinEvent) => void,
): Promise<void> {
  status.lastFixAt = Date.now()
  status.latitude = fix.latitude
  status.longitude = fix.longitude

  const { footprints, tripId } = await loadCache()

  let nearest: { item: FootprintLite; distance: number } | null = null
  for (const item of footprints) {
    const distance = distanceMeters(fix.latitude, fix.longitude, item.latitude, item.longitude)
    if (!nearest || distance < nearest.distance) nearest = { item, distance }
  }
  const known = nearest && nearest.distance <= settings.radius ? nearest : null

  const city = nearestCity(fix.latitude, fix.longitude)
  if (!city) {
    status.lastMatch = '未匹配到城市'
    noteEvent('未匹配到城市')
    return
  }

  // 没有命中已知地点时保留原有 50 公里距离限制
  if (!known && city.distance > 50000) {
    status.lastMatch = `城市：${city.city}（${(city.distance / 1000).toFixed(1)} 公里）`
    noteEvent('最近城市超过 50 公里，不打卡')
    return
  }

  // 用反查结果确认所属城市；取不到城市时退回「城市附近」兜底
  let cityName = city.city
  let province = city.province
  let placeName = `${city.short}附近`
  try {
    const info = await reverseGeocode(fix.latitude, fix.longitude, 6000)
    if (info.province) province = info.province
    if (info.city) {
      cityName = canonicalCityName(info.city, city.city)
      placeName = cityName
    }
  } catch {
    // 网络或服务不可用时静默退回「城市附近」
  }

  status.lastMatch = known
    ? `地点：${known.item.placeName}（${Math.round(known.distance)} 米）· 城市：${cityName}`
    : `城市：${cityName}（${(city.distance / 1000).toFixed(1)} 公里）`

  const key = `city:${normalizeCityKey(cityName)}`
  if (!cooled(key, settings.cooldownMs)) {
    noteEvent('该城市已打卡，冷却中')
    return
  }

  await record(placeName, cityName, fix, tripId, known ? '自动打卡' : '自动打卡（城市）')
  noteEvent(`已打卡：${cityName}`)
  listener?.({ type: 'checked', place: cityName, distance: known ? known.distance : city.distance })
  unlockIfNewCity(cityName, province, footprints)
}

/**
 * 定位出错统一收口：权限未开时静默跳过，避免自动打卡反复弹窗。
 * 其他错误（超时、不可用）仍交给调用方提示。
 */
function reportPositionError(message: string, listener?: (event: AutoCheckinEvent) => void): void {
  if (/权限|permission|denied|not authorized/i.test(message)) {
    noteEvent('定位权限未开启，自动打卡已跳过')
    return
  }
  listener?.({ type: 'error', message })
}

function runFix(fix: Fix, settings: AutoCheckinSettings, listener?: (event: AutoCheckinEvent) => void): void {
  void handleFix(fix, settings, listener).catch((error) =>
    listener?.({ type: 'error', message: (error as Error).message }),
  )
}

/**
 * 原生端走 Capacitor Geolocation（WebView 的 navigator.geolocation 在部分机型不可用），
 * 浏览器端继续用 navigator.geolocation。返回停止函数。
 * 启动后先立即检查一次，再进入持续监听。
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
        // 权限未开：静默跳过，不向界面抛错误
        noteEvent('定位权限未开启，自动打卡已跳过')
        return
      }
      // 打开 App 后立即检查一次，不等持续定位回调
      void getBestFix().then((fix) => {
        if (fix) runFix(fix, settings, listener)
      })
      nativeWatchId = await watchNativeFix(
        (fix) => runFix(fix, settings, listener),
        (message) => reportPositionError(message, listener),
      )
      if (!nativeWatchId) noteEvent('无法启动原生定位')
    })()
    return () => stopAutoCheckin()
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    listener?.({ type: 'error', message: '当前环境不支持定位' })
    return () => {}
  }

  const options: PositionOptions = { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 }
  const onFix = (position: GeolocationPosition) => {
    runFix({ latitude: position.coords.latitude, longitude: position.coords.longitude }, settings, listener)
  }
  const onError = (error: GeolocationPositionError) => {
    if (error.code === 1) {
      // 用户未授权定位：静默跳过，避免反复弹窗
      noteEvent('定位权限未开启，自动打卡已跳过')
      return
    }
    listener?.({ type: 'error', message: error.message })
  }

  // 启动即取一次当前位置，再进入持续监听
  navigator.geolocation.getCurrentPosition(onFix, onError, options)
  watchId = navigator.geolocation.watchPosition(onFix, onError, options)

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