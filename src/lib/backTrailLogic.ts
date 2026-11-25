export interface TrailEntryRecord {
  p: string
  u: string
  b?: string
}

export function isNonBackTargetPath(pathname: string, currentPathname: string, isPlayer: boolean): boolean {
  if (!pathname || pathname === currentPathname) return true
  if (isPlayer) return true
  if (
    pathname === '/auth' ||
    pathname.startsWith('/auth/') ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/embed' ||
    pathname.startsWith('/embed/')
  ) {
    return true
  }
  return false
}

export function findBackEntryInTrail(
  trail: Record<string, TrailEntryRecord>,
  currentIdx: number | null | undefined,
  currentPathname: string,
  isPlayerFn: (p: string) => boolean,
): { delta: number; url: string } | null {
  if (typeof currentIdx !== 'number' || !Number.isFinite(currentIdx) || currentIdx <= 0) {
    return null
  }
  for (let i = currentIdx - 1; i >= 0; i--) {
    const entry = trail[String(i)]
    if (!entry || !entry.p) continue
    if (isNonBackTargetPath(entry.p, currentPathname, isPlayerFn(entry.p))) continue
    return { delta: i - currentIdx, url: entry.u || entry.p }
  }
  return null
}

export function shouldAttemptHistoryBack(historyIdx: number | null | undefined): boolean {
  return typeof historyIdx === 'number' && Number.isFinite(historyIdx) && historyIdx > 0
}
