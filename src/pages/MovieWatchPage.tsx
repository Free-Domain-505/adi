import { toast } from '../lib/toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Bookmark,
  Captions,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Film,
  Info,
  Languages,
  Loader2,
  Lock,
  Mic,
  RotateCw,
  Share2,
  Star,
  Tv,
} from 'lucide-react'
import { Img } from '../components/Img'
import { BookRow } from '../components/BookRow'
import { ErrorState } from '../components/ErrorState'
import { EpisodeList } from '../components/EpisodeList'
import { Skeleton } from '../components/Skeleton'
import { StreamProblem } from '../components/StreamProblem'
import { SeasonDropdown } from '../components/SeasonDropdown'
import { ServerCategoryDropdown } from '../components/ServerCategoryDropdown'
import { TrailerModal } from '../components/TrailerModal'
import { useAsync } from '../hooks/useAsync'
import { toMovieCard } from '../lib/movieCards'
import { shareMedia } from '../lib/share'
import { resolveAnimeWithFallback, type ResolvedAnimePlayback, type SkipTimes } from '../lib/animePlayback'
import { getOriginalAudioMeta } from '../lib/audioLabels'
import { computeServerCategoryAvailability, resolveActiveSlotKey, WATCH_SERVER_SLOTS, type WatchServerSlot } from '../lib/servers'
import { useShieldVerified, useShield, getToken } from '../lib/shield'
import {
  backupMatchesRequestedDub,
  buildCinemaOsEmbedUrl,
  buildMovieStreamAttempts,
  buildVidzeeEmbedUrl,
  cleanMovieDubLabel,
  isPotentialAnimeTmdbMovie,
  isTrustedMovieEmbedUrl,
  maskMovieServerLabel,
  MOVIE_WATCH_SERVER_SLOTS,
  resolveActiveMovieSlotKey,
  resolveRequestedDubInfo,
} from '../lib/movieServers'
import { type PlayerServer } from '../components/CinePlayer'
import { cn, pickTitle } from '../lib/utils'
import { fetchEpisodeServers, type StreamResult } from '../services/api'
import {
  fetchDetails,
  fetchEpisodes,
  fetchTmdbAnimeMatch,
  img,
  fetchMovieBoxStream,
  fetchVidzeeStream,
  resolveMovieEmbedStream,
  movieHref,
  detectMovieStream,
  type AnimeMovieMatch,
  type MediaType,
  type MovieDub,
  type WorkingMovieSource,
} from '../services/movies'
import CinePlayer from '../components/CinePlayer'
import { resolveBestSkipPair, type SkipTimeSources } from '../lib/skipValidation'
import { fetchSkipTimesSources } from '../services/skipTimes'
import { WatchedBadge } from '../components/WatchedBadge'
import {
  addToList,
  finishMovieWatch,
  getPrefs,
  removeFromList,
  touchMovieProgress,
  useIsMovieWatched,
  useListItem,
  useWatchedMovieEps,
} from '../lib/library'

const pill = 'rounded-full border px-4 py-2 text-sm font-semibold transition active:scale-95'
const formatRuntime = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)
const cleanDubLabel = cleanMovieDubLabel

export default function MovieWatchPage() {
  const { type: rawType, id: rawId } = useParams()
  const type: MediaType = rawType === 'tv' ? 'tv' : 'movie'
  const id = Number(rawId)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const season = Math.max(1, Number(params.get('s')) || 1)
  const episode = Math.max(1, Number(params.get('e')) || 1)

  const details = useAsync(() => fetchDetails(type, id), [type, id])
  const eps = useAsync(() => (type === 'tv' ? fetchEpisodes(id, season) : Promise.resolve([])), [type, id, season])

  const [activeSource, setActiveSource] = useState<WorkingMovieSource | null>(null)
  const [directBackups, setDirectBackups] = useState<WorkingMovieSource[]>([])
  const [embedBackups, setEmbedBackups] = useState<WorkingMovieSource[]>([])
  const [loadingStream, setLoadingStream] = useState(true)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [pendingMovieSlotKey, setPendingMovieSlotKey] = useState<string | null>(null)
  const [mbAttemptIdx, setMbAttemptIdx] = useState(0)
  const [selectedDub, setSelectedDub] = useState<string | null>(params.get('dub')?.replace(/^-/, '') || null)
  const [selectedQuality, setSelectedQuality] = useState<string | null>(null)
  const [availableDubs, setAvailableDubs] = useState<MovieDub[]>([])
  const [trailerOpen, setTrailerOpen] = useState(false)
  const playerContainerRef = useRef<HTMLDivElement | null>(null)
  const requestIdRef = useRef(0)
  const dubFetchIdRef = useRef(0)
  const triedDirectProvidersRef = useRef<Set<string>>(new Set())

  const streamKey = `${type}:${id}:${season}:${episode}`
  const [videoDuration, setVideoDuration] = useState(0)
  useEffect(() => {
    setVideoDuration(0)
  }, [streamKey])

  // Anime Movie Detection & Playback state (when a TMDB movie matches an AniList Anime Movie)
  const [forceRegularMovieMode, setForceRegularMovieMode] = useState(false)
  useEffect(() => {
    setForceRegularMovieMode(false)
  }, [streamKey])

  const potentialAnimeMovie =
    type === 'movie' &&
    !forceRegularMovieMode &&
    Boolean(
      details.data &&
        isPotentialAnimeTmdbMovie({
          type: 'movie',
          genres: details.data.genres,
          genreIds: details.data.genreIds,
          language: details.data.language,
        }),
    )

  const [animeMatchState, setAnimeMatchState] = useState<{
    key: string
    loading: boolean
    data: AnimeMovieMatch | null
  }>({ key: '', loading: false, data: null })

  useEffect(() => {
    if (!details.data) return
    if (!potentialAnimeMovie) {
      setAnimeMatchState({ key: streamKey, loading: false, data: { isAnimeMovie: false } })
      return
    }
    let alive = true
    setAnimeMatchState({ key: streamKey, loading: true, data: null })
    void fetchTmdbAnimeMatch(id, {
      title: details.data.title,
      year: details.data.year,
      genres: details.data.genres,
      genreIds: details.data.genreIds,
      language: details.data.language,
    })
      .then((res) => {
        if (alive) setAnimeMatchState({ key: streamKey, loading: false, data: res })
      })
      .catch(() => {
        if (alive) setAnimeMatchState({ key: streamKey, loading: false, data: { isAnimeMovie: false } })
      })
    return () => {
      alive = false
    }
  }, [streamKey, id, details.data, potentialAnimeMovie])

  const animeMatchSettled = Boolean(
    details.data &&
      (!potentialAnimeMovie || (animeMatchState.key === streamKey && !animeMatchState.loading)),
  )
  const animeMatch = animeMatchState.key === streamKey ? animeMatchState.data : null
  const isAnimeMovieMode = Boolean(
    type === 'movie' && !forceRegularMovieMode && animeMatch?.isAnimeMovie && animeMatch.anilistId && animeMatch.anime,
  )
  const aniMeta = isAnimeMovieMode ? animeMatch!.anime! : null
  const aniId = isAnimeMovieMode ? animeMatch!.anilistId! : 0
  const aniTitle = aniMeta ? pickTitle(aniMeta.title) : ''

  const shieldOk = useShieldVerified()
  const [everOk, setEverOk] = useState(shieldOk)
  useEffect(() => {
    if (shieldOk) setEverOk(true)
  }, [shieldOk])
  const sessionVerified = shieldOk || everOk
  const shieldFailed = useShield().failed
  useEffect(() => {
    if (shieldOk) return
    void getToken()
    const t = window.setInterval(() => void getToken(), 6000)
    return () => window.clearInterval(t)
  }, [shieldOk])

  const aniAudioParam = params.get('audio')?.toLowerCase()
  const aniAudio: 'sub' | 'dub' =
    aniAudioParam === 'sub' ? 'sub' : aniAudioParam === 'dub' ? 'dub' : (getPrefs().audio ?? 'dub')
  const aniPreferredServer = params.get('server')?.toLowerCase() || null
  const [aniLoadKind, setAniLoadKind] = useState<'episode' | 'server'>('episode')
  const [aniAud, setAniAud] = useState<{ tracks: { i: number; label: string; lang: string }[]; active: number }>({
    tracks: [],
    active: 0,
  })
  const [aniFailed, setAniFailed] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] })
  const aniKey = `${id}:${aniId}`
  const aniFailedIds = aniFailed.key === aniKey ? aniFailed.ids : []
  const aniFailedSig = aniFailedIds.join(',')
  const [aniExtraSkip, setAniExtraSkip] = useState<{ key: string; intro: SkipTimes['intro']; outro: SkipTimes['outro'] }>({
    key: '',
    intro: null,
    outro: null,
  })
  useEffect(() => {
    setAniExtraSkip({ key: `${aniId}:${aniAudio}`, intro: null, outro: null })
  }, [aniId, aniAudio])

  const aniOrigAudio = useMemo(() => getOriginalAudioMeta(aniMeta?.countryOfOrigin), [aniMeta?.countryOfOrigin])

  const aniAvail = useAsync(async () => {
    if (!isAnimeMovieMode || !aniId || !aniTitle) return null
    try {
      const servers = await fetchEpisodeServers(
        aniId,
        1,
        aniTitle,
        aniMeta?.format || 'MOVIE',
        aniMeta?.countryOfOrigin,
        aniMeta?.title?.romaji,
        1,
        1,
      )
      let nonAcdnSub = false
      let nonAcdnDub = false
      let acdnSub = false
      let acdnDub = false
      let hasMulti = false
      for (const [k, v] of Object.entries(servers)) {
        if (k === 'acdn') {
          if (v?.sub || v?.multi) acdnSub = true
          if (v?.dub || v?.multi) acdnDub = true
          if (v?.multi || (Array.isArray(v?.languages) && v.languages.length >= 2)) hasMulti = true
        } else if (k === 'watchanimeworld' || k === 'server12' || k.startsWith('animesalt')) {
          if (v?.sub || v?.multi) nonAcdnSub = true
          if (v?.dub || v?.multi) nonAcdnDub = true
          if (v?.multi || (Array.isArray(v?.languages) && v.languages.length >= 2)) hasMulti = true
        } else {
          if (v?.sub || v?.multi) nonAcdnSub = true
          if (v?.dub || v?.multi) nonAcdnDub = true
          if (v?.multi && k !== 'flixcloud') hasMulti = true
        }
      }
      return {
        sub: nonAcdnSub || acdnSub,
        dub: nonAcdnDub || acdnDub,
        nonAcdnSub,
        nonAcdnDub,
        acdnSub,
        acdnDub,
        hasMulti,
      }
    } catch {
      return { sub: true, dub: false, nonAcdnSub: true, nonAcdnDub: false, acdnSub: false, acdnDub: false, hasMulti: false }
    }
  }, [isAnimeMovieMode, aniId, aniTitle, aniMeta?.format, aniMeta?.countryOfOrigin, aniMeta?.title?.romaji])

  const [aniPlayback, setAniPlayback] = useState<{
    key: string
    loading: boolean
    data: ResolvedAnimePlayback | null
    error: Error | null
  }>({ key: '', loading: false, data: null, error: null })
  const [aniReloadTick, setAniReloadTick] = useState(0)

  useEffect(() => {
    if (!isAnimeMovieMode || !aniId || !aniTitle || !sessionVerified) return
    const reqKey = `${aniId}:${aniAudio}:${aniPreferredServer ?? ''}`
    let alive = true
    setAniPlayback((prev) => ({ key: reqKey, loading: true, data: prev.key === reqKey ? prev.data : null, error: null }))
    void resolveAnimeWithFallback(
      {
        id: aniId,
        ep: 1,
        title: aniTitle,
        romaji: aniMeta?.title?.romaji,
        format: aniMeta?.format || 'MOVIE',
        country: aniMeta?.countryOfOrigin,
        audio: aniAudio,
        preferredServer: aniPreferredServer,
      },
      aniFailedIds,
      (skip) => {
        if (!alive) return
        setAniExtraSkip((prev) => {
          if (prev.key !== reqKey && prev.key !== '') return prev
          return { key: reqKey, intro: prev.intro ?? skip.intro, outro: prev.outro ?? skip.outro }
        })
      },
    )
      .then((res) => {
        if (alive) setAniPlayback({ key: reqKey, loading: false, data: res, error: null })
      })
      .catch((err) => {
        if (alive) setAniPlayback({ key: reqKey, loading: false, data: null, error: err instanceof Error ? err : new Error('Unavailable') })
      })
    return () => {
      alive = false
    }
  }, [
    isAnimeMovieMode,
    aniId,
    aniTitle,
    aniMeta?.title?.romaji,
    aniMeta?.format,
    aniMeta?.countryOfOrigin,
    aniAudio,
    aniPreferredServer,
    sessionVerified,
    aniFailedSig,
    aniReloadTick,
  ])

  const [aniResolvedServerId, setAniResolvedServerId] = useState(aniPreferredServer || (aniAudio === 'dub' ? 'acdn' : 'megaplay'))
  useEffect(() => {
    if (aniPlayback.data?.serverId) setAniResolvedServerId(aniPlayback.data.serverId)
    else if (!aniPlayback.loading) setAniResolvedServerId(aniPreferredServer || (aniAudio === 'dub' ? 'acdn' : 'megaplay'))
  }, [aniPlayback.data?.serverId, aniPlayback.loading, aniAudio, aniPreferredServer])

  const [aniHeld, setAniHeld] = useState<{ aid: number; d: StreamResult; audio: 'sub' | 'dub'; sid: string } | null>(null)
  useEffect(() => {
    setAniHeld(null)
    setAniAud({ tracks: [], active: 0 })
  }, [id, aniId, aniAudio])
  useEffect(() => {
    if (aniPlayback.data?.kind === 'direct') {
      const resolvedAud: 'sub' | 'dub' =
        aniPlayback.data.stream.audio === 'multi'
          ? aniAudio
          : aniPlayback.data.stream.audio === 'dub'
            ? 'dub'
            : 'sub'
      setAniHeld({ aid: aniId, d: aniPlayback.data.stream, audio: resolvedAud, sid: aniPlayback.data.serverId })
    } else if (aniPlayback.data?.kind === 'embed') {
      setAniHeld(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aniPlayback.data])

  const aniCurAudioFromPlayback: 'sub' | 'dub' =
    aniPlayback.data?.kind === 'direct'
      ? aniPlayback.data.stream.audio === 'multi'
        ? aniAudio
        : aniPlayback.data.stream.audio === 'dub'
          ? 'dub'
          : 'sub'
      : aniAudio
  const aniCur =
    aniPlayback.data?.kind === 'direct'
      ? { d: aniPlayback.data.stream, audio: aniCurAudioFromPlayback }
      : aniPlayback.loading && aniHeld && aniHeld.aid === aniId && !aniPlayback.error
        ? { d: aniHeld.d, audio: aniHeld.audio }
        : null
  const aniStreamAudio =
    aniPlayback.data?.kind === 'direct'
      ? aniPlayback.data.stream.audio
      : aniPlayback.loading && aniHeld && aniHeld.aid === aniId
        ? aniHeld.d.audio
        : null
  const aniStreamSid =
    aniPlayback.data?.serverId ?? (aniPlayback.loading && aniHeld && aniHeld.aid === aniId ? aniHeld.sid : null)
  const aniRequestedFailed = Boolean(aniPlayback.data?.kind === 'direct' && aniPlayback.data.requestedFailed)

  const aniOrigTrackPattern =
    aniOrigAudio.language === 'Chinese'
      ? /\b(zh|chi|zho|cmn|yue)\b|chinese|mandarin|cantonese|putonghua|native|orig|\bsub\b/i
      : aniOrigAudio.language === 'Korean'
        ? /\b(ko|kor)\b|korean|native|orig|\bsub\b/i
        : /\b(ja|jpn|jp)\b|japanese|jap|native|orig|\bsub\b|nihongo/i

  const aniTrackHasSub = aniAud.tracks.some((t) => aniOrigTrackPattern.test(`${t.label} ${t.lang}`))
  const aniTrackHasDub = aniAud.tracks.some((t) => {
    const s = `${t.label} ${t.lang}`
    if (aniOrigTrackPattern.test(s)) return false
    return (
      /\b(en|eng|hi|hin|ta|tam|te|tel|ml|mal|kn|kan|bn|ben|ja|jpn|jp)\b|english|hindi|tamil|telugu|malayalam|kannada|bengali|japanese|dub/i.test(
        s,
      ) || aniAud.tracks.length > 1
    )
  })
  const aniAvailReady = !aniAvail.loading && aniAvail.data != null
  const aniAcdnSingleDub =
    aniStreamSid === 'acdn' &&
    !aniPlayback.loading &&
    aniAudio === 'dub' &&
    (aniAud.tracks.length === 0 || (aniAud.tracks.length === 1 && !aniTrackHasSub))
  const aniAcdnSingleSub =
    aniStreamSid === 'acdn' &&
    !aniPlayback.loading &&
    aniAudio === 'sub' &&
    (aniAud.tracks.length === 0 || (aniAud.tracks.length === 1 && !aniTrackHasDub))
  const aniAcdnLoadingTracks = aniStreamSid === 'acdn' && aniAud.tracks.length === 0
  const aniHasDub =
    !(aniAudio === 'dub' && aniRequestedFailed) &&
    (aniStreamAudio === 'dub' ||
      aniStreamAudio === 'multi' ||
      aniTrackHasDub ||
      aniAcdnSingleDub ||
      (aniAcdnLoadingTracks && Boolean(aniAvail.data?.acdnDub)) ||
      (aniAvailReady && Boolean(aniAvail.data?.nonAcdnDub)) ||
      (aniPlayback.loading && aniAudio === 'dub'))
  const aniHasSub =
    !(aniAudio === 'sub' && aniRequestedFailed) &&
    (aniStreamAudio === 'sub' ||
      aniStreamAudio === 'multi' ||
      aniTrackHasSub ||
      aniAcdnSingleSub ||
      (aniAcdnLoadingTracks && Boolean(aniAvail.data?.acdnSub)) ||
      (aniAvailReady && Boolean(aniAvail.data?.nonAcdnSub)) ||
      !aniHasDub)
  const aniActiveAudio: 'sub' | 'dub' =
    aniHasSub && !aniHasDub ? 'sub' : aniHasDub && !aniHasSub ? 'dub' : (aniCur?.audio ?? aniAudio)

  const skipSources = useAsync(
    () =>
      Number.isFinite(id) && id > 0
        ? fetchSkipTimesSources({
            anilistId: isAnimeMovieMode ? aniId : undefined,
            malId: isAnimeMovieMode ? (animeMatch?.malId ?? aniMeta?.idMal ?? null) : undefined,
            ep: 1,
            tmdbId: id,
            imdbId: details.data?.imdbId ?? null,
            type,
            format: type === 'movie' ? 'MOVIE' : 'TV',
            title: isAnimeMovieMode && aniTitle ? aniTitle : (details.data?.title ?? null),
            englishTitle: aniMeta?.title?.english ?? null,
            romajiTitle: aniMeta?.title?.romaji ?? null,
            nativeTitle: aniMeta?.title?.native ?? null,
            year: details.data?.year ?? null,
            season: type === 'tv' ? season : undefined,
            episode: type === 'tv' ? episode : undefined,
          })
        : Promise.resolve(null),
    [id, type, season, episode, details.data?.imdbId, details.data?.title, details.data?.year, isAnimeMovieMode, aniId, aniTitle, animeMatch?.malId, aniMeta?.idMal, aniMeta?.title?.english, aniMeta?.title?.romaji, aniMeta?.title?.native],
  )
  const [resolvedSkipSources, setResolvedSkipSources] = useState<{ key: string; data: SkipTimeSources | null }>({
    key: '',
    data: null,
  })
  useEffect(() => {
    if (skipSources.data) {
      setResolvedSkipSources({ key: streamKey, data: skipSources.data })
    } else {
      setResolvedSkipSources((prev) => (prev.key === streamKey ? prev : { key: streamKey, data: null }))
    }
  }, [skipSources.data, streamKey])
  const curSkipSources = resolvedSkipSources.key === streamKey ? resolvedSkipSources.data : (skipSources.data ?? null)

  useEffect(() => {
    setSelectedDub(params.get('dub')?.replace(/^-/, '') || null)
  }, [params])

  const requestedDubInfo = useMemo(
    () => resolveRequestedDubInfo(selectedDub, [...availableDubs, ...(activeSource?.dubs || [])]),
    [selectedDub, availableDubs, activeSource?.dubs],
  )
  const requestedDubInfoRef = useRef(requestedDubInfo)
  requestedDubInfoRef.current = requestedDubInfo

  const mergeDiscoveredDubs = useCallback((incoming: MovieDub[] | undefined | null) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return
    setAvailableDubs((prev) => {
      const seen = new Set(prev.map((d) => d.id.replace(/^-/, '')))
      const out = [...prev]
      for (const d of incoming) {
        const clean = d.id.replace(/^-/, '')
        if (!seen.has(clean)) {
          seen.add(clean)
          out.push(d)
        }
      }
      return out
    })
  }, [])

  // Seamless failover: stay strictly on the requested non-Original dub language across direct servers
  const handleFailover = useCallback(() => {
    if (activeSource?.providerId) {
      triedDirectProvidersRef.current.add(activeSource.providerId)
    }

    const dubReq = requestedDubInfoRef.current
    const langQuery = dubReq.isNonOriginal ? dubReq.langQuery : null

    // 1. Immediate direct-to-direct server switch ONLY if it matches the requested audio language
    const compatibleBackups = langQuery
      ? directBackups.filter((b) => backupMatchesRequestedDub(b, langQuery))
      : directBackups

    if (compatibleBackups.length > 0) {
      const [nextDirect, ...remainingDirect] = compatibleBackups
      triedDirectProvidersRef.current.add(nextDirect.providerId)
      setActiveSource(nextDirect)
      setDirectBackups(remainingDirect)
      setMbAttemptIdx(0)
      setSelectedQuality(null)
      setStreamError(null)
      toast(`Switched to ${maskMovieServerLabel(nextDirect.providerId, nextDirect.label)}`)
      return
    }
    if (directBackups.length > 0) {
      setDirectBackups([])
    }

    const tried = triedDirectProvidersRef.current
    const failMsg = dubReq.isNonOriginal
      ? `${dubReq.label} audio is currently unavailable on streaming servers.`
      : 'Playback is currently unavailable for this title.'

    // If the user explicitly asked for a non-Original dub and MovieBox was selected by language or ID hasn't been tried, try MovieBox with langQuery
    if (langQuery && !tried.has('moviebox') && details.data?.title) {
      const reqId = ++requestIdRef.current
      tried.add('moviebox')
      setLoadingStream(true)
      fetchMovieBoxStream({
        id,
        type,
        season,
        episode,
        title: details.data.title,
        year: details.data.year || undefined,
        dubId: langQuery,
        imdbId: details.data.imdbId,
      })
        .then((mb) => {
          if (reqId !== requestIdRef.current) return
          if (mb?.success && mb.streams?.length) {
            setActiveSource({
              kind: 'direct',
              providerId: 'moviebox',
              label: 'Server 2',
              streams: mb.streams,
              dubs: mb.dubs,
              subtitles: mb.subtitles,
              streamUrl: mb.streamUrl,
              altProxyUrl: mb.altProxyUrl,
              tags: ['Direct', 'Multi audio'],
            })
            mergeDiscoveredDubs(mb.dubs)
            setMbAttemptIdx(0)
            setSelectedQuality(null)
            setStreamError(null)
            toast(`Switched to Server 2 (${dubReq.label})`)
            return
          }
          handleFailover()
        })
        .catch(() => {
          if (reqId !== requestIdRef.current) return
          handleFailover()
        })
        .finally(() => {
          if (reqId === requestIdRef.current) setLoadingStream(false)
        })
      return
    }

    // 2. Try Vidzee Direct (strictly passing language name, NEVER a raw numeric MovieBox subject ID)
    if (!tried.has('vidzee') && (!dubReq.isNonOriginal || langQuery)) {
      const reqId = ++requestIdRef.current
      tried.add('vidzee')
      setLoadingStream(true)
      fetchVidzeeStream({
        id,
        type,
        season,
        episode,
        lang: langQuery,
      })
        .then(async (res) => {
          if (reqId !== requestIdRef.current) return
          if (res?.success && res.streams?.length) {
            setActiveSource({
              kind: 'direct',
              providerId: 'vidzee',
              label: 'Server 3',
              streams: res.streams,
              dubs: res.dubs,
              subtitles: res.subtitles,
              streamUrl: res.streamUrl,
              altProxyUrl: res.altProxyUrl,
              tags: ['Direct'],
            })
            mergeDiscoveredDubs(res.dubs)
            setMbAttemptIdx(0)
            setSelectedQuality(null)
            setStreamError(null)
            toast('Switched to Server 3')
            return
          }
          const emb = await resolveMovieEmbedStream({
            id,
            type,
            season,
            episode,
            lang: langQuery,
            exclude: Array.from(triedDirectProvidersRef.current),
          }).catch(() => null)
          if (reqId !== requestIdRef.current) return
          if (emb?.success && emb.source?.streams?.length && (!langQuery || backupMatchesRequestedDub(emb.source, langQuery))) {
            triedDirectProvidersRef.current.add(emb.source.providerId)
            setActiveSource(emb.source)
            setDirectBackups(langQuery ? (emb.backups || []).filter((b) => backupMatchesRequestedDub(b, langQuery)) : emb.backups || [])
            setMbAttemptIdx(0)
            setSelectedQuality(null)
            setStreamError(null)
            toast(`Switched to ${maskMovieServerLabel(emb.source.providerId, emb.source.label)}`)
            return
          }
          setStreamError(failMsg)
        })
        .catch(async () => {
          if (reqId !== requestIdRef.current) return
          try {
            const emb = await resolveMovieEmbedStream({
              id,
              type,
              season,
              episode,
              lang: langQuery,
              exclude: Array.from(triedDirectProvidersRef.current),
            })
            if (reqId !== requestIdRef.current) return
            if (emb?.success && emb.source?.streams?.length && (!langQuery || backupMatchesRequestedDub(emb.source, langQuery))) {
              triedDirectProvidersRef.current.add(emb.source.providerId)
              setActiveSource(emb.source)
              setDirectBackups(langQuery ? (emb.backups || []).filter((b) => backupMatchesRequestedDub(b, langQuery)) : emb.backups || [])
              setMbAttemptIdx(0)
              setSelectedQuality(null)
              setStreamError(null)
              toast(`Switched to ${maskMovieServerLabel(emb.source.providerId, emb.source.label)}`)
              return
            }
          } catch {}
          if (reqId === requestIdRef.current) setStreamError(failMsg)
        })
        .finally(() => {
          if (reqId === requestIdRef.current) setLoadingStream(false)
        })
      return
    }

    // 3. Try on-demand Embed-to-Direct Resolver if not yet exhausted
    if (!tried.has('__embed_resolver_exhausted__') && (!dubReq.isNonOriginal || langQuery)) {
      const reqId = ++requestIdRef.current
      tried.add('__embed_resolver_exhausted__')
      setLoadingStream(true)
      resolveMovieEmbedStream({
        id,
        type,
        season,
        episode,
        lang: langQuery,
        exclude: Array.from(triedDirectProvidersRef.current),
      })
        .then((emb) => {
          if (reqId !== requestIdRef.current) return
          if (emb?.success && emb.source?.streams?.length && (!langQuery || backupMatchesRequestedDub(emb.source, langQuery))) {
            triedDirectProvidersRef.current.add(emb.source.providerId)
            setActiveSource(emb.source)
            setDirectBackups(langQuery ? (emb.backups || []).filter((b) => backupMatchesRequestedDub(b, langQuery)) : emb.backups || [])
            setMbAttemptIdx(0)
            setSelectedQuality(null)
            setStreamError(null)
            toast(`Switched to ${maskMovieServerLabel(emb.source.providerId, emb.source.label)}`)
            return
          }
          setStreamError(failMsg)
        })
        .catch(() => {
          if (reqId !== requestIdRef.current) return
          setStreamError(failMsg)
        })
        .finally(() => {
          if (reqId === requestIdRef.current) setLoadingStream(false)
        })
      return
    }

    if (!langQuery && embedBackups.length > 0) {
      const [nextEmbed, ...restEmbeds] = embedBackups
      setActiveSource(nextEmbed)
      setEmbedBackups(restEmbeds)
      setMbAttemptIdx(0)
      setSelectedQuality(null)
      setStreamError(null)
      toast(`Switched to ${maskMovieServerLabel(nextEmbed.providerId, nextEmbed.label)}`)
      return
    }

    setStreamError(failMsg)
  }, [activeSource?.providerId, directBackups, embedBackups, id, type, season, episode, details.data?.title, details.data?.year, details.data?.imdbId, mergeDiscoveredDubs])

  const discoverDubs = useCallback(async () => {
    if (!details.data?.title) return
    const fetchId = ++dubFetchIdRef.current
    try {
      const mb = await fetchMovieBoxStream({
        id,
        type,
        season,
        episode,
        title: details.data.title,
        year: details.data.year || undefined,
        imdbId: details.data.imdbId,
      })
      if (fetchId !== dubFetchIdRef.current) return
      if (mb?.success && Array.isArray(mb.dubs) && mb.dubs.length > 0) {
        mergeDiscoveredDubs(mb.dubs)
      }
      if (mb?.success && Array.isArray(mb.streams) && mb.streams.length > 0) {
        const mbSource: WorkingMovieSource = {
          kind: 'direct',
          providerId: 'moviebox',
          label: 'Server 2',
          streams: mb.streams,
          dubs: mb.dubs,
          subtitles: mb.subtitles,
          streamUrl: mb.streamUrl,
          altProxyUrl: mb.altProxyUrl,
          tags: ['Direct', 'Multi audio'],
        }
        setDirectBackups((prev) =>
          prev.some((b) => b.providerId === 'moviebox' && b.streams?.length)
            ? prev
            : [...prev, mbSource],
        )
      }
    } catch {
      // Multi-audio discovery is non-blocking; CinePlayer playback remains unaffected.
    }
  }, [id, type, season, episode, details.data?.title, details.data?.year, details.data?.imdbId, mergeDiscoveredDubs])

  // Background server detection: CinemaOS embed is Priority #1 by default, keeping direct HD servers & backup embeds ready
  const runDetection = useCallback(async () => {
    const reqId = ++requestIdRef.current
    triedDirectProvidersRef.current = new Set()
    setLoadingStream(true)
    setStreamError(null)
    setActiveSource(null)
    setDirectBackups([])
    setEmbedBackups([])
    setMbAttemptIdx(0)
    setSelectedQuality(null)

    try {
      const res = await detectMovieStream({
        type,
        id,
        season,
        episode,
        title: details.data?.title,
        year: details.data?.year || undefined,
        imdbId: details.data?.imdbId || undefined,
      })
      if (reqId !== requestIdRef.current) return

      if (res.success && res.source) {
        triedDirectProvidersRef.current.add(res.source.providerId)
        setActiveSource({
          ...res.source,
          label: maskMovieServerLabel(res.source.providerId, res.source.label),
        })
        const backups = res.directBackups ?? []
        setDirectBackups(
          backups.map((b) => ({
            ...b,
            label: maskMovieServerLabel(b.providerId, b.label),
          })),
        )
        setEmbedBackups((res.backups ?? []).map((b) => ({
          kind: 'embed' as const,
          providerId: b.providerId,
          label: maskMovieServerLabel(b.providerId, b.label),
          url: b.url,
          tags: b.tags,
        })))
        const mergedDubs: MovieDub[] = [
          ...(res.source.dubs ?? []),
          ...backups.flatMap((b) => b.dubs ?? []),
        ]
        if (mergedDubs.length > 0) {
          mergeDiscoveredDubs(mergedDubs)
        }
        const hasMovieBoxDubs =
          res.source.providerId === 'moviebox' || backups.some((b) => b.providerId === 'moviebox')
        if (!hasMovieBoxDubs) {
          void discoverDubs()
        }
      } else {
        setEmbedBackups((res.backups ?? []).map((b) => ({
          kind: 'embed' as const,
          providerId: b.providerId,
          label: maskMovieServerLabel(b.providerId, b.label),
          url: b.url,
          tags: b.tags,
        })))
        setStreamError(res.error || 'Playback is currently unavailable for this title.')
      }
    } catch (err: any) {
      if (reqId !== requestIdRef.current) return
      setStreamError(err?.message || 'Failed to connect to streaming servers.')
    } finally {
      if (reqId === requestIdRef.current) setLoadingStream(false)
    }
  }, [type, id, season, episode, details.data?.title, details.data?.year, details.data?.imdbId, mergeDiscoveredDubs, discoverDubs])

  const loadSpecificDub = useCallback(
    async (dubId: string) => {
      const cleanId = dubId.replace(/^-/, '')
      const reqId = ++requestIdRef.current
      triedDirectProvidersRef.current = new Set()
      setLoadingStream(true)
      setStreamError(null)
      setDirectBackups([])
      setMbAttemptIdx(0)
      setSelectedQuality(null)

      const dubMeta = resolveRequestedDubInfo(cleanId, [...availableDubs, ...(activeSource?.dubs || [])])

      try {
        if (cleanId.startsWith('embed:')) {
          const langArg = cleanId.slice('embed:'.length)
          triedDirectProvidersRef.current.add('embed')
          const emb = await resolveMovieEmbedStream({
            id,
            type,
            season,
            episode,
            lang: langArg,
          }).catch(() => null)
          if (reqId !== requestIdRef.current) return
          if (emb?.success && emb.source?.streams?.length) {
            triedDirectProvidersRef.current.add(emb.source.providerId)
            setActiveSource(emb.source)
            setDirectBackups(emb.backups || [])
            setLoadingStream(false)
            return
          }
          // Cross-server fallback for the same language
          const vz = await fetchVidzeeStream({ id, type, season, episode, lang: langArg }).catch(() => null)
          if (reqId !== requestIdRef.current) return
          if (vz?.success && vz.streams?.length) {
            triedDirectProvidersRef.current.add('vidzee')
            setActiveSource({
              kind: 'direct',
              providerId: 'vidzee',
              label: 'Server 3',
              streams: vz.streams,
              dubs: vz.dubs,
              subtitles: vz.subtitles,
              streamUrl: vz.streamUrl,
              altProxyUrl: vz.altProxyUrl,
              tags: ['Direct'],
            })
            mergeDiscoveredDubs(vz.dubs)
            setLoadingStream(false)
            return
          }
        } else if (cleanId.startsWith('vidzee:')) {
          const langArg = cleanId.slice('vidzee:'.length)
          triedDirectProvidersRef.current.add('vidzee')
          const vz = await fetchVidzeeStream({
            id,
            type,
            season,
            episode,
            lang: langArg,
          }).catch(() => null)
          if (reqId !== requestIdRef.current) return
          if (vz?.success && vz.streams?.length) {
            setActiveSource({
              kind: 'direct',
              providerId: 'vidzee',
              label: 'Server 3',
              streams: vz.streams,
              dubs: vz.dubs,
              subtitles: vz.subtitles,
              streamUrl: vz.streamUrl,
              altProxyUrl: vz.altProxyUrl,
              tags: ['Direct'],
            })
            mergeDiscoveredDubs(vz.dubs)
            setLoadingStream(false)
            void discoverDubs()
            return
          }
          // Try MovieBox with that language name before giving up
          if (details.data?.title && langArg && !/^(original|auto)$/i.test(langArg)) {
            const mb = await fetchMovieBoxStream({
              id,
              type,
              season,
              episode,
              title: details.data.title,
              year: details.data.year || undefined,
              dubId: langArg,
              imdbId: details.data.imdbId,
            }).catch(() => null)
            if (reqId !== requestIdRef.current) return
            if (mb?.success && mb.streams?.length) {
              triedDirectProvidersRef.current.add('moviebox')
              setActiveSource({
                kind: 'direct',
                providerId: 'moviebox',
                label: 'Server 2',
                streams: mb.streams,
                dubs: mb.dubs,
                subtitles: mb.subtitles,
                streamUrl: mb.streamUrl,
                altProxyUrl: mb.altProxyUrl,
                tags: ['Direct', 'Multi audio'],
              })
              mergeDiscoveredDubs(mb.dubs)
              setLoadingStream(false)
              return
            }
          }
        } else {
          triedDirectProvidersRef.current.add('moviebox')
          const mb = await fetchMovieBoxStream({
            id,
            type,
            season,
            episode,
            title: details.data?.title,
            year: details.data?.year || undefined,
            dubId: cleanId,
            imdbId: details.data?.imdbId,
          }).catch(() => null)
          if (reqId !== requestIdRef.current) return
          if (mb?.success && mb.streams?.length) {
            setActiveSource({
              kind: 'direct',
              providerId: 'moviebox',
              label: 'Server 2',
              streams: mb.streams,
              dubs: mb.dubs,
              subtitles: mb.subtitles,
              streamUrl: mb.streamUrl,
              altProxyUrl: mb.altProxyUrl,
              tags: ['Direct', 'Multi audio'],
            })
            mergeDiscoveredDubs(mb.dubs)
            setLoadingStream(false)
            return
          }
          // If requested dub failed on MovieBox, try Vidzee with its resolved language label (never switch to Original!)
          const langAfterMb = resolveRequestedDubInfo(cleanId, mb?.dubs || availableDubs).langQuery || dubMeta.langQuery
          if (langAfterMb) {
            const vz = await fetchVidzeeStream({ id, type, season, episode, lang: langAfterMb }).catch(() => null)
            if (reqId !== requestIdRef.current) return
            if (vz?.success && vz.streams?.length) {
              triedDirectProvidersRef.current.add('vidzee')
              setActiveSource({
                kind: 'direct',
                providerId: 'vidzee',
                label: 'Server 3',
                streams: vz.streams,
                dubs: vz.dubs,
                subtitles: vz.subtitles,
                streamUrl: vz.streamUrl,
                altProxyUrl: vz.altProxyUrl,
                tags: ['Direct'],
              })
              if (mb?.dubs?.length) mergeDiscoveredDubs(mb.dubs)
              mergeDiscoveredDubs(vz.dubs)
              setLoadingStream(false)
              return
            }
          }
          const embLang = langAfterMb || dubMeta.langQuery
          if (embLang) {
            triedDirectProvidersRef.current.add('__embed_resolver_exhausted__')
            const emb = await resolveMovieEmbedStream({
              id,
              type,
              season,
              episode,
              lang: embLang,
              exclude: Array.from(triedDirectProvidersRef.current),
            }).catch(() => null)
            if (reqId !== requestIdRef.current) return
            if (emb?.success && emb.source?.streams?.length && backupMatchesRequestedDub(emb.source, embLang)) {
              triedDirectProvidersRef.current.add(emb.source.providerId)
              setActiveSource(emb.source)
              setDirectBackups((emb.backups || []).filter((b) => backupMatchesRequestedDub(b, embLang)))
              if (mb?.dubs?.length) mergeDiscoveredDubs(mb.dubs)
              mergeDiscoveredDubs(emb.source.dubs)
              setLoadingStream(false)
              return
            }
          }
        }
      } catch {
        // Handled cleanly below
      }
      if (reqId === requestIdRef.current) {
        if (dubMeta.isNonOriginal) {
          toast(`${dubMeta.label} audio unavailable; loading default audio.`, 'error')
        }
        await runDetection()
      }
    },
    [id, type, season, episode, details.data?.title, details.data?.year, details.data?.imdbId, runDetection, mergeDiscoveredDubs, discoverDubs],
  )

  const latestLoadRef = useRef<{
    dubParam: string | null
    loadSpecificDub: typeof loadSpecificDub
    runDetection: typeof runDetection
    discoverDubs: typeof discoverDubs
  }>({
    dubParam: params.get('dub')?.replace(/^-/, '') || null,
    loadSpecificDub,
    runDetection,
    discoverDubs,
  })
  latestLoadRef.current = {
    dubParam: params.get('dub')?.replace(/^-/, '') || null,
    loadSpecificDub,
    runDetection,
    discoverDubs,
  }

  useEffect(() => {
    setAvailableDubs([])
    if (!details.data?.title || !animeMatchSettled) return
    if (isAnimeMovieMode) {
      setLoadingStream(false)
      return
    }
    const { dubParam, loadSpecificDub: loadDub, runDetection: detectBest } = latestLoadRef.current
    if (dubParam) {
      void loadDub(dubParam)
    } else {
      void detectBest()
    }
  }, [streamKey, details.data?.title, animeMatchSettled, isAnimeMovieMode])

  // Record history when watching via the native embed player
  useEffect(() => {
    if (!activeSource || activeSource.kind !== 'embed' || !details.data) return
    const m = details.data
    const epItem = type === 'tv' ? eps.data?.find((e) => e.n === episode) : null
    touchMovieProgress({
      id,
      type,
      title: m.title,
      poster: m.poster ?? null,
      backdrop: m.backdrop ?? null,
      epTitle: type === 'tv' ? (epItem?.name || null) : null,
      epImage: type === 'tv' && epItem?.still ? img(epItem.still, 'w500') : null,
      season,
      episode: type === 'tv' ? episode : 1,
      totalEpisodesInSeason: m.seasons?.find((s) => s.n === season)?.episodes || eps.data?.length || 1,
      totalSeasons: m.seasons?.length || 1,
    })
  }, [activeSource, details.data, eps.data, id, type, season, episode])

  useEffect(() => {
    document.title = `${details.data?.title ?? 'Watch'} — AnimeStream`
  }, [details.data?.title])

  function go(next: Record<string, string | number | null>) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) v === null ? p.delete(k) : p.set(k, String(v))
    setParams(p, { replace: true })
  }

  // Direct stream options & attempts: keep SERVER 2 (MovieBox) and SERVER 3 (Vidzee) isolated to their own streams
  const availableStreams = useMemo(() => {
    const base = activeSource?.streams || []
    if (!base.length) return []
    if (activeSource?.providerId === 'moviebox' || activeSource?.providerId === 'vidzee') {
      return base
    }
    const isAdaptiveMulti = base.some((s: any) => Boolean(s?.hasMultiQuality) || (Array.isArray(s?.heights) && s.heights.length > 1))
    if (isAdaptiveMulti) return base

    const parseRes = (s: { resolutionNum?: number; quality?: string }) =>
      Number(s.resolutionNum || parseInt(String(s.quality || ''), 10) || 0) || 0

    const seenRes = new Set(base.map(parseRes).filter((n) => n > 0))
    const merged = [...base]

    const activeLangRaw = String(
      activeSource?.dubs?.find((d) => d.selected)?.label || base[0]?.language || '',
    ).toLowerCase()
    const activeIsHindi = /hindi/i.test(activeLangRaw)

    for (const bk of directBackups) {
      if (!bk?.streams?.length) continue
      const bkIsMulti = bk.streams.some((s: any) => Boolean(s?.hasMultiQuality) || (Array.isArray(s?.heights) && s.heights.length > 1))
      if (bkIsMulti) continue
      for (const s of bk.streams) {
        const sLang = String((s as any).language || bk.dubs?.find((d) => d.selected)?.label || '').toLowerCase()
        const sIsHindi = /hindi/i.test(sLang)
        if (activeIsHindi !== sIsHindi) continue
        const r = parseRes(s)
        if (r > 0 && !seenRes.has(r)) {
          seenRes.add(r)
          merged.push(s)
        }
      }
    }

    return merged.sort((a, b) => parseRes(b) - parseRes(a))
  }, [activeSource?.providerId, activeSource?.streams, activeSource?.dubs, directBackups])
  const streamAttempts = useMemo(
    () => buildMovieStreamAttempts(availableStreams, selectedQuality),
    [availableStreams, selectedQuality],
  )
  const currentAttempt = streamAttempts[mbAttemptIdx] || streamAttempts[0] || null
  const activeStream = useMemo(() => {
    if (!availableStreams.length) return null
    if (selectedQuality) {
      const found = availableStreams.find((s) => s.quality === selectedQuality)
      if (found) return found
    }
    return availableStreams[0]
  }, [availableStreams, selectedQuality])

  const activeStreamUrl = currentAttempt?.url || activeStream?.proxyStreamUrl || activeStream?.streamUrl || activeSource?.streamUrl || ''
  const fallbackStreamUrl =
    streamAttempts[mbAttemptIdx + 1]?.url ||
    (activeSource?.altProxyUrl && activeSource.altProxyUrl !== activeStreamUrl ? activeSource.altProxyUrl : '') ||
    ''
  const activeEmbedUrl = useMemo(() => {
    if (activeSource?.kind !== 'embed') return ''
    if (activeSource.proxyUrl) return activeSource.proxyUrl
    if (activeSource.url && isTrustedMovieEmbedUrl(activeSource.url)) return activeSource.url
    return ''
  }, [activeSource])

  const curEpRuntime = type === 'tv' ? eps.data?.find((e) => e.n === episode)?.runtime : null
  const expectedDurationSec =
    activeStream?.duration && activeStream.duration > 0
      ? activeStream.duration
      : (curEpRuntime || details.data?.runtime || 0) * 60
  const { intro: effectiveIntro, recap: effectiveRecap, outro: effectiveOutro } = useMemo(
    () =>
      resolveBestSkipPair({
        sources: curSkipSources,
        durationSec: videoDuration,
        expectedDurationSec,
      }),
    [curSkipSources, videoDuration, expectedDurationSec],
  )

  const dubs = useMemo(() => {
    const normalizeKey = (lbl: string) =>
      cleanDubLabel(lbl).toLowerCase().replace(/\s*dub\b/i, '').trim()
    const baseDubs = (activeSource?.dubs ?? []).map((d) => ({
      ...d,
      label: cleanDubLabel(d.label),
    }))
    const seenKeys = new Set(baseDubs.map((d) => normalizeKey(d.label)))
    for (const d of availableDubs) {
      const cleaned = cleanDubLabel(d.label)
      const key = normalizeKey(cleaned)
      const isOrigDup = key === 'original' && seenKeys.has('english')
      if (seenKeys.has(key) || isOrigDup) continue
      if (!baseDubs.some((x) => x.id === d.id)) {
        baseDubs.push({
          ...d,
          label: cleaned,
          selected: activeSource?.providerId === 'moviebox' ? d.selected : false,
        })
        seenKeys.add(key)
      }
    }
    return baseDubs
  }, [activeSource?.providerId, activeSource?.dubs, availableDubs])

  const movieServerSlots: WatchServerSlot[] = useMemo(
    () => MOVIE_WATCH_SERVER_SLOTS.map((s) => ({ ...s })),
    [],
  )

  const resolvedMovieSlotKey = activeSource ? resolveActiveMovieSlotKey(activeSource.providerId) : ''
  const activeMovieSlotKey = pendingMovieSlotKey || resolvedMovieSlotKey
  const activeMovieSlot =
    movieServerSlots.find((s) => s.key === activeMovieSlotKey) ?? movieServerSlots[0]

  const directServerList: PlayerServer[] = useMemo(() => {
    return movieServerSlots.map((slot) => ({
      id: slot.serverId,
      name: slot.label,
      note:
        slot.serverId === 'moviebox'
          ? 'Direct HD Stream'
          : slot.serverId === 'vidzee'
            ? 'Direct / Multi-Audio'
            : 'Embed Player',
    }))
  }, [movieServerSlots])

  const handleSelectMovieServer = useCallback(async (slot: WatchServerSlot) => {
    if (loadingStream && pendingMovieSlotKey === slot.key) return
    if (!loadingStream && activeSource && resolveActiveMovieSlotKey(activeSource.providerId) === slot.key) return

    const reqId = ++requestIdRef.current
    setPendingMovieSlotKey(slot.key)
    setStreamError(null)
    setMbAttemptIdx(0)
    setSelectedQuality(null)

    const archiveCurrentSource = () => {
      if (!activeSource) return
      if (activeSource.kind === 'direct') {
        setDirectBackups((prev) =>
          prev.some((b) => b.providerId === activeSource.providerId) ? prev : [activeSource, ...prev],
        )
      } else if (activeSource.kind === 'embed' && activeSource.url) {
        setEmbedBackups((prev) =>
          prev.some((b) => b.providerId === activeSource.providerId) ? prev : [activeSource, ...prev],
        )
      }
    }

    if (slot.serverId === 'cinemaos') {
      const cachedEmbed = embedBackups.find((b) => b.providerId === 'cinemaos' && b.url && isTrustedMovieEmbedUrl(b.url))
      const cinemaUrl = cachedEmbed?.url || buildCinemaOsEmbedUrl({ type, tmdbId: id, season, episode, lang: 'en' })
      archiveCurrentSource()
      setActiveSource(
        cachedEmbed || {
          kind: 'embed',
          providerId: 'cinemaos',
          label: 'Server 1',
          url: cinemaUrl,
          adBlocked: true,
          tags: ['Multi audio'],
        },
      )
      setLoadingStream(false)
      setPendingMovieSlotKey(null)
      toast('Switched to SERVER 1')
      return
    }

    if (slot.serverId === 'moviebox') {
      const cachedMb = directBackups.find((b) => b.providerId === 'moviebox' && b.streams?.length)
      if (cachedMb) {
        archiveCurrentSource()
        setDirectBackups((prev) => prev.filter((b) => b.providerId !== 'moviebox'))
        setActiveSource({ ...cachedMb, label: 'Server 2' })
        setLoadingStream(false)
        setPendingMovieSlotKey(null)
        toast('Switched to SERVER 2')
        return
      }

      setLoadingStream(true)
      try {
        const mb = await fetchMovieBoxStream({
          id,
          type,
          season,
          episode,
          title: details.data?.title,
          year: details.data?.year || undefined,
          imdbId: details.data?.imdbId,
        })
        if (reqId !== requestIdRef.current) return
        if (mb?.success && mb.streams?.length) {
          archiveCurrentSource()
          triedDirectProvidersRef.current.add('moviebox')
          setActiveSource({
            kind: 'direct',
            providerId: 'moviebox',
            label: 'Server 2',
            streams: mb.streams,
            dubs: mb.dubs,
            subtitles: mb.subtitles,
            streamUrl: mb.streamUrl,
            altProxyUrl: mb.altProxyUrl,
            tags: ['Direct', 'Multi audio'],
          })
          mergeDiscoveredDubs(mb.dubs)
          setStreamError(null)
          toast('Switched to SERVER 2')
          return
        }
        setStreamError('Server 2 is currently unavailable for this title. Please try SERVER 1 or SERVER 3.')
        toast('SERVER 2 is unavailable right now; try another server.', 'error')
      } catch {
        if (reqId === requestIdRef.current) {
          setStreamError('Server 2 is currently unavailable for this title. Please try SERVER 1 or SERVER 3.')
          toast('SERVER 2 is unavailable right now; try another server.', 'error')
        }
      } finally {
        if (reqId === requestIdRef.current) {
          setLoadingStream(false)
          setPendingMovieSlotKey(null)
        }
      }
      return
    }

    // SERVER 3: VidZee (promote cached direct stream -> fetch direct VidZee HLS -> embed fallback)
    const cachedDirectVidzee = directBackups.find(
      (b) => (b.providerId === 'vidzee' || b.providerId === 'vidzee-mirror' || b.providerId === 'embed-vidzee-mirror') && b.streams?.length,
    )
    if (cachedDirectVidzee) {
      archiveCurrentSource()
      setDirectBackups((prev) => prev.filter((b) => b.providerId !== cachedDirectVidzee.providerId))
      setActiveSource({ ...cachedDirectVidzee, providerId: 'vidzee', label: 'Server 3' })
      setLoadingStream(false)
      setPendingMovieSlotKey(null)
      toast('Switched to SERVER 3')
      return
    }

    setLoadingStream(true)
    const vidzeeEmbedUrl = buildVidzeeEmbedUrl({ type, tmdbId: id, season, episode })
    try {
      const vz = await fetchVidzeeStream({
        id,
        type,
        season,
        episode,
      }).catch(() => null)
      if (reqId !== requestIdRef.current) return
      if (vz?.success && vz.streams?.length) {
        archiveCurrentSource()
        triedDirectProvidersRef.current.add('vidzee')
        setActiveSource({
          kind: 'direct',
          providerId: 'vidzee',
          label: 'Server 3',
          streams: vz.streams,
          dubs: vz.dubs,
          subtitles: vz.subtitles,
          streamUrl: vz.streamUrl,
          altProxyUrl: vz.altProxyUrl,
          tags: ['Direct', 'Multi audio'],
        })
        mergeDiscoveredDubs(vz.dubs)
        setStreamError(null)
        toast('Switched to SERVER 3')
        return
      }

      const cachedEmbedVidzee = embedBackups.find(
        (b) => b.providerId === 'vidzee' && b.url && isTrustedMovieEmbedUrl(b.url),
      )
      const finalVidzeeUrl = cachedEmbedVidzee?.url || vidzeeEmbedUrl
      if (isTrustedMovieEmbedUrl(finalVidzeeUrl)) {
        archiveCurrentSource()
        setActiveSource({
          kind: 'embed',
          providerId: 'vidzee',
          label: 'Server 3',
          url: finalVidzeeUrl,
          tags: ['Multi audio'],
        })
        setStreamError(null)
        toast('Switched to SERVER 3')
        return
      }
      setStreamError('Server 3 is currently unavailable for this title.')
    } catch {
      if (reqId === requestIdRef.current) {
        if (isTrustedMovieEmbedUrl(vidzeeEmbedUrl)) {
          archiveCurrentSource()
          setActiveSource({
            kind: 'embed',
            providerId: 'vidzee',
            label: 'Server 3',
            url: vidzeeEmbedUrl,
            tags: ['Multi audio'],
          })
          setStreamError(null)
          toast('Switched to SERVER 3')
        } else {
          setStreamError('Server 3 is currently unavailable for this title.')
        }
      }
    } finally {
      if (reqId === requestIdRef.current) {
        setLoadingStream(false)
        setPendingMovieSlotKey(null)
      }
    }
  }, [activeSource, loadingStream, pendingMovieSlotKey, directBackups, embedBackups, id, type, season, episode, details.data?.title, details.data?.year, details.data?.imdbId, mergeDiscoveredDubs])

  const handleSwitchServer = useCallback((targetId: string) => {
    const matchingSlot = movieServerSlots.find((s) => s.serverId === targetId)
    if (matchingSlot) {
      void handleSelectMovieServer(matchingSlot)
      return
    }
    if (!activeSource || targetId === activeSource.providerId) return
    const target = directServerList.find((s) => s.id === targetId)
    const directIdx = directBackups.findIndex((b) => b.providerId === targetId)
    if (directIdx >= 0) {
      const next = directBackups[directIdx]
      const restDirect = [
        ...(activeSource.kind === 'direct' ? [activeSource] : []),
        ...directBackups.slice(0, directIdx),
        ...directBackups.slice(directIdx + 1),
      ]
      const restEmbeds =
        activeSource.kind === 'embed'
          ? [activeSource, ...embedBackups.filter((b) => b.providerId !== activeSource.providerId)]
          : embedBackups
      triedDirectProvidersRef.current.add(next.providerId)
      setActiveSource(next)
      setDirectBackups(restDirect)
      setEmbedBackups(restEmbeds)
      setMbAttemptIdx(0)
      setSelectedQuality(null)
      setStreamError(null)
      toast(`Switched to ${target?.name || maskMovieServerLabel(next.providerId, next.label)}`)
      return
    }

    const embedIdx = embedBackups.findIndex((b) => b.providerId === targetId)
    if (embedIdx >= 0) {
      const next = embedBackups[embedIdx]
      const restEmbeds = [
        ...(activeSource.kind === 'embed' ? [activeSource] : []),
        ...embedBackups.slice(0, embedIdx),
        ...embedBackups.slice(embedIdx + 1),
      ]
      const restDirect =
        activeSource.kind === 'direct'
          ? [activeSource, ...directBackups.filter((b) => b.providerId !== activeSource.providerId)]
          : directBackups
      setActiveSource(next)
      setDirectBackups(restDirect)
      setEmbedBackups(restEmbeds)
      setMbAttemptIdx(0)
      setSelectedQuality(null)
      setStreamError(null)
      toast(`Switched to ${target?.name || maskMovieServerLabel(next.providerId, next.label)}`)
    }
  }, [activeSource, directBackups, embedBackups, directServerList, movieServerSlots, handleSelectMovieServer])


  const activeDubObj =
    activeSource?.kind === 'direct'
      ? dubs.find((d) => (selectedDub && d.id.replace(/^-/, '') === selectedDub) || Boolean(d.selected)) || dubs[0]
      : undefined
  const showDubBar =
    !isAnimeMovieMode &&
    (dubs.length > 1 ||
      (dubs.length === 1 && !/^(original|english|en|default)$/i.test(cleanDubLabel(dubs[0].label))))

  async function pickDub(dubId: string) {
    const cleanId = dubId.replace(/^-/, '')
    const reqId = ++requestIdRef.current
    const reqInfo = resolveRequestedDubInfo(cleanId, [...dubs, ...availableDubs, ...(activeSource?.dubs || [])])

    triedDirectProvidersRef.current = new Set()
    setSelectedDub(cleanId)
    setMbAttemptIdx(0)
    setSelectedQuality(null)
    setStreamError(null)
    setDirectBackups([])
    go({ dub: cleanId })

    const applySource = (src: WorkingMovieSource, extraBackups: WorkingMovieSource[] = []) => {
      triedDirectProvidersRef.current.add(src.providerId)
      setActiveSource(src)
      setDirectBackups(extraBackups)
      setStreamError(null)
      mergeDiscoveredDubs(src.dubs)
    }

    try {
      setLoadingStream(true)
      if (cleanId.startsWith('embed:')) {
        const langArg = cleanId.slice('embed:'.length)
        triedDirectProvidersRef.current.add('embed')
        const res = await resolveMovieEmbedStream({
          id,
          type,
          season,
          episode,
          lang: langArg,
        }).catch(() => null)
        if (reqId !== requestIdRef.current) return
        if (res?.success && res.source?.streams?.length) {
          applySource(res.source, res.backups || [])
          const dubObj = res.source.dubs?.find((d) => d.id === cleanId)
          toast(`Switched audio to ${cleanDubLabel(dubObj?.label ?? langArg)}`)
          return
        }
      } else if (cleanId.startsWith('vidzee:')) {
        const langArg = cleanId.slice('vidzee:'.length) === 'auto' ? null : cleanId.slice('vidzee:'.length)
        triedDirectProvidersRef.current.add('vidzee')
        const res = await fetchVidzeeStream({
          id,
          type,
          season,
          episode,
          lang: langArg,
        }).catch(() => null)
        if (reqId !== requestIdRef.current) return
        if (res?.success && res.streams?.length) {
          applySource({
            kind: 'direct',
            providerId: 'vidzee',
            label: 'Server 3',
            streams: res.streams,
            dubs: res.dubs,
            subtitles: res.subtitles,
            streamUrl: res.streamUrl,
            altProxyUrl: res.altProxyUrl,
            tags: ['Direct'],
          })
          const dubObj = res.dubs.find((d) => d.id === cleanId)
          toast(`Switched audio to ${cleanDubLabel(dubObj?.label ?? (langArg || 'Original'))}`)
          return
        }
        // Cross-provider fallback for same non-Original language on MovieBox -> Embed
        if (langArg && details.data?.title) {
          triedDirectProvidersRef.current.add('moviebox')
          const mb = await fetchMovieBoxStream({
            id,
            type,
            season,
            episode,
            title: details.data.title,
            year: details.data.year || undefined,
            dubId: langArg,
            imdbId: details.data.imdbId,
          }).catch(() => null)
          if (reqId !== requestIdRef.current) return
          if (mb?.success && mb.streams?.length) {
            applySource({
              kind: 'direct',
              providerId: 'moviebox',
              label: 'Server 2',
              streams: mb.streams,
              dubs: mb.dubs,
              subtitles: mb.subtitles,
              streamUrl: mb.streamUrl,
              altProxyUrl: mb.altProxyUrl,
              tags: ['Direct', 'Multi audio'],
            })
            toast(`Switched audio to ${cleanDubLabel(langArg)} (Server 2)`)
            return
          }
        }
      } else {
        triedDirectProvidersRef.current.add('moviebox')
        const res = await fetchMovieBoxStream({
          id,
          type,
          season,
          episode,
          title: details.data?.title,
          year: details.data?.year || undefined,
          dubId: cleanId,
          imdbId: details.data?.imdbId,
        }).catch(() => null)
        if (reqId !== requestIdRef.current) return
        if (res?.success && res.streams?.length) {
          applySource({
            kind: 'direct',
            providerId: 'moviebox',
            label: 'Server 2',
            streams: res.streams,
            dubs: res.dubs,
            subtitles: res.subtitles,
            streamUrl: res.streamUrl,
            altProxyUrl: res.altProxyUrl,
            tags: ['Direct', 'Multi audio'],
          })
          const dubObj = res.dubs.find((d) => d.id.replace(/^-/, '') === cleanId || d.id === dubId)
          const cleanLabel = cleanDubLabel(dubObj?.label ?? reqInfo.label)
          toast(`Switched audio to ${cleanLabel}`)
          return
        }

        // Cross-provider fallback: try Vidzee and Embed for the SAME language label (never switch to Original!)
        if (reqInfo.langQuery) {
          triedDirectProvidersRef.current.add('vidzee')
          const vz = await fetchVidzeeStream({
            id,
            type,
            season,
            episode,
            lang: reqInfo.langQuery,
          }).catch(() => null)
          if (reqId !== requestIdRef.current) return
          if (vz?.success && vz.streams?.length) {
            applySource({
              kind: 'direct',
              providerId: 'vidzee',
              label: 'Server 3',
              streams: vz.streams,
              dubs: vz.dubs,
              subtitles: vz.subtitles,
              streamUrl: vz.streamUrl,
              altProxyUrl: vz.altProxyUrl,
              tags: ['Direct'],
            })
            toast(`Switched audio to ${reqInfo.label} (Server 3)`)
            return
          }

          triedDirectProvidersRef.current.add('__embed_resolver_exhausted__')
          const emb = await resolveMovieEmbedStream({
            id,
            type,
            season,
            episode,
            lang: reqInfo.langQuery,
            exclude: Array.from(triedDirectProvidersRef.current),
          }).catch(() => null)
          if (reqId !== requestIdRef.current) return
          if (emb?.success && emb.source?.streams?.length && backupMatchesRequestedDub(emb.source, reqInfo.langQuery)) {
            applySource(
              emb.source,
              (emb.backups || []).filter((b) => backupMatchesRequestedDub(b, reqInfo.langQuery)),
            )
            toast(`Switched audio to ${reqInfo.label} (Server 3)`)
            return
          }
        }
      }

      if (reqId === requestIdRef.current) {
        toast(`${reqInfo.label} audio is unavailable on streaming servers right now`, 'error')
      }
    } catch {
      if (reqId === requestIdRef.current) {
        toast(`Failed to switch to ${reqInfo.label} audio`, 'error')
      }
    } finally {
      if (reqId === requestIdRef.current) setLoadingStream(false)
    }
  }

  const seasons = details.data?.seasons ?? []
  const seasonInfo = seasons.find((s) => s.n === season)
  const lastEp = eps.data?.length || seasonInfo?.episodes || episode
  const nextTarget = useMemo(() => {
    if (episode < lastEp) return { s: season, e: episode + 1 }
    const nextSeason = seasons.find((s) => s.n > season)
    return nextSeason ? { s: nextSeason.n, e: 1 } : null
  }, [episode, lastEp, season, seasons])
  const epInfo = useMemo(
    () => new Map((eps.data ?? []).map((e) => [e.n, { n: e.n, name: e.name, overview: e.overview, image: e.still ? img(e.still, 'w500') : null, runtime: e.runtime, air: e.air }])),
    [eps.data],
  )
  const epTotal = Math.max(eps.data?.[eps.data.length - 1]?.n ?? 0, seasonInfo?.episodes ?? 0)
  const prevTarget = episode > 1 ? { s: season, e: episode - 1 } : null
  const epName = eps.data?.find((e) => e.n === episode)?.name

  if (!Number.isFinite(id) || id <= 0) return <ErrorState className="mt-40" message="That title doesn't exist." />

  const m = details.data
  const title = m?.title ?? 'Loading…'
  const isMovieWatched = useIsMovieWatched(type, id)
  const watchedMovieEps = useWatchedMovieEps(id, season)
  const listItem = useListItem(id)
  const inWatchlist = Boolean(listItem)

  const handleToggleWatchlist = () => {
    if (inWatchlist) {
      removeFromList(id)
      toast('Removed from watchlist')
    } else if (m) {
      addToList(
        {
          id,
          title: m.title,
          href: `/movies/${type}/${id}`,
          image: m.poster ? (img(m.poster, 'w500') || '') : '',
          score: m.rating ? Math.round(m.rating * 10) : null,
          format: type === 'tv' ? 'TV' : 'MOVIE',
          episodes: type === 'tv' ? epTotal : 1,
          year: m.year ? parseInt(m.year, 10) : null,
        },
        'planning',
      )
      toast('Added to watchlist!')
    }
  }

  const hrefFor = (n: number) => {
    const q = new URLSearchParams(params)
    q.set('s', String(season))
    q.set('e', String(n))
    return `/movies/watch/${type}/${id}?${q}`
  }

  const { intro: aniEffectiveIntro, recap: aniEffectiveRecap, outro: aniEffectiveOutro } = useMemo(() => {
    const rawIntro =
      (aniCur?.d.intro && aniCur.d.intro.end > 0 ? aniCur.d.intro : null) ??
      (aniExtraSkip.key.startsWith(`${aniId}:${aniAudio}`) ? aniExtraSkip.intro : null)
    const rawOutro =
      (aniCur?.d.outro && aniCur.d.outro.end > 0 ? aniCur.d.outro : null) ??
      (aniExtraSkip.key.startsWith(`${aniId}:${aniAudio}`) ? aniExtraSkip.outro : null)
    return resolveBestSkipPair({
      streamIntro: rawIntro,
      streamOutro: rawOutro,
      sources: curSkipSources,
      durationSec: videoDuration,
      expectedDurationSec,
    })
  }, [aniCur?.d.intro, aniCur?.d.outro, aniExtraSkip, aniId, aniAudio, curSkipSources, videoDuration, expectedDurationSec])

  const aniDubsProp = useMemo(() => {
    if (!isAnimeMovieMode || aniPlayback.loading || aniActiveAudio === 'sub') return undefined
    if (aniStreamSid === 'acdn' && aniAud.tracks.length > 1) return undefined
    const singleTrack =
      aniAud.tracks.length === 1 &&
      aniAud.tracks[0]?.label &&
      !/^(track|audio|stream|default|main)\s*#?\d*$/i.test(aniAud.tracks[0].label.trim())
        ? aniAud.tracks[0].label.trim()
        : ''
    const dubLabel =
      singleTrack ||
      aniCur?.d.audioLabel ||
      (aniStreamSid === 'megaplay' || aniStreamSid === 'vidstream' || aniStreamSid?.startsWith('flixcloud')
        ? 'English (Dub)'
        : 'Dub')
    return [
      ...(aniHasDub ? [{ id: 'dub', label: dubLabel, selected: true }] : []),
      ...(aniHasSub ? [{ id: 'sub', label: aniOrigAudio.shortLabel, selected: false }] : []),
    ]
  }, [isAnimeMovieMode, aniPlayback.loading, aniActiveAudio, aniStreamSid, aniAud.tracks, aniCur?.d.audioLabel, aniHasDub, aniHasSub, aniOrigAudio.shortLabel])

  const animeServerPanel = isAnimeMovieMode
    ? (() => {
        const subSlots = WATCH_SERVER_SLOTS.filter((s) => s.category === 'sub')
        const dubSlots = WATCH_SERVER_SLOTS.filter((s) => s.category === 'dub')
        const multiSlots = WATCH_SERVER_SLOTS.filter((s) => s.category === 'multi')
        const hasConfirmedPlayback = Boolean(!aniPlayback.loading && aniPlayback.data)
        const isSwitchingServer = Boolean(aniPlayback.loading && aniLoadKind === 'server' && aniPreferredServer)
        const isResolvingServer = !hasConfirmedPlayback && !aniPlayback.error && !isSwitchingServer
        const currentSid = aniPlayback.loading
          ? isSwitchingServer && aniPreferredServer
            ? aniPreferredServer
            : ''
          : hasConfirmedPlayback
            ? aniStreamSid || aniResolvedServerId
            : ''
        const activeSlotKey = currentSid ? resolveActiveSlotKey(currentSid, aniActiveAudio) : ''
        const activeSlot = activeSlotKey ? WATCH_SERVER_SLOTS.find((s) => s.key === activeSlotKey) : undefined
        const activeCatLabel =
          activeSlot?.category === 'multi'
            ? 'MULTI AUDIO'
            : activeSlot?.category === 'sub'
              ? 'SUB'
              : 'DUB'
        const serverBusy = aniLoadKind === 'server' && aniPlayback.loading
        const handleSelectSlot = (slot: (typeof WATCH_SERVER_SLOTS)[number]) => {
          setAniFailed((prev) => ({
            key: aniKey,
            ids: prev.key === aniKey ? prev.ids.filter((x) => x !== slot.serverId) : [],
          }))
          setAniLoadKind('server')
          setAniResolvedServerId(slot.serverId)
          go({ server: slot.serverId, audio: slot.audio })
        }
        const { subAvailable, dubAvailable, multiAvailable, subChecking, dubChecking, multiChecking } =
          computeServerCategoryAvailability({
            animeLoaded: Boolean(aniMeta),
            availLoading: aniAvail.loading,
            availData: aniAvail.data,
            playbackLoading: aniPlayback.loading,
            playbackResolved: Boolean(aniPlayback.data),
            hasSub: aniHasSub,
            hasDub: aniHasDub,
            streamSid: aniStreamSid,
            currentSid,
            activeSlotCategory: activeSlot?.category,
            trackCount: aniAud.tracks?.length || 0,
          })

        return (
          <section
            aria-label="Stream servers"
            className="mt-5 mx-3 sm:mx-6 lg:mx-0 overflow-hidden rounded-3xl border border-white/10 bg-black shadow-lg"
          >
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/10 bg-black px-4 py-3 sm:px-5">
              <p className="text-xs leading-relaxed text-muted sm:text-[13px]">
                You&apos;re watching{' '}
                <span className="font-bold text-foreground">Movie</span>
                . If current servers doesn&apos;t work, please try other servers beside.
              </p>
              {isResolvingServer ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-muted">
                  <Loader2 className="size-3 animate-spin text-accent" />
                  <span>Loading servers…</span>
                </span>
              ) : isSwitchingServer && activeSlot ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-bold tracking-wide text-foreground">
                  <Loader2 className="size-3 animate-spin text-accent" />
                  <span>{activeCatLabel} · {activeSlot.label}</span>
                </span>
              ) : hasConfirmedPlayback && activeSlot ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-bold tracking-wide text-foreground">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span>{activeCatLabel} · {activeSlot.label}</span>
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3.5 p-4 sm:grid-cols-3 sm:p-5">
              <ServerCategoryDropdown
                title="SUB"
                icon={<Captions className="size-3.5" />}
                placeholder="Select SUB server"
                slots={subSlots}
                activeSlotKey={activeSlotKey}
                loading={serverBusy}
                checking={subChecking}
                available={subAvailable}
                unavailableLabel="Not Available"
                onSelect={handleSelectSlot}
              />
              <ServerCategoryDropdown
                title="DUB"
                icon={<Mic className="size-3.5" />}
                placeholder="Select DUB server"
                slots={dubSlots}
                activeSlotKey={activeSlotKey}
                loading={serverBusy}
                checking={dubChecking}
                available={dubAvailable}
                unavailableLabel="Not Available"
                onSelect={handleSelectSlot}
              />
              <ServerCategoryDropdown
                title="MULTI AUDIO"
                icon={<Languages className="size-3.5" />}
                placeholder="Select Multi Audio"
                slots={multiSlots}
                activeSlotKey={activeSlotKey}
                loading={serverBusy}
                checking={multiChecking}
                available={multiAvailable}
                unavailableLabel="Not Available"
                onSelect={handleSelectSlot}
              />
            </div>
          </section>
        )
      })()
    : null

  return (
    <main className="relative pb-16">
      <div className="mx-auto max-w-7xl lg:px-6 lg:pt-6">
        {/* Player: Anime Movie Mode (CinePlayer + Anime servers) OR Regular Movie/TV (CinemaOS Priority #1 + backups) */}
        <div
          ref={playerContainerRef}
          className="relative aspect-video w-full max-h-[86dvh] overflow-hidden bg-black lg:rounded-3xl lg:shadow-2xl lg:shadow-black/40 lg:ring-1 lg:ring-white/10"
        >
          {!animeMatchSettled ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 p-6 text-center select-none">
              <div className="relative mb-3 grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-accent shadow-xl shadow-black/50">
                <Loader2 className="size-6 animate-spin text-accent" />
              </div>
              <h3 className="font-display text-base font-bold text-foreground">Preparing player</h3>
              <p className="mt-1 text-xs text-muted">Checking best servers for this title…</p>
            </div>
          ) : isAnimeMovieMode ? (
            !sessionVerified ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 p-6 text-center select-none">
                <div className="relative mb-3 grid size-16 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent shadow-xl shadow-black/50">
                  <Lock className="size-8 animate-pulse" />
                </div>
                <h3 className="font-display text-lg font-bold text-foreground">Media Playback Locked</h3>
                <p className="mt-1.5 max-w-sm text-xs text-muted leading-relaxed">
                  Verification challenge in progress. Complete the challenge to unlock streaming.
                </p>
                {shieldFailed && (
                  <button onClick={() => void getToken()} className="mt-4 rounded-full bg-white px-5 py-2 text-xs font-bold text-black active:scale-95">
                    Retry
                  </button>
                )}
              </div>
            ) : aniCur ? (
              <CinePlayer
                key={`anime:${aniId}:${aniResolvedServerId}:${aniAudio}`}
                hasDub={aniHasDub}
                hasSub={aniHasSub}
                audioLoading={Boolean(aniPlayback.loading || (aniAudio === 'dub' && aniAvail.loading && aniAud.tracks.length < 2 && aniStreamAudio !== 'dub'))}
                switching={aniPlayback.loading}
                streamUrl={aniCur.d.streamUrl}
                fallbackStreamUrl={aniCur.d.fallbackStreamUrl}
                intro={aniEffectiveIntro}
                recap={aniEffectiveRecap}
                outro={aniEffectiveOutro}
                onDuration={setVideoDuration}
                title={title}
                episode={1}
                totalEpisodes={1}
                availableEpisodes={1}
                animeId={aniId}
                format="MOVIE"
                directSubtitles={aniCur.d.subtitles.map((s, i) => ({ id: `s${i}`, label: s.label, lang: s.label, url: s.file }))}
                originalLanguage={aniOrigAudio.language}
                audioMode={aniActiveAudio}
                onAudio={(m) => {
                  if (aniPlayback.loading) return
                  setAniLoadKind('episode')
                  go({ audio: m, server: null })
                }}
                dubs={aniDubsProp}
                onDub={(dubId) => {
                  if (aniPlayback.loading) return
                  setAniLoadKind('episode')
                  go({ audio: dubId === 'dub' ? 'dub' : 'sub', server: null })
                }}
                onAudioTracks={(tracks, active) => setAniAud({ tracks, active })}
                onStreamError={() => {
                  const sid = aniPlayback.data?.serverId || aniResolvedServerId
                  setAniHeld(null)
                  setAniLoadKind('server')
                  setAniFailed((prev) => ({
                    key: aniKey,
                    ids: prev.key === aniKey ? (prev.ids.includes(sid) ? prev.ids : [...prev.ids, sid]) : [sid],
                  }))
                }}
                onPlay={() =>
                  touchMovieProgress({
                    id,
                    type: 'movie',
                    title: m?.title ?? aniTitle,
                    poster: m?.poster ?? null,
                    backdrop: m?.backdrop ?? null,
                    epTitle: null,
                    epImage: null,
                    season: 1,
                    episode: 1,
                    totalEpisodesInSeason: 1,
                    totalSeasons: 1,
                  })
                }
                onProgress={(pos, dur) =>
                  touchMovieProgress({
                    id,
                    type: 'movie',
                    title: m?.title ?? aniTitle,
                    poster: m?.poster ?? null,
                    backdrop: m?.backdrop ?? null,
                    epTitle: null,
                    epImage: null,
                    season: 1,
                    episode: 1,
                    pos,
                    dur,
                    totalEpisodesInSeason: 1,
                    totalSeasons: 1,
                  })
                }
                onEnded={() =>
                  finishMovieWatch({
                    id,
                    type: 'movie',
                    title: m?.title ?? aniTitle,
                    poster: m?.poster ?? null,
                    backdrop: m?.backdrop ?? null,
                    epTitle: null,
                    season: 1,
                    episode: 1,
                    hasNext: false,
                  })
                }
                fallbackImg={m?.backdrop ? `https://image.tmdb.org/t/p/w1280${m.backdrop}` : m?.poster ? `https://image.tmdb.org/t/p/w500${m.poster}` : null}
                defaultRuntime={m?.runtime ?? aniMeta?.duration ?? null}
              />
            ) : aniPlayback.loading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 p-6 text-center select-none">
                {m?.backdrop && (
                  <img
                    src={`https://image.tmdb.org/t/p/w1280${m.backdrop}`}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 size-full object-cover opacity-20 pointer-events-none"
                  />
                )}
                <div className="relative z-10 flex flex-col items-center">
                  <div className="relative mb-3 grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-accent shadow-xl shadow-black/50">
                    <Loader2 className="size-6 animate-spin text-accent" />
                  </div>
                  <h3 className="font-display text-base font-bold text-foreground">Loading Anime Servers</h3>
                  <p className="mt-1 text-xs text-muted">Connecting to anime playback servers…</p>
                </div>
              </div>
            ) : (
              <StreamProblem reason={aniPlayback.error?.message || 'This anime movie is currently unavailable on anime servers.'}>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAniFailed({ key: aniKey, ids: [] })
                      setAniReloadTick((t) => t + 1)
                    }}
                    className={cn(pill, 'border-transparent bg-white text-black font-semibold')}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAniFailed({ key: aniKey, ids: [] })
                      go({ audio: aniAudio === 'dub' ? 'sub' : 'dub', server: null })
                    }}
                    className={cn(pill, 'border-white/25 bg-white/10 text-white font-semibold hover:bg-white/20')}
                  >
                    Try {aniAudio === 'dub' ? 'SUB' : 'DUB'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setForceRegularMovieMode(true)}
                    className={cn(pill, 'border-white/25 bg-white/10 text-white font-semibold hover:bg-white/20')}
                  >
                    Try Movie Servers
                  </button>
                </div>
              </StreamProblem>
            )
          ) : loadingStream ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 p-6 text-center select-none">
              {m?.backdrop && (
                <img
                  src={`https://image.tmdb.org/t/p/w1280${m.backdrop}`}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 size-full object-cover opacity-20 pointer-events-none"
                />
              )}
              <div className="relative z-10 flex flex-col items-center">
                <div className="relative mb-3 grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-accent shadow-xl shadow-black/50">
                  <Loader2 className="size-6 animate-spin text-accent" />
                </div>
                <h3 className="font-display text-base font-bold text-foreground">Starting playback</h3>
                <p className="mt-1 text-xs text-muted">Loading player…</p>
              </div>
            </div>
          ) : (activeSource?.kind === 'direct' && activeSource.streams?.length) || (activeSource?.kind === 'embed' && Boolean(activeEmbedUrl)) ? (
            <CinePlayer
              key={`${streamKey}:${activeSource.providerId}:${selectedDub || 'def'}:${mbAttemptIdx}`}
              streamUrl={activeSource.kind === 'direct' ? activeStreamUrl : ''}
              fallbackStreamUrl={activeSource.kind === 'direct' ? fallbackStreamUrl : ''}
              embedUrl={activeSource.kind === 'embed' ? activeEmbedUrl : null}
              embedSandboxed={false}
              intro={effectiveIntro}
              recap={effectiveRecap}
              outro={effectiveOutro}
              onDuration={setVideoDuration}
              title={title}
              episode={type === 'tv' ? episode : 1}
              episodeTitle={type === 'tv' ? epName : undefined}
              totalEpisodes={type === 'tv' ? lastEp : 1}
              availableEpisodes={type === 'tv' ? lastEp : 1}
              animeId={id}
              season={type === 'tv' ? season : 1}
              isTmdb
              format={type === 'movie' ? 'MOVIE' : 'TV'}
              servers={directServerList}
              serverId={activeMovieSlot.serverId}
              onServer={handleSwitchServer}
              directSubtitles={(activeSource.subtitles || []).map((s: any, idx: number) => ({
                id: s.id || `sub-${idx}`,
                label: s.label,
                lang: s.language || s.lang,
                url: s.url,
              }))}
              qualities={availableStreams.map((s) => ({
                label: s.quality,
                url: s.proxyStreamUrl || s.streamUrl,
                size: s.size,
                sizeLabel: s.sizeLabel,
              }))}
              currentQuality={currentAttempt?.quality || activeStream?.quality || activeSource.quality}
              onQualityChange={(q: { label: string }) => {
                setSelectedQuality(q.label)
                setMbAttemptIdx(0)
              }}
              dubs={dubs}
              audioLoading={loadingStream}
              onDub={pickDub}
              onStreamError={() => {
                if (mbAttemptIdx + 1 < streamAttempts.length) {
                  setMbAttemptIdx(mbAttemptIdx + 1)
                } else {
                  handleFailover()
                }
              }}
              hasNextEpisode={!!nextTarget}
              hasPrevEpisode={!!prevTarget}
              onNextEpisode={() => nextTarget && go({ s: nextTarget.s, e: nextTarget.e })}
              onPrevEpisode={() => prevTarget && go({ s: prevTarget.s, e: prevTarget.e })}
              onSelectEpisode={(n) => go({ e: n })}
              watchedEps={type === 'tv' ? watchedMovieEps : undefined}
              onPlay={() =>
                touchMovieProgress({
                  id,
                  type,
                  title: m?.title ?? '',
                  poster: m?.poster ?? null,
                  backdrop: m?.backdrop ?? null,
                  epTitle: type === 'tv' ? (epName || null) : null,
                  epImage: type === 'tv' ? (epInfo.get(episode)?.image || null) : null,
                  season,
                  episode: type === 'tv' ? episode : 1,
                  totalEpisodesInSeason: epTotal,
                  totalSeasons: seasons.length || 1,
                })
              }
              onProgress={(pos, dur) =>
                touchMovieProgress({
                  id,
                  type,
                  title: m?.title ?? '',
                  poster: m?.poster ?? null,
                  backdrop: m?.backdrop ?? null,
                  epTitle: type === 'tv' ? (epName || null) : null,
                  epImage: type === 'tv' ? (epInfo.get(episode)?.image || null) : null,
                  season,
                  episode: type === 'tv' ? episode : 1,
                  pos,
                  dur,
                  totalEpisodesInSeason: epTotal,
                  totalSeasons: seasons.length || 1,
                })
              }
              onEnded={() =>
                finishMovieWatch({
                  id,
                  type,
                  title: m?.title ?? '',
                  poster: m?.poster ?? null,
                  backdrop: m?.backdrop ?? null,
                  epTitle: type === 'tv' ? (epName || null) : null,
                  season,
                  episode: type === 'tv' ? episode : 1,
                  hasNext: Boolean(nextTarget),
                })
              }
              switching={loadingStream}
              fallbackImg={m?.backdrop ? `https://image.tmdb.org/t/p/w1280${m.backdrop}` : m?.poster ? `https://image.tmdb.org/t/p/w500${m.poster}` : null}
              defaultRuntime={
                activeStream?.duration
                  ? Math.round(activeStream.duration / 60)
                  : (type === 'tv'
                      ? eps.data?.find((e) => e.n === episode)?.runtime || m?.runtime
                      : m?.runtime) || null
              }
            />
          ) : (
            <StreamProblem reason={streamError || 'Playback is unavailable right now.'}>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void runDetection()}
                  className={cn(pill, 'border-transparent bg-white text-black font-semibold')}
                >
                  Try again
                </button>
                {(directBackups.length > 0 || embedBackups.length > 0) && (
                  <button
                    type="button"
                    onClick={handleFailover}
                    className={cn(pill, 'border-white/25 bg-white/10 text-white font-semibold hover:bg-white/20')}
                  >
                    Auto Switch Server
                  </button>
                )}
              </div>
            </StreamProblem>
          )}
        </div>

        {/* Title + Quick Actions Bar */}
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4 px-3 sm:px-6 lg:px-0">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Link
                to={movieHref({ type, id })}
                className="group inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card px-3.5 py-1.5 text-xs sm:text-sm font-bold text-foreground shadow-sm transition-all hover:border-accent hover:bg-card-2 hover:text-accent active:scale-95"
                title={`View details for ${title}`}
              >
                <ChevronLeft className="size-4 text-accent transition-transform group-hover:-translate-x-1" />
                <span>Details</span>
              </Link>
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-semibold text-muted">
                {type === 'tv' ? <Tv className="size-3.5 text-accent" /> : <Film className="size-3.5 text-accent" />}
                <span>{type === 'tv' ? 'TV Series' : isAnimeMovieMode ? 'Anime Movie' : 'Movie'}</span>
              </span>
              {!isAnimeMovieMode && activeStream?.quality && (
                <span className="rounded-xl border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent">
                  {activeStream.quality}
                </span>
              )}
              {isMovieWatched && <WatchedBadge variant="pill" />}
            </div>
            <Link to={movieHref({ type, id })} className="font-display text-2xl font-black tracking-tight transition-colors hover:text-accent sm:text-3xl">
              {title}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {type === 'tv' ? (
                <span className="font-medium text-foreground">
                  Season {season} · Episode {episode}
                  {epName && epName.trim() !== String(episode) && !/^(?:ep(?:isode)?\.?|ch(?:apter)?\.?)\s*0*(\d+)$/i.test(epName.trim())
                    ? ` · ${epName.trim()}`
                    : ''}
                </span>
              ) : null}
              {m?.rating ? (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-400">
                  <Star className="size-3.5 fill-current" /> {m.rating.toFixed(1)}
                </span>
              ) : null}
              {m?.year && <span>{m.year}</span>}
              {m?.runtime ? (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" /> {formatRuntime(m.runtime)}
                </span>
              ) : null}
              {m?.certification && (
                <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-semibold">
                  {m.certification}
                </span>
              )}
              {m?.status && <span>{m.status}</span>}
            </div>
            {m?.tagline && <p className="mt-1 text-sm italic text-muted">“{m.tagline}”</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {m?.trailer && (
              <button
                type="button"
                onClick={() => setTrailerOpen(true)}
                className={cn(pill, 'inline-flex items-center gap-2 border-border bg-card/80 hover:border-accent hover:text-accent')}
              >
                <Clapperboard className="size-4 text-accent" />
                <span>Trailer</span>
              </button>
            )}
            {m && (
              <button
                type="button"
                onClick={() => {
                  const epUrl =
                    type === 'tv'
                      ? `${window.location.origin}/movies/watch/tv/${id}?${new URLSearchParams({ s: String(season), e: String(episode), ...(selectedDub ? { dub: selectedDub } : {}) }).toString()}`
                      : `${window.location.origin}/movies/watch/movie/${id}${selectedDub ? `?dub=${encodeURIComponent(selectedDub)}` : ''}`
                  shareMedia({
                    url: epUrl,
                    title: type === 'tv' ? `${m.title} — S${season} E${episode}` : m.title,
                    image: img(m.backdrop ?? m.poster, 'w1280'),
                    poster: img(m.poster, 'w500'),
                    label: type === 'tv' ? `Watch S${season} E${episode} free on AnimeStream` : 'Watch free on AnimeStream',
                    subtitle: [type === 'tv' ? `Season ${season} · Episode ${episode}` : 'Movie', m.year].filter(Boolean).join(' · '),
                  })
                }}
                className={cn(pill, 'inline-flex items-center gap-2 border-border bg-card/80 hover:border-accent hover:text-accent')}
              >
                <Share2 className="size-4" />
                <span>Share</span>
              </button>
            )}
            {type === 'tv' && (
              <>
                <button
                  type="button"
                  disabled={!prevTarget}
                  onClick={() => prevTarget && go({ s: prevTarget.s, e: prevTarget.e })}
                  className={cn(pill, 'inline-flex items-center gap-1.5 border-border bg-card/60 disabled:opacity-35')}
                >
                  <ChevronLeft className="size-4" /> Prev
                </button>
                <button
                  type="button"
                  disabled={!nextTarget}
                  onClick={() => nextTarget && go({ s: nextTarget.s, e: nextTarget.e })}
                  className={cn(pill, 'inline-flex items-center gap-1.5 border-transparent bg-foreground text-background disabled:opacity-35')}
                >
                  Next <ChevronRight className="size-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleToggleWatchlist}
              title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
              className={cn(
                pill,
                'inline-flex items-center gap-1.5 transition',
                inWatchlist
                  ? 'border-accent bg-accent/15 text-accent shadow-sm'
                  : 'border-border bg-card/80 hover:border-accent hover:text-accent',
              )}
            >
              <Bookmark className={cn('size-4', inWatchlist && 'fill-current')} />
              <span>{inWatchlist ? 'In Watchlist' : 'Watchlist'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (isAnimeMovieMode) {
                  setAniFailed({ key: aniKey, ids: [] })
                  setAniReloadTick((t) => t + 1)
                } else {
                  void runDetection()
                }
              }}
              title="Refresh / reconnect stream"
              className={cn(pill, 'inline-flex items-center gap-1.5 border-border bg-card/80 hover:border-accent hover:text-accent')}
            >
              <RotateCw className={cn('size-4', (isAnimeMovieMode ? aniPlayback.loading : loadingStream) && 'animate-spin text-accent')} />
              <span>Reload</span>
            </button>
          </div>
        </div>

        {/* Server Selector: Anime Movie Mode (12-Server) OR Normal Movies / TV Shows (3-Server Card) */}
        {isAnimeMovieMode ? (
          animeServerPanel
        ) : (
          <section
            aria-label="Stream servers"
            className="mt-5 mx-3 sm:mx-6 lg:mx-0 overflow-hidden rounded-3xl border border-white/10 bg-black shadow-lg"
          >
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/10 bg-black px-4 py-3 sm:px-5">
              <p className="text-xs leading-relaxed text-muted sm:text-[13px]">
                You&apos;re watching{' '}
                <span className="font-bold text-foreground">
                  {type === 'movie' ? 'Movie' : `Episode ${episode}`}
                </span>
                . If current server doesn&apos;t work, please try other servers below.
              </p>
              {loadingStream && !pendingMovieSlotKey ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-muted">
                  <Loader2 className="size-3 animate-spin text-accent" />
                  <span>Loading servers…</span>
                </span>
              ) : loadingStream && pendingMovieSlotKey ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-bold tracking-wide text-foreground">
                  <Loader2 className="size-3 animate-spin text-accent" />
                  <span>SERVERS · {activeMovieSlot.label}</span>
                </span>
              ) : activeSource ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-bold tracking-wide text-foreground">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span>SERVERS · {activeMovieSlot.label}</span>
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3.5 p-4 sm:p-5">
              <ServerCategoryDropdown
                title="SERVERS"
                icon={<Film className="size-3.5" />}
                placeholder="Select Server"
                slots={movieServerSlots}
                activeSlotKey={activeMovieSlotKey}
                loading={loadingStream}
                checking={loadingStream && !activeSource && !pendingMovieSlotKey}
                available={true}
                onSelect={(slot) => void handleSelectMovieServer(slot)}
              />
            </div>
          </section>
        )}

        {/* Audio / Dub Language Quick Bar (clean language names only, no server names) */}
        {showDubBar && (
          <div className="mt-4 px-3 sm:px-6 lg:px-0">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
              <span className="inline-flex items-center gap-1.5 pr-1 text-xs font-bold uppercase tracking-wider text-accent">
                <Languages className="size-4" />
                <span>Audio / Dub:</span>
              </span>
              {dubs.map((d) => {
                const isSelected =
                  activeSource?.kind === 'direct' && (activeDubObj ? d.id === activeDubObj.id : Boolean(d.selected))
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={loadingStream}
                    onClick={() => !loadingStream && pickDub(d.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
                      isSelected
                        ? 'border-accent bg-accent text-accent-fg shadow-sm'
                        : 'border-border bg-card-2/80 text-muted hover:border-foreground/30 hover:text-foreground',
                    )}
                  >
                    <span>{cleanDubLabel(d.label)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Main 2-column content area */}
        <div className="mt-6 grid gap-8 px-3 sm:px-6 lg:px-0 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-8">
            {/* TV Episodes */}
            {type === 'tv' && (
              <section aria-label="Episodes">
                {seasons.length > 1 && (
                  <div className="mb-4 flex flex-wrap items-center justify-start gap-3 sm:gap-4">
                    <SeasonDropdown
                      align="left"
                      value={String(season)}
                      options={seasons.map((s) => ({
                        value: String(s.n),
                        label: `Season ${s.n}`,
                        subtitle: s.name && s.name !== `Season ${s.n}` ? s.name : undefined,
                        meta: s.episodes ? `${s.episodes} Ep` : undefined,
                      }))}
                      onChange={(v) => go({ s: v, e: 1 })}
                    />
                    <h3 className="font-display text-base font-bold text-foreground sm:text-lg">
                      Season {season} of {seasons.length}
                    </h3>
                  </div>
                )}
                {epTotal > 0 ? (
                  <EpisodeList
                    total={epTotal}
                    available={epTotal}
                    current={episode}
                    hrefFor={hrefFor}
                    info={epInfo}
                    watchedEps={watchedMovieEps}
                    loading={eps.loading}
                    fallbackImg={m?.backdrop ? `https://image.tmdb.org/t/p/w1280${m.backdrop}` : null}
                    defaultRuntime={m?.runtime ?? null}
                  />
                ) : eps.loading ? (
                  <ul className="flex flex-col gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <li key={i} className="flex items-center gap-3 rounded-3xl border border-border bg-card/60 p-2.5 sm:gap-4 sm:p-3">
                        <div className="skeleton aspect-video w-36 shrink-0 rounded-2xl sm:w-52" />
                        <div className="min-w-0 flex-1 space-y-2 py-1">
                          <div className="skeleton h-4 w-3/4 rounded-md" />
                          <div className="skeleton h-3 w-1/3 rounded-md" />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            )}

            {/* Storyline & Details Card */}
            {m ? (
              <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <p className="eyebrow text-accent mb-0.5">About this {type === 'tv' ? 'Series' : 'Film'}</p>
                    <h2 className="font-display text-xl font-bold">Storyline &amp; Overview</h2>
                  </div>
                  {activeDubObj && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card-2 px-3 py-1 text-xs font-semibold text-foreground">
                      <Languages className="size-3.5 text-accent" />
                      <span>{cleanDubLabel(activeDubObj.label)}</span>
                    </span>
                  )}
                </div>

                <p className="text-sm leading-relaxed text-muted">
                  {m.overview || 'No synopsis available for this title yet.'}
                </p>

                {m.genres.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {m.genres.map((g) => (
                      <Link
                        key={g.id}
                        to={`/movies/browse?type=${type}&genre=${g.id}`}
                        className="rounded-full border border-border bg-card-2/80 px-3.5 py-1.5 text-xs font-semibold text-foreground transition hover:border-accent hover:text-accent active:scale-95"
                      >
                        {g.name}
                      </Link>
                    ))}
                  </div>
                )}

                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/70 pt-4 sm:grid-cols-4">
                  <div className="rounded-2xl border border-border/60 bg-card-2/50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Release Year</p>
                    <p className="mt-1 font-display text-sm font-bold text-foreground">{m.year || '—'}</p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-card-2/50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Rating</p>
                    <p className="mt-1 font-display text-sm font-bold text-foreground">
                      {m.rating ? `${m.rating.toFixed(1)} / 10` : '—'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-card-2/50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      {type === 'tv' ? 'Seasons' : 'Runtime'}
                    </p>
                    <p className="mt-1 font-display text-sm font-bold text-foreground">
                      {type === 'tv'
                        ? `${seasons.length || 1} ${seasons.length === 1 ? 'Season' : 'Seasons'}`
                        : m.runtime
                          ? formatRuntime(m.runtime)
                          : '—'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-card-2/50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Status</p>
                    <p className="mt-1 font-display text-sm font-bold text-foreground">{m.status || 'Released'}</p>
                  </div>
                </div>
              </section>
            ) : (
              <Skeleton className="h-56 w-full rounded-3xl" />
            )}

            {/* Cast Section */}
            {m && m.cast.length > 0 && (
              <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
                <div className="mb-4">
                  <p className="mb-0.5 eyebrow text-accent">Starring</p>
                  <h2 className="font-display text-xl font-bold">Top Cast</h2>
                </div>
                <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
                  {m.cast.map((c) => (
                    <div key={c.id} className="w-24 shrink-0 text-center sm:w-28">
                      <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-card-2">
                        {c.photo ? (
                          <Img src={img(c.photo, 'w185') ?? ''} alt={c.name} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full place-items-center font-display text-xl font-black text-muted">
                            {c.name[0]}
                          </div>
                        )}
                      </div>
                      <p className="mt-2 line-clamp-1 text-xs font-semibold text-foreground">{c.name}</p>
                      <p className="line-clamp-1 text-[11px] text-muted">{c.character}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Right Sidebar Card */}
          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            {m ? (
              <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
                <div className="flex gap-4 p-4">
                  {m.poster ? (
                    <Img src={img(m.poster, 'w342') ?? ''} alt={m.title} className="aspect-[2/3] w-24 shrink-0 rounded-2xl object-cover shadow-md" />
                  ) : (
                    <div className="skeleton aspect-[2/3] w-24 shrink-0 rounded-2xl" />
                  )}
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-display font-bold leading-snug text-foreground">{m.title}</p>
                    <p className="mt-1 text-xs text-muted">
                      {[
                        m.year,
                        type === 'tv' && seasons.length ? `Seasons: ${seasons.length}` : null,
                        m.runtime ? formatRuntime(m.runtime) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {m.rating && (
                      <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-400">
                        <Star className="size-3 fill-current" /> {m.rating.toFixed(1)}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.genres.slice(0, 3).map((g) => (
                        <span key={g.id} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                          {g.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                {m.overview && (
                  <p className="line-clamp-5 px-4 text-sm leading-relaxed text-muted">{m.overview}</p>
                )}
                <div className="flex flex-wrap gap-2 p-4">
                  <Link
                    to={movieHref({ type, id })}
                    className={cn(pill, 'inline-flex items-center gap-2 border-border/80 bg-card/80 hover:bg-foreground hover:text-background')}
                  >
                    <Info className="size-4 text-accent" /> Full Details
                  </Link>
                  {m.trailer && (
                    <button
                      type="button"
                      onClick={() => setTrailerOpen(true)}
                      className={cn(pill, 'inline-flex items-center gap-2 border-border/80 bg-card/80 hover:border-accent hover:text-accent')}
                    >
                      <Clapperboard className="size-4 text-accent" /> Trailer
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <Skeleton className="h-64 w-full rounded-3xl" />
            )}
          </aside>
        </div>

        {details.error && (
          <p className="mt-8 px-3 text-center text-sm text-muted">
            Couldn&rsquo;t load title details, but you can still play.{' '}
            <button type="button" className="underline" onClick={() => navigate(0)}>
              Reload
            </button>
          </p>
        )}
      </div>

      {/* Recommendations Row */}
      {(details.loading || (m?.similar && m.similar.length > 0)) && (
        <div className="mt-10">
          <BookRow eyebrow="More like this" title="You might also like" items={m?.similar.map(toMovieCard)} loading={details.loading} />
        </div>
      )}

      <TrailerModal
        trailer={trailerOpen && m?.trailer ? { id: m.trailer, site: 'youtube', thumbnail: null } : null}
        onClose={() => setTrailerOpen(false)}
      />
    </main>
  )
}
