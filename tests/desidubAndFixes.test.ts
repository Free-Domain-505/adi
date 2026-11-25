import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeB64Utf8,
  normalizeDesiTitle,
  extractSeasonNumber,
  buildSearchQueries,
  extractAnimeLinksFromSearch,
  scoreAnimeCandidate,
  parseAnimePageMeta,
  pickInlineWatchUrl,
  pickEpisodeFromAjax,
  extractEmbedEntriesFromHtml,
  unpackDeanEdwards,
  extractMediaFromEmbedHtml,
  computeHindiEpisodeCount,
} from '../server/desidubanime.js'
import { computeAudioBreakdown } from '../server/audioBreakdownLogic.js'
import {
  computeAvailableAudio,
  computeLocalAudioBreakdown,
  formatMultiEpisodeAudioSummary,
  getEpisodeAudioTier,
} from '../src/lib/audioLabels.ts'
import { armNavClickGuard, isNavClickGuarded, resetNavClickGuard } from '../src/lib/clickGuard.ts'
import { validateProxyUrl } from '../server/ssrf.js'
import { serverById } from '../src/lib/servers.ts'
import {
  cleanTitle,
  extractDirectStreamFromEpisodeHtml,
  extractSeasonAndEpisode,
  extractSeasonEpisodeKeysFromHtml,
  pickBestSeriesMatch,
} from '../server/watchanimeworld.js'
import { isBlockedPlayerHost } from '../server/audioAvailLogic.js'
import {
  dedupeHistoryEntries,
  finishHistoryEpisode,
  getHistoryEntry,
  historyEntryKey,
  mergeHistoryEntries,
  mergeRemoteHistoryEntries,
  removeHistoryEntry,
  upsertHistoryEpisode,
} from '../src/lib/historyLogic.ts'
import type { HistoryItem, Meta } from '../src/lib/library.ts'

describe('DesiDubAnime parser and extraction logic', () => {
  it('normalizes titles, extracts seasons, and builds distinct search queries', () => {
    assert.equal(normalizeDesiTitle('Solo Leveling Season 2: Arise from the Shadow'), 'solo leveling season 2 arise from the shadow')
    assert.equal(extractSeasonNumber('Naruto: Shippuden'), null)
    assert.equal(extractSeasonNumber('Solo Leveling 2nd Season'), 2)
    assert.equal(extractSeasonNumber('Demon Slayer Season 3'), 3)

    const qs = buildSearchQueries('Solo Leveling Season 2', 'Ore dake Level Up na Ken: Arise from the Shadow')
    assert.ok(qs.includes('Solo Leveling Season 2'))
    assert.ok(qs.some((q) => q.toLowerCase() === 'solo leveling'))
  })

  it('extracts and scores candidate anime URLs accurately across seasons and movies', () => {
    const html = `
      <a href="https://www.desidubanime.me/anime/solo-leveling-hindi-dub/" title="Solo Leveling">Solo Leveling</a>
      <a href="https://www.desidubanime.me/anime/solo-leveling-season-2/" title="Solo Leveling Season 2 Hindi Dub">Solo Leveling Season 2</a>
      <a href="https://www.desidubanime.me/anime/jujutsu-kaisen-0/" title="Jujutsu Kaisen 0 Movie">Jujutsu Kaisen 0</a>
    `
    const links = extractAnimeLinksFromSearch(html)
    assert.equal(links.length, 3)

    const s2Score = scoreAnimeCandidate(links[1], ['Solo Leveling Season 2', 'Solo Leveling'], { isMovie: false })
    const s1Score = scoreAnimeCandidate(links[0], ['Solo Leveling Season 2', 'Solo Leveling'], { isMovie: false })
    assert.ok(s2Score > s1Score, `Expected S2 score (${s2Score}) > S1 score (${s1Score})`)

    const movieScore = scoreAnimeCandidate(links[2], ['Jujutsu Kaisen 0'], { isMovie: true })
    assert.ok(movieScore > 50)
  })

  it('parses postId, seasons tabs, and watch links from anime detail HTML', () => {
    const html = `
      <body class="postid-59">
      <div class="season-tabs">
        <button data-season="1" data-post="564">Season 1</button>
        <button data-season="2" data-post="1268">Season 2</button>
      </div>
      <a href="https://www.desidubanime.me/watch/solo-leveling-season-2-episode-13/">Ep 13</a>
      <a href="https://www.desidubanime.me/watch/jujutsu-kaisen-0-movie/">Watch Movie</a>
    `
    const meta = parseAnimePageMeta(html)
    assert.equal(meta.postId, '59')
    assert.equal(meta.seasons.length, 2)
    assert.equal(
      pickInlineWatchUrl(meta.watchLinks, 13, false),
      'https://www.desidubanime.me/watch/solo-leveling-season-2-episode-13/',
    )
    assert.equal(
      pickInlineWatchUrl(meta.watchLinks, 1, true),
      'https://www.desidubanime.me/watch/jujutsu-kaisen-0-movie/',
    )
  })

  it('handles AJAX episode selection including continuous season numbering (e.g. eps 13..25 for S2 ep 1)', () => {
    const eps = [
      { id: 101, number: 13, url: 'https://www.desidubanime.me/watch/solo-leveling-season-2-episode-13/' },
      { id: 102, number: 14, url: 'https://www.desidubanime.me/watch/solo-leveling-season-2-episode-14/' },
    ]
    assert.equal(pickEpisodeFromAjax(eps, 1, false), 'https://www.desidubanime.me/watch/solo-leveling-season-2-episode-13/')
    assert.equal(pickEpisodeFromAjax(eps, 2, false), 'https://www.desidubanime.me/watch/solo-leveling-season-2-episode-14/')
    assert.equal(pickEpisodeFromAjax(eps, 14, false), 'https://www.desidubanime.me/watch/solo-leveling-season-2-episode-14/')
    assert.equal(pickEpisodeFromAjax(eps, 99, false), null)

    const metaEps = [
      { id: 92, number: 'Episode 1', meta_number: '1', url: 'https://www.desidubanime.me/watch/ore-dake-level-up-na-ken-season-2-episode-13/' },
    ]
    assert.equal(pickEpisodeFromAjax(metaEps, 1, false), 'https://www.desidubanime.me/watch/ore-dake-level-up-na-ken-season-2-episode-13/')
  })

  it('decodes base64 player-dub embeds (including IFRAME-wrapped payloads), filters blocked third-party players, and prioritizes direct HLS hosts', () => {
    const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')
    const idAbyss = `${b64('HydraX')}:${b64('https://abyssplayer.net/e/abc')}`
    const idEvids = `${b64('EVids')}:${b64('https://morencius.com/v/evids1')}`
    const idRuby = `${b64('SRuby')}:${b64('https://nuvorel.top/e/xyz123')}`
    const idRubyIframe = `${b64('Rubydub')}:${b64("<div style='height:0;'><IFRAME SRC='https://rubyvidhub.com/embed-swyfua2yxod0.html'></IFRAME></div>")}`
    const idSubOnly = `${b64('SRuby Sub')}:${b64('https://nuvorel.top/e/subonly')}`

    const html = `
      <div class="player-selection player-dub">
        <div class="inner-wrap">
          <button data-embed-id="${idAbyss}">HydraX</button>
          <button data-embed-id="${idEvids}">EVids</button>
          <button data-embed-id="${idRuby}">SRuby</button>
          <button data-embed-id="${idRubyIframe}">Rubydub</button>
        </div>
      </div>
      <div class="player-selection player-sub">
        <button data-embed-id="${idSubOnly}">SRuby Sub</button>
      </div>
    `
    assert.equal(decodeB64Utf8(b64('https://nuvorel.top/e/xyz123')), 'https://nuvorel.top/e/xyz123')
    const entries = extractEmbedEntriesFromHtml(html)
    assert.equal(entries.length, 3)
    assert.equal(entries[0].provider, 'sruby')
    assert.equal(entries[0].url, 'https://nuvorel.top/e/xyz123')
    assert.equal(entries[1].provider, 'sruby')
    assert.equal(entries[1].url, 'https://rubyvidhub.com/embed-swyfua2yxod0.html')
    assert.equal(entries[2].provider, 'evids')
    assert.equal(entries[2].url, 'https://morencius.com/v/evids1')
    assert.ok(!entries.some((e) => e.url.includes('abyssplayer')), 'Blocked iframe host must never be returned')
    assert.ok(!entries.some((e) => e.url.includes('subonly')), 'Should stay scoped to player-dub container')
  })

  it('unpacks Dean Edwards p,a,c,k,e,d scripts and extracts verified m3u8 + vtt tracks', () => {
    const packed =
      "eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+c.toString(a)+'\\\\b','g'),k[c]);return p}('0.1({2:[{3:\"4://5.6/7/8.9\"}],a:[{3:\"4://5.6/7/b.c\",d:\"e\"}]});',15,15,'jwplayer|setup|sources|file|https|cdn|example|video|master|m3u8|tracks|eng|vtt|label|English'.split('|')))"
    const unpacked = unpackDeanEdwards(packed)
    assert.ok(unpacked?.includes('https://cdn.example/video/master.m3u8'))

    const media = extractMediaFromEmbedHtml('https://morencius.com/v/abc', `<script>${packed}</script>`)
    assert.equal(media.streamUrl, 'https://cdn.example/video/master.m3u8')
    assert.equal(media.subtitles.length, 1)
    assert.equal(media.subtitles[0].file, 'https://cdn.example/video/eng.vtt')
    assert.equal(media.subtitles[0].label, 'English')
  })

  it('allows stream ruby / evids / desidubanime domains and blocks private SSRF targets', () => {
    for (const host of [
      'https://www.desidubanime.me/x',
      'https://nuvorel.top/m.m3u8',
      'https://rubyvidhub.com/embed-test.html',
      'https://gate-2-an-p.vmnow.online/hls2/master.m3u8',
      'https://morencius.com/m.m3u8',
      'https://dramiyos-cdn.com/m.m3u8',
    ]) {
      assert.equal(validateProxyUrl(host).valid, true, `Expected ${host} allowed`)
    }
    assert.equal(validateProxyUrl('http://127.0.0.1:8080/secret').valid, false)
    assert.equal(validateProxyUrl('http://169.254.169.254/latest').valid, false)
  })
})

describe('Hindi-only DesiDubAnime labeling and Multi-Dub guard', () => {
  it('registers DesiDubAnime as Hindi Dub only (multi: false) without Multi-Dub flag', () => {
    const def = serverById('desidubanime')
    assert.ok(def)
    assert.equal(def.id, 'desidubanime')
    assert.equal(def.multi, false)
    assert.equal(def.kind, 'direct')
  })

  it('computeAvailableAudio and computeLocalAudioBreakdown NEVER classify single-language Hindi Dub as Multi-Dub', () => {
    const avail = computeAvailableAudio(
      {
        desidubanime: { sub: false, dub: true, languages: ['Hindi'] },
      },
      'JP',
    )
    assert.equal(avail.originalVerified, false)
    assert.equal(avail.hasDub, true)
    assert.equal(avail.hasMulti, false)
    assert.deepEqual(avail.dubs.map((d) => d.name), ['Hindi'])

    const breakdown = computeLocalAudioBreakdown(12, avail)
    assert.equal(breakdown.hasMultiDub, false)
    assert.equal(breakdown.dubCount, 12)
    assert.match(breakdown.insight, /Hindi Dub/i)
    assert.doesNotMatch(breakdown.insight, /Multi-Dub/i)
    assert.match(breakdown.labels.dualAudio, /Hindi Dub/)
  })

  it('treats ACDN Hindi+English multi-track streams as Multi-Dub while keeping single Hindi track separate', () => {
    const multi = computeAvailableAudio(
      {
        acdn: { sub: true, dub: true, multi: true, languages: ['Hindi', 'English', 'Japanese'] },
      },
      'JP',
    )
    assert.equal(multi.hasMulti, true)
    assert.equal(multi.hasDub, true)
    assert.equal(multi.originalVerified, true)
  })
})

describe('Hindi Dub episode count & Details summary formatting', () => {
  it('computes Hindi episode counts across single-page, multi-page AJAX pagination, and capped series', () => {
    const p1 = Array.from({ length: 12 }, (_, i) => ({ number: i + 1 }))
    const pLast = Array.from({ length: 4 }, (_, i) => ({ number: 25 + i }))

    assert.equal(
      computeHindiEpisodeCount({ page1Episodes: p1, maxPages: 3, lastPageEpisodes: pLast, totalEpisodes: 50 }),
      28,
    )
    assert.equal(
      computeHindiEpisodeCount({ page1Episodes: p1, maxPages: 1, totalEpisodes: 12 }),
      12,
    )
    assert.equal(
      computeHindiEpisodeCount({ page1Episodes: p1, maxPages: 2, lastPageEpisodes: p1, totalEpisodes: 13 }),
      13,
    )
    assert.equal(
      computeHindiEpisodeCount({ inlineWatchLinks: ['https://example/w/1', 'https://example/w/2'], totalEpisodes: 12 }),
      2,
    )
    assert.equal(
      computeHindiEpisodeCount({ inlineWatchLinks: ['https://example/w/movie'], isMovie: true, totalEpisodes: 1 }),
      1,
    )
  })

  it('computes server and client Hindi Dub breakdown and summary with episode counts and zero provider name', () => {
    const serverBreakdown = computeAudioBreakdown({
      totalEpisodes: 500,
      hasEnglishDub: true,
      dubEpisodes: 500,
      hasHindiDub: true,
      hindiDubEpisodes: 396,
      countryOfOrigin: 'JP',
    })
    assert.equal(serverBreakdown.hasHindiDub, true)
    assert.equal(serverBreakdown.hindiDubCount, 396)
    assert.equal(serverBreakdown.hindiDubPercentage, 79)
    assert.match(serverBreakdown.insight, /Hindi Dub/i)
    assert.doesNotMatch(JSON.stringify(serverBreakdown), /desidub/i)

    const summaryStr = formatMultiEpisodeAudioSummary(serverBreakdown, 'Japanese (Original)')
    assert.match(summaryStr, /Original Japanese \(500\/500 eps\)/)
    assert.match(summaryStr, /English Dub \(500\/500 eps\)/)
    assert.match(summaryStr, /Hindi Dub \(396\/500 eps\)/)
    assert.doesNotMatch(summaryStr, /desidub/i)

    // Hindi-only episodes (without English dub)
    const hindiOnlyAvail = computeAvailableAudio(
      {
        megaplay: { sub: true, dub: false },
        desidubanime: { sub: false, dub: true, languages: ['Hindi'], episodeCount: 10 },
      },
      'JP',
    )
    const hindiTrack = hindiOnlyAvail.dubs.find((d) => d.name === 'Hindi')
    assert.equal(hindiTrack?.label, 'Hindi Dub')
    assert.equal(hindiTrack?.episodeCount, 10)
    assert.match(hindiOnlyAvail.summaryLine, /Hindi Dub \(10 eps\)/)

    const localHindiBreakdown = computeLocalAudioBreakdown(24, hindiOnlyAvail)
    assert.equal(localHindiBreakdown.hasHindiDub, true)
    assert.equal(localHindiBreakdown.hindiDubCount, 10)
    assert.equal(getEpisodeAudioTier(5, { ...serverBreakdown, dubCount: 0, multiDubCount: 0 }), 'hindi')
  })

  it('arms and enforces temporary navigation click guard cleanly', async () => {
    resetNavClickGuard()
    assert.equal(isNavClickGuarded(), false)
    armNavClickGuard(80)
    assert.equal(isNavClickGuarded(), true)
    await new Promise((r) => setTimeout(r, 110))
    assert.equal(isNavClickGuarded(), false)
  })
})

describe('WatchAnimeWorld, Zephyrix/Nekomux proxy & Multi-Dub/Hindi alignment', () => {
  it('allows Zephyrix / zn-grid disguised segments and Nekomux streams in SSRF validator', () => {
    for (const url of [
      'https://play.zephyrix.org/hls/abc123',
      'https://play.zephyrix.org/cdn/hls/xyz/master.m3u8',
      'https://s11.zn-grid01.top/f/seg001.js',
      'https://s02.zn-grid03.top/f/seg002.css',
      'https://player.nekomux.com/episode/16333',
      'https://play.nekomux.com/hls/master.m3u8',
    ]) {
      assert.equal(validateProxyUrl(url).valid, true, `Expected ${url} allowed`)
    }
    assert.equal(validateProxyUrl('http://127.0.0.1:8080/hls/master').valid, false)
    assert.equal(validateProxyUrl('http://169.254.169.254/latest/meta-data').valid, false)
  })

  it('normalizes diacritics, parses multi-season NxM slugs, and rejects false-positive spinoff matches', () => {
    assert.equal(cleanTitle('Pokémon'), 'pokemon')
    assert.equal(cleanTitle('Pokémon Horizons: The Series'), 'pokemon horizons the series')

    assert.deepEqual(
      extractSeasonAndEpisode('https://watchanimeworld.one/episode/pokemon-the-series-the-beginning-2x1/'),
      { seasonNum: 2, epNum: 1 },
    )
    assert.deepEqual(
      extractSeasonAndEpisode('https://watchanimeworld.one/episode/pokemon-the-series-the-beginning-1x12/'),
      { seasonNum: 1, epNum: 12 },
    )

    const spinoffMatch = pickBestSeriesMatch(
      [{ url: 'https://watchanimeworld.one/series/pokemon-concierge/', slug: 'pokemon-concierge', title: 'Pokémon Concierge', isMovie: false }],
      { title: 'Pokémon', romajiTitle: 'Pocket Monsters', isMovie: false },
    )
    assert.equal(spinoffMatch, null)

    const horizonsMatch = pickBestSeriesMatch(
      [
        { url: 'https://watchanimeworld.one/series/pokemon-concierge/', slug: 'pokemon-concierge', title: 'Pokémon Concierge', isMovie: false },
        { url: 'https://watchanimeworld.one/series/pokemon-horizons-the-series/', slug: 'pokemon-horizons-the-series', title: 'Pokémon Horizons: The Series', isMovie: false },
      ],
      { title: 'Pokémon Horizons: The Series', romajiTitle: 'Pocket Monsters (2023)', isMovie: false },
    )
    assert.equal(horizonsMatch?.slug, 'pokemon-horizons-the-series')
  })

  it('aligns Hindi Dub episode counts to be at least Multi-Dub episode count when Multi-Dub includes Hindi', () => {
    const breakdown = computeAudioBreakdown({
      totalEpisodes: 24,
      hasMultiDub: true,
      multiDubEpisodes: 24,
      hasEnglishDub: true,
      dubEpisodes: 24,
      hasHindiDub: true,
      hindiDubEpisodes: 12,
      countryOfOrigin: 'JP',
    })
    assert.equal(breakdown.multiDubCount, 24)
    assert.equal(breakdown.hindiDubCount, 24)
    assert.equal(breakdown.hasHindiDub, true)

    const avail = computeAvailableAudio(
      {
        desidubanime: { sub: false, dub: true, languages: ['Hindi'], episodeCount: 12 },
        watchanimeworld: { sub: true, dub: true, multi: true, languages: ['Hindi', 'Tamil', 'Telugu', 'English', 'Japanese'], episodeCount: 24 },
      },
      'JP',
    )
    const hindiTrack = avail.dubs.find((d) => d.name === 'Hindi')
    assert.equal(hindiTrack?.episodeCount, 24)
    assert.match(avail.summaryLine, /Hindi Dub \(24 eps\)/)

    const local = computeLocalAudioBreakdown(24, avail)
    assert.equal(local.multiDubCount, 24)
    assert.equal(local.hindiDubCount, 24)
  })

  it('separates Pokemon 4Ever/Heroes mappings, parses real HLS audio tracks, and computes One Piece multi-episode breakdown cleanly', async () => {
    const { ANIME_MAPPING, pickMapping } = await import('../server/mapping.js')
    assert.equal(pickMapping(ANIME_MAPPING, 1119, 1, true)?.saltId, 'pokemon-4ever')
    assert.equal(pickMapping(ANIME_MAPPING, 1120, 1, true)?.saltId, 'pokemon-heroes')

    const { parseHlsAudioLanguages } = await import('../server/audioAvailLogic.js')
    const sampleM3u8 = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Japanese",LANGUAGE="ja",DEFAULT=YES,URI="ja.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",URI="en.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Hindi",LANGUAGE="hi",URI="hi.m3u8"',
    ].join('\n')
    assert.deepEqual(parseHlsAudioLanguages(sampleM3u8), ['Japanese', 'English', 'Hindi'])

    const opBreakdown = computeAudioBreakdown({
      totalEpisodes: 1180,
      hasMultiDub: true,
      multiDubEpisodes: 123,
      hasEnglishDub: true,
      dubEpisodes: 1159,
      hasHindiDub: true,
      hindiDubEpisodes: 212,
      countryOfOrigin: 'JP',
    })
    assert.equal(opBreakdown.totalEpisodes, 1180)
    assert.equal(opBreakdown.multiDubCount, 123)
    assert.equal(opBreakdown.hindiDubCount, 212)
    assert.equal(opBreakdown.dubCount, 1159)
    assert.equal(opBreakdown.subOnlyCount, 21)
  })

  it('rejects iframe wrapper URLs (player1.php / short.icu / abyss) and strictly scopes WatchAnimeWorld episodes to the target season', () => {
    const iframeWrapperHtml = `
      <div class="player">
        <iframe src="https://watchanimeworld.top/api/player1.php?data=aHR0cHM6Ly9zaG9ydC5pY3UvYWJj"></iframe>
        <a href="https://short.icu/xyz">Mirror</a>
      </div>
    `
    assert.equal(extractDirectStreamFromEpisodeHtml(iframeWrapperHtml), null)
    assert.equal(isBlockedPlayerHost('https://watchanimeworld.top/api/player1.php?data=abc'), true)
    assert.equal(isBlockedPlayerHost('https://short.icu/xyz'), true)

    const zephyrixHtml = `<iframe src="https://play.zephyrix.org/video/abcDEF123"></iframe>`
    assert.deepEqual(extractDirectStreamFromEpisodeHtml(zephyrixHtml), {
      kind: 'zephyrix',
      hash: 'abcDEF123',
      streamUrl: null,
      referer: 'https://play.zephyrix.org/',
    })

    const multiSeasonHtml = `
      <a href="https://watchanimeworld.one/episode/jujutsu-kaisen-1x1/">Ep 1</a>
      <a href="https://watchanimeworld.one/episode/jujutsu-kaisen-1x2/">Ep 2</a>
      <a href="https://watchanimeworld.one/episode/jujutsu-kaisen-1x24/">Ep 24</a>
      <a href="https://watchanimeworld.one/episode/jujutsu-kaisen-2x1/">S2 Ep 1</a>
      <a href="https://watchanimeworld.one/episode/jujutsu-kaisen-2x2/">S2 Ep 2</a>
    `
    const s1Keys = extractSeasonEpisodeKeysFromHtml(multiSeasonHtml, 1)
    assert.equal(s1Keys.size, 3)
    assert.equal(s1Keys.has('1x1'), true)
    assert.equal(s1Keys.has('2x1'), false)

    const s2Keys = extractSeasonEpisodeKeysFromHtml(multiSeasonHtml, 2)
    assert.equal(s2Keys.size, 2)
    assert.equal(s2Keys.has('2x1'), true)
    assert.equal(s2Keys.has('1x1'), false)

    const pickedS1 = pickBestSeriesMatch(
      [
        { url: 'https://watchanimeworld.one/series/solo-leveling-season-2/', slug: 'solo-leveling-season-2', title: 'Solo Leveling Season 2', isMovie: false },
        { url: 'https://watchanimeworld.one/series/solo-leveling/', slug: 'solo-leveling', title: 'Solo Leveling', isMovie: false },
      ],
      { title: 'Solo Leveling', romajiTitle: 'Ore dake Level Up na Ken', isMovie: false, season: 1 },
    )
    assert.equal(pickedS1?.slug, 'solo-leveling')
  })

  it('keeps subOnlyCount at 0 when Hindi or Multi-Dub covers all episodes and surfaces originalLanguage in summary', async () => {
    const hindiFull = computeAudioBreakdown({
      totalEpisodes: 13,
      hasMultiDub: false,
      multiDubEpisodes: 0,
      hasEnglishDub: false,
      dubEpisodes: 0,
      hasHindiDub: true,
      hindiDubEpisodes: 13,
      countryOfOrigin: 'JP',
    })
    assert.equal(hindiFull.subOnlyCount, 0)
    assert.equal(hindiFull.hasSubOnly, false)
    const summaryHindiOnly = formatMultiEpisodeAudioSummary(hindiFull, 'Japanese (Original)')
    assert.match(summaryHindiOnly, /Hindi Dub \(13\/13 eps\)/)
    assert.match(summaryHindiOnly, /Japanese \(13\/13 eps\)/)

    const { episodeCounts, tmdbSeason } = await import('../src/lib/episodeCountsLogic.ts')
    assert.deepEqual(
      episodeCounts({ format: 'TV', status: 'FINISHED', episodes: 13, nextAiringEpisode: null }),
      { total: 13, available: 13 },
    )
    assert.equal(
      tmdbSeason({ id: 65930, type: 'tv', season: null } as any, { title: { english: 'My Hero Academia Season 2', romaji: 'Boku no Hero Academia 2nd Season' } }),
      2,
    )
  })

  it('detects English dub on Chinese (CN) titles when FlixCloud Native+English HLS or verified MegaPlay dub exists, without mislabeling Native as Japanese', async () => {
    const { parseHlsAudioLanguages } = await import('../server/audioAvailLogic.js')
    const flxDonghuaM3u8 = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="jpn",NAME="Native",DEFAULT=YES,AUTOSELECT=YES,URI="native.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="eng",NAME="English",DEFAULT=NO,AUTOSELECT=YES,URI="english.m3u8"',
    ].join('\n')
    assert.deepEqual(parseHlsAudioLanguages(flxDonghuaM3u8, 'CN'), ['Chinese', 'English'])

    const flxDonghuaSubOnly = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="jpn",NAME="Native",DEFAULT=YES,AUTOSELECT=YES,URI="native.m3u8"',
    ].join('\n')
    assert.deepEqual(parseHlsAudioLanguages(flxDonghuaSubOnly, 'CN'), ['Chinese'])

    const movieWithFlxDub = computeAvailableAudio(
      {
        megaplay: { sub: false, dub: false },
        vidstream: { sub: false, dub: false },
        flixcloud: { sub: true, dub: true, dubVerified: true, languages: ['Chinese', 'English'] },
      },
      'CN',
      false,
    )
    assert.equal(movieWithFlxDub.hasDub, true)
    assert.equal(movieWithFlxDub.originalVerified, true)
    assert.equal(movieWithFlxDub.dubs.some((d) => d.name === 'English'), true)
    assert.match(movieWithFlxDub.summaryLine, /Chinese \(Original\).*English Dub/)

    const donghuaWithVerifiedMp = computeAvailableAudio(
      {
        megaplay: { sub: true, dub: true, dubVerified: true },
        vidstream: { sub: true, dub: true, dubVerified: true },
        flixcloud: { sub: true, dub: false, languages: ['Chinese'] },
      },
      'CN',
      false,
    )
    assert.equal(donghuaWithVerifiedMp.hasDub, true)
    assert.equal(donghuaWithVerifiedMp.dubs.some((d) => d.name === 'English'), true)

    const donghuaSubOnly = computeAvailableAudio(
      {
        megaplay: { sub: false, dub: false },
        flixcloud: { sub: true, dub: false, languages: ['Chinese'] },
      },
      'CN',
      false,
    )
    assert.equal(donghuaSubOnly.hasDub, false)
    assert.equal(donghuaSubOnly.summaryLine, 'Chinese (Original)')
  })

  it('uses Chinese/Korean original language labels in episode tiers and breakdown rather than hardcoded Japanese', async () => {
    const { getOriginalLanguageForCountry } = await import('../server/audioAvailLogic.js')
    assert.equal(getOriginalLanguageForCountry('CN'), 'Chinese')
    assert.equal(getOriginalLanguageForCountry('TW'), 'Chinese')
    assert.equal(getOriginalLanguageForCountry('HK'), 'Chinese')
    assert.equal(getOriginalLanguageForCountry('KR'), 'Korean')
    assert.equal(getOriginalLanguageForCountry('JP'), 'Japanese')

    const cnSubOnlyAvail = computeAvailableAudio(
      {
        megaplay: { sub: false, dub: false },
        flixcloud: { sub: true, dub: false, languages: ['Chinese'] },
      },
      'CN',
      false,
    )
    const cnSubBreakdown = computeLocalAudioBreakdown(2, cnSubOnlyAvail)
    assert.equal(cnSubBreakdown.originalLanguage, 'Chinese')
    assert.equal(cnSubBreakdown.subOnlyCount, 2)
    assert.equal(cnSubBreakdown.labels.subOnly, 'Only Chinese (Original)')
    assert.equal(getEpisodeAudioTier(1, cnSubBreakdown), 'sub')

    const krDualAvail = computeAvailableAudio(
      {
        megaplay: { sub: true, dub: true, dubVerified: true },
        flixcloud: { sub: true, dub: true, dubVerified: true, languages: ['Korean', 'English'] },
      },
      'KR',
      false,
    )
    const krDualBreakdown = computeLocalAudioBreakdown(12, krDualAvail)
    assert.equal(krDualBreakdown.originalLanguage, 'Korean')
    assert.equal(getEpisodeAudioTier(1, krDualBreakdown), 'dual')
    assert.match(formatMultiEpisodeAudioSummary(krDualBreakdown, 'Korean (Original)'), /Original Korean \(12\/12 eps\)/)
    assert.match(formatMultiEpisodeAudioSummary(krDualBreakdown, 'Korean (Original)'), /English Dub \(12\/12 eps\)/)
  })

  it('verifies MobileDock restores Browse navigation and MobileHeader includes Community lounge', async () => {
    const fs = await import('node:fs')
    const mobileDockCode = fs.readFileSync('src/components/MobileDock.tsx', 'utf8')
    assert.match(mobileDockCode, /label:\s*['"]Browse['"]/)
    assert.match(mobileDockCode, /to:\s*['"]\/browse['"]/)
    assert.match(mobileDockCode, /icon:\s*Compass/)
    assert.ok(!mobileDockCode.includes('/community'))

    const mobileHeaderCode = fs.readFileSync('src/components/MobileHeader.tsx', 'utf8')
    assert.match(mobileHeaderCode, /to=['"]\/community['"]/)
    assert.match(mobileHeaderCode, /<Users/)
    assert.ok(!mobileHeaderCode.includes('ThemeToggle'))
  })

  it('verifies HeroCarousel removes trailer button and isolates slide state against rapid navigation glitches', async () => {
    const fs = await import('node:fs')
    const heroCode = fs.readFileSync('src/components/HeroCarousel.tsx', 'utf8')
    // Trailer button removed
    assert.ok(!heroCode.includes('Watch trailer'))
    assert.ok(!heroCode.includes('TrailerModal'))
    assert.ok(!heroCode.includes('item.trailer'))

    // Rapid slide glitch prevention: Heading is keyed with item.id and image has key={src}
    assert.match(heroCode, /<Heading key=\{item\.id\}/)
    assert.match(heroCode, /key=\{src!\}/)
    assert.match(heroCode, /key=\{title\}/)

    // Deduplication applied to carousel items
    assert.match(heroCode, /const carouselItems = useMemo/)

    // Entering and exiting slides occupy the same grid cell so previous slides never jump upward
    assert.match(heroCode, /className="grid w-full min-w-0 items-end"/)
    assert.match(heroCode, /col-start-1 row-start-1/)

    const movieHeroCode = fs.readFileSync('src/components/MovieHero.tsx', 'utf8')
    assert.match(movieHeroCode, /col-start-1 row-start-1/)
    assert.ok(!movieHeroCode.includes('y: -8'))
  })

  it('preserves multiple episodes of the same anime/donghua in Continue Watching, sync merge, and AniList pull', async () => {
    const animeMeta: Meta = {
      id: 101922,
      title: 'Battle Through the Heavens',
      image: 'https://example.com/btth.jpg',
      color: null,
      score: 85,
      format: 'TV',
      episodes: 52,
      year: 2024,
      startDate: { year: 2024, month: 1, day: 1 },
    }

    let list: HistoryItem[] = []
    // Watch Ep 1 halfway
    list = upsertHistoryEpisode(list, animeMeta, { ep: 1, server: 'flixcloud', audio: 'sub', pos: 420, dur: 1200, epTitle: 'Episode 1' }, 1000).list
    // Switch to Ep 2 and watch partially
    list = upsertHistoryEpisode(list, animeMeta, { ep: 2, server: 'flixcloud', audio: 'sub', pos: 180, dur: 1200, epTitle: 'Episode 2' }, 2000).list
    // Switch to Ep 3
    list = upsertHistoryEpisode(list, animeMeta, { ep: 3, server: 'flixcloud', audio: 'sub', pos: 60, dur: 1200, epTitle: 'Episode 3' }, 3000).list

    assert.equal(list.length, 3)
    assert.deepEqual(
      list.map((h) => h.ep),
      [3, 2, 1],
    )
    assert.equal(getHistoryEntry(list, 101922, 1)?.pos, 420)
    assert.equal(getHistoryEntry(list, 101922, 2)?.pos, 180)
    assert.equal(getHistoryEntry(list, 101922, 3)?.pos, 60)
    // Calling getHistoryEntry without ep returns the newest episode
    assert.equal(getHistoryEntry(list, 101922)?.ep, 3)

    // Remove only Ep 2 — Ep 3 and Ep 1 must remain
    list = removeHistoryEntry(list, 101922, 2)
    assert.deepEqual(
      list.map((h) => h.ep),
      [3, 1],
    )

    // Finish Ep 3 -> keeps Ep 3 (completed) AND queues Ep 4
    list = finishHistoryEpisode(list, animeMeta, 3, true, { server: 'flixcloud', audio: 'sub' }, 4000)
    assert.deepEqual(
      list.map((h) => h.ep),
      [4, 3, 1],
    )
    assert.equal(getHistoryEntry(list, 101922, 4)?.pos, 0)
    assert.equal(getHistoryEntry(list, 101922, 3)?.pos, 1200)

    // AniList pull (mergeRemoteHistoryEntries) does not wipe out existing episodes
    list = mergeRemoteHistoryEntries(list, [{ meta: animeMeta, status: 'watching', progress: 1, updated: 500 }], 'flixcloud', 'sub', 5000)
    assert.deepEqual(
      list.map((h) => h.ep),
      [4, 3, 1],
    )

    // Merge remote + local by (id, ep)
    const remoteSample: HistoryItem[] = [
      { ...animeMeta, ep: 5, server: 'flixcloud', audio: 'sub', pos: 90, dur: 1200, t: 6000 },
      { ...animeMeta, ep: 1, server: 'flixcloud', audio: 'sub', pos: 100, dur: 1200, t: 1 },
    ]
    const merged = mergeHistoryEntries(list, remoteSample)
    assert.deepEqual(
      merged.map((h) => h.ep),
      [5, 4, 3, 1],
    )
    // Local newer pos for ep 1 wins over older remote timestamp
    assert.equal(merged.find((h) => h.ep === 1)?.pos, 420)
    assert.equal(dedupeHistoryEntries([...merged, ...remoteSample]).length, 4)
    assert.equal(historyEntryKey(101922, 5), '101922:5')

    // ContinueRow keys cards by id:ep and removes only clicked episode
    const fs = await import('node:fs')
    const continueRowCode = fs.readFileSync('src/components/ContinueRow.tsx', 'utf8')
    assert.match(continueRowCode, /key=\{`\$\{h\.id\}:\$\{h\.ep\}`\}/)
    assert.match(continueRowCode, /removeHistory\(h\.id, h\.ep\)/)
  })

  it('confirms Monetag ads and scripts are completely removed per user request', async () => {
    const fs = await import('node:fs')
    const { MONETAG_ZONE_ID, MONETAG_SCRIPT_SRC, installMonetagOnClick } = await import('../src/lib/monetag.ts')
    assert.equal(MONETAG_ZONE_ID, '')
    assert.equal(MONETAG_SCRIPT_SRC, '')
    assert.deepEqual(installMonetagOnClick(), { status: 'excluded' })

    const indexHtml = fs.readFileSync('index.html', 'utf8')
    assert.equal(indexHtml.includes('monetag'), false)
    assert.equal(indexHtml.includes('al5sm.com'), false)
  })
})



