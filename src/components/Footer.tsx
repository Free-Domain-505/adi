import { Link } from 'react-router-dom';
import { Lock, Moon, ShieldCheck, Sun } from 'lucide-react';
import { isOwnerAdmin, toggleTheme, useAuth, useTheme } from '../lib/storage';
import { EyeAvatar } from './EyeAvatar';

export function Footer() {
  const theme = useTheme();
  const { user } = useAuth();
  const showAdmin = isOwnerAdmin(user);

  return (
    <footer className="mt-16 border-t border-line bg-surface/40 pb-24 pt-12 md:pb-12">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Link to="/home" className="inline-flex items-center gap-2.5">
            <EyeAvatar size="md" />
            <span className="font-display text-xl font-extrabold tracking-tight text-ink">
              Anime by Adi 💀
            </span>
          </Link>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Stream trending anime, donghua, and cinema in Hindi &amp; English, or dive into manga, manhwa, and light novels — built for binge nights.
          </p>
          <button
            type="button"
            onClick={toggleTheme}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink transition-colors hover:border-accent/50"
          >
            {theme === 'dark' ? <Sun className="size-3.5 text-accent" /> : <Moon className="size-3.5 text-accent" />}
            <span>{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-4">
          <div>
            <h3 className="text-xs font-semibold tracking-wider text-muted">Watch</h3>
            <ul className="mt-3 space-y-2.5 text-muted">
              <li><Link to="/home" className="hover:text-accent transition-colors">Anime Home</Link></li>
              <li><Link to="/donghua" className="hover:text-accent transition-colors">Donghua Hub</Link></li>
              <li><Link to="/movies" className="hover:text-accent transition-colors">Movies</Link></li>
              <li><Link to="/series" className="hover:text-accent transition-colors">Web Series</Link></li>
              <li><Link to="/schedule" className="hover:text-accent transition-colors">Airing Schedule</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold tracking-wider text-muted">Read &amp; Account</h3>
            <ul className="mt-3 space-y-2.5 text-muted">
              <li><Link to="/manga" className="hover:text-accent transition-colors">Manga</Link></li>
              <li><Link to="/manhwa" className="hover:text-accent transition-colors">Manhwa</Link></li>
              <li><Link to="/novel" className="hover:text-accent transition-colors">Light Novels</Link></li>
              <li><Link to="/list" className="hover:text-accent transition-colors">My Watchlist</Link></li>
              <li><Link to="/account" className="hover:text-accent transition-colors">My Account / Login</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold tracking-wider text-muted">Sources</h3>
            <ul className="mt-3 space-y-2.5 text-muted">
              <li><a href="https://anilist.co" target="_blank" rel="noreferrer noopener" className="hover:text-accent transition-colors">AniList GraphQL</a></li>
              <li><a href="https://mangadex.org" target="_blank" rel="noreferrer noopener" className="hover:text-accent transition-colors">MangaDex</a></li>
              <li><a href="https://novelfire.net" target="_blank" rel="noreferrer noopener" className="hover:text-accent transition-colors">NovelFire</a></li>
              <li><a href="https://kitsu.io" target="_blank" rel="noreferrer noopener" className="hover:text-accent transition-colors">Kitsu</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold tracking-wider text-muted">Admin</h3>
            <ul className="mt-3 space-y-2.5 text-muted">
              <li>
                {showAdmin ? (
                  <Link
                    to="/admin"
                    className="inline-flex items-center gap-1.5 font-semibold text-amber-300 transition-colors hover:text-amber-200"
                  >
                    <ShieldCheck className="size-3.5" />
                    <span>Owner Panel</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    title="Admin is locked for owner login only"
                    className="inline-flex cursor-not-allowed select-none items-center gap-1.5 text-muted/45"
                  >
                    <Lock className="size-3.5" />
                    <span>Admin Locked</span>
                  </button>
                )}
              </li>
              <li className="text-xs text-muted/70">Owner Only</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-7xl space-y-2 border-t border-line px-4 pt-6 text-xs text-muted sm:px-6">
        <p>© {new Date().getFullYear()} Anime by Adi 💀. All metadata and streams are indexed dynamically from public third-party APIs.</p>
        <p className="font-medium text-ink">
          This website was created by Aditya Rajput. All rights are reserved by him. For any questions or inquiries, please contact the owner, Aditya Rajput.
        </p>
      </div>
    </footer>
  );
}
