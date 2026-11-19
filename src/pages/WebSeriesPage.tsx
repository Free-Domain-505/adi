import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Play, Search, Tv } from 'lucide-react';
import type { MovieItem } from '../types';
import { browseMovies, fetchMoviesHome, searchMovies } from '../lib/api';
import { HubBar } from '../components/HubBar';
import { MediaRow } from '../components/MediaRow';
import { MediaCard } from '../components/MediaCard';
import { MediaImage } from '../components/MediaImage';

const SERIES_GENRES = [
  'All',
  'Action',
  'Drama',
  'Crime',
  'Thriller',
  'Sci-Fi & Fantasy',
  'Comedy',
  'Mystery',
  'Animation',
];

export default function WebSeriesPage() {
  const [home, setHome] = useState<Awaited<ReturnType<typeof fetchMoviesHome>> | null>(null);
  const [genre, setGenre] = useState('All');
  const [sort, setSort] = useState<'popular' | 'rating'>('popular');
  const [browseItems, setBrowseItems] = useState<MovieItem[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MovieItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHome = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMoviesHome();
      setHome(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load web series');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    setBrowseLoading(true);
    try {
      const res = await browseMovies({
        type: 'tv',
        sort,
        genre: genre === 'All' ? undefined : genre,
      });
      setBrowseItems(res.results);
    } catch {
      setBrowseItems([]);
    } finally {
      setBrowseLoading(false);
    }
  }, [genre, sort]);

  useEffect(() => {
    document.title = 'Web Series (Hindi & English Dub) — Anime by Adi 💀';
    loadHome();
  }, [loadHome]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await searchMovies(q);
        if (!cancelled) {
          const tvOnly = res.results.filter((item) => item.type === 'tv');
          setSearchResults(tvOnly.length > 0 ? tvOnly : res.results);
        }
      } catch {
        if (!cancelled) setSearchResults([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const spotlight = home?.popularSeries?.[0];

  const renderCards = (items?: MovieItem[]) =>
    (items || []).map((item) => (
      <div key={`tv:${item.id}`} className="w-[148px] sm:w-[172px] md:w-[186px] shrink-0 snap-start">
        <MediaCard
          href={`/movies/tv/${item.id}`}
          title={item.title}
          image={item.poster}
          kicker="Hindi & Eng Dub"
          meta={['Web Series', item.year, item.rating ? `${item.rating} ★` : null]
            .filter(Boolean)
            .join(' · ')}
        />
      </div>
    ));

  return (
    <main className="min-h-screen bg-canvas pb-16">
      {spotlight && (
        <section className="relative h-[62svh] min-h-[430px] max-h-[600px] w-full overflow-hidden bg-canvas">
          <div className="animate-kenburns absolute inset-0">
            <MediaImage
              src={spotlight.backdrop || spotlight.poster}
              alt={spotlight.title}
              loading="eager"
              className="h-full w-full object-cover object-[center_20%]"
            />
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/60 to-canvas/20" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-canvas/95 via-canvas/55 to-transparent" />

          <div className="relative mx-auto flex h-full max-w-7xl flex-col justify-end px-4 pb-12 sm:px-6">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal tabular-nums">
                <Tv className="size-3.5" />
                <span>
                  Featured Web Series · Hindi &amp; English Dub ·{' '}
                  {[spotlight.year, spotlight.rating ? `${spotlight.rating} ★` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </p>
              <h1
                className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-5xl"
                style={{ textWrap: 'balance' }}
              >
                {spotlight.title}
              </h1>
              {spotlight.description && (
                <p className="mt-3 line-clamp-2 max-w-xl text-sm text-muted sm:text-[15px]">
                  {spotlight.description}
                </p>
              )}
              <div className="mt-5 flex items-center gap-3">
                <Link
                  to={`/movies/watch/tv/${spotlight.id}?s=1&e=1`}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink"
                >
                  <Play className="size-4 fill-current" />
                  <span>Watch S1 E1</span>
                </Link>
                <Link
                  to={`/movies/tv/${spotlight.id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface/85 px-4 py-2.5 text-sm font-semibold text-ink"
                >
                  <Info className="size-4 text-muted" />
                  <span>Episodes &amp; Info</span>
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className={spotlight ? 'pt-6' : 'pt-20'}>
        <HubBar />
      </div>

      {/* Filter & Search Bar */}
      <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">
              Web Series Hub
            </h2>
            <p className="text-xs text-muted">
              Stream trending global &amp; Indian web series in Hindi Dub &amp; English Dub
            </p>
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search web series..."
              className="w-full rounded-lg border border-line bg-surface py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {!query.trim() && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1">
              {SERIES_GENRES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGenre(g)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    genre === g
                      ? 'bg-accent text-accent-ink'
                      : 'bg-surface text-muted hover:bg-surface-2 hover:text-ink'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-surface p-1">
              {(['popular', 'rating'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSort(s)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    sort === s ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
                  }`}
                >
                  {s === 'popular' ? 'Most Popular' : 'Top Rated'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {query.trim() && searchResults ? (
        <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
          <h3 className="mb-4 font-display text-xl font-bold text-ink">
            Results for &ldquo;{query}&rdquo;
          </h3>
          {searchResults.length === 0 ? (
            <p className="text-sm text-muted">No web series matched your search.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {searchResults.map((item) => (
                <MediaCard
                  key={`${item.type}:${item.id}`}
                  href={`/movies/${item.type}/${item.id}`}
                  title={item.title}
                  image={item.poster}
                  kicker="Hindi & Eng Dub"
                  meta={[item.type === 'tv' ? 'Web Series' : 'Movie', item.year, item.rating ? `${item.rating} ★` : null]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-10 space-y-12">
          {genre === 'All' && (
            <>
              <MediaRow
                eyebrow="Hindi & English Dub"
                title="Popular Web Series"
                loading={loading}
                error={error}
                onRetry={loadHome}
              >
                {renderCards(home?.popularSeries)}
              </MediaRow>

              <MediaRow
                eyebrow="Critically acclaimed"
                title="Top Rated Web Series"
                loading={loading}
                error={error}
                onRetry={loadHome}
              >
                {renderCards(home?.topRatedSeries)}
              </MediaRow>
            </>
          )}

          <section className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-teal">Hindi Dub &amp; English Dub</p>
                <h3 className="font-display text-xl font-bold text-ink">
                  {genre === 'All' ? 'All Web Series Catalog' : `${genre} Web Series`}
                </h3>
              </div>
              <span className="font-mono text-xs text-muted tabular-nums">
                {browseItems.length} titles
              </span>
            </div>

            {browseLoading ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-surface-2" />
                ))}
              </div>
            ) : browseItems.length === 0 ? (
              <p className="text-sm text-muted">No series found for this filter.</p>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {browseItems.map((item) => (
                  <MediaCard
                    key={`cat:${item.id}`}
                    href={`/movies/tv/${item.id}`}
                    title={item.title}
                    image={item.poster}
                    kicker="Hindi & Eng Dub"
                    meta={['Web Series', item.year, item.rating ? `${item.rating} ★` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
