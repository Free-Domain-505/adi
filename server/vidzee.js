// Server-side Vidzee direct HLS/MP4 extractor & AssemblyScript WASM decryptor.
// Extracts underlying streams from core.vidzee.wtf and live-probes them so Vidzee
// plays natively inside Zenkai's own CinePlayer instead of an external sandboxed iframe.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const VIDZEE_PLAYER = "https://player.vidzee.wtf";
const VIDZEE_CORE = "https://core.vidzee.wtf";
const DEFAULT_STREAMS_CHUNK = `${VIDZEE_PLAYER}/assets/streams-BHpSC3gU.js`;

const CORE_HEADERS = {
  Origin: VIDZEE_PLAYER,
  Referer: `${VIDZEE_PLAYER}/`,
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
};

let cryptoPromise = null;
let cryptoFetchedAt = 0;
const CRYPTO_TTL_MS = 6 * 3600e3;

function decodeB64Bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function instantiateVidzeeWasm(wasmB64) {
  const bytes = decodeB64Bytes(wasmB64);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      abort(msgPtr, filePtr, line, col) {
        throw new Error(`Vidzee WASM abort at ${msgPtr}:${filePtr}:${line}:${col}`);
      },
    },
  });
  const Q = instance.exports;
  const mem = () => Q.memory.buffer;
  let dv = new DataView(mem());
  const refreshDv = () => {
    if (dv.buffer !== mem()) dv = new DataView(mem());
    return dv;
  };
  const refs = new Map();
  const pin = (ptr) => {
    if (ptr) {
      const c = refs.get(ptr);
      if (c) refs.set(ptr, c + 1);
      else refs.set(Q.__pin(ptr), 1);
    }
    return ptr;
  };
  const unpin = (ptr) => {
    if (ptr) {
      const c = refs.get(ptr);
      if (c === 1) {
        Q.__unpin(ptr);
        refs.delete(ptr);
      } else if (c) {
        refs.set(ptr, c - 1);
      }
    }
  };
  const allocUtf16 = (str) => {
    const ptr = Q.__new(str.length << 1, 2) >>> 0;
    const u16 = new Uint16Array(mem());
    for (let i = 0; i < str.length; i++) u16[(ptr >>> 1) + i] = str.charCodeAt(i);
    return ptr;
  };
  const allocU8Array = (u8) => {
    const dataPtr = Q.__pin(Q.__new(u8.length, 1)) >>> 0;
    const boxPtr = Q.__new(12, 6) >>> 0;
    const view = refreshDv();
    view.setUint32(boxPtr, dataPtr, true);
    view.setUint32(boxPtr + 4, dataPtr, true);
    view.setUint32(boxPtr + 8, u8.length, true);
    new Uint8Array(mem(), dataPtr, u8.length).set(u8);
    Q.__unpin(dataPtr);
    return boxPtr;
  };

  return {
    decrypt(cipherB64) {
      const cipherU8 = decodeB64Bytes(cipherB64);
      const a = pin(allocU8Array(cipherU8));
      const b = allocUtf16("player.vidzee.wtf");
      try {
        const resPtr = Q.decrypt(a, b) >>> 0;
        if (!resPtr) return null;
        const view = refreshDv();
        const bufPtr = view.getUint32(resPtr + 4, true);
        const len = view.getUint32(resPtr + 8, true);
        const jsonStr = new TextDecoder().decode(new Uint8Array(mem(), bufPtr, len));
        return JSON.parse(jsonStr);
      } finally {
        unpin(a);
      }
    },
  };
}

async function fetchWasmB64FromVidzee() {
  const tryScript = async (scriptUrl) => {
    const res = await fetch(scriptUrl, {
      headers: { "User-Agent": UA, Referer: `${VIDZEE_PLAYER}/` },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const js = await res.text();
    const m = js.match(/R="([A-Za-z0-9+/=]{1000,})"/);
    return m?.[1] || null;
  };

  const direct = await tryScript(DEFAULT_STREAMS_CHUNK).catch(() => null);
  if (direct) return direct;

  // Dynamic fallback discovery if Vidzee rotates chunk hash
  const html = await fetch(`${VIDZEE_PLAYER}/embed/movie/550`, {
    headers: { "User-Agent": UA, Referer: `${VIDZEE_PLAYER}/` },
    signal: AbortSignal.timeout(4500),
  }).then((r) => (r.ok ? r.text() : ""));
  const assetMatches = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const path of assetMatches) {
    const js = await fetch(`${VIDZEE_PLAYER}${path}`, {
      headers: { "User-Agent": UA, Referer: `${VIDZEE_PLAYER}/` },
      signal: AbortSignal.timeout(4000),
    }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    const directInChunk = js.match(/R="([A-Za-z0-9+/=]{1000,})"/)?.[1];
    if (directInChunk) return directInChunk;
    const subChunk = js.match(/streams-[A-Za-z0-9_-]+\.js/)?.[0];
    if (subChunk) {
      const hit = await tryScript(`${VIDZEE_PLAYER}/assets/${subChunk}`).catch(() => null);
      if (hit) return hit;
    }
  }
  throw new Error("Unable to locate Vidzee WASM module");
}

async function getCrypto() {
  if (cryptoPromise && Date.now() - cryptoFetchedAt < CRYPTO_TTL_MS) {
    return cryptoPromise;
  }
  cryptoFetchedAt = Date.now();
  cryptoPromise = fetchWasmB64FromVidzee()
    .then((b64) => instantiateVidzeeWasm(b64))
    .catch((err) => {
      cryptoPromise = null;
      throw err;
    });
  return cryptoPromise;
}

function parseM3u8QualityInfo(text, streamUrl) {
  const heights = [];
  for (const m of text.matchAll(/RESOLUTION=\d+x(\d+)/gi)) {
    const h = parseInt(m[1], 10);
    if (h > 0) heights.push(h);
  }
  const hasVariants = /#EXT-X-STREAM-INF/i.test(text);
  const pathHeight = Number(String(streamUrl || '').match(/\/(2160|1080|720|480|360)(?:\/|[._-]|p)/i)?.[1] || 0);
  const maxResolution = heights.length > 0 ? Math.max(...heights) : pathHeight || 0;
  return {
    maxResolution,
    hasMultiQuality: hasVariants && new Set(heights).size > 1,
    heights: [...new Set(heights)].sort((a, b) => b - a),
  };
}

async function probePlayableUrl(streamUrl, customHeaders = {}) {
  if (!streamUrl || typeof streamUrl !== "string" || !streamUrl.startsWith("http")) return null;

  const customRef = customHeaders?.Referer || customHeaders?.referer || null;
  const attempts = customRef
    ? [{ "User-Agent": UA, ...customHeaders, Referer: customRef }]
    : [
        { "User-Agent": UA, Referer: `${VIDZEE_PLAYER}/` },
        { "User-Agent": UA },
      ];

  for (let i = 0; i < attempts.length; i++) {
    const hdrs = attempts[i];
    try {
      const res = await fetch(streamUrl, {
        headers: hdrs,
        redirect: "follow",
        signal: AbortSignal.timeout(4200),
      });
      if (!res.ok) {
        if ((res.status === 401 || res.status === 403) && i + 1 < attempts.length) continue;
        return null;
      }
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("text/html")) return null;

      if (/\.mp4(\?|$)/i.test(streamUrl) || ct.startsWith("video/")) {
        try { await res.body?.cancel(); } catch {}
        const pathHeight = Number(String(streamUrl).match(/\b(2160|1080|720|480|360)p?\b/i)?.[1] || 0);
        return { isHls: false, referer: hdrs.Referer || null, maxResolution: pathHeight, hasMultiQuality: false, heights: [] };
      }

      const text = await res.text();
      if (text.trimStart().startsWith("#EXTM3U")) {
        const qInfo = parseM3u8QualityInfo(text, streamUrl);
        return { isHls: true, referer: hdrs.Referer || null, ...qInfo };
      }
      return null;
    } catch {
      if (i + 1 >= attempts.length) return null;
    }
  }
  return null;
}

const cleanLangName = (raw = "") => {
  const s = String(raw || "").trim();
  if (!s || /^auto$/i.test(s)) return "Original";
  return s[0].toUpperCase() + s.slice(1);
};

export async function resolveVidzeeDirect({
  tmdbId,
  type = "movie",
  season = 1,
  episode = 1,
  lang = null,
  proxyBase = "/proxy",
}) {
  if (!tmdbId) return { success: false, streams: [], subtitles: [] };

  const mediaPath =
    type === "tv" ? `tv/${encodeURIComponent(tmdbId)}/${season}/${episode}` : `movie/${encodeURIComponent(tmdbId)}`;

  const cryptoPromiseLocal = getCrypto().catch(() => null);

  const langsPromise = fetch(`${VIDZEE_CORE}/streams/languages/${mediaPath}`, {
    headers: CORE_HEADERS,
    signal: AbortSignal.timeout(2600),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  const subsPromise = fetch(`${VIDZEE_CORE}/subs/${mediaPath}`, {
    headers: CORE_HEADERS,
    signal: AbortSignal.timeout(3200),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  const fetchServer = async (srv) => {
    try {
      const r = await fetch(`${VIDZEE_CORE}/streams/${mediaPath}?s=${encodeURIComponent(srv)}&e=1`, {
        headers: CORE_HEADERS,
        signal: AbortSignal.timeout(3500),
      });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      if (!j) return null;
      let decoded = j;
      if (typeof j.c === "string" && !j.url) {
        const crypto = await cryptoPromiseLocal;
        if (!crypto) return null;
        decoded = crypto.decrypt(j.c);
      }
      if (!decoded?.url) return null;
      const probe = await probePlayableUrl(decoded.url, decoded.headers || {});
      if (!probe) return null;
      return {
        srv,
        language: cleanLangName(decoded.language || (srv.includes(":") ? srv.split(":")[1] : "Auto")),
        rawLanguage: String(decoded.language || (srv.includes(":") ? srv.split(":")[1] : "Auto")).trim(),
        url: decoded.url,
        referer: probe.referer,
        isHls: probe.isHls,
        maxResolution: probe.maxResolution || 0,
        hasMultiQuality: Boolean(probe.hasMultiQuality),
        heights: probe.heights || [],
      };
    } catch {
      return null;
    }
  };

  const reqLangClean = String(lang || "")
    .replace(/^vidzee:/i, "")
    .replace(/\s*dub\b/i, "")
    .trim();
  const reqLang = reqLangClean.toLowerCase();
  const isSpecificLangRequest = Boolean(reqLang && reqLang !== "auto" && reqLang !== "original" && !/^\d+$/.test(reqLang));

  const baseServers = ["v6:English", "v6:Hindi", "v4:Hindi", "v4:English", "tik", ...(type === "movie" ? ["peak"] : [])];
  if (isSpecificLangRequest) {
    const cap = reqLangClean.charAt(0).toUpperCase() + reqLangClean.slice(1);
    for (const variant of new Set([reqLangClean, cap])) {
      for (const prefix of ["v6", "v4"]) {
        const s = `${prefix}:${variant}`;
        if (!baseServers.some((b) => b.toLowerCase() === s.toLowerCase())) {
          baseServers.unshift(s);
        }
      }
    }
  }
  const baseTasks = baseServers.map((s) => fetchServer(s));

  const langsData = await langsPromise;
  const extraLangs = Array.isArray(langsData?.languages)
    ? langsData.languages.map((l) => String(l).trim()).filter(Boolean)
    : [];

  const queried = new Set(baseServers.map((s) => s.toLowerCase()));
  const extraServers = [];
  if (isSpecificLangRequest) {
    for (const l of extraLangs) {
      if (!l.toLowerCase().includes(reqLang)) continue;
      for (const prefix of ["v6", "v4"]) {
        const srv = `${prefix}:${l}`;
        if (!queried.has(srv.toLowerCase())) {
          queried.add(srv.toLowerCase());
          extraServers.push(srv);
        }
      }
    }
  }
  for (const l of extraLangs) {
    for (const prefix of ["v6", "v4"]) {
      const srv = `${prefix}:${l}`;
      if (!queried.has(srv.toLowerCase())) {
        queried.add(srv.toLowerCase());
        extraServers.push(srv);
      }
    }
  }
  // Cap dynamic extra queries so sluggish streams never stall playback start
  const extraTasks = extraServers.slice(0, isSpecificLangRequest ? 8 : 6).map((s) => fetchServer(s));

  const [resolvedList, subsRaw] = await Promise.all([
    Promise.all([...baseTasks, ...extraTasks]),
    subsPromise,
  ]);

  const working = resolvedList.filter(Boolean);
  if (working.length === 0) {
    return { success: false, streams: [], subtitles: [] };
  }

  // Deduplicate identical URLs
  const seenUrl = new Set();
  const deduped = [];
  for (const w of working) {
    if (!seenUrl.has(w.url)) {
      seenUrl.add(w.url);
      deduped.push(w);
    }
  }

  const matchesRequestedLang = (w) => {
    if (!isSpecificLangRequest) return true;
    const l = w.language.toLowerCase();
    const r = w.rawLanguage.toLowerCase();
    return l === reqLang || l.includes(reqLang) || r === reqLang || r.includes(reqLang);
  };

  if (isSpecificLangRequest && !deduped.some(matchesRequestedLang)) {
    return {
      success: false,
      streams: [],
      dubs: deduped.map((s) => ({ id: `vidzee:${s.language}`, label: s.language, selected: false })),
      subtitles: [],
      error: `${reqLangClean} audio is unavailable on Server 2`,
    };
  }

  // Order streams: requested language -> Hindi -> English -> Original/Auto -> others; break ties by multi-quality & resolution
  const scoreStream = (w) => {
    const l = w.language.toLowerCase();
    let base = 30;
    if (isSpecificLangRequest && matchesRequestedLang(w)) base = 100;
    else if (l === "hindi" || l.includes("hindi")) base = 90;
    else if (l === "english") base = 70;
    else if (l === "original" || l === "auto") base = 60;
    const resScore = Math.min(w.maxResolution || 0, 2160) / 1000;
    const multiBonus = w.hasMultiQuality ? 5 : 0;
    return base * 10 + multiBonus + resScore;
  };
  deduped.sort((a, b) => scoreStream(b) - scoreStream(a));

  const toProxiedUrl = (s) => {
    const qs = new URLSearchParams({ url: s.url });
    if (s.isHls) qs.set("playlist", "1");
    if (s.referer) qs.set("referer", s.referer);
    else qs.set("noref", "1");
    return `${proxyBase}?${qs.toString()}`;
  };

  // Pick streams matching the active language first, plus keep all Vidzee servers as fallbacks/options
  const activeLang = deduped[0].language;
  const activeLangLower = activeLang.toLowerCase();

  // Group distinct Vidzee audio tracks for UI track switching
  const seenLangs = new Set();
  const dubs = [];
  for (const s of deduped) {
    const key = s.language.toLowerCase();
    if (seenLangs.has(key)) continue;
    seenLangs.add(key);
    dubs.push({
      id: `vidzee:${s.language}`,
      label: s.language,
      selected: key === activeLangLower,
    });
  }

  const activeGroup = deduped.filter((s) => s.language.toLowerCase() === activeLangLower);
  const primaryStreams = activeGroup.length > 0 ? activeGroup : [deduped[0]];
  const otherStreams = deduped.filter((s) => s.language.toLowerCase() !== activeLangLower);

  const serverLabel = (srv) => {
    if (srv === "tik") return "Server 2";
    if (srv === "peak") return "Server 3";
    if (srv.startsWith("v6:")) return "Server 1";
    if (srv.startsWith("v4:")) return "Server 4";
    return "Server 5";
  };

  const formatStream = (s, idx) => {
    const pUrl = toProxiedUrl(s);
    const maxR = s.maxResolution || 0;
    const resTag = maxR >= 2160 ? "2160p" : maxR > 0 ? `${maxR}p` : "HD";
    const qual = primaryStreams.length > 1
      ? `${resTag}${s.hasMultiQuality ? " Multi" : ""} · ${serverLabel(s.srv)}`
      : (maxR > 0 ? `${resTag}${s.hasMultiQuality ? " (Multi)" : ""}` : "HD (Auto)");
    return {
      id: `vz_${idx}_${s.srv}`,
      quality: qual,
      resolutionNum: maxR,
      hasMultiQuality: Boolean(s.hasMultiQuality),
      heights: s.heights || [],
      format: s.isHls ? "hls" : "mp4",
      url: s.url,
      rawStreamUrl: s.url,
      streamUrl: pUrl,
      proxyStreamUrl: pUrl,
      language: s.language,
      srv: s.srv,
    };
  };

  const formattedPrimary = primaryStreams.map(formatStream);
  const altSource = primaryStreams[1] || otherStreams[0] || null;

  const subtitles = Array.isArray(subsRaw)
    ? subsRaw
        .filter((s) => s && typeof s.file === "string" && s.file.startsWith("http"))
        .slice(0, 60)
        .map((s, idx) => {
          const lbl = String(s.label || "English").trim();
          const pSub = `${proxyBase}?url=${encodeURIComponent(s.file)}&referer=${encodeURIComponent(`${VIDZEE_PLAYER}/`)}`;
          return {
            id: `vz_sub_${idx}`,
            label: lbl,
            language: lbl.replace(/\s+\d+$/, ""),
            lang: lbl.slice(0, 3).toLowerCase(),
            url: pSub,
            rawUrl: s.file,
            source: "Vidzee",
          };
        })
    : [];

  return {
    success: true,
    providerId: "vidzee",
    activeLanguage: activeLang,
    streamUrl: formattedPrimary[0].proxyStreamUrl,
    altProxyUrl: altSource ? toProxiedUrl(altSource) : undefined,
    streams: formattedPrimary,
    dubs,
    subtitles,
  };
}
