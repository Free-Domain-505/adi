import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Play, Search } from 'lucide-react';
import type { MovieItem } from '../types';
import { browseMovies, fetchMoviesHome, searchMovies } from '../lib/api';
import { HubBar } from '../components/HubBar';
import { MediaRow } from '../components/MediaRow';
import { MediaCard } from '../components/MediaCard';
import { MediaImage } from '../components/MediaImage';

interface MoviesHomePageProps {
  browseMode?: boolean;
  defaultType?: 'movie' | 'tv';
}

export default function MoviesHomePage({ browseMode = false, defaultType = 'movie' }: MoviesHomePageProps) {
  const [home, setHome] = useState<Awaited<ReturnType<typeof fetchMoviesHome>> | null>(null);
  const [browseType, setBrowseType] = useState<'movie' | 'tv'>(defaultType);
  const [browseItems, setBrowseItems] = useState<MovieItem[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MovieItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (browseMode) {
        const res = await browseMovies({ type: browseType });
        setBrowseItems(res.results);
      } else {
        const res = await fetchMoviesHome();
        setHome(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load movies');
    } finally {
      setLoading(false);
    }
  }, [browseMode, browseType]);

  useEffect(() => {
    document.title = `${browseMode ? 'Browse Movies & TV' : 'Movies & TV Hub'} — Anime by Adi 💀`;
    load();
  }, [browseMode, load]);

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
        if (!cancelled) setSearchResults(res.results);
      } catch {
        if (!cancelled) setSearchResults([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const spotlight = home?.popularMovies?.[0];

  const renderCards = (items?: MovieItem[]) =>
    (items || []).map((item) => (
      <div key={`${item.type}:${item.id}`} className="w-[148px] sm:w-[172px] md:w-[186px] shrink-0 snap-start">
        <MediaCard
          href={`/movies/${item.type}/${item.id}`}
          title={item.title}
          image={item.poster}
          meta={[item.type === 'tv' ? 'Series' : 'Movie', item.year, item.rating ? `${item.rating} ★` : null]
            .filter(Boolean)
            .join(' · ')}
        />
      </div>
    ));

  return (
    <main className="min-h-screen bg-canvas pb-16">
      {!browseMode && spotlight && (
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
              <p className="text-xs font-semibold text-teal tabular-nums">
                Featured Cinema · {[spotlight.year, spotlight.rating ? `${spotlight.rating} ★` : null].filter(Boolean).join(' · ')}
              </p>
              <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-5xl" style={{ textWrap: 'balance' }}>
                {spotlight.title}
              </h1>
              {spotlight.description && (
                <p className="mt-3 line-clamp-2 max-w-xl text-sm text-muted sm:text-[15px]">
                  {spotlight.description}
                </p>
              )}
              <div className="mt-5 flex items-center gap-3">
                <Link
                  to={`/movies/watch/${spotlight.type}/${spotlight.id}`}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink"
                >
                  <Play className="size-4 fill-current" />
                  <span>Watch Now</span>
                </Link>
                <Link
                  to={`/movies/${spotlight.type}/${spotlight.id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface/85 px-4 py-2.5 text-sm font-semibold text-ink"
                >
                  <Info className="size-4 text-muted" />
                  <span>Details</span>
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className={browseMode ? 'pt-20' : 'pt-6'}>
        <HubBar />
      </div>

      <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {browseMode && (
              <div className="flex items-center gap-1 rounded-lg bg-surface p-1">
                {(['movie', 'tv'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setBrowseType(t)}
                    className={`rounded-md px-3.5 py-1.5 text-xs font-semibold ${
                      browseType === t ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {t === 'movie' ? 'Movies' : 'TV Shows'}
                  </button>
                ))}
              </div>
            )}
            {!browseMode && (
              <Link
                to="/movies/browse"
                className="text-xs font-semibold text-accent hover:underline"
              >
                Browse Full Movies &amp; TV Catalog →
              </Link>
            )}
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movies or TV series..."
              className="w-full rounded-lg border border-line bg-surface py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </div>

      {query.trim() && searchResults ? (
        <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
          <h2 className="mb-4 font-display text-xl font-bold text-ink">
            Results for &ldquo;{query}&rdquo;
          </h2>
          {searchResults.length === 0 ? (
            <p className="text-sm text-muted">No movies or series matched your search.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {searchResults.map((item) => (
                <MediaCard
                  key={`${item.type}:${item.id}`}
                  href={`/movies/${item.type}/${item.id}`}
                  title={item.title}
                  image={item.poster}
                  meta={[item.type === 'tv' ? 'Series' : 'Movie', item.year, item.rating ? `${item.rating} ★` : null]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </div>
          )}
        </div>
      ) : browseMode ? (
        <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {browseItems.map((item) => (
              <MediaCard
                key={`${item.type}:${item.id}`}
                href={`/movies/${item.type}/${item.id}`}
                title={item.title}
                image={item.poster}
                meta={[item.type === 'tv' ? 'Series' : 'Movie', item.year, item.rating ? `${item.rating} ★` : null]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-10 space-y-12">
          <MediaRow
            eyebrow="Box office & trending"
            title="Popular Movies"
            viewAll="/movies/browse"
            loading={loading}
            error={error}
            onRetry={load}
          >
            {renderCards(home?.popularMovies)}
          </MediaRow>

          <MediaRow
            eyebrow="Binge-worthy shows"
            title="Popular TV Series"
            viewAll="/movies/browse"
            loading={loading}
            error={error}
            onRetry={load}
          >
            {renderCards(home?.popularSeries)}
          </MediaRow>

          <MediaRow
            eyebrow="Critically acclaimed"
            title="Top Rated Movies"
            loading={loading}
            error={error}
            onRetry={load}
          >
            {renderCards(home?.topRatedMovies)}
          </MediaRow>

          <MediaRow
            eyebrow="Highest IMDb scores"
            title="Top Rated Series"
            loading={loading}
            error={error}
            onRetry={load}
          >
            {renderCards(home?.topRatedSeries)}
          </MediaRow>
        </div>
      )}
    </main>
  );
}
