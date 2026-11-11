import { useMemo, useState } from 'react'
import type { Footprint } from '../lib/types'
import { cn } from '../lib/cn'

interface Projected {
  footprint: Footprint
  x: number
  y: number
}

const WIDTH = 720
const HEIGHT = 340

export function WorldMap({
  footprints,
  onSelect,
  className,
}: {
  footprints: Footprint[]
  onSelect?: (footprint: Footprint) => void
  className?: string
}) {
  const [hovered, setHovered] = useState<string | null>(null)

  const points = useMemo<Projected[]>(
    () =>
      footprints
        .filter((item) => item.latitude !== 0 || item.longitude !== 0)
        .map((item) => ({
          footprint: item,
          x: ((item.longitude + 180) / 360) * WIDTH,
          y: ((90 - item.latitude) / 180) * HEIGHT,
        })),
    [footprints],
  )

  const path = useMemo(
    () =>
      [...points]
        .sort((a, b) => a.footprint.visitedAt - b.footprint.visitedAt)
        .map((point) => `${point.x},${point.y}`)
        .join(' '),
    [points],
  )

  const active = points.find((point) => point.footprint.id === hovered)

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[1.35rem] border border-line bg-[#0b1a17]',
        className,
      )}
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full" role="img" aria-label="足迹星图">
        <defs>
          <radialGradient id="map-glow">
            <stop offset="0%" stopColor="#1d6f64" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#0b1a17" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="map-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#5eead4" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#5eead4" stopOpacity="0.55" />
          </linearGradient>
        </defs>

        <rect width={WIDTH} height={HEIGHT} fill="#0b1a17" />
        <ellipse cx={WIDTH / 2} cy={HEIGHT / 2} rx={WIDTH * 0.44} ry={HEIGHT * 0.46} fill="url(#map-glow)" />

        {Array.from({ length: 7 }).map((_, index) => {
          const y = (HEIGHT / 8) * (index + 1)
          return (
            <line key={`h-${index}`} x1={0} y1={y} x2={WIDTH} y2={y} stroke="#ffffff" strokeOpacity={0.06} />
          )
        })}
        {Array.from({ length: 11 }).map((_, index) => {
          const x = (WIDTH / 12) * (index + 1)
          return (
            <line key={`v-${index}`} x1={x} y1={0} x2={x} y2={HEIGHT} stroke="#ffffff" strokeOpacity={0.06} />
          )
        })}
        <line
          x1={0}
          y1={HEIGHT / 2}
          x2={WIDTH}
          y2={HEIGHT / 2}
          stroke="#ffffff"
          strokeOpacity={0.12}
          strokeDasharray="4 6"
        />

        {points.length > 1 ? (
          <polyline points={path} fill="none" stroke="url(#map-line)" strokeWidth={1.4} strokeLinecap="round" />
        ) : null}

        {points.map((point) => {
          const isActive = hovered === point.footprint.id
          return (
            <g
              key={point.footprint.id}
              className="cursor-pointer"
              onMouseEnter={() => setHovered(point.footprint.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelect?.(point.footprint)}
            >
              <circle cx={point.x} cy={point.y} r={isActive ? 13 : 9} fill="#5eead4" fillOpacity={0.12} />
              <circle cx={point.x} cy={point.y} r={isActive ? 4.6 : 3.6} fill="#5eead4" />
              <circle cx={point.x} cy={point.y} r={1.6} fill="#0b1a17" />
            </g>
          )
        })}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-[#0b1a17] via-[#0b1a17]/70 to-transparent px-4 pb-3 pt-8">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#5eead4]/60">Footprint map</p>
          <p className="mt-0.5 truncate text-[12.5px] text-white/80">
            {active
              ? `${active.footprint.placeName}${active.footprint.city ? ' · ' + active.footprint.city : ''}`
              : points.length > 0
                ? `${points.length} 个坐标 · 点击光点查看`
                : '打卡后，地点会落在星图上'}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[10px] tabular-nums text-white/50">
          {points.length} pts
        </span>
      </div>
    </div>
  )
}