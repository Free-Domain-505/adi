export interface SkipTimeRange {
  start: number
  end: number
}

export interface SkipTimeSources {
  aniSkip?: Array<{
    skipType?: string
    episodeLength?: number
    interval?: { startTime?: number; endTime?: number }
  }> | null
  theIntroDb?: {
    intro?: Array<{ start?: number; end?: number; startTime?: number; endTime?: number; start_ms?: number | null; end_ms?: number | null }>
    recap?: Array<{ start?: number; end?: number; startTime?: number; endTime?: number; start_ms?: number | null; end_ms?: number | null }>
    credits?: Array<{ start?: number; end?: number; startTime?: number; endTime?: number; start_ms?: number | null; end_ms?: number | null }>
    outro?: Array<{ start?: number; end?: number; startTime?: number; endTime?: number; start_ms?: number | null; end_ms?: number | null }>
  } | null
  introDb?: {
    imdb_id?: string
    media_type?: string
    is_movie?: boolean
    season?: number
    episode?: number
    intro?: { start?: number; end?: number; start_sec?: number; end_sec?: number; start_ms?: number; end_ms?: number } | null
    recap?: { start?: number; end?: number; start_sec?: number; end_sec?: number; start_ms?: number; end_ms?: number } | null
    outro?: { start?: number; end?: number; start_sec?: number; end_sec?: number; start_ms?: number; end_ms?: number } | null
    post_credits?: { start?: number; end?: number; start_sec?: number; end_sec?: number; start_ms?: number; end_ms?: number } | null
    no_intro?: boolean
    no_recap?: boolean
    no_outro?: boolean
  } | null
}

function round1(val: number): number {
  return Math.round(val * 10) / 10
}

export function validateSkipInterval(
  interval: {
    start?: unknown
    end?: unknown
    startTime?: unknown
    endTime?: unknown
    start_sec?: unknown
    end_sec?: unknown
    start_ms?: unknown
    end_ms?: unknown
  } | null | undefined,
  type: 'intro' | 'outro' | 'recap' | 'postCredits',
  { durationSec = 0, expectedDurationSec = 0 }: { durationSec?: number; expectedDurationSec?: number } = {},
): SkipTimeRange | null {
  if (!interval || typeof interval !== 'object') return null

  let start: number | null = null
  let end: number | null = null

  if (interval.start_ms !== undefined) {
    start = interval.start_ms === null ? 0 : Number(interval.start_ms) / 1000
  } else {
    const rawStart = interval.start ?? interval.startTime ?? interval.start_sec
    if (rawStart !== undefined && rawStart !== null) start = Number(rawStart)
  }

  const dur = durationSec > 0 ? durationSec : expectedDurationSec

  if (interval.end_ms !== undefined) {
    end = interval.end_ms === null ? (dur > 0 ? dur : null) : Number(interval.end_ms) / 1000
  } else {
    const rawEnd = interval.end ?? interval.endTime ?? interval.end_sec
    if (rawEnd !== undefined && rawEnd !== null) end = Number(rawEnd)
  }

  if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end <= start) return null

  // Short clip / preview (<120s) must never trigger OP/ED skip
  if (dur > 0 && dur < 120) return null

  const span = end - start

  // Outro edge case: short end-slate ED right at end of anime movie (e.g. Mugen Train 10s ED)
  const isShortEndSlate = type === 'outro' && dur > 0 && Math.abs(end - dur) <= 2 && span >= 8
  if (span < 15 && !isShortEndSlate) return null

  if (type === 'intro') {
    // Max span for TV episodes (<= 3600s) is 165s
    if (dur > 0 && dur <= 3600 && span > 165) return null
    if (dur > 0 && span > 300) return null

    // Intro cannot be in the second half of the video or late in video
    if (dur > 0) {
      if (start >= dur * 0.45) return null
      if (dur <= 3600 && start > 450) return null
      if (start > 1200) return null
    }
  } else if (type === 'outro') {
    if (dur > 0) {
      // Outro must be near the end of video
      if (start < dur * 0.65) return null
      // ED ending way before end (e.g. 10m before end of 1440s episode) is rejected
      if (dur - end > 300 && dur <= 3600) return null
      if (dur - end > 600) return null

      // Overrun check: slight overrun (<= 5s) clamps to duration; massive overrun (> 5s) is rejected
      if (end > dur) {
        if (end - dur <= 5) {
          end = dur
        } else {
          return null
        }
      }
    }
  }

  return { start: round1(start), end: round1(end) }
}

export function selectValidatedAniSkip(
  results: Array<{
    skipType?: string
    episodeLength?: number
    interval?: { startTime?: number; endTime?: number }
  }> | null | undefined,
  { durationSec = 0 }: { durationSec?: number } = {},
): {
  intro: SkipTimeRange | null
  outro: SkipTimeRange | null
  recap?: SkipTimeRange | null
} {
  if (!Array.isArray(results) || results.length === 0) {
    return { intro: null, outro: null }
  }

  let intro: SkipTimeRange | null = null
  let outro: SkipTimeRange | null = null
  let recap: SkipTimeRange | null = null

  let introIsExplicitOp = false
  let outroIsExplicitEd = false

  for (const item of results) {
    // Filter out mismatched episodeLength cuts
    if (item.episodeLength && durationSec > 0 && Math.abs(item.episodeLength - durationSec) > 300) {
      continue
    }

    const t = String(item.skipType || '').toLowerCase()
    const interval = item.interval
    if (!interval) continue

    if (t === 'op' || t === 'mixed-op') {
      const validated = validateSkipInterval(
        { start: interval.startTime, end: interval.endTime },
        'intro',
        { durationSec },
      )
      if (validated) {
        if (t === 'op') {
          intro = validated
          introIsExplicitOp = true
        } else if (!intro || !introIsExplicitOp) {
          intro = validated
        }
      }
    } else if (t === 'ed' || t === 'mixed-ed') {
      const validated = validateSkipInterval(
        { start: interval.startTime, end: interval.endTime },
        'outro',
        { durationSec },
      )
      if (validated) {
        if (t === 'ed') {
          outro = validated
          outroIsExplicitEd = true
        } else if (!outro || !outroIsExplicitEd) {
          outro = validated
        }
      }
    } else if (t === 'recap') {
      const validated = validateSkipInterval(
        { start: interval.startTime, end: interval.endTime },
        'recap',
        { durationSec },
      )
      if (validated) {
        recap = validated
      }
    }
  }

  const out: { intro: SkipTimeRange | null; outro: SkipTimeRange | null; recap?: SkipTimeRange | null } = { intro, outro }
  if (recap) out.recap = recap
  return out
}

export function selectValidatedTheIntroDb(
  payload: any,
  { durationSec = 0 }: { durationSec?: number } = {},
): {
  intro: SkipTimeRange | null
  outro: SkipTimeRange | null
  recap?: SkipTimeRange | null
} {
  if (!payload || typeof payload !== 'object') {
    return { intro: null, outro: null }
  }

  let intro: SkipTimeRange | null = null
  let outro: SkipTimeRange | null = null
  let recap: SkipTimeRange | null = null

  if (Array.isArray(payload.intro)) {
    for (const item of payload.intro) {
      const validated = validateSkipInterval(item, 'intro', { durationSec })
      if (validated) {
        intro = validated
        break
      }
    }
  }

  if (Array.isArray(payload.recap)) {
    for (const item of payload.recap) {
      const validated = validateSkipInterval(item, 'recap', { durationSec })
      if (validated) {
        recap = validated
        break
      }
    }
  }

  const rawOutroList = Array.isArray(payload.credits)
    ? payload.credits
    : Array.isArray(payload.outro)
      ? payload.outro
      : []

  const validCredits: SkipTimeRange[] = []
  for (const item of rawOutroList) {
    const validated = validateSkipInterval(item, 'outro', { durationSec })
    if (validated) validCredits.push(validated)
  }

  if (validCredits.length === 1) {
    outro = validCredits[0]
  } else if (validCredits.length > 1) {
    // Feature film: pick main movie credits (longer/earlier) over short post-credits stinger
    validCredits.sort((a, b) => (b.end - b.start) - (a.end - a.start))
    outro = validCredits[0]
  }

  const out: { intro: SkipTimeRange | null; outro: SkipTimeRange | null; recap?: SkipTimeRange | null } = { intro, outro }
  if (recap) out.recap = recap
  return out
}

export function selectValidatedIntroDb(
  payload: any,
  { durationSec = 0, expectedDurationSec = 0 }: { durationSec?: number; expectedDurationSec?: number } = {},
): {
  intro: SkipTimeRange | null
  recap: SkipTimeRange | null
  outro: SkipTimeRange | null
  postCredits: SkipTimeRange | null
} {
  if (!payload || typeof payload !== 'object') {
    return { intro: null, recap: null, outro: null, postCredits: null }
  }

  const dur = durationSec > 0 ? durationSec : expectedDurationSec

  let intro: SkipTimeRange | null = null
  let recap: SkipTimeRange | null = null
  let outro: SkipTimeRange | null = null
  let postCredits: SkipTimeRange | null = null

  if (!payload.no_intro && payload.intro) {
    intro = validateSkipInterval(payload.intro, 'intro', { durationSec: dur })
  }

  if (!payload.no_recap && payload.recap) {
    recap = validateSkipInterval(payload.recap, 'recap', { durationSec: dur })
  }

  if (!payload.no_outro && payload.outro) {
    outro = validateSkipInterval(payload.outro, 'outro', { durationSec: dur })
    if (!outro && payload.outro && dur > 0) {
      // Clamping check for slight duration mismatch
      const rawStart = Number(payload.outro.start_sec ?? payload.outro.start)
      const rawEnd = Number(payload.outro.end_sec ?? payload.outro.end)
      if (Number.isFinite(rawStart) && Number.isFinite(rawEnd) && rawStart < dur && rawStart >= dur * 0.65) {
        outro = { start: round1(rawStart), end: round1(Math.min(dur, rawEnd)) }
      }
    }
  }

  if (payload.post_credits) {
    postCredits =
      validateSkipInterval(payload.post_credits, 'outro', { durationSec: dur }) ||
      validateSkipInterval(payload.post_credits, 'postCredits', { durationSec: dur })
  }

  return { intro, recap, outro, postCredits }
}

export function sanitizeSkipPair({
  intro,
  recap,
  outro,
  durationSec = 0,
  expectedDurationSec = 0,
}: {
  intro?: SkipTimeRange | null
  recap?: SkipTimeRange | null
  outro?: SkipTimeRange | null
  durationSec?: number
  expectedDurationSec?: number
}): {
  intro: SkipTimeRange | null
  recap: SkipTimeRange | null
  outro: SkipTimeRange | null
} {
  const dur = durationSec > 0 ? durationSec : expectedDurationSec

  let validIntro = validateSkipInterval(intro, 'intro', { durationSec: dur })
  let validRecap = validateSkipInterval(recap, 'recap', { durationSec: dur })
  let validOutro = validateSkipInterval(outro, 'outro', { durationSec: dur })

  // Non-overlap constraint: recap vs intro
  if (validRecap && validIntro && validRecap.end > validIntro.start) {
    if (validRecap.start < validIntro.start) {
      validRecap = { start: validRecap.start, end: validIntro.start }
    } else {
      validRecap = null
    }
  }

  // Non-overlap constraint: intro vs outro
  if (validIntro && validOutro && validIntro.end >= validOutro.start) {
    validOutro = null
  }

  return {
    intro: validIntro,
    recap: validRecap,
    outro: validOutro,
  }
}

export function resolveBestSkipPair({
  streamIntro,
  streamOutro,
  sources,
  durationSec = 0,
  expectedDurationSec = 0,
}: {
  streamIntro?: SkipTimeRange | null
  streamOutro?: SkipTimeRange | null
  sources?: SkipTimeSources | null | undefined
  durationSec?: number
  expectedDurationSec?: number
}): {
  intro: SkipTimeRange | null
  recap: SkipTimeRange | null
  outro: SkipTimeRange | null
} {
  const dur = durationSec > 0 ? durationSec : expectedDurationSec

  let intro: SkipTimeRange | null = null
  let recap: SkipTimeRange | null = null
  let outro: SkipTimeRange | null = null

  // 1. IntroDB (Highest priority)
  if (sources?.introDb) {
    const fromIntroDb = selectValidatedIntroDb(sources.introDb, { durationSec, expectedDurationSec })
    if (fromIntroDb.intro) intro = fromIntroDb.intro
    if (fromIntroDb.recap) recap = fromIntroDb.recap
    if (fromIntroDb.outro) outro = fromIntroDb.outro
    else if (fromIntroDb.postCredits) outro = fromIntroDb.postCredits
  }

  // 2. AniSkip (fills missing slots without overwriting IntroDB)
  if (sources?.aniSkip && (!intro || !outro || !recap)) {
    const fromAniSkip = selectValidatedAniSkip(sources.aniSkip, { durationSec: dur })
    if (!intro && fromAniSkip.intro) intro = fromAniSkip.intro
    if (!outro && fromAniSkip.outro) outro = fromAniSkip.outro
    if (!recap && fromAniSkip.recap) recap = fromAniSkip.recap
  }

  // 3. TheIntroDB (fills missing slots)
  if (sources?.theIntroDb && (!intro || !outro || !recap)) {
    const fromTheIntroDb = selectValidatedTheIntroDb(sources.theIntroDb, { durationSec: dur })
    if (!intro && fromTheIntroDb.intro) intro = fromTheIntroDb.intro
    if (!outro && fromTheIntroDb.outro) outro = fromTheIntroDb.outro
    if (!recap && fromTheIntroDb.recap) recap = fromTheIntroDb.recap
  }

  // 4. Stream metadata fallback
  if (!intro && streamIntro) {
    intro = validateSkipInterval(streamIntro, 'intro', { durationSec: dur })
  }
  if (!outro && streamOutro) {
    outro = validateSkipInterval(streamOutro, 'outro', { durationSec: dur })
  }

  // Clamping outro when stream cut is shorter than recorded outro
  if (outro && dur > 0 && outro.end > dur && outro.start < dur) {
    outro = { start: outro.start, end: round1(dur) }
  }

  return sanitizeSkipPair({ intro, recap, outro, durationSec, expectedDurationSec })
}

