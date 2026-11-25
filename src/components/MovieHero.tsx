import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Info, Play, Star } from 'lucide-react'
import { cn } from '../lib/utils'
import { img, movieHref, watchHref, type MovieItem } from '../services/movies'
import { isNavClickGuarded, armNavClickGuard } from '../lib/clickGuard'
import { BlurText } from './BlurText'
import { Magnet } from './Magnet'
import { Meteors } from './Meteors'
import { ShimmerButton } from './ShimmerButton'

const INTERVAL = 8000

/** Full-bleed trending carousel for the Movies home: Ken Burns backdrop, meteors, swipe/slide gesture support. */
export function MovieHero({ items, loading }: { items?: MovieItem[]; loading?: boolean }) {
  const list = (items ?? []).filter((m) => m.backdrop).slice(0, 6)
  const [i, setI] = useState(0)
  const [hold, setHold] = useState(false)
  const [epoch, setEpoch] = useState(0)

  const count = list.length

  const next = useCallback(() => {
    if (!count) return
    armNavClickGuard(300)
    setI((n) => (n + 1) % count)
    setEpoch((e) => e + 1)
  }, [count])

  const prev = useCallback(() => {
    if (!count) return
    armNavClickGuard(300)
    setI((n) => (n - 1 + count) % count)
    setEpoch((e) => e + 1)
  }, [count])

  useEffect(() => {
    if (count < 2 || hold) return
    const t = window.setTimeout(next, INTERVAL)
    return () => window.clearTimeout(t)
  }, [i, count, hold, epoch, next])

  const m = list[i % Math.max(count, 1)]

  return (
    <motion.section
      aria-roledescription="carousel"
      className="relative isolate flex min-h-[78svh] items-end overflow-hidden bg-black text-white sm:min-h-[86svh]"
      style={{ touchAction: 'pan-y' }}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onPanEnd={(_, info) => {
        if (Math.abs(info.offset.y) > 60) return
        if (info.offset.x < -50) next()
        else if (info.offset.x > 50) prev()
      }}
    >
      <AnimatePresence initial={false}>
        {m && (
          <motion.div
            key={m.type + m.id}
            className="absolute inset-0 -z-20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1 }}
          >
            <img
              src={img(m.backdrop, 'w1280') ?? ''}
              alt=""
              {...({ fetchpriority: 'high' } as any)}
              className="animate-kenburns h-full w-full object-cover object-[center_20%] grayscale-[0.35]"
            />
          </motion.div>
        )}
      </AnimatePresence>
      {loading && !m && <div className="skeleton absolute inset-0 -z-20" />}
      <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/40 to-black/30" />
      <span aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-32 bg-gradient-to-t from-background via-background/80 to-transparent" />
      <span aria-hidden className="absolute inset-x-0 -bottom-1 -z-10 h-4 bg-background" />
      <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-black/80 via-black/25 to-transparent" />
      <Meteors number={14} />

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-16 pt-32 sm:px-6 sm:pb-24">
        <div className="grid w-full items-end">
          <AnimatePresence initial={false}>
            {m && (
              <motion.div
                key={m.type + m.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.05, ease: 'easeOut' } }}
                exit={{ opacity: 0, pointerEvents: 'none', transition: { duration: 0.14, ease: 'easeOut' } }}
                className="col-start-1 row-start-1 max-w-2xl"
              >
                <p className="mb-3 inline-flex items-center gap-2 eyebrow text-white/80">
                  <span className="rounded-full border border-white/40 px-2 py-0.5">{m.type === 'tv' ? 'Series' : 'Film'}</span>
                  Trending this week
                </p>
                <BlurText key={m.title} text={m.title} className="font-display text-4xl font-black leading-[1.02] tracking-tight drop-shadow-lg [text-wrap:balance]" />
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-white/85">
                  {m.rating && (
                    <span className="inline-flex items-center gap-1 font-semibold">
                      <Star className="size-4 fill-current text-amber-300" />
                      {m.rating.toFixed(1)}
                    </span>
                  )}
                  {m.year && <span>{m.year}</span>}
                </div>
                <p className="mt-4 line-clamp-3 max-w-xl text-sm leading-relaxed text-white/75">{m.overview}</p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Magnet padding={30}>
                    <ShimmerButton
                      to={watchHref(m)}
                      className="!bg-white !text-black"
                      icon={<Play className="size-4 fill-current" />}
                      onClick={(e: React.MouseEvent) => {
                        if (isNavClickGuarded()) e.preventDefault()
                      }}
                    >
                      Play
                    </ShimmerButton>
                  </Magnet>
                  <Link
                    to={movieHref(m)}
                    onClick={(e) => {
                      if (isNavClickGuarded()) e.preventDefault()
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-black/75 px-6 py-3 text-sm font-semibold transition hover:bg-black/90 active:scale-95"
                  >
                    <Info className="size-4" /> Details
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {list.length > 1 && (
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-2" role="tablist" aria-label="Trending titles">
              {list.map((x, n) => (
                <button
                  key={x.type + x.id}
                  type="button"
                  role="tab"
                  aria-selected={n === i}
                  aria-label={x.title}
                  onClick={() => {
                    setI(n)
                    setEpoch((e) => e + 1)
                  }}
                  className="relative h-2 w-10 sm:w-12 overflow-hidden rounded-full bg-white/25 transition-all"
                >
                  {n === i && (
                    <span
                      key={`${i}-${hold}-${epoch}`}
                      className={cn('absolute inset-0 origin-left rounded-full bg-white', !hold && '[animation:hero-progress_8s_linear_forwards]')}
                      style={hold ? { transform: 'scaleX(1)' } : undefined}
                    />
                  )}
                  {n < i && <span className="absolute inset-0 rounded-full bg-white/70" />}
                </button>
              ))}
            </div>

            {/* Next / Previous arrows: works on mobile tap and desktop */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous featured movie"
                title="Previous"
                onClick={prev}
                className="grid size-10 place-items-center rounded-full border border-white/20 bg-black/55 text-white backdrop-blur-md transition hover:bg-white hover:text-black active:scale-90"
              >
                <ChevronLeft className="size-4.5" />
              </button>
              <button
                type="button"
                aria-label="Next featured movie"
                title="Next"
                onClick={next}
                className="grid size-10 place-items-center rounded-full border border-white/20 bg-black/55 text-white backdrop-blur-md transition hover:bg-white hover:text-black active:scale-90"
              >
                <ChevronRight className="size-4.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  )
}
