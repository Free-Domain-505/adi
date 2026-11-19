// Direct Multi-Dub HLS/MP4 extractor for https://tooniboy.xyz
// Extracts verified direct playable streams (Multi-Audio HLS master playlists + .vtt captions / MP4)
// so playback always runs inside CinePlayer without opening any third-party embed iframe.
// Never surfaces provider name in UI responses.

import { fetchTimeout } from "./fetchTimeout.js";
import { ANIME_MAPPING } from "./mapping.js";
import { parseHlsAudioLanguages, normalizeLangName } from "./audioAvailLogic.js";

const TOONIBOY_BASE = "https://tooniboy.xyz";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BLAKITE_Q_CODES = ["oaa", "baa", "caa", "gaa", "haa"]; // 240p, 360p, 480p, 720p, 1080p

const searchMemo = new Map();
const metaMemo = new Map();
const seasonMemo = new Map();
const resolveMemo = new Map();
const availMemo = new Map();
const inflightResolves = new Map();

function stripTags(html = "") {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanTooniboyTitle(str = "") {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\((?:tv|eng[-–/\s]*jap|hindi\s*dub|multi\s*audio|sony\s*yay\s*dub|\d{4})\)/gi, " ")
    .replace(/\b(?:hindi|tamil|telugu|multi)\s*(?:dub|dubbed|audio)\b/gi, " ")
    .replace(/\bsony\s*yay\s*dub\b/gi, " ")
    .replace(/\s*(?:season|part|cour|s)\s*\d+\b/gi, " ")
    .replace(/\s*\d+(?:st|nd|rd|th)\s+season\b/gi, " ")
    .replace(/\s*final\s+season\b/gi, " ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTooniboySeasonNum(text = "") {
  const s = String(text || "");
  const m1 = s.match(/\b(?:season|series|cour|part|s)\s*[-:]?\s*(\d{1,2})\b/i);
  if (m1?.[1]) return parseInt(m1[1], 10);
  const m2 = s.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  if (m2?.[1]) return parseInt(m2[1], 10);
  return null;
}

export function buildTooniboyQueries(title = "", romajiTitle = "", synonyms = []) {
  const raw = [title, romajiTitle, ...(Array.isArray(synonyms) ? synonyms : [])]
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  const out = [];
  const push = (q) => {
    const clean = String(q || "")
      .replace(/\(tv\)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length >= 2 && !out.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      out.push(clean);
    }
  };

  for (const t of raw) {
    push(t);
    const beforeColon = t.split(/[:\-–|]/)[0]?.trim();
    if (beforeColon && beforeColon.length >= 3) push(beforeColon);
    const noSeason = t
      .replace(/\b(?:season|part|cour)\s*\d+\b/gi, "")
      .replace(/\b\d+(?:st|nd|rd|th)\s+season\b/gi, "")
      .replace(/\bfinal\s+season\b/gi, "")
      .trim();
    if (noSeason && noSeason.length >= 3) push(noSeason);
  }
  return out.slice(0, 6);
}

function isolateSearchContainer(html = "") {
  const str = String(html || "");
  const aaStart = str.indexOf('id="aa-movies"');
  if (aaStart !== -1) {
    const endAside = str.indexOf("</main>", aaStart);
    return str.slice(aaStart, endAside !== -1 ? endAside : Math.min(str.length, aaStart + 45000));
  }
  const mainStart = str.indexOf("<main");
  if (mainStart !== -1) {
    const mainEnd = str.indexOf("</main>", mainStart);
    return str.slice(mainStart, mainEnd !== -1 ? mainEnd : str.length);
  }
  return str;
}

export function parseTooniboySearchHtml(html = "") {
  const region = isolateSearchContainer(html);
  const results = [];
  const seen = new Set();

  // Primary card structure: <article class="post ..."><header class="entry-header"><h2 class="entry-title">...</h2>...<a href="/series/..." class="lnk-blk">
  const articleRe = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  for (const m of region.matchAll(articleRe)) {
    const block = m[1] || "";
    const linkM = block.match(/href=["'](?:https?:\/\/(?:www\.)?tooniboy\.xyz)?(\/(series|movies)\/([^"'\/?#]+)\/?)["']/i);
    if (!linkM) continue;
    const path = linkM[1];
    const kind = linkM[2].toLowerCase();
    const slug = linkM[3];
    const url = `${TOONIBOY_BASE}/${kind}/${slug}/`;
    if (seen.has(url)) continue;
    seen.add(url);

    const h2 = block.match(/<h2[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    const title = stripTags(h2 || "") || slug.replace(/-/g, " ");
    results.push({
      url,
      path,
      slug,
      title,
      isMovie: kind === "movies",
    });
  }

  if (results.length > 0) return results;

  // Fallback anchor scan strictly inside search container
  const anchorRe = /<a\b[^>]*href=["'](?:https?:\/\/(?:www\.)?tooniboy\.xyz)?(\/(series|movies)\/([^"'\/?#]+)\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of region.matchAll(anchorRe)) {
    const kind = m[2].toLowerCase();
    const slug = m[3];
    if (slug === "page") continue;
    const url = `${TOONIBOY_BASE}/${kind}/${slug}/`;
    if (seen.has(url)) continue;
    seen.add(url);
    const inner = stripTags(m[4] || "");
    results.push({
      url,
      path: m[1],
      slug,
      title: inner.length >= 2 ? inner : slug.replace(/-/g, " "),
      isMovie: kind === "movies",
    });
  }
  return results;
}

export function pickBestTooniboyMatch(candidates = [], { title = "", romajiTitle = "", synonyms = [], isMovie = false, season = 0 } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const wantMovie = Boolean(isMovie);
  const rawTargets = [title, romajiTitle, ...(Array.isArray(synonyms) ? synonyms : [])].filter(Boolean);
  const targetBases = rawTargets.map((t) => cleanTooniboyTitle(t)).filter(Boolean);
  if (targetBases.length === 0) return null;

  let wantSeason = season > 0 ? season : null;
  if (!wantSeason) {
    for (const t of rawTargets) {
      const s = extractTooniboySeasonNum(t);
      if (s) {
        wantSeason = s;
        break;
      }
    }
  }

  let best = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    const rawCandTitle = `${c.title || ""} ${String(c.slug || "").replace(/-/g, " ")}`;
    const candClean = cleanTooniboyTitle(c.title || String(c.slug || "").replace(/-/g, " "));
    const candSlugClean = cleanTooniboyTitle(String(c.slug || "").replace(/-/g, " "));
    if (!candClean && !candSlugClean) continue;

    const candWords = (candClean || candSlugClean).split(/\s+/).filter((w) => w.length > 0);
    const candSeason = extractTooniboySeasonNum(rawCandTitle);
    const isAltUnofficialDub = /sony\s*yay\s*dub|fandub/i.test(rawCandTitle);

    let topForCand = -Infinity;
    for (const targetBase of targetBases) {
      const targetWords = targetBase.split(/\s+/).filter((w) => w.length > 0);
      if (targetWords.length === 0) continue;

      let score = Boolean(c.isMovie) === wantMovie ? 25 : -60;

      if (candClean === targetBase || candSlugClean === targetBase) {
        score += 120;
      } else if (candClean.includes(targetBase) || candSlugClean.includes(targetBase)) {
        score += 55;
      } else if (targetBase.includes(candClean) && candWords.length >= 2) {
        score += 40;
      }

      const common = candWords.filter((w) => targetWords.includes(w)).length;
      const missingTarget = targetWords.filter((w) => !candWords.includes(w)).length;
      const extraCand = candWords.filter(
        (w) => !targetWords.includes(w) && !["the", "of", "and", "in", "a", "an", "to"].includes(w),
      ).length;

      score += common * 18;
      score -= missingTarget * 22;
      if (candClean !== targetBase && candSlugClean !== targetBase) {
        score -= extraCand * (targetWords.length <= 2 ? 32 : 16);
      }

      // Disambiguate sequel movies or numbered entries like "Jujutsu Kaisen 0" vs "Jujutsu Kaisen"
      const targetHasZero = /\b0\b/.test(targetBase);
      const candHasZero = /\b0\b/.test(candClean);
      if (targetHasZero !== candHasZero) score -= 45;

      if (wantSeason && candSeason) {
        score += candSeason === wantSeason ? 35 : -50;
      } else if ((!wantSeason || wantSeason === 1) && candSeason && candSeason > 1) {
        score -= 40;
      }

      if (isAltUnofficialDub && !rawTargets.some((t) => /sony\s*yay/i.test(t))) {
        score -= 25;
      }

      if (score > topForCand) topForCand = score;
    }

    if (topForCand > bestScore) {
      bestScore = topForCand;
      best = c;
    }
  }

  return bestScore >= 55 ? best : null;
}

export function extractTooniboyGenresLanguages(html = "") {
  const str = String(html || "");
  // Exclude global navbar by matching ONLY inside article/header metadata (<span class="genres">)
  const genresMatch = str.match(/<span[^>]*class=["'][^"']*\bgenres\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  const block = genresMatch?.[1] || "";
  if (!block) return [];

  const langs = [];
  const push = (raw) => {
    // Handle common site typo "Japaneses" -> "Japanese"
    const fixed = String(raw || "").replace(/japaneses/gi, "Japanese").trim();
    const norm = normalizeLangName(fixed);
    if (norm && !langs.includes(norm)) langs.push(norm);
  };

  for (const a of block.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)) {
    push(stripTags(a[1]));
  }
  if (langs.length === 0) {
    for (const part of stripTags(block).split(/[,|/]/)) {
      push(part);
    }
  }
  return langs;
}

export function extractTooniboySeasons(html = "") {
  const seasons = [];
  const seen = new Set();
  const str = String(html || "");
  // Match buttons with data-season + data-url in either attribute order
  const btnRe = /<(?:button|a)\b([^>]*data-season=["'](\d+)["'][^>]*)>/gi;
  for (const m of str.matchAll(btnRe)) {
    const attrs = m[1] || "";
    const seasonNum = parseInt(m[2], 10);
    const urlPath = attrs.match(/data-url=["']([^"']+)["']/i)?.[1] || attrs.match(/href=["']([^"']+)["']/i)?.[1];
    if (!Number.isFinite(seasonNum) || seasonNum <= 0 || seen.has(seasonNum)) continue;
    seen.add(seasonNum);
    const fullUrl = urlPath
      ? (urlPath.startsWith("http") ? urlPath : `${TOONIBOY_BASE}${urlPath.startsWith("/") ? "" : "/"}${urlPath}`)
      : null;
    seasons.push({ seasonNum, url: fullUrl });
  }
  return seasons.sort((a, b) => a.seasonNum - b.seasonNum);
}

export function extractTooniboyEpisodes(html = "") {
  const episodes = [];
  const seen = new Set();
  const str = String(html || "");

  // Match <li> episode cards containing optional <span class="num-epi">SxE</span> and <a href="/episode/...">
  for (const li of str.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const block = li[1] || "";
    const hrefM = block.match(/href=["'](?:https?:\/\/(?:www\.)?tooniboy\.xyz)?(\/episode\/([^"'\/?#]+)\/?)["']/i);
    if (!hrefM) continue;
    const url = `${TOONIBOY_BASE}${hrefM[1].endsWith("/") ? hrefM[1] : `${hrefM[1]}/`}`;
    const slug = hrefM[2];
    if (seen.has(url)) continue;

    let seasonNum = null;
    let epNum = null;
    const numEpiM = block.match(/class=["'][^"']*num-epi[^"']*["'][^>]*>\s*(\d+)x(\d+)/i);
    if (numEpiM) {
      seasonNum = parseInt(numEpiM[1], 10);
      epNum = parseInt(numEpiM[2], 10);
    } else {
      const slugSE = slug.match(/-(\d+)x(\d+)$/i);
      if (slugSE) {
        seasonNum = parseInt(slugSE[1], 10);
        epNum = parseInt(slugSE[2], 10);
      } else {
        const epOnly = slug.match(/(?:episode|ep)[-_]?(\d+)$/i) || slug.match(/-(\d+)$/);
        if (epOnly?.[1]) epNum = parseInt(epOnly[1], 10);
      }
    }
    if (epNum === null) continue;
    seen.add(url);
    episodes.push({ seasonNum, epNum, url, slug });
  }

  // Fallback bare /episode/ anchor scan
  if (episodes.length === 0) {
    for (const m of str.matchAll(/href=["'](?:https?:\/\/(?:www\.)?tooniboy\.xyz)?(\/episode\/([^"'\/?#]+)\/?)["']/gi)) {
      const slug = m[2];
      const url = `${TOONIBOY_BASE}${m[1].endsWith("/") ? m[1] : `${m[1]}/`}`;
      if (seen.has(url)) continue;
      const slugSE = slug.match(/-(\d+)x(\d+)$/i);
      const epOnly = slug.match(/(?:episode|ep)[-_]?(\d+)$/i) || slug.match(/-(\d+)$/);
      const seasonNum = slugSE ? parseInt(slugSE[1], 10) : null;
      const epNum = slugSE ? parseInt(slugSE[2], 10) : (epOnly?.[1] ? parseInt(epOnly[1], 10) : null);
      if (epNum === null) continue;
      seen.add(url);
      episodes.push({ seasonNum, epNum, url, slug });
    }
  }

  return episodes;
}

export function rewriteRubyEmbedUrl(embedUrl = "") {
  const raw = String(embedUrl || "").trim();
  const m = raw.match(/^(https?:\/\/(?:www\.)?rubystm\.com)\/(?:e\/|embed-)([a-z0-9]+)(?:\.html)?/i);
  if (!m) return raw;
  return `${m[1]}/embed-${m[2]}.html`;
}

export function extractTooniboyEmbedTabs(html = "") {
  const str = String(html || "");
  const tabLabels = new Map();

  for (const m of str.matchAll(/<a[^>]*href=["']#(options-\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const id = m[1];
    const srvM = m[2].match(/class=["'][^"']*server[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const label = stripTags(srvM?.[1] || m[2]).trim();
    if (id && label) tabLabels.set(id, label);
  }

  const embeds = [];
  const seenUrls = new Set();

  // First pair explicit options-N divs with their iframe srcs
  for (const divM of str.matchAll(/<div[^>]*id=["'](options-\d+)["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const optId = divM[1];
    const body = divM[2] || "";
    const srcM = body.match(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i);
    if (!srcM?.[1]) continue;
    let url = srcM[1].trim().replace(/&amp;/g, "&");
    if (url.startsWith("//")) url = `https:${url}`;
    if (!/^https?:\/\//i.test(url)) continue;
    if (/youtube\.com|youtu\.be/i.test(url)) continue;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const label = tabLabels.get(optId) || "";
    embeds.push(classifyTooniboyEmbed(url, label));
  }

  // Fallback if iframe divs had different structure
  if (embeds.length === 0) {
    for (const m of str.matchAll(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/gi)) {
      let url = m[1].trim().replace(/&amp;/g, "&");
      if (url.startsWith("//")) url = `https:${url}`;
      if (!/^https?:\/\//i.test(url) || /youtube\.com|youtu\.be/i.test(url) || seenUrls.has(url)) continue;
      seenUrls.add(url);
      embeds.push(classifyTooniboyEmbed(url, ""));
    }
  }

  embeds.sort((a, b) => a.priority - b.priority);
  return embeds;
}

function classifyTooniboyEmbed(url, label = "") {
  const lowUrl = url.toLowerCase();
  const lowLabel = label.toLowerCase();

  if (lowUrl.includes("rubystm.com") || lowUrl.includes("streamruby") || lowLabel.includes("ruby")) {
    return { provider: "ruby", label: label || "Ruby", url: rewriteRubyEmbedUrl(url), origUrl: url, priority: 1 };
  }
  if (lowUrl.includes("ravok.buzz") || lowUrl.includes("as-cdn") || lowLabel === "play") {
    return { provider: "play", label: label || "Play", url, origUrl: url, priority: 2 };
  }
  if (lowUrl.includes("blakiteapi.xyz") || lowLabel.includes("multiq")) {
    return { provider: "multiq", label: label || "MultiQ", url, origUrl: url, priority: 3 };
  }
  if (lowUrl.includes("vidmoly.net") || lowUrl.includes("vidmoly.org") || lowLabel.includes("moly")) {
    return { provider: "moly", label: label || "Moly", url, origUrl: url, priority: 4 };
  }
  if (lowUrl.includes("filesforever.link") || lowUrl.includes("iqsmartgames.com") || lowLabel.includes("watch/dl")) {
    return { provider: "watchdl", label: label || "Watch/DL", url, origUrl: url, priority: 90 };
  }
  return { provider: "other", label: label || "Unknown", url, origUrl: url, priority: 99 };
}

export function unpackDeanEdwards(packed) {
  const str = String(packed || "");
  const m = str.match(
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\('((?:\\.|[^'\\])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'\\])*)'\.split\('\|'\)/,
  );
  if (!m) return null;

  const p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const a = parseInt(m[2], 10);
  const c0 = parseInt(m[3], 10);
  const k = m[4].replace(/\\'/g, "'").split("|");

  const encodeBase = (n) => {
    const first = n < a ? "" : encodeBase(Math.floor(n / a));
    const rem = n % a;
    const ch = rem > 35 ? String.fromCharCode(rem + 29) : rem.toString(36);
    return first + ch;
  };

  const dict = new Map();
  for (let i = c0 - 1; i >= 0; i--) {
    if (k[i]) dict.set(encodeBase(i), k[i]);
  }
  return p.replace(/\b\w+\b/g, (word) => dict.get(word) || word);
}

export function extractRubyMediaFromHtml(embedUrl, html = "") {
  let source = String(html || "");
  const unpacked = unpackDeanEdwards(source);
  if (unpacked) source = `${source}\n${unpacked}`;

  if (/Video unavailable|File was deleted|not found/i.test(source) && !source.includes(".m3u8")) {
    return { streamUrl: null, subtitles: [] };
  }

  let originUrl = "";
  try {
    originUrl = new URL(embedUrl).origin;
  } catch {}

  const absolutize = (u) => {
    const clean = String(u || "").replace(/\\\//g, "/").trim();
    if (!clean) return "";
    if (/^https?:\/\//i.test(clean)) return clean;
    if (clean.startsWith("//")) return `https:${clean}`;
    if (originUrl && clean.startsWith("/")) return `${originUrl}${clean}`;
    try {
      return new URL(clean, embedUrl).href;
    } catch {
      return clean;
    }
  };

  let streamUrl = null;
  const srcMatch =
    source.match(/sources\s*:\s*\[\s*\{[^}]*?(?:file|src)\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
    source.match(/["']file["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
    source.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
    source.match(/https?:\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/i);
  if (srcMatch) {
    streamUrl = absolutize(srcMatch[1] || srcMatch[0]);
  }

  const subtitles = [];
  const seenSubs = new Set();
  const tracksBlock = source.match(/tracks\s*:\s*(\[[\s\S]*?\])/i)?.[1] || source;
  for (const objM of tracksBlock.matchAll(/\{[^{}]*(?:file|src)\s*:\s*["']([^"']+)["'][^{}]*\}/gi)) {
    const objStr = objM[0];
    const fileUrl = absolutize(objM[1]);
    if (!fileUrl || seenSubs.has(fileUrl)) continue;
    // Skip sprite / thumbnail VTT files
    if (/kind\s*:\s*["']thumbnails["']/i.test(objStr) || /_sli\.vtt|thumbnails?\.vtt|sprite/i.test(fileUrl)) continue;
    if (!/\.(vtt|srt|ass)(\?|$)/i.test(fileUrl) && !/captions/i.test(objStr)) continue;
    const label = objStr.match(/label\s*:\s*["']([^"']+)["']/i)?.[1] || "English";
    seenSubs.add(fileUrl);
    subtitles.push({
      file: fileUrl,
      label,
      default: /default\s*:\s*true/i.test(objStr) || /english/i.test(label),
    });
  }

  return { streamUrl, subtitles };
}

export function buildBlakiteApiUrl(embedUrl = "") {
  const m = String(embedUrl || "").match(/blakiteapi\.xyz\/embed\/(\d+)(?:\/(\d+-\d+))?/i);
  if (!m) return null;
  const tmdbId = m[1];
  const epPart = m[2] || "";
  return epPart
    ? `https://blakiteapi.xyz/api/get.php?id=${encodeURIComponent(epPart)}&tmdbId=${encodeURIComponent(tmdbId)}`
    : `https://blakiteapi.xyz/api/get.php?tmdbId=${encodeURIComponent(tmdbId)}`;
}

export function buildBlakiteStreamCandidates(data) {
  if (!data?.dataId) return [];
  const dataId = String(data.dataId).replace(/\\\//g, "/").replace(/^\/+/, "");
  const format = String(data.format || "MP4").toUpperCase();
  const qid = Math.min(BLAKITE_Q_CODES.length, Math.max(1, parseInt(data.qid, 10) || 4));
  const out = [];

  if (format === "MP4") {
    for (let i = qid - 1; i >= 0; i--) {
      out.push({
        format: "mp4",
        quality: ["240p", "360p", "480p", "720p", "1080p"][i] || "480p",
        url: `https://hugh.cdn.rumble.cloud/video/${dataId}.${BLAKITE_Q_CODES[i]}.mp4`,
      });
    }
  } else if (format === "M3U8" && data.ranges) {
    const code = BLAKITE_Q_CODES[qid - 1] || "gaa";
    out.push({
      format: "hls",
      quality: data.quality || "720p",
      url: `https://hugh.cdn.rumble.cloud/video/${dataId}.${code}.tar?r_file=chunklist.m3u8&r_type=application%2Fvnd.apple.mpegurl&r_range=${encodeURIComponent(String(data.ranges))}`,
    });
  }
  return out;
}

async function fetchHtml(url, referer = `${TOONIBOY_BASE}/`, timeoutMs = 6000) {
  const res = await fetchTimeout(url, {
    headers: {
      "User-Agent": UA,
      Referer: referer,
      Accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
    },
    timeoutMs,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function verifyHlsManifest(streamUrl, refererCandidates = [], countryOfOrigin = "JP") {
  for (const ref of refererCandidates) {
    let origin = "";
    try {
      origin = ref ? new URL(ref).origin : "";
    } catch {}
    const attempts = origin
      ? [{ Referer: ref, Origin: origin }, { Referer: ref }]
      : ref
        ? [{ Referer: ref }]
        : [{}];
    for (const hdrs of attempts) {
      try {
        const res = await fetchTimeout(streamUrl, {
          headers: { "User-Agent": UA, Accept: "*/*", ...hdrs },
          timeoutMs: 5500,
        });
        if (!res.ok) continue;
        const text = await res.text();
        if (!text.trimStart().startsWith("#EXTM3U")) continue;
        return {
          ok: true,
          referer: ref || "",
          languages: parseHlsAudioLanguages(text, countryOfOrigin),
        };
      } catch {}
    }
  }
  return { ok: false, referer: "", languages: [] };
}

async function verifyMp4Stream(streamUrl, referer = "https://blakiteapi.xyz/") {
  try {
    const res = await fetchTimeout(streamUrl, {
      headers: {
        "User-Agent": UA,
        Referer: referer,
        Range: "bytes=0-128",
      },
      timeoutMs: 4500,
    });
    if (!res.ok && res.status !== 206) return false;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    return ct.includes("video") || ct.includes("octet-stream") || res.status === 206;
  } catch {
    return false;
  }
}

async function resolveRubyEmbed(embedUrl, countryOfOrigin = "JP") {
  const targetUrl = rewriteRubyEmbedUrl(embedUrl);
  const html = await fetchHtml(targetUrl, `${TOONIBOY_BASE}/`, 6000);
  const { streamUrl, subtitles } = extractRubyMediaFromHtml(targetUrl, html);
  if (!streamUrl) return null;

  const verified = await verifyHlsManifest(
    streamUrl,
    [`${TOONIBOY_BASE}/`, "https://rubystm.com/"],
    countryOfOrigin,
  );
  if (!verified.ok) return null;

  return {
    provider: "ruby",
    format: "hls",
    streamUrl,
    referer: verified.referer || "https://rubystm.com/",
    subtitles,
    languages: verified.languages,
  };
}

async function resolvePlayEmbed(embedUrl, countryOfOrigin = "JP") {
  const m = String(embedUrl || "").match(/ravok\.buzz\/video\/([a-f0-9]+)/i);
  const hash = m?.[1];
  if (!hash) return null;

  const postUrl = `https://ravok.buzz/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`;
  const res = await fetchTimeout(postUrl, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Referer: embedUrl,
      Origin: "https://ravok.buzz",
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: `hash=${encodeURIComponent(hash)}&r=${encodeURIComponent(`${TOONIBOY_BASE}/`)}`,
    timeoutMs: 5500,
  });
  if (!res.ok) return null;
  const txt = await res.text();
  if (!txt || !txt.trim().startsWith("{")) return null;
  const json = JSON.parse(txt);
  const streamUrl = json.securedLink || json.videoSource;
  if (!streamUrl) return null;

  const isMp4 = /\.mp4(\?|$)/i.test(streamUrl);
  if (isMp4) {
    const ok = await verifyMp4Stream(streamUrl, "https://ravok.buzz/");
    if (!ok) return null;
    return { provider: "play", format: "mp4", streamUrl, referer: "https://ravok.buzz/", subtitles: [], languages: [] };
  }

  const verified = await verifyHlsManifest(streamUrl, ["https://ravok.buzz/", `${TOONIBOY_BASE}/`], countryOfOrigin);
  if (!verified.ok) return null;
  return {
    provider: "play",
    format: "hls",
    streamUrl,
    referer: verified.referer || "https://ravok.buzz/",
    subtitles: [],
    languages: verified.languages,
  };
}

async function resolveMolyEmbed(embedUrl, countryOfOrigin = "JP") {
  const html = await fetchHtml(embedUrl, `${TOONIBOY_BASE}/`, 5500);
  const { streamUrl, subtitles } = extractRubyMediaFromHtml(embedUrl, html);
  if (!streamUrl) return null;

  let refOrigin = "https://vidmoly.net/";
  try {
    refOrigin = `${new URL(embedUrl).origin}/`;
  } catch {}
  const verified = await verifyHlsManifest(streamUrl, [refOrigin, "https://vidmoly.net/", "https://vidmoly.org/"], countryOfOrigin);
  if (!verified.ok) return null;

  return {
    provider: "moly",
    format: "hls",
    streamUrl,
    referer: verified.referer || refOrigin,
    subtitles,
    languages: verified.languages,
  };
}

async function resolveMultiQEmbed(embedUrl, pageLanguages = []) {
  const apiUrl = buildBlakiteApiUrl(embedUrl);
  if (!apiUrl) return null;
  const res = await fetchTimeout(apiUrl, {
    headers: {
      "User-Agent": UA,
      Referer: "https://blakiteapi.xyz/",
      Accept: "application/json,*/*",
    },
    timeoutMs: 5500,
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json?.success || !json?.data) return null;

  const candidates = buildBlakiteStreamCandidates(json.data);
  const langMatch = String(json.data.animeTitle || "").match(/\b(hindi|tamil|telugu|english)\b/i)?.[1];
  const detectedLangs = langMatch
    ? [normalizeLangName(langMatch)].filter(Boolean)
    : pageLanguages.includes("Hindi")
      ? ["Hindi"]
      : [];

  for (const c of candidates) {
    if (c.format === "hls") {
      const verified = await verifyHlsManifest(c.url, ["https://blakiteapi.xyz/"]);
      if (verified.ok) {
        return {
          provider: "multiq",
          format: "hls",
          streamUrl: c.url,
          referer: "https://blakiteapi.xyz/",
          subtitles: [],
          languages: verified.languages.length ? verified.languages : detectedLangs,
        };
      }
    } else {
      const ok = await verifyMp4Stream(c.url, "https://blakiteapi.xyz/");
      if (ok) {
        return {
          provider: "multiq",
          format: "mp4",
          streamUrl: c.url,
          referer: "https://blakiteapi.xyz/",
          subtitles: [],
          languages: detectedLangs,
        };
      }
    }
  }
  return null;
}

async function searchBestTitle({ title = "", romajiTitle = "", synonyms = [], isMovie = false, season = 0 }) {
  const key = `${cleanTooniboyTitle(title)}|${cleanTooniboyTitle(romajiTitle)}|${isMovie ? "m" : "tv"}|${season || 0}`;
  const hit = searchMemo.get(key);
  if (hit && Date.now() - hit.at < 20 * 60e3) return hit.v;

  const queries = buildTooniboyQueries(title, romajiTitle, synonyms);
  const byUrl = new Map();

  for (const q of queries) {
    try {
      const html = await fetchHtml(`${TOONIBOY_BASE}/s?q=${encodeURIComponent(q)}`, `${TOONIBOY_BASE}/`, 5500);
      const parsed = parseTooniboySearchHtml(html);
      for (const c of parsed) {
        if (!byUrl.has(c.url)) byUrl.set(c.url, c);
      }
      const bestNow = pickBestTooniboyMatch([...byUrl.values()], { title, romajiTitle, synonyms, isMovie, season });
      if (bestNow) {
        searchMemo.set(key, { at: Date.now(), v: bestNow });
        return bestNow;
      }
    } catch {
      /* try next query variation */
    }
  }

  searchMemo.set(key, { at: Date.now(), v: null });
  return null;
}

async function fetchTitleMetaCached(pageUrl) {
  const hit = metaMemo.get(pageUrl);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.v;

  const html = await fetchHtml(pageUrl, `${TOONIBOY_BASE}/`, 6000);
  const languages = extractTooniboyGenresLanguages(html);
  const seasons = extractTooniboySeasons(html);
  const episodes = extractTooniboyEpisodes(html);
  const embeds = extractTooniboyEmbedTabs(html);

  const meta = { url: pageUrl, isMovie: pageUrl.includes("/movies/"), languages, seasons, episodes, embeds };
  metaMemo.set(pageUrl, { at: Date.now(), v: meta });
  return meta;
}

async function fetchSeasonEpisodesCached(seasonUrl) {
  const hit = seasonMemo.get(seasonUrl);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.v;

  const html = await fetchHtml(seasonUrl, `${TOONIBOY_BASE}/`, 5500);
  const eps = extractTooniboyEpisodes(html);
  seasonMemo.set(seasonUrl, { at: Date.now(), v: eps });
  return eps;
}

async function resolveEpisodePage({ candidate, episode = 1, title = "", romajiTitle = "", season = 0 }) {
  const meta = await fetchTitleMetaCached(candidate.url);
  if (candidate.isMovie) {
    return {
      epUrl: candidate.url,
      pageLanguages: meta.languages,
      episodeCount: 1,
      initialEmbeds: meta.embeds,
    };
  }

  const targetSeason = (season > 0 ? season : extractTooniboySeasonNum(`${title} ${romajiTitle}`)) || 1;
  const epNum = Math.max(1, parseInt(episode, 10) || 1);

  let seasonEpisodes = meta.episodes;
  const seasonTab = meta.seasons.find((s) => s.seasonNum === targetSeason);
  if (seasonTab?.url) {
    const needFetch =
      targetSeason > 1 ||
      !seasonEpisodes.some((e) => e.seasonNum === targetSeason && e.epNum === epNum);
    if (needFetch) {
      try {
        const fetched = await fetchSeasonEpisodesCached(seasonTab.url);
        if (fetched.length > 0) seasonEpisodes = fetched;
      } catch {}
    }
  } else if (targetSeason > 1 && meta.seasons.length > 0) {
    // Requested a season not present on a multi-season series page (unless candidate slug explicitly matched season)
    if (extractTooniboySeasonNum(candidate.slug) !== targetSeason) {
      return { epUrl: null, pageLanguages: meta.languages, episodeCount: 0, initialEmbeds: [] };
    }
  }

  let seasonCount = seasonEpisodes.filter((e) => e.seasonNum === null || e.seasonNum === targetSeason).length || seasonEpisodes.length;
  let match =
    seasonEpisodes.find((e) => e.seasonNum === targetSeason && e.epNum === epNum) ||
    seasonEpisodes.find((e) => e.seasonNum === null && e.epNum === epNum) ||
    null;
  let resolvedSeasonNum = targetSeason;

  // Continuous multi-season series (e.g. Naruto Shippuden Ep 350 lives in Season 17 on Tooniboy even when AniList season is unspecified/1)
  if (!match && (!season || season <= 1) && meta.seasons.length > 1) {
    const sortedSeasons = [...meta.seasons].filter((s) => s.url).sort((a, b) => a.seasonNum - b.seasonNum);
    let lo = 0;
    let hi = sortedSeasons.length - 1;
    while (lo <= hi && !match) {
      const mid = (lo + hi) >> 1;
      const candSeason = sortedSeasons[mid];
      if (!candSeason?.url) break;
      try {
        const eps = candSeason.seasonNum === targetSeason ? seasonEpisodes : await fetchSeasonEpisodesCached(candSeason.url);
        const directHit = eps.find((e) => e.epNum === epNum);
        if (directHit) {
          match = directHit;
          seasonEpisodes = eps;
          resolvedSeasonNum = candSeason.seasonNum;
          seasonCount = eps.length || seasonCount;
          break;
        }
        const nums = eps.map((e) => e.epNum).filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length === 0) break;
        const minEp = Math.min(...nums);
        const maxEp = Math.max(...nums);
        if (epNum < minEp) {
          hi = mid - 1;
        } else if (epNum > maxEp) {
          lo = mid + 1;
        } else {
          break;
        }
      } catch {
        break;
      }
    }
  }

  return {
    epUrl: match?.url || null,
    pageLanguages: meta.languages,
    episodeCount: seasonCount,
    initialEmbeds: [],
    meta,
    targetSeason: resolvedSeasonNum,
  };
}

export async function resolveTooniboy({
  anilistId = 0,
  episode = 1,
  title = "",
  romajiTitle = "",
  synonyms = [],
  format = "",
  countryOfOrigin = "JP",
  season = 0,
} = {}) {
  const ep = Math.max(1, parseInt(episode, 10) || 1);
  const isMovie = /movie/i.test(format || "");
  const effectiveSeason = season > 0 ? season : extractTooniboySeasonNum(`${title} ${romajiTitle}`) || 1;
  const cacheKey = `tb-stream:v2:${anilistId}:${ep}:${effectiveSeason}:${isMovie}:${cleanTooniboyTitle(title)}`;

  const hit = resolveMemo.get(cacheKey);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.v;

  const pending = inflightResolves.get(cacheKey);
  if (pending) return pending;

  const task = (async () => {
    try {
      const candidate = await searchBestTitle({ title, romajiTitle, synonyms, isMovie, season: effectiveSeason });
      if (!candidate) return null;

      const resolvedEp = await resolveEpisodePage({ candidate, episode: ep, title, romajiTitle, season });
      if (!resolvedEp.epUrl) return null;

      const embeds =
        resolvedEp.initialEmbeds.length > 0
          ? resolvedEp.initialEmbeds
          : extractTooniboyEmbedTabs(await fetchHtml(resolvedEp.epUrl, candidate.url, 6000));

      if (!embeds.length) return null;

      // 1. Always try Ruby first — carries multi-audio HLS + VTT subtitles
      const ruby = embeds.find((e) => e.provider === "ruby");
      let streamHit = null;
      if (ruby) {
        try {
          streamHit = await resolveRubyEmbed(ruby.url, countryOfOrigin);
        } catch {}
      }

      // 2. If Ruby is unavailable/deleted on this episode, race Play + Moly + MultiQ backups in parallel
      if (!streamHit) {
        const backups = embeds.filter((e) => ["play", "moly", "multiq"].includes(e.provider));
        if (backups.length > 0) {
          try {
            streamHit = await Promise.any(
              backups.map(async (emb) => {
                let res = null;
                if (emb.provider === "play") res = await resolvePlayEmbed(emb.url, countryOfOrigin);
                else if (emb.provider === "moly") res = await resolveMolyEmbed(emb.url, countryOfOrigin);
                else if (emb.provider === "multiq") res = await resolveMultiQEmbed(emb.url, resolvedEp.pageLanguages);
                if (!res?.streamUrl) throw new Error("not playable");
                return res;
              }),
            );
          } catch {}
        }
      }

      if (!streamHit?.streamUrl) return null;

      const langs =
        streamHit.languages && streamHit.languages.length > 0
          ? streamHit.languages
          : resolvedEp.pageLanguages;
      const isMultiAudio = langs.length >= 2 || (streamHit.provider === "ruby" && langs.length !== 1);

      const out = {
        success: true,
        server: "Server 12",
        audio: "dub",
        audioLabel:
          langs.length >= 2
            ? `Multi-Audio (${langs.slice(0, 4).join(", ")})`
            : langs.length === 1
              ? `${langs[0]} (Dub)`
              : "Multi-Audio",
        multiAudio: isMultiAudio,
        languages: langs,
        format: streamHit.format,
        streamUrl: streamHit.streamUrl,
        rawStreamUrl: streamHit.streamUrl,
        referer: streamHit.referer,
        subtitles: streamHit.subtitles || [],
      };
      resolveMemo.set(cacheKey, { at: Date.now(), v: out });
      return out;
    } catch {
      return null;
    } finally {
      inflightResolves.delete(cacheKey);
    }
  })();

  inflightResolves.set(cacheKey, task);
  return task;
}

export async function checkTooniboyAvailability({
  anilistId = 0,
  episode = 1,
  title = "",
  romajiTitle = "",
  synonyms = [],
  episodes = 0,
  format = "",
  countryOfOrigin = "JP",
  season = 0,
} = {}) {
  const ep = Math.max(1, parseInt(episode, 10) || 1);
  const isMovie = /movie/i.test(format || "");
  const effectiveSeason = season > 0 ? season : extractTooniboySeasonNum(`${title} ${romajiTitle}`) || 1;
  const cacheKey = `tb-avail:v4:${anilistId}:${ep}:${effectiveSeason}:${isMovie}:${episodes}:${cleanTooniboyTitle(title)}`;

  const hit = availMemo.get(cacheKey);
  const hitTtl = hit?.v?.available ? 12 * 60e3 : 90e3;
  if (hit && Date.now() - hit.at < hitTtl) return hit.v;

  const miss = { available: false, sub: false, dub: false, multi: false, episodeCount: 0, languages: [] };
  if (!cleanTooniboyTitle(title) && !cleanTooniboyTitle(romajiTitle)) return miss;

  try {
    const candidate = await searchBestTitle({ title, romajiTitle, synonyms, isMovie, season: effectiveSeason });
    if (!candidate) {
      availMemo.set(cacheKey, { at: Date.now(), v: miss });
      return miss;
    }

    const epInfo = await resolveEpisodePage({ candidate, episode: ep, title, romajiTitle, season: effectiveSeason });
    if (!epInfo.epUrl) {
      availMemo.set(cacheKey, { at: Date.now(), v: miss });
      return miss;
    }

    // Confirm this episode actually has at least one extractable non-trailer embed host
    const embeds =
      epInfo.initialEmbeds.length > 0
        ? epInfo.initialEmbeds
        : extractTooniboyEmbedTabs(await fetchHtml(epInfo.epUrl, candidate.url, 5500));

    const playableTabs = embeds.filter((e) => ["ruby", "play", "multiq", "moly"].includes(e.provider));
    if (playableTabs.length === 0) {
      availMemo.set(cacheKey, { at: Date.now(), v: miss });
      return miss;
    }

    // Count multi-season continuous series (e.g. Naruto Shippuden 500 eps across 18 seasons on Tooniboy)
    let rawCount = epInfo.episodeCount || 0;
    const rawMap = anilistId ? ANIME_MAPPING?.[String(anilistId).trim()] : null;
    const mapEntries = Array.isArray(rawMap) ? rawMap : rawMap ? [rawMap] : [];
    const isMultiSeasonMapped = mapEntries.length > 1;
    const metaSeasons = epInfo.meta?.seasons || [];
    let highestVerifiedEp = ep;
    let highestSeasonNum = effectiveSeason;

    if (!isMovie && metaSeasons.length > 1 && effectiveSeason === 1 && (isMultiSeasonMapped || (episodes > rawCount && rawCount > 0))) {
      const sortedSeasons = [...metaSeasons].sort((a, b) => a.seasonNum - b.seasonNum);
      const lastSeason = sortedSeasons[sortedSeasons.length - 1];
      if (lastSeason?.url && lastSeason.seasonNum > 1) {
        try {
          const lastEps = await fetchSeasonEpisodesCached(lastSeason.url);
          const epNums = lastEps.map((e) => e.epNum).filter((n) => Number.isFinite(n) && n > 0);
          const maxEp = epNums.length > 0 ? Math.max(...epNums) : 0;
          if (maxEp > rawCount && (!episodes || maxEp <= episodes + 10)) {
            rawCount = maxEp;
            highestVerifiedEp = maxEp;
            highestSeasonNum = lastSeason.seasonNum;
          } else if (isMultiSeasonMapped && lastEps.length > 0) {
            const otherSeasons = sortedSeasons.slice(1, -1).filter((s) => s.url);
            const otherLists = await Promise.all(otherSeasons.map((s) => fetchSeasonEpisodesCached(s.url).catch(() => [])));
            let summed = rawCount + lastEps.length;
            for (const l of otherLists) summed += l.length;
            if (summed > rawCount) rawCount = summed;
          }
        } catch {}
      }
    }

    // Probe actual HLS audio tracks from Ep 1 (and highest verified episode if multi-season) within bounded sub-budget
    // so slow embed hosts cannot trigger the outer 9s caller timeout and erase valid pageLanguages.
    const streamProbes = await Promise.race([
      Promise.all([
        resolveTooniboy({ anilistId, episode: ep, title, romajiTitle, synonyms, format, countryOfOrigin, season: effectiveSeason }).catch(() => null),
        highestVerifiedEp > ep
          ? resolveTooniboy({ anilistId, episode: highestVerifiedEp, title, romajiTitle, synonyms, format, countryOfOrigin, season: highestSeasonNum }).catch(() => null)
          : Promise.resolve(null),
      ]),
      new Promise((r) => setTimeout(() => r([]), 4800)),
    ]);

    const langSet = new Set(epInfo.pageLanguages);
    for (const sp of streamProbes) {
      if (Array.isArray(sp?.languages)) {
        for (const l of sp.languages) {
          const norm = normalizeLangName(l);
          if (norm) langSet.add(norm);
        }
      }
    }
    const langs = Array.from(langSet);
    const origLang =
      countryOfOrigin === "CN" || countryOfOrigin === "TW" || countryOfOrigin === "HK"
        ? "Chinese"
        : countryOfOrigin === "KR"
          ? "Korean"
          : "Japanese";

    const epCount = isMovie ? 1 : rawCount > 0 ? (episodes > 0 ? Math.min(rawCount, episodes) : rawCount) : episodes || 1;

    const out = {
      available: true,
      sub: langs.includes(origLang),
      dub: langs.some((l) => l !== origLang),
      dubVerified: langs.some((l) => l !== origLang),
      multi: langs.length >= 2,
      episodeCount: epCount,
      languages: langs,
    };
    availMemo.set(cacheKey, { at: Date.now(), v: out });
    return out;
  } catch {
    return miss;
  }
}
