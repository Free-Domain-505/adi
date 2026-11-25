let guardedUntil = 0

/**
 * Arms a brief click guard right before search/overlay navigation closes so a touch ghost click
 * or double-tap cannot trigger buttons (such as "My List") mounting underneath on the next route.
 */
export function armNavClickGuard(ms = 800): void {
  guardedUntil = Math.max(guardedUntil, Date.now() + Math.max(0, ms))
}

export function isNavClickGuarded(): boolean {
  return Date.now() < guardedUntil
}

export function resetNavClickGuard(): void {
  guardedUntil = 0
}
