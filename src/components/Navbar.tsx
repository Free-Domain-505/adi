import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bookmark, Crown, Home, Lock, LogIn, Search, ShieldCheck, Tv, User } from 'lucide-react';
import { isOwnerAdmin, openSubModal, useAuth, useSubscription } from '../lib/storage';
import { EyeAvatar } from './EyeAvatar';

interface NavbarProps {
  onOpenSearch: () => void;
}

const NAV_LINKS = [
  {
    label: 'Home',
    to: '/home',
    match: (p: string) =>
      p === '/' ||
      p === '/home' ||
      p.startsWith('/anime') ||
      p.startsWith('/watch') ||
      p.startsWith('/donghua') ||
      p.startsWith('/browse') ||
      p.startsWith('/trending') ||
      p.startsWith('/popular') ||
      p.startsWith('/top') ||
      p.startsWith('/schedule'),
  },
  {
    label: 'Manga',
    to: '/manga',
    match: (p: string) => p.startsWith('/manga') || p.startsWith('/manhwa'),
  },
  {
    label: 'Novels',
    to: '/novel',
    match: (p: string) => p.startsWith('/novel'),
  },
  {
    label: 'Movies',
    to: '/movies',
    match: (p: string) => p.startsWith('/movies') && !p.startsWith('/movies/tv') && !p.startsWith('/movies/watch/tv'),
  },
  {
    label: 'Web Series',
    to: '/series',
    match: (p: string) =>
      p.startsWith('/series') ||
      p.startsWith('/movies/tv') ||
      p.startsWith('/movies/watch/tv'),
  },
  {
    label: 'My List',
    to: '/list',
    match: (p: string) => p.startsWith('/list'),
  },
];

export function Navbar({ onOpenSearch }: NavbarProps) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { isSubscribed, isPending } = useSubscription();
  const showAdmin = isOwnerAdmin(user);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const onAccountRoute =
    pathname === '/account' || pathname === '/login' || pathname.startsWith('/auth');

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-200 ${
          scrolled
            ? 'border-b border-line bg-canvas/90 backdrop-blur-md'
            : 'bg-gradient-to-b from-canvas/85 via-canvas/45 to-transparent'
        }`}
      >
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6">
          {/* Zone 1: Brand Avatar with Crown Badge directly underneath + Wordmark */}
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex flex-col items-center justify-center gap-0.5">
              <Link
                to="/home"
                aria-label="Anime by Adi Home"
                className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <EyeAvatar size="sm" />
              </Link>
              <button
                type="button"
                onClick={() => openSubModal('crown')}
                title={
                  isSubscribed
                    ? 'VIP Royal Pass Active'
                    : isPending
                      ? 'Verification Pending · Message Owner'
                      : 'Monthly Subscription · Just ₹25'
                }
                aria-label={
                  isSubscribed
                    ? 'VIP Royal Pass Active'
                    : isPending
                      ? 'Verification Pending'
                      : 'Monthly Subscription ₹25'
                }
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold leading-none transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  isSubscribed
                    ? 'border-amber-400 bg-amber-400 text-slate-950 shadow-sm'
                    : isPending
                      ? 'border-amber-400/70 bg-amber-500/25 text-amber-200'
                      : 'border-amber-400/70 bg-amber-500/20 text-amber-300 hover:bg-amber-400 hover:text-slate-950'
                }`}
              >
                <Crown className="size-2.5 fill-current" />
                <span>{isSubscribed ? 'VIP' : isPending ? 'WAIT' : '₹25'}</span>
              </button>
            </div>

            <Link
              to="/home"
              className="font-display text-base font-extrabold tracking-tight text-ink whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-xl"
            >
              Anime by Adi <span aria-hidden="true">💀</span>
            </Link>
          </div>

          {/* Zone 2: Single-line nav links including Web Series */}
          <nav aria-label="Primary" className="hidden items-center gap-5 md:flex lg:gap-7">
            {NAV_LINKS.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`relative py-1 text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 ${
                    active ? 'text-accent' : 'text-muted hover:text-ink'
                  }`}
                >
                  {item.label}
                  {active && (
                    <span className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-accent" />
                  )}
                </Link>
              );
            })}
            {showAdmin ? (
              <Link
                to="/admin"
                className={`relative inline-flex items-center gap-1.5 py-1 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors duration-150 ${
                  pathname.startsWith('/admin') ? 'text-amber-300' : 'text-amber-300/90 hover:text-amber-200'
                }`}
              >
                <ShieldCheck className="size-3.5" />
                <span>Admin</span>
                {pathname.startsWith('/admin') && (
                  <span className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-amber-400" />
                )}
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
                className="inline-flex cursor-not-allowed select-none items-center gap-1 py-1 text-sm font-medium text-muted/45 whitespace-nowrap shrink-0"
              >
                <Lock className="size-3.5" />
                <span>Admin</span>
              </button>
            )}
          </nav>

          {/* Zone 3: Search + Admin + Account / Login */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onOpenSearch}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface/85 px-3 py-2 text-sm font-medium text-ink whitespace-nowrap shrink-0 transition-colors duration-150 hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-3.5"
            >
              <Search className="size-4 text-accent" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted lg:inline-block">
                ⌘K
              </kbd>
            </button>

            {showAdmin ? (
              <Link
                to="/admin"
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-bold whitespace-nowrap shrink-0 transition-colors ${
                  pathname.startsWith('/admin')
                    ? 'border-amber-400 bg-amber-400 text-slate-950'
                    : 'border-amber-400/50 bg-amber-500/15 text-amber-300 hover:bg-amber-400 hover:text-slate-950'
                }`}
              >
                <ShieldCheck className="size-3.5" />
                <span className="hidden sm:inline">Admin</span>
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
                title="Admin Locked"
                className="inline-flex cursor-not-allowed select-none items-center gap-1 rounded-lg border border-line/60 bg-surface/40 px-2.5 py-2 text-xs font-semibold text-muted/45 whitespace-nowrap shrink-0 md:hidden"
              >
                <Lock className="size-3.5" />
                <span className="hidden sm:inline">Admin</span>
              </button>
            )}

            <Link
              to={user ? '/account' : '/login'}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors duration-150 ${
                onAccountRoute
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line bg-surface/85 text-ink hover:border-accent/50 hover:text-accent'
              }`}
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
                    <User className="size-4 text-teal" />
                  )}
                  <span className="max-w-[96px] truncate">
                    {user.displayName?.split(' ')[0] || 'Account'}
                  </span>
                  {isSubscribed && (
                    <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-slate-950">
                      VIP
                    </span>
                  )}
                </>
              ) : (
                <>
                  <LogIn className="size-4 text-accent" />
                  <span>Login</span>
                </>
              )}
            </Link>
          </div>
        </div>
      </header>

      {/* Compact Mobile Bottom Bar */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t border-line bg-canvas/95 backdrop-blur-md md:hidden"
      >
        <Link
          to="/home"
          className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium ${
            pathname === '/home' || pathname === '/' ? 'text-accent' : 'text-muted'
          }`}
        >
          <Home className="size-4" />
          <span>Home</span>
        </Link>
        <Link
          to="/series"
          className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium ${
            pathname.startsWith('/series') ? 'text-accent' : 'text-muted'
          }`}
        >
          <Tv className="size-4" />
          <span>Series</span>
        </Link>
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium text-muted"
        >
          <Search className="size-4" />
          <span>Search</span>
        </button>
        <Link
          to="/list"
          className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium ${
            pathname.startsWith('/list') ? 'text-accent' : 'text-muted'
          }`}
        >
          <Bookmark className="size-4" />
          <span>My List</span>
        </Link>
        <Link
          to={user ? '/account' : '/login'}
          className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium ${
            onAccountRoute ? 'text-accent' : 'text-muted'
          }`}
        >
          <User className="size-4" />
          <span>{user ? 'Account' : 'Login'}</span>
        </Link>
        {showAdmin ? (
          <Link
            to="/admin"
            className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-semibold ${
              pathname.startsWith('/admin') ? 'text-amber-300' : 'text-amber-300/90'
            }`}
          >
            <ShieldCheck className="size-4" />
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
            className="flex cursor-not-allowed select-none flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium text-muted/40"
          >
            <Lock className="size-4" />
            <span>Admin</span>
          </button>
        )}
      </nav>
    </>
  );
}
