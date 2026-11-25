import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, CheckCircle2, CircleAlert, Compass, LoaderCircle, Search, Sparkles } from 'lucide-react'
import { useAsync } from '../hooks/useAsync'
import { bestSimilarity, MATCH_AT, searchVariants } from '../lib/match'
import { cn } from '../lib/utils'
import { fetchNovelHome, NOVEL_SOURCES, searchNovels, type NovelItem, type NovelSource } from '../services/novel'
import { BookCard, type BookCardItem } from '../components/BookCard'
import { BookRow } from '../components/BookRow'
import { Reveal } from '../components/Reveal'
import { useSafeBack } from '../lib/backToDetails'

interface Hit extends BookCardItem {
  similarity: number
  sourceId: NovelSource
  laneLabel: string
}

interface Lane {
  id: NovelSource
  label: string
  status: 'loading' | 'done'
  hits: Hit[]
}

const SOURCE_META: Record<NovelSource, { tag: string; note: string }> = {
  novelfire: { tag: 'Web Novels', note: 'Fast daily updates & broad fantasy catalog' },
  novelfull: { tag: 'Archive', note: 'Completed classics & long-running cultivation hits' },
  webnovel: { tag: 'Originals', note: 'Official translations & serialized exclusives' },
  lnori: { tag: 'Light Novels', note: 'Illustrated Japanese volumes & EPUB-style editions' },
}

const QUICK_TITLES = [
  'Shadow Slave',
  'Lord of the Mysteries',
  "Omniscient Reader's Viewpoint",
  'The Beginning After the End',
  'Reverend Insanity',
  'Solo Leveling',
]

const toNovelCard = (n: NovelItem): BookCardItem => ({
  key: `${n.source}:${n.slug}`,
  href: `/novel/${n.source}/${encodeURIComponent(n.slug)}`,
  title: n.title,
  image: n.cover,
  score: n.rating,
  caption: n.stats,
  genres: n.genres,
})

export default function NovelFindPage() {
  const [p] = useSearchParams()
  const title = p.get('title') ?? ''
  const alt = p.get('alt') ?? ''
  const cover = p.get('cover') ?? ''
  if (!title) return <NovelFindLanding />
  return <NovelFinder key={`novel:${title}`} title={title} alt={alt} cover={cover} />
}

function NovelFindLanding() {
  const navigate = useNavigate()
  const back = useSafeBack('/novel')
  const [query, setQuery] = useState('')
  const preview = useAsync(() => fetchNovelHome('novelfire'), [])

  useEffect(() => {
    document.title = 'Find Novels — AnimeStream'
  }, [])

  const popularCards = useMemo(
    () => (preview.data?.rankings ?? preview.data?.popular ?? []).slice(0, 12).map(toNovelCard),
    [preview.data],
  )

  const goSearch = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    navigate(`/novel/find?${new URLSearchParams({ title: t })}`)
  }

  return (
    <main className="pb-24">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-b from-card/70 via-background to-background px-4 pb-12 pt-8 sm:px-6 sm:pt-12">
        <div aria-hidden className="pointer-events-none absolute -top-28 left-1/2 h-72 w-[38rem] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl" />

        <div className="relative mx-auto max-w-6xl">
          <div className="mb-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={back}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:border-foreground/30 hover:bg-card-2"
            >
              <ArrowLeft className="size-4" /> Back
            </button>
            <Link
              to="/novel"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-2 text-xs font-semibold text-muted transition hover:border-accent hover:text-foreground"
            >
              <Compass className="size-3.5 text-accent" />
              Novel Hub
            </Link>
          </div>

          <div className="rounded-3xl border border-border/80 bg-card p-6 shadow-2xl shadow-black/20 sm:p-10">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-1.5 eyebrow text-accent">
                <Sparkles className="size-3.5" /> Multi-Source Novel Locator
              </p>
              <h1 className="mt-2 font-display text-3xl font-black tracking-tight sm:text-4xl [text-wrap:balance]">
                Find any novel across every reading server.
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                Search by English, romaji, or alternative title to compare availability, chapter counts, and editions across NovelFire, NovelFull, WebNovel, and Lnori in one pass.
              </p>
            </div>

            <form
              className="mt-7 flex flex-col gap-2.5 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault()
                goSearch(query)
              }}
            >
              <label className="relative block flex-1">
                <span className="sr-only">Novel title</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Enter a light novel or web novel title…"
                  autoFocus
                  className="h-12 w-full rounded-2xl border border-border bg-card-2 pl-11 pr-4 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
                />
              </label>
              <button
                type="submit"
                disabled={!query.trim()}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-accent px-7 text-sm font-bold text-accent-fg shadow-lg shadow-accent/20 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                <Search className="size-4" />
                Search All Servers
              </button>
            </form>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted">Popular searches:</span>
              {QUICK_TITLES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => goSearch(t)}
                  className="rounded-xl border border-border/80 bg-card-2/80 px-3 py-1.5 text-xs font-medium text-foreground/90 transition hover:border-accent/60 hover:bg-accent/10 hover:text-accent active:scale-95"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {NOVEL_SOURCES.map((src) => {
              const meta = SOURCE_META[src.id]
              return (
                <Link
                  key={src.id}
                  to={`/novel?source=${src.id}`}
                  className="group rounded-2xl border border-border/70 bg-card/60 p-4 transition hover:border-accent/50 hover:bg-card"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-bold text-foreground group-hover:text-accent transition-colors">
                      {src.label}
                    </span>
                    <span className="rounded-lg bg-card-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                      {meta.tag}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">{meta.note}</p>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {(preview.loading || popularCards.length > 0) && (
        <div className="mt-10">
          <BookRow eyebrow="Ready to read" title="Trending Web Novels" items={popularCards} loading={preview.loading} ranked />
        </div>
      )}
    </main>
  )
}

function NovelFinder({ title, alt, cover }: { title: string; alt: string; cover: string }) {
  const navigate = useNavigate()
  const back = useSafeBack('/novel/find')
  const [again, setAgain] = useState(title)
  const [selectedLane, setSelectedLane] = useState<'all' | NovelSource>('all')
  const names = useMemo(() => [title, ...alt.split('|').filter(Boolean)], [title, alt])
  const [lanes, setLanes] = useState<Lane[]>(() =>
    NOVEL_SOURCES.map((s) => ({ id: s.id, label: s.label, status: 'loading', hits: [] })),
  )
  const [more, setMore] = useState(false)

  useEffect(() => {
    document.title = `Find "${title}" — Novels · AnimeStream`
  }, [title])

  useEffect(() => {
    let live = true
    const variants = searchVariants(names)
    for (const src of NOVEL_SOURCES) {
      void (async () => {
        const seen = new Map<string, Hit>()
        for (const v of variants) {
          const found = await searchNovels(src.id, v)
            .then((items) =>
              items.map((n): BookCardItem => ({
                key: `${n.source}:${n.slug}`,
                href: `/novel/${n.source}/${encodeURIComponent(n.slug)}`,
                title: n.title,
                image: n.cover,
                score: n.rating,
                caption: n.stats,
                genres: n.genres,
              })),
            )
            .catch(() => [] as BookCardItem[])
          for (const f of found) {
            if (!seen.has(f.key)) {
              seen.set(f.key, {
                ...f,
                similarity: bestSimilarity(f.title, names),
                sourceId: src.id,
                laneLabel: src.label,
              })
            }
          }
          if ([...seen.values()].some((h) => h.similarity >= MATCH_AT)) break
        }
        const hits = [...seen.values()].sort((a, b) => b.similarity - a.similarity)
        if (live) setLanes((old) => old.map((l) => (l.id === src.id ? { ...l, status: 'done', hits } : l)))
      })()
    }
    return () => {
      live = false
    }
  }, [names])

  const searching = lanes.filter((l) => l.status === 'loading').length
  const scopedLanes = selectedLane === 'all' ? lanes : lanes.filter((l) => l.id === selectedLane)
  const allHits = scopedLanes.flatMap((l) => l.hits).sort((a, b) => b.similarity - a.similarity)
  const seen = new Set<string>()
  const uniqueHits = allHits.filter((h) => {
    if (seen.has(h.href)) return false
    seen.add(h.href)
    return true
  })
  const matches = uniqueHits.filter((h) => h.similarity >= 0.35 || uniqueHits.indexOf(h) < 8)
  const similar = uniqueHits.filter((h) => !matches.includes(h))
  const matchedServers = lanes.filter((l) => l.hits.some((h) => h.similarity >= 0.35)).length

  const renderCard = (h: Hit, i: number) => (
    <BookCard
      key={h.key}
      index={i}
      fluid
      item={{
        ...h,
        badge: h.laneLabel,
        caption: h.caption || 'Open details',
      }}
    />
  )

  return (
    <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pt-10">
      <div className="mb-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={back}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:border-foreground/30 hover:bg-card-2"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        <Link
          to="/novel/find"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold text-muted transition hover:border-accent hover:text-foreground"
        >
          <BookOpen className="size-3.5 text-accent" /> New Search
        </Link>
      </div>

      <header className="rounded-3xl border border-border/80 bg-card p-5 shadow-xl shadow-black/15 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 sm:gap-5 min-w-0">
            {cover && (
              <img
                src={cover}
                alt=""
                referrerPolicy="no-referrer"
                className="aspect-[2/3] w-16 shrink-0 rounded-2xl border border-border object-cover shadow-lg sm:w-20"
              />
            )}
            <div className="min-w-0">
              <p className="eyebrow text-accent">Multi-Server Novel Search</p>
              <h1 className="mt-1 truncate font-display text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
              <p className="mt-1.5 flex items-center gap-2 text-xs sm:text-sm text-muted" role="status">
                {searching > 0 ? (
                  <>
                    <LoaderCircle className="size-4 shrink-0 animate-spin text-accent" />
                    <span>Scanning {searching} of {lanes.length} novel servers…</span>
                  </>
                ) : matches.length > 0 ? (
                  <>
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                    <span>
                      Found {matches.length} edition{matches.length === 1 ? '' : 's'} across {matchedServers || 1} server{matchedServers === 1 ? '' : 's'}.
                    </span>
                  </>
                ) : (
                  <>
                    <CircleAlert className="size-4 shrink-0 text-amber-400" />
                    <span>No close match found under this title.</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <form
            className="flex w-full gap-2 sm:w-auto sm:min-w-[19rem]"
            onSubmit={(e) => {
              e.preventDefault()
              const t = again.trim()
              if (t) navigate(`/novel/find?${new URLSearchParams({ title: t })}`)
            }}
          >
            <label className="relative block flex-1">
              <span className="sr-only">Search another title</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                placeholder="Search another title…"
                className="h-10 w-full rounded-xl border border-border bg-card-2 pl-10 pr-3 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
              />
            </label>
            <button
              type="submit"
              className="h-10 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg transition hover:brightness-110 active:scale-95"
            >
              Search
            </button>
          </form>
        </div>

        {/* Live per-server status & filter bar */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <button
            type="button"
            onClick={() => setSelectedLane('all')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition',
              selectedLane === 'all'
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-border bg-card-2/70 text-muted hover:text-foreground',
            )}
          >
            <span>All Servers</span>
            <span className={cn('rounded-md px-1.5 py-0.5 text-[10px]', selectedLane === 'all' ? 'bg-black/20 text-accent-fg' : 'bg-card text-foreground')}>
              {lanes.reduce((sum, l) => sum + l.hits.length, 0)}
            </span>
          </button>

          {lanes.map((lane) => {
            const on = selectedLane === lane.id
            return (
              <button
                key={lane.id}
                type="button"
                onClick={() => setSelectedLane(lane.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition',
                  on
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-border bg-card-2/70 text-muted hover:text-foreground',
                )}
              >
                {lane.status === 'loading' && <LoaderCircle className="size-3 animate-spin" />}
                <span>{lane.label}</span>
                <span className={cn('rounded-md px-1.5 py-0.5 text-[10px]', on ? 'bg-black/20 text-accent-fg' : 'bg-card text-foreground')}>
                  {lane.status === 'loading' ? '…' : lane.hits.length}
                </span>
              </button>
            )
          })}
        </div>
      </header>

      <Reveal>
        <section className="mt-8">
          {matches.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
              {matches.map(renderCard)}
            </div>
          ) : searching > 0 ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="space-y-3">
                  <div className="skeleton aspect-[2/3] w-full rounded-2xl" />
                  <div className="skeleton h-4 w-4/5 rounded-md" />
                  <div className="skeleton h-3 w-1/2 rounded-md" />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-border bg-card/60 p-10 text-center">
              <p className="text-sm font-semibold text-foreground">
                Nothing matched “{title}”{selectedLane !== 'all' ? ` on ${lanes.find((l) => l.id === selectedLane)?.label}` : ''}.
              </p>
              <p className="mt-1.5 text-xs text-muted">
                Try switching back to All Servers, searching an alternative title above, or browsing the{' '}
                <Link to="/novel?search=1" className="font-semibold text-accent hover:underline">
                  Novel Hub
                </Link>
                .
              </p>
            </div>
          )}
        </section>

        {similar.length > 0 && (
          <section className="mt-10 border-t border-border/60 pt-6">
            <button
              type="button"
              onClick={() => setMore((m) => !m)}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/70 px-4 py-2 text-xs font-semibold text-foreground transition hover:border-accent hover:text-accent"
            >
              {more ? 'Hide' : 'Show'} {similar.length} related results
            </button>
            {more && (
              <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
                {similar.map(renderCard)}
              </div>
            )}
          </section>
        )}
      </Reveal>
    </main>
  )
}
