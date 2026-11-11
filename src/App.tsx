import { useCallback, useEffect, useState } from 'react'
import type { TabKey, TripTemplate, View } from './lib/types'
import {
  NavContext,
  RefreshContext,
  SearchContext,
  ShortcutsContext,
  ToastContext,
} from './lib/app-context'
import { ensureReady } from './lib/repo'
import { scheduleAutoSync } from './lib/sync-engine'
import { startAutoCheckin } from './lib/autocheckin'
import { AppShell, type RootKey } from './components/AppShell'
import { SearchPalette } from './components/SearchPalette'
import { InstallBanner } from './components/InstallBanner'
import { ShortcutsSheet } from './components/ShortcutsSheet'
import { TripsPage } from './pages/TripsPage'
import { TripDetailPage } from './pages/TripDetailPage'
import { FootprintsPage } from './pages/FootprintsPage'
import { AlbumPage } from './pages/AlbumPage'
import { RecapPage } from './pages/RecapPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { ProfilePage } from './pages/ProfilePage'
import { TripEditor } from './pages/TripEditor'
import { MomentEditor } from './pages/MomentEditor'
import { ExpenseEditor } from './pages/ExpenseEditor'
import { FootprintEditor } from './pages/FootprintEditor'
import { PlanEditor } from './pages/PlanEditor'
import { SyncPage } from './pages/SyncPage'

const TABS: TabKey[] = ['plan', 'timeline', 'ledger', 'checklist', 'members']
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
    case 'recap':
      return { name: 'recap' }
    case 'expenses':
      return { name: 'expenses' }
    case 'profile':
      return { name: 'profile' }
    case 'sync':
      return { name: 'sync' }
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
      return '#/sync'
  }
}

function viewKey(view: View): string {
  switch (view.name) {
    case 'trip':
      return `trip:${view.id}:${view.tab}`
    case 'momentEditor':
      return `moment:${view.tripId}:${view.momentId ?? 'new'}`
    case 'expenseEditor':
      return `expense:${view.tripId}:${view.expenseId ?? 'new'}`
    case 'planEditor':
      return `plan:${view.tripId}:${view.planId ?? `d${view.dayIndex ?? 1}`}`
    case 'tripEditor':
      return `trip-editor:${view.id ?? 'new'}`
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
    if (window.history.length > 1) {
      window.history.back()
    } else {
      window.location.hash = '#/trips'
    }
  }, [])

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random()
    const tone: ToastItem['tone'] = /失败|错误|不能|无法/.test(message) ? 'warn' : 'ok'
    setToasts((previous) => [...previous.slice(-2), { id, message, tone }])
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((item) => item.id !== id))
    }, 2400)
  }, [])

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
      case 'recap':
        return <RecapPage />
      case 'expenses':
        return <ExpensesPage />
      case 'profile':
        return <ProfilePage />
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
        return <SyncPage />
    }
  }

  return (
    <RefreshContext.Provider value={{ tick, bump }}>
      <NavContext.Provider value={{ navigate, back }}>
        <ToastContext.Provider value={toast}>
          <SearchContext.Provider value={openSearch}>
            <ShortcutsContext.Provider value={openShortcuts}>
              {!online ? (
                <div className="fixed inset-x-0 top-0 z-[65] flex items-center justify-center gap-2 bg-ink/90 px-4 py-1.5 text-note text-paper backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                  离线模式 · 数据仍会保存在本机
                </div>
              ) : null}
              <AppShell view={view} onRootChange={(key) => navigate(ROOT_VIEW[key])}>
                <div key={viewKey(view)} className="view-enter">
                  {renderView()}
                </div>
              </AppShell>

              <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
              <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
              <InstallBanner />

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