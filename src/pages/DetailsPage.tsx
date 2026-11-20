import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bookmark, Check, Heart, Play, Tv } from 'lucide-react';
import type { AnimeMedia, EpisodeInfo, WatchStatus } from '../types';
import {
  fetchAnimeDetail,
  fetchAnimeEpisodes,
  formatSeasonLabel,
  pickTitle,
  stripHtml,
} from '../lib/api';
import {
  STATUS_LABELS,
  removeFromWatchlist,
  toggleFavorite,
  upsertWatchlist,
  useWatchlist,
} from '../lib/storage';
import { MediaImage } from '../components/MediaImage';
import { TmdbLogoTitle } from '../components/TmdbLogoTitle';
import { MediaCard } from '../components/MediaCard';
import { TrailerModal } from '../components/TrailerModal';
import { SeasonDropdown } from '../components/SeasonDropdown';

export default function DetailsPage() {
  const { id } = useParams();
  const animeId = Number(id);

  const [media, setMedia] = useState<AnimeMedia | null>(null);
  const [seasons, setSeasons] = useState<{ number: number; name: string; episodes: number; poster?: string | null }[]>([]);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTrailer, setShowTrailer] = useState(false);

  const watchlist = useWatchlist();
  const key = `anime:${animeId}`;
  const listEntry = watchlist.find((w) => w.key === key);

  useEffect(() => {
    if (!Number.isFinite(animeId) || animeId <= 0) {
      setError('Invalid anime ID');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setSynopsisExpanded(false);
    setError(null);

    fetchAnimeDetail(animeId)
      .then((detail) => {
        if (cancelled) return;
        setMedia(detail);
        document.title = `${pickTitle(detail.title)} — Anime by Adi 💀`;

        const availableSeasons = (detail.seasons || []).filter((s) => s.number > 0);
        setSeasons(availableSeasons);
        const firstSeason = availableSeasons[0]?.number || 1;
        setSelectedSeason(firstSeason);

        return fetchAnimeEpisodes(animeId, firstSeason, pickTitle(detail.title));
      })
      .then((epData) => {
        if (!cancelled && epData) {
          setEpisodes(epData.episodes || []);
          if (Array.isArray(epData.seasons) && epData.seasons.length > 0) {
            setSeasons(epData.seasons.filter((s) => s.number > 0));
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load details');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [animeId]);

  // Handle Season Change
  const handleSeasonChange = async (seasonNum: number) => {
    if (seasonNum === selectedSeason) return;
    setSelectedSeason(seasonNum);
    setEpisodesLoading(true);
    try {
      const hintTitle = media ? pickTitle(media.title) : undefined;
      const data = await fetchAnimeEpisodes(animeId, seasonNum, hintTitle);
      setEpisodes(data.episodes || []);
    } catch {
      // Keep previous episodes if error
    } finally {
      setEpisodesLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas pb-16">
        <div className="relative h-72 w-full overflow-hidden bg-surface sm:h-96">
          <div className="skeleton-shimmer h-full w-full opacity-40" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/80 to-canvas/20" />
        </div>
        <div className="relative z-10 mx-auto -mt-32 max-w-7xl px-4 sm:-mt-40 sm:px-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-end">
            <div className="w-40 shrink-0 rounded-xl border border-line bg-canvas p-1 shadow-2xl sm:w-52">
              <div className="skeleton-shimmer aspect-[2/3] w-full rounded-lg" />
            </div>
            <div className="flex-1 space-y-3 pb-1">
              <div className="skeleton-shimmer h-4 w-56 rounded" />
              <div className="skeleton-shimmer h-14 w-72 max-w-full rounded-xl" />
              <div className="skeleton-shimmer h-3.5 w-48 rounded" />
              <div className="flex flex-wrap gap-3 pt-2">
                <div className="skeleton-shimmer h-10 w-36 rounded-lg" />
                <div className="skeleton-shimmer h-10 w-32 rounded-lg" />
                <div className="skeleton-shimmer h-10 w-28 rounded-lg" />
              </div>
            </div>
          </div>
          <div className="mt-10 max-w-4xl space-y-2.5">
            <div className="skeleton-shimmer h-5 w-28 rounded" />
            <div className="skeleton-shimmer h-4 w-full rounded" />
            <div className="skeleton-shimmer h-4 w-5/6 rounded" />
          </div>
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-line bg-surface">
                <div className="skeleton-shimmer aspect-video w-full" />
                <div className="space-y-2 p-3.5">
                  <div className="skeleton-shimmer h-3.5 w-3/4 rounded" />
                  <div className="skeleton-shimmer h-3 w-full rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (error || !media) {
    return (
      <main className="grid min-h-[70vh] place-items-center bg-canvas px-4 pt-20">
        <div className="text-center">
          <p className="text-lg font-semibold text-ink">{error || 'Anime not found'}</p>
          <Link to="/home" className="mt-4 inline-block text-sm font-semibold text-accent hover:underline">
            Back to Home
          </Link>
        </div>
      </main>
    );
  }

  const title = pickTitle(media.title);
  const cover = media.coverImage?.extraLarge || media.coverImage?.large || '';
  const banner = media.bannerImage || cover;
  const recommendations = (media.recommendations?.nodes || [])
    .map((n) => n.mediaRecommendation)
    .filter((m): m is AnimeMedia => Boolean(m));
  const cleanDescription = stripHtml(media.description || '');
  const isLongSynopsis = cleanDescription.length > 130;

  const saveStatus = (status: WatchStatus) => {
    upsertWatchlist({
      key,
      kind: media.countryOfOrigin === 'CN' ? 'donghua' : 'anime',
      id: String(media.id),
      title,
      image: cover,
      href: `/anime/${media.id}`,
      status,
      total: media.episodes || episodes.length || null,
      score: media.averageScore ? media.averageScore / 10 : null,
    });
  };

  return (
    <main className="min-h-screen bg-canvas pb-16">
      {/* Banner Backdrop */}
      <div className="relative h-72 w-full overflow-hidden bg-surface sm:h-96">
        <MediaImage src={banner} alt={title} loading="eager" className="h-full w-full object-cover object-center opacity-55" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/65 to-canvas/20" />
      </div>

      <div className="relative z-10 mx-auto -mt-32 max-w-7xl px-4 sm:-mt-40 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end">
          <div className="w-40 shrink-0 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl sm:w-52">
            <div className="aspect-[2/3] w-full">
              <MediaImage src={cover} alt={title} className="h-full w-full object-cover" />
            </div>
          </div>

          <div className="flex-1 space-y-3 pb-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted tabular-nums">
              {media.format && <span className="text-teal font-semibold">{media.format.replace(/_/g, ' ')}</span>}
              {media.seasonYear && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{formatSeasonLabel(media.season, media.seasonYear)}</span>
                </>
              )}
              {media.status && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{media.status.replace(/_/g, ' ')}</span>
                </>
              )}
              {media.averageScore && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-accent font-semibold">{(media.averageScore / 10).toFixed(1)} ★</span>
                </>
              )}
              {seasons.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{seasons.length} Season{seasons.length > 1 ? 's' : ''}</span>
                </>
              )}
            </div>

            {/* TMDB Official Logo (No text shown if logo exists) */}
            <div className="py-1">
              <TmdbLogoTitle
                title={title}
                tmdbId={media.tmdbId}
                initialLogo={media.logo}
                className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl"
                imgClassName="max-h-20 sm:max-h-24 md:max-h-28 max-w-[280px] sm:max-w-md md:max-w-lg object-contain object-left drop-shadow-2xl"
              />
            </div>

            {media.genres && media.genres.length > 0 && (
              <p className="text-xs font-medium text-accent">
                {media.genres.join(' · ')}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                to={`/watch/${media.id}?s=${selectedSeason}&ep=1`}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink whitespace-nowrap transition-opacity hover:opacity-95"
              >
                <Play className="size-4 fill-current" />
                <span>Watch S{selectedSeason} E1</span>
              </Link>

              <select
                value={listEntry?.status || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) removeFromWatchlist(key);
                  else saveStatus(val as WatchStatus);
                }}
                aria-label="Watchlist status"
                className="rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-ink focus:border-accent focus:outline-none"
              >
                <option value="">+ Add to List</option>
                {(Object.keys(STATUS_LABELS) as WatchStatus[]).map((st) => (
                  <option key={st} value={st}>
                    {listEntry?.status === st ? `✓ ${STATUS_LABELS[st]}` : STATUS_LABELS[st]}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() =>
                  toggleFavorite({
                    key,
                    kind: media.countryOfOrigin === 'CN' ? 'donghua' : 'anime',
                    id: String(media.id),
                    title,
                    image: cover,
                    href: `/anime/${media.id}`,
                    total: media.episodes || episodes.length || null,
                    score: media.averageScore ? media.averageScore / 10 : null,
                  })
                }
                aria-label="Toggle favorite"
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  listEntry?.favorite
                    ? 'border-accent/60 bg-accent/15 text-accent'
                    : 'border-line bg-surface text-muted hover:text-ink'
                }`}
              >
                <Heart className={`size-4 ${listEntry?.favorite ? 'fill-current' : ''}`} />
                <span>{listEntry?.favorite ? 'Favorited' : 'Favorite'}</span>
              </button>

              {media.trailer?.site === 'youtube' && (
                <button
                  type="button"
                  onClick={() => setShowTrailer(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-muted hover:text-ink"
                >
                  <Tv className="size-4" />
                  <span>Trailer</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Synopsis Description (Compact with Read more toggle) */}
        {cleanDescription && (
          <section className="mt-5 max-w-xl">
            <h2 className="font-display text-xs font-bold tracking-wide text-ink sm:text-[13px]">
              Synopsis Description
            </h2>
            <p
              className={`mt-1 whitespace-pre-line text-[11px] leading-relaxed text-muted sm:text-xs ${
                synopsisExpanded ? '' : 'line-clamp-2'
              }`}
            >
              {cleanDescription}
            </p>
            {isLongSynopsis && (
              <button
                type="button"
                onClick={() => setSynopsisExpanded((prev) => !prev)}
                className="mt-1 text-[11px] font-semibold text-sky-400 hover:underline"
              >
                {synopsisExpanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </section>
        )}

        {/* Episodes Section with Left-Aligned Custom Season Dropdown & Widescreen Episode Cards */}
        <section className="mt-12">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-xl font-bold text-ink">
                Episodes{' '}
                <span className="ml-1 font-mono text-sm font-normal text-muted tabular-nums">
                  ({episodes.length})
                </span>
              </h2>
              {seasons.length > 0 && (
                <SeasonDropdown
                  seasons={seasons}
                  selectedSeason={selectedSeason}
                  onChange={handleSeasonChange}
                />
              )}
            </div>

            {listEntry && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal">
                <Check className="size-3.5" />
                {STATUS_LABELS[listEntry.status]}
              </span>
            )}
          </div>

          {episodesLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-xl border border-line bg-surface">
                  <div className="skeleton-shimmer aspect-video w-full" />
                  <div className="space-y-2 p-3.5">
                    <div className="skeleton-shimmer h-3.5 w-3/4 rounded" />
                    <div className="skeleton-shimmer h-3 w-full rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : episodes.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-muted">
              No episodes available for Season {selectedSeason}.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {episodes.slice(0, 48).map((ep) => (
                <Link
                  key={ep.number}
                  to={`/watch/${media.id}?s=${selectedSeason}&ep=${ep.number}`}
                  className="group overflow-hidden rounded-xl border border-line bg-surface transition-all hover:border-sky-400/50 hover:shadow-lg hover:shadow-black/20"
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-surface-2">
                    <MediaImage
                      src={ep.thumbnail || banner || cover}
                      alt={`Episode ${ep.number}`}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                    <span className="absolute bottom-2.5 left-2.5 font-mono text-[11px] font-bold text-white drop-shadow tabular-nums">
                      EP {ep.number}
                    </span>
                    <div className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="grid size-10 place-items-center rounded-full bg-sky-500 text-slate-950 shadow-lg">
                        <Play className="size-4 translate-x-0.5 fill-current" />
                      </span>
                    </div>
                  </div>
                  <div className="p-3.5">
                    <h3 className="line-clamp-1 text-sm font-semibold text-ink transition-colors group-hover:text-sky-400">
                      {ep.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                      {ep.overview || `Season ${selectedSeason} · Episode ${ep.number}`}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {episodes.length > 48 && (
            <div className="mt-5">
              <Link
                to={`/watch/${media.id}?s=${selectedSeason}&ep=1`}
                className="text-xs font-semibold text-sky-400 hover:underline"
              >
                View all {episodes.length} episodes in player →
              </Link>
            </div>
          )}
        </section>

        {/* Characters & Cast */}
        {media.characters?.edges && media.characters.edges.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 font-display text-xl font-bold text-ink">Characters &amp; Cast</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {media.characters.edges.slice(0, 9).map((edge) => {
                return (
                  <div
                    key={edge.node.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="size-11 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                        {edge.node.image?.large ? (
                          <MediaImage src={edge.node.image.large} alt={edge.node.name.full} className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full w-full place-items-center text-xs font-bold text-muted">
                            {edge.node.name.full.charAt(0)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-1 text-xs font-medium text-ink">{edge.node.name.full}</p>
                        <p className="text-[11px] text-muted">{edge.role}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 font-display text-xl font-bold text-ink">You Might Also Like</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {recommendations.slice(0, 12).map((rec) => (
                <MediaCard
                  key={rec.id}
                  href={`/anime/${rec.id}`}
                  title={pickTitle(rec.title)}
                  image={rec.coverImage?.extraLarge || rec.coverImage?.large}
                  meta={rec.averageScore ? `${(rec.averageScore / 10).toFixed(1)} ★` : undefined}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <TrailerModal
        media={showTrailer ? media : null}
        onClose={() => setShowTrailer(false)}
      />
    </main>
  );
}
