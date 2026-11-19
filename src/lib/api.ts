import type {
  AiringItem,
  AnimeMedia,
  EpisodeInfo,
  IdMapping,
  MangaChapter,
  MangaItem,
  MovieItem,
  NovelDetail,
  NovelItem,
} from '../types';

export const ANIME_GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Fantasy',
  'Horror',
  'Mahou Shoujo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
];

export function pickTitle(t?: { english?: string | null; romaji?: string | null; native?: string | null } | null): string {
  if (!t) return 'Untitled';
  return t.english || t.romaji || t.native || 'Untitled';
}

export function stripHtml(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function getCurrentSeason(): { season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'; year: number } {
  const now = new Date();
  const m = now.getMonth() + 1;
  const year = now.getFullYear();
  if (m <= 3) return { season: 'WINTER', year };
  if (m <= 6) return { season: 'SPRING', year };
  if (m <= 9) return { season: 'SUMMER', year };
  return { season: 'FALL', year };
}

export function formatSeasonLabel(season?: string | null, year?: number | null): string {
  if (!season && !year) return '';
  const s = season ? season.charAt(0).toUpperCase() + season.slice(1).toLowerCase() : '';
  return [s, year].filter(Boolean).join(' ');
}

export function formatRelativeTime(unixSec: number): string {
  const diff = unixSec - Math.floor(Date.now() / 1000);
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60);
  const hours = Math.floor(abs / 3600);
  const days = Math.floor(abs / 86400);
  if (diff >= 0) {
    if (days > 0) return `in ${days}d ${Math.floor((abs % 86400) / 3600)}h`;
    if (hours > 0) return `in ${hours}h ${Math.floor((abs % 3600) / 60)}m`;
    return `in ${Math.max(1, mins)}m`;
  }
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${Math.max(1, mins)}m ago`;
}

const memCache = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

async function cachedCall<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = fn()
    .then((data) => {
      memCache.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

// TMDB-powered Anime and Donghua API Client
export async function fetchAnimeHome(): Promise<{
  trending: AnimeMedia[];
  season: AnimeMedia[];
  popular: AnimeMedia[];
  top: AnimeMedia[];
  upcoming: AnimeMedia[];
}> {
  return cachedCall('tmdb:anime:home', 10 * 60 * 1000, async () => {
    const res = await fetch('/api/tmdb/anime/home');
    if (!res.ok) throw new Error('Failed to fetch anime from TMDB');
    return res.json();
  });
}

export async function fetchDonghuaHome(): Promise<{
  trending: AnimeMedia[];
  popular: AnimeMedia[];
  top: AnimeMedia[];
  airing: AnimeMedia[];
}> {
  return cachedCall('tmdb:donghua:home', 10 * 60 * 1000, async () => {
    const res = await fetch('/api/tmdb/donghua/home');
    if (!res.ok) throw new Error('Failed to fetch donghua from TMDB');
    return res.json();
  });
}

export async function fetchLatestAiringEpisodes(): Promise<AiringItem[]> {
  return cachedCall('tmdb:latest:airing', 15 * 60 * 1000, async () => {
    try {
      const res = await fetch('/api/tmdb/schedule');
      if (res.ok) {
        const data = await res.json();
        return data.schedules || [];
      }
    } catch {}
    return [];
  });
}

export async function fetchWeeklySchedule(): Promise<AiringItem[]> {
  return cachedCall('tmdb:weekly:schedule', 30 * 60 * 1000, async () => {
    try {
      const res = await fetch('/api/tmdb/schedule');
      if (res.ok) {
        const data = await res.json();
        return data.schedules || [];
      }
    } catch {}
    return [];
  });
}

export async function browseAnime(opts: {
  page?: number;
  perPage?: number;
  search?: string;
  genre?: string;
  format?: string;
  status?: string;
  season?: string;
  year?: number;
  sort?: string;
  countryOfOrigin?: string;
}): Promise<{ items: AnimeMedia[]; hasNextPage: boolean }> {
  const params = new URLSearchParams();
  if (opts.search) params.set('q', opts.search);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.genre) params.set('genre', opts.genre);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.countryOfOrigin) params.set('country', opts.countryOfOrigin);

  return cachedCall(`tmdb:browse:${params.toString()}`, 5 * 60 * 1000, async () => {
    const res = await fetch(`/api/tmdb/anime/browse?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to browse anime from TMDB');
    const data = await res.json();
    return {
      items: data.items || [],
      hasNextPage: Boolean(data.hasNextPage),
    };
  });
}

export async function fetchAnimeDetail(id: number): Promise<AnimeMedia> {
  return cachedCall(`tmdb:detail:${id}:v2`, 15 * 60 * 1000, async () => {
    const res = await fetch(`/api/tmdb/anime/detail/${id}`);
    if (!res.ok) throw new Error('Failed to fetch anime details from TMDB');
    return res.json();
  });
}

export async function fetchAnimeEpisodes(
  id: number,
  season = 1
): Promise<{
  episodes: EpisodeInfo[];
  total: number;
  ids: IdMapping & { anilist?: number; mal?: number };
  anilistId?: number;
  malId?: number;
  absoluteOffset?: number;
  seasons?: { number: number; name: string; episodes: number; poster?: string | null }[];
}> {
  return cachedCall(`tmdb:episodes:${id}:s${season}:v2`, 15 * 60 * 1000, async () => {
    const res = await fetch(`/api/tmdb/tv/${id}/season/${season}`);
    if (!res.ok) {
      // Fallback to legacy endpoint if season route fails
      const fallbackRes = await fetch(`/api/anime/${id}/episodes?season=${season}`);
      if (fallbackRes.ok) return fallbackRes.json();
      throw new Error('Failed to load season episodes from TMDB');
    }
    const data = await res.json();
    return {
      episodes: data.episodes || [],
      total: data.total || data.episodes?.length || 0,
      ids: data.ids || { themoviedb: id },
      anilistId: data.anilistId || undefined,
      malId: data.malId || undefined,
      absoluteOffset: Number(data.absoluteOffset) || 0,
    };
  });
}

export async function fetchTmdbLogo(title: string, id?: number, type: 'tv' | 'movie' = 'tv'): Promise<string | null> {
  const params = new URLSearchParams();
  if (id) params.set('id', String(id));
  if (title) params.set('title', title);
  params.set('type', type);
  return cachedCall(`tmdb:logo:${params.toString()}`, 24 * 60 * 60 * 1000, async () => {
    try {
      const res = await fetch(`/api/tmdb/logo?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        return data.logo || null;
      }
    } catch {}
    return null;
  });
}

export async function fetchTmdbSeasons(
  id?: number,
  title?: string
): Promise<{ id: number | null; seasons: { number: number; name: string; episodes: number; poster?: string | null }[] }> {
  const params = new URLSearchParams();
  if (id) params.set('id', String(id));
  if (title) params.set('title', title);
  return cachedCall(`tmdb:seasons:${params.toString()}`, 24 * 60 * 60 * 1000, async () => {
    try {
      const res = await fetch(`/api/tmdb/seasons?${params.toString()}`);
      if (res.ok) return res.json();
    } catch {}
    return { id: id || null, seasons: [] };
  });
}

export interface ResolvedStream {
  id: string;
  name: string;
  language: 'hindi' | 'english';
  note: string;
  url: string;
}

export interface DirectVideoStream {
  id: string;
  audio?: 'sub' | 'dub';
  language?: 'english' | 'hindi';
  format: 'hls' | 'file';
  streamUrl: string;
  subtitles?: { file: string; label: string; default?: boolean }[];
}

export async function fetchAnimeStreams(opts: {
  title: string;
  romaji?: string;
  ep: number;
  season?: number;
  absEp?: number;
  isMovie?: boolean;
}): Promise<ResolvedStream[]> {
  const params = new URLSearchParams({
    title: opts.title,
    romaji: opts.romaji || '',
    ep: String(opts.ep),
    ...(opts.season ? { season: String(opts.season) } : {}),
    ...(opts.absEp ? { absEp: String(opts.absEp) } : {}),
    isMovie: String(Boolean(opts.isMovie)),
  });
  return cachedCall(`streams:${params.toString()}`, 10 * 60 * 1000, async () => {
    try {
      const r = await fetch(`/api/anime/streams?${params.toString()}`);
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) {
        const json = await r.json();
        if (Array.isArray(json?.streams) && json.streams.length > 0) {
          return json.streams;
        }
      }
    } catch {
      // Fall through
    }
    // Return empty list so player smoothly falls back to verified ANIME_ENGLISH_SERVERS (VidLink, ZokoAnime, 2Embed, VidSrc)
    return [];
  });
}

export async function fetchDirectAnimeStreams(opts: {
  anilistId?: number;
  title: string;
  romaji?: string;
  season?: number;
  ep: number;
  format?: string;
}): Promise<DirectVideoStream[]> {
  const params = new URLSearchParams({
    ...(opts.anilistId ? { anilistId: String(opts.anilistId) } : {}),
    title: opts.title,
    romaji: opts.romaji || '',
    season: String(opts.season || 1),
    ep: String(opts.ep),
    format: opts.format || 'TV',
  });
  return cachedCall(`direct:anime:${params.toString()}`, 8 * 60 * 1000, async () => {
    try {
      const r = await fetch(`/api/anime/direct-streams?${params.toString()}`);
      if (r.ok) {
        const json = await r.json();
        if (Array.isArray(json?.streams)) return json.streams;
      }
    } catch {}
    return [];
  });
}

export async function fetchDirectMovieStreams(opts: {
  id: string;
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
  title?: string;
  year?: string | null;
}): Promise<{ streams: DirectVideoStream[]; subtitles: { file: string; label: string; default?: boolean }[] }> {
  const params = new URLSearchParams({
    id: opts.id,
    type: opts.type,
    s: String(opts.season || 1),
    e: String(opts.episode || 1),
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.year ? { year: opts.year } : {}),
  });
  return cachedCall(`direct:movies:${params.toString()}`, 8 * 60 * 1000, async () => {
    try {
      const r = await fetch(`/api/movies/direct-streams?${params.toString()}`);
      if (r.ok) {
        const json = await r.json();
        return {
          streams: Array.isArray(json?.streams) ? json.streams : [],
          subtitles: Array.isArray(json?.subtitles) ? json.subtitles : [],
        };
      }
    } catch {}
    return { streams: [], subtitles: [] };
  });
}

// Manga & Manhwa
export async function fetchMangaHome(kind: 'manga' | 'manhwa' = 'manga'): Promise<{
  trending: MangaItem[];
  latest: MangaItem[];
  topRated: MangaItem[];
}> {
  return cachedCall(`manga:home:${kind}:v2`, 5 * 60 * 1000, async () => {
    const r = await fetch(`/api/manga/home?kind=${kind}`);
    const json = await r.json();
    if (r.ok && json?.trending) return json;
    throw new Error(json?.error || 'Failed to load catalog');
  });
}

export async function searchManga(q: string, kind: '' | 'manga' | 'manhwa' = '', offset = 0): Promise<{ results: MangaItem[]; total: number }> {
  const params = new URLSearchParams({ q, offset: String(offset), limit: '24' });
  if (kind) params.set('kind', kind);
  return cachedCall(`manga:search:${params.toString()}:v2`, 3 * 60 * 1000, async () => {
    const r = await fetch(`/api/manga/search?${params.toString()}`);
    const json = await r.json();
    if (r.ok && json?.results) return json;
    return { results: [], total: 0 };
  });
}

export async function fetchMangaDetail(id: string): Promise<MangaItem> {
  return cachedCall(`manga:detail:${id}`, 10 * 60 * 1000, async () => {
    const r = await fetch(`/api/manga/detail/${encodeURIComponent(id)}`);
    const json = await r.json();
    if (!r.ok) throw new Error(json?.error || 'Manga not found');
    return json;
  });
}

export async function fetchMangaChapters(id: string, offset = 0): Promise<{ chapters: MangaChapter[]; total: number }> {
  return cachedCall(`manga:chapters:${id}:${offset}:v2`, 5 * 60 * 1000, async () => {
    const r = await fetch(`/api/manga/chapters/${encodeURIComponent(id)}?offset=${offset}`);
    const json = await r.json();
    if (!r.ok) throw new Error(json?.error || 'Failed to load chapters');
    return json;
  });
}

export async function fetchMangaPages(chapterId: string): Promise<{ pages: { index: number; url: string }[] }> {
  return cachedCall(`manga:pages:${chapterId}:v2`, 10 * 60 * 1000, async () => {
    const r = await fetch(`/api/manga/pages/${encodeURIComponent(chapterId)}`);
    const json = await r.json();
    if (!r.ok) throw new Error(json?.error || 'Failed to load chapter pages');
    return json;
  });
}

// Light Novels
export async function fetchNovelHome(): Promise<{ popular: NovelItem[]; latest: NovelItem[]; rankings: NovelItem[] }> {
  return cachedCall('novel:home:v2', 10 * 60 * 1000, async () => {
    for (const source of ['novelfire', 'lnori']) {
      try {
        const r = await fetch(`/api/streaming/novel/home?source=${source}`);
        const json = await r.json();
        if (r.ok && ((json.popular && json.popular.length > 0) || (json.latest && json.latest.length > 0))) {
          return {
            popular: json.popular || [],
            latest: json.latest || [],
            rankings: json.rankings || [],
          };
        }
      } catch {
        // try next source
      }
    }
    throw new Error('Novel catalog unavailable right now');
  });
}

export async function searchNovels(q: string): Promise<{ results: NovelItem[] }> {
  return cachedCall(`novel:search:${q.toLowerCase()}:v2`, 5 * 60 * 1000, async () => {
    const source = 'novelfire';
    const r = await fetch(`/api/streaming/novel/search?source=${source}&q=${encodeURIComponent(q)}`);
    const json = await r.json();
    if (r.ok && Array.isArray(json.results) && json.results.length > 0) {
      return { results: json.results };
    }
    const r2 = await fetch(`/api/streaming/novel/search?source=lnori&q=${encodeURIComponent(q)}`);
    const json2 = await r2.json().catch(() => ({}));
    return { results: json2.results || [] };
  });
}

export async function fetchNovelDetail(slug: string): Promise<NovelDetail> {
  const source = slug.includes('~') ? 'lnori' : 'novelfire';
  return cachedCall(`novel:detail:${source}:${slug}:v2`, 10 * 60 * 1000, async () => {
    const qs = `source=${source}&slug=${encodeURIComponent(slug)}`;
    const [detailRes, chaptersRes] = await Promise.all([
      fetch(`/api/streaming/novel/detail?${qs}`),
      fetch(`/api/streaming/novel/chapters?${qs}`),
    ]);
    const detailJson = await detailRes.json();
    const chaptersJson = await chaptersRes.json();
    if (!detailRes.ok) throw new Error(detailJson?.error || 'Novel not found');
    const d = detailJson.detail || detailJson;
    const chapters = chaptersJson.chapters || chaptersJson.results || [];
    return {
      slug: d.slug || slug,
      title: d.title || 'Untitled',
      author: d.author || 'Unknown',
      cover: d.cover || d.poster || '',
      summary: d.summary || d.synopsis || '',
      genres: d.genres || [],
      status: d.status || 'Unknown',
      chapters: chapters.map((c: any) => ({
        slug: c.slug || c.id,
        title: c.title || `Chapter ${c.number || ''}`,
        number: String(c.number || ''),
        sourceUrl: c.url || '',
      })),
      sourceUrl: d.sourceUrl || d.url || '',
    } as NovelDetail;
  });
}

export async function fetchNovelChapter(
  slug: string,
  chapter: string
): Promise<{ title: string; paragraphs: string[]; blockedBySource?: boolean; sourceUrl: string }> {
  const source = slug.includes('~') || chapter.includes('~') ? 'lnori' : 'novelfire';
  const params = new URLSearchParams({ source, novelSlug: slug, chapterSlug: chapter });
  const r = await fetch(`/api/streaming/novel/read?${params}`);
  const json = await r.json();
  if (!r.ok && !json?.sourceUrl) throw new Error(json?.error || 'Chapter unavailable');
  return json;
}

// Movies & TV
function mapCinemetaItem(m: any): MovieItem {
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

const CINEMETA_URL = 'https://v3-cinemeta.strem.io';

export async function fetchMoviesHome(): Promise<{
  popularMovies: MovieItem[];
  popularSeries: MovieItem[];
  topRatedMovies: MovieItem[];
  topRatedSeries: MovieItem[];
}> {
  return cachedCall('movies:home', 10 * 60 * 1000, async () => {
    try {
      const r = await fetch('/api/movies/home');
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) {
        const json = await r.json();
        if (json?.popularMovies) return json;
      }
    } catch {
      // Fall through
    }

    const [topMovies, topSeries, imdbMovies, imdbSeries] = await Promise.all([
      fetch(`${CINEMETA_URL}/catalog/movie/top.json`).then((r) => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA_URL}/catalog/series/top.json`).then((r) => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA_URL}/catalog/movie/imdbRating.json`).then((r) => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA_URL}/catalog/series/imdbRating.json`).then((r) => r.json()).catch(() => ({ metas: [] })),
    ]);

    return {
      popularMovies: (topMovies?.metas || []).slice(0, 20).map(mapCinemetaItem),
      popularSeries: (topSeries?.metas || []).slice(0, 20).map(mapCinemetaItem),
      topRatedMovies: (imdbMovies?.metas || []).slice(0, 20).map(mapCinemetaItem),
      topRatedSeries: (imdbSeries?.metas || []).slice(0, 20).map(mapCinemetaItem),
    };
  });
}

export async function browseMovies(opts: {
  type: 'movie' | 'tv';
  sort?: 'popular' | 'rating';
  genre?: string;
  skip?: number;
}): Promise<{ results: MovieItem[] }> {
  const params = new URLSearchParams({ type: opts.type });
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.genre) params.set('genre', opts.genre);
  if (opts.skip) params.set('skip', String(opts.skip));
  return cachedCall(`movies:browse:${params.toString()}`, 5 * 60 * 1000, async () => {
    try {
      const r = await fetch(`/api/movies/browse?${params.toString()}`);
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) {
        const json = await r.json();
        if (json?.results) return json;
      }
    } catch {
      // Fall through
    }

    const type = opts.type === 'tv' ? 'series' : 'movie';
    const catalog = opts.sort === 'rating' ? 'imdbRating' : 'top';
    const extra: string[] = [];
    if (opts.genre) extra.push(`genre=${encodeURIComponent(opts.genre)}`);
    if (opts.skip && opts.skip > 0) extra.push(`skip=${opts.skip}`);
    const suffix = extra.length ? `/${extra.join('&')}.json` : '.json';
    const url = `${CINEMETA_URL}/catalog/${type}/${catalog}${suffix}`;
    const json = await fetch(url).then((r) => r.json()).catch(() => ({ metas: [] }));
    return { results: (json?.metas || []).map(mapCinemetaItem) };
  });
}

export async function searchMovies(q: string): Promise<{ results: MovieItem[] }> {
  return cachedCall(`movies:search:${q.toLowerCase()}`, 5 * 60 * 1000, async () => {
    try {
      const r = await fetch(`/api/movies/search?q=${encodeURIComponent(q)}`);
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) {
        const json = await r.json();
        if (json?.results) return json;
      }
    } catch {
      // Fall through
    }

    const [mRes, sRes] = await Promise.all([
      fetch(`${CINEMETA_URL}/catalog/movie/top/search=${encodeURIComponent(q)}.json`).then((r) => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA_URL}/catalog/series/top/search=${encodeURIComponent(q)}.json`).then((r) => r.json()).catch(() => ({ metas: [] })),
    ]);

    const movies = (mRes?.metas || []).map(mapCinemetaItem);
    const series = (sRes?.metas || []).map(mapCinemetaItem);
    const merged: MovieItem[] = [];
    const maxLen = Math.max(movies.length, series.length);
    for (let i = 0; i < maxLen; i++) {
      if (movies[i]) merged.push(movies[i]);
      if (series[i]) merged.push(series[i]);
    }
    return { results: merged.slice(0, 30) };
  });
}

export async function fetchMovieMeta(type: 'movie' | 'tv', id: string): Promise<MovieItem> {
  return cachedCall(`movies:meta:${type}:${id}`, 15 * 60 * 1000, async () => {
    try {
      const r = await fetch(`/api/movies/meta/${type}/${encodeURIComponent(id)}`);
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) {
        const json = await r.json();
        if (json?.id) return json;
      }
    } catch {
      // Fall through
    }

    const cinemetaType = type === 'tv' ? 'series' : 'movie';
    const r = await fetch(`${CINEMETA_URL}/meta/${cinemetaType}/${encodeURIComponent(id)}.json`);
    const json = await r.json();
    const m = json?.meta;
    if (!m) throw new Error('Title not found');
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
    return {
      ...base,
      director: Array.isArray(m.director) ? m.director : [],
      country: m.country || null,
      awards: m.awards || null,
      videos,
    };
  });
}

