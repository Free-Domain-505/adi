import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bookmark, Check, Crown, ExternalLink, Server, Ticket, Volume2 } from 'lucide-react';
import type { MovieItem } from '../types';
import { fetchMovieMeta } from '../lib/api';
import { MOVIE_SERVERS } from '../lib/servers';
import { sanitizeDocId } from '../lib/firebase';
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
  useAuth,
  useDailyUsage,
  useSubscription,
  useWatchlist,
} from '../lib/storage';

export default function MovieWatchPage() {
  const { type, id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const mediaType: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie';
  const season = Math.max(1, Number(searchParams.get('s')) || 1);
  const episode = Math.max(1, Number(searchParams.get('e')) || 1);
  const language = useAudioPref();
  const watchlist = useWatchlist();
  const { authReady } = useAuth();
  const { isSubscribed, extraCredits } = useSubscription();
  const usage = useDailyUsage();
  const savedEntry = id ? watchlist.find((w) => w.key === `${mediaType}:${id}`) : undefined;

  const videoKey = sanitizeDocId(`${mediaType}:${id || 'none'}:s${season}:e${episode}`);
  const [limitBlocked, setLimitBlocked] = useState(false);

  const [meta, setMeta] = useState<MovieItem | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [serverId, setServerId] = useState(MOVIE_SERVERS[0].id);

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
    setMetaError(null);
    fetchMovieMeta(mediaType, id)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((err) => {
        if (!cancelled) {
          setMetaError(err instanceof Error ? err.message : 'Unable to load title details');
        }
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

  const activeServer = MOVIE_SERVERS.find((s) => s.id === serverId) || MOVIE_SERVERS[0];
  const embedUrl = id ? activeServer.buildUrl({ id, type: mediaType, season, episode, language }) : '';

  const seasons = useMemo(() => {
    const set = new Set<number>();
    for (const v of meta?.videos || []) set.add(v.season);
    return Array.from(set).sort((a, b) => a - b);
  }, [meta?.videos]);

  const seasonEpisodes = useMemo(
    () => (meta?.videos || []).filter((v) => v.season === season).sort((a, b) => a.episode - b.episode),
    [meta?.videos, season]
  );

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
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
              <h1 className="line-clamp-1 font-display text-lg font-bold text-ink sm:text-xl">
                {meta?.title || 'Loading...'}
              </h1>
              <p className="font-mono text-xs text-teal tabular-nums">
                {mediaType === 'tv' ? `Season ${season} · Episode ${episode}` : 'HD Feature Film'}
              </p>
            </div>
          </div>

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
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                savedEntry
                  ? 'border-teal/40 bg-teal/15 text-teal'
                  : 'border-line bg-surface text-ink hover:border-accent/50'
              }`}
            >
              {savedEntry ? <Check className="size-3.5" /> : <Bookmark className="size-3.5 text-accent" />}
              <span>{savedEntry ? 'In List' : 'Add to List'}</span>
            </button>
          )}
        </div>

        {metaError && (
          <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
            {metaError} — Stream servers are still available below.
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className={`space-y-4 ${mediaType === 'tv' ? 'lg:col-span-8 xl:col-span-9' : 'lg:col-span-12'}`}>
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
                    Your {DAILY_FREE_LIMIT} free daily videos are finished! Pay only{' '}
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
                      <span>Get 1 More Episode · Only ₹{EXTRA_EPISODE_PRICE_INR}</span>
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
                <div className="grid h-full w-full place-items-center text-sm text-muted">
                  Loading video player...
                </div>
              ) : (
                <iframe
                  key={embedUrl}
                  src={embedUrl}
                  title={meta?.title || 'Movie Player'}
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope; clipboard-write"
                  allowFullScreen
                  referrerPolicy="origin"
                  className="absolute inset-0 h-full w-full border-0"
                />
              )}
            </div>

            <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Volume2 className="size-4 text-accent" />
                  <span className="text-xs font-semibold text-ink">Video Language</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-lg bg-canvas p-1">
                    {(['hindi', 'english'] as const).map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => setAudioPref(lang)}
                        className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                          language === lang
                            ? 'bg-accent text-accent-ink'
                            : 'text-muted hover:text-ink'
                        }`}
                      >
                        {lang === 'hindi' ? 'Hindi' : 'English'}
                      </button>
                    ))}
                  </div>

                  {canWatch && embedUrl && (
                    <a
                      href={embedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-3 py-2 text-xs font-medium text-muted hover:border-accent/50 hover:text-ink"
                    >
                      <ExternalLink className="size-3.5" />
                      <span className="hidden sm:inline">Direct Player</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="border-t border-line pt-3">
                <div className="mb-2.5 flex items-center gap-2">
                  <Server className="size-4 text-teal" />
                  <span className="text-xs font-semibold text-ink">
                    Streaming Servers <span className="font-normal text-muted">· Mobile &amp; PC compatible</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {MOVIE_SERVERS.map((srv) => {
                    const active = srv.id === activeServer.id;
                    return (
                      <button
                        key={srv.id}
                        type="button"
                        onClick={() => setServerId(srv.id)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          active
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-canvas/50 text-muted hover:border-accent/40 hover:text-ink'
                        }`}
                      >
                        <div className="text-xs font-semibold">{srv.name}</div>
                        <div className="text-[11px] text-muted">{srv.note}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {mediaType === 'tv' && (
            <aside className="flex flex-col rounded-2xl border border-line bg-surface p-4 lg:col-span-4 xl:col-span-3 lg:max-h-[620px]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-bold text-ink">Episodes</h2>
                {seasons.length > 0 && (
                  <select
                    value={season}
                    onChange={(e) => setSearchParams({ s: e.target.value, e: '1' })}
                    aria-label="Season"
                    className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-ink focus:border-accent focus:outline-none"
                  >
                    {seasons.map((s) => (
                      <option key={s} value={s}>Season {s}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="max-h-72 flex-1 space-y-1.5 overflow-y-auto pr-1 lg:max-h-none">
                {seasonEpisodes.map((ep) => {
                  const active = ep.episode === episode;
                  return (
                    <button
                      key={ep.id}
                      type="button"
                      onClick={() => setSearchParams({ s: String(season), e: String(ep.episode) })}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                        active ? 'bg-accent text-accent-ink' : 'bg-canvas/40 text-ink hover:bg-surface-2'
                      }`}
                    >
                      <span className={`font-mono text-xs font-bold tabular-nums ${active ? 'text-accent-ink' : 'text-teal'}`}>
                        {String(ep.episode).padStart(2, '0')}
                      </span>
                      <span className="line-clamp-1 text-xs font-medium">{ep.title}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}
