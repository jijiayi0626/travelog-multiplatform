import { useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { Plus } from '@phosphor-icons/react'
import type { Footprint } from '../lib/types'
import { deleteFootprint, listFootprints } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useNav, useRefresh, useToast } from '../lib/app-context'
import { FootprintRow } from '../components/cards'
import { ConfirmDialog, EmptyState, SkeletonList } from '../components/ui'

export function FootprintsPage() {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { data: footprints, loading } = useLoader(
    () => listFootprints(),
    [] as Footprint[],
    'footprints',
  )
  const [pendingDelete, setPendingDelete] = useState<Footprint | null>(null)

  const cityCount = useMemo(
    () => new Set(footprints.map((item) => item.city).filter(Boolean)).size,
    [footprints],
  )

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
      <header className="flex items-end justify-between gap-4 pt-4">
        <div className="min-w-0">
          <p className="text-[10.5px] uppercase tracking-[0.22em] text-ink-3">Footprints</p>
          <h1 className="mt-1.5 text-[27px] font-semibold leading-none tracking-tight text-ink sm:text-[32px]">
            我的足迹
          </h1>
        </div>
        <button
          type="button"
          className="btn-primary shrink-0"
          onClick={() => nav.navigate({ name: 'footprintEditor' })}
        >
          <Plus size={16} weight="bold" />
          打卡
        </button>
      </header>

      <div className="flex divide-x divide-line border-y border-line py-3.5">
        <div className="min-w-0 flex-1 pr-3">
          <p className="text-[10.5px] tracking-wide text-ink-3">地点</p>
          <p className="mt-1 text-[17px] font-semibold tabular-nums tracking-tight text-ink">
            {footprints.length}
            <span className="ml-0.5 text-[11px] font-normal text-ink-3">个</span>
          </p>
        </div>
        <div className="min-w-0 flex-1 pl-3">
          <p className="text-[10.5px] tracking-wide text-ink-3">城市</p>
          <p className="mt-1 text-[17px] font-semibold tabular-nums tracking-tight text-ink">
            {cityCount}
            <span className="ml-0.5 text-[11px] font-normal text-ink-3">座</span>
          </p>
        </div>
      </div>

      {loading ? (
        <SkeletonList rows={3} />
      ) : footprints.length === 0 ? (
        <EmptyState
          icon={<Plus size={20} />}
          title="还没有足迹"
          hint="到过一个地方，就打卡留个坐标。点击足迹可以在地图里查看。"
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