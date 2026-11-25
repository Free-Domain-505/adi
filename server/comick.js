// ComicK / Manhua source via https://api.comick.dev
const API = "https://api.comick.dev";
const IMG_CDN = "https://meo.comick.pictures";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function apiGet(path) {
  const r = await fetch(`${API}${path}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`ComicK API ${r.status}`);
  return r.json();
}

function typeOf(m, isManhua) {
  const c = String(m?.country || "").toLowerCase();
  if (c === "kr") return "Manhwa";
  if (c === "cn" || c === "tw" || c === "hk") return "Manhua";
  if (c === "jp") return "Manga";
  return isManhua ? "Manhua" : null;
}

function posterOf(m) {
  const cov = Array.isArray(m?.md_covers) ? m.md_covers[0] : null;
  if (cov?.b2key) return `${IMG_CDN}/${cov.b2key}`;
  if (cov?.gpurl) return cov.gpurl;
  return "";
}

function mapComic(m, isManhua) {
  const id = String(m?.hid || m?.slug || m?.id || "").trim();
  if (!id || !m?.title) return null;
  return {
    id,
    title: m.title,
    poster: posterOf(m),
    type: typeOf(m, isManhua),
    status: m.status === 1 ? "Ongoing" : m.status === 2 ? "Completed" : null,
    latest: m.last_chapter != null ? `Ch. ${m.last_chapter}` : null,
    updated: m.uploaded_at || null,
    score: m.rating ? Number(m.rating) || null : null,
    chapters: m.last_chapter != null ? Number(m.last_chapter) || null : null,
    source: isManhua ? "manhua" : "comick",
  };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((m) => m && !seen.has(m.id) && seen.add(m.id));
}

export async function getHome(isManhua = false, lang = "") {
  const types = isManhua
    ? "comic_types=manhua"
    : lang === "ko"
      ? "comic_types=manhwa"
      : "comic_types=manhwa&comic_types=manga";
  const [topRes, latRes, newRes] = await Promise.allSettled([
    apiGet(`/top?type=trending&${types}`),
    apiGet(`/v1.0/search?sort=uploaded&page=1&limit=24&${types}`),
    apiGet(`/v1.0/search?sort=created_at&page=1&limit=24&${types}`),
  ]);

  const topArr =
    topRes.status === "fulfilled"
      ? topRes.value?.rank || topRes.value?.trending?.["7"] || topRes.value?.recentRank || []
      : [];
  const latArr = latRes.status === "fulfilled" && Array.isArray(latRes.value) ? latRes.value : [];
  const newArr = newRes.status === "fulfilled" && Array.isArray(newRes.value) ? newRes.value : [];

  const trending = dedupe(topArr.map((m) => mapComic(m, isManhua))).slice(0, 24);
  const latest = dedupe(latArr.map((m) => mapComic(m, isManhua))).slice(0, 24);
  const newRelease = dedupe(newArr.map((m) => mapComic(m, isManhua))).slice(0, 24);

  if (!trending.length && !latest.length && !newRelease.length) {
    throw new Error("ComicK returned no titles");
  }

  return {
    trending: trending.length ? trending : latest,
    latest: latest.length ? latest : trending,
    newRelease: newRelease.length ? newRelease : latest,
  };
}

export async function search(term, isManhua = false) {
  const q = String(term || "").trim();
  if (!q) return { results: [] };
  const extra = isManhua ? "&comic_types=manhua" : "";
  const arr = await apiGet(`/v1.0/search?q=${encodeURIComponent(q)}&limit=24${extra}`);
  return {
    results: dedupe((Array.isArray(arr) ? arr : []).map((m) => mapComic(m, isManhua))),
  };
}

export async function getChapters(id) {
  try {
    const d = await apiGet(`/comic/${encodeURIComponent(id)}/chapters?lang=en&limit=300`);
    const list = Array.isArray(d?.chapters) ? d.chapters : [];
    const chapters = list
      .filter((c) => c?.hid && c?.chap != null)
      .map((c) => ({
        chapterId: String(c.hid),
        number: String(c.chap),
        title: c.title || null,
        date: c.created_at || null,
        group: Array.isArray(c.group_name) ? c.group_name[0] || null : null,
        volume: c.vol != null ? String(c.vol) : null,
      }))
      .sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
    return { id, chapters };
  } catch {
    // Allow frontend resolveChaptersWithFallback to auto-switch to Asura / DemonicScans / MangaDex
    return { id, chapters: [] };
  }
}

export async function getPages(chapterId) {
  try {
    const d = await apiGet(`/chapter/${encodeURIComponent(chapterId)}`);
    const imgs = d?.chapter?.md_images || [];
    return {
      chapterId,
      pages: imgs.map((i) => (i?.b2key ? `${IMG_CDN}/${i.b2key}` : "")).filter(Boolean),
    };
  } catch {
    return { chapterId, pages: [] };
  }
}
