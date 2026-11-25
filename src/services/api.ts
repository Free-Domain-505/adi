import { fetchTmdbSeasonEpisodesDirect, tmdbDirect, tmdbEpisodesDirect } from './tmdbDirect'
import { sanitizeEpisodeTitle } from '../lib/episodeCountsLogic'

/** Client for the AnimeStream API (Cloudflare Pages Functions in production, Vite middleware in dev). */
const BASE = ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) as string | undefined) ?? ''

/** Root-relative API paths (e.g. the proxied HLS url) are prefixed with VITE_API_BASE when it is set. */
export const apiUrl = (path: string) => (path.startsWith('/') ? BASE + path : path)

/** Cloudflare answers 429 (or its own HTML error page) once the free Workers quota is used up. */
export const failMsg = (res: Response, data: { error?: string } | null) =>
  res.status === 429 || (res.status >= 500 && !data)
    ? "We're on the free plan and today's usage limit is reached. Switch to an embed server, they work normally."
    : (data?.error ?? `Request failed (${res.status})`)

export const tmdbImg = (path: string | null | undefined, size: 'w185' | 'w300' | 'w500' | 'w780' | 'w1280' | 'original' = 'w1280') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null

async function getJson<T>(path: string, timeout = 20000): Promise<T> {
  const ctl = new AbortController()
  const t = window.setTimeout(() => ctl.abort(), timeout)
  try {
    const isZenkaiPlayer = typeof window !== 'undefined' && (window.self !== window.top || window.location.pathname.startsWith('/embed') || window.location.pathname.startsWith('/watch'))
    const headers: Record<string, string> = isZenkaiPlayer ? { 'X-Zenkai-Embed': '1' } : {}
    const res = await fetch(apiUrl(path), { signal: ctl.signal, headers })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(failMsg(res, data as { error?: string } | null))
    return data as T
  } finally {
    window.clearTimeout(t)
  }
}

/* ---------------- AniBridge mapping + TMDB ---------------- */
export interface Mapping {
  anilist: number
  mal: number | null
  tmdb: { id: number; type: 'tv' | 'movie'; season: number | null } | null
  tvdb: number | null
  imdb: string | null
  anidb: number | null
  source: 'anibridge' | 'arm'
}

export interface WatchProvider {
  id: number
  name: string
  logo: string | null
}

export interface WatchProvidersData {
  link?: string | null
  providers: WatchProvider[]
}

export interface TmdbSeasonInfo {
  id: number
  name: string
  seasonNumber: number
  episodeCount: number
  overview?: string | null
  posterPath?: string | null
  airDate?: string | null
}

export interface Tmdb {
  id: number
  name?: string | null
  title?: string | null
  type: 'tv' | 'movie'
  season: number | null
  imdbId: string | null
  logo: string | null
  backdrop: string | null
  poster?: string | null
  backdrops: string[]
  overview: string | null
  tagline: string | null
  rating: number | null
  votes: number | null
  certification: string | null
  networks: string[]
  status: string | null
  language: string | null
  seasons: number | null
  episodes: number | null
  firstAir: string | null
  lastAir: string | null
  runtime: number | null
  cast: { name: string; character: string; photo: string | null }[]
  trailer: string | null
  watchProviders?: WatchProvidersData | null
  seasonsList?: TmdbSeasonInfo[]
}

export interface TmdbBundle {
  mapping: Mapping | null
  tmdb: Tmdb | null
}

const tmdbMem = new Map<string, Promise<TmdbBundle>>()
const tmdbSync = new Map<string, TmdbBundle>()
const DAY = 24 * 3600e3

function readTmdbLs(key: string, format?: string | null): TmdbBundle | null {
  try {
    const raw = localStorage.getItem(`zk:tmdb:v7:${key}`)
    if (!raw) return null
    const { at, v } = JSON.parse(raw) as { at: number; v: TmdbBundle }
    if (Date.now() - at < DAY * 7 && v.tmdb && (format !== 'MOVIE' || v.tmdb.type === 'movie')) {
      return v
    }
  } catch {
    /* ignore corrupt cache */
  }
  return null
}

/** Synchronous cache lookup for already-fetched or localStorage-cached TMDB metadata. */
export function peekTmdb(anilistId?: number | null, format?: string | null): TmdbBundle | null {
  if (!anilistId) return null
  const key = String(anilistId)
  const mem = tmdbSync.get(key)
  if (mem && (format !== 'MOVIE' || !mem.tmdb || mem.tmdb.type === 'movie')) return mem
  const ls = readTmdbLs(key, format)
  if (ls) {
    tmdbSync.set(key, ls)
    return ls
  }
  return null
}

export function fetchTmdb(anilistId: number, title: string, format?: string | null): Promise<TmdbBundle> {
  const key = String(anilistId)
  const syncHit = peekTmdb(anilistId, format)
  if (syncHit) {
    const done = Promise.resolve(syncHit)
    tmdbMem.set(key, done)
    return done
  }

  const hit = tmdbMem.get(key)
  if (hit) return hit

  const lsKey = `zk:tmdb:v7:${key}`
  const q = new URLSearchParams({ id: key, title, format: format ?? '' })
  const viaServer = () => getJson<{ mapping: Mapping | null; tmdb: Tmdb | null }>(`/api/tmdb?${q}`, 10000)
  const p = viaServer()
    .then((r) => (r.tmdb ? r : tmdbDirect(anilistId, title, format)))
    .catch(() => tmdbDirect(anilistId, title, format))
    .then((r) => {
      const v = { mapping: r.mapping, tmdb: r.tmdb }
      if (v.tmdb) {
        tmdbSync.set(key, v)
        try {
          localStorage.setItem(lsKey, JSON.stringify({ at: Date.now(), v }))
        } catch {
          /* storage full */
        }
      } else {
        tmdbMem.delete(key)
      }
      return v
    })
    .catch(() => {
      tmdbMem.delete(key) // retry next time
      return { mapping: null, tmdb: null }
    })
  tmdbMem.set(key, p)
  return p
}

/** One episode, TMDB-first with AniList filling the gaps. `image` is a full url. */
export interface EpInfo {
  n: number
  name: string | null
  overview: string | null
  image: string | null
  runtime: number | null
  air: string | null
}

const epMem = new Map<string, Promise<EpInfo[]>>()
export function fetchTmdbEpisodes(
  tmdbId: number,
  season = 1,
  opts?: { start?: string | null; epCount?: number | null },
): Promise<EpInfo[]> {
  const start = opts?.start || ''
  const epCount = opts?.epCount || 0
  const key = `${tmdbId}:${season}:${start}:${epCount}`
  const hit = epMem.get(key)
  if (hit) return hit
  type Raw = { n: number; name: string | null; overview: string | null; still: string | null; runtime: number | null; air: string | null }
  const q = new URLSearchParams({ id: String(tmdbId), season: String(season), v: '4' })
  if (start) q.set('start', start)
  if (epCount > 0) q.set('epCount', String(epCount))
  const p = getJson<{ episodes: Raw[] }>(`/api/tmdb/episodes?${q}`, 15000)
    .then((r) => (r.episodes?.length ? r.episodes : tmdbEpisodesDirect(tmdbId, season, { start, epCount }) as Promise<Raw[]>))
    .catch(() => tmdbEpisodesDirect(tmdbId, season, { start, epCount }) as Promise<Raw[]>)
    .then((rows) => {
      if (!rows.length) epMem.delete(key)
      return rows.map((e) => ({
        n: e.n,
        name: sanitizeEpisodeTitle(e.name, e.n),
        overview: e.overview,
        image: tmdbImg(e.still, 'w500'),
        runtime: e.runtime,
        air: e.air,
      }))
    })
    .catch(() => {
      epMem.delete(key)
      return [] as EpInfo[]
    })
  epMem.set(key, p)
  return p
}

const directSeasonEpMem = new Map<string, Promise<EpInfo[]>>()

/**
 * Directly fetches /tv/{tmdbId}/season/{seasonNumber} from TMDB without start-date
 * alignment or multi-season merging. Used by the Details Page Season Selector.
 */
export function fetchTmdbSeasonEpisodes(tmdbId: number, seasonNumber: number): Promise<EpInfo[]> {
  const key = `${tmdbId}:s${seasonNumber}`
  const hit = directSeasonEpMem.get(key)
  if (hit) return hit

  type TmdbRawEp = { episode_number?: number; name?: string | null; overview?: string | null; still_path?: string | null; runtime?: number | null; air_date?: string | null }
  const p = getJson<{ episodes?: TmdbRawEp[] }>(`/api/tmdb/tv/${tmdbId}/season/${seasonNumber}?language=en-US`, 15000)
    .then((d) =>
      (d?.episodes || [])
        .filter((e) => Number(e.episode_number) > 0)
        .map((e) => {
          const n = Number(e.episode_number)
          return {
            n,
            name: sanitizeEpisodeTitle(e.name, n),
            overview: e.overview || null,
            image: tmdbImg(e.still_path, 'w500'),
            runtime: e.runtime || null,
            air: e.air_date || null,
          }
        }),
    )
    .catch(() =>
      fetchTmdbSeasonEpisodesDirect(tmdbId, seasonNumber).then((rows) =>
        rows.map((e) => ({
          n: e.n,
          name: sanitizeEpisodeTitle(e.name, e.n),
          overview: e.overview,
          image: tmdbImg(e.still, 'w500'),
          runtime: e.runtime,
          air: e.air,
        })),
      ),
    )
    .then((rows) => {
      if (!rows.length) directSeasonEpMem.delete(key)
      return rows
    })
    .catch(() => {
      directSeasonEpMem.delete(key)
      return [] as EpInfo[]
    })

  directSeasonEpMem.set(key, p)
  return p
}

const fallbackTitleMem = new Map<string, Promise<Record<number, string>>>()

/**
 * Resolve episode titles from backend fallback sources (ani.zip + Jikan MAL)
 * when TMDB & AniList streamingEpisodes only have generic "Episode N" placeholders or omit newly aired episodes.
 */
export function fetchFallbackEpisodeTitles(
  anilistId?: number | null,
  malId?: number | null,
  epHint?: number | null,
): Promise<Record<number, string>> {
  const aid = anilistId && anilistId > 0 ? Math.floor(anilistId) : 0
  const mid = malId && malId > 0 ? Math.floor(malId) : 0
  if (!aid && !mid) return Promise.resolve({})

  const page = epHint && epHint > 100 ? Math.ceil(epHint / 100) : 1
  const key = `${aid}:${mid}:${page}`
  const hit = fallbackTitleMem.get(key)
  if (hit) return hit

  const q = new URLSearchParams()
  if (aid > 0) q.set('anilistId', String(aid))
  if (mid > 0) q.set('malId', String(mid))
  if (epHint && epHint > 0) q.set('ep', String(Math.floor(epHint)))

  const p = getJson<{ ok?: boolean; titles?: Record<string, string> }>(`/api/episodes/titles?${q}`, 10000)
    .then((res) => {
      const out: Record<number, string> = {}
      if (res?.titles && typeof res.titles === 'object') {
        for (const [k, v] of Object.entries(res.titles)) {
          const n = Number(k)
          const clean = sanitizeEpisodeTitle(v, n)
          if (Number.isFinite(n) && n > 0 && clean) out[n] = clean
        }
      }
      if (Object.keys(out).length > 0) return out
      throw new Error('empty')
    })
    .catch(async () => {
      // Direct client fallback via api.ani.zip when server endpoint has no data / offline dev
      if (!aid) return {}
      try {
        const ctl = new AbortController()
        const timer = window.setTimeout(() => ctl.abort(), 5000)
        try {
          const r = await fetch(`https://api.ani.zip/mappings?anilist_id=${aid}`, { signal: ctl.signal })
          if (!r.ok) return {}
          const d = (await r.json()) as { episodes?: Record<string, { title?: Record<string, string | null> }> }
          const out: Record<number, string> = {}
          for (const [k, epObj] of Object.entries(d?.episodes || {})) {
            const n = Number(k)
            if (!Number.isFinite(n) || n <= 0) continue
            const t = epObj?.title || {}
            const candidate =
              sanitizeEpisodeTitle(t.en, n) ||
              sanitizeEpisodeTitle(t['x-jat'], n) ||
              sanitizeEpisodeTitle(t.ja, n)
            if (candidate) out[n] = candidate
          }
          return out
        } finally {
          window.clearTimeout(timer)
        }
      } catch {
        return {}
      }
    })
    .then((out) => {
      if (!Object.keys(out).length) fallbackTitleMem.delete(key)
      return out
    })

  fallbackTitleMem.set(key, p)
  return p
}

/* ---------------- Filler lists ---------------- */
export type EpKind = 'filler' | 'mixed' | 'recap'

/** AnimeFillerList numbers the whole series; `max` lets the caller reject a list that doesn't match this entry. */
export const fetchFillerList = (titles: string[], ep?: number | null) => {
  const qs = titles.map((t) => `t=${encodeURIComponent(t)}`)
  if (ep && ep > 0) qs.push(`ep=${ep}`)
  return getJson<{ success: boolean; max?: number; filler?: number[]; mixed?: number[] }>(`/api/filler?${qs.join('&')}`)
}

/* ---------------- Streams ---------------- */
export interface StreamResult {
  server: string
  audio: 'sub' | 'dub' | 'multi'
  audioLabel?: string
  /** one stream with several audio tracks (ACDN) */
  multiAudio?: boolean
  hindiOnly?: boolean
  streamUrl: string
  rawStreamUrl?: string
  fallbackStreamUrl?: string
  referer?: string
  subtitles: { file: string; label: string; default?: boolean }[]
  intro: { start: number; end: number } | null
  outro: { start: number; end: number } | null
}

type StreamParams = { id: number; ep: number; server: string; audio: string; title: string; romaji?: string | null; format?: string | null; country?: string | null }

const streamMemCache = new Map<string, { time: number; val: StreamResult }>()

export async function fetchStream(p: StreamParams): Promise<StreamResult> {
  const cacheKey = `${p.id}:${p.ep}:${p.server}:${p.audio}:${p.format || ''}:${p.country || ''}`
  const cached = streamMemCache.get(cacheKey)
  if (cached && Date.now() - cached.time < 180000) {
    return cached.val
  }

  const res = await fetchStreamFromApi(p)
  streamMemCache.set(cacheKey, { time: Date.now(), val: res })
  return res
}

async function fetchStreamFromApi(p: StreamParams): Promise<StreamResult> {
  const q = new URLSearchParams({ id: String(p.id), ep: String(p.ep), server: p.server, audio: p.audio, title: p.title })
  if (p.format) q.set('format', p.format)
  if (p.romaji) q.set('romaji', p.romaji)
  if (p.country) q.set('country', p.country)
  const timeoutMs =
    p.server === 'desidubanime' || p.server === 'watchanimeworld' || p.server === 'server12' || p.server === 'anikoto'
      ? 26000
      : 15000
  const r = await getJson<StreamResult & { success: boolean; rawStreamUrl?: string; referer?: string }>(`/api/stream?${q}`, timeoutMs)

  const proxyUrl = apiUrl(r.streamUrl)

  return {
    ...r,
    streamUrl: proxyUrl,
    fallbackStreamUrl: (r as any).fallbackStreamUrl ? apiUrl((r as any).fallbackStreamUrl) : proxyUrl,
    rawStreamUrl: r.rawStreamUrl,
    subtitles: (r.subtitles || []).map((s) => ({
      ...s,
      file: apiUrl(s.file),
    })),
  }
}

export interface AnimeSaltDetails {
  embedUrl: string | null
  server?: string
  slug?: string
  pageUrl?: string | null
  myStreamUrl?: string | null
  abyssUrl?: string | null
  directStreamUrl?: string | null
  directReferer?: string | null
  subtitles?: { file: string; label: string; default?: boolean }[]
  allIframes?: string[]
}

export async function fetchAnimeSaltDetails(p: { id: number; ep: number; title: string; format?: string | null; server: '1' | '2'; audio?: string }): Promise<AnimeSaltDetails> {
  const q = new URLSearchParams({ id: String(p.id), ep: String(p.ep), title: p.title, format: p.format ?? '', server: p.server, audio: p.audio ?? 'multi' })
  const r = await getJson<{ success: boolean; error?: string } & Partial<AnimeSaltDetails>>(`/api/embed/animesalt?${q}`, 40000)
  if (!r.directStreamUrl && !r.embedUrl) throw new Error(r.error ?? 'Not found on AnimeSalt')
  return {
    embedUrl: r.embedUrl ?? null,
    server: r.server,
    slug: r.slug,
    pageUrl: r.pageUrl ?? null,
    myStreamUrl: r.myStreamUrl ?? null,
    abyssUrl: r.abyssUrl ?? null,
    directStreamUrl: r.directStreamUrl ?? null,
    directReferer: r.directReferer ?? null,
    subtitles: (r.subtitles || []).map((s) => ({
      ...s,
      file: apiUrl(s.file),
    })),
    allIframes: r.allIframes ?? [],
  }
}

export async function fetchAnimeSalt(p: { id: number; ep: number; title: string; format?: string | null; server: '1' | '2' }): Promise<string> {
  const res = await fetchAnimeSaltDetails(p)
  if (!res.embedUrl) throw new Error('Embed not available')
  return res.embedUrl
}

export async function fetchReanimeEmbed(p: { id: number; ep: number; audio?: 'sub' | 'dub' }): Promise<string> {
  const q = new URLSearchParams({ id: String(p.id), ep: String(p.ep), audio: p.audio ?? 'sub', format: 'json' })
  const r = await getJson<{ success: boolean; embedUrl?: string; error?: string }>(`/api/embed/reanime?${q}`, 15000)
  if (!r.embedUrl) throw new Error(r.error ?? 'Not found on ReAnime')
  return r.embedUrl
}

let acdnMap: Promise<Record<string, unknown>> | undefined
/** Is this AniList id in public/anime-mapping.json (the only titles ACDN can serve)? Unknown (fetch failed) counts as yes. */
export async function acdnMapped(id: number): Promise<boolean> {
  try {
    acdnMap ??= fetch('/anime-mapping.json').then((r) => r.json())
    return String(id) in (await acdnMap)
  } catch {
    acdnMap = undefined
    return true
  }
}


export interface ServerAudioInfo {
  sub: boolean
  dub: boolean
  dubVerified?: boolean
  multi?: boolean
  languages?: string[]
  episodeCount?: number
}

export type ServerAudioMap = Record<string, ServerAudioInfo>

export async function fetchEpisodeServers(
  id: number,
  ep: number,
  title?: string,
  format?: string | null,
  country?: string | null,
  romaji?: string | null,
  episodes?: number,
  season?: number,
): Promise<ServerAudioMap> {
  const q = new URLSearchParams({ id: String(id), ep: String(ep), v: '8' })
  if (title) q.set('title', title)
  if (romaji) q.set('romaji', romaji)
  if (format) q.set('format', format)
  if (country) q.set('country', country)
  if (episodes && episodes > 0) q.set('episodes', String(episodes))
  if (season && season > 0) q.set('season', String(season))
  try {
    const res = await getJson<{ success: boolean; servers: ServerAudioMap }>(`/api/servers-available?${q}`, 22000)
    return res.servers || {}
  } catch {
    return {}
  }
}

export interface AudioBreakdownData {
  totalEpisodes: number
  airedEpisodes?: number
  originalLanguage: string
  multiDubCount: number
  multiDubPercentage: number
  hasMultiDub: boolean
  dubCount: number
  dubPercentage: number
  hasEnglishDub: boolean
  hindiDubCount?: number
  hindiDubPercentage?: number
  hasHindiDub?: boolean
  subOnlyCount: number
  subOnlyPercentage: number
  hasSubOnly: boolean
  labels: {
    multiDub: string
    multiDubDesc: string
    dualAudio: string
    dualAudioDesc: string
    hindiDub?: string
    hindiDubDesc?: string
    subOnly: string
    subOnlyDesc: string
  }
  insight: string
}

export async function fetchAudioBreakdown(
  id: number,
  episodes: number,
  title?: string,
  country?: string | null,
  season?: number,
  format?: string | null,
  romaji?: string | null,
  airedEpisodes?: number,
): Promise<AudioBreakdownData | null> {
  const q = new URLSearchParams({ id: String(id), episodes: String(episodes), v: '3' })
  if (airedEpisodes && airedEpisodes > 0) q.set('aired', String(airedEpisodes))
  if (title) q.set('title', title)
  if (romaji) q.set('romaji', romaji)
  if (country) q.set('country', country)
  if (season) q.set('season', String(season))
  if (format) q.set('format', format)
  try {
    const res = await getJson<{ success: boolean; breakdown: AudioBreakdownData }>(`/api/anime/audio-breakdown?${q}`, 22000)
    return res.breakdown || null
  } catch {
    return null
  }
}

export interface VerifiedAudioTrack {
  language: string
  type: 'original' | 'dub'
  label: string
  native: string
  verifiedEpisodes: number
  totalEpisodes: number
  isFullCoverage: boolean
  episodeRange: string
  verifiedServers: string[]
}

export interface VerifiedAudioReport {
  animeId: number
  originalLanguage: 'Japanese' | 'Chinese' | 'Korean'
  isDonghua: boolean
  totalEpisodes: number
  hasDub: boolean
  hasMultiDub: boolean
  hasVerifiedStreams?: boolean
  tracks: VerifiedAudioTrack[]
  summaryLine: string
  badgeText: string
  tracksCountLabel: string
  accuracyGuarantee: string
  coverageNote: string
  verifiedServersCount: number
  verifiedAt: number
}

export async function fetchDetectedAudioReport(
  id: number,
  episodes: number,
  title?: string,
  country?: string | null,
  season?: number,
  format?: string | null,
  romaji?: string | null,
  force = false,
): Promise<VerifiedAudioReport | null> {
  const q = new URLSearchParams({ id: String(id), episodes: String(episodes), v: '3' })
  if (title) q.set('title', title)
  if (romaji) q.set('romaji', romaji)
  if (country) q.set('country', country)
  if (season) q.set('season', String(season))
  if (format) q.set('format', format)
  if (force) q.set('force', '1')
  try {
    const res = await getJson<{ success: boolean; report: VerifiedAudioReport }>(`/api/anime/detect-audio?${q}`, 25000)
    return res.report || null
  } catch {
    return null
  }
}


