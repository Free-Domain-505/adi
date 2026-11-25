import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clearImdbResolverCache,
  resolveImdbMetadata,
} from '../server/imdbResolver.js'
import {
  clearSkipResolverCache,
  resolveSkipTimesPayload,
} from '../server/skipResolver.js'
import {
  resolveBestSkipPair,
  sanitizeSkipPair,
  selectValidatedIntroDb,
} from '../src/lib/skipValidation'

// ---------------------------------------------------------------------------
// IntroDB Response Parsing (intro, recap, outro, post_credits, no_* flags)
// ---------------------------------------------------------------------------

test('selectValidatedIntroDb parses intro, recap, outro, and post_credits and honors no_* flags', () => {
  const full = selectValidatedIntroDb(
    {
      imdb_id: 'tt2560140',
      media_type: 'tv',
      is_movie: false,
      season: 2,
      episode: 1,
      recap: { start_sec: 0, end_sec: 42 },
      intro: { start_sec: 45, end_sec: 135 },
      outro: { start_sec: 1320, end_sec: 1410 },
      post_credits: { start_ms: 1412000, end_ms: 1435000 },
      no_intro: false,
      no_recap: false,
      no_outro: false,
    },
    { durationSec: 1440 },
  )

  assert.deepEqual(full, {
    recap: { start: 0, end: 42 },
    intro: { start: 45, end: 135 },
    outro: { start: 1320, end: 1410 },
    postCredits: { start: 1412, end: 1435 },
  })

  // Respects no_intro / no_recap / no_outro flags even if stale sub-objects are present
  const suppressed = selectValidatedIntroDb(
    {
      imdb_id: 'tt0903747',
      intro: { start_sec: 10, end_sec: 60 },
      recap: { start_sec: 0, end_sec: 30 },
      outro: { start_sec: 1300, end_sec: 1390 },
      post_credits: { start_sec: 1350, end_sec: 1420 },
      no_intro: true,
      no_recap: true,
      no_outro: true,
    },
    { durationSec: 1440 },
  )
  assert.deepEqual(suppressed, {
    recap: null,
    intro: null,
    outro: null,
    postCredits: { start: 1350, end: 1420 },
  })
})

test('resolveBestSkipPair keeps IntroDB intro + outro over conflicting AniSkip and maps post_credits to outro when outro absent', () => {
  const merged = resolveBestSkipPair({
    streamIntro: { start: 5, end: 25 },
    streamOutro: { start: 1200, end: 1250 },
    sources: {
      introDb: {
        imdb_id: 'tt2560140',
        recap: { start_sec: 0, end_sec: 35 },
        intro: { start_sec: 90, end_sec: 180 },
        outro: null,
        post_credits: { start_sec: 1340, end_sec: 1420 },
        no_outro: true,
      },
      aniSkip: [
        { skipType: 'op', episodeLength: 1440, interval: { startTime: 40, endTime: 130 } },
      ],
    },
    durationSec: 1440,
  })

  // IntroDB intro MUST win over AniSkip OP and stream intro; outro falls back to post_credits -> SKIP OUTRO
  assert.deepEqual(merged, {
    recap: { start: 0, end: 35 },
    intro: { start: 90, end: 180 },
    outro: { start: 1340, end: 1420 },
  })
})

test('sanitizeSkipPair prevents overlapping recap/intro/outro segments', () => {
  const overlapped = sanitizeSkipPair({
    recap: { start: 30, end: 95 },
    intro: { start: 70, end: 160 },
    outro: { start: 170, end: 260 },
    durationSec: 1440,
  })
  assert.deepEqual(overlapped.intro, { start: 70, end: 160 })
  assert.deepEqual(overlapped.recap, { start: 30, end: 70 })
  // Outro starting < 30s after intro end or < minStart is rejected cleanly
  assert.equal(overlapped.outro, null)
})

// ---------------------------------------------------------------------------
// IMDb ID Resolution System Tests
// ---------------------------------------------------------------------------

test('resolveImdbMetadata handles direct IMDb, TMDB external_ids, MAL-only, and AniList-only with caching', async () => {
  clearImdbResolverCache()

  // 1. Existing IMDb ID returns immediately without network calls
  let netCalls = 0
  const direct = await resolveImdbMetadata(
    { imdbId: 'tt0903747', tmdbId: 1396, type: 'tv' },
    {
      fetchJson: async () => { netCalls++; return null },
      tmdbFetch: async () => { netCalls++; return null },
    },
  )
  assert.equal(direct.imdbId, 'tt0903747')
  assert.equal(direct.source, 'metadata')
  assert.equal(netCalls, 0)

  // 2. TMDB ID only -> resolves /tv/{id}/external_ids and caches result
  let tmdbCalls = 0
  const fromTmdb = await resolveImdbMetadata(
    { tmdbId: 1396, type: 'tv' },
    {
      tmdbFetch: async (ep) => {
        tmdbCalls++
        if (ep === 'tv/1396/external_ids') return { imdb_id: 'tt0903747' }
        return null
      },
      fetchJson: async () => null,
    },
  )
  assert.equal(fromTmdb.imdbId, 'tt0903747')
  assert.equal(fromTmdb.source, 'tmdb-external-ids')
  assert.equal(tmdbCalls, 1)

  const cachedTmdb = await resolveImdbMetadata(
    { tmdbId: 1396, type: 'tv' },
    { tmdbFetch: async () => { tmdbCalls++; return null } },
  )
  assert.equal(cachedTmdb.imdbId, 'tt0903747')
  assert.equal(tmdbCalls, 1, 'TMDB IMDb resolution must be cached')

  // Separate cache key for movie vs tv with identical numeric ID
  let movieCalls = 0
  const fromMovieSameNum = await resolveImdbMetadata(
    { tmdbId: 1396, type: 'movie' },
    {
      tmdbFetch: async (ep) => {
        movieCalls++
        if (ep === 'movie/1396/external_ids') return { imdb_id: 'tt9991396' }
        return null
      },
    },
  )
  assert.equal(fromMovieSameNum.imdbId, 'tt9991396')
  assert.equal(movieCalls, 1, 'Movie and TV must use separate cache keys')

  // 3. MAL ID only -> resolves via ARM cross-reference
  const fromMal = await resolveImdbMetadata(
    { malId: 16498, type: 'tv' },
    {
      fetchJson: async (url) => {
        if (url.includes('source=myanimelist&id=16498')) {
          return { imdb: 'tt2560140', themoviedb: 1429, 'themoviedb-season': 1, media: 'TV', anilist: 16498 }
        }
        return null
      },
      tmdbFetch: async () => null,
      skipTmdbTitleCheck: true,
    },
  )
  assert.equal(fromMal.imdbId, 'tt2560140')
  assert.equal(fromMal.source, 'arm-mal')

  // 4. AniList ID only -> resolves multi-season anime via ARM & preserves TMDB season 3
  const fromAniList = await resolveImdbMetadata(
    { anilistId: 142329, format: 'TV' },
    {
      fetchJson: async (url) => {
        if (url.includes('source=anilist&id=142329')) {
          return { imdb: 'tt9335498', themoviedb: 85937, 'themoviedb-season': 3, media: 'TV', myanimelist: 47778 }
        }
        return null
      },
      tmdbFetch: async () => null,
      skipTmdbTitleCheck: true,
    },
  )
  assert.equal(fromAniList.imdbId, 'tt9335498')
  assert.equal(fromAniList.season, 3)
  assert.equal(fromAniList.malId, 47778)
})

test('resolveImdbMetadata handles Japanese/English/alternative titles and rejects remakes/wrong years/movies vs TV', async () => {
  clearImdbResolverCache()

  const resolved = await resolveImdbMetadata(
    {
      title: 'Fruits Basket (2019)',
      englishTitle: 'Fruits Basket',
      romajiTitle: 'Fruits Basket: 1st Season',
      nativeTitle: 'フルーツバスケット',
      year: 2019,
      format: 'TV',
      season: 1,
    },
    {
      tmdbFetch: async (ep) => {
        if (ep.startsWith('search/tv')) {
          return {
            results: [
              // 2001 original must be REJECTED when 2019 remake is requested
              { id: 1001, name: 'Fruits Basket', original_name: 'フルーツバスケット', first_air_date: '2001-07-05', genre_ids: [16], original_language: 'ja' },
              // 2019 remake must be SELECTED
              { id: 85989, name: 'Fruits Basket', original_name: 'フルーツバスケット', first_air_date: '2019-04-06', genre_ids: [16], original_language: 'ja' },
            ],
          }
        }
        if (ep === 'tv/85989/external_ids') return { imdb_id: 'tt9304350' }
        if (ep === 'tv/1001/external_ids') return { imdb_id: 'tt0328738' }
        return null
      },
      fetchJson: async () => null,
    },
  )
  assert.equal(resolved.imdbId, 'tt9304350')
  assert.equal(resolved.tmdbId, 85989)

  // Separate movie vs TV: Movie lookup searches search/movie and never falls back to guessing IMDb IDs
  const unresolvedMovie = await resolveImdbMetadata(
    {
      title: 'Totally Unknown Anime Movie',
      format: 'MOVIE',
      year: 2024,
    },
    {
      tmdbFetch: async () => ({ results: [] }),
      fetchJson: async () => null,
    },
  )
  assert.equal(unresolvedMovie.imdbId, null)
  assert.equal(unresolvedMovie.source, 'unresolved')
})

// ---------------------------------------------------------------------------
// Backend Skip Resolver Orchestration + Smart Fallback + Episode Switching
// ---------------------------------------------------------------------------

test('resolveSkipTimesPayload tries IntroDB first, skips AniSkip when complete, and falls back only for missing slots', async () => {
  clearImdbResolverCache()
  clearSkipResolverCache()

  // Scenario A: TV series & Movie with full IntroDB -> zero AniSkip calls!
  let aniSkipCalls = 0
  let introDbCalls = 0
  const tvFull = await resolveSkipTimesPayload(
    { imdbId: 'tt2560140', malId: 16498, type: 'tv', season: 1, episode: 1, ep: 1 },
    {
      fetchJson: async (url) => {
        if (url.startsWith('https://api.introdb.app/segments')) {
          introDbCalls++
          assert.match(url, /imdb_id=tt2560140&season=1&episode=1/)
          return {
            imdb_id: 'tt2560140',
            intro: { start_sec: 90, end_sec: 150 },
            outro: { start_sec: 1340, end_sec: 1430 },
            recap: null,
            no_intro: false,
            no_recap: true,
            no_outro: false,
          }
        }
        if (url.startsWith('https://api.aniskip.com')) aniSkipCalls++
        return null
      },
    },
  )
  assert.equal(tvFull.primaryProvider, 'introdb')
  assert.equal(tvFull.aniSkipUsed, false)
  assert.equal(aniSkipCalls, 0, 'AniSkip must NOT be called when IntroDB provides intro + outro')
  assert.equal(introDbCalls, 1)

  // Second request hits cache cleanly
  const tvCached = await resolveSkipTimesPayload(
    { imdbId: 'tt2560140', malId: 16498, type: 'tv', season: 1, episode: 1, ep: 1 },
    {
      fetchJson: async () => {
        introDbCalls++
        return null
      },
    },
  )
  assert.equal(tvCached.introDb?.intro?.start_sec, 90)
  assert.equal(introDbCalls, 1, 'IntroDB TV episode response must be cached')

  // Scenario B: IntroDB movie with intro only -> AniSkip fills missing outro without overwriting IntroDB intro
  clearSkipResolverCache()
  let partialAniCalls = 0
  const partialIntroOnly = await resolveSkipTimesPayload(
    { imdbId: 'tt0371746', malId: 99901, type: 'movie', is_movie: true },
    {
      fetchJson: async (url) => {
        if (url.startsWith('https://api.introdb.app/segments')) {
          assert.match(url, /imdb_id=tt0371746&is_movie=true/)
          return {
            imdb_id: 'tt0371746',
            media_type: 'movie',
            is_movie: true,
            intro: { start_sec: 45, end_sec: 120 },
            outro: null,
            no_intro: false,
            no_outro: true,
          }
        }
        if (url.startsWith('https://api.aniskip.com')) {
          partialAniCalls++
          return {
            found: true,
            results: [
              // Conflicting OP must NEVER overwrite IntroDB's 45..120!
              { skipType: 'op', episodeLength: 5400, interval: { startTime: 10, endTime: 90 } },
              { skipType: 'ed', episodeLength: 5400, interval: { startTime: 5100, endTime: 5340 } },
            ],
          }
        }
        return null
      },
    },
  )
  assert.equal(partialIntroOnly.aniSkipUsed, true)
  assert.equal(partialAniCalls, 1)
  const resolvedPartial = resolveBestSkipPair({ sources: partialIntroOnly, durationSec: 5400 })
  assert.deepEqual(resolvedPartial.intro, { start: 45, end: 120 }, 'Valid IntroDB intro must not be overwritten')
  assert.deepEqual(resolvedPartial.outro, { start: 5100, end: 5340 }, 'AniSkip must fill missing outro')

  // Scenario C: IntroDB outro only -> AniSkip fills missing intro without overwriting IntroDB outro
  clearSkipResolverCache()
  const partialOutroOnly = await resolveSkipTimesPayload(
    { imdbId: 'tt0903747', malId: 99902, type: 'tv', season: 1, episode: 2, ep: 2 },
    {
      fetchJson: async (url) => {
        if (url.startsWith('https://api.introdb.app/segments')) {
          return {
            imdb_id: 'tt0903747',
            intro: null,
            outro: { start_sec: 1325, end_sec: 1415 },
            no_intro: true,
            no_outro: false,
          }
        }
        if (url.startsWith('https://api.aniskip.com')) {
          return {
            found: true,
            results: [
              { skipType: 'op', episodeLength: 1440, interval: { startTime: 85, endTime: 175 } },
              { skipType: 'ed', episodeLength: 1440, interval: { startTime: 1280, endTime: 1370 } },
            ],
          }
        }
        return null
      },
    },
  )
  const resolvedOutroOnly = resolveBestSkipPair({ sources: partialOutroOnly, durationSec: 1440 })
  assert.deepEqual(resolvedOutroOnly.intro, { start: 85, end: 175 })
  assert.deepEqual(resolvedOutroOnly.outro, { start: 1325, end: 1415 }, 'Valid IntroDB outro must not be overwritten')

  // Scenario D: IntroDB fails/times out -> graceful fallback to AniSkip
  clearSkipResolverCache()
  const introTimeoutFallback = await resolveSkipTimesPayload(
    { imdbId: 'tt2560140', malId: 16498, type: 'tv', season: 1, episode: 3, ep: 3 },
    {
      fetchJson: async (url) => {
        if (url.startsWith('https://api.introdb.app/segments')) throw new Error('TimeoutError')
        if (url.startsWith('https://api.aniskip.com')) {
          return {
            found: true,
            results: [
              { skipType: 'op', episodeLength: 1440, interval: { startTime: 65, endTime: 155 } },
            ],
          }
        }
        return null
      },
    },
  )
  assert.equal(introTimeoutFallback.primaryProvider, 'aniskip')
  const resolvedTimeout = resolveBestSkipPair({ sources: introTimeoutFallback, durationSec: 1440 })
  assert.deepEqual(resolvedTimeout.intro, { start: 65, end: 155 })

  // Scenario E: Both IntroDB & AniSkip fail -> returns null segments cleanly without throwing
  clearSkipResolverCache()
  const bothFail = await resolveSkipTimesPayload(
    { imdbId: 'tt2560140', malId: 16498, type: 'tv', season: 1, episode: 4, ep: 4 },
    {
      fetchJson: async () => null,
    },
  )
  assert.equal(bothFail.success, true)
  assert.equal(bothFail.primaryProvider, null)
  assert.deepEqual(resolveBestSkipPair({ sources: bothFail, durationSec: 1440 }), {
    intro: null,
    recap: null,
    outro: null,
  })

  // Scenario F: Episode switch / next episode fetches distinct segments cleanly
  const ep5 = await resolveSkipTimesPayload(
    { imdbId: 'tt2560140', malId: 16498, type: 'tv', season: 1, episode: 5, ep: 5 },
    {
      fetchJson: async (url) => {
        if (url.includes('episode=5')) {
          return {
            imdb_id: 'tt2560140',
            intro: { start_sec: 112, end_sec: 202 },
            outro: { start_sec: 1350, end_sec: 1435 },
          }
        }
        return null
      },
    },
  )
  assert.deepEqual(resolveBestSkipPair({ sources: ep5, durationSec: 1440 }), {
    intro: { start: 112, end: 202 },
    recap: null,
    outro: { start: 1350, end: 1435 },
  })
})

test('Death Note ep 26 outro from IntroDB reliably validates and clamps across varied stream cut durations', () => {
  const introDb = {
    imdb_id: 'tt0877057',
    media_type: 'tv',
    is_movie: false,
    season: 1,
    episode: 26,
    intro: { start_sec: 0.125, end_sec: 89.72 },
    recap: null,
    outro: { start_sec: 1285.16, end_sec: 1355.23 },
    post_credits: null,
    no_intro: false,
    no_recap: false,
    no_outro: false,
  }

  // 1. When video duration is exactly as IntroDB recorded (~1376s MegaPlay/ACDN stream)
  const fullCut = resolveBestSkipPair({
    sources: { introDb },
    durationSec: 1376.17,
    expectedDurationSec: 1380,
  })
  assert.deepEqual(fullCut.intro, { start: 0.1, end: 89.7 })
  assert.deepEqual(fullCut.outro, { start: 1285.2, end: 1355.2 })

  // 2. When estimated duration from TMDB is 22 minutes (1320s), outro is clamped to 1320 instead of discarded
  const tmdbCut = resolveBestSkipPair({
    sources: { introDb },
    durationSec: 0,
    expectedDurationSec: 1320,
  })
  assert.deepEqual(tmdbCut.outro, { start: 1285.2, end: 1320 })

  // 3. When stream cut was trimmed at 1350s (before IntroDB 1355.2s), outro clamps to 1350 cleanly
  const trimmedCut = resolveBestSkipPair({
    sources: { introDb },
    durationSec: 1350,
  })
  assert.deepEqual(trimmedCut.outro, { start: 1285.2, end: 1350 })

  // 4. Standard 24m video duration preserves full outro
  const standardCut = resolveBestSkipPair({
    sources: { introDb },
    durationSec: 1440,
  })
  assert.deepEqual(standardCut.outro, { start: 1285.2, end: 1355.2 })
})

