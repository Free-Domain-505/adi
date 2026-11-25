import { tmdbFetch as defaultTmdbFetch } from "./tmdb.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function normalizeImdb(raw) {
  const s = String(raw || "").trim();
  return /^tt\d{5,}$/i.test(s) ? s.toLowerCase() : null;
}

const imdbCache = new Map();

export function clearImdbResolverCache() {
  imdbCache.clear();
}

async function defaultFetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

export async function resolveImdbMetadata(params = {}, ctx = {}) {
  const {
    imdbId: rawImdb,
    tmdbId: rawTmdb,
    malId: rawMal,
    anilistId: rawAni,
    type: rawType,
    format: rawFormat,
    season: rawSeason,
    title,
    englishTitle,
    romajiTitle,
    nativeTitle,
    altTitles = [],
    year,
  } = params;
  const { env = null, mapOf = null, skipTmdbTitleCheck = false } = ctx;

  const fetchJson = typeof ctx.fetchJson === "function" ? ctx.fetchJson : defaultFetchJson;
  const tmdbFetch = typeof ctx.tmdbFetch === "function" ? ctx.tmdbFetch : ((ep) => defaultTmdbFetch(ep, env));

  let mediaType = rawType === "movie" || rawType === "tv"
    ? rawType
    : (String(rawFormat || "").toUpperCase() === "MOVIE" ? "movie" : "tv");

  let imdbId = normalizeImdb(rawImdb);
  let tmdbId = Number(rawTmdb) || null;
  let season = Number(rawSeason) || null;
  let resolvedMalId = Number(rawMal) || null;
  const anilistId = Number(rawAni) || null;

  // 1. Direct metadata returns immediately without network calls
  if (imdbId) {
    return {
      imdbId,
      tmdbId,
      malId: resolvedMalId,
      anilistId,
      type: mediaType,
      season,
      source: "metadata",
    };
  }

  // Check cache
  const cacheKey = tmdbId
    ? `${mediaType}:tmdb:${tmdbId}`
    : resolvedMalId
      ? `mal:${resolvedMalId}`
      : anilistId
        ? `ani:${anilistId}`
        : `${mediaType}:title:${title || englishTitle || romajiTitle || ""}:${year || ""}`;

  if (imdbCache.has(cacheKey)) {
    return { ...imdbCache.get(cacheKey) };
  }

  let source = "unresolved";

  // 2. TMDB ID only -> resolves /tv/{id}/external_ids or /movie/{id}/external_ids
  if (tmdbId) {
    try {
      const ext = await tmdbFetch(`${mediaType}/${tmdbId}/external_ids`);
      const resolvedImdb = normalizeImdb(ext?.imdb_id);
      if (resolvedImdb) {
        imdbId = resolvedImdb;
        source = "tmdb-external-ids";
        const result = {
          imdbId,
          tmdbId,
          malId: resolvedMalId,
          anilistId,
          type: mediaType,
          season,
          source,
        };
        imdbCache.set(cacheKey, result);
        return result;
      }
    } catch {}
  }

  // 3. MAL ID only -> resolves via ARM cross-reference
  if (resolvedMalId) {
    try {
      const j = await fetchJson(`https://arm.haglund.dev/api/v2/ids?source=myanimelist&id=${encodeURIComponent(resolvedMalId)}`);
      if (j) {
        imdbId = normalizeImdb(j.imdb) || imdbId;
        if (!tmdbId && j.themoviedb) tmdbId = Number(j.themoviedb) || null;
        if (!season && j["themoviedb-season"]) season = Number(j["themoviedb-season"]) || null;
        if (imdbId) {
          source = "arm-mal";
          const result = {
            imdbId,
            tmdbId,
            malId: resolvedMalId,
            anilistId,
            type: mediaType,
            season,
            source,
          };
          imdbCache.set(cacheKey, result);
          return result;
        }
      }
    } catch {}
  }

  // 4. AniList ID only -> resolves via ARM cross-reference
  if (anilistId) {
    if (typeof mapOf === "function") {
      try {
        const m = await mapOf(anilistId);
        if (m) {
          if (!imdbId) imdbId = normalizeImdb(m.imdb);
          if (!tmdbId && m.tmdb?.id) {
            tmdbId = Number(m.tmdb.id) || null;
            if (m.tmdb.type) mediaType = m.tmdb.type;
            if (!season && m.tmdb.season) season = Number(m.tmdb.season) || null;
          }
          if (!resolvedMalId && m.mal) resolvedMalId = Number(m.mal) || null;
        }
      } catch {}
    }

    try {
      const j = await fetchJson(`https://arm.haglund.dev/api/v2/ids?source=anilist&id=${encodeURIComponent(anilistId)}`);
      if (j) {
        imdbId = normalizeImdb(j.imdb) || imdbId;
        if (!tmdbId && j.themoviedb) tmdbId = Number(j.themoviedb) || null;
        if (!season && j["themoviedb-season"]) season = Number(j["themoviedb-season"]) || null;
        if (!resolvedMalId && j.myanimelist) resolvedMalId = Number(j.myanimelist) || null;
        if (imdbId) {
          source = "arm-anilist";
          const result = {
            imdbId,
            tmdbId,
            malId: resolvedMalId,
            anilistId,
            type: mediaType,
            season,
            source,
          };
          imdbCache.set(cacheKey, result);
          return result;
        }
      }
    } catch {}
  }

  // 5. Title search via TMDB
  if (!imdbId && !skipTmdbTitleCheck) {
    const queryTitle = englishTitle || title || romajiTitle || nativeTitle || altTitles[0];
    if (queryTitle) {
      try {
        const qYear = year ? `&year=${encodeURIComponent(String(year).slice(0, 4))}` : "";
        const search = await tmdbFetch(
          `search/${mediaType}?query=${encodeURIComponent(queryTitle)}&include_adult=false&language=en-US${qYear}`,
        );
        let results = search?.results || [];
        if (year && Array.isArray(results) && results.length > 1) {
          const yStr = String(year).slice(0, 4);
          const yearMatched = results.find((r) => {
            const date = r.first_air_date || r.release_date;
            return date && String(date).startsWith(yStr);
          });
          if (yearMatched) {
            results = [yearMatched];
          }
        }
        const first = results?.[0];
        if (first?.id) {
          tmdbId = tmdbId || first.id;
          const ext = await tmdbFetch(`${mediaType}/${first.id}/external_ids`).catch(() => null);
          const resolved = normalizeImdb(ext?.imdb_id);
          if (resolved) {
            imdbId = resolved;
            source = "tmdb-search";
          }
        }
      } catch {}
    }
  }

  const finalResult = {
    imdbId: imdbId || null,
    tmdbId: tmdbId || null,
    malId: resolvedMalId || null,
    anilistId,
    type: mediaType,
    season: season || null,
    source,
  };

  imdbCache.set(cacheKey, finalResult);
  return finalResult;
}
