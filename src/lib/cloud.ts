import type { Currency, ExpenseCategory, PlanKind } from './types'

export interface CloudConfig {
  /** 为空时走同源 /api（Pages 与 Worker 同域或用 _redirects 转发） */
  baseUrl: string
  token: string
  syncCode: string
  nickname: string
  userId: string
  /** 账号名（账号密码登录）；仅同步码登录的老账号为空 */
  username: string
  /** 账号邮箱（可在用户中心或后台修改） */
  email: string
  /** 会员到期时间（毫秒）；0 表示非会员 */
  membershipExpiresAt: number
  /** 同步游标：新版为 updatedAt~kind~id，兼容旧版的数字时间戳 */
  cursor: string | number
  lastSyncAt: number
  autoSync: boolean
  /** 前台自动同步间隔（分钟）；0 = 实时（约 20 秒一次） */
  syncIntervalMinutes: number
  /** 仅在 Wi-Fi 下自动同步 */
  wifiOnly: boolean
}

const STORAGE_KEY = 'travelog.cloud'
const REALTIME_MIGRATION_KEY = 'travelog.cloud.syncRealtime'
const DEFAULT_CONFIG: CloudConfig = {
  baseUrl: '',
  token: '',
  syncCode: '',
  nickname: '',
  userId: '',
  username: '',
  email: '',
  membershipExpiresAt: 0,
  cursor: 0,
  lastSyncAt: 0,
  autoSync: true,
  syncIntervalMinutes: 0,
  wifiOnly: false,
}

export function getCloudConfig(): CloudConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const next = { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<CloudConfig>) }
    // v2.3.0：默认切换为「实时同步」。一次性把旧的 5 分钟默认值升级为实时，
    // 用户之后手动选择的 1/5/15/30 分钟不再被覆盖。
    try {
      if (!localStorage.getItem(REALTIME_MIGRATION_KEY)) {
        localStorage.setItem(REALTIME_MIGRATION_KEY, '1')
        if (next.syncIntervalMinutes === 5) {
          next.syncIntervalMinutes = 0
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        }
      }
    } catch {
      /* 隐私模式下忽略迁移标记 */
    }
    return next
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveCloudConfig(patch: Partial<CloudConfig>): CloudConfig {
  const next = { ...getCloudConfig(), ...patch }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('travelog:cloud-changed'))
  return next
}

export function clearCloudConfig(): CloudConfig {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent('travelog:cloud-changed'))
  return { ...DEFAULT_CONFIG }
}

export function isSignedIn(): boolean {
  return Boolean(getCloudConfig().token)
}

/** 原生包没有同源服务器，未配置时回退到官方 Worker，避免一装好就同步不了 */
const DEFAULT_NATIVE_SERVER = 'https://travelog.mr-jijiayi.workers.dev'

function isNativeApp(): boolean {
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor
  return Boolean(capacitor?.isNativePlatform?.())
}

export function apiOrigin(): string {
  const base = getCloudConfig().baseUrl.trim().replace(/\/$/, '')
  if (base) return `${base}/api`
  if (typeof window !== 'undefined' && isNativeApp()) return `${DEFAULT_NATIVE_SERVER}/api`
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return `${window.location.origin}/api`
  }
  return 'http://127.0.0.1:8787/api'
}

/** 分享链接要指向网页版：原生包里的 location 是 capacitor://，别人打不开 */
export function shareBaseUrl(): string {
  const base = getCloudConfig().baseUrl.trim().replace(/\/$/, '')
  if (base) return `${base}/`
  if (typeof window !== 'undefined' && isNativeApp()) return `${DEFAULT_NATIVE_SERVER}/`
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}`
  }
  return `${DEFAULT_NATIVE_SERVER}/`
}

export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    body?: unknown
    auth?: boolean
    token?: string
    timeoutMs?: number
  } = {},
): Promise<T> {
  const config = getCloudConfig()
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20000)

  try {
    const bearer = options.token ?? (options.auth === false ? '' : config.token)
    const response = await fetch(`${apiOrigin()}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
    const text = await response.text()
    let payload: (T & { error?: string; code?: string }) | null = null
    if (text) {
      try {
        payload = JSON.parse(text) as T & { error?: string; code?: string }
      } catch {
        throw new ApiError(
          response.ok
            ? '服务器返回了无法识别的数据，请检查 API 地址'
            : `服务器错误（${response.status}），请稍后重试`,
          response.status,
        )
      }
    }
    const data = (payload ?? {}) as T & { error?: string; code?: string }
    if (!response.ok) {
      throw new ApiError(
        data.error || `请求失败（${response.status}）`,
        response.status,
        data.code,
      )
    }
    return data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('请求超时，检查网络或服务器地址', 0)
    }
    throw new ApiError('无法连接服务器', 0)
  } finally {
    window.clearTimeout(timeout)
  }
}

export interface HealthInfo {
  ok: boolean
  ai: boolean
  time: number
}

export async function checkHealth(): Promise<HealthInfo> {
  return api<HealthInfo>('/health', { auth: false, timeoutMs: 8000 })
}

export interface MembershipInfo {
  active: boolean
  expiresAt: number
}

export interface AuthResult {
  userId: string
  token: string
  syncCode: string
  nickname: string
  username: string
  email?: string
  membership: MembershipInfo
  needsCredentials: boolean
}

function saveAuth(result: AuthResult): AuthResult {
  saveCloudConfig({
    userId: result.userId,
    token: result.token,
    syncCode: result.syncCode,
    nickname: result.nickname,
    username: result.username || '',
    email: result.email || '',
    membershipExpiresAt: result.membership?.expiresAt ?? 0,
    cursor: 0,
  })
  return result
}

export interface AuthConfig {
  site: string
  inviteRequired: boolean
}

/** 给登录设备起个可读名字，显示在「登录设备」列表里 */
export function deviceLabel(): string {
  const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  const platform = capacitor?.getPlatform?.()
  if (platform === 'android') return 'Android 应用'
  if (platform === 'ios') return 'iOS 应用'
  const ua = navigator.userAgent
  if (/iPad/.test(ua)) return 'iPad 浏览器'
  if (/iPhone/.test(ua)) return 'iPhone 浏览器'
  if (/Android/.test(ua)) return 'Android 浏览器'
  if (/Macintosh/.test(ua)) return 'Mac 浏览器'
  if (/Windows/.test(ua)) return 'Windows 浏览器'
  if (/Linux/.test(ua)) return 'Linux 浏览器'
  return '网页浏览器'
}

export function getAuthConfig(): Promise<AuthConfig> {
  return api<AuthConfig>('/auth/config', { auth: false })
}

export async function registerCloud(
  nickname: string,
  username: string,
  password: string,
  inviteCode?: string,
): Promise<AuthResult> {
  const result = await api<AuthResult>('/auth/register', {
    method: 'POST',
    body: { nickname, username, password, inviteCode: inviteCode || undefined, deviceName: deviceLabel() },
    auth: false,
  })
  return saveAuth(result)
}

/** 账号 + 密码登录 */
export async function loginWithPassword(username: string, password: string): Promise<AuthResult> {
  const result = await api<AuthResult>('/auth/login', {
    method: 'POST',
    body: { username, password, deviceName: deviceLabel() },
    auth: false,
  })
  return saveAuth(result)
}

/** 兼容登录：用 8 位同步码登录（多人共享/老账号） */
export async function loginCloud(syncCode: string): Promise<AuthResult> {
  const result = await api<AuthResult>('/auth/login', {
    method: 'POST',
    body: { syncCode, deviceName: deviceLabel() },
    auth: false,
  })
  return saveAuth(result)
}

export interface AccountInfo {
  userId: string
  nickname: string
  username: string
  email: string
  syncCode: string
  createdAt: number
  membership: MembershipInfo
  needsCredentials: boolean
  hasPassword: boolean
  passwordUpdatedAt: number
  deviceCount: number
}

/** 当前账号资料 + 会员状态 */
export async function getAccountMe(): Promise<AccountInfo> {
  const result = await api<AccountInfo>('/auth/me')
  saveCloudConfig({
    nickname: result.nickname,
    username: result.username || '',
    email: result.email || '',
    membershipExpiresAt: result.membership?.expiresAt ?? 0,
  })
  return result
}

/** 老账号补设 / 已有账号修改用户名密码 */
export async function saveAccountCredentials(
  username: string,
  password: string,
  currentPassword?: string,
): Promise<{ username: string }> {
  const result = await api<{ username: string }>('/auth/credentials', {
    method: 'POST',
    body: { username, password, currentPassword: currentPassword || undefined },
  })
  saveCloudConfig({ username: result.username })
  return result
}

/** 兑换会员码 */
export async function redeemMembershipCode(code: string): Promise<{ addedDays: number; membership: MembershipInfo }> {
  const result = await api<{ addedDays: number; membership: MembershipInfo }>('/membership/redeem', {
    method: 'POST',
    body: { code },
  })
  saveCloudConfig({ membershipExpiresAt: result.membership?.expiresAt ?? 0 })
  return result
}

/** 退出：通知服务端注销当前设备令牌，再清本地 */
export async function logoutCloud(): Promise<void> {
  if (getCloudConfig().token) {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
      /* 网络失败也清本地 */
    }
  }
  clearCloudConfig()
}

/** 修改当前账号昵称 / 邮箱；会同步到云端账号（旅伴、共享行程里的展示名） */
export async function updateAccountProfile(patch: {
  nickname?: string
  email?: string
}): Promise<{ nickname: string; email: string }> {
  const result = await api<{ nickname: string; email: string }>('/account', {
    method: 'PATCH',
    body: patch,
  })
  saveCloudConfig({ nickname: result.nickname, email: result.email })
  return result
}

export function updateAccountNickname(nickname: string): Promise<{ nickname: string; email: string }> {
  return updateAccountProfile({ nickname })
}

/* ---------------- 登录设备 ---------------- */

export interface AccountDevice {
  id: string
  /** 服务端返回的展示名，当前为登录 IP（缺失时为「未知 IP」） */
  deviceName: string
  userAgent: string
  ip: string
  createdAt: number
  lastSeenAt: number
  current: boolean
}

/** 当前账号的登录设备列表 */
export function listAccountDevices(): Promise<{ devices: AccountDevice[] }> {
  return api<{ devices: AccountDevice[] }>('/account/devices')
}

/** 让指定设备下线（传当前设备的 id 等于退出当前设备） */
export function revokeAccountDevice(deviceId: string): Promise<{ ok: boolean }> {
  return api(`/account/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
}

export interface AIResult {
  text: string
  model: string
}

export async function aiComplete(
  prompt: string,
  system: string,
  temperature = 0.6,
  endpointId = '',
): Promise<AIResult> {
  if (!isSignedIn()) throw new ApiError('请先在「云同步」里登录', 401)
  return api<AIResult>('/ai/complete', {
    method: 'POST',
    body: { prompt, system, temperature, endpointId },
    timeoutMs: 45000,
  })
}

export interface ReceiptResult {
  amount: number
  currency: Currency
  category: ExpenseCategory
  note: string
}

/** 拍照识别小票，返回金额、币种、分类与说明 */
export async function readReceipt(image: string): Promise<ReceiptResult> {
  if (!isSignedIn()) throw new ApiError('请先在「云同步」里登录', 401)
  return api<ReceiptResult>('/ai/receipt', {
    method: 'POST',
    body: { image },
    timeoutMs: 60000,
  })
}

export interface AIModelOption {
  id: string
  name: string
  model: string
  type: string
}

export interface AIModelsResult {
  enabled: boolean
  canUse: boolean
  member: boolean
  membershipRequired: boolean
  models: AIModelOption[]
}

/** 当前账号可用的模型列表（一个站点可绑定多个模型） */
export async function getAIModels(): Promise<AIModelsResult> {
  if (!isSignedIn()) throw new ApiError('请先在「云同步」里登录', 401)
  return api<AIModelsResult>('/ai/models', { timeoutMs: 15000 })
}

export interface AppReleaseAsset {
  name: string
  size: number
  url: string
}

export interface AppRelease {
  version: string
  tag: string
  name: string
  publishedAt: number
  notes: string
  assets: AppReleaseAsset[]
}

/** 最新 GitHub Release（由 Worker 代理，避免客户端直连被限流） */
export async function getLatestAppRelease(): Promise<AppRelease> {
  try {
    return await api<AppRelease>('/app/latest', { timeoutMs: 15000 })
  } catch (error) {
    // 自建服务器版本较旧、没有该接口时，回退到官方 Worker 查询
    if (apiOrigin() === `${DEFAULT_NATIVE_SERVER}/api`) throw error
    const response = await fetch(`${DEFAULT_NATIVE_SERVER}/api/app/latest`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw error
    return (await response.json()) as AppRelease
  }
}

/* ---------------- 照片（R2） ---------------- */

export interface UploadedPhoto {
  id: string
  url: string
  size: number
  mime: string
  createdAt: number
}

/** 把压缩后的 data URL 上传到 R2，返回可长期访问的能力地址 */
export function uploadPhoto(dataUrl: string): Promise<UploadedPhoto> {
  return api<UploadedPhoto>('/photos', {
    method: 'POST',
    body: { dataUrl },
    timeoutMs: 60000,
  })
}

export function deleteCloudPhoto(id: string): Promise<{ ok: boolean }> {
  return api(`/photos/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export interface UploadedAvatar {
  url: string
  size: number
  mime: string
  updatedAt: number
}

/** 头像单独存 R2：服务端会替换旧文件，避免隐私图片出现在后台照片列表里 */
export function uploadAvatar(dataUrl: string): Promise<UploadedAvatar> {
  return api<UploadedAvatar>('/avatar', {
    method: 'POST',
    body: { dataUrl },
    timeoutMs: 60000,
  })
}

export function deleteAvatar(): Promise<{ ok: boolean }> {
  return api('/avatar', { method: 'DELETE' })
}

export interface CloudPhoto {
  id: string
  url: string
  size: number
  mime: string
  createdAt: number
}

export interface CloudPhotoPage {
  total: number
  bytes: number
  photos: CloudPhoto[]
}

/** 当前账号上传到 R2 的照片（含总张数与总占用） */
export function listMyPhotos(limit = 60, offset = 0): Promise<CloudPhotoPage> {
  return api<CloudPhotoPage>(`/photos?limit=${limit}&offset=${offset}`)
}

export interface StorageInfo {
  photos: { count: number; bytes: number }
  avatar: { size: number; updatedAt: number } | null
}

/** 云存储占用：照片与头像 */
export function getStorageInfo(): Promise<StorageInfo> {
  return api<StorageInfo>('/account/storage')
}

export interface WeatherNow {
  temperature: number
  weatherCode: number
  wind: number
  humidity: number
  days: Array<{ date: string; code: number; max: number; min: number; rain: number }>
}

export async function fetchWeather(lat: number, lon: number, days = 5): Promise<WeatherNow> {
  const raw = await api<{
    current?: { temperature_2m: number; weather_code: number; wind_speed_10m: number; relative_humidity_2m: number }
    daily?: {
      time: string[]
      weather_code: number[]
      temperature_2m_max: number[]
      temperature_2m_min: number[]
      precipitation_probability_max: number[]
    }
  }>(`/weather?lat=${lat}&lon=${lon}&days=${days}`, { auth: false })

  return {
    temperature: raw.current?.temperature_2m ?? 0,
    weatherCode: raw.current?.weather_code ?? 0,
    wind: raw.current?.wind_speed_10m ?? 0,
    humidity: raw.current?.relative_humidity_2m ?? 0,
    days: (raw.daily?.time ?? []).map((date, index) => ({
      date,
      code: raw.daily?.weather_code[index] ?? 0,
      max: raw.daily?.temperature_2m_max[index] ?? 0,
      min: raw.daily?.temperature_2m_min[index] ?? 0,
      rain: raw.daily?.precipitation_probability_max[index] ?? 0,
    })),
  }
}

export async function geocode(query: string): Promise<{
  found: boolean
  name?: string
  admin1?: string
  country?: string
  latitude?: number
  longitude?: number
}> {
  return api(`/geocode?q=${encodeURIComponent(query)}`, { auth: false })
}

/* ---------------- 管理面板 ---------------- */

const ADMIN_KEY = 'travelog.admin'

export interface AdminSession {
  token: string
  username: string
}

export function getAdminSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(ADMIN_KEY)
    return raw ? (JSON.parse(raw) as AdminSession) : null
  } catch {
    return null
  }
}

export function saveAdminSession(session: AdminSession | null): void {
  if (!session) localStorage.removeItem(ADMIN_KEY)
  else localStorage.setItem(ADMIN_KEY, JSON.stringify(session))
}

function adminApi<T>(
  path: string,
  options: Parameters<typeof api>[1] = {},
): Promise<T> {
  return api<T>(path, { ...options, token: getAdminSession()?.token ?? '' })
}

export interface AdminOverview {
  site: string
  users: number
  active7Days: number
  entities: number
  members: number
  photos: { count: number; bytes: number }
  registration: { inviteRequired: boolean }
  ai: {
    enabled: boolean
    provider: 'openai' | 'workers'
    model: string
    workersBound: boolean
  }
  time: number
}

export interface AdminUser {
  id: string
  nickname: string | null
  email: string
  username: string
  hasPassword: boolean
  passwordUpdatedAt: number
  deviceCount: number
  syncCode: string
  createdAt: number
  lastSeenAt: number
  status: 'active' | 'disabled'
  entityCount: number
  photoCount: number
  photoBytes: number
  avatarBytes: number
  membership: MembershipInfo
  lastLoginAt: number
  lastIp: string
  lastUserAgent: string
  lastCountry: string
  lastRegion: string
  lastCity: string
  lastColo: string
}

export interface AdminEndpoint {
  id: string
  name: string
  type: 'openai' | 'workers'
  base: string
  model: string
  models?: string[]
  key: string
  hasKey: boolean
  weight: number
  enabled: boolean
  usable: boolean
}

export interface AdminSettings {
  site: { name: string }
  registration: { inviteRequired: boolean }
  ai: {
    enabled: boolean
    membershipRequired: boolean
    temperature: number
    workersBound: boolean
    endpoints: AdminEndpoint[]
  }
}

export interface AdminCode {
  code: string
  note: string
  maxUses: number
  usedCount: number
  createdAt: number
  /** 会员码 */
  days?: number
  expiresAt?: number
  /** 邀请码 */
  disabled?: boolean
}

export interface AdminAITestResult {
  id: string
  name: string
  model: string
  ms: number
  ok: boolean
  sample?: string
  error?: string
}

export interface AdminPhoto {
  id: string
  userId: string
  nickname: string
  username: string
  syncCode: string
  userCreatedAt: number
  mime: string
  size: number
  createdAt: number
  url: string
}

export interface AdminPhotoPage {
  total: number
  bytes: number
  users: number
  allTotal: number
  allBytes: number
  photos: AdminPhoto[]
}

export function adminListPhotos(
  limit = 60,
  offset = 0,
  filters: { q?: string; mime?: string } = {},
): Promise<AdminPhotoPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (filters.q?.trim()) params.set('q', filters.q.trim())
  if (filters.mime) params.set('mime', filters.mime)
  return adminApi(`/admin/photos?${params.toString()}`)
}

export function adminDeletePhoto(id: string): Promise<{ ok: boolean }> {
  return adminApi(`/admin/photos/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function adminLogin(username: string, password: string): Promise<AdminSession> {
  const result = await api<{ token: string; username: string }>('/admin/login', {
    method: 'POST',
    auth: false,
    body: { username, password },
  })
  const session = { token: result.token, username: result.username }
  saveAdminSession(session)
  return session
}

export async function adminLogout(): Promise<void> {
  try {
    await adminApi('/admin/logout', { method: 'POST' })
  } catch {
    /* 退出失败也清本地 */
  }
  saveAdminSession(null)
}

export function adminOverview(): Promise<AdminOverview> {
  return adminApi('/admin/overview')
}

export function adminListUsers(query: string, limit = 50, offset = 0): Promise<{ total: number; users: AdminUser[] }> {
  const params = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) })
  return adminApi(`/admin/users?${params.toString()}`)
}

export function adminPatchUser(
  id: string,
  patch: {
    status?: 'active' | 'disabled'
    nickname?: string
    email?: string
    username?: string
    password?: string
    note?: string
    membershipDays?: number
  },
): Promise<{
  ok: boolean
  nickname: string
  email: string
  username: string
  hasPassword: boolean
}> {
  return adminApi(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
}

/** 管理员查看某个用户的登录设备 */
export function adminListUserDevices(userId: string): Promise<{ devices: AccountDevice[] }> {
  return adminApi<{ devices: AccountDevice[] }>(`/admin/users/${encodeURIComponent(userId)}/devices`)
}

/** 管理员强制某个用户的设备下线 */
export function adminRevokeUserDevice(userId: string, deviceId: string): Promise<{ ok: boolean }> {
  return adminApi(
    `/admin/users/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}`,
    { method: 'DELETE' },
  )
}

export function adminDeleteUser(id: string): Promise<{ ok: boolean }> {
  return adminApi(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function adminResetSyncCode(id: string): Promise<{ syncCode: string }> {
  return adminApi(`/admin/users/${encodeURIComponent(id)}/reset-code`, { method: 'POST' })
}

export function adminGetSettings(): Promise<AdminSettings> {
  return adminApi('/admin/settings')
}

export function adminSaveSettings(payload: {
  site?: { name?: string }
  registration?: { inviteRequired?: boolean }
  ai?: {
    enabled?: boolean
    membershipRequired?: boolean
    temperature?: number
    endpoints?: Array<Partial<AdminEndpoint>>
  }
}): Promise<{ ok: boolean }> {
  return adminApi('/admin/settings', { method: 'PUT', body: payload })
}

export function adminTestAI(endpointId?: string): Promise<{ ok: boolean; results: AdminAITestResult[] }> {
  return adminApi('/admin/ai/test', { method: 'POST', body: endpointId ? { endpointId } : {} })
}

export function adminListModels(endpointId: string): Promise<{ models: string[] }> {
  return adminApi(`/admin/ai/models?endpointId=${encodeURIComponent(endpointId)}`)
}

export function adminChangePassword(password: string): Promise<{ ok: boolean }> {
  return adminApi('/admin/password', { method: 'POST', body: { password } })
}

/* ---------------- 会员码 / 注册邀请码 ---------------- */

export function adminListCodes(type: 'membership' | 'invite'): Promise<{ type: string; codes: AdminCode[] }> {
  return adminApi(`/admin/codes?type=${type}`)
}

export function adminCreateCodes(payload: {
  type: 'membership' | 'invite'
  count?: number
  days?: number
  maxUses?: number
  note?: string
}): Promise<{ type: string; codes: string[]; days: number; maxUses: number }> {
  return adminApi('/admin/codes', { method: 'POST', body: payload })
}

export function adminDeleteCode(type: 'membership' | 'invite', code: string): Promise<{ ok: boolean }> {
  return adminApi(`/admin/codes/${type}/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

/* ---------------- 旅伴邀请码（trip 级共享） ---------------- */

export interface TripShare {
  tripId: string
  owner: string
  title: string
  joinedAt: number
}

/** 用邀请码加入别人的旅程 */
export async function joinTripByCode(inviteCode: string): Promise<{
  tripId: string
  title: string
  owner: string
}> {
  return api('/trips/join', { method: 'POST', body: { inviteCode } })
}

export interface SharedTripPlan {
  dayIndex: number
  time: string
  title: string
  place: string
  kind: PlanKind
  done: boolean
  note: string
  order: number
}

export interface SharedTrip {
  trip: {
    title: string
    destination: string
    startDate: number
    endDate: number
    note: string
    cover: number
    coverImage: string
  }
  plans: SharedTripPlan[]
}

/** 只读分享行程：公开接口，不需要登录 */
export function fetchSharedTrip(code: string): Promise<SharedTrip> {
  return api<SharedTrip>(`/share/${encodeURIComponent(code)}`, { auth: false, timeoutMs: 15000 })
}

/** 我加入的共享旅程 */
export async function listTripShares(): Promise<{ shares: TripShare[] }> {
  return api('/trips/shares')
}

/** 退出某个共享旅程 */
export async function leaveTripShare(tripId: string): Promise<{ ok: boolean }> {
  return api(`/trips/shares/${encodeURIComponent(tripId)}`, { method: 'DELETE' })
}

/* ---------------- 附近地点搜索 ---------------- */

export interface PoiItem {
  name: string
  displayName: string
  latitude: number
  longitude: number
  type: string
  city?: string
  district?: string
  street?: string
}

/**
 * 搜索附近的地点（景区、街道、建筑）。
 * 传 lat/lon 时只搜周边约 8 公里。
 */
export async function searchPoi(
  query: string,
  lat?: number,
  lon?: number,
): Promise<PoiItem[]> {
  const params = new URLSearchParams({ q: query })
  if (typeof lat === 'number' && typeof lon === 'number') {
    params.set('lat', String(lat))
    params.set('lon', String(lon))
  }
  const result = await api<{ results: PoiItem[] }>(`/poi?${params.toString()}`, { auth: false })
  return result.results ?? []
}

/* ---------------- 逆地理编码（区县 / 街道） ---------------- */

export interface ReverseGeoResult {
  found: boolean
  name: string
  displayName: string
  country: string
  countryCode: string
  province: string
  city: string
  district: string
  street: string
  areaLabel: string
  latitude: number
  longitude: number
}

/** 把坐标解析到区县 / 街道；用于打卡自动填名与自动打卡 */
export function reverseGeocode(
  latitude: number,
  longitude: number,
  timeoutMs = 8000,
): Promise<ReverseGeoResult> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
  })
  return api<ReverseGeoResult>(`/geo/reverse?${params.toString()}`, {
    auth: false,
    timeoutMs,
  })
}