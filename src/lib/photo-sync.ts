import { getCloudConfig, uploadPhoto } from './cloud'
import { isLocalPhoto } from './photo-utils'
import { listAllMoments, saveMoment } from './repo'
import type { Photo } from './types'

/** 单次同步最多上传的张数，避免一次同步耗时过长 */
const MAX_UPLOADS_PER_RUN = 24

export interface PhotoUploadResult {
  uploaded: number
  failed: number
  remaining: number
}

/**
 * 把本地 data URL 照片上传到 R2，并把 moment 里的 src 换成云端地址。
 * 失败的照片保持本地 data URL，下次同步继续重试。
 */
export async function uploadPendingPhotos(limit = MAX_UPLOADS_PER_RUN): Promise<PhotoUploadResult> {
  const config = getCloudConfig()
  if (!config.token || !navigator.onLine) {
    const moments = await listAllMoments()
    return { uploaded: 0, failed: 0, remaining: countPending(moments) }
  }

  const moments = await listAllMoments()
  const uploadedCache = new Map<string, { id: string; url: string }>()
  let uploaded = 0
  let failed = 0

  for (const moment of moments) {
    const photos = moment.photos ?? []
    if (!photos.some(isLocalPhoto)) continue

    let changed = false
    const nextPhotos: Photo[] = []
    for (const photo of photos) {
      if (!isLocalPhoto(photo)) {
        nextPhotos.push(photo)
        continue
      }
      const cached = uploadedCache.get(photo.src)
      if (cached) {
        nextPhotos.push({ ...photo, cloudId: cached.id, src: cached.url })
        changed = true
        continue
      }
      if (uploaded >= limit) {
        nextPhotos.push(photo)
        continue
      }
      try {
        const result = await uploadPhoto(photo.src)
        uploadedCache.set(photo.src, { id: result.id, url: result.url })
        nextPhotos.push({ ...photo, cloudId: result.id, src: result.url })
        uploaded += 1
        changed = true
      } catch {
        failed += 1
        nextPhotos.push(photo)
      }
    }
    if (changed) await saveMoment({ ...moment, photos: nextPhotos })
  }

  const after = await listAllMoments()
  return { uploaded, failed, remaining: countPending(after) }
}

function countPending(moments: Array<{ photos?: Photo[] }>): number {
  return moments.reduce(
    (total, moment) => total + (moment.photos ?? []).filter(isLocalPhoto).length,
    0,
  )
}
