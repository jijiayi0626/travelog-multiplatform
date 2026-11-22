import {
  apiOrigin,
  getCloudConfig,
  saveCloudConfig,
  type CloudConfig,
} from './cloud'
import {
  applyRemoteEntities,
  clearTombstonesBefore,
  exportAllEntities,
  replaceAllWithRemote,
  type SyncEntity,
} from './repo'
import { uploadPendingImages, type PhotoUploadResult } from './photo-sync'

export interface SyncResult {
  pushed: number
  pulled: number
  removed: number
  skipped: number
  at: number
  cursor: string | number
  photos: PhotoUploadResult
  pullOnly: boolean
}

const EMPTY_PHOTO_RESULT: PhotoUploadResult = {
  uploaded: 0,
  failed: 0,
  remaining: 0,
  covers: 0,
  avatar: false,
}

/** 本地改动版本号：用来区分「需要推送」和「只需拉取」 */
const DIRTY_KEY = 'travelog.syncDirty'

function readDirty(): boolean {
  try {
    // 没有记录时按「有改动」处理：升级后的第一次启动会完整同步一遍，
    // 确保历史本地图片也能上传；之后正常冷启动只做增量拉取。
    return localStorage.getItem(DIRTY_KEY) !== '0'
  } catch {
    return true
  }
}

function writeDirty(value: boolean): void {
  try {
    localStorage.setItem(DIRTY_KEY, value ? '1' : '0')
  } catch {
    // 隐私模式下 localStorage 不可用时退化为内存判断
  }
}

let localVersion = 0
let syncedVersion = readDirty() ? -1 : 0

export function markLocalChanges(): void {
  localVersion += 1
  writeDirty(true)
}

export function hasPendingLocalChanges(): boolean {
  return localVersion !== syncedVersion || readDirty()
}

/** 本地已经和云端一致：清掉脏标记，避免下一轮继续全量推送 */
export function markSynced(): void {
  syncedVersion = localVersion
  writeDirty(false)
}

const PUSH_BATCH = 150

async function pushBatch(entities: SyncEntity[]): Promise<{ applied: number; skipped: number }> {
  const config = getCloudConfig()
  const response = await fetch(`${apiOrigin()}/sync/push`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({ entities }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`推送失败（${response.status}）${text.slice(0, 120)}`)
  }
  return (await response.json()) as { applied: number; skipped: number }
}

interface PullResponse {
  cursor: string | number
  entities: SyncEntity[]
  hasMore: boolean
}

/**
 * 全量推送 + 增量拉取。
 * 推送使用 LWW（服务端按 updatedAt 比较），拉取按 cursor 游标分页。
 */
export function runSync(options: { pullOnly?: boolean } = {}): Promise<SyncResult> {
  const pullOnly = Boolean(options.pullOnly)
  if (inFlightSync) {
    // 已有同步在跑：拉取直接复用；手动全量等它结束后再跑一次
    if (pullOnly || inFlightKind === 'full') return inFlightSync
    return inFlightSync.then(() => runSync(options))
  }
  inFlightKind = pullOnly ? 'pull' : 'full'
  inFlightSync = doRunSync(pullOnly).finally(() => {
    inFlightSync = null
    inFlightKind = null
  })
  return inFlightSync
}

let inFlightSync: Promise<SyncResult> | null = null
let inFlightKind: 'full' | 'pull' | null = null

async function doRunSync(pullOnly: boolean): Promise<SyncResult> {
  const config: CloudConfig = getCloudConfig()
  if (!config.token) throw new Error('请先登录云同步')

  if (!navigator.onLine) throw new Error('当前离线，联网后再同步')

  // 已经有手动/定时同步在跑时，取消排队中的自动同步，避免重复推送
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }

  let photos = EMPTY_PHOTO_RESULT
  let photosClean = false
  let versionAfterUpload = localVersion
  let pushed = 0
  let skipped = 0

  if (!pullOnly) {
    // 0. 先把本机 data URL 图片（记录照片 / 封面 / 头像）传到 R2
    try {
      photos = await uploadPendingImages()
      // 上传流程整体异常时 failed>0、remaining 可能是 0，绝不能当成已经干净
      photosClean = photos.remaining === 0 && photos.failed === 0
      if (photos.uploaded > 0) {
        markLocalChanges()
        versionAfterUpload = localVersion
      }
    } catch (error) {
      console.warn('[sync] 图片上传失败：', error instanceof Error ? error.message : error)
      photos = { ...EMPTY_PHOTO_RESULT, failed: 1 }
      photosClean = false
    }

    // 1. 推送（先记时间点，推送成功后只清理这之前的墓碑）
    const pushStartedAt = Date.now()
    const local = await exportAllEntities()
    for (let index = 0; index < local.length; index += PUSH_BATCH) {
      const batch = local.slice(index, index + PUSH_BATCH)
      const result = await pushBatch(batch)
      pushed += result.applied
      skipped += result.skipped ?? 0
    }
    await clearTombstonesBefore(pushStartedAt)
  }

  // 2. 拉取
  let cursor = config.cursor
  let pulled = 0
  let removed = 0
  for (let round = 0; round < 50; round++) {
    const response = await fetch(
      `${apiOrigin()}/sync/pull?cursor=${encodeURIComponent(String(cursor))}&limit=500`,
      {
        headers: { authorization: `Bearer ${config.token}` },
      },
    )
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`拉取失败（${response.status}）${text.slice(0, 120)}`)
    }
    const data = (await response.json()) as PullResponse
    if (data.entities.length > 0) {
      const applied = await applyRemoteEntities(data.entities)
      pulled += applied.applied
      removed += applied.removed
    }
    cursor = data.cursor
    if (!data.hasMore) break
  }

  const at = Date.now()
  saveCloudConfig({ cursor, lastSyncAt: at })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('travelog:sync-done', { detail: { at, pushed, pulled, removed } }),
    )
  }
  // 推送期间没有新的本地改动，且图片全部传完，才算这一版已经同步干净
  if (!pullOnly && localVersion === versionAfterUpload && photosClean) {
    syncedVersion = versionAfterUpload
    writeDirty(false)
  }
  return { pushed, pulled, removed, skipped, at, cursor, photos, pullOnly }
}

/**
 * 登录 / 换设备后的首次同步：以云端为准，全量覆盖本地，**不推送**。
 * 云端为空时保留本地数据，避免误清空。
 */
export async function pullOverwrite(): Promise<{ pulled: number }> {
  const config = getCloudConfig()
  if (!config.token) throw new Error('请先登录云同步')
  if (!navigator.onLine) throw new Error('当前离线，联网后再同步')

  let cursor: string | number = 0
  const all: SyncEntity[] = []
  for (let round = 0; round < 100; round++) {
    const response = await fetch(
      `${apiOrigin()}/sync/pull?cursor=${encodeURIComponent(String(cursor))}&limit=1000`,
      {
        headers: { authorization: `Bearer ${config.token}` },
      },
    )
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`拉取失败（${response.status}）${text.slice(0, 120)}`)
    }
    const data = (await response.json()) as PullResponse
    all.push(...data.entities)
    cursor = data.cursor
    if (!data.hasMore) break
  }

  const live = all.filter((entity) => !entity.deleted)
  const at = Date.now()
  if (live.length === 0) {
    // 云端为空（新账号）：保留本地数据，并标记为待推送，避免本地资料一直传不上去
    saveCloudConfig({ cursor, lastSyncAt: at })
    markLocalChanges()
    return { pulled: 0 }
  }
  const applied = await replaceAllWithRemote(live)
  saveCloudConfig({ cursor, lastSyncAt: at })
  // 覆盖后本地与云端一致，必须清脏标记，否则会立刻把全量数据再推一遍
  markSynced()
  return { pulled: applied }
}

/**
 * 登录 / 注册成功后的初始化：先以云端为准拉一次，云端为空则保留本地。
 * 必须在推送之前调用，否则新设备上的本地种子数据会覆盖云端。
 */
export async function bootstrapAfterAuth(): Promise<{ pulled: number; empty: boolean }> {
  const { pulled } = await pullOverwrite()
  return { pulled, empty: pulled === 0 }
}

let timer: number | null = null
let retryTimer: number | null = null
let retryCount = 0
const RETRY_DELAYS = [10_000, 30_000, 60_000]

function emitSyncError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('travelog:sync-error', { detail: { message } }))
  }
}

function autoSyncOnce(): void {
  runSync()
    .then(() => {
      retryCount = 0
    })
    .catch((error) => {
      console.warn('[sync] 自动同步失败：', error?.message ?? error)
      emitSyncError(error)
      const config = getCloudConfig()
      if (!config.autoSync || !config.token || !navigator.onLine) return
      const delay = RETRY_DELAYS[retryCount]
      if (delay === undefined) return
      retryCount += 1
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        autoSyncOnce()
      }, delay)
    })
}

/** 写操作后短延迟触发一次双向同步，接近实时；失败会退避重试（10s/30s/60s） */
export function scheduleAutoSync(delay = 2000): void {
  // 先记下本地改动；即使自动同步关闭，下次手动同步也能识别
  markLocalChanges()
  const config = getCloudConfig()
  if (!config.autoSync || !config.token) return
  if (!navigator.onLine) return
  if (timer !== null) window.clearTimeout(timer)
  // 新一次写操作视为新一轮同步，若不在重试退避中则重置重试计数
  if (retryTimer === null) retryCount = 0
  timer = window.setTimeout(() => {
    timer = null
    autoSyncOnce()
  }, delay)
}