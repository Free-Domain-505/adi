import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildMovieEmbedCandidates,
  sanitizeCinemaOsCss,
  sanitizeCinemaOsHtml,
  sanitizeCinemaOsJs,
} from '../server/detectStreamLogic.js';
import {
  buildCinemaOsEmbedUrl,
  buildCinemaOsFrameUrl,
  buildEmbedCandidates,
  buildVidzeeEmbedUrl,
  EMBED_POPUP_BLOCKED_SANDBOX,
  isDirectFileMediaUrl,
  isPotentialAnimeTmdbMovie,
  maskMovieServerLabel,
  MOVIE_WATCH_SERVER_SLOTS,
  resolveActiveMovieSlotKey,
} from '../src/lib/movieServers.ts';
import { listProviders, providerUrl } from '../src/lib/providers.ts';

test('CinemaOS is Priority #1 across server, client, and provider registries', () => {
  const movieProviders = listProviders('movie');
  assert.equal(movieProviders[0].id, 'cinemaos');
  const tvProviders = listProviders('tv');
  assert.equal(tvProviders[0].id, 'cinemaos');
  assert.equal(providerUrl('cinemaos', 'movie', 533535, 1, 1), 'https://cinemaos.tech/player/533535?lang=en');
  assert.equal(providerUrl('cinemaos', 'tv', 66732, 2, 4), 'https://cinemaos.tech/player/66732/2/4?lang=en');

  const serverMovie = buildMovieEmbedCandidates({ type: 'movie', tmdbId: 533535 });
  assert.equal(serverMovie[0].id, 'cinemaos');
  assert.equal(serverMovie[0].priority, 1);
  assert.equal(serverMovie[0].url, 'https://cinemaos.tech/player/533535?lang=en');

  const serverTv = buildMovieEmbedCandidates({ type: 'tv', tmdbId: 66732, season: 2, episode: 4 });
  assert.equal(serverTv[0].id, 'cinemaos');
  assert.equal(serverTv[0].url, 'https://cinemaos.tech/player/66732/2/4?lang=en');

  const clientMovie = buildEmbedCandidates({ type: 'movie', tmdbId: 533535 });
  assert.equal(clientMovie[0].id, 'cinemaos');
  assert.equal(
    buildCinemaOsFrameUrl({ type: 'movie', tmdbId: 533535, lang: 'en' }),
    '/api/movies/cinemaos-frame?type=movie&id=533535&lang=en',
  );
  assert.equal(
    buildCinemaOsFrameUrl({ type: 'tv', tmdbId: 66732, season: 2, episode: 4, lang: 'en' }),
    '/api/movies/cinemaos-frame?type=tv&id=66732&lang=en&s=2&e=4',
  );
});

test('CinemaOS JS/CSS/HTML sanitizers strip onclick/popunder ads and remove backdrop-blur', () => {
  const dirtyJs = `var s="https://wz.afgodscarpe.com/ryRZVErvkj1gAr/126965"; var p="//cdn.popads.net/pop.js";`;
  const cleanJs = sanitizeCinemaOsJs(dirtyJs);
  assert.equal(cleanJs.includes('afgodscarpe'), false);
  assert.equal(cleanJs.includes('popads'), false);

  const dirtyCss = `.ctrl{backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);--tw-backdrop-blur:blur(12px);background:url('/_next/static/media/bg.png');}`;
  const cleanCss = sanitizeCinemaOsCss(dirtyCss);
  assert.equal(cleanCss.includes('backdrop-filter:blur(16px)'), false);
  assert.ok(cleanCss.includes('backdrop-filter:none!important'));
  assert.ok(cleanCss.includes('--tw-backdrop-blur:blur(0px)'));
  assert.ok(cleanCss.includes('/api/movies/cinemaos-proxy?path=%2F_next%2Fstatic%2Fmedia%2Fbg.png'));

  const dirtyHtml = `<!doctype html><html><head><link rel="preload" href="//wz.afgodscarpe.com/ad.js"><script src="https://wz.afgodscarpe.com/pop.js"></script><link rel="stylesheet" href="/_next/static/css/app.css"></head><body><script src="/_next/static/chunks/main.js"></script></body></html>`;
  const cleanHtml = sanitizeCinemaOsHtml(dirtyHtml, { playerPath: '/player/533535', lang: 'en' });
  assert.equal(cleanHtml.includes('afgodscarpe.com/ad.js'), false);
  assert.equal(cleanHtml.includes('afgodscarpe.com/pop.js'), false);
  assert.ok(cleanHtml.includes('id="animestream-no-blur"'));
  assert.ok(cleanHtml.includes('backdrop-filter:none!important'));
  assert.ok(cleanHtml.includes('window.open=function(){return null;}'));
  assert.ok(cleanHtml.includes('a[target="_blank"]'));
  assert.ok(cleanHtml.includes('/api/movies/cinemaos-proxy?path=%2F_next%2Fstatic%2Fcss%2Fapp.css'));
  assert.ok(cleanHtml.includes('/api/movies/cinemaos-proxy?path=%2F_next%2Fstatic%2Fchunks%2Fmain.js'));
});

test('EMBED_POPUP_BLOCKED_SANDBOX forbids popups and top navigation', () => {
  assert.ok(EMBED_POPUP_BLOCKED_SANDBOX.includes('allow-same-origin'));
  assert.ok(EMBED_POPUP_BLOCKED_SANDBOX.includes('allow-scripts'));
  assert.equal(EMBED_POPUP_BLOCKED_SANDBOX.includes('allow-popups'), false);
  assert.equal(EMBED_POPUP_BLOCKED_SANDBOX.includes('allow-popups-to-escape-sandbox'), false);
  assert.equal(EMBED_POPUP_BLOCKED_SANDBOX.includes('allow-top-navigation'), false);
});

test('isPotentialAnimeTmdbMovie filters TMDB items properly before anime lookup', () => {
  assert.equal(
    isPotentialAnimeTmdbMovie({ type: 'movie', genres: [{ id: 16, name: 'Animation' }], language: 'ja' }),
    true,
  );
  assert.equal(
    isPotentialAnimeTmdbMovie({ type: 'movie', genreIds: [16, 18], language: 'en' }),
    true,
  );
  assert.equal(
    isPotentialAnimeTmdbMovie({ type: 'movie', genres: [{ id: 28, name: 'Action' }], language: 'ja' }),
    true,
  );
  assert.equal(
    isPotentialAnimeTmdbMovie({ type: 'movie', genres: [{ id: 28, name: 'Action' }], language: 'en' }),
    false,
  );
  assert.equal(
    isPotentialAnimeTmdbMovie({ type: 'tv', genres: [{ id: 16, name: 'Animation' }], language: 'ja' }),
    false,
  );
});

test('Player controls and dropdowns remove backdrop-blur', () => {
  const root = process.cwd();
  const serverDropdown = fs.readFileSync(path.join(root, 'src/components/ServerCategoryDropdown.tsx'), 'utf8');
  assert.equal(/backdrop-blur/.test(serverDropdown), false);

  const cinePlayerCss = fs.readFileSync(path.join(root, 'src/components/cineplayer.css'), 'utf8');
  assert.ok(cinePlayerCss.includes('backdrop-filter: none !important;'));
});

test('maskMovieServerLabel masks internal provider names into generic Server labels', () => {
  // CinemaOS is masked as Server 1, never leaking raw 'CinemaOS'
  assert.equal(maskMovieServerLabel('cinemaos'), 'Server 1');
  assert.equal(maskMovieServerLabel('cinemaos', 'CinemaOS'), 'Server 1');
  assert.equal(maskMovieServerLabel(null, 'CinemaOS'), 'Server 1');

  // MovieBox & Vidzee are masked as Server 2 and Server 3
  assert.equal(maskMovieServerLabel('moviebox'), 'Server 2');
  assert.equal(maskMovieServerLabel('moviebox', 'MovieBox Direct'), 'Server 2');
  assert.equal(maskMovieServerLabel('vidzee'), 'Server 3');
  assert.equal(maskMovieServerLabel('vidzee', 'Vidzee HD'), 'Server 3');

  // Other internal provider scrapers are masked as generic servers
  assert.equal(maskMovieServerLabel('vidup'), 'Server 4');
  assert.equal(maskMovieServerLabel('vidfast'), 'Server 5');
  assert.equal(maskMovieServerLabel('primesrc'), 'Server 6');
  assert.equal(maskMovieServerLabel('vidsrc-to'), 'Server 7');
  assert.equal(maskMovieServerLabel('autoembed'), 'Server 11');
  assert.equal(maskMovieServerLabel('vidnest-tv'), 'Server 18');

  // Sequential indices in active server lists format as Server 1, Server 2... even with pre-masked labels
  assert.equal(maskMovieServerLabel('cinemaos', 'CinemaOS', 0), 'Server 1');
  assert.equal(maskMovieServerLabel('moviebox', 'Server 1', 1), 'Server 2');
  assert.equal(maskMovieServerLabel('vidfast', 'VidFast', 1), 'Server 2');
  assert.equal(maskMovieServerLabel('primesrc', 'PrimeSrc', 2), 'Server 3');

  // Pre-masked labels are preserved when no explicit list index is passed
  assert.equal(maskMovieServerLabel('custom', 'Server 4'), 'Server 4');
  assert.equal(maskMovieServerLabel('custom', 'HD Server 1'), 'HD Server 1');

  // Verify that raw provider names NEVER leak in the output
  const leakedNames = ['CinemaOS', 'MovieBox', 'Vidzee', 'PrimeSrc', 'VidFast', 'VidSrc', 'AutoEmbed'];
  for (const name of leakedNames) {
    const masked = maskMovieServerLabel(name.toLowerCase(), name);
    assert.equal(masked.toLowerCase().includes(name.toLowerCase()), false);
    assert.match(masked, /^Server\s+\d+$/);
  }
});

test('MovieWatchPage loads CinemaOS directly without cinemaos-frame proxy or restrictive sandbox', () => {
  const root = process.cwd();
  const watchPage = fs.readFileSync(path.join(root, 'src/pages/MovieWatchPage.tsx'), 'utf8');
  assert.equal(watchPage.includes('buildCinemaOsFrameUrl'), false);
  assert.ok(watchPage.includes('embedSandboxed={false}'));
});

test('Normal Movies/TV uses 1 server section with SERVER 1 (CinemaOS), SERVER 2 (MovieBox), SERVER 3 (VidZee)', () => {
  assert.equal(MOVIE_WATCH_SERVER_SLOTS.length, 3);
  assert.deepEqual(
    MOVIE_WATCH_SERVER_SLOTS.map((s) => ({ key: s.key, label: s.label, serverId: s.serverId })),
    [
      { key: 'server-1', label: 'SERVER 1', serverId: 'cinemaos' },
      { key: 'server-2', label: 'SERVER 2', serverId: 'moviebox' },
      { key: 'server-3', label: 'SERVER 3', serverId: 'vidzee' },
    ],
  );

  assert.equal(resolveActiveMovieSlotKey('cinemaos'), 'server-1');
  assert.equal(resolveActiveMovieSlotKey('moviebox'), 'server-2');
  assert.equal(resolveActiveMovieSlotKey('vidzee'), 'server-3');
  assert.equal(resolveActiveMovieSlotKey('vidzee-mirror'), 'server-3');
  assert.equal(resolveActiveMovieSlotKey('embed-vidzee-mirror'), 'server-3');

  assert.equal(
    buildCinemaOsEmbedUrl({ type: 'movie', tmdbId: 550 }),
    'https://cinemaos.tech/player/550?lang=en',
  );
  assert.equal(
    buildCinemaOsEmbedUrl({ type: 'tv', tmdbId: 1396, season: 2, episode: 5 }),
    'https://cinemaos.tech/player/1396/2/5?lang=en',
  );
  assert.equal(
    buildVidzeeEmbedUrl({ type: 'movie', tmdbId: 550 }),
    'https://player.vidzee.wtf/embed/movie/550',
  );
  assert.equal(
    buildVidzeeEmbedUrl({ type: 'tv', tmdbId: 1396, season: 2, episode: 5 }),
    'https://player.vidzee.wtf/embed/tv/1396/2/5',
  );

  const root = process.cwd();
  const watchPage = fs.readFileSync(path.join(root, 'src/pages/MovieWatchPage.tsx'), 'utf8');
  assert.ok(watchPage.includes('MOVIE_WATCH_SERVER_SLOTS'));
  assert.ok(watchPage.includes('aria-label="Stream servers"'));
  assert.ok(watchPage.includes('<ServerCategoryDropdown'));
  assert.ok(watchPage.includes('title="SERVERS"'));
  assert.equal(watchPage.includes('role="group" aria-label="Streaming Servers"'), false);
});

test('isDirectFileMediaUrl detects direct MP4, nested proxy URLs, and extensionless hakunaymatata streams while excluding m3u8', () => {
  assert.equal(
    isDirectFileMediaUrl('/proxy?url=https%3A%2F%2Fbcdnw.hakunaymatata.com%2Fresource%2Fa933f1e2.mp4%3Fsign%3Dabc'),
    true,
  );
  assert.equal(
    isDirectFileMediaUrl('/proxy?url=https%3A%2F%2Fsacdn.hakunaymatata.com%2Fdash%2F3089349649006742360_1_1_1080_h265'),
    true,
  );
  assert.equal(
    isDirectFileMediaUrl('/proxy?url=%2Fproxy%3Furl%3Dhttps%253A%252F%252Fexample.com%252Fvideo.mp4'),
    true,
  );
  assert.equal(
    isDirectFileMediaUrl('/proxy?url=https%3A%2F%2Fcdn.example.com%2Fmaster.m3u8%3Ftoken%3D1'),
    false,
  );
  assert.equal(
    isDirectFileMediaUrl('/proxy?url=https%3A%2F%2Fsacdn.hakunaymatata.com%2Fhls%2Fplaylist.m3u8'),
    false,
  );
});


