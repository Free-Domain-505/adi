import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, Search, Users } from 'lucide-react'
import { Logo } from './Logo'
import { Avatar } from './Avatar'
import { sectionOf } from '../lib/sections'
import { cn } from '../lib/utils'
import { useProfile } from '../lib/profile'
import { useSearch } from '../context/SearchContext'

interface MobileHeaderProps {
  onOpenDrawer: () => void
}

export function MobileHeader({ onOpenDrawer }: MobileHeaderProps) {
  const me = useProfile()
  const { openSearch } = useSearch()
  const { pathname } = useLocation()
  const section = sectionOf(pathname)
  const homeTo = section === 'anime' ? '/home' : `/${section}`

  const [scrolled, setScrolled] = useState(false)
  const overHero =
    !scrolled &&
    (pathname === '/home' ||
      pathname === '/donghua' ||
      pathname === '/movies' ||
      /^\/movies\/(movie|tv)\/\d+$/.test(pathname))

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [pathname])

  const iconBtnCls = overHero
    ? 'border-white/25 bg-black/45 text-white hover:border-white/45 hover:bg-black/65 hover:text-white'
    : 'border-border bg-card text-muted hover:text-foreground'

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between px-3 transition-colors duration-200 md:hidden',
        overHero
          ? 'dark border-b border-transparent bg-gradient-to-b from-black/85 via-black/45 to-transparent text-white'
          : 'border-b border-border bg-background/98 text-foreground',
      )}
      data-section={overHero && section === 'movies' ? 'movies' : undefined}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-label="Open navigation menu"
          className={cn('grid size-9 place-items-center rounded-xl border transition', iconBtnCls)}
        >
          <Menu className="size-5" />
        </button>
        <Logo size={28} to={homeTo} textClassName="text-sm font-bold" />
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => openSearch()}
          aria-label="Search"
          className={cn('grid size-9 place-items-center rounded-xl border transition', iconBtnCls)}
        >
          <Search className="size-4" />
        </button>
        <Link
          to="/community"
          aria-label="Community Lounge"
          className={cn(
            'grid size-9 place-items-center rounded-xl border transition active:scale-90',
            iconBtnCls,
            pathname.startsWith('/community') && 'border-accent text-accent',
          )}
        >
          <Users className="size-4.5" />
        </Link>
        <Link to="/profile" aria-label="Profile" className="ml-1 shrink-0 rounded-full active:scale-90 transition">
          <Avatar size={30} src={me.avatar} frame={me.frame} name={me.name} />
        </Link>
      </div>
    </header>
  )
}
