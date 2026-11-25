import type { ServerAudioInfo, VerifiedAudioReport } from '../services/api'

export interface OriginalAudioMeta {
  country: string
  language: 'Chinese' | 'Korean' | 'Japanese'
  shortLabel: string
  detailLabel: string
  summaryLabel: string
  cardDescription: string
  unavailableDescription: string
}

export interface AvailableAudioTrack {
  name: string
  label: string
  native: string
  episodeCount?: number
  isFullCoverage?: boolean
  episodeRange?: string
  verifiedServers?: string[]
}

export interface ComputedAudioAvailability {
  original: OriginalAudioMeta
  originalVerified: boolean
  checked: boolean
  hasAnyVerifiedStream: boolean
  dubs: AvailableAudioTrack[]
  hasDub: boolean
  hasMulti: boolean
  summaryLine: string
  badgeText: string
  tracksCountLabel: string
  verifiedReport?: VerifiedAudioReport | null
}

const DUB_META: Record<string, { label: string; native: string }> = {
  English: { label: 'English Dub', native: 'Official English Dub' },
  Hindi: { label: 'Hindi Dub', native: 'हिन्दी (Regional Dub)' },
  Tamil: { label: 'Tamil Dub', native: 'தமிழ் (Regional Dub)' },
  Telugu: { label: 'Telugu Dub', native: 'తెలుగు (Regional Dub)' },
  Malayalam: { label: 'Malayalam Dub', native: 'മലയാളം (Regional Dub)' },
  Kannada: { label: 'Kannada Dub', native: 'ಕನ್ನಡ (Regional Dub)' },
  Bengali: { label: 'Bengali Dub', native: 'বাংলা (Regional Dub)' },
  Japanese: { label: 'Japanese Dub', native: 'Official Japanese Audio Track' },
  Chinese: { label: 'Chinese Dub', native: 'Mandarin / Chinese Audio Track' },
  Korean: { label: 'Korean Dub', native: 'Korean Audio Track' },
  Spanish: { label: 'Spanish Dub', native: 'Español Audio Track' },
  Portuguese: { label: 'Portuguese Dub', native: 'Português Audio Track' },
  Indonesian: { label: 'Indonesian Dub', native: 'Bahasa Indonesia Audio Track' },
}

const ORDER_PRIORITY = [
  'English',
  'Hindi',
  'Tamil',
  'Telugu',
  'Malayalam',
  'Kannada',
  'Bengali',
  'Japanese',
  'Chinese',
  'Korean',
  'Spanish',
  'Portuguese',
  'Indonesian',
]

export function getOriginalAudioMeta(countryOfOrigin?: string | null): OriginalAudioMeta {
  const c = String(countryOfOrigin ?? '').trim().toUpperCase()
  if (c === 'CN' || c === 'TW' || c === 'HK') {
    return {
      country: c,
      language: 'Chinese',
      shortLabel: 'Chinese (Original)',
      detailLabel: 'Chinese (Original)',
      summaryLabel: 'Chinese (Original)',
      cardDescription: 'Original Chinese Studio Audio',
      unavailableDescription: 'Original Chinese audio stream not detected on indexed servers',
    }
  }
  if (c === 'KR') {
    return {
      country: c,
      language: 'Korean',
      shortLabel: 'Korean (Original)',
      detailLabel: 'Korean (Original)',
      summaryLabel: 'Korean (Original)',
      cardDescription: 'Original Korean Studio Audio',
      unavailableDescription: 'Original Korean audio stream not detected on indexed servers',
    }
  }
  return {
    country: c || 'JP',
    language: 'Japanese',
    shortLabel: 'Japanese (Original)',
    detailLabel: 'Japanese (Original)',
    summaryLabel: 'Japanese (Original)',
    cardDescription: 'Original Japanese Studio Audio',
    unavailableDescription: 'Original Japanese audio stream not detected on indexed servers',
  }
}

export interface AudioCheckingInputs {
  hasAnime: boolean
  seasonReady?: boolean
  detectorStatus: 'idle' | 'scanning' | 'verified' | 'error'
  hasReport: boolean
  hasVerifiedReportServers?: boolean
  serverAvailLoading: boolean
  serverAvailHasData: boolean
  hasMultipleEpisodes: boolean
  remoteBreakdownLoading: boolean
  remoteBreakdownHasData: boolean
  remoteBreakdownHasError: boolean
}

/**
 * Keeps the Details page in an explicit loading state until season resolution,
 * background multi-server audio detection, and server probes settle—never flashing
 * unverified or partial audio counts prematurely.
 */
export function computeAudioCheckingState({
  hasAnime,
  seasonReady = true,
  detectorStatus,
  hasReport,
  hasVerifiedReportServers = true,
  serverAvailLoading,
  serverAvailHasData,
  hasMultipleEpisodes,
  remoteBreakdownLoading,
  remoteBreakdownHasData,
  remoteBreakdownHasError,
}: AudioCheckingInputs): boolean {
  if (!hasAnime || !seasonReady) return true
  if (hasReport) {
    if (!hasVerifiedReportServers && serverAvailLoading) return true
    return false
  }
  if (detectorStatus === 'idle' || detectorStatus === 'scanning') return true
  if (serverAvailLoading || !serverAvailHasData) return true
  if (hasMultipleEpisodes && (remoteBreakdownLoading || (!remoteBreakdownHasData && !remoteBreakdownHasError))) {
    return true
  }
  return false
}

function serverDisplayName(key: string): string {
  switch (key) {
    case 'flixcloud':
      return 'Server 1 (FlixCloud)'
    case 'megaplay':
      return 'Server 2 (MegaPlay)'
    case 'vidstream':
      return 'Server 3 (Vidstream)'
    case 'acdn':
      return 'Server 4 (ACDN Multi-Audio)'
    case 'anikoto':
      return 'Server 5 (Anikoto)'
    case 'desidubanime':
      return 'Server 11 (DesiDub)'
    case 'watchanimeworld':
      return 'WatchAnimeWorld'
    case 'server12':
      return 'Server 12 (Tooniboy)'
    default:
      return key
  }
}

export function computeAvailableAudio(
  servers: Record<string, ServerAudioInfo> | null | undefined,
  countryOfOrigin?: string | null,
  loading = false,
  verifiedReport?: VerifiedAudioReport | null,
): ComputedAudioAvailability {
  const original = getOriginalAudioMeta(countryOfOrigin)

  if (loading) {
    return {
      original,
      originalVerified: false,
      checked: false,
      hasAnyVerifiedStream: false,
      dubs: [],
      hasDub: false,
      hasMulti: false,
      summaryLine: 'Checking…',
      badgeText: 'Checking episode audio…',
      tracksCountLabel: 'Detecting…',
      verifiedReport: null,
    }
  }

  const isDonghua = original.language === 'Chinese'
  const isKoreanAnim = original.language === 'Korean'
  const isNonJpEastAsian = isDonghua || isKoreanAnim

  let serversOrigVerified = false
  const serverDubMap = new Map<string, { epCount?: number; servers: Set<string> }>()
  const addServerDub = (lang: string, srvLabel: string, epCount?: number) => {
    const clean = lang.trim()
    if (!clean || clean === original.language) return
    const existing = serverDubMap.get(clean) ?? { servers: new Set<string>() }
    existing.servers.add(srvLabel)
    if (typeof epCount === 'number' && epCount > 0) {
      existing.epCount = Math.max(existing.epCount ?? 0, epCount)
    }
    serverDubMap.set(clean, existing)
  }

  const entries = servers ? Object.entries(servers) : []
  for (const [key, info] of entries) {
    if (!info) continue
    const srvLabel = serverDisplayName(key)
    if (key === 'acdn') {
      const langs = Array.isArray(info.languages) ? info.languages.filter(Boolean) : []
      if (langs.length > 0) {
        for (const lang of langs) {
          if (lang === original.language) {
            serversOrigVerified = true
          } else {
            addServerDub(lang, srvLabel, info.episodeCount)
          }
        }
      } else if (info.sub) {
        serversOrigVerified = true
      }
      continue
    }

    if (info.sub) serversOrigVerified = true

    const explicitLangs = Array.isArray(info.languages) ? info.languages.filter(Boolean) : []
    if (explicitLangs.length > 0) {
      for (const lang of explicitLangs) {
        if (lang === original.language) {
          serversOrigVerified = true
        } else {
          addServerDub(lang, srvLabel, info.episodeCount)
        }
      }
    } else if (info.dub) {
      if (key === 'desidubanime') {
        addServerDub('Hindi', srvLabel, info.episodeCount)
      } else if (!isNonJpEastAsian || info.dubVerified) {
        addServerDub('English', srvLabel, info.episodeCount)
      }
    }
  }

  const acdnDubCount = Array.isArray(servers?.acdn?.languages)
    ? servers.acdn.languages.filter((l) => l && l !== original.language).length
    : 0

  // Merge authoritative verifiedReport + live servers-available map so tracks found by either source are never discarded
  if (verifiedReport && Array.isArray(verifiedReport.tracks) && verifiedReport.tracks.length > 0) {
    const origTrack = verifiedReport.tracks.find((t) => t.type === 'original')
    const realReportOrigServers = (origTrack?.verifiedServers ?? []).filter(
      (s) => s && s !== 'Indexed AnimeStream Servers',
    )
    const reportHasRealOrig =
      realReportOrigServers.length > 0 ||
      (verifiedReport.hasVerifiedStreams === true && Boolean(origTrack))

    const mergedDubMap = new Map<string, AvailableAudioTrack>()
    for (const t of verifiedReport.tracks) {
      if (t.type !== 'dub' || !t.language || t.language === original.language) continue
      mergedDubMap.set(t.language, {
        name: t.language,
        label: t.label || DUB_META[t.language]?.label || `${t.language} Dub`,
        native: t.native || DUB_META[t.language]?.native || `${t.language} Audio Track`,
        episodeCount: t.verifiedEpisodes,
        isFullCoverage: t.isFullCoverage,
        episodeRange: t.episodeRange,
        verifiedServers: Array.isArray(t.verifiedServers) ? [...t.verifiedServers] : [],
      })
    }

    let addedServerTrack = false
    for (const [lang, meta] of serverDubMap.entries()) {
      const existing = mergedDubMap.get(lang)
      if (!existing) {
        addedServerTrack = true
        mergedDubMap.set(lang, {
          name: lang,
          label: DUB_META[lang]?.label ?? `${lang} Dub`,
          native: DUB_META[lang]?.native ?? `${lang} Audio Track`,
          ...(meta.epCount ? { episodeCount: meta.epCount } : {}),
          verifiedServers: Array.from(meta.servers),
        })
      } else {
        const srvSet = new Set(existing.verifiedServers ?? [])
        for (const s of meta.servers) srvSet.add(s)
        existing.verifiedServers = Array.from(srvSet)
        if (meta.epCount && (!existing.episodeCount || meta.epCount > existing.episodeCount)) {
          existing.episodeCount = meta.epCount
        }
      }
    }

    const dubs = Array.from(mergedDubMap.values()).sort((a, b) => {
      const ia = ORDER_PRIORITY.indexOf(a.name)
      const ib = ORDER_PRIORITY.indexOf(b.name)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })

    const originalVerified = Boolean(reportHasRealOrig || serversOrigVerified)
    const hasDub = dubs.length > 0
    const hasMulti = dubs.length > 1 || Boolean(servers?.acdn?.multi && acdnDubCount > 1)
    const hasAnyVerifiedStream = originalVerified || hasDub
    const totalCount = (originalVerified ? 1 : 0) + dubs.length

    let summaryLine = verifiedReport.summaryLine
    let badgeText = verifiedReport.badgeText
    let tracksCountLabel = verifiedReport.tracksCountLabel

    if (addedServerTrack || !originalVerified) {
      if (originalVerified && hasDub) {
        summaryLine = `${original.shortLabel} · ${dubs.map((d) => d.label).join(' · ')}`
        badgeText = hasMulti
          ? `${original.language} + ${dubs.length} Dub Languages Available`
          : `${original.language} & ${dubs[0].label} Available`
      } else if (originalVerified) {
        summaryLine = original.shortLabel
        badgeText = `Original ${original.language} Audio`
      } else if (hasDub) {
        summaryLine = dubs.map((d) => d.label).join(' · ')
        badgeText = `${dubs.map((d) => d.label).join(', ')} Available`
      } else {
        summaryLine = `${original.detailLabel} (Limited availability)`
        badgeText = `No Verified Streams (${original.language} Original)`
      }
      tracksCountLabel = totalCount > 0 ? `${totalCount} Audio ${totalCount === 1 ? 'Track' : 'Tracks'} Detected` : 'None Detected'
    }

    return {
      original,
      originalVerified,
      checked: true,
      hasAnyVerifiedStream,
      dubs,
      hasDub,
      hasMulti,
      summaryLine,
      badgeText,
      tracksCountLabel,
      verifiedReport,
    }
  }

  const checked = !loading && servers != null && entries.length > 0

  if (!servers || entries.length === 0) {
    return {
      original,
      originalVerified: false,
      checked: false,
      hasAnyVerifiedStream: false,
      dubs: [],
      hasDub: false,
      hasMulti: false,
      summaryLine: original.shortLabel,
      badgeText: original.detailLabel,
      tracksCountLabel: original.detailLabel,
      verifiedReport: null,
    }
  }

  const originalVerified = serversOrigVerified
  const rawDubs = new Set<string>(serverDubMap.keys())
  const dubEpCounts: Record<string, number> = {}
  for (const [lang, meta] of serverDubMap.entries()) {
    if (meta.epCount) dubEpCounts[lang] = meta.epCount
  }

  const hasMulti = rawDubs.size > 1 || Boolean(servers?.acdn?.multi && acdnDubCount > 1)
  if (hasMulti && rawDubs.has('Hindi')) {
    const multiMaxEp = Math.max(
      typeof servers?.watchanimeworld?.episodeCount === 'number' ? servers.watchanimeworld.episodeCount : 0,
      typeof servers?.server12?.episodeCount === 'number' ? servers.server12.episodeCount : 0,
      typeof servers?.acdn?.episodeCount === 'number' ? servers.acdn.episodeCount : 0,
      ...Array.from(rawDubs)
        .filter((l) => l !== 'English')
        .map((l) => dubEpCounts[l] ?? 0),
    )
    if (multiMaxEp > 0) {
      dubEpCounts['Hindi'] = Math.max(dubEpCounts['Hindi'] ?? 0, multiMaxEp)
    }
  }

  const sortedDubs = [...rawDubs].sort((a, b) => {
    const ia = ORDER_PRIORITY.indexOf(a)
    const ib = ORDER_PRIORITY.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  const dubs: AvailableAudioTrack[] = sortedDubs.map((name) => ({
    name,
    label: DUB_META[name]?.label ?? `${name} Dub`,
    native: DUB_META[name]?.native ?? `${name} Audio Track`,
    ...(dubEpCounts[name] ? { episodeCount: dubEpCounts[name] } : {}),
    verifiedServers: Array.from(serverDubMap.get(name)?.servers ?? []),
  }))

  const hasDub = dubs.length > 0
  const hasAnyVerifiedStream = originalVerified || hasDub
  const totalCount = (originalVerified ? 1 : 0) + dubs.length

  const formatDubSummary = (d: AvailableAudioTrack) =>
    d.episodeCount ? `${d.label} (${d.episodeCount} eps)` : d.label

  let summaryLine: string
  if (originalVerified && hasDub) {
    summaryLine = `${original.shortLabel} · ${dubs.map(formatDubSummary).join(' · ')}`
  } else if (originalVerified) {
    summaryLine = original.shortLabel
  } else if (hasDub) {
    summaryLine = dubs.map(formatDubSummary).join(' · ')
  } else {
    summaryLine = `${original.detailLabel} (Limited availability)`
  }

  let badgeText: string
  if (originalVerified && hasDub) {
    badgeText = hasMulti
      ? `${original.language} + ${dubs.length} Dub ${dubs.length === 1 ? 'Language' : 'Languages'}`
      : `${original.language} & ${dubs[0].label} Available`
  } else if (originalVerified) {
    badgeText = `Original ${original.language} Audio`
  } else if (hasDub) {
    badgeText = `${dubs.map((d) => d.label).join(', ')} Available`
  } else {
    badgeText = `No Verified Streams (${original.language} Original)`
  }

  const tracksCountLabel =
    totalCount > 0 ? `${totalCount} Audio ${totalCount === 1 ? 'Track' : 'Tracks'}` : 'None Detected'

  return {
    original,
    originalVerified,
    checked,
    hasAnyVerifiedStream,
    dubs,
    hasDub,
    hasMulti,
    summaryLine,
    badgeText,
    tracksCountLabel,
  }
}

export function computeLocalAudioBreakdown(
  totalEpisodes: number,
  audioAvail: ComputedAudioAvailability,
  airedEpisodes?: number,
): import('../services/api').AudioBreakdownData {
  const total = Math.max(0, totalEpisodes || 0)
  const rawAired = airedEpisodes && Number.isFinite(airedEpisodes) ? Math.floor(airedEpisodes) : 0
  const baseAired = rawAired > 0 ? (total > 0 ? Math.min(total, rawAired) : rawAired) : total
  const origLang = audioAvail.original.language
  const hasMulti = audioAvail.hasMulti
  const hasDub = audioAvail.hasDub
  const hindiTrack = audioAvail.dubs.find((d) => d.name === 'Hindi')
  const englishTrack = audioAvail.dubs.find((d) => d.name === 'English')
  const hasEnglishTrack = Boolean(englishTrack)

  const multiCount = hasMulti ? baseAired : 0
  const rawDubEp = hasDub
    ? (englishTrack?.episodeCount && englishTrack.episodeCount > 0
        ? Math.min(total || englishTrack.episodeCount, englishTrack.episodeCount)
        : baseAired)
    : 0
  const dubCount = rawDubEp
  const rawHindiEp = hindiTrack
    ? Math.min(total || baseAired, hindiTrack.episodeCount && hindiTrack.episodeCount > 0 ? hindiTrack.episodeCount : baseAired)
    : 0
  const hindiDubCount = multiCount > 0 ? Math.max(rawHindiEp, multiCount) : rawHindiEp
  const dubbedCoverage = Math.max(dubCount, hindiDubCount, multiCount)
  const effectiveAired = total > 0
    ? Math.min(total, Math.max(baseAired, dubbedCoverage))
    : Math.max(baseAired, dubbedCoverage)
  const isOngoing = total > 0 && effectiveAired < total
  const subOnlyCount = Math.max(0, effectiveAired - dubbedCoverage)

  const multiDubPct = total > 0 ? Math.round((multiCount / total) * 100) : 0
  const dubPct = total > 0 ? Math.round((dubCount / total) * 100) : 0
  const hindiDubPct = total > 0 ? Math.round((hindiDubCount / total) * 100) : 0
  const subOnlyPct = total > 0 ? Math.round((subOnlyCount / total) * 100) : 0

  const mainDubLabel = audioAvail.dubs[0]?.label ?? 'English Dub'
  let insight = ''
  if (total <= 1) {
    insight = hindiDubCount > 0 ? 'Single-episode title featuring Hindi Dub.' : 'Single-episode title.'
  } else if (multiCount === effectiveAired && dubCount === effectiveAired) {
    if (isOngoing) {
      insight = hindiDubCount > 0
        ? `All ${effectiveAired} aired episodes (of ${total}) are available in Multi-Dub, Original ${origLang} Audio, English Dub, and Hindi Dub (${hindiDubCount}/${total} eps).`
        : `All ${effectiveAired} aired episodes (of ${total}) are available in Multi-Dub, Original ${origLang} Audio, and English Dub.`
    } else {
      insight = hindiDubCount > 0
        ? `All ${total} episodes are available in Multi-Dub, Original ${origLang} Audio, English Dub, and Hindi Dub (${hindiDubCount}/${total} eps).`
        : `All ${total} episodes are available in Multi-Dub, Original ${origLang} Audio, and English Dub.`
    }
  } else if (hindiDubCount > 0 && !hasEnglishTrack && !hasMulti) {
    if (isOngoing) {
      insight =
        hindiDubCount === effectiveAired
          ? `All ${effectiveAired} aired episodes (of ${total}) feature Hindi Dub and Original ${origLang} Audio.`
          : `${hindiDubCount} of ${effectiveAired} aired episodes (${total} total) feature Hindi Dub; Original ${origLang} Audio is available across all aired episodes.`
    } else {
      insight =
        hindiDubCount === total
          ? `All ${total} episodes feature Hindi Dub and Original ${origLang} Audio.`
          : `${hindiDubCount} of ${total} episodes feature Hindi Dub; Original ${origLang} Audio is available across all episodes.`
    }
  } else if (dubCount === effectiveAired) {
    if (isOngoing) {
      insight = hindiDubCount > 0
        ? `All ${effectiveAired} aired episodes (of ${total}) feature ${mainDubLabel} and Hindi Dub (${hindiDubCount}/${total} eps) alongside Original ${origLang} Audio.`
        : `All ${effectiveAired} aired episodes (of ${total}) feature ${mainDubLabel} alongside Original ${origLang} Audio.`
    } else {
      insight = hindiDubCount > 0
        ? `All ${total} episodes feature ${mainDubLabel} and Hindi Dub (${hindiDubCount}/${total} eps) alongside Original ${origLang} Audio.`
        : `All ${total} episodes feature ${mainDubLabel} alongside Original ${origLang} Audio.`
    }
  } else if (dubCount > 0 && subOnlyCount > 0) {
    const scope = isOngoing ? `${effectiveAired} aired episodes (${total} total)` : `${total} episodes`
    insight = hindiDubCount > 0
      ? `${dubCount} of ${scope} feature ${mainDubLabel}, ${hindiDubCount} episodes feature Hindi Dub, and all ${effectiveAired} aired episodes feature Original ${origLang} Audio.`
      : `${dubCount} of ${scope} feature ${mainDubLabel}, and all ${effectiveAired} aired episodes feature Original ${origLang} Audio.`
  } else if (multiCount > 0 && dubCount === 0) {
    insight = isOngoing
      ? `${multiCount} of ${effectiveAired} aired episodes (${total} total) available in Multi-Dub; Original ${origLang} Audio is available across all aired episodes.`
      : `${multiCount} of ${total} episodes available in Multi-Dub; Original ${origLang} Audio is available across all episodes.`
  } else {
    insight = isOngoing
      ? `All ${effectiveAired} aired episodes (of ${total}) are available exclusively in Original ${origLang} Audio with multi-language subtitles.`
      : `All ${total} episodes are available exclusively in Original ${origLang} Audio with multi-language subtitles.`
  }

  return {
    totalEpisodes: total,
    airedEpisodes: effectiveAired,
    originalLanguage: origLang,
    multiDubCount: multiCount,
    multiDubPercentage: multiDubPct,
    hasMultiDub: multiCount > 0,
    dubCount,
    dubPercentage: dubPct,
    hasEnglishDub: dubCount > 0,
    hindiDubCount,
    hindiDubPercentage: hindiDubPct,
    hasHindiDub: hindiDubCount > 0,
    subOnlyCount,
    subOnlyPercentage: subOnlyPct,
    hasSubOnly: subOnlyCount > 0,
    labels: {
      multiDub: 'Multiple Dubs (Multi-Dub)',
      multiDubDesc: 'Hindi, Tamil, Telugu, English & more regional dubs',
      dualAudio: `${mainDubLabel} & ${origLang} (Dual Audio)`,
      dualAudioDesc: `${mainDubLabel} + Original ${origLang} Audio`,
      hindiDub: 'Hindi Dub',
      hindiDubDesc: 'Hindi dubbed audio track',
      subOnly: `Only ${origLang} (Original)`,
      subOnlyDesc: `Original ${origLang} studio audio with multi-language subtitles`,
    },
    insight,
  }
}

export function getEpisodeAudioTier(
  epNumber: number,
  breakdown: import('../services/api').AudioBreakdownData | null | undefined,
): 'multi' | 'dual' | 'hindi' | 'sub' {
  if (!breakdown) return 'sub'
  const ep = Math.max(1, epNumber || 1)
  if (breakdown.multiDubCount >= ep) return 'multi'
  if (breakdown.dubCount >= ep) return 'dual'
  if ((breakdown.hindiDubCount ?? 0) >= ep) return 'hindi'
  return 'sub'
}

export function formatMultiEpisodeAudioSummary(
  breakdown: import('../services/api').AudioBreakdownData | null | undefined,
  fallbackSummary: string,
): string {
  if (!breakdown || breakdown.totalEpisodes <= 1) return fallbackSummary
  const parts: string[] = []
  const hasHindi = Boolean(breakdown.hasHindiDub && (breakdown.hindiDubCount ?? 0) > 0)
  const origAvailable = breakdown.airedEpisodes && breakdown.airedEpisodes > 0
    ? Math.min(breakdown.totalEpisodes, breakdown.airedEpisodes)
    : breakdown.totalEpisodes

  // 1. Original studio audio is always tracked separately
  parts.push(`Original ${breakdown.originalLanguage} (${origAvailable}/${breakdown.totalEpisodes} eps)`)

  // 2. English Dub is tracked separately
  if (breakdown.hasEnglishDub && breakdown.dubCount > 0) {
    parts.push(`English Dub (${breakdown.dubCount}/${breakdown.totalEpisodes} eps)`)
  }

  // 3. Hindi Dub is tracked separately
  if (hasHindi && (breakdown.hindiDubCount ?? 0) > 0) {
    parts.push(`Hindi Dub (${breakdown.hindiDubCount}/${breakdown.totalEpisodes} eps)`)
  }

  // 4. Multi-Dub is tracked separately
  if (breakdown.hasMultiDub && breakdown.multiDubCount > 0) {
    parts.push(`Multi-Dub (${breakdown.multiDubCount}/${breakdown.totalEpisodes} eps)`)
  }

  return parts.length > 0 ? parts.join(' · ') : fallbackSummary
}

export function reconcileBreakdownWithReport(
  baseBreakdown: import('../services/api').AudioBreakdownData | null | undefined,
  report: VerifiedAudioReport | null | undefined,
): import('../services/api').AudioBreakdownData | null {
  if (!report || !Array.isArray(report.tracks) || report.tracks.length === 0) {
    return baseBreakdown ?? null
  }
  const total = Math.max(0, report.totalEpisodes || baseBreakdown?.totalEpisodes || 0)
  if (total <= 1) return baseBreakdown ?? null

  const dubTracks = report.tracks.filter((t) => t.type === 'dub')
  const engTrack = dubTracks.find((t) => t.language === 'English')
  const hindiTrack = dubTracks.find((t) => t.language === 'Hindi')
  const regionalOrMultiTracks = dubTracks.filter((t) => t.language !== 'English')
  const multiEpsFromReport =
    dubTracks.length > 1 && regionalOrMultiTracks.length > 0
      ? Math.max(...regionalOrMultiTracks.map((t) => t.verifiedEpisodes || 0))
      : 0

  const multiCount = Math.min(total, Math.max(baseBreakdown?.multiDubCount ?? 0, multiEpsFromReport))
  const dubCount = Math.min(total, Math.max(baseBreakdown?.dubCount ?? 0, engTrack?.verifiedEpisodes ?? 0))
  const hindiCount = Math.min(total, Math.max(baseBreakdown?.hindiDubCount ?? 0, hindiTrack?.verifiedEpisodes ?? 0, multiCount))

  const hasEnglishDub = dubCount > 0
  const hasHindiDub = hindiCount > 0
  const hasMultiDub = multiCount > 0

  const effectiveAired = baseBreakdown?.airedEpisodes && baseBreakdown.airedEpisodes > 0
    ? Math.min(total, Math.max(baseBreakdown.airedEpisodes, multiCount, dubCount, hindiCount))
    : total
  const coveredEps = Math.max(multiCount, dubCount, hindiCount)
  const subOnlyCount = Math.max(0, effectiveAired - coveredEps)

  const multiDubPercentage = total > 0 ? Math.round((multiCount / total) * 100) : 0
  const dubPercentage = total > 0 ? Math.round((dubCount / total) * 100) : 0
  const hindiDubPercentage = total > 0 ? Math.round((hindiCount / total) * 100) : 0
  const subOnlyPercentage = total > 0 ? Math.round((subOnlyCount / total) * 100) : 0
  const origLang = report.originalLanguage || baseBreakdown?.originalLanguage || 'Japanese'

  const insight = report.coverageNote || baseBreakdown?.insight || ''

  return {
    totalEpisodes: total,
    airedEpisodes: effectiveAired,
    originalLanguage: origLang,
    multiDubCount: multiCount,
    multiDubPercentage,
    hasMultiDub,
    dubCount,
    dubPercentage,
    hasEnglishDub,
    hindiDubCount: hindiCount,
    hindiDubPercentage,
    hasHindiDub,
    subOnlyCount,
    subOnlyPercentage,
    hasSubOnly: subOnlyCount > 0,
    labels: baseBreakdown?.labels ?? {
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
  }
}
