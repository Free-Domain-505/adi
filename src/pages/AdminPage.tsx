import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Ban,
  Check,
  Clock,
  Crown,
  Image as ImageIcon,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  MessageCircle,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { PaymentRequest } from '../types';
import { getAccessToken, signOutUser } from '../lib/supabase';
import {
  OWNER_PHONE_INTL,
  approvePaymentRequest,
  cancelPaymentRequest,
  checkAdminPassSession,
  clearAdminPassToken,
  getAdminPassToken,
  isOwnerAdmin,
  useAuth,
  verifyAdminPassword,
} from '../lib/storage';
import { HubBar } from '../components/HubBar';
import { safeParseJson } from '../lib/hybridClient';

export default function AdminPage() {
  const { user, authReady } = useAuth();
  const adminAuthorized = isOwnerAdmin(user);

  const [checkingPass, setCheckingPass] = useState(false);
  const [passUnlocked, setPassUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passBusy, setPassBusy] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [previewModalImg, setPreviewModalImg] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Owner Admin Panel — Anime by Adi 💀';
  }, []);

  // Verify existing session token when owner email is signed in
  useEffect(() => {
    if (!authReady || !adminAuthorized || !user) {
      setPassUnlocked(false);
      setCheckingPass(false);
      return;
    }

    let cancelled = false;
    setCheckingPass(true);
    checkAdminPassSession()
      .then((valid) => {
        if (!cancelled) {
          setPassUnlocked(valid);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingPass(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, adminAuthorized, user]);

  const fetchPayments = useCallback(async () => {
    if (!adminAuthorized || !passUnlocked || !user) return;
    const passToken = getAdminPassToken();
    const token = await getAccessToken();
    if (!passToken || !token) return;

    setLoadingRequests(true);
    try {
      const r = await fetch('/api/admin/payments', {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-admin-pass': passToken,
        },
      });
      if (r.status === 401) {
        clearAdminPassToken();
        setPassUnlocked(false);
        return;
      }
      if (r.ok) {
        const json = await safeParseJson<{ requests?: any[] }>(r);
        if (Array.isArray(json?.requests)) {
          const mapped: PaymentRequest[] = json.requests.map((d: any) => ({
            id: String(d.id || ''),
            userId: String(d.userId || ''),
            userEmail: String(d.userEmail || ''),
            userName: d.userName ? String(d.userName) : undefined,
            plan: d.plan === 'extra_2' ? 'extra_2' : 'monthly_25',
            amountInr: d.plan === 'extra_2' ? 2 : 25,
            referenceNumber: String(d.referenceNumber || ''),
            screenshotName: d.screenshotName ? String(d.screenshotName) : undefined,
            screenshotPreview: d.screenshotPreview ? String(d.screenshotPreview) : undefined,
            confirmedPaid: Boolean(d.confirmedPaid),
            status: (d.status as PaymentRequest['status']) || 'pending',
            adminNote: d.adminNote ? String(d.adminNote) : undefined,
            createdAt: Number(d.createdAt || Date.now()),
            updatedAt: Number(d.updatedAt || Date.now()),
          }));
          mapped.sort((a, b) => b.createdAt - a.createdAt);
          setRequests(mapped);
        }
      }
    } catch {
      // Ignore network hiccups during polling
    } finally {
      setLoadingRequests(false);
    }
  }, [adminAuthorized, passUnlocked, user]);

  useEffect(() => {
    if (!adminAuthorized || !passUnlocked || !user) {
      setRequests([]);
      return;
    }

    void fetchPayments();
    const timer = window.setInterval(() => {
      void fetchPayments();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [adminAuthorized, passUnlocked, user, fetchPayments]);

  const counts = useMemo(() => {
    return {
      pending: requests.filter((r) => r.status === 'pending').length,
      approved: requests.filter((r) => r.status === 'approved').length,
      rejected: requests.filter((r) => r.status === 'rejected').length,
      all: requests.length,
    };
  }, [requests]);

  const filteredRequests = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordInput) return;
    setPassBusy(true);
    setPassError(null);
    try {
      await verifyAdminPassword(passwordInput);
      setPasswordInput('');
      setPassUnlocked(true);
    } catch (err) {
      setPassError(err instanceof Error ? err.message : 'Incorrect admin password.');
    } finally {
      setPassBusy(false);
    }
  };

  const handleLockPanel = () => {
    clearAdminPassToken();
    setPassUnlocked(false);
    setPasswordInput('');
    setStatusMessage(null);
    setError(null);
  };

  const handleApprove = async (item: PaymentRequest) => {
    setBusyId(item.id);
    setError(null);
    setStatusMessage(null);
    try {
      const isExtra = item.plan === 'extra_2';
      const note =
        notesById[item.id]?.trim() ||
        (isExtra
          ? '₹2 payment verified! 1 Extra Episode has been unlocked on your account.'
          : 'Payment verified! Your 30-day VIP Royal Pass is now active.');
      await approvePaymentRequest(item, note);
      await fetchPayments();
      setStatusMessage(
        isExtra
          ? `Approved ₹2 (1 Extra Episode) for ${item.userName || item.userEmail}.`
          : `Approved VIP for ${item.userName || item.userEmail} — VIP badge & live unlock sent.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve payment');
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectAndBlock = async (item: PaymentRequest) => {
    setBusyId(item.id);
    setError(null);
    setStatusMessage(null);
    try {
      const note =
        notesById[item.id]?.trim() ||
        'Fake or unverified payment rejected. Your account has been blocked from Anime by Adi 💀.';
      await cancelPaymentRequest(item, note);
      await fetchPayments();
      setStatusMessage(
        `Rejected payment & blocked ${item.userName || item.userEmail} from the website.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject & block user');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-20">
      <HubBar />

      <div className="mx-auto mt-8 max-w-5xl px-4 sm:px-6">
        {!authReady ? (
          <div className="skeleton-shimmer h-48 rounded-2xl border border-line" />
        ) : !user ? (
          <div className="mx-auto max-w-md rounded-2xl border border-rose-500/35 bg-surface p-7 text-center shadow-xl">
            <Lock className="mx-auto size-10 text-rose-400" />
            <h1 className="mt-3 font-display text-2xl font-extrabold text-ink">
              Locked — Owner Access Only
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Admin is strictly locked. Only the authorized owner account can unlock this panel.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950"
              >
                <LogIn className="size-4" />
                <span>Owner Sign In</span>
              </Link>
              <Link
                to="/home"
                className="rounded-xl border border-line bg-canvas px-4 py-2.5 text-xs font-semibold text-ink"
              >
                Back Home
              </Link>
            </div>
          </div>
        ) : !adminAuthorized ? (
          <div className="mx-auto max-w-md rounded-2xl border border-rose-500/40 bg-surface p-7 text-center shadow-xl">
            <ShieldAlert className="mx-auto size-10 text-rose-400" />
            <h1 className="mt-3 font-display text-xl font-extrabold text-ink">
              Admin Locked — Owner Access Only
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              You are signed in as <span className="font-mono text-ink">{user.email}</span>. Only the authorized owner account can access the Admin Payment Panel.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => signOutUser()}
                className="rounded-xl border border-line bg-canvas px-4 py-2.5 text-xs font-semibold text-ink"
              >
                Switch Account
              </button>
              <Link
                to="/home"
                className="rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-accent-ink"
              >
                Back Home
              </Link>
            </div>
          </div>
        ) : checkingPass ? (
          <div className="skeleton-shimmer h-48 rounded-2xl border border-line" />
        ) : !passUnlocked ? (
          <form
            onSubmit={handleUnlock}
            className="mx-auto max-w-sm rounded-2xl border border-amber-400/40 bg-surface p-7 text-center shadow-2xl"
          >
            <div className="mx-auto grid size-12 place-items-center rounded-xl border border-amber-400/40 bg-amber-400/15 text-amber-300">
              <KeyRound className="size-6" />
            </div>
            <h1 className="mt-3 font-display text-xl font-extrabold text-ink">
              Enter Admin Password
            </h1>
            <p className="mt-1.5 text-xs text-muted">
              Owner verified (<span className="font-mono text-ink">{user.email}</span>). Enter your encrypted admin password to unlock payment controls.
            </p>

            <div className="mt-5 text-left">
              <label htmlFor="admin-pass-input" className="block text-xs font-semibold text-muted">
                Password
              </label>
              <input
                id="admin-pass-input"
                type="password"
                autoFocus
                autoComplete="current-password"
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter admin password"
                className="mt-1.5 w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-amber-400 focus:outline-none"
              />
            </div>

            {passError && (
              <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {passError}
              </div>
            )}

            <button
              type="submit"
              disabled={passBusy || !passwordInput}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition-transform hover:scale-[1.01] disabled:opacity-50"
            >
              <Lock className="size-4" />
              <span>{passBusy ? 'Verifying...' : 'Unlock Admin Panel'}</span>
            </button>
          </form>
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-400/35 bg-surface p-5">
              <div className="flex items-center gap-3">
                <div className="grid size-12 place-items-center rounded-xl bg-amber-400 text-slate-950">
                  <Crown className="size-6 fill-current" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="font-display text-xl font-extrabold text-ink sm:text-2xl">
                      Owner Payment Admin Panel
                    </h1>
                    <ShieldCheck className="size-5 text-teal" />
                  </div>
                  <p className="text-xs text-muted">
                    Approve verified ₹25 payments to activate VIP, or Reject to block fake payment accounts from the entire website.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <span className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-amber-300">
                  Pending: {counts.pending}
                </span>
                <span className="rounded-lg border border-teal/40 bg-teal/15 px-3 py-1.5 text-teal">
                  VIP Active: {counts.approved}
                </span>
                <span className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-rose-300">
                  Blocked: {counts.rejected}
                </span>
                <button
                  type="button"
                  onClick={handleLockPanel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-3 py-1.5 font-sans font-semibold text-muted hover:border-amber-400/50 hover:text-ink"
                >
                  <Lock className="size-3.5" />
                  <span>Lock</span>
                </button>
              </div>
            </div>

            {statusMessage && (
              <div className="rounded-xl border border-teal/40 bg-teal/15 px-4 py-3 text-xs font-semibold text-teal">
                {statusMessage}
              </div>
            )}
            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
                {error}
              </div>
            )}

            {/* Filter Tabs */}
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'pending', label: `Pending (${counts.pending})` },
                  { id: 'approved', label: `Approved VIP (${counts.approved})` },
                  { id: 'rejected', label: `Rejected & Blocked (${counts.rejected})` },
                  { id: 'all', label: `All (${counts.all})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                    filter === tab.id
                      ? 'bg-accent text-accent-ink'
                      : 'bg-surface text-muted hover:text-ink'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Requests List */}
            {loadingRequests && requests.length === 0 ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton-shimmer h-36 rounded-2xl border border-line" />
                ))}
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="rounded-2xl border border-line bg-surface p-10 text-center text-sm text-muted">
                No {filter === 'all' ? '' : filter} payment requests right now.
              </div>
            ) : (
              <div className="space-y-4">
                {filteredRequests.map((item) => {
                  const previewSrc = item.screenshotPreview;
                  const isBusy = busyId === item.id;
                  const waReply = `https://wa.me/${OWNER_PHONE_INTL}?text=${encodeURIComponent(
                    `Payment status update for ${item.userEmail} (Ref: ${item.referenceNumber})`
                  )}`;

                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-line bg-surface p-5 shadow-md"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-display text-base font-bold text-ink">
                              {item.userName || 'Member'}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${
                                item.status === 'approved'
                                  ? 'bg-amber-400 text-slate-950'
                                  : item.status === 'rejected'
                                    ? 'bg-rose-500/20 text-rose-300'
                                    : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {item.status === 'approved' ? (
                                <>
                                  <Crown className="size-3 fill-current" />
                                  <span>VIP Approved</span>
                                </>
                              ) : item.status === 'rejected' ? (
                                <>
                                  <Ban className="size-3" />
                                  <span>Rejected &amp; Blocked</span>
                                </>
                              ) : (
                                <>
                                  <Clock className="size-3" />
                                  <span>Pending</span>
                                </>
                              )}
                            </span>
                            <span
                              className={`rounded-md px-2 py-0.5 font-mono text-xs font-bold ${
                                item.plan === 'extra_2'
                                  ? 'bg-teal/15 text-teal'
                                  : 'bg-amber-500/15 text-amber-300'
                              }`}
                            >
                              ₹{item.amountInr} · {item.plan === 'extra_2' ? '1 Extra Episode' : 'Monthly VIP'}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                            <span className="inline-flex items-center gap-1">
                              <Mail className="size-3.5" />
                              <span>{item.userEmail}</span>
                            </span>
                            <span>UID: <code className="text-ink">{item.userId.slice(0, 12)}...</code></span>
                            <span>{new Date(item.createdAt).toLocaleString('en-IN')}</span>
                          </div>

                          <div className="rounded-xl border border-line bg-canvas/60 p-3 text-xs">
                            <p className="text-muted">
                              Payment Reference / UTR:{' '}
                              <strong className="font-mono text-sm text-amber-300">
                                {item.referenceNumber}
                              </strong>
                            </p>
                            {item.screenshotName && (
                              <p className="mt-1 text-muted">
                                Screenshot File: <span className="text-ink">{item.screenshotName}</span>
                              </p>
                            )}
                            {item.adminNote && (
                              <p className="mt-1 text-teal">Note: {item.adminNote}</p>
                            )}
                          </div>
                        </div>

                        {/* Screenshot Preview Box */}
                        {previewSrc && (
                          <button
                            type="button"
                            onClick={() => setPreviewModalImg(previewSrc)}
                            className="group relative shrink-0 overflow-hidden rounded-xl border border-amber-400/40 bg-canvas"
                          >
                            <img
                              src={previewSrc}
                              alt="Payment screenshot"
                              className="h-28 w-36 object-cover transition-transform group-hover:scale-105"
                            />
                            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/75 py-1 text-[10px] font-semibold text-white">
                              <ImageIcon className="size-3" />
                              <span>View Proof</span>
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Admin Note + Approve / Reject & Block Actions */}
                      <div className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          value={notesById[item.id] ?? ''}
                          onChange={(e) =>
                            setNotesById((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                          placeholder="Optional message / block reason for user..."
                          className="flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                        />

                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={waReply}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-3 py-2 text-xs font-semibold text-muted hover:text-ink"
                          >
                            <MessageCircle className="size-3.5 text-emerald-400" />
                            <span>WhatsApp</span>
                          </a>

                          {item.status !== 'approved' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleApprove(item)}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-slate-950 transition-transform hover:scale-[1.02] disabled:opacity-50 ${
                                item.plan === 'extra_2' ? 'bg-teal' : 'bg-emerald-500'
                              }`}
                            >
                              <Check className="size-4" />
                              <span>
                                {isBusy
                                  ? 'Saving...'
                                  : item.plan === 'extra_2'
                                    ? 'Approve ₹2 (1 Extra Ep)'
                                    : 'Approve Payment (VIP)'}
                              </span>
                            </button>
                          )}

                          {item.status !== 'rejected' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleRejectAndBlock(item)}
                              title="Reject fake/unverified payment and block this user from the entire website"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-xs font-bold text-rose-300 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
                            >
                              <Ban className="size-4" />
                              <span>Reject &amp; Block User</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fullscreen Screenshot Lightbox */}
      {previewModalImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setPreviewModalImg(null)}
        >
          <div className="relative max-h-[90vh] max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewModalImg(null)}
              className="absolute -right-2 -top-2 grid size-8 place-items-center rounded-full bg-surface text-ink shadow-lg"
            >
              <X className="size-4" />
            </button>
            <img
              src={previewModalImg}
              alt="Full payment proof"
              className="max-h-[85vh] rounded-xl border border-line object-contain"
            />
          </div>
        </div>
      )}
    </main>
  );
}
