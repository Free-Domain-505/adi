import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMarkDetails, useSmartBack } from '../lib/backToDetails'
import { ArrowLeft, ArrowUpDown, BookOpen, RefreshCw, Search, Share2, Star } from 'lucide-react'
import { useAsync } from '../hooks/useAsync'
import { useReading } from '../lib/reading'
import { cn } from '../lib/utils'
import { mangaShareUrl, shareMedia } from '../lib/share'
import {
  MANHWA_SOURCES,
  manhwaHref,
  manhwaReadingKey,
  manhwaSourceInfo,
  manhwaSourceParams,
  resolveManhwaSource,
  type ManhwaSourceId,
} from '../lib/manhwaModels'
import {
  bestManhwaMatch,
  fetchManhwaMeta,
  proxiedManhwaImage,
  resolveManhwaChaptersWithFallback,
  searchManhwa,
  type ManhwaChapterRef,
} from '../services/manhwa'
import { ErrorState } from '../components/ErrorState'
import { Reveal } from '../components/Reveal'
import { ShimmerButton } from '../components/ShimmerButton'
import { Skeleton } from '../components/Skeleton'
import { StarBorder } from '../components/StarBorder'
import NotFoundPage from './NotFoundPage'

const PAGE = 100

export default function ManhwaDetailsPage() {
  const { id = '' } = useParams()
  if (!id) return <NotFoundPage />
  return <Details id={id} />
}

function Details({ id }: { id: string }) {
  const navigate = useNavigate()
  useMarkDetails()
  const [params] = useSearchParams()
  const titleParam = params.get('title') ?? ''
  const coverParam = params.get('cover') ?? ''
  const source = resolveManhwaSource(params.get('source'))
  const info = manhwaSourceInfo(source)

  const meta = useAsync(() => (titleParam ? fetchManhwaMeta(titleParam) : Promise.resolve(null)), [titleParam])
  const data = useAsync(async () => {
    const resolved = await resolveManhwaChaptersWithFallback(id, titleParam, source)
    if (!resolved.chapters.length && !resolved.wid) {
      throw new Error(`Couldn’t find this title on ${info.displayName}. Try another server below, or search for it from the manhwa page.`)
    }
    return resolved
  }, [id, titleParam, source])

  const activeSource = data.data?.source ?? source
  const wid = data.data?.wid ?? id
  const saved = useReading('manga').find((r) => r.id === manhwaReadingKey(activeSource, wid))
  const m = meta.data
  const title = m?.title || titleParam || saved?.title || 'Manhwa'
  const chapters = data.data?.chapters ?? []

  const coverCandidates = useMemo(() => {
    const out: string[] = []
    if (m?.cover) {
      out.push(m.cover)
      out.push(proxiedManhwaImage(m.cover, activeSource, title))
    }
    if (coverParam) {
      if (/anilist\.co|kitsu\./i.test(coverParam)) {
        out.push(coverParam)
        out.push(proxiedManhwaImage(coverParam, activeSource, title))
      } else {
        out.push(proxiedManhwaImage(coverParam, activeSource, title))
        out.push(coverParam)
      }
    }
    if (saved?.cover) {
      out.push(saved.cover)
    }
    if (title && title !== 'Manhwa') {
      out.push(proxiedManhwaImage('', activeSource, title))
    }
    return [...new Set(out.filter(Boolean))]
  }, [m?.cover, coverParam, saved?.cover, activeSource, title])

  const cover = coverCandidates[0] ?? ''
  const [coverIndex, setCoverIndex] = useState(0)
  const coverKey = coverCandidates.join('|')
  useEffect(() => {
    setCoverIndex(0)
  }, [id, coverKey])

  const activeCover = coverCandidates[coverIndex] ?? ''
  const banner = m?.banner || activeCover

  const [asc, setAsc] = useState(false)
  const [range, setRange] = useState(0)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [bannerFailed, setBannerFailed] = useState(false)
  const [switching, setSwitching] = useState<ManhwaSourceId | null>(null)
  const [missing, setMissing] = useState<ManhwaSourceId | null>(null)

  useEffect(() => {
    setBannerFailed(false)
  }, [banner])

  useEffect(() => {
    document.title = `${title} — AnimeStream`
    window.scrollTo({ top: 0 })
  }, [title])

  const shown = useMemo<ManhwaChapterRef[]>(() => {
    const f = filter.trim().toLowerCase()
    const base = f ? chapters.filter((c) => c.number === f || (c.title ?? '').toLowerCase().includes(f)) : chapters
    return asc ? base : [...base].reverse()
  }, [chapters, asc, filter])
  const pages = Math.ceil(shown.length / PAGE)
  const slice = shown.slice(range * PAGE, range * PAGE + PAGE)
  useEffect(() => setRange(0), [asc, filter])

  const readUrl = (c: ManhwaChapterRef) =>
    `/manhwa/${encodeURIComponent(wid)}/read/${encodeURIComponent(c.chapterId)}?${new URLSearchParams({
      title,
      cover,
      ...manhwaSourceParams(activeSource),
    })}`
  const first = chapters[0]
  const latest = chapters[chapters.length - 1]
  const resume = saved?.resume ?? (first ? readUrl(first) : null)

  async function switchTo(target: ManhwaSourceId) {
    if (target === activeSource || switching) return
    setSwitching(target)
    setMissing(null)
    try {
      const hit = bestManhwaMatch(await searchManhwa(titleParam || title, target), titleParam || title)
      if (hit) navigate(manhwaHref({ ...hit, poster: hit.poster || cover }))
      else setMissing(target)
    } catch {
      setMissing(target)
    } finally {
      setSwitching(null)
    }
  }

  const back = useSmartBack('/manhwa')

  const desc = m?.description ?? ''
  const long = desc.length > 420

  return (
    <main className="overscroll-y-none pb-20">
      <section className="relative overflow-x-clip bg-background px-4 pb-10 pt-6 sm:px-6 sm:pt-8">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bottom-3 overflow-hidden">
          {banner && !bannerFailed && (
            <img
              src={banner}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setBannerFailed(true)}
              className="absolute inset-0 h-full w-full object-cover opacity-25"
              style={{
                maskImage:
                  'linear-gradient(to bottom, #000 0%, #000 38%, rgba(0,0,0,0.62) 64%, rgba(0,0,0,0.18) 80%, transparent 90%, transparent 100%)',
                WebkitMaskImage:
                  'linear-gradient(to bottom, #000 0%, #000 38%, rgba(0,0,0,0.62) 64%, rgba(0,0,0,0.18) 80%, transparent 90%, transparent 100%)',
              }}
            />
          )}
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-4 h-36"
          style={{
            background:
              'linear-gradient(to top, var(--background) 0%, var(--background) 20%, color-mix(in srgb, var(--background) 85%, transparent) 46%, transparent 100%)',
          }}
        />

        <div className="relative z-20 mx-auto max-w-6xl">
          <button type="button" onClick={back} className="mb-6 inline-flex cursor-pointer touch-manipulation items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-card-2">
            <ArrowLeft className="size-4" /> Back
          </button>

          <div className="flex flex-col gap-8 md:flex-row md:gap-10">
            <div className="relative mx-auto aspect-[2/3] w-52 shrink-0 overflow-hidden rounded-3xl border border-border bg-card-2 shadow-2xl shadow-black/30 md:mx-0 md:w-64" style={{ backgroundColor: m?.color ?? undefined }}>
              {activeCover ? (
                <img
                  src={activeCover}
                  alt={title}
                  referrerPolicy="no-referrer"
                  onError={() => setCoverIndex((i) => i + 1)}
                  className="size-full object-cover"
                />
              ) : (
                <div className="grid size-full place-items-center p-4 text-center font-display text-lg font-bold text-muted">{title}</div>
              )}
            </div>

            <div className="min-w-0 flex-1 text-center md:text-left">
              <p className="mb-2 eyebrow text-accent">{[m?.format ?? 'Manhwa', m?.status, m?.year].filter(Boolean).join(' · ')}</p>
              <h1 className="font-display text-3xl font-black leading-tight tracking-tight [text-wrap:balance]">{title}</h1>
              {m?.nativeTitle && <p className="mt-1 text-sm text-muted">{m.nativeTitle}</p>}

              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted md:justify-start">
                {m?.score && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                    <Star className="size-4 fill-current text-accent" /> {m.score.toFixed(1)}
                  </span>
                )}
                {chapters.length > 0 && <span>{chapters.length.toLocaleString()} chapters</span>}
                {m?.volumes && <span>{m.volumes} volumes</span>}
                {m && m.authors.length > 0 && <span>by {m.authors.slice(0, 2).join(', ')}</span>}
              </div>

              {m && m.genres.length > 0 && (
                <ul className="mt-4 flex flex-wrap justify-center gap-2 md:justify-start">
                  {m.genres.slice(0, 8).map((g) => (
                    <li key={g} className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted">
                      {g}
                    </li>
                  ))}
                </ul>
              )}

              {meta.loading && !m ? (
                <Skeleton className="mt-5 h-24 w-full" />
              ) : (
                desc && (
                  <>
                    <p className={cn('mt-5 whitespace-pre-line text-sm leading-relaxed text-muted', !open && long && 'line-clamp-5')}>{desc}</p>
                    {long && (
                      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 text-sm font-semibold text-accent hover:underline">
                        {open ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </>
                )
              )}

              <div className="mt-7 flex flex-wrap items-center justify-center gap-3 md:justify-start">
                {resume ? (
                  <StarBorder to={resume}>
                    <BookOpen className="size-4" /> {saved ? `Continue · ${saved.label}` : 'Start reading'}
                  </StarBorder>
                ) : (
                  <span className="text-sm text-muted">{data.loading ? 'Loading chapters…' : 'No chapters found'}</span>
                )}
                {latest && !saved && chapters.length > 1 && (
                  <ShimmerButton variant="ghost" to={readUrl(latest)}>
                    Latest · Ch. {latest.number}
                  </ShimmerButton>
                )}
                <ShimmerButton
                  variant="ghost"
                  onClick={() =>
                    shareMedia({
                      url: mangaShareUrl(wid, title, cover, manhwaSourceParams(activeSource), '/manhwa'),
                      title,
                      image: cover,
                      poster: cover,
                      label: 'Read free on AnimeStream',
                      subtitle: 'Manhwa',
                    })
                  }
                  icon={<Share2 className="size-4" />}
                >
                  Share
                </ShimmerButton>
                <ShimmerButton variant="ghost" to="/manhwa">
                  More manhwa
                </ShimmerButton>
              </div>

              <div className="mt-6">
                <p className="mb-2 eyebrow text-muted">Server</p>
                <div role="group" aria-label="Choose a server" className="flex flex-wrap justify-center gap-2 md:justify-start">
                  {MANHWA_SOURCES.map((x) => {
                    const on = x.id === activeSource
                    return (
                      <button
                        key={x.id}
                        type="button"
                        aria-pressed={on}
                        disabled={!!switching}
                        onClick={() => void switchTo(x.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition active:scale-95 disabled:opacity-60',
                          on ? 'border-foreground bg-foreground text-background' : 'border-border bg-card/60 text-muted hover:text-foreground',
                        )}
                      >
                        {switching === x.id && <RefreshCw className="size-3 animate-spin" />}
                        {x.displayName}
                      </button>
                    )
                  })}
                </div>
                {activeSource !== source && (
                  <p role="status" className="mt-2 text-xs text-muted">
                    Auto-switched to {manhwaSourceInfo(activeSource).displayName} because {info.displayName} had no readable chapters.
                  </p>
                )}
                {missing && (
                  <p role="status" className="mt-2 text-xs text-muted">
                    Couldn&rsquo;t find &ldquo;{titleParam || title}&rdquo; on {manhwaSourceInfo(missing).displayName}.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <Reveal>
        <section className="mx-auto mt-4 max-w-6xl px-4 sm:px-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-1 eyebrow text-accent">Read online</p>
              <h2 className="font-display text-2xl font-bold tracking-tight">Chapters</h2>
            </div>
            <div className="flex items-center gap-2">
              <label className="relative block flex-1 sm:w-64 sm:flex-none">
                <span className="sr-only">Find a chapter</span>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Chapter number"
                  inputMode="search"
                  className="h-10 w-full rounded-full border border-border bg-card/60 pl-10 pr-4 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              </label>
              <button type="button" onClick={() => setAsc((a) => !a)} className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card/60 px-4 text-sm font-medium transition hover:bg-card active:scale-95">
                <ArrowUpDown className="size-4" /> {asc ? 'Oldest first' : 'Newest first'}
              </button>
            </div>
          </div>

          {data.error ? (
            <ErrorState message={data.error.message} onRetry={data.reload} />
          ) : data.loading ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-2xl" />
              ))}
            </div>
          ) : chapters.length === 0 ? (
            <ErrorState message="The source returned no chapters for this title." onRetry={data.reload} />
          ) : (
            <>
              {pages > 1 && (
                <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
                  {Array.from({ length: pages }, (_, i) => {
                    const a = shown[i * PAGE]
                    const b = shown[Math.min(i * PAGE + PAGE, shown.length) - 1]
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setRange(i)}
                        className={cn('shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition active:scale-95', range === i ? 'border-foreground bg-foreground text-background' : 'border-border bg-card/60 text-muted hover:text-foreground')}
                      >
                        {a.number}–{b.number}
                      </button>
                    )
                  })}
                </div>
              )}
              {slice.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted">No chapter matches “{filter}”.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {slice.map((c) => {
                    const isLast = saved?.resume.includes(`/read/${encodeURIComponent(c.chapterId)}`)
                    return (
                      <li key={c.chapterId}>
                        <Link
                          to={readUrl(c)}
                          className={cn('group flex items-center gap-3 rounded-2xl border bg-card/60 px-4 py-3 transition hover:border-accent hover:bg-card', isLast ? 'border-accent' : 'border-border')}
                        >
                          <span className="w-14 shrink-0 font-display text-sm font-bold text-accent">Ch. {c.number}</span>
                          <span className="min-w-0 flex-1 truncate text-sm transition-colors group-hover:text-accent">{c.title ?? `Chapter ${c.number}`}</span>
                          {isLast && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-fg">LAST READ</span>}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      </Reveal>
    </main>
  )
}
