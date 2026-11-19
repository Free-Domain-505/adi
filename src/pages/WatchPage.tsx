import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bookmark, Check, ChevronLeft, ChevronRight, Crown, ExternalLink, Search, Server, Ticket, Volume2 } from 'lucide-react';
import type { AnimeMedia, EpisodeInfo, IdMapping } from '../types';
import { fetchAnimeDetail, fetchAnimeEpisodes, fetchAnimeStreams, pickTitle, type ResolvedStream } from '../lib/api';
import { ANIME_ENGLISH_SERVERS } from '../lib/servers';
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

export default function WatchPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const animeId = Number(id);
  const currentEp = Math.max(1, Number(searchParams.get('ep')) || 1);
  const language = useAudioPref();
  const watchlist = useWatchlist();
  const { authReady } = useAuth();
  const { isSubscribed, extraCredits } = useSubscription();
  const usage = useDailyUsage();
  const savedEntry = watchlist.find((w) => w.key === `anime:${animeId}`);

  const videoKey = sanitizeDocId(`anime:${animeId}:ep:${currentEp}`);
  const [limitBlocked, setLimitBlocked] = useState(false);

  const [media, setMedia] = useState<AnimeMedia | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([]);
  const [ids, setIds] = useState<IdMapping>({ anilist: animeId });
  const [saltStreams, setSaltStreams] = useState<ResolvedStream[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [serverId, setServerId] = useState<string>('');
  const [epSearch, setEpSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(animeId) || animeId <= 0) return;
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
  }, [animeId, videoKey, isSubscribed, extraCredits, usage.dateKey]);

  const canWatch = isSubscribed || !limitBlocked;

  useEffect(() => {
    if (!Number.isFinite(animeId) || animeId <= 0) {
      setError('Invalid anime ID');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([fetchAnimeDetail(animeId), fetchAnimeEpisodes(animeId)])
      .then(([detail, epData]) => {
        if (cancelled) return;
        setMedia(detail);
        setEpisodes(epData.episodes || []);
        setIds({
          ...epData.ids,
          anilist: animeId,
          myanimelist: epData.ids?.myanimelist || detail.idMal || undefined,
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load stream');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [animeId]);

  useEffect(() => {
    if (!media) return;
    let cancelled = false;
    setStreamsLoading(true);

    fetchAnimeStreams({
      title: pickTitle(media.title),
      romaji: media.title.romaji || undefined,
      ep: currentEp,
      isMovie: media.format === 'MOVIE',
    })
      .then((list) => {
        if (!cancelled) setSaltStreams(list);
      })
      .catch(() => {
        if (!cancelled) setSaltStreams([]);
      })
      .finally(() => {
        if (!cancelled) setStreamsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [media, currentEp]);

  useEffect(() => {
    if (!media || !canWatch) return;
    const title = pickTitle(media.title);
    document.title = `Ep ${currentEp} · ${title} — Anime by Adi 💀`;
    recordHistory({
      key: `anime:${media.id}`,
      kind: media.countryOfOrigin === 'CN' ? 'donghua' : 'anime',
      id: String(media.id),
      title,
      image: media.bannerImage || media.coverImage?.extraLarge || media.coverImage?.large || '',
      href: `/watch/${media.id}?ep=${currentEp}`,
      subtitle: `Episode ${currentEp}`,
      episodeOrChapter: currentEp,
    });
  }, [media, currentEp, canWatch]);

  const allServers = useMemo(() => {
    const hindiList = saltStreams.filter((s) => s.language === 'hindi');
    const saltEnglish = saltStreams.filter((s) => s.language === 'english');
    const fallbackEnglish = ANIME_ENGLISH_SERVERS.map((srv) => ({
      id: srv.id,
      name: srv.name,
      language: 'english' as ResolvedStream['language'],
      note: srv.note,
      url: srv.buildUrl({
        anilistId: animeId,
        episode: currentEp,
        ids,
        isMovie: media?.format === 'MOVIE',
      }),
    })).filter((s): s is ResolvedStream => Boolean(s.url));

    if (language === 'hindi') {
      return [...hindiList, ...saltEnglish, ...fallbackEnglish];
    }
    return [...saltEnglish, ...fallbackEnglish, ...hindiList];
  }, [saltStreams, animeId, currentEp, ids, media?.format, language]);

  const hasHindiStream = useMemo(
    () => saltStreams.some((s) => s.language === 'hindi'),
    [saltStreams]
  );

  // Auto-select matching language server only on language/episode change or initial load
  useEffect(() => {
    setServerId((prev) => {
      if (prev && allServers.some((s) => s.id === prev)) {
        const current = allServers.find((s) => s.id === prev);
        if (current && current.language === language) return prev;
        const preferred = allServers.find((s) => s.language === language);
        if (preferred && current && current.language !== language) return preferred.id;
        return prev;
      }
      const preferred = allServers.find((s) => s.language === language);
      return preferred?.id || allServers[0]?.id || '';
    });
  }, [language, allServers]);

  const activeServer = allServers.find((s) => s.id === serverId) || allServers[0] || null;

  const filteredEpisodes = useMemo(() => {
    const q = epSearch.trim().toLowerCase();
    if (!q) return episodes;
    return episodes.filter(
      (ep) => String(ep.number).includes(q) || ep.title.toLowerCase().includes(q)
    );
  }, [episodes, epSearch]);

  const goToEp = (epNum: number) => {
    if (epNum < 1 || epNum > Math.max(episodes.length, 1)) return;
    setSearchParams({ ep: String(epNum) });
  };

  if (error) {
    return (
      <main className="grid min-h-[70vh] place-items-center bg-canvas px-4 pt-20">
        <div className="text-center">
          <p className="text-base font-semibold text-ink">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink"
          >
            Back to Home
          </button>
        </div>
      </main>
    );
  }

  const title = media ? pickTitle(media.title) : 'Loading...';
  const currentEpInfo = episodes.find((e) => e.number === currentEp);

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Top Breadcrumb */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to={`/anime/${animeId}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
            >
              <ArrowLeft className="size-3.5" />
              <span>Details</span>
            </Link>
            <div className="min-w-0">
              <h1 className="line-clamp-1 font-display text-lg font-bold text-ink sm:text-xl">
                {title}
              </h1>
              <p className="font-mono text-xs text-teal tabular-nums">
                Episode {currentEp}{' '}
                {currentEpInfo?.title && currentEpInfo.title !== `Episode ${currentEp}`
                  ? `· ${currentEpInfo.title}`
                  : ''}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {media && (
              <button
                type="button"
                onClick={() => {
                  if (savedEntry) {
                    removeFromWatchlist(`anime:${media.id}`);
                  } else {
                    upsertWatchlist({
                      key: `anime:${media.id}`,
                      kind: media.countryOfOrigin === 'CN' ? 'donghua' : 'anime',
                      id: String(media.id),
                      title: pickTitle(media.title),
                      image: media.coverImage?.extraLarge || media.coverImage?.large || '',
                      href: `/anime/${media.id}`,
                      status: 'watching',
                      total: media.episodes || null,
                      score: media.averageScore ? media.averageScore / 10 : null,
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
            <button
              type="button"
              disabled={currentEp <= 1}
              onClick={() => goToEp(currentEp - 1)}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40 hover:border-accent/50"
            >
              <ChevronLeft className="size-3.5" />
              <span>Prev</span>
            </button>
            <button
              type="button"
              disabled={currentEp >= episodes.length}
              onClick={() => goToEp(currentEp + 1)}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Main 2-column player + episodes layout */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8 xl:col-span-9">
            {/* Responsive Video Frame (Mobile + Desktop compatible) */}
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
                    <strong className="text-teal">₹{EXTRA_EPISODE_PRICE_INR}</strong> to watch 1 more episode right now, get{' '}
                    <strong className="text-amber-400">₹{MONTHLY_PRICE_INR}/month VIP</strong>, or come back after{' '}
                    <strong className="text-ink">12:00 AM midnight</strong> (in {getTimeUntilMidnightText()}) for 5 fresh episodes.
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
              ) : loading || !canWatch || !activeServer?.url ? (
                <div className="grid h-full w-full place-items-center text-sm text-muted">
                  Loading video player...
                </div>
              ) : (
                <iframe
                  key={activeServer.url}
                  src={activeServer.url}
                  title={`${title} Episode ${currentEp}`}
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope; clipboard-write"
                  allowFullScreen
                  referrerPolicy="origin"
                  className="absolute inset-0 h-full w-full border-0"
                />
              )}
            </div>

            {/* Language (Hindi / English Only) & Server Switcher */}
            <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Volume2 className="size-4 text-accent" />
                  <span className="text-xs font-semibold text-ink">Video Language</span>
                  {language === 'hindi' && !streamsLoading && !hasHindiStream && (
                    <span className="text-[11px] text-muted">
                      · Hindi unavailable for this episode, playing English
                    </span>
                  )}
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

                  {canWatch && activeServer?.url && (
                    <a
                      href={activeServer.url}
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
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Server className="size-4 text-teal" />
                    <span className="text-xs font-semibold text-ink">
                      Servers <span className="font-normal text-muted">· Switch server if video buffers on mobile or PC</span>
                    </span>
                  </div>
                  {streamsLoading && (
                    <span className="text-[11px] text-teal">Checking Hindi servers...</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {allServers.map((srv) => {
                    const active = activeServer?.id === srv.id;
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
                        <div className="text-xs font-semibold">
                          {srv.name}
                        </div>
                        <div className="text-[11px] text-muted">{srv.note}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Episode List Sidebar */}
          <aside className="flex flex-col rounded-2xl border border-line bg-surface p-4 lg:col-span-4 xl:col-span-3 lg:max-h-[640px]">
            <div className="flex items-center justify-between gap-2 pb-3">
              <h2 className="font-display text-sm font-bold text-ink">
                Episodes{' '}
                <span className="font-mono text-xs text-muted tabular-nums">({episodes.length})</span>
              </h2>
            </div>

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={epSearch}
                onChange={(e) => setEpSearch(e.target.value)}
                placeholder="Jump to episode..."
                className="w-full rounded-lg border border-line bg-canvas py-2 pl-8 pr-3 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </div>

            <div className="max-h-72 flex-1 space-y-1.5 overflow-y-auto pr-1 lg:max-h-none">
              {filteredEpisodes.map((ep) => {
                const active = ep.number === currentEp;
                return (
                  <button
                    key={ep.number}
                    type="button"
                    onClick={() => goToEp(ep.number)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                      active ? 'bg-accent text-accent-ink' : 'bg-canvas/40 text-ink hover:bg-surface-2'
                    }`}
                  >
                    <span
                      className={`font-mono text-xs font-bold tabular-nums ${
                        active ? 'text-accent-ink' : 'text-teal'
                      }`}
                    >
                      {String(ep.number).padStart(2, '0')}
                    </span>
                    <span className="line-clamp-1 text-xs font-medium">{ep.title}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
