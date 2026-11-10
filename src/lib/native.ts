import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'

/**
 * 原生容器内的增强行为：
 * 1. Android 物理返回键优先走路由历史，栈底再退出应用。
 * 2. 其余平台（浏览器 / PWA）不受影响。
 */
export function initNative(): void {
  if (!Capacitor.isNativePlatform()) {
    return
  }
  void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack || window.history.length > 1) {
      window.history.back()
    } else {
      void CapacitorApp.exitApp()
    }
  })
}