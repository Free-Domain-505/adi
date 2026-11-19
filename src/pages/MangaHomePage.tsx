import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { MangaItem } from '../types';
import { fetchMangaHome, searchManga } from '../lib/api';
import { HubBar } from '../components/HubBar';
import { MediaRow } from '../components/MediaRow';
import { MediaCard } from '../components/MediaCard';

interface MangaHomePageProps {
  kind?: 'manga' | 'manhwa';
}

export default function MangaHomePage({ kind = 'manga' }: MangaHomePageProps) {
  const [home, setHome] = useState<Awaited<ReturnType<typeof fetchMangaHome>> | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MangaItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = kind === 'manhwa' ? 'Manhwa' : 'Manga';
  const baseRoute = kind === 'manhwa' ? '/manhwa' : '/manga';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMangaHome(kind);
      setHome(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MangaDex feed');
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    document.title = `${label} Hub — Anime by Adi 💀`;
    load();
  }, [label, load]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await searchManga(q, kind);
        if (!cancelled) setSearchResults(res.results);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, kind]);

  const renderCards = (items?: MangaItem[]) =>
    (items || []).map((item) => (
      <div key={item.id} className="w-[148px] sm:w-[172px] md:w-[186px] shrink-0 snap-start">
        <MediaCard
          href={`${baseRoute}/${item.id}`}
          title={item.title}
          image={item.cover}
          meta={[item.kind, item.year, item.status].filter(Boolean).join(' · ')}
        />
      </div>
    ));

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-16">
      <HubBar />

      <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-teal">Live MangaDex Catalog</p>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              {label} Hub
            </h1>
            <p className="mt-1 text-sm text-muted">
              Read {kind === 'manhwa' ? 'full-color Korean webtoons and manhwa' : 'Japanese manga and serialized chapters'} directly in your browser.
            </p>
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full rounded-lg border border-line bg-surface py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </div>

      {query.trim() ? (
        <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
          <h2 className="mb-4 font-display text-xl font-bold text-ink">
            Search Results for &ldquo;{query}&rdquo;
          </h2>
          {searching ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse space-y-2">
                  <div className="aspect-[2/3] w-full rounded-xl bg-surface-2" />
                  <div className="h-3.5 w-3/4 rounded bg-surface-2" />
                </div>
              ))}
            </div>
          ) : searchResults && searchResults.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {searchResults.map((item) => (
                <MediaCard
                  key={item.id}
                  href={`${baseRoute}/${item.id}`}
                  title={item.title}
                  image={item.cover}
                  meta={[item.kind, item.year, item.status].filter(Boolean).join(' · ')}
                />
              ))}
            </div>
          ) : (
            <p className="py-10 text-sm text-muted">No {label.toLowerCase()} found matching that title.</p>
          )}
        </div>
      ) : (
        <div className="mt-10 space-y-12">
          <MediaRow
            eyebrow="Most followed"
            title={`Trending ${label}`}
            loading={loading}
            error={error}
            onRetry={load}
          >
            {renderCards(home?.trending)}
          </MediaRow>

          <MediaRow
            eyebrow="Fresh translations"
            title="Recently Updated Chapters"
            loading={loading}
            error={error}
            onRetry={load}
          >
            {renderCards(home?.latest)}
          </MediaRow>

          <MediaRow
            eyebrow="Community favorites"
            title={`Top Rated ${label}`}
            loading={loading}
            error={error}
            onRetry={load}
          >
            {renderCards(home?.topRated)}
          </MediaRow>
        </div>
      )}
    </main>
  );
}
