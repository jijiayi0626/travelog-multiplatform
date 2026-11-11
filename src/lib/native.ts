import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { Geolocation } from '@capacitor/geolocation'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/**
 * 原生容器（Android / iOS）内的能力封装。
 * 浏览器 / PWA 走 Web API，调用方用 isNative() 判断走哪条分支。
 */

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

export async function requestLocationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true
  try {
    const status = await Geolocation.requestPermissions()
    return status.location === 'granted' || status.coarseLocation === 'granted'
  } catch {
    return false
  }
}

export async function getCurrentFix(): Promise<Fix | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 30000,
    })
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
  } catch {
    return null
  }
}

export async function watchNativeFix(
  onFix: (fix: Fix) => void,
  onError?: (message: string) => void,
): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    return await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 30000 },
      (position, error) => {
        if (error) {
          onError?.(error.message || '定位失败')
          return
        }
        if (position) {
          onFix({ latitude: position.coords.latitude, longitude: position.coords.longitude })
        }
      },
    )
  } catch (error) {
    onError?.((error as Error).message)
    return null
  }
}

export async function clearNativeWatch(id: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Geolocation.clearWatch({ id })
  } catch {
    /* 已停止时忽略 */
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