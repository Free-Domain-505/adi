import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Check, Cloud, LogIn, Plus, Search, Trash2, X } from 'lucide-react';
import type { AnimeMedia, WatchStatus } from '../types';
import { browseAnime, pickTitle } from '../lib/api';
import {
  STATUS_LABELS,
  clearHistory,
  getWatchlistEntry,
  removeFromWatchlist,
  removeHistoryItem,
  upsertWatchlist,
  useAuth,
  useHistory,
  useWatchlist,
} from '../lib/storage';
import { HubBar } from '../components/HubBar';
import { MediaCard } from '../components/MediaCard';
import { MediaImage } from '../components/MediaImage';

type FilterTab = 'all' | WatchStatus | 'favorites' | 'history';

const TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All Saved' },
  { id: 'watching', label: 'Watching' },
  { id: 'planning', label: 'Plan to Watch' },
  { id: 'completed', label: 'Completed' },
  { id: 'paused', label: 'On Hold' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'history', label: 'History' },
];

export default function ListPage() {
  const { user, authReady } = useAuth();
  const watchlist = useWatchlist();
  const history = useHistory();
  const [tab, setTab] = useState<FilterTab>('all');

  // Quick "Add Anime to My List" search state
  const [addQuery, setAddQuery] = useState('');
  const [addStatus, setAddStatus] = useState<WatchStatus>('planning');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AnimeMedia[]>([]);

  useEffect(() => {
    document.title = 'My List — Anime by Adi 💀';
  }, []);

  useEffect(() => {
    const q = addQuery.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      browseAnime({ search: q, perPage: 8 })
        .then((res) => {
          if (!cancelled) setResults(res.items || []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [addQuery]);

  const handleQuickAdd = (anime: AnimeMedia) => {
    const title = pickTitle(anime.title);
    const key = `anime:${anime.id}`;
    upsertWatchlist({
      key,
      kind: anime.countryOfOrigin === 'CN' ? 'donghua' : 'anime',
      id: String(anime.id),
      title,
      image: anime.coverImage?.extraLarge || anime.coverImage?.large || '',
      href: `/anime/${anime.id}`,
      status: addStatus,
      total: anime.episodes || null,
      score: anime.averageScore ? anime.averageScore / 10 : null,
    });
  };

  const filteredList = useMemo(() => {
    if (tab === 'all') return watchlist;
    if (tab === 'favorites') return watchlist.filter((w) => w.favorite);
    if (tab === 'history') return [];
    return watchlist.filter((w) => w.status === tab);
  }, [watchlist, tab]);

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-16">
      <HubBar />

      <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bookmark className="size-6 text-accent" />
            <div>
              <p className="text-xs font-semibold text-teal">Personal Library</p>
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
                My List &amp; History
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {authReady && (
              user ? (
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 rounded-lg border border-teal/30 bg-teal/10 px-3.5 py-2 text-xs font-semibold text-teal hover:bg-teal/15"
                >
                  <Cloud className="size-3.5" />
                  <span className="max-w-[160px] truncate">Synced · {user.displayName || user.email}</span>
                </Link>
              ) : (
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink hover:border-accent/50 hover:text-accent"
                >
                  <LogIn className="size-3.5 text-accent" />
                  <span>Login to Sync List</span>
                </Link>
              )
            )}

            {tab === 'history' && history.length > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-muted hover:text-ink"
              >
                <Trash2 className="size-3.5" />
                <span>Clear History</span>
              </button>
            )}
          </div>
        </div>

        {/* Add Anime to My List Quick-Add Panel */}
        <section className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-ink">
                Add Anime to Watch Later
              </h2>
              <p className="text-xs text-muted">
                Search any anime and add it directly to your list for later.
              </p>
            </div>

            <div className="flex flex-1 flex-col gap-2 sm:max-w-xl sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder="Search anime to add (e.g. Solo Leveling, Naruto)..."
                  className="w-full rounded-lg border border-line bg-canvas py-2 pl-9 pr-8 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none sm:text-sm"
                />
                {addQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setAddQuery('');
                      setResults([]);
                    }}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              <select
                value={addStatus}
                onChange={(e) => setAddStatus(e.target.value as WatchStatus)}
                aria-label="Default list status"
                className="rounded-lg border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink focus:border-accent focus:outline-none"
              >
                {Object.entries(STATUS_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {addQuery.trim().length >= 2 && (
            <div className="mt-4 border-t border-line pt-4">
              {searching ? (
                <p className="text-xs text-muted">Searching anime...</p>
              ) : results.length === 0 ? (
                <p className="text-xs text-muted">No anime matched "{addQuery}".</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {results.map((anime) => {
                    const title = pickTitle(anime.title);
                    const saved = getWatchlistEntry(`anime:${anime.id}`);
                    return (
                      <div
                        key={anime.id}
                        className="flex items-center gap-3 rounded-xl border border-line bg-canvas/70 p-2.5"
                      >
                        <Link to={`/anime/${anime.id}`} className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                          <MediaImage
                            src={anime.coverImage?.large || anime.coverImage?.extraLarge}
                            alt={title}
                            className="h-full w-full object-cover"
                          />
                        </Link>
                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/anime/${anime.id}`}
                            className="line-clamp-1 text-xs font-semibold text-ink hover:text-accent"
                          >
                            {title}
                          </Link>
                          <p className="mt-0.5 text-[11px] text-muted">
                            {[
                              anime.seasonYear,
                              anime.episodes ? `${anime.episodes} ep` : null,
                              anime.averageScore ? `${(anime.averageScore / 10).toFixed(1)} ★` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          <div className="mt-2">
                            {saved ? (
                              <button
                                type="button"
                                onClick={() => removeFromWatchlist(`anime:${anime.id}`)}
                                className="inline-flex items-center gap-1 rounded-md border border-teal/40 bg-teal/15 px-2.5 py-1 text-[11px] font-semibold text-teal hover:bg-rose-500/15 hover:border-rose-400/40 hover:text-rose-300"
                              >
                                <Check className="size-3" />
                                <span>Added ({STATUS_LABELS[saved.status]})</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleQuickAdd(anime)}
                                className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-ink transition-transform hover:scale-[1.02]"
                              >
                                <Plus className="size-3" />
                                <span>Add to List</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        <div className="no-scrollbar mt-6 flex items-center gap-2 overflow-x-auto pb-2">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-accent text-accent-ink'
                    : 'border border-line bg-surface text-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'history' ? (
          history.length === 0 ? (
            <div className="mt-12 rounded-2xl border border-line bg-surface p-10 text-center">
              <p className="text-sm font-medium text-ink">No watch or reading history yet</p>
              <p className="mt-1 text-xs text-muted">Start watching an episode or reading a chapter to track your progress here.</p>
              <Link to="/home" className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink">
                Explore Anime
              </Link>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {history.map((entry) => (
                <div key={entry.key} className="group relative">
                  <MediaCard
                    href={entry.href}
                    title={entry.title}
                    image={entry.image}
                    kicker={entry.subtitle}
                    meta={entry.kind.toUpperCase()}
                    aspect="landscape"
                  />
                  <button
                    type="button"
                    onClick={() => removeHistoryItem(entry.key)}
                    aria-label={`Remove ${entry.title}`}
                    className="absolute right-2 top-2 rounded-md bg-black/75 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )
        ) : filteredList.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-line bg-surface p-10 text-center">
            <p className="text-sm font-medium text-ink">Your list is empty in this category</p>
            <p className="mt-1 text-xs text-muted">Use the search box above or save anime, donghua, manga, novels, or movies from any title page.</p>
            <Link to="/browse" className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink">
              Browse Catalog
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {filteredList.map((entry) => (
              <div key={entry.key} className="group relative flex flex-col">
                <MediaCard
                  href={entry.href}
                  title={entry.title}
                  image={entry.image}
                  kicker={STATUS_LABELS[entry.status]}
                  meta={[entry.kind, entry.score ? `${entry.score.toFixed(1)} ★` : null].filter(Boolean).join(' · ')}
                />
                <div className="mt-1.5 flex items-center gap-1.5">
                  <select
                    value={entry.status}
                    aria-label={`Change status for ${entry.title}`}
                    onChange={(e) =>
                      upsertWatchlist({
                        ...entry,
                        status: e.target.value as WatchStatus,
                      })
                    }
                    className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink focus:border-accent focus:outline-none"
                  >
                    {Object.entries(STATUS_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeFromWatchlist(entry.key)}
                    aria-label={`Remove ${entry.title}`}
                    className="rounded-md border border-line bg-surface p-1 text-muted hover:border-rose-400/50 hover:text-rose-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
