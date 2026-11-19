import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { AnimeMedia } from '../types';
import { ANIME_GENRES, browseAnime, pickTitle } from '../lib/api';
import { HubBar } from '../components/HubBar';
import { MediaCard } from '../components/MediaCard';

const FORMATS = [
  { value: '', label: 'All Formats' },
  { value: 'TV', label: 'TV Series' },
  { value: 'MOVIE', label: 'Movie' },
  { value: 'OVA', label: 'OVA' },
  { value: 'ONA', label: 'ONA' },
  { value: 'SPECIAL', label: 'Special' },
];

const STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'RELEASING', label: 'Airing' },
  { value: 'FINISHED', label: 'Completed' },
  { value: 'NOT_YET_RELEASED', label: 'Upcoming' },
];

const SORTS = [
  { value: 'TRENDING_DESC', label: 'Trending' },
  { value: 'POPULARITY_DESC', label: 'Most Popular' },
  { value: 'SCORE_DESC', label: 'Highest Rated' },
  { value: 'START_DATE_DESC', label: 'Newest' },
];

interface CatalogPageProps {
  presetSort?: string;
  presetTitle?: string;
  donghuaOnly?: boolean;
}

export default function CatalogPage({ presetSort, presetTitle, donghuaOnly }: CatalogPageProps) {
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [genre, setGenre] = useState(searchParams.get('genre') || '');
  const [format, setFormat] = useState(searchParams.get('format') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [sort, setSort] = useState(searchParams.get('sort') || presetSort || 'TRENDING_DESC');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<AnimeMedia[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isDonghua = donghuaOnly || pathname.startsWith('/donghua');

  useEffect(() => {
    setQuery(searchParams.get('q') || '');
    setGenre(searchParams.get('genre') || '');
    setStatus(searchParams.get('status') || '');
    setFormat(searchParams.get('format') || '');
    if (presetSort) setSort(presetSort);
    setPage(1);
  }, [pathname, presetSort, searchParams]);

  useEffect(() => {
    document.title = `${presetTitle || (isDonghua ? 'Browse Donghua' : 'Browse Anime')} — Anime by Adi 💀`;
  }, [presetTitle, isDonghua]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const res = await browseAnime({
          page,
          perPage: 24,
          search: query.trim() || undefined,
          genre: genre || undefined,
          format: format || undefined,
          status: status || undefined,
          season: searchParams.get('season') || undefined,
          year: searchParams.get('year') ? Number(searchParams.get('year')) : undefined,
          sort: query.trim() ? 'SEARCH_MATCH' : sort,
          countryOfOrigin: isDonghua ? 'CN' : undefined,
        });
        if (!cancelled) {
          setItems((prev) => (page === 1 ? res.items : [...prev, ...res.items]));
          setHasNext(res.hasNextPage);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load catalog');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [page, query, genre, format, status, sort, isDonghua, searchParams]);

  const updateFilter = (key: string, value: string) => {
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-16">
      <HubBar />

      <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-teal">
              {isDonghua ? 'Chinese Animation Catalog' : 'Complete Anime Catalog'}
            </p>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
              {presetTitle || (isDonghua ? 'Browse Donghua' : 'Browse Anime')}
            </h1>
          </div>
          {(genre || format || status || query) && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setGenre('');
                setFormat('');
                setStatus('');
                setPage(1);
                setSearchParams({}, { replace: true });
              }}
              className="self-start text-xs font-semibold text-accent hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Filter Controls */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search titles..."
              className="w-full rounded-lg border border-line bg-surface py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>

          <select
            value={genre}
            onChange={(e) => {
              setGenre(e.target.value);
              updateFilter('genre', e.target.value);
            }}
            aria-label="Filter by genre"
            className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none"
          >
            <option value="">All Genres</option>
            {ANIME_GENRES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>

          <select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
              updateFilter('format', e.target.value);
            }}
            aria-label="Filter by format"
            className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none"
          >
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                updateFilter('status', e.target.value);
              }}
              aria-label="Filter by status"
              className="rounded-lg border border-line bg-surface px-2.5 py-2.5 text-sm text-ink focus:border-accent focus:outline-none"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
              aria-label="Sort order"
              className="rounded-lg border border-line bg-surface px-2.5 py-2.5 text-sm text-ink focus:border-accent focus:outline-none"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="mt-8 rounded-xl border border-line bg-surface p-6 text-center text-sm text-muted">
            {error}
          </div>
        )}

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((item, i) => (
            <MediaCard
              key={`${item.id}-${i}`}
              href={`/anime/${item.id}`}
              title={pickTitle(item.title)}
              image={item.coverImage?.extraLarge || item.coverImage?.large}
              rank={presetSort === 'SCORE_DESC' ? i + 1 : undefined}
              meta={[
                item.format?.replace(/_/g, ' '),
                item.seasonYear,
                item.averageScore ? `${(item.averageScore / 10).toFixed(1)} ★` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}

          {loading &&
            Array.from({ length: 12 }).map((_, i) => (
              <div key={`sk-${i}`} className="space-y-2.5">
                <div className="skeleton-shimmer aspect-[2/3] w-full rounded-xl border border-line" />
                <div className="skeleton-shimmer h-3.5 w-3/4 rounded" />
                <div className="skeleton-shimmer h-3 w-1/2 rounded" />
              </div>
            ))}
        </div>

        {!loading && items.length === 0 && !error && (
          <p className="mt-12 text-center text-sm text-muted">
            No titles match these filters. Try adjusting your search or genre.
          </p>
        )}

        {hasNext && !loading && (
          <div className="mt-10 flex justify-center">
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-line bg-surface px-6 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
            >
              Load More
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
