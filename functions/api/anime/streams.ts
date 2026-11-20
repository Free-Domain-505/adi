interface ResolvedStream {
  id: string;
  name: string;
  language: 'hindi' | 'english';
  note: string;
  url: string;
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function normalizeTitleStr(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(season|part|cour|arc)\s*\d+\b/gi, '')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSeasonNum(title: string): number {
  const m1 = title.match(/\bseason\s+(\d+)\b/i);
  if (m1) return Math.max(1, Number(m1[1]));
  const m2 = title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
  if (m2) return Math.max(1, Number(m2[1]));
  const m3 = title.match(/\bpart\s+(\d+)\b/i);
  if (m3) return Math.max(1, Number(m3[1]));
  return 1;
}

function decodeBase64Utf8(b64: string): string {
  const clean = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function resolveAnimeSaltStreams(
  title: string,
  romaji: string,
  ep: number,
  isMovie: boolean,
  explicitSeason?: number,
  absEp?: number
): Promise<ResolvedStream[]> {
  const hindiStreams: ResolvedStream[] = [];
  const multiStreams: ResolvedStream[] = [];
  const englishStreams: ResolvedStream[] = [];

  const rawQuery = normalizeTitleStr(title || romaji);
  if (!rawQuery) return [];

  const titleSeason = extractSeasonNum(title || romaji);
  const season =
    explicitSeason && explicitSeason > 1
      ? explicitSeason
      : titleSeason > 1
        ? titleSeason
        : explicitSeason || 1;

  const searchTerms = Array.from(
    new Set(
      [rawQuery, rawQuery.split(':')[0].trim(), normalizeTitleStr(romaji)].filter(
        (t) => t.length >= 2
      )
    )
  );

  let matchedHref = '';
  for (const term of searchTerms) {
    try {
      const resp = await fetch(`https://animesalt.cx/?s=${encodeURIComponent(term)}`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(5500),
      });
      if (!resp.ok) continue;
      const html = await resp.text();

      const linkRegex = /<a[^>]+href=["'](https?:\/\/animesalt\.cx\/(?:series|movies)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      const candidates: { href: string; label: string; score: number }[] = [];
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(html)) !== null) {
        const href = m[1];
        const tag = m[0];
        const isMovLink = href.includes('/movies/');
        if (isMovie !== isMovLink) continue;

        const titleAttr = tag.match(/title=["']([^"']+)["']/i)?.[1] || '';
        const innerText = m[2].replace(/<[^>]+>/g, ' ').trim();
        const slugPart = href.split('/').filter(Boolean).pop() || '';
        const label = normalizeTitleStr(titleAttr || innerText || slugPart.replace(/-/g, ' '));
        if (!label) continue;

        let score = 0;
        if (label === term || slugPart.replace(/-/g, ' ') === term) score += 100;
        else if (label.includes(term) || term.includes(label)) score += 60;
        else {
          const words = term.split(' ').filter((w) => w.length > 2);
          const hits = words.filter((w) => label.includes(w)).length;
          score += hits * 15;
        }
        if (label.includes('lego') || label.includes('live action')) score -= 40;
        if (score > 0 && !candidates.some((c) => c.href === href)) {
          candidates.push({ href, label, score });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      if (candidates[0]?.score >= 30) {
        matchedHref = candidates[0].href;
        break;
      }
    } catch {
      // Try next search term
    }
  }

  if (!matchedHref) return [];

  const slug = matchedHref.split('/').filter(Boolean).pop() || '';
  const epUrls = isMovie
    ? [matchedHref]
    : Array.from(
        new Set([
          `https://animesalt.cx/episode/${slug}-${season}x${ep}/`,
          ...(season !== 1 ? [`https://animesalt.cx/episode/${slug}-1x${ep}/`] : []),
          ...(absEp && absEp !== ep ? [`https://animesalt.cx/episode/${slug}-1x${absEp}/`] : []),
        ])
      );

  for (const epUrl of epUrls) {
    try {
      const resp = await fetch(epUrl, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(5500),
      });
      if (!resp.ok) continue;
      const epHtml = await resp.text();
      if (!epHtml) continue;

      const iframeRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
      const iframes: string[] = [];
      let im: RegExpExecArray | null;
      while ((im = iframeRegex.exec(epHtml)) !== null) {
        if (im[1] && !iframes.includes(im[1])) iframes.push(im[1]);
      }

      for (const src of iframes) {
        if (src.includes('player.php?data=')) {
          try {
            const urlObj = new URL(src.startsWith('http') ? src : `https://animesalt.cx${src}`);
            const b64 = urlObj.searchParams.get('data');
            if (b64) {
              const decoded = JSON.parse(decodeBase64Utf8(decodeURIComponent(b64)));
              if (Array.isArray(decoded)) {
                for (const item of decoded) {
                  const lang = String(item?.language || '').toLowerCase();
                  const link = String(item?.link || '');
                  if (!link) continue;
                  if (lang === 'hindi') {
                    hindiStreams.push({
                      id: 'salt-hindi',
                      name: 'Hindi Server HD',
                      language: 'hindi',
                      note: 'Hindi Audio · Mobile & PC',
                      url: link,
                    });
                  } else if (lang === 'english') {
                    englishStreams.push({
                      id: 'salt-english',
                      name: 'English Server HD',
                      language: 'english',
                      note: 'English Audio · Mobile & PC',
                      url: link,
                    });
                  }
                }
              }
            }
          } catch {
            // Ignore malformed base64
          }
        } else if (src.includes('ravok.buzz')) {
          multiStreams.push({
            id: 'salt-multi',
            name: 'Multi-Audio (Hindi / Eng)',
            language: 'hindi',
            note: 'Switch Hindi / English inside player',
            url: src,
          });
        }
      }

      if (hindiStreams.length > 0 || multiStreams.length > 0 || englishStreams.length > 0) {
        break;
      }
    } catch {
      // Try next ep URL
    }
  }

  return [...hindiStreams, ...multiStreams, ...englishStreams];
}

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const title = String(url.searchParams.get('title') || '');
  const romaji = String(url.searchParams.get('romaji') || '');
  const ep = Math.max(1, Number(url.searchParams.get('ep')) || 1);
  const season = Math.max(0, Number(url.searchParams.get('season')) || 0);
  const absEp = Math.max(0, Number(url.searchParams.get('absEp')) || 0);
  const isMovie = url.searchParams.get('isMovie') === 'true';

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=600',
  };

  try {
    const streams = await resolveAnimeSaltStreams(
      title,
      romaji,
      ep,
      isMovie,
      season || undefined,
      absEp || undefined
    );
    return new Response(JSON.stringify({ streams }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ streams: [] }), { status: 200, headers });
  }
}
