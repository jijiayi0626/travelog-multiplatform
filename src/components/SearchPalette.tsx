import { useEffect, useRef, useState } from 'react'
import { CalendarCheck, MagnifyingGlass, MapPin, MapTrifold, Notebook, Wallet } from '@phosphor-icons/react'
import type { SearchResult } from '../lib/types'
import { searchAll } from '../lib/repo'
import { useNav, useI18n } from '../lib/app-context'
import { cn } from '../lib/cn'

const KIND_LABEL: Record<SearchResult['kind'], string> = {
  trip: '旅行',
  moment: '记录',
  expense: '账目',
  footprint: '足迹',
  plan: '计划',
}

function ResultIcon({ kind }: { kind: SearchResult['kind'] }) {
  if (kind === 'trip') return <MapTrifold size={16} />
  if (kind === 'moment') return <Notebook size={16} />
  if (kind === 'expense') return <Wallet size={16} />
  if (kind === 'plan') return <CalendarCheck size={16} />
  return <MapPin size={16} />
}

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNav()
  const { tr } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setActive(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    let alive = true
    const timer = window.setTimeout(async () => {
      if (!query.trim()) {
        setResults([])
        return
      }
      const found = await searchAll(query)
      if (alive) {
        setResults(found)
        setActive(0)
      }
    }, 150)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, open])

  const choose = (item: SearchResult) => {
    if (item.kind === 'trip') {
      nav.navigate({ name: 'trip', id: item.id, tab: 'plan' })
    } else if (item.kind === 'moment' && item.tripId) {
      nav.navigate({ name: 'trip', id: item.tripId, tab: 'timeline' })
    } else if (item.kind === 'expense' && item.tripId) {
      nav.navigate({ name: 'trip', id: item.tripId, tab: 'ledger' })
    } else if (item.kind === 'plan' && item.tripId) {
      nav.navigate({ name: 'trip', id: item.tripId, tab: 'plan' })
    } else if (item.kind === 'expense') {
      nav.navigate({ name: 'expenses' })
    } else {
      nav.navigate({ name: 'footprints' })
    }
    onClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[75] flex items-start justify-center px-4 pt-[max(12vh,56px)]"
      role="dialog"
      aria-modal="true"
      aria-label={tr('搜索')}
    >
      <button
        type="button"
        aria-label={tr('关闭搜索')}
        onClick={onClose}
        className="fade-in absolute inset-0 bg-[#0b0b0a]/40 backdrop-blur-[3px]"
      />
      <div
        className="fade-in relative w-full max-w-[620px] overflow-hidden rounded-[1.35rem] border border-line bg-surface"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <MagnifyingGlass size={17} className="shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((current) => Math.min(current + 1, Math.max(results.length - 1, 0)))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((current) => Math.max(current - 1, 0))
              }
              if (event.key === 'Enter' && results[active]) {
                choose(results[active])
              }
            }}
            placeholder={tr('搜索旅行、日程、记录、账目、足迹…')}
            className="min-w-0 flex-1 bg-transparent text-body-lg text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-caption text-ink-3 sm:block">
            ESC
          </kbd>
        </div>

        <div className="max-h-[52dvh] overflow-y-auto p-2">
          {!query.trim() ? (
            <div className="px-3 py-7 text-center">
              <p className="text-body-sm text-ink-3">{tr('输入关键词试试')}</p>
              <p className="mt-1 text-note text-ink-3/80">{tr('「直岛」「拉面」「住宿」「清水寺」')}</p>
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-7 text-center text-body-sm text-ink-3">{tr('没有找到匹配的内容')}</div>
          ) : (
            results.map((item, index) => (
              <button
                key={`${item.kind}-${item.id}`}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(item)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                  index === active ? 'bg-paper-2' : 'hover:bg-paper-2/60',
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
                  <ResultIcon kind={item.kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">{item.title}</span>
                  <span className="block truncate text-caption text-ink-3">{item.subtitle}</span>
                </span>
                <span className="shrink-0 text-caption uppercase tracking-wide text-ink-3">
                  {tr(KIND_LABEL[item.kind])}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-caption text-ink-3">
          <span>{tr('↑↓ 选择')}</span>
          <span>{tr('↵ 打开')}</span>
          <span>{tr('ESC 关闭')}</span>
        </div>
      </div>
    </div>
  )
}