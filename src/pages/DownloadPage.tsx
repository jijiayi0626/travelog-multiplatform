import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowsClockwise,
  BookOpen,
  CaretRight,
  CheckCircle,
  Copy,
  DownloadSimple,
  WarningCircle,
} from '@phosphor-icons/react'
import { useI18n, useNav, useToast } from '../lib/app-context'
import type { AppRelease } from '../lib/cloud'
import { cn } from '../lib/cn'
import {
  APK_MIRRORS,
  UPDATE_MODES,
  formatSize,
  isNewer,
  loadLatestRelease,
  mirrorUrl,
  pickApk,
  readCustomBase,
  readUpdateMode,
  writeCustomBase,
  writeUpdateMode,
  downloadApk,
  type UpdateMode,
} from '../lib/update'

export function DownloadPage() {
  const nav = useNav()
  const toast = useToast()
  const { tr } = useI18n()
  const [release, setRelease] = useState<AppRelease | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<UpdateMode>(() => readUpdateMode())
  const [customBase, setCustomBase] = useState(() => readCustomBase())
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (force = false) => {
      setLoading(true)
      try {
        const data = await loadLatestRelease(force)
        setRelease(data)
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : tr('检查更新失败'))
      } finally {
        setLoading(false)
      }
    },
    [tr],
  )

  useEffect(() => {
    void load()
    // 只在进入页面时查询一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apk = useMemo(() => pickApk(release), [release])
  const hasNewer = release ? isNewer(release.version) : false

  const chooseMode = (next: UpdateMode) => {
    setMode(next)
    writeUpdateMode(next)
  }

  const changeCustomBase = (value: string) => {
    setCustomBase(value)
    writeCustomBase(value)
  }

  const previewBase =
    mode === 'mirror2'
      ? APK_MIRRORS[1].base
      : mode === 'github'
        ? ''
        : mode === 'custom'
          ? customBase.trim()
          : APK_MIRRORS[0].base
  const previewUrl = apk ? mirrorUrl(previewBase, apk.url) : ''

  const download = async () => {
    if (!apk || busy) return
    setBusy(true)
    try {
      const picked = await downloadApk(apk.url, mode, customBase)
      if (mode === 'auto' && picked.ms >= 0) {
        toast(
          tr('已选最快线路 {label}（{ms} ms），完成后到系统「下载」目录查看', {
            label: tr(picked.label),
            ms: Math.round(picked.ms),
          }),
        )
      } else {
        toast(
          tr('已开始下载 {name}，完成后到系统「下载」目录或通知栏查看', {
            name: apk.name,
          }),
        )
      }
    } catch {
      toast(tr('打开下载失败，请复制链接后手动下载'))
    } finally {
      setBusy(false)
    }
  }

  const copyUrl = async () => {
    if (!previewUrl) return
    try {
      await navigator.clipboard.writeText(previewUrl)
      toast(tr('下载链接已复制'))
    } catch {
      toast(tr('复制失败，请长按链接手动复制'))
    }
  }

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
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Download</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
            {tr('下载与更新')}
          </h1>
        </div>
      </header>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body-sm text-ink">
              {tr('当前 v{current}', { current: __APP_VERSION__ })}
              {release ? (
                <span className="ml-2 text-ink-3">
                  {hasNewer ? tr('最新 v{latest}', { latest: release.version }) : tr('已是最新')}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-caption text-ink-3">
              {loading
                ? tr('正在检查…')
                : error
                  ? error
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
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="btn-ghost h-9 flex-1 text-note"
            disabled={loading}
            onClick={() => void load(true)}
          >
            <ArrowsClockwise size={14} className={loading ? 'animate-spin' : undefined} />
            {loading ? tr('检查中…') : tr('重新检查')}
          </button>
          <button
            type="button"
            className="btn-ghost h-9 flex-1 text-note"
            onClick={() => nav.navigate({ name: 'changelog' })}
          >
            <BookOpen size={14} />
            {tr('更新日志')}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-body font-medium text-ink">{tr('下载线路')}</p>
        <p className="mt-0.5 text-caption leading-5 text-ink-3">
          {tr('自动模式会同时测速三条线路，选响应最快的一条下载。')}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
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
        <p className="mt-2 break-all text-caption leading-4 text-ink-3">{nodeSummary}</p>
        <p className="mt-0.5 text-caption leading-4 text-ink-3">
          {tr('自定义前缀会拼在原链接前面，留空则等同 GitHub 直连。')}
        </p>

        {previewUrl ? (
          <div className="mt-3 rounded-xl border border-line bg-paper/60 p-2.5">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 break-all text-caption leading-4 text-ink-3">{previewUrl}</p>
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

        <button
          type="button"
          className="btn-primary mt-3 h-11 w-full"
          disabled={!apk || busy}
          onClick={() => void download()}
        >
          <DownloadSimple size={16} />
          {busy
            ? mode === 'auto'
              ? tr('正在测速…')
              : tr('正在打开…')
            : apk
              ? hasNewer
                ? tr('下载 v{version}', { version: release?.version || '' })
                : tr('下载安装包')
              : tr('暂无安装包')}
        </button>
        <p className="mt-2 text-caption leading-5 text-ink-3">
          {tr('APK 会保存到系统「文件管理 → Download」目录，也可以从通知栏点击；首次安装需允许「安装未知应用」。')}
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <button
          type="button"
          onClick={() => nav.navigate({ name: 'changelog' })}
          className="press flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-paper-2/60"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
            <BookOpen size={16} />
          </span>
          <span className="min-w-0 flex-1 text-body text-ink">{tr('更新日志')}</span>
          <span className="shrink-0 text-note text-ink-3">{tr('查看历史版本')}</span>
          <CaretRight size={14} className="shrink-0 text-ink-3" />
        </button>
      </section>

      {error ? (
        <p className="flex items-center gap-1.5 text-caption text-ink-3">
          <WarningCircle size={14} className="text-warn" />
          {tr('无法连接更新服务器，请检查网络后重试')}
        </p>
      ) : release && !hasNewer ? (
        <p className="flex items-center gap-1.5 text-caption text-ink-3">
          <CheckCircle size={14} className="text-accent" />
          {tr('当前已是最新版本')}
        </p>
      ) : null}
    </div>
  )
}
