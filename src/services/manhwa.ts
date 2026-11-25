/** Dedicated Manhwa API client — /api/manhwa/* plus AniList metadata & catalog browsing. */
import { apiUrl, failMsg } from './api'
import { bestSimilarity, searchVariants } from '../lib/match'
import {
  DEFAULT_MANHWA_SOURCE,
  MANHWA_SOURCES,
  manhwaSourceInfo,
  type ManhwaSourceId,
} from '../lib/manhwaModels'

export type ManhwaScope = ManhwaSourceId | 'all'

export interface ManhwaItem {
  id: string
  title: string
  poster: string
  type?: string | null
  status?: string | null
  latest?: string | null
  score?: number | null
  chapters?: number | null
  updated?: string | null
  source: ManhwaSourceId
  kind?: 'Manhwa' | null
}

export interface ManhwaHome {
  trending: ManhwaItem[]
  latest: ManhwaItem[]
  newRelease: ManhwaItem[]
}

export interface ManhwaChapterRef {
  chapterId: string
  number: string
  title: string | null
  date?: string | null
  group?: string | null
  volume?: string | null
}

export interface ManhwaMeta {
  title: string
  nativeTitle: string | null
  cover: string | null
  banner: string | null
  color: string | null
  description: string
  genres: string[]
  score: number | null
  status: string | null
  format: string | null
  chapters: number | null
  volumes: number | null
  year: number | null
  authors: string[]
}

export interface AniManhwaHit {
  id: number
  title: string
  alt: string[]
  cover: string
  score: number | null
  kind: 'Manhwa'
  year: number | null
  status: string | null
  chapters: number | null
}

export interface ManhwaCatalogParams {
  search?: string
  genre?: string
  tag?: string
  format?: string
  year?: number
  status?: string
  sort: string
  minPopularity?: number
}

async function get<T>(path: string, timeout = 25000): Promise<T> {
  const ctl = new AbortController()
  const t = window.setTimeout(() => ctl.abort(), timeout)
  try {
    const res = await fetch(apiUrl(path), { signal: ctl.signal })
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
    if (!res.ok || !data) throw new Error(failMsg(res, data))
    return data
  } finally {
    window.clearTimeout(t)
  }
}

const memo = new Map<string, Promise<unknown>>()
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit) return hit as Promise<T>
  const p = fn().catch((e) => {
    memo.delete(key)
    throw e
  })
  memo.set(key, p)
  return p
}

/* ---------------- AniList ---------------- */
interface AniMedia {
  id: number
  title: { romaji: string | null; english: string | null; native: string | null }
  coverImage: { extraLarge: string | null; large: string | null; color: string | null }
  bannerImage?: string | null
  description?: string | null
  genres?: string[]
  averageScore: number | null
  status?: string | null
  format?: string | null
  chapters?: number | null
  volumes?: number | null
  startDate?: { year: number | null }
  staff?: { edges: { role: string | null; node: { name: { full: string } } }[] }
  synonyms?: string[]
}

const alCache = new Map<string, { at: number; data: unknown }>()
const alInflight = new Map<string, Promise<unknown>>()

async function anilist<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = query + JSON.stringify(variables)
  const hit = alCache.get(key)
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.data as T
  const running = alInflight.get(key)
  if (running) return running as Promise<T>

  const work = (async () => {
    for (const endpoint of ['https://graphql.anilist.co', apiUrl('/api/anilist')]) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(9000),
        })
        const json = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null
        if (res.ok && json?.data) {
          alCache.set(key, { at: Date.now(), data: json.data })
          return json.data
        }
        if (res.status !== 429 && res.status < 500 && json?.errors?.[0]?.message) {
          throw new Error(json.errors[0].message)
        }
      } catch (e) {
        if (endpoint !== 'https://graphql.anilist.co') {
          if (hit) return hit.data as T
          throw e instanceof Error ? e : new Error('AniList request failed')
        }
      }
    }
    if (hit) return hit.data as T
    throw new Error('AniList request failed')
  })()

  alInflight.set(key, work)
  try {
    return await work
  } finally {
    alInflight.delete(key)
  }
}

const plain = (s?: string | null) =>
  (s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const titleOf = (t: AniMedia['title']) => t.english || t.romaji || t.native || 'Untitled'

const aniHit = (m: AniMedia): AniManhwaHit => {
  const title = titleOf(m.title)
  const latin = (m.synonyms ?? []).filter((x) => /[a-z]/i.test(x))
  const names = [m.title.romaji, m.title.english, ...latin, m.title.native].filter((x): x is string => !!x && x !== title)
  return {
    id: m.id,
    title,
    alt: [...new Set(names)].slice(0, 6),
    cover: m.coverImage.extraLarge || m.coverImage.large || '',
    score: m.averageScore ? m.averageScore / 10 : null,
    kind: 'Manhwa',
    year: m.startDate?.year ?? null,
    status: m.status ? m.status.replace(/_/g, ' ') : null,
    chapters: m.chapters ?? null,
  }
}

export function fetchManhwaMeta(title: string): Promise<ManhwaMeta | null> {
  return once(`manhwa-meta:${title.toLowerCase()}`, async () => {
    try {
      const d = await anilist<{ Media: AniMedia | null }>(
        `query ($s: String) { Media(search: $s, type: MANGA, countryOfOrigin: KR, sort: SEARCH_MATCH) {
          id title { romaji english native } coverImage { extraLarge large color } bannerImage description(asHtml: false)
          genres averageScore status format chapters volumes startDate { year }
          staff(perPage: 4, sort: RELEVANCE) { edges { role node { name { full } } } } } }`,
        { s: title },
      )
      const m = d.Media
      if (!m) return null
      return {
        title: titleOf(m.title),
        nativeTitle: m.title.native,
        cover: m.coverImage.extraLarge || m.coverImage.large,
        banner: m.bannerImage ?? null,
        color: m.coverImage.color,
        description: plain(m.description),
        genres: m.genres ?? [],
        score: m.averageScore ? m.averageScore / 10 : null,
        status: m.status ? m.status.replace(/_/g, ' ') : null,
        format: m.format ? m.format.replace(/_/g, ' ') : null,
        chapters: m.chapters ?? null,
        volumes: m.volumes ?? null,
        year: m.startDate?.year ?? null,
        authors: (m.staff?.edges ?? []).map((e) => e.node.name.full),
      }
    } catch {
      return null
    }
  })
}

export function searchAniListManhwa(term: string): Promise<AniManhwaHit[]> {
  const t = term.trim()
  if (t.length < 2) return Promise.resolve([])
  return once(`ani-manhwa-search:${t.toLowerCase()}`, async () => {
    try {
      const d = await anilist<{ Page: { media: AniMedia[] } }>(
        `query ($s: String) { Page(perPage: 16) { media(search: $s, type: MANGA, countryOfOrigin: KR, sort: SEARCH_MATCH, isAdult: false) {
          id title { romaji english native } synonyms coverImage { extraLarge large color } averageScore format status chapters startDate { year } } } }`,
        { s: t },
      )
      return d.Page.media.map(aniHit)
    } catch {
      return []
    }
  })
}

export async function fetchManhwaCatalog(p: ManhwaCatalogParams, page: number): Promise<{ items: AniManhwaHit[]; hasNext: boolean }> {
  const d = await anilist<{ Page: { pageInfo: { hasNextPage: boolean }; media: AniMedia[] } }>(
    `query ($page: Int, $search: String, $genre: String, $tag: String, $formats: [MediaFormat], $status: MediaStatus, $from: FuzzyDateInt, $to: FuzzyDateInt, $sort: [MediaSort], $pop: Int) {
      Page(page: $page, perPage: 24) {
        pageInfo { hasNextPage }
        media(type: MANGA, isAdult: false, search: $search, genre: $genre, tag: $tag, format_in: $formats, countryOfOrigin: KR, status: $status,
              startDate_greater: $from, startDate_lesser: $to, sort: $sort, popularity_greater: $pop) {
          id title { romaji english native } synonyms coverImage { extraLarge large color } averageScore format status chapters startDate { year } } } }`,
    {
      page,
      search: p.search || undefined,
      genre: p.genre || undefined,
      tag: p.tag || undefined,
      formats: p.format ? [p.format] : ['MANGA', 'ONE_SHOT'],
      status: p.status || undefined,
      from: p.year ? p.year * 10000 : undefined,
      to: p.year ? p.year * 10000 + 1232 : undefined,
      sort: p.search ? ['SEARCH_MATCH', p.sort] : [p.sort],
      pop: p.minPopularity || undefined,
    },
  )
  return { items: d.Page.media.map(aniHit), hasNext: d.Page.pageInfo.hasNextPage }
}

export const findManhwaOnServersHref = (m: Pick<AniManhwaHit, 'title' | 'alt' | 'cover'>) =>
  `/manhwa/find?${new URLSearchParams({ title: m.title, alt: m.alt.join('|'), cover: m.cover })}`

/* ---------------- Dedicated Manhwa Servers ---------------- */
const withSource = (path: string, source: ManhwaSourceId) => {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}source=${source}`
}

const tag = (items: ManhwaItem[] | undefined, source: ManhwaSourceId): ManhwaItem[] =>
  (items ?? []).map((i) => ({ ...i, source: i.source ?? source, kind: 'Manhwa' }))

const EMPTY: ManhwaHome = { trending: [], latest: [], newRelease: [] }

async function rawHome(source: ManhwaSourceId): Promise<ManhwaHome> {
  try {
    const d = await get<ManhwaHome>(withSource('/api/manhwa/home', source))
    return {
      trending: tag(d.trending, source),
      latest: tag(d.latest, source),
      newRelease: tag(d.newRelease, source),
    }
  } catch {
    return EMPTY
  }
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function interleave(lists: ManhwaItem[][], max = 30): ManhwaItem[] {
  const seen = new Set<string>()
  const out: ManhwaItem[] = []
  for (let i = 0; out.length < max && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const m = l[i]
      const key = m && normTitle(m.title)
      if (m && key && !seen.has(key)) {
        seen.add(key)
        out.push(m)
      }
    }
  }
  return out
}

export async function fetchManhwaHome(source: ManhwaScope = DEFAULT_MANHWA_SOURCE): Promise<ManhwaHome> {
  const key = `manhwa-home:${source}`
  const hit = memo.get(key)
  if (hit) return hit as Promise<ManhwaHome>

  const work = (async (): Promise<ManhwaHome> => {
    const homes =
      source === 'all'
        ? await Promise.all(MANHWA_SOURCES.map((s) => rawHome(s.id)))
        : [await rawHome(source)]
    const d: ManhwaHome = {
      trending: interleave(homes.map((h) => h.trending)),
      latest: interleave(homes.map((h) => h.latest)),
      newRelease: interleave(homes.map((h) => h.newRelease)),
    }
    if (!d.trending.length && !d.latest.length && !d.newRelease.length) {
      memo.delete(key)
      throw new Error(`${source === 'all' ? 'Manhwa servers' : manhwaSourceInfo(source).displayName} could not be reached. Please try again.`)
    }
    return d
  })().catch((e) => {
    memo.delete(key)
    throw e
  })

  memo.set(key, work)
  return work
}

export async function searchManhwa(term: string, source: ManhwaScope = DEFAULT_MANHWA_SOURCE): Promise<ManhwaItem[]> {
  if (source === 'all') return searchManhwaEverywhere(term)
  const d = await get<{ results: ManhwaItem[] }>(withSource(`/api/manhwa/search?q=${encodeURIComponent(term)}`, source))
  return tag(d.results, source)
}

export async function searchManhwaEverywhere(term: string): Promise<ManhwaItem[]> {
  const lists = await Promise.all(
    MANHWA_SOURCES.map((s) => searchManhwa(term, s.id).catch(() => [] as ManhwaItem[])),
  )
  const q = normTitle(term)
  const rank = (m: ManhwaItem) => (normTitle(m.title) === q ? 0 : normTitle(m.title).startsWith(q) ? 1 : 2)
  return interleave(lists, 60)
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
    .map((x) => x.m)
}

export function fetchManhwaChapters(id: string, source: ManhwaSourceId = DEFAULT_MANHWA_SOURCE): Promise<ManhwaChapterRef[]> {
  return once(`manhwa-chapters:${source}:${id}`, async () => {
    const d = await get<{ chapters: ManhwaChapterRef[] }>(
      withSource(`/api/manhwa/chapters?id=${encodeURIComponent(id)}`, source),
      40000,
    )
    return d.chapters ?? []
  })
}

export async function fetchManhwaPages(chapterId: string, source: ManhwaSourceId = DEFAULT_MANHWA_SOURCE): Promise<string[]> {
  const d = await get<{ pages: string[] }>(
    withSource(`/api/manhwa/pages?chapterId=${encodeURIComponent(chapterId)}`, source),
    40000,
  )
  if (!d.pages?.length) throw new Error('No pages came back for this chapter.')
  return d.pages
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export const bestManhwaMatch = (hits: ManhwaItem[], title: string): ManhwaItem | undefined => {
  const exact = hits.find((h) => norm(h.title) === norm(title))
  if (exact) return exact
  let best: ManhwaItem | undefined
  let bestScore = 0
  for (const h of hits) {
    const s = bestSimilarity(h.title, [title])
    if (s > bestScore) {
      bestScore = s
      best = h
    }
  }
  return best ?? hits[0]
}

export async function resolveManhwaChaptersWithFallback(
  id: string,
  title: string,
  source: ManhwaSourceId,
): Promise<{ wid: string; source: ManhwaSourceId; chapters: ManhwaChapterRef[] }> {
  let primaryError: Error | null = null

  try {
    const chapters = await fetchManhwaChapters(id, source)
    if (chapters.length > 0) return { wid: id, source, chapters }
  } catch (e) {
    primaryError = e instanceof Error ? e : new Error('Server error')
  }

  const cleanTitle = title.trim()
  if (cleanTitle) {
    const order: ManhwaSourceId[] = MANHWA_SOURCES.map((s) => s.id).filter((s) => s !== source)
    const queries = searchVariants([cleanTitle])
    for (const cand of order) {
      for (const q of queries) {
        try {
          const hits = await searchManhwa(q, cand)
          const hit = bestManhwaMatch(hits, cleanTitle)
          if (!hit || bestSimilarity(hit.title, [cleanTitle]) < 0.5) continue
          const chapters = await fetchManhwaChapters(hit.id, cand)
          if (chapters.length > 0) return { wid: hit.id, source: cand, chapters }
        } catch {
          /* try next variant / server */
        }
      }
    }
  }

  if (primaryError) throw primaryError
  return { wid: id, source, chapters: [] }
}

export const proxiedManhwaImage = (
  url: string,
  source: ManhwaSourceId = DEFAULT_MANHWA_SOURCE,
  title?: string,
) => {
  const clean = (url || '').trim()
  if (!clean) {
    return title ? apiUrl(`/proxy?title=${encodeURIComponent(title)}`) : ''
  }
  if (clean.startsWith('/proxy') || clean.startsWith('data:') || clean.startsWith('blob:')) {
    return clean
  }
  const p = new URLSearchParams({
    url: clean,
    referer: `${manhwaSourceInfo(source).baseUrl}/`,
  })
  if (title) p.set('title', title)
  return apiUrl(`/proxy?${p}`)
}
