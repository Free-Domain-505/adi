export function cleanPosterTitle(title = "") {
  return String(title || "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function posterTitleVariants(title = "") {
  const clean = cleanPosterTitle(title);
  if (!clean) return [];
  const out = [];
  const add = (v) => {
    const t = String(v || "").replace(/\s+/g, " ").trim();
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  };
  add(clean);
  add(clean.replace(/:\s*(Book Version|Side Story|Arise|Ragnarok|Novel|Manhwa|Webtoon)$/i, ""));
  add(clean.replace(/\s*[-:]\s*[^-:]{3,}$/g, ""));
  add(clean.split(/[:\-–—]/)[0]);
  add(clean.replace(/['’`]/g, ""));
  return out;
}

const normWords = (s) =>
  cleanPosterTitle(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

export function titleSimilarity(a = "", b = "") {
  const na = cleanPosterTitle(a).toLowerCase().replace(/[^a-z0-9]/g, "");
  const nb = cleanPosterTitle(b).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const wa = new Set(normWords(a));
  const wb = new Set(normWords(b));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) {
    if (wb.has(w)) inter++;
  }
  const union = new Set([...wa, ...wb]).size;
  let score = inter / union;
  if (na.includes(nb) || nb.includes(na)) score = Math.max(score, 0.72);
  return score;
}

export function isImageMagicBytes(bytes) {
  if (!bytes || bytes.length < 4) return false;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
  // WEBP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return true;
  }
  // SVG text start
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
  if (/^<(?:svg|\?xml)/i.test(head)) return true;
  return false;
}

export function isValidImageResponse({ ok, status, contentType = "", contentLength = null, bytes = null }) {
  if (!ok || (status && (status < 200 || status >= 300))) return false;
  const ct = String(contentType || "").toLowerCase();
  if (/text\/html|application\/json|text\/plain|application\/xml/i.test(ct)) {
    return false;
  }
  if (contentLength !== null && contentLength !== undefined && Number(contentLength) === 0) {
    return false;
  }
  if (bytes && bytes.length === 0) return false;
  if (ct.startsWith("image/")) return true;
  if (bytes && isImageMagicBytes(bytes)) return true;
  return false;
}
