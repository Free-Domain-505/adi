// Movie/TV embed candidate registry aligned with the working Zenkai provider architecture.
// This file is server-safe and contains URL construction + response validation only.

export const TRUSTED_MOVIE_EMBED_HOSTS = [
  'player.videasy.to',
  'player.vidzee.wtf',
  'vidup.to',
  'vidcore.net',
  'vidsrcme.ru',
  'player.vidlove.cc',
  '1embed.cc',
  'cinesrc.st',
  'primesrc.me',
  'cinemaos.tech',
  'www.nontongo.win',
  'nontongo.win',
  'vidnest.fun',
  // Retained secondary providers from AnimeStream (MoviesAPI intentionally excluded:
  // it was the source of the reported "refused to connect" failure).
  'cdn.vidspark.to',
  'vidspark.to',
  'vidlink.pro',
  'vidsrc.to',
  'vidfast.pro',
  'embed.smashystream.com',
  'smashystream.com',
  'player.autoembed.cc',
  'autoembed.cc',
  'multiembed.mov',
  'vidsrc.rip',
];

export function isTrustedMovieEmbedUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return TRUSTED_MOVIE_EMBED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function buildMovieEmbedCandidates({ type = 'movie', tmdbId, season = 1, episode = 1, sandboxed = false }) {
  const isTv = type === 'tv';
  const s = Math.max(1, parseInt(season, 10) || 1);
  const e = Math.max(1, parseInt(episode, 10) || 1);
  const id = Number(tmdbId);
  if (!Number.isFinite(id) || id <= 0) return [];

  // Vidzee Direct is handled natively via resolveVidzeeDirect in CinePlayer,
  // so external embed iframes from player.vidzee.wtf are excluded.
  const candidates = [
    {
      id: 'vidzee', label: 'Vidzee',
      url: isTv ? `https://player.vidzee.wtf/embed/tv/${id}/${s}/${e}` : `https://player.vidzee.wtf/embed/movie/${id}`,
      tags: ['Multi audio'], priority: 1,
    },
    {
      id: 'cinemaos', label: 'CinemaOS',
      url: isTv ? `https://cinemaos.tech/player/${id}/${s}/${e}?lang=en` : `https://cinemaos.tech/player/${id}?lang=en`,
      tags: ['Multi audio'], priority: 2,
    },
    {
      id: 'videasy', label: 'Videasy',
      url: isTv
        ? `https://player.videasy.to/tv/${id}/${s}/${e}?color=E50914&overlay=true&nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true`
        : `https://player.videasy.to/movie/${id}?color=E50914&overlay=true&nextEpisode=true`,
      tags: ['Multi audio', '4K'], priority: 3,
    },
    {
      id: 'vidup', label: 'VidUp',
      url: isTv ? `https://vidup.to/tv/${id}/${s}/${e}?server=zenith` : `https://vidup.to/movie/${id}?server=zenith`,
      tags: [], priority: 5,
    },
    {
      id: 'vidcore', label: 'VidCore',
      url: isTv ? `https://vidcore.net/tv/${id}/${s}/${e}?server=Crystal&autoPlay=true` : `https://vidcore.net/movie/${id}?server=Crystal&autoPlay=true`,
      tags: [], priority: 6,
    },
    {
      id: 'vidsrc-ru', label: 'VidSrc',
      url: isTv ? `https://vidsrcme.ru/embed/tv/${id}/${s}/${e}` : `https://vidsrcme.ru/embed/movie/${id}`,
      tags: [], priority: 7,
    },
    {
      id: 'vidlove', label: 'VidLove',
      url: isTv ? `https://player.vidlove.cc/embed/tv/${id}/${s}/${e}` : `https://player.vidlove.cc/embed/movie/${id}`,
      tags: [], priority: 8,
    },
    {
      id: '1embed', label: '1Embed',
      url: isTv ? `https://1embed.cc/embed/tv/${id}/${s}/${e}` : `https://1embed.cc/embed/movie/${id}`,
      tags: [], priority: 9,
    },
    {
      id: 'cinesrc', label: 'CineSrc',
      url: isTv ? `https://cinesrc.st/embed/tv/${id}/${s}/${e}` : `https://cinesrc.st/embed/movie/${id}`,
      tags: [], priority: 10,
    },
    {
      id: 'primesrc', label: 'PrimeSrc',
      url: isTv
        ? `https://primesrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}&fallback=false&serverOrder=PrimeVid,Voe,Dood`
        : `https://primesrc.me/embed/movie?tmdb=${id}`,
      tags: [], priority: 11,
    },
    ...(!isTv ? [{
      id: 'nontongo', label: 'NontonGo',
      url: `https://www.nontongo.win/embed/movie/${id}`,
      tags: [], priority: 4,
    }] : []),
    ...(isTv ? [{
      id: 'vidnest-tv', label: 'VidNest',
      url: `https://vidnest.fun/tv/${id}/${s}/${e}`,
      tags: [], priority: 12,
    }] : []),
    {
      id: 'vidspark', label: 'VidSpark',
      url: isTv ? `https://cdn.vidspark.to/tv/${id}/${s}/${e}` : `https://cdn.vidspark.to/movie/${id}`,
      tags: ['Multi audio', '4K'], priority: 13,
    },
    {
      id: 'vidlink', label: 'VidLink',
      url: isTv ? `https://vidlink.pro/tv/${id}/${s}/${e}` : `https://vidlink.pro/movie/${id}`,
      tags: ['Multi audio', '4K'], priority: 14,
    },
    {
      id: 'vidsrc-to', label: 'VidSrc.to',
      url: isTv ? `https://vidsrc.to/embed/tv/${id}/${s}/${e}` : `https://vidsrc.to/embed/movie/${id}`,
      tags: ['Multi audio'], priority: 15,
    },
    {
      id: 'vidfast', label: 'VidFast',
      url: isTv ? `https://vidfast.pro/tv/${id}/${s}/${e}` : `https://vidfast.pro/movie/${id}`,
      tags: ['4K'], priority: 16,
    },
    {
      id: 'smashystream', label: 'SmashyStream',
      url: isTv ? `https://embed.smashystream.com/playere.php?tmdb=${id}&season=${s}&episode=${e}` : `https://embed.smashystream.com/playere.php?tmdb=${id}`,
      tags: ['Multi audio', '4K'], priority: 17,
    },
    {
      id: 'autoembed', label: 'AutoEmbed',
      url: isTv ? `https://player.autoembed.cc/embed/tv/${id}/${s}/${e}` : `https://player.autoembed.cc/embed/movie/${id}`,
      tags: ['Multi audio'], priority: 18,
    },
    {
      id: 'multiembed', label: 'MultiEmbed',
      url: isTv ? `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}` : `https://multiembed.mov/?video_id=${id}&tmdb=1`,
      tags: ['Multi audio'], priority: 19,
    },
    {
      id: 'vidsrc-rip', label: 'VidSrc Rip',
      url: isTv ? `https://vidsrc.rip/embed/tv/${id}/${s}/${e}` : `https://vidsrc.rip/embed/movie/${id}`,
      tags: ['4K'], priority: 20,
    },
  ];

  return candidates
    .filter((c) => isTrustedMovieEmbedUrl(c.url))
    .sort((a, b) => a.priority - b.priority);
}

export function isValidEmbedResponse(status, bodyText) {
  if (status !== 200 || !bodyText || typeof bodyText !== 'string') return false;
  const clean = bodyText.trim();
  if (clean.length < 100) return false;
  if (/__next_error__|__vidora_sandbox_probe__|Restricted\s+Embed\s+Detected|Please\s+Disable\s+Sandbox|sandbox\.php|403\s+Forbidden/i.test(clean)) return false;
  if (/^File not found|^Video not found/i.test(clean)) return false;
  if (/<title>\s*(?:404|Not Found|Error|Attention Required|Just a moment)/i.test(clean)) return false;
  return /<html[^>]*>[\s\S]*<\/html>|<!DOCTYPE|player|video/i.test(clean);
}

export function getMaxResolutionFromStreams(streams = []) {
  if (!Array.isArray(streams) || streams.length === 0) return 0;
  return Math.max(
    0,
    ...streams.map((s) => Number(s?.resolutionNum || parseInt(String(s?.quality || ''), 10) || 0) || 0),
  );
}

export function hasHindiAudio(source) {
  if (!source) return false;
  if (/hindi/i.test(String(source.activeLanguage || ''))) return true;
  if (Array.isArray(source.dubs)) {
    if (source.dubs.some((d) => d?.selected && /hindi/i.test(String(d?.label || '')))) return true;
  }
  if (Array.isArray(source.streams)) {
    if (source.streams.some((s) => /hindi/i.test(String(s?.language || '')))) return true;
  }
  return false;
}

/**
 * MovieBox is always Priority #1 when it offers HD (720p/1080p+) AND matches Hindi availability.
 * - Never switch away from MovieBox Hindi to a non-Hindi stream.
 * - Always switch to Vidzee Hindi if MovieBox had no Hindi track.
 * - Upgrade MovieBox < 720p to Vidzee when Vidzee offers >= 720p or multi-quality in matching/Hindi language.
 */
export function shouldUpgradeMovieBoxToVidzee(mbStreams = [], vidzeeStreams = [], opts = {}) {
  if (!Array.isArray(vidzeeStreams) || vidzeeStreams.length === 0) return false;
  const { mbHasHindi = false, vzHasHindi = false } = opts;
  if (mbHasHindi && !vzHasHindi) return false;
  if (!mbHasHindi && vzHasHindi) return true;
  const mbMax = getMaxResolutionFromStreams(mbStreams);
  if (mbMax >= 720) return false;
  const vzMax = getMaxResolutionFromStreams(vidzeeStreams);
  const vzMulti = vidzeeStreams.some((s) => s?.hasMultiQuality);
  return vzMax >= 720 || vzMulti || vzMax > mbMax;
}


