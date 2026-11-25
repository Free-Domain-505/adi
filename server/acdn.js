// ACDN: multi-audio direct streams, resolved server-side.
// Port of the Android app's MultiAudioExtractor.kt (CloudStream AnimeDekho flow by phisher98):
//   1. anime-mapping.json  -> saltId / season / episode for the AniList id
//   2. AnimeDekho          -> search, episode page, iframes, then the ?trdekho=0..4 players
//   3. AnimeSalt (fallback) -> options-0 / options-1 / loadMi() players
// Each player page is turned into a direct stream: as-cdn / ravok getVideo
// (HLS master playlist with several audio tracks), player.php multi-language, Pixel, or a plain .m3u8 / .mp4.
// Only direct streams are returned - an iframe can't be played by Zenkai's own player.
import { ANIME_MAPPING, pickMapping } from "./mapping.js";
import { normalizeAnimeSaltTitle, cleanTitleForSlug, extractSeason } from "./animesalt.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEKHO = "https://animedekho.app";
const DEKHO_COOKIE = "toronites_server=vidstream";
const SALT_MIRRORS = ["https://animesalt.cx", "https://animesalt.ac", "https://animesalt.ro"];
const MAX_DEPTH = 3; // guards nested iframe -> iframe -> iframe chains

/* ---------------- HTTP helpers ---------------- */
async function httpGet(url, referer, cookie, timeoutMs = 7500) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const headers = {
        "User-Agent": UA,
        Referer: referer,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      };
      if (cookie) headers.Cookie = cookie;
      const r = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) {
        const text = await r.text();
        if (text.length > 50) return text;
      }
      if (r.status === 404) return null;
      if (attempt === 0 && (r.status === 429 || r.status >= 500)) {
        await new Promise((res) => setTimeout(res, 250));
        continue;
      }
      return null;
    } catch {
      if (attempt === 0) {
        await new Promise((res) => setTimeout(res, 200));
        continue;
      }
      return null;
    }
  }
  return null;
}

const abs = (u, base) => {
  try {
    return new URL(u, base).href;
  } catch {
    return u;
  }
};
const usable = (u) => !!u && u.trim() !== "" && u.trim().toLowerCase() !== "about:blank";
const decodeB64 = (raw) => {
  const clean = raw.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const bin = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

const direct = (url, referer, kind, subtitles = []) => ({
  streamUrl: url,
  referer,
  kind: kind || (/\.m3u8(\?|$)/i.test(url) ? "hls" : "file"),
  isDirect: true,
  subtitles,
});

/* ---------------- Player resolvers ---------------- */

function extractSubtitlesFromPlayer(html, domain = "ravok.buzz") {
  if (!html) return [];
  const subs = [];

  const pjsMatch =
    html.match(/playerjsSubtitle\s*=\s*["']([^"']+)["']/i) ||
    html.match(/Subtitle\s*=\s*["'](\[[^"']+\]https?[^"']+)["']/i);

  if (pjsMatch && pjsMatch[1]) {
    const raw = pjsMatch[1].trim();
    const parts = raw.split(/,(?=\[|https?:\/\/)/);
    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      const m = p.match(/^\[([^\]]+)\](.*)$/);
      if (m) {
        const label = m[1].trim();
        let file = m[2].trim();
        if (file.startsWith("//")) file = `https:${file}`;
        if (file.startsWith("http")) {
          subs.push({ label, file, kind: "captions" });
        }
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
    const labelMatch = tag.match(/label=["']([^"']+)["']/i);
    const langMatch = tag.match(/srclang=["']([^"']+)["']/i);
    const label = labelMatch?.[1] || langMatch?.[1] || "English";
    if (file.startsWith("http") && !subs.some((s) => s.file === file)) {
      subs.push({ label, file, kind: "captions" });
    }
  }

  return subs;
}

/** as-cdn / ravok / AWSStream: POST getVideo returns the HLS master playlist (several audio renditions). */
async function resolveAsCdnSingle(domain, hash) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`https://${domain}/player/index.php?data=${hash}&do=getVideo`, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Referer: `https://${domain}/video/${hash}`,
          Origin: `https://${domain}`,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: new URLSearchParams({ hash, r: "https://animesalt.cx/" }).toString(),
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);

      if (!r || !r.ok) {
        if (attempt === 0 && (!r || r.status === 429 || r.status >= 500)) {
          await new Promise((res) => setTimeout(res, 250));
          continue;
        }
        return null;
      }
      const body = (await r.text()).trim();
      if (!body.startsWith("{")) return null;
      const j = JSON.parse(body);
      const m3u8 =
        (typeof j.videoSource === "string" && j.videoSource) ||
        (typeof j.securedLink === "string" && j.securedLink) ||
        (typeof j.hls === "string" && j.hls) ||
        null;
      if (!m3u8) return null;

      let subtitles = [];
      try {
        const pageRes = await fetch(`https://${domain}/video/${hash}`, {
          headers: { "User-Agent": UA, Referer: "https://animesalt.cx/" },
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);
        if (pageRes && pageRes.ok) {
          const pageHtml = await pageRes.text();
          subtitles = extractSubtitlesFromPlayer(pageHtml, domain);
        }
      } catch {}

      return {
        ...direct(m3u8, `https://${domain}/`, "hls", subtitles),
        isMultiAudioHls: true,
      };
    } catch {
      if (attempt === 0) {
        await new Promise((res) => setTimeout(res, 250));
        continue;
      }
      return null;
    }
  }
  return null;
}

async function resolveAsCdn(domain, hash) {
  const primary = await resolveAsCdnSingle(domain, hash);
  if (primary) return primary;
  if (domain && domain.toLowerCase() !== "ravok.buzz") {
    return resolveAsCdnSingle("ravok.buzz", hash);
  }
  return null;
}

/** player.php / multi-lang-plyr.php: `data=` is a base64 JSON array of { language, link }. */
async function resolveMultiLang(url, lang, depth) {
  try {
    const raw = url.match(/data=([a-zA-Z0-9%+/=_-]+)/)?.[1];
    if (!raw) return null;
    let b64 = raw;
    try {
      b64 = decodeURIComponent(raw);
    } catch {}
    const list = JSON.parse(decodeB64(b64));
    if (!Array.isArray(list)) return null;

    const req = (lang || "").toLowerCase();
    const wantJapanese = /jap|jpn|sub|orig|^ja$/.test(req);
    const wantHindi = /hin|^hi$|dub/.test(req);
    const wantEnglish = /eng|^en$/.test(req);

    let want = null
    let wantLang = ''
    let jp = null
    let jpLang = ''
    let en = null
    let enLang = ''
    let hi = null
    let hiLang = ''
    let first = null
    let firstLang = ''
    const langs = []
    for (const item of list) {
      const language = String(item?.language || '').trim()
      const low = language.toLowerCase()
      const link = String(item?.link || '').replace(/\\\//g, '/')
      if (!link || /abyssplayer|abysscdn|short\.ink|short\.icu|player1\.php|cybervynx|upns\.live|rpmshare|strp2p|vidmoly|filemoon|streamwish|dood|gdmirrorbot|voe\.sx|voe\./i.test(link)) continue
      langs.push(low)
      if (!first) {
        first = link
        firstLang = language
      }
      if (req && low.includes(req) && !want) {
        want = link
        wantLang = language
      }
      if (/japanese|jap|jpn|\bja\b|\bsub\b|original|nihongo/i.test(low) && !/english\s*dub|hindi\s*dub/i.test(low) && !jp) {
        jp = link
        jpLang = language
      }
      if (/hindi|\bhin\b|\bhi\b/i.test(low) && !hi) {
        hi = link
        hiLang = language
      }
      if (/english|\beng\b|\ben\b/i.test(low) && !/sub/i.test(low) && !en) {
        en = link
        enLang = language
      }
    }
    const picked = want
      ? { link: want, lang: wantLang }
      : wantJapanese
        ? (jp ? { link: jp, lang: jpLang } : first ? { link: first, lang: firstLang } : hi ? { link: hi, lang: hiLang } : { link: en, lang: enLang })
        : wantHindi
          ? (hi ? { link: hi, lang: hiLang } : en ? { link: en, lang: enLang } : { link: first, lang: firstLang })
          : wantEnglish
            ? (en ? { link: en, lang: enLang } : hi ? { link: hi, lang: hiLang } : { link: first, lang: firstLang })
            : (hi ? { link: hi, lang: hiLang } : en ? { link: en, lang: enLang } : { link: first, lang: firstLang })
    const link = picked.link
    if (!link) return null
    const res = await resolvePlayer(link, url, lang, depth + 1)
    if (!res) return null
    return {
      ...res,
      audioLabel: res.audioLabel || picked.lang || undefined,
      hasHindi: Boolean(hi) || res.hasHindi,
      hasEnglish: Boolean(en) || res.hasEnglish,
      hasJapanese: Boolean(jp) || res.hasJapanese,
      multiAudio: langs.length > 1 || /ravok|as-cdn/i.test(res.referer || ''),
    }
  } catch {
    return null;
  }
}

/** Pulls a stream out of a player page: nested iframe, as-cdn hash, or a file:/source: config. */
async function resolveFromPage(pageUrl, referer, lang, depth) {
  const html = await httpGet(pageUrl, referer);
  if (!html) return null;

  const nested = html.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1];
  if (usable(nested)) {
    const r = await resolvePlayer(abs(nested.trim(), pageUrl), pageUrl, lang, depth + 1);
    if (r) {
      if (!r.subtitles?.length) {
        try {
          const domain = new URL(pageUrl).hostname;
          const pageSubs = extractSubtitlesFromPlayer(html, domain);
          if (pageSubs.length) r.subtitles = pageSubs;
        } catch {}
      }
      return r;
    }
  }

  const cdn = html.match(/https?:\/\/([a-zA-Z0-9_.-]+)\/video\/([a-zA-Z0-9_-]+)/i);
  if (cdn) {
    const r = await resolveAsCdn(cdn[1], cdn[2]);
    if (r) return r;
  }

  const file = html.match(/(?:file|source|src)\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i)?.[1];
  if (file) {
    let pageSubs = [];
    try {
      const domain = new URL(pageUrl).hostname;
      pageSubs = extractSubtitlesFromPlayer(html, domain);
    } catch {}
    return direct(file, pageUrl, null, pageSubs);
  }
  return null;
}

async function resolveNekomux(url) {
  const m = String(url || "").match(/^https?:\/\/([a-z0-9.-]*nekomux\.com)\/episode\/(\d+)/i);
  if (!m) return null;
  const originHost = `https://${m[1]}`;
  try {
    const r = await fetch(`${originHost}/episode/${m[2]}/source`, {
      headers: { "User-Agent": UA, Referer: url, Accept: "application/json,*/*" },
      signal: AbortSignal.timeout(7000),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const streamUrl = j?.url || j?.streamUrl || null;
    if (!streamUrl) return null;
    return {
      ...direct(streamUrl, `${originHost}/`, j?.type === "mp4" ? "file" : "hls"),
      isMultiAudioHls: true,
      hasHindi: true,
      hasEnglish: true,
      multiAudio: true,
    };
  } catch {
    return null;
  }
}

/** Any player url -> direct stream (or null). Mirrors resolveIframeToServer in MultiAudioExtractor.kt. */
async function resolvePlayer(iframeUrl, referer, lang = "", depth = 0) {
  if (!usable(iframeUrl) || depth > MAX_DEPTH) return null;
  const url = iframeUrl.replace(/&#0*38;/g, "&").replace(/&amp;/gi, "&").trim();

  // 0. Unwrap animestream-child /player/?source=embed&...&url=<target>
  if (/\/player\/\?[^#]*\burl=/i.test(url)) {
    try {
      const inner = new URL(url).searchParams.get("url");
      if (usable(inner) && inner !== url) {
        const r = await resolvePlayer(inner, url, lang, depth + 1);
        if (r) return r;
      }
    } catch {}
  }

  if (/abyssplayer|abysscdn|short\.ink|short\.icu|player1\.php|cybervynx|upns\.live|rpmshare|strp2p|vidmoly|filemoon|streamwish|dood|gdmirrorbot|voe\.sx|voe\./i.test(url)) return null;

  // 0b. Nekomux direct multi-audio HLS endpoint (/episode/<id>/source)
  if (/nekomux\.com\/episode\/\d+/i.test(url)) {
    const r = await resolveNekomux(url);
    if (r) return r;
  }

  // 1. Multi-language player.php (checked first when audio language is requested)
  if (/player\.php|multi-lang-plyr\.php/i.test(url)) {
    const r = await resolveMultiLang(url, lang, depth);
    if (r) return r;
  }

  // 2. as-cdn / ravok / any /video/<hash> CDN player (with health probe)
  const cdn = url.match(/https?:\/\/([a-zA-Z0-9_.-]+)\/video\/([a-zA-Z0-9_-]+)/i);
  if (cdn) {
    const r = await resolveAsCdn(cdn[1], cdn[2]);
    if (r) return r;
  }

  // 3. Pixel player (direct file)
  if (/pixel/i.test(url)) {
    const html = await httpGet(url, referer);
    const f = html?.match(/file\s*:\s*"([^"]+)"/i)?.[1];
    if (f) return direct(f.replace(/\\\//g, "/"), url);
  }

  // 4. Already a stream url
  if (/\.(m3u8|mp4)(\?|$)/i.test(url)) return direct(url, referer);

  // 5. Look inside the page
  return resolveFromPage(url, referer, lang, depth);
}

/* ---------------- AnimeDekho ---------------- */
async function findDekhoEpisodePage(title, season, episode, isMovie) {
  try {
    const searchUrl = `${DEKHO}/?s=${encodeURIComponent(title)}`;
    const html = await httpGet(searchUrl, `${DEKHO}/`, DEKHO_COOKIE);
    if (!html) return null;

    let links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*lnk-blk/gi)].map((m) => m[1]);
    if (!links.length) links = [...html.matchAll(/href="([^"]+)"[^>]*class="lnk-blk"/gi)].map((m) => m[1]);
    if (!links.length) return null;

    const seriesUrl = abs(links[0], DEKHO);
    const seriesHtml = await httpGet(seriesUrl, searchUrl, DEKHO_COOKIE);
    if (!seriesHtml) return null;
    if (isMovie) return seriesUrl;

    // Episode list: prefer the exact season, then fall back to a match on episode number alone.
    const items = [];
    for (const ul of seriesHtml.matchAll(/<ul[^>]+class="[^"]*seasons-lst[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi)) {
      for (const li of ul[1].matchAll(/<li>([\s\S]*?)<\/li>/gi)) {
        const href = li[1].match(/href="([^"]+)"/i)?.[1];
        const m = li[1].match(/<span>S(\d+)-E(\d+)<\/span>|E(\d+)|Episode\s*(\d+)/i);
        if (!href || !m) continue;
        const ep = Number(m[2] || m[3] || m[4] || m[1]);
        const se = m[2] ? Number(m[1]) : null;
        items.push({ href: abs(href, seriesUrl), ep, se });
      }
    }
    const exact = items.find((i) => i.ep === episode && i.se === season);
    if (exact) return exact.href;
    if (season === 1) {
      const loose = items.find((i) => i.ep === episode && (!i.se || i.se === 1));
      if (loose) return loose.href;
    }

    const epi = [...seriesHtml.matchAll(/href="([^"]*\/epi\/[^"]+)"/gi)].map((m) => m[1]);
    const hit =
      epi.find((l) => l.includes(`-${season}x${episode}/`)) ||
      (season === 1 ? epi.find((l) => l.includes(`x${episode}/`) || l.includes(`-${episode}/`)) : null);
    return hit ? abs(hit, seriesUrl) : null;
  } catch {
    return null;
  }
}

async function fromAnimeDekho({ title, season, episode, finalEp = episode, isMovie, saltId, slugs = [] }, lang) {
  try {
    let epUrl = await findDekhoEpisodePage(title, season, episode, isMovie);
    if (!epUrl && finalEp !== episode) {
      epUrl = await findDekhoEpisodePage(title, season, finalEp, isMovie);
    }
    if (!epUrl) {
      const candidates = slugs.map((s) => `${DEKHO}/epi/${s}/`);
      for (const cand of candidates) {
        const html = await httpGet(cand, `${DEKHO}/`, DEKHO_COOKIE);
        if (html && html.length > 500) {
          epUrl = cand;
          break;
        }
      }
    }
    if (!epUrl) return null;

    const epHtml = await httpGet(epUrl, `${DEKHO}/`, DEKHO_COOKIE);
    if (!epHtml) return null;

    // iframes on the episode page (embed -> as-cdn -> getVideo)
    const iframes = [...epHtml.matchAll(/<iframe[^>]+src="([^"]+)"/gi)]
      .map((m) => m[1].trim())
      .filter(usable)
      .sort((a, b) => (/ravok|as-cdn|zephyrflick|aws/i.test(b) ? 1 : 0) - (/ravok|as-cdn|zephyrflick|aws/i.test(a) ? 1 : 0));
    for (const src of iframes) {
      const r = await resolvePlayer(abs(src, epUrl), epUrl, lang);
      if (r) return { ...r, slug: epUrl.match(/\/epi\/([^/]+)/)?.[1] || slugs[0] };
    }

    // post id from the body class, then the trdekho=0..4 player slots
    const bodyClass = epHtml.match(/<body[^>]+class="([^"]+)"/i)?.[1] || "";
    const postId = bodyClass.match(/(?:term|postid)-(\d+)/)?.[1];
    if (postId) {
      const type = isMovie ? 1 : 2;
      for (let n = 0; n <= 4; n++) {
        const trUrl = `${DEKHO}/?trdekho=${n}&trid=${postId}&trtype=${type}`;
        const html = await httpGet(trUrl, epUrl, DEKHO_COOKIE);
        const src = html?.match(/<iframe[^>]+src="([^"]+)"/i)?.[1]?.trim();
        if (!usable(src)) continue;
        const r = await resolvePlayer(abs(src, trUrl), trUrl, lang);
        if (r) return { ...r, slug: epUrl.match(/\/epi\/([^/]+)/)?.[1] || slugs[0] };
      }
    }
  } catch {
    /* fall through to AnimeSalt */
  }
  return null;
}

/* ---------------- AnimeSalt fallback ---------------- */
function optionIframe(html, id, base) {
  const altId = id.replace("options-", "opt-");
  const m =
    html.match(new RegExp(`<div[^>]+id=["'](?:${id}|${altId})["'][^>]*>[\\s\\S]*?<iframe[^>]+(?:data-src|src)=["']([^"']+)["']`, "i"));
  const u = m?.[1]?.replace(/&#0*38;/g, "&")?.replace(/&amp;/gi, "&")?.trim();
  return usable(u) ? abs(u, base) : null;
}

async function resolveSaltHtml(html, mirror, s, lang) {
  const candidates = [];
  for (const opt of ["options-0", "options-1", "options-2"]) {
    const u = optionIframe(html, opt, mirror);
    if (u) candidates.push(u);
  }
  for (const m of html.matchAll(/loadMi\(\{\s*value:\s*['"]([^'"]+)['"]/gi)) {
    try {
      const src = decodeB64(m[1]).match(/<iframe[^>]*(?:data-src|src)=["']([^"']+)["']/i)?.[1]?.replace(/&#0*38;/g, "&")?.replace(/&amp;/gi, "&")?.trim();
      if (usable(src)) candidates.push(abs(src, mirror));
    } catch {}
  }
  // Also extract inline iframes (e.g. animesalt.ro animestream-child player?url=...nekomux...)
  for (const ifr of html.matchAll(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/gi)) {
    const src = ifr[1]?.replace(/&#0*38;/g, "&")?.replace(/&amp;/gi, "&")?.trim();
    if (usable(src)) candidates.push(abs(src, mirror));
  }

  const deduped = [...new Set(candidates)].slice(0, 6);
  if (!deduped.length) return null;

  // Prefer direct multi-audio HLS (ravok / as-cdn / zephyrflick / nekomux) first; player.php is fallback
  const preferHindi = /hin|dub|^$/i.test((lang || "").trim());
  const ordered = [...deduped].sort((a, b) => {
    const score = (u) => (/ravok|as-cdn|zephyrflick|aws|nekomux/i.test(u) ? 3 : /player\.php|multi-lang/i.test(u) ? 2 : 1);
    return score(b) - score(a);
  });

  let bestFallback = null;
  for (const u of ordered) {
    const r = await resolvePlayer(u, `${mirror}/`, lang);
    if (!r) continue;
    const isAsCdnMulti = /ravok|as-cdn|zephyrflick|nekomux/i.test(r.referer || "") || r.hasHindi || r.isMultiAudioHls;
    if (!preferHindi || isAsCdnMulti) return { ...r, slug: s };
    bestFallback ??= { ...r, slug: s };
  }
  return bestFallback;
}

async function fromAnimeSalt({ slugs = [], isMovie }, lang) {
  for (const s of slugs) {
    const path = isMovie ? `/movies/${s}/` : `/episode/${s}/`;
    try {
      const resolved = await Promise.any(
        SALT_MIRRORS.map(async (mirror) => {
          const res = await fetch(`${mirror}${path}`, {
            headers: {
              "User-Agent": UA,
              Referer: `${mirror}/`,
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(5500),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const html = await res.text();
          if (!html || html.length < 50 || (!html.includes("options-") && !html.includes("opt-") && !html.includes("loadMi") && !html.includes("<iframe"))) {
            throw new Error("no players");
          }
          const hit = await resolveSaltHtml(html, mirror, s, lang);
          if (!hit?.streamUrl) throw new Error("no playable stream");
          return hit;
        }),
      );
      if (resolved?.streamUrl) return resolved;
    } catch {}
  }
  return null;
}

/* ---------------- Public API ---------------- */

/** AniList id + episode -> { saltId, season, episode, finalEp, isMovie, slug, mapped }. */
export function resolveCandidate({ anilistId, episode = 1, title = "", isMovie = false, mapping = ANIME_MAPPING }) {
  const mapped = pickMapping(mapping, anilistId, episode, isMovie);
  if (mapped) return { ...mapped, mapped: true };
  if (title) {
    const withoutSeasonSuffix = String(title || "")
      .replace(/\s*\(\d{4}\)\s*$/g, "")
      .replace(/\s*(?:Final\s+Season|Season\s+\d+|\d+(?:st|nd|rd|th)\s+Season|Part\s+\d+|Cour\s+\d+)\s*$/gi, "")
      .trim();
    const saltId = normalizeAnimeSaltTitle(withoutSeasonSuffix || title);
    if (saltId) {
      const season = extractSeason(title);
      return {
        saltId,
        season,
        episode,
        finalEp: episode,
        isMovie: Boolean(isMovie),
        slug: null,
        mapped: false,
      };
    }
  }
  return null;
}

export function getCandidateSlugsForAcdn({ saltId, season = 1, episode = 1, slug, isMovie = false }) {
  if (slug) return [slug, `private-${slug}`];
  if (isMovie) return [saltId, `private-${saltId}`];
  const base = `${saltId}-${season}x${episode}`;
  if ((season || 1) > 1) return [base, `private-${base}`];
  return [
    base,
    `private-${base}`,
    `${saltId}-episode-${episode}`,
    `private-${saltId}-episode-${episode}`,
  ];
}

/**
 * Resolves the ACDN multi-audio stream for one episode.
 * Returns { streamUrl, referer, kind: 'hls' | 'file', mapped, slug } or null.
 */
export async function resolveAcdn({ anilistId, episode = 1, title = "", isMovie = false, lang = "" }) {
  const cand = resolveCandidate({ anilistId, episode, title, isMovie });
  if (!cand || !cand.saltId) return null;
  const slugs = getCandidateSlugsForAcdn({
    saltId: cand.saltId,
    season: cand.season,
    episode: cand.episode,
    slug: cand.slug,
    isMovie: cand.isMovie,
  });
  const slug = cand.slug || slugs[0];
  const ctx = {
    title,
    season: cand.season,
    episode: cand.episode,
    finalEp: cand.episode,
    isMovie: cand.isMovie,
    saltId: cand.saltId,
    slug,
    slugs,
  };

  // Race AnimeSalt & AnimeDekho cleanly: return immediately when either resolves multi-audio HLS,
  // or fall back cleanly without blocking behind a slow failing branch.
  const saltP = fromAnimeSalt(ctx, lang).catch(() => null);
  const dekhoP = fromAnimeDekho(ctx, lang).catch(() => null);

  const firstWin = await Promise.any([
    saltP.then((h) => (h?.streamUrl ? { source: "salt", hit: h } : Promise.reject(new Error("no salt")))),
    dekhoP.then((h) => (h?.streamUrl ? { source: "dekho", hit: h } : Promise.reject(new Error("no dekho")))),
  ]).catch(() => null);

  let hit = firstWin?.hit || null;
  if (firstWin?.source === "dekho" && !hit?.isMultiAudioHls && !hit?.multiAudio) {
    // Give AnimeSalt up to 1.5s to return a multi-audio HLS stream if AnimeDekho only returned single-audio
    const betterSalt = await Promise.race([
      saltP,
      new Promise((res) => setTimeout(() => res(null), 1500)),
    ]);
    if (betterSalt?.streamUrl && (betterSalt.isMultiAudioHls || betterSalt.multiAudio)) {
      hit = betterSalt;
    }
  }
  return hit ? { ...hit, mapped: Boolean(cand.mapped), slug: hit.slug || slug } : null;
}
