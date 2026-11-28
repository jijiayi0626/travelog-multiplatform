import { Capacitor } from '@capacitor/core'
import { assetUrl } from './utils'

/**
 * 离线引擎地址：
 * - 网页端使用随站点部署的本地资源（public/vosk、public/tesseract）；
 * - Android 原生端不打包引擎，首次使用时从 jsDelivr 下载，以缩小 APK。
 * 版本号需与 package.json 中的 tesseract.js 依赖及实际安装的 tesseract.js-core 保持一致。
 */
const CDN_BASE = 'https://cdn.jsdelivr.net/npm'
const VOSK_BROWSER_VERSION = '0.0.8'
const TESSERACT_JS_VERSION = '7.0.0'
const TESSERACT_CORE_VERSION = '7.0.0'

/** 原生端首次下载引擎失败时的统一提示 */
export const ENGINE_DOWNLOAD_ERROR = '引擎下载失败，请检查网络'

export function isNativeRuntime(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export function voskEngineUrl(): string {
  return isNativeRuntime()
    ? `${CDN_BASE}/vosk-browser@${VOSK_BROWSER_VERSION}/dist/vosk.js`
    : assetUrl('vosk/vosk.js')
}

export function tesseractWorkerUrl(): string {
  return isNativeRuntime()
    ? `${CDN_BASE}/tesseract.js@${TESSERACT_JS_VERSION}/dist/worker.min.js`
    : assetUrl('tesseract/worker.min.js')
}

/** 目录地址，tesseract 会自行拼接 tesseract-core-*.wasm.js */
export function tesseractCoreUrl(): string {
  return isNativeRuntime()
    ? `${CDN_BASE}/tesseract.js-core@${TESSERACT_CORE_VERSION}/`
    : assetUrl('tesseract')
}

/** 原生端引擎加载失败时给出明确的网络提示，网页端保留具体原因 */
export function engineLoadError(detail: string): Error {
  return new Error(isNativeRuntime() ? ENGINE_DOWNLOAD_ERROR : detail)
}
