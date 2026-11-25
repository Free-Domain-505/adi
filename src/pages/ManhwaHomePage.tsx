import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { useAsync } from '../hooks/useAsync'
import { useDebounced } from '../hooks/useDebounced'
import {
  DEFAULT_MANHWA_SOURCE,
  MANHWA_SOURCES,
  isManhwaSource,
  manhwaHref,
  manhwaSourceInfo,
  resolveManhwaSource,
} from '../lib/manhwaModels'
import {
  fetchManhwaCatalog,
  fetchManhwaHome,
  findManhwaOnServersHref,
  proxiedManhwaImage,
  searchAniListManhwa,
  searchManhwa,
  type AniManhwaHit,
  type ManhwaItem,
  type ManhwaScope,
} from '../services/manhwa'
import type { BookCardItem } from '../components/BookCard'
import { BookGrid } from '../components/BookGrid'
import { BookRow } from '../components/BookRow'
import { ContinueReading } from '../components/ContinueReading'
import { DiscoverHero } from '../components/DiscoverHero'
import { ErrorState } from '../components/ErrorState'
import { Tabs } from '../components/Tabs'
import { FeedEnd } from '../components/FeedEnd'

const SOURCE_KEY = 'zk:manhwa-source:v2'
const storedSource = (): ManhwaScope => {
  try {
    const v = localStorage.getItem(SOURCE_KEY)
    return v === 'all' || isManhwaSource(v) ? v : DEFAULT_MANHWA_SOURCE
  } catch {
    return DEFAULT_MANHWA_SOURCE
  }
}

const toCard = (m: ManhwaItem): BookCardItem => ({
  key: `${m.source}:${m.id}`,
  href: manhwaHref(m),
  title: m.title,
  image: proxiedManhwaImage(m.poster, m.source, m.title),
  score: m.score && m.score > 0 && m.score <= 10 ? m.score.toFixed(1) : null,
  badge: m.kind ?? 'Manhwa',
  caption: m.latest ?? (m.chapters ? `${m.chapters} chapters` : m.status),
})

const toAniCard = (m: AniManhwaHit): BookCardItem => ({
  key: `anilist:${m.id}`,
  href: findManhwaOnServersHref(m),
  title: m.title,
  image: m.cover,
  fallbackImage: proxiedManhwaImage(m.cover, DEFAULT_MANHWA_SOURCE, m.title),
  score: m.score ? m.score.toFixed(1) : null,
  badge: m.kind ?? 'Manhwa',
  caption: ['Search all servers', m.year].filter(Boolean).join(' · '),
})

const fetchPopularManhwa = () => fetchManhwaCatalog({ sort: 'POPULARITY_DESC' }, 1)
const fetchTopManhwa = () => fetchManhwaCatalog({ sort: 'SCORE_DESC', minPopularity: 8000 }, 1)

export default function ManhwaHomePage() {
  const [params, setParams] = useSearchParams()
  const urlSource = params.get('source')
  const source: ManhwaScope = urlSource ? (urlSource === 'all' ? 'all' : resolveManhwaSource(urlSource)) : storedSource()
  const everywhere = source === 'all'
  const sourceName = everywhere ? 'any server' : manhwaSourceInfo(source).displayName
  const [query, setQuery] = useState('')
  const term = useDebounced(query.trim(), 400)
  const home = useAsync(() => fetchManhwaHome(source), [source])
  const popular = useAsync(fetchPopularManhwa, [])
  const topRated = useAsync(fetchTopManhwa, [])
  const found = useAsync(() => (term ? searchManhwa(term, source) : Promise.resolve(null)), [term, source])
  const ani = useAsync(() => (term ? searchAniListManhwa(term) : Promise.resolve(null)), [term])

  function setSource(s: ManhwaScope) {
    try {
      localStorage.setItem(SOURCE_KEY, s)
    } catch {
      /* blocked storage: the choice lasts for this visit */
    }
    const next = new URLSearchParams(params)
    if (s === DEFAULT_MANHWA_SOURCE) next.delete('source')
    else next.set('source', s)
    next.delete('search')
    setParams(next, { replace: true })
  }

  useEffect(() => {
    document.title = 'Manhwa — AnimeStream'
  }, [])
  useEffect(() => {
    if (params.get('search') === '1') document.getElementById('discover-search')?.focus()
  }, [params])

  const rows = useMemo(
    () => ({
      trending: home.data?.trending?.map(toCard),
      latest: home.data?.latest?.map(toCard),
      fresh: home.data?.newRelease?.map(toCard),
      popular: popular.data?.items?.map(toAniCard),
      top: topRated.data?.items?.map(toAniCard),
    }),
    [home.data, popular.data, topRated.data],
  )
  const aniResults = useMemo(() => (ani.data ?? []).map(toAniCard), [ani.data])
  const results = useMemo(() => found.data?.map(toCard), [found.data])

  return (
    <main>
      <DiscoverHero
        eyebrow="Manhwa · updated daily"
        title="Scroll the hottest"
        accent="webtoons, fresh every day."
        subtitle="Korean manhwa and full-color webtoons across dedicated scan servers, or search them all at once. Smooth webtoon scroll with automatic progress sync."
        query={query}
        onQuery={setQuery}
        placeholder="Search manhwa…"
      >
        <Tabs
          tabs={[{ id: 'all' as ManhwaScope, label: 'All' }, ...MANHWA_SOURCES.map((x) => ({ id: x.id as ManhwaScope, label: x.displayName }))]}
          value={source}
          onChange={setSource}
        />
      </DiscoverHero>

      <div className="relative z-10 space-y-12 pb-20 sm:space-y-16">
        {term ? (
          <section>
            <div className="mx-auto mb-5 flex max-w-7xl items-end justify-between gap-4 px-4 sm:px-6">
              <div>
                <p className="mb-1 eyebrow text-accent">Search</p>
                <h2 className="font-display text-2xl font-bold tracking-tight">
                  Results for “{term}”{everywhere && <span className="text-muted"> · all servers</span>}
                </h2>
              </div>
              <Link to="/manhwa/browse" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition active:scale-95">
                <Compass className="size-4" /> Browse all
              </Link>
            </div>
            {(ani.loading || aniResults.length > 0) && (
              <div className="mb-12">
                <div className="mx-auto mb-4 max-w-7xl px-4 sm:px-6">
                  <h3 className="font-display text-xl font-bold tracking-tight">Find by name</h3>
                  <p className="text-xs text-muted">Matched on AniList. Pick one and it is looked up on every manhwa server by all of its names.</p>
                </div>
                <BookGrid items={aniResults} loading={ani.loading} empty="" />
              </div>
            )}
            <div className="mx-auto mb-4 max-w-7xl px-4 sm:px-6">
              <h3 className="font-display text-xl font-bold tracking-tight">On {sourceName}</h3>
            </div>
            {found.error ? (
              <ErrorState message={found.error.message} onRetry={found.reload} />
            ) : (
              <BookGrid
                items={results}
                loading={found.loading}
                empty={`Nothing on ${sourceName} under “${term}”.${aniResults.length ? ' Try one of the matches above.' : ''}`}
              />
            )}
          </section>
        ) : home.error ? (
          <ErrorState message={home.error.message} onRetry={home.reload} />
        ) : (
          <>
            <ContinueReading kind="manga" />
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
              <p className="text-sm text-muted">Full-color Korean webtoons &amp; regression hits</p>
              <Link to="/manhwa/browse" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition active:scale-95">
                <Compass className="size-4" /> Browse all
              </Link>
            </div>
            <BookRow eyebrow="Right now" title="Trending Manhwa" items={rows.trending} loading={home.loading} ranked />
            <BookRow eyebrow="Fresh chapters" title="Latest Updates" items={rows.latest} loading={home.loading} />
            <BookRow eyebrow="Just added" title="New Releases" items={rows.fresh} loading={home.loading} />
            {(popular.loading || (rows.popular?.length ?? 0) > 0) && (
              <BookRow eyebrow="Fan favourites" title="Popular Manhwa" items={rows.popular} loading={popular.loading} />
            )}
            {(topRated.loading || (rows.top?.length ?? 0) > 0) && (
              <BookRow eyebrow="Highest rated" title="Top Rated Manhwa" items={rows.top} loading={topRated.loading} />
            )}
            {!home.loading && (
              <FeedEnd
                browseTo="/manhwa/browse"
                browseLabel="Browse All Manhwa"
                subtitle="You've reached the end of the manhwa shelves. Filter the full Korean webtoon & manhwa catalog by genre, theme, year, and status."
              />
            )}
          </>
        )}
      </div>
    </main>
  )
}
