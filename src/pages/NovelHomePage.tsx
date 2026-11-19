import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { NovelItem } from '../types';
import { fetchNovelHome, searchNovels } from '../lib/api';
import { HubBar } from '../components/HubBar';
import { MediaRow } from '../components/MediaRow';
import { MediaCard } from '../components/MediaCard';

export default function NovelHomePage() {
  const [home, setHome] = useState<Awaited<ReturnType<typeof fetchNovelHome>> | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NovelItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNovelHome();
      setHome(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load novels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Light Novels Hub — Anime by Adi 💀';
    load();
  }, [load]);

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
        const res = await searchNovels(q);
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
  }, [query]);

  const renderCards = (items?: NovelItem[]) =>
    (items || []).map((item) => (
      <div key={item.slug} className="w-[148px] sm:w-[172px] md:w-[186px] shrink-0 snap-start">
        <MediaCard
          href={`/novel/${item.slug}`}
          title={item.title}
          image={item.cover}
          meta={item.stats || 'Light Novel'}
        />
      </div>
    ));

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-16">
      <HubBar />

      <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-teal">Live NovelFire Feed</p>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              Light &amp; Web Novels
            </h1>
            <p className="mt-1 text-sm text-muted">
              Browse translated web novels, xianxia cultivation epics, and light novels in one fast reader.
            </p>
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search novels..."
              className="w-full rounded-lg border border-line bg-surface py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </div>

      {query.trim() ? (
        <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
          <h2 className="mb-4 font-display text-xl font-bold text-ink">
            Results for &ldquo;{query}&rdquo;
          </h2>
          {searching ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2.5">
                  <div className="skeleton-shimmer aspect-[2/3] w-full rounded-xl border border-line" />
                  <div className="skeleton-shimmer h-3.5 w-3/4 rounded" />
                  <div className="skeleton-shimmer h-3 w-1/2 rounded" />
                </div>
              ))}
            </div>
          ) : searchResults && searchResults.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {searchResults.map((item) => (
                <MediaCard
                  key={item.slug}
                  href={`/novel/${item.slug}`}
                  title={item.title}
                  image={item.cover}
                  meta={item.stats || 'Light Novel'}
                />
              ))}
            </div>
          ) : (
            <p className="py-10 text-sm text-muted">No novels matched your search.</p>
          )}
        </div>
      ) : (
        <div className="mt-10 space-y-12">
          <MediaRow
            eyebrow="Most read"
            title="Popular Novels"
            loading={loading}
            error={error}
            onRetry={load}
          >
            {renderCards(home?.popular)}
          </MediaRow>

          <MediaRow
            eyebrow="Fresh chapters"
            title="Latest Updates"
            loading={loading}
            error={error}
            onRetry={load}
          >
            {renderCards(home?.latest)}
          </MediaRow>

          <MediaRow
            eyebrow="Rising titles"
            title="New &amp; Notable"
            loading={loading}
            error={error}
            onRetry={load}
          >
            {renderCards(home?.rankings)}
          </MediaRow>
        </div>
      )}
    </main>
  );
}
