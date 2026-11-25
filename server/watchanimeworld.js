// Direct Multi-Dub extractor for https://watchanimeworld.one
// Extracts direct HLS master .m3u8 playlists featuring multiple Indian regional audio dubs
// (Hindi, Tamil, Telugu, Malayalam, Bengali, English, Japanese) via Zephyrix CDN
// so playback plays 100% inside CinePlayer with our custom player controls.

import { fetchTimeout } from "./fetchTimeout.js";
import { ANIME_MAPPING, pickMapping } from "./mapping.js";
import { parseHlsAudioLanguages, normalizeLangName } from "./audioAvailLogic.js";

const BASE_URL = "https://watchanimeworld.one";
const ZEPHYRIX_BASE = "https://play.zephyrix.org";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const searchCache = new Map();
const seriesCache = new Map();
const resolveCache = new Map();
const availCache = new Map();
const inflightResolves = new Map();

function ttlGet(map, key, ttlMs = 12 * 60e3) {
  const entry = map.get(key);
  if (!entry) return undefined;
  const maxAge = entry.ttlMs ?? ttlMs;
  if (Date.now() - entry.at >= maxAge) {
    map.delete(key);
    return undefined;
  }
  return entry.val;
}

function ttlSet(map, key, val, ttlMs = 12 * 60e3) {
  map.set(key, { at: Date.now(), val, ttlMs });
}

function stripTags(html = "") {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanTitle(str = "") {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*\(\d{4}\)\s*$/g, "")
    .replace(/\s*Season\s+\d+\s*$/gi, "")
    .replace(/\s*\d+(?:st|nd|rd|th)\s+season\s*$/gi, "")
    .replace(/\s*Final Season\s*$/gi, "")
    .replace(/\s*:\s*Part\s+\d+\s*$/gi, "")
    .replace(/\s*Part\s+\d+\s*$/gi, "")
    .replace(/\s*Cour\s+\d+\s*$/gi, "")
    .replace(/\s*[-–]\s*Season\s+\d+\s*$/gi, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSeasonFromText(title = "", romajiTitle = "") {
  const patterns = [
    /\b(?:Season|Series|Part|S)\s*(\d+)\b/i,
    /\b(\d+)(?:st|nd|rd|th)\s+Season\b/i,
  ];
  for (const txt of [title, romajiTitle]) {
    if (!txt) continue;
    for (const p of patterns) {
      const m = String(txt).match(p);
      if (m?.[1]) return parseInt(m[1], 10);
    }
  }
  return 1;
}

export function extractSeasonAndEpisode(slugOrText = "") {
  const str = String(slugOrText || "");
  const seMatch = str.match(/(?:^|-)(\d+)x(\d+)(?:\/|$)/i);
  if (seMatch) {
    return {
      seasonNum: parseInt(seMatch[1], 10),
      epNum: parseInt(seMatch[2], 10),
    };
  }
  return {
    seasonNum: null,
    epNum: extractEpisodeNumber(str),
  };
}

export function extractEpisodeNumber(slugOrText = "") {
  const str = String(slugOrText || "");
  const m1 = str.match(/(?:x|-e|episode-)(\d+)/i);
  if (m1) return parseInt(m1[1], 10);
  const m2 = str.match(/-(\d+)\/?$/);
  if (m2) return parseInt(m2[1], 10);
  const m3 = str.match(/\bep(?:isode)?\s*(\d+)\b/i);
  if (m3) return parseInt(m3[1], 10);
  return null;
}

export async function searchWatchAnimeWorld(query = "") {
  const q = String(query || "").trim();
  if (!q) return [];
  const cacheKey = `search:${q.toLowerCase()}`;
  const cachedSearch = ttlGet(searchCache, cacheKey, 12 * 60e3);
  if (cachedSearch) return cachedSearch;

  const url = `${BASE_URL}/?s=${encodeURIComponent(q)}`;
  try {
    const res = await fetchTimeout(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      timeoutMs: 4500,
    });
    if (!res.ok) return [];
    const html = await res.text();

    const results = [];
    const seen = new Set();

    const matches = [
      ...html.matchAll(
        /<h2 class="entry-title"[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<a href=["'](https:\/\/watchanimeworld\.one\/(?:series|movies)\/([^"'\/]+)\/?)["']/gi,
      ),
    ];

    for (const [_, rawTitle, url, slug] of matches) {
      if (seen.has(url)) continue;
      seen.add(url);
      const title = stripTags(rawTitle);
      const isMovie = url.includes("/movies/");
      results.push({ url, slug, title, isMovie });
    }

    // Fallback search link parser if entry-title structure differs
    if (results.length === 0) {
      const genericMatches = [
        ...html.matchAll(
          /<a\b[^>]*href=["'](https:\/\/watchanimeworld\.one\/(?:series|movies)\/([^"'\/]+)\/?)["'][^>]*>([\s\S]*?)<\/a>/gi,
        ),
      ];
      for (const [_, url, slug, inner] of genericMatches) {
        if (seen.has(url)) continue;
        seen.add(url);
        const title = stripTags(inner) || slug.replace(/-/g, " ");
        if (title.length >= 2 && !url.includes("/page/")) {
          results.push({ url, slug, title, isMovie: url.includes("/movies/") });
        }
      }
    }

    ttlSet(searchCache, cacheKey, results, results.length > 0 ? 12 * 60e3 : 90e3);
    return results;
  } catch {
    return [];
  }
}

export function pickBestSeriesMatch(candidates = [], { title = "", romajiTitle = "", isMovie = false, season = 0 }) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const wantMovie = Boolean(isMovie);
  const wantSeason = season > 0 ? season : extractSeasonFromText(title, romajiTitle);
  const hasExplicitWantSeason =
    season > 1 ||
    /\b(?:season|series|part|s)\s*[2-9]\d*\b|\b[2-9]\d*(?:st|nd|rd|th)\s+season\b/i.test(`${title} ${romajiTitle}`);
  const cleanT = cleanTitle(title);
  const cleanR = cleanTitle(romajiTitle);
  const targetBases = [cleanT, cleanR].filter(Boolean);
  if (targetBases.length === 0) return null;

  let best = null;
  let highestScore = -Infinity;

  for (const c of candidates) {
    const rawCandTitle = c.title || String(c.slug || "").replace(/-/g, " ");
    const candClean = cleanTitle(rawCandTitle);
    if (!candClean) continue;
    const candWords = candClean.split(/\s+/).filter((w) => w.length > 1);
    const candHasSeason = /\b(?:season|series|part|s)\s*(\d+)\b|\b(\d+)(?:st|nd|rd|th)\s+season\b/i.test(rawCandTitle);
    const candSeason = candHasSeason ? extractSeasonFromText(rawCandTitle) : 1;

    let bestForCand = -Infinity;
    for (const targetBase of targetBases) {
      let score = Boolean(c.isMovie) === wantMovie ? 20 : -45;
      const targetWords = targetBase.split(/\s+/).filter((w) => w.length > 1);

      if (candClean === targetBase) {
        score += 90;
      } else if (candClean.includes(targetBase)) {
        score += 35;
      } else if (targetBase.includes(candClean) && candWords.length >= 2) {
        score += 25;
      }

      const common = candWords.filter((w) => targetWords.includes(w)).length;
      const missingTarget = targetWords.filter((w) => !candWords.includes(w)).length;
      const extraCand = candWords.filter(
        (w) => !targetWords.includes(w) && !["the", "of", "and", "in", "a", "an"].includes(w),
      ).length;

      score += common * 15;
      score -= missingTarget * 15;
      // Strongly penalize spin-offs / distinct subtitles when searching a short franchise name (e.g. "Pokemon" vs "Pokemon Concierge")
      if (candClean !== targetBase) {
        score -= extraCand * (targetWords.length <= 1 ? 40 : 12);
      }
      if (hasExplicitWantSeason && candHasSeason) {
        score += candSeason === wantSeason ? 35 : -55;
      } else if (!hasExplicitWantSeason && candHasSeason && candSeason > 1) {
        score -= 40;
      }

      if (score > bestForCand) bestForCand = score;
    }

    if (bestForCand > highestScore) {
      highestScore = bestForCand;
      best = c;
    }
  }

  return highestScore >= 40 ? best : null;
}

export async function fetchSeriesDetails(seriesUrl) {
  if (!seriesUrl) return null;
  const cachedSeries = ttlGet(seriesCache, seriesUrl, 12 * 60e3);
  if (cachedSeries) return cachedSeries;

  try {
    const res = await fetchTimeout(seriesUrl, {
      headers: { "User-Agent": UA },
      timeoutMs: 5000,
    });
    if (!res.ok) return null;
    const html = await res.text();

    const isMovie = seriesUrl.includes("/movies/");
    const episodes = new Map();
    const episodesBySeason = new Map();

    // 1. Episode links present directly in initial HTML
    const epLinks = [
      ...html.matchAll(/href=["'](https:\/\/watchanimeworld\.one\/episode\/([^"'\/]+)\/?)["']/gi),
    ];
    for (const [_, url, slug] of epLinks) {
      const { seasonNum, epNum } = extractSeasonAndEpisode(slug);
      if (epNum === null) continue;
      const entry = { url, slug, epNum, seasonNum };
      if (seasonNum !== null) {
        episodesBySeason.set(`${seasonNum}x${epNum}`, entry);
      }
      if (!episodes.has(epNum)) {
        episodes.set(epNum, entry);
      }
    }

    // 2. Total episode count badge: <span>361 Episodes</span>
    const epCountMatch = html.match(/<span>(\d+)\s+Episodes<\/span>/i);
    const hasExplicitEpisodeBadge = Boolean(epCountMatch?.[1]);
    let totalEps = episodes.size;
    if (epCountMatch && epCountMatch[1]) {
      const parsed = parseInt(epCountMatch[1], 10);
      if (parsed > totalEps) totalEps = parsed;
    }

    // 3. Post ID & available seasons
    const postMatch = html.match(/data-post=["'](\d+)["']/);
    const postId = postMatch ? postMatch[1] : null;

    const seasons = [];
    const seenSeason = new Set();
    for (const sm of html.matchAll(/data-season=["'](\d+)["']/gi)) {
      const sNum = parseInt(sm[1], 10);
      if (!seenSeason.has(sNum)) {
        seenSeason.add(sNum);
        seasons.push(sNum);
      }
    }

    // 4. Extract languages ONLY from explicit /language/ taxonomy links on the title page (never global JS templates)
    const langs = new Set();
    for (const lm of html.matchAll(/<a\b[^>]*href=["'][^"']*\/language\/([^/"'#?]+)\/?["'][^>]*>/gi)) {
      const norm = normalizeLangName(lm[1].replace(/-/g, " "));
      if (norm) langs.add(norm);
    }

    const data = {
      url: seriesUrl,
      isMovie,
      postId,
      seasons,
      episodes,
      episodesBySeason,
      hasExplicitEpisodeBadge,
      totalEps: Math.max(totalEps, episodes.size),
      languages: Array.from(langs),
      html,
    };

    ttlSet(seriesCache, seriesUrl, data, 12 * 60e3);
    return data;
  } catch {
    return null;
  }
}

export async function resolveEpisodeFromSeasons(postId, targetEp, seasonsList = [], targetSeason = 1) {
  if (!postId || !targetEp) return null;
  const order = [];
  const pushS = (s) => {
    const n = parseInt(s, 10);
    if (Number.isFinite(n) && n > 0 && !order.includes(n)) order.push(n);
  };
  pushS(targetSeason);
  if (Array.isArray(seasonsList)) {
    for (const s of seasonsList) pushS(s);
  }
  for (let s = 1; s <= 8; s++) pushS(s);

  for (const s of order) {
    try {
      const ajaxUrl = `${BASE_URL}/wp-admin/admin-ajax.php?action=action_select_season&season=${s}&post=${postId}`;
      const res = await fetchTimeout(ajaxUrl, {
        headers: { "User-Agent": UA, Referer: BASE_URL },
        timeoutMs: 3500,
      });
      if (!res.ok) continue;
      const html = await res.text();
      const epLinks = [
        ...html.matchAll(/href=["'](https:\/\/watchanimeworld\.one\/episode\/([^"'\/]+)\/?)["']/gi),
      ];
      let unprefixedMatch = null;
      for (const [_, url, slug] of epLinks) {
        const { seasonNum, epNum } = extractSeasonAndEpisode(slug);
        if (epNum === targetEp) {
          if (seasonNum === targetSeason) return { url, slug, epNum, seasonNum };
          if (seasonNum === null) unprefixedMatch ??= { url, slug, epNum, seasonNum };
        }
      }
      if (unprefixedMatch && s === targetSeason) return unprefixedMatch;
      if (unprefixedMatch && targetSeason === 1 && order.length <= 1) return unprefixedMatch;
    } catch {}
  }
  return null;
}

export async function extractZephyrixStream(hash) {
  if (!hash) return null;
  const postUrl = `${ZEPHYRIX_BASE}/player/index.php?data=${hash}&do=getVideo`;
  try {
    const res = await fetchTimeout(postUrl, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Referer: `${ZEPHYRIX_BASE}/video/${hash}`,
        Origin: ZEPHYRIX_BASE,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: `hash=${encodeURIComponent(hash)}&r=${encodeURIComponent(BASE_URL + "/")}`,
      timeoutMs: 6500,
    });
    if (!res.ok) return null;
    const body = await res.text();
    if (!body || !body.trim().startsWith("{")) return null;
    const json = JSON.parse(body);

    const streamUrl = json.securedLink || json.videoSource || null;
    if (!streamUrl) return null;

    return {
      streamUrl,
      referer: `${ZEPHYRIX_BASE}/`,
    };
  } catch {
    return null;
  }
}

async function resolveSeriesTarget({ anilistId, episode, title, romajiTitle, isMovie, season = 0 }) {
  const mapped = anilistId ? pickMapping(ANIME_MAPPING, anilistId, episode, isMovie) : null;
  const targetSeason = mapped?.season || (season > 0 ? season : extractSeasonFromText(title, romajiTitle)) || 1;
  const targetEp = mapped?.finalEp || episode || 1;

  if (mapped?.saltId) {
    const mappedMovie = Boolean(mapped.isMovie || isMovie);
    const directSeriesUrl = `${BASE_URL}/${mappedMovie ? "movies" : "series"}/${mapped.saltId}/`;
    const details = await fetchSeriesDetails(directSeriesUrl);
    if (details) {
      return {
        series: { url: directSeriesUrl, slug: mapped.saltId, title: mapped.saltId.replace(/-/g, " "), isMovie: mappedMovie },
        details,
        targetSeason,
        targetEp,
      };
    }
  }

  const queries = [title, romajiTitle, cleanTitle(title), cleanTitle(romajiTitle)]
    .filter(Boolean)
    .filter((q, idx, arr) => arr.indexOf(q) === idx);

  for (const q of queries) {
    const candidates = await searchWatchAnimeWorld(q);
    if (!candidates.length) continue;
    const series = pickBestSeriesMatch(candidates, { title, romajiTitle, isMovie, season: targetSeason });
    if (series) {
      const details = await fetchSeriesDetails(series.url);
      if (details) return { series, details, targetSeason, targetEp };
    }
  }

  return null;
}

export function extractDirectStreamFromEpisodeHtml(epHtml = "") {
  const str = String(epHtml || "");
  const zephMatch = str.match(/https:\/\/play\.zephyrix\.org\/video\/([a-zA-Z0-9]+)/i);
  if (zephMatch?.[1]) {
    return { kind: "zephyrix", hash: zephMatch[1], streamUrl: null, referer: `${ZEPHYRIX_BASE}/` };
  }
  const directMediaMatch = str.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/i);
  if (
    directMediaMatch?.[0] &&
    !/abyssplayer|abysscdn|short\.ink|short\.icu|player1\.php|cybervynx|upns\.live|rpmshare|strp2p|vidmoly|filemoon|streamwish|dood|gdmirrorbot|voe\.sx|voe\./i.test(
      directMediaMatch[0],
    )
  ) {
    return { kind: "direct", hash: null, streamUrl: directMediaMatch[0], referer: `${BASE_URL}/` };
  }
  return null;
}

export async function resolveWatchAnimeWorld({
  anilistId = 0,
  episode = 1,
  title = "",
  romajiTitle = "",
  format = "",
  season = 0,
  target: preResolvedTarget = null,
}) {
  const isMovie = /movie/i.test(format || "");
  const cacheKey = `waw-stream:v3:${anilistId}:${episode}:${season}:${isMovie}:${title}`;
  const cachedStream = ttlGet(resolveCache, cacheKey, 12 * 60e3);
  if (cachedStream) return cachedStream;

  if (inflightResolves.has(cacheKey)) {
    return inflightResolves.get(cacheKey);
  }

  const p = (async () => {
    try {
      const target =
        preResolvedTarget ||
        (await resolveSeriesTarget({ anilistId, episode, title, romajiTitle, isMovie, season }));
      if (!target) return null;

      const { series, details, targetSeason, targetEp } = target;
      let episodePageUrl = null;
      let languages = details.languages?.length ? details.languages : ["Hindi", "Tamil", "Telugu", "English", "Japanese"];

      if (series.isMovie) {
        episodePageUrl = series.url;
      } else {
        const exactSeasonEp = details.episodesBySeason?.get(`${targetSeason}x${targetEp}`);
        const flatEp = details.episodes.get(targetEp);
        if (exactSeasonEp?.url) {
          episodePageUrl = exactSeasonEp.url;
        } else if (flatEp?.url && ((flatEp.seasonNum == null && targetSeason === 1 && details.seasons.length <= 1) || flatEp.seasonNum === targetSeason)) {
          episodePageUrl = flatEp.url;
        } else if (details.postId) {
          const ajaxEp = await resolveEpisodeFromSeasons(details.postId, targetEp, details.seasons, targetSeason);
          if (ajaxEp?.url) episodePageUrl = ajaxEp.url;
        }

        if (!episodePageUrl) {
          episodePageUrl = `${BASE_URL}/episode/${series.slug}-${targetSeason}x${targetEp}/`;
        }
      }

      if (!episodePageUrl) return null;

      const epRes = await fetchTimeout(episodePageUrl, {
        headers: { "User-Agent": UA },
        timeoutMs: 5000,
      });
      if (!epRes.ok) return null;
      const epHtml = await epRes.text();

      const extracted = extractDirectStreamFromEpisodeHtml(epHtml);
      if (!extracted) return null;

      let streamData = null;
      if (extracted.kind === "zephyrix" && extracted.hash) {
        streamData = await extractZephyrixStream(extracted.hash);
      } else if (extracted.streamUrl) {
        streamData = { streamUrl: extracted.streamUrl, referer: extracted.referer };
      }

      if (!streamData?.streamUrl) return null;

      // Verify stream is an actual playable manifest before returning it (never pass broken/HTML links to CinePlayer)
      const isHlsStream = extracted.kind === "zephyrix" || /\.m3u8(\?|$)/i.test(streamData.streamUrl);
      if (isHlsStream) {
        const verified = await verifyZephyrixHlsTracks(streamData.streamUrl, streamData.referer);
        if (!verified.ok) return null;
        if (verified.languages.length > 0) languages = verified.languages;
      }

      const formatOut = /\.mp4(\?|$)/i.test(streamData.streamUrl) ? "mp4" : "hls";
      const result = {
        success: true,
        server: "AnimeWorld",
        audio: "dub",
        audioLabel: "Multi-Audio (Hindi, Tamil, Telugu, English)",
        multiAudio: true,
        languages,
        format: formatOut,
        streamUrl: streamData.streamUrl,
        rawStreamUrl: streamData.streamUrl,
        referer: streamData.referer,
        subtitles: [],
      };

      ttlSet(resolveCache, cacheKey, result, 12 * 60e3);
      return result;
    } catch {
      return null;
    } finally {
      inflightResolves.delete(cacheKey);
    }
  })();

  inflightResolves.set(cacheKey, p);
  return p;
}

async function verifyZephyrixHlsTracks(streamUrl, referer) {
  if (!streamUrl) return { ok: false, languages: [] };
  try {
    const res = await fetchTimeout(streamUrl, {
      headers: {
        "User-Agent": UA,
        Referer: referer || `${ZEPHYRIX_BASE}/`,
        Accept: "*/*",
      },
      timeoutMs: 4500,
    });
    if (!res.ok) return { ok: false, languages: [] };
    const text = await res.text();
    if (!text.trimStart().startsWith("#EXTM3U")) return { ok: false, languages: [] };
    return { ok: true, languages: parseHlsAudioLanguages(text) };
  } catch {
    return { ok: false, languages: [] };
  }
}

export function extractSeasonEpisodeKeysFromHtml(html = "", targetSeason = 1) {
  const keys = new Set();
  for (const [, , slug] of String(html || "").matchAll(
    /href=["'](https:\/\/watchanimeworld\.one\/episode\/([^"'\/]+)\/?)["']/gi,
  )) {
    const { seasonNum, epNum } = extractSeasonAndEpisode(slug);
    if (epNum === null) continue;
    if (seasonNum === targetSeason) {
      keys.add(`${targetSeason}x${epNum}`);
    } else if (seasonNum === null && targetSeason === 1) {
      keys.add(`1x${epNum}`);
    }
  }
  return keys;
}

export async function countEpisodesForSeason(
  details,
  targetSeason = 1,
  { anilistId = 0, requestedEpisodes = 0 } = {},
) {
  if (!details) return 0;
  if (details.isMovie) return 1;
  const sTarget = Math.max(1, parseInt(targetSeason, 10) || 1);
  const reqEps = Math.max(0, parseInt(requestedEpisodes, 10) || 0);
  const seasonEps = new Set();

  if (details.episodesBySeason) {
    for (const [key] of details.episodesBySeason) {
      if (key.startsWith(`${sTarget}x`)) seasonEps.add(key);
    }
  }

  const isSingleSeasonPage = !Array.isArray(details.seasons) || details.seasons.length <= 1;
  if (isSingleSeasonPage && seasonEps.size === 0 && details.episodes) {
    for (const [epNum, entry] of details.episodes) {
      if (entry?.seasonNum === null || entry?.seasonNum === sTarget) {
        seasonEps.add(`${sTarget}x${epNum}`);
      }
    }
  }

  const fetchSeasonTabHtml = async (s) => {
    try {
      const ajaxUrl = `${BASE_URL}/wp-admin/admin-ajax.php?action=action_select_season&season=${s}&post=${details.postId}`;
      const res = await fetchTimeout(ajaxUrl, {
        headers: { "User-Agent": UA, Referer: BASE_URL },
        timeoutMs: 3200,
      });
      if (!res.ok) return "";
      return await res.text();
    } catch {
      return "";
    }
  };

  if (details.postId && Array.isArray(details.seasons) && details.seasons.length > 0) {
    const orderedTabs = details.seasons.includes(sTarget)
      ? [sTarget, ...details.seasons.filter((s) => s !== sTarget).slice(0, 3)]
      : details.seasons.slice(0, 4);

    for (const s of orderedTabs) {
      const html = await fetchSeasonTabHtml(s);
      if (!html) continue;
      const foundForSeason = extractSeasonEpisodeKeysFromHtml(html, sTarget);
      for (const k of foundForSeason) seasonEps.add(k);
      if (foundForSeason.size > 0 && s === sTarget) break;
    }
  }

  let singleSeasonCount = seasonEps.size > 0 ? seasonEps.size : isSingleSeasonPage ? details.totalEps || details.episodes?.size || 0 : 0;

  // Handle long-running single AniList entries (e.g. Naruto Shippuden 500 eps, One Piece) split across multiple WAW season tabs
  const rawMap = anilistId ? ANIME_MAPPING?.[String(anilistId).trim()] : null;
  const mapEntries = Array.isArray(rawMap) ? rawMap : rawMap ? [rawMap] : [];
  const isMultiSeasonMapped = mapEntries.length > 1;
  const shouldInspectMultiSeason =
    !isSingleSeasonPage &&
    details.postId &&
    sTarget === 1 &&
    (isMultiSeasonMapped || (reqEps > singleSeasonCount && singleSeasonCount > 0));

  if (shouldInspectMultiSeason) {
    const sortedSeasons = [...details.seasons].sort((a, b) => a - b);
    const highestSeason = sortedSeasons[sortedSeasons.length - 1];
    if (highestSeason > sTarget) {
      const lastHtml = await fetchSeasonTabHtml(highestSeason);
      if (lastHtml) {
        const lastKeys = extractSeasonEpisodeKeysFromHtml(lastHtml, highestSeason);
        const lastEpNums = [...lastKeys]
          .map((k) => parseInt(String(k).split("x")[1] || "0", 10))
          .filter((n) => n > 0);
        const maxLastEp = lastEpNums.length > 0 ? Math.max(...lastEpNums) : 0;

        // Case A: Continuous numbering across seasons (e.g. 16x360 > 32)
        if (maxLastEp > singleSeasonCount && (!reqEps || maxLastEp <= reqEps + 10)) {
          return reqEps > 0 ? Math.min(reqEps, maxLastEp) : maxLastEp;
        }

        // Case B: Explicitly mapped multi-season entry whose seasons restart at episode 1
        if (isMultiSeasonMapped && sortedSeasons.length > 1) {
          const restTabs = sortedSeasons.filter((s) => s !== sTarget && s !== highestSeason);
          const restHtmls = await Promise.all(restTabs.map((s) => fetchSeasonTabHtml(s)));
          let summed = singleSeasonCount + lastKeys.size;
          for (let i = 0; i < restTabs.length; i++) {
            if (restHtmls[i]) {
              summed += extractSeasonEpisodeKeysFromHtml(restHtmls[i], restTabs[i]).size;
            }
          }
          if (summed > singleSeasonCount) {
            return reqEps > 0 ? Math.min(reqEps, summed) : summed;
          }
        }
      }
    }
  }

  return singleSeasonCount;
}

export async function checkWatchAnimeWorldAvailability({
  anilistId = 0,
  title = "",
  romajiTitle = "",
  episodes = 0,
  format = "",
  season = 0,
}) {
  const isMovie = /movie/i.test(format || "");
  const effectiveSeason = season > 0 ? season : extractSeasonFromText(title, romajiTitle);
  const cacheKey = `avail:waw:v6:${anilistId}:${effectiveSeason}:${isMovie}:${episodes}:${title}`;
  const cachedAvail = ttlGet(availCache, cacheKey);
  if (cachedAvail) return cachedAvail;

  if (!cleanTitle(title) && !anilistId) {
    return { available: false, episodeCount: 0, languages: [] };
  }

  try {
    const target = await resolveSeriesTarget({
      anilistId,
      episode: 1,
      title,
      romajiTitle,
      isMovie,
      season: effectiveSeason,
    });
    if (!target?.details) {
      const resFalse = { available: false, episodeCount: 0, languages: [] };
      ttlSet(availCache, cacheKey, resFalse, 90e3);
      return resFalse;
    }

    const details = target.details;
    const fallbackEpCount = details.totalEps || details.episodes?.size || episodes || 1;
    const [resolved, epCount] = await Promise.all([
      resolveWatchAnimeWorld({
        anilistId,
        episode: 1,
        title,
        romajiTitle,
        format,
        season: effectiveSeason,
        target,
      }).catch(() => null),
      Promise.race([
        countEpisodesForSeason(details, target.targetSeason || effectiveSeason, {
          anilistId,
          requestedEpisodes: episodes,
        }).catch(() => fallbackEpCount),
        new Promise((r) => setTimeout(() => r(fallbackEpCount), 3500)),
      ]),
    ]);

    if (!resolved?.streamUrl) {
      const resFalse = { available: false, episodeCount: 0, languages: [] };
      ttlSet(availCache, cacheKey, resFalse, 90e3);
      return resFalse;
    }

    // Union verified HLS languages with explicit series /language/ taxonomy links so later-episode dub tracks (e.g. Telugu/Bengali) are preserved
    const mergedLangs = new Set([
      ...(Array.isArray(resolved.languages) ? resolved.languages : []),
      ...(Array.isArray(details.languages) ? details.languages : []),
    ]);
    const langs = mergedLangs.size > 0 ? Array.from(mergedLangs) : ["Hindi", "English"];

    const result = {
      available: true,
      dub: langs.some((l) => l !== "Japanese"),
      sub: langs.includes("Japanese") || langs.length === 0,
      multi: langs.some((l) => l !== "Japanese" && l !== "English") || langs.length > 2,
      episodeCount: epCount > 0 ? (episodes > 0 ? Math.min(epCount, episodes) : epCount) : episodes || 1,
      languages: langs,
    };

    ttlSet(availCache, cacheKey, result, 12 * 60e3);
    return result;
  } catch {
    return { available: false, episodeCount: 0, languages: [] };
  }
}

