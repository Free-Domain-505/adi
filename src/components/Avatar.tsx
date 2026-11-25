import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { frameById, frameThumb, frameUrl } from '../lib/frames'
import { cn } from '../lib/utils'

function getAvatarGradient(name?: string) {
  const n = name?.trim() || '?'
  let h = 0
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360
  return `linear-gradient(135deg, hsl(${h} 75% 52%), hsl(${(h + 45) % 360} 70% 36%))`
}

/**
 * Round avatar with an optional animated frame.
 * The frame is an APNG rendered in a dedicated overlay container without CSS transforms on the <img>,
 * allowing modern browsers to decode and animate APNG frames at full framerate.
 * Includes graceful retry via /proxy, fallback to local WebP frames if APNG fails,
 * and deterministic CSS gradient + initial fallback only if loading truly fails.
 */
export function Avatar({
  size,
  src,
  frame,
  name,
  className,
}: {
  size: number
  src?: string | null
  frame?: string | null
  name?: string
  className?: string
  animateFrame?: boolean
}) {
  const f = frameById(frame)
  const imgRef = useRef<HTMLImageElement>(null)
  const prevSrcRef = useRef<string | null | undefined>(src)
  const [currentSrc, setCurrentSrc] = useState<string | null>(src || null)
  const [hasError, setHasError] = useState(!src)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [triedProxy, setTriedProxy] = useState(false)
  const [currentFrameUrl, setCurrentFrameUrl] = useState<string | null>(f ? frameUrl(f) : null)
  const [triedFrameFallback, setTriedFrameFallback] = useState(false)
  const [frameHidden, setFrameHidden] = useState(!f)

  useEffect(() => {
    if (prevSrcRef.current === src) return
    prevSrcRef.current = src
    setCurrentSrc(src || null)
    setHasError(!src)
    setImgLoaded(false)
    setTriedProxy(false)
  }, [src])

  useLayoutEffect(() => {
    const el = imgRef.current
    if (el && el.complete && el.naturalWidth > 0) {
      setImgLoaded(true)
    }
  }, [currentSrc])

  useEffect(() => {
    if (f) {
      setCurrentFrameUrl(frameUrl(f))
      setTriedFrameFallback(false)
      setFrameHidden(false)
    } else {
      setCurrentFrameUrl(null)
      setFrameHidden(true)
    }
  }, [frame, f])

  const handleImgError = () => {
    setImgLoaded(false)
    if (currentSrc && !triedProxy && (currentSrc.startsWith('http://') || currentSrc.startsWith('https://')) && !currentSrc.startsWith('/proxy')) {
      setTriedProxy(true)
      setCurrentSrc(`/proxy?url=${encodeURIComponent(currentSrc)}`)
    } else {
      setHasError(true)
    }
  }

  const handleFrameError = () => {
    if (f && !triedFrameFallback) {
      setTriedFrameFallback(true)
      setCurrentFrameUrl(frameThumb(f))
    } else {
      setFrameHidden(true)
    }
  }

  const initial = (name?.trim()[0] ?? '?').toUpperCase()
  const fallbackBg = getAvatarGradient(name)
  const showFallback = !imgLoaded || hasError || !currentSrc

  return (
    <span
      className={cn('relative inline-block shrink-0 align-middle select-none', className)}
      style={{ width: size, height: size }}
    >
      {/* Base Avatar Circle */}
      <span
        className="relative grid size-full place-items-center overflow-hidden rounded-full font-display font-bold text-white shadow-inner ring-1 ring-border"
        style={{
          fontSize: size * 0.42,
          background: showFallback ? fallbackBg : undefined,
        }}
      >
        {showFallback && (
          <span className="drop-shadow-sm">{initial}</span>
        )}
        {!hasError && currentSrc && (
          <img
            ref={imgRef}
            src={currentSrc}
            alt={name ? `${name}'s avatar` : 'Avatar'}
            referrerPolicy="no-referrer"
            draggable={false}
            onLoad={() => setImgLoaded(true)}
            onError={handleImgError}
            className="absolute inset-0 z-10 size-full object-cover"
          />
        )}
      </span>

      {/* Animated APNG / Fallback Avatar Decoration Frame */}
      {f && !frameHidden && currentFrameUrl && (
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 select-none"
          style={{ width: size * 1.28, height: size * 1.28 }}
        >
          <img
            key={currentFrameUrl}
            src={currentFrameUrl}
            alt=""
            aria-hidden
            draggable={false}
            onError={handleFrameError}
            decoding="sync"
            className="size-full object-contain pointer-events-none"
          />
        </span>
      )}
    </span>
  )
}
