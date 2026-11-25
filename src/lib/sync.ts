import { isSupabaseConfigured, supabase } from './supabase'
import { mergeHistoryEntries } from './historyLogic'
import {
  getAllCustomLists,
  getAllHistory,
  getAllLastEps,
  getAllList,
  getAllWatchedEps,
  getAllWatchedMovies,
  getPrefs,
  setCustomListsData,
  setHistoryList,
  setLastEpsMap,
  setPrefsData,
  setWatchedEpsMap,
  setWatchedMoviesMap,
  setWatchlist,
  type CustomListDef,
  type HistoryItem,
  type ListItem,
  type MovieWatchEntry,
  type Prefs,
} from './library'
import {
  getAllReaderPrefs,
  getAllReading,
  setAllReaderPrefs,
  setAllReading,
  type ReadingItem,
} from './reading'
import { sanitizeNameStyle, serializeNameStyle } from './nameStyle'
import {
  getCachedSyncExt,
  getProfile,
  mergeRemoteProfile,
  setCachedSyncExt,
  syncProfileToCloud,
  type Profile,
} from './profile'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
let lastSyncTime: number | null = null

interface SyncExtPayload {
  watched_eps?: Record<string, number[]>
  watched_movies?: Record<string, MovieWatchEntry>
  prefs?: Prefs
  last_eps?: Record<string, number>
  reader_prefs?: Record<string, unknown>
  support?: unknown
}

function explain(e: any): string {
  if (!isSupabaseConfigured) return 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.'
  const t = `${e?.code ?? ''} ${e?.message ?? ''}`
  if (/42P01|PGRST205|does not exist|schema cache/i.test(t)) return 'The user_sync table is missing in Supabase. Run supabase/schema.sql first.'
  if (/42501|row-level security|permission denied/i.test(t)) return 'Supabase refused access: check the row-level security policies on user_sync.'
  if (/failed to fetch|networkerror|load failed/i.test(t)) return 'Could not reach Supabase. Check your internet connection.'
  return e?.message || 'Sync failed'
}

export function getLastSyncTime(): number | null {
  return lastSyncTime
}

export function resetSyncMeta() {
  lastSyncTime = null
}

export function formatLastSync(t: number | null): string {
  if (!t) return 'Never synced'
  const diff = Date.now() - t
  if (diff < 60_000) return 'Just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 24 * 3600_000) {
    const date = new Date(t)
    return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }
  const date = new Date(t)
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isMissingColumnError(err: any): boolean {
  const msg = `${err?.code ?? ''} ${err?.message ?? ''}`
  return /42703|PGRST204|column.*does not exist|could not find the/i.test(msg)
}

function isNetworkError(err: any): boolean {
  const msg = `${err?.message ?? ''} ${err?.details ?? ''} ${String(err ?? '')}`
  return /failed to fetch|networkerror|load failed|network request failed|abort/i.test(msg)
}

const inFlightPulls = new Map<string, Promise<{ success: boolean; count: number; error?: string }>>()

/**
 * Push all user data (history, watchlist, custom_lists, reading, watched_eps, watched_movies, prefs, profile) to Supabase.
 */
export async function pushWatchHistory(userId: string): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    if (!userId) throw new Error('Not logged in')
    if (!isSupabaseConfigured) return { success: false, count: 0, error: explain(null) }

    const history = getAllHistory()
    const watchlist = getAllList()
    const custom_lists = getAllCustomLists()
    const reading = getAllReading()
    const watched_eps = getAllWatchedEps()
    const watched_movies = getAllWatchedMovies()
    const prefs = getPrefs()
    const profile = getProfile()

    const prevExt = getCachedSyncExt()
    const ext: SyncExtPayload = {
      watched_eps,
      watched_movies,
      prefs,
      last_eps: getAllLastEps(),
      reader_prefs: getAllReaderPrefs(),
      ...(prevExt?.support ? { support: prevExt.support } : {}),
    }

    const profilePayload = {
      name: profile.name || '',
      avatar: profile.avatar || null,
      banner: profile.banner || null,
      frame: profile.frame || null,
      bio: profile.bio ?? '',
      nameStyle: serializeNameStyle(profile.nameStyle),
    }
    setCachedSyncExt(ext as Record<string, unknown>)
    const profileWithExt = { ...profilePayload, __ext: ext }
    const updated_at = new Date().toISOString()

    // Try writing dedicated columns first; if schema omits optional columns, store ext cleanly inside profile.__ext
    let { error } = await supabase.from('user_sync').upsert(
      {
        user_id: userId,
        history,
        watchlist,
        custom_lists,
        reading,
        watched_eps,
        watched_movies,
        prefs,
        profile: profileWithExt,
        updated_at,
      },
      { onConflict: 'user_id' },
    )

    if (error && isMissingColumnError(error)) {
      const retry = await supabase.from('user_sync').upsert(
        {
          user_id: userId,
          history,
          watchlist,
          custom_lists,
          reading,
          profile: profileWithExt,
          updated_at,
        },
        { onConflict: 'user_id' },
      )
      error = retry.error
    }

    if (error && isNetworkError(error) && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      await new Promise((r) => setTimeout(r, 600))
      const retryNet = await supabase.from('user_sync').upsert(
        {
          user_id: userId,
          history,
          watchlist,
          custom_lists,
          reading,
          watched_eps,
          watched_movies,
          prefs,
          profile: profileWithExt,
          updated_at,
        },
        { onConflict: 'user_id' },
      )
      error = retryNet.error
    }

    if (error) throw error

    await syncProfileToCloud(userId, undefined, profilePayload, { skipUserSync: true })

    const now = Date.now()
    lastSyncTime = now
    window.dispatchEvent(new CustomEvent('zk:sync', { detail: { type: 'push', time: now } }))

    return { success: true, count: history.length }
  } catch (err: any) {
    if (isNetworkError(err)) {
      console.warn('[Sync] Push skipped (network unavailable):', err?.message || err)
    } else {
      console.error('[Sync] Push error:', err)
    }
    return { success: false, count: 0, error: explain(err) }
  }
}

/**
 * Pull all user data from Supabase and hydrate in-memory stores.
 */
export function pullWatchHistory(userId: string): Promise<{ success: boolean; count: number; error?: string }> {
  if (!userId) return Promise.resolve({ success: false, count: 0, error: 'Not logged in' })
  const existing = inFlightPulls.get(userId)
  if (existing) return existing

  const run = pullWatchHistoryInternal(userId).finally(() => {
    if (inFlightPulls.get(userId) === run) {
      inFlightPulls.delete(userId)
    }
  })
  inFlightPulls.set(userId, run)
  return run
}

async function pullWatchHistoryInternal(userId: string): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    if (!userId) throw new Error('Not logged in')
    if (!isSupabaseConfigured) return { success: false, count: 0, error: explain(null) }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, count: 0, error: 'Could not reach Supabase. Check your internet connection.' }
    }

    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData?.session?.access_token) {
      return { success: false, count: 0, error: 'Not logged in' }
    }

    const queryFull = () =>
      supabase
        .from('user_sync')
        .select('history, watchlist, custom_lists, reading, watched_eps, watched_movies, prefs, profile, updated_at')
        .eq('user_id', userId)
        .maybeSingle()

    let { data, error }: { data: any; error: any } = await queryFull()

    if (error && isNetworkError(error) && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      await new Promise((r) => setTimeout(r, 600))
      const retryNet = await queryFull()
      data = retryNet.data
      error = retryNet.error
    }

    if (error && isMissingColumnError(error)) {
      const retry = await supabase
        .from('user_sync')
        .select('history, watchlist, custom_lists, reading, profile, updated_at')
        .eq('user_id', userId)
        .maybeSingle()
      data = retry.data
      error = retry.error
    }

    if (error) throw error
    if (!data) return { success: true, count: 0 }

    const rawProfile = data.profile as (Profile & { __ext?: SyncExtPayload }) | null
    const ext = rawProfile?.__ext
    setCachedSyncExt(ext && typeof ext === 'object' ? (ext as Record<string, unknown>) : null)
    if (ext?.support) {
      try {
        window.dispatchEvent(new CustomEvent('zk_mission_sync'))
      } catch {}
    }

    // 0. Profile
    if (rawProfile && typeof rawProfile === 'object') {
      const cur = getProfile()
      mergeRemoteProfile({
        name: cur.name || rawProfile.name || '',
        avatar: cur.avatar || rawProfile.avatar || null,
        banner: cur.banner || rawProfile.banner || null,
        frame: cur.frame || rawProfile.frame || null,
        bio: cur.bio !== undefined && cur.bio !== '' ? cur.bio : (rawProfile.bio || ''),
        nameStyle: cur.nameStyle ?? (rawProfile.nameStyle ? sanitizeNameStyle(rawProfile.nameStyle) : null),
      })
    }

    // 1. Custom Lists
    const remoteCustomLists = Array.isArray(data.custom_lists) ? (data.custom_lists as CustomListDef[]) : []
    if (remoteCustomLists.length > 0) {
      const clMap = new Map<string, CustomListDef>()
      for (const cl of getAllCustomLists()) if (cl?.id) clMap.set(cl.id, cl)
      for (const rcl of remoteCustomLists) if (rcl?.id && !clMap.has(rcl.id)) clMap.set(rcl.id, rcl)
      setCustomListsData(Array.from(clMap.values()))
    }

    // 2. History (merge per anime/donghua episode so multiple episodes stay preserved)
    const remoteHistory = Array.isArray(data.history) ? (data.history as HistoryItem[]) : []
    const mergedHistory = mergeHistoryEntries(getAllHistory(), remoteHistory, 100)
    setHistoryList(mergedHistory)

    // 3. Watchlist
    const remoteList = Array.isArray(data.watchlist) ? (data.watchlist as ListItem[]) : []
    const listMap = new Map<number, ListItem>()
    for (const item of getAllList()) if (item?.id) listMap.set(Number(item.id), item)
    for (const ri of remoteList) {
      if (!ri?.id) continue
      const nid = Number(ri.id)
      const existing = listMap.get(nid)
      if (!existing) {
        listMap.set(nid, ri)
      } else {
        const remoteTime = Number(ri.updatedAt ?? ri.addedAt) || 0
        const localTime = Number(existing.updatedAt ?? existing.addedAt) || 0
        if (remoteTime > localTime || (ri.progress || 0) > (existing.progress || 0)) {
          listMap.set(nid, { ...existing, ...ri })
        }
      }
    }
    setWatchlist(Array.from(listMap.values()))

    // 4. Reading
    const remoteReading = Array.isArray(data.reading) ? (data.reading as ReadingItem[]) : []
    const readingMap = new Map<string, ReadingItem>()
    for (const r of getAllReading()) if (r?.id) readingMap.set(`${r.kind}:${r.id}`, r)
    for (const rr of remoteReading) {
      if (!rr?.id) continue
      const key = `${rr.kind}:${rr.id}`
      const existing = readingMap.get(key)
      if (!existing || (rr.t || 0) > (existing.t || 0)) readingMap.set(key, rr)
    }
    setAllReading(
      Array.from(readingMap.values())
        .sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0))
        .slice(0, 50),
    )

    // 5. Watched episodes map (merge arrays per anime)
    const remoteWatchedEps = (data.watched_eps || ext?.watched_eps || {}) as Record<string, number[]>
    if (remoteWatchedEps && typeof remoteWatchedEps === 'object') {
      const mergedEps: Record<string, number[]> = { ...getAllWatchedEps() }
      for (const [aid, eps] of Object.entries(remoteWatchedEps)) {
        if (!Array.isArray(eps)) continue
        const set = new Set<number>([...(mergedEps[aid] || []), ...eps])
        mergedEps[aid] = Array.from(set).sort((a, b) => a - b)
      }
      setWatchedEpsMap(mergedEps)
    }

    // 6. Watched movies & TMDB TV series map
    const remoteWatchedMovies = (data.watched_movies || ext?.watched_movies || {}) as Record<string, MovieWatchEntry>
    if (remoteWatchedMovies && typeof remoteWatchedMovies === 'object') {
      const mergedMovies: Record<string, MovieWatchEntry> = { ...getAllWatchedMovies() }
      for (const [mKey, entry] of Object.entries(remoteWatchedMovies)) {
        if (!entry || typeof entry !== 'object') continue
        const cur = mergedMovies[mKey]
        if (!cur) {
          mergedMovies[mKey] = entry
        } else {
          const seasons: Record<string, number[]> = { ...(cur.watchedSeasons || {}) }
          for (const [s, eps] of Object.entries(entry.watchedSeasons || {})) {
            if (!Array.isArray(eps)) continue
            seasons[s] = Array.from(new Set([...(seasons[s] || []), ...eps])).sort((a, b) => a - b)
          }
          const latest = (entry.t || 0) >= (cur.t || 0) ? entry : cur
          mergedMovies[mKey] = {
            ...latest,
            completed: Boolean(cur.completed || entry.completed),
            watchedSeasons: seasons,
          }
        }
      }
      setWatchedMoviesMap(mergedMovies)
    }

    // 7. Prefs & resume episode pointers & reader prefs
    const remotePrefs = (data.prefs || ext?.prefs) as Prefs | undefined
    if (remotePrefs && typeof remotePrefs === 'object') {
      setPrefsData({ ...remotePrefs, ...getPrefs() })
    }
    if (ext?.last_eps && typeof ext.last_eps === 'object') {
      setLastEpsMap({ ...ext.last_eps, ...getAllLastEps() })
    }
    if (ext?.reader_prefs && typeof ext.reader_prefs === 'object') {
      setAllReaderPrefs({ ...ext.reader_prefs, ...getAllReaderPrefs() })
    }

    const now = Date.now()
    lastSyncTime = now
    window.dispatchEvent(new CustomEvent('zk:sync', { detail: { type: 'pull', time: now } }))

    return { success: true, count: mergedHistory.length }
  } catch (err: any) {
    if (isNetworkError(err)) {
      console.warn('[Sync] Pull skipped (network unavailable):', err?.message || err)
    } else {
      console.error('[Sync] Pull error:', err)
    }
    return { success: false, count: 0, error: explain(err) }
  }
}

/** Two-way sync: pull from Supabase first, then push merged state. */
export async function syncNow(userId: string): Promise<{ success: boolean; count: number; error?: string }> {
  const pulled = await pullWatchHistory(userId)
  return pulled.success ? pushWatchHistory(userId) : pulled
}

/** Checks if the daily sync is due (>= 24h since last sync) and syncs when signed in. */
export async function checkDailySync(userId?: string): Promise<boolean> {
  if (!userId || !isSupabaseConfigured) return false
  try {
    const { data } = await supabase.auth.getSession()
    if (!data?.session?.access_token) return false
  } catch {
    return false
  }

  const now = Date.now()
  if (lastSyncTime && now - lastSyncTime < ONE_DAY_MS) {
    return false
  }

  return (await syncNow(userId)).success
}

let autoSyncTimeout: any = null
let dirtySync = false

export function autoSyncWatchlist() {
  if (!isSupabaseConfigured) return
  dirtySync = true
  clearTimeout(autoSyncTimeout)
  autoSyncTimeout = setTimeout(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const uid = sessionData?.session?.user?.id
      if (!sessionData?.session?.access_token || !uid) return
      dirtySync = false
      await pushWatchHistory(uid)
    } catch (err) {
      console.warn('[Sync] Auto-sync background error:', err)
    }
  }, 400)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirtySync && isSupabaseConfigured) {
      void supabase.auth.getSession().then(({ data }) => {
        const uid = data?.session?.user?.id
        if (uid) {
          dirtySync = false
          clearTimeout(autoSyncTimeout)
          void pushWatchHistory(uid)
        }
      })
    }
  })
}
