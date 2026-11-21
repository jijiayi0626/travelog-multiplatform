import { deleteCloudPhoto, getCloudConfig, uploadAvatar, uploadPhoto } from './cloud'
import { LOCAL_PHOTO_PREFIX, isLocalPhoto } from './photo-utils'
import {
  getProfile,
  getTrip,
  listAllMoments,
  listTrips,
  saveMoment,
  saveProfile,
  saveTrip,
} from './repo'
import { compressDataUrl } from './utils'
import type { Photo } from './types'

/** 单次同步最多上传的张数；实时模式下一次同步会尽量把积压的图片全部传完 */
const MAX_UPLOADS_PER_RUN = 200
/** 超过这个体积先在前端再压一次，避免历史大图上传失败 */
const MAX_DIRECT_BYTES = 6 * 1024 * 1024

export interface PhotoUploadResult {
  uploaded: number
  failed: number
  remaining: number
  covers: number
  avatar: boolean
}

export function isLocalImageSrc(src: string | undefined): boolean {
  return Boolean(src && LOCAL_PHOTO_PREFIX.test(src))
}

function dataUrlBytes(src: string): number {
  const comma = src.indexOf(',')
  if (comma < 0) return 0
  return Math.ceil(((src.length - comma - 1) * 3) / 4)
}

async function uploadWithFallback(src: string) {
  const target = dataUrlBytes(src) > MAX_DIRECT_BYTES ? await compressDataUrl(src) : src
  return uploadPhoto(target)
}

/**
 * 把本机 data URL 图片上传到 R2：
 * - 记录里的照片（moments）
 * - 旅行封面（trips.coverImage）
 * - 个人头像（profile.avatar，走独立接口，避免出现在后台照片列表）
 * 成功后把本地 data URL 换成云端地址；失败保留本地，下次同步重试。
 */
export async function uploadPendingImages(limit = MAX_UPLOADS_PER_RUN): Promise<PhotoUploadResult> {
  const config = getCloudConfig()
  const [initialMoments, initialTrips, initialProfile] = await Promise.all([
    listAllMoments(),
    listTrips(),
    getProfile(),
  ])
  if (!config.token || !navigator.onLine) {
    return {
      uploaded: 0,
      failed: 0,
      remaining: countPending(initialMoments, initialTrips, initialProfile),
      covers: 0,
      avatar: false,
    }
  }

  const photoCache = new Map<string, { id: string; url: string }>()
  let uploaded = 0
  let failed = 0
  let covers = 0
  let avatar = false

  for (const moment of initialMoments) {
    const photos = moment.photos ?? []
    if (!photos.some(isLocalPhoto)) continue

    let changed = false
    const nextPhotos: Photo[] = []
    for (const photo of photos) {
      if (!isLocalPhoto(photo)) {
        nextPhotos.push(photo)
        continue
      }
      const cached = photoCache.get(photo.src)
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
        const result = await uploadWithFallback(photo.src)
        photoCache.set(photo.src, { id: result.id, url: result.url })
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

  for (const trip of initialTrips) {
    if (!isLocalImageSrc(trip.coverImage)) {
      // 封面被移除时顺手清掉 R2 里的旧图
      if (!trip.coverImage && trip.coverCloudId) {
        const raw = await getTrip(trip.id)
        if (raw) {
          void deleteCloudPhoto(trip.coverCloudId).catch(() => undefined)
          await saveTrip({ ...raw, coverCloudId: undefined })
        }
      }
      continue
    }
    if (uploaded >= limit) continue
    try {
      const result = await uploadWithFallback(trip.coverImage as string)
      const raw = await getTrip(trip.id)
      if (!raw) continue
      await saveTrip({ ...raw, coverImage: result.url, coverCloudId: result.id })
      if (trip.coverCloudId && trip.coverCloudId !== result.id) {
        void deleteCloudPhoto(trip.coverCloudId).catch(() => undefined)
      }
      covers += 1
      uploaded += 1
    } catch {
      failed += 1
    }
  }

  if (initialProfile && isLocalImageSrc(initialProfile.avatar) && uploaded < limit) {
    try {
      const result = await uploadAvatar(initialProfile.avatar)
      await saveProfile({ ...initialProfile, avatar: result.url })
      avatar = true
      uploaded += 1
    } catch {
      failed += 1
    }
  }

  const [moments, trips, profile] = await Promise.all([listAllMoments(), listTrips(), getProfile()])
  return {
    uploaded,
    failed,
    remaining: countPending(moments, trips, profile),
    covers,
    avatar,
  }
}

function countPending(
  moments: Array<{ photos?: Photo[] }>,
  trips: Array<{ coverImage?: string }>,
  profile: { avatar?: string } | null,
): number {
  const photos = moments.reduce(
    (total, moment) => total + (moment.photos ?? []).filter(isLocalPhoto).length,
    0,
  )
  const covers = trips.filter((trip) => isLocalImageSrc(trip.coverImage)).length
  return photos + covers + (isLocalImageSrc(profile?.avatar) ? 1 : 0)
}

/** 本机还有多少张图片没上传（记录照片 + 封面 + 头像） */
export async function countPendingImages(): Promise<number> {
  const [moments, trips, profile] = await Promise.all([listAllMoments(), listTrips(), getProfile()])
  return countPending(moments, trips, profile)
}
