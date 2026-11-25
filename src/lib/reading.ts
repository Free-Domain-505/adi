import { useSyncExternalStore } from 'react'
import { autoSyncWatchlist } from './sync'

/**
 * In-memory reading library for novels and manga synced with Supabase (no user data persisted in localStorage).
 */
export type ReadKind = 'novel' | 'manga'

export interface ReadingItem {
  kind: ReadKind
  /** novel: `${source}:${slug}`; manga: worker id */
  id: string
  title: string
  cover: string
  /** link to the details page */
  href: string
  /** link that resumes reading */
  resume: string
  /** human label, e.g. "Chapter 12" */
  label: string
  /** 0..1 within the chapter */
  progress: number
  t: number
}

const MAX = 30

let snap: ReadingItem[] = []
let prefsStore: Record<string, unknown> = {}
const subs = new Set<() => void>()
const notify = () => subs.forEach((f) => f())

function read(): ReadingItem[] {
  return snap
}

function write(next: ReadingItem[]) {
  snap = next
  notify()
}

export function getAllReading(): ReadingItem[] {
  return snap
}

export function setAllReading(next: ReadingItem[]) {
  snap = Array.isArray(next) ? next : []
  notify()
}

export function resetReading() {
  snap = []
  prefsStore = {}
  notify()
}

export function getAllReaderPrefs(): Record<string, unknown> {
  return prefsStore
}

export function setAllReaderPrefs(next: Record<string, unknown>) {
  prefsStore = next && typeof next === 'object' ? { ...next } : {}
}

export function saveReading(item: Omit<ReadingItem, 't'>) {
  const rest = read().filter((x) => !(x.kind === item.kind && x.id === item.id))
  write([{ ...item, t: Date.now() }, ...rest].slice(0, MAX))
  autoSyncWatchlist()
}

export function removeReading(kind: ReadKind, id: string) {
  write(read().filter((x) => !(x.kind === kind && x.id === id)))
  autoSyncWatchlist()
}

export function getReading(kind: ReadKind, id: string): ReadingItem | undefined {
  return read().find((x) => x.kind === kind && x.id === id)
}

export function useReading(kind?: ReadKind): ReadingItem[] {
  const all = useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    read,
    () => [],
  )
  return kind ? all.filter((x) => x.kind === kind) : all
}

/* ---------------- reader preferences ---------------- */
export interface NovelPrefs {
  theme: 'dark' | 'sepia' | 'light' | 'black'
  font: 'serif' | 'sans'
  size: number // px
  line: number // line-height
  width: 'narrow' | 'normal' | 'wide'
}
export interface MangaPrefs {
  mode: 'webtoon' | 'ltr' | 'rtl'
  fit: 'width' | 'height' | 'original'
  bg: 'black' | 'dark' | 'light' | 'sepia'
  /** page dimming, 40..100 (%) */
  brightness: number
  /** webtoon column width */
  width: 'narrow' | 'medium' | 'wide' | 'full'
  /** space between pages in webtoon mode */
  gap: 'none' | 'small' | 'large'
  /** tap the screen edges to turn pages (paged modes) */
  tapZones: boolean
  /** swap which edge goes forward */
  invertTap: boolean
  /** show info/progress bar */
  infoBar: boolean
  /** show a small page counter while the bars are hidden */
  pageBadge: boolean
  /** keep the screen on while reading */
  keepAwake: boolean
  /** go to the next chapter by itself at the end (paged modes) */
  autoNext: boolean
  /** auto scroll speed in webtoon mode, 1..10 */
  autoSpeed: number
  /** seconds per page for auto page turning in paged modes, 2..30 */
  autoSecs: number
  /** greyscale pages */
  grayscale: boolean
}

export const DEFAULT_NOVEL: NovelPrefs = { theme: 'dark', font: 'serif', size: 19, line: 1.85, width: 'normal' }
export const DEFAULT_MANGA: MangaPrefs = {
  mode: 'webtoon',
  fit: 'width',
  bg: 'black',
  brightness: 100,
  width: 'medium',
  gap: 'none',
  tapZones: true,
  invertTap: false,
  infoBar: true,
  pageBadge: true,
  keepAwake: false,
  autoNext: false,
  autoSpeed: 4,
  autoSecs: 8,
  grayscale: false,
}

export function loadPrefs<T extends object>(key: string, fallback: T): T {
  const saved = prefsStore[key]
  if (saved && typeof saved === 'object') {
    return { ...fallback, ...(saved as Partial<T>) }
  }
  return fallback
}
export function savePrefs<T>(key: string, v: T) {
  prefsStore = { ...prefsStore, [key]: v }
  autoSyncWatchlist()
}
