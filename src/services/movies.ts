/** Movies + TV: TMDB catalogue (through /api/movies) and the embed servers (through /api/providers). */
import { apiUrl } from './api'
import { listProviders, providerUrl } from '../lib/providers'
import {
  buildEmbedCandidates,
  isHostFrameSandboxed,
  isPotentialAnimeTmdbMovie,
  isTrustedMovieEmbedUrl,
  maskMovieServerLabel,
} from '../lib/movieServers'

export type MediaType = 'movie' | 'tv'

export interface MovieItem {
  id: number
  type: MediaType
  title: string
  poster: string | null
  backdrop: string | null
  year: string | null
  rating: number | null
  overview: string
  genreIds: number[]
}

export interface MovieDetails extends MovieItem {
  tagline: string | null
  runtime: number | null
  status: string | null
  certification: string | null
  genres: { id: number; name: string }[]
  logo: string | null
  trailer: string | null
  votes: number | null
  language: string | null
  seasons: { n: number; name: string; episodes: number }[]
  cast: { id: number; name: string; character: string; photo: string | null }[]
  similar: MovieItem[]
  imdbId: string | null
}

export interface EpisodeItem {
  n: number
  name: string
  overview: string
  still: string | null
  runtime: number | null
  air: string | null
}

export const img = (path: string | null | undefined, size: 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original' = 'w500') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null

/* ---------------- raw TMDB shapes (only what we read) ---------------- */
interface RawItem {
  id: number
  media_type?: string
  title?: string
  name?: string
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string
  first_air_date?: string
  vote_average?: number
  overview?: string
  genre_ids?: number[]
}
interface RawPage {
  results?: RawItem[]
  page?: number
  total_pages?: number
}

const toItem = (r: RawItem, fallback: MediaType): MovieItem | null => {
  const type: MediaType = r.media_type === 'tv' ? 'tv' : r.media_type === 'movie' ? 'movie' : fallback
  if (r.media_type && r.media_type !== 'movie' && r.media_type !== 'tv') return null // people in multi-search
  const title = r.title ?? r.name
  if (!title) return null
  const date = r.release_date ?? r.first_air_date ?? ''
  return {
    id: r.id,
    type,
    title,
    poster: r.poster_path ?? null,
    backdrop: r.backdrop_path ?? null,
    year: date ? date.slice(0, 4) : null,
    rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
    overview: r.overview ?? '',
    genreIds: r.genre_ids ?? [],
  }
}

const mem = new Map<string, Promise<unknown>>()

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const tail = qs.toString() ? `?${qs}` : ''
  const url = apiUrl(`/api/${path}${tail}`)
  const hit = mem.get(url)
  if (hit) return hit as Promise<T>

  const p = (async () => {
    // 1. Primary: Local server API route (direct TMDB v3 + cached)
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (data && !data.error) return data as T
      }
    } catch {}

    // 2. Retry local route once on momentary glitch
    try {
      const retry = await fetch(url, { signal: AbortSignal.timeout(12000) })
      if (retry.ok) {
        const data = await retry.json().catch(() => null)
        if (data && !data.error) return data as T
      }
    } catch {}

    throw new Error('Movie service is currently unavailable')
  })()
  mem.set(url, p)
  p.catch(() => mem.delete(url))
  return p
}

export interface Page {
  items: MovieItem[]
  page: number
  totalPages: number
}

const toPage = (d: RawPage, type: MediaType): Page => ({
  items: (d.results ?? []).map((r) => toItem(r, type)).filter((x): x is MovieItem => !!x && !!x.poster),
  page: d.page ?? 1,
  totalPages: Math.min(d.total_pages ?? 1, 500),
})

export type Shelf = 'trending' | 'popular' | 'top_rated' | 'now_playing' | 'upcoming' | 'airing_today' | 'on_the_air'

export async function fetchShelf(type: MediaType, shelf: Shelf, page = 1): Promise<Page> {
  const path = shelf === 'trending' ? `movies/trending/${type}/week` : `movies/${type}/${shelf}`
  return toPage(await get<RawPage>(path, { page }), type)
}

export const SORTS = [
  { id: 'popularity.desc', label: 'Popular' },
  { id: 'vote_average.desc', label: 'Top rated' },
  { id: 'primary_release_date.desc', label: 'Newest' },
] as const
export type SortId = (typeof SORTS)[number]['id']

export interface BrowseQuery {
  type: MediaType
  query?: string
  genre?: number | null
  year?: string
  sort?: SortId
  page?: number
}

export async function browse(q: BrowseQuery): Promise<Page> {
  const page = q.page ?? 1
  if (q.query?.trim()) return toPage(await get<RawPage>(`movies/search/${q.type}`, { query: q.query.trim(), page, year: undefined }), q.type)
  const tv = q.type === 'tv'
  let sort: string = q.sort ?? 'popularity.desc'
  if (tv && sort === 'primary_release_date.desc') sort = 'first_air_date.desc'
  return toPage(
    await get<RawPage>(`movies/discover/${q.type}`, {
      sort_by: sort,
      with_genres: q.genre ?? undefined,
      [tv ? 'first_air_date_year' : 'primary_release_year']: q.year || undefined,
      // top-rated lists are noisy without a vote floor
      'vote_count.gte': sort.startsWith('vote_average') ? 300 : undefined,
      page,
    }),
    q.type,
  )
}

/** Search endpoint (/api/movies/search): movies and shows together, already normalised by the server. */
export async function searchAll(query: string, type?: MediaType): Promise<MovieItem[]> {
  const t = type ?? 'multi'
  const d = await get<RawPage>(`movies/search/${t}`, { query: query.trim() })
  return (d.results ?? []).map((r) => toItem(r, type ?? 'movie')).filter((x): x is MovieItem => !!x && !!x.poster).slice(0, 20)
}

interface RawDetails extends RawItem {
  tagline?: string
  runtime?: number
  episode_run_time?: number[]
  status?: string
  vote_count?: number
  original_language?: string
  genres?: { id: number; name: string }[]
  external_ids?: { imdb_id?: string | null }
  imdb_id?: string | null
  seasons?: { season_number: number; name: string; episode_count: number }[]
  images?: { logos?: { file_path: string; iso_639_1: string | null; vote_average: number }[] }
  videos?: { results?: { site: string; type: string; key: string; official?: boolean }[] }
  credits?: { cast?: { id: number; name: string; character: string; profile_path: string | null }[] }
  similar?: RawPage
  release_dates?: { results?: { iso_3166_1: string; release_dates?: { certification?: string }[] }[] }
  content_ratings?: { results?: { iso_3166_1: string; rating?: string }[] }
}

export async function fetchDetails(type: MediaType, id: number): Promise<MovieDetails> {
  const d = await get<RawDetails>(`movies/${type}/${id}`, {
    append_to_response: `credits,videos,similar,images,external_ids,${type === 'movie' ? 'release_dates' : 'content_ratings'}`,
    include_image_language: 'en,null',
  })
  const base = toItem({ ...d, media_type: type }, type)
  if (!base) throw new Error('Title not found')
  const logos = (d.images?.logos ?? []).filter((l) => !l.file_path.toLowerCase().endsWith('.svg'))
  const logo = logos.sort((a, b) => Number(b.iso_639_1 === 'en') - Number(a.iso_639_1 === 'en') || b.vote_average - a.vote_average)[0]?.file_path ?? null
  const vids = d.videos?.results ?? []
  const yt = vids.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ?? vids.find((v) => v.site === 'YouTube' && /trailer|teaser/i.test(v.type))
  const cert =
    d.content_ratings?.results?.find((r) => r.iso_3166_1 === 'US')?.rating ||
    d.release_dates?.results?.find((r) => r.iso_3166_1 === 'US')?.release_dates?.find((x) => x.certification)?.certification ||
    null
  return {
    ...base,
    tagline: d.tagline || null,
    runtime: d.runtime || d.episode_run_time?.[0] || null,
    status: d.status || null,
    certification: cert,
    genres: d.genres ?? [],
    logo,
    trailer: yt?.key ?? null,
    votes: d.vote_count ?? null,
    language: d.original_language ?? null,
    seasons: (d.seasons ?? []).filter((s) => s.season_number > 0 && s.episode_count > 0).map((s) => ({ n: s.season_number, name: s.name, episodes: s.episode_count })),
    cast: (d.credits?.cast ?? []).slice(0, 18).map((c) => ({ id: c.id, name: c.name, character: c.character, photo: c.profile_path })),
    similar: (d.similar?.results ?? []).map((r) => toItem(r, type)).filter((x): x is MovieItem => !!x && !!x.poster).slice(0, 18),
    imdbId: d.external_ids?.imdb_id ?? d.imdb_id ?? null,
  }
}

export async function fetchEpisodes(id: number, season: number): Promise<EpisodeItem[]> {
  const d = await get<{ episodes?: { episode_number: number; name?: string; overview?: string; still_path?: string | null; runtime?: number | null; air_date?: string | null }[] }>(`movies/tv/${id}/season/${season}`)
  return (d.episodes ?? []).map((e) => ({ n: e.episode_number, name: e.name ?? `Episode ${e.episode_number}`, overview: e.overview ?? '', still: e.still_path ?? null, runtime: e.runtime ?? null, air: e.air_date ?? null }))
}

/* ---------------- genres (static, so browse never waits on a request) ---------------- */
export const MOVIE_GENRES: { id: number; name: string }[] = [
  { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 16, name: 'Animation' }, { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' }, { id: 18, name: 'Drama' }, { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' }, { id: 36, name: 'History' }, { id: 27, name: 'Horror' }, { id: 10402, name: 'Music' },
  { id: 9648, name: 'Mystery' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Sci-Fi' }, { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' }, { id: 37, name: 'Western' },
]
export const TV_GENRES: { id: number; name: string }[] = [
  { id: 10759, name: 'Action & Adventure' }, { id: 16, name: 'Animation' }, { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' }, { id: 18, name: 'Drama' }, { id: 10751, name: 'Family' }, { id: 10762, name: 'Kids' },
  { id: 9648, name: 'Mystery' }, { id: 10764, name: 'Reality' }, { id: 10765, name: 'Sci-Fi & Fantasy' }, { id: 10768, name: 'War & Politics' },
  { id: 37, name: 'Western' },
]
export const genreName = (type: MediaType, id: number) => (type === 'tv' ? TV_GENRES : MOVIE_GENRES).find((g) => g.id === id)?.name

export const movieHref = (m: Pick<MovieItem, 'type' | 'id'>) => `/movies/${m.type}/${m.id}`
export const watchHref = (m: Pick<MovieItem, 'type' | 'id'>, s?: number, e?: number) =>
  `/movies/watch/${m.type}/${m.id}${m.type === 'tv' ? `?s=${s ?? 1}&e=${e ?? 1}` : ''}`

/* ---------------- embed servers (server-side registry; URLs are only resolved on request) ---------------- */
export interface Provider {
  id: string
  label: string
  /** e.g. 'Multi audio', '4K' */
  tags: string[]
}

export const fetchProviders = async (type: MediaType): Promise<Provider[]> => listProviders(type)

export interface MovieDub {
  id: string
  label: string
  selected?: boolean
}

export interface MovieStream {
  quality: string
  resolutionNum?: number
  hasMultiQuality?: boolean
  heights?: number[]
  language?: string
  format: string
  size?: number
  sizeLabel?: string | null
  duration?: number
  streamUrl: string
  proxyStreamUrl?: string
  altProxyUrl?: string
  downloadUrl: string
  downloadFileName?: string
  rawStreamUrl?: string
  url?: string
}

export interface MovieStreamResult {
  success: boolean
  error?: string
  server: string
  title: string
  subjectId: string
  streamUrl: string
  proxyStreamUrl?: string
  altProxyUrl?: string
  downloadUrl?: string
  rawStreamUrl: string
  quality: string
  format: string
  duration?: number
  dubs: MovieDub[]
  streams: MovieStream[]
  subtitles?: { id: string; label: string; language: string; lang: string; url: string; source: string }[]
  referer: string
}

const MOVIEBOX_SERVICE_URL = ((import.meta.env.VITE_MOVIEBOX_PROXY_URL as string | undefined) || '').replace(/\/+$/, '')

const movieBoxClientInflight = new Map<string, Promise<MovieStreamResult>>()
const vidzeeClientInflight = new Map<string, Promise<VidzeeStreamResponse>>()

export async function fetchMovieBoxStream(p: {
  id: number
  type: MediaType
  season?: number
  episode?: number
  title?: string
  year?: string
  dubId?: string | null
  imdbId?: string | null
}): Promise<MovieStreamResult> {
  const key = `${p.type}:${p.id}:${p.season ?? 1}:${p.episode ?? 1}:${p.dubId || 'default'}`
  const existing = movieBoxClientInflight.get(key)
  if (existing) return existing

  const run = fetchMovieBoxStreamInner(p).finally(() => {
    if (movieBoxClientInflight.get(key) === run) {
      movieBoxClientInflight.delete(key)
    }
  })
  movieBoxClientInflight.set(key, run)
  return run
}

async function fetchMovieBoxStreamInner(p: {
  id: number
  type: MediaType
  season?: number
  episode?: number
  title?: string
  year?: string
  dubId?: string | null
  imdbId?: string | null
}): Promise<MovieStreamResult> {
  const qs = new URLSearchParams({
    id: String(p.id),
    type: p.type,
    s: String(p.season ?? 1),
    e: String(p.episode ?? 1),
  })
  if (p.title) qs.set('title', p.title)
  if (p.year) qs.set('year', p.year)
  if (p.dubId) qs.set('dub', p.dubId)
  if (p.imdbId) qs.set('imdb', p.imdbId)

  let data: any = null
  let resOk = false

  // Local backend resolver first (fast, supports 2160p/1080p H.264 merging + local /proxy)
  try {
    const res = await fetch(apiUrl(`/api/movies/stream?${qs}`), { signal: AbortSignal.timeout(16000) })
    if (res.ok) {
      const d = await res.json().catch(() => null)
      if (d && d.success === true && Array.isArray(d.streams) && d.streams.length > 0) {
        const validStreams = d.streams.filter((s: MovieStream) => !/ailok\.pe/i.test(s.url || s.streamUrl || ''))
        if (validStreams.length > 0) {
          data = { ...d, streams: validStreams }
          resOk = true
        }
      } else if (d?.embedServers?.length && !data) {
        data = d
      }
    }
  } catch {}

  // Optional external MovieBox proxy fallback (only if explicitly configured via VITE_MOVIEBOX_PROXY_URL)
  if (!resOk && MOVIEBOX_SERVICE_URL) {
    const extUrl = `${MOVIEBOX_SERVICE_URL}/api/movies/stream?${qs}`
    try {
      const res = await fetch(extUrl, {
        signal: AbortSignal.timeout(9000),
      })
      if (res.ok) {
        const d = await res.json().catch(() => null)
        if (d && d.success === true && Array.isArray(d.streams) && d.streams.length > 0) {
          const validStreams = d.streams.filter((s: MovieStream) => !/ailok\.pe/i.test(s.url || s.streamUrl || ''))
          if (validStreams.length > 0) {
            data = { ...d, streams: validStreams }
            resOk = true
          }
        } else if (d?.embedServers?.length && !data) {
          data = d
        }
      }
    } catch {}
  }

  // Server already selects the highest quality (1080p+/4K + multi-quality) across dubs and Original;
  // only retry another dub if the current stream itself is low-res (< 720p).
  const maxResOf = (list: MovieStream[]) =>
    Math.max(0, ...list.map((s) => Number(s.resolutionNum || parseInt(String(s.quality || ''), 10) || 0) || 0))
  if (resOk && !p.dubId && Array.isArray(data?.dubs) && data.dubs.length > 1 && maxResOf(data.streams) < 720) {
    const curSelected = data.dubs.find((d: MovieDub) => d.selected)
    const isCurrentlyOriginal = !curSelected || /original/i.test(curSelected.label)
    if (isCurrentlyOriginal) {
      const hindiDub = data.dubs.find((d: MovieDub) => /hindi/i.test(d.label) && !/unverified/i.test(d.label))
      const englishDub = data.dubs.find((d: MovieDub) => /english/i.test(d.label) && !/unverified/i.test(d.label))
      const otherDub = data.dubs.find((d: MovieDub) => !/original/i.test(d.label) && !/unverified/i.test(d.label))
      const targetDub = hindiDub || englishDub || otherDub
      if (targetDub && targetDub.id !== data.subjectId) {
        const dubQs = new URLSearchParams(qs)
        dubQs.set('dub', targetDub.id)
        try {
          const r2 = await fetch(apiUrl(`/api/movies/stream?${dubQs}`), { signal: AbortSignal.timeout(9000) }).catch(() => null)
          const d2 = r2?.ok ? await r2.json().catch(() => null) : null
          if (d2 && d2.success === true && d2.streams?.length > 0) {
            const valid2 = d2.streams.filter((s: MovieStream) => !/ailok\.pe/.test(s.url || s.streamUrl || ''))
            if (valid2.length > 0 && maxResOf(valid2) >= maxResOf(data.streams)) {
              data = { ...d2, streams: valid2, subtitles: d2.subtitles?.length ? d2.subtitles : data.subtitles }
            }
          }
        } catch {}
      }
    }
  }

  if (!data?.success || !data?.streams?.length) {
    throw new Error(data?.error ?? 'Stream not available for this title')
  }

  // Ensure subtitles are populated within a tight budget so stream playback never stalls
  let rawSubs = data.subtitles || []
  if (!rawSubs.length && (p.imdbId || p.id)) {
    try {
      const fetchClientSubs = async () => {
        let imdbId = p.imdbId
        if (!imdbId && p.id) {
          const ext = await get<{ imdb_id?: string }>(`movies/${p.type}/${p.id}/external_ids`).catch(() => null)
          imdbId = ext?.imdb_id
        }
        if (!imdbId) return []
        const osUrl = p.type === 'movie'
          ? `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`
          : `https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${p.season ?? 1}:${p.episode ?? 1}.json`
        const osResp = await fetch(osUrl, { signal: AbortSignal.timeout(1800) }).catch(() => null)
        if (!osResp?.ok) return []
        const osData = await osResp.json().catch(() => null)
        const LANGS: Record<string, string> = {
          eng: 'English', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German', deu: 'German',
          ita: 'Italian', por: 'Portuguese', pob: 'Portuguese (BR)', ara: 'Arabic', rus: 'Russian',
          hin: 'Hindi', jpn: 'Japanese', chi: 'Chinese', zho: 'Chinese', ind: 'Indonesian', tha: 'Thai',
          vie: 'Vietnamese', kor: 'Korean', tur: 'Turkish', pol: 'Polish', dut: 'Dutch', nld: 'Dutch',
          mal: 'Malayalam', ben: 'Bengali', tam: 'Tamil', tel: 'Telugu'
        }
        const count: Record<string, number> = {}
        return (osData?.subtitles || []).slice(0, 60).map((s: { id?: string; lang?: string; url: string }, idx: number) => {
          const lKey = s.lang || 'eng'
          const language = LANGS[lKey] || (lKey ? lKey[0].toUpperCase() + lKey.slice(1) : 'English')
          count[language] = (count[language] || 0) + 1
          return {
            id: s.id || `os_${idx}`,
            label: count[language] > 1 ? `${language} #${count[language]}` : language,
            language,
            lang: lKey,
            url: s.url,
            source: 'OpenSubtitles'
          }
        })
      }
      rawSubs = await Promise.race([
        fetchClientSubs(),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 1800)),
      ])
    } catch (subErr) {
      console.warn('[Stream] Client-side subtitles fallback failed:', subErr)
    }
  }

  const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const resolveProxyStreamUrl = (u?: string, rawUrl?: string) => {
    if (!u) return u
    const isWebMirror = (rawUrl && rawUrl.includes('bcdnxw')) || u.includes('bcdnxw')

    // On local machine (dev server), ALWAYS use the local domestic proxy for bcdnxw
    if (isLocalHost && isWebMirror) {
      let target = rawUrl
      if (!target && u.includes('url=')) {
        try {
          const parsed = new URL(u, window.location.href)
          target = parsed.searchParams.get('url') || undefined
        } catch {}
      }
      return `/proxy?url=${encodeURIComponent(target || u)}&referer=${encodeURIComponent('https://123moviesfree.club/')}`
    }

    if (u.startsWith('http://') || u.startsWith('https://')) return u

    if (isWebMirror) {
      return apiUrl(u.startsWith('/proxy') ? u : `/proxy?url=${encodeURIComponent(rawUrl || u)}&referer=${encodeURIComponent('https://123moviesfree.club/')}`)
    }

    return MOVIEBOX_SERVICE_URL ? `${MOVIEBOX_SERVICE_URL}${u}` : apiUrl(u)
  }

  const resolveStreamUrl = (u?: string, rawUrl?: string) => resolveProxyStreamUrl(u, rawUrl)

  const cleanDubLabel = (lbl: string) =>
    (lbl || 'Audio')
      .replace(/^(?:MovieBox|Vidzee|CineSrc|CinemaOS|Videasy|VidLink|VidFast|VidSrc|PrimeSrc)\s*(?:Direct|Pro)?\s*[·\-:]?\s*/i, '')
      .replace(/\b(?:MovieBox|Vidzee|Direct)\b/gi, '')
      .replace(/^[\s·\-:]+|[\s·\-:]+$/g, '')
      .trim() || 'Original'

  const unwrapSubtitleUrl = (u?: string, rawUrl?: string) => {
    if (rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) return rawUrl
    if (!u) return ''
    if (u.includes('url=')) {
      try {
        const parsed = new URL(u, typeof window !== 'undefined' ? window.location.href : 'http://localhost')
        const inner = parsed.searchParams.get('url')
        if (inner && (inner.startsWith('http://') || inner.startsWith('https://'))) return inner
      } catch {}
    }
    return u
  }

  return {
    ...data,
    dubs: (data.dubs || []).map((d: MovieDub) => ({
      ...d,
      label: cleanDubLabel(d.label),
    })),
    proxyStreamUrl: resolveProxyStreamUrl(data.streamUrl, data.rawStreamUrl),
    altProxyUrl: data.altProxyUrl ? resolveProxyStreamUrl(data.altProxyUrl, data.rawStreamUrl) : undefined,
    streamUrl: resolveStreamUrl(data.streamUrl, data.rawStreamUrl),
    downloadUrl: data.downloadUrl ? resolveProxyStreamUrl(data.downloadUrl, data.rawStreamUrl) : undefined,
    streams: (data.streams || []).map((s: MovieStream) => {
      const direct = s.url || s.rawStreamUrl || ''
      const proxied = resolveProxyStreamUrl(s.streamUrl, s.url)
      return {
        ...s,
        rawStreamUrl: direct,
        proxyStreamUrl: proxied,
        altProxyUrl: s.altProxyUrl ? resolveProxyStreamUrl(s.altProxyUrl, s.url) : undefined,
        streamUrl: resolveStreamUrl(s.streamUrl, s.url),
        downloadUrl: s.downloadUrl ? resolveProxyStreamUrl(s.downloadUrl, s.url) : undefined,
      }
    }),
    subtitles: (rawSubs || []).map((s: { id: string; label: string; language: string; lang: string; url: string; rawUrl?: string; source: string }) => ({
      ...s,
      url: unwrapSubtitleUrl(s.url, s.rawUrl),
    })),
  }
}

export async function resolveProvider(p: { providerId: string; type: MediaType; tmdbId: number; season?: number; episode?: number }): Promise<string> {
  const url = providerUrl(p.providerId, p.type, p.tmdbId, p.season ?? 1, p.episode ?? 1)
  if (!url || !isTrustedMovieEmbedUrl(url)) throw new Error('Could not load this server')
  return url
}

export async function resolveBestMovieEmbed(p: {
  type: MediaType
  tmdbId: number
  season?: number
  episode?: number
  exclude?: readonly string[]
  fallbackProviderId?: string
}): Promise<{ providerId: string; label: string; url: string }> {
  const qs = new URLSearchParams({
    action: 'resolve-best',
    contentType: p.type,
    tmdbId: String(p.tmdbId),
    season: String(p.season ?? 1),
    episode: String(p.episode ?? 1),
  })
  if (p.exclude?.length) qs.set('exclude', p.exclude.join(','))

  try {
    const res = await fetch(apiUrl(`/api/providers?${qs}`), { signal: AbortSignal.timeout(6000) })
    if (res.ok) {
      const data = await res.json().catch(() => null)
      if (data?.verified === true && data?.url && data?.providerId && isTrustedMovieEmbedUrl(data.url)) {
        return { providerId: data.providerId, label: maskMovieServerLabel(data.providerId, data.label), url: data.url }
      }
    }
  } catch {}

  // Never label an unprobed URL as a working source. The caller can retry detection
  // or use the dedicated MovieBox fallback flow when no provider passes verification.
  throw new Error('No verified background server is available right now')
}

export interface WorkingMovieSource {
  kind: 'embed' | 'direct'
  providerId: string
  label: string
  url?: string
  proxyUrl?: string
  adBlocked?: boolean
  tags?: string[]
  streams?: MovieStream[]
  dubs?: MovieDub[]
  subtitles?: any[]
  streamUrl?: string
  altProxyUrl?: string
  quality?: string
}

export interface AnimeMovieMatch {
  isAnimeMovie: boolean
  anilistId?: number
  malId?: number | null
  anime?: {
    id: number
    idMal?: number | null
    title: { romaji: string; english: string | null; native: string | null }
    format: string | null
    status: string | null
    episodes: number | null
    duration: number | null
    seasonYear: number | null
    countryOfOrigin: string | null
    genres: string[]
    bannerImage: string | null
    coverImage: { extraLarge: string | null; large: string | null; color: string | null }
  }
}

const ANILIST_MEDIA_FIELDS = `
  id idMal format status episodes duration seasonYear countryOfOrigin genres bannerImage
  title { romaji english native }
  coverImage { extraLarge large color }
`

async function fetchAniListMediaDirect(anilistId: number) {
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: `query ($id: Int!) { Media(id: $id, type: ANIME) { ${ANILIST_MEDIA_FIELDS} } }`,
        variables: { id: anilistId },
      }),
      signal: AbortSignal.timeout(5500),
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    return json?.data?.Media ?? null
  } catch {
    return null
  }
}

async function searchAniListAnimeMovieDirect(title: string, year?: number | null) {
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: `query ($search: String!) { Page(perPage: 10) { media(type: ANIME, format_in: [MOVIE, OVA, SPECIAL, ONA], search: $search, sort: [SEARCH_MATCH, POPULARITY_DESC], isAdult: false) { ${ANILIST_MEDIA_FIELDS} } } }`,
        variables: { search: title },
      }),
      signal: AbortSignal.timeout(5500),
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    const list = json?.data?.Page?.media
    if (!Array.isArray(list) || list.length === 0) return null

    const norm = (s = '') => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
    const targetNorm = norm(title)
    let best = null
    let bestScore = -1
    for (const item of list) {
      const titles = [item.title?.english, item.title?.romaji, item.title?.native].filter(Boolean)
      const exact = titles.some((t) => norm(t) === targetNorm)
      const contains = titles.some((t) => {
        const nt = norm(t)
        return nt && targetNorm && (nt.includes(targetNorm) || targetNorm.includes(nt))
      })
      const yearDiff = year && item.seasonYear ? Math.abs(year - item.seasonYear) : 0
      if (year && item.seasonYear && yearDiff > 2) continue
      const score = (exact ? 10 : contains ? 5 : 0) + (item.format === 'MOVIE' ? 3 : 0) + (yearDiff === 0 ? 3 : 1)
      if (score > bestScore && (exact || contains)) {
        bestScore = score
        best = item
      }
    }
    return best && (best.format === 'MOVIE' || (best.episodes ?? 1) <= 2) ? best : null
  } catch {
    return null
  }
}

export async function fetchTmdbAnimeMatch(
  id: number,
  meta?: {
    title?: string
    year?: number | string | null
    genres?: { id: number; name: string }[]
    genreIds?: number[]
    language?: string | null
  },
): Promise<AnimeMovieMatch> {
  if (!Number.isFinite(id) || id <= 0) return { isAnimeMovie: false }

  const isPotential = isPotentialAnimeTmdbMovie({
    type: 'movie',
    genres: meta?.genres,
    genreIds: meta?.genreIds,
    language: meta?.language,
  })

  // 1. Primary: Server-side match with full context (ARM exact mapping + AniList)
  try {
    const qs = new URLSearchParams({
      id: String(id),
      type: 'movie',
    })
    if (meta?.title) qs.set('title', meta.title)
    if (meta?.year) qs.set('year', String(meta.year))
    if (meta?.language) qs.set('lang', meta.language)

    const res = await fetch(apiUrl(`/api/movies/anime-match?${qs.toString()}`), {
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as AnimeMovieMatch | null
      if (data?.isAnimeMovie && data.anilistId && data.anime) return data
    }
  } catch {}

  // 2. Client-side resilient fallback (vital on Cloudflare Pages when server TMDB key or outbound fetch times out)
  // Direct ARM lookup from the browser
  try {
    const armRes = await fetch(`https://arm.haglund.dev/api/v2/themoviedb?id=${id}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4500),
    })
    if (armRes.ok) {
      const arr = await armRes.json().catch(() => [])
      if (Array.isArray(arr) && arr.length > 0) {
        const movieHit = arr.find((x) => Number(x?.anilist) > 0 && String(x?.media || '').toUpperCase() === 'MOVIE')
        const singleHit = arr.find((x) => Number(x?.anilist) > 0)
        const anilistId = Number(movieHit?.anilist || singleHit?.anilist)
        if (anilistId > 0) {
          const anime = await fetchAniListMediaDirect(anilistId)
          if (
            anime &&
            (anime.format === 'MOVIE' ||
              ((anime.episodes ?? 1) <= 2 && ['OVA', 'SPECIAL', 'ONA', 'MOVIE'].includes(anime.format || '')))
          ) {
            return { isAnimeMovie: true, anilistId: anime.id, malId: anime.idMal ?? null, anime }
          }
        }
      }
    }
  } catch {}

  // 3. Client-side title search fallback only for Asian-language animated films
  const origLang = String(meta?.language || '').trim().toLowerCase()
  const isAsianLang = ['ja', 'zh', 'ko', 'cn', 'cmn', 'yue', 'jp'].includes(origLang)
  if (isPotential && isAsianLang && meta?.title) {
    try {
      const y = meta.year ? parseInt(String(meta.year), 10) || null : null
      const matched = await searchAniListAnimeMovieDirect(meta.title, y)
      if (matched) {
        return { isAnimeMovie: true, anilistId: matched.id, malId: matched.idMal ?? null, anime: matched }
      }
    } catch {}
  }

  return { isAnimeMovie: false }
}

export interface VidzeeStreamResponse {
  success: boolean
  providerId?: string
  activeLanguage?: string
  streamUrl: string
  altProxyUrl?: string
  streams: MovieStream[]
  dubs: MovieDub[]
  subtitles: { id: string; label: string; language: string; lang: string; url: string; source: string }[]
  error?: string
}

const normProxyUrl = (u?: string) => {
  if (!u) return u
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  return apiUrl(u.startsWith('/') ? u : `/${u}`)
}

const normalizeDirectSource = (src: WorkingMovieSource): WorkingMovieSource => ({
  ...src,
  streamUrl: normProxyUrl(src.streamUrl),
  altProxyUrl: src.altProxyUrl ? normProxyUrl(src.altProxyUrl) : undefined,
  streams: (src.streams || []).map((s) => ({
    ...s,
    streamUrl: normProxyUrl(s.streamUrl) || s.streamUrl,
    proxyStreamUrl: s.proxyStreamUrl ? normProxyUrl(s.proxyStreamUrl) : undefined,
    altProxyUrl: s.altProxyUrl ? normProxyUrl(s.altProxyUrl) : undefined,
  })),
  subtitles: (src.subtitles || []).map((sub: any) => ({
    ...sub,
    url: normProxyUrl(sub.url) || sub.url,
  })),
})

export async function fetchVidzeeStream(p: {
  id: number
  type: MediaType
  season?: number
  episode?: number
  lang?: string | null
}): Promise<VidzeeStreamResponse> {
  const cleanLang = p.lang ? p.lang.replace(/^vidzee:/i, '') : 'default'
  const key = `${p.type}:${p.id}:${p.season ?? 1}:${p.episode ?? 1}:${cleanLang}`
  const existing = vidzeeClientInflight.get(key)
  if (existing) return existing

  const run = (async () => {
    const qs = new URLSearchParams({
      id: String(p.id),
      type: p.type,
      s: String(p.season ?? 1),
      e: String(p.episode ?? 1),
    })
    if (p.lang) qs.set('lang', p.lang.replace(/^vidzee:/i, ''))

    const res = await fetch(apiUrl(`/api/movies/vidzee-stream?${qs}`), { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json().catch(() => null)) as VidzeeStreamResponse | null
    if (!data?.success || !data.streams?.length) {
      throw new Error(data?.error ?? 'Vidzee stream not available for this track')
    }
    return {
      ...data,
      streamUrl: normProxyUrl(data.streamUrl) || '',
      altProxyUrl: data.altProxyUrl ? normProxyUrl(data.altProxyUrl) : undefined,
      streams: data.streams.map((s) => ({
        ...s,
        streamUrl: normProxyUrl(s.streamUrl) || s.streamUrl,
        proxyStreamUrl: s.proxyStreamUrl ? normProxyUrl(s.proxyStreamUrl) : undefined,
        altProxyUrl: s.altProxyUrl ? normProxyUrl(s.altProxyUrl) : undefined,
      })),
      subtitles: (data.subtitles || []).map((sub) => ({
        ...sub,
        url: normProxyUrl(sub.url) || sub.url,
      })),
    }
  })().finally(() => {
    if (vidzeeClientInflight.get(key) === run) {
      vidzeeClientInflight.delete(key)
    }
  })
  vidzeeClientInflight.set(key, run)
  return run
}

export async function resolveMovieEmbedStream(p: {
  id: number
  type: MediaType
  season?: number
  episode?: number
  lang?: string | null
  url?: string | null
  providerId?: string | null
  exclude?: string[]
}): Promise<{ success: boolean; source?: WorkingMovieSource; backups?: WorkingMovieSource[]; error?: string }> {
  const qs = new URLSearchParams({
    id: String(p.id),
    type: p.type,
    s: String(p.season ?? 1),
    e: String(p.episode ?? 1),
  })
  if (p.lang) qs.set('lang', p.lang.replace(/^embed:/i, ''))
  if (p.url && isTrustedMovieEmbedUrl(p.url)) qs.set('url', p.url)
  if (p.providerId) qs.set('providerId', p.providerId)
  if (p.exclude?.length) qs.set('exclude', p.exclude.join(','))

  const res = await fetch(apiUrl(`/api/movies/resolve-embed?${qs}`), { signal: AbortSignal.timeout(18000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json().catch(() => null)
  if (!data?.success || !data.source?.streams?.length) {
    throw new Error(data?.error ?? 'Embed resolver could not extract a direct stream')
  }
  return {
    success: true,
    source: normalizeDirectSource(data.source),
    backups: Array.isArray(data.backups)
      ? data.backups.filter((b: any) => b?.kind === 'direct' && b.streams?.length).map(normalizeDirectSource)
      : [],
  }
}

export interface DetectStreamResponse {
  success: boolean
  source?: WorkingMovieSource
  directBackups?: WorkingMovieSource[]
  backups?: Array<{
    kind: 'embed'
    providerId: string
    label: string
    url: string
    proxyUrl?: string
    adBlocked?: boolean
    tags?: string[]
  }>
  error?: string
}

/**
 * Movie/TV playback prioritizes CinemaOS embed (Priority #1, ad-blocked & blur-free) by default,
 * while preserving MovieBox / Vidzee / Embed-to-Direct direct streams in directBackups for instant
 * CinePlayer switching and non-Original multi-audio dub playback.
 */
export async function detectMovieStream(p: {
  type: MediaType
  id: number
  season?: number
  episode?: number
  title?: string
  year?: string
  imdbId?: string
  skipDirect?: boolean
  skipMovieBox?: boolean
}): Promise<DetectStreamResponse> {
  const sandboxed = isHostFrameSandboxed()
  const qs = new URLSearchParams({
    id: String(p.id),
    type: p.type,
    s: String(p.season ?? 1),
    e: String(p.episode ?? 1),
    sandboxed: sandboxed ? '1' : '0',
  })
  if (p.title) qs.set('title', p.title)
  if (p.year) qs.set('year', p.year)
  if (p.imdbId) qs.set('imdb', p.imdbId)
  if (p.skipDirect) qs.set('skipDirect', '1')
  if (p.skipMovieBox) qs.set('skipMovieBox', '1')

  const normalizeEmbedSource = (src: WorkingMovieSource): WorkingMovieSource => {
    return {
      ...src,
      kind: 'embed',
    }
  }

  // 1. Primary: Unified server-side detection (CinemaOS #1 embed -> direct CinePlayer sources -> backup embeds)
  try {
    const res = await fetch(apiUrl(`/api/movies/detect-stream?${qs}`), { signal: AbortSignal.timeout(18000) })
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as DetectStreamResponse | null
      if (data && data.success && data.source) {
        const validBackups = (data.backups || [])
          .filter((b) => b.providerId !== 'vidzee' && isTrustedMovieEmbedUrl(b.url))
          .map((b) => ({
            ...b,
            ...(b.proxyUrl ? { proxyUrl: normProxyUrl(b.proxyUrl) } : {}),
          }))

        const isDirectAllowed = (src: WorkingMovieSource) => {
          if (src.kind !== 'direct') return false
          if (src.providerId === 'vidzee' && p.skipDirect) return false
          if (src.providerId === 'moviebox' && p.skipMovieBox) return false
          return Boolean(src.streams?.length || src.streamUrl)
        }

        const directBackups = (data.directBackups || [])
          .filter(isDirectAllowed)
          .map(normalizeDirectSource)

        if (data.source.kind === 'embed' && data.source.url && isTrustedMovieEmbedUrl(data.source.url)) {
          return {
            success: true,
            source: normalizeEmbedSource(data.source),
            directBackups,
            backups: validBackups,
          }
        }

        if (isDirectAllowed(data.source)) {
          return {
            ...data,
            source: normalizeDirectSource(data.source),
            directBackups,
            backups: validBackups,
          }
        }

        if (directBackups.length > 0) {
          const [firstDirect, ...restDirect] = directBackups
          return {
            success: true,
            source: firstDirect,
            directBackups: restDirect,
            backups: validBackups,
          }
        }
      }
    }
  } catch (err) {
    console.warn('[detectMovieStream] Server probe error:', err)
  }

  // 2. Client fallback 1: MovieBox Direct (Priority #1)
  if (p.title && !p.skipMovieBox) {
    try {
      const direct = await fetchMovieBoxStream({
        id: p.id,
        type: p.type,
        season: p.season ?? 1,
        episode: p.episode ?? 1,
        title: p.title,
        year: p.year,
        imdbId: p.imdbId,
      })
      if (direct?.success && Array.isArray(direct.streams) && direct.streams.length > 0) {
        return {
          success: true,
          source: {
            kind: 'direct',
            providerId: 'moviebox',
            label: 'Server 1',
            streams: direct.streams,
            dubs: direct.dubs,
            subtitles: direct.subtitles,
            streamUrl: direct.streamUrl,
            altProxyUrl: direct.altProxyUrl,
          },
          directBackups: [],
          backups: [],
        }
      }
    } catch (err) {
      console.warn('[detectMovieStream] MovieBox client fallback error:', err)
    }
  }

  // 3. Client fallback 2: Auto-switch to Server 2 (inside CinePlayer, no iframe embed)
  if (!p.skipDirect && p.id) {
    try {
      const vidDirect = await fetchVidzeeStream({
        id: p.id,
        type: p.type,
        season: p.season ?? 1,
        episode: p.episode ?? 1,
      })
      if (vidDirect?.success && Array.isArray(vidDirect.streams) && vidDirect.streams.length > 0) {
        return {
          success: true,
          source: {
            kind: 'direct',
            providerId: 'vidzee',
            label: 'Server 2',
            streams: vidDirect.streams,
            dubs: vidDirect.dubs,
            subtitles: vidDirect.subtitles,
            streamUrl: vidDirect.streamUrl,
            altProxyUrl: vidDirect.altProxyUrl,
          },
          directBackups: [],
          backups: [],
        }
      }
    } catch (err) {
      console.warn('[detectMovieStream] Vidzee direct client fallback error:', err)
    }
  }

  // 4. Client fallback 3: Dedicated Embed-to-Direct Resolver (keeps playback inside CinePlayer!)
  if (p.id) {
    try {
      const embDirect = await resolveMovieEmbedStream({
        id: p.id,
        type: p.type,
        season: p.season ?? 1,
        episode: p.episode ?? 1,
      })
      if (embDirect?.success && embDirect.source?.streams?.length) {
        return {
          success: true,
          source: embDirect.source,
          directBackups: embDirect.backups || [],
          backups: [],
        }
      }
    } catch (err) {
      console.warn('[detectMovieStream] Embed resolver fallback error:', err)
    }
  }

  // 5. Last-resort fallback: Try resolving candidate embed URL into direct CinePlayer stream
  const candidates = buildEmbedCandidates({
    type: p.type,
    tmdbId: p.id,
    season: p.season,
    episode: p.episode,
    sandboxed,
  }).filter((c) => c.id !== 'vidzee' && isTrustedMovieEmbedUrl(c.url))

  for (const c of candidates.filter((x) => x.id !== 'cinemaos').slice(0, 2)) {
    try {
      const emb = await resolveMovieEmbedStream({
        id: p.id,
        type: p.type,
        season: p.season ?? 1,
        episode: p.episode ?? 1,
        url: c.url,
        providerId: c.id,
      })
      if (emb?.success && emb.source?.streams?.length) {
        return {
          success: true,
          source: emb.source,
          directBackups: emb.backups || [],
          backups: [],
        }
      }
    } catch {}
  }

  // 6. Guaranteed embed fallback (CinemaOS Priority #1) so normal movies & TV shows always play cleanly
  if (candidates.length > 0 && !p.skipDirect && !p.skipMovieBox) {
    const [firstCand, ...restCand] = candidates
    return {
      success: true,
      source: {
        kind: 'embed',
        providerId: firstCand.id,
        label: maskMovieServerLabel(firstCand.id, firstCand.label),
        url: firstCand.url,
        adBlocked: firstCand.id === 'cinemaos',
        tags: firstCand.tags,
      },
      directBackups: [],
      backups: restCand.slice(0, 6).map((b, i) => ({
        kind: 'embed' as const,
        providerId: b.id,
        label: maskMovieServerLabel(b.id, b.label, i + 1),
        url: b.url,
        tags: b.tags,
      })),
    }
  }

  return { success: false, error: 'Playback is currently unavailable for this title.' }
}

