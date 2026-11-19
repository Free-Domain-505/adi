import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MediaRowProps {
  id?: string;
  eyebrow?: string;
  title: string;
  viewAll?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  cardWidthClass?: string;
  skeletonCount?: number;
  skeletonAspect?: 'portrait' | 'landscape';
  children: ReactNode;
}

export function MediaRow({
  id,
  eyebrow,
  title,
  viewAll,
  loading,
  error,
  onRetry,
  cardWidthClass = 'w-[148px] sm:w-[172px] md:w-[186px]',
  skeletonCount = 7,
  skeletonAspect = 'portrait',
  children,
}: MediaRowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollByDir = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <section id={id} className="mx-auto w-full max-w-7xl">
      <div className="mb-4 flex items-end justify-between gap-4 px-4 sm:px-6">
        <div>
          {eyebrow && (
            <p className="text-xs font-semibold text-teal">{eyebrow}</p>
          )}
          <h2 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
            {title}
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {viewAll && (
            <Link
              to={viewAll}
              className="mr-1 text-xs font-semibold text-accent whitespace-nowrap hover:underline underline-offset-4"
            >
              View All
            </Link>
          )}
          <button
            type="button"
            aria-label={`Scroll ${title} left`}
            onClick={() => scrollByDir(-1)}
            className="grid size-8 place-items-center rounded-lg border border-line bg-surface text-muted transition-colors hover:border-accent/50 hover:text-ink"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Scroll ${title} right`}
            onClick={() => scrollByDir(1)}
            className="grid size-8 place-items-center rounded-lg border border-line bg-surface text-muted transition-colors hover:border-accent/50 hover:text-ink"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="mx-4 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5 sm:mx-6">
          <p className="text-sm text-muted">{error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink whitespace-nowrap"
            >
              Retry
            </button>
          )}
        </div>
      ) : (
        <div
          ref={scrollerRef}
          className="no-scrollbar flex snap-x snap-proximity gap-3.5 overflow-x-auto px-4 pb-2 sm:gap-4 sm:px-6"
        >
          {loading
            ? Array.from({ length: skeletonCount }).map((_, idx) => (
                <div key={idx} className={`${cardWidthClass} shrink-0 animate-pulse space-y-2`}>
                  <div
                    className={`w-full rounded-xl bg-surface-2 ${
                      skeletonAspect === 'landscape' ? 'aspect-[16/9]' : 'aspect-[2/3]'
                    }`}
                  />
                  <div className="h-3.5 w-3/4 rounded bg-surface-2" />
                  <div className="h-3 w-1/2 rounded bg-surface-2" />
                </div>
              ))
            : children}
        </div>
      )}
    </section>
  );
}
