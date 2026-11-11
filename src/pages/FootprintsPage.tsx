import { useMemo, useState } from 'react'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { ListBullets, MagnifyingGlass, MapPin, MapTrifold, Plus } from '@phosphor-icons/react'
import type { Footprint } from '../lib/types'
import { deleteFootprint, listFootprints } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useNav, useRefresh, useSearch, useToast } from '../lib/app-context'
import { summarizeVisits, type ProvinceVisit } from '../lib/province'
import { cn } from '../lib/cn'
import { FootprintRow } from '../components/cards'
import { ChinaMap } from '../components/ChinaMap'
import { WorldMap } from '../components/WorldMap'
import { ConfirmDialog, EmptyState, IconButton, Sheet, SkeletonList } from '../components/ui'
import { EmptyArt } from '../components/EmptyArt'

export function FootprintsPage() {
  const nav = useNav()
  const toast = useToast()
  const openSearch = useSearch()
  const { bump } = useRefresh()
  const { data: footprints, loading } = useLoader(() => listFootprints(), [] as Footprint[], 'footprints')
  const [pendingDelete, setPendingDelete] = useState<Footprint | null>(null)
  const [mode, setMode] = useState<'china' | 'map' | 'list'>('china')
  const [selected, setSelected] = useState<ProvinceVisit | null>(null)

  const visits = useMemo(() => summarizeVisits(footprints), [footprints])
  const visitedProvinceCount = visits.visited.size

  const cityStats = useMemo(() => {
    const counter = new Map<string, number>()
    for (const item of footprints) {
      if (!item.city) continue
      counter.set(item.city, (counter.get(item.city) ?? 0) + 1)
    }
    return [...counter.entries()].sort((a, b) => b[1] - a[1])
  }, [footprints])

  const openMap = async (footprint: Footprint) => {
    const url = `https://www.openstreetmap.org/?mlat=${footprint.latitude}&mlon=${footprint.longitude}#map=14/${footprint.latitude}/${footprint.longitude}`
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url })
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 pt-4">
        <div className="min-w-0">
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Footprints</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
            我的足迹
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton label="搜索" onClick={openSearch}>
            <MagnifyingGlass size={17} />
          </IconButton>
          <button type="button" className="btn-primary" onClick={() => nav.navigate({ name: 'footprintEditor' })}>
            <Plus size={16} weight="bold" />
            打卡
          </button>
        </div>
      </header>

      <div className="flex divide-x divide-line border-y border-line py-3.5">
        <div className="min-w-0 flex-1 pr-3">
          <p className="text-caption tracking-wide text-ink-3">地点</p>
          <p className="mt-1 text-title font-semibold tabular-nums tracking-tight text-ink">
            {footprints.length}
            <span className="ml-0.5 text-caption font-normal text-ink-3">个</span>
          </p>
        </div>
        <div className="min-w-0 flex-1 px-3">
          <p className="text-caption tracking-wide text-ink-3">省份</p>
          <p className="mt-1 text-title font-semibold tabular-nums tracking-tight text-ink">
            {visitedProvinceCount}
            <span className="ml-0.5 text-caption font-normal text-ink-3">个</span>
          </p>
        </div>
        <div className="min-w-0 flex-1 pl-3">
          <p className="text-caption tracking-wide text-ink-3">最近</p>
          <p className="mt-1 truncate text-body-sm font-medium text-ink">
            {footprints[0]?.placeName ?? '—'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex shrink-0 gap-1 rounded-full border border-line bg-paper-2 p-1">
          <button
            type="button"
            onClick={() => setMode('china')}
            className={cn(
              'press flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-note',
              mode === 'china' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3',
            )}
          >
            <MapPin size={14} />
            中国
          </button>
          <button
            type="button"
            onClick={() => setMode('map')}
            className={cn(
              'press flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-note',
              mode === 'map' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3',
            )}
          >
            <MapTrifold size={14} />
            星图
          </button>
          <button
            type="button"
            onClick={() => setMode('list')}
            className={cn(
              'press flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-note',
              mode === 'list' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3',
            )}
          >
            <ListBullets size={14} />
            列表
          </button>
        </div>
        {cityStats.length > 0 && mode !== 'china' ? (
          <div className="hide-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {cityStats.slice(0, 8).map(([city, count]) => (
              <span
                key={city}
                className="shrink-0 rounded-full border border-line px-2.5 py-1 text-caption text-ink-3"
              >
                {city} · {count}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {loading ? (
        <SkeletonList rows={3} />
      ) : footprints.length === 0 ? (
        <EmptyState
          icon={<EmptyArt variant="pin" />}
          title="还没有足迹"
          hint="到过一个地方，就打卡留个坐标。之后可以在地图上回看。"
          action={
            <button
              type="button"
              className="btn-primary mt-1"
              onClick={() => nav.navigate({ name: 'footprintEditor' })}
            >
              <Plus size={15} weight="bold" />
              打卡第一个地点
            </button>
          }
        />
      ) : mode === 'china' ? (
        <div className="space-y-3">
          <ChinaMap visits={visits.visited} onSelect={setSelected} />
          {visits.visited.size > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {[...visits.visited.values()]
                .sort((a, b) => b.places.length - a.places.length)
                .map((visit) => (
                  <button
                    key={visit.short}
                    type="button"
                    onClick={() => setSelected(visit)}
                    className="press chip px-2.5 py-1 text-note"
                  >
                    {visit.short}
                    <span className="ml-0.5 tabular-nums text-ink-3">
                      {visit.cities.length > 0 ? `${visit.cities.length}市` : visit.places.length}
                    </span>
                  </button>
                ))}
            </div>
          ) : (
            <p className="text-center text-note text-ink-3">
              给足迹补上城市或坐标，地图会自动点亮去过的省份
            </p>
          )}
          {visits.overseas.length > 0 || visits.unknown.length > 0 ? (
            <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
              <p className="text-note text-ink-3">
                另有
                {visits.overseas.length > 0 ? ` ${visits.overseas.length} 个境外地点` : ''}
                {visits.unknown.length > 0
                  ? `${visits.overseas.length > 0 ? '、' : ''}${visits.unknown.length} 个待归类地点`
                  : ''}
                ，不计入中国省份地图。
              </p>
            </div>
          ) : null}
        </div>
      ) : mode === 'map' ? (
        <WorldMap footprints={footprints} onSelect={openMap} />
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {footprints.map((footprint) => (
            <FootprintRow
              key={footprint.id}
              footprint={footprint}
              onOpenMap={() => openMap(footprint)}
              onDelete={() => setPendingDelete(footprint)}
            />
          ))}
        </div>
      )}

      {mode === 'map' && footprints.length > 0 ? (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {footprints.slice(0, 6).map((footprint) => (
            <FootprintRow
              key={footprint.id}
              footprint={footprint}
              onOpenMap={() => openMap(footprint)}
              onDelete={() => setPendingDelete(footprint)}
            />
          ))}
        </div>
      ) : null}

      <Sheet
        open={selected !== null}
        title={selected ? `${selected.name} · ${selected.places.length} 个地点` : ''}
        onClose={() => setSelected(null)}
      >
        <div className="space-y-3">
          {selected && selected.cities.length > 0
            ? selected.cities.map((cityVisit) => (
                <section key={cityVisit.city.name} className="rounded-2xl border border-line p-3">
                  <header className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate text-body font-medium text-ink">
                      {cityVisit.city.name}
                    </p>
                    <span className="shrink-0 text-caption text-ink-3">
                      {cityVisit.places.length} 个地点
                    </span>
                  </header>
                  {cityVisit.districts.size > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {[...cityVisit.districts.entries()].map(([name, list]) => (
                        <span
                          key={name}
                          className="rounded-full bg-paper-2 px-2 py-0.5 text-caption text-ink-2"
                        >
                          {name} · {list.length}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 space-y-1.5">
                    {cityVisit.places.map((footprint) => (
                      <FootprintRow
                        key={footprint.id}
                        footprint={footprint}
                        onOpenMap={() => openMap(footprint)}
                        onDelete={() => {
                          setSelected(null)
                          setPendingDelete(footprint)
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))
            : selected?.places.map((footprint) => (
                <FootprintRow
                  key={footprint.id}
                  footprint={footprint}
                  onOpenMap={() => openMap(footprint)}
                  onDelete={() => {
                    setSelected(null)
                    setPendingDelete(footprint)
                  }}
                />
              ))}
        </div>
      </Sheet>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这个足迹？"
        message={pendingDelete ? `「${pendingDelete.placeName}」会从足迹中移除。` : ''}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return
          await deleteFootprint(pendingDelete.id)
          bump()
          toast('足迹已删除')
        }}
      />
    </div>
  )
}