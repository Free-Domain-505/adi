import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Play, X } from 'lucide-react'
import { Img } from './Img'
import { WatchedThumbOverlay } from './WatchedBadge'
import {
  removeHistory,
  removeMovieHistory,
  useHistory,
  useMovieHistory,
  useWatchedAnimeIds,
} from '../lib/library'
import {
  formatMovieRemainingTime,
  selectMovieContinueItems,
  type UnifiedMovieContinueItem,
} from '../lib/movieContinueLogic'
import { cn } from '../lib/utils'

function MovieCard({ item }: { item: UnifiedMovieContinueItem }) {
  const isMovie = item.type === 'movie'
  const epDetails = isMovie
    ? item.epTitle && item.epTitle !== item.title
      ? item.epTitle
      : 'Feature Film'
    : item.epTitle
      ? `S${item.season} · E${item.episode} · ${item.epTitle}`
      : `Season ${item.season} · Episode ${item.episode}`

  const statusText = formatMovieRemainingTime(item.pos, item.dur, item.isDone)

  function handleRemove(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (item.source === 'tmdb') {
      removeMovieHistory(item.type, item.id)
    } else {
      removeHistory(item.id)
    }
  }

  return (
    <div className="group/card relative w-[256px] shrink-0 snap-start sm:w-[292px] lg:w-[310px]">
      <button
        type="button"
        aria-label={`Remove ${item.title} from continue watching`}
        title="Remove"
        onClick={handleRemove}
        className="absolute right-2.5 top-2.5 z-20 grid size-7 place-items-center rounded-full border border-white/15 bg-black/85 text-white opacity-0 transition hover:bg-accent hover:text-accent-fg focus-visible:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100"
      >
        <X className="size-3.5" />
      </button>

      <Link to={item.href} draggable={false} className="group block outline-none">
        <div className="relative aspect-[16/9] overflow-hidden rounded-2xl border border-border/80 bg-card-2 shadow-lg shadow-black/30 transition-all duration-300 group-hover:border-accent/50 group-focus-visible:ring-2 group-focus-visible:ring-accent">
          <Img
            src={item.thumb ?? undefined}
            alt={`${item.title} — ${epDetails}`}

            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/15" />

          {/* Top-left Status / Episode label */}
          <div className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5">
            <span className="rounded-lg border border-white/15 bg-black/85 px-2 py-0.5 text-[11px] font-bold text-white">
              {isMovie ? 'Movie' : `S${item.season} · E${item.episode}`}
            </span>
            <span className="rounded-lg border border-white/15 bg-black/80 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white/90">
              {item.source === 'anime' ? 'ANIME' : isMovie ? 'FILM' : 'SERIES'}
            </span>
          </div>

          {item.isDone ? (
            <WatchedThumbOverlay size="sm" className="bottom-1" badgeClassName="bottom-2.5 right-2.5" />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-black/25 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="grid size-11 place-items-center rounded-full bg-accent text-accent-fg shadow-xl shadow-black/50 transition-transform duration-200 group-hover:scale-105">
                <Play className="size-5 translate-x-[1px] fill-current" />
              </span>
            </div>
          )}

          {/* Bottom info & progress bar inside thumbnail */}
          {!item.isDone && (
            <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-2.5 pt-6">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-white/90">
                <span className="truncate">
                  {item.pct > 0 ? `${item.pct}% watched` : 'Resume'}
                </span>
                <span className="shrink-0 text-white/80">
                  {statusText}
                </span>
              </div>
            </div>
          )}

          <div
            className="absolute inset-x-0 bottom-0 z-10 h-1 bg-white/20"
            role="progressbar"
            aria-label="Playback progress"
            aria-valuenow={item.pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn('h-full transition-all', item.isDone ? 'bg-emerald-500' : 'bg-accent')}
              style={{ width: `${item.pct}%` }}
            />
          </div>
        </div>

        <div className="mt-2.5 space-y-0.5 px-0.5">
          <h3 className="line-clamp-1 text-sm font-bold leading-snug text-foreground transition-colors group-hover:text-accent">
            {item.title}
          </h3>
          <p className="line-clamp-1 text-xs font-medium text-muted">
            {epDetails}
          </p>
        </div>
      </Link>
    </div>
  )
}

/** "Continue watching" shelf for Movies & Series, newest first. */
export function MovieContinueRow({
  limit = 20,
  className = '',
}: {
  limit?: number
  className?: string
}) {
  const movieHist = useMovieHistory()
  const animeHist = useHistory()
  const watchedAnimeIds = useWatchedAnimeIds()

  const items = useMemo(() => {
    const raw = selectMovieContinueItems({
      movieHist,
      animeHist,
      watchedAnimeIds,
      limit,
    })
    const out: UnifiedMovieContinueItem[] = []
    for (const item of raw) {
      if (item.isDone) continue
      out.push(item)
    }
    return out
  }, [movieHist, animeHist, watchedAnimeIds, limit])


  if (items.length === 0) return null

  return (
    <section id="continue-movies" className={`mx-auto w-full max-w-7xl ${className}`}>
      <div className="mb-5 px-4 sm:px-6">
        <p className="mb-1 eyebrow text-accent">Pick up where you left off</p>
        <h2 className="font-display text-2xl font-bold tracking-tight">Continue Watching</h2>
      </div>
      <div
        style={{ touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' }}
        className="no-scrollbar flex snap-x snap-proximity scroll-pl-4 gap-4 overflow-x-auto overscroll-x-contain px-4 pb-4 pt-2 sm:scroll-pl-6 sm:gap-5 sm:px-6"
      >
        {items.map((item) => (
          <MovieCard key={item.uid} item={item} />
        ))}
      </div>
    </section>
  )
}
