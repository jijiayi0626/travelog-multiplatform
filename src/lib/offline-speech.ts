import { engineLoadError, voskEngineUrl } from './engine-url'

/**
 * 离线语音：Vosk 引擎（网页端用 public/vosk，Android 首次使用时从 CDN 下载）+
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

const PART_BYTES = 9_000_000
const PART_COUNT = 5
const TOTAL_BYTES = 43_900_310
/** 同时下载的分片数，避免一次打满所有请求 */
const PART_CONCURRENCY = 3
/** 单个分片整次请求的超时 */
const PART_TIMEOUT_MS = 180_000
/** 分片连续 60 秒没有新字节就放弃 */
const PART_IDLE_TIMEOUT_MS = 60_000
/** 首次解压 68MB 模型在低端设备上较慢，给足时间 */
const MODEL_LOAD_TIMEOUT_MS = 45_000
/** Vosk 中文模型固定 16kHz */
const VOSK_SAMPLE_RATE = 16_000

interface VoskModelMessage {
  result?: boolean
  error?: string
}

interface VoskRecognizerLike {
  on: (
    event: 'partialresult' | 'result' | 'error',
    listener: (message: {
      result?: { partial?: string; text?: string }
      error?: string
    }) => void,
  ) => void
  acceptWaveform: (buffer: AudioBuffer) => void
  acceptWaveformFloat: (buffer: Float32Array, sampleRate: number) => void
  retrieveFinalResult: () => void
  remove: () => void
}

interface VoskModelLike {
  KaldiRecognizer: new (sampleRate: number, grammar?: string) => VoskRecognizerLike
  on: (event: 'load' | 'error', listener: (message: VoskModelMessage) => void) => void
  ready: boolean
  terminate: () => void
}

interface VoskGlobalLike {
  Model?: new (modelUrl: string, logLevel?: number) => VoskModelLike
  createModel?: (modelUrl: string, logLevel?: number) => Promise<VoskModelLike>
}

let lastError = ''
let scriptPromise: Promise<VoskGlobalLike> | null = null
/** 同一个 App 生命周期内复用已加载模型，避免每次开始说话都重新解压 68MB */
let cachedModel: VoskModelLike | null = null
let cachedModelPromise: Promise<VoskModelLike> | null = null
/** 删除/重新下载时递增，避免在途加载把已丢弃的模型又写回缓存 */
let modelEpoch = 0

export function getVoskModelError(): string {
  return lastError
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/** public/vosk/vosk.js 是 UMD，浏览器里全局名就是 globalThis.Vosk */
function getVoskGlobal(): VoskGlobalLike | null {
  if (typeof window === 'undefined') return null
  return (globalThis as unknown as { Vosk?: VoskGlobalLike }).Vosk ?? null
}

/** 动态注入 vosk.js（UMD 全局 Vosk），避免 npm 打包 worker 路径问题 */
function loadVoskEngine(): Promise<VoskGlobalLike> {
  const existing = getVoskGlobal()
  if (existing) return Promise.resolve(existing)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('离线语音引擎加载失败：当前环境不支持'))
      return
    }
    const done = () => {
      const global = getVoskGlobal()
      if (global) resolve(global)
      else {
        scriptPromise = null
        reject(engineLoadError('离线语音引擎加载失败：脚本已执行但未找到 window.Vosk'))
      }
    }
    const fail = () => {
      scriptPromise = null
      document.getElementById(SCRIPT_ID)?.remove()
      reject(engineLoadError('离线语音引擎加载失败：引擎脚本无法加载，请检查安装包是否完整'))
    }
    const current = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (current) {
      current.addEventListener('load', done, { once: true })
      current.addEventListener('error', fail, { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    // 网页端为 BASE_URL 相对路径，原生端为 CDN 绝对地址；统一用文档地址解析，兼容 hash 路由
    script.src = new URL(voskEngineUrl(), window.location.href).href
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
/** vosk-browser 内部用 IDBFS 把 /vosk 挂载到同名 IndexedDB 数据库 */
const VOSK_FS_DB = '/vosk'

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

function deleteVoskFilesystemDb(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(VOSK_FS_DB)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
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

/** 轻量校验：gzip 头 1f 8b + 总大小，避免把半截文件当成可用模型 */
async function inspectModelBlob(blob: Blob): Promise<string> {
  if (blob.size !== TOTAL_BYTES) {
    return `模型文件不完整（${blob.size}/${TOTAL_BYTES} 字节）`
  }
  try {
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
    if (head.length < 2 || head[0] !== 0x1f || head[1] !== 0x8b) {
      return '模型文件格式不正确（不是 gzip）'
    }
  } catch {
    return '模型文件无法读取'
  }
  return ''
}

export async function isVoskModelReady(): Promise<boolean> {
  try {
    if (localStorage.getItem(READY_KEY) !== '1') return false
    const blob = await getModelBlob()
    if (!blob) return false
    return (await inspectModelBlob(blob)) === ''
  } catch {
    return false
  }
}

function releaseVoskModel(): void {
  modelEpoch += 1
  const model = cachedModel
  cachedModel = null
  cachedModelPromise = null
  if (model) {
    try {
      model.terminate()
    } catch {
      /* 已退出 */
    }
  }
}

/**
 * 等 Model 真正加载完成。
 * 不使用 vosk-browser 的 createModel：它只监听 load，worker 的 error 事件会让 Promise
 * 永远 pending（表现为“点了没反应、一直正在启动”），这里同时监听 error 并加超时。
 */
function openVoskModel(Vosk: VoskGlobalLike, url: string): Promise<VoskModelLike> {
  return new Promise((resolve, reject) => {
    let model: VoskModelLike
    try {
      if (!Vosk.Model) throw new Error('引擎版本不兼容（缺少 Model 构造器）')
      model = new Vosk.Model(url, 0)
    } catch (error) {
      reject(new Error(errorText(error)))
      return
    }
    let settled = false
    let timer = 0
    const finish = (error?: string) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      if (error) {
        try {
          model.terminate()
        } catch {
          /* 已退出 */
        }
        reject(new Error(error))
        return
      }
      resolve(model)
    }
    timer = window.setTimeout(
      () => finish('模型解压超时（超过 120 秒），请检查设备内存后重试'),
      MODEL_LOAD_TIMEOUT_MS,
    )
    model.on('load', (message) => {
      if (message?.result === false) finish('模型解压失败，请重新下载')
      else finish()
    })
    model.on('error', (message) => {
      finish(`模型解压失败：${message?.error || '未知错误'}`)
    })
  })
}

/**
 * 把内存里的模型交给 Vosk worker：worker 内部会对 modelUrl 做 fetch 并解压。
 * blob: URL 在 WebView 的 worker 里理论上同源可读；若失败，再用带文件名的 File
 * 生成一次 object URL 重试（部分 WebView 对 Blob 与 File 的处理不同）。
 */
async function loadModelFromBlob(Vosk: VoskGlobalLike, blob: Blob): Promise<VoskModelLike> {
  const sources: Array<() => Blob> = [
    () => blob,
    () => new File([blob], CACHE_KEY, { type: 'application/gzip' }),
  ]
  let reason = ''
  for (const make of sources) {
    const url = URL.createObjectURL(make())
    try {
      const model = await openVoskModel(Vosk, url)
      return model
    } catch (error) {
      reason = errorText(error)
      // 只有“取不到文件”这类错误才值得换 File 再试；解压/超时重试也不会变好
      if (!/fetch|network|error|加载|下载|HTTP/i.test(reason)) break
    } finally {
      // worker 在 load 事件前已完成 fetch，此后不再需要 object URL
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* 忽略 */
      }
    }
  }
  throw new Error(reason || '模型解压失败')
}

async function getVoskModel(Vosk: VoskGlobalLike): Promise<VoskModelLike> {
  if (cachedModel) return cachedModel
  if (cachedModelPromise) return cachedModelPromise
  const epoch = modelEpoch
  cachedModelPromise = (async () => {
    const blob = await getModelBlob()
    if (!blob) throw new Error('离线语音模型尚未下载')
    const problem = await inspectModelBlob(blob)
    if (problem) throw new Error(`${problem}，请重新下载`)
    // vosk-browser 的解压目录名来自本次 blob URL（每次随机），跨启动永远不会命中缓存；
    // 先清掉 /vosk 下的旧解压副本，避免多份 68MB 累积撑爆配额或把启动拖慢。
    await deleteVoskFilesystemDb()
    const model = await loadModelFromBlob(Vosk, blob)
    if (epoch !== modelEpoch) {
      try {
        model.terminate()
      } catch {
        /* 已退出 */
      }
      throw new Error('模型已被重置，请重新测试')
    }
    cachedModel = model
    return model
  })()
  try {
    return await cachedModelPromise
  } finally {
    cachedModelPromise = null
  }
}

async function readPart(
  response: Response,
  controller: AbortController,
  onBytes: (received: number) => void,
): Promise<Blob> {
  if (!response.body) {
    const blob = await response.blob()
    onBytes(blob.size)
    return blob
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  // 代理返回 200 后可能不再吐数据，60 秒没有新字节就放弃
  let watchdog = window.setTimeout(() => controller.abort(), PART_IDLE_TIMEOUT_MS)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      window.clearTimeout(watchdog)
      watchdog = window.setTimeout(() => controller.abort(), PART_IDLE_TIMEOUT_MS)
      chunks.push(value)
      received += value.byteLength
      onBytes(received)
    }
  } finally {
    window.clearTimeout(watchdog)
  }
  return new Blob(chunks as unknown as BlobPart[], { type: 'application/gzip' })
}

/**
 * 模型按 9MB 分片，最多同时下载 3 片；
 * 每片单独校验大小，失败时在本片内依次切换镜像重试。
 */
export async function downloadVoskModel(
  onProgress?: (progress: number) => void,
): Promise<boolean> {
  lastError = ''
  onProgress?.(0)
  const received = new Array<number>(PART_COUNT).fill(0)
  const parts: Array<Blob | null> = new Array<Blob | null>(PART_COUNT).fill(null)
  const active = new Set<AbortController>()
  let failure: Error | null = null
  let nextIndex = 0

  const report = () => {
    const total = received.reduce((sum, value) => sum + value, 0)
    onProgress?.(Math.min(0.99, total / TOTAL_BYTES))
  }
  const stopAll = (error: Error) => {
    if (!failure) failure = error
    active.forEach((controller) => controller.abort())
  }

  const fetchPart = async (index: number): Promise<Blob> => {
    let reason = ''
    for (const mirror of VOSK_MODEL_MIRRORS) {
      if (failure) throw failure
      const controller = new AbortController()
      active.add(controller)
      const overall = window.setTimeout(() => controller.abort(), PART_TIMEOUT_MS)
      received[index] = 0
      report()
      try {
        const response = await fetch(`${mirror}/${CACHE_KEY}.part${index}`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = await readPart(response, controller, (value) => {
          received[index] = value
          report()
        })
        const expected =
          index === PART_COUNT - 1 ? TOTAL_BYTES - index * PART_BYTES : PART_BYTES
        if (blob.size !== expected) {
          throw new Error(`分片 ${index + 1} 不完整（${blob.size}/${expected} 字节）`)
        }
        received[index] = blob.size
        report()
        return blob
      } catch (error) {
        reason =
          error instanceof Error && error.name === 'AbortError'
            ? '下载超时'
            : errorText(error)
      } finally {
        window.clearTimeout(overall)
        active.delete(controller)
      }
    }
    const error = new Error(`分片 ${index + 1} 下载失败：${reason || '未知错误'}`)
    stopAll(error)
    throw error
  }

  const lane = async () => {
    for (;;) {
      if (failure) return
      const index = nextIndex
      nextIndex += 1
      if (index >= PART_COUNT) return
      try {
        parts[index] = await fetchPart(index)
      } catch (error) {
        stopAll(error instanceof Error ? error : new Error(errorText(error)))
        return
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PART_CONCURRENCY, PART_COUNT) }, () => lane()),
  )
  if (failure) {
    lastError = errorText(failure)
    return false
  }

  const blob = new Blob(parts as Blob[], { type: 'application/gzip' })
  const problem = await inspectModelBlob(blob)
  if (problem) {
    lastError = `${problem}，请重新下载`
    return false
  }
  // 新文件已校验通过，旧的模型实例不再需要
  releaseVoskModel()
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

/** 删除下载标记、模型缓存以及 Vosk 内部解压产生的文件系统缓存 */
export async function deleteVoskModel(): Promise<void> {
  releaseVoskModel()
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
  await deleteVoskFilesystemDb()
  lastError = ''
}

/** 线性插值重采样，把任意采样率的单声道 Float32 转成 16kHz */
function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === VOSK_SAMPLE_RATE) return input
  if (inputRate <= 0 || input.length === 0) return input
  const ratio = inputRate / VOSK_SAMPLE_RATE
  const length = Math.max(1, Math.floor(input.length / ratio))
  const output = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio
    const index = Math.floor(position)
    const next = Math.min(index + 1, input.length - 1)
    const fraction = position - index
    output[i] = input[index] * (1 - fraction) + input[next] * fraction
  }
  return output
}

function micErrorMessage(error: unknown): string {
  const name =
    typeof DOMException !== 'undefined' && error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '麦克风不可用：权限被拒绝，请在系统设置中允许使用麦克风'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '麦克风不可用：未找到可用的录音设备'
  }
  if (name === 'NotReadableError') {
    return '麦克风不可用：麦克风可能被其他应用占用'
  }
  return `麦克风不可用：${errorText(error)}`
}

/**
 * 「测试启动」：只加载引擎与模型，并创建一次识别器，不申请麦克风、不要求说话。
 * 返回空字符串表示成功，否则返回可直接展示的错误原因。
 */
export async function testVoskModelStartup(): Promise<string> {
  lastError = ''
  try {
    const blob = await getModelBlob()
    if (!blob) return '离线语音模型尚未下载'
    const problem = await inspectModelBlob(blob)
    if (problem) {
      lastError = problem
      return problem
    }
  } catch (error) {
    lastError = `读取模型失败：${errorText(error)}`
    return lastError
  }

  let Vosk: VoskGlobalLike
  try {
    Vosk = await loadVoskEngine()
  } catch (error) {
    lastError = errorText(error)
    return lastError
  }

  let model: VoskModelLike
  try {
    model = await getVoskModel(Vosk)
  } catch (error) {
    lastError = errorText(error)
    return lastError
  }

  if (!model.ready) {
    lastError = '模型未就绪，请删除模型后重新下载'
    releaseVoskModel()
    return lastError
  }

  let recognizer: VoskRecognizerLike | null = null
  try {
    recognizer = new model.KaldiRecognizer(VOSK_SAMPLE_RATE)
  } catch (error) {
    lastError = `识别器创建失败：${errorText(error)}`
    if (!model.ready) releaseVoskModel()
    return lastError
  }

  // 创建识别器是异步发给 worker 的，等一小段时间收集 worker 侧错误
  const workerError = await new Promise<string>((resolve) => {
    const timer = window.setTimeout(() => resolve(''), 600)
    try {
      recognizer?.on('error', (message) => {
        window.clearTimeout(timer)
        resolve(message.error || '识别器初始化失败')
      })
    } catch {
      window.clearTimeout(timer)
      resolve('')
    }
  })
  try {
    recognizer.remove()
  } catch {
    /* 已移除 */
  }
  if (workerError) {
    lastError = `识别器初始化失败：${workerError}`
    releaseVoskModel()
    return lastError
  }
  // 测试完释放模型，避免测试留下的识别器状态影响真正开始识别
  releaseVoskModel()
  return ''
}

export interface OfflineListenOptions {
  onResult: (text: string, isFinal: boolean) => void
  onError: (message: string) => void
}

/**
 * 用本地 Vosk 模型开始实时识别，返回停止函数。
 * 模型在 App 内复用；停止时按“识别器 → 音频节点 → 麦克风 → AudioContext”的顺序释放。
 */
export async function startOfflineListening({
  onResult,
  onError,
}: OfflineListenOptions): Promise<() => Promise<void>> {
  // 模型状态不对时先释放，避免测试/上次失败留下半初始化实例
  if (cachedModel && !cachedModel.ready) releaseVoskModel()
  // 已加载过模型时直接复用，避免每次开始说话都重新读 44MB 缓存
  if (!cachedModel) {
    const blob = await getModelBlob()
    if (!blob) throw new Error('离线语音模型尚未下载，请先下载模型')
    const problem = await inspectModelBlob(blob)
    if (problem) throw new Error(`${problem}，请重新下载`)
  }

  // 先申请麦克风：权限问题可以立刻暴露，不必等 68MB 模型解压完
  let stream: MediaStream
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前环境不支持录音')
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    throw new Error(micErrorMessage(error))
  }

  const stopStream = () => {
    try {
      stream.getTracks().forEach((track) => track.stop())
    } catch {
      /* 忽略 */
    }
  }

  let Vosk: VoskGlobalLike
  try {
    Vosk = await loadVoskEngine()
  } catch (error) {
    stopStream()
    throw new Error(errorText(error))
  }

  let model: VoskModelLike
  try {
    model = await getVoskModel(Vosk)
  } catch (error) {
    stopStream()
    releaseVoskModel()
    throw new Error(errorText(error))
  }

  let audioContext: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let processor: ScriptProcessorNode | null = null
  let recognizer: VoskRecognizerLike | null = null
  let stopped = false

  const cleanup = async () => {
    if (recognizer) {
      try {
        recognizer.remove()
      } catch {
        /* 已移除 */
      }
      recognizer = null
    }
    if (processor) {
      try {
        processor.disconnect()
      } catch {
        /* 已断开 */
      }
      processor = null
    }
    if (source) {
      try {
        source.disconnect()
      } catch {
        /* 已断开 */
      }
      source = null
    }
    try {
      stream.getTracks().forEach((track) => track.stop())
    } catch {
      /* 忽略 */
    }
    if (audioContext) {
      try {
        await audioContext.close()
      } catch {
        /* 已关闭 */
      }
      audioContext = null
    }
  }

  try {
    try {
      audioContext = new AudioContext({ sampleRate: VOSK_SAMPLE_RATE })
    } catch {
      // 部分 WebView 不支持指定采样率，退回默认采样率后再重采样到 16k
      audioContext = new AudioContext()
    }
    if (audioContext.state === 'suspended') await audioContext.resume()
    if (audioContext.state !== 'running') {
      throw new Error('音频未启动，请重新点击开始')
    }
    if (typeof audioContext.createScriptProcessor !== 'function') {
      throw new Error('当前系统不支持音频处理（createScriptProcessor 不可用）')
    }
    const inputRate = audioContext.sampleRate

    try {
      recognizer = new model.KaldiRecognizer(VOSK_SAMPLE_RATE)
    } catch (error) {
      if (!model.ready) releaseVoskModel()
      throw new Error(`识别器创建失败：${errorText(error)}`)
    }
    recognizer.on('partialresult', (message) => {
      const text = message.result?.partial ?? ''
      if (text) onResult(text, false)
    })
    recognizer.on('result', (message) => {
      const text = message.result?.text ?? ''
      if (text) onResult(text, true)
    })
    recognizer.on('error', (message) => {
      onError(`离线语音识别失败：${message.error || '未知错误'}`)
    })

    source = audioContext.createMediaStreamSource(stream)
    processor = audioContext.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (event) => {
      if (stopped || !recognizer) return
      try {
        const mono = event.inputBuffer.getChannelData(0)
        // 统一转成 16kHz 单声道 Float32 再交给识别器
        recognizer.acceptWaveformFloat(resampleTo16k(mono, inputRate), VOSK_SAMPLE_RATE)
      } catch {
        /* 单帧失败不中断整体识别 */
      }
    }
    source.connect(processor)
    processor.connect(audioContext.destination)
  } catch (error) {
    await cleanup()
    throw new Error(`离线语音启动失败：${errorText(error)}`)
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
