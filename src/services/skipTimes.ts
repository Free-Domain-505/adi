import { apiUrl } from './api'
import type { SkipTimeSources } from '../lib/skipValidation'

export async function fetchSkipTimesSources(params: {
  anilistId?: number | null
  malId?: number | null
  ep?: number
  tmdbId?: number | null
  imdbId?: string | null
  type?: 'movie' | 'tv'
  format?: string | null
  year?: string | number | null
  season?: number
  episode?: number
  title?: string | null
  englishTitle?: string | null
  romajiTitle?: string | null
  nativeTitle?: string | null
  altTitles?: string[] | null
}): Promise<SkipTimeSources | null> {
  try {
    const qs = new URLSearchParams()
    if (params.anilistId) qs.set('anilistId', String(params.anilistId))
    if (params.malId) qs.set('malId', String(params.malId))
    if (params.ep) qs.set('ep', String(params.ep))
    if (params.tmdbId) qs.set('tmdbId', String(params.tmdbId))
    if (params.imdbId) qs.set('imdbId', params.imdbId)
    if (params.type) qs.set('type', params.type)
    if (params.format) qs.set('format', params.format)
    if (params.year) qs.set('year', String(params.year))
    if (params.season) qs.set('season', String(params.season))
    if (params.episode) qs.set('episode', String(params.episode))
    if (params.title) qs.set('title', params.title)
    if (params.englishTitle) qs.set('englishTitle', params.englishTitle)
    if (params.romajiTitle) qs.set('romajiTitle', params.romajiTitle)
    if (params.nativeTitle) qs.set('nativeTitle', params.nativeTitle)
    if (params.altTitles?.length) qs.set('altTitles', params.altTitles.slice(0, 6).join('||'))

    const res = await fetch(apiUrl(`/api/skip-times?${qs.toString()}`), {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as (SkipTimeSources & { success?: boolean }) | null
    if (!data) return null
    return {
      aniSkip: data.aniSkip ?? null,
      theIntroDb: data.theIntroDb ?? null,
      introDb: data.introDb ?? null,
    }
  } catch {
    return null
  }
}
