import { useEffect, useState } from 'react';
import { fetchTmdbLogo } from '../lib/api';

interface TmdbLogoTitleProps {
  title: string;
  tmdbId?: number | null;
  initialLogo?: string | null;
  className?: string;
  imgClassName?: string;
}

export function TmdbLogoTitle({
  title,
  tmdbId,
  initialLogo,
  className = '',
  imgClassName = 'max-h-16 sm:max-h-20 md:max-h-24 max-w-[280px] sm:max-w-md md:max-w-lg object-contain object-left drop-shadow-2xl',
}: TmdbLogoTitleProps) {
  const [logo, setLogo] = useState<string | null>(initialLogo || null);
  const [fetched, setFetched] = useState(Boolean(initialLogo));
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    setImgLoaded(false);
    if (initialLogo) {
      setLogo(initialLogo);
      setFetched(true);
      return;
    }

    let cancelled = false;
    setLogo(null);
    setFetched(false);

    const numId = tmdbId && Number(tmdbId) > 0 ? Number(tmdbId) : undefined;
    fetchTmdbLogo(title, numId)
      .then((url) => {
        if (!cancelled) {
          setLogo(url || null);
          setFetched(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLogo(null);
          setFetched(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tmdbId, title, initialLogo]);

  if (logo) {
    return (
      <div className="relative flex min-h-12 items-center">
        {!imgLoaded && (
          <div className="skeleton-shimmer h-14 w-56 max-w-full rounded-lg sm:h-20 sm:w-72" />
        )}
        <img
          key={logo}
          src={logo}
          alt={title}
          referrerPolicy="no-referrer"
          loading="eager"
          onLoad={() => setImgLoaded(true)}
          onError={() => {
            setLogo(null);
            setImgLoaded(true);
          }}
          className={`${imgClassName} transition-opacity duration-300 ${
            imgLoaded ? 'opacity-100' : 'pointer-events-none absolute opacity-0'
          }`}
        />
      </div>
    );
  }

  if (!fetched) {
    return <div className="skeleton-shimmer h-14 w-56 max-w-full rounded-lg sm:h-20 sm:w-72" />;
  }

  // Fallback only if TMDB provides zero logo assets for this title
  return <span className={className}>{title}</span>;
}
