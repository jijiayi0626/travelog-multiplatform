import { isNative, shareBinaryFile } from './native'

/** canvas → PNG Blob */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('poster generation failed'))
    }, 'image/png')
  })
}

/** Blob → base64（原生分享需要） */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * 分享/下载 PNG：原生包写入缓存并打开系统分享面板，网页触发下载。
 * 返回 'native' | 'download'，失败时抛错。
 */
export async function sharePngBlob(blob: Blob, filename: string): Promise<'native' | 'download'> {
  if (isNative()) {
    if (await shareBinaryFile(filename, await blobToBase64(blob))) return 'native'
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  return 'download'
}
