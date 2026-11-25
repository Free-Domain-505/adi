import test from 'node:test';
import { classifyMovieBoxType } from '../server/moviebox.js';
import assert from 'node:assert/strict';
import {
  findBackEntryInTrail,
  isNonBackTargetPath,
  shouldAttemptHistoryBack,
} from '../src/lib/backTrailLogic.ts';
import {
  computeUpdatedEpisodeProgress,
  isAnimeCompletedLogic,
  isContinueCardDone,
  isMovieEntryWatchedLogic,
  isPlaybackWatched,
} from '../src/lib/watchedLogic.ts';
import {
  buildMovieContinueHref,
  formatMovieRemainingTime,
  getMovieProgressPercent,
  normalizeMovieContinueItem,
} from '../src/lib/movieContinueLogic.ts';

import {
  buildAcdnAvailability,
  isBlockedPlayerHost,
  normalizeLangName,
  parseHlsAudioLanguages,
  parsePlayablePlayerPhpLangs,
} from '../server/audioAvailLogic.js';
import {
  cleanPosterTitle,
  isValidImageResponse,
  posterTitleVariants,
  titleSimilarity,
} from '../server/posterFallbackLogic.js';

const isPlayer = (p: string) =>
  /^\/(watch\/\d+|movies\/watch\/)/.test(p) ||
  /^\/(novel|manga|manhwa)\/[^/]+(\/[^/]+)?\/read\//.test(p);

test('backTrailLogic finds prior non-player entry even across reloads (ignores BOOT_ID mismatch)', () => {
  const trail = {
    '0': { p: '/manhwa', u: '/manhwa', b: 'old_boot' },
    '1': { p: '/manhwa/solo-leveling', u: '/manhwa/solo-leveling?source=asura', b: 'old_boot' },
    '2': { p: '/manhwa/solo-leveling/read/ch-1', u: '/manhwa/solo-leveling/read/ch-1', b: 'new_boot' },
  };
  const hit = findBackEntryInTrail(trail, 2, '/manhwa/solo-leveling', isPlayer);
  assert.deepEqual(hit, { delta: -2, url: '/manhwa' });
});

test('backTrailLogic skips /auth, /login, /embed and current pathname', () => {
  const trail = {
    '0': { p: '/home', u: '/home' },
    '1': { p: '/auth', u: '/auth' },
    '2': { p: '/embed/123', u: '/embed/123' },
    '3': { p: '/anime/171627', u: '/anime/171627' },
  };
  assert.equal(isNonBackTargetPath('/auth', '/anime/171627', false), true);
  assert.equal(isNonBackTargetPath('/embed/123', '/anime/171627', false), true);
  const hit = findBackEntryInTrail(trail, 3, '/anime/171627', isPlayer);
  assert.deepEqual(hit, { delta: -3, url: '/home' });
});

test('shouldAttemptHistoryBack strictly requires idx > 0, never relying on history.length', () => {
  assert.equal(shouldAttemptHistoryBack(0), false);
  assert.equal(shouldAttemptHistoryBack(undefined), false);
  assert.equal(shouldAttemptHistoryBack(null), false);
  assert.equal(shouldAttemptHistoryBack(1), true);
  assert.equal(shouldAttemptHistoryBack(4), true);
});

test('audioAvailLogic detects HLS tracks accurately and filters blocked player hosts', () => {
  const m3u8 = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="eng",DEFAULT=YES',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",LANGUAGE="jpn",DEFAULT=NO',
  ].join('\n');
  assert.deepEqual(parseHlsAudioLanguages(m3u8), ['English', 'Japanese']);
  assert.equal(normalizeLangName('hin'), 'Hindi');
  assert.equal(normalizeLangName('und'), null);

  const payloadOnlyBlocked = Buffer.from(
    JSON.stringify([
      { language: 'Hindi', link: 'https://abysscdn.com/watch/123' },
      { language: 'English', link: 'https://ravok.buzz/video/abc' },
    ]),
  ).toString('base64');
  const html = `<iframe src="https://example.com/player.php?data=${encodeURIComponent(payloadOnlyBlocked)}"></iframe>`;
  assert.deepEqual(parsePlayablePlayerPhpLangs(html), ['English']);
  assert.equal(isBlockedPlayerHost('https://abyssplayer.to/v/1'), true);
});

test('buildAcdnAvailability returns empty when stream is unverified and preserves real languages when verified', () => {
  assert.deepEqual(
    buildAcdnAvailability({ verifiedStream: false, hlsLangs: ['Hindi', 'English'], resolvedHit: null }),
    { sub: false, dub: false, multi: false, languages: [] },
  );
  assert.deepEqual(
    buildAcdnAvailability({
      verifiedStream: true,
      hlsLangs: ['English', 'Japanese'],
      resolvedHit: { streamUrl: 'https://ravok.buzz/m3u8' },
    }),
    { sub: true, dub: true, multi: true, languages: ['English', 'Japanese'] },
  );
  assert.deepEqual(
    buildAcdnAvailability({
      verifiedStream: true,
      hlsLangs: ['Japanese'],
      resolvedHit: { streamUrl: 'https://ravok.buzz/m3u8' },
    }),
    { sub: true, dub: false, multi: false, languages: ['Japanese'] },
  );
});

test('posterFallbackLogic generates clean variants, scores similarity, and rejects HTML/empty image responses', () => {
  assert.equal(cleanPosterTitle('Solo Leveling (Book Version) [Official]'), 'Solo Leveling');
  assert.deepEqual(posterTitleVariants('Solo Leveling: Arise'), ['Solo Leveling: Arise', 'Solo Leveling']);
  assert.ok(titleSimilarity('The Greatest Ascetic', 'The Greatest Ascetic') === 1);
  assert.ok(titleSimilarity('The Greatest Ascetic', 'The Greatest Estate Developer') < 0.5);

  assert.equal(isValidImageResponse({ ok: false, status: 404, contentType: 'image/jpeg' }), false);
  assert.equal(isValidImageResponse({ ok: true, status: 200, contentType: 'text/html; charset=utf-8' }), false);
  assert.equal(isValidImageResponse({ ok: true, status: 200, contentType: 'image/jpeg', contentLength: 0 }), false);
  assert.equal(isValidImageResponse({ ok: true, status: 200, contentType: 'image/webp', contentLength: 1024 }), true);
  assert.equal(
    isValidImageResponse({
      ok: true,
      status: 200,
      contentType: 'application/octet-stream',
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    }),
    true,
  );
  assert.equal(
    isValidImageResponse({
      ok: true,
      status: 200,
      contentType: 'application/octet-stream',
      bytes: new Uint8Array([0x3c, 0x68, 0x74, 0x6d]), // "<htm"
    }),
    false,
  );
});

test('watchedLogic: half-watching a movie or episode does NOT mark it as watched', () => {
  // 50% watched of a 2 hour movie (3600 / 7200)
  assert.equal(isPlaybackWatched(3600, 7200), false);
  assert.equal(
    isAnimeCompletedLogic({
      totalEpisodes: 1,
      isMovieFormat: true,
      histItem: { ep: 1, pos: 3600, dur: 7200 },
      epsCount: 0,
    }),
    false,
  );

  // Continue watching card at 50% must not be marked done
  assert.equal(isContinueCardDone(3600, 7200, false), false);
  assert.equal(isContinueCardDone(3600, 7200, true), false); // card itself has dur > 0 and pos/dur < 0.90

  // TMDB movie at 50% must not be watched
  assert.equal(
    isMovieEntryWatchedLogic({ completed: true, pos: 3600, dur: 7200 }, 'movie'),
    false,
  );

  // Completed episode progress must not advance while in-progress
  assert.equal(computeUpdatedEpisodeProgress(0, 1, false), 0);
  assert.equal(computeUpdatedEpisodeProgress(3, 4, false), 3);
});

test('watchedLogic: watching almost the entire video (>= 90%) marks it as watched', () => {
  // 92% watched of a 2 hour movie (6624 / 7200)
  assert.equal(isPlaybackWatched(6624, 7200), true);
  assert.equal(
    isAnimeCompletedLogic({
      totalEpisodes: 1,
      isMovieFormat: true,
      histItem: { ep: 1, pos: 6624, dur: 7200 },
      epsCount: 1,
    }),
    true,
  );

  // Continue watching card at 92% is marked done
  assert.equal(isContinueCardDone(6624, 7200, false), true);

  // TMDB movie at 92% is watched
  assert.equal(
    isMovieEntryWatchedLogic({ completed: true, pos: 6624, dur: 7200 }, 'movie'),
    true,
  );

  // Completed episode progress advances once done
  assert.equal(computeUpdatedEpisodeProgress(0, 1, true), 1);
  assert.equal(computeUpdatedEpisodeProgress(3, 4, true), 4);
});

test('watchedLogic: 12-episode anime on final episode is not completed when episode 12 is half-watched', () => {
  // On ep 12 of 12, but halfway through ep 12
  assert.equal(
    isAnimeCompletedLogic({
      totalEpisodes: 12,
      isMovieFormat: false,
      histItem: { ep: 12, pos: 700, dur: 1400 },
      epsCount: 11,
    }),
    false,
  );

  // On ep 12 of 12, and ep 12 is >= 90% watched
  assert.equal(
    isAnimeCompletedLogic({
      totalEpisodes: 12,
      isMovieFormat: false,
      histItem: { ep: 12, pos: 1300, dur: 1400 },
      epsCount: 12,
    }),
    true,
  );
});

test('movieContinueLogic: generates valid hrefs, percentages, remaining labels and respects 90% threshold', () => {
  assert.equal(buildMovieContinueHref({ source: 'tmdb', type: 'movie', id: 550 }), '/movies/watch/movie/550');
  assert.equal(buildMovieContinueHref({ source: 'tmdb', type: 'tv', id: 1399, season: 2, episode: 5 }), '/movies/watch/tv/1399?s=2&e=5');
  assert.equal(buildMovieContinueHref({ source: 'anime', type: 'movie', id: 171627, episode: 1 }), '/watch/171627?ep=1&audio=dub');

  assert.equal(getMovieProgressPercent(3600, 7200), 50);
  assert.equal(getMovieProgressPercent(6500, 7200), 90);
  assert.equal(getMovieProgressPercent(0, 7200), 0);

  // 50% watched of 7200s (3600s remaining = 60m)
  assert.equal(formatMovieRemainingTime(3600, 7200, false), '60m left');
  assert.equal(formatMovieRemainingTime(6800, 7200, true), 'Watched');

  // Half-watched movie item normalization
  const halfItem = normalizeMovieContinueItem({
    source: 'tmdb',
    type: 'movie',
    id: 550,
    title: 'Fight Club',
    backdrop: '/fightclub.jpg',
    pos: 3600,
    dur: 7200,
    t: 1000,
  });
  assert.equal(halfItem.isDone, false);
  assert.equal(halfItem.pct, 50);
  assert.equal(halfItem.thumb, 'https://image.tmdb.org/t/p/w780/fightclub.jpg');
  assert.equal(halfItem.href, '/movies/watch/movie/550');

  // Completed movie item normalization (>= 90%)
  const doneItem = normalizeMovieContinueItem({
    source: 'tmdb',
    type: 'movie',
    id: 550,
    title: 'Fight Club',
    backdrop: '/fightclub.jpg',
    pos: 6600,
    dur: 7200,
    t: 1000,
  });
  assert.equal(doneItem.isDone, true);
  assert.equal(doneItem.pct, 92);
});

import { getOriginalAudioMeta, computeAvailableAudio } from '../src/lib/audioLabels.ts';
import { getOriginalLanguageForCountry } from '../server/audioAvailLogic.js';
import {
  buildMovieStreamAttempts,
  pickMovieBackupServer,
  pickNextMovieFallback,
} from '../src/lib/movieServers.ts';
import {
  normalizeNovelSearch,
  novelQueryVariants,
  scoreNovelMatch,
  stripLeadingMdHeading,
} from '../server/novelLogic.js';
import { shouldBlockImageTarget } from '../src/lib/imageProtection.ts';

test('audioLabels + audioAvailLogic: Donghua (CN/TW/HK) reports Chinese original and only verified dubs', () => {
  assert.equal(getOriginalLanguageForCountry('CN'), 'Chinese');
  assert.equal(getOriginalLanguageForCountry('TW'), 'Chinese');
  assert.equal(getOriginalLanguageForCountry('KR'), 'Korean');
  assert.equal(getOriginalLanguageForCountry('JP'), 'Japanese');

  assert.equal(getOriginalAudioMeta('CN').language, 'Chinese');
  assert.equal(getOriginalAudioMeta('CN').detailLabel, 'Chinese (Original)');
  assert.equal(getOriginalAudioMeta('KR').language, 'Korean');

  // Lord of Mysteries (CN) with Chinese + English + Hindi on ACDN, no Japanese anywhere
  const lom = computeAvailableAudio(
    {
      megaplay: { sub: false, dub: false },
      vidstream: { sub: false, dub: false },
      flixcloud: { sub: false, dub: false },
      acdn: { sub: true, dub: true, multi: true, languages: ['Chinese', 'English', 'Hindi'] },
    },
    'CN',
    false,
  );
  assert.equal(lom.original.language, 'Chinese');
  assert.equal(lom.originalVerified, true);
  assert.deepEqual(lom.dubs.map((d) => d.name), ['English', 'Hindi']);
  assert.equal(lom.dubs.some((d) => d.name === 'Japanese'), false);
  assert.equal(lom.summaryLine, 'Chinese (Original) · English Dub · Hindi Dub');

  // To Be Hero X (CN) where Japanese dub genuinely exists alongside Chinese, English, Hindi, Tamil, Telugu
  const tbhx = computeAvailableAudio(
    {
      acdn: {
        sub: true,
        dub: true,
        multi: true,
        languages: ['Japanese', 'Chinese', 'English', 'Telugu', 'Tamil', 'Hindi'],
      },
    },
    'CN',
    false,
  );
  assert.equal(tbhx.originalVerified, true);
  assert.equal(tbhx.dubs.some((d) => d.name === 'Japanese' && d.label === 'Japanese Dub'), true);
  assert.equal(tbhx.dubs.some((d) => d.name === 'Chinese'), false);

  // Donghua where ONLY dubs are verified (no Chinese original track in stream)
  const dubOnlyAvail = buildAcdnAvailability({
    verifiedStream: true,
    hlsLangs: ['English', 'Telugu', 'Tamil', 'Hindi'],
    resolvedHit: { streamUrl: 'https://ravok.buzz/m3u8' },
    countryOfOrigin: 'CN',
  });
  assert.equal(dubOnlyAvail.sub, false);
  assert.equal(dubOnlyAvail.dub, true);

  const dubOnlyUi = computeAvailableAudio({ acdn: dubOnlyAvail }, 'CN', false);
  assert.equal(dubOnlyUi.originalVerified, false);
  assert.equal(dubOnlyUi.hasDub, true);
  assert.equal(dubOnlyUi.summaryLine.includes('Chinese (Original)'), false);
});

test('movieServers: builds deduplicated MovieBox attempts and fails over to background servers cleanly', () => {
  const attempts = buildMovieStreamAttempts(
    [
      {
        quality: '720p',
        streamUrl: 'https://cdn.example.com/720.mp4',
        proxyStreamUrl: '/proxy?url=720&mirror=0',
        altProxyUrl: '/proxy?url=720&mirror=1',
      },
      {
        quality: '1080p',
        streamUrl: 'https://cdn.example.com/1080.mp4',
        proxyStreamUrl: '/proxy?url=1080&mirror=0',
        altProxyUrl: '/proxy?url=1080&mirror=0', // identical to proxyStreamUrl -> should dedupe
      },
    ],
    '1080p',
  );
  assert.equal(attempts[0].url, '/proxy?url=1080&mirror=0');
  assert.equal(attempts[0].quality, '1080p');
  assert.equal(attempts[1].url, 'https://cdn.example.com/1080.mp4');
  assert.equal(attempts.some((a) => a.url === '/proxy?url=720&mirror=1'), true);
  assert.equal(new Set(attempts.map((a) => a.url)).size, attempts.length);

  const providers = [
    { id: 'moviebox', label: 'MovieBox Direct', tags: ['Direct'] },
    { id: 'vidlink', label: 'VidLink Pro', tags: ['Fast'] },
    { id: 'vidfast', label: 'VidFast Pro', tags: ['HD'] },
  ];
  assert.equal(pickMovieBackupServer(providers, ['moviebox'])?.id, 'vidlink');
  assert.equal(pickMovieBackupServer(providers, ['moviebox', 'vidlink'])?.id, 'vidfast');

  const retry = pickNextMovieFallback({
    attempts,
    currentAttemptIdx: 0,
    providers,
    failedServerIds: [],
  });
  assert.equal(retry.action, 'retry-stream');

  const switchSrv = pickNextMovieFallback({
    attempts,
    currentAttemptIdx: attempts.length - 1,
    providers,
    failedServerIds: [],
  });
  assert.deepEqual(switchSrv, { action: 'switch-server', provider: providers[1] });

  const exhausted = pickNextMovieFallback({
    attempts,
    currentAttemptIdx: attempts.length - 1,
    providers,
    failedServerIds: ['vidlink', 'vidfast'],
  });
  assert.deepEqual(exhausted, { action: 'exhausted' });
});

test('novelLogic: normalizes queries, scores Re:ZERO matches, and strips raw markdown chapter headings', () => {
  assert.equal(normalizeNovelSearch("Re:ZERO -Starting Life in Another World-"), 're zero starting life in another world');
  const variants = novelQueryVariants('re zero');
  assert.equal(variants.includes('re zero'), true);
  assert.equal(variants.includes('re:zero'), true);
  assert.ok(scoreNovelMatch({ title: 'Re:ZERO -Starting Life in Another World-', slug: 're-zero' }, 're zero') >= 4);
  assert.equal(scoreNovelMatch({ title: 'Unrelated Story', slug: 'unrelated' }, 're zero'), 0);
  assert.equal(stripLeadingMdHeading('### Chapter 1: The Beginning'), 'Chapter 1: The Beginning');
});

test('imageProtection: blocks image and image-wrapper targets while allowing inputs and normal copy', () => {
  assert.equal(shouldBlockImageTarget({ tagName: 'IMG' }), true);
  assert.equal(shouldBlockImageTarget({ tagName: 'PICTURE' }), true);
  assert.equal(
    shouldBlockImageTarget({
      tagName: 'DIV',
      closest: (sel: string) => (sel.includes('[data-protect-img]') ? {} : null),
    }),
    true,
  );
  // Wrapper directly holding > img (e.g. a card <div class="relative"><img .../></div>)
  assert.equal(
    shouldBlockImageTarget({
      tagName: 'DIV',
      querySelector: (sel: string) => (sel.includes('> img') ? {} : null),
    }),
    true,
  );
  // Overlay sibling inside a card holding > img
  assert.equal(
    shouldBlockImageTarget({
      tagName: 'DIV',
      parentElement: {
        tagName: 'DIV',
        querySelector: (sel: string) => (sel.includes('> img') ? {} : null),
      },
    }),
    true,
  );
  // Form input must NEVER be blocked
  assert.equal(
    shouldBlockImageTarget({
      tagName: 'INPUT',
      closest: (sel: string) => (sel.includes('input') ? {} : null),
    }),
    false,
  );
  // Plain heading / paragraph text outside image wrappers
  assert.equal(
    shouldBlockImageTarget({
      tagName: 'P',
      closest: () => null,
      querySelector: () => null,
      parentElement: { tagName: 'SECTION', querySelector: () => null },
    }),
    false,
  );
});

import { Writable } from 'node:stream';
import { fetchWithHeaderTimeout, pipeWebBodySafe } from '../server/streamSafety.js';

test('streamSafety: pipeWebBodySafe absorbs mid-stream TimeoutError without unhandled Readable error crash', async () => {
  const erroredBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      setTimeout(() => {
        controller.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      }, 15);
    },
  });

  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });

  const capturedErrors: unknown[] = [];
  await new Promise<void>((resolve) => {
    sink.on('close', resolve);
    pipeWebBodySafe(erroredBody, sink, (err) => {
      capturedErrors.push(err);
    });
  });

  assert.equal(chunks.length, 1);
  assert.equal(capturedErrors.length, 1);
  assert.equal((capturedErrors[0] as Error).name, 'TimeoutError');
});

test('streamSafety: fetchWithHeaderTimeout aborts hung handshakes but allows slow body streaming after headers arrive', async () => {
  await assert.rejects(
    () =>
      fetchWithHeaderTimeout(
        'https://example.com/stalled',
        {},
        25,
        ((_u: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
          })) as typeof fetch,
      ),
    (err: Error) => err.name === 'TimeoutError',
  );

  const slowBodyRes = await fetchWithHeaderTimeout(
    'https://example.com/video.mp4',
    {},
    25,
    (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(new Uint8Array([9, 8, 7]));
              controller.close();
            }, 60);
          },
        }),
        { status: 200 },
      )) as typeof fetch,
  );

  const bytes = new Uint8Array(await slowBodyRes.arrayBuffer());
  assert.deepEqual(Array.from(bytes), [9, 8, 7]);
});

import { prioritizeMovieBackupServers } from '../src/lib/movieServers.ts';
import { listProviders } from '../src/lib/providers.ts';

test('audioLabels: loading state suppresses stale or premature language labels completely', () => {
  const staleServers = {
    megaplay: { sub: true, dub: true },
    acdn: { sub: true, dub: true, multi: true, languages: ['Japanese', 'English', 'Hindi'] },
  };
  const loadingStale = computeAvailableAudio(staleServers, 'CN', true);
  assert.equal(loadingStale.checked, false);
  assert.equal(loadingStale.originalVerified, false);
  assert.equal(loadingStale.hasDub, false);
  assert.equal(loadingStale.hasAnyVerifiedStream, false);
  assert.equal(loadingStale.summaryLine, 'Checking…');
  assert.equal(loadingStale.badgeText, 'Checking episode audio…');

  const loadingNull = computeAvailableAudio(null, 'JP', true);
  assert.equal(loadingNull.summaryLine, 'Checking…');
  assert.equal(loadingNull.originalVerified, false);
});

test('movieServers + providers: prioritizes Multi audio servers first and excludes sandbox-hostile embed hosts', () => {
  const mixed = [
    { id: 'moviebox', label: 'MovieBox Direct', tags: ['Direct', 'Multi audio'] },
    { id: 'cinesrc', label: 'CineSrc HD', tags: [] },
    { id: 'primesrc', label: 'PrimeStream', tags: ['4K'] },
    { id: 'cinemaos', label: 'CinemaOS', tags: ['Multi audio'] },
    { id: 'vidlink', label: 'VidLink Pro', tags: ['Multi audio', '4K'] },
  ];
  const ordered = prioritizeMovieBackupServers(mixed);
  assert.equal(ordered[0].id, 'vidlink');
  assert.equal(ordered[1].id, 'cinemaos');
  assert.equal(ordered[2].id, 'primesrc');
  assert.equal(ordered[3].id, 'cinesrc');
  assert.equal(pickMovieBackupServer(mixed, ['moviebox'])?.id, 'vidlink');
  assert.equal(pickMovieBackupServer(mixed, ['moviebox', 'vidlink'])?.id, 'cinemaos');

  const movieProviders = listProviders('movie');
  assert.equal(movieProviders.some((p) => p.id === '2embed' || p.id === 'moviesapi'), false);
  assert.equal(isBlockedPlayerHost('https://voe.sx/e/abc123'), true);
});

import { computeAudioBreakdown, getEpisodeAudioTier } from '../server/audioBreakdownLogic.js';
import { computeLocalAudioBreakdown, formatMultiEpisodeAudioSummary } from '../src/lib/audioLabels.ts';

test('audioBreakdownLogic: accurately computes multi-dub, dual audio, and sub-only episode counts and tiers', () => {
  // 1. Sub-Only series (12 episodes, no English dub, no multi-dub)
  const subOnly = computeAudioBreakdown({
    totalEpisodes: 12,
    hasMultiDub: false,
    hasEnglishDub: false,
    countryOfOrigin: 'JP',
  });
  assert.equal(subOnly.totalEpisodes, 12);
  assert.equal(subOnly.multiDubCount, 0);
  assert.equal(subOnly.dubCount, 0);
  assert.equal(subOnly.subOnlyCount, 12);
  assert.equal(subOnly.subOnlyPercentage, 100);
  assert.equal(subOnly.hasSubOnly, true);
  assert.equal(subOnly.labels.subOnly, 'Only Japanese (Original)');
  assert.ok(subOnly.insight.includes('exclusively in Original Japanese Audio'));
  assert.equal(getEpisodeAudioTier(1, subOnly), 'sub');
  assert.equal(getEpisodeAudioTier(12, subOnly), 'sub');

  // 2. Fully dubbed series with Multi-Dub (12 episodes, all dubbed, all multi)
  const fullyDubbed = computeAudioBreakdown({
    totalEpisodes: 12,
    hasMultiDub: true,
    multiDubEpisodes: 12,
    hasEnglishDub: true,
    dubEpisodes: 12,
    countryOfOrigin: 'JP',
  });
  assert.equal(fullyDubbed.totalEpisodes, 12);
  assert.equal(fullyDubbed.multiDubCount, 12);
  assert.equal(fullyDubbed.dubCount, 12);
  assert.equal(fullyDubbed.subOnlyCount, 0);
  assert.equal(fullyDubbed.subOnlyPercentage, 0);
  assert.equal(fullyDubbed.hasSubOnly, false);
  assert.ok(fullyDubbed.insight.includes('All 12 episodes are available in Multi-Dub'));
  assert.equal(getEpisodeAudioTier(1, fullyDubbed), 'multi');
  assert.equal(getEpisodeAudioTier(12, fullyDubbed), 'multi');

  // 3. Simuldub / Ongoing series (12 episodes, 8 dubbed, 4 sub-only)
  const partialDub = computeAudioBreakdown({
    totalEpisodes: 12,
    hasMultiDub: false,
    multiDubEpisodes: 0,
    hasEnglishDub: true,
    dubEpisodes: 8,
    countryOfOrigin: 'JP',
  });
  assert.equal(partialDub.multiDubCount, 0);
  assert.equal(partialDub.dubCount, 8);
  assert.equal(partialDub.subOnlyCount, 4);
  assert.equal(partialDub.dubPercentage, 67);
  assert.equal(partialDub.subOnlyPercentage, 33);
  assert.equal(getEpisodeAudioTier(5, partialDub), 'dual');
  assert.equal(getEpisodeAudioTier(8, partialDub), 'dual');
  assert.equal(getEpisodeAudioTier(9, partialDub), 'sub');
  assert.equal(getEpisodeAudioTier(12, partialDub), 'sub');

  // 4. Donghua (Chinese origin)
  const donghua = computeAudioBreakdown({
    totalEpisodes: 13,
    hasMultiDub: true,
    multiDubEpisodes: 13,
    hasEnglishDub: true,
    dubEpisodes: 13,
    countryOfOrigin: 'CN',
  });
  assert.equal(donghua.originalLanguage, 'Chinese');
  assert.equal(donghua.labels.subOnly, 'Only Chinese (Original)');
  assert.equal(donghua.labels.dualAudio, 'English Dub & Chinese (Dual Audio)');

  // 5. Summary line formatting (Original and English dub listed separately)
  const formattedSummary = formatMultiEpisodeAudioSummary(partialDub, 'Fallback');
  assert.ok(formattedSummary.includes('Original Japanese (12/12 eps)'));
  assert.ok(formattedSummary.includes('English Dub (8/12 eps)'));

  // 6. Client local calculation fallback
  const local = computeLocalAudioBreakdown(12, {
    original: { country: 'JP', language: 'Japanese', shortLabel: 'JP', detailLabel: 'JP', summaryLabel: 'JP', cardDescription: '', unavailableDescription: '' },
    originalVerified: true,
    checked: true,
    hasAnyVerifiedStream: true,
    dubs: [{ name: 'English', label: 'English Dub', native: 'English' }],
    hasDub: true,
    hasMulti: false,
    summaryLine: 'Japanese (Original) · English Dub',
    badgeText: 'English Dub Available',
    tracksCountLabel: '2 Tracks',
  });
  assert.equal(local.totalEpisodes, 12);
  assert.equal(local.dubCount, 12);
  assert.equal(local.subOnlyCount, 0);
});

import { buildMovieEmbedCandidates, isTrustedMovieEmbedUrl as isTrustedServerUrl, isValidEmbedResponse } from '../server/detectStreamLogic.js';
import {
  buildEmbedCandidates,
  configureExternalPlayerIframe,
  evaluateEmbedResponse,
  EXTERNAL_PLAYER_ALLOW_PERMISSIONS,
  isTrustedMovieEmbedUrl,
} from '../src/lib/movieServers.ts';

test('detectStreamLogic + movieServers: prioritizes CinemaOS #1, preserves blur-free/sandbox-safe embed backups, excludes vidsrc-su/moviebox, and validates trusted domains', () => {
  const movieCandidates = buildMovieEmbedCandidates({ type: 'movie', tmdbId: 27205 });
  assert.ok(movieCandidates.length >= 7);
  assert.equal(movieCandidates[0].id, 'cinemaos');
  assert.equal(movieCandidates[0].url, 'https://cinemaos.tech/player/27205?lang=en');
  assert.equal(movieCandidates[1].id, 'vidzee');
  assert.equal(movieCandidates[1].url, 'https://player.vidzee.wtf/embed/movie/27205');
  assert.equal(movieCandidates[2].id, 'vidup');
  assert.equal(movieCandidates[3].id, 'vidfast');
  assert.equal(movieCandidates[4].id, 'primesrc');
  assert.equal(movieCandidates.some((c) => c.id === 'moviebox' || c.id === 'vidsrc-su' || c.id === 'vidsrc-ru' || c.id === 'moviesapi'), false);

  const sandboxedMovieCandidates = buildMovieEmbedCandidates({ type: 'movie', tmdbId: 27205, sandboxed: true });
  assert.equal(sandboxedMovieCandidates.every((c) => c.url.startsWith('https://')), true);
  assert.equal(sandboxedMovieCandidates.some((c) => c.id === 'vidsrc-su' || c.id === 'moviesapi'), false);

  const tvCandidates = buildMovieEmbedCandidates({ type: 'tv', tmdbId: 66732, season: 2, episode: 3 });
  assert.equal(tvCandidates[0].id, 'cinemaos');
  assert.equal(tvCandidates[0].url, 'https://cinemaos.tech/player/66732/2/3?lang=en');
  assert.equal(tvCandidates[1].id, 'vidzee');
  assert.equal(tvCandidates[1].url, 'https://player.vidzee.wtf/embed/tv/66732/2/3');
  assert.equal(tvCandidates[2].id, 'vidup');
  assert.equal(tvCandidates.some((c) => c.url.includes('/tv/66732/2/3') || c.url.includes('season=2&episode=3')), true);

  const clientCandidates = buildEmbedCandidates({ type: 'movie', tmdbId: 27205, sandboxed: true });
  assert.equal(clientCandidates[0].id, 'cinemaos');
  assert.equal(clientCandidates[1].id, 'vidzee');
  assert.equal(clientCandidates[2].id, 'vidup');
  assert.equal(clientCandidates[3].id, 'vidfast');
  assert.equal(clientCandidates.some((c) => c.id === 'moviebox' || c.id === 'vidsrc-su' || c.id === 'moviesapi'), false);

  // Trusted domain validation (both client and server)
  for (const c of movieCandidates) {
    assert.equal(isTrustedMovieEmbedUrl(c.url), true, `Expected ${c.url} to be trusted`);
    assert.equal(isTrustedServerUrl(c.url), true, `Expected ${c.url} to be trusted on server`);
  }
  assert.equal(isTrustedMovieEmbedUrl('https://evil-attacker.example.com/movie/27205'), false);
  assert.equal(isTrustedMovieEmbedUrl('http://moviesapi.to/movie/27205'), false);
  assert.equal(isTrustedMovieEmbedUrl('javascript:alert(1)'), false);
  assert.equal(isTrustedServerUrl('https://vidsrc.su/embed/movie/27205'), false);
});

test('detectStreamLogic + movieServers: rejects Restricted Embed Detected / sandbox probes and configures player iframe permissions cleanly', () => {
  assert.equal(isValidEmbedResponse(404, '<html>404 Not Found</html>'), false);
  assert.equal(isValidEmbedResponse(403, '<html><head><title>403 Forbidden</title></head><body>403 Forbidden</body></html>'), false);
  assert.equal(isValidEmbedResponse(200, '<html id="__next_error__">An error occurred</html>'), false);
  assert.equal(
    isValidEmbedResponse(
      200,
      '<!DOCTYPE html><html><body><div>Security Notice: Restricted Embed Detected. This player cannot run in a sandboxed iframe without allow-same-origin.</div></body></html>',
    ),
    false,
  );
  assert.equal(
    isValidEmbedResponse(
      200,
      '<!DOCTYPE html><html><body><script>const p = "__vidora_sandbox_probe__";</script><div>Player</div></body></html>',
    ),
    false,
  );
  assert.equal(isValidEmbedResponse(200, 'short body'), false);
  assert.equal(
    isValidEmbedResponse(
      200,
      '<!DOCTYPE html><html lang="en" class="dark"><head><title>Watch Movie</title></head><body><div id="player"><video src="blob:stream"></video></div></body></html>',
    ),
    true,
  );

  assert.equal(evaluateEmbedResponse(404, 'Not Found'), false);
  assert.equal(evaluateEmbedResponse(200, '<html id="__next_error__">Error page with plenty of padding to pass length check...</html>'), false);
  assert.equal(
    evaluateEmbedResponse(
      200,
      '<html><body>Security Notice - Restricted Embed Detected - Please Disable Sandbox to watch this video</body></html>',
    ),
    false,
  );
  assert.equal(
    evaluateEmbedResponse(
      200,
      '<!DOCTYPE html><html lang="en"><head><title>Player</title></head><body><div class="video-container">Player active</div></body></html>',
    ),
    true,
  );

  // Mock iframe element to verify configureExternalPlayerIframe strips restrictive sandbox & sets permissions
  const attrs = new Map<string, string>([['sandbox', 'allow-scripts']]);
  const mockIframe = {
    allowFullscreen: false,
    hasAttribute: (k: string) => attrs.has(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
  } as unknown as HTMLIFrameElement;

  configureExternalPlayerIframe(mockIframe);
  assert.equal(attrs.has('sandbox'), false);
  assert.equal(attrs.get('allow'), EXTERNAL_PLAYER_ALLOW_PERMISSIONS);
  assert.equal(mockIframe.allowFullscreen, true);
  assert.equal(attrs.get('referrerpolicy'), 'origin');

  configureExternalPlayerIframe(mockIframe, { useSandbox: true });
  assert.equal(attrs.get('sandbox')?.includes('allow-same-origin'), true);
  assert.equal(attrs.get('sandbox')?.includes('allow-scripts'), true);
});





test('MovieBox type parsing accepts numeric strings and safely falls back to the requested media type', () => {
  assert.equal(classifyMovieBoxType({ subjectType: '1' }), 'movie');
  assert.equal(classifyMovieBoxType({ subject_type: '2' }), 'tv');
  assert.equal(classifyMovieBoxType({ type: 'MOVIE' }), 'movie');
  assert.equal(classifyMovieBoxType({ type: 'series' }), 'tv');
  assert.equal(classifyMovieBoxType({ subjectType: 'unknown' }, 'movie'), 'movie');
  assert.equal(classifyMovieBoxType({ subjectType: 'unknown' }, 'tv'), 'tv');
  assert.equal(classifyMovieBoxType({ subjectType: 'unknown' }), 'other');
});

import { mediaToCard, resolveDirectHeroTarget, specificSeasonEpisodes } from '../src/lib/mappers.ts';

test('mediaToCard + specificSeasonEpisodes count each season separately instead of summing franchise totals', () => {
  const s2Card = mediaToCard({
    id: 176496,
    idMal: 58567,
    title: { romaji: 'Ore dake Level Up na Ken: Season 2', english: 'Solo Leveling Season 2', native: null },
    coverImage: { extraLarge: 'https://example.com/xl.jpg', large: 'https://example.com/l.jpg', color: '#000000' },
    bannerImage: null,
    genres: ['Action'],
    averageScore: 87,
    episodes: 13,
    format: 'TV',
    status: 'FINISHED',
    season: 'WINTER',
    seasonYear: 2025,
    startDate: { year: 2025, month: 1, day: 5 },
    relations: {
      edges: [
        {
          relationType: 'PREQUEL',
          node: {
            id: 151807,
            type: 'ANIME',
            format: 'TV',
            episodes: 12,
            title: { romaji: 'Ore dake Level Up na Ken', english: 'Solo Leveling', native: null },
          },
        },
      ],
    },
  });
  assert.equal(s2Card.episodes, 13);

  // Ongoing donghua/anime with null fixed episodes falls back to aired episodes (nextAiringEpisode - 1)
  assert.equal(specificSeasonEpisodes({ episodes: null, nextAiringEpisode: { episode: 26 } }), 25);
  assert.equal(specificSeasonEpisodes({ episodes: null, nextAiringEpisode: null }), null);
});

test('resolveDirectHeroTarget treats each season as its own separate anime (no prequel redirect)', () => {
  assert.deepEqual(resolveDirectHeroTarget(176496, 0), { targetId: 176496, targetEp: 1, isResume: false });
  assert.deepEqual(resolveDirectHeroTarget(176496, 5), { targetId: 176496, targetEp: 5, isResume: true });
});

import { getMaskedServerLabel, resolveActiveSlotKey, SERVERS, WATCH_SERVER_SLOTS } from '../src/lib/servers.ts';
import { cleanAnikotoTitle, extractSeasonNum, parseAnikotoSearchHtml, pickBestAnikotoMatch } from '../server/anikoto.js';

test('WATCH_SERVER_SLOTS exposes 12 masked SERVER 1..12 slots across SUB, DUB, and MULTI AUDIO without real names', () => {
  assert.equal(WATCH_SERVER_SLOTS.length, 12);
  assert.deepEqual(
    WATCH_SERVER_SLOTS.map((s) => s.label),
    [
      'SERVER 1',
      'SERVER 2',
      'SERVER 3',
      'SERVER 4',
      'SERVER 5',
      'SERVER 6',
      'SERVER 7',
      'SERVER 8',
      'SERVER 9',
      'SERVER 10',
      'SERVER 11',
      'SERVER 12',
    ],
  );
  assert.equal(WATCH_SERVER_SLOTS.filter((s) => s.category === 'sub').length, 4);
  assert.equal(WATCH_SERVER_SLOTS.filter((s) => s.category === 'dub').length, 4);
  assert.equal(WATCH_SERVER_SLOTS.filter((s) => s.category === 'multi').length, 4);
  assert.equal(WATCH_SERVER_SLOTS.some((s) => s.serverId === 'anikoto' && s.category === 'dub'), true);
  assert.equal(WATCH_SERVER_SLOTS.some((s) => s.serverId === 'flixcloud' && s.category === 'dub'), true);
  assert.equal(WATCH_SERVER_SLOTS.some((s) => s.serverId === 'flixcloud' && s.category === 'multi'), false);
  assert.deepEqual(WATCH_SERVER_SLOTS.filter(s => s.category === 'multi').map(s => s.serverId), ['acdn', 'watchanimeworld', 'animesalt-1', 'server12']);
  assert.deepEqual(WATCH_SERVER_SLOTS.filter(s => s.category === 'dub').map(s => s.serverId), ['anikoto', 'desidubanime', 'megaplay', 'flixcloud']);

  assert.equal(resolveActiveSlotKey('anikoto', 'dub'), 'dub:anikoto');
  assert.equal(getMaskedServerLabel('anikoto', 'dub'), 'SERVER 5');
  assert.equal(resolveActiveSlotKey('flixcloud', 'dub'), 'dub:flixcloud');
  assert.equal(getMaskedServerLabel('flixcloud', 'dub'), 'SERVER 8');
  assert.equal(resolveActiveSlotKey('vidstream', 'dub'), 'dub:megaplay');
  assert.equal(getMaskedServerLabel('megaplay', 'sub'), 'SERVER 1');
  assert.equal(resolveActiveSlotKey('acdn', 'dub'), 'multi:acdn');
  assert.equal(getMaskedServerLabel('acdn', 'dub'), 'SERVER 9');
  assert.equal(resolveActiveSlotKey('watchanimeworld', 'dub'), 'multi:watchanimeworld');
  assert.equal(getMaskedServerLabel('watchanimeworld', 'dub'), 'SERVER 10');
  assert.equal(resolveActiveSlotKey('animesalt-2', 'dub'), 'multi:animesalt-1');
  assert.equal(getMaskedServerLabel('animesalt-2', 'dub'), 'SERVER 11');
  assert.equal(resolveActiveSlotKey('server12', 'dub'), 'multi:server12');
  assert.equal(getMaskedServerLabel('server12', 'dub'), 'SERVER 12');

  const s12 = SERVERS.find((s) => s.id === 'server12');
  assert.ok(s12);
  assert.equal(/tooniboy/i.test(JSON.stringify(SERVERS) + JSON.stringify(WATCH_SERVER_SLOTS)), false);
});

test('anikoto parser and matcher disambiguate movies vs TV arcs and prioritize dub availability', () => {
  assert.equal(cleanAnikotoTitle('Solo Leveling: Season 2'), 'solo leveling');
  assert.equal(extractSeasonNum('Demon Slayer: Season 3', ''), 3);

  const sampleHtml = `
    <div class="item ">
      <div class="ani poster tip"><a href="https://anikoto.cz/watch/demon-slayer-movie-mugen-train-8ea4p/ep-1"><img alt="Demon Slayer Movie: Mugen Train"/><div class="left"><span class="ep-status sub"><span> 1</span></span><span class="ep-status dub"><span> 1</span></span></div><div class="right">Movie</div></a></div>
      <div class="info"><a class="name d-title" href="https://anikoto.cz/watch/demon-slayer-movie-mugen-train-8ea4p/ep-1" data-jp="Kimetsu no Yaiba Movie: Mugen Ressha-hen">Demon Slayer Movie: Mugen Train</a></div>
    </div>
    <div class="item ">
      <div class="ani poster tip"><a href="https://anikoto.cz/watch/the-demon-slayer-kimetsu-no-yaiba-mugen-train-arc-tv-jsqtn/ep-1"><img alt="The Demon Slayer: Kimetsu no Yaiba Mugen Train Arc TV"/><div class="left"><span class="ep-status sub"><span> 7</span></span><span class="ep-status dub"><span> 7</span></span></div><div class="right">TV</div></a></div>
      <div class="info"><a class="name d-title" href="https://anikoto.cz/watch/the-demon-slayer-kimetsu-no-yaiba-mugen-train-arc-tv-jsqtn/ep-1" data-jp="Kimetsu no Yaiba: Mugen Ressha-hen">The Demon Slayer: Kimetsu no Yaiba Mugen Train Arc TV</a></div>
    </div>
  `;
  const parsed = parseAnikotoSearchHtml(sampleHtml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].isMovie, true);
  assert.equal(parsed[1].isMovie, false);

  const pickedMovie = pickBestAnikotoMatch(parsed, {
    title: 'Demon Slayer -Kimetsu no Yaiba- The Movie: Mugen Train',
    romajiTitle: 'Kimetsu no Yaiba: Mugen Ressha-hen',
    isMovie: true,
    audio: 'dub',
  });
  assert.equal(pickedMovie?.slug, 'demon-slayer-movie-mugen-train-8ea4p');

  const pickedTv = pickBestAnikotoMatch(parsed, {
    title: 'Demon Slayer: Kimetsu no Yaiba Mugen Train Arc',
    romajiTitle: 'Kimetsu no Yaiba: Mugen Ressha-hen',
    isMovie: false,
    audio: 'dub',
  });
  assert.equal(pickedTv?.slug, 'the-demon-slayer-kimetsu-no-yaiba-mugen-train-arc-tv-jsqtn');
});

import { scoreMovieBoxStreamSet } from '../server/moviebox.js';
import { getMaxResolutionFromStreams, hasHindiAudio, shouldUpgradeMovieBoxToVidzee } from '../server/detectStreamLogic.js';

test('scoreMovieBoxStreamSet prioritizes 1080p+/4K multi-quality over low-res 360p/480p preferred dubs', () => {
  const lowResHindi = [{ quality: '480p', resolutionNum: 480 }];
  const hdMultiOriginal = [
    { quality: '1080p', resolutionNum: 1080 },
    { quality: '720p', resolutionNum: 720 },
    { quality: '480p', resolutionNum: 480 },
  ];
  assert.ok(
    scoreMovieBoxStreamSet(hdMultiOriginal, 25) > scoreMovieBoxStreamSet(lowResHindi, 40),
    '1080p multi-quality Original must outscore 480p-only Hindi dub',
  );

  // When both Hindi and Original offer 1080p+ multi-quality, Hindi preference still wins tie
  const hdMultiHindi = [
    { quality: '1080p', resolutionNum: 1080 },
    { quality: '720p', resolutionNum: 720 },
    { quality: '480p', resolutionNum: 480 },
  ];
  assert.ok(
    scoreMovieBoxStreamSet(hdMultiHindi, 40) > scoreMovieBoxStreamSet(hdMultiOriginal, 25),
    'Hindi dub wins within same 1080p+ multi-quality tier',
  );

  // 2160p multi-quality beats 1080p single quality
  const single1080 = [{ quality: '1080p', resolutionNum: 1080 }];
  const uhdMulti = [
    { quality: '2160p', resolutionNum: 2160 },
    { quality: '1080p', resolutionNum: 1080 },
    { quality: '720p', resolutionNum: 720 },
  ];
  assert.ok(scoreMovieBoxStreamSet(uhdMulti, 25) > scoreMovieBoxStreamSet(single1080, 40));
});

test('shouldUpgradeMovieBoxToVidzee always preserves Hindi dub by default and upgrades only for Hindi or better HD', () => {
  assert.equal(getMaxResolutionFromStreams([{ quality: '1080p', resolutionNum: 1080 }]), 1080);
  assert.equal(getMaxResolutionFromStreams([{ quality: '360p' }]), 360);

  assert.equal(hasHindiAudio({ dubs: [{ label: 'Hindi dub', selected: true }] }), true);
  assert.equal(hasHindiAudio({ dubs: [{ label: 'Original', selected: true }, { label: 'Hindi dub', selected: false }] }), false);
  assert.equal(hasHindiAudio({ activeLanguage: 'Hindi' }), true);

  // MovieBox 1080p or 720p stays Priority #1 when Hindi status matches
  assert.equal(
    shouldUpgradeMovieBoxToVidzee(
      [{ quality: '1080p', resolutionNum: 1080 }, { quality: '720p', resolutionNum: 720 }],
      [{ quality: '1080p', resolutionNum: 1080, hasMultiQuality: true }],
      { mbHasHindi: true, vzHasHindi: true },
    ),
    false,
  );

  // Never downgrade away from MovieBox Hindi to a non-Hindi stream even if MovieBox is 480p
  assert.equal(
    shouldUpgradeMovieBoxToVidzee(
      [{ quality: '480p', resolutionNum: 480 }],
      [{ quality: '720p', resolutionNum: 720, hasMultiQuality: false }],
      { mbHasHindi: true, vzHasHindi: false },
    ),
    false,
  );

  // Always switch to Vidzee Hindi if MovieBox lacked Hindi
  assert.equal(
    shouldUpgradeMovieBoxToVidzee(
      [{ quality: '1080p', resolutionNum: 1080 }],
      [{ quality: '720p', resolutionNum: 720, language: 'Hindi' }],
      { mbHasHindi: false, vzHasHindi: true },
    ),
    true,
  );

  // MovieBox < 720p Hindi upgrades when Vidzee Hindi has >= 720p
  assert.equal(
    shouldUpgradeMovieBoxToVidzee(
      [{ quality: '360p', resolutionNum: 360 }],
      [{ quality: '720p', resolutionNum: 720, language: 'Hindi' }],
      { mbHasHindi: true, vzHasHindi: true },
    ),
    true,
  );

  assert.equal(
    shouldUpgradeMovieBoxToVidzee(
      [{ quality: '480p', resolutionNum: 480 }],
      [],
    ),
    false,
  );
});

test('HLS key.bin rewriting retains binary asset status and never appends &playlist=1', () => {
  const line = '#EXT-X-KEY:METHOD=AES-128,URI="https://fetch9.flixcloud.cc/_v7/123/key.bin",IV=0x123';
  const isBinaryAsset = line.startsWith('#EXT-X-MAP') || line.startsWith('#EXT-X-KEY');
  assert.equal(isBinaryAsset, true);

  const hasSegExt = /\.(ts|m4s|mp4|aac|key|bin|js|css|woff2?|png|webp)(\?|$)/i.test('/_v7/123/key.bin');
  assert.equal(hasSegExt, true);
});

import { computeServerCategoryAvailability } from '../src/lib/servers.ts';
import { findTrackForMode, formatHlsTrackLabel } from '../src/lib/audioTrackLogic.ts';
import { rewriteHlsAudioDefaults } from '../server/audioAvailLogic.js';

test('computeServerCategoryAvailability keeps all sections, shows checking while loading, and marks missing sections Not Available', () => {
  // 1. Before anime metadata loads: all categories stay in checking state, never guessing or showing Not Available
  assert.deepEqual(
    computeServerCategoryAvailability({
      animeLoaded: false,
      availLoading: false,
      availData: null,
      playbackLoading: false,
      playbackResolved: false,
      hasSub: true,
      hasDub: true,
      streamSid: null,
      currentSid: '',
      activeSlotCategory: undefined,
      trackCount: 0,
    }),
    {
      subAvailable: false,
      dubAvailable: false,
      multiAvailable: false,
      subChecking: true,
      dubChecking: true,
      multiChecking: true,
    },
  );

  // 2. While avail and playback are both loading: all 3 stay in checking state (even if hasDub/hasSub are optimistically true)
  assert.deepEqual(
    computeServerCategoryAvailability({
      animeLoaded: true,
      availLoading: true,
      availData: null,
      playbackLoading: true,
      playbackResolved: false,
      hasSub: true,
      hasDub: true,
      streamSid: null,
      currentSid: '',
      activeSlotCategory: undefined,
      trackCount: 0,
    }),
    {
      subAvailable: false,
      dubAvailable: false,
      multiAvailable: false,
      subChecking: true,
      dubChecking: true,
      multiChecking: true,
    },
  );

  // 3. Playback resolved to FlixCloud DUB while avail is still checking SUB / MULTI AUDIO
  assert.deepEqual(
    computeServerCategoryAvailability({
      animeLoaded: true,
      availLoading: true,
      availData: null,
      playbackLoading: false,
      playbackResolved: true,
      hasSub: false,
      hasDub: true,
      streamSid: 'flixcloud',
      currentSid: 'flixcloud',
      activeSlotCategory: 'dub',
      trackCount: 2,
    }),
    {
      subAvailable: false,
      dubAvailable: true,
      multiAvailable: false,
      subChecking: true,
      dubChecking: false,
      multiChecking: true,
    },
  );

  // 4. Settled states: FlixCloud 2-track DUB -> MULTI AUDIO Not Available
  assert.deepEqual(
    computeServerCategoryAvailability({
      animeLoaded: true,
      availLoading: false,
      availData: { sub: true, dub: true, hasMulti: false },
      playbackLoading: false,
      playbackResolved: true,
      hasSub: true,
      hasDub: true,
      streamSid: 'flixcloud',
      currentSid: 'flixcloud',
      activeSlotCategory: 'dub',
      trackCount: 2,
    }),
    {
      subAvailable: true,
      dubAvailable: true,
      multiAvailable: false,
      subChecking: false,
      dubChecking: false,
      multiChecking: false,
    },
  );

  assert.deepEqual(
    computeServerCategoryAvailability({
      animeLoaded: true,
      availLoading: false,
      availData: { sub: true, dub: false, hasMulti: false },
      playbackLoading: false,
      playbackResolved: true,
      hasSub: true,
      hasDub: false,
      streamSid: 'megaplay',
      currentSid: 'megaplay',
      activeSlotCategory: 'sub',
      trackCount: 0,
    }),
    {
      subAvailable: true,
      dubAvailable: false,
      multiAvailable: false,
      subChecking: false,
      dubChecking: false,
      multiChecking: false,
    },
  );

  assert.deepEqual(
    computeServerCategoryAvailability({
      animeLoaded: true,
      availLoading: false,
      availData: { sub: true, dub: true, hasMulti: true },
      playbackLoading: false,
      playbackResolved: true,
      hasSub: true,
      hasDub: true,
      streamSid: 'acdn',
      currentSid: 'acdn',
      activeSlotCategory: 'multi',
      trackCount: 3,
    }),
    {
      subAvailable: true,
      dubAvailable: true,
      multiAvailable: true,
      subChecking: false,
      dubChecking: false,
      multiChecking: false,
    },
  );
});

test('findTrackForMode defaults to English/Hindi dub instead of Original in DUB mode (including Donghua Native/jpn)', () => {
  const donghuaFlixTracks = [
    { i: 0, label: formatHlsTrackLabel({ name: 'Native', lang: 'jpn' }, 0, 'Chinese'), lang: 'jpn' },
    { i: 1, label: formatHlsTrackLabel({ name: 'English', lang: 'eng' }, 1, 'Chinese'), lang: 'eng' },
  ];
  assert.equal(donghuaFlixTracks[0].label, 'Chinese (Original)');
  assert.equal(findTrackForMode(donghuaFlixTracks, 'dub', '', 'Chinese')?.i, 1);
  assert.equal(findTrackForMode(donghuaFlixTracks, 'dub', 'ja', 'Chinese')?.i, 1);
  assert.equal(findTrackForMode(donghuaFlixTracks, 'sub', '', 'Chinese')?.i, 0);

  const genericTracks = [
    { i: 0, label: formatHlsTrackLabel({}, 0, 'Chinese'), lang: '' },
    { i: 1, label: formatHlsTrackLabel({}, 1, 'Chinese'), lang: '' },
  ];
  assert.equal(findTrackForMode(genericTracks, 'dub', '', 'Chinese')?.i, 1);
});

test('rewriteHlsAudioDefaults enforces DEFAULT=YES on dub track even when DEFAULT attribute was omitted', () => {
  const rawM3u8 = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Native",LANGUAGE="jpn",DEFAULT=YES,AUTOSELECT=YES,URI="orig.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="eng",URI="eng.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=2000000,AUDIO="audio"',
    'video.m3u8',
  ];

  const dubOut = rewriteHlsAudioDefaults(rawM3u8, 'dub');
  assert.match(dubOut[1], /DEFAULT=NO/);
  assert.match(dubOut[2], /DEFAULT=YES/);
  assert.match(dubOut[2], /AUTOSELECT=YES/);

  const subOut = rewriteHlsAudioDefaults(rawM3u8, 'sub');
  assert.equal(subOut.some((l) => l.includes('NAME="English"')), false);
  assert.match(subOut.find((l) => l.includes('NAME="Native"')) || '', /DEFAULT=YES/);
});

import { appendTapRipple, removeTapRipple, resolveTapTint } from '../src/lib/tapFeedback.ts';

test('tapFeedback resolves element tint or fallback tint and manages bounded tap ripples', () => {
  const donghuaTarget = {
    closest: (sel: string) => (sel === '[data-tap-tint]' ? { getAttribute: () => '#10b981' } : null),
  };
  assert.equal(resolveTapTint(donghuaTarget, '#e8294c'), '#10b981');
  assert.equal(resolveTapTint({ closest: () => null }, '#7c73ff'), '#7c73ff');
  assert.equal(resolveTapTint(null, ''), '#e8294c');

  let list = appendTapRipple([], { id: 1, x: 100.4, y: 200.6, tint: '#10b981' }, 3);
  list = appendTapRipple(list, { id: 2, x: 150, y: 220, tint: '#7c73ff' }, 3);
  list = appendTapRipple(list, { id: 3, x: 180, y: 240, tint: '#38bdf8' }, 3);
  list = appendTapRipple(list, { id: 4, x: 210, y: 260, tint: '' }, 3);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { id: 2, x: 150, y: 220, tint: '#7c73ff' });
  assert.deepEqual(list[2], { id: 4, x: 210, y: 260, tint: '#e8294c' });

  const afterRemove = removeTapRipple(list, 3);
  assert.deepEqual(afterRemove.map((r) => r.id), [2, 4]);
});

import { filterContinueHistoryEntries } from '../src/lib/historyLogic.ts';
import { selectMovieContinueItems } from '../src/lib/movieContinueLogic.ts';
import { isTmdbProgressCompleted } from '../src/lib/watchedLogic.ts';
import type { HistoryItem, MovieWatchEntry } from '../src/lib/library.ts';

test('Continue Watching automatically removes fully watched movies, episodes, and completed multi-season series', () => {
  const mkHist = (id: number, ep: number, pos: number, dur: number, format: string | null = 'TV', t = 1000): HistoryItem => ({
    id,
    title: `Title ${id}`,
    image: 'https://example.com/p.jpg',
    color: null,
    score: 80,
    format,
    episodes: format === 'MOVIE' ? 1 : 12,
    year: 2024,
    startDate: { year: 2024, month: 1, day: 1 },
    ep,
    server: 'flixcloud',
    audio: 'dub',
    pos,
    dur,
    t,
  });

  // 1. Anime/Donghua Continue Watching filtering
  const animeHistItems: HistoryItem[] = [
    mkHist(101, 4, 0, 1440, 'TV', 5000),      // Up next ep 4 -> keep
    mkHist(101, 3, 1440, 1440, 'TV', 4999),   // Finished ep 3 -> remove
    mkHist(102, 12, 1440, 1440, 'TV', 4500),  // Completed anime final ep -> remove
    mkHist(102, 5, 400, 1440, 'TV', 4000),    // Leftover ep of completed anime -> remove
    mkHist(103, 1, 5200, 5400, 'MOVIE', 3500), // Finished anime movie >= 90% -> remove
    mkHist(104, 1, 1200, 5400, 'MOVIE', 3000), // In-progress anime movie rewatch -> keep
    mkHist(105, 1, 0, 0, 'TV', 2500),         // Ep 1 watched on embed (dur=0, in watchedEps) -> remove
    mkHist(106, 2, 600, 1440, 'TV', 2000),    // In-progress ep 2 -> keep
  ];
  const watchedIds = new Set([102, 103]);
  const watchedEpsMap = { '101': [1, 2, 3], '102': [12], '105': [1] };

  const visibleAnime = filterContinueHistoryEntries(animeHistItems, watchedIds, watchedEpsMap);
  assert.deepEqual(
    visibleAnime.map((h) => `${h.id}:${h.ep}`),
    ['101:4', '104:1', '106:2'],
  );

  // 2. Movie & TV Continue Watching filtering
  const tmdbEntries: MovieWatchEntry[] = [
    {
      key: 'movie:550', id: 550, type: 'movie', title: 'Fight Club',
      completed: true, watchedSeasons: { '1': [1] }, lastSeason: 1, lastEp: 1, pos: 8000, dur: 8340, t: 9000,
    },
    {
      key: 'movie:27205', id: 27205, type: 'movie', title: 'Inception',
      completed: false, watchedSeasons: {}, lastSeason: 1, lastEp: 1, pos: 3000, dur: 8880, t: 8000,
    },
    {
      key: 'tv:71446', id: 71446, type: 'tv', title: 'Money Heist',
      completed: false, watchedSeasons: { '1': [1] }, lastSeason: 1, lastEp: 1, pos: 2600, dur: 2800, t: 7500, // 93% -> remove
    },
    {
      key: 'tv:66732', id: 66732, type: 'tv', title: 'Stranger Things',
      completed: false, watchedSeasons: {}, lastSeason: 2, lastEp: 4, pos: 1100, dur: 3200, t: 7000, // in progress -> keep
    },
  ];
  const visibleMovies = selectMovieContinueItems({
    movieHist: tmdbEntries,
    animeHist: animeHistItems,
    watchedAnimeIds: watchedIds,
    limit: 20,
  });
  assert.deepEqual(
    visibleMovies.map((x) => x.uid),
    ['tmdb:movie:27205', 'tmdb:tv:66732', 'anime:movie:104'],
  );

  // 3. Multi-season TMDB TV show marks completed=true on final episode of final season,
  // and keeps completed=false on intermediate seasons
  assert.equal(
    isTmdbProgressCompleted({
      type: 'tv',
      reachedDone: true,
      season: 1,
      episode: 15,
      watchedSeasonEpsCount: 15,
      totalEpisodesInSeason: 15,
      totalSeasons: 3,
    }),
    false,
  );
  assert.equal(
    isTmdbProgressCompleted({
      type: 'tv',
      reachedDone: true,
      season: 3,
      episode: 8,
      watchedSeasonEpsCount: 1,
      totalEpisodesInSeason: 8,
      totalSeasons: 3,
    }),
    true,
  );
  assert.equal(
    isTmdbProgressCompleted({
      type: 'movie',
      prevCompleted: true,
      reachedDone: false,
    }),
    false,
  );
});

