import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Images,
  Keyboard,
  MagnifyingGlass,
  MapPinLine,
  MapTrifold,
  Moon,
  Sun,
  UserCircle,
  Wallet,
} from '@phosphor-icons/react'
import type { View } from '../lib/types'
import { cn } from '../lib/cn'
import { useIsDesktop } from '../lib/hooks'
import { currentTheme, setThemeMode, subscribeSystemTheme } from '../lib/theme'
import { useSearch, useShortcuts } from '../lib/app-context'

const TABS = [
  { key: 'trips', label: '行程', Icon: MapTrifold },
  { key: 'album', label: '相册', Icon: Images },
  { key: 'footprints', label: '足迹', Icon: MapPinLine },
  { key: 'expenses', label: '账本', Icon: Wallet },
  { key: 'profile', label: '我的', Icon: UserCircle },
] as const

type RootKey = (typeof TABS)[number]['key']

function rootOf(view: View): RootKey {
  switch (view.name) {
    case 'album':
      return 'album'
    case 'footprints':
    case 'footprintEditor':
      return 'footprints'
    case 'expenses':
    case 'expenseEditor':
      return 'expenses'
    case 'profile':
    case 'sync':
      return 'profile'
    default:
      return 'trips'
  }
}

function isRoot(view: View): boolean {
  return (
    view.name === 'trips' ||
    view.name === 'album' ||
    view.name === 'footprints' ||
    view.name === 'expenses' ||
    view.name === 'profile'
  )
}

export function AppShell({
  view,
  onRootChange,
  children,
}: {
  view: View
  onRootChange: (key: RootKey) => void
  children: ReactNode
}) {
  const isDesktop = useIsDesktop()
  const openSearch = useSearch()
  const openShortcuts = useShortcuts()
  const active = rootOf(view)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => currentTheme())

  useEffect(() => subscribeSystemTheme(() => setTheme(currentTheme())), [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setThemeMode(next)
    setTheme(next)
  }

  const ThemeGlyph = theme === 'dark' ? Moon : Sun

  return (
    <div className="min-h-[100dvh] bg-paper">
      {isDesktop ? (
        <aside className="fixed inset-y-0 left-0 z-30 flex w-[236px] flex-col border-r border-line bg-surface/70 px-4 py-6 backdrop-blur-xl">
          <div className="flex items-center gap-2.5 px-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-[0_10px_22px_-16px_rgba(15,118,110,0.9)]">
              <MapTrifold size={19} weight="fill" />
            </span>
            <span>
              <span className="block text-body-lg font-semibold leading-tight tracking-tight text-ink">旅记</span>
              <span className="block text-caption uppercase tracking-[0.18em] text-ink-3">Travelog</span>
            </span>
          </div>

          <button
            type="button"
            onClick={openSearch}
            className="press mt-6 flex w-full items-center gap-2 rounded-xl border border-line bg-paper-2/60 px-3 py-2 text-left text-body-sm text-ink-3 hover:text-ink"
          >
            <MagnifyingGlass size={15} />
            <span className="flex-1">搜索</span>
            <kbd className="rounded border border-line px-1 py-0.5 text-caption">⌘K</kbd>
          </button>

          <nav className="mt-4 flex flex-col gap-1">
            {TABS.map(({ key, label, Icon }) => {
              const isActive = active === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onRootChange(key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'press flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-body transition-colors',
                    isActive
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-ink-2 hover:bg-paper-2 hover:text-ink',
                  )}
                >
                  <Icon size={17} weight={isActive ? 'fill' : 'regular'} />
                  {label}
                </button>
              )
            })}
          </nav>

          <div className="mt-auto space-y-3">
            <div className="rounded-xl border border-line bg-paper-2/60 p-3">
              <p className="text-note font-medium text-ink-2">本地优先</p>
              <p className="mt-1 text-caption leading-4 text-ink-3">
                日程、照片与账目都存在本机。导出 JSON 就能带走全部数据。
              </p>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="press flex w-full items-center gap-2 rounded-xl px-3 py-2 text-body-sm text-ink-2 hover:bg-paper-2"
            >
              <ThemeGlyph size={16} />
              {theme === 'dark' ? '切换到浅色' : '切换到深色'}
            </button>
            <button
              type="button"
              onClick={openShortcuts}
              className="press flex w-full items-center gap-2 rounded-xl px-3 py-2 text-body-sm text-ink-2 hover:bg-paper-2"
            >
              <Keyboard size={16} />
              快捷键
              <kbd className="ml-auto rounded border border-line px-1 py-0.5 text-caption text-ink-3">?</kbd>
            </button>
            <p className="px-3 text-caption uppercase tracking-[0.16em] text-ink-3">v1.1</p>
          </div>
        </aside>
      ) : null}

      <div className={cn(isDesktop && 'pl-[236px]')}>
        <main
          className={cn(
            'safe-top mx-auto w-full max-w-[1180px] px-4',
            isRoot(view) ? 'pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-12' : 'pb-10',
            'sm:px-6',
          )}
        >
          {children}
        </main>

        {!isDesktop && isRoot(view) ? (
          <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/97 backdrop-blur-2xl shadow-edge">
            <div className="mx-auto grid max-w-[600px] grid-cols-5 px-1 pt-1.5">
              {TABS.map(({ key, label, Icon }) => {
                const isActive = active === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onRootChange(key)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'press relative flex flex-col items-center gap-1 rounded-xl py-1.5',
                      isActive ? 'text-accent' : 'text-ink-3',
                    )}
                  >
                    <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
                    <span className={cn('text-caption', isActive && 'font-medium')}>{label}</span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute bottom-0 h-1 w-1 rounded-full bg-accent transition-opacity duration-200',
                        isActive ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </button>
                )
              })}
            </div>
          </nav>
        ) : null}
      </div>
    </div>
  )
}

export type { RootKey }