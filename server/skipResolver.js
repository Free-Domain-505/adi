import { resolveImdbMetadata } from "./imdbResolver.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const skipCache = new Map();

export function clearSkipResolverCache() {
  skipCache.clear();
}

async function fetchJsonSafe(url, timeoutMs = 3500) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

export async function resolveSkipTimesPayload(params = {}, ctx = {}) {
  const {
    malId: rawMal,
    anilistId,
    ep = 1,
    tmdbId: rawTmdb,
    imdbId: rawImdb,
    type = "tv",
    format,
    season = 1,
    episode = ep,
    is_movie = false,
    title,
    englishTitle,
    romajiTitle,
    nativeTitle,
    altTitles = [],
    year,
  } = params;

  const fetchJson = typeof ctx.fetchJson === "function" ? ctx.fetchJson : fetchJsonSafe;

  const meta = await resolveImdbMetadata(
    {
      imdbId: rawImdb,
      tmdbId: rawTmdb,
      malId: rawMal,
      anilistId,
      type,
      format,
      season,
      title,
      englishTitle,
      romajiTitle,
      nativeTitle,
      altTitles,
      year,
    },
    ctx,
  ).catch(() => null);

  const malId = Number(rawMal || meta?.malId) || null;
  const imdbId = rawImdb || meta?.imdbId || null;
  const tmdbId = Number(rawTmdb || meta?.tmdbId) || null;
  const targetSeason = Number(season || meta?.season) || 1;
  const targetEp = Math.max(1, Number(episode || ep) || 1);
  const isMovie = is_movie || type === "movie" || String(format || "").toUpperCase() === "MOVIE";

  const cacheKey = `${imdbId || ""}:${malId || ""}:${targetSeason}:${targetEp}:${isMovie ? "movie" : "tv"}`;
  if (skipCache.has(cacheKey)) {
    return { ...skipCache.get(cacheKey) };
  }

  let introDb = null;
  let aniSkip = null;
  let theIntroDb = null;
  let aniSkipUsed = false;
  let primaryProvider = null;

  // 1. Try IntroDB first
  if (imdbId) {
    const introDbUrl = isMovie
      ? `https://api.introdb.app/segments?imdb_id=${encodeURIComponent(imdbId)}&is_movie=true`
      : `https://api.introdb.app/segments?imdb_id=${encodeURIComponent(imdbId)}&season=${targetSeason}&episode=${targetEp}`;
    try {
      introDb = await fetchJson(introDbUrl);
    } catch {
      introDb = null;
    }
  }

  const hasBothIntroAndOutro = Boolean(
    introDb?.intro && (introDb?.outro || introDb?.post_credits)
  );

  // 2. Call AniSkip only if missing intro or outro in IntroDB
  if (!hasBothIntroAndOutro && malId) {
    const aniSkipUrl = `https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${targetEp}?types[]=op&types[]=ed&types[]=recap&types[]=mixed-op&types[]=mixed-ed&episodeLength=0`;
    try {
      const j = await fetchJson(aniSkipUrl);
      if (Array.isArray(j?.results)) {
        aniSkip = j.results;
      } else if (Array.isArray(j)) {
        aniSkip = j;
      }
    } catch {
      aniSkip = null;
    }
  }

  aniSkipUsed = Boolean(aniSkip && aniSkip.length > 0);

  if (introDb && (introDb.intro || introDb.outro)) {
    primaryProvider = "introdb";
  } else if (aniSkipUsed) {
    primaryProvider = "aniskip";
  }

  // 3. Optional TheIntroDB
  if (tmdbId) {
    const theIntroDbUrl = isMovie
      ? `https://api.theintrodb.org/v1/media?tmdb_id=${tmdbId}`
      : `https://api.theintrodb.org/v1/media?tmdb_id=${tmdbId}&season=${targetSeason}&episode=${targetEp}`;
    try {
      theIntroDb = await fetchJson(theIntroDbUrl);
    } catch {
      theIntroDb = null;
    }
  }

  const result = {
    success: true,
    primaryProvider,
    aniSkipUsed,
    malId,
    imdbId,
    tmdbId,
    aniSkip: aniSkip || null,
    theIntroDb: theIntroDb || null,
    introDb: introDb || null,
  };

  skipCache.set(cacheKey, result);
  return result;
}
