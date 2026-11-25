import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveIsTouchInteraction,
  resolveStageTapAction,
  shouldBlockSyntheticUiClick,
  shouldIgnoreGestureClick,
  type StageTapState,
} from '../src/lib/playerTapLogic'

const freshTap = (): StageTapState => ({
  t: 0,
  side: 0,
  chainSide: 0,
  chainUntil: 0,
  revealedAt: 0,
})

test('resolveStageTapAction guarantees touch screen taps ONLY toggle UI or seek, never Play/Pause', () => {
  // 1. Controls hidden + touch center -> shows UI immediately with reveal lock
  const showNow = resolveStageTapAction({
    now: 1000,
    xFrac: 0.5,
    isTouch: true,
    wasVisible: false,
    isShowingNow: false,
    hasOpenPopup: false,
    tapState: freshTap(),
  })
  assert.equal(showNow.kind, 'touch-show-now')
  if (showNow.kind === 'touch-show-now') {
    assert.equal(showNow.armRevealLock, true)
  }

  // 2. Rapid second touch at center 220ms after reveal (inside 450ms grace) keeps UI visible instead of pausing or flickering hidden
  const keepVisible = resolveStageTapAction({
    now: 1220,
    xFrac: 0.5,
    isTouch: true,
    wasVisible: true,
    isShowingNow: true,
    hasOpenPopup: false,
    tapState: showNow.nextState,
  })
  assert.equal(keepVisible.kind, 'touch-keep-visible')

  // 3. Touch center once UI has settled (>= 450ms) hides UI immediately without waiting for double-tap play/pause
  const hideNow = resolveStageTapAction({
    now: 1600,
    xFrac: 0.5,
    isTouch: true,
    wasVisible: true,
    isShowingNow: true,
    hasOpenPopup: false,
    tapState: showNow.nextState,
  })
  assert.equal(hideNow.kind, 'touch-hide-now')

  // 4. Exhaustive matrix: across hidden/visible/rapid double-taps, NO touch tap ever emits desktop-click (Play/Pause)
  for (const xFrac of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    for (const visible of [false, true]) {
      const a1 = resolveStageTapAction({
        now: 5000,
        xFrac,
        isTouch: true,
        wasVisible: visible,
        isShowingNow: visible,
        hasOpenPopup: false,
        tapState: { t: 4850, side: xFrac < 0.38 ? -1 : xFrac > 0.62 ? 1 : 0, chainSide: 0, chainUntil: 0, revealedAt: 1000 },
      })
      assert.notEqual(a1.kind, 'desktop-click')
    }
  }
})

test('resolveStageTapAction keeps double-tap side seek & desktop mouse click behavior intact', () => {
  // Touch double-tap right -> seek forward
  const firstRight = resolveStageTapAction({
    now: 2000,
    xFrac: 0.85,
    isTouch: true,
    wasVisible: false,
    isShowingNow: false,
    hasOpenPopup: false,
    tapState: freshTap(),
  })
  assert.equal(firstRight.kind, 'touch-show-delayed')

  const secondRight = resolveStageTapAction({
    now: 2150,
    xFrac: 0.85,
    isTouch: true,
    wasVisible: false,
    isShowingNow: false,
    hasOpenPopup: false,
    tapState: firstRight.nextState,
  })
  assert.equal(secondRight.kind, 'touch-seek')
  if (secondRight.kind === 'touch-seek') {
    assert.equal(secondRight.side, 1)
  }

  // Desktop mouse click still toggles Play/Pause and double-click toggles Fullscreen
  const d1 = resolveStageTapAction({
    now: 3000,
    xFrac: 0.5,
    isTouch: false,
    wasVisible: false,
    isShowingNow: false,
    hasOpenPopup: false,
    tapState: freshTap(),
  })
  assert.equal(d1.kind, 'desktop-click')
  if (d1.kind === 'desktop-click') {
    assert.equal(d1.toggleFullscreen, false)
    assert.equal(d1.armRevealLock, true)
  }

  const d2 = resolveStageTapAction({
    now: 3150,
    xFrac: 0.5,
    isTouch: false,
    wasVisible: true,
    isShowingNow: true,
    hasOpenPopup: false,
    tapState: d1.nextState,
  })
  assert.equal(d2.kind, 'desktop-click')
  if (d2.kind === 'desktop-click') {
    assert.equal(d2.toggleFullscreen, true)
  }
})

test('touch/synthetic click guards block delayed mobile clicks on newly revealed Play button', () => {
  // Emulated mouse pointer event 320ms after touch still resolves as touch
  assert.equal(
    resolveIsTouchInteraction({
      pointerType: 'mouse',
      lastTouchAt: 1000,
      now: 1320,
    }),
    true,
  )
  // Genuine desktop mouse event > 900ms after touch resolves as desktop mouse
  assert.equal(
    resolveIsTouchInteraction({
      pointerType: 'mouse',
      lastTouchAt: 1000,
      now: 2500,
    }),
    false,
  )

  // Delayed 300ms-550ms browser synthetic click without uiPointerDownSeen MUST be blocked on .zp-ui
  assert.equal(
    shouldBlockSyntheticUiClick({
      detail: 1,
      now: 1320,
      unlockAt: 1420,
      uiPointerDownSeen: false,
      lastGestureTapAt: 1000,
    }),
    true,
  )
  assert.equal(
    shouldBlockSyntheticUiClick({
      detail: 1,
      now: 1650,
      unlockAt: 1420,
      uiPointerDownSeen: false,
      lastGestureTapAt: 1000,
    }),
    true,
  )
  // Deliberate user tap on visible .zp-hero (uiPointerDownSeen: true) after unlockAt IS allowed
  assert.equal(
    shouldBlockSyntheticUiClick({
      detail: 1,
      now: 1650,
      unlockAt: 1420,
      uiPointerDownSeen: true,
      lastGestureTapAt: 1000,
    }),
    false,
  )

  // Duplicate onClick after pointerup or cancelled drag/hold on .zp-g is ignored
  assert.equal(
    shouldIgnoreGestureClick({
      detail: 1,
      now: 1500,
      lastHandledTapAt: 1000,
      lastPointerLifecycleAt: 1000,
    }),
    true,
  )
  // Keyboard accessibility click (detail === 0) is never blocked by pointer guard
  assert.equal(
    shouldIgnoreGestureClick({
      detail: 0,
      now: 1500,
      lastHandledTapAt: 1000,
      lastPointerLifecycleAt: 1000,
    }),
    false,
  )
})
