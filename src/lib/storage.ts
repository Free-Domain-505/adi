import { useSyncExternalStore } from 'react';
import type {
  DailyUsage,
  HistoryEntry,
  PaymentRequest,
  SubscriptionPlan,
  UserSubscription,
  WatchStatus,
  WatchlistEntry,
} from '../types';
import {
  getAccessToken,
  sanitizeDocId,
  signOutUser,
  supabase,
  verifyActiveSupabaseUser,
  type SupabaseUser,
} from './supabase';

const WATCHLIST_KEY = 'aadhi:watchlist:v1';
const HISTORY_KEY = 'aadhi:history:v1';
const THEME_KEY = 'aadhi-theme';
const AUDIO_KEY = 'aadhi:lang:v2';
const SUBSCRIPTION_KEY = 'aadhi:sub:v1';
const USAGE_KEY = 'aadhi:usage:v1';
const SEEN_VIP_KEY = 'aadhi:seenVip:v1';
const SEEN_EXTRA_KEY = 'aadhi:seenExtra:v1';
const ADMIN_PASS_SESSION_KEY = 'aadhi:adminPass:v1';
const BLOCKED_LOCAL_PREFIX = 'aadhi:blocked:v1:';

export const DAILY_FREE_LIMIT = 5;
export const MONTHLY_PRICE_INR = 25;
export const EXTRA_EPISODE_PRICE_INR = 2;
export const SUBSCRIPTION_DAYS = 30;
export const OWNER_PHONE_RAW = '8580648415';
export const OWNER_PHONE_INTL = '918580648415';
export const OWNER_ADMIN_EMAIL = 'addii0987654@gmail.com';
export const VIP_FREE_EMAILS = new Set<string>([
  OWNER_ADMIN_EMAIL.toLowerCase(),
  'notxanlos@gmail.com',
]);

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

function mapSupabaseUser(u: SupabaseUser | null): AppUser | null {
  if (!u) return null;
  const meta = (u.user_metadata || {}) as Record<string, unknown>;
  const name =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    (u.email ? u.email.split('@')[0] : 'Member');
  const avatar = typeof meta.avatar_url === 'string' ? meta.avatar_url : null;
  return {
    uid: u.id,
    email: u.email || null,
    displayName: name,
    photoURL: avatar,
    emailVerified: Boolean(u.email_confirmed_at || u.confirmed_at || true),
  };
}

export function isVipFreeAccount(user: AppUser | null | undefined): boolean {
  return Boolean(user?.email && VIP_FREE_EMAILS.has(user.email.toLowerCase()));
}

export function isOwnerAdmin(user: AppUser | null | undefined): boolean {
  return Boolean(
    user &&
      user.emailVerified !== false &&
      user.email?.toLowerCase() === OWNER_ADMIN_EMAIL.toLowerCase()
  );
}

export function getAdminPassToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_PASS_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

export function setAdminPassToken(token: string) {
  try {
    sessionStorage.setItem(ADMIN_PASS_SESSION_KEY, token);
  } catch {
    // Ignore storage error
  }
}

export function clearAdminPassToken() {
  try {
    sessionStorage.removeItem(ADMIN_PASS_SESSION_KEY);
  } catch {
    // Ignore storage error
  }
}

export async function verifyAdminPassword(password: string): Promise<string> {
  const user = authCache.user;
  const token = await getAccessToken();
  if (!isOwnerAdmin(user) || !user || !token) {
    throw new Error('Owner account sign-in required.');
  }
  const res = await fetch('/api/admin/verify-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.adminPassToken) {
    throw new Error(json?.error || 'Incorrect admin password.');
  }
  const passToken = String(json.adminPassToken);
  setAdminPassToken(passToken);
  return passToken;
}

export async function checkAdminPassSession(): Promise<boolean> {
  const user = authCache.user;
  const passToken = getAdminPassToken();
  const token = await getAccessToken();
  if (!isOwnerAdmin(user) || !user || !passToken || !token) return false;
  try {
    const res = await fetch('/api/admin/verify-session', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-admin-pass': passToken,
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!json?.valid) {
      clearAdminPassToken();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getTodayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getTimeUntilMidnightText(): string {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const diffMs = Math.max(0, nextMidnight.getTime() - now.getTime());
  const totalMin = Math.ceil(diffMs / 60000);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h`;
  return `${mins}m`;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
  emit();
}

function readInitialUsage(): DailyUsage {
  const today = getTodayKey();
  const stored = readJson<DailyUsage | null>(USAGE_KEY, null);
  if (stored && stored.dateKey === today && Array.isArray(stored.watchedKeys)) {
    return {
      dateKey: today,
      watchedKeys: stored.watchedKeys.slice(0, 50),
      updatedAt: stored.updatedAt || Date.now(),
    };
  }
  return { dateKey: today, watchedKeys: [], updatedAt: Date.now() };
}

function isSubActive(sub: UserSubscription | null): boolean {
  if (isVipFreeAccount(authCache?.user)) return true;
  return Boolean(
    sub &&
      sub.plan === 'monthly_25' &&
      sub.status === 'active' &&
      sub.expiresAtMs > Date.now()
  );
}

export interface SubscriptionSnapshot {
  subscription: UserSubscription | null;
  isSubscribed: boolean;
  isPending: boolean;
  isPendingExtra: boolean;
  isRejected: boolean;
  daysRemaining: number;
  expiresAtMs: number | null;
  extraCredits: number;
}

function buildSubSnapshot(sub: UserSubscription | null): SubscriptionSnapshot {
  const vipFree = isVipFreeAccount(authCache?.user);
  const active = vipFree || isSubActive(sub);
  const daysRemaining = vipFree
    ? 3650
    : active && sub
      ? Math.max(1, Math.ceil((sub.expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000)))
      : 0;
  return {
    subscription: sub,
    isSubscribed: active,
    isPending: !vipFree && sub?.status === 'pending',
    isPendingExtra: !vipFree && sub?.status === 'pending' && sub?.plan === 'extra_2',
    isRejected: !vipFree && sub?.status === 'rejected',
    daysRemaining,
    expiresAtMs: vipFree
      ? Date.now() + 3650 * 86400000
      : active && sub && sub.expiresAtMs > 0
        ? sub.expiresAtMs
        : null,
    extraCredits: vipFree ? 999 : Math.max(0, Number(sub?.extraCredits || 0)),
  };
}

export interface AuthState {
  user: AppUser | null;
  authReady: boolean;
}

let authCache: AuthState = { user: null, authReady: false };

let watchlistCache: WatchlistEntry[] = readJson<WatchlistEntry[]>(WATCHLIST_KEY, []);
let historyCache: HistoryEntry[] = readJson<HistoryEntry[]>(HISTORY_KEY, []);
let subscriptionCache: UserSubscription | null = readJson<UserSubscription | null>(SUBSCRIPTION_KEY, null);
let subSnapshotCache: SubscriptionSnapshot = buildSubSnapshot(subscriptionCache);
let usageCache: DailyUsage = readInitialUsage();

export interface VipCelebrationState {
  open: boolean;
  subscription: UserSubscription | null;
}

let vipCelebrationCache: VipCelebrationState = { open: false, subscription: null };

export interface ExtraCelebrationState {
  open: boolean;
  extraCredits: number;
  adminNote?: string;
}

let extraCelebrationCache: ExtraCelebrationState = { open: false, extraCredits: 0 };

function checkVipCelebration(sub: UserSubscription | null) {
  if (isVipFreeAccount(authCache.user)) return;
  if (!isSubActive(sub) || !sub || sub.startedAtMs <= 0) {
    if (vipCelebrationCache.open) {
      vipCelebrationCache = { open: false, subscription: null };
    }
  } else {
    try {
      const seen = localStorage.getItem(SEEN_VIP_KEY);
      if (seen !== String(sub.startedAtMs)) {
        vipCelebrationCache = { open: true, subscription: sub };
      }
    } catch {
      vipCelebrationCache = { open: true, subscription: sub };
    }
  }

  const extraCredits = Math.max(0, Number(sub?.extraCredits || 0));
  const extraApprovedAtMs = Number(sub?.extraApprovedAtMs || 0);
  if (extraCredits > 0 && extraApprovedAtMs > 0 && !isSubActive(sub)) {
    try {
      const seenExtra = localStorage.getItem(SEEN_EXTRA_KEY);
      if (seenExtra !== String(extraApprovedAtMs)) {
        extraCelebrationCache = {
          open: true,
          extraCredits,
          adminNote: sub?.adminNote,
        };
      }
    } catch {
      extraCelebrationCache = {
        open: true,
        extraCredits,
        adminNote: sub?.adminNote,
      };
    }
  } else if (extraCredits <= 0 && extraCelebrationCache.open) {
    extraCelebrationCache = { open: false, extraCredits: 0 };
  }
}

export function dismissVipCelebration() {
  const sub = vipCelebrationCache.subscription || subscriptionCache;
  if (sub && sub.startedAtMs > 0) {
    try {
      localStorage.setItem(SEEN_VIP_KEY, String(sub.startedAtMs));
    } catch {
      // Ignore storage error
    }
  }
  vipCelebrationCache = { open: false, subscription: null };
  emit();
}

export function dismissExtraCelebration() {
  const sub = subscriptionCache;
  if (sub && sub.extraApprovedAtMs && sub.extraApprovedAtMs > 0) {
    try {
      localStorage.setItem(SEEN_EXTRA_KEY, String(sub.extraApprovedAtMs));
    } catch {
      // Ignore storage error
    }
  }
  extraCelebrationCache = { open: false, extraCredits: 0 };
  emit();
}

export interface BlockedState {
  blocked: boolean;
  reason: string;
}

let blockedCache: BlockedState = { blocked: false, reason: '' };

function readBlockedFallback(uid: string): BlockedState {
  try {
    const raw = localStorage.getItem(`${BLOCKED_LOCAL_PREFIX}${uid}`);
    if (!raw) return { blocked: false, reason: '' };
    const parsed = JSON.parse(raw);
    return {
      blocked: Boolean(parsed?.blocked),
      reason: String(parsed?.reason || ''),
    };
  } catch {
    return { blocked: false, reason: '' };
  }
}

function writeBlockedFallback(uid: string, blocked: boolean, reason: string) {
  try {
    if (blocked) {
      localStorage.setItem(`${BLOCKED_LOCAL_PREFIX}${uid}`, JSON.stringify({ blocked: true, reason }));
    } else {
      localStorage.removeItem(`${BLOCKED_LOCAL_PREFIX}${uid}`);
    }
  } catch {
    // Ignore storage error
  }
}

function readInitialTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore storage access errors
  }
  return 'dark';
}

function readInitialAudio(): 'hindi' | 'english' {
  try {
    const saved = localStorage.getItem(AUDIO_KEY);
    if (saved === 'english' || saved === 'hindi') return saved;
  } catch {
    // Ignore storage access errors
  }
  return 'hindi';
}

let themeCache: 'dark' | 'light' = readInitialTheme();
let audioCache: 'hindi' | 'english' = readInitialAudio();

export interface SubModalState {
  open: boolean;
  reason: 'crown' | 'limit' | 'reminder';
  selectedPlan: SubscriptionPlan;
}

let subModalCache: SubModalState = {
  open: false,
  reason: 'crown',
  selectedPlan: 'monthly_25',
};

function applyThemeToDom(theme: 'dark' | 'light') {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

applyThemeToDom(themeCache);

// Debounced cloud metadata sync via Supabase Auth user_metadata
let syncTimer: number | null = null;
function scheduleUserMetadataSync() {
  if (!authCache.user) return;
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(async () => {
    try {
      await supabase.auth.updateUser({
        data: {
          aadhi_watchlist: watchlistCache.slice(0, 80),
          aadhi_history: historyCache.slice(0, 60),
          aadhi_usage: usageCache,
        },
      });
    } catch {
      // Ignore silent cloud sync error
    }
  }, 1500);
}

let forceLogoutInFlight = false;
async function forceImmediateLogout() {
  if (forceLogoutInFlight) return;
  forceLogoutInFlight = true;
  try {
    await signOutUser();
  } finally {
    handleUserSignedOut();
    forceLogoutInFlight = false;
  }
}

async function verifyDatabaseAccountAlive(): Promise<boolean> {
  if (!authCache.user) return false;
  const status = await verifyActiveSupabaseUser();
  if (status === 'revoked') {
    await forceImmediateLogout();
    return false;
  }
  return true;
}

async function syncServerSubscriptionStatus() {
  const user = authCache.user;
  if (!user) return;

  const alive = await verifyDatabaseAccountAlive();
  if (!alive) return;

  if (isVipFreeAccount(user)) {
    const now = Date.now();
    const vipSub: UserSubscription = {
      plan: 'monthly_25',
      amountInr: 25,
      status: 'active',
      referenceNumber: 'VIP-PASS',
      startedAtMs: now - 86400000,
      expiresAtMs: now + 3650 * 86400000,
      extraCredits: 999,
      adminNote: 'Permanent VIP Access',
      updatedAt: now,
    };
    subscriptionCache = vipSub;
    subSnapshotCache = buildSubSnapshot(vipSub);
    blockedCache = { blocked: false, reason: '' };
    emit();
    return;
  }

  try {
    const token = await getAccessToken();
    if (!token) {
      await forceImmediateLogout();
      return;
    }
    const res = await fetch('/api/payments/my-status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      await forceImmediateLogout();
      return;
    }
    if (!res.ok) return;
    const json = await res.json();
    if (json?.blocked) {
      blockedCache = {
        blocked: true,
        reason: String(json.blockedReason || 'Your account was suspended after payment review.'),
      };
      writeBlockedFallback(user.uid, true, blockedCache.reason);
    } else {
      blockedCache = { blocked: false, reason: '' };
      writeBlockedFallback(user.uid, false, '');
    }

    if (json?.subscription) {
      subscriptionCache = json.subscription as UserSubscription;
      writeJson(SUBSCRIPTION_KEY, subscriptionCache);
    } else {
      subscriptionCache = null;
      localStorage.removeItem(SUBSCRIPTION_KEY);
    }
    subSnapshotCache = buildSubSnapshot(subscriptionCache);
    checkVipCelebration(subscriptionCache);
    emit();
  } catch {
    // Ignore transient network errors
  }
}

let statusPollTimer: number | null = null;
let authVerifyTimer: number | null = null;
let focusListenersBound = false;

function onFocusOrVisible() {
  if (document.visibilityState === 'hidden') return;
  if (authCache.user) {
    void verifyDatabaseAccountAlive();
  }
}

function startStatusPolling() {
  stopStatusPolling();
  void syncServerSubscriptionStatus();
  statusPollTimer = window.setInterval(() => {
    void syncServerSubscriptionStatus();
  }, 15000);
  authVerifyTimer = window.setInterval(() => {
    void verifyDatabaseAccountAlive();
  }, 8000);
  if (typeof window !== 'undefined' && !focusListenersBound) {
    focusListenersBound = true;
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
  }
}

function stopStatusPolling() {
  if (statusPollTimer) {
    window.clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
  if (authVerifyTimer) {
    window.clearInterval(authVerifyTimer);
    authVerifyTimer = null;
  }
  if (typeof window !== 'undefined' && focusListenersBound) {
    focusListenersBound = false;
    window.removeEventListener('focus', onFocusOrVisible);
    document.removeEventListener('visibilitychange', onFocusOrVisible);
  }
}

function handleUserSignedIn(supaUser: SupabaseUser) {
  const mapped = mapSupabaseUser(supaUser);
  authCache = { user: mapped, authReady: true };

  // Merge user_metadata watchlist/history if present
  const meta = (supaUser.user_metadata || {}) as Record<string, unknown>;
  if (Array.isArray(meta.aadhi_watchlist) && meta.aadhi_watchlist.length > 0) {
    const cloudList = meta.aadhi_watchlist as WatchlistEntry[];
    const mergedMap = new Map<string, WatchlistEntry>();
    for (const item of watchlistCache) mergedMap.set(item.key, item);
    for (const item of cloudList) {
      const existing = mergedMap.get(item.key);
      if (!existing || item.updatedAt > existing.updatedAt) {
        mergedMap.set(item.key, item);
      }
    }
    watchlistCache = Array.from(mergedMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    writeJson(WATCHLIST_KEY, watchlistCache);
  }

  if (Array.isArray(meta.aadhi_history) && meta.aadhi_history.length > 0) {
    const cloudHist = meta.aadhi_history as HistoryEntry[];
    const mergedMap = new Map<string, HistoryEntry>();
    for (const item of historyCache) mergedMap.set(item.key, item);
    for (const item of cloudHist) {
      const existing = mergedMap.get(item.key);
      if (!existing || item.updatedAt > existing.updatedAt) {
        mergedMap.set(item.key, item);
      }
    }
    historyCache = Array.from(mergedMap.values()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
    writeJson(HISTORY_KEY, historyCache);
  }

  if (mapped) {
    blockedCache = readBlockedFallback(mapped.uid);
    subSnapshotCache = buildSubSnapshot(subscriptionCache);
    startStatusPolling();
  }
  emit();
}

function handleUserSignedOut() {
  stopStatusPolling();
  clearAdminPassToken();
  authCache = { user: null, authReady: true };
  blockedCache = { blocked: false, reason: '' };
  subscriptionCache = null;
  subSnapshotCache = buildSubSnapshot(null);
  vipCelebrationCache = { open: false, subscription: null };
  extraCelebrationCache = { open: false, extraCredits: 0 };
  emit();
}

// Initialize Supabase auth listener and verify live database status on boot
supabase.auth.getSession().then(async ({ data }) => {
  if (data.session?.user) {
    const status = await verifyActiveSupabaseUser();
    if (status === 'revoked') {
      await forceImmediateLogout();
      return;
    }
    handleUserSignedIn(data.session.user);
  } else {
    handleUserSignedOut();
  }
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) {
    handleUserSignedIn(session.user);
  } else {
    handleUserSignedOut();
  }
});

export const STATUS_LABELS: Record<WatchStatus, string> = {
  watching: 'Watching',
  planning: 'Plan to Watch',
  completed: 'Completed',
  paused: 'On Hold',
  dropped: 'Dropped',
};

export function useAuth() {
  return useSyncExternalStore(subscribe, () => authCache, () => authCache);
}

export function useWatchlist() {
  return useSyncExternalStore(subscribe, () => watchlistCache, () => watchlistCache);
}

export function useHistory() {
  return useSyncExternalStore(subscribe, () => historyCache, () => historyCache);
}

export function useTheme() {
  return useSyncExternalStore(subscribe, () => themeCache, () => themeCache);
}

export function useAudioPref() {
  return useSyncExternalStore(subscribe, () => audioCache, () => audioCache);
}

export function useSubscription(): SubscriptionSnapshot {
  return useSyncExternalStore(subscribe, () => subSnapshotCache, () => subSnapshotCache);
}

export function useDailyUsage(): DailyUsage {
  return useSyncExternalStore(subscribe, () => usageCache, () => usageCache);
}

export function useSubModal(): SubModalState {
  return useSyncExternalStore(subscribe, () => subModalCache, () => subModalCache);
}

export function useVipCelebration(): VipCelebrationState {
  return useSyncExternalStore(subscribe, () => vipCelebrationCache, () => vipCelebrationCache);
}

export function useExtraCelebration(): ExtraCelebrationState {
  return useSyncExternalStore(subscribe, () => extraCelebrationCache, () => extraCelebrationCache);
}

export function useBlockedState(): BlockedState {
  return useSyncExternalStore(subscribe, () => blockedCache, () => blockedCache);
}

export function openSubModal(
  reason: 'crown' | 'limit' | 'reminder' = 'crown',
  preferredPlan: SubscriptionPlan = 'monthly_25'
) {
  subModalCache = { open: true, reason, selectedPlan: preferredPlan };
  emit();
}

export function setSubModalPlan(plan: SubscriptionPlan) {
  subModalCache = { ...subModalCache, selectedPlan: plan };
  emit();
}

export function closeSubModal() {
  subModalCache = { ...subModalCache, open: false };
  emit();
}

export async function submitPaymentConfirmation(params: {
  plan: SubscriptionPlan;
  referenceNumber: string;
  screenshotName?: string;
  screenshotPreview?: string;
  confirmedPaid: boolean;
}) {
  const user = authCache.user;
  const token = await getAccessToken();
  if (!user || !user.email || !token) {
    throw new Error('Please sign in first before confirming payment.');
  }
  if (!params.confirmedPaid) {
    throw new Error('Please tick the confirmation box confirming you completed the payment.');
  }

  const plan: SubscriptionPlan = params.plan === 'extra_2' ? 'extra_2' : 'monthly_25';
  const amountInr: 25 | 2 = plan === 'extra_2' ? EXTRA_EPISODE_PRICE_INR : MONTHLY_PRICE_INR;
  const cleanRef = params.referenceNumber.trim().slice(0, 100);
  if (cleanRef.length < 4) {
    throw new Error('Please enter a valid payment reference / UTR number (min 4 characters).');
  }

  const requestId = sanitizeDocId(`${user.uid}_${Date.now()}`);
  const res = await fetch('/api/payments/confirm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      id: requestId,
      plan,
      amountInr,
      referenceNumber: cleanRef,
      screenshotName: params.screenshotName?.trim().slice(0, 200) || '',
      screenshotPreview: params.screenshotPreview || '',
      userName: user.displayName || user.email.split('@')[0] || 'Member',
      confirmedPaid: true,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || 'Failed to submit payment confirmation.');
  }

  const now = Date.now();
  subscriptionCache = {
    plan,
    amountInr,
    status: 'pending',
    referenceNumber: cleanRef,
    screenshotName: params.screenshotName || undefined,
    requestId,
    startedAtMs: subscriptionCache?.startedAtMs || 0,
    expiresAtMs: subscriptionCache?.expiresAtMs || 0,
    extraCredits: subscriptionCache?.extraCredits || 0,
    updatedAt: now,
  };
  writeJson(SUBSCRIPTION_KEY, subscriptionCache);
  subSnapshotCache = buildSubSnapshot(subscriptionCache);
  emit();
}

export async function approvePaymentRequest(reqItem: PaymentRequest, adminNote?: string) {
  const user = authCache.user;
  const token = await getAccessToken();
  const passToken = getAdminPassToken();
  if (!isOwnerAdmin(user) || !token || !passToken) {
    throw new Error('Only the owner admin with verified password can approve payments.');
  }

  const res = await fetch(`/api/admin/payments/${encodeURIComponent(reqItem.id)}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-admin-pass': passToken,
    },
    body: JSON.stringify({ adminNote }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || 'Approval failed.');
  }
}

export async function cancelPaymentRequest(reqItem: PaymentRequest, adminNote?: string) {
  const user = authCache.user;
  const token = await getAccessToken();
  const passToken = getAdminPassToken();
  if (!isOwnerAdmin(user) || !token || !passToken) {
    throw new Error('Only the owner admin with verified password can cancel payments.');
  }

  const res = await fetch(`/api/admin/payments/${encodeURIComponent(reqItem.id)}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-admin-pass': passToken,
    },
    body: JSON.stringify({ adminNote }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || 'Rejection failed.');
  }
}

export function tryConsumeWatchSlot(videoKey: string): {
  allowed: boolean;
  used: number;
  limit: number;
  usedExtraCredit?: boolean;
} {
  if (isVipFreeAccount(authCache.user) || isSubActive(subscriptionCache)) {
    return { allowed: true, used: 0, limit: DAILY_FREE_LIMIT };
  }

  const today = getTodayKey();
  if (usageCache.dateKey !== today) {
    usageCache = { dateKey: today, watchedKeys: [], updatedAt: Date.now() };
  }

  if (usageCache.watchedKeys.includes(videoKey)) {
    return {
      allowed: true,
      used: usageCache.watchedKeys.length,
      limit: DAILY_FREE_LIMIT,
    };
  }

  if (usageCache.watchedKeys.length < DAILY_FREE_LIMIT) {
    const nextKeys = [...usageCache.watchedKeys, videoKey];
    usageCache = { dateKey: today, watchedKeys: nextKeys, updatedAt: Date.now() };
    writeJson(USAGE_KEY, usageCache);
    scheduleUserMetadataSync();
    return {
      allowed: true,
      used: nextKeys.length,
      limit: DAILY_FREE_LIMIT,
    };
  }

  const currentExtra = Math.max(0, Number(subscriptionCache?.extraCredits || 0));
  if (currentExtra > 0 && subscriptionCache) {
    const nextExtra = currentExtra - 1;
    const nextKeys = [...usageCache.watchedKeys, videoKey];
    usageCache = { dateKey: today, watchedKeys: nextKeys, updatedAt: Date.now() };
    writeJson(USAGE_KEY, usageCache);

    subscriptionCache = {
      ...subscriptionCache,
      extraCredits: nextExtra,
      updatedAt: Date.now(),
    };
    writeJson(SUBSCRIPTION_KEY, subscriptionCache);
    subSnapshotCache = buildSubSnapshot(subscriptionCache);
    emit();

    getAccessToken().then((token) => {
      if (!token) return;
      fetch('/api/payments/consume-extra', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    });

    return {
      allowed: true,
      used: nextKeys.length,
      limit: DAILY_FREE_LIMIT,
      usedExtraCredit: true,
    };
  }

  return {
    allowed: false,
    used: usageCache.watchedKeys.length,
    limit: DAILY_FREE_LIMIT,
  };
}

export function toggleTheme() {
  themeCache = themeCache === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, themeCache);
  } catch {
    // Ignore
  }
  applyThemeToDom(themeCache);
  emit();
}

export function setAudioPref(audio: 'hindi' | 'english') {
  audioCache = audio;
  try {
    localStorage.setItem(AUDIO_KEY, audio);
  } catch {
    // Ignore
  }
  emit();
}

export function getWatchlistEntry(key: string): WatchlistEntry | undefined {
  return watchlistCache.find((w) => w.key === key);
}

export function upsertWatchlist(entry: Omit<WatchlistEntry, 'updatedAt'>) {
  const existing = watchlistCache.find((w) => w.key === entry.key);
  const nextItem: WatchlistEntry = {
    ...existing,
    ...entry,
    updatedAt: Date.now(),
  };
  const rest = watchlistCache.filter((w) => w.key !== entry.key);
  watchlistCache = [nextItem, ...rest];
  writeJson(WATCHLIST_KEY, watchlistCache);
  scheduleUserMetadataSync();
}

export function toggleFavorite(entry: Omit<WatchlistEntry, 'updatedAt' | 'status'> & { status?: WatchStatus }) {
  const existing = watchlistCache.find((w) => w.key === entry.key);
  const nextFav = !existing?.favorite;
  const nextItem: WatchlistEntry = {
    status: existing?.status || entry.status || 'planning',
    ...existing,
    ...entry,
    favorite: nextFav,
    updatedAt: Date.now(),
  };
  const rest = watchlistCache.filter((w) => w.key !== entry.key);
  watchlistCache = [nextItem, ...rest];
  writeJson(WATCHLIST_KEY, watchlistCache);
  scheduleUserMetadataSync();
}

export function removeFromWatchlist(key: string) {
  watchlistCache = watchlistCache.filter((w) => w.key !== key);
  writeJson(WATCHLIST_KEY, watchlistCache);
  scheduleUserMetadataSync();
}

export function recordHistory(entry: Omit<HistoryEntry, 'updatedAt'>) {
  const nextItem: HistoryEntry = {
    ...entry,
    updatedAt: Date.now(),
  };
  const rest = historyCache.filter((h) => h.key !== entry.key);
  historyCache = [nextItem, ...rest].slice(0, 60);
  writeJson(HISTORY_KEY, historyCache);
  scheduleUserMetadataSync();
}

export function removeHistoryItem(key: string) {
  historyCache = historyCache.filter((h) => h.key !== key);
  writeJson(HISTORY_KEY, historyCache);
  scheduleUserMetadataSync();
}

export function clearHistory() {
  historyCache = [];
  writeJson(HISTORY_KEY, historyCache);
  scheduleUserMetadataSync();
}
