export interface CloudConfig {
  /** 为空时走同源 /api（Pages 与 Worker 同域或用 _redirects 转发） */
  baseUrl: string
  token: string
  syncCode: string
  nickname: string
  userId: string
  cursor: number
  lastSyncAt: number
  autoSync: boolean
}

const STORAGE_KEY = 'travelog.cloud'
const DEFAULT_CONFIG: CloudConfig = {
  baseUrl: '',
  token: '',
  syncCode: '',
  nickname: '',
  userId: '',
  cursor: 0,
  lastSyncAt: 0,
  autoSync: true,
}

export function getCloudConfig(): CloudConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<CloudConfig>) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveCloudConfig(patch: Partial<CloudConfig>): CloudConfig {
  const next = { ...getCloudConfig(), ...patch }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function clearCloudConfig(): CloudConfig {
  localStorage.removeItem(STORAGE_KEY)
  return { ...DEFAULT_CONFIG }
}

export function isSignedIn(): boolean {
  return Boolean(getCloudConfig().token)
}

export function apiOrigin(): string {
  const base = getCloudConfig().baseUrl.trim().replace(/\/$/, '')
  if (base) return `${base}/api`
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return `${window.location.origin}/api`
  }
  return 'http://127.0.0.1:8787/api'
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
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
    const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T)
    if (!response.ok) {
      throw new ApiError((data as { error?: string }).error || `请求失败（${response.status}）`, response.status)
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

export interface AuthResult {
  userId: string
  token: string
  syncCode: string
  nickname: string
}

export async function registerCloud(nickname: string): Promise<AuthResult> {
  const result = await api<AuthResult>('/auth/register', {
    method: 'POST',
    body: { nickname },
    auth: false,
  })
  saveCloudConfig({
    userId: result.userId,
    token: result.token,
    syncCode: result.syncCode,
    nickname: result.nickname,
    cursor: 0,
  })
  return result
}

export async function loginCloud(syncCode: string): Promise<AuthResult> {
  const result = await api<AuthResult>('/auth/login', {
    method: 'POST',
    body: { syncCode },
    auth: false,
  })
  saveCloudConfig({
    userId: result.userId,
    token: result.token,
    syncCode: result.syncCode,
    nickname: result.nickname,
    cursor: 0,
  })
  return result
}

export interface AIResult {
  text: string
  model: string
}

export async function aiComplete(
  prompt: string,
  system: string,
  temperature = 0.6,
): Promise<AIResult> {
  if (!isSignedIn()) throw new ApiError('请先在「云同步」里登录', 401)
  return api<AIResult>('/ai/complete', {
    method: 'POST',
    body: { prompt, system, temperature },
    timeoutMs: 45000,
  })
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
  syncCode: string
  createdAt: number
  lastSeenAt: number
  status: 'active' | 'disabled'
  entityCount: number
}

export interface AdminEndpoint {
  id: string
  name: string
  type: 'openai' | 'workers'
  base: string
  model: string
  key: string
  hasKey: boolean
  weight: number
  enabled: boolean
  usable: boolean
}

export interface AdminSettings {
  site: { name: string }
  ai: {
    enabled: boolean
    temperature: number
    workersBound: boolean
    endpoints: AdminEndpoint[]
  }
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
  patch: { status?: 'active' | 'disabled'; nickname?: string; note?: string },
): Promise<{ ok: boolean }> {
  return adminApi(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
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
  ai?: {
    enabled?: boolean
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