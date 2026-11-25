import type { Audio, HistoryItem, Meta, Prefs, RemoteEntry } from './library'
import { isContinueCardDone, isPlaybackWatched } from './watchedLogic'

export function historyEntryKey(id: number, ep?: number): string {
  return `${Number(id)}:${Math.max(1, Number(ep) || 1)}`
}

function normalizeHistoryItem(item: HistoryItem): HistoryItem {
  return {
    ...item,
    id: Number(item.id),
    ep: Math.max(1, Number(item.ep) || 1),
    pos: Math.max(0, Number(item.pos) || 0),
    dur: Math.max(0, Number(item.dur) || 0),
    t: Number(item.t) || 0,
  }
}

export function dedupeHistoryEntries(list: readonly HistoryItem[]): HistoryItem[] {
  const seen = new Map<string, HistoryItem>()
  for (const raw of list) {
    if (!raw || !raw.id) continue
    const item = normalizeHistoryItem(raw)
    const key = historyEntryKey(item.id, item.ep)
    const prev = seen.get(key)
    if (!prev || item.t > prev.t) {
      seen.set(key, prev ? { ...prev, ...item } : item)
    }
  }
  return Array.from(seen.values()).sort((a, b) => (b.t || 0) - (a.t || 0))
}

export function getHistoryEntry(
  list: readonly HistoryItem[],
  id: number,
  ep?: number,
): HistoryItem | undefined {
  const mid = Number(id)
  if (!Number.isFinite(mid)) return undefined
  if (ep !== undefined) {
    const nep = Math.max(1, Number(ep) || 1)
    return list.find((h) => Number(h.id) === mid && Math.max(1, Number(h.ep) || 1) === nep)
  }
  return list
    .filter((h) => Number(h.id) === mid)
    .sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0))[0]
}

export function upsertHistoryEpisode(
  list: readonly HistoryItem[],
  m: Meta & { bannerImage?: string | null },
  p: {
    ep: number
    server: string
    audio: Audio
    pos?: number
    dur?: number
    epTitle?: string | null
    epImage?: string | null
  },
  now = Date.now(),
  maxHistory = 100,
): { next: HistoryItem; list: HistoryItem[] } {
  const mid = Number(m.id)
  const nep = Math.max(1, Number(p.ep) || 1)
  const prev = getHistoryEntry(list, mid, nep)
  const next: HistoryItem = {
    id: mid,
    title: m.title,
    image: m.image,
    color: m.color,
    score: m.score,
    format: m.format,
    episodes: m.episodes,
    year: m.year,
    startDate: m.startDate ?? prev?.startDate,
    bannerImage: m.bannerImage ?? prev?.bannerImage ?? null,
    ep: nep,
    server: p.server,
    audio: p.audio,
    pos: p.pos ?? prev?.pos ?? 0,
    dur: p.dur ?? prev?.dur ?? 0,
    t: now,
    epTitle: p.epTitle !== undefined ? p.epTitle : (prev?.epTitle ?? null),
    epImage: p.epImage !== undefined ? p.epImage : (prev?.epImage ?? null),
  }
  const key = historyEntryKey(mid, nep)
  const filtered = list.filter((h) => historyEntryKey(h.id, h.ep) !== key)
  const nextList = [next, ...filtered].slice(0, maxHistory)
  return { next, list: nextList }
}

export function removeHistoryEntry(
  list: readonly HistoryItem[],
  id: number,
  ep?: number,
): HistoryItem[] {
  const mid = Number(id)
  if (ep !== undefined) {
    const nep = Math.max(1, Number(ep) || 1)
    return list.filter((h) => !(Number(h.id) === mid && Math.max(1, Number(h.ep) || 1) === nep))
  }
  return list.filter((h) => Number(h.id) !== mid)
}

export function finishHistoryEpisode(
  list: readonly HistoryItem[],
  m: Meta & { bannerImage?: string | null },
  ep: number,
  hasNext: boolean,
  prefs: Prefs,
  now = Date.now(),
  maxHistory = 100,
): HistoryItem[] {
  const mid = Number(m.id)
  const nep = Math.max(1, Number(ep) || 1)
  const prev = getHistoryEntry(list, mid, nep)
  const resolvedDur = prev?.dur && prev.dur > 0 ? prev.dur : (prev?.pos || 1)
  const finishedEntry: HistoryItem = {
    id: mid,
    title: m.title,
    image: m.image,
    color: m.color,
    score: m.score,
    format: m.format,
    episodes: m.episodes,
    year: m.year,
    startDate: m.startDate ?? prev?.startDate,
    bannerImage: m.bannerImage ?? prev?.bannerImage ?? null,
    ep: nep,
    server: prev?.server || prefs.server || 'megaplay',
    audio: prev?.audio || prefs.audio || 'dub',
    pos: resolvedDur,
    dur: resolvedDur,
    t: now,
    epTitle: prev?.epTitle ?? null,
    epImage: prev?.epImage ?? null,
  }
  let nextList = [finishedEntry, ...list.filter((h) => historyEntryKey(h.id, h.ep) !== historyEntryKey(mid, nep))]
  if (hasNext) {
    const nextEp = nep + 1
    const existingNext = getHistoryEntry(nextList, mid, nextEp)
    const queued: HistoryItem = existingNext
      ? { ...existingNext, t: now + 1 }
      : {
          ...finishedEntry,
          ep: nextEp,
          pos: 0,
          dur: 0,
          t: now + 1,
          epTitle: null,
          epImage: null,
        }
    nextList = [queued, ...nextList.filter((h) => historyEntryKey(h.id, h.ep) !== historyEntryKey(mid, nextEp))]
  }
  return nextList.slice(0, maxHistory)
}

export function mergeRemoteHistoryEntries(
  local: readonly HistoryItem[],
  entries: readonly RemoteEntry[],
  server: string,
  audio: Audio,
  now = Date.now(),
  maxHistory = 100,
): HistoryItem[] {
  const deduped = dedupeHistoryEntries(local)
  const map = new Map<string, HistoryItem>()
  const existingShowIds = new Set<number>()
  for (const h of deduped) {
    map.set(historyEntryKey(h.id, h.ep), h)
    existingShowIds.add(Number(h.id))
  }
  for (const e of entries) {
    if (e.status !== 'watching') continue
    const mid = Number(e.meta.id)
    if (existingShowIds.has(mid)) continue
    const nextEp = Math.max(1, (Number(e.progress) || 0) + 1)
    const key = historyEntryKey(mid, nextEp)
    if (!map.has(key)) {
      map.set(key, {
        ...e.meta,
        id: mid,
        ep: nextEp,
        server,
        audio,
        pos: 0,
        dur: 0,
        t: e.updated || now,
      })
    }
  }
  return Array.from(map.values())
    .sort((a, b) => (b.t || 0) - (a.t || 0))
    .slice(0, maxHistory)
}

export function mergeHistoryEntries(
  local: readonly HistoryItem[],
  remote: readonly HistoryItem[],
  maxHistory = 100,
): HistoryItem[] {
  return dedupeHistoryEntries([...local, ...remote]).slice(0, maxHistory)
}

export function filterContinueHistoryEntries(
  rawItems: readonly HistoryItem[],
  watchedIds: Set<number>,
  watchedEpsMap: Record<string, number[]>,
): HistoryItem[] {
  const out: HistoryItem[] = []
  for (const h of dedupeHistoryEntries(rawItems)) {
    if (!h?.id) continue
    const isMovie = h.format === 'MOVIE' || h.episodes === 1
    if (watchedIds.has(h.id)) {
      if (!isMovie || h.dur <= 0 || isPlaybackWatched(h.pos, h.dur)) continue
    }
    const epArr = watchedEpsMap[String(h.id)]
    const epWatched = Array.isArray(epArr) && epArr.includes(h.ep)
    if (isContinueCardDone(h.pos, h.dur, epWatched)) continue
    out.push(h)
  }
  return out
}
