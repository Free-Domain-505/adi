import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Bookmark,
  CheckCircle2,
  Clock,
  Crown,
  Eye,
  EyeOff,
  Heart,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Play,
  ShieldCheck,
  User,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import {
  signInWithEmailPassword,
  signOutUser,
  signUpWithEmailPassword,
} from '../lib/supabase';
import {
  MONTHLY_PRICE_INR,
  isOwnerAdmin,
  isVipFreeAccount,
  openSubModal,
  useAuth,
  useHistory,
  useSubscription,
  useWatchlist,
} from '../lib/storage';
import { HubBar } from '../components/HubBar';
import { EyeAvatar } from '../components/EyeAvatar';

export default function LoginPage() {
  const { user, authReady } = useAuth();
  const [searchParams] = useSearchParams();
  const watchlist = useWatchlist();
  const history = useHistory();
  const { subscription, isSubscribed, isPending, isRejected, daysRemaining, expiresAtMs } =
    useSubscription();
  const showAdmin = isOwnerAdmin(user);
  const vipBypass = isVipFreeAccount(user);

  const [mode, setMode] = useState<'login' | 'register'>(
    searchParams.get('mode') === 'register' ? 'register' : 'login'
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [fullNameInput, setFullNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    document.title = user ? 'My Account — Anime by Adi 💀' : 'Sign In & Register — Anime by Adi 💀';
  }, [user]);

  const stats = useMemo(() => {
    return {
      total: watchlist.length,
      watching: watchlist.filter((w) => w.status === 'watching').length,
      planning: watchlist.filter((w) => w.status === 'planning').length,
      completed: watchlist.filter((w) => w.status === 'completed').length,
      favorites: watchlist.filter((w) => w.favorite).length,
      history: history.length,
    };
  }, [watchlist, history]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    if (mode === 'register') {
      const cleanName = fullNameInput.trim();
      if (cleanName.length < 2) {
        setError('Please enter your display name (at least 2 characters).');
        return;
      }
      if (!passwordInput || passwordInput.length < 6) {
        setError('Password must be at least 6 characters long.');
        return;
      }
      if (passwordInput !== confirmPasswordInput) {
        setError('Passwords do not match. Please re-enter them carefully.');
        return;
      }

      setBusy(true);
      try {
        const res = await signUpWithEmailPassword(cleanEmail, passwordInput, cleanName);
        if (res.session) {
          setSuccessMsg('Account created successfully. Welcome to Anime by Adi 💀.');
        } else {
          setSuccessMsg(
            'Account created. Please check your inbox or sign in with your new credentials.'
          );
          setMode('login');
        }
        setPasswordInput('');
        setConfirmPasswordInput('');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Registration failed. Please try again.';
        setError(msg);
      } finally {
        setBusy(false);
      }
    } else {
      if (!passwordInput) {
        setError('Please enter your password.');
        return;
      }

      setBusy(true);
      try {
        await signInWithEmailPassword(cleanEmail, passwordInput);
        setPasswordInput('');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid email or password.';
        setError(msg);
      } finally {
        setBusy(false);
      }
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOutUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign out.');
    } finally {
      setBusy(false);
    }
  };

  // Standalone professional authentication view when not signed in
  if (!user) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_48%),radial-gradient(circle_at_bottom_right,rgba(45,212,191,0.10),transparent_45%)]"
        />

        <div className="relative z-10 grid w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl md:grid-cols-12">
          {/* Left Cinema Brand Panel */}
          <div className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-canvas/80 p-8 md:col-span-5 md:flex">
            <img
              src="/src/assets/images/aadhi_cinema_backdrop_1795006602984.jpg"
              alt="Cinema atmosphere"
              referrerPolicy="no-referrer"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/75 to-canvas/40" />

            <div className="relative flex items-center gap-3">
              <EyeAvatar size="md" />
              <span className="font-display text-xl font-extrabold tracking-tight text-ink">
                Anime by Adi 💀
              </span>
            </div>

            <div className="relative space-y-4">
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-teal/35 bg-teal/10 px-2.5 py-1 text-[11px] font-semibold text-teal">
                <ShieldCheck className="size-3.5" />
                <span>Private Member Access</span>
              </div>
              <h2 className="font-display text-2xl font-extrabold leading-tight tracking-tight text-ink">
                Stream Anime, Donghua, Series &amp; Cinema in HD.
              </h2>
              <p className="text-xs leading-relaxed text-muted">
                Sign in or create your free member account to unlock the complete library, episode tracking, synced watchlists, and multi-server HD playback.
              </p>

              <div className="space-y-2 border-t border-line pt-4 text-xs text-muted">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-3.5 shrink-0 text-teal" />
                  <span>Full TMDB Anime &amp; Donghua Season Catalog</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-3.5 shrink-0 text-teal" />
                  <span>Manga, Manhwa &amp; Light Novel Readers</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-3.5 shrink-0 text-teal" />
                  <span>Synced Progress Across Mobile &amp; Desktop</span>
                </div>
              </div>
            </div>

            <p className="relative text-[11px] text-muted/80">
              © {new Date().getFullYear()} Anime by Adi 💀 · Protected Access
            </p>
          </div>

          {/* Right Form Panel */}
          <div className="p-6 sm:p-8 md:col-span-7">
            <div className="flex items-center gap-3 md:hidden">
              <EyeAvatar size="md" />
              <div>
                <span className="font-display text-lg font-extrabold tracking-tight text-ink">
                  Anime by Adi 💀
                </span>
                <p className="text-[11px] font-medium text-teal">Member Access Required</p>
              </div>
            </div>

            <div className="mt-5 md:mt-0">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal">
                <Lock className="size-3.5" />
                <span>{mode === 'register' ? 'Create Member Account' : 'Member Sign In'}</span>
              </span>
              <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
                {mode === 'register' ? 'Join Anime by Adi 💀' : 'Welcome Back'}
              </h1>
              <p className="mt-1.5 text-xs leading-relaxed text-muted sm:text-sm">
                {mode === 'register'
                  ? 'Register with your email and password to start streaming immediately.'
                  : 'Enter your registered email and password to continue watching.'}
              </p>
            </div>

            {!authReady ? (
              <div className="mt-7 space-y-4">
                <div className="skeleton-shimmer h-10 w-full rounded-xl" />
                <div className="skeleton-shimmer h-11 w-full rounded-xl" />
                <div className="skeleton-shimmer h-11 w-full rounded-xl" />
                <div className="skeleton-shimmer h-12 w-full rounded-xl" />
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                {/* Mode Toggle */}
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-canvas p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition-colors ${
                      mode === 'login'
                        ? 'bg-accent text-accent-ink shadow-sm'
                        : 'text-muted hover:text-ink'
                    }`}
                  >
                    <LogIn className="size-3.5" />
                    <span>Sign In</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition-colors ${
                      mode === 'register'
                        ? 'bg-accent text-accent-ink shadow-sm'
                        : 'text-muted hover:text-ink'
                    }`}
                  >
                    <UserPlus className="size-3.5" />
                    <span>Create Account</span>
                  </button>
                </div>

                {error && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-300">
                    {error}
                  </div>
                )}

                {successMsg && (
                  <div className="rounded-xl border border-teal/40 bg-teal/15 px-4 py-3 text-xs font-semibold text-teal">
                    {successMsg}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  {mode === 'register' && (
                    <div>
                      <label htmlFor="auth-name" className="mb-1.5 block text-xs font-semibold text-ink">
                        Display Name
                      </label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                        <input
                          id="auth-name"
                          type="text"
                          required
                          autoComplete="name"
                          value={fullNameInput}
                          onChange={(e) => setFullNameInput(e.target.value)}
                          placeholder="Your name"
                          className="w-full rounded-xl border border-line bg-canvas py-3 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label htmlFor="auth-email" className="mb-1.5 block text-xs font-semibold text-ink">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                      <input
                        id="auth-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full rounded-xl border border-line bg-canvas py-3 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="auth-password" className="mb-1.5 block text-xs font-semibold text-ink">
                      Password
                    </label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                      <input
                        id="auth-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder={mode === 'register' ? 'Minimum 6 characters' : 'Enter your password'}
                        className="w-full rounded-xl border border-line bg-canvas py-3 pl-10 pr-11 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:text-ink"
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  {mode === 'register' && (
                    <div>
                      <label htmlFor="auth-confirm" className="mb-1.5 block text-xs font-semibold text-ink">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                        <input
                          id="auth-confirm"
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete="new-password"
                          value={confirmPasswordInput}
                          onChange={(e) => setConfirmPasswordInput(e.target.value)}
                          placeholder="Re-enter your password"
                          className="w-full rounded-xl border border-line bg-canvas py-3 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3.5 text-sm font-bold text-accent-ink shadow-lg transition-transform hover:scale-[1.01] disabled:opacity-60"
                  >
                    {mode === 'register' ? <UserPlus className="size-4" /> : <LogIn className="size-4" />}
                    <span>
                      {busy
                        ? mode === 'register'
                          ? 'Creating Account...'
                          : 'Signing In...'
                        : mode === 'register'
                          ? 'Create Account & Enter'
                          : 'Sign In & Watch'}
                    </span>
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // Signed-in Member Account Profile & Stats View
  return (
    <main className="min-h-screen bg-canvas pt-20 pb-20">
      <HubBar />

      <div className="mx-auto mt-10 max-w-xl px-4 sm:px-6">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-2xl sm:p-8">
          <div className="flex flex-col items-center text-center">
            <EyeAvatar size="xl" />
            <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-teal">
              <ShieldCheck className="size-3.5" />
              <span>Anime by Adi 💀 Profile</span>
            </span>
            <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
              My Account
            </h1>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-muted sm:text-sm">
              View your profile details, VIP status, and synced watchlist across mobile and desktop.
            </p>
          </div>

          {error && (
            <div className="mt-5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          {!authReady ? (
            <div className="mt-8 space-y-3">
              <div className="skeleton-shimmer h-20 w-full rounded-xl" />
              <div className="skeleton-shimmer h-16 w-full rounded-xl" />
            </div>
          ) : (
            <div className="mt-6 space-y-5">
              <div className="rounded-xl border border-line bg-canvas/70 p-4 space-y-3">
                <div className="flex items-center gap-3.5">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'Profile'}
                      className="size-14 rounded-xl object-cover ring-1 ring-line"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="grid size-14 place-items-center rounded-xl bg-accent text-lg font-bold text-accent-ink">
                      {(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-display text-lg font-bold text-ink">
                        {user.displayName || 'Anime by Adi 💀 Member'}
                      </p>
                      <ShieldCheck className="size-4 shrink-0 text-teal" />
                      {isSubscribed && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-400 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-950">
                          <Crown className="size-3 fill-current" />
                          <span>VIP</span>
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                      <Mail className="size-3.5 shrink-0" />
                      <span className="truncate">{user.email}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted">
                      <UserCheck className="size-3 text-teal" />
                      <span>ID: {user.uid.slice(0, 12)}...</span>
                    </p>
                  </div>
                </div>
              </div>

              {showAdmin && (
                <Link
                  to="/admin"
                  className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/50 bg-amber-400/15 p-4 transition-colors hover:bg-amber-400/20"
                >
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="size-6 shrink-0 text-amber-300" />
                    <div>
                      <p className="text-sm font-bold text-ink">Owner Payment Admin Panel</p>
                      <p className="text-xs text-muted">
                        Review user payment proofs, approve VIP accounts, or cancel requests
                      </p>
                    </div>
                  </div>
                  <span className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-950">
                    Open Panel
                  </span>
                </Link>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/35 bg-amber-500/10 p-4">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-amber-400 text-slate-950">
                    <Crown className="size-5 fill-current" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-amber-300">
                      {vipBypass
                        ? 'Permanent VIP Royal Access'
                        : isSubscribed
                          ? `VIP Active · ${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left`
                          : isPending
                            ? 'Payment Verification Pending'
                            : isRejected
                              ? 'Previous Payment Cancelled'
                              : `Free Tier · Upgrade for ₹${MONTHLY_PRICE_INR}/month`}
                    </p>
                    <p className="text-[11px] text-muted">
                      {vipBypass
                        ? 'Complimentary unlimited streaming unlocked on your account.'
                        : isSubscribed && expiresAtMs
                          ? `${subscription?.adminNote || 'VIP verified by owner.'} Valid until ${new Date(expiresAtMs).toLocaleDateString('en-IN')}`
                          : isPending
                            ? `Ref: ${subscription?.referenceNumber || ''} · Message owner on WhatsApp for quick approval.`
                            : isRejected
                              ? subscription?.adminNote || 'Please resubmit payment proof or contact owner.'
                              : '5 free videos/day · Unlock unlimited Anime, Web Series & Movies'}
                    </p>
                  </div>
                </div>
                {!vipBypass && (
                  <button
                    type="button"
                    onClick={() => openSubModal('crown')}
                    className="rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-bold text-slate-950 transition-transform hover:scale-[1.02]"
                  >
                    {isSubscribed
                      ? 'VIP Details'
                      : isPending
                        ? 'View / WhatsApp'
                        : isRejected
                          ? 'Resubmit Proof'
                          : `Get ₹${MONTHLY_PRICE_INR} Pass`}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Link
                  to="/list"
                  className="rounded-xl border border-line bg-canvas/50 p-3.5 transition-colors hover:border-accent/50"
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                    <Bookmark className="size-3.5 text-accent" />
                    <span>Saved List</span>
                  </div>
                  <p className="mt-1.5 font-mono text-2xl font-bold text-ink tabular-nums">
                    {stats.total}
                  </p>
                </Link>

                <Link
                  to="/list"
                  className="rounded-xl border border-line bg-canvas/50 p-3.5 transition-colors hover:border-accent/50"
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                    <Play className="size-3.5 text-teal" />
                    <span>Watching</span>
                  </div>
                  <p className="mt-1.5 font-mono text-2xl font-bold text-ink tabular-nums">
                    {stats.watching}
                  </p>
                </Link>

                <Link
                  to="/list"
                  className="rounded-xl border border-line bg-canvas/50 p-3.5 transition-colors hover:border-accent/50"
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                    <CheckCircle2 className="size-3.5 text-accent" />
                    <span>Completed</span>
                  </div>
                  <p className="mt-1.5 font-mono text-2xl font-bold text-ink tabular-nums">
                    {stats.completed}
                  </p>
                </Link>

                <Link
                  to="/list"
                  className="rounded-xl border border-line bg-canvas/50 p-3.5 transition-colors hover:border-accent/50"
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                    <Heart className="size-3.5 text-rose-400" />
                    <span>Favorites</span>
                  </div>
                  <p className="mt-1.5 font-mono text-2xl font-bold text-ink tabular-nums">
                    {stats.favorites}
                  </p>
                </Link>

                <Link
                  to="/list"
                  className="col-span-2 rounded-xl border border-line bg-canvas/50 p-3.5 transition-colors hover:border-accent/50 sm:col-span-2"
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                    <Clock className="size-3.5 text-teal" />
                    <span>Watch &amp; Read History</span>
                  </div>
                  <p className="mt-1.5 font-mono text-2xl font-bold text-ink tabular-nums">
                    {stats.history}
                  </p>
                </Link>
              </div>

              <div className="flex flex-col gap-2.5 sm:flex-row">
                <Link
                  to="/list"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink transition-transform hover:scale-[1.01]"
                >
                  <Bookmark className="size-4" />
                  <span>Manage My List</span>
                </Link>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSignOut}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-canvas px-4 py-3 text-sm font-semibold text-ink transition-colors hover:border-rose-400/50 hover:text-rose-400 disabled:opacity-50"
                >
                  <LogOut className="size-4" />
                  <span>{busy ? 'Signing out...' : 'Sign Out'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
