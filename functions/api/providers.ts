// api/providers.ts
// Server-side provider registry + URL resolver.
// Provider domains/templates live ONLY here — never shipped in the client bundle.
type SearchType  = 'tmdb' | 'anilist';
type ContentType = 'movie' | 'tv' | 'anime';

type Tag = 'Multi audio' | '4K';

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
  { id: 'cinemaos', label: 'CinemaOS', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 1, tags: ['Multi audio'], movieUrl: (id, lang = 'en') => `https://cinemaos.tech/player/${id}?lang=${lang}`, tvUrl: (id, s, e, lang = 'en') => `https://cinemaos.tech/player/${id}/${s}/${e}?lang=${lang}` },
  { id: 'vidzee', label: 'Vidzee', searchType: 'tmdb', contentTypes: ['movie', 'tv', 'anime'], priority: 2, tags: ['Multi audio'], movieUrl: (id) => `https://player.vidzee.wtf/embed/movie/${id}`, tvUrl: (id, s, e) => `https://player.vidzee.wtf/embed/tv/${id}/${s}/${e}`, animeUrl: (id, ep) => `https://player.vidzee.wtf/embed/tv/${id}/1/${ep}` },
  { id: 'vidup', label: 'VidUp', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 3, movieUrl: (id) => `https://vidup.to/movie/${id}?server=zenith`, tvUrl: (id, s, e) => `https://vidup.to/tv/${id}/${s}/${e}?server=zenith` },
  { id: 'vidfast', label: 'VidFast', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 4, tags: ['4K'], movieUrl: (id) => `https://vidfast.pro/movie/${id}`, tvUrl: (id, s, e) => `https://vidfast.pro/tv/${id}/${s}/${e}` },
  { id: 'primesrc', label: 'PrimeSrc', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 5, movieUrl: (id) => `https://primesrc.me/embed/movie?tmdb=${id}`, tvUrl: (id, s, e) => `https://primesrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}&fallback=false&serverOrder=PrimeVid,Voe,Dood` },
  { id: 'vidlove', label: 'VidLove', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 6, movieUrl: (id) => `https://player.vidlove.cc/embed/movie/${id}`, tvUrl: (id, s, e) => `https://player.vidlove.cc/embed/tv/${id}/${s}/${e}` },
  { id: '1embed', label: '1Embed', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 7, movieUrl: (id) => `https://1embed.cc/embed/movie/${id}`, tvUrl: (id, s, e) => `https://1embed.cc/embed/tv/${id}/${s}/${e}` },
  { id: 'videasy', label: 'Videasy', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 9, tags: ['Multi audio', '4K'], movieUrl: (id) => `https://player.videasy.to/movie/${id}?color=E50914&overlay=true&nextEpisode=true`, tvUrl: (id, s, e) => `https://player.videasy.to/tv/${id}/${s}/${e}?color=E50914&overlay=true&nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true` },
  { id: 'vidcore', label: 'VidCore', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 10, movieUrl: (id) => `https://vidcore.net/movie/${id}?server=Crystal&autoPlay=true`, tvUrl: (id, s, e) => `https://vidcore.net/tv/${id}/${s}/${e}?server=Crystal&autoPlay=true` },
  { id: 'cinesrc', label: 'CineSrc', searchType: 'tmdb', contentTypes: ['movie', 'tv'], priority: 11, movieUrl: (id) => `https://cinesrc.st/embed/movie/${id}`, tvUrl: (id, s, e) => `https://cinesrc.st/embed/tv/${id}/${s}/${e}` },
  { id: 'nontongo', label: 'NontonGo', searchType: 'tmdb', contentTypes: ['movie'], priority: 12, movieUrl: (id) => `https://www.nontongo.win/embed/movie/${id}` },
  { id: 'vidnest-tv', label: 'VidNest', searchType: 'tmdb', contentTypes: ['tv'], priority: 13, tvUrl: (id, s, e) => `https://vidnest.fun/tv/${id}/${s}/${e}` },
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

const VALID_CT: ContentType[] = ['movie', 'tv', 'anime'];
const PROBE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const EMBED_BLOCK_RE =
  /disable sandbox|sandboxed|<title>\s*sandbox|x-frame-options|404\s*not\s*found|media unavailable|video not found/i;

async function probeEmbedUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': PROBE_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return false;
    const csp = (res.headers.get('content-security-policy') || '').toLowerCase();
    const fa = csp.match(/frame-ancestors\s+([^;]+)/)?.[1]?.trim() || '';
    if (fa) {
      if (fa === "'none'" || fa === "'self'") return false;
    } else {
      const xfo = (res.headers.get('x-frame-options') || '').toUpperCase();
      if (xfo.includes('DENY') || xfo.includes('SAMEORIGIN')) return false;
    }
    const text = (await res.text().catch(() => '')).slice(0, 10000);
    if (EMBED_BLOCK_RE.test(text)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function onRequest(context: { request: Request }) {
  const url = new URL(context.request.url);
  const params = url.searchParams;
  const action = params.get('action');
  const contentType = params.get('contentType');
  const providerId = params.get('providerId');
  const tmdbId = params.get('tmdbId');
  const anilistId = params.get('anilistId');
  const season = params.get('season');
  const episode = params.get('episode');
  const lang = params.get('lang');
  const excludeParam = params.get('exclude') || '';

  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  });

  if (context.request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return new Response(null, { status: 204, headers });
  }

  const ct: ContentType = VALID_CT.includes(contentType as ContentType)
    ? (contentType as ContentType)
    : 'movie';

  if (action === 'resolve') {
    const provider = PROVIDER_DEFS.find(p => p.id === String(providerId || ''));
    if (!provider) return Response.json({ error: 'Unknown provider' }, { status: 404, headers });

    const tmdbIdNum = parseInt(String(tmdbId || '0'), 10);
    const anilistIdNum = anilistId ? parseInt(String(anilistId), 10) : null;
    const seasonNum = parseInt(String(season || '1'), 10);
    const episodeNum = parseInt(String(episode || '1'), 10);
    const langStr = lang || 'en';

    const resolvedUrl = buildUrl(provider, tmdbIdNum, anilistIdNum, ct, seasonNum, episodeNum, langStr);
    if (!resolvedUrl) {
      return Response.json({ error: 'Could not resolve URL for this provider/content type' }, { status: 400, headers });
    }

    headers.set('Cache-Control', 'no-store');
    return Response.json({ url: resolvedUrl }, { status: 200, headers });
  }

  if (action === 'resolve-best') {
    const excluded = new Set(excludeParam.split(',').map((s) => s.trim()).filter(Boolean));
    const tmdbIdNum = parseInt(String(tmdbId || '0'), 10);
    const anilistIdNum = anilistId ? parseInt(String(anilistId), 10) : null;
    const seasonNum = parseInt(String(season || '1'), 10);
    const episodeNum = parseInt(String(episode || '1'), 10);
    const langStr = lang || 'en';

    const candidates = getProviders(ct)
      .filter((p) => !excluded.has(p.id))
      .map((p) => ({
        provider: p,
        url: buildUrl(p, tmdbIdNum, anilistIdNum, ct, seasonNum, episodeNum, langStr),
      }))
      .filter((c) => Boolean(c.url));

    if (!candidates.length) {
      return Response.json({ error: 'No available providers left' }, { status: 404, headers });
    }

    // Probe top 5 candidates in parallel, preserving Multi-audio priority order
    const batch = candidates;
    const checks = await Promise.all(batch.map((c) => probeEmbedUrl(c.url)));
    const verifiedIdx = checks.findIndex(Boolean);
    if (verifiedIdx < 0) {
      headers.set('Cache-Control', 'no-store');
      return Response.json({ error: 'No provider passed the availability check' }, { status: 503, headers });
    }
    const chosen = batch[verifiedIdx];

    headers.set('Cache-Control', 'no-store');
    return Response.json(
      {
        providerId: chosen.provider.id,
        label: chosen.provider.label,
        tags: chosen.provider.tags ?? [],
        url: chosen.url,
        verified: true,
      },
      { status: 200, headers },
    );
  }

  headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return Response.json({ providers: getProviders(ct).map(publicMeta) }, { status: 200, headers });
}
