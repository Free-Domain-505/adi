// Asura Scans (https://asurascans.com) direct API source via https://api.asurascans.com.
const API = "https://api.asurascans.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": UA,
  Origin: "https://asurascans.com",
  Referer: "https://asurascans.com/",
  Accept: "application/json",
};

async function apiGet(path) {
  const r = await fetch(`${API}${path}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`Asura API ${r.status}`);
  return r.json();
}

function normType(t) {
  const s = String(t || "").trim().toLowerCase();
  if (s === "manga") return "Manga";
  if (s === "manhua") return "Manhua";
  return "Manhwa";
}

function mapSeries(s) {
  const id = String(s?.slug || s?.id || "").trim();
  if (!id) return null;
  const latestCh = Array.isArray(s.latest_chapters) && s.latest_chapters[0]?.number != null
    ? `Ch. ${s.latest_chapters[0].number}`
    : null;
  return {
    id,
    title: s.title || "Untitled",
    poster: s.cover || s.cover_url || "",
    type: normType(s.type),
    status: s.status || null,
    latest: latestCh,
    updated: s.last_chapter_at || s.updated_at || null,
    score: s.rating ? Number(s.rating) || null : null,
    chapters: s.chapter_count ?? null,
    source: "asura",
  };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((m) => m && !seen.has(m.id) && seen.add(m.id));
}

export async function getHome() {
  const [pop, lat, nw] = await Promise.allSettled([
    apiGet("/api/series?sort=popular&page=1"),
    apiGet("/api/series?sort=latest&page=1"),
    apiGet("/api/series?sort=newest&page=1"),
  ]);

  const toList = (res) =>
    res.status === "fulfilled" && Array.isArray(res.value?.data)
      ? dedupe(res.value.data.map(mapSeries))
      : [];

  const trending = toList(pop);
  const latest = toList(lat);
  const newRelease = toList(nw);

  if (!trending.length && !latest.length && !newRelease.length) {
    throw new Error("Asura Scans returned no series");
  }

  return {
    trending: trending.length ? trending : latest,
    latest: latest.length ? latest : trending,
    newRelease: newRelease.length ? newRelease : latest,
  };
}

export async function search(term) {
  const q = String(term || "").trim();
  if (!q) return { results: [] };
  const d = await apiGet(`/api/series?search=${encodeURIComponent(q)}&page=1`);
  return {
    results: dedupe((d?.data || []).map(mapSeries)),
  };
}

export async function getChapters(id) {
  const slug = String(id || "").trim();
  if (!slug) return { id: slug, chapters: [] };
  const d = await apiGet(`/api/series/${encodeURIComponent(slug)}/chapters`);
  const list = Array.isArray(d?.data) ? d.data : [];

  const chapters = list
    .filter((c) => !c.is_premium)
    .map((c, i) => {
      const chSlug = c.slug || `chapter-${c.number ?? i + 1}`;
      const seriesSlug = c.series_slug || slug;
      const num = c.number != null ? String(c.number) : String(i + 1);
      return {
        chapterId: `${seriesSlug}::${chSlug}`,
        number: num,
        title: c.title && !/^chapter\s/i.test(c.title) ? c.title : null,
        date: c.published_at || c.created_at || null,
        group: "Asura Scans",
        volume: null,
      };
    })
    .sort((a, b) => parseFloat(a.number) - parseFloat(b.number));

  return { id: slug, chapters };
}

export async function getPages(chapterId) {
  const raw = String(chapterId || "").trim();
  if (!raw) return { chapterId: raw, pages: [] };

  let seriesSlug = "";
  let chapterSlug = "";

  if (raw.includes("::")) {
    const idx = raw.indexOf("::");
    seriesSlug = raw.slice(0, idx);
    chapterSlug = raw.slice(idx + 2);
  } else if (raw.includes("/")) {
    const idx = raw.indexOf("/");
    seriesSlug = raw.slice(0, idx);
    chapterSlug = raw.slice(idx + 1);
  } else {
    throw new Error("Invalid Asura chapter id");
  }

  const d = await apiGet(
    `/api/series/${encodeURIComponent(seriesSlug)}/chapters/${encodeURIComponent(chapterSlug)}`
  );
  const rawPages = d?.data?.chapter?.pages || d?.data?.pages || [];
  const pages = rawPages
    .map((p) => (typeof p === "string" ? p : p?.url || p?.src || ""))
    .filter((u) => /^https?:\/\//.test(u));

  return { chapterId: raw, pages };
}
