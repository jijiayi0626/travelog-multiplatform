import { useCallback, useEffect, useRef, useState } from 'react'
import { CaretLeft, CaretRight, DownloadSimple, X } from '@phosphor-icons/react'
import type { Photo } from '../lib/types'

export function Lightbox({
  photos,
  startIndex,
  onClose,
}: {
  photos: Photo[]
  startIndex: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(startIndex)
  const touchStart = useRef<number | null>(null)
  const total = photos.length

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => (current + delta + total) % total)
    },
    [total],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') go(-1)
      if (event.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [go, onClose])

  if (!photos[index]) return null
  const photo = photos[index]

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-[#0a0c0b]/96 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <header className="flex items-center justify-between px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <span className="text-[12px] tabular-nums text-white/60">
          {index + 1} / {total}
        </span>
        <div className="flex items-center gap-2">
          <a
            href={photo.src}
            download={`travelog-${photo.id}.jpg`}
            aria-label="保存这张照片"
            className="press flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <DownloadSimple size={17} />
          </a>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="press flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2"
        onTouchStart={(event) => {
          touchStart.current = event.touches[0]?.clientX ?? null
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current
          const end = event.changedTouches[0]?.clientX ?? null
          if (start !== null && end !== null && Math.abs(end - start) > 48) {
            go(end < start ? 1 : -1)
          }
          touchStart.current = null
        }}
      >
        <img
          src={photo.src}
          alt={photo.caption ?? ''}
          className="fade-in max-h-full max-w-full rounded-lg object-contain"
          style={{ maxHeight: 'calc(100dvh - 200px)' }}
        />
        {total > 1 ? (
          <>
            <button
              type="button"
              aria-label="上一张"
              onClick={() => go(-1)}
              className="press absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white sm:flex"
            >
              <CaretLeft size={20} />
            </button>
            <button
              type="button"
              aria-label="下一张"
              onClick={() => go(1)}
              className="press absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white sm:flex"
            >
              <CaretRight size={20} />
            </button>
          </>
        ) : null}
      </div>

      <footer className="safe-bottom px-4 pb-4">
        {photo.caption ? (
          <p className="mb-2 text-center text-[12px] text-white/70">{photo.caption}</p>
        ) : null}
        {total > 1 ? (
          <div className="hide-scrollbar flex justify-center gap-2 overflow-x-auto">
            {photos.map((item, itemIndex) => (
              <button
                key={item.id}
                type="button"
                aria-label={`查看第 ${itemIndex + 1} 张`}
                onClick={() => setIndex(itemIndex)}
                className={
                  itemIndex === index
                    ? 'h-11 w-11 shrink-0 overflow-hidden rounded-md ring-2 ring-white/80'
                    : 'h-11 w-11 shrink-0 overflow-hidden rounded-md opacity-45'
                }
              >
                <img src={item.src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </footer>
    </div>
  )
}