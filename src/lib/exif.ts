export interface ExifGps {
  latitude: number
  longitude: number
}

function readRational(view: DataView, offset: number, little: boolean): number {
  const numerator = view.getUint32(offset, little)
  const denominator = view.getUint32(offset + 4, little)
  return denominator === 0 ? 0 : numerator / denominator
}

function readDms(view: DataView, offset: number, little: boolean): number {
  const a = readRational(view, offset, little)
  const b = readRational(view, offset + 8, little)
  const c = readRational(view, offset + 16, little)
  return a + b / 60 + c / 3600
}

/**
 * 只解析 JPEG 的 EXIF GPS 字段，不依赖第三方库。
 * 失败或没有 GPS 时返回 null。
 */
export function parseExifGps(buffer: ArrayBuffer): ExifGps | null {
  try {
    const view = new DataView(buffer)
    if (view.byteLength < 4) return null
    if (view.getUint16(0, false) !== 0xffd8) return null

    let offset = 2
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset, false)
      if ((marker & 0xff00) !== 0xff00) break
      const size = view.getUint16(offset + 2, false)
      if (marker === 0xffe1) {
        const exifStart = offset + 4
        if (
          view.getUint32(exifStart, false) === 0x45786966 &&
          view.getUint16(exifStart + 4, false) === 0x0000
        ) {
          const tiff = exifStart + 6
          const little = view.getUint16(tiff, false) === 0x4949
          const ifd0 = tiff + view.getUint32(tiff + 4, little)
          const gps = findGpsIfd(view, ifd0, tiff, little)
          if (gps === null) return null
          return readGps(view, gps, tiff, little)
        }
      }
      if (marker === 0xffda) break
      offset += 2 + size
    }
    return null
  } catch {
    return null
  }
}

function findGpsIfd(view: DataView, ifd0: number, tiff: number, little: boolean): number | null {
  if (ifd0 + 2 > view.byteLength) return null
  const count = view.getUint16(ifd0, little)
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12
    if (entry + 12 > view.byteLength) return null
    const tag = view.getUint16(entry, little)
    if (tag === 0x8825) {
      return tiff + view.getUint32(entry + 8, little)
    }
  }
  return null
}

function readGps(view: DataView, gpsIfd: number, tiff: number, little: boolean): ExifGps | null {
  if (gpsIfd + 2 > view.byteLength) return null
  const count = view.getUint16(gpsIfd, little)
  let lat: number | null = null
  let lng: number | null = null
  let latRef = 'N'
  let lngRef = 'E'

  for (let i = 0; i < count; i++) {
    const entry = gpsIfd + 2 + i * 12
    if (entry + 12 > view.byteLength) break
    const tag = view.getUint16(entry, little)
    const valueOffset = tiff + view.getUint32(entry + 8, little)

    if (tag === 0x0001) latRef = String.fromCharCode(view.getUint8(entry + 8))
    else if (tag === 0x0003) lngRef = String.fromCharCode(view.getUint8(entry + 8))
    else if (tag === 0x0002) lat = readDms(view, valueOffset, little)
    else if (tag === 0x0004) lng = readDms(view, valueOffset, little)
  }

  if (lat === null || lng === null) return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (latRef === 'S') lat = -lat
  if (lngRef === 'W') lng = -lng
  if (lat === 0 && lng === 0) return null
  return { latitude: lat, longitude: lng }
}

/** 从图片文件读取 GPS；只读前 256KB，够覆盖 EXIF */
export async function readFileGps(file: File): Promise<ExifGps | null> {
  try {
    const head = await file.slice(0, 256 * 1024).arrayBuffer()
    return parseExifGps(head)
  } catch {
    return null
  }
}