import { useEffect, useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

function forceTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

/** Resets scroll synchronously before paint on navigation, or smooth-scrolls to a #section when the URL has a hash. */
export function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    try {
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'manual'
      }
    } catch {
      /* ignore */
    }
  }, [])

  useLayoutEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1))
      const t = window.setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 120)
      return () => window.clearTimeout(t)
    }

    // Release any lingering modal scroll lock right on route change before resetting scroll position
    if (document.body.style.overflow === 'hidden') {
      document.body.style.overflow = ''
    }

    forceTop()
    const raf1 = window.requestAnimationFrame(forceTop)
    const raf2 = window.requestAnimationFrame(() => window.requestAnimationFrame(forceTop))
    const settleTimer = window.setTimeout(forceTop, 80)

    return () => {
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
      window.clearTimeout(settleTimer)
    }
  }, [pathname, hash])

  return null
}
