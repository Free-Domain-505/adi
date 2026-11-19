import { ANIME_MAPPING, pickMapping } from "./mapping.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BASE_URL = "https://animesalt.cx";
const MIRRORS = [BASE_URL, "https://animesalt.ac", "https://animesalt.ro"];

// In-memory cache for mapping & resolved streams
let cachedMapping = null;
const streamCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function loadMapping(origin = "") {
  if (cachedMapping) return cachedMapping;
  if (ANIME_MAPPING && Object.keys(ANIME_MAPPING).length) {
    cachedMapping = ANIME_MAPPING;
    return cachedMapping;
  }
  try {
    const targetUrl = origin
      ? `${origin}/anime-mapping.json`
      : "https://aniversee.vercel.app/anime-mapping.json";
    const res = await fetch(targetUrl);
    if (res.ok) {
      cachedMapping = await res.json();
      return cachedMapping;
    }
  } catch {}
  return {};
}

export function normalizeAnimeSaltTitle(title = "") {
  return String(title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function cleanTitleForSlug(title = "") {
  return title
    .replace(/\s*\(\d{4}\)\s*$/g, "")
    .replace(/\s*Season\s+\d+\s*$/gi, "")
    .replace(/\s*\d+(?:st|nd|rd|th)\s+season\s*$/gi, "")
    .replace(/\s*Final Season\s*$/gi, "")
    .replace(/\s*:\s*Part\s+\d+\s*$/gi, "")
    .replace(/\s*Part\s+\d+\s*$/gi, "")
    .replace(/\s*Cour\s+\d+\s*$/gi, "")
    .replace(/\s*[-–]\s*Season\s+\d+\s*$/gi, "")
    .replace(/\s*:.*$/g, "")
    .trim();
}

export function extractSeason(title = "", romajiTitle = "") {
  const patterns = [
    /\b(?:Season|Series|Part|S)\s*(\d+)\b/i,
    /\b(\d+)(?:st|nd|rd|th)\s+Season\b/i,
  ];
  for (const p of patterns) {
    const m = title.match(p);
    if (m && m[1]) return parseInt(m[1], 10);
  }
  if (romajiTitle) {
    for (const p of patterns) {
      const m = romajiTitle.match(p);
      if (m && m[1]) return parseInt(m[1], 10);
    }
  }
  return 1;
}

export function generateAnimeSaltSlug(title = "", season = 1, episode = 1) {
  const normalized = normalizeAnimeSaltTitle(title);
  return `${normalized}-${season}x${episode}`;
}

export function getCandidateSlugs({
  anilistId,
  episode = 1,
  title = "",
  romajiTitle = "",
  isMovie = false,
  mapping = {},
}) {
  const mapped = pickMapping(mapping, anilistId, episode, isMovie);
  if (mapped && mapped.saltId) {
    if (mapped.slug) return [mapped.slug, `private-${mapped.slug}`];
    if (mapped.isMovie || isMovie) return [mapped.saltId, `private-${mapped.saltId}`];
    const season = mapped.season || 1;
    const ep = mapped.finalEp || episode;
    const base = `${mapped.saltId}-${season}x${ep}`;
    // Strictly never fall back to unseasoned -episode-{n} for Season 2+ sequels
    if (season === 1) {
      return [
        base,
        `private-${base}`,
        `${mapped.saltId}-episode-${ep}`,
        `private-${mapped.saltId}-episode-${ep}`,
      ];
    }
    return [base, `private-${base}`];
  }

  const out = [];
  const addFromTitle = (rawTitle) => {
    if (!rawTitle) return;
    const cleaned = cleanTitleForSlug(rawTitle);
    const norm = normalizeAnimeSaltTitle(cleaned || rawTitle);
    if (!norm) return;
    if (isMovie) {
      out.push(norm, `private-${norm}`);
      return;
    }
    const season = extractSeason(rawTitle, romajiTitle);
    const base = `${norm}-${season}x${episode}`;
    if (season === 1) {
      out.push(
        base,
        `private-${base}`,
        `${norm}-episode-${episode}`,
        `private-${norm}-episode-${episode}`
      );
    } else {
      // Strictly never fall back to Season 1 (-1x or unseasoned) slugs for sequel seasons
      out.push(base, `private-${base}`);
    }
  };

  addFromTitle(title);
  if (romajiTitle && romajiTitle !== title) addFromTitle(romajiTitle);
  return [...new Set(out)];
}

function decodeHtmlEntities(str = "") {
  return str
    .replace(/&#0*38;/g, "&")
    .replace(/&amp;/gi, "&")
    .trim();
}

function extractIframeSrc(snippet) {
  if (!snippet) return null;
  const ds = snippet.match(/data-src=["']([^"']+)["']/i);
  if (ds && ds[1] && ds[1].trim() !== "about:blank") return decodeHtmlEntities(ds[1]);
  const s = snippet.match(/\bsrc=["']([^"']+)["']/i);
  if (s && s[1] && s[1].trim() !== "about:blank") return decodeHtmlEntities(s[1]);
  return null;
}

const decodeB64Utf8 = (raw) => {
  const clean = raw.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const bin = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

const absUrl = (u, base) => {
  try {
    return new URL(u, base).href;
  } catch {
    return u;
  }
};

// Hosts known to block sandboxed iframes or refuse server-side extraction
const SANDBOX_BLOCKED_PATTERNS = [
  "cybervynx",
  "upns.live",
  "rpmshare",
  "strp2p",
  "short.ink",
  "abyssplayer",
  "abysscdn",
  "enc-dec",
  "vidmoly",
  "filemoon",
  "streamwish",
  "dood",
  "gdmirrorbot",
  "voe.sx",
  "voe.",
];

export function isSandboxBlockedHost(url = "") {
  if (!url) return true;
  const lower = String(url).toLowerCase();
  return SANDBOX_BLOCKED_PATTERNS.some((p) => lower.includes(p));
}

function isMultiLangWrapper(url = "") {
  return /player\.php|multi-lang-plyr\.php/i.test(String(url));
}

function isPreferredSafePlayer(url = "") {
  if (!url || isSandboxBlockedHost(url) || isMultiLangWrapper(url)) return false;
  const lower = String(url).toLowerCase();
  return (
    lower.includes("/video/") ||
    lower.includes("ravok") ||
    lower.includes("as-cdn") ||
    lower.includes("acdn") ||
    lower.includes("zephyrflick") ||
    lower.includes("nekomux") ||
    lower.includes("/player/?source=embed")
  );
}

function extractSubtitlesFromHtml(html = "", domain = "ravok.buzz") {
  if (!html) return [];
  const subs = [];
  const pjsMatch =
    html.match(/playerjsSubtitle\s*=\s*["']([^"']+)["']/i) ||
    html.match(/Subtitle\s*=\s*["'](\[[^"']+\]https?[^"']+)["']/i);
  if (pjsMatch && pjsMatch[1]) {
    const raw = pjsMatch[1].trim();
    for (const part of raw.split(/,(?=\[|https?:\/\/)/)) {
      const p = part.trim();
      if (!p) continue;
      const m = p.match(/^\[([^\]]+)\](.*)$/);
      if (m) {
        const label = m[1].trim();
        let file = m[2].trim();
        if (file.startsWith("//")) file = `https:${file}`;
        if (file.startsWith("http")) subs.push({ label, file, kind: "captions" });
      } else if (p.startsWith("http") || p.startsWith("//")) {
        const file = p.startsWith("//") ? `https:${p}` : p;
        subs.push({ label: "English", file, kind: "captions" });
      }
    }
  }
  for (const tm of html.matchAll(/<track[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
    const tag = tm[0];
    let file = tm[1].trim();
    if (file.startsWith("//")) file = `https:${file}`;
    else if (file.startsWith("/")) file = `https://${domain}${file}`;
    const label = tag.match(/label=["']([^"']+)["']/i)?.[1] || tag.match(/srclang=["']([^"']+)["']/i)?.[1] || "English";
    if (file.startsWith("http") && !subs.some((s) => s.file === file)) {
      subs.push({ label, file, kind: "captions" });
    }
  }
  return subs;
}

async function resolveAsCdnHash(host, hash, pageUrl) {
  const hosts = host.toLowerCase() === "ravok.buzz" ? [host] : [host, "ravok.buzz"];
  for (const h of hosts) {
    try {
      const originHost = `https://${h}`;
      const videoUrl = `${originHost}/video/${hash}`;
      const postUrl = `${originHost}/player/index.php?data=${hash}&do=getVideo`;
      const [gvResp, pageRes] = await Promise.all([
        fetch(postUrl, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            Referer: videoUrl,
            Origin: originHost,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          body: new URLSearchParams({ hash, r: pageUrl || `${BASE_URL}/` }).toString(),
          signal: AbortSignal.timeout(6500),
        }).catch(() => null),
        fetch(videoUrl, {
          headers: { "User-Agent": UA, Referer: pageUrl || `${BASE_URL}/` },
          signal: AbortSignal.timeout(4500),
        }).catch(() => null),
      ]);
      if (!gvResp || !gvResp.ok) continue;
      const body = (await gvResp.text()).trim();
      if (!body.startsWith("{")) continue;
      const gvData = JSON.parse(body);
      const directStreamUrl = gvData?.videoSource || gvData?.securedLink || gvData?.hls || null;
      if (!directStreamUrl) continue;
      let subtitles = [];
      if (pageRes && pageRes.ok) {
        const html = await pageRes.text().catch(() => "");
        subtitles = extractSubtitlesFromHtml(html, h);
      }
      return {
        embedUrl: videoUrl,
        directStreamUrl,
        directReferer: `${originHost}/`,
        subtitles,
      };
    } catch {}
  }
  return null;
}

async function resolvePlayerDirect(rawUrl, pageUrl, audio = "multi", depth = 0) {
  if (!rawUrl || depth > 2) return null;
  const clean = decodeHtmlEntities(rawUrl);
  if (!clean || clean === "about:blank") return null;

  // Unwrap player.php / multi-lang-plyr.php multi-language base64 list server-side
  if (isMultiLangWrapper(clean)) {
    try {
      const rawData = clean.match(/data=([a-zA-Z0-9%+/=_-]+)/)?.[1];
      if (!rawData) return null;
      let b64 = rawData;
      try {
        b64 = decodeURIComponent(rawData);
      } catch {}
      const list = JSON.parse(decodeB64Utf8(b64));
      if (!Array.isArray(list)) return null;

      const reqSub = /^sub$/i.test(String(audio));
      const candidates = list
        .map((item) => ({
          lang: String(item?.language || "").trim(),
          link: String(item?.link || "").replace(/\\\//g, "/").trim(),
        }))
        .filter((x) => x.link && !isSandboxBlockedHost(x.link));

      const scoreLang = (l) => {
        const low = l.toLowerCase();
        if (reqSub) {
          if (/japanese|jap|jpn|\bja\b|original/i.test(low)) return 5;
          if (/english|\beng\b/i.test(low)) return 4;
          if (/hindi|\bhin\b/i.test(low)) return 3;
          return 1;
        }
        if (/hindi|\bhin\b/i.test(low)) return 5;
        if (/english|\beng\b/i.test(low)) return 4;
        if (/japanese|jap|jpn|original/i.test(low)) return 3;
        return 1;
      };
      candidates.sort((a, b) => scoreLang(b.lang) - scoreLang(a.lang));

      for (const c of candidates) {
        const resolved = await resolvePlayerDirect(c.link, clean, audio, depth + 1);
        if (resolved?.directStreamUrl || (resolved?.embedUrl && !isSandboxBlockedHost(resolved.embedUrl))) {
          return resolved;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // Unwrap animestream-child /player/?source=embed&...&url=<target>
  if (/\/player\/\?[^#]*\burl=/i.test(clean)) {
    try {
      const inner = new URL(clean).searchParams.get("url");
      if (inner && inner !== clean) {
        const res = await resolvePlayerDirect(inner, clean, audio, depth + 1);
        if (res) return res;
      }
    } catch {}
  }

  if (isSandboxBlockedHost(clean)) return null;

  // player.nekomux.com/episode/<id> -> /source JSON with direct multi-audio HLS
  const nekoM = clean.match(/^https?:\/\/([a-z0-9.-]*nekomux\.com)\/episode\/(\d+)/i);
  if (nekoM) {
    try {
      const originHost = `https://${nekoM[1]}`;
      const r = await fetch(`${originHost}/episode/${nekoM[2]}/source`, {
        headers: { "User-Agent": UA, Referer: clean, Accept: "application/json,*/*" },
        signal: AbortSignal.timeout(6500),
      });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        const directStreamUrl = j?.url || j?.streamUrl || null;
        if (directStreamUrl) {
          return {
            embedUrl: clean,
            directStreamUrl,
            directReferer: `${originHost}/`,
            subtitles: [],
          };
        }
      }
    } catch {}
  }

  // Direct stream URL
  if (/\.(m3u8|mp4)(\?|$)/i.test(clean)) {
    return { embedUrl: null, directStreamUrl: clean, directReferer: pageUrl, subtitles: [] };
  }

  // /video/<hash> -> as-cdn / ravok / zephyrflick getVideo
  const hashM = clean.match(/^https?:\/\/([a-zA-Z0-9_.-]+)\/video\/([a-zA-Z0-9_-]+)/i);
  if (hashM) {
    const res = await resolveAsCdnHash(hashM[1], hashM[2], pageUrl);
    if (res) return res;
    return { embedUrl: clean, directStreamUrl: null, directReferer: null, subtitles: [] };
  }

  // Generic safe player page: look for direct file/source, /video/<hash>, or nested iframe
  try {
    const r = await fetch(clean, {
      headers: { "User-Agent": UA, Referer: pageUrl },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const html = await r.text();
      let domain = "";
      try {
        domain = new URL(clean).hostname;
      } catch {}
      const pageSubs = extractSubtitlesFromHtml(html, domain || "ravok.buzz");

      if (/pixel/i.test(clean)) {
        const f = html.match(/file\s*:\s*"([^"]+)"/i)?.[1];
        if (f) {
          return {
            embedUrl: clean,
            directStreamUrl: f.replace(/\\\//g, "/"),
            directReferer: clean,
            subtitles: pageSubs,
          };
        }
      }

      const file = html.match(/(?:file|source|src)\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i)?.[1];
      if (file) {
        return { embedUrl: clean, directStreamUrl: file, directReferer: clean, subtitles: pageSubs };
      }

      const innerCdn = html.match(/https?:\/\/([a-zA-Z0-9_.-]+)\/video\/([a-zA-Z0-9_-]+)/i);
      if (innerCdn) {
        const res = await resolveAsCdnHash(innerCdn[1], innerCdn[2], clean);
        if (res) {
          return {
            ...res,
            subtitles: res.subtitles?.length ? res.subtitles : pageSubs,
          };
        }
      }

      const nested = html.match(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i)?.[1];
      if (nested && nested.trim() !== "about:blank") {
        const res = await resolvePlayerDirect(absUrl(nested, clean), clean, audio, depth + 1);
        if (res) {
          return {
            ...res,
            subtitles: res.subtitles?.length ? res.subtitles : pageSubs,
          };
        }
      }
    }
  } catch {}

  return { embedUrl: clean, directStreamUrl: null, directReferer: null, subtitles: [] };
}

/**
 * Extracts AnimeSalt server 1 (options-0) & server 2 (options-1) independently,
 * extracting direct HLS/MP4 streams + subtitles for CinePlayer whenever possible.
 */
export async function extractAnimeSaltPlayer({
  anilistId,
  episode = 1,
  title = "",
  romajiTitle = "",
  isMovie = false,
  audio = "multi",
  server = "1",
  origin = "",
}) {
  const srv = String(server || "1").toLowerCase();
  const isServer2 = srv === "2" || srv === "abyss";
  const audKey = String(audio || "multi").toLowerCase();
  const cacheKey = `${anilistId || title}:${episode}:${isMovie}:${audKey}`;
  const cached = streamCache.get(cacheKey);

  const pickServerResponse = (data) => {
    const slot = isServer2 ? data.srv2 : data.srv1;
    if (!slot || (!slot.directStreamUrl && !slot.embedUrl)) {
      return {
        success: false,
        server: isServer2 ? "2" : "1",
        error: `AnimeSalt Server ${isServer2 ? "2" : "1"} unavailable`,
      };
    }
    return {
      success: true,
      slug: data.slug,
      pageUrl: data.pageUrl,
      server: isServer2 ? "2" : "1",
      embedUrl: slot.embedUrl || null,
      directStreamUrl: slot.directStreamUrl || null,
      directReferer: slot.directReferer || slot.embedUrl || data.pageUrl || `${BASE_URL}/`,
      subtitles: slot.subtitles || [],
      myStreamUrl: data.srv1?.embedUrl || null,
      abyssUrl: data.srv2?.embedUrl || null,
      allIframes: data.allIframes || [],
    };
  };

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return pickServerResponse(cached.data);
  }

  const mapping = await loadMapping(origin);
  const slugs = getCandidateSlugs({ anilistId, episode, title, romajiTitle, isMovie, mapping });
  if (!slugs.length) {
    return {
      success: false,
      error: "Anime not mapped in anime-mapping.json. Please add a mapping for this title.",
    };
  }

  for (const slug of slugs) {
    const candidateUrls = isMovie
      ? MIRRORS.map((m) => `${m}/movies/${slug}/`)
      : MIRRORS.map((m) => `${m}/episode/${slug}/`);

    for (const pageUrl of candidateUrls) {
      try {
        const resp = await fetch(pageUrl, {
          headers: { "User-Agent": UA, Referer: `${BASE_URL}/` },
          signal: AbortSignal.timeout(5500),
        });
        if (!resp.ok) continue;
        const html = await resp.text();
        if (html.length < 500) continue;

        const pageOrigin = new URL(pageUrl).origin;
        const normUrl = (u) => (u ? absUrl(decodeHtmlEntities(u), pageOrigin) : null);

        const opt0Block = html.match(/<div[^>]+id=["'](?:options?|opt)-0["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
        const opt1Block = html.match(/<div[^>]+id=["'](?:options?|opt)-1["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
        const opt2Block = html.match(/<div[^>]+id=["'](?:options?|opt)-2["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";

        const opt0Raw = normUrl(extractIframeSrc(opt0Block));
        const opt1Raw = normUrl(extractIframeSrc(opt1Block));
        const opt2Raw = normUrl(extractIframeSrc(opt2Block));

        const allIframes = [];
        const pushFrame = (u) => {
          const full = normUrl(u);
          if (full && !allIframes.includes(full)) allIframes.push(full);
        };
        if (opt0Raw) pushFrame(opt0Raw);
        if (opt1Raw) pushFrame(opt1Raw);
        if (opt2Raw) pushFrame(opt2Raw);
        for (const ifr of html.matchAll(/<iframe[^>]*>/gi)) {
          const u = extractIframeSrc(ifr[0]);
          if (u) pushFrame(u);
        }
        for (const m of html.matchAll(/value\s*:\s*["']([A-Za-z0-9+/=]{24,})["']/g)) {
          try {
            const decoded = decodeB64Utf8(m[1]);
            if (decoded.includes("<iframe") || decoded.includes("src=")) {
              const u = extractIframeSrc(decoded);
              if (u) pushFrame(u);
            }
          } catch {}
        }

        const safeIframes = allIframes.filter((u) => !isSandboxBlockedHost(u) && !isMultiLangWrapper(u));

        // Resolve options-0 and options-1 independently
        const [r0, r1] = await Promise.all([
          opt0Raw ? resolvePlayerDirect(opt0Raw, pageUrl, audio) : Promise.resolve(null),
          opt1Raw ? resolvePlayerDirect(opt1Raw, pageUrl, audio) : Promise.resolve(null),
        ]);

        let srv1 = r0;
        let srv2 = r1;

        if (!srv1 || (!srv1.directStreamUrl && !srv1.embedUrl)) {
          const extra =
            allIframes.find((u) => u !== opt1Raw && u !== opt0Raw && (isMultiLangWrapper(u) || isPreferredSafePlayer(u))) ||
            safeIframes.find((u) => u !== opt1Raw);
          if (extra) srv1 = await resolvePlayerDirect(extra, pageUrl, audio);
        }

        if (!srv2 || (!srv2.directStreamUrl && !srv2.embedUrl)) {
          const usedUrl = srv1?.embedUrl || opt0Raw;
          const extra2 =
            (opt2Raw && opt2Raw !== usedUrl ? opt2Raw : null) ||
            allIframes.find((u) => u !== usedUrl && u !== opt1Raw && (isMultiLangWrapper(u) || isPreferredSafePlayer(u))) ||
            safeIframes.find((u) => u !== usedUrl && u !== opt1Raw);
          if (extra2) srv2 = await resolvePlayerDirect(extra2, pageUrl, audio);
        }

        const has1 = Boolean(srv1 && (srv1.directStreamUrl || (srv1.embedUrl && !isSandboxBlockedHost(srv1.embedUrl))));
        const has2 = Boolean(srv2 && (srv2.directStreamUrl || (srv2.embedUrl && !isSandboxBlockedHost(srv2.embedUrl))));

        if ((has1 || has2) && (srv1?.directStreamUrl || srv2?.directStreamUrl || pageUrl.includes("animesalt.ro"))) {
          const data = {
            slug,
            pageUrl,
            srv1: has1 ? srv1 : null,
            srv2: has2 ? srv2 : null,
            allIframes: safeIframes,
          };
          streamCache.set(cacheKey, { data, timestamp: Date.now() });
          return pickServerResponse(data);
        }
      } catch {
        // try next mirror/slug
      }
    }
  }

  return {
    success: false,
    error: "Failed to extract AnimeSalt player",
  };
}
