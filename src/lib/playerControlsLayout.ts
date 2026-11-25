/**
 * Pure responsive layout helpers for CinePlayer control bar so the rightmost
 * Fullscreen button never gets pushed out or clipped across mobile, embed,
 * tablet, or short laptop viewports.
 */

export function formatCompactAudioLabel(rawLabel: string, compact = false): string {
  const clean = String(rawLabel ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return 'Audio'
  if (!compact) return clean

  // Strip verbose parentheticals like "(Original)", "(Dub)", "(Regional Dub)" on narrow players
  const stripped = clean
    .replace(/\s*\((?:original|dub|regional dub|sub|multi[- ]audio|official)\)/gi, '')
    .replace(/\s+(?:Dub|Audio Track|Studio Audio)$/i, '')
    .trim()

  return stripped || clean
}

export interface ControlBarFitInput {
  containerWidthPx: number
  hasQuality: boolean
  hasAudio: boolean
  hasWatchTogether: boolean
  hasCast: boolean
  compactMode: boolean
  audioPillWidthPx?: number
}

export function estimateControlBarWidthPx({
  containerWidthPx,
  hasQuality,
  hasAudio,
  hasWatchTogether,
  hasCast,
  compactMode,
  audioPillWidthPx,
}: ControlBarFitInput): {
  innerWidthPx: number
  totalControlsWidthPx: number
  fitsInsideContainer: boolean
} {
  const w = Math.max(240, containerWidthPx)
  const horizPad = w <= 480 ? Math.max(16, Math.round(w * 0.045)) : Math.min(45, Math.round(w * 0.06))
  const innerWidthPx = Math.max(200, w - horizPad)

  const iconW = w <= 380 ? 25 : w <= 480 ? 28 : 36
  const gap = w <= 480 ? 2 : 4
  const speedW = compactMode ? 28 : 34
  const qualW = hasQuality ? (compactMode ? 40 : 52) : 0
  const maxAudW = w <= 315 ? iconW : w <= 380 ? Math.round(w * 0.21) : w <= 480 ? Math.round(w * 0.24) : 160
  const audW = hasAudio ? Math.min(audioPillWidthPx ?? maxAudW, maxAudW) : 0

  const iconCount =
    1 + // Mute
    1 + // CC
    (hasWatchTogether ? 1 : 0) +
    1 + // Settings
    (hasCast ? 1 : 0) +
    1 // Fullscreen (always present)

  const buttonCount = iconCount + (hasAudio ? 1 : 0) + 1 + (hasQuality ? 1 : 0)
  const totalGaps = Math.max(0, buttonCount - 1) * gap
  const totalControlsWidthPx = iconCount * iconW + audW + speedW + qualW + totalGaps

  return {
    innerWidthPx,
    totalControlsWidthPx,
    fitsInsideContainer: totalControlsWidthPx <= innerWidthPx,
  }
}
