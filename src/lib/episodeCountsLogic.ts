import type { AniDate, AniStreamingEpisode, AniTitle } from '../types/anime'
import type { EpInfo, Tmdb } from '../services/api'

/** Format AniList startDate as YYYY-MM-DD (returns null when year is unknown). */
export function aniStartIso(d?: AniDate | null): string | null {
  if (!d?.year) return null
  const m = String(d.month || 1).padStart(2, '0')
  const day = String(d.day || 1).padStart(2, '0')
  return `${d.year}-${m}-${day}`
}

/** True when an episode title is just a generic placeholder like "Episode 12", "Ep 8", "TBA", or "第12話". */
export function isGenericEpisodeTitle(name?: string | null, epNum?: number | null): boolean {
  if (typeof name !== 'string') return true
  const s = name.trim()
  if (!s) return true
  if (/^(?:tba|tbd|to be announced|untitled|coming soon|no title)$/i.test(s)) return true
  if (/^(?:episode|ep\.?|e|#)?\s*0*\d+\s*$/i.test(s)) return true
  if (/^(?:episode|ep\.?)\s*0*\d+\s*[-:–.]\s*(?:episode|ep\.?)?\s*0*\d*\s*$/i.test(s)) return true
  if (/^第\s*0*\d+\s*[話话集回]\s*$/.test(s)) return true
  if (epNum != null && epNum > 0) {
    const escaped = String(epNum)
    if (new RegExp(`^(?:episode|ep\\.?|e|#)?\\s*0*${escaped}\\s*$`, 'i').test(s)) return true
  }
  return false
}

/** Return trimmed real episode title, or null when the string is missing or just a placeholder like "Episode 12". */
export function sanitizeEpisodeTitle(name?: string | null, epNum?: number | null): string | null {
  if (typeof name !== 'string') return null
  const s = name.trim()
  return isGenericEpisodeTitle(s, epNum) ? null : s
}

/** Episodes that have actually aired, and the (known or best-guess) total. */
export function episodeCounts(a: {
  format: string | null
  status: string | null
  episodes: number | null
  nextAiringEpisode: { episode: number } | null
}) {
  if (a.format === 'MOVIE') return { total: 1, available: a.status === 'NOT_YET_RELEASED' ? 0 : 1 }
  const next = a.nextAiringEpisode?.episode
  const aired = next ? next - 1 : (a.episodes ?? 0)
  const available = a.episodes ? Math.min(a.episodes, aired || a.episodes) : aired
  return {
    total: a.episodes ?? Math.max(available, 1),
    available: a.status === 'NOT_YET_RELEASED' ? 0 : Math.max(available, 1),
  }
}

/** AniList streamingEpisodes ("Episode 12 - Title", "12. Title", "#12 - Title" + thumbnail) as EpInfo. */
export function anilistEpisodes(list: AniStreamingEpisode[] = [], format?: string | null): EpInfo[] {
  if (format === 'MOVIE') return []
  const out: EpInfo[] = []
  for (const e of list) {
    const raw = e.title?.trim() || ''
    if (!raw) continue
    const m =
      raw.match(/^\s*(?:episode|ep\.?|e|#)\s*(\d+)\s*[-:–.)]\s*(.*)$/i) ||
      raw.match(/^\s*(?:episode|ep\.?|e|#)\s*(\d+)\s*$/i) ||
      raw.match(/^\s*(\d+)\s*[.)\-:–]\s+(.+)$/)
    if (!m) continue
    const n = Number(m[1])
    if (!Number.isFinite(n) || n <= 0) continue
    const cleanName = sanitizeEpisodeTitle(m[2] || '', n)
    out.push({ n, name: cleanName, overview: null, image: e.thumbnail, runtime: null, air: null })
  }
  return out
}

/**
 * Normalize AniList streamingEpisodes numbering against known season epCount.
 * Keeps 1-based season numbers intact; shifts continuous numbering (e.g. 13..24 for a 12-ep sequel) when all entries exceed epCount.
 */
export function normalizeAniListSeasonEpisodes(list: EpInfo[], epCount?: number | null): EpInfo[] {
  if (!list.length) return list
  if (!epCount || epCount <= 0) return list
  const within = list.filter((e) => e.n >= 1 && e.n <= epCount)
  if (within.length > 0) return within
  if (list.every((e) => e.n > epCount)) {
    const minN = Math.min(...list.map((e) => e.n))
    return list
      .map((e) => ({ ...e, n: e.n - minN + 1 }))
      .filter((e) => e.n >= 1 && e.n <= epCount)
  }
  return within
}

/** TMDB wins per field, EXCEPT generic TMDB placeholders ("Episode 12") never block real AniList/fallback titles. */
export function mergeEpisodes(tmdb: EpInfo[], ani: EpInfo[]): Map<number, EpInfo> {
  const map = new Map<number, EpInfo>()
  for (const e of ani) {
    map.set(e.n, { ...e, name: sanitizeEpisodeTitle(e.name, e.n) })
  }
  for (const t of tmdb) {
    const a = map.get(t.n)
    const tName = sanitizeEpisodeTitle(t.name, t.n)
    const aName = sanitizeEpisodeTitle(a?.name, t.n)
    map.set(t.n, {
      n: t.n,
      name: tName ?? aName ?? null,
      overview: t.overview ?? a?.overview ?? null,
      image: t.image ?? a?.image ?? null,
      runtime: t.runtime ?? a?.runtime ?? null,
      air: t.air ?? a?.air ?? null,
    })
  }
  return map
}

/** Fill any missing or generic episode names from fallback title maps (e.g. ani.zip / Jikan MAL). */
export function mergeEpisodeTitleFallbacks(
  base: Map<number, EpInfo>,
  fallbackTitles?: Record<number, string> | null,
): Map<number, EpInfo> {
  if (!fallbackTitles) return base
  const entries = Object.entries(fallbackTitles)
  if (!entries.length) return base
  let changed = false
  const next = new Map(base)
  for (const [k, rawTitle] of entries) {
    const n = Number(k)
    if (!Number.isFinite(n) || n <= 0) continue
    const clean = sanitizeEpisodeTitle(rawTitle, n)
    if (!clean) continue
    const cur = next.get(n)
    if (!cur) {
      next.set(n, { n, name: clean, overview: null, image: null, runtime: null, air: null })
      changed = true
    } else if (!sanitizeEpisodeTitle(cur.name, n)) {
      next.set(n, { ...cur, name: clean })
      changed = true
    }
  }
  return changed ? next : base
}

export function extractSeasonNumber(title?: string | AniTitle | null): number | null {
  if (!title) return null
  const str = typeof title === 'string' ? title : `${title.english || ''} ${title.romaji || ''}`
  const m =
    str.match(/(?:^|\s)(?:the\s+)?(?:final|last)?\s*(?:season|part|cour)\s*(\d+)/i) ||
    str.match(/(?:^|\s)(\d+)(?:st|nd|rd|th)\s+(?:season|part|cour)/i) ||
    str.match(/(?:^|\s)(?:di\s*)(\d+)\s*ji\b/i) ||
    str.match(/(?:^|\s)s(\d+)\b/i) ||
    str.match(/(?:^|\s)(II|III|IV|V|VI|VII|VIII|IX|X)\b/i) ||
    str.match(/\s+([2-9])\b/i)

  if (!m) return null
  const val = m[1]
  const romanMap: Record<string, number> = { II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 }
  if (romanMap[val.toUpperCase()]) return romanMap[val.toUpperCase()]
  const n = parseInt(val, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** TMDB season to read: the mapped season, detected title season, else 1. */
export const tmdbSeason = (
  t: Tmdb | null,
  titleOrMeta?: string | AniTitle | { title?: string | AniTitle | null } | null,
) => {
  if (!t || t.type !== 'tv') return null
  const rawTitle =
    titleOrMeta && typeof titleOrMeta === 'object' && 'title' in titleOrMeta
      ? titleOrMeta.title
      : (titleOrMeta as string | AniTitle | null | undefined)
  const fromTitle = extractSeasonNumber(rawTitle)
  if (fromTitle && fromTitle > 0) return fromTitle
  return t.season ?? 1
}

export interface SeasonCandidate {
  id: number
  title: AniTitle
  format: string | null
  status: string | null
  episodes: number | null
  year: number | null
  image: string | null
  color: string | null
  main: boolean
}

const stripBase = (raw: string): string =>
  raw
    .replace(/[\(\[][^)\]]*[\)\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeRawTitle = (raw: string): string =>
  stripBase(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const finalizeCore = (raw: string): string =>
  raw
    .replace(/['’°!?*]+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const stripSeasonSuffix = (raw: string): string => {
  const cleaned = stripBase(raw)
    .replace(/\s*[-–—:]\s*(?:the\s+)?(?:final|last|second|third|fourth|fifth|\d+(?:st|nd|rd|th))?\s*(?:season|part|cour)\b.*$/i, '')
    .replace(/(?:^|\s)(?:the\s+)?(?:final|last|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+season(?:\s+\d+)?(?:\s*[:–—-].*)?$/i, '')
    .replace(/(?:^|\s)season\s*\d+(?:\s*[:–—-].*)?$/i, '')
    .replace(/(?:^|\s)part\s*\d+(?:\s*[:–—-].*)?$/i, '')
    .replace(/(?:^|\s)(?:cour\s*\d+|\d+(?:st|nd|rd|th)\s+cour)(?:\s*[:–—-].*)?$/i, '')
    .replace(/(?:^|\s)(?:di\s*)?\d+\s*ji\b.*$/i, '')
    .replace(/\s+[2-9]$/i, '')
    .replace(/\s+(?:II|III|IV|V|VI|VII|VIII|IX|X)$/i, '')
  return finalizeCore(cleaned)
}

const stripArcSuffix = (raw: string): string => {
  const cleaned = stripBase(raw)
    .replace(/\s*[-–—:]\s*(?:the\s+)?(?:final|last|second|third|fourth|fifth|\d+(?:st|nd|rd|th))?\s*(?:season|part|cour)\b.*$/i, '')
    .replace(/(?:^|\s)(?:the\s+)?(?:final|last|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+season(?:\s+\d+)?(?:\s*[:–—-].*)?$/i, '')
    .replace(/(?:^|\s)season\s*\d+(?:\s*[:–—-].*)?$/i, '')
    .replace(/(?:^|\s)part\s*\d+(?:\s*[:–—-].*)?$/i, '')
    .replace(/(?:^|\s)(?:cour\s*\d+|\d+(?:st|nd|rd|th)\s+cour)(?:\s*[:–—-].*)?$/i, '')
    .replace(/(?:^|\s)(?:di\s*)?\d+\s*ji\b.*$/i, '')
    .replace(/(?:\s*[:–—]\s*|\s+-\s+).*?-hen(?:\b|$).*$/i, '')
    .replace(/\s+[^\s:–—]+-hen(?:\b|$).*$/i, '')
    .replace(/\s*[:–—-]\s*[^:–—-]*\b(?:arc|saga|chapters?|culling\s+game|shimetsukyuukou)\b.*$/i, '')
    .replace(/\s+[2-9]$/i, '')
    .replace(/\s+(?:II|III|IV|V|VI|VII|VIII|IX|X)$/i, '')
  return finalizeCore(cleaned)
}

const getFranchiseRoot = (raw: string): string => {
  const base = stripBase(raw)
  const m = base.match(/^([^:–—]+)(?:\s*[:–—].*)?$/)
  return finalizeCore(m ? m[1] : base)
}

const titleForms = (t: AniTitle) =>
  [t.english, t.romaji].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)

/**
 * Keep only watch-order entries that are true seasons of the current anime series.
 * Distinct franchise series (e.g. Naruto -> Naruto Shippuden -> Boruto, Dragon Ball -> DBZ -> DBS,
 * Bleach -> Bleach TYBW, Soul Land -> Soul Land 2) remain in the Watch Order tab instead of polluting Seasons 1..N.
 */
export function filterSeriesSeasons<T extends SeasonCandidate>(
  entries: T[],
  current: {
    id: number
    title: AniTitle
    format: string | null
    status: string | null
    episodes: number | null
    seasonYear?: number | null
    startDate?: { year?: number | null } | null
    coverImage: { large?: string | null; color?: string | null }
  },
  tmdbTitle?: string | null,
): SeasonCandidate[] {
  const seen = new Set<number>()
  const curForms = titleForms(current.title)
  const currentStrictCores = new Set(curForms.map(stripSeasonSuffix).filter((s) => s.length >= 2))
  const currentArcCores = new Set(curForms.map(stripArcSuffix).filter((s) => s.length >= 2))
  const currentRoots = new Set(curForms.map(getFranchiseRoot).filter((s) => s.length >= 2))
  const tmdbStrictCore = tmdbTitle ? stripSeasonSuffix(tmdbTitle) : ''
  const tmdbArcCore = tmdbTitle ? stripArcSuffix(tmdbTitle) : ''
  const tmdbRoot = tmdbTitle ? getFranchiseRoot(tmdbTitle) : ''
  const currentEps = current.episodes ?? 0

  const filtered = entries.filter((e) => {
    if (seen.has(e.id)) return false
    if (e.status === 'NOT_YET_RELEASED') return false
    if (e.id === current.id) {
      seen.add(e.id)
      return true
    }
    if (!e.main || (e.format !== 'TV' && e.format !== 'ONA' && e.format !== current.format)) return false
    if (current.format === 'TV' && e.format === 'ONA' && (e.episodes ?? 0) === 1) return false

    const eForms = titleForms(e.title)
    const eStrictCores = eForms.map(stripSeasonSuffix).filter((s) => s.length >= 2)
    const strictMatch = eStrictCores.some((c) => currentStrictCores.has(c))

    const eRoots = eForms.map(getFranchiseRoot).filter((s) => s.length >= 2)
    const rootMatch =
      eRoots.some((r) => currentRoots.has(r)) ||
      (tmdbRoot.length >= 4 && eRoots.includes(tmdbRoot))

    const eEps = e.episodes ?? 0
    const longRunning = currentEps >= 40 || eEps >= 40

    let sameSeries = strictMatch || rootMatch
    if (!sameSeries && !longRunning) {
      const eArcCores = eForms.map(stripArcSuffix).filter((s) => s.length >= 2)
      const candidateArcCores = new Set(currentArcCores)
      if (tmdbStrictCore.length >= 4) candidateArcCores.add(tmdbStrictCore)
      if (tmdbArcCore.length >= 4) candidateArcCores.add(tmdbArcCore)

      sameSeries = eArcCores.some((c) => candidateArcCores.has(c))
    }

    if (sameSeries) seen.add(e.id)
    return sameSeries
  })

  if (filtered.length > 0) return filtered
  return [
    {
      id: current.id,
      title: current.title,
      format: current.format,
      status: current.status,
      episodes: current.episodes,
      year: current.seasonYear ?? current.startDate?.year ?? null,
      image: current.coverImage.large ?? null,
      color: current.coverImage.color ?? null,
      main: true,
    },
  ]
}

/**
 * Traverse prequels to find the root / Season 1 anime ID.
 * Rejects OVA/Movie/Special edges and validates title-core matches so spin-offs aren't mistaken for prequels.
 */
export function findRootSeasonId(item: {
  id: number
  episodes?: number | null
  title?: AniTitle | null
  format?: string | null
  relations?: {
    edges?: Array<{
      relationType: string
      node: {
        id: number
        type?: string
        format?: string | null
        episodes?: number | null
        title?: AniTitle | null
        relations?: {
          edges?: Array<{
            relationType: string
            node: {
              id: number
              type?: string
              format?: string | null
              episodes?: number | null
              title?: AniTitle | null
            }
          }>
        }
      }
    }>
  }
}): number {
  if (!item || !item.relations?.edges?.length) return item.id
  if (item.format === 'MOVIE') return item.id

  const curForms = item.title ? titleForms(item.title) : []
  const curStrictCores = new Set(curForms.map(stripSeasonSuffix).filter((s) => s.length >= 2))
  const curArcCores = new Set(curForms.map(stripArcSuffix).filter((s) => s.length >= 2))
  const curRawNorms = curForms.map(normalizeRawTitle).filter((s) => s.length >= 2)
  const itemEps = item.episodes ?? 0

  const isValidPrequelNode = (node: {
    id: number
    type?: string
    format?: string | null
    episodes?: number | null
    title?: AniTitle | null
  }) => {
    if (node.type && node.type !== 'ANIME') return false
    if (node.format === 'SPECIAL' || node.format === 'OVA' || node.format === 'MUSIC' || node.format === 'TV_SHORT') {
      return false
    }
    if (node.title && curStrictCores.size > 0) {
      const nodeForms = titleForms(node.title)
      const nodeStrictCores = nodeForms.map(stripSeasonSuffix).filter((s) => s.length >= 2)
      if (nodeStrictCores.some((c) => curStrictCores.has(c))) return true
      const longRunning = itemEps >= 40 || (node.episodes ?? 0) >= 40
      if (longRunning) return false
      const nodeArcCores = nodeForms.map(stripArcSuffix).filter((s) => s.length >= 2)
      if (nodeArcCores.some((c) => curArcCores.has(c))) return true
      return nodeArcCores.some((c) => c.length >= 4 && curRawNorms.some((r) => r === c || r.startsWith(`${c} `)))
    }
    return true
  }

  const l1 = item.relations.edges.find(
    (e) => e.relationType === 'PREQUEL' && isValidPrequelNode(e.node),
  )
  if (!l1) return item.id

  const l2 = l1.node.relations?.edges?.find(
    (e) => e.relationType === 'PREQUEL' && isValidPrequelNode(e.node),
  )
  if (l2) return l2.node.id

  return l1.node.id
}
