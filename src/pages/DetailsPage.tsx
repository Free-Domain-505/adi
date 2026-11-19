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
import { MediaCard } from '../components/MediaCard';
import { TrailerModal } from '../components/TrailerModal';

export default function DetailsPage() {
  const { id } = useParams();
  const animeId = Number(id);

  const [media, setMedia] = useState<AnimeMedia | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([]);
  const [loading, setLoading] = useState(true);
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
    setError(null);

    Promise.all([fetchAnimeDetail(animeId), fetchAnimeEpisodes(animeId)])
      .then(([detail, epData]) => {
        if (cancelled) return;
        setMedia(detail);
        setEpisodes(epData.episodes || []);
        document.title = `${pickTitle(detail.title)} — Anime by Adi 💀`;
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

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas pt-24 pb-16">
        <div className="mx-auto max-w-7xl animate-pulse space-y-6 px-4 sm:px-6">
          <div className="h-64 w-full rounded-2xl bg-surface-2" />
          <div className="h-8 w-80 rounded bg-surface-2" />
          <div className="h-24 w-full max-w-2xl rounded bg-surface-2" />
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
  const studio = media.studios?.nodes?.find((s) => s.isAnimationStudio)?.name || media.studios?.nodes?.[0]?.name;
  const recommendations = (media.recommendations?.nodes || [])
    .map((n) => n.mediaRecommendation)
    .filter((m): m is AnimeMedia => Boolean(m));

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

      <div className="relative mx-auto -mt-32 max-w-7xl px-4 sm:-mt-40 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end">
          <div className="w-40 shrink-0 overflow-hidden rounded-xl border border-line bg-surface shadow-xl sm:w-52">
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
              {studio && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{studio}</span>
                </>
              )}
            </div>

            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl" style={{ textWrap: 'balance' }}>
              {title}
            </h1>

            {media.title.romaji && media.title.romaji !== title && (
              <p className="text-sm text-muted">{media.title.romaji}</p>
            )}

            {media.genres && media.genres.length > 0 && (
              <p className="text-xs font-medium text-accent">
                {media.genres.join(' · ')}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                to={`/watch/${media.id}?ep=1`}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink whitespace-nowrap transition-opacity hover:opacity-95"
              >
                <Play className="size-4 fill-current" />
                <span>Watch Episode 1</span>
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

        {/* Synopsis */}
        {media.description && (
          <section className="mt-10 max-w-4xl">
            <h2 className="font-display text-lg font-bold text-ink">Synopsis</h2>
            <p className="mt-2.5 whitespace-pre-line text-sm leading-relaxed text-muted sm:text-[15px]">
              {stripHtml(media.description)}
            </p>
          </section>
        )}

        {/* Episodes Grid */}
        <section className="mt-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-ink">
              Episodes <span className="ml-1.5 font-mono text-sm font-normal text-muted tabular-nums">({episodes.length})</span>
            </h2>
            {listEntry && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal">
                <Check className="size-3.5" />
                {STATUS_LABELS[listEntry.status]}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {episodes.slice(0, 48).map((ep) => (
              <Link
                key={ep.number}
                to={`/watch/${media.id}?ep=${ep.number}`}
                className="group flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5 transition-colors hover:border-accent/50"
              >
                <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                  <MediaImage src={ep.thumbnail || cover} alt={`Episode ${ep.number}`} className="h-full w-full object-cover" />
                  <div className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <Play className="size-4 fill-white text-white" />
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-teal tabular-nums">EP {ep.number}</p>
                  <p className="line-clamp-1 text-xs font-medium text-ink group-hover:text-accent">
                    {ep.title}
                  </p>
                </div>
              </Link>
            ))}
          </div>
          {episodes.length > 48 && (
            <div className="mt-4">
              <Link
                to={`/watch/${media.id}?ep=1`}
                className="text-xs font-semibold text-accent hover:underline"
              >
                View all {episodes.length} episodes in player →
              </Link>
            </div>
          )}
        </section>

        {/* Characters */}
        {media.characters?.edges && media.characters.edges.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 font-display text-xl font-bold text-ink">Characters &amp; Cast</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {media.characters.edges.slice(0, 9).map((edge) => {
                const va = edge.voiceActors?.[0];
                return (
                  <div
                    key={edge.node.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                        <MediaImage src={edge.node.image.large} alt={edge.node.name.full} className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-1 text-xs font-semibold text-ink">{edge.node.name.full}</p>
                        <p className="text-[11px] text-muted capitalize">{edge.role.toLowerCase()}</p>
                      </div>
                    </div>
                    {va && (
                      <div className="flex min-w-0 items-center gap-2.5 text-right">
                        <div className="min-w-0">
                          <p className="line-clamp-1 text-xs font-medium text-ink">{va.name.full}</p>
                          <p className="text-[11px] text-muted">Japanese</p>
                        </div>
                        <div className="h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                          <MediaImage src={va.image.large} alt={va.name.full} className="h-full w-full object-cover" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 font-display text-xl font-bold text-ink">More Like This</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {recommendations.slice(0, 6).map((rec) => (
                <MediaCard
                  key={rec.id}
                  href={`/anime/${rec.id}`}
                  title={pickTitle(rec.title)}
                  image={rec.coverImage?.extraLarge || rec.coverImage?.large}
                  meta={[
                    rec.format?.replace(/_/g, ' '),
                    rec.averageScore ? `${(rec.averageScore / 10).toFixed(1)} ★` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <TrailerModal media={showTrailer ? media : null} onClose={() => setShowTrailer(false)} />
    </main>
  );
}
