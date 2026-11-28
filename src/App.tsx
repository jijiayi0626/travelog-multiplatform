import { useCallback, useContext, useEffect, useState } from 'react'
import { LockKey } from '@phosphor-icons/react'
import type { TabKey, TripTemplate, View } from './lib/types'
import {
  I18nContext,
  NavContext,
  RefreshContext,
  SearchContext,
  ShortcutsContext,
  ToastContext,
} from './lib/app-context'
import { getLang, setLang as persistLang, translate, translateText, type Lang } from './lib/i18n'
import { ensureReady } from './lib/repo'
import { hasPendingLocalChanges, runSync, scheduleAutoSync } from './lib/sync-engine'
import { getCloudConfig } from './lib/cloud'
import { startAutoCheckin } from './lib/autocheckin'
import { AppShell, type RootKey } from './components/AppShell'
import { SearchPalette } from './components/SearchPalette'
import { ShortcutsSheet } from './components/ShortcutsSheet'
import { Onboarding } from './components/Onboarding'
import { NewCityDialog } from './components/NewCityDialog'
import { AIJobHub, AIPaywall } from './components/AIJobHub'
import { TripsPage } from './pages/TripsPage'
import { TripDetailPage } from './pages/TripDetailPage'
import { FootprintsPage } from './pages/FootprintsPage'
import { AlbumPage } from './pages/AlbumPage'
import { ConsolePage } from './pages/ConsolePage'
import { RecapPage } from './pages/RecapPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { TripEditor } from './pages/TripEditor'
import { MomentEditor } from './pages/MomentEditor'
import { ExpenseEditor } from './pages/ExpenseEditor'
import { FootprintEditor } from './pages/FootprintEditor'
import { PlanEditor } from './pages/PlanEditor'
import { AboutPage } from './pages/AboutPage'
import { DownloadPage } from './pages/DownloadPage'
import { OcrModelPage } from './pages/OcrModelPage'
import { ChangelogPage } from './pages/ChangelogPage'
import { PassportPage } from './pages/PassportPage'
import { MonthlyPage } from './pages/MonthlyPage'
import { PersonaPage } from './pages/PersonaPage'
import { EmergencyPage } from './pages/EmergencyPage'
import { SharePage } from './pages/SharePage'
import { UpdatePrompt } from './components/UpdatePrompt'
import { isDevMode, subscribeDevMode } from './lib/dev-mode'

const TABS: TabKey[] = ['plan', 'timeline', 'ledger', 'checklist', 'members', 'collab']
const TEMPLATES: TripTemplate[] = ['blank', 'city', 'beach', 'road', 'ski']

function parseHash(): View {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [root, a = '', b = ''] = raw.split('/')
  switch (root) {
    case 'trip':
      return a
        ? { name: 'trip', id: a, tab: TABS.includes(b as TabKey) ? (b as TabKey) : 'plan' }
        : { name: 'trips' }
    case 'trip-editor':
      if (a === '~') {
        return {
          name: 'tripEditor',
          template: TEMPLATES.includes(b as TripTemplate) ? (b as TripTemplate) : undefined,
        }
      }
      return { name: 'tripEditor', id: a || undefined }
    case 'moment-editor':
      return { name: 'momentEditor', tripId: a, momentId: b || undefined }
    case 'expense-editor':
      return { name: 'expenseEditor', tripId: a, expenseId: b || undefined }
    case 'plan-editor': {
      const dayMatch = b.match(/^~day-(\d+)$/)
      if (dayMatch) return { name: 'planEditor', tripId: a, dayIndex: Number(dayMatch[1]) }
      return { name: 'planEditor', tripId: a, planId: b || undefined }
    }
    case 'footprint-editor':
      return { name: 'footprintEditor' }
    case 'footprints':
      return { name: 'footprints' }
    case 'album':
      return { name: 'album' }
    case 'cloud':
      return { name: 'cloud' }
    case 'recap':
      return { name: 'recap' }
    case 'expenses':
      return { name: 'expenses' }
    case 'profile':
      return { name: 'profile' }
    case 'sync':
      return a === 'login' || a === 'register' ? { name: 'sync', mode: a } : { name: 'sync' }
    case 'about':
      return { name: 'about' }
    case 'download':
      return { name: 'download' }
    case 'ocr-model':
      return { name: 'ocrModel' }
    case 'changelog':
      return { name: 'changelog' }
    case 'passport':
      return { name: 'passport' }
    case 'monthly':
      return { name: 'monthly' }
    case 'persona':
      return { name: 'persona' }
    case 'emergency':
      return { name: 'emergency' }
    case 'admin':
      return { name: 'admin' }
    case 'share':
      return a ? { name: 'share', code: a } : { name: 'trips' }
    default:
      return { name: 'trips' }
  }
}

function toHash(view: View): string {
  switch (view.name) {
    case 'trips':
      return '#/trips'
    case 'trip':
      return `#/trip/${view.id}/${view.tab}`
    case 'footprints':
      return '#/footprints'
    case 'album':
      return '#/album'
    case 'cloud':
      return '#/cloud'
    case 'recap':
      return '#/recap'
    case 'expenses':
      return '#/expenses'
    case 'profile':
      return '#/profile'
    case 'tripEditor':
      if (view.id) return `#/trip-editor/${view.id}`
      return view.template ? `#/trip-editor/~/${view.template}` : '#/trip-editor'
    case 'momentEditor':
      return `#/moment-editor/${view.tripId}${view.momentId ? `/${view.momentId}` : ''}`
    case 'expenseEditor':
      return `#/expense-editor/${view.tripId}${view.expenseId ? `/${view.expenseId}` : ''}`
    case 'planEditor':
      if (view.planId) return `#/plan-editor/${view.tripId}/${view.planId}`
      return view.dayIndex ? `#/plan-editor/${view.tripId}/~day-${view.dayIndex}` : `#/plan-editor/${view.tripId}`
    case 'footprintEditor':
      return '#/footprint-editor'
    case 'sync':
      return view.mode ? `#/sync/${view.mode}` : '#/sync'
    case 'about':
      return '#/about'
    case 'download':
      return '#/download'
    case 'ocrModel':
      return '#/ocr-model'
    case 'changelog':
      return '#/changelog'
    case 'passport':
      return '#/passport'
    case 'monthly':
      return '#/monthly'
    case 'persona':
      return '#/persona'
    case 'emergency':
      return '#/emergency'
    case 'admin':
      return '#/admin'
    case 'share':
      return `#/share/${view.code}`
  }
}

function viewKey(view: View): string {
  switch (view.name) {
    case 'trip':
      // 只按旅程 id：切换日程/时间线/账本等子 Tab 时不重挂载，避免整页刷新
      return `trip:${view.id}`
    case 'momentEditor':
      return `moment:${view.tripId}:${view.momentId ?? 'new'}`
    case 'expenseEditor':
      return `expense:${view.tripId}:${view.expenseId ?? 'new'}`
    case 'planEditor':
      return `plan:${view.tripId}:${view.planId ?? `d${view.dayIndex ?? 1}`}`
    case 'tripEditor':
      return `trip-editor:${view.id ?? 'new'}`
    case 'share':
      return `share:${view.code}`
    default:
      return view.name
  }
}

const ROOT_VIEW: Record<RootKey, View> = {
  trips: { name: 'trips' },
  album: { name: 'album' },
  footprints: { name: 'footprints' },
  expenses: { name: 'expenses' },
  profile: { name: 'profile' },
}

interface ToastItem {
  id: number
  message: string
  tone: 'ok' | 'warn'
}

export default function App() {
  const [view, setView] = useState<View>(() => parseHash())
  const [ready, setReady] = useState(false)
  const [tick, setTick] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [lang, setLangState] = useState<Lang>(() => getLang())
  const [devMode, setDevModeState] = useState(() => isDevMode())

  useEffect(() => subscribeDevMode(() => setDevModeState(isDevMode())), [])

  useEffect(() => {
    const onHashChange = () => setView(parseHash())
    window.addEventListener('hashchange', onHashChange)
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#/trips')
    }
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    ensureReady()
      .then(() => setReady(true))
      .catch(() => setReady(true))
    const stopCheckin = startAutoCheckin()
    return () => {
      stopCheckin()
    }
  }, [])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // 自动同步：启动、回到前台、联网、定时各检查一次。
  // 默认实时（约 20 秒）；没有本地改动时只拉取，间隔与仅 Wi-Fi 可在「我的」里设置。
  useEffect(() => {
    let stopped = false
    let lastRun = 0

    const isWifi = () => {
      const conn = (navigator as Navigator & { connection?: { type?: string } }).connection
      if (!conn?.type) return true // WebView 多数不暴露网络类型，判断不了时不阻塞
      return conn.type === 'wifi' || conn.type === 'ethernet'
    }

    const syncIfDue = (opts: { force?: boolean; ignoreToggle?: boolean; minGapMs?: number } = {}) => {
      if (stopped || document.visibilityState !== 'visible') return
      const config = getCloudConfig()
      if (!config.token || (!opts.ignoreToggle && !config.autoSync) || !navigator.onLine) return
      if (!opts.ignoreToggle && config.wifiOnly && !isWifi()) return
      const now = Date.now()
      if (!opts.force && now - lastRun < (opts.minGapMs ?? 60_000)) return
      lastRun = now
      void runSync({ pullOnly: !hasPendingLocalChanges() }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        window.dispatchEvent(new CustomEvent('travelog:sync-error', { detail: { message } }))
      })
    }

    // 0 表示实时：约 20 秒检查一次，配合修改后的 1.5 秒延迟同步
    const intervalMs = () => {
      const minutes = getCloudConfig().syncIntervalMinutes
      if (!minutes) return 20_000
      return Math.min(Math.max(minutes, 1), 120) * 60_000
    }

    syncIfDue({ force: true })
    const timer = window.setInterval(() => syncIfDue({ minGapMs: intervalMs() }), 10_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncIfDue()
    }
    // 登录成功或用户主动要求时，不受自动同步开关 / 仅 Wi-Fi 限制
    const onRequest = () => syncIfDue({ force: true, ignoreToggle: true })
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', onVisible)
    window.addEventListener('travelog:sync-now', onRequest)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onVisible)
      window.removeEventListener('travelog:sync-now', onRequest)
    }
  }, [])

  const changeLang = useCallback((next: Lang) => {
    persistLang(next)
    setLangState(next)
  }, [])

  const bump = useCallback(() => {
    setTick((value) => value + 1)
    scheduleAutoSync()
  }, [])
  const openSearch = useCallback(() => setSearchOpen(true), [])
  const openShortcuts = useCallback(() => setShortcutsOpen(true), [])

  const navigate = useCallback((next: View) => {
    const hash = toHash(next)
    if (window.location.hash === hash) {
      setView(next)
      return
    }
    window.location.hash = hash
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (event.key === '/' && !editing) {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (event.key === '?' && !editing) {
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }
      if (event.key.toLowerCase() === 'n' && !editing && !event.metaKey && !event.ctrlKey) {
        navigate({ name: 'tripEditor' })
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setShortcutsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const back = useCallback(() => {
    // SPA 里 history.length 始终 > 1，直接 back 会落到 about:blank
    const before = window.location.href
    window.history.back()
    window.setTimeout(() => {
      if (window.location.href === before) {
        window.location.hash = '#/trips'
      }
    }, 250)
  }, [])

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random()
    const tone: ToastItem['tone'] = /失败|错误|不能|无法/.test(message) ? 'warn' : 'ok'
    setToasts((previous) => [...previous.slice(-2), { id, message, tone }])
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((item) => item.id !== id))
    }, 2400)
  }, [])

  useEffect(() => {
    const onQueued = () => {
      toast(translateText(lang, 'AI 已在后台执行，可以离开此页面，完成后在右上角查看'))
    }
    window.addEventListener('travelog:ai-queued', onQueued)
    return () => window.removeEventListener('travelog:ai-queued', onQueued)
  }, [lang, toast])

  // 同步结果反馈：有远端变更才刷新界面；失败提示做 60 秒去重，避免自动同步刷屏
  useEffect(() => {
    let lastErrorAt = 0
    const onDone = (event: Event) => {
      const detail = (event as CustomEvent<{ pulled?: number; removed?: number }>).detail
      if ((detail?.pulled ?? 0) > 0 || (detail?.removed ?? 0) > 0) {
        setTick((value) => value + 1)
      }
    }
    const onError = (event: Event) => {
      const now = Date.now()
      if (now - lastErrorAt < 60_000) return
      const message = (event as CustomEvent<{ message?: string }>).detail?.message
      if (!message) return
      lastErrorAt = now
      toast(message.includes('离线') ? '当前离线，恢复网络后会自动继续同步' : `同步失败：${message}`)
    }
    window.addEventListener('travelog:sync-done', onDone)
    window.addEventListener('travelog:sync-error', onError)
    return () => {
      window.removeEventListener('travelog:sync-done', onDone)
      window.removeEventListener('travelog:sync-error', onError)
    }
  }, [toast])

  const renderView = () => {
    if (!ready) return <StartupPlaceholder />
    switch (view.name) {
      case 'trips':
        return <TripsPage />
      case 'trip':
        return <TripDetailPage tripId={view.id} tab={view.tab} />
      case 'footprints':
        return <FootprintsPage />
      case 'album':
        return <AlbumPage />
      case 'cloud':
        return <ConsolePage tab="cloud" showAdmin={devMode} />
      case 'recap':
        return <RecapPage />
      case 'expenses':
        return <ExpensesPage />
      case 'profile':
        return <ConsolePage tab="user" showAdmin={devMode} />
      case 'tripEditor':
        return <TripEditor id={view.id} template={view.template} />
      case 'momentEditor':
        return <MomentEditor tripId={view.tripId} momentId={view.momentId} />
      case 'expenseEditor':
        return <ExpenseEditor tripId={view.tripId} expenseId={view.expenseId} />
      case 'planEditor':
        return <PlanEditor tripId={view.tripId} planId={view.planId} dayIndex={view.dayIndex} />
      case 'footprintEditor':
        return <FootprintEditor />
      case 'sync':
        return <ConsolePage tab="sync" showAdmin={devMode} mode={view.mode} />
      case 'about':
        return <AboutPage />
      case 'download':
        return <DownloadPage />
      case 'ocrModel':
        return <OcrModelPage />
      case 'changelog':
        return <ChangelogPage />
      case 'passport':
        return <PassportPage />
      case 'monthly':
        return <MonthlyPage />
      case 'persona':
        return <PersonaPage />
      case 'emergency':
        return <EmergencyPage />
      case 'admin':
        return devMode ? (
          <ConsolePage tab="admin" showAdmin />
        ) : (
          <DevModeRequired onOpenAbout={() => navigate({ name: 'about' })} />
        )
      case 'share':
        return <SharePage code={view.code} />
    }
  }

  return (
    <I18nContext.Provider
      value={{
        lang,
        setLang: changeLang,
        t: (key) => translate(lang, key),
        tr: (zh, vars) => translateText(lang, zh, vars),
      }}
    >
    <RefreshContext.Provider value={{ tick, bump }}>
      <NavContext.Provider value={{ navigate, back }}>
        <ToastContext.Provider value={toast}>
          <SearchContext.Provider value={openSearch}>
            <ShortcutsContext.Provider value={openShortcuts}>
              {!online ? (
                <div className="fixed inset-x-0 top-0 z-[65] flex items-center justify-center gap-2 bg-ink/90 px-4 py-1.5 text-note text-paper backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                  {translateText(lang, '离线模式 · 数据仍会保存在本机')}
                </div>
              ) : null}
              <AppShell view={view} onRootChange={(key) => navigate(ROOT_VIEW[key])}>
                <div key={viewKey(view)} className="view-enter">
                  {renderView()}
                </div>
              </AppShell>

              <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
              <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
              <Onboarding />
              <NewCityDialog />
              <UpdatePrompt />
              <AIJobHub />
              <AIPaywall />

              <div
                className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6"
                aria-live="polite"
              >
                {toasts.map((item) => (
                  <div
                    key={item.id}
                    className="fade-in flex items-center gap-2 rounded-full border border-line bg-ink px-4 py-2 text-body-sm text-paper shadow-[var(--shadow-float)]"
                  >
                    <span
                      className={
                        item.tone === 'warn'
                          ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-warn'
                          : 'h-1.5 w-1.5 shrink-0 rounded-full bg-[#5eead4]'
                      }
                    />
                    {item.message}
                  </div>
                ))}
              </div>
            </ShortcutsContext.Provider>
          </SearchContext.Provider>
        </ToastContext.Provider>
      </NavContext.Provider>
    </RefreshContext.Provider>
    </I18nContext.Provider>
  )
}

function StartupPlaceholder() {
  return (
    <div className="space-y-4 pt-6">
      <div className="skeleton h-8 w-40" />
      <div className="skeleton h-4 w-64" />
      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <div className="skeleton h-[196px] rounded-[1.5rem]" />
        <div className="skeleton h-[196px] rounded-[1.5rem]" />
      </div>
    </div>
  )
}

function DevModeRequired({ onOpenAbout }: { onOpenAbout: () => void }) {
  const { tr } = useContext(I18nContext)
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface text-ink-2">
        <LockKey size={24} />
      </span>
      <div>
        <p className="text-title font-semibold tracking-tight text-ink">{tr('未开启开发者模式')}</p>
        <p className="mx-auto mt-2 max-w-[36ch] text-body-sm leading-6 text-ink-3">
          {tr('管理面板入口已移至「关于旅记」的开发者模式。连续点击版本号 7 次即可开启。')}
        </p>
      </div>
      <button type="button" className="btn-primary h-10 px-5" onClick={onOpenAbout}>
        {tr('前往关于旅记')}
      </button>
    </div>
  )
}