import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, type Context, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { apiUrl } from '../services/api'
import {
  flushProfileSync,
  getProfile,
  mergeRemoteProfile,
  resetProfileStore,
  setActiveProfileUser,
  syncProfileToCloud,
} from '../lib/profile'
import { resetLibrary } from '../lib/library'
import { resetReading } from '../lib/reading'
import { pullWatchHistory, resetSyncMeta } from '../lib/sync'
import { sanitizeNameStyle } from '../lib/nameStyle'
import { toast } from '../lib/toast'

interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  profileHydrated: boolean
  recoveryMode: boolean
  username?: string
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, username?: string) => Promise<{ error: Error | null }>
  updateUsername: (username: string) => Promise<{ error: Error | null }>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>
  clearRecovery: () => void
  signOut: () => Promise<void>
}

const AUTH_CONTEXT_KEY = Symbol.for('animestream.AuthContext')
const globalWithAuthContext = globalThis as typeof globalThis & {
  [AUTH_CONTEXT_KEY]?: Context<AuthContextValue | null>
}
const AuthContext = (globalWithAuthContext[AUTH_CONTEXT_KEY] ??= createContext<AuthContextValue | null>(null))

const LEGACY_KEYS = [
  'zk:auth:session',
  'zk:auth:accounts',
  'zk:history',
  'zk:list',
  'zk:custom_lists',
  'zk:watched_eps',
  'zk:watched_movies',
  'zk:prefs',
  'zk:profile',
  'zk:reading:v1',
  'zk:cloud:last_sync',
  'zk:local_stream_reports',
  'zk_my_sent_msgs',
]

/** Ensure only Supabase's auth session persists in localStorage; remove old local data keys. */
function purgeNonSessionStorage() {
  if (typeof window === 'undefined') return
  try {
    for (const k of LEGACY_KEYS) {
      localStorage.removeItem(k)
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k) continue
      if (k.startsWith('zk:last:') || k.startsWith('zk:username_chosen:')) {
        localStorage.removeItem(k)
      }
    }
  } catch {
    // ignore storage access issues
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileHydrated, setProfileHydrated] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [profileUsername, setProfileUsername] = useState<string | null>(null)

  const inFlightHydrationRef = useRef<{ userId: string; promise: Promise<void> } | null>(null)
  const hydratedUserIdRef = useRef<string | null>(null)

  const syncProfile = useCallback(async (u: User) => {
    const userNameMeta = u.user_metadata?.full_name || u.user_metadata?.name || ''
    const userAvatarMeta = u.user_metadata?.avatar_url || u.user_metadata?.picture || null
    const userBannerMeta = u.user_metadata?.banner_url || u.user_metadata?.banner || null
    const fallbackHandle =
      (u.user_metadata?.username as string) ||
      (u.email ? u.email.split('@')[0] : `user_${u.id.slice(0, 6)}`)
    const cleanHandle = fallbackHandle.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'otaku'

    setActiveProfileUser({ id: u.id, username: cleanHandle })

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', u.id)
        .maybeSingle()

      // Wait: if profiles query errored (network/RLS/abort), DO NOT wipe DB or local store with empty defaults
      if (error) {
        console.warn('[Auth] Failed to read profiles row:', error)
        setProfileUsername((prev) => prev || cleanHandle)
        const cur = getProfile()
        mergeRemoteProfile({
          name: cur.name || userNameMeta || cleanHandle,
          avatar: cur.avatar || userAvatarMeta,
          banner: cur.banner || userBannerMeta || null,
          frame: cur.frame || null,
          bio: cur.bio || '',
        })
        return
      }

      if (data) {
        let assignedHandle = data.username || cleanHandle
        const cur = getProfile()
        const hasNameStyleCol = 'name_style' in data
        const remoteNameStyle = hasNameStyleCol && data.name_style ? sanitizeNameStyle(data.name_style) : null
        const merged = mergeRemoteProfile({
          name: cur.name || data.display_name || userNameMeta || assignedHandle,
          avatar: data.avatar_url || cur.avatar || userAvatarMeta,
          banner: data.banner_url || cur.banner || null,
          frame: data.frame || cur.frame || null,
          bio: (data.bio && String(data.bio).trim() !== '') ? data.bio : (cur.bio || ''),
          nameStyle: remoteNameStyle ?? cur.nameStyle ?? null,
        })

        // Auto-repair: if profile row lacks username or visual fields, backfill them safely
        const missingInProfiles =
          !data.username ||
          (!data.avatar_url && Boolean(merged.avatar)) ||
          (!data.banner_url && Boolean(merged.banner)) ||
          (!data.frame && Boolean(merged.frame)) ||
          (!data.bio && Boolean(merged.bio)) ||
          (!data.display_name && Boolean(merged.name)) ||
          (hasNameStyleCol && !data.name_style && Boolean(merged.nameStyle))

        if (missingInProfiles) {
          const repairRes = await syncProfileToCloud(u.id, assignedHandle, merged, { skipUserSync: true })
          if (!data.username && (!repairRes.profilesOk || repairRes.usernameConflict)) {
            assignedHandle = `${cleanHandle.slice(0, 14)}_${u.id.slice(0, 5)}`
            await syncProfileToCloud(u.id, assignedHandle, merged, { skipUserSync: false })
            void supabase.auth.updateUser({ data: { username: assignedHandle } }).catch(() => {})
          }
        }

        setProfileUsername(assignedHandle)
        setActiveProfileUser({ id: u.id, username: assignedHandle })
      } else {
        // Confirmed row does not exist yet: preserve anything pullWatchHistory loaded from user_sync!
        setProfileUsername(cleanHandle)
        const cur = getProfile()
        const initialProfile = mergeRemoteProfile({
          name: cur.name || userNameMeta || cleanHandle,
          avatar: cur.avatar || userAvatarMeta,
          banner: cur.banner || null,
          frame: cur.frame || null,
          bio: cur.bio || '',
        })

        const res = await syncProfileToCloud(u.id, cleanHandle, initialProfile, { skipUserSync: true })
        if (!res.profilesOk || res.usernameConflict) {
          const fallbackUnique = `${cleanHandle.slice(0, 14)}_${u.id.slice(0, 5)}`
          setProfileUsername(fallbackUnique)
          setActiveProfileUser({ id: u.id, username: fallbackUnique })
          await syncProfileToCloud(u.id, fallbackUnique, initialProfile, { skipUserSync: false })
          void supabase.auth.updateUser({ data: { username: fallbackUnique } }).catch(() => {})
        }
      }
    } catch {
      setProfileUsername((prev) => prev || cleanHandle)
      const cur = getProfile()
      mergeRemoteProfile({
        name: cur.name || userNameMeta || cleanHandle,
        avatar: cur.avatar || userAvatarMeta,
        banner: cur.banner || userBannerMeta || null,
        frame: cur.frame || null,
        bio: cur.bio || '',
      })
    }
  }, [])

  const hydrateUserState = useCallback(
    async (u: User) => {
      if (inFlightHydrationRef.current?.userId === u.id) {
        return inFlightHydrationRef.current.promise
      }

      const promise = (async () => {
        try {
          // Pull user_sync first, then reconcile with public.profiles so neither overwrites the other with nulls
          await pullWatchHistory(u.id)
          await syncProfile(u)
          hydratedUserIdRef.current = u.id
        } finally {
          setProfileHydrated(true)
          if (inFlightHydrationRef.current?.userId === u.id) {
            inFlightHydrationRef.current = null
          }
        }
      })()

      inFlightHydrationRef.current = { userId: u.id, promise }
      return promise
    },
    [syncProfile],
  )

  useEffect(() => {
    purgeNonSessionStorage()

    if (!isSupabaseConfigured) {
      setSession(null)
      setUser(null)
      setLoading(false)
      return
    }

    let alive = true

    const init = async () => {
      try {
        if (
          typeof window !== 'undefined' &&
          window.location.pathname !== '/auth/anilist' &&
          window.location.hash.includes('access_token=')
        ) {
          const hashParams = new URLSearchParams(window.location.hash.slice(1))
          const access_token = hashParams.get('access_token')
          const refresh_token = hashParams.get('refresh_token')
          const type = hashParams.get('type')
          if (access_token && refresh_token) {
            const { data: recData } = await supabase.auth.setSession({ access_token, refresh_token })
            window.history.replaceState(null, '', window.location.pathname + window.location.search)
            if (type === 'recovery' && recData.session?.user && alive) {
              setRecoveryMode(true)
            }
          }
        }

        const {
          data: { session: s },
          error,
        } = await supabase.auth.getSession()
        if (!alive) return
        if (error) {
          if (error.message?.includes('Refresh Token') || (error as any).status === 400) {
            void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
          }
        } else if (s?.user) {
          setSession(s)
          setUser(s.user)
          setActiveProfileUser({
            id: s.user.id,
            username: (s.user.user_metadata?.username as string | undefined) || undefined,
          })
          await Promise.race([
            hydrateUserState(s.user),
            new Promise<void>((r) => setTimeout(r, 4000)),
          ])
        }
      } catch {
        // ignore startup session error
      } finally {
        if (alive) setLoading(false)
      }
    }

    void init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (s?.user) {
        setSession(s)
        setUser(s.user)
        setActiveProfileUser({
          id: s.user.id,
          username: (s.user.user_metadata?.username as string | undefined) || undefined,
        })
        const needsHydration = hydratedUserIdRef.current !== s.user.id
        if (event === 'SIGNED_IN' || (event === 'USER_UPDATED' && needsHydration)) {
          void hydrateUserState(s.user)
        }
        setLoading(false)
        return
      }
      hydratedUserIdRef.current = null
      inFlightHydrationRef.current = null
      setSession(null)
      setUser(null)
      setProfileHydrated(false)
      setProfileUsername(null)
      resetProfileStore()
      resetLibrary()
      resetReading()
      resetSyncMeta()
      setLoading(false)
    })

    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [hydrateUserState])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const cleanEmail = email.trim().toLowerCase()
      try {
        if (!isSupabaseConfigured) {
          throw new Error('Supabase is not connected yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.')
        }
        if (!cleanEmail || !password) {
          throw new Error('Please enter both your email and password.')
        }

        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        })
        if (error) {
          if (/invalid login credentials/i.test(error.message)) {
            throw new Error(
              'Invalid email or password. Double-check your password, or use "Forgot password?" if you need to reset it.',
            )
          }
          if (/email not confirmed/i.test(error.message)) {
            throw new Error('This account has not confirmed its email in Supabase yet. Turn off "Confirm email" in Supabase Auth settings.')
          }
          throw error
        }

        setProfileHydrated(false)
        setSession(data.session)
        setUser(data.user)
        if (data.user) {
          await hydrateUserState(data.user)
        }
        toast('Signed in successfully!')
        return { error: null }
      } catch (err: any) {
        const msg = err?.message || 'Failed to sign in'
        toast(msg, 'error')
        return { error: err instanceof Error ? err : new Error(msg) }
      }
    },
    [hydrateUserState],
  )

  const signUp = useCallback(
    async (email: string, password: string, username?: string) => {
      const cleanEmail = email.trim().toLowerCase()
      const cleanUser = (username || cleanEmail.split('@')[0] || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')

      try {
        if (!isSupabaseConfigured) {
          throw new Error('Supabase is not connected yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.')
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          throw new Error('Please enter a valid email address.')
        }
        if (cleanUser.length < 3) {
          throw new Error('Username must be at least 3 characters.')
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.')
        }

        // Verify username is not already taken in Supabase (profiles or user_sync)
        const [{ data: existingProfile }, { data: existingSync }] = await Promise.all([
          supabase.from('profiles').select('id').ilike('username', cleanUser).limit(1),
          supabase.from('user_sync').select('user_id').ilike('username', cleanUser).limit(1),
        ])

        if ((existingProfile && existingProfile.length > 0) || (existingSync && existingSync.length > 0)) {
          throw new Error(`Username @${cleanUser} is already taken. Please choose another one.`)
        }

        // 1. If SUPABASE_SERVICE_ROLE_KEY is set on the server, create an instant confirmed user cleanly
        let usedAdmin = false
        try {
          const res = await fetch(apiUrl('/api/auth/register'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cleanEmail, password, username: cleanUser }),
          })
          const payload = (await res.json().catch(() => null)) as {
            ok?: boolean
            adminUnavailable?: boolean
            error?: string
          } | null

          if (payload && !payload.adminUnavailable) {
            if (!res.ok || payload.error) {
              throw new Error(payload.error || 'Could not create account.')
            }
            usedAdmin = true
          }
        } catch (err: any) {
          if (
            err?.message &&
            !/failed to fetch|networkerror|load failed|unexpected token/i.test(err.message)
          ) {
            throw err
          }
        }

        let activeSession: Session | null = null
        let activeUser: User | null = null

        if (usedAdmin) {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          })
          if (error) throw error
          activeSession = data.session
          activeUser = data.user
        } else {
          // 2. Standard client signup directly in your Supabase project
          const { data, error } = await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              data: {
                username: cleanUser,
                full_name: cleanUser,
                username_chosen: true,
              },
            },
          })
          if (error) {
            if (/already registered|already exists/i.test(error.message)) {
              throw new Error('An account with this email already exists. Please sign in.')
            }
            throw error
          }
          if (!data.session || !data.user) {
            throw new Error(
              'Email confirmation is enabled in your Supabase dashboard. Open Supabase -> Authentication -> Providers -> Email and turn OFF "Confirm email" for instant signup.',
            )
          }
          activeSession = data.session
          activeUser = data.user
        }

        if (activeUser && activeSession) {
          setActiveProfileUser({ id: activeUser.id, username: cleanUser })
          const { error: pUpsertErr } = await supabase.from('profiles').upsert(
            {
              id: activeUser.id,
              username: cleanUser,
              display_name: cleanUser,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' },
          )
          if (pUpsertErr) console.warn('[Auth] signUp profiles upsert error:', pUpsertErr)
          const { error: sUpsertErr } = await supabase.from('user_sync').upsert(
            {
              user_id: activeUser.id,
              username: cleanUser,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' },
          )
          if (sUpsertErr) console.warn('[Auth] signUp user_sync upsert error:', sUpsertErr)
          hydratedUserIdRef.current = null
          setProfileHydrated(false)
          setSession(activeSession)
          setUser(activeUser)
          await hydrateUserState(activeUser)
        }

        toast(`Welcome to AnimeStream, @${cleanUser}!`)
        return { error: null }
      } catch (err: any) {
        const msg = err?.message || 'Failed to create account'
        toast(msg, 'error')
        return { error: err instanceof Error ? err : new Error(msg) }
      }
    },
    [hydrateUserState],
  )

  const updateUsername = useCallback(
    async (newUsername: string) => {
      try {
        if (!isSupabaseConfigured) {
          throw new Error('Supabase is not connected yet.')
        }
        const u = newUsername.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
        if (u.length < 3 || u.length > 20) {
          throw new Error('Username must be between 3 and 20 characters')
        }

        const activeUser = user || (await supabase.auth.getUser()).data.user
        if (!activeUser?.id) {
          throw new Error('Please sign in to update your username')
        }

        const activeSession = session || (await supabase.auth.getSession()).data.session

        // 1. Prefer atomic server-side check & update (checks both profiles + user_sync regardless of RLS)
        let handledByServer = false
        if (activeSession?.access_token) {
          try {
            const res = await fetch(apiUrl('/api/auth/update-username'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${activeSession.access_token}`,
              },
              body: JSON.stringify({ username: u }),
            })
            const payload = (await res.json().catch(() => null)) as {
              ok?: boolean
              adminUnavailable?: boolean
              error?: string
            } | null

            if (res.status === 409) {
              throw new Error(payload?.error || `Username @${u} is already taken. Please choose another username.`)
            }
            if (res.ok && payload?.ok) {
              handledByServer = true
            } else if (payload && !payload.adminUnavailable && payload.error && res.status >= 400) {
              throw new Error(payload.error)
            }
          } catch (srvErr: any) {
            if (
              srvErr?.message &&
              !/failed to fetch|networkerror|load failed|unexpected token/i.test(srvErr.message)
            ) {
              throw srvErr
            }
          }
        }

        // 2. Client-side uniqueness check & DB-first upsert (when server admin key is unavailable)
        if (!handledByServer) {
          const [{ data: takenProfile }, { data: takenSync }] = await Promise.all([
            supabase.from('profiles').select('id').ilike('username', u).neq('id', activeUser.id).limit(1),
            supabase.from('user_sync').select('user_id').ilike('username', u).neq('user_id', activeUser.id).limit(1),
          ])
          if ((takenProfile && takenProfile.length > 0) || (takenSync && takenSync.length > 0)) {
            throw new Error(`Username @${u} is already taken. Please choose another username.`)
          }

          const nowIso = new Date().toISOString()
          const { error: profileErr } = await supabase
            .from('profiles')
            .upsert({ id: activeUser.id, username: u, updated_at: nowIso }, { onConflict: 'id' })
          if (profileErr) {
            const msg = String(profileErr.message || '')
            if (profileErr.code === '23505' || /duplicate|unique/i.test(msg)) {
              throw new Error(`Username @${u} is already taken. Please choose another username.`)
            }
            throw new Error(msg || 'Failed to update username')
          }

          const { error: syncErr } = await supabase
            .from('user_sync')
            .upsert({ user_id: activeUser.id, username: u, updated_at: nowIso }, { onConflict: 'user_id' })
          if (syncErr) {
            const msg = String(syncErr.message || '')
            if (syncErr.code === '23505' || /duplicate|unique/i.test(msg)) {
              throw new Error(`Username @${u} is already taken. Please choose another username.`)
            }
          }
        }

        // 3. Keep client auth session/user_metadata and local state in sync
        const { data, error } = await supabase.auth.updateUser({
          data: { username: u, username_chosen: true },
        })
        if (error && !handledByServer) {
          throw error
        }
        if (data?.user) {
          setUser(data.user)
        }
        setProfileUsername(u)
        setActiveProfileUser({ id: activeUser.id, username: u })

        toast(`Username updated to @${u}!`)
        return { error: null }
      } catch (err: any) {
        const msg = err?.message || 'Failed to update username'
        toast(msg, 'error')
        return { error: err instanceof Error ? err : new Error(msg) }
      }
    },
    [user, session],
  )

  const resetPassword = useCallback(async (email: string) => {
    const cleanEmail = email.trim().toLowerCase()
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase is not connected yet.')
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw new Error('Please enter a valid email address.')
      }
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/auth/callback`,
      })
      if (error) throw error
      toast(`Password reset link sent to ${cleanEmail}!`)
      return { error: null }
    } catch (err: any) {
      const msg = err?.message || 'Could not send reset email'
      toast(msg, 'error')
      return { error: err instanceof Error ? err : new Error(msg) }
    }
  }, [])

  const updatePassword = useCallback(async (newPassword: string) => {
    try {
      if (newPassword.length < 6) {
        throw new Error('Password must be at least 6 characters.')
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setRecoveryMode(false)
      toast('Password updated successfully!')
      return { error: null }
    } catch (err: any) {
      const msg = err?.message || 'Failed to update password'
      toast(msg, 'error')
      return { error: err instanceof Error ? err : new Error(msg) }
    }
  }, [])

  const clearRecovery = useCallback(() => setRecoveryMode(false), [])

  const signOut = useCallback(async () => {
    try {
      await flushProfileSync().catch(() => {})
      await supabase.auth.signOut().catch(() => {})
      hydratedUserIdRef.current = null
      inFlightHydrationRef.current = null
      resetProfileStore()
      resetLibrary()
      resetReading()
      resetSyncMeta()
      purgeNonSessionStorage()
      setSession(null)
      setUser(null)
      setProfileHydrated(false)
      setRecoveryMode(false)
      setProfileUsername(null)
      toast('Signed out')
    } catch (err: any) {
      toast(err?.message || 'Error signing out', 'error')
    }
  }, [])

  const username =
    profileUsername ||
    (user?.user_metadata?.username as string | undefined) ||
    (user?.email ? user.email.split('@')[0] : undefined)

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      profileHydrated,
      recoveryMode,
      username,
      signIn,
      signUp,
      updateUsername,
      resetPassword,
      updatePassword,
      clearRecovery,
      signOut,
    }),
    [
      user,
      session,
      loading,
      profileHydrated,
      recoveryMode,
      username,
      signIn,
      signUp,
      updateUsername,
      resetPassword,
      updatePassword,
      clearRecovery,
      signOut,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
