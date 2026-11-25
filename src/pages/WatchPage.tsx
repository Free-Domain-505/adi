import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flag,
  Info,
  Lock,
  Unlock,
  ShieldCheck,
  Users,
  X,
  MonitorPlay,
  Copy,
  Check,
  Film,
  Smile,
  EyeOff,
  LogOut,
  MessageSquare,
  List,
  Crown,
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Languages,
  Share2,
  Captions,
  Loader2,
} from 'lucide-react'
import { ServerCategoryDropdown } from '../components/ServerCategoryDropdown'
import { WatchTogetherRoom, generateWatchRoomId, type PeerMember, type WatchChatMessage, type WatchReaction } from '../lib/webrtcWatchTogether'
import {
  createWatchRoom,
  getWatchRoom,
  updateWatchRoom,
  touchWatchRoom,
  deleteWatchRoom,
  getClientSessionId,
  getMyHostIdentifier,
} from '../lib/watchRooms'
import { WatchTogetherModal } from '../components/WatchTogetherModal'
import { LiveReactionsOverlay } from '../components/LiveReactionsOverlay'
import { StyledDisplayName } from '../components/StyledDisplayName'
import { ChangeShowModal } from '../components/ChangeShowModal'
import { Avatar } from '../components/Avatar'
import { useAuth } from '../context/AuthContext'
import { useProfile } from '../lib/profile'
import { submitStreamReport } from '../lib/supabase'
import { fetchAnimeLite } from '../services/anilist'
import { tmdbImg, type StreamResult } from '../services/api'
import { useAsync } from '../hooks/useAsync'
import { useTmdb } from '../hooks/useTmdb'
import { useEpisodesState } from '../hooks/useEpisodes'
import { useFiller } from '../hooks/useFiller'
import { useFlag } from '../hooks/useFlag'
import { computeServerCategoryAvailability, getMaskedServerLabel, resolveActiveSlotKey, serverById, WATCH_SERVER_SLOTS } from '../lib/servers'
import { episodeCounts } from '../lib/episodes'
import { lastEpisode, saveEpisode } from '../lib/progress'
import { resolveBestSkipPair, type SkipTimeSources } from '../lib/skipValidation'
import { fetchSkipTimesSources } from '../services/skipTimes'
import { toast } from '../lib/toast'
import { partyShareUrl, shareMedia } from '../lib/share'
import { finishEpisode, getPrefs, touchHistory, useWatchedEpisodes, useIsAnimeWatched } from '../lib/library'
import { mediaToCard } from '../lib/mappers'
import { ListButton } from '../components/ListButton'
import { cn, formatLabel, formatStatus, pickTitle, stripHtml } from '../lib/utils'
import { requestMicrophoneStream } from '../lib/microphone'
import CinePlayer from '../components/CinePlayer'
import { EpisodeList } from '../components/EpisodeList'
import { WatchedBadge } from '../components/WatchedBadge'
import { ErrorState } from '../components/ErrorState'
import { Skeleton } from '../components/Skeleton'
import { LoadingGrid } from '../components/LoadingGrid'
import { LogoFill } from '../components/LogoFill'
import { LOGO_URL } from '../lib/constants'
import { useShieldVerified, useShield, getToken } from '../lib/shield'
import { StreamProblem } from '../components/StreamProblem'
import { resolveAnimeWithFallback } from '../lib/animePlayback'
import { getOriginalAudioMeta } from '../lib/audioLabels'


function Frame({ children }: { children: React.ReactNode }) {
  return <div data-tour="w-player" className="relative aspect-video w-full max-h-[86dvh] overflow-hidden bg-black lg:rounded-3xl">{children}</div>
}

/** Loading (episode, first load and server switch): the show's logo fills from dim to full colour. No logo: the AnimeStream logo fills smoothly, plus quiet server switch. */
function Loading({ quiet, logo }: { quiet?: boolean; logo: string | null }) {
  return (
    <Frame>
      <div className="absolute inset-0 grid place-items-center">
        <LogoFill src={logo || LOGO_URL} />
      </div>
      {!quiet && <LoadingGrid className="absolute bottom-3 left-3 text-white/60 sm:bottom-4 sm:left-4" />}
    </Frame>
  )
}

/** Unavailable server: friendly mascot scene. The raw reason is kept off-screen (data-reason) so users never see backend wording. */
function Problem({ message, onReconnect, children }: { message?: string; onReconnect?: () => void; children?: React.ReactNode }) {
  return (
    <Frame>
      <StreamProblem reason={message} onReconnect={onReconnect}>
        {children}
      </StreamProblem>
    </Frame>
  )
}

const pill = 'rounded-full border px-4 py-2 text-sm font-semibold transition active:scale-95'

export default function WatchPage() {
  const id = Number(useParams().id)
  const [sp, setSp] = useSearchParams()
  const autoNext = true
  const autoSkip = false
  const [skipFiller, setSkipFiller] = useFlag('zk:skipfiller', false)

  // Watch Together State (WebRTC + Supabase Broadcast Signaling)
  const { user, username: authUsername } = useAuth()
  const me = useProfile()
  const [watchModalOpen, setWatchModalOpen] = useState(false)
  const [room, setRoom] = useState<WatchTogetherRoom | null>(null)
  const [peers, setPeers] = useState<PeerMember[]>([])
  const [chatMessages, setChatMessages] = useState<WatchChatMessage[]>([])
  const [reactions, setReactions] = useState<WatchReaction[]>([])
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'p2p' | 'disconnected'>('disconnected')
  const [externalControl, setExternalControl] = useState<{ action: 'play' | 'pause' | 'seek'; time: number; token: number } | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const navigate = useNavigate()
  const [hideEmojiOverlay, setHideEmojiOverlay] = useState(false)
  const [hostTab, setHostTab] = useState<'chat' | 'episodes'>('chat')
  const [changeShowOpen, setChangeShowOpen] = useState(false)
  const [inlineChatText, setInlineChatText] = useState('')
  const [copiedInvite, setCopiedInvite] = useState(false)
  const [, setControlModeKey] = useState(0)
  const [isMicActive, setIsMicActive] = useState(false)
  const chatListRef = useRef<HTMLDivElement>(null)

  const EMOJI_REACTIONS = ['🔥', '😱', '❤️', '😂', '👏', '⚡', '🍿', '⚔️']

  useEffect(() => {
    if (chatListRef.current) {
      chatListRef.current.scrollTop = chatListRef.current.scrollHeight
    }
  }, [chatMessages])

  const showNotice = (msg: string) => {
    setSyncNotice(msg)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setSyncNotice(null), 2000)
  }

  const userProfile = useMemo(() => {
    const guestId = getClientSessionId().replace(/[^a-z0-9_-]/gi, '').slice(-6) || 'guest'
    const handle =
      authUsername ||
      (user?.user_metadata?.username as string | undefined) ||
      (user?.email ? user.email.split('@')[0] : '') ||
      `guest_${guestId}`
    return {
      id: user?.id,
      username: handle.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
      displayName: me.name || user?.user_metadata?.full_name || authUsername || 'Otaku',
      avatar: me.avatar,
      nameStyle: me.nameStyle ?? null,
    }
  }, [user, authUsername, me])



  const shieldOk = useShieldVerified()
  // once verified, stay verified: a token refresh mid-session must not unmount the player (that kicks it out of fullscreen)
  const [everOk, setEverOk] = useState(shieldOk)
  useEffect(() => {
    if (shieldOk) setEverOk(true)
  }, [shieldOk])
  const sessionVerified = shieldOk || everOk
  const shieldFailed = useShield().failed
  useEffect(() => {
    if (shieldOk) return
    void getToken()
    // keep trying: one failed fetch must never leave the player locked until a manual reload
    const t = window.setInterval(() => void getToken(), 6000)
    return () => window.clearInterval(t)
  }, [shieldOk])
  const [loadKind, setLoadKind] = useState<'episode' | 'server'>('episode')
  const [aud, setAud] = useState<{ tracks: { i: number; label: string; lang: string }[]; active: number }>({ tracks: [], active: 0 })
  /** audio rendition the party host picked; applied here as soon as this server's track list has it */
  const [partyTrack, setPartyTrack] = useState<{ label: string; lang: string; token: number } | null>(null)
  const applyingPartyAudio = useRef(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportIssue, setReportIssue] = useState("Broken / Won't Play")
  const [reportDetails, setReportDetails] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const anime = useAsync(() => fetchAnimeLite(id), [id])
  const a = anime.data?.id === id ? anime.data : undefined
  const watchedEps = useWatchedEpisodes(id)
  const isAnimeWatched = useIsAnimeWatched(id, a?.episodes)
  const title = a ? pickTitle(a.title) : ''
  const counts = a ? episodeCounts(a) : { total: 0, available: 0 }

  const rawEp = Number(sp.get('ep')) || lastEpisode(id) || 1
  const maxEp = a ? (a.status === 'RELEASING' && !a.episodes ? Math.max(counts.available, rawEp) : Math.max(counts.available, 1)) : rawEp
  const ep = a ? Math.min(Math.max(1, rawEp), maxEp) : rawEp
  const total = Math.max(counts.total, ep)
  const available = Math.max(counts.available, ep)
  const audioParam = sp.get('audio')?.toLowerCase()
  const audio: 'sub' | 'dub' =
    audioParam === 'sub' ? 'sub' : audioParam === 'dub' ? 'dub' : (getPrefs().audio ?? 'dub')

  const origAudio = useMemo(() => getOriginalAudioMeta(a?.countryOfOrigin), [a?.countryOfOrigin])

  const avail = useAsync(async () => {
    if (!id || !title) return null
    try {
      const q = new URLSearchParams({ id: String(id), ep: String(ep), title, v: '6' })
      if (a?.title?.romaji) q.set('romaji', a.title.romaji)
      if (a?.episodes) q.set('episodes', String(a.episodes))
      if (a?.format) q.set('format', a.format)
      if (a?.countryOfOrigin) q.set('country', a.countryOfOrigin)
      const res = await fetch(`/api/servers-available?${q}`)
      if (res.ok) {
        const d = await res.json()
        if (d?.success && d.servers) {
          let nonAcdnSub = false
          let nonAcdnDub = false
          let acdnSub = false
          let acdnDub = false
          let hasMulti = false
          for (const [k, v] of Object.entries(d.servers as Record<string, { sub?: boolean; dub?: boolean; multi?: boolean; available?: boolean; languages?: string[] }>)) {
            if (k === 'acdn') {
              if (v?.sub || v?.multi) acdnSub = true
              if (v?.dub || v?.multi) acdnDub = true
              if (v?.multi || (Array.isArray(v?.languages) && v.languages.length >= 2)) hasMulti = true
            } else if (k === 'watchanimeworld' || k === 'server12' || k.startsWith('animesalt')) {
              if (v?.sub || v?.multi) nonAcdnSub = true
              if (v?.dub || v?.multi) nonAcdnDub = true
              if (v?.multi || v?.available || (Array.isArray(v?.languages) && v.languages.length >= 2)) {
                hasMulti = true
              }
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
        }
      }
    } catch {}
    return { sub: true, dub: false, nonAcdnSub: true, nonAcdnDub: false, acdnSub: false, acdnDub: false, hasMulti: false }
  }, [id, ep, title, a?.title?.romaji, a?.episodes, a?.format, a?.countryOfOrigin])

  const preferredServer = sp.get('server')?.toLowerCase() || null
  const [resolvedServerId, setResolvedServerId] = useState(preferredServer || (audio === 'dub' ? 'acdn' : 'megaplay'))
  const server = serverById(resolvedServerId)
  const [failed, setFailed] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] })
  const epKey = `${id}:${ep}`
  const failedIds = failed.key === epKey ? failed.ids : []
  const failedSig = failedIds.join(',')

  function go(patch: { ep?: number; server?: string; audio?: 'sub' | 'dub' }, replace = true, fromPartySync = false) {
    if (room) {
      if (!room.isHost && !fromPartySync) {
        if (patch.ep !== undefined && patch.ep !== ep) {
          toast('Only the party host can change episodes', 'info')
          return
        }
        if (patch.audio && patch.audio !== audio) {
          toast('Only the party host can change party audio track', 'info')
          return
        }
      }
      if (room.isHost && !fromPartySync) {
        if (patch.ep !== undefined && patch.ep !== ep) {
          room.sendEpisodeChange(patch.ep)
          void updateWatchRoom(room.roomId, { episode: patch.ep })
        }
        if (patch.audio && patch.audio !== audio) {
          room.sendAudioChange(patch.audio)
          void updateWatchRoom(room.roomId, { audio: patch.audio })
        }
        if (patch.server && patch.server !== resolvedServerId) {
          room.sendServerChange(patch.server)
        }
      }
    }
    setLoadKind(patch.server ? 'server' : 'episode')
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (patch.ep !== undefined) n.set('ep', String(patch.ep))
        else if (!n.has('ep')) n.set('ep', String(ep))
        let nextAudio = patch.audio ?? audio
        if (patch.server) {
          if (patch.server === 'desidubanime' || patch.server === 'watchanimeworld' || patch.server === 'server12') nextAudio = 'dub'
          n.set('server', patch.server)
        } else if (patch.audio) {
          n.delete('server')
        }
        n.set('audio', nextAudio)
        return n
      },
      { replace },
    )
  }


  const connectToRoom = useCallback((roomId: string, isHost: boolean) => {
    if (room) {
      room.destroy()
    }

    const newRoom = new WatchTogetherRoom({
      roomId,
      isHost,
      animeId: id,
      episode: ep,
      animeTitle: title,
      server: server.id,
      user: userProfile,
    })

    newRoom.onSync((payload) => {
      if (payload.type === 'PLAY') {
        setExternalControl({ action: 'play', time: payload.currentTime, token: Date.now() })
        showNotice('Party playing')
      } else if (payload.type === 'PAUSE') {
        setExternalControl({ action: 'pause', time: payload.currentTime, token: Date.now() })
        showNotice('Party paused')
      } else if (payload.type === 'SEEK') {
        setExternalControl({ action: 'seek', time: payload.currentTime, token: Date.now() })
        const m = Math.floor(payload.currentTime / 60)
        const sec = Math.floor(payload.currentTime % 60)
        showNotice(`Seeked to ${m}:${sec < 10 ? '0' : ''}${sec}`)
      } else if (payload.type === 'HEARTBEAT') {
        const v = videoElRef.current
        if (v) {
          const expected = payload.currentTime + (Date.now() - payload.timestamp) / 1000
          const stateOff = Boolean(payload.paused) !== v.paused && !v.seeking
          if (Math.abs(v.currentTime - expected) > 1.4 || stateOff) {
            // also covers a guest who just (re)joined: pick up the host's position and play/pause state
            setExternalControl({
              action: payload.paused ? 'pause' : 'play',
              time: payload.paused ? payload.currentTime : expected,
              token: Date.now(),
            })
          }
        }
      }
    })

    newRoom.onEpisodeChange((newEp) => {
      if (newEp !== ep) {
        showNotice(`Party changed to Episode ${newEp}`)
        go({ ep: newEp }, false, true)
      }
    })

    newRoom.onShowChange((newAnimeId, newTitle, newEp) => {
      showNotice(`Party host switched show to ${newTitle}`)
      navigate(`/watch/${newAnimeId}?room=${roomId}&ep=${newEp || 1}`)
    })

    newRoom.onServerChange((newServer) => {
      showNotice(`Party host switched to ${getMaskedServerLabel(newServer, audio)}`)
      go({ server: newServer }, false, true)
    })

    newRoom.onAudioChange((newAudio) => {
      showNotice(`Party host switched audio to ${newAudio.toUpperCase()}`)
      go({ audio: newAudio }, false, true)
    })

    newRoom.onAudioTrackChange((t) => {
      showNotice(`Party host switched audio to ${t.label || t.lang || 'another track'}`)
      setPartyTrack({ ...t, token: Date.now() })
    })

    newRoom.onPeersChange((p) => setPeers(p))
    newRoom.onChat((msg) => setChatMessages((prev) => [...prev.slice(-80), msg]))
    newRoom.onReaction((r) => setReactions((prev) => [...prev.slice(-30), r]))
    newRoom.onConnectionStatusChange((st) => setConnectionStatus(st))
    newRoom.onLocalMicChange((active) => setIsMicActive(active))

    setRoom(newRoom)
    setPeers(newRoom.getPeers())
    setIsMicActive(newRoom.getIsMicActive())
    toast(isHost ? `Watch Party started! Code: ${roomId}` : `Joined Watch Party ${roomId}!`, 'success')
  }, [room, id, ep, title, server.id, userProfile, go, navigate])

  /** Coming back from a member's profile: reopen the party panel (the room itself is rejoined from the URL). */
  const reopenAfterProfile = (roomId: string) => {
    try {
      if (sessionStorage.getItem('zk:party-return') === roomId) {
        sessionStorage.removeItem('zk:party-return')
        setWatchModalOpen(true)
      }
    } catch {
      /* storage unavailable */
    }
  }

  // Auto-connect and restore host status from Supabase if room param is present in URL
  const urlRoom = sp.get('room')
  const joiningRoom = useRef<string | null>(null)
  useEffect(() => {
    if (urlRoom && !room && title && joiningRoom.current !== urlRoom) {
      joiningRoom.current = urlRoom // render churn must not open the same room twice (duplicate presence = ghost members)
      void (async () => {
        const record = await getWatchRoom(urlRoom)
        const myHostId = getMyHostIdentifier(user?.id)
        if (record) {
          const amHost = record.host_id === myHostId
          if (record.anime_id !== id) {
            joiningRoom.current = null
            navigate(`/watch/${record.anime_id}?room=${urlRoom}&ep=${record.episode}&server=${record.server}&audio=${record.audio}`, { replace: true })
            return
          }
          connectToRoom(urlRoom, amHost)
          reopenAfterProfile(urlRoom)
        } else {
          // If room record was deleted or expired (>30m inactive), join as standard peer
          connectToRoom(urlRoom, false)
          reopenAfterProfile(urlRoom)
        }
      })()
    }
  }, [urlRoom, room, title, id, user?.id, connectToRoom, navigate])

  // Periodic heartbeat when host + touch Supabase record to refresh 30-min window
  useEffect(() => {
    if (!room) return
    const interval = window.setInterval(() => {
      const v = videoElRef.current
      if (v && !v.ended && room.isHost) {
        room.sendSync('HEARTBEAT', v.currentTime, v.paused)
      }
      if (room.isHost) {
        void touchWatchRoom(room.roomId)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [room])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (room) room.destroy()
    }
  }, [room])

  const handleCreateRoom = async () => {
    const newId = generateWatchRoomId()
    const myHostId = getMyHostIdentifier(user?.id)

    // Save temporary room record to Supabase with 30-minute auto-expiry
    await createWatchRoom({
      roomId: newId,
      hostId: myHostId,
      hostUsername: userProfile.username,
      hostDisplayName: userProfile.displayName,
      hostAvatar: userProfile.avatar,
      animeId: id,
      animeTitle: title,
      episode: ep,
      server: server.id,
      audio,
    })

    joiningRoom.current = newId
    connectToRoom(newId, true)
    setSp((prev) => {
      const n = new URLSearchParams(prev)
      n.set('room', newId)
      return n
    }, { replace: true })
  }

  const handleJoinRoom = async (code: string) => {
    const cleanCode = code.trim().toLowerCase()
    const record = await getWatchRoom(cleanCode)
    const myHostId = getMyHostIdentifier(user?.id)
    const amHost = record ? record.host_id === myHostId : false

    if (record && record.anime_id !== id) {
      navigate(`/watch/${record.anime_id}?room=${cleanCode}&ep=${record.episode}&server=${record.server}&audio=${record.audio}`)
      return
    }

    joiningRoom.current = cleanCode
    connectToRoom(cleanCode, amHost)
    setSp((prev) => {
      const n = new URLSearchParams(prev)
      n.set('room', cleanCode)
      return n
    }, { replace: true })
  }

  const handleLeaveRoom = () => {
    joiningRoom.current = null
    if (room) {
      if (room.isHost) {
        void deleteWatchRoom(room.roomId)
      }
      room.destroy()
      setRoom(null)
      setPeers([])
      setChatMessages([])
      setReactions([])
      setSp((prev) => {
        const n = new URLSearchParams(prev)
        n.delete('room')
        return n
      }, { replace: true })
      toast('Left Watch Party', 'info')
    }
  }

  const handlePlayerAction = (action: { type: 'play' | 'pause' | 'seek'; time: number }) => {
    if (!room) return
    if (room.hostOnlyControl && !room.isHost) return
    if (action.type === 'play') {
      room.sendSync('PLAY', action.time)
    } else if (action.type === 'pause') {
      room.sendSync('PAUSE', action.time)
    } else if (action.type === 'seek') {
      room.sendSync('SEEK', action.time)
    }
  }

  const handleChangeShow = (newAnimeId: number, newTitle: string) => {
    if (room && room.isHost) {
      room.sendShowChange(newAnimeId, newTitle, 1)
      void updateWatchRoom(room.roomId, {
        anime_id: newAnimeId,
        anime_title: newTitle,
        episode: 1,
      })
      navigate(`/watch/${newAnimeId}?room=${room.roomId}&ep=1`)
    }
  }

  const handleCopyInvite = async () => {
    if (!room) return
    const url = partyShareUrl(id, ep, room.roomId, userProfile.displayName, title, userProfile.avatar)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedInvite(true)
      toast('Copied Watch Party invite link!')
      setTimeout(() => setCopiedInvite(false), 2000)
    } catch {
      toast('Failed to copy link', 'error')
    }
  }

  const handleForceSync = () => {
    if (!room) return
    const v = videoElRef.current
    if (v) {
      room.sendSync('SEEK', v.currentTime)
      showNotice('Sent force sync to all peers')
    }
  }

  const bundle = useTmdb(a?.id, title, a?.format)
  const logo = tmdbImg(bundle?.tmdb?.logo, 'w500')
  const epState = useEpisodesState(bundle?.tmdb ?? null, a?.streamingEpisodes, a)
  const eps = epState.episodes
  const episodesLoading = (Boolean(a?.id && title) && bundle === null) || epState.loading
  const kinds = useFiller(a)
  const isMovie =
    a?.format === 'MOVIE' ||
    bundle?.tmdb?.type === 'movie' ||
    ((a?.episodes ?? 0) === 1 && (a?.duration ?? 0) >= 45)
  const malId = a?.idMal ?? bundle?.mapping?.mal ?? null

  const [videoDuration, setVideoDuration] = useState(0)
  useEffect(() => {
    setVideoDuration(0)
  }, [id, ep, audio, preferredServer])

  const tmdbId = bundle?.tmdb?.id ?? bundle?.mapping?.tmdb?.id ?? null
  const imdbId = bundle?.tmdb?.imdbId ?? bundle?.mapping?.imdb ?? null
  const skipMediaType: 'movie' | 'tv' =
    bundle?.tmdb?.type === 'movie' || (!bundle?.tmdb?.type && isMovie) ? 'movie' : 'tv'
  const skipSeason = bundle?.tmdb?.season ?? 1

  const skipSources = useAsync(
    () =>
      a?.id || malId || tmdbId || imdbId || title
        ? fetchSkipTimesSources({
            anilistId: a?.id ?? id,
            malId,
            ep,
            tmdbId,
            imdbId,
            type: skipMediaType,
            format: a?.format ?? null,
            year: a?.seasonYear ?? null,
            season: skipSeason,
            episode: ep,
            title,
            englishTitle: a?.title?.english ?? null,
            romajiTitle: a?.title?.romaji ?? null,
            nativeTitle: a?.title?.native ?? null,
            altTitles: (a as { synonyms?: string[] } | undefined)?.synonyms ?? null,
          })
        : Promise.resolve(null),
    [a?.id, id, malId, ep, tmdbId, imdbId, skipMediaType, skipSeason, title, a?.format, a?.seasonYear],
  )
  const [resolvedSkipSources, setResolvedSkipSources] = useState<{ key: string; data: SkipTimeSources | null }>({
    key: '',
    data: null,
  })
  useEffect(() => {
    if (skipSources.data) {
      setResolvedSkipSources({ key: epKey, data: skipSources.data })
    } else {
      setResolvedSkipSources((prev) => (prev.key === epKey ? prev : { key: epKey, data: null }))
    }
  }, [skipSources.data, epKey])
  const curSkipSources = resolvedSkipSources.key === epKey ? resolvedSkipSources.data : (skipSources.data ?? null)

  const [extraSkip, setExtraSkip] = useState<{ key: string; intro: { start: number; end: number } | null; outro: { start: number; end: number } | null }>({
    key: '',
    intro: null,
    outro: null,
  })
  useEffect(() => {
    setExtraSkip({ key: `${id}:${ep}:${audio}`, intro: null, outro: null })
  }, [id, ep, audio])

  const playback = useAsync(
    async () => {
      if (!a || !sessionVerified) return null
      const reqKey = `${id}:${ep}:${audio}:${preferredServer ?? ''}`
      return resolveAnimeWithFallback(
        { id, ep, title, romaji: a.title.romaji, format: a.format, country: a.countryOfOrigin, audio, preferredServer },
        failedIds,
        (skip) => {
          setExtraSkip((prev) => {
            if (prev.key !== reqKey && prev.key !== '') return prev
            return {
              key: reqKey,
              intro: prev.intro ?? skip.intro,
              outro: prev.outro ?? skip.outro,
            }
          })
        },
      )
    },
    [a?.id, ep, title, a?.title.romaji, a?.format, a?.countryOfOrigin, audio, preferredServer, sessionVerified, failedSig],
  )
  useEffect(() => {
    if (playback.data?.serverId) setResolvedServerId(playback.data.serverId)
    else if (!playback.loading) setResolvedServerId(preferredServer || (audio === 'dub' ? 'acdn' : 'megaplay'))
  }, [playback.data?.serverId, playback.loading, id, ep, audio, preferredServer])

  // Keep the player mounted across episode changes for direct streams
  const [held, setHeld] = useState<{ aid: number; d: StreamResult; ep: number; audio: 'sub' | 'dub'; sid: string } | null>(null)
  useEffect(() => {
    setHeld(null)
    setAud({ tracks: [], active: 0 })
  }, [id, audio])
  useEffect(() => {
    setAud({ tracks: [], active: 0 })
  }, [ep])
  useEffect(() => {
    if (playback.data?.kind === 'direct') {
      const resolvedAudio: 'sub' | 'dub' =
        playback.data.stream.audio === 'multi'
          ? audio
          : playback.data.stream.audio === 'dub'
            ? 'dub'
            : 'sub'
      setHeld({ aid: id, d: playback.data.stream, ep, audio: resolvedAudio, sid: playback.data.serverId })
    } else if (playback.data?.kind === 'embed') {
      setHeld(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.data])
  const curAudioFromPlayback: 'sub' | 'dub' =
    playback.data?.kind === 'direct'
      ? playback.data.stream.audio === 'multi'
        ? audio
        : playback.data.stream.audio === 'dub'
          ? 'dub'
          : 'sub'
      : audio
  const cur =
    playback.data?.kind === 'direct'
      ? { d: playback.data.stream, ep, audio: curAudioFromPlayback }
      : playback.loading && held && held.aid === id && !playback.error
        ? held
        : null
  const streamAudio =
    playback.data?.kind === 'direct'
      ? playback.data.stream.audio
      : playback.loading && held && held.aid === id
        ? held.d.audio
        : null
  const streamSid =
    playback.data?.serverId ??
    (playback.loading && held && held.aid === id ? held.sid : null)
  const requestedFailed = Boolean(playback.data?.kind === 'direct' && playback.data.requestedFailed)

  const origTrackPattern =
    origAudio.language === 'Chinese'
      ? /\b(zh|chi|zho|cmn|yue)\b|chinese|mandarin|cantonese|putonghua|native|orig|\bsub\b/i
      : origAudio.language === 'Korean'
        ? /\b(ko|kor)\b|korean|native|orig|\bsub\b/i
        : /\b(ja|jpn|jp)\b|japanese|jap|native|orig|\bsub\b|nihongo/i

  const trackHasSub = aud.tracks.some((t) => origTrackPattern.test(`${t.label} ${t.lang}`))
  const trackHasDub = aud.tracks.some((t) => {
    const s = `${t.label} ${t.lang}`
    if (origTrackPattern.test(s)) return false
    return (
      /\b(en|eng|hi|hin|ta|tam|te|tel|ml|mal|kn|kan|bn|ben|ja|jpn|jp)\b|english|hindi|tamil|telugu|malayalam|kannada|bengali|japanese|dub/i.test(
        s,
      ) || aud.tracks.length > 1
    )
  })
  const acdnSingleUnlabeledDub =
    streamSid === 'acdn' &&
    !playback.loading &&
    audio === 'dub' &&
    (aud.tracks.length === 0 || (aud.tracks.length === 1 && !trackHasSub))
  const acdnSingleUnlabeledSub =
    streamSid === 'acdn' &&
    !playback.loading &&
    audio === 'sub' &&
    (aud.tracks.length === 0 || (aud.tracks.length === 1 && !trackHasDub))
  const availReady = !avail.loading && avail.data != null
  const dubFailed = audio === 'dub' && requestedFailed
  const subFailed = audio === 'sub' && requestedFailed

  const acdnLoadingTracks = streamSid === 'acdn' && aud.tracks.length === 0
  const hasDub =
    !dubFailed &&
    (streamAudio === 'dub' ||
      streamAudio === 'multi' ||
      trackHasDub ||
      acdnSingleUnlabeledDub ||
      (acdnLoadingTracks && Boolean(avail.data?.acdnDub)) ||
      (availReady && Boolean(avail.data?.nonAcdnDub)) ||
      (playback.loading && audio === 'dub'))
  const hasSub =
    !subFailed &&
    (streamAudio === 'sub' ||
      streamAudio === 'multi' ||
      trackHasSub ||
      acdnSingleUnlabeledSub ||
      (acdnLoadingTracks && Boolean(avail.data?.acdnSub)) ||
      (availReady && Boolean(avail.data?.nonAcdnSub)) ||
      !hasDub)
  const activeAudio: 'sub' | 'dub' =
    hasSub && !hasDub ? 'sub' : hasDub && !hasSub ? 'dub' : (cur?.audio ?? audio)
  const curEpInfo = eps.get(cur?.ep ?? ep)
  const expectedDurationSec = Math.max(
    (curEpInfo?.runtime ?? 0) * 60,
    (a?.duration ?? 0) * 60,
    (bundle?.tmdb?.runtime ?? 0) * 60,
    isMovie ? 0 : 1440,
  )
  const skipMatch = extraSkip.key.startsWith(`${id}:${ep}:${audio}`) ? extraSkip : null
  const { intro: effectiveIntro, recap: effectiveRecap, outro: effectiveOutro } = useMemo(() => {
    const rawIntro = (cur?.d.intro && cur.d.intro.end > 0 ? cur.d.intro : null) ?? skipMatch?.intro ?? null
    const rawOutro = (cur?.d.outro && cur.d.outro.end > 0 ? cur.d.outro : null) ?? skipMatch?.outro ?? null
    return resolveBestSkipPair({
      streamIntro: rawIntro,
      streamOutro: rawOutro,
      sources: curSkipSources,
      durationSec: videoDuration,
      expectedDurationSec,
    })
  }, [cur?.d.intro, cur?.d.outro, skipMatch?.intro, skipMatch?.outro, curSkipSources, videoDuration, expectedDurationSec])
  const serverBusy = loadKind === 'server' && playback.loading

  useEffect(() => {
    if (a) saveEpisode(id, ep)
  }, [a, id, ep])

  const curEpImage = curEpInfo?.image ?? null
  const curEpTitle = curEpInfo?.name ?? null
  const curBannerImage = tmdbImg(bundle?.tmdb?.backdrop, 'w780') ?? a?.bannerImage ?? null

  // Save episode and touch continue watching immediately so this show is instantly first
  useEffect(() => {
    if (!a) return
    touchHistory(
      { ...mediaToCard(a), bannerImage: curBannerImage, episodes: a.episodes ?? null },
      {
        ep,
        server: server.id,
        audio,
        epTitle: curEpTitle,
        epImage: curEpImage,
      },
    )
  }, [a, ep, server.id, audio, curEpTitle, curEpImage, curBannerImage])
  useEffect(() => {
    if (title) {
      document.title =
        a?.format === 'MOVIE' || bundle?.tmdb?.type === 'movie'
          ? `${title} — AnimeStream`
          : `${title} · Episode ${ep} — AnimeStream`
    }
  }, [title, ep, a?.format, bundle?.tmdb?.type])

  const activeTrack = aud.tracks.find((t) => t.i === aud.active)
  // Party host: whatever rendition is playing (picked in the player or from the panel) is broadcast to everyone
  useEffect(() => {
    if (!room?.isHost || !activeTrack) return
    room.sendAudioTrackChange({ label: activeTrack.label, lang: activeTrack.lang })
  }, [room, activeTrack?.label, activeTrack?.lang])
  // Party guest: switch to the host's rendition once this server's track list contains it
  useEffect(() => {
    if (!partyTrack || !room || room.isHost) return
    const n = (x: string) => x.trim().toLowerCase()
    const hit =
      aud.tracks.find((t) => n(t.label) === n(partyTrack.label) && n(t.lang) === n(partyTrack.lang)) ??
      aud.tracks.find((t) => partyTrack.lang && n(t.lang) === n(partyTrack.lang)) ??
      aud.tracks.find((t) => n(t.label) === n(partyTrack.label))
    if (!hit) return
    setPartyTrack(null)
    if (hit.i === aud.active) return
    applyingPartyAudio.current = true
    setAud((prev) => ({ ...prev, active: hit.i }))
    window.setTimeout(() => { applyingPartyAudio.current = false }, 800)
  }, [partyTrack, aud.tracks, aud.active, room])
  const hrefFor = (n: number) => `/watch/${id}?ep=${n}&audio=${audio}${room ? `&room=${room.roomId}` : ''}`
  // Next / prev jump over filler and recap episodes while "skip filler" is on (mixed episodes are never skipped)
  const step = (d: 1 | -1) => {
    for (let n = ep + d; n >= 1 && n <= available; n += d) {
      const k = kinds.get(n)
      if (!skipFiller || (k !== 'filler' && k !== 'recap')) return n
    }
  }
  const next = step(1)
  const prev = step(-1)
  const hasNext = next !== undefined
  const hasPrev = prev !== undefined
  const sequel = a?.relations.edges.find((e) => e.relationType === 'SEQUEL' && e.node.type === 'ANIME')

  if (anime.error) {
    return (
      <main className="grid min-h-[70svh] place-items-center px-4 pt-24">
        <ErrorState message={anime.error.message} onRetry={anime.reload} />
      </main>
    )
  }

  return (
    <main className="relative pb-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:px-6 lg:pt-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {/* Player */}
          {!sessionVerified && server.kind !== 'embed' ? (
            <Frame>
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 p-6 text-center select-none">
                <div className="relative mb-3 grid size-16 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent shadow-xl shadow-black/50">
                  <Lock className="size-8 animate-pulse" />
                </div>
                <h3 className="font-display text-lg font-bold text-foreground">Media Playback Locked</h3>
                <p className="mt-1.5 max-w-sm text-xs text-muted leading-relaxed">
                  Verification challenge in progress. Complete the challenge to unlock high-speed streaming. Embed servers below still work.
                </p>
                {shieldFailed && (
                  <button onClick={() => void getToken()} className="mt-4 rounded-full bg-white px-5 py-2 text-xs font-bold text-black active:scale-95">
                    Retry
                  </button>
                )}
              </div>
            </Frame>
          ) : !a ? (
            <Loading quiet={serverBusy} logo={logo} />
          ) : cur ? (
            <Frame>
              <CinePlayer
                key={`${server.id}:${audio}`}
                hasDub={hasDub}
                hasSub={hasSub}
                audioLoading={Boolean(playback.loading || (audio === 'dub' && avail.loading && aud.tracks.length < 2 && streamAudio !== 'dub'))}
                switching={playback.loading}
                streamUrl={cur.d.streamUrl}
                fallbackStreamUrl={cur.d.fallbackStreamUrl}
                intro={effectiveIntro}
                recap={effectiveRecap}
                outro={effectiveOutro}
                onDuration={setVideoDuration}
                title={title}
                episode={cur.ep}
                totalEpisodes={total}
                availableEpisodes={available}
                animeId={id}
                format={a.format}
                directSubtitles={cur.d.subtitles.map((s, i) => ({ id: `s${i}`, label: s.label, lang: s.label, url: s.file }))}
                originalLanguage={origAudio.language}
                audioMode={activeAudio}
                onAudio={(m) => {
                  if (playback.loading) return
                  go({ audio: m }, false)
                }}
                dubs={(() => {
                  if (playback.loading || activeAudio === 'sub') return undefined
                  if (streamSid === 'acdn' && aud.tracks.length > 1) return undefined
                  const singleTrack =
                    aud.tracks.length === 1 &&
                    aud.tracks[0]?.label &&
                    !/^(track|audio|stream|default|main)\s*#?\d*$/i.test(aud.tracks[0].label.trim())
                      ? aud.tracks[0].label.trim()
                      : ''
                  const dubLabel =
                    singleTrack ||
                    cur.d.audioLabel ||
                    (streamSid === 'megaplay' || streamSid === 'vidstream' || streamSid?.startsWith('flixcloud')
                      ? 'English (Dub)'
                      : 'Dub')
                  return [
                    ...(hasDub ? [{ id: 'dub', label: dubLabel, selected: true }] : []),
                    ...(hasSub ? [{ id: 'sub', label: origAudio.shortLabel, selected: false }] : []),
                  ]
                })()}
                onDub={(dubId) => {
                  if (playback.loading) return
                  go({ audio: dubId === 'dub' ? 'dub' : 'sub' }, false)
                }}
                onAudioTracks={(tracks, active) => setAud({ tracks, active })}

                onStreamError={() => {
                  const sid = playback.data?.serverId || server.id
                  setHeld(null)
                  setLoadKind('server')
                  setFailed((prev) => ({
                    key: epKey,
                    ids: prev.key === epKey ? (prev.ids.includes(sid) ? prev.ids : [...prev.ids, sid]) : [sid],
                  }))
                }}
                hasNextEpisode={hasNext}
                hasPrevEpisode={hasPrev}
                onNextEpisode={() => next && go({ ep: next }, false)}
                onPrevEpisode={() => prev && go({ ep: prev }, false)}
                nextEpisode={next}
                episodeKind={kinds.get(ep)}
                skipFiller={skipFiller}
                onSkipFiller={setSkipFiller}
                onSelectEpisode={(n) => go({ ep: n }, false)}
                onPlay={() =>
                  touchHistory(
                    { ...mediaToCard(a), bannerImage: curBannerImage, episodes: a.episodes ?? null },
                    {
                      ep: cur.ep,
                      server: server.id,
                      audio,
                      epTitle: curEpTitle,
                      epImage: curEpImage,
                    },
                  )
                }
                onProgress={(pos, dur) =>
                  touchHistory(
                    { ...mediaToCard(a), bannerImage: curBannerImage, episodes: a.episodes ?? null },
                    {
                      ep: cur.ep,
                      server: server.id,
                      audio,
                      pos,
                      dur,
                      epTitle: curEpTitle,
                      epImage: curEpImage,
                    },
                  )
                }
                onEnded={() => {
                  finishEpisode({ ...mediaToCard(a), bannerImage: curBannerImage, episodes: a.episodes ?? null }, ep, hasNext)
                  if (autoNext && next) go({ ep: next }, false)
                }}
                autoNext={autoNext}
                autoSkip={autoSkip}
                episodesInfo={eps}
                fallbackImg={a.bannerImage ?? a.coverImage.extraLarge}
                defaultRuntime={a.duration}
                kinds={kinds}
                onVideoRef={(v) => { videoElRef.current = v }}
                onPlayerAction={handlePlayerAction}
                externalControl={externalControl}
                onWatchTogetherClick={() => setWatchModalOpen(true)}
                watchPartyActive={Boolean(room)}
                watchPartyPeersCount={peers.length}
                isPartyGuest={Boolean(room && !room.isHost)}
                watchedEps={watchedEps}
              />
              <LiveReactionsOverlay reactions={reactions} syncNotice={syncNotice} enabled={!hideEmojiOverlay} />
            </Frame>
          ) : playback.loading ? (
            <Loading quiet={serverBusy} logo={logo} />
          ) : playback.error || !playback.data || playback.data.kind !== 'embed' ? (
            <Problem
              message={playback.error?.message ?? 'This episode is currently unavailable.'}
              onReconnect={() => {
                setFailed({ key: epKey, ids: [] })
                playback.reload()
              }}
            >
              <button
                onClick={() => {
                  setFailed({ key: epKey, ids: [] })
                  playback.reload()
                }}
                className={cn(pill, 'border-transparent bg-white text-black')}
              >
                Retry
              </button>
              <button
                onClick={() => {
                  setFailed({ key: epKey, ids: [] })
                  go({ audio: audio === 'dub' ? 'sub' : 'dub' }, false)
                }}
                className={cn(pill, 'border-white/25 bg-white/10 text-white hover:bg-white/20')}
              >
                Try {audio === 'dub' ? 'SUB' : 'DUB'}
              </button>
            </Problem>
          ) : (
            <Frame>
              <iframe
                key={playback.data.embedUrl}
                src={playback.data.embedUrl}
                title={title}
                referrerPolicy="origin"
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope; clipboard-write; web-share; presentation"
                allowFullScreen
                className="absolute inset-0 size-full border-0"
              />
              {playback.data.serverId === 'animesalt-1' && (
                <button
                  type="button"
                  onClick={() => {
                    setLoadKind('server')
                    setFailed((prev) => ({
                      key: epKey,
                      ids: prev.key === epKey ? (prev.ids.includes('animesalt-1') ? prev.ids : [...prev.ids, 'animesalt-1']) : ['animesalt-1'],
                    }))
                  }}
                  className="absolute right-3 top-3 z-20 rounded-full border border-white/20 bg-black/85 px-3 py-1.5 text-[11px] font-bold text-white/90 transition hover:border-accent hover:text-white active:scale-95"
                >
                  Not working? Try Server 2
                </button>
              )}
            </Frame>
          )}



          {/* Title + prev / next */}
          <div className="mt-5 flex flex-wrap items-start justify-between gap-4 px-3 sm:px-6 lg:px-0">
            <div className="min-w-0">
              {a ? (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Link
                      to={`/anime/${id}`}
                      className="group inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-card/80 px-3 py-1.5 text-xs font-bold text-foreground shadow-sm transition-all hover:border-accent hover:bg-card-2 hover:text-accent active:scale-95"
                      title={`View details for ${title}`}
                    >
                      <ChevronLeft className="size-3.5 text-accent transition-transform group-hover:-translate-x-0.5" />
                      <span>Details</span>
                    </Link>
                    {isAnimeWatched && <WatchedBadge variant="pill" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Link to={`/anime/${id}`} className="font-display text-2xl font-bold tracking-tight hover:underline sm:text-3xl">
                      {title}
                    </Link>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {a.format === 'MOVIE' || bundle?.tmdb?.type === 'movie'
                      ? [
                          eps.get(ep)?.name && eps.get(ep)?.name !== title ? eps.get(ep)?.name : null,
                          formatLabel(a.format),
                          formatStatus(a.status),
                          bundle?.tmdb?.certification,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : [
                          `Episode ${ep}${eps.get(ep)?.name ? ` · ${eps.get(ep)?.name}` : ''}`,
                          formatLabel(a.format),
                          formatStatus(a.status),
                          bundle?.tmdb?.certification,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </p>
                  {bundle?.tmdb?.tagline && <p className="mt-1 text-sm italic text-muted">“{bundle.tmdb.tagline}”</p>}
                </>
              ) : (
                <Skeleton className="h-9 w-72" />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setWatchModalOpen(true)}
                className={cn(
                  pill,
                  'inline-flex items-center gap-2',
                  room
                    ? 'border-accent/50 bg-accent/15 text-foreground'
                    : 'border-border bg-card/80 hover:border-accent',
                )}
              >
                <Users className="size-4 text-accent" />
                <span>{room ? `Party (${peers.length})` : 'Watch Together'}</span>
                {room && <span className="size-1.5 rounded-full bg-emerald-400" />}
              </button>
              {a && (
                <button
                  type="button"
                  onClick={() => {
                    const epName = eps.get(ep)?.name
                    const hasCustomEpName = Boolean(epName && epName !== `Episode ${ep}` && epName !== title)
                    const shareParams = new URLSearchParams({ ep: String(ep), audio: activeAudio })
                    if (room) shareParams.set('room', room.roomId)
                    const epUrl = `${window.location.origin}/watch/${a.id}?${shareParams.toString()}`
                    shareMedia({
                      url: epUrl,
                      title: isMovie
                        ? title
                        : `${title} — Episode ${ep}${hasCustomEpName ? `: ${epName}` : ''}`,
                      image: curEpImage ?? a.bannerImage ?? a.coverImage.extraLarge,
                      poster: a.coverImage.extraLarge,
                      label: isMovie
                        ? 'Watch movie free on AnimeStream'
                        : `Watch Episode ${ep} free on AnimeStream`,
                      subtitle: isMovie
                        ? [a.format ? formatLabel(a.format) : 'Movie', activeAudio.toUpperCase(), a.seasonYear ?? ''].filter(Boolean).join(' · ')
                        : [`Episode ${ep}`, hasCustomEpName ? epName : '', activeAudio.toUpperCase()].filter(Boolean).join(' · '),
                    })
                  }}
                  className={cn(pill, 'inline-flex items-center gap-2 border-border bg-card/80 hover:border-accent hover:text-accent')}
                >
                  <Share2 className="size-4" />
                  <span>Share</span>
                </button>
              )}
              <button
                type="button"
                disabled={!hasPrev || Boolean(room && !room.isHost)}
                onClick={() => prev && go({ ep: prev }, false)}
                title={room && !room.isHost ? 'Only party host can change episodes' : 'Previous episode'}
                className={cn(
                  pill,
                  'inline-flex items-center gap-1.5 border-border bg-card/60 disabled:opacity-35',
                  room && !room.isHost && 'cursor-not-allowed',
                )}
              >
                <ChevronLeft className="size-4" /> Prev
              </button>
              <button
                type="button"
                disabled={!hasNext || Boolean(room && !room.isHost)}
                onClick={() => next && go({ ep: next }, false)}
                title={room && !room.isHost ? 'Only party host can change episodes' : 'Next episode'}
                className={cn(
                  pill,
                  'inline-flex items-center gap-1.5 border-transparent bg-foreground text-background disabled:opacity-35',
                  room && !room.isHost && 'cursor-not-allowed',
                )}
              >
                Next <ChevronRight className="size-4" />
              </button>
            </div>
          </div>

          {/* 12-Server Selector Card: Custom Dropdowns for SUB, DUB, and MULTI AUDIO */}
          {(() => {
            const subSlots = WATCH_SERVER_SLOTS.filter((s) => s.category === 'sub')
            const dubSlots = WATCH_SERVER_SLOTS.filter((s) => s.category === 'dub')
            const multiSlots = WATCH_SERVER_SLOTS.filter((s) => s.category === 'multi')
            const hasConfirmedPlayback = Boolean(a && !playback.loading && playback.data)
            const isSwitchingServer = Boolean(a && playback.loading && loadKind === 'server' && preferredServer)
            const isResolvingServer = !a || (!hasConfirmedPlayback && !playback.error && !isSwitchingServer)
            const currentSid = playback.loading
              ? (isSwitchingServer && preferredServer ? preferredServer : '')
              : (hasConfirmedPlayback ? (streamSid || server.id) : '')
            const activeSlotKey = currentSid ? resolveActiveSlotKey(currentSid, activeAudio) : ''
            const activeSlot = activeSlotKey ? WATCH_SERVER_SLOTS.find((s) => s.key === activeSlotKey) : undefined
            const activeCatLabel =
              activeSlot?.category === 'multi'
                ? 'MULTI AUDIO'
                : activeSlot?.category === 'sub'
                  ? 'SUB'
                  : 'DUB'
            const handleSelectSlot = (slot: (typeof WATCH_SERVER_SLOTS)[number]) => {
              if (room && !room.isHost && slot.audio !== audio) {
                toast('Only the party host can change party audio track', 'info')
                return
              }
              setFailed((prev) => ({
                key: epKey,
                ids: prev.key === epKey ? prev.ids.filter((x) => x !== slot.serverId) : [],
              }))
              setLoadKind('server')
              setResolvedServerId(slot.serverId)
              go({ server: slot.serverId, audio: slot.audio }, false)
            }
            return (
              <section
                aria-label="Stream servers"
                className="mt-5 mx-3 sm:mx-6 lg:mx-0 overflow-hidden rounded-3xl border border-white/10 bg-black shadow-lg"
              >
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/10 bg-black px-4 py-3 sm:px-5">
                  <p className="text-xs leading-relaxed text-muted sm:text-[13px]">
                    You&apos;re watching{' '}
                    <span className="font-bold text-foreground">
                      {isMovie ? 'Movie' : `Episode ${ep}`}
                    </span>
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

                {(() => {
                  const {
                    subAvailable,
                    dubAvailable,
                    multiAvailable,
                    subChecking,
                    dubChecking,
                    multiChecking,
                  } = computeServerCategoryAvailability({
                    animeLoaded: Boolean(a),
                    availLoading: avail.loading,
                    availData: avail.data,
                    playbackLoading: playback.loading,
                    playbackResolved: Boolean(playback.data),
                    hasSub,
                    hasDub,
                    streamSid,
                    currentSid,
                    activeSlotCategory: activeSlot?.category,
                    trackCount: aud.tracks?.length || 0,
                  })
                  return (
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
                  )
                })()}
              </section>
            )
          })()}

          {room ? (
            /* Watch Together Control Center & Live Chat below Player */
            <div className="mt-5 space-y-4 px-3 sm:px-6 lg:px-0">
              {/* Watch Together Control & Status Bar */}
              <div className="space-y-3 rounded-3xl border border-border bg-card/80 p-3.5 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-border bg-card-2 text-foreground">
                    <MonitorPlay className="size-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm sm:text-base font-bold text-foreground">
                        Room {room.roomId}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted">
                        <span className="size-1.5 rounded-full bg-emerald-400" />
                        Synced
                      </span>
                    </div>
                    <p className="text-[11px] text-muted">
                      {peers.length} {peers.length === 1 ? 'peer' : 'peers'} · {room.isHost ? 'You are Host' : 'Guest (Playback synced)'}
                    </p>
                    {activeTrack && (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted">
                        <Languages className="size-3" /> Audio: <span className="font-semibold text-foreground">{activeTrack.label}</span>
                        {!room.isHost && ' (set by host)'}
                      </p>
                    )}
                  </div>
                </div>
                  <button
                    type="button"
                    onClick={handleLeaveRoom}
                    title="Leave Watch Party"
                    aria-label="Leave Watch Party"
                    className="grid size-9 shrink-0 place-items-center rounded-full border border-border text-muted transition hover:border-rose-500/40 hover:text-rose-400 active:scale-90"
                  >
                    <LogOut className="size-4" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {/* Voice Chat Mic Toggle */}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!room) return
                      let preacquired: MediaStream | undefined
                      if (!isMicActive) {
                        try {
                          preacquired = await requestMicrophoneStream()
                        } catch (err: any) {
                          const msg = err?.message || ''
                          if (msg.includes('HTTPS')) {
                            toast(msg, 'error')
                            return
                          }
                          const isDenied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
                          toast(
                            isDenied
                              ? 'Microphone permission denied. Allow microphone in browser settings to speak.'
                              : 'Could not access microphone. Ensure microphone is connected.',
                            'error'
                          )
                          return
                        }
                      }
                      try {
                        const active = await room.toggleMic(preacquired)
                        setIsMicActive(active)
                        toast(active ? 'Microphone on - speaking to room' : 'Microphone muted', active ? 'success' : 'info')
                      } catch {
                        setIsMicActive(false)
                      }
                    }}
                    title={isMicActive ? 'Mute Microphone' : 'Enable Microphone'}
                    className={cn(
                      'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition active:scale-95',
                      isMicActive
                        ? 'border-transparent bg-foreground text-background'
                        : 'border-border bg-card-2 text-muted hover:text-foreground hover:border-accent'
                    )}
                  >
                    {isMicActive ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
                    <span>{isMicActive ? 'Mic On' : 'Mic Off'}</span>
                  </button>

                  {/* Copy Invite Link */}
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card-2 px-3 text-xs font-semibold text-foreground transition hover:border-accent active:scale-95"
                  >
                    {copiedInvite ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                    <span>{copiedInvite ? 'Copied' : 'Invite'}</span>
                  </button>

                  {/* Emoji Overlay On/Off Toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      const next = !hideEmojiOverlay
                      setHideEmojiOverlay(next)
                      toast(next ? 'Reactions overlay hidden' : 'Reactions overlay visible', 'info')
                    }}
                    title={hideEmojiOverlay ? 'Show floating emoji reactions' : 'Hide floating emoji reactions'}
                    className={cn(
                      'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card-2 px-3 text-xs font-semibold transition active:scale-95',
                      hideEmojiOverlay ? 'text-muted' : 'text-foreground'
                    )}
                  >
                    {hideEmojiOverlay ? <EyeOff className="size-3.5" /> : <Smile className="size-3.5" />}
                    <span>{hideEmojiOverlay ? 'Emoji off' : 'Emoji'}</span>
                  </button>

                  {/* Host Controls: Change Show & Control Mode */}
                  {room.isHost && (
                    <>
                      <button
                        type="button"
                        onClick={() => setChangeShowOpen(true)}
                        className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card-2 px-3 text-xs font-semibold text-foreground transition hover:border-accent active:scale-95"
                      >
                        <Film className="size-3.5" />
                        <span>Change Show</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const nextMode = !room.hostOnlyControl
                          room.setHostOnlyControl(nextMode)
                          setControlModeKey((k) => k + 1)
                          toast(nextMode ? 'Playback Control: Host Only' : 'Playback Control: Free for All', 'info')
                        }}
                        title="Toggle playback control permission"
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card-2 px-3 text-xs font-semibold text-muted transition hover:text-foreground active:scale-95"
                      >
                        {room.hostOnlyControl ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
                        <span>{room.hostOnlyControl ? 'Host Only' : 'Free Mode'}</span>
                      </button>
                    </>
                  )}

                </div>
              </div>

              {/* Connected Members & Voice Mute Strip */}
              {peers.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/50 bg-card-2/40 px-3 py-2 ">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Members ({peers.length}):
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {peers.map((p) => {
                      const isSelf = p.peerId === room.peerId
                      return (
                        <div
                          key={p.peerId}
                          className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-card/90 px-2.5 py-1 text-xs shadow-sm"
                        >
                          <div className="relative">
                            <Avatar size={20} name={p.displayName} src={p.avatar} />
                            {p.isMicActive && (
                              <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-emerald-400 ring-1 ring-card" />
                            )}
                          </div>
                          <StyledDisplayName
                            name={p.displayName}
                            styleSpec={p.nameStyle}
                            userId={p.userId}
                            isSelf={isSelf}
                            className="font-semibold text-foreground text-[11px] max-w-[100px] truncate"
                          />
                          {p.userId && p.username && (
                            <span className="font-mono text-[9px] text-muted truncate max-w-[70px]">
                              @{p.username}
                            </span>
                          )}
                          {isSelf && (
                            <span className="rounded border border-border px-1 text-[9px] font-semibold text-muted">
                              You
                            </span>
                          )}
                          {p.isHost && (
                            <Crown className="size-2.5 text-foreground shrink-0" />
                          )}

                          {/* Speaking / Muted indicator */}
                          {p.isMicActive ? (
                            <Mic className="size-2.5 text-foreground shrink-0" />
                          ) : (
                            <MicOff className="size-2.5 text-muted/60 shrink-0" />
                          )}

                          {/* Local Mute/Unmute toggle for other peers */}
                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() => {
                                const isMuted = room.toggleMutePeer(p.peerId)
                                toast(isMuted ? `Muted @${p.username} locally` : `Unmuted @${p.username}`, 'info')
                              }}
                              title={p.isLocallyMuted ? `Unmute @${p.username}` : `Mute @${p.username} for you`}
                              className={cn(
                                'ml-0.5 grid size-5 place-items-center rounded-lg border transition active:scale-90',
                                p.isLocallyMuted
                                  ? 'border-rose-500/40 bg-rose-500/20 text-rose-400'
                                  : 'border-border/60 bg-card-2 text-muted hover:text-foreground'
                              )}
                            >
                              {p.isLocallyMuted ? <VolumeX className="size-2.5" /> : <Volume2 className="size-2.5" />}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* For Host: Switch between Live Chat and Episode selector tabs */}
              {room.isHost && (
                <div className="flex gap-2 border-b border-border/60 pb-2">
                  <button
                    type="button"
                    onClick={() => setHostTab('chat')}
                    className={cn(
                      'flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-bold transition active:scale-95',
                      hostTab === 'chat'
                        ? 'bg-foreground text-background'
                        : 'bg-card-2 border border-border text-muted hover:text-foreground'
                    )}
                  >
                    <MessageSquare className="size-3.5" />
                    <span>Live Party Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setHostTab('episodes')}
                    className={cn(
                      'flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-bold transition active:scale-95',
                      hostTab === 'episodes'
                        ? 'bg-foreground text-background'
                        : 'bg-card-2 border border-border text-muted hover:text-foreground'
                    )}
                  >
                    <List className="size-3.5" />
                    <span>Episodes ({available})</span>
                  </button>
                </div>
              )}

              {/* Chat View (always open for guests; for host, shown when hostTab === 'chat') */}
              {(!room.isHost || hostTab === 'chat') && (
                <div className="overflow-hidden rounded-3xl border border-border bg-card p-3 sm:p-4 shadow-xl">
                  {/* Chat messages stream */}
                  <div ref={chatListRef} className="h-64 sm:h-72 overflow-y-auto space-y-2 p-2.5 overscroll-contain rounded-2xl bg-card-2/60 border border-border/40">
                    {chatMessages.length === 0 ? (
                      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                        <div className="grid size-11 place-items-center rounded-2xl bg-card text-muted shadow-sm">
                          <MessageSquare className="size-5 text-accent" />
                        </div>
                        <p className="mt-2 text-xs font-bold text-foreground">Room Chat is Live</p>
                        <p className="text-[11px] text-muted max-w-xs leading-relaxed mt-0.5">
                          Messages and reactions stay in sync with everyone watching right now!
                        </p>
                      </div>
                    ) : (
                      chatMessages.map((msg) => {
                        const isSelfMsg = msg.senderId === room.peerId
                        return (
                          <div key={msg.id} className="flex items-start gap-2.5">
                            <Avatar size={28} name={msg.senderName} src={msg.avatar} />
                            <div className="min-w-0 max-w-[85%] rounded-2xl bg-card px-3 py-1.5 border border-border/60 shadow-sm">
                              <div className="flex items-center justify-between gap-3">
                                <span className="flex items-center gap-1 font-bold text-[11px] text-muted truncate">
                                  <StyledDisplayName
                                    name={msg.senderName}
                                    styleSpec={msg.senderNameStyle}
                                    isSelf={isSelfMsg}
                                    className="truncate"
                                  />
                                  {msg.senderUsername && (
                                    <span className="font-mono text-[10px] font-normal text-muted/80">@{msg.senderUsername}</span>
                                  )}
                                  {isSelfMsg && (
                                    <span className="text-[10px] font-bold text-accent">(You)</span>
                                  )}
                                </span>
                                <span className="text-[9px] text-muted shrink-0">
                                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-xs text-foreground break-words mt-0.5">{msg.text}</p>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>

                  {/* Compact Mobile Reaction Emojis Palette */}
                  <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
                    {EMOJI_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          if (room) {
                            const r = room.sendReaction(emoji, userProfile.displayName, userProfile.avatar)
                            setReactions((prev) => [...prev.slice(-30), r])
                          }
                        }}
                        className="grid size-8 shrink-0 place-items-center rounded-xl bg-card-2 hover:bg-accent/20 text-base transition active:scale-125"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>

                  {/* Chat message input form */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!inlineChatText.trim() || !room) return
                      const msg = room.sendChat(inlineChatText, userProfile)
                      setChatMessages((prev) => [...prev.slice(-80), msg])
                      setInlineChatText('')
                    }}
                    className="mt-2 flex gap-2"
                  >
                    <input
                      type="text"
                      value={inlineChatText}
                      onChange={(e) => setInlineChatText(e.target.value)}
                      placeholder="Chat with watch party…"
                      className="h-10 flex-1 rounded-xl border border-border bg-card-2 px-3.5 text-xs text-foreground outline-none transition focus-visible:border-accent"
                    />
                    <button
                      type="submit"
                      disabled={!inlineChatText.trim()}
                      className="flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-bold text-accent-fg transition hover:brightness-110 active:scale-95 disabled:opacity-40 shadow-sm"
                    >
                      <Send className="size-3.5" />
                      <span className="hidden sm:inline">Send</span>
                    </button>
                  </form>
                </div>
              )}

              {/* Host Episodes View (when hostTab === 'episodes') */}
              {room.isHost && hostTab === 'episodes' && a && available > 0 && (
                <section data-tour="w-eps" className="mt-4" aria-label="Episodes">
                  <div className="mb-3 rounded-2xl border border-accent/30 bg-accent/10 p-3 text-xs text-accent font-semibold flex items-center gap-2">
                    <Crown className="size-4 shrink-0 text-foreground" />
                    <span>Host Control: Selecting an episode immediately syncs it for all peers in this party.</span>
                  </div>
                  <EpisodeList
                    total={total}
                    available={available}
                    current={ep}
                    hrefFor={hrefFor}
                    onPick={(n) => go({ ep: n }, false)}
                    info={eps}
                    kinds={kinds}
                    watchedEps={watchedEps}
                    loading={episodesLoading}
                    fallbackImg={a.bannerImage ?? a.coverImage.extraLarge}
                    defaultRuntime={a.duration}
                  />
                </section>
              )}
            </div>
          ) : (
            <>
              {/* Episodes */}
              {a && available > 0 && (
                <section data-tour="w-eps" className="mt-8 px-3 sm:px-6 lg:px-0" aria-label="Episodes">
                  <EpisodeList total={total} available={available} current={ep} hrefFor={hrefFor} onPick={() => setLoadKind('episode')} info={eps} kinds={kinds} watchedEps={watchedEps} loading={episodesLoading} fallbackImg={a.bannerImage ?? a.coverImage.extraLarge} defaultRuntime={a.duration} />
                </section>
              )}
            </>
          )}
        </div>

        {/* Side card */}
        <aside className="space-y-4 px-3 sm:px-6 lg:px-0 xl:sticky xl:top-24 xl:self-start">
          {a ? (
            <div className="overflow-hidden rounded-3xl border border-border bg-card/60">
              <div className="flex gap-4 p-4">
                <img src={a.coverImage.large ?? ''} alt="" className="aspect-[2/3] w-24 shrink-0 rounded-2xl object-cover" />
                <div className="min-w-0">
                  <p className="line-clamp-2 font-semibold leading-snug">{title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {[
                      a.seasonYear,
                      a.episodes ? `${a.episodes} eps` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.genres.slice(0, 3).map((g) => (
                      <span key={g} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="line-clamp-6 px-4 text-sm leading-relaxed text-muted">{stripHtml(a.description)}</p>

              <div className="flex flex-wrap gap-2 p-4">
                <ListButton item={mediaToCard(a)} className={pill} />
                <Link to={`/anime/${id}`} className={cn(pill, 'inline-flex items-center gap-2 border-border/80 bg-card/80 hover:bg-foreground hover:text-background active:scale-95')}>
                  <Info className="size-4 text-accent" /> Details
                </Link>
                {!isMovie && sequel && (
                  <Link to={`/watch/${sequel.node.id}`} className={cn(pill, 'border-transparent bg-accent text-accent-fg')}>
                    Next season →
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className={cn(pill, 'inline-flex items-center gap-1.5 border-border bg-card hover:border-rose-500/40 hover:text-rose-400')}
                >
                  <Flag className="size-3.5" /> Report Issue
                </button>
              </div>
            </div>
          ) : (
            <Skeleton className="h-64 w-full rounded-3xl" />
          )}

          {/* Official Streams & Creator Support */}
          {bundle?.tmdb?.watchProviders?.providers && bundle.tmdb.watchProviders.providers.length > 0 && (
            <div className="overflow-hidden rounded-3xl border border-border bg-card/60 p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-emerald-400" />
                  <span className="font-semibold text-xs uppercase tracking-wider text-muted">Official Places to Watch</span>
                </div>
                {bundle.tmdb.watchProviders.link && (
                  <a
                    href={bundle.tmdb.watchProviders.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-muted hover:text-foreground"
                  >
                    <span>JustWatch</span>
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <p className="text-xs text-muted mb-3 leading-relaxed">
                We recommend watching on official licensed platforms to support the studios and animators.
              </p>
              <div className="flex flex-wrap gap-2">
                {bundle.tmdb.watchProviders.providers.map((p) => (
                  <a
                    key={p.id}
                    href={bundle.tmdb?.watchProviders?.link || `https://www.google.com/search?q=watch+${encodeURIComponent(title)}+on+${encodeURIComponent(p.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card-2/80 px-2.5 py-1.5 text-xs font-medium transition hover:border-foreground/30 active:scale-95"
                  >
                    {p.logo && (
                      <img
                        src={p.logo}
                        alt={p.name}
                        className="size-4 rounded object-cover shadow-sm"
                        onError={(e) => { (e.target as HTMLElement).style.display = 'none' }}
                      />
                    )}
                    <span>{p.name}</span>
                    <ExternalLink className="size-2.5 text-muted" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
      {/* Report Modal */}
      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-in fade-in">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="flex items-center gap-2">
                <Flag className="size-4 text-rose-500" />
                <h3 className="font-display font-bold">Report Stream Issue</h3>
              </div>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="grid size-8 place-items-center rounded-full hover:bg-card-2 text-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                setReportSubmitting(true)
                const res = await submitStreamReport({
                  anime_id: id ? String(id) : undefined,
                  anime_title: title || 'Unknown Anime',
                  episode: String(ep),
                  server: getMaskedServerLabel(server.id, activeAudio),
                  audio_type: audio,
                  issue_type: reportIssue,
                  details: reportDetails.trim() || undefined,
                })
                setReportSubmitting(false)
                if (res.success) {
                  toast('Report submitted successfully! Thank you.', 'info')
                  setReportDetails('')
                  setReportOpen(false)
                } else {
                  toast(res.error || 'Failed to submit report', 'error')
                }
              }}
              className="p-4 space-y-4"
            >
              <div>
                <p className="text-xs text-muted mb-2">
                  Reporting <span className="font-semibold text-foreground">{title}</span> · Ep {ep} ({getMaskedServerLabel(server.id, activeAudio)}, {audio.toUpperCase()})
                </p>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-2">Issue Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {["Broken / Won't Play", 'Buffering / Slow', 'Wrong Audio / Subs Out of Sync', 'Incorrect Episode', 'Other'].map((t) => (
                    <button
                      type="button"
                      key={t}
                      onClick={() => setReportIssue(t)}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-left text-xs font-medium transition',
                        reportIssue === t ? 'border-accent bg-accent/15 text-accent font-semibold' : 'border-border bg-card-2/50 text-muted hover:text-foreground'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">Optional Details</label>
                <textarea
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Describe playback timestamp or error (optional)..."
                  rows={3}
                  className="w-full rounded-2xl border border-border bg-background/60 p-3 text-xs outline-none focus:border-accent"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReportOpen(false)}
                  className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reportSubmitting}
                  className="rounded-full bg-accent px-5 py-2 text-xs font-semibold text-accent-fg transition hover:opacity-90 disabled:opacity-50"
                >
                  {reportSubmitting ? 'Submitting...' : 'Send Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <WatchTogetherModal
        open={watchModalOpen}
        onClose={() => setWatchModalOpen(false)}
        room={room}
        peers={peers}
        onSendReaction={(em) => {
          if (!room) return
          const r = room.sendReaction(em, userProfile.displayName, userProfile.avatar)
          setReactions((prev) => [...prev.slice(-30), r])
        }}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        onLeaveRoom={handleLeaveRoom}
        onForceSync={handleForceSync}
        animeTitle={title}
        animeId={id}
        image={a ? (a.bannerImage ?? a.coverImage.extraLarge) : null}
        episode={ep}
        isHost={room ? room.isHost : false}
        connectionStatus={connectionStatus}
        onChangeShowClick={() => setChangeShowOpen(true)}
      />
      <ChangeShowModal
        open={changeShowOpen}
        onClose={() => setChangeShowOpen(false)}
        onSelectShow={handleChangeShow}
        currentAnimeId={id}
      />
    </main>
  )
}
