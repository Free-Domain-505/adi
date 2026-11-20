import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bookmark,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Mic,
  Play,
  Search,
  ShieldCheck,
  Ticket,
} from 'lucide-react';
import type { MovieItem } from '../types';
import { fetchMovieMeta } from '../lib/api';
import { MOVIE_SERVERS } from '../lib/servers';
import { sanitizeDocId } from '../lib/supabase';
import {
  DAILY_FREE_LIMIT,
  EXTRA_EPISODE_PRICE_INR,
  MONTHLY_PRICE_INR,
  getTimeUntilMidnightText,
  openSubModal,
  recordHistory,
  removeFromWatchlist,
  setAudioPref,
  tryConsumeWatchSlot,
  upsertWatchlist,
  useAudioPref,
  useDailyUsage,
  useSubscription,
  useWatchlist,
} from '../lib/storage';
import { SeasonDropdown } from '../components/SeasonDropdown';
import { LanguageSelector } from '../components/LanguageSelector';

export default function MovieWatchPage() {
  const { type, id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const mediaType: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie';
  const season = Math.max(1, Number(searchParams.get('s')) || 1);
  const episode = Math.max(1, Number(searchParams.get('e')) || 1);
  const language = useAudioPref();
  const watchlist = useWatchlist();
  const { isSubscribed, extraCredits } = useSubscription();
  const usage = useDailyUsage();
  const savedEntry = id ? watchlist.find((w) => w.key === `${mediaType}:${id}`) : undefined;

  const videoKey = sanitizeDocId(`${mediaType}:${id || 'none'}:s${season}:e${episode}`);
  const [limitBlocked, setLimitBlocked] = useState(false);

  const [meta, setMeta] = useState<MovieItem | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<'sub' | 'dub'>('dub');
  const [serverId, setServerId] = useState<string>(MOVIE_SERVERS[0].id);
  const [manualServerPick, setManualServerPick] = useState(false);
  const [epSearch, setEpSearch] = useState('');

  useEffect(() => {
    if (!id) return;
    if (isSubscribed) {
      setLimitBlocked(false);
      return;
    }
    const res = tryConsumeWatchSlot(videoKey);
    if (!res.allowed) {
      setLimitBlocked(true);
      openSubModal('limit', 'extra_2');
    } else {
      setLimitBlocked(false);
    }
  }, [id, videoKey, isSubscribed, extraCredits, usage.dateKey]);

  const canWatch = isSubscribed || !limitBlocked;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setMetaLoading(true);
    setMetaError(null);
    fetchMovieMeta(mediaType, id)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((err) => {
        if (!cancelled) {
          setMetaError(err instanceof Error ? err.message : 'Unable to load title details');
        }
      })
      .finally(() => {
        if (!cancelled) setMetaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaType, id]);

  useEffect(() => {
    if (!meta || !id || !canWatch) return;
    const epTag = mediaType === 'tv' ? `S${season} · E${episode}` : 'Movie';
    document.title = `${meta.title} (${epTag}) — Anime by Adi 💀`;
    recordHistory({
      key: `${mediaType}:${id}`,
      kind: mediaType,
      id,
      title: meta.title,
      image: meta.backdrop || meta.poster,
      href: mediaType === 'tv' ? `/movies/watch/tv/${id}?s=${season}&e=${episode}` : `/movies/watch/movie/${id}`,
      subtitle: epTag,
      season,
      episodeOrChapter: episode,
    });
  }, [meta, id, mediaType, season, episode, canWatch]);

  useEffect(() => {
    setManualServerPick(false);
  }, [id, mediaType, season, episode, language]);

  const effectiveLang: 'hindi' | 'english' = selectedMode === 'sub' ? 'english' : language;

  const dubServers = useMemo(() => {
    if (!id) return [];
    const ordered =
      effectiveLang === 'hindi'
        ? MOVIE_SERVERS
        : [...MOVIE_SERVERS].sort((a, b) => {
            if (a.id === 'vidlink-pro') return -1;
            if (b.id === 'vidlink-pro') return 1;
            return 0;
          });
    return ordered.map((srv, idx) => ({
      id: srv.id,
      label: `SERVER ${idx + 1}`,
      isHindiDub: effectiveLang === 'hindi' && Boolean(srv.supportsHindiHint),
      url: srv.buildUrl({ id, type: mediaType, season, episode, language: effectiveLang }),
    }));
  }, [id, mediaType, season, episode, effectiveLang]);

  useEffect(() => {
    setServerId((prev) => {
      if (manualServerPick && prev && dubServers.some((s) => s.id === prev)) return prev;
      return dubServers[0]?.id || MOVIE_SERVERS[0].id;
    });
  }, [dubServers, manualServerPick]);

  const activeServer = dubServers.find((s) => s.id === serverId) || dubServers[0] || null;
  const embedUrl =
    selectedMode === 'sub' ? dubServers[0]?.url || '' : activeServer?.url || '';

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

  const filteredEpisodes = useMemo(() => {
    const q = epSearch.trim().toLowerCase();
    if (!q) return seasonEpisodes;
    return seasonEpisodes.filter(
      (ep) => String(ep.episode).includes(q) || ep.title.toLowerCase().includes(q)
    );
  }, [seasonEpisodes, epSearch]);

  const currentEpInfo = seasonEpisodes.find((v) => v.episode === episode);

  const goToEp = (epNum: number) => {
    if (epNum < 1 || epNum > Math.max(seasonEpisodes.length, 1)) return;
    setSearchParams({ s: String(season), e: String(epNum) });
  };

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Top Navigation Bar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to={`/movies/${mediaType}/${id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
            >
              <ArrowLeft className="size-3.5" />
              <span>Details</span>
            </Link>
            <div className="min-w-0">
              {metaLoading ? (
                <div className="space-y-1.5">
                  <div className="skeleton-shimmer h-5 w-48 rounded" />
                  <div className="skeleton-shimmer h-3 w-32 rounded" />
                </div>
              ) : (
                <>
                  <h1 className="line-clamp-1 font-display text-lg font-bold text-ink sm:text-xl">
                    {meta?.title || 'Now Playing'}
                  </h1>
                  <p className="font-mono text-xs text-sky-400 tabular-nums">
                    {mediaType === 'tv'
                      ? `Season ${season} · Episode ${episode}${
                          currentEpInfo?.title ? ` · ${currentEpInfo.title}` : ''
                        }`
                      : 'HD Feature Film'}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {meta && id && (
              <button
                type="button"
                onClick={() => {
                  const key = `${mediaType}:${id}`;
                  if (savedEntry) {
                    removeFromWatchlist(key);
                  } else {
                    upsertWatchlist({
                      key,
                      kind: mediaType,
                      id,
                      title: meta.title,
                      image: meta.poster || meta.backdrop,
                      href: `/movies/${mediaType}/${id}`,
                      status: 'watching',
                      score: meta.rating || null,
                    });
                  }
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  savedEntry
                    ? 'border-teal/40 bg-teal/15 text-teal'
                    : 'border-line bg-surface text-ink hover:border-accent/50'
                }`}
              >
                {savedEntry ? <Check className="size-3.5" /> : <Bookmark className="size-3.5 text-accent" />}
                <span>{savedEntry ? 'In List' : 'Add to List'}</span>
              </button>
            )}

            {mediaType === 'tv' && (
              <>
                <button
                  type="button"
                  disabled={episode <= 1}
                  onClick={() => goToEp(episode - 1)}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40 hover:border-accent/50"
                >
                  <ChevronLeft className="size-3.5" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  disabled={episode >= seasonEpisodes.length}
                  onClick={() => goToEp(episode + 1)}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-40"
                >
                  <span>Next</span>
                  <ChevronRight className="size-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {metaError && (
          <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
            {metaError} — Stream servers are still available below.
          </div>
        )}

        {/* Video Player Frame */}
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-line bg-black shadow-2xl">
          {limitBlocked && !isSubscribed ? (
            <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto bg-surface/95 p-5 text-center sm:p-6">
              <div className="grid size-12 place-items-center rounded-2xl border border-amber-400/40 bg-amber-500/15 text-amber-400 sm:size-14">
                <Crown className="size-6 sm:size-7" />
              </div>
              <h2 className="mt-2.5 font-display text-base font-extrabold text-ink sm:text-xl">
                Daily Free Limit Reached ({Math.min(DAILY_FREE_LIMIT, usage.watchedKeys.length)}/{DAILY_FREE_LIMIT})
              </h2>
              <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted sm:text-sm">
                Your {DAILY_FREE_LIMIT} free daily videos are finished. Pay only{' '}
                <strong className="text-teal">₹{EXTRA_EPISODE_PRICE_INR}</strong> to watch 1 more video right now, get{' '}
                <strong className="text-amber-400">₹{MONTHLY_PRICE_INR}/month VIP</strong>, or come back after{' '}
                <strong className="text-ink">12:00 AM midnight</strong> (in {getTimeUntilMidnightText()}) for 5 fresh videos.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => openSubModal('limit', 'extra_2')}
                  className="inline-flex items-center gap-2 rounded-xl bg-teal px-4 py-2.5 text-xs font-extrabold text-slate-950 shadow-lg transition-transform hover:scale-[1.02] sm:text-sm"
                >
                  <Ticket className="size-4" />
                  <span>Get 1 More Video · Only ₹{EXTRA_EPISODE_PRICE_INR}</span>
                </button>
                <button
                  type="button"
                  onClick={() => openSubModal('limit', 'monthly_25')}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-slate-950 shadow-lg transition-transform hover:scale-[1.02] sm:text-sm"
                >
                  <Crown className="size-4 fill-current" />
                  <span>VIP Pass · ₹{MONTHLY_PRICE_INR}/mo</span>
                </button>
              </div>
            </div>
          ) : !canWatch || !embedUrl ? (
            <div className="skeleton-shimmer h-full w-full" />
          ) : (
            <iframe
              key={embedUrl}
              src={embedUrl}
              title={meta?.title || 'Movie Player'}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope; clipboard-write"
              allowFullScreen
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full border-0"
            />
          )}
        </div>

        {/* Centered Title/Episode + Dashed-Divider Server Card (Matches WatchPage) */}
        <section className="mt-5">
          <div className="text-center">
            <p className="text-sm font-bold text-sky-400 tabular-nums">
              {mediaType === 'tv' ? `Episode ${episode}` : meta?.title || 'Feature Film'}
            </p>
            <p className="mt-0.5 text-xs font-medium text-ink sm:text-sm">
              If current player not working, select other server.
            </p>
          </div>

          <div className="mt-3.5 rounded-xl border border-line bg-surface p-4 sm:p-5">
            {metaLoading ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="skeleton-shimmer h-7 w-16 rounded" />
                  <div className="skeleton-shimmer h-8 w-24 rounded-md" />
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-line pt-3">
                  <div className="skeleton-shimmer h-7 w-16 rounded" />
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="skeleton-shimmer h-8 w-24 rounded-md" />
                  ))}
                </div>
              </div>
            ) : (
              <>
                {/* Top Row: Audio Language Selector + Ad-Blocked Badge */}
                <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-line/70 pb-3.5">
                  <LanguageSelector
                    language={language}
                    onChange={(lang) => {
                      setAudioPref(lang);
                      setSelectedMode('dub');
                      setManualServerPick(false);
                    }}
                    hindiAvailable
                  />

                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-teal">
                    <ShieldCheck className="size-3.5" />
                    Ad-Blocked Player
                  </span>
                </div>

                {/* SUB Row */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex w-16 shrink-0 items-center gap-2 text-xs font-bold tracking-wide text-ink">
                      <Captions className="size-4 text-muted" />
                      <span>SUB:</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMode('sub');
                          setAudioPref('english');
                          setManualServerPick(false);
                        }}
                        className={`rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
                          selectedMode === 'sub'
                            ? 'bg-sky-500 text-slate-950 shadow-sm'
                            : 'bg-surface-2 text-muted hover:text-ink'
                        }`}
                      >
                        English
                      </button>
                    </div>
                  </div>
                </div>

                {/* Dashed Separator */}
                <div className="my-3.5 border-t border-dashed border-line" />

                {/* DUB Row */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex w-16 shrink-0 items-center gap-2 text-xs font-bold tracking-wide text-ink">
                    <Mic className="size-4 text-muted" />
                    <span>DUB:</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {dubServers.map((srv) => {
                      const active = selectedMode === 'dub' && activeServer?.id === srv.id;
                      return (
                        <button
                          key={srv.id}
                          type="button"
                          onClick={() => {
                            setSelectedMode('dub');
                            setManualServerPick(true);
                            setServerId(srv.id);
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
                            active
                              ? 'bg-sky-500 text-slate-950 shadow-sm'
                              : 'bg-surface-2 text-muted hover:text-ink'
                          }`}
                        >
                          <span>{srv.label}</span>
                          {srv.isHindiDub && (
                            <span
                              className={`rounded px-1 py-0.5 text-[9px] font-extrabold uppercase leading-none ${
                                active
                                  ? 'bg-slate-950/20 text-slate-950'
                                  : 'bg-amber-400/20 text-amber-300'
                              }`}
                            >
                              HI
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Series Episode Lists with Left Custom Season Dropdown + Right Search */}
        {mediaType === 'tv' && (
          <section className="mt-8">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-display text-base font-bold text-ink sm:text-lg">
                  Episode Lists
                </h2>
                {seasonOptions.length > 0 && (
                  <SeasonDropdown
                    seasons={seasonOptions}
                    selectedSeason={season}
                    onChange={(sNum) => setSearchParams({ s: String(sNum), e: '1' })}
                  />
                )}
              </div>

              <div className="relative w-44 sm:w-52">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={epSearch}
                  onChange={(e) => setEpSearch(e.target.value)}
                  placeholder="Episode number"
                  className="w-full rounded-lg border border-line bg-surface py-2 pl-8 pr-3 text-xs text-ink placeholder:text-muted focus:border-sky-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-line bg-surface/60">
              {metaLoading ? (
                <div className="divide-y divide-line/50">
                  {Array.from({ length: 8 }).map((_, idx) => (
                    <div key={idx} className="flex items-center gap-4 px-4 py-3">
                      <div className="skeleton-shimmer h-4 w-7 rounded" />
                      <div className="skeleton-shimmer h-4 w-64 max-w-full rounded" />
                    </div>
                  ))}
                </div>
              ) : filteredEpisodes.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted">
                  No episodes match your filter.
                </div>
              ) : (
                <div className="max-h-[480px] overflow-y-auto divide-y divide-line/40">
                  {filteredEpisodes.map((ep) => {
                    const active = ep.episode === episode;
                    return (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => setSearchParams({ s: String(season), e: String(ep.episode) })}
                        className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors ${
                          active
                            ? 'border-r-2 border-sky-400 bg-sky-500/10 text-sky-400'
                            : 'odd:bg-surface/40 even:bg-canvas/40 text-ink hover:bg-surface-2'
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-5">
                          <span
                            className={`w-7 shrink-0 font-mono text-xs font-semibold tabular-nums ${
                              active ? 'text-sky-400' : 'text-muted'
                            }`}
                          >
                            {ep.episode}
                          </span>
                          <span
                            className={`line-clamp-1 text-xs sm:text-sm ${
                              active ? 'font-semibold text-sky-400' : 'font-normal text-ink'
                            }`}
                          >
                            {ep.title}
                          </span>
                        </div>

                        {active && (
                          <Play className="size-3.5 shrink-0 fill-sky-400 text-sky-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
