import { Link } from 'react-router-dom';
import { MediaImage } from './MediaImage';

export interface MediaCardProps {
  href: string;
  title: string;
  image?: string | null;
  meta?: string;
  kicker?: string;
  rank?: number;
  aspect?: 'portrait' | 'landscape';
}

export function MediaCardSkeleton({ aspect = 'portrait' }: { aspect?: 'portrait' | 'landscape' }) {
  return (
    <div className="flex flex-col space-y-2.5">
      <div
        className={`skeleton-shimmer w-full rounded-xl border border-line ${
          aspect === 'landscape' ? 'aspect-[16/9]' : 'aspect-[2/3]'
        }`}
      />
      <div className="space-y-1.5 px-0.5">
        <div className="skeleton-shimmer h-3 w-1/3 rounded" />
        <div className="skeleton-shimmer h-4 w-4/5 rounded" />
        <div className="skeleton-shimmer h-3 w-1/2 rounded" />
      </div>
    </div>
  );
}

export function MediaCard({
  href,
  title,
  image,
  meta,
  kicker,
  rank,
  aspect = 'portrait',
}: MediaCardProps) {
  return (
    <Link
      to={href}
      className="touch-highlight clickable-card group flex flex-col rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div
        className={`relative w-full overflow-hidden rounded-xl border border-line bg-surface transition-transform duration-200 group-hover:-translate-y-0.5 ${
          aspect === 'landscape' ? 'aspect-[16/9]' : 'aspect-[2/3]'
        }`}
      >
        <MediaImage
          src={image}
          alt={title}
          fallbackTitle={title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent opacity-80" />

        {typeof rank === 'number' && (
          <div className="pointer-events-none absolute bottom-2 left-2.5 font-mono text-2xl font-extrabold tracking-tighter text-accent drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] tabular-nums">
            {String(rank).padStart(2, '0')}
          </div>
        )}
      </div>

      <div className="mt-2.5 space-y-0.5 px-0.5">
        {kicker && (
          <p className="line-clamp-1 font-mono text-[11px] font-medium text-teal tabular-nums">
            {kicker}
          </p>
        )}
        <h3 className="line-clamp-1 text-sm font-semibold text-ink transition-colors group-hover:text-accent">
          {title}
        </h3>
        {meta && (
          <p className="line-clamp-1 text-xs text-muted tabular-nums">
            {meta}
          </p>
        )}
      </div>
    </Link>
  );
}
