import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSkipInterval,
  sanitizeSkipPair,
  selectValidatedAniSkip,
  selectValidatedTheIntroDb,
  selectValidatedIntroDb,
  resolveBestSkipPair,
} from '../src/lib/skipValidation';
import {
  resolveHeroScore,
  resolveHeroCarouselBackdrops,
} from '../src/lib/heroPresentation';
import { computeAudioCheckingState } from '../src/lib/audioLabels';
import {
  buildPosStorageKey,
  isNearOrAtPlaybackEnd,
  shouldPersistPlaybackPosition,
  resolveResumePosition,
  shouldRestartFromBeginningOnPlay,
} from '../src/lib/playbackResume';
import type { AniMedia } from '../src/types/anime';
import type { TmdbBundle } from '../src/services/api';

// ============================================================================
// 1. Skip Intro / Skip Outro Accuracy Validation
// ============================================================================

test('validateSkipInterval accepts standard OP and ED intervals within a 24m episode', () => {
  const op = validateSkipInterval({ start: 85, end: 175 }, 'intro', { durationSec: 1420 });
  assert.deepEqual(op, { start: 85, end: 175 });

  const ed = validateSkipInterval({ start: 1295, end: 1385 }, 'outro', { durationSec: 1420 });
  assert.deepEqual(ed, { start: 1295, end: 1385 });
});

test('validateSkipInterval supports valid movie/episode OP/ED and rejects mid-video false triggers, huge spans, and short clips', () => {
  // Mid-episode fake OP at 11 minutes into a 24m episode
  assert.equal(validateSkipInterval({ start: 660, end: 750 }, 'intro', { durationSec: 1440 }), null);

  // Mid-episode fake ED at 5 minutes into a 24m episode
  assert.equal(validateSkipInterval({ start: 300, end: 390 }, 'outro', { durationSec: 1440 }), null);

  // ED that ends 10 minutes before the episode ends (clearly wrong!)
  assert.equal(validateSkipInterval({ start: 760, end: 850 }, 'outro', { durationSec: 1440 }), null);

  // Overly long (>165s) intro span in a 24m episode
  assert.equal(validateSkipInterval({ start: 0, end: 260 }, 'intro', { durationSec: 1440 }), null);

  // Tiny (<15s) accidental marker in the middle of a video
  assert.equal(validateSkipInterval({ start: 90, end: 98 }, 'intro', { durationSec: 1440 }), null);

  // Feature film cold-open intros and 7-9 min theatrical end credits are accepted
  assert.deepEqual(validateSkipInterval({ start: 90, end: 180 }, 'intro', { durationSec: 5400 }), { start: 90, end: 180 });
  assert.deepEqual(validateSkipInterval({ start: 600, end: 720 }, 'intro', { durationSec: 7560 }), { start: 600, end: 720 });
  assert.deepEqual(validateSkipInterval({ start: 5100, end: 5340 }, 'outro', { durationSec: 5400 }), { start: 5100, end: 5340 });
  assert.deepEqual(validateSkipInterval({ start: 8918, end: 9342 }, 'outro', { durationSec: 9360 }), { start: 8918, end: 9342 }); // 424s credits (Spider-Man NWH)
  assert.deepEqual(validateSkipInterval({ start: 7038, end: 7540 }, 'outro', { durationSec: 7580 }), { start: 7038, end: 7540 }); // 502s credits (Iron Man)

  // Short end-slate ED right at end of anime movie (e.g. Mugen Train 10s ED) is accepted
  assert.deepEqual(validateSkipInterval({ start: 6998, end: 7008 }, 'outro', { durationSec: 7008 }), { start: 6998, end: 7008 });

  // Mid-movie bogus outro at 50m of a 90m movie is rejected
  assert.equal(validateSkipInterval({ start: 3000, end: 3150 }, 'outro', { durationSec: 5400 }), null);

  // Late bogus intro at the end of a movie (e.g. IntroDB Iron Man 7512..7545) is rejected
  assert.equal(validateSkipInterval({ start: 7512, end: 7545 }, 'intro', { durationSec: 7580 }), null);

  // Short clip / preview (<120s) must never trigger OP/ED skip
  assert.equal(validateSkipInterval({ start: 10, end: 40 }, 'intro', { durationSec: 90 }), null);

  // Slight ED end overrun (<=5s) clamps cleanly to duration
  assert.deepEqual(
    validateSkipInterval({ start: 1330, end: 1423 }, 'outro', { durationSec: 1420 }),
    { start: 1330, end: 1420 },
  );
  // Massive overrun (>5s, wrong episode cut) is rejected
  assert.equal(validateSkipInterval({ start: 1330, end: 1480 }, 'outro', { durationSec: 1420 }), null);
});

test('selectValidatedAniSkip filters out mismatched episodeLength cuts and supports op/ed/mixed tags', () => {
  const results = [
    // Bad match: from a 48m double special, whereas our video is 24m (1420s)
    { skipType: 'op', episodeLength: 2840, interval: { startTime: 550, endTime: 640 } },
    // Good match: ~24m cut
    { skipType: 'op', episodeLength: 1422, interval: { startTime: 78, endTime: 168 } },
    // Mixed OP also present: explicit op beats mixed-op when equal
    { skipType: 'mixed-op', episodeLength: 1422, interval: { startTime: 82, endTime: 170 } },
    // Bad ED: early mid-episode timestamp from wrong cut
    { skipType: 'ed', episodeLength: 1422, interval: { startTime: 400, endTime: 490 } },
    // Mixed ED when no standard ed is valid
    { skipType: 'mixed-ed', episodeLength: 1422, interval: { startTime: 1300, endTime: 1390 } },
  ];

  const picked = selectValidatedAniSkip(results, { durationSec: 1420 });
  assert.deepEqual(picked, {
    intro: { start: 78, end: 168 },
    outro: { start: 1300, end: 1390 },
  });
});

test('selectValidatedTheIntroDb handles open bounds (null start_ms/end_ms) and picks main movie credits over short post-credits stingers', () => {
  // Open intro bound + open credits bound (TV episode)
  const tvPicked = selectValidatedTheIntroDb(
    {
      intro: [{ start_ms: null, end_ms: 38000 }],
      credits: [{ start_ms: 3432000, end_ms: null }],
    },
    { durationSec: 3500 },
  );
  assert.deepEqual(tvPicked, {
    intro: { start: 0, end: 38 },
    outro: { start: 3432, end: 3500 },
  });

  // Feature film with 473s main credits + 15s post-credits scene (Iron Man shape)
  const moviePicked = selectValidatedTheIntroDb(
    {
      intro: [{ start_ms: 60000, end_ms: 128000 }],
      credits: [
        { start_ms: 7546000, end_ms: 7561000 },
        { start_ms: 7039000, end_ms: 7512000 },
      ],
    },
    { durationSec: 7565 },
  );
  assert.deepEqual(moviePicked, {
    intro: { start: 60, end: 128 },
    outro: { start: 7039, end: 7512 },
  });
});

test('selectValidatedIntroDb rejects bogus late intro timestamps while keeping valid movie credits', () => {
  const picked = selectValidatedIntroDb(
    {
      imdb_id: 'tt0371746',
      intro: { start_sec: 7512, end_sec: 7545 },
      outro: { start_sec: 7038, end_sec: 7540 },
    },
    { durationSec: 7580 },
  );
  assert.deepEqual(picked, {
    intro: null,
    recap: null,
    outro: { start: 7038, end: 7540 },
    postCredits: null,
  });
});

test('resolveBestSkipPair prioritizes IntroDB first over AniSkip, TheIntroDB, and stream metadata', () => {
  const merged = resolveBestSkipPair({
    streamIntro: null,
    streamOutro: null,
    sources: {
      aniSkip: null,
      theIntroDb: {
        credits: [{ start_ms: 5745000, end_ms: 6215000 }],
      },
      introDb: {
        intro: { start_sec: 45, end_sec: 120 },
        outro: { start_sec: 5800, end_sec: 6210 },
      },
    },
    durationSec: 6300,
  });
  assert.deepEqual(merged, {
    intro: { start: 45, end: 120 },
    recap: null,
    outro: { start: 5800, end: 6210 },
  });
});

test('sanitizeSkipPair ensures OP and ED never overlap', () => {
  const res = sanitizeSkipPair({
    intro: { start: 80, end: 170 },
    outro: { start: 190, end: 280 },
    durationSec: 350,
  });
  assert.deepEqual(res.intro, { start: 80, end: 170 });
  assert.equal(res.recap, null);
  assert.equal(res.outro, null);
});

// ============================================================================
// 2. Featured Multi-Season Rating & Image Distinctness
// ============================================================================

function makeAnime(overrides: Partial<AniMedia> & { id: number; english: string }): AniMedia {
  return {
    id: overrides.id,
    idMal: null,
    title: { english: overrides.english, romaji: overrides.english, native: null },
    format: overrides.format ?? 'TV',
    status: overrides.status ?? 'FINISHED',
    episodes: overrides.episodes ?? 12,
    duration: 24,
    seasonYear: overrides.seasonYear ?? 2024,
    season: 'WINTER',
    averageScore: 'averageScore' in overrides ? overrides.averageScore ?? null : 80,
    popularity: 10000,
    genres: ['Action'],
    bannerImage: overrides.bannerImage ?? null,
    coverImage: overrides.coverImage ?? { extraLarge: `https://cover/${overrides.id}.jpg`, large: `https://cover/${overrides.id}.jpg`, color: null },
    description: null,
    trailer: null,
    nextAiringEpisode: null,
    countryOfOrigin: 'JP',
  };
}

function makeBundle(tmdbId: number, rating: number, backdrop: string, backdrops: string[], season: number | null = null): TmdbBundle {
  return {
    mapping: { anilist: 1, mal: 1, tmdb: { id: tmdbId, type: 'tv', season }, tvdb: null, imdb: null, anidb: null, source: 'anibridge' },
    tmdb: {
      id: tmdbId,
      type: 'tv',
      season,
      imdbId: null,
      logo: null,
      backdrop,
      backdrops,
      overview: null,
      tagline: null,
      rating,
      votes: 1000,
      certification: null,
      networks: [],
      status: null,
      language: 'ja',
      seasons: 2,
      episodes: 24,
      firstAir: null,
      lastAir: null,
      runtime: 24,
      cast: [],
      trailer: null,
    },
  };
}

test('resolveHeroScore uses each season AniList score instead of shared TMDB parent rating', () => {
  const s1 = makeAnime({ id: 101, english: 'Solo Leveling', averageScore: 82 });
  const s2 = makeAnime({ id: 102, english: 'Solo Leveling Season 2', averageScore: 88 });
  const sharedBundle = makeBundle(2000, 8.6, '/s0.jpg', ['/s0.jpg', '/s1.jpg']);

  assert.equal(resolveHeroScore(s1, sharedBundle.tmdb), '8.2');
  assert.equal(resolveHeroScore(s2, sharedBundle.tmdb), '8.8');

  // Falls back to TMDB rating when AniList averageScore is absent
  const unrated = makeAnime({ id: 103, english: 'Upcoming', averageScore: null });
  assert.equal(resolveHeroScore(unrated, sharedBundle.tmdb), 8.6);
});

test('resolveHeroCarouselBackdrops assigns distinct backdrops across different seasons sharing one TMDB ID', () => {
  const s1 = makeAnime({ id: 101, english: 'Jujutsu Kaisen', bannerImage: 'https://al/jjk1.jpg' });
  const s2 = makeAnime({ id: 102, english: 'Jujutsu Kaisen Season 2', bannerImage: 'https://al/jjk2.jpg' });
  const s3 = makeAnime({ id: 103, english: 'Jujutsu Kaisen Season 3', bannerImage: 'https://al/jjk3.jpg' });

  const bundles: Record<number, TmdbBundle> = {
    101: makeBundle(95479, 8.6, '/bd1.jpg', ['/bd1.jpg', '/bd2.jpg'], 1),
    102: makeBundle(95479, 8.6, '/bd1.jpg', ['/bd1.jpg', '/bd2.jpg'], 2),
    103: makeBundle(95479, 8.6, '/bd1.jpg', ['/bd1.jpg', '/bd2.jpg'], 3),
  };

  const map = resolveHeroCarouselBackdrops([s1, s2, s3], bundles);
  assert.equal(map.get(101)?.backdropPath, '/bd1.jpg');
  assert.equal(map.get(102)?.backdropPath, '/bd2.jpg');
  // All TMDB backdrops claimed -> Season 3 falls back to its own distinct AniList banner instead of repeating /bd1.jpg!
  assert.equal(map.get(103)?.backdropPath, null);
  assert.equal(map.get(103)?.fallbackBanner, 'https://al/jjk3.jpg');
});

// ============================================================================
// 3. Details Page Audio Loading Gate
// ============================================================================

test('computeAudioCheckingState holds loading until background detector & season resolve', () => {
  // Initial idle before useEffect triggers scan -> MUST remain checking (no false audio flash!)
  assert.equal(
    computeAudioCheckingState({
      hasAnime: true,
      seasonReady: true,
      detectorStatus: 'idle',
      hasReport: false,
      serverAvailLoading: false,
      serverAvailHasData: true,
      hasMultipleEpisodes: true,
      remoteBreakdownLoading: false,
      remoteBreakdownHasData: true,
      remoteBreakdownHasError: false,
    }),
    true,
  );

  // Even when single-episode & serverAvail settled early, hold while detector is scanning
  assert.equal(
    computeAudioCheckingState({
      hasAnime: true,
      seasonReady: true,
      detectorStatus: 'scanning',
      hasReport: false,
      serverAvailLoading: false,
      serverAvailHasData: true,
      hasMultipleEpisodes: false,
      remoteBreakdownLoading: false,
      remoteBreakdownHasData: false,
      remoteBreakdownHasError: false,
    }),
    true,
  );

  // Hold while TMDB season hasn't resolved for untagged sequel titles
  assert.equal(
    computeAudioCheckingState({
      hasAnime: true,
      seasonReady: false,
      detectorStatus: 'idle',
      hasReport: false,
      serverAvailLoading: false,
      serverAvailHasData: false,
      hasMultipleEpisodes: true,
      remoteBreakdownLoading: false,
      remoteBreakdownHasData: false,
      remoteBreakdownHasError: false,
    }),
    true,
  );

  // Resolves immediately once verified report lands
  assert.equal(
    computeAudioCheckingState({
      hasAnime: true,
      seasonReady: true,
      detectorStatus: 'verified',
      hasReport: true,
      serverAvailLoading: false,
      serverAvailHasData: true,
      hasMultipleEpisodes: true,
      remoteBreakdownLoading: false,
      remoteBreakdownHasData: true,
      remoteBreakdownHasError: false,
    }),
    false,
  );

  // Or if detector errored and both server probes settled cleanly
  assert.equal(
    computeAudioCheckingState({
      hasAnime: true,
      seasonReady: true,
      detectorStatus: 'error',
      hasReport: false,
      serverAvailLoading: false,
      serverAvailHasData: true,
      hasMultipleEpisodes: true,
      remoteBreakdownLoading: false,
      remoteBreakdownHasData: true,
      remoteBreakdownHasError: false,
    }),
    false,
  );
});

// ============================================================================
// 4. Full-Length Playback Completion & Restart From Beginning
// ============================================================================

test('buildPosStorageKey scopes AniList, TMDB movies, and TMDB TV seasons separately', () => {
  assert.equal(buildPosStorageKey({ mediaId: 21, episode: 5 }), 'zk:pos:21:5');
  assert.equal(buildPosStorageKey({ mediaId: 550, episode: 1, season: 1, isTmdb: true }), 'zk:pos:tmdb:1:550:1');
  assert.equal(buildPosStorageKey({ mediaId: 1396, episode: 3, season: 2, isTmdb: true }), 'zk:pos:tmdb:2:1396:3');
});

test('isNearOrAtPlaybackEnd and shouldPersistPlaybackPosition clear near-end and full-length timestamps', () => {
  assert.equal(isNearOrAtPlaybackEnd(100, 100, true), true);
  assert.equal(isNearOrAtPlaybackEnd(1300, 1440, false), true); // 90.2%
  assert.equal(isNearOrAtPlaybackEnd(5388, 5400, false), true); // within final 15s
  assert.equal(isNearOrAtPlaybackEnd(600, 1440, false), false);

  assert.equal(shouldPersistPlaybackPosition(2, 1440), false);
  assert.equal(shouldPersistPlaybackPosition(600, 1440), true);
  assert.equal(shouldPersistPlaybackPosition(1320, 1440), false);
  assert.equal(shouldPersistPlaybackPosition(5390, 5400), false);
});

test('resolveResumePosition resets completed or full-length watched videos back to 0:00', () => {
  // Mid-watch resumes normally
  assert.equal(
    resolveResumePosition({ savedPos: 420, durationSec: 1440 }),
    420,
  );

  // Saved position >= 90% or within final 15s resets to 0
  assert.equal(
    resolveResumePosition({ savedPos: 1310, durationSec: 1440 }),
    0,
  );
  assert.equal(
    resolveResumePosition({ savedPos: 5390, durationSec: 5400 }),
    0,
  );

  // Short clip watched near full length (e.g. 5s test stream at 4.6s) resets to 0
  assert.equal(
    resolveResumePosition({ savedPos: 12, durationSec: 13 }),
    0,
  );

  // When runtime unknown before metadata (durationSec=0, expectedDurationSec=0), waits until metadata reveals full length
  assert.equal(
    resolveResumePosition({ savedPos: 1350, durationSec: 0, expectedDurationSec: 0 }),
    1350,
  );
  // Once metadata resolves full duration as 1440s, resets cleanly to 0
  assert.equal(
    resolveResumePosition({ savedPos: 1350, durationSec: 1440, expectedDurationSec: 0 }),
    0,
  );

  // Quality/server switch on same episode after finishing uses livePos=0 and stays at 0
  assert.equal(
    resolveResumePosition({ savedPos: 0, livePos: 0, sameEpisode: true, durationSec: 1440 }),
    0,
  );
  // Completed flag always forces start from 0
  assert.equal(
    resolveResumePosition({ savedPos: 500, durationSec: 1440, completed: true }),
    0,
  );
});

test('shouldRestartFromBeginningOnPlay detects ended or at-EOF state so Play starts from 0:00', () => {
  assert.equal(
    shouldRestartFromBeginningOnPlay({ ended: true, currentTimeSec: 1440, durationSec: 1440 }),
    true,
  );
  assert.equal(
    shouldRestartFromBeginningOnPlay({ ended: false, currentTimeSec: 1439, durationSec: 1440 }),
    true,
  );
  assert.equal(
    shouldRestartFromBeginningOnPlay({ ended: false, currentTimeSec: 400, durationSec: 1440 }),
    false,
  );
});
