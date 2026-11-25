import { CheckCircle2, RotateCcw } from 'lucide-react'
import { cn } from '../lib/utils'

interface WatchedBadgeProps {
  variant?: 'poster' | 'inline' | 'pill' | 'subtle'
  label?: string
  className?: string
}

export function WatchedBadge({ variant = 'poster', label = 'Watched', className }: WatchedBadgeProps) {
  if (variant === 'poster') {
    return (
      <span
        className={cn(
          'pointer-events-none inline-flex items-center rounded-[3px] bg-black/75 px-2.5 py-1 text-[11px] font-semibold leading-none tracking-normal text-white shadow-sm',
          className,
        )}
      >
        <span>{label}</span>
      </span>
    )
  }

  if (variant === 'subtle') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400',
          className,
        )}
      >
        <CheckCircle2 className="size-3 shrink-0" />
        <span>{label}</span>
      </span>
    )
  }

  if (variant === 'pill') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/80 px-3 py-1 text-xs font-bold text-emerald-400',
          className,
        )}
      >
        <CheckCircle2 className="size-3.5 shrink-0 stroke-[2.4]" />
        <span>{label}</span>
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400',
        className,
      )}
    >
      <CheckCircle2 className="size-3 shrink-0 stroke-[2.4]" />
      <span>{label}</span>
    </span>
  )
}

interface WatchedThumbOverlayProps {
  label?: string
  size?: 'xs' | 'sm' | 'md'
  showReplay?: boolean
  className?: string
  badgeClassName?: string
}

const SIZE_CLASSES = {
  xs: {
    icon: 'size-5 sm:size-6',
    badge: 'bottom-1 right-1 px-1.5 py-0.5 text-[9.5px]',
  },
  sm: {
    icon: 'size-7 sm:size-8',
    badge: 'bottom-1.5 right-1.5 px-2.5 py-1 text-[11px]',
  },
  md: {
    icon: 'size-9 sm:size-10',
    badge: 'bottom-2.5 right-2.5 px-3 py-1.5 text-xs',
  },
} as const

/**
 * Full-thumbnail watched state: subtle dark scrim, centered crisp white replay arrow,
 * and bottom-right dark translucent "Watched" label.
 */
export function WatchedThumbOverlay({
  label = 'Watched',
  size = 'sm',
  showReplay = true,
  className,
  badgeClassName,
}: WatchedThumbOverlayProps) {
  const s = SIZE_CLASSES[size]
  return (
    <>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 z-[2] bg-black/45 transition-opacity duration-200',
          className,
        )}
      />
      {showReplay && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[3] grid place-items-center"
        >
          <RotateCcw
            className={cn('text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]', s.icon)}
            strokeWidth={2.35}
          />
        </span>
      )}
      <span
        className={cn(
          'pointer-events-none absolute z-[4] rounded-[3px] bg-black/75 font-semibold leading-none tracking-normal text-white shadow-sm',
          s.badge,
          badgeClassName,
        )}
      >
        {label}
      </span>
    </>
  )
}
