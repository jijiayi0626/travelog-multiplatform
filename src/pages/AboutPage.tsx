import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Browser } from '@capacitor/browser'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  BookOpen,
  CaretRight,
  Code,
  DownloadSimple,
  GithubLogo,
  Info,
  MapTrifold,
  Microphone,
  ShieldCheck,
  Wrench,
} from '@phosphor-icons/react'
import { resetAll } from '../lib/repo'
import { useI18n, useNav, useRefresh, useToast } from '../lib/app-context'
import { apiOrigin, getCloudConfig } from '../lib/cloud'
import { isDevMode, setDevMode, subscribeDevMode } from '../lib/dev-mode'
import { openOnboarding } from '../lib/onboarding'
import { isNative } from '../lib/native'
import { ConfirmDialog } from '../components/ui'

const REPO_URL = 'https://github.com/jijiayi0626/travelog-multiplatform'
const TAPS_TO_UNLOCK = 7

export function AboutPage() {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { tr } = useI18n()
  const [devMode, setDevModeState] = useState(() => isDevMode())
  const [confirmReset, setConfirmReset] = useState(false)
  const [applying, setApplying] = useState(false)
  const [speechDiag, setSpeechDiag] = useState('')
  const taps = useRef(0)
  const tapTimer = useRef(0)

  useEffect(() => subscribeDevMode(() => setDevModeState(isDevMode())), [])
  useEffect(() => () => window.clearTimeout(tapTimer.current), [])

  /** 仅开发者模式可见：一次性看清语音服务、权限、监听状态与最近错误 */
  const checkSpeech = async () => {
    if (!isNative()) {
      setSpeechDiag(tr('网页端使用浏览器自带的语音识别'))
      return
    }
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
      const available = await SpeechRecognition.available()
      let permission = 'unknown'
      try {
        permission = (await SpeechRecognition.checkPermissions()).speechRecognition
      } catch {
        /* 旧版本插件可能不支持 */
      }
      let active = false
      try {
        active = (await SpeechRecognition.isListening()).listening
      } catch {
        /* 忽略 */
      }
      const last = localStorage.getItem('travelog.voiceLastError') || tr('无')
      setSpeechDiag(
        tr('可用：{a} · 权限：{p} · 监听：{l} · 最近错误：{e}', {
          a: available.available ? tr('是') : tr('否'),
          p: permission,
          l: active ? tr('是') : tr('否'),
          e: last,
        }),
      )
    } catch (error) {
      setSpeechDiag(
        tr('检测失败：{msg}', {
          msg: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }

  /** 版本号本身不做任何提示，连续点 7 次才会静默开启开发者模式 */
  const tapVersion = () => {
    if (devMode) return
    window.clearTimeout(tapTimer.current)
    taps.current += 1
    if (taps.current >= TAPS_TO_UNLOCK) {
      taps.current = 0
      setDevMode(true)
      setDevModeState(true)
      return
    }
    tapTimer.current = window.setTimeout(() => {
      taps.current = 0
    }, 4000)
  }

  const forceUpdate = async () => {
    setApplying(true)
    try {
      const registrations = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : []
      await Promise.all(registrations.map((item) => item.unregister()))
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
      toast(tr('缓存已清除，正在重新加载'))
      window.setTimeout(() => window.location.reload(), 600)
    } catch {
      window.location.reload()
    }
  }

  const doReset = async () => {
    await resetAll()
    bump()
    toast(tr('已恢复示例数据'))
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
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">About</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
            {tr('关于旅记')}
          </h1>
        </div>
      </header>

      <section className="flex items-center gap-4 border-y border-line py-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_14px_28px_-18px_rgba(15,118,110,0.9)]">
          <MapTrifold size={27} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-title font-semibold tracking-tight text-ink">旅记 · Travelog</p>
          <p className="mt-0.5 text-note text-ink-3">{tr('本地优先的旅行手帐')}</p>
        </div>
        <button
          type="button"
          onClick={tapVersion}
          className="press shrink-0 px-1 py-1 text-caption tabular-nums text-ink-3"
        >
          v{__APP_VERSION__}
        </button>
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <SettingRow
          icon={<DownloadSimple size={17} />}
          title={tr('下载与更新')}
          value={tr('安装包与线路')}
          onClick={() => nav.navigate({ name: 'download' })}
        />
        <SettingRow
          icon={<BookOpen size={17} />}
          title={tr('更新日志')}
          value={tr('历史版本')}
          onClick={() => nav.navigate({ name: 'changelog' })}
        />
        <SettingRow
          icon={<BookOpen size={17} />}
          title={tr('新手引导')}
          value={tr('再看一遍')}
          onClick={() => openOnboarding()}
        />
        <SettingRow
          icon={<GithubLogo size={17} />}
          title={tr('GitHub 仓库')}
          value={tr('源码与问题反馈')}
          onClick={() => void Browser.open({ url: REPO_URL })}
        />
        <SettingRow
          icon={<ShieldCheck size={17} />}
          title={tr('隐私与数据')}
          value={tr('本地优先')}
          onClick={() => toast(tr('数据默认保存在本机，登录云同步后才会上传到你自己的服务器'))}
        />
        <SettingRow
          icon={<Info size={17} />}
          title={tr('运行环境')}
          value={isNative() ? tr('移动应用') : tr('网页')}
          onClick={() => toast(navigator.userAgent)}
        />
      </section>

      {devMode ? (
        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <SettingRow
            icon={<Wrench size={17} />}
            title={tr('管理面板')}
            value={tr('用户、AI 接口与站点设置')}
            onClick={() => nav.navigate({ name: 'admin' })}
          />
          <SettingRow
            icon={<ArrowCounterClockwise size={17} />}
            title={tr('恢复示例数据')}
            value={tr('清空本地数据')}
            onClick={() => setConfirmReset(true)}
          />
          <SettingRow
            icon={<ArrowClockwise size={17} />}
            title={tr('强制更新')}
            value={applying ? tr('处理中…') : tr('清除缓存并重新加载')}
            onClick={() => void forceUpdate()}
          />
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
              <Info size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">{tr('API 地址')}</p>
              <p className="mt-0.5 break-all text-caption text-ink-3">
                {getCloudConfig().baseUrl || apiOrigin()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
              <Code size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">{tr('构建信息')}</p>
              <p className="mt-0.5 break-all text-caption text-ink-3">
                {`v${__APP_VERSION__} · ${__BUILD_ID__} · ${new Date(__BUILD_TIME__).toLocaleString()}`}
              </p>
            </div>
          </div>
          <SettingRow
            icon={<Microphone size={17} />}
            title={tr('语音识别诊断')}
            value={speechDiag || tr('点击检测语音服务与权限')}
            onClick={() => void checkSpeech()}
          />
          <div className="px-4 py-3">
            <button
              type="button"
              className="btn-ghost h-9 w-full text-note text-ink-3"
              onClick={() => {
                setDevMode(false)
                setDevModeState(false)
                toast(tr('开发者模式已关闭'))
              }}
            >
              {tr('关闭开发者模式')}
            </button>
          </div>
        </section>
      ) : null}

      <p className="pb-2 text-center text-caption leading-5 text-ink-3">
        {tr('旅记把数据放在你自己的设备与服务器上。')}
        <br />
        Travelog · {isNative() ? 'Android / iOS' : 'Web'} · v{__APP_VERSION__}
      </p>

      <ConfirmDialog
        open={confirmReset}
        title={tr('恢复示例数据？')}
        message={tr('本机上现有的旅行、日程、记录与账目都会被替换为最初的示例内容。建议先导出备份。')}
        confirmText={tr('恢复')}
        onClose={() => setConfirmReset(false)}
        onConfirm={doReset}
      />
    </div>
  )
}

function SettingRow({
  icon,
  title,
  value,
  onClick,
}: {
  icon: ReactNode
  title: string
  value: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0 hover:bg-paper-2/60"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-body text-ink">{title}</span>
      <span className="shrink-0 text-note text-ink-3">{value}</span>
      <CaretRight size={14} className="shrink-0 text-ink-3" />
    </button>
  )
}
