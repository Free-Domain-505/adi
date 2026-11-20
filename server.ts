import http from 'node:http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { createServer as createViteServer } from 'vite';
import { installStreamingBridge, invokeStreamingApi } from './streamingBridge';
import * as mangaMirrors from './streaming/server/manga.js';
import * as manhwaMirrors from './streaming/server/manhwa.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const TMDB_API_KEY = process.env.TMDB_API_KEY || '9cc5f31c0469b83ab5ea8608c1081b46';

app.use(express.json({ limit: '1mb' }));
installStreamingBridge(app);

// Simple TTL in-memory cache
interface CacheEntry {
  expiresAt: number;
  data: unknown;
}
const cache = new Map<string, CacheEntry>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached(key: string, data: unknown, ttlMs = 5 * 60 * 1000) {
  if (cache.size > 600) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, data });
}

const MANGADEX_URL = 'https://api.mangadex.org';
const NOVELFIRE_URL = 'https://novelfire.net';
const CINEMETA_URL = 'https://v3-cinemeta.strem.io';

const MD_HEADERS = {
  'User-Agent': 'Aadhi/1.0 (https://aadhi.app)',
  Accept: 'application/json',
};

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function proxyImg(url: string | null | undefined, referer?: string): string {
  if (!url) return '';
  if (url.startsWith('/api/proxy/image')) return url;
  const params = new URLSearchParams({ url });
  if (referer) params.set('referer', referer);
  return `/api/proxy/image?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// 1. Image Proxy (MangaDex covers/pages, NovelFire covers, etc.)
// ---------------------------------------------------------------------------
app.get('/api/proxy/image', async (req, res) => {
  const rawUrl = String(req.query.url || '');
  const referer = String(req.query.referer || '');
  if (!rawUrl || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://'))) {
    res.status(400).send('Invalid image URL');
    return;
  }

  try {
    const parsed = new URL(rawUrl);
    const headers: Record<string, string> = {
      'User-Agent': parsed.hostname.includes('mangadex') ? 'Aadhi/1.0' : BROWSER_HEADERS['User-Agent'],
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    if (referer) {
      headers['Referer'] = referer;
    } else if (parsed.hostname.includes('mangadex')) {
      headers['Referer'] = 'https://mangadex.org/';
    } else if (parsed.hostname.includes('novelfire')) {
      headers['Referer'] = 'https://novelfire.net/';
    } else if (parsed.hostname.includes('asurascans')) {
      headers['Referer'] = 'https://asurascans.com/';
    } else if (parsed.hostname.includes('weebcentral') || parsed.hostname.includes('planeptune') || parsed.hostname.includes('compsci88')) {
      headers['Referer'] = 'https://weebcentral.com/';
    } else if (parsed.hostname.includes('demonic') || parsed.hostname.includes('readermc')) {
      headers['Referer'] = 'https://demonicscans.org/';
    }

    const upstream = await fetch(rawUrl, {
      headers,
      signal: AbortSignal.timeout(12000),
    });

    if (!upstream.ok) {
      res.status(upstream.status).send('Upstream image error');
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch {
    res.status(502).send('Image proxy failed');
  }
});

// ---------------------------------------------------------------------------
// 2. TMDB Core API Client & Formatting Helpers
// ---------------------------------------------------------------------------

async function tmdbFetch(endpoint: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw new Error(`TMDB error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

async function getTmdbLogoById(id: number | string, type: 'tv' | 'movie' = 'tv'): Promise<string | null> {
  const cacheKey = `tmdb:logo:id:${type}:${id}`;
  const cached = getCached<string>(cacheKey);
  if (cached !== null) return cached || null;
  try {
    const data = await tmdbFetch(`/${type}/${id}/images`, {
      include_image_language: 'en,ja,zh,null',
    });
    const logos = (data.logos || []).slice();
    // Prefer English logo first, then highest vote
    const enLogo = logos.find((l: any) => l.iso_639_1 === 'en');
    const bestLogo = enLogo || logos.sort((a: any, b: any) => (b.vote_average || 0) - (a.vote_average || 0))[0];
    const path = bestLogo?.file_path ? `https://image.tmdb.org/t/p/w500${bestLogo.file_path}` : '';
    setCached(cacheKey, path, 24 * 60 * 60 * 1000);
    return path || null;
  } catch {
    setCached(cacheKey, '', 2 * 60 * 60 * 1000);
    return null;
  }
}

function formatTmdbShow(item: any, logo?: string | null): any {
  const id = Number(item.id);
  const title = item.name || item.title || item.original_name || 'Untitled';
  const isMovie = Boolean(item.title && !item.name);
  const releaseDate = item.first_air_date || item.release_date || '';
  const year = releaseDate ? Number(releaseDate.slice(0, 4)) : null;
  const isChinese = item.original_language === 'zh' || (item.origin_country || []).includes('CN');

  const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
  const backdrop = item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : poster;

  return {
    id,
    idMal: null,
    title: {
      romaji: title,
      english: title,
      native: item.original_name || item.original_title || title,
    },
    coverImage: {
      extraLarge: poster,
      large: poster,
      color: '#f59e0b',
    },
    bannerImage: backdrop,
    logo: logo || null,
    description: item.overview || '',
    format: isMovie ? 'MOVIE' : 'TV',
    status: item.status ? item.status.toUpperCase() : (item.in_production === false ? 'FINISHED' : 'RELEASING'),
    episodes: item.number_of_episodes || null,
    seasonYear: year,
    averageScore: item.vote_average ? Math.round(item.vote_average * 10) : null,
    popularity: Math.round(item.popularity || 0),
    genres: Array.isArray(item.genres)
      ? item.genres.map((g: any) => (typeof g === 'string' ? g : g.name))
      : [],
    countryOfOrigin: isChinese ? 'CN' : 'JP',
    nextAiringEpisode: item.next_episode_to_air
      ? {
          episode: item.next_episode_to_air.episode_number,
          airingAt: Math.floor(new Date(item.next_episode_to_air.air_date).getTime() / 1000),
          timeUntilAiring: 0,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// 3. TMDB Endpoints: Logo, Seasons, Episodes, Feeds
// ---------------------------------------------------------------------------

const JJK_TMDB_ID = 95479;
const JJK_ANILIST_IDS = new Set([113415, 145064, 172463]);
const JJK_FALLBACK_SEASONS = [
  {
    number: 1,
    name: 'Season 1',
    episodes: 24,
    anilistId: 113415,
    malId: 40748,
    poster: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx113415-LHBAeoZDIsnF.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/113415-jQBSkxWAAk83.jpg',
    absoluteOffset: 0,
  },
  {
    number: 2,
    name: 'Season 2',
    episodes: 23,
    anilistId: 145064,
    malId: 51009,
    poster: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx145064-hSNRJM03pvv1.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/145064-esDtAY2He7sk.jpg',
    absoluteOffset: 24,
  },
  {
    number: 3,
    name: 'Season 3: The Culling Game Part 1',
    episodes: 12,
    anilistId: 172463,
    malId: 57658,
    poster: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx172463-LnXqHzt74SJL.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/172463-3J2o3qQZadFJ.jpg',
    absoluteOffset: 47,
  },
];

function isJujutsuKaisen(id?: number, title?: string): boolean {
  if (id && (id === JJK_TMDB_ID || JJK_ANILIST_IDS.has(id))) return true;
  if (title && /jujutsu\s*kaisen/i.test(title)) return true;
  return false;
}

const ANILIST_CARD_FIELDS = `
  id
  idMal
  title { romaji english native }
  coverImage { extraLarge large color }
  bannerImage
  description(asHtml: false)
  format
  status
  episodes
  duration
  season
  seasonYear
  averageScore
  popularity
  genres
  countryOfOrigin
  trailer { id site }
  nextAiringEpisode { episode airingAt timeUntilAiring }
`;

async function anilistGraphql<T = any>(query: string, variables: Record<string, any> = {}): Promise<T | null> {
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8500),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.data ?? null;
  } catch {
    return null;
  }
}

async function jikanFetch<T = any>(endpoint: string): Promise<T | null> {
  try {
    const r = await fetch(`https://api.jikan.moe/v4${endpoint}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6500),
    });
    if (!r.ok) return null;
    return (await r.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}

function formatJikanAnime(item: any, country = 'JP'): any {
  const poster =
    item.images?.webp?.large_image_url ||
    item.images?.jpg?.large_image_url ||
    item.images?.jpg?.image_url ||
    null;
  return {
    id: Number(item.mal_id),
    idMal: Number(item.mal_id),
    title: {
      romaji: item.title,
      english: item.title_english || item.title,
      native: item.title_japanese || item.title,
    },
    coverImage: { extraLarge: poster, large: poster, color: '#f59e0b' },
    bannerImage: item.trailer?.images?.maximum_image_url || poster,
    logo: null,
    description: item.synopsis || '',
    format: item.type ? String(item.type).toUpperCase() : 'TV',
    status: item.airing ? 'RELEASING' : 'FINISHED',
    episodes: item.episodes || null,
    duration: null,
    season: item.season ? String(item.season).toUpperCase() : null,
    seasonYear: item.year || item.aired?.prop?.from?.year || null,
    averageScore: item.score ? Math.round(Number(item.score) * 10) : null,
    popularity: item.members || 0,
    genres: Array.isArray(item.genres) ? item.genres.map((g: any) => g.name) : [],
    countryOfOrigin: country,
    trailer: item.trailer?.youtube_id ? { id: item.trailer.youtube_id, site: 'youtube' } : null,
  };
}

function cleanTmdbQuery(raw: string): string {
  return raw
    .replace(/:\s*Season\s*\d+.*$/i, '')
    .replace(/\bSeason\s*\d+.*$/i, '')
    .replace(/\bPart\s*\d+.*$/i, '')
    .replace(/\bCour\s*\d+.*$/i, '')
    .replace(/\b\d+(?:st|nd|rd|th)\s+Season.*$/i, '')
    .replace(/\s+\d+(?:-\d+)?\s*(?:stage|cour|part).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTrailingSequelServer(raw: string): string {
  return cleanTmdbQuery(raw)
    .replace(/\s+(?:\d+|II|III|IV|V|VI)$/i, '')
    .trim();
}

async function resolveTmdbShowByTitle(
  titles: string[],
  country?: string | null,
  preferredType: 'tv' | 'movie' = 'tv'
): Promise<{ id: number; type: 'tv' | 'movie'; backdrop?: string | null } | null> {
  const queries = Array.from(
    new Set(
      titles
        .flatMap((t) => [t, cleanTmdbQuery(t), stripTrailingSequelServer(t)])
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
    )
  );
  if (queries.length === 0) return null;

  const cacheKey = `tmdb:resolve:${preferredType}:${country || 'any'}:${queries[0].toLowerCase()}`;
  const cached = getCached<{ id: number; type: 'tv' | 'movie'; backdrop?: string | null } | null>(cacheKey);
  if (cached !== null) return cached;

  for (const q of queries.slice(0, 3)) {
    try {
      const searchRes = await tmdbFetch(preferredType === 'movie' ? '/search/movie' : '/search/tv', {
        query: q,
        include_adult: 'false',
      });
      const list = searchRes?.results || [];
      if (list.length > 0) {
        const scored = list
          .map((item: any) => {
            let score = 0;
            const genres: number[] = Array.isArray(item.genre_ids) ? item.genre_ids : [];
            if (genres.includes(16)) score += 60;
            if (country === 'CN' && (item.original_language === 'zh' || (item.origin_country || []).includes('CN'))) score += 30;
            if (country === 'JP' && (item.original_language === 'ja' || (item.origin_country || []).includes('JP'))) score += 30;
            const name = String(item.name || item.title || '').toLowerCase();
            if (name === q.toLowerCase()) score += 40;
            else if (name.includes(q.toLowerCase())) score += 20;
            score += Math.min(20, Math.round((item.popularity || 0) / 10));
            return { item, score };
          })
          .sort((a: any, b: any) => b.score - a.score);
        const top = scored[0]?.item;
        if (top?.id) {
          const resolved = {
            id: Number(top.id),
            type: preferredType,
            backdrop: top.backdrop_path ? `https://image.tmdb.org/t/p/w1280${top.backdrop_path}` : null,
          };
          setCached(cacheKey, resolved, 24 * 60 * 60 * 1000);
          return resolved;
        }
      }
    } catch {}
  }

  try {
    const multi = await tmdbFetch('/search/multi', { query: queries[0], include_adult: 'false' });
    const match = (multi?.results || []).find((x: any) => x.media_type === 'tv' || x.media_type === 'movie');
    if (match?.id) {
      const resolved = {
        id: Number(match.id),
        type: (match.media_type === 'movie' ? 'movie' : 'tv') as 'tv' | 'movie',
        backdrop: match.backdrop_path ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}` : null,
      };
      setCached(cacheKey, resolved, 24 * 60 * 60 * 1000);
      return resolved;
    }
  } catch {}

  setCached(cacheKey, null, 2 * 60 * 60 * 1000);
  return null;
}

async function attachSpotlightLogos(items: any[]): Promise<any[]> {
  const top = items.slice(0, 8);
  const enriched = await Promise.all(
    top.map(async (item) => {
      const title = item.title?.english || item.title?.romaji || '';
      if (!title) return item;
      const prefType: 'tv' | 'movie' = item.format === 'MOVIE' ? 'movie' : 'tv';
      const resolved = await resolveTmdbShowByTitle([title, item.title?.romaji || ''], item.countryOfOrigin, prefType);
      const logo = resolved ? await getTmdbLogoById(resolved.id, resolved.type) : null;
      return {
        ...item,
        tmdbId: resolved?.id || item.tmdbId || null,
        logo: logo || item.logo || null,
        bannerImage: item.bannerImage || resolved?.backdrop || item.coverImage?.extraLarge || null,
      };
    })
  );
  return [...enriched, ...items.slice(8)];
}

function getCurrentAnimeSeason(): { season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'; year: number } {
  const now = new Date();
  const m = now.getMonth() + 1;
  const year = now.getFullYear();
  if (m <= 3) return { season: 'WINTER', year };
  if (m <= 6) return { season: 'SPRING', year };
  if (m <= 9) return { season: 'SUMMER', year };
  return { season: 'FALL', year };
}

app.get('/api/tmdb/logo', async (req, res) => {
  const title = String(req.query.title || '').trim();
  const id = req.query.id ? Number(req.query.id) : undefined;
  const type = req.query.type === 'movie' ? 'movie' : 'tv';

  if (id && Number.isFinite(id) && id > 0) {
    const logoUrl = await getTmdbLogoById(id, type);
    if (logoUrl || !title) return res.json({ logo: logoUrl });
  }

  if (!title) return res.status(400).json({ error: 'Missing title or id' });
  const cacheKey = `tmdb:logo:title:${type}:${title.toLowerCase()}`;
  const cachedLogo = getCached<{ logo: string | null }>(cacheKey);
  if (cachedLogo) return res.json(cachedLogo);

  try {
    const resolved = await resolveTmdbShowByTitle([title], undefined, type);
    const logoUrl = resolved ? await getTmdbLogoById(resolved.id, resolved.type) : null;
    const payload = { logo: logoUrl };
    setCached(cacheKey, payload, logoUrl ? 24 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'TMDB logo lookup failed', logo: null });
  }
});

async function getJjkAnilistSeasons() {
  const cacheKey = 'jjk:anilist:seasons:v1';
  const cached = getCached<typeof JJK_FALLBACK_SEASONS>(cacheKey);
  if (cached) return cached;

  try {
    const q = `query {
      s1: Media(id: 113415, type: ANIME) {
        id idMal title { english romaji } episodes bannerImage coverImage { extraLarge }
      }
      s2: Media(id: 145064, type: ANIME) {
        id idMal title { english romaji } episodes bannerImage coverImage { extraLarge }
      }
      s3: Media(id: 172463, type: ANIME) {
        id idMal title { english romaji } episodes bannerImage coverImage { extraLarge }
      }
    }`;
    const data = await anilistGraphql(q);
    if (data?.s1 && data?.s2) {
      const s1Eps = Number(data.s1.episodes) || 24;
      const s2Eps = Number(data.s2.episodes) || 23;
      const seasons: typeof JJK_FALLBACK_SEASONS = [
        {
          number: 1,
          name: 'Season 1',
          episodes: s1Eps,
          anilistId: Number(data.s1.id) || 113415,
          malId: Number(data.s1.idMal) || 40748,
          poster: data.s1.coverImage?.extraLarge || JJK_FALLBACK_SEASONS[0].poster,
          banner: data.s1.bannerImage || JJK_FALLBACK_SEASONS[0].banner,
          absoluteOffset: 0,
        },
        {
          number: 2,
          name: 'Season 2',
          episodes: s2Eps,
          anilistId: Number(data.s2.id) || 145064,
          malId: Number(data.s2.idMal) || 51009,
          poster: data.s2.coverImage?.extraLarge || JJK_FALLBACK_SEASONS[1].poster,
          banner: data.s2.bannerImage || JJK_FALLBACK_SEASONS[1].banner,
          absoluteOffset: s1Eps,
        },
      ];
      if (data.s3 && Number(data.s3.episodes) > 0) {
        seasons.push({
          number: 3,
          name: 'Season 3: The Culling Game',
          episodes: Number(data.s3.episodes) || 12,
          anilistId: Number(data.s3.id) || 172463,
          malId: Number(data.s3.idMal) || 57658,
          poster: data.s3.coverImage?.extraLarge || JJK_FALLBACK_SEASONS[2].poster,
          banner: data.s3.bannerImage || JJK_FALLBACK_SEASONS[2].banner,
          absoluteOffset: s1Eps + s2Eps,
        });
      }
      setCached(cacheKey, seasons, 6 * 60 * 60 * 1000);
      return seasons;
    }
  } catch {}
  setCached(cacheKey, JJK_FALLBACK_SEASONS, 60 * 60 * 1000);
  return JJK_FALLBACK_SEASONS;
}

async function getJjkSeasonEpisodes(seasonNum: number, fallbackBackdrop: string | null) {
  const seasons = await getJjkAnilistSeasons();
  const target = seasons.find((s) => s.number === seasonNum) || seasons[0];
  const cacheKey = `jjk:anilist:episodes:s${target.number}:v2`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const [aniZipData, alData, jikanData] = await Promise.all([
    fetch(`https://api.ani.zip/mappings?anilist_id=${target.anilistId}`, { signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    anilistGraphql(
      `query ($id: Int) { Media(id: $id, type: ANIME) { episodes bannerImage coverImage { extraLarge } streamingEpisodes { title thumbnail } } }`,
      { id: target.anilistId }
    ),
    jikanFetch<any>(`/anime/${target.malId}/episodes?page=1`),
  ]);

  const azEps = aniZipData?.episodes || {};
  const alMedia = alData?.Media;
  const alStreams = Array.isArray(alMedia?.streamingEpisodes) ? alMedia.streamingEpisodes : [];
  const jikanEps = Array.isArray(jikanData?.data) ? jikanData.data : [];
  const count =
    Math.max(
      target.episodes || 0,
      Object.keys(azEps).filter((k) => /^\d+$/.test(k)).length,
      alMedia?.episodes || 0,
      jikanEps.length
    ) || 12;

  const seasonBanner =
    alMedia?.bannerImage || target.banner || fallbackBackdrop || alMedia?.coverImage?.extraLarge || target.poster;

  const episodes = [];
  for (let i = 1; i <= count; i++) {
    const az = azEps[String(i)];
    const jk = jikanEps.find((x: any) => Number(x.mal_id) === i) || jikanEps[i - 1];
    const alStream = alStreams[i - 1];
    const rawAlTitle = alStream?.title ? String(alStream.title).replace(/^Episode\s*\d+\s*[-–:]\s*/i, '').trim() : '';

    const epTitle = az?.title?.en || az?.title?.['x-jat'] || jk?.title || rawAlTitle || `Episode ${i}`;
    const epThumb = az?.image || alStream?.thumbnail || seasonBanner || null;
    const epOverview = az?.overview || az?.summary || '';

    episodes.push({
      number: i,
      title: String(epTitle).trim(),
      overview: epOverview ? String(epOverview).trim() : '',
      thumbnail: epThumb,
      airDate: az?.airDate || jk?.aired || null,
      score: jk?.score || null,
    });
  }

  const payload = {
    id: JJK_TMDB_ID,
    season: target.number,
    seasonName: target.name,
    anilistId: target.anilistId,
    malId: target.malId,
    absoluteOffset: target.absoluteOffset,
    episodes,
    total: episodes.length,
    ids: {
      themoviedb: JJK_TMDB_ID,
      anilist: target.anilistId,
      mal: target.malId,
    },
    seasons: seasons.map((s) => ({
      number: s.number,
      name: s.name,
      episodes: s.episodes,
      poster: s.poster,
      anilistId: s.anilistId,
      malId: s.malId,
    })),
  };
  setCached(cacheKey, payload, 12 * 60 * 60 * 1000);
  return payload;
}

app.get('/api/tmdb/seasons', async (req, res) => {
  const title = String(req.query.title || '').trim();
  const id = req.query.id ? Number(req.query.id) : undefined;

  if (isJujutsuKaisen(id, title)) {
    const jjkSeasons = await getJjkAnilistSeasons();
    return res.json({
      id: JJK_TMDB_ID,
      seasons: jjkSeasons.map((s) => ({
        number: s.number,
        name: s.name,
        episodes: s.episodes,
        poster: s.poster,
        anilistId: s.anilistId,
        malId: s.malId,
      })),
    });
  }

  let showId = id;
  if (!showId && title) {
    const resolved = await resolveTmdbShowByTitle([title], undefined, 'tv');
    showId = resolved?.id;
  }

  if (!showId) return res.json({ id: null, seasons: [] });

  const cacheKey = `tmdb:seasons:id:${showId}`;
  const cached = getCached<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const detail = await tmdbFetch(`/tv/${showId}`);
    const validSeasons = (detail.seasons || [])
      .filter((x: any) => Number(x.season_number) > 0)
      .map((x: any) => ({
        number: Number(x.season_number),
        name: x.name || `Season ${x.season_number}`,
        episodes: x.episode_count || 0,
        poster: x.poster_path ? `https://image.tmdb.org/t/p/w500${x.poster_path}` : null,
      }));
    const payload = {
      id: showId,
      seasons: validSeasons.length > 0 ? validSeasons : [{ number: 1, name: 'Season 1', episodes: detail.number_of_episodes || 12, poster: null }],
    };
    setCached(cacheKey, payload, 24 * 60 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'TMDB season lookup failed', id: null, seasons: [] });
  }
});

async function resolveSeasonEpisodesHybrid(id: number, seasonNum: number, hintTitle?: string) {
  if (isJujutsuKaisen(id, hintTitle)) {
    return await getJjkSeasonEpisodes(seasonNum, JJK_FALLBACK_SEASONS[0].banner);
  }

  const cacheKey = `hybrid:episodes:${id}:s${seasonNum}:${(hintTitle || '').toLowerCase()}:v3`;
  const cached = getCached<any>(cacheKey);
  if (cached) return cached;

  let searchTitle = hintTitle || '';
  let altTitle = '';
  let country: string | null = null;
  let fallbackEps = 12;
  let fallbackThumb: string | null = null;
  let malId: number | undefined;

  const alData = await anilistGraphql(
    `query ($id: Int) { Media(id: $id, type: ANIME) { id idMal title { english romaji } countryOfOrigin episodes bannerImage coverImage { extraLarge } } }`,
    { id }
  );
  if (alData?.Media) {
    searchTitle = searchTitle || alData.Media.title?.english || alData.Media.title?.romaji || '';
    altTitle = alData.Media.title?.romaji || '';
    country = alData.Media.countryOfOrigin || null;
    fallbackEps = Number(alData.Media.episodes) || 12;
    fallbackThumb = alData.Media.bannerImage || alData.Media.coverImage?.extraLarge || null;
    malId = alData.Media.idMal || undefined;
    if (isJujutsuKaisen(alData.Media.id, searchTitle)) {
      return await getJjkSeasonEpisodes(seasonNum, fallbackThumb || JJK_FALLBACK_SEASONS[0].banner);
    }
  }

  const resolved = searchTitle
    ? await resolveTmdbShowByTitle([searchTitle, altTitle], country, 'tv')
    : { id, type: 'tv' as const, backdrop: null };

  const tmdbId = resolved?.id || id;

  const [seasonData, showData] = await Promise.all([
    tmdbFetch(`/tv/${tmdbId}/season/${seasonNum}`).catch(() => null),
    tmdbFetch(`/tv/${tmdbId}`).catch(() => null),
  ]);

  const fallbackBackdrop = showData?.backdrop_path
    ? `https://image.tmdb.org/t/p/w1280${showData.backdrop_path}`
    : showData?.poster_path
      ? `https://image.tmdb.org/t/p/w500${showData.poster_path}`
      : fallbackThumb;

  const rawEpisodes = Array.isArray(seasonData?.episodes) ? seasonData.episodes : [];
  const episodes =
    rawEpisodes.length > 0
      ? rawEpisodes.map((ep: any) => ({
          number: Number(ep.episode_number),
          title: ep.name ? String(ep.name).trim() : `Episode ${ep.episode_number}`,
          overview: ep.overview || '',
          thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : fallbackBackdrop,
          airDate: ep.air_date || null,
          score: ep.vote_average || null,
        }))
      : Array.from({ length: Math.min(Math.max(1, fallbackEps), 100) }, (_, idx) => ({
          number: idx + 1,
          title: `Episode ${idx + 1}`,
          overview: '',
          thumbnail: fallbackBackdrop,
          airDate: null,
          score: null,
        }));

  const tmdbSeasons = (showData?.seasons || [])
    .filter((s: any) => Number(s.season_number) > 0)
    .map((s: any) => ({
      number: Number(s.season_number),
      name: s.name || `Season ${s.season_number}`,
      episodes: s.episode_count || 0,
      poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
    }));

  const payload = {
    id: tmdbId,
    anilistId: alData?.Media ? id : undefined,
    malId,
    season: seasonNum,
    seasonName: seasonData?.name || `Season ${seasonNum}`,
    episodes,
    total: episodes.length,
    ids: {
      themoviedb: tmdbId,
      anilist: alData?.Media ? id : undefined,
      mal: malId,
    },
    seasons: tmdbSeasons,
  };
  setCached(cacheKey, payload, 12 * 60 * 60 * 1000);
  return payload;
}

// Season Episodes (TMDB for all Anime & Donghua; AniList + MAL/AniZip for Jujutsu Kaisen)
app.get('/api/tmdb/tv/:id/season/:season', async (req, res) => {
  const id = Number(req.params.id);
  const seasonNum = Math.max(1, Number(req.params.season) || 1);
  const hintTitle = req.query.title ? String(req.query.title).trim() : undefined;
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid TV ID' });

  try {
    const payload = await resolveSeasonEpisodesHybrid(id, seasonNum, hintTitle);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch season episodes' });
  }
});

// Anime Details: AniList + Jikan for metadata/images/posters/banners, TMDB for logo & seasons (except JJK -> AniList+MAL seasons)
app.get('/api/tmdb/anime/detail/:id', async (req, res) => {
  const rawId = Number(req.params.id);
  if (!Number.isFinite(rawId) || rawId <= 0) return res.status(400).json({ error: 'Invalid show ID' });

  const queryId = rawId === JJK_TMDB_ID ? 113415 : rawId;
  const cacheKey = `hybrid:anime:detail:${queryId}:v3`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const detailQuery = `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${ANILIST_CARD_FIELDS}
        studios(isMain: true) { nodes { id name isAnimationStudio } }
        characters(sort: [ROLE, RELEVANCE], perPage: 15) {
          edges {
            role
            node { id name { full } image { large } }
          }
        }
        recommendations(sort: [RATING_DESC], perPage: 14) {
          nodes {
            mediaRecommendation { ${ANILIST_CARD_FIELDS} }
          }
        }
      }
    }`;

    const alData = await anilistGraphql<any>(detailQuery, { id: queryId });
    let media: any = alData?.Media || null;

    if (!media) {
      const jk = await jikanFetch<{ data: any }>(`/anime/${queryId}/full`);
      if (jk?.data) media = formatJikanAnime(jk.data);
    }

    // Fallback for legacy TMDB IDs in user history/bookmarks
    if (!media) {
      try {
        const tmdbDetail = await tmdbFetch(`/tv/${rawId}`, {
          append_to_response: 'images,credits,recommendations,videos',
          include_image_language: 'en,ja,zh,null',
        });
        const logos = tmdbDetail.images?.logos || [];
        const enLogo = logos.find((l: any) => l.iso_639_1 === 'en');
        const bestLogo = enLogo || logos.sort((a: any, b: any) => (b.vote_average || 0) - (a.vote_average || 0))[0];
        const logoUrl = bestLogo?.file_path ? `https://image.tmdb.org/t/p/w500${bestLogo.file_path}` : null;
        const formatted = formatTmdbShow(tmdbDetail, logoUrl);
        const seasons = (tmdbDetail.seasons || [])
          .filter((s: any) => Number(s.season_number) > 0)
          .map((s: any) => ({
            number: Number(s.season_number),
            name: s.name || `Season ${s.season_number}`,
            episodes: s.episode_count || 0,
            poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
          }));
        const legacyPayload = {
          ...formatted,
          tmdbId: rawId,
          logo: logoUrl,
          seasons: seasons.length > 0 ? seasons : [{ number: 1, name: 'Season 1', episodes: tmdbDetail.number_of_episodes || 12, poster: null }],
        };
        setCached(cacheKey, legacyPayload, 6 * 60 * 60 * 1000);
        return res.json(legacyPayload);
      } catch {
        return res.status(404).json({ error: 'Anime not found' });
      }
    }

    const primaryTitle = media.title?.english || media.title?.romaji || '';
    const altTitle = media.title?.romaji || '';
    const jjk = isJujutsuKaisen(media.id, primaryTitle);

    if (jjk) {
      const [jjkSeasons, logoUrl] = await Promise.all([
        getJjkAnilistSeasons(),
        getTmdbLogoById(JJK_TMDB_ID, 'tv'),
      ]);
      const payload = {
        ...media,
        tmdbId: JJK_TMDB_ID,
        logo: logoUrl,
        episodes: jjkSeasons.reduce((acc, s) => acc + s.episodes, 0),
        seasons: jjkSeasons.map((s) => ({
          number: s.number,
          name: s.name,
          episodes: s.episodes,
          poster: s.poster,
          anilistId: s.anilistId,
          malId: s.malId,
        })),
      };
      setCached(cacheKey, payload, 6 * 60 * 60 * 1000);
      return res.json(payload);
    }

    const prefType: 'tv' | 'movie' = media.format === 'MOVIE' ? 'movie' : 'tv';
    const resolved = await resolveTmdbShowByTitle([primaryTitle, altTitle], media.countryOfOrigin, prefType);
    let logoUrl: string | null = null;
    let seasons: { number: number; name: string; episodes: number; poster?: string | null }[] = [];

    if (resolved) {
      const [logo, tmdbShow] = await Promise.all([
        getTmdbLogoById(resolved.id, resolved.type),
        resolved.type === 'tv' ? tmdbFetch(`/tv/${resolved.id}`).catch(() => null) : Promise.resolve(null),
      ]);
      logoUrl = logo;
      seasons = (tmdbShow?.seasons || [])
        .filter((s: any) => Number(s.season_number) > 0)
        .map((s: any) => ({
          number: Number(s.season_number),
          name: s.name || `Season ${s.season_number}`,
          episodes: s.episode_count || 0,
          poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
        }));
    }

    const payload = {
      ...media,
      tmdbId: resolved?.id || null,
      logo: logoUrl,
      bannerImage: media.bannerImage || resolved?.backdrop || media.coverImage?.extraLarge || null,
      seasons:
        seasons.length > 0
          ? seasons
          : [{ number: 1, name: 'Season 1', episodes: media.episodes || 12, poster: media.coverImage?.extraLarge || null }],
    };

    setCached(cacheKey, payload, 6 * 60 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch anime detail' });
  }
});

// Anime Home Feed (AniList + Jikan posters/banners/metadata + TMDB logos on spotlight)
app.get('/api/tmdb/anime/home', async (req, res) => {
  const cacheKey = 'hybrid:anime:home:v3';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { season, year } = getCurrentAnimeSeason();
    const query = `query ($season: MediaSeason, $year: Int) {
      trending: Page(page: 1, perPage: 18) {
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ${ANILIST_CARD_FIELDS} }
      }
      season: Page(page: 1, perPage: 18) {
        media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) { ${ANILIST_CARD_FIELDS} }
      }
      popular: Page(page: 1, perPage: 18) {
        media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${ANILIST_CARD_FIELDS} }
      }
      top: Page(page: 1, perPage: 18) {
        media(type: ANIME, sort: SCORE_DESC, isAdult: false) { ${ANILIST_CARD_FIELDS} }
      }
      upcoming: Page(page: 1, perPage: 18) {
        media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, isAdult: false) { ${ANILIST_CARD_FIELDS} }
      }
    }`;

    const alData = await anilistGraphql<any>(query, { season, year });
    if (alData?.trending?.media) {
      const trending = await attachSpotlightLogos(alData.trending.media || []);
      const payload = {
        trending,
        season: alData.season?.media || [],
        popular: alData.popular?.media || [],
        top: alData.top?.media || [],
        upcoming: alData.upcoming?.media || [],
      };
      setCached(cacheKey, payload, 30 * 60 * 1000);
      return res.json(payload);
    }

    // Jikan fallback
    const [topNow, popList, topScore, upcomingList] = await Promise.all([
      jikanFetch<{ data: any[] }>('/top/anime?filter=airing&limit=18'),
      jikanFetch<{ data: any[] }>('/top/anime?filter=bypopularity&limit=18'),
      jikanFetch<{ data: any[] }>('/top/anime?limit=18'),
      jikanFetch<{ data: any[] }>('/top/anime?filter=upcoming&limit=18'),
    ]);

    const trending = await attachSpotlightLogos((topNow?.data || []).map((x) => formatJikanAnime(x)));
    const payload = {
      trending,
      season: trending,
      popular: (popList?.data || []).map((x) => formatJikanAnime(x)),
      top: (topScore?.data || []).map((x) => formatJikanAnime(x)),
      upcoming: (upcomingList?.data || []).map((x) => formatJikanAnime(x)),
    };
    setCached(cacheKey, payload, 20 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch anime home' });
  }
});

// Donghua Home Feed (AniList CN Animation + TMDB logos on spotlight)
app.get('/api/tmdb/donghua/home', async (req, res) => {
  const cacheKey = 'hybrid:donghua:home:v3';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const query = `query {
      trending: Page(page: 1, perPage: 18) {
        media(type: ANIME, countryOfOrigin: CN, sort: TRENDING_DESC, isAdult: false) { ${ANILIST_CARD_FIELDS} }
      }
      airing: Page(page: 1, perPage: 18) {
        media(type: ANIME, countryOfOrigin: CN, status: RELEASING, sort: POPULARITY_DESC, isAdult: false) { ${ANILIST_CARD_FIELDS} }
      }
      popular: Page(page: 1, perPage: 18) {
        media(type: ANIME, countryOfOrigin: CN, sort: POPULARITY_DESC, isAdult: false) { ${ANILIST_CARD_FIELDS} }
      }
      top: Page(page: 1, perPage: 18) {
        media(type: ANIME, countryOfOrigin: CN, sort: SCORE_DESC, isAdult: false) { ${ANILIST_CARD_FIELDS} }
      }
    }`;

    const alData = await anilistGraphql<any>(query);
    const trending = await attachSpotlightLogos(alData?.trending?.media || []);
    const payload = {
      trending,
      airing: alData?.airing?.media || [],
      popular: alData?.popular?.media || [],
      top: alData?.top?.media || [],
    };
    setCached(cacheKey, payload, 30 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch donghua home' });
  }
});

// Anime & Donghua Browse / Search (AniList + Jikan fallback)
app.get('/api/tmdb/anime/browse', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(50, Math.max(1, Number(req.query.perPage) || 24));
  const country = req.query.country ? String(req.query.country).toUpperCase() : undefined;
  const genre = String(req.query.genre || '').trim() || undefined;
  const format = String(req.query.format || '').trim() || undefined;
  const status = String(req.query.status || '').trim() || undefined;
  const season = String(req.query.season || '').trim() || undefined;
  const year = req.query.year ? Number(req.query.year) : undefined;
  const sortParam = String(req.query.sort || 'TRENDING_DESC');

  const cacheKey = `hybrid:browse:${q}:${page}:${perPage}:${country || ''}:${genre || ''}:${format || ''}:${status || ''}:${season || ''}:${year || ''}:${sortParam}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const sortMap: Record<string, string> = {
      TRENDING_DESC: 'TRENDING_DESC',
      POPULARITY_DESC: 'POPULARITY_DESC',
      SCORE_DESC: 'SCORE_DESC',
      START_DATE_DESC: 'START_DATE_DESC',
      FAVOURITES_DESC: 'FAVOURITES_DESC',
    };
    const sort = q ? 'SEARCH_MATCH' : sortMap[sortParam] || 'TRENDING_DESC';

    const alQuery = `query (
      $page: Int, $perPage: Int, $search: String, $genre: String,
      $format: MediaFormat, $status: MediaStatus, $season: MediaSeason,
      $year: Int, $sort: [MediaSort], $country: CountryCode
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(
          type: ANIME, search: $search, genre: $genre, format: $format,
          status: $status, season: $season, seasonYear: $year,
          sort: $sort, countryOfOrigin: $country, isAdult: false
        ) {
          ${ANILIST_CARD_FIELDS}
        }
      }
    }`;

    const alData = await anilistGraphql<any>(alQuery, {
      page,
      perPage,
      search: q || undefined,
      genre,
      format,
      status,
      season,
      year,
      sort: [sort],
      country: country || undefined,
    });

    if (alData?.Page) {
      const payload = {
        items: alData.Page.media || [],
        page,
        hasNextPage: Boolean(alData.Page.pageInfo?.hasNextPage),
      };
      setCached(cacheKey, payload, 10 * 60 * 1000);
      return res.json(payload);
    }

    if (q) {
      const jk = await jikanFetch<{ data: any[]; pagination?: { has_next_page?: boolean } }>(
        `/anime?q=${encodeURIComponent(q)}&page=${page}&limit=${perPage}`
      );
      const payload = {
        items: (jk?.data || []).map((x) => formatJikanAnime(x, country || 'JP')),
        page,
        hasNextPage: Boolean(jk?.pagination?.has_next_page),
      };
      setCached(cacheKey, payload, 10 * 60 * 1000);
      return res.json(payload);
    }

    return res.json({ items: [], page, hasNextPage: false });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to browse anime', items: [], hasNextPage: false });
  }
});

// Airing Schedule (AniList AiringSchedules)
app.get('/api/tmdb/schedule', async (req, res) => {
  const cacheKey = 'hybrid:schedule:v3';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const alQuery = `query ($start: Int, $end: Int) {
      Page(page: 1, perPage: 28) {
        airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
          id
          episode
          airingAt
          media {
            ${ANILIST_CARD_FIELDS}
            isAdult
          }
        }
      }
    }`;
    const alData = await anilistGraphql<any>(alQuery, {
      start: nowSec - 24 * 3600,
      end: nowSec + 7 * 24 * 3600,
    });
    const list = (alData?.Page?.airingSchedules || []).filter((s: any) => s.media && !s.media.isAdult);
    const schedules = list.map((s: any) => ({
      id: s.id,
      episode: s.episode,
      airingAt: s.airingAt,
      media: s.media,
    }));
    const payload = { schedules };
    setCached(cacheKey, payload, 30 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load schedule', schedules: [] });
  }
});

// Legacy / Direct episode list mapping (routes through hybrid TMDB / JJK AniList+MAL)
app.get('/api/anime/:id/episodes', async (req, res) => {
  const id = Number(req.params.id);
  const season = Math.max(1, Number(req.query.season) || 1);
  const hintTitle = req.query.title ? String(req.query.title).trim() : undefined;
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid anime ID' });

  try {
    const payload = await resolveSeasonEpisodesHybrid(id, season, hintTitle);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load episodes' });
  }
});

// ---------------------------------------------------------------------------
// 4b. Hindi & English Anime Stream Resolver (AnimeSalt + Verified Embeds)
// ---------------------------------------------------------------------------
function normalizeTitleStr(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(season|part|cour|arc)\s*\d+\b/gi, '')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSeasonNum(title: string): number {
  const m1 = title.match(/\bseason\s+(\d+)\b/i);
  if (m1) return Math.max(1, Number(m1[1]));
  const m2 = title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
  if (m2) return Math.max(1, Number(m2[1]));
  const m3 = title.match(/\bpart\s+(\d+)\b/i);
  if (m3) return Math.max(1, Number(m3[1]));
  return 1;
}

async function resolveAnimeSaltStreams(
  title: string,
  romaji: string,
  ep: number,
  isMovie: boolean,
  explicitSeason?: number,
  absEp?: number
) {
  const hindiStreams: { id: string; name: string; language: 'hindi' | 'english'; note: string; url: string }[] = [];
  const multiStreams: { id: string; name: string; language: 'hindi' | 'english'; note: string; url: string }[] = [];
  const englishStreams: { id: string; name: string; language: 'hindi' | 'english'; note: string; url: string }[] = [];

  const rawQuery = normalizeTitleStr(title || romaji);
  if (!rawQuery) return [];

  const titleSeason = extractSeasonNum(title || romaji);
  const season =
    explicitSeason && explicitSeason > 1
      ? explicitSeason
      : titleSeason > 1
        ? titleSeason
        : explicitSeason || 1;

  const searchTerms = Array.from(
    new Set([
      rawQuery,
      rawQuery.split(':')[0].trim(),
      normalizeTitleStr(romaji),
    ].filter((t) => t.length >= 2))
  );

  let matchedHref = '';
  for (const term of searchTerms) {
    try {
      const html = await fetch(`https://animesalt.cx/?s=${encodeURIComponent(term)}`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(5500),
      }).then((r) => r.text());

      const $ = cheerio.load(html);
      const candidates: { href: string; label: string; score: number }[] = [];
      $('a[href*="/series/"], a[href*="/movies/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const isMovLink = href.includes('/movies/');
        if (isMovie !== isMovLink) return;
        const slugPart = href.split('/').filter(Boolean).pop() || '';
        const label = normalizeTitleStr($(el).attr('title') || $(el).text() || slugPart.replace(/-/g, ' '));
        if (!label) return;
        let score = 0;
        if (label === term || slugPart.replace(/-/g, ' ') === term) score += 100;
        else if (label.includes(term) || term.includes(label)) score += 60;
        else {
          const words = term.split(' ').filter((w) => w.length > 2);
          const hits = words.filter((w) => label.includes(w)).length;
          score += hits * 15;
        }
        if (label.includes('lego') || label.includes('live action')) score -= 40;
        if (score > 0 && !candidates.some((c) => c.href === href)) {
          candidates.push({ href, label, score });
        }
      });

      candidates.sort((a, b) => b.score - a.score);
      if (candidates[0]?.score >= 30) {
        matchedHref = candidates[0].href;
        break;
      }
    } catch {
      // Try next search term
    }
  }

  if (!matchedHref) return [];

  const slug = matchedHref.split('/').filter(Boolean).pop() || '';
  const epUrls = isMovie
    ? [matchedHref]
    : Array.from(
        new Set([
          `https://animesalt.cx/episode/${slug}-${season}x${ep}/`,
          ...(season !== 1 ? [`https://animesalt.cx/episode/${slug}-1x${ep}/`] : []),
          ...(absEp && absEp !== ep ? [`https://animesalt.cx/episode/${slug}-1x${absEp}/`] : []),
        ])
      );

  for (const epUrl of epUrls) {
    try {
      const epHtml = await fetch(epUrl, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(5500),
      }).then((r) => (r.ok ? r.text() : ''));
      if (!epHtml) continue;

      const $ = cheerio.load(epHtml);
      const iframes = $('iframe')
        .map((_, el) => $(el).attr('src') || $(el).attr('data-src') || '')
        .get()
        .filter(Boolean);

      for (const src of iframes) {
        if (src.includes('player.php?data=')) {
          try {
            const urlObj = new URL(src.startsWith('http') ? src : `https://animesalt.cx${src}`);
            const b64 = urlObj.searchParams.get('data');
            if (b64) {
              const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
              if (Array.isArray(decoded)) {
                for (const item of decoded) {
                  const lang = String(item?.language || '').toLowerCase();
                  const link = String(item?.link || '');
                  if (!link) continue;
                  if (lang === 'hindi') {
                    hindiStreams.push({
                      id: 'salt-hindi',
                      name: 'Hindi Server HD',
                      language: 'hindi',
                      note: 'Hindi Audio · Mobile & PC',
                      url: link,
                    });
                  } else if (lang === 'english') {
                    englishStreams.push({
                      id: 'salt-english',
                      name: 'English Server HD',
                      language: 'english',
                      note: 'English Audio · Mobile & PC',
                      url: link,
                    });
                  }
                }
              }
            }
          } catch {
            // Ignore malformed base64
          }
        } else if (src.includes('ravok.buzz')) {
          multiStreams.push({
            id: 'salt-multi',
            name: 'Multi-Audio (Hindi / Eng)',
            language: 'hindi',
            note: 'Switch Hindi / English inside player',
            url: src,
          });
        }
      }

      if (hindiStreams.length > 0 || multiStreams.length > 0 || englishStreams.length > 0) break;
    } catch {
      // Try next ep URL
    }
  }

  return [...hindiStreams, ...multiStreams, ...englishStreams];
}

app.get('/api/anime/streams', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const title = String(req.query.title || '');
  const romaji = String(req.query.romaji || '');
  const ep = Math.max(1, Number(req.query.ep) || 1);
  const season = Math.max(0, Number(req.query.season) || 0);
  const absEp = Math.max(0, Number(req.query.absEp) || 0);
  const isMovie = req.query.isMovie === 'true';

  const cacheKey = `anime:streams:v3:${title}:${romaji}:s${season}:e${ep}:a${absEp}:${isMovie}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const saltStreams = await resolveAnimeSaltStreams(
      title,
      romaji,
      ep,
      isMovie,
      season || undefined,
      absEp || undefined
    );
    const payload = { streams: saltStreams };
    setCached(cacheKey, payload, 15 * 60 * 1000);
    res.json(payload);
  } catch {
    res.json({ streams: [] });
  }
});

// Ad-Free Direct HLS Stream Resolver for Anime (Anikoto + FlixCloud + WatchAnimeWorld + Tooniboy)
async function lookupAnilistIdForTitle(title: string, season = 1): Promise<number | null> {
  const clean = title.trim();
  if (!clean) return null;
  if (/jujutsu\s*kaisen/i.test(clean)) {
    const jjk = await getJjkAnilistSeasons();
    return (jjk.find((s) => s.number === season) || jjk[0])?.anilistId || 113415;
  }
  const cacheKey = `al:lookup:${clean.toLowerCase()}:s${season}`;
  const cached = getCached<number | null>(cacheKey);
  if (cached !== null) return cached;

  const qTitle = season > 1 ? `${clean} Season ${season}` : clean;
  const q = `query ($search: String) {
    Page(perPage: 5) {
      media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
        id title { english romaji } format
      }
    }
  }`;
  let data = await anilistGraphql(q, { search: qTitle });
  let first = data?.Page?.media?.[0];
  if (!first && season > 1) {
    data = await anilistGraphql(q, { search: clean });
    first = data?.Page?.media?.[0];
  }
  const id = first?.id ? Number(first.id) : null;
  if (id) setCached(cacheKey, id, 6 * 60 * 60 * 1000);
  return id;
}

app.get('/api/anime/direct-streams', async (req, res) => {
  const title = String(req.query.title || '').trim();
  const romaji = String(req.query.romaji || '').trim();
  const season = Math.max(1, Number(req.query.season) || 1);
  const ep = Math.max(1, Number(req.query.ep) || 1);
  const explicitAlId = Number(req.query.anilistId || 0);
  const format = String(req.query.format || 'TV');

  const cacheKey = `anime:direct:v1:${explicitAlId || title.toLowerCase()}:s${season}:e${ep}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const anilistId = explicitAlId > 0 ? explicitAlId : await lookupAnilistIdForTitle(title || romaji, season);
    if (!anilistId && !title) return res.json({ streams: [] });

    const seasonTitle = season > 1 && !/season/i.test(title) ? `${title} Season ${season}` : title;
    const baseQs = new URLSearchParams({
      ...(anilistId ? { id: String(anilistId) } : {}),
      ep: String(ep),
      ...(seasonTitle ? { title: seasonTitle } : {}),
      ...(romaji ? { romaji } : {}),
      format,
    });

    const attempts = [
      { key: 'direct-sub-1', audio: 'sub' as const, qs: `${baseQs.toString()}&server=anikoto&audio=sub` },
      { key: 'direct-dub-1', audio: 'dub' as const, qs: `${baseQs.toString()}&server=anikoto&audio=dub` },
      { key: 'direct-sub-2', audio: 'sub' as const, qs: `${baseQs.toString()}&server=flixcloud&audio=sub` },
      { key: 'direct-dub-2', audio: 'dub' as const, qs: `${baseQs.toString()}&server=flixcloud&audio=dub` },
      { key: 'direct-dub-3', audio: 'dub' as const, qs: `${baseQs.toString()}&server=watchanimeworld&audio=dub` },
    ];

    const settled = await Promise.all(
      attempts.map(async (item) => {
        const data = await invokeStreamingApi(`/api/stream?${item.qs}`);
        if (!data?.success || !data?.streamUrl) return null;
        return {
          id: item.key,
          audio: item.audio,
          format: data.format === 'file' ? 'file' : 'hls',
          streamUrl: String(data.streamUrl),
          subtitles: Array.isArray(data.subtitles) ? data.subtitles : [],
        };
      })
    );

    const streams = settled.filter(Boolean);
    const payload = { streams, anilistId: anilistId || null };
    if (streams.length > 0) setCached(cacheKey, payload, 8 * 60 * 1000);
    return res.json(payload);
  } catch {
    return res.json({ streams: [] });
  }
});

// Ad-Free Direct Stream Resolver for Movies & TV Series (MovieBox + Vidzee)
app.get('/api/movies/direct-streams', async (req, res) => {
  const id = String(req.query.id || '').trim();
  const type = String(req.query.type || 'movie').toLowerCase() === 'tv' ? 'tv' : 'movie';
  const season = Math.max(1, Number(req.query.s) || 1);
  const episode = Math.max(1, Number(req.query.e) || 1);
  const title = String(req.query.title || '').trim();
  const year = String(req.query.year || '').trim();

  if (!id && !title) return res.json({ streams: [], subtitles: [] });

  const cacheKey = `movies:direct:v1:${type}:${id}:s${season}:e${episode}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const qs = new URLSearchParams({
      ...(id ? { id } : {}),
      type,
      s: String(season),
      e: String(episode),
      ...(title ? { title } : {}),
      ...(year ? { year } : {}),
    });

    const [mbData, vzData] = await Promise.all([
      invokeStreamingApi(`/api/movies/stream?${qs.toString()}`),
      invokeStreamingApi(`/api/movies/vidzee-stream?${qs.toString()}`),
    ]);

    const streams: Array<{ id: string; label: string; streamUrl: string; format: 'hls' | 'file'; language: 'english' | 'hindi' }> = [];
    const subtitles: Array<{ file: string; label: string; default?: boolean }> = [];

    const rawSubs = [
      ...(Array.isArray(mbData?.subtitles) ? mbData.subtitles : []),
      ...(Array.isArray(vzData?.subtitles) ? vzData.subtitles : []),
    ];
    for (const sub of rawSubs.slice(0, 12)) {
      const subUrl = sub?.url || sub?.file;
      if (subUrl) {
        subtitles.push({
          file: String(subUrl).startsWith('/proxy') ? String(subUrl) : `/proxy?url=${encodeURIComponent(String(subUrl))}`,
          label: sub.label || sub.language || 'English',
          default: /english/i.test(String(sub.label || sub.language || '')),
        });
      }
    }

    const pushStreamList = (list: any[], prefix: string, lang: 'english' | 'hindi') => {
      for (const s of list || []) {
        const u = s?.url || s?.streamUrl;
        if (!u || /ailok\.pe/.test(String(u))) continue;
        const fmt: 'hls' | 'file' = /\.m3u8/i.test(String(u)) || s?.type === 'hls' ? 'hls' : 'file';
        streams.push({
          id: `${prefix}-${streams.length}`,
          label: s?.quality ? `${s.quality}` : 'HD',
          streamUrl: String(u).startsWith('/proxy') || String(u).startsWith('/api/') ? String(u) : `/proxy?url=${encodeURIComponent(String(u))}`,
          format: fmt,
          language: lang,
        });
      }
    };

    if (mbData?.success && Array.isArray(mbData.streams)) {
      pushStreamList(mbData.streams, 'mb', 'english');
    } else if (mbData?.streamUrl) {
      pushStreamList([{ url: mbData.streamUrl }], 'mb', 'english');
    }
    if (vzData?.success && Array.isArray(vzData.streams)) {
      pushStreamList(vzData.streams, 'vz', 'english');
    }

    const payload = { streams, subtitles };
    if (streams.length > 0) setCached(cacheKey, payload, 8 * 60 * 1000);
    return res.json(payload);
  } catch {
    return res.json({ streams: [], subtitles: [] });
  }
});

// ---------------------------------------------------------------------------
// 5. Manga & Manhwa Endpoints (Live MangaDex API)
// ---------------------------------------------------------------------------
function mapMangaDexItem(item: any) {
  const attrs = item?.attributes || {};
  const titles = attrs.title || {};
  const altTitles = Array.isArray(attrs.altTitles) ? attrs.altTitles : [];
  const enAlt = altTitles.find((t: any) => t.en)?.en;
  const title = titles.en || enAlt || titles['ja-ro'] || titles.ja || titles.ko || Object.values(titles)[0] || 'Untitled';
  const coverRel = (item.relationships || []).find((r: any) => r.type === 'cover_art');
  const fileName = coverRel?.attributes?.fileName;
  const rawCover = fileName ? `https://uploads.mangadex.org/covers/${item.id}/${fileName}.512.jpg` : '';
  const lang = attrs.originalLanguage || 'ja';
  const kind = lang === 'ko' ? 'Manhwa' : lang === 'zh' || lang === 'zh-hk' ? 'Manhua' : 'Manga';
  const genres = (attrs.tags || [])
    .filter((t: any) => t?.attributes?.group === 'genre')
    .map((t: any) => t.attributes?.name?.en)
    .filter(Boolean);

  return {
    id: item.id,
    title,
    description: attrs.description?.en || Object.values(attrs.description || {})[0] || '',
    cover: rawCover ? proxyImg(rawCover, 'https://mangadex.org/') : '',
    rawCover,
    kind,
    originalLanguage: lang,
    status: attrs.status || 'ongoing',
    year: attrs.year || null,
    lastChapter: attrs.lastChapter || null,
    genres: genres.slice(0, 6),
    rating: attrs.contentRating || 'safe',
  };
}

app.get('/api/manga/home', async (req, res) => {
  const kind = String(req.query.kind || 'manga').toLowerCase(); // manga | manhwa
  const cacheKey = `md:home:${kind}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const langParam = kind === 'manhwa' ? '&originalLanguage[]=ko' : '&originalLanguage[]=ja&originalLanguage[]=ko';
    const baseQuery = `includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&hasAvailableChapters=true&availableTranslatedLanguage[]=en${langParam}`;

    const [trendingRes, latestRes, topRes] = await Promise.all([
      fetch(`${MANGADEX_URL}/manga?limit=18&order[followedCount]=desc&${baseQuery}`, {
        headers: MD_HEADERS,
        signal: AbortSignal.timeout(9000),
      }).then((r) => r.json()),
      fetch(`${MANGADEX_URL}/manga?limit=18&order[latestUploadedChapter]=desc&${baseQuery}`, {
        headers: MD_HEADERS,
        signal: AbortSignal.timeout(9000),
      }).then((r) => r.json()),
      fetch(`${MANGADEX_URL}/manga?limit=18&order[rating]=desc&${baseQuery}`, {
        headers: MD_HEADERS,
        signal: AbortSignal.timeout(9000),
      }).then((r) => r.json()),
    ]);

    const payload = {
      trending: (trendingRes?.data || []).map(mapMangaDexItem),
      latest: (latestRes?.data || []).map(mapMangaDexItem),
      topRated: (topRes?.data || []).map(mapMangaDexItem),
    };
    setCached(cacheKey, payload, 10 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'MangaDex home error' });
  }
});

app.get('/api/manga/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const kind = String(req.query.kind || '').toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 24, 48);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const cacheKey = `md:search:${kind}:${q}:${limit}:${offset}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const params = new URLSearchParams();
    params.append('limit', String(limit));
    params.append('offset', String(offset));
    params.append('includes[]', 'cover_art');
    params.append('contentRating[]', 'safe');
    params.append('contentRating[]', 'suggestive');
    if (q) {
      params.append('title', q);
      params.append('order[relevance]', 'desc');
    } else {
      params.append('order[followedCount]', 'desc');
      params.append('hasAvailableChapters', 'true');
    }
    if (kind === 'manhwa') {
      params.append('originalLanguage[]', 'ko');
    } else if (kind === 'manga') {
      params.append('originalLanguage[]', 'ja');
    }

    const r = await fetch(`${MANGADEX_URL}/manga?${params.toString()}`, {
      headers: MD_HEADERS,
      signal: AbortSignal.timeout(9000),
    });
    const json = await r.json();
    const payload = {
      results: (json?.data || []).map(mapMangaDexItem),
      total: json?.total || 0,
    };
    setCached(cacheKey, payload, 5 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Manga search failed' });
  }
});

app.get('/api/manga/detail/:id', async (req, res) => {
  const id = String(req.params.id || '');
  const cacheKey = `md:detail:${id}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const r = await fetch(`${MANGADEX_URL}/manga/${encodeURIComponent(id)}?includes[]=cover_art&includes[]=author&includes[]=artist`, {
      headers: MD_HEADERS,
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) {
      res.status(r.status).json({ error: 'Manga not found' });
      return;
    }
    const json = await r.json();
    const base = mapMangaDexItem(json.data);
    const authorRel = (json.data?.relationships || []).find((rel: any) => rel.type === 'author');
    const artistRel = (json.data?.relationships || []).find((rel: any) => rel.type === 'artist');
    const detail = {
      ...base,
      author: authorRel?.attributes?.name || null,
      artist: artistRel?.attributes?.name || null,
    };
    setCached(cacheKey, detail, 15 * 60 * 1000);
    res.json(detail);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Manga detail error' });
  }
});

async function fetchMirrorChaptersForTitle(title: string, origLang = '') {
  const clean = title.replace(/\([^)]*\)/g, '').trim();
  const isKo = origLang === 'ko';
  const sourcesToTry: Array<{ kind: 'manga' | 'manhwa'; src: string; prefix: string }> = isKo
    ? [
        { kind: 'manhwa', src: 'asura', prefix: 'asura~' },
        { kind: 'manga', src: 'weebcentral', prefix: 'wc~' },
        { kind: 'manhwa', src: 'demonicscans', prefix: 'ds~' },
      ]
    : [
        { kind: 'manga', src: 'weebcentral', prefix: 'wc~' },
        { kind: 'manhwa', src: 'asura', prefix: 'asura~' },
        { kind: 'manhwa', src: 'demonicscans', prefix: 'ds~' },
      ];

  for (const cand of sourcesToTry) {
    try {
      const sRes =
        cand.kind === 'manhwa'
          ? await manhwaMirrors.search(clean, cand.src)
          : await mangaMirrors.search(clean, cand.src);
      const hits = sRes?.results || [];
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const targetNorm = norm(clean);
      const best =
        hits.find((h: any) => norm(h.title || '') === targetNorm) ||
        hits.find((h: any) => norm(h.title || '').includes(targetNorm) || targetNorm.includes(norm(h.title || ''))) ||
        hits[0];
      if (!best?.id) continue;

      const chRes =
        cand.kind === 'manhwa'
          ? await manhwaMirrors.getChapters(best.id, cand.src)
          : await mangaMirrors.getChapters(best.id, cand.src);
      const rawCh = chRes?.chapters || [];
      if (rawCh.length === 0) continue;

      const mapped = rawCh
        .map((c: any, idx: number) => ({
          id: `${cand.prefix}${c.chapterId}`,
          chapter: String(c.number ?? idx + 1),
          volume: c.volume || null,
          title: c.title || '',
          pages: 20,
          publishedAt: c.date || null,
          group: c.group || (cand.src === 'asura' ? 'Asura Scans' : cand.src === 'demonicscans' ? 'Demonic Scans' : 'Community'),
        }))
        .sort((a: any, b: any) => (parseFloat(b.chapter) || 0) - (parseFloat(a.chapter) || 0));

      return mapped;
    } catch {
      // Try next mirror
    }
  }
  return [];
}

app.get('/api/manga/chapters/:id', async (req, res) => {
  const id = String(req.params.id || '');
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const cacheKey = `md:chapters:v2:${id}:${offset}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const url = `${MANGADEX_URL}/manga/${encodeURIComponent(id)}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=500&offset=${offset}&includeExternalUrl=0&includes[]=scanlation_group`;
    const r = await fetch(url, { headers: MD_HEADERS, signal: AbortSignal.timeout(10000) });
    const json = await r.json();

    const byChapter = new Map<string, any>();
    for (const ch of json?.data || []) {
      if (ch?.attributes?.externalUrl || Number(ch?.attributes?.pages || 0) <= 0) continue;
      const chNum = String(ch.attributes?.chapter ?? ch.id);
      const groupRel = (ch.relationships || []).find((rel: any) => rel.type === 'scanlation_group');
      const existing = byChapter.get(chNum);
      const pages = ch.attributes?.pages || 0;
      if (existing && existing.pages >= pages) continue;
      byChapter.set(chNum, {
        id: ch.id,
        chapter: ch.attributes?.chapter || '0',
        volume: ch.attributes?.volume || null,
        title: ch.attributes?.title || '',
        pages,
        publishedAt: ch.attributes?.publishAt || null,
        group: groupRel?.attributes?.name || 'Community',
      });
    }

    let chapters = Array.from(byChapter.values()).sort(
      (a, b) => (parseFloat(b.chapter) || 0) - (parseFloat(a.chapter) || 0)
    );
    let total = json?.total || chapters.length;

    // Fallback to WeebCentral / Asura / DemonicScans if MangaDex only has external-link chapters
    if (chapters.length === 0 && offset === 0) {
      try {
        const metaRes = await fetch(`${MANGADEX_URL}/manga/${encodeURIComponent(id)}`, {
          headers: MD_HEADERS,
          signal: AbortSignal.timeout(7000),
        }).then((resp) => (resp.ok ? resp.json() : null));
        const attrs = metaRes?.data?.attributes || {};
        const titles = attrs.title || {};
        const enAlt = (Array.isArray(attrs.altTitles) ? attrs.altTitles : []).find((t: any) => t.en)?.en;
        const lookupTitle = titles.en || enAlt || titles['ja-ro'] || Object.values(titles)[0] || '';
        if (lookupTitle) {
          const mirrorChapters = await fetchMirrorChaptersForTitle(String(lookupTitle), attrs.originalLanguage || '');
          if (mirrorChapters.length > 0) {
            chapters = mirrorChapters;
            total = mirrorChapters.length;
          }
        }
      } catch {
        // Keep empty if mirror fallback also fails
      }
    }

    const payload = { chapters, total };
    setCached(cacheKey, payload, 5 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Chapters fetch failed' });
  }
});

app.get('/api/manga/pages/:chapterId', async (req, res) => {
  const chapterId = String(req.params.chapterId || '');
  const cacheKey = `md:pages:v2:${chapterId}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    if (chapterId.startsWith('wc~')) {
      const resMirror = await mangaMirrors.getPages(chapterId.slice(3), 'weebcentral');
      const pages = (resMirror?.pages || []).map((url: string, idx: number) => ({
        index: idx + 1,
        url: proxyImg(url, 'https://weebcentral.com/'),
      }));
      const payload = { pages };
      if (pages.length > 0) setCached(cacheKey, payload, 30 * 60 * 1000);
      res.json(payload);
      return;
    }

    if (chapterId.startsWith('asura~')) {
      const resMirror = await manhwaMirrors.getPages(chapterId.slice(6), 'asura');
      const pages = (resMirror?.pages || []).map((url: string, idx: number) => ({
        index: idx + 1,
        url: proxyImg(url, 'https://asurascans.com/'),
      }));
      const payload = { pages };
      if (pages.length > 0) setCached(cacheKey, payload, 30 * 60 * 1000);
      res.json(payload);
      return;
    }

    if (chapterId.startsWith('ds~')) {
      const resMirror = await manhwaMirrors.getPages(chapterId.slice(3), 'demonicscans');
      const pages = (resMirror?.pages || []).map((url: string, idx: number) => ({
        index: idx + 1,
        url: proxyImg(url, 'https://demonicscans.org/'),
      }));
      const payload = { pages };
      if (pages.length > 0) setCached(cacheKey, payload, 30 * 60 * 1000);
      res.json(payload);
      return;
    }

    const r = await fetch(`${MANGADEX_URL}/at-home/server/${encodeURIComponent(chapterId)}`, {
      headers: MD_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      res.status(r.status).json({ error: 'Chapter pages unavailable' });
      return;
    }
    const json = await r.json();
    const baseUrl = json?.baseUrl;
    const hash = json?.chapter?.hash;
    const files: string[] = json?.chapter?.dataSaver?.length ? json.chapter.dataSaver : json?.chapter?.data || [];
    const folder = json?.chapter?.dataSaver?.length ? 'data-saver' : 'data';

    const pages = files.map((file, idx) => ({
      index: idx + 1,
      url: proxyImg(`${baseUrl}/${folder}/${hash}/${file}`, 'https://mangadex.org/'),
    }));

    const payload = { pages };
    setCached(cacheKey, payload, 10 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Pages fetch failed' });
  }
});

// ---------------------------------------------------------------------------
// 6. Light Novels Endpoints (NovelFire Live Scraper + AniList Light Novel Fallback)
// ---------------------------------------------------------------------------
function parseNovelFireList(html: string) {
  const $ = cheerio.load(html);
  const items: any[] = [];
  $('.novel-item, li.novel-item').each((_, el) => {
    const a = $(el).find('a').first();
    const href = a.attr('href') || '';
    const slugMatch = href.match(/\/book\/([^/?#]+)/);
    if (!slugMatch) return;
    const slug = slugMatch[1];
    const title = $(el).find('.novel-title, h4, .title').first().text().trim() || a.attr('title') || slug;
    const img = $(el).find('img').first();
    const rawImg = img.attr('data-src') || img.attr('src') || '';
    const fullImg = rawImg.startsWith('http') ? rawImg : rawImg ? `${NOVELFIRE_URL}${rawImg.startsWith('/') ? '' : '/'}${rawImg}` : '';
    const stats = $(el).find('.novel-stats').text().trim().replace(/\s+/g, ' ');
    items.push({
      id: slug,
      slug,
      title,
      cover: fullImg ? proxyImg(fullImg, `${NOVELFIRE_URL}/`) : '',
      stats,
      source: 'novelfire',
    });
  });
  return items;
}

app.get('/api/novel/home', async (_req, res) => {
  const cacheKey = 'novel:home';
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const [popHtml, latestHtml, rankHtml] = await Promise.all([
      fetch(`${NOVELFIRE_URL}/genre-all/sort-popular/status-all/all-novel`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(9000),
      }).then((r) => r.text()),
      fetch(`${NOVELFIRE_URL}/genre-all/sort-latest-release/status-all/all-novel`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(9000),
      }).then((r) => r.text()),
      fetch(`${NOVELFIRE_URL}/genre-all/sort-new/status-all/all-novel`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(9000),
      }).then((r) => r.text()),
    ]);

    const payload = {
      popular: parseNovelFireList(popHtml).slice(0, 20),
      latest: parseNovelFireList(latestHtml).slice(0, 20),
      rankings: parseNovelFireList(rankHtml).slice(0, 20),
    };

    setCached(cacheKey, payload, 15 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'NovelFire unavailable' });
  }
});

app.get('/api/novel/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json({ results: [] });
    return;
  }
  const cacheKey = `novel:search:${q.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const html = await fetch(`${NOVELFIRE_URL}/search?keyword=${encodeURIComponent(q)}`, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(9000),
    }).then((r) => r.text());

    const results = parseNovelFireList(html).slice(0, 30);
    const payload = { results };
    setCached(cacheKey, payload, 10 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Novel search failed' });
  }
});

app.get('/api/novel/detail/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  const cacheKey = `novel:detail:${slug}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const [detailHtml, chaptersHtml] = await Promise.all([
      fetch(`${NOVELFIRE_URL}/book/${encodeURIComponent(slug)}`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(9000),
      }).then((r) => r.text()),
      fetch(`${NOVELFIRE_URL}/book/${encodeURIComponent(slug)}/chapters`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(9000),
      }).then((r) => r.text()),
    ]);

    const $ = cheerio.load(detailHtml);
    const title = $('h1.novel-title, .novel-info h1').first().text().trim() || slug.replace(/-/g, ' ');
    const author = $('span[itemprop="author"], .author a').first().text().trim() || 'Unknown';
    const rawCover = $('.cover img').attr('data-src') || $('.cover img').attr('src') || '';
    const fullCover = rawCover.startsWith('http') ? rawCover : rawCover ? `${NOVELFIRE_URL}${rawCover}` : '';
    const summary = $('.summary .content, .description').text().trim();
    const genres = $('.categories a, .genres a')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const status = $('.header-stats .completed, .header-stats .ongoing').first().text().trim() || 'Ongoing';

    const $ch = cheerio.load(chaptersHtml);
    const chapters: any[] = [];
    $ch('.chapter-list li a').each((_, el) => {
      const href = $ch(el).attr('href') || '';
      const chSlug = href.split('/').filter(Boolean).pop() || '';
      const chTitle = $ch(el).find('.chapter-title').text().trim() || $ch(el).text().trim();
      const num = $ch(el).find('.chapter-no').text().trim();
      if (chSlug) {
        chapters.push({
          slug: chSlug,
          title: chTitle.replace(/\s+/g, ' ').trim(),
          number: num || String(chapters.length + 1),
          sourceUrl: `${NOVELFIRE_URL}/book/${slug}/${chSlug}`,
        });
      }
    });

    const payload = {
      slug,
      title,
      author,
      cover: fullCover ? proxyImg(fullCover, `${NOVELFIRE_URL}/`) : '',
      summary,
      genres,
      status,
      chapters,
      sourceUrl: `${NOVELFIRE_URL}/book/${slug}`,
    };
    setCached(cacheKey, payload, 15 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Novel detail failed' });
  }
});

app.get('/api/novel/read/:slug/:chapter', async (req, res) => {
  const slug = String(req.params.slug || '');
  const chapter = String(req.params.chapter || '');
  const targetUrl = `${NOVELFIRE_URL}/book/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}`;

  try {
    const html = await fetch(targetUrl, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: `${NOVELFIRE_URL}/book/${encodeURIComponent(slug)}/chapters`,
      },
      signal: AbortSignal.timeout(9000),
    }).then((r) => r.text());

    const $ = cheerio.load(html);
    const title = $('span.chapter-title, .titles h2, h1').first().text().trim() || chapter;
    const paragraphs = $('#content p, .chapter-c p, #chapter-container p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0);

    if (paragraphs.length === 0) {
      res.json({
        title,
        paragraphs: [],
        blockedBySource: true,
        sourceUrl: targetUrl,
      });
      return;
    }

    res.json({
      title,
      paragraphs,
      blockedBySource: false,
      sourceUrl: targetUrl,
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Chapter load failed',
      sourceUrl: targetUrl,
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Movies & TV Shows Endpoints (Cinemeta Live Catalog)
// ---------------------------------------------------------------------------
function mapCinemetaItem(m: any) {
  const id = m.imdb_id || m.id;
  return {
    id,
    type: m.type === 'series' ? 'tv' : 'movie',
    title: m.name || 'Untitled',
    description: m.description || '',
    poster: m.poster || (id ? `https://images.metahub.space/poster/medium/${id}/img` : ''),
    backdrop: m.background || (id ? `https://images.metahub.space/background/medium/${id}/img` : ''),
    logo: m.logo || (id ? `https://images.metahub.space/logo/medium/${id}/img` : ''),
    year: m.year || (m.releaseInfo ? String(m.releaseInfo).slice(0, 4) : null),
    rating: m.imdbRating ? Number(m.imdbRating) : null,
    genres: Array.isArray(m.genres) ? m.genres : [],
    cast: Array.isArray(m.cast) ? m.cast : [],
    runtime: m.runtime || null,
  };
}

app.get('/api/movies/home', async (_req, res) => {
  const cacheKey = 'movies:home';
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const [topMovies, topSeries, imdbMovies, imdbSeries] = await Promise.all([
      fetch(`${CINEMETA_URL}/catalog/movie/top.json`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
      fetch(`${CINEMETA_URL}/catalog/series/top.json`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
      fetch(`${CINEMETA_URL}/catalog/movie/imdbRating.json`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
      fetch(`${CINEMETA_URL}/catalog/series/imdbRating.json`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
    ]);

    const payload = {
      popularMovies: (topMovies?.metas || []).slice(0, 20).map(mapCinemetaItem),
      popularSeries: (topSeries?.metas || []).slice(0, 20).map(mapCinemetaItem),
      topRatedMovies: (imdbMovies?.metas || []).slice(0, 20).map(mapCinemetaItem),
      topRatedSeries: (imdbSeries?.metas || []).slice(0, 20).map(mapCinemetaItem),
    };
    setCached(cacheKey, payload, 15 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Movies API unavailable' });
  }
});

app.get('/api/movies/browse', async (req, res) => {
  const type = req.query.type === 'tv' ? 'series' : 'movie';
  const catalog = req.query.sort === 'rating' ? 'imdbRating' : 'top';
  const genre = String(req.query.genre || '').trim();
  const skip = Math.max(Number(req.query.skip) || 0, 0);

  const extra: string[] = [];
  if (genre) extra.push(`genre=${encodeURIComponent(genre)}`);
  if (skip > 0) extra.push(`skip=${skip}`);
  const suffix = extra.length ? `/${extra.join('&')}.json` : '.json';
  const url = `${CINEMETA_URL}/catalog/${type}/${catalog}${suffix}`;

  const cacheKey = `movies:browse:${url}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const json = await fetch(url, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    const payload = {
      results: (json?.metas || []).map(mapCinemetaItem),
    };
    setCached(cacheKey, payload, 10 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Browse failed' });
  }
});

app.get('/api/movies/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json({ results: [] });
    return;
  }
  const cacheKey = `movies:search:${q.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const [mRes, sRes] = await Promise.all([
      fetch(`${CINEMETA_URL}/catalog/movie/top/search=${encodeURIComponent(q)}.json`, {
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.json()),
      fetch(`${CINEMETA_URL}/catalog/series/top/search=${encodeURIComponent(q)}.json`, {
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.json()),
    ]);

    const movies = (mRes?.metas || []).map(mapCinemetaItem);
    const series = (sRes?.metas || []).map(mapCinemetaItem);
    const merged: any[] = [];
    const maxLen = Math.max(movies.length, series.length);
    for (let i = 0; i < maxLen; i++) {
      if (movies[i]) merged.push(movies[i]);
      if (series[i]) merged.push(series[i]);
    }
    const payload = { results: merged.slice(0, 30) };
    setCached(cacheKey, payload, 10 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Movie search failed' });
  }
});

app.get('/api/movies/meta/:type/:id', async (req, res) => {
  const type = req.params.type === 'tv' || req.params.type === 'series' ? 'series' : 'movie';
  const id = String(req.params.id || '');
  const cacheKey = `movies:meta:${type}:${id}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const r = await fetch(`${CINEMETA_URL}/meta/${type}/${encodeURIComponent(id)}.json`, {
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) {
      res.status(r.status).json({ error: 'Title not found' });
      return;
    }
    const json = await r.json();
    const m = json?.meta;
    if (!m) {
      res.status(404).json({ error: 'Metadata missing' });
      return;
    }
    const base = mapCinemetaItem(m);
    const videos = Array.isArray(m.videos)
      ? m.videos
          .filter((v: any) => Number(v.season) > 0 && Number(v.episode) > 0)
          .map((v: any) => ({
            id: v.id,
            season: Number(v.season),
            episode: Number(v.episode),
            title: v.title || v.name || `Episode ${v.episode}`,
            overview: v.overview || '',
            thumbnail: v.thumbnail || base.backdrop,
            released: v.released || null,
          }))
      : [];

    const payload = {
      ...base,
      director: Array.isArray(m.director) ? m.director : [],
      country: m.country || null,
      awards: m.awards || null,
      videos,
    };
    setCached(cacheKey, payload, 20 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Metadata fetch failed' });
  }
});

// ---------------------------------------------------------------------------
// 7b. Payment Confirmation & Owner Admin Backend API
// ---------------------------------------------------------------------------
const OWNER_ADMIN_EMAIL = 'addii0987654@gmail.com';
const ADMIN_PW_SALT = '1b86f6c4b95114db27c52cef68505071';
const ADMIN_PW_HASH =
  'b3f4a9fb4b02ced8215ac672a2b5b9700b3cabd6ad549c911df2e8fc491e5e425aa713fb5d186612e59f282583e3913f5f83574f2ebcd828c36ed430e20d9bee';
const ADMIN_SESSION_SECRET = crypto.randomBytes(32);
const PAYMENTS_DATA_DIR = path.resolve(__dirname, '.data');
const PAYMENTS_FILE = path.join(PAYMENTS_DATA_DIR, 'payments.json');

interface ServerPaymentRecord {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  plan: 'monthly_25' | 'extra_2';
  amountInr: 25 | 2;
  referenceNumber: string;
  screenshotName?: string;
  screenshotPreview?: string;
  confirmedPaid: boolean;
  status: 'pending' | 'approved' | 'rejected';
  adminNote?: string;
  createdAt: number;
  updatedAt: number;
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ucmdypeujpesnhetvshg.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_sMODQ5GYPITHdSp04kyuTQ_aXS9Syuk';

function readPaymentsStore(): ServerPaymentRecord[] {
  try {
    if (!fs.existsSync(PAYMENTS_FILE)) return [];
    const raw = fs.readFileSync(PAYMENTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePaymentsStore(items: ServerPaymentRecord[]) {
  try {
    if (!fs.existsSync(PAYMENTS_DATA_DIR)) {
      fs.mkdirSync(PAYMENTS_DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(items.slice(0, 500), null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist payments store:', err);
  }
}

function verifyAdminPasswordInput(rawPassword: string): boolean {
  if (!rawPassword || typeof rawPassword !== 'string') return false;
  try {
    const derived = crypto.scryptSync(rawPassword, ADMIN_PW_SALT, 64);
    const expected = Buffer.from(ADMIN_PW_HASH, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function signAdminPassToken(uid: string): string {
  const exp = Date.now() + 2 * 60 * 60 * 1000;
  const payload = `${uid}.${exp}`;
  const sig = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyAdminPassToken(uid: string, tokenHeader: unknown): boolean {
  const token = String(tokenHeader || '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [tUid, expStr, sig] = parts;
  const exp = Number(expStr);
  if (tUid !== uid || !Number.isFinite(exp) || Date.now() > exp) return false;
  const expectedSig = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(`${tUid}.${expStr}`)
    .digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function verifyBearerToken(
  req: express.Request
): Promise<{ uid: string; email: string; emailVerified: boolean } | null> {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user?.id || !user?.email) return null;
    if (user.deleted_at) return null;
    if (user.banned_until && Date.parse(String(user.banned_until)) > Date.now()) return null;
    if (user.app_metadata?.banned === true) return null;
    return {
      uid: String(user.id),
      email: String(user.email).toLowerCase(),
      emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at || true),
    };
  } catch {
    return null;
  }
}

const SUBS_FILE = path.join(PAYMENTS_DATA_DIR, 'subscriptions.json');
const VIP_FREE_EMAILS = new Set([OWNER_ADMIN_EMAIL.toLowerCase(), 'notxanlos@gmail.com']);

interface ServerUserSubState {
  userId: string;
  userEmail: string;
  plan: 'monthly_25' | 'extra_2';
  amountInr: 25 | 2;
  status: 'pending' | 'active' | 'rejected' | 'expired';
  referenceNumber: string;
  screenshotName?: string;
  requestId?: string;
  adminNote?: string;
  startedAtMs: number;
  expiresAtMs: number;
  extraCredits: number;
  extraApprovedAtMs?: number;
  blocked?: boolean;
  blockedReason?: string;
  updatedAt: number;
}

function readSubsStore(): Record<string, ServerUserSubState> {
  try {
    if (!fs.existsSync(SUBS_FILE)) return {};
    const raw = fs.readFileSync(SUBS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSubsStore(map: Record<string, ServerUserSubState>) {
  try {
    if (!fs.existsSync(PAYMENTS_DATA_DIR)) {
      fs.mkdirSync(PAYMENTS_DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SUBS_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist subscriptions store:', err);
  }
}

app.get('/api/payments/my-status', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  if (VIP_FREE_EMAILS.has(caller.email.toLowerCase())) {
    const now = Date.now();
    res.json({
      subscription: {
        plan: 'monthly_25',
        amountInr: 25,
        status: 'active',
        referenceNumber: 'VIP-PASS',
        startedAtMs: now - 86400000,
        expiresAtMs: now + 3650 * 86400000,
        extraCredits: 999,
        adminNote: 'Permanent VIP Access Granted',
        updatedAt: now,
      },
      blocked: false,
      blockedReason: '',
    });
    return;
  }

  const subs = readSubsStore();
  const state = subs[caller.uid] || null;
  res.json({
    subscription: state
      ? {
          plan: state.plan,
          amountInr: state.amountInr,
          status: state.status,
          referenceNumber: state.referenceNumber,
          screenshotName: state.screenshotName,
          requestId: state.requestId,
          adminNote: state.adminNote,
          startedAtMs: state.startedAtMs,
          expiresAtMs: state.expiresAtMs,
          extraCredits: state.extraCredits || 0,
          extraApprovedAtMs: state.extraApprovedAtMs || 0,
          updatedAt: state.updatedAt,
        }
      : null,
    blocked: Boolean(state?.blocked),
    blockedReason: state?.blockedReason || '',
  });
});

app.post('/api/payments/consume-extra', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const subs = readSubsStore();
  const cur = subs[caller.uid];
  if (cur && cur.extraCredits > 0) {
    cur.extraCredits = Math.max(0, cur.extraCredits - 1);
    cur.updatedAt = Date.now();
    subs[caller.uid] = cur;
    writeSubsStore(subs);
  }
  res.json({ ok: true, extraCredits: cur?.extraCredits || 0 });
});

app.post('/api/payments/confirm', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller || !caller.emailVerified) {
    res.status(401).json({ error: 'Please sign in with your account.' });
    return;
  }

  const body = req.body || {};
  const id = String(body.id || `${caller.uid}_${Date.now()}`).replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 128);
  const plan: 'monthly_25' | 'extra_2' = body.plan === 'extra_2' ? 'extra_2' : 'monthly_25';
  const amountInr: 25 | 2 = plan === 'extra_2' ? 2 : 25;
  const referenceNumber = String(body.referenceNumber || '').trim().slice(0, 100);
  const screenshotName = String(body.screenshotName || '').trim().slice(0, 200);
  const userName = String(body.userName || caller.email.split('@')[0] || 'User').trim().slice(0, 120);
  const confirmedPaid = Boolean(body.confirmedPaid);
  const rawPreview = typeof body.screenshotPreview === 'string' ? body.screenshotPreview : '';
  const screenshotPreview =
    rawPreview.startsWith('data:image/') && rawPreview.length <= 350_000 ? rawPreview : undefined;

  if (!confirmedPaid || referenceNumber.length < 4) {
    res.status(400).json({ error: 'Confirmation and valid reference number (min 4 chars) are required.' });
    return;
  }

  const now = Date.now();
  const list = readPaymentsStore().filter((item) => item.id !== id);
  const record: ServerPaymentRecord = {
    id,
    userId: caller.uid,
    userEmail: caller.email,
    userName,
    plan,
    amountInr,
    referenceNumber,
    screenshotName: screenshotName || undefined,
    screenshotPreview,
    confirmedPaid: true,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  list.unshift(record);
  writePaymentsStore(list);

  const subs = readSubsStore();
  const prev = subs[caller.uid];
  subs[caller.uid] = {
    userId: caller.uid,
    userEmail: caller.email,
    plan,
    amountInr,
    status: 'pending',
    referenceNumber,
    screenshotName: screenshotName || undefined,
    requestId: id,
    startedAtMs: prev?.startedAtMs || 0,
    expiresAtMs: prev?.expiresAtMs || 0,
    extraCredits: prev?.extraCredits || 0,
    extraApprovedAtMs: prev?.extraApprovedAtMs || 0,
    blocked: false,
    updatedAt: now,
  };
  writeSubsStore(subs);

  res.json({ ok: true, request: record });
});

app.post('/api/admin/verify-password', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller || !caller.emailVerified || caller.email !== OWNER_ADMIN_EMAIL.toLowerCase()) {
    res.status(403).json({ error: 'Owner admin access required.' });
    return;
  }
  const password = String(req.body?.password || '');
  if (!verifyAdminPasswordInput(password)) {
    res.status(401).json({ error: 'Incorrect admin password.' });
    return;
  }
  const adminPassToken = signAdminPassToken(caller.uid);
  res.json({ ok: true, adminPassToken });
});

app.post('/api/admin/verify-session', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller || !caller.emailVerified || caller.email !== OWNER_ADMIN_EMAIL.toLowerCase()) {
    res.status(403).json({ valid: false });
    return;
  }
  const valid = verifyAdminPassToken(caller.uid, req.headers['x-admin-pass']);
  res.json({ valid });
});

app.get('/api/admin/payments', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller || !caller.emailVerified || caller.email !== OWNER_ADMIN_EMAIL.toLowerCase()) {
    res.status(403).json({ error: 'Owner admin access required.' });
    return;
  }
  if (!verifyAdminPassToken(caller.uid, req.headers['x-admin-pass'])) {
    res.status(401).json({ error: 'Admin password unlock required.' });
    return;
  }
  const items = readPaymentsStore().sort((a, b) => b.createdAt - a.createdAt);
  res.json({ requests: items });
});

app.post('/api/admin/payments/:id/approve', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller || !caller.emailVerified || caller.email !== OWNER_ADMIN_EMAIL.toLowerCase()) {
    res.status(403).json({ error: 'Owner admin access required.' });
    return;
  }
  if (!verifyAdminPassToken(caller.uid, req.headers['x-admin-pass'])) {
    res.status(401).json({ error: 'Admin password unlock required.' });
    return;
  }
  const id = String(req.params.id || '');
  const list = readPaymentsStore();
  const idx = list.findIndex((item) => item.id === id);
  if (idx < 0) {
    res.status(404).json({ error: 'Payment request not found.' });
    return;
  }

  const reqItem = list[idx];
  const isExtra = reqItem.plan === 'extra_2';
  const defaultNote = isExtra
    ? 'Your ₹2 Extra Episode Pass is verified! Enjoy 1 extra episode right now.'
    : 'Payment verified! Your 30-day VIP Royal Pass is now active.';
  const adminNote = String(req.body?.adminNote || defaultNote).slice(0, 300);
  const now = Date.now();

  list[idx] = {
    ...reqItem,
    status: 'approved',
    adminNote,
    updatedAt: now,
  };
  writePaymentsStore(list);

  const subs = readSubsStore();
  const prev = subs[reqItem.userId];
  if (isExtra) {
    const prevCredits = prev?.extraCredits || 0;
    const stillActiveMonthly = Boolean(prev && prev.plan === 'monthly_25' && prev.status === 'active' && prev.expiresAtMs > now);
    subs[reqItem.userId] = {
      userId: reqItem.userId,
      userEmail: reqItem.userEmail,
      plan: stillActiveMonthly ? 'monthly_25' : 'extra_2',
      amountInr: stillActiveMonthly ? 25 : 2,
      status: stillActiveMonthly ? 'active' : 'expired',
      referenceNumber: reqItem.referenceNumber,
      screenshotName: reqItem.screenshotName,
      requestId: reqItem.id,
      adminNote,
      startedAtMs: prev?.startedAtMs || 0,
      expiresAtMs: prev?.expiresAtMs || 0,
      extraCredits: prevCredits + 1,
      extraApprovedAtMs: now,
      blocked: false,
      updatedAt: now,
    };
  } else {
    const baseMs = prev && prev.expiresAtMs > now ? prev.expiresAtMs : now;
    const expiresAtMs = baseMs + 30 * 24 * 60 * 60 * 1000;
    subs[reqItem.userId] = {
      userId: reqItem.userId,
      userEmail: reqItem.userEmail,
      plan: 'monthly_25',
      amountInr: 25,
      status: 'active',
      referenceNumber: reqItem.referenceNumber,
      screenshotName: reqItem.screenshotName,
      requestId: reqItem.id,
      adminNote,
      startedAtMs: now,
      expiresAtMs,
      extraCredits: prev?.extraCredits || 0,
      extraApprovedAtMs: prev?.extraApprovedAtMs || 0,
      blocked: false,
      updatedAt: now,
    };
  }
  writeSubsStore(subs);

  res.json({ ok: true, request: list[idx] });
});

app.post('/api/admin/payments/:id/cancel', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller || !caller.emailVerified || caller.email !== OWNER_ADMIN_EMAIL.toLowerCase()) {
    res.status(403).json({ error: 'Owner admin access required.' });
    return;
  }
  if (!verifyAdminPassToken(caller.uid, req.headers['x-admin-pass'])) {
    res.status(401).json({ error: 'Admin password unlock required.' });
    return;
  }
  const id = String(req.params.id || '');
  const adminNote = String(req.body?.adminNote || 'Payment rejected. Fake or unverified payment accounts are blocked from the website.').slice(0, 300);
  const list = readPaymentsStore();
  const idx = list.findIndex((item) => item.id === id);
  if (idx < 0) {
    res.status(404).json({ error: 'Payment request not found.' });
    return;
  }

  const reqItem = list[idx];
  const now = Date.now();
  list[idx] = {
    ...reqItem,
    status: 'rejected',
    adminNote,
    updatedAt: now,
  };
  writePaymentsStore(list);

  const subs = readSubsStore();
  const prev = subs[reqItem.userId];
  subs[reqItem.userId] = {
    userId: reqItem.userId,
    userEmail: reqItem.userEmail,
    plan: reqItem.plan,
    amountInr: reqItem.amountInr,
    status: 'rejected',
    referenceNumber: reqItem.referenceNumber,
    screenshotName: reqItem.screenshotName,
    requestId: reqItem.id,
    adminNote,
    startedAtMs: 0,
    expiresAtMs: 0,
    extraCredits: 0,
    blocked: true,
    blockedReason: adminNote,
    updatedAt: now,
  };
  writeSubsStore(subs);

  res.json({ ok: true, request: list[idx] });
});

app.get('/download-zip', (_req, res) => {
  const zipPath = path.resolve(__dirname, 'anime_by_adi_source.zip');
  if (fs.existsSync(zipPath)) {
    res.download(zipPath, 'anime_by_adi_source.zip');
  } else {
    res.status(404).send('Zip archive not found. Please regenerate.');
  }
});

app.get('/download-prod-zip', (_req, res) => {
  const zipPath = path.resolve(__dirname, 'anime_by_adi_production_build.zip');
  if (fs.existsSync(zipPath)) {
    res.download(zipPath, 'anime_by_adi_production_build.zip');
  } else {
    res.status(404).send('Production zip archive not found. Please regenerate.');
  }
});

// ---------------------------------------------------------------------------
// 8. Vite Dev Middleware / Production Static Server
// ---------------------------------------------------------------------------
async function startServer() {
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        allowedHosts: true,
        middlewareMode: { server: httpServer },
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Aadhi server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
