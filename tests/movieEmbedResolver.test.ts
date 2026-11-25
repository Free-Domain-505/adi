import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDirectServerSources,
  decryptVidNestPayload,
  extractRawStreamEntries,
  mapProviderHintToExtractor,
  parseEmbedUrlContext,
} from '../server/movieEmbedResolver.js'
import {
  buildMovieEmbedCandidates,
  isTrustedMovieEmbedUrl,
  isValidEmbedResponse,
  shouldUpgradeMovieBoxToVidzee,
} from '../server/detectStreamLogic.js'
import { validateProxyUrl } from '../server/ssrf.js'
import {
  buildEmbedCandidates,
  evaluateEmbedResponse,
  isTrustedMovieEmbedUrl as isClientTrustedEmbedUrl,
} from '../src/lib/movieServers.ts'

const TEST_SECRET = 'K3p8vQ2mX9rL5wZ0fN7bG1sH4tJ6dC9_y8S3wM1nQ5pL2'

function toB64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

async function encryptVidNestV2(obj: unknown, nonce = 'testNonce123') {
  const keyMaterial = new TextEncoder().encode(`${nonce}|${TEST_SECRET}`)
  const hash = await globalThis.crypto.subtle.digest('SHA-256', keyMaterial)
  const key = await globalThis.crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  const pt = new TextEncoder().encode(JSON.stringify(obj))
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt))
  const combined = new Uint8Array(iv.length + ct.length)
  combined.set(iv, 0)
  combined.set(ct, iv.length)
  return { v: 2, n: nonce, d: toB64Url(combined) }
}

test('decryptVidNestPayload decrypts AES-256-GCM v2 envelope cleanly', async () => {
  const sample = {
    streams: [
      {
        url: 'https://m5f-cf.money-12.workers.dev/hls/abc/master.m3u8',
        quality: '1080p',
        type: 'hls',
        language: 'Hindi',
      },
    ],
  }
  const encrypted = await encryptVidNestV2(sample)
  const decrypted = await decryptVidNestPayload(encrypted)
  assert.deepEqual(decrypted, sample)

  // Unencrypted passthrough returns unchanged
  const plain = { url: 'https://pwcloud.animanga.fun/hls/xyz' }
  assert.deepEqual(await decryptVidNestPayload(plain), plain)
})

test('parseEmbedUrlContext and mapProviderHintToExtractor parse movie and TV embed URLs accurately', () => {
  assert.deepEqual(parseEmbedUrlContext('https://www.nontongo.win/embed/movie/550'), {
    tmdbId: 550,
    type: 'movie',
    season: 1,
    episode: 1,
  })
  assert.deepEqual(parseEmbedUrlContext('https://vidnest.fun/tv/1396/2/5'), {
    tmdbId: 1396,
    type: 'tv',
    season: 2,
    episode: 5,
  })
  assert.deepEqual(parseEmbedUrlContext('https://cinemaos.tech/player/939243/1/3?lang=en'), {
    tmdbId: 939243,
    type: 'tv',
    season: 1,
    episode: 3,
  })
  assert.deepEqual(parseEmbedUrlContext('https://primesrc.me/embed/tv?tmdb=66732&season=3&episode=4'), {
    tmdbId: 66732,
    type: 'tv',
    season: 3,
    episode: 4,
  })

  assert.equal(mapProviderHintToExtractor('nontongo', 'https://www.nontongo.win/embed/movie/550'), 'yflix')
  assert.equal(mapProviderHintToExtractor('rpmvid', ''), 'rpmvid')
  assert.equal(mapProviderHintToExtractor('ophim', ''), 'ophim')
})

test('extractRawStreamEntries normalizes streams/sources/url payloads and headers', () => {
  const fromStreams = extractRawStreamEntries({
    streams: [
      { url: 'https://patient-cherry.workerscloud32.workers.dev/hls2/master.m3u8', headers: { Referer: 'https://moviesapi.to/' }, quality: 'auto', type: 'hls', language: 'Original' },
      { url: 'invalid-relative-path', quality: '720p' },
    ],
  })
  assert.equal(fromStreams.length, 1)
  assert.equal(fromStreams[0].referer, 'https://moviesapi.to/')

  const fromSingle = extractRawStreamEntries({
    url: 'https://pwcloud.animanga.fun/hls/abc',
    headers: { Referer: 'https://pwcloud.animanga.fun/' },
  })
  assert.equal(fromSingle.length, 1)
  assert.equal(fromSingle[0].url, 'https://pwcloud.animanga.fun/hls/abc')
})

test('buildDirectServerSources ranks H.264 480p/720p/1080p multi-quality above HEVC/single-res/MKV and groups backups', () => {
  const { primary, extras, dubs } = buildDirectServerSources({
    verifiedStreams: [
      {
        extractorKey: 'vidzee-mirror',
        extractorPriority: 3,
        url: 'https://s2.streamflixserver.site/movies/2024/sonic3.mkv',
        format: 'mp4',
        isHls: false,
        isMkv: true,
        isHevcOnly: false,
        maxResolution: 1080,
        hasMultiQuality: false,
        heights: [],
        languageNormalized: 'English',
        effectiveReferer: 'https://s2.streamflixserver.site/',
      },
      {
        extractorKey: 'ophim',
        extractorPriority: 9,
        url: 'https://m5f-cf.money-12.workers.dev/hls/abc/master.m3u8',
        format: 'hls',
        isHls: true,
        isMkv: false,
        isHevcOnly: true,
        maxResolution: 1080,
        hasMultiQuality: true,
        heights: [1080, 720, 480],
        languageNormalized: 'Original',
        effectiveReferer: null,
      },
      {
        extractorKey: 'flixhq',
        extractorPriority: 11,
        url: 'https://ss-cf.money-13.workers.dev/hls/xyz/master.m3u8',
        format: 'hls',
        isHls: true,
        isMkv: false,
        isHevcOnly: false,
        maxResolution: 2160,
        hasMultiQuality: true,
        heights: [2160, 1080, 720, 480],
        languageNormalized: 'Original',
        effectiveReferer: null,
      },
    ],
    subtitles: [
      { id: 'vdrk_sub_0', label: 'English', language: 'English', lang: 'eng', url: '/proxy?url=https%3A%2F%2Fcache.vdrk.site%2Fv3%2Fsub.vtt&noref=1', source: 'EmbedSub' },
    ],
    proxyBase: '/proxy',
  })

  assert.ok(primary)
  assert.equal(primary.kind, 'direct')
  assert.equal(primary.providerId, 'embed-flixhq')
  assert.equal(primary.label, 'Server 3')
  assert.equal(primary.streams[0].format, 'hls')
  assert.deepEqual(primary.streams[0].heights, [2160, 1080, 720, 480])
  assert.ok(primary.streamUrl.includes('/proxy?url='))
  assert.ok(primary.streamUrl.includes('playlist=1'))
  assert.equal(primary.subtitles.length, 1)

  // Additional verified backup servers stay direct (HEVC ophim -> MKV pushed last)
  assert.equal(extras.length, 2)
  assert.equal(extras[0].providerId, 'embed-ophim')
  assert.equal(extras[0].kind, 'direct')
  assert.equal(extras[1].providerId, 'embed-vidzee-mirror')
  assert.ok(dubs.some((d: any) => d.label === 'Original'))
})

test('shouldUpgradeMovieBoxToVidzee never downgrades HD MovieBox to unverified low-res Vidzee HD (Auto)', () => {
  assert.equal(
    shouldUpgradeMovieBoxToVidzee(
      [{ quality: '1080p', resolutionNum: 1080 }],
      [{ quality: 'HD (Auto)', resolutionNum: 0, hasMultiQuality: false, language: 'Hindi' }],
      { mbHasHindi: false, vzHasHindi: true },
    ),
    false,
  )
})

test('vidsrcme.ru is removed and parked domain-for-sale responses are rejected', () => {
  const serverCandidates = buildMovieEmbedCandidates({ type: 'movie', tmdbId: 550 })
  const clientCandidates = buildEmbedCandidates({ type: 'movie', tmdbId: 550 })

  assert.equal(serverCandidates.some((c: any) => c.url.includes('vidsrcme.ru')), false)
  assert.equal(clientCandidates.some((c: any) => c.url.includes('vidsrcme.ru')), false)
  assert.equal(isTrustedMovieEmbedUrl('https://vidsrcme.ru/embed/movie/550'), false)
  assert.equal(isClientTrustedEmbedUrl('https://vidsrcme.ru/embed/movie/550'), false)

  const parkedHtml = '<!DOCTYPE html><html><head><title>vidsrcme.ru</title></head><body><h1>This domain is for sale</h1><p>Buy this domain today.</p></body></html>'
  assert.equal(isValidEmbedResponse(200, parkedHtml), false)
  assert.equal(evaluateEmbedResponse(200, parkedHtml), false)
})

test('validateProxyUrl allows verified embed CDNs & subtitle hosts while blocking SSRF targets', () => {
  assert.equal(validateProxyUrl('https://pwcloud.animanga.fun/hls/abc').valid, true)
  assert.equal(validateProxyUrl('https://cache.vdrk.site/v3/movie/939243/English.vtt').valid, true)
  assert.equal(validateProxyUrl('https://m5f-cf.money-12.workers.dev/hls/token').valid, true)
  assert.equal(validateProxyUrl('https://patient-cherry.workerscloud32.workers.dev/hls2/master.m3u8').valid, true)
  assert.equal(validateProxyUrl('https://znomc6azq2dc.digitalmarketingaid.site/CvKkbMiosf/hls3/01/12218').valid, true)
  assert.equal(validateProxyUrl('https://paretocdn.site/hls2/02/00006/master.m3u8').valid, true)
  assert.equal(validateProxyUrl('https://ultramoss.top/vd/xyz/init-s480p-v1-a1.mp4').valid, true)

  assert.equal(validateProxyUrl('http://127.0.0.1:8080/secret').valid, false)
  assert.equal(validateProxyUrl('http://169.254.169.254/latest/meta-data/').valid, false)
  assert.equal(validateProxyUrl('http://localhost:3000/api/health').valid, false)
  assert.equal(validateProxyUrl('http://10.0.0.5/internal').valid, false)
})

test('Continue Watching automatically removes fully watched movies, completed series, and finished anime', async () => {
  const { isContinueCardDone } = await import('../src/lib/watchedLogic.ts')

  // Under threshold: must NOT be marked done (stays in continue watching)
  assert.equal(isContinueCardDone(1800, 7200, false), false)
  assert.equal(isContinueCardDone(100, 1000, false), false)

  // At or above 90% threshold (full watched): MUST be marked done (automatically removed from continue watching)
  assert.equal(isContinueCardDone(6500, 7200, false), true)
  assert.equal(isContinueCardDone(7200, 7200, false), true)
  assert.equal(isContinueCardDone(900, 1000, false), true)

  // Marked completed: MUST be marked done
  assert.equal(isContinueCardDone(0, 0, true), true)

  const fs = await import('node:fs')
  const continueRowSrc = fs.readFileSync('src/components/ContinueRow.tsx', 'utf8')
  const movieContinueRowSrc = fs.readFileSync('src/components/MovieContinueRow.tsx', 'utf8')
  const movieWatchPageSrc = fs.readFileSync('src/pages/MovieWatchPage.tsx', 'utf8')

  // ContinueRow filters out completed cards
  assert.match(continueRowSrc, /!isContinueCardDone\(/)

  // MovieContinueRow filters out completed movies/series
  assert.match(movieContinueRowSrc, /if\s*\(item\.isDone\)\s*continue/)

  // MovieWatchPage exclusively mounts CinePlayer (no iframe embed player)
  assert.equal(movieWatchPageSrc.includes('<iframe'), false)
  assert.match(movieWatchPageSrc, /servers=\{directServerList\}/)
  assert.match(movieWatchPageSrc, /key=\{`\$\{streamKey\}:\$\{activeSource\.providerId\}:/)
})

