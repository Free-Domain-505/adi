import { LoadingGrid } from './LoadingGrid'

/** Clean AnimeStream loader with a hairline sweep and live timer. Fills its (positioned) parent. */
export function HeroLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="hl absolute inset-0 grid place-items-center bg-background text-foreground px-4">
      <div className="flex flex-col items-center gap-6">
        <p aria-hidden className="font-mono text-3xl font-black tracking-[0.28em] sm:text-5xl md:text-6xl">
          ANIMESTREAM
        </p>
        <span aria-hidden className="relative h-px w-44 overflow-hidden bg-foreground/15">
          <i className="absolute inset-y-0 w-1/3 bg-foreground" style={{ animation: 'hl-bar 1.3s cubic-bezier(.6,0,.4,1) infinite' }} />
        </span>
        <LoadingGrid label={label} className="text-muted" />
      </div>
    </div>
  )
}
