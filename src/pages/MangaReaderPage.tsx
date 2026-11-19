import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Columns, Rows } from 'lucide-react';
import type { MangaChapter, MangaItem } from '../types';
import { fetchMangaChapters, fetchMangaDetail, fetchMangaPages } from '../lib/api';
import { recordHistory } from '../lib/storage';

export default function MangaReaderPage() {
  const { id, chapterId } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const baseRoute = pathname.startsWith('/manhwa') ? '/manhwa' : '/manga';
  const kind = pathname.startsWith('/manhwa') ? 'manhwa' : 'manga';

  const [detail, setDetail] = useState<MangaItem | null>(null);
  const [chapters, setChapters] = useState<MangaChapter[]>([]);
  const [pages, setPages] = useState<{ index: number; url: string }[]>([]);
  const [mode, setMode] = useState<'vertical' | 'paged'>(kind === 'manhwa' ? 'vertical' : 'vertical');
  const [pageIdx, setPageIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchMangaDetail(id), fetchMangaChapters(id)])
      .then(([d, ch]) => {
        setDetail(d);
        setChapters(ch.chapters || []);
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!chapterId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPageIdx(0);
    window.scrollTo({ top: 0 });

    fetchMangaPages(chapterId)
      .then((res) => {
        if (!cancelled) setPages(res.pages || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load pages');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chapterId]);

  const currentIdx = useMemo(
    () => chapters.findIndex((c) => c.id === chapterId),
    [chapters, chapterId]
  );
  const currentChapter = currentIdx >= 0 ? chapters[currentIdx] : null;
  // chapters are ordered desc (newest at index 0)
  const nextChapter = currentIdx > 0 ? chapters[currentIdx - 1] : null;
  const prevChapter = currentIdx >= 0 && currentIdx < chapters.length - 1 ? chapters[currentIdx + 1] : null;

  useEffect(() => {
    if (!detail || !chapterId) return;
    const chLabel = currentChapter ? `Chapter ${currentChapter.chapter}` : 'Reading';
    document.title = `${chLabel} · ${detail.title} — Anime by Adi 💀`;
    recordHistory({
      key: `manga:${detail.id}`,
      kind,
      id: detail.id,
      title: detail.title,
      image: detail.cover,
      href: `${baseRoute}/${detail.id}/read/${chapterId}`,
      subtitle: chLabel,
      episodeOrChapter: currentChapter?.chapter || '',
    });
  }, [detail, chapterId, currentChapter, baseRoute, kind]);

  useEffect(() => {
    if (mode !== 'paged') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPageIdx((p) => Math.min(pages.length - 1, p + 1));
      if (e.key === 'ArrowLeft') setPageIdx((p) => Math.max(0, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, pages.length]);

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-20">
      {/* Reader Toolbar */}
      <div className="sticky top-16 z-30 border-b border-line bg-canvas/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to={`${baseRoute}/${id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
            >
              <ArrowLeft className="size-3.5" />
              <span>Chapters</span>
            </Link>
            <div className="min-w-0">
              <h1 className="line-clamp-1 font-display text-sm font-bold text-ink">
                {detail?.title || 'Reader'}
              </h1>
              {currentChapter && (
                <p className="font-mono text-xs text-teal tabular-nums">
                  Chapter {currentChapter.chapter} {currentChapter.title ? `· ${currentChapter.title}` : ''}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-surface p-1">
              <button
                type="button"
                onClick={() => setMode('vertical')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
                  mode === 'vertical' ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
                }`}
              >
                <Rows className="size-3.5" />
                <span>Strip</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('paged')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
                  mode === 'paged' ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
                }`}
              >
                <Columns className="size-3.5" />
                <span>Paged</span>
              </button>
            </div>

            <button
              type="button"
              disabled={!prevChapter}
              onClick={() => prevChapter && navigate(`${baseRoute}/${id}/read/${prevChapter.id}`)}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" />
              <span>Prev</span>
            </button>
            <button
              type="button"
              disabled={!nextChapter}
              onClick={() => nextChapter && navigate(`${baseRoute}/${id}/read/${nextChapter.id}`)}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Pages Canvas */}
      <div className="mx-auto mt-6 max-w-3xl px-2 sm:px-4">
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] w-full animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-muted">
            {error}
          </div>
        ) : pages.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-muted">
            No pages returned for this chapter.
          </div>
        ) : mode === 'vertical' ? (
          <div className="flex flex-col items-center gap-1">
            {pages.map((p) => (
              <img
                key={p.index}
                src={p.url}
                alt={`Page ${p.index}`}
                loading={p.index <= 3 ? 'eager' : 'lazy'}
                className="w-full max-w-3xl bg-surface-2 object-contain"
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center">
            {pages[pageIdx]?.url && (
              <img
                src={pages[pageIdx].url}
                alt={`Page ${pageIdx + 1}`}
                onClick={() => setPageIdx((p) => Math.min(pages.length - 1, p + 1))}
                className="max-h-[82vh] w-auto cursor-pointer rounded-lg bg-surface-2 object-contain"
              />
            )}
            <div className="mt-4 flex items-center gap-4">
              <button
                type="button"
                disabled={pageIdx <= 0}
                onClick={() => setPageIdx((p) => Math.max(0, p - 1))}
                className="rounded-lg border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink disabled:opacity-40"
              >
                Previous Page
              </button>
              <span className="font-mono text-xs text-muted tabular-nums">
                {pageIdx + 1} / {pages.length}
              </span>
              <button
                type="button"
                disabled={pageIdx >= pages.length - 1}
                onClick={() => setPageIdx((p) => Math.min(pages.length - 1, p + 1))}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink disabled:opacity-40"
              >
                Next Page
              </button>
            </div>
          </div>
        )}

        {/* Bottom Chapter Controls */}
        {!loading && pages.length > 0 && (
          <div className="mt-8 flex items-center justify-between rounded-xl border border-line bg-surface p-4">
            <button
              type="button"
              disabled={!prevChapter}
              onClick={() => prevChapter && navigate(`${baseRoute}/${id}/read/${prevChapter.id}`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-4 py-2 text-xs font-semibold text-ink disabled:opacity-40 hover:border-accent/50"
            >
              <ChevronLeft className="size-4" />
              <span>Previous Chapter</span>
            </button>
            <button
              type="button"
              disabled={!nextChapter}
              onClick={() => nextChapter && navigate(`${baseRoute}/${id}/read/${nextChapter.id}`)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink disabled:opacity-40"
            >
              <span>Next Chapter</span>
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
