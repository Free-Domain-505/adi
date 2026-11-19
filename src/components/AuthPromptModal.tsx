import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BookmarkCheck, History, LogIn, Sparkles, UserPlus, X } from 'lucide-react';
import { signInWithGoogle } from '../lib/firebase';
import { useAuth } from '../lib/storage';
import { EyeAvatar } from './EyeAvatar';

const DISMISS_KEY = 'aadhi:authPromptDismissed:v1';

export function AuthPromptModal() {
  const { user, authReady } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAuthRoute =
    pathname === '/login' ||
    pathname === '/account' ||
    pathname.startsWith('/auth');

  useEffect(() => {
    if (!authReady || user || onAuthRoute) {
      setOpen(false);
      return;
    }

    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') {
        return;
      }
    } catch {
      // Ignore storage error
    }

    const timer = window.setTimeout(() => {
      setOpen(true);
    }, 20000);

    return () => window.clearTimeout(timer);
  }, [authReady, user, onAuthRoute]);

  const dismiss = () => {
    setOpen(false);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Ignore
    }
  };

  const handleContinue = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to sign in right now.';
      if (!msg.includes('popup-closed-by-user')) {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open || user) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Register or Login to Anime by Adi 💀"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-2xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close popup"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <EyeAvatar size="lg" />
          <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-teal">
            <Sparkles className="size-3.5" />
            <span>Welcome to Anime by Adi 💀</span>
          </span>
          <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink">
            {mode === 'register' ? 'Unlock Your Watchlist' : 'Welcome Back, Otaku'}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            {mode === 'register'
              ? 'Save your favorite anime, track episodes, and never lose your watch spot across mobile & PC.'
              : 'Sign in to jump right back into your Watch Later list and episode history.'}
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1">
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
              mode === 'register'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            <UserPlus className="size-3.5" />
            <span>Register</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
              mode === 'login'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            <LogIn className="size-3.5" />
            <span>Login</span>
          </button>
        </div>

        <div className="mt-4 space-y-2 rounded-xl border border-line bg-canvas/50 p-3.5 text-xs text-muted">
          <div className="flex items-center gap-2.5">
            <BookmarkCheck className="size-4 shrink-0 text-accent" />
            <span>Save Anime, Donghua, Manga &amp; Movies to Watch Later</span>
          </div>
          <div className="flex items-center gap-2.5">
            <History className="size-4 shrink-0 text-teal" />
            <span>Sync Watch History &amp; Progress on any device</span>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
            {error}
          </div>
        )}

        <div className="mt-5 space-y-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={handleContinue}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-accent-ink transition-transform hover:scale-[1.01] disabled:opacity-60"
          >
            {mode === 'register' ? <UserPlus className="size-4" /> : <LogIn className="size-4" />}
            <span>
              {busy
                ? 'Connecting...'
                : mode === 'register'
                  ? 'Register with Google'
                  : 'Login with Google'}
            </span>
          </button>

          <button
            type="button"
            onClick={dismiss}
            className="w-full rounded-xl border border-line bg-canvas/60 px-4 py-2.5 text-xs font-semibold text-muted transition-colors hover:text-ink"
          >
            Continue Watching as Guest
          </button>
        </div>
      </div>
    </div>
  );
}
