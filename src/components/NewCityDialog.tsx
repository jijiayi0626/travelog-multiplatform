import { useEffect, useState } from 'react'
import { MapPinLine } from '@phosphor-icons/react'
import { Sheet } from './ui'
import { useI18n, useNav } from '../lib/app-context'

interface NewCityDetail {
  city: string
  province?: string
}

/** 首次到达新城市时弹出的解锁提示 */
export function NewCityDialog() {
  const { tr } = useI18n()
  const nav = useNav()
  const [unlocked, setUnlocked] = useState<NewCityDetail | null>(null)

  useEffect(() => {
    const onNewCity = (event: Event) => {
      const detail = (event as CustomEvent<NewCityDetail>).detail
      if (!detail?.city) return
      setUnlocked({ city: detail.city, province: detail.province ?? '' })
    }
    window.addEventListener('travelog:newCity', onNewCity)
    return () => window.removeEventListener('travelog:newCity', onNewCity)
  }, [])

  const close = () => setUnlocked(null)

  const goFootprints = () => {
    close()
    nav.navigate({ name: 'footprints' })
  }

  return (
    <Sheet
      open={Boolean(unlocked)}
      title={tr('恭喜到达新城市')}
      onClose={close}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost h-10" onClick={close}>
            {tr('知道了')}
          </button>
          <button type="button" className="btn-primary h-10" onClick={goFootprints}>
            {tr('去看看')}
          </button>
        </div>
      }
    >
      {unlocked ? (
        <div className="flex flex-col items-center gap-3 py-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <MapPinLine size={26} weight="fill" />
          </span>
          <p className="text-title font-semibold tracking-tight text-ink">
            {unlocked.province ? `${unlocked.province} · ${unlocked.city}` : unlocked.city}
          </p>
          <p className="max-w-[30ch] text-body-sm leading-6 text-ink-3">
            {tr('已解锁新城市，继续探索可以点亮更多足迹')}
          </p>
        </div>
      ) : null}
    </Sheet>
  )
}
