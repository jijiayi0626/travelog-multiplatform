import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Browser } from '@capacitor/browser'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowsClockwise,
  BookOpen,
  CaretRight,
  CheckCircle,
  Code,
  Copy,
  DownloadSimple,
  GithubLogo,
  Info,
  MapTrifold,
  ShieldCheck,
  WarningCircle,
  Wrench,
} from '@phosphor-icons/react'
import { resetAll } from '../lib/repo'
import { useI18n, useNav, useRefresh, useToast } from '../lib/app-context'
import { apiOrigin, getCloudConfig, getLatestAppRelease, type AppRelease } from '../lib/cloud'
import { isDevMode, setDevMode, subscribeDevMode } from '../lib/dev-mode'
import { openOnboarding } from '../lib/onboarding'
import { isNative } from '../lib/native'
import { cn } from '../lib/cn'
import { ConfirmDialog, Sheet } from '../components/ui'

type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'error'

interface RemoteVersion {
  version?: string
  buildId?: string
  builtAt?: string
}

type UpdateMode = 'auto' | 'mirror1' | 'mirror2' | 'github' | 'custom'

const REPO_URL = 'https://github.com/jijiayi0626/travelog-multiplatform'
const TAPS_TO_UNLOCK = 7
const UPDATE_MODE_KEY = 'travelog.updateMode'
const UPDATE_CUSTOM_KEY = 'travelog.updateCustomBase'

/** 国内下载加速：两个优选 CDN 节点 + GitHub 直连 */
const APK_MIRRORS = [
  { key: 'mirror1', label: '节点一', base: 'https://v6.gh-proxy.org/', host: 'v6.gh-proxy.org' },
  { key: 'mirror2', label: '节点二', base: 'https://cdn.gh-proxy.com/', host: 'cdn.gh-proxy.com' },
  { key: 'github', label: 'GitHub 直连', base: '', host: 'github.com' },
] as const

const UPDATE_MODES: Array<{ key: UpdateMode; label: string }> = [
  { key: 'auto', label: '自动' },
  { key: 'mirror1', label: '节点一' },
  { key: 'mirror2', label: '节点二' },
  { key: 'github', label: 'GitHub 直连' },
  { key: 'custom', label: '自定义' },
]

function normalizeMode(value: string | null): UpdateMode {
  return UPDATE_MODES.some((item) => item.key === value) ? (value as UpdateMode) : 'auto'
}

function readUpdateMode(): UpdateMode {
  return normalizeMode(localStorage.getItem(UPDATE_MODE_KEY))
}

function readCustomBase(): string {
  return localStorage.getItem(UPDATE_CUSTOM_KEY) || ''
}

function versionValue(version: string): number {
  return String(version)
    .replace(/^v/i, '')
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0)
    .reduce((acc, part) => acc * 1000 + part, 0)
}

function mirrorUrl(base: string, url: string): string {
  if (!base) return url
  return `${base.replace(/\/+$/, '')}/${url}`
}

function formatSize(size: number): string {
  if (!size) return ''
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function AboutPage() {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { tr } = useI18n()
  const [devMode, setDevModeState] = useState(() => isDevMode())
  const [updateState, setUpdateState] = useState<UpdateState>('idle')
  const [remote, setRemote] = useState<RemoteVersion | null>(null)
  const [applying, setApplying] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [taps, setTaps] = useState(0)
  const [release, setRelease] = useState<AppRelease | null>(null)
  const [releaseError, setReleaseError] = useState('')
  const [releaseLoading, setReleaseLoading] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [mode, setMode] = useState<UpdateMode>(() => readUpdateMode())
  const [customBase, setCustomBase] = useState(() => readCustomBase())
  const tapTimer = useRef(0)
  const checking = useRef(false)
  const releaseFetchedAt = useRef(0)

  const loadRelease = useCallback(async () => {
    setReleaseLoading(true)
    try {
      const data = await getLatestAppRelease()
      setRelease(data)
      setReleaseError('')
      releaseFetchedAt.current = Date.now()
    } catch (error) {
      setReleaseError(error instanceof Error ? error.message : '检查更新失败')
    } finally {
      setReleaseLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRelease()
  }, [loadRelease])

  useEffect(() => subscribeDevMode(() => setDevModeState(isDevMode())), [])

  const checkUpdate = useCallback(
    async (silent = false) => {
      if (checking.current) return
      checking.current = true
      setUpdateState('checking')
      try {
        const response = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(String(response.status))
        const data = (await response.json()) as RemoteVersion
        setRemote(data)
        const changed = Boolean(data.buildId) && data.buildId !== __BUILD_ID__
        setUpdateState(changed ? 'available' : 'latest')
      } catch {
        setUpdateState('error')
        if (!silent) toast(tr('检查更新失败，请稍后重试'))
      } finally {
        checking.current = false
      }
    },
    [toast, tr],
  )

  // 只在进页时自动检查一次；checkUpdate 依赖的 tr/toast 每次渲染都会变，不能放进依赖
  useEffect(() => {
    void checkUpdate(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyUpdate = async () => {
    setApplying(true)
    try {
      const registrations = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : []
      await Promise.all(registrations.map((item) => item.unregister()))
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
    } catch {
      // 清理失败也直接刷新，至少拿到新的 HTML
    }
    window.setTimeout(() => window.location.reload(), 350)
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

  const tapVersion = () => {
    if (devMode) {
      toast(tr('开发者模式已开启'))
      return
    }
    window.clearTimeout(tapTimer.current)
    const next = taps + 1
    if (next >= TAPS_TO_UNLOCK) {
      setTaps(0)
      setDevMode(true)
      setDevModeState(true)
      toast(tr('开发者模式已开启'))
      return
    }
    setTaps(next)
    tapTimer.current = window.setTimeout(() => setTaps(0), 4000)
  }

  useEffect(() => () => window.clearTimeout(tapTimer.current), [])

  const doReset = async () => {
    await resetAll()
    bump()
    toast(tr('已恢复示例数据'))
  }

  const apk = release?.assets.find((asset) => /release/i.test(asset.name)) ?? release?.assets[0] ?? null
  const hasNewer = release ? versionValue(release.version) > versionValue(__APP_VERSION__) : false

  const chooseMode = (next: UpdateMode) => {
    setMode(next)
    localStorage.setItem(UPDATE_MODE_KEY, next)
  }

  const changeCustomBase = (value: string) => {
    setCustomBase(value)
    localStorage.setItem(UPDATE_CUSTOM_KEY, value)
  }

  const downloadBase =
    mode === 'mirror1'
      ? APK_MIRRORS[0].base
      : mode === 'mirror2'
        ? APK_MIRRORS[1].base
        : mode === 'github'
          ? ''
          : mode === 'custom'
            ? customBase.trim()
            : APK_MIRRORS[0].base

  const downloadUrl = apk ? mirrorUrl(downloadBase, apk.url) : ''

  const download = async () => {
    if (!apk) return
    const candidates =
      mode === 'auto'
        ? [APK_MIRRORS[0].base, APK_MIRRORS[1].base, '']
        : [downloadBase]
    for (const base of candidates) {
      try {
        const url = mirrorUrl(base, apk.url)
        if (!url) continue
        await Browser.open({ url })
        if (mode === 'auto') toast(tr('已打开下载，系统下载器支持断点续传'))
        return
      } catch {
        // 自动模式下继续尝试下一个节点
      }
    }
    toast(tr('打开下载失败，请复制链接后手动下载'))
  }

  const copyUrl = async () => {
    if (!downloadUrl) return
    try {
      await navigator.clipboard.writeText(downloadUrl)
      toast(tr('下载链接已复制'))
    } catch {
      toast(tr('复制失败，请长按链接手动复制'))
    }
  }

  const openUpdate = () => {
    setUpdateOpen(true)
    if (!release && !releaseLoading) void loadRelease()
    else if (Date.now() - releaseFetchedAt.current > 5 * 60_000) void loadRelease()
  }

  const statusText =
    updateState === 'checking'
      ? tr('检查中…')
      : updateState === 'latest'
        ? tr('已是最新版本')
        : updateState === 'available'
          ? tr('有新版本可用')
          : updateState === 'error'
            ? tr('检查失败')
            : tr('未检查')

  const nodeSummary = APK_MIRRORS.map((item) => `${item.label} ${item.host}`).join(' · ')

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
          onClick={openUpdate}
          className="press relative shrink-0 rounded-full border border-line px-2.5 py-1 text-caption tabular-nums text-ink-2 hover:bg-paper-2"
        >
          v{__APP_VERSION__}
          {hasNewer ? (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent" />
          ) : null}
        </button>
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
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

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
            <Code size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body text-ink">{tr('开发者模式')}</p>
            <p className="mt-0.5 text-caption text-ink-3">
              {devMode ? tr('已开启 · 管理面板与恢复默认已显示') : tr('连续点击版本号 7 次即可开启')}
            </p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-caption',
              devMode ? 'bg-accent-soft text-accent' : 'bg-paper-2 text-ink-3',
            )}
          >
            {devMode ? tr('已开启') : tr('未开启')}
          </span>
        </div>

        {devMode ? (
          <>
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
              value={tr('清除缓存并重新加载')}
              onClick={() => void forceUpdate()}
            />
            <div className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-b-0">
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
            <div className="px-4 pb-3">
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
          </>
        ) : (
          <div className="px-4 py-4">
            <button
              type="button"
              onClick={tapVersion}
              className="press mx-auto flex w-full max-w-[320px] flex-col items-center gap-1 rounded-xl border border-dashed border-line px-4 py-3 text-center"
            >
              <span className="text-body-sm font-medium tabular-nums text-ink-2">v{__APP_VERSION__}</span>
              <span className="text-caption text-ink-3">
                {taps > 0
                  ? tr('再点 {n} 次开启开发者模式', { n: TAPS_TO_UNLOCK - taps })
                  : tr('点按版本号 {n} 次', { n: TAPS_TO_UNLOCK })}
              </span>
            </button>
            <div className="mx-auto mt-3 flex w-full max-w-[320px] gap-1.5">
              {Array.from({ length: TAPS_TO_UNLOCK }).map((_, index) => (
                <span
                  key={index}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors',
                    index < taps ? 'bg-accent' : 'bg-paper-2',
                  )}
                />
              ))}
            </div>
            <p className="mt-3 text-center text-caption text-ink-3">
              {tr('开发者模式用于管理面板、恢复默认与诊断信息，普通使用无需开启。')}
            </p>
          </div>
        )}
      </section>

      <p className="pb-2 text-center text-caption leading-5 text-ink-3">
        {tr('旅记把数据放在你自己的设备与服务器上。')}
        <br />
        Travelog · {isNative() ? 'Android / iOS' : 'Web'} · v{__APP_VERSION__}
      </p>

      <Sheet
        open={updateOpen}
        title={tr('版本与更新')}
        onClose={() => setUpdateOpen(false)}
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost flex-1"
              disabled={releaseLoading}
              onClick={() => void loadRelease()}
            >
              <ArrowsClockwise size={15} className={releaseLoading ? 'animate-spin' : undefined} />
              {releaseLoading ? tr('检查中…') : tr('重新检查')}
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={!apk}
              onClick={() => void download()}
            >
              <DownloadSimple size={15} />
              {apk ? (hasNewer ? tr('下载 v{version}', { version: release?.version || '' }) : tr('下载安装包')) : tr('暂无安装包')}
            </button>
          </div>
        }
      >
        <div className="space-y-4 pb-2">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-paper-2/60 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-body-sm text-ink">
                {tr('当前 v{current}', { current: __APP_VERSION__ })}
                {release ? (
                  <span className="ml-2 text-ink-3">
                    {hasNewer
                      ? tr('最新 v{latest}', { latest: release.version })
                      : tr('已是最新')}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-caption text-ink-3">
                {releaseLoading
                  ? tr('正在检查…')
                  : releaseError
                    ? releaseError
                    : release
                      ? `v${release.version}${apk ? ` · ${formatSize(apk.size)}` : ''} · ${new Date(release.publishedAt).toLocaleDateString('zh-CN')}`
                      : tr('暂时无法获取最新版本')}
              </p>
            </div>
            {release && apk ? (
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-caption',
                  hasNewer ? 'bg-accent-soft text-accent' : 'bg-paper-2 text-ink-3',
                )}
              >
                {hasNewer ? tr('有新版本') : tr('已是最新')}
              </span>
            ) : null}
          </div>

          <div>
            <p className="mb-1.5 text-caption text-ink-3">{tr('下载线路')}</p>
            <div className="flex flex-wrap gap-1.5">
              {UPDATE_MODES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={mode === item.key}
                  onClick={() => chooseMode(item.key)}
                  className={cn(
                    'press rounded-lg border px-2.5 py-1.5 text-caption',
                    mode === item.key
                      ? 'border-accent bg-accent/10 font-medium text-accent'
                      : 'border-line text-ink-2',
                  )}
                >
                  {tr(item.label)}
                </button>
              ))}
            </div>
            {mode === 'custom' ? (
              <input
                value={customBase}
                onChange={(event) => changeCustomBase(event.target.value)}
                placeholder="https://your-proxy.example/"
                className="mt-2 w-full rounded-lg border border-line bg-paper px-2.5 py-2 text-note text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
            ) : null}
            <p className="mt-1.5 break-all text-caption leading-4 text-ink-3">{nodeSummary}</p>
            <p className="mt-0.5 text-caption leading-4 text-ink-3">
              {tr('自动模式会依次尝试节点一、节点二和 GitHub 直连；自定义前缀会拼在原链接前面。')}
            </p>
          </div>

          {downloadUrl ? (
            <div className="rounded-xl border border-line bg-paper/60 p-2.5">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 break-all text-caption leading-4 text-ink-3">{downloadUrl}</p>
                <button
                  type="button"
                  className="btn-ghost h-7 shrink-0 px-2 text-caption"
                  onClick={() => void copyUrl()}
                >
                  <Copy size={13} />
                  {tr('复制')}
                </button>
              </div>
            </div>
          ) : null}

          <div>
            <p className="mb-1.5 text-caption text-ink-3">{tr('更新日志')}</p>
            <div className="max-h-[30dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-paper-2/60 px-3 py-2.5 text-caption leading-5 text-ink-2">
              {release?.notes?.trim()
                ? release.notes
                : release
                  ? tr('这个版本还没有写更新日志。')
                  : tr('获取到版本信息后会显示更新日志。')}
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-line pt-3">
            <div className="min-w-0 flex-1">
              <p className="text-body-sm text-ink">{tr('网页资源')}</p>
              <p className="mt-0.5 text-caption text-ink-3">
                {statusText}
                {updateState === 'latest' && remote?.buildId
                  ? ` · ${remote.buildId.slice(-6)}`
                  : ''}
              </p>
            </div>
            {updateState === 'available' ? (
              <button
                type="button"
                className="btn-primary h-8 px-3 text-note"
                disabled={applying}
                onClick={() => void applyUpdate()}
              >
                {applying ? tr('更新中…') : tr('立即更新')}
              </button>
            ) : (
              <button
                type="button"
                className="btn-ghost h-8 px-3 text-note"
                onClick={() => void checkUpdate()}
              >
                {updateState === 'checking' ? tr('检查中…') : tr('检查')}
              </button>
            )}
          </div>

          {updateState === 'error' ? (
            <p className="flex items-center gap-1.5 text-caption text-ink-3">
              <WarningCircle size={14} className="text-warn" />
              {tr('无法连接更新服务器，请检查网络后重试')}
            </p>
          ) : updateState === 'latest' ? (
            <p className="flex items-center gap-1.5 text-caption text-ink-3">
              <CheckCircle size={14} className="text-accent" />
              {tr('网页资源已是最新')}
            </p>
          ) : null}
        </div>
      </Sheet>

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
