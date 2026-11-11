import { useEffect } from 'react'
import { Keyboard, X } from '@phosphor-icons/react'

const GROUPS: Array<{ title: string; items: Array<{ keys: string[]; label: string }> }> = [
  {
    title: '全局',
    items: [
      { keys: ['⌘', 'K'], label: '搜索旅行、日程、记录' },
      { keys: ['/'], label: '快速搜索' },
      { keys: ['N'], label: '新建旅程' },
      { keys: ['?'], label: '打开这个面板' },
      { keys: ['ESC'], label: '关闭弹层' },
    ],
  },
  {
    title: '相册 / 灯箱',
    items: [
      { keys: ['←'], label: '上一张' },
      { keys: ['→'], label: '下一张' },
      { keys: ['ESC'], label: '退出灯箱' },
    ],
  },
  {
    title: '页面',
    items: [
      { keys: ['↑', '↓'], label: '搜索结果上下选择' },
      { keys: ['↵'], label: '打开选中项' },
    ],
  },
]

export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[76] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="键盘快捷键"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="fade-in absolute inset-0 bg-[#0b0b0a]/40 backdrop-blur-[3px]"
      />
      <div
        className="fade-in relative w-full max-w-[460px] overflow-hidden rounded-[1.4rem] border border-line bg-surface"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <Keyboard size={17} className="text-accent" />
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight text-ink">键盘快捷键</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="press flex h-8 w-8 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2"
          >
            <X size={16} />
          </button>
        </header>

        <div className="max-h-[60dvh] space-y-4 overflow-y-auto p-5">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{group.title}</h3>
              <ul className="mt-2 space-y-1.5">
                {group.items.map((item) => (
                  <li key={item.label} className="flex items-center gap-2 text-[12.5px]">
                    <span className="flex gap-1">
                      {item.keys.map((key) => (
                        <kbd
                          key={key}
                          className="min-w-[22px] rounded-md border border-line bg-paper-2 px-1.5 py-0.5 text-center text-[10.5px] text-ink-2"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                    <span className="text-ink-2">{item.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="border-t border-line px-5 py-2.5 text-[10.5px] text-ink-3">
          桌面端可用；移动端长按 / 点击右上角搜索图标同样能打开搜索。
        </footer>
      </div>
    </div>
  )
}