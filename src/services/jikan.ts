import type { JikanAnimeSummary, JikanFull, JikanStats } from '../types/anime'

/**
 * Jikan (unofficial MyAnimeList API, https://docs.api.jikan.moe) allows ~3 requests/second.
 * Requests are spaced by start time (a slow request never blocks the next one), time out,
 * retry on 429/5xx, are de-duplicated while in flight and cached for the session.
 */
const BASE = 'https://api.jikan.moe/v4'
const GAP = 400
const TIMEOUT = 4200

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const done = new Map<string, unknown>()
const inflight = new Map<string, Promise<unknown>>()
let nextSlot = 0
let jikanDownUntil = 0

async function slot() {
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + GAP
  if (at > now) await sleep(at - now)
}

async function attempt<T>(path: string): Promise<T> {
  await slot()
  const ctl = new AbortController()
  const timer = window.setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctl.signal })
    if (res.status === 429 || res.status >= 500) throw new Error(`retry:${res.status}`)
    if (!res.ok) throw new Error(`MyAnimeList request failed (${res.status})`)
    return ((await res.json()) as { data: T }).data
  } finally {
    window.clearTimeout(timer)
  }
}

async function request<T>(path: string): Promise<T> {
  if (Date.now() < jikanDownUntil) throw new Error('MyAnimeList is unreachable')
  let last: unknown
  for (let i = 0; i < 2; i++) {
    try {
      return await attempt<T>(path)
    } catch (e) {
      last = e
      const retryable = e instanceof DOMException || (e instanceof Error && (e.message.startsWith('retry:') || e.name === 'TypeError'))
      if (!retryable) break
      await sleep(500 * (i + 1))
    }
  }
  jikanDownUntil = Date.now() + 2 * 60_000
  throw last instanceof Error ? last : new Error('MyAnimeList is unreachable')
}

export function get<T>(path: string): Promise<T> {
  if (done.has(path)) return Promise.resolve(done.get(path) as T)
  const pending = inflight.get(path)
  if (pending) return pending as Promise<T>
  const p = request<T>(path)
    .then((d) => {
      done.set(path, d)
      return d
    })
    .finally(() => inflight.delete(path))
  inflight.set(path, p)
  return p
}

export async function fetchMalFull(malId: number): Promise<JikanFull> {
  const localKey = `/api/mal/anime/${malId}`
  if (done.has(localKey)) return done.get(localKey) as JikanFull
  const pending = inflight.get(localKey)
  if (pending) return pending as Promise<JikanFull>

  const p = (async () => {
    try {
      const ctl = new AbortController()
      const t = window.setTimeout(() => ctl.abort(), 6000)
      try {
        const res = await fetch(localKey, { signal: ctl.signal })
        if (res.ok) {
          const json = (await res.json()) as { success?: boolean; data?: JikanFull }
          if (json.success && json.data && json.data.score !== undefined) {
            done.set(localKey, json.data)
            return json.data
          }
        }
      } finally {
        window.clearTimeout(t)
      }
    } catch {}
    return get<JikanFull>(`/anime/${malId}/full`)
  })().finally(() => inflight.delete(localKey))

  inflight.set(localKey, p)
  return p
}
export const fetchMalPictures = (malId: number) =>
  get<{ jpg: { large_image_url: string | null; image_url: string | null } }[]>(`/anime/${malId}/pictures`)
export const fetchMalStats = (malId: number) => get<JikanStats>(`/anime/${malId}/statistics`)
/** MAL's own per-episode filler / recap flags (100 episodes a page). No "mixed" here, that comes from AnimeFillerList. */
export async function fetchMalEpisodeKinds(malId: number) {
  const out = new Map<number, 'filler' | 'recap'>()
  let gotAnyPage = false
  for (let p = 1; p <= 15; p++) {
    try {
      const list = await get<{ mal_id: number; filler: boolean; recap: boolean }[]>(`/anime/${malId}/episodes?page=${p}`)
      gotAnyPage = true
      for (const e of list) if (e.filler || e.recap) out.set(e.mal_id, e.filler ? 'filler' : 'recap')
      if (list.length < 100) break
    } catch {
      break
    }
  }
  return gotAnyPage ? out : null
}

export async function fetchMalTop(limit = 18): Promise<JikanAnimeSummary[]> {
  const key = `/api/mal/top?limit=${limit}`
  if (done.has(key)) return done.get(key) as JikanAnimeSummary[]
  const pending = inflight.get(key)
  if (pending) return pending as Promise<JikanAnimeSummary[]>

  const p = (async () => {
    try {
      const ctl = new AbortController()
      const t = window.setTimeout(() => ctl.abort(), 7000)
      try {
        const res = await fetch(key, { signal: ctl.signal })
        if (res.ok) {
          const json = (await res.json()) as { success?: boolean; data?: JikanAnimeSummary[] }
          if (json.success && Array.isArray(json.data) && json.data.length > 0) {
            done.set(key, json.data)
            return json.data
          }
        }
      } finally {
        window.clearTimeout(t)
      }
    } catch {}
    return get<JikanAnimeSummary[]>(`/top/anime?limit=${limit}&sfw=true`)
  })().finally(() => inflight.delete(key))

  inflight.set(key, p)
  return p
}
