import { useEffect, useState } from 'react';
import { Film } from 'lucide-react';

interface MediaImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackTitle?: string;
  loading?: 'lazy' | 'eager';
}

export function MediaImage({
  src,
  alt,
  className = '',
  fallbackTitle,
  loading = 'lazy',
}: MediaImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-surface-2 via-surface to-canvas p-4 text-center ${className}`}
      >
        <Film className="mb-2 size-7 text-muted/50" />
        {fallbackTitle && (
          <span className="line-clamp-2 text-xs font-medium text-muted">
            {fallbackTitle}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {!loaded && (
        <div
          aria-hidden="true"
          className="skeleton-shimmer pointer-events-none absolute inset-0 z-10"
        />
      )}
      <img
        key={src}
        src={src}
        alt={alt}
        loading={loading}
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`${className} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}
