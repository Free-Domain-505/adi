import { useEffect, useState } from 'react'
import { Img } from './Img'
import { Link } from 'react-router-dom'
import { Play, X } from 'lucide-react'
import { removeHistory, useHistory, useWatchedAnimeIds, useWatchedEpsMap, type HistoryItem } from '../lib/library'
import { useTmdb } from '../hooks/useTmdb'
import { useEpisodesState } from '../hooks/useEpisodes'
import { sanitizeEpisodeTitle } from '../lib/episodes'
import { tmdbImg } from '../services/api'
import { fetchAnimeLite } from '../services/anilist'
import type { AniDate, AniStreamingEpisode } from '../types/anime'
import { cn } from '../lib/utils'
import { WatchedThumbOverlay } from './WatchedBadge'
import { isContinueCardDone } from '../lib/watchedLogic'
import { filterContinueHistoryEntries } from '../lib/historyLogic'

const left = (h: HistoryItem, isDone: boolean) => {
  if (isDone) return 'Watched'
  if (h.dur > 0) return `${Math.max(1, Math.ceil((h.dur - h.pos) / 60))}m left`
  return 'Up next'
}

function Card({ h, isWatched }: { h: HistoryItem; isWatched: boolean }) {
  const tb = useTmdb(h.id, h.title, h.format)
  const tmdb = tb?.tmdb ?? null
  const isMovie = h.format === 'MOVIE' || tmdb?.type === 'movie'

  // Resolve exact startDate & per-season episode count for sequel entries missing startDate in saved history
  const [resolvedMeta, setResolvedMeta] = useState<{
    id: number
    idMal?: number | null
    startDate: AniDate | null
    episodes: number | null
    streamingEpisodes?: AniStreamingEpisode[]
  } | null>(null)

  useEffect(() => {
    if (isMovie || !h.id || h.startDate?.year) return
    let dead = false
    fetchAnimeLite(h.id)
      .then((a) => {
        if (!dead && a) {
          setResolvedMeta({
            id: a.id,
            idMal: a.idMal ?? null,
            startDate: a.startDate ?? null,
            episodes: a.episodes ?? null,
            streamingEpisodes: a.streamingEpisodes,
          })
        }
      })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [h.id, h.startDate?.year, isMovie])

  const metaForItem = resolvedMeta?.id === h.id ? resolvedMeta : null
  const effectiveStartDate = metaForItem?.startDate ?? h.startDate ?? null
  const effectiveEpisodes = metaForItem?.episodes ?? h.episodes ?? null

  // Wait until startDate is known before querying TMDB Season 1, so Season 2/3 sequels never get Season 1 metadata
  const canMatchSeason = isMovie || (tmdb?.season ?? 1) > 1 || Boolean(effectiveStartDate?.year)
  const epState = useEpisodesState(
    canMatchSeason ? tmdb : null,
    metaForItem?.streamingEpisodes,
    {
      id: h.id,
      idMal: metaForItem?.idMal ?? tb?.mapping?.mal ?? null,
      format: h.format,
      title: h.title,
      startDate: effectiveStartDate,
      episodes: effectiveEpisodes,
      focusEpisode: h.ep,
    },
  )
  const epInfo = canMatchSeason ? epState.episodes.get(h.ep) : undefined

  const thumb =
    epInfo?.image ??
    h.epImage ??
    tmdbImg(tmdb?.backdrop, 'w780') ??
    h.bannerImage ??
    h.image

  const epTitle = sanitizeEpisodeTitle(epInfo?.name, h.ep) ?? sanitizeEpisodeTitle(h.epTitle, h.ep) ?? null
  const epDetails = isMovie
    ? epTitle && epTitle !== h.title
      ? epTitle
      : 'Feature Film'
    : epTitle
      ? `Ep ${h.ep} · ${epTitle}`
      : `Episode ${h.ep}`

  const pct = h.dur > 0 ? Math.min(100, Math.round((h.pos / h.dur) * 100)) : 0
  const isDone = isContinueCardDone(h.pos, h.dur, isWatched)
  const href = `/watch/${h.id}?ep=${h.ep}&audio=${h.format === 'MOVIE' ? 'dub' : (h.audio || 'dub')}`
  const statusText = left(h, isDone)

  return (
    <div className="group/card relative w-[256px] shrink-0 snap-start sm:w-[292px] lg:w-[310px]">
      <button
        type="button"
        aria-label={isMovie ? `Remove ${h.title} from continue watching` : `Remove ${h.title} Episode ${h.ep} from continue watching`}
        title="Remove"
        onClick={() => removeHistory(h.id, h.ep)}
        className="absolute right-2.5 top-2.5 z-20 grid size-7 place-items-center rounded-full border border-white/15 bg-black/85 text-white opacity-0 transition hover:bg-accent hover:text-accent-fg focus-visible:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100"
      >
        <X className="size-3.5" />
      </button>

      <Link to={href} draggable={false} className="group block outline-none">
        <div className="relative aspect-[16/9] overflow-hidden rounded-2xl border border-border/80 bg-card-2 shadow-lg shadow-black/30 transition-all duration-300 group-hover:border-accent/50 group-focus-visible:ring-2 group-focus-visible:ring-accent">
          <Img
            src={thumb}
            alt={`${h.title} — ${epDetails}`}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/15" />

          {/* Top-left Status / Episode label */}
          <div className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5">
            <span className="rounded-lg border border-white/15 bg-black/85 px-2 py-0.5 text-[11px] font-bold text-white">
              {isMovie ? 'Movie' : `EP ${h.ep}`}
            </span>
            <span className="rounded-lg border border-white/15 bg-black/80 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white/90">
              {h.audio === 'dub' ? 'DUB' : 'SUB'}
            </span>
          </div>

          {isDone ? (
            <WatchedThumbOverlay size="sm" className="bottom-1" badgeClassName="bottom-2.5 right-2.5" />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-black/25 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="grid size-11 place-items-center rounded-full bg-accent text-accent-fg shadow-xl shadow-black/50 transition-transform duration-200 group-hover:scale-105">
                <Play className="size-5 translate-x-[1px] fill-current" />
              </span>
            </div>
          )}

          {/* Bottom info & progress bar inside thumbnail */}
          {!isDone && (
            <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-2.5 pt-6">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-white/90">
                <span className="truncate">{pct > 0 ? `${pct}% watched` : 'Resume'}</span>
                <span className="shrink-0 text-white/80">{statusText}</span>
              </div>
            </div>
          )}

          <div
            className="absolute inset-x-0 bottom-0 z-10 h-1 bg-white/20"
            role="progressbar"
            aria-label="Episode progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className={cn('h-full transition-all', isDone ? 'bg-emerald-500' : 'bg-accent')} style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="mt-2.5 space-y-0.5 px-0.5">
          <h3 className="line-clamp-1 text-sm font-bold leading-snug text-foreground transition-colors group-hover:text-accent">
            {h.title}
          </h3>
          <p className="line-clamp-1 text-xs font-medium text-muted">
            {epDetails}
          </p>
        </div>
      </Link>
    </div>
  )
}

/** "Continue watching" shelf, newest first. Renders nothing when there is no history. */
export function ContinueRow({ limit = 20, className = '' }: { limit?: number; className?: string }) {
  const rawItems = useHistory()
  const watchedIds = useWatchedAnimeIds()
  const watchedEpsMap = useWatchedEpsMap()
  const items = filterContinueHistoryEntries(rawItems, watchedIds, watchedEpsMap)
    .filter((h) => !isContinueCardDone(h.pos, h.dur, watchedIds.has(h.id)))
    .slice(0, limit)
  if (items.length === 0) return null
  return (
    <section id="continue" className={`mx-auto w-full max-w-7xl ${className}`}>
      <div className="mb-5 px-4 sm:px-6">
        <p className="mb-1 eyebrow text-accent">Pick up where you left off</p>
        <h2 className="font-display text-2xl font-bold tracking-tight">Continue Watching</h2>
      </div>
      <div
        style={{ touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' }}
        className="no-scrollbar flex snap-x snap-proximity scroll-pl-4 gap-4 overflow-x-auto overscroll-x-contain px-4 pb-4 pt-2 sm:scroll-pl-6 sm:gap-5 sm:px-6"
      >
        {items.map((h) => (
          <Card key={`${h.id}:${h.ep}`} h={h} isWatched={watchedIds.has(h.id)} />
        ))}
      </div>
    </section>
  )
}
