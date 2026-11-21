import {
  apiOrigin,
  getCloudConfig,
  saveCloudConfig,
  type CloudConfig,
} from './cloud'
import { applyRemoteEntities, exportAllEntities, replaceAllWithRemote, type SyncEntity } from './repo'
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

  let photos = EMPTY_PHOTO_RESULT
  let versionAfterUpload = localVersion
  let pushed = 0
  let skipped = 0

  if (!pullOnly) {
    // 0. 先把本机 data URL 图片（记录照片 / 封面 / 头像）传到 R2
    try {
      photos = await uploadPendingImages()
      if (photos.uploaded > 0) {
        markLocalChanges()
        versionAfterUpload = localVersion
      }
    } catch (error) {
      console.warn('[sync] 图片上传失败：', error instanceof Error ? error.message : error)
      photos = { ...EMPTY_PHOTO_RESULT, failed: 1 }
    }

    // 1. 推送
    const local = await exportAllEntities()
    for (let index = 0; index < local.length; index += PUSH_BATCH) {
      const batch = local.slice(index, index + PUSH_BATCH)
      const result = await pushBatch(batch)
      pushed += result.applied
      skipped += result.skipped ?? 0
    }
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
    window.dispatchEvent(new CustomEvent('travelog:sync-done', { detail: { at } }))
  }
  // 推送期间没有新的本地改动，且图片全部传完，才算这一版已经同步干净
  if (!pullOnly && localVersion === versionAfterUpload && photos.remaining === 0) {
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
    saveCloudConfig({ cursor, lastSyncAt: at })
    return { pulled: 0 }
  }
  const applied = await replaceAllWithRemote(live)
  saveCloudConfig({ cursor, lastSyncAt: at })
  return { pulled: applied }
}

let timer: number | null = null

/** 写操作后短延迟触发一次双向同步，接近实时 */
export function scheduleAutoSync(delay = 2000): void {
  // 先记下本地改动；即使自动同步关闭，下次手动同步也能识别
  markLocalChanges()
  const config = getCloudConfig()
  if (!config.autoSync || !config.token) return
  if (!navigator.onLine) return
  if (timer !== null) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = null
    runSync().catch((error) => {
      console.warn('[sync] 自动同步失败：', error?.message)
    })
  }, delay)
}