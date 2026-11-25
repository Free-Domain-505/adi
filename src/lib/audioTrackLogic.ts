export type OriginalAudioLanguage = 'Japanese' | 'Chinese' | 'Korean'

export interface AudioTrackItem {
  i: number
  label: string
  lang: string
}

const ISO_LANG: Record<string, string> = {
  en: 'English',
  eng: 'English',
  ar: 'Arabic',
  ara: 'Arabic',
  es: 'Spanish',
  spa: 'Spanish',
  fr: 'French',
  fre: 'French',
  fra: 'French',
  de: 'German',
  ger: 'German',
  deu: 'German',
  it: 'Italian',
  ita: 'Italian',
  pt: 'Portuguese',
  por: 'Portuguese',
  pob: 'Portuguese',
  ru: 'Russian',
  rus: 'Russian',
  hi: 'Hindi',
  hin: 'Hindi',
  ta: 'Tamil',
  tam: 'Tamil',
  te: 'Telugu',
  tel: 'Telugu',
  ml: 'Malayalam',
  mal: 'Malayalam',
  kn: 'Kannada',
  kan: 'Kannada',
  bn: 'Bengali',
  ben: 'Bengali',
  ja: 'Japanese',
  jpn: 'Japanese',
  zh: 'Chinese',
  chi: 'Chinese',
  zho: 'Chinese',
  cmn: 'Chinese',
  yue: 'Chinese',
  id: 'Indonesian',
  ind: 'Indonesian',
  th: 'Thai',
  tha: 'Thai',
  vi: 'Vietnamese',
  vie: 'Vietnamese',
  ko: 'Korean',
  kor: 'Korean',
  tr: 'Turkish',
  tur: 'Turkish',
  pl: 'Polish',
  pol: 'Polish',
  nl: 'Dutch',
  dut: 'Dutch',
  nld: 'Dutch',
}

export const normAudioLang = (v: string): string => {
  const raw = (v || '').trim().toLowerCase().split(/[-–(#_]/)[0].trim()
  return (ISO_LANG[raw] || raw).toLowerCase()
}

export const formatHlsTrackLabel = (
  t: { name?: string; lang?: string },
  i: number,
  origLang: OriginalAudioLanguage = 'Japanese',
): string => {
  const rawName = (t.name || '').trim()
  const rawLang = (t.lang || '').trim()
  if (rawName && !/^(track|audio|stream|default|main)\s*#?\d*$/i.test(rawName)) {
    const low = rawName.toLowerCase()
    if (low === 'native' || low === 'original') {
      return `${origLang} (Original)`
    }
    const resolved = ISO_LANG[low] ?? rawName
    return resolved === origLang ? `${origLang} (Original)` : resolved
  }
  if (rawLang && rawLang.toLowerCase() !== 'und' && rawLang.toLowerCase() !== 'unknown') {
    const resolved = ISO_LANG[rawLang.toLowerCase()] ?? (rawLang[0].toUpperCase() + rawLang.slice(1))
    return resolved === origLang ? `${origLang} (Original)` : resolved
  }
  return `Audio ${i + 1}`
}

export const isOriginalTrack = (
  t: { label: string; lang: string },
  origLang: OriginalAudioLanguage = 'Japanese',
): boolean => {
  const l = t.label.toLowerCase()
  const g = t.lang.toLowerCase()
  if (
    l.includes('native') ||
    l.includes('original') ||
    (l.includes('sub') && !l.includes('english') && !l.includes('hindi') && !l.includes('dub'))
  ) {
    return true
  }
  if (origLang === 'Chinese') {
    return (
      g === 'zh' ||
      g === 'chi' ||
      g === 'zho' ||
      g === 'cmn' ||
      g === 'yue' ||
      l.includes('chinese') ||
      l.includes('mandarin') ||
      l.includes('cantonese') ||
      l.includes('putonghua')
    )
  }
  if (origLang === 'Korean') {
    return g === 'ko' || g === 'kor' || l.includes('korean')
  }
  return (
    g === 'ja' ||
    g === 'jpn' ||
    g === 'jp' ||
    l.includes('japanese') ||
    l.includes('jap') ||
    l.includes('jpn') ||
    l.includes('nihongo')
  )
}

export const trackMatchesLang = (t: { label: string; lang: string }, savedLang?: string): boolean => {
  if (!savedLang) return false
  const wantRaw = savedLang.trim().toLowerCase()
  const wantNorm = normAudioLang(savedLang)
  const tLang = t.lang.trim().toLowerCase()
  const tLabel = t.label.trim().toLowerCase()
  if (!tLang && !tLabel) return false
  if (tLang && (tLang === wantRaw || normAudioLang(tLang) === wantNorm)) return true
  if (tLabel && (tLabel === wantRaw || normAudioLang(tLabel) === wantNorm || (wantNorm.length >= 3 && tLabel.includes(wantNorm)))) return true
  return false
}

export function findTrackForMode(
  tracks: AudioTrackItem[],
  mode: 'sub' | 'dub' = 'sub',
  savedLang?: string,
  origLang: OriginalAudioLanguage = 'Japanese',
  explicitUserChoice = false,
): AudioTrackItem | null {
  if (!tracks.length) return null

  const isEnglish = (t: { label: string; lang: string }) => {
    const l = t.label.toLowerCase()
    const g = t.lang.toLowerCase()
    return (
      (g === 'en' || g === 'eng' || /\b(english|eng)\b/i.test(l)) &&
      !/\b(hindi|japanese|chinese|korean|bengali)\b/i.test(l)
    )
  }

  const isHindi = (t: { label: string; lang: string }) => {
    const l = t.label.toLowerCase()
    const g = t.lang.toLowerCase()
    return g === 'hi' || g === 'hin' || /\b(hindi|hin)\b/i.test(l)
  }

  const isIndianRegional = (t: { label: string; lang: string }) => {
    const l = t.label.toLowerCase()
    const g = t.lang.toLowerCase()
    return (
      isHindi(t) ||
      /^(ta|tam|te|tel|ml|mal|kn|kan|bn|ben)$/i.test(g) ||
      /\b(tamil|telugu|malayalam|kannada|bengali|bangla|marathi|gujarati)\b/i.test(l)
    )
  }

  if (mode === 'dub') {
    const hasIndianDub = tracks.some((t) => !isOriginalTrack(t, origLang) && isIndianRegional(t))
    const isExplicit =
      explicitUserChoice ||
      (() => {
        try {
          return typeof localStorage !== 'undefined' && localStorage.getItem('zp-alang-explicit') === '1'
        } catch {
          return false
        }
      })()

    // 1. Honor the user's explicit preferred DUB language first (never match any original studio language in DUB mode)
    if (savedLang && savedLang.trim()) {
      const savedEntry = { label: savedLang, lang: savedLang }
      const savedIsOrig =
        isOriginalTrack(savedEntry, origLang) ||
        isOriginalTrack(savedEntry, 'Japanese') ||
        isOriginalTrack(savedEntry, 'Chinese') ||
        isOriginalTrack(savedEntry, 'Korean')
      const savedIsEn = isEnglish(savedEntry)
      // On a multi-audio Indian dub stream (Hindi/Tamil/Telugu), don't let an accidental/default 'en' override Hindi unless explicitly chosen
      if (!savedIsOrig && (!hasIndianDub || !savedIsEn || isExplicit)) {
        const hit = tracks.find((t) => !isOriginalTrack(t, origLang) && trackMatchesLang(t, savedLang))
        if (hit) return hit
      }
    }

    // 2. Fallback to Hindi dub
    const hindi = tracks.find((t) => !isOriginalTrack(t, origLang) && isHindi(t))
    if (hindi) return hindi

    // 3. Fallback to other Indian regional dubs (Tamil, Telugu, etc.)
    const regional = tracks.find((t) => !isOriginalTrack(t, origLang) && isIndianRegional(t))
    if (regional) return regional

    // 4. Fallback to English dub
    const english = tracks.find((t) => !isOriginalTrack(t, origLang) && isEnglish(t))
    if (english) return english

    const dub = tracks.find((t) => /\bdub\b/i.test(t.label) && !isOriginalTrack(t, origLang))
    if (dub) return dub

    // 5. Fallback to any non-original track (if multiple tracks exist and track 0 is generic "Audio 1", prefer subsequent track)
    const isGenericLabel = (l: string) => /^(audio|track|stream|default|main)\s*#?\d*$/i.test(l.trim())
    if (tracks.length > 1) {
      const nonOrigNonGeneric = tracks.find(
        (t, idx) => !isOriginalTrack(t, origLang) && !(idx === 0 && isGenericLabel(t.label)),
      )
      if (nonOrigNonGeneric) return nonOrigNonGeneric
    }
    const nonOrig = tracks.find((t) => !isOriginalTrack(t, origLang))
    if (nonOrig) return nonOrig
    if (tracks.length > 1) return tracks[1]
  } else {
    // mode === 'sub' -> Strictly prefer Original track (never let saved English/Hindi override SUB)
    const sub = tracks.find((t) => isOriginalTrack(t, origLang))
    if (sub) return sub

    const nonDub = tracks.find((t) => !isEnglish(t) && !isHindi(t) && !t.label.toLowerCase().includes('dub'))
    if (nonDub) return nonDub
  }

  return tracks[0]
}
