import type { IdMapping } from '../types';

export interface AnimeEmbedServer {
  id: string;
  name: string;
  note: string;
  language: 'english';
  supportsHindiHint?: boolean;
  buildUrl: (ctx: {
    tmdbId: number;
    episode: number;
    season?: number;
    ids: IdMapping;
    isMovie?: boolean;
    language?: 'hindi' | 'english';
  }) => string | null;
}

// TMDB-backed cross-origin embed servers (no provider branding exposed in UI)
export const ANIME_ENGLISH_SERVERS: AnimeEmbedServer[] = [
  {
    id: 'srv-1',
    name: 'SERVER 1',
    note: 'Primary HD Stream',
    language: 'english',
    buildUrl: ({ tmdbId, episode, season = 1, ids, isMovie }) => {
      const ref = ids.themoviedb || tmdbId || ids.imdb;
      if (!ref) return null;
      return isMovie
        ? `https://vidlink.pro/movie/${ref}?primaryColor=38bdf8`
        : `https://vidlink.pro/tv/${ref}/${season}/${episode}?primaryColor=38bdf8`;
    },
  },
  {
    id: 'srv-2',
    name: 'SERVER 2',
    note: 'Fast Multi-Audio Stream',
    language: 'english',
    buildUrl: ({ tmdbId, episode, season = 1, ids, isMovie }) => {
      const ref = ids.themoviedb || tmdbId || ids.imdb;
      if (!ref) return null;
      return isMovie
        ? `https://www.2embed.cc/embed/${ref}`
        : `https://www.2embed.cc/embedtv/${ref}&s=${season}&e=${episode}`;
    },
  },
  {
    id: 'srv-3',
    name: 'SERVER 3',
    note: 'Cloud HD Multi-Audio Mirror',
    language: 'english',
    supportsHindiHint: true,
    buildUrl: ({ tmdbId, episode, season = 1, ids, isMovie, language }) => {
      const ref = ids.themoviedb || tmdbId || ids.imdb;
      if (!ref) return null;
      const langQs = language === 'hindi' ? '?lang=hi' : '';
      return isMovie
        ? `https://vidsrc.to/embed/movie/${ref}${langQs}`
        : `https://vidsrc.to/embed/tv/${ref}/${season}/${episode}${langQs}`;
    },
  },
  {
    id: 'srv-4',
    name: 'SERVER 4',
    note: 'Smooth Playback Mirror',
    language: 'english',
    buildUrl: ({ tmdbId, episode, season = 1, ids, isMovie }) => {
      const ref = ids.themoviedb || tmdbId || ids.imdb;
      if (!ref) return null;
      return isMovie
        ? `https://vidsrcme.ru/embed/movie/${ref}`
        : `https://vidsrcme.ru/embed/tv/${ref}/${season}/${episode}`;
    },
  },
  {
    id: 'srv-5',
    name: 'SERVER 5',
    note: 'Multi-Lang Backup Mirror',
    language: 'english',
    supportsHindiHint: true,
    buildUrl: ({ tmdbId, episode, season = 1, ids, isMovie }) => {
      const ref = ids.themoviedb || tmdbId || ids.imdb;
      if (!ref) return null;
      return isMovie
        ? `https://autoembed.co/movie/tmdb/${ref}`
        : `https://autoembed.co/tv/tmdb/${ref}-${season}-${episode}`;
    },
  },
];

export interface MovieEmbedServer {
  id: string;
  name: string;
  note: string;
  supportsHindiHint?: boolean;
  buildUrl: (ctx: {
    id: string;
    type: 'movie' | 'tv';
    season: number;
    episode: number;
    language: 'hindi' | 'english';
  }) => string;
}

export const MOVIE_SERVERS: MovieEmbedServer[] = [
  {
    id: 'vidsrc-to',
    name: 'SERVER 1',
    note: 'Hindi / Multi-Audio Mirror',
    supportsHindiHint: true,
    buildUrl: ({ id, type, season, episode, language }) =>
      type === 'movie'
        ? `https://vidsrc.to/embed/movie/${id}?lang=${language === 'hindi' ? 'hi' : 'en'}`
        : `https://vidsrc.to/embed/tv/${id}/${season}/${episode}?lang=${language === 'hindi' ? 'hi' : 'en'}`,
  },
  {
    id: 'vidlink-pro',
    name: 'SERVER 2',
    note: 'Multi-Audio HD Stream',
    supportsHindiHint: true,
    buildUrl: ({ id, type, season, episode }) =>
      type === 'movie'
        ? `https://vidlink.pro/movie/${id}?primaryColor=38bdf8`
        : `https://vidlink.pro/tv/${id}/${season}/${episode}?primaryColor=38bdf8`,
  },
  {
    id: 'autoembed',
    name: 'SERVER 3',
    note: 'Multi-Lang Backup',
    supportsHindiHint: true,
    buildUrl: ({ id, type, season, episode }) =>
      type === 'movie'
        ? `https://autoembed.co/movie/tmdb/${id}`
        : `https://autoembed.co/tv/tmdb/${id}-${season}-${episode}`,
  },
  {
    id: '2embed',
    name: 'SERVER 4',
    note: 'Primary HD Stream',
    buildUrl: ({ id, type, season, episode }) =>
      type === 'movie'
        ? `https://www.2embed.cc/embed/${id}`
        : `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${episode}`,
  },
  {
    id: 'vidsrc-me',
    name: 'SERVER 5',
    note: 'Dual Audio Mirror',
    buildUrl: ({ id, type, season, episode }) =>
      type === 'movie'
        ? `https://vidsrcme.ru/embed/movie/${id}`
        : `https://vidsrcme.ru/embed/tv/${id}/${season}/${episode}`,
  },
];
