import { tmdbImg, type TmdbBundle } from '../services/api'
import type { AniMedia } from '../types/anime'

export interface HeroSlideArt {
  backdropPath: string | null
  fallbackBanner: string
}

export function resolveHeroCarouselBackdrops(
  items: AniMedia[],
  bundles: Record<number, TmdbBundle | null | undefined>,
): Map<number, HeroSlideArt> {
  const result = new Map<number, HeroSlideArt>()
  const usedPaths = new Set<string>()

  for (const item of items) {
    const tmdb = bundles[item.id]?.tmdb
    const candidates = [tmdb?.backdrop, ...(tmdb?.backdrops ?? [])].filter(
      (p): p is string => Boolean(p && typeof p === 'string'),
    )
    let chosen: string | null = null
    for (const path of candidates) {
      if (!usedPaths.has(path)) {
        chosen = path
        usedPaths.add(path)
        break
      }
    }
    const fallbackBanner =
      item.bannerImage ||
      (chosen ? tmdbImg(chosen, 'w1280') : null) ||
      item.coverImage?.extraLarge ||
      item.coverImage?.large ||
      ''
    result.set(item.id, {
      backdropPath: chosen ?? null,
      fallbackBanner,
    })
  }

  return result
}

export function resolveHeroScore(
  item: AniMedia,
  tmdb?: TmdbBundle['tmdb'] | null,
): string | number | null {
  if (typeof item.averageScore === 'number' && item.averageScore > 0) {
    return `${(item.averageScore / 10).toFixed(1)}`
  }
  const rating = (tmdb as { rating?: number | null } | null | undefined)?.rating
  if (typeof rating === 'number' && rating > 0) {
    return rating
  }
  return null
}
