import { useCallback, useMemo, useState } from 'react'
import { ImageSquare, MapTrifold } from '@phosphor-icons/react'
import type { Moment, Photo, TripView } from '../lib/types'
import { listAllMoments, listTrips } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useNav } from '../lib/app-context'
import { formatDateCn, monthKey } from '../lib/utils'
import { cn } from '../lib/cn'
import { Lightbox } from '../components/Lightbox'
import { EmptyState } from '../components/ui'
import { EmptyArt } from '../components/EmptyArt'

interface AlbumPhoto extends Photo {
  tripId: string
  tripTitle: string
  takenAt: number
  dayIndex: number
}

interface AlbumGroup {
  key: string
  title: string
  subtitle: string
  tripId?: string
  photos: AlbumPhoto[]
}

const MODES = [
  { value: 'trip' as const, label: '按旅程' },
  { value: 'time' as const, label: '按时间' },
]

export function AlbumPage() {
  const nav = useNav()
  const loader = useCallback(async () => {
    const [moments, trips] = await Promise.all([listAllMoments(), listTrips()])
    return { moments, trips }
  }, [])
  const { data, loading } = useLoader(
    loader,
    { moments: [] as Moment[], trips: [] as TripView[] },
    'album',
  )

  const [mode, setMode] = useState<'trip' | 'time'>('trip')
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null)

  const tripMap = useMemo(() => {
    const map = new Map<string, TripView>()
    for (const trip of data.trips) map.set(trip.id, trip)
    return map
  }, [data.trips])

  const allPhotos = useMemo<AlbumPhoto[]>(() => {
    const list: AlbumPhoto[] = []
    for (const moment of data.moments) {
      const trip = tripMap.get(moment.tripId)
      for (const photo of moment.photos ?? []) {
        list.push({
          ...photo,
          tripId: moment.tripId,
          tripTitle: trip?.title ?? '未关联旅程',
          takenAt: moment.createdAt,
          dayIndex: moment.dayIndex,
        })
      }
    }
    return list.sort((a, b) => b.takenAt - a.takenAt)
  }, [data.moments, tripMap])

  const groups = useMemo<AlbumGroup[]>(() => {
    if (mode === 'trip') {
      const map = new Map<string, AlbumPhoto[]>()
      for (const photo of allPhotos) {
        const bucket = map.get(photo.tripId)
        if (bucket) bucket.push(photo)
        else map.set(photo.tripId, [photo])
      }
      return [...map.entries()]
        .map(([tripId, photos]) => {
          const trip = tripMap.get(tripId)
          return {
            key: tripId,
            title: trip?.title ?? '未关联旅程',
            subtitle: `${photos.length} 张${trip?.destination ? ` · ${trip.destination}` : ''}`,
            tripId,
            photos,
          }
        })
        .sort((a, b) => (b.photos[0]?.takenAt ?? 0) - (a.photos[0]?.takenAt ?? 0))
    }

    const map = new Map<string, AlbumPhoto[]>()
    for (const photo of allPhotos) {
      const key = monthKey(photo.takenAt)
      const bucket = map.get(key)
      if (bucket) bucket.push(photo)
      else map.set(key, [photo])
    }
    return [...map.entries()]
      .map(([key, photos]) => ({
        key,
        title: `${key.slice(0, 4)} 年 ${Number(key.slice(5))} 月`,
        subtitle: `${photos.length} 张`,
        photos,
      }))
      .sort((a, b) => b.key.localeCompare(a.key))
  }, [allPhotos, mode, tripMap])

  const tripCount = useMemo(() => new Set(allPhotos.map((photo) => photo.tripId)).size, [allPhotos])

  const openPhoto = (photo: AlbumPhoto) => {
    const group = groups.find((item) => item.photos.some((entry) => entry.id === photo.id))
    if (!group) return
    setLightbox({
      photos: group.photos,
      index: group.photos.findIndex((entry) => entry.id === photo.id),
    })
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 pt-4">
        <div className="min-w-0">
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Album</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
            相册
          </h1>
        </div>
        <div className="flex shrink-0 gap-1 rounded-full border border-line bg-paper-2 p-1">
          {MODES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setMode(item.value)}
              className={cn(
                'press rounded-full px-3 py-1.5 text-note',
                mode === item.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {!loading && allPhotos.length > 0 ? (
        <div className="flex divide-x divide-line border-y border-line py-3.5">
          <div className="min-w-0 flex-1 pr-3">
            <p className="text-caption tracking-wide text-ink-3">照片</p>
            <p className="mt-1 text-title font-semibold tabular-nums tracking-tight text-ink">
              {allPhotos.length}
              <span className="ml-0.5 text-caption font-normal text-ink-3">张</span>
            </p>
          </div>
          <div className="min-w-0 flex-1 px-3">
            <p className="text-caption tracking-wide text-ink-3">旅程</p>
            <p className="mt-1 text-title font-semibold tabular-nums tracking-tight text-ink">
              {tripCount}
              <span className="ml-0.5 text-caption font-normal text-ink-3">段</span>
            </p>
          </div>
          <div className="min-w-0 flex-1 pl-3">
            <p className="text-caption tracking-wide text-ink-3">最近一张</p>
            <p className="mt-1 truncate text-body-sm font-medium text-ink">
              {allPhotos[0] ? formatDateCn(allPhotos[0].takenAt) : '—'}
            </p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="skeleton aspect-square rounded-xl" />
          ))}
        </div>
      ) : allPhotos.length === 0 ? (
        <EmptyState
          icon={<EmptyArt variant="photo" />}
          title="相册还是空的"
          hint="在旅程的记录里加上照片，它们会自动收进这里。"
          action={
            <button type="button" className="btn-ghost mt-1" onClick={() => nav.navigate({ name: 'trips' })}>
              <MapTrifold size={15} />
              去添加记录
            </button>
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-body-sm font-semibold tracking-tight text-ink">
                    {group.title}
                  </h2>
                  <p className="mt-0.5 text-caption text-ink-3">{group.subtitle}</p>
                </div>
                {group.tripId ? (
                  <button
                    type="button"
                    onClick={() => nav.navigate({ name: 'trip', id: group.tripId as string, tab: 'timeline' })}
                    className="press shrink-0 rounded-full border border-line px-2.5 py-1 text-caption text-ink-2"
                  >
                    查看旅程
                  </button>
                ) : null}
              </div>

              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
                {group.photos.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => openPhoto(photo)}
                    className="press group relative aspect-square overflow-hidden rounded-xl bg-paper-2"
                    aria-label={`查看 ${photo.caption ?? '照片'}`}
                  >
                    <img
                      src={photo.src}
                      alt={photo.caption ?? ''}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                    {photo.caption ? (
                      <span className="absolute inset-x-0 bottom-0 line-clamp-1 bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-4 text-left text-caption text-[var(--on-cover-strong)] opacity-0 transition-opacity group-hover:opacity-100">
                        {photo.caption}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          ))}

          <p className="flex items-center justify-center gap-1.5 pb-2 text-caption text-ink-3">
            <ImageSquare size={12} />
            照片压缩后存在本机，导出备份时会一并带走
          </p>
        </div>
      )}

      {lightbox ? (
        <Lightbox photos={lightbox.photos} startIndex={lightbox.index} onClose={() => setLightbox(null)} />
      ) : null}
    </div>
  )
}