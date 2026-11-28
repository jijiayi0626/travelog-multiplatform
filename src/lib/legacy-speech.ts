import { registerPlugin } from '@capacitor/core'

/**
 * 兼容语音通道：直接调起系统 RecognizerIntent，不依赖 Google 语音服务。
 *
 * 华为鸿蒙 NEXT 的 Android 兼容层里，@capacitor-community/speech-recognition
 * 背后的 SpeechRecognizer 通常不可用；该通道尝试交给系统语音输入应用处理。
 */

/** 一个能处理语音识别 Intent 的候选服务 */
export interface LegacySpeechService {
  package: string
  label: string
}

export interface LegacySpeechAvailability {
  available: boolean
  /** 原生按 华为/荣耀 > Google > 第一个 选出的实际服务 */
  package: string
  label: string
  /** 全部候选服务，便于诊断区分华为/谷歌 */
  services: LegacySpeechService[]
  detail?: string
}

interface LegacySpeechResult {
  text?: string
  cancelled?: boolean
  package?: string
  label?: string
}

interface LegacySpeechPlugin {
  available(): Promise<{
    available: boolean
    package?: string
    label?: string
    services?: LegacySpeechService[]
    detail?: string
  }>
  services(): Promise<{ services?: LegacySpeechService[]; detail?: string }>
  recognize(): Promise<LegacySpeechResult>
}

const LegacySpeech = registerPlugin<LegacySpeechPlugin>('LegacySpeech')

/** 兼容语音单次识别的最长等待时间 */
export const LEGACY_SPEECH_TIMEOUT_MS = 20_000

export type LegacySpeechErrorKind =
  | 'unavailable'
  | 'permission'
  | 'cancelled'
  | 'timeout'
  | 'engine'
  | 'error'

export class LegacySpeechError extends Error {
  kind: LegacySpeechErrorKind

  constructor(kind: LegacySpeechErrorKind, message: string) {
    super(message)
    this.name = 'LegacySpeechError'
    this.kind = kind
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/** 把原生/系统返回的英文或模糊错误归到可读的中文原因 */
function classifyLegacyError(raw: string): LegacySpeechError {
  const message = raw.trim() || '语音识别失败'
  const lower = message.toLowerCase()

  if (/权限|permission|denied|not allowed|not-allowed/i.test(lower)) {
    return new LegacySpeechError('permission', '麦克风权限被拒绝，无法使用语音输入')
  }
  if (/取消|cancel|aborted/i.test(lower)) {
    return new LegacySpeechError('cancelled', '语音输入已取消')
  }
  if (/超时|timeout|timed out/i.test(lower)) {
    return new LegacySpeechError('timeout', '语音识别超时（20 秒内没有返回结果）')
  }
  if (/引擎|下载|download|network|网络|连接|server/i.test(lower)) {
    return new LegacySpeechError('engine', '语音引擎不可用或下载失败，请联网后重试')
  }
  if (/没有|不可用|未找到|not found|no activity|recognizer/i.test(lower)) {
    return new LegacySpeechError('unavailable', '系统没有可用的语音识别服务')
  }
  return new LegacySpeechError('error', message)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new LegacySpeechError('timeout', '语音识别超时（20 秒内没有返回结果）'))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** 查询兼容语音通道详情：是否可用、首选服务和全部候选服务 */
export async function getLegacySpeechAvailability(): Promise<LegacySpeechAvailability> {
  try {
    const result = await withTimeout(LegacySpeech.available(), 5_000)
    return {
      available: Boolean(result?.available),
      package: result?.package ?? '',
      label: result?.label ?? '',
      services: Array.isArray(result?.services) ? result.services : [],
      detail: result?.detail,
    }
  } catch (error) {
    console.warn('[travelog:voice] legacy available:', errorText(error))
    return {
      available: false,
      package: '',
      label: '',
      services: [],
      detail: errorText(error),
    }
  }
}

/** 查询系统里是否有应用能处理语音识别 Intent；查询失败按不可用处理 */
export async function availableLegacySpeech(): Promise<boolean> {
  return (await getLegacySpeechAvailability()).available
}

/** 只列出候选语音服务（不发起识别） */
export async function listLegacySpeechServices(): Promise<LegacySpeechService[]> {
  try {
    const result = await withTimeout(LegacySpeech.services(), 5_000)
    return Array.isArray(result?.services) ? result.services : []
  } catch (error) {
    console.warn('[travelog:voice] legacy services:', errorText(error))
    return []
  }
}

/** 调起系统语音输入：成功返回文字，用户返回时返回 cancelled，失败抛中文错误 */
export async function recognizeLegacySpeech(): Promise<{
  text: string
  cancelled: boolean
  package: string
  label: string
}> {
  let result: LegacySpeechResult
  try {
    result = await withTimeout(LegacySpeech.recognize(), LEGACY_SPEECH_TIMEOUT_MS)
  } catch (error) {
    if (error instanceof LegacySpeechError) throw error
    throw classifyLegacyError(errorText(error))
  }

  const engine = { package: result?.package ?? '', label: result?.label ?? '' }
  if (result?.cancelled) return { text: '', cancelled: true, ...engine }

  const text = (result?.text ?? '').trim()
  if (!text) {
    throw new LegacySpeechError('unavailable', '系统语音没有返回可用的文字')
  }
  return { text, cancelled: false, ...engine }
}
