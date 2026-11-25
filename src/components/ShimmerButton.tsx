import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../lib/utils'

interface ShimmerButtonProps {
  children: ReactNode
  className?: string
  variant?: 'solid' | 'ghost'
  icon?: ReactNode
  to?: string
  href?: string
  onClick?: (e: React.MouseEvent) => void
}

/** Pill button with a travelling shine (Magic UI "Shimmer Button"). Renders a Link, anchor or button. */
export function ShimmerButton({
  children,
  className,
  variant = 'solid',
  icon,
  to,
  href,
  onClick,
}: ShimmerButtonProps) {
  const classes = cn(
    'group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full px-6 py-3 text-sm font-semibold transition-colors duration-200',
    variant === 'solid'
      ? 'bg-foreground text-background shadow-lg shadow-foreground/10 hover:opacity-90'
      : 'border border-border bg-card-2 text-foreground hover:bg-card',
    className,
  )

  const inner = (
    <>
      <span className="relative z-10 inline-flex items-center gap-2">
        {icon}
        {children}
      </span>
      <span
        aria-hidden
        className={cn(
          'animate-sweep absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent to-transparent',
          variant === 'solid' ? 'via-background/30' : 'via-foreground/10',
        )}
      />
    </>
  )

  if (to)
    return (
      <Link to={to} onClick={onClick} className={classes}>
        {inner}
      </Link>
    )
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={classes}>
        {inner}
      </a>
    )
  return (
    <button type="button" onClick={onClick} className={classes}>
      {inner}
    </button>
  )
}
