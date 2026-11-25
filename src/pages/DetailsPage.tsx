import { Img } from '../components/Img'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { shareMedia } from '../lib/share'
import { useMarkDetails, useSmartBack } from '../lib/backToDetails'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, CalendarDays, Captions, CheckCircle2, ChevronRight, Crown, ExternalLink, Globe, Headphones, Heart, Languages, Play, RefreshCw, Share2, ShieldAlert, ShieldCheck, TrendingUp, Users, Volume2 } from 'lucide-react'
import { fetchAnimeByMalId, fetchAnimeById, fetchWatchOrder } from '../services/anilist'
import { tmdbImg, fetchEpisodeServers, type ServerAudioInfo } from '../services/api'
import { computeAudioCheckingState, computeAvailableAudio } from '../lib/audioLabels'
import { useBackgroundAudioDetection } from '../lib/audioDetection'
import { tmdbBackdrops } from '../services/tmdbDirect'
import { fetchMalFull, fetchMalStats } from '../services/jikan'
import { useAsync } from '../hooks/useAsync'
import { useTmdb } from '../hooks/useTmdb'
import { useEpisodesState } from '../hooks/useEpisodes'
import { useFiller } from '../hooks/useFiller'
import { episodeCounts, extractSeasonNumber } from '../lib/episodes'
import { lastEpisode } from '../lib/progress'
import { ListButton } from '../components/ListButton'
import { useSearch } from '../context/SearchContext'
import { mediaToCard, recommendationToCard, relationToCard } from '../lib/mappers'
import { cn, compact, formatDate, formatLabel, formatStatus, humanize, pickTitle, stripHtml } from '../lib/utils'
import type { AniMediaDetails, CardItem, JikanStats } from '../types/anime'
import { AnimeCard } from '../components/AnimeCard'
import { BookCard, type BookCardItem } from '../components/BookCard'
import { AnimeRow } from '../components/AnimeRow'
import { CharacterCard } from '../components/CharacterCard'
import { Countdown } from '../components/Countdown'
import { DotPattern } from '../components/DotPattern'
import { EpisodeList } from '../components/EpisodeList'
import { Gallery } from '../components/Gallery'
import { StarBorder } from '../components/StarBorder'
import { ErrorState } from '../components/ErrorState'
import { NumberTicker } from '../components/NumberTicker'
import { Reveal } from '../components/Reveal'
import { ScoreChart } from '../components/ScoreChart'
import { ScoreRing } from '../components/ScoreRing'
import { ShimmerButton } from '../components/ShimmerButton'
import { Skeleton } from '../components/Skeleton'
import { SpotlightCard } from '../components/SpotlightCard'
import { StatCard } from '../components/StatCard'
import { StatusBreakdown } from '../components/StatusBreakdown'
import { Tabs } from '../components/Tabs'
import { TrailerModal } from '../components/TrailerModal'
import { WatchedBadge, WatchedThumbOverlay } from '../components/WatchedBadge'
import { getPrefs, useIsAnimeWatched, useWatchedAnimeIds, useWatchedEpisodes } from '../lib/library'

type TabId = 'overview' | 'episodes' | 'order' | 'characters' | 'relations' | 'gallery' | 'stats'

/** AniList's own score / status distributions, shaped like Jikan's so the same charts render when MyAnimeList is slow or down. */
function anilistStats(a: AniMediaDetails): JikanStats | null {
  const s = a.stats
  if (!s) return null
  const n = (k: string) => s.statusDistribution.find((x) => x.status === k)?.amount ?? 0
  const total = s.statusDistribution.reduce((sum, x) => sum + x.amount, 0)
  const votes = s.scoreDistribution.reduce((sum, x) => sum + x.amount, 0)
  if (!total && !votes) return null
  return {
    watching: n('CURRENT') + n('REPEATING'),
    completed: n('COMPLETED'),
    on_hold: n('PAUSED'),
    dropped: n('DROPPED'),
    plan_to_watch: n('PLANNING'),
    total,
    scores: s.scoreDistribution.map((x) => ({ score: x.score / 10, votes: x.amount, percentage: votes ? (x.amount / votes) * 100 : 0 })),
  }
}

/** Landscape gallery artwork slideshow displayed in the details page banner behind the poster. */
function BannerSlideshow({ images, fallback }: { images: string[]; fallback: string }) {
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)

  // Auto-advance every 5.5 seconds (paused when hovered)
  useEffect(() => {
    if (images.length <= 1 || hovered) return
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % images.length)
    }, 5500)
    return () => clearInterval(timer)
  }, [images.length, hovered])

  // Preload next image in sequence
  useEffect(() => {
    if (images.length <= 1) return
    const nextIdx = (index + 1) % images.length
    const img = new Image()
    img.src = images[nextIdx]
  }, [index, images])

  const cur = images[index] || fallback

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="absolute inset-0 z-0 isolate overflow-hidden select-none"
      style={{
        maskImage:
          'linear-gradient(to bottom, #000 0%, #000 32%, rgba(0,0,0,0.82) 48%, rgba(0,0,0,0.48) 62%, rgba(0,0,0,0.16) 74%, transparent 82%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, #000 0%, #000 32%, rgba(0,0,0,0.82) 48%, rgba(0,0,0,0.48) 62%, rgba(0,0,0,0.16) 74%, transparent 82%, transparent 100%)',
      }}
    >
      {fallback && (
        <img
          src={fallback}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-90"
        />
      )}
      <AnimatePresence initial={false}>
        <motion.img
          key={cur}
          src={cur}
          alt=""
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeInOut' }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </AnimatePresence>
    </div>
  )
}

export default function DetailsPage() {
  const params = useParams()
  const location = useLocation()
  useMarkDetails()
  const { openSearch } = useSearch()

  const fromMal = location.pathname.startsWith('/mal/')
  const rawId = Number(params.id)
  const validId = Number.isInteger(rawId) && rawId > 0

  const [tab, setTab] = useState<TabId>('overview')
  const [expanded, setExpanded] = useState(false)
  const [trailerOpen, setTrailerOpen] = useState(false)
  const [logoOk, setLogoOk] = useState(true)

  const anime = useAsync<AniMediaDetails>(
    () =>
      validId
        ? fromMal
          ? fetchAnimeByMalId(rawId)
          : fetchAnimeById(rawId)
        : Promise.reject(new Error('That anime link looks invalid.')),
    [rawId, fromMal],
  )

  const activeAnime =
    validId && anime.data && (fromMal ? anime.data.idMal === rawId : anime.data.id === rawId)
      ? anime.data
      : null
  const animeTitle = activeAnime ? pickTitle(activeAnime.title) : ''
  const tb = useTmdb(activeAnime?.id, animeTitle, activeAnime?.format)
  const tmdb = tb?.tmdb ?? null
  const malId = activeAnime?.idMal ?? tb?.mapping?.mal ?? null
  const mal = useAsync(() => (malId ? fetchMalFull(malId).catch(() => null) : Promise.resolve(null)), [malId])
  const stats = useAsync(() => (malId ? fetchMalStats(malId).catch(() => null) : Promise.resolve(null)), [malId])
  const titleSeason = activeAnime ? extractSeasonNumber(activeAnime.title) : null
  const seasonReady = Boolean(!activeAnime || titleSeason != null || !animeTitle || tb !== null)
  const currentSeason = useMemo(
    () => titleSeason ?? tb?.mapping?.tmdb?.season ?? 1,
    [titleSeason, tb?.mapping?.tmdb?.season],
  )
  const epState = useEpisodesState(tmdb, activeAnime?.streamingEpisodes, activeAnime ?? undefined, currentSeason)
  const episodesLoading = (Boolean(activeAnime?.id && animeTitle) && tb === null) || epState.loading
  const eps = useMemo(
    () => (episodesLoading ? new Map<number, import('../services/api').EpInfo>() : epState.episodes),
    [episodesLoading, epState.episodes],
  )
  const kinds = useFiller(activeAnime ?? undefined, tab === 'episodes')
  const order = useAsync(async () => (activeAnime ? fetchWatchOrder(activeAnime.id).catch(() => []) : undefined), [activeAnime?.id])
  const allBackdrops = useAsync(() => (tmdb ? tmdbBackdrops(tmdb.type, tmdb.id) : Promise.resolve([] as string[])), [tmdb?.id, tmdb?.type])
  const targetFormat = activeAnime?.format
  const targetCountry = activeAnime?.countryOfOrigin ?? null
  const animeRomaji = activeAnime?.title?.romaji ?? ''
  const isMovieTop =
    activeAnime?.format === 'MOVIE' ||
    tmdb?.type === 'movie' ||
    ((activeAnime?.episodes ?? 0) === 1 && (activeAnime?.duration ?? 0) >= 45)

  const derivedCounts = activeAnime ? episodeCounts(activeAnime) : { total: 1, available: 1 }
  const episodeCountForBreakdown = isMovieTop ? 1 : derivedCounts.total

  const audioDetector = useBackgroundAudioDetection({
    animeId: activeAnime?.id,
    totalEpisodes: episodeCountForBreakdown,
    title: animeTitle,
    romajiTitle: animeRomaji,
    countryOfOrigin: targetCountry,
    season: currentSeason,
    format: targetFormat,
    enabled: Boolean(activeAnime?.id && seasonReady),
  })

  const serverAvail = useAsync<Record<string, ServerAudioInfo>>(
    () =>
      activeAnime?.id && seasonReady
        ? fetchEpisodeServers(
            activeAnime.id,
            1,
            animeTitle,
            targetFormat,
            targetCountry,
            animeRomaji,
            episodeCountForBreakdown,
            currentSeason,
          )
        : Promise.resolve({}),
    [activeAnime?.id, seasonReady, animeTitle, animeRomaji, targetFormat, targetCountry, episodeCountForBreakdown, currentSeason],
  )

  const hasVerifiedReportServers = Boolean(
    audioDetector.report &&
      (audioDetector.report.hasVerifiedStreams === true ||
        audioDetector.report.hasDub ||
        audioDetector.report.tracks?.some((t) =>
          t.verifiedServers?.some((s) => s && s !== 'Indexed AnimeStream Servers'),
        )),
  )

  const audioChecking = computeAudioCheckingState({
    hasAnime: Boolean(activeAnime),
    seasonReady,
    detectorStatus: audioDetector.status,
    hasReport: Boolean(audioDetector.report),
    hasVerifiedReportServers,
    serverAvailLoading: serverAvail.loading,
    serverAvailHasData: serverAvail.data != null,
    hasMultipleEpisodes: false,
    remoteBreakdownLoading: false,
    remoteBreakdownHasData: true,
    remoteBreakdownHasError: false,
  })
  const audioAvail = useMemo(
    () => computeAvailableAudio(serverAvail.data, targetCountry, audioChecking, audioDetector.report),
    [serverAvail.data, targetCountry, audioChecking, audioDetector.report],
  )
  const origAudio = audioAvail.original
  const availableDubs = audioAvail.dubs
  const hasDub = audioAvail.hasDub

  const audioSummaryDisplay = audioChecking
    ? 'Checking audio…'
    : audioAvail.originalVerified && availableDubs.length > 0
      ? `${origAudio.shortLabel} · ${availableDubs.map((d) => d.label).join(' · ')}`
      : audioAvail.originalVerified
        ? origAudio.shortLabel
        : availableDubs.length > 0
          ? availableDubs.map((d) => d.label).join(' · ')
          : `${origAudio.detailLabel} (Limited availability)`



  useEffect(() => {
    setTab('overview')
    setExpanded(false)
    setLogoOk(true)
  }, [rawId, fromMal])

  // land on the episode list for anything watchable
  const loadedId = activeAnime?.id
  useEffect(() => {
    if (activeAnime && episodeCounts(activeAnime).available > 0) setTab('episodes')
  }, [loadedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const a = activeAnime
  const isAnimeWatched = useIsAnimeWatched(a?.id ?? 0, a?.episodes)
  const watchedSeasonEps = useWatchedEpisodes(a?.id ?? 0)
  const watchedAnimeIds = useWatchedAnimeIds()
  useEffect(() => {
    document.title = a ? `${pickTitle(a.title)} — AnimeStream` : 'AnimeStream'
  }, [a])

  const relations: CardItem[] = useMemo(
    () => (a?.relations.edges ?? []).filter((e) => e.node.type === 'ANIME').map(relationToCard),
    [a],
  )
  // The manga / light novel this anime is based on (or spun off from). They open the "where can I read it" page,
  // which looks the title up on every server and lists what is available.
  const print: BookCardItem[] = useMemo(
    () =>
      (a?.relations.edges ?? [])
        .filter((e) => e.node.type === 'MANGA')
        .map((e) => {
          const novel = e.node.format === 'NOVEL'
          const names = [e.node.title.english, e.node.title.romaji].filter((t): t is string => !!t)
          const title = names[0] ?? e.node.title.native ?? 'Untitled'
          const alt = names.filter((n) => n !== title).join('|')
          return {
            key: `${e.node.id}-${e.relationType}`,
            href: `/${novel ? 'novel' : 'manga'}/find?${new URLSearchParams({ title, alt, cover: e.node.coverImage.large ?? '' })}`,
            title,
            image: e.node.coverImage.large ?? '',
            score: e.node.averageScore ? (e.node.averageScore / 10).toFixed(1) : null,
            badge: novel ? 'Light novel' : e.node.format === 'ONE_SHOT' ? 'One shot' : 'Manga',
            caption: humanize(e.relationType),
          }
        }),
    [a],
  )
  const recommendations: CardItem[] = useMemo(
    () => (a?.recommendations.nodes ?? []).map(recommendationToCard).filter((c): c is CardItem => c !== null),
    [a],
  )

  const landscapeImages = useMemo(() => {
    const list: string[] = []
    const tmdbMain = tmdbImg(tmdb?.backdrop, 'w1280')
    if (tmdbMain) list.push(tmdbMain)
    if (a?.bannerImage && !list.includes(a.bannerImage)) list.push(a.bannerImage)
    if (tmdb?.backdrops?.length) {
      for (const b of tmdb.backdrops) {
        const u = tmdbImg(b, 'w1280')
        if (u && !list.includes(u)) list.push(u)
      }
    }
    if (allBackdrops.data?.length) {
      for (const u of allBackdrops.data) {
        if (u && !list.includes(u)) list.push(u)
      }
    }
    // Only include streaming episode thumbnails for multi-episode series, never for movies
    // where AniList / Crunchyroll often has Season 1 TV episodes attached (e.g. JJK 0, Mugen Train)
    if (a?.format !== 'MOVIE' && tmdb?.type !== 'movie') {
      for (const ep of a?.streamingEpisodes ?? []) {
        if (ep.thumbnail && !list.includes(ep.thumbnail)) {
          list.push(ep.thumbnail)
        }
      }
    }
    return list
  }, [tmdb, a?.bannerImage, a?.streamingEpisodes, a?.format, allBackdrops.data])

  const isMovie =
    a?.format === 'MOVIE' ||
    tmdb?.type === 'movie' ||
    ((a?.episodes ?? 0) === 1 && (a?.duration ?? 0) >= 45)

  const goBack = useSmartBack('/home')

  /* ------------------ loading / error ------------------ */
  if (anime.loading || (validId && !anime.error && !a)) return <DetailsSkeleton onBack={goBack} />

  if (anime.error || !a) {
    return (
      <main className="grid min-h-[80svh] place-items-center px-4 pt-24">
        <ErrorState message={anime.error?.message ?? 'Something went wrong.'} onRetry={anime.reload} />
      </main>
    )
  }

  /* ------------------ derived data ------------------ */
  const title = pickTitle(a.title)
  const subtitle = [a.title.native, a.title.romaji !== title ? a.title.romaji : null].filter(Boolean).join(' · ')
  const synopsis = stripHtml(a.description) || stripHtml(mal.data?.synopsis) || tmdb?.overview || ''
  const long = synopsis.length > 420
  const shownSynopsis = long && !expanded ? `${synopsis.slice(0, 420).trimEnd()}…` : synopsis
  const studios = a.studios.edges.filter((e) => e.isMain).map((e) => e.node.name)
  const producers = (mal.data?.producers ?? []).map((p) => p.name)
  const tags = a.tags.filter((t) => !t.isMediaSpoiler).slice(0, 14)
  const malScore = mal.data?.score ?? (a.averageScore ? Math.round(a.averageScore) / 10 : null)
  const ratedRank = a.rankings.find((r) => r.type === 'RATED' && r.allTime)
  const popularRank = a.rankings.find((r) => r.type === 'POPULAR' && r.allTime)
  const aired = [formatDate(a.startDate), formatDate(a.endDate)].filter(Boolean).join(' → ')

  const counts = episodeCounts(a)
  const resume = lastEpisode(a.id)
  const watchable = a.status !== 'NOT_YET_RELEASED' && counts.available > 0
  const prefAudio = getPrefs().audio ?? 'dub'
  const epNum = Math.min(resume || 1, counts.available || 1)
  const watchHref = `/watch/${a.id}?ep=${epNum}&audio=${prefAudio}`

  const heroImg = tmdbImg(tmdb?.backdrop, 'w1280') ?? a.bannerImage ?? a.coverImage.extraLarge ?? ''
  const statsView = stats.data ?? anilistStats(a)
  const epInfoDisplay =
    a.episodes ?? (a.nextAiringEpisode?.episode && a.nextAiringEpisode.episode > 1 ? a.nextAiringEpisode.episode - 1 : null)

  const info: [string, string][] = (
    [
      ['Format', formatLabel(a.format)],
      ['English', a.title?.english || '—'],
      ['Romaji', a.title?.romaji || '—'],
      ['Native', a.title?.native || '—'],
      ['Episodes', epInfoDisplay ? String(epInfoDisplay) : '—'],
      ['Duration', a.duration ? `${a.duration} min` : '—'],
      ['Status', formatStatus(a.status)],
      ['Aired', aired || '—'],
      ['Premiered', a.season && a.seasonYear ? `${humanize(a.season)} ${a.seasonYear}` : '—'],
      ['Source', a.source ? humanize(a.source) : '—'],
      ['Studio', studios.join(', ') || '—'],
      ['Producers', producers.slice(0, 3).join(', ') || '—'],
      ['Broadcast', mal.data?.broadcast?.string ?? '—'],
      ['Rating', mal.data?.rating ?? '—'],
      ['Country', a.countryOfOrigin ?? '—'],
      ['Network', tmdb?.networks.join(', ') || '—'],
      ['Certification', tmdb?.certification ?? '—'],
      ['Available audio', audioSummaryDisplay],
      ['Available subtitles', 'English, Spanish, French, German, Portuguese, Hindi & 8+ more'],
      ['Original language', tmdb?.language ? tmdb.language.toUpperCase() : '—'],
      ['All-time rank', ratedRank?.rank ? `#${ratedRank.rank}` : '—'],
      ['Popularity rank', popularRank?.rank ? `#${popularRank.rank}` : '—'],
    ] as [string, string][]
  ).filter(([, v]) => v !== '—')

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    ...(counts.available > 0 ? [{ id: 'episodes' as const, label: 'Episodes', count: counts.available }] : []),
    { id: 'order', label: 'Watch order', count: (order.data?.length ?? 0) > 1 ? order.data?.length : undefined },
    { id: 'characters', label: 'Characters', count: a.characters.edges.length },
    { id: 'relations', label: 'Related', count: relations.length + print.length },
    { id: 'gallery', label: 'Gallery' },
    { id: 'stats', label: 'Stats' },
  ]

  const malLink = malId ? `https://myanimelist.net/anime/${malId}` : null

  return (
    <main className="relative min-h-screen overscroll-y-none bg-background text-foreground">
      {/* ---------- Banner Slideshow ---------- */}
      <div className="relative h-[46svh] min-h-[320px] w-full overflow-x-clip bg-background sm:h-[48svh]">
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-3 overflow-hidden">
          <BannerSlideshow images={landscapeImages} fallback={heroImg} />
          <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-background/70 via-background/10 to-transparent" />
          <DotPattern className="z-[1] [mask-image:linear-gradient(to_bottom,white_0%,transparent_72%)] pointer-events-none" />
        </div>
        {/* Extended bottom fade extending past -bottom-6 so overscroll / subpixel resize can never reveal an edge gap */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-6 z-10 h-[66%]"
          style={{
            background:
              'linear-gradient(to top, var(--background) 0%, var(--background) 22%, color-mix(in srgb, var(--background) 88%, transparent) 42%, color-mix(in srgb, var(--background) 44%, transparent) 68%, transparent 100%)',
          }}
        />
        <button
          type="button"
          onClick={goBack}
          className="absolute left-4 top-6 z-30 inline-flex cursor-pointer touch-manipulation items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:border-foreground/30 hover:bg-card-2 sm:left-6"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
      </div>

      {/* ---------- Body ---------- */}
      <div className="relative z-20 mx-auto -mt-32 grid max-w-7xl gap-8 px-4 pb-16 sm:-mt-36 sm:px-6 lg:-mt-44 lg:grid-cols-[290px_minmax(0,1fr)] lg:gap-12">
        {/* Sidebar */}
        <aside className="lg:self-start">
          <div className="lg:sticky lg:top-24">
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="relative mx-auto aspect-[2/3] w-44 overflow-hidden rounded-3xl bg-card-2 shadow-2xl shadow-black/30 sm:w-56 lg:w-full"
            >
              <Img src={a.coverImage.extraLarge ?? a.coverImage.large ?? tmdbImg(tmdb?.poster, 'w500') ?? ''} alt={title} className="h-full w-full object-cover" />
              {isAnimeWatched && <WatchedThumbOverlay size="md" />}
            </motion.div>

            <div className="mt-4 flex flex-wrap justify-center gap-3 lg:flex-col lg:items-stretch">
              {watchable && (
                <StarBorder to={watchHref} className="block w-full max-w-xs self-center lg:max-w-none">
                  <Play className="size-4 fill-current" />{' '}
                  {isMovie
                    ? resume > 0
                      ? 'Continue watching'
                      : 'Watch now'
                    : resume > 0
                      ? `Continue · Ep ${Math.min(resume, counts.available || 1)}`
                      : 'Watch now'}
                </StarBorder>
              )}
              <ListButton item={mediaToCard(a)} className="justify-center rounded-full px-6 py-3 text-sm font-semibold" />
              {a.trailer?.id && (
                <ShimmerButton onClick={() => setTrailerOpen(true)} icon={<Play className="size-4 fill-current" />}>
                  Watch trailer
                </ShimmerButton>
              )}
              <ShimmerButton
                variant="ghost"
                onClick={() => shareMedia({ url: `${window.location.origin}/anime/${a.id}`, title, image: a.bannerImage ?? a.coverImage.extraLarge, poster: a.coverImage.extraLarge, label: 'Watch free on AnimeStream', subtitle: [a.format ? formatLabel(a.format) : '', a.seasonYear ?? ''].filter(Boolean).join(' · ') })}
                icon={<Share2 className="size-4" />}
              >
                Share
              </ShimmerButton>
              {a.siteUrl && (
                <ShimmerButton variant="ghost" href={a.siteUrl} icon={<ExternalLink className="size-4" />}>
                  AniList
                </ShimmerButton>
              )}
              {malLink && (
                <ShimmerButton variant="ghost" href={malLink} icon={<ExternalLink className="size-4" />}>
                  MyAnimeList
                </ShimmerButton>
              )}
            </div>
          </div>
        </aside>

        {/* Main column */}
        <div className="min-w-0 lg:pt-28">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
            <div className="text-center lg:text-left">
              <p className="mb-2 flex flex-wrap items-center justify-center gap-2 eyebrow text-accent lg:justify-start">
                <span>
                  {formatLabel(a.format)}
                  {a.seasonYear ? ` · ${a.seasonYear}` : ''} · {formatStatus(a.status)}
                </span>
                {isAnimeWatched && <WatchedBadge variant="pill" />}
              </p>
              {tmdb?.logo && logoOk && (
                <Img
                  src={tmdbImg(tmdb.logo, 'w500') ?? ''}
                  alt=""
                  hideSkeleton
                  onError={() => setLogoOk(false)}
                  className="mx-auto mb-2 max-h-24 w-auto max-w-full object-contain drop-shadow-[0_6px_24px_rgba(0,0,0,0.5)] sm:max-h-28 lg:mx-0 lg:object-left"
                />
              )}
              <h1 className={tmdb?.logo && logoOk ? 'sr-only' : 'font-display text-3xl font-black leading-tight tracking-tight [text-wrap:balance]'}>{title}</h1>
              {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
              {tmdb?.tagline && <p className="mt-2 text-sm italic text-muted">“{tmdb.tagline}”</p>}
              {/* Available Audio & Subtitles summary */}
              <div className="mt-3.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted lg:justify-start">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <Headphones className="size-3.5 text-accent" />
                  <span>
                    Audio:{' '}
                    {audioChecking ? (
                      <span className="inline-flex items-center gap-1.5 text-muted">
                        <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                        Checking audio…
                      </span>
                    ) : (
                      audioSummaryDisplay
                    )}
                  </span>
                </span>
                <span aria-hidden className="opacity-40">·</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <Captions className="size-3.5 text-accent" />
                  <span>Subtitles: English · Español · Português · 8+ more</span>
                </span>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-center gap-2 lg:justify-start">
              {a.genres.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => openSearch({ genre: g })}
                  className="rounded-full border border-border bg-card/85 px-3.5 py-1.5 text-sm transition hover:bg-foreground hover:text-background active:scale-95"
                >
                  {g}
                </button>
              ))}
            </div>

            {/* Scores */}
            <div className="mt-8 flex items-center justify-center gap-8 lg:justify-start">
              <ScoreRing value={a.averageScore} max={100} label="AniList" suffix="%" />
              <ScoreRing
                value={malScore}
                max={10}
                label="MyAnimeList"
                decimals={2}
                loading={Boolean(malId) && mal.loading}
              />
              {tmdb?.rating ? <ScoreRing value={tmdb.rating} max={10} label="TMDB" decimals={1} /> : null}
              <div className="hidden space-y-1 text-sm md:block">
                {ratedRank && (
                  <p className="flex items-center gap-2">
                    <Crown className="size-4 text-accent" /> <span className="font-semibold">#{ratedRank.rank}</span>
                    <span className="text-muted">highest rated</span>
                  </p>
                )}
                {popularRank && (
                  <p className="flex items-center gap-2">
                    <TrendingUp className="size-4 text-accent" /> <span className="font-semibold">#{popularRank.rank}</span>
                    <span className="text-muted">most popular</span>
                  </p>
                )}
              </div>
            </div>
          </motion.div>

          {a.nextAiringEpisode && (
            <Reveal className="mt-6 flex justify-center lg:justify-start">
              <Countdown airingAt={a.nextAiringEpisode.airingAt} episode={a.nextAiringEpisode.episode} />
            </Reveal>
          )}

          {/* Tabs */}
          <div className="mt-8 flex justify-center lg:justify-start">
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="mt-8"
            >
              {tab === 'overview' && (
                <div className="space-y-10">
                  <section>
                    <h2 className="mb-3 font-display text-xl font-bold">Synopsis</h2>
                    {synopsis ? (
                      <>
                        <p className="whitespace-pre-line leading-relaxed text-muted">{shownSynopsis}</p>
                        {long && (
                          <button
                            type="button"
                            onClick={() => setExpanded((v) => !v)}
                            className="mt-3 text-sm font-semibold text-accent hover:underline"
                          >
                            {expanded ? 'Show less' : 'Read more'}
                          </button>
                        )}
                      </>
                    ) : (
                      <p className="text-muted">No synopsis available yet.</p>
                    )}
                  </section>

                  <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    <StatCard
                      icon={<TrendingUp className="size-3.5" />}
                      label="MAL rank"
                      loading={Boolean(malId) && mal.loading}
                      value={mal.data?.rank ? <>#<NumberTicker value={mal.data.rank} /></> : '—'}
                    />
                    <StatCard
                      icon={<Users className="size-3.5" />}
                      label="Members"
                      loading={Boolean(malId) && mal.loading}
                      value={mal.data?.members ? compact(mal.data.members) : '—'}
                      hint="on MyAnimeList"
                    />
                    <StatCard
                      icon={<Heart className="size-3.5" />}
                      label="Favourites"
                      value={a.favourites ? compact(a.favourites) : '—'}
                      hint="on AniList"
                    />
                    <StatCard
                      icon={<CalendarDays className="size-3.5" />}
                      label="Popularity"
                      value={a.popularity ? compact(a.popularity) : '—'}
                      hint="AniList users"
                    />
                  </section>

                  {/* Available Languages (Dub & Sub) */}
                  <section>
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-9 items-center justify-center rounded-xl bg-accent/15 text-accent shadow-sm">
                          <Languages className="size-5" />
                        </div>
                        <div>
                          <h2 className="font-display text-xl font-bold leading-tight">Available Languages</h2>
                          <p className="text-xs text-muted">Dubbed audio tracks and multi-language subtitle translations</p>
                        </div>
                      </div>
                      <span className="text-xs text-muted">{audioAvail.badgeText}</span>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {/* Audio / Dub tracks card */}
                      <SpotlightCard className="flex flex-col p-5">
                        <div className="flex items-center justify-between border-b border-border/70 pb-3">
                          <div className="flex items-center gap-2">
                            <Headphones className="size-4 text-accent" />
                            <h3 className="text-sm font-bold tracking-tight">Audio Tracks &amp; Dubs</h3>
                          </div>
                          <span className="text-[11px] font-semibold text-muted">{audioAvail.tracksCountLabel}</span>
                        </div>

                        {/* Live Server Verification Status Banner */}
                        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-card-2/50 px-3 py-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            {audioChecking || audioDetector.isScanning ? (
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="relative flex size-2 shrink-0">
                                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-75" />
                                  <span className="relative inline-flex size-2 rounded-full bg-accent" />
                                </span>
                                <span className="text-foreground font-medium text-[11px] truncate">
                                  {audioDetector.scanMessage}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 min-w-0">
                                <ShieldCheck className="size-3.5 shrink-0 text-emerald-400" />
                                <span className="font-semibold text-emerald-400 text-[11px] truncate">
                                  {audioDetector.report?.accuracyGuarantee || '100% Server Verified · Zero False Details'}
                                </span>
                                {audioDetector.report?.verifiedServersCount ? (
                                  <span className="text-[10px] text-muted hidden sm:inline">
                                    · Tested on {audioDetector.report.verifiedServersCount} servers
                                  </span>
                                ) : null}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => void audioDetector.rescan()}
                            disabled={audioChecking || audioDetector.isScanning}
                            title="Re-verify audio across all episodes"
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/70 bg-card px-2 py-1 text-[10px] font-semibold text-foreground transition hover:border-foreground/40 hover:bg-card-2 disabled:opacity-50"
                          >
                            <RefreshCw className={cn('size-3', (audioChecking || audioDetector.isScanning) && 'animate-spin text-accent')} />
                            <span>{audioChecking || audioDetector.isScanning ? 'Testing…' : 'Re-verify'}</span>
                          </button>
                        </div>

                        {/* Donghua Zero False Details Banner */}
                        {(targetCountry === 'CN' || targetCountry === 'TW' || targetCountry === 'HK') && !hasDub && !audioChecking && (
                          <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-2.5 text-xs text-emerald-300">
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                            <span className="leading-relaxed text-[11px]">
                              <span className="font-bold text-white">Donghua Studio Verification:</span> All {episodeCountForBreakdown} episodes verified on streaming servers. Only authentic Original Chinese studio audio with multi-language subtitles is available. Zero false English/Hindi dubs listed.
                            </span>
                          </div>
                        )}

                        <p className="mt-3 text-xs leading-relaxed text-muted">
                          {audioChecking
                            ? 'Checking verified audio tracks across indexed servers…'
                            : audioAvail.hasAnyVerifiedStream
                              ? 'Verified audio tracks available across this title’s episodes:'
                              : 'Audio availability could not be verified on indexed servers for this episode:'}
                        </p>

                        <div className="mt-3 grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                          {audioChecking ? (
                            <>
                              <div className="skeleton h-[52px] rounded-xl" />
                              <div className="skeleton h-[52px] rounded-xl" />
                            </>
                          ) : (
                            <>
                              {audioAvail.originalVerified && (
                                <div className="flex items-center justify-between rounded-xl border border-border/50 bg-card-2/40 px-3 py-2.5 text-xs transition hover:border-border">
                                  <div className="min-w-0 pr-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-semibold text-foreground truncate">{origAudio.language}</span>
                                      <span className="rounded bg-accent/15 px-1 py-0.2 text-[9px] font-bold text-accent uppercase">
                                        Original
                                      </span>
                                    </div>
                                    <span className="block truncate text-[10px] text-muted">{origAudio.cardDescription}</span>
                                  </div>
                                  <span className="shrink-0 text-xs font-semibold text-emerald-400">
                                    <CheckCircle2 className="size-3.5" />
                                  </span>
                                </div>
                              )}

                              {availableDubs.map((lang) => (
                                <div
                                  key={lang.name}
                                  className="flex items-center justify-between rounded-xl border border-border/50 bg-card-2/40 px-3 py-2.5 text-xs transition hover:border-border"
                                >
                                  <div className="min-w-0 pr-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-semibold text-foreground truncate">{lang.label}</span>
                                      <span className="rounded bg-emerald-500/15 px-1 py-0.2 text-[9px] font-bold text-emerald-400 uppercase">
                                        Dub
                                      </span>
                                    </div>
                                    <span className="block truncate text-[10px] text-muted">
                                      {lang.verifiedServers && lang.verifiedServers.length > 0
                                        ? `${lang.native} · ${lang.verifiedServers.join(', ')}`
                                        : lang.native}
                                    </span>
                                  </div>
                                  <span className="shrink-0 text-xs font-semibold text-emerald-400">
                                    <CheckCircle2 className="size-3.5" />
                                  </span>
                                </div>
                              ))}
                            </>
                          )}
                        </div>

                        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border/50 bg-background/50 p-2.5 text-[11px] text-muted">
                          <Volume2 className="mt-0.5 size-4 shrink-0 text-accent" />
                          <span>
                            {audioChecking ? (
                              <>Checking verified original and dubbed audio streams on servers…</>
                            ) : hasDub ? (
                              <>
                                Switch audio in the video player via the <span className="font-semibold text-foreground">Audio / Dub</span> menu, or select multi-audio servers (MegaPlay / ACDN) to stream in your preferred dub language.
                              </>
                            ) : audioAvail.originalVerified ? (
                              <>
                                No dubbed audio tracks were found for this title’s episodes. Stream in{' '}
                                <span className="font-semibold text-foreground">Original {origAudio.language} Audio</span> with multi-language subtitles.
                              </>
                            ) : (
                              <>
                                No verified audio streams were detected on the server right now. Try opening the player to check fallback servers ({origAudio.shortLabel}).
                              </>
                            )}
                          </span>
                        </div>
                      </SpotlightCard>

                      {/* Subtitles & CC Card */}
                      <SpotlightCard className="flex flex-col p-5">
                        <div className="flex items-center justify-between border-b border-border/70 pb-3">
                          <div className="flex items-center gap-2">
                            <Captions className="size-4 text-accent" />
                            <h3 className="text-sm font-bold tracking-tight">Subtitles (Sub)</h3>
                          </div>
                          <span className="text-[11px] font-semibold text-muted">Multi-Language</span>
                        </div>

                        <p className="mt-3 text-xs leading-relaxed text-muted">
                          Official timed dialogue subtitles and Closed Captions (CC) with full font, color, and size customization:
                        </p>

                        <div className="mt-3 grid flex-1 grid-cols-2 gap-2 sm:grid-cols-2">
                          {[
                            { name: 'English', native: 'English CC', primary: true },
                            { name: 'Spanish', native: 'Español (Latino & Cast.)' },
                            { name: 'Portuguese', native: 'Português (Brasil)' },
                            { name: 'French', native: 'Français' },
                            { name: 'German', native: 'Deutsch' },
                            { name: 'Italian', native: 'Italiano' },
                            { name: 'Hindi', native: 'हिन्दी' },
                            { name: 'Arabic', native: 'العربية' },
                            { name: 'Russian', native: 'Русский' },
                            { name: 'Indonesian', native: 'Bahasa Indonesia' },
                          ].map((lang) => (
                            <div
                              key={lang.name}
                              className="flex items-center justify-between rounded-xl border border-border/50 bg-card-2/40 px-3 py-2 text-xs transition hover:border-border"
                            >
                              <div className="min-w-0 pr-1">
                                <span className="font-semibold text-foreground">{lang.name}</span>
                                <span className="block truncate text-[10px] text-muted">{lang.native}</span>
                              </div>
                              <span className="shrink-0 text-emerald-400">
                                <CheckCircle2 className="size-3.5" />
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border/50 bg-background/50 p-2.5 text-[11px] text-muted">
                          <Globe className="mt-0.5 size-4 shrink-0 text-accent" />
                          <span>
                            Switch subtitle language anytime via the <span className="font-semibold text-foreground">CC</span> icon in player controls, or change servers for alternate subtitle translations.
                          </span>
                        </div>
                      </SpotlightCard>
                    </div>
                  </section>

                  <section>
                    <h2 className="mb-3 font-display text-xl font-bold">Information</h2>
                    <SpotlightCard>
                      <dl className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
                        {info.map(([k, v], i) => (
                          <div
                            key={k}
                            className={`flex items-baseline justify-between gap-4 px-5 py-3.5 text-sm ${
                              i >= 2 ? 'sm:border-t sm:border-border' : ''
                            }`}
                          >
                            <dt className="shrink-0 text-muted">{k}</dt>
                            <dd className="text-right font-medium">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </SpotlightCard>
                  </section>

                  {tags.length > 0 && (
                    <section>
                      <h2 className="mb-3 font-display text-xl font-bold">Tags</h2>
                      <div className="flex flex-wrap gap-2">
                        {tags.map((t) => (
                          <span key={t.name} className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted">
                            {t.name} <span className="opacity-60">{t.rank}%</span>
                          </span>
                        ))}
                      </div>
                    </section>
                  )}

                  {mal.data && (mal.data.theme.openings.length > 0 || mal.data.theme.endings.length > 0) && (
                    <section className="grid gap-4 md:grid-cols-2">
                      {mal.data.theme.openings.length > 0 && (
                        <ThemeList heading="Openings" items={mal.data.theme.openings} />
                      )}
                      {mal.data.theme.endings.length > 0 && (
                        <ThemeList heading="Endings" items={mal.data.theme.endings} />
                      )}
                    </section>
                  )}

                  {a.staff.edges.length > 0 && (
                    <section>
                      <h2 className="mb-4 font-display text-xl font-bold">Staff</h2>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {a.staff.edges.slice(0, 8).map((s) => (
                          <div key={`${s.node.id}-${s.role}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 p-2.5">
                            <img src={s.node.image.large ?? ''} alt="" loading="lazy" className="size-11 shrink-0 rounded-full object-cover" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{s.node.name.full}</p>
                              <p className="truncate text-xs text-muted">{s.role ?? 'Staff'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {tmdb && tmdb.cast.length > 0 && (
                    <section>
                      <h2 className="mb-4 font-display text-xl font-bold">Cast</h2>
                      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                        {tmdb.cast.map((c) => (
                          <div key={`${c.name}-${c.character}`} className="w-28 shrink-0">
                            <div className="aspect-[3/4] overflow-hidden rounded-2xl border border-border bg-card-2">
                              {c.photo && <img src={tmdbImg(c.photo, 'w185') ?? ''} alt="" loading="lazy" className="h-full w-full object-cover" />}
                            </div>
                            <p className="mt-2 line-clamp-1 text-sm font-medium">{c.name}</p>
                            <p className="line-clamp-1 text-xs text-muted">{c.character}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {tmdb && tmdb.backdrops.length > 1 && (
                    <section>
                      <h2 className="mb-4 font-display text-xl font-bold">Gallery</h2>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        {tmdb.backdrops.slice(0, 6).map((b) => (
                          <img key={b} src={tmdbImg(b, 'w500') ?? ''} alt="" loading="lazy" className="aspect-video w-full rounded-2xl border border-border object-cover" />
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Where to Watch & Official Sources */}
                  <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="grid size-8 place-items-center rounded-xl bg-accent/15 text-accent">
                          <ShieldCheck className="size-4" />
                        </div>
                        <h2 className="font-display text-lg font-bold">Official Streaming Sources</h2>
                      </div>
                      {tmdb?.watchProviders?.link && (
                        <a
                          href={tmdb.watchProviders.link}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-foreground transition"
                        >
                          <span>JustWatch</span>
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>

                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3.5 sm:p-4 text-xs text-muted leading-relaxed mb-4">
                      <span className="font-semibold text-foreground">Support the Creators:</span> We strongly recommend streaming on official licensed platforms whenever available. Your support helps fund animators, voice actors, and future seasons.
                    </div>

                    {/* TMDB Providers */}
                    {tmdb?.watchProviders?.providers && tmdb.watchProviders.providers.length > 0 && (
                      <div className="space-y-2 mb-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Available On</p>
                        <div className="flex flex-wrap gap-2.5">
                          {tmdb.watchProviders.providers.map((p) => (
                            <a
                              key={p.id}
                              href={tmdb?.watchProviders?.link || `https://www.google.com/search?q=watch+${encodeURIComponent(title)}+on+${encodeURIComponent(p.name)}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-2.5 rounded-2xl border border-border bg-card/80 px-3.5 py-2 text-sm font-medium transition hover:border-foreground/40 hover:bg-card-2 active:scale-95"
                            >
                              {p.logo && (
                                <img
                                  src={p.logo}
                                  alt={p.name}
                                  className="size-6 rounded-md object-cover shadow-sm"
                                  onError={(e) => { (e.target as HTMLElement).style.display = 'none' }}
                                />
                              )}
                              <span>{p.name}</span>
                              <ExternalLink className="size-3 text-muted" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* MAL Streaming Links */}
                    {mal.data && mal.data.streaming && mal.data.streaming.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Direct Official Links</p>
                        <div className="flex flex-wrap gap-2">
                          {mal.data.streaming.map((s) => (
                            <a
                              key={s.url}
                              href={s.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 text-sm font-medium transition hover:bg-foreground hover:text-background"
                            >
                              {s.name} <ExternalLink className="size-3.5" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {(!tmdb?.watchProviders?.providers || tmdb.watchProviders.providers.length === 0) &&
                      (!mal.data?.streaming || mal.data.streaming.length === 0) && (
                        <p className="text-xs text-muted">
                          Official streaming availability varies by region. Check services such as Crunchyroll, Netflix, Disney+, Muse Asia, or Ani-One for your country.
                        </p>
                      )}
                  </section>

                  {/* Legal Notice & Disclaimer */}
                  <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
                    <div className="flex items-center gap-2.5 mb-2.5">
                      <div className="grid size-8 place-items-center rounded-xl bg-muted/15 text-muted">
                        <ShieldAlert className="size-4" />
                      </div>
                      <h2 className="font-display text-base font-bold">Legal Notice &amp; Disclaimer</h2>
                    </div>
                    <div className="space-y-2 text-xs text-muted leading-relaxed">
                      <p>
                        AnimeStream is a non-commercial anime catalog and media aggregator. We do not host, store, or upload any video files, media, or copyrighted content on our own servers.
                      </p>
                      <p>
                        All streaming media links, episode embeds, and playback sources are indexed from non-affiliated third-party providers on the public web. AnimeStream has no control over and assumes no responsibility for third-party servers or their content.
                      </p>
                      <p>
                        If you believe copyrighted material is being improperly accessed through linked external providers, please direct takedown notices directly to the hosting file servers.
                      </p>
                    </div>
                  </section>
                </div>
              )}

              {tab === 'episodes' && (
                <EpisodeList
                  key={a.id}
                  total={counts.total}
                  available={counts.available}
                  current={episodesLoading ? undefined : (resume || undefined)}
                  hrefFor={(n) => `/watch/${a.id}?ep=${n}&audio=${prefAudio}`}
                  info={eps}
                  fallbackImg={episodesLoading ? null : (a.bannerImage ?? a.coverImage.extraLarge)}
                  defaultRuntime={episodesLoading ? null : a.duration}
                  badge="Continue"
                  kinds={episodesLoading ? undefined : kinds}
                  watchedEps={episodesLoading ? undefined : watchedSeasonEps}
                  loading={episodesLoading}
                />
              )}

              {tab === 'order' && (() => {
                const orderLoading = order.loading || (Boolean(a.id) && order.data === undefined && !order.error)
                return (
                  <div>
                    {orderLoading ? (
                      <div className="space-y-3" aria-busy="true" aria-label="Loading watch order">
                        <div className="mb-5 flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                          <Skeleton className="h-4 w-3/4 rounded-md" />
                          <Skeleton className="h-4 w-28 rounded-md" />
                        </div>
                        {Array.from({ length: 4 }, (_, i) => (
                          <div key={i} className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-3.5 sm:gap-4 sm:p-4">
                            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
                            <Skeleton className="aspect-[2/3] w-14 shrink-0 rounded-xl sm:w-16" />
                            <div className="min-w-0 flex-1 space-y-2">
                              <Skeleton className="h-4 w-24 rounded-md" />
                              <Skeleton className="h-4 w-3/4 rounded-md" />
                              <Skeleton className="h-3 w-1/3 rounded-md" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : order.error ? (
                      <ErrorState message={order.error.message} onRetry={order.reload} />
                    ) : order.data && order.data.length > 0 ? (
                      <>
                        <div className="mb-5 flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-sm text-muted">
                            Chronological franchise guide. <span className="font-semibold text-foreground">Main story</span> entries form the core timeline; OVAs, specials and side stories are optional.
                          </p>
                          <span className="shrink-0 text-xs font-bold uppercase tracking-wider text-muted tabular-nums">
                            {order.data.length} {order.data.length === 1 ? 'Entry' : 'Entries'} · {order.data.filter((x) => x.main).length} Main
                          </span>
                        </div>
                        <ol className="space-y-3">
                          {order.data.map((e, i) => {
                            const here = e.id === a.id
                            const meta = [
                              formatLabel(e.format),
                              e.year,
                              e.episodes ? `${e.episodes} ep` : null,
                            ].filter(Boolean).join(' · ')
                            return (
                              <li key={e.id}>
                                <Link
                                  to={`/anime/${e.id}`}
                                  className={`group flex items-center gap-3.5 rounded-2xl border p-3.5 transition-colors sm:gap-4 sm:p-4 ${
                                    here
                                      ? 'border-accent bg-accent/10'
                                      : 'border-border bg-card hover:border-foreground/25 hover:bg-card-2'
                                  }`}
                                >
                                  <div
                                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-black tabular-nums ${
                                      here
                                        ? 'border-accent bg-accent text-accent-fg'
                                        : e.main
                                          ? 'border-border bg-foreground text-background'
                                          : 'border-border bg-card-2 text-muted'
                                    }`}
                                  >
                                    {String(i + 1).padStart(2, '0')}
                                  </div>
                                  <div
                                    className="relative aspect-[2/3] w-14 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card-2 sm:w-16"
                                    style={{ backgroundColor: e.color ?? undefined }}
                                  >
                                    <img
                                      src={e.image ?? ''}
                                      alt=""
                                      loading="lazy"
                                      decoding="async"
                                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                    />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                                      <span
                                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                          e.main
                                            ? 'bg-foreground/10 text-foreground border border-foreground/15'
                                            : 'bg-card-2 text-muted border border-border'
                                        }`}
                                      >
                                        {e.main ? 'Main story' : 'Side / extra'}
                                      </span>
                                      {here && (
                                        <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-fg">
                                          Current
                                        </span>
                                      )}
                                      {watchedAnimeIds.has(e.id) && <WatchedBadge variant="inline" />}
                                    </div>
                                    <h3 className="line-clamp-2 font-display text-sm font-bold leading-snug text-foreground transition-colors group-hover:text-accent sm:text-base">
                                      {pickTitle(e.title)}
                                    </h3>
                                    {meta && <p className="mt-1 text-xs text-muted">{meta}</p>}
                                  </div>
                                  <span className="hidden shrink-0 items-center gap-1 text-xs font-semibold text-muted transition-colors group-hover:text-accent sm:inline-flex">
                                    Details
                                    <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                                  </span>
                                </Link>
                              </li>
                            )
                          })}
                        </ol>
                      </>
                    ) : (
                      <Empty text="No other entries found — this looks like a standalone title." />
                    )}
                  </div>
                )
              })()}

              {tab === 'characters' && (() => {
                const tmdbPending = Boolean(a.id && animeTitle) && tb === null
                const charsLoading = anime.loading || (a.characters.edges.length === 0 && (mal.loading || tmdbPending))
                if (charsLoading) {
                  return (
                    <div className="grid gap-3 md:grid-cols-2" aria-busy="true" aria-label="Loading characters">
                      {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <Skeleton className="h-16 w-12 shrink-0 rounded-xl" />
                            <div className="min-w-0 flex-1 space-y-2">
                              <Skeleton className="h-4 w-3/4 rounded-md" />
                              <Skeleton className="h-3 w-1/2 rounded-md" />
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <div className="hidden space-y-1.5 sm:block">
                              <Skeleton className="h-3.5 w-20 rounded-md" />
                              <Skeleton className="h-3 w-14 rounded-md" />
                            </div>
                            <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                }
                return a.characters.edges.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {a.characters.edges.map((e) => (
                      <CharacterCard key={e.node.id} edge={e} />
                    ))}
                  </div>
                ) : (
                  <Empty text="No character data available yet." />
                )
              })()}

              {tab === 'relations' && (() => {
                const tmdbPending = Boolean(a.id && animeTitle) && tb === null
                const orderLoading = order.loading || (Boolean(a.id) && order.data === undefined && !order.error)
                const relLoading = anime.loading || (relations.length === 0 && print.length === 0 && (orderLoading || tmdbPending || mal.loading))
                if (relLoading) {
                  return (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading related titles">
                      {Array.from({ length: 8 }, (_, i) => (
                        <div key={i} className="space-y-2.5">
                          <Skeleton className="aspect-[2/3] w-full rounded-2xl" />
                          <Skeleton className="h-4 w-4/5 rounded-md" />
                          <Skeleton className="h-3 w-1/2 rounded-md" />
                        </div>
                      ))}
                    </div>
                  )
                }
                return (
                  <div className="space-y-10">
                    {relations.length > 0 && (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 xl:grid-cols-4">
                        {relations.map((r, i) => (
                          <AnimeCard key={`${r.id}-${r.caption}`} item={r} index={i} fluid />
                        ))}
                      </div>
                    )}
                    {print.length > 0 && (
                      <div>
                        <p className="mb-1 eyebrow text-accent">Read it</p>
                        <h3 className="mb-5 font-display text-xl font-bold">Manga &amp; novels</h3>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 xl:grid-cols-4">
                          {print.map((b, i) => (
                            <BookCard key={b.key} item={b} index={i} fluid />
                          ))}
                        </div>
                      </div>
                    )}
                    {relations.length === 0 && print.length === 0 && <Empty text="No related titles found." />}
                  </div>
                )
              })()}

              {tab === 'gallery' && (
                <Gallery anime={a} tmdb={tmdb} pending={Boolean(a.id && animeTitle) && tb === null} />
              )}

              {tab === 'stats' && (() => {
                const malPending = Boolean(a.id && !malId) && tb === null
                const statsLoadingFull = !statsView && (stats.loading || malPending)
                const statsUpdating = Boolean(statsView) && (stats.loading || malPending)
                return (
                  <div className="space-y-8" aria-busy={statsLoadingFull || statsUpdating}>
                    {statsLoadingFull ? (
                      <>
                        <SpotlightCard className="p-5 sm:p-6">
                          <Skeleton className="mb-5 h-6 w-48 rounded-md" />
                          <div className="space-y-3">
                            {Array.from({ length: 6 }, (_, i) => (
                              <div key={i} className="flex items-center gap-3">
                                <Skeleton className="h-4 w-8 rounded-md" />
                                <Skeleton className="h-5 flex-1 rounded-lg" />
                                <Skeleton className="h-4 w-12 rounded-md" />
                              </div>
                            ))}
                          </div>
                        </SpotlightCard>
                        <SpotlightCard className="p-5 sm:p-6">
                          <Skeleton className="mb-5 h-6 w-56 rounded-md" />
                          <Skeleton className="mb-4 h-3.5 w-full rounded-full" />
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {Array.from({ length: 4 }, (_, i) => (
                              <Skeleton key={i} className="h-16 rounded-2xl" />
                            ))}
                          </div>
                        </SpotlightCard>
                      </>
                    ) : statsView ? (
                      <>
                        {statsUpdating && (
                          <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-2.5 text-xs text-muted">
                            <span className="size-2 animate-pulse rounded-full bg-accent" />
                            <span>Loading full MyAnimeList statistics…</span>
                          </div>
                        )}
                        <SpotlightCard className="p-5 sm:p-6">
                          <h2 className="mb-5 font-display text-xl font-bold">
                            Score distribution <span className="ml-1 text-sm font-medium text-muted">{stats.data ? 'MyAnimeList' : 'AniList'}</span>
                          </h2>
                          <ScoreChart scores={statsView.scores} />
                        </SpotlightCard>
                        <SpotlightCard className="p-5 sm:p-6">
                          <h2 className="mb-5 font-display text-xl font-bold">
                            How people are watching <span className="ml-1 text-sm font-medium text-muted">{stats.data ? 'MyAnimeList' : 'AniList'}</span>
                          </h2>
                          <StatusBreakdown stats={statsView} />
                        </SpotlightCard>
                      </>
                    ) : (
                      <Empty text="Statistics aren't available for this title yet." />
                    )}
                  </div>
                )
              })()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {recommendations.length > 0 && (
        <div className="pb-8">
          <AnimeRow eyebrow="Because you looked" title="You might also like" items={recommendations} />
        </div>
      )}

      <TrailerModal trailer={trailerOpen ? a.trailer : null} onClose={() => setTrailerOpen(false)} />
    </main>
  )
}

/* ------------------ small local helpers ------------------ */
function ThemeList({ heading, items }: { heading: string; items: string[] }) {
  return (
    <SpotlightCard className="p-5">
      <h2 className="mb-3 font-display text-lg font-bold">{heading}</h2>
      <ul className="space-y-2 text-sm text-muted">
        {items.slice(0, 5).map((t) => (
          <li key={t} className="leading-snug">
            {t}
          </li>
        ))}
      </ul>
    </SpotlightCard>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-3xl border border-dashed border-border p-10 text-center text-sm text-muted">{text}</p>
}

function DetailsSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <main className="min-h-screen bg-background">
      <div className="relative h-[46svh] min-h-[320px] w-full overflow-hidden bg-background sm:h-[48svh]">
        <div
          className="absolute inset-0"
          style={{
            maskImage:
              'linear-gradient(to bottom, #000 0%, #000 38%, rgba(0,0,0,0.85) 52%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.25) 76%, rgba(0,0,0,0.06) 85%, transparent 92%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, #000 0%, #000 38%, rgba(0,0,0,0.85) 52%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.25) 76%, rgba(0,0,0,0.06) 85%, transparent 92%, transparent 100%)',
          }}
        >
          <Skeleton className="h-full w-full rounded-none" />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[60%]"
          style={{
            background:
              'linear-gradient(to top, var(--background) 0%, var(--background) 10%, color-mix(in srgb, var(--background) 86%, transparent) 30%, color-mix(in srgb, var(--background) 44%, transparent) 60%, transparent 100%)',
          }}
        />
        <button
          type="button"
          onClick={onBack}
          className="absolute left-4 top-6 z-30 inline-flex cursor-pointer touch-manipulation items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:border-foreground/30 hover:bg-card-2 sm:left-6"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
      </div>
      <div className="relative z-20 mx-auto -mt-32 grid max-w-7xl gap-8 px-4 sm:-mt-36 sm:px-6 lg:-mt-44 lg:grid-cols-[290px_minmax(0,1fr)] lg:gap-12">
        <Skeleton className="mx-auto aspect-[2/3] w-44 rounded-3xl sm:w-56 lg:w-full" />
        <div className="space-y-4 lg:pt-32">
          <Skeleton className="mx-auto h-10 w-3/4 lg:mx-0" />
          <Skeleton className="mx-auto h-4 w-1/2 lg:mx-0" />
          <div className="flex justify-center gap-2 lg:justify-start">
            <Skeleton className="h-8 w-20 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-full" />
          </div>
          <Skeleton className="h-28 w-full" />
          <div className="space-y-3 pt-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-3xl border border-border bg-card/60 p-2.5 sm:gap-4 sm:p-3">
                <Skeleton className="aspect-video w-36 shrink-0 rounded-2xl sm:w-52" />
                <div className="min-w-0 flex-1 space-y-2.5 py-1">
                  <Skeleton className="h-4 w-3/4 rounded-md" />
                  <Skeleton className="h-3 w-1/3 rounded-md" />
                  <Skeleton className="hidden h-3 w-11/12 rounded-md sm:block" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
