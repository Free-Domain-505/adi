import type { HistoryItem, MovieWatchEntry } from './library'
import { WATCHED_THRESHOLD, isContinueCardDone } from './watchedLogic'


export interface UnifiedMovieContinueItem {
  uid: string
  id: number
  source: 'tmdb' | 'anime'
  type: 'movie' | 'tv'
  title: string
  thumb: string | null
  season: number
  episode: number
  epTitle?: string | null
  pos: number
  dur: number
  t: number
  isDone: boolean
  pct: number
  href: string
}

export function formatMovieRemainingTime(pos: number, dur: number, isDone: boolean): string {
  if (isDone) return 'Watched'
  if (dur > 0) {
    const mins = Math.max(1, Math.ceil((dur - pos) / 60))
    return `${mins}m left`
  }
  return 'Resume'
}

export function getMovieProgressPercent(pos: number, dur: number): number {
  if (dur <= 0 || !pos) return 0
  return Math.min(100, Math.max(0, Math.round((pos / dur) * 100)))
}

export function buildMovieContinueHref(input: {
  source: 'tmdb' | 'anime'
  type: 'movie' | 'tv'
  id: number
  season?: number
  episode?: number
}): string {
  if (input.source === 'anime') {
    const ep = input.episode || 1
    return `/watch/${input.id}?ep=${ep}&audio=dub`
  }
  const s = Math.max(1, input.season || 1)
  const e = Math.max(1, input.episode || 1)
  if (input.type === 'tv') {
    return `/movies/watch/tv/${input.id}?s=${s}&e=${e}`
  }
  return `/movies/watch/movie/${input.id}`
}

export function formatTmdbImageUrl(path?: string | null, size: 'w780' | 'w500' | 'original' = 'w780'): string | null {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
    if (path.startsWith('http://') || path.startsWith('https://')) return path
    return `https://image.tmdb.org/t/p/${size}${path}`
  }
  return `https://image.tmdb.org/t/p/${size}/${path}`
}

export function normalizeMovieContinueItem(input: {
  source: 'tmdb' | 'anime'
  type: 'movie' | 'tv'
  id: number
  title: string
  poster?: string | null
  backdrop?: string | null
  epTitle?: string | null
  epImage?: string | null
  season?: number
  episode?: number
  pos?: number
  dur?: number
  t: number
  completed?: boolean
}): UnifiedMovieContinueItem {
  const pos = Math.max(0, Number(input.pos) || 0)
  const dur = Math.max(0, Number(input.dur) || 0)
  const season = Math.max(1, Number(input.season) || 1)
  const episode = Math.max(1, Number(input.episode) || 1)
  const isDone = isContinueCardDone(pos, dur, Boolean(input.completed), WATCHED_THRESHOLD)
  const pct = getMovieProgressPercent(pos, dur)

  let thumb: string | null = null
  if (input.source === 'anime') {
    thumb = input.epImage || input.backdrop || input.poster || null
  } else {
    thumb =
      input.epImage ||
      formatTmdbImageUrl(input.backdrop, 'w780') ||
      formatTmdbImageUrl(input.poster, 'w500') ||
      null
  }

  return {
    uid: `${input.source}:${input.type}:${input.id}`,
    id: input.id,
    source: input.source,
    type: input.type,
    title: input.title || 'Untitled',
    thumb,
    season,
    episode,
    epTitle: input.epTitle || null,
    pos,
    dur,
    t: Number(input.t) || 0,
    isDone,
    pct,
    href: buildMovieContinueHref({
      source: input.source,
      type: input.type,
      id: input.id,
      season,
      episode,
    }),
  }
}

export function selectMovieContinueItems(opts: {
  movieHist: readonly MovieWatchEntry[]
  animeHist: readonly HistoryItem[]
  watchedAnimeIds: ReadonlySet<number>
  limit?: number
}): UnifiedMovieContinueItem[] {
  const { movieHist, animeHist, watchedAnimeIds, limit = 20 } = opts
  const list: UnifiedMovieContinueItem[] = []
  const seen = new Set<string>()

  // 1. TMDB movies & TV series
  for (const m of movieHist) {
    if (!m || !m.id) continue
    const item = normalizeMovieContinueItem({
      source: 'tmdb',
      type: m.type,
      id: m.id,
      title: m.title,
      poster: m.poster,
      backdrop: m.backdrop,
      epTitle: m.epTitle,
      epImage: m.epImage,
      season: m.lastSeason,
      episode: m.lastEp,
      pos: m.pos,
      dur: m.dur,
      t: m.t,
      completed: m.completed,
    })
    if (item.isDone) continue
    if (!seen.has(item.uid)) {
      seen.add(item.uid)
      list.push(item)
    }
  }

  // 2. Anime movies from regular history
  for (const a of animeHist) {
    if (!a || !a.id || a.format !== 'MOVIE') continue
    const item = normalizeMovieContinueItem({
      source: 'anime',
      type: 'movie',
      id: a.id,
      title: a.title,
      poster: a.image,
      backdrop: a.bannerImage,
      epTitle: a.epTitle,
      epImage: a.epImage,
      season: 1,
      episode: a.ep,
      pos: a.pos,
      dur: a.dur,
      t: a.t,
      completed: watchedAnimeIds.has(a.id),
    })
    if (item.isDone) continue
    if (!seen.has(item.uid)) {
      seen.add(item.uid)
      list.push(item)
    }
  }

  return list.sort((a, b) => b.t - a.t).slice(0, limit)
}
