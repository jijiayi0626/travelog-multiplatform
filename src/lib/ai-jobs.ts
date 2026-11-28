import { ApiError, api, getCloudConfig, isSignedIn } from './cloud'

export type AIJobKind = 'polish' | 'plan' | 'packing' | 'qa' | 'recap' | 'trip_note' | 'custom'
export type AIJobStatus = 'queued' | 'running' | 'done' | 'error'

export interface AIJob {
  id: string
  kind: AIJobKind
  status: AIJobStatus
  result: string
  error: string
  model: string
  endpoint: string
  /** 服务端返回的原始输入，用于失败后重试 */
  prompt?: string
  system?: string
  temperature?: number
  createdAt: number
  startedAt: number
  finishedAt: number
  /** 仅本机保存的展示名；服务端只存 kind */
  label?: string
  /** 自动任务不参与未读提醒（例如记账分类） */
  silent?: boolean
}

export interface SubmitAIJobInput {
  kind: AIJobKind
  label: string
  system: string
  prompt: string
  temperature?: number
  /** 指定模型入口；为空时由服务端按权重挑选 */
  endpointId?: string
  silent?: boolean
}

const JOBS_KEY = 'travelog.ai.jobs'
const READ_KEY = 'travelog.ai.read'
const MAX_LOCAL_JOBS = 20

/** 按账号隔离，换账号登录时不会看到上一个人的 AI 记录 */
function scopedKey(base: string): string {
  return `${base}:${getCloudConfig().userId || 'anon'}`
}
const POLL_MS = 3500
const WAIT_TIMEOUT_MS = 180_000

function readJobs(): AIJob[] {
  try {
    const raw = localStorage.getItem(scopedKey(JOBS_KEY))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return (parsed as AIJob[])
      .filter((item) => item && typeof item.id === 'string')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_LOCAL_JOBS)
  } catch {
    return []
  }
}

function writeJobs(jobs: AIJob[]): void {
  try {
    localStorage.setItem(scopedKey(JOBS_KEY), JSON.stringify(jobs.slice(0, MAX_LOCAL_JOBS)))
  } catch {
    /* 存储满时静默失败，任务仍可在服务端查询 */
  }
}

function readReadSet(): Set<string> {
  try {
    const raw = localStorage.getItem(scopedKey(READ_KEY))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : [])
  } catch {
    return new Set()
  }
}

function writeReadSet(ids: Set<string>): void {
  try {
    localStorage.setItem(scopedKey(READ_KEY), JSON.stringify([...ids].slice(-120)))
  } catch {
    /* ignore */
  }
}

type Listener = (jobs: AIJob[]) => void
const listeners = new Set<Listener>()

export function subscribeAIJobs(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(): void {
  const jobs = readJobs()
  for (const listener of listeners) listener(jobs)
}

export function getAIJobs(): AIJob[] {
  return readJobs()
}

export function getActiveAIJobs(jobs = readJobs()): AIJob[] {
  return jobs.filter((item) => item.status === 'queued' || item.status === 'running')
}

export function getUnreadAIJobs(jobs = readJobs()): AIJob[] {
  const read = readReadSet()
  const freshAfter = Date.now() - 24 * 3600_000
  return jobs.filter(
    (item) =>
      !item.silent &&
      (item.status === 'done' || item.status === 'error') &&
      item.finishedAt > freshAfter &&
      !read.has(item.id),
  )
}

export function markAIJobsRead(ids: string[]): void {
  if (ids.length === 0) return
  const read = readReadSet()
  for (const id of ids) read.add(id)
  writeReadSet(read)
  emit()
}

function mergeJob(previous: AIJob | undefined, next: AIJob): AIJob {
  if (!previous) return next
  return {
    ...next,
    label: previous.label || next.label,
    silent: previous.silent ?? next.silent,
  }
}

let refreshing: Promise<AIJob[]> | null = null

/** 拉取服务端任务并合并到本地缓存；正在执行时会自动轮询 */
export function refreshAIJobs(): Promise<AIJob[]> {
  if (typeof window === 'undefined' || !isSignedIn()) return Promise.resolve(readJobs())
  if (refreshing) return refreshing
  refreshing = (async () => {
    const result = await api<{ jobs: AIJob[] }>('/ai/jobs?limit=20', { timeoutMs: 12_000 })
    const previous = readJobs()
    const byId = new Map(previous.map((item) => [item.id, item]))
    const merged = result.jobs
      .map((job) => mergeJob(byId.get(job.id), job))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_LOCAL_JOBS)
    const changed = JSON.stringify(merged) !== JSON.stringify(previous)
    if (changed) {
      writeJobs(merged)
      emit()
    }
    syncPolling()
    return merged
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

let timer: number | null = null
let watcherStarted = false

function syncPolling(): void {
  if (typeof window === 'undefined') return
  const active = getActiveAIJobs().length > 0
  if (active && timer === null) {
    timer = window.setInterval(() => {
      void refreshAIJobs().catch(() => {})
    }, POLL_MS)
  } else if (!active && timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

/** 全局只启动一次：页面回前台、窗口聚焦、执行中轮询 */
export function startAIJobWatcher(): void {
  if (typeof window === 'undefined') return
  syncPolling()
  if (watcherStarted) return
  watcherStarted = true
  const kick = () => {
    if (!isSignedIn()) return
    void refreshAIJobs().catch(() => {})
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick()
  })
  window.addEventListener('focus', kick)
  if (isSignedIn()) kick()
}

function upsertLocal(job: AIJob): void {
  const next = [job, ...readJobs().filter((item) => item.id !== job.id)]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_LOCAL_JOBS)
  writeJobs(next)
  emit()
  syncPolling()
}

function notifyPaywall(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('travelog:ai-paywall', { detail: { message } }))
}

/** 提交后台任务；会员/开关错误会抛 ApiError */
export async function submitAIJob(input: SubmitAIJobInput): Promise<AIJob> {
  if (!isSignedIn()) throw new ApiError('请先在「云同步」登录', 401)
  let response: { job: AIJob }
  try {
    response = await api<{ job: AIJob }>('/ai/jobs', {
      method: 'POST',
      body: {
        kind: input.kind,
        system: input.system,
        prompt: input.prompt,
        temperature: input.temperature ?? 0.6,
        endpointId: input.endpointId || '',
      },
      timeoutMs: 15_000,
    })
  } catch (error) {
    if (error instanceof ApiError && error.code === 'membership_required') {
      notifyPaywall(error.message)
    }
    throw error
  }
  const job: AIJob = {
    ...response.job,
    label: input.label,
    silent: input.silent,
  }
  upsertLocal(job)
  startAIJobWatcher()
  if (!input.silent) {
    window.dispatchEvent(new CustomEvent('travelog:ai-queued'))
  }
  void refreshAIJobs().catch(() => {})
  return job
}

/** 等待单个任务结束；超时后不取消后台任务，结果仍会出现在右上角 */
export function waitForAIJob(id: string): Promise<AIJob> {
  const current = readJobs().find((item) => item.id === id)
  if (current?.status === 'done') return Promise.resolve(current)
  if (current?.status === 'error') {
    return Promise.reject(new Error(current.error || 'AI 生成失败，请稍后再试'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let timeout = 0
    let unsubscribe: (() => void) | undefined
    const finishResolve = (job: AIJob) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      unsubscribe?.()
      resolve(job)
    }
    const finishReject = (error: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      unsubscribe?.()
      reject(error)
    }
    timeout = window.setTimeout(() => {
      finishReject(new Error('AI 还在后台执行，可以离开此页面，完成后在右上角查看'))
    }, WAIT_TIMEOUT_MS)
    unsubscribe = subscribeAIJobs((jobs) => {
      const job = jobs.find((item) => item.id === id)
      if (!job) return
      if (job.status === 'done') finishResolve(job)
      else if (job.status === 'error') {
        finishReject(new Error(job.error || 'AI 生成失败，请稍后再试'))
      }
    })
  })
}

/** 提交并等待结果，供各 AI 功能复用 */
export async function runAIJob(input: SubmitAIJobInput): Promise<AIJob> {
  const job = await submitAIJob(input)
  return waitForAIJob(job.id)
}

export async function deleteAIJob(id: string): Promise<void> {
  await api(`/ai/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' })
  writeJobs(readJobs().filter((item) => item.id !== id))
  emit()
  syncPolling()
}

export interface AIConfig {
  enabled: boolean
  membershipRequired: boolean
  member: boolean
  membershipExpiresAt: number
  canUse: boolean
  endpoints: number
}

export function getAIConfig(): Promise<AIConfig> {
  return api<AIConfig>('/ai/config', { timeoutMs: 10_000 })
}
