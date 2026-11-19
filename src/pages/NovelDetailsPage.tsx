import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen, Bookmark, Check, ExternalLink } from 'lucide-react';
import type { NovelDetail } from '../types';
import { fetchNovelDetail } from '../lib/api';
import { removeFromWatchlist, upsertWatchlist, useWatchlist } from '../lib/storage';
import { MediaImage } from '../components/MediaImage';

export default function NovelDetailsPage() {
  const { slug } = useParams();
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const watchlist = useWatchlist();
  const key = `novel:${slug}`;
  const saved = watchlist.some((w) => w.key === key);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchNovelDetail(slug)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        document.title = `${d.title} — Anime by Adi 💀`;
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load novel');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

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
          <p className="text-base font-semibold text-ink">{error || 'Novel not found'}</p>
          <Link to="/novel" className="mt-4 inline-block text-sm font-semibold text-accent hover:underline">
            Back to Novels
          </Link>
        </div>
      </main>
    );
  }

  const firstChapter = detail.chapters[0];

  const toggleSave = () => {
    if (saved) {
      removeFromWatchlist(key);
    } else {
      upsertWatchlist({
        key,
        kind: 'novel',
        id: detail.slug,
        title: detail.title,
        image: detail.cover,
        href: `/novel/${detail.slug}`,
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
              {[detail.author, detail.status].filter(Boolean).join(' · ')}
            </p>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl" style={{ textWrap: 'balance' }}>
              {detail.title}
            </h1>
            {detail.genres.length > 0 && (
              <p className="text-xs font-medium text-accent">{detail.genres.join(' · ')}</p>
            )}
            {detail.summary && (
              <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted">
                {detail.summary}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {firstChapter && (
                <Link
                  to={`/novel/${detail.slug}/read/${firstChapter.slug}`}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink"
                >
                  <BookOpen className="size-4" />
                  <span>Read Chapter 1</span>
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
              <a
                href={detail.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-muted hover:text-ink"
              >
                <span>Source</span>
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        </div>

        <section className="mt-12">
          <h2 className="mb-4 font-display text-xl font-bold text-ink">
            Chapters <span className="font-mono text-sm font-normal text-muted tabular-nums">({detail.chapters.length})</span>
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {detail.chapters.map((ch) => (
              <Link
                key={ch.slug}
                to={`/novel/${detail.slug}/read/${ch.slug}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-accent/50"
              >
                <span className="font-mono text-xs font-bold text-teal tabular-nums">
                  {ch.number}
                </span>
                <span className="line-clamp-1 text-xs font-medium text-ink">
                  {ch.title}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
