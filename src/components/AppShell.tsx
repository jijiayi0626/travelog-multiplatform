import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  MapPinLine,
  MapTrifold,
  Monitor,
  Moon,
  Sun,
  UserCircle,
  Wallet,
} from '@phosphor-icons/react'
import type { View } from '../lib/types'
import { cn } from '../lib/cn'
import { useIsDesktop } from '../lib/hooks'
import { currentTheme, setThemeMode, subscribeSystemTheme } from '../lib/theme'

const TABS = [
  { key: 'trips', label: '行程', Icon: MapTrifold },
  { key: 'footprints', label: '足迹', Icon: MapPinLine },
  { key: 'expenses', label: '账本', Icon: Wallet },
  { key: 'profile', label: '我的', Icon: UserCircle },
] as const

type RootKey = (typeof TABS)[number]['key']

function rootOf(view: View): RootKey {
  switch (view.name) {
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
  return view.name === 'trips' || view.name === 'footprints' || view.name === 'expenses' || view.name === 'profile'
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
  const active = rootOf(view)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => currentTheme())

  useEffect(() => {
    return subscribeSystemTheme(() => setTheme(currentTheme()))
  }, [])

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
              <span className="block text-[15px] font-semibold leading-tight tracking-tight text-ink">
                旅记
              </span>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-ink-3">
                Travelog
              </span>
            </span>
          </div>

          <nav className="mt-8 flex flex-col gap-1">
            {TABS.map(({ key, label, Icon }) => {
              const isActive = active === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onRootChange(key)}
                  className={cn(
                    'press flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors',
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
              <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
                <Monitor size={13} />
                本地模式
              </p>
              <p className="mt-1 text-[11px] leading-4 text-ink-3">
                数据保存在本机浏览器，接入后端即可多端同步。
              </p>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="press flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] text-ink-2 hover:bg-paper-2"
            >
              <ThemeGlyph size={16} />
              {theme === 'dark' ? '切换到浅色' : '切换到深色'}
            </button>
            <p className="px-3 text-[10px] uppercase tracking-[0.16em] text-ink-3">v1.0</p>
          </div>
        </aside>
      ) : null}

      <div className={cn(isDesktop && 'pl-[236px]')}>
        <main
          className={cn(
            'safe-top mx-auto w-full max-w-[1180px] px-4',
            isRoot(view) ? 'pb-[calc(84px+env(safe-area-inset-bottom))] lg:pb-12' : 'pb-10',
            'sm:px-6',
          )}
        >
          {children}
        </main>

        {!isDesktop && isRoot(view) ? (
          <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/88 backdrop-blur-xl">
            <div className="mx-auto grid max-w-[560px] grid-cols-4 px-2 pt-1.5">
              {TABS.map(({ key, label, Icon }) => {
                const isActive = active === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onRootChange(key)}
                    className={cn(
                      'press flex flex-col items-center gap-1 rounded-xl py-1.5',
                      isActive ? 'text-accent' : 'text-ink-3',
                    )}
                  >
                    <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
                    <span className={cn('text-[10px]', isActive && 'font-medium')}>{label}</span>
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