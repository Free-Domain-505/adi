export interface TapRipple {
  id: number
  x: number
  y: number
  tint: string
}

const DEFAULT_TAP_TINT = '#e8294c'

export function resolveTapTint(
  target: { closest?: (selector: string) => { getAttribute?: (name: string) => string | null } | null } | null | undefined,
  fallbackTint: string,
): string {
  const host = target?.closest?.('[data-tap-tint]')
  const fromEl = host?.getAttribute?.('data-tap-tint')?.trim()
  if (fromEl) return fromEl
  const cleanFallback = fallbackTint.trim()
  return cleanFallback || DEFAULT_TAP_TINT
}

export function appendTapRipple(
  ripples: readonly TapRipple[],
  next: TapRipple,
  maxCount = 8,
): TapRipple[] {
  const safeLimit = Math.max(1, maxCount)
  const clean: TapRipple = {
    id: next.id,
    x: Number.isFinite(next.x) ? Math.round(next.x) : 0,
    y: Number.isFinite(next.y) ? Math.round(next.y) : 0,
    tint: next.tint.trim() || DEFAULT_TAP_TINT,
  }
  const combined = [...ripples, clean]
  return combined.length > safeLimit ? combined.slice(combined.length - safeLimit) : combined
}

export function removeTapRipple(ripples: readonly TapRipple[], id: number): TapRipple[] {
  return ripples.filter((r) => r.id !== id)
}
