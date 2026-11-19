/**
 * Pure helper utilities for Light Novel / Web Novel search matching & markdown parsing.
 */

export function normalizeNovelSearch(raw = "") {
  return String(raw || "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[:\-–—.,!?/()[\]{}~_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function novelQueryVariants(query = "") {
  const clean = String(query || "").trim();
  const norm = normalizeNovelSearch(clean);
  const out = [];
  const push = (v) => {
    const t = String(v || "").trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(clean);
  push(norm);
  // Common colon-title patterns e.g. "re zero" -> "Re:Zero"
  const words = norm.split(" ").filter((w) => w.length >= 2);
  if (words.length >= 2) {
    push(`${words[0]}:${words[1]}`);
    const longest = [...words].sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 4) push(longest);
  }
  return out;
}

export function scoreNovelMatch(entry, query = "") {
  const qNorm = normalizeNovelSearch(query);
  if (!qNorm) return 1;
  const titleNorm = normalizeNovelSearch(entry?.title || "");
  const slugNorm = normalizeNovelSearch(String(entry?.slug || "").replace(/^\d+~/, ""));
  const authorNorm = normalizeNovelSearch(entry?.author || "");
  const tagsNorm = Array.isArray(entry?.tags) ? entry.tags.map((t) => normalizeNovelSearch(t)) : [];

  if (titleNorm === qNorm) return 5;
  if (titleNorm.startsWith(qNorm)) return 4;
  if (titleNorm.includes(qNorm) || slugNorm.includes(qNorm)) return 3;

  const words = qNorm.split(" ").filter((w) => w.length >= 2);
  if (words.length > 0 && words.every((w) => titleNorm.includes(w) || slugNorm.includes(w))) {
    return 2;
  }
  if (authorNorm.includes(qNorm) || tagsNorm.some((t) => t.includes(qNorm))) {
    return 1;
  }
  return 0;
}

export function stripLeadingMdHeading(line = "") {
  return String(line || "").replace(/^#{1,6}\s+/, "").trim();
}
