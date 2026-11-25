import { Link } from 'react-router-dom'
import { ChevronRight, MessagesSquare } from 'lucide-react'

/** Community Banner displayed on HomePage. */
export function ProfileCard() {
  return (
    <section className="mx-auto max-w-7xl space-y-3 px-4 sm:px-6" aria-label="AnimeStream Community">
      <Link
        to="/community"
        className="group relative flex items-center justify-between gap-4 overflow-hidden rounded-3xl border border-accent/25 bg-gradient-to-r from-accent/10 via-card/85 to-card/65 p-4 pr-5 transition duration-300 hover:border-accent/60 hover:shadow-xl hover:shadow-accent/10 active:scale-[0.99] sm:p-5"
      >
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-accent-fg shadow-lg shadow-accent/30 transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3 sm:size-14">
            <MessagesSquare className="size-6 sm:size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-display text-lg font-black tracking-tight text-foreground">
              AnimeStream Community
            </span>
            <p className="mt-0.5 truncate text-xs text-muted">
              Post, share recs &amp; chat with other fans right here on AnimeStream.
            </p>
          </div>
        </div>
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition group-hover:translate-x-0.5 group-hover:brightness-110">
          <ChevronRight className="size-5" />
        </span>
      </Link>
    </section>
  )
}
