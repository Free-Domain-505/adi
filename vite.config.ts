import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { pipeWebBodySafe } from './server/streamSafety.js'

try {
  dns.setDefaultResultOrder('ipv4first')
} catch {}

function readDotEnvFile(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const k = trimmed.slice(0, eq).trim()
      let v = trimmed.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      out[k] = v
    }
  } catch {}
  return out
}

/** Serves /api/* and /proxy in dev with the same handler Cloudflare Pages Functions use in production. */
function animeStreamApi(): Plugin {
  return {
    name: 'animestream-api',
    configureServer(server) {
      const loadedEnv = loadEnv(server.config.mode, process.cwd(), '')
      const dotEnv = readDotEnvFile()
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/') && url !== '/api' && !url.startsWith('/proxy')) return next()
        const reqAbort = new AbortController()
        const onResClose = () => {
          if (!res.writableFinished) reqAbort.abort()
        }
        res.on('close', onResClose)
        try {
          const reqHost = req.headers.host || 'localhost:3000'
          if (url.startsWith('/api/providers')) {
            const { onRequest } = await server.ssrLoadModule('/functions/api/providers.ts')
            const out: Response = await onRequest({ request: new Request(`http://${reqHost}${url}`, { method: req.method, signal: reqAbort.signal }) })
            res.writeHead(out.status, Object.fromEntries(out.headers))
            res.end(Buffer.from(await out.arrayBuffer()))
            return
          }
          const { handle } = await server.ssrLoadModule('/server/handler.js')
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
          // POST bodies (e.g. /api/stream/decrypt) must reach the handler too
          let body: string | undefined
          if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks: Buffer[] = []
            for await (const c of req) chunks.push(Buffer.from(c as Uint8Array))
            body = Buffer.concat(chunks).toString('utf8')
          }
          const out: Response | null = await handle(new Request(`http://${reqHost}${url}`, { method: req.method, headers, body, signal: reqAbort.signal }), {
            SHIELD_SECRET: dotEnv.SHIELD_SECRET || process.env.SHIELD_SECRET || loadedEnv.SHIELD_SECRET,
            VITE_SUPABASE_URL: dotEnv.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || loadedEnv.VITE_SUPABASE_URL,
            SUPABASE_URL: dotEnv.SUPABASE_URL || dotEnv.VITE_SUPABASE_URL || process.env.SUPABASE_URL || loadedEnv.SUPABASE_URL || loadedEnv.VITE_SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: dotEnv.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || loadedEnv.SUPABASE_SERVICE_ROLE_KEY,
            IS_DEV: true,
          })
          if (!out) return next()
          res.writeHead(out.status, Object.fromEntries(out.headers))
          if (out.body) pipeWebBodySafe(out.body, res)
          else res.end()
        } catch (e) {
          if (!res.headersSent && !res.writableEnded) {
            res.statusCode = 500
            res.end(String(e))
          } else if (!res.writableEnded) {
            res.destroy()
          }
        }
      })
    },
  }
}

/** Public pages for the sitemap (personal pages such as /profile and /list are left out on purpose). */
const PAGES: Array<[path: string, freq: string, priority: string]> = [
  ['/', 'weekly', '1.0'],
  ['/home', 'daily', '0.9'],
  ['/trending', 'daily', '0.8'],
  ['/popular', 'daily', '0.8'],
  ['/top', 'weekly', '0.7'],
  ['/browse', 'daily', '0.8'],
  ['/schedule', 'daily', '0.7'],
  ['/movies', 'daily', '0.9'],
  ['/movies/browse', 'daily', '0.7'],
  ['/manga', 'daily', '0.9'],
  ['/manga/browse', 'daily', '0.7'],
  ['/novel', 'daily', '0.9'],
]

/**
 * Site URL for absolute links (share image, canonical, sitemap). Set VITE_SITE_URL to your domain;
 * Cloudflare Pages / Vercel URLs are picked up automatically when it is not set.
 */
const SITE_URL = (
  process.env.VITE_SITE_URL ||
  process.env.CF_PAGES_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
  'https://animestream.pages.dev'
).replace(/\/$/, '')

/** Fills %SITE_URL% in index.html and writes sitemap.xml + robots.txt into the build. */
function animeStreamSeo(): Plugin {
  return {
    name: 'animestream-seo',
    enforce: 'pre',
    transformIndexHtml: (html) => html.split('%SITE_URL%').join(SITE_URL),
    generateBundle() {
      const day = new Date().toISOString().slice(0, 10)
  
      const urls = PAGES.map(
        ([path, freq, pr]) =>
          `  <url>\n    <loc>${SITE_URL}${path}</loc>\n    <lastmod>${day}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${pr}</priority>${path === '/' ? `\n    <image:image>\n      <image:loc>${SITE_URL}/og-image.jpg</image:loc>\n      <image:title>AnimeStream — Watch Anime Online Free in HD, Movies &amp; Read Manga</image:title>\n    </image:image>` : ''}\n  </url>`,
      ).join('\n')
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls}\n</urlset>\n`,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /proxy\nDisallow: /profile\nDisallow: /list\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
      })
    },
  }
}

const dotEnv = readDotEnvFile()

export default defineConfig({
  define: {
    ...(dotEnv.VITE_SUPABASE_URL
      ? { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(dotEnv.VITE_SUPABASE_URL) }
      : {}),
    ...(dotEnv.VITE_SUPABASE_ANON_KEY
      ? { 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(dotEnv.VITE_SUPABASE_ANON_KEY) }
      : {}),
  },
  plugins: [react(), tailwindcss(), animeStreamApi(), animeStreamSeo()],
  build: {
    cssMinify: false,
  },
  resolve: {
    alias: {
      'hls.js': 'hls.js/dist/hls.js',
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: {
      ignored: [
        '**/.playwright-cli/**',
        '**/scripts/**',
        '**/standalone-proxy/**',
        '**/tests/**',
      ],
    },
  },
  preview: { host: '0.0.0.0', port: 3000, allowedHosts: true },
})
