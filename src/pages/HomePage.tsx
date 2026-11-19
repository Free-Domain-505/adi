import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { AiringItem, AnimeMedia } from '../types';
import {
  ANIME_GENRES,
  fetchAnimeHome,
  fetchLatestAiringEpisodes,
  formatRelativeTime,
  formatSeasonLabel,
  getCurrentSeason,
  pickTitle,
} from '../lib/api';
import { removeHistoryItem, useHistory } from '../lib/storage';
import { HeroCarousel } from '../components/HeroCarousel';
import { HubBar } from '../components/HubBar';
import { MediaRow } from '../components/MediaRow';
import { MediaCard } from '../components/MediaCard';
import { TrailerModal } from '../components/TrailerModal';

export default function HomePage() {
  const [homeData, setHomeData] = useState<Awaited<ReturnType<typeof fetchAnimeHome>> | null>(null);
  const [airing, setAiring] = useState<AiringItem[]>([]);
  const [loadingHome, setLoadingHome] = useState(true);
  const [loadingAiring, setLoadingAiring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trailerMedia, setTrailerMedia] = useState<AnimeMedia | null>(null);

  const history = useHistory();
  const { season, year } = getCurrentSeason();

  const loadAll = useCallback(async () => {
    setLoadingHome(true);
    setLoadingAiring(true);
    setError(null);
    fetchAnimeHome()
      .then((res) => setHomeData(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load feed'))
      .finally(() => setLoadingHome(false));

    fetchLatestAiringEpisodes()
      .then((res) => setAiring(res))
      .catch(() => setAiring([]))
      .finally(() => setLoadingAiring(false));
  }, []);

  useEffect(() => {
    document.title = 'Anime by Adi 💀 — Stream Anime, Donghua & Read Manga in HD';
    loadAll();
  }, [loadAll]);

  const heroItems = (homeData?.trending || []).filter((m) => m.bannerImage || m.coverImage?.extraLarge);

  const renderAnimeCards = (items?: AnimeMedia[], ranked = false) =>
    (items || []).map((item, i) => (
      <div key={item.id} className="w-[148px] sm:w-[172px] md:w-[186px] shrink-0 snap-start">
        <MediaCard
          href={`/anime/${item.id}`}
          title={pickTitle(item.title)}
          image={item.coverImage?.extraLarge || item.coverImage?.large}
          rank={ranked ? i + 1 : undefined}
          meta={[
            item.format?.replace(/_/g, ' '),
            item.seasonYear,
            item.averageScore ? `${(item.averageScore / 10).toFixed(1)} ★` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      </div>
    ));

  return (
    <main className="min-h-screen bg-canvas">
      <HeroCarousel items={heroItems} loading={loadingHome} onPlayTrailer={setTrailerMedia} />

      <div className="space-y-11 pt-6 pb-8 sm:space-y-13">
        <HubBar />

        {/* Continue Watching / Reading */}
        {history.length > 0 && (
          <MediaRow
            id="continue"
            eyebrow="Pick up right where you left off"
            title="Jump Back In"
            cardWidthClass="w-[220px] sm:w-[250px]"
            skeletonAspect="landscape"
          >
            {history.slice(0, 14).map((entry) => (
              <div key={entry.key} className="group relative w-[220px] sm:w-[250px] shrink-0 snap-start">
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
                  aria-label={`Remove ${entry.title} from history`}
                  className="absolute right-2 top-2 grid size-7 place-items-center rounded-md bg-black/75 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </MediaRow>
        )}

        {/* Latest Airing Episodes */}
        {(loadingAiring || airing.length > 0) && (
          <MediaRow
            id="latest-episodes"
            eyebrow="Fresh off the air"
            title="Just Dropped Today"
            viewAll="/schedule"
            loading={loadingAiring}
            cardWidthClass="w-[228px] sm:w-[256px]"
            skeletonAspect="landscape"
            skeletonCount={6}
          >
            {airing.slice(0, 16).map((ep) => (
              <div key={ep.id} className="w-[228px] sm:w-[256px] shrink-0 snap-start">
                <MediaCard
                  href={`/watch/${ep.media.id}?ep=${ep.episode}`}
                  title={pickTitle(ep.media.title)}
                  image={ep.media.bannerImage || ep.media.coverImage?.extraLarge || ep.media.coverImage?.large}
                  kicker={`Episode ${ep.episode}`}
                  meta={formatRelativeTime(ep.airingAt)}
                  aspect="landscape"
                />
              </div>
            ))}
          </MediaRow>
        )}

        {/* Genre Quick Filter Strip */}
        <section aria-label="Browse by genre" className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
            {ANIME_GENRES.map((genre) => (
              <Link
                key={genre}
                to={`/browse?genre=${encodeURIComponent(genre)}`}
                className="rounded-lg border border-line bg-surface px-3.5 py-2 text-xs font-medium text-muted whitespace-nowrap shrink-0 transition-colors hover:border-accent/50 hover:text-accent"
              >
                {genre}
              </Link>
            ))}
          </div>
        </section>

        <MediaRow
          id="trending"
          eyebrow="Everyone's watching"
          title="Trending Right Now"
          viewAll="/trending"
          loading={loadingHome}
          error={error}
          onRetry={loadAll}
        >
          {renderAnimeCards(homeData?.trending)}
        </MediaRow>

        <MediaRow
          id="season"
          eyebrow={formatSeasonLabel(season, year)}
          title="Hot This Season"
          viewAll={`/browse?season=${season}&year=${year}`}
          loading={loadingHome}
          error={error}
          onRetry={loadAll}
        >
          {renderAnimeCards(homeData?.season)}
        </MediaRow>

        <MediaRow
          id="popular"
          eyebrow="Iconic hits & fan favorites"
          title="Hall of Fame"
          viewAll="/popular"
          loading={loadingHome}
          error={error}
          onRetry={loadAll}
        >
          {renderAnimeCards(homeData?.popular)}
        </MediaRow>

        <MediaRow
          id="top"
          eyebrow="Highest rated classics & bangers"
          title="Top Rated Gems"
          viewAll="/top"
          loading={loadingHome}
          error={error}
          onRetry={loadAll}
        >
          {renderAnimeCards(homeData?.top, true)}
        </MediaRow>

        <MediaRow
          id="upcoming"
          eyebrow="Hype radar"
          title="Dropping Soon"
          viewAll="/browse?status=NOT_YET_RELEASED"
          loading={loadingHome}
          error={error}
          onRetry={loadAll}
        >
          {renderAnimeCards(homeData?.upcoming)}
        </MediaRow>
      </div>

      <TrailerModal media={trailerMedia} onClose={() => setTrailerMedia(null)} />
    </main>
  );
}
