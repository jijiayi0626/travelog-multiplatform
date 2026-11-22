import { Browser } from '@capacitor/browser'
import { getLatestAppRelease, type AppRelease } from './cloud'
import { isNative } from './native'

export type UpdateMode = 'auto' | 'mirror1' | 'mirror2' | 'github' | 'custom'

export const UPDATE_MODE_KEY = 'travelog.updateMode'
export const UPDATE_CUSTOM_KEY = 'travelog.updateCustomBase'
export const UPDATE_SKIPPED_KEY = 'travelog.updateSkippedVersion'

/** 国内下载加速：两个优选 CDN 节点 + GitHub 直连 */
export const APK_MIRRORS = [
  { key: 'mirror1', label: '节点一', base: 'https://v6.gh-proxy.org/', host: 'v6.gh-proxy.org' },
  { key: 'mirror2', label: '节点二', base: 'https://cdn.gh-proxy.com/', host: 'cdn.gh-proxy.com' },
  { key: 'github', label: 'GitHub 直连', base: '', host: 'github.com' },
] as const

export const UPDATE_MODES: Array<{ key: UpdateMode; label: string }> = [
  { key: 'auto', label: '自动' },
  { key: 'mirror1', label: '节点一' },
  { key: 'mirror2', label: '节点二' },
  { key: 'github', label: 'GitHub 直连' },
  { key: 'custom', label: '自定义' },
]

export function normalizeMode(value: string | null): UpdateMode {
  return UPDATE_MODES.some((item) => item.key === value) ? (value as UpdateMode) : 'auto'
}

export function readUpdateMode(): UpdateMode {
  return normalizeMode(localStorage.getItem(UPDATE_MODE_KEY))
}

export function writeUpdateMode(mode: UpdateMode): void {
  localStorage.setItem(UPDATE_MODE_KEY, mode)
}

export function readCustomBase(): string {
  return localStorage.getItem(UPDATE_CUSTOM_KEY) || ''
}

export function writeCustomBase(value: string): void {
  localStorage.setItem(UPDATE_CUSTOM_KEY, value)
}

export function versionValue(version: string): number {
  return String(version)
    .replace(/^v/i, '')
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0)
    .reduce((acc, part) => acc * 1000 + part, 0)
}

/** 线上版本是否比当前应用更新 */
export function isNewer(version: string, current = __APP_VERSION__): boolean {
  return versionValue(version) > versionValue(current)
}

export function mirrorUrl(base: string, url: string): string {
  if (!base) return url
  return `${base.replace(/\/+$/, '')}/${url}`
}

export function formatSize(size: number): string {
  if (!size) return ''
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/* ---------------- 最新版本 ---------------- */

let releaseCache: { data: AppRelease; at: number } | null = null
const RELEASE_TTL = 5 * 60_000

/** 5 分钟内复用结果，避免弹窗、下载页、关于页各查一次 */
export async function loadLatestRelease(force = false): Promise<AppRelease> {
  if (!force && releaseCache && Date.now() - releaseCache.at < RELEASE_TTL) {
    return releaseCache.data
  }
  const data = await getLatestAppRelease()
  releaseCache = { data, at: Date.now() }
  return data
}

export function pickApk(release: AppRelease | null) {
  if (!release) return null
  return release.assets.find((asset) => /release/i.test(asset.name)) ?? release.assets[0] ?? null
}

/* ---------------- 自动测速 ---------------- */

export interface DownloadBase {
  base: string
  label: string
  /** 毫秒；未测速时是 -1 */
  ms: number
}

const PROBE_TIMEOUT = 2500

/** GET 只等到响应头就立即中断，既跨域又能识别真正可下载的线路 */
function probe(base: string, url: string): Promise<number> {
  const target = mirrorUrl(base, url)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT)
  const started = performance.now()
  return fetch(target, {
    mode: 'no-cors',
    cache: 'no-store',
    signal: controller.signal,
  })
    .then(() => {
      const elapsed = performance.now() - started
      controller.abort()
      return elapsed
    })
    .catch(() => Number.POSITIVE_INFINITY)
    .finally(() => window.clearTimeout(timer))
}

let fastestCache: { url: string; picked: DownloadBase; at: number } | null = null

/** 自动模式：同时探测三条线路，选响应最快的 */
export async function pickFastestBase(apkUrl: string): Promise<DownloadBase> {
  if (!apkUrl) return { base: APK_MIRRORS[0].base, label: APK_MIRRORS[0].label, ms: -1 }
  if (fastestCache && fastestCache.url === apkUrl && Date.now() - fastestCache.at < 10 * 60_000) {
    return fastestCache.picked
  }
  const results = await Promise.all(
    APK_MIRRORS.map(async (mirror) => ({
      base: mirror.base,
      label: mirror.label,
      ms: await probe(mirror.base, apkUrl),
    })),
  )
  const reachable = results.filter((item) => Number.isFinite(item.ms))
  const picked =
    reachable.sort((a, b) => a.ms - b.ms)[0] ??
    ({ base: APK_MIRRORS[0].base, label: APK_MIRRORS[0].label, ms: -1 } as DownloadBase)
  fastestCache = { url: apkUrl, picked, at: Date.now() }
  return picked
}

export async function chooseDownloadBase(
  apkUrl: string,
  mode: UpdateMode,
  customBase: string,
): Promise<DownloadBase> {
  if (mode === 'auto') return pickFastestBase(apkUrl)
  if (mode === 'mirror2') {
    return { base: APK_MIRRORS[1].base, label: APK_MIRRORS[1].label, ms: -1 }
  }
  if (mode === 'github') {
    return { base: APK_MIRRORS[2].base, label: APK_MIRRORS[2].label, ms: -1 }
  }
  if (mode === 'custom') {
    return { base: customBase.trim(), label: '自定义', ms: -1 }
  }
  return { base: APK_MIRRORS[0].base, label: APK_MIRRORS[0].label, ms: -1 }
}

/* ---------------- 打开链接 ---------------- */

export async function openExternal(url: string): Promise<void> {
  if (isNative()) {
    await Browser.open({ url })
    return
  }
  // 直接触发 <a download>，避免测速 await 之后 window.open 被浏览器拦截
  const link = document.createElement('a')
  link.href = url
  link.download = url.split('?')[0].split('/').pop() || 'travelog.apk'
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => link.remove(), 1500)
}

export async function downloadApk(
  apkUrl: string,
  mode: UpdateMode,
  customBase: string,
): Promise<DownloadBase> {
  const picked = await chooseDownloadBase(apkUrl, mode, customBase)
  await openExternal(mirrorUrl(picked.base, apkUrl))
  return picked
}

/* ---------------- 更新弹窗 ---------------- */

export function skippedVersion(): string {
  return localStorage.getItem(UPDATE_SKIPPED_KEY) || ''
}

export function skipVersion(version: string): void {
  localStorage.setItem(UPDATE_SKIPPED_KEY, version)
}

/** Release 说明去掉 Markdown 记号，供弹窗里做纯文本预览 */
export function plainNotes(notes: string, max = 360): string {
  const text = String(notes || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '· ')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return text.length > max ? `${text.slice(0, max).trim()}…` : text
}
