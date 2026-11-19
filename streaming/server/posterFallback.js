import {
  cleanPosterTitle,
  isValidImageResponse,
  posterTitleVariants,
  titleSimilarity,
} from "./posterFallbackLogic.js";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function refererForPosterUrl(imgUrl) {
  if (/mangadex\.(org|network)/i.test(imgUrl)) return "https://mangadex.org/";
  if (/asurascans/i.test(imgUrl)) return "https://asurascans.com/";
  if (/asuracomic/i.test(imgUrl)) return "https://asuracomic.net/";
  if (/comick/i.test(imgUrl)) return "https://comick.dev/";
  if (/demonicscans|readermc|mangareadon|mangafifth/i.test(imgUrl)) return "https://demonicscans.org/";
  if (/anilist\.co/i.test(imgUrl)) return "https://anilist.co/";
  return null;
}

async function fetchCandidateImage(imgUrl, corsHeaders = {}, userAgent = DEFAULT_UA) {
  if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) return null;
  const isMd = /mangadex\.(org|network)/i.test(imgUrl);
  const ref = refererForPosterUrl(imgUrl);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const hdrs = {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent": isMd ? "AnimeStream/1.0" : userAgent,
        ...(ref && attempt === 0 ? { Referer: ref } : {}),
      };
      const imgRes = await fetch(imgUrl, {
        headers: hdrs,
        redirect: "follow",
        signal: AbortSignal.timeout(7000),
      });
      if (imgRes.status === 429 || (imgRes.status >= 500 && imgRes.status <= 599)) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        return null;
      }
      if (!imgRes.ok) return null;

      const ct = imgRes.headers.get("Content-Type") || "";
      const cl = imgRes.headers.get("Content-Length");
      if (cl !== null && Number(cl) === 0) return null;

      const buf = new Uint8Array(await imgRes.arrayBuffer());
      if (
        !isValidImageResponse({
          ok: imgRes.ok,
          status: imgRes.status,
          contentType: ct,
          contentLength: cl,
          bytes: buf,
        })
      ) {
        return null;
      }

      let outType = ct;
      if (!outType.toLowerCase().startsWith("image/")) {
        if (buf[0] === 0x89 && buf[1] === 0x50) outType = "image/png";
        else if (buf[0] === 0x52 && buf[1] === 0x49) outType = "image/webp";
        else if (buf[0] === 0x47 && buf[1] === 0x49) outType = "image/gif";
        else outType = "image/jpeg";
      }

      const out = new Headers(corsHeaders);
      out.set("Content-Type", outType);
      out.set("Cache-Control", "public, max-age=3600");
      return new Response(buf, { status: 200, headers: out });
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  return null;
}

async function searchComickCandidates(query, userAgent) {
  const out = [];
  try {
    const r = await fetch(
      `https://api.comick.dev/v1.0/search?q=${encodeURIComponent(query)}&limit=5`,
      { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: AbortSignal.timeout(5500) },
    );
    if (!r.ok) return out;
    const arr = await r.json().catch(() => []);
    if (!Array.isArray(arr)) return out;
    for (const item of arr) {
      const cov = Array.isArray(item?.md_covers) ? item.md_covers[0] : null;
      const url = cov?.b2key ? `https://meo.comick.pictures/${cov.b2key}` : cov?.gpurl || "";
      if (url && item?.title) out.push({ title: item.title, url, scoreBoost: 0.04 });
    }
  } catch {}
  return out;
}

async function searchMangadexCandidates(query) {
  const out = [];
  try {
    const r = await fetch(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=5&includes[]=cover_art`,
      { headers: { "User-Agent": "AnimeStream/1.0", Accept: "application/json" }, signal: AbortSignal.timeout(5500) },
    );
    if (!r.ok) return out;
    const j = await r.json().catch(() => null);
    for (const item of j?.data || []) {
      const attrs = item?.attributes || {};
      const tObj = attrs.title || {};
      const t = tObj.en || (attrs.altTitles || []).map((x) => x.en).find(Boolean) || Object.values(tObj)[0] || query;
      const file = (item.relationships || []).find((rel) => rel.type === "cover_art")?.attributes?.fileName;
      if (file) {
        out.push({ title: t, url: `https://uploads.mangadex.org/covers/${item.id}/${file}.512.jpg`, scoreBoost: 0.03 });
        out.push({ title: t, url: `https://uploads.mangadex.org/covers/${item.id}/${file}`, scoreBoost: 0.02 });
      }
    }
  } catch {}
  return out;
}

async function searchAnilistCandidates(query, userAgent) {
  const out = [];
  globalThis.__alCooldownUntil ??= 0;
  if (Date.now() < globalThis.__alCooldownUntil) return out;
  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": userAgent },
      body: JSON.stringify({
        query: `query ($s: String) {
          kr: Page(perPage: 4) { media(search: $s, type: MANGA, countryOfOrigin: KR, sort: SEARCH_MATCH) {
            title { english romaji } coverImage { extraLarge large }
          } }
          any: Page(perPage: 4) { media(search: $s, type: MANGA, sort: SEARCH_MATCH) {
            title { english romaji } coverImage { extraLarge large }
          } }
        }`,
        variables: { s: query },
      }),
      signal: AbortSignal.timeout(5500),
    });
    if (r.status === 429) {
      const ra = Number(r.headers.get("Retry-After") || "0");
      globalThis.__alCooldownUntil = Date.now() + Math.max(ra * 1000, 12000);
      return out;
    }
    if (!r.ok) return out;
    const j = await r.json().catch(() => null);
    for (const group of [j?.data?.kr?.media, j?.data?.any?.media]) {
      for (const m of group || []) {
        const img = m?.coverImage?.extraLarge || m?.coverImage?.large;
        const t = m?.title?.english || m?.title?.romaji;
        if (img && t) out.push({ title: t, url: img, scoreBoost: 0.05 });
      }
    }
  } catch {}
  return out;
}

async function searchAsuraCandidates(query, userAgent) {
  const out = [];
  try {
    const r = await fetch(`https://api.asurascans.com/api/series?search=${encodeURIComponent(query)}&page=1`, {
      headers: {
        "User-Agent": userAgent,
        Accept: "application/json",
        Origin: "https://asurascans.com",
        Referer: "https://asurascans.com/",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return out;
    const j = await r.json().catch(() => null);
    const list = j?.data?.series || j?.data || [];
    for (const s of Array.isArray(list) ? list.slice(0, 5) : []) {
      const img = s?.cover || s?.cover_url || s?.poster || s?.image;
      if (img && s?.title) out.push({ title: s.title, url: img, scoreBoost: 0.03 });
    }
  } catch {}
  return out;
}

async function searchKitsuCandidates(query, userAgent) {
  const out = [];
  try {
    const r = await fetch(`https://kitsu.io/api/edge/manga?filter[text]=${encodeURIComponent(query)}&page[limit]=4`, {
      headers: { "User-Agent": userAgent, Accept: "application/vnd.api+json" },
      signal: AbortSignal.timeout(5500),
    });
    if (!r.ok) return out;
    const j = await r.json().catch(() => null);
    for (const item of j?.data || []) {
      const a = item?.attributes || {};
      const t = a.canonicalTitle || a.titles?.en || a.titles?.en_jp || query;
      const img = a.posterImage?.large || a.posterImage?.medium || a.posterImage?.original;
      if (img) out.push({ title: t, url: img, scoreBoost: 0.01 });
    }
  } catch {}
  return out;
}

async function searchJikanCandidates(query, userAgent) {
  const out = [];
  try {
    const r = await fetch(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=4`, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(5500),
    });
    if (!r.ok) return out;
    const j = await r.json().catch(() => null);
    for (const item of j?.data || []) {
      const t = item?.title_english || item?.title || query;
      const img =
        item?.images?.webp?.large_image_url ||
        item?.images?.jpg?.large_image_url ||
        item?.images?.webp?.image_url ||
        item?.images?.jpg?.image_url;
      if (img) out.push({ title: t, url: img, scoreBoost: 0.01 });
    }
  } catch {}
  return out;
}

function rankCandidates(rawList, targetTitle, excludeUrls = new Set()) {
  const seen = new Set();
  const scored = [];
  for (const c of rawList) {
    const u = String(c?.url || "").trim();
    if (!u || seen.has(u) || excludeUrls.has(u)) continue;
    seen.add(u);
    const sim = titleSimilarity(c.title || targetTitle, targetTitle);
    scored.push({ url: u, sim, rank: sim + (c.scoreBoost || 0) });
  }
  scored.sort((a, b) => b.rank - a.rank);
  const strong = scored.filter((x) => x.sim >= 0.4);
  return (strong.length ? strong : scored.slice(0, 4)).map((x) => x.url);
}

export async function resolveFallbackPosterResponse(title, { cached, corsHeaders = {}, userAgent = DEFAULT_UA, failedUrl = "" } = {}) {
  const clean = cleanPosterTitle(title);
  if (!clean) return null;

  const variants = posterTitleVariants(clean);
  const exclude = new Set(failedUrl ? [failedUrl] : []);

  const getTierA = () =>
    cached(`poster-cand:a:${clean.toLowerCase()}`, 6 * 3600e3, async () => {
      const q = variants[0] || clean;
      const [ck, md, al] = await Promise.all([
        searchComickCandidates(q, userAgent),
        searchMangadexCandidates(q),
        searchAnilistCandidates(q, userAgent),
      ]);
      const ranked = rankCandidates([...al, ...ck, ...md], clean);
      return ranked.length ? ranked : null;
    });

  const urlsA = (await getTierA()) || [];
  for (const url of urlsA) {
    if (exclude.has(url)) continue;
    const res = await fetchCandidateImage(url, corsHeaders, userAgent);
    if (res) return res;
  }

  const getTierB = () =>
    cached(`poster-cand:b:${clean.toLowerCase()}`, 6 * 3600e3, async () => {
      const secondary = variants[1] || variants[0] || clean;
      const [asura, kitsu, jikan, ck2, md2] = await Promise.all([
        searchAsuraCandidates(clean, userAgent),
        searchKitsuCandidates(clean, userAgent),
        searchJikanCandidates(secondary, userAgent),
        secondary !== variants[0] ? searchComickCandidates(secondary, userAgent) : Promise.resolve([]),
        secondary !== variants[0] ? searchMangadexCandidates(secondary) : Promise.resolve([]),
      ]);
      const ranked = rankCandidates([...asura, ...kitsu, ...jikan, ...ck2, ...md2], clean);
      return ranked.length ? ranked : null;
    });

  const urlsB = (await getTierB()) || [];
  for (const url of urlsB) {
    if (exclude.has(url) || urlsA.includes(url)) continue;
    const res = await fetchCandidateImage(url, corsHeaders, userAgent);
    if (res) return res;
  }

  return null;
}

export { fetchCandidateImage };
