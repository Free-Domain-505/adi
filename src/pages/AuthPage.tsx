import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Lock, Mail, RefreshCw, ShieldAlert, User } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isSecretKeyProvided, isSupabaseConfigured, supabase } from '../lib/supabase'
import { apiUrl } from '../services/api'
import { fetchShowcase, shuffle } from '../services/showcase'
import { LOGO_URL } from '../lib/constants'
import { cn } from '../lib/utils'

import showcaseAnime from '../assets/images/showcase_anime_panel_1794666397529.jpg'
import showcaseMovies from '../assets/images/showcase_movies_panel_1794666398931.jpg'
import showcaseManga from '../assets/images/showcase_manga_panel_1794666398447.jpg'

interface BgSlide {
  src: string
  title: string
}

// Crisp, official 1280p landscape anime backdrops (100% HD, zero portrait blur)
const HD_ANIME_BACKDROPS: BgSlide[] = [
  { src: 'https://image.tmdb.org/t/p/w1280/84XPpjGvxNyExjSuLQe0GIO9NuV.jpg', title: 'Attack on Titan' },
  { src: 'https://image.tmdb.org/t/p/w1280/gmECkdDc794XA0ExKiQ2gq0bP48.jpg', title: 'Jujutsu Kaisen' },
  { src: 'https://image.tmdb.org/t/p/w1280/nTvM4mhqZlHIvUkIvd6vv79QOmp.jpg', title: 'Demon Slayer: Kimetsu no Yaiba' },
  { src: 'https://image.tmdb.org/t/p/w1280/4HodYYKEIsGOdinkGi2UMOPX96D.jpg', title: 'Solo Leveling' },
  { src: 'https://image.tmdb.org/t/p/w1280/7omj9O016yK7G0h6bE6d90U1f3c.jpg', title: 'Your Name' },
  { src: 'https://image.tmdb.org/t/p/w1280/bX5jB41e97o6x8zWb1P8j5RkQ3a.jpg', title: 'Spirited Away' },
  { src: 'https://image.tmdb.org/t/p/w1280/4fUvQW253zM6pB3jX4kU8o8Pq2v.jpg', title: 'One Piece' },
  { src: 'https://image.tmdb.org/t/p/w1280/qtfMr08m0IsRs3W07oqHsRZPKQZ.jpg', title: 'Chainsaw Man' },
  { src: showcaseAnime, title: 'AnimeStream' },
  { src: showcaseMovies, title: 'Cinema & Series' },
  { src: showcaseManga, title: 'Manga & Novels' },
]

export default function AuthPage() {
  const { signIn, signUp, resetPassword } = useAuth()
  const [tab, setTab] = useState<'signin' | 'signup'>('signin')
  const [forgotMode, setForgotMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkingHandle, setCheckingHandle] = useState(false)
  const [handleAvailable, setHandleAvailable] = useState<boolean | null>(null)
  const [slides, setSlides] = useState<BgSlide[]>(HD_ANIME_BACKDROPS)
  const [artIdx, setArtIdx] = useState(0)
  const [logoErr, setLogoErr] = useState(false)

  useEffect(() => {
    document.title = tab === 'signin' ? 'Sign In — AnimeStream' : 'Create Account — AnimeStream'
  }, [tab])

  // Live real-time check for username uniqueness in Supabase profiles
  useEffect(() => {
    if (tab !== 'signup') {
      setHandleAvailable(null)
      setCheckingHandle(false)
      return
    }
    const clean = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (clean.length < 3) {
      setHandleAvailable(null)
      setCheckingHandle(false)
      return
    }
    let alive = true
    setCheckingHandle(true)
    const t = window.setTimeout(async () => {
      try {
        try {
          const res = await fetch(apiUrl(`/api/auth/check-username?username=${encodeURIComponent(clean)}`))
          const payload = (await res.json().catch(() => null)) as { ok?: boolean; available?: boolean } | null
          if (alive && payload?.ok && typeof payload.available === 'boolean') {
            setCheckingHandle(false)
            setHandleAvailable(payload.available)
            return
          }
        } catch {
          // Fall back to direct Supabase query below
        }

        const [{ data, error: queryErr }, { data: syncData }] = await Promise.all([
          supabase.from('profiles').select('id').ilike('username', clean).limit(1),
          supabase.from('user_sync').select('user_id').ilike('username', clean).limit(1),
        ])
        if (!alive) return
        setCheckingHandle(false)
        if (queryErr && !syncData) {
          setHandleAvailable(null)
          return
        }
        const taken = (data && data.length > 0) || (syncData && syncData.length > 0)
        setHandleAvailable(!taken)
      } catch {
        if (alive) setCheckingHandle(false)
      }
    }, 280)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [username, tab])

  // Load additional verified HD landscape banners from live pool (never portrait covers)
  useEffect(() => {
    let alive = true
    void fetchShowcase()
      .then((pools) => {
        if (!alive) return
        const wideOnly = pools.anime
          .filter((item) => Boolean(item.wide && item.wide.startsWith('http')))
          .map((item) => ({ src: item.wide!, title: item.title }))

        if (wideOnly.length > 0) {
          const merged = shuffle([...HD_ANIME_BACKDROPS, ...wideOnly]).slice(0, 16)
          setSlides(merged)
        }
      })
      .catch(() => {
        // Keep pristine HD backdrops
      })
    return () => {
      alive = false
    }
  }, [])

  // Rotate background anime image cleanly every 10 seconds
  useEffect(() => {
    if (slides.length <= 1) return
    const id = window.setInterval(() => {
      setArtIdx((i) => (i + 1) % slides.length)
    }, 10_000)
    return () => window.clearInterval(id)
  }, [slides.length])

  // Silently preload the next slide so 10s crossfade stays instant
  useEffect(() => {
    if (slides.length <= 1) return
    const nextSlide = slides[(artIdx + 1) % slides.length]
    if (!nextSlide?.src) return
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    img.src = nextSlide.src
  }, [artIdx, slides])

  const switchTab = (next: 'signin' | 'signup') => {
    setTab(next)
    setForgotMode(false)
    setResetSent(false)
    setError(null)
  }

  const passwordsMismatch = tab === 'signup' && confirmPassword.length > 0 && password !== confirmPassword
  const passwordsMatch = tab === 'signup' && confirmPassword.length >= 6 && password === confirmPassword

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)

    if (!isSupabaseConfigured) {
      setError('Connect your Supabase project first by adding VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.')
      return
    }

    const cleanEmail = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.')
      return
    }

    if (forgotMode) {
      setBusy(true)
      try {
        const res = await resetPassword(cleanEmail)
        if (res.error) setError(res.error.message)
        else setResetSent(true)
      } finally {
        setBusy(false)
      }
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (tab === 'signup') {
      const cleanHandle = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
      if (cleanHandle.length < 3) {
        setError('Username must be at least 3 characters (letters, numbers, _ or -).')
        return
      }
      if (handleAvailable === false) {
        setError(`Username @${cleanHandle} is already taken. Please choose another username.`)
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
    }

    setBusy(true)
    try {
      if (tab === 'signin') {
        const res = await signIn(cleanEmail, password)
        if (res.error) setError(res.error.message)
      } else {
        const res = await signUp(cleanEmail, password, username)
        if (res.error) setError(res.error.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const cleanHandlePreview = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const currentSlide = slides[artIdx % slides.length] ?? HD_ANIME_BACKDROPS[0]
  const prevIdx = (artIdx - 1 + slides.length) % slides.length

  return (
    <main className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#07090e] px-4 py-8 text-white selection:bg-accent selection:text-accent-fg">
      {/* Full-bleed rotating anime backdrop (changes every 10s, no GPU scaling blur) */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden bg-[#07090e]">
        {slides.map((slide, i) => {
          const isActive = i === artIdx
          const isPrev = i === prevIdx
          if (!isActive && !isPrev && slides.length > 4) return null
          return (
            <img
              key={`${slide.src}-${i}`}
              src={slide.src}
              alt=""
              aria-hidden
              referrerPolicy="no-referrer"
              onError={() => {
                setSlides((curr) => {
                  if (curr.length <= 1) return curr
                  const filtered = curr.filter((_, idx) => idx !== i)
                  return filtered.length > 0 ? filtered : HD_ANIME_BACKDROPS
                })
              }}
              className={cn(
                'absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ease-in-out',
                isActive ? 'opacity-100 z-1' : 'opacity-0 z-0',
              )}
            />
          )
        })}
        {/* Crisp, clean dark contrast scrim without muddy radial blur */}
        <div className="absolute inset-0 z-2 bg-black/60" />
        <div className="absolute inset-0 z-2 bg-gradient-to-t from-black/85 via-black/35 to-black/60" />
      </div>

      {/* Crisp solid card with zero backdrop blur for 100% sharpness */}
      <section
        aria-label="Authentication"
        className="relative z-10 w-full max-w-[430px] rounded-3xl border border-white/12 bg-[#0c0f17]/95 p-6 shadow-2xl shadow-black/90 sm:p-8"
      >
        <div className="mb-5 flex items-center gap-3">
          {logoErr ? (
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent font-display text-lg font-black text-white">
              A
            </span>
          ) : (
            <img
              src={LOGO_URL}
              alt="AnimeStream"
              width={40}
              height={40}
              onError={() => setLogoErr(true)}
              className="size-10 shrink-0 rounded-xl object-contain"
            />
          )}
          <div className="min-w-0">
            <h1 className="font-display text-xl font-black tracking-tight text-white">AnimeStream</h1>
            <p className="text-xs text-white/65">
              {tab === 'signin' ? 'Sign in to continue watching' : 'Create your account in seconds'}
            </p>
          </div>
        </div>

        {isSecretKeyProvided ? (
          <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-amber-400/40 bg-amber-500/15 px-3.5 py-3 text-xs leading-relaxed text-amber-200">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
            <div>
              <p className="font-bold text-amber-100">Publishable Key Required</p>
              <p className="mt-0.5 text-amber-200/90">
                A secret key (<code className="font-mono text-[11px] text-amber-100">sb_secret_...</code>) was detected, which is not permitted in browser clients. Please copy your <b>Publishable key</b> (<code className="font-mono text-[11px] text-amber-100">sb_publishable_...</code> or <code className="font-mono text-[11px] text-amber-100">anon public</code>) from Supabase Dashboard ➔ <b>Settings ⚙️ ➔ API</b>.
              </p>
            </div>
          </div>
        ) : !isSupabaseConfigured ? (
          <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-amber-400/35 bg-amber-500/15 px-3.5 py-3 text-xs leading-relaxed text-amber-200">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
            <div>
              <p className="font-bold text-amber-100">Connect your Supabase project</p>
              <p className="mt-0.5 text-amber-200/85">
                Add <code className="font-mono text-[11px]">VITE_SUPABASE_URL</code> and{' '}
                <code className="font-mono text-[11px]">VITE_SUPABASE_ANON_KEY</code> to <code className="font-mono text-[11px]">.env</code>.
              </p>
            </div>
          </div>
        ) : null}

        {/* Mode Switcher */}
        <div
          role="tablist"
          aria-label="Authentication mode"
          className="mb-5 grid grid-cols-2 gap-1 rounded-2xl border border-white/12 bg-white/6 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'signin'}
            onClick={() => switchTab('signin')}
            className={cn(
              'h-10 rounded-xl text-sm font-bold transition',
              tab === 'signin' ? 'bg-accent text-accent-fg shadow-sm' : 'text-white/70 hover:text-white',
            )}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'signup'}
            onClick={() => switchTab('signup')}
            className={cn(
              'h-10 rounded-xl text-sm font-bold transition',
              tab === 'signup' ? 'bg-accent text-accent-fg shadow-sm' : 'text-white/70 hover:text-white',
            )}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
          {tab === 'signup' && (
            <div>
              <label htmlFor="gate-username" className="mb-1.5 flex items-center justify-between text-xs font-semibold text-white/75">
                <span>Username</span>
                {cleanHandlePreview.length >= 3 && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold">
                    {checkingHandle ? (
                      <span className="text-white/50">checking...</span>
                    ) : handleAvailable === true ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="size-3" /> @{cleanHandlePreview} available
                      </span>
                    ) : handleAvailable === false ? (
                      <span className="text-red-400">@{cleanHandlePreview} already taken</span>
                    ) : (
                      <span className="text-accent">@{cleanHandlePreview}</span>
                    )}
                  </span>
                )}
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/45" />
                <input
                  id="gate-username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. gojo_satoru"
                  autoComplete="username"
                  maxLength={24}
                  className={cn(
                    'h-11 w-full rounded-xl border bg-white/7 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/40 focus:bg-white/10 focus:ring-2',
                    handleAvailable === false
                      ? 'border-red-500/60 focus:border-red-400 focus:ring-red-500/20'
                      : handleAvailable === true
                        ? 'border-emerald-500/50 focus:border-emerald-400 focus:ring-emerald-500/20'
                        : 'border-white/14 focus:border-accent focus:ring-accent/25',
                  )}
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="gate-email" className="mb-1.5 block text-xs font-semibold text-white/75">
              Email address
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/45" />
              <input
                id="gate-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="h-11 w-full rounded-xl border border-white/14 bg-white/7 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/40 focus:border-accent focus:bg-white/10 focus:ring-2 focus:ring-accent/25"
              />
            </div>
          </div>

          {!forgotMode && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="gate-password" className="text-xs font-semibold text-white/75">
                Password
              </label>
              {tab === 'signin' && (
                <button
                  type="button"
                  onClick={() => {
                    setForgotMode(true)
                    setResetSent(false)
                    setError(null)
                  }}
                  className="text-[11px] font-semibold text-accent hover:underline"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/45" />
              <input
                id="gate-password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tab === 'signin' ? 'Your password' : 'Minimum 6 characters'}
                autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                className="h-11 w-full rounded-xl border border-white/14 bg-white/7 pl-10 pr-11 text-sm text-white outline-none transition placeholder:text-white/40 focus:border-accent focus:bg-white/10 focus:ring-2 focus:ring-accent/25"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-white/55 transition hover:bg-white/10 hover:text-white"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          )}

          {tab === 'signup' && !forgotMode && (
            <div>
              <label htmlFor="gate-confirm-password" className="mb-1.5 flex items-center justify-between text-xs font-semibold text-white/75">
                <span>Confirm password</span>
                {passwordsMismatch && (
                  <span className="text-[11px] font-semibold text-red-400">Passwords do not match</span>
                )}
                {passwordsMatch && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                    <CheckCircle2 className="size-3" /> Matched
                  </span>
                )}
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/45" />
                <input
                  id="gate-confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  className={cn(
                    'h-11 w-full rounded-xl border bg-white/7 pl-10 pr-11 text-sm text-white outline-none transition placeholder:text-white/40 focus:bg-white/10 focus:ring-2',
                    passwordsMismatch
                      ? 'border-red-500/60 focus:border-red-400 focus:ring-red-500/20'
                      : 'border-white/14 focus:border-accent focus:ring-accent/25',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                  className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-white/55 transition hover:bg-white/10 hover:text-white"
                >
                  {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
          )}

          {resetSent && (
            <div role="status" className="flex items-start gap-2.5 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3.5 py-2.5 text-xs font-medium text-emerald-300">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>Reset link sent to <b>{email.trim()}</b>. Check your inbox or spam folder and open the link to set a new password.</span>
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/35 bg-red-500/15 px-3.5 py-2.5 text-xs font-medium text-red-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : forgotMode ? (
              <>
                <span>Send password reset link</span>
                <ArrowRight className="size-4" />
              </>
            ) : (
              <>
                <span>{tab === 'signin' ? 'Sign in to AnimeStream' : 'Create account & enter'}</span>
                <ArrowRight className="size-4" />
              </>
            )}
          </button>

          {forgotMode && (
            <button
              type="button"
              onClick={() => {
                setForgotMode(false)
                setResetSent(false)
                setError(null)
              }}
              className="w-full text-center text-xs font-semibold text-white/70 underline underline-offset-4 hover:text-white"
            >
              Back to Sign in
            </button>
          )}
        </form>

        <div className="mt-5 border-t border-white/10 pt-4 text-center text-xs text-white/65">
          {tab === 'signin' ? (
            <>
              New to AnimeStream?{' '}
              <button
                type="button"
                onClick={() => switchTab('signup')}
                className="font-bold text-white underline underline-offset-4 hover:text-accent"
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchTab('signin')}
                className="font-bold text-white underline underline-offset-4 hover:text-accent"
              >
                Sign in instead
              </button>
            </>
          )}
        </div>
      </section>

      {/* Subtle anime title watermark credit */}
      <p className="pointer-events-none fixed bottom-4 left-5 z-10 hidden text-xs font-medium tracking-wide text-white/60 sm:block">
        Featured · {currentSlide.title}
      </p>
    </main>
  )
}
