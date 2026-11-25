// Movie/TV embed candidate registry aligned with the working Zenkai provider architecture.
// This file is server-safe and contains URL construction + response validation only.

export const TRUSTED_MOVIE_EMBED_HOSTS = [
  'player.videasy.to',
  'player.vidzee.wtf',
  'vidup.to',
  'vidcore.net',
  'player.vidlove.cc',
  '1embed.cc',
  'cinesrc.st',
  'primesrc.me',
  'cinemaos.tech',
  'www.nontongo.win',
  'nontongo.win',
  'vidnest.fun',
  // Retained secondary providers from AnimeStream (MoviesAPI intentionally excluded:
  // it was the source of the reported "refused to connect" failure).
  'cdn.vidspark.to',
  'vidspark.to',
  'vidlink.pro',
  'vidsrc.to',
  'vidfast.pro',
  'embed.smashystream.com',
  'smashystream.com',
  'player.autoembed.cc',
  'autoembed.cc',
  'multiembed.mov',
  'vidsrc.rip',
];

export function isTrustedMovieEmbedUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return TRUSTED_MOVIE_EMBED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function buildMovieEmbedCandidates({ type = 'movie', tmdbId, season = 1, episode = 1, sandboxed = false }) {
  const isTv = type === 'tv';
  const s = Math.max(1, parseInt(season, 10) || 1);
  const e = Math.max(1, parseInt(episode, 10) || 1);
  const id = Number(tmdbId);
  if (!Number.isFinite(id) || id <= 0) return [];

  // CinemaOS is Priority #1 by default for movies & web series; other embeds & direct servers remain available backups.
  const candidates = [
    {
      id: 'cinemaos', label: 'CinemaOS',
      url: isTv ? `https://cinemaos.tech/player/${id}/${s}/${e}?lang=en` : `https://cinemaos.tech/player/${id}?lang=en`,
      tags: ['Multi audio'], priority: 1,
    },
    {
      id: 'vidzee', label: 'Vidzee',
      url: isTv ? `https://player.vidzee.wtf/embed/tv/${id}/${s}/${e}` : `https://player.vidzee.wtf/embed/movie/${id}`,
      tags: ['Multi audio'], priority: 2,
    },
    {
      id: 'vidup', label: 'VidUp',
      url: isTv ? `https://vidup.to/tv/${id}/${s}/${e}?server=zenith` : `https://vidup.to/movie/${id}?server=zenith`,
      tags: [], priority: 3,
    },
    {
      id: 'vidfast', label: 'VidFast',
      url: isTv ? `https://vidfast.pro/tv/${id}/${s}/${e}` : `https://vidfast.pro/movie/${id}`,
      tags: ['4K'], priority: 4,
    },
    {
      id: 'primesrc', label: 'PrimeSrc',
      url: isTv
        ? `https://primesrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}&fallback=false&serverOrder=PrimeVid,Voe,Dood`
        : `https://primesrc.me/embed/movie?tmdb=${id}`,
      tags: [], priority: 5,
    },
    {
      id: 'vidsrc-to', label: 'VidSrc.to',
      url: isTv ? `https://vidsrc.to/embed/tv/${id}/${s}/${e}` : `https://vidsrc.to/embed/movie/${id}`,
      tags: ['Multi audio'], priority: 6,
    },
    {
      id: 'vidlove', label: 'VidLove',
      url: isTv ? `https://player.vidlove.cc/embed/tv/${id}/${s}/${e}` : `https://player.vidlove.cc/embed/movie/${id}`,
      tags: [], priority: 7,
    },
    {
      id: '1embed', label: '1Embed',
      url: isTv ? `https://1embed.cc/embed/tv/${id}/${s}/${e}` : `https://1embed.cc/embed/movie/${id}`,
      tags: [], priority: 8,
    },
    {
      id: 'vidspark', label: 'VidSpark',
      url: isTv ? `https://cdn.vidspark.to/tv/${id}/${s}/${e}` : `https://cdn.vidspark.to/movie/${id}`,
      tags: ['Multi audio', '4K'], priority: 9,
    },
    {
      id: 'autoembed', label: 'AutoEmbed',
      url: isTv ? `https://player.autoembed.cc/embed/tv/${id}/${s}/${e}` : `https://player.autoembed.cc/embed/movie/${id}`,
      tags: ['Multi audio'], priority: 10,
    },
    {
      id: 'multiembed', label: 'MultiEmbed',
      url: isTv ? `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}` : `https://multiembed.mov/?video_id=${id}&tmdb=1`,
      tags: ['Multi audio'], priority: 11,
    },
    {
      id: 'vidsrc-rip', label: 'VidSrc Rip',
      url: isTv ? `https://vidsrc.rip/embed/tv/${id}/${s}/${e}` : `https://vidsrc.rip/embed/movie/${id}`,
      tags: ['4K'], priority: 12,
    },
    {
      id: 'videasy', label: 'Videasy',
      url: isTv
        ? `https://player.videasy.to/tv/${id}/${s}/${e}?color=E50914&overlay=true&nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true`
        : `https://player.videasy.to/movie/${id}?color=E50914&overlay=true&nextEpisode=true`,
      tags: ['Multi audio', '4K'], priority: 14,
    },
    {
      id: 'vidcore', label: 'VidCore',
      url: isTv ? `https://vidcore.net/tv/${id}/${s}/${e}?server=Crystal&autoPlay=true` : `https://vidcore.net/movie/${id}?server=Crystal&autoPlay=true`,
      tags: [], priority: 15,
    },
    {
      id: 'cinesrc', label: 'CineSrc',
      url: isTv ? `https://cinesrc.st/embed/tv/${id}/${s}/${e}` : `https://cinesrc.st/embed/movie/${id}`,
      tags: [], priority: 16,
    },
    {
      id: 'vidlink', label: 'VidLink',
      url: isTv ? `https://vidlink.pro/tv/${id}/${s}/${e}` : `https://vidlink.pro/movie/${id}`,
      tags: ['Multi audio', '4K'], priority: 17,
    },
    ...(!isTv ? [{
      id: 'nontongo', label: 'NontonGo',
      url: `https://www.nontongo.win/embed/movie/${id}`,
      tags: [], priority: 18,
    }] : []),
    ...(isTv ? [{
      id: 'vidnest-tv', label: 'VidNest',
      url: `https://vidnest.fun/tv/${id}/${s}/${e}`,
      tags: [], priority: 19,
    }] : []),
    {
      id: 'smashystream', label: 'SmashyStream',
      url: isTv ? `https://embed.smashystream.com/playere.php?tmdb=${id}&season=${s}&episode=${e}` : `https://embed.smashystream.com/playere.php?tmdb=${id}`,
      tags: ['Multi audio', '4K'], priority: 20,
    },
  ];

  return candidates
    .filter((c) => isTrustedMovieEmbedUrl(c.url))
    .sort((a, b) => a.priority - b.priority);
}

export function sanitizeCinemaOsJs(jsText) {
  if (!jsText || typeof jsText !== 'string') return '';
  return jsText
    .replace(/(?:https?:)?\/\/wz\.afgodscarpe\.com\/[^"'`\s)]+/gi, 'data:text/javascript,void(0)')
    .replace(/(?:https?:)?\/\/[^"'`\s)]*(?:afgodscarpe|popads|popcash|adsterra|exoclick)[^"'`\s)]*/gi, 'data:text/javascript,void(0)');
}

export function sanitizeCinemaOsCss(cssText) {
  if (!cssText || typeof cssText !== 'string') return '';
  return cssText
    .replace(/--tw-backdrop-blur\s*:[^;}]+/gi, '--tw-backdrop-blur:blur(0px)')
    .replace(/(?:-webkit-)?backdrop-filter\s*:[^;}]+/gi, (m) => `${m.split(':')[0]}:none!important`)
    .replace(/url\(\s*(['"]?)(\/(?:_next|images|fonts|static)\/[^)'"]+)\1\s*\)/gi, (_, q, p) => {
      return `url(${q}/api/movies/cinemaos-proxy?path=${encodeURIComponent(p)}${q})`;
    });
}

export function sanitizeCinemaOsHtml(htmlText, { playerPath = '/player/0', lang = 'en' } = {}) {
  if (!htmlText || typeof htmlText !== 'string') return '';
  const cleanHtml = htmlText
    // Strip known popunder / ad / tracker tags & preloads
    .replace(/<link[^>]+(?:afgodscarpe|googletagmanager|doubleclick|googlesyndication)[^>]*>/gi, '')
    .replace(/<script[^>]+(?:afgodscarpe|googletagmanager|doubleclick|googlesyndication)[^>]*>\s*<\/script>/gi, '')
    // Rewrite root-relative Next.js assets & images through cinemaos-proxy
    .replace(/\b(src|href)=(["'])(\/(?:_next|images|favicon[^"']*)\b[^"']*)\2/gi, (_m, attr, quote, relPath) => {
      return `${attr}=${quote}/api/movies/cinemaos-proxy?path=${encodeURIComponent(relPath)}${quote}`;
    });

  const safePath = JSON.stringify(playerPath);
  const safeUrl = JSON.stringify(`${playerPath}${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`);

  const headInject =
    `<style id="animestream-no-blur">*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;--tw-backdrop-blur:blur(0px)!important;}</style>` +
    `<script>(function(){` +
    `var ORIGIN='https://cinemaos.tech';` +
    `var PROXY='/api/movies/cinemaos-proxy?path=';` +
    `var AD_RE=/afgodscarpe|popads|popcash|onclick|adsterra|propeller|doubleclick|googlesyndication|googletagmanager|mc\\.yandex|realsrv|trafficjunky|juicyads|exoclick/i;` +
    `function rewriteUrl(u){` +
      `if(typeof u!=='string'||!u)return u;` +
      `if(AD_RE.test(u))return 'data:text/javascript,void(0)';` +
      `if(u.indexOf(PROXY)===0)return u;` +
      `if(u.indexOf('//cinemaos.tech/')===0)u='https:'+u;` +
      `if(u.indexOf(ORIGIN+'/')===0)u=u.slice(ORIGIN.length);` +
      `if(u.charAt(0)==='/'&&u.charAt(1)!=='/'&&(u.indexOf('/_next/')===0||u.indexOf('/api/')===0||u.indexOf('/images/')===0||u.indexOf('/favicon')===0)){` +
        `return PROXY+encodeURIComponent(u);` +
      `}` +
      `return u;` +
    `}` +
    `try{` +
      `window.open=function(){return null;};` +
      `Object.defineProperty(window,'open',{value:function(){return null;},writable:false,configurable:false});` +
    `}catch(_){}` +
    `try{` +
      `document.addEventListener('click',function(ev){` +
        `var a=ev.target&&ev.target.closest?(ev.target.closest('a[target="_blank"]')||ev.target.closest('a')):null;` +
        `if(a){` +
          `var href=a.getAttribute('href')||'';` +
          `if(a.getAttribute('target')==='_blank'||!href||href==='#'||href==='/'||AD_RE.test(href)||href.indexOf('http')===0||(href.charAt(0)==='/'&&href.indexOf('/player/')!==0)){ev.preventDefault();ev.stopPropagation();}` +
        `}` +
      `},true);` +
    `}catch(_){}` +
    `try{` +
      `if(window.location.pathname!==${safePath}){window.history.replaceState(window.history.state,'',${safeUrl});}` +
    `}catch(_){}` +
    `var origFetch=window.fetch;` +
    `if(origFetch){` +
      `window.fetch=function(input,init){` +
        `try{` +
          `if(typeof input==='string'){` +
            `if(AD_RE.test(input))return Promise.resolve(new Response('',{status:204}));` +
            `input=rewriteUrl(input);` +
          `}else if(input&&typeof input==='object'&&typeof input.url==='string'){` +
            `if(AD_RE.test(input.url))return Promise.resolve(new Response('',{status:204}));` +
            `var nu=rewriteUrl(input.url);` +
            `if(nu!==input.url)input=new Request(nu,input);` +
          `}` +
        `}catch(_){}` +
        `return origFetch.call(this,input,init);` +
      `};` +
    `}` +
    `var origOpen=XMLHttpRequest.prototype.open;` +
    `XMLHttpRequest.prototype.open=function(m,u){` +
      `try{` +
        `if(typeof u==='string'){arguments[1]=AD_RE.test(u)?'data:text/plain,':rewriteUrl(u);}` +
      `}catch(_){}` +
      `return origOpen.apply(this,arguments);` +
    `};` +
    `function patchProp(Proto,prop){` +
      `try{` +
        `var desc=Object.getOwnPropertyDescriptor(Proto,prop);` +
        `if(desc&&desc.set&&desc.get){` +
          `Object.defineProperty(Proto,prop,{` +
            `configurable:true,enumerable:desc.enumerable,` +
            `get:function(){return desc.get.call(this);},` +
            `set:function(v){return desc.set.call(this,rewriteUrl(v));}` +
          `});` +
        `}` +
      `}catch(_){}` +
    `}` +
    `patchProp(HTMLScriptElement.prototype,'src');` +
    `patchProp(HTMLLinkElement.prototype,'href');` +
    `patchProp(HTMLImageElement.prototype,'src');` +
    `var origSetAttr=Element.prototype.setAttribute;` +
    `Element.prototype.setAttribute=function(name,val){` +
      `if((name==='src'||name==='href')&&(this.tagName==='SCRIPT'||this.tagName==='LINK'||this.tagName==='IMG')){` +
        `val=rewriteUrl(String(val));` +
      `}` +
      `return origSetAttr.call(this,name,val);` +
    `};` +
    `})();</script>`;

  if (/<head[^>]*>/i.test(cleanHtml)) {
    return cleanHtml.replace(/<head[^>]*>/i, (m) => `${m}${headInject}`);
  }
  return `${headInject}${cleanHtml}`;
}

export function isValidEmbedResponse(status, bodyText) {
  if (status !== 200 || !bodyText || typeof bodyText !== 'string') return false;
  const clean = bodyText.trim();
  if (clean.length < 100) return false;
  if (/__next_error__|__vidora_sandbox_probe__|Restricted\s+Embed\s+Detected|Please\s+Disable\s+Sandbox|sandbox\.php|403\s+Forbidden/i.test(clean)) return false;
  if (/This\s+domain\s+is\s+for\s+sale|Buy\s+this\s+domain|domain\s+is\s+parked/i.test(clean)) return false;
  if (/^File not found|^Video not found/i.test(clean)) return false;
  if (/<title>\s*(?:404|Not Found|Error|Attention Required|Just a moment)/i.test(clean)) return false;
  return /<html[^>]*>[\s\S]*<\/html>|<!DOCTYPE|player|video/i.test(clean);
}

export function getMaxResolutionFromStreams(streams = []) {
  if (!Array.isArray(streams) || streams.length === 0) return 0;
  return Math.max(
    0,
    ...streams.map((s) => Number(s?.resolutionNum || parseInt(String(s?.quality || ''), 10) || 0) || 0),
  );
}

export function hasHindiAudio(source) {
  if (!source) return false;
  if (/hindi/i.test(String(source.activeLanguage || ''))) return true;
  if (Array.isArray(source.dubs)) {
    if (source.dubs.some((d) => d?.selected && /hindi/i.test(String(d?.label || '')))) return true;
  }
  if (Array.isArray(source.streams)) {
    if (source.streams.some((s) => /hindi/i.test(String(s?.language || '')))) return true;
  }
  return false;
}

/**
 * MovieBox is always Priority #1 when it offers HD (720p/1080p+) AND matches Hindi availability.
 * - Never switch away from MovieBox Hindi to a non-Hindi stream.
 * - Always switch to Vidzee Hindi if MovieBox had no Hindi track.
 * - Upgrade MovieBox < 720p to Vidzee when Vidzee offers >= 720p or multi-quality in matching/Hindi language.
 */
export function shouldUpgradeMovieBoxToVidzee(mbStreams = [], vidzeeStreams = [], opts = {}) {
  if (!Array.isArray(vidzeeStreams) || vidzeeStreams.length === 0) return false;
  const { mbHasHindi = false, vzHasHindi = false } = opts;
  if (mbHasHindi && !vzHasHindi) return false;
  const mbMax = getMaxResolutionFromStreams(mbStreams);
  const vzMax = getMaxResolutionFromStreams(vidzeeStreams);
  const vzMulti = vidzeeStreams.some((s) => s?.hasMultiQuality);
  if (!mbHasHindi && vzHasHindi) {
    if (mbMax >= 720 && vzMax === 0 && !vzMulti) return false;
    return true;
  }
  if (mbMax >= 720) return false;
  return vzMax >= 720 || vzMulti || vzMax > mbMax;
}


