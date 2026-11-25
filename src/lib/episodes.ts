import type { AniMedia } from '../types/anime'
import { lastEpisode } from './progress'
import { resolveDirectHeroTarget } from './mappers'
import type { SeasonCandidate } from './episodeCountsLogic'

export * from './episodeCountsLogic'

/**
 * Determine which anime ID and episode number the featured carousel "Watch now" button should target.
 * Each season is treated as its own separate anime entry.
 */
export function resolveHeroTarget(
  item: AniMedia,
  _orderList?: SeasonCandidate[] | null,
  _tmdbTitle?: string | null,
): { targetId: number; targetEp: number; isResume: boolean } {
  return resolveDirectHeroTarget(item.id, lastEpisode(item.id))
}
