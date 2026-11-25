// Embed provider registry + URL builder. Runs in the browser: zero Worker requests.
type SearchType  = 'tmdb' | 'anilist';
type ContentType = 'movie' | 'tv' | 'anime';

type Tag = 'Multi audio' | '4K' | 'Direct';

interface ProviderDef {
  id:             string;
  label:          string;
  searchType:     SearchType;
  contentTypes:   ContentType[];
  priority:       number;
  /** badges shown next to the server name */
  tags?: Tag[];
  movieUrl?:      (id: number | string, lang?: string) => string;
  tvUrl?:         (id: number | string, s: number, e: number, lang?: string) => string;
  animeUrl?:      (id: number | string, ep: number, lang?: string) => string;
}

const PROVIDER_DEFS: ProviderDef[] = [
  { id: 'cinemaos', label: 'CinemaOS', searchType: 'tmdb', contentTypes: ['movie', 'tv', 'anime'], priority: 1, tags: ['Multi audio'], movieUrl: (id, lang = 'en') => `https://cinemaos.tech/player/${id}?lang=${lang}`, tvUrl: (id, s, e, lang = 'en') => `https://cinemaos.tech/player/${id}/${s}/${e}?lang=${lang}`, animeUrl: (id, ep, lang = 'en') => `https://cinemaos.tech/player/${id}/1/${ep}?lang=${lang}` },
  { id: 'vidzee', label: 'Vidzee', searchType: 'tmdb', contentTypes: ['movie', 'tv', 'anime'], priority: 2, tags: ['Multi audio'], movieUrl: (id) => `https://player.vidzee.wtf/embed/movie/${id}`, tvUrl: (id, s, e) => `https://player.vidzee.wtf/embed/tv/${id}/${s}/${e}`, animeUrl: (id, ep) => `https://player.vidzee.wtf/embed/tv/${id}/1/${ep}` },
  { id: 'moviebox', label: 'MovieBox Direct', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 99, tags: ['Direct', 'Multi audio'], movieUrl: (id) => `/api/movies/stream?id=${id}&type=movie`, tvUrl: (id, s, e) => `/api/movies/stream?id=${id}&type=tv&s=${s}&e=${e}` },
  { id: 'vidup', label: 'VidUp', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 3, movieUrl: (id) => `https://vidup.to/movie/${id}?server=zenith`, tvUrl: (id, s, e) => `https://vidup.to/tv/${id}/${s}/${e}?server=zenith` },
  { id: 'vidfast', label: 'VidFast', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 4, tags: ['4K'], movieUrl: (id) => `https://vidfast.pro/movie/${id}`, tvUrl: (id, s, e) => `https://vidfast.pro/tv/${id}/${s}/${e}` },
  { id: 'primesrc', label: 'PrimeSrc', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 5, movieUrl: (id) => `https://primesrc.me/embed/movie?tmdb=${id}`, tvUrl: (id, s, e) => `https://primesrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}&fallback=false&serverOrder=PrimeVid,Voe,Dood` },
  { id: 'vidlove', label: 'VidLove', searchType: 'tmdb', contentTypes: ['movie', 'tv', 'anime'], priority: 6, movieUrl: (id) => `https://player.vidlove.cc/embed/movie/${id}`, tvUrl: (id, s, e) => `https://player.vidlove.cc/embed/tv/${id}/${s}/${e}`, animeUrl: (id, ep) => `https://player.vidlove.cc/embed/tv/${id}/1/${ep}` },
  { id: '1embed', label: '1Embed', searchType: 'tmdb', contentTypes: ['movie', 'tv', 'anime'], priority: 7, movieUrl: (id) => `https://1embed.cc/embed/movie/${id}`, tvUrl: (id, s, e) => `https://1embed.cc/embed/tv/${id}/${s}/${e}`, animeUrl: (id, ep) => `https://1embed.cc/embed/tv/${id}/1/${ep}` },
  { id: 'vidcore', label: 'VidCore', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 9, movieUrl: (id) => `https://vidcore.net/movie/${id}?server=Crystal&autoPlay=true`, tvUrl: (id, s, e) => `https://vidcore.net/tv/${id}/${s}/${e}?server=Crystal&autoPlay=true` },
  { id: 'cinesrc', label: 'CineSrc', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 10, movieUrl: (id) => `https://cinesrc.st/embed/movie/${id}`, tvUrl: (id, s, e) => `https://cinesrc.st/embed/tv/${id}/${s}/${e}` },
  { id: 'nontongo', label: 'NontonGo', searchType: 'tmdb', contentTypes: ['movie'], priority: 11, movieUrl: (id) => `https://www.nontongo.win/embed/movie/${id}` },
  { id: 'vidnest-tv', label: 'VidNest', searchType: 'tmdb', contentTypes: ['tv'], priority: 12, tvUrl: (id, s, e) => `https://vidnest.fun/tv/${id}/${s}/${e}` },
  // Existing AnimeStream anime providers remain unchanged.
  { id: 'megaplay-dub', label: 'MegaPlay Dub', searchType: 'anilist', contentTypes: ['anime'], priority: 1, animeUrl: (id, ep) => `https://megaplay.buzz/stream/ani/${id}/${ep}/dub` },
  { id: 'megaplay-sub', label: 'MegaPlay Sub', searchType: 'anilist', contentTypes: ['anime'], priority: 2, animeUrl: (id, ep) => `https://megaplay.buzz/stream/ani/${id}/${ep}/sub` },
  { id: 'vidnest-sub', label: 'VidNest Sub', searchType: 'anilist', contentTypes: ['anime'], priority: 3, animeUrl: (id, ep) => `https://vidnest.fun/anime/${id}/${ep}/sub` },
  { id: 'vidnest-dub', label: 'VidNest Dub', searchType: 'anilist', contentTypes: ['anime'], priority: 4, animeUrl: (id, ep) => `https://vidnest.fun/anime/${id}/${ep}/dub` },
  { id: 'vidnest-hindi', label: 'VidNest Hindi', searchType: 'anilist', contentTypes: ['anime'], priority: 5, animeUrl: (id, ep) => `https://vidnest.fun/anime/${id}/${ep}/hindi` },
  { id: 'vidnest-pahe-sub', label: 'AnimePahe Sub', searchType: 'anilist', contentTypes: ['anime'], priority: 6, animeUrl: (id, ep) => `https://vidnest.fun/animepahe/${id}/${ep}/sub` },
  { id: 'vidnest-pahe-dub', label: 'AnimePahe Dub', searchType: 'anilist', contentTypes: ['anime'], priority: 7, animeUrl: (id, ep) => `https://vidnest.fun/animepahe/${id}/${ep}/dub` },
];

function getProviders(ct: ContentType): ProviderDef[] {
  return PROVIDER_DEFS.filter(p => p.contentTypes.includes(ct)).sort((a, b) => a.priority - b.priority);
}

function buildUrl(
  p: ProviderDef,
  tmdbId: number,
  anilistId: number | null,
  ct: ContentType,
  s: number,
  e: number,
  lang?: string,
): string {
  const id = p.searchType === 'anilist' ? (anilistId ?? tmdbId) : tmdbId;
  if (ct === 'movie' && p.movieUrl) return p.movieUrl(id, lang);
  if (ct === 'anime' && p.animeUrl) return p.animeUrl(id, e, lang);
  if (ct === 'tv'    && p.tvUrl)    return p.tvUrl(id, s, e, lang);
  if (p.tvUrl)    return p.tvUrl(id, s, e, lang);
  if (p.movieUrl) return p.movieUrl(id, lang);
  return '';
}

// Public-safe shape — only what the UI needs to render provider buttons.
function publicMeta(p: ProviderDef) {
  return { id: p.id, label: p.label, tags: p.tags ?? [] };
}

export const listProviders = (ct: ContentType) => getProviders(ct).map(publicMeta);

export function providerUrl(id: string, ct: ContentType, tmdbId: number, s: number, e: number): string {
  const p = PROVIDER_DEFS.find((d) => d.id === id);
  return p ? buildUrl(p, tmdbId, null, ct, s, e, 'en') : '';
}
