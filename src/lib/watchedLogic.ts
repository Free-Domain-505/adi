export const WATCHED_THRESHOLD = 0.90

export interface HistProgressSnapshot {
  ep: number
  pos: number
  dur: number
}

/** Returns true if the video playback has reached or exceeded the watched threshold (almost entire video, default 90%). */
export function isPlaybackWatched(pos: number, dur: number, threshold = WATCHED_THRESHOLD): boolean {
  return dur > 0 && pos >= dur * threshold
}

/**
 * Determines whether a continue-watching card is completed.
 * If position and duration are known, it requires reaching almost the entire video (>= threshold).
 * Only when duration is unknown/unavailable does it fall back to overall franchise watched state.
 */
export function isContinueCardDone(
  pos: number,
  dur: number,
  isFranchiseWatched: boolean,
  threshold = WATCHED_THRESHOLD,
): boolean {
  if (dur > 0) {
    return pos >= dur * threshold
  }
  return isFranchiseWatched
}

/**
 * Calculates updated completed episodes count for watchlist / AniList sync.
 * Crucial: Only increment to `ep` when this episode is actually finished (>= threshold).
 * If user is halfway through episode 5, completed episodes is 4 (or previous completed), not 5.
 */
export function computeUpdatedEpisodeProgress(curProg: number, ep: number, isDone: boolean): number {
  if (isDone) {
    return Math.max(curProg, ep)
  }
  return Math.max(curProg, ep > 1 ? Math.min(curProg, ep - 1) : 0)
}

/**
 * Pure evaluation of whether an anime title / movie should display the "Watched" badge.
 * Rejects completion if there is an active playback session in progress that has not reached 90%.
 */
export function isAnimeCompletedLogic(input: {
  totalEpisodes?: number | null
  isMovieFormat?: boolean
  histItem?: HistProgressSnapshot | null
  epsCount?: number
  listStatus?: string
  listProgress?: number
  threshold?: number
}): boolean {
  const {
    totalEpisodes,
    isMovieFormat,
    histItem,
    epsCount = 0,
    listStatus,
    threshold = WATCHED_THRESHOLD,
  } = input

  const total = Number(totalEpisodes ?? 0)
  const isMovie = isMovieFormat || total === 1

  // 1. If currently watching a movie and progress is under threshold, it is NOT completed
  if (isMovie && histItem && histItem.dur > 0 && histItem.pos / histItem.dur < threshold) {
    return false
  }

  // 2. If currently on the final episode (or higher) of a TV series and under threshold, it is NOT completed
  if (
    !isMovie &&
    total > 0 &&
    histItem &&
    histItem.dur > 0 &&
    histItem.ep >= total &&
    histItem.pos / histItem.dur < threshold
  ) {
    return false
  }

  // 3. User explicitly marked the title as completed (and active playback position isn't currently incomplete)
  if (listStatus === 'completed') {
    if (isMovie && histItem && histItem.dur > 0 && histItem.pos / histItem.dur < threshold) {
      return false
    }
    return true
  }

  // 4. Movie or single-episode anime
  if (isMovie) {
    if (histItem && isPlaybackWatched(histItem.pos, histItem.dur, threshold)) {
      return true
    }
    if (epsCount >= 1) {
      return true
    }
    return false
  }

  // 5. Multi-episode TV series
  if (total > 0) {
    if (epsCount >= total) return true
    if (histItem && histItem.ep >= total && isPlaybackWatched(histItem.pos, histItem.dur, threshold)) {
      return true
    }
    return false
  }

  return false
}

/**
 * Determines whether a TMDB Movie or TV series is watched.
 * For movies, requires reaching almost the entire video (>= threshold).
 */
export function isMovieEntryWatchedLogic(
  entry: { completed?: boolean; dur?: number; pos?: number } | undefined | null,
  type: 'movie' | 'tv',
  threshold = WATCHED_THRESHOLD,
): boolean {
  if (!entry) return false
  if (type === 'movie' && entry.dur && entry.dur > 0 && entry.pos !== undefined) {
    if (entry.pos / entry.dur < threshold) return false
  }
  return Boolean(entry.completed)
}

/**
 * Computes whether a TMDB Movie or TV series should be marked completed after a progress tick.
 * Marks single-episode movies on >= 90% and marks TV series on >= 90% of the final episode in the final season.
 */
export function isTmdbProgressCompleted(input: {
  type: 'movie' | 'tv'
  prevCompleted?: boolean
  reachedDone: boolean
  season?: number
  episode?: number
  watchedSeasonEpsCount?: number
  totalEpisodesInSeason?: number
  totalSeasons?: number
}): boolean {
  const {
    type,
    prevCompleted = false,
    reachedDone,
    season = 1,
    episode = 1,
    watchedSeasonEpsCount = 0,
    totalEpisodesInSeason = 0,
    totalSeasons = 1,
  } = input
  if (type === 'movie') return reachedDone
  if (prevCompleted) return true
  if (
    reachedDone &&
    totalEpisodesInSeason > 0 &&
    (!totalSeasons || totalSeasons <= 1 || season >= totalSeasons) &&
    (watchedSeasonEpsCount >= totalEpisodesInSeason || episode >= totalEpisodesInSeason)
  ) {
    return true
  }
  return false
}
