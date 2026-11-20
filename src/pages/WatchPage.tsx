import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import type { AnimeMedia, EpisodeInfo, IdMapping } from '../types';
import {
  fetchAnimeDetail,
  fetchAnimeEpisodes,
  fetchAnimeStreams,
  pickTitle,
  type ResolvedStream,
} from '../lib/api';
import { ANIME_ENGLISH_SERVERS } from '../lib/servers';
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

export default function WatchPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const animeId = Number(id);
  const currentEp = Math.max(1, Number(searchParams.get('ep')) || 1);
  const currentSeason = Math.max(1, Number(searchParams.get('s')) || 1);
  const watchlist = useWatchlist();
  const { isSubscribed, extraCredits } = useSubscription();
  const usage = useDailyUsage();
  const savedEntry = watchlist.find((w) => w.key === `anime:${animeId}`);

  const videoKey = sanitizeDocId(`anime:${animeId}:s:${currentSeason}:ep:${currentEp}`);
  const [limitBlocked, setLimitBlocked] = useState(false);

  const [media, setMedia] = useState<AnimeMedia | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([]);
  const [tmdbSeasons, setTmdbSeasons] = useState<
    { number: number; name: string; episodes: number; anilistId?: number; malId?: number }[]
  >([]);
  const [ids, setIds] = useState<IdMapping>({ themoviedb: animeId });
  const [seasonAnilistId, setSeasonAnilistId] = useState<number | undefined>(undefined);
  const [absoluteOffset, setAbsoluteOffset] = useState<number>(0);
  const language = useAudioPref();
  const [resolvedStreams, setResolvedStreams] = useState<ResolvedStream[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'sub' | 'dub'>('dub');
  const [serverId, setServerId] = useState<string>(ANIME_ENGLISH_SERVERS[0]?.id || 'srv-1');
  const [manualServerPick, setManualServerPick] = useState(false);
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

    Promise.all([fetchAnimeDetail(animeId), fetchAnimeEpisodes(animeId, currentSeason)])
      .then(([detail, epData]) => {
        if (cancelled) return;
        setMedia(detail);
        setEpisodes(epData.episodes || []);
        const validSeasons: {
          number: number;
          name: string;
          episodes: number;
          poster?: string | null;
          anilistId?: number;
          malId?: number;
        }[] = ((epData.seasons && epData.seasons.length > 0 ? epData.seasons : detail.seasons) || []).filter(
          (s) => s.number > 0
        );
        setTmdbSeasons(validSeasons);
        const matchingSeason = validSeasons.find((s) => s.number === currentSeason);
        setSeasonAnilistId(epData.anilistId || matchingSeason?.anilistId);
        setAbsoluteOffset(epData.absoluteOffset || 0);
        setIds(
          epData.ids || {
            themoviedb: detail.tmdbId || animeId,
            anilist: animeId,
            mal: detail.idMal || undefined,
          }
        );
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
  }, [animeId, currentSeason]);

  useEffect(() => {
    setManualServerPick(false);
  }, [animeId, currentSeason, currentEp, language]);

  useEffect(() => {
    if (!media) return;
    let cancelled = false;
    setStreamsLoading(true);

    const streamEp = absoluteOffset > 0 ? absoluteOffset + currentEp : currentEp;
    fetchAnimeStreams({
      title: pickTitle(media.title),
      romaji: media.title.romaji || undefined,
      ep: currentEp,
      season: currentSeason,
      absEp: streamEp,
      isMovie: media.format === 'MOVIE',
    })
      .then((embedList) => {
        if (!cancelled) {
          setResolvedStreams(embedList);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedStreams([]);
        }
      })
      .finally(() => {
        if (!cancelled) setStreamsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [media, currentEp, currentSeason, seasonAnilistId, absoluteOffset]);

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
      href: `/watch/${media.id}?s=${currentSeason}&ep=${currentEp}`,
      subtitle: `S${currentSeason} · Episode ${currentEp}`,
      season: currentSeason,
      episodeOrChapter: currentEp,
    });
  }, [media, currentEp, currentSeason, canWatch]);

  // Build DUB embed server list, prioritizing Hindi dub servers when Hindi is selected
  const hasHindiDub = useMemo(
    () => resolvedStreams.some((s) => s.language === 'hindi'),
    [resolvedStreams]
  );

  const dubServers = useMemo(() => {
    const items: Array<{
      id: string;
      label: string;
      url: string;
      isHindiDub?: boolean;
    }> = [];

    const hindiSorted = resolvedStreams
      .filter((s) => s.language === 'hindi')
      .sort((a, b) => {
        if (a.id === 'salt-hindi' && b.id !== 'salt-hindi') return -1;
        if (b.id === 'salt-hindi' && a.id !== 'salt-hindi') return 1;
        return 0;
      });
    const englishResolved = resolvedStreams.filter((s) => s.language === 'english');

    const tmdbSeasonForEmbed = absoluteOffset > 0 ? 1 : currentSeason;
    const tmdbEpForEmbed = absoluteOffset > 0 ? absoluteOffset + currentEp : currentEp;

    if (language === 'hindi') {
      hindiSorted.forEach((s, idx) => {
        items.push({
          id: `${s.id}-${idx}`,
          label: `SERVER ${items.length + 1}`,
          url: s.url,
          isHindiDub: true,
        });
      });
    } else {
      englishResolved.forEach((s, idx) => {
        items.push({
          id: `${s.id}-${idx}`,
          label: `SERVER ${items.length + 1}`,
          url: s.url,
        });
      });
    }

    for (const srv of ANIME_ENGLISH_SERVERS) {
      const url = srv.buildUrl({
        tmdbId: ids.themoviedb || media?.tmdbId || animeId,
        episode: tmdbEpForEmbed,
        season: tmdbSeasonForEmbed,
        ids,
        isMovie: media?.format === 'MOVIE',
      });
      if (url) {
        items.push({
          id: srv.id,
          label: `SERVER ${items.length + 1}`,
          url,
        });
      }
    }

    return items;
  }, [resolvedStreams, language, animeId, currentEp, currentSeason, absoluteOffset, ids, media?.format]);

  // SUB English embed stream
  const subEmbedUrl = useMemo(() => {
    const enStream = resolvedStreams.find((s) => s.language === 'english');
    const firstFallback = dubServers.find((s) => !s.isHindiDub) || dubServers[0];
    return enStream?.url || firstFallback?.url || '';
  }, [resolvedStreams, dubServers]);

  useEffect(() => {
    setServerId((prev) => {
      if (manualServerPick && prev && dubServers.some((s) => s.id === prev)) return prev;
      return dubServers[0]?.id || ANIME_ENGLISH_SERVERS[0]?.id || 'srv-1';
    });
  }, [dubServers, manualServerPick]);

  const activeDubServer = dubServers.find((s) => s.id === serverId) || dubServers[0] || null;
  const activeEmbedUrl = selectedMode === 'sub' ? subEmbedUrl : activeDubServer?.url || '';

  const filteredEpisodes = useMemo(() => {
    const q = epSearch.trim().toLowerCase();
    if (!q) return episodes;
    return episodes.filter(
      (ep) => String(ep.number).includes(q) || ep.title.toLowerCase().includes(q)
    );
  }, [episodes, epSearch]);

  const goToEp = (epNum: number) => {
    if (epNum < 1 || epNum > Math.max(episodes.length, 1)) return;
    setSearchParams({ s: String(currentSeason), ep: String(epNum) });
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

  const title = media ? pickTitle(media.title) : '';
  const currentEpInfo = episodes.find((e) => e.number === currentEp);

  return (
    <main className="min-h-screen bg-canvas pt-20 pb-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Top Navigation Bar */}
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
              {loading ? (
                <div className="space-y-1.5">
                  <div className="skeleton-shimmer h-5 w-48 rounded" />
                  <div className="skeleton-shimmer h-3 w-32 rounded" />
                </div>
              ) : (
                <>
                  <h1 className="line-clamp-1 font-display text-lg font-bold text-ink sm:text-xl">
                    {title}
                  </h1>
                  <p className="font-mono text-xs text-sky-400 tabular-nums">
                    Season {currentSeason} · Episode {currentEp}
                    {currentEpInfo?.title && currentEpInfo.title !== `Episode ${currentEp}`
                      ? ` · ${currentEpInfo.title}`
                      : ''}
                  </p>
                </>
              )}
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
          ) : loading || streamsLoading || !canWatch || !activeEmbedUrl ? (
            <div className="skeleton-shimmer h-full w-full" />
          ) : (
            <iframe
              key={activeEmbedUrl}
              src={activeEmbedUrl}
              title={`${title} Episode ${currentEp}`}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope; clipboard-write"
              allowFullScreen
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full border-0"
            />
          )}
        </div>

        {/* Episode Heading + Server Selector (Matching Reference Layout) */}
        <section className="mt-5">
          <div className="text-center">
            <p className="text-sm font-bold text-sky-400 tabular-nums">
              Episode {currentEp}
            </p>
            <p className="mt-0.5 text-xs font-medium text-ink sm:text-sm">
              If current player not working, select other server.
            </p>
          </div>

          <div className="mt-3.5 rounded-xl border border-line bg-surface p-4 sm:p-5">
            {loading ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="skeleton-shimmer h-7 w-16 rounded" />
                  <div className="skeleton-shimmer h-8 w-24 rounded-md" />
                </div>
                <div className="border-t border-dashed border-line pt-3 flex flex-wrap items-center gap-2">
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
                    hindiAvailable={hasHindiDub}
                  />

                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-teal">
                    <ShieldCheck className="size-3.5" />
                    Ad-Blocked Player
                  </span>
                </div>

                {/* SUB Row */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-ink w-16 shrink-0">
                      <Captions className="size-4 text-muted" />
                      <span>SUB:</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMode('sub');
                          setAudioPref('english');
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
                    {streamsLoading && (
                      <span className="text-[11px] text-muted">Checking Hindi &amp; HD servers...</span>
                    )}
                  </div>
                </div>

                {/* Dashed Separator */}
                <div className="my-3.5 border-t border-dashed border-line" />

                {/* DUB Row */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-ink w-16 shrink-0">
                    <Mic className="size-4 text-muted" />
                    <span>DUB:</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {dubServers.map((srv) => {
                      const active = selectedMode === 'dub' && activeDubServer?.id === srv.id;
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

        {/* Episode Lists + Season Dropdown + Search (Matching Reference Layout) */}
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-base font-bold text-ink sm:text-lg">
                Episode Lists
              </h2>
              {tmdbSeasons.length > 0 && (
                <SeasonDropdown
                  seasons={tmdbSeasons}
                  selectedSeason={currentSeason}
                  onChange={(sNum) => setSearchParams({ s: String(sNum), ep: '1' })}
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
            {loading ? (
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
                  const active = ep.number === currentEp;
                  return (
                    <button
                      key={ep.number}
                      type="button"
                      onClick={() => goToEp(ep.number)}
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
                          {ep.number}
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
      </div>
    </main>
  );
}
