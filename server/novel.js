/**
 * ZENKAI NOVEL ENGINE
 * Edge scraper for the novel sources (no invented placeholder chapter text):
 * 1. NovelFire (novelfire.net via Jina Reader Cloudflare bypass + weserv covers)
 * 2. NovelFull (novelfull.com via Jina Reader proxy with real chapter slugs)
 * 3. WebNovel (novelfire / webnovel mirror)
 * 4. Lnori (lnori.com, light-novel volumes with illustrations)
 */
import { normalizeNovelSearch, novelQueryVariants, scoreNovelMatch, stripLeadingMdHeading } from "./novelLogic.js";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchWithTimeout(url, options = {}, timeoutMs = 16000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchJinaJson(targetUrl, timeoutMs = 18000) {
  const res = await fetchWithTimeout(
    `https://r.jina.ai/${targetUrl}`,
    {
      headers: {
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
      },
    },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`Upstream proxy returned ${res.status}`);
  const json = await res.json();
  return json?.data || {};
}

function weservCover(url) {
  if (!url) return "";
  if (url.includes("images.weserv.nl")) return url;
  if (/novelfire\.net/i.test(url)) {
    return `https://images.weserv.nl/?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function cleanText(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMdText(s) {
  if (!s) return "";
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Curated Fallbacks if remote sources are temporarily blocked
const fallbackNovels = [
  { id: "shadow-slave", slug: "shadow-slave", title: "Shadow Slave", cover: weservCover("https://novelfire.net/server-1/shadow-slave.jpg"), rating: "9.6", stats: "3200+ Chs", genres: ["Fantasy", "Action", "Supernatural", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "lord-of-the-mysteries", slug: "lord-of-the-mysteries", title: "Lord of the Mysteries", cover: weservCover("https://novelfire.net/server-1/lord-of-the-mysteries.jpg"), rating: "9.7", stats: "1430 Chs", genres: ["Fantasy", "Supernatural", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "reverend-insanity", slug: "reverend-insanity", title: "Reverend Insanity", cover: weservCover("https://novelfire.net/server-1/reverend-insanity.jpg"), rating: "9.5", stats: "2334 Chs", genres: ["Fantasy", "Action", "Adventure", "Supernatural"], format: "NOVEL", source: "novelfire" },
  { id: "solo-leveling", slug: "solo-leveling", title: "Solo Leveling", cover: weservCover("https://novelfire.net/server-1/solo-leveling.jpg"), rating: "9.3", stats: "270 Chs", genres: ["Action", "Fantasy", "Supernatural"], format: "NOVEL", source: "novelfire" },
  { id: "the-legendary-mechanic", slug: "the-legendary-mechanic", title: "The Legendary Mechanic", cover: weservCover("https://novelfire.net/server-1/the-legendary-mechanic.jpg"), rating: "9.6", stats: "1463 Chs", genres: ["Sci-Fi", "Action", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "heaven-officials-blessing", slug: "heaven-officials-blessing", title: "Heaven Official's Blessing", cover: weservCover("https://novelfire.net/server-1/heaven-officials-blessing.jpg"), rating: "9.8", stats: "244 Chs", genres: ["Romance", "Fantasy", "Supernatural"], format: "NOVEL", source: "novelfire" },
  { id: "omniscient-readers-viewpoint", slug: "omniscient-readers-viewpoint", title: "Omniscient Reader's Viewpoint", cover: weservCover("https://novelfire.net/server-1/omniscient-readers-viewpoint.jpg"), rating: "9.8", stats: "551 Chs", genres: ["Action", "Supernatural", "Fantasy", "Sci-Fi"], format: "NOVEL", source: "novelfire" },
  { id: "super-gene", slug: "super-gene", title: "Super Gene", cover: weservCover("https://novelfire.net/server-1/super-gene.jpg"), rating: "8.9", stats: "3462 Chs", genres: ["Sci-Fi", "Action", "Adventure", "Fantasy"], format: "NOVEL", source: "novelfire" },
  { id: "ending-maker", slug: "ending-maker", title: "Ending Maker", cover: weservCover("https://novelfire.net/server-1/ending-maker.jpg"), rating: "9.5", stats: "350 Chs", genres: ["Romance", "Action", "Fantasy", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "nano-machine", slug: "nano-machine", title: "Nano Machine", cover: weservCover("https://novelfire.net/server-1/nano-machine.jpg"), rating: "9.4", stats: "483 Chs", genres: ["Sci-Fi", "Action", "Fantasy"], format: "NOVEL", source: "novelfire" },
  { id: "my-house-of-horrors", slug: "my-house-of-horrors", title: "My House of Horrors", cover: weservCover("https://novelfire.net/server-1/my-house-of-horrors.jpg"), rating: "9.4", stats: "1208 Chs", genres: ["Supernatural", "Mystery", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "the-beginning-after-the-end", slug: "the-beginning-after-the-end", title: "The Beginning After The End", cover: weservCover("https://novelfire.net/server-1/the-beginning-after-the-end.jpg"), rating: "9.5", stats: "490 Chs", genres: ["Fantasy", "Action", "Adventure", "Romance"], format: "NOVEL", source: "novelfire" },
  { id: "supreme-magus", slug: "supreme-magus", title: "Supreme Magus", cover: weservCover("https://novelfire.net/server-1/supreme-magus.jpg"), rating: "9.0", stats: "3100+ Chs", genres: ["Fantasy", "Action", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "second-life-ranker", slug: "second-life-ranker", title: "Second Life Ranker", cover: weservCover("https://novelfire.net/server-1/second-life-ranker.jpg"), rating: "9.3", stats: "800 Chs", genres: ["Action", "Fantasy", "Supernatural"], format: "NOVEL", source: "novelfire" },
  { id: "sss-class-suicide-hunter", slug: "sss-class-suicide-hunter", title: "SSS-Class Suicide Hunter", cover: weservCover("https://novelfire.net/server-1/sss-class-suicide-hunter.jpg"), rating: "9.6", stats: "400 Chs", genres: ["Supernatural", "Action", "Fantasy"], format: "NOVEL", source: "novelfire" },
  { id: "overgeared", slug: "overgeared", title: "Overgeared", cover: weservCover("https://novelfire.net/server-1/overgeared.jpg"), rating: "9.3", stats: "1950+ Chs", genres: ["Sci-Fi", "Action", "Fantasy", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "release-that-witch", slug: "release-that-witch", title: "Release That Witch", cover: weservCover("https://novelfire.net/server-1/release-that-witch.jpg"), rating: "9.4", stats: "1498 Chs", genres: ["Fantasy", "Sci-Fi", "Romance", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "trash-of-the-counts-family", slug: "trash-of-the-counts-family", title: "Trash of the Count's Family", cover: weservCover("https://novelfire.net/server-1/trash-of-the-counts-family.jpg"), rating: "9.6", stats: "850+ Chs", genres: ["Fantasy", "Adventure", "Supernatural"], format: "NOVEL", source: "novelfire" },
  { id: "against-the-gods", slug: "against-the-gods", title: "Against the Gods", cover: weservCover("https://novelfire.net/server-1/against-the-gods.jpg"), rating: "9.0", stats: "2050+ Chs", genres: ["Action", "Fantasy", "Romance", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "warlock-of-the-magus-world", slug: "warlock-of-the-magus-world", title: "Warlock of the Magus World", cover: weservCover("https://novelfire.net/server-1/warlock-of-the-magus-world.jpg"), rating: "9.2", stats: "1200 Chs", genres: ["Fantasy", "Sci-Fi", "Action", "Supernatural"], format: "NOVEL", source: "novelfire" },
  { id: "martial-world", slug: "martial-world", title: "Martial World", cover: weservCover("https://novelfire.net/server-1/martial-world.jpg"), rating: "9.3", stats: "2256 Chs", genres: ["Action", "Fantasy", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "desolate-era", slug: "desolate-era", title: "Desolate Era", cover: weservCover("https://novelfire.net/server-1/desolate-era.jpg"), rating: "9.2", stats: "1450 Chs", genres: ["Action", "Fantasy", "Adventure", "Supernatural"], format: "NOVEL", source: "novelfire" },
  { id: "coiling-dragon", slug: "coiling-dragon", title: "Coiling Dragon", cover: weservCover("https://novelfire.net/server-1/coiling-dragon.jpg"), rating: "9.1", stats: "840 Chs", genres: ["Action", "Fantasy", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "reformation-of-the-deadbeat-noble", slug: "reformation-of-the-deadbeat-noble", title: "Reformation of the Deadbeat Noble", cover: weservCover("https://novelfire.net/server-1/reformation-of-the-deadbeat-noble.jpg"), rating: "9.3", stats: "350 Chs", genres: ["Fantasy", "Action", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "the-tutorial-is-too-hard", slug: "the-tutorial-is-too-hard", title: "The Tutorial Is Too Hard", cover: weservCover("https://novelfire.net/server-1/the-tutorial-is-too-hard.jpg"), rating: "9.1", stats: "420 Chs", genres: ["Action", "Supernatural", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "martial-peak", slug: "martial-peak", title: "Martial Peak", cover: weservCover("https://novelfire.net/server-1/martial-peak.jpg"), rating: "9.2", stats: "6000+ Chs", genres: ["Action", "Fantasy", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "i-shall-seal-the-heavens", slug: "i-shall-seal-the-heavens", title: "I Shall Seal the Heavens", cover: weservCover("https://novelfire.net/server-1/i-shall-seal-the-heavens.jpg"), rating: "9.4", stats: "1614 Chs", genres: ["Fantasy", "Action", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "tomb-raider-king", slug: "tomb-raider-king", title: "Tomb Raider King", cover: weservCover("https://novelfire.net/server-1/tomb-raider-king.jpg"), rating: "9.0", stats: "410 Chs", genres: ["Action", "Supernatural", "Adventure"], format: "NOVEL", source: "novelfire" },
  { id: "chrysalis", slug: "chrysalis", title: "Chrysalis", cover: weservCover("https://novelfire.net/server-1/chrysalis.jpg"), rating: "9.1", stats: "1200+ Chs", genres: ["Fantasy", "Adventure", "Action"], format: "NOVEL", source: "novelfire" },
  { id: "perfect-world", slug: "perfect-world", title: "Perfect World", cover: weservCover("https://novelfire.net/server-1/perfect-world.jpg"), rating: "9.2", stats: "2014 Chs", genres: ["Action", "Fantasy", "Adventure", "Supernatural"], format: "NOVEL", source: "novelfire" }
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. NOVELFIRE REPOSITORY (with Jina Cloudflare bypass)
// ─────────────────────────────────────────────────────────────────────────────
const NovelFire = {
  baseUrl: "https://novelfire.net",

  parseJinaCards(md) {
    const list = [];
    const seen = new Set();
    // Matches both browse & search list items referencing https://novelfire.net/book/<slug>
    const lineRegex = /\*\s+\[([\s\S]*?)\]\(https:\/\/novelfire\.net\/book\/([^/"'\s)]+)(?:\s+"([^"]*)")?\)\s*([^\n]*)/gi;
    let m;
    while ((m = lineRegex.exec(md)) !== null) {
      const inner = m[1] || "";
      const slug = (m[2] || "").trim();
      const quotedTitle = (m[3] || "").trim();
      const tail = (m[4] || "").trim();
      if (!slug || seen.has(slug) || slug.includes("chapter")) continue;

      const imgMatch = inner.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
      const rawCover = imgMatch ? imgMatch[1] : `https://novelfire.net/server-1/${slug}.jpg`;

      const titleFromHeading = inner.match(/#{2,5}\s*([^\n*]+)/)?.[1]?.trim();
      const title = cleanMdText(quotedTitle || titleFromHeading || slug.replace(/-/g, " "));
      if (!title) continue;

      const rateMatch = inner.match(/\bR\s+\d+\s+(\d(?:\.\d)?)\b/i) || inner.match(/\b(\d\.\d)\b/);
      const rating = rateMatch ? rateMatch[1] : "9.0";

      const chMatch = `${inner} ${tail}`.match(/(\d+)\s+Chapters?/i);
      const stats = chMatch ? `${chMatch[1]} Chs` : null;

      const matchedFb = fallbackNovels.find(f => f.slug === slug);
      const genres = matchedFb?.genres || ["Fantasy", "Action", "Adventure"];

      seen.add(slug);
      list.push({
        id: slug,
        slug,
        title,
        cover: weservCover(rawCover),
        stats,
        rating,
        genres,
        format: "NOVEL",
        source: "novelfire"
      });
    }
    return list;
  },

  async getHome(page = 1) {
    try {
      const data = await fetchJinaJson(`${this.baseUrl}/genre-all/sort-popular/status-all/all-novel?page=${page}`);
      const popular = this.parseJinaCards(data.content || "");
      if (popular.length > 0) {
        return {
          rankings: popular.slice(0, 10),
          popular,
          latest: popular.slice(10),
          source: "novelfire"
        };
      }
    } catch (e) {
      console.warn("NovelFire getHome fallback:", e.message);
    }
    return {
      rankings: fallbackNovels.slice(0, 5),
      popular: fallbackNovels,
      latest: fallbackNovels.slice(5),
      source: "novelfire"
    };
  },

  async search(query, page = 1) {
    for (const qv of novelQueryVariants(query).slice(0, 2)) {
      try {
        const data = await fetchJinaJson(`${this.baseUrl}/search?keyword=${encodeURIComponent(qv)}&page=${page}`);
        const results = this.parseJinaCards(data.content || "");
        if (results.length > 0) return results;
      } catch (e) {
        console.warn("NovelFire search fallback:", e.message);
      }
    }
    return fallbackNovels.filter((n) => scoreNovelMatch(n, query) > 0);
  },

  async getDetail(slug) {
    try {
      const data = await fetchJinaJson(`${this.baseUrl}/book/${slug}`);
      const md = data.content || "";
      if (/Page Not Found 404/i.test(data.title || "")) throw new Error("Not found");

      const titleMatch = md.match(/^#\s+(.+)$/m);
      const title = cleanMdText(titleMatch ? titleMatch[1] : slug.replace(/-/g, " "));

      const imgMatch = md.match(/!\[[^\]]*\]\((https:\/\/novelfire\.net\/server-[^)\s]+)\)/i);
      const cover = weservCover(imgMatch ? imgMatch[1] : `https://novelfire.net/server-1/${slug}.jpg`);

      const authorMatch = md.match(/Author:\s*\[([^\]]+)\]/i);
      const author = cleanMdText(authorMatch ? authorMatch[1] : "Unknown") || "Unknown";

      const genreMatches = [...md.matchAll(/\[([^\]]+)\]\(https:\/\/novelfire\.net\/genre-[^)]+\)/gi)];
      const genres = [...new Set(genreMatches.map(m => cleanMdText(m[1])).filter(Boolean))].slice(0, 8);

      const summaryBlock = md.match(/####\s*Summary\s*\n+([\s\S]*?)(?:\n####\s|\n\*\s+\[|$)/i)?.[1] || "";
      const synopsis = cleanMdText(summaryBlock) || "Official web novel translation.";

      return {
        id: slug,
        slug,
        title,
        cover,
        author,
        synopsis,
        genres: genres.length ? genres : ["Fantasy", "Action"],
        source: "novelfire"
      };
    } catch {
      const found = fallbackNovels.find(n => n.slug === slug);
      return {
        id: slug,
        slug,
        title: found?.title || slug.replace(/-/g, " "),
        cover: found?.cover || weservCover(`https://novelfire.net/server-1/${slug}.jpg`),
        author: "Unknown",
        synopsis: "Official novel translation from NovelFire.",
        genres: found?.genres || ["Fantasy", "Action"],
        source: "novelfire"
      };
    }
  },

  async getChapters(slug, _page = 1) {
    try {
      const data = await fetchJinaJson(`${this.baseUrl}/book/${slug}/chapters?page=1`);
      const md = data.content || "";

      const knownChapters = new Map();
      let maxChNum = 0;

      const chRegex = /\[\s*(\d+)\s*\*\*([^*]+)\*\*[^\]]*\]\(https:\/\/novelfire\.net\/book\/[^/]+\/(chapter-(\d+)[^)\s"]*)/gi;
      for (const m of md.matchAll(chRegex)) {
        const title = cleanMdText(m[2]);
        const chSlug = m[3].trim();
        const num = parseInt(m[4] || m[1], 10);
        if (!isNaN(num) && num > 0) {
          if (num > maxChNum) maxChNum = num;
          knownChapters.set(num, {
            slug: chSlug,
            title: title || `Chapter ${num}`,
            number: String(num)
          });
        }
      }

      const latestMatch = md.match(/Latest Release:\s*\[Chapter\s+(\d+)[^\]]*\]\(https:\/\/novelfire\.net\/book\/[^/]+\/chapter-(\d+)/i);
      if (latestMatch) {
        const lNum = parseInt(latestMatch[1] || latestMatch[2], 10);
        if (!isNaN(lNum) && lNum > maxChNum) maxChNum = lNum;
      }

      const pageNums = [...md.matchAll(/chapters\?page=(\d+)/g)].map(m => parseInt(m[1], 10));
      if (pageNums.length > 0) {
        const maxPage = Math.max(...pageNums);
        if (maxPage > 1 && maxPage * 100 > maxChNum) {
          maxChNum = Math.max(maxChNum, (maxPage - 1) * 100);
        }
      }

      const fb = fallbackNovels.find(f => f.slug === slug);
      if (fb && fb.stats) {
        const fbNum = parseInt(fb.stats.replace(/\D/g, ""), 10);
        if (!isNaN(fbNum) && fbNum > maxChNum) maxChNum = fbNum;
      }
      if (maxChNum === 0) maxChNum = Math.max(knownChapters.size, 40);

      const chapters = [];
      for (let i = 1; i <= maxChNum; i++) {
        chapters.push(
          knownChapters.get(i) || {
            slug: `chapter-${i}`,
            title: `Chapter ${i}`,
            number: String(i)
          }
        );
      }

      return {
        slug,
        total: chapters.length,
        totalPages: Math.ceil(chapters.length / 100),
        chapters,
        source: "novelfire"
      };
    } catch {
      const fb = fallbackNovels.find(f => f.slug === slug);
      let count = 40;
      if (fb && fb.stats) {
        const n = parseInt(fb.stats.replace(/\D/g, ""), 10);
        if (!isNaN(n) && n > 0) count = n;
      }
      const chapters = [];
      for (let i = 1; i <= count; i++) {
        chapters.push({ slug: `chapter-${i}`, title: `Chapter ${i}`, number: `${i}` });
      }
      return { slug, total: chapters.length, totalPages: Math.ceil(chapters.length / 100), chapters, source: "novelfire" };
    }
  },

  parseChapterMarkdown(md, defaultTitle) {
    let title = defaultTitle;
    const hMatch = md.match(/^#{1,4}\s*(Chapter[^\n]+)$/im);
    if (hMatch) title = cleanMdText(hMatch[1]);

    const rawBlocks = md.split(/\n{2,}/);
    const paragraphs = [];
    for (const blk of rawBlocks) {
      const line = blk.trim();
      if (!line) continue;
      if (/^#{1,6}\s/.test(line)) continue;
      if (/^\*\s+\[/.test(line)) continue;
      const imgMd = line.match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/i) || line.match(/<img\b[^>]*src=["'](https?:\/\/[^"']+)["'][^>]*>/i);
      if (imgMd) {
        const alt = cleanMdText(imgMd[1] || "");
        const imgUrl = (imgMd[2] || imgMd[1]).trim();
        if (!/avatar|favicon|\/icons?\/|\.ico(\?|$)|logo|spinner|ad\b|banner|pixel\.gif/i.test(imgUrl)) {
          paragraphs.push(alt ? `[img]${imgUrl}|${alt}[/img]` : `[img]${imgUrl}[/img]`);
          continue;
        }
      }
      if (/^\[!\[Image/i.test(line) || /^!\[Image/i.test(line)) continue;
      if (/^\*\*Translator:\*\*/i.test(line) || /^\*\*Editor:\*\*/i.test(line)) continue;
      if (/To comply with copyright regulations/i.test(line)) continue;
      if (/^Tip: You can use left, right/i.test(line)) continue;
      if (/Tap the middle of the screen/i.test(line)) continue;
      if (/\[Login\]\(/i.test(line) || /\[Browse\]\(/i.test(line)) continue;
      if (/^(?:Title|Author|Both|\*+)$/i.test(line)) continue;
      if (/novelfire\.net\/(home|ranking|search|genre|latest-release)/i.test(line)) continue;

      const cleaned = line
        .replace(/Tip: You can use left, right[\s\S]*$/i, "")
        .replace(/Tap the middle of the screen[\s\S]*$/i, "")
        .replace(/\\([_*[\]()~`>#+\-=|{}.!])/g, "$1")
        .replace(/^[_*](.+)[_*]$/, "$1")
        .trim();

      if (cleaned.length > 2) {
        paragraphs.push(cleaned);
      }
    }

    return { title, paragraphs };
  },

  async getChapterContent(novelSlug, chapterSlug) {
    const currentNum = parseInt(String(chapterSlug).replace(/\D/g, ""), 10) || 1;
    try {
      const data = await fetchJinaJson(`${this.baseUrl}/book/${novelSlug}/${chapterSlug}`);
      const md = data.content || "";
      const { title, paragraphs } = this.parseChapterMarkdown(md, `Chapter ${currentNum}`);

      if (paragraphs.length > 0) {
        return {
          novelSlug,
          chapterSlug,
          title,
          paragraphs,
          prevChapterSlug: currentNum > 1 ? `chapter-${currentNum - 1}` : null,
          nextChapterSlug: `chapter-${currentNum + 1}`,
          source: "novelfire"
        };
      }
    } catch (e) {
      console.warn("NovelFire chapter read error, trying NovelFull fallback:", e.message);
    }

    // Fallback to NovelFull if NovelFire removed/blocked the title (e.g. Korean novels)
    try {
      const fbRes = await NovelFull.getChapterContent(novelSlug, chapterSlug);
      if (fbRes?.paragraphs?.length > 0) {
        return { ...fbRes, source: "novelfire" };
      }
    } catch {}

    return {
      novelSlug,
      chapterSlug,
      title: `Chapter ${currentNum}`,
      paragraphs: [],
      error: "Chapter text could not be loaded from this source.",
      prevChapterSlug: currentNum > 1 ? `chapter-${currentNum - 1}` : null,
      nextChapterSlug: `chapter-${currentNum + 1}`,
      source: "novelfire"
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. NOVELFULL REPOSITORY (via Jina Reader Proxy)
// ─────────────────────────────────────────────────────────────────────────────
const NovelFull = {
  baseUrl: "http://novelfull.com",
  jinaBase: "https://r.jina.ai/http://novelfull.com",

  async fetchJina(path) {
    const data = await fetchJinaJson(`http://novelfull.com${path}`);
    return data?.content || "";
  },

  parseJinaCards(text, searchOnly = false) {
    const scope = searchOnly ? (text.split(/####\s*(?:Hot Novel|Most Popular|Latest Release|Completed)/i)[0] || text) : text;
    const list = [];
    const seen = new Set();
    // Match optional preceding image + ### [Title](https://novelfull.com/slug.html)
    const regex = /(?:!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)\s*)?###\s*\[([^\]]+)\]\((?:https?:\/\/novelfull\.com\/)?([^)]+?)\.html[^)]*\)/gi;
    let match;
    while ((match = regex.exec(scope)) !== null) {
      const rawImg = match[1] || "";
      const title = cleanMdText(match[2]);
      const slug = match[3].trim();
      if (!seen.has(slug) && slug.length > 2 && !slug.includes("genre") && !slug.includes("contact")) {
        seen.add(slug);
        list.push({
          id: slug,
          slug,
          title,
          cover: rawImg || weservCover(`https://novelfire.net/server-1/${slug}.jpg`),
          stats: "Popular",
          rating: "9.2",
          format: "NOVEL",
          source: "novelfull"
        });
      }
    }
    return list;
  },

  async getHome(page = 1) {
    try {
      const text = await this.fetchJina(page <= 1 ? "/most-popular" : `/most-popular?page=${page}`);
      const popular = this.parseJinaCards(text);
      if (popular.length > 0) {
        return {
          rankings: popular.slice(0, 10),
          popular,
          latest: popular.slice(10),
          source: "novelfull"
        };
      }
    } catch (e) {
      console.warn("NovelFull getHome error, falling back:", e.message);
    }
    return {
      rankings: fallbackNovels.slice(0, 5).map(n => ({ ...n, source: "novelfull" })),
      popular: fallbackNovels.map(n => ({ ...n, source: "novelfull" })),
      latest: fallbackNovels.slice(5).map(n => ({ ...n, source: "novelfull" })),
      source: "novelfull"
    };
  },

  async search(query, page = 1) {
    for (const qv of novelQueryVariants(query).slice(0, 2)) {
      try {
        const text = await this.fetchJina(`/search?keyword=${encodeURIComponent(qv)}&page=${page}`);
        const results = this.parseJinaCards(text, true);
        if (results.length > 0) return results;
      } catch {}
    }
    return fallbackNovels
      .filter((n) => scoreNovelMatch(n, query) > 0)
      .map((n) => ({ ...n, source: "novelfull" }));
  },

  async getDetail(slug) {
    try {
      const text = await this.fetchJina(`/${slug}.html`);
      const title = cleanMdText(text.match(/^###\s+([^\n]+)$/m)?.[1] || text.match(/^#\s+([^\n]+)$/m)?.[1] || "") || slug.replace(/-/g, " ");
      const imgMatch = text.match(/!\[[^\]]*\]\((https:\/\/novelfull\.com\/uploads\/[^)\s]+)\)/i);
      const cover = weservCover(imgMatch ? imgMatch[1] : `https://novelfire.net/server-1/${slug}.jpg`);

      const authorMatch = text.match(/Author:\s*(?:\[([^\]]+)\]|([^\n]+))/i);
      const author = cleanMdText(authorMatch?.[1] || authorMatch?.[2] || "") || "Unknown";

      const genreMatches = [...text.matchAll(/\[([^\]]+)\]\(https:\/\/novelfull\.com\/genre\/[^)]+\)/gi)];
      const genres = [...new Set(genreMatches.map(m => cleanMdText(m[1])).filter(Boolean))].slice(0, 8);

      const descLines = text.split("\n")
        .map(l => l.trim())
        .filter(l =>
          l.length > 60 &&
          !/novelfull/i.test(l) &&
          !l.includes("Show menu") &&
          !/^(?:\d+\.\s+|[*#\-!]|\[)/.test(l) &&
          !/^(?:Alternative names|Author|Genre|Source|Status|Latest chapter)\s*:/i.test(l)
        )
        .map(l => cleanMdText(l))
        .filter(l => l.length > 40);

      return {
        id: slug,
        slug,
        title,
        cover,
        author,
        synopsis: descLines.slice(0, 3).join("\n\n") || "Read full light novel on AnimeStream.",
        genres: genres.length ? genres : ["Fantasy", "Action", "Adventure"],
        source: "novelfull"
      };
    } catch {
      return {
        id: slug,
        slug,
        title: slug.replace(/-/g, " "),
        cover: weservCover(`https://novelfire.net/server-1/${slug}.jpg`),
        author: "Unknown",
        synopsis: "Official Light Novel from NovelFull archive.",
        genres: ["Fantasy", "Action"],
        source: "novelfull"
      };
    }
  },

  async getChapters(slug, page = 1) {
    try {
      const suffix = page > 1 ? `?page=${page}` : "";
      const text = await this.fetchJina(`/${slug}.html${suffix}`);
      const chSection = text.split(/##\s*Chapter List/i)[1] || text;
      const chapters = [];
      const seen = new Set();

      const chRegex = /\[\s*([^\]]+?)\s*\]\((?:https?:\/\/novelfull\.com)?\/[^/]+\/([^)"\s]+?)\.html(?:\s+"[^"]*")?\)/gi;
      for (const m of chSection.matchAll(chRegex)) {
        const title = cleanMdText(m[1]);
        const chSlug = m[2].trim();
        if (!chSlug || seen.has(chSlug)) continue;
        seen.add(chSlug);
        const numMatch = chSlug.match(/chapter-(\d+)/i) || title.match(/Chapter\s+(\d+)/i);
        const number = numMatch ? numMatch[1] : String(chapters.length + 1);
        chapters.push({ slug: chSlug, title: title || `Chapter ${number}`, number });
      }

      if (chapters.length > 0) {
        if (page <= 1) {
          const pageNums = [...chSection.matchAll(/\?page=(\d+)/gi)].map((m) => parseInt(m[1], 10)).filter((n) => Number.isFinite(n));
          const latestMatch = text.match(/Latest chapters[\s\S]{0,600}?Chapter\s+(\d+)/i);
          const latestNum = latestMatch ? parseInt(latestMatch[1], 10) : 0;
          const maxPage = pageNums.length ? Math.max(...pageNums) : 1;
          const estMax = Math.max(latestNum, maxPage > 1 ? (maxPage - 1) * 50 : 0);
          const byNum = new Map();
          for (const c of chapters) {
            const n = parseInt(c.number, 10);
            if (Number.isFinite(n) && n > 0 && !byNum.has(n)) byNum.set(n, c);
          }
          if (estMax > chapters.length) {
            for (let i = 1; i <= estMax; i++) {
              if (!byNum.has(i)) {
                chapters.push({ slug: `chapter-${i}`, title: `Chapter ${i}`, number: String(i) });
              }
            }
            chapters.sort((a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0));
          }
        }
        return { slug, total: chapters.length, totalPages: Math.ceil(chapters.length / 100), chapters, source: "novelfull" };
      }
    } catch {}

    const fb = fallbackNovels.find(f => f.slug === slug);
    let count = 50;
    if (fb && fb.stats) {
      const n = parseInt(fb.stats.replace(/\D/g, ""), 10);
      if (!isNaN(n) && n > 0) count = n;
    }
    const chapters = [];
    for (let i = 1; i <= count; i++) {
      chapters.push({ slug: `chapter-${i}`, title: `Chapter ${i}`, number: `${i}` });
    }
    return { slug, total: chapters.length, totalPages: Math.ceil(chapters.length / 100), chapters, source: "novelfull" };
  },

  async getChapterContent(novelSlug, chapterSlug) {
    const currentNum = parseInt(String(chapterSlug).replace(/\D/g, ""), 10) || 1;
    try {
      let targetSlug = chapterSlug;
      // If caller passed generic "chapter-1", resolve the full NovelFull slug (e.g. "chapter-1-starting-over")
      if (/^chapter-\d+$/i.test(chapterSlug)) {
        const estPage = Math.max(1, Math.ceil(currentNum / 50));
        let list = await this.getChapters(novelSlug, estPage);
        let match = list.chapters.find(c => c.number === String(currentNum) || c.slug.startsWith(`${chapterSlug}-`));
        if (!match && estPage > 1) {
          list = await this.getChapters(novelSlug, estPage + 1);
          match = list.chapters.find(c => c.number === String(currentNum) || c.slug.startsWith(`${chapterSlug}-`));
        }
        if (!match && estPage !== 1) {
          list = await this.getChapters(novelSlug, 1);
          match = list.chapters.find(c => c.number === String(currentNum) || c.slug.startsWith(`${chapterSlug}-`));
        }
        if (match?.slug) targetSlug = match.slug;
      }

      const cleanSlug = targetSlug.endsWith(".html") ? targetSlug : `${targetSlug}.html`;
      const text = await this.fetchJina(`/${novelSlug}/${cleanSlug}`);
      if (/Not Found - Novelfull/i.test(text.slice(0, 300))) {
        throw new Error("Chapter not found");
      }

      let title = `Chapter ${currentNum}`;
      const blocks = text.split(/\n{2,}/);
      const paragraphs = [];
      for (const blk of blocks) {
        const p = blk.trim();
        if (!p) continue;
        if (/^Show menu/i.test(p)) continue;
        if (/^\*\s+\[/.test(p) || /^\d+\.\s+\[/.test(p)) continue;
        const imgMd = p.match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/i) || p.match(/<img\b[^>]*src=["'](https?:\/\/[^"']+)["'][^>]*>/i);
        if (imgMd) {
          const alt = cleanMdText(imgMd[1] || "");
          const imgUrl = (imgMd[2] || imgMd[1]).trim();
          if (!/avatar|favicon|\/icons?\/|\.ico(\?|$)|logo|spinner|ad\b|banner|pixel\.gif/i.test(imgUrl)) {
            paragraphs.push(alt ? `[img]${imgUrl}|${alt}[/img]` : `[img]${imgUrl}[/img]`);
            continue;
          }
        }
        if (/^#####\s*\[!\[Image/i.test(p) || /^!\[Image/i.test(p)) continue;
        if (/^\*\*Translator:\*\*/i.test(p) || /^\*\*Editor:\*\*/i.test(p)) continue;
        if (/^If you find any errors/i.test(p) || /^Tip: You can use left, right/i.test(p)) continue;
        if (/novelfull\.com\/(genre|contact|tos|sitemap|latest-release|hot-novel|completed-novel|most-popular)/i.test(p)) continue;
        const headingStripped = stripLeadingMdHeading(p);
        if (/^Chapter\s+\d+/i.test(headingStripped) && headingStripped.length < 120 && paragraphs.length === 0) {
          title = cleanMdText(headingStripped);
          continue;
        }
        const cleaned = headingStripped
          .replace(/If you find any errors[\s\S]*$/i, "")
          .replace(/Tip: You can use left, right[\s\S]*$/i, "")
          .replace(/\\([_*[\]()~`>#+\-=|{}.!])/g, "$1")
          .trim();
        if (cleaned.length > 2) paragraphs.push(cleaned);
      }

      return {
        novelSlug,
        chapterSlug,
        title,
        paragraphs,
        error: paragraphs.length ? undefined : "Chapter text could not be loaded from this source.",
        prevChapterSlug: currentNum > 1 ? `chapter-${currentNum - 1}` : null,
        nextChapterSlug: `chapter-${currentNum + 1}`,
        source: "novelfull"
      };
    } catch {
      return {
        novelSlug,
        chapterSlug,
        title: `Chapter ${currentNum}`,
        paragraphs: [],
        error: "Chapter text could not be loaded from this source.",
        prevChapterSlug: currentNum > 1 ? `chapter-${currentNum - 1}` : null,
        nextChapterSlug: `chapter-${currentNum + 1}`,
        source: "novelfull"
      };
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. WEBNOVEL REPOSITORY (Alternate Mirror)
// ─────────────────────────────────────────────────────────────────────────────
const WebNovel = {
  ...NovelFire,
  async getHome(page = 1) {
    const res = await NovelFire.getHome(page);
    return {
      ...res,
      source: "webnovel",
      rankings: (res.rankings || []).map(p => ({ ...p, source: "webnovel" })),
      popular: (res.popular || []).map(p => ({ ...p, source: "webnovel" })),
      latest: (res.latest || []).map(p => ({ ...p, source: "webnovel" })),
    };
  },
  async search(query, page = 1) {
    const res = await NovelFire.search(query, page);
    return res.map(p => ({ ...p, source: "webnovel" }));
  },
  async getDetail(slug) {
    const res = await NovelFire.getDetail(slug);
    return { ...res, source: "webnovel" };
  },
  async getChapters(slug, page = 1) {
    const res = await NovelFire.getChapters(slug, page);
    return { ...res, source: "webnovel" };
  },
  async getChapterContent(novelSlug, chapterSlug) {
    const res = await NovelFire.getChapterContent(novelSlug, chapterSlug);
    return { ...res, source: "webnovel" };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. LNORI REPOSITORY (light-novel library, https://lnori.com)
//    Port of the Android app's LnoriRepository.kt. Workers have no DOM/Jsoup, so the same
//    selectors are applied with small regex helpers. A "chapter" here is one light-novel VOLUME;
//    its text can contain images, which are emitted as "[img]url[/img]" paragraphs.
//    Slugs never contain "/" (it is swapped for "~") so they survive being a single URL segment:
//      series  "3343/re-zero-…"        <->  "3343~re-zero-…"
//      volume  "book/12040/some-slug"  <->  "12040~some-slug"
// ─────────────────────────────────────────────────────────────────────────────
const decodeEntities = (s = "") =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** All attributes of one opening tag, lower-cased names, entity-decoded values. */
function tagAttrs(openTag) {
  const out = {};
  for (const m of openTag.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? "");
  return out;
}

const hasClass = (attrs, cls) => (attrs.class || "").split(/\s+/).includes(cls);

const Lnori = {
  baseUrl: "https://lnori.com",
  cdn: "https://cdn.lnori.com",
  _catalog: null,
  _catalogAt: 0,
  _inflight: null,

  absolute(u) {
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("//")) return "https:" + u;
    return this.cdn + (u.startsWith("/") ? "" : "/") + u;
  },
  site(u) {
    if (!u) return "";
    return /^https?:\/\//i.test(u) ? u : this.baseUrl + (u.startsWith("/") ? "" : "/") + u;
  },

  async fetchHtml(url) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(
          url,
          {
            headers: { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Referer": this.baseUrl },
            redirect: "follow",
          },
          20000,
        );
        if (!res.ok) throw new Error(`Lnori fetch failed: ${res.status} for ${url}`);
        return await res.text();
      } catch (e) {
        lastErr = e;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 350));
      }
    }
    throw lastErr || new Error(`Lnori fetch failed for ${url}`);
  },

  /** Every <article ...>…</article> block as { attrs, html }. */
  articles(html) {
    const list = [];
    for (const m of html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)) list.push({ attrs: tagAttrs(m[1]), html: m[2] });
    return list;
  },

  /** Best real URL of one <img> tag: lazy-load attributes beat a data: placeholder; srcset is the last resort. */
  imgSrc(tag) {
    const a = tagAttrs(tag);
    const pick = [a["data-src"], a["data-lazy-src"], a["data-original"], a["data-url"], a.src].find((v) => v && !/^data:/i.test(v.trim()));
    let src = (pick || "").trim();
    if (!src && a.srcset) src = (a.srcset.split(",")[0] || "").trim().split(/\s+/)[0];
    if (!src && a["data-srcset"]) src = (a["data-srcset"].split(",")[0] || "").trim().split(/\s+/)[0];
    if (!src) return "";
    if (/^https?:\/\//i.test(src) || src.startsWith("//")) return this.absolute(src);
    // relative: image folders live on the CDN, anything else on the site
    return /^\/?(volume|cover|covers|img|images|illust|assets)\//i.test(src) ? this.absolute(src) : this.site(src);
  },

  firstImage(html) {
    const tag = html.match(/<img\b[^>]*>/i)?.[0];
    return tag ? this.imgSrc(tag) : "";
  },

  /** "/series/3343/re-zero" -> "3343~re-zero" */
  seriesSlug(href) {
    const rest = href.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/?series\//, "").replace(/^\/+|\/+$/g, "").split("?")[0];
    return rest.replace(/\//g, "~");
  },
  seriesPath(slug) {
    return String(slug).replace(/^\/?series\//, "").replace(/~/g, "/");
  },
  /** "/book/12040/some-slug" -> "12040~some-slug" */
  bookSlug(href) {
    const rest = href.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/?book\//, "").replace(/^\/+|\/+$/g, "").split("?")[0];
    return rest.replace(/\//g, "~");
  },
  bookPath(slug) {
    return String(slug).replace(/^\/?book\//, "").replace(/~/g, "/");
  },

  async getCatalog() {
    if (this._catalog && Date.now() - this._catalogAt < 3600e3) return this._catalog;
    if (this._inflight) return this._inflight;
    this._inflight = (async () => {
      try {
        const html = await this.fetchHtml(`${this.baseUrl}/library`);
        const entries = [];
        const seen = new Set();
        for (const { attrs, html: inner } of this.articles(html)) {
          if (!hasClass(attrs, "card") || !attrs["data-id"]) continue;
          const id = attrs["data-id"].trim();
          if (!id || seen.has(id)) continue;

          let title = (attrs["data-t"] || "").trim();
          if (!title) title = cleanText(inner.match(/<(?:h2|h3)\b[^>]*>([\s\S]*?)<\/(?:h2|h3)>/i)?.[1] || "");
          if (!title) continue;

          const href = inner.match(/<a\b[^>]*href=["']([^"']*\/series\/[^"']*)["']/i)?.[1] || "";
          const slug = (href ? this.seriesSlug(href) : "") || id;
          const desc = cleanText(inner.match(/<[^>]*class=["'][^"']*(?:popup-description|card-description)[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/i)?.[1] || "");

          seen.add(id);
          entries.push({
            id,
            slug,
            title: decodeEntities(title),
            author: (attrs["data-a"] || "").trim(),
            year: (attrs["data-d"] || "").trim(),
            volumes: parseInt(attrs["data-v"], 10) || 1,
            tags: (attrs["data-tags"] || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
            relevance: parseInt(attrs["data-rel"], 10) || 0,
            cover: this.firstImage(inner),
            description: desc,
          });
        }
        if (entries.length) {
          this._catalog = entries;
          this._catalogAt = Date.now();
          return entries;
        }
      } catch (e) {
        console.warn("Lnori catalog error:", e.message);
      } finally {
        this._inflight = null;
      }
      return this._catalog || [];
    })();
    return this._inflight;
  },

  toItem(e) {
    const stats = [e.volumes > 0 ? `${e.volumes} Vols` : "", e.year, e.author].filter(Boolean).join(" • ");
    return {
      id: e.slug,
      slug: e.slug,
      title: e.title,
      cover: e.cover,
      stats: stats || null,
      rating: null,
      genres: e.tags.slice(0, 6).map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase())),
      format: "LIGHT NOVEL",
      source: "lnori",
    };
  },

  byRelevance(list) {
    return [...list].sort((a, b) => b.relevance - a.relevance);
  },
  byNewest(list) {
    const key = (e) => (parseInt(e.year, 10) || 0) * 1e6 + (parseInt(e.id, 10) || 0);
    return [...list].sort((a, b) => key(b) - key(a));
  },

  async getHome(page = 1) {
    const catalog = await this.getCatalog();
    if (!catalog.length) throw new Error("Lnori library is unreachable right now");
    const pop = this.byRelevance(catalog);
    const start = (Math.max(1, page) - 1) * 30;
    return {
      rankings: pop.slice(0, 15).map((e) => this.toItem(e)),
      popular: pop.slice(start, start + 30).map((e) => this.toItem(e)),
      latest: this.byNewest(catalog).slice(0, 30).map((e) => this.toItem(e)),
      source: "lnori",
    };
  },

  async search(query, page = 1) {
    const q = normalizeNovelSearch(query);
    const catalog = await this.getCatalog();
    const scored = q
      ? catalog
          .map((e) => ({ e, score: scoreNovelMatch(e, q) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score || b.e.relevance - a.e.relevance)
          .map((x) => x.e)
      : [...catalog].sort((a, b) => b.relevance - a.relevance);
    return scored.slice((Math.max(1, page) - 1) * 24, Math.max(1, page) * 24).map((e) => this.toItem(e));
  },

  async resolveSeriesUrl(slug) {
    const path = this.seriesPath(slug);
    if (path.includes("/")) return `${this.baseUrl}/series/${path}`;
    const catalog = await this.getCatalog();
    const clean = path.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const hit = catalog.find((e) => {
      if (e.id === path || e.slug === path) return true;
      if (e.slug.startsWith(`${path}~`) || e.slug.endsWith(`~${path}`) || e.slug.includes(path)) return true;
      const eClean = e.slug.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const titleClean = (e.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      return Boolean(clean && (eClean.includes(clean) || titleClean.includes(clean)));
    });
    return `${this.baseUrl}/series/${hit ? hit.slug.replace(/~/g, "/") : path}`;
  },

  /** Volumes of a series page: HTML cards first, then JSON-LD hasPart, then bare /book/ links. */
  parseVolumes(html) {
    const out = [];
    const seen = new Set();
    const push = (href, title, cover) => {
      const slug = this.bookSlug(href);
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      const n = out.length + 1;
      out.push({ slug, title: title || `Volume ${n}`, number: String(n), cover: cover || null });
    };

    for (const { attrs, html: inner } of this.articles(html)) {
      if (!hasClass(attrs, "card") && !attrs["data-id"]) continue;
      const a = inner.match(/<a\b[^>]*href=["']([^"']*\/book\/[^"']*)["'][^>]*>/i);
      if (!a) continue;
      const aAttrs = tagAttrs(a[0]);
      const title = cleanText(inner.match(/<[^>]*class=["'][^"']*(?:card-title|popup-title)[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/i)?.[1] || "") || (aAttrs["aria-label"] || "").trim();
      const vol = (attrs["data-id"] || "").trim();
      push(a[1], decodeEntities(title), this.firstImage(inner) || (vol ? `${this.cdn}/cover/${vol}.webp` : ""));
    }
    if (out.length) return out;

    for (const m of html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const obj = JSON.parse(m[1].trim());
        for (const part of obj.hasPart || []) {
          if (!part?.url) continue;
          const vol = this.bookSlug(part.url).split("~")[0];
          push(part.url, String(part.name || "").trim(), /^\d+$/.test(vol) ? `${this.cdn}/cover/${vol}.webp` : "");
        }
      } catch {}
      if (out.length) return out;
    }

    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']*\/book\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = cleanText(m[2]);
      const vol = this.bookSlug(m[1]).split("~")[0];
      push(m[1], text && !/start reading/i.test(text) ? text : "", /^\d+$/.test(vol) ? `${this.cdn}/cover/${vol}.webp` : "");
    }
    return out;
  },

  async getDetail(slug) {
    const url = await this.resolveSeriesUrl(slug);
    let html;
    try {
      html = await this.fetchHtml(url);
    } catch {
      throw new Error("Series not found on Lnori");
    }

    let title = "", author = "", desc = "", cover = "", genres = [], parts = 0;
    for (const m of html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const obj = JSON.parse(m[1].trim());
        if (obj["@type"] !== "Book") continue;
        title = String(obj.name || "").trim();
        author = (typeof obj.author === "object" ? obj.author?.name : obj.author) || "";
        desc = String(obj.description || "");
        cover = typeof obj.image === "string" ? obj.image : obj.image?.url || "";
        genres = Array.isArray(obj.genre) ? obj.genre.map(String) : obj.genre ? [String(obj.genre)] : [];
        parts = Array.isArray(obj.hasPart) ? obj.hasPart.length : 0;
        break;
      } catch {}
    }

    const volumes = this.parseVolumes(html);
    if (!title) title = cleanText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
    if (!title || /404|not found/i.test(title)) throw new Error("Series not found on Lnori");
    if (!parts && !volumes.length && !desc) throw new Error("Series not found on Lnori");
    if (!author) author = cleanText(html.match(/<[^>]*class=["'][^"']*(?:hero-author|author)[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/i)?.[1] || "");
    if (!desc) desc = cleanText(html.match(/<[^>]*class=["'][^"']*(?:description|synopsis)[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/i)?.[1] || html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");

    // The library card has the authentic portrait cover; the series page often only has a wide hero.
    const key = this.seriesPath(slug).split("/")[0];
    const entry = (await this.getCatalog()).find((e) => e.id === key || e.slug === slug || e.slug.startsWith(`${key}~`));
    if (entry?.cover) cover = entry.cover;
    if (!cover || cover.includes("/series/")) cover = this.firstImage(html.match(/<(?:div|figure)\b[^>]*class=["'][^"']*(?:hero-card|cover-wrap|card-cover|series-cover|cover)[^"']*["'][\s\S]*?<\/(?:div|figure)>/i)?.[0] || "") || cover;
    if ((!cover || cover.includes("/series/")) && volumes[0]?.cover) cover = volumes[0].cover;

    return {
      id: slug,
      slug,
      title: decodeEntities(title),
      cover: this.absolute(cover),
      author: decodeEntities(author) || entry?.author || "Unknown",
      synopsis: decodeEntities(desc) || entry?.description || "No synopsis available.",
      genres: (genres.length ? genres : entry?.tags || []).slice(0, 10).map((g) => String(g).replace(/\b\w/g, (c) => c.toUpperCase())),
      source: "lnori",
    };
  },

  async getChapters(slug) {
    const url = await this.resolveSeriesUrl(slug);
    let volumes = [];
    try {
      volumes = this.parseVolumes(await this.fetchHtml(url));
    } catch {}
    return { slug, total: volumes.length, totalPages: 1, chapters: volumes, source: "lnori" };
  },

  async getChapterContent(novelSlug, chapterSlug) {
    const fail = (error) => ({ novelSlug, chapterSlug, title: "Volume", paragraphs: [], error, prevChapterSlug: null, nextChapterSlug: null, source: "lnori" });
    let path = this.bookPath(chapterSlug);
    let resolvedSlug = chapterSlug;

    // If path is not already in valid Lnori "id/slug" format (e.g. "14966/classroom-of-the-elite-vol-1"), resolve from chapter list
    if (!/^\d+\/[^/]+/.test(path)) {
      try {
        const chs = await this.getChapters(novelSlug);
        const list = chs?.chapters || [];
        const normKey = String(chapterSlug).toLowerCase().replace(/[^a-z0-9]/g, "");
        const numMatch = String(chapterSlug).match(/\d+/)?.[0];
        const match = list.find((c) => {
          if (c.slug === chapterSlug) return true;
          if (c.slug.startsWith(`${chapterSlug}~`) || c.slug.endsWith(`~${chapterSlug}`)) return true;
          if (c.number === String(chapterSlug)) return true;
          if (numMatch && c.number === numMatch) return true;
          const cNorm = String(c.slug).toLowerCase().replace(/[^a-z0-9]/g, "");
          const titleNorm = String(c.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          return cNorm.includes(normKey) || normKey.includes(cNorm) || (titleNorm && titleNorm === normKey);
        }) || (/^(vol(ume)?-?)?1$/i.test(chapterSlug) ? list[0] : null);
        if (match?.slug) {
          path = this.bookPath(match.slug);
          resolvedSlug = match.slug;
        }
      } catch {}
    }

    let html;
    try {
      html = await this.fetchHtml(`${this.baseUrl}/book/${path}`);
    } catch {
      return fail("This volume could not be loaded from Lnori.");
    }

    const title = cleanText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "") || `Volume ${path.split("/")[0]}`;
    const body =
      html.match(/<article\b[^>]*class=["'][^"']*content-body[^"']*["'][^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
      html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
      html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
      "";
    if (!body) return fail("This volume has no readable text.");

    const BAD_IMG = /avatar|favicon|\/icons?\/|\.ico(\?|$)|logo|spinner|loading\.|pixel\.gif|img\.lnori\.com/i;
    const paragraphs = [];
    const seenImg = new Set();
    const addImg = (tag) => {
      const src = this.imgSrc(tag);
      if (!src || BAD_IMG.test(src) || seenImg.has(src)) return;
      seenImg.add(src);
      const attrs = tagAttrs(tag);
      const alt = (attrs.alt || attrs.title || "").trim();
      paragraphs.push(alt ? `[img]${src}|${alt}[/img]` : `[img]${src}[/img]`);
    };

    // cover first
    const cover = html.match(/<img\b[^>]*(?:src|data-src)=["'][^"']*\/volume\/[^"']*["'][^>]*>/i)?.[0];
    const og = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
    if (cover) addImg(cover);
    else if (og) {
      const src = this.absolute(decodeEntities(og));
      seenImg.add(src);
      paragraphs.push(`[img]${src}[/img]`);
    }

    // illustrations that sit in the page before the text body (character sheets, colour plates, ...)
    const bodyAt = html.search(/<article\b[^>]*class=["'][^"']*content-body/i);
    if (bodyAt > 0) {
      for (const m of html.slice(0, bodyAt).matchAll(/<img\b[^>]*>/gi)) if (/cdn\.lnori\.com/i.test(this.imgSrc(m[0]))) addImg(m[0]);
    }

    // the body, in reading order: headings, paragraphs (text and any number of images inside), rules, bare images
    const text = (t) => {
      const v = cleanText(decodeEntities(t));
      if (v) paragraphs.push(v);
    };
    const clean = body.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, "");
    for (const m of clean.matchAll(/<(h[1-6]|p|figure)\b[^>]*>([\s\S]*?)<\/\1>|<hr\b[^>]*>|<img\b[^>]*>/gi)) {
      const tag = (m[1] || m[0].match(/^<(\w+)/)[1]).toLowerCase();
      if (tag === "hr") paragraphs.push("* * *");
      else if (tag === "img") addImg(m[0]);
      else if (tag === "p" || tag === "figure") {
        // walk the inner html so text and images keep their order
        let last = 0;
        const inner = m[2];
        for (const im of inner.matchAll(/<img\b[^>]*>/gi)) {
          text(inner.slice(last, im.index));
          addImg(im[0]);
          last = im.index + im[0].length;
        }
        text(inner.slice(last));
      } else {
        const t = cleanText(decodeEntities(m[2]));
        if (t && t.length < 120) paragraphs.push(`== ${t} ==`);
      }
    }

    // Clean and deduplicate scene breaks
    const isSepCheck = (str) => /^(?:\*\s*){3,}$/.test((str || "").trim());
    const cleanParas = [];
    for (const p of paragraphs) {
      const isSep = isSepCheck(p);
      if (isSep) {
        if (cleanParas.length === 0) continue;
        const prev = cleanParas[cleanParas.length - 1];
        if (isSepCheck(prev) || prev.trim().startsWith("==") || prev.trim().startsWith("[img]")) continue;
        cleanParas.push("* * *");
        continue;
      } else if (p.trim().startsWith("==") && cleanParas.length > 0 && isSepCheck(cleanParas[cleanParas.length - 1])) {
        cleanParas.pop();
      }
      cleanParas.push(p);
    }
    while (cleanParas.length > 0 && isSepCheck(cleanParas[cleanParas.length - 1])) {
      cleanParas.pop();
    }

    let prevChapterSlug = null;
    let nextChapterSlug = null;
    try {
      const toc = await this.getChapters(novelSlug);
      const list = toc?.chapters || [];
      const curIdx = list.findIndex((c) => c.slug === chapterSlug || c.slug === resolvedSlug || this.bookPath(c.slug) === path);
      if (curIdx > 0) prevChapterSlug = list[curIdx - 1]?.slug || null;
      if (curIdx >= 0 && curIdx < list.length - 1) nextChapterSlug = list[curIdx + 1]?.slug || null;
    } catch {}

    return {
      novelSlug,
      chapterSlug,
      title,
      paragraphs: cleanParas,
      error: cleanParas.length ? undefined : "This volume has no readable text.",
      prevChapterSlug,
      nextChapterSlug,
      source: "lnori",
    };
  },
};

export default {
  getSource(src = "novelfire") {
    const s = (src || "novelfire").toLowerCase().trim();
    if (s === "lnori") return Lnori;
    if (s === "novelfull") return NovelFull;
    if (s === "webnovel") return WebNovel;
    return NovelFire;
  },
  /** exposed for tests */
  _internals: { Lnori, tagAttrs }
};
