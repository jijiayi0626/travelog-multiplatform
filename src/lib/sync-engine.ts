import {
  apiOrigin,
  getCloudConfig,
  saveCloudConfig,
  type CloudConfig,
} from './cloud'
import { applyRemoteEntities, exportAllEntities, replaceAllWithRemote, type SyncEntity } from './repo'

export interface SyncResult {
  pushed: number
  pulled: number
  removed: number
  skipped: number
  at: number
  cursor: number
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
  cursor: number
  entities: SyncEntity[]
  hasMore: boolean
}

/**
 * 全量推送 + 增量拉取。
 * 推送使用 LWW（服务端按 updatedAt 比较），拉取按 cursor 游标分页。
 */
export async function runSync(): Promise<SyncResult> {
  const config: CloudConfig = getCloudConfig()
  if (!config.token) throw new Error('请先登录云同步')

  if (!navigator.onLine) throw new Error('当前离线，联网后再同步')

  // 1. 推送
  const local = await exportAllEntities()
  let pushed = 0
  let skipped = 0
  for (let index = 0; index < local.length; index += PUSH_BATCH) {
    const batch = local.slice(index, index + PUSH_BATCH)
    const result = await pushBatch(batch)
    pushed += result.applied
    skipped += result.skipped ?? 0
  }

  // 2. 拉取
  let cursor = config.cursor
  let pulled = 0
  let removed = 0
  for (let round = 0; round < 50; round++) {
    const response = await fetch(`${apiOrigin()}/sync/pull?cursor=${cursor}&limit=500`, {
      headers: { authorization: `Bearer ${config.token}` },
    })
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
  return { pushed, pulled, removed, skipped, at, cursor }
}

/**
 * 登录 / 换设备后的首次同步：以云端为准，全量覆盖本地，**不推送**。
 * 云端为空时保留本地数据，避免误清空。
 */
export async function pullOverwrite(): Promise<{ pulled: number }> {
  const config = getCloudConfig()
  if (!config.token) throw new Error('请先登录云同步')
  if (!navigator.onLine) throw new Error('当前离线，联网后再同步')

  let cursor = 0
  const all: SyncEntity[] = []
  for (let round = 0; round < 100; round++) {
    const response = await fetch(`${apiOrigin()}/sync/pull?cursor=${cursor}&limit=1000`, {
      headers: { authorization: `Bearer ${config.token}` },
    })
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
export function scheduleAutoSync(delay = 800): void {
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