import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Minus, Plus } from 'lucide-react';
import type { NovelDetail } from '../types';
import { fetchNovelChapter, fetchNovelDetail } from '../lib/api';
import { recordHistory } from '../lib/storage';

export default function NovelReaderPage() {
  const { slug, chapter } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [title, setTitle] = useState('');
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [fontSize, setFontSize] = useState(17);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetchNovelDetail(slug).then(setDetail).catch(() => {});
  }, [slug]);

  useEffect(() => {
    if (!slug || !chapter) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.scrollTo({ top: 0 });

    fetchNovelChapter(slug, chapter)
      .then((res) => {
        if (cancelled) return;
        setTitle(res.title);
        setParagraphs(res.paragraphs || []);
        setBlocked(Boolean(res.blockedBySource));
        setSourceUrl(res.sourceUrl);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load chapter');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, chapter]);

  const currentIdx = useMemo(
    () => (detail?.chapters || []).findIndex((c) => c.slug === chapter),
    [detail?.chapters, chapter]
  );
  const prevChapter = currentIdx > 0 ? detail?.chapters[currentIdx - 1] : null;
  const nextChapter =
    detail && currentIdx >= 0 && currentIdx < detail.chapters.length - 1
      ? detail.chapters[currentIdx + 1]
      : null;

  useEffect(() => {
    if (!detail || !chapter) return;
    document.title = `${title || chapter} · ${detail.title} — Anime by Adi 💀`;
    recordHistory({
      key: `novel:${detail.slug}`,
      kind: 'novel',
      id: detail.slug,
      title: detail.title,
      image: detail.cover,
      href: `/novel/${detail.slug}/read/${chapter}`,
      subtitle: title || chapter,
      episodeOrChapter: chapter,
    });
  }, [detail, chapter, title]);

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-20">
      <div className="sticky top-16 z-30 border-b border-line bg-canvas/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to={`/novel/${slug}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
            >
              <ArrowLeft className="size-3.5" />
              <span>Chapters</span>
            </Link>
            <p className="line-clamp-1 font-display text-sm font-bold text-ink">
              {detail?.title || slug}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1">
              <button
                type="button"
                aria-label="Decrease font size"
                onClick={() => setFontSize((f) => Math.max(14, f - 1))}
                className="p-1 text-muted hover:text-ink"
              >
                <Minus className="size-3.5" />
              </button>
              <span className="font-mono text-xs text-ink tabular-nums">{fontSize}px</span>
              <button
                type="button"
                aria-label="Increase font size"
                onClick={() => setFontSize((f) => Math.min(24, f + 1))}
                className="p-1 text-muted hover:text-ink"
              >
                <Plus className="size-3.5" />
              </button>
            </div>

            <button
              type="button"
              disabled={!prevChapter}
              onClick={() => prevChapter && navigate(`/novel/${slug}/read/${prevChapter.slug}`)}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" />
              <span>Prev</span>
            </button>
            <button
              type="button"
              disabled={!nextChapter}
              onClick={() => nextChapter && navigate(`/novel/${slug}/read/${nextChapter.slug}`)}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <article className="mx-auto mt-8 max-w-3xl px-4 sm:px-6">
        {loading ? (
          <div className="space-y-4">
            <div className="skeleton-shimmer h-8 w-2/3 rounded" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer h-4 w-full rounded" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-line bg-surface p-8 text-center">
            <p className="text-sm text-muted">{error}</p>
          </div>
        ) : blocked || paragraphs.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface p-8 text-center space-y-4">
            <h1 className="font-display text-xl font-bold text-ink">{title || chapter}</h1>
            <p className="text-sm text-muted">
              NovelFire protected this chapter behind an upstream browser verification step. You can open the chapter directly on the source page.
            </p>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink"
              >
                <span>Open Chapter on NovelFire</span>
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <h1 className="font-display text-2xl font-extrabold text-ink sm:text-3xl">{title}</h1>
            <div className="space-y-4 leading-relaxed text-ink/90" style={{ fontSize }}>
              {paragraphs.map((p, idx) => {
                const imgMatch = p.match(/^\[img\](.*?)(?:\|(.*?))?\[\/img\]$/);
                if (imgMatch) {
                  return (
                    <figure key={idx} className="my-6 overflow-hidden rounded-xl border border-line bg-surface">
                      <img
                        src={imgMatch[1]}
                        alt={imgMatch[2] || `Illustration ${idx + 1}`}
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        className="mx-auto max-h-[75vh] w-auto object-contain"
                      />
                    </figure>
                  );
                }
                return <p key={idx}>{p}</p>;
              })}
            </div>
          </div>
        )}
      </article>
    </main>
  );
}
