import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bookmark, Check, Play } from 'lucide-react';
import type { MovieItem } from '../types';
import { fetchMovieMeta } from '../lib/api';
import { removeFromWatchlist, upsertWatchlist, useWatchlist } from '../lib/storage';
import { MediaImage } from '../components/MediaImage';

export default function MovieDetailsPage() {
  const { type, id } = useParams();
  const mediaType: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie';

  const [meta, setMeta] = useState<MovieItem | null>(null);
  const [season, setSeason] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const watchlist = useWatchlist();
  const key = `${mediaType}:${id}`;
  const saved = watchlist.some((w) => w.key === key);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
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

  const seasons = useMemo(() => {
    const set = new Set<number>();
    for (const v of meta?.videos || []) set.add(v.season);
    return Array.from(set).sort((a, b) => a - b);
  }, [meta?.videos]);

  const seasonEpisodes = useMemo(
    () => (meta?.videos || []).filter((v) => v.season === season).sort((a, b) => a.episode - b.episode),
    [meta?.videos, season]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas pt-24 pb-16">
        <div className="mx-auto max-w-6xl animate-pulse space-y-6 px-4 sm:px-6">
          <div className="h-64 w-full rounded-2xl bg-surface-2" />
          <div className="h-8 w-72 rounded bg-surface-2" />
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

  return (
    <main className="min-h-screen bg-canvas pb-16">
      <div className="relative h-72 w-full overflow-hidden bg-surface sm:h-96">
        <MediaImage src={meta.backdrop || meta.poster} alt={meta.title} loading="eager" className="h-full w-full object-cover opacity-55" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/65 to-canvas/20" />
      </div>

      <div className="relative mx-auto -mt-32 max-w-6xl px-4 sm:-mt-40 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end">
          <div className="w-40 shrink-0 overflow-hidden rounded-xl border border-line bg-surface shadow-xl sm:w-52">
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
          <section className="mt-10 max-w-4xl">
            <h2 className="font-display text-lg font-bold text-ink">Overview</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted sm:text-[15px]">{meta.description}</p>
            {meta.cast && meta.cast.length > 0 && (
              <p className="mt-3 text-xs text-muted">
                <span className="font-semibold text-ink">Cast:</span> {meta.cast.slice(0, 6).join(', ')}
              </p>
            )}
          </section>
        )}

        {mediaType === 'tv' && seasons.length > 0 && (
          <section className="mt-12">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-bold text-ink">Episodes</h2>
              <select
                value={season}
                onChange={(e) => setSeason(Number(e.target.value))}
                aria-label="Select season"
                className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink focus:border-accent focus:outline-none"
              >
                {seasons.map((s) => (
                  <option key={s} value={s}>Season {s}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {seasonEpisodes.map((ep) => (
                <Link
                  key={ep.id}
                  to={`/movies/watch/tv/${meta.id}?s=${ep.season}&e=${ep.episode}`}
                  className="group flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5 transition-colors hover:border-accent/50"
                >
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                    <MediaImage src={ep.thumbnail || meta.backdrop} alt={ep.title} className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-teal tabular-nums">
                      S{ep.season} · E{ep.episode}
                    </p>
                    <p className="line-clamp-1 text-xs font-medium text-ink group-hover:text-accent">
                      {ep.title}
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
