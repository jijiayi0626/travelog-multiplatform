import { isNative } from './native'
import { isVoskModelReady } from './offline-speech'
import {
  LegacySpeechError,
  availableLegacySpeech,
  getLegacySpeechAvailability,
  recognizeLegacySpeech,
  type LegacySpeechService,
} from './legacy-speech'

/** 最近一次语音错误写入的 key，语音诊断面板据此展示 */
export const VOICE_LAST_ERROR_KEY = 'travelog.voiceLastError'
/** 最近一次实际使用的语音服务，区分华为/谷歌 */
export const VOICE_LAST_ENGINE_KEY = 'travelog.voiceLastEngine'
/** 系统语音启动后多久没有结果就判定服务不可用 */
export const SYSTEM_VOICE_TIMEOUT_MS = 12_000
/** 系统语音启动后 10 秒仍没有结果，就改试兼容语音通道 */
export const LEGACY_FALLBACK_TIMEOUT_MS = 10_000

export interface VoiceEngine {
  package: string
  label: string
}

export function setLastVoiceEngine(engine: VoiceEngine | null | undefined): void {
  const pkg = engine?.package?.trim() ?? ''
  if (!pkg) return
  try {
    localStorage.setItem(
      VOICE_LAST_ENGINE_KEY,
      JSON.stringify({ package: pkg, label: engine?.label?.trim() ?? '' }),
    )
  } catch {
    /* 隐私模式写不了就算了 */
  }
}

export function getLastVoiceEngine(): VoiceEngine | null {
  try {
    const raw = localStorage.getItem(VOICE_LAST_ENGINE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { package?: unknown; label?: unknown }
    const pkg = typeof parsed?.package === 'string' ? parsed.package.trim() : ''
    if (!pkg) return null
    return {
      package: pkg,
      label: typeof parsed?.label === 'string' ? parsed.label.trim() : '',
    }
  } catch {
    return null
  }
}

export function logVoiceError(message: string): void {
  console.warn('[travelog:voice]', message)
  try {
    localStorage.setItem(VOICE_LAST_ERROR_KEY, `${new Date().toLocaleString()} ${message}`)
  } catch {
    /* 隐私模式写不了就算了 */
  }
}

export function getLastVoiceError(): string {
  try {
    return localStorage.getItem(VOICE_LAST_ERROR_KEY) ?? ''
  } catch {
    return ''
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/* ---------------- 网页端 Web Speech ---------------- */

interface WebSpeechResultLike {
  transcript: string
}

interface WebSpeechEventLike {
  results: ArrayLike<ArrayLike<WebSpeechResultLike>>
}

interface WebSpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: WebSpeechEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type WebSpeechConstructor = new () => WebSpeechRecognitionLike

function getWebSpeechConstructor(): WebSpeechConstructor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    SpeechRecognition?: WebSpeechConstructor
    webkitSpeechRecognition?: WebSpeechConstructor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

function transcriptFrom(event: WebSpeechEventLike): string {
  let text = ''
  for (let i = 0; i < event.results.length; i += 1) {
    text += event.results[i]?.[0]?.transcript ?? ''
  }
  return text.trim()
}

/* ---------------- 系统语音会话 ---------------- */

export interface SystemVoiceHandlers {
  /** 实时识别到的文字（系统 partial 结果会覆盖前一次） */
  onPartial: (text: string) => void
  /** 明确的识别错误 */
  onError: (message: string) => void
  /**
   * 系统语音不可用：权限被拒、没有语音服务，
   * 或原生端启动 12 秒仍没有结果且已不在监听状态。
   */
  onUnavailable: (message: string) => void
  /** 系统侧自行结束（非手动 stop） */
  onEnd?: () => void
}

export type SystemVoiceStartResult =
  | { ok: true; stop: () => void }
  | { ok: false; kind: 'unavailable' | 'permission' | 'unsupported' | 'error'; message: string }

/**
 * 兼容语音回退：直接调起系统 RecognizerIntent。
 * 成功时通过 onPartial/onEnd 把文字交回调用方，失败时写入 recent error。
 */
function startLegacyVoiceFallback(
  handlers: SystemVoiceHandlers,
  reason: string,
): SystemVoiceStartResult {
  let active = true
  console.warn('[travelog:voice]', `native: ${reason}，尝试兼容语音通道`)

  void (async () => {
    try {
      if (!(await availableLegacySpeech())) {
        throw new LegacySpeechError('unavailable', '系统没有可用的语音识别服务')
      }
      const result = await recognizeLegacySpeech()
      if (!active) return
      setLastVoiceEngine(result)
      if (result.cancelled) {
        logVoiceError('legacy: 语音输入已取消')
        handlers.onError('语音输入已取消')
        return
      }
      handlers.onPartial(result.text)
      handlers.onEnd?.()
    } catch (error) {
      if (!active) return
      const kind = error instanceof LegacySpeechError ? error.kind : 'error'
      const message = errorText(error)
      logVoiceError(`legacy: ${message}`)
      if (kind === 'unavailable') handlers.onUnavailable(message)
      else handlers.onError(message)
    }
  })()

  return {
    ok: true,
    stop: () => {
      active = false
    },
  }
}

async function startNativeVoice(handlers: SystemVoiceHandlers): Promise<SystemVoiceStartResult> {
  let SpeechRecognition: typeof import('@capacitor-community/speech-recognition').SpeechRecognition
  try {
    const plugin = await import('@capacitor-community/speech-recognition')
    SpeechRecognition = plugin.SpeechRecognition
  } catch (error) {
    const message = errorText(error)
    logVoiceError(`native: 插件加载失败 ${message}`)
    return startLegacyVoiceFallback(handlers, `语音插件加载失败：${message}`)
  }

  try {
    const available = await SpeechRecognition.available()
    if (!available.available) {
      logVoiceError('native: 系统没有可用的语音识别服务')
      return startLegacyVoiceFallback(handlers, '系统没有可用的语音识别服务')
    }
    let permission = (await SpeechRecognition.checkPermissions()).speechRecognition
    if (permission !== 'granted') {
      permission = (await SpeechRecognition.requestPermissions()).speechRecognition
    }
    if (permission !== 'granted') {
      logVoiceError(`native: 麦克风权限 ${permission}`)
      return { ok: false, kind: 'permission', message: `麦克风权限 ${permission}` }
    }
  } catch (error) {
    const message = errorText(error)
    logVoiceError(`native: ${message}`)
    return startLegacyVoiceFallback(handlers, `系统语音检查失败：${message}`)
  }

  let stopped = false
  let gotResult = false
  let fallbackTimer = 0
  let legacyStop: (() => void) | null = null
  const listeners: Array<{ remove: () => Promise<void> }> = []

  const removeListeners = async () => {
    const current = listeners.splice(0)
    await Promise.all(current.map((listener) => listener.remove().catch(() => undefined)))
  }
  const stopSystem = () => {
    if (stopped) return
    stopped = true
    window.clearTimeout(fallbackTimer)
    void SpeechRecognition.stop().catch(() => undefined)
    // 插件 stop 不会立刻 resolve，留一点时间收最终结果再移除监听
    window.setTimeout(() => {
      void removeListeners()
    }, 1200)
  }
  const stop = () => {
    stopSystem()
    legacyStop?.()
    legacyStop = null
  }
  const useLegacy = (reason: string) => {
    stopSystem()
    void removeListeners()
    const legacy = startLegacyVoiceFallback(handlers, reason)
    legacyStop = legacy.ok ? legacy.stop : null
  }

  try {
    const partial = await SpeechRecognition.addListener('partialResults', (data) => {
      const text = (data.matches?.[0] ?? '').trim()
      if (!text) return
      gotResult = true
      window.clearTimeout(fallbackTimer)
      handlers.onPartial(text)
    })
    const state = await SpeechRecognition.addListener('listeningState', (data) => {
      if (data.status !== 'stopped' || stopped) return
      stopped = true
      window.clearTimeout(fallbackTimer)
      void removeListeners()
      handlers.onEnd?.()
    })
    listeners.push(partial, state)

    // partialResults 模式下 start() 不一定 resolve，不能 await
    void SpeechRecognition.start({
      language: 'zh-CN',
      maxResults: 5,
      partialResults: true,
      popup: false,
    }).catch((error: unknown) => {
      const message = errorText(error)
      logVoiceError(`native start: ${message}`)
      if (stopped) return
      if (/权限|permission|denied/i.test(message)) {
        stopSystem()
        void removeListeners()
        handlers.onError(message)
        return
      }
      useLegacy(`系统语音启动失败：${message}`)
    })
  } catch (error) {
    const message = errorText(error)
    logVoiceError(`native: ${message}`)
    await removeListeners()
    return startLegacyVoiceFallback(handlers, `系统语音监听失败：${message}`)
  }

  // 10 秒仍没有识别结果：停掉系统语音，改试兼容语音通道
  fallbackTimer = window.setTimeout(() => {
    if (stopped || gotResult) return
    useLegacy('系统语音启动后 10 秒没有识别结果')
  }, LEGACY_FALLBACK_TIMEOUT_MS)

  return { ok: true, stop }
}

function startWebVoice(handlers: SystemVoiceHandlers): SystemVoiceStartResult {
  const Recognition = getWebSpeechConstructor()
  if (!Recognition) {
    logVoiceError('web: 当前浏览器不支持语音识别')
    return { ok: false, kind: 'unsupported', message: '当前浏览器不支持语音识别' }
  }

  let stopped = false
  const recognition = new Recognition()
  recognition.lang = 'zh-CN'
  recognition.interimResults = true
  recognition.continuous = true

  const stop = () => {
    if (stopped) return
    stopped = true
    try {
      recognition.stop()
    } catch {
      /* 已停止 */
    }
    window.setTimeout(() => {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
    }, 300)
  }
  const fail = (message: string, unavailable: boolean) => {
    if (stopped) return
    stopped = true
    try {
      recognition.stop()
    } catch {
      /* 已停止 */
    }
    logVoiceError(`web: ${message}`)
    if (unavailable) handlers.onUnavailable(message)
    else handlers.onError(message)
  }

  recognition.onresult = (event) => {
    const text = transcriptFrom(event)
    if (!text) return
    handlers.onPartial(text)
  }
  recognition.onerror = (event) => {
    const message = event?.error || 'unknown'
    if (
      message === 'not-allowed' ||
      message === 'service-not-allowed' ||
      message === 'audio-capture'
    ) {
      fail('麦克风权限被拒绝或系统语音服务不可用', true)
      return
    }
    if (message === 'no-speech' || message === 'aborted') {
      fail('没能听清，请再试一次', false)
      return
    }
    fail(message, false)
  }
  recognition.onend = () => {
    if (stopped) return
    stopped = true
    handlers.onEnd?.()
  }

  try {
    recognition.start()
  } catch (error) {
    const message = errorText(error)
    logVoiceError(`web: ${message}`)
    stopped = true
    return { ok: false, kind: 'error', message }
  }
  // 网页端没有 isListening，不在这里判超时，交给调用方决定何时停止
  return { ok: true, stop }
}

/** 启动系统语音：原生走插件，网页走 Web Speech；失败时返回具体原因 */
export async function startSystemVoice(
  handlers: SystemVoiceHandlers,
): Promise<SystemVoiceStartResult> {
  if (isNative()) return startNativeVoice(handlers)
  return startWebVoice(handlers)
}

/* ---------------- 诊断 ---------------- */

export interface VoiceDiagnostics {
  native: boolean
  systemAvailable: boolean
  /** 语言/插件层面的补充说明，空字符串表示没有异常 */
  systemDetail: string
  permission: string
  permissionDetail: string
  /** 兼容语音通道（系统 RecognizerIntent）是否可用 */
  legacyAvailable: boolean
  legacyDetail: string
  /** 兼容语音实际首选服务（华为/荣耀 > Google > 第一个） */
  legacyPackage: string
  legacyLabel: string
  /** 所有候选语音服务，便于区分华为/谷歌 */
  legacyServices: LegacySpeechService[]
  /** 最近一次实际使用的语音服务 */
  lastEngine: VoiceEngine | null
  voskReady: boolean
  lastError: string
}

async function queryWebMicrophonePermission(): Promise<string> {
  try {
    if (!navigator.permissions?.query) return 'unknown'
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state
  } catch {
    return 'unknown'
  }
}

/** 依次检查是否原生、系统语音可用性、麦克风权限和 Vosk 模型状态 */
export async function collectVoiceDiagnostics(): Promise<VoiceDiagnostics> {
  const native = isNative()
  let systemAvailable = false
  let systemDetail = ''
  let permission = 'unknown'
  let permissionDetail = ''

  if (native) {
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
      try {
        const available = await SpeechRecognition.available()
        systemAvailable = Boolean(available.available)
        if (!systemAvailable) systemDetail = '系统没有可用的语音识别服务'
      } catch (error) {
        systemDetail = errorText(error)
      }
      try {
        permission = (await SpeechRecognition.checkPermissions()).speechRecognition
      } catch (error) {
        permissionDetail = errorText(error)
      }
    } catch (error) {
      systemDetail = `插件加载失败：${errorText(error)}`
      permissionDetail = systemDetail
    }
  } else {
    systemAvailable = Boolean(getWebSpeechConstructor())
    if (!systemAvailable) systemDetail = '当前浏览器不支持 Web Speech 语音识别'
    permission = await queryWebMicrophonePermission()
  }

  let legacyAvailable = false
  let legacyDetail = ''
  let legacyPackage = ''
  let legacyLabel = ''
  let legacyServices: LegacySpeechService[] = []
  if (native) {
    const info = await getLegacySpeechAvailability()
    legacyAvailable = info.available
    legacyPackage = info.package
    legacyLabel = info.label
    legacyServices = info.services
    if (!legacyAvailable) {
      legacyDetail = info.detail
        ? `没有找到能处理系统语音输入的应用：${info.detail}`
        : '没有找到能处理系统语音输入的应用，或当前安装包未包含兼容语音插件'
    }
  } else {
    legacyDetail = '兼容语音通道仅在原生 App 内可用'
  }

  const lastEngine = native ? getLastVoiceEngine() : null

  const voskReady = await isVoskModelReady()
  return {
    native,
    systemAvailable,
    systemDetail,
    permission,
    permissionDetail,
    legacyAvailable,
    legacyDetail,
    legacyPackage,
    legacyLabel,
    legacyServices,
    lastEngine,
    voskReady,
    lastError: getLastVoiceError(),
  }
}

export interface SystemSpeechTestResult {
  ok: boolean
  text: string
  error: string
  /** 是否属于“系统语音服务不可用”，用于引导下载离线模型 */
  unavailable: boolean
}

/** 测试系统语音：最多等 12 秒，返回收到的文字或具体错误 */
export function testSystemSpeech(
  timeoutMs = SYSTEM_VOICE_TIMEOUT_MS,
): Promise<SystemSpeechTestResult> {
  let heard = ''
  let stop: (() => void) | null = null
  let settled = false
  let timer = 0
  let quietTimer = 0

  return new Promise<SystemSpeechTestResult>((resolve) => {
    const finish = (result: SystemSpeechTestResult) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.clearTimeout(quietTimer)
      stop?.()
      resolve(result)
    }

    timer = window.setTimeout(() => {
      if (heard) finish({ ok: true, text: heard, error: '', unavailable: false })
      else finish({ ok: false, text: '', error: '12 秒内没有收到识别结果', unavailable: true })
    }, timeoutMs)

    void startSystemVoice({
      onPartial: (text) => {
        heard = text
        window.clearTimeout(quietTimer)
        // 听到内容后稍等片刻，收集完整一句话再结束测试
        quietTimer = window.setTimeout(() => {
          finish({ ok: true, text: heard, error: '', unavailable: false })
        }, 1500)
      },
      onError: (message) => finish({ ok: false, text: heard, error: message, unavailable: false }),
      onUnavailable: (message) =>
        finish({ ok: false, text: heard, error: message, unavailable: true }),
      onEnd: () => {
        if (heard) finish({ ok: true, text: heard, error: '', unavailable: false })
        else finish({ ok: false, text: '', error: '没有听到内容，请再试一次', unavailable: false })
      },
    })
      .then((result) => {
        if (!result.ok) {
          finish({
            ok: false,
            text: '',
            error: result.message,
            unavailable: result.kind === 'unavailable',
          })
          return
        }
        stop = result.stop
        // 启动过程超过超时时间时已经结束，这里补一次停止
        if (settled) result.stop()
      })
      .catch((error: unknown) => {
        finish({ ok: false, text: '', error: errorText(error), unavailable: false })
      })
  })
}

export interface LegacySpeechTestResult {
  ok: boolean
  text: string
  error: string
  /** 实际调起的语音服务包名/名称 */
  package: string
  label: string
}

/** 测试兼容语音通道：直接调起系统 RecognizerIntent，最多等 20 秒 */
export async function testLegacySpeech(): Promise<LegacySpeechTestResult> {
  try {
    if (!(await availableLegacySpeech())) {
      const message = '系统没有可用的语音识别服务'
      logVoiceError(`legacy: ${message}`)
      return { ok: false, text: '', error: message, package: '', label: '' }
    }
    const result = await recognizeLegacySpeech()
    setLastVoiceEngine(result)
    if (result.cancelled) {
      const message = '语音输入已取消'
      logVoiceError(`legacy: ${message}`)
      return { ok: false, text: '', error: message, package: result.package, label: result.label }
    }
    return {
      ok: true,
      text: result.text,
      error: '',
      package: result.package,
      label: result.label,
    }
  } catch (error) {
    const message = errorText(error)
    logVoiceError(`legacy: ${message}`)
    return { ok: false, text: '', error: message, package: '', label: '' }
  }
}
