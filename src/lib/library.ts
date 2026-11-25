import { autoSyncWatchlist } from './sync'
import { useSyncExternalStore } from 'react'
import type { CardItem } from '../types/anime'
import {
  dedupeHistoryEntries,
  finishHistoryEpisode,
  getHistoryEntry,
  mergeRemoteHistoryEntries,
  removeHistoryEntry,
  upsertHistoryEpisode,
} from './historyLogic'
import {
  WATCHED_THRESHOLD,
  computeUpdatedEpisodeProgress,
  isAnimeCompletedLogic,
  isMovieEntryWatchedLogic,
  isPlaybackWatched,
  isTmdbProgressCompleted,
} from './watchedLogic'

/**
 * In-memory reactive library: continue-watching history, watchlist, watched progress and player prefs.
 * Persisted cleanly in Supabase (no user data duplicated in localStorage).
 */
export type Meta = Pick<CardItem, 'id' | 'title' | 'image' | 'color' | 'score' | 'format' | 'episodes' | 'year' | 'startDate'> & {
  href?: string
}
export type Audio = 'sub' | 'dub'
export type ListStatus = 'watching' | 'planning' | 'completed' | 'paused' | 'dropped'

export interface HistoryItem extends Meta {
  ep: number
  server: string
  audio: Audio
  /** seconds into `ep` and its length (0 when unknown, e.g. iframe servers) */
  pos: number
  dur: number
  /** last watched, ms */
  t: number
  epTitle?: string | null
  epImage?: string | null
  bannerImage?: string | null
}
export interface ListItem extends Meta {
  status: ListStatus
  addedAt: number
  updatedAt?: number
  /** episodes watched (kept in step with AniList when connected) */
  progress?: number
  /** Whether marked as favorite */
  favorite?: boolean
  /** Custom list IDs this item belongs to */
  customLists?: string[]
}

export interface CustomListDef {
  id: string
  name: string
  createdAt: number
}
export const customLists = cell<CustomListDef[]>('zk:custom_lists', [])
export const useCustomLists = () => useSyncExternalStore(customLists.subscribe, customLists.get)
export interface Prefs {
  server?: string
  audio?: Audio
}

export const STATUS_LABEL: Record<ListStatus, string> = { watching: 'Watching', planning: 'Plan to watch', completed: 'Completed', paused: 'On hold', dropped: 'Dropped' }
const MAX_HISTORY = 100

/** Filled in by lib/anilist.ts (avoids an import cycle): local changes are mirrored to AniList through these. */
export interface SyncPatch {
  status?: ListStatus
  progress?: number
  label?: string
}
export const syncHooks: { active?: () => boolean; push?: (id: number, p: SyncPatch) => void; remove?: (id: number) => void } = {}

/** A tiny observable in-memory cell hydrated from Supabase. Snapshots stay reference-stable for useSyncExternalStore. */
export function cell<T>(_key: string, empty: T) {
  let val = empty
  const subs = new Set<() => void>()
  const notify = () => subs.forEach((f) => f())

  const get = (): T => val
  const set = (v: T) => {
    val = v
    notify()
  }
  const subscribe = (f: () => void) => {
    subs.add(f)
    return () => {
      subs.delete(f)
    }
  }
  return { get, set, subscribe }
}

const emptyHistory: HistoryItem[] = []
const emptyList: ListItem[] = []
const emptyWatchedEps: Record<string, number[]> = {}
const emptyWatchedMovies: Record<string, MovieWatchEntry> = {}
const emptyLastEps: Record<string, number> = {}
const emptyNumSet = new Set<number>()

export interface MovieWatchEntry {
  key: string
  id: number
  type: 'movie' | 'tv'
  title: string
  poster?: string | null
  backdrop?: string | null
  epTitle?: string | null
  epImage?: string | null
  completed: boolean
  watchedSeasons: Record<string, number[]>
  lastSeason?: number
  lastEp?: number
  pos?: number
  dur?: number
  t: number
}


const history = cell<HistoryItem[]>('zk:history', emptyHistory)
const list = cell<ListItem[]>('zk:list', emptyList)
const prefs = cell<Prefs>('zk:prefs', {})
const watchedEps = cell<Record<string, number[]>>('zk:watched_eps', emptyWatchedEps)
const watchedMovies = cell<Record<string, MovieWatchEntry>>('zk:watched_movies', emptyWatchedMovies)
const lastEps = cell<Record<string, number>>('zk:last_eps', emptyLastEps)

export const getAllHistory = (): HistoryItem[] => (Array.isArray(history.get()) ? history.get() : emptyHistory)
export const setHistoryList = (v: HistoryItem[]) => history.set(v)
export const getAllList = (): ListItem[] => (Array.isArray(list.get()) ? list.get() : emptyList)
export const setWatchlist = (v: ListItem[]) => list.set(v)
export const getAllCustomLists = (): CustomListDef[] => (Array.isArray(customLists.get()) ? customLists.get() : [])
export const setCustomListsData = (v: CustomListDef[]) => customLists.set(v)
export const getAllWatchedEps = (): Record<string, number[]> => getWatchedEpsMap()
export const setWatchedEpsMap = (v: Record<string, number[]>) => watchedEps.set(v)
export const getAllWatchedMovies = (): Record<string, MovieWatchEntry> => getWatchedMoviesMap()
export const setWatchedMoviesMap = (v: Record<string, MovieWatchEntry>) => watchedMovies.set(v)
export const getAllLastEps = (): Record<string, number> => {
  const v = lastEps.get()
  return v && typeof v === 'object' && !Array.isArray(v) ? v : emptyLastEps
}
export const setLastEpsMap = (v: Record<string, number>) => lastEps.set(v)
export const setPrefsData = (v: Prefs) => prefs.set(v)

export const getLastEp = (id: number): number => Number(getAllLastEps()[String(id)]) || 0
export const setLastEp = (id: number, ep: number) => {
  if (!id || !ep) return
  const cur = getAllLastEps()
  if (cur[String(id)] === ep) return
  lastEps.set({ ...cur, [String(id)]: ep })
  autoSyncWatchlist()
}

export function resetLibrary() {
  history.set(emptyHistory)
  list.set(emptyList)
  customLists.set([])
  prefs.set({})
  watchedEps.set(emptyWatchedEps)
  watchedMovies.set(emptyWatchedMovies)
  lastEps.set(emptyLastEps)
}

export const useHistory = () => {
  const raw = useSyncExternalStore(history.subscribe, history.get)
  return dedupeHistoryEntries(isArr(raw, emptyHistory))
}
export const useList = () => {
  const raw = useSyncExternalStore(list.subscribe, list.get)
  const arr = isArr(raw, emptyList)
  const seen = new Set<number>()
  const deduped: ListItem[] = []
  const sorted = arr.slice().sort((a, b) => (Number(b.updatedAt ?? b.addedAt) || 0) - (Number(a.updatedAt ?? a.addedAt) || 0))
  for (const item of sorted) {
    const id = Number(item.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    deduped.push({ ...item, id })
  }
  return deduped
}
export const useListItem = (id: number) => {
  const nid = Number(id)
  return useList().find((i) => Number(i.id) === nid)
}

function getWatchedEpsMap(): Record<string, number[]> {
  const v = watchedEps.get()
  return v && typeof v === 'object' && !Array.isArray(v) ? v : emptyWatchedEps
}

function recordWatchedEpRaw(mid: number, ep: number): number[] {
  if (!mid || ep <= 0) return []
  const map = getWatchedEpsMap()
  const key = String(mid)
  const prev = Array.isArray(map[key]) ? map[key] : []
  if (prev.includes(ep)) return prev
  const next = [...prev, ep].sort((a, b) => a - b)
  watchedEps.set({ ...map, [key]: next })
  return next
}

export function useWatchedEpsMap(): Record<string, number[]> {
  const v = useSyncExternalStore(watchedEps.subscribe, watchedEps.get)
  return v && typeof v === 'object' && !Array.isArray(v) ? v : emptyWatchedEps
}

export function useWatchedEpisodes(animeId: number): Set<number> {
  const map = useSyncExternalStore(watchedEps.subscribe, watchedEps.get)
  const li = useListItem(animeId)
  const arr = map && typeof map === 'object' ? map[String(animeId)] : undefined
  if (li?.status === 'completed' && li.episodes && li.episodes > 0) {
    const set = new Set<number>(Array.isArray(arr) ? arr : [])
    for (let i = 1; i <= li.episodes; i++) set.add(i)
    return set
  }
  return Array.isArray(arr) && arr.length > 0 ? new Set(arr) : emptyNumSet
}

export function isAnimeCompleted(
  _id: number,
  knownTotalEps?: number | null,
  li?: ListItem,
  histItem?: HistoryItem,
  epsArr?: number[],
): boolean {
  return isAnimeCompletedLogic({
    totalEpisodes: knownTotalEps ?? li?.episodes ?? histItem?.episodes,
    isMovieFormat: li?.format === 'MOVIE' || histItem?.format === 'MOVIE',
    histItem: histItem ? { ep: histItem.ep, pos: histItem.pos, dur: histItem.dur } : null,
    epsCount: epsArr?.length ?? 0,
    listStatus: li?.status,
    listProgress: li?.progress,
  })
}


export function useIsAnimeWatched(id: number, knownTotalEps?: number | null): boolean {
  const nid = Number(id)
  const li = useListItem(nid)
  const histList = useHistory()
  const histItem = histList.find((h) => Number(h.id) === nid)
  const epsMap = useSyncExternalStore(watchedEps.subscribe, watchedEps.get)
  const epsArr = epsMap && typeof epsMap === 'object' ? epsMap[String(nid)] : undefined
  return isAnimeCompleted(nid, knownTotalEps, li, histItem, epsArr)
}

export function useWatchedAnimeIds(): Set<number> {
  const listArr = useList()
  const histList = useHistory()
  const epsMap = useSyncExternalStore(watchedEps.subscribe, watchedEps.get)
  const ids = new Set<number>()
  for (const li of listArr) {
    const epsArr = epsMap && typeof epsMap === 'object' ? epsMap[String(li.id)] : undefined
    if (isAnimeCompleted(li.id, li.episodes, li, undefined, epsArr)) ids.add(li.id)
  }
  const seenHistIds = new Set<number>()
  for (const h of histList) {
    if (seenHistIds.has(h.id)) continue
    seenHistIds.add(h.id)
    const epsArr = epsMap && typeof epsMap === 'object' ? epsMap[String(h.id)] : undefined
    if (isAnimeCompleted(h.id, h.episodes, undefined, h, epsArr)) ids.add(h.id)
  }
  return ids
}

function getWatchedMoviesMap(): Record<string, MovieWatchEntry> {
  const v = watchedMovies.get()
  return v && typeof v === 'object' && !Array.isArray(v) ? v : emptyWatchedMovies
}

export function touchMovieProgress(input: {
  id: number
  type: 'movie' | 'tv'
  title: string
  poster?: string | null
  backdrop?: string | null
  epTitle?: string | null
  epImage?: string | null
  season?: number
  episode?: number
  pos?: number
  dur?: number
  totalEpisodesInSeason?: number
  totalSeasons?: number
}) {
  const {
    id,
    type,
    title,
    poster,
    backdrop,
    epTitle,
    epImage,
    season = 1,
    episode = 1,
    pos = 0,
    dur = 0,
    totalEpisodesInSeason,
    totalSeasons,
  } = input
  if (!id) return
  const key = `${type}:${id}`
  const map = getWatchedMoviesMap()
  const prev = map[key]
  const watchedSeasons: Record<string, number[]> = { ...(prev?.watchedSeasons || {}) }
  const sKey = String(season)
  const curEps = Array.isArray(watchedSeasons[sKey]) ? watchedSeasons[sKey] : []
  const reachedDone = isPlaybackWatched(pos, dur, WATCHED_THRESHOLD)

  if (reachedDone && !curEps.includes(episode)) {
    watchedSeasons[sKey] = [...curEps, episode].sort((a, b) => a - b)
  }

  const completed = isTmdbProgressCompleted({
    type,
    prevCompleted: Boolean(prev?.completed),
    reachedDone,
    season,
    episode,
    watchedSeasonEpsCount: watchedSeasons[sKey]?.length ?? 0,
    totalEpisodesInSeason,
    totalSeasons,
  })

  const nextEntry: MovieWatchEntry = {
    key,
    id,
    type,
    title: title || prev?.title || '',
    poster: poster ?? prev?.poster ?? null,
    backdrop: backdrop ?? prev?.backdrop ?? null,
    epTitle: epTitle !== undefined ? epTitle : (prev?.epTitle ?? null),
    epImage: epImage !== undefined ? epImage : (prev?.epImage ?? null),
    completed,
    watchedSeasons,
    lastSeason: season,
    lastEp: episode,
    pos,
    dur,
    t: Date.now(),
  }

  watchedMovies.set({ ...map, [key]: nextEntry })
  autoSyncWatchlist()
}

export function finishMovieWatch(input: {
  id: number
  type: 'movie' | 'tv'
  title: string
  poster?: string | null
  backdrop?: string | null
  epTitle?: string | null
  season?: number
  episode?: number
  hasNext?: boolean
}) {
  const { id, type, title, poster, backdrop, epTitle, season = 1, episode = 1, hasNext = false } = input
  if (!id) return
  const key = `${type}:${id}`
  const map = getWatchedMoviesMap()
  const prev = map[key]
  const watchedSeasons: Record<string, number[]> = { ...(prev?.watchedSeasons || {}) }
  const sKey = String(season)
  const curEps = Array.isArray(watchedSeasons[sKey]) ? watchedSeasons[sKey] : []
  if (!curEps.includes(episode)) {
    watchedSeasons[sKey] = [...curEps, episode].sort((a, b) => a - b)
  }
  const completed = Boolean(prev?.completed) || type === 'movie' || !hasNext
  const dur = prev?.dur || 5400

  watchedMovies.set({
    ...map,
    [key]: {
      key,
      id,
      type,
      title: title || prev?.title || '',
      poster: poster ?? prev?.poster ?? null,
      backdrop: backdrop ?? prev?.backdrop ?? null,
      epTitle: epTitle !== undefined ? epTitle : (prev?.epTitle ?? null),
      epImage: prev?.epImage ?? null,
      completed,
      watchedSeasons,
      lastSeason: season,
      lastEp: episode,
      pos: dur,
      dur,
      t: Date.now(),
    },
  })
  autoSyncWatchlist()
}

export function removeMovieHistory(type: 'movie' | 'tv', id: number) {
  const key = `${type}:${id}`
  const map = getWatchedMoviesMap()
  if (!map[key]) return
  const next = { ...map }
  delete next[key]
  watchedMovies.set(next)
  autoSyncWatchlist()
}

export function useWatchedMovieMap(): Record<string, MovieWatchEntry> {
  const v = useSyncExternalStore(watchedMovies.subscribe, watchedMovies.get)
  return v && typeof v === 'object' && !Array.isArray(v) ? v : emptyWatchedMovies
}

export function useMovieHistory(): MovieWatchEntry[] {
  const map = useWatchedMovieMap()
  return Object.values(map)
    .filter((entry) => Boolean(entry && entry.id && entry.t))
    .sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0))
}

export function useIsMovieWatched(type: 'movie' | 'tv', id: number): boolean {
  const map = useWatchedMovieMap()
  return isMovieEntryWatchedLogic(map[`${type}:${id}`], type)
}

export function useWatchedMovieEps(id: number, season: number): Set<number> {
  const map = useWatchedMovieMap()
  const entry = map[`tv:${id}`]
  const eps = entry?.watchedSeasons?.[String(season)]
  return Array.isArray(eps) && eps.length > 0 ? new Set(eps) : emptyNumSet
}


const isArr = <T,>(v: unknown, empty: T[]): T[] => (Array.isArray(v) ? (v as T[]) : empty)
const hist = () => isArr(history.get(), emptyHistory)
const items = () => isArr(list.get(), emptyList)

export const meta = (c: Meta): Meta => ({ id: c.id, title: c.title, image: c.image, color: c.color ?? null, score: c.score, format: c.format ?? null, episodes: c.episodes ?? null, year: c.year ?? null, startDate: c.startDate ?? null, ...(c.href ? { href: c.href } : {}) })

/* ---------- prefs ---------- */
export const getPrefs = (): Prefs => prefs.get()
export function savePrefs(p: Prefs) {
  const cur = prefs.get()
  if (p.server === cur.server && p.audio === cur.audio) return
  prefs.set({ ...cur, ...p })
  autoSyncWatchlist()
}

/* ---------- history ---------- */
export const getHistory = (id: number, ep?: number) => getHistoryEntry(hist(), id, ep)

/** Record what is being watched, preserving other episodes of the same show in Continue Watching. */
export function touchHistory(
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
) {
  const mid = Number(m.id)
  const { next, list: nextList } = upsertHistoryEpisode(hist(), m, p)
  // Newly touched/watched episode is immediately at index 0; previous episodes stay in Continue Watching
  history.set(nextList)

  // Update watchlist & per-episode watched state
  const li = items().find((i) => Number(i.id) === mid)
  const total = m.episodes ?? 0
  const isDone = isPlaybackWatched(next.pos, next.dur, WATCHED_THRESHOLD)
  let watchedArr = getWatchedEpsMap()[String(mid)] ?? []
  if (isDone) {
    watchedArr = recordWatchedEpRaw(mid, next.ep)
  }

  const isMovie = m.format === 'MOVIE' || total === 1
  const shouldComplete = isMovie
    ? isDone
    : isDone && total > 0 && (next.ep >= total || watchedArr.length >= total)
  const status: ListStatus = shouldComplete ? 'completed' : 'watching'
  const curProg = li?.progress ?? 0
  const progress = computeUpdatedEpisodeProgress(curProg, next.ep, isDone)


  const needUpdate = !li || li.status !== status || progress > curProg
  if (needUpdate) {
    const now = Date.now()
    const updatedItem: ListItem = {
      ...(li ?? meta(m)),
      id: mid,
      status,
      progress,
      addedAt: li?.addedAt ?? now,
      updatedAt: now,
    }
    list.set([updatedItem, ...items().filter((i) => Number(i.id) !== mid)])
    syncHooks.push?.(mid, { status, progress, label: `${m.title} · ep ${next.ep}` })
  }
  autoSyncWatchlist()
}

export function removeHistory(id: number, ep?: number) {
  history.set(removeHistoryEntry(hist(), id, ep))
  autoSyncWatchlist()
}

/** Episode finished: keep finished episode in history and queue up the next one, or finish the series. */
export function finishEpisode(m: Meta & { bannerImage?: string | null }, ep: number, hasNext: boolean) {
  const mid = Number(m.id)
  const nep = Math.max(1, Number(ep) || 1)
  history.set(finishHistoryEpisode(hist(), m, nep, hasNext, getPrefs()))
  recordWatchedEpRaw(mid, nep)
  markProgress(m, nep, !hasNext)
}

/** An episode counts as watched: update the list entry (and AniList). Never moves progress backwards. */
export function markProgress(m: Meta, ep: number, last = false) {
  const mid = Number(m.id)
  recordWatchedEpRaw(mid, ep)
  const li = items().find((i) => Number(i.id) === mid)
  const total = m.episodes ?? 0
  const watchedArr = getWatchedEpsMap()[String(mid)] ?? []
  const done =
    li?.status === 'completed' ||
    last ||
    (total > 0 && (ep >= total || watchedArr.length >= total)) ||
    m.format === 'MOVIE'
  const status: ListStatus = done ? 'completed' : 'watching'
  const progress = done && total > 0 ? total : Math.max(li?.progress ?? 0, ep)
  const now = Date.now()
  const updatedItem: ListItem = {
    ...(li ?? meta(m)),
    id: mid,
    status,
    progress,
    addedAt: li?.addedAt ?? now,
    updatedAt: now,
  }
  list.set([updatedItem, ...items().filter((i) => Number(i.id) !== mid)])
  syncHooks.push?.(mid, { status, progress, label: `${m.title} · ep ${ep}` })
  autoSyncWatchlist()
}

/* ---------- watchlist ---------- */
export function addToList(m: Meta, status: ListStatus = 'planning') {
  const mid = Number(m.id)
  if (items().some((i) => Number(i.id) === mid)) return
  const now = Date.now()
  list.set([{ ...meta(m), id: mid, status, addedAt: now, updatedAt: now }, ...items()])
  syncHooks.push?.(mid, { status, progress: 0 })
  autoSyncWatchlist()
}
export function removeFromList(id: number) {
  const mid = Number(id)
  list.set(items().filter((i) => Number(i.id) !== mid))
  syncHooks.remove?.(mid)
  autoSyncWatchlist()
}
export function setStatus(id: number, status: ListStatus) {
  const mid = Number(id)
  const li = items().find((i) => Number(i.id) === mid)
  if (!li || li.status === status) return
  const progress = status === 'completed' && li.episodes ? li.episodes : li.progress
  const rest = items().filter((i) => Number(i.id) !== mid)
  list.set([{ ...li, id: mid, status, progress, updatedAt: Date.now() }, ...rest])
  syncHooks.push?.(mid, { status, progress })
  autoSyncWatchlist()
}

/* ---------- AniList pull (no hooks, so nothing is pushed back) ---------- */
export interface RemoteEntry {
  meta: Meta
  status: ListStatus
  progress: number
  /** last changed on AniList, ms */
  updated: number
}

/** Merge the AniList list in: statuses and progress follow AniList; "Watching" shows are queued in Continue Watching at the next episode. */
export function applyRemote(entries: RemoteEntry[], server: string, audio: Audio) {
  const cur = items()
  const byId = new Map(cur.map((i) => [Number(i.id), i]))
  for (const e of entries) {
    const eid = Number(e.meta.id)
    const old = byId.get(eid)
    byId.set(eid, {
      ...meta(e.meta),
      id: eid,
      status: e.status,
      progress: e.progress,
      addedAt: old?.addedAt ?? e.updated,
      updatedAt: Math.max(old?.updatedAt ?? 0, e.updated || 0),
    })
  }
  list.set([...byId.values()].sort((a, b) => (Number(b.updatedAt ?? b.addedAt) || 0) - (Number(a.updatedAt ?? a.addedAt) || 0)))

  history.set(mergeRemoteHistoryEntries(hist(), entries, server, audio, Date.now(), MAX_HISTORY))
}
export function toggleList(m: Meta) {
  const mid = Number(m.id)
  if (items().some((i) => Number(i.id) === mid)) removeFromList(mid)
  else addToList(m)
}

/* ---------- Favorites & Custom Lists ---------- */
export function toggleFavorite(m: Meta | number) {
  const mid = typeof m === 'number' ? m : Number(m.id)
  const cur = items()
  const li = cur.find((i) => Number(i.id) === mid)
  const now = Date.now()
  if (!li) {
    if (typeof m !== 'number') {
      list.set([{ ...meta(m), id: mid, status: 'planning', favorite: true, addedAt: now, updatedAt: now }, ...cur])
    }
  } else {
    const nextFav = !li.favorite
    list.set(cur.map((i) => Number(i.id) === mid ? { ...i, favorite: nextFav, updatedAt: now } : i))
  }
  autoSyncWatchlist()
}

export function isFavorite(id: number): boolean {
  const nid = Number(id)
  return !!items().find((i) => Number(i.id) === nid)?.favorite
}

export function toggleAnimeInCustomList(animeId: number, listId: string, m?: Meta) {
  const mid = Number(animeId)
  const cur = items()
  const li = cur.find((i) => Number(i.id) === mid)
  const now = Date.now()
  if (!li) {
    if (m) {
      list.set([{ ...meta(m), id: mid, status: 'planning', customLists: [listId], addedAt: now, updatedAt: now }, ...cur])
    }
  } else {
    const currentLists = li.customLists || []
    const nextLists = currentLists.includes(listId)
      ? currentLists.filter((id) => id !== listId)
      : [...currentLists, listId]
    list.set(cur.map((i) => Number(i.id) === mid ? { ...i, customLists: nextLists, updatedAt: now } : i))
  }
  autoSyncWatchlist()
}

export function createCustomList(name: string): CustomListDef {
  const trimmed = name.trim()
  const id = 'list_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
  const newDef: CustomListDef = { id, name: trimmed, createdAt: Date.now() }
  const existing = customLists.get() || []
  customLists.set([...existing, newDef])
  autoSyncWatchlist()
  return newDef
}

export function deleteCustomList(listId: string) {
  const existing = customLists.get() || []
  customLists.set(existing.filter((cl) => cl.id !== listId))
  // Clean from anime items
  const cur = items()
  list.set(cur.map((i) => ({
    ...i,
    customLists: (i.customLists || []).filter((id) => id !== listId),
  })))
  autoSyncWatchlist()
}

export function renameCustomList(listId: string, newName: string) {
  const existing = customLists.get() || []
  customLists.set(existing.map((cl) => cl.id === listId ? { ...cl, name: newName.trim() } : cl))
  autoSyncWatchlist()
}
