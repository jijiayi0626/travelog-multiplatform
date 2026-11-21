import type { Photo } from './types'

export const LOCAL_PHOTO_PREFIX = /^data:image\/(?:jpeg|png|webp);base64,/i

export function isLocalPhoto(photo: Photo): boolean {
  return !photo.cloudId && LOCAL_PHOTO_PREFIX.test(photo.src)
}

export function isRemotePhoto(photo: unknown): photo is Photo {
  return Boolean(
    photo &&
      typeof photo === 'object' &&
      typeof (photo as Photo).src === 'string' &&
      /^https?:\/\//i.test((photo as Photo).src),
  )
}

function isPhoto(photo: unknown): photo is Photo {
  return Boolean(
    photo &&
      typeof photo === 'object' &&
      typeof (photo as Photo).id === 'string' &&
      typeof (photo as Photo).src === 'string',
  )
}

/**
 * 合并远端照片与本机尚未上传的照片：
 * 云端地址优先；远端为空时保留本机全部照片；
 * 本机 data URL 中未被远端覆盖的继续保留。
 */
export function mergeMomentPhotos(remotePhotos: unknown, localPhotos: unknown): Photo[] {
  const remote = Array.isArray(remotePhotos) ? remotePhotos.filter(isRemotePhoto) : []
  const locals = Array.isArray(localPhotos) ? localPhotos.filter(isPhoto) : []
  if (remote.length === 0) return locals
  const pending = locals.filter((photo) => LOCAL_PHOTO_PREFIX.test(photo.src))
  if (pending.length === 0) return remote
  const seen = new Set(remote.map((photo) => photo.id))
  return [...remote, ...pending.filter((photo) => !seen.has(photo.id))]
}
