import { useEffect, useMemo, useState } from 'react'
import {
  fetchFallbackEpisodeTitles,
  fetchTmdbEpisodes,
  fetchTmdbSeasonEpisodes,
  tmdbImg,
  type EpInfo,
  type Tmdb,
} from '../services/api'
import {
  anilistEpisodes,
  aniStartIso,
  mergeEpisodes,
  mergeEpisodeTitleFallbacks,
  normalizeAniListSeasonEpisodes,
  sanitizeEpisodeTitle,
  tmdbSeason,
} from '../lib/episodes'
import type { AniCover, AniDate, AniStreamingEpisode, AniTitle } from '../types/anime'
import { pickTitle, stripHtml } from '../lib/utils'

export interface EpisodeMeta {
  id?: number | null
  idMal?: number | null
  startDate?: AniDate | null
  episodes?: number | null
  nextAiringEpisode?: { episode: number } | null
  status?: string | null
  format?: string | null
  title?: AniTitle | string | null
  bannerImage?: string | null
  coverImage?: AniCover | null
  description?: string | null
  duration?: number | null
  focusEpisode?: number | null
}

export interface ExplicitTmdbSeason {
  tmdbId: number
  seasonNumber: number
}

/**
 * Per-episode info + loading state.
 * When `explicitTmdbSeason` is supplied (via the unified TMDB Season Selector),
 * it clears previous episodes immediately and fetches strictly `/tv/{id}/season/{n}`
 * without AniList startDate alignment or multi-season concatenation.
 */
export function useEpisodesState(
  tmdb: Tmdb | null,
  streaming?: AniStreamingEpisode[],
  meta?: EpisodeMeta | null,
  seasonOverride?: number | null,
  explicitTmdbSeason?: ExplicitTmdbSeason | null,
): { episodes: Map<number, EpInfo>; loading: boolean } {
  const isMovie = meta?.format === 'MOVIE' || tmdb?.type === 'movie'
  const useExplicit = Boolean(!isMovie && explicitTmdbSeason && explicitTmdbSeason.tmdbId > 0 && explicitTmdbSeason.seasonNumber > 0)

  const season = isMovie ? null : (seasonOverride && seasonOverride > 0 ? seasonOverride : tmdbSeason(tmdb, meta))
  const start = aniStartIso(meta?.startDate)
  const rawEpCount =
    meta?.episodes ??
    (meta?.nextAiringEpisode?.episode ? Math.max(0, meta.nextAiringEpisode.episode - 1) : null) ??
    (meta?.status === 'RELEASING' && tmdb?.episodes && tmdb.episodes > 40 ? tmdb.episodes : null)
  const epCount = rawEpCount && rawEpCount > 0 ? rawEpCount : null
  const spec = `${season ?? ''}|${start ?? ''}|${epCount ?? 0}`

  const shouldFetch = useExplicit || Boolean(!isMovie && tmdb && season)
  const reqKey = useExplicit
    ? `explicit:${explicitTmdbSeason!.tmdbId}:s${explicitTmdbSeason!.seasonNumber}`
    : shouldFetch
      ? `${tmdb!.id}|${spec}`
      : ''

  const [resolved, setResolved] = useState<{ key: string; list: EpInfo[] } | null>(null)
  const [fallbackTitles, setFallbackTitles] = useState<{ key: string; titles: Record<number, string> } | null>(null)

  useEffect(() => {
    // Clear previous episode container immediately when switching seasons
    setResolved(null)
    if (!reqKey) return

    let dead = false
    const loader = useExplicit
      ? fetchTmdbSeasonEpisodes(explicitTmdbSeason!.tmdbId, explicitTmdbSeason!.seasonNumber)
      : fetchTmdbEpisodes(tmdb!.id, season!, { start, epCount })

    loader
      .then((list) => {
        if (!dead) setResolved({ key: reqKey, list })
      })
      .catch(() => {
        if (!dead) setResolved({ key: reqKey, list: [] })
      })

    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey])

  const remoteList = reqKey && resolved?.key === reqKey ? resolved.list : []
  const remoteLoading = Boolean(reqKey && resolved?.key !== reqKey)

  const baseEpisodes = useMemo(() => {
    if (isMovie) {
      const map = new Map<number, EpInfo>()
      const title =
        tmdb?.name ||
        (meta?.title && typeof meta.title === 'object' ? pickTitle(meta.title) : typeof meta?.title === 'string' ? meta.title : null) ||
        'Full Movie'

      const image =
        (tmdb?.backdrop ? tmdbImg(tmdb.backdrop, 'w1280') : null) ||
        (tmdb?.poster ? tmdbImg(tmdb.poster, 'w780') : null) ||
        meta?.bannerImage ||
        meta?.coverImage?.extraLarge ||
        meta?.coverImage?.large ||
        null

      const overview = tmdb?.overview || (meta?.description ? stripHtml(meta.description) : null)
      const runtime = tmdb?.runtime || meta?.duration || null
      const air = tmdb?.firstAir || aniStartIso(meta?.startDate) || null

      map.set(1, {
        n: 1,
        name: title,
        overview,
        image,
        runtime,
        air,
      })
      return map
    }

    if (remoteLoading) {
      return new Map<number, EpInfo>()
    }

    if (useExplicit) {
      // Strictly map only the episodes returned by TMDB /tv/{id}/season/{n}
      const map = new Map<number, EpInfo>()
      for (const ep of remoteList) {
        map.set(ep.n, { ...ep, name: sanitizeEpisodeTitle(ep.name, ep.n) })
      }
      return map
    }

    const fallbackList = normalizeAniListSeasonEpisodes(anilistEpisodes(streaming, meta?.format), epCount)
    return mergeEpisodes(remoteList, fallbackList)
  }, [isMovie, useExplicit, tmdb, meta, epCount, remoteList, remoteLoading, streaming])

  const airedCount = useMemo(() => {
    if (isMovie || meta?.status === 'NOT_YET_RELEASED') return 0
    if (meta?.focusEpisode && meta.focusEpisode > 0) return meta.focusEpisode
    if (meta?.nextAiringEpisode?.episode) return Math.max(0, meta.nextAiringEpisode.episode - 1)
    if (epCount) return epCount
    return remoteList.length
  }, [isMovie, meta?.status, meta?.focusEpisode, meta?.nextAiringEpisode?.episode, epCount, remoteList.length])

  const missingAiredTitle = useMemo(() => {
    if (isMovie || useExplicit || remoteLoading || airedCount <= 0) return false
    if (meta?.focusEpisode && meta.focusEpisode > 0) {
      return !sanitizeEpisodeTitle(baseEpisodes.get(meta.focusEpisode)?.name, meta.focusEpisode)
    }
    const maxCheck = Math.min(airedCount, 150)
    for (let n = airedCount; n >= Math.max(1, airedCount - maxCheck + 1); n--) {
      if (!sanitizeEpisodeTitle(baseEpisodes.get(n)?.name, n)) return true
    }
    return false
  }, [isMovie, useExplicit, remoteLoading, airedCount, meta?.focusEpisode, baseEpisodes])

  const fbKey = `${meta?.id ?? 0}:${meta?.idMal ?? 0}:${airedCount > 100 ? Math.ceil(airedCount / 100) : 1}`

  useEffect(() => {
    if (!missingAiredTitle || (!meta?.id && !meta?.idMal)) return
    if (fallbackTitles?.key === fbKey) return
    let dead = false
    fetchFallbackEpisodeTitles(meta?.id, meta?.idMal, airedCount)
      .then((titles) => {
        if (!dead) setFallbackTitles({ key: fbKey, titles })
      })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [missingAiredTitle, meta?.id, meta?.idMal, airedCount, fbKey, fallbackTitles?.key])

  const episodes = useMemo(() => {
    if (isMovie || useExplicit || remoteLoading) return baseEpisodes
    if (fallbackTitles?.key === fbKey) {
      return mergeEpisodeTitleFallbacks(baseEpisodes, fallbackTitles.titles)
    }
    return baseEpisodes
  }, [isMovie, useExplicit, remoteLoading, baseEpisodes, fallbackTitles, fbKey])

  return { episodes, loading: remoteLoading }
}

/** Per-episode info: TMDB season/air-date matched first, AniList streamingEpisodes & ani.zip/MAL filling any gaps. */
export function useEpisodes(
  tmdb: Tmdb | null,
  streaming?: AniStreamingEpisode[],
  meta?: EpisodeMeta | null,
): Map<number, EpInfo> {
  return useEpisodesState(tmdb, streaming, meta).episodes
}
