import { createWorker, type Worker } from 'tesseract.js'
import { engineLoadError, tesseractCoreUrl, tesseractWorkerUrl } from './engine-url'

/**
 * 离线小票识别：网页端引擎（worker + wasm）位于 public/tesseract，
 * Android 端首次使用时从 CDN 下载；中文语言模型（约 1.7MB）不打包，
 * 由用户在此仓库的 models 目录手动下载。
 */
const READY_KEY = 'travelog.ocrModelReady'
const MODEL_LANG = 'chi_sim'

/** 中文模型解压前约 1.7MB，用于页面提示 */
export const OCR_MODEL_SIZE_MB = 1.7

/** 依次尝试：jsDelivr → GitHub raw → 加速节点一 → 加速节点二 */
export const OCR_MODEL_MIRRORS = [
  'https://cdn.jsdelivr.net/gh/jijiayi0626/travelog-multiplatform@main/models',
  'https://raw.githubusercontent.com/jijiayi0626/travelog-multiplatform/main/models',
  'https://v6.gh-proxy.org/https://raw.githubusercontent.com/jijiayi0626/travelog-multiplatform/main/models',
  'https://cdn.gh-proxy.com/https://raw.githubusercontent.com/jijiayi0626/travelog-multiplatform/main/models',
] as const

let lastError = ''

const workerPath = tesseractWorkerUrl()
const corePath = tesseractCoreUrl()

function workerOptions(logger?: (progress: number) => void, langPath: string = OCR_MODEL_MIRRORS[0]) {
  return {
    workerPath,
    corePath,
    langPath,
    logger: (message: { status: string; progress: number }) => {
      if (!logger) return
      if (message.status === 'loading language traineddata') {
        logger(Math.max(0, Math.min(1, message.progress)))
      }
    },
  }
}

const DOWNLOAD_TIMEOUT_MS = 45_000
const RECOGNIZE_TIMEOUT_MS = 90_000

/**
 * tesseract.js 在语言包下载失败时不会 reject createWorker（只会停在 pending），
 * 这里用 errorHandler + 超时做兜底，避免页面一直卡在下载中。
 */
async function createOcrWorker(
  langPath: string,
  onProgress?: (progress: number) => void,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
): Promise<Worker> {
  let abort: ((error: Error) => void) | null = null
  let aborted = false
  const failure = new Promise<never>((_, reject) => {
    abort = reject
  })
  const pending = createWorker(MODEL_LANG, 1, {
    ...workerOptions(onProgress, langPath),
    errorHandler: (error: unknown) => {
      lastError = error instanceof Error ? error.message : String(error)
      abort?.(new Error(lastError))
    },
  }).then(async (worker) => {
    if (aborted) {
      await worker.terminate()
      throw new Error(lastError || '识别引擎初始化失败')
    }
    return worker
  })
  let timer = 0
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      aborted = true
      reject(new Error('引擎初始化超时，请检查网络后重试'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([pending, failure, timeout])
  } catch (error) {
    aborted = true
    throw engineLoadError(error instanceof Error ? error.message : String(error))
  } finally {
    window.clearTimeout(timer)
  }
}

export function isOcrModelReady(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === '1'
  } catch {
    return false
  }
}

export function getOcrModelError(): string {
  return lastError
}

/**
 * 通过真正创建一次 worker 触发语言包下载。
 * 下载后会写入 IndexedDB 缓存；三个镜像都失败时返回 false。
 */
export async function downloadOcrModel(
  onProgress?: (progress: number) => void,
): Promise<boolean> {
  lastError = ''
  for (const mirror of OCR_MODEL_MIRRORS) {
    try {
      const worker = await createOcrWorker(mirror, onProgress)
      await worker.terminate()
      localStorage.setItem(READY_KEY, '1')
      onProgress?.(1)
      return true
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  return false
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** 清除下载标记、tesseract 的 IndexedDB 缓存以及同名前缀的 Cache Storage */
export async function deleteOcrModel(): Promise<void> {
  try {
    localStorage.removeItem(READY_KEY)
  } catch {
    /* 隐私模式下可能不可用 */
  }
  try {
    if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases()
      const names = databases
        .map((item) => item.name ?? '')
        // tesseract.js 用 idb-keyval 缓存语言包，数据库名为 keyval-store
        .filter((name) => /tesseract|keyval/i.test(name))
      await Promise.all(names.map(deleteDatabase))
    }
  } catch {
    /* 不支持枚举时忽略 */
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => /tesseract/i.test(key)).map((key) => caches.delete(key)))
    }
  } catch {
    /* 忽略 */
  }
  lastError = ''
}

/** 用本地引擎识别小票文字；调用方需先确认模型已下载 */
export async function recognizeReceiptText(image: string): Promise<string> {
  if (!isOcrModelReady()) {
    throw new Error('离线识别模型尚未下载')
  }
  let worker: Worker | null = null
  try {
    worker = await createOcrWorker(OCR_MODEL_MIRRORS[0], undefined, RECOGNIZE_TIMEOUT_MS)
    const result = await worker.recognize(image)
    return result.data.text || ''
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`小票识别失败：${message}`)
  } finally {
    try {
      await worker?.terminate()
    } catch {
      /* 已退出 */
    }
  }
}
