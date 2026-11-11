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

/**
 * 写入缓存目录并唤起系统分享面板。
 * WebView 里 a[download] 不会落地，走分享面板后用户可选「保存到文件」。
 */
export async function shareTextFile(filename: string, content: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const result = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    })
    await Share.share({
      title: filename,
      text: `旅记备份 ${filename}`,
      url: result.uri,
      dialogTitle: '保存或分享备份',
    })
    return true
  } catch {
    return false
  }
}