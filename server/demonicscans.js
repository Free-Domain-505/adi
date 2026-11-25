// Demonic Scans (https://demonicscans.org) manga source.
// Mirrors the Android app's DemonicScansRepository with worker proxy acceleration and direct scraping fallback.

const BASE_URL = "https://demonicscans.org";
const WORKER = "https://brhgxkmnoken-mud-a7f7nyroxx.ammhfoo.workers.dev";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Referer: `${BASE_URL}/`,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? await res.text() : "";
  } catch (e) {
    console.warn(`[DemonicScans] fetchHtml failed for ${url}:`, e.message);
    return "";
  }
}

async function fetchWorker(params) {
  try {
    const q = new URLSearchParams(params);
    q.set("source", "demonicscans");
    const res = await fetch(`${WORKER}/?${q}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function cleanHtmlText(text) {
  return (text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePosterUrl(raw) {
  let u = String(raw || "").trim().replace(/ /g, "%20");
  if (!u || /^data:image\//i.test(u)) return "";
  if (u.startsWith("//")) u = `https:${u}`;
  else if (u.startsWith("/")) u = `${BASE_URL}${u}`;
  return u;
}

function extractImgSrc(html) {
  const m =
    html.match(/<img[^>]+data-src=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<img[^>]+data-lazy-src=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  return normalizePosterUrl(m?.[1] || "");
}

function parseMangaCards(html) {
  const list = [];
  const regex = /<a\b([^>]*href=(?:"(\/manga\/[^"]+)"|'(\/manga\/[^']+)')[^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const href = match[2] || match[3];
    const inner = match[4];
    const titleAttr = attrs.match(/title="([^"]+)"/i) || attrs.match(/title='([^']+)'/i);
    const h1Match = inner.match(/<h1[^>]*>([^<]+)/i);
    const title = cleanHtmlText(titleAttr?.[1] || h1Match?.[1] || "");
    const img = extractImgSrc(inner);
    const slug = href.replace(/^\/manga\//, "").trim();
    if (slug && title) {
      list.push({
        id: `ds_${slug}`,
        title,
        poster: img,
        type: "Manhwa",
        source: "demonicscans",
      });
    }
  }
  const seen = new Set();
  return list.filter((c) => !seen.has(c.id) && seen.add(c.id));
}

export async function getHome() {
  const html = await fetchHtml(BASE_URL);
  if (!html) return { trending: [], latest: [], newRelease: [] };

  const cards = parseMangaCards(html);
  const trending = cards.slice(0, 20);
  const latest = cards.slice(20, 50).length ? cards.slice(20, 50) : cards.slice(0, 25);
  return { trending, latest, newRelease: cards.slice(0, 24) };
}

export async function search(term) {
  const q = String(term || "").trim();
  if (!q) return { results: [] };

  const enc = encodeURIComponent(q);
  const html = await fetchHtml(`${BASE_URL}/search.php?manga=${enc}`);
  if (!html) return { results: [] };

  const linkRegex = /<a[^>]*href=(?:"(\/manga\/[^"]+)"|'(\/manga\/[^']+)')[^>]*>([\s\S]*?)<\/a>/gi;
  const list = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1] || match[2];
    const inner = match[3];
    const divMatch = inner.match(/<div>([\s\S]*?)<\/div>/i);
    const img = extractImgSrc(inner);
    const title = cleanHtmlText(divMatch?.[1] || "");
    const slug = href.replace(/^\/manga\//, "").trim();
    if (slug && title) {
      list.push({
        id: `ds_${slug}`,
        title,
        poster: img,
        type: "Manhwa",
        source: "demonicscans",
      });
    }
  }

  const seen = new Set();
  return { results: list.filter((c) => !seen.has(c.id) && seen.add(c.id)) };
}

function mapWorkerChapters(cleanId, wChaps) {
  return {
    id: cleanId,
    chapters: wChaps
      .map((c, i) => ({
        chapterId: String(c.chapterId || c.id || `ds_${i + 1}`),
        number: String(c.number || c.chapter || i + 1),
        title: c.title && !/^chapter\s/i.test(c.title) ? c.title : `Chapter ${c.number || i + 1}`,
        date: c.releaseDate || c.date || null,
      }))
      .sort((a, b) => parseFloat(a.number) - parseFloat(b.number)),
  };
}

export async function getChapters(id) {
  const cleanId = String(id || "").trim();

  // If this looks like a worker ULID/id rather than a ds_ slug, check worker first
  if (cleanId && !cleanId.startsWith("ds_")) {
    const workerData = await fetchWorker({ action: "chapters", id: cleanId });
    const wChaps = workerData?.chapters || workerData?.data || [];
    if (Array.isArray(wChaps) && wChaps.length) {
      return mapWorkerChapters(cleanId, wChaps);
    }
  }

  let slug = cleanId.replace(/^ds_/, "");

  // Direct HTML scrape from Demonic Scans
  let html = await fetchHtml(`${BASE_URL}/manga/${slug}`);

  // If slug was unknown or altered, search directly
  if (!html && slug) {
    const enc = encodeURIComponent(slug.replace(/-/g, " "));
    const searchHtml = await fetchHtml(`${BASE_URL}/search.php?manga=${enc}`);
    const match = /<a[^>]*href=["']\/manga\/([^"']+)["']/i.exec(searchHtml || "");
    if (match?.[1]) {
      slug = match[1].trim();
      html = await fetchHtml(`${BASE_URL}/manga/${slug}`);
    }
  }

  if (html) {
    const chRegex = /<a\s+[^>]*href=["']\/?chaptered\.php\?manga=(\d+)&(?:amp;)?chapter=([^"'&]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const chapters = [];
    let match;
    while ((match = chRegex.exec(html)) !== null) {
      const numId = match[1];
      const chNum = match[2].trim();
      const inner = match[3];
      if (inner.toLowerCase().includes("read first chap")) continue;
      const dateMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(inner);
      chapters.push({
        chapterId: `ds_${numId}__${chNum}`,
        number: chNum,
        title: `Chapter ${chNum}`,
        date: dateMatch ? dateMatch[1] : null,
      });
    }

    if (chapters.length) {
      const distinct = [...new Map(chapters.map((c) => [c.number, c])).values()];
      distinct.sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
      return { id: cleanId, chapters: distinct };
    }
  }

  // Fallback: worker chapters
  const workerData = await fetchWorker({ action: "chapters", id: cleanId });
  const wChaps = workerData?.chapters || workerData?.data || [];
  if (Array.isArray(wChaps) && wChaps.length) {
    return mapWorkerChapters(cleanId, wChaps);
  }

  return { id: cleanId, chapters: [] };
}

export async function getPages(chapterId) {
  const raw = String(chapterId || "");
  const clean = raw.replace(/^ds_ch_/, "").replace(/^ds_/, "");

  // Non-HTML chapter IDs go straight to worker first
  if (!clean.includes("__")) {
    const workerData = await fetchWorker({ action: "pages", chapterId });
    const wPages = workerData?.pages || workerData?.images || workerData?.data || [];
    if (Array.isArray(wPages) && wPages.length) {
      return {
        chapterId,
        pages: wPages.map((p) => (typeof p === "string" ? p : p?.url || p?.src || "")).filter((u) => /^https?:\/\//.test(u)),
      };
    }
  }

  if (clean.includes("__")) {
    const [numId, chNum] = clean.split("__");
    const html = await fetchHtml(`${BASE_URL}/chaptered.php?manga=${numId}&chapter=${chNum}`);
    if (html) {
      const imgRegex = /<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
      const pages = [];
      let m;
      while ((m = imgRegex.exec(html)) !== null) {
        let src = m[1].trim();
        if (src.startsWith("//")) src = `https:${src}`;
        else if (src.startsWith("/")) src = `${BASE_URL}${src}`;

        const lower = src.toLowerCase();
        const isBad =
          lower.includes("logo") ||
          lower.includes("free_ads") ||
          lower.includes("icon") ||
          lower.includes("banner") ||
          lower.includes("avatar") ||
          lower.includes("discord") ||
          lower.includes("donate") ||
          lower.includes("patreon") ||
          lower.includes("paypal") ||
          lower.includes("wikimedia") ||
          lower.includes("flaticon") ||
          lower.includes("/img/");

        const isImg =
          lower.endsWith(".jpg") ||
          lower.endsWith(".jpeg") ||
          lower.endsWith(".png") ||
          lower.endsWith(".webp") ||
          lower.includes("/storage/") ||
          lower.includes("/manga/") ||
          lower.includes("/chapter/") ||
          lower.includes("mangafifth") ||
          lower.includes("demonic") ||
          lower.includes("readermc") ||
          lower.includes("mangareadon");

        if (src.startsWith("http") && !isBad && isImg) {
          pages.push(src.replace(/ /g, "%20"));
        }
      }

      const distinct = [...new Set(pages)];
      if (distinct.length) {
        return { chapterId, pages: distinct };
      }
    }
  }

  // Fallback: worker pages
  const workerData = await fetchWorker({ action: "pages", chapterId });
  const wPages = workerData?.pages || workerData?.images || workerData?.data || [];
  if (Array.isArray(wPages) && wPages.length) {
    return {
      chapterId,
      pages: wPages.map((p) => (typeof p === "string" ? p : p?.url || p?.src || "")).filter((u) => /^https?:\/\//.test(u)),
    };
  }

  return { chapterId, pages: [] };
}
