export interface EmbedCtx {
  anilistId: number
  malId: number | null
  tmdb: { id: number; type: 'tv' | 'movie'; season: number | null } | null
  episode: number
  audio: 'sub' | 'dub'
  isMovie: boolean
}

/** direct = plays through AnimeStream proxy/CDN directly */
export type ServerAccess = 'direct' | 'both'

export const ACCESS_TEXT: Record<ServerAccess, string> = {
  both: 'Direct',
  direct: 'Direct',
}

/** badge colours, shared by the watch page and the player menu */
export const ACCESS_CLASS: Record<ServerAccess, string> = {
  both: 'text-emerald-300',
  direct: 'text-sky-300',
}

export interface ServerDef {
  id: string
  name: string
  note: string
  /** stream access mode */
  access?: ServerAccess
  /** direct = our HLS player, embed = iframe, animesalt = iframe resolved by the API (multi audio) */
  kind: 'direct' | 'embed' | 'animesalt'
  /** audio can be switched sub/dub for this server */
  audio: boolean
  /** one stream carrying several audio tracks, picked inside the player (shows the "Multi audio" tag) */
  multi?: boolean
  salt?: '1' | '2'
  /** iframe url, or null when the ids this server needs aren't known */
  url?: (c: EmbedCtx) => string | null
}

const tv = (c: EmbedCtx, movie: (id: number) => string, show: (id: number, s: number) => string) => {
  if (!c.tmdb) return null
  return c.isMovie || c.tmdb.type === 'movie' ? movie(c.tmdb.id) : show(c.tmdb.id, c.tmdb.season ?? 1)
}

export const SERVERS: ServerDef[] = [
  { id: 'megaplay', name: 'MegaPlay', note: 'Direct HLS · Sub / Dub', access: 'both', kind: 'direct', audio: true },
  { id: 'vidstream', name: 'Vidstream', note: 'Direct HLS · Sub / Dub', access: 'both', kind: 'direct', audio: true },
  { id: 'flixcloud', name: 'FlixCloud', note: 'Direct HLS · Sub / Dub', access: 'direct', kind: 'direct', audio: true },
  { id: 'anikoto', name: 'Anikoto', note: 'Direct HLS · English Dub / Sub', access: 'direct', kind: 'direct', audio: true },
  { id: 'acdn', name: 'ACDN', note: 'Direct HLS · Multi audio', access: 'direct', kind: 'direct', audio: false, multi: true },
  { id: 'desidubanime', name: 'DesiDubAnime', note: 'Direct HLS · Hindi Dub', access: 'direct', kind: 'direct', audio: false, multi: false },
  { id: 'watchanimeworld', name: 'AnimeWorld', note: 'MultiCloud · Multi audio', access: 'direct', kind: 'direct', audio: false, multi: true },
  { id: 'server12', name: 'Server 12', note: 'Direct HLS · Multi audio', access: 'direct', kind: 'direct', audio: false, multi: true },
  { id: 'animesalt-1', name: 'AnimeSalt 1', note: 'Multi audio', kind: 'animesalt', audio: false, salt: '1' },
  { id: 'animesalt-2', name: 'AnimeSalt 2', note: 'Multi audio', kind: 'animesalt', audio: false, salt: '2' },
  { id: 'megaplay-ani', name: 'MegaPlay Embed', note: 'Embed · AniList · Sub / Dub', kind: 'embed', audio: true, url: (c) => `https://megaplay.buzz/stream/ani/${c.anilistId}/${c.episode}/${c.audio}` },
  { id: 'megaplay-mal', name: 'MegaPlay Embed 2', note: 'Embed · MAL · Sub / Dub', kind: 'embed', audio: true, url: (c) => (c.malId ? `https://megaplay.buzz/stream/mal/${c.malId}/${c.episode}/${c.audio}` : null) },
  { id: 'reanime', name: 'ReAnime', note: 'Embed · AniList', kind: 'embed', audio: true, url: (c) => `/api/embed/reanime?id=${c.anilistId}&ep=${c.episode}&audio=${c.audio}` },
  { id: 'zokoanime', name: 'ZokoAnime', note: 'Embed · MAL', kind: 'embed', audio: true, url: (c) => (c.malId ? `https://zokoanime.video/stream/mal/${c.malId}/${c.episode}/${c.audio}?color=dc143c` : null) },
  { id: 'tryembed', name: 'TryEmbed', note: 'Embed · MAL', kind: 'embed', audio: true, url: (c) => (c.malId ? `https://tryembed.us.cc/embed/anime/mal/${c.malId}/${c.episode}/${c.audio}?skin=silicon&autoSkip=true` : null) },
  { id: 'vidnest', name: 'Vidnest', note: 'Embed · AniList', kind: 'embed', audio: true, url: (c) => `https://vidnest.fun/anime/${c.anilistId}/${c.episode}/${c.audio}` },
  { id: 'yumezone', name: 'YumeZone', note: 'Embed · AniList', kind: 'embed', audio: true, url: (c) => `https://yumezone.qzz.io/embed/megaplay/ani/${c.anilistId}/${c.episode}/${c.audio}` },
  { id: 'vidzee', name: 'VidZee', note: 'Embed · TMDB', kind: 'embed', audio: false, url: (c) => tv(c, (i) => `https://player.vidzee.wtf/embed/movie/${i}?lang=en`, (i, s) => `https://player.vidzee.wtf/embed/tv/${i}/${s}/${c.episode}?lang=en`) },
  { id: 'vidlove', name: 'VidLove', note: 'Embed · TMDB', kind: 'embed', audio: false, url: (c) => tv(c, (i) => `https://player.vidlove.cc/embed/movie/${i}`, (i, s) => `https://player.vidlove.cc/embed/tv/${i}/${s}/${c.episode}`) },
  { id: 'vidsrc-su', name: 'VidSrc HD', note: 'Embed · TMDB · 4K', kind: 'embed', audio: false, url: (c) => tv(c, (i) => `https://vidsrc.su/embed/movie/${i}`, (i, s) => `https://vidsrc.su/embed/tv/${i}/${s}/${c.episode}`) },
  { id: 'vidsrc-to', name: 'VidSrc Stream', note: 'Embed · TMDB', kind: 'embed', audio: false, url: (c) => tv(c, (i) => `https://vidsrc.to/embed/movie/${i}`, (i, s) => `https://vidsrc.to/embed/tv/${i}/${s}/${c.episode}`) },
  { id: 'cinemaos', name: 'CinemaOS', note: 'Embed · TMDB', kind: 'embed', audio: false, url: (c) => tv(c, (i) => `https://cinemaos.tech/player/${i}?lang=en`, (i, s) => `https://cinemaos.tech/player/${i}/${s}/${c.episode}?lang=en`) },
  { id: '2embed', name: '2Embed', note: 'Embed · TMDB', kind: 'embed', audio: false, url: (c) => tv(c, (i) => `https://www.2embed.cc/embed/${i}`, (i, s) => `https://www.2embed.cc/embed/tv/${i}&s=${s}&e=${c.episode}`) },
]

export const serverById = (id: string) =>
  SERVERS.find((s) => s.id === id) ??
  (id === 'flixcloud-1' || id === 'flixcloud-2' ? SERVERS.find((s) => s.id === 'flixcloud') : undefined) ??
  (id === 'recloud' ? SERVERS.find((s) => s.id === 'reanime') : undefined) ??
  SERVERS[0]

/** Direct (Zenkai player) servers; all are offered for both SUB and DUB. */
export const DIRECT = SERVERS.filter((s) => s.kind === 'direct')

export type ServerCategory = 'sub' | 'dub' | 'multi'

export interface WatchServerSlot {
  key: string
  label: string
  serverId: string
  audio: 'sub' | 'dub'
  category: ServerCategory
}

/** 12 masked server slots grouped across SUB, DUB, and MULTI AUDIO without revealing real provider names. */
export const WATCH_SERVER_SLOTS: WatchServerSlot[] = [
  // SUB (4 servers)
  { key: 'sub:megaplay', label: 'SERVER 1', serverId: 'megaplay', audio: 'sub', category: 'sub' },
  { key: 'sub:vidstream', label: 'SERVER 2', serverId: 'vidstream', audio: 'sub', category: 'sub' },
  { key: 'sub:flixcloud', label: 'SERVER 3', serverId: 'flixcloud', audio: 'sub', category: 'sub' },
  { key: 'sub:anikoto', label: 'SERVER 4', serverId: 'anikoto', audio: 'sub', category: 'sub' },
  // DUB (4 servers)
  { key: 'dub:anikoto', label: 'SERVER 5', serverId: 'anikoto', audio: 'dub', category: 'dub' },
  { key: 'dub:desidubanime', label: 'SERVER 6', serverId: 'desidubanime', audio: 'dub', category: 'dub' },
  { key: 'dub:megaplay', label: 'SERVER 7', serverId: 'megaplay', audio: 'dub', category: 'dub' },
  { key: 'dub:flixcloud', label: 'SERVER 8', serverId: 'flixcloud', audio: 'dub', category: 'dub' },
  // MULTI AUDIO (4 servers)
  { key: 'multi:acdn', label: 'SERVER 9', serverId: 'acdn', audio: 'dub', category: 'multi' },
  { key: 'multi:watchanimeworld', label: 'SERVER 10', serverId: 'watchanimeworld', audio: 'dub', category: 'multi' },
  { key: 'multi:animesalt-1', label: 'SERVER 11', serverId: 'animesalt-1', audio: 'dub', category: 'multi' },
  { key: 'multi:server12', label: 'SERVER 12', serverId: 'server12', audio: 'dub', category: 'multi' },
]

export function resolveActiveSlotKey(serverId: string, audio: 'sub' | 'dub'): string {
  const sid = (serverId || '').toLowerCase()
  const exact = WATCH_SERVER_SLOTS.find((s) => s.serverId === sid && s.audio === audio)
  if (exact) return exact.key
  if (sid === 'vidstream' && audio === 'dub') return 'dub:megaplay'
  if (sid.startsWith('animesalt')) return 'multi:animesalt-1'
  const byServer = WATCH_SERVER_SLOTS.find((s) => s.serverId === sid)
  if (byServer) return byServer.key
  return audio === 'dub' ? 'dub:flixcloud' : 'sub:megaplay'
}

export function getMaskedServerLabel(serverId: string, audio: 'sub' | 'dub'): string {
  const key = resolveActiveSlotKey(serverId, audio)
  return WATCH_SERVER_SLOTS.find((s) => s.key === key)?.label ?? 'SERVER 1'
}

export interface ServerCategoryAvailabilityInput {
  animeLoaded?: boolean
  availLoading: boolean
  availData?: { sub?: boolean; dub?: boolean; hasMulti?: boolean } | null
  playbackLoading: boolean
  playbackResolved?: boolean
  hasSub: boolean
  hasDub: boolean
  streamSid?: string | null
  currentSid?: string | null
  activeSlotCategory?: ServerCategory | null
  trackCount: number
}

export interface ServerCategoryAvailability {
  subAvailable: boolean
  dubAvailable: boolean
  multiAvailable: boolean
  subChecking: boolean
  dubChecking: boolean
  multiChecking: boolean
}

export function computeServerCategoryAvailability(
  input: ServerCategoryAvailabilityInput,
): ServerCategoryAvailability {
  const animeLoaded = input.animeLoaded ?? true
  const playbackResolved = input.playbackResolved ?? !input.playbackLoading
  const availReady = Boolean(animeLoaded && !input.availLoading && input.availData != null)
  const trackCount = input.trackCount || 0
  const isDualFlixCloud =
    (input.streamSid === 'flixcloud' || input.currentSid === 'flixcloud') && trackCount <= 2

  const hasLiveMulti =
    !isDualFlixCloud &&
    (trackCount >= 3 ||
      input.streamSid === 'acdn' ||
      input.streamSid === 'watchanimeworld' ||
      input.streamSid === 'server12' ||
      Boolean(input.streamSid?.startsWith('animesalt')) ||
      (input.activeSlotCategory === 'multi' && input.streamSid !== 'flixcloud' && playbackResolved && !input.playbackLoading))

  const subConfirmedLive = Boolean(animeLoaded && !input.playbackLoading && playbackResolved && (input.hasSub || input.activeSlotCategory === 'sub'))
  const dubConfirmedLive = Boolean(animeLoaded && !input.playbackLoading && playbackResolved && (input.hasDub || input.activeSlotCategory === 'dub'))
  const multiConfirmedLive = Boolean(animeLoaded && !input.playbackLoading && playbackResolved && hasLiveMulti)

  const subChecking = !availReady && !subConfirmedLive
  const dubChecking = !availReady && !dubConfirmedLive
  const multiChecking = !availReady && !multiConfirmedLive

  const subAvailable = availReady
    ? Boolean(input.hasSub || input.availData?.sub || input.activeSlotCategory === 'sub')
    : subConfirmedLive

  const dubAvailable = availReady
    ? Boolean(input.hasDub || input.availData?.dub || input.activeSlotCategory === 'dub')
    : dubConfirmedLive

  const multiAvailable =
    !isDualFlixCloud &&
    (hasLiveMulti || Boolean(availReady && input.availData?.hasMulti))

  return {
    subAvailable,
    dubAvailable,
    multiAvailable,
    subChecking,
    dubChecking,
    multiChecking,
  }
}

