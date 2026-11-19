import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { BookOpen, Bookmark, Check } from 'lucide-react';
import type { MangaChapter, MangaItem } from '../types';
import { fetchMangaChapters, fetchMangaDetail } from '../lib/api';
import { removeFromWatchlist, upsertWatchlist, useWatchlist } from '../lib/storage';
import { MediaImage } from '../components/MediaImage';

export default function MangaDetailsPage() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const baseRoute = pathname.startsWith('/manhwa') ? '/manhwa' : '/manga';
  const kind = pathname.startsWith('/manhwa') ? 'manhwa' : 'manga';

  const [detail, setDetail] = useState<MangaItem | null>(null);
  const [chapters, setChapters] = useState<MangaChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const watchlist = useWatchlist();
  const key = `manga:${id}`;
  const saved = watchlist.some((w) => w.key === key);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([fetchMangaDetail(id), fetchMangaChapters(id)])
      .then(([d, ch]) => {
        if (cancelled) return;
        setDetail(d);
        setChapters(ch.chapters || []);
        document.title = `${d.title} — Anime by Adi 💀`;
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load manga');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas pt-24 pb-16">
        <div className="mx-auto max-w-6xl animate-pulse space-y-6 px-4 sm:px-6">
          <div className="flex gap-6">
            <div className="h-72 w-48 rounded-xl bg-surface-2" />
            <div className="flex-1 space-y-3">
              <div className="h-8 w-72 rounded bg-surface-2" />
              <div className="h-24 w-full rounded bg-surface-2" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main className="grid min-h-[70vh] place-items-center bg-canvas px-4 pt-20">
        <div className="text-center">
          <p className="text-base font-semibold text-ink">{error || 'Title not found'}</p>
          <Link to={baseRoute} className="mt-4 inline-block text-sm font-semibold text-accent hover:underline">
            Back to {kind === 'manhwa' ? 'Manhwa' : 'Manga'}
          </Link>
        </div>
      </main>
    );
  }

  const firstChapter = chapters.length > 0 ? chapters[chapters.length - 1] : null;
  const latestChapter = chapters.length > 0 ? chapters[0] : null;

  const toggleSave = () => {
    if (saved) {
      removeFromWatchlist(key);
    } else {
      upsertWatchlist({
        key,
        kind,
        id: detail.id,
        title: detail.title,
        image: detail.cover,
        href: `${baseRoute}/${detail.id}`,
        status: 'watching',
      });
    }
  };

  return (
    <main className="min-h-screen bg-canvas pt-24 pb-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="w-44 shrink-0 overflow-hidden rounded-xl border border-line bg-surface shadow-lg sm:w-52">
            <div className="aspect-[2/3] w-full">
              <MediaImage src={detail.cover} alt={detail.title} className="h-full w-full object-cover" />
            </div>
          </div>

          <div className="flex-1 space-y-3">
            <p className="text-xs font-semibold text-teal">
              {[detail.kind, detail.status, detail.year, detail.author].filter(Boolean).join(' · ')}
            </p>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl" style={{ textWrap: 'balance' }}>
              {detail.title}
            </h1>
            {detail.genres && detail.genres.length > 0 && (
              <p className="text-xs font-medium text-accent">{detail.genres.join(' · ')}</p>
            )}
            {detail.description && (
              <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted">
                {detail.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {firstChapter && (
                <Link
                  to={`${baseRoute}/${detail.id}/read/${firstChapter.id}`}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink"
                >
                  <BookOpen className="size-4" />
                  <span>Start Reading (Ch. {firstChapter.chapter})</span>
                </Link>
              )}
              {latestChapter && latestChapter.id !== firstChapter?.id && (
                <Link
                  to={`${baseRoute}/${detail.id}/read/${latestChapter.id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent/50"
                >
                  <span>Latest (Ch. {latestChapter.chapter})</span>
                </Link>
              )}
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

        {/* Chapters List */}
        <section className="mt-12">
          <h2 className="mb-4 font-display text-xl font-bold text-ink">
            Chapters <span className="font-mono text-sm font-normal text-muted tabular-nums">({chapters.length})</span>
          </h2>
          {chapters.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
              No English chapters hosted directly on MangaDex for this entry.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {chapters.map((ch) => (
                <Link
                  key={ch.id}
                  to={`${baseRoute}/${detail.id}/read/${ch.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-accent/50"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-teal tabular-nums">
                      Chapter {ch.chapter}
                    </p>
                    <p className="line-clamp-1 text-xs font-medium text-ink">
                      {ch.title || ch.group || 'English Scan'}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
                    {ch.pages}p
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
