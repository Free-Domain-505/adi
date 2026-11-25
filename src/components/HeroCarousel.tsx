import { Img } from './Img'
import { HeroLoader } from './HeroLoader'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Info, Play, Star } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AniMedia } from '../types/anime'
import { fetchTmdb, peekTmdb, tmdbImg, type TmdbBundle } from '../services/api'
import { useTmdb } from '../hooks/useTmdb'
import { getPrefs, meta as toMeta, toggleList, useListItem, useIsAnimeWatched } from '../lib/library'
import { isNavClickGuarded } from '../lib/clickGuard'
import { mediaToCard } from '../lib/mappers'
import { resolveHeroTarget } from '../lib/episodes'
import { resolveHeroCarouselBackdrops, resolveHeroScore } from '../lib/heroPresentation'
import { cn, formatLabel, formatStatus, pickTitle, stripHtml } from '../lib/utils'
import { BlurText } from './BlurText'
import { Magnet } from './Magnet'
import { WatchedBadge } from './WatchedBadge'

const INTERVAL = 8500

const warmedImages = new Set<string>()
const failedImages = new Set<string>()
type LogoTone = 'normal' | 'boost' | 'invert'
const logoToneCache = new Map<string, LogoTone>()

function analyzeLogoTone(src: string, cb?: (tone: LogoTone) => void) {
  const cached = logoToneCache.get(src)
  if (cached) {
    cb?.(cached)
    return
  }
  const probe = new Image()
  probe.crossOrigin = 'anonymous'
  probe.onload = () => {
    let detected: LogoTone = 'normal'
    try {
      const w = 64
      const h = 32
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(probe, 0, 0, w, h)
        const { data } = ctx.getImageData(0, 0, w, h)
        let vis = 0
        let lumSum = 0
        let satSum = 0
        let bright = 0
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3]
          if (a < 40) continue
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          const lum = 0.299 * r + 0.587 * g + 0.114 * b
          vis++
          lumSum += lum
          satSum += max > 0 ? (max - min) / max : 0
          if (lum > 165) bright++
        }
        if (vis > 12) {
          const avgLum = lumSum / vis
          const avgSat = satSum / vis
          const brightRatio = bright / vis
          if (avgLum < 60 && avgSat < 0.25 && brightRatio < 0.08) {
            detected = 'invert'
          } else if (avgLum < 110 && brightRatio < 0.15) {
            detected = 'boost'
          }
        }
      }
    } catch {
      /* ignore canvas read errors */
    }
    logoToneCache.set(src, detected)
    cb?.(detected)
  }
  probe.src = src
}

function preloadUrl(src: string | null | undefined) {
  if (!src || warmedImages.has(src) || failedImages.has(src)) return
  const im = new Image()
  im.onload = () => warmedImages.add(src)
  im.onerror = () => failedImages.add(src)
  im.src = src
}

/** Backdrop: uses season-deduplicated TMDB path first; falls back to distinct AniList season art when TMDB has none or is already claimed. */
function Backdrop({
  backdropPath,
  fallbackBanner,
  loaded,
}: {
  backdropPath: string | null
  fallbackBanner: string
  loaded: boolean
}) {
  const hd = tmdbImg(backdropPath, 'w1280')
  const [ready, setReady] = useState(() => Boolean(hd && warmedImages.has(hd)))
  const [bad, setBad] = useState(() => Boolean(hd && failedImages.has(hd)))
  const base = fallbackBanner
  useEffect(() => {
    setReady(Boolean(hd && warmedImages.has(hd)))
    setBad(Boolean(hd && failedImages.has(hd)))
  }, [hd])
  return (
    <div className="animate-kenburns absolute inset-0">
      {!loaded && !base ? <HeroLoader /> : null}
      {base && (!hd || bad || !ready) && (
        <Img
          src={base}
          alt=""
          fetchPriority="high"
          className="h-full w-full object-cover object-[center_25%]"
        />
      )}
      {hd && !bad && (
        <img
          ref={(node) => {
            node?.setAttribute('fetchpriority', 'high')
          }}
          src={hd}
          alt=""
          onLoad={() => {
            warmedImages.add(hd)
            setReady(true)
          }}
          onError={() => {
            failedImages.add(hd)
            setBad(true)
          }}
          className={cn('absolute inset-0 h-full w-full object-cover object-[center_25%] transition-opacity duration-700', ready ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  )
}

/** Title: TMDB transparent logo when there is one (centred on phones, left on desktop), blur-in text only when TMDB has no logo. */
function Heading({ title, logo }: { title: string; logo: string | null }) {
  const src = tmdbImg(logo, 'w500')
  const [imgLoaded, setImgLoaded] = useState(() => Boolean(src && warmedImages.has(src)))
  const [imgFailed, setImgFailed] = useState(() => Boolean(src && failedImages.has(src)))
  const [tone, setTone] = useState<LogoTone>(() => (src ? (logoToneCache.get(src) ?? 'normal') : 'normal'))

  useEffect(() => {
    setImgLoaded(Boolean(src && warmedImages.has(src)))
    setImgFailed(Boolean(src && failedImages.has(src)))
    setTone(src ? (logoToneCache.get(src) ?? 'normal') : 'normal')
    if (!src) return
    let cancelled = false
    analyzeLogoTone(src, (detected) => {
      if (!cancelled) setTone(detected)
    })
    return () => {
      cancelled = true
    }
  }, [src])

  const hasLogo = Boolean(src && !imgFailed)
  const showText = !hasLogo || !imgLoaded

  return (
    <div className="relative flex min-h-[4.5rem] w-full items-end justify-center lg:justify-start">
      {hasLogo && (
        <img
          key={src!}
          src={src!}
          alt={title}
          onLoad={() => {
            warmedImages.add(src!)
            setImgLoaded(true)
          }}
          onError={() => {
            failedImages.add(src!)
            setImgFailed(true)
          }}
          className={cn(
            'max-h-24 w-auto max-w-[80%] object-contain object-center transition-opacity duration-300 sm:max-h-32 lg:max-h-36 lg:max-w-[60%] lg:object-left',
            tone === 'invert'
              ? 'brightness-0 invert drop-shadow-[0_8px_32px_rgba(0,0,0,0.9)]'
              : tone === 'boost'
                ? 'brightness-125 contrast-110 drop-shadow-[0_0_12px_rgba(255,255,255,0.45)] drop-shadow-[0_8px_28px_rgba(0,0,0,0.95)]'
                : 'drop-shadow-[0_8px_32px_rgba(0,0,0,0.85)]',
            imgLoaded ? 'relative opacity-100' : 'pointer-events-none absolute opacity-0',
          )}
        />
      )}
      {showText && (
        <BlurText
          key={title}
          text={title}
          className="font-display text-4xl font-black leading-[1.02] tracking-tight text-white drop-shadow-lg [text-wrap:balance] text-center lg:text-left"
        />
      )}
    </div>
  )
}

/** Blur + rise entrance, staggered by `i`. */
function Rise({ i, className, children }: { i: number; className?: string; children: ReactNode }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.1 + i * 0.07, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

function SaveButton({ media }: { media: AniMedia }) {
  const inList = !!useListItem(media.id)
  const Icon = inList ? BookmarkCheck : Bookmark
  const label = inList ? 'Remove from My List' : 'Add to My List'
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={inList}
      title={label}
      onClick={() => {
        if (isNavClickGuarded()) return
        toggleList(toMeta(mediaToCard(media)))
      }}
      className={cn(
        'grid size-12 place-items-center rounded-full border transition',
        inList
          ? 'border-accent bg-accent/25 text-accent shadow-md shadow-accent/20'
          : 'border-white/25 bg-black/75 text-white hover:bg-black/90'
      )}
    >
      <Icon className={cn('size-5', inList && 'fill-current')} />
    </button>
  )
}

function warmSlide(n?: AniMedia, onBundle?: (id: number, bundle: TmdbBundle) => void) {
  if (!n) return
  void fetchTmdb(n.id, pickTitle(n.title), n.format).then((b) => {
    onBundle?.(n.id, b)
    const bd = tmdbImg(b.tmdb?.backdrop, 'w1280')
    const lg = tmdbImg(b.tmdb?.logo, 'w500')
    preloadUrl(bd)
    for (const extra of b.tmdb?.backdrops ?? []) {
      preloadUrl(tmdbImg(extra, 'w1280'))
    }
    preloadUrl(lg)
    if (lg) analyzeLogoTone(lg)
  })
}

/** Cinematic hero carousel with dark background blending and zero harsh center seams. */
export function HeroCarousel({ items }: { items: AniMedia[] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const lastSlideRef = useRef(0)

  // Deduplicate items to prevent duplicate slide keys or duplicate logos
  const carouselItems = useMemo(() => {
    const seen = new Set<number>()
    const res: AniMedia[] = []
    for (const it of items) {
      if (!seen.has(it.id)) {
        seen.add(it.id)
        res.push(it)
      }
    }
    return res
  }, [items])

  const [bundlesById, setBundlesById] = useState<Record<number, TmdbBundle>>(() => {
    const init: Record<number, TmdbBundle> = {}
    for (const it of carouselItems) {
      const p = peekTmdb(it.id, it.format)
      if (p) init[it.id] = p
    }
    return init
  })
  const count = carouselItems.length
  const item = carouselItems[index % Math.max(count, 1)]
  const isWatched = useIsAnimeWatched(item?.id ?? 0, item?.episodes)
  const bundle = useTmdb(item?.id, item ? pickTitle(item.title) : '', item?.format)

  const recordBundle = useCallback((id: number, b: TmdbBundle) => {
    setBundlesById((prev) => (prev[id] === b ? prev : { ...prev, [id]: b }))
  }, [])

  useEffect(() => {
    if (item?.id && bundle) recordBundle(item.id, bundle)
  }, [item?.id, bundle, recordBundle])

  const allBundles = useMemo(() => {
    const merged: Record<number, TmdbBundle | null | undefined> = { ...bundlesById }
    for (const it of carouselItems) {
      if (!merged[it.id]) {
        const p = peekTmdb(it.id, it.format)
        if (p) merged[it.id] = p
      }
    }
    if (item?.id && bundle) merged[item.id] = bundle
    return merged
  }, [bundlesById, carouselItems, item?.id, bundle])

  const currentBundle = (item ? allBundles[item.id] : null) ?? bundle
  const tmdb = currentBundle?.tmdb ?? null

  const backdropAssignments = useMemo(
    () => resolveHeroCarouselBackdrops(carouselItems, allBundles),
    [carouselItems, allBundles],
  )

  const target = useMemo(
    () => (item ? resolveHeroTarget(item, null, tmdb?.title ?? tmdb?.name) : null),
    [item, tmdb?.title, tmdb?.name],
  )
  const targetId = target?.targetId ?? item?.id
  const targetEp = target?.targetEp ?? 1
  const isResume = target?.isResume ?? false

  const next = useCallback(() => {
    if (!count) return
    const now = Date.now()
    if (now - lastSlideRef.current < 200) return
    lastSlideRef.current = now
    setIndex((i) => (i + 1) % count)
  }, [count])

  const prev = useCallback(() => {
    if (!count) return
    const now = Date.now()
    if (now - lastSlideRef.current < 200) return
    lastSlideRef.current = now
    setIndex((i) => (i - 1 + count) % count)
  }, [count])

  const goTo = useCallback(
    (idx: number) => {
      if (!count) return
      const now = Date.now()
      if (now - lastSlideRef.current < 200) return
      lastSlideRef.current = now
      setIndex(idx % count)
    },
    [count],
  )

  const pause = useCallback((v: boolean) => {
    setPaused(v)
    if (!v) setEpoch((e) => e + 1)
  }, [])

  // Warm the first 4 slides immediately and the rest right behind in staggered batches
  useEffect(() => {
    carouselItems.slice(0, 4).forEach((it) => warmSlide(it, recordBundle))
    if (carouselItems.length <= 4) return
    const timers: number[] = []
    for (let start = 4; start < carouselItems.length; start += 4) {
      const batch = carouselItems.slice(start, start + 4)
      const t = window.setTimeout(() => batch.forEach((it) => warmSlide(it, recordBundle)), Math.floor(start / 4) * 350)
      timers.push(t)
    }
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [carouselItems, recordBundle])

  // Warm the upcoming slides' artwork & logos so titles/logos are ready on transition
  useEffect(() => {
    if (!count) return
    warmSlide(carouselItems[(index + 1) % count], recordBundle)
    warmSlide(carouselItems[(index + 2) % count], recordBundle)
  }, [index, carouselItems, count, recordBundle])

  useEffect(() => {
    const onVis = () => pause(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [pause])

  useEffect(() => {
    if (paused || count < 2) return
    const t = window.setTimeout(next, INTERVAL)
    return () => window.clearTimeout(t)
  }, [index, paused, epoch, count, next])

  if (!item) return null

  const title = pickTitle(item.title)
  const description = tmdb?.overview || stripHtml(item.description)
  const watchable = item.status !== 'NOT_YET_RELEASED'
  const score = resolveHeroScore(item, tmdb)
  const slideArt = backdropAssignments.get(item.id) ?? {
    backdropPath: tmdb?.backdrop ?? null,
    fallbackBanner: item.bannerImage ?? item.coverImage.extraLarge ?? '',
  }
  const dot = item.status === 'RELEASING' ? 'bg-emerald-400' : item.status === 'NOT_YET_RELEASED' ? 'bg-amber-400' : 'bg-white/50'
  const facts = [formatLabel(item.format), item.seasonYear, item.genres.slice(0, 2).join(', ')].filter(Boolean)

  return (
    <motion.section
      aria-roledescription="carousel"
      className="relative z-0 isolate h-[76svh] min-h-[520px] max-h-[760px] w-full overflow-hidden bg-background text-white lg:h-[82svh] lg:max-h-[820px]"
      style={{ touchAction: 'pan-y' }}
      onMouseEnter={() => pause(true)}
      onMouseLeave={() => pause(false)}
      onPanEnd={(_, info) => {
        if (Math.abs(info.offset.y) > 60) return
        if (info.offset.x < -70) next()
        else if (info.offset.x > 70) prev()
      }}
    >
      {/* Media & Backdrop */}
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden bg-background">
        <AnimatePresence initial={false}>
          <motion.div
            key={item.id}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
          >
            <Backdrop
              backdropPath={slideArt.backdropPath}
              fallbackBanner={slideArt.fallbackBanner}
              loaded={Boolean(currentBundle)}
            />
          </motion.div>
        </AnimatePresence>

        {/* Cinematic dark scrims */}
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 via-black/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
        <div className="absolute inset-0 hidden lg:block bg-gradient-to-r from-black/85 via-black/25 to-transparent" />
      </div>

      {/* Seamless cinematic bottom fill: blends Featured cleanly into website background */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-64 bg-gradient-to-t from-background via-background/85 to-transparent sm:h-72" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-2 z-10 h-10 bg-background" />

      <div className="relative z-20 mx-auto flex h-full w-full max-w-7xl flex-col justify-end px-5 pb-8 sm:px-8 sm:pb-10 lg:pb-12">
        <div className="grid w-full min-w-0 items-end">
          <AnimatePresence initial={false}>
            <motion.div
              key={item.id}
              className="col-start-1 row-start-1 flex min-w-0 flex-col items-center gap-3.5 text-center lg:items-start lg:text-left"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.25, delay: 0.06, ease: 'easeOut' } }}
              exit={{ opacity: 0, pointerEvents: 'none', transition: { duration: 0.12, ease: 'easeOut' } }}
            >
              <Heading key={item.id} title={title} logo={tmdb?.logo ?? null} />

            <Rise i={1} className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 text-[13px] font-medium text-white/80 lg:justify-start">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn('size-2 rounded-full', dot, item.status === 'RELEASING' && 'animate-pulse')} />
                {formatStatus(item.status)}
              </span>
              {score ? (
                <>
                  <span aria-hidden className="text-white/30">|</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-white">
                    <Star className="size-3.5 fill-amber-300 text-amber-300" />
                    {score}
                  </span>
                </>
              ) : null}
              {tmdb?.certification && (
                <>
                  <span aria-hidden className="text-white/30">|</span>
                  <span className="rounded border border-white/40 px-1.5 text-[11px] font-bold leading-4 text-white">{tmdb.certification}</span>
                </>
              )}
              {facts.map((f) => (
                <Fragment key={String(f)}>
                  <span aria-hidden className="text-white/30">|</span>
                  <span>{f}</span>
                </Fragment>
              ))}
              {isWatched && (
                <>
                  <span aria-hidden className="text-white/30">|</span>
                  <WatchedBadge variant="pill" />
                </>
              )}
            </Rise>

            {description && (
              <Rise i={2} className="max-w-md text-sm leading-relaxed text-white/70 lg:max-w-xl">
                <p className="line-clamp-2 sm:line-clamp-3">{description}</p>
              </Rise>
            )}

            <Rise i={3} className="mt-2 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Magnet padding={28}>
                <Link
                  to={watchable ? `/watch/${targetId}?ep=${targetEp}&audio=${getPrefs().audio ?? 'dub'}` : `/anime/${targetId}`}
                  className="inline-flex h-12 sm:h-13 items-center gap-2.5 rounded-full bg-white px-7 sm:px-8 text-[15px] font-bold text-black shadow-xl hover:bg-zinc-200 transition active:scale-95"
                >
                  {watchable ? <Play className="size-4.5 fill-current" /> : <Info className="size-4.5" />}
                  {watchable ? (isResume ? `Continue · Ep ${targetEp}` : 'Watch now') : 'View details'}
                </Link>
              </Magnet>

              <div className="flex items-center gap-2.5">
                <SaveButton media={item} />
                {watchable && (
                  <Link
                    to={`/anime/${targetId}`}
                    aria-label="Details"
                    title="Details"
                    className="grid size-12 place-items-center rounded-full border border-white/25 bg-black/75 text-white transition hover:bg-black/90"
                  >
                    <Info className="size-5" />
                  </Link>
                )}
              </div>
            </Rise>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Pager: story-style pill indicator + dots, perfectly matching mobile & desktop */}
        <div className="mt-6 flex items-center justify-between">
          <div role="tablist" aria-label="Featured anime" className="mx-auto flex items-center gap-2 lg:mx-0">
            {carouselItems.map((it, i) => (
              <button
                key={it.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Show ${pickTitle(it.title)}`}
                onClick={() => goTo(i)}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  i === index ? 'w-8 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/70'
                )}
              />
            ))}
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            {[
              { label: 'Previous', fn: prev, Icon: ChevronLeft },
              { label: 'Next', fn: next, Icon: ChevronRight },
            ].map(({ label, fn, Icon }) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                onClick={fn}
                className="grid size-10 place-items-center rounded-full border border-white/20 bg-black/50 text-white transition hover:bg-white hover:text-black active:scale-90"
              >
                <Icon className="size-4.5" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  )
}
