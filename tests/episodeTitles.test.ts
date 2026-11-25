import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  anilistEpisodes,
  isGenericEpisodeTitle,
  mergeEpisodes,
  mergeEpisodeTitleFallbacks,
  normalizeAniListSeasonEpisodes,
  sanitizeEpisodeTitle,
} from '../src/lib/episodeCountsLogic'

test('isGenericEpisodeTitle and sanitizeEpisodeTitle reject placeholder "Episode N" strings and keep real titles', () => {
  assert.equal(isGenericEpisodeTitle('Episode 8', 8), true)
  assert.equal(isGenericEpisodeTitle('Episode 08', 8), true)
  assert.equal(isGenericEpisodeTitle('Ep. 12', 12), true)
  assert.equal(isGenericEpisodeTitle('E8', 8), true)
  assert.equal(isGenericEpisodeTitle('#8', 8), true)
  assert.equal(isGenericEpisodeTitle('第8話', 8), true)
  assert.equal(isGenericEpisodeTitle('TBA'), true)
  assert.equal(isGenericEpisodeTitle('Untitled'), true)
  assert.equal(sanitizeEpisodeTitle('  Episode 14  ', 14), null)
  assert.equal(sanitizeEpisodeTitle('  A Day in Satomi’s Life  ', 8), 'A Day in Satomi’s Life')
  assert.equal(sanitizeEpisodeTitle('Episode Zero', 1), 'Episode Zero')
})

test('anilistEpisodes parses varied formats and skips generic placeholders while preserving thumbnails', () => {
  const parsed = anilistEpisodes([
    { title: 'Episode 8 - A Day in Satomi’s Life', thumbnail: 'https://img/8.jpg' },
    { title: 'Episode 9 - Episode 9', thumbnail: 'https://img/9.jpg' },
    { title: '10. Rising Dawn', thumbnail: 'https://img/10.jpg' },
    { title: '#11 - Final Waltz', thumbnail: 'https://img/11.jpg' },
  ])

  assert.equal(parsed.length, 4)
  assert.equal(parsed[0].name, 'A Day in Satomi’s Life')
  assert.equal(parsed[1].name, null)
  assert.equal(parsed[1].image, 'https://img/9.jpg')
  assert.equal(parsed[2].n, 10)
  assert.equal(parsed[2].name, 'Rising Dawn')
  assert.equal(parsed[3].n, 11)
  assert.equal(parsed[3].name, 'Final Waltz')
})

test('normalizeAniListSeasonEpisodes preserves Season 2 1-based episodes and shifts continuous numbering', () => {
  const oneBased = normalizeAniListSeasonEpisodes(
    [
      { n: 1, name: 'S2 First', overview: null, image: null, runtime: null, air: null },
      { n: 8, name: 'S2 Eighth', overview: null, image: null, runtime: null, air: null },
    ],
    12,
  )
  assert.equal(oneBased.length, 2)
  assert.equal(oneBased[1].n, 8)

  const continuous = normalizeAniListSeasonEpisodes(
    [
      { n: 13, name: 'Part 2 Ep 1', overview: null, image: null, runtime: null, air: null },
      { n: 14, name: 'Part 2 Ep 2', overview: null, image: null, runtime: null, air: null },
    ],
    12,
  )
  assert.deepEqual(
    continuous.map((e) => ({ n: e.n, name: e.name })),
    [
      { n: 1, name: 'Part 2 Ep 1' },
      { n: 2, name: 'Part 2 Ep 2' },
    ],
  )
})

test('mergeEpisodes overrides TMDB generic "Episode N" placeholders with real AniList/fallback titles', () => {
  const tmdb = [
    { n: 7, name: 'Komaro’s Challenge', overview: 'Official summary', image: 'tmdb7.jpg', runtime: 24, air: '2026-11-15' },
    { n: 8, name: 'Episode 8', overview: null, image: 'tmdb8.jpg', runtime: 24, air: '2026-11-22' },
  ]
  const ani = [
    { n: 7, name: 'AniList Title 7', overview: null, image: 'ani7.jpg', runtime: null, air: null },
    { n: 8, name: 'A Day in Satomi’s Life', overview: null, image: 'ani8.jpg', runtime: null, air: null },
  ]

  const merged = mergeEpisodes(tmdb, ani)
  // Real TMDB title wins when present
  assert.equal(merged.get(7)?.name, 'Komaro’s Challenge')
  // Generic TMDB "Episode 8" does not block real AniList title
  assert.equal(merged.get(8)?.name, 'A Day in Satomi’s Life')
  assert.equal(merged.get(8)?.image, 'tmdb8.jpg')

  // Fallback titles (ani.zip / Jikan) populate newly aired episodes missing from TMDB
  const withFallback = mergeEpisodeTitleFallbacks(merged, {
    8: 'Should Not Overwrite Real Title',
    9: 'The Unbreakable Promise',
  })
  assert.equal(withFallback.get(8)?.name, 'A Day in Satomi’s Life')
  assert.equal(withFallback.get(9)?.name, 'The Unbreakable Promise')
})

test('server /api/episodes/titles and /api/tmdb/episodes sanitize placeholders and use short TTL for airing episodes', async () => {
  const { handle } = await import('../server/handler.js')
  const origFetch = globalThis.fetch

  try {
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.startsWith('https://api.ani.zip/mappings')) {
        return new Response(
          JSON.stringify({
            mappings: { mal_id: 999991 },
            episodes: {
              '8': { title: { en: 'Episode 8', 'x-jat': 'Atarashii Asa' } },
              '9': { title: { en: 'The Ninth Dawn' } },
            },
          }),
          { status: 200 },
        )
      }
      if (url.startsWith('https://api.jikan.moe/v4/anime/999991/episodes')) {
        return new Response(
          JSON.stringify({
            data: [
              { mal_id: 8, title: 'New Morning Light', title_romanji: 'Atarashii Asa' },
              { mal_id: 9, title: 'Episode 9' },
            ],
          }),
          { status: 200 },
        )
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    const res = await handle(
      new Request('https://animestream.cc.cd/api/episodes/titles?anilistId=999991&ep=9'),
      {},
    )
    assert.ok(res)
    assert.equal(res.status, 200)
    const body = (await res.json()) as { ok: boolean; titles: Record<string, string> }
    assert.equal(body.ok, true)
    assert.equal(body.titles['8'], 'New Morning Light')
    assert.equal(body.titles['9'], 'The Ninth Dawn')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('LatestEpisodesRow and SchedulePage use resolved episode titles when available', () => {
  const latestSrc = fs.readFileSync(path.resolve('src/components/LatestEpisodesRow.tsx'), 'utf8')
  const scheduleSrc = fs.readFileSync(path.resolve('src/pages/SchedulePage.tsx'), 'utf8')
  assert.match(latestSrc, /useEpisodesState/)
  assert.match(latestSrc, /sanitizeEpisodeTitle/)
  assert.match(scheduleSrc, /fetchFallbackEpisodeTitles/)
  assert.match(scheduleSrc, /sanitizeEpisodeTitle/)
})
