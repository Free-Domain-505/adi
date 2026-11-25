// One Web-standard handler shared by Cloudflare Pages Functions and the Vite dev server.
// handle(request) -> Response | null (null = not an API route)
let fsNode = null;
let pathNode = null;
let streamNode = null;

async function loadLocalMediaModules() {
  if (fsNode && pathNode && streamNode) return true;
  if (typeof globalThis.process !== "undefined" && globalThis.process?.versions?.node) {
    try {
      const modFs = "node:fs";
      const modPath = "node:path";
      const modStream = "node:stream";
      fsNode = await import(/* @vite-ignore */ modFs);
      pathNode = await import(/* @vite-ignore */ modPath);
      streamNode = await import(/* @vite-ignore */ modStream);
      return true;
    } catch {}
  }
  return false;
}

import { resolveDirectStreamWorker, checkEpisodeAudioAvailability } from "./direct-stream.js";
import { resolveFlixCloud, resolveReanimeEmbed } from "./flixcloud.js";
import { extractAnimeSaltPlayer } from "./animesalt.js";
import { resolveAcdn } from "./acdn.js";
import { resolveDesiDubAnime, checkDesiDubAvailability, getDesiDubEpisodeSummary } from "./desidubanime.js";
import { resolveWatchAnimeWorld, checkWatchAnimeWorldAvailability, extractSeasonFromText } from "./watchanimeworld.js";
import { resolveTooniboy, checkTooniboyAvailability } from "./tooniboy.js";
import { resolveAnikoto, checkAnikotoAvailability } from "./anikoto.js";
import { resolveMovieBoxStream } from "./moviebox.js";
import { resolveVidzeeDirect } from "./vidzee.js";
import { resolveMovieEmbedStreams, mapProviderHintToExtractor } from "./movieEmbedResolver.js";
import { validateProxyUrl } from "./ssrf.js";
import novelEngine from "./novel.js";
import * as manga from "./manga.js";
import * as manhwa from "./manhwa.js";
import { shield } from "./shield.js";
import { resolveFallbackPosterResponse } from "./posterFallback.js";
import { isValidImageResponse } from "./posterFallbackLogic.js";
import { fetchWithHeaderTimeout } from "./fetchTimeout.js";
import { computeAudioBreakdown } from "./audioBreakdownLogic.js";
import { detectAllEpisodesAudioServerSide } from "./episodeAudioDetector.js";
import { getOriginalLanguageForCountry, rewriteHlsAudioDefaults } from "./audioAvailLogic.js";
import { ANIME_MAPPING, pickMapping } from "./mapping.js";
import { buildMovieEmbedCandidates, getMaxResolutionFromStreams, hasHindiAudio, isTrustedMovieEmbedUrl, isValidEmbedResponse, sanitizeCinemaOsCss, sanitizeCinemaOsHtml, sanitizeCinemaOsJs, shouldUpgradeMovieBoxToVidzee } from "./detectStreamLogic.js";
import { resolveImdbMetadata } from "./imdbResolver.js";
import { resolveSkipTimesPayload } from "./skipResolver.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
import { tmdbFetch, TMDB_FALLBACK } from "./tmdb.js";
const TMDB = TMDB_FALLBACK;
const ANIBRIDGE = "https://anibridge.eliasbenb.dev/api/mappings?source.descriptor=anilist:";
const ARM = "https://arm.haglund.dev/api/v2/ids?source=anilist&id=";
const OPENSUBS = "https://opensubtitles-v3.strem.io/subtitles";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
  "Access-Control-Allow-Private-Network": "true",
};

const json = (data, status = 200, ttl = 0) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store",
    },
  });

/* ---------- tiny TTL memo with inflight deduplication (per isolate / dev process) ---------- */
const memo = new Map();
const memoInflight = new Map();
async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  const pending = memoInflight.get(key);
  if (pending) return pending;
  const p = Promise.resolve()
    .then(fn)
    .then((v) => {
      if (v) memo.set(key, { at: Date.now(), v });
      return v;
    })
    .finally(() => {
      memoInflight.delete(key);
    });
  memoInflight.set(key, p);
  return p;
}

const movieBoxInflight = new Map();

const getJson = async (url, init = {}) => {
  const r = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(5000),
    headers: { Accept: "application/json", "User-Agent": UA, ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

/* ====================================================================
 * AniBridge mapping (AniList -> MAL / TMDB / TVDB / IMDb / AniDB), ARM fallback
 * ==================================================================== */
function parseMapping(data, anilistId) {
  const out = { anilist: anilistId, mal: null, tmdb: null, tvdb: null, imdb: null, anidb: null };
  const seen = [];
  const walk = (v) => {
    if (!v) return;
    if (typeof v === "string") {
      if (/^[a-z_]+:[^\s]+$/i.test(v)) seen.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(data);
  for (const d of seen) {
    const [provider, id, scope] = d.split(":");
    const p = provider.toLowerCase();
    const season = scope && /^s\d+$/i.test(scope) ? parseInt(scope.slice(1), 10) : null;
    if ((p === "mal" || p === "myanimelist") && !out.mal) out.mal = Number(id) || null;
    else if (p.startsWith("tmdb") && !out.tmdb) out.tmdb = { id: Number(id), type: p.includes("movie") ? "movie" : "tv", season };
    else if (p.startsWith("tvdb") && !out.tvdb) out.tvdb = Number(id) || null;
    else if (p.startsWith("imdb") && !out.imdb) out.imdb = id;
    else if (p === "anidb" && !out.anidb) out.anidb = Number(id) || null;
  }
  return out;
}

export const mapOf = (anilistId) =>
  cached(`map:v4:${anilistId}`, 24 * 3600e3, async () => {
    if (Number(anilistId) === 900001) {
      return { anilist: 900001, mal: null, tmdb: { id: 2777, type: 'tv', season: 1 }, tvdb: null, imdb: null, anidb: null, source: 'anibridge' };
    }
    if (Number(anilistId) === 900002) {
      return { anilist: 900002, mal: null, tmdb: { id: 205048, type: 'movie', season: null }, tvdb: null, imdb: null, anidb: null, source: 'anibridge' };
    }
    if (Number(anilistId) === 21220) {
      return { anilist: 21220, mal: 28755, tmdb: { id: 347201, type: 'movie', season: null }, tvdb: 79824, imdb: 'tt4618398', anidb: 10961, source: 'arm' };
    }
    const anibridgePromise = getJson(ANIBRIDGE + anilistId, { signal: AbortSignal.timeout(4500) })
      .then((d) => {
        const m = parseMapping(d, anilistId);
        return m.mal || m.tmdb || m.imdb ? { ...m, source: "anibridge" } : null;
      })
      .catch(() => null);

    const armPromise = getJson(ARM + anilistId, { signal: AbortSignal.timeout(4500) })
      .then((a) => {
        const hasTvSeason = a?.["themoviedb-season"] !== undefined && a?.["themoviedb-season"] !== null;
        const isMovie = !hasTvSeason && String(a.media || a.type || "").toUpperCase() === "MOVIE";
        if (!a?.themoviedb && !a?.myanimelist && !a?.imdb) return null;
        return {
          anilist: anilistId,
          mal: a.myanimelist ?? null,
          tmdb: a.themoviedb ? { id: a.themoviedb, type: isMovie ? "movie" : "tv", season: a["themoviedb-season"] ?? null } : null,
          tvdb: a.thetvdb ?? null,
          imdb: a.imdb ?? null,
          anidb: a.anidb ?? null,
          source: "arm",
        };
      })
      .catch(() => null);

    const [ab, arm] = await Promise.all([anibridgePromise, armPromise]);
    if (ab?.tmdb) return ab;
    if (arm?.tmdb) return { ...(ab || arm), tmdb: arm.tmdb, mal: ab?.mal ?? arm.mal, imdb: ab?.imdb ?? arm.imdb, source: ab ? ab.source : arm.source };
    return ab || arm || null;
  });

/* ====================================================================
 * TMDB details + artwork (through the same aniversee.vercel.app proxy)
 * ==================================================================== */
const cleanTitle = (t = "") =>
  t
    .replace(/\s*\(\d{4}\)\s*$/g, "")
    .replace(/\s*(Final Season|Season\s+\d+|\d+(st|nd|rd|th)\s+Season|Cour\s+\d+|Part\s+\d+)\s*$/gi, "")
    .replace(/\s*:\s*$/, "")
    .trim();

const isAnimeCandidateResult = (r) => {
  if (!r) return false;
  const gIds = Array.isArray(r.genre_ids) ? r.genre_ids : [];
  const isAnim = gIds.includes(16);
  const isAsian = ["ja", "zh", "ko", "cn"].includes(r.original_language);
  return isAnim || isAsian;
};

const isValidAnimeTmdbDetails = (d, mapImdb) => {
  if (!d) return false;
  if (mapImdb && d.external_ids?.imdb_id && d.external_ids.imdb_id !== mapImdb) {
    return false;
  }
  const hasAnimGenre = Array.isArray(d.genres) && d.genres.some((g) => g.id === 16 || /animat/i.test(g.name || ""));
  const isAsianLang = ["ja", "zh", "ko", "cn"].includes(d.original_language);
  return hasAnimGenre || isAsianLang;
};

export async function tmdbFor(anilistId, title, format, env = null) {
  const map = anilistId ? await mapOf(anilistId) : null;
  let ref = map?.tmdb ? { id: map.tmdb.id, type: map.tmdb.type, season: map.tmdb.season } : null;
  const isAnimeMovie = String(format || "").toUpperCase() === "MOVIE";

  const searchTmdbFallback = async (forceMovie = false) => {
    if (!title) return null;
    try {
      const qTitle = cleanTitle(title) || title;
      if (forceMovie) {
        const res = await tmdbFetch(`search/movie?query=${encodeURIComponent(qTitle)}`, env);
        const list = res.results || [];
        const hit = list.find(isAnimeCandidateResult) || list[0];
        if (hit && isAnimeCandidateResult(hit)) return { id: hit.id, type: "movie", season: null };
      }
      const want = isAnimeMovie ? "movie" : "tv";
      const res = await tmdbFetch(`search/multi?query=${encodeURIComponent(qTitle)}`, env);
      const list = (res.results || []).filter((r) => r.media_type === "tv" || r.media_type === "movie");
      const hit =
        list.find((r) => r.media_type === want && isAnimeCandidateResult(r)) ||
        list.find(isAnimeCandidateResult);
      if (hit) return { id: hit.id, type: hit.media_type, season: null };
    } catch {}
    return null;
  };

  if (isAnimeMovie && ref && ref.type !== "movie") {
    const movieHit = await searchTmdbFallback(true);
    if (movieHit) ref = movieHit;
  }
  if (!ref && title) {
    ref = await searchTmdbFallback(isAnimeMovie);
  }
  if (!ref) return { map, tmdb: null };

  let d = null;
  try {
    d = await tmdbFetch(
      `${ref.type}/${ref.id}?language=en-US&append_to_response=images,videos,credits,external_ids,content_ratings,release_dates,watch/providers&include_image_language=en,null`, env
    );
  } catch {}

  if (!isValidAnimeTmdbDetails(d, map?.imdb)) {
    d = null;
    if (title) {
      const fb = await searchTmdbFallback(isAnimeMovie);
      if (fb && (fb.id !== ref.id || fb.type !== ref.type)) {
        ref = fb;
        const candidateD = await tmdbFetch(
          `${ref.type}/${ref.id}?language=en-US&append_to_response=images,videos,credits,external_ids,content_ratings,release_dates,watch/providers&include_image_language=en,null`, env
        ).catch(() => null);
        if (isValidAnimeTmdbDetails(candidateD, null)) {
          d = candidateD;
        }
      }
    }
  }
  if (!d) return { map, tmdb: null };

  const pngs = (d.images?.logos || []).filter((l) => l.file_path && !l.file_path.toLowerCase().endsWith(".svg"));
  const logo = pngs.sort((a, b) => (b.iso_639_1 === "en") - (a.iso_639_1 === "en") || b.vote_average - a.vote_average)[0]?.file_path ?? null;
  const textless = (d.images?.backdrops || []).filter((b) => !b.iso_639_1).sort((a, b) => b.vote_average - a.vote_average);
  const backdrops = (textless.length ? textless : d.images?.backdrops || []).slice(0, 16).map((b) => b.file_path);

  const certification =
    d.content_ratings?.results?.find((r) => r.iso_3166_1 === "US")?.rating ||
    d.release_dates?.results?.find((r) => r.iso_3166_1 === "US")?.release_dates?.find((x) => x.certification)?.certification ||
    null;
  const yt = (d.videos?.results || []).find((v) => v.site === "YouTube" && /trailer|teaser/i.test(v.type));

  const wpResults = (d["watch/providers"] || d.watch_providers)?.results || {};
  const wpCountry = wpResults["US"] || wpResults["IN"] || wpResults["GB"] || Object.values(wpResults)[0];
  const flat = wpCountry?.flatrate || wpCountry?.ads || wpCountry?.buy || [];
  const watchProviders = flat.length > 0 ? {
    link: wpCountry?.link || null,
    providers: flat.slice(0, 8).map((p) => ({
      id: p.provider_id,
      name: p.provider_name,
      logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null,
    })),
  } : null;

  return {
    map,
    tmdb: {
      id: ref.id,
      name: d.name || d.title || null,
      type: ref.type,
      season: ref.season,
      imdbId: d.external_ids?.imdb_id || map?.imdb || null,
      logo,
      backdrop: d.backdrop_path || backdrops[0] || null,
      poster: d.poster_path || null,
      backdrops,
      overview: d.overview || null,
      tagline: d.tagline || null,
      rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
      votes: d.vote_count || null,
      certification,
      networks: (d.networks || d.production_companies || []).slice(0, 4).map((n) => n.name),
      status: d.status || null,
      language: d.original_language || null,
      seasons:
        d.number_of_seasons ||
        (Array.isArray(d.seasons) ? d.seasons.filter((s) => s.season_number > 0).length : null) ||
        null,
      episodes:
        d.number_of_episodes ||
        (Array.isArray(d.seasons)
          ? d.seasons.filter((s) => s.season_number > 0).reduce((sum, s) => sum + (Number(s.episode_count) || 0), 0) || null
          : null),
      firstAir: d.first_air_date || d.release_date || null,
      lastAir: d.last_air_date || null,
      runtime: d.episode_run_time?.[0] || d.runtime || null,
      cast: (d.credits?.cast || []).slice(0, 10).map((c) => ({ name: c.name, character: c.character, photo: c.profile_path })),
      trailer: yt ? yt.key : null,
      watchProviders,
    },
  };
}

/* ====================================================================
 * Subtitles (OpenSubtitles Stremio addon, keyed by IMDb id from TMDB/AniBridge)
 * ==================================================================== */
const LANGS = { eng: "English", spa: "Spanish", fre: "French", fra: "French", ger: "German", deu: "German", ita: "Italian", por: "Portuguese", pob: "Portuguese (BR)", ara: "Arabic", rus: "Russian", hin: "Hindi", jpn: "Japanese", chi: "Chinese", zho: "Chinese", ind: "Indonesian", tha: "Thai", vie: "Vietnamese", kor: "Korean", tur: "Turkish", pol: "Polish", dut: "Dutch", nld: "Dutch" };

async function subtitlesFor(anilistId, title, ep, format) {
  const { tmdb, map } = await cached(`tmdb:v5:${anilistId}:${title}:${format || ""}`, 24 * 3600e3, () => tmdbFor(anilistId, title, format, null)).then((v) => v || {});
  const imdb = tmdb?.imdbId || map?.imdb;
  if (!imdb) return [];
  const season = tmdb?.season || map?.tmdb?.season || 1;
  const url = tmdb?.type === "movie" ? `${OPENSUBS}/movie/${imdb}.json` : `${OPENSUBS}/series/${imdb}:${season}:${ep}.json`;
  const data = await getJson(url).catch(() => null);
  const count = {};
  return (data?.subtitles || []).slice(0, 60).map((s, i) => {
    const language = LANGS[s.lang] || (s.lang ? s.lang[0].toUpperCase() + s.lang.slice(1) : "English");
    count[language] = (count[language] || 0) + 1;
    return { id: s.id || `os_${i}`, label: count[language] > 1 ? `${language} #${count[language]}` : language, language, lang: s.lang, url: s.url, source: "OpenSubtitles" };
  });
}

/* ====================================================================
 * Proxy (HLS playlists are rewritten so segments also pass through here)
 * ==================================================================== */
const MOVIEBOX_APP_UA = "com.community.oneroom/50020042 (Linux; U; Android 14; en_US; Pixel 8; Build/UQ1A.240205.004; Cronet/121.0.6167.101)";

export function classifyMovieBoxCdnHost(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  const isWebMirrorCdn = host.includes("bcdnxw") || host.includes("123moviesfree") || host.includes("sflix");
  const isDirectAppCdn =
    !isWebMirrorCdn && (/aoneroom/.test(host) || /(?:^|\.)hakunaymatata\.com$/.test(host));
  return { isWebMirrorCdn, isDirectAppCdn };
}

function refererFor(host, requested) {
  const { isDirectAppCdn, isWebMirrorCdn } = classifyMovieBoxCdnHost(host);
  if (isDirectAppCdn || /tiktokcdn\.com|vercetti\.org/.test(host)) return null;
  if (requested && !/flixcloud\.cc|megaplay/.test(requested)) return requested;
  if (/krussdomi|advancedairesearchlab/.test(host)) return "https://krussdomi.com/";
  if (/animeapps|nukitashi|playeng/.test(host)) return "https://playeng.animeapps.top/";
  if (/nexabloom|stellarfrontier|phantomharbor|shadowharbor|hiddenvertex|emeralddrift|eclipseharbor|megaplay|megap|shiora|akirax|imgnex/.test(host)) return "https://megaplay.buzz/";
  if (/animesalt|as-cdn|acdn\.top|ravok/.test(host)) return "https://animesalt.cx/";
  if (/hscow\.com|slowcloud\.live|rezesubs\.com|vidzee\.wtf/.test(host)) return "https://player.vidzee.wtf/";
  if (isWebMirrorCdn || /bcdnxw/.test(host)) return "https://123moviesfree.club/";
  if (/flixcloud|atomic4cdn|rundowncdn|vividcdn|fallencdn|enc-dec/.test(host)) return "https://flixcloud.cc/";
  if (/moviebox/.test(host)) return "https://moviebox.ph/";
  if (/lnori/.test(host)) return "https://lnori.com/";
  if (/novelfire/.test(host)) return "https://novelfire.net/";
  if (/novelfull/.test(host)) return "https://novelfull.com/";
  if (/asurascans/.test(host)) return "https://asurascans.com/";
  if (/asuracomic/.test(host)) return "https://asuracomic.net/";
  if (/demonicscans|readermc|mangareadon|mangafifth/.test(host)) return "https://demonicscans.org/";
  if (/comick/.test(host)) return "https://comick.dev/";
  if (/mangadex\.(org|network)/.test(host)) return "https://mangadex.org/";
  if (/nuvorel|streamruby|rubystm|rubyvidhub/.test(host)) return requested || "https://nuvorel.top/";
  if (/blakiteapi|rumble\.cloud/.test(host)) return requested || "https://blakiteapi.xyz/";
  if (/morencius|dramiyos-cdn|maplebrookdesignstudio|pixibay/.test(host)) return requested || "https://morencius.com/";
  if (/vidmoly|vmget|vmpx|vmnow/.test(host)) return requested || "https://vidmoly.org/";
  if (/desidubanime/.test(host)) return "https://www.desidubanime.me/";
  if (/zephyrix|zn-grid/.test(host)) return "https://play.zephyrix.org/";
  if (/nekomux/.test(host)) return requested || "https://player.nekomux.com/";
  if (/vidtube|crystaldrift/.test(host)) return requested || "https://vidtube.site/";
  return requested || null;
}

async function resolveAcdnShared({ anilistId, episode, isMovie, title, lang = "" }) {
  const baseHit = await cached(`acdn-base:v4:${anilistId}:${episode}:${isMovie}:${title}`, 10 * 60e3, () =>
    resolveAcdn({ anilistId, episode, title, isMovie, lang: "" }),
  );
  if (baseHit?.streamUrl) {
    if (!lang || baseHit.isMultiAudioHls) return baseHit;
    const lbl = String(baseHit.audioLabel || "").toLowerCase();
    if (lbl.includes(lang.toLowerCase())) return baseHit;
  }
  if (lang) {
    const langHit = await cached(`acdn:v4:${anilistId}:${episode}:${isMovie}:${lang}:${title}`, 10 * 60e3, () =>
      resolveAcdn({ anilistId, episode, title, isMovie, lang }),
    );
    if (langHit?.streamUrl) return langHit;
  }
  return baseHit || null;
}

async function proxy(request, url, proxyBase = "/proxy", env = null) {
  const target = url.searchParams.get("url");
  const fallbackTitle = url.searchParams.get("title")?.trim() || "";
  if (!target && fallbackTitle) {
    const fb = await resolveFallbackPosterResponse(fallbackTitle, { cached, corsHeaders: CORS, userAgent: UA });
    if (fb) return fb;
    return json({ error: "Poster not found" }, 404);
  }
  const check = validateProxyUrl(target);
  if (!check.valid) return json({ error: check.error }, 403);
  const t = check.url;
  const host = t.hostname.toLowerCase();
  const { isWebMirrorCdn, isDirectAppCdn } = classifyMovieBoxCdnHost(host);
  const isMangaDexHost = /mangadex\.(org|network)/.test(host);
  const isAcdnVideoHost = /ravok|as-cdn|zephyrflick/i.test(host);
  const noRefererHost = /tiktokcdn\.com|vercetti\.org/.test(host);
  const forceNoRef = url.searchParams.get("noref") === "1" || isDirectAppCdn || noRefererHost;

  let referer = null;
  if (forceNoRef) {
    referer = null;
  } else if (isWebMirrorCdn) {
    referer = url.searchParams.get("referer") || "https://123moviesfree.club/";
  } else {
    referer = refererFor(host, url.searchParams.get("referer")) || `${t.origin}/`;
  }

  const headers = new Headers({ Accept: "*/*" });
  if (referer) {
    headers.set("Referer", referer);
    if (!isWebMirrorCdn && !isMangaDexHost && !/strem\.io|opensubtitles/.test(host)) {
      headers.set("Origin", referer.replace(/\/$/, ""));
    }
  }
  if (isDirectAppCdn) {
    headers.set("User-Agent", MOVIEBOX_APP_UA);
  } else {
    headers.set("User-Agent", isMangaDexHost ? "AnimeStream/1.0" : UA);
  }

  const range = request.headers.get("Range");
  if (range) headers.set("Range", range);

  const midmanUrl = (
    env?.VITE_MOVIEBOX_PROXY_URL || 
    env?.MOVIEBOX_PROXY_URL || 
    (typeof process !== "undefined" ? (process.env?.VITE_MOVIEBOX_PROXY_URL || process.env?.MOVIEBOX_PROXY_URL) : "") || ""
  )?.replace(/\/+$/, "");

  const isHakunaHost = /hakunaymatata|aoneroom/.test(host);
  const isTransientStatus = (s) => (!isHakunaHost && s === 429) || s === 502 || s === 503 || s === 504 || (s >= 520 && s <= 524);
  const fetchWithRetry = async (fetchUrl, baseHeaders) => {
    let lastRes = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const reqHeaders = new Headers(baseHeaders);
        if (attempt > 0 && isAcdnVideoHost) {
          reqHeaders.delete("Origin");
        }
        const res = await fetchWithHeaderTimeout(fetchUrl, { headers: reqHeaders, signal: request.signal }, 9000);
        lastRes = res;
        if (!isTransientStatus(res.status)) return res;
      } catch (err) {
        lastErr = err;
        if (request.signal?.aborted) break;
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (lastRes) return lastRes;
    throw lastErr || new Error("Proxy fetch failed");
  };

  let up;
  try {
    if ((isDirectAppCdn || isWebMirrorCdn) && midmanUrl) {
      try {
        const midmanProxyUrl = `${midmanUrl}/proxy?url=${encodeURIComponent(t.href)}${referer ? '&referer=' + encodeURIComponent(referer) : ''}`;
        const midmanHeaders = new Headers({ Accept: "*/*" });
        if (range) midmanHeaders.set("Range", range);
        const midmanUp = await fetchWithHeaderTimeout(midmanProxyUrl, { headers: midmanHeaders, signal: request.signal }, 4500);
        if (midmanUp.ok || midmanUp.status === 206) {
          up = midmanUp;
        }
      } catch {}
    }
    if (!up) {
      up = await fetchWithRetry(t, headers);
    }
    if ((up.status === 429 || up.status === 428 || up.status === 403) && isHakunaHost) {
      const altProfiles = isDirectAppCdn
        ? [
            { ua: null, ref: null },
            { ua: UA, ref: "https://123moviesfree.club/" },
          ]
        : [
            { ua: MOVIEBOX_APP_UA, ref: null },
            { ua: null, ref: null },
          ];
      for (const prof of altProfiles) {
        const retryHeaders = new Headers({ Accept: "*/*" });
        if (range) retryHeaders.set("Range", range);
        if (prof.ua) retryHeaders.set("User-Agent", prof.ua);
        if (prof.ref) retryHeaders.set("Referer", prof.ref);
        const retryUp = await fetchWithHeaderTimeout(t, { headers: retryHeaders, signal: request.signal }, 10000).catch(() => null);
        if (retryUp && (retryUp.ok || retryUp.status === 206)) {
          up = retryUp;
          break;
        }
      }
    } else if (up.status === 403 && !isDirectAppCdn && !isWebMirrorCdn) {
      const bareHeaders = new Headers({ Accept: "*/*", "User-Agent": isMangaDexHost ? "AnimeStream/1.0" : UA });
      if (range) bareHeaders.set("Range", range);
      const retryUp = await fetchWithRetry(t, bareHeaders);
      if (retryUp.ok || retryUp.status === 206) {
        up = retryUp;
      }
    }
    if (up.status === 404 && isMangaDexHost && /\.(256|512)\.jpg$/i.test(t.pathname)) {
      const origUrl = new URL(t.href);
      origUrl.pathname = origUrl.pathname.replace(/\.(256|512)\.jpg$/i, "");
      const origRes = await fetchWithRetry(origUrl, headers).catch(() => null);
      if (origRes?.ok) up = origRes;
    }
  } catch (e) {
    if (fallbackTitle) {
      const fb = await resolveFallbackPosterResponse(fallbackTitle, { cached, corsHeaders: CORS, userAgent: UA, failedUrl: t.href });
      if (fb) return fb;
    }
    const cause = e.cause?.message || e.cause?.code || "";
    return json({ error: "Proxy fetch failed: " + e.message + " " + cause }, 502);
  }

  const upType = up.headers.get("Content-Type") || "";
  const upCl = up.headers.get("Content-Length");
  if (fallbackTitle) {
    const quickInvalid =
      !up.ok ||
      /text\/html|application\/json|text\/plain/i.test(upType) ||
      (upCl !== null && Number(upCl) === 0);
    if (quickInvalid) {
      const fb = await resolveFallbackPosterResponse(fallbackTitle, { cached, corsHeaders: CORS, userAgent: UA, failedUrl: t.href });
      if (fb) return fb;
    } else {
      const imgBytes = new Uint8Array(await up.arrayBuffer());
      const validImg = isValidImageResponse({
        ok: up.ok,
        status: up.status,
        contentType: upType,
        contentLength: upCl,
        bytes: imgBytes,
      });
      if (!validImg) {
        const fb = await resolveFallbackPosterResponse(fallbackTitle, { cached, corsHeaders: CORS, userAgent: UA, failedUrl: t.href });
        if (fb) return fb;
        return json({ error: "Invalid poster image" }, 404);
      }
      const imgOut = new Headers(CORS);
      let outType = upType;
      if (!outType.toLowerCase().startsWith("image/")) {
        if (imgBytes[0] === 0x89 && imgBytes[1] === 0x50) outType = "image/png";
        else if (imgBytes[0] === 0x52 && imgBytes[1] === 0x49) outType = "image/webp";
        else if (imgBytes[0] === 0x47 && imgBytes[1] === 0x49) outType = "image/gif";
        else outType = "image/jpeg";
      }
      imgOut.set("Content-Type", outType);
      imgOut.set("Cache-Control", "public, max-age=3600");
      return new Response(imgBytes, { status: up.status, headers: imgOut });
    }
  }

  const out = new Headers(CORS);
  const type = up.headers.get("Content-Type") || "";
  const isDownload = url.searchParams.get("dl") === "1" || url.searchParams.get("download") === "1";
  const hasSegExt = /\.(ts|m4s|mp4|aac|key|bin|js|css|woff2?|png|webp|jpe?g|avif|gif|ico|bmp|vtt|srt)(\?|$)/i.test(t.pathname);
  const isPlaylist =
    !hasSegExt &&
    (url.searchParams.get("playlist") === "1" ||
      /mpegurl/i.test(type) ||
      /\.m3u8?$/i.test(t.pathname) ||
      (/\/(hls|audio|video)\//i.test(t.pathname)) ||
      t.pathname.includes("parse-flixcloud") ||
      (t.searchParams.get("url") || "").includes(".m3u8"));
  const maybePlainPlaylist = !isPlaylist && !isDownload && /text\/plain/i.test(type) && !/\.(vtt|srt|ass|txt|json)$/i.test(t.pathname);

  if (up.ok && (isPlaylist || maybePlainPlaylist)) {
    const rawBuf = await up.arrayBuffer();
    const headPreview = new TextDecoder().decode(rawBuf.slice(0, 128)).trimStart();
    if (!headPreview.startsWith("#EXTM3U")) {
      const binBytes = new Uint8Array(rawBuf);
      if (type) out.set("Content-Type", type);
      else if (binBytes[0] === 0x47) out.set("Content-Type", "video/mp2t");
      for (const h of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
        const v = up.headers.get(h);
        if (v) out.set(h, v);
      }
      return new Response(rawBuf, { status: up.status, headers: out });
    }
    const text = new TextDecoder().decode(rawBuf);
    if (/^\s*</.test(text)) return new Response(text, { status: up.status, headers: out });
    const direct = url.searchParams.get("seg") === "1"; // segments straight from the CDN, only playlists/keys use the Worker
    const audio = (url.searchParams.get("audio") || "").toLowerCase();
    const noref = url.searchParams.get("noref") === "1";
    const base = t.hostname.includes("enc-dec.app") && t.searchParams.get("url")
      ? new URL(t.searchParams.get("url"))
      : t;
    const wrap = (u, keep) => {
      try {
        const abs = new URL(u, base);
        if (!abs.search && base.search && !u.includes("?") && !/\.(key|bin)(\?|$)/i.test(abs.pathname)) abs.search = base.search;
        if (direct && keep && !referer && !/rundowncdn|flixcloud|vividcdn|fallencdn|midnightvale|nexabloom|megaplay|vidstream/.test(abs.hostname)) return abs.href;
        const childNoRef = noref || /tiktokcdn\.com|vercetti\.org/.test(abs.hostname.toLowerCase());
        return `${proxyBase}?url=${encodeURIComponent(abs.href)}${!keep ? "&playlist=1" : ""}${!childNoRef && referer ? `&referer=${encodeURIComponent(referer)}` : childNoRef ? "&noref=1" : ""}${direct ? "&seg=1" : ""}${audio ? `&audio=${encodeURIComponent(audio)}` : ""}`;
      } catch {
        return u;
      }
    };
    let variant = false;
    let afterExtInf = false;
    let lines = rewriteHlsAudioDefaults(text.split(/\r?\n/), audio);

    const body = lines
      .map((l) => {
        const s = l.trim();
        if (!s) return l;
        if (s.startsWith("#")) {
          if (s.startsWith("#EXT-X-STREAM-INF")) variant = true;
          if (s.startsWith("#EXTINF:")) afterExtInf = true;
          return s.replace(/URI=["']([^"']+)["']/g, (_, u) => `URI="${wrap(u, s.startsWith("#EXT-X-MAP") || s.startsWith("#EXT-X-KEY"))}"`);
        }
        const plist =
          variant ||
          (!afterExtInf &&
            (/\.m3u8?(\?|$)/i.test(s) ||
              (!/\.(ts|m4s|mp4|aac|key|bin|js|css|woff2?|png|webp|jpe?g|avif|gif|ico|bmp)(\?|$)/i.test(s) && /\/hls\//i.test(s)) ||
              s.includes("parse-flixcloud")));
        variant = false;
        afterExtInf = false;
        return wrap(s, !plist);
      })
      .join("\n");
    out.set("Content-Type", "application/vnd.apple.mpegurl");
    out.set("Cache-Control", "no-store");
    return new Response(body, { status: up.status, headers: out });
  }

  if (isDownload) {
    const fn = url.searchParams.get("fn") || t.pathname.split("/").pop() || "video.mp4";
    const cleanFn = fn.replace(/[^\w\s\-\.\(\)\[\]]/gi, "").trim() || "video.mp4";
    out.set("Content-Disposition", `attachment; filename="${cleanFn}"`);
    out.set("Content-Type", "application/octet-stream");
  } else if (/zn-grid/i.test(host) && /\.(js|css|woff2?|png|webp)$/i.test(t.pathname)) {
    out.set("Content-Type", "video/mp2t");
  } else if (type) {
    out.set("Content-Type", type);
  } else if (isHakunaHost) {
    out.set("Content-Type", "video/mp4");
  }
  if (/\.(bin|key)$/i.test(t.pathname)) out.set("Content-Type", "application/octet-stream");
  for (const h of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
    const v = up.headers.get(h);
    if (v) out.set(h, v);
  }
  if (up.ok && (/\.(ts|m4s|mp4|aac|key|bin|png|webp|jpe?g|avif)$/i.test(t.pathname) || (/zn-grid/i.test(host) && /\.(js|css|woff2?)$/i.test(t.pathname)))) {
    out.set("Cache-Control", "public, max-age=3600");
  }
  return new Response(up.body, { status: up.status, headers: out });
}

/* ====================================================================
 * Router
 * ==================================================================== */

/* ---------- Filler lists (animefillerlist.com: canon / mixed canon+filler / filler per episode) ---------- */
const slugOf = (t) => t.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Misses are cached too ({ max: 0 }), so an unknown title costs one request a day.
const fillerOf = (slug) =>
  cached(`filler:${slug}`, 24 * 3600e3, async () => {
    const out = { max: 0, filler: [], mixed: [] };
    try {
      const r = await fetch(`https://www.animefillerlist.com/shows/${slug}`, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow",
      });
      if (!r.ok) return out;
      const html = await r.text();
      // rows look like <tr class="odd mixed_canon/filler"><td class="Number">12</td>…<td class="Type">Mixed Canon/Filler</td>
      for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const num = row[1].match(/class=["']?Number["']?[^>]*>\s*(\d+)/i);
        const type = row[1].match(/class=["']?Type["']?[^>]*>\s*(?:<[^>]+>\s*)*([^<]*)/i);
        if (!num || !type) continue;
        const n = Number(num[1]);
        out.max = Math.max(out.max, n);
        if (/mixed/i.test(type[1])) out.mixed.push(n);
        else if (/filler/i.test(type[1])) out.filler.push(n);
      }
    } catch {
      /* unreachable: treated as a miss */
    }
    return out;
  });

// Generate candidate slugs ordered from most specific (exact title + romaji vowel normalization) to stripped fallbacks.
const slugVariantsExact = (t) => [t, t.replace(/uu/gi, "u"), t.replace(/ou/gi, "o")].map(slugOf);
const slugVariantsLoose = (t) => {
  const base = t.replace(/\s*[:\-–]\s*(season|part|cour)\s*\d+.*$/i, "").replace(/\s+(season|part|cour)\s*\d+.*$/i, "");
  return [base, base.replace(/uu/gi, "u"), base.replace(/^the\s+/i, ""), base.replace(/\s*:.*$/, "")].map(slugOf);
};

function getProxyBase(request, env) {
  const explicitProxy = (
    env?.STREAM_PROXY_URL ||
    env?.VITE_STREAM_PROXY_URL ||
    globalThis.process?.env?.STREAM_PROXY_URL ||
    globalThis.process?.env?.VITE_STREAM_PROXY_URL ||
    ""
  ).trim();

  // If no explicit external proxy is set, always use same-origin /proxy
  // (implemented in functions/proxy.js on Cloudflare Pages and in server/handler.js in dev)
  if (!explicitProxy) {
    return "/proxy";
  }

  let p = explicitProxy.replace(/\/+$/, "");
  try {
    const parsed = new URL(p);
    if (!parsed.pathname || parsed.pathname === "/" || parsed.pathname === "") {
      parsed.pathname = "/api/public/proxy";
      p = parsed.href.replace(/\/+$/, "");
    }
  } catch {}
  return p;
}

export async function handle(request, env) {
  const proxyBase = getProxyBase(request, env);
  const url = new URL(request.url);
  const path = url.pathname;
  const q = (k, d = "") => url.searchParams.get(k) ?? d;

  if (request.method === "OPTIONS" && (path.startsWith("/api/") || path === "/proxy"))
    return new Response(null, { status: 204, headers: CORS });

  const blocked = await shield(request, env, path, json);
  if (blocked) return blocked;

  if (path === "/api/local-media" || path === "/api/offline-video" || path === "/api/offline-stream") {
    const loaded = await loadLocalMediaModules();
    if (!loaded || !fsNode || !pathNode) return json({ error: "Local media streaming not supported in this runtime" }, 501);

    const filePath = q("path");
    const isHls = q("hls") === "1";

    if (!filePath || !fsNode.existsSync(filePath)) {
      return json({ error: "File not found" }, 404);
    }

    const ext = pathNode.extname(filePath).toLowerCase();

    // If TS file and HLS playlist requested:
    if (isHls && ext === ".ts") {
      const segmentUrl = `/api/local-media?path=${encodeURIComponent(filePath)}`;
      const playlist = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:7200",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXTINF:1440.0,",
        segmentUrl,
        "#EXT-X-ENDLIST"
      ].join("\n");

      return new Response(playlist, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        }
      });
    }

    const stat = fsNode.statSync(filePath);
    const fileSize = stat.size;
    const range = request.headers.get("range");
    const mime = ext === ".ts" ? "video/mp2t" : ext === ".mp4" ? "video/mp4" : ext === ".webm" ? "video/webm" : ext === ".vtt" ? "text/vtt" : "video/mp4";

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const nodeStream = fsNode.createReadStream(filePath, { start, end });
      const webStream = streamNode.Readable.toWeb(nodeStream);

      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": mime,
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    const nodeStream = fsNode.createReadStream(filePath);
    const webStream = streamNode.Readable.toWeb(nodeStream);
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Length": String(fileSize),
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }

  if (path === "/proxy" || path === "/api/proxy") return proxy(request, url, proxyBase, env);

  if (path === "/api/support/shorten") {
    let targetUrl = q("url");
    if (!targetUrl && request.method === "POST") {
      try {
        const body = await request.json();
        targetUrl = body?.url || "";
      } catch {}
    }
    if (!targetUrl) {
      return json({ error: "Destination URL is required" }, 400);
    }

    const apiKey = env?.SHRINKME_API_KEY || process.env.SHRINKME_API_KEY || "165194fe77616bab2093a5fbd2a8e07a87b76e25";
    const shrinkMeApi = `https://shrinkme.io/api?api=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(targetUrl)}`;

    try {
      const resp = await fetch(shrinkMeApi, {
        headers: { "User-Agent": "AnimeStream/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        return json({ error: `Shortener API error (${resp.status})` }, 502);
      }
      const data = await resp.json().catch(() => null);
      if (!data || data.status !== "success" || !data.shortenedUrl) {
        return json({ error: data?.message || "Failed to generate shortened link" }, 502);
      }
      return json({
        success: true,
        shortenedUrl: data.shortenedUrl,
      });
    } catch (err) {
      return json({ error: err?.message || "Could not reach shortener service" }, 500);
    }
  }



  if (path === "/api/auth/check-username") {
    const rawUsername = String(url.searchParams.get("username") || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const excludeId = String(url.searchParams.get("excludeId") || "").trim();
    if (rawUsername.length < 3) {
      return json({ ok: false, available: false, error: "Username must be at least 3 characters." }, 400);
    }

    const supabaseUrl = String(env?.VITE_SUPABASE_URL || env?.SUPABASE_URL || "").trim().replace(/\/$/, "");
    const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ ok: false, adminUnavailable: true });
    }

    try {
      const headers = {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      };
      const exProfile = excludeId ? `&id=neq.${encodeURIComponent(excludeId)}` : "";
      const exSync = excludeId ? `&user_id=neq.${encodeURIComponent(excludeId)}` : "";
      const [pRes, sRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/profiles?username=ilike.${encodeURIComponent(rawUsername)}${exProfile}&select=id&limit=1`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/user_sync?username=ilike.${encodeURIComponent(rawUsername)}${exSync}&select=user_id&limit=1`, { headers }),
      ]);
      const pRows = await pRes.json().catch(() => []);
      const sRows = await sRes.json().catch(() => []);
      const taken = (Array.isArray(pRows) && pRows.length > 0) || (Array.isArray(sRows) && sRows.length > 0);
      return json({ ok: true, available: !taken, username: rawUsername });
    } catch (e) {
      return json({ ok: false, error: e?.message || "Username availability check failed" }, 502);
    }
  }

  if (path === "/api/auth/update-username") {
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    const authHeader = String(request.headers.get("authorization") || "");
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return json({ ok: false, error: "Authentication required." }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }
    const u = String(body?.username || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (u.length < 3 || u.length > 20) {
      return json({ ok: false, error: "Username must be between 3 and 20 characters." }, 400);
    }

    const supabaseUrl = String(env?.VITE_SUPABASE_URL || env?.SUPABASE_URL || "").trim().replace(/\/$/, "");
    const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ ok: false, adminUnavailable: true });
    }

    try {
      // Verify the caller's JWT via Supabase Auth
      const meRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${token}`,
        },
      });
      const meUser = await meRes.json().catch(() => null);
      if (!meRes.ok || !meUser?.id) {
        return json({ ok: false, error: "Invalid or expired session." }, 401);
      }

      const svcHeaders = {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      };

      const [pRes, sRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/profiles?username=ilike.${encodeURIComponent(u)}&id=neq.${encodeURIComponent(meUser.id)}&select=id&limit=1`, { headers: svcHeaders }),
        fetch(`${supabaseUrl}/rest/v1/user_sync?username=ilike.${encodeURIComponent(u)}&user_id=neq.${encodeURIComponent(meUser.id)}&select=user_id&limit=1`, { headers: svcHeaders }),
      ]);
      const pRows = await pRes.json().catch(() => []);
      const sRows = await sRes.json().catch(() => []);
      if ((Array.isArray(pRows) && pRows.length > 0) || (Array.isArray(sRows) && sRows.length > 0)) {
        return json({ ok: false, error: `Username @${u} is already taken. Please choose another username.` }, 409);
      }

      // Upsert into public.profiles FIRST so unique constraints reject races before auth metadata mutates
      const nowIso = new Date().toISOString();
      const upsertProfileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?on_conflict=id`, {
        method: "POST",
        headers: {
          ...svcHeaders,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({ id: meUser.id, username: u, updated_at: nowIso }),
      });
      if (!upsertProfileRes.ok) {
        const errPayload = await upsertProfileRes.json().catch(() => null);
        const errMsg = String(errPayload?.message || errPayload?.details || "");
        if (upsertProfileRes.status === 409 || /duplicate|unique/i.test(errMsg) || errPayload?.code === "23505") {
          return json({ ok: false, error: `Username @${u} is already taken. Please choose another username.` }, 409);
        }
        return json({ ok: false, error: errMsg || "Failed to update username" }, 400);
      }

      // Sync user_sync (best effort, ignoring missing row/table)
      await fetch(`${supabaseUrl}/rest/v1/user_sync?on_conflict=user_id`, {
        method: "POST",
        headers: {
          ...svcHeaders,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({ user_id: meUser.id, username: u, updated_at: nowIso }),
      }).catch(() => {});

      // Update auth user_metadata via admin API
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(meUser.id)}`, {
        method: "PUT",
        headers: svcHeaders,
        body: JSON.stringify({
          user_metadata: {
            ...(meUser.user_metadata || {}),
            username: u,
            username_chosen: true,
          },
        }),
      }).catch(() => {});

      return json({ ok: true, username: u });
    } catch (e) {
      return json({ ok: false, error: e?.message || "Failed to update username" }, 502);
    }
  }

  if (path === "/api/auth/register") {
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const rawUsername = String(body?.username || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "Please enter a valid email address." }, 400);
    }
    if (password.length < 6) {
      return json({ ok: false, error: "Password must be at least 6 characters." }, 400);
    }
    const username = rawUsername || email.split("@")[0].replace(/[^a-z0-9_-]/g, "") || "otaku";
    if (username.length < 3) {
      return json({ ok: false, error: "Username must be at least 3 characters." }, 400);
    }

    const supabaseUrl = String(env?.VITE_SUPABASE_URL || env?.SUPABASE_URL || "").trim().replace(/\/$/, "");
    const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ ok: false, adminUnavailable: true });
    }

    try {
      const svcHeaders = {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      };
      // 1. Check if username is already taken in public.profiles or public.user_sync
      const [checkRes, syncRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/profiles?username=ilike.${encodeURIComponent(username)}&select=id&limit=1`, { headers: svcHeaders }),
        fetch(`${supabaseUrl}/rest/v1/user_sync?username=ilike.${encodeURIComponent(username)}&select=user_id&limit=1`, { headers: svcHeaders }),
      ]);
      const existing = await checkRes.json().catch(() => []);
      const existingSync = await syncRes.json().catch(() => []);
      if ((Array.isArray(existing) && existing.length > 0) || (Array.isArray(existingSync) && existingSync.length > 0)) {
        return json({ ok: false, error: `Username @${username} is already taken. Please choose another one.` }, 409);
      }

      // 2. Create confirmed user in Supabase Auth
      const adminRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            username,
            full_name: username,
            username_chosen: true,
          },
        }),
      });
      const adminData = await adminRes.json().catch(() => null);
      if (!adminRes.ok) {
        const msg = adminData?.msg || adminData?.message || adminData?.error_description || "Failed to register user in Supabase";
        return json({ ok: false, error: msg }, adminRes.status >= 400 && adminRes.status < 500 ? adminRes.status : 400);
      }
      return json({ ok: true, user: adminData });
    } catch (e) {
      return json({ ok: false, error: e?.message || "Supabase admin request failed" }, 502);
    }
  }

  if (path === "/api/anilist") {
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const query = typeof payload?.query === "string" ? payload.query : "";
    const variables = payload?.variables && typeof payload.variables === "object" ? payload.variables : {};
    if (!query) return json({ error: "Missing query" }, 400);

    const cacheKey = `al:${query}:${JSON.stringify(variables)}`;
    const isDetail = /Media\s*\(/.test(query) || /id_in\s*:/.test(query);
    const freshTtl = isDetail ? 45 * 60e3 : 15 * 60e3;
    const staleTtl = 48 * 3600e3;

    const hit = memo.get(cacheKey);
    if (hit && Date.now() - hit.at < freshTtl) {
      return json(hit.v, 200, Math.floor(freshTtl / 1000));
    }

    globalThis.__alInflight ??= new Map();
    globalThis.__alCooldownUntil ??= 0;
    globalThis.__alLastReqAt ??= 0;

    if (globalThis.__alInflight.has(cacheKey)) {
      const shared = await globalThis.__alInflight.get(cacheKey);
      return json(shared.body, shared.status, shared.status === 200 ? Math.floor(freshTtl / 1000) : 0);
    }

    const work = (async () => {
      if (Date.now() < globalThis.__alCooldownUntil) {
        if (hit && Date.now() - hit.at < staleTtl) {
          return { status: 200, body: hit.v };
        }
        return { status: 429, body: { errors: [{ message: "AniList rate-limit cooldown" }] } };
      }

      // Gentle server-side pacing so cold bursts don't trigger upstream 429s
      const waitGap = Math.max(0, globalThis.__alLastReqAt + 250 - Date.now());
      globalThis.__alLastReqAt = Date.now() + waitGap;
      if (waitGap > 0) await new Promise((r) => setTimeout(r, waitGap));

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const upstream = await fetch("https://graphql.anilist.co", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(10000),
          });
          const data = await upstream.json().catch(() => null);

          if (upstream.status === 429) {
            const retryAfter = Number(upstream.headers.get("Retry-After") || "0");
            const waitMs = Math.min(Math.max((retryAfter || 1) * 1000, 800), 2500);
            globalThis.__alCooldownUntil = Date.now() + Math.max(retryAfter * 1000, 12000);
            if (attempt < 2 && !hit) {
              await new Promise((r) => setTimeout(r, waitMs));
              continue;
            }
            if (hit && Date.now() - hit.at < staleTtl) return { status: 200, body: hit.v };
            return { status: 429, body: data || { errors: [{ message: "Rate limited" }] } };
          }

          if (upstream.status >= 500) {
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 450 * (attempt + 1)));
              continue;
            }
            if (hit && Date.now() - hit.at < staleTtl) return { status: 200, body: hit.v };
            return { status: upstream.status, body: data || { errors: [{ message: `Upstream ${upstream.status}` }] } };
          }

          if (upstream.ok && data?.data) {
            memo.set(cacheKey, { at: Date.now(), v: data });
            return { status: 200, body: data };
          }

          return { status: upstream.status || 400, body: data || { errors: [{ message: "AniList error" }] } };
        } catch (err) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
          if (hit && Date.now() - hit.at < staleTtl) return { status: 200, body: hit.v };
          return { status: 502, body: { errors: [{ message: err?.message || "AniList unreachable" }] } };
        }
      }
      if (hit && Date.now() - hit.at < staleTtl) return { status: 200, body: hit.v };
      return { status: 502, body: { errors: [{ message: "AniList unreachable" }] } };
    })();

    globalThis.__alInflight.set(cacheKey, work);
    try {
      const out = await work;
      return json(out.body, out.status, out.status === 200 ? Math.floor(freshTtl / 1000) : 0);
    } finally {
      globalThis.__alInflight.delete(cacheKey);
    }
  }

  if (path === "/api/servers-available" || path === "/api/stream/servers" || path === "/api/servers") {
    const anilistId = parseInt(q("id", "0"), 10);
    const episode = parseInt(q("ep", "1"), 10) || 1;
    const title = q("title");
    const romajiTitle = q("romaji");
    const format = q("format");
    const country = q("country").toUpperCase();
    const totalEpisodes = parseInt(q("episodes", "0"), 10) || 0;
    const season = parseInt(q("season", "0"), 10) || extractSeasonFromText(title, romajiTitle) || 1;
    if (!anilistId && !title) return json({ error: "Missing id or title" }, 400);

    const key = `avail:v16:${anilistId}:${episode}:${season}:${title}:${romajiTitle}:${format}:${country}:${totalEpisodes}`;
    const isMovieFmt = String(format).toUpperCase() === "MOVIE";
    const result = await cached(key, 10 * 60e3, async () => {
      const [base, desi, waw, tb, anikoto] = await Promise.all([
        checkEpisodeAudioAvailability(anilistId, episode, title, format, {
          country,
          getAcdnHit: () => resolveAcdnShared({ anilistId, episode, isMovie: isMovieFmt, title, lang: "" }),
        }),
        title || romajiTitle
          ? Promise.race([
              checkDesiDubAvailability({ anilistId, episode, title, romajiTitle, format, totalEpisodes }).catch(() => null),
              new Promise((r) => setTimeout(() => r(null), 9000)),
            ])
          : Promise.resolve(null),
        title || romajiTitle
          ? Promise.race([
              checkWatchAnimeWorldAvailability({ anilistId, title, romajiTitle, episodes: totalEpisodes, format, season }).catch(() => null),
              new Promise((r) => setTimeout(() => r(null), 9000)),
            ])
          : Promise.resolve(null),
        title || romajiTitle
          ? Promise.race([
              checkTooniboyAvailability({ anilistId, episode, title, romajiTitle, episodes: totalEpisodes, format, countryOfOrigin: country, season }).catch(() => null),
              new Promise((r) => setTimeout(() => r(null), 9000)),
            ])
          : Promise.resolve(null),
        title || romajiTitle
          ? Promise.race([
              checkAnikotoAvailability({ episode, title, romajiTitle, format, season, country }).catch(() => null),
              new Promise((r) => setTimeout(() => r(null), 7000)),
            ])
          : Promise.resolve(null),
      ]);
      return {
        ...base,
        ...(desi ? { desidubanime: desi } : {}),
        ...(waw?.available ? { watchanimeworld: waw } : {}),
        ...(tb?.available ? { server12: tb } : {}),
        ...(anikoto ? { anikoto } : {}),
      };
    });
    const hasAnyVerified = Object.values(result || {}).some(
      (s) => s && (s.sub || s.dub || s.available || (Array.isArray(s.languages) && s.languages.length > 0))
    );
    if (!hasAnyVerified) {
      memo.delete(key);
    }
    return json({ success: true, servers: result }, 200, hasAnyVerified ? 600 : 15);
  }

  if (path === "/api/anime/detect-audio" || path === "/api/detect-audio") {
    const anilistId = parseInt(q("id", "0"), 10);
    const totalEpisodes = parseInt(q("episodes", "0"), 10) || 1;
    const title = q("title");
    const romajiTitle = q("romaji");
    const format = q("format");
    const country = (q("country") || "JP").toUpperCase();
    const seasonParam = parseInt(q("season", "0"), 10) || 0;
    const targetSeason = seasonParam > 0 ? seasonParam : (extractSeasonFromText(title, romajiTitle) || 1);
    const force = q("force") === "1";

    if (!anilistId && !title) return json({ error: "Missing anime id or title" }, 400);

    const key = `detect_audio:v4:${anilistId}:${totalEpisodes}:${targetSeason}:${country}:${title}:${romajiTitle}`;
    if (force) {
      memo.delete(key);
    }
    const report = await cached(key, 12 * 60e3, async () => {
      return detectAllEpisodesAudioServerSide({
        anilistId,
        totalEpisodes,
        title,
        romajiTitle,
        country,
        season: targetSeason,
        format,
        resolveAcdnFn: ({ anilistId: aid, episode: ep, title: t, isMovie: m }) =>
          resolveAcdnShared({ anilistId: aid, episode: ep, isMovie: m, title: t, lang: "" }),
      });
    });

    if (!report?.hasVerifiedStreams) {
      memo.delete(key);
    }
    return json({ success: true, report }, 200, report?.hasVerifiedStreams ? 300 : 15);
  }

  if (path === "/api/anime/audio-breakdown" || path === "/api/audio-breakdown") {
    const anilistId = parseInt(q("id", "0"), 10);
    const totalEpisodes = parseInt(q("episodes", "0"), 10) || 0;
    const title = q("title");
    const romajiTitle = q("romaji");
    const format = q("format");
    const country = (q("country") || "JP").toUpperCase();
    const seasonParam = parseInt(q("season", "0"), 10) || 0;
    const targetSeason = seasonParam > 1 ? seasonParam : (extractSeasonFromText(title, romajiTitle) || 1);

    if (!anilistId && !title) return json({ error: "Missing anime id or title" }, 400);

    const key = `breakdown:v11:${anilistId}:${totalEpisodes}:${targetSeason}:${country}:${title}:${romajiTitle}`;
    const breakdown = await cached(key, 10 * 60e3, async () => {
      const isMovieFmt = String(format).toUpperCase() === "MOVIE";
      const isDonghua = country === "CN" || country === "TW" || country === "HK";
      const isNonJpEastAsian = isDonghua || country === "KR";

      const hasAnyReanimeDubEntry = (json) =>
        Boolean(json?.success && Array.isArray(json.servers) && json.servers.some((s) => String(s?.dataType || "").toLowerCase().includes("dub")));

      const hasVerifiedReanimeDub = (json) => {
        if (!json?.success || !Array.isArray(json.servers)) return false;
        const subLinks = new Set();
        const dubLinks = new Set();
        for (const s of json.servers) {
          const dt = String(s?.dataType || "").toLowerCase();
          const linkBase = String(s?.dataLink || "").split("?")[0];
          if (dt.includes("sub") || dt.includes("raw")) {
            if (linkBase) subLinks.add(linkBase);
          }
          if (dt.includes("dub")) {
            if (linkBase) dubLinks.add(linkBase);
          }
        }
        if (dubLinks.size === 0) return false;
        if (isNonJpEastAsian) return [...dubLinks].some((dl) => !subLinks.has(dl));
        return true;
      };

      const rawMap = anilistId ? ANIME_MAPPING?.[String(anilistId).trim()] : null;
      const mapEntries = Array.isArray(rawMap) ? rawMap : rawMap ? [rawMap] : [];
      const mapped = anilistId ? pickMapping(ANIME_MAPPING, anilistId, 1, isMovieFmt) : null;
      const acdnEp = mapped?.startEpisode || 1;

      const hindiSummaryPromise =
        title || romajiTitle
          ? Promise.race([
              getDesiDubEpisodeSummary({ anilistId, title, romajiTitle, format, totalEpisodes }).catch(() => ({
                available: false,
                episodeCount: 0,
              })),
              new Promise((r) => setTimeout(() => r({ available: false, episodeCount: 0 }), 9000)),
            ])
          : Promise.resolve({ available: false, episodeCount: 0 });
      const wawSummaryPromise =
        title || romajiTitle
          ? Promise.race([
              checkWatchAnimeWorldAvailability({ anilistId, title, romajiTitle, episodes: totalEpisodes, format, season: targetSeason }).catch(() => ({
                available: false,
                episodeCount: 0,
              })),
              new Promise((r) => setTimeout(() => r({ available: false, episodeCount: 0 }), 9000)),
            ])
          : Promise.resolve({ available: false, episodeCount: 0 });
      const tbSummaryPromise =
        title || romajiTitle
          ? Promise.race([
              checkTooniboyAvailability({ anilistId, episode: 1, title, romajiTitle, episodes: totalEpisodes, format, countryOfOrigin: country, season: targetSeason }).catch(() => ({
                available: false,
                episodeCount: 0,
              })),
              new Promise((r) => setTimeout(() => r({ available: false, episodeCount: 0 }), 9000)),
            ])
          : Promise.resolve({ available: false, episodeCount: 0 });
      const acdnProbePromise = Promise.race([
        resolveAcdnShared({ anilistId, episode: acdnEp, isMovie: isMovieFmt, title, lang: "" }).catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 6500)),
      ]);
      const englishDubPromise = (async () => {
        let hasDub = false;
        let dubEps = 0;
        let r1Json = null;
        const tStart = Date.now();
        try {
          if (anilistId) {
            const r1 = await fetch(`https://reanime.cz/api/flix/${anilistId}/1`, {
              signal: AbortSignal.timeout(3500),
            }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
            r1Json = r1;

            if (hasVerifiedReanimeDub(r1)) {
              hasDub = true;
              dubEps = totalEpisodes || 1;

              if (totalEpisodes > 1) {
                const rLast = await fetch(`https://reanime.cz/api/flix/${anilistId}/${totalEpisodes}`, {
                  signal: AbortSignal.timeout(3500),
                }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

                if (rLast?.success && !hasVerifiedReanimeDub(rLast)) {
                  // Dub is in-progress. Probe binary search to locate highest dub episode within time budget.
                  let low = 1;
                  let high = totalEpisodes - 1;
                  let bestDub = 1;
                  while (low <= high && Date.now() - tStart < 6000) {
                    const mid = Math.floor((low + high) / 2);
                    const rMid = await fetch(`https://reanime.cz/api/flix/${anilistId}/${mid}`, {
                      signal: AbortSignal.timeout(2500),
                    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
                    if (hasVerifiedReanimeDub(rMid)) {
                      bestDub = mid;
                      low = mid + 1;
                    } else {
                      high = mid - 1;
                    }
                  }
                  dubEps = bestDub;
                }
              }
            }
          }
        } catch {}
        return { hasDub, dubEps, r1Json };
      })();

      const [acdnHit, engRes, hindiSummary, wawSummary, tbSummary] = await Promise.all([
        acdnProbePromise,
        englishDubPromise,
        hindiSummaryPromise,
        wawSummaryPromise,
        tbSummaryPromise,
      ]);

      let hasMultiDub = false;
      let multiDubEpisodes = 0;

      // 1. Only count ACDN / AnimeSalt Multi-Dub if episode 1 actually resolved to a verified playable stream
      if (acdnHit?.streamUrl) {
        const isMulti = Boolean(acdnHit.multiAudio || acdnHit.hasHindi || acdnHit.isMultiAudioHls);
        if (isMulti) {
          hasMultiDub = true;
          multiDubEpisodes = totalEpisodes || 1;

          if (mapped?.saltId && !isMovieFmt) {
            const isMultiSeasonMapped = mapEntries.length > 1;
            try {
              const mirrorUrls = [
                `https://animesalt.ro/series/${mapped.saltId}/`,
                `https://animesalt.cx/tvshows/${mapped.saltId}/`,
                `https://animesalt.ac/tvshows/${mapped.saltId}/`,
              ];
              const html = await Promise.any(
                mirrorUrls.map((u) =>
                  fetch(u, {
                    headers: { "User-Agent": UA },
                    signal: AbortSignal.timeout(3500),
                  }).then(async (r) => {
                    if (!r.ok) throw new Error("not ok");
                    const t = await r.text();
                    if (!t.includes("/episode/") && !t.includes(`/${mapped.saltId}-`)) throw new Error("no episodes");
                    return t;
                  })
                )
              );
              const saltSeason = mapped.season || targetSeason || 1;
              const reSeason = new RegExp(`(?:/episode/)?${mapped.saltId}-${saltSeason}x(\\d+)/`, "gi");
              const epsSeason = [...html.matchAll(reSeason)].map((m) => parseInt(m[1], 10)).filter(Boolean);
              let parsedEps = epsSeason.length > 0 ? Math.max(...epsSeason) : 0;

              if (parsedEps === 0 && saltSeason === 1) {
                const reSingle = new RegExp(`(?:/episode/)?${mapped.saltId}-episode-(\\d+)/`, "gi");
                const epsSingle = [...html.matchAll(reSingle)].map((m) => parseInt(m[1], 10)).filter(Boolean);
                if (epsSingle.length > 0) parsedEps = Math.max(...epsSingle);
              }

              const seasonTabCount = parseInt(
                html.match(new RegExp(`Season\\s+${saltSeason}\\b[^<]*?\\((\\d+)\\)`, "i"))?.[1] || "0",
                10,
              );
              if (seasonTabCount > 0 && parsedEps === 0) parsedEps = seasonTabCount;

              if (isMultiSeasonMapped && mapEntries.length > 1 && totalEpisodes > parsedEps) {
                // Continuous multi-season AniList entry (e.g. Naruto Shippuden, One Piece, Bleach): binary search highest dubbed season
                let low = 0;
                let high = mapEntries.length - 1;
                let bestIdx = 0;
                const tMapStart = Date.now();
                const isMultiHit = (p) => Boolean(p?.streamUrl && (p.multiAudio || p.hasHindi || p.isMultiAudioHls));
                while (low <= high && Date.now() - tMapStart < 7000) {
                  const mid = Math.floor((low + high) / 2);
                  if (mid === 0) {
                    low = 1;
                    continue;
                  }
                  const probeMid = await Promise.race([
                    resolveAcdnShared({
                      anilistId,
                      episode: mapEntries[mid].startEpisode || 1,
                      isMovie: false,
                      title,
                      lang: "",
                    }).catch(() => null),
                    new Promise((r) => setTimeout(() => r(null), 3500)),
                  ]);
                  if (isMultiHit(probeMid)) {
                    bestIdx = mid;
                    low = mid + 1;
                  } else {
                    high = mid - 1;
                  }
                }

                const seasonStart = mapEntries[bestIdx]?.startEpisode || 1;
                const seasonEndCap = bestIdx + 1 < mapEntries.length
                  ? Math.min(totalEpisodes, (mapEntries[bestIdx + 1].startEpisode || totalEpisodes) - 1)
                  : totalEpisodes;
                let maxMappedEp = seasonStart;
                if (seasonEndCap > seasonStart) {
                  const probeEnd = await Promise.race([
                    resolveAcdnShared({
                      anilistId,
                      episode: seasonEndCap,
                      isMovie: false,
                      title,
                      lang: "",
                    }).catch(() => null),
                    new Promise((r) => setTimeout(() => r(null), 3500)),
                  ]);
                  if (isMultiHit(probeEnd)) {
                    maxMappedEp = seasonEndCap;
                  } else {
                    let sLow = seasonStart + 1;
                    let sHigh = seasonEndCap - 1;
                    while (sLow <= sHigh && Date.now() - tMapStart < 9000) {
                      const sMid = Math.floor((sLow + sHigh) / 2);
                      const probeEp = await Promise.race([
                        resolveAcdnShared({
                          anilistId,
                          episode: sMid,
                          isMovie: false,
                          title,
                          lang: "",
                        }).catch(() => null),
                        new Promise((r) => setTimeout(() => r(null), 2500)),
                      ]);
                      if (isMultiHit(probeEp)) {
                        maxMappedEp = sMid;
                        sLow = sMid + 1;
                      } else {
                        sHigh = sMid - 1;
                      }
                    }
                  }
                }
                multiDubEpisodes = Math.max(parsedEps || 0, Math.min(totalEpisodes, maxMappedEp));
              } else if (parsedEps > 0) {
                multiDubEpisodes = totalEpisodes > 0 ? Math.min(totalEpisodes, parsedEps) : parsedEps;
              }
            } catch {
              /* keep acdnHit episode fallback capped to totalEpisodes */
            }
          }
        }
      }

      // 2. English Dub availability across FlixCloud HLS, MegaPlay, Vidstream, ACDN, and WatchAnimeWorld
      let hasEnglishDub = engRes.hasDub;
      let dubEpisodes = engRes.dubEps;
      let ep1Avail = null;

      if (!hasEnglishDub || (acdnHit?.streamUrl && !acdnHit?.hasHindi)) {
        try {
          ep1Avail = await Promise.race([
            checkEpisodeAudioAvailability(anilistId, 1, title, format, {
              country,
              getAcdnHit: () => Promise.resolve(acdnHit),
            }).catch(() => null),
            new Promise((r) => setTimeout(() => r(null), 8500)),
          ]);
        } catch {}
      }

      if (!hasEnglishDub && ep1Avail) {
        const directEng = Boolean(ep1Avail.megaplay?.dub || ep1Avail.vidstream?.dub);
        const flxEng = Boolean(ep1Avail.flixcloud?.dub);
        const acdnEng = Boolean(ep1Avail.acdn?.languages?.includes("English"));

        if (directEng || flxEng || acdnEng) {
          hasEnglishDub = true;
          if (directEng) {
            dubEpisodes = Math.max(dubEpisodes, totalEpisodes || 1);
          } else if (flxEng) {
            let flxCount = totalEpisodes || 1;
            if (totalEpisodes > 1 && anilistId && hasAnyReanimeDubEntry(engRes.r1Json)) {
              const tFlx = Date.now();
              const rLast = await fetch(`https://reanime.cz/api/flix/${anilistId}/${totalEpisodes}`, {
                signal: AbortSignal.timeout(3500),
              }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
              if (rLast?.success && !hasAnyReanimeDubEntry(rLast)) {
                let low = 1;
                let high = totalEpisodes - 1;
                let bestDub = 1;
                while (low <= high && Date.now() - tFlx < 5000) {
                  const mid = Math.floor((low + high) / 2);
                  const rMid = await fetch(`https://reanime.cz/api/flix/${anilistId}/${mid}`, {
                    signal: AbortSignal.timeout(2500),
                  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
                  if (hasAnyReanimeDubEntry(rMid)) {
                    bestDub = mid;
                    low = mid + 1;
                  } else {
                    high = mid - 1;
                  }
                }
                flxCount = bestDub;
              }
            }
            dubEpisodes = Math.max(dubEpisodes, flxCount);
          } else if (acdnEng) {
            dubEpisodes = Math.max(dubEpisodes, multiDubEpisodes || totalEpisodes || 1);
          }
        }
      }

      if (wawSummary?.available && Array.isArray(wawSummary.languages) && wawSummary.languages.includes("English")) {
        hasEnglishDub = true;
        dubEpisodes = Math.max(dubEpisodes, wawSummary.episodeCount || totalEpisodes || 1);
      }
      if (tbSummary?.available && Array.isArray(tbSummary.languages) && tbSummary.languages.includes("English")) {
        hasEnglishDub = true;
        dubEpisodes = Math.max(dubEpisodes, tbSummary.episodeCount || totalEpisodes || 1);
      }

      // 3. Dedicated Hindi Dub & Multi-Dub episode summaries
      if (wawSummary?.available && (wawSummary.episodeCount > 0 || totalEpisodes > 0)) {
        hasMultiDub = true;
        const wawEps = wawSummary.episodeCount || totalEpisodes || 1;
        multiDubEpisodes = Math.max(multiDubEpisodes, wawEps);
      }
      if (tbSummary?.available && tbSummary.multi && (tbSummary.episodeCount > 0 || totalEpisodes > 0)) {
        hasMultiDub = true;
        const tbEps = tbSummary.episodeCount || totalEpisodes || 1;
        multiDubEpisodes = Math.max(multiDubEpisodes, tbEps);
      }
      if (totalEpisodes > 0) {
        multiDubEpisodes = Math.min(totalEpisodes, multiDubEpisodes);
        dubEpisodes = Math.min(totalEpisodes, dubEpisodes);
      }

      const acdnHasLangList = Array.isArray(ep1Avail?.acdn?.languages) && ep1Avail.acdn.languages.length > 0;
      const acdnHasHindi = Boolean(acdnHit?.hasHindi || (acdnHasLangList && ep1Avail.acdn.languages.includes("Hindi")));
      const wawHasLangList = Boolean(wawSummary?.available && Array.isArray(wawSummary?.languages) && wawSummary.languages.length > 0);
      const wawHasHindi = Boolean(wawSummary?.available && (!wawHasLangList || wawSummary.languages.includes("Hindi")));
      const tbHasHindi = Boolean(tbSummary?.available && Array.isArray(tbSummary?.languages) && tbSummary.languages.includes("Hindi"));
      const hasMultiHindi = Boolean(
        hasMultiDub &&
          multiDubEpisodes > 0 &&
          (wawHasHindi || tbHasHindi || acdnHasHindi || (!wawSummary?.available && !tbSummary?.available && !acdnHasLangList)),
      );
      const hasHindiDub = Boolean(
        (hindiSummary?.available && hindiSummary?.episodeCount > 0) ||
        wawHasHindi ||
        tbHasHindi ||
        hasMultiHindi
      );
      let hindiDubEpisodes = Math.max(
        hindiSummary?.episodeCount || 0,
        wawHasHindi ? wawSummary?.episodeCount || 0 : 0,
        tbHasHindi ? tbSummary?.episodeCount || 0 : 0,
        hasMultiHindi ? multiDubEpisodes : 0,
      );
      if (totalEpisodes > 0) {
        hindiDubEpisodes = Math.min(totalEpisodes, hindiDubEpisodes);
      }

      return computeAudioBreakdown({
        totalEpisodes,
        hasMultiDub,
        multiDubEpisodes,
        hasEnglishDub,
        dubEpisodes,
        hasHindiDub,
        hindiDubEpisodes,
        countryOfOrigin: country,
      });
    });

    return json({ success: true, breakdown }, 200, 300);
  }

  if (path === "/api/stream") {
      // Direct stream extraction is private. Only AnimeStream Player embed is provided.
      const referer = request.headers.get("Referer") || "";
      let isLocal = false;
      try {
        const reqUrl = new URL(request.url);
        isLocal = reqUrl.hostname === "localhost" || reqUrl.hostname === "127.0.0.1" || reqUrl.hostname.endsWith(".zenkai.cfd") || reqUrl.hostname === "zenkai.cfd";
      } catch {}
      const isEmbedPlayer = isLocal || referer.includes("/embed") || referer.includes("/watch") || referer.includes("localhost") || referer.includes("127.0.0.1") || referer.includes("zenkai.cfd") || request.headers.has("X-Zenkai-Embed");
      const secSite = request.headers.get("Sec-Fetch-Site");
      const originHdr = request.headers.get("Origin");
      if (!isEmbedPlayer) {
        if (originHdr) {
          try {
            const originHost = new URL(originHdr).host;
            const reqHost = new URL(request.url).host;
            if (originHost !== reqHost && !originHost.includes("localhost") && !originHost.includes("127.0.0.1") && !originHost.includes("zenkai.cfd") && !originHost.includes("pages.dev")) {
              return json({ error: "Direct stream extraction is private. Please use the AnimeStream Player embed at /embed." }, 403);
            }
          } catch {}
        }
        if (secSite === "cross-site") {
          return json({ error: "Direct stream extraction is private. Please use the AnimeStream Player embed at /embed." }, 403);
        }
      }
    const anilistId = parseInt(q("id", "0"), 10);
    const episode = parseInt(q("ep", "1"), 10) || 1;
    const server = q("server", "megaplay").toLowerCase();
    const audio = q("audio", "sub").toLowerCase();
    const title = q("title");
    const country = q("country").toUpperCase();
    const origLang = getOriginalLanguageForCountry(country);
    if (!anilistId && !title) return json({ error: "Missing id or title" }, 400);

    // Anikoto (anikoto.cz): direct HLS English Dub & Sub extracted from anikoto.cz (zero external embed player)
    if (server === "anikoto" || server.startsWith("anikoto-")) {
      const format = q("format");
      const romajiTitle = q("romaji");
      const targetAudio = audio === "sub" ? "sub" : "dub";
      try {
        const r = await cached(`anikoto-stream:v1:${anilistId}:${episode}:${targetAudio}:${format}:${title}`, 12 * 60e3, () =>
          resolveAnikoto({ anilistId, episode, title, romajiTitle, format, audio: targetAudio }),
        );
        if (!r?.streamUrl) return json({ error: `No ${targetAudio.toUpperCase()} stream found on Anikoto for this episode` }, 404);
        const ref = r.referer || "https://megaplay.buzz/";
        const viaProxy = `${proxyBase}?url=${encodeURIComponent(r.streamUrl)}&referer=${encodeURIComponent(ref)}&audio=${encodeURIComponent(targetAudio)}`;
        return json({
          success: true,
          server: "Anikoto",
          audio: targetAudio,
          audioLabel: targetAudio === "dub" ? "English (Dub)" : `${origLang} (Original)`,
          multiAudio: false,
          format: "hls",
          streamUrl: viaProxy,
          fallbackStreamUrl: viaProxy,
          rawStreamUrl: r.streamUrl,
          referer: ref,
          subtitles: (r.subtitles || []).map((s) => ({
            ...s,
            file: s.file && !s.file.startsWith("/proxy") && !s.file.startsWith("http://localhost")
              ? `${proxyBase}?url=${encodeURIComponent(s.file)}&referer=${encodeURIComponent(ref)}`
              : s.file,
          })),
          intro: r.intro || null,
          outro: r.outro || null,
        });
      } catch (e) {
        return json({ error: e.message || "Anikoto resolution failed" }, 502);
      }
    }

    // DesiDubAnime: strictly Hindi-only direct HLS extracted from desidubanime.me (zero external embed player)
    if (server === "desidubanime" || server === "desidub" || server === "desi") {
      const format = q("format");
      const romajiTitle = q("romaji");
      try {
        const r = await cached(`desi-stream:v1:${anilistId}:${episode}:${format}:${title}`, 15 * 60e3, () =>
          resolveDesiDubAnime({ anilistId, episode, title, romajiTitle, format }),
        );
        if (!r?.streamUrl) return json({ error: "No Hindi dub stream found on DesiDubAnime for this episode" }, 404);
        const ref = r.referer || "https://www.desidubanime.me/";
        const viaProxy = `${proxyBase}?url=${encodeURIComponent(r.streamUrl)}&referer=${encodeURIComponent(ref)}&audio=dub`;
        return json({
          success: true,
          server: "DesiDubAnime",
          audio: "dub",
          audioLabel: "Hindi (Dub)",
          multiAudio: false,
          hindiOnly: true,
          format: "hls",
          streamUrl: viaProxy,
          fallbackStreamUrl: viaProxy,
          rawStreamUrl: r.streamUrl,
          referer: ref,
          subtitles: (r.subtitles || []).map((s) => ({
            ...s,
            file: s.file && !s.file.startsWith("/proxy") && !s.file.startsWith("http://localhost")
              ? `${proxyBase}?url=${encodeURIComponent(s.file)}&referer=${encodeURIComponent(ref)}`
              : s.file,
          })),
          intro: null,
          outro: null,
        });
      } catch (e) {
        return json({ error: e.message || "DesiDubAnime resolution failed" }, 502);
      }
    }

    // WatchAnimeWorld: multi-dub direct HLS extracted from watchanimeworld.one (zero external embed player)
    if (server === "watchanimeworld" || server === "animeworld" || server === "waw") {
      const format = q("format");
      const romajiTitle = q("romaji");
      try {
        const r = await cached(`waw-stream:v1:${anilistId}:${episode}:${format}:${title}`, 15 * 60e3, () =>
          resolveWatchAnimeWorld({ anilistId, episode, title, romajiTitle, format }),
        );
        if (!r?.streamUrl) return json({ error: "No stream found on AnimeWorld for this episode" }, 404);
        const ref = r.referer || "https://play.zephyrix.org/";
        const viaProxy = `${proxyBase}?url=${encodeURIComponent(r.streamUrl)}&referer=${encodeURIComponent(ref)}&audio=dub`;
        return json({
          success: true,
          server: "AnimeWorld",
          audio: "dub",
          audioLabel: "Multi-Audio (Hindi, Tamil, Telugu, English)",
          multiAudio: true,
          format: "hls",
          streamUrl: viaProxy,
          fallbackStreamUrl: viaProxy,
          rawStreamUrl: r.streamUrl,
          referer: ref,
          subtitles: (r.subtitles || []).map((s) => ({
            ...s,
            file: s.file && !s.file.startsWith("/proxy") && !s.file.startsWith("http://localhost")
              ? `${proxyBase}?url=${encodeURIComponent(s.file)}&referer=${encodeURIComponent(ref)}`
              : s.file,
          })),
          intro: null,
          outro: null,
        });
      } catch (e) {
        return json({ error: e.message || "AnimeWorld resolution failed" }, 502);
      }
    }

    // Masked multi-dub slot 12: direct HLS/MP4 playback inside CinePlayer (never exposes provider name)
    if (server === "tooniboy" || server === "server12") {
      const format = q("format");
      const romajiTitle = q("romaji");
      try {
        const r = await cached(`tb-stream-api:v1:${anilistId}:${episode}:${format}:${country}:${title}`, 15 * 60e3, () =>
          resolveTooniboy({ anilistId, episode, title, romajiTitle, format, countryOfOrigin: country }),
        );
        if (!r?.streamUrl) return json({ error: "No stream found on Server 12 for this episode" }, 404);
        const ref = r.referer || "https://rubystm.com/";
        const viaProxy = `${proxyBase}?url=${encodeURIComponent(r.streamUrl)}&referer=${encodeURIComponent(ref)}&audio=dub`;
        return json({
          success: true,
          server: "Server 12",
          audio: "dub",
          audioLabel: r.audioLabel || "Multi-Audio",
          multiAudio: Boolean(r.multiAudio),
          languages: r.languages || [],
          format: r.format || "hls",
          streamUrl: viaProxy,
          fallbackStreamUrl: viaProxy,
          rawStreamUrl: r.streamUrl,
          referer: ref,
          subtitles: (r.subtitles || []).map((s) => ({
            ...s,
            file: s.file && !s.file.startsWith("/proxy") && !s.file.startsWith("http://localhost")
              ? `${proxyBase}?url=${encodeURIComponent(s.file)}&referer=${encodeURIComponent(ref)}`
              : s.file,
          })),
          intro: null,
          outro: null,
        });
      } catch (e) {
        return json({ error: e.message || "Server 12 resolution failed" }, 502);
      }
    }

    // ACDN: multi-audio direct stream (anime-mapping.json + AnimeDekho / AnimeSalt), audio is picked inside the player
    if (server === "acdn") {
      const isMovie = q("format").toUpperCase() === "MOVIE" || q("isMovie") === "true";
      const lang = q("lang") || (audio === "dub" ? "Hindi" : audio === "sub" ? origLang : "");
      try {
        const r = await resolveAcdnShared({ anilistId, episode, isMovie, title, lang });
        if (!r?.streamUrl) return json({ error: "No multi-audio stream found on ACDN for this episode" }, 404);
        // resolveAcdn() returns `kind` ("hls" | "file"), not `format`.
        const isFile = r.kind === "file" || r.streamUrl.includes(".mp4") || r.streamUrl.includes("/sora/");
        // ravok.buzz / as-cdn use nginx secure_link (IP-bound md5 tokens): the token is minted here, so the
        // manifest and ALL segments must be fetched from the same egress IP. That is Zenkai's own /proxy
        // (same Pages Function that resolved the stream), never seg=1 and not a second Worker on another account.
        const viaProxy = (base) =>
          `${base}?url=${encodeURIComponent(r.streamUrl)}&referer=${encodeURIComponent(r.referer || "https://animesalt.cx/")}${audio ? "&audio=" + encodeURIComponent(audio) : ""}`;
        return json({
          success: true,
          server: "ACDN",
          audio: "multi",
          audioLabel: r.audioLabel || undefined,
          multiAudio: true,
          format: isFile ? "file" : "hls",
          streamUrl: viaProxy("/proxy"),
          fallbackStreamUrl: viaProxy(proxyBase),
          rawStreamUrl: r.streamUrl,
          referer: r.referer || "https://animesalt.cx/",
          subtitles: (r.subtitles || []).map((s) => ({
            ...s,
            file: s.file && !s.file.startsWith("/proxy") && !s.file.startsWith("http://localhost")
              ? `/proxy?url=${encodeURIComponent(s.file)}&referer=${encodeURIComponent(r.referer || "https://ravok.buzz/")}`
              : s.file,
          })),
          intro: null,
          outro: null,
        });
      } catch (e) {
        return json({ error: e.message || "ACDN resolution failed" }, 502);
      }
    }

    // FlixCloud: direct HLS from Re:Anime / FlixCloud (enc-dec / Web Crypto decrypted)
    if (server.startsWith("flixcloud")) {
      try {
        const r = await cached(`flixcloud:${anilistId}:${episode}:${audio}:1:${title}`, 10 * 60e3, () =>
          resolveFlixCloud({ anilistId, episode, audio, title, preferredServer: "1" })
        );
        if (!r?.streamUrl) return json({ error: `No ${audio.toUpperCase()} stream found on FlixCloud` }, 404);
        return json({
          success: true,
          server: "FlixCloud",
          audio: r.audio,
          audioLabel: r.audio === "dub" ? "English (Dub)" : `${origLang} (Original)`,
          streamUrl: `${proxyBase}?url=${encodeURIComponent(r.streamUrl)}&referer=${encodeURIComponent(r.referer || "https://flixcloud.cc/")}&audio=${encodeURIComponent(audio)}`,
          rawStreamUrl: r.streamUrl,
          referer: r.referer || "https://flixcloud.cc/",
          subtitles: (r.subtitles || []).map((s) => ({
          ...s,
          file: s.file && !s.file.startsWith("/proxy") && !s.file.startsWith("http://localhost")
            ? `${proxyBase}?url=${encodeURIComponent(s.file)}&referer=${encodeURIComponent(r.referer || "https://flixcloud.cc/")}`
            : s.file,
        })),
          intro: r.intro,
          outro: r.outro,
        });
      } catch (e) {
        return json({ error: e.message || "FlixCloud resolution failed" }, 502);
      }
    }

    try {
      const r = await resolveDirectStreamWorker({ anilistId, episode, audio, server, title });
      if (!r?.streamUrl) return json({ error: `No ${audio.toUpperCase()} stream found on ${server}` }, 404);
      return json({
        success: true,
        server: r.server,
        audio: r.audio,
        audioLabel: r.audio === "dub" ? "English (Dub)" : `${origLang} (Original)`,
        streamUrl: `${proxyBase}?url=${encodeURIComponent(r.streamUrl)}&referer=${encodeURIComponent(r.referer || "https://megaplay.buzz/")}&audio=${encodeURIComponent(audio)}`,
        rawStreamUrl: r.streamUrl,
        referer: r.referer || "https://megaplay.buzz/",
        subtitles: (r.subtitles || []).map((s) => ({
        ...s,
        file: s.file && !s.file.startsWith("/proxy") && !s.file.startsWith("http://localhost")
          ? `${proxyBase}?url=${encodeURIComponent(s.file)}&referer=${encodeURIComponent(r.referer || "https://megaplay.buzz/")}`
          : s.file,
      })),
        intro: r.intro,
        outro: r.outro,
      });
    } catch (e) {
      return json({ error: e.message || "Stream resolution failed" }, 502);
    }
  }

  if (path === "/api/subtitles") {
    try {
      const subs = await subtitlesFor(parseInt(q("id", "0"), 10), q("title"), parseInt(q("ep", "1"), 10) || 1, q("format").toUpperCase());
      return json({ success: true, subtitles: subs }, 200, 3600);
    } catch {
      return json({ success: false, subtitles: [] }, 200);
    }
  }

  if (path === "/api/resolve-imdb") {
    try {
      const altRaw = q("altTitles");
      const altTitles = altRaw
        ? altRaw
            .split("||")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const resolved = await resolveImdbMetadata(
        {
          imdbId: q("imdbId"),
          tmdbId: parseInt(q("tmdbId", "0"), 10) || null,
          malId: parseInt(q("malId", "0"), 10) || null,
          anilistId: parseInt(q("anilistId", "0"), 10) || null,
          type: q("type") || null,
          format: q("format") || null,
          season: parseInt(q("season", "0"), 10) || null,
          title: q("title") || null,
          englishTitle: q("englishTitle") || null,
          romajiTitle: q("romajiTitle") || null,
          nativeTitle: q("nativeTitle") || null,
          altTitles,
          year: q("year") || null,
        },
        { env, mapOf },
      );
      return json({ success: Boolean(resolved?.imdbId), ...resolved }, 200, resolved?.imdbId ? 86400 : 300);
    } catch {
      return json({ success: false, imdbId: null }, 200, 60);
    }
  }

  if (path === "/api/skip-times") {
    const malId = parseInt(q("malId", "0"), 10);
    const anilistId = parseInt(q("anilistId", "0"), 10);
    const ep = Math.max(1, parseInt(q("ep", q("episode", "1")), 10) || 1);
    const tmdbId = parseInt(q("tmdbId", "0"), 10);
    const imdbRaw = q("imdbId").trim();
    const imdbId = /^tt\d{5,}$/i.test(imdbRaw) ? imdbRaw : "";
    const reqType = q("type").toLowerCase();
    const mediaType = reqType === "movie" || reqType === "tv" ? reqType : undefined;
    const format = q("format").trim().toUpperCase() || undefined;
    const season = parseInt(q("season", "0"), 10) || undefined;
    const episode = Math.max(1, parseInt(q("episode", String(ep)), 10) || 1);
    const altRaw = q("altTitles");
    const altTitles = altRaw
      ? altRaw
          .split("||")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    if (!malId && !anilistId && !tmdbId && !imdbId && !q("title").trim()) {
      return json({ success: false, aniSkip: null, theIntroDb: null, introDb: null }, 200, 60);
    }

    try {
      const data = await resolveSkipTimesPayload(
        {
          malId: malId || null,
          anilistId: anilistId || null,
          ep,
          tmdbId: tmdbId || null,
          imdbId: imdbId || null,
          type: mediaType,
          format,
          season,
          episode,
          title: q("title") || null,
          englishTitle: q("englishTitle") || null,
          romajiTitle: q("romajiTitle") || null,
          nativeTitle: q("nativeTitle") || null,
          altTitles,
          year: q("year") || null,
        },
        { env, mapOf },
      );

      const hasAny = Boolean(
        data?.introDb?.intro ||
          data?.introDb?.recap ||
          data?.introDb?.outro ||
          data?.introDb?.post_credits ||
          data?.aniSkip?.length ||
          data?.theIntroDb?.intro?.length ||
          data?.theIntroDb?.credits?.length,
      );
      return json(data, 200, hasAny ? 3600 : 120);
    } catch {
      return json({ success: false, aniSkip: null, theIntroDb: null, introDb: null }, 200, 0);
    }
  }

  const mapMatch = path.match(/^\/api\/mapping\/(\d+)\/?$/);
  if (mapMatch) {
    const m = await mapOf(parseInt(mapMatch[1], 10));
    return m ? json({ success: true, data: m }, 200, 86400) : json({ success: false, data: null }, 200, 600);
  }

  if (path === "/api/tmdb") {
    const id = parseInt(q("id", "0"), 10);
    const title = q("title");
    const format = q("format").toUpperCase();
    if (!id && !title) return json({ error: "Missing id or title" }, 400);
    try {
      const r = await cached(`tmdb:v6:${id}:${title}:${format}`, 24 * 3600e3, async () => {
        const res = await tmdbFor(id, title, format, env);
        return res?.tmdb ? res : null;
      });
      return json({ success: !!r?.tmdb, mapping: r?.map ?? null, tmdb: r?.tmdb ?? null }, 200, r?.tmdb ? 86400 : 0);
    } catch {
      return json({ success: false, mapping: null, tmdb: null }, 200, 0);
    }
  }

  // Search endpoint: /api/movies/search?q=dune&type=multi|movie|tv  ->  { results: [normalised titles] }
  if (path === "/api/movies/search") {
    const term = q("q").trim();
    const kind = ["movie", "tv"].includes(q("type")) ? q("type") : "multi";
    if (term.length < 2) return json({ results: [] }, 200, 60);
    try {
      const d = await cached(`msearch:${kind}:${term.toLowerCase()}`, 10 * 60e3, () => tmdbFetch(`search/${kind}?query=${encodeURIComponent(term)}&include_adult=false&language=en-US`, env));
      const results = (d.results || [])
        .filter((r) => (r.media_type ? r.media_type === "movie" || r.media_type === "tv" : true) && r.poster_path)
        .slice(0, 20)
        .map((r) => ({
          id: r.id,
          type: r.media_type === "tv" || kind === "tv" ? "tv" : "movie",
          title: r.title || r.name,
          poster: r.poster_path,
          backdrop: r.backdrop_path || null,
          year: (r.release_date || r.first_air_date || "").slice(0, 4) || null,
          rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
          overview: r.overview || "",
          genreIds: r.genre_ids || [],
        }));
      return json({ results }, 200, 600);
    } catch {
      return json({ results: [], error: "Search is unavailable right now" }, 200);
    }
  }

  // Ad-free & blur-free CinemaOS iframe wrapper (runs on same origin so CinemaOS doesn't nuke sandboxed controls)
  if (path === "/api/movies/cinemaos-frame") {
    const type = q("type", "movie").toLowerCase() === "tv" ? "tv" : "movie";
    const tmdbId = parseInt(q("id", "0"), 10);
    const season = Math.max(1, parseInt(q("s", q("season", "1")), 10) || 1);
    const episode = Math.max(1, parseInt(q("e", q("episode", "1")), 10) || 1);
    const lang = q("lang", "en").replace(/[^a-z0-9_-]/gi, "") || "en";
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return json({ error: "Missing id" }, 400);
    }

    const playerPath = type === "tv" ? `/player/${tmdbId}/${season}/${episode}` : `/player/${tmdbId}`;
    const targetUrl = `https://cinemaos.tech${playerPath}?lang=${encodeURIComponent(lang)}`;
    try {
      const up = await fetch(targetUrl, {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://cinemaos.tech/",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(9000),
      });
      const rawHtml = await up.text();
      if (!up.ok || !isValidEmbedResponse(up.status, rawHtml)) {
        return new Response(
          "<!DOCTYPE html><html><body style='margin:0;background:#000;color:#fff;display:grid;place-items:center;height:100vh;font-family:sans-serif'>CinemaOS stream temporarily unavailable. Try switching server below.</body></html>",
          { status: 502, headers: { ...CORS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
        );
      }
      const sanitized = sanitizeCinemaOsHtml(rawHtml, { playerPath, lang });
      return new Response(sanitized, {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response(
        "<!DOCTYPE html><html><body style='margin:0;background:#000;color:#fff;display:grid;place-items:center;height:100vh;font-family:sans-serif'>CinemaOS request timed out. Try switching server below.</body></html>",
        { status: 504, headers: { ...CORS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
      );
    }
  }

  // Same-origin proxy strictly pinned to https://cinemaos.tech for CinemaOS JS/CSS/API requests inside cinemaos-frame
  if (path === "/api/movies/cinemaos-proxy") {
    const relPath = url.searchParams.get("path") || "";
    if (!relPath.startsWith("/") || relPath.startsWith("//") || relPath.includes("\\")) {
      return json({ error: "Invalid proxy path" }, 400);
    }
    if (/afgodscarpe|popads|popcash|adsterra|propeller|doubleclick|googlesyndication|googletagmanager|exoclick/i.test(relPath)) {
      return new Response("", { status: 204, headers: CORS });
    }
    const targetUrl = `https://cinemaos.tech${relPath}`;
    try {
      const fwdHeaders = new Headers({
        "User-Agent": UA,
        "Referer": "https://cinemaos.tech/player/",
        "Origin": "https://cinemaos.tech",
        "Accept": request.headers.get("accept") || "*/*",
      });
      const ctReq = request.headers.get("content-type");
      if (ctReq) fwdHeaders.set("Content-Type", ctReq);
      const rngReq = request.headers.get("range");
      if (rngReq) fwdHeaders.set("Range", rngReq);

      const method = (request.method || "GET").toUpperCase();
      const body = method !== "GET" && method !== "HEAD" ? await request.arrayBuffer() : undefined;
      const up = await fetch(targetUrl, {
        method,
        headers: fwdHeaders,
        body: body && body.byteLength > 0 ? body : undefined,
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });

      const ct = (up.headers.get("content-type") || "").toLowerCase();
      const lowerPath = relPath.split("?")[0].toLowerCase();
      const out = new Headers(CORS);
      if (ct) out.set("Content-Type", up.headers.get("content-type"));

      if (ct.includes("javascript") || ct.includes("ecmascript") || lowerPath.endsWith(".js")) {
        const js = sanitizeCinemaOsJs(await up.text());
        out.set("Content-Type", "application/javascript; charset=utf-8");
        out.set("Cache-Control", "public, max-age=1800");
        return new Response(js, { status: up.status, headers: out });
      }
      if (ct.includes("text/css") || lowerPath.endsWith(".css")) {
        const css = sanitizeCinemaOsCss(await up.text());
        out.set("Content-Type", "text/css; charset=utf-8");
        out.set("Cache-Control", "public, max-age=1800");
        return new Response(css, { status: up.status, headers: out });
      }
      for (const h of ["Content-Range", "Accept-Ranges", "Cache-Control"]) {
        const v = up.headers.get(h);
        if (v) out.set(h, v);
      }
      return new Response(up.body, { status: up.status, headers: out });
    } catch {
      return json({ error: "CinemaOS proxy error" }, 502);
    }
  }

  // Detect whether a TMDB movie is an anime film and resolve its AniList metadata (MOVIE/OVA/SPECIAL)
  if (path === "/api/movies/anime-match") {
    const tmdbId = parseInt(q("id", "0"), 10);
    const type = q("type", "movie").toLowerCase();
    if (!Number.isFinite(tmdbId) || tmdbId <= 0 || type !== "movie") {
      return json({ isAnimeMovie: false }, 200, 3600);
    }
    const qTitle = String(q("title", "")).trim();
    const qYear = parseInt(q("year", "0"), 10) || null;
    const qLang = String(q("lang", "")).toLowerCase().trim();

    try {
      const result = await cached(`anime-match:v2:${tmdbId}`, 24 * 3600e3, async () => {
        let anilistId = null;

        const gqlFetch = async (query, variables) => {
          const r = await fetch("https://graphql.anilist.co", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(6000),
          });
          if (!r.ok) return null;
          return r.json().catch(() => null);
        };

        const MEDIA_FIELDS = `
          id idMal format status episodes duration seasonYear countryOfOrigin genres bannerImage
          title { romaji english native }
          coverImage { extraLarge large color }
        `;

        // 1. Primary: ARM exact TMDB -> AniList mapping (dedicated anime-relations database, independent of TMDB API keys)
        try {
          const armRes = await fetch(`https://arm.haglund.dev/api/v2/themoviedb?id=${tmdbId}`, {
            headers: { Accept: "application/json", "User-Agent": UA },
            signal: AbortSignal.timeout(4500),
          });
          if (armRes.ok) {
            const arr = await armRes.json().catch(() => []);
            if (Array.isArray(arr) && arr.length > 0) {
              const movieHit = arr.find((x) => Number(x?.anilist) > 0 && String(x?.media || "").toUpperCase() === "MOVIE");
              const singleHit = arr.find((x) => Number(x?.anilist) > 0);
              anilistId = Number(movieHit?.anilist || singleHit?.anilist) || null;
            }
          }
        } catch {}

        if (anilistId) {
          const mediaData = await gqlFetch(
            `query ($id: Int!) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`,
            { id: anilistId },
          ).catch(() => null);
          const anime = mediaData?.data?.Media;
          if (anime && (anime.format === "MOVIE" || ((anime.episodes ?? 1) <= 2 && ["OVA", "SPECIAL", "ONA", "MOVIE"].includes(anime.format)))) {
            return { isAnimeMovie: true, anilistId: anime.id, malId: anime.idMal ?? null, anime };
          }
        }

        // 2. Secondary: If ARM missed it, inspect TMDB metadata & query AniList by title
        let tmdbTitle = qTitle;
        let tmdbYear = qYear;
        let origLang = qLang;
        let hasAnimGenre = false;

        const td = await tmdbFetch(`movie/${tmdbId}?language=en-US`, env).catch(() => null);
        if (td) {
          tmdbTitle = tmdbTitle || String(td.title || td.original_title || "").trim();
          tmdbYear = tmdbYear || parseInt(String(td.release_date || "").slice(0, 4), 10) || null;
          origLang = origLang || String(td.original_language || "").toLowerCase();
          const genres = Array.isArray(td.genres) ? td.genres : [];
          hasAnimGenre = genres.some((g) => g?.id === 16 || /animat/i.test(g?.name || ""));
        }

        const isAsianAnimLang = ["ja", "zh", "ko", "cn", "cmn", "yue", "jp"].includes(origLang);

        if (tmdbTitle && (hasAnimGenre || isAsianAnimLang || qLang)) {
          const searchData = await gqlFetch(
            `query ($search: String!) { Page(perPage: 10) { media(type: ANIME, format_in: [MOVIE, OVA, SPECIAL, ONA], search: $search, sort: [SEARCH_MATCH, POPULARITY_DESC], isAdult: false) { ${MEDIA_FIELDS} } } }`,
            { search: tmdbTitle },
          ).catch(() => null);
          const list = searchData?.data?.Page?.media;
          if (Array.isArray(list) && list.length > 0) {
            const norm = (s = "") => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
            const targetNorm = norm(tmdbTitle);
            let best = null;
            let bestScore = -1;
            for (const item of list) {
              const titles = [item.title?.english, item.title?.romaji, item.title?.native].filter(Boolean);
              const exact = titles.some((t) => norm(t) === targetNorm);
              const contains = titles.some((t) => {
                const nt = norm(t);
                return nt && targetNorm && (nt.includes(targetNorm) || targetNorm.includes(nt));
              });
              const yearDiff = tmdbYear && item.seasonYear ? Math.abs(tmdbYear - item.seasonYear) : 0;
              if (tmdbYear && item.seasonYear && yearDiff > 2) continue;
              const score = (exact ? 10 : contains ? 5 : 0) + (item.format === "MOVIE" ? 3 : 0) + (yearDiff === 0 ? 3 : 1);
              if (score > bestScore && (exact || contains)) {
                bestScore = score;
                best = item;
              }
            }
            if (best && (best.format === "MOVIE" || (best.episodes ?? 1) <= 2)) {
              return { isAnimeMovie: true, anilistId: best.id, malId: best.idMal ?? null, anime: best };
            }
          }
        }

        return { isAnimeMovie: false };
      });

      return json(result, 200, result?.isAnimeMovie ? 86400 : 60);
    } catch {
      return json({ isAnimeMovie: false }, 200, 30);
    }
  }

  // Background Server Detection & Verification for Movies and TV shows
  // /api/movies/detect-stream?id=27205&type=movie&s=1&e=1&title=Inception&year=2010...
  if (path === "/api/movies/detect-stream") {
    const tmdbId = parseInt(q("id", "0"), 10);
    const type = q("type", "movie").toLowerCase() === "tv" ? "tv" : "movie";
    const season = parseInt(q("s", q("season", "1")), 10) || 1;
    const episode = parseInt(q("e", q("episode", "1")), 10) || 1;
    const title = q("title");
    const year = q("year");
    const dubId = q("dub") || null;
    const imdbId = q("imdb");
    const sandboxed = q("sandboxed", "0") === "1" || q("sandboxed", "false") === "true";
    const skipDirect = q("skipDirect", "0") === "1" || q("skipDirect", "false") === "true";
    const skipMovieBox = q("skipMovieBox", "0") === "1" || q("skipMovieBox", "false") === "true";

    if (!tmdbId && !title) return json({ error: "Missing id or title" }, 400);

    const canUseCache = !skipDirect && !skipMovieBox && !dubId;
    const cacheKey = `detect:v10:${tmdbId}:${type}:${season}:${episode}:${sandboxed ? "sb" : "top"}`;
    const hit = canUseCache ? memo.get(cacheKey) : null;
    if (hit && Date.now() - hit.at < 5 * 60e3 && hit.v?.success === true) {
      return json(hit.v, 200, 300);
    }

    try {
      const midmanUrl = (
        env?.VITE_MOVIEBOX_PROXY_URL || 
        env?.MOVIEBOX_PROXY_URL || 
        (typeof process !== "undefined" ? (process.env?.VITE_MOVIEBOX_PROXY_URL || process.env?.MOVIEBOX_PROXY_URL) : "")
      )?.replace(/\/+$/, "");

      const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

      // Parallel resolution: probe MovieBox, Vidzee Direct, and Embed-to-Direct Extractors concurrently
      const mbPromise = (!skipMovieBox && (tmdbId || title))
        ? withTimeout(resolveMovieBoxStream({
            tmdbId,
            type,
            season,
            episode,
            title,
            year,
            dubId,
            proxyBase,
            midmanUrl,
            env,
          }).catch(() => null), 9000)
        : Promise.resolve(null);

      const vzPromise = (!skipDirect && tmdbId)
        ? withTimeout(resolveVidzeeDirect({ tmdbId, type, season, episode, lang: dubId, proxyBase }).catch(() => null), 7000)
        : Promise.resolve(null);

      const embDirectPromise = tmdbId
        ? withTimeout(resolveMovieEmbedStreams({ tmdbId, type, season, episode, lang: dubId, proxyBase }).catch(() => null), 7000)
        : Promise.resolve(null);

      // Background probes for third-party embed providers (CinemaOS is index 0; Vidzee is excluded because Vidzee is native direct only)
      const candidates = buildMovieEmbedCandidates({ type, tmdbId, season, episode, sandboxed })
        .filter((c) => c.id !== 'vidzee');

      const checkCandidate = async (c) => {
        try {
          if (!isTrustedMovieEmbedUrl(c.url)) return null;
          const res = await fetch(c.url, {
            headers: {
              "User-Agent": UA,
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Referer": c.id === "cinemaos" ? "https://cinemaos.tech/" : "https://google.com/"
            },
            redirect: "follow",
            signal: AbortSignal.timeout(c.id === "cinemaos" ? 8000 : 4500)
          });
          if (!res.ok) return null;
          const csp = (res.headers.get("content-security-policy") || "").toLowerCase();
          const fa = csp.match(/frame-ancestors\s+([^;]+)/)?.[1]?.trim() || "";
          if (fa) {
            if (fa === "'none'" || fa === "'self'") return null;
          } else if (c.id !== "cinemaos") {
            const xfo = (res.headers.get("x-frame-options") || "").toUpperCase();
            if (xfo.includes("DENY") || xfo.includes("SAMEORIGIN")) return null;
          }
          const text = await res.text();
          if (!isValidEmbedResponse(res.status, text)) return null;
          if (typeof c.validate === "function" && !c.validate(text)) return null;
          return {
            kind: "embed",
            providerId: c.id,
            label: c.label,
            url: c.url,
            tags: c.tags || []
          };
        } catch {
          return null;
        }
      };

      const embedPromise = Promise.all(candidates.slice(0, 6).map(checkCandidate)).catch(() => []);

      const [mbRes, vidzeeRes, embDirectRes, embedResultsRaw] = await Promise.all([
        mbPromise,
        vzPromise,
        embDirectPromise,
        embedPromise,
      ]);
      const workingEmbeds = (embedResultsRaw || []).filter(Boolean);
      const cinemaOsEmbed = workingEmbeds.find((b) => b.providerId === "cinemaos") || null;
      const otherEmbeds = workingEmbeds.filter((b) => b.providerId !== "cinemaos");

      const directEmbedSources =
        embDirectRes?.success && embDirectRes.source?.streams?.length
          ? [embDirectRes.source, ...(embDirectRes.backups || []).filter((b) => b?.streams?.length)]
          : [];

      const mbSourceObj = mbRes && mbRes.success && mbRes.streams?.length > 0
        ? {
            kind: "direct",
            providerId: "moviebox",
            label: "Server 2",
            streams: mbRes.streams,
            dubs: mbRes.dubs || [],
            subtitles: mbRes.subtitles || [],
            streamUrl: mbRes.streamUrl,
            altProxyUrl: mbRes.altProxyUrl,
            tags: ["Direct"]
          }
        : null;

      const vzSourceObj = vidzeeRes?.success && vidzeeRes.streams?.length > 0
        ? {
            kind: "direct",
            providerId: "vidzee",
            label: "Server 3",
            streams: vidzeeRes.streams,
            dubs: vidzeeRes.dubs || [],
            subtitles: vidzeeRes.subtitles || [],
            streamUrl: vidzeeRes.streamUrl,
            altProxyUrl: vidzeeRes.altProxyUrl,
            tags: ["Direct"]
          }
        : null;

      const mbHasHindi = Boolean(mbSourceObj && hasHindiAudio(mbSourceObj));
      const vzHasHindi = Boolean(vzSourceObj && hasHindiAudio(vzSourceObj));
      const useVidzee =
        Boolean(vzSourceObj) &&
        (!mbSourceObj || shouldUpgradeMovieBoxToVidzee(mbSourceObj.streams, vzSourceObj.streams, { mbHasHindi, vzHasHindi }));

      const orderedDirectBackups = useVidzee
        ? [...(vzSourceObj ? [vzSourceObj] : []), ...(mbSourceObj ? [mbSourceObj] : []), ...directEmbedSources]
        : [...(mbSourceObj ? [mbSourceObj] : []), ...(vzSourceObj ? [vzSourceObj] : []), ...directEmbedSources];

      // 1. Default priority: CinemaOS embed player (ad-blocked + blur-free) for movies & web series when no specific dub is requested
      if (!dubId && cinemaOsEmbed) {
        const payload = {
          success: true,
          source: cinemaOsEmbed,
          directBackups: orderedDirectBackups,
          backups: otherEmbeds,
        };
        if (canUseCache) memo.set(cacheKey, { v: payload, at: Date.now() });
        return json(payload, 200, 300);
      }

      if (useVidzee && vzSourceObj) {
        const directBackups = [
          ...(mbSourceObj ? [mbSourceObj] : []),
          ...directEmbedSources,
        ];
        const payload = {
          success: true,
          source: vzSourceObj,
          directBackups,
          backups: workingEmbeds
        };
        if (canUseCache && (cinemaOsEmbed || workingEmbeds.length > 0)) memo.set(cacheKey, { v: payload, at: Date.now() });
        return json(payload, 200, cinemaOsEmbed || workingEmbeds.length > 0 ? 300 : 0);
      }

      if (mbSourceObj) {
        const directBackups = [
          ...(vzSourceObj ? [vzSourceObj] : []),
          ...directEmbedSources,
        ];
        const payload = {
          success: true,
          source: mbSourceObj,
          directBackups,
          backups: workingEmbeds
        };
        if (canUseCache && (cinemaOsEmbed || workingEmbeds.length > 0)) memo.set(cacheKey, { v: payload, at: Date.now() });
        return json(payload, 200, cinemaOsEmbed || workingEmbeds.length > 0 ? 300 : 0);
      }

      // 3. Direct Embed-to-Direct extracted HLS/MP4 streams (plays natively inside CinePlayer!)
      if (directEmbedSources.length > 0) {
        const payload = {
          success: true,
          source: directEmbedSources[0],
          directBackups: directEmbedSources.slice(1),
          backups: workingEmbeds
        };
        if (canUseCache && (cinemaOsEmbed || workingEmbeds.length > 0)) memo.set(cacheKey, { v: payload, at: Date.now() });
        return json(payload, 200, cinemaOsEmbed || workingEmbeds.length > 0 ? 300 : 0);
      }

      if (workingEmbeds.length > 0) {
        const [firstEmbed, ...restEmbeds] = workingEmbeds;
        const payload = {
          success: true,
          source: firstEmbed,
          directBackups: [],
          backups: restEmbeds,
        };
        if (canUseCache) memo.set(cacheKey, { v: payload, at: Date.now() });
        return json(payload, 200, 300);
      }

      return json({ success: false, backups: workingEmbeds, error: "Playback is currently unavailable for this title." }, 200);
    } catch (err) {
      return json({ success: false, error: err.message || "Detection error" }, 200);
    }
  }

  // Server-side Embed-to-Direct stream resolver for Movies & TV shows
  // /api/movies/resolve-embed?id=71446&type=tv&s=1&e=1&lang=Hindi&exclude=moviebox,vidzee
  if (path === "/api/movies/resolve-embed") {
    const tmdbId = parseInt(q("id", "0"), 10);
    const type = q("type", "movie").toLowerCase() === "tv" ? "tv" : "movie";
    const season = parseInt(q("s", q("season", "1")), 10) || 1;
    const episode = parseInt(q("e", q("episode", "1")), 10) || 1;
    const lang = q("lang", q("dub", "")).replace(/^embed:/i, "").trim() || null;
    const rawUrl = q("url", "");
    const providerId = q("providerId", "");
    const excludeRaw = q("exclude", "");
    const excludeProviders = excludeRaw ? excludeRaw.split(",").map((x) => x.trim()).filter(Boolean) : [];

    if (!tmdbId) return json({ success: false, error: "Missing id" }, 400);

    try {
      const preferredExtractor = mapProviderHintToExtractor(providerId, rawUrl);
      const canCache = !preferredExtractor && excludeProviders.length === 0;
      const cacheKey = `embres:v1:${tmdbId}:${type}:${season}:${episode}:${(lang || "default").toLowerCase()}`;
      const res = canCache
        ? await cached(cacheKey, 5 * 60e3, () =>
            resolveMovieEmbedStreams({ tmdbId, type, season, episode, lang, proxyBase })
          )
        : await resolveMovieEmbedStreams({
            tmdbId,
            type,
            season,
            episode,
            lang,
            preferredExtractor,
            excludeProviders,
            proxyBase,
          });
      if (res && res.success && res.source?.streams?.length > 0) {
        return json(res, 200, canCache ? 300 : 0);
      }
      return json({ success: false, source: null, backups: [], subtitles: res?.subtitles || [], error: "No direct embed streams found" }, 200);
    } catch (err) {
      return json({ success: false, source: null, backups: [], subtitles: [], error: err?.message || "Embed stream resolution failed" }, 200);
    }
  }

  // Direct Vidzee stream endpoint for Movies & TV shows (supports language switching in CinePlayer)
  // /api/movies/vidzee-stream?id=550&type=movie&s=1&e=1&lang=Hindi
  if (path === "/api/movies/vidzee-stream") {
    const tmdbId = parseInt(q("id", "0"), 10);
    const type = q("type", "movie").toLowerCase() === "tv" ? "tv" : "movie";
    const season = parseInt(q("s", q("season", "1")), 10) || 1;
    const episode = parseInt(q("e", q("episode", "1")), 10) || 1;
    const lang = q("lang", q("dub", "")).replace(/^vidzee:/i, "").trim() || null;

    if (!tmdbId) return json({ error: "Missing id" }, 400);

    try {
      const cacheKey = `vz:${tmdbId}:${type}:${season}:${episode}:${(lang || "default").toLowerCase()}`;
      const res = await cached(cacheKey, 5 * 60e3, () =>
        resolveVidzeeDirect({ tmdbId, type, season, episode, lang, proxyBase })
      );
      if (res && res.success && res.streams?.length > 0) {
        return json(res, 200, 300);
      }
      return json({ success: false, streams: [], subtitles: [], error: "No Vidzee streams found" }, 200);
    } catch (err) {
      return json({ success: false, streams: [], subtitles: [], error: err?.message || "Vidzee stream resolution failed" }, 200);
    }
  }

  // Direct stream endpoint for Movies & TV shows via MovieBox:
  // /api/movies/stream?id=27205&type=movie&s=1&e=1&title=Inception&year=2010&dub=...
  if (path === "/api/movies/stream") {
    const tmdbId = parseInt(q("id", "0"), 10);
    const type = q("type", "movie").toLowerCase() === "tv" ? "tv" : "movie";
    const season = parseInt(q("s", q("season", "1")), 10) || 1;
    const episode = parseInt(q("e", q("episode", "1")), 10) || 1;
    const title = q("title");
    const year = q("year");
    const dubId = q("dub") || null;
    const imdbId = q("imdb");

    if (!tmdbId && !title) return json({ error: "Missing id or title" }, 400);

    const midmanUrl = (
      env?.VITE_MOVIEBOX_PROXY_URL || 
      env?.MOVIEBOX_PROXY_URL || 
      (typeof process !== "undefined" ? (process.env?.VITE_MOVIEBOX_PROXY_URL || process.env?.MOVIEBOX_PROXY_URL) : "")
    )?.replace(/\/+$/, "");

    try {
      const cacheKey = `mb:v3:${tmdbId}:${type}:${season}:${episode}:${dubId || "default"}`;
      const hit = memo.get(cacheKey);
      let res = null;
      let localErrMsg = "";

      if (hit && Date.now() - hit.at < 10 * 60e3 && hit.v?.success === true && hit.v?.streams?.length > 0) {
        res = hit.v;
      } else {
        let pending = movieBoxInflight.get(cacheKey);
        if (!pending) {
          pending = (async () => {
            let resolved = null;
            let errMsg = "";
            // Tier 1: Local edge MovieBox resolver (fast, direct, bounded)
            try {
              resolved = await resolveMovieBoxStream({ tmdbId, type, season, episode, title, year, dubId, proxyBase, midmanUrl, env });
            } catch (localErr) {
              errMsg = localErr.message || String(localErr);
              console.warn("[MovieBox] Local resolver error, falling back to midman:", localErr.message);
            }

            // Tier 2: Midman fallback if local returned no streams
            if ((!resolved || !resolved.success || !resolved.streams?.length) && midmanUrl && !q("no_midman")) {
              try {
                const extQs = new URLSearchParams({
                  id: String(tmdbId || 0),
                  type,
                  s: String(season),
                  e: String(episode),
                  ...(title ? { title } : {}),
                  ...(year ? { year } : {}),
                  ...(dubId ? { dub: dubId } : {}),
                  ...(imdbId ? { imdb: imdbId } : {})
                });
                const railwayStream = `${midmanUrl}/api/movies/stream?${extQs.toString()}`;
                const proxyStream = `${proxyBase}?url=${encodeURIComponent(railwayStream)}`;
                const extResp = await fetch(proxyStream, {
                  headers: { "Accept": "application/json" },
                  signal: AbortSignal.timeout(9000)
                }).catch(() => fetch(railwayStream, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(9000) }));
                if (extResp.ok) {
                  const extData = await extResp.json().catch(() => null);
                  if (extData && extData.success === true && extData.streams?.length > 0) {
                    const validStreams = extData.streams.filter((s) => !/ailok\.pe/.test(s.url || s.streamUrl || ''));
                    if (validStreams.length > 0) {
                      resolved = { ...extData, streams: validStreams };
                    }
                  }
                }
              } catch (extErr) {
                console.warn("[MovieBox] Midman service fetch error:", extErr.message);
              }
            }

            if (resolved && resolved.success === true && resolved.streams?.length > 0) {
              memo.set(cacheKey, { at: Date.now(), v: resolved });
            }
            return { res: resolved, localErrMsg: errMsg };
          })().finally(() => {
            movieBoxInflight.delete(cacheKey);
          });
          movieBoxInflight.set(cacheKey, pending);
        }
        const settled = await pending;
        res = settled?.res || null;
        localErrMsg = settled?.localErrMsg || "";
      }

      if (!res || !res.success) {
        res = {
          success: false,
          error: res?.error || localErrMsg || `No streams found for ${title || tmdbId}`,
          server: "MovieBox",
          streams: []
        };
      }

      // Bounded subtitles lookup (never block playback delivery if OpenSubtitles is sluggish)
      let subtitles = [];
      const resolveSubtitlesFast = async () => {
        let effectiveImdb = imdbId;
        if (!effectiveImdb && tmdbId) {
          try {
            const d = await cached(`tmdb_ext:${type}:${tmdbId}`, 24 * 3600e3, () =>
              tmdbFetch(`${type}/${tmdbId}?append_to_response=external_ids`, env)
            );
            effectiveImdb = d?.external_ids?.imdb_id || d?.imdb_id;
          } catch {}
        }
        if (!effectiveImdb) return [];
        const osUrl = type === "movie" ? `${OPENSUBS}/movie/${effectiveImdb}.json` : `${OPENSUBS}/series/${effectiveImdb}:${season}:${episode}.json`;
        const osData = await cached(`os_${effectiveImdb}_${season}_${episode}`, 24 * 3600e3, () =>
          getJson(osUrl, { signal: AbortSignal.timeout(2200) }).catch(() => null)
        );
        const count = {};
        return (osData?.subtitles || []).slice(0, 50).map((s, i) => {
          const language = LANGS[s.lang] || (s.lang ? s.lang[0].toUpperCase() + s.lang.slice(1) : "English");
          count[language] = (count[language] || 0) + 1;
          return {
            id: s.id || `os_${i}`,
            label: count[language] > 1 ? `${language} #${count[language]}` : language,
            language,
            lang: s.lang,
            url: s.url,
            source: "OpenSubtitles",
          };
        });
      };
      if (res.success && (imdbId || tmdbId)) {
        subtitles = await Promise.race([
          resolveSubtitlesFast().catch(() => []),
          new Promise((resolve) => setTimeout(() => resolve([]), 2200)),
        ]);
      }

      return json({
        ...res,
        subtitles,
      }, 200, res.success ? 300 : 0);
    } catch (e) {
      return json({ success: false, error: e.message || "MovieBox stream resolution failed" }, 200);
    }
  }

  // Movies / TV catalogue: whitelisted read-only passthrough to the TMDB proxy, e.g. /api/movies/trending/movie/week
  if (path.startsWith("/api/movies/") || (path.startsWith("/api/tmdb/") && path !== "/api/tmdb/episodes")) {
    let sub = path.startsWith("/api/movies/") ? path.slice("/api/movies/".length).replace(/\/+$/, "") : path.slice("/api/tmdb/".length).replace(/\/+$/, "");
    if (sub.startsWith("proxy/")) sub = sub.slice("proxy/".length);
    const ok = /^(trending\/(all|movie|tv)\/(day|week)|(movie|tv)\/(popular|top_rated|now_playing|upcoming|airing_today|on_the_air)|discover\/(movie|tv)|search\/(movie|tv|multi)|(movie|tv)\/\d+(\/(credits|images|videos|similar|recommendations|external_ids|alternative_titles|release_dates|content_ratings|season\/\d+(\/episode\/\d+)?))?|tv\/\d+\/(episode_groups|season\/\d+(\/episode\/\d+)?)|tv\/episode_group\/[a-zA-Z0-9_-]+|genre\/(movie|tv)\/list|person\/\d+)$/.test(sub);
    if (!ok) return json({ error: "Unsupported path" }, 400);
    const qs = new URLSearchParams(url.searchParams);
    if (!qs.has("language")) qs.set("language", "en-US");
    qs.set("include_adult", "false");
    qs.sort();
    try {
      const d = await cached(`movies:${sub}?${qs}`, 10 * 60e3, () => tmdbFetch(`${sub}?${qs}`, env));
      return json(d, 200, 600);
    } catch {
      return json({ error: "TMDB is unavailable right now" }, 502);
    }
  }

  if (path === "/api/episodes/titles") {
    const anilistId = Math.max(0, parseInt(q("anilistId", "0"), 10) || 0);
    const malIdParam = Math.max(0, parseInt(q("malId", "0"), 10) || 0);
    const epHint = Math.max(0, parseInt(q("ep", "0"), 10) || 0);
    if (!anilistId && !malIdParam) return json({ ok: false, titles: {} }, 400, 0);

    const isGeneric = (name, epNum) => {
      if (typeof name !== "string") return true;
      const s = name.trim();
      if (!s) return true;
      if (/^(?:tba|tbd|to be announced|untitled|coming soon|no title)$/i.test(s)) return true;
      if (/^(?:episode|ep\.?|e|#)?\s*0*\d+\s*$/i.test(s)) return true;
      if (/^(?:episode|ep\.?)\s*0*\d+\s*[-:–.]\s*(?:episode|ep\.?)?\s*0*\d*\s*$/i.test(s)) return true;
      if (/^第\s*0*\d+\s*[話话集回]\s*$/.test(s)) return true;
      if (epNum > 0 && new RegExp(`^(?:episode|ep\\.?|e|#)?\\s*0*${epNum}\\s*$`, "i").test(s)) return true;
      return false;
    };
    const pickClean = (candidates, epNum) => {
      for (const c of candidates) {
        if (typeof c !== "string") continue;
        const t = c.trim();
        if (t && !isGeneric(t, epNum)) return t;
      }
      return null;
    };

    const jikanPage = epHint > 100 ? Math.ceil(epHint / 100) : 1;
    const cacheKey = `ep-titles:v1:${anilistId}:${malIdParam}:${jikanPage}`;
    const hit = memo.get(cacheKey);
    if (hit && Date.now() - hit.at < 10 * 60e3) {
      return json({ ok: true, titles: hit.v }, 200, Object.keys(hit.v).length ? 300 : 60);
    }

    const titles = {};
    let resolvedMalId = malIdParam;

    const aniZipData = anilistId
      ? await fetch(`https://api.ani.zip/mappings?anilist_id=${anilistId}`, {
          headers: { Accept: "application/json", "User-Agent": UA },
          signal: AbortSignal.timeout(4500),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      : null;

    if (!resolvedMalId && Number(aniZipData?.mappings?.mal_id) > 0) {
      resolvedMalId = Number(aniZipData.mappings.mal_id);
    }

    const jikanData = resolvedMalId
      ? await fetch(`https://api.jikan.moe/v4/anime/${resolvedMalId}/episodes?page=${jikanPage}`, {
          headers: { Accept: "application/json", "User-Agent": UA },
          signal: AbortSignal.timeout(4500),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      : null;

    const jikanMap = new Map();
    if (Array.isArray(jikanData?.data)) {
      for (const item of jikanData.data) {
        const n = Number(item?.mal_id);
        if (!Number.isFinite(n) || n <= 0) continue;
        jikanMap.set(n, item);
      }
    }

    const aniEpisodes = aniZipData?.episodes && typeof aniZipData.episodes === "object" ? aniZipData.episodes : {};
    const allEpNums = new Set([
      ...Object.keys(aniEpisodes).map((k) => Number(k)).filter((n) => Number.isFinite(n) && n > 0),
      ...jikanMap.keys(),
    ]);

    for (const n of allEpNums) {
      const az = aniEpisodes[String(n)]?.title || {};
      const jk = jikanMap.get(n) || {};
      // Prefer English title first (ani.zip en / Jikan English), then Romanized (Jikan / ani.zip x-jat), then Japanese
      const best = pickClean([az.en, jk.title, jk.title_romanji, az["x-jat"], az.ja], n);
      if (best) titles[n] = best;
    }

    memo.set(cacheKey, { at: Date.now(), v: titles });
    return json({ ok: true, titles }, 200, Object.keys(titles).length ? 300 : 60);
  }

  if (path === "/api/tmdb/episodes") {
    const id = parseInt(q("id", "0"), 10);
    const requestedSeason = parseInt(q("season", "1"), 10) || 1;
    const startParam = q("start").trim();
    const epCount = parseInt(q("epCount", "0"), 10) || 0;
    if (!id) return json({ error: "Missing id" }, 400);

    const DAY_MS = 86400e3;
    const parseIsoMs = (s) => {
      if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
      const ms = Date.parse(s.slice(0, 10) + "T00:00:00Z");
      return Number.isFinite(ms) ? ms : null;
    };
    const isGenericEpTitle = (name, epNum) => {
      if (typeof name !== "string") return true;
      const s = name.trim();
      if (!s) return true;
      if (/^(?:tba|tbd|to be announced|untitled|coming soon|no title)$/i.test(s)) return true;
      if (/^(?:episode|ep\.?|e|#)?\s*0*\d+\s*$/i.test(s)) return true;
      if (/^(?:episode|ep\.?)\s*0*\d+\s*[-:–.]\s*(?:episode|ep\.?)?\s*0*\d*\s*$/i.test(s)) return true;
      if (/^第\s*0*\d+\s*[話话集回]\s*$/.test(s)) return true;
      if (epNum > 0 && new RegExp(`^(?:episode|ep\\.?|e|#)?\\s*0*${epNum}\\s*$`, "i").test(s)) return true;
      return false;
    };
    const sanitizeEpTitle = (name, epNum) => {
      if (typeof name !== "string") return null;
      const s = name.trim();
      return isGenericEpTitle(s, epNum) ? null : s;
    };
    const shouldRefreshSoon = (eps) => {
      if (!Array.isArray(eps) || !eps.length) return true;
      const now = Date.now();
      return eps.some((e) => {
        if (!e.name || isGenericEpTitle(e.name, e.n)) return true;
        const ms = parseIsoMs(e.air);
        return ms !== null && ms >= now - 14 * DAY_MS && ms <= now + 14 * DAY_MS;
      });
    };
    const httpTtlFor = (eps) => (!eps?.length ? 0 : shouldRefreshSoon(eps) ? 300 : 86400);
    const cachedTmdbSeason = async (sNum) => {
      const key = `tmdb-eps:${id}:${sNum}`;
      const hit = memo.get(key);
      if (hit) {
        const mapped = (hit.v?.episodes || []).map((e) => ({
          n: Number(e.episode_number),
          name: sanitizeEpTitle(e.name, Number(e.episode_number)),
          air: e.air_date || null,
        }));
        const maxAge = shouldRefreshSoon(mapped) ? 10 * 60e3 : 24 * 3600e3;
        if (Date.now() - hit.at < maxAge) return hit.v;
      }
      return cached(key, 10 * 60e3, async () => {
        const res = await tmdbFetch(`tv/${id}/season/${sNum}?language=en-US`, env);
        return res?.episodes?.length ? res : null;
      });
    };

    const startMs = parseIsoMs(startParam);

    // Pick the right TMDB season using show seasons metadata + AniList startDate
    let targetSeason = requestedSeason;
    let tmdbSeasons = [];
    try {
      const showMeta = await cached(`tmdb-show:${id}`, 2 * 3600e3, () => tmdbFetch(`tv/${id}?language=en-US`, env));
      tmdbSeasons = (showMeta?.seasons || []).filter((s) => Number(s.season_number) >= 1 && (s.episode_count ?? 1) > 0);
      if (tmdbSeasons.length > 0) {
        const hasRequested = tmdbSeasons.some((s) => Number(s.season_number) === requestedSeason);
        if (startMs) {
          // 1. Exact season window match: season air_date within [-35d, +45d] of AniList startDate
          let best = null;
          let bestDiff = Infinity;
          for (const s of tmdbSeasons) {
            const sMs = parseIsoMs(s.air_date);
            if (sMs === null) continue;
            const diff = Math.abs(sMs - startMs);
            if (sMs >= startMs - 35 * DAY_MS && sMs <= startMs + 45 * DAY_MS && diff < bestDiff) {
              best = s;
              bestDiff = diff;
            }
          }
          // 2. Otherwise (e.g. TMDB merges S1+S2 into Season 1, or Part 2 shares TMDB Season 2):
          //    pick the latest TMDB season that started on/before AniList startDate (+45d)
          if (!best) {
            const eligible = tmdbSeasons
              .map((s) => ({ s, ms: parseIsoMs(s.air_date) }))
              .filter((x) => x.ms !== null && x.ms <= startMs + 45 * DAY_MS)
              .sort((a, b) => a.ms - b.ms);
            if (eligible.length > 0) best = eligible[eligible.length - 1].s;
          }
          if (best) targetSeason = Number(best.season_number);
          else if (!hasRequested) targetSeason = Number(tmdbSeasons[tmdbSeasons.length - 1].season_number);
        } else if (!hasRequested) {
          // Requested season doesn't exist on TMDB (e.g. season 2 when TMDB merges all into season 1):
          // without startDate we cannot safely slice Season 1 -> avoid returning Season 1 ep 1 as Season 2
          return json({ success: false, episodes: [] }, 200, 0);
        }
      }
    } catch {
      /* proceed with requestedSeason */
    }

    const alignByStartDate = (episodes) => {
      if (!episodes.length) return episodes;
      if (!startMs) return episodes;

      // Find first episode whose air date is at or near this season's startDate (-35d tolerance)
      const threshold = startMs - 35 * DAY_MS;
      const firstDated = episodes.find((e) => parseIsoMs(e.air) !== null);
      if (!firstDated) return episodes;

      const firstMs = parseIsoMs(firstDated.air);
      // If TMDB episodes already start around/after this season's premiere, keep from episode 1
      if (firstMs >= threshold) {
        return epCount > 0 && episodes.length > epCount ? episodes.slice(0, epCount) : episodes;
      }

      // Continuous TMDB season (or split-cour): find where this sequel starts
      const idx = episodes.findIndex((e) => {
        const ms = parseIsoMs(e.air);
        return ms !== null && ms >= threshold;
      });
      if (idx === -1) {
        // Every TMDB episode aired > 35 days BEFORE this sequel started (e.g., TMDB hasn't added S2/S3 yet):
        // Never leak Season 1 episode names & thumbnails onto Season 2/3.
        return [];
      }
      const sliced = epCount > 0 ? episodes.slice(idx, idx + epCount) : episodes.slice(idx);
      return sliced.map((e, i) => ({ ...e, n: i + 1, name: sanitizeEpTitle(e.name, i + 1) }));
    };

    tmdbSeasons = [...tmdbSeasons].sort((a, b) => Number(a.season_number) - Number(b.season_number));
    const s1Count = Number(tmdbSeasons.find((s) => Number(s.season_number) === 1)?.episode_count || 0);
    const totalSeasonEps = tmdbSeasons.reduce((sum, s) => sum + (Number(s.episode_count) || 0), 0);

    // Only consult absolute episode_groups when Season 1 alone doesn't already cover the show
    if (targetSeason === 1 && (epCount <= 0 ? tmdbSeasons.length > 1 : s1Count < epCount)) {
      try {
        const eg = await cached(`tmdb-eg:${id}`, 2 * 3600e3, () => tmdbFetch(`tv/${id}/episode_groups`, env));
        const groups = eg?.results || [];
        const isUnwantedGroup = (g) =>
          /\b(recut|kai|yaba[iï]?|edited|no\s*filler|filler\s*free|china\s*online)\b/i.test(g?.name || "");
        const usable = groups.filter((g) => !isUnwantedGroup(g));
        const best =
          usable.find((g) => g.type === 2 && /no specials/i.test(g.name)) ||
          usable.find((g) => g.type === 2 && /absolute/i.test(g.name)) ||
          usable.find((g) => g.type === 2) ||
          usable.find((g) => /absolute|correct order/i.test(g.name));

        if (best) {
          const d = await cached(`tmdb-eps-grp:${best.id}`, 2 * 3600e3, () => tmdbFetch(`tv/episode_group/${best.id}?language=en-US`, env));
          const pool = (d.groups || []).filter((g) => !/special/i.test(g.name || "") && g.order !== 0);
          const list = pool.length ? pool : d.groups || [];
          let chosen = [];
          if (list.length === 1) {
            chosen = list[0].episodes || [];
          } else if (list.length > 1) {
            const sorted = [...list].sort((a, b) => (b.episodes?.length || 0) - (a.episodes?.length || 0));
            const largest = sorted[0];
            const second = sorted[1];
            if (largest && (!second || (largest.episodes?.length || 0) > (second.episodes?.length || 0) * 2)) {
              chosen = largest.episodes || [];
            } else {
              const inOrder = [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
              chosen = inOrder.flatMap((g) => g.episodes || []);
            }
          }
          const meetsEpCount = epCount > 0 ? chosen.length >= Math.floor(epCount * 0.92) : chosen.length >= Math.floor(totalSeasonEps * 0.9);
          const beatsS1 = chosen.length >= Math.floor(s1Count * 0.95);
          if (chosen.length > 0 && meetsEpCount && beatsS1) {
            const raw = chosen.map((e, idx) => {
              const n = typeof e.order === "number" && e.order >= 0 ? e.order + 1 : idx + 1;
              return { n, name: sanitizeEpTitle(e.name, n), overview: e.overview || null, still: e.still_path || null, runtime: e.runtime || null, air: e.air_date || null };
            });
            const aligned = alignByStartDate(raw);
            return json({ success: aligned.length > 0, episodes: aligned }, 200, httpTtlFor(aligned));
          }
        }
      } catch {
        /* fallback to season fetching */
      }
    }

    try {
      const mapSeasonEps = (d) =>
        (d?.episodes || [])
          .filter((e) => Number(e.episode_number) > 0)
          .map((e) => {
            const n = Number(e.episode_number);
            return {
              n,
              name: sanitizeEpTitle(e.name, n),
              overview: e.overview || null,
              still: e.still_path || null,
              runtime: e.runtime || null,
              air: e.air_date || null,
            };
          });

      const d = await cachedTmdbSeason(targetSeason);
      const aligned = alignByStartDate(mapSeasonEps(d));

      // Long-running continuous series (Naruto 220, Shippuden 500, One Piece 1100+, Bleach 366, DBZ 291, etc.)
      // are one AniList entry split across multiple TMDB seasons -> fetch subsequent seasons in batches.
      if (aligned.length > 0 && epCount > aligned.length + 2) {
        const nextSeasons = tmdbSeasons.filter((s) => Number(s.season_number) > targetSeason);
        if (nextSeasons.length > 0) {
          const combined = [...aligned];
          let hadFailure = false;
          for (let i = 0; i < nextSeasons.length && combined.length < epCount; i += 8) {
            const batch = nextSeasons.slice(i, i + 8);
            const pages = await Promise.all(
              batch.map(async (s) => {
                const sNum = Number(s.season_number);
                try {
                  const sd = await cachedTmdbSeason(sNum);
                  return mapSeasonEps(sd);
                } catch {
                  // Retry once before marking failure so large series don't silently drop a season
                  try {
                    const sd = await tmdbFetch(`tv/${id}/season/${sNum}?language=en-US`, env);
                    if (sd?.episodes?.length) memo.set(`tmdb-eps:${id}:${sNum}`, { at: Date.now(), v: sd });
                    return mapSeasonEps(sd);
                  } catch {
                    hadFailure = true;
                    return [];
                  }
                }
              }),
            );
            for (const rows of pages) combined.push(...rows);
          }
          const finalList = combined.slice(0, epCount).map((e, idx) => ({ ...e, n: idx + 1, name: sanitizeEpTitle(e.name, idx + 1) }));
          return json({ success: finalList.length > 0, episodes: finalList }, 200, hadFailure ? 60 : httpTtlFor(finalList));
        }
      }

      return json({ success: aligned.length > 0, episodes: aligned }, 200, httpTtlFor(aligned));
    } catch {
      return json({ success: false, episodes: [] }, 200, 0); // client falls back to AniList
    }
  }

  if (path === "/api/filler") {
    // ponytail: AnimeFillerList has no API, so read its public show page (cached a day; it asks for a 10s crawl delay)
    // and guess the slug from the titles. Try all exact/full slugs before stripped-subtitle fallbacks so
    // "NARUTO: Shippuuden" + "Naruto: Shippuden" tries "naruto-shippuden" (500 eps) instead of stopping at "naruto" (220 eps).
    const titles = url.searchParams.getAll("t").filter(Boolean);
    const epRaw = Number(url.searchParams.get("ep"));
    const expectedEp = Number.isFinite(epRaw) && epRaw > 0 ? epRaw : 0;
    const slugs = [
      ...new Set([
        ...titles.flatMap(slugVariantsExact),
        ...titles.flatMap(slugVariantsLoose),
      ].filter(Boolean)),
    ].slice(0, 14);
    let fallback = null;
    for (const s of slugs) {
      const d = await fillerOf(s);
      if (!d.max) continue;
      if (!expectedEp || Math.abs(d.max - expectedEp) <= 2) {
        return json({ success: true, ...d }, 200, 86400);
      }
      if (!fallback) fallback = d;
    }
    if (fallback) return json({ success: true, ...fallback }, 200, 86400);
    return json({ success: false }, 200, 3600);
  }

  if (path.startsWith("/api/mal/anime/")) {
    const rawId = path.replace("/api/mal/anime/", "").replace(/\/.*$/, "").trim();
    const malId = parseInt(rawId, 10);
    if (!malId || isNaN(malId)) {
      return json({ error: "Invalid MAL ID" }, 400);
    }

    try {
      const data = await cached(`mal:anime:${malId}`, 2 * 3600e3, async () => {
        const r = await fetch(`https://myanimelist.net/anime/${malId}`, {
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(6000),
        });
        if (!r.ok) throw new Error(`MAL status ${r.status}`);
        const html = await r.text();

        const scoreM = html.match(/score-label[^>]*>([0-9]+(?:\.[0-9]+)?)</);
        const rankM = html.match(/Ranked\s*<strong>#?([0-9]+)/i);
        const popM = html.match(/Popularity\s*<strong>#?([0-9]+)/i);
        const memM = html.match(/Members\s*<strong>([0-9,]+)/i);
        const scoredByM =
          html.match(/by\s*<span[^>]*itemprop="ratingCount"[^>]*>([0-9,]+)<\/span>/i) ||
          html.match(/itemprop="ratingCount">([0-9,]+)</i);
        const favM = html.match(/Favorites:\s*<\/span>\s*([0-9,]+)/i);
        const ratingM = html.match(/Rating:\s*<\/span>\s*([^<\n]+)/i);
        const synM = html.match(/itemprop="description">([\s\S]*?)<\/(?:p|span)>/i);

        const decodeHtml = (s = "") =>
          s
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#039;|&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        return {
          mal_id: malId,
          score: scoreM ? parseFloat(scoreM[1]) : null,
          scored_by: scoredByM ? parseInt(scoredByM[1].replace(/,/g, ""), 10) : null,
          rank: rankM ? parseInt(rankM[1], 10) : null,
          popularity: popM ? parseInt(popM[1], 10) : null,
          members: memM ? parseInt(memM[1].replace(/,/g, ""), 10) : null,
          favorites: favM ? parseInt(favM[1].replace(/,/g, ""), 10) : null,
          rating: ratingM ? decodeHtml(ratingM[1]) : null,
          synopsis: synM ? decodeHtml(synM[1]) : null,
          background: null,
          broadcast: null,
          producers: [],
          licensors: [],
          themes: [],
          demographics: [],
          theme: { openings: [], endings: [] },
          streaming: [],
        };
      });

      return json({ success: true, data }, 200, 3600);
    } catch (err) {
      return json({ success: false, error: err?.message || "Failed to fetch MAL data" }, 502);
    }
  }

  if (path === "/api/mal/top") {
    const limit = Math.min(Math.max(parseInt(q("limit", "18"), 10) || 18, 1), 50);
    const decodeHtml = (s = "") =>
      s
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();

    try {
      const data = await cached(`mal:top:${limit}`, 30 * 60e3, async () => {
        // 1. Live MyAnimeList top ranking page (fast & official, works even when Jikan API is down)
        try {
          const r = await fetch("https://myanimelist.net/topanime.php", {
            headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
            signal: AbortSignal.timeout(5000),
          });
          if (r.ok) {
            const html = await r.text();
            const chunks = html.split('<tr class="ranking-list">').slice(1);
            const list = [];
            for (const row of chunks) {
              if (list.length >= limit) break;
              const linkM = row.match(/class="hoverinfo_trigger[^"]*"[^>]*href="https:\/\/myanimelist\.net\/anime\/(\d+)\/[^"]*"[^>]*>([^<]+)<\/a>/)
                || row.match(/href="https:\/\/myanimelist\.net\/anime\/(\d+)\/[^"]*"[^>]*class="hoverinfo_trigger"[^>]*>([^<]+)<\/a>/);
              if (!linkM) continue;
              const mal_id = Number(linkM[1]);
              const title = decodeHtml(linkM[2]);
              const imgM = row.match(/data-src="([^"]+)"/) || row.match(/src="(https:\/\/cdn\.myanimelist\.net[^"]+)"/);
              let imageUrl = imgM ? imgM[1] : null;
              if (imageUrl) {
                imageUrl = imageUrl
                  .replace(/\/r\/\d+x\d+\//, "/")
                  .replace(/\?s=[a-f0-9]+$/i, "")
                  .replace(/\.(\w+)$/, "l.$1");
              }
              const infoM = row.match(/<div class="information[^"]*">([\s\S]*?)<\/div>/);
              const infoText = infoM ? infoM[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
              const typeM = infoText.match(/^(TV|Movie|OVA|ONA|Special|Music|TV Special)/i);
              const epM = infoText.match(/\((\d+)\s*eps?\)/i);
              const yearM = infoText.match(/\b(19\d{2}|20\d{2})\b/);
              const scoreM = row.match(/score-label[^>]*>([0-9]+(?:\.[0-9]+)?)</);
              list.push({
                mal_id,
                url: `https://myanimelist.net/anime/${mal_id}`,
                title,
                title_english: null,
                title_japanese: null,
                score: scoreM ? parseFloat(scoreM[1]) : null,
                type: typeM ? typeM[1] : null,
                episodes: epM ? parseInt(epM[1], 10) : null,
                year: yearM ? parseInt(yearM[1], 10) : null,
                genres: [],
                images: {
                  jpg: { large_image_url: imageUrl, image_url: imageUrl },
                  webp: { large_image_url: imageUrl, image_url: imageUrl },
                },
              });
            }
            if (list.length > 0) return list;
          }
        } catch {}

        // 2. Fallback: AniList top scored anime mapped by MAL ID
        try {
          const gqlRes = await fetch("https://graphql.anilist.co", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              query: `query($perPage:Int){Page(page:1,perPage:$perPage){media(type:ANIME,sort:SCORE_DESC,isAdult:false){idMal title{english romaji native} averageScore format episodes seasonYear genres coverImage{extraLarge large}}}}`,
              variables: { perPage: limit + 6 },
            }),
            signal: AbortSignal.timeout(5000),
          });
          if (gqlRes.ok) {
            const payload = await gqlRes.json();
            const media = (payload?.data?.Page?.media || []).filter((m) => m.idMal).slice(0, limit);
            if (media.length > 0) {
              return media.map((m) => {
                const img = m.coverImage?.extraLarge || m.coverImage?.large || null;
                return {
                  mal_id: m.idMal,
                  url: `https://myanimelist.net/anime/${m.idMal}`,
                  title: m.title?.romaji || m.title?.english || "Untitled",
                  title_english: m.title?.english || null,
                  title_japanese: m.title?.native || null,
                  score: m.averageScore ? Number((m.averageScore / 10).toFixed(2)) : null,
                  type: m.format || null,
                  episodes: m.episodes ?? null,
                  year: m.seasonYear ?? null,
                  genres: (m.genres || []).map((name) => ({ name })),
                  images: {
                    jpg: { large_image_url: img, image_url: img },
                    webp: { large_image_url: img, image_url: img },
                  },
                };
              });
            }
          }
        } catch {}

        return null;
      });

      if (data && data.length > 0) return json({ success: true, data }, 200, 1800);
      return json({ success: false, data: [] }, 502);
    } catch (e) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  if (path === "/api/embed/animesalt") {
    const anilistId = parseInt(q("id", "0"), 10);
    const format = q("format").toUpperCase();
    const epNum = parseInt(q("ep", "1"), 10) || 1;
    const srvParam = q("server", "1");
    const audioParam = q("audio", "multi");
    const titleParam = q("title");
    const isMovie = q("isMovie") === "true" || format === "MOVIE";
    try {
      const r = await cached(
        `salt:v2:${anilistId}:${epNum}:${isMovie}:${srvParam}:${audioParam}:${titleParam}`,
        20 * 60e3,
        () =>
          extractAnimeSaltPlayer({
            anilistId,
            episode: epNum,
            title: titleParam,
            isMovie,
            audio: audioParam,
            server: srvParam,
          })
      );
      const two = ["2", "abyss"].includes(srvParam.toLowerCase());
      const embedUrl = r.success ? (two ? r.abyssUrl || r.embedUrl || r.myStreamUrl : r.myStreamUrl || r.embedUrl || r.abyssUrl) : null;
      const directStreamUrl = r.success ? r.directStreamUrl || null : null;
      const directReferer = r.success ? r.directReferer || embedUrl || r.pageUrl || "https://ravok.buzz/" : null;
      const subtitles = (r.subtitles || []).map((s) => ({
        ...s,
        file:
          s.file && !s.file.startsWith("/proxy")
            ? `${proxyBase}?url=${encodeURIComponent(s.file)}&referer=${encodeURIComponent(directReferer || "https://ravok.buzz/")}`
            : s.file,
      }));
      return r.success && (directStreamUrl || embedUrl)
        ? json(
            {
              success: true,
              embedUrl: embedUrl || null,
              server: r.server,
              slug: r.slug,
              pageUrl: r.pageUrl || null,
              myStreamUrl: r.myStreamUrl || null,
              abyssUrl: r.abyssUrl || null,
              directStreamUrl,
              directReferer,
              subtitles,
              allIframes: r.allIframes || [],
            },
            200,
            1800
          )
        : json({ success: false, error: r.error || "Not found on AnimeSalt" }, 404);
    } catch (e) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  if (path === "/api/embed/reanime") {
    const anilistId = parseInt(q("id", "0"), 10);
    const episode = parseInt(q("ep", "1"), 10) || 1;
    const audio = q("audio", "sub").toLowerCase();
    try {
      const embedUrl = await cached(`embed:reanime:${anilistId}:${episode}:${audio}`, 30 * 60e3, () =>
        resolveReanimeEmbed({ anilistId, episode, audio })
      );
      if (embedUrl) {
        if (q("format") === "json" || request.headers.get("accept")?.includes("application/json")) {
          return json({ success: true, embedUrl }, 200, 1800);
        }
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${embedUrl}"><script>location.replace(${JSON.stringify(embedUrl)})</script></head><body>Redirecting to <a href="${embedUrl}">ReAnime player</a>...</body></html>`,
          {
            status: 302,
            headers: {
              ...CORS,
              Location: embedUrl,
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "public, max-age=1800",
            },
          }
        );
      }
      return json({ success: false, error: "No ReAnime embed found for this episode" }, 404);
    } catch (e) {
      return json({ success: false, error: e.message }, 500);
    }
  }



  /* ---------- Novels (NovelFire / NovelFull / WebNovel) ---------- */
  if (path.startsWith("/api/novel/")) {
    const source = q("source", "novelfire");
    const engine = novelEngine.getSource(source);
    const page = parseInt(q("page", "1"), 10) || 1;
    const slug = q("slug");
    try {
      switch (path) {
        case "/api/novel/home":
          return json(await cached(`nhome:${source}:${page}`, 15 * 60e3, () => engine.getHome(page)), 200, 900);
        case "/api/novel/search": {
          const term = q("q").trim();
          if (!term) return json({ results: [] });
          return json({ results: await cached(`nsearch:${source}:${term}:${page}`, 10 * 60e3, () => engine.search(term, page)) }, 200, 600);
        }
        case "/api/novel/detail":
          if (!slug) return json({ error: "Missing novel slug" }, 400);
          return json({ detail: await cached(`ndetail:${source}:${slug}`, 3600e3, () => engine.getDetail(slug)) }, 200, 3600);
        case "/api/novel/chapters":
          if (!slug) return json({ error: "Missing novel slug" }, 400);
          return json(await cached(`nch:${source}:${slug}`, 3600e3, () => engine.getChapters(slug, page)), 200, 3600);
        case "/api/novel/read": {
          const novelSlug = q("novelSlug") || slug;
          const chapterSlug = q("chapterSlug") || q("ch") || "chapter-1";
          if (!novelSlug) return json({ error: "Missing novel slug" }, 400);
          const c = await cached(`nread:${source}:${novelSlug}:${chapterSlug}`, 2 * 3600e3, async () => {
            const r = await engine.getChapterContent(novelSlug, chapterSlug);
            return r.paragraphs?.length ? r : null; // never memoise failures
          });
          return c ? json(c, 200, 7200) : json({ ...(await engine.getChapterContent(novelSlug, chapterSlug)) }, 200);
        }
      }
    } catch (e) {
      return json({ error: "Novel source unavailable: " + e.message }, 502);
    }
    return json({ error: "Unknown novel route" }, 404);
  }

  /* ---------- Manga (five servers; see manga.js) ---------- */
  if (path.startsWith("/api/manga/")) {
    const source = manga.parseSource(q("source"));
    const lang = q("lang").trim().toLowerCase();
    try {
      if (path === "/api/manga/sources") return json({ sources: manga.SOURCES, default: manga.DEFAULT_SOURCE }, 200, 3600);
      if (path === "/api/manga/home") return json(await cached(`mhome:${source}:${lang}`, 15 * 60e3, () => manga.getHome(source, { lang })), 200, 900);
      if (path === "/api/manga/search") {
        const term = q("q").trim();
        return term ? json(await cached(`msearch:${source}:${lang}:${term}`, 10 * 60e3, () => manga.search(term, source, { lang })), 200, 600) : json({ results: [] });
      }
      if (path === "/api/manga/chapters") {
        const id = q("id");
        if (!id) return json({ error: "Missing manga id" }, 400);
        return json(await cached(`mch:${source}:${id}`, 30 * 60e3, () => manga.getChapters(id, source)), 200, 1800);
      }
      if (path === "/api/manga/pages") {
        const chapterId = q("chapterId") || q("id");
        if (!chapterId) return json({ error: "Missing chapterId" }, 400);
        const ttl = source === "mangadex" ? 600 : 3600; // MangaDex image hosts rotate, keep those short
        const r = await cached(`mpg:${source}:${chapterId}`, ttl * 1e3, async () => {
          const x = await manga.getPages(chapterId, source);
          return x.pages.length ? x : null;
        });
        return json(r ?? { chapterId, pages: [] }, 200, r ? ttl : 0);
      }
    } catch (e) {
      return json({ error: `Manga source unavailable (${source}): ` + e.message }, 502);
    }
    return json({ error: "Unknown manga route" }, 404);
  }

  /* ---------- Manhwa (dedicated servers; see manhwa.js) ---------- */
  if (path.startsWith("/api/manhwa/")) {
    const source = manhwa.parseSource(q("source"));
    try {
      if (path === "/api/manhwa/sources") return json({ sources: manhwa.SOURCES, default: manhwa.DEFAULT_SOURCE }, 200, 3600);
      if (path === "/api/manhwa/home") {
        const data = await cached(`mwhome:${source}`, 5 * 60e3, async () => {
          const r = await manhwa.getHome(source);
          return r && (r.trending?.length || r.latest?.length || r.newRelease?.length) ? r : null;
        });
        if (!data) return json({ error: `Manhwa source unavailable (${source})` }, 502);
        return json(data, 200, 120);
      }
      if (path === "/api/manhwa/search") {
        const term = q("q").trim();
        return term ? json(await cached(`mwsearch:${source}:${term}`, 10 * 60e3, () => manhwa.search(term, source)), 200, 300) : json({ results: [] });
      }
      if (path === "/api/manhwa/chapters") {
        const id = q("id");
        if (!id) return json({ error: "Missing manhwa id" }, 400);
        return json(await cached(`mwch:${source}:${id}`, 30 * 60e3, () => manhwa.getChapters(id, source)), 200, 1800);
      }
      if (path === "/api/manhwa/pages") {
        const chapterId = q("chapterId") || q("id");
        if (!chapterId) return json({ error: "Missing chapterId" }, 400);
        const ttl = source === "mangadex" ? 600 : 3600;
        const r = await cached(`mwpg:${source}:${chapterId}`, ttl * 1e3, async () => {
          const x = await manhwa.getPages(chapterId, source);
          return x.pages.length ? x : null;
        });
        return json(r ?? { chapterId, pages: [] }, 200, r ? ttl : 0);
      }
    } catch (e) {
      return json({ error: `Manhwa source unavailable (${source}): ` + e.message }, 502);
    }
    return json({ error: "Unknown manhwa route" }, 404);
  }

  return null;
}

