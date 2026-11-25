const FORBIDDEN_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254", // AWS/Cloud metadata
  "metadata.google.internal",
  "instance-data"
]);

// Allowed streaming CDN domains and video providers
const ALLOWED_STREAM_DOMAINS = [
  "megaplay.buzz",
  "nexabloom.top",
  "stellarfrontier.world",
  "phantomharbor.top",
  "shadowharbor.top",
  "hiddenvertex.top",
  "emeralddrift.top",
  "eclipseharbor.space",
  "broforgotsave.online",
  "imgnex.top",
  "akirax.top",
  "shiora.top",
  "krussdomi.com",
  "advancedairesearchlab.top",
  "animeapps.top",
  "nukitashi.top",
  "playeng.animeapps.top",
  "novelfire.net",
  "novelfull.com",
  "anikototv.to",
  "animegg.org",
  "anineko.to",
  "anizone.to",
  "aniwave.to",
  "animesalt.cx",
  "animesalt.ac",
  "animesalt.ro",
  "ravok.buzz",
  "acdn.top",
  "flixcloud.cc",
  "enc-dec.app",
  "reanime.to",
  "reanime.cz",
  "atomic4cdn.com",
  "rundowncdn.com",
  "rundowncdn.top",
  "vividcdn.com",
  "vividcdn.top",
  "fallencdn.com",
  "fallencdn.top",
  "akamaized.net",
  "cloudflare.com",
  "workers.dev",
  "opensubtitles.org",
  "opensubtitles-v3.strem.io",
  "strem.io",
  "tmdb.org",
  "themoviedb.org",
  "image.tmdb.org",
  "demonicscans.org",
  "demoniclibs.com",
  "mangafifth.org",
  "readermc.org",
  "silentforge.top",
  "silentforge.space",
  "short.ink",
  "iamcdn.net",
  "as-cdn.top",
  "mysubsplay.com",
  "aoneroom.com",
  "hakunaymatata.com",
  "inmoviebox.com",
  "moviebox.ph",
  "movie-box.co",
  "movieboxonline.net",
  "123moviesfree.club",
  "sflix.film",
  "weserv.nl",
  "images.weserv.nl",
  "lnori.com",
  "cdn.lnori.com",
  "img.lnori.com",
  "lnori.org",
  "googleusercontent.com",
  "google.com",
  "blogger.com",
  "blogspot.com",
  "bp.blogspot.com",
  "imgur.com",
  "i.imgur.com",
  "wp.com",
  "wordpress.com",
  "b-cdn.net",
  "cloudinary.com",
  "webnovel.com",
  "asurascans.com",
  "cdn.asurascans.com",
  "asuracomic.net",
  "comick.pictures",
  "meo.comick.pictures",
  "tmp2.comick.pictures",
  "comick.dev",
  "comick.art",
  "mangareadon.org",
  "mangadex.org",
  "mangadex.network",
  "uploads.mangadex.org",
  "anilist.co",
  "s4.anilist.co",
  "kitsu.io",
  "media.kitsu.app",
  "myanimelist.net",
  "cdn.myanimelist.net",
  "jikan.moe",
  "vidzee.wtf",
  "core.vidzee.wtf",
  "player.vidzee.wtf",
  "hscow.com",
  "img.hscow.com",
  "img1.hscow.com",
  "slowcloud.live",
  "cdn.slowcloud.live",
  "rezesubs.com",
  "vercetti.org",
  "tiktokcdn.com",
  "vidbox.site",
  "desidubanime.me",
  "www.desidubanime.me",
  "nuvorel.top",
  "streamruby.net",
  "morencius.com",
  "dramiyos-cdn.com",
  "maplebrookdesignstudio.shop",
  "vidmoly.org",
  "vmget.online",
  "vmpx.online",
  "vmnow.online",
  "rubyvidhub.com",
  "pixibay.cc",
  "watchanimeworld.one",
  "zephyrix.org",
  "play.zephyrix.org",
  "nekomux.com",
  "play.nekomux.com",
  "player.nekomux.com",
  "anikoto.cz",
  "anikototv.bz",
  "vidtube.site",
  "crystaldrift.world",
  "anipixcdn.co",
  "cdn.anipixcdn.co",
  "tooniboy.xyz",
  "rubystm.com",
  "vidmoly.net",
  "blakiteapi.xyz",
  "rumble.cloud",
  "cdn.rumble.cloud",
  "vidnest.fun",
  "new.vidnest.fun",
  "animanga.fun",
  "pwcloud.animanga.fun",
  "akcloud.animanga.fun",
  "megacloud.animanga.fun",
  "vdrk.site",
  "sub.vdrk.site",
  "cache.vdrk.site",
  "streamflixserver.site",
  "asrmo449ddj.com",
  "geffe448mik.com",
  "moviesapi.to",
  "halcyoncreative.site",
  "mediapresence.cyou",
  "nontongo.win",
  "digitalmarketingaid.site",
  "paretocdn.site",
  "ultramoss.top"
];
export function validateProxyUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, error: "Missing URL parameter" };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  // Protocol check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: "Only HTTP and HTTPS protocols permitted" };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 1. Strict loopback / metadata block
  if (FORBIDDEN_HOSTNAMES.has(hostname)) {
    return { valid: false, error: "Target host restricted (SSRF prevention)" };
  }

  // 2. Private IP range block
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/.test(hostname)) {
    return { valid: false, error: "Private IP addresses prohibited" };
  }

  // Internal suffixes
  if (hostname.endsWith(".internal") || hostname.endsWith(".local") || hostname.endsWith(".lan")) {
    return { valid: false, error: "Internal network targets prohibited" };
  }

  // 3. Domain validation: Host must match allowed streaming domains or media patterns
  const fullTarget = parsed.pathname + parsed.search;
  const isMediaPattern =
    /\.(m3u8|ts|m4s|m3u|mp4|vtt|srt|key|jpg|jpeg|png|webp|avif|gif|jxl|svg)(\?.*)?$/i.test(fullTarget) ||
    /cdn|stream|video|m3u8|hls|media|chunk|segment|seg-|sub|caption|fetch|anime|image|img|pic|photo|static|harbor|drift|frontier|vertex|space|sora|streamruby|rubystm|rubyvidhub|dramiyos|morencius|nuvorel|vmget|vmpx|vmnow|vidmoly|desidubanime|maplebrook|zephyrix|nekomux|blakiteapi|rumble/i.test(hostname) ||
    /stream|anime|subtitles|sora|proxy|image|img/i.test(parsed.pathname) ||
    /^as-cdn\d*\.top$/i.test(hostname) || // ACDN players (as-cdn26.top, ...)
    /^(?:[a-z0-9-]+\.)*zn-grid\d*\.[a-z]{2,}$/i.test(hostname); // Zephyrix disguised segment CDNs

  const isAllowed = ALLOWED_STREAM_DOMAINS.some(domain =>
    hostname === domain || hostname.endsWith("." + domain)
  ) || isMediaPattern;

  if (!isAllowed) {
    return { valid: false, error: "Target host not in permitted media streaming list" };
  }

  return { valid: true, url: parsed };
}

// =====================================================================
// 5. ABUSE SIGNALS CHECK
