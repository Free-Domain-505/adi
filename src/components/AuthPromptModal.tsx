import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookmarkCheck, History, LogIn, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useAuth } from '../lib/storage';
import { EyeAvatar } from './EyeAvatar';

const DISMISS_KEY = 'aadhi:authPromptDismissed:v1';

export function AuthPromptModal() {
  const { user, authReady } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

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
    }, 15000);

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

  if (!open || user) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign In or Register to Anime by Adi 💀"
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
            <ShieldCheck className="size-3.5" />
            <span>Member Access</span>
          </span>
          <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink">
            Sign In to Continue
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Create an account or sign in with your email and password to sync your watchlist and stream across all devices.
          </p>
        </div>

        <div className="mt-5 space-y-2 rounded-xl border border-line bg-canvas/50 p-3.5 text-xs text-muted">
          <div className="flex items-center gap-2.5">
            <BookmarkCheck className="size-4 shrink-0 text-accent" />
            <span>Save Anime, Donghua, Manga &amp; Movies to My List</span>
          </div>
          <div className="flex items-center gap-2.5">
            <History className="size-4 shrink-0 text-teal" />
            <span>Sync Watch History &amp; Progress across devices</span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <Link
            to="/login"
            onClick={dismiss}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-xs font-bold text-accent-ink transition-transform hover:scale-[1.01]"
          >
            <LogIn className="size-4" />
            <span>Sign In</span>
          </Link>
          <Link
            to="/login?mode=register"
            onClick={dismiss}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-canvas px-4 py-3 text-xs font-bold text-ink transition-colors hover:border-accent/50"
          >
            <UserPlus className="size-4" />
            <span>Register</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
