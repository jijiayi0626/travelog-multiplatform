import { useEffect, useRef, useState } from 'react'
import { Clipboard } from '@capacitor/clipboard'
import {
  ArrowClockwise,
  ArrowLeft,
  CheckCircle,
  Copy,
  DownloadSimple,
  Microphone,
  Play,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { useI18n, useNav, useToast } from '../lib/app-context'
import { translateText } from '../lib/i18n'
import {
  OCR_MODEL_SIZE_MB,
  deleteOcrModel,
  downloadOcrModel,
  getOcrModelError,
  isOcrModelReady,
} from '../lib/ocr-model'
import {
  VOSK_MODEL_SIZE_MB,
  deleteVoskModel,
  downloadVoskModel,
  getVoskModelError,
  isVoskModelReady,
  testVoskModelStartup,
} from '../lib/offline-speech'
import {
  collectVoiceDiagnostics,
  testLegacySpeech,
  testSystemSpeech,
  type VoiceDiagnostics,
} from '../lib/speech'

type Tr = (zh: string, vars?: Record<string, string | number>) => string

/** 把语音服务归成「华为 xxx / Google xxx / 其他」，便于一眼看出实际引擎 */
function engineName(
  service: { package?: string; label?: string } | null | undefined,
  tr: Tr,
): string {
  const pkg = service?.package?.trim() ?? ''
  if (!pkg) return tr('未找到')
  const name = service?.label?.trim() || pkg
  if (pkg.startsWith('com.huawei') || pkg.startsWith('com.hihonor')) {
    return tr('华为 {name}', { name })
  }
  if (pkg.startsWith('com.google')) {
    return tr('Google {name}', { name })
  }
  return name
}

/** 诊断结果拼成可复制的多行文本 */
function formatDiagnostics(data: VoiceDiagnostics, tr: Tr): string {
  return [
    tr('运行环境：{value}', { value: data.native ? tr('原生 App') : tr('网页') }),
    tr('系统语音：{value}', { value: data.systemAvailable ? tr('可用') : tr('不可用') }),
    data.systemDetail ? tr('系统语音详情：{value}', { value: data.systemDetail }) : '',
    tr('麦克风权限：{value}', { value: data.permission }),
    data.permissionDetail ? tr('权限详情：{value}', { value: data.permissionDetail }) : '',
    tr('兼容语音通道：{value}', { value: data.legacyAvailable ? tr('可用') : tr('不可用') }),
    data.legacyDetail ? tr('兼容语音详情：{value}', { value: data.legacyDetail }) : '',
    tr('实际语音服务：{value}', {
      value: data.legacyAvailable
        ? engineName({ package: data.legacyPackage, label: data.legacyLabel }, tr)
        : tr('未找到'),
    }),
    data.lastEngine
      ? tr('上次实际使用：{value}', { value: engineName(data.lastEngine, tr) })
      : '',
    tr('候选语音服务：{value}', {
      value: data.legacyServices.length
        ? data.legacyServices
            .map((service) =>
              service.label ? `${service.package}（${service.label}）` : service.package,
            )
            .join('、')
        : tr('无'),
    }),
    tr('离线语音模型：{value}', { value: data.voskReady ? tr('已下载') : tr('未下载') }),
    tr('最近一次语音错误：{value}', { value: data.lastError || tr('无') }),
    tr('检测时间：{value}', { value: new Date().toLocaleString() }),
  ]
    .filter(Boolean)
    .join('\n')
}

export function OcrModelPage() {
  const nav = useNav()
  const toast = useToast()
  const { tr, lang } = useI18n()

  const [ready, setReady] = useState(() => isOcrModelReady())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  const [voiceReady, setVoiceReady] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceProgress, setVoiceProgress] = useState(0)
  const [voiceError, setVoiceError] = useState('')
  const [voiceTestBusy, setVoiceTestBusy] = useState(false)
  const [voiceTestResult, setVoiceTestResult] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  const [diagText, setDiagText] = useState('')
  const [diagBusy, setDiagBusy] = useState(false)
  const [diagTestBusy, setDiagTestBusy] = useState(false)
  const [diagTest, setDiagTest] = useState<{
    ok: boolean
    message: string
    needDownload: boolean
  } | null>(null)
  const [legacyTestBusy, setLegacyTestBusy] = useState(false)
  const [legacyTest, setLegacyTest] = useState<{
    ok: boolean
    message: string
  } | null>(null)
  const voiceSectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let alive = true
    void collectVoiceDiagnostics()
      .then((data) => {
        if (alive) {
          setDiagText(formatDiagnostics(data, (zh, vars) => translateText(lang, zh, vars)))
        }
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [lang])

  const refreshDiagnostics = async (): Promise<string> => {
    if (diagBusy) return diagText
    setDiagBusy(true)
    try {
      const text = formatDiagnostics(await collectVoiceDiagnostics(), tr)
      setDiagText(text)
      return text
    } catch (error) {
      const message = tr('检测失败：{msg}', {
        msg: error instanceof Error ? error.message : String(error),
      })
      setDiagText(message)
      return message
    } finally {
      setDiagBusy(false)
    }
  }

  const copyDiagnostics = async () => {
    const text = diagText || (await refreshDiagnostics())
    if (!text) return
    try {
      await Clipboard.write({ string: text })
      toast(tr('诊断信息已复制'))
      return
    } catch {
      /* 网页端可能不支持 Capacitor Clipboard，继续尝试浏览器剪贴板 */
    }
    try {
      await navigator.clipboard.writeText(text)
      toast(tr('诊断信息已复制'))
    } catch {
      toast(tr('复制失败，请手动选择文本'))
    }
  }

  const testSpeech = async () => {
    if (diagTestBusy) return
    setDiagTestBusy(true)
    setDiagTest(null)
    try {
      const result = await testSystemSpeech()
      if (result.ok) {
        setDiagTest({
          ok: true,
          message: tr('收到语音：{text}', { text: result.text }),
          needDownload: false,
        })
      } else {
        setDiagTest({
          ok: false,
          message: tr('语音测试失败：{msg}', { msg: result.error }),
          needDownload: result.unavailable,
        })
      }
    } finally {
      setDiagTestBusy(false)
      void refreshDiagnostics()
    }
  }

  const testLegacyChannel = async () => {
    if (legacyTestBusy) return
    setLegacyTestBusy(true)
    setLegacyTest(null)
    try {
      const result = await testLegacySpeech()
      if (result.ok) {
        setLegacyTest({
          ok: true,
          message: result.package
            ? tr('收到兼容语音：{text}（实际使用 {engine}，包名 {package}）', {
                text: result.text,
                engine: engineName(result, tr),
                package: result.package,
              })
            : tr('收到兼容语音：{text}', { text: result.text }),
        })
      } else {
        setLegacyTest({
          ok: false,
          message: tr('兼容语音测试失败：{msg}', { msg: result.error }),
        })
      }
    } finally {
      setLegacyTestBusy(false)
      void refreshDiagnostics()
    }
  }

  useEffect(() => {
    let alive = true
    void isVoskModelReady().then((value) => {
      if (alive) setVoiceReady(value)
    })
    return () => {
      alive = false
    }
  }, [])

  const download = async () => {
    if (busy) return
    setBusy(true)
    setProgress(0)
    setError('')
    try {
      const ok = await downloadOcrModel((value) => setProgress(value))
      if (ok) {
        setReady(true)
        toast(tr('识别模型下载完成，现在可以离线识别小票'))
      } else {
        setError(getOcrModelError() || tr('下载失败，请检查网络后重试'))
        toast(tr('模型下载失败'))
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    await deleteOcrModel()
    setReady(false)
    setProgress(0)
    setError('')
    toast(tr('识别模型已删除'))
  }

  const downloadVoice = async () => {
    if (voiceBusy) return
    setVoiceBusy(true)
    setVoiceProgress(0)
    setVoiceError('')
    setVoiceTestResult(null)
    try {
      const ok = await downloadVoskModel((value) => setVoiceProgress(value))
      if (ok) {
        setVoiceReady(true)
        toast(tr('离线语音模型下载完成'))
      } else {
        setVoiceError(getVoskModelError() || tr('下载失败，请检查网络后重试'))
        toast(tr('离线语音模型下载失败'))
      }
    } finally {
      setVoiceBusy(false)
    }
  }

  const removeVoice = async () => {
    await deleteVoskModel()
    setVoiceReady(false)
    setVoiceProgress(0)
    setVoiceError('')
    setVoiceTestResult(null)
    toast(tr('离线语音模型已删除'))
  }

  /** 只加载引擎和模型并创建一次识别器，用来确认模型能正常启动 */
  const testVoice = async () => {
    if (voiceTestBusy) return
    setVoiceTestBusy(true)
    setVoiceTestResult(null)
    try {
      const reason = await testVoskModelStartup()
      if (reason) {
        setVoiceTestResult({ ok: false, message: reason })
      } else {
        setVoiceTestResult({
          ok: true,
          message: tr('离线语音引擎加载成功，可以开始识别'),
        })
      }
    } finally {
      setVoiceTestBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-5">
      <header className="flex items-start gap-2 pt-4">
        <button
          type="button"
          onClick={() => nav.back()}
          aria-label={tr('返回')}
          className="press mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2"
        >
          <ArrowLeft size={19} />
        </button>
        <div>
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Offline Model</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
            {tr('离线识别')}
          </h1>
          <p className="mt-2 text-caption leading-5 text-ink-3">
            {tr('两个模型都只在需要时下载，不打包进安装包。')}
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body font-medium text-ink">{tr('小票识别模型')}</p>
            <p className="mt-0.5 text-caption text-ink-3">
              {tr('引擎已内置，中文模型约 {size}MB，只在需要时下载。', {
                size: OCR_MODEL_SIZE_MB,
              })}
            </p>
          </div>
          <span
            className={
              ready
                ? 'shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-caption text-accent'
                : 'shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-caption text-ink-3'
            }
          >
            {ready ? tr('已下载') : tr('未下载')}
          </span>
        </div>

        {busy ? (
          <div className="mt-4 space-y-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-caption text-ink-3">
              {tr('正在下载… {percent}%', { percent: Math.round(progress * 100) })}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 flex items-start gap-1.5 break-all text-caption leading-5 text-warn">
            <WarningCircle size={14} className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex gap-2">
          {ready ? (
            <button type="button" className="btn-ghost h-10 flex-1 text-note" onClick={() => void remove()}>
              <Trash size={14} />
              {tr('删除模型')}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary h-10 flex-1 text-note"
              disabled={busy}
              onClick={() => void download()}
            >
              <DownloadSimple size={15} />
              {busy ? tr('下载中…') : tr('下载模型')}
            </button>
          )}
        </div>

        <p className="mt-3 text-caption leading-5 text-ink-3">
          {tr('模型从 GitHub 仓库下载，失败时会自动切换备用镜像。识别全程在本机完成，不会上传小票图片。')}
        </p>
      </section>

      <section ref={voiceSectionRef} className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body font-medium text-ink">{tr('离线语音模型')}</p>
            <p className="mt-0.5 text-caption text-ink-3">
              {tr('Vosk 中文语音模型约 {size}MB，只在需要时下载，用于系统语音不可用时回退。', {
                size: VOSK_MODEL_SIZE_MB,
              })}
            </p>
          </div>
          <span
            className={
              voiceReady
                ? 'shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-caption text-accent'
                : 'shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-caption text-ink-3'
            }
          >
            {voiceReady ? tr('已下载') : tr('未下载')}
          </span>
        </div>

        {voiceBusy ? (
          <div className="mt-4 space-y-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${Math.round(voiceProgress * 100)}%` }}
              />
            </div>
            <p className="text-caption text-ink-3">
              {tr('正在下载… {percent}%', { percent: Math.round(voiceProgress * 100) })}
            </p>
          </div>
        ) : null}

        {voiceError ? (
          <p className="mt-3 flex items-start gap-1.5 break-all text-caption leading-5 text-warn">
            <WarningCircle size={14} className="mt-0.5 shrink-0" />
            {voiceError}
          </p>
        ) : null}

        <div className="mt-4 flex gap-2">
          {voiceReady ? (
            <>
              <button
                type="button"
                className="btn-primary h-10 flex-1 text-note"
                disabled={voiceTestBusy}
                onClick={() => void testVoice()}
              >
                <Play size={14} />
                {voiceTestBusy ? tr('正在加载模型…') : tr('测试启动')}
              </button>
              <button
                type="button"
                className="btn-ghost h-10 flex-1 text-note"
                onClick={() => void removeVoice()}
              >
                <Trash size={14} />
                {tr('删除模型')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-primary h-10 flex-1 text-note"
              disabled={voiceBusy}
              onClick={() => void downloadVoice()}
            >
              <DownloadSimple size={15} />
              {voiceBusy ? tr('下载中…') : tr('下载模型')}
            </button>
          )}
        </div>

        {voiceTestResult ? (
          <p
            className={
              voiceTestResult.ok
                ? 'mt-3 flex items-start gap-1.5 break-all text-caption leading-5 text-accent'
                : 'mt-3 flex items-start gap-1.5 break-all text-caption leading-5 text-warn'
            }
          >
            {voiceTestResult.ok ? (
              <CheckCircle size={14} className="mt-0.5 shrink-0" />
            ) : (
              <WarningCircle size={14} className="mt-0.5 shrink-0" />
            )}
            {voiceTestResult.message}
          </p>
        ) : null}

        <p className="mt-3 text-caption leading-5 text-ink-3">
          {tr('模型从 GitHub 仓库下载，失败时会自动切换备用镜像。识别全程在本机完成，不会上传录音。')}
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="min-w-0">
          <p className="text-body font-medium text-ink">{tr('语音诊断')}</p>
          <p className="mt-0.5 text-caption leading-5 text-ink-3">
            {tr('语音识别不可用时，先检测系统语音、麦克风权限和离线模型，再复制诊断信息。')}
          </p>
        </div>

        <div className="mt-3 rounded-xl border border-line bg-paper-2/40 p-3">
          <p className="select-text whitespace-pre-wrap break-all text-caption leading-5 text-ink-2">
            {diagText || tr('点击「立即检测」查看语音状态')}
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn-ghost h-10 text-note"
            disabled={diagBusy}
            onClick={() => void refreshDiagnostics()}
          >
            <ArrowClockwise size={14} />
            {diagBusy ? tr('检测中…') : tr('立即检测')}
          </button>
          <button
            type="button"
            className="btn-ghost h-10 text-note"
            disabled={diagBusy || diagTestBusy}
            onClick={() => void copyDiagnostics()}
          >
            <Copy size={14} />
            {tr('复制诊断')}
          </button>
        </div>

        <button
          type="button"
          className="btn-primary mt-2 h-10 w-full text-note"
          disabled={diagTestBusy}
          onClick={() => void testSpeech()}
        >
          <Microphone size={15} />
          {diagTestBusy ? tr('正在测试，请说话…') : tr('测试系统语音')}
        </button>

        {diagTest ? (
          <div className="mt-3 space-y-2">
            <p
              className={
                diagTest.ok
                  ? 'flex items-start gap-1.5 break-all text-caption leading-5 text-accent'
                  : 'flex items-start gap-1.5 break-all text-caption leading-5 text-warn'
              }
            >
              {diagTest.ok ? (
                <CheckCircle size={14} className="mt-0.5 shrink-0" />
              ) : (
                <WarningCircle size={14} className="mt-0.5 shrink-0" />
              )}
              {diagTest.message}
            </p>
            {diagTest.needDownload ? (
              <button
                type="button"
                className="btn-ghost h-9 px-3 text-note"
                onClick={() =>
                  voiceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                <DownloadSimple size={14} />
                {tr('去下载离线语音模型')}
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          className="btn-ghost mt-2 h-10 w-full text-note"
          disabled={legacyTestBusy || diagTestBusy}
          onClick={() => void testLegacyChannel()}
        >
          <Microphone size={15} />
          {legacyTestBusy ? tr('兼容语音测试中，请说话…') : tr('测试兼容语音')}
        </button>

        {legacyTest ? (
          <p
            className={
              legacyTest.ok
                ? 'mt-3 flex items-start gap-1.5 break-all text-caption leading-5 text-accent'
                : 'mt-3 flex items-start gap-1.5 break-all text-caption leading-5 text-warn'
            }
          >
            {legacyTest.ok ? (
              <CheckCircle size={14} className="mt-0.5 shrink-0" />
            ) : (
              <WarningCircle size={14} className="mt-0.5 shrink-0" />
            )}
            {legacyTest.message}
          </p>
        ) : null}
      </section>
    </div>
  )
}
