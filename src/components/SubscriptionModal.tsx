import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Crown,
  ImagePlus,
  LogIn,
  MessageCircle,
  Phone,
  ShieldCheck,
  Ticket,
  Tv,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  DAILY_FREE_LIMIT,
  EXTRA_EPISODE_PRICE_INR,
  MONTHLY_PRICE_INR,
  OWNER_PHONE_INTL,
  OWNER_PHONE_RAW,
  SUBSCRIPTION_DAYS,
  closeSubModal,
  getTimeUntilMidnightText,
  setSubModalPlan,
  submitPaymentConfirmation,
  useAuth,
  useDailyUsage,
  useSubModal,
  useSubscription,
} from '../lib/storage';

type Step = 'offer' | 'proof' | 'pending' | 'done';

async function compressScreenshotPreview(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(undefined);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(undefined);
      img.onload = () => {
        const maxDim = 720;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(undefined);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        resolve(dataUrl.length <= 340_000 ? dataUrl : undefined);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export function SubscriptionModal() {
  const { open, reason, selectedPlan: plan } = useSubModal();
  const { user } = useAuth();
  const {
    subscription,
    isSubscribed,
    isPending,
    isRejected,
    daysRemaining,
    expiresAtMs,
    extraCredits,
  } = useSubscription();
  const usage = useDailyUsage();

  const [step, setStep] = useState<Step>('offer');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [screenshotName, setScreenshotName] = useState('');
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [serverPreviewDataUrl, setServerPreviewDataUrl] = useState<string | undefined>(undefined);
  const [confirmedPaid, setConfirmedPaid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isExtraPlan = plan === 'extra_2';
  const activePrice = isExtraPlan ? EXTRA_EPISODE_PRICE_INR : MONTHLY_PRICE_INR;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (isSubscribed) {
      setStep('done');
    } else if (isPending && subscription?.plan === plan) {
      setStep('pending');
    } else if (isPending && reason !== 'limit') {
      setStep('pending');
    } else {
      setStep('offer');
    }
  }, [open, isSubscribed, isPending, subscription?.plan, plan, reason]);

  useEffect(() => {
    return () => {
      if (screenshotPreview) {
        URL.revokeObjectURL(screenshotPreview);
      }
    };
  }, [screenshotPreview]);

  if (!open) return null;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (screenshotPreview) {
      URL.revokeObjectURL(screenshotPreview);
    }
    setScreenshotName(file.name);
    setScreenshotPreview(URL.createObjectURL(file));
    setError(null);
    const compressed = await compressScreenshotPreview(file);
    setServerPreviewDataUrl(compressed);
  };

  const handleSubmitProof = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || user.emailVerified === false) {
      setError('Please sign in to your account first so the owner can attach this pass to your profile.');
      return;
    }
    const trimmedRef = referenceNumber.trim();
    if (!screenshotName) {
      setError(`Please upload a screenshot of your ₹${activePrice} payment first.`);
      return;
    }
    if (trimmedRef.length < 4) {
      setError('Please enter a valid payment reference / UTR number (at least 4 characters).');
      return;
    }
    if (!confirmedPaid) {
      setError('Please tick the confirmation box confirming you have completed the payment.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await submitPaymentConfirmation({
        plan,
        referenceNumber: trimmedRef,
        screenshotName,
        screenshotPreview: serverPreviewDataUrl,
        confirmedPaid: true,
      });
      setStep('pending');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit payment confirmation.');
    } finally {
      setSubmitting(false);
    }
  };

  const activePlan =
    step === 'pending' && subscription?.status === 'pending' ? subscription.plan : plan;
  const activePendingPrice =
    activePlan === 'extra_2' ? EXTRA_EPISODE_PRICE_INR : MONTHLY_PRICE_INR;
  const activeRef = referenceNumber.trim() || subscription?.referenceNumber || 'Pending-Ref';
  const whatsappText = encodeURIComponent(
    activePlan === 'extra_2'
      ? `Hello Aditya! I have paid ₹${EXTRA_EPISODE_PRICE_INR} to unlock 1 Extra Episode on Anime by Adi 💀 and confirmed my payment.\n` +
          `Name: ${user?.displayName || 'Member'}\n` +
          `Account Email: ${user?.email || 'Not signed in'}\n` +
          `Payment Reference / UTR: ${activeRef}\n` +
          `Screenshot File: ${screenshotName || subscription?.screenshotName || 'Attached'}\n` +
          `Kindly check and approve my 1 extra episode!`
      : `Hello Aditya! I have paid ₹${MONTHLY_PRICE_INR} for the Monthly VIP Royal Pass on Anime by Adi 💀 and confirmed my payment.\n` +
          `Name: ${user?.displayName || 'Member'}\n` +
          `Account Email: ${user?.email || 'Not signed in'}\n` +
          `Payment Reference / UTR: ${activeRef}\n` +
          `Screenshot File: ${screenshotName || subscription?.screenshotName || 'Attached'}\n` +
          `Kindly check and approve my VIP access!`
  );
  const whatsappUrl = `https://wa.me/${OWNER_PHONE_INTL}?text=${whatsappText}`;
  const callUrl = `tel:+${OWNER_PHONE_INTL}`;
  const midnightIn = getTimeUntilMidnightText();

  const expiryText = expiresAtMs
    ? new Date(expiresAtMs).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="royal-pass-title"
    >
      <div className="relative my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-amber-400/35 bg-surface shadow-2xl">
        {/* Top Royal Accent Bar */}
        <div
          className={`h-1.5 w-full ${
            isExtraPlan && !isSubscribed
              ? 'bg-gradient-to-r from-teal-400 via-emerald-400 to-teal-400'
              : 'bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-500'
          }`}
        />

        <button
          type="button"
          onClick={closeSubModal}
          aria-label="Close subscription popup"
          className="absolute right-3.5 top-4 z-10 grid size-8 place-items-center rounded-lg border border-line bg-canvas/70 text-muted transition-colors hover:text-ink"
        >
          <X className="size-4" />
        </button>

        <div className="p-6 sm:p-7">
          {/* Header */}
          <div className="flex flex-col items-center text-center">
            <div
              className={`grid size-14 place-items-center rounded-2xl border shadow-lg ${
                isExtraPlan && !isSubscribed
                  ? 'border-teal/40 bg-teal/15 text-teal'
                  : 'border-amber-400/40 bg-amber-500/15 text-amber-400'
              }`}
            >
              {isExtraPlan && !isSubscribed ? (
                <Ticket className="size-7" />
              ) : (
                <Crown className="size-7 fill-amber-400/20" />
              )}
            </div>

            <span
              className={`mt-3 inline-flex items-center gap-1.5 text-xs font-semibold ${
                isExtraPlan && !isSubscribed ? 'text-teal' : 'text-amber-400'
              }`}
            >
              <Crown className="size-3.5 fill-current" />
              <span>
                {isSubscribed
                  ? 'VIP Royal Pass Active'
                  : step === 'pending'
                    ? 'Pending Owner Verification'
                    : isExtraPlan
                      ? `Single Episode Pass · Just ₹${EXTRA_EPISODE_PRICE_INR}`
                      : `Monthly Subscription · Just ₹${MONTHLY_PRICE_INR}`}
              </span>
            </span>

            <h2
              id="royal-pass-title"
              className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink"
            >
              {isSubscribed
                ? 'You Are a VIP Member'
                : step === 'pending'
                  ? 'Awaiting Owner Approval'
                  : isExtraPlan
                    ? `1 Extra Episode — Only ₹${EXTRA_EPISODE_PRICE_INR}`
                    : reason === 'limit'
                      ? 'Daily Free Limit Reached'
                      : `Royal VIP Pass — ₹${MONTHLY_PRICE_INR} / Month`}
            </h2>

            {!isSubscribed && step === 'offer' && (
              <div className="mt-4 grid w-full grid-cols-2 gap-1 rounded-xl bg-canvas p-1">
                <button
                  type="button"
                  onClick={() => setSubModalPlan('extra_2')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-colors ${
                    isExtraPlan
                      ? 'bg-teal text-slate-950'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  <Ticket className="size-3.5" />
                  <span>₹{EXTRA_EPISODE_PRICE_INR} · 1 Episode</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSubModalPlan('monthly_25')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-colors ${
                    !isExtraPlan
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  <Crown className="size-3.5 fill-current" />
                  <span>₹{MONTHLY_PRICE_INR} · Monthly VIP</span>
                </button>
              </div>
            )}

            {reason === 'limit' && !isSubscribed && step !== 'pending' && (
              <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-ink">
                You&apos;ve watched{' '}
                <span className="font-bold text-amber-400">
                  {Math.min(DAILY_FREE_LIMIT, usage.watchedKeys.length)}/{DAILY_FREE_LIMIT} free videos
                </span>{' '}
                today! Pay just{' '}
                <span className="font-bold text-teal">₹{EXTRA_EPISODE_PRICE_INR}</span> to unlock 1 more episode right now, get{' '}
                <span className="font-bold text-amber-400">₹{MONTHLY_PRICE_INR}/mo VIP</span>, or wait until{' '}
                <strong className="text-ink">12:00 AM midnight</strong> (in {midnightIn}) for 5 fresh episodes.
              </p>
            )}

            {reason !== 'limit' && !isSubscribed && step !== 'pending' && (
              <p className="mt-2 max-w-md text-xs leading-relaxed text-muted sm:text-sm">
                {isExtraPlan
                  ? 'Unlock 1 single extra episode immediately after owner approval. Once you open that episode (even 10 seconds), the pass is used — free limits reset at 12:00 AM midnight.'
                  : 'Unlock 30 full days of ad-free, unlimited streaming across all Anime, Movies, and Web Series in Hindi & English Dub.'}
              </p>
            )}

            {extraCredits > 0 && !isSubscribed && (
              <div className="mt-3 w-full rounded-xl border border-teal/40 bg-teal/10 px-3.5 py-2.5 text-xs font-semibold text-teal">
                You currently have {extraCredits} extra episode pass ready to watch!
              </div>
            )}

            {isRejected && step !== 'pending' && (
              <div className="mt-3 flex w-full items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-left text-xs text-rose-200">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
                <div>
                  <p className="font-bold text-rose-300">Previous Payment Not Approved</p>
                  <p className="mt-0.5 text-rose-200/80">
                    {subscription?.adminNote ||
                      'Your previous submission was rejected by the owner. Please contact the owner on WhatsApp.'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
              {error}
            </div>
          )}

          {/* STEP 1: OFFER + QR SLOT */}
          {step === 'offer' && !isSubscribed && (
            <div className="mt-5 space-y-4">
              {isExtraPlan ? (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div className="rounded-xl border border-line bg-canvas/60 p-3 text-center">
                    <Ticket className="mx-auto size-4 text-teal" />
                    <p className="mt-1 text-xs font-bold text-ink">1 Episode</p>
                    <p className="text-[11px] text-muted">Only ₹{EXTRA_EPISODE_PRICE_INR}</p>
                  </div>
                  <div className="rounded-xl border border-line bg-canvas/60 p-3 text-center">
                    <Clock className="mx-auto size-4 text-amber-400" />
                    <p className="mt-1 text-xs font-bold text-ink">Single Play</p>
                    <p className="text-[11px] text-muted">Counts once opened</p>
                  </div>
                  <div className="rounded-xl border border-line bg-canvas/60 p-3 text-center">
                    <CheckCircle2 className="mx-auto size-4 text-teal" />
                    <p className="mt-1 text-xs font-bold text-ink">12:00 AM Reset</p>
                    <p className="text-[11px] text-muted">5 free every night</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div className="rounded-xl border border-line bg-canvas/60 p-3 text-center">
                    <Zap className="mx-auto size-4 text-amber-400" />
                    <p className="mt-1 text-xs font-bold text-ink">Zero Ads</p>
                    <p className="text-[11px] text-muted">Clean playback</p>
                  </div>
                  <div className="rounded-xl border border-line bg-canvas/60 p-3 text-center">
                    <Tv className="mx-auto size-4 text-teal" />
                    <p className="mt-1 text-xs font-bold text-ink">Unlimited Watch</p>
                    <p className="text-[11px] text-muted">No 5/day limit</p>
                  </div>
                  <div className="rounded-xl border border-line bg-canvas/60 p-3 text-center">
                    <ShieldCheck className="mx-auto size-4 text-amber-400" />
                    <p className="mt-1 text-xs font-bold text-ink">{SUBSCRIPTION_DAYS} Days VIP</p>
                    <p className="text-[11px] text-muted">Full month badge</p>
                  </div>
                </div>
              )}

              {/* Owner's UPI QR Code */}
              <div
                className={`flex flex-col items-center rounded-2xl border border-dashed bg-canvas/80 p-4 text-center ${
                  isExtraPlan ? 'border-teal/50' : 'border-amber-400/50'
                }`}
              >
                <div className="grid size-44 place-items-center rounded-xl border border-line bg-white p-2 text-slate-900 shadow-inner overflow-hidden">
                  <img
                    src="/assets/aistudio/IMAGE_2026-11-18_20_43_40_1e7ccff0.jpg"
                    alt="Owner UPI QR Code"
                    className="size-full object-contain"
                  />
                </div>
                <p className="mt-3 text-xs font-semibold text-ink">
                  Scan &amp; Pay{' '}
                  <span className={isExtraPlan ? 'text-teal' : 'text-amber-400'}>
                    ₹{activePrice}
                  </span>{' '}
                  via any UPI app
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  After paying ₹{activePrice}, upload your screenshot, confirm payment, and message the owner for quick approval.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setStep('proof')}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-slate-950 shadow-lg transition-transform hover:scale-[1.01] ${
                  isExtraPlan ? 'bg-teal' : 'bg-amber-400'
                }`}
              >
                <Upload className="size-4" />
                <span>I Have Paid ₹{activePrice} · Submit Proof</span>
              </button>
            </div>
          )}

          {/* STEP 2: SCREENSHOT UPLOAD + REFERENCE + CONFIRMATION CHECKBOX */}
          {step === 'proof' && !isSubscribed && (
            <form onSubmit={handleSubmitProof} className="mt-5 space-y-4">
              {!user && (
                <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3.5 text-left">
                  <p className="text-xs font-bold text-amber-300">
                    Sign In Required to Activate Pass
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    Please sign in with your email and password so the owner can attach your{' '}
                    {isExtraPlan ? 'extra episode' : 'VIP pass'} directly to your account.
                  </p>
                  <button
                    type="button"
                    onClick={closeSubModal}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-bold text-slate-950"
                  >
                    <LogIn className="size-3.5" />
                    <span>Go to Sign In</span>
                  </button>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-ink">
                  1. Upload ₹{activePrice} Payment Screenshot <span className="text-rose-400">*</span>
                </label>
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-amber-400/50 bg-canvas/70 p-4 text-center transition-colors hover:border-amber-400">
                  {screenshotPreview ? (
                    <div className="flex w-full items-center gap-3 text-left">
                      <img
                        src={screenshotPreview}
                        alt="Payment screenshot preview"
                        className="size-14 shrink-0 rounded-lg border border-line object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-ink">{screenshotName}</p>
                        <p className="text-[11px] text-teal">Screenshot attached · Tap to replace</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <ImagePlus className="size-6 text-amber-400" />
                      <span className="text-xs font-medium text-ink">
                        Tap to select payment screenshot
                      </span>
                      <span className="text-[11px] text-muted">PNG, JPG, WEBP accepted</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
              </div>

              <div>
                <label
                  htmlFor="payment-ref-input"
                  className="mb-1.5 block text-xs font-semibold text-ink"
                >
                  2. Payment Reference / UTR Number <span className="text-rose-400">*</span>
                </label>
                <input
                  id="payment-ref-input"
                  type="text"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="Enter 12-digit UTR or UPI Transaction ID..."
                  className="w-full rounded-xl border border-line bg-canvas px-4 py-3 font-mono text-sm text-ink placeholder:font-sans placeholder:text-muted focus:border-amber-400 focus:outline-none"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-canvas/60 p-3 text-left">
                <input
                  type="checkbox"
                  checked={confirmedPaid}
                  onChange={(e) => setConfirmedPaid(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-line accent-amber-400"
                />
                <span className="text-xs leading-relaxed text-muted">
                  I confirm that I have completed the{' '}
                  <strong className="text-ink">₹{activePrice} payment</strong>{' '}
                  {isExtraPlan
                    ? '(for 1 extra episode; valid for that 1 episode once opened).'
                    : 'and understand the owner will verify payment before activating VIP on my profile.'}
                </span>
              </label>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setStep('offer')}
                  className="rounded-xl border border-line bg-canvas px-4 py-3 text-xs font-semibold text-muted hover:text-ink"
                >
                  Back to QR
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-slate-950 transition-transform hover:scale-[1.01] disabled:opacity-60 ${
                    isExtraPlan ? 'bg-teal' : 'bg-amber-400'
                  }`}
                >
                  <CheckCircle2 className="size-4" />
                  <span>
                    {submitting
                      ? 'Submitting...'
                      : isExtraPlan
                        ? 'Confirm ₹2 & Request 1 Episode'
                        : 'Confirm Payment & Request VIP'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: PENDING VERIFICATION + WHATSAPP / CALL OWNER */}
          {step === 'pending' && !isSubscribed && (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4">
                <div className="flex items-start gap-3">
                  <Clock className="mt-0.5 size-5 shrink-0 text-amber-400" />
                  <div className="text-xs leading-relaxed text-ink">
                    <p className="font-bold text-amber-300">
                      ₹{activePendingPrice} Payment Confirmation Submitted — Verification Pending
                    </p>
                    <p className="mt-1 text-muted">
                      Plan:{' '}
                      <span className="font-semibold text-ink">
                        {activePlan === 'extra_2' ? '1 Extra Episode (₹2)' : '30-Day VIP Pass (₹25)'}
                      </span>{' '}
                      · Ref: <span className="font-mono text-ink">{activeRef}</span>
                      {subscription?.screenshotName ? ` · ${subscription.screenshotName}` : ''}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-canvas/70 p-4 text-xs leading-relaxed text-muted">
                <p className="font-bold text-ink">Please Message or Call the Owner</p>
                <p className="mt-1.5">
                  The owner will take a short moment to check whether your ₹{activePendingPrice} payment has been received. Due to a temporary technical glitch, automatic notifications are not reaching the owner&apos;s device. Please message on WhatsApp or call the owner directly below — as soon as the owner approves it,{' '}
                  {activePlan === 'extra_2' ? (
                    <strong className="text-teal">1 Extra Episode</strong>
                  ) : (
                    <strong className="text-amber-300">VIP</strong>
                  )}{' '}
                  will unlock on your screen automatically!
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-bold text-slate-950 transition-transform hover:scale-[1.01]"
                >
                  <MessageCircle className="size-4" />
                  <span>Message on WhatsApp</span>
                </a>
                <a
                  href={callUrl}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-amber-500/15 px-4 py-3 text-xs font-bold text-amber-300 transition-colors hover:bg-amber-500/25"
                >
                  <Phone className="size-4" />
                  <span>Call +91 {OWNER_PHONE_RAW}</span>
                </a>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep('proof')}
                  className="flex-1 rounded-xl border border-line bg-canvas px-4 py-2.5 text-xs font-semibold text-muted hover:text-ink"
                >
                  Resubmit Details
                </button>
                <button
                  type="button"
                  onClick={closeSubModal}
                  className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-accent-ink"
                >
                  Okay, Got It
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: ACTIVE VIP STATUS */}
          {step === 'done' && isSubscribed && (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-teal/40 bg-teal/10 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-teal" />
                  <div className="text-xs leading-relaxed text-ink">
                    <p className="font-bold text-teal">
                      VIP Royal Pass Active ({daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining)
                    </p>
                    <p className="mt-1 text-muted">
                      {subscription?.adminNote ||
                        'Your payment has been verified by the owner. Enjoy unlimited, ad-free Anime, Movies & Web Series'}
                      {expiryText ? ` until ${expiryText}` : ''}. Ref:{' '}
                      <span className="font-mono text-ink">{activeRef}</span>
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={closeSubModal}
                className="w-full rounded-xl bg-accent px-5 py-3 text-sm font-bold text-accent-ink transition-transform hover:scale-[1.01]"
              >
                Enjoy Unlimited VIP Streaming
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
