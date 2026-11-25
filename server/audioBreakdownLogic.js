/**
 * Pure business logic for computing audio breakdown across episodes of a series.
 * Decoupled from HTTP / DOM for 100% test coverage with node:test.
 */

export function computeAudioBreakdown({
  totalEpisodes = 0,
  airedEpisodes = 0,
  hasMultiDub = false,
  multiDubEpisodes = 0,
  hasEnglishDub = false,
  dubEpisodes = 0,
  hasHindiDub = false,
  hindiDubEpisodes = 0,
  countryOfOrigin = 'JP',
  originalLanguage = null,
}) {
  const total = Math.max(0, parseInt(totalEpisodes, 10) || 0);
  const rawAired = parseInt(airedEpisodes, 10);
  const baseAired = Number.isFinite(rawAired) && rawAired > 0
    ? (total > 0 ? Math.min(total, rawAired) : rawAired)
    : total;

  // Normalize original language
  const country = String(countryOfOrigin || '').trim().toUpperCase();
  let origLang = originalLanguage;
  if (!origLang) {
    if (country === 'CN' || country === 'TW' || country === 'HK') {
      origLang = 'Chinese';
    } else if (country === 'KR') {
      origLang = 'Korean';
    } else {
      origLang = 'Japanese';
    }
  }

  // Multi-dub count (Hindi, Tamil, Telugu, English & more)
  let multiCount = 0;
  if (hasMultiDub) {
    const rawMulti = parseInt(multiDubEpisodes, 10);
    multiCount = Number.isFinite(rawMulti) && rawMulti > 0 ? Math.min(total || rawMulti, rawMulti) : baseAired;
  }

  // English Dub + Original (Dual Audio) count
  let englishDubCount = 0;
  if (hasEnglishDub) {
    const rawDub = parseInt(dubEpisodes, 10);
    englishDubCount = Number.isFinite(rawDub) && rawDub > 0 ? Math.min(total || rawDub, rawDub) : baseAired;
  }

  // Dedicated Hindi Dub episode count (includes Multi-Dub episodes since Multi-Dub carries Hindi)
  let hindiDubCount = 0;
  if (hasHindiDub) {
    const rawHindi = parseInt(hindiDubEpisodes, 10);
    hindiDubCount = Number.isFinite(rawHindi) && rawHindi > 0 ? (total > 0 ? Math.min(total, rawHindi) : rawHindi) : baseAired;
  }
  if (multiCount > 0) {
    hindiDubCount = Math.max(hindiDubCount, multiCount);
  }

  // Effective aired count never drops below verified dubbed coverage and never exceeds planned total
  const dubbedCoverage = Math.max(englishDubCount, hindiDubCount, multiCount);
  const effectiveAired = total > 0
    ? Math.min(total, Math.max(baseAired, dubbedCoverage))
    : Math.max(baseAired, dubbedCoverage);
  const isOngoing = total > 0 && effectiveAired < total;

  // Episodes available ONLY in original language among aired episodes (never count unaired episodes)
  const subOnlyCount = Math.max(0, effectiveAired - dubbedCoverage);

  // Percentages relative to total
  const multiDubPct = total > 0 ? Math.round((multiCount / total) * 100) : 0;
  const dubPct = total > 0 ? Math.round((englishDubCount / total) * 100) : 0;
  const hindiDubPct = total > 0 ? Math.round((hindiDubCount / total) * 100) : 0;
  const subOnlyPct = total > 0 ? Math.round((subOnlyCount / total) * 100) : 0;

  // Professional summary insight (never names any third-party dub provider)
  let insight = '';
  if (total <= 1) {
    insight = hindiDubCount > 0 ? 'Single-episode title featuring Hindi Dub.' : 'Single-episode title.';
  } else if (multiCount === effectiveAired && englishDubCount === effectiveAired) {
    if (isOngoing) {
      insight = hindiDubCount > 0
        ? `All ${effectiveAired} aired episodes (of ${total}) are available in Multi-Dub, Original ${origLang} Audio, English Dub, and Hindi Dub (${hindiDubCount}/${total} eps).`
        : `All ${effectiveAired} aired episodes (of ${total}) are available in Multi-Dub, Original ${origLang} Audio, and English Dub.`;
    } else {
      insight = hindiDubCount > 0
        ? `All ${total} episodes are available in Multi-Dub, Original ${origLang} Audio, English Dub, and Hindi Dub (${hindiDubCount}/${total} eps).`
        : `All ${total} episodes are available in Multi-Dub, Original ${origLang} Audio, and English Dub.`;
    }
  } else if (multiCount > 0 && englishDubCount === effectiveAired) {
    if (isOngoing) {
      insight = hindiDubCount > 0
        ? `All ${effectiveAired} aired episodes (of ${total}) have English Dub, with ${hindiDubCount} episodes in Hindi Dub and ${multiCount} episodes featuring Multi-Dub alongside Original ${origLang} Audio.`
        : `All ${effectiveAired} aired episodes (of ${total}) have English Dub, with ${multiCount} episodes also featuring Multi-Dub alongside Original ${origLang} Audio.`;
    } else {
      insight = hindiDubCount > 0
        ? `All ${total} episodes have English Dub, with ${hindiDubCount} episodes in Hindi Dub and ${multiCount} episodes featuring Multi-Dub alongside Original ${origLang} Audio.`
        : `All ${total} episodes have English Dub, with ${multiCount} episodes also featuring Multi-Dub alongside Original ${origLang} Audio.`;
    }
  } else if (englishDubCount === effectiveAired && hindiDubCount > 0) {
    insight = isOngoing
      ? `All ${effectiveAired} aired episodes (of ${total}) feature English Dub, and ${hindiDubCount} of ${total} episodes are available in Hindi Dub alongside Original ${origLang} Audio.`
      : `All ${total} episodes feature English Dub, and ${hindiDubCount} of ${total} episodes are available in Hindi Dub alongside Original ${origLang} Audio.`;
  } else if (hindiDubCount > 0 && englishDubCount === 0 && multiCount === 0) {
    if (isOngoing) {
      insight =
        hindiDubCount === effectiveAired
          ? `All ${effectiveAired} aired episodes (of ${total}) are available in Hindi Dub alongside Original ${origLang} Audio.`
          : `${hindiDubCount} of ${effectiveAired} aired episodes (${total} total) feature Hindi Dub; ${origLang} (Original) is available across all ${effectiveAired} aired episodes.`;
    } else {
      insight =
        hindiDubCount === total
          ? `All ${total} episodes are available in Hindi Dub alongside Original ${origLang} Audio.`
          : `${hindiDubCount} of ${total} episodes feature Hindi Dub; ${origLang} (Original) is available across all ${total} episodes.`;
    }
  } else if (englishDubCount === effectiveAired) {
    insight = isOngoing
      ? `All ${effectiveAired} aired episodes (of ${total}) feature English Dub alongside Original ${origLang} Audio.`
      : `All ${total} episodes feature English Dub alongside Original ${origLang} Audio.`;
  } else if (englishDubCount > 0 && subOnlyCount > 0) {
    const scope = isOngoing ? `${effectiveAired} aired episodes (${total} total)` : `${total} episodes`;
    insight = hindiDubCount > 0
      ? `${englishDubCount} of ${scope} feature English Dub, ${hindiDubCount} episodes feature Hindi Dub, and all ${effectiveAired} aired episodes feature Original ${origLang} Audio.`
      : `${englishDubCount} of ${scope} feature English Dub and all ${effectiveAired} aired episodes feature Original ${origLang} Audio.`;
  } else if (englishDubCount > 0 && subOnlyCount === 0) {
    insight = isOngoing
      ? `All ${effectiveAired} aired episodes (of ${total}) are covered by dubs (${englishDubCount} English Dub, ${hindiDubCount} Hindi Dub) alongside Original ${origLang} Audio.`
      : `All ${total} episodes are covered by dubs (${englishDubCount} English Dub, ${hindiDubCount} Hindi Dub) alongside Original ${origLang} Audio.`;
  } else if (multiCount > 0 && englishDubCount === 0) {
    if (subOnlyCount === 0) {
      insight = isOngoing
        ? `All ${effectiveAired} aired episodes (of ${total}) are available in Multi-Dub & Hindi Dub alongside Original ${origLang} Audio.`
        : `All ${total} episodes are available in Multi-Dub & Hindi Dub alongside Original ${origLang} Audio.`;
    } else {
      const scope = isOngoing ? `${effectiveAired} aired episodes (${total} total)` : `${total} episodes`;
      insight = hindiDubCount > 0
        ? `${multiCount} of ${scope} available in Multi-Dub and ${hindiDubCount} episodes in Hindi Dub; remaining ${subOnlyCount} episodes are in ${origLang} (Original).`
        : `${multiCount} of ${scope} available in Multi-Dub; remaining ${subOnlyCount} episodes are in ${origLang} (Original).`;
    }
  } else if (dubbedCoverage === 0) {
    insight = isOngoing
      ? `All ${effectiveAired} aired episodes (of ${total}) are available exclusively in Original ${origLang} Audio with multi-language subtitles.`
      : `All ${total} episodes are available exclusively in Original ${origLang} Audio with multi-language subtitles.`;
  } else {
    insight = isOngoing
      ? `Original ${origLang} Audio with multi-language subtitles is available across all ${effectiveAired} aired episodes.`
      : `Original ${origLang} Audio with multi-language subtitles is available across all ${total} episodes.`;
  }

  return {
    totalEpisodes: total,
    airedEpisodes: effectiveAired,
    originalLanguage: origLang,
    multiDubCount: multiCount,
    multiDubPercentage: multiDubPct,
    hasMultiDub: multiCount > 0,
    dubCount: englishDubCount,
    dubPercentage: dubPct,
    hasEnglishDub: englishDubCount > 0,
    hindiDubCount,
    hindiDubPercentage: hindiDubPct,
    hasHindiDub: hindiDubCount > 0,
    subOnlyCount,
    subOnlyPercentage: subOnlyPct,
    hasSubOnly: subOnlyCount > 0,
    labels: {
      multiDub: 'Multiple Dubs (Multi-Dub)',
      multiDubDesc: 'Hindi, Tamil, Telugu, English & more regional dubs',
      dualAudio: `English Dub & ${origLang} (Dual Audio)`,
      dualAudioDesc: `Official English Dub + Original ${origLang} Audio`,
      hindiDub: 'Hindi Dub',
      hindiDubDesc: 'Hindi dubbed audio track',
      subOnly: `Only ${origLang} (Original)`,
      subOnlyDesc: `Original ${origLang} studio audio with multi-language subtitles`,
    },
    insight,
  };
}

/**
 * Returns the audio tier for a specific episode number (1-indexed).
 * Tiers: 'multi' | 'dual' | 'hindi' | 'sub'
 */
export function getEpisodeAudioTier(epNumber, breakdown) {
  if (!breakdown) return 'sub';
  const ep = parseInt(epNumber, 10) || 1;
  if (breakdown.multiDubCount >= ep) return 'multi';
  if (breakdown.dubCount >= ep) return 'dual';
  if ((breakdown.hindiDubCount || 0) >= ep) return 'hindi';
  return 'sub';
}
