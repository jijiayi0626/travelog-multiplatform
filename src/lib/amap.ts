import { Capacitor } from '@capacitor/core'

/**
 * 高德地图跳转封装。
 *
 * 原生包：优先用 location.href 打开 androidamap:// scheme，直接拉起高德 App；
 * 鸿蒙 NEXT 兼容环境再尝试 amapuri://；都不行再回退 uri.amap.com 的 HTTPS 链接。
 * 网页端：直接用 HTTPS（callnative=1 让高德自己决定是否唤起 App）。
 *
 * 自定义 scheme 一律不使用 window.open，避免被浏览器当成普通链接接管；
 * 每次 scheme 尝试带 300ms 超时，避免点了没反应。
 */

const SRC = 'travelog'
const LAUNCH_TIMEOUT = 300

function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

function isHarmony(): boolean {
  if (typeof navigator === 'undefined') return false
  return /OpenHarmony|ArkWeb|HarmonyOS/i.test(navigator.userAgent)
}

function placeName(name: string): string {
  return encodeURIComponent(name.trim() || '目的地')
}

/* ---------------- 跳转字符串 ---------------- */

/** 在地图上标注一个地点（HTTPS 回退链接） */
export function amapMarker(lat: number, lng: number, name: string): string {
  return `https://uri.amap.com/marker?position=${lng},${lat}&name=${placeName(name)}&src=${SRC}&coordinate=gaode&callnative=1`
}

/** 以汽车模式导航到某个地点（HTTPS 回退链接） */
export function amapNav(lat: number, lng: number, name: string): string {
  return `https://uri.amap.com/navigation?to=${lng},${lat},${placeName(name)}&mode=car&src=${SRC}&coordinate=gaode&callnative=1`
}

/** 用关键词搜索地点（适合只有文字、没有经纬度的地点） */
export function amapSearch(keyword: string): string {
  return `https://uri.amap.com/search?keyword=${placeName(keyword)}&src=${SRC}&callnative=1`
}

/* ---------------- scheme ---------------- */

function androidNavi(lat: number, lng: number, name: string): string {
  return `androidamap://navi?sourceApplication=${SRC}&poiname=${placeName(name)}&lat=${lat}&lon=${lng}&dev=0&style=2`
}

function androidViewMap(lat: number, lng: number, name: string): string {
  return `androidamap://viewMap?sourceApplication=${SRC}&poiname=${placeName(name)}&lat=${lat}&lon=${lng}&dev=0`
}

function harmonyNavi(lat: number, lng: number, name: string): string {
  return `amapuri://navi?sourceApplication=${SRC}&poiname=${placeName(name)}&lat=${lat}&lon=${lng}&dev=0&style=2`
}

function harmonyViewMap(lat: number, lng: number, name: string): string {
  return `amapuri://viewMap?sourceApplication=${SRC}&poiname=${placeName(name)}&lat=${lat}&lon=${lng}&dev=0`
}

function androidKeyword(keyword: string): string {
  return `androidamap://keywordNavi?sourceApplication=${SRC}&keyword=${placeName(keyword)}&style=2`
}

function harmonyKeyword(keyword: string): string {
  return `amapuri://keywordNavi?sourceApplication=${SRC}&keyword=${placeName(keyword)}&style=2`
}

/* ---------------- 打开逻辑 ---------------- */

/**
 * 用 location.href 打开自定义 scheme。
 * 页面在 300ms 内进入后台视为拉起成功；否则判定失败，交给下一个 scheme。
 */
function launchScheme(url: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (opened: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onBlur)
      resolve(opened)
    }
    const onVisibility = () => {
      if (document.hidden) finish(true)
    }
    const onBlur = () => finish(true)
    const timer = window.setTimeout(() => finish(false), LAUNCH_TIMEOUT)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onBlur)
    try {
      window.location.href = url
    } catch {
      finish(false)
    }
  })
}

function orderedSchemes(android: string, harmony: string): string[] {
  return isHarmony() ? [harmony, android] : [android, harmony]
}

function openWeb(url: string): void {
  try {
    window.open(url, '_blank', 'noopener')
  } catch {
    /* 弹窗被拦截时忽略 */
  }
}

async function launch(schemes: string[], httpsUrl: string): Promise<void> {
  if (!isNative()) {
    openWeb(httpsUrl)
    return
  }
  for (const scheme of schemes) {
    if (await launchScheme(scheme)) return
  }
  try {
    window.location.href = httpsUrl
  } catch {
    /* 最终回退也失败时保持静默，不向调用方抛错 */
  }
}

export function openAmapMarker(lat: number, lng: number, name: string): void {
  void launch(
    orderedSchemes(androidViewMap(lat, lng, name), harmonyViewMap(lat, lng, name)),
    amapMarker(lat, lng, name),
  )
}

export function openAmapNav(lat: number, lng: number, name: string): void {
  void launch(
    orderedSchemes(androidNavi(lat, lng, name), harmonyNavi(lat, lng, name)),
    amapNav(lat, lng, name),
  )
}

export function openAmapSearch(keyword: string): void {
  const trimmed = keyword.trim()
  if (!trimmed) return
  void launch(
    orderedSchemes(androidKeyword(trimmed), harmonyKeyword(trimmed)),
    amapSearch(trimmed),
  )
}
