import { Img } from './Img'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpDown, AudioLines, Check, EyeOff, Play, Search } from 'lucide-react'
import type { EpInfo, EpKind } from '../services/api'
import { cn } from '../lib/utils'
import { Tabs } from './Tabs'
import { WatchedBadge, WatchedThumbOverlay } from './WatchedBadge'

const PAGE = 25
const ctl = 'grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card transition hover:bg-card-2 active:scale-90'

/** Non-canon labels (canon episodes carry none). Shared with the player. */
export const KIND: Record<EpKind, { label: string; cls: string }> = {
  filler: { label: 'Filler', cls: 'border-amber-400/50 bg-amber-400/10 text-amber-300' },
  mixed: { label: 'Mixed', cls: 'border-sky-400/50 bg-sky-400/10 text-sky-300' },
  recap: { label: 'Recap', cls: 'border-violet-400/50 bg-violet-400/10 text-violet-300' },
}

const fmtAir = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null)

/** Episode browser: range pills, list layout, search + sort. TMDB/AniList info per episode, cover art when an episode has no still. */
export function EpisodeList({
  total,
  available,
  current,
  hrefFor,
  info,
  fallbackImg,
  defaultRuntime,
  badge = 'Now playing',
  kinds,
  watchedEps,
  loading = false,
  onPick,
}: {
  total: number
  /** highest episode that has aired */
  available: number
  current?: number
  hrefFor: (ep: number) => string
  info: Map<number, EpInfo>
  fallbackImg?: string | null
  defaultRuntime?: number | null
  badge?: string
  /** filler / mixed / recap episodes, canon is absent */
  kinds?: Map<number, EpKind>
  /** episode numbers that have already been watched */
  watchedEps?: Set<number> | number[]
  /** true while remote episode metadata / stills are still loading */
  loading?: boolean
  onPick?: (ep: number) => void
}) {
  const watchedSet = useMemo(
    () => (watchedEps instanceof Set ? watchedEps : Array.isArray(watchedEps) ? new Set(watchedEps) : null),
    [watchedEps],
  )
  const [page, setPage] = useState(() => Math.max(0, Math.floor(((current ?? 1) - 1) / PAGE)))
  const [desc, setDesc] = useState(false)
  const [q, setQ] = useState('')
  const [hideNon, setHideNon] = useState(false)
  const counts = useMemo(() => {
    const c: Record<EpKind, number> = { filler: 0, mixed: 0, recap: 0 }
    kinds?.forEach((k, n) => {
      if (n <= total) c[k]++
    })
    return c
  }, [kinds, total])
  const anyKind = counts.filler + counts.mixed + counts.recap > 0

  // Filter filler / recap BEFORE chunking into 25-episode pages
  const pool = useMemo(() => {
    let all = Array.from({ length: total }, (_, i) => i + 1)
    if (hideNon && kinds) {
      all = all.filter((n) => {
        const k = kinds.get(n)
        return k !== 'filler' && k !== 'recap'
      })
    }
    return all
  }, [total, hideNon, kinds])

  const hiddenCount = total - pool.length
  const pages = Math.max(1, Math.ceil(pool.length / PAGE))
  const safePage = Math.min(page, pages - 1)

  useEffect(() => {
    if (!current) return
    const idx = pool.indexOf(current)
    if (idx >= 0) setPage(Math.floor(idx / PAGE))
  }, [current, pool])

  useEffect(() => {
    if (page >= pages) setPage(Math.max(0, pages - 1))
  }, [page, pages])

  const pageSlice = useMemo(() => {
    const start = safePage * PAGE
    return pool.slice(start, start + PAGE)
  }, [pool, safePage])

  const nums = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = term
      ? pool.filter((n) => String(n) === term || (info.get(n)?.name ?? '').toLowerCase().includes(term)).slice(0, 60)
      : pageSlice
    return desc ? [...list].reverse() : list
  }, [q, pool, pageSlice, info, desc])

  const ranges = useMemo(
    () =>
      Array.from({ length: pages }, (_, i) => {
        const start = i * PAGE
        const first = pool[start]
        const last = pool[Math.min(pool.length - 1, start + PAGE - 1)]
        return {
          id: String(i),
          label: first === undefined ? '—' : first === last ? `${first}` : `${first}–${last}`,
        }
      }),
    [pages, pool],
  )

  const rangeFrom = pageSlice[0] ?? 0
  const rangeTo = pageSlice[pageSlice.length - 1] ?? 0

  return (
    <div>
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search episode…"
            aria-label="Search episodes"
            className="h-10 w-full rounded-full border border-border bg-card pl-10 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <button type="button" onClick={() => setDesc((d) => !d)} aria-label="Reverse order" aria-pressed={desc} className={cn(ctl, desc && 'border-accent text-accent')}>
          <ArrowUpDown className="size-4" />
        </button>
      </div>

      {pages > 1 && !q && pool.length > 0 && (
        <div className="mt-3">
          <Tabs tabs={ranges} value={String(safePage)} onChange={(v) => setPage(Number(v))} />
        </div>
      )}

      <div className="mb-3 mt-5">
        <h2 className="font-display text-xl font-bold">Episodes</h2>
        <p className="text-sm text-muted">
          {q
            ? `${nums.length} found`
            : pool.length === 0
              ? `0 of ${total}`
              : hideNon && hiddenCount > 0
                ? `Ep ${rangeFrom}–${rangeTo} · ${pool.length} shown (${hiddenCount} filler hidden)`
                : `${rangeFrom}–${rangeTo} of ${total}`}
        </p>
        {anyKind && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(['filler', 'mixed', 'recap'] as const).map((k) => counts[k] > 0 && <span key={k} className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase', KIND[k].cls)}>{counts[k]} {KIND[k].label}</span>)}
            {counts.filler + counts.recap > 0 && (
              <button
                type="button"
                onClick={() => setHideNon((h) => !h)}
                aria-pressed={hideNon}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition active:scale-95',
                  hideNon
                    ? 'border-accent bg-accent text-accent-fg shadow-sm'
                    : 'border-border bg-card text-muted hover:border-foreground/30 hover:text-foreground',
                )}
              >
                {hideNon ? <Check className="size-3 stroke-[2.5]" /> : <EyeOff className="size-3" />}
                <span>{hideNon ? 'Filler hidden' : 'Hide filler'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {nums.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
          {hideNon && total > 0 && !q
            ? 'All episodes in this entry are filler or recap. Turn off "Filler hidden" to view them.'
            : 'No episodes match.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {nums.map((n, idx) => {
            const e = info.get(n)
            const aired = n <= available
            const on = n === current
            const thumbLoading = loading && !e?.image
            const fallback = !thumbLoading ? (fallbackImg ?? null) : null
            const img = e?.image ?? fallback
            const mins = e?.runtime ?? defaultRuntime
            const air = fmtAir(e?.air ?? null)
            const kind = kinds?.get(n)
            const isWatched = Boolean(watchedSet?.has(n))
            const name = e?.name ?? `Episode ${n}`
            const body = (
              <>
                <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-2xl bg-card-2 sm:w-52">
                  {thumbLoading && <span aria-hidden className="skeleton absolute inset-0 rounded-[inherit]" />}
                  {img && (
                    <Img
                      src={img}
                      fallbackSrc={e?.image ? fallback : null}
                      alt=""
                      loading={idx < 6 ? 'eager' : 'lazy'}
                      decoding="async"
                      className={cn('h-full w-full object-cover transition duration-500', aired && 'group-hover:scale-105', !e?.image && 'opacity-75')}
                    />
                  )}
                  <span aria-hidden className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  {kind && <span className={cn('absolute left-2 top-2 z-[4] rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase', KIND[kind].cls, 'bg-black/80')}>{KIND[kind].label}</span>}
                  {isWatched && <WatchedThumbOverlay size="sm" showReplay={!on} />}
                  <span className="absolute bottom-1.5 left-2.5 z-[4] font-display text-lg font-black text-white drop-shadow">{n}</span>
                  {aired && (!isWatched || on) && (
                    <span className="absolute bottom-1.5 right-2 z-[4] grid size-9 place-items-center rounded-full border border-white/30 bg-black/70 text-white">
                      {on ? <AudioLines className="size-4" /> : <Play className="size-4 fill-current" />}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  {loading && !e?.name ? (
                    <div className="space-y-2 py-1">
                      <div className="skeleton h-4 w-3/4 rounded-md" />
                      <div className="skeleton h-3 w-1/3 rounded-md" />
                    </div>
                  ) : (
                    <>
                      <p className="line-clamp-2 text-base font-semibold leading-snug">{name}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span>Ep {n}</span>
                        {mins ? <span>· {mins} min</span> : null}
                        {air && <span>· {air}</span>}
                        {kind && <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', KIND[kind].cls)}>{KIND[kind].label}</span>}
                        {!aired && <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase">Not aired</span>}
                        {isWatched && <WatchedBadge variant="inline" />}
                        {on && <span className="rounded-full bg-foreground px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-background">{badge}</span>}
                      </p>
                      {e?.overview && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted max-sm:hidden">{e.overview}</p>}
                    </>
                  )}
                </div>
              </>
            )
            const cls = cn(
              'group flex items-center gap-3 rounded-3xl border p-2.5 transition sm:gap-4 sm:p-3',
              on ? 'border-white/40 bg-white/[0.07]' : 'border-border bg-card/60',
              aired ? 'hover:bg-card active:scale-[0.99]' : 'cursor-not-allowed opacity-45',
            )
            return (
              <li key={n}>
                {aired ? (
                  <Link to={hrefFor(n)} onClick={() => onPick?.(n)} className={cls} aria-current={on ? 'true' : undefined}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls} title="Not aired yet">
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
