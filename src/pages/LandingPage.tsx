import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, MessageSquare, Shuffle } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '../lib/utils'
import { FadeSlideshow } from '../components/FadeSlideshow'
import { Logo } from '../components/Logo'
import { ThemeToggle } from '../components/ThemeToggle'
import { useCompact, useShowcase } from '../hooks/useShowcase'
import type { ShowcaseImage } from '../services/showcase'

import animeFallback from '../assets/images/showcase_anime_panel_1794666397529.jpg'
import mangaFallback from '../assets/images/showcase_manga_panel_1794666398447.jpg'
import novelFallback from '../assets/images/showcase_novel_panel_1794666398418.jpg'
import moviesFallback from '../assets/images/showcase_movies_panel_1794666398931.jpg'

type Key = 'anime' | 'donghua' | 'manga' | 'manhwa' | 'novel' | 'movies'

interface Section {
  key: Key
  name: string
  kanji: string
  text: string
  to: string
  cta: string
  tint: string
  ink: string
  fallback: string
}

const SECTIONS: Section[] = [
  {
    key: 'anime',
    name: 'Anime',
    kanji: 'アニメ',
    text: 'Stream the latest seasonal hits and classics in crisp HD, sub or dub.',
    to: '/home',
    cta: 'Start watching',
    tint: '#e8294c',
    ink: '#ffffff',
    fallback: animeFallback,
  },
  {
    key: 'donghua',
    name: 'Donghua',
    kanji: '动画',
    text: 'Top Chinese animation, cultivation epics, and fast-paced 3D & 2D series.',
    to: '/donghua',
    cta: 'Start watching',
    tint: '#10b981',
    ink: '#041b11',
    fallback: animeFallback,
  },
  {
    key: 'manga',
    name: 'Manga',
    kanji: '漫画',
    text: 'High-resolution chapters with instant page sync as you read.',
    to: '/manga',
    cta: 'Start reading',
    tint: '#7c73ff',
    ink: '#ffffff',
    fallback: mangaFallback,
  },
  {
    key: 'manhwa',
    name: 'Manhwa',
    kanji: '만화',
    text: 'Full-color Korean webtoons and regression hits built for vertical scroll.',
    to: '/manhwa',
    cta: 'Start reading',
    tint: '#ec4899',
    ink: '#ffffff',
    fallback: mangaFallback,
  },
  {
    key: 'novel',
    name: 'Novels',
    kanji: '小説',
    text: 'A distraction-free typography reader built for long light novels.',
    to: '/novel',
    cta: 'Start reading',
    tint: '#f0a63a',
    ink: '#1a1205',
    fallback: novelFallback,
  },
  {
    key: 'movies',
    name: 'Movies',
    kanji: '映画',
    text: 'Feature films and series across fast multi-mirror servers.',
    to: '/movies',
    cta: 'Start watching',
    tint: '#38bdf8',
    ink: '#04121b',
    fallback: moviesFallback,
  },
]

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function LandingPage() {
  const navigate = useNavigate()
  const pools = useShowcase()
  const stacked = useCompact('(max-width: 1023px)')
  const [active, setActive] = useState<Key | null>('anime')
  const [picked, setPicked] = useState<Key | null>(null)
  const [isShuffling, setIsShuffling] = useState(false)
  const [now, setNow] = useState<Partial<Record<Key, { title: string; art: string }>>>({})
  const timers = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }, [])

  useEffect(() => {
    document.title = 'AnimeStream — Watch Anime Online Free in HD · Movies, Manga & Novels'
    return () => {
      clearTimers()
    }
  }, [clearTimers])

  useEffect(() => {
    const step = (d: number) =>
      setActive((k) => {
        const curIdx = k ? SECTIONS.findIndex((s) => s.key === k) : (d > 0 ? -1 : 0)
        return SECTIONS[(curIdx + d + SECTIONS.length) % SECTIONS.length].key
      })
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= SECTIONS.length) return navigate(SECTIONS[n - 1].to)
      if (e.key === 'ArrowRight' || (stacked && e.key === 'ArrowDown')) (e.preventDefault(), step(1))
      if (e.key === 'ArrowLeft' || (stacked && e.key === 'ArrowUp')) (e.preventDefault(), step(-1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, stacked])

  const onSlideChange = useCallback((k: Key, im: ShowcaseImage) => {
    const art = im.wide || im.src
    setNow((p) => (p[k]?.title === im.title && p[k]?.art === art ? p : { ...p, [k]: { title: im.title, art } }))
  }, [])

  const handleToggle = useCallback((k: Key) => {
    setActive((prev) => (prev === k ? null : k))
  }, [])

  function surprise() {
    clearTimers()
    setIsShuffling(true)
    const start = active ? SECTIONS.findIndex((s) => s.key === active) : 0
    const finish = (k: Key) => {
      setIsShuffling(false)
      setActive(k)
      setPicked(k)
      timers.current.push(window.setTimeout(() => setPicked(null), 1500))
    }
    if (reducedMotion()) {
      return finish(SECTIONS[(start + 1 + Math.floor(Math.random() * (SECTIONS.length - 1))) % SECTIONS.length].key)
    }
    const steps = 7 + Math.floor(Math.random() * SECTIONS.length)
    let t = 0
    for (let i = 1; i <= steps; i++) {
      t += 50 + i * i * 2
      const k = SECTIONS[(start + i) % SECTIONS.length].key
      timers.current.push(window.setTimeout(() => (i === steps ? finish(k) : setActive(k)), t))
    }
  }

  const activeSection = (active ? SECTIONS.find((s) => s.key === active) : null) ?? SECTIONS[0]

  return (
    <main
      style={{ WebkitTapHighlightColor: 'transparent' }}
      className="relative isolate flex min-h-svh flex-col overflow-x-hidden bg-[#f4f4f8] text-foreground transition-colors duration-300 dark:bg-[#09090d]"
    >

      {/* Dynamic Atmospheric Cinema Backdrop */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        {/* Subtle crisp gradient wash keyed to active category */}

        {/* Tinted radial studio spotlight keyed to active category */}
        <div
          className="absolute inset-0 transition-[background] duration-700"
          style={{
            background: `
              radial-gradient(ellipse 78% 58% at 50% 18%, color-mix(in srgb, ${activeSection.tint} 24%, transparent), transparent 72%),
              radial-gradient(ellipse 65% 48% at 82% 88%, color-mix(in srgb, ${activeSection.tint} 16%, transparent), transparent 70%)
            `,
          }}
        />

        {/* Light / Dark balanced vignette scrim so text and cards always stay crisp */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#f4f4f8]/75 via-[#f4f4f8]/55 to-[#f4f4f8]/88 dark:from-[#09090d]/72 dark:via-[#09090d]/58 dark:to-[#09090d]/92" />

        {/* Subtle architectural dot pattern */}
        <div
          className="absolute inset-0 opacity-[0.22] dark:opacity-[0.14]"
          style={{
            backgroundImage: 'radial-gradient(currentColor 0.75px, transparent 0.75px)',
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      <motion.div
        key="landing-page-content"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex min-h-svh flex-col justify-between"
      >
        {/* Clean 3-Zone Top Header */}
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-5 pt-5 sm:px-8 sm:pt-6">
          <Logo size={36} />

          <nav aria-label="Primary sections" className="hidden items-center gap-3 text-sm font-medium text-muted md:flex">
            {SECTIONS.map((s) => (
              <Link
                key={s.key}
                to={s.to}
                className="whitespace-nowrap shrink-0 rounded-lg px-2.5 py-1 transition-[color,background-color,transform] duration-150 hover:bg-foreground/5 hover:text-foreground active:scale-95 active:bg-foreground/10 active:text-foreground"
              >
                {s.name}
              </Link>
            ))}
            <Link
              to="/community"
              className="whitespace-nowrap shrink-0 rounded-lg px-2.5 py-1 transition-[color,background-color,transform] duration-150 hover:bg-foreground/5 hover:text-foreground active:scale-95 active:bg-foreground/10 active:text-foreground"
            >
              Community
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/community"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-[color,background-color,transform] duration-150 hover:bg-card-2 active:scale-95 active:bg-card-2 md:hidden"
            >
              <MessageSquare className="size-3.5" />
              Community
            </Link>
            <ThemeToggle />
          </div>
        </header>

        {/* Main Selector Stage */}
        <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-6 sm:px-8 lg:py-7">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="animate-card-in text-balance font-display text-[clamp(1.9rem,3.6vw,3.15rem)] font-black leading-[1.06] tracking-tight text-foreground">
              What are you in the mood for?
            </h1>
            <p className="mx-auto mt-2.5 max-w-xl text-sm leading-relaxed text-muted sm:text-[15px]">
              Pick a world to jump straight in — anime, donghua, manga, manhwa, light novels, or feature films.
            </p>
          </div>

          <div
            role="group"
            aria-label="Choose a section"
            className={cn(
              'mt-6 sm:mt-8',
              stacked ? 'flex flex-col gap-3' : 'flex h-[clamp(25rem,calc(100svh-18rem),37rem)] gap-3',
            )}
          >
            {SECTIONS.map((s, i) => (
              <Panel
                key={s.key}
                s={s}
                index={i}
                active={active === s.key}
                picked={picked === s.key}
                stacked={stacked}
                images={pools[s.key]}
                title={now[s.key]?.title}
                onActivate={setActive}
                onToggle={handleToggle}
                onSlideChange={onSlideChange}
              />
            ))}
          </div>

          {/* Interactive Actions & Quiet Navigation Cue */}
          <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:mt-6 sm:flex-row sm:gap-5">
            <button
              type="button"
              onClick={surprise}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-[color,background-color,border-color,transform] duration-150 hover:border-foreground/30 hover:bg-card-2 active:scale-[0.96] active:bg-card-2',
                isShuffling && 'border-foreground/30 bg-card-2',
              )}
            >
              <Shuffle className={cn('size-4 text-accent transition-transform duration-300', isShuffling && 'animate-spin')} />
              Can’t decide? Surprise me
            </button>
            <span className="hidden text-xs font-medium text-muted lg:inline">
              Press <span className="tabular-nums font-semibold text-foreground/80">1–6</span> to open ·{' '}
              <span className="font-semibold text-foreground/80">← →</span> to switch
            </span>
          </div>
        </section>

        <footer className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 pb-5 text-xs text-muted sm:px-8">
          <span>AnimeStream</span>
          <span>Anime · Donghua · Manga · Manhwa · Novels · Movies</span>
        </footer>
      </motion.div>
    </main>
  )
}

function Panel({
  s,
  index,
  active,
  picked,
  stacked,
  images,
  title,
  onActivate,
  onToggle,
  onSlideChange,
}: {
  s: Section
  index: number
  active: boolean
  picked: boolean
  stacked: boolean
  images: ShowcaseImage[]
  title?: string
  onActivate: (k: Key) => void
  onToggle: (k: Key) => void
  onSlideChange: (k: Key, im: ShowcaseImage) => void
}) {
  const [pressed, setPressed] = useState(false)

  const onClick = (e: RMouseEvent) => {
    const touchy = stacked || window.matchMedia('(hover: none)').matches
    if (touchy) {
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-landing-cta]')) {
        return
      }
      e.preventDefault()
      onToggle(s.key)
    }
  }

  const onPointerDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    setPressed(true)
  }

  const clearPress = () => setPressed(false)

  const style = {
    animationDelay: `${80 + index * 70}ms`,
    WebkitTapHighlightColor: 'transparent',
    background: `linear-gradient(168deg, color-mix(in srgb, ${s.tint} 26%, #0b0c11) 0%, #06070b 65%, #040407 100%)`,
    boxShadow: picked
      ? '0 0 0 2px rgba(255,255,255,0.85), 0 20px 48px -20px rgba(0,0,0,0.6)'
      : active
        ? '0 24px 60px -24px rgba(0,0,0,0.55), 0 12px 30px -15px rgba(0,0,0,0.45)'
        : '0 10px 28px -18px rgba(0,0,0,0.35)',
  } as CSSProperties

  const cta = (
    <span
      data-landing-cta
      className="mt-4 inline-flex w-fit items-center gap-2 whitespace-nowrap shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold shadow-lg transition-[gap,transform] duration-150 group-hover:gap-3 group-active:scale-95 cursor-pointer"
      style={{ background: s.tint, color: s.ink }}
    >
      {s.cta}
      <ArrowUpRight className="size-4" />
    </span>
  )

  return (
    <Link
      to={s.to}
      aria-label={`${s.name}: ${s.cta.toLowerCase()}`}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerLeave={clearPress}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse' && !stacked) onActivate(s.key)
      }}
      onFocus={(e) => {
        if (e.currentTarget.matches(':focus-visible')) onActivate(s.key)
      }}
      style={style}
      className={cn(
        'group relative isolate block animate-card-in overflow-hidden rounded-2xl bg-[#040407] text-white outline-none duration-500 ease-[cubic-bezier(.22,.8,.2,1)] focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none sm:rounded-[1.5rem]',
        pressed && 'scale-[0.985]',
        picked
          ? 'ring-2 ring-white/90'
          : active
            ? 'ring-1 ring-white/25'
            : 'ring-1 ring-black/15 dark:ring-white/12',
        stacked
          ? cn('w-full shrink-0 transition-[height,box-shadow,transform]', active ? 'h-[min(19.5rem,44svh)]' : 'h-[4.65rem]')
          : cn('h-full min-w-[5rem] transition-[flex-grow,box-shadow,transform]', active ? 'flex-[4.2]' : 'flex-1'),
      )}
    >
      <FadeSlideshow
        images={images}
        fallbackSrc={s.fallback}
        preferWide={stacked}
        interval={7600 + index * 1300}
        delay={80 + index * 120}
        className={cn('-z-20 transition-transform duration-700', active ? 'group-hover:scale-[1.03]' : 'scale-[1.02]')}
        imgClassName={active ? undefined : 'saturate-90'}
        onChange={(im) => onSlideChange(s.key, im)}
      />

      {/* Contrast scrims: collapsed panels dim cleanly without becoming muddy black; active panels open up */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute -inset-[2px] -z-10 bg-[#040407] transition-opacity duration-500',
          active ? 'opacity-10' : 'opacity-45 group-hover:opacity-30',
        )}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-[2px] -z-10"
        style={{
          background:
            'linear-gradient(to top, #040407 0%, #040407 6%, rgba(4,4,7,0.92) 20%, rgba(4,4,7,0.46) 48%, rgba(4,4,7,0.14) 100%)',
        }}
      />
      {/* Subtle top edge accent rim on active panel */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-[2px] transition-opacity duration-500',
          active ? 'opacity-90' : 'opacity-0',
        )}
        style={{ background: `linear-gradient(90deg, transparent, ${s.tint}, transparent)` }}
      />

      {stacked ? (
        <div className={cn('relative flex h-full flex-col p-4 sm:p-5', active ? 'justify-end' : 'justify-center')}>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold tabular-nums text-white/55">0{index + 1}</span>
            <span className="font-display text-xl font-black leading-none" style={{ color: s.tint }}>
              {s.kanji}
            </span>
            <h2 className="font-display text-xl font-black tracking-tight text-white">{s.name}</h2>
            <div
              className={cn(
                'ml-auto grid size-8 shrink-0 place-items-center rounded-xl transition-colors duration-200',
                active ? 'bg-white/10 text-white' : 'text-white/70 group-hover:bg-white/5 group-hover:text-white',
              )}
              aria-label={active ? `Collapse ${s.name}` : `Expand ${s.name}`}
            >
              <ChevronDown
                className={cn('size-5 transition-transform duration-500', active && 'rotate-180')}
              />
            </div>
          </div>
          <div
            className={cn(
              'grid transition-[grid-template-rows,opacity] duration-500',
              active ? 'mt-2 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
            )}
          >
            <div className="min-h-0 overflow-hidden" aria-hidden={!active}>
              <p className="max-w-[38ch] text-sm leading-snug text-white/85">{s.text}</p>
              {cta}
              {title && <p className="mt-3 truncate text-xs text-white/60">Featuring: {title}</p>}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Collapsed desktop vertical strip */}
          <div
            aria-hidden={active}
            className={cn(
              'absolute inset-0 flex flex-col items-center justify-between py-6 transition-opacity duration-300',
              active ? 'pointer-events-none opacity-0' : 'opacity-100 delay-150',
            )}
          >
            <span className="font-mono text-xs font-semibold tabular-nums text-white/60">0{index + 1}</span>
            <span className="font-display text-3xl font-black [writing-mode:vertical-rl]" style={{ color: s.tint }}>
              {s.kanji}
            </span>
            <span className="rotate-180 font-display text-sm font-bold tracking-wide text-white/85 [writing-mode:vertical-rl]">
              {s.name}
            </span>
          </div>

          {/* Expanded desktop panel */}
          <div
            aria-hidden={!active}
            className={cn(
              'absolute inset-0 flex flex-col justify-between overflow-hidden p-7 lg:p-8 transition-opacity duration-300',
              active ? 'opacity-100 delay-150' : 'pointer-events-none opacity-0',
            )}
          >
            {/* Top metadata row — clean unboxed editorial typography */}
            <div className="flex items-center justify-between gap-4 text-xs font-medium text-white/70">
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono font-bold tabular-nums text-white">0{index + 1}</span>
                <span aria-hidden>·</span>
                <span className="font-semibold" style={{ color: s.tint }}>
                  {s.kanji}
                </span>
                {title && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate text-white/75">Featuring {title}</span>
                  </>
                )}
              </div>
              <span className="hidden shrink-0 font-mono text-[11px] text-white/55 sm:inline">Key {index + 1}</span>
            </div>

            {/* Bottom headline, copy & primary action */}
            <div className="min-w-[18rem]">
              <h2 className="font-display text-4xl font-black tracking-tight text-white lg:text-5xl">{s.name}</h2>
              <p className="mt-2.5 max-w-[36ch] text-sm leading-relaxed text-white/85 lg:text-base">{s.text}</p>
              {cta}
            </div>
          </div>
        </>
      )}
    </Link>
  )
}
