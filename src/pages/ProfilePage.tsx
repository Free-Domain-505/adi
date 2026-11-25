import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  BookmarkCheck,
  ChevronRight,
  Cloud,
  ExternalLink,
  Moon,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserCheck,
} from 'lucide-react'
import { AccountPanel, AuthPanel } from '../components/CloudSyncCard'
import { useAuth } from '../context/AuthContext'
import { ProfileEditor, ProfileHero, type SectionKey } from '../components/ProfileCustomizer'
import { StyledDisplayName } from '../components/StyledDisplayName'
import { CustomSelect } from '../components/CustomSelect'
import { AnimeCard } from '../components/AnimeCard'
import { Tabs } from '../components/Tabs'
import { Tour, tourDone, tourSeen, type TourStep } from '../components/Tour'
import {
  getPrefs,
  removeFromList,
  savePrefs,
  setStatus,
  STATUS_LABEL,
  useList,
  type Audio,
  type ListStatus,
} from '../lib/library'
import { useProfile } from '../lib/profile'
import { buildGradientCss, getPresetById, isDefaultNameStyle, NAME_ANIMATION_OPTIONS } from '../lib/nameStyle'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'
import { useTheme } from '../context/ThemeContext'
import { useFlag } from '../hooks/useFlag'

type TabKey = 'preferences' | 'watchlist' | 'account' | 'legal'
type WatchlistFilter = 'all' | ListStatus
const STATUSES = Object.keys(STATUS_LABEL) as ListStatus[]

const h2 = 'font-display text-xl font-bold'

/** A string kept in localStorage (empty string = unset). */
function useStored(key: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  return [
    v,
    (n) => {
      setV(n)
      try {
        if (n) localStorage.setItem(key, n)
        else localStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    },
  ]
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-7 w-12 select-none rounded-full border transition',
        on ? 'border-transparent bg-accent' : 'border-border bg-card-2'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
          on ? 'left-6' : 'left-0.5'
        )}
      />
    </button>
  )
}

const LANGS = ['ja', 'en', 'hi', 'es', 'pt', 'fr', 'de', 'it', 'ar', 'ru', 'ko', 'zh']
const langName = (c: string) => new Intl.DisplayNames(['en'], { type: 'language' }).of(c) ?? c

export default function ProfilePage() {
  const me = useProfile()
  const { user, loading } = useAuth()
  const { theme, setTheme } = useTheme()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const isSetup = searchParams.get('setup') === '1'

  const [editing, setEditing] = useState(isSetup)
  const [showAuth, setShowAuth] = useState(false)
  const [editTab, setEditTab] = useState<SectionKey>(() => (!me.avatar ? 'avatar' : !me.banner ? 'banner' : 'identity'))
  const [activeTab, setActiveTab] = useState<TabKey>('preferences')
  const watchlistItems = useList()
  const [watchlistFilter, setWatchlistFilter] = useState<WatchlistFilter>('all')

  const filteredWatchlist = useMemo(() => {
    return watchlistFilter === 'all'
      ? watchlistItems
      : watchlistItems.filter((i) => i.status === watchlistFilter)
  }, [watchlistItems, watchlistFilter])

  useEffect(() => {
    if (isSetup) {
      setEditTab(!me.avatar ? 'avatar' : !me.banner ? 'banner' : 'avatar')
      setEditing(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [isSetup, me.avatar, me.banner])

  const [prefs, setPrefs] = useState(getPrefs)
  const [skipFiller, setSkipFiller] = useFlag('zk:skipfiller', false)
  const [lang, setLang] = useStored('zp-alang')
  const [maxQ, setMaxQ] = useStored('zp-q')
  const [overviewTour, setOverviewTour] = useState(false)
  const overviewTourKey = user?.id ? `profile-overview-v4:${user.id}` : null

  const tourSteps: TourStep[] = useMemo(
    () => [
      {
        target: '[data-tour="profile-avatar"]',
        title: 'Profile Picture & Frame',
        text: 'Tap the pencil icon on your avatar to pick an official anime PFP and equip an animated avatar frame.',
      },
      {
        target: '[data-tour="profile-banner-btn"]',
        title: 'Profile Banner',
        text: 'Customize your top cover image with a widescreen anime banner preset.',
      },
      {
        target: '[data-tour="profile-bio"]',
        title: 'Your Bio & About',
        text: 'Share a short intro, favorite quote, or anime taste on your profile card.',
      },
      {
        target: '[data-tour="profile-customize-btn"]',
        title: 'Full Profile Studio',
        text: 'Open the full customizer anytime to update your display name, bio, avatar, frame, and banner in one place.',
      },
      {
        target: '[data-tour="profile-tabs"]',
        title: 'Profile Sections',
        text: 'Switch between Player Preferences, your Watchlist, Cloud & Sync for cross-device backup, and About & Legal.',
      },
      {
        target: '[data-tour="pref-theme"]',
        title: 'App Theme',
        text: 'Choose your preferred appearance mode for AnimeStream.',
      },
      {
        target: '[data-tour="pref-audio"]',
        title: 'Default Audio (Sub / Dub)',
        text: 'Set whether episodes start in Dub (default) or Sub (original Japanese audio with subtitles).',
      },
      {
        target: '[data-tour="pref-lang"]',
        title: 'Preferred Audio Language',
        text: 'Pick your preferred dub language for multi-audio streams, or keep Japanese locked when Sub mode is active.',
      },
      {
        target: '[data-tour="pref-quality"]',
        title: 'Preferred Video Quality',
        text: 'Select the default resolution (Auto, 1080p, 720p, 480p, or 360p) that videos start playing in.',
      },
      {
        target: '[data-tour="pref-filler"]',
        title: 'Skip Filler Episodes',
        text: 'Enable this so Next Episode and Autoplay automatically jump past filler and recap episodes.',
      },
    ],
    [],
  )

  useEffect(() => {
    if (editing || activeTab !== 'preferences' || !overviewTourKey) {
      setOverviewTour(false)
      return
    }
    if (tourSeen(overviewTourKey)) return
    const t = window.setTimeout(() => {
      if (!overviewTourKey || tourSeen(overviewTourKey)) return
      const hasTargets = tourSteps.some((s) => Boolean(document.querySelector(s.target)))
      if (!hasTargets) return
      setOverviewTour(true)
    }, 550)
    return () => window.clearTimeout(t)
  }, [editing, activeTab, overviewTourKey, tourSteps])


  useEffect(() => {
    document.title = editing ? 'Edit Profile — AnimeStream' : 'Profile — AnimeStream'
    document.documentElement.dataset.zkMono = ''
    if (location.hash === '#legal') {
      setActiveTab('legal')
      window.setTimeout(() => document.getElementById('legal')?.scrollIntoView({ behavior: 'smooth' }), 150)
    }
    return () => {
      delete document.documentElement.dataset.zkMono
    }
  }, [editing])

  const startEdit = (tab?: SectionKey) => {
    if (tab) setEditTab(tab)
    setEditing(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const setPref = (p: { audio?: Audio }) => {
    savePrefs(p)
    setPrefs(getPrefs())
    if (p.audio) toast(`Default audio: ${p.audio === 'sub' ? 'Sub' : 'Dub'}`)
  }
  const flag = (set: (v: boolean) => void, label: string) => (v: boolean) => {
    set(v)
    toast(`${label} ${v ? 'on' : 'off'}`)
  }

  const SUB_TABS = [
    { id: 'preferences' as const, label: 'Preferences', icon: SlidersHorizontal },
    {
      id: 'watchlist' as const,
      label: 'Watchlist',
      icon: BookmarkCheck,
      badge: watchlistItems.length > 0 ? String(watchlistItems.length) : null,
    },
    { id: 'account' as const, label: 'Cloud & Sync', icon: Cloud, badge: user ? 'Connected' : null },
    { id: 'legal' as const, label: 'About & Legal', icon: ShieldCheck },
  ]

  return (
    <main className="mx-auto w-full min-w-0 max-w-4xl space-y-6 px-4 pb-28 pt-6 sm:px-6 sm:pt-8 md:pt-10">
      {editing ? (
        <ProfileEditor
          me={me}
          initialTab={editTab}
          setupMode={isSetup}
          onCompleteSetup={() => {
            setEditing(false)
            navigate('/')
          }}
          onClose={() => {
            setEditing(false)
            if (isSetup) {
              searchParams.delete('setup')
              setSearchParams(searchParams, { replace: true })
            }
          }}
        />
      ) : (
        <div className="space-y-6">
          {/* 1. Unified Profile Hero Header */}
          <ProfileHero me={me} onEdit={startEdit} />

          {/* 1b. Name Colour & Gradients Section */}
          <section aria-label="Name Colour & Gradients">
            <Link
              to="/profile/name-style"
              draggable={false}
              className="group flex select-none flex-wrap items-center justify-between gap-4 rounded-3xl border border-border bg-card/60 p-4 sm:p-5 shadow-lg transition hover:border-accent/60 hover:bg-card"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                <div
                  className="grid size-12 shrink-0 place-items-center rounded-2xl border border-border bg-card-2 text-foreground shadow-sm"
                  style={
                    !isDefaultNameStyle(me.nameStyle) && me.nameStyle?.colors?.length
                      ? { backgroundImage: buildGradientCss(me.nameStyle.colors, me.nameStyle.angle) }
                      : undefined
                  }
                >
                  <Palette
                    className={cn(
                      'size-5',
                      !isDefaultNameStyle(me.nameStyle) && me.nameStyle?.colors?.length
                        ? 'text-white drop-shadow'
                        : 'text-accent',
                    )}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-base font-bold text-foreground">
                      Name Colour &amp; Gradients
                    </h2>
                    <span className="rounded-md border border-border bg-card-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                      {isDefaultNameStyle(me.nameStyle)
                        ? 'Default'
                        : (getPresetById(me.nameStyle?.presetId)?.name ?? 'Custom')}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted">
                    <span className="text-muted">Preview:</span>
                    <StyledDisplayName
                      isSelf
                      name={me.name || 'Otaku'}
                      className="truncate font-display text-sm font-bold text-foreground"
                    />
                    {!isDefaultNameStyle(me.nameStyle) && me.nameStyle?.animation && me.nameStyle.animation !== 'none' && !me.nameStyle.staticGradient && (
                      <span className="text-[11px] text-muted">
                        • {NAME_ANIMATION_OPTIONS.find((a) => a.id === me.nameStyle?.animation)?.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card-2 px-4 text-xs font-bold text-foreground transition group-hover:border-accent group-hover:text-accent">
                <span>Customize</span>
                <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </section>

          {/* 2. Cohesive Section Switcher Tabs */}
          <div data-tour="profile-tabs" className="flex select-none gap-2 overflow-x-auto pb-1 no-scrollbar border-b border-border/60 pt-1">
            {SUB_TABS.map(({ id, label, icon: Icon, badge }) => {
              const on = activeTab === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setActiveTab(id)
                  }}
                  className={cn(
                    'inline-flex shrink-0 select-none items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-bold transition active:scale-95',
                    on
                      ? 'border-accent bg-accent/15 text-accent shadow-sm'
                      : 'border-transparent bg-transparent text-muted hover:border-border/60 hover:text-foreground'
                  )}
                >
                  <Icon className="size-4" />
                  <span>{label}</span>
                  {badge && (
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-black text-accent uppercase">
                      {badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* 3. Unified Content Sections */}
          {activeTab === 'preferences' && (
            <section
              id="settings"
              className="rounded-3xl border border-border bg-card/60 p-5 sm:p-7 shadow-lg"
              aria-label="Settings & Preferences"
            >
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className={h2}>Player &amp; App Preferences</h2>
                  <p className="mt-1 text-xs text-muted">
                    Configure your streaming experience, theme, and playback defaults.
                  </p>
                </div>
              </div>

              <Row title="Theme">
                <div data-tour="pref-theme" className="inline-flex select-none gap-1 rounded-full border border-border bg-card/60 p-1">
                  {(['dark', 'light'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTheme(t)
                      }}
                      aria-pressed={theme === t}
                      className={cn(
                        'inline-flex h-8 select-none items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold capitalize transition',
                        theme === t ? 'bg-foreground text-background' : 'text-muted'
                      )}
                    >
                      {t === 'dark' ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
                      {t}
                    </button>
                  ))}
                </div>
              </Row>

              <Row title="Default audio" hint="Sub or dub, for servers that offer both">
                <div data-tour="pref-audio" className="inline-flex select-none gap-1 rounded-full border border-border bg-card/60 p-1">
                  {(['sub', 'dub'] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setPref({ audio: a })}
                      aria-pressed={(prefs.audio ?? 'dub') === a}
                      className={cn(
                        'h-8 select-none rounded-full px-3.5 text-sm font-semibold uppercase transition',
                        (prefs.audio ?? 'dub') === a ? 'bg-foreground text-background' : 'text-muted'
                      )}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </Row>

              <Row
                title="Preferred audio language"
                hint={(prefs.audio ?? 'dub') === 'sub' ? 'Sub mode uses original Japanese audio' : 'For multi-audio dub streams'}
              >
                <div data-tour="pref-lang">
                  {(prefs.audio ?? 'dub') === 'sub' ? (
                    <CustomSelect
                      label="Preferred audio language"
                      value="ja"
                      onChange={() => {
                        toast('Sub mode plays in Japanese')
                      }}
                      placeholder="Japanese"
                      options={[{ value: 'ja', label: langName('ja') }]}
                    />
                  ) : (
                    <CustomSelect
                      label="Preferred audio language"
                      value={lang === 'ja' ? '' : lang}
                      onChange={(v) => {
                        setLang(v)
                        try {
                          if (v) localStorage.setItem('zp-alang-explicit', '1')
                          else localStorage.removeItem('zp-alang-explicit')
                        } catch {}
                        toast(v ? `Audio language: ${langName(v)}` : 'Audio language: Auto')
                      }}
                      placeholder="Auto"
                      options={[
                        { value: '', label: 'Auto' },
                        ...LANGS.filter((c) => c !== 'ja').map((c) => ({ value: c, label: langName(c) })),
                      ]}
                    />
                  )}
                </div>
              </Row>

              <Row title="Preferred quality" hint="Videos start at this quality (or closest below)">
                <div data-tour="pref-quality">
                  <CustomSelect
                    label="Preferred quality"
                    value={maxQ}
                    onChange={(v) => {
                      setMaxQ(v)
                      toast(v ? `Preferred quality: ${v}p` : 'Preferred quality: Auto')
                    }}
                    placeholder="Auto"
                    options={[
                      { value: '', label: 'Auto (best)' },
                      { value: '1080', label: '1080p' },
                      { value: '720', label: '720p' },
                      { value: '480', label: '480p' },
                      { value: '360', label: '360p' },
                    ]}
                  />
                </div>
              </Row>

              <Row title="Skip filler episodes" hint="Next and autoplay jump over filler and recaps">
                <div data-tour="pref-filler">
                  <Switch on={skipFiller} onChange={flag(setSkipFiller, 'Skip filler')} label="Skip filler episodes" />
                </div>
              </Row>
            </section>
          )}

          {activeTab === 'account' && (
            <div className="space-y-4">
              {loading ? null : user ? (
                <AccountPanel />
              ) : showAuth ? (
                <AuthPanel />
              ) : (
                <div className="rounded-3xl border border-border bg-card/60 p-6 sm:p-8 shadow-lg text-center space-y-4">
                  <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent/15 text-accent">
                    <UserCheck className="size-6" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-bold">Sign in to AnimeStream Cloud</h2>
                    <p className="mt-1 text-sm text-muted max-w-md mx-auto">
                      Back up your watch history, watchlist, reading progress and custom profile across all devices.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAuth(true)}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-95"
                  >
                    <span>Sign in or create account</span>
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'watchlist' && (
            <section
              id="watchlist"
              className="rounded-3xl border border-border bg-card/60 p-5 sm:p-7 shadow-lg space-y-6"
              aria-label="Your Watchlist"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
                <div>
                  <h2 className={h2}>My Watchlist</h2>
                  <p className="mt-1 text-xs text-muted">
                    {watchlistItems.length === 0
                      ? 'No titles saved in your watchlist yet.'
                      : `${watchlistItems.length} title${watchlistItems.length === 1 ? '' : 's'} saved across your watchlist.`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to="/list"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card px-4 py-2 text-xs font-bold text-foreground transition hover:border-accent hover:text-accent active:scale-95"
                  >
                    <span>Full Library</span>
                    <ExternalLink className="size-3.5" />
                  </Link>
                </div>
              </div>

              {/* Status tabs */}
              {watchlistItems.length > 0 && (
                <Tabs<WatchlistFilter>
                  value={watchlistFilter}
                  onChange={setWatchlistFilter}
                  tabs={[
                    { id: 'all', label: 'All', count: watchlistItems.length },
                    ...STATUSES.map((s) => ({
                      id: s,
                      label: STATUS_LABEL[s],
                      count: watchlistItems.filter((i) => i.status === s).length,
                    })),
                  ]}
                />
              )}

              {/* Items Grid or Empty State */}
              {watchlistItems.length === 0 ? (
                <div className="grid place-items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
                  <div className="grid size-12 place-items-center rounded-2xl bg-accent/15 text-accent">
                    <BookmarkCheck className="size-6" />
                  </div>
                  <h3 className="mt-4 font-display text-base font-bold text-foreground">Watchlist is Empty</h3>
                  <p className="mt-1 max-w-sm text-xs text-muted">
                    Tap the bookmark button on any anime or movie to save it to your personal watchlist.
                  </p>
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                    <Link
                      to="/browse"
                      className="rounded-full bg-accent px-5 py-2 text-xs font-bold text-accent-fg shadow-md shadow-accent/20 transition hover:brightness-110 active:scale-95"
                    >
                      Browse Anime
                    </Link>
                    <Link
                      to="/movies"
                      className="rounded-full border border-border bg-card px-5 py-2 text-xs font-bold text-foreground transition hover:border-accent hover:text-accent active:scale-95"
                    >
                      Browse Movies
                    </Link>
                  </div>
                </div>
              ) : filteredWatchlist.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
                  <p className="text-sm font-semibold text-foreground">
                    No titles marked “{STATUS_LABEL[watchlistFilter as ListStatus]}”
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Switch to another status tab or add titles from browse pages.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4">
                  {filteredWatchlist.map((item, idx) => {
                    const isTmdb = typeof item.image === 'string' && item.image.includes('image.tmdb.org')
                    const watchUrl = item.href ?? (isTmdb ? `/movies/${item.format === 'MOVIE' ? 'movie' : 'tv'}/${item.id}` : `/anime/${item.id}`)
                    return (
                      <div key={item.id} className="group relative flex flex-col">
                        <AnimeCard
                          item={{
                            ...item,
                            href: watchUrl,
                            caption: item.progress ? `Ep ${item.progress}${item.episodes ? ` / ${item.episodes}` : ''}` : undefined,
                          }}
                          fluid
                          index={idx % 12}
                        />
                        <div className="mt-2.5 flex items-center gap-1.5">
                          <select
                            aria-label={`Status for ${item.title}`}
                            value={item.status}
                            onChange={(e) => {
                              setStatus(item.id, e.target.value as ListStatus)
                              toast(`Updated ${item.title} to ${STATUS_LABEL[e.target.value as ListStatus]}`)
                            }}
                            className="h-8 flex-1 rounded-xl border border-border bg-card px-2.5 text-xs font-medium text-foreground outline-none transition focus:border-accent"
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              removeFromList(item.id)
                              toast(`Removed ${item.title} from watchlist`)
                            }}
                            title="Remove from watchlist"
                            className="grid size-8 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 active:scale-95"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {activeTab === 'legal' && (
            <section
              id="legal"
              className="rounded-3xl border border-border bg-card/60 p-6 sm:p-8 shadow-lg space-y-6 text-sm leading-relaxed text-muted"
              aria-label="About and legal"
            >
              <h2 className={h2}>About &amp; Legal</h2>
              <div>
                <h3 className="mb-1 font-semibold text-foreground">Disclaimer</h3>
                <p>
                  AnimeStream does not host, upload or store any video, novel text or manga images. Streams, chapters and pages
                  are provided by third-party services and are fetched at the moment you watch or read. AnimeStream has no
                  control over that content and is not affiliated with those services. All titles, artwork and trademarks
                  belong to their respective owners.
                </p>
              </div>
              <div>
                <h3 className="mb-1 font-semibold text-foreground">DMCA / Copyright</h3>
                <p>
                  If you own a work and believe something linked from AnimeStream infringes your copyright, the file lives on
                  the third-party host, so please contact that host directly.
                </p>
              </div>
              <div>
                <h3 className="mb-1 font-semibold text-foreground">Data &amp; Credits</h3>
                <p>
                  Anime data from AniList and MyAnimeList (via Jikan); filler information from AnimeFillerList; artwork and
                  episode details from TMDB.
                </p>
              </div>
              <p className="border-t border-border/60 pt-4 text-xs">
                Your profile and preferences are kept in this browser. Clearing site data removes local storage.{' '}
                <Link to="/home" className="text-foreground underline underline-offset-2 font-medium">
                  Back to AnimeStream
                </Link>
              </p>
            </section>
          )}
        </div>
      )}

      {overviewTour && !editing && activeTab === 'preferences' && overviewTourKey && (
        <Tour
          steps={tourSteps}
          resume={false}
          onDone={() => {
            tourDone(overviewTourKey)
            setOverviewTour(false)
          }}
        />
      )}
    </main>
  )
}
