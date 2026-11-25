import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen,
  Calendar,
  Check,
  Clapperboard,
  Compass,
  Copy,
  Film,
  History,
  MessageSquare,
  Palette,
  Play,
  Quote,
  Search,
  Share2,
  ShieldCheck,
  Star,
  User,
  Users,
} from 'lucide-react'
import { Avatar } from './Avatar'
import { StyledDisplayName } from './StyledDisplayName'
import type { PublicMediaItem, PublicUserData } from '../lib/profile'
import { cn } from '../lib/utils'

type TabKey = 'watchlist' | 'history' | 'reading' | 'about'

const springTransition = { type: 'spring', stiffness: 300, damping: 28 } as const

export function PublicProfileCard({
  data,
  isSelf = false,
}: {
  data: PublicUserData
  isSelf?: boolean
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('watchlist')
  const [copied, setCopied] = useState(false)
  const [watchlistFilter, setWatchlistFilter] = useState<string>('all')
  const [readingFilter, setReadingFilter] = useState<'all' | 'manhwa' | 'manga' | 'novel'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const {
    profile,
    username,
    watchlistCount = 0,
    historyCount = 0,
    readingCount = 0,
    watchlistItems = [],
    historyItems = [],
    readingItems = [],
    createdAt,
  } = data

  const totalTitlesLogged = watchlistCount + historyCount + readingCount

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/u/${username}`
    const name = profile.name || username
    try {
      const { shareCard } = await import('../lib/shareCard')
      await shareCard(
        {
          kind: 'profile',
          eyebrow: 'Join me on AnimeStream',
          title: name,
          subtitle: `@${username}`,
          image: profile.banner,
          avatar: profile.avatar,
          initial: name,
        },
        url,
        `${name} (@${username}) on AnimeStream — explore my anime watchlist & manga shelf!`,
      )
    } catch {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url)
      }
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }

  // Filtered watchlist
  const filteredWatchlist = useMemo(() => {
    let list = watchlistItems
    if (watchlistFilter !== 'all') {
      list = list.filter((item) => (item.status || '').toLowerCase() === watchlistFilter.toLowerCase())
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter((item) => item.title.toLowerCase().includes(q))
    }
    return list
  }, [watchlistItems, watchlistFilter, searchQuery])

  // Filtered history
  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return historyItems
    const q = searchQuery.toLowerCase().trim()
    return historyItems.filter((item) => item.title.toLowerCase().includes(q))
  }, [historyItems, searchQuery])

  // Filtered reading
  const filteredReading = useMemo(() => {
    let list = readingItems
    if (readingFilter !== 'all') {
      list = list.filter((item) => item.kind === readingFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter((item) => item.title.toLowerCase().includes(q))
    }
    return list
  }, [readingItems, readingFilter, searchQuery])

  const readingCounts = useMemo(() => {
    return {
      all: readingItems.length,
      manhwa: readingItems.filter((x) => x.kind === 'manhwa').length,
      manga: readingItems.filter((x) => x.kind === 'manga').length,
      novel: readingItems.filter((x) => x.kind === 'novel').length,
    }
  }, [readingItems])

  return (
    <div className="w-full min-w-0 space-y-6">
      {/* 1. Cinematic Hero Banner & Identity Header */}
      <div className="relative overflow-hidden rounded-3xl border border-border bg-black shadow-2xl">
        {/* Banner image with seamless black bottom edge fill */}
        <div className="relative h-48 w-full overflow-hidden bg-black sm:h-64 md:h-72">
          {profile.banner ? (
            <img
              src={profile.banner}
              alt=""
              referrerPolicy="no-referrer"
              className="block size-full object-cover object-center transition duration-700 hover:scale-105"
            />
          ) : (
            <div className="size-full bg-gradient-to-tr from-accent/20 via-neutral-950 to-black" />
          )}

          {/* Top & side vignette */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/35" />
          {/* Flush bottom edge fill + subpixel overlap so zero gap ever appears at any DPR */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black from-25% via-black/85 via-60% to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 -bottom-1 h-3 bg-black" />

          {/* Top Floating Actions: Share Profile */}
          <div className="absolute right-3.5 top-3.5 z-10 flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyLink}
              aria-label="Share profile"
              className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-full border border-white/20 bg-black/65 px-3 sm:px-4 text-xs font-semibold text-white backdrop-blur-md transition hover:border-white/40 hover:bg-black/85 active:scale-95"
            >
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Share2 className="size-3.5" />}
              <span className="hidden sm:inline">{copied ? 'Link Copied!' : 'Share Profile'}</span>
              <span className="sm:hidden">{copied ? 'Copied' : 'Share'}</span>
            </button>
          </div>
        </div>

        {/* Identity & Actions Bar */}
        <div className="relative -mt-px bg-gradient-to-b from-black via-card to-card px-5 pb-6 sm:px-8 sm:pb-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            {/* Avatar + Main Details */}
            <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
              {/* Avatar with Animated Frame */}
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 280, damping: 20 }}
                className="relative -mt-16 self-start sm:-mt-20 shrink-0 select-none"
              >
                <div className="relative rounded-full ring-4 ring-black shadow-2xl">
                  <Avatar
                    size={116}
                    src={profile.avatar}
                    frame={profile.frame}
                    name={profile.name || username}
                    animateFrame
                    className="size-full rounded-full"
                  />
                </div>
              </motion.div>

              {/* Display Name, Handle & Metadata */}
              <div className="min-w-0 flex-1 space-y-1 pb-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="max-w-full break-words font-display text-2xl font-black leading-tight tracking-tight text-foreground sm:text-3xl">
                    <StyledDisplayName
                      name={profile.name || username}
                      styleSpec={profile.nameStyle ?? null}
                      isSelf={isSelf}
                    />
                  </h1>
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-3 py-0.5 text-xs font-bold text-accent">
                    @{username}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card-2 px-2.5 py-0.5 text-[11px] font-bold text-muted">
                    <ShieldCheck className="size-3 text-accent" /> Verified Member
                  </span>
                </div>

                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted">
                  <span>Otaku Explorer</span>
                  <span>•</span>
                  <span>{totalTitlesLogged} media titles logged</span>
                  {createdAt && (
                    <span className="inline-flex items-center gap-1.5">
                      <span>•</span>
                      <Calendar className="size-3" />
                      <span>Joined {new Date(createdAt).getFullYear()}</span>
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Action Buttons Cluster */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1 sm:pt-0">
              {isSelf ? (
                <>
                  <Link
                    to="/profile"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-95"
                  >
                    <Palette className="size-4" />
                    <span>Edit Profile</span>
                  </Link>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border bg-card-2 px-4 text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent active:scale-95"
                  >
                    <Copy className="size-4" />
                    <span>{copied ? 'Copied' : 'Copy Link'}</span>
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to={`/messages/${username}`}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-95"
                  >
                    <MessageSquare className="size-4" />
                    <span>Send Message</span>
                  </Link>
                  <Link
                    to={`/watchparty`}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border bg-card-2 px-4 text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent active:scale-95"
                  >
                    <Users className="size-4 text-accent" />
                    <span>Watch Together</span>
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Bio Quote (if available) */}
          {profile.bio ? (
            <div className="mt-5 rounded-2xl border border-border/70 bg-card-2/50 p-4 sm:p-5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                <Quote className="size-3 text-accent" />
                <span>Biography</span>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm font-medium leading-relaxed text-foreground/90">
                “{profile.bio}”
              </p>
            </div>
          ) : isSelf ? (
            <div className="mt-5 flex items-center justify-between rounded-2xl border border-dashed border-border/80 bg-card-2/30 px-4 py-3 text-xs text-muted">
              <span>You haven’t added a bio yet. Introduce your anime tastes to the community!</span>
              <Link to="/profile" className="font-semibold text-accent hover:underline">
                Add Bio →
              </Link>
            </div>
          ) : null}

          {/* 2. Interactive KPI Stats Strip (Clicking a card switches to that tab) */}
          <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('watchlist')}
              className={cn(
                'group relative flex min-w-0 w-full flex-col items-start overflow-hidden rounded-2xl border p-2.5 sm:p-3.5 text-left transition duration-200 active:scale-[0.98]',
                activeTab === 'watchlist'
                  ? 'border-accent bg-accent/10 shadow-md shadow-accent/5'
                  : 'border-border bg-card-2/40 hover:border-accent/40 hover:bg-card-2',
              )}
            >
              <div className="flex w-full min-w-0 items-center gap-1 sm:gap-1.5 text-[10.5px] sm:text-xs font-semibold text-muted group-hover:text-foreground">
                <Film className="size-3 sm:size-3.5 text-accent shrink-0" />
                <span className="truncate">Watchlist</span>
              </div>
              <dd className="mt-1 font-display text-xl font-black tabular-nums text-foreground sm:text-3xl">
                {watchlistCount}
              </dd>
              <span className="mt-0.5 text-[10px] sm:text-[11px] text-muted truncate max-w-full">titles queued</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={cn(
                'group relative flex min-w-0 w-full flex-col items-start overflow-hidden rounded-2xl border p-2.5 sm:p-3.5 text-left transition duration-200 active:scale-[0.98]',
                activeTab === 'history'
                  ? 'border-accent bg-accent/10 shadow-md shadow-accent/5'
                  : 'border-border bg-card-2/40 hover:border-accent/40 hover:bg-card-2',
              )}
            >
              <div className="flex w-full min-w-0 items-center gap-1 sm:gap-1.5 text-[10.5px] sm:text-xs font-semibold text-muted group-hover:text-foreground">
                <History className="size-3 sm:size-3.5 text-accent shrink-0" />
                <span className="truncate">Watched</span>
              </div>
              <dd className="mt-1 font-display text-xl font-black tabular-nums text-foreground sm:text-3xl">
                {historyCount}
              </dd>
              <span className="mt-0.5 text-[10px] sm:text-[11px] text-muted truncate max-w-full">eps logged</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('reading')}
              className={cn(
                'group relative flex min-w-0 w-full flex-col items-start overflow-hidden rounded-2xl border p-2.5 sm:p-3.5 text-left transition duration-200 active:scale-[0.98]',
                activeTab === 'reading'
                  ? 'border-accent bg-accent/10 shadow-md shadow-accent/5'
                  : 'border-border bg-card-2/40 hover:border-accent/40 hover:bg-card-2',
              )}
            >
              <div className="flex w-full min-w-0 items-center gap-1 sm:gap-1.5 text-[10.5px] sm:text-xs font-semibold text-muted group-hover:text-foreground">
                <BookOpen className="size-3 sm:size-3.5 text-accent shrink-0" />
                <span className="truncate">Manhwa &amp; Manga</span>
              </div>
              <dd className="mt-1 font-display text-xl font-black tabular-nums text-foreground sm:text-3xl">
                {readingCount}
              </dd>
              <span className="mt-0.5 text-[10px] sm:text-[11px] text-muted truncate max-w-full">titles &amp; chapters</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Showcase Tabs Navigation Bar */}
      <div className="flex w-full min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-card p-2 sm:flex-row sm:items-center sm:justify-between sm:p-2.5">
        {/* Navigation Tabs */}
        <div className="no-scrollbar flex w-full min-w-0 items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('watchlist')}
            className={cn(
              'relative flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition active:scale-95',
              activeTab === 'watchlist' ? 'text-accent-fg' : 'text-muted hover:text-foreground',
            )}
          >
            {activeTab === 'watchlist' && (
              <motion.span
                layoutId="profileTabHighlight"
                transition={springTransition}
                className="absolute inset-0 rounded-xl bg-accent shadow-md shadow-accent/25"
              />
            )}
            <Film className="relative size-3.5" />
            <span className="relative">Watchlist ({watchlistCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={cn(
              'relative flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition active:scale-95',
              activeTab === 'history' ? 'text-accent-fg' : 'text-muted hover:text-foreground',
            )}
          >
            {activeTab === 'history' && (
              <motion.span
                layoutId="profileTabHighlight"
                transition={springTransition}
                className="absolute inset-0 rounded-xl bg-accent shadow-md shadow-accent/25"
              />
            )}
            <History className="relative size-3.5" />
            <span className="relative">Watched ({historyCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reading')}
            className={cn(
              'relative flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition active:scale-95',
              activeTab === 'reading' ? 'text-accent-fg' : 'text-muted hover:text-foreground',
            )}
          >
            {activeTab === 'reading' && (
              <motion.span
                layoutId="profileTabHighlight"
                transition={springTransition}
                className="absolute inset-0 rounded-xl bg-accent shadow-md shadow-accent/25"
              />
            )}
            <BookOpen className="relative size-3.5" />
            <span className="relative">Manhwa, Manga & Novels ({readingCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('about')}
            className={cn(
              'relative flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition active:scale-95',
              activeTab === 'about' ? 'text-accent-fg' : 'text-muted hover:text-foreground',
            )}
          >
            {activeTab === 'about' && (
              <motion.span
                layoutId="profileTabHighlight"
                transition={springTransition}
                className="absolute inset-0 rounded-xl bg-accent shadow-md shadow-accent/25"
              />
            )}
            <User className="relative size-3.5" />
            <span className="relative">About</span>
          </button>
        </div>

        {/* Quick Search within profile library */}
        {activeTab !== 'about' && (
          <div className="relative w-full min-w-0 sm:w-64 sm:shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search in ${activeTab}...`}
              className="w-full rounded-xl border border-border bg-card-2 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* 4. Tab Content Panels */}
      <AnimatePresence mode="wait">
        {/* TAB 1: WATCHLIST */}
        {activeTab === 'watchlist' && (
          <motion.div
            key="watchlist-tab"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* Status Filter Chips */}
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'all', label: 'All Shows' },
                { id: 'watching', label: 'Watching' },
                { id: 'completed', label: 'Completed' },
                { id: 'planning', label: 'Plan to Watch' },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setWatchlistFilter(chip.id)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold transition active:scale-95',
                    watchlistFilter === chip.id
                      ? 'bg-foreground text-background'
                      : 'border border-border bg-card text-muted hover:text-foreground',
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {filteredWatchlist.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:gap-4">
                {filteredWatchlist.map((item) => (
                  <MediaCard key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <EmptyShelfState
                icon={Film}
                title={watchlistFilter !== 'all' ? `No ${watchlistFilter} anime found` : 'Watchlist is empty'}
                subtitle={
                  isSelf
                    ? 'Start building your anime collection by exploring trending titles.'
                    : `@${username} hasn't added any ${watchlistFilter !== 'all' ? watchlistFilter : ''} anime yet.`
                }
                actionHref="/browse"
                actionLabel="Explore Anime"
              />
            )}
          </motion.div>
        )}

        {/* TAB 2: WATCHED HISTORY */}
        {activeTab === 'history' && (
          <motion.div
            key="history-tab"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {filteredHistory.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:gap-4">
                {filteredHistory.map((item) => (
                  <MediaCard key={`${item.id}:${item.ep ?? 0}`} item={item} isHistory />
                ))}
              </div>
            ) : (
              <EmptyShelfState
                icon={History}
                title="No watch history yet"
                subtitle={
                  isSelf
                    ? 'Episodes you watch will appear here with your playback progress.'
                    : `@${username} hasn’t logged any watch history yet.`
                }
                actionHref="/home"
                actionLabel="Watch Something"
              />
            )}
          </motion.div>
        )}

        {/* TAB 3: MANHWA, MANGA & NOVELS */}
        {activeTab === 'reading' && (
          <motion.div
            key="reading-tab"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* Kind Filter Chips */}
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'all' as const, label: `All (${readingCounts.all})` },
                { id: 'manhwa' as const, label: `Manhwa (${readingCounts.manhwa})` },
                { id: 'manga' as const, label: `Manga (${readingCounts.manga})` },
                { id: 'novel' as const, label: `Novels (${readingCounts.novel})` },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setReadingFilter(chip.id)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold transition active:scale-95',
                    readingFilter === chip.id
                      ? 'bg-foreground text-background'
                      : 'border border-border bg-card text-muted hover:text-foreground',
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {filteredReading.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:gap-4">
                {filteredReading.map((item) => (
                  <MediaCard key={item.id} item={item} isReading />
                ))}
              </div>
            ) : (
              <EmptyShelfState
                icon={BookOpen}
                title={readingFilter !== 'all' ? `No ${readingFilter} activity yet` : 'No reading activity yet'}
                subtitle={
                  isSelf
                    ? 'Track manhwa, manga and light novels you read on AnimeStream.'
                    : `@${username} hasn’t read any ${readingFilter === 'all' ? 'manhwa, manga or novels' : readingFilter} yet.`
                }
                actionHref={readingFilter === 'manhwa' ? '/manhwa' : readingFilter === 'novel' ? '/novel' : '/manga'}
                actionLabel={readingFilter === 'manhwa' ? 'Browse Manhwa' : readingFilter === 'novel' ? 'Browse Novels' : 'Browse Manga'}
              />
            )}
          </motion.div>
        )}

        {/* TAB 4: ABOUT & STATS BREAKDOWN */}
        {activeTab === 'about' && (
          <motion.div
            key="about-tab"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="grid gap-4 md:grid-cols-3"
          >
            {/* Account Details */}
            <div className="space-y-4 rounded-3xl border border-border bg-card p-5 md:col-span-2">
              <h3 className="flex items-center gap-2 font-display text-base font-bold text-foreground">
                <User className="size-4 text-accent" />
                <span>About @{username}</span>
              </h3>

              <div className="space-y-3 text-sm text-foreground/80">
                <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                  <span className="text-muted">Display Name</span>
                  <StyledDisplayName
                    name={profile.name || username}
                    styleSpec={profile.nameStyle ?? null}
                    isSelf={isSelf}
                    className="font-semibold text-foreground"
                  />
                </div>
                <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                  <span className="text-muted">Handle</span>
                  <span className="font-mono text-accent">@{username}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                  <span className="text-muted">Member Status</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                    <ShieldCheck className="size-3.5" /> Active Otaku
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Total Activity</span>
                  <span className="font-semibold tabular-nums text-foreground">{totalTitlesLogged} entries</span>
                </div>
              </div>

              {profile.bio && (
                <div className="mt-4 pt-4 border-t border-border">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted">Personal Bio</h4>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/90 font-medium">
                    {profile.bio}
                  </p>
                </div>
              )}
            </div>

            {/* Quick Actions / Recommendations */}
            <div className="space-y-4 rounded-3xl border border-border bg-card p-5">
              <h3 className="flex items-center gap-2 font-display text-base font-bold text-foreground">
                <Compass className="size-4 text-accent" />
                <span>Explore Together</span>
              </h3>

              <p className="text-xs text-muted leading-relaxed">
                Connect with @{username} across community chat rooms or watch anime in synchronized WatchParty rooms.
              </p>

              <div className="space-y-2 pt-2">
                <Link
                  to="/community"
                  className="flex w-full items-center justify-between rounded-2xl border border-border bg-card-2/60 p-3 text-xs font-bold text-foreground transition hover:border-accent hover:bg-card-2"
                >
                  <span className="flex items-center gap-2">
                    <MessageSquare className="size-4 text-accent" />
                    <span>Join Community Lounge</span>
                  </span>
                  <span>→</span>
                </Link>

                <Link
                  to="/watchparty"
                  className="flex w-full items-center justify-between rounded-2xl border border-border bg-card-2/60 p-3 text-xs font-bold text-foreground transition hover:border-accent hover:bg-card-2"
                >
                  <span className="flex items-center gap-2">
                    <Users className="size-4 text-accent" />
                    <span>Start WatchParty</span>
                  </span>
                  <span>→</span>
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ Media Card */

function MediaCard({
  item,
  isHistory = false,
  isReading = false,
}: {
  item: PublicMediaItem
  isHistory?: boolean
  isReading?: boolean
}) {
  const [imgSrc, setImgSrc] = useState(item.image)
  const [triedProxy, setTriedProxy] = useState(false)
  const [imgFailed, setImgFailed] = useState(!item.image)

  const linkHref = item.href || (isReading ? `/manga/${item.id}` : `/anime/${item.id}`)
  const formatBadge =
    item.format ||
    (isReading ? (item.kind === 'manhwa' ? 'MANHWA' : item.kind === 'novel' ? 'NOVEL' : 'MANGA') : 'Anime')

  const handleImgError = () => {
    if (
      imgSrc &&
      !triedProxy &&
      (imgSrc.startsWith('http://') || imgSrc.startsWith('https://')) &&
      !imgSrc.startsWith('/proxy')
    ) {
      setTriedProxy(true)
      setImgSrc(`/proxy?url=${encodeURIComponent(imgSrc)}`)
    } else {
      setImgFailed(true)
    }
  }

  return (
    <Link
      to={linkHref}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card transition duration-300 hover:-translate-y-1 hover:border-accent/50 hover:shadow-xl hover:shadow-black/40"
    >
      {/* Poster Image (3:4 ratio) */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-card-2">
        {!imgFailed && imgSrc ? (
          <img
            src={imgSrc}
            alt={item.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={handleImgError}
            className="size-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center bg-card-2 p-3 text-center">
            <Clapperboard className="size-8 text-muted/50" />
            <span className="mt-2 text-xs font-bold text-muted line-clamp-2">{item.title}</span>
          </div>
        )}

        {/* Dark Vignette Overlay on Hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 transition duration-300 group-hover:opacity-90" />

        {/* Top Badges: Score & Format */}
        <div className="absolute left-2 top-2 right-2 flex items-center justify-between gap-1">
          {item.score ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-amber-400 backdrop-blur-sm">
              <Star className="size-2.5 fill-current" />
              {item.score}%
            </span>
          ) : (
            <span />
          )}

          <span className="rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white/90 backdrop-blur-sm uppercase">
            {formatBadge}
          </span>
        </div>

        {/* Play / Read Icon hover overlay */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition duration-300 group-hover:opacity-100">
          <span className="grid size-10 place-items-center rounded-full bg-accent text-accent-fg shadow-lg shadow-accent/40 transition duration-200 group-hover:scale-110">
            {isReading ? <BookOpen className="size-4" /> : <Play className="size-4 fill-current ml-0.5" />}
          </span>
        </div>

        {/* Progress Bar (History, Reading & Watching) */}
        {typeof item.progress === 'number' && item.progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(4, item.progress))}%` }}
            />
          </div>
        )}
      </div>

      {/* Info footer */}
      <div className="flex flex-1 flex-col justify-between p-2.5">
        <h4 className="line-clamp-2 text-xs font-bold leading-snug text-foreground transition group-hover:text-accent">
          {item.title}
        </h4>

        <div className="mt-1.5 flex items-center justify-between gap-1 text-[11px] text-muted">
          {isHistory && item.ep ? (
            <span className="font-semibold text-accent truncate">Episode {item.ep}</span>
          ) : isReading && item.label ? (
            <span className="font-semibold text-accent truncate">{item.label}</span>
          ) : item.status ? (
            <span
              className={cn(
                'capitalize font-semibold truncate',
                item.status === 'watching' && 'text-emerald-400',
                item.status === 'completed' && 'text-sky-400',
                item.status === 'planning' && 'text-violet-400',
              )}
            >
              {item.status}
            </span>
          ) : (
            <span>{item.year || 'Anime'}</span>
          )}

          {isReading && item.source ? (
            <span className="shrink-0 text-[10px] font-medium text-muted/85">{item.source}</span>
          ) : item.episodes ? (
            <span className="tabular-nums shrink-0">
              {item.progress ? `${item.progress}/${item.episodes}` : `${item.episodes} eps`}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  )
}

/* ------------------------------------------------------------------ Empty Shelf State */

function EmptyShelfState({
  icon: Icon,
  title,
  subtitle,
  actionHref,
  actionLabel,
}: {
  icon: any
  title: string
  subtitle: string
  actionHref: string
  actionLabel: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/40 p-8 text-center sm:p-12">
      <div className="grid size-14 place-items-center rounded-3xl bg-card-2 text-muted">
        <Icon className="size-6" />
      </div>
      <h3 className="mt-4 font-display text-base font-bold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{subtitle}</p>
      <Link
        to={actionHref}
        className="mt-5 inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-xs font-bold text-accent-fg shadow-md shadow-accent/20 transition hover:brightness-110 active:scale-95"
      >
        <Compass className="size-3.5" />
        <span>{actionLabel}</span>
      </Link>
    </div>
  )
}
