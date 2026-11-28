import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, BookOpen, Sparkle, WarningCircle } from '@phosphor-icons/react'
import { useI18n, useNav } from '../lib/app-context'
import { getAppReleases, type AppRelease } from '../lib/cloud'
import { readPendingRelease, stashPendingRelease } from '../lib/update'
import CHANGELOG from '../../CHANGELOG.md?raw'

interface ChangeSection {
  version: string
  body: string
}

interface ChangelogEntry {
  /** 归一化后的版本号，用来和远端 tag 去重 */
  key: string
  version: string
  tag: string
  publishedAt: number
  body: string
}

function versionKey(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
}

function parseChangelog(source: string): ChangeSection[] {
  const sections: ChangeSection[] = []
  let current: ChangeSection | null = null
  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^##\s+\[?v?([0-9][^\]\s]*)\]?\s*$/)
    if (heading) {
      if (current) sections.push(current)
      current = { version: heading[1].trim(), body: '' }
      continue
    }
    if (current) current.body += `${line}\n`
  }
  if (current) sections.push(current)
  return sections.map((section) => ({ ...section, body: section.body.trim() }))
}

/** 发布脚本会在说明末尾追加 `---` + 安装说明，这部分不属于版本内容 */
function stripInstallFooter(notes: string): string {
  const source = String(notes || '')
  const index = source.search(/^\s*---\s*$/m)
  return (index >= 0 ? source.slice(0, index) : source).trim()
}

function entryFromRelease(release: AppRelease): ChangelogEntry | null {
  const key = versionKey(release.tag || release.version)
  if (!key) return null
  return {
    key,
    version: versionKey(release.version) || key,
    tag: String(release.tag || '').trim() || `v${key}`,
    publishedAt: Number(release.publishedAt) || 0,
    body: stripInstallFooter(release.notes),
  }
}

function localEntries(source: string): ChangelogEntry[] {
  return parseChangelog(source).map((section) => ({
    key: versionKey(section.version),
    version: section.version,
    tag: `v${section.version}`,
    publishedAt: 0,
    body: section.body,
  }))
}

const LOCAL_ENTRIES = localEntries(CHANGELOG)

/** 按发布时间倒序合并；同 tag 用远端覆盖本地，本地独有的历史版本排在后面 */
function mergeEntries(remote: ChangelogEntry[], local: ChangelogEntry[]): ChangelogEntry[] {
  const remoteKeys = new Set(remote.map((item) => item.key))
  return [...remote, ...local.filter((item) => !remoteKeys.has(item.key))].sort(
    (a, b) => b.publishedAt - a.publishedAt,
  )
}

function formatDate(timestamp: number): string {
  return timestamp ? new Date(timestamp).toLocaleDateString('zh-CN') : ''
}

/** 极简 Markdown 行内渲染：粗体与行内代码 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-medium text-ink">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} className="rounded bg-paper-2 px-1 py-0.5 text-[0.92em] text-ink-2">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={key}>{part}</span>
  })
}

function SectionBody({ body, version }: { body: string; version: string }) {
  const nodes = useMemo(() => {
    const result: ReactNode[] = []
    let bullets: string[] = []
    const flush = () => {
      if (!bullets.length) return
      const items = bullets
      bullets = []
      result.push(
        <ul key={`list-${result.length}`} className="mt-1.5 space-y-1.5">
          {items.map((item, index) => (
            <li key={index} className="flex gap-2 text-body-sm leading-6 text-ink-2">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
              <span className="min-w-0 flex-1">{inline(item, `${version}-${result.length}-${index}`)}</span>
            </li>
          ))}
        </ul>,
      )
    }

    body.split(/\r?\n/).forEach((raw, index) => {
      const line = raw.trim()
      if (!line) {
        flush()
        return
      }
      if (/^#{3,6}\s+/.test(line)) {
        flush()
        result.push(
          <p key={`h-${index}`} className="mt-3 text-note font-medium text-ink">
            {inline(line.replace(/^#{3,6}\s+/, ''), `h-${index}`)}
          </p>,
        )
        return
      }
      if (/^[-*]\s+/.test(line)) {
        bullets.push(line.replace(/^[-*]\s+/, ''))
        return
      }
      if (line.startsWith('|')) {
        flush()
        result.push(
          <p key={`t-${index}`} className="break-words font-mono text-caption leading-5 text-ink-3">
            {line}
          </p>,
        )
        return
      }
      if (line.startsWith('>')) {
        flush()
        result.push(
          <p key={`q-${index}`} className="mt-2 text-body-sm leading-6 text-ink-3">
            {inline(line.replace(/^>\s?/, ''), `q-${index}`)}
          </p>,
        )
        return
      }
      flush()
      result.push(
        <p key={`p-${index}`} className="mt-2 text-body-sm leading-6 text-ink-2">
          {inline(line, `p-${index}`)}
        </p>,
      )
    })
    flush()
    return result
  }, [body, version])

  return <div className="pt-1">{nodes}</div>
}

export function ChangelogPage() {
  const nav = useNav()
  const { tr } = useI18n()
  const pending = useMemo(() => readPendingRelease(), [])
  const [remote, setRemote] = useState<AppRelease[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    const pendingKey = pending ? versionKey(pending.tag || pending.version) : ''
    getAppReleases()
      .then((releases) => {
        if (disposed) return
        setRemote(releases)
        // 远端已经包含刚推送的版本时，才清掉临时快照；否则留着供离线查看
        if (pendingKey && releases.some((item) => versionKey(item.tag || item.version) === pendingKey)) {
          stashPendingRelease(null)
        }
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
    }
  }, [pending])

  const entries = useMemo(() => {
    const remoteEntries = (remote ?? [])
      .map(entryFromRelease)
      .filter((item): item is ChangelogEntry => item !== null)
    const pendingEntry = pending ? entryFromRelease(pending) : null
    const withPending =
      pendingEntry && !remoteEntries.some((item) => item.key === pendingEntry.key)
        ? [pendingEntry, ...remoteEntries]
        : remoteEntries
    return mergeEntries(withPending, LOCAL_ENTRIES)
  }, [pending, remote])

  const latest = entries[0]
  const history = entries.slice(1)

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
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Changelog</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
            {tr('更新日志')}
          </h1>
        </div>
      </header>

      {failed ? (
        <p className="flex items-center gap-1.5 text-caption text-ink-3">
          <WarningCircle size={14} className="text-warn" />
          {tr('远端日志加载失败，当前显示本地内置日志')}
        </p>
      ) : null}

      {latest ? (
        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center gap-2.5 px-4 pt-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Sparkle size={16} weight="fill" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-caption uppercase tracking-[0.16em] text-ink-3">{tr('最新发布')}</p>
              <p className="mt-0.5 truncate text-body font-medium tabular-nums text-ink">{latest.tag}</p>
            </div>
            {latest.version === __APP_VERSION__ ? (
              <span className="shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-caption text-ink-3">
                {tr('当前版本')}
              </span>
            ) : null}
            {latest.publishedAt ? (
              <span className="shrink-0 text-caption tabular-nums text-ink-3">
                {formatDate(latest.publishedAt)}
              </span>
            ) : null}
          </div>
          <div className="mt-2 border-t border-line bg-paper/40 px-4 pb-4">
            <SectionBody body={latest.body} version={latest.version} />
          </div>
        </section>
      ) : null}

      {history.length ? (
        <div className="space-y-3 pb-4">
          {history.map((section) => {
            const current = section.version === __APP_VERSION__
            return (
              <details
                key={section.key || section.version}
                className="group overflow-hidden rounded-2xl border border-line bg-surface"
              >
                <summary className="press flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
                    <BookOpen size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-body font-medium tabular-nums text-ink">
                    {section.tag || `v${section.version}`}
                  </span>
                  {section.publishedAt ? (
                    <span className="shrink-0 text-caption tabular-nums text-ink-3">
                      {formatDate(section.publishedAt)}
                    </span>
                  ) : null}
                  {current ? (
                    <span className="shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-caption text-ink-3">
                      {tr('当前版本')}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-caption text-ink-3 transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <div className="border-t border-line bg-surface px-4 pb-4">
                  <SectionBody body={section.body} version={section.version} />
                </div>
              </details>
            )
          })}
        </div>
      ) : !latest ? (
        <p className="py-10 text-center text-body-sm text-ink-3">{tr('暂时没有更新日志')}</p>
      ) : null}
    </div>
  )
}
