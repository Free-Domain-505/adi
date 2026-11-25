import { useEffect, useSyncExternalStore } from 'react'
import { sanitizeNameStyle, serializeNameStyle, type NameStyle } from './nameStyle'
import { isSupabaseConfigured, supabase } from './supabase'

type Listener = () => void

const cache = new Map<string, NameStyle | null>()
const attempted = new Set<string>()
const pendingQueue = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

export function subscribeUserNameStyles(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getCachedUserNameStyle(userId: string | null | undefined): NameStyle | null | undefined {
  if (!userId) return undefined
  return cache.get(userId)
}

export function seedUserNameStyle(userId: string | null | undefined, style: unknown) {
  if (!userId) return
  const clean = style ? serializeNameStyle(sanitizeNameStyle(style)) : null
  const prev = cache.get(userId)
  attempted.add(userId)
  if (JSON.stringify(prev ?? null) !== JSON.stringify(clean)) {
    cache.set(userId, clean)
    emit()
  }
}

export async function fetchUserNameStylesBatch(userIds: string[]): Promise<Map<string, NameStyle | null>> {
  const unique = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.trim().length > 0)))
  const result = new Map<string, NameStyle | null>()
  if (unique.length === 0 || !isSupabaseConfigured) return result

  for (const id of unique) {
    attempted.add(id)
  }

  try {
    const batch = unique.slice(0, 50)
    const [{ data: profileRows }, { data: syncRows }] = await Promise.all([
      supabase.from('profiles').select('*').in('id', batch),
      supabase.from('user_sync').select('user_id, profile').in('user_id', batch),
    ])

    const profileMap = new Map<string, NameStyle | null>()
    if (Array.isArray(profileRows)) {
      for (const row of profileRows as any[]) {
        if (!row?.id) continue
        if ('name_style' in row && row.name_style) {
          profileMap.set(row.id, serializeNameStyle(sanitizeNameStyle(row.name_style)))
        } else {
          profileMap.set(row.id, null)
        }
      }
    }

    const syncMap = new Map<string, NameStyle | null>()
    if (Array.isArray(syncRows)) {
      for (const row of syncRows as any[]) {
        if (!row?.user_id) continue
        const sp = row.profile as { nameStyle?: unknown } | null
        if (sp && typeof sp === 'object' && sp.nameStyle) {
          syncMap.set(row.user_id, serializeNameStyle(sanitizeNameStyle(sp.nameStyle)))
        }
      }
    }

    let changed = false
    for (const id of batch) {
      const resolved = profileMap.get(id) ?? syncMap.get(id) ?? null
      result.set(id, resolved)
      if (JSON.stringify(cache.get(id) ?? null) !== JSON.stringify(resolved) || !cache.has(id)) {
        cache.set(id, resolved)
        changed = true
      }
    }

    if (changed) emit()
  } catch {
    // ignore transient lookup failures
  }

  return result
}

export function enqueueUserNameStyleLookup(userId: string | null | undefined) {
  if (!userId || !isSupabaseConfigured) return
  if (attempted.has(userId) || cache.has(userId)) return
  pendingQueue.add(userId)
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null
      const ids = Array.from(pendingQueue)
      pendingQueue.clear()
      if (ids.length > 0) {
        void fetchUserNameStylesBatch(ids)
      }
    }, 30)
  }
}

export function useUserNameStyle(userId: string | null | undefined, disabled = false): NameStyle | null | undefined {
  useEffect(() => {
    if (!disabled && userId) {
      enqueueUserNameStyleLookup(userId)
    }
  }, [userId, disabled])

  return useSyncExternalStore(
    subscribeUserNameStyles,
    () => (disabled || !userId ? undefined : cache.get(userId)),
    () => undefined,
  )
}
