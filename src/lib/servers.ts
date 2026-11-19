import type { IdMapping } from '../types';

export interface AnimeEmbedServer {
  id: string;
  name: string;
  note: string;
  language: 'english';
  buildUrl: (ctx: {
    anilistId: number;
    episode: number;
    ids: IdMapping;
    isMovie?: boolean;
  }) => string | null;
}

// Verified cross-origin embed-friendly servers (English Dub / Multi-Audio, Mobile + Desktop compatible)
export const ANIME_ENGLISH_SERVERS: AnimeEmbedServer[] = [
  {
    id: 'vidlink-ani',
    name: 'VidLink Fast HD',
    note: 'Multi-Audio (Hindi / Eng) · Fast Streaming',
    language: 'english',
    buildUrl: ({ anilistId, episode, ids, isMovie }) => {
      const ref = ids.themoviedb || ids.imdb;
      if (ref) {
        return isMovie
          ? `https://vidlink.pro/movie/${ref}`
          : `https://vidlink.pro/tv/${ref}/1/${episode}`;
      }
      return `https://vidlink.pro/tv/${anilistId}/1/${episode}`;
    },
  },
  {
    id: '2embed-ani',
    name: '2Embed HD',
    note: 'Hindi / English Audio · Ad-Clean',
    language: 'english',
    buildUrl: ({ episode, ids, isMovie }) => {
      const ref = ids.imdb || ids.themoviedb;
      if (!ref) return null;
      return isMovie
        ? `https://www.2embed.cc/embed/${ref}`
        : `https://www.2embed.cc/embedtv/${ref}&s=1&e=${episode}`;
    },
  },
  {
    id: 'vidsrc-ani',
    name: 'VidSrc Cloud',
    note: 'High Quality · Multi-Audio',
    language: 'english',
    buildUrl: ({ episode, ids, isMovie }) => {
      const ref = ids.themoviedb || ids.imdb;
      if (!ref) return null;
      return isMovie
        ? `https://vidsrc.to/embed/movie/${ref}`
        : `https://vidsrc.to/embed/tv/${ref}/1/${episode}`;
    },
  },
  {
    id: 'vidsrcme-ani',
    name: 'VidSrcRu Mirror',
    note: 'Dual Audio · Smooth Playback',
    language: 'english',
    buildUrl: ({ episode, ids, isMovie }) => {
      const ref = ids.imdb || ids.themoviedb;
      if (!ref) return null;
      return isMovie
        ? `https://vidsrcme.ru/embed/movie/${ref}`
        : `https://vidsrcme.ru/embed/tv/${ref}/1/${episode}`;
    },
  },
  {
    id: 'zokoanime-dub',
    name: 'ZokoAnime English',
    note: 'MAL Mirror · English Dub',
    language: 'english',
    buildUrl: ({ anilistId, episode, ids }) => {
      const malId = ids.myanimelist || anilistId;
      return `https://zokoanime.video/stream/mal/${malId}/${episode}/dub?color=f59e0b`;
    },
  },
  {
    id: 'megaplay-ani-dub',
    name: 'MegaPlay Cloud',
    note: 'English Dub Backup',
    language: 'english',
    buildUrl: ({ anilistId, episode }) =>
      `https://megaplay.buzz/stream/ani/${anilistId}/${episode}/dub`,
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

// Only xfo=null cross-origin iframe servers that play smoothly on Mobile & Desktop
export const MOVIE_SERVERS: MovieEmbedServer[] = [
  {
    id: '2embed',
    name: '2Embed HD',
    note: 'Primary · Hindi / English Audio',
    supportsHindiHint: true,
    buildUrl: ({ id, type, season, episode }) =>
      type === 'movie'
        ? `https://www.2embed.cc/embed/${id}`
        : `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${episode}`,
  },
  {
    id: 'vidlink-pro',
    name: 'VidLink Fast HD',
    note: 'Multi-Audio · Mobile & PC',
    buildUrl: ({ id, type, season, episode }) =>
      type === 'movie'
        ? `https://vidlink.pro/movie/${id}?primaryColor=f59e0b`
        : `https://vidlink.pro/tv/${id}/${season}/${episode}?primaryColor=f59e0b`,
  },
  {
    id: 'vidsrc-to',
    name: 'VidSrc Cloud',
    note: 'Hindi / English Audio Switcher',
    supportsHindiHint: true,
    buildUrl: ({ id, type, season, episode, language }) =>
      type === 'movie'
        ? `https://vidsrc.to/embed/movie/${id}?lang=${language === 'hindi' ? 'hi' : 'en'}`
        : `https://vidsrc.to/embed/tv/${id}/${season}/${episode}?lang=${language === 'hindi' ? 'hi' : 'en'}`,
  },
  {
    id: 'vidsrc-me',
    name: 'VidSrcRu Mirror',
    note: 'Dual Audio Mirror',
    buildUrl: ({ id, type, season, episode }) =>
      type === 'movie'
        ? `https://vidsrcme.ru/embed/movie/${id}`
        : `https://vidsrcme.ru/embed/tv/${id}/${season}/${episode}`,
  },
  {
    id: 'autoembed',
    name: 'AutoEmbed',
    note: 'Backup Stream',
    buildUrl: ({ id, type, season, episode, language }) =>
      type === 'movie'
        ? `https://player.autoembed.cc/embed/movie/${id}?lang=${language === 'hindi' ? 'hi' : 'en'}`
        : `https://player.autoembed.cc/embed/tv/${id}/${season}/${episode}?lang=${language === 'hindi' ? 'hi' : 'en'}`,
  },
];
