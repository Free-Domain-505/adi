import type {
  AniCardMedia,
  AniRecommendationNode,
  AniRelationEdge,
  CardItem,
  JikanAnimeSummary,
} from '../types/anime'
import { humanize, pickTitle } from './utils'

const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="690"><rect width="100%" height="100%" fill="#1a1a20"/></svg>',
  )

const MAIN_SEASON_RELATIONS = new Set(['PREQUEL', 'SEQUEL', 'PARENT'])

function nodeEpisodes(n: { episodes?: number | null; nextAiringEpisode?: { episode: number } | null }): number {
  if (typeof n.episodes === 'number' && n.episodes > 0) return n.episodes
  if (n.nextAiringEpisode?.episode && n.nextAiringEpisode.episode > 1) return n.nextAiringEpisode.episode - 1
  return 0
}

/** Sums episodes across all deduplicated main-story seasons (PREQUEL / SEQUEL / PARENT) of an anime. */
export function totalFranchiseEpisodes(m: AniCardMedia): number | null {
  if (m.format === 'MOVIE') return m.episodes
  const byId = new Map<number, number>()
  const selfEps = nodeEpisodes(m)
  byId.set(m.id, selfEps)

  const isMainFormat = (fmt: string | null | undefined) =>
    fmt === 'TV' || fmt === 'ONA' || (m.format && fmt === m.format)

  for (const edge of m.relations?.edges ?? []) {
    if (!MAIN_SEASON_RELATIONS.has(edge.relationType)) continue
    const n1 = edge.node
    if (!n1 || n1.type !== 'ANIME' || !isMainFormat(n1.format)) continue
    if (!byId.has(n1.id)) {
      byId.set(n1.id, nodeEpisodes(n1))
    }
    for (const edge2 of n1.relations?.edges ?? []) {
      if (!MAIN_SEASON_RELATIONS.has(edge2.relationType)) continue
      const n2 = edge2.node
      if (!n2 || n2.type !== 'ANIME' || !isMainFormat(n2.format)) continue
      if (!byId.has(n2.id)) {
        byId.set(n2.id, nodeEpisodes(n2))
      }
    }
  }

  let total = 0
  for (const c of byId.values()) total += c
  return total > 0 ? total : m.episodes
}

export function specificSeasonEpisodes(m: {
  episodes?: number | null
  nextAiringEpisode?: { episode: number } | null
}): number | null {
  if (typeof m.episodes === 'number' && m.episodes > 0) return m.episodes
  if (m.nextAiringEpisode?.episode && m.nextAiringEpisode.episode > 1) return m.nextAiringEpisode.episode - 1
  return m.episodes ?? null
}

/** Resolve hero watch target directly for a given anime/season entry without prequel redirection. */
export function resolveDirectHeroTarget(
  itemId: number,
  directResume = 0,
): { targetId: number; targetEp: number; isResume: boolean } {
  if (directResume > 0) {
    return { targetId: itemId, targetEp: directResume, isResume: true }
  }
  return { targetId: itemId, targetEp: 1, isResume: false }
}

export function mediaToCard(m: AniCardMedia): CardItem {
  return {
    id: m.id,
    href: `/anime/${m.id}`,
    title: pickTitle(m.title),
    image: m.coverImage.large || m.coverImage.extraLarge || PLACEHOLDER,
    image2x: m.coverImage.extraLarge ?? undefined,
    color: m.coverImage.color,
    score: m.averageScore,
    format: m.format,
    episodes: specificSeasonEpisodes(m),
    year: m.seasonYear,
    startDate: m.startDate ?? null,
    genres: m.genres,
  }
}

export function recommendationToCard(node: AniRecommendationNode): CardItem | null {
  const m = node.mediaRecommendation
  if (!m) return null
  return {
    id: m.id,
    href: `/anime/${m.id}`,
    title: pickTitle(m.title),
    image: m.coverImage.large || PLACEHOLDER,
    color: m.coverImage.color,
    score: m.averageScore,
    format: m.format,
    episodes: m.episodes,
    year: m.seasonYear,
  }
}

export function relationToCard(edge: AniRelationEdge): CardItem {
  const n = edge.node
  return {
    id: n.id,
    href: `/anime/${n.id}`,
    title: pickTitle(n.title),
    image: n.coverImage.large || PLACEHOLDER,
    color: n.coverImage.color,
    score: n.averageScore,
    format: n.format,
    episodes: n.episodes,
    year: n.seasonYear,
    caption: humanize(edge.relationType),
  }
}

export function malToCard(a: JikanAnimeSummary): CardItem {
  return {
    id: a.mal_id,
    href: `/mal/${a.mal_id}`,
    title: a.title_english || a.title,
    image: a.images.webp?.large_image_url || a.images.jpg?.large_image_url || PLACEHOLDER,
    score: a.score ? Math.round(a.score * 10) : null,
    format: a.type,
    episodes: a.episodes,
    year: a.year,
    genres: a.genres.map((g) => g.name),
  }
}
