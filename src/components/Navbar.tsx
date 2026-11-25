import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Compass, Menu, Search } from 'lucide-react'
import { DONGHUA_LINKS, MOVIE_LINKS, NAV_LINKS } from '../lib/constants'
import { sectionOf } from '../lib/sections'
import { cn } from '../lib/utils'
import { useSearch } from '../context/SearchContext'
import { useProfile } from '../lib/profile'
import { Avatar } from './Avatar'
import { Logo } from './Logo'
import { NavbarMessagesOverlay } from './NavbarMessagesOverlay'
import { ThemeToggle } from './ThemeToggle'

/** Clean, editorial single-row top bar for desktop (`md+`). Mobile uses `MobileHeader` + `MobileDock`. */
export function Navbar({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const { openSearch } = useSearch()
  const me = useProfile()
  const { pathname, search } = useLocation()
  const section = sectionOf(pathname)
  const anime = section === 'anime'
  const donghua = section === 'donghua'
  const movies = section === 'movies'
  const links = anime
    ? NAV_LINKS
    : donghua
      ? DONGHUA_LINKS
      : movies
        ? MOVIE_LINKS
        : section === 'manga'
          ? [
              { label: 'Manga', to: '/manga' },
              { label: 'Browse', to: '/manga/browse' },
              { label: 'Find', to: '/manga/find' },
            ]
          : section === 'manhwa'
            ? [
                { label: 'Manhwa', to: '/manhwa' },
                { label: 'Browse', to: '/manhwa/browse' },
                { label: 'Find', to: '/manhwa/find' },
              ]
            : section === 'novel'
              ? [
                  { label: 'Novels', to: '/novel' },
                  { label: 'Find', to: '/novel/find' },
                ]
              : NAV_LINKS

  const [scrolled, setScrolled] = useState(false)
  const overHero =
    !scrolled &&
    (pathname === '/home' ||
      pathname === '/donghua' ||
      pathname === '/movies' ||
      /^\/movies\/(movie|tv)\/\d+$/.test(pathname))

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [pathname])

  const currentUrl = pathname + search

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 hidden h-16 transition-colors duration-200 md:block',
        overHero
          ? 'dark border-b border-transparent bg-gradient-to-b from-black/85 via-black/45 to-transparent text-white'
          : 'border-b border-border/80 bg-background/98 text-foreground',
      )}
      data-section={overHero && movies ? 'movies' : undefined}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-full max-w-7xl items-center justify-between gap-6 px-6"
      >
        {/* Left: Drawer button + brand mark */}
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Open navigation menu"
            title="All sections"
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/70 bg-card/40 text-foreground transition hover:border-foreground/40 hover:bg-card-2 active:scale-95"
          >
            <Menu className="size-4" />
          </button>
          <Logo size={32} to={anime ? '/home' : `/${section}`} />
        </div>

        {/* Center: Clean text navigation links with underline active indicator */}
        <ul className="flex min-w-0 items-center gap-1 lg:gap-2">
          {links.map((l, idx) => {
            const active = l.to.includes('?') ? currentUrl === l.to : pathname === l.to
            const hideOnMedium = idx >= 5 ? 'hidden xl:block' : idx >= 4 ? 'hidden lg:block' : 'block'
            return (
              <li key={l.to} className={cn('shrink-0', hideOnMedium)}>
                <Link
                  to={l.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative inline-flex h-16 items-center whitespace-nowrap px-2.5 text-[13px] font-medium transition-colors lg:px-3 lg:text-sm',
                    active
                      ? 'font-semibold text-foreground'
                      : overHero
                        ? 'text-white/75 hover:text-white'
                        : 'text-muted hover:text-foreground',
                  )}
                >
                  {l.label}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-accent lg:inset-x-3"
                    />
                  )}
                </Link>
              </li>
            )
          })}
        </ul>

        {/* Right: Actions & account */}
        <div className="flex shrink-0 items-center gap-2">
          {(section === 'manga' || section === 'manhwa' || movies) && (
            <Link
              to={movies ? '/movies/browse' : section === 'manhwa' ? '/manhwa/browse' : '/manga/browse'}
              className="hidden h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border/70 bg-card/50 px-3 text-xs font-semibold text-foreground transition hover:border-foreground/40 lg:inline-flex"
            >
              <Compass className="size-3.5 text-muted" />
              <span>Browse</span>
            </Link>
          )}

          {(anime || donghua || movies) && (
            <button
              type="button"
              onClick={() => openSearch()}
              aria-label={movies ? 'Search movies' : donghua ? 'Search donghua' : 'Search anime'}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition',
                overHero
                  ? 'border-white/20 bg-black/35 text-white/85 hover:border-white/40 hover:text-white'
                  : 'border-border bg-card/70 text-muted hover:border-foreground/30 hover:text-foreground',
              )}
            >
              <Search className="size-3.5 shrink-0" />
              <span className="hidden lg:inline">{movies ? 'Search movies…' : donghua ? 'Search donghua…' : 'Search anime…'}</span>
              <span className="lg:hidden">Search</span>
              <kbd className="hidden rounded border border-border/80 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted xl:inline-flex">
                {isMac ? '⌘' : 'Ctrl'} K
              </kbd>
            </button>
          )}

          <NavbarMessagesOverlay />
          <ThemeToggle />

          <Link
            to="/profile"
            aria-label="Your profile"
            title={me.name || 'Profile'}
            className="ml-0.5 shrink-0 rounded-full ring-1 ring-border/70 transition hover:ring-foreground/50 active:scale-95"
          >
            <Avatar size={32} src={me.avatar} frame={me.frame} name={me.name} />
          </Link>
        </div>
      </nav>
    </header>
  )
}
