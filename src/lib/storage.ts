import { useSyncExternalStore } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
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
  OperationType,
  auth,
  db,
  ensureUserProfile,
  handleFirestoreError,
  sanitizeDocId,
} from './firebase';

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
  const user = auth.currentUser;
  if (!isOwnerAdmin(user) || !user) {
    throw new Error('Owner Google account sign-in required.');
  }
  const idToken = await user.getIdToken();
  const res = await fetch('/api/admin/verify-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.adminPassToken) {
    throw new Error(json?.error || 'Incorrect admin password.');
  }
  const token = String(json.adminPassToken);
  setAdminPassToken(token);
  return token;
}

export async function checkAdminPassSession(): Promise<boolean> {
  const user = auth.currentUser;
  const passToken = getAdminPassToken();
  if (!isOwnerAdmin(user) || !user || !passToken) return false;
  try {
    const idToken = await user.getIdToken();
    const res = await fetch('/api/admin/verify-session', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
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

export function isOwnerAdmin(user: User | null | undefined): boolean {
  return Boolean(
    user &&
      user.emailVerified !== false &&
      user.email?.toLowerCase() === OWNER_ADMIN_EMAIL.toLowerCase()
  );
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
  const active = isSubActive(sub);
  const daysRemaining =
    active && sub
      ? Math.max(1, Math.ceil((sub.expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000)))
      : 0;
  return {
    subscription: sub,
    isSubscribed: active,
    isPending: sub?.status === 'pending',
    isPendingExtra: sub?.status === 'pending' && sub?.plan === 'extra_2',
    isRejected: sub?.status === 'rejected',
    daysRemaining,
    expiresAtMs: active && sub && sub.expiresAtMs > 0 ? sub.expiresAtMs : null,
    extraCredits: Math.max(0, Number(sub?.extraCredits || 0)),
  };
}

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
      // Ignore
    }
  }
  vipCelebrationCache = { open: false, subscription: null };
  emit();
}

export function dismissExtraCelebration() {
  const approvedAt = Number(subscriptionCache?.extraApprovedAtMs || 0);
  if (approvedAt > 0) {
    try {
      localStorage.setItem(SEEN_EXTRA_KEY, String(approvedAt));
    } catch {
      // Ignore
    }
  }
  extraCelebrationCache = { open: false, extraCredits: 0 };
  emit();
}

export interface BlockedState {
  blocked: boolean;
  reason: string;
  updatedAt: number;
}

let blockedCache: BlockedState = { blocked: false, reason: '', updatedAt: 0 };
let userDocBlockedState: BlockedState | null = null;

function computeBlockedState(uid: string | undefined, sub: UserSubscription | null) {
  if (!uid || isOwnerAdmin(auth.currentUser)) {
    blockedCache = { blocked: false, reason: '', updatedAt: 0 };
    return;
  }
  if (isSubActive(sub)) {
    blockedCache = { blocked: false, reason: '', updatedAt: Date.now() };
    try {
      localStorage.removeItem(`${BLOCKED_LOCAL_PREFIX}${uid}`);
    } catch {
      // Ignore
    }
    return;
  }
  if (userDocBlockedState?.blocked) {
    blockedCache = userDocBlockedState;
    writeJson(`${BLOCKED_LOCAL_PREFIX}${uid}`, blockedCache);
    return;
  }
  if (sub?.status === 'rejected') {
    blockedCache = {
      blocked: true,
      reason:
        sub.adminNote ||
        'Fake or unverified payment verification is not considered. Your account has been blocked from Anime by Adi 💀.',
      updatedAt: sub.updatedAt || Date.now(),
    };
    writeJson(`${BLOCKED_LOCAL_PREFIX}${uid}`, blockedCache);
    return;
  }
  if (userDocBlockedState && !userDocBlockedState.blocked) {
    blockedCache = { blocked: false, reason: '', updatedAt: userDocBlockedState.updatedAt };
    try {
      localStorage.removeItem(`${BLOCKED_LOCAL_PREFIX}${uid}`);
    } catch {
      // Ignore
    }
    return;
  }
  const stored = readJson<BlockedState | null>(`${BLOCKED_LOCAL_PREFIX}${uid}`, null);
  blockedCache = stored?.blocked ? stored : { blocked: false, reason: '', updatedAt: 0 };
}

function updateSubscriptionCache(sub: UserSubscription | null) {
  subscriptionCache = sub;
  subSnapshotCache = buildSubSnapshot(sub);
  checkVipCelebration(sub);
  computeBlockedState(auth.currentUser?.uid, sub);
  writeJson(SUBSCRIPTION_KEY, sub);
}

export interface SubModalState {
  open: boolean;
  reason: 'crown' | 'limit' | 'reminder';
  plan: SubscriptionPlan;
}

let subModalCache: SubModalState = { open: false, reason: 'crown', plan: 'monthly_25' };

let themeCache: 'dark' | 'light' = (() => {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
})();
let audioCache: 'hindi' | 'english' = (() => {
  try {
    return localStorage.getItem(AUDIO_KEY) === 'english' ? 'english' : 'hindi';
  } catch {
    return 'hindi';
  }
})();

export interface AuthState {
  user: User | null;
  authReady: boolean;
}

let authStateCache: AuthState = {
  user: auth.currentUser,
  authReady: false,
};

const remoteWatchlistIds = new Set<string>();
const remoteHistoryIds = new Set<string>();
let unsubWatchlist: (() => void) | null = null;
let unsubHistory: (() => void) | null = null;
let unsubSubscription: (() => void) | null = null;
let unsubUsage: (() => void) | null = null;
let unsubUserDoc: (() => void) | null = null;

function toMillis(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number') return val;
  return Date.now();
}

function cleanupFirestoreListeners() {
  if (unsubWatchlist) {
    unsubWatchlist();
    unsubWatchlist = null;
  }
  if (unsubHistory) {
    unsubHistory();
    unsubHistory = null;
  }
  if (unsubSubscription) {
    unsubSubscription();
    unsubSubscription = null;
  }
  if (unsubUsage) {
    unsubUsage();
    unsubUsage = null;
  }
  if (unsubUserDoc) {
    unsubUserDoc();
    unsubUserDoc = null;
  }
  remoteWatchlistIds.clear();
  remoteHistoryIds.clear();
}

async function writeWatchlistToFirestore(uid: string, entry: WatchlistEntry) {
  const itemKey = sanitizeDocId(entry.key);
  const path = `users/${uid}/watchlist/${itemKey}`;
  const ref = doc(db, 'users', uid, 'watchlist', itemKey);

  const safeTitle = (entry.title?.trim() || 'Untitled').slice(0, 300);
  const safeImage = (entry.image || '').slice(0, 1200);
  const safeHref = (entry.href?.trim() || '/home').slice(0, 300);
  const safeId = (entry.id?.trim() || itemKey).slice(0, 128);
  const safeProgress =
    typeof entry.progress === 'number' && Number.isFinite(entry.progress)
      ? Math.max(0, Math.min(10000, entry.progress))
      : null;
  const safeTotal =
    typeof entry.total === 'number' && Number.isFinite(entry.total)
      ? Math.max(0, Math.min(10000, entry.total))
      : null;
  const safeScore =
    typeof entry.score === 'number' && Number.isFinite(entry.score)
      ? Math.max(0, Math.min(100, entry.score))
      : null;

  let existsRemote = remoteWatchlistIds.has(itemKey);
  if (!existsRemote) {
    try {
      const snap = await getDoc(ref);
      existsRemote = snap.exists();
      if (existsRemote) remoteWatchlistIds.add(itemKey);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  if (existsRemote) {
    try {
      await updateDoc(ref, {
        title: safeTitle,
        image: safeImage,
        href: safeHref,
        status: entry.status,
        favorite: Boolean(entry.favorite),
        progress: safeProgress,
        total: safeTotal,
        score: safeScore,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(ref, {
        userId: uid,
        key: itemKey,
        kind: entry.kind,
        id: safeId,
        title: safeTitle,
        image: safeImage,
        href: safeHref,
        status: entry.status,
        favorite: Boolean(entry.favorite),
        progress: safeProgress,
        total: safeTotal,
        score: safeScore,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      remoteWatchlistIds.add(itemKey);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

async function writeHistoryToFirestore(uid: string, entry: HistoryEntry) {
  const itemKey = sanitizeDocId(entry.key);
  const path = `users/${uid}/history/${itemKey}`;
  const ref = doc(db, 'users', uid, 'history', itemKey);

  const safeTitle = (entry.title?.trim() || 'Untitled').slice(0, 300);
  const safeImage = (entry.image || '').slice(0, 1200);
  const safeHref = (entry.href?.trim() || '/home').slice(0, 300);
  const safeId = (entry.id?.trim() || itemKey).slice(0, 128);
  const safeSubtitle = (entry.subtitle || '').slice(0, 160);

  let existsRemote = remoteHistoryIds.has(itemKey);
  if (!existsRemote) {
    try {
      const snap = await getDoc(ref);
      existsRemote = snap.exists();
      if (existsRemote) remoteHistoryIds.add(itemKey);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  if (existsRemote) {
    try {
      await updateDoc(ref, {
        title: safeTitle,
        image: safeImage,
        href: safeHref,
        subtitle: safeSubtitle,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(ref, {
        userId: uid,
        key: itemKey,
        kind: entry.kind,
        id: safeId,
        title: safeTitle,
        image: safeImage,
        href: safeHref,
        subtitle: safeSubtitle,
        updatedAt: serverTimestamp(),
      });
      remoteHistoryIds.add(itemKey);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

async function writeUsageToFirestore(uid: string, usage: DailyUsage) {
  const dateKey = usage.dateKey;
  const path = `users/${uid}/usage/${dateKey}`;
  const ref = doc(db, 'users', uid, 'usage', dateKey);
  const safeKeys = usage.watchedKeys
    .map((k) => String(k).slice(0, 128))
    .filter(Boolean)
    .slice(0, 50);

  let existsRemote = false;
  try {
    const snap = await getDoc(ref);
    existsRemote = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (existsRemote) {
    try {
      await updateDoc(ref, {
        watchedKeys: safeKeys,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(ref, {
        userId: uid,
        dateKey,
        watchedKeys: safeKeys,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

onAuthStateChanged(auth, async (user) => {
  cleanupFirestoreListeners();
  userDocBlockedState = null;
  authStateCache = { user, authReady: true };
  emit();

  if (!user || user.emailVerified === false) {
    clearAdminPassToken();
    watchlistCache = readJson<WatchlistEntry[]>(WATCHLIST_KEY, []);
    historyCache = readJson<HistoryEntry[]>(HISTORY_KEY, []);
    updateSubscriptionCache(null);
    blockedCache = { blocked: false, reason: '', updatedAt: 0 };
    usageCache = readInitialUsage();
    emit();
    return;
  }

  if (!isOwnerAdmin(user)) {
    clearAdminPassToken();
  }

  computeBlockedState(user.uid, subscriptionCache);
  emit();

  try {
    await ensureUserProfile(user);
  } catch (err) {
    console.error('Failed to ensure user profile:', err);
  }

  const userProfilePath = `users/${user.uid}`;
  unsubUserDoc = onSnapshot(
    doc(db, 'users', user.uid),
    (docSnap) => {
      if (docSnap.exists() && !isOwnerAdmin(user)) {
        const d = docSnap.data();
        const isBlocked = d.blocked === true;
        userDocBlockedState = {
          blocked: isBlocked,
          reason: isBlocked
            ? String(
                d.blockedReason ||
                  'Fake or unverified payment verification is not considered. Your account is blocked from Anime by Adi 💀.'
              )
            : '',
          updatedAt: toMillis(d.updatedAt),
        };
      } else {
        userDocBlockedState = { blocked: false, reason: '', updatedAt: Date.now() };
      }
      computeBlockedState(user.uid, subscriptionCache);
      emit();
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, userProfilePath);
    }
  );

  const localWatchlist = readJson<WatchlistEntry[]>(WATCHLIST_KEY, []);
  const localHistory = readJson<HistoryEntry[]>(HISTORY_KEY, []);
  const localUsage = readInitialUsage();
  let mergedGuestItems = false;

  const wlPath = `users/${user.uid}/watchlist`;
  const wlQuery = query(
    collection(db, 'users', user.uid, 'watchlist'),
    where('userId', '==', user.uid)
  );
  unsubWatchlist = onSnapshot(
    wlQuery,
    (snapshot) => {
      remoteWatchlistIds.clear();
      const items: WatchlistEntry[] = [];
      snapshot.forEach((docSnap) => {
        remoteWatchlistIds.add(docSnap.id);
        const d = docSnap.data();
        items.push({
          key: String(d.key || docSnap.id),
          kind: d.kind,
          id: String(d.id || ''),
          title: String(d.title || ''),
          image: String(d.image || ''),
          href: String(d.href || '/home'),
          status: d.status || 'planning',
          favorite: Boolean(d.favorite),
          progress: typeof d.progress === 'number' ? d.progress : undefined,
          total: typeof d.total === 'number' ? d.total : null,
          score: typeof d.score === 'number' ? d.score : null,
          updatedAt: toMillis(d.updatedAt),
        });
      });

      items.sort((a, b) => b.updatedAt - a.updatedAt);
      watchlistCache = items;
      writeJson(WATCHLIST_KEY, items);

      if (!mergedGuestItems && localWatchlist.length > 0) {
        mergedGuestItems = true;
        for (const localItem of localWatchlist) {
          const itemKey = sanitizeDocId(localItem.key);
          if (!remoteWatchlistIds.has(itemKey)) {
            void writeWatchlistToFirestore(user.uid, localItem).catch(console.error);
          }
        }
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, wlPath);
    }
  );

  const histPath = `users/${user.uid}/history`;
  const histQuery = query(
    collection(db, 'users', user.uid, 'history'),
    where('userId', '==', user.uid)
  );
  let mergedGuestHistory = false;
  unsubHistory = onSnapshot(
    histQuery,
    (snapshot) => {
      remoteHistoryIds.clear();
      const items: HistoryEntry[] = [];
      snapshot.forEach((docSnap) => {
        remoteHistoryIds.add(docSnap.id);
        const d = docSnap.data();
        items.push({
          key: String(d.key || docSnap.id),
          kind: d.kind,
          id: String(d.id || ''),
          title: String(d.title || ''),
          image: String(d.image || ''),
          href: String(d.href || '/home'),
          subtitle: String(d.subtitle || ''),
          updatedAt: toMillis(d.updatedAt),
        });
      });

      items.sort((a, b) => b.updatedAt - a.updatedAt);
      historyCache = items.slice(0, 60);
      writeJson(HISTORY_KEY, historyCache);

      if (!mergedGuestHistory && localHistory.length > 0) {
        mergedGuestHistory = true;
        for (const localHist of localHistory.slice(0, 20)) {
          const itemKey = sanitizeDocId(localHist.key);
          if (!remoteHistoryIds.has(itemKey)) {
            void writeHistoryToFirestore(user.uid, localHist).catch(console.error);
          }
        }
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, histPath);
    }
  );

  const subPath = `users/${user.uid}/subscription/current`;
  unsubSubscription = onSnapshot(
    doc(db, 'users', user.uid, 'subscription', 'current'),
    (docSnap) => {
      if (docSnap.exists()) {
        const d = docSnap.data();
        const rawPlan = d.plan === 'extra_2' ? 'extra_2' : 'monthly_25';
        const rawStatus = String(d.status || 'pending');
        const expiresAtMs = Number(d.expiresAtMs || 0);
        const startedAtMs = Number(d.startedAtMs || 0);
        const extraCredits = Math.max(0, Number(d.extraCredits || 0));
        const extraApprovedAtMs = Number(d.extraApprovedAtMs || 0);
        let status: UserSubscription['status'] = 'pending';
        if (rawStatus === 'active') {
          if (rawPlan === 'monthly_25') {
            status = expiresAtMs > Date.now() ? 'active' : 'expired';
          } else {
            status = 'active';
          }
        } else if (rawStatus === 'rejected') {
          status = 'rejected';
        } else if (rawStatus === 'expired') {
          status = 'expired';
        } else {
          status = 'pending';
        }

        const remoteSub: UserSubscription = {
          plan: rawPlan,
          amountInr: rawPlan === 'extra_2' ? 2 : 25,
          status,
          referenceNumber: String(d.referenceNumber || ''),
          screenshotName: d.screenshotName ? String(d.screenshotName) : undefined,
          requestId: d.requestId ? String(d.requestId) : undefined,
          adminNote: d.adminNote ? String(d.adminNote) : undefined,
          startedAtMs,
          expiresAtMs,
          extraCredits,
          extraApprovedAtMs: extraApprovedAtMs > 0 ? extraApprovedAtMs : undefined,
          updatedAt: toMillis(d.updatedAt),
        };
        updateSubscriptionCache(remoteSub);
      } else {
        updateSubscriptionCache(null);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, subPath);
    }
  );

  attachUsageListener(user.uid, localUsage);
});

function attachUsageListener(uid: string, seedLocalUsage?: DailyUsage) {
  if (unsubUsage) {
    unsubUsage();
    unsubUsage = null;
  }
  const today = getTodayKey();
  const usagePath = `users/${uid}/usage/${today}`;
  let mergedGuestUsage = false;
  const localKeys = seedLocalUsage && seedLocalUsage.dateKey === today ? seedLocalUsage.watchedKeys : [];

  unsubUsage = onSnapshot(
    doc(db, 'users', uid, 'usage', today),
    (docSnap) => {
      const remoteKeys: string[] =
        docSnap.exists() && Array.isArray(docSnap.data().watchedKeys)
          ? (docSnap.data().watchedKeys as unknown[]).map(String)
          : [];
      const merged = Array.from(new Set([...remoteKeys, ...localKeys])).slice(0, 50);
      usageCache = {
        dateKey: today,
        watchedKeys: merged,
        updatedAt: docSnap.exists() ? toMillis(docSnap.data().updatedAt) : Date.now(),
      };
      writeJson(USAGE_KEY, usageCache);

      if (
        !mergedGuestUsage &&
        localKeys.length > 0 &&
        merged.length > remoteKeys.length
      ) {
        mergedGuestUsage = true;
        void writeUsageToFirestore(uid, usageCache).catch(console.error);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, usagePath);
    }
  );
}

// Automatically reset free daily watch count at 12:00 AM midnight
function scheduleMidnightReset() {
  if (typeof window === 'undefined') return;
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
  const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());
  window.setTimeout(() => {
    const newToday = getTodayKey();
    if (usageCache.dateKey !== newToday) {
      usageCache = { dateKey: newToday, watchedKeys: [], updatedAt: Date.now() };
      writeJson(USAGE_KEY, usageCache);
      const user = auth.currentUser;
      if (user && user.emailVerified !== false) {
        attachUsageListener(user.uid);
      }
    }
    scheduleMidnightReset();
  }, Math.min(delay, 2_147_483_647));
}

scheduleMidnightReset();

export const STATUS_LABELS: Record<WatchStatus, string> = {
  watching: 'Watching',
  planning: 'Plan to Watch',
  completed: 'Completed',
  paused: 'On Hold',
  dropped: 'Dropped',
};

export function useAuth() {
  return useSyncExternalStore(subscribe, () => authStateCache, () => authStateCache);
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
  plan: SubscriptionPlan = 'monthly_25'
) {
  subModalCache = { open: true, reason, plan };
  emit();
}

export function setSubModalPlan(plan: SubscriptionPlan) {
  subModalCache = { ...subModalCache, plan };
  emit();
}

export function closeSubModal() {
  subModalCache = { ...subModalCache, open: false };
  emit();
}

export async function submitPaymentConfirmation(params: {
  plan?: SubscriptionPlan;
  referenceNumber: string;
  screenshotName?: string;
  screenshotPreview?: string;
  confirmedPaid: boolean;
}): Promise<{ requestId: string }> {
  const user = auth.currentUser;
  if (!user || !user.email || user.emailVerified === false) {
    throw new Error('Please sign in with Google first so the owner can attach your pass to your account.');
  }
  if (blockedCache.blocked && !isOwnerAdmin(user)) {
    throw new Error('Your account is blocked due to unverified/fake payment submission.');
  }
  if (!params.confirmedPaid) {
    throw new Error('Please confirm that you have completed the payment.');
  }

  const plan: SubscriptionPlan = params.plan === 'extra_2' ? 'extra_2' : 'monthly_25';
  const amountInr: 25 | 2 = plan === 'extra_2' ? EXTRA_EPISODE_PRICE_INR : MONTHLY_PRICE_INR;

  const cleanRef = params.referenceNumber.trim().slice(0, 100);
  if (cleanRef.length < 4) {
    throw new Error('Please enter a valid payment reference / UTR number (min 4 characters).');
  }
  const cleanScreenshot = params.screenshotName?.trim().slice(0, 200) || '';
  const userName = (user.displayName || user.email.split('@')[0] || 'Member').trim().slice(0, 120);
  const userEmail = user.email.trim().slice(0, 254);

  const requestId = sanitizeDocId(`${user.uid}_${Date.now()}`);
  const reqPath = `paymentRequests/${requestId}`;
  const reqRef = doc(db, 'paymentRequests', requestId);
  const subPath = `users/${user.uid}/subscription/current`;
  const subRef = doc(db, 'users', user.uid, 'subscription', 'current');

  let subExists = false;
  try {
    const snap = await getDoc(subRef);
    subExists = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, subPath);
  }

  const batch = writeBatch(db);

  const reqPayload: Record<string, unknown> = {
    id: requestId,
    userId: user.uid,
    userEmail,
    userName,
    plan,
    amountInr,
    referenceNumber: cleanRef,
    confirmedPaid: true,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (cleanScreenshot) {
    reqPayload.screenshotName = cleanScreenshot;
  }
  batch.set(reqRef, reqPayload);

  if (subExists) {
    const updatePayload: Record<string, unknown> = {
      plan,
      amountInr,
      status: 'pending',
      referenceNumber: cleanRef,
      requestId,
      startedAtMs: 0,
      expiresAtMs: 0,
      updatedAt: serverTimestamp(),
    };
    if (cleanScreenshot) {
      updatePayload.screenshotName = cleanScreenshot;
    }
    batch.update(subRef, updatePayload);
  } else {
    const createPayload: Record<string, unknown> = {
      userId: user.uid,
      plan,
      amountInr,
      status: 'pending',
      referenceNumber: cleanRef,
      requestId,
      startedAtMs: 0,
      expiresAtMs: 0,
      updatedAt: serverTimestamp(),
    };
    if (cleanScreenshot) {
      createPayload.screenshotName = cleanScreenshot;
    }
    batch.set(subRef, createPayload);
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, reqPath);
  }

  // Mirror request & resized screenshot preview to Express backend for Admin Panel inspection
  try {
    const idToken = await user.getIdToken();
    await fetch('/api/payments/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        id: requestId,
        plan,
        userName,
        referenceNumber: cleanRef,
        screenshotName: cleanScreenshot || undefined,
        screenshotPreview: params.screenshotPreview,
        confirmedPaid: true,
      }),
    });
  } catch {
    // Non-fatal: Firestore already holds pending verification record
  }

  updateSubscriptionCache({
    plan,
    amountInr,
    status: 'pending',
    referenceNumber: cleanRef,
    screenshotName: cleanScreenshot || undefined,
    requestId,
    startedAtMs: 0,
    expiresAtMs: 0,
    extraCredits: subscriptionCache?.extraCredits || 0,
    extraApprovedAtMs: subscriptionCache?.extraApprovedAtMs,
    updatedAt: Date.now(),
  });

  return { requestId };
}

export async function approvePaymentRequest(
  reqItem: PaymentRequest,
  adminNote?: string
) {
  const admin = auth.currentUser;
  if (!isOwnerAdmin(admin)) {
    throw new Error('Owner admin sign-in required.');
  }

  const isExtra = reqItem.plan === 'extra_2';
  const defaultNote = isExtra
    ? '₹2 payment verified! 1 Extra Episode has been unlocked on your account.'
    : 'Payment verified! Your 30-day VIP Royal Pass is now active.';
  const cleanNote = (adminNote?.trim() || defaultNote).slice(0, 300);

  const now = Date.now();
  const expiresAtMs = now + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000;

  const reqRef = doc(db, 'paymentRequests', reqItem.id);
  const subPath = `users/${reqItem.userId}/subscription/current`;
  const subRef = doc(db, 'users', reqItem.userId, 'subscription', 'current');
  const userRef = doc(db, 'users', reqItem.userId);

  let subExists = false;
  let prevCredits = 0;
  let userExists = false;
  try {
    const [subSnap, userSnap] = await Promise.all([getDoc(subRef), getDoc(userRef)]);
    subExists = subSnap.exists();
    if (subSnap.exists()) {
      prevCredits = Math.max(0, Number(subSnap.data()?.extraCredits || 0));
    }
    userExists = userSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, subPath);
  }

  const batch = writeBatch(db);
  batch.update(reqRef, {
    status: 'approved',
    adminNote: cleanNote,
    updatedAt: serverTimestamp(),
  });

  const subPayload: Record<string, unknown> = isExtra
    ? {
        userId: reqItem.userId,
        plan: 'extra_2',
        amountInr: 2,
        status: 'active',
        referenceNumber: reqItem.referenceNumber,
        requestId: reqItem.id,
        adminNote: cleanNote,
        startedAtMs: 0,
        expiresAtMs: 0,
        extraCredits: Math.min(50, prevCredits + 1),
        extraApprovedAtMs: now,
        updatedAt: serverTimestamp(),
      }
    : {
        userId: reqItem.userId,
        plan: 'monthly_25',
        amountInr: 25,
        status: 'active',
        referenceNumber: reqItem.referenceNumber,
        requestId: reqItem.id,
        adminNote: cleanNote,
        startedAtMs: now,
        expiresAtMs,
        extraCredits: prevCredits,
        updatedAt: serverTimestamp(),
      };
  if (reqItem.screenshotName) {
    subPayload.screenshotName = reqItem.screenshotName;
  }

  if (subExists) {
    batch.update(subRef, subPayload);
  } else {
    batch.set(subRef, subPayload);
  }

  if (userExists) {
    batch.update(userRef, {
      blocked: false,
      blockedReason: '',
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `paymentRequests/${reqItem.id}`);
  }

  try {
    const idToken = await admin!.getIdToken();
    await fetch(`/api/admin/payments/${encodeURIComponent(reqItem.id)}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'x-admin-pass': getAdminPassToken(),
      },
      body: JSON.stringify({ adminNote: cleanNote }),
    });
  } catch {
    // Non-fatal mirror
  }
}

export async function cancelPaymentRequest(
  reqItem: PaymentRequest,
  adminNote = 'Fake or unverified payment rejected. Your account has been blocked from Anime by Adi 💀.'
) {
  const admin = auth.currentUser;
  if (!isOwnerAdmin(admin)) {
    throw new Error('Owner admin sign-in required.');
  }

  const plan: SubscriptionPlan = reqItem.plan === 'extra_2' ? 'extra_2' : 'monthly_25';
  const amountInr: 25 | 2 = plan === 'extra_2' ? 2 : 25;

  const cleanNote = adminNote.trim().slice(0, 300);
  const reqRef = doc(db, 'paymentRequests', reqItem.id);
  const subPath = `users/${reqItem.userId}/subscription/current`;
  const subRef = doc(db, 'users', reqItem.userId, 'subscription', 'current');
  const userRef = doc(db, 'users', reqItem.userId);

  let subExists = false;
  let userExists = false;
  try {
    const [subSnap, userSnap] = await Promise.all([getDoc(subRef), getDoc(userRef)]);
    subExists = subSnap.exists();
    userExists = userSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, subPath);
  }

  const batch = writeBatch(db);
  batch.update(reqRef, {
    status: 'rejected',
    adminNote: cleanNote,
    updatedAt: serverTimestamp(),
  });

  const subPayload: Record<string, unknown> = {
    userId: reqItem.userId,
    plan,
    amountInr,
    status: 'rejected',
    referenceNumber: reqItem.referenceNumber,
    requestId: reqItem.id,
    adminNote: cleanNote,
    startedAtMs: 0,
    expiresAtMs: 0,
    extraCredits: 0,
    updatedAt: serverTimestamp(),
  };
  if (reqItem.screenshotName) {
    subPayload.screenshotName = reqItem.screenshotName;
  }

  if (subExists) {
    batch.update(subRef, subPayload);
  } else {
    batch.set(subRef, subPayload);
  }

  if (userExists) {
    batch.update(userRef, {
      blocked: true,
      blockedReason: cleanNote,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `paymentRequests/${reqItem.id}`);
  }

  try {
    const idToken = await admin!.getIdToken();
    await fetch(`/api/admin/payments/${encodeURIComponent(reqItem.id)}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'x-admin-pass': getAdminPassToken(),
      },
      body: JSON.stringify({ adminNote: cleanNote }),
    });
  } catch {
    // Non-fatal mirror
  }
}

async function consumeExtraCreditInFirestore(uid: string, nextCredits: number) {
  const subPath = `users/${uid}/subscription/current`;
  const subRef = doc(db, 'users', uid, 'subscription', 'current');
  try {
    await updateDoc(subRef, {
      extraCredits: nextCredits,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, subPath);
  }
}

export function tryConsumeWatchSlot(videoKey: string): {
  allowed: boolean;
  usedExtra: boolean;
  count: number;
  limit: number;
} {
  const today = getTodayKey();
  if (usageCache.dateKey !== today) {
    usageCache = { dateKey: today, watchedKeys: [], updatedAt: Date.now() };
    writeJson(USAGE_KEY, usageCache);
  }

  const safeKey = sanitizeDocId(videoKey);

  if (isSubActive(subscriptionCache)) {
    return { allowed: true, usedExtra: false, count: usageCache.watchedKeys.length, limit: Infinity };
  }

  if (usageCache.watchedKeys.includes(safeKey)) {
    return {
      allowed: true,
      usedExtra: false,
      count: usageCache.watchedKeys.length,
      limit: DAILY_FREE_LIMIT,
    };
  }

  const currentExtraCredits = Math.max(0, Number(subscriptionCache?.extraCredits || 0));

  if (usageCache.watchedKeys.length >= DAILY_FREE_LIMIT) {
    if (currentExtraCredits > 0 && subscriptionCache) {
      // Immediately consume 1 ₹2 extra episode credit upon starting this episode (even if watched for 10s)
      const nextCredits = currentExtraCredits - 1;
      const nextUsage: DailyUsage = {
        dateKey: today,
        watchedKeys: [...usageCache.watchedKeys, safeKey],
        updatedAt: Date.now(),
      };
      usageCache = nextUsage;
      writeJson(USAGE_KEY, nextUsage);

      updateSubscriptionCache({
        ...subscriptionCache,
        extraCredits: nextCredits,
        updatedAt: Date.now(),
      });

      const user = auth.currentUser;
      if (user && user.emailVerified !== false) {
        void consumeExtraCreditInFirestore(user.uid, nextCredits).catch(console.error);
        void writeUsageToFirestore(user.uid, nextUsage).catch(console.error);
      }

      return {
        allowed: true,
        usedExtra: true,
        count: nextUsage.watchedKeys.length,
        limit: DAILY_FREE_LIMIT,
      };
    }

    return {
      allowed: false,
      usedExtra: false,
      count: usageCache.watchedKeys.length,
      limit: DAILY_FREE_LIMIT,
    };
  }

  const nextUsage: DailyUsage = {
    dateKey: today,
    watchedKeys: [...usageCache.watchedKeys, safeKey],
    updatedAt: Date.now(),
  };
  usageCache = nextUsage;
  writeJson(USAGE_KEY, nextUsage);

  const user = auth.currentUser;
  if (user && user.emailVerified !== false) {
    void writeUsageToFirestore(user.uid, nextUsage).catch(console.error);
  }

  return {
    allowed: true,
    usedExtra: false,
    count: nextUsage.watchedKeys.length,
    limit: DAILY_FREE_LIMIT,
  };
}

export function toggleTheme() {
  const next = themeCache === 'dark' ? 'light' : 'dark';
  themeCache = next;
  try {
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  } catch {
    // Ignore
  }
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
  const normalized = sanitizeDocId(key);
  return watchlistCache.find((e) => e.key === key || sanitizeDocId(e.key) === normalized);
}

export function upsertWatchlist(entry: Omit<WatchlistEntry, 'updatedAt'>) {
  const normalized = sanitizeDocId(entry.key);
  const idx = watchlistCache.findIndex(
    (e) => e.key === entry.key || sanitizeDocId(e.key) === normalized
  );
  const existing = idx >= 0 ? watchlistCache[idx] : null;
  const nextItem: WatchlistEntry = {
    ...existing,
    ...entry,
    key: existing?.key || entry.key,
    updatedAt: Date.now(),
  };
  const next =
    idx >= 0
      ? [nextItem, ...watchlistCache.filter((_, i) => i !== idx)]
      : [nextItem, ...watchlistCache];
  watchlistCache = next;
  writeJson(WATCHLIST_KEY, next);

  const user = auth.currentUser;
  if (user && user.emailVerified !== false) {
    void writeWatchlistToFirestore(user.uid, nextItem).catch(console.error);
  }
}

export function toggleFavorite(
  entry: Omit<WatchlistEntry, 'updatedAt' | 'status'> & { status?: WatchStatus }
) {
  const existing = getWatchlistEntry(entry.key);
  if (existing) {
    const nextFav = !existing.favorite;
    upsertWatchlist({
      ...existing,
      ...entry,
      status: existing.status,
      favorite: nextFav,
    });
    return nextFav;
  } else {
    upsertWatchlist({
      ...entry,
      status: entry.status || 'planning',
      favorite: true,
    });
    return true;
  }
}

export function removeFromWatchlist(key: string) {
  const normalized = sanitizeDocId(key);
  watchlistCache = watchlistCache.filter(
    (e) => e.key !== key && sanitizeDocId(e.key) !== normalized
  );
  writeJson(WATCHLIST_KEY, watchlistCache);

  const user = auth.currentUser;
  if (user && user.emailVerified !== false) {
    const path = `users/${user.uid}/watchlist/${normalized}`;
    deleteDoc(doc(db, 'users', user.uid, 'watchlist', normalized))
      .then(() => {
        remoteWatchlistIds.delete(normalized);
      })
      .catch((error) => {
        handleFirestoreError(error, OperationType.DELETE, path);
      });
  }
}

export function recordHistory(entry: Omit<HistoryEntry, 'updatedAt'>) {
  const normalized = sanitizeDocId(entry.key);
  const nextItem: HistoryEntry = {
    ...entry,
    updatedAt: Date.now(),
  };
  const filtered = historyCache.filter(
    (e) => e.key !== entry.key && sanitizeDocId(e.key) !== normalized
  );
  const next = [nextItem, ...filtered].slice(0, 60);
  historyCache = next;
  writeJson(HISTORY_KEY, next);

  const user = auth.currentUser;
  if (user && user.emailVerified !== false) {
    void writeHistoryToFirestore(user.uid, nextItem).catch(console.error);
  }
}

export function removeHistoryItem(key: string) {
  const normalized = sanitizeDocId(key);
  historyCache = historyCache.filter(
    (e) => e.key !== key && sanitizeDocId(e.key) !== normalized
  );
  writeJson(HISTORY_KEY, historyCache);

  const user = auth.currentUser;
  if (user && user.emailVerified !== false) {
    const path = `users/${user.uid}/history/${normalized}`;
    deleteDoc(doc(db, 'users', user.uid, 'history', normalized))
      .then(() => {
        remoteHistoryIds.delete(normalized);
      })
      .catch((error) => {
        handleFirestoreError(error, OperationType.DELETE, path);
      });
  }
}

export function clearHistory() {
  const prev = [...historyCache];
  historyCache = [];
  writeJson(HISTORY_KEY, []);

  const user = auth.currentUser;
  if (user && user.emailVerified !== false) {
    for (const item of prev) {
      const normalized = sanitizeDocId(item.key);
      const path = `users/${user.uid}/history/${normalized}`;
      deleteDoc(doc(db, 'users', user.uid, 'history', normalized))
        .then(() => {
          remoteHistoryIds.delete(normalized);
        })
        .catch((error) => {
          handleFirestoreError(error, OperationType.DELETE, path);
        });
    }
  }
}
