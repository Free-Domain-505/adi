/**
 * Pure interaction heuristics & state transitions for CinePlayer touch/pointer/click handling.
 * Decoupled from DOM/React so tap disambiguation can be deterministically unit-tested.
 */

export interface ResolveIsTouchInput {
  pointerType?: string
  firesTouchEvents?: boolean
  lastTouchAt: number
  now: number
  isCoarseOnly?: boolean
  touchGraceMs?: number
}

/**
 * Determines whether a tap/click event originated from touch/pen rather than a mouse.
 * Guards against mobile WebViews that synthesize `pointerType: "mouse"` immediately after touch events,
 * or omit `pointerType` in fallback `click` listeners, while preserving mouse clicks on hybrid devices.
 */
export function resolveIsTouchInteraction({
  pointerType,
  firesTouchEvents = false,
  lastTouchAt,
  now,
  isCoarseOnly = false,
  touchGraceMs = 900,
}: ResolveIsTouchInput): boolean {
  if (pointerType === 'touch' || pointerType === 'pen') return true
  if (firesTouchEvents) return true
  if (isCoarseOnly) return true

  const elapsedSinceTouch = lastTouchAt > 0 && now >= lastTouchAt ? now - lastTouchAt : Number.POSITIVE_INFINITY

  if (pointerType === 'mouse') {
    return elapsedSinceTouch < touchGraceMs
  }

  return elapsedSinceTouch < 1500
}

export interface SyntheticUiClickInput {
  detail: number
  now: number
  unlockAt: number
  uiPointerDownSeen: boolean
  lastGestureTapAt: number
  syntheticWindowMs?: number
}

/**
 * Prevents delayed browser compatibility `click` events (dispatched after unhiding controls on `.zp-g`)
 * from activating newly revealed `.zp-ui` controls such as the center `.zp-hero` Play/Pause button.
 * Allows keyboard-initiated clicks (`detail === 0`) once the reveal lock window has passed.
 */
export function shouldBlockSyntheticUiClick({
  detail,
  now,
  unlockAt,
  uiPointerDownSeen,
  lastGestureTapAt,
  syntheticWindowMs = 1000,
}: SyntheticUiClickInput): boolean {
  if (now < unlockAt) return true
  if (detail > 0 && !uiPointerDownSeen && lastGestureTapAt > 0) {
    const sinceTap = now - lastGestureTapAt
    if (sinceTap >= 0 && sinceTap < syntheticWindowMs) return true
  }
  return false
}

export interface IgnoreGestureClickInput {
  detail: number
  now: number
  lastHandledTapAt: number
  lastPointerLifecycleAt: number
  windowMs?: number
}

/**
 * Ignores duplicate or trailing `.zp-g` `onClick` events that arrive after a pointer lifecycle
 * (`onPointerUp`, `onPointerCancel`, hold, drag/scroll) or an already-handled tap.
 */
export function shouldIgnoreGestureClick({
  detail,
  now,
  lastHandledTapAt,
  lastPointerLifecycleAt,
  windowMs = 1200,
}: IgnoreGestureClickInput): boolean {
  if (detail === 0) return false
  if (lastHandledTapAt > 0 && now >= lastHandledTapAt && now - lastHandledTapAt < windowMs) {
    return true
  }
  if (lastPointerLifecycleAt > 0 && now >= lastPointerLifecycleAt && now - lastPointerLifecycleAt < windowMs) {
    return true
  }
  return false
}

export interface StageTapState {
  t: number
  side: number
  chainSide: number
  chainUntil: number
  revealedAt: number
}

export interface StageTapInput {
  now: number
  xFrac: number
  isTouch: boolean
  wasVisible: boolean
  isShowingNow: boolean
  hasOpenPopup: boolean
  tapState: StageTapState
  dblWindowMs?: number
  revealGraceMs?: number
}

export type StageTapAction =
  | { kind: 'close-popup'; nextState: StageTapState }
  | { kind: 'desktop-click'; side: number; toggleFullscreen: boolean; armRevealLock: boolean; nextState: StageTapState }
  | { kind: 'touch-seek'; side: -1 | 1; nextState: StageTapState }
  | { kind: 'touch-show-now'; armRevealLock: boolean; nextState: StageTapState }
  | { kind: 'touch-show-delayed'; delayMs: number; nextState: StageTapState }
  | { kind: 'touch-keep-visible'; nextState: StageTapState }
  | { kind: 'touch-hide-now'; nextState: StageTapState }
  | { kind: 'touch-hide-delayed'; delayMs: number; nextState: StageTapState }

/**
 * Resolves the exact action for a tap/click on the player video stage (`.zp-g`).
 * Guarantee: when `isTouch` is true, tapping anywhere on the screen NEVER toggles Play/Pause;
 * touch taps strictly handle Hide/Unhide UI and Left/Right double-tap seeking.
 */
export function resolveStageTapAction({
  now,
  xFrac,
  isTouch,
  wasVisible,
  isShowingNow,
  hasOpenPopup,
  tapState,
  dblWindowMs = 260,
  revealGraceMs = 450,
}: StageTapInput): StageTapAction {
  if (hasOpenPopup) {
    return {
      kind: 'close-popup',
      nextState: { ...tapState },
    }
  }

  const side: -1 | 0 | 1 = xFrac < 0.38 ? -1 : xFrac > 0.62 ? 1 : 0
  const dbl = now - tapState.t < dblWindowMs && tapState.side === side

  if (!isTouch) {
    return {
      kind: 'desktop-click',
      side,
      toggleFullscreen: dbl,
      armRevealLock: !wasVisible || !isShowingNow,
      nextState: {
        ...tapState,
        t: dbl ? 0 : now,
        side,
        revealedAt: !wasVisible || !isShowingNow ? now : tapState.revealedAt,
      },
    }
  }

  // Touch: continue an active seek chain on the same side
  if (side !== 0 && tapState.chainSide === side && now < tapState.chainUntil) {
    return {
      kind: 'touch-seek',
      side,
      nextState: {
        ...tapState,
        t: 0,
        side: 0,
        chainSide: side,
        chainUntil: now + 700,
      },
    }
  }

  // Touch: double-tap left/right seeks backward/forward without play/pause
  if (side !== 0 && dbl) {
    return {
      kind: 'touch-seek',
      side,
      nextState: {
        ...tapState,
        t: 0,
        side: 0,
        chainSide: side,
        chainUntil: now + 700,
      },
    }
  }

  const baseState: StageTapState = {
    ...tapState,
    chainSide: 0,
    chainUntil: 0,
  }

  // Controls were hidden: center reveals immediately (with reveal lock); side waits dblWindow for seek disambiguation
  if (!wasVisible || !isShowingNow) {
    if (side === 0) {
      return {
        kind: 'touch-show-now',
        armRevealLock: true,
        nextState: {
          ...baseState,
          t: now,
          side,
          revealedAt: now,
        },
      }
    }
    return {
      kind: 'touch-show-delayed',
      delayMs: dblWindowMs,
      nextState: {
        ...baseState,
        t: now,
        side,
      },
    }
  }

  // Controls were just revealed moments ago: keep visible instead of immediately hiding
  if (now - tapState.revealedAt < revealGraceMs) {
    return {
      kind: 'touch-keep-visible',
      nextState: {
        ...baseState,
        t: now,
        side,
      },
    }
  }

  // Controls already visible: center hides immediately (zero play/pause conflict); side waits dblWindow for seek
  if (side === 0) {
    return {
      kind: 'touch-hide-now',
      nextState: {
        ...baseState,
        t: 0,
        side: 0,
      },
    }
  }

  return {
    kind: 'touch-hide-delayed',
    delayMs: dblWindowMs,
    nextState: {
      ...baseState,
      t: now,
      side,
    },
  }
}
