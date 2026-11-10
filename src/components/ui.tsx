import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { X } from '@phosphor-icons/react'
import { cn } from '../lib/cn'
import { initials } from '../lib/utils'

export function Avatar({
  name,
  src,
  size = 40,
}: {
  name: string
  src?: string
  size?: number
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-medium text-accent"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface text-ink-2">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-[15px] font-medium text-ink">{title}</p>
        {hint ? <p className="mx-auto max-w-[34ch] text-[13px] leading-5 text-ink-3">{hint}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="card p-4">
          <div className="skeleton h-4 w-2/5" />
          <div className="skeleton mt-3 h-3 w-3/5" />
          <div className="skeleton mt-2 h-3 w-1/3" />
        </div>
      ))}
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="field-label">{label}</span>
      {children}
      {error ? (
        <span className="text-[12px] text-danger">{error}</span>
      ) : hint ? (
        <span className="text-[12px] text-ink-3">{hint}</span>
      ) : null}
    </label>
  )
}

export function IconButton({
  label,
  onClick,
  children,
  variant = 'ghost',
}: {
  label: string
  onClick: () => void
  children: ReactNode
  variant?: 'ghost' | 'solid'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'press flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
        variant === 'solid'
          ? 'bg-accent text-white'
          : 'border border-line bg-surface text-ink-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-wide text-ink-3">{label}</p>
      <p className="mt-1 truncate text-[19px] font-semibold tabular-nums tracking-tight text-ink">
        {value}
      </p>
      {sub ? <p className="text-[11px] text-ink-3">{sub}</p> : null}
    </div>
  )
}

export function SegmentedTabs<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      className={cn('flex gap-1 rounded-full border border-line bg-paper-2 p-1', className)}
      role="tablist"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          data-active={value === option.value}
          className="tab-pill"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="fade-in absolute inset-0 bg-[#0b0b0a]/45 backdrop-blur-[3px]"
      />
      <div
        className={cn(
          'fade-in relative flex max-h-[93dvh] w-full flex-col overflow-hidden rounded-t-[1.7rem] bg-paper sm:rounded-[1.7rem]',
          wide ? 'sm:max-w-[820px]' : 'sm:max-w-[620px]',
        )}
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="press -mr-1 flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer ? (
          <footer className="safe-bottom shrink-0 border-t border-line bg-paper px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '删除',
  tone = 'danger',
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: string
  confirmText?: string
  tone?: 'danger' | 'accent'
  onConfirm: () => void
  onClose: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-5" role="alertdialog" aria-modal="true">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="fade-in absolute inset-0 bg-[#0b0b0a]/45 backdrop-blur-[3px]"
      />
      <div
        className="fade-in relative w-full max-w-[380px] rounded-[1.4rem] border border-line bg-surface p-5"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <h3 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h3>
        <p className="mt-2 text-[13px] leading-5 text-ink-2">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={cn(
              'press inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] font-medium text-white',
              tone === 'danger' ? 'bg-danger' : 'bg-accent',
            )}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}