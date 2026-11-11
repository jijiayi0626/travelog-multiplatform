import { useMemo, useState } from 'react'
import { CHINA_HEIGHT, CHINA_WIDTH, PROVINCES } from '../lib/chinaGeo'
import type { ProvinceVisit } from '../lib/province'
import { cn } from '../lib/cn'

export function ChinaMap({
  visits,
  onSelect,
  className,
}: {
  visits: Map<string, ProvinceVisit>
  onSelect?: (visit: ProvinceVisit) => void
  className?: string
}) {
  const [active, setActive] = useState<string | null>(null)

  const maxCount = useMemo(() => {
    let max = 0
    for (const visit of visits.values()) max = Math.max(max, visit.places.length)
    return Math.max(max, 1)
  }, [visits])

  const activeVisit = active ? visits.get(active) : undefined
  const activeProvince = active ? PROVINCES.find((item) => item.short === active) : undefined

  const fillOf = (short: string): string => {
    const visit = visits.get(short)
    if (!visit) return 'var(--color-paper-2)'
    const ratio = visit.places.length / maxCount
    if (ratio >= 0.75) return 'var(--color-accent)'
    if (ratio >= 0.4) return 'color-mix(in oklab, var(--color-accent) 68%, var(--color-paper-2))'
    return 'color-mix(in oklab, var(--color-accent) 42%, var(--color-paper-2))'
  }

  return (
    <div
      className={cn(
        'relative mx-auto w-full max-w-[680px] overflow-hidden rounded-[1.35rem] border border-line bg-surface p-3',
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${CHINA_WIDTH} ${CHINA_HEIGHT}`}
        className="block w-full"
        role="img"
        aria-label="中国省份足迹地图"
      >
        {PROVINCES.map((province) => {
          const visit = visits.get(province.short)
          const isActive = active === province.short
          return (
            <path
              key={province.adcode}
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
              onMouseEnter={() => setActive(province.short)}
              onMouseLeave={() => setActive(null)}
              onClick={() => visit && onSelect?.(visit)}
            >
              <title>
                {province.short}
                {visit ? ` · ${visit.places.length} 个地点` : ' · 还没去过'}
              </title>
            </path>
          )
        })}
      </svg>

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
        <div className="min-w-0 rounded-lg bg-surface/90 px-2 py-1 backdrop-blur-sm">
          <p className="truncate text-[12px] text-ink">
            {activeProvince
              ? `${activeProvince.short}${activeVisit ? ` · ${activeVisit.places.length} 个地点` : ' · 还没去过'}`
              : '悬停查看省份，点亮的地方是去过的地方'}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-surface/90 px-2.5 py-1 text-[10px] tabular-nums text-ink-3 backdrop-blur-sm">
          {visits.size} / {PROVINCES.length}
        </span>
      </div>
    </div>
  )
}