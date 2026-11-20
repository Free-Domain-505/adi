import type {
  AiringItem,
  AnimeMedia,
  EpisodeInfo,
  IdMapping,
  MangaChapter,
  MangaItem,
} from '../types';

const ANILIST_URL = 'https://graphql.anilist.co';
const JIKAN_URL = 'https://api.jikan.moe/v4';
const TMDB_URL = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = '9cc5f31c0469b83ab5ea8608c1081b46';
const ANIZIP_URL = 'https://api.ani.zip';
const MANGADEX_URL = 'https://api.mangadex.org';

export const JJK_TMDB_ID = 95479;
export const JJK_ANILIST_IDS = new Set([113415, 145064, 172463]);

export const JJK_FALLBACK_SEASONS = [
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

export function isJujutsuKaisen(id?: number, title?: string): boolean {
  if (id && (id === JJK_TMDB_ID || JJK_ANILIST_IDS.has(id))) return true;
  if (title && /jujutsu\s*kaisen/i.test(title)) return true;
  return false;
}

export async function safeParseJson<T>(res: Response): Promise<T | null> {
  try {
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchApiJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return await safeParseJson<T>(res);
  } catch {
    return null;
  }
}

const ANIME_CARD_FIELDS = `
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

async function anilistQuery<T = any>(query: string, variables: Record<string, any> = {}): Promise<T | null> {
  try {
    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const json = await safeParseJson<{ data?: T }>(res);
    return json?.data ?? null;
  } catch {
    return null;
  }
}

async function tmdbGet<T = any>(endpoint: string, params: Record<string, string | number | undefined> = {}): Promise<T | null> {
  try {
    const url = new URL(`${TMDB_URL}${endpoint}`);
    url.searchParams.set('api_key', TMDB_API_KEY);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await safeParseJson<T>(res);
  } catch {
    return null;
  }
}

async function getTmdbLogoDirectById(tmdbId: number, type: 'tv' | 'movie' = 'tv'): Promise<string | null> {
  const data = await tmdbGet<{ logos?: any[] }>(`/${type}/${tmdbId}/images`, {
    include_image_language: 'en,ja,zh,null',
  });
  const logos = (data?.logos || []).slice();
  if (logos.length === 0) return null;
  const enLogo = logos.find((l: any) => l.iso_639_1 === 'en');
  const best = enLogo || logos.sort((a: any, b: any) => (b.vote_average || 0) - (a.vote_average || 0))[0];
  return best?.file_path ? `https://image.tmdb.org/t/p/w500${best.file_path}` : null;
}

function cleanSearchTitle(raw: string): string {
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

function stripTrailingSequel(raw: string): string {
  return cleanSearchTitle(raw)
    .replace(/\s+(?:\d+|II|III|IV|V|VI)$/i, '')
    .trim();
}

export async function resolveTmdbShowByTitleDirect(
  titles: string[],
  country?: string | null,
  preferredType: 'tv' | 'movie' = 'tv'
): Promise<{ id: number; type: 'tv' | 'movie'; backdrop?: string | null } | null> {
  const queries = Array.from(
    new Set(
      titles
        .flatMap((t) => [t, cleanSearchTitle(t), stripTrailingSequel(t)])
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
    )
  );

  for (const q of queries.slice(0, 3)) {
    const searchEndpoint = preferredType === 'movie' ? '/search/movie' : '/search/tv';
    const res = await tmdbGet<{ results?: any[] }>(searchEndpoint, { query: q, include_adult: 'false' });
    const list = res?.results || [];
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
        .sort((a, b) => b.score - a.score);
      const top = scored[0]?.item;
      if (top?.id) {
        return {
          id: Number(top.id),
          type: preferredType,
          backdrop: top.backdrop_path ? `https://image.tmdb.org/t/p/w1280${top.backdrop_path}` : null,
        };
      }
    }
  }

  // Fallback to multi search
  if (queries[0]) {
    const multi = await tmdbGet<{ results?: any[] }>('/search/multi', { query: queries[0], include_adult: 'false' });
    const match = (multi?.results || []).find((x: any) => x.media_type === 'tv' || x.media_type === 'movie');
    if (match?.id) {
      return {
        id: Number(match.id),
        type: match.media_type === 'movie' ? 'movie' : 'tv',
        backdrop: match.backdrop_path ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}` : null,
      };
    }
  }
  return null;
}

export async function tmdbLogoDirect(
  title: string,
  tmdbId?: number,
  type: 'tv' | 'movie' = 'tv'
): Promise<string | null> {
  if (tmdbId && Number.isFinite(tmdbId) && tmdbId > 0) {
    const direct = await getTmdbLogoDirectById(tmdbId, type);
    if (direct) return direct;
  }
  if (!title.trim()) return null;
  const resolved = await resolveTmdbShowByTitleDirect([title], undefined, type);
  if (!resolved) return null;
  return await getTmdbLogoDirectById(resolved.id, resolved.type);
}

function mapJikanToAnimeMedia(item: any, country = 'JP'): AnimeMedia {
  const poster =
    item.images?.webp?.large_image_url ||
    item.images?.jpg?.large_image_url ||
    item.images?.jpg?.image_url ||
    null;
  return {
    id: Number(item.mal_id),
    idMal: Number(item.mal_id),
    title: {
      english: item.title_english || item.title,
      romaji: item.title,
      native: item.title_japanese || item.title,
    },
    coverImage: { extraLarge: poster, large: poster, color: '#f59e0b' },
    bannerImage: item.trailer?.images?.maximum_image_url || poster,
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

function getCurrentAlSeason(): { season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'; year: number } {
  const now = new Date();
  const m = now.getMonth() + 1;
  const year = now.getFullYear();
  if (m <= 3) return { season: 'WINTER', year };
  if (m <= 6) return { season: 'SPRING', year };
  if (m <= 9) return { season: 'SUMMER', year };
  return { season: 'FALL', year };
}

async function attachSpotlightLogos(items: AnimeMedia[]): Promise<AnimeMedia[]> {
  const top = items.slice(0, 8);
  const enriched = await Promise.all(
    top.map(async (item) => {
      const title = item.title?.english || item.title?.romaji || '';
      if (!title) return item;
      const prefType = item.format === 'MOVIE' ? 'movie' : 'tv';
      const resolved = await resolveTmdbShowByTitleDirect([title, item.title?.romaji || ''], item.countryOfOrigin, prefType);
      const logo = resolved ? await getTmdbLogoDirectById(resolved.id, resolved.type) : null;
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

export async function animeHomeDirect(): Promise<{
  trending: AnimeMedia[];
  season: AnimeMedia[];
  popular: AnimeMedia[];
  top: AnimeMedia[];
  upcoming: AnimeMedia[];
}> {
  const { season, year } = getCurrentAlSeason();
  const query = `query ($season: MediaSeason, $year: Int) {
    trending: Page(page: 1, perPage: 18) {
      media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ${ANIME_CARD_FIELDS} }
    }
    season: Page(page: 1, perPage: 18) {
      media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) { ${ANIME_CARD_FIELDS} }
    }
    popular: Page(page: 1, perPage: 18) {
      media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${ANIME_CARD_FIELDS} }
    }
    top: Page(page: 1, perPage: 18) {
      media(type: ANIME, sort: SCORE_DESC, isAdult: false) { ${ANIME_CARD_FIELDS} }
    }
    upcoming: Page(page: 1, perPage: 18) {
      media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, isAdult: false) { ${ANIME_CARD_FIELDS} }
    }
  }`;
  const data = await anilistQuery<any>(query, { season, year });
  if (data?.trending?.media) {
    const trending = await attachSpotlightLogos(data.trending.media || []);
    return {
      trending,
      season: data.season?.media || [],
      popular: data.popular?.media || [],
      top: data.top?.media || [],
      upcoming: data.upcoming?.media || [],
    };
  }

  // Jikan fallback
  const [topNow, popList, topScore, upcomingList] = await Promise.all([
    fetchApiJson<{ data: any[] }>(`${JIKAN_URL}/top/anime?filter=airing&limit=18`),
    fetchApiJson<{ data: any[] }>(`${JIKAN_URL}/top/anime?filter=bypopularity&limit=18`),
    fetchApiJson<{ data: any[] }>(`${JIKAN_URL}/top/anime?limit=18`),
    fetchApiJson<{ data: any[] }>(`${JIKAN_URL}/top/anime?filter=upcoming&limit=18`),
  ]);
  const trending = await attachSpotlightLogos((topNow?.data || []).map((x) => mapJikanToAnimeMedia(x)));
  return {
    trending,
    season: trending,
    popular: (popList?.data || []).map((x) => mapJikanToAnimeMedia(x)),
    top: (topScore?.data || []).map((x) => mapJikanToAnimeMedia(x)),
    upcoming: (upcomingList?.data || []).map((x) => mapJikanToAnimeMedia(x)),
  };
}

export async function donghuaHomeDirect(): Promise<{
  trending: AnimeMedia[];
  popular: AnimeMedia[];
  top: AnimeMedia[];
  airing: AnimeMedia[];
}> {
  const query = `query {
    trending: Page(page: 1, perPage: 18) {
      media(type: ANIME, countryOfOrigin: CN, sort: TRENDING_DESC, isAdult: false) { ${ANIME_CARD_FIELDS} }
    }
    airing: Page(page: 1, perPage: 18) {
      media(type: ANIME, countryOfOrigin: CN, status: RELEASING, sort: POPULARITY_DESC, isAdult: false) { ${ANIME_CARD_FIELDS} }
    }
    popular: Page(page: 1, perPage: 18) {
      media(type: ANIME, countryOfOrigin: CN, sort: POPULARITY_DESC, isAdult: false) { ${ANIME_CARD_FIELDS} }
    }
    top: Page(page: 1, perPage: 18) {
      media(type: ANIME, countryOfOrigin: CN, sort: SCORE_DESC, isAdult: false) { ${ANIME_CARD_FIELDS} }
    }
  }`;
  const data = await anilistQuery<any>(query);
  const trending = await attachSpotlightLogos(data?.trending?.media || []);
  return {
    trending,
    airing: data?.airing?.media || [],
    popular: data?.popular?.media || [],
    top: data?.top?.media || [],
  };
}

export async function scheduleDirect(): Promise<AiringItem[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const query = `query ($start: Int, $end: Int) {
    Page(page: 1, perPage: 28) {
      airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
        id
        episode
        airingAt
        media {
          ${ANIME_CARD_FIELDS}
          isAdult
        }
      }
    }
  }`;
  const data = await anilistQuery<any>(query, {
    start: nowSec - 24 * 3600,
    end: nowSec + 7 * 24 * 3600,
  });
  const list = (data?.Page?.airingSchedules || []).filter((s: any) => s.media && !s.media.isAdult);
  return list.map((s: any) => ({
    id: s.id,
    episode: s.episode,
    airingAt: s.airingAt,
    media: s.media,
  }));
}

export async function browseAnimeDirect(opts: {
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
  const sortMap: Record<string, string> = {
    TRENDING_DESC: 'TRENDING_DESC',
    POPULARITY_DESC: 'POPULARITY_DESC',
    SCORE_DESC: 'SCORE_DESC',
    START_DATE_DESC: 'START_DATE_DESC',
    FAVOURITES_DESC: 'FAVOURITES_DESC',
  };
  const sort = opts.search ? 'SEARCH_MATCH' : sortMap[opts.sort || 'TRENDING_DESC'] || 'TRENDING_DESC';
  const query = `query (
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
        ${ANIME_CARD_FIELDS}
      }
    }
  }`;
  const data = await anilistQuery<any>(query, {
    page: opts.page || 1,
    perPage: opts.perPage || 24,
    search: opts.search || undefined,
    genre: opts.genre || undefined,
    format: opts.format || undefined,
    status: opts.status || undefined,
    season: opts.season || undefined,
    year: opts.year || undefined,
    sort: [sort],
    country: opts.countryOfOrigin || undefined,
  });
  if (data?.Page) {
    return {
      items: data.Page.media || [],
      hasNextPage: Boolean(data.Page.pageInfo?.hasNextPage),
    };
  }
  if (opts.search) {
    const jikan = await fetchApiJson<{ data: any[]; pagination?: { has_next_page?: boolean } }>(
      `${JIKAN_URL}/anime?q=${encodeURIComponent(opts.search)}&page=${opts.page || 1}&limit=${opts.perPage || 24}`
    );
    return {
      items: (jikan?.data || []).map((x) => mapJikanToAnimeMedia(x, opts.countryOfOrigin || 'JP')),
      hasNextPage: Boolean(jikan?.pagination?.has_next_page),
    };
  }
  return { items: [], hasNextPage: false };
}

export async function getJjkAnilistSeasonsDirect() {
  const q = `query {
    s1: Media(id: 113415, type: ANIME) { id idMal episodes bannerImage coverImage { extraLarge } }
    s2: Media(id: 145064, type: ANIME) { id idMal episodes bannerImage coverImage { extraLarge } }
    s3: Media(id: 172463, type: ANIME) { id idMal episodes bannerImage coverImage { extraLarge } }
  }`;
  const data = await anilistQuery<any>(q);
  if (data?.s1 && data?.s2) {
    const s1Eps = Number(data.s1.episodes) || 24;
    const s2Eps = Number(data.s2.episodes) || 23;
    const seasons = [
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
    return seasons;
  }
  return JJK_FALLBACK_SEASONS;
}

export async function getJjkSeasonEpisodesDirect(seasonNum: number) {
  const seasons = await getJjkAnilistSeasonsDirect();
  const target = seasons.find((s) => s.number === seasonNum) || seasons[0];
  const [az, al, jk] = await Promise.all([
    fetchApiJson<any>(`${ANIZIP_URL}/mappings?anilist_id=${target.anilistId}`),
    anilistQuery<any>(
      `query ($id: Int) { Media(id: $id, type: ANIME) { episodes bannerImage coverImage { extraLarge } streamingEpisodes { title thumbnail } } }`,
      { id: target.anilistId }
    ),
    fetchApiJson<any>(`${JIKAN_URL}/anime/${target.malId}/episodes?page=1`),
  ]);

  const azEps = az?.episodes || {};
  const alMedia = al?.Media;
  const alStreams = Array.isArray(alMedia?.streamingEpisodes) ? alMedia.streamingEpisodes : [];
  const jikanEps = Array.isArray(jk?.data) ? jk.data : [];
  const count =
    Math.max(
      target.episodes || 0,
      Object.keys(azEps).filter((k) => /^\d+$/.test(k)).length,
      alMedia?.episodes || 0,
      jikanEps.length
    ) || 12;

  const fallbackThumb = alMedia?.bannerImage || target.banner || alMedia?.coverImage?.extraLarge || target.poster;
  const episodes: EpisodeInfo[] = [];
  for (let i = 1; i <= count; i++) {
    const azItem = azEps[String(i)];
    const jkItem = jikanEps.find((x: any) => Number(x.mal_id) === i) || jikanEps[i - 1];
    const alStream = alStreams[i - 1];
    const rawAlTitle = alStream?.title ? String(alStream.title).replace(/^Episode\s*\d+\s*[-–:]\s*/i, '').trim() : '';
    const epTitle = azItem?.title?.en || azItem?.title?.['x-jat'] || jkItem?.title || rawAlTitle || `Episode ${i}`;
    episodes.push({
      number: i,
      title: String(epTitle).trim(),
      overview: String(azItem?.overview || azItem?.summary || '').trim(),
      thumbnail: azItem?.image || alStream?.thumbnail || fallbackThumb || null,
    });
  }

  return {
    episodes,
    total: episodes.length,
    ids: { themoviedb: JJK_TMDB_ID, anilist: target.anilistId, mal: target.malId },
    anilistId: target.anilistId,
    malId: target.malId,
    absoluteOffset: target.absoluteOffset,
    seasons: seasons.map((s) => ({
      number: s.number,
      name: s.name,
      episodes: s.episodes,
      poster: s.poster,
      anilistId: s.anilistId,
      malId: s.malId,
    })),
  };
}

export async function animeDetailDirect(id: number): Promise<AnimeMedia> {
  const queryId = id === JJK_TMDB_ID ? 113415 : id;
  const detailQuery = `query ($id: Int) {
    Media(id: $id, type: ANIME) {
      ${ANIME_CARD_FIELDS}
      studios(isMain: true) { nodes { id name isAnimationStudio } }
      characters(sort: [ROLE, RELEVANCE], perPage: 15) {
        edges {
          role
          node { id name { full } image { large } }
        }
      }
      recommendations(sort: [RATING_DESC], perPage: 14) {
        nodes {
          mediaRecommendation { ${ANIME_CARD_FIELDS} }
        }
      }
    }
  }`;
  const data = await anilistQuery<any>(detailQuery, { id: queryId });
  let media: AnimeMedia | null = data?.Media || null;

  if (!media) {
    const jikan = await fetchApiJson<{ data: any }>(`${JIKAN_URL}/anime/${queryId}/full`);
    if (jikan?.data) media = mapJikanToAnimeMedia(jikan.data);
  }
  if (!media) throw new Error('Anime not found');

  const primaryTitle = media.title?.english || media.title?.romaji || '';
  const altTitle = media.title?.romaji || '';
  const jjk = isJujutsuKaisen(media.id, primaryTitle);

  if (jjk) {
    const [jjkSeasons, logo] = await Promise.all([
      getJjkAnilistSeasonsDirect(),
      getTmdbLogoDirectById(JJK_TMDB_ID, 'tv'),
    ]);
    return {
      ...media,
      tmdbId: JJK_TMDB_ID,
      logo,
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
  }

  // Non-JJK: fetch seasons + logo from TMDB
  const prefType = media.format === 'MOVIE' ? 'movie' : 'tv';
  const resolved = await resolveTmdbShowByTitleDirect([primaryTitle, altTitle], media.countryOfOrigin, prefType);
  if (resolved) {
    const [logo, tmdbShow] = await Promise.all([
      getTmdbLogoDirectById(resolved.id, resolved.type),
      resolved.type === 'tv' ? tmdbGet<any>(`/tv/${resolved.id}`) : Promise.resolve(null),
    ]);
    const tmdbSeasons = (tmdbShow?.seasons || [])
      .filter((s: any) => Number(s.season_number) > 0)
      .map((s: any) => ({
        number: Number(s.season_number),
        name: s.name || `Season ${s.season_number}`,
        episodes: s.episode_count || 0,
        poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
      }));
    return {
      ...media,
      tmdbId: resolved.id,
      logo,
      bannerImage: media.bannerImage || resolved.backdrop || media.coverImage?.extraLarge || null,
      seasons:
        tmdbSeasons.length > 0
          ? tmdbSeasons
          : [{ number: 1, name: 'Season 1', episodes: media.episodes || 12, poster: media.coverImage?.extraLarge || null }],
    };
  }

  return {
    ...media,
    seasons: [{ number: 1, name: 'Season 1', episodes: media.episodes || 12, poster: media.coverImage?.extraLarge || null }],
  };
}

export async function animeEpisodesDirect(
  id: number,
  season = 1,
  hintTitle?: string
): Promise<{
  episodes: EpisodeInfo[];
  total: number;
  ids: IdMapping & { anilist?: number; mal?: number };
  anilistId?: number;
  malId?: number;
  absoluteOffset?: number;
  seasons?: { number: number; name: string; episodes: number; poster?: string | null }[];
}> {
  if (isJujutsuKaisen(id, hintTitle)) {
    return getJjkSeasonEpisodesDirect(season);
  }

  // Look up title / TMDB ID via AniList first so we resolve TMDB TV show cleanly
  let searchTitle = hintTitle || '';
  let altTitle = '';
  let country: string | null = null;
  let fallbackEps = 12;
  let fallbackThumb: string | null = null;
  let malId: number | undefined;

  const alData = await anilistQuery<any>(
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
      return getJjkSeasonEpisodesDirect(season);
    }
  }

  const resolved = searchTitle
    ? await resolveTmdbShowByTitleDirect([searchTitle, altTitle], country, 'tv')
    : { id, type: 'tv' as const, backdrop: null };

  const tmdbId = resolved?.id || id;
  const [seasonData, showData] = await Promise.all([
    tmdbGet<any>(`/tv/${tmdbId}/season/${season}`),
    tmdbGet<any>(`/tv/${tmdbId}`),
  ]);

  const tmdbBackdrop = showData?.backdrop_path
    ? `https://image.tmdb.org/t/p/w1280${showData.backdrop_path}`
    : showData?.poster_path
      ? `https://image.tmdb.org/t/p/w500${showData.poster_path}`
      : fallbackThumb;

  const rawEps = Array.isArray(seasonData?.episodes) ? seasonData.episodes : [];
  const episodes: EpisodeInfo[] =
    rawEps.length > 0
      ? rawEps.map((ep: any) => ({
          number: Number(ep.episode_number),
          title: ep.name ? String(ep.name).trim() : `Episode ${ep.episode_number}`,
          overview: ep.overview || '',
          thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : tmdbBackdrop,
        }))
      : Array.from({ length: Math.min(fallbackEps, 100) }, (_, idx) => ({
          number: idx + 1,
          title: `Episode ${idx + 1}`,
          overview: '',
          thumbnail: tmdbBackdrop,
        }));

  const tmdbSeasons = (showData?.seasons || [])
    .filter((s: any) => Number(s.season_number) > 0)
    .map((s: any) => ({
      number: Number(s.season_number),
      name: s.name || `Season ${s.season_number}`,
      episodes: s.episode_count || 0,
      poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
    }));

  return {
    episodes,
    total: episodes.length,
    ids: { themoviedb: tmdbId, anilist: id, mal: malId },
    anilistId: id,
    malId,
    absoluteOffset: 0,
    seasons: tmdbSeasons,
  };
}

export async function tmdbSeasonsDirect(id?: number, title?: string) {
  if (isJujutsuKaisen(id, title)) {
    const jjk = await getJjkAnilistSeasonsDirect();
    return {
      id: JJK_TMDB_ID,
      seasons: jjk.map((s) => ({
        number: s.number,
        name: s.name,
        episodes: s.episodes,
        poster: s.poster,
      })),
    };
  }
  let showId = id;
  if (!showId && title) {
    const resolved = await resolveTmdbShowByTitleDirect([title], undefined, 'tv');
    showId = resolved?.id;
  }
  if (!showId) return { id: null, seasons: [] };
  const detail = await tmdbGet<any>(`/tv/${showId}`);
  const seasons = (detail?.seasons || [])
    .filter((s: any) => Number(s.season_number) > 0)
    .map((s: any) => ({
      number: Number(s.season_number),
      name: s.name || `Season ${s.season_number}`,
      episodes: s.episode_count || 0,
      poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
    }));
  return { id: showId, seasons };
}

// Direct MangaDex client fallback when hosted statically (e.g., Cloudflare Pages)
function mapDirectManga(m: any): MangaItem {
  const attr = m.attributes || {};
  const titles = attr.title || {};
  const title = titles.en || titles['ja-ro'] || (Object.values(titles)[0] as string) || 'Untitled';
  const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
  const fileName = coverRel?.attributes?.fileName;
  const cover = fileName ? `https://uploads.mangadex.org/covers/${m.id}/${fileName}.512.jpg` : '';
  const lang = attr.originalLanguage;
  const kind = lang === 'ko' ? 'Manhwa' : lang === 'zh' || lang === 'zh-hk' ? 'Manhua' : 'Manga';
  return {
    id: m.id,
    title,
    description: attr.description?.en || '',
    cover,
    rawCover: cover,
    kind,
    originalLanguage: lang,
    status: attr.status,
    year: attr.year,
    lastChapter: attr.lastChapter,
    genres: (attr.tags || []).slice(0, 6).map((t: any) => t.attributes?.name?.en).filter(Boolean),
  };
}

export async function mangaHomeDirect(kind: 'manga' | 'manhwa' = 'manga') {
  const langParam = kind === 'manhwa' ? '&originalLanguage[]=ko' : '&originalLanguage[]=ja';
  const base = `${MANGADEX_URL}/manga?limit=18&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive${langParam}`;
  const [tr, lat, top] = await Promise.all([
    fetchApiJson<{ data: any[] }>(`${base}&order[followedCount]=desc`),
    fetchApiJson<{ data: any[] }>(`${base}&order[latestUploadedChapter]=desc`),
    fetchApiJson<{ data: any[] }>(`${base}&order[rating]=desc`),
  ]);
  return {
    trending: (tr?.data || []).map(mapDirectManga),
    latest: (lat?.data || []).map(mapDirectManga),
    topRated: (top?.data || []).map(mapDirectManga),
  };
}

export async function searchMangaDirect(q: string, kind: '' | 'manga' | 'manhwa' = '', offset = 0) {
  const langParam =
    kind === 'manhwa'
      ? '&originalLanguage[]=ko'
      : kind === 'manga'
        ? '&originalLanguage[]=ja'
        : '';
  const data = await fetchApiJson<{ data: any[]; total?: number }>(
    `${MANGADEX_URL}/manga?title=${encodeURIComponent(q)}&limit=24&offset=${offset}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive${langParam}`
  );
  return {
    results: (data?.data || []).map(mapDirectManga),
    total: data?.total || 0,
  };
}

export async function mangaDetailDirect(id: string): Promise<MangaItem> {
  const data = await fetchApiJson<{ data: any }>(
    `${MANGADEX_URL}/manga/${encodeURIComponent(id)}?includes[]=cover_art&includes[]=author&includes[]=artist`
  );
  if (!data?.data) throw new Error('Manga not found');
  return mapDirectManga(data.data);
}

export async function mangaChaptersDirect(id: string, offset = 0): Promise<{ chapters: MangaChapter[]; total: number }> {
  const data = await fetchApiJson<{ data: any[]; total?: number }>(
    `${MANGADEX_URL}/manga/${encodeURIComponent(id)}/feed?limit=100&offset=${offset}&translatedLanguage[]=en&order[chapter]=desc&includes[]=scanlation_group`
  );
  const chapters: MangaChapter[] = (data?.data || []).map((c: any) => ({
    id: c.id,
    chapter: c.attributes?.chapter || '?',
    volume: c.attributes?.volume || null,
    title: c.attributes?.title || `Chapter ${c.attributes?.chapter || '?'}`,
    pages: c.attributes?.pages || 0,
    publishedAt: c.attributes?.publishAt || null,
  }));
  return { chapters, total: data?.total || chapters.length };
}

export async function mangaPagesDirect(chapterId: string) {
  const data = await fetchApiJson<any>(`${MANGADEX_URL}/at-home/server/${encodeURIComponent(chapterId)}`);
  const base = data?.baseUrl;
  const hash = data?.chapter?.hash;
  const files: string[] = data?.chapter?.data || data?.chapter?.dataSaver || [];
  if (!base || !hash) throw new Error('Chapter pages unavailable');
  const folder = data?.chapter?.data ? 'data' : 'data-saver';
  return {
    pages: files.map((f, idx) => ({
      index: idx,
      url: `${base}/${folder}/${hash}/${f}`,
    })),
  };
}
