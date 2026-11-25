import { useEffect, useState } from 'react'

export interface ChangelogItem {
  badge: string
  title: string
  description: string
}

export interface ReleaseData {
  version: string
  releaseDate: string
  title: string
  tagline: string
  githubUrl: string
  highlights: ChangelogItem[]
}

/** Offline fallback; the real notes come from the latest GitHub release of the web repo. */
export const CURRENT_RELEASE: ReleaseData = {
  version: '1.0',
  releaseDate: 'November 15, 2026',
  title: 'Welcome to AnimeStream v1.0',
  tagline: 'Stream anime in Sub & multi-audio Dub, watch movies, read manga, and host Watch Parties with friends.',
  githubUrl: '',
  highlights: [
    { badge: 'STREAMING', title: 'HD Anime & Multi-Audio Dub', description: 'Watch anime in Sub (Japanese) or multi-language Dub with preferred audio language selection and responsive touch controls.' },
    { badge: 'PARTY', title: 'Watch Together & Voice Chat', description: 'Create watch parties with synced playback, live reactions, text chat, and real-time voice calling.' },
    { badge: 'LIBRARY', title: 'Movies, Manga & Light Novels', description: 'Browse trending anime, movies, TV series, manga chapters, and light novels all in one place.' },
    { badge: 'PROFILE', title: 'Custom Profiles & Cloud Sync', description: 'Customize your anime PFP, animated frame, banner, and bio while syncing watchlists and progress across devices.' },
    { badge: 'SHARE', title: 'Instant Media Sharing', description: 'Share anime, movies, and watch party invites with rich preview cards in a single tap.' },
  ],
}

/* ---------- latest GitHub release -> ReleaseData ---------- */
export interface GhRelease {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  published_at: string | null
}
export function fetchLatestRelease(): Promise<ReleaseData> {
  return Promise.resolve(CURRENT_RELEASE)
}

export function useRelease(): { release: ReleaseData; ready: boolean } {
  const [s, set] = useState({ release: CURRENT_RELEASE, ready: false })
  useEffect(() => {
    let off = false
    void fetchLatestRelease().then((release) => !off && set({ release, ready: true }))
    return () => {
      off = true
    }
  }, [])
  return s
}

const STORAGE_KEY = 'zenkai_release_seen_version'
const EVENT_NAME = 'zenkai:changelog-toggle'

export function hasSeenLatestRelease(version = CURRENT_RELEASE.version): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(STORAGE_KEY) === version
  } catch {
    return true
  }
}

export function markReleaseSeen(version = CURRENT_RELEASE.version): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, version)
  } catch {}
}

export function openChangelog(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { open: true } }))
}

export function closeChangelog(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { open: false } }))
}

export function onChangelogToggle(callback: (open: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ open?: boolean }>
    callback(Boolean(custom.detail?.open))
  }
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}

