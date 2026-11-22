import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowRight,
  Check,
  CloudArrowUp,
  Images,
  MapPinLine,
  MapTrifold,
  Sparkle,
  Wallet,
  X,
} from '@phosphor-icons/react'
import { cn } from '../lib/cn'
import { useI18n, useNav } from '../lib/app-context'
import { hasOnboarded, markOnboarded, subscribeOnboardingOpen } from '../lib/onboarding'

const STEPS = [
  { key: 'welcome', Icon: MapTrifold },
  { key: 'sections', Icon: Images },
  { key: 'record', Icon: MapPinLine },
  { key: 'sync', Icon: CloudArrowUp },
  { key: 'member', Icon: Sparkle },
] as const

export function Onboarding() {
  const { tr } = useI18n()
  const nav = useNav()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const unsubscribe = subscribeOnboardingOpen(() => {
      setStep(0)
      setOpen(true)
    })
    let timer = 0
    // 只读分享页是给未安装的朋友看的，不弹新手引导
    const sharing = window.location.hash.startsWith('#/share/')
    if (!hasOnboarded() && !sharing) {
      timer = window.setTimeout(() => setOpen(true), 900)
    }
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      // 捕获阶段截断，避免底层 App 的快捷键（n / ? / /）在引导层下面触发
      event.stopPropagation()
      if (event.key === 'Escape') finish()
      if (event.key === 'ArrowRight') next()
      if (event.key === 'ArrowLeft') setStep((value) => Math.max(0, value - 1))
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey, true)
    }
  })

  if (!open) return null

  const current = STEPS[step]
  const last = step === STEPS.length - 1

  function close() {
    markOnboarded()
    setOpen(false)
  }

  function finish() {
    markOnboarded()
    setOpen(false)
    nav.navigate({ name: 'trips' })
  }

  function next() {
    if (last) finish()
    else setStep((value) => Math.min(STEPS.length - 1, value + 1))
  }

  const copy = stepCopy(current.key, tr)

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={tr('新手引导')}>
      <button
        type="button"
        aria-label={tr('关闭')}
        onClick={close}
        className="fade-in absolute inset-0 bg-[#0b0b0a]/55 backdrop-blur-[2px]"
      />
      <div
        className="fade-in relative w-full overflow-hidden rounded-t-[1.8rem] border border-line bg-paper sm:max-w-[520px] sm:rounded-[1.8rem]"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="text-caption uppercase tracking-[0.2em] text-ink-3">
            {tr('第 {n} / {total} 步', { n: step + 1, total: STEPS.length })}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label={tr('关闭')}
            className="press -mr-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>

        <div className="px-5 pb-5 pt-3">
          <div className="flex items-start gap-4">
            <span
              className={cn(
                'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl',
                step === STEPS.length - 1 ? 'bg-accent-soft text-accent' : 'bg-paper-2 text-ink-2',
              )}
            >
              <current.Icon size={26} weight={step === 0 ? 'fill' : 'regular'} />
            </span>
            <div className="min-w-0 pt-0.5">
              <h2 className="text-title font-semibold tracking-tight text-ink">{copy.title}</h2>
              <p className="mt-1.5 text-body-sm leading-6 text-ink-2">{copy.body}</p>
            </div>
          </div>

          {current.key === 'welcome' ? (
            <div className="mt-5 grid grid-cols-5 gap-1.5">
              {[
                { Icon: MapTrifold, label: tr('行程') },
                { Icon: Images, label: tr('相册') },
                { Icon: MapPinLine, label: tr('足迹') },
                { Icon: Wallet, label: tr('账本') },
                { Icon: Sparkle, label: tr('我的') },
              ].map(({ Icon, label }) => (
                <div key={label} className="rounded-xl border border-line bg-surface px-1 py-2.5 text-center">
                  <Icon size={17} className="mx-auto text-ink-2" />
                  <span className="mt-1 block text-caption text-ink-3">{label}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-5 flex gap-1.5">
            {STEPS.map((item, index) => (
              <button
                key={item.key}
                type="button"
                aria-label={tr('第 {n} / {total} 步', { n: index + 1, total: STEPS.length })}
                onClick={() => setStep(index)}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  index <= step ? 'bg-accent' : 'bg-paper-2',
                )}
              />
            ))}
          </div>
        </div>

        <div className="safe-bottom flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <button type="button" className="btn-ghost h-10 px-2 text-ink-3" onClick={close}>
            {tr('跳过')}
          </button>
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <button
                type="button"
                className="btn-ghost h-10"
                onClick={() => setStep((value) => Math.max(0, value - 1))}
              >
                {tr('上一步')}
              </button>
            ) : null}
            <button type="button" className="btn-primary h-10" onClick={next}>
              {last ? <Check size={16} /> : null}
              {last ? tr('开始记录') : tr('下一步')}
              {last ? null : <ArrowRight size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function stepCopy(
  key: (typeof STEPS)[number]['key'],
  tr: (zh: string, vars?: Record<string, string | number>) => string,
): { title: string; body: string } {
  switch (key) {
    case 'sections':
      return {
        title: tr('五个入口，各管一件事'),
        body: tr('行程管理旅行，相册汇总照片，足迹点亮地图，账本记录花费；「我的」里是设置、云同步与会员。'),
      }
    case 'record':
      return {
        title: tr('写记录，也留足迹'),
        body: tr('在旅程里写下图文记录、放上照片；到过的地方打卡后，会自动点亮中国省份地图。'),
      }
    case 'sync':
      return {
        title: tr('多设备共用一份数据'),
        body: tr('用账号密码登录云同步，手机、平板与网页自动合并。同步码仍然可以用于多人共享。'),
      }
    case 'member':
      return {
        title: tr('会员解锁 AI 能力'),
        body: tr('AI 排行程、润色与年度总结需要会员。会员码在「我的 → 云同步 → 会员」兑换，天数会自动累加。'),
      }
    default:
      return {
        title: tr('欢迎来到旅记'),
        body: tr('把旅程、日程、照片与花费都收进一个地方。先花一分钟，看看从哪里开始。'),
      }
  }
}
