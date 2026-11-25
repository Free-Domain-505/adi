import type { Mapping, Tmdb, TmdbBundle, TmdbSeasonInfo } from './api'

/**
 * Anime TMDB info straight from the browser, the same way Movies already works (no Worker request).
 * Same steps and same result shape as tmdbFor() in server/handler.js; api.ts tries this first and
 * falls back to the /api/tmdb server route when anything here fails.
 */
const TMDB = 'https://zenkai-movies-production.up.railway.app/api/movies'
const ANIBRIDGE = 'https://anibridge.eliasbenb.dev/api/mappings?source.descriptor=anilist:'
const ARM = 'https://arm.haglund.dev/api/v2/ids?source=anilist&id='

/* eslint-disable @typescript-eslint/no-explicit-any */
const get = async (url: string, ms = 12000): Promise<any> => {
  const ctl = new AbortController()
  const t = window.setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } })
    if (!r.ok) throw new Error(String(r.status))
    return await r.json()
  } finally {
    window.clearTimeout(t)
  }
}

function parseMapping(data: unknown, anilist: number): Mapping {
  const out: Mapping = { anilist, mal: null, tmdb: null, tvdb: null, imdb: null, anidb: null, source: 'anibridge' }
  const seen: string[] = []
  const walk = (v: any) => {
    if (!v) return
    if (typeof v === 'string') {
      if (/^[a-z_]+:[^\s]+$/i.test(v)) seen.push(v)
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(data)
  for (const d of seen) {
    const [provider, id, scope] = d.split(':')
    const p = provider.toLowerCase()
    const season = scope && /^s\d+$/i.test(scope) ? parseInt(scope.slice(1), 10) : null
    if ((p === 'mal' || p === 'myanimelist') && !out.mal) out.mal = Number(id) || null
    else if (p.startsWith('tmdb') && !out.tmdb) out.tmdb = { id: Number(id), type: p.includes('movie') ? 'movie' : 'tv', season }
    else if (p.startsWith('tvdb') && !out.tvdb) out.tvdb = Number(id) || null
    else if (p.startsWith('imdb') && !out.imdb) out.imdb = id
    else if (p === 'anidb' && !out.anidb) out.anidb = Number(id) || null
  }
  return out
}

async function mapOf(anilist: number): Promise<Mapping | null> {
  if (anilist === 900001) {
    return { anilist: 900001, mal: null, tmdb: { id: 2777, type: 'tv', season: 1 }, tvdb: null, imdb: null, anidb: null, source: 'anibridge' }
  }
  if (anilist === 900002) {
    return { anilist: 900002, mal: null, tmdb: { id: 205048, type: 'movie', season: null }, tvdb: null, imdb: null, anidb: null, source: 'anibridge' }
  }
  if (anilist === 21220) {
    return { anilist: 21220, mal: 28755, tmdb: { id: 347201, type: 'movie', season: null }, tvdb: 79824, imdb: 'tt4618398', anidb: 10961, source: 'arm' }
  }
  try {
    const m = parseMapping(await get(ANIBRIDGE + anilist, 4500), anilist)
    if (m.mal || m.tmdb || m.imdb) return m
  } catch {
    /* try ARM */
  }
  try {
    const a = await get(ARM + anilist, 4500)
    const hasTvSeason = a?.['themoviedb-season'] !== undefined && a?.['themoviedb-season'] !== null
    const isMovie = !hasTvSeason && String(a.media || a.type || '').toUpperCase() === 'MOVIE'
    return {
      anilist,
      mal: a.myanimelist ?? null,
      tmdb: a.themoviedb ? { id: a.themoviedb, type: isMovie ? 'movie' : 'tv', season: a['themoviedb-season'] ?? null } : null,
      tvdb: a.thetvdb ?? null,
      imdb: a.imdb ?? null,
      anidb: a.anidb ?? null,
      source: 'arm',
    }
  } catch {
    return null
  }
}

const cleanTitle = (t = '') =>
  t
    .replace(/\s*\(\d{4}\)\s*$/g, '')
    .replace(/\s*(Final Season|Season\s+\d+|\d+(st|nd|rd|th)\s+Season|Cour\s+\d+|Part\s+\d+)\s*$/gi, '')
    .replace(/\s*:\s*$/, '')
    .trim()

const isAnimeCandidateResult = (r: any) => {
  if (!r) return false
  const genres = Array.isArray(r.genre_ids) ? r.genre_ids : []
  const lang = String(r.original_language || '').toLowerCase()
  return genres.includes(16) || ['ja', 'zh', 'ko', 'cn'].includes(lang)
}

const isValidAnimeTmdbDetails = (d: any, mapImdb?: string | null) => {
  if (!d) return false
  const dImdb = d.external_ids?.imdb_id || d.imdb_id || null
  if (mapImdb && dImdb && mapImdb !== dImdb) return false
  const genres = Array.isArray(d.genres) ? d.genres.map((g: any) => Number(g.id)) : []
  const lang = String(d.original_language || '').toLowerCase()
  const countries = [
    ...(Array.isArray(d.origin_country) ? d.origin_country : []),
    ...(Array.isArray(d.production_countries) ? d.production_countries.map((c: any) => c.iso_3166_1) : []),
  ].map((c: any) => String(c || '').toUpperCase())
  const isAnim = genres.includes(16)
  const isAsian = ['ja', 'zh', 'ko', 'cn'].includes(lang) || countries.some((c: string) => ['JP', 'CN', 'KR', 'TW', 'HK'].includes(c))
  return isAnim || isAsian
}

export async function tmdbDirect(anilistId: number, title: string, format?: string | null): Promise<TmdbBundle> {
  const map = anilistId ? await mapOf(anilistId) : null
  let ref = map?.tmdb ? { id: map.tmdb.id, type: map.tmdb.type, season: map.tmdb.season } : null
  const isAnimeMovie = String(format || '').toUpperCase() === 'MOVIE'

  const searchTmdbFallback = async (forceMovie = false) => {
    if (!title) return null
    try {
      const qTitle = cleanTitle(title) || title
      if (forceMovie) {
        const res = await get(`${TMDB}/search/movie?query=${encodeURIComponent(qTitle)}`)
        const results = Array.isArray(res?.results) ? res.results : []
        const hit = results.find(isAnimeCandidateResult) || results[0]
        if (hit && isAnimeCandidateResult(hit)) return { id: hit.id, type: 'movie' as const, season: null }
      }
      const want = isAnimeMovie ? 'movie' : 'tv'
      const res = await get(`${TMDB}/search/multi?query=${encodeURIComponent(qTitle)}`)
      const results = Array.isArray(res?.results) ? res.results : []
      const hit =
        results.find((r: any) => r.media_type === want && isAnimeCandidateResult(r)) ||
        results.find((r: any) => (r.media_type === 'tv' || r.media_type === 'movie') && isAnimeCandidateResult(r))
      if (hit) return { id: hit.id, type: hit.media_type as 'tv' | 'movie', season: null }
    } catch {
      /* no match */
    }
    return null
  }

  if (isAnimeMovie && ref && ref.type !== 'movie') {
    const movieHit = await searchTmdbFallback(true)
    if (movieHit) ref = movieHit
  }
  if (!ref && title) {
    ref = await searchTmdbFallback(isAnimeMovie)
  }
  if (!ref) return { mapping: map, tmdb: null }

  const fetchDetailsForRef = (r: { id: number; type: 'tv' | 'movie'; season: number | null }) =>
    get(
      `${TMDB}/${r.type}/${r.id}?language=en-US&append_to_response=images,videos,credits,external_ids,content_ratings,release_dates,watch/providers&include_image_language=en,null`,
    )

  let d: any = null
  try {
    d = await fetchDetailsForRef(ref)
    if (!isValidAnimeTmdbDetails(d, map?.imdb)) {
      d = null
      throw new Error('Non-anime TMDB mismatch')
    }
  } catch {
    if (title) {
      const fb = await searchTmdbFallback(isAnimeMovie)
      if (fb && (fb.id !== ref.id || fb.type !== ref.type)) {
        ref = fb
        const cand = await fetchDetailsForRef(ref).catch(() => null)
        if (cand && isValidAnimeTmdbDetails(cand, null)) {
          d = cand
        }
      }
    }
  }
  if (!d) return { mapping: map, tmdb: null }
  const pngs = (d.images?.logos || []).filter((l: any) => l.file_path && !l.file_path.toLowerCase().endsWith('.svg'))
  const logo = pngs.sort((a: any, b: any) => Number(b.iso_639_1 === 'en') - Number(a.iso_639_1 === 'en') || b.vote_average - a.vote_average)[0]?.file_path ?? null
  const textless = (d.images?.backdrops || []).filter((b: any) => !b.iso_639_1).sort((a: any, b: any) => b.vote_average - a.vote_average)
  const backdrops: string[] = (textless.length ? textless : d.images?.backdrops || []).slice(0, 16).map((b: any) => b.file_path)
  const certification =
    d.content_ratings?.results?.find((r: any) => r.iso_3166_1 === 'US')?.rating ||
    d.release_dates?.results?.find((r: any) => r.iso_3166_1 === 'US')?.release_dates?.find((x: any) => x.certification)?.certification ||
    null
  const yt = (d.videos?.results || []).find((v: any) => v.site === 'YouTube' && /trailer|teaser/i.test(v.type))

  const wpResults = (d['watch/providers'] || d.watch_providers)?.results || {}
  const wpCountry = wpResults['US'] || wpResults['IN'] || wpResults['GB'] || Object.values(wpResults)[0] as any
  const flat = wpCountry?.flatrate || wpCountry?.ads || wpCountry?.buy || []
  const watchProviders = flat.length > 0 ? {
    link: wpCountry?.link || null,
    providers: flat.slice(0, 8).map((p: any) => ({
      id: p.provider_id,
      name: p.provider_name,
      logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null,
    })),
  } : null

  const tmdb: Tmdb = {
    id: ref.id,
    name: d.name || d.title || null,
    title: d.title || d.name || null,
    type: ref.type,
    season: ref.season,
    imdbId: d.external_ids?.imdb_id || map?.imdb || null,
    logo,
    backdrop: d.backdrop_path || backdrops[0] || null,
    poster: d.poster_path || null,
    backdrops,
    overview: d.overview || null,
    tagline: d.tagline || null,
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    votes: d.vote_count || null,
    certification,
    networks: (d.networks || d.production_companies || []).slice(0, 4).map((n: any) => n.name),
    status: d.status || null,
    language: d.original_language || null,
    seasons: d.number_of_seasons ?? null,
    episodes: d.number_of_episodes ?? null,
    firstAir: d.first_air_date || d.release_date || null,
    lastAir: d.last_air_date || null,
    runtime: d.episode_run_time?.[0] || d.runtime || null,
    cast: (d.credits?.cast || []).slice(0, 10).map((c: any) => ({ name: c.name, character: c.character, photo: c.profile_path })),
    trailer: yt ? yt.key : null,
    watchProviders,
    seasonsList: Array.isArray(d.seasons)
      ? d.seasons
          .filter((s: any) => Number(s.season_number) > 0)
          .map((s: any) => ({
            id: s.id,
            name: s.name || `Season ${s.season_number}`,
            seasonNumber: Number(s.season_number),
            episodeCount: Number(s.episode_count) || 0,
            overview: s.overview || null,
            posterPath: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
            airDate: s.air_date || null,
          }))
          .sort((a: any, b: any) => a.seasonNumber - b.seasonNumber)
      : [],
  }
  return { mapping: map, tmdb }
}

/**
 * 1. ID Mapping & Donghua Fallback:
 * Maps the current AniList / MAL ID to a TMDB TV Show ID.
 * - Primary: Map via external IDs (TMDB /find endpoint or anime-relations / AniBridge / ARM).
 * - Fallback (For Donghua): If the ID mapping fails, use the TMDB /search/tv endpoint
 *   querying the English, Romaji, or Pinyin titles (fetched from AniList) to find the correct TMDB ID.
 */
export async function mapAniListToTmdbId(
  anilistId: number,
  titles: { english?: string | null; romaji?: string | null; native?: string | null } = {},
): Promise<number | null> {
  // Primary: Map via external IDs
  try {
    const map = await mapOf(anilistId)
    if (map?.tmdb?.id && map.tmdb.type === 'tv') {
      return map.tmdb.id
    }
    if (map?.imdb) {
      const res = await get(`${TMDB}/find/${map.imdb}?external_source=imdb_id`).catch(() => null)
      if (res?.tv_results?.length) return res.tv_results[0].id
    }
    if (map?.tvdb) {
      const res = await get(`${TMDB}/find/${map.tvdb}?external_source=tvdb_id`).catch(() => null)
      if (res?.tv_results?.length) return res.tv_results[0].id
    }
  } catch {
    /* fallback to search */
  }

  // Fallback (For Donghua & unmapped shows):
  // Query TMDB /search/tv with English, Romaji, and Pinyin / Native titles
  const queries = [
    titles.english,
    titles.romaji,
    titles.native,
  ]
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .flatMap((t) => [cleanTitle(t), t])
    .filter((t, i, arr) => t && arr.indexOf(t) === i)

  for (const q of queries) {
    try {
      const res = await get(`${TMDB}/search/tv?query=${encodeURIComponent(q)}&language=en-US`)
      const results = Array.isArray(res?.results) ? res.results : []
      if (!results.length) continue
      const hit = results.find(isAnimeCandidateResult) || results[0]
      if (hit && hit.id) {
        return hit.id
      }
    } catch {
      // try next candidate title
    }
  }

  return null
}

/**
 * 2. Fetch Seasons (TMDB):
 * Once the TMDB ID is found, fetches the /tv/{series_id} endpoint to get the seasons array (ignoring Season 0).
 */
export async function fetchTmdbTvSeasons(tmdbSeriesId: number): Promise<TmdbSeasonInfo[]> {
  try {
    const d = await get(`${TMDB}/tv/${tmdbSeriesId}?language=en-US`)
    if (!d || !Array.isArray(d.seasons)) return []
    return d.seasons
      .filter((s: any) => Number(s.season_number) > 0) // Ignore Season 0 (Specials)
      .map((s: any) => ({
        id: s.id,
        name: s.name || `Season ${s.season_number}`,
        seasonNumber: Number(s.season_number),
        episodeCount: Number(s.episode_count) || 0,
        overview: s.overview || null,
        posterPath: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
        airDate: s.air_date || null,
      }))
      .sort((a: TmdbSeasonInfo, b: TmdbSeasonInfo) => a.seasonNumber - b.seasonNumber)
  } catch {
    return []
  }
}

/** Fetch only landscape backdrops for a title (sorted by votes, textless first). */
export async function tmdbBackdrops(type: string, id: number): Promise<string[]> {
  try {
    const d = await get(`${TMDB}/${type}/${id}/images?include_image_language=en,null`)
    const byVotes = (a: any, b: any) => b.vote_average - a.vote_average
    const bd = (d.backdrops || []).sort((a: any, b: any) => Number(!!a.iso_639_1) - Number(!!b.iso_639_1) || byVotes(a, b))
    return bd.slice(0, 30).map((i: any) => `https://image.tmdb.org/t/p/w1280${i.file_path}`)
  } catch {
    return []
  }
}

/** Every TMDB backdrop + poster for a title (textless backdrops first). */
export async function tmdbGallery(type: string, id: number): Promise<string[]> {
  const d = await get(`${TMDB}/${type}/${id}/images?include_image_language=en,null`)
  const byVotes = (a: any, b: any) => b.vote_average - a.vote_average
  const bd = (d.backdrops || []).sort((a: any, b: any) => Number(!!a.iso_639_1) - Number(!!b.iso_639_1) || byVotes(a, b))
  const ps = (d.posters || []).sort(byVotes)
  return [...bd.slice(0, 40), ...ps.slice(0, 20)].map((i: any) => `https://image.tmdb.org/t/p/w1280${i.file_path}`)
}

const fetchTmdbPath = async (sub: string, ms = 12000): Promise<any> => {
  try {
    return await get(`/api/movies/${sub}`, ms)
  } catch {
    return await get(`${TMDB}/${sub}`, ms)
  }
}

export async function tmdbEpisodesDirect(
  tmdbId: number,
  season: number,
  opts?: { start?: string | null; epCount?: number | null },
): Promise<{ n: number; name: string | null; overview: string | null; still: string | null; runtime: number | null; air: string | null }[]> {
  const epCount = opts?.epCount || 0
  const DAY_MS = 86400e3
  const parseIsoMs = (s?: string | null) => {
    if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null
    const ms = Date.parse(s.slice(0, 10) + 'T00:00:00Z')
    return Number.isFinite(ms) ? ms : null
  }
  const startMs = parseIsoMs(opts?.start)

  const mapRows = (eps: any[]) =>
    (eps || [])
      .filter((e: any) => Number(e.episode_number) > 0)
      .map((e: any) => ({
        n: Number(e.episode_number),
        name: e.name || null,
        overview: e.overview || null,
        still: e.still_path || null,
        runtime: e.runtime || null,
        air: e.air_date || null,
      }))

  const alignByStartDate = (episodes: ReturnType<typeof mapRows>) => {
    if (!episodes.length || !startMs) return episodes
    const threshold = startMs - 35 * DAY_MS
    const firstDated = episodes.find((e) => parseIsoMs(e.air) !== null)
    if (!firstDated) return episodes
    const firstMs = parseIsoMs(firstDated.air)!
    if (firstMs >= threshold) {
      return epCount > 0 && episodes.length > epCount ? episodes.slice(0, epCount) : episodes
    }
    const idx = episodes.findIndex((e) => {
      const ms = parseIsoMs(e.air)
      return ms !== null && ms >= threshold
    })
    if (idx === -1) return []
    const sliced = epCount > 0 ? episodes.slice(idx, idx + epCount) : episodes.slice(idx)
    return sliced.map((e, i) => ({ ...e, n: i + 1 }))
  }

  let showMeta: any = null
  try {
    showMeta = await fetchTmdbPath(`tv/${tmdbId}?language=en-US`)
  } catch {
    showMeta = null
  }
  let tmdbSeasons: any[] = (showMeta?.seasons || []).filter((s: any) => Number(s.season_number) >= 1 && (s.episode_count ?? 1) > 0)

  let targetSeason = season
  if (tmdbSeasons.length > 0) {
    const hasRequested = tmdbSeasons.some((s: any) => Number(s.season_number) === season)
    if (startMs) {
      let best: any = null
      let bestDiff = Infinity
      for (const s of tmdbSeasons) {
        const sMs = parseIsoMs(s.air_date)
        if (sMs === null) continue
        const diff = Math.abs(sMs - startMs)
        if (sMs >= startMs - 35 * DAY_MS && sMs <= startMs + 45 * DAY_MS && diff < bestDiff) {
          best = s
          bestDiff = diff
        }
      }
      if (!best) {
        const eligible = tmdbSeasons
          .map((s: any) => ({ s, ms: parseIsoMs(s.air_date) }))
          .filter((x) => x.ms !== null && x.ms <= startMs + 45 * DAY_MS)
          .sort((a, b) => a.ms! - b.ms!)
        if (eligible.length > 0) best = eligible[eligible.length - 1].s
      }
      if (best) targetSeason = Number(best.season_number)
      else if (!hasRequested) targetSeason = Number(tmdbSeasons[tmdbSeasons.length - 1].season_number)
    } else if (!hasRequested) {
      return []
    }
  }

  const fetchRemainingSeasons = async (base: ReturnType<typeof mapRows>, fromSeason: number) => {
    if (!base.length || epCount <= base.length + 2) return base
    try {
      const seasons: number[] = tmdbSeasons
        .map((s: any) => Number(s.season_number))
        .filter((n: number) => Number.isFinite(n) && n > fromSeason)
        .sort((a: number, b: number) => a - b)
      if (!seasons.length) return base
      const combined = [...base]
      for (let i = 0; i < seasons.length && combined.length < epCount; i += 8) {
        const batch = seasons.slice(i, i + 8)
        const pages = await Promise.all(
          batch.map((sNum) =>
            fetchTmdbPath(`tv/${tmdbId}/season/${sNum}?language=en-US`)
              .then((d) => mapRows(d.episodes || []))
              .catch(() => []),
          ),
        )
        for (const rows of pages) combined.push(...rows)
      }
      return combined.slice(0, epCount).map((e, idx) => ({ ...e, n: idx + 1 }))
    } catch {
      return base
    }
  }

  tmdbSeasons = [...tmdbSeasons].sort((a, b) => Number(a.season_number) - Number(b.season_number))
  const s1Count = Number(tmdbSeasons.find((s: any) => Number(s.season_number) === 1)?.episode_count || 0)
  const totalSeasonEps = tmdbSeasons.reduce((sum: number, s: any) => sum + (Number(s.episode_count) || 0), 0)

  // Only consult absolute episode_groups when Season 1 alone doesn't already cover the show
  if (targetSeason === 1 && (epCount <= 0 ? tmdbSeasons.length > 1 : s1Count < epCount)) {
    try {
      const eg = await fetchTmdbPath(`tv/${tmdbId}/episode_groups`, 8000)
      const groups: Array<{ id: string; name: string; type: number }> = eg?.results || []
      const isUnwantedGroup = (g: { name?: string }) =>
        /\b(recut|kai|yaba[iï]?|edited|no\s*filler|filler\s*free|china\s*online)\b/i.test(g?.name || '')
      const usable = groups.filter((g) => !isUnwantedGroup(g))
      const best =
        usable.find((g) => g.type === 2 && /no specials/i.test(g.name)) ||
        usable.find((g) => g.type === 2 && /absolute/i.test(g.name)) ||
        usable.find((g) => g.type === 2) ||
        usable.find((g) => /absolute|correct order/i.test(g.name))

      if (best) {
        const d = await fetchTmdbPath(`tv/episode_group/${best.id}?language=en-US`, 12000)
        const pool = (d.groups || []).filter((g: any) => !/special/i.test(g.name || '') && g.order !== 0)
        const list = pool.length ? pool : d.groups || []
        let eps: any[] = []
        if (list.length === 1) {
          eps = list[0].episodes || []
        } else if (list.length > 1) {
          const sorted = [...list].sort((a: any, b: any) => (b.episodes?.length || 0) - (a.episodes?.length || 0))
          const largest = sorted[0]
          const second = sorted[1]
          if (largest && (!second || (largest.episodes?.length || 0) > (second.episodes?.length || 0) * 2)) {
            eps = largest.episodes || []
          } else {
            const inOrder = [...list].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
            eps = inOrder.flatMap((g: any) => g.episodes || [])
          }
        }
        const meetsEpCount = epCount > 0 ? eps.length >= Math.floor(epCount * 0.92) : eps.length >= Math.floor(totalSeasonEps * 0.9)
        const beatsS1 = eps.length >= Math.floor(s1Count * 0.95)
        if (eps.length > 0 && meetsEpCount && beatsS1) {
          const raw = eps.map((e: any, idx: number) => ({
            n: typeof e.order === 'number' && e.order >= 0 ? e.order + 1 : idx + 1,
            name: e.name || null,
            overview: e.overview || null,
            still: e.still_path || null,
            runtime: e.runtime || null,
            air: e.air_date || null,
          }))
          return alignByStartDate(raw)
        }
      }
    } catch {
      /* fallback to season fetching */
    }
  }

  const d = await fetchTmdbPath(`tv/${tmdbId}/season/${targetSeason}?language=en-US`)
  const aligned = alignByStartDate(mapRows(d.episodes || []))
  return fetchRemainingSeasons(aligned, targetSeason)
}

/**
 * Direct TMDB Season fetcher for the unified Season Selector:
 * Fetches strictly /tv/{series_id}/season/{season_number} with ZERO start-date alignment
 * or multi-season concatenation, ensuring Season N renders only Season N episodes.
 */
export async function fetchTmdbSeasonEpisodesDirect(
  tmdbId: number,
  seasonNumber: number,
): Promise<{ n: number; name: string | null; overview: string | null; still: string | null; runtime: number | null; air: string | null }[]> {
  const d = await fetchTmdbPath(`tv/${tmdbId}/season/${seasonNumber}?language=en-US`, 15000)
  return (d?.episodes || [])
    .filter((e: any) => Number(e.episode_number) > 0)
    .map((e: any) => ({
      n: Number(e.episode_number),
      name: e.name || null,
      overview: e.overview || null,
      still: e.still_path || null,
      runtime: e.runtime || null,
      air: e.air_date || null,
    }))
}

export interface TmdbTvSearchResult {
  id: number
  name: string
  originalName: string
  posterPath: string | null
  backdropPath: string | null
  firstAirDate: string | null
  year: number | null
  voteAverage: number | null
  genreIds: number[]
  originCountry: string[]
  originalLanguage: string
  overview: string
}

const TMDB_GENRE_NAMES: Record<number, string> = {
  16: 'Animation',
  10759: 'Action & Adventure',
  35: 'Comedy',
  18: 'Drama',
  10765: 'Sci-Fi & Fantasy',
  9648: 'Mystery',
  10768: 'War & Politics',
}

export function tmdbGenreLabels(ids: number[]): string[] {
  return ids.filter((id) => id !== 16).map((id) => TMDB_GENRE_NAMES[id]).filter(Boolean).slice(0, 2)
}

/**
 * Queries TMDB /search/tv endpoint so franchises (like JoJo's Bizarre Adventure) appear
 * as a single, unified parent show instead of 10+ fragmented AniList entries.
 */
export async function searchTmdbTvShows(query: string, donghuaOnly = false): Promise<TmdbTvSearchResult[]> {
  const q = query.trim()
  if (!q) return []

  const data = await fetchTmdbPath(`search/tv?query=${encodeURIComponent(q)}&language=en-US&include_adult=false`, 12000)
  const raw: any[] = Array.isArray(data?.results) ? data.results : []

  const mapped: TmdbTvSearchResult[] = []
  const seen = new Set<number>()

  for (const r of raw) {
    if (!r || !r.id || seen.has(r.id)) continue
    const genreIds: number[] = Array.isArray(r.genre_ids) ? r.genre_ids.map(Number) : []
    const originCountry: string[] = Array.isArray(r.origin_country) ? r.origin_country.map((c: any) => String(c).toUpperCase()) : []
    const originalLanguage = String(r.original_language || '').toLowerCase()

    const isAnimation = genreIds.includes(16)
    const isChinese = originCountry.some((c) => ['CN', 'TW', 'HK'].includes(c)) || ['zh', 'cn'].includes(originalLanguage)
    const isAsian = isChinese || originCountry.some((c) => ['JP', 'KR'].includes(c)) || ['ja', 'ko'].includes(originalLanguage)

    if (donghuaOnly) {
      if (!isChinese || (!isAnimation && !genreIds.includes(10765) && !genreIds.includes(10759))) continue
    } else if (!isAnimation && !isAsian) {
      continue
    }

    seen.add(r.id)
    const firstAirDate: string | null = r.first_air_date || null
    const yearMatch = firstAirDate?.match(/^(\d{4})/)
    mapped.push({
      id: Number(r.id),
      name: String(r.name || r.original_name || 'Untitled'),
      originalName: String(r.original_name || r.name || ''),
      posterPath: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
      backdropPath: r.backdrop_path ? `https://image.tmdb.org/t/p/w780${r.backdrop_path}` : null,
      firstAirDate,
      year: yearMatch ? Number(yearMatch[1]) : null,
      voteAverage: typeof r.vote_average === 'number' && r.vote_average > 0 ? Math.round(r.vote_average * 10) / 10 : null,
      genreIds,
      originCountry,
      originalLanguage,
      overview: String(r.overview || ''),
    })
  }

  if (!donghuaOnly) {
    // Prefer Asian animation (JP/CN/KR) over Western animation when matches exist
    const asianAnim = mapped.filter(
      (m) =>
        m.genreIds.includes(16) &&
        (m.originCountry.some((c) => ['JP', 'CN', 'TW', 'HK', 'KR'].includes(c)) ||
          ['ja', 'zh', 'cn', 'ko'].includes(m.originalLanguage)),
    )
    if (asianAnim.length > 0) return asianAnim
    const anyAnim = mapped.filter((m) => m.genreIds.includes(16))
    if (anyAnim.length > 0) return anyAnim
  }

  return mapped
}

