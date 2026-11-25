import { type ElementType } from 'react'
import { useProfile } from '../lib/profile'
import { resolveNameStylePresentation, sanitizeNameStyle, type NameStyle } from '../lib/nameStyle'
import { getCachedUserNameStyle, useUserNameStyle } from '../lib/userNameStyles'
import { cn } from '../lib/utils'

export interface StyledDisplayNameProps {
  name: string
  styleSpec?: NameStyle | null
  userId?: string | null
  isSelf?: boolean
  as?: ElementType
  className?: string
}

export function StyledDisplayName({
  name,
  styleSpec,
  userId,
  isSelf = false,
  as: Component = 'span',
  className,
}: StyledDisplayNameProps) {
  const me = useProfile()
  const remoteStyle = useUserNameStyle(userId, Boolean(styleSpec || isSelf))
  const rawStyle =
    styleSpec ??
    (isSelf ? me.nameStyle : null) ??
    remoteStyle ??
    (userId ? getCachedUserNameStyle(userId) : null)
  const resolved = rawStyle ? sanitizeNameStyle(rawStyle) : null

  const presentation = resolveNameStylePresentation(resolved)

  return (
    <Component
      className={cn('inline-block font-bold font-black', presentation.className, className)}
      style={presentation.style}
    >
      {name}
    </Component>
  )
}

