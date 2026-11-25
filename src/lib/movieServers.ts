export interface MovieStreamCandidate {
  quality: string
  streamUrl: string
  proxyStreamUrl?: string
  altProxyUrl?: string
}

export interface MovieProviderRef {
  id: string
  label: string
  tags: string[]
}

export interface MovieStreamAttempt {
  url: string
  quality: string
  kind: 'primary' | 'alt-proxy' | 'fallback-quality'
}

export const TRUSTED_MOVIE_EMBED_HOSTS: readonly string[] = [
  'player.videasy.to', 'player.vidzee.wtf', 'vidup.to', 'vidcore.net',
  'player.vidlove.cc', '1embed.cc', 'cinesrc.st', 'primesrc.me', 'cinemaos.tech',
  'www.nontongo.win', 'nontongo.win', 'vidnest.fun', 'cdn.vidspark.to', 'vidspark.to',
  'vidlink.pro', 'vidsrc.to', 'vidfast.pro', 'embed.smashystream.com', 'smashystream.com',
  'player.autoembed.cc', 'autoembed.cc', 'multiembed.mov', 'vidsrc.rip',
]

export const EXTERNAL_PLAYER_ALLOW_PERMISSIONS =
  'autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope; clipboard-write'

export const EXTERNAL_PLAYER_SANDBOX_ALLOWANCES =
  'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-top-navigation-by-user-activation'

/** Strict iframe sandbox that permits playback while blocking onclick popups, popunders, and top-level hijacks. */
export const EMBED_POPUP_BLOCKED_SANDBOX =
  'allow-same-origin allow-scripts allow-forms allow-presentation'

/**
 * Validates that an external player URL uses HTTPS and belongs to a trusted streaming embed domain.
 * Prevents arbitrary or untrusted iframe sources from being loaded with elevated permissions.
 */
export function isTrustedMovieEmbedUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false
  try {
    const parsed = new URL(rawUrl.trim())
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return TRUSTED_MOVIE_EMBED_HOSTS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  } catch {
    return false
  }
}

/**
 * Ensures any static or dynamically created external player iframe has the required permissions
 * (JavaScript execution, same-origin access, video/audio playback, fullscreen, PiP, popups/navigation)
 * and never retains a restrictive sandbox attribute without allow-same-origin.
 */
export function configureExternalPlayerIframe(
  iframe: HTMLIFrameElement,
  options?: { useSandbox?: boolean },
): void {
  if (options?.useSandbox) {
    iframe.setAttribute('sandbox', EXTERNAL_PLAYER_SANDBOX_ALLOWANCES)
  } else if (iframe.hasAttribute('sandbox')) {
    const current = iframe.getAttribute('sandbox') || ''
    if (!current.includes('allow-same-origin') || !current.includes('allow-scripts')) {
      iframe.removeAttribute('sandbox')
    }
  }
  iframe.setAttribute('allow', EXTERNAL_PLAYER_ALLOW_PERMISSIONS)
  iframe.setAttribute('allowfullscreen', 'true')
  iframe.allowFullscreen = true
  if (!iframe.getAttribute('referrerpolicy')) {
    iframe.setAttribute('referrerpolicy', 'origin')
  }
}

let cachedSandboxedHost: boolean | null = null

/**
 * Detects whether the application itself is running inside a sandboxed parent iframe
 * where descendant iframes inherit the `sandboxed document.domain browsing context flag`.
 */
export function isHostFrameSandboxed(): boolean {
  if (cachedSandboxedHost !== null) return cachedSandboxedHost
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  try {
    if (window.self === window.top) {
      cachedSandboxedHost = false
      return false
    }
  } catch {
    // Cross-origin parent frame; test document.domain assignment below
  }
  try {
    // eslint-disable-next-line no-self-assign
    document.domain = document.domain
    cachedSandboxedHost = false
    return false
  } catch (err: any) {
    const msg = String(err?.message || '')
    const isSb = err?.name === 'SecurityError' || /sandbox/i.test(msg)
    cachedSandboxedHost = isSb
    return isSb
  }
}

/**
 * Builds an ordered list of distinct playback URLs from a MovieBox response:
 * selected stream primary URL -> alt proxy mirror -> remaining quality streams & their mirrors.
 */
export function buildMovieStreamAttempts(
  streams: readonly MovieStreamCandidate[],
  preferredQuality?: string | null,
): MovieStreamAttempt[] {
  if (!streams.length) return []
  const ordered = [...streams]
  if (preferredQuality) {
    const idx = ordered.findIndex((s) => s.quality === preferredQuality)
    if (idx > 0) {
      const [picked] = ordered.splice(idx, 1)
      ordered.unshift(picked)
    }
  }

  const seen = new Set<string>()
  const out: MovieStreamAttempt[] = []
  const push = (url: string | undefined, quality: string, kind: MovieStreamAttempt['kind']) => {
    const u = url?.trim()
    if (!u || seen.has(u)) return
    seen.add(u)
    out.push({ url: u, quality, kind })
  }

  ordered.forEach((s, i) => {
    const baseUrl = s.proxyStreamUrl || s.streamUrl
    push(baseUrl, s.quality, i === 0 ? 'primary' : 'fallback-quality')
    if (s.altProxyUrl && s.altProxyUrl !== baseUrl) {
      push(s.altProxyUrl, s.quality, 'alt-proxy')
    }
    if (s.streamUrl && s.streamUrl !== baseUrl) {
      push(s.streamUrl, s.quality, 'fallback-quality')
    }
  })

  return out
}

/**
 * Sorts background embed providers so verified Multi audio (and 4K) servers are always tried before single-audio servers.
 */
export function prioritizeMovieBackupServers(providers: readonly MovieProviderRef[]): MovieProviderRef[] {
  const candidates = providers.filter((p) => p.id !== 'moviebox')
  return [...candidates].sort((a, b) => {
    const aMulti = a.tags.includes('Multi audio') ? 1 : 0
    const bMulti = b.tags.includes('Multi audio') ? 1 : 0
    if (aMulti !== bMulti) return bMulti - aMulti
    const a4k = a.tags.includes('4K') ? 1 : 0
    const b4k = b.tags.includes('4K') ? 1 : 0
    return b4k - a4k
  })
}

/**
 * Picks the next background embed server (never `moviebox`, preferring `Multi audio`) that has not failed yet.
 */
export function pickMovieBackupServer(
  providers: readonly MovieProviderRef[],
  failedIds: readonly string[],
): MovieProviderRef | null {
  const failed = new Set(failedIds)
  return prioritizeMovieBackupServers(providers).find((p) => !failed.has(p.id)) ?? null
}

/**
 * Resolves the next fallback action when MovieBox playback fails:
 * first tries remaining distinct MovieBox attempts, then switches to a background embed server.
 */
export function pickNextMovieFallback(opts: {
  attempts: readonly MovieStreamAttempt[]
  currentAttemptIdx: number
  providers: readonly MovieProviderRef[]
  failedServerIds: readonly string[]
}):
  | { action: 'retry-stream'; nextAttemptIdx: number; url: string; quality: string }
  | { action: 'switch-server'; provider: MovieProviderRef }
  | { action: 'exhausted' } {
  const nextIdx = opts.currentAttemptIdx + 1
  if (nextIdx >= 0 && nextIdx < opts.attempts.length) {
    const nextAttempt = opts.attempts[nextIdx]
    return {
      action: 'retry-stream',
      nextAttemptIdx: nextIdx,
      url: nextAttempt.url,
      quality: nextAttempt.quality,
    }
  }
  const backup = pickMovieBackupServer(opts.providers, [...opts.failedServerIds, 'moviebox'])
  if (backup) {
    return { action: 'switch-server', provider: backup }
  }
  return { action: 'exhausted' }
}

export interface WorkingMovieSource {
  kind: 'embed' | 'direct'
  providerId: string
  label: string
  url?: string
  proxyUrl?: string
  adBlocked?: boolean
  tags?: string[]
}

export interface DetectStreamResult {
  success: boolean
  source?: WorkingMovieSource
  backups?: Array<{
    kind: 'embed'
    providerId: string
    label: string
    url: string
    proxyUrl?: string
    adBlocked?: boolean
    tags?: string[]
  }>
  error?: string
}

export function buildCinemaOsFrameUrl(opts: {
  type: 'movie' | 'tv'
  tmdbId: number
  season?: number
  episode?: number
  lang?: string
}): string {
  const qs = new URLSearchParams({
    type: opts.type,
    id: String(opts.tmdbId),
    lang: opts.lang || 'en',
  })
  if (opts.type === 'tv') {
    qs.set('s', String(Math.max(1, opts.season ?? 1)))
    qs.set('e', String(Math.max(1, opts.episode ?? 1)))
  }
  return `/api/movies/cinemaos-frame?${qs.toString()}`
}

export function isPotentialAnimeTmdbMovie(opts: {
  type: 'movie' | 'tv'
  genres?: ReadonlyArray<{ id: number; name?: string }>
  genreIds?: ReadonlyArray<number>
  language?: string | null
}): boolean {
  if (opts.type !== 'movie') return false
  const hasAnimGenre =
    Boolean(opts.genres?.some((g) => g.id === 16 || /animat/i.test(g.name || ''))) ||
    Boolean(opts.genreIds?.includes(16))
  const lang = String(opts.language || '').trim().toLowerCase()
  const isAsianLang = lang === 'ja' || lang === 'zh' || lang === 'ko' || lang === 'cn'
  return hasAnimGenre || isAsianLang
}

/**
 * Pure evaluation of an embed provider's response body and status code.
 * Rejects error pages, Next.js error trees, sandbox restriction traps, Cloudflare challenge blocks, or empty responses.
 */
export function evaluateEmbedResponse(status: number, bodyText?: string | null): boolean {
  if (status !== 200) return false
  if (!bodyText || typeof bodyText !== 'string') return false
  const clean = bodyText.trim()
  if (clean.length < 100) return false
  if (clean.includes('__next_error__')) return false
  if (clean.includes('__vidora_sandbox_probe__')) return false
  if (/Restricted\s+Embed\s+Detected/i.test(clean)) return false
  if (/Please\s+Disable\s+Sandbox/i.test(clean)) return false
  if (/sandbox\.php/i.test(clean)) return false
  if (/403\s+Forbidden/i.test(clean)) return false
  if (/This\s+domain\s+is\s+for\s+sale|Buy\s+this\s+domain|domain\s+is\s+parked/i.test(clean)) return false
  if (/^File not found/i.test(clean)) return false
  if (/^Video not found/i.test(clean)) return false
  if (/<title>\s*(?:404|Not Found|Error|Attention Required|Just a moment)/i.test(clean)) return false
  return true
}

/**
 * Builds candidate embed URLs for background verification, prioritizing Multi-audio and 4K native players
 * that do not trigger sandbox restriction notices. MovieBox is excluded as it serves as the final fallback.
 */
export function buildEmbedCandidates(opts: {
  type: 'movie' | 'tv'
  tmdbId: number
  season?: number
  episode?: number
  sandboxed?: boolean
}): Array<{
  id: string
  label: string
  url: string
  tags: string[]
  sandboxSafe?: boolean
}> {
  const { type, tmdbId, season = 1, episode = 1 } = opts
  const s = Math.max(1, season)
  const e = Math.max(1, episode)
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return []
  const tv = type === 'tv'

  // Priority #1: CinemaOS embed player (ad-blocked + blur-free via same-origin frame proxy),
  // followed by reliable backup embed providers.
  const all = [
    { id: 'cinemaos', label: 'CinemaOS', url: tv ? `https://cinemaos.tech/player/${tmdbId}/${s}/${e}?lang=en` : `https://cinemaos.tech/player/${tmdbId}?lang=en`, tags: ['Multi audio'] },
    { id: 'vidzee', label: 'Vidzee', url: tv ? `https://player.vidzee.wtf/embed/tv/${tmdbId}/${s}/${e}` : `https://player.vidzee.wtf/embed/movie/${tmdbId}`, tags: ['Multi audio'] },
    { id: 'vidup', label: 'VidUp', url: tv ? `https://vidup.to/tv/${tmdbId}/${s}/${e}?server=zenith` : `https://vidup.to/movie/${tmdbId}?server=zenith`, tags: [] },
    { id: 'vidfast', label: 'VidFast', url: tv ? `https://vidfast.pro/tv/${tmdbId}/${s}/${e}` : `https://vidfast.pro/movie/${tmdbId}`, tags: ['4K'] },
    { id: 'primesrc', label: 'PrimeSrc', url: tv ? `https://primesrc.me/embed/tv?tmdb=${tmdbId}&season=${s}&episode=${e}&fallback=false&serverOrder=PrimeVid,Voe,Dood` : `https://primesrc.me/embed/movie?tmdb=${tmdbId}`, tags: [] },
    { id: 'vidsrc-to', label: 'VidSrc.to', url: tv ? `https://vidsrc.to/embed/tv/${tmdbId}/${s}/${e}` : `https://vidsrc.to/embed/movie/${tmdbId}`, tags: ['Multi audio'] },
    { id: 'vidlove', label: 'VidLove', url: tv ? `https://player.vidlove.cc/embed/tv/${tmdbId}/${s}/${e}` : `https://player.vidlove.cc/embed/movie/${tmdbId}`, tags: [] },
    { id: '1embed', label: '1Embed', url: tv ? `https://1embed.cc/embed/tv/${tmdbId}/${s}/${e}` : `https://1embed.cc/embed/movie/${tmdbId}`, tags: [] },
    { id: 'vidspark', label: 'VidSpark', url: tv ? `https://cdn.vidspark.to/tv/${tmdbId}/${s}/${e}` : `https://cdn.vidspark.to/movie/${tmdbId}`, tags: ['Multi audio', '4K'] },
    { id: 'autoembed', label: 'AutoEmbed', url: tv ? `https://player.autoembed.cc/embed/tv/${tmdbId}/${s}/${e}` : `https://player.autoembed.cc/embed/movie/${tmdbId}`, tags: ['Multi audio'] },
    { id: 'multiembed', label: 'MultiEmbed', url: tv ? `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${s}&e=${e}` : `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`, tags: ['Multi audio'] },
    { id: 'vidsrc-rip', label: 'VidSrc Rip', url: tv ? `https://vidsrc.rip/embed/tv/${tmdbId}/${s}/${e}` : `https://vidsrc.rip/embed/movie/${tmdbId}`, tags: ['4K'] },
    { id: 'videasy', label: 'Videasy', url: tv ? `https://player.videasy.to/tv/${tmdbId}/${s}/${e}?color=E50914&overlay=true&nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true` : `https://player.videasy.to/movie/${tmdbId}?color=E50914&overlay=true&nextEpisode=true`, tags: ['Multi audio', '4K'] },
    { id: 'vidcore', label: 'VidCore', url: tv ? `https://vidcore.net/tv/${tmdbId}/${s}/${e}?server=Crystal&autoPlay=true` : `https://vidcore.net/movie/${tmdbId}?server=Crystal&autoPlay=true`, tags: [] },
    { id: 'cinesrc', label: 'CineSrc', url: tv ? `https://cinesrc.st/embed/tv/${tmdbId}/${s}/${e}` : `https://cinesrc.st/embed/movie/${tmdbId}`, tags: [] },
    { id: 'vidlink', label: 'VidLink', url: tv ? `https://vidlink.pro/tv/${tmdbId}/${s}/${e}` : `https://vidlink.pro/movie/${tmdbId}`, tags: ['Multi audio', '4K'] },
    ...(tv ? [{ id: 'vidnest-tv', label: 'VidNest', url: `https://vidnest.fun/tv/${tmdbId}/${s}/${e}`, tags: [] }] : [{ id: 'nontongo', label: 'NontonGo', url: `https://www.nontongo.win/embed/movie/${tmdbId}`, tags: [] }]),
    { id: 'smashystream', label: 'SmashyStream', url: tv ? `https://embed.smashystream.com/playere.php?tmdb=${tmdbId}&season=${s}&episode=${e}` : `https://embed.smashystream.com/playere.php?tmdb=${tmdbId}`, tags: ['Multi audio', '4K'] },
  ]

  return all.filter((c) => isTrustedMovieEmbedUrl(c.url))
}

export function cleanMovieDubLabel(label?: string | null): string {
  return (
    String(label || 'Audio')
      .replace(
        /^(?:MovieBox|Vidzee|CineSrc|CinemaOS|Videasy|VidLink|VidFast|VidSrc|PrimeSrc|VidNest|NontonGo|Ophim|FlixHQ|YFlix|RogFlix|RPMVid|AllMovies)\s*(?:Direct|Pro)?\s*[·\-:]?\s*/i,
        '',
      )
      .replace(
        /\b(?:MovieBox|Vidzee|CineSrc|CinemaOS|Videasy|VidLink|VidFast|VidSrc|PrimeSrc|VidNest|NontonGo|Ophim|FlixHQ|YFlix|RogFlix|RPMVid|AllMovies|Direct)\b/gi,
        '',
      )
      .replace(/^[\s·\-:]+|[\s·\-:]+$/g, '')
      .trim() || 'Original'
  )
}

export function normalizeMovieDubLanguage(raw?: string | null): string {
  return cleanMovieDubLabel(raw)
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(?:dub|dubbed|audio|track)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isOriginalMovieDubLabel(raw?: string | null): boolean {
  const norm = normalizeMovieDubLanguage(raw)
  return !norm || norm === 'original' || norm === 'auto' || norm === 'default'
}

export function resolveRequestedDubInfo(
  dubId: string | null | undefined,
  dubs: ReadonlyArray<{ id: string; label: string }>,
): {
  cleanId: string | null
  label: string
  langQuery: string | null
  isNonOriginal: boolean
} {
  const cleanId = dubId ? String(dubId).replace(/^-/, '').trim() : ''
  if (!cleanId) {
    return { cleanId: null, label: 'Original', langQuery: null, isNonOriginal: false }
  }

  const matchedDub = dubs.find(
    (d) => d.id === dubId || d.id.replace(/^-/, '') === cleanId,
  )
  let rawLabel = matchedDub?.label || ''
  if (!rawLabel) {
    if (cleanId.startsWith('vidzee:')) rawLabel = cleanId.slice('vidzee:'.length)
    else if (cleanId.startsWith('embed:')) rawLabel = cleanId.slice('embed:'.length)
    else if (!/^\d+$/.test(cleanId)) rawLabel = cleanId
  }

  const cleanLbl = rawLabel ? cleanMovieDubLabel(rawLabel) : 'Dub'
  const norm = normalizeMovieDubLanguage(cleanLbl)
  const isOriginal = isOriginalMovieDubLabel(cleanLbl)
  const isNumericOnly = /^\d+$/.test(cleanId) && !rawLabel
  const langQuery = !isOriginal && !isNumericOnly && norm ? cleanLbl.replace(/\s*\([^)]*\)/g, '').replace(/\s*dub\b/i, '').trim() : null

  return {
    cleanId,
    label: cleanLbl,
    langQuery,
    isNonOriginal: Boolean(langQuery) || (!isOriginal && Boolean(matchedDub)),
  }
}

export function backupMatchesRequestedDub(
  backup: {
    activeLanguage?: string
    dubs?: ReadonlyArray<{ label: string; selected?: boolean }>
    streams?: ReadonlyArray<{ language?: string }>
  },
  langQuery: string | null,
): boolean {
  if (!langQuery) return true
  const target = normalizeMovieDubLanguage(langQuery)
  if (!target) return true

  const candidates: string[] = []
  if (backup.activeLanguage) candidates.push(backup.activeLanguage)
  for (const s of backup.streams || []) {
    if (s.language) candidates.push(s.language)
  }
  for (const d of backup.dubs || []) {
    if (d.selected && d.label) candidates.push(d.label)
  }

  return candidates.some((c) => {
    const n = normalizeMovieDubLanguage(c)
    return Boolean(n && (n === target || n.includes(target) || target.includes(n)))
  })
}

export const KNOWN_MOVIE_SERVER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  cinemaos: 'Server 1',
  moviebox: 'Server 2',
  vidzee: 'Server 3',
  vidup: 'Server 4',
  vidfast: 'Server 5',
  primesrc: 'Server 6',
  'vidsrc-to': 'Server 7',
  vidlove: 'Server 8',
  '1embed': 'Server 9',
  vidspark: 'Server 10',
  autoembed: 'Server 11',
  multiembed: 'Server 12',
  'vidsrc-rip': 'Server 13',
  videasy: 'Server 14',
  vidcore: 'Server 15',
  cinesrc: 'Server 16',
  vidlink: 'Server 17',
  'vidnest-tv': 'Server 18',
  nontongo: 'Server 19',
  smashystream: 'Server 20',
})

/**
 * Masks internal server and scraper provider names (CinemaOS, MovieBox, Vidzee, VidFast, PrimeSrc, etc.)
 * into clean, user-facing generic labels (e.g. Server 1, Server 2, Server 3).
 * Ensures internal scraper and provider names never leak to users on normal movie & TV show watch pages.
 */
export function maskMovieServerLabel(
  providerId?: string | null,
  explicitLabel?: string | null,
  index?: number,
): string {
  // If a 0-based index in the active server list is provided, format sequentially as Server 1, Server 2, etc.
  if (typeof index === 'number' && index >= 0) {
    return `Server ${index + 1}`
  }
  // If the label is already masked as "Server N" or "HD Server N", preserve it
  if (explicitLabel && /^(?:HD\s+)?Server\s+\d+$/i.test(explicitLabel.trim())) {
    return explicitLabel.trim()
  }
  if (providerId) {
    const cleanId = String(providerId).toLowerCase().replace(/^embed:/, '').trim()
    if (KNOWN_MOVIE_SERVER_LABELS[cleanId]) {
      return KNOWN_MOVIE_SERVER_LABELS[cleanId]
    }
    const match = cleanId.match(/(\d+)/)
    if (match) {
      return `Server ${match[1]}`
    }
  }
  return 'Server 1'
}

export interface MovieWatchServerSlot {
  key: 'server-1' | 'server-2' | 'server-3'
  serverId: 'cinemaos' | 'moviebox' | 'vidzee'
  label: 'SERVER 1' | 'SERVER 2' | 'SERVER 3'
  audio: 'sub'
  category: 'sub'
}

export const MOVIE_WATCH_SERVER_SLOTS: readonly MovieWatchServerSlot[] = [
  { key: 'server-1', serverId: 'cinemaos', label: 'SERVER 1', audio: 'sub', category: 'sub' },
  { key: 'server-2', serverId: 'moviebox', label: 'SERVER 2', audio: 'sub', category: 'sub' },
  { key: 'server-3', serverId: 'vidzee', label: 'SERVER 3', audio: 'sub', category: 'sub' },
]

export function resolveActiveMovieSlotKey(providerId?: string | null): MovieWatchServerSlot['key'] {
  const clean = String(providerId || '').toLowerCase().replace(/^embed:/, '').trim()
  if (clean === 'moviebox') return 'server-2'
  if (clean === 'vidzee' || clean === 'vidzee-mirror' || clean === 'embed-vidzee-mirror') {
    return 'server-3'
  }
  return 'server-1'
}

export function buildCinemaOsEmbedUrl(opts: {
  type: 'movie' | 'tv'
  tmdbId: number
  season?: number
  episode?: number
  lang?: string
}): string {
  const s = Math.max(1, opts.season ?? 1)
  const e = Math.max(1, opts.episode ?? 1)
  const lang = opts.lang || 'en'
  return opts.type === 'tv'
    ? `https://cinemaos.tech/player/${opts.tmdbId}/${s}/${e}?lang=${encodeURIComponent(lang)}`
    : `https://cinemaos.tech/player/${opts.tmdbId}?lang=${encodeURIComponent(lang)}`
}

export function buildVidzeeEmbedUrl(opts: {
  type: 'movie' | 'tv'
  tmdbId: number
  season?: number
  episode?: number
}): string {
  const s = Math.max(1, opts.season ?? 1)
  const e = Math.max(1, opts.episode ?? 1)
  return opts.type === 'tv'
    ? `https://player.vidzee.wtf/embed/tv/${opts.tmdbId}/${s}/${e}`
    : `https://player.vidzee.wtf/embed/movie/${opts.tmdbId}`
}

export function buildVidSrcEmbedUrl(opts: {
  type: 'movie' | 'tv'
  tmdbId: number
  season?: number
  episode?: number
}): string {
  const s = Math.max(1, opts.season ?? 1)
  const e = Math.max(1, opts.episode ?? 1)
  return opts.type === 'tv'
    ? `https://vidsrc.to/embed/tv/${opts.tmdbId}/${s}/${e}`
    : `https://vidsrc.to/embed/movie/${opts.tmdbId}`
}

/**
 * Pure detector for direct file URLs (MP4/WebM/MKV or Hakunaymatata non-HLS video endpoints),
 * unwrapping nested /proxy?url= parameters up to 5 levels deep.
 */
export function isDirectFileMediaUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false
  try {
    let curr = rawUrl
    for (let i = 0; i < 5; i++) {
      try {
        const parsed = new URL(curr, 'http://localhost')
        const inner = parsed.searchParams.get('url')
        if (inner) curr = inner
        else break
      } catch {
        break
      }
    }
    const decoded = decodeURIComponent(curr)
    if (/\.m3u8(\?|&|$)/i.test(decoded)) return false
    return (
      /\.(mp4|webm|mkv)(\?|&|$)/i.test(decoded) ||
      /\.(mp4|webm|mkv)/i.test(decoded) ||
      /\/sora\//i.test(decoded) ||
      /\bhakunaymatata\.com\b/i.test(decoded)
    )
  } catch {
    return false
  }
}
