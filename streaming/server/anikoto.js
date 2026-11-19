// Direct stream extractor for https://anikoto.cz (English Dub & Sub)
// Extracts direct HLS (.m3u8) streams, subtitles, and intro/outro timestamps
// so playback runs natively inside CinePlayer without an external embed iframe.

import { fetchTimeout } from "./fetchTimeout.js";

const BASE_URL = "https://anikoto.cz";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MEGAPLAY_RAW_KEY = new TextEncoder().encode("i?LMTAx0Q6,:}50U");
const MEGAPLAY_FULL_KEY = new Uint8Array(32);
MEGAPLAY_FULL_KEY.set(MEGAPLAY_RAW_KEY);
const MEGAPLAY_IV = new TextEncoder().encode("W0;27ToaUpl_P%'c");

const searchCache = new Map();
const showCache = new Map();
const availCache = new Map();
const resolveCache = new Map();
const inflight = new Map();

function decodeHtml(str = "") {
  return String(str || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanAnikotoTitle(str = "") {
  return decodeHtml(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*\(\d{4}\)\s*$/g, "")
    .replace(/\s*[:\-–]\s*(?:season|series|part|cour)\s+\d+.*$/gi, "")
    .replace(/\s+(?:season|series|part|cour)\s+\d+.*$/gi, "")
    .replace(/\s+\d+(?:st|nd|rd|th)\s+season.*$/gi, "")
    .replace(/\s*[:\-–]?\s*final\s+season.*$/gi, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSeasonNum(title = "", romaji = "") {
  const txt = `${title || ""} ${romaji || ""}`;
  const m =
    txt.match(/\b(?:season|series|part|s)\s*(\d+)\b/i) ||
    txt.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
  if (m?.[1]) return parseInt(m[1], 10);
  if (/\b(?:II|2)\s*$/i.test(String(title || "").trim())) return 2;
  if (/\b(?:III|3)\s*$/i.test(String(title || "").trim())) return 3;
  if (/\b(?:IV|4)\s*$/i.test(String(title || "").trim())) return 4;
  return 1;
}

const isCaption = (t) => !/thumbnail/i.test(`${t?.kind || ""} ${t?.label || ""}`) && (t?.file || t?.url);

function captions(tracks, base) {
  return (tracks || []).filter(isCaption).map((t) => {
    const raw = t.file || t.url;
    let file = raw;
    try {
      file = new URL(raw, base).href;
    } catch {}
    return { file, label: t.label || "English", default: !!t.default };
  });
}

async function decryptPlayerEnc(encValue) {
  try {
    const bin = atob(encValue.replace(/-/g, "+").replace(/_/g, "/"));
    const encBuf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) encBuf[i] = bin.charCodeAt(i);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      MEGAPLAY_FULL_KEY,
      { name: "AES-CBC" },
      false,
      ["decrypt"],
    );
    const dec = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: MEGAPLAY_IV },
      cryptoKey,
      encBuf,
    );
    const text = new TextDecoder().decode(dec);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return text.startsWith("http") ? { url: text.trim() } : null;
    }
    if (Array.isArray(parsed)) {
      const url = parsed[0]?.file || parsed[0]?.url || null;
      return url ? { url } : null;
    }
    const url =
      parsed?.file ||
      parsed?.url ||
      (typeof parsed === "string" && parsed.startsWith("http") ? parsed : null);
    return url ? { url, tracks: parsed.tracks, intro: parsed.intro, outro: parsed.outro } : null;
  } catch {
    return null;
  }
}

async function fetchPlayerMeta(pageUrl, html, fileId) {
  const out = { tracks: [], intro: null, outro: null };
  try {
    const page = new URL(pageUrl);
    const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => new URL(m[1], page).href);
    const scripts = await Promise.all(
      srcs.slice(0, 8).map((u) =>
        fetchTimeout(u, { headers: { "User-Agent": UA, Referer: page.href }, timeoutMs: 3000 })
          .then((r) => (r.ok ? r.text() : ""))
          .catch(() => ""),
      ),
    );
    const script = scripts.find((s) => /getSources/i.test(s)) || "";
    const routes = [...new Set([...script.matchAll(/[\w/-]*stream\/getSources[\w/-]*/g)].map((m) => m[0]))].sort(
      (a, b) => a.length - b.length,
    );
    const modern = routes.find((r) => r !== routes[0] && r.startsWith(routes[0]));
    for (const route of [modern, routes[0]].filter(Boolean)) {
      const u = new URL(route.startsWith("/") ? route : `/${route}`, page.origin);
      u.searchParams.set("id", fileId);
      const d = await fetchTimeout(u.href, {
        headers: {
          "User-Agent": UA,
          Referer: page.href,
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json,*/*",
        },
        timeoutMs: 3500,
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!d) continue;
      if (!out.tracks.length && Array.isArray(d.tracks)) out.tracks = d.tracks;
      out.intro ??= d.intro || null;
      out.outro ??= d.outro || null;
    }
  } catch {}
  return out;
}

export function parseAnikotoSearchHtml(html = "") {
  const results = [];
  const seen = new Set();
  const itemChunks = html.split(/<div\s+class="item\s*">/i).slice(1);

  for (const chunk of itemChunks) {
    const cardEnd = chunk.indexOf('id="footer"');
    const block = cardEnd > 0 ? chunk.slice(0, cardEnd) : chunk;
    const hrefMatch = block.match(/href=["'](https?:\/\/[^"']+\/watch\/([^"'/]+)(?:\/[^"']*)?)["']/i);
    if (!hrefMatch) continue;
    const watchHref = hrefMatch[1];
    const slug = hrefMatch[2];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const nameMatch = block.match(/<a[^>]+class=["'][^"']*name[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const altMatch = block.match(/alt=["']([^"']+)["']/i);
    const jpMatch = block.match(/data-jp=["']([^"']+)["']/i);
    const fmtMatch = block.match(/<div\s+class="right">([^<]+)<\/div>/i);
    const subMatch = block.match(/class="ep-status\s+sub"[^>]*>\s*<span>\s*(\d+)/i);
    const dubMatch = block.match(/class="ep-status\s+dub"[^>]*>\s*<span>\s*(\d+)/i);

    const title = decodeHtml(nameMatch?.[1]?.replace(/<[^>]+>/g, "") || altMatch?.[1] || slug.replace(/-/g, " "));
    const jpTitle = decodeHtml(jpMatch?.[1] || "");
    const format = decodeHtml(fmtMatch?.[1] || "").toUpperCase();
    const subCount = subMatch ? parseInt(subMatch[1], 10) : 0;
    const dubCount = dubMatch ? parseInt(dubMatch[1], 10) : 0;

    results.push({
      slug,
      watchUrl: `${BASE_URL}/watch/${slug}`,
      watchHref,
      title,
      jpTitle,
      format,
      isMovie: format === "MOVIE",
      subCount,
      dubCount,
    });
  }
  return results;
}

export async function searchAnikoto(query = "") {
  const q = String(query || "").trim();
  if (!q) return [];
  const key = q.toLowerCase();
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < 15 * 60e3) return cached.items;

  try {
    const url = `${BASE_URL}/filter?keyword=${encodeURIComponent(q)}`;
    const res = await fetchTimeout(url, {
      headers: { "User-Agent": UA, Referer: `${BASE_URL}/`, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      timeoutMs: 6500,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const items = parseAnikotoSearchHtml(html);
    searchCache.set(key, { at: Date.now(), items });
    return items;
  } catch {
    return [];
  }
}

export function pickBestAnikotoMatch(
  candidates = [],
  { title = "", romajiTitle = "", isMovie = false, season = 0, audio = "dub" } = {},
) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const wantAudio = String(audio || "dub").toLowerCase();
  const wantMovie = Boolean(isMovie);
  const wantSeason = season > 0 ? season : extractSeasonNum(title, romajiTitle);
  const hasExplicitSeason =
    wantSeason > 1 ||
    /\b(?:season|series|part|s)\s*[2-9]\d*\b|\b[2-9]\d*(?:st|nd|rd|th)\s+season\b|\b(?:II|III|IV)\s*$/i.test(
      `${title} ${romajiTitle}`,
    );

  const targets = [
    ...new Set([cleanAnikotoTitle(title), cleanAnikotoTitle(romajiTitle)].filter(Boolean)),
  ];
  const rawTargets = [title, romajiTitle].filter(Boolean).map((s) => decodeHtml(s).toLowerCase().trim());
  if (targets.length === 0) return null;

  let best = null;
  let highestScore = -Infinity;

  for (const c of candidates) {
    const cRawNames = [c.title, c.jpTitle].filter(Boolean).map((s) => decodeHtml(s).toLowerCase().trim());
    const cCleanNames = [cleanAnikotoTitle(c.title), cleanAnikotoTitle(c.jpTitle)].filter(Boolean);
    if (cCleanNames.length === 0) continue;

    const candHasSeason =
      /\b(?:season|series|part|s)\s*(\d+)\b|\b(\d+)(?:st|nd|rd|th)\s+season\b|\b(?:II|III|IV)\s*$/i.test(
        `${c.title} ${c.jpTitle}`,
      );
    const candSeason = candHasSeason ? extractSeasonNum(c.title, c.jpTitle) : 1;

    let bestForCand = -Infinity;
    for (let i = 0; i < targets.length; i++) {
      const targetBase = targets[i];
      const targetWords = targetBase.split(/\s+/).filter((w) => w.length > 1 && w !== "movie");

      for (let j = 0; j < cCleanNames.length; j++) {
        const candClean = cCleanNames[j];
        const candWords = candClean.split(/\s+/).filter((w) => w.length > 1 && w !== "movie");
        let score = Boolean(c.isMovie) === wantMovie ? 45 : -80;

        if (rawTargets.some((rt) => cRawNames.some((cr) => cr === rt))) {
          score += 110;
        } else if (candClean === targetBase) {
          score += 85;
        } else if (candClean.includes(targetBase)) {
          score += 35;
        } else if (targetBase.includes(candClean) && candWords.length >= 2) {
          score += 22;
        }

        const common = candWords.filter((w) => targetWords.includes(w)).length;
        const missing = targetWords.filter((w) => !candWords.includes(w)).length;
        const extra = candWords.filter(
          (w) => !targetWords.includes(w) && !["the", "of", "and", "in", "a", "an", "to"].includes(w),
        ).length;

        score += common * 16;
        score -= missing * 16;
        if (candClean !== targetBase) {
          score -= extra * (targetWords.length <= 1 ? 35 : 10);
        }

        if (hasExplicitSeason && candHasSeason) {
          score += candSeason === wantSeason ? 40 : -60;
        } else if (!hasExplicitSeason && candHasSeason && candSeason > 1) {
          score -= 42;
        } else if (hasExplicitSeason && !candHasSeason && wantSeason > 1) {
          score -= 32;
        }

        // Penalize specials/OVAs/recaps when we want main TV or Movie
        if (!wantMovie && /\b(?:special|ova|recap)\b/i.test(`${c.title} ${c.format}`) && !/\b(?:special|ova)\b/i.test(title)) {
          score -= 35;
        }

        if (wantAudio === "dub") {
          score += c.dubCount > 0 ? 30 : -30;
        } else {
          score += c.subCount > 0 ? 15 : -20;
        }

        if (score > bestForCand) bestForCand = score;
      }
    }

    if (bestForCand > highestScore) {
      highestScore = bestForCand;
      best = c;
    }
  }

  return highestScore >= 35 ? best : null;
}

async function fetchAnikotoEpisodeServers(slug, episode = 1) {
  const key = `ep:${slug}:${episode}`;
  const hit = showCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.data;

  const watchUrl = `${BASE_URL}/watch/${slug}/ep-${episode}`;
  const wRes = await fetchTimeout(watchUrl, {
    headers: { "User-Agent": UA, Referer: `${BASE_URL}/` },
    redirect: "follow",
    timeoutMs: 6500,
  });
  if (!wRes.ok) return null;
  const wHtml = await wRes.text();
  const sidMatch = wHtml.match(/data-id=["'](\d+)["']/);
  if (!sidMatch?.[1]) return null;

  const epListRes = await fetchTimeout(`${BASE_URL}/ajax/episode/list/${sidMatch[1]}`, {
    headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", Referer: watchUrl },
    timeoutMs: 6500,
  });
  if (!epListRes.ok) return null;
  const epJson = await epListRes.json().catch(() => null);
  const epHtml = String(epJson?.result || "");
  if (!epHtml) return null;

  const epRegex = new RegExp(
    `<a\\s+[^>]*data-ids=["']([^"']+)["'][^>]*data-num=["']${episode}["']|<a\\s+[^>]*data-num=["']${episode}["'][^>]*data-ids=["']([^"']+)["']`,
    "i",
  );
  let epMatch = epHtml.match(epRegex);
  if (!epMatch && episode === 1) {
    epMatch = epHtml.match(/<a\s+[^>]*data-ids=["']([^"']+)["']/i);
  }
  const serverIds = epMatch?.[1] || epMatch?.[2];
  if (!serverIds) return null;

  const srvRes = await fetchTimeout(`${BASE_URL}/ajax/server/list?servers=${encodeURIComponent(serverIds)}`, {
    headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", Referer: watchUrl },
    timeoutMs: 6500,
  });
  if (!srvRes.ok) return null;
  const srvJson = await srvRes.json().catch(() => null);
  const srvHtml = String(srvJson?.result || "");
  if (!srvHtml) return null;

  const extractList = (aud) => {
    const sec = srvHtml.match(new RegExp(`data-type=["']${aud}["'][\\s\\S]*?<\\/ul>`, "i"))?.[0] || "";
    const out = [];
    for (const m of sec.matchAll(/<li\b[^>]*data-link-id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi)) {
      const linkId = m[1];
      const name = decodeHtml(m[2].replace(/<[^>]+>/g, ""));
      if (linkId) out.push({ linkId, name: name || "Server" });
    }
    return out;
  };

  const data = {
    watchUrl,
    sub: extractList("sub"),
    dub: extractList("dub"),
  };
  showCache.set(key, { at: Date.now(), data });
  return data;
}

async function resolveEmbedUrlToDirect(embedUrl, watchUrl) {
  let parsedEmbed;
  try {
    parsedEmbed = new URL(embedUrl);
  } catch {
    return null;
  }

  const pageRes = await fetchTimeout(embedUrl, {
    headers: { "User-Agent": UA, Referer: watchUrl || `${BASE_URL}/` },
    redirect: "follow",
    timeoutMs: 6000,
  });
  if (!pageRes.ok) return null;
  const html = await pageRes.text();
  const fileId = html.match(/data-id=["']([^"']+)["']/)?.[1];
  if (!fileId) return null;

  const sParam = parsedEmbed.searchParams.get("s");
  const getSourcesPath = /\/stream\//i.test(parsedEmbed.pathname)
    ? parsedEmbed.pathname.replace(/\/stream\/.*$/, "/stream/getSources")
    : "/stream/getSources";

  const srcUrl = new URL(getSourcesPath, parsedEmbed.origin);
  srcUrl.searchParams.set("id", fileId);
  if (sParam) srcUrl.searchParams.set("s", sParam);

  const srcRes = await fetchTimeout(srcUrl.href, {
    headers: {
      "User-Agent": UA,
      Referer: embedUrl,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json,*/*",
    },
    timeoutMs: 6000,
  });
  if (!srcRes.ok) return null;
  const data = await srcRes.json().catch(() => null);
  if (!data) return null;

  let streamUrl = null;
  let enc = null;
  if (data.enc) {
    enc = await decryptPlayerEnc(data.enc);
    streamUrl = enc?.url ?? null;
  }
  if (!streamUrl && data.sources) {
    streamUrl = Array.isArray(data.sources)
      ? data.sources[0]?.file || data.sources[0]?.url
      : data.sources?.file || (typeof data.sources === "string" ? data.sources : null);
  }
  if (!streamUrl || !streamUrl.startsWith("http")) return null;

  const referer = `${parsedEmbed.origin}/`;

  // Verify manifest actually serves valid #EXTM3U before accepting this server
  try {
    const checkRes = await fetchTimeout(streamUrl, {
      headers: { "User-Agent": UA, Referer: referer, Accept: "*/*" },
      timeoutMs: 4500,
    });
    if (!checkRes.ok) return null;
    const headTxt = await checkRes.text();
    if (!headTxt.trimStart().startsWith("#EXTM3U")) return null;
  } catch {
    return null;
  }

  let subtitles = captions(data.tracks?.length ? data.tracks : enc?.tracks, embedUrl);
  let meta = null;
  if (!subtitles.length || (!data.intro && !enc?.intro)) {
    meta = await fetchPlayerMeta(embedUrl, html, fileId);
    if (!subtitles.length) subtitles = captions(meta.tracks, embedUrl);
  }

  return {
    streamUrl,
    referer,
    subtitles,
    intro: data.intro || enc?.intro || meta?.intro || null,
    outro: data.outro || enc?.outro || meta?.outro || null,
  };
}

async function findMatchingSlug({ title = "", romajiTitle = "", format = "", season = 0, audio = "dub" }) {
  const isMovie = String(format || "").toUpperCase() === "MOVIE";
  const colonTail = String(title || "").includes(":") ? String(title).split(":").slice(1).join(":").trim() : "";
  const noMovieTag = String(title || "").replace(/[-–:]*\s*the\s+movie\b/gi, "").replace(/\s+/g, " ").trim();
  const queries = [
    ...new Set(
      [title, noMovieTag, romajiTitle, cleanAnikotoTitle(title), cleanAnikotoTitle(romajiTitle), colonTail]
        .map((s) => String(s || "").trim())
        .filter((s) => s.length >= 2),
    ),
  ];

  const allCandidates = [];
  const seenSlugs = new Set();

  for (const q of queries.slice(0, 4)) {
    const items = await searchAnikoto(q);
    for (const item of items) {
      if (!seenSlugs.has(item.slug)) {
        seenSlugs.add(item.slug);
        allCandidates.push(item);
      }
    }
    const immediate = pickBestAnikotoMatch(allCandidates, {
      title,
      romajiTitle,
      isMovie,
      season,
      audio,
    });
    if (immediate && Boolean(immediate.isMovie) === isMovie && (audio !== "dub" || immediate.dubCount > 0)) {
      return immediate;
    }
  }

  return pickBestAnikotoMatch(allCandidates, { title, romajiTitle, isMovie, season, audio });
}

export async function resolveAnikoto({
  anilistId = 0,
  episode = 1,
  title = "",
  romajiTitle = "",
  format = "",
  audio = "dub",
  season = 0,
} = {}) {
  const targetAudio = String(audio || "dub").toLowerCase() === "sub" ? "sub" : "dub";
  const cacheKey = `anikoto:${anilistId}:${episode}:${targetAudio}:${format}:${title}:${romajiTitle}`;
  const hit = resolveCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 12 * 60e3) return hit.val;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const task = (async () => {
    try {
      const match = await findMatchingSlug({ title, romajiTitle, format, season, audio: targetAudio });
      if (!match?.slug) return null;

      const epServers = await fetchAnikotoEpisodeServers(match.slug, episode);
      if (!epServers) return null;

      const serverList = targetAudio === "dub" ? epServers.dub : epServers.sub;
      if (!serverList || serverList.length === 0) return null;

      // Prioritize Vidstream-2 / HD-1 / Vidstream-1 / VidPlay / HD-2 reliably
      const priority = ["hd-1", "vidstream-2", "vidstream-1", "vidplay", "hd-2"];
      const ordered = [...serverList].sort((a, b) => {
        const ai = priority.findIndex((p) => a.name.toLowerCase().includes(p));
        const bi = priority.findIndex((p) => b.name.toLowerCase().includes(p));
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });

      for (const srv of ordered) {
        try {
          const gRes = await fetchTimeout(
            `${BASE_URL}/ajax/server?get=${encodeURIComponent(srv.linkId)}`,
            {
              headers: {
                "User-Agent": UA,
                "X-Requested-With": "XMLHttpRequest",
                Referer: epServers.watchUrl,
              },
              timeoutMs: 5500,
            },
          );
          if (!gRes.ok) continue;
          const gJson = await gRes.json().catch(() => null);
          const embedUrl = gJson?.result?.url;
          if (!embedUrl || !embedUrl.startsWith("http")) continue;

          const direct = await resolveEmbedUrlToDirect(embedUrl, epServers.watchUrl);
          if (direct?.streamUrl) {
            const val = {
              server: "Anikoto",
              anikotoServer: srv.name,
              slug: match.slug,
              audio: targetAudio,
              streamUrl: direct.streamUrl,
              referer: direct.referer,
              subtitles: direct.subtitles,
              intro: direct.intro,
              outro: direct.outro,
            };
            resolveCache.set(cacheKey, { at: Date.now(), val });
            return val;
          }
        } catch {}
      }
      return null;
    } catch {
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, task);
  return task;
}

export async function checkAnikotoAvailability({
  episode = 1,
  title = "",
  romajiTitle = "",
  format = "",
  season = 0,
  country = "JP",
} = {}) {
  const c = String(country || "JP").trim().toUpperCase();
  const isNonJpEastAsian = c === "CN" || c === "TW" || c === "HK" || c === "KR";
  const key = `avail:v2:${episode}:${season}:${format}:${c}:${title}:${romajiTitle}`;
  const hit = availCache.get(key);
  const hitTtl = hit?.val?.sub || hit?.val?.dub ? 15 * 60e3 : 90e3;
  if (hit && Date.now() - hit.at < hitTtl) return hit.val;

  const fallback = { sub: false, dub: false, dubVerified: false };
  try {
    const match = await findMatchingSlug({ title, romajiTitle, format, season, audio: "dub" });
    if (!match?.slug) {
      availCache.set(key, { at: Date.now(), val: fallback });
      return fallback;
    }
    const epServers = await fetchAnikotoEpisodeServers(match.slug, episode);
    const hasSub = Boolean(epServers?.sub?.length);
    const hasDubList = Boolean(epServers?.dub?.length);
    const subLinkIds = new Set((epServers?.sub || []).map((s) => s.linkId).filter(Boolean));
    const hasDistinctDub = hasDubList && (epServers?.dub || []).some((d) => d.linkId && !subLinkIds.has(d.linkId));
    const dubVerified = hasDubList && (!isNonJpEastAsian || hasDistinctDub);
    const val = {
      sub: hasSub,
      dub: dubVerified,
      dubVerified,
    };
    availCache.set(key, { at: Date.now(), val });
    return val;
  } catch {
    return fallback;
  }
}
