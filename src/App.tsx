import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AniListDownBanner } from './components/AniListDownBanner'
import { Footer } from './components/Footer'
import { MobileDock } from './components/MobileDock'
import { MobileHeader } from './components/MobileHeader'
import { Navbar } from './components/Navbar'
import { NavDrawer } from './components/NavDrawer'
import { ScrollProgress } from './components/ScrollProgress'
import { ScrollToTop } from './components/ScrollToTop'
import { TopLoader } from './components/TopLoader'
import { PageLoader } from './components/PageLoader'
import { ShieldGate } from './components/ShieldGate'
import { WelcomeNotes } from './components/WelcomeNotes'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { Toaster } from './components/Toaster'
import { MovieSearchModal } from './components/MovieSearchModal'
import { SearchModal } from './components/SearchModal'
import { ChangelogModal } from './components/ChangelogModal'
import { ChooseUsernameModal } from './components/ChooseUsernameModal'
import { useTrackHistory } from './lib/backToDetails'
import { initAniListSync } from './lib/anilist'
import { useApplyTvMode } from './lib/keys'
import { useSpatialNav } from './lib/spatial'
import { isDetailsPath, isReaderPath, isWatchPath, sectionOf } from './lib/sections'
import { useAuth } from './context/AuthContext'
import { useProfile } from './lib/profile'
import { checkDailySync } from './lib/sync'

import { toast } from './lib/toast'
import { cn } from './lib/utils'

// Split out lazy pages
const AuthPage = lazy(() => import('./pages/AuthPage'))
const LandingPage = lazy(() => import('./pages/LandingPage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const DonghuaHomePage = lazy(() => import('./pages/DonghuaHomePage'))
const DetailsPage = lazy(() => import('./pages/DetailsPage'))
const CatalogPage = lazy(() => import('./pages/CatalogPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const WatchPage = lazy(() => import('./pages/WatchPage'))
const ListPage = lazy(() => import('./pages/ListPage'))
const NovelHomePage = lazy(() => import('./pages/NovelHomePage'))
const NovelDetailsPage = lazy(() => import('./pages/NovelDetailsPage'))
const NovelReaderPage = lazy(() => import('./pages/NovelReaderPage'))
const NovelFindPage = lazy(() => import('./pages/NovelFindPage'))
const MangaHomePage = lazy(() => import('./pages/MangaHomePage'))
const MangaBrowsePage = lazy(() => import('./pages/MangaBrowsePage'))
const MangaDetailsPage = lazy(() => import('./pages/MangaDetailsPage'))
const MangaReaderPage = lazy(() => import('./pages/MangaReaderPage'))
const ManhwaHomePage = lazy(() => import('./pages/ManhwaHomePage'))
const ManhwaBrowsePage = lazy(() => import('./pages/ManhwaBrowsePage'))
const ManhwaDetailsPage = lazy(() => import('./pages/ManhwaDetailsPage'))
const ManhwaReaderPage = lazy(() => import('./pages/ManhwaReaderPage'))
const ManhwaFindPage = lazy(() => import('./pages/ManhwaFindPage'))
const MoviesHomePage = lazy(() => import('./pages/MoviesHomePage'))
const MoviesBrowsePage = lazy(() => import('./pages/MoviesBrowsePage'))
const MovieDetailsPage = lazy(() => import('./pages/MovieDetailsPage'))
const MovieWatchPage = lazy(() => import('./pages/MovieWatchPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const NameStylePage = lazy(() => import('./pages/NameStylePage'))
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage'))
const MessagesPage = lazy(() => import('./pages/MessagesPage'))
const CommunityPage = lazy(() => import('./pages/CommunityPage'))
const WatchPartyPage = lazy(() => import('./pages/WatchPartyPage'))
const FindPage = lazy(() => import('./pages/FindPage'))
const BustedPage = lazy(() => import('./pages/BustedPage'))
const EmbedPage = lazy(() => import('./pages/EmbedPage'))
const CallPage = lazy(() => import('./pages/CallPage'))
const SupportPage = lazy(() => import('./pages/SupportPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

export default function App() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // Navigation drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)

  const reader = isReaderPath(pathname) // Novel / manga readers are full-screen
  const isEmbed = pathname === '/embed' || pathname.startsWith('/embed/')
  const isMessages = pathname.startsWith('/messages')
  const inChat = /^\/messages\/[^/]+$/.test(pathname)
  const isCall = pathname === '/call'
  const isCommunity = pathname === '/community'
  const isAuth = pathname === '/auth' || pathname.startsWith('/auth/') || pathname === '/login'
  const gate = pathname === '/' // opening picker: full-screen, no sidebar / header / dock
  const bare = gate || pathname === '/busted' || isEmbed || reader || isWatchPath(pathname) || isCall || isMessages || isAuth
  const section = sectionOf(pathname)

  const isHeroPage = pathname === '/home' || pathname === '/donghua' || pathname === '/movies'
  const showNav = !bare && !isDetailsPath(pathname)

  useTrackHistory()
  useApplyTvMode()
  useSpatialNav()
  useEffect(() => initAniListSync(), [])
  const { user, loading: authLoading, profileHydrated, recoveryMode, updatePassword, clearRecovery } = useAuth()
  const me = useProfile()
  const [newPass, setNewPass] = useState('')
  const [savingPass, setSavingPass] = useState(false)



  // Land on the Mood screen ('/') whenever a user signs in or registers
  const wasLoggedOutRef = useRef(false)
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      wasLoggedOutRef.current = true
      return
    }
    if (wasLoggedOutRef.current) {
      wasLoggedOutRef.current = false
      if (pathname !== '/' && pathname !== '/auth/anilist') {
        navigate('/', { replace: true })
      }
    }
  }, [authLoading, user, pathname, navigate])

  const needsProfileSetup = Boolean(user && profileHydrated && (!me.avatar || !me.banner))
  const isContentRoute = /^\/(home|donghua|trending|popular|top|browse|list|schedule|anime|mal|watch|movies|manga|manhwa|novel)(?:\/|$)/.test(pathname)
  const lastSetupToastRef = useRef(0)

  useEffect(() => {
    if (needsProfileSetup && isContentRoute) {
      const now = Date.now()
      if (now - lastSetupToastRef.current > 2500) {
        lastSetupToastRef.current = now
        toast('Please choose your Profile PFP and Banner first!', 'info')
      }
    }
  }, [needsProfileSetup, isContentRoute, pathname])

  useEffect(() => {
    if (user?.id) void checkDailySync(user.id)
  }, [user?.id])

  useEffect(() => {
    document.documentElement.dataset.section = section ?? 'hub'
  }, [section])

  if (authLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background text-foreground">
        <PageLoader />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen w-full max-w-full flex-col overflow-x-clip bg-background text-foreground">
        <ScrollToTop />
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/u/:username" element={<PublicProfilePage />} />
              <Route path="/user/:username" element={<PublicProfilePage />} />
              <Route path="*" element={<Navigate to="/auth" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
        <Toaster />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full max-w-full flex-col overflow-x-clip bg-background text-foreground">
      <TopLoader />
      {!bare && <ScrollProgress key={pathname} />}
      <ScrollToTop />
      {!bare && <AniListDownBanner />}

      {/* Desktop Top Navigation Bar */}
      {showNav && (
        <Navbar onOpenDrawer={() => setDrawerOpen(true)} />
      )}

      {/* Mobile Top Header */}
      {showNav && (
        <MobileHeader onOpenDrawer={() => setDrawerOpen(true)} />
      )}

      {/* Navigation Drawer (shared on mobile & desktop menu button) */}
      <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* Main Content Area with responsive header offsets */}
      <div
        className={cn(
          'flex flex-1 flex-col w-full min-w-0 max-w-full overflow-x-clip [&>*]:w-full [&>*]:min-w-0',
          showNav ? (isHeroPage ? 'pt-0' : 'pt-14 md:pt-16') : 'pt-0',
        )}
      >
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<PageLoader />}>
            {needsProfileSetup && isContentRoute ? (
              <Navigate to="/profile?setup=1" replace />
            ) : (
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/donghua" element={<DonghuaHomePage />} />
              <Route path="/donghua/browse" element={<CatalogPage preset="donghua" />} />
              <Route path="/trending" element={<CatalogPage preset="trending" />} />
              <Route path="/popular" element={<CatalogPage preset="popular" />} />
              <Route path="/top" element={<CatalogPage preset="top" />} />
              <Route path="/browse" element={<CatalogPage preset="browse" />} />
              <Route path="/list" element={<ListPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/profile/name-style" element={<NameStylePage />} />
              <Route path="/profile/name-colours" element={<NameStylePage />} />
              <Route path="/u/:username" element={<PublicProfilePage />} />
              <Route path="/user/:username" element={<PublicProfilePage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/messages/:partnerHandle" element={<MessagesPage />} />
              <Route path="/call" element={<CallPage />} />
              <Route path="/community" element={<CommunityPage />} />
              <Route path="/watchparty" element={<WatchPartyPage />} />
              <Route path="/watchtogether" element={<WatchPartyPage />} />
              <Route path="/auth" element={<Navigate to="/" replace />} />
              <Route path="/auth/anilist" element={<Navigate to="/profile" replace />} />
              <Route path="/auth/callback" element={<Navigate to="/" replace />} />
              <Route path="/auth/login" element={<Navigate to="/" replace />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              {/* Novels */}
              <Route path="/novel" element={<NovelHomePage />} />
              <Route path="/novel/find" element={<NovelFindPage />} />
              <Route path="/manga/find" element={<FindPage />} />
              <Route path="/novel/:source/:slug" element={<NovelDetailsPage />} />
              <Route path="/novel/:source/:slug/read/:chapter" element={<NovelReaderPage />} />
              {/* Manga */}
              <Route path="/manga" element={<MangaHomePage />} />
              <Route path="/manga/browse" element={<MangaBrowsePage mode="manga" />} />
              <Route path="/manga/:id" element={<MangaDetailsPage />} />
              <Route path="/manga/:id/read/:chapterId" element={<MangaReaderPage />} />
              {/* Manhwa */}
              <Route path="/manhwa" element={<ManhwaHomePage />} />
              <Route path="/manhwa/find" element={<ManhwaFindPage />} />
              <Route path="/manhwa/browse" element={<ManhwaBrowsePage />} />
              <Route path="/manhwa/:id" element={<ManhwaDetailsPage />} />
              <Route path="/manhwa/:id/read/:chapterId" element={<ManhwaReaderPage />} />
              {/* Movies & TV */}
              <Route path="/movies" element={<MoviesHomePage />} />
              <Route path="/movies/browse" element={<MoviesBrowsePage />} />
              <Route path="/movies/watch/:type/:id" element={<MovieWatchPage />} />
              <Route path="/movies/:type/:id" element={<MovieDetailsPage />} />
              <Route path="/watch/:id" element={<WatchPage />} />
              <Route path="/anime/:id" element={<DetailsPage />} />
              <Route path="/mal/:id" element={<DetailsPage />} />
              <Route path="/embed" element={<EmbedPage />} />
              <Route path="/embed/:id" element={<EmbedPage />} />
              <Route path="/embed/:id/:ep" element={<EmbedPage />} />
              <Route path="/support" element={<SupportPage />} />
              <Route path="/busted" element={<BustedPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
            )}
          </Suspense>
        </ErrorBoundary>

        {!bare && !isMessages && !isCommunity && <Footer />}
      </div>

      {!bare && !inChat && !isCommunity && <MobileDock onOpenDrawer={() => setDrawerOpen(true)} />}
      {!bare && section === 'movies' ? <MovieSearchModal /> : <SearchModal />}
      <Toaster />
      <ShortcutsHelp />
      <ShieldGate />
      <ChangelogModal />
      <ChooseUsernameModal />
      <WelcomeNotes enabled={!isEmbed && !reader && !isWatchPath(pathname) && !isCall && !isMessages && pathname !== '/busted'} />
      {recoveryMode && (
        <div className="fixed inset-0 z-[160] grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (savingPass) return
              setSavingPass(true)
              const { error } = await updatePassword(newPass)
              setSavingPass(false)
              if (!error) setNewPass('')
            }}
            className="w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card p-6 shadow-2xl"
          >
            <div>
              <h2 className="font-display text-xl font-bold text-foreground">Set New Password</h2>
              <p className="mt-1 text-xs text-muted">Enter a new password (min 6 characters) for your AnimeStream account.</p>
            </div>
            <input
              type="password"
              required
              minLength={6}
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="New password"
              className="h-11 w-full rounded-xl border border-border bg-card-2 px-4 text-sm text-foreground outline-none focus:border-accent"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={clearRecovery}
                className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingPass || newPass.length < 6}
                className="rounded-xl bg-accent px-5 py-2 text-xs font-bold text-accent-fg disabled:opacity-50"
              >
                {savingPass ? 'Saving…' : 'Save Password'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
