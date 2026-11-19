// Dedicated Manhwa servers router.
// Supports Asura Scans (api.asurascans.com), Demonic Scans (demonicscans.org), ComicK (api.comick.dev), and MangaDex (lang=ko).
import * as asura from "./asura.js";
import * as demonic from "./demonicscans.js";
import * as comick from "./comick.js";
import * as dex from "./mangadex.js";

export const SOURCES = ["asura", "demonicscans", "comick", "mangadex"];
export const DEFAULT_SOURCE = "asura";

export function parseSource(id) {
  const s = String(id || "").trim().toLowerCase();
  if (s === "ds" || s === "demonic" || s === "demonicscans") return "demonicscans";
  if (s === "asurascans") return "asura";
  return SOURCES.includes(s) ? s : DEFAULT_SOURCE;
}

const isManhwaItem = (m) => {
  if (!m) return false;
  const t = String(m.type || "").toLowerCase();
  return !/manga|manhua/i.test(t);
};

export async function getHome(source = DEFAULT_SOURCE) {
  if (source === "asura") {
    const d = await asura.getHome();
    return {
      trending: (d.trending || []).filter(isManhwaItem),
      latest: (d.latest || []).filter(isManhwaItem),
      newRelease: (d.newRelease || []).filter(isManhwaItem),
    };
  }
  if (source === "demonicscans") return demonic.getHome();
  if (source === "comick") {
    const d = await comick.getHome(false, "ko");
    return {
      trending: (d.trending || []).filter(isManhwaItem),
      latest: (d.latest || []).filter(isManhwaItem),
      newRelease: (d.newRelease || []).filter(isManhwaItem),
    };
  }
  if (source === "mangadex") return dex.getHome("ko");
  return asura.getHome();
}

export async function search(q, source = DEFAULT_SOURCE) {
  if (source === "asura") return asura.search(q);
  if (source === "demonicscans") return demonic.search(q);
  if (source === "comick") {
    const d = await comick.search(q, false);
    return { results: (d.results || []).filter(isManhwaItem) };
  }
  if (source === "mangadex") return dex.search(q, "ko");
  return asura.search(q);
}

export async function getChapters(id, source = DEFAULT_SOURCE) {
  if (source === "asura") return asura.getChapters(id);
  if (source === "demonicscans") return demonic.getChapters(id);
  if (source === "comick") return comick.getChapters(id);
  if (source === "mangadex") return dex.getChapters(id);
  return asura.getChapters(id);
}

export async function getPages(chapterId, source = DEFAULT_SOURCE) {
  if (source === "asura") return asura.getPages(chapterId);
  if (source === "demonicscans") return demonic.getPages(chapterId);
  if (source === "comick") return comick.getPages(chapterId);
  if (source === "mangadex") return dex.getPages(chapterId);
  return asura.getPages(chapterId);
}
