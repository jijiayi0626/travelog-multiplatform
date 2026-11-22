import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Clipboard } from '@capacitor/clipboard'
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
import {
  useI18n,
  useNav,
  useRefresh,
  useSearch,
  useShortcuts,
  useToast,
} from '../lib/app-context'
import { isSignedIn, joinTripByCode } from '../lib/cloud'
import { getTrip } from '../lib/repo'
import { runSync } from '../lib/sync-engine'
import { isNative } from '../lib/native'
import { ConfirmDialog } from './ui'

const TABS = [
  { key: 'trips', labelKey: 'nav.trips', Icon: MapTrifold },
  { key: 'album', labelKey: 'nav.album', Icon: Images },
  { key: 'footprints', labelKey: 'nav.footprints', Icon: MapPinLine },
  { key: 'expenses', labelKey: 'nav.expenses', Icon: Wallet },
  { key: 'profile', labelKey: 'nav.profile', Icon: UserCircle },
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
    case 'cloud':
    case 'admin':
    case 'about':
    case 'download':
    case 'changelog':
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
    view.name === 'profile' ||
    view.name === 'sync' ||
    view.name === 'cloud' ||
    view.name === 'admin'
  )
}

const LAST_CLIPBOARD_INVITE = 'travelog.lastClipboardInvite'

/** 剪贴板里可能是 6 位邀请码，也可能是带 #/share/CODE 的分享链接 */
function inviteCodeFromClipboard(text: string): string | null {
  const value = text.trim()
  if (!value) return null
  const link = value.match(/#\/share\/([A-Za-z0-9]{6})(?:[/?#]|$)/)
  if (link) return link[1].toUpperCase()
  if (/^[A-Za-z0-9]{6}$/.test(value)) return value.toUpperCase()
  return null
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
  const nav = useNav()
  const { bump } = useRefresh()
  const toast = useToast()
  const { t, tr, lang, setLang } = useI18n()
  const active = rootOf(view)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => currentTheme())
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const viewRef = useRef(view)
  const clipboardBusy = useRef(false)

  useEffect(() => subscribeSystemTheme(() => setTheme(currentTheme())), [])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  // 启动与回到前台时读一次剪贴板：识别到邀请码就让用户确认加入。
  // 读取失败（网页无权限等）静默忽略，不打扰正常使用。
  useEffect(() => {
    let disposed = false

    const checkClipboard = async () => {
      if (disposed || clipboardBusy.current) return
      if (document.visibilityState !== 'visible') return
      if (!isSignedIn()) return
      try {
        if (localStorage.getItem('travelog.clipboardInvite') === '0') return
      } catch {
        /* 隐私模式读不到时保持默认开启 */
      }
      clipboardBusy.current = true
      try {
        let text = ''
        if (isNative()) {
          const result = await Clipboard.read()
          text = result.value ?? ''
        } else {
          if (!navigator.clipboard?.readText) return
          text = await navigator.clipboard.readText()
        }
        const code = inviteCodeFromClipboard(text)
        if (!code || disposed) return

        let last: string | null = null
        try {
          last = localStorage.getItem(LAST_CLIPBOARD_INVITE)
        } catch {
          /* 隐私模式忽略 */
        }
        if (last === code) return

        const current = viewRef.current
        if (current.name === 'trip') {
          const currentTrip = await getTrip(current.id)
          if (disposed) return
          if ((currentTrip?.inviteCode ?? '').toUpperCase() === code) return
        }
        setInviteCode(code)
      } catch {
        /* 读不到剪贴板就跳过 */
      } finally {
        clipboardBusy.current = false
      }
    }

    void checkClipboard()

    if (isNative()) {
      let remove: (() => void) | null = null
      void CapacitorApp.addListener('appStateChange', (state) => {
        if (state.isActive) void checkClipboard()
      }).then((listener) => {
        if (disposed) void listener.remove()
        else remove = () => void listener.remove()
      })
      return () => {
        disposed = true
        remove?.()
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkClipboard()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const rememberInvite = (code: string) => {
    try {
      localStorage.setItem(LAST_CLIPBOARD_INVITE, code)
    } catch {
      /* 隐私模式忽略 */
    }
  }

  const joinDetectedTrip = async (code: string) => {
    try {
      const result = await joinTripByCode(code)
      await runSync().catch(() => null)
      bump()
      nav.navigate({ name: 'trip', id: result.tripId, tab: 'plan' })
      toast(tr('已加入「{title}」', { title: result.title || result.owner }))
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('加入失败'))
    }
  }

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
              <span className="block text-body-lg font-semibold leading-tight tracking-tight text-ink">{tr('旅记')}</span>
              <span className="block text-caption uppercase tracking-[0.18em] text-ink-3">Travelog</span>
            </span>
          </div>

          <button
            type="button"
            onClick={openSearch}
            className="press mt-6 flex w-full items-center gap-2 rounded-xl border border-line bg-paper-2/60 px-3 py-2 text-left text-body-sm text-ink-3 hover:text-ink"
          >
            <MagnifyingGlass size={15} />
            <span className="flex-1">{t('nav.search')}</span>
            <kbd className="rounded border border-line px-1 py-0.5 text-caption">⌘K</kbd>
          </button>

          <nav className="mt-4 flex flex-col gap-1">
            {TABS.map(({ key, labelKey, Icon }) => {
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
                  {t(labelKey)}
                </button>
              )
            })}
          </nav>

          <div className="mt-auto space-y-3">
            <div className="rounded-xl border border-line bg-paper-2/60 p-3">
              <p className="text-note font-medium text-ink-2">{tr('本地优先')}</p>
              <p className="mt-1 text-caption leading-4 text-ink-3">
                {tr('日程、照片与账目都存在本机。导出 JSON 就能带走全部数据。')}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="press flex w-full items-center gap-2 rounded-xl px-3 py-2 text-body-sm text-ink-2 hover:bg-paper-2"
            >
              <ThemeGlyph size={16} />
              {theme === 'dark' ? tr('切换到浅色') : tr('切换到深色')}
            </button>
            <button
              type="button"
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className="press flex w-full items-center gap-2 rounded-xl px-3 py-2 text-body-sm text-ink-2 hover:bg-paper-2"
            >
              <span className="text-[13px] font-medium">{lang === 'zh' ? '中' : 'EN'}</span>
              {lang === 'zh' ? '切换为 English' : '切换为中文'}
            </button>
            <button
              type="button"
              onClick={openShortcuts}
              className="press flex w-full items-center gap-2 rounded-xl px-3 py-2 text-body-sm text-ink-2 hover:bg-paper-2"
            >
              <Keyboard size={16} />
              {tr('快捷键')}
              <kbd className="ml-auto rounded border border-line px-1 py-0.5 text-caption text-ink-3">?</kbd>
            </button>
            <p className="px-3 text-caption uppercase tracking-[0.16em] text-ink-3">{`v${__APP_VERSION__}`}</p>
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
              {TABS.map(({ key, labelKey, Icon }) => {
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
                    <span className={cn('text-caption', isActive && 'font-medium')}>{t(labelKey)}</span>
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

      <ConfirmDialog
        open={inviteCode !== null}
        title={tr('加入行程')}
        message={
          inviteCode
            ? tr('检测到邀请码 {code}，要加入这个行程吗？', { code: inviteCode })
            : ''
        }
        confirmText={tr('加入')}
        tone="accent"
        onConfirm={() => {
          if (inviteCode) void joinDetectedTrip(inviteCode)
        }}
        onClose={() => {
          if (inviteCode) rememberInvite(inviteCode)
          setInviteCode(null)
        }}
      />
    </div>
  )
}

export type { RootKey }