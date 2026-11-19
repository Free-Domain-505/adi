import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '1mb' }));

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

const ANILIST_URL = 'https://graphql.anilist.co';
const MANGADEX_URL = 'https://api.mangadex.org';
const NOVELFIRE_URL = 'https://novelfire.net';
const CINEMETA_URL = 'https://v3-cinemeta.strem.io';
const ARM_URL = 'https://arm.haglund.dev/api/v2/ids';
const KITSU_URL = 'https://kitsu.io/api/edge';

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
// 2. AniList GraphQL Proxy + Cache
// ---------------------------------------------------------------------------
app.post('/api/anilist', async (req, res) => {
  try {
    const { query, variables } = req.body || {};
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Missing GraphQL query' });
      return;
    }
    const cacheKey = `anilist:${query}:${JSON.stringify(variables || {})}`;
    const cached = getCached(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const upstream = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Aadhi/1.0',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(12000),
    });

    const json = await upstream.json().catch(() => null);
    if (!upstream.ok || !json?.data) {
      res.status(upstream.status || 502).json(json || { error: 'AniList request failed' });
      return;
    }

    setCached(cacheKey, json, 5 * 60 * 1000);
    res.json(json);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'AniList proxy error' });
  }
});

// ---------------------------------------------------------------------------
// 3. ARM ID Mapping (AniList -> MAL, TMDB, IMDb, Kitsu)
// ---------------------------------------------------------------------------
app.get('/api/ids/anilist/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid ID' });
    return;
  }
  const cacheKey = `arm:${id}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const r = await fetch(`${ARM_URL}?source=anilist&id=${id}`, {
      headers: { 'User-Agent': 'Aadhi/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) {
      res.json({ anilist: id });
      return;
    }
    const data = await r.json();
    setCached(cacheKey, data, 24 * 60 * 60 * 1000);
    res.json(data);
  } catch {
    res.json({ anilist: id });
  }
});

// ---------------------------------------------------------------------------
// 4. Anime Episode List (AniList streamingEpisodes + Kitsu episodes fallback)
// ---------------------------------------------------------------------------
app.get('/api/anime/:id/episodes', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid anime ID' });
    return;
  }
  const cacheKey = `episodes:${id}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          episodes
          status
          nextAiringEpisode { episode }
          bannerImage
          coverImage { extraLarge large }
          streamingEpisodes { title thumbnail url site }
        }
      }
    `;
    const [alRes, armRes] = await Promise.allSettled([
      fetch(ANILIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables: { id } }),
        signal: AbortSignal.timeout(9000),
      }).then((r) => r.json()),
      fetch(`${ARM_URL}?source=anilist&id=${id}`, {
        headers: { 'User-Agent': 'Aadhi/1.0' },
        signal: AbortSignal.timeout(6000),
      }).then((r) => (r.ok ? r.json() : null)),
    ]);

    const media = alRes.status === 'fulfilled' ? alRes.value?.data?.Media : null;
    const arm = armRes.status === 'fulfilled' ? armRes.value : null;

    let totalEpisodes = media?.episodes || 0;
    if (!totalEpisodes && media?.nextAiringEpisode?.episode) {
      totalEpisodes = Math.max(1, media.nextAiringEpisode.episode - 1);
    }

    const streaming = Array.isArray(media?.streamingEpisodes) ? media.streamingEpisodes : [];
    const episodeMap = new Map<number, { number: number; title: string; thumbnail: string | null }>();

    for (const ep of streaming) {
      const match = String(ep.title || '').match(/Episode\s+(\d+(?:\.\d+)?)\s*(?:-|:)?\s*(.*)/i);
      const num = match ? Math.floor(Number(match[1])) : episodeMap.size + 1;
      const cleanTitle = match && match[2] ? match[2].trim() : ep.title || `Episode ${num}`;
      if (num > 0 && !episodeMap.has(num)) {
        episodeMap.set(num, {
          number: num,
          title: cleanTitle,
          thumbnail: ep.thumbnail || null,
        });
      }
    }

    // Try Kitsu episodes if we don't have enough titles
    if (arm?.kitsu && episodeMap.size < Math.min(totalEpisodes || 24, 24)) {
      try {
        const kRes = await fetch(
          `${KITSU_URL}/anime/${arm.kitsu}/episodes?page[limit]=20&page[offset]=0`,
          { headers: { Accept: 'application/vnd.api+json' }, signal: AbortSignal.timeout(5000) }
        );
        if (kRes.ok) {
          const kJson = await kRes.json();
          const kEps = kJson?.data || [];
          for (const item of kEps) {
            const num = Number(item?.attributes?.number);
            if (!num) continue;
            const existing = episodeMap.get(num);
            const kTitle = item?.attributes?.canonicalTitle || item?.attributes?.titles?.en_us || `Episode ${num}`;
            const kThumb = item?.attributes?.thumbnail?.original || null;
            if (!existing) {
              episodeMap.set(num, { number: num, title: kTitle, thumbnail: kThumb });
            } else if (!existing.thumbnail && kThumb) {
              existing.thumbnail = kThumb;
            }
          }
          if (!totalEpisodes && kJson?.meta?.count) {
            totalEpisodes = Number(kJson.meta.count);
          }
        }
      } catch {
        // Ignore kitsu failure
      }
    }

    const count = Math.max(totalEpisodes || 0, episodeMap.size, 1);
    const cappedCount = Math.min(count, 2000);
    const episodes = [];
    for (let i = 1; i <= cappedCount; i++) {
      const found = episodeMap.get(i);
      episodes.push({
        number: i,
        title: found?.title || `Episode ${i}`,
        thumbnail: found?.thumbnail || media?.bannerImage || media?.coverImage?.extraLarge || null,
      });
    }

    const payload = { episodes, total: cappedCount, ids: arm || { anilist: id } };
    setCached(cacheKey, payload, 15 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load episodes' });
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

async function resolveAnimeSaltStreams(title: string, romaji: string, ep: number, isMovie: boolean) {
  const streams: { id: string; name: string; language: 'hindi' | 'english'; note: string; url: string }[] = [];
  const rawQuery = normalizeTitleStr(title || romaji);
  if (!rawQuery) return streams;

  const season = extractSeasonNum(title || romaji);
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
    : [
        `https://animesalt.cx/episode/${slug}-${season}x${ep}/`,
        ...(season !== 1 ? [`https://animesalt.cx/episode/${slug}-1x${ep}/`] : []),
      ];

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
  const isMovie = req.query.isMovie === 'true';

  const cacheKey = `anime:streams:${title}:${romaji}:${ep}:${isMovie}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const saltStreams = await resolveAnimeSaltStreams(title, romaji, ep, isMovie);
    const payload = { streams: saltStreams };
    setCached(cacheKey, payload, 15 * 60 * 1000);
    res.json(payload);
  } catch {
    res.json({ streams: [] });
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
    const baseQuery = `includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&hasAvailableChapters=true${langParam}`;

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

app.get('/api/manga/chapters/:id', async (req, res) => {
  const id = String(req.params.id || '');
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const cacheKey = `md:chapters:${id}:${offset}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const url = `${MANGADEX_URL}/manga/${encodeURIComponent(id)}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=100&offset=${offset}&includes[]=scanlation_group`;
    const r = await fetch(url, { headers: MD_HEADERS, signal: AbortSignal.timeout(10000) });
    const json = await r.json();
    const chapters = (json?.data || [])
      .filter((ch: any) => !ch?.attributes?.externalUrl && Number(ch?.attributes?.pages || 0) > 0)
      .map((ch: any) => {
        const groupRel = (ch.relationships || []).find((rel: any) => rel.type === 'scanlation_group');
        return {
          id: ch.id,
          chapter: ch.attributes?.chapter || '0',
          volume: ch.attributes?.volume || null,
          title: ch.attributes?.title || '',
          pages: ch.attributes?.pages || 0,
          publishedAt: ch.attributes?.publishAt || null,
          group: groupRel?.attributes?.name || 'Community',
        };
      });

    const payload = { chapters, total: json?.total || chapters.length };
    setCached(cacheKey, payload, 5 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Chapters fetch failed' });
  }
});

app.get('/api/manga/pages/:chapterId', async (req, res) => {
  const chapterId = String(req.params.chapterId || '');
  const cacheKey = `md:pages:${chapterId}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
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

function getFirebaseApiKey(): string {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed?.apiKey || '');
  } catch {
    return '';
  }
}

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
  const idToken = header.slice(7).trim();
  if (!idToken) return null;

  const apiKey = getFirebaseApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(7000),
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const user = json?.users?.[0];
    if (!user?.localId || !user?.email) return null;
    return {
      uid: String(user.localId),
      email: String(user.email).toLowerCase(),
      emailVerified: Boolean(user.emailVerified),
    };
  } catch {
    return null;
  }
}

app.post('/api/payments/confirm', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller || !caller.emailVerified) {
    res.status(401).json({ error: 'Please sign in with a verified Google account.' });
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
  const adminNote = String(req.body?.adminNote || 'Payment verified! Your 30-day VIP Royal Pass is now active.').slice(0, 300);
  const list = readPaymentsStore();
  const idx = list.findIndex((item) => item.id === id);
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      status: 'approved',
      adminNote,
      updatedAt: Date.now(),
    };
    writePaymentsStore(list);
    res.json({ ok: true, request: list[idx] });
  } else {
    res.json({ ok: true });
  }
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
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      status: 'rejected',
      adminNote,
      updatedAt: Date.now(),
    };
    writePaymentsStore(list);
    res.json({ ok: true, request: list[idx] });
  } else {
    res.json({ ok: true });
  }
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
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Aadhi server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
