import { assetUrl } from './utils'

/**
 * 离线语音：Vosk 引擎（public/vosk/vosk.js，随 APK 内置）+
 * 中文模型 vosk-cn.tar.gz（约 40MB），由用户按需下载后放入 Cache Storage。
 */
const READY_KEY = 'travelog.voskModelReady'
const CACHE_NAME = 'travelog-vosk'
const CACHE_KEY = 'vosk-cn.tar.gz'
const SCRIPT_ID = 'travelog-vosk-engine'

/** 中文模型约 40MB，用于页面提示 */
export const VOSK_MODEL_SIZE_MB = 40

/** 依次尝试：jsDelivr → GitHub raw → 加速节点一 → 加速节点二 */
export const VOSK_MODEL_MIRRORS = [
  'https://cdn.jsdelivr.net/gh/jijiayi0626/travelog-multiplatform@main/models',
  'https://raw.githubusercontent.com/jijiayi0626/travelog-multiplatform/main/models',
  'https://v6.gh-proxy.org/https://raw.githubusercontent.com/jijiayi0626/travelog-multiplatform/main/models',
  'https://cdn.gh-proxy.com/https://raw.githubusercontent.com/jijiayi0626/travelog-multiplatform/main/models',
] as const

interface VoskRecognizerLike {
  on: (
    event: 'partialresult' | 'result' | 'error',
    listener: (message: {
      result?: { partial?: string; text?: string }
      error?: string
    }) => void,
  ) => void
  acceptWaveform: (buffer: AudioBuffer) => void
  retrieveFinalResult: () => void
  remove: () => void
}

interface VoskModelLike {
  KaldiRecognizer: new (sampleRate: number, grammar?: string) => VoskRecognizerLike
  terminate: () => void
}

interface VoskGlobalLike {
  createModel: (modelUrl: string, logLevel?: number) => Promise<VoskModelLike>
}

let lastError = ''
let scriptPromise: Promise<VoskGlobalLike> | null = null

export function getVoskModelError(): string {
  return lastError
}

function getVoskGlobal(): VoskGlobalLike | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { Vosk?: VoskGlobalLike }).Vosk ?? null
}

/** 动态注入 public/vosk/vosk.js（UMD 全局 Vosk），避免 npm 打包 worker 路径问题 */
function loadVoskEngine(): Promise<VoskGlobalLike> {
  const existing = getVoskGlobal()
  if (existing) return Promise.resolve(existing)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('当前环境不支持离线语音'))
      return
    }
    const done = () => {
      const global = getVoskGlobal()
      if (global) resolve(global)
      else {
        scriptPromise = null
        reject(new Error('离线语音引擎加载失败'))
      }
    }
    const fail = () => {
      scriptPromise = null
      document.getElementById(SCRIPT_ID)?.remove()
      reject(new Error('离线语音引擎加载失败，请检查安装包是否完整'))
    }
    const current = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (current) {
      current.addEventListener('load', done, { once: true })
      current.addEventListener('error', fail, { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = assetUrl('vosk/vosk.js')
    script.async = true
    script.addEventListener('load', done, { once: true })
    script.addEventListener('error', fail, { once: true })
    document.head.appendChild(script)
  })
  return scriptPromise
}

async function getCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  return caches.open(CACHE_NAME)
}

const IDB_NAME = 'travelog-vosk-idb'
const IDB_STORE = 'blobs'

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(blob: Blob): Promise<boolean> {
  try {
    const db = await idbOpen()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(blob, CACHE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    return true
  } catch {
    return false
  }
}

async function idbGet(): Promise<Blob | null> {
  try {
    const db = await idbOpen()
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(CACHE_KEY)
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return blob
  } catch {
    return null
  }
}

async function idbDelete(): Promise<void> {
  try {
    const db = await idbOpen()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(CACHE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
    db.close()
  } catch {
    /* 忽略 */
  }
}

/** 优先 Cache Storage，不支持时退回 IndexedDB（部分 WebView / 非安全上下文） */
async function getModelBlob(): Promise<Blob | null> {
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(CACHE_NAME)
      const hit = await cache.match(CACHE_KEY)
      if (hit) {
        const blob = await hit.blob()
        if (blob.size > 0) return blob
      }
    }
  } catch {
    /* 继续尝试 IndexedDB */
  }
  return idbGet()
}

export async function isVoskModelReady(): Promise<boolean> {
  try {
    if (localStorage.getItem(READY_KEY) !== '1') return false
    return Boolean(await getModelBlob())
  } catch {
    return false
  }
}

const PART_BYTES = 9_000_000
const PART_COUNT = 5
const TOTAL_BYTES = 43_900_310

async function readPart(
  response: Response,
  baseBytes: number,
  controller: AbortController,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  if (!response.body) {
    const blob = await response.blob()
    onProgress?.(Math.min(0.99, (baseBytes + blob.size) / TOTAL_BYTES))
    return blob
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  // 代理返回 200 后可能不再吐数据，60 秒没有新字节就放弃
  let watchdog = window.setTimeout(() => controller.abort(), 60_000)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      window.clearTimeout(watchdog)
      watchdog = window.setTimeout(() => controller.abort(), 60_000)
      chunks.push(value)
      received += value.byteLength
      onProgress?.(Math.min(0.99, (baseBytes + received) / TOTAL_BYTES))
    }
  } finally {
    window.clearTimeout(watchdog)
  }
  return new Blob(chunks as unknown as BlobPart[], { type: 'application/gzip' })
}

/** 模型按 9MB 分片，避免单次大文件请求被代理截断；逐片尝试三个镜像 */
export async function downloadVoskModel(
  onProgress?: (progress: number) => void,
): Promise<boolean> {
  lastError = ''
  onProgress?.(0)
  const parts: Blob[] = []
  let doneBytes = 0
  for (let index = 0; index < PART_COUNT; index += 1) {
    let part: Blob | null = null
    for (const mirror of VOSK_MODEL_MIRRORS) {
      const controller = new AbortController()
      const overall = window.setTimeout(() => controller.abort(), 180_000)
      try {
        const response = await fetch(`${mirror}/${CACHE_KEY}.part${index}`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = await readPart(response, doneBytes, controller, onProgress)
        const expected =
          index === PART_COUNT - 1 ? TOTAL_BYTES - index * PART_BYTES : PART_BYTES
        if (blob.size !== expected) {
          throw new Error(`分片 ${index + 1} 不完整（${blob.size}/${expected}）`)
        }
        part = blob
        break
      } catch (error) {
        lastError =
          error instanceof Error && error.name === 'AbortError'
            ? '下载超时'
            : error instanceof Error
              ? error.message
              : String(error)
      } finally {
        window.clearTimeout(overall)
      }
    }
    if (!part) return false
    parts.push(part)
    doneBytes += part.size
  }
  const blob = new Blob(parts, { type: 'application/gzip' })
  if (blob.size !== TOTAL_BYTES) {
    lastError = `模型文件不完整（${blob.size}/${TOTAL_BYTES}）`
    return false
  }
  let stored = false
  try {
    const cache = await getCache()
    if (cache) {
      await cache.put(CACHE_KEY, new Response(blob))
      stored = true
    }
  } catch {
    /* 退回 IndexedDB */
  }
  if (!stored) stored = await idbSet(blob)
  if (!stored) {
    lastError = '当前环境无法保存离线模型'
    return false
  }
  localStorage.setItem(READY_KEY, '1')
  onProgress?.(1)
  return true
}

/** 删除下载标记与模型缓存 */
export async function deleteVoskModel(): Promise<void> {
  try {
    localStorage.removeItem(READY_KEY)
  } catch {
    /* 隐私模式下可能不可用 */
  }
  try {
    if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME)
  } catch {
    /* 忽略 */
  }
  await idbDelete()
  lastError = ''
}

export interface OfflineListenOptions {
  onResult: (text: string, isFinal: boolean) => void
  onError: (message: string) => void
}

/**
 * 用本地 Vosk 模型开始实时识别，返回停止函数。
 * 停止时会请求最终结果，并释放麦克风、AudioContext、识别器与模型。
 */
export async function startOfflineListening({
  onResult,
  onError,
}: OfflineListenOptions): Promise<() => Promise<void>> {
  const blob = await getModelBlob()
  if (!blob) throw new Error('离线语音模型尚未下载')
  if (blob.size === 0) throw new Error('离线语音模型文件为空，请重新下载')

  const Vosk = await loadVoskEngine()
  const modelUrl = URL.createObjectURL(blob)
  let model: VoskModelLike | null = null
  let recognizer: VoskRecognizerLike | null = null
  let stream: MediaStream | null = null
  let audioContext: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let processor: ScriptProcessorNode | null = null
  let stopped = false

  const cleanup = async () => {
    try {
      processor?.disconnect()
    } catch {
      /* 已断开 */
    }
    try {
      source?.disconnect()
    } catch {
      /* 已断开 */
    }
    try {
      stream?.getTracks().forEach((track) => track.stop())
    } catch {
      /* 忽略 */
    }
    try {
      recognizer?.remove()
    } catch {
      /* 已移除 */
    }
    try {
      model?.terminate()
    } catch {
      /* 已退出 */
    }
    if (audioContext) {
      try {
        await audioContext.close()
      } catch {
        /* 已关闭 */
      }
    }
    try {
      URL.revokeObjectURL(modelUrl)
    } catch {
      /* 忽略 */
    }
  }

  try {
    model = await Vosk.createModel(modelUrl)
  } catch {
    await cleanup()
    throw new Error('离线语音引擎初始化失败，请删除模型后重新下载')
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    await cleanup()
    throw new Error('无法访问麦克风，请检查系统权限')
  }

  try {
    try {
      audioContext = new AudioContext({ sampleRate: 16000 })
    } catch {
      audioContext = new AudioContext()
    }
    if (audioContext.state === 'suspended') await audioContext.resume()
    recognizer = new model.KaldiRecognizer(audioContext.sampleRate)
    recognizer.on('partialresult', (message) => {
      const text = message.result?.partial ?? ''
      if (text) onResult(text, false)
    })
    recognizer.on('result', (message) => {
      const text = message.result?.text ?? ''
      if (text) onResult(text, true)
    })
    recognizer.on('error', (message) => {
      onError(message.error || '离线语音识别出错')
    })

    source = audioContext.createMediaStreamSource(stream)
    processor = audioContext.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (event) => {
      if (stopped || !recognizer) return
      try {
        recognizer.acceptWaveform(event.inputBuffer)
      } catch {
        /* 单帧失败不中断整体识别 */
      }
    }
    source.connect(processor)
    processor.connect(audioContext.destination)
  } catch {
    await cleanup()
    throw new Error('离线语音初始化失败，请重试')
  }

  return async () => {
    if (stopped) return
    stopped = true
    try {
      recognizer?.retrieveFinalResult()
    } catch {
      /* 忽略 */
    }
    // 给 worker 一点时间回传最终文本，再释放全部资源
    await new Promise((resolve) => window.setTimeout(resolve, 300))
    await cleanup()
  }
}
