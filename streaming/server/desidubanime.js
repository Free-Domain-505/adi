// Direct Hindi-dub HLS extractor for https://www.desidubanime.me
// Strictly Hindi-only (no multi-dub) and extracts verified direct .m3u8 playlists + .vtt captions
// so playback always runs inside CinePlayer without opening any third-party embed player.

const DESI_BASE = "https://www.desidubanime.me";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BLOCKED_EMBED_RE =
  /abyssplayer|abysscdn|filesforever|streamp2p|strp2p|dood|filemoon|streamwish|upns\.live|rpmshare|mirrordub/i;

const resolveMemo = new Map();
const resolveInflight = new Map();
const searchMemo = new Map();
const animeMetaMemo = new Map();

export function decodeB64Utf8(raw) {
  const clean = String(raw || "")
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/\s+/g, "");
  if (!clean) return "";
  const pad = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(pad, "base64").toString("utf8");
  }
  const bin = atob(pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function stripTags(html) {
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

export function normalizeDesiTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function extractSeasonNumber(s) {
  const txt = String(s || "").toLowerCase();
  const m1 = txt.match(/(?:season|cour|part|s)\s*[-:]?\s*(\d{1,2})\b/i);
  if (m1) return parseInt(m1[1], 10);
  const m2 = txt.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

export function buildSearchQueries(title, romajiTitle = "", synonyms = []) {
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
    // Split on colon/dash subtitle (e.g. "Demon Slayer: Kimetsu no Yaiba..." -> "Demon Slayer")
    const beforeColon = t.split(/[:\-–|]/)[0]?.trim();
    if (beforeColon && beforeColon.length >= 3) push(beforeColon);
    const noSeason = t
      .replace(/\b(?:season|part)\s*\d+\b/gi, "")
      .replace(/\b\d+(?:st|nd|rd|th)\s+season\b/gi, "")
      .trim();
    if (noSeason && noSeason.length >= 3) push(noSeason);
  }
  return out.slice(0, 6);
}

export function extractAnimeLinksFromSearch(html) {
  const seen = new Set();
  const results = [];
  const str = String(html || "");
  const anchorRe = /<a\b([^>]*href=["'](https?:\/\/(?:www\.)?desidubanime\.me\/anime\/([^"'\/]+)\/?)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(str))) {
    const url = m[2];
    const slug = m[3];
    if (seen.has(slug)) continue;
    const attrs = m[1] || "";
    const aria = attrs.match(/(?:aria-label|title|alt)=["']([^"']+)["']/i)?.[1] || "";
    const inner = stripTags(m[4] || "");
    const title = (inner.length >= 2 ? inner : aria) || slug.replace(/-/g, " ");
    seen.add(slug);
    results.push({ url, slug, title: title.trim() });
  }
  return results;
}

export function scoreAnimeCandidate(candidate, titles = [], opts = {}) {
  const candTitle = normalizeDesiTitle(candidate?.title || "");
  const candSlug = normalizeDesiTitle(String(candidate?.slug || "").replace(/-/g, " "));
  const candSeason = extractSeasonNumber(`${candidate?.title || ""} ${candidate?.slug || ""}`);
  const isMovie = Boolean(opts?.isMovie);
  const candLooksMovie = /\bmovie\b|\bfilm\b|\b0\b/.test(candTitle) || /\bmovie\b|\bfilm\b/.test(candSlug);

  let wantSeason = null;
  for (const t of titles) {
    const s = extractSeasonNumber(t);
    if (s) {
      wantSeason = s;
      break;
    }
  }

  let best = -1;
  for (const t of titles) {
    const normT = normalizeDesiTitle(t);
    if (!normT) continue;
    const tokens = normT.split(" ").filter((w) => w.length >= 2);
    if (tokens.length === 0) continue;

    let score = 0;
    if (candTitle === normT || candSlug === normT) score += 120;
    else if (candTitle.includes(normT) || candSlug.includes(normT)) score += 75;
    else if (normT.includes(candSlug) && candSlug.length >= 4) score += 55;

    let matchedTokens = 0;
    for (const tok of tokens) {
      if (candTitle.includes(tok) || candSlug.includes(tok)) matchedTokens++;
    }
    const coverage = matchedTokens / tokens.length;
    score += Math.round(coverage * 60);

    // Extra specificity: avoid matching short prefix if extra conflicting tokens exist
    const candTokens = candSlug.split(" ").filter((w) => w.length >= 2);
    if (matchedTokens === tokens.length && candTokens.length <= tokens.length + 2) {
      score += 18;
    }
    if (normT.includes("shippuden") && (candSlug.includes("shippuuden") || candSlug.includes("shippuden"))) {
      score += 55;
    }
    if (!normT.includes("shippuden") && (candSlug.includes("shippuuden") || candSlug.includes("shippuden"))) {
      score -= 45;
    }
    if (wantSeason !== null) {
      if (candSeason === wantSeason) score += 45;
      else if (candSeason !== null && candSeason !== wantSeason) score -= 50;
    } else if (candSeason && candSeason > 1) {
      score -= 20;
    }
    if (isMovie && candLooksMovie) score += 35;
    else if (!isMovie && candLooksMovie && !normT.includes("movie")) score -= 35;

    if (score > best) best = score;
  }
  return best;
}

export function parseAnimePageMeta(html) {
  const str = String(html || "");
  const postId =
    str.match(/postid-(\d+)/)?.[1] ||
    str.match(/anime_id["']?\s*[:=]\s*["']?(\d+)/)?.[1] ||
    str.match(/data-season=["'](\d+)["']/)?.[1] ||
    null;

  const seasons = [];
  const seenSeasons = new Set();
  for (const m of str.matchAll(/data-season=["'](\d+)["'][^>]*>([\s\S]*?)<\/(?:button|a|li|span|div)>/gi)) {
    const id = m[1];
    const label = stripTags(m[2]);
    if (!id || seenSeasons.has(`${id}:${label}`)) continue;
    seenSeasons.add(`${id}:${label}`);
    if (label) seasons.push({ id, label });
  }

  const watchLinks = [];
  const seenLinks = new Set();
  for (const m of str.matchAll(/href=["'](https?:\/\/(?:www\.)?desidubanime\.me\/watch\/[^"'#?]+\/?)["']/gi)) {
    if (!seenLinks.has(m[1])) {
      seenLinks.add(m[1]);
      watchLinks.push(m[1]);
    }
  }

  return { postId, seasons, watchLinks };
}

export function pickInlineWatchUrl(watchLinks = [], requestedEp = 1, isMovie = false) {
  if (!Array.isArray(watchLinks) || watchLinks.length === 0) return null;
  if (isMovie) {
    return (
      watchLinks.find((u) => /\bmovie\b|\bfilm\b/i.test(u)) ||
      watchLinks[0]
    );
  }
  const ep = Math.max(1, Number(requestedEp) || 1);
  const exactRe = new RegExp(`(?:episode|ep)[-_]?0*${ep}(?:[-/]|$)`, "i");
  const hit = watchLinks.find((u) => exactRe.test(u));
  if (hit) return hit;
  if (ep === 1 && watchLinks.length === 1 && !/episode-\d+/i.test(watchLinks[0])) {
    return watchLinks[0];
  }
  return null;
}

export function pickEpisodeFromAjax(episodes = [], requestedEp = 1, isMovie = false) {
  if (!Array.isArray(episodes) || episodes.length === 0) return null;
  if (isMovie) {
    return episodes[0]?.url || null;
  }
  const epNum = Math.max(1, Number(requestedEp) || 1);
  const parseNum = (item) => {
    const metaN = parseInt(String(item?.meta_number ?? ""), 10);
    if (Number.isFinite(metaN) && metaN > 0) return metaN;
    const rawNum = String(item?.number ?? "").replace(/^(?:episode|ep)\s*/i, "").trim();
    const n = parseInt(rawNum, 10);
    if (Number.isFinite(n) && n > 0) return n;
    const urlM = String(item?.url || "").match(/(?:episode|ep)[-_]?(\d+)/i);
    return urlM ? parseInt(urlM[1], 10) : NaN;
  };

  for (const item of episodes) {
    if (parseNum(item) === epNum && item?.url) return item.url;
  }

  // Handle continuous-numbered Season 2/3 posts on Kiranime (e.g., Solo Leveling S2 episodes 13..25)
  const nums = episodes.map(parseNum).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length > 0) {
    const minNum = Math.min(...nums);
    if (minNum > epNum && epNum - 1 < episodes.length) {
      return episodes[epNum - 1]?.url || null;
    }
  }
  return null;
}

function extractDivBlockByClass(html, classRe) {
  const startMatch = classRe.exec(html);
  if (!startMatch) return null;
  let depth = 0;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = startMatch.index;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[0].startsWith("</")) {
      depth--;
      if (depth <= 0) {
        return html.slice(startMatch.index, m.index + m[0].length);
      }
    } else if (!m[0].endsWith("/>")) {
      depth++;
    }
  }
  return html.slice(startMatch.index);
}

export function extractEmbedEntriesFromHtml(html) {
  const str = String(html || "");
  // Focus on player-dub selection block first (balanced across nested divs); if absent, inspect full watch HTML
  const dubBlock =
    extractDivBlockByClass(str, /<div[^>]*class=["'][^"']*player-dub[^"']*["'][^>]*>/i);
  const searchRegion = dubBlock || str;

  const entries = [];
  const seenUrls = new Set();

  const pushEntry = (rawLabel, rawVal) => {
    let url = String(rawVal || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      const iframeM = url.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframeM?.[1]) url = iframeM[1].trim();
    }
    if (url.startsWith("//")) url = `https:${url}`;
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (seenUrls.has(url)) return;
    if (BLOCKED_EMBED_RE.test(url) || BLOCKED_EMBED_RE.test(rawLabel)) return;
    seenUrls.add(url);

    const lowLabel = String(rawLabel || "").toLowerCase();
    const lowUrl = url.toLowerCase();
    let provider = "unknown";
    let priority = 50;
    if (
      lowLabel.includes("ruby") ||
      lowUrl.includes("nuvorel") ||
      lowUrl.includes("streamruby") ||
      lowUrl.includes("rubyvidhub")
    ) {
      provider = "sruby";
      priority = 1;
    } else if (lowLabel.includes("evids") || lowUrl.includes("morencius") || lowUrl.includes("earnvids")) {
      provider = "evids";
      priority = 2;
    } else if (lowLabel.includes("vmoly") || lowUrl.includes("vidmoly")) {
      provider = "vmoly";
      priority = 3;
    }
    if (lowLabel.includes("sub") && !lowLabel.includes("dub")) {
      priority += 30;
    }
    entries.push({ label: rawLabel || provider, url, provider, priority });
  };

  for (const m of searchRegion.matchAll(/data-embed-id=["']([^"']+)["']/gi)) {
    const val = m[1];
    const parts = val.split(":");
    if (parts.length < 2) continue;
    try {
      const label = decodeB64Utf8(parts[0]);
      const embedUrl = decodeB64Utf8(parts.slice(1).join(":"));
      pushEntry(label, embedUrl);
    } catch {
      /* ignore malformed base64 */
    }
  }

  for (const m of searchRegion.matchAll(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
    pushEntry("iframe", m[1]);
  }

  entries.sort((a, b) => a.priority - b.priority);
  return entries;
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

export function extractMediaFromEmbedHtml(embedUrl, html) {
  let source = String(html || "");
  const unpacked = unpackDeanEdwards(source);
  if (unpacked) source = `${source}\n${unpacked}`;

  let streamUrl = null;
  let originUrl = null;
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

  // 1. Prefer EVids links.hls2 (.m3u8) over links.hls3 (.txt)
  const hls2M = source.match(/["']hls2["']\s*:\s*["']([^"']+)["']/i);
  if (hls2M?.[1]) streamUrl = absolutize(hls2M[1]);

  if (!streamUrl) {
    const fileRe = /sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i;
    const fm = source.match(fileRe) || source.match(/["']file["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) || source.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
    if (fm?.[1]) streamUrl = absolutize(fm[1]);
  }

  if (!streamUrl) {
    const hls3M = source.match(/["']hls3["']\s*:\s*["']([^"']+)["']/i);
    if (hls3M?.[1]) streamUrl = absolutize(hls3M[1]);
  }

  if (!streamUrl) {
    const bareM3u8 = source.match(/https?:\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/i);
    if (bareM3u8?.[0]) streamUrl = bareM3u8[0];
  }

  // Extract caption tracks (.vtt / .srt), excluding thumbnail sprites
  const subtitles = [];
  const seenSubs = new Set();
  const tracksBlock = source.match(/tracks\s*:\s*(\[[\s\S]*?\])/i)?.[1] || source;
  for (const objM of tracksBlock.matchAll(/\{[^{}]*file\s*:\s*["']([^"']+)["'][^{}]*\}/gi)) {
    const objStr = objM[0];
    const fileUrl = absolutize(objM[1]);
    if (!fileUrl || seenSubs.has(fileUrl)) continue;
    if (/kind\s*:\s*["']thumbnails["']/i.test(objStr) || /thumbnails?\.vtt|sprite/i.test(fileUrl)) continue;
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

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
      ...(opts.headers || {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs || 12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchJsonSafe(url, opts = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,*/*",
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(opts.timeoutMs || 11000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function verifyHlsStream(streamUrl, refererUrl) {
  let origin = "";
  try {
    origin = new URL(refererUrl).origin;
  } catch {}
  const attempts = [
    { Referer: refererUrl, ...(origin ? { Origin: origin } : {}) },
    { Referer: refererUrl },
  ];
  for (const hdrs of attempts) {
    try {
      const r = await fetch(streamUrl, {
        headers: { "User-Agent": UA, Accept: "*/*", ...hdrs },
        signal: AbortSignal.timeout(8500),
      });
      if (!r.ok) continue;
      const body = await r.text();
      if (body.trimStart().startsWith("#EXTM3U")) return true;
    } catch {}
  }
  return false;
}

async function searchBestAnimeCandidate({ title, romajiTitle, synonyms, format }) {
  const isMovie = String(format || "").toUpperCase() === "MOVIE";
  const allTitles = [title, romajiTitle, ...(Array.isArray(synonyms) ? synonyms : [])].filter(Boolean);
  const sKey = `${normalizeDesiTitle(title)}|${normalizeDesiTitle(romajiTitle)}|${isMovie ? "m" : "tv"}`;
  const sHit = searchMemo.get(sKey);
  if (sHit && Date.now() - sHit.at < 20 * 60e3) return sHit.v;

  const queries = buildSearchQueries(title, romajiTitle, synonyms);

  const candidatesBySlug = new Map();
  for (const q of queries) {
    try {
      const data = await fetchJsonSafe(
        `${DESI_BASE}/wp-json/kiranime/v1/anime/search?query=${encodeURIComponent(q)}`,
        { headers: { Referer: `${DESI_BASE}/` }, timeoutMs: 11000 },
      );
      const links = extractAnimeLinksFromSearch(data?.result || "");
      for (const item of links) {
        if (!candidatesBySlug.has(item.slug)) {
          candidatesBySlug.set(item.slug, item);
        }
      }
      if (candidatesBySlug.size > 0) {
        const top = [...candidatesBySlug.values()]
          .map((c) => ({ c, s: scoreAnimeCandidate(c, allTitles, { isMovie }) }))
          .sort((a, b) => b.s - a.s)[0];
        if (top && top.s >= 110) {
          searchMemo.set(sKey, { at: Date.now(), v: top.c });
          return top.c;
        }
      }
    } catch {
      /* try next query variation */
    }
  }

  const ranked = [...candidatesBySlug.values()]
    .map((c) => ({ c, s: scoreAnimeCandidate(c, allTitles, { isMovie }) }))
    .sort((a, b) => b.s - a.s);

  const picked = ranked[0] && ranked[0].s >= 50 ? ranked[0].c : null;
  if (picked) searchMemo.set(sKey, { at: Date.now(), v: picked });
  return picked;
}

async function getAnimePageMetaCached(animeUrl) {
  const hit = animeMetaMemo.get(animeUrl);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.v;
  const html = await fetchText(animeUrl, { headers: { Referer: `${DESI_BASE}/` }, timeoutMs: 13000 });
  const meta = parseAnimePageMeta(html);
  if (meta?.postId || meta?.watchLinks?.length > 0) {
    animeMetaMemo.set(animeUrl, { at: Date.now(), v: meta });
  }
  return meta;
}

async function resolveWatchPageUrl({ animeUrl, episode, isMovie, title, romajiTitle }) {
  const meta = await getAnimePageMetaCached(animeUrl);

  const inlineHit = pickInlineWatchUrl(meta.watchLinks, episode, isMovie);
  if (inlineHit) return inlineHit;

  // Determine active season postId (multi-season anime pages list season tabs with data-season)
  let targetSeasonId = meta.postId;
  const explicitSeason = extractSeasonNumber(title) || extractSeasonNumber(romajiTitle);
  const wantSeason = explicitSeason || 1;
  if (meta.seasons.length > 1) {
    const seasonMatch = meta.seasons.find((s) => extractSeasonNumber(s.label) === wantSeason);
    if (seasonMatch?.id) {
      targetSeasonId = seasonMatch.id;
    } else if (explicitSeason && explicitSeason > 1) {
      const candidateSeason = extractSeasonNumber(animeUrl);
      if (candidateSeason !== explicitSeason) return null;
    }
  }

  if (!targetSeasonId) return null;

  const pageNum = Math.max(1, Math.ceil(episode / 12));
  const pagesToTry = pageNum > 1 ? [pageNum, Math.max(1, pageNum - 1), 1] : [1];
  const triedPages = new Set();

  for (const p of pagesToTry) {
    if (triedPages.has(p)) continue;
    triedPages.add(p);
    try {
      const ajaxRes = await fetchJsonSafe(
        `${DESI_BASE}/wp-admin/admin-ajax.php?action=get_episodes&anime_id=${encodeURIComponent(targetSeasonId)}&page=${p}&order=asc`,
        {
          headers: { Referer: animeUrl, "X-Requested-With": "XMLHttpRequest" },
          timeoutMs: 10000,
        },
      );
      const eps = ajaxRes?.data?.episodes || [];
      const found = pickEpisodeFromAjax(eps, episode, isMovie);
      if (found) return found;

      // Handle offset seasons where S2 ep 1..13 is numbered 13..25 on page 1..2
      const firstNum = parseInt(String(eps[0]?.number || ""), 10);
      if (p === 1 && Number.isFinite(firstNum) && firstNum > 1 && episode > 12) {
        const offsetPage = Math.ceil((firstNum + episode - 1) / 12);
        if (!triedPages.has(offsetPage)) {
          triedPages.add(offsetPage);
          const offsetRes = await fetchJsonSafe(
            `${DESI_BASE}/wp-admin/admin-ajax.php?action=get_episodes&anime_id=${encodeURIComponent(targetSeasonId)}&page=${offsetPage}&order=asc`,
            { headers: { Referer: animeUrl, "X-Requested-With": "XMLHttpRequest" }, timeoutMs: 10000 },
          );
          const offsetUrl = pickEpisodeFromAjax(offsetRes?.data?.episodes || [], firstNum + episode - 1, isMovie);
          if (offsetUrl) return offsetUrl;
        }
      }
    } catch {
      /* try fallback page */
    }
  }
  return null;
}

export async function resolveDesiDubAnime({
  anilistId = 0,
  episode = 1,
  title = "",
  romajiTitle = "",
  synonyms = [],
  format = "",
} = {}) {
  const ep = Math.max(1, Number(episode) || 1);
  const isMovie = String(format || "").toUpperCase() === "MOVIE";
  const cacheKey = `desi:v1:${anilistId}:${ep}:${normalizeDesiTitle(title)}:${isMovie ? "m" : "tv"}`;

  const hit = resolveMemo.get(cacheKey);
  if (hit && Date.now() - hit.at < 20 * 60e3) return hit.v;

  const pending = resolveInflight.get(cacheKey);
  if (pending) return pending;

  const task = (async () => {
    const candidate = await searchBestAnimeCandidate({ title, romajiTitle, synonyms, format });
    if (!candidate) return null;

    const watchUrl = await resolveWatchPageUrl({
      animeUrl: candidate.url,
      episode: ep,
      isMovie,
      title,
      romajiTitle,
    });
    if (!watchUrl) return null;

    const watchHtml = await fetchText(watchUrl, { headers: { Referer: candidate.url }, timeoutMs: 10000 });
    const embeds = extractEmbedEntriesFromHtml(watchHtml);
    if (embeds.length === 0) return null;

    for (const emb of embeds) {
      try {
        const embHtml = await fetchText(emb.url, { headers: { Referer: watchUrl }, timeoutMs: 9000 });
        const media = extractMediaFromEmbedHtml(emb.url, embHtml);
        if (!media.streamUrl) continue;

        let referer = emb.url;
        try {
          referer = `${new URL(emb.url).origin}/`;
        } catch {}

        const ok = await verifyHlsStream(media.streamUrl, referer);
        if (!ok) continue;

        const out = {
          server: "DesiDubAnime",
          audio: "dub",
          audioLabel: "Hindi (Dub)",
          multiAudio: false,
          hindiOnly: true,
          languages: ["Hindi"],
          format: "hls",
          streamUrl: media.streamUrl,
          referer,
          subtitles: media.subtitles || [],
        };
        resolveMemo.set(cacheKey, { at: Date.now(), v: out });
        return out;
      } catch {
        /* try next embed server */
      }
    }

    return null;
  })().finally(() => {
    resolveInflight.delete(cacheKey);
  });

  resolveInflight.set(cacheKey, task);
  return task;
}

export function computeHindiEpisodeCount({
  page1Episodes = [],
  maxPages = 1,
  lastPageEpisodes = [],
  inlineWatchLinks = [],
  totalEpisodes = 0,
  isMovie = false,
} = {}) {
  const total = Math.max(0, parseInt(totalEpisodes, 10) || 0);
  const eps1 = Array.isArray(page1Episodes) ? page1Episodes : [];
  const epsLast = Array.isArray(lastPageEpisodes) ? lastPageEpisodes : [];
  const inline = Array.isArray(inlineWatchLinks) ? inlineWatchLinks : [];

  if (isMovie) {
    return eps1.length > 0 || inline.length > 0 ? 1 : 0;
  }

  let rawCount = 0;
  const pages = Math.max(1, parseInt(maxPages, 10) || 1);
  if (pages > 1 && eps1.length > 0) {
    const perPage = eps1.length;
    const lastLen = epsLast.length > 0 ? epsLast.length : perPage;
    rawCount = (pages - 1) * perPage + lastLen;
  } else if (eps1.length > 0) {
    rawCount = eps1.length;
  } else if (inline.length > 0) {
    rawCount = inline.length;
  }

  if (rawCount <= 0) return 0;
  return total > 0 ? Math.min(total, rawCount) : rawCount;
}

export async function getDesiDubEpisodeSummary({
  anilistId = 0,
  title = "",
  romajiTitle = "",
  synonyms = [],
  format = "",
  totalEpisodes = 0,
} = {}) {
  const isMovie = String(format || "").toUpperCase() === "MOVIE";
  const cacheKey = `desi-summary:v1:${anilistId}:${totalEpisodes}:${normalizeDesiTitle(title)}:${normalizeDesiTitle(romajiTitle)}:${isMovie ? "m" : "tv"}`;

  const hit = resolveMemo.get(cacheKey);
  if (hit && Date.now() - hit.at < 20 * 60e3) return hit.v;

  const pending = resolveInflight.get(cacheKey);
  if (pending) return pending;

  const task = (async () => {
    try {
      const candidate = await searchBestAnimeCandidate({ title, romajiTitle, synonyms, format });
      if (!candidate) {
        const empty = { available: false, episodeCount: 0 };
        resolveMemo.set(cacheKey, { at: Date.now(), v: empty });
        return empty;
      }

      const meta = await getAnimePageMetaCached(candidate.url);
      let targetSeasonId = meta.postId;
      const explicitSeason = extractSeasonNumber(title) || extractSeasonNumber(romajiTitle);
      const wantSeason = explicitSeason || 1;
      if (meta.seasons.length > 1) {
        const seasonMatch = meta.seasons.find((s) => extractSeasonNumber(s.label) === wantSeason);
        if (seasonMatch?.id) {
          targetSeasonId = seasonMatch.id;
        } else if (explicitSeason && explicitSeason > 1) {
          const candidateSeason = extractSeasonNumber(`${candidate.title || ""} ${candidate.slug || ""}`);
          if (candidateSeason !== explicitSeason) {
            const empty = { available: false, episodeCount: 0 };
            resolveMemo.set(cacheKey, { at: Date.now(), v: empty });
            return empty;
          }
        }
      }

      let eps1 = [];
      let epsLast = [];
      let maxPages = 1;

      if (targetSeasonId) {
        try {
          const ajax1 = await fetchJsonSafe(
            `${DESI_BASE}/wp-admin/admin-ajax.php?action=get_episodes&anime_id=${encodeURIComponent(targetSeasonId)}&page=1&order=asc`,
            { headers: { Referer: candidate.url, "X-Requested-With": "XMLHttpRequest" }, timeoutMs: 9000 },
          );
          eps1 = ajax1?.data?.episodes || [];
          maxPages = Math.max(1, parseInt(ajax1?.data?.max_episodes_page, 10) || 1);

          if (!isMovie && maxPages > 1 && eps1.length > 0) {
            const ajaxLast = await fetchJsonSafe(
              `${DESI_BASE}/wp-admin/admin-ajax.php?action=get_episodes&anime_id=${encodeURIComponent(targetSeasonId)}&page=${maxPages}&order=asc`,
              { headers: { Referer: candidate.url, "X-Requested-With": "XMLHttpRequest" }, timeoutMs: 9000 },
            );
            epsLast = ajaxLast?.data?.episodes || [];
          }
        } catch {
          /* fall back to inline links if AJAX fails */
        }
      }

      const episodeCount = computeHindiEpisodeCount({
        page1Episodes: eps1,
        maxPages,
        lastPageEpisodes: epsLast,
        inlineWatchLinks: meta.watchLinks,
        totalEpisodes,
        isMovie,
      });

      const out = { available: episodeCount > 0, episodeCount };
      resolveMemo.set(cacheKey, { at: Date.now(), v: out });
      return out;
    } catch {
      return { available: false, episodeCount: 0 };
    }
  })().finally(() => {
    resolveInflight.delete(cacheKey);
  });

  resolveInflight.set(cacheKey, task);
  return task;
}

export async function checkDesiDubAvailability({
  anilistId = 0,
  episode = 1,
  title = "",
  romajiTitle = "",
  format = "",
  totalEpisodes = 0,
} = {}) {
  const key = `desi-avail:v2:${anilistId}:${episode}:${normalizeDesiTitle(title)}:${normalizeDesiTitle(romajiTitle)}:${format || ""}`;
  const hit = resolveMemo.get(key);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.v;

  try {
    const isMovie = String(format || "").toUpperCase() === "MOVIE";
    const candidate = await searchBestAnimeCandidate({ title, romajiTitle, format });
    if (!candidate) {
      const miss = { sub: false, dub: false, multi: false, languages: [] };
      resolveMemo.set(key, { at: Date.now(), v: miss });
      return miss;
    }

    const [watchUrl, summary] = await Promise.all([
      resolveWatchPageUrl({ animeUrl: candidate.url, episode, isMovie, title, romajiTitle }).catch(() => null),
      getDesiDubEpisodeSummary({ anilistId, title, romajiTitle, format, totalEpisodes }).catch(() => ({
        available: false,
        episodeCount: 0,
      })),
    ]);

    let hasEpisodeDub = Boolean(watchUrl);
    if (watchUrl) {
      try {
        const watchHtml = await fetchText(watchUrl, { headers: { Referer: candidate.url }, timeoutMs: 8500 });
        const embeds = extractEmbedEntriesFromHtml(watchHtml);
        hasEpisodeDub = embeds.length > 0;
      } catch {
        hasEpisodeDub = true;
      }
    }

    const avail = hasEpisodeDub
      ? {
          sub: false,
          dub: true,
          dubVerified: true,
          multi: false,
          languages: ["Hindi"],
          ...(summary.episodeCount > 0 ? { episodeCount: summary.episodeCount } : {}),
        }
      : { sub: false, dub: false, multi: false, languages: [] };
    resolveMemo.set(key, { at: Date.now(), v: avail });
    return avail;
  } catch {
    return { sub: false, dub: false, multi: false, languages: [] };
  }
}
