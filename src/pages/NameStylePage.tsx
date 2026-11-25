import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Eye,
  Info,
  Minus,
  Paintbrush,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Sliders,
  Waves,
} from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { StyledDisplayName } from '../components/StyledDisplayName'
import { useAuth } from '../context/AuthContext'
import {
  DEFAULT_CUSTOM_COLORS,
  DEFAULT_NAME_STYLE,
  NAME_ANIMATION_OPTIONS,
  NAME_GRADIENT_PRESETS,
  buildGradientCss,
  createStyleFromPreset,
  getPresetById,
  isDefaultNameStyle,
  sanitizeHexColor,
  sanitizeNameStyle,
  serializeNameStyle,
  type NameAnimationDirection,
  type NameAnimationId,
  type NameStyle,
} from '../lib/nameStyle'
import { flushProfileSync, saveProfile, useProfile } from '../lib/profile'
import { seedUserNameStyle } from '../lib/userNameStyles'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full border transition',
        checked ? 'border-transparent bg-accent' : 'border-border bg-card-2',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
          checked ? 'left-6' : 'left-0.5',
        )}
      />
    </button>
  )
}

const DIRECTION_OPTIONS: { id: NameAnimationDirection; label: string }[] = [
  { id: 'normal', label: 'Forward' },
  { id: 'reverse', label: 'Reverse' },
  { id: 'alternate', label: 'Alternate' },
]

export default function NameStylePage() {
  const me = useProfile()
  const { user, username: authUsername } = useAuth()

  const savedStyle = useMemo(
    () => (me.nameStyle ? sanitizeNameStyle(me.nameStyle) : { ...DEFAULT_NAME_STYLE, colors: [] }),
    [me.nameStyle],
  )

  const [draft, setDraft] = useState<NameStyle>(savedStyle)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const [previewSurface, setPreviewSurface] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    document.title = 'Name Colour & Gradients — AnimeStream'
  }, [])

  // Keep draft synced with cloud hydration if the user hasn't started editing
  useEffect(() => {
    if (!dirty) {
      setDraft(savedStyle)
    }
  }, [savedStyle, dirty])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setPrefersReducedMotion(mq.matches)
    sync()
    mq.addEventListener?.('change', sync)
    return () => mq.removeEventListener?.('change', sync)
  }, [])

  const displayName = me.name?.trim() || authUsername || 'Otaku'
  const handle = authUsername || (user?.email ? user.email.split('@')[0] : 'member')

  const hasUnsavedChanges = useMemo(
    () =>
      JSON.stringify(serializeNameStyle(draft)) !==
      JSON.stringify(serializeNameStyle(savedStyle)),
    [draft, savedStyle],
  )

  const updateDraft = (updater: (prev: NameStyle) => NameStyle) => {
    setDirty(true)
    setDraft((prev) => sanitizeNameStyle(updater(prev)))
  }

  /** Ensures custom gradient colors exist if editing styling options from Default */
  const withActiveColors = (prev: NameStyle): string[] =>
    prev.colors.length >= 2 ? [...prev.colors] : [...DEFAULT_CUSTOM_COLORS]

  const handleSelectPreset = (presetId: string) => {
    setDirty(true)
    setDraft((prev) => createStyleFromPreset(presetId, prev))
  }

  const handleSelectAnimation = (animId: NameAnimationId) => {
    updateDraft((prev) => {
      if (animId === 'none' && isDefaultNameStyle(prev)) {
        return prev
      }
      const colors = prev.presetId === 'default' && animId !== 'none' ? withActiveColors(prev) : prev.colors
      const presetId = prev.presetId === 'default' && animId !== 'none' ? 'custom' : prev.presetId
      return {
        ...prev,
        presetId,
        colors,
        animation: animId,
        staticGradient: animId === 'none' ? prev.staticGradient : false,
      }
    })
  }

  const handleColorChange = (index: number, rawHex: string) => {
    const clean = sanitizeHexColor(rawHex, DEFAULT_CUSTOM_COLORS[index % DEFAULT_CUSTOM_COLORS.length])
    updateDraft((prev) => {
      const nextColors = withActiveColors(prev)
      nextColors[index] = clean
      return {
        ...prev,
        presetId: 'custom',
        colors: nextColors,
      }
    })
  }

  const handleAddColorStop = () => {
    const paletteSuggestions = ['#38BDF8', '#A855F7', '#EC4899', '#F59E0B', '#10B981', '#F43F5E']
    updateDraft((prev) => {
      const nextColors = withActiveColors(prev)
      if (nextColors.length >= 6) return prev
      const nextHex = paletteSuggestions[nextColors.length % paletteSuggestions.length]
      nextColors.push(nextHex)
      return {
        ...prev,
        presetId: 'custom',
        colors: nextColors,
      }
    })
  }

  const handleRemoveColorStop = (index: number) => {
    updateDraft((prev) => {
      const nextColors = withActiveColors(prev)
      if (nextColors.length <= 2) return prev
      nextColors.splice(index, 1)
      return {
        ...prev,
        presetId: 'custom',
        colors: nextColors,
      }
    })
  }

  const handleApply = async () => {
    if (saving) return
    setSaving(true)
    const serialized = serializeNameStyle(draft)
    try {
      saveProfile({ nameStyle: serialized }, { immediate: true })
      const ok = await flushProfileSync()
      if (user?.id) {
        seedUserNameStyle(user.id, serialized)
      }
      setDirty(false)
      if (ok) {
        toast(
          serialized
            ? 'Name colour & gradient saved across your profile!'
            : 'Default display name appearance saved!',
          'success',
        )
      } else {
        toast('Applied locally. Sign in or check connection to sync across devices.', 'info')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (saving) return
    const cleanDefault: NameStyle = { ...DEFAULT_NAME_STYLE, colors: [] }
    setDraft(cleanDefault)
    setSaving(true)
    try {
      saveProfile({ nameStyle: null }, { immediate: true })
      const ok = await flushProfileSync()
      if (user?.id) {
        seedUserNameStyle(user.id, null)
      }
      setDirty(false)
      toast(
        ok ? 'Display name reset to Default appearance.' : 'Reset to Default display name.',
        'info',
      )
    } finally {
      setSaving(false)
    }
  }

  const activePreset = getPresetById(draft.presetId)
  const activeColors = draft.colors.length >= 2 ? draft.colors : DEFAULT_CUSTOM_COLORS
  const activeEffectOption = NAME_ANIMATION_OPTIONS.find((a) => a.id === draft.animation)

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl space-y-6 px-4 pb-28 pt-6 sm:px-6 sm:pt-8 md:pt-10">
      {/* Top Action Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-card p-4 shadow-lg sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/profile"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-card-2 px-4 text-xs sm:text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent active:scale-95"
          >
            <ArrowLeft className="size-4" />
            <span>Back to Profile</span>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-extrabold tracking-tight text-foreground sm:text-xl">
              Name Colour &amp; Gradients
            </h1>
            <p className="hidden truncate text-xs text-muted sm:block">
              Customize how your display name appears everywhere on AnimeStream
            </p>
          </div>
        </div>

        <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={saving}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-card-2 px-4 text-xs sm:text-sm font-semibold text-foreground transition hover:border-rose-500/50 hover:text-rose-400 active:scale-95 disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
            <span>Reset</span>
          </button>

          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-xs sm:text-sm font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-95 disabled:opacity-50"
          >
            <Save className="size-4" />
            <span>{saving ? 'Applying…' : hasUnsavedChanges ? 'Apply Changes' : 'Apply'}</span>
          </button>
        </div>
      </header>

      {prefersReducedMotion && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200"
        >
          <Info className="size-4 shrink-0 text-amber-400" />
          <p>
            Reduced motion is enabled on your device, so animated gradient motion is automatically paused while static colours, glow, and bold options remain active.
          </p>
        </div>
      )}

      {/* Large Live Display Name Preview */}
      <section
        aria-label="Live display name preview"
        className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-xl"
      >
        {/* Subtle ambient gradient wash */}
        {!isDefaultNameStyle(draft) && (
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 left-1/2 h-56 w-[80%] -translate-x-1/2 rounded-full opacity-20 blur-3xl transition-all duration-500"
            style={{ background: buildGradientCss(activeColors, draft.angle) }}
          />
        )}

        <div className="relative border-b border-border/70 px-5 py-3.5 sm:px-7 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Eye className="size-4 text-accent" />
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-foreground">
              Live Display Name Preview
            </h2>
            {hasUnsavedChanges && (
              <span className="text-[11px] font-semibold text-accent">• Unsaved preview</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-border bg-card-2 p-1 text-xs">
            <button
              type="button"
              onClick={() => setPreviewSurface('dark')}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition',
                previewSurface === 'dark'
                  ? 'bg-foreground text-background'
                  : 'text-muted hover:text-foreground',
              )}
            >
              Dark Backdrop
            </button>
            <button
              type="button"
              onClick={() => setPreviewSurface('light')}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition',
                previewSurface === 'light'
                  ? 'bg-foreground text-background'
                  : 'text-muted hover:text-foreground',
              )}
            >
              Light Backdrop
            </button>
          </div>
        </div>

        <div className="relative grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-center">
          {/* Primary Hero Preview */}
          <div
            className={cn(
              'flex min-h-[10rem] flex-col items-center justify-center rounded-2xl border px-6 py-8 text-center transition-colors',
              previewSurface === 'dark'
                ? 'border-white/10 bg-[#09090d] text-[#f5f5f7]'
                : 'border-black/10 bg-[#f6f6fa] text-[#0b0b0e]',
            )}
          >
            <span
              className={cn(
                'mb-2 text-[10px] font-bold uppercase tracking-[0.2em]',
                previewSurface === 'dark' ? 'text-white/50' : 'text-black/50',
              )}
            >
              {isDefaultNameStyle(draft)
                ? 'Default • Original Appearance'
                : `${activePreset ? activePreset.name : 'Custom Gradient'} • ${
                    draft.staticGradient
                      ? 'Static Mode'
                      : (activeEffectOption?.name ?? 'Static')
                  }`}
            </span>

            <div className="max-w-full overflow-hidden px-2">
              <StyledDisplayName
                name={displayName}
                styleSpec={draft}
                as="span"
                className="font-display text-3xl font-black tracking-tight sm:text-5xl break-words"
              />
            </div>

            <span
              className={cn(
                'mt-2 font-mono text-xs font-medium',
                previewSurface === 'dark' ? 'text-white/55' : 'text-black/55',
              )}
            >
              @{handle}
            </span>
          </div>

          {/* Real-world UI Context Snippets */}
          <div className="space-y-3">
            {/* Profile card preview */}
            <div className="rounded-2xl border border-border bg-card-2/60 p-3.5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                Profile &amp; User Card
              </p>
              <div className="flex items-center gap-3">
                <Avatar size={42} src={me.avatar} frame={me.frame} name={displayName} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <StyledDisplayName
                      name={displayName}
                      styleSpec={draft}
                      className="truncate font-display text-sm font-black text-foreground"
                    />
                  </div>
                  <p className="truncate font-mono text-[11px] text-muted">@{handle}</p>
                </div>
              </div>
            </div>

            {/* Community / Comment preview */}
            <div className="rounded-2xl border border-border bg-card-2/60 p-3.5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                Community &amp; Chat Header
              </p>
              <div className="flex items-start gap-2.5">
                <Avatar size={30} src={me.avatar} frame={me.frame} name={displayName} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <StyledDisplayName
                      name={displayName}
                      styleSpec={draft}
                      className="truncate font-black text-foreground"
                    />
                    <span className="font-mono text-[11px] text-muted">@{handle}</span>
                    <span className="text-[11px] text-muted">• Just now</span>
                  </div>
                  <p className="mt-1 rounded-xl border border-border/70 bg-card px-3 py-1.5 text-xs text-foreground/90">
                    Watching today&apos;s new episode!
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Customization Workspace */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
        {/* Left Column: Presets + Animated Effects */}
        <div className="space-y-6 min-w-0">
          {/* Section 1: Gradient Presets */}
          <section className="rounded-3xl border border-border bg-card/70 p-5 sm:p-6 shadow-lg space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold flex items-center gap-2 text-foreground">
                  <Palette className="size-5 text-accent" />
                  <span>Gradient Presets</span>
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  Choose from {NAME_GRADIENT_PRESETS.length} ready-made styles, or switch back to Default anytime.
                </p>
              </div>
              <span className="font-mono text-xs font-semibold tabular-nums text-muted">
                {NAME_GRADIENT_PRESETS.length} presets
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {NAME_GRADIENT_PRESETS.map((preset) => {
                const isSelected = draft.presetId === preset.id && (preset.id !== 'default' || isDefaultNameStyle(draft))
                const isDefault = preset.id === 'default'

                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      'group relative flex flex-col justify-between rounded-2xl border p-3 text-left transition active:scale-[0.98]',
                      isSelected
                        ? 'border-accent bg-accent/10 ring-1 ring-accent/40 shadow-md'
                        : 'border-border bg-card-2/50 hover:border-foreground/25 hover:bg-card-2',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      {isDefault ? (
                        <span className="inline-flex h-5 w-full items-center rounded-lg border border-dashed border-border bg-background/60 px-2 text-[10px] font-semibold text-muted">
                          Original Style
                        </span>
                      ) : (
                        <span
                          className="h-5 w-full rounded-lg shadow-inner"
                          style={{ backgroundImage: buildGradientCss(preset.colors, preset.angle) }}
                        />
                      )}
                      {isSelected && (
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-fg shadow-sm">
                          <Check className="size-3 stroke-[3]" />
                        </span>
                      )}
                    </div>

                    <div className="mt-2.5 min-w-0">
                      {isDefault ? (
                        <p className="truncate font-display text-sm font-bold text-foreground">
                          {preset.name}
                        </p>
                      ) : (
                        <p
                          className="truncate font-display text-sm font-extrabold"
                          style={{
                            backgroundImage: buildGradientCss(preset.colors, preset.angle),
                            backgroundClip: 'text',
                            WebkitBackgroundClip: 'text',
                            color: 'transparent',
                            WebkitTextFillColor: 'transparent',
                          }}
                        >
                          {preset.name}
                        </p>
                      )}
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">
                        {preset.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Section 2: Animated Gradient Effects */}
          <section className="rounded-3xl border border-border bg-card/70 p-5 sm:p-6 shadow-lg space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold flex items-center gap-2 text-foreground">
                  <Waves className="size-5 text-accent" />
                  <span>Animated Gradient Effects</span>
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  Smooth, GPU-composited motion effects calibrated for low CPU usage.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {NAME_ANIMATION_OPTIONS.map((effect) => {
                const selected = draft.animation === effect.id
                const effectPreviewSpec: NameStyle = {
                  ...draft,
                  presetId: draft.presetId === 'default' ? 'sunset' : draft.presetId,
                  colors: activeColors,
                  animation: effect.id,
                  staticGradient: false,
                }

                return (
                  <button
                    key={effect.id}
                    type="button"
                    onClick={() => handleSelectAnimation(effect.id)}
                    aria-pressed={selected}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.98]',
                      selected
                        ? 'border-accent bg-accent/10 ring-1 ring-accent/40'
                        : 'border-border bg-card-2/50 hover:border-foreground/25 hover:bg-card-2',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-bold text-foreground">{effect.name}</p>
                        {selected && (
                          <Check className="size-3.5 shrink-0 text-accent stroke-[3]" />
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">
                        {effect.description}
                      </p>
                    </div>

                    <div className="grid h-9 w-12 shrink-0 place-items-center rounded-xl border border-border/80 bg-[#0b0b0f] px-1">
                      <StyledDisplayName
                        name="Aa"
                        styleSpec={effectPreviewSpec}
                        className="font-display text-sm font-black"
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        </div>

        {/* Right Column: Custom Gradient Creator + Additional Styling Options */}
        <div className="space-y-6 min-w-0">
          {/* Custom Gradient Creator */}
          <section className="rounded-3xl border border-border bg-card/70 p-5 sm:p-6 shadow-lg space-y-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold flex items-center gap-2 text-foreground">
                  <Paintbrush className="size-5 text-accent" />
                  <span>Custom Gradient Creator</span>
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  Build multi-stop gradients with custom angles and glow.
                </p>
              </div>
              {draft.presetId === 'custom' && (
                <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                  Custom
                </span>
              )}
            </div>

            {/* Gradient Bar Preview */}
            <div
              className="h-8 w-full rounded-2xl border border-border shadow-inner transition-all"
              style={{ backgroundImage: buildGradientCss(activeColors, draft.angle) }}
              aria-label="Current gradient colour bar"
            />

            {/* Colour Stops */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">
                  Colour Stops ({activeColors.length}/6)
                </span>
                <button
                  type="button"
                  onClick={handleAddColorStop}
                  disabled={activeColors.length >= 6}
                  className="inline-flex items-center gap-1 rounded-xl border border-border bg-card-2 px-2.5 py-1 text-xs font-semibold text-foreground transition hover:border-accent hover:text-accent disabled:opacity-40 active:scale-95"
                >
                  <Plus className="size-3.5" />
                  <span>Add Stop</span>
                </button>
              </div>

              <div className="space-y-2">
                {activeColors.map((hex, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-2xl border border-border bg-card-2/60 p-2"
                  >
                    <label
                      className="relative grid size-9 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-xl border border-border shadow-sm"
                      style={{ backgroundColor: hex }}
                      title={`Pick colour ${index + 1}`}
                    >
                      <input
                        type="color"
                        aria-label={`Colour stop ${index + 1}`}
                        value={hex}
                        onChange={(e) => handleColorChange(index, e.target.value)}
                        className="absolute inset-0 size-full cursor-pointer opacity-0"
                      />
                    </label>

                    <div className="min-w-0 flex-1">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
                        Stop {index + 1}
                      </span>
                      <input
                        type="text"
                        value={hex}
                        maxLength={7}
                        aria-label={`Hex code for stop ${index + 1}`}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (/^#[0-9a-fA-F]{6}$/.test(raw.trim())) {
                            handleColorChange(index, raw)
                          } else {
                            setDirty(true)
                            setDraft((prev) => {
                              const cols = withActiveColors(prev)
                              cols[index] = raw
                              return { ...prev, presetId: 'custom', colors: cols }
                            })
                          }
                        }}
                        onBlur={(e) => handleColorChange(index, e.target.value)}
                        className="w-full bg-transparent font-mono text-xs font-bold uppercase text-foreground outline-none"
                      />
                    </div>

                    {activeColors.length > 2 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveColorStop(index)}
                        aria-label={`Remove stop ${index + 1}`}
                        className="grid size-8 shrink-0 place-items-center rounded-xl border border-border text-muted transition hover:border-rose-500/50 hover:text-rose-400 active:scale-90"
                      >
                        <Minus className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Gradient Angle */}
            <div className="space-y-2 border-t border-border/60 pt-4">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="gradient-angle" className="font-bold text-foreground">
                  Gradient Angle
                </label>
                <span className="font-mono font-bold tabular-nums text-accent">
                  {draft.angle}°
                </span>
              </div>
              <input
                id="gradient-angle"
                type="range"
                min={0}
                max={360}
                step={5}
                value={draft.angle}
                onChange={(e) =>
                  updateDraft((prev) => ({
                    ...prev,
                    presetId: prev.presetId === 'default' ? 'custom' : prev.presetId,
                    colors: withActiveColors(prev),
                    angle: Number(e.target.value),
                  }))
                }
                className="zk-range w-full"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[0, 45, 90, 135, 180].map((deg) => (
                  <button
                    key={deg}
                    type="button"
                    onClick={() =>
                      updateDraft((prev) => ({
                        ...prev,
                        presetId: prev.presetId === 'default' ? 'custom' : prev.presetId,
                        colors: withActiveColors(prev),
                        angle: deg,
                      }))
                    }
                    className={cn(
                      'rounded-lg border px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums transition',
                      draft.angle === deg
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border bg-card-2 text-muted hover:text-foreground',
                    )}
                  >
                    {deg}°
                  </button>
                ))}
              </div>
            </div>

            {/* Animation Direction & Speed */}
            <div className="space-y-3 border-t border-border/60 pt-4">
              <div className="space-y-1.5">
                <span className="block text-xs font-bold text-foreground">
                  Animation Direction
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {DIRECTION_OPTIONS.map((dir) => (
                    <button
                      key={dir.id}
                      type="button"
                      disabled={draft.staticGradient || draft.animation === 'none'}
                      onClick={() =>
                        updateDraft((prev) => ({
                          ...prev,
                          animationDirection: dir.id,
                        }))
                      }
                      className={cn(
                        'rounded-xl border py-1.5 text-xs font-semibold transition disabled:opacity-40',
                        draft.animationDirection === dir.id
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-border bg-card-2 text-muted hover:text-foreground',
                      )}
                    >
                      {dir.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="anim-speed" className="font-bold text-foreground">
                    Animation Speed
                  </label>
                  <span className="font-mono font-bold tabular-nums text-accent">
                    {draft.animationSpeed.toFixed(1)}×
                  </span>
                </div>
                <input
                  id="anim-speed"
                  type="range"
                  min={0.5}
                  max={3}
                  step={0.1}
                  disabled={draft.staticGradient || draft.animation === 'none'}
                  value={draft.animationSpeed}
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      animationSpeed: Number(e.target.value),
                    }))
                  }
                  className="zk-range w-full disabled:opacity-40"
                />
              </div>
            </div>

            {/* Reset to Default inline action */}
            <button
              type="button"
              onClick={() => void handleReset()}
              disabled={saving}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card-2 text-xs font-bold text-foreground transition hover:border-rose-500/50 hover:text-rose-400 active:scale-[0.98]"
            >
              <RotateCcw className="size-3.5" />
              <span>Reset to Default</span>
            </button>
          </section>

          {/* Additional Styling Options */}
          <section className="rounded-3xl border border-border bg-card/70 p-5 sm:p-6 shadow-lg space-y-4">
            <h2 className="font-display text-lg font-bold flex items-center gap-2 text-foreground">
              <Sliders className="size-5 text-accent" />
              <span>Additional Styling Options</span>
            </h2>

            <div className="divide-y divide-border/60">
              {/* Neon Glow */}
              <div className="space-y-3 py-3 first:pt-0">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Neon glow</p>
                    <p className="text-[11px] text-muted">Luminous aura matched to your gradient</p>
                  </div>
                  <ToggleSwitch
                    checked={draft.glowEnabled}
                    label="Neon glow"
                    onChange={(glowEnabled) =>
                      updateDraft((prev) => ({
                        ...prev,
                        presetId: prev.presetId === 'default' && glowEnabled ? 'custom' : prev.presetId,
                        colors: prev.presetId === 'default' && glowEnabled ? withActiveColors(prev) : prev.colors,
                        glowEnabled,
                        glowIntensity: glowEnabled ? (prev.glowIntensity > 0 ? prev.glowIntensity : 55) : prev.glowIntensity,
                      }))
                    }
                  />
                </div>

                {draft.glowEnabled && (
                  <div className="space-y-1.5 pl-1">
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor="glow-intensity" className="font-medium text-muted">
                        Glow intensity
                      </label>
                      <span className="font-mono font-bold tabular-nums text-accent">
                        {draft.glowIntensity}%
                      </span>
                    </div>
                    <input
                      id="glow-intensity"
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={draft.glowIntensity}
                      onChange={(e) =>
                        updateDraft((prev) => ({
                          ...prev,
                          glowIntensity: Number(e.target.value),
                        }))
                      }
                      className="zk-range w-full"
                    />
                  </div>
                )}
              </div>

              {/* Soft Shadow */}
              <div className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Soft shadow</p>
                  <p className="text-[11px] text-muted">Adds depth against bright backdrops</p>
                </div>
                <ToggleSwitch
                  checked={draft.softShadow}
                  label="Soft shadow"
                  onChange={(softShadow) =>
                    updateDraft((prev) => ({
                      ...prev,
                      presetId: prev.presetId === 'default' && softShadow ? 'custom' : prev.presetId,
                      colors: prev.presetId === 'default' && softShadow ? withActiveColors(prev) : prev.colors,
                      softShadow,
                    }))
                  }
                />
              </div>

              {/* Static Gradient Mode */}
              <div className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Static gradient mode</p>
                  <p className="text-[11px] text-muted">Keep gradient fixed without motion</p>
                </div>
                <ToggleSwitch
                  checked={draft.staticGradient}
                  label="Static gradient mode"
                  onChange={(staticGradient) =>
                    updateDraft((prev) => ({
                      ...prev,
                      staticGradient,
                    }))
                  }
                />
              </div>

              {/* Gradient Intensity */}
              <div className="space-y-1.5 pt-3">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="grad-intensity" className="font-semibold text-foreground">
                    Gradient intensity
                  </label>
                  <span className="font-mono font-bold tabular-nums text-accent">
                    {draft.gradientIntensity}%
                  </span>
                </div>
                <input
                  id="grad-intensity"
                  type="range"
                  min={50}
                  max={150}
                  step={5}
                  value={draft.gradientIntensity}
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      presetId: prev.presetId === 'default' ? 'custom' : prev.presetId,
                      colors: withActiveColors(prev),
                      gradientIntensity: Number(e.target.value),
                    }))
                  }
                  className="zk-range w-full"
                />
              </div>
            </div>

            {/* Bottom Save Action */}
            <div className="border-t border-border/60 pt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={saving}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                <Save className="size-4" />
                <span>{saving ? 'Saving to Cloud…' : 'Apply Style'}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
