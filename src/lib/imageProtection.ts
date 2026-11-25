export interface TargetLike {
  tagName?: string
  closest?: (selector: string) => unknown
  querySelector?: (selector: string) => unknown
  parentElement?: TargetLike | null
}

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]'
const PROTECT_SELECTOR = 'img, picture, [data-protect-img]'
const DIRECT_IMG_SELECTOR = ':scope > img, :scope > picture'

/**
 * Returns true when a contextmenu or drag event targets an image or an image-only wrapper/overlay,
 * while ignoring inputs, textareas, and general page copy.
 */
export function shouldBlockImageTarget(rawTarget: unknown): boolean {
  const el = rawTarget as TargetLike | null | undefined
  if (!el || typeof el !== 'object') return false

  if (el.closest?.(EDITABLE_SELECTOR)) return false

  const tag = String(el.tagName || '').toUpperCase()
  if (tag === 'IMG' || tag === 'PICTURE') return true

  if (el.closest?.(PROTECT_SELECTOR)) return true

  // Because <img> uses pointer-events: none, long-press / right-click hits the wrapper or an overlay sibling
  if (el.querySelector?.(DIRECT_IMG_SELECTOR)) return true
  if (el.parentElement?.querySelector?.(DIRECT_IMG_SELECTOR)) return true

  return false
}

let installed = false

/**
 * Installs global client-side listeners that block image right-click saving, drag-and-drop,
 * and mobile long-press image callout/download menus without breaking card links or buttons.
 */
export function installImageProtection(): void {
  if (installed || typeof document === 'undefined') return
  installed = true

  const lockImg = (img: HTMLImageElement) => {
    if (img.draggable !== false) img.draggable = false
    if (!img.hasAttribute('draggable')) img.setAttribute('draggable', 'false')
  }

  document.querySelectorAll<HTMLImageElement>('img').forEach(lockImg)

  document.addEventListener(
    'contextmenu',
    (e) => {
      if (shouldBlockImageTarget(e.target)) {
        e.preventDefault()
      }
    },
    { capture: true },
  )

  document.addEventListener(
    'dragstart',
    (e) => {
      if (shouldBlockImageTarget(e.target)) {
        e.preventDefault()
      }
    },
    { capture: true },
  )

  document.addEventListener(
    'load',
    (e) => {
      const t = e.target as HTMLElement | null
      if (t && t.tagName === 'IMG') {
        lockImg(t as HTMLImageElement)
      }
    },
    true,
  )

  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLImageElement) {
            lockImg(node)
          } else if (node instanceof Element) {
            node.querySelectorAll('img').forEach((img) => lockImg(img as HTMLImageElement))
          }
        }
      }
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })
  }
}
