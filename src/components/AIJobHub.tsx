import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CheckCircle,
  CircleNotch,
  Copy,
  Sparkle,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import {
  deleteAIJob,
  getActiveAIJobs,
  getAIJobs,
  getUnreadAIJobs,
  markAIJobsRead,
  refreshAIJobs,
  startAIJobWatcher,
  subscribeAIJobs,
  type AIJob,
  type AIJobKind,
} from '../lib/ai-jobs'
import { isSignedIn } from '../lib/cloud'
import { cn } from '../lib/cn'
import { formatDate, formatTime } from '../lib/utils'
import { useI18n, useNav, useToast } from '../lib/app-context'
import { ConfirmDialog, Sheet } from './ui'

const KIND_LABEL: Record<AIJobKind, string> = {
  polish: '润色游记',
  plan: '生成行程',
  packing: '打包清单',
  qa: '旅行问答',
  recap: '年度回顾',
  trip_note: '旅程开场白',
  custom: 'AI 任务',
}

function kindLabel(kind: AIJobKind): string {
  return KIND_LABEL[kind] || 'AI 任务'
}

function prettyResult(job: AIJob): string {
  if (job.kind !== 'plan' && job.kind !== 'packing') return job.result
  try {
    const start = job.result.indexOf('{')
    const end = job.result.lastIndexOf('}')
    if (start < 0 || end <= start) return job.result
    const data = JSON.parse(job.result.slice(start, end + 1)) as { items?: unknown }
    const items = Array.isArray(data.items) ? data.items : []
    if (job.kind === 'packing') {
      const list = items.map((item) => String(item ?? '').trim()).filter(Boolean)
      return list.length > 0 ? list.join('、') : job.result
    }
    const lines = items
      .map((item) => {
        const row = item as Record<string, unknown>
        const day = Number(row.dayIndex) || 1
        const time = String(row.time ?? '').trim()
        const title = String(row.title ?? '').trim()
        const place = String(row.place ?? '').trim()
        if (!title) return ''
        return `第 ${day} 天${time ? ` ${time}` : ''} · ${title}${place ? `（${place}）` : ''}`
      })
      .filter(Boolean)
    return lines.length > 0 ? lines.join('\n') : job.result
  } catch {
    return job.result
  }
}

function jobTime(job: AIJob): string {
  return `${formatDate(job.createdAt)} ${formatTime(job.createdAt)}`
}

function StatusIcon({ status }: { status: AIJob['status'] }) {
  if (status === 'done') return <CheckCircle size={16} weight="fill" className="text-accent" />
  if (status === 'error') return <WarningCircle size={16} weight="fill" className="text-danger" />
  return <CircleNotch size={16} className="animate-spin text-accent" />
}

export function AIJobHub() {
  const { tr } = useI18n()
  const toast = useToast()
  const [jobs, setJobs] = useState<AIJob[]>(() => getAIJobs())
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AIJob | null>(null)
  const [signedIn, setSignedIn] = useState(() => isSignedIn())

  useEffect(() => {
    const syncAuth = () => {
      setSignedIn(isSignedIn())
      setJobs(getAIJobs())
      if (isSignedIn()) {
        startAIJobWatcher()
        void refreshAIJobs().catch(() => {})
      }
    }
    syncAuth()
    startAIJobWatcher()
    const unsubscribe = subscribeAIJobs(setJobs)
    window.addEventListener('travelog:cloud-changed', syncAuth)
    return () => {
      unsubscribe()
      window.removeEventListener('travelog:cloud-changed', syncAuth)
    }
  }, [])

  useEffect(() => {
    const openFromProfile = () => {
      setOpen(true)
      markAIJobsRead(getUnreadAIJobs().map((item) => item.id))
    }
    window.addEventListener('travelog:ai-open', openFromProfile)
    return () => window.removeEventListener('travelog:ai-open', openFromProfile)
  }, [])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!signedIn || jobs.length === 0) return null

  const active = getActiveAIJobs(jobs)
  const unread = getUnreadAIJobs(jobs)
  const latestUnread = unread[0]
  const latestStatus = unread.some((item) => item.status === 'error') ? 'error' : 'done'

  const openDrawer = () => {
    setOpen(true)
    markAIJobsRead(unread.map((item) => item.id))
  }

  const copy = (job: AIJob) => {
    const text = prettyResult(job)
    if (!navigator.clipboard) {
      toast(tr('复制失败，请手动选择文本'))
      return
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => toast(tr('已复制 AI 结果')))
      .catch(() => toast(tr('复制失败，请手动选择文本')))
  }

  const drawer = open
    ? createPortal(
        <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label={tr('AI 任务')}>
          <button
            type="button"
            aria-label={tr('关闭')}
            onClick={() => setOpen(false)}
            className="fade-in absolute inset-0 bg-[#0b0b0a]/40 backdrop-blur-[2px]"
          />
          <aside className="slide-in-right absolute inset-y-0 right-0 flex w-full max-w-[440px] flex-col border-l border-line bg-paper shadow-[var(--shadow-float)]">
            <header className="safe-top flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 pb-3.5">
              <div>
                <h2 className="flex items-center gap-1.5 text-title font-semibold tracking-tight text-ink">
                  <Sparkle size={17} weight="fill" className="text-accent" />
                  {tr('AI 任务')}
                </h2>
                <p className="mt-0.5 text-caption leading-4 text-ink-3">
                  {tr('离开页面也会继续生成，结果保存在账号里。')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={tr('关闭')}
                className="press -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2"
              >
                <X size={18} />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 py-4">
              {jobs.map((job) => {
                const isOpen = expanded === job.id
                const running = job.status === 'queued' || job.status === 'running'
                return (
                  <div
                    key={job.id}
                    className={cn(
                      'rounded-2xl border bg-surface transition-colors',
                      running ? 'border-accent/35' : 'border-line',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : job.id)}
                      className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                        <StatusIcon status={job.status} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-body-sm font-medium text-ink">
                            {tr(job.label || kindLabel(job.kind))}
                          </span>
                          {running ? (
                            <span className="text-caption text-accent">{tr('生成中')}</span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-caption text-ink-3">{jobTime(job)}</span>
                        {!isOpen ? (
                          <span className="mt-1 block truncate text-note text-ink-2">
                            {job.status === 'error'
                              ? job.error || tr('生成失败')
                              : job.status === 'done'
                                ? prettyResult(job).replace(/\s+/g, ' ').slice(0, 64)
                                : tr('已在后台执行，可以离开此页面。')}
                          </span>
                        ) : null}
                      </span>
                    </button>

                    {isOpen ? (
                      <div className="border-t border-line px-3.5 py-3">
                        {running ? (
                          <p className="flex items-center gap-2 text-body-sm text-ink-2">
                            <CircleNotch size={14} className="animate-spin text-accent" />
                            {tr('正在生成，完成后右上角会提醒；你可以先去别的页面。')}
                          </p>
                        ) : job.status === 'error' ? (
                          <p className="rounded-xl bg-danger/10 px-3 py-2 text-body-sm leading-5 text-danger">
                            {job.error || tr('生成失败，请稍后再试')}
                          </p>
                        ) : (
                          <>
                            <pre className="max-h-[46dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-paper-2/70 px-3 py-2.5 font-sans text-body-sm leading-6 text-ink">
                              {prettyResult(job)}
                            </pre>
                            <div className="mt-2.5 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="btn-ghost h-9 px-3 text-note"
                                onClick={() => copy(job)}
                              >
                                <Copy size={14} />
                                {tr('复制')}
                              </button>
                              <button
                                type="button"
                                className="btn-ghost h-9 px-3 text-note text-danger"
                                onClick={() => setDeleting(job)}
                              >
                                <Trash size={14} />
                                {tr('删除')}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <footer className="safe-bottom shrink-0 border-t border-line px-5 py-3 text-caption leading-4 text-ink-3">
              {tr('AI 结果按账号保存，换设备登录也能查看。')}
            </footer>
          </aside>
        </div>,
        document.body,
      )
    : null

  const confirm = (
    <ConfirmDialog
      open={Boolean(deleting)}
      title={tr('删除 AI 记录')}
      message={tr('删除后无法恢复，确定删除这条记录吗？')}
      confirmText={tr('删除')}
      onClose={() => setDeleting(null)}
      onConfirm={() => {
        const target = deleting
        if (!target) return
        void deleteAIJob(target.id)
          .then(() => {
            setExpanded((value) => (value === target.id ? null : value))
            toast(tr('已删除 AI 记录'))
          })
          .catch((error: unknown) => {
            toast(error instanceof Error ? error.message : tr('删除失败'))
          })
      }}
    />
  )

  return (
    <>
      {!open ? (
        <div className="pointer-events-none fixed right-3 top-[calc(env(safe-area-inset-top)+10px)] z-[48] lg:right-4 lg:top-4">
          {latestUnread ? (
            <div className="fade-in pointer-events-auto w-[min(340px,calc(100vw-24px))] rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-float)]">
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    latestStatus === 'error'
                      ? 'bg-danger/10 text-danger'
                      : 'bg-accent-soft text-accent',
                  )}
                >
                  {latestStatus === 'error' ? (
                    <WarningCircle size={16} weight="fill" />
                  ) : (
                    <Sparkle size={15} weight="fill" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-medium text-ink">
                    {latestStatus === 'error'
                      ? tr('AI 任务未完成')
                      : unread.length > 1
                        ? tr('{n} 个 AI 任务已完成', { n: unread.length })
                        : tr('AI 已完成')}
                  </p>
                  <p className="mt-0.5 truncate text-caption text-ink-3">
                    {tr(latestUnread.label || kindLabel(latestUnread.kind))}
                    {active.length > 0 ? ` · ${tr('另有 {n} 个生成中', { n: active.length })}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={tr('关闭')}
                  onClick={() => markAIJobsRead(unread.map((item) => item.id))}
                  className="press -mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-paper-2"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  className="btn-primary h-8 flex-1 text-note"
                  onClick={openDrawer}
                >
                  {tr('查看结果')}
                </button>
                <button
                  type="button"
                  className="btn-ghost h-8 px-3 text-note"
                  onClick={() => markAIJobsRead(unread.map((item) => item.id))}
                >
                  {tr('稍后')}
                </button>
              </div>
            </div>
          ) : active.length > 0 ? (
            <button
              type="button"
              onClick={openDrawer}
              aria-label={tr('打开 AI 任务')}
              className="press pointer-events-auto flex items-center gap-1.5 rounded-full border border-line bg-surface/95 py-1.5 pl-2.5 pr-3 text-caption font-medium text-ink-2 shadow-edge backdrop-blur"
            >
              <CircleNotch size={14} className="animate-spin text-accent" />
              {tr('AI 生成中 {n}', { n: active.length })}
            </button>
          ) : null}
        </div>
      ) : null}
      {drawer}
      {confirm}
    </>
  )
}

export function AIPaywall() {
  const { tr } = useI18n()
  const { navigate } = useNav()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const onPaywall = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      setMessage(detail?.message || '')
      setOpen(true)
    }
    window.addEventListener('travelog:ai-paywall', onPaywall)
    return () => window.removeEventListener('travelog:ai-paywall', onPaywall)
  }, [])

  const close = () => setOpen(false)

  return (
    <Sheet
      open={open}
      title={tr('AI 会员功能')}
      onClose={close}
      footer={
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={close}>
            {tr('稍后')}
          </button>
          <button
            type="button"
            className="btn-primary flex-1"
            onClick={() => {
              close()
              navigate({ name: 'sync' })
            }}
          >
            {tr('去开通会员')}
          </button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Sparkle size={26} weight="fill" />
        </span>
        <div>
          <p className="text-body-lg font-semibold text-ink">{tr('开通会员后使用 AI')}</p>
          <p className="mx-auto mt-1.5 max-w-[34ch] text-body-sm leading-6 text-ink-3">
            {message
              ? tr(message)
              : tr('润色游记、生成行程、打包清单、旅行问答和年度回顾都属于会员功能。')}
          </p>
        </div>
        <p className="rounded-xl bg-paper-2/70 px-3 py-2 text-caption leading-4 text-ink-3">
          {tr('在「云同步」输入会员码即可开通，兑换后立即生效。')}
        </p>
      </div>
    </Sheet>
  )
}
