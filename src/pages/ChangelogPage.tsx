import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, BookOpen } from '@phosphor-icons/react'
import { useI18n, useNav } from '../lib/app-context'
import { cn } from '../lib/cn'
import CHANGELOG from '../../CHANGELOG.md?raw'

interface ChangeSection {
  version: string
  body: string
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
  const sections = useMemo(() => parseChangelog(CHANGELOG), [])

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

      {sections.length ? (
        <div className="space-y-3 pb-4">
          {sections.map((section, index) => {
            const latest = index === 0
            const current = section.version === __APP_VERSION__
            return (
              <details
                key={section.version}
                open={latest}
                className="group overflow-hidden rounded-2xl border border-line bg-surface"
              >
                <summary className="press flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
                    <BookOpen size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-body font-medium tabular-nums text-ink">
                    v{section.version}
                  </span>
                  {latest ? (
                    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-caption text-accent">
                      {tr('最新')}
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
                <div
                  className={cn(
                    'border-t border-line px-4 pb-4',
                    latest ? 'bg-paper/40' : 'bg-surface',
                  )}
                >
                  <SectionBody body={section.body} version={section.version} />
                </div>
              </details>
            )
          })}
        </div>
      ) : (
        <p className="py-10 text-center text-body-sm text-ink-3">{tr('暂时没有更新日志')}</p>
      )}
    </div>
  )
}
