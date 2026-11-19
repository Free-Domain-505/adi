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

const MEDIA_CARD_FIELDS = `
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
  nextAiringEpisode { episode airingAt timeUntilAiring }
  trailer { id site }
`;

export async function queryAniList<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const key = `al:${query}:${JSON.stringify(variables)}`;
  return cachedCall(key, 5 * 60 * 1000, async () => {
    // 1. Try local proxy first if available
    try {
      const res = await fetch('/api/anilist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const json = await res.json();
        if (json?.data) return json.data as T;
      }
    } catch {
      // Fall through to direct public API
    }

    // 2. Direct public AniList GraphQL endpoint (CORS-enabled globally for browsers)
    const directRes = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    const directJson = await directRes.json();
    if (!directRes.ok || !directJson?.data) {
      throw new Error(directJson?.errors?.[0]?.message || 'Failed to fetch anime from AniList');
    }
    return directJson.data as T;
  });
}

export async function fetchAnimeHome(): Promise<{
  trending: AnimeMedia[];
  season: AnimeMedia[];
  popular: AnimeMedia[];
  top: AnimeMedia[];
  upcoming: AnimeMedia[];
}> {
  const { season, year } = getCurrentSeason();
  const query = `
    query ($season: MediaSeason, $year: Int) {
      trending: Page(page: 1, perPage: 18) {
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ${MEDIA_CARD_FIELDS} }
      }
      season: Page(page: 1, perPage: 18) {
        media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_CARD_FIELDS} }
      }
      popular: Page(page: 1, perPage: 18) {
        media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_CARD_FIELDS} }
      }
      top: Page(page: 1, perPage: 18) {
        media(type: ANIME, sort: SCORE_DESC, isAdult: false) { ${MEDIA_CARD_FIELDS} }
      }
      upcoming: Page(page: 1, perPage: 18) {
        media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_CARD_FIELDS} }
      }
    }
  `;
  const data = await queryAniList<any>(query, { season, year });
  return {
    trending: data.trending?.media || [],
    season: data.season?.media || [],
    popular: data.popular?.media || [],
    top: data.top?.media || [],
    upcoming: data.upcoming?.media || [],
  };
}

export async function fetchDonghuaHome(): Promise<{
  trending: AnimeMedia[];
  popular: AnimeMedia[];
  top: AnimeMedia[];
  airing: AnimeMedia[];
}> {
  const query = `
    query {
      trending: Page(page: 1, perPage: 18) {
        media(type: ANIME, countryOfOrigin: CN, sort: TRENDING_DESC, isAdult: false) { ${MEDIA_CARD_FIELDS} }
      }
      airing: Page(page: 1, perPage: 18) {
        media(type: ANIME, countryOfOrigin: CN, status: RELEASING, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_CARD_FIELDS} }
      }
      popular: Page(page: 1, perPage: 18) {
        media(type: ANIME, countryOfOrigin: CN, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_CARD_FIELDS} }
      }
      top: Page(page: 1, perPage: 18) {
        media(type: ANIME, countryOfOrigin: CN, sort: SCORE_DESC, isAdult: false) { ${MEDIA_CARD_FIELDS} }
      }
    }
  `;
  const data = await queryAniList<any>(query);
  return {
    trending: data.trending?.media || [],
    airing: data.airing?.media || [],
    popular: data.popular?.media || [],
    top: data.top?.media || [],
  };
}

export async function fetchLatestAiringEpisodes(): Promise<AiringItem[]> {
  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - 7 * 24 * 3600;
  const query = `
    query ($start: Int, $end: Int) {
      Page(page: 1, perPage: 24) {
        airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME_DESC) {
          id
          episode
          airingAt
          media {
            id
            title { romaji english native }
            coverImage { extraLarge large color }
            bannerImage
            format
            season
            seasonYear
            averageScore
            genres
            isAdult
          }
        }
      }
    }
  `;
  const data = await queryAniList<any>(query, { start: weekAgo, end: now });
  const list = (data.Page?.airingSchedules || []) as (AiringItem & { media: AnimeMedia & { isAdult?: boolean } })[];
  const seen = new Set<number>();
  return list.filter((item) => {
    if (!item.media || item.media.isAdult) return false;
    if (seen.has(item.media.id)) return false;
    seen.add(item.media.id);
    return true;
  });
}

export async function fetchWeeklySchedule(): Promise<AiringItem[]> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - 24 * 3600;
  const end = now + 7 * 24 * 3600;
  const query = `
    query ($start: Int, $end: Int) {
      Page(page: 1, perPage: 50) {
        airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
          id
          episode
          airingAt
          media {
            id
            title { romaji english native }
            coverImage { extraLarge large color }
            bannerImage
            format
            averageScore
            genres
            isAdult
          }
        }
      }
    }
  `;
  const data = await queryAniList<any>(query, { start, end });
  return ((data.Page?.airingSchedules || []) as (AiringItem & { media: AnimeMedia & { isAdult?: boolean } })[]).filter(
    (s) => s.media && !s.media.isAdult
  );
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
  const query = `
    query (
      $page: Int
      $perPage: Int
      $search: String
      $genre: String
      $format: MediaFormat
      $status: MediaStatus
      $season: MediaSeason
      $year: Int
      $sort: [MediaSort]
      $country: CountryCode
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(
          type: ANIME
          search: $search
          genre: $genre
          format: $format
          status: $status
          season: $season
          seasonYear: $year
          sort: $sort
          countryOfOrigin: $country
          isAdult: false
        ) {
          ${MEDIA_CARD_FIELDS}
        }
      }
    }
  `;
  const variables: Record<string, unknown> = {
    page: opts.page || 1,
    perPage: opts.perPage || 24,
    sort: [opts.sort || (opts.search ? 'SEARCH_MATCH' : 'TRENDING_DESC')],
  };
  if (opts.search) variables.search = opts.search;
  if (opts.genre) variables.genre = opts.genre;
  if (opts.format) variables.format = opts.format;
  if (opts.status) variables.status = opts.status;
  if (opts.season) variables.season = opts.season;
  if (opts.year) variables.year = opts.year;
  if (opts.countryOfOrigin) variables.country = opts.countryOfOrigin;

  const data = await queryAniList<any>(query, variables);
  return {
    items: data.Page?.media || [],
    hasNextPage: Boolean(data.Page?.pageInfo?.hasNextPage),
  };
}

export async function fetchAnimeDetail(id: number): Promise<AnimeMedia> {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_CARD_FIELDS}
        studios(isMain: true) { nodes { id name isAnimationStudio } }
        characters(perPage: 12, sort: [ROLE, RELEVANCE]) {
          edges {
            role
            node { id name { full } image { large } }
            voiceActors(language: JAPANESE, sort: RELEVANCE) {
              id
              name { full }
              image { large }
              languageV2
            }
          }
        }
        recommendations(perPage: 12, sort: RATING_DESC) {
          nodes {
            mediaRecommendation { ${MEDIA_CARD_FIELDS} }
          }
        }
      }
    }
  `;
  const data = await queryAniList<any>(query, { id });
  if (!data?.Media) throw new Error('Anime not found');
  return data.Media;
}

export async function fetchAnimeEpisodes(id: number): Promise<{ episodes: EpisodeInfo[]; total: number; ids: IdMapping }> {
  return cachedCall(`eps:${id}`, 10 * 60 * 1000, async () => {
    try {
      const r = await fetch(`/api/anime/${id}/episodes`);
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) {
        const json = await r.json();
        if (json?.episodes) return json;
      }
    } catch {
      // Fall through to direct query
    }

    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          idMal
          episodes
          bannerImage
          coverImage { extraLarge large }
          streamingEpisodes { title thumbnail url site }
          nextAiringEpisode { episode }
        }
      }
    `;
    const data = await queryAniList<any>(query, { id });
    const media = data?.Media;
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

    const count = Math.max(totalEpisodes || 0, episodeMap.size, 1);
    const cappedCount = Math.min(count, 2000);
    const episodes: EpisodeInfo[] = [];
    for (let i = 1; i <= cappedCount; i++) {
      const found = episodeMap.get(i);
      episodes.push({
        number: i,
        title: found?.title || `Episode ${i}`,
        thumbnail: found?.thumbnail || media?.bannerImage || media?.coverImage?.extraLarge || null,
      });
    }

    let mappedIds: IdMapping = { anilist: id, myanimelist: media?.idMal };
    try {
      const armRes = await fetch(`https://arm.haglund.dev/api/v2/ids?source=anilist&id=${id}`);
      if (armRes.ok) {
        const armData = await armRes.json();
        mappedIds = {
          anilist: id,
          myanimelist: armData?.myanimelist || media?.idMal,
          themoviedb: armData?.themoviedb,
          imdb: armData?.imdb,
          kitsu: armData?.kitsu,
        };
      }
    } catch {
      // Ignore ARM fetch error
    }

    return { episodes, total: cappedCount, ids: mappedIds };
  });
}

export interface ResolvedStream {
  id: string;
  name: string;
  language: 'hindi' | 'english';
  note: string;
  url: string;
}

export async function fetchAnimeStreams(opts: {
  title: string;
  romaji?: string;
  ep: number;
  isMovie?: boolean;
}): Promise<ResolvedStream[]> {
  const params = new URLSearchParams({
    title: opts.title,
    romaji: opts.romaji || '',
    ep: String(opts.ep),
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

// Manga & Manhwa
export async function fetchMangaHome(kind: 'manga' | 'manhwa' = 'manga'): Promise<{
  trending: MangaItem[];
  latest: MangaItem[];
  topRated: MangaItem[];
}> {
  return cachedCall(`manga:home:${kind}`, 5 * 60 * 1000, async () => {
    try {
      const r = await fetch(`/api/manga/home?kind=${kind}`);
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) {
        const json = await r.json();
        if (json?.trending) return json;
      }
    } catch {
      // Fall through
    }
    return { trending: [], latest: [], topRated: [] };
  });
}

export async function searchManga(q: string, kind: '' | 'manga' | 'manhwa' = '', offset = 0): Promise<{ results: MangaItem[]; total: number }> {
  const params = new URLSearchParams({ q, offset: String(offset), limit: '24' });
  if (kind) params.set('kind', kind);
  return cachedCall(`manga:search:${params.toString()}`, 3 * 60 * 1000, async () => {
    try {
      const r = await fetch(`/api/manga/search?${params.toString()}`);
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) {
        const json = await r.json();
        if (json?.results) return json;
      }
    } catch {
      // Fall through
    }
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
  return cachedCall(`manga:chapters:${id}:${offset}`, 5 * 60 * 1000, async () => {
    const r = await fetch(`/api/manga/chapters/${encodeURIComponent(id)}?offset=${offset}`);
    const json = await r.json();
    if (!r.ok) throw new Error(json?.error || 'Failed to load chapters');
    return json;
  });
}

export async function fetchMangaPages(chapterId: string): Promise<{ pages: { index: number; url: string }[] }> {
  return cachedCall(`manga:pages:${chapterId}`, 10 * 60 * 1000, async () => {
    const r = await fetch(`/api/manga/pages/${encodeURIComponent(chapterId)}`);
    const json = await r.json();
    if (!r.ok) throw new Error(json?.error || 'Failed to load chapter pages');
    return json;
  });
}

// Light Novels
export async function fetchNovelHome(): Promise<{ popular: NovelItem[]; latest: NovelItem[]; rankings: NovelItem[] }> {
  return cachedCall('novel:home', 10 * 60 * 1000, async () => {
    try {
      const r = await fetch('/api/novel/home');
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) {
        const json = await r.json();
        if (json?.popular) return json;
      }
    } catch {
      // Fall through
    }
    return { popular: [], latest: [], rankings: [] };
  });
}

export async function searchNovels(q: string): Promise<{ results: NovelItem[] }> {
  return cachedCall(`novel:search:${q.toLowerCase()}`, 5 * 60 * 1000, async () => {
    try {
      const r = await fetch(`/api/novel/search?q=${encodeURIComponent(q)}`);
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) {
        const json = await r.json();
        if (json?.results) return json;
      }
    } catch {
      // Fall through
    }
    return { results: [] };
  });
}

export async function fetchNovelDetail(slug: string): Promise<NovelDetail> {
  return cachedCall(`novel:detail:${slug}`, 10 * 60 * 1000, async () => {
    const r = await fetch(`/api/novel/detail/${encodeURIComponent(slug)}`);
    const json = await r.json();
    if (!r.ok) throw new Error(json?.error || 'Novel not found');
    return json;
  });
}

export async function fetchNovelChapter(
  slug: string,
  chapter: string
): Promise<{ title: string; paragraphs: string[]; blockedBySource?: boolean; sourceUrl: string }> {
  const r = await fetch(`/api/novel/read/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}`);
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

