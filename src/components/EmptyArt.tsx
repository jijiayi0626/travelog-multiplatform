export function EmptyArt({
  variant = 'compass',
}: {
  variant?: 'compass' | 'notebook' | 'wallet' | 'pin' | 'photo'
}) {
  return (
    <svg viewBox="0 0 96 72" className="h-16 w-20" fill="none" aria-hidden="true">
      <circle cx="72" cy="16" r="7.5" stroke="var(--color-warn)" strokeWidth="1.3" opacity="0.75" />
      <path
        d="M4 52 L24 30 L38 44 L54 24 L80 52"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.75"
      />
      <path d="M4 60 H92" stroke="var(--color-line)" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M58 60 C64 54 70 57 76 50"
        stroke="var(--color-ink-3)"
        strokeWidth="1.1"
        strokeDasharray="3 3"
        strokeLinecap="round"
        opacity="0.65"
      />
      {variant === 'pin' ? (
        <>
          <path
            d="M24 30 c0-4.4 3.6-8 8-8s8 3.6 8 8c0 6-8 12-8 12s-8-6-8-12z"
            stroke="var(--color-accent)"
            strokeWidth="1.4"
            fill="var(--color-accent-soft)"
          />
          <circle cx="32" cy="30" r="2.6" fill="var(--color-accent)" />
        </>
      ) : null}
      {variant === 'notebook' ? (
        <>
          <rect
            x="63"
            y="30"
            width="22"
            height="26"
            rx="3"
            stroke="var(--color-accent)"
            strokeWidth="1.4"
            fill="var(--color-accent-soft)"
          />
          <path
            d="M68 38 H80 M68 44 H78 M68 50 H75"
            stroke="var(--color-accent)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </>
      ) : null}
      {variant === 'wallet' ? (
        <>
          <rect
            x="63"
            y="34"
            width="24"
            height="18"
            rx="3.5"
            stroke="var(--color-accent)"
            strokeWidth="1.4"
            fill="var(--color-accent-soft)"
          />
          <path d="M63 40 H87" stroke="var(--color-accent)" strokeWidth="1.2" />
          <circle cx="80" cy="46" r="2" fill="var(--color-accent)" />
        </>
      ) : null}
      {variant === 'photo' ? (
        <>
          <rect
            x="62"
            y="30"
            width="26"
            height="20"
            rx="3"
            stroke="var(--color-accent)"
            strokeWidth="1.4"
            fill="var(--color-accent-soft)"
          />
          <circle cx="70" cy="37" r="2.2" fill="var(--color-warn)" />
          <path d="M64 48 L72 40 L78 45 L84 39 L88 48 Z" fill="var(--color-accent)" opacity="0.5" />
        </>
      ) : null}
      {variant === 'compass' ? (
        <>
          <circle
            cx="70"
            cy="34"
            r="9"
            stroke="var(--color-accent)"
            strokeWidth="1.4"
            fill="var(--color-accent-soft)"
          />
          <path d="M70 28 L73 37 L70 35 L67 37 Z" fill="var(--color-accent)" />
        </>
      ) : null}
    </svg>
  )
}