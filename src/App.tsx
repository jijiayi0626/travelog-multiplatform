import { useCallback, useEffect, useState } from 'react'
import type { TabKey, View } from './lib/types'
import { NavContext, RefreshContext, ToastContext } from './lib/app-context'
import { ensureReady } from './lib/repo'
import { AppShell, type RootKey } from './components/AppShell'
import { TripsPage } from './pages/TripsPage'
import { TripDetailPage } from './pages/TripDetailPage'
import { FootprintsPage } from './pages/FootprintsPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { ProfilePage } from './pages/ProfilePage'
import { TripEditor } from './pages/TripEditor'
import { MomentEditor } from './pages/MomentEditor'
import { ExpenseEditor } from './pages/ExpenseEditor'
import { FootprintEditor } from './pages/FootprintEditor'
import { SyncPage } from './pages/SyncPage'

const TABS: TabKey[] = ['timeline', 'ledger', 'checklist', 'members']

function parseHash(): View {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [root, a = '', b = ''] = raw.split('/')
  switch (root) {
    case 'trip':
      return a
        ? { name: 'trip', id: a, tab: TABS.includes(b as TabKey) ? (b as TabKey) : 'timeline' }
        : { name: 'trips' }
    case 'trip-editor':
      return { name: 'tripEditor', id: a || undefined }
    case 'moment-editor':
      return { name: 'momentEditor', tripId: a, momentId: b || undefined }
    case 'expense-editor':
      return { name: 'expenseEditor', tripId: a, expenseId: b || undefined }
    case 'footprint-editor':
      return { name: 'footprintEditor' }
    case 'footprints':
      return { name: 'footprints' }
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
    case 'expenses':
      return '#/expenses'
    case 'profile':
      return '#/profile'
    case 'tripEditor':
      return view.id ? `#/trip-editor/${view.id}` : '#/trip-editor'
    case 'momentEditor':
      return `#/moment-editor/${view.tripId}${view.momentId ? `/${view.momentId}` : ''}`
    case 'expenseEditor':
      return `#/expense-editor/${view.tripId}${view.expenseId ? `/${view.expenseId}` : ''}`
    case 'footprintEditor':
      return '#/footprint-editor'
    case 'sync':
      return '#/sync'
  }
}

const ROOT_VIEW: Record<RootKey, View> = {
  trips: { name: 'trips' },
  footprints: { name: 'footprints' },
  expenses: { name: 'expenses' },
  profile: { name: 'profile' },
}

export default function App() {
  const [view, setView] = useState<View>(() => parseHash())
  const [ready, setReady] = useState(false)
  const [tick, setTick] = useState(0)
  const [toasts, setToasts] = useState<Array<{ id: number; message: string }>>([])

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
  }, [])

  const bump = useCallback(() => setTick((value) => value + 1), [])

  const navigate = useCallback((next: View) => {
    const hash = toHash(next)
    if (window.location.hash === hash) {
      setView(next)
      return
    }
    window.location.hash = hash
  }, [])

  const back = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      window.location.hash = '#/trips'
    }
  }, [])

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random()
    setToasts((previous) => [...previous.slice(-2), { id, message }])
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((item) => item.id !== id))
    }, 2400)
  }, [])

  const renderView = () => {
    if (!ready) {
      return <StartupPlaceholder />
    }
    switch (view.name) {
      case 'trips':
        return <TripsPage />
      case 'trip':
        return <TripDetailPage tripId={view.id} tab={view.tab} />
      case 'footprints':
        return <FootprintsPage />
      case 'expenses':
        return <ExpensesPage />
      case 'profile':
        return <ProfilePage />
      case 'tripEditor':
        return <TripEditor id={view.id} />
      case 'momentEditor':
        return <MomentEditor tripId={view.tripId} momentId={view.momentId} />
      case 'expenseEditor':
        return <ExpenseEditor tripId={view.tripId} expenseId={view.expenseId} />
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
          <AppShell
            view={view}
            onRootChange={(key) => navigate(ROOT_VIEW[key])}
          >
            {renderView()}
          </AppShell>

          <div
            className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6"
            aria-live="polite"
          >
            {toasts.map((item) => (
              <div
                key={item.id}
                className="fade-in rounded-full border border-line bg-ink px-4 py-2 text-[12.5px] text-paper shadow-[var(--shadow-float)]"
              >
                {item.message}
              </div>
            ))}
          </div>
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