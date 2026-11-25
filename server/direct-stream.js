import { resolveAcdn } from "./acdn.js";
import { fetchTimeout } from "./fetchTimeout.js";
import {
  buildAcdnAvailability,
  getOriginalLanguageForCountry,
  isBlockedPlayerHost,
  parseHlsAudioLanguages,
} from "./audioAvailLogic.js";

const isCaption = (t) => !/thumbnail/i.test(`${t?.kind || ""} ${t?.label || ""}`) && (t?.file || t?.url);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const anikotoSiteCache = new Map();
const anikotoSiteInflight = new Map();

// MegaPlay AES Key & IV (as used in Zenkai Android AnikotoResolver)
const MEGAPLAY_RAW_KEY = new TextEncoder().encode("i?LMTAx0Q6,:}50U");
const MEGAPLAY_FULL_KEY = new Uint8Array(32);
MEGAPLAY_FULL_KEY.set(MEGAPLAY_RAW_KEY);
const MEGAPLAY_IV = new TextEncoder().encode("W0;27ToaUpl_P%'c");

async function decryptMegaPlayWeb(encValue) {
  try {
    const bin = atob(encValue.replace(/-/g, "+").replace(/_/g, "/"));
    const encBuf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) encBuf[i] = bin.charCodeAt(i);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      MEGAPLAY_FULL_KEY,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
    const dec = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: MEGAPLAY_IV },
      cryptoKey,
      encBuf
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
    const url = parsed?.file || parsed?.url || (typeof parsed === "string" && parsed.startsWith("http") ? parsed : null);
    return url ? { url, tracks: parsed.tracks, intro: parsed.intro, outro: parsed.outro } : null;
  } catch {
    return null;
  }
}

/** Captions as absolute urls (relative / protocol-relative ones resolve against the player origin). */
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

/**
 * MegaPlay serves captions (and intro/outro) from a newer getSources route than the one we decrypt.
 * Find both routes in the player script and merge whatever tracks they return.
 */
async function megaMeta(pageUrl, html, fileId) {
  const out = { tracks: [], intro: null, outro: null };
  try {
    const page = new URL(pageUrl);
    const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => new URL(m[1], page).href);
    const scripts = await Promise.all(
      srcs.map((u) =>
        fetchTimeout(u, { headers: { "User-Agent": UA, Referer: page.href }, timeoutMs: 4500 })
          .then((r) => (r.ok ? r.text() : ""))
          .catch(() => ""),
      ),
    );
    const script = scripts.find((s) => /getSources/i.test(s)) || "";
    const routes = [...new Set([...script.matchAll(/stream\/getSources[\w/-]*/g)].map((m) => m[0]))].sort((a, b) => a.length - b.length);
    const modern = routes.find((r) => r !== routes[0] && r.startsWith(routes[0]));
    for (const route of [modern, routes[0]].filter(Boolean)) {
      const u = new URL(route, page.origin);
      u.searchParams.append("id", fileId);
      u.searchParams.append("id", fileId);
      const d = await fetchTimeout(u, {
        headers: { "User-Agent": UA, Referer: page.href, "X-Requested-With": "XMLHttpRequest", Accept: "application/json,*/*" },
        timeoutMs: 4500,
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

// Anikoto Site Scraping Fallback (Tier 2 in Zenkai Android AnikotoResolver.kt)
export async function resolveFromAnikotoSite(animeTitle, episode = 1, audio = "sub", server = "bcdn") {
  if (!animeTitle) return null;
  const isDub = audio.toLowerCase() === "dub";
  const isVidstream = server.toLowerCase().includes("vidstream");
  const cacheKey = `${animeTitle.toLowerCase().trim()}:${episode}:${isDub ? "dub" : "sub"}:${isVidstream ? "vs" : "mp"}`;
  const cached = anikotoSiteCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60e3) return cached.val;
  if (anikotoSiteInflight.has(cacheKey)) return anikotoSiteInflight.get(cacheKey);

  const task = (async () => {
    const cleanTitle = animeTitle.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const titleKeywords = cleanTitle.split(/\s+/).filter(w => !['season', 'part', 'tv', '2nd', '3rd', '4th', 'the', 'of', 'in', 'and'].includes(w));

    for (const siteOrigin of ["https://anikoto.cz", "https://anikototv.bz"]) {
      try {
        const searchUrl = `${siteOrigin}/filter?keyword=${encodeURIComponent(animeTitle)}`;
        const searchRes = await fetchTimeout(searchUrl, {
          headers: { "User-Agent": UA, Referer: `${siteOrigin}/` },
          redirect: "follow",
          timeoutMs: 7500,
        });
        if (!searchRes.ok) continue;
        const searchHtml = await searchRes.text();

        // Extract candidate watch links ONLY from search results, matching title keywords (never side items)
        const searchCards = [...searchHtml.matchAll(/<div class="ani poster tip"[^>]*>[\s\S]*?<a href="https?:\/\/[^/"']+\/watch\/([^"\/]+)\/ep-1"[^>]*>[\s\S]*?alt="([^"]+)"/g)];
        let matchedSlug = null;

        for (const card of searchCards) {
          const cSlug = card[1].toLowerCase();
          const cName = card[2].toLowerCase();
          if (titleKeywords.length > 0 && titleKeywords.every(kw => cSlug.includes(kw) || cName.includes(kw))) {
            matchedSlug = card[1];
            break;
          }
        }
        if (!matchedSlug) continue;
        const slug = matchedSlug;

        const watchUrl = `${siteOrigin}/watch/${slug}`;
        const watchRes = await fetchTimeout(watchUrl, {
          headers: { "User-Agent": UA, Referer: `${siteOrigin}/` },
          redirect: "follow",
          timeoutMs: 7500,
        });
        if (!watchRes.ok) continue;
        const watchHtml = await watchRes.text();

        const showIdMatch = watchHtml.match(/data-id="(\d+)"/);
        if (!showIdMatch) continue;
        const showId = showIdMatch[1];

        const listRes = await fetchTimeout(`${siteOrigin}/ajax/episode/list/${showId}`, {
          headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", Referer: watchUrl },
          timeoutMs: 7500,
        });
        if (!listRes.ok) continue;
        const listJson = await listRes.json().catch(() => null);
        const listHtml = listJson?.result;
        if (!listHtml) continue;

        const epRegex = new RegExp(`<a\\s+[^>]*data-ids="([^"]+)"[^>]*data-num="${episode}"|<a\\s+[^>]*data-num="${episode}"[^>]*data-ids="([^"]+)"`, "i");
        const epMatch = listHtml.match(epRegex);
        if (!epMatch) continue;
        const serverIds = epMatch[1] || epMatch[2];

        const serverRes = await fetchTimeout(`${siteOrigin}/ajax/server/list?servers=${encodeURIComponent(serverIds)}`, {
          headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", Referer: watchUrl },
          timeoutMs: 7500,
        });
        if (!serverRes.ok) continue;
        const serverJson = await serverRes.json().catch(() => null);
        const serverHtml = serverJson?.result;
        if (!serverHtml) continue;

        // Filter section strictly for sub / dub
        const sectionMatch = isDub
          ? serverHtml.match(/data-type=["']dub["'][\s\S]*?<\/ul>/i)
          : serverHtml.match(/data-type=["']sub["'][\s\S]*?<\/ul>/i);
        if (!sectionMatch) continue;
        const secHtml = sectionMatch[0];

        let linkId = null;
        if (isVidstream) {
          const vm = secHtml.match(/<li\s+[^>]*data-link-id=["']([^"']+)["'][^>]*>(?:[^<]*Vidstream[^<]*)<\/li>/i)
                  || secHtml.match(/data-link-id=["']([^"']+)["'][^>]*>[^<]*vidstream/i);
          linkId = vm ? vm[1] : null;
        } else {
          const hm = secHtml.match(/<li\s+[^>]*data-link-id=["']([^"']+)["'][^>]*>(?:[^<]*HD-1[^<]*)<\/li>/i)
                  || secHtml.match(/data-link-id=["']([^"']+)["'][^>]*>[^<]*hd-1/i);
          linkId = hm ? hm[1] : null;
        }
        if (!linkId) continue;

        const embedRes = await fetchTimeout(`${siteOrigin}/ajax/server?get=${encodeURIComponent(linkId)}`, {
          headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", Referer: watchUrl },
          timeoutMs: 7500,
        });
        if (!embedRes.ok) continue;
        const embedJson = await embedRes.json().catch(() => null);
        const embedUrl = embedJson?.result?.url;
        if (!embedUrl || !embedUrl.includes("megaplay")) continue;

        const mRes = await fetchTimeout(embedUrl, {
          headers: { "User-Agent": UA, Referer: `${siteOrigin}/` },
          timeoutMs: 7500,
        });
        if (!mRes.ok) continue;
        const mHtml = await mRes.text();
        const mIdMatch = mHtml.match(/data-id=["']([^"']+)["']/);
        if (!mIdMatch) continue;
        const mId = mIdMatch[1];

        let srvParam = isVidstream ? "vidstream" : "bcdn";
        try {
          const parsedEmbed = new URL(embedUrl);
          const sVal = parsedEmbed.searchParams.get("s");
          if (sVal) srvParam = sVal;
        } catch {}

        const srcRes = await fetchTimeout(`https://megaplay.buzz/stream/getSources?id=${mId}&s=${srvParam}`, {
          headers: { "User-Agent": UA, Referer: embedUrl, "X-Requested-With": "XMLHttpRequest" },
          timeoutMs: 7500,
        });
        if (!srcRes.ok) continue;
        const data = await srcRes.json().catch(() => null);
        if (!data) continue;

        let streamUrl = null;
        let enc = null;
        if (data.enc) {
          enc = await decryptMegaPlayWeb(data.enc);
          streamUrl = enc?.url ?? null;
        }
        if (!streamUrl && data.sources) {
          streamUrl = Array.isArray(data.sources) ? data.sources[0]?.file : (data.sources.file || data.sources);
        }

        if (streamUrl) {
          let subtitles = captions(data.tracks?.length ? data.tracks : enc?.tracks, embedUrl);
          let meta = null;
          if (!subtitles.length) {
            meta = await megaMeta(embedUrl, mHtml, mId);
            subtitles = captions(meta.tracks, embedUrl);
          }
          const val = {
            server: isVidstream ? "Vidstream" : "MegaPlay",
            serverId: isVidstream ? `vidstream-direct-${audio}` : `megaplay-direct-${audio}`,
            streamUrl,
            audio,
            subtitles,
            intro: data.intro || enc?.intro || meta?.intro || null,
            outro: data.outro || enc?.outro || meta?.outro || null,
            referer: "https://megaplay.buzz/",
          };
          anikotoSiteCache.set(cacheKey, { at: Date.now(), val });
          return val;
        }
      } catch {
        // Transient timeout or host stall — try alternate domain cleanly
      }
    }
    return null;
  })();

  anikotoSiteInflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    anikotoSiteInflight.delete(cacheKey);
  }
}

// Resolve MegaPlay / Vidstream with 2-Tier Strategy
export async function resolveMegaPlay(anilistId, episode = 1, audio = "sub", serverParam = "bcdn", title = "") {
  const targetAudio = audio.toLowerCase() === "dub" ? "dub" : "sub";
  const srv = (serverParam || "bcdn").toLowerCase();

  // Tier 1: Client-Side Direct MegaPlay Extraction via AniList ID
  if (anilistId) {
    const srvList = [srv];

    for (const testSrv of srvList) {
      try {
        const pageUrl = `https://megaplay.buzz/stream/ani/${anilistId}/${episode}/${targetAudio}?s=${testSrv}`;
        const pageRes = await fetchTimeout(pageUrl, {
          headers: { "User-Agent": UA, Referer: "https://megaplay.buzz/" },
          timeoutMs: 8000,
        });

        if (pageRes.ok) {
          const html = await pageRes.text();
          const m = html.match(/data-id=["']([^"']+)["']/);
          if (m && m[1]) {
            const fileId = m[1];
            const srcRes = await fetchTimeout(`https://megaplay.buzz/stream/getSources?id=${fileId}&s=${testSrv}`, {
              headers: {
                "User-Agent": UA,
                Referer: pageUrl,
                "X-Requested-With": "XMLHttpRequest",
              },
              timeoutMs: 8000,
            });

            if (srcRes.ok) {
              const json = await srcRes.json();
              let streamUrl = null;
              let enc = null;

              if (json.enc) {
                enc = await decryptMegaPlayWeb(json.enc);
                streamUrl = enc?.url ?? null;
              }
              if (!streamUrl && json.sources) {
                streamUrl = Array.isArray(json.sources) ? json.sources[0]?.file : json.sources;
              }

              if (streamUrl) {
                const isVid = testSrv.includes("vidstream");
                let subtitles = captions(json.tracks?.length ? json.tracks : enc?.tracks, pageUrl);
                let meta = null;
                if (!subtitles.length) {
                  meta = await megaMeta(pageUrl, html, fileId);
                  subtitles = captions(meta.tracks, pageUrl);
                }
                return {
                  server: isVid ? "Vidstream" : "MegaPlay",
                  serverId: isVid ? `vidstream-direct-${targetAudio}` : `megaplay-direct-${targetAudio}`,
                  streamUrl,
                  audio: targetAudio,
                  subtitles,
                  intro: json.intro || enc?.intro || meta?.intro || null,
                  outro: json.outro || enc?.outro || meta?.outro || null,
                  referer: "https://megaplay.buzz/"
                };
              }
            }
          }
        }
      } catch {
        // Transient network / timeout on Tier 1 falls through cleanly to Tier 2 Anikoto fallback
      }
    }
  }

  // Tier 2: Anikoto TV Site Scraping Fallback using anime title
  if (title) {
    const siteRes = await resolveFromAnikotoSite(title, episode, targetAudio, srv);
    if (siteRes) return siteRes;
  }

  return null;
}

// Main Direct Resolver strictly supporting the 2 working Zenkai direct servers (MegaPlay & Vidstream)
export async function resolveDirectStreamWorker({ anilistId, episode = 1, audio = "sub", server = "megaplay", title = "" }) {
  const norm = (server || "megaplay").toLowerCase();
  const targetAudio = audio.toLowerCase() === "dub" ? "dub" : "sub";
  const isVidstream = norm.includes("vidstream") || norm === "hd2" || norm === "hd3";

  if (isVidstream) {
    return await resolveMegaPlay(anilistId, episode, targetAudio, "vidstream", title);
  }

  // MegaPlay default (bcdn) - no fallback to Vidstream
  return await resolveMegaPlay(anilistId, episode, targetAudio, "bcdn", title);
}


export async function checkEpisodeAudioAvailability(anilistId, episode, title, format = "", opts = {}) {
  const flixcloud = { sub: false, dub: false };
  const megaplay = { sub: false, dub: false };
  const vidstream = { sub: false, dub: false };
  const isMovie = String(format || "").toUpperCase() === "MOVIE";
  const countryOfOrigin = String(opts?.country || "").trim().toUpperCase() || "JP";
  const isDonghua = countryOfOrigin === "CN" || countryOfOrigin === "TW" || countryOfOrigin === "HK";
  const isNonJpEastAsian = isDonghua || countryOfOrigin === "KR";
  const originalLang = getOriginalLanguageForCountry(countryOfOrigin);

  const fetchVerifiedM3u8Text = async (streamUrl, referer) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const hdrs = { "User-Agent": UA, Accept: "*/*" };
        if (referer) {
          hdrs.Referer = referer;
          if (attempt === 1) hdrs.Origin = referer.replace(/\/$/, "");
        }
        const mr = await fetch(streamUrl, { headers: hdrs, signal: AbortSignal.timeout(4500) });
        if (mr.ok) {
          const txt = await mr.text();
          if (txt.trimStart().startsWith("#EXTM3U")) return txt;
        }
        if (mr.status === 404 || mr.status === 410) return null;
      } catch {}
      if (attempt < 1) await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  };

  const skipFlix = Boolean(opts?.skipFlix);
  const skipAcdn = Boolean(opts?.skipAcdn);

  const p1 = skipFlix
    ? Promise.resolve()
    : (async () => {
        if (!anilistId) return;
        try {
          const res = await fetch(`https://reanime.cz/api/flix/${anilistId}/${episode}`, {
            headers: { "User-Agent": UA, Accept: "application/json" },
            signal: AbortSignal.timeout(4500),
          });
          if (res.ok) {
            const json = await res.json();
            if (json?.success && Array.isArray(json.servers)) {
              const subLinks = new Set();
              const dubLinks = new Set();
              for (const s of json.servers) {
                const dt = (s.dataType || "").toLowerCase();
                const linkBase = (s.dataLink || "").split("?")[0];
                if (dt.includes("sub") || dt.includes("raw")) {
                  flixcloud.sub = true;
                  if (linkBase) subLinks.add(linkBase);
                }
                if (dt.includes("dub")) {
                  if (linkBase) dubLinks.add(linkBase);
                }
              }
              const hasDistinctDub = [...dubLinks].some((dl) => !subLinks.has(dl));
              if (dubLinks.size > 0 && (!isNonJpEastAsian || hasDistinctDub)) {
                flixcloud.dub = true;
                flixcloud.dubVerified = true;
              } else if (isNonJpEastAsian && (dubLinks.size > 0 || subLinks.size > 0)) {
                // FlixCloud frequently bundles both Native (Chinese/Korean) and English audio tracks
                // inside a single multi-audio HLS manifest under identical Reanime sub/dub embed URLs.
                try {
                  const { resolveFlixCloud } = await import("./flixcloud.js");
                  const flxHit = await Promise.race([
                    resolveFlixCloud({ anilistId, episode, audio: dubLinks.size > 0 ? "dub" : "sub", title }).catch(() => null),
                    new Promise((r) => setTimeout(() => r(null), 6000)),
                  ]);
                  if (flxHit?.streamUrl) {
                    const m3u8Text = await fetchVerifiedM3u8Text(flxHit.streamUrl, flxHit.referer || "https://flixcloud.cc/");
                    if (m3u8Text) {
                      const flxLangs = parseHlsAudioLanguages(m3u8Text, countryOfOrigin);
                      if (flixcloud.sub && !flxLangs.includes(originalLang)) {
                        flxLangs.unshift(originalLang);
                      }
                      if (flxLangs.length > 0) flixcloud.languages = flxLangs;
                      if (flxLangs.some((l) => l !== originalLang)) {
                        flixcloud.dub = true;
                        flixcloud.dubVerified = true;
                      }
                    }
                  }
                } catch {}
              }
            }
          }
        } catch {}
      })();

  const verifyMegaPlay = async (aud, srvParam) => {
    try {
      const pageUrl = `https://megaplay.buzz/stream/ani/${anilistId}/${episode}/${aud}?s=${srvParam}`;
      const r = await fetch(pageUrl, {
        headers: { "User-Agent": UA, "Referer": "https://megaplay.buzz/" },
        signal: AbortSignal.timeout(4500),
      });
      if (!r.ok) return null;
      const html = await r.text();
      const m = html.match(/data-id=["'](\d+)["']/);
      if (!m?.[1]) return null;
      const srcRes = await fetch(`https://megaplay.buzz/stream/getSources?id=${m[1]}&s=${srvParam}`, {
        headers: { "User-Agent": UA, Referer: pageUrl, "X-Requested-With": "XMLHttpRequest" },
        signal: AbortSignal.timeout(4500),
      }).catch(() => null);
      if (!srcRes || !srcRes.ok) return null;
      const sj = await srcRes.json().catch(() => null);
      const ok = Boolean(sj?.enc || (Array.isArray(sj?.sources) ? sj.sources.length > 0 : sj?.sources));
      return ok ? m[1] : null;
    } catch {
      return null;
    }
  };

  const p2 = (async () => {
    if (anilistId) {
      const [mpSubId, mpDubId, vsSubId, vsDubId] = await Promise.all([
        verifyMegaPlay("sub", "bcdn"),
        verifyMegaPlay("dub", "bcdn"),
        verifyMegaPlay("sub", "vidstream"),
        verifyMegaPlay("dub", "vidstream"),
      ]);
      megaplay.sub = Boolean(mpSubId);
      megaplay.dub = Boolean(mpDubId && (!isNonJpEastAsian || mpDubId !== mpSubId));
      if (megaplay.dub) megaplay.dubVerified = true;
      vidstream.sub = Boolean(vsSubId);
      vidstream.dub = Boolean(vsDubId && (!isNonJpEastAsian || vsDubId !== vsSubId));
      if (vidstream.dub) vidstream.dubVerified = true;
    }

    // Only if MegaPlay / Vidstream had 0 matches via AniList ID do we attempt Anikoto title search
    if (!megaplay.sub && !megaplay.dub && !vidstream.sub && !vidstream.dub && title) {
      const isDonghua = countryOfOrigin === "CN" || countryOfOrigin === "TW" || countryOfOrigin === "HK";
      try {
        const searchUrl = "https://anikototv.bz/filter?keyword=" + encodeURIComponent(title);
        const searchRes = await fetch(searchUrl, {
          headers: { "User-Agent": UA, "Referer": "https://anikototv.bz/" },
          redirect: "follow",
          signal: AbortSignal.timeout(4000)
        });
        if (searchRes.ok) {
          const searchHtml = await searchRes.text();
          const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          const titleKeywords = cleanTitle.split(/\s+/).filter(w => !['season', 'part', 'tv', '2nd', '3rd', '4th', 'the', 'of', 'in', 'and'].includes(w));

          const searchCards = [...searchHtml.matchAll(/<div class="ani poster tip"[^>]*>[\s\S]*?<a href="https?:\/\/[^/"']+\/watch\/([^"\/]+)\/ep-1"[^>]*>[\s\S]*?alt="([^"]+)"/g)];
          let matchedSlug = null;
          for (const card of searchCards) {
            const cSlug = card[1].toLowerCase();
            const cName = card[2].toLowerCase();
            if (titleKeywords.length > 0 && titleKeywords.every(kw => cSlug.includes(kw) || cName.includes(kw))) {
              matchedSlug = card[1];
              break;
            }
          }

          if (matchedSlug) {
            const watchUrl = `https://anikototv.bz/watch/${matchedSlug}`;
            const watchRes = await fetch(watchUrl, {
              headers: { "User-Agent": UA, "Referer": "https://anikototv.bz/" },
              redirect: "follow",
              signal: AbortSignal.timeout(4000)
            });
            if (watchRes.ok) {
              const watchHtml = await watchRes.text();
              const showIdMatch = watchHtml.match(/data-id="(\d+)"/);
              if (showIdMatch) {
                const listRes = await fetch(`https://anikototv.bz/ajax/episode/list/${showIdMatch[1]}`, {
                  headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": watchUrl },
                  signal: AbortSignal.timeout(4000)
                });
                if (listRes.ok) {
                  const listJson = await listRes.json();
                  const epRegex = new RegExp(`<a\\s+[^>]*data-ids="([^"]+)"[^>]*data-num="${episode}"|<a\\s+[^>]*data-num="${episode}"[^>]*data-ids="([^"]+)"`, "i");
                  const epMatch = listJson.result?.match(epRegex);
                  if (epMatch) {
                    const serverIds = epMatch[1] || epMatch[2];
                    const serverRes = await fetch(`https://anikototv.bz/ajax/server/list?servers=${encodeURIComponent(serverIds)}`, {
                      headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": watchUrl },
                      signal: AbortSignal.timeout(4000)
                    });
                    if (serverRes.ok) {
                      const serverJson = await serverRes.json();
                      const serverHtml = serverJson.result || "";
                      const subMatch = serverHtml.match(/data-type=["']sub["'][\s\S]*?<\/ul>/i);
                      const dubMatch = serverHtml.match(/data-type=["']dub["'][\s\S]*?<\/ul>/i);
                      const subHtml = subMatch ? subMatch[0] : "";
                      const dubHtml = dubMatch ? dubMatch[0] : "";
                      if (/HD-1/i.test(subHtml)) megaplay.sub = true;
                      if (/Vidstream/i.test(subHtml)) vidstream.sub = true;
                      if (!isDonghua) {
                        if (/HD-1/i.test(dubHtml)) megaplay.dub = true;
                        if (/Vidstream/i.test(dubHtml)) vidstream.dub = true;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch {}
    }
  })();

  let acdnAvail = { sub: false, dub: false, multi: false, languages: [] };

  const p3 = skipAcdn
    ? Promise.resolve()
    : Promise.race([
        (async () => {
          try {
            const getAcdnHit = opts?.getAcdnHit || (() => resolveAcdn({ anilistId, episode, title, isMovie }));
            const hit = await getAcdnHit();
            if (!hit?.streamUrl || isBlockedPlayerHost(hit.streamUrl)) return;

            const isHls = hit.kind === "hls" || /\.m3u8(\?|$)/i.test(hit.streamUrl);
            if (isHls) {
              const m3u8Text = await fetchVerifiedM3u8Text(hit.streamUrl, hit.referer || "https://ravok.buzz/");
              if (!m3u8Text) return;
              const hlsLangs = parseHlsAudioLanguages(m3u8Text, countryOfOrigin);
              acdnAvail = buildAcdnAvailability({ verifiedStream: true, hlsLangs, resolvedHit: hit, countryOfOrigin });
            } else {
              acdnAvail = buildAcdnAvailability({ verifiedStream: true, hlsLangs: [], resolvedHit: hit, countryOfOrigin });
            }
          } catch {}
        })(),
        new Promise((resolve) => setTimeout(resolve, 6800)),
      ]);

  const p2Capped = Promise.race([
    p2,
    new Promise((resolve) => setTimeout(resolve, 7500)),
  ]);

  await Promise.all([p1, p2Capped, p3]);

  return {
    megaplay,
    vidstream,
    flixcloud,
    acdn: acdnAvail,
  };
}
