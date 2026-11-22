import { ArrowLeft, CloudCheck, Images, ShieldCheck, UserCircle } from '@phosphor-icons/react'
import { useI18n, useNav } from '../lib/app-context'
import { IconButton } from '../components/ui'
import { cn } from '../lib/cn'
import { ProfilePage } from './ProfilePage'
import { SyncPage } from './SyncPage'
import { CloudGalleryPage } from './CloudGalleryPage'
import { AdminPage } from './AdminPage'

export type ConsoleTab = 'user' | 'sync' | 'cloud' | 'admin'

type TabItem = {
  key: ConsoleTab
  label: string
  icon: typeof UserCircle
}

const TABS: TabItem[] = [
  { key: 'user', label: '我的', icon: UserCircle },
  { key: 'sync', label: '同步', icon: CloudCheck },
  { key: 'cloud', label: '云相册', icon: Images },
  { key: 'admin', label: '管理', icon: ShieldCheck },
]

/**
 * 控制台：把「我的 / 云同步 / 云相册 / 管理后台」收敛到一个页面里，
 * 用顶部标签切换，不再依赖散落在各处的入口。
 */
export function ConsolePage({
  tab,
  showAdmin,
  mode,
}: {
  tab: ConsoleTab
  showAdmin: boolean
  mode?: 'login' | 'register'
}) {
  const nav = useNav()
  const { tr } = useI18n()
  const activeTab: ConsoleTab = tab === 'admin' && !showAdmin ? 'user' : tab
  const tabs = TABS.filter((item) => item.key !== 'admin' || showAdmin)

  const go = (key: ConsoleTab) => {
    if (key === activeTab) return
    nav.navigate({ name: key === 'user' ? 'profile' : key })
  }

  return (
    <div className="pt-3">
      <div className="flex items-center gap-2.5">
        <IconButton label={tr('返回')} onClick={() => nav.back()}>
          <ArrowLeft size={18} />
        </IconButton>
        <div className="min-w-0">
          <p className="text-caption uppercase tracking-[0.16em] text-ink-3">Console</p>
          <h1 className="truncate text-title font-semibold tracking-tight text-ink">
            {tr('控制台')}
          </h1>
        </div>
      </div>

      <nav
        className="sticky top-0 z-20 -mx-4 mt-3 border-b border-line bg-paper/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6"
        aria-label={tr('控制台分区')}
      >
        <div
          className="grid gap-1 rounded-2xl bg-paper-2 p-1"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((item) => {
            const Glyph = item.icon
            const active = item.key === activeTab
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => go(item.key)}
                className={cn(
                  'press flex h-9 items-center justify-center gap-1.5 rounded-xl text-caption transition-colors',
                  active ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
                )}
              >
                <Glyph size={15} weight={active ? 'fill' : 'regular'} />
                {tr(item.label)}
              </button>
            )
          })}
        </div>
      </nav>

      <div className="mt-4">
        {activeTab === 'user' && <ProfilePage embedded />}
        {activeTab === 'sync' && <SyncPage embedded mode={mode} />}
        {activeTab === 'cloud' && <CloudGalleryPage embedded />}
        {activeTab === 'admin' && <AdminPage embedded />}
      </div>
    </div>
  )
}
