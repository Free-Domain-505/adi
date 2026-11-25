import type { AniAiringEntry, AniCardMedia, AniMedia, AniMediaDetails, AniStreamingEpisode, HomeData, WatchOrderEntry } from '../types/anime'
import { getSeason } from '../lib/utils'
import { apiUrl } from './api'
import { fetchAnimeFallback } from './fallback'
import { AniListDownError, markAniListDown, markAniListUp } from '../lib/anilistStatus'
import { catalogFromMal, homeFromMal, searchFromMal } from './malFallback'
import { catalogFromKitsu, homeFromKitsu, searchFromKitsu } from './kitsuFallback'
import { getCustomShowById, searchCustomShows } from '../lib/customAnime'
import { findRootSeasonId } from '../lib/episodes'

const ENDPOINT = 'https://graphql.anilist.co'
const TTL = 15 * 60 * 1000
const STALE_TTL = 24 * 60 * 60 * 1000
const LS_SWR_KEY = 'al_swr_v1'
const LS_MAX_ITEMS = 45

const cache = new Map<string, { at: number; data: unknown }>()
const inflight = new Map<string, Promise<unknown>>()

function hashKey(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function readPersistentCache(rawKey: string): { at: number; data: unknown } | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const hk = hashKey(rawKey)
    const raw = localStorage.getItem(`${LS_SWR_KEY}:${hk}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at: number; data: unknown }
    if (!parsed || typeof parsed.at !== 'number' || !parsed.data) return null
    if (Date.now() - parsed.at > STALE_TTL) {
      localStorage.removeItem(`${LS_SWR_KEY}:${hk}`)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writePersistentCache(rawKey: string, data: unknown) {
  try {
    if (typeof localStorage === 'undefined' || !data) return
    const hk = `${LS_SWR_KEY}:${hashKey(rawKey)}`
    const payload = JSON.stringify({ at: Date.now(), data })
    if (payload.length > 180_000) return
    try {
      localStorage.setItem(hk, payload)
    } catch {
      // Evict oldest entries on quota
      const keys: { k: string; at: number }[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(`${LS_SWR_KEY}:`)) {
          try {
            const p = JSON.parse(localStorage.getItem(k) || '{}') as { at?: number }
            keys.push({ k, at: Number(p.at) || 0 })
          } catch {
            keys.push({ k, at: 0 })
          }
        }
      }
      keys.sort((a, b) => a.at - b.at)
      for (const old of keys.slice(0, Math.max(8, keys.length - LS_MAX_ITEMS + 5))) {
        localStorage.removeItem(old.k)
      }
      localStorage.setItem(hk, payload)
    }
  } catch {
    /* private mode / quota */
  }
}

// Gentle request pacer so bursts (e.g. Home + Details + WatchOrder) don't trip AniList's ~30 req/min limit.
const MAX_CONCURRENT = 2
const MIN_GAP_MS = 350
let activeCount = 0
let lastStart = 0
let cooldownUntil = 0
const waitQueue: Array<() => void> = []

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function acquireSlot(): Promise<void> {
  while (activeCount >= MAX_CONCURRENT) {
    await new Promise<void>((r) => waitQueue.push(r))
  }
  activeCount++
  const wait = Math.max(0, lastStart + MIN_GAP_MS - Date.now())
  if (wait > 0) await sleep(wait)
  lastStart = Date.now()
}

function releaseSlot() {
  activeCount = Math.max(0, activeCount - 1)
  const next = waitQueue.shift()
  if (next) next()
}

async function callProxy<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(apiUrl('/api/anilist'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
    })
    const json = (await res.json().catch(() => null)) as { data?: T } | null
    if (res.ok && json?.data) {
      markAniListUp()
      return json.data
    }
  } catch {
    /* ignore */
  }
  return null
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const key = query + JSON.stringify(variables)
  const memHit = cache.get(key)
  if (memHit && Date.now() - memHit.at < TTL) return memHit.data as T

  const lsHit = !memHit ? readPersistentCache(key) : null
  const bestStale = memHit || lsHit
  if (lsHit && Date.now() - lsHit.at < TTL) {
    cache.set(key, lsHit)
    return lsHit.data as T
  }

  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>

  const saveAndReturn = (data: T): T => {
    markAniListUp()
    cache.set(key, { at: Date.now(), data })
    writePersistentCache(key, data)
    return data
  }

  const promise = (async () => {
    // 1. Try our server-cached /api/anilist first whenever in cooldown OR on cold bursts
    if (Date.now() < cooldownUntil) {
      const proxied = await callProxy<T>(query, variables)
      if (proxied) return saveAndReturn(proxied)
      if (bestStale) return bestStale.data as T
    }

    const maxAttempts = 2
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await acquireSlot()
      let res: Response
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(9500),
        })
      } catch {
        releaseSlot()
        const proxied = await callProxy<T>(query, variables)
        if (proxied) return saveAndReturn(proxied)
        if (attempt < maxAttempts - 1) {
          await sleep(600)
          continue
        }
        if (bestStale) return bestStale.data as T
        throw new AniListDownError('AniList is unreachable right now.')
      }

      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('Retry-After'))
        const delayMs = res.status === 429 && Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10000) : 5000
        if (res.status === 429) cooldownUntil = Math.max(cooldownUntil, Date.now() + delayMs)
        releaseSlot()
        const proxied = await callProxy<T>(query, variables)
        if (proxied) return saveAndReturn(proxied)
        if (attempt < maxAttempts - 1) {
          await sleep(Math.min(delayMs, 2000))
          continue
        }
        if (bestStale) return bestStale.data as T
        throw new AniListDownError(
          res.status === 429
            ? 'AniList rate limit reached. Please wait a minute and retry.'
            : `AniList is down (${res.status}).`,
        )
      }

      releaseSlot()
      const json = await res.json().catch(() => null)

      if (!res.ok || json?.errors?.length || !json?.data) {
        if (res.status === 404) throw new Error('Anime not found.')
        if (res.ok && !json?.errors?.length && !json?.data) {
          const proxied = await callProxy<T>(query, variables)
          if (proxied) return saveAndReturn(proxied)
          if (attempt < maxAttempts - 1) {
            await sleep(600)
            continue
          }
          if (bestStale) return bestStale.data as T
          throw new AniListDownError('AniList returned an empty response.')
        }
        throw new Error(json?.errors?.[0]?.message ?? `AniList request failed (${res.status})`)
      }

      return saveAndReturn(json.data as T)
    }
    if (bestStale) return bestStale.data as T
    throw new AniListDownError('AniList is unreachable right now.')
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, promise)
  return promise as Promise<T>
}

/** AniList first; when it is down try each fallback in order (Kitsu, then MAL) and flag the site-wide banner. */
async function guard<T>(run: () => Promise<T>, ...fbs: (() => Promise<T>)[]): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (!(err instanceof AniListDownError)) throw err
    markAniListDown()
    for (const fb of fbs) {
      try {
        return await fb()
      } catch {
        /* next fallback */
      }
    }
    throw new Error('AniList is down and every fallback failed too. Try again in a minute.')
  }
}

const FRANCHISE_RELATIONS_FIELDS = /* GraphQL */ `
  fragment FranchiseRelationsFields on Media {
    relations {
      edges {
        relationType(version: 2)
        node {
          id
          type
          format
          episodes
          title { romaji english native }
          nextAiringEpisode { episode }
          relations {
            edges {
              relationType(version: 2)
              node {
                id
                type
                format
                episodes
                title { romaji english native }
                nextAiringEpisode { episode }
              }
            }
          }
        }
      }
    }
  }
`

const MEDIA_FIELDS = /* GraphQL */ `
  fragment MediaFields on Media {
    id
    idMal
    title { romaji english native }
    coverImage { extraLarge large color }
    bannerImage
    season
    description(asHtml: false)
    genres
    averageScore
    popularity
    episodes
    duration
    format
    status
    countryOfOrigin
    seasonYear
    startDate { year month day }
    trailer { id site thumbnail }
    nextAiringEpisode { episode airingAt timeUntilAiring }
  }
`

const CARD_FIELDS = /* GraphQL */ `
  fragment CardFields on Media {
    id
    idMal
    title { romaji english native }
    coverImage { extraLarge large color }
    bannerImage
    season
    genres
    averageScore
    episodes
    nextAiringEpisode { episode }
    format
    status
    seasonYear
    startDate { year month day }
    ...FranchiseRelationsFields
  }
  ${FRANCHISE_RELATIONS_FIELDS}
`

/* ---------- Title Normalization Helper ---------- */
function normalizeTitleForMatch(s?: string | null): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const tmdbToAniCache = new Map<number, number>()

/**
 * Maps a unified TMDB TV search result back to its primary Season 1 AniList parent ID
 * so opening it loads the unified Details Page with the TMDB Season Selector.
 */
export async function resolveTmdbToAniListId(show: {
  id: number
  name: string
  originalName?: string
  year?: number | null
  originCountry?: string[]
}): Promise<number | null> {
  const cached = tmdbToAniCache.get(show.id)
  if (cached) return cached

  const customHits = searchCustomShows(show.name)
  if (customHits.length > 0) {
    tmdbToAniCache.set(show.id, customHits[0].id)
    return customHits[0].id
  }

  const queries = [show.name, show.originalName]
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .filter((q, idx, arr) => arr.indexOf(q) === idx)

  const SEARCH_ROOT_QUERY = /* GraphQL */ `
    query ($search: String) {
      Page(perPage: 10) {
        media(type: ANIME, search: $search, sort: [SEARCH_MATCH, POPULARITY_DESC], isAdult: false) {
          ...CardFields
        }
      }
    }
    ${CARD_FIELDS}
  `

  const candidates: AniCardMedia[] = []
  for (const q of queries) {
    try {
      const res = await gql<{ Page: { media: AniCardMedia[] } }>(SEARCH_ROOT_QUERY, { search: q })
      if (res.Page.media?.length) {
        candidates.push(...res.Page.media)
        if (candidates.length >= 5) break
      }
    } catch {
      /* try next title */
    }
  }

  if (!candidates.length) return null

  const wantNorm = normalizeTitleForMatch(show.name)
  const wantOriginCn = (show.originCountry ?? []).some((c) => ['CN', 'TW', 'HK'].includes(c))

  const scored = [...candidates].sort((a, b) => {
    const scoreOf = (m: AniCardMedia) => {
      let s = 0
      if (m.format === 'TV') s += 50
      else if (m.format === 'ONA') s += 40
      else if (m.format === 'MOVIE') s -= 30
      else s -= 40

      const y = m.startDate?.year ?? m.seasonYear
      if (show.year && y) {
        const diff = Math.abs(y - show.year)
        if (diff === 0) s += 80
        else if (diff === 1) s += 45
        else if (y > show.year) s -= 20
      }

      const rootId = findRootSeasonId(m)
      if (rootId === m.id) s += 35

      const mNorm = normalizeTitleForMatch(m.title.english || m.title.romaji)
      if (wantNorm && mNorm === wantNorm) s += 30
      if (wantOriginCn && m.format === 'ONA') s += 10
      return s
    }
    return scoreOf(b) - scoreOf(a)
  })

  const best = scored[0]
  const finalId = findRootSeasonId(best) ?? best.id
  tmdbToAniCache.set(show.id, finalId)
  return finalId
}

/* ---------- Home: one request, five rows (only the hero rows carry full fields) ---------- */
export const fetchHome = (): Promise<HomeData> => guard(homeAniList, homeFromKitsu, homeFromMal)
async function homeAniList(): Promise<HomeData> {
  const { season, year } = getSeason()
  const query = /* GraphQL */ `
    query ($season: MediaSeason, $year: Int) {
      trending: Page(perPage: 25) {
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ...MediaFields ...FranchiseRelationsFields }
      }
      season: Page(perPage: 22) {
        media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) { ...CardFields }
      }
      popular: Page(perPage: 25) {
        media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ...CardFields }
      }
      top: Page(perPage: 25) {
        media(type: ANIME, sort: SCORE_DESC, isAdult: false) { ...CardFields }
      }
      upcoming: Page(perPage: 22) {
        media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, isAdult: false) { ...CardFields }
      }
    }
    ${MEDIA_FIELDS}
    ${CARD_FIELDS}
  `
  type P<T> = { media: T[] }
  const data = await gql<{ trending: P<AniMedia>; season: P<AniCardMedia>; popular: P<AniCardMedia>; top: P<AniCardMedia>; upcoming: P<AniCardMedia> }>(
    query,
    { season, year },
  )
  return {
    trending: data.trending.media,
    season: data.season.media,
    popular: data.popular.media,
    top: data.top.media,
    upcoming: data.upcoming.media,
  }
}

/* ---------- Donghua Home: Chinese Animation (countryOfOrigin: CN) ---------- */
export const fetchDonghuaHome = (): Promise<HomeData> =>
  donghuaAniList().catch((err) => {
    if (err instanceof AniListDownError) markAniListDown()
    throw err
  })

async function donghuaAniList(): Promise<HomeData> {
  const query = /* GraphQL */ `
    query {
      trending: Page(perPage: 25) {
        media(type: ANIME, countryOfOrigin: CN, sort: TRENDING_DESC, isAdult: false) { ...MediaFields ...FranchiseRelationsFields }
      }
      season: Page(perPage: 22) {
        media(type: ANIME, countryOfOrigin: CN, status: RELEASING, sort: POPULARITY_DESC, isAdult: false) { ...CardFields }
      }
      popular: Page(perPage: 25) {
        media(type: ANIME, countryOfOrigin: CN, sort: POPULARITY_DESC, isAdult: false) { ...CardFields }
      }
      top: Page(perPage: 25) {
        media(type: ANIME, countryOfOrigin: CN, sort: SCORE_DESC, isAdult: false) { ...CardFields }
      }
      upcoming: Page(perPage: 22) {
        media(type: ANIME, countryOfOrigin: CN, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, isAdult: false) { ...CardFields }
      }
    }
    ${MEDIA_FIELDS}
    ${CARD_FIELDS}
  `
  type P<T> = { media: T[] }
  const data = await gql<{ trending: P<AniMedia>; season: P<AniCardMedia>; popular: P<AniCardMedia>; top: P<AniCardMedia>; upcoming: P<AniCardMedia> }>(query, {})
  return {
    trending: data.trending.media,
    season: data.season.media,
    popular: data.popular.media,
    top: data.top.media,
    upcoming: data.upcoming.media,
  }
}

/* ---------- Search ---------- */
export const searchAnime = async (search: string, genre?: string, country?: string): Promise<AniMedia[]> => {
  const custom = country ? [] : searchCustomShows(search)
  let results: AniMedia[] = []
  try {
    results = await guard(() => searchAniList(search, genre, country), () => searchFromKitsu(search), () => searchFromMal(search))
  } catch {
    results = []
  }
  if (custom.length) {
    const existing = new Set(results.map((r) => r.id))
    const fresh = custom.filter((c) => !existing.has(c.id))
    return [...fresh, ...results]
  }
  return results
}
async function searchAniList(search: string, genre?: string, country?: string): Promise<AniMedia[]> {
  const query = /* GraphQL */ `
    query ($search: String, $genre: String, $country: CountryCode, $sort: [MediaSort]) {
      Page(perPage: 16) {
        media(type: ANIME, search: $search, genre: $genre, countryOfOrigin: $country, sort: $sort, isAdult: false) { ...MediaFields ...FranchiseRelationsFields }
      }
    }
    ${MEDIA_FIELDS}
    ${FRANCHISE_RELATIONS_FIELDS}
  `
  const variables: Record<string, unknown> = {
    sort: search ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : ['POPULARITY_DESC'],
  }
  if (search) variables.search = search
  if (genre) variables.genre = genre
  if (country) variables.country = country
  const data = await gql<{ Page: { media: AniMedia[] } }>(query, variables)
  return data.Page.media
}

/* ---------- Details ---------- */
const DETAILS_QUERY = /* GraphQL */ `
  query ($id: Int, $idMal: Int) {
    Media(id: $id, idMal: $idMal, type: ANIME) {
      ...MediaFields
      meanScore
      favourites
      source
      countryOfOrigin
      siteUrl
      startDate { year month day }
      endDate { year month day }
      synonyms
      studios { edges { isMain node { id name } } }
      tags { name rank isMediaSpoiler }
      rankings { rank type allTime year season context }
      characters(sort: [ROLE, RELEVANCE], perPage: 12) {
        edges {
          role
          node { id name { full } image { large } }
          voiceActors(language: JAPANESE, sort: RELEVANCE) { id name { full } image { large } }
        }
      }
      staff(sort: RELEVANCE, perPage: 8) {
        edges { role node { id name { full } image { large } } }
      }
      relations {
        edges {
          relationType(version: 2)
          node {
            id type
            title { romaji english native }
            coverImage { large color }
            format status averageScore seasonYear episodes
          }
        }
      }
      recommendations(sort: RATING_DESC, perPage: 14) {
        nodes {
          mediaRecommendation {
            id
            title { romaji english native }
            coverImage { large color }
            averageScore format episodes seasonYear
          }
        }
      }
      externalLinks { site url }
      streamingEpisodes { title thumbnail }
      stats {
        scoreDistribution { score amount }
        statusDistribution { status amount }
      }
    }
  }
  ${MEDIA_FIELDS}
`

/** AniList first; if it's down / rate limited, rebuild the page from TMDB (ids via AniBridge). "Not found" is not a fallback case. */
async function withFallback(run: () => Promise<AniMediaDetails>, id: number, fromMal: boolean): Promise<AniMediaDetails> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof Error && err.message === 'Anime not found.') throw err
    if (err instanceof AniListDownError) markAniListDown()
    try {
      return await fetchAnimeFallback(id, fromMal)
    } catch {
      throw err
    }
  }
}

export const fetchAnimeById = (id: number) => {
  const custom = getCustomShowById(id)
  if (custom) return Promise.resolve(custom)
  return withFallback(async () => (await gql<{ Media: AniMediaDetails }>(DETAILS_QUERY, { id })).Media, id, false)
}

export const fetchAnimeByMalId = (idMal: number) =>
  withFallback(async () => (await gql<{ Media: AniMediaDetails }>(DETAILS_QUERY, { idMal })).Media, idMal, true)

/* ---------- Catalog (Trending / Popular / Top / Browse) ---------- */
export interface CatalogParams {
  search?: string
  genre?: string
  format?: string
  year?: number
  season?: string
  status?: string
  country?: string
  sort: string
  minPopularity?: number
}

export const fetchCatalog = async (p: CatalogParams, page: number): Promise<{ items: AniCardMedia[]; hasNext: boolean }> => {
  const custom = page === 1 && p.search && !p.country ? (searchCustomShows(p.search) as unknown as AniCardMedia[]) : []
  const res = await guard(
    () => catalogAniList(p, page),
    () => catalogFromKitsu(p, page),
    () => catalogFromMal(p, page),
  )
  if (custom.length) {
    const existing = new Set(res.items.map((i) => i.id))
    const fresh = custom.filter((c) => !existing.has(c.id))
    return {
      items: [...fresh, ...res.items],
      hasNext: res.hasNext,
    }
  }
  return { items: res.items, hasNext: res.hasNext }
}
async function catalogAniList(p: CatalogParams, page: number): Promise<{ items: AniCardMedia[]; hasNext: boolean }> {
  const query = /* GraphQL */ `
    query ($page: Int, $search: String, $genre: String, $format: MediaFormat, $year: Int, $season: MediaSeason, $status: MediaStatus, $country: CountryCode, $sort: [MediaSort], $pop: Int) {
      Page(page: $page, perPage: 30) {
        pageInfo { hasNextPage }
        media(type: ANIME, isAdult: false, search: $search, genre: $genre, format: $format, seasonYear: $year, season: $season, status: $status, countryOfOrigin: $country, sort: $sort, popularity_greater: $pop) { ...CardFields }
      }
    }
    ${CARD_FIELDS}
  `
  const variables: Record<string, unknown> = { page, sort: [p.sort] }
  if (p.search) {
    variables.search = p.search
    variables.sort = ['SEARCH_MATCH', p.sort]
  }
  if (p.genre) variables.genre = p.genre
  if (p.format) variables.format = p.format
  if (p.year) variables.year = p.year
  if (p.season) variables.season = p.season
  if (p.status) variables.status = p.status
  if (p.country) variables.country = p.country
  if (p.minPopularity) variables.pop = p.minPopularity
  const data = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; media: AniCardMedia[] } }>(query, variables)
  return { items: data.Page.media, hasNext: data.Page.pageInfo.hasNextPage }
}

/* ---------- Schedule ---------- */
export const fetchAiring = (from: number, to: number): Promise<AniAiringEntry[]> =>
  airingAniList(from, to).catch((err) => {
    if (!(err instanceof AniListDownError)) throw err
    markAniListDown()
    throw new Error('AniList is down, and the schedule needs it. Try again in a minute.')
  })
async function airingAniList(from: number, to: number): Promise<AniAiringEntry[]> {
  const query = /* GraphQL */ `
    query ($page: Int, $from: Int, $to: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
          id airingAt episode
          media {
            id idMal title { romaji english native } coverImage { extraLarge large color }
            bannerImage
            season
            startDate { year month day }
            streamingEpisodes { title thumbnail }
            genres averageScore episodes format status seasonYear isAdult countryOfOrigin popularity
          }
        }
      }
    }
  `
  type Res = { Page: { pageInfo: { hasNextPage: boolean }; airingSchedules: AniAiringEntry[] } }
  const out: AniAiringEntry[] = []
  for (let page = 1; page <= 4; page++) {
    const data = await gql<Res>(query, { page, from, to })
    out.push(...data.Page.airingSchedules)
    if (!data.Page.pageInfo.hasNextPage) break
  }
  return out.filter((e) => !e.media.isAdult)
}

/* ---------- Light details for the player page ---------- */
const LITE_QUERY = /* GraphQL */ `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      ...MediaFields
      streamingEpisodes { title thumbnail }
      relations {
        edges {
          relationType(version: 2)
          node { id type format title { romaji english native } }
        }
      }
    }
  }
  ${MEDIA_FIELDS}
`
export interface AniLite extends AniMedia {
  streamingEpisodes: AniStreamingEpisode[]
  relations: { edges: { relationType: string; node: { id: number; type: string; format: string | null; title: AniMedia['title'] } }[] }
}

export const fetchAnimeLite = (id: number): Promise<AniLite> => {
  const custom = getCustomShowById(id)
  if (custom) return Promise.resolve(custom as unknown as AniLite)
  return guard(
    async () => (await gql<{ Media: AniLite }>(LITE_QUERY, { id })).Media,
    () => fetchAnimeFallback(id, false) as Promise<AniLite>,
  )
}

/* ---------- Watch order (franchise walk through PREQUEL / SEQUEL / SIDE_STORY / SPIN_OFF / PARENT) ---------- */
interface OrderEdge2 {
  relationType: string
  node: { id: number; type: string }
}

interface OrderNode {
  id: number
  type: string
  title: AniMedia['title']
  format: string | null
  status: string | null
  episodes: number | null
  seasonYear: number | null
  averageScore: number | null
  startDate: { year: number | null; month: number | null; day: number | null }
  coverImage: { large: string | null; color: string | null }
  relations: {
    edges: {
      relationType: string
      node: {
        id: number
        type: string
        relations?: { edges: OrderEdge2[] }
      }
    }[]
  }
}

const FOLLOW = new Set(['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF'])
const EXTRA_FORMATS = new Set(['SPECIAL', 'OVA', 'MUSIC', 'TV_SHORT'])

const watchOrderCache = new Map<number, { at: number; data: WatchOrderEntry[] }>()
const watchOrderInflight = new Map<number, Promise<WatchOrderEntry[]>>()
const WO_SS_PREFIX = 'as_wo_v1_'

function readOrderSession(id: number): WatchOrderEntry[] | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(`${WO_SS_PREFIX}${id}`)
      if (raw) {
        const parsed = JSON.parse(raw) as { at: number; data: WatchOrderEntry[] }
        if (parsed && Date.now() - parsed.at < TTL && Array.isArray(parsed.data)) return parsed.data
      }
    }
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`${WO_SS_PREFIX}${id}`)
      if (raw) {
        const parsed = JSON.parse(raw) as { at: number; data: WatchOrderEntry[] }
        if (parsed && Date.now() - parsed.at < STALE_TTL && Array.isArray(parsed.data)) return parsed.data
      }
    }
    return null
  } catch {
    return null
  }
}

function writeOrderSession(ids: number[], data: WatchOrderEntry[]) {
  try {
    const payload = JSON.stringify({ at: Date.now(), data })
    if (typeof sessionStorage !== 'undefined') {
      for (const id of ids) {
        sessionStorage.setItem(`${WO_SS_PREFIX}${id}`, payload)
      }
    }
    if (typeof localStorage !== 'undefined' && payload.length < 120_000) {
      for (const id of ids.slice(0, 12)) {
        localStorage.setItem(`${WO_SS_PREFIX}${id}`, payload)
      }
    }
  } catch {
    /* quota/private mode */
  }
}

export async function fetchWatchOrder(rootId: number): Promise<WatchOrderEntry[]> {
  const hit = watchOrderCache.get(rootId)
  if (hit && Date.now() - hit.at < TTL) return hit.data

  const ssHit = readOrderSession(rootId)
  if (ssHit) {
    watchOrderCache.set(rootId, { at: Date.now(), data: ssHit })
    return ssHit
  }

  const pending = watchOrderInflight.get(rootId)
  if (pending) return pending

  const promise = (async () => {
    const query = /* GraphQL */ `
      query ($ids: [Int]) {
        Page(perPage: 50) {
          media(id_in: $ids, type: ANIME) {
            id type title { romaji english native } format status episodes seasonYear averageScore
            startDate { year month day } coverImage { large color }
            relations {
              edges {
                relationType(version: 2)
                node {
                  id type
                  relations {
                    edges {
                      relationType(version: 2)
                      node { id type }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `
    const nodes = new Map<number, OrderNode>()
    const meta = new Map<number, { side: boolean; relation: string }>([[rootId, { side: false, relation: 'This anime' }]])
    let frontier = [rootId]

    // With 2-hop relations per query, 4 rounds covers up to 8 relation hops cleanly.
    for (let depth = 0; depth < 4 && frontier.length && nodes.size < 40; depth++) {
      const batch = frontier.slice(0, 45)
      const data = await gql<{ Page: { media: OrderNode[] } }>(query, { ids: batch })
      const nextSet = new Set<number>()
      for (const n of data.Page.media) {
        nodes.set(n.id, n)
        const here = meta.get(n.id) ?? { side: false, relation: 'RELATED' }
        for (const e of n.relations.edges) {
          if (!FOLLOW.has(e.relationType) || e.node.type !== 'ANIME') continue
          const side1 = here.side || e.relationType === 'SIDE_STORY' || e.relationType === 'SPIN_OFF'
          if (!meta.has(e.node.id)) {
            meta.set(e.node.id, { side: side1, relation: e.relationType })
            if (!nodes.has(e.node.id)) nextSet.add(e.node.id)
          }
          for (const e2 of e.node.relations?.edges ?? []) {
            if (!FOLLOW.has(e2.relationType) || e2.node.type !== 'ANIME' || meta.has(e2.node.id)) continue
            const side2 = side1 || e2.relationType === 'SIDE_STORY' || e2.relationType === 'SPIN_OFF'
            meta.set(e2.node.id, { side: side2, relation: e2.relationType })
            if (!nodes.has(e2.node.id)) nextSet.add(e2.node.id)
          }
        }
      }
      frontier = [...nextSet]
    }

    const stamp = (n: OrderNode) => (n.startDate.year ?? n.seasonYear ?? 9999) * 10000 + (n.startDate.month ?? 12) * 100 + (n.startDate.day ?? 28)
    const out = [...nodes.values()]
      .sort((a, b) => stamp(a) - stamp(b))
      .map((n) => {
        const m = meta.get(n.id) ?? { side: false, relation: 'RELATED' }
        return {
          id: n.id,
          title: n.title,
          image: n.coverImage.large,
          color: n.coverImage.color,
          format: n.format,
          status: n.status,
          episodes: n.episodes,
          year: n.startDate.year ?? n.seasonYear,
          score: n.averageScore,
          main: !m.side && !EXTRA_FORMATS.has(n.format ?? ''),
          relation: m.relation,
        }
      })

    const now = Date.now()
    const cacheIds = [rootId, ...out.filter((entry) => entry.main).map((entry) => entry.id)]
    for (const cid of cacheIds) {
      watchOrderCache.set(cid, { at: now, data: out })
    }
    writeOrderSession(cacheIds, out)
    return out
  })().finally(() => {
    watchOrderInflight.delete(rootId)
  })

  watchOrderInflight.set(rootId, promise)
  return promise
}

export interface LatestEpisodeItem {
  id: number
  airingAt: number
  episode: number
  media: {
    id: number
    idMal?: number | null
    title: { romaji?: string | null; english?: string | null; native?: string | null }
    coverImage: { extraLarge?: string | null; large?: string | null; color?: string | null }
    bannerImage?: string | null
    format?: string | null
    episodes?: number | null
    nextAiringEpisode?: { episode: number } | null
    startDate?: { year?: number | null; month?: number | null; day?: number | null } | null
    streamingEpisodes?: { title: string | null; thumbnail: string | null }[]
    genres?: string[] | null
    season?: string | null
    seasonYear?: number | null
    averageScore?: number | null
  }
}

export async function fetchLatestEpisodes(perPage = 20): Promise<LatestEpisodeItem[]> {
  const query = /* GraphQL */ `
    query ($perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        airingSchedules(notYetAired: false, sort: TIME_DESC) {
          id
          airingAt
          episode
          media {
            id
            idMal
            title { english romaji native }
            coverImage { extraLarge large color }
            bannerImage
            format
            episodes
            nextAiringEpisode { episode }
            startDate { year month day }
            streamingEpisodes { title thumbnail }
            genres
            season
            seasonYear
            averageScore
          }
        }
      }
    }
  `
  try {
    const res = await gql<{ Page: { airingSchedules: LatestEpisodeItem[] } }>(query, { perPage })
    return res.Page.airingSchedules || []
  } catch {
    return []
  }
}
