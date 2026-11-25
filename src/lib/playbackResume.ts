export function buildPosStorageKey({
  mediaId,
  episode = 1,
  season = 1,
  isTmdb = false,
}: {
  mediaId: number
  episode?: number
  season?: number
  isTmdb?: boolean
}): string {
  const s = Math.max(1, Number(season) || 1)
  const e = Math.max(1, Number(episode) || 1)
  return isTmdb ? `zk:pos:tmdb:${s}:${mediaId}:${e}` : `zk:pos:${mediaId}:${e}`
}

export function isNearOrAtPlaybackEnd(
  currentTimeSec: number,
  durationSec: number,
  ended = false,
): boolean {
  if (ended) return true
  if (!Number.isFinite(durationSec) || durationSec <= 0) return false
  if (!Number.isFinite(currentTimeSec) || currentTimeSec < 0) return false
  const remaining = durationSec - currentTimeSec
  return remaining <= 15 || currentTimeSec / durationSec >= 0.90
}

export function shouldPersistPlaybackPosition(
  currentTimeSec: number,
  durationSec: number,
): boolean {
  if (!Number.isFinite(currentTimeSec) || currentTimeSec < 5) return false
  if (Number.isFinite(durationSec) && durationSec > 0 && isNearOrAtPlaybackEnd(currentTimeSec, durationSec, false)) {
    return false
  }
  return true
}

export function resolveResumePosition({
  savedPos,
  livePos = 0,
  sameEpisode = false,
  durationSec,
  expectedDurationSec = 0,
  completed = false,
}: {
  savedPos: number
  livePos?: number
  sameEpisode?: boolean
  durationSec: number
  expectedDurationSec?: number
  completed?: boolean
}): number {
  if (completed) return 0
  const candidate = sameEpisode && livePos > 5 ? livePos : (savedPos > 5 ? savedPos : 0)
  if (candidate <= 5) return 0
  const effectiveDur = durationSec > 0 ? durationSec : expectedDurationSec
  if (effectiveDur > 0 && isNearOrAtPlaybackEnd(candidate, effectiveDur, false)) {
    return 0
  }
  return candidate
}

export function shouldRestartFromBeginningOnPlay({
  ended,
  currentTimeSec,
  durationSec,
}: {
  ended: boolean
  currentTimeSec: number
  durationSec: number
}): boolean {
  return Boolean(ended) || (durationSec > 0 && isNearOrAtPlaybackEnd(currentTimeSec, durationSec, ended))
}
