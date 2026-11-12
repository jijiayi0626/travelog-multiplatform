import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  CHINA_HEIGHT,
  CHINA_WIDTH,
  PROVINCES,
  projectLngLat,
  provinceBounds,
  provinceByShort,
} from '../lib/chinaGeo'
import { CHINA_CITIES, SOUTH_SEA_BOX, SOUTH_SEA_PATH } from '../lib/chinaCities'
import type { ProvinceVisit } from '../lib/province'
import { useI18n } from '../lib/app-context'
import { cn } from '../lib/cn'

const PAD = 60

interface Fit {
  transform: string
  scale: number
}

/** 把 SVG 坐标系中的矩形铺满视口 */
function fitRect(minX: number, minY: number, width: number, height: number, pad = PAD): Fit {
  const safeW = Math.max(width, 1)
  const safeH = Math.max(height, 1)
  const scale = Math.min((CHINA_WIDTH - pad * 2) / safeW, (CHINA_HEIGHT - pad * 2) / safeH)
  const tx = (CHINA_WIDTH - safeW * scale) / 2 - minX * scale
  const ty = (CHINA_HEIGHT - safeH * scale) / 2 - minY * scale
  return {
    transform: `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})`,
    scale,
  }
}

/** 把一组点铺满视口，跨度不足 minSpan 时以中心对称撑开 */
function fitPoints(points: Array<[number, number]>, pad = PAD, minSpan = 96): Fit {
  if (points.length === 0) return fitRect(0, 0, CHINA_WIDTH, CHINA_HEIGHT, pad)
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  let width = maxX - minX
  let height = maxY - minY
  if (width < minSpan) {
    const center = (minX + maxX) / 2
    minX = center - minSpan / 2
    width = minSpan
  }
  if (height < minSpan) {
    const center = (minY + maxY) / 2
    minY = center - minSpan / 2
    height = minSpan
  }
  return fitRect(minX, minY, width, height, pad)
}

interface MapView {
  zoom: number
  /** 视口中心（SVG 坐标） */
  cx: number
  cy: number
}

const MIN_ZOOM = 1
const MAX_ZOOM = 6
const DEFAULT_VIEW: MapView = { zoom: 1, cx: CHINA_WIDTH / 2, cy: CHINA_HEIGHT / 2 }

/** 限制视口不出画布，避免拖出大片空白 */
function clampView(view: MapView): MapView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom))
  const width = CHINA_WIDTH / zoom
  const height = CHINA_HEIGHT / zoom
  const cx =
    width >= CHINA_WIDTH
      ? CHINA_WIDTH / 2
      : Math.min(Math.max(view.cx, width / 2), CHINA_WIDTH - width / 2)
  const cy =
    height >= CHINA_HEIGHT
      ? CHINA_HEIGHT / 2
      : Math.min(Math.max(view.cy, height / 2), CHINA_HEIGHT - height / 2)
  return { zoom, cx, cy }
}

function viewBoxOf(view: MapView): string {
  const width = CHINA_WIDTH / view.zoom
  const height = CHINA_HEIGHT / view.zoom
  return `${(view.cx - width / 2).toFixed(2)} ${(view.cy - height / 2).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}`
}

export function ChinaMap({
  visits,
  onSelect,
  className,
}: {
  visits: Map<string, ProvinceVisit>
  onSelect?: (visit: ProvinceVisit) => void
  className?: string
}) {
  const [hoverProvince, setHoverProvince] = useState<string | null>(null)
  const [drillProvince, setDrillProvince] = useState<string | null>(null)
  const [drillCity, setDrillCity] = useState<string | null>(null)
  // 全国 / 省 / 市三级共用同一套缩放与平移
  const [viewport, setViewport] = useState<MapView>(DEFAULT_VIEW)
  const frameRef = useRef<HTMLDivElement>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ dist: number } | null>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const suppressClickRef = useRef(false)
  const { tr } = useI18n()

  useEffect(() => {
    setViewport({ ...DEFAULT_VIEW })
  }, [drillProvince, drillCity])

  /** 以视口比例 (fx, fy) 为中心缩放 */
  const zoomBy = (factor: number, fx = 0.5, fy = 0.5) => {
    setViewport((prev) => {
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.zoom * factor))
      if (nextZoom === prev.zoom) return prev
      const width = CHINA_WIDTH / prev.zoom
      const height = CHINA_HEIGHT / prev.zoom
      const focusX = prev.cx - width / 2 + fx * width
      const focusY = prev.cy - height / 2 + fy * height
      const nextWidth = CHINA_WIDTH / nextZoom
      const nextHeight = CHINA_HEIGHT / nextZoom
      return clampView({
        zoom: nextZoom,
        cx: focusX - fx * nextWidth + nextWidth / 2,
        cy: focusY - fy * nextHeight + nextHeight / 2,
      })
    })
  }

  const resetViewport = () => setViewport({ ...DEFAULT_VIEW })

  /** 拖动结束后不要误触下钻 */
  const consumeSuppressedClick = (): boolean => {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    return true
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    dragRef.current = { x: event.clientX, y: event.clientY }
    suppressClickRef.current = false
    if (pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) }
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const last = pinchRef.current
      if (last && last.dist > 0 && dist > 0) {
        const fx = Math.min(1, Math.max(0, ((a.x + b.x) / 2 - rect.left) / rect.width))
        const fy = Math.min(1, Math.max(0, ((a.y + b.y) / 2 - rect.top) / rect.height))
        zoomBy(dist / last.dist, fx, fy)
      }
      pinchRef.current = { dist }
      suppressClickRef.current = true
      return
    }

    const prev = dragRef.current
    if (!prev) return
    const dx = event.clientX - prev.x
    const dy = event.clientY - prev.y
    if (Math.abs(dx) + Math.abs(dy) > 2) suppressClickRef.current = true
    setViewport((current) =>
      clampView({
        zoom: current.zoom,
        cx: current.cx - (dx * (CHINA_WIDTH / current.zoom)) / rect.width,
        cy: current.cy - (dy * (CHINA_HEIGHT / current.zoom)) / rect.height,
      }),
    )
    dragRef.current = { x: event.clientX, y: event.clientY }
  }

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    pinchRef.current = null
    const rest = [...pointersRef.current.values()][0]
    dragRef.current = rest ? { x: rest.x, y: rest.y } : null
  }

  // 滚轮缩放需要 preventDefault，React 的 onWheel 在某些浏览器里是被动监听
  useEffect(() => {
    const element = frameRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const fx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      const fy = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
      zoomBy(Math.exp(-event.deltaY * 0.0015), fx, fy)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
    // zoomBy 每次渲染重建，但内部只依赖 setViewport，捕获首次实例即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const maxCount = useMemo(() => {
    let max = 0
    for (const visit of visits.values()) max = Math.max(max, visit.places.length)
    return Math.max(max, 1)
  }, [visits])

  const fillOf = (short: string): string => {
    const visit = visits.get(short)
    if (!visit) return 'var(--color-paper-2)'
    const ratio = visit.places.length / maxCount
    if (ratio >= 0.75) return 'var(--color-accent)'
    if (ratio >= 0.4) return 'color-mix(in oklab, var(--color-accent) 68%, var(--color-paper-2))'
    return 'color-mix(in oklab, var(--color-accent) 42%, var(--color-paper-2))'
  }

  const hoverVisit = hoverProvince ? visits.get(hoverProvince) : undefined

  const back = (level: 'country' | 'province') => {
    if (level === 'country') {
      setDrillProvince(null)
      setDrillCity(null)
    } else {
      setDrillCity(null)
    }
  }

  /* ---------------- 全国视图 ---------------- */
  const countryView = (
    <svg
      viewBox={viewBoxOf(viewport)}
      className="block w-full"
      role="img"
      aria-label={tr('中国省份足迹地图')}
    >
      {PROVINCES.map((province) => {
        const visit = visits.get(province.short)
        const isActive = hoverProvince === province.short
        return (
          <path
            key={province.adcode}
            data-short={province.short}
            d={province.path}
            fill={fillOf(province.short)}
            stroke={isActive ? 'var(--color-ink)' : 'var(--color-line)'}
            strokeWidth={isActive ? 2.2 : 0.8}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className={cn(
              'transition-[fill,stroke] duration-200',
              visit ? 'cursor-pointer' : 'cursor-default',
            )}
            onMouseEnter={() => setHoverProvince(province.short)}
            onMouseLeave={() => setHoverProvince(null)}
            onClick={() => {
              if (consumeSuppressedClick()) return
              if (visit) setDrillProvince(province.short)
            }}
          >
            <title>
              {visit
                ? `${province.short} · ${tr('{n} 个地点', { n: visit.places.length })}`
                : `${province.short} · ${tr('还没去过')}`}
            </title>
          </path>
        )
      })}

      {/* 南海诸岛小图（与主图同一投影） */}
      <g transform={`translate(${CHINA_WIDTH - 136} ${CHINA_HEIGHT - 208})`}>
        <rect
          width={128}
          height={196}
          rx={8}
          fill="var(--color-surface)"
          stroke="var(--color-line)"
          strokeWidth={1}
        />
        <g transform={`translate(4 26) scale(${(SOUTH_SEA_BOX.width - 8) / SOUTH_SEA_BOX.width})`}>
          <path
            d={SOUTH_SEA_PATH}
            fill="var(--color-paper-2)"
            stroke="var(--color-ink-3)"
            strokeWidth={0.8}
            strokeLinejoin="round"
          />
        </g>
        <text
          x={12}
          y={18}
          fontSize={11}
          fill="var(--color-ink-3)"
          style={{ fontFamily: 'inherit' }}
>
            {tr('南海诸岛')}
          </text>
      </g>
    </svg>
  )

  /* ---------------- 省级视图（市分布） ---------------- */
  const province = drillProvince ? provinceByShort(drillProvince) : undefined
  const bounds = drillProvince ? provinceBounds(drillProvince) : null
  const provinceFit = bounds
    ? fitRect(bounds.minX, bounds.minY, bounds.width, bounds.height)
    : null
  const provinceVisit = drillProvince ? visits.get(drillProvince) : undefined
  const cityVisitMap = useMemo(() => {
    const map = new Map<string, { places: number; districts: Map<string, number> }>()
    for (const item of provinceVisit?.cities ?? []) {
      map.set(item.city.name, {
        places: item.places.length,
        districts: new Map([...item.districts.entries()].map(([name, list]) => [name, list.length])),
      })
    }
    return map
  }, [provinceVisit])
  const provinceCities = useMemo(
    () => (drillProvince ? CHINA_CITIES.filter((city) => city.province === drillProvince) : []),
    [drillProvince],
  )
  const visitedCityCount = provinceCities.filter((city) => cityVisitMap.has(city.name)).length

  const provinceView =
    province && provinceFit ? (
      <svg
        viewBox={viewBoxOf(viewport)}
        className="block w-full"
        role="img"
        aria-label={tr('{province} 城市足迹地图', { province: province.short })}
      >
        <g
          transform={provinceFit.transform}
          style={{ transition: 'transform 420ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {/* 背景保留全国轮廓，让「放大到该省」有地理上下文 */}
          {PROVINCES.filter((item) => item.short !== province.short).map((item) => (
            <path
              key={`bg-${item.adcode}`}
              d={item.path}
              fill="var(--color-paper-2)"
              fillOpacity={0.45}
              stroke="var(--color-line)"
              strokeWidth={0.8}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={province.path}
            fill="var(--color-paper-2)"
            stroke="var(--color-accent)"
            strokeWidth={1.2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {provinceCities.map((city) => {
            const [x, y] = projectLngLat(city.lng, city.lat)
            const hit = cityVisitMap.get(city.name)
            const canDrill = Boolean(hit) && city.districts.length > 0
            return (
              <g
                key={city.name}
                data-city={city.name}
                data-visited={hit ? '1' : undefined}
                style={{ cursor: canDrill ? 'pointer' : 'default' }}
                onClick={() => {
                  if (consumeSuppressedClick()) return
                  if (canDrill) setDrillCity(city.name)
                }}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={(hit ? 6.5 : 3.4) / provinceFit.scale}
                  fill={hit ? 'var(--color-accent)' : 'var(--color-surface)'}
                  stroke={hit ? 'var(--color-surface)' : 'var(--color-line)'}
                  strokeWidth={(hit ? 2 : 1) / provinceFit.scale}
                  className="transition-[r,fill] duration-200"
                />
                {hit ? (
                  <text
                    x={x + 10 / provinceFit.scale}
                    y={y + 4 / provinceFit.scale}
                    fontSize={12 / provinceFit.scale}
                    fill="var(--color-ink)"
                    style={{ fontFamily: 'inherit' }}
                  >
                    {city.short}
                  </text>
                ) : null}
                <title>
                  {city.name}
                  {hit
                    ? ` · ${tr('{n} 个地点', { n: hit.places })}`
                    : ` · ${tr('还没去过')}`}
                  {city.districts.length > 0
                    ? ` · ${tr('{n} 个区县', { n: city.districts.length })}`
                    : ''}
                </title>
              </g>
            )
          })}
        </g>
      </svg>
    ) : null

  /* ---------------- 市级视图（区县分布） ---------------- */
  const currentCity = drillCity
    ? provinceCities.find((city) => city.name === drillCity)
    : undefined
  const cityDistricts = currentCity?.districts ?? []
  const cityPointFit = useMemo(
    () => fitPoints(cityDistricts.map((item) => projectLngLat(item.lng, item.lat)), PAD, 120),
    [cityDistricts],
  )
  const cityVisit = drillCity ? cityVisitMap.get(drillCity) : undefined
  const visitedDistrictCount = cityDistricts.filter((item) =>
    cityVisit?.districts.has(item.name),
  ).length

  const cityView =
    province && currentCity ? (
      <svg
        viewBox={viewBoxOf(viewport)}
        className="block w-full"
        role="img"
        aria-label={tr('{city} 区县足迹地图', { city: currentCity.name })}
      >
        <g
          transform={cityPointFit.transform}
          style={{ transition: 'transform 420ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          <path
            d={province.path}
            fill="var(--color-paper-2)"
            fillOpacity={0.6}
            stroke="var(--color-line)"
            strokeWidth={1}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {cityDistricts.map((district) => {
            const [x, y] = projectLngLat(district.lng, district.lat)
            const count = cityVisit?.districts.get(district.name)
            const hit = Boolean(count)
            return (
              <g key={district.name} data-district={district.name}>
                <circle
                  cx={x}
                  cy={y}
                  r={(hit ? 6 : 3.2) / cityPointFit.scale}
                  fill={hit ? 'var(--color-accent)' : 'var(--color-surface)'}
                  stroke={hit ? 'var(--color-surface)' : 'var(--color-line)'}
                  strokeWidth={(hit ? 2 : 1) / cityPointFit.scale}
                />
                {hit ? (
                  <text
                    x={x + 9 / cityPointFit.scale}
                    y={y + 4 / cityPointFit.scale}
                    fontSize={12 / cityPointFit.scale}
                    fill="var(--color-ink)"
                    style={{ fontFamily: 'inherit' }}
                  >
                    {district.name}
                  </text>
                ) : null}
                <title>
                  {district.name}
                  {hit
                    ? ` · ${tr('{n} 个地点', { n: count ?? 0 })}`
                    : ` · ${tr('还没去过')}`}
                </title>
              </g>
            )
          })}
        </g>
      </svg>
    ) : null

  const view = !drillProvince ? countryView : !drillCity ? provinceView : cityView

  const hint = (() => {
    if (!drillProvince) {
      return hoverProvince
        ? `${hoverProvince}${hoverVisit ? ` · ${tr('{n} 个地点', { n: hoverVisit.places.length })}` : ` · ${tr('还没去过')}`}`
        : tr('点击点亮的省份，逐层查看去过的市与区县')
    }
    if (!drillCity) {
      return `${province?.short ?? ''} · ${tr('去过 {a}/{b} 个市，点亮城市可继续下钻', {
        a: visitedCityCount,
        b: provinceCities.length,
      })}`
    }
    return `${currentCity?.name ?? ''} · ${tr('去过 {a}/{b} 个区县', {
      a: visitedDistrictCount,
      b: cityDistricts.length,
    })}`
  })()

  return (
    <div
      className={cn(
        'relative mx-auto w-full max-w-[680px] overflow-hidden rounded-[1.35rem] border border-line bg-surface p-3',
        className,
      )}
    >
      {drillProvince ? (
        <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-1 text-note">
          <button
            type="button"
            data-drill="root"
            onClick={() => back('country')}
            className="press rounded-md px-1.5 py-0.5 text-ink-3 hover:text-ink"
          >
            {tr('中国')}
          </button>
          <span className="text-ink-3/60">›</span>
          <button
            type="button"
            onClick={() => back('province')}
            className={cn(
              'press rounded-md px-1.5 py-0.5',
              drillCity ? 'text-ink-3 hover:text-ink' : 'font-medium text-ink',
            )}
          >
            {province?.short ?? ''}
          </button>
          {drillCity ? (
            <>
              <span className="text-ink-3/60">›</span>
              <span className="font-medium text-ink">{currentCity?.short ?? ''}</span>
            </>
          ) : null}
        </div>
      ) : null}

      {/* 全国 / 省 / 市三级共用：拖动平移、双指或滚轮缩放 */}
      <div
        ref={frameRef}
        className="select-none"
        style={{
          cursor: viewport.zoom > 1.01 ? 'grab' : 'default',
          // 未放大时保留页面纵向滚动，放大后再完全接管手势用于平移
          touchAction: viewport.zoom > 1.01 ? 'none' : 'pan-y',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
      >
        {view}
      </div>

      <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-full border border-line bg-surface/95 backdrop-blur-sm">
        <button
          type="button"
          aria-label={tr('放大')}
          className="press flex h-8 w-8 items-center justify-center text-body text-ink-2 hover:text-ink"
          onClick={() => zoomBy(1.35)}
        >
          +
        </button>
        <button
          type="button"
          aria-label={tr('缩小')}
          className="press flex h-8 w-8 items-center justify-center border-t border-line text-body text-ink-2 hover:text-ink"
          onClick={() => zoomBy(1 / 1.35)}
        >
          −
        </button>
        {viewport.zoom > 1.01 ? (
          <button
            type="button"
            aria-label={tr('复位')}
            className="press flex h-8 w-8 items-center justify-center border-t border-line text-note text-ink-3 hover:text-ink"
            onClick={resetViewport}
          >
            ↺
          </button>
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end gap-2">
        <div className="min-w-0 max-w-[62%] rounded-lg bg-surface/90 px-2 py-1 backdrop-blur-sm">
          <p className="truncate text-note text-ink">{hint}</p>
        </div>
        {drillProvince && !drillCity && provinceVisit ? (
          <button
            type="button"
            onClick={() => onSelect?.(provinceVisit)}
            className="pointer-events-auto press shrink-0 rounded-full border border-line bg-surface/90 px-2.5 py-1 text-caption text-ink backdrop-blur-sm hover:border-accent"
          >
            {tr('{n} 个地点', { n: provinceVisit.places.length })}
          </button>
        ) : null}
        {!drillProvince ? (
          <span className="shrink-0 rounded-full border border-line bg-surface/90 px-2.5 py-1 text-caption tabular-nums text-ink-3 backdrop-blur-sm">
            {visits.size} / {PROVINCES.length}
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-line bg-surface/90 px-2.5 py-1 text-caption tabular-nums text-ink-3 backdrop-blur-sm">
            {drillCity
              ? `${visitedDistrictCount} / ${cityDistricts.length}`
              : `${visitedCityCount} / ${provinceCities.length}`}
          </span>
        )}
      </div>
    </div>
  )
}