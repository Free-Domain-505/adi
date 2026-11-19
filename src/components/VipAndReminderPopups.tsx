import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CheckCircle2, Clock, Crown, Sparkles, Ticket, X } from 'lucide-react';
import {
  DAILY_FREE_LIMIT,
  EXTRA_EPISODE_PRICE_INR,
  MONTHLY_PRICE_INR,
  dismissExtraCelebration,
  dismissVipCelebration,
  getTimeUntilMidnightText,
  isOwnerAdmin,
  openSubModal,
  useAuth,
  useBlockedState,
  useDailyUsage,
  useExtraCelebration,
  useSubModal,
  useSubscription,
  useVipCelebration,
} from '../lib/storage';

export function VipCelebrationModal() {
  const { open, subscription } = useVipCelebration();

  if (!open || !subscription) return null;

  const expiresDate = subscription.expiresAtMs
    ? new Date(subscription.expiresAtMs).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vip-approved-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-amber-400/50 bg-surface p-6 text-center shadow-2xl sm:p-7">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-500" />

        <button
          type="button"
          onClick={dismissVipCelebration}
          aria-label="Close VIP popup"
          className="absolute right-3.5 top-4 grid size-8 place-items-center rounded-lg border border-line bg-canvas/70 text-muted hover:text-ink"
        >
          <X className="size-4" />
        </button>

        <div className="mx-auto grid size-16 place-items-center rounded-2xl border border-amber-400/50 bg-amber-400/20 text-amber-300 shadow-lg">
          <Crown className="size-8 fill-current" />
        </div>

        <span className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-amber-400 px-2.5 py-1 text-xs font-extrabold uppercase tracking-wider text-slate-950">
          <Sparkles className="size-3.5" />
          <span>VIP Approved</span>
        </span>

        <h2
          id="vip-approved-title"
          className="mt-3 font-display text-2xl font-extrabold tracking-tight text-ink"
        >
          Congratulations! You Now Have Premium VIP
        </h2>

        <p className="mt-2 text-xs leading-relaxed text-muted sm:text-sm">
          {subscription.adminNote ||
            'The owner has verified your ₹25 payment! Your profile now displays the VIP badge and all watch limits have been removed for 30 days.'}
        </p>

        <div className="mt-4 rounded-xl border border-teal/35 bg-teal/10 p-3.5 text-left text-xs">
          <div className="flex items-center gap-2 font-bold text-teal">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>30-Day Unlimited Streaming Unlocked</span>
          </div>
          {expiresDate && (
            <p className="mt-1 text-muted">
              Valid until <strong className="text-ink">{expiresDate}</strong> · Zero Ads · Unlimited Anime, Web Series &amp; Movies
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={dismissVipCelebration}
          className="mt-5 w-full rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg transition-transform hover:scale-[1.01]"
        >
          Awesome, Start Watching!
        </button>
      </div>
    </div>
  );
}

export function ExtraEpisodeCelebrationModal() {
  const { open, extraCredits, adminNote } = useExtraCelebration();

  if (!open || extraCredits <= 0) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="extra-ep-approved-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-teal/50 bg-surface p-6 text-center shadow-2xl sm:p-7">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-teal-400 via-emerald-400 to-teal-400" />

        <button
          type="button"
          onClick={dismissExtraCelebration}
          aria-label="Close unlocked episode popup"
          className="absolute right-3.5 top-4 grid size-8 place-items-center rounded-lg border border-line bg-canvas/70 text-muted hover:text-ink"
        >
          <X className="size-4" />
        </button>

        <div className="mx-auto grid size-16 place-items-center rounded-2xl border border-teal/50 bg-teal/15 text-teal shadow-lg">
          <Ticket className="size-8" />
        </div>

        <span className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-teal px-2.5 py-1 text-xs font-extrabold uppercase tracking-wider text-slate-950">
          <CheckCircle2 className="size-3.5" />
          <span>₹{EXTRA_EPISODE_PRICE_INR} Payment Verified</span>
        </span>

        <h2
          id="extra-ep-approved-title"
          className="mt-3 font-display text-2xl font-extrabold tracking-tight text-ink"
        >
          1 Extra Episode Unlocked!
        </h2>

        <p className="mt-2 text-xs leading-relaxed text-muted sm:text-sm">
          {adminNote ||
            'Your ₹2 payment is approved! You can watch 1 more episode right now.'}
        </p>

        <div className="mt-4 rounded-xl border border-amber-400/35 bg-amber-500/10 p-3.5 text-left text-xs leading-relaxed text-muted">
          <p className="font-bold text-amber-300">Single-Episode Pass Rule:</p>
          <p className="mt-1">
            This pass unlocks <strong className="text-ink">only 1 episode</strong>. As soon as you start watching it (even 10 seconds or half an episode), that pass is spent — other episodes will require ₹2 again or reset free at <strong className="text-ink">12:00 AM midnight</strong>.
          </p>
        </div>

        <button
          type="button"
          onClick={dismissExtraCelebration}
          className="mt-5 w-full rounded-xl bg-teal px-5 py-3 text-sm font-bold text-slate-950 shadow-lg transition-transform hover:scale-[1.01]"
        >
          Watch My 1 Episode Now
        </button>
      </div>
    </div>
  );
}

export function FreeTierReminderPopup() {
  const { pathname } = useLocation();
  const { user, authReady } = useAuth();
  const blockedState = useBlockedState();
  const { isSubscribed, isPending, isPendingExtra, extraCredits } = useSubscription();
  const { open: subModalOpen } = useSubModal();
  const { open: vipOpen } = useVipCelebration();
  const { open: extraOpen } = useExtraCelebration();
  const usage = useDailyUsage();

  const [reminderOpen, setReminderOpen] = useState(false);

  const used = usage.watchedKeys.length;
  // Rule:
  // - < 4 episodes watched -> NO popup at all
  // - 4 episodes watched (1 left) -> popup every 10 minutes
  // - >= 5 episodes watched (0 left, no extraCredits) -> popup every 1 minute
  const intervalMs =
    used >= DAILY_FREE_LIMIT ? 60_000 : used === 4 ? 10 * 60_000 : 0;

  useEffect(() => {
    if (
      !authReady ||
      isSubscribed ||
      blockedState.blocked ||
      isOwnerAdmin(user) ||
      pathname.startsWith('/admin') ||
      extraCredits > 0 ||
      intervalMs <= 0
    ) {
      setReminderOpen(false);
      return;
    }

    const timer = window.setInterval(() => {
      if (!subModalOpen && !vipOpen && !extraOpen && !blockedState.blocked) {
        setReminderOpen(true);
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [
    authReady,
    isSubscribed,
    blockedState.blocked,
    user,
    pathname,
    extraCredits,
    intervalMs,
    subModalOpen,
    vipOpen,
    extraOpen,
  ]);

  if (
    !reminderOpen ||
    isSubscribed ||
    blockedState.blocked ||
    extraCredits > 0 ||
    used < 4
  ) {
    return null;
  }

  const remaining = Math.max(0, DAILY_FREE_LIMIT - used);
  const midnightIn = getTimeUntilMidnightText();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="free-reminder-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-amber-400/40 bg-surface p-6 text-center shadow-2xl">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 to-rose-500" />

        <button
          type="button"
          onClick={() => setReminderOpen(false)}
          aria-label="Close reminder"
          className="absolute right-3.5 top-3.5 grid size-8 place-items-center rounded-lg border border-line bg-canvas/70 text-muted hover:text-ink"
        >
          <X className="size-4" />
        </button>

        <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-amber-400/35 bg-amber-500/15 text-amber-400">
          {isPending ? <Clock className="size-6" /> : <Crown className="size-6" />}
        </div>

        <h2 id="free-reminder-title" className="mt-3 font-display text-xl font-extrabold text-ink">
          {isPending
            ? isPendingExtra
              ? '₹2 Episode Verification Pending'
              : 'VIP Verification Pending'
            : remaining === 0
              ? 'All 5 Daily Episodes Finished!'
              : "You Don't Have Premium Yet"}
        </h2>

        <p className="mt-2 text-xs leading-relaxed text-muted sm:text-sm">
          {isPending ? (
            <>
              Your payment confirmation is waiting for owner approval. Daily free status:{' '}
              <strong className="text-amber-300">
                {remaining} of {DAILY_FREE_LIMIT} left
              </strong>
              . Resets at 12:00 AM midnight (in {midnightIn}).
            </>
          ) : remaining === 1 ? (
            <>
              You don&apos;t have a VIP subscription yet and have already watched{' '}
              <strong className="text-amber-300">4 of {DAILY_FREE_LIMIT} daily episodes</strong>. Only{' '}
              <strong className="text-ink">1 free episode</strong> is left today — resets at 12:00 AM midnight!
            </>
          ) : (
            <>
              You don&apos;t have premium and have finished all{' '}
              <strong className="text-amber-300">5 daily episodes</strong>. Unlock{' '}
              <strong className="text-teal">1 more episode for only ₹{EXTRA_EPISODE_PRICE_INR}</strong>, get unlimited VIP for ₹{MONTHLY_PRICE_INR}/month, or come back after{' '}
              <strong className="text-ink">12:00 AM midnight</strong> (in {midnightIn}) for 5 fresh episodes!
            </>
          )}
        </p>

        <div className="mt-5 flex flex-col gap-2">
          {remaining === 0 && (
            <button
              type="button"
              onClick={() => {
                setReminderOpen(false);
                openSubModal('limit', 'extra_2');
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal px-4 py-2.5 text-xs font-extrabold text-slate-950 transition-transform hover:scale-[1.01]"
            >
              <Ticket className="size-4" />
              <span>Get One More Episode with Only ₹{EXTRA_EPISODE_PRICE_INR}</span>
            </button>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                setReminderOpen(false);
                openSubModal('reminder', 'monthly_25');
              }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-slate-950 transition-transform hover:scale-[1.01]"
            >
              <Crown className="size-4 fill-current" />
              <span>
                {isPending ? 'Check Verification / WhatsApp' : `VIP Pass · ₹${MONTHLY_PRICE_INR}/mo`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setReminderOpen(false)}
              className="rounded-xl border border-line bg-canvas px-4 py-2.5 text-xs font-semibold text-muted hover:text-ink"
            >
              {remaining === 0 ? 'Wait till 12:00 AM' : 'Continue Free'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
