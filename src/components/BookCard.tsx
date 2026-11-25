import { Img } from './Img'
import { memo, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
import { cn } from '../lib/utils'
import { WatchedThumbOverlay } from './WatchedBadge'
import { useIsAnimeWatched, useIsMovieWatched } from '../lib/library'

export interface BookCardItem {
  key: string
  href: string
  title: string
  image: string
  fallbackImage?: string | null
  score?: number | string | null
  badge?: string | null
  caption?: string | null
  genres?: string[]
  /** hover label; defaults to the reading one */
  cta?: string
}

/** Poster card for novels and manga — same look and 3D tilt as AnimeCard, with a graceful cover fallback. */
export const BookCard = memo(function BookCard({
  item,
  index = 0,
  rank,
  fluid = false,
}: {
  item: BookCardItem
  index?: number
  rank?: number
  fluid?: boolean
}) {
  const tilt = useRef<HTMLDivElement>(null)
  const raf = useRef(0)
  const [fbStage, setFbStage] = useState(0)

  useEffect(() => {
    setFbStage(0)
  }, [item.image, item.fallbackImage, item.title])

  const movieMatch = item.href.match(/\/movies\/(movie|tv)\/(\d+)/)
  const animeMatch = item.href.match(/\/anime\/(\d+)/)
  const movieWatched = useIsMovieWatched((movieMatch?.[1] as 'movie' | 'tv') || 'movie', movieMatch ? Number(movieMatch[2]) : 0)
  const animeWatched = useIsAnimeWatched(animeMatch ? Number(animeMatch[1]) : 0)
  const watched = (Boolean(movieMatch) && movieWatched) || (Boolean(animeMatch) && animeWatched)

  function onMove(e: React.PointerEvent<HTMLAnchorElement>) {
    if (e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      if (tilt.current) tilt.current.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 14}deg) rotateY(${(x - 0.5) * 14}deg)`
    })
  }
  function onLeave() {
    cancelAnimationFrame(raf.current)
    if (tilt.current) tilt.current.style.transform = ''
  }

  const score = item.score !== null && item.score !== undefined && item.score !== '' ? String(item.score) : null
  const titleProxy = item.title ? `/proxy?title=${encodeURIComponent(item.title)}` : ''
  const srcCandidates: string[] = []
  if (item.image) srcCandidates.push(item.image)
  if (item.fallbackImage && !srcCandidates.includes(item.fallbackImage)) srcCandidates.push(item.fallbackImage)
  if (titleProxy && !srcCandidates.some((u) => u.startsWith('/proxy?title=')) && !srcCandidates.includes(titleProxy)) {
    srcCandidates.push(titleProxy)
  }
  const activeSrc = srcCandidates[fbStage] ?? ''
  const showImg = Boolean(activeSrc)

  return (
    <div
      className={cn('group/card relative animate-card-in shrink-0 snap-start', fluid ? 'w-full' : 'w-[148px] sm:w-[178px] lg:w-[196px]')}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Link to={item.href} draggable={false} onPointerMove={onMove} onPointerLeave={onLeave} className="group block outline-none">
        <div
          ref={tilt}
          className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-card-2 shadow-lg shadow-black/25 transition-[transform,box-shadow,filter] duration-150 ease-out group-hover:shadow-2xl group-active:scale-[0.96] group-active:brightness-90 group-focus-visible:ring-2 group-focus-visible:ring-foreground/60"
        >
          {showImg ? (
            <Img
              src={activeSrc}
              alt={item.title}
              loading="lazy"
              decoding="async"
              draggable={false}
              referrerPolicy="no-referrer"
              onError={() => setFbStage((s) => s + 1)}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-card-2 p-3 text-center">
              <span className="line-clamp-4 font-display text-sm font-bold text-muted">{item.title}</span>
            </div>
          )}

          {score && (
            <span className="absolute left-2 top-2 z-[5] inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[11px] font-semibold text-white">
              <Star className="size-3 fill-current" />
              {score}
            </span>
          )}
          {item.badge && (
            <span className="absolute right-2 top-2 z-[5] rounded-full bg-accent px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-accent-fg">{item.badge}</span>
          )}

          {rank !== undefined && (
            <span className="absolute bottom-1 left-2.5 z-[5] font-display text-5xl font-black leading-none text-white/95 drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)]">
              {rank}
            </span>
          )}

          {watched && <WatchedThumbOverlay size="sm" />}

          <div className="absolute inset-0 z-[6] flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/30 to-transparent p-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
            <div className="flex flex-wrap gap-1">
              {(item.genres ?? []).slice(0, 2).map((g) => (
                <span key={g} className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium text-white">
                  {g}
                </span>
              ))}
            </div>
            <span className="mt-2 text-xs font-semibold text-white">{item.cta ?? 'Start reading →'}</span>
          </div>
        </div>

        <h3 className="mt-3 line-clamp-2 text-sm font-medium leading-snug transition-colors group-hover:text-accent group-active:text-accent">{item.title}</h3>
        {item.caption && <p className="mt-1 truncate text-xs text-muted">{item.caption}</p>}
      </Link>
    </div>
  )
})
