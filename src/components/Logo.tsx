import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LOGO_URL } from '../lib/constants'
import { cn } from '../lib/utils'

export function Logo({
  size = 36,
  showText = true,
  className,
  textClassName,
  to = '/home',
}: {
  size?: number
  showText?: boolean
  className?: string
  textClassName?: string
  to?: string
}) {
  const [failed, setFailed] = useState(false)
  return (
    <Link to={to} aria-label="AnimeStream home" className={cn('group inline-flex shrink-0 items-center gap-2.5', className)}>
      {failed ? (
        <span
          className="grid place-items-center rounded-xl bg-foreground font-display text-lg font-black text-background"
          style={{ width: size, height: size }}
        >
          A
        </span>
      ) : (
        <img
          src={LOGO_URL}
          alt="AnimeStream logo"
          width={size}
          height={size}
          onError={(e) => {
            const target = e.currentTarget
            if (target.src !== window.location.origin + '/logo.png') {
              target.src = '/logo.png'
            } else {
              setFailed(true)
            }
          }}
          className="rounded-xl object-contain transition-transform duration-300 group-hover:rotate-[-6deg] group-hover:scale-105"
          style={{ width: size, height: size }}
        />
      )}
      {showText && (
        <span className={cn('font-display text-xl font-extrabold tracking-tight', textClassName)}>
          AnimeStream
        </span>
      )}
    </Link>
  )
}
