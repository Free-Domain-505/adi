import { Img } from './Img'
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { fetchMalPictures } from '../services/jikan'
import { tmdbGallery } from '../services/tmdbDirect'
import { useAsync } from '../hooks/useAsync'
import { ErrorScreen } from './ErrorScreen'
import type { AniMediaDetails } from '../types/anime'

/** Banner, cover, episode thumbnails (AniList) + backdrops/posters (TMDB) + pictures (MyAnimeList), de-duplicated. */
export function Gallery({
  anime,
  tmdb,
  pending = false,
}: {
  anime: AniMediaDetails
  tmdb: { id: number; type: string } | null
  pending?: boolean
}) {
  const [open, setOpen] = useState<string | null>(null)
  // Each source loads on its own, so a slow or failing one never holds back the rest.
  const t = useAsync(() => (tmdb ? tmdbGallery(tmdb.type, tmdb.id) : Promise.resolve([] as string[])), [tmdb?.id, tmdb?.type])
  const m = useAsync(() => (anime.idMal ? fetchMalPictures(anime.idMal) : Promise.resolve([])), [anime.idMal])

  const imgs = useMemo(() => {
    const isMovie = anime.format === 'MOVIE' || tmdb?.type === 'movie'
    const epThumbs = isMovie ? [] : anime.streamingEpisodes.map((e) => e.thumbnail)
    const all = [
      ...(t.data ?? []),
      anime.bannerImage,
      anime.coverImage.extraLarge,
      ...epThumbs,
      ...(m.data ?? []).map((p) => p.jpg.large_image_url ?? p.jpg.image_url),
    ].filter((u): u is string => !!u)
    return [...new Set(all)]
  }, [anime, tmdb, t.data, m.data])

  const loading = pending || t.loading || m.loading
  const error = t.error ?? m.error
  const retry = () => (t.reload(), m.reload())

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  if (!imgs.length && loading) return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-video animate-pulse rounded-xl bg-card-2" />)}</div>
  if (!imgs.length) return <ErrorScreen compact kind={error ? 'server' : 'empty'} message={error?.message} onRetry={error ? retry : undefined} />

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {imgs.map((u) => (
          <button key={u} onClick={() => setOpen(u)} aria-label="View image" className="relative overflow-hidden rounded-xl bg-card-2 transition hover:ring-2 hover:ring-accent">
            <Img src={u} alt="" loading="lazy" className="aspect-video w-full object-cover" onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')} />
          </button>
        ))}
        {loading && Array.from({ length: 4 }, (_, i) => <div key={`s${i}`} className="aspect-video animate-pulse rounded-xl bg-card-2" />)}
      </div>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Image preview" onClick={() => setOpen(null)} className="fixed inset-0 z-[100] grid place-items-center bg-black/90 p-4">
          <button aria-label="Close" onClick={() => setOpen(null)} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white"><X className="size-5" /></button>
          <div onClick={(e) => e.stopPropagation()} data-protect-img className="relative select-none">
            <img src={open} alt="" draggable={false} className="max-h-[90svh] max-w-full rounded-lg object-contain" />
          </div>
        </div>
      )}
    </>
  )
}
