import { useEffect, useMemo, useRef, useState, type ImgHTMLAttributes } from 'react'
import { apiUrl } from '../services/api'

function buildCandidateUrls(
  src?: string | null,
  fallbackSrc?: string | null,
  proxyOnFail = true,
): string[] {
  const list: string[] = []
  const push = (u?: string | null) => {
    const trimmed = typeof u === 'string' ? u.trim() : ''
    if (trimmed && !list.includes(trimmed)) list.push(trimmed)
  }

  push(src)

  if (proxyOnFail && src && /^https?:\/\//i.test(src) && !src.includes('/proxy?')) {
    try {
      const targetHost = new URL(src).hostname.toLowerCase()
      const ownHost = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : ''
      if (targetHost && targetHost !== ownHost) {
        push(apiUrl(`/proxy?url=${encodeURIComponent(src)}`))
      }
    } catch {
      /* ignore invalid URL */
    }
  }

  push(fallbackSrc)
  return list
}

export type ImgProps = ImgHTMLAttributes<HTMLImageElement> & {
  fetchPriority?: string
  fallbackSrc?: string | null
  proxyOnFail?: boolean
  hideSkeleton?: boolean
  stallTimeoutMs?: number
}

/** <img> that shows a skeleton until loaded, fails over via /proxy and fallbackSrc when blocked/stalled, then fades in. */
export function Img({
  className,
  style,
  onLoad,
  onError,
  fetchPriority,
  fallbackSrc,
  proxyOnFail = true,
  hideSkeleton = false,
  stallTimeoutMs = 5500,
  src,
  srcSet,
  loading,
  ...p
}: ImgProps) {
  const candidates = useMemo(
    () => buildCandidateUrls(src, fallbackSrc, proxyOnFail),
    [src, fallbackSrc, proxyOnFail],
  )
  const candidatesKey = candidates.join('|')

  const [candIdx, setCandIdx] = useState(0)
  const [done, setDone] = useState(false)
  const [inView, setInView] = useState(loading !== 'lazy')
  const el = useRef<HTMLImageElement>(null)

  const activeSrc = candidates[candIdx] ?? ''
  const hasNextCandidate = candIdx < candidates.length - 1

  useEffect(() => {
    setCandIdx(0)
    setDone(false)
    setInView(loading !== 'lazy')
  }, [candidatesKey, loading])

  useEffect(() => {
    if (!activeSrc) {
      setDone(true)
      return
    }
    const imgEl = el.current
    if (imgEl?.complete) {
      if (imgEl.naturalWidth > 0) {
        setDone(true)
      } else if (hasNextCandidate) {
        setCandIdx((i) => (i < candidates.length - 1 ? i + 1 : i))
      } else {
        setDone(true)
      }
    } else {
      setDone(false)
    }
  }, [activeSrc, hasNextCandidate, candidates.length])

  useEffect(() => {
    if (!el.current) return
    if (fetchPriority) el.current.setAttribute('fetchpriority', fetchPriority)
    else el.current.removeAttribute('fetchpriority')
  }, [fetchPriority])

  useEffect(() => {
    if (loading !== 'lazy' || inView) return
    const node = el.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: '250px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [loading, inView, candidatesKey])

  // Recover from hung external hosts (e.g. ISP-blocked image.tmdb.org) by advancing to /proxy or fallbackSrc
  useEffect(() => {
    if (done || !inView || !hasNextCandidate || stallTimeoutMs <= 0) return
    const timer = window.setTimeout(() => {
      const imgEl = el.current
      if (imgEl?.complete && imgEl.naturalWidth > 0) {
        setDone(true)
        return
      }
      setCandIdx((i) => (i < candidates.length - 1 ? i + 1 : i))
    }, stallTimeoutMs)
    return () => window.clearTimeout(timer)
  }, [done, inView, hasNextCandidate, stallTimeoutMs, activeSrc, candidates.length])

  return (
    <>
      {!done && !hideSkeleton && <span aria-hidden className="skeleton absolute inset-0 rounded-[inherit]" />}
      <img
        ref={el}
        {...p}
        loading={loading}
        src={activeSrc || undefined}
        srcSet={candIdx === 0 ? srcSet : undefined}
        className={done ? `${className ?? ''} img-in` : className}
        style={done ? style : { ...style, opacity: 0 }}
        onLoad={(e) => {
          setDone(true)
          onLoad?.(e)
        }}
        onError={(e) => {
          if (hasNextCandidate) {
            setCandIdx((i) => (i < candidates.length - 1 ? i + 1 : i))
            return
          }
          setDone(true)
          onError?.(e)
        }}
      />
    </>
  )
}
