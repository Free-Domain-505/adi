import { useCallback, useEffect, useState } from 'react';
import type { AnimeMedia } from '../types';
import { fetchDonghuaHome, pickTitle } from '../lib/api';
import { HeroCarousel } from '../components/HeroCarousel';
import { HubBar } from '../components/HubBar';
import { MediaRow } from '../components/MediaRow';
import { MediaCard } from '../components/MediaCard';
import { TrailerModal } from '../components/TrailerModal';

export default function DonghuaHomePage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchDonghuaHome>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trailerMedia, setTrailerMedia] = useState<AnimeMedia | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDonghuaHome();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load donghua feed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Donghua Hub — Anime by Adi 💀';
    load();
  }, [load]);

  const renderCards = (items?: AnimeMedia[], ranked = false) =>
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
      <HeroCarousel items={data?.trending || []} loading={loading} onPlayTrailer={setTrailerMedia} />

      <div className="space-y-12 pt-6 pb-8">
        <HubBar />

        <MediaRow
          eyebrow="Chinese animation"
          title="Trending Donghua"
          viewAll="/donghua/browse"
          loading={loading}
          error={error}
          onRetry={load}
        >
          {renderCards(data?.trending)}
        </MediaRow>

        <MediaRow
          eyebrow="Currently airing"
          title="Ongoing Cultivation & Action"
          viewAll="/donghua/browse?status=RELEASING"
          loading={loading}
          error={error}
          onRetry={load}
        >
          {renderCards(data?.airing)}
        </MediaRow>

        <MediaRow
          eyebrow="Most watched"
          title="Popular Donghua"
          viewAll="/donghua/browse?sort=POPULARITY_DESC"
          loading={loading}
          error={error}
          onRetry={load}
        >
          {renderCards(data?.popular)}
        </MediaRow>

        <MediaRow
          eyebrow="Top scores"
          title="Highest Rated Donghua"
          loading={loading}
          error={error}
          onRetry={load}
        >
          {renderCards(data?.top, true)}
        </MediaRow>
      </div>

      <TrailerModal media={trailerMedia} onClose={() => setTrailerMedia(null)} />
    </main>
  );
}
