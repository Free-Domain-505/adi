const BLOCKED_PLAYER_HOST_RE =
  /abyssplayer|abysscdn|short\.ink|short\.icu|player1\.php|cybervynx|upns\.live|rpmshare|strp2p|vidmoly|filemoon|streamwish|dood|gdmirrorbot|voe\.sx|voe\./i;

export function isBlockedPlayerHost(url = "") {
  return BLOCKED_PLAYER_HOST_RE.test(String(url || ""));
}

export function getOriginalLanguageForCountry(countryOfOrigin) {
  const c = String(countryOfOrigin || "").trim().toUpperCase();
  if (c === "CN" || c === "TW" || c === "HK") return "Chinese";
  if (c === "KR") return "Korean";
  return "Japanese";
}

export function normalizeLangName(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s || s === "und" || s === "unknown" || s === "default" || s === "original" || s === "sub" || s === "undefined") {
    return null;
  }
  if (s.includes("hindi") || /\b(hin|hi)\b/.test(s)) return "Hindi";
  if (s.includes("tamil") || /\b(tam|ta)\b/.test(s)) return "Tamil";
  if (s.includes("telugu") || /\b(tel|te)\b/.test(s)) return "Telugu";
  if (s.includes("malayalam") || /\b(mal|ml)\b/.test(s)) return "Malayalam";
  if (s.includes("kannada") || /\b(kan|kn)\b/.test(s)) return "Kannada";
  if (s.includes("bengali") || s.includes("bangla") || /\b(ben|bn)\b/.test(s)) return "Bengali";
  if (
    s.includes("chinese") ||
    s.includes("mandarin") ||
    s.includes("cantonese") ||
    s.includes("putonghua") ||
    /\b(chi|zho|zh|cmn|yue)\b/.test(s)
  ) {
    return "Chinese";
  }
  if (s.includes("korean") || /\b(kor|ko)\b/.test(s)) return "Korean";
  if (s.includes("english") || /\b(eng|en)\b/.test(s) || /^dub$/.test(s)) return "English";
  if (s.includes("japanese") || s.includes("jap") || s.includes("jpn") || /\b(ja|jp)\b/.test(s) || s.includes("nihongo")) {
    return "Japanese";
  }
  if (s.includes("indonesian") || /\b(ind|id)\b/.test(s)) return "Indonesian";
  if (s.includes("spanish") || /\b(spa|es|esla)\b/.test(s)) return "Spanish";
  if (s.includes("portuguese") || /\b(por|pt|ptbr)\b/.test(s)) return "Portuguese";
  return null;
}

export function parseHlsAudioLanguages(m3u8Text = "", countryOfOrigin = "JP") {
  const originalLang = getOriginalLanguageForCountry(countryOfOrigin);
  const found = [];
  const addLang = (raw) => {
    const norm = normalizeLangName(raw);
    if (norm && !found.includes(norm)) found.push(norm);
  };
  for (const line of String(m3u8Text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#EXT-X-MEDIA") || !trimmed.includes("TYPE=AUDIO")) continue;
    const nameMatch = trimmed.match(/NAME="([^"]+)"/i);
    const langMatch = trimmed.match(/LANGUAGE="([^"]+)"/i);
    const rawName = (nameMatch?.[1] || "").trim().toLowerCase();
    // Hosts like FlixCloud tag the native/original track with LANGUAGE="jpn", NAME="Native"
    // even for Chinese (CN/TW/HK) and Korean (KR) titles.
    if (rawName === "native" || rawName === "original") {
      if (!found.includes(originalLang)) found.push(originalLang);
      continue;
    }
    // Prefer explicit LANGUAGE code if NAME is "Undefined" or ambiguous
    if (nameMatch?.[1]) addLang(nameMatch[1]);
    if (langMatch?.[1]) addLang(langMatch[1]);
  }
  return found;
}

function decodeB64Utf8(raw) {
  const clean = String(raw || "").replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const pad = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  return Buffer.from(pad, "base64").toString("utf8");
}

export function parsePlayablePlayerPhpLangs(html = "") {
  const found = [];
  const addLang = (raw) => {
    const norm = normalizeLangName(raw);
    if (norm && !found.includes(norm)) found.push(norm);
  };
  const parsePlayerData = (b64Param) => {
    try {
      let b64 = b64Param;
      try {
        b64 = decodeURIComponent(b64Param);
      } catch {}
      const list = JSON.parse(decodeB64Utf8(b64));
      if (!Array.isArray(list)) return;
      for (const item of list) {
        const link = String(item?.link || "").replace(/\\\//g, "/").trim();
        if (!link || isBlockedPlayerHost(link)) continue;
        if (item?.language) addLang(item.language);
      }
    } catch {}
  };

  for (const m of String(html || "").matchAll(/player\.php\?data=([a-zA-Z0-9%+/=_-]+)/gi)) {
    parsePlayerData(m[1]);
  }
  for (const m of String(html || "").matchAll(/loadMi\(\{\s*value:\s*['"]([^'"]+)['"]/gi)) {
    try {
      const dec = decodeB64Utf8(m[1]);
      for (const pm of dec.matchAll(/data=([a-zA-Z0-9%+/=_-]+)/gi)) {
        parsePlayerData(pm[1]);
      }
    } catch {}
  }
  return found;
}

export function buildAcdnAvailability({ verifiedStream, hlsLangs = [], resolvedHit = null, countryOfOrigin = "JP" }) {
  if (!verifiedStream || !resolvedHit?.streamUrl) {
    return { sub: false, dub: false, multi: false, languages: [] };
  }

  const originalLang = getOriginalLanguageForCountry(countryOfOrigin);
  const langs = [];
  const pushLang = (raw) => {
    const norm = normalizeLangName(raw);
    if (norm && !langs.includes(norm)) langs.push(norm);
  };

  if (Array.isArray(hlsLangs) && hlsLangs.length > 0) {
    for (const l of hlsLangs) pushLang(l);
  } else {
    if (resolvedHit.hasHindi) pushLang("Hindi");
    if (resolvedHit.hasEnglish) pushLang("English");
    if (resolvedHit.hasJapanese) pushLang("Japanese");
    if (resolvedHit.audioLabel) pushLang(resolvedHit.audioLabel);
    if (Array.isArray(resolvedHit.languages)) {
      for (const l of resolvedHit.languages) pushLang(l);
    }
  }

  const hasSubLang = langs.includes(originalLang) || langs.includes("Japanese") || langs.length === 0;
  const hasDubLang = langs.some((l) => l !== originalLang);
  const hasRegionalMulti = langs.some((l) => l !== originalLang && l !== "English");

  return {
    sub: hasSubLang,
    dub: hasDubLang,
    multi: hasRegionalMulti || langs.length > 1,
    languages: langs,
  };
}

function setHlsMediaAttr(line, attr, val) {
  const re = new RegExp(`\\b${attr}=(?:"(?:YES|NO)"|YES|NO)`, "i");
  if (re.test(line)) return line.replace(re, `${attr}=${val}`);
  return `${line},${attr}=${val}`;
}

export function rewriteHlsAudioDefaults(lines, audioMode = "") {
  const audio = String(audioMode || "").toLowerCase();
  if (audio !== "dub" && audio !== "sub") return lines;

  const audioLines = lines.filter((l) => l.trim().startsWith("#EXT-X-MEDIA") && l.includes("TYPE=AUDIO"));
  if (audioLines.length === 0) return lines;

  const isHin = (l) => /language=["']?(hin|hi)\b/i.test(l) || /name=["']?hindi/i.test(l);
  const isEng = (l) => /language=["']?(eng|en)\b/i.test(l) || /name=["']?english/i.test(l) || /name=["']?dub/i.test(l);
  const isOrig = (l) =>
    /language=["']?(jpn|ja|chi|zho|zh|cmn|yue|kor|ko)\b/i.test(l) ||
    /name=["']?(native|japanese|chinese|mandarin|cantonese|korean|original)/i.test(l);

  const hasHin = audioLines.some(isHin);
  const hasEng = audioLines.some(isEng);
  const hasNonOrig = audioLines.some((l) => !isOrig(l));
  const hasOrig = audioLines.some(isOrig);

  if (audio === "dub" && (hasHin || hasEng || (audioLines.length > 1 && hasNonOrig))) {
    let pickedDefault = false;
    return lines.map((l) => {
      const s = l.trim();
      if (s.startsWith("#EXT-X-MEDIA") && s.includes("TYPE=AUDIO")) {
        const wantDefault = hasHin ? isHin(s) : hasEng ? isEng(s) : !isOrig(s);
        if (wantDefault && !pickedDefault) {
          pickedDefault = true;
          return setHlsMediaAttr(setHlsMediaAttr(l, "DEFAULT", "YES"), "AUTOSELECT", "YES");
        }
        return setHlsMediaAttr(l, "DEFAULT", "NO");
      }
      return l;
    });
  }

  if (audio === "sub" && hasOrig) {
    return lines
      .filter((l) => {
        const s = l.trim();
        if (s.startsWith("#EXT-X-MEDIA") && s.includes("TYPE=AUDIO")) {
          return isOrig(s);
        }
        return true;
      })
      .map((l) => {
        const s = l.trim();
        if (s.startsWith("#EXT-X-MEDIA") && s.includes("TYPE=AUDIO")) {
          return setHlsMediaAttr(setHlsMediaAttr(l, "DEFAULT", "YES"), "AUTOSELECT", "YES");
        }
        return l;
      });
  }

  return lines;
}

