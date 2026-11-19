export type MediaFormat = 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC' | string;

export interface AnimeTitle {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
}

export interface AnimeMedia {
  id: number;
  idMal?: number | null;
  title: AnimeTitle;
  coverImage?: {
    extraLarge?: string | null;
    large?: string | null;
    color?: string | null;
  } | null;
  bannerImage?: string | null;
  logo?: string | null;
  seasons?: { number: number; name: string; episodes: number; poster?: string | null; anilistId?: number; malId?: number }[] | null;
  description?: string | null;
  format?: MediaFormat | null;
  status?: string | null;
  episodes?: number | null;
  duration?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
  popularity?: number | null;
  genres?: string[] | null;
  countryOfOrigin?: string | null;
  nextAiringEpisode?: {
    episode: number;
    airingAt: number;
    timeUntilAiring: number;
  } | null;
  trailer?: {
    id: string;
    site: string;
  } | null;
  studios?: {
    nodes: { id: number; name: string; isAnimationStudio?: boolean }[];
  } | null;
  characters?: {
    edges: {
      role: string;
      node: { id: number; name: { full: string }; image: { large: string } };
      voiceActors?: { id: number; name: { full: string }; image: { large: string }; languageV2?: string }[];
    }[];
  } | null;
  recommendations?: {
    nodes: {
      mediaRecommendation?: AnimeMedia | null;
    }[];
  } | null;
}

export interface AiringItem {
  id: number;
  episode: number;
  airingAt: number;
  media: AnimeMedia;
}

export interface EpisodeInfo {
  number: number;
  title: string;
  thumbnail: string | null;
  overview?: string | null;
}

export interface IdMapping {
  themoviedb?: number;
  imdb?: string;
}

export interface MangaItem {
  id: string;
  title: string;
  description?: string;
  cover: string;
  rawCover?: string;
  kind: 'Manga' | 'Manhwa' | 'Manhua' | string;
  originalLanguage?: string;
  status?: string;
  year?: number | null;
  lastChapter?: string | null;
  genres?: string[];
  author?: string | null;
  artist?: string | null;
}

export interface MangaChapter {
  id: string;
  chapter: string;
  volume?: string | null;
  title: string;
  pages: number;
  publishedAt?: string | null;
  group?: string;
}

export interface NovelItem {
  id: string;
  slug: string;
  title: string;
  cover: string;
  stats?: string;
  source: string;
}

export interface NovelChapter {
  slug: string;
  title: string;
  number: string;
  sourceUrl: string;
}

export interface NovelDetail {
  slug: string;
  title: string;
  author: string;
  cover: string;
  summary: string;
  genres: string[];
  status: string;
  chapters: NovelChapter[];
  sourceUrl: string;
}

export interface MovieItem {
  id: string;
  type: 'movie' | 'tv';
  title: string;
  description: string;
  poster: string;
  backdrop: string;
  logo?: string;
  year?: string | null;
  rating?: number | null;
  genres: string[];
  cast?: string[];
  runtime?: string | null;
  director?: string[];
  country?: string | null;
  awards?: string | null;
  videos?: {
    id: string;
    season: number;
    episode: number;
    title: string;
    overview?: string;
    thumbnail?: string;
    released?: string | null;
  }[];
}

export type WatchStatus = 'watching' | 'planning' | 'completed' | 'paused' | 'dropped';

export interface WatchlistEntry {
  key: string; // e.g. "anime:21" or "manga:uuid" or "movie:tt1375666"
  kind: 'anime' | 'donghua' | 'manga' | 'manhwa' | 'novel' | 'movie' | 'tv';
  id: string;
  title: string;
  image: string;
  href: string;
  status: WatchStatus;
  favorite?: boolean;
  progress?: number;
  total?: number | null;
  score?: number | null;
  updatedAt: number;
}

export interface HistoryEntry {
  key: string;
  kind: 'anime' | 'donghua' | 'manga' | 'manhwa' | 'novel' | 'movie' | 'tv';
  id: string;
  title: string;
  image: string;
  href: string;
  subtitle: string; // e.g. "Episode 12" or "Chapter 45" or "S1 · E3"
  episodeOrChapter?: string | number;
  season?: number;
  updatedAt: number;
}

export type SubscriptionPlan = 'monthly_25' | 'extra_2';

export interface UserSubscription {
  plan: SubscriptionPlan;
  amountInr: 25 | 2;
  status: 'pending' | 'active' | 'rejected' | 'expired';
  referenceNumber: string;
  screenshotName?: string;
  requestId?: string;
  adminNote?: string;
  startedAtMs: number;
  expiresAtMs: number;
  extraCredits?: number;
  extraApprovedAtMs?: number;
  updatedAt: number;
}

export interface PaymentRequest {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  plan: SubscriptionPlan;
  amountInr: 25 | 2;
  referenceNumber: string;
  screenshotName?: string;
  screenshotPreview?: string;
  confirmedPaid: boolean;
  status: 'pending' | 'approved' | 'rejected';
  adminNote?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DailyUsage {
  dateKey: string;
  watchedKeys: string[];
  updatedAt: number;
}

