import { useEffect, useState } from 'react'
import { DownloadSimple, X } from '@phosphor-icons/react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallBanner() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [hidden, setHidden] = useState(
    () => sessionStorage.getItem('travelog.install.dismissed') === '1',
  )

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!eventPresent(promptEvent) || hidden) return null

  return (
    <div className="fade-in fixed inset-x-3 bottom-[calc(84px+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 lg:bottom-4 lg:left-auto lg:right-4 lg:w-[340px]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <DownloadSimple size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-ink">安装旅记到桌面</p>
        <p className="truncate text-caption text-ink-3">离线也能查看过往旅程</p>
      </div>
      <button
        type="button"
        className="press shrink-0 rounded-full bg-accent px-3 py-1.5 text-note font-medium text-white"
        onClick={async () => {
          if (!promptEvent) return
          await promptEvent.prompt()
          await promptEvent.userChoice
          setPromptEvent(null)
        }}
      >
        安装
      </button>
      <button
        type="button"
        aria-label="不再提示"
        className="press shrink-0 text-ink-3"
        onClick={() => {
          sessionStorage.setItem('travelog.install.dismissed', '1')
          setHidden(true)
        }}
      >
        <X size={15} />
      </button>
    </div>
  )
}

function eventPresent(event: InstallPromptEvent | null): event is InstallPromptEvent {
  return event !== null
}