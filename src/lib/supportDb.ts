import { mergeCachedSyncExt } from './profile'
import { isSupabaseConfigured, supabase } from './supabase'

export interface SupporterDbStats {
  completedCount: number
  totalLinksSolved: number
  totalXp: number
  lastCompletedAt?: number
}

export interface SupporterDbActiveMission {
  missionId: string
  totalSteps: number
  completedSteps: number
  currentStep: number
  stepSessions: {
    [step: number]: {
      sessionId: string
      url?: string
      verifiedAt?: number
    }
  }
  updatedAt: number
}

export interface SupporterData {
  stats: SupporterDbStats
  activeMission: SupporterDbActiveMission | null
  claimedTokens: string[]
}

export const EMPTY_SUPPORTER_DATA: SupporterData = {
  stats: { completedCount: 0, totalLinksSolved: 0, totalXp: 0 },
  activeMission: null,
  claimedTokens: [],
}

/** In-memory snapshot per user for instant switching without browser storage persistence. */
const memoryByUser = new Map<string, SupporterData>()

/** Clear any old legacy browser-stored support keys so data lives only in the database. */
export function cleanupLegacySupportBrowserStorage() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem('zk_support_stats')
    localStorage.removeItem('zk_support_stats_v2')
    localStorage.removeItem('zk_active_mission_progress_v2')
    localStorage.removeItem('zk_claimed_tokens_v2')
    localStorage.removeItem('zk_supporter_device_id')
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && (k.startsWith('zk_claim_') || k.startsWith('zk_processed_session_'))) {
        localStorage.removeItem(k)
      }
    }
  } catch {}
}

export function getInMemorySupporterData(userId?: string | null): SupporterData {
  if (!userId) return EMPTY_SUPPORTER_DATA
  return memoryByUser.get(userId) ?? EMPTY_SUPPORTER_DATA
}

function normalizeSupportPayload(raw: unknown): SupporterData {
  if (!raw || typeof raw !== 'object') return EMPTY_SUPPORTER_DATA
  const obj = raw as Record<string, unknown>
  const rawStats = (obj.stats && typeof obj.stats === 'object' ? obj.stats : {}) as Record<string, unknown>
  const stats: SupporterDbStats = {
    completedCount: Math.max(0, Number(rawStats.completedCount) || 0),
    totalLinksSolved: Math.max(0, Number(rawStats.totalLinksSolved) || 0),
    totalXp: Math.max(0, Number(rawStats.totalXp) || 0),
    lastCompletedAt: rawStats.lastCompletedAt ? Number(rawStats.lastCompletedAt) : undefined,
  }
  const activeRaw = obj.activeMission as SupporterDbActiveMission | null | undefined
  const activeMission =
    activeRaw &&
    typeof activeRaw === 'object' &&
    typeof activeRaw.missionId === 'string' &&
    Number(activeRaw.totalSteps) > 0
      ? activeRaw
      : null
  const claimedTokens = Array.isArray(obj.claimedTokens)
    ? obj.claimedTokens.filter((t): t is string => typeof t === 'string').slice(-120)
    : []

  return { stats, activeMission, claimedTokens }
}

/**
 * Loads supporter progress & stats directly from Supabase database (`supporter_records` + `user_sync`).
 * No browser localStorage / sessionStorage is used to store support state.
 */
export async function loadSupporterDataFromDb(userId?: string | null): Promise<{
  data: SupporterData
  fromDatabase: boolean
}> {
  cleanupLegacySupportBrowserStorage()

  if (!userId || !isSupabaseConfigured) {
    return { data: getInMemorySupporterData(userId), fromDatabase: false }
  }

  let recData: SupporterData | null = null
  let syncData: SupporterData | null = null
  let readSucceeded = false

  // 1. Read from dedicated supporter_records table if available
  try {
    const { data: rec, error: recErr } = await supabase
      .from('supporter_records')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (!recErr) {
      readSucceeded = true
      if (rec) {
        recData = {
          stats: {
            completedCount: Math.max(0, Number(rec.completed_count) || 0),
            totalLinksSolved: Math.max(0, Number(rec.total_links_solved) || 0),
            totalXp: Math.max(0, Number(rec.total_xp) || 0),
            lastCompletedAt: rec.last_completed_at ? new Date(rec.last_completed_at).getTime() : undefined,
          },
          activeMission: (rec.active_mission as SupporterDbActiveMission | null) ?? null,
          claimedTokens: Array.isArray(rec.claimed_tokens)
            ? rec.claimed_tokens.filter((t: unknown): t is string => typeof t === 'string').slice(-120)
            : [],
        }
      }
    }
  } catch {}

  // 2. Read from user_sync table (always present in Supabase schema)
  try {
    const { data: syncRow, error: syncErr } = await supabase
      .from('user_sync')
      .select('profile, prefs')
      .eq('user_id', userId)
      .maybeSingle()

    if (!syncErr) {
      readSucceeded = true
      if (syncRow) {
        const profileExt = (syncRow.profile as Record<string, unknown> | null)?.__ext as
          | Record<string, unknown>
          | undefined
        const prefsObj = (syncRow.prefs as Record<string, unknown> | null) || undefined
        const rawSupport = profileExt?.support ?? prefsObj?.support
        if (rawSupport) {
          syncData = normalizeSupportPayload(rawSupport)
        }
      }
    }
  } catch {}

  if (!recData && !syncData) {
    const fallback = getInMemorySupporterData(userId)
    return { data: fallback, fromDatabase: readSucceeded }
  }

  // Merge both sources choosing freshest/highest stats
  const a = recData ?? EMPTY_SUPPORTER_DATA
  const b = syncData ?? EMPTY_SUPPORTER_DATA
  const activeCandidate =
    a.activeMission && b.activeMission
      ? (a.activeMission.updatedAt || 0) >= (b.activeMission.updatedAt || 0)
        ? a.activeMission
        : b.activeMission
      : a.activeMission || b.activeMission

  const merged: SupporterData = {
    stats: {
      completedCount: Math.max(a.stats.completedCount, b.stats.completedCount),
      totalLinksSolved: Math.max(a.stats.totalLinksSolved, b.stats.totalLinksSolved),
      totalXp: Math.max(a.stats.totalXp, b.stats.totalXp),
      lastCompletedAt: Math.max(a.stats.lastCompletedAt || 0, b.stats.lastCompletedAt || 0) || undefined,
    },
    activeMission: activeCandidate,
    claimedTokens: Array.from(new Set([...a.claimedTokens, ...b.claimedTokens])).slice(-120),
  }

  memoryByUser.set(userId, merged)
  mergeCachedSyncExt({ support: merged })
  return { data: merged, fromDatabase: readSucceeded }
}

/**
 * Saves supporter stats, active multi-step mission progress, and claimed verification tokens
 * directly to Supabase database (`supporter_records` + `user_sync`).
 */
export async function saveSupporterDataToDb(
  userId: string | null | undefined,
  data: SupporterData,
): Promise<boolean> {
  const clean = normalizeSupportPayload(data)

  if (!userId) return false
  memoryByUser.set(userId, clean)
  mergeCachedSyncExt({ support: clean })

  if (!isSupabaseConfigured) return false

  const nowIso = new Date().toISOString()
  let saved = false

  // 1. Write to dedicated supporter_records table
  try {
    const { error: recErr } = await supabase.from('supporter_records').upsert(
      {
        user_id: userId,
        completed_count: clean.stats.completedCount,
        total_links_solved: clean.stats.totalLinksSolved,
        total_xp: clean.stats.totalXp,
        active_mission: clean.activeMission,
        claimed_tokens: clean.claimedTokens,
        last_completed_at: clean.stats.lastCompletedAt
          ? new Date(clean.stats.lastCompletedAt).toISOString()
          : null,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' },
    )
    if (!recErr) saved = true
  } catch {}

  // 2. Always mirror cleanly into user_sync.profile.__ext.support & prefs.support
  try {
    const { data: currentSync } = await supabase
      .from('user_sync')
      .select('profile, prefs')
      .eq('user_id', userId)
      .maybeSingle()

    const currentProfile =
      currentSync?.profile && typeof currentSync.profile === 'object'
        ? (currentSync.profile as Record<string, unknown>)
        : {}
    const currentExt =
      currentProfile.__ext && typeof currentProfile.__ext === 'object'
        ? (currentProfile.__ext as Record<string, unknown>)
        : {}
    const currentPrefs =
      currentSync?.prefs && typeof currentSync.prefs === 'object'
        ? (currentSync.prefs as Record<string, unknown>)
        : {}

    const { error: syncErr } = await supabase.from('user_sync').upsert(
      {
        user_id: userId,
        profile: {
          ...currentProfile,
          __ext: {
            ...currentExt,
            support: clean,
          },
        },
        prefs: {
          ...currentPrefs,
          support: clean,
        },
        updated_at: nowIso,
      },
      { onConflict: 'user_id' },
    )
    if (!syncErr) saved = true
  } catch {}

  if (saved) {
    try {
      window.dispatchEvent(new CustomEvent('zk_mission_sync'))
    } catch {}
  }

  return saved
}
