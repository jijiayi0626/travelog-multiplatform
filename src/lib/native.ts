import { Capacitor, registerPlugin } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/**
 * 原生容器（Android / iOS）内的能力封装。
 * 浏览器 / PWA 走 Web API，调用方用 isNative() 判断走哪条分支。
 *
 * 定位使用自研插件 SystemLocation：基于 Android 系统 LocationManager，
 * 不依赖 Google Play 服务，因此在华为鸿蒙 / 无 GMS 设备上同样可用。
 */

interface SystemLocationPlugin {
  requestPermission(): Promise<{ granted: boolean }>
  getCurrent(): Promise<{ latitude: number; longitude: number; accuracy?: number }>
  watch(): Promise<{ watching: boolean }>
  clearWatch(): Promise<void>
  addListener(
    event: 'locationChange',
    listener: (data: { latitude: number; longitude: number }) => void,
  ): Promise<{ remove: () => void }>
}

const SystemLocation = registerPlugin<SystemLocationPlugin>('SystemLocation')

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/* ---------------- 返回键 ---------------- */

export function initNative(): void {
  if (!Capacitor.isNativePlatform()) return
  void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack || window.history.length > 1) window.history.back()
    else void CapacitorApp.exitApp()
  })
}

/* ---------------- 定位 ---------------- */

export interface Fix {
  latitude: number
  longitude: number
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('定位超时')), ms)),
  ])
}

export async function requestLocationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true
  try {
    const result = await SystemLocation.requestPermission()
    return Boolean(result.granted)
  } catch {
    return false
  }
}

export async function getBestFix(): Promise<Fix | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const result = await withTimeout(SystemLocation.getCurrent(), 15000)
    return { latitude: result.latitude, longitude: result.longitude }
  } catch {
    return null
  }
}

export async function getCurrentFix(): Promise<Fix | null> {
  return getBestFix()
}

let watchHandle: { remove: () => void } | null = null
let watching = false

export async function watchNativeFix(
  onFix: (fix: Fix) => void,
  onError?: (message: string) => void,
): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    watchHandle = await SystemLocation.addListener('locationChange', (data) => {
      onFix({ latitude: data.latitude, longitude: data.longitude })
    })
    await SystemLocation.watch()
    watching = true
    return 'system-location'
  } catch (error) {
    onError?.((error as Error).message || '定位失败')
    return null
  }
}

export async function clearNativeWatch(_id: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    if (watching) await SystemLocation.clearWatch()
  } catch {
    /* 已停止时忽略 */
  }
  watching = false
  if (watchHandle) {
    try {
      watchHandle.remove()
    } catch {
      /* 忽略 */
    }
    watchHandle = null
  }
}

/* ---------------- 文件导出 ---------------- */

const SHARE_ERROR_KEY = 'travelog.lastShareError'

/** 串行化系统分享面板，避免连续点击时并发调用导致后续分享不弹出 */
let shareChain: Promise<void> = Promise.resolve()

function serializedShare<T>(task: () => Promise<T>): Promise<T> {
  const result = shareChain.then(task, task)
  shareChain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/** 每次分享使用唯一文件名，避免缓存文件被上一次分享占用或覆盖 */
function uniqueShareFilename(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  if (dot > 0) return `${filename.slice(0, dot)}-${suffix}${filename.slice(dot)}`
  return `${filename}-${suffix}`
}

function recordShareError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  try {
    localStorage.setItem(SHARE_ERROR_KEY, message || '分享失败')
  } catch {
    /* 无 localStorage 时忽略 */
  }
}

/** 读取上一次原生分享失败的具体原因 */
export function getLastShareError(): string {
  try {
    return localStorage.getItem(SHARE_ERROR_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 把 base64 文件写到缓存并打开系统分享面板（图片、PDF 等二进制文件） */
export async function shareBinaryFile(filename: string, base64: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  return serializedShare(async () => {
    try {
      const result = await Filesystem.writeFile({
        path: uniqueShareFilename(filename),
        data: base64,
        directory: Directory.Cache,
      })
      await Share.share({
        title: filename,
        url: result.uri,
        files: [result.uri],
        dialogTitle: '分享或保存文件',
      })
      return true
    } catch (error) {
      recordShareError(error)
      return false
    }
  })
}

export async function shareTextFile(filename: string, content: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  return serializedShare(async () => {
    try {
      const result = await Filesystem.writeFile({
        path: uniqueShareFilename(filename),
        data: content,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      })
      await Share.share({
        title: filename,
        text: `旅记备份 ${filename}`,
        url: result.uri,
        files: [result.uri],
        dialogTitle: '保存或分享备份',
      })
      return true
    } catch (error) {
      recordShareError(error)
      return false
    }
  })
}