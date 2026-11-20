import { TmdbLogoTitle } from './TmdbLogoTitle';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Check, ChevronLeft, ChevronRight, Info, Play, Tv } from 'lucide-react';
import type { AnimeMedia } from '../types';
import { formatSeasonLabel, pickTitle, stripHtml } from '../lib/api';
import { removeFromWatchlist, upsertWatchlist, useWatchlist } from '../lib/storage';
import { MediaImage } from './MediaImage';

interface HeroCarouselProps {
  items: AnimeMedia[];
  loading?: boolean;
  onPlayTrailer?: (media: AnimeMedia) => void;
}

export function HeroCarousel({ items, loading, onPlayTrailer }: HeroCarouselProps) {
  const slides = items.slice(0, 10);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const watchlist = useWatchlist();

  useEffect(() => {
    if (slides.length < 2 || paused) return;
    const timer = window.setTimeout(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, 7500);
    return () => window.clearTimeout(timer);
  }, [index, slides.length, paused]);

  if (loading) {
    return (
      <section className="relative h-[68svh] min-h-[460px] max-h-[640px] w-full overflow-hidden bg-surface">
        <div className="skeleton-shimmer absolute inset-0" />
        <div className="relative mx-auto flex h-full max-w-7xl flex-col justify-end px-4 pb-8 sm:px-6">
          <div className="skeleton-shimmer h-4 w-44 rounded" />
          <div className="skeleton-shimmer mt-4 h-16 w-72 max-w-full rounded-xl" />
          <div className="skeleton-shimmer mt-3 h-3.5 w-52 rounded" />
          <div className="mt-3 space-y-2">
            <div className="skeleton-shimmer h-4 w-[30rem] max-w-full rounded" />
            <div className="skeleton-shimmer h-4 w-80 max-w-full rounded" />
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <div className="skeleton-shimmer h-11 w-36 rounded-lg" />
            <div className="skeleton-shimmer h-11 w-28 rounded-lg" />
            <div className="skeleton-shimmer h-11 w-32 rounded-lg" />
          </div>
        </div>
      </section>
    );
  }

  if (slides.length === 0) return null;

  const current = slides[index % slides.length];
  const title = pickTitle(current.title);
  const backdrop =
    current.bannerImage ||
    current.coverImage?.extraLarge ||
    '/src/assets/images/aadhi_cinema_backdrop_1795006602984.jpg';
  const synopsis = stripHtml(current.description);
  const key = `anime:${current.id}`;
  const saved = watchlist.some((w) => w.key === key);

  const metaParts = [
    current.format ? current.format.replace(/_/g, ' ') : null,
    formatSeasonLabel(current.season, current.seasonYear) || null,
    current.averageScore ? `${(current.averageScore / 10).toFixed(1)} ★` : null,
    current.episodes ? `${current.episodes} Eps` : null,
  ].filter(Boolean);

  const handleToggleList = () => {
    if (saved) {
      removeFromWatchlist(key);
    } else {
      upsertWatchlist({
        key,
        kind: current.countryOfOrigin === 'CN' ? 'donghua' : 'anime',
        id: String(current.id),
        title,
        image: current.coverImage?.extraLarge || current.coverImage?.large || '',
        href: `/anime/${current.id}`,
        status: 'planning',
        total: current.episodes || null,
        score: current.averageScore ? current.averageScore / 10 : null,
      });
    }
  };

  return (
    <section
      aria-label="Featured Spotlight"
      className="relative h-[68svh] min-h-[470px] max-h-[650px] w-full overflow-hidden bg-canvas"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <div key={`${current.id}-${backdrop}`} className="animate-kenburns absolute inset-0">
        <MediaImage
          key={backdrop}
          src={backdrop}
          alt={title}
          loading="eager"
          className="h-full w-full object-cover object-[center_24%]"
        />
      </div>

      {/* Measured contrast scrims */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/60 to-canvas/20" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-canvas/95 via-canvas/55 to-transparent" />

      <div className="relative mx-auto flex h-full max-w-7xl flex-col justify-end px-4 pb-0 pt-24 sm:px-6">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-teal tabular-nums">
            <span>Now Streaming · #{(index % slides.length) + 1}</span>
            {metaParts.map((part) => (
              <span key={part} className="flex items-center gap-2 text-muted">
                <span aria-hidden="true">·</span>
                <span>{part}</span>
              </span>
            ))}
          </div>

          <div className="mt-3">
            <TmdbLogoTitle
              title={title}
              tmdbId={current.tmdbId}
              initialLogo={current.logo}
              className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-5xl"
              imgClassName="max-h-20 sm:max-h-24 md:max-h-28 max-w-[280px] sm:max-w-md md:max-w-xl object-contain object-left drop-shadow-2xl"
            />
          </div>

          {current.genres && current.genres.length > 0 && (
            <p className="mt-2 text-xs font-medium text-accent">
              {current.genres.slice(0, 4).join(' · ')}
            </p>
          )}

          {synopsis && (
            <p className="mt-3 line-clamp-2 max-w-xl text-sm leading-relaxed text-muted sm:line-clamp-3 sm:text-[15px]">
              {synopsis}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              to={`/watch/${current.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink whitespace-nowrap shrink-0 transition-transform duration-150 hover:opacity-95 active:scale-[0.98]"
            >
              <Play className="size-4 fill-current" />
              <span>Stream Now</span>
            </Link>

            <Link
              to={`/anime/${current.id}`}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface/85 px-4 py-2.5 text-sm font-semibold text-ink whitespace-nowrap shrink-0 backdrop-blur-sm transition-colors duration-150 hover:border-accent/50"
            >
              <Info className="size-4 text-muted" />
              <span>Details</span>
            </Link>

            <button
              type="button"
              onClick={handleToggleList}
              aria-label={saved ? 'Remove from My List' : 'Add to My List'}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 ${
                saved
                  ? 'border-teal/50 bg-teal/15 text-teal'
                  : 'border-line bg-surface/80 text-ink hover:border-accent/40'
              }`}
            >
              {saved ? <Check className="size-4" /> : <Bookmark className="size-4" />}
              <span>{saved ? 'In My List' : 'Add to List'}</span>
            </button>

            {current.trailer?.site === 'youtube' && onPlayTrailer && (
              <button
                type="button"
                onClick={() => onPlayTrailer(current)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface/75 px-3.5 py-2.5 text-sm font-medium text-muted whitespace-nowrap shrink-0 transition-colors hover:text-ink"
              >
                <Tv className="size-4" />
                <span>Trailer</span>
              </button>
            )}
          </div>
        </div>

        {/* Slide Controls */}
        {slides.length > 1 && (
          <div className="mt-7 flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`Slide ${i + 1}`}
                  onClick={() => setIndex(i)}
                  className={`h-1.5 rounded-full transition-all duration-200 ${
                    i === index % slides.length ? 'w-7 bg-accent' : 'w-2 bg-ink/25 hover:bg-ink/45'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous spotlight"
                onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
                className="grid size-9 place-items-center rounded-lg border border-line bg-surface/80 text-ink transition-colors hover:border-accent/50 hover:text-accent"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Next spotlight"
                onClick={() => setIndex((i) => (i + 1) % slides.length)}
                className="grid size-9 place-items-center rounded-lg border border-line bg-surface/80 text-ink transition-colors hover:border-accent/50 hover:text-accent"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
