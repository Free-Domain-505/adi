import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Ban, LogOut, MessageCircle } from 'lucide-react';
import { signOutUser } from './lib/firebase';
import { OWNER_PHONE_INTL, isOwnerAdmin, useAuth, useBlockedState } from './lib/storage';
import { Navbar } from './components/Navbar';
import { SearchModal } from './components/SearchModal';
import { Footer } from './components/Footer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthPromptModal } from './components/AuthPromptModal';
import { SubscriptionModal } from './components/SubscriptionModal';
import {
  ExtraEpisodeCelebrationModal,
  FreeTierReminderPopup,
  VipCelebrationModal,
} from './components/VipAndReminderPopups';
import HomePage from './pages/HomePage';
import DonghuaHomePage from './pages/DonghuaHomePage';
import CatalogPage from './pages/CatalogPage';
import SchedulePage from './pages/SchedulePage';
import DetailsPage from './pages/DetailsPage';
import WatchPage from './pages/WatchPage';
import MangaHomePage from './pages/MangaHomePage';
import MangaDetailsPage from './pages/MangaDetailsPage';
import MangaReaderPage from './pages/MangaReaderPage';
import NovelHomePage from './pages/NovelHomePage';
import NovelDetailsPage from './pages/NovelDetailsPage';
import NovelReaderPage from './pages/NovelReaderPage';
import MoviesHomePage from './pages/MoviesHomePage';
import MovieDetailsPage from './pages/MovieDetailsPage';
import MovieWatchPage from './pages/MovieWatchPage';
import WebSeriesPage from './pages/WebSeriesPage';
import ListPage from './pages/ListPage';
import LoginPage from './pages/LoginPage';
import AdminPage from './pages/AdminPage';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

function AppShell() {
  const [searchOpen, setSearchOpen] = useState(false);
  const { user } = useAuth();
  const blockedState = useBlockedState();
  const isBlockedUser = Boolean(user && !isOwnerAdmin(user) && blockedState.blocked);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (isBlockedUser) {
    const waSupport = `https://wa.me/${OWNER_PHONE_INTL}?text=${encodeURIComponent(
      `Hello Aditya Rajput, my Anime by Adi 💀 account (${user?.email || ''}) was blocked after payment review. Please help check my payment.`
    )}`;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12 text-ink">
        <div className="w-full max-w-md rounded-2xl border border-rose-500/45 bg-surface p-7 text-center shadow-2xl">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-rose-500/40 bg-rose-500/15 text-rose-400">
            <Ban className="size-7" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-ink">
            Account Blocked
          </h1>
          <p className="mt-2 text-xs font-semibold text-rose-300 sm:text-sm">
            Fake or unverified payment submissions are not considered on Anime by Adi 💀
          </p>
          <div className="mt-4 rounded-xl border border-line bg-canvas/70 p-3.5 text-left text-xs leading-relaxed text-muted">
            <p className="font-semibold text-ink">Reason:</p>
            <p className="mt-1">{blockedState.reason}</p>
            {user?.email && (
              <p className="mt-2 font-mono text-[11px] text-muted">
                Blocked Account: <span className="text-ink">{user.email}</span>
              </p>
            )}
          </div>

          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
            <a
              href={waSupport}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition-transform hover:scale-[1.01]"
            >
              <MessageCircle className="size-4" />
              <span>Contact Owner on WhatsApp</span>
            </a>
            <button
              type="button"
              onClick={() => signOutUser()}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-canvas px-4 py-2.5 text-xs font-semibold text-ink hover:border-rose-400/50"
            >
              <LogOut className="size-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <ScrollToTop />
      <Navbar onOpenSearch={() => setSearchOpen(true)} />

      <div className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/home" element={<HomePage />} />

          {/* Anime & Donghua */}
          <Route path="/donghua" element={<DonghuaHomePage />} />
          <Route path="/donghua/browse" element={<CatalogPage donghuaOnly presetTitle="Browse Donghua" />} />
          <Route path="/browse" element={<CatalogPage />} />
          <Route path="/trending" element={<CatalogPage presetSort="TRENDING_DESC" presetTitle="Trending Anime" />} />
          <Route path="/popular" element={<CatalogPage presetSort="POPULARITY_DESC" presetTitle="All-Time Popular" />} />
          <Route path="/top" element={<CatalogPage presetSort="SCORE_DESC" presetTitle="Top Rated Anime" />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/anime/:id" element={<DetailsPage />} />
          <Route path="/watch/:id" element={<WatchPage />} />

          {/* Manga & Manhwa */}
          <Route path="/manga" element={<MangaHomePage kind="manga" />} />
          <Route path="/manga/browse" element={<MangaHomePage kind="manga" />} />
          <Route path="/manga/:id" element={<MangaDetailsPage />} />
          <Route path="/manga/:id/read/:chapterId" element={<MangaReaderPage />} />
          <Route path="/manhwa" element={<MangaHomePage kind="manhwa" />} />
          <Route path="/manhwa/browse" element={<MangaHomePage kind="manhwa" />} />
          <Route path="/manhwa/:id" element={<MangaDetailsPage />} />
          <Route path="/manhwa/:id/read/:chapterId" element={<MangaReaderPage />} />

          {/* Light Novels */}
          <Route path="/novel" element={<NovelHomePage />} />
          <Route path="/novel/find" element={<NovelHomePage />} />
          <Route path="/novel/:slug" element={<NovelDetailsPage />} />
          <Route path="/novel/:slug/read/:chapter" element={<NovelReaderPage />} />

          {/* Movies & Web Series */}
          <Route path="/movies" element={<MoviesHomePage />} />
          <Route path="/movies/browse" element={<MoviesHomePage browseMode />} />
          <Route path="/series" element={<WebSeriesPage />} />
          <Route path="/movies/:type/:id" element={<MovieDetailsPage />} />
          <Route path="/movies/watch/:type/:id" element={<MovieWatchPage />} />

          {/* Watchlist, History, Account & Admin */}
          <Route path="/list" element={<ListPage />} />
          <Route path="/account" element={<LoginPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth" element={<LoginPage />} />
          <Route path="/auth/login" element={<LoginPage />} />
          <Route path="/admin" element={<AdminPage />} />

          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </div>

      <Footer />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AuthPromptModal />
      <SubscriptionModal />
      <VipCelebrationModal />
      <ExtraEpisodeCelebrationModal />
      <FreeTierReminderPopup />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
