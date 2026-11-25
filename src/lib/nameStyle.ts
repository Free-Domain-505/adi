import type { CSSProperties } from 'react'

export type NameAnimationId =
  | 'none'
  | 'smooth-move'
  | 'rainbow'
  | 'neon-pulse'
  | 'color-shift'
  | 'aurora-flow'
  | 'shimmer'
  | 'rgb-flow'
  | 'cosmic-glow'
  | 'holographic'

export type NameAnimationDirection = 'normal' | 'reverse' | 'alternate'

export interface NameStyle {
  presetId: string
  colors: string[]
  angle: number
  animation: NameAnimationId
  animationSpeed: number
  animationDirection: NameAnimationDirection
  staticGradient: boolean
  gradientIntensity: number
  bold: boolean
  glowEnabled: boolean
  glowIntensity: number
  softShadow: boolean
}

export interface NameGradientPreset {
  id: string
  name: string
  description: string
  colors: string[]
  angle: number
  recommendedAnimation?: NameAnimationId
  recommendedGlow?: boolean
  recommendedGlowIntensity?: number
}

export interface NameAnimationOption {
  id: NameAnimationId
  name: string
  description: string
}

export const DEFAULT_CUSTOM_COLORS: string[] = ['#FF512F', '#F09819', '#FF6B9D']

export const DEFAULT_NAME_STYLE: NameStyle = {
  presetId: 'default',
  colors: [],
  angle: 90,
  animation: 'none',
  animationSpeed: 1,
  animationDirection: 'normal',
  staticGradient: false,
  gradientIntensity: 100,
  bold: true,
  glowEnabled: false,
  glowIntensity: 0,
  softShadow: false,
}

export const NAME_GRADIENT_PRESETS: NameGradientPreset[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Original AnimeStream display name appearance',
    colors: [],
    angle: 90,
    recommendedAnimation: 'none',
    recommendedGlow: false,
    recommendedGlowIntensity: 0,
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm tangerine, amber gold, and twilight rose',
    colors: ['#FF512F', '#F09819', '#FF6B9D'],
    angle: 115,
    recommendedAnimation: 'smooth-move',
  },
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    description: 'Deep marine azure into bright sky cyan',
    colors: ['#00C6FF', '#0072FF', '#38BDF8'],
    angle: 110,
    recommendedAnimation: 'smooth-move',
  },
  {
    id: 'purple-dream',
    name: 'Purple Dream',
    description: 'Velvet amethyst, orchid pink, and indigo',
    colors: ['#A855F7', '#EC4899', '#6366F1'],
    angle: 120,
    recommendedAnimation: 'color-shift',
  },
  {
    id: 'neon-cyber',
    name: 'Neon Cyber',
    description: 'High-voltage cyan and magenta arcade glow',
    colors: ['#00F5D4', '#00BBF9', '#F15BB5'],
    angle: 95,
    recommendedAnimation: 'neon-pulse',
    recommendedGlow: true,
    recommendedGlowIntensity: 65,
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Northern lights emerald, aqua, and violet',
    colors: ['#00F5A0', '#00D9F5', '#8B5CF6'],
    angle: 115,
    recommendedAnimation: 'aurora-flow',
  },
  {
    id: 'fire',
    name: 'Fire',
    description: 'Crimson embers into molten solar gold',
    colors: ['#FF0844', '#FF6A00', '#FFB100'],
    angle: 90,
    recommendedAnimation: 'smooth-move',
    recommendedGlow: true,
    recommendedGlowIntensity: 50,
  },
  {
    id: 'candy',
    name: 'Candy',
    description: 'Pastel strawberry frost and lavender sugar',
    colors: ['#FF9A9E', '#FECFEF', '#A18CD1'],
    angle: 105,
    recommendedAnimation: 'shimmer',
  },
  {
    id: 'rose-gold',
    name: 'Rose Gold',
    description: 'Brushed champagne blush and warm copper',
    colors: ['#F4C4F3', '#E8998D', '#FAD0C4'],
    angle: 120,
    recommendedAnimation: 'shimmer',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    description: 'Rich jade green with crisp mint highlights',
    colors: ['#10B981', '#34D399', '#059669'],
    angle: 110,
    recommendedAnimation: 'smooth-move',
  },
  {
    id: 'galaxy',
    name: 'Galaxy',
    description: 'Deep starfield violet, magenta, and astral blue',
    colors: ['#6366F1', '#A855F7', '#EC4899', '#3B82F6'],
    angle: 135,
    recommendedAnimation: 'cosmic-glow',
    recommendedGlow: true,
    recommendedGlowIntensity: 55,
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    description: 'Full prism spectrum from crimson to violet',
    colors: ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#AF52DE'],
    angle: 90,
    recommendedAnimation: 'rainbow',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Nocturnal sapphire, royal indigo, and moonlight',
    colors: ['#4F46E5', '#818CF8', '#38BDF8'],
    angle: 125,
    recommendedAnimation: 'smooth-move',
  },
  {
    id: 'electric-violet',
    name: 'Electric Violet',
    description: 'Hyper-charged ultraviolet and neon cyan',
    colors: ['#7C3AED', '#C026D3', '#38BDF8'],
    angle: 115,
    recommendedAnimation: 'rgb-flow',
    recommendedGlow: true,
    recommendedGlowIntensity: 60,
  },
  {
    id: 'toxic-green',
    name: 'Toxic Green',
    description: 'Radioactive lime into vivid neon emerald',
    colors: ['#39FF14', '#A3E635', '#10B981'],
    angle: 100,
    recommendedAnimation: 'neon-pulse',
    recommendedGlow: true,
    recommendedGlowIntensity: 60,
  },
  {
    id: 'ice-crystal',
    name: 'Ice Crystal',
    description: 'Glacier frost white, aqua, and arctic blue',
    colors: ['#E0F2FE', '#7DD3FC', '#38BDF8', '#A5F3FC'],
    angle: 120,
    recommendedAnimation: 'shimmer',
  },
  {
    id: 'cherry-blossom',
    name: 'Cherry Blossom',
    description: 'Sakura petal rose, coral pink, and soft cream',
    colors: ['#FF758C', '#FF7EB3', '#FFD1DC'],
    angle: 110,
    recommendedAnimation: 'aurora-flow',
  },
  {
    id: 'golden-glow',
    name: 'Golden Glow',
    description: 'Radiant metallic gold and warm amber sheen',
    colors: ['#FDE047', '#F59E0B', '#FEF08A'],
    angle: 105,
    recommendedAnimation: 'shimmer',
    recommendedGlow: true,
    recommendedGlowIntensity: 45,
  },
  {
    id: 'cosmic-nebula',
    name: 'Cosmic Nebula',
    description: 'Supernova rose, astral purple, and hyper-cyan',
    colors: ['#F43F5E', '#A855F7', '#22D3EE'],
    angle: 130,
    recommendedAnimation: 'holographic',
    recommendedGlow: true,
    recommendedGlowIntensity: 60,
  },
]

export const NAME_ANIMATION_OPTIONS: NameAnimationOption[] = [
  {
    id: 'none',
    name: 'None (Static)',
    description: 'Crisp fixed gradient without motion',
  },
  {
    id: 'smooth-move',
    name: 'Smooth Moving Gradient',
    description: 'Fluid, continuous sweep across your colour stops',
  },
  {
    id: 'rainbow',
    name: 'Rainbow Animation',
    description: 'Seamless spectrum glide through vibrant hues',
  },
  {
    id: 'neon-pulse',
    name: 'Neon Pulse',
    description: 'Rhythmic neon luminance and subtle aura pulse',
  },
  {
    id: 'color-shift',
    name: 'Colour Shifting',
    description: 'Gradual chromatic rotation across tones',
  },
  {
    id: 'aurora-flow',
    name: 'Aurora Flow',
    description: 'Silky northern-lights wave drift',
  },
  {
    id: 'shimmer',
    name: 'Shimmer Effect',
    description: 'Polished gleam sweeping across letterforms',
  },
  {
    id: 'rgb-flow',
    name: 'RGB Flow',
    description: 'Dynamic multi-band cyber chroma motion',
  },
  {
    id: 'cosmic-glow',
    name: 'Cosmic Glow',
    description: 'Deep astral drift with radiant starlight glow',
  },
  {
    id: 'holographic',
    name: 'Holographic Effect',
    description: 'Iridescent prism foil sheen',
  },
]

const VALID_ANIMATIONS = new Set<NameAnimationId>(NAME_ANIMATION_OPTIONS.map((a) => a.id))
const VALID_DIRECTIONS = new Set<NameAnimationDirection>(['normal', 'reverse', 'alternate'])
const PRESET_MAP = new Map<string, NameGradientPreset>(NAME_GRADIENT_PRESETS.map((p) => [p.id, p]))

export function getPresetById(id: string | null | undefined): NameGradientPreset | undefined {
  if (!id) return undefined
  return PRESET_MAP.get(id)
}

/**
 * Strictly validates and normalizes a CSS hex color to `#RRGGBB` format.
 * Rejects any unsafe strings, CSS injection attempts, functions, or non-hex values.
 */
export function sanitizeHexColor(raw: unknown, fallback = '#FF512F'): string {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  const shortMatch = trimmed.match(/^#([0-9a-fA-F]{3})$/)
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  return fallback
}

export function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const num = typeof val === 'number' ? val : Number(val)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

export function sanitizeColors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const cleaned: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed) || /^#[0-9a-fA-F]{3}$/.test(trimmed)) {
      cleaned.push(sanitizeHexColor(trimmed))
    }
    if (cleaned.length >= 6) break
  }
  return cleaned
}

/**
 * Returns true if the styling represents the clean, untouched Default Animestream display name.
 */
export function isDefaultNameStyle(raw: NameStyle | null | undefined): boolean {
  if (!raw) return true
  if (raw.presetId !== 'default') return false
  return (
    raw.colors.length === 0 &&
    raw.animation === 'none' &&
    !raw.glowEnabled &&
    !raw.softShadow
  )
}

/**
 * Sanitizes any untrusted NameStyle payload from Supabase, broadcast packets, or UI inputs.
 */
export function sanitizeNameStyle(raw: unknown): NameStyle {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_NAME_STYLE, colors: [] }
  }

  const obj = raw as Record<string, unknown>
  const rawPresetId = typeof obj.presetId === 'string' ? obj.presetId.trim().toLowerCase() : 'default'
  const knownPreset = PRESET_MAP.get(rawPresetId)
  const presetId = knownPreset ? knownPreset.id : rawPresetId === 'custom' ? 'custom' : 'default'

  let colors = sanitizeColors(obj.colors)
  if (presetId !== 'default') {
    if (colors.length < 2) {
      colors = knownPreset && knownPreset.colors.length >= 2
        ? [...knownPreset.colors]
        : [...DEFAULT_CUSTOM_COLORS]
    }
  } else if (colors.length === 1) {
    colors = []
  }

  const animationRaw = typeof obj.animation === 'string' ? (obj.animation.trim() as NameAnimationId) : 'none'
  const animation: NameAnimationId = VALID_ANIMATIONS.has(animationRaw) ? animationRaw : 'none'

  const dirRaw = typeof obj.animationDirection === 'string'
    ? (obj.animationDirection.trim() as NameAnimationDirection)
    : 'normal'
  const animationDirection: NameAnimationDirection = VALID_DIRECTIONS.has(dirRaw) ? dirRaw : 'normal'

  const staticGradient = Boolean(obj.staticGradient)
  const angle = Math.round(clampNumber(obj.angle, 0, 360, knownPreset?.angle ?? 90))
  const animationSpeed = Math.round(clampNumber(obj.animationSpeed, 0.5, 3, 1) * 10) / 10
  const gradientIntensity = Math.round(clampNumber(obj.gradientIntensity, 50, 150, 100))
  const bold = true // Bold display name is permanently ON by default for everyone
  const glowEnabled = Boolean(obj.glowEnabled)
  const glowIntensity = glowEnabled
    ? Math.round(clampNumber(obj.glowIntensity, 0, 100, 55))
    : Math.round(clampNumber(obj.glowIntensity, 0, 100, 0))
  const softShadow = Boolean(obj.softShadow)

  const sanitized: NameStyle = {
    presetId,
    colors,
    angle,
    animation,
    animationSpeed,
    animationDirection,
    staticGradient,
    gradientIntensity,
    bold,
    glowEnabled,
    glowIntensity,
    softShadow,
  }

  if (isDefaultNameStyle(sanitized)) {
    return { ...DEFAULT_NAME_STYLE, colors: [] }
  }

  return sanitized
}

/**
 * Serializes a NameStyle for cloud storage (`null` when strictly Default so storage remains clean).
 */
export function serializeNameStyle(raw: NameStyle | null | undefined): NameStyle | null {
  const clean = sanitizeNameStyle(raw)
  return isDefaultNameStyle(clean) ? null : clean
}

/**
 * Builds a NameStyle initialized from one of the 19 presets.
 */
export function createStyleFromPreset(presetId: string, current?: NameStyle | null): NameStyle {
  const preset = PRESET_MAP.get(presetId)
  if (!preset || preset.id === 'default') {
    return { ...DEFAULT_NAME_STYLE, colors: [] }
  }

  const prev = sanitizeNameStyle(current)
  const preserveAdvanced = prev.presetId !== 'default'

  return sanitizeNameStyle({
    presetId: preset.id,
    colors: [...preset.colors],
    angle: preset.angle,
    animation: preset.recommendedAnimation ?? (preserveAdvanced ? prev.animation : 'smooth-move'),
    animationSpeed: preserveAdvanced ? prev.animationSpeed : 1,
    animationDirection: preserveAdvanced ? prev.animationDirection : 'normal',
    staticGradient: preserveAdvanced ? prev.staticGradient : false,
    gradientIntensity: preserveAdvanced ? prev.gradientIntensity : 100,
    bold: true,
    glowEnabled: preset.recommendedGlow ?? (preserveAdvanced ? prev.glowEnabled : false),
    glowIntensity: preset.recommendedGlow
      ? (preset.recommendedGlowIntensity ?? 55)
      : (preserveAdvanced ? prev.glowIntensity : 45),
    softShadow: preserveAdvanced ? prev.softShadow : false,
  })
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = sanitizeHexColor(hex, '#FFFFFF')
  const r = parseInt(clean.slice(1, 3), 16)
  const g = parseInt(clean.slice(3, 5), 16)
  const b = parseInt(clean.slice(5, 7), 16)
  const a = clampNumber(alpha, 0, 1, 1)
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`
}

export function buildGradientCss(colors: string[], angle: number): string {
  const safeColors = sanitizeColors(colors)
  const palette = safeColors.length >= 2 ? safeColors : DEFAULT_CUSTOM_COLORS
  const safeAngle = Math.round(clampNumber(angle, 0, 360, 90))
  return `linear-gradient(${safeAngle}deg, ${palette.join(', ')})`
}

export interface ResolvedNameStyle {
  isDefault: boolean
  className: string
  style: CSSProperties
}

const ANIMATION_CLASS_MAP: Record<NameAnimationId, string> = {
  none: '',
  'smooth-move': 'zk-name-fx-smooth-move',
  rainbow: 'zk-name-fx-rainbow',
  'neon-pulse': 'zk-name-fx-neon-pulse',
  'color-shift': 'zk-name-fx-color-shift',
  'aurora-flow': 'zk-name-fx-aurora-flow',
  shimmer: 'zk-name-fx-shimmer',
  'rgb-flow': 'zk-name-fx-rgb-flow',
  'cosmic-glow': 'zk-name-fx-cosmic-glow',
  holographic: 'zk-name-fx-holographic',
}

/**
 * Converts a NameStyle specification into safe inline React CSSProperties + animation utility classes.
 */
export function resolveNameStylePresentation(raw: NameStyle | null | undefined): ResolvedNameStyle {
  const spec = sanitizeNameStyle(raw)

  if (isDefaultNameStyle(spec)) {
    return {
      isDefault: true,
      className: 'font-black font-bold',
      style: {
        fontWeight: 900,
        letterSpacing: '-0.02em',
      },
    }
  }

  const hasGradient = spec.colors.length >= 2
  const activeAnimation: NameAnimationId = spec.staticGradient ? 'none' : spec.animation
  const animClass = ANIMATION_CLASS_MAP[activeAnimation] || ''

  const baseColors = hasGradient ? spec.colors : ['#F4F4F5', '#D4D4D8']
  const style: Record<string, string | number> = {}
  const classes: string[] = []

  if (hasGradient) {
    classes.push('zk-name-gradient')
    let gradientStops = [...baseColors]

    if (activeAnimation === 'rainbow') {
      gradientStops = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#3B82F6', '#AF52DE', '#FF3B30']
    } else if (
      activeAnimation === 'smooth-move' ||
      activeAnimation === 'aurora-flow' ||
      activeAnimation === 'rgb-flow' ||
      activeAnimation === 'holographic' ||
      activeAnimation === 'color-shift' ||
      activeAnimation === 'neon-pulse' ||
      activeAnimation === 'cosmic-glow'
    ) {
      // Mirror stops so seamless loop ping-pong or wrap stays velvety smooth
      gradientStops = [...baseColors, ...baseColors.slice(0, -1).reverse(), baseColors[0]]
    } else if (activeAnimation === 'shimmer') {
      const mid = Math.floor(baseColors.length / 2)
      gradientStops = [
        ...baseColors.slice(0, mid),
        '#FFFFFF',
        ...baseColors.slice(mid),
      ]
    }

    style.backgroundImage = `linear-gradient(${spec.angle}deg, ${gradientStops.join(', ')})`
    style.backgroundClip = 'text'
    style.WebkitBackgroundClip = 'text'
    style.color = 'transparent'
    style.WebkitTextFillColor = 'transparent'
  }

  style.fontWeight = 900
  style.letterSpacing = '-0.02em'

  // Filters: intensity (saturation/contrast) + soft shadow + neon glow via GPU-accelerated drop-shadow
  const filterParts: string[] = []
  if (hasGradient && spec.gradientIntensity !== 100) {
    const sat = (spec.gradientIntensity / 100).toFixed(2)
    filterParts.push(`saturate(${sat})`)
    if (spec.gradientIntensity > 105) {
      const bright = (1 + (spec.gradientIntensity - 100) / 350).toFixed(2)
      filterParts.push(`brightness(${bright})`)
    }
  }

  if (spec.softShadow) {
    filterParts.push('drop-shadow(0 2px 4px rgba(0, 0, 0, 0.52))')
  }

  if (spec.glowEnabled && spec.glowIntensity > 0) {
    const primaryGlow = baseColors[0]
    const secondaryGlow = baseColors[baseColors.length - 1] || primaryGlow
    const radius1 = Math.max(2, Math.round((spec.glowIntensity / 100) * 10))
    const radius2 = Math.max(5, Math.round((spec.glowIntensity / 100) * 20))
    const alpha1 = clampNumber(0.32 + (spec.glowIntensity / 100) * 0.45, 0.2, 0.85, 0.55)
    const alpha2 = clampNumber(0.18 + (spec.glowIntensity / 100) * 0.35, 0.1, 0.65, 0.35)
    filterParts.push(`drop-shadow(0 0 ${radius1}px ${hexToRgba(primaryGlow, alpha1)})`)
    filterParts.push(`drop-shadow(0 0 ${radius2}px ${hexToRgba(secondaryGlow, alpha2)})`)
  }

  if (filterParts.length > 0) {
    const joinedFilters = filterParts.join(' ')
    style.filter = joinedFilters
    style['--zk-name-filter'] = joinedFilters
  }

  if (animClass) {
    classes.push('zk-name-fx', animClass)
    // Base duration calibrated for smooth motion (shorter duration = faster speed multiplier)
    const baseSeconds =
      activeAnimation === 'neon-pulse'
        ? 2.4
        : activeAnimation === 'shimmer'
          ? 2.8
          : activeAnimation === 'rgb-flow'
            ? 3.2
            : 4.5
    const safeDuration = clampNumber(baseSeconds / spec.animationSpeed, 0.8, 12, 4.5)
    style['--zk-name-dur'] = `${safeDuration.toFixed(2)}s`
    style['--zk-name-dir'] = spec.animationDirection
  }

  return {
    isDefault: false,
    className: classes.join(' '),
    style: style as CSSProperties,
  }
}
