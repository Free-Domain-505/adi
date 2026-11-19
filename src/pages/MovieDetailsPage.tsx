import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bookmark, Check, Play } from 'lucide-react';
import type { MovieItem } from '../types';
import { fetchMovieMeta } from '../lib/api';
import { removeFromWatchlist, upsertWatchlist, useWatchlist } from '../lib/storage';
import { MediaImage } from '../components/MediaImage';
import { SeasonDropdown } from '../components/SeasonDropdown';

export default function MovieDetailsPage() {
  const { type, id } = useParams();
  const mediaType: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie';

  const [meta, setMeta] = useState<MovieItem | null>(null);
  const [season, setSeason] = useState(1);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const watchlist = useWatchlist();
  const key = `${mediaType}:${id}`;
  const saved = watchlist.some((w) => w.key === key);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setSynopsisExpanded(false);
    setError(null);

    fetchMovieMeta(mediaType, id)
      .then((res) => {
        if (cancelled) return;
        setMeta(res);
        document.title = `${res.title} — Anime by Adi 💀`;
        if (res.videos && res.videos.length > 0) {
          setSeason(res.videos[0].season);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load title');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mediaType, id]);

  const seasonOptions = useMemo(() => {
    const counts = new Map<number, number>();
    for (const v of meta?.videos || []) {
      counts.set(v.season, (counts.get(v.season) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([num, epCount]) => ({
        number: num,
        name: `Season ${num}`,
        episodes: epCount,
      }));
  }, [meta?.videos]);

  const seasonEpisodes = useMemo(
    () => (meta?.videos || []).filter((v) => v.season === season).sort((a, b) => a.episode - b.episode),
    [meta?.videos, season]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas pb-16">
        <div className="relative h-72 w-full overflow-hidden bg-surface sm:h-96">
          <div className="skeleton-shimmer h-full w-full opacity-40" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/80 to-canvas/20" />
        </div>
        <div className="relative z-10 mx-auto -mt-32 max-w-6xl px-4 sm:-mt-40 sm:px-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-end">
            <div className="w-40 shrink-0 rounded-xl border border-line bg-canvas p-1 shadow-2xl sm:w-52">
              <div className="skeleton-shimmer aspect-[2/3] w-full rounded-lg" />
            </div>
            <div className="flex-1 space-y-3 pb-1">
              <div className="skeleton-shimmer h-4 w-48 rounded" />
              <div className="skeleton-shimmer h-10 w-72 max-w-full rounded-xl" />
              <div className="flex gap-3 pt-2">
                <div className="skeleton-shimmer h-10 w-36 rounded-lg" />
                <div className="skeleton-shimmer h-10 w-28 rounded-lg" />
              </div>
            </div>
          </div>
          <div className="mt-10 max-w-3xl space-y-2">
            <div className="skeleton-shimmer h-5 w-24 rounded" />
            <div className="skeleton-shimmer h-4 w-full rounded" />
            <div className="skeleton-shimmer h-4 w-4/5 rounded" />
          </div>
        </div>
      </main>
    );
  }

  if (error || !meta) {
    return (
      <main className="grid min-h-[70vh] place-items-center bg-canvas px-4 pt-20">
        <div className="text-center">
          <p className="text-base font-semibold text-ink">{error || 'Title not found'}</p>
          <Link to="/movies" className="mt-4 inline-block text-sm font-semibold text-accent hover:underline">
            Back to Movies
          </Link>
        </div>
      </main>
    );
  }

  const toggleSave = () => {
    if (saved) {
      removeFromWatchlist(key);
    } else {
      upsertWatchlist({
        key,
        kind: mediaType,
        id: meta.id,
        title: meta.title,
        image: meta.poster,
        href: `/movies/${mediaType}/${meta.id}`,
        status: 'planning',
        score: meta.rating || null,
      });
    }
  };

  const isLongDesc = (meta.description || '').length > 130;

  return (
    <main className="min-h-screen bg-canvas pb-16">
      <div className="relative h-72 w-full overflow-hidden bg-surface sm:h-96">
        <MediaImage src={meta.backdrop || meta.poster} alt={meta.title} loading="eager" className="h-full w-full object-cover opacity-55" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/65 to-canvas/20" />
      </div>

      <div className="relative z-10 mx-auto -mt-32 max-w-6xl px-4 sm:-mt-40 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end">
          <div className="w-40 shrink-0 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl sm:w-52">
            <div className="aspect-[2/3] w-full">
              <MediaImage src={meta.poster} alt={meta.title} className="h-full w-full object-cover" />
            </div>
          </div>

          <div className="flex-1 space-y-3 pb-1">
            <p className="text-xs font-semibold text-teal tabular-nums">
              {[
                mediaType === 'tv' ? 'TV Series' : 'Movie',
                meta.year,
                meta.runtime,
                meta.rating ? `${meta.rating} ★` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl" style={{ textWrap: 'balance' }}>
              {meta.title}
            </h1>
            {meta.genres.length > 0 && (
              <p className="text-xs font-medium text-accent">{meta.genres.join(' · ')}</p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                to={`/movies/watch/${mediaType}/${meta.id}${mediaType === 'tv' ? `?s=${season}&e=1` : ''}`}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink"
              >
                <Play className="size-4 fill-current" />
                <span>{mediaType === 'tv' ? `Watch S${season} E1` : 'Watch Movie'}</span>
              </Link>
              <button
                type="button"
                onClick={toggleSave}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium ${
                  saved ? 'border-teal/50 bg-teal/15 text-teal' : 'border-line bg-surface text-ink hover:border-accent/40'
                }`}
              >
                {saved ? <Check className="size-4" /> : <Bookmark className="size-4" />}
                <span>{saved ? 'Saved' : 'Save'}</span>
              </button>
            </div>
          </div>
        </div>

        {meta.description && (
          <section className="mt-5 max-w-xl">
            <h2 className="font-display text-xs font-bold tracking-wide text-ink sm:text-[13px]">
              Synopsis Description
            </h2>
            <p className={`mt-1 text-[11px] leading-relaxed text-muted sm:text-xs ${synopsisExpanded ? '' : 'line-clamp-2'}`}>
              {meta.description}
            </p>
            {isLongDesc && (
              <button
                type="button"
                onClick={() => setSynopsisExpanded((prev) => !prev)}
                className="mt-1 text-[11px] font-semibold text-sky-400 hover:underline"
              >
                {synopsisExpanded ? 'Show less' : 'Read more'}
              </button>
            )}
            {meta.cast && meta.cast.length > 0 && (
              <p className="mt-2 text-[11px] text-muted sm:text-xs">
                <span className="font-semibold text-ink">Cast:</span> {meta.cast.slice(0, 6).join(', ')}
              </p>
            )}
          </section>
        )}

        {mediaType === 'tv' && seasonOptions.length > 0 && (
          <section className="mt-12">
            <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-line pb-4">
              <h2 className="font-display text-xl font-bold text-ink">
                Episodes{' '}
                <span className="ml-1 font-mono text-sm font-normal text-muted tabular-nums">
                  ({seasonEpisodes.length})
                </span>
              </h2>
              <SeasonDropdown
                seasons={seasonOptions}
                selectedSeason={season}
                onChange={setSeason}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {seasonEpisodes.map((ep) => (
                <Link
                  key={ep.id}
                  to={`/movies/watch/tv/${meta.id}?s=${ep.season}&e=${ep.episode}`}
                  className="group overflow-hidden rounded-xl border border-line bg-surface transition-all hover:border-sky-400/50 hover:shadow-lg hover:shadow-black/20"
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-surface-2">
                    <MediaImage
                      src={ep.thumbnail || meta.backdrop}
                      alt={ep.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                    <span className="absolute bottom-2.5 left-2.5 font-mono text-[11px] font-bold text-white drop-shadow tabular-nums">
                      EP {ep.episode}
                    </span>
                    <div className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="grid size-10 place-items-center rounded-full bg-sky-500 text-slate-950 shadow-lg">
                        <Play className="size-4 translate-x-0.5 fill-current" />
                      </span>
                    </div>
                  </div>
                  <div className="p-3.5">
                    <h3 className="line-clamp-1 text-sm font-semibold text-ink group-hover:text-sky-400">
                      {ep.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                      {ep.overview || `Season ${ep.season} · Episode ${ep.episode}`}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
