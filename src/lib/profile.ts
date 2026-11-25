import { useSyncExternalStore } from 'react'
import { cell } from './library'
import { sanitizeNameStyle, serializeNameStyle, type NameStyle } from './nameStyle'
import { isSupabaseConfigured, supabase } from './supabase'
import { toast } from './toast'

/** Local and cloud profile interface */
export interface Profile {
  name: string
  avatar: string | null
  banner: string | null
  frame: string | null
  bio?: string | null
  nameStyle?: NameStyle | null
}

export interface PublicMediaItem {
  id: number | string
  title: string
  image: string
  score?: number | null
  year?: number | null
  format?: string | null
  status?: string | null
  episodes?: number | null
  progress?: number | null
  ep?: number | null
  epTitle?: string | null
  bannerImage?: string | null
  href?: string
  resumeHref?: string
  source?: string | null
  kind?: 'anime' | 'manhwa' | 'manga' | 'novel'
  label?: string
  updatedAt?: number | string
}

export interface PublicUserData {
  id?: string
  username: string
  profile: Profile
  watchlistCount?: number
  historyCount?: number
  readingCount?: number
  watchlistItems?: PublicMediaItem[]
  historyItems?: PublicMediaItem[]
  readingItems?: PublicMediaItem[]
  createdAt?: string
  updatedAt?: string
}

const empty: Profile = { name: '', avatar: null, banner: null, frame: null, bio: '', nameStyle: null }
const store = cell<Profile>('zk:profile', empty)

type ProfileKey = keyof Profile
const dirtyFields = new Set<ProfileKey>()
let activeProfileUser: { id: string; username?: string } | null = null
let cachedSyncExt: Record<string, unknown> | null = null
let hasCheckedRemoteExt = false
let pendingDebounceTimer: ReturnType<typeof setTimeout> | null = null
let hasPendingSync = false
let syncQueue: Promise<boolean> = Promise.resolve(true)
let lastErrorToastAt = 0

export const useProfile = () => useSyncExternalStore(store.subscribe, store.get)
export const getProfile = () => store.get()

export const setActiveProfileUser = (user: { id: string; username?: string } | null) => {
  if (!user) {
    activeProfileUser = null
    return
  }
  activeProfileUser = {
    id: user.id,
    username: user.username || activeProfileUser?.username,
  }
}

export const setCachedSyncExt = (ext: Record<string, unknown> | null) => {
  cachedSyncExt = ext && typeof ext === 'object' ? ext : null
  hasCheckedRemoteExt = true
}

export const getCachedSyncExt = () => cachedSyncExt

export const mergeCachedSyncExt = (patch: Record<string, unknown>) => {
  cachedSyncExt = {
    ...(cachedSyncExt && typeof cachedSyncExt === 'object' ? cachedSyncExt : {}),
    ...patch,
  }
  hasCheckedRemoteExt = true
}

export const isProfileFieldDirty = (field: ProfileKey) => dirtyFields.has(field)

export const resetProfileStore = () => {
  if (pendingDebounceTimer) {
    clearTimeout(pendingDebounceTimer)
    pendingDebounceTimer = null
  }
  hasPendingSync = false
  dirtyFields.clear()
  activeProfileUser = null
  cachedSyncExt = null
  hasCheckedRemoteExt = false
  store.set(empty)
}

export const setProfileStore = (p: Profile) => {
  store.set(p)
}

/**
 * Safely merge remote profile fields without clobbering unsaved local edits.
 */
export const mergeRemoteProfile = (remote: Partial<Profile>) => {
  const cur = store.get()
  const nextNameStyle = dirtyFields.has('nameStyle')
    ? cur.nameStyle ?? null
    : remote.nameStyle !== undefined
      ? (remote.nameStyle ? serializeNameStyle(remote.nameStyle) : null)
      : (cur.nameStyle ?? null)
  const next: Profile = {
    name: dirtyFields.has('name') ? cur.name : (remote.name ?? cur.name ?? ''),
    avatar: dirtyFields.has('avatar') ? cur.avatar : (remote.avatar ?? cur.avatar ?? null),
    banner: dirtyFields.has('banner') ? cur.banner : (remote.banner ?? cur.banner ?? null),
    frame: dirtyFields.has('frame') ? cur.frame : (remote.frame ?? cur.frame ?? null),
    bio: dirtyFields.has('bio') ? cur.bio : (remote.bio !== undefined ? remote.bio : (cur.bio ?? '')),
    nameStyle: nextNameStyle,
  }
  store.set(next)
  return next
}

function isMissingColumnError(err: any): boolean {
  const msg = `${err?.code ?? ''} ${err?.message ?? ''}`
  return /42703|PGRST204|column.*does not exist|could not find the/i.test(msg)
}

function isUniqueViolationError(err: any): boolean {
  const msg = `${err?.code ?? ''} ${err?.message ?? ''}`
  return /23505|duplicate key|unique constraint/i.test(msg)
}

function isNetworkError(err: any): boolean {
  const msg = `${err?.message ?? ''} ${err?.details ?? ''} ${String(err ?? '')}`
  return /failed to fetch|networkerror|load failed|network request failed|abort/i.test(msg)
}

async function resolveActiveUser(): Promise<{ id: string; username?: string } | null> {
  if (activeProfileUser?.id) return activeProfileUser
  if (!isSupabaseConfigured) return null
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user?.id) {
      const u = session.user
      const uname = (u.user_metadata?.username as string | undefined)?.trim()
      activeProfileUser = { id: u.id, username: uname }
      return activeProfileUser
    }
  } catch {
    // ignore
  }
  return null
}

function enqueueProfileCloudSync(notifyOnError: boolean): Promise<boolean> {
  hasPendingSync = false
  syncQueue = syncQueue
    .catch(() => true)
    .then(async () => {
      const user = await resolveActiveUser()
      if (!user?.id) return false

      const snapshot = store.get()
      const res = await syncProfileToCloud(user.id, user.username, snapshot)
      if (res.ok) {
        const latest = store.get()
        ;(['name', 'avatar', 'banner', 'frame', 'bio'] as const).forEach((k) => {
          if ((latest[k] ?? null) === (snapshot[k] ?? null)) {
            dirtyFields.delete(k)
          }
        })
        if (JSON.stringify(serializeNameStyle(latest.nameStyle)) === JSON.stringify(serializeNameStyle(snapshot.nameStyle))) {
          dirtyFields.delete('nameStyle')
        }
        return true
      }

      if (notifyOnError) {
        const now = Date.now()
        if (now - lastErrorToastAt > 4000) {
          lastErrorToastAt = now
          toast(res.error || 'Could not save profile changes to Supabase.', 'error')
        }
      }
      return false
    })
  return syncQueue
}

/**
 * Flush any debounced/pending profile sync immediately and await completion.
 */
export async function flushProfileSync(): Promise<boolean> {
  if (pendingDebounceTimer) {
    clearTimeout(pendingDebounceTimer)
    pendingDebounceTimer = null
  }
  if (hasPendingSync || dirtyFields.size > 0) {
    return enqueueProfileCloudSync(false)
  }
  return syncQueue
}

/**
 * Save profile locally and reliably sync changes to Supabase `profiles` & `user_sync`.
 */
export const saveProfile = (p: Partial<Profile>, opts?: { immediate?: boolean }) => {
  const current = store.get()
  const updated = { ...current, ...p }
  store.set(updated)

  const keys = Object.keys(p) as ProfileKey[]
  for (const k of keys) {
    dirtyFields.add(k)
  }

  const hasVisualChange = 'avatar' in p || 'banner' in p || 'frame' in p || 'nameStyle' in p
  if (opts?.immediate || hasVisualChange) {
    if (pendingDebounceTimer) {
      clearTimeout(pendingDebounceTimer)
      pendingDebounceTimer = null
    }
    void enqueueProfileCloudSync(true)
    return
  }

  hasPendingSync = true
  if (pendingDebounceTimer) clearTimeout(pendingDebounceTimer)
  pendingDebounceTimer = setTimeout(() => {
    pendingDebounceTimer = null
    void enqueueProfileCloudSync(false)
  }, 400)
}

export interface ProfileSyncResult {
  ok: boolean
  profilesOk: boolean
  syncOk: boolean
  usernameConflict?: boolean
  error?: string
}

/**
 * Push profile details to Supabase `profiles` and `user_sync` tables with
 * column fallback, unique-username recovery, and `__ext` preservation.
 */
export async function syncProfileToCloud(
  userId: string,
  username?: string,
  p?: Partial<Profile>,
  opts?: { skipUserSync?: boolean },
): Promise<ProfileSyncResult> {
  if (!userId || !isSupabaseConfigured) {
    return { ok: false, profilesOk: false, syncOk: false, error: 'Supabase is not configured.' }
  }

  const current: Profile = { ...store.get(), ...p }
  const cleanUsername = (username || activeProfileUser?.username || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
  const nowIso = new Date().toISOString()

  let profilesOk = false
  let syncOk = Boolean(opts?.skipUserSync)
  let hadUsernameConflict = false
  let firstErrorMsg: string | undefined

  const serializedNameStyle = serializeNameStyle(current.nameStyle)

  // 1. Upsert public.profiles
  const baseProfilePayload: Record<string, any> = {
    id: userId,
    display_name: current.name || null,
    avatar_url: current.avatar || null,
    banner_url: current.banner || null,
    frame: current.frame || null,
    bio: current.bio ?? '',
    name_style: serializedNameStyle,
    updated_at: nowIso,
  }
  if (cleanUsername) {
    baseProfilePayload.username = cleanUsername
  }

  const upsertProfiles = async (row: Record<string, any>) => {
    let { error } = await supabase.from('profiles').upsert(row, { onConflict: 'id' })
    if (error && isNetworkError(error)) {
      await new Promise((r) => setTimeout(r, 450))
      const retry = await supabase.from('profiles').upsert(row, { onConflict: 'id' })
      error = retry.error
    }
    return error
  }

  try {
    let pErr = await upsertProfiles(baseProfilePayload)

    if (pErr && isUniqueViolationError(pErr) && 'username' in baseProfilePayload) {
      hadUsernameConflict = true
      const { username: _omitUser, ...withoutUsername } = baseProfilePayload
      pErr = await upsertProfiles(withoutUsername)
    }

    if (pErr && isMissingColumnError(pErr)) {
      // First retry without name_style in case only name_style migration hasn't been applied yet
      const { name_style: _omitStyle, ...withoutNameStyle } = baseProfilePayload
      if (hadUsernameConflict) delete withoutNameStyle.username
      pErr = await upsertProfiles(withoutNameStyle)
    }

    if (pErr && isMissingColumnError(pErr)) {
      // Fallback for older profiles schemas missing optional columns (banner_url, frame, bio)
      const minimalPayload: Record<string, any> = {
        id: userId,
        display_name: current.name || null,
        avatar_url: current.avatar || null,
        updated_at: nowIso,
      }
      if (cleanUsername && !hadUsernameConflict) minimalPayload.username = cleanUsername
      pErr = await upsertProfiles(minimalPayload)
      if (pErr && isUniqueViolationError(pErr)) {
        hadUsernameConflict = true
        const { username: _omitUser, ...withoutUsername } = minimalPayload
        pErr = await upsertProfiles(withoutUsername)
      }
    }

    if (!pErr) {
      profilesOk = true
    } else {
      firstErrorMsg = pErr.message || 'Could not update profiles table'
      console.warn('[Profile] profiles upsert error:', pErr)
    }
  } catch (err: any) {
    firstErrorMsg = err?.message || 'profiles sync exception'
    console.warn('[Profile] profiles sync exception:', err)
  }

  // 2. Keep user_sync.profile in sync (preserving __ext so watch progress/prefs are never lost)
  if (!opts?.skipUserSync) {
    try {
      if (!hasCheckedRemoteExt) {
        hasCheckedRemoteExt = true
        const { data: existingSync } = await supabase
          .from('user_sync')
          .select('profile')
          .eq('user_id', userId)
          .maybeSingle()
        const existingExt = (existingSync?.profile as any)?.__ext
        if (existingExt && typeof existingExt === 'object') {
          cachedSyncExt = existingExt
        }
      }

      const profileForSync: Record<string, any> = {
        name: current.name || '',
        avatar: current.avatar || null,
        banner: current.banner || null,
        frame: current.frame || null,
        bio: current.bio ?? '',
        nameStyle: serializedNameStyle,
      }
      if (cachedSyncExt) {
        profileForSync.__ext = cachedSyncExt
      }

      const syncPayload: Record<string, any> = {
        user_id: userId,
        profile: profileForSync,
        updated_at: nowIso,
      }
      if (cleanUsername && !hadUsernameConflict) {
        syncPayload.username = cleanUsername
      }

      const upsertSync = async (row: Record<string, any>) => {
        let { error } = await supabase.from('user_sync').upsert(row, { onConflict: 'user_id' })
        if (error && isNetworkError(error)) {
          await new Promise((r) => setTimeout(r, 450))
          const retry = await supabase.from('user_sync').upsert(row, { onConflict: 'user_id' })
          error = retry.error
        }
        return error
      }

      let sErr = await upsertSync(syncPayload)
      if (sErr && (isMissingColumnError(sErr) || isUniqueViolationError(sErr)) && 'username' in syncPayload) {
        if (isUniqueViolationError(sErr)) hadUsernameConflict = true
        const { username: _omitUser, ...withoutUsername } = syncPayload
        sErr = await upsertSync(withoutUsername)
      }

      if (!sErr) {
        syncOk = true
      } else {
        if (!firstErrorMsg) firstErrorMsg = sErr.message || 'Could not update user_sync table'
        console.warn('[Profile] user_sync upsert error:', sErr)
      }
    } catch (err: any) {
      if (!firstErrorMsg) firstErrorMsg = err?.message || 'user_sync sync exception'
      console.warn('[Profile] user_sync sync exception:', err)
    }
  }

  return {
    ok: profilesOk || syncOk,
    profilesOk,
    syncOk,
    usernameConflict: hadUsernameConflict || undefined,
    error: profilesOk || syncOk ? undefined : firstErrorMsg,
  }
}

/**
 * Pull profile from Supabase `profiles` for a user and update local cache.
 */
export async function pullProfileFromCloud(userId: string): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error || !data) return null

    const remoteNameStyle = data.name_style ? sanitizeNameStyle(data.name_style) : null
    const remote: Profile = {
      name: data.display_name || '',
      avatar: data.avatar_url || null,
      banner: data.banner_url || null,
      frame: data.frame || null,
      bio: data.bio || '',
      nameStyle: remoteNameStyle,
    }

    const current = store.get()
    const resolvedStyle = dirtyFields.has('nameStyle')
      ? (current.nameStyle ?? null)
      : (remoteNameStyle ?? current.nameStyle ?? null)
    const merged: Profile = {
      name: (dirtyFields.has('name') ? current.name : '') || remote.name || current.name,
      avatar: (dirtyFields.has('avatar') ? current.avatar : null) || remote.avatar || current.avatar,
      banner: (dirtyFields.has('banner') ? current.banner : null) || remote.banner || current.banner,
      frame: (dirtyFields.has('frame') ? current.frame : null) || remote.frame || current.frame,
      bio: (dirtyFields.has('bio') ? current.bio : '') || remote.bio || current.bio || '',
      nameStyle: resolvedStyle,
    }

    store.set(merged)
    return merged
  } catch {
    return null
  }
}

export function parsePublicReadingItem(item: any): PublicMediaItem | null {
  if (!item || (!item.id && !item.title)) return null
  const idStr = String(item.id || '')
  const rawHref = typeof item.href === 'string' ? item.href : ''
  const rawResume = typeof item.resume === 'string' ? item.resume : ''

  const isNovel =
    item.kind === 'novel' ||
    idStr.startsWith('novelfire:') ||
    rawHref.startsWith('/novel') ||
    rawResume.startsWith('/novel')

  const isManhwa =
    !isNovel &&
    (item.kind === 'manhwa' ||
      idStr.startsWith('asura:') ||
      idStr.startsWith('demonicscans:') ||
      idStr.startsWith('comick:') ||
      rawHref.startsWith('/manhwa') ||
      rawResume.startsWith('/manhwa'))

  const kind: PublicMediaItem['kind'] = isNovel ? 'novel' : isManhwa ? 'manhwa' : 'manga'

  let source: string | null = null
  if (idStr.startsWith('asura:')) source = 'Asura Scans'
  else if (idStr.startsWith('demonicscans:') || rawHref.includes('source=demonicscans')) source = 'DemonicScans'
  else if (idStr.startsWith('comick:') || rawHref.includes('source=comick')) source = 'ComicK'
  else if (idStr.startsWith('novelfire:') || rawHref.includes('/novel/novelfire')) source = 'NovelFire'
  else if (idStr.startsWith('mangadex:') || rawHref.includes('source=mangadex') || kind === 'manga') source = 'MangaDex'

  const detailsHref =
    rawHref ||
    (kind === 'novel'
      ? `/novel/${idStr}`
      : kind === 'manhwa'
        ? `/manhwa/${encodeURIComponent(idStr.replace(/^(asura|demonicscans|comick|mangadex):/, ''))}?title=${encodeURIComponent(item.title || '')}`
        : `/manga/${encodeURIComponent(idStr)}?title=${encodeURIComponent(item.title || '')}`)

  const prog = typeof item.progress === 'number' ? Math.round(item.progress * 100) : null

  return {
    id: item.id,
    title: item.title || 'Untitled',
    image: item.cover || item.image || '',
    label: item.label || (item.chapter ? `Chapter ${item.chapter}` : undefined),
    format: kind === 'manhwa' ? 'MANHWA' : kind === 'novel' ? 'NOVEL' : 'MANGA',
    kind,
    source,
    href: detailsHref,
    resumeHref: rawResume || undefined,
    progress: prog,
    updatedAt: item.t,
  }
}

/**
 * Fetch a public user profile from Supabase by username handle.
 * Queries `public.profiles` first, with graceful fallback to `user_sync`.
 */
export async function fetchPublicProfile(username: string): Promise<PublicUserData | null> {
  const clean = username.trim().toLowerCase().replace(/^@/, '')
  if (!clean) return null

  try {
    // 1. Check public.profiles table
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('*')
      .ilike('username', clean)
      .order('updated_at', { ascending: false })
      .limit(1)
    const profileRow = profileRows?.[0] ?? null

    let userId = profileRow?.id
    let displayName = profileRow?.display_name || profileRow?.username || clean
    let avatarUrl = profileRow?.avatar_url || null
    let bannerUrl = profileRow?.banner_url || null
    let frame = profileRow?.frame || null
    let bio = profileRow?.bio || ''
    let nameStyle: NameStyle | null = profileRow?.name_style ? sanitizeNameStyle(profileRow.name_style) : null
    let createdAt = profileRow?.created_at
    let updatedAt = profileRow?.updated_at

    // 2. Fallback to user_sync if not found in profiles table
    if (!profileRow) {
      const { data: syncRows } = await supabase
        .from('user_sync')
        .select('user_id, username, profile, updated_at')
        .ilike('username', clean)
        .order('updated_at', { ascending: false })
        .limit(1)
      const syncRow = syncRows?.[0] ?? null

      if (!syncRow) return null

      userId = syncRow.user_id
      const p = (syncRow.profile as Profile) || empty
      displayName = p.name || syncRow.username
      avatarUrl = p.avatar || null
      bannerUrl = p.banner || null
      frame = p.frame || null
      bio = p.bio || ''
      nameStyle = p.nameStyle ? sanitizeNameStyle(p.nameStyle) : null
      updatedAt = syncRow.updated_at
    }

    // 3. Query stats & profile fallback from user_sync
    let watchlistCount = 0
    let historyCount = 0
    let readingCount = 0
    let watchlistItems: PublicMediaItem[] = []
    let historyItems: PublicMediaItem[] = []
    let readingItems: PublicMediaItem[] = []

    if (userId) {
      const { data: stats } = await supabase
        .from('user_sync')
        .select('watchlist, history, reading, profile')
        .eq('user_id', userId)
        .maybeSingle()

      if (stats) {
        if (Array.isArray(stats.watchlist)) {
          watchlistCount = stats.watchlist.length
          watchlistItems = stats.watchlist
            .map((item: any): PublicMediaItem | null => {
              if (!item || (!item.id && !item.title)) return null
              return {
                id: item.id,
                title: item.title || 'Untitled',
                image: item.image || item.cover || '',
                score: typeof item.score === 'number' ? item.score : null,
                year: typeof item.year === 'number' ? item.year : null,
                format: item.format || 'TV',
                status: item.status || 'watching',
                episodes: typeof item.episodes === 'number' ? item.episodes : null,
                progress: typeof item.progress === 'number' ? item.progress : null,
                href: item.href || `/anime/${item.id}`,
                kind: 'anime',
                updatedAt: item.updatedAt || item.addedAt,
              }
            })
            .filter((x): x is PublicMediaItem => Boolean(x && x.image))
            .slice(0, 36)
        }

        if (Array.isArray(stats.history)) {
          historyCount = stats.history.length
          historyItems = stats.history
            .map((item: any): PublicMediaItem | null => {
              if (!item || (!item.id && !item.title)) return null
              const dur = Number(item.dur) || 0
              const pos = Number(item.pos) || 0
              const progPercent = dur > 0 && pos > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : null
              return {
                id: item.id,
                title: item.title || 'Untitled',
                image: item.image || item.epImage || item.cover || '',
                score: typeof item.score === 'number' ? item.score : null,
                year: typeof item.year === 'number' ? item.year : null,
                format: item.format || 'TV',
                ep: typeof item.ep === 'number' ? item.ep : 1,
                epTitle: item.epTitle || null,
                bannerImage: item.bannerImage || null,
                href: item.href || `/watch/${item.id}?ep=${item.ep || 1}`,
                kind: 'anime',
                progress: progPercent,
                updatedAt: item.t,
              }
            })
            .filter((x): x is PublicMediaItem => Boolean(x && x.image))
            .slice(0, 36)
        }

        if (Array.isArray(stats.reading)) {
          readingCount = stats.reading.length
          readingItems = stats.reading
            .map(parsePublicReadingItem)
            .filter((x): x is PublicMediaItem => Boolean(x && x.image))
            .slice(0, 36)
        }

        const sp = stats.profile as Profile | null
        if (sp && typeof sp === 'object') {
          if (!displayName || displayName === clean) displayName = sp.name || displayName
          if (!avatarUrl && sp.avatar) avatarUrl = sp.avatar
          if (!bannerUrl && sp.banner) bannerUrl = sp.banner
          if (!frame && sp.frame) frame = sp.frame
          if (!bio && sp.bio) bio = sp.bio
          if (!nameStyle && sp.nameStyle) nameStyle = sanitizeNameStyle(sp.nameStyle)
        }
      }
    }

    return {
      id: userId,
      username: profileRow?.username || clean,
      profile: {
        name: displayName,
        avatar: avatarUrl,
        banner: bannerUrl,
        frame,
        bio,
        nameStyle,
      },
      watchlistCount,
      historyCount,
      readingCount,
      watchlistItems,
      historyItems,
      readingItems,
      createdAt,
      updatedAt,
    }
  } catch (err) {
    console.error('[Profile] fetchPublicProfile error:', err)
    return null
  }
}

/** Crop-to-fill resize of an uploaded image into a compressed data: url, so it fits in localStorage. */
export async function readImage(file: File, w: number, h: number): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.')
  if (file.size > 12 * 1048576) throw new Error('Image is too large (12 MB max).')
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error('Could not read that image.')
  })
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const k = Math.max(w / bmp.width, h / bmp.height)
  const dw = bmp.width * k
  const dh = bmp.height * k
  c.getContext('2d')!.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh)
  bmp.close()
  return c.toDataURL('image/jpeg', 0.85)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushProfileSync()
    }
  })
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    void flushProfileSync()
  })
}
