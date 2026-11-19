import { Link, useLocation } from 'react-router-dom';
import { Lock, LogIn, Moon, ShieldCheck, Sun, UserCheck } from 'lucide-react';
import { isOwnerAdmin, toggleTheme, useAuth, useTheme } from '../lib/storage';

const HUBS = [
  { label: 'Anime', to: '/home', match: (p: string) => p === '/home' || p === '/' || p.startsWith('/anime') || p.startsWith('/watch') },
  { label: 'Donghua', to: '/donghua', match: (p: string) => p.startsWith('/donghua') },
  { label: 'Manga', to: '/manga', match: (p: string) => p.startsWith('/manga') },
  { label: 'Manhwa', to: '/manhwa', match: (p: string) => p.startsWith('/manhwa') },
  { label: 'Light Novels', to: '/novel', match: (p: string) => p.startsWith('/novel') },
  { label: 'Movies', to: '/movies', match: (p: string) => p.startsWith('/movies') && !p.startsWith('/movies/tv') && !p.startsWith('/movies/watch/tv') },
  { label: 'Web Series', to: '/series', match: (p: string) => p.startsWith('/series') || p.startsWith('/movies/tv') || p.startsWith('/movies/watch/tv') },
  { label: 'Schedule', to: '/schedule', match: (p: string) => p.startsWith('/schedule') },
  { label: 'Catalog', to: '/browse', match: (p: string) => p === '/browse' || p === '/trending' || p === '/popular' || p === '/top' },
];

export function HubBar() {
  const { pathname } = useLocation();
  const theme = useTheme();
  const { user } = useAuth();
  const showAdmin = isOwnerAdmin(user);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
      <div className="flex items-center justify-between gap-4 border-b border-line pb-3">
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
          {HUBS.map((hub) => {
            const active = hub.match(pathname);
            return (
              <Link
                key={hub.to}
                to={hub.to}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors duration-150 ${
                  active
                    ? 'bg-accent text-accent-ink'
                    : 'bg-surface text-muted hover:bg-surface-2 hover:text-ink'
                }`}
              >
                {hub.label}
              </Link>
            );
          })}
          {showAdmin ? (
            <Link
              to="/admin"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold whitespace-nowrap shrink-0 transition-colors duration-150 ${
                pathname.startsWith('/admin')
                  ? 'border-amber-400 bg-amber-400 text-slate-950'
                  : 'border-amber-400/50 bg-amber-500/15 text-amber-300 hover:bg-amber-400 hover:text-slate-950'
              }`}
            >
              <ShieldCheck className="size-3.5" />
              <span>Admin</span>
            </Link>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              tabIndex={-1}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              title="Admin (Owner Locked)"
              className="inline-flex cursor-not-allowed select-none items-center gap-1.5 rounded-lg border border-line/60 bg-surface/50 px-3 py-1.5 text-xs font-semibold text-muted/45 whitespace-nowrap shrink-0"
            >
              <Lock className="size-3.5" />
              <span>Admin</span>
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            to={user ? '/account' : '/login'}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink whitespace-nowrap transition-colors duration-150 hover:border-accent/50 hover:text-accent"
          >
            {user ? (
              <>
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Account'}
                    className="size-4 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <UserCheck className="size-3.5 text-teal" />
                )}
                <span className="max-w-[90px] truncate hidden sm:inline">
                  {user.displayName?.split(' ')[0] || 'Account'}
                </span>
              </>
            ) : (
              <>
                <LogIn className="size-3.5 text-accent" />
                <span>Login</span>
              </>
            )}
          </Link>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted whitespace-nowrap transition-colors duration-150 hover:text-ink"
          >
            {theme === 'dark' ? <Sun className="size-3.5 text-accent" /> : <Moon className="size-3.5 text-accent" />}
            <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
