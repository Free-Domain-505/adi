import { useEffect, useMemo } from 'react'
import { fetchDonghuaHome } from '../services/anilist'
import { useAsync } from '../hooks/useAsync'
import { mediaToCard } from '../lib/mappers'
import { ContinueRow } from '../components/ContinueRow'
import { AnimeRow } from '../components/AnimeRow'
import { ErrorState } from '../components/ErrorState'
import { HeroCarousel } from '../components/HeroCarousel'
import { HeroLoader } from '../components/HeroLoader'
import { FeedEnd } from '../components/FeedEnd'

export default function DonghuaHomePage() {
  const home = useAsync(fetchDonghuaHome, [])

  useEffect(() => {
    document.title = 'Donghua — AnimeStream'
  }, [])

  const heroItems = useMemo(() => {
    const list = home.data?.trending ?? []
    const withBanner = list.filter((m) => m.bannerImage)
    return (withBanner.length >= 6 ? withBanner : list).slice(0, 14)
  }, [home.data])

  const rows = useMemo(
    () => ({
      trending: home.data?.trending.map(mediaToCard),
      airing: home.data?.season.map(mediaToCard),
      popular: home.data?.popular.map(mediaToCard),
      top: home.data?.top.map(mediaToCard),
      upcoming: home.data?.upcoming.map(mediaToCard),
    }),
    [home.data],
  )

  const err = home.error?.message

  return (
    <main className="bg-background">
      {home.loading ? (
        <div className="relative h-[68svh] max-h-[660px] min-h-[460px] overflow-hidden bg-background lg:h-[70svh] lg:max-h-[660px]">
          <HeroLoader />
        </div>
      ) : err ? (
        <div className="grid min-h-[60svh] place-items-center px-4 pt-20">
          <ErrorState message={err} onRetry={home.reload} />
        </div>
      ) : (
        <HeroCarousel items={heroItems} />
      )}

      <div className="relative z-10 -mt-1 space-y-12 bg-background pb-20 pt-9 sm:space-y-14">
        <ContinueRow />

        <AnimeRow
          id="donghua-trending"
          viewAll="/donghua/browse?sort=TRENDING_DESC"
          eyebrow="Chinese animation"
          title="Trending Donghua"
          items={rows.trending}
          loading={home.loading}
          error={err}
          onRetry={home.reload}
        />

        <AnimeRow
          id="donghua-airing"
          viewAll="/donghua/browse?status=RELEASING"
          eyebrow="Ongoing series"
          title="Currently Airing"
          items={rows.airing}
          loading={home.loading}
          error={err}
          onRetry={home.reload}
        />

        <AnimeRow
          id="donghua-popular"
          viewAll="/donghua/browse?sort=POPULARITY_DESC"
          eyebrow="Fan favourites"
          title="All-Time Popular Donghua"
          items={rows.popular}
          loading={home.loading}
          error={err}
          onRetry={home.reload}
        />

        <AnimeRow
          id="donghua-top"
          viewAll="/donghua/browse?sort=SCORE_DESC"
          eyebrow="Highest rated"
          title="Top Rated Donghua"
          items={rows.top}
          loading={home.loading}
          error={err}
          onRetry={home.reload}
          ranked
        />

        <AnimeRow
          id="donghua-upcoming"
          viewAll="/donghua/browse?status=NOT_YET_RELEASED"
          eyebrow="Mark your calendar"
          title="Coming Soon"
          items={rows.upcoming}
          loading={home.loading}
          error={err}
          onRetry={home.reload}
        />

        {!home.loading && !err && (
          <FeedEnd
            browseTo="/donghua/browse"
            browseLabel="Browse All Donghua"
            subtitle="Explore the full donghua catalog with genre, format, year, and status filters."
          />
        )}
      </div>
    </main>
  )
}
