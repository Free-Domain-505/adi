import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clapperboard,
  Copy,
  Database,
  ExternalLink,
  Flame,
  Globe,
  Heart,
  Loader2,
  Lock,
  LogIn,
  RefreshCw,
  RotateCcw,
  Server,
  Share2,
  ShieldCheck,
  Trophy,
  Wifi,
  Zap,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  EMPTY_SUPPORTER_DATA,
  loadSupporterDataFromDb,
  saveSupporterDataToDb,
  type SupporterData,
  type SupporterDbActiveMission,
  type SupporterDbStats,
} from '../lib/supportDb'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'
import { shareLink } from '../lib/share'

const SHRINKME_API_KEY = '165194fe77616bab2093a5fbd2a8e07a87b76e25'
const SHRINKME_API_ENDPOINT = 'https://shrinkme.io/api'

export interface SupportMission {
  id: string
  title: string
  badge: string
  steps: number
  xp: number
  popular?: boolean
  accent: string
  desc: string
  impact: string
}

export const SUPPORT_MISSIONS: SupportMission[] = [
  {
    id: 'quick',
    title: 'Daily Server Fuel',
    badge: '1 Step',
    steps: 1,
    xp: 60,
    accent: '#f43f5e',
    desc: 'Quick 15-second sponsor link! Powers daily edge CDN nodes and database queries for buffer-free anime streaming.',
    impact: 'Covers edge cluster DNS queries & daily session caching',
  },
  {
    id: 'turbo',
    title: 'Multi-Audio & Dub Supporter',
    badge: '3 Steps',
    steps: 3,
    xp: 220,
    popular: true,
    accent: '#f59e0b',
    desc: 'Complete 3 steps to directly fund our high-speed Hindi & English dub streaming mirrors and raw storage pipelines.',
    impact: 'Funds uncapped multi-audio audio streams & dub mirror bandwidth',
  },
  {
    id: 'patron',
    title: 'Master Server Pillar',
    badge: '6 Steps',
    steps: 6,
    xp: 550,
    accent: '#06b6d4',
    desc: 'Our supreme 6-step community mission! Finances high-capacity CDN clusters, domain renewals & keeps AnimeStream 100% free.',
    impact: 'Maintains master video clusters, backup CDN nodes & domain uptime',
  },
]

const INFRASTRUCTURE_PILLARS = [
  {
    icon: Server,
    title: 'Master CDN Video Clusters',
    desc: 'High-speed edge servers streaming buffer-free 1080p and 4K playback across all devices.',
  },
  {
    icon: Wifi,
    title: 'Direct Stream Mirrors',
    desc: 'Zero-proxy video streams designed to handle high peak traffic with zero lag.',
  },
  {
    icon: Clapperboard,
    title: 'Multi-Audio Dub Upkeep',
    desc: 'Continuous synchronization of Hindi, English, and regional multi-audio tracks.',
  },
  {
    icon: Zap,
    title: '100% Free Forever Guarantee',
    desc: 'No forced paywalls, premium-locked episodes, or subscription fees for anyone.',
  },
]

export default function SupportPage() {
  const { user, loading: authLoading } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // Database state
  const [dbLoaded, setDbLoaded] = useState(false)
  const [syncingDb, setSyncingDb] = useState(false)
  const [supporterData, setSupporterData] = useState<SupporterData>(EMPTY_SUPPORTER_DATA)

  // UI selection & active step link state
  const [selectedMissionId, setSelectedMissionId] = useState<string>(SUPPORT_MISSIONS[0].id)
  const [generatingStep, setGeneratingStep] = useState(false)
  const [currentStepUrl, setCurrentStepUrl] = useState<string | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)

  // Verification feedback states
  const [justCompletedStep, setJustCompletedStep] = useState<number | null>(null)
  const [fullMissionCelebration, setFullMissionCelebration] = useState<{
    mission: SupportMission
    xpGained: number
  } | null>(null)

  const processingReturnRef = useRef<string | null>(null)

  const stats: SupporterDbStats = supporterData.stats
  const activeProgress: SupporterDbActiveMission | null = supporterData.activeMission

  const activeMission = useMemo(() => {
    return SUPPORT_MISSIONS.find((m) => m.id === selectedMissionId) || SUPPORT_MISSIONS[0]
  }, [selectedMissionId])

  const isInProgress = useMemo(() => {
    return activeProgress !== null && activeProgress.missionId === selectedMissionId
  }, [activeProgress, selectedMissionId])

  const effectiveCurrentStep = useMemo(() => {
    if (isInProgress && activeProgress) {
      return Math.min(activeProgress.completedSteps + 1, activeProgress.totalSteps)
    }
    return 1
  }, [isInProgress, activeProgress])

  const effectiveCompletedSteps = useMemo(() => {
    if (isInProgress && activeProgress) {
      return activeProgress.completedSteps
    }
    return 0
  }, [isInProgress, activeProgress])

  const progressPercent = useMemo(() => {
    if (!isInProgress || !activeProgress) return 0
    return Math.round((activeProgress.completedSteps / activeProgress.totalSteps) * 100)
  }, [isInProgress, activeProgress])

  const rank = useMemo(() => {
    const c = stats.totalLinksSolved
    if (c >= 24) return { title: 'Sovereign Pillar', color: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' }
    if (c >= 12) return { title: 'Diamond Patron', color: 'text-sky-400 border-sky-500/30 bg-sky-500/10' }
    if (c >= 6) return { title: 'Gold Sponsor', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' }
    if (c >= 2) return { title: 'Silver Supporter', color: 'text-slate-300 border-white/20 bg-white/10' }
    if (c >= 1) return { title: 'Bronze Booster', color: 'text-orange-400 border-orange-500/30 bg-orange-500/10' }
    return { title: 'Otaku Member', color: 'text-muted border-border bg-card' }
  }, [stats.totalLinksSolved])

  const persistSupporterData = useCallback(
    async (next: SupporterData): Promise<boolean> => {
      setSupporterData(next)
      if (!user?.id) return false
      setSyncingDb(true)
      try {
        return await saveSupporterDataToDb(user.id, next)
      } finally {
        setSyncingDb(false)
      }
    },
    [user?.id],
  )

  // Hydrate supporter data directly from Supabase database once auth resolves
  useEffect(() => {
    if (authLoading) return
    let alive = true
    setDbLoaded(false)

    loadSupporterDataFromDb(user?.id)
      .then(({ data }) => {
        if (!alive) return
        setSupporterData(data)
        if (data.activeMission?.missionId) {
          setSelectedMissionId(data.activeMission.missionId)
          const savedStepUrl =
            data.activeMission.stepSessions?.[data.activeMission.currentStep]?.url || null
          setCurrentStepUrl(savedStepUrl)
        }
      })
      .finally(() => {
        if (alive) setDbLoaded(true)
      })

    const handleSync = () => {
      if (!user?.id) return
      void loadSupporterDataFromDb(user.id).then(({ data }) => {
        if (alive) setSupporterData(data)
      })
    }
    window.addEventListener('zk_mission_sync', handleSync)

    return () => {
      alive = false
      window.removeEventListener('zk_mission_sync', handleSync)
    }
  }, [authLoading, user?.id])

  // Verify returning ShrinkMe step completion directly against database records
  useEffect(() => {
    if (authLoading || !dbLoaded) return

    const isVerified = searchParams.get('verified') === 'true'
    if (!isVerified) return

    const missionParam = searchParams.get('mission') || searchParams.get('tier')
    const stepParam = Math.max(1, parseInt(searchParams.get('step') || '1', 10) || 1)
    const sessionToken = searchParams.get('session') || searchParams.get('t') || `${missionParam}_${stepParam}`

    const cleanUrlParams = () => {
      const cleanParams = new URLSearchParams(searchParams)
      cleanParams.delete('verified')
      cleanParams.delete('mission')
      cleanParams.delete('tier')
      cleanParams.delete('step')
      cleanParams.delete('session')
      cleanParams.delete('t')
      setSearchParams(cleanParams, { replace: true })
    }

    if (processingReturnRef.current === sessionToken) return
    processingReturnRef.current = sessionToken

    if (supporterData.claimedTokens.includes(sessionToken)) {
      cleanUrlParams()
      return
    }

    const missionObj = SUPPORT_MISSIONS.find((m) => m.id === missionParam) || activeMission
    const totalMissionSteps = missionObj.steps
    const prevCompleted =
      supporterData.activeMission?.missionId === missionObj.id
        ? supporterData.activeMission.completedSteps
        : 0

    const newCompleted = Math.min(prevCompleted + 1, totalMissionSteps)
    const isMissionFinished = newCompleted >= totalMissionSteps
    const updatedTokens = [...supporterData.claimedTokens, sessionToken].slice(-120)

    if (isMissionFinished) {
      const xpGained = missionObj.xp
      const nextData: SupporterData = {
        stats: {
          completedCount: supporterData.stats.completedCount + 1,
          totalLinksSolved: supporterData.stats.totalLinksSolved + 1,
          totalXp: supporterData.stats.totalXp + xpGained,
          lastCompletedAt: Date.now(),
        },
        activeMission: null,
        claimedTokens: updatedTokens,
      }

      setCurrentStepUrl(null)
      setSelectedMissionId(missionObj.id)
      setFullMissionCelebration({ mission: missionObj, xpGained })
      void persistSupporterData(nextData).then((savedOk) => {
        if (savedOk) {
          toast(`Mission Completed: ${missionObj.title}! Saved to database (+${xpGained} XP).`, 'success')
        } else if (!user?.id) {
          toast(`Mission Completed! Sign in to store your +${xpGained} XP in the database.`, 'info')
        }
      })
    } else {
      const nextStepNum = newCompleted + 1
      const nextActiveMission: SupporterDbActiveMission = {
        missionId: missionObj.id,
        totalSteps: totalMissionSteps,
        completedSteps: newCompleted,
        currentStep: nextStepNum,
        stepSessions: {
          ...(supporterData.activeMission?.missionId === missionObj.id
            ? supporterData.activeMission.stepSessions
            : {}),
          [stepParam]: {
            sessionId: sessionToken,
            verifiedAt: Date.now(),
          },
        },
        updatedAt: Date.now(),
      }

      const nextData: SupporterData = {
        stats: {
          ...supporterData.stats,
          totalLinksSolved: supporterData.stats.totalLinksSolved + 1,
          lastCompletedAt: Date.now(),
        },
        activeMission: nextActiveMission,
        claimedTokens: updatedTokens,
      }

      setCurrentStepUrl(null)
      setSelectedMissionId(missionObj.id)
      setJustCompletedStep(newCompleted)
      void persistSupporterData(nextData).then((savedOk) => {
        if (savedOk) {
          toast(`Step ${newCompleted}/${totalMissionSteps} saved to database! Step ${nextStepNum} ready.`, 'success')
        } else if (!user?.id) {
          toast(`Step ${newCompleted}/${totalMissionSteps} verified! Sign in to keep progress in DB.`, 'info')
        }
      })
    }

    cleanUrlParams()
  }, [
    authLoading,
    dbLoaded,
    searchParams,
    setSearchParams,
    supporterData,
    activeMission,
    user?.id,
    persistSupporterData,
  ])

  const handleGenerateStepLink = async () => {
    if (generatingStep) return
    setGeneratingStep(true)

    const mission = activeMission
    const stepNumber = effectiveCurrentStep
    const sessionId = `zk_${mission.id}_s${stepNumber}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

    const origin =
      typeof window !== 'undefined' &&
      !window.location.hostname.includes('localhost') &&
      !window.location.hostname.includes('127.0.0.1')
        ? window.location.origin
        : import.meta.env.VITE_SITE_URL || 'https://animestream.pages.dev'

    const returnUrl = `${origin.replace(/\/+$/, '')}/support?verified=true&mission=${mission.id}&step=${stepNumber}&session=${sessionId}`

    try {
      let shortUrl: string | null = null

      try {
        const proxyResp = await fetch(`/api/support/shorten?url=${encodeURIComponent(returnUrl)}`, {
          signal: AbortSignal.timeout(8000),
        })
        if (proxyResp.ok) {
          const pData = await proxyResp.json()
          if (pData?.shortenedUrl) {
            shortUrl = pData.shortenedUrl
          }
        }
      } catch {}

      if (!shortUrl) {
        const directResp = await fetch(
          `${SHRINKME_API_ENDPOINT}?api=${encodeURIComponent(SHRINKME_API_KEY)}&url=${encodeURIComponent(returnUrl)}`,
          { signal: AbortSignal.timeout(10000) },
        )
        if (directResp.ok) {
          const dData = await directResp.json()
          if (dData?.status === 'success' && dData?.shortenedUrl) {
            shortUrl = dData.shortenedUrl
          }
        }
      }

      if (shortUrl) {
        setCurrentStepUrl(shortUrl)

        const updatedProgress: SupporterDbActiveMission = {
          missionId: mission.id,
          totalSteps: mission.steps,
          completedSteps: effectiveCompletedSteps,
          currentStep: stepNumber,
          stepSessions: {
            ...(activeProgress?.missionId === mission.id ? activeProgress.stepSessions : {}),
            [stepNumber]: {
              sessionId,
              url: shortUrl,
            },
          },
          updatedAt: Date.now(),
        }

        await persistSupporterData({
          ...supporterData,
          activeMission: updatedProgress,
        })

        toast(`Step ${stepNumber} link ready! Solve to advance.`, 'info')
      } else {
        toast('Could not generate link right now. Please try again.', 'error')
      }
    } catch {
      toast('Network error creating step link. Please check your connection and retry.', 'error')
    } finally {
      setGeneratingStep(false)
    }
  }

  const handleCopyStepLink = async () => {
    if (!currentStepUrl) return
    try {
      await navigator.clipboard.writeText(currentStepUrl)
      setCopiedLink(true)
      toast('Step link copied to clipboard!', 'success')
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      toast('Failed to copy. Please open the link directly.', 'error')
    }
  }

  const handleResetProgress = async () => {
    setCurrentStepUrl(null)
    setJustCompletedStep(null)
    await persistSupporterData({
      ...supporterData,
      activeMission: null,
    })
    toast('Mission progress cleared in database.', 'info')
  }

  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-28 pt-8 sm:px-6 lg:px-8 lg:pt-12">
      {/* Ambient background glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 left-1/2 h-80 w-[38rem] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl"
      />

      {/* Header Banner */}
      <header className="relative text-center">
        <motion.span
          animate={{ scale: [1, 1.1, 1, 1.1, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 2 }}
          className="inline-flex size-12 items-center justify-center rounded-2xl bg-accent/15 text-accent shadow-lg shadow-accent/25"
        >
          <Heart className="size-6 fill-current" />
        </motion.span>
        <h1 className="mt-4 font-display text-3xl font-black tracking-tight text-foreground sm:text-4xl lg:text-5xl">
          Support AnimeStream
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          AnimeStream is 100% free with zero paywalls. You directly keep our high-speed streaming CDN, dubbing sync, and video clusters alive by completing quick sponsor links.
        </p>

        {/* Supporter Infrastructure & Rank Ribbon */}
        <div className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-3">
          <div className={cn('inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-xs font-bold', rank.color)}>
            <Trophy className="size-3.5" />
            <span>{rank.title}</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1 text-xs font-semibold text-foreground">
            <CheckCircle2 className="size-3.5 text-emerald-400" />
            <span>Total Steps Solved: {stats.totalLinksSolved}</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1 text-xs font-semibold text-foreground">
            <Flame className="size-3.5 text-accent" />
            <span>Supporter XP: {stats.totalXp} XP</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-bold text-emerald-400">
            <Database className="size-3.5" />
            <span>
              {syncingDb
                ? 'Saving to Database…'
                : user
                  ? 'Synced to Database'
                  : 'Database Storage (Sign In)'}
            </span>
          </div>
        </div>
      </header>

      {/* Sign-in Prompt for Direct Database Persistence if Guest */}
      {!authLoading && !user && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs">
          <div className="flex items-center gap-2.5">
            <Database className="size-4 shrink-0 text-amber-400" />
            <p className="text-amber-100/90">
              Sign in so every mission step, Supporter XP, and rank saves directly in our cloud database across all your devices.
            </p>
          </div>
          <Link
            to="/profile"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-1.5 font-bold text-black transition hover:brightness-110 active:scale-95"
          >
            <LogIn className="size-3.5" />
            <span>Sign In</span>
          </Link>
        </div>
      )}

      {/* Step Verified Banner */}
      <AnimatePresence>
        {justCompletedStep !== null && !fullMissionCelebration && (
          <motion.div
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            className="relative mt-8 overflow-hidden rounded-3xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center sm:p-6"
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400">
              <Check className="size-6 stroke-[3]" />
            </div>
            <h2 className="mt-3 font-display text-lg font-bold text-emerald-300 sm:text-xl">
              Step {justCompletedStep} Successfully Verified!
            </h2>
            <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-emerald-200/80 sm:text-sm">
              Your link progress is saved in your database profile. You can now solve the next step to finish the mission!
            </p>
            <button
              type="button"
              onClick={() => setJustCompletedStep(null)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white transition active:scale-95"
            >
              Continue to Step {effectiveCurrentStep}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Mission Celebration Modal */}
      <AnimatePresence>
        {fullMissionCelebration && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative mt-8 overflow-hidden rounded-3xl border border-accent/40 bg-gradient-to-br from-accent/20 via-card to-card p-6 text-center shadow-2xl shadow-accent/20 sm:p-8"
          >
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-lg shadow-accent/30">
              <Trophy className="size-7" />
            </div>
            <span className="mt-3 inline-block rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-accent">
              Mission Accomplished
            </span>
            <h2 className="mt-2 font-display text-2xl font-black text-foreground sm:text-3xl">
              {fullMissionCelebration.mission.title} Completed!
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-muted sm:text-sm">
              Thank you for being a true pillar of the anime community! Your {fullMissionCelebration.mission.steps}-step completion directly powers high-speed buffer-free video mirrors. You earned +{fullMissionCelebration.xpGained} XP!
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setFullMissionCelebration(null)}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-95"
              >
                <span>Done &amp; Continue Watching</span>
                <ArrowRight className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setFullMissionCelebration(null)
                  void shareLink('Support AnimeStream', 'I just supported AnimeStream to keep anime & donghua 100% free with multi-dubs in HD!')
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted transition hover:text-foreground active:scale-95"
              >
                <Share2 className="size-4" />
                <span>Share with Friends</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Grid: Mission Selector & Active Step Detector Cockpit */}
      <div className="mt-10 grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-10">
        {/* Left Column: Mission Selectors & Detector (7 Cols) */}
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-3xl border border-border/80 bg-card p-5 shadow-2xl shadow-black/40 sm:p-7">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-accent/15 text-accent">
                  <Zap className="size-5" />
                </span>
                <div>
                  <h2 className="font-display text-base font-bold sm:text-lg">Support Missions</h2>
                  <p className="text-xs text-muted">Pick a tier to complete quick sponsor shortener steps</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
                <Globe className="size-3.5" /> High-Speed Shortener
              </span>
            </div>

            {/* Mission Selection Cards */}
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-muted">
                  Select Support Mission
                </label>
                {isInProgress && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-accent">
                    <span className="size-2 animate-ping rounded-full bg-accent" />
                    In Progress: Step {effectiveCurrentStep}/{activeMission.steps}
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {SUPPORT_MISSIONS.map((m) => {
                  const isSelected = m.id === selectedMissionId
                  const isThisMissionActive = activeProgress?.missionId === m.id
                  const isFinished = isThisMissionActive && activeProgress?.completedSteps === m.steps

                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setSelectedMissionId(m.id)
                        const savedUrl =
                          activeProgress?.missionId === m.id
                            ? activeProgress.stepSessions?.[activeProgress.currentStep]?.url || null
                            : null
                        setCurrentStepUrl(savedUrl)
                      }}
                      className={cn(
                        'relative flex flex-col justify-between rounded-2xl border p-4 text-left transition select-none',
                        isSelected
                          ? 'border-accent bg-accent/10 ring-1 ring-accent/40 shadow-md shadow-accent/10'
                          : 'border-border/60 bg-white/[0.02] hover:border-border hover:bg-white/[0.04]',
                      )}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-display text-sm font-black text-foreground">{m.title}</span>
                          {m.popular && (
                            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[9px] font-extrabold uppercase text-accent">
                              Popular
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-[11px] leading-relaxed text-muted line-clamp-3">{m.desc}</p>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-2.5 text-xs font-semibold">
                        <span className="rounded-md bg-white/10 px-2 py-0.5 font-bold text-foreground">
                          {m.badge}
                        </span>
                        <span className="text-accent font-bold">+{m.xp} XP</span>
                      </div>

                      {isThisMissionActive && (
                        <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                          <CheckCircle2 className="size-3" />
                          <span>
                            {isFinished ? 'Completed' : `${activeProgress.completedSteps}/${m.steps} Steps Done`}
                          </span>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Active Multi-Step Progress Tracker */}
            <div className="mt-7 rounded-2xl border border-border/80 bg-black/40 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-base font-bold text-foreground">
                      {activeMission.title}
                    </h3>
                    <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-accent">
                      {activeMission.steps} {activeMission.steps === 1 ? 'Step' : 'Steps'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {!dbLoaded && user
                      ? 'Loading saved mission progress from database…'
                      : isInProgress
                        ? `Step ${effectiveCurrentStep} of ${activeMission.steps} is currently active (${progressPercent}% completed).`
                        : `Solve ${activeMission.steps} shortener ${activeMission.steps === 1 ? 'link' : 'links'} to complete this mission.`}
                  </p>
                  {isInProgress && (
                    <div className="mt-2.5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full bg-gradient-to-r from-accent to-emerald-400 transition-all duration-500 ease-out"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  )}
                </div>

                {isInProgress && (
                  <button
                    type="button"
                    onClick={() => void handleResetProgress()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:bg-rose-500/10 hover:text-rose-400 active:scale-95"
                    title="Reset current mission progress"
                  >
                    <RotateCcw className="size-3" />
                    <span>Reset Progress</span>
                  </button>
                )}
              </div>

              {/* Visual Step Nodes Stepper */}
              <div className="mt-5">
                <div className="flex items-center justify-between gap-1 sm:gap-2">
                  {Array.from({ length: activeMission.steps }, (_, idx) => {
                    const stepNum = idx + 1
                    const isDone = effectiveCompletedSteps >= stepNum
                    const isCurrent = effectiveCurrentStep === stepNum && !isDone
                    const isLocked = stepNum > effectiveCurrentStep

                    return (
                      <div key={stepNum} className="flex flex-1 items-center gap-1 sm:gap-2">
                        <div
                          className={cn(
                            'relative flex size-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold transition sm:size-9',
                            isDone
                              ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                              : isCurrent
                                ? 'border-2 border-accent bg-accent/20 text-accent ring-2 ring-accent/30 animate-pulse'
                                : 'border border-border bg-card-2 text-muted opacity-60',
                          )}
                        >
                          {isDone ? (
                            <Check className="size-4 stroke-[3]" />
                          ) : isLocked ? (
                            <Lock className="size-3.5" />
                          ) : (
                            <span>{stepNum}</span>
                          )}
                        </div>

                        {idx < activeMission.steps - 1 && (
                          <div
                            className={cn(
                              'h-1 flex-1 rounded-full transition',
                              isDone ? 'bg-emerald-500' : 'bg-white/10',
                            )}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Stepper Labels */}
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                  <span>Step 1: Initiation</span>
                  {activeMission.steps === 3 && <span>Step 2: Sync</span>}
                  {activeMission.steps === 6 && <span>Step 3: Edge Route</span>}
                  <span>
                    Step {activeMission.steps}: Final {activeMission.steps === 1 ? 'Verification' : 'Reward'}
                  </span>
                </div>
              </div>

              {/* Interactive Step Action Box */}
              <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
                {!currentStepUrl ? (
                  <div className="flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
                    <div>
                      <h4 className="font-display text-sm font-bold text-foreground">
                        Ready for Step {effectiveCurrentStep} of {activeMission.steps}?
                      </h4>
                      <p className="mt-0.5 text-xs text-muted">
                        Click below to generate the secure ShrinkMe verification link for Step {effectiveCurrentStep}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleGenerateStepLink()}
                      disabled={generatingStep}
                      className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-95 disabled:opacity-50"
                    >
                      {generatingStep ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          <span>Generating Step {effectiveCurrentStep}…</span>
                        </>
                      ) : (
                        <>
                          <span>Start Step {effectiveCurrentStep}</span>
                          <ArrowRight className="size-4" />
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="size-2 animate-ping rounded-full bg-emerald-400" />
                        <span className="text-xs font-bold text-emerald-400">
                          Step {effectiveCurrentStep} Sponsor Link Active!
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-muted">
                        Progress: {effectiveCompletedSteps}/{activeMission.steps} Done
                      </span>
                    </div>

                    {/* Link display & copy */}
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-black/60 p-2 sm:p-2.5">
                      <input
                        type="text"
                        readOnly
                        value={currentStepUrl}
                        className="min-w-0 flex-1 select-all bg-transparent font-mono text-xs text-foreground outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCopyStepLink()}
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition active:scale-95',
                          copiedLink ? 'bg-emerald-500 text-white' : 'bg-white/10 hover:bg-white/20 text-foreground',
                        )}
                      >
                        {copiedLink ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <a
                        href={currentStepUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-xs font-bold text-accent-fg shadow-lg shadow-accent/30 transition hover:brightness-110 active:scale-95 sm:text-sm"
                      >
                        <span>Open &amp; Complete Step {effectiveCurrentStep} on ShrinkMe</span>
                        <ExternalLink className="size-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() => void handleGenerateStepLink()}
                        disabled={generatingStep}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3.5 py-3 text-xs font-semibold text-muted transition hover:text-foreground active:scale-95"
                        title="Generate a fresh link for this step"
                      >
                        <RefreshCw className={cn('size-3.5', generatingStep && 'animate-spin')} />
                        <span>Regenerate</span>
                      </button>
                    </div>

                    {/* Instructions */}
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200/90">
                      <p className="font-semibold text-amber-200">How Step Verification Works:</p>
                      <p className="mt-0.5 text-[11px] text-amber-200/80">
                        1. Solve the captcha and wait for countdown on ShrinkMe. 2. Click &ldquo;Get Link&rdquo;. 3. You will automatically return here with Step {effectiveCurrentStep} verified and saved in our database!
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Server Upkeep & Community Impact (5 Cols) */}
        <div className="space-y-6 lg:col-span-5">
          {/* Mission Impact Highlights */}
          <div className="rounded-3xl border border-border/80 bg-card p-5 shadow-2xl shadow-black/40 sm:p-7">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold text-foreground">
                Community Infrastructure Upkeep
              </h3>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                <ShieldCheck className="size-3.5" /> Operational
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Here is how your sponsor link completions directly protect our service:
            </p>

            <div className="mt-5 space-y-4">
              {INFRASTRUCTURE_PILLARS.map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.title} className="flex items-start gap-3.5 rounded-2xl border border-white/5 bg-white/[0.02] p-3.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
                      <Icon className="size-4" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-foreground">{item.title}</h4>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{item.desc}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Supporter Milestones */}
          <div className="rounded-3xl border border-border/80 bg-card p-5 shadow-2xl shadow-black/40 sm:p-7">
            <div className="flex items-center justify-between border-b border-border/60 pb-4">
              <h3 className="font-display text-base font-bold text-foreground">Supporter Tiers</h3>
              <span className="text-xs font-semibold text-accent">Permanent Recognition</span>
            </div>

            <div className="mt-4 space-y-2.5">
              {[
                { title: 'Bronze Booster', count: '1 Step', color: 'border-orange-500/30 text-orange-400 bg-orange-500/10' },
                { title: 'Silver Supporter', count: '2 Steps', color: 'border-slate-400/30 text-slate-300 bg-slate-400/10' },
                { title: 'Gold Sponsor', count: '6 Steps', color: 'border-amber-500/30 text-amber-400 bg-amber-500/10' },
                { title: 'Diamond Patron', count: '12 Steps', color: 'border-sky-500/30 text-sky-400 bg-sky-500/10' },
                { title: 'Sovereign Pillar', count: '24 Steps', color: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10' },
              ].map((tier) => {
                const unlocked = stats.totalLinksSolved >= parseInt(tier.count, 10)
                return (
                  <div
                    key={tier.title}
                    className={cn(
                      'flex items-center justify-between rounded-xl border p-2.5 text-xs transition',
                      unlocked ? tier.color : 'border-border/60 bg-white/[0.02] text-muted opacity-60',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {unlocked ? <Check className="size-3.5 stroke-[3]" /> : <Lock className="size-3.5" />}
                      <span className="font-bold">{tier.title}</span>
                    </div>
                    <span className="font-mono text-[11px] font-semibold">{tier.count}</span>
                  </div>
                )
              })}
            </div>

            {/* Quick Share Action */}
            <div className="mt-6 border-t border-border/60 pt-4">
              <button
                type="button"
                onClick={() =>
                  void shareLink(
                    'Support AnimeStream',
                    'Support AnimeStream for free and help keep high-speed multi-audio anime streaming online!',
                  )
                }
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-card-2 py-2.5 text-xs font-bold text-foreground transition hover:bg-white/10 active:scale-95"
              >
                <Share2 className="size-3.5" />
                <span>Invite Friends to Support</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
