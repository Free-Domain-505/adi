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

app.get('/api/tmdb/logo', async (req, res) => {
  const title = String(req.query.title || '').trim();
  const id = req.query.id ? Number(req.query.id) : undefined;
  const type = req.query.type === 'movie' ? 'movie' : 'tv';

  if (id && Number.isFinite(id) && id > 0) {
    const logoUrl = await getTmdbLogoById(id, type);
    return res.json({ logo: logoUrl });
  }

  if (!title) return res.status(400).json({ error: 'Missing title or id' });
  const cacheKey = `tmdb:logo:title:${title.toLowerCase()}`;
  const cachedLogo = getCached<{ logo: string | null }>(cacheKey);
  if (cachedLogo) return res.json(cachedLogo);

  try {
    const searchRes = await tmdbFetch('/search/multi', {
      query: title,
      include_adult: 'false',
    });
    const results = searchRes.results || [];
    const candidates = results.filter((x: any) => x.media_type === 'tv' || x.media_type === 'movie').slice(0, 3);
    for (const item of candidates) {
      const logoUrl = await getTmdbLogoById(item.id, item.media_type);
      if (logoUrl) {
        const payload = { logo: logoUrl };
        setCached(cacheKey, payload, 24 * 60 * 60 * 1000);
        return res.json(payload);
      }
    }
    const payload = { logo: null };
    setCached(cacheKey, payload, 6 * 60 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'TMDB logo lookup failed', logo: null });
  }
});

const JJK_TMDB_ID = 95479;
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

async function anilistGraphql<T = any>(query: string, variables: Record<string, any> = {}): Promise<T | null> {
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(7000),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.data ?? null;
  } catch {
    return null;
  }
}

async function getJjkAnilistSeasons() {
  const cacheKey = 'jjk:anilist:seasons:v1';
  const cached = getCached<typeof JJK_FALLBACK_SEASONS>(cacheKey);
  if (cached) return cached;

  try {
    const q = `query {
      s1: Media(id: 113415, type: ANIME) {
        id idMal title { english romaji } episodes bannerImage coverImage { extraLarge }
        relations { edges { relationType node { id idMal format episodes status title { english romaji } bannerImage coverImage { extraLarge } } } }
      }
      s2: Media(id: 145064, type: ANIME) {
        id idMal title { english romaji } episodes bannerImage coverImage { extraLarge }
        relations { edges { relationType node { id idMal format episodes status title { english romaji } bannerImage coverImage { extraLarge } } } }
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
  } catch {
    // Use static fallback below
  }
  setCached(cacheKey, JJK_FALLBACK_SEASONS, 60 * 60 * 1000);
  return JJK_FALLBACK_SEASONS;
}

async function getJjkSeasonEpisodes(seasonNum: number, fallbackBackdrop: string | null) {
  const seasons = await getJjkAnilistSeasons();
  const target = seasons.find((s) => s.number === seasonNum) || seasons[0];
  const cacheKey = `jjk:anilist:episodes:s${target.number}:v1`;
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
    fetch(`https://api.jikan.moe/v4/anime/${target.malId}/episodes?page=1`, { signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  const azEps = aniZipData?.episodes || {};
  const alMedia = alData?.Media;
  const alStreams = Array.isArray(alMedia?.streamingEpisodes) ? alMedia.streamingEpisodes : [];
  const jikanEps = Array.isArray(jikanData?.data) ? jikanData.data : [];
  const count = Math.max(
    target.episodes || 0,
    Object.keys(azEps).filter((k) => /^\d+$/.test(k)).length,
    alMedia?.episodes || 0,
    jikanEps.length
  ) || 12;

  const seasonBanner = alMedia?.bannerImage || target.banner || fallbackBackdrop || alMedia?.coverImage?.extraLarge || target.poster;

  const episodes = [];
  for (let i = 1; i <= count; i++) {
    const az = azEps[String(i)];
    const jk = jikanEps.find((x: any) => Number(x.mal_id) === i) || jikanEps[i - 1];
    const alStream = alStreams[i - 1];
    const rawAlTitle = alStream?.title ? String(alStream.title).replace(/^Episode\s*\d+\s*[-–:]\s*/i, '').trim() : '';

    const epTitle =
      az?.title?.en ||
      az?.title?.['x-jat'] ||
      jk?.title ||
      rawAlTitle ||
      `Episode ${i}`;

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
  };
  setCached(cacheKey, payload, 12 * 60 * 60 * 1000);
  return payload;
}

app.get('/api/tmdb/seasons', async (req, res) => {
  const title = String(req.query.title || '').trim();
  const id = req.query.id ? Number(req.query.id) : undefined;

  let showId = id;
  if (!showId && title) {
    const searchKey = `tmdb:search:tv:${title.toLowerCase()}`;
    let match = getCached<any>(searchKey);
    if (!match) {
      try {
        const searchRes = await tmdbFetch('/search/tv', { query: title });
        match = (searchRes.results || [])[0];
        if (match) setCached(searchKey, match, 24 * 60 * 60 * 1000);
      } catch {}
    }
    showId = match?.id;
  }

  if (!showId) return res.json({ id: null, seasons: [] });

  if (showId === JJK_TMDB_ID || /jujutsu\s*kaisen/i.test(title)) {
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

// Season Episodes with guaranteed thumbnails (AniList + MAL/AniZip override for Jujutsu Kaisen)
app.get('/api/tmdb/tv/:id/season/:season', async (req, res) => {
  const id = Number(req.params.id);
  const seasonNum = Math.max(1, Number(req.params.season) || 1);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid TV ID' });

  if (id === JJK_TMDB_ID) {
    try {
      const payload = await getJjkSeasonEpisodes(seasonNum, JJK_FALLBACK_SEASONS[0].banner);
      return res.json(payload);
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load JJK season episodes' });
    }
  }

  const cacheKey = `tmdb:tv:${id}:season:${seasonNum}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [seasonData, showData] = await Promise.all([
      tmdbFetch(`/tv/${id}/season/${seasonNum}`).catch(() => null),
      tmdbFetch(`/tv/${id}`).catch(() => null),
    ]);

    const fallbackBackdrop = showData?.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${showData.backdrop_path}`
      : showData?.poster_path
        ? `https://image.tmdb.org/t/p/w500${showData.poster_path}`
        : null;

    const rawEpisodes = seasonData?.episodes || [];
    const episodes = rawEpisodes.map((ep: any) => ({
      number: Number(ep.episode_number),
      title: ep.name ? String(ep.name).trim() : `Episode ${ep.episode_number}`,
      overview: ep.overview || '',
      thumbnail: ep.still_path
        ? `https://image.tmdb.org/t/p/w500${ep.still_path}`
        : fallbackBackdrop,
      airDate: ep.air_date || null,
      score: ep.vote_average || null,
    }));

    const payload = {
      id,
      season: seasonNum,
      seasonName: seasonData?.name || `Season ${seasonNum}`,
      episodes,
      total: episodes.length,
    };
    setCached(cacheKey, payload, 12 * 60 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch season episodes' });
  }
});

// Anime Details
app.get('/api/tmdb/anime/detail/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid show ID' });

  const cacheKey = `tmdb:anime:detail:${id}:v2`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const detail = await tmdbFetch(`/tv/${id}`, {
      append_to_response: 'images,credits,recommendations,similar,videos',
      include_image_language: 'en,ja,zh,null',
    });

    const logos = detail.images?.logos || [];
    const enLogo = logos.find((l: any) => l.iso_639_1 === 'en');
    const bestLogo = enLogo || logos.sort((a: any, b: any) => (b.vote_average || 0) - (a.vote_average || 0))[0];
    const logoUrl = bestLogo?.file_path ? `https://image.tmdb.org/t/p/w500${bestLogo.file_path}` : null;

    const formattedMedia = formatTmdbShow(detail, logoUrl);

    // Override broken TMDB merged season structure for Jujutsu Kaisen with AniList + MAL seasons
    let seasons: { number: number; name: string; episodes: number; poster?: string | null; anilistId?: number; malId?: number }[];
    let overrideEpisodeTotal: number | null = null;

    if (id === JJK_TMDB_ID) {
      const jjkSeasons = await getJjkAnilistSeasons();
      seasons = jjkSeasons.map((s) => ({
        number: s.number,
        name: s.name,
        episodes: s.episodes,
        poster: s.poster,
        anilistId: s.anilistId,
        malId: s.malId,
      }));
      overrideEpisodeTotal = jjkSeasons.reduce((acc, s) => acc + s.episodes, 0);
    } else {
      seasons = (detail.seasons || [])
        .filter((s: any) => Number(s.season_number) > 0)
        .map((s: any) => ({
          number: Number(s.season_number),
          name: s.name || `Season ${s.season_number}`,
          episodes: s.episode_count || 0,
          poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
        }));
    }

    // Extract cast
    const characters = {
      edges: (detail.credits?.cast || []).slice(0, 15).map((c: any) => ({
        role: c.character || 'Main Character',
        node: {
          id: c.id,
          name: { full: c.name },
          image: { large: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : '' },
        },
      })),
    };

    // Extract recommendations
    const recommendations = {
      nodes: (detail.recommendations?.results || []).slice(0, 14).map((r: any) => ({
        mediaRecommendation: formatTmdbShow(r),
      })),
    };

    // YouTube trailer
    const videos = detail.videos?.results || [];
    const trailerVideo = videos.find((v: any) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')) || videos[0];
    const trailer = trailerVideo?.key ? { id: trailerVideo.key, site: 'youtube' } : null;

    const payload = {
      ...formattedMedia,
      episodes: overrideEpisodeTotal ?? formattedMedia.episodes,
      logo: logoUrl,
      seasons: seasons.length > 0 ? seasons : [{ number: 1, name: 'Season 1', episodes: detail.number_of_episodes || 12, poster: null }],
      characters,
      recommendations,
      trailer,
    };

    setCached(cacheKey, payload, 6 * 60 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch anime detail' });
  }
});

// Anime Home Feed (Trending, Season, Popular, Top Rated, Upcoming)
app.get('/api/tmdb/anime/home', async (req, res) => {
  const cacheKey = 'tmdb:anime:home:v2';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [trendingRes, seasonRes, popularRes, topRes, upcomingRes] = await Promise.all([
      tmdbFetch('/discover/tv', {
        with_genres: '16',
        with_original_language: 'ja',
        sort_by: 'popularity.desc',
        page: '1',
      }),
      tmdbFetch('/discover/tv', {
        with_genres: '16',
        with_original_language: 'ja',
        sort_by: 'vote_count.desc',
        page: '1',
      }),
      tmdbFetch('/discover/tv', {
        with_genres: '16',
        with_original_language: 'ja',
        sort_by: 'popularity.desc',
        page: '2',
      }),
      tmdbFetch('/discover/tv', {
        with_genres: '16',
        with_original_language: 'ja',
        sort_by: 'vote_average.desc',
        'vote_count.gte': '120',
        page: '1',
      }),
      tmdbFetch('/discover/tv', {
        with_genres: '16',
        with_original_language: 'ja',
        'first_air_date.gte': '2024-01-01',
        sort_by: 'popularity.desc',
        page: '1',
      }),
    ]);

    // Attach logos for top trending spotlight items
    const trendingList = (trendingRes.results || []).slice(0, 18);
    const topSpotlight = trendingList.slice(0, 8);
    const logos = await Promise.all(topSpotlight.map((x: any) => getTmdbLogoById(x.id, 'tv')));

    const trending = trendingList.map((x: any, i: number) => formatTmdbShow(x, i < 8 ? logos[i] : null));
    const season = (seasonRes.results || []).slice(0, 18).map((x: any) => formatTmdbShow(x));
    const popular = (popularRes.results || []).slice(0, 18).map((x: any) => formatTmdbShow(x));
    const top = (topRes.results || []).slice(0, 18).map((x: any) => formatTmdbShow(x));
    const upcoming = (upcomingRes.results || []).slice(0, 18).map((x: any) => formatTmdbShow(x));

    const payload = { trending, season, popular, top, upcoming };
    setCached(cacheKey, payload, 30 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch anime home' });
  }
});

// Donghua Home Feed (Chinese Animation)
app.get('/api/tmdb/donghua/home', async (req, res) => {
  const cacheKey = 'tmdb:donghua:home:v2';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [trendingRes, airingRes, popularRes, topRes] = await Promise.all([
      tmdbFetch('/discover/tv', {
        with_genres: '16',
        with_original_language: 'zh',
        sort_by: 'popularity.desc',
        page: '1',
      }),
      tmdbFetch('/discover/tv', {
        with_genres: '16',
        with_original_language: 'zh',
        sort_by: 'popularity.desc',
        page: '2',
      }),
      tmdbFetch('/discover/tv', {
        with_genres: '16',
        with_original_language: 'zh',
        sort_by: 'popularity.desc',
        page: '3',
      }),
      tmdbFetch('/discover/tv', {
        with_genres: '16',
        with_original_language: 'zh',
        sort_by: 'vote_average.desc',
        'vote_count.gte': '10',
        page: '1',
      }),
    ]);

    const trendingList = (trendingRes.results || []).slice(0, 18);
    const topSpotlight = trendingList.slice(0, 8);
    const logos = await Promise.all(topSpotlight.map((x: any) => getTmdbLogoById(x.id, 'tv')));

    const trending = trendingList.map((x: any, i: number) => formatTmdbShow(x, i < 8 ? logos[i] : null));
    const airing = (airingRes.results || []).slice(0, 18).map((x: any) => formatTmdbShow(x));
    const popular = (popularRes.results || []).slice(0, 18).map((x: any) => formatTmdbShow(x));
    const top = (topRes.results || []).slice(0, 18).map((x: any) => formatTmdbShow(x));

    const payload = { trending, airing, popular, top };
    setCached(cacheKey, payload, 30 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch donghua home' });
  }
});

const TMDB_GENRE_MAP: Record<string, string> = {
  Action: '10759',
  Adventure: '10759',
  Comedy: '35',
  Drama: '18',
  Fantasy: '10765',
  Mystery: '9648',
  'Sci-Fi': '10765',
  Thriller: '9648',
  Psychological: '18',
  Romance: '18',
};

// Anime & Donghua Browse / Search
app.get('/api/tmdb/anime/browse', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const country = String(req.query.country || 'JP').toUpperCase();
  const isChinese = country === 'CN';
  const lang = isChinese ? 'zh' : 'ja';
  const genre = String(req.query.genre || '').trim();
  const sort = String(req.query.sort || 'TRENDING_DESC');

  const cacheKey = `tmdb:browse:${query}:${page}:${country}:${genre}:${sort}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    let tmdbData: any;
    if (query) {
      tmdbData = await tmdbFetch('/search/tv', {
        query,
        page,
        include_adult: 'false',
      });
    } else {
      const mappedGenre = genre && TMDB_GENRE_MAP[genre] ? `16,${TMDB_GENRE_MAP[genre]}` : '16';
      let sortBy = 'popularity.desc';
      if (sort === 'SCORE_DESC') sortBy = 'vote_average.desc';
      else if (sort === 'START_DATE_DESC') sortBy = 'first_air_date.desc';

      const params: Record<string, string | number> = {
        with_genres: mappedGenre,
        with_original_language: lang,
        page,
        sort_by: sortBy,
      };
      if (sort === 'SCORE_DESC') {
        params['vote_count.gte'] = isChinese ? 10 : 80;
      }
      tmdbData = await tmdbFetch('/discover/tv', params);
    }

    const items = (tmdbData.results || []).map((x: any) => formatTmdbShow(x));
    const payload = {
      items,
      page: Number(tmdbData.page || 1),
      totalPages: Number(tmdbData.total_pages || 1),
      hasNextPage: Number(tmdbData.page || 1) < Number(tmdbData.total_pages || 1),
    };
    setCached(cacheKey, payload, 10 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to browse anime', items: [], hasNextPage: false });
  }
});

// Airing Schedule (TMDB animation airing shows)
app.get('/api/tmdb/schedule', async (req, res) => {
  const cacheKey = 'tmdb:schedule:v2';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await tmdbFetch('/discover/tv', {
      with_genres: '16',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      'air_date.gte': new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10),
      page: '1',
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const items = (data.results || []).slice(0, 24).map((x: any, idx: number) => {
      const media = formatTmdbShow(x);
      return {
        id: media.id,
        episode: 1,
        airingAt: nowSec + (idx % 7) * 86400,
        media,
      };
    });
    const payload = { schedules: items };
    setCached(cacheKey, payload, 60 * 60 * 1000);
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load schedule', schedules: [] });
  }
});

// Legacy / Direct episode list mapping with guaranteed thumbnail
app.get('/api/anime/:id/episodes', async (req, res) => {
  const id = Number(req.params.id);
  const season = Math.max(1, Number(req.query.season) || 1);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid anime ID' });

  if (id === JJK_TMDB_ID) {
    try {
      const payload = await getJjkSeasonEpisodes(season, JJK_FALLBACK_SEASONS[0].banner);
      return res.json(payload);
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load JJK episodes' });
    }
  }

  const cacheKey = `episodes:tmdb:${id}:s${season}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [seasonData, showData] = await Promise.all([
      tmdbFetch(`/tv/${id}/season/${season}`).catch(() => null),
      tmdbFetch(`/tv/${id}`).catch(() => null),
    ]);

    const fallbackThumb = showData?.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${showData.backdrop_path}`
      : showData?.poster_path
        ? `https://image.tmdb.org/t/p/w500${showData.poster_path}`
        : null;

    const rawEpisodes = seasonData?.episodes || [];
    const count = Math.max(rawEpisodes.length, showData?.number_of_episodes || 1);
    const episodes = [];

    if (rawEpisodes.length > 0) {
      for (const ep of rawEpisodes) {
        episodes.push({
          number: Number(ep.episode_number),
          title: ep.name ? String(ep.name).trim() : `Episode ${ep.episode_number}`,
          thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : fallbackThumb,
          overview: ep.overview || '',
        });
      }
    } else {
      for (let i = 1; i <= Math.min(count, 100); i++) {
        episodes.push({
          number: i,
          title: `Episode ${i}`,
          thumbnail: fallbackThumb,
          overview: '',
        });
      }
    }

    const payload = {
      episodes,
      total: episodes.length,
      ids: { themoviedb: id },
    };
    setCached(cacheKey, payload, 15 * 60 * 1000);
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
  const streams: { id: string; name: string; language: 'hindi' | 'english'; note: string; url: string }[] = [];
  const rawQuery = normalizeTitleStr(title || romaji);
  if (!rawQuery) return streams;

  const season = explicitSeason && explicitSeason > 0 ? explicitSeason : extractSeasonNum(title || romaji);
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

  if (!matchedHref) return streams;

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
                    streams.push({
                      id: 'salt-hindi',
                      name: 'Hindi Server HD',
                      language: 'hindi',
                      note: 'Hindi Audio · Mobile & PC',
                      url: link,
                    });
                  } else if (lang === 'english') {
                    streams.push({
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
          streams.push({
            id: 'salt-multi',
            name: 'Multi-Audio (Hindi / Eng)',
            language: 'hindi',
            note: 'Switch Hindi / English inside player',
            url: src,
          });
        }
      }

      if (streams.length > 0) break;
    } catch {
      // Try next ep URL
    }
  }

  return streams;
}

app.get('/api/anime/streams', async (req, res) => {
  const title = String(req.query.title || '');
  const romaji = String(req.query.romaji || '');
  const ep = Math.max(1, Number(req.query.ep) || 1);
  const season = Math.max(0, Number(req.query.season) || 0);
  const absEp = Math.max(0, Number(req.query.absEp) || 0);
  const isMovie = req.query.isMovie === 'true';

  const cacheKey = `anime:streams:v2:${title}:${romaji}:s${season}:e${ep}:a${absEp}:${isMovie}`;
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

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pslxlbcvvjenuhochzvh.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_23NfXkRXGdqiBxwtJu2ymA_UoCAWuvu';

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
