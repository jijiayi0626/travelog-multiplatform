import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, DownloadSimple, MapTrifold, Sparkle } from '@phosphor-icons/react'
import { useI18n, useNav, useToast } from '../lib/app-context'
import {
  downloadApk,
  isNewer,
  loadLatestRelease,
  pickApk,
  plainNotes,
  readCustomBase,
  readUpdateMode,
  skipVersion,
  skippedVersion,
  type UpdateMode,
} from '../lib/update'
import type { AppRelease } from '../lib/cloud'

const CHECK_DELAY = 4000

/**
 * 应用启动后自动检查 GitHub Release，有更新时主动弹窗。
 * 用户选「稍后」会记住该版本，不再重复打扰；下个版本仍会提示。
 */
export function UpdatePrompt() {
  const nav = useNav()
  const toast = useToast()
  const { tr } = useI18n()
  const [release, setRelease] = useState<AppRelease | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const check = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    try {
      const data = await loadLatestRelease()
      if (!isNewer(data.version) || skippedVersion() === data.version) return
      setRelease(data)
      setOpen(true)
    } catch {
      /* 网络或服务端异常时静默跳过，不打扰使用 */
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void check(), CHECK_DELAY)
    const onRequest = () => void check()
    window.addEventListener('travelog:check-update', onRequest)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('travelog:check-update', onRequest)
    }
  }, [check])

  if (!open || !release) return null

  const apk = pickApk(release)

  const dismiss = () => {
    skipVersion(release.version)
    setOpen(false)
  }

  const openChangelog = () => {
    setOpen(false)
    nav.navigate({ name: 'changelog' })
  }

  const update = async () => {
    if (!apk) {
      openChangelog()
      return
    }
    setBusy(true)
    const mode: UpdateMode = readUpdateMode()
    try {
      const picked = await downloadApk(apk.url, mode, readCustomBase())
      toast(
        mode === 'auto' && picked.ms >= 0
          ? tr('已选最快线路 {label}（{ms} ms），完成后到系统「下载」目录查看', {
              label: tr(picked.label),
              ms: Math.round(picked.ms),
            })
          : tr('已开始下载 {name}，完成后到系统「下载」目录或通知栏查看', {
              name: apk.name,
            }),
      )
      setOpen(false)
    } catch {
      toast(tr('打开下载失败，请到「下载与更新」复制链接'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[72] flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-label={tr('发现新版本')}
    >
      <button
        type="button"
        aria-label={tr('关闭')}
        onClick={dismiss}
        className="fade-in absolute inset-0 bg-[#0b0b0a]/50 backdrop-blur-[3px]"
      />
      <div
        className="fade-in relative w-full max-w-[360px] overflow-hidden rounded-[1.4rem] border border-line bg-surface"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_12px_24px_-16px_rgba(15,118,110,0.9)]">
            <MapTrifold size={22} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-caption text-accent">
              <Sparkle size={13} weight="fill" />
              {tr('发现新版本')}
            </p>
            <h2 className="mt-1 text-title font-semibold tracking-tight text-ink">
              {tr('旅记 v{version}', { version: release.version })}
            </h2>
            <p className="mt-0.5 flex items-center gap-1 text-caption tabular-nums text-ink-3">
              v{__APP_VERSION__}
              <ArrowRight size={11} />
              v{release.version}
            </p>
          </div>
        </div>

        <div className="mx-5 mt-4 max-h-[28dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-paper-2/60 px-3 py-2.5 text-caption leading-5 text-ink-2">
          {release.notes?.trim() ? plainNotes(release.notes) : tr('这个版本还没有写更新日志。')}
        </div>

        <div className="flex gap-2 px-5 pb-2 pt-4">
          <button type="button" className="btn-ghost h-10 flex-1 text-note" onClick={dismiss}>
            {tr('稍后')}
          </button>
          <button
            type="button"
            className="btn-ghost h-10 flex-1 text-note"
            onClick={openChangelog}
          >
            {tr('更新日志')}
          </button>
          <button
            type="button"
            className="btn-primary h-10 flex-[1.3] text-note"
            disabled={busy}
            onClick={() => void update()}
          >
            <DownloadSimple size={15} />
            {busy ? tr('正在打开…') : apk ? tr('立即更新') : tr('查看更新')}
          </button>
        </div>
        <p className="px-5 pb-4 text-center text-caption text-ink-3">
          {tr('也可以稍后在「我的 → 关于旅记 → 下载与更新」里升级')}
        </p>
      </div>
    </div>,
    document.body,
  )
}
