import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUp, CheckCircle2, Compass } from 'lucide-react'
import { cn } from '../lib/utils'

export interface FeedEndProps {
  /** Destination route for the Browse All button */
  browseTo?: string
  /** Optional custom label for the Browse All button */
  browseLabel?: string
  /** Optional click handler (used instead of or alongside Link) */
  onBrowse?: () => void
  /** Total loaded item count if applicable */
  count?: number
  /** Plural noun for count, e.g. "titles", "movies", "series" */
  itemLabel?: string
  /** Custom primary heading */
  title?: string
  /** Custom supporting description */
  subtitle?: string
  className?: string
}

export function FeedEnd({
  browseTo = '/browse',
  browseLabel = 'Browse All',
  onBrowse,
  count,
  itemLabel = 'titles',
  title = 'No more results',
  subtitle,
  className,
}: FeedEndProps) {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const resolvedSubtitle =
    subtitle ??
    (typeof count === 'number' && count > 0
      ? `Showing all ${count.toLocaleString()} ${itemLabel}. Jump back to the top or explore other categories.`
      : 'Jump back to the top or explore other categories with filters and genres.')

  return (
    <section
      aria-label="End of feed"
      className={cn('mx-auto mt-10 max-w-4xl px-4 sm:px-6', className)}
    >
      <div className="relative px-6 py-7 text-center sm:px-10 sm:py-8">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-muted">
          <CheckCircle2 className="size-3.5 text-accent" />
          <span>No More Results</span>
        </div>

        <h2 className="mt-3 font-display text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h2>

        <p className="mx-auto mt-1.5 max-w-xl text-sm text-muted">
          {resolvedSubtitle}
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {browseTo ? (
            <Link
              to={browseTo}
              onClick={onBrowse}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-6 text-sm font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-95"
            >
              <Compass className="size-4" />
              <span>{browseLabel}</span>
              <ArrowRight className="size-4" />
            </Link>
          ) : onBrowse ? (
            <button
              type="button"
              onClick={onBrowse}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-6 text-sm font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-95"
            >
              <Compass className="size-4" />
              <span>{browseLabel}</span>
              <ArrowRight className="size-4" />
            </button>
          ) : null}

          <button
            type="button"
            onClick={scrollToTop}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border px-5 text-sm font-semibold text-foreground transition hover:border-foreground/30 hover:bg-card-2/50 active:scale-95"
          >
            <ArrowUp className="size-4" />
            <span>Back to Top</span>
          </button>
        </div>
      </div>
    </section>
  )
}
