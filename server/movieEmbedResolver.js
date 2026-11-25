import { buildMovieEmbedCandidates, isTrustedMovieEmbedUrl } from "./detectStreamLogic.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_VIDNEST_SECRET = "K3p8vQ2mX9rL5wZ0fN7bG1sH4tJ6dC9_y8S3wM1nQ5pL2";

export async function decryptVidNestPayload(payload, secret = DEFAULT_VIDNEST_SECRET) {
  if (!payload || typeof payload !== "object") return payload;
  if (payload.v === 2 && payload.n && payload.d) {
    try {
      const combined = Buffer.from(payload.d, "base64url");
      const iv = combined.subarray(0, 12);
      const ct = combined.subarray(12);
      const keyMaterial = new TextEncoder().encode(`${payload.n}|${secret}`);
      const hash = await globalThis.crypto.subtle.digest("SHA-256", keyMaterial);
      const key = await globalThis.crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["decrypt"]);
      const pt = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
      return JSON.parse(new TextDecoder().decode(pt));
    } catch {
      return payload;
    }
  }
  return payload;
}

export function parseEmbedUrlContext(rawUrl = "") {
  try {
    const u = new URL(rawUrl);
    const p = u.pathname;
    const q = u.searchParams;

    const movieMatch = p.match(/\/movie\/(\d+)/i);
    if (movieMatch) {
      return {
        tmdbId: Number(movieMatch[1]),
        type: "movie",
        season: 1,
        episode: 1,
      };
    }

    const tvMatch = p.match(/\/(?:tv|player)\/(\d+)\/(\d+)\/(\d+)/i);
    if (tvMatch) {
      return {
        tmdbId: Number(tvMatch[1]),
        type: "tv",
        season: Number(tvMatch[2]),
        episode: Number(tvMatch[3]),
      };
    }

    if (q.has("tmdb")) {
      const isTv = p.includes("/tv") || q.has("season") || q.has("episode");
      return {
        tmdbId: Number(q.get("tmdb")),
        type: isTv ? "tv" : "movie",
        season: Number(q.get("season") || 1),
        episode: Number(q.get("episode") || 1),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function extractRawStreamEntries(payload) {
  if (!payload || typeof payload !== "object") return [];
  const rawList = Array.isArray(payload.streams)
    ? payload.streams
    : Array.isArray(payload.sources)
    ? payload.sources
    : payload.url
    ? [payload]
    : [];

  const out = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const url = String(item.url || item.file || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const hdrs = item.headers && typeof item.headers === "object" ? item.headers : {};
    const referer = hdrs.Referer || hdrs.referer || item.referer || null;
    out.push({
      ...item,
      url,
      referer,
    });
  }
  return out;
}

export function buildDirectServerSources({ verifiedStreams = [], subtitles = [], proxyBase = "/proxy" } = {}) {
  const ranked = [...verifiedStreams].sort((a, b) => {
    const score = (s) => {
      let sc = (s.extractorPriority || 0) * 10;
      if (s.isMkv) sc -= 1000;
      if (s.isHevcOnly) sc -= 500;
      if (s.isHls) sc += 100;
      if (s.hasMultiQuality) sc += 50;
      if (s.maxResolution) sc += s.maxResolution;
      return sc;
    };
    return score(b) - score(a);
  });

  const dubs = Array.from(
    new Set(
      verifiedStreams
        .map((s) => s.languageNormalized || "Original")
        .filter(Boolean)
    )
  ).map((lang, idx) => ({
    id: `dub-${idx}`,
    label: lang,
    selected: idx === 0,
  }));

  const buildSource = (stream, index) => {
    const isHls = stream.isHls || /\.m3u8(\?|$)/i.test(stream.url);
    const qs = new URLSearchParams({ url: stream.url });
    if (stream.effectiveReferer) qs.set("referer", stream.effectiveReferer);
    if (isHls) qs.set("playlist", "1");
    const streamUrl = `${proxyBase}?${qs.toString()}`;
    const providerId = `embed-${stream.extractorKey}`;

    return {
      kind: "direct",
      providerId,
      label: index === 0 ? "Server 3" : `Server ${index + 3}`,
      streams: [
        {
          ...stream,
          format: stream.format || (isHls ? "hls" : "mp4"),
          heights: stream.heights || [],
          streamUrl,
        },
      ],
      streamUrl,
      subtitles,
      dubs,
    };
  };

  const sources = ranked.map(buildSource);
  return {
    primary: sources[0] || null,
    extras: sources.slice(1),
    dubs,
  };
}

export function mapProviderHintToExtractor(providerId = "", rawUrl = "") {
  const pid = String(providerId || "").toLowerCase();
  const u = String(rawUrl || "").toLowerCase();
  if (pid.includes("videasy") || u.includes("videasy")) return "videasy";
  if (pid.includes("vidlink") || u.includes("vidlink")) return "vidlink";
  if (pid.includes("vidfast") || u.includes("vidfast")) return "vidfast";
  if (pid.includes("cinemaos") || u.includes("cinemaos")) return "cinemaos";
  if (pid.includes("primesrc") || u.includes("primesrc")) return "primesrc";
  if (pid.includes("cinesrc") || u.includes("cinesrc")) return "cinesrc";
  if (pid.includes("vidsrc") || u.includes("vidsrc")) return "vidsrc";
  if (pid.includes("nontongo") || u.includes("nontongo") || pid.includes("yflix") || u.includes("yflix")) return "yflix";
  if (pid.includes("rpmvid") || u.includes("rpmvid")) return "rpmvid";
  if (pid.includes("ophim") || u.includes("ophim")) return "ophim";
  return null;
}


function normalizeLangQuery(lang) {
  const s = String(lang || "").trim();
  if (!s || /^(original|default|auto)$/i.test(s)) return null;
  if (/^\d+$/.test(s)) return null; // Numeric MovieBox subject ID is not a language name
  return s.replace(/\s*dub\b/i, "").trim();
}

function extractM3u8OrMp4UrlsFromHtml(html = "") {
  const urls = new Set();
  for (const m of html.matchAll(/["'](https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?)["']/gi)) {
    const candidate = m[1].replace(/\\u002F/gi, "/").replace(/\\/g, "");
    if (/^https?:\/\//i.test(candidate)) urls.add(candidate);
  }
  return Array.from(urls);
}

async function probeDirectVideoUrl(streamUrl, referer) {
  try {
    const hdrs = { "User-Agent": UA };
    if (referer) hdrs.Referer = referer;
    const res = await fetch(streamUrl, {
      headers: hdrs,
      redirect: "follow",
      signal: AbortSignal.timeout(2800),
    });
    if (!res.ok && res.status !== 206) return false;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html") || ct.includes("application/json")) return false;
    if (/\.mp4(\?|$)/i.test(streamUrl) || ct.startsWith("video/")) {
      try { await res.body?.cancel(); } catch {}
      return true;
    }
    const text = await res.text();
    return text.trimStart().startsWith("#EXTM3U");
  } catch {
    return false;
  }
}

export async function resolveMovieEmbedStreams({
  tmdbId,
  type = "movie",
  season = 1,
  episode = 1,
  lang = null,
  preferredExtractor = null,
  excludeProviders = [],
  proxyBase = "/proxy",
} = {}) {
  if (!tmdbId) return { success: false, source: null, backups: [], subtitles: [] };

  const cleanLang = normalizeLangQuery(lang);
  const excluded = new Set((excludeProviders || []).map((x) => String(x || "").toLowerCase()));
  const candidates = buildMovieEmbedCandidates({ type, tmdbId, season, episode, sandboxed: false })
    .filter((c) => c.id !== "vidzee" && c.id !== "cinemaos" && !excluded.has(c.id.toLowerCase()));

  if (preferredExtractor) {
    candidates.sort((a, b) => {
      const am = a.id.toLowerCase().includes(preferredExtractor) ? 0 : 1;
      const bm = b.id.toLowerCase().includes(preferredExtractor) ? 0 : 1;
      return am - bm;
    });
  }

  const probeCandidate = async (cand) => {
    try {
      if (!isTrustedMovieEmbedUrl(cand.url)) return null;
      const targetUrl = new URL(cand.url);
      if (cleanLang && !targetUrl.searchParams.has("lang")) {
        targetUrl.searchParams.set("lang", cleanLang);
      }
      const res = await fetch(targetUrl.href, {
        headers: { "User-Agent": UA, Referer: `${targetUrl.origin}/` },
        redirect: "follow",
        signal: AbortSignal.timeout(2600),
      });
      if (!res.ok) return null;
      const html = await res.text();
      const rawUrls = extractM3u8OrMp4UrlsFromHtml(html);
      if (!rawUrls.length) return null;

      for (const streamUrl of rawUrls.slice(0, 2)) {
        const ok = await probeDirectVideoUrl(streamUrl, `${targetUrl.origin}/`);
        if (!ok) continue;
        const isHls = /\.m3u8(\?|$)/i.test(streamUrl);
        const qs = new URLSearchParams({ url: streamUrl, referer: `${targetUrl.origin}/` });
        if (isHls) qs.set("playlist", "1");
        const pUrl = `${proxyBase}?${qs.toString()}`;
        const langLabel = cleanLang || "Original";
        const providerId = `embed-${cand.id}`;
        return {
          kind: "direct",
          providerId,
          label: "Server 3",
          streams: [
            {
              id: `${providerId}-0`,
              quality: "HD",
              resolutionNum: 720,
              format: isHls ? "hls" : "mp4",
              url: streamUrl,
              rawStreamUrl: streamUrl,
              streamUrl: pUrl,
              proxyStreamUrl: pUrl,
              language: langLabel,
            },
          ],
          dubs: cleanLang
            ? [{ id: `embed:${cleanLang}`, label: cleanLang, selected: true }]
            : [{ id: "embed:Original", label: "Original", selected: true }],
          subtitles: [],
          streamUrl: pUrl,
          tags: ["Direct"],
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  const results = (await Promise.all(candidates.slice(0, 4).map(probeCandidate))).filter(Boolean);
  if (!results.length) {
    return { success: false, source: null, backups: [], subtitles: [] };
  }
  return {
    success: true,
    source: results[0],
    backups: results.slice(1),
    subtitles: [],
  };
}
