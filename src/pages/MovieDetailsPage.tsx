import { Img } from '../components/Img'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMarkDetails, useSmartBack } from '../lib/backToDetails'
import { motion } from 'framer-motion'
import { Clock, Film, Play, Star, Tv, Clapperboard, ArrowLeft, Share2 } from 'lucide-react'
import { BlurText } from '../components/BlurText'
import { BookRow } from '../components/BookRow'
import { ErrorState } from '../components/ErrorState'
import { Magnet } from '../components/Magnet'
import { Meteors } from '../components/Meteors'
import { Reveal } from '../components/Reveal'
import { ShimmerButton } from '../components/ShimmerButton'
import { Skeleton } from '../components/Skeleton'
import { SpotlightCard } from '../components/SpotlightCard'
import { SeasonDropdown } from '../components/SeasonDropdown'
import { TrailerModal } from '../components/TrailerModal'
import { useAsync } from '../hooks/useAsync'
import { toMovieCard } from '../lib/movieCards'
import { movieShareUrl, shareMedia } from '../lib/share'
import { fetchDetails, fetchEpisodes, img, watchHref, type MediaType } from '../services/movies'
import { WatchedBadge, WatchedThumbOverlay } from '../components/WatchedBadge'
import { useIsMovieWatched, useWatchedMovieEps } from '../lib/library'

const runtime = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)

export default function MovieDetailsPage() {
  const { type: rawType, id: rawId } = useParams()
  const back = useSmartBack('/movies')
  useMarkDetails()
  const type: MediaType = rawType === 'tv' ? 'tv' : 'movie'
  const id = Number(rawId)
  const d = useAsync(() => fetchDetails(type, id), [type, id])
  const [trailer, setTrailer] = useState(false)
  const [season, setSeason] = useState(1)
  const m = d.data
  const watched = useIsMovieWatched(type, id)

  useEffect(() => {
    if (m) document.title = `${m.title} — AnimeStream`
  }, [m])
  useEffect(() => setSeason(1), [id])

  if (!Number.isFinite(id) || id <= 0) return <ErrorState className="mt-40" message="That title doesn't exist." />
  if (d.error) return <ErrorState className="mt-40" message={d.error.message} onRetry={d.reload} />

  return (
    <main className="overscroll-y-none pb-28 md:pb-20">
      {/* Backdrop */}
      <section className="relative isolate overflow-x-clip bg-background text-white">
        <button type="button" onClick={back} className="absolute left-4 top-6 z-30 inline-flex cursor-pointer touch-manipulation items-center gap-2 rounded-full border border-white/20 bg-black/60 px-4 py-2 text-sm font-medium transition hover:bg-black/80 active:scale-95 sm:left-6">
          <ArrowLeft className="size-4" /> Back
        </button>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bottom-3 -z-20 overflow-hidden bg-black">
          {m?.backdrop ? (
            <img
              src={img(m.backdrop, 'w1280') ?? ''}
              alt=""
              {...({ fetchpriority: 'high' } as any)}
              className="animate-kenburns absolute inset-0 h-full w-full object-cover object-[center_20%] grayscale-[0.3]"
              style={{
                maskImage: 'linear-gradient(to bottom, #000 0%, #000 55%, rgba(0,0,0,0.45) 80%, transparent 94%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 55%, rgba(0,0,0,0.45) 80%, transparent 94%, transparent 100%)',
              }}
            />
          ) : (
            <div className="skeleton absolute inset-0" />
          )}
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/40" />
          <span aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent" />
          <Meteors number={10} />
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-6 -z-10 h-44 sm:h-52"
          style={{
            background:
              'linear-gradient(to top, var(--background) 0%, var(--background) 24%, color-mix(in srgb, var(--background) 88%, transparent) 52%, transparent 100%)',
          }}
        />

        <div className="relative mx-auto flex max-w-7xl flex-col gap-8 px-4 pb-16 pt-32 sm:px-6 sm:pt-40 md:flex-row md:items-end">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mx-auto w-44 shrink-0 sm:w-56 md:mx-0 md:w-64">
            {m?.poster ? (
              <div className="relative overflow-hidden rounded-2xl border border-white/20 shadow-2xl shadow-black/60">
                <Img src={img(m.poster, 'w500') ?? ''} alt={m.title} className="aspect-[2/3] w-full object-cover" />
                {watched && <WatchedThumbOverlay size="md" />}
              </div>
            ) : (
              <Skeleton className="aspect-[2/3] w-full rounded-2xl" />
            )}
          </motion.div>

          <div className="min-w-0 flex-1 text-center md:text-left">
            {m ? (
              <>
                <p className="mb-3 flex flex-wrap items-center justify-center gap-2 eyebrow text-white/80 md:justify-start">
                  <span className="inline-flex items-center gap-2">
                    {type === 'tv' ? <Tv className="size-4" /> : <Film className="size-4" />}
                    {type === 'tv' ? 'Series' : 'Film'}
                  </span>
                  {watched && <WatchedBadge variant="pill" />}
                </p>
                {m.logo ? (
                  <img src={img(m.logo, 'w500') ?? ''} alt={m.title} className="mx-auto max-h-28 w-auto max-w-[80%] object-contain drop-shadow-[0_6px_28px_rgba(0,0,0,0.7)] md:mx-0 md:max-h-36 md:object-left" />
                ) : (
                  <BlurText text={m.title} className="font-display text-4xl font-black leading-[1.02] tracking-tight drop-shadow-lg [text-wrap:balance]" />
                )}
                {m.tagline && <p className="mt-3 italic text-white/70">{m.tagline}</p>}
                <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-white/85 md:justify-start">
                  {m.rating && (
                    <span className="inline-flex items-center gap-1 font-semibold">
                      <Star className="size-4 fill-current" /> {m.rating.toFixed(1)}
                      {m.votes ? <span className="font-normal text-white/60">({m.votes.toLocaleString()})</span> : null}
                    </span>
                  )}
                  {m.year && <span>{m.year}</span>}
                  {m.runtime && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-4" /> {runtime(m.runtime)}
                    </span>
                  )}
                  {m.certification && <span className="rounded border border-white/40 px-1.5 text-xs font-semibold">{m.certification}</span>}
                  {m.status && <span>{m.status}</span>}
                </div>
                <div className="mt-4 flex flex-wrap justify-center gap-2 md:justify-start">
                  {m.genres.map((g) => (
                    <Link key={g.id} to={`/movies/browse?type=${type}&genre=${g.id}`} className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium transition hover:bg-white/25">
                      {g.name}
                    </Link>
                  ))}
                </div>
                <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-white/80 md:mx-0">{m.overview || 'No synopsis yet.'}</p>
                <div className="mt-7 flex flex-wrap items-center justify-center gap-3 md:justify-start">
                  <Magnet padding={30}>
                    <ShimmerButton to={watchHref(m, 1, 1)} className="!bg-white !text-black" icon={<Play className="size-4 fill-current" />}>
                      {type === 'tv' ? 'Watch S1 · E1' : 'Play'}
                    </ShimmerButton>
                  </Magnet>
                  {m.trailer && (
                    <button type="button" onClick={() => setTrailer(true)} className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold transition hover:bg-white/20 active:scale-95">
                      <Clapperboard className="size-4" /> Trailer
                    </button>
                  )}
                  <button type="button" onClick={() => shareMedia({ url: movieShareUrl(type, id, m.title), title: m.title, image: img(m.backdrop ?? m.poster, 'w1280'), poster: img(m.poster, 'w500'), label: 'Watch free on AnimeStream', subtitle: [type === 'tv' ? 'TV Series' : 'Movie', m.year].filter(Boolean).join(' · ') })} className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold transition hover:bg-white/20 active:scale-95">
                    <Share2 className="size-4" /> Share
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <Skeleton className="mx-auto h-12 w-3/4 md:mx-0" />
                <Skeleton className="mx-auto h-4 w-1/2 md:mx-0" />
                <Skeleton className="mx-auto h-20 w-full max-w-2xl md:mx-0" />
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="relative z-10 space-y-12 pt-4 sm:space-y-16">
        {m && type === 'tv' && m.seasons.length > 0 && (
          <Reveal>
            <Episodes id={id} seasons={m.seasons} season={season} onSeason={setSeason} />
          </Reveal>
        )}

        {m && m.cast.length > 0 && (
          <section className="mx-auto max-w-7xl">
            <div className="mb-5 px-4 sm:px-6">
              <p className="mb-1 eyebrow text-accent">Starring</p>
              <h2 className="font-display text-2xl font-bold tracking-tight">Cast</h2>
            </div>
            <div className="no-scrollbar flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6">
              {m.cast.map((c) => (
                <div key={c.id} className="w-28 shrink-0 text-center sm:w-32">
                  <div className="relative aspect-square overflow-hidden rounded-full border border-border bg-card-2">
                    {c.photo ? <Img src={img(c.photo, 'w185') ?? ''} alt={c.name} loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center font-display text-2xl font-black text-muted">{c.name[0]}</div>}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm font-medium leading-tight">{c.name}</p>
                  <p className="line-clamp-1 text-xs text-muted">{c.character}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <BookRow eyebrow="More like this" title="You might also like" items={m?.similar.map(toMovieCard)} loading={d.loading} />
      </div>

      <TrailerModal trailer={trailer && m?.trailer ? { id: m.trailer, site: 'youtube', thumbnail: null } : null} onClose={() => setTrailer(false)} />
    </main>
  )
}

function Episodes({ id, seasons, season, onSeason }: { id: number; seasons: { n: number; name: string; episodes: number }[]; season: number; onSeason: (n: number) => void }) {
  const eps = useAsync(() => fetchEpisodes(id, season), [id, season])
  const watchedEps = useWatchedMovieEps(id, season)
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-start gap-3 sm:gap-4">
        {seasons.length > 1 && (
          <SeasonDropdown
            align="left"
            value={String(season)}
            options={seasons.map((s) => ({
              value: String(s.n),
              label: `Season ${s.n}`,
              subtitle: s.name && s.name !== `Season ${s.n}` ? s.name : undefined,
              meta: s.episodes ? `${s.episodes} Ep` : undefined,
            }))}
            onChange={(v) => onSeason(Number(v))}
          />
        )}
        <div>
          <p className="mb-0.5 eyebrow text-accent">Episodes</p>
          <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">Season {season}</h2>
        </div>
      </div>
      {eps.error ? (
        <ErrorState message={eps.error.message} onRetry={eps.reload} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(eps.data ?? Array.from({ length: 6 }, () => null)).map((e, n) =>
            e ? (
              <Link key={e.n} to={`/movies/watch/tv/${id}?s=${season}&e=${e.n}`} className="group block outline-none">
                <SpotlightCard className="h-full p-2.5 transition group-hover:border-accent group-focus-visible:ring-2 group-focus-visible:ring-accent">
                  <div className="flex gap-3">
                  <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-xl bg-card-2 sm:w-36">
                    {e.still && <Img src={img(e.still, 'w342') ?? ''} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />}
                    {watchedEps.has(e.n) ? (
                      <WatchedThumbOverlay size="xs" />
                    ) : (
                      <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                        <Play className="size-6 fill-white text-white" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 py-1">
                    <p className="line-clamp-1 text-sm font-semibold">
                      <span className="text-muted">{e.n}.</span> {e.name}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      <span>{[e.air, e.runtime ? `${e.runtime}m` : null].filter(Boolean).join(' · ')}</span>
                      {watchedEps.has(e.n) && <WatchedBadge variant="inline" />}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted">{e.overview}</p>
                  </div>
                  </div>
                </SpotlightCard>
              </Link>
            ) : (
              <div key={n} className="rounded-2xl border border-border bg-card p-2.5">
                <div className="flex gap-3">
                  <div className="skeleton aspect-video w-32 shrink-0 rounded-xl sm:w-36" />
                  <div className="min-w-0 flex-1 space-y-2 py-1">
                    <Skeleton className="h-4 w-3/4 rounded-md" />
                    <Skeleton className="h-3 w-1/3 rounded-md" />
                    <Skeleton className="h-3 w-full rounded-md" />
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  )
}
