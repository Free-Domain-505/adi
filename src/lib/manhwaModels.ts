/**
 * Dedicated Manhwa data models and server definitions.
 */

export type ManhwaSourceId = 'asura' | 'demonicscans' | 'comick' | 'mangadex'

export interface ManhwaSourceInfo {
  id: ManhwaSourceId
  displayName: string
  baseUrl: string
  badge: string | null
}

export const MANHWA_SOURCES: readonly ManhwaSourceInfo[] = [
  { id: 'asura', displayName: 'Asura Scans', baseUrl: 'https://asurascans.com', badge: 'Action / Regression' },
  { id: 'demonicscans', displayName: 'Demonic Scans', baseUrl: 'https://demonicscans.org', badge: 'Action / Manhwa' },
  { id: 'comick', displayName: 'ComicK', baseUrl: 'https://comick.dev', badge: 'Manhwa' },
  { id: 'mangadex', displayName: 'MangaDex', baseUrl: 'https://mangadex.org', badge: 'Multilingual' },
]

export const DEFAULT_MANHWA_SOURCE: ManhwaSourceId = 'asura'

export const isManhwaSource = (s?: string | null): s is ManhwaSourceId =>
  !!s && MANHWA_SOURCES.some((x) => x.id === s)

export function resolveManhwaSource(s?: string | null): ManhwaSourceId {
  if (!s) return DEFAULT_MANHWA_SOURCE
  const id = s.toLowerCase().trim()
  if (id === 'ds' || id === 'demonic' || id === 'demonicscans') return 'demonicscans'
  if (id === 'asurascans') return 'asura'
  return isManhwaSource(id) ? id : DEFAULT_MANHWA_SOURCE
}

export const manhwaSourceInfo = (id: ManhwaSourceId): ManhwaSourceInfo =>
  MANHWA_SOURCES.find((s) => s.id === id) ?? MANHWA_SOURCES[0]

export const manhwaSourceParams = (source: ManhwaSourceId): Record<string, string> =>
  source === DEFAULT_MANHWA_SOURCE ? {} : { source }

export const manhwaReadingKey = (source: ManhwaSourceId, id: string) => `${source}:${id}`

export const manhwaHref = (m: { id: string; title: string; poster?: string | null; source: ManhwaSourceId }) =>
  `/manhwa/${encodeURIComponent(m.id)}?${new URLSearchParams({
    title: m.title,
    cover: m.poster ?? '',
    ...manhwaSourceParams(m.source),
  })}`
