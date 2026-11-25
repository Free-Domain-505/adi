<div align="center">

<img src="public/logo.png" alt="AnimeStream logo" width="112" height="112" />

# AnimeStream

**Watch anime, donghua, movies & TV shows. Read manga, manhwa & novels. Stream together in HD.**

[![License: MIT](https://img.shields.io/badge/license-MIT-e8294c?style=for-the-badge)](LICENSE)

</div>

---

## Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [API Routes](#api-routes)
- [App Routes](#app-routes)
- [Keyboard & TV Remote](#keyboard--tv-remote)
- [Deployment](#deployment)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## Features

AnimeStream brings multiple entertainment hubs together inside one fast, responsive web application:

| Section | Description |
| ------- | ----------- |
| **Anime** | Trending, popular, and top-rated shelves, airing schedules in local time, sub/dub/multi-audio playback, intro/outro skip, captions, and optional Anime4K WebGPU upscaling |
| **Donghua** | Dedicated Chinese animation catalog, browsing filters, episode playback, and tracking |
| **Movies & TV** | TMDB-powered browse/search, detailed media pages, multi-server playback (`SERVER 1` CinemaOS, `SERVER 2` MovieBox, `SERVER 3` VidZee), plus Anime Movie mode |
| **Manga & Manhwa** | Multi-source browse and reader with vertical webtoon, LTR, and RTL modes and saved reading progress |
| **Novels** | Web novel & light novel search, chapter lists, and customizable distraction-free reader |
| **Community & Watch Together** | Public community feed, 1-on-1 direct messaging, WebRTC voice calls, synchronized Watch Together rooms, custom profile themes, avatar frames, and animated name gradients |

Additional highlights:
- **Custom CinePlayer** built on `hls.js` with multi-audio track switching, subtitle styling, skip-intro/outro prompts, and smart TV / D-pad support.
- **Account Sync** powered by Supabase authentication, profile customization, watchlists, and optional AniList sync.
- **Command-Palette Search** (`Ctrl/Cmd + K` or `/`) across anime, donghua, movies, manga, manhwa, and novels.
- **Light & Dark Themes** with adaptive section accents, desktop glass navigation, and mobile bottom dock.

---

## Quick Start

Requires [Node.js](https://nodejs.org) **20+** and `npm`.

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev` launches Vite on `http://localhost:3000` with `/api/*` and `/proxy` served automatically through the Vite middleware (`server/handler.js`).

### Scripts

| Command | Purpose |
| ------- | ------- |
| `npm run dev` | Start development server with integrated API & stream proxy on port `3000` |
| `npm run build` | Type-check (`tsc --noEmit`) and build production assets to `dist/` |
| `npm run preview` | Preview the production build locally on port `3000` |
| `npm run lint` | Run TypeScript type verification (`tsc --noEmit`) |
| `npm test` | Run unit tests via `tsx --test tests/*.test.ts` |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the variables you need:

| Variable | Scope | Purpose |
| -------- | ----- | ------- |
| `VITE_SUPABASE_URL` | Client | Supabase project URL for authentication, profiles, community, and lists |
| `VITE_SUPABASE_ANON_KEY` | Client | Supabase publishable/anon key |
| `VITE_ANILIST_CLIENT_ID` | Client | AniList OAuth client ID (redirect URI: `/auth/anilist`) |
| `VITE_SITE_URL` | Build | Canonical public URL for OpenGraph tags, sitemap, and robots.txt |
| `VITE_API_BASE` | Client | Optional external API origin if frontend and backend are hosted separately |
| `VITE_STREAM_PROXY_URL` / `STREAM_PROXY_URL` | Client / Server | Optional external stream proxy URL |
| `VITE_MOVIEBOX_PROXY_URL` | Client | Optional external MovieBox proxy origin |
| `TMDB_API_KEY` / `TMDB_BEARER_TOKEN` | Server | Optional TMDB credentials for movie & TV metadata |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Optional Supabase service role key for server-side operations |
| `SHIELD_SECRET` | Server | Optional proof-of-work API guard secret |
| `GITHUB_TOKEN` | Server | Optional GitHub token for release metadata requests |

---

## Project Structure

```text
src/
  pages/            Route pages (Landing, Home, Donghua, Details, Watch, Movies, Manga, Manhwa, Novel, Community, Messages, Profile)
  components/       UI components, navigation bars, cards, and CinePlayer
  services/         API, streaming, TMDB, AniList, Jikan, and Supabase clients
  hooks/            Data fetching and playback hooks
  lib/              Server definitions, subtitle/audio helpers, mappers, and utilities
server/             Web-standard API handler and stream/proxy/metadata resolvers
functions/          Cloudflare Pages Functions wrappers around server/handler.js
public/             Static assets, logo.png, anime mappings, and avatar frames
tests/              Automated unit test suite
```

Built with **React 18**, **TypeScript**, **Vite**, **Tailwind CSS v4**, **Framer Motion**, **hls.js**, and **Supabase**.

---

## API Routes

All backend endpoints are handled by `server/handler.js` (used both locally in Vite dev and in Cloudflare Pages Functions):

| Route | Purpose |
| ----- | ------- |
| `/api/stream` | Direct HLS & multi-audio anime stream resolver |
| `/proxy` (`/api/proxy`) | Header-spoofing stream & HLS manifest proxy |
| `/api/movies/*` | Movie & TV catalog, search, details, and stream resolution |
| `/api/providers` | Registered movie/TV provider URL resolver |
| `/api/mapping/:anilistId` | Cross-database anime ID mapping (AniList, MAL, TMDB, TVDB, IMDb, AniDB) |
| `/api/tmdb` | TMDB artwork, logos, and metadata |
| `/api/subtitles` | Subtitle lookup and proxying |
| `/api/manga/*` | Manga and manhwa browse, search, details, chapters, and pages |
| `/api/novel/*` | Light novel and web novel catalog, chapters, and reader content |

---

## App Routes

| Path | Page |
| ---- | ---- |
| `/` | Landing hub selector (Anime, Donghua, Movies, Manga, Manhwa, Novels) |
| `/home` · `/donghua` | Anime & Donghua homepages |
| `/trending` · `/popular` · `/top` · `/browse` | Catalog & filter views |
| `/schedule` | Airing schedule in local timezone |
| `/anime/:id` · `/mal/:id` | Anime details, episodes, watch order, and stats |
| `/watch/:id` | Anime & Donghua video player |
| `/movies` · `/movies/browse` · `/movies/:type/:id` | Movies & TV discovery and details |
| `/movies/watch/:type/:id` | Movie & TV video player |
| `/manga` · `/manga/:id` · `/manga/:id/read/:chapterId` | Manga discovery and reader |
| `/manhwa` · `/manhwa/:id` · `/manhwa/:id/read/:chapterId` | Manhwa discovery and reader |
| `/novel` · `/novel/:source/:slug` | Novels discovery and reader |
| `/community` · `/messages` · `/watchparty` | Community feed, direct messages, and Watch Together |
| `/list` · `/profile` · `/profile/name-style` | Library lists, profile settings, and name style customizer |

---

## Keyboard & TV Remote

Press **`?`** anywhere in the app to view all shortcuts.

- **Global**: `/` or `Ctrl/Cmd + K` (Search) · `?` (Shortcuts)
- **Player**: `Space`/`K` (Play/Pause) · `←`/`→` (Seek ±10s) · `↑`/`↓` (Volume) · `M` (Mute) · `C` (Captions) · `F` (Fullscreen) · `I` (PiP) · `N`/`P` (Next/Previous episode)
- **Manga / Novel Readers**: `←`/`→` (Pages/Chapters) · `[`/`]` (Chapters) · `F` (Fullscreen)
- **TV Mode**: Automatic detection on smart TVs (or toggle with `?tv=1` / `?tv=0`) for D-pad focus navigation.

---

## Deployment

AnimeStream is pre-configured for **Cloudflare Pages** (`wrangler.toml`):

- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Functions directory**: `functions/` (automatically deployed alongside `dist`)

```bash
npm run build
npx wrangler pages deploy dist --project-name animestream
```

---

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.

---

## Disclaimer

AnimeStream does not host, upload, or store any video, manga, or novel media files on its own servers. It aggregates publicly available metadata and interfaces with external third-party sources. All trademarks and media belong to their respective owners.
