import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/** Deterministic per-route reading progress bar pinned to the top. Always resets to 0 on route change. */
export function ScrollProgress() {
  const { pathname } = useLocation()
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    el.style.transform = 'scaleX(0)'

    let raf = 0
    const update = () => {
      raf = 0
      const doc = document.documentElement
      const max = Math.max(0, doc.scrollHeight - window.innerHeight)
      const y = Math.max(0, window.scrollY || doc.scrollTop || 0)
      const progress = max <= 8 || y <= 1 ? 0 : Math.min(1, Math.max(0, y / max))
      el.style.transform = `scaleX(${progress})`
    }

    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(document.documentElement)

    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      ro?.disconnect()
    }
  }, [pathname])

  return (
    <div
      ref={barRef}
      aria-hidden
      style={{ transform: 'scaleX(0)' }}
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5 origin-left bg-accent will-change-transform"
    />
  )
}
