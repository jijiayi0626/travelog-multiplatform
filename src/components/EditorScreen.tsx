import type { ReactNode } from 'react'
import { ArrowLeft } from '@phosphor-icons/react'
import { IconButton } from './ui'

export function EditorScreen({
  title,
  onBack,
  onSave,
  saving = false,
  saveDisabled = false,
  saveLabel = '保存',
  children,
  aside,
}: {
  title: string
  onBack: () => void
  onSave: () => void
  saving?: boolean
  saveDisabled?: boolean
  saveLabel?: string
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="fade-in min-h-[100dvh] pb-10">
      <header className="sticky top-0 z-20 -mx-4 mb-5 flex items-center gap-3 border-b border-line bg-paper/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <IconButton label="返回" onClick={onBack}>
          <ArrowLeft size={18} />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-tight text-ink">
          {title}
        </h1>
        <button
          type="button"
          className="btn-primary h-9 px-4 text-[13px]"
          disabled={saveDisabled || saving}
          onClick={onSave}
        >
          {saving ? '保存中…' : saveLabel}
        </button>
      </header>

      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
        {children}
        {aside}
      </div>
    </div>
  )
}

export function FormBlock({
  title,
  children,
  hint,
}: {
  title?: string
  children: ReactNode
  hint?: string
}) {
  return (
    <section className="card space-y-3.5 p-4 sm:p-5">
      {title ? (
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
          {hint ? <span className="text-[11px] text-ink-3">{hint}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}