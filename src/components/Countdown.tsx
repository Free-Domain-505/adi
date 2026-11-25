import { useEffect, useMemo, useState } from 'react'
import { Radio } from 'lucide-react'
import { SpotlightCard } from './SpotlightCard'

/** Live countdown to the next episode. `airingAt` is a UNIX timestamp in seconds. */
export function Countdown({ airingAt, episode }: { airingAt: number; episode: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => window.clearInterval(id)
  }, [])

  const airLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(airingAt * 1000))
    } catch {
      return ''
    }
  }, [airingAt])

  const diff = Math.max(0, Math.floor(airingAt - now))
  const days = Math.floor(diff / 86400)
  const hrs = Math.floor((diff % 86400) / 3600)
  const min = Math.floor((diff % 3600) / 60)
  const sec = diff % 60

  const parts = [
    ...(days > 0 ? [{ v: days, l: 'days' }] : []),
    { v: hrs, l: 'hrs' },
    { v: min, l: 'min' },
    { v: sec, l: 'sec' },
  ]

  return (
    <SpotlightCard className="w-full max-w-[500px] rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3">
      <div className="flex items-center justify-between gap-2.5 sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <span className="grid size-7 sm:size-8 shrink-0 place-items-center rounded-lg sm:rounded-xl bg-accent/15 text-accent">
            <Radio className="size-3.5 sm:size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <p className="font-display text-xs sm:text-sm font-bold text-foreground truncate">
                Episode {episode}
              </p>
              <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-semibold text-accent">
                Next airing
              </span>
            </div>
            {airLabel && (
              <p className="mt-0.5 truncate text-[10.5px] sm:text-xs text-muted">{airLabel}</p>
            )}
          </div>
        </div>

        {diff > 0 ? (
          <div
            aria-label={`Airing in ${days > 0 ? `${days} days ` : ''}${hrs} hours ${min} minutes ${sec} seconds`}
            className="flex shrink-0 items-center gap-1 sm:gap-1.5"
          >
            {parts.map((p) => (
              <div
                key={p.l}
                className="min-w-[1.95rem] sm:min-w-[2.35rem] rounded-lg border border-border/60 bg-card-2 px-1 py-1 sm:px-1.5 sm:py-1.25 text-center shadow-xs"
              >
                <p className="font-display text-xs sm:text-sm font-bold leading-none tabular-nums text-foreground">
                  {String(p.v).padStart(2, '0')}
                </p>
                <p className="mt-0.5 text-[7.5px] sm:text-[8.5px] font-medium leading-none text-muted uppercase tracking-wider">{p.l}</p>
              </div>
            ))}
          </div>
        ) : (
          <span className="shrink-0 rounded-lg bg-accent/15 px-2.5 py-1 text-[11px] sm:text-xs font-semibold text-accent">
            Airing now
          </span>
        )}
      </div>
    </SpotlightCard>
  )
}
