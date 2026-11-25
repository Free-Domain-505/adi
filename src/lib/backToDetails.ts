import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isPlayerPath } from './sections'
import {
  findBackEntryInTrail,
  shouldAttemptHistoryBack,
  type TrailEntryRecord,
} from './backTrailLogic'

const KEY = 'zk:d:'

/** Details pages remember their history slot, so a player's "Details" link can step back to it instead of pushing a duplicate. */
export function useMarkDetails() {
  const { pathname } = useLocation()
  useEffect(() => {
    sessionStorage.setItem(KEY + pathname, String(window.history.state?.idx ?? 0))
  }, [pathname])
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prevHtml = html.style.overscrollBehaviorY
    const prevBody = body.style.overscrollBehaviorY
    html.style.overscrollBehaviorY = 'none'
    body.style.overscrollBehaviorY = 'none'
    return () => {
      html.style.overscrollBehaviorY = prevHtml
      body.style.overscrollBehaviorY = prevBody
    }
  }, [])
}

export function useBackToDetails() {
  const navigate = useNavigate()
  return (to: string) => (e: React.MouseEvent) => {
    const saved = sessionStorage.getItem(KEY + to.split('?')[0])
    const idx = window.history.state?.idx
    if (saved === null || !(idx > Number(saved))) return // not reached via that page: plain link
    e.preventDefault()
    navigate(Number(saved) - idx)
  }
}

const TRAIL = 'zk:trail'

function readTrail(): Record<string, TrailEntryRecord> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TRAIL) || '{}') as Record<string, TrailEntryRecord | string>
    const out: Record<string, TrailEntryRecord> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') out[k] = { p: v, u: v }
      else if (v && typeof v.p === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** Call once in App: remembers which path sits in each history slot (slots are overwritten on push, so it stays accurate). */
export function useTrackHistory() {
  const { pathname, search, hash, key } = useLocation()
  useEffect(() => {
    const idx = window.history.state?.idx
    if (typeof idx !== 'number') return
    const trail = readTrail()
    for (const k of Object.keys(trail)) if (Number(k) > idx) delete trail[k] // forward entries are gone
    trail[idx] = { p: pathname, u: pathname + search + hash }
    try {
      sessionStorage.setItem(TRAIL, JSON.stringify(trail))
    } catch {
      /* storage full / blocked: back falls back to the default */
    }
  }, [pathname, search, hash, key]) // key: episode switches push same-path entries; every slot must be recorded
}

function findBackEntry(pathname: string): { delta: number; url: string } | null {
  const idx = window.history.state?.idx
  return findBackEntryInTrail(readTrail(), idx, pathname, isPlayerPath)
}

/** How many history steps back the nearest non-player page is, or null when there is none (use the fallback). */
export function smartBackDelta(pathname: string): number | null {
  return findBackEntry(pathname)?.delta ?? null
}

function navigateHistoryWithFallback(
  navigate: ReturnType<typeof useNavigate>,
  delta: number,
  fallbackUrl: string,
  currentUrl: string,
) {
  let settled = false
  let timer = 0
  const onPop = () => {
    settled = true
    window.clearTimeout(timer)
  }
  window.addEventListener('popstate', onPop, { once: true })
  navigate(delta)
  timer = window.setTimeout(() => {
    window.removeEventListener('popstate', onPop)
    if (settled) return
    if (window.location.pathname + window.location.search + window.location.hash === currentUrl) {
      navigate(fallbackUrl, { replace: true })
    }
  }, 380)
}

/**
 * Back button for details pages. Steps back to the nearest earlier page that is not a player/reader
 * (or this same page), so Details -> Player -> Details -> Back lands on where you came from, not the player.
 * Includes a popstate-guarded fallback in case history.go(delta) is a no-op in embedded/iframe contexts.
 */
export function useSmartBack(fallback: string) {
  const navigate = useNavigate()
  const { pathname, search, hash } = useLocation()
  return () => {
    const currentUrl = pathname + search + hash
    const hit = findBackEntry(pathname)
    if (hit && hit.delta < 0 && shouldAttemptHistoryBack(window.history.state?.idx)) {
      navigateHistoryWithFallback(navigate, hit.delta, hit.url || fallback, currentUrl)
      return
    }
    if (shouldAttemptHistoryBack(window.history.state?.idx)) {
      navigateHistoryWithFallback(navigate, -1, fallback, currentUrl)
      return
    }
    navigate(hit?.url || fallback, { replace: true })
  }
}

/**
 * General safe back button for find/profile/error screens. Never stalls when history.state.idx === 0
 * (even inside iframes where window.history.length > 1) and recovers automatically if navigate(-1) is a no-op.
 */
export function useSafeBack(fallback: string) {
  const navigate = useNavigate()
  const { pathname, search, hash } = useLocation()
  return () => {
    const currentUrl = pathname + search + hash
    const hit = findBackEntry(pathname)
    if (shouldAttemptHistoryBack(window.history.state?.idx)) {
      navigateHistoryWithFallback(navigate, -1, hit?.url || fallback, currentUrl)
      return
    }
    navigate(hit?.url || fallback, { replace: true })
  }
}
