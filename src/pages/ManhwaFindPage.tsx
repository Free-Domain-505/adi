import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CircleAlert, LoaderCircle, Search } from 'lucide-react'
import { MANHWA_SOURCES, manhwaHref, type ManhwaSourceId } from '../lib/manhwaModels'
import { useSafeBack } from '../lib/backToDetails'
import { bestSimilarity, MATCH_AT, searchVariants } from '../lib/match'
import { proxiedManhwaImage, searchManhwa } from '../services/manhwa'
import { BookCard, type BookCardItem } from '../components/BookCard'
import { Reveal } from '../components/Reveal'

interface Hit extends BookCardItem {
  similarity: number
}
interface Lane {
  id: ManhwaSourceId
  label: string
  status: 'loading' | 'done'
  hits: Hit[]
}

export default function ManhwaFindPage() {
  const [p] = useSearchParams()
  const title = p.get('title') ?? ''
  const alt = p.get('alt') ?? ''
  const cover = p.get('cover') ?? ''
  if (!title) return <FindEmptyPage />
  return <Finder key={`manhwa:${title}`} title={title} alt={alt} cover={cover} />
}

function FindEmptyPage() {
  const navigate = useNavigate()
  const back = useSafeBack('/manhwa')
  const [query, setQuery] = useState('')

  return (
    <main className="mx-auto max-w-4xl px-4 pb-28 pt-12 sm:px-6">
      <button
        type="button"
        onClick={back}
        className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-card-2"
      >
        <ArrowLeft className="size-4" /> Back
      </button>
      <div className="rounded-3xl border border-border bg-card p-8 text-center sm:p-12">
        <p className="eyebrow text-accent">Find manhwa</p>
        <h1 className="mt-2 font-display text-3xl font-black tracking-tight">Search servers for manhwa</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">Enter a title to check every manhwa server at once.</p>
        <form
          className="mx-auto mt-6 flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const t = query.trim()
            if (t) navigate(`/manhwa/find?${new URLSearchParams({ title: t })}`, { replace: true })
          }}
        >
          <label className="relative block flex-1">
            <span className="sr-only">Title</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter manhwa title…"
              className="h-11 w-full rounded-full border border-border bg-card-2 pl-10 pr-4 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <button type="submit" className="h-11 rounded-full bg-accent px-6 text-sm font-semibold text-accent-fg transition active:scale-95">
            Find
          </button>
        </form>
      </div>
    </main>
  )
}

function Finder({ title, alt, cover }: { title: string; alt: string; cover: string }) {
  const navigate = useNavigate()
  const back = useSafeBack('/manhwa')
  const [again, setAgain] = useState('')
  const names = useMemo(() => [title, ...alt.split('|').filter(Boolean)], [title, alt])
  const [lanes, setLanes] = useState<Lane[]>(() => MANHWA_SOURCES.map((s) => ({ id: s.id, label: s.displayName, status: 'loading', hits: [] })))
  const [more, setMore] = useState(false)

  useEffect(() => {
    document.title = `Read ${title} — AnimeStream`
  }, [title])

  useEffect(() => {
    let live = true
    const variants = searchVariants(names)
    for (const src of MANHWA_SOURCES) {
      void (async () => {
        const seen = new Map<string, Hit>()
        for (const v of variants) {
          const found = await searchManhwa(v, src.id)
            .then((items) =>
              items.map((m): BookCardItem => {
                const sim = bestSimilarity(m.title, names)
                return {
                  key: `${m.source}:${m.id}`,
                  href: manhwaHref(m),
                  title: m.title,
                  image: proxiedManhwaImage(m.poster, m.source, m.title),
                  fallbackImage: cover && sim >= 0.55 ? cover : proxiedManhwaImage('', m.source, m.title),
                  badge: m.kind ?? 'Manhwa',
                  score: m.score && m.score > 0 && m.score <= 10 ? m.score.toFixed(1) : null,
                  caption: m.latest ?? (m.chapters ? `${m.chapters} chapters` : m.status),
                }
              }),
            )
            .catch(() => [] as BookCardItem[])
          for (const f of found) if (!seen.has(f.key)) seen.set(f.key, { ...f, similarity: bestSimilarity(f.title, names) })
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
  const allHits = lanes.flatMap((l) => l.hits.map((h) => ({ ...h, lane: l.label }))).sort((a, b) => b.similarity - a.similarity)
  const seen = new Set<string>()
  const uniqueHits = allHits.filter((h) => {
    if (seen.has(h.href)) return false
    seen.add(h.href)
    return true
  })
  const matches = uniqueHits.filter((h) => h.similarity >= 0.35 || uniqueHits.indexOf(h) < 6)
  const similar = uniqueHits.filter((h) => !matches.includes(h))
  const missing = lanes.filter((l) => l.status === 'done' && !l.hits.some((h) => h.similarity >= 0.35))

  const card = (h: Hit & { lane: string }, i: number) => (
    <BookCard key={h.key} index={i} fluid item={{ ...h, caption: [h.lane, h.caption].filter(Boolean).join(' · ') }} />
  )

  return (
    <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 md:pt-10">
      <button
        type="button"
        onClick={back}
        className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-card-2"
      >
        <ArrowLeft className="size-4" /> Back
      </button>

      <header className="flex items-center gap-4 sm:gap-6">
        {cover && <img src={cover} alt="" referrerPolicy="no-referrer" className="aspect-[2/3] w-20 shrink-0 rounded-2xl border border-border object-cover shadow-xl sm:w-28" />}
        <div className="min-w-0">
          <p className="mb-1 eyebrow text-accent">Read the manhwa</p>
          <h1 className="font-display text-3xl font-black leading-tight tracking-tight [text-wrap:balance]">{title}</h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted" role="status">
            {searching > 0 ? (
              <>
                <LoaderCircle className="size-4 animate-spin" /> Checking {searching} of {lanes.length} servers…
              </>
            ) : matches.length > 0 ? (
              <>Found on {lanes.length - missing.length} of {lanes.length} servers. Pick one to open it.</>
            ) : (
              <>
                <CircleAlert className="size-4" /> No server has it under this name.
              </>
            )}
          </p>
        </div>
      </header>

      <Reveal>
        <section className="mt-10">
          {matches.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">{matches.map(card)}</div>
          ) : searching === 0 ? (
            <p className="rounded-3xl border border-border bg-card/60 p-8 text-center text-sm text-muted">
              Nothing matched “{title}” closely.{' '}
              <Link to="/manhwa?search=1" className="font-semibold text-accent hover:underline">
                Search manhwa yourself
              </Link>
              {similar.length > 0 && ' or look through the similar titles below.'}
            </p>
          ) : null}
        </section>

        {searching === 0 && (
          <form
            className="mt-8 flex max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const t = again.trim()
              if (t) navigate(`/manhwa/find?${new URLSearchParams({ title: t })}`)
            }}
          >
            <label className="relative block flex-1">
              <span className="sr-only">Search under another name</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input value={again} onChange={(e) => setAgain(e.target.value)} placeholder="Try another name…" className="h-10 w-full rounded-full border border-border bg-card/60 pl-10 pr-4 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/30" />
            </label>
            <button type="submit" className="h-10 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition active:scale-95">
              Search
            </button>
          </form>
        )}

        {missing.length > 0 && matches.length > 0 && (
          <p className="mt-8 text-xs text-muted">Not found on {missing.map((m) => m.label).join(', ')}.</p>
        )}

        {similar.length > 0 && (
          <section className="mt-10">
            <button type="button" onClick={() => setMore((m) => !m)} className="text-sm font-semibold text-accent hover:underline">
              {more ? 'Hide' : 'Show'} {similar.length} similar titles
            </button>
            {more && <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">{similar.map(card)}</div>}
          </section>
        )}
      </Reveal>
    </main>
  )
}
