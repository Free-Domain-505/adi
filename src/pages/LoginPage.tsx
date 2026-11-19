import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Bookmark,
  CheckCircle2,
  Clock,
  Crown,
  Heart,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  Play,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { signInWithGoogle, signOutUser } from '../lib/firebase';
import {
  MONTHLY_PRICE_INR,
  OWNER_ADMIN_EMAIL,
  isOwnerAdmin,
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
  const watchlist = useWatchlist();
  const history = useHistory();
  const { subscription, isSubscribed, isPending, isRejected, daysRemaining, expiresAtMs } =
    useSubscription();
  const showAdmin = isOwnerAdmin(user);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Manual email & password state
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');

  useEffect(() => {
    document.title = user ? 'My Account — Anime by Adi 💀' : 'Login & Register — Anime by Adi 💀';
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

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to sign in right now.';
      if (!msg.includes('popup-closed-by-user')) {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    if (mode === 'register') {
      if (cleanEmail === OWNER_ADMIN_EMAIL.toLowerCase()) {
        window.location.reload();
        return;
      }
      if (!passwordInput || passwordInput.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (passwordInput !== confirmPasswordInput) {
        setError('Passwords do not match! Please re-type correctly.');
        return;
      }

      setBusy(true);
      try {
        const accounts = JSON.parse(localStorage.getItem('aadhi:manualAccounts:v1') || '{}');
        if (accounts[cleanEmail]) {
          setError('This email is already registered! Please switch to Login.');
          setBusy(false);
          return;
        }
        accounts[cleanEmail] = {
          email: cleanEmail,
          password: passwordInput,
          createdAt: Date.now(),
        };
        localStorage.setItem('aadhi:manualAccounts:v1', JSON.stringify(accounts));

        setSuccessMsg('Registration successful! You can now log in with your email and password.');
        setMode('login');
        setPasswordInput('');
        setConfirmPasswordInput('');
      } catch {
        setError('Registration failed. Please try again.');
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
        const accounts = JSON.parse(localStorage.getItem('aadhi:manualAccounts:v1') || '{}');
        const account = accounts[cleanEmail];

        if (!account || account.password !== passwordInput) {
          setError('Invalid email or password. If you registered with Google, use "Login with Google".');
          setBusy(false);
          return;
        }

        if (cleanEmail === OWNER_ADMIN_EMAIL.toLowerCase()) {
          await signInWithGoogle();
        } else {
          setSuccessMsg(`Welcome back, ${cleanEmail}! Confirmed and signed in successfully.`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed.');
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

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-20">
      <HubBar />

      <div className="mx-auto mt-10 max-w-xl px-4 sm:px-6">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-2xl sm:p-8">
          <div className="flex flex-col items-center text-center">
            <EyeAvatar size="xl" />
            <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-teal">
              <Sparkles className="size-3.5" />
              <span>{user ? 'Anime by Adi 💀 Profile' : 'Anime by Adi 💀 Member Access'}</span>
            </span>
            <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
              {user ? 'My Account' : mode === 'register' ? 'Join Anime by Adi 💀' : 'Sign In to Anime by Adi 💀'}
            </h1>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-muted sm:text-sm">
              {user
                ? 'View your profile details and synced Watch Later list across mobile and desktop.'
                : 'Choose your preferred login or manual registration option below.'}
            </p>
          </div>

          {error && (
            <div className="mt-5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="mt-5 rounded-xl border border-teal/40 bg-teal/15 px-4 py-3 text-xs font-semibold text-teal">
              {successMsg}
            </div>
          )}

          {!authReady ? (
            <div className="mt-8 h-12 w-full animate-pulse rounded-xl bg-surface-2" />
          ) : user ? (
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
                      {isSubscribed
                        ? `VIP Active · ${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left`
                        : isPending
                          ? 'Payment Verification Pending'
                          : isRejected
                            ? 'Previous Payment Cancelled'
                            : `Free Tier · Upgrade for ₹${MONTHLY_PRICE_INR}/month`}
                    </p>
                    <p className="text-[11px] text-muted">
                      {isSubscribed && expiresAtMs
                        ? `${subscription?.adminNote || 'VIP verified by owner.'} Valid until ${new Date(expiresAtMs).toLocaleDateString('en-IN')}`
                        : isPending
                          ? `Ref: ${subscription?.referenceNumber || ''} · Message owner on WhatsApp for quick approval.`
                          : isRejected
                            ? subscription?.adminNote || 'Please resubmit payment proof or contact owner.'
                            : '5 free videos/day · Unlock unlimited Anime, Web Series & Movies'}
                    </p>
                  </div>
                </div>
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
          ) : (
            <div className="mt-6 space-y-5">
              {/* Option 1: Register with Google */}
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleGoogleSignIn}
                  className="inline-flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface px-5 py-3.5 text-sm font-bold text-ink shadow-sm transition-transform hover:scale-[1.01] disabled:opacity-60"
                >
                  <LogIn className="size-4 text-accent" />
                  <span>{busy ? 'Connecting...' : 'Register / Login with Google'}</span>
                </button>
              </div>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-line"></div>
                <span className="flex-shrink mx-4 text-xs text-muted font-medium">OR MANUAL EMAIL &amp; PASSWORD</span>
                <div className="flex-grow border-t border-line"></div>
              </div>

              {/* Mode switch for manual form */}
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setSuccessMsg(null);
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                    mode === 'login' ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
                  }`}
                >
                  <LogIn className="size-3.5" />
                  <span>Manual Login</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                    setSuccessMsg(null);
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                    mode === 'register' ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
                  }`}
                >
                  <UserPlus className="size-3.5" />
                  <span>Manual Register</span>
                </button>
              </div>

              {/* Option 3: Manual Email, Password, Re-type Password, Confirm */}
              <form onSubmit={handleManualSubmit} className="space-y-3.5 rounded-xl border border-line bg-canvas/40 p-4">
                <p className="text-xs font-bold text-ink">
                  {mode === 'register' ? 'Create Account with Email & Password' : 'Sign In with Email & Password'}
                </p>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Starting Email (ईमेल)</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                    <input
                      type="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="your.email@gmail.com"
                      className="w-full rounded-xl border border-line bg-canvas py-2.5 pl-10 pr-3.5 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Password (पासवर्ड)</label>
                  <div className="relative">
                    <KeyRound className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                    <input
                      type="password"
                      required
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full rounded-xl border border-line bg-canvas py-2.5 pl-10 pr-3.5 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>

                {mode === 'register' && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted">Re-type Password (री-टाइप पासवर्ड)</label>
                    <div className="relative">
                      <KeyRound className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                      <input
                        type="password"
                        required
                        value={confirmPasswordInput}
                        onChange={(e) => setConfirmPasswordInput(e.target.value)}
                        placeholder="Re-type password to verify"
                        className="w-full rounded-xl border border-line bg-canvas py-2.5 pl-10 pr-3.5 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-accent-ink shadow-lg transition-transform hover:scale-[1.01] disabled:opacity-60"
                >
                  <CheckCircle2 className="size-4" />
                  <span>{busy ? 'Please wait...' : mode === 'register' ? 'Confirm & Register' : 'Confirm & Login'}</span>
                </button>
              </form>

              {/* Option 2: Continue Watching as Guest */}
              <div className="text-center pt-2">
                <Link
                  to="/home"
                  className="inline-flex items-center justify-center rounded-xl border border-line bg-canvas px-4 py-3 text-xs font-semibold text-muted transition-colors hover:text-ink w-full"
                >
                  Continue Watching as Guest
                </Link>
              </div>

              <div className="rounded-xl border border-line bg-canvas/50 p-3 text-[11px] leading-relaxed text-muted text-center">
                Owner account requires authorized Owner Login.
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

