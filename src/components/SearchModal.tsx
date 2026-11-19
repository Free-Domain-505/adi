import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Search, X } from 'lucide-react';
import { browseAnime, pickTitle, searchManga, searchMovies, searchNovels } from '../lib/api';
import { MediaImage } from './MediaImage';

type HubTab = 'anime' | 'donghua' | 'manga' | 'manhwa' | 'novel' | 'movies';

interface SearchResultItem {
  key: string;
  title: string;
  subtitle: string;
  image: string;
  href: string;
}

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
}

const TABS: { id: HubTab; label: string }[] = [
  { id: 'anime', label: 'Anime' },
  { id: 'donghua', label: 'Donghua' },
  { id: 'manga', label: 'Manga' },
  { id: 'manhwa', label: 'Manhwa' },
  { id: 'novel', label: 'Novels' },
  { id: 'movies', label: 'Movies & TV' },
];

export function SearchModal({ open, onClose, initialQuery = '' }: SearchModalProps) {
  const [tab, setTab] = useState<HubTab>('anime');
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        let mapped: SearchResultItem[] = [];
        if (tab === 'anime' || tab === 'donghua') {
          const res = await browseAnime({
            search: trimmed,
            perPage: 16,
            countryOfOrigin: tab === 'donghua' ? 'CN' : undefined,
          });
          mapped = res.items.map((item) => ({
            key: `al:${item.id}`,
            title: pickTitle(item.title),
            subtitle: [
              item.format?.replace(/_/g, ' '),
              item.seasonYear,
              item.averageScore ? `${(item.averageScore / 10).toFixed(1)} ★` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            image: item.coverImage?.large || item.coverImage?.extraLarge || '',
            href: `/anime/${item.id}`,
          }));
        } else if (tab === 'manga' || tab === 'manhwa') {
          const res = await searchManga(trimmed, tab);
          mapped = res.results.map((item) => ({
            key: `md:${item.id}`,
            title: item.title,
            subtitle: [item.kind, item.year, item.status].filter(Boolean).join(' · '),
            image: item.cover,
            href: `/${tab}/${item.id}`,
          }));
        } else if (tab === 'novel') {
          const res = await searchNovels(trimmed);
          mapped = res.results.map((item) => ({
            key: `nv:${item.slug}`,
            title: item.title,
            subtitle: item.stats || 'Light Novel',
            image: item.cover,
            href: `/novel/${item.slug}`,
          }));
        } else {
          const res = await searchMovies(trimmed);
          mapped = res.results.map((item) => ({
            key: `mv:${item.type}:${item.id}`,
            title: item.title,
            subtitle: [item.type === 'tv' ? 'TV Series' : 'Movie', item.year, item.rating ? `${item.rating} ★` : null]
              .filter(Boolean)
              .join(' · '),
            image: item.poster,
            href: `/movies/${item.type}/${item.id}`,
          }));
        }
        if (!cancelled) setResults(mapped);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, tab]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search Anime by Adi 💀"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 p-4 pt-16 backdrop-blur-sm sm:pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <Search className="size-4 shrink-0 text-accent" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${TABS.find((t) => t.id === tab)?.label}...`}
            className="w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
          />
          {loading && <Loader2 className="size-4 shrink-0 animate-spin text-accent" />}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-line bg-canvas/40 px-4 py-2.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setResults([]);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                tab === t.id
                  ? 'bg-accent text-accent-ink'
                  : 'text-muted hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {error ? (
            <p className="py-8 text-center text-sm text-muted">{error}</p>
          ) : !query.trim() ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-ink">Search across Anime by Adi 💀</p>
              <p className="mt-1 text-xs text-muted">
                Type any anime, donghua, manga, manhwa, novel, or movie for instant HD results.
              </p>
            </div>
          ) : !loading && results.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No matches found for &ldquo;{query}&rdquo;.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {results.map((item) => (
                <Link
                  key={item.key}
                  to={item.href}
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-xl border border-transparent p-2 transition-colors hover:border-line hover:bg-surface-2"
                >
                  <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                    <MediaImage src={item.image} alt={item.title} className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="line-clamp-1 text-sm font-semibold text-ink">{item.title}</h4>
                    {item.subtitle && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted tabular-nums">{item.subtitle}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
