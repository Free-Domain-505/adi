import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBlakiteApiUrl,
  buildBlakiteStreamCandidates,
  buildTooniboyQueries,
  cleanTooniboyTitle,
  extractRubyMediaFromHtml,
  extractTooniboyEmbedTabs,
  extractTooniboyEpisodes,
  extractTooniboyGenresLanguages,
  extractTooniboySeasons,
  parseTooniboySearchHtml,
  pickBestTooniboyMatch,
  rewriteRubyEmbedUrl,
} from '../server/tooniboy.js';
import { validateProxyUrl } from '../server/ssrf.js';
import { computeServerCategoryAvailability } from '../src/lib/servers.ts';

test('parseTooniboySearchHtml scopes to #aa-movies results and ignores sidebar links', () => {
  const sampleHtml = `
    <main class="main-site">
      <div class="aa-cn" id="aa-movies">
        <ul class="post-lst">
          <li>
            <article class="post">
              <header class="entry-header"><h2 class="entry-title">Lord of Mysteries</h2></header>
              <a href="/series/lord-of-mysteries" class="lnk-blk"></a>
            </article>
          </li>
          <li>
            <article class="post">
              <header class="entry-header"><h2 class="entry-title">Jujutsu Kaisen 0</h2></header>
              <a href="/movies/jujutsu-kaisen-0" class="lnk-blk"></a>
            </article>
          </li>
        </ul>
      </div>
    </main>
    <aside class="sidebar">
      <article class="post"><h2 class="entry-title">One Piece Live Action</h2><a href="/series/one-piece-live-action"></a></article>
    </aside>
  `;

  const parsed = parseTooniboySearchHtml(sampleHtml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].slug, 'lord-of-mysteries');
  assert.equal(parsed[0].isMovie, false);
  assert.equal(parsed[1].slug, 'jujutsu-kaisen-0');
  assert.equal(parsed[1].isMovie, true);
});

test('pickBestTooniboyMatch accurately matches donghua, TV series, movies, and rejects unofficial dubs', () => {
  const jjkCandidates = [
    { url: 'https://tooniboy.xyz/movies/jujutsu-kaisen-0/', slug: 'jujutsu-kaisen-0', title: 'Jujutsu Kaisen 0', isMovie: true },
    { url: 'https://tooniboy.xyz/series/jujutsu-kaisen-sony-yay-dub/', slug: 'jujutsu-kaisen-sony-yay-dub', title: 'Jujutsu Kaisen (Sony Yay Dub)', isMovie: false },
    { url: 'https://tooniboy.xyz/series/jujutsu-kaisen/', slug: 'jujutsu-kaisen', title: 'Jujutsu Kaisen', isMovie: false },
  ];

  assert.equal(
    pickBestTooniboyMatch(jjkCandidates, { title: 'JUJUTSU KAISEN', isMovie: false })?.slug,
    'jujutsu-kaisen',
  );
  assert.equal(
    pickBestTooniboyMatch(jjkCandidates, { title: 'JUJUTSU KAISEN 0', isMovie: true })?.slug,
    'jujutsu-kaisen-0',
  );

  const donghuaCandidates = [
    { url: 'https://tooniboy.xyz/series/to-be-hero-x/', slug: 'to-be-hero-x', title: 'To Be Hero X', isMovie: false },
    { url: 'https://tooniboy.xyz/series/lord-of-mysteries/', slug: 'lord-of-mysteries', title: 'Lord of Mysteries', isMovie: false },
  ];
  assert.equal(
    pickBestTooniboyMatch(donghuaCandidates, { title: 'To Be Hero X', romajiTitle: 'Tu Bian Yingxiong X', isMovie: false })?.slug,
    'to-be-hero-x',
  );
  assert.equal(
    pickBestTooniboyMatch(donghuaCandidates, { title: 'Lord of Mysteries', romajiTitle: 'Guimi Zhi Zhu', isMovie: false })?.slug,
    'lord-of-mysteries',
  );

  assert.equal(cleanTooniboyTitle('Jujutsu Kaisen (Hindi Dub)'), 'jujutsu kaisen');
  assert.ok(buildTooniboyQueries('Jujutsu Kaisen: Hidden Inventory', 'Jujutsu Kaisen 2nd Season').length >= 2);
});

test('extractTooniboyGenresLanguages ignores global nav and normalizes Japaneses typo', () => {
  const html = `
    <nav class="main-nav">
      <a href="/category/language/bengali/">Bengali</a>
      <a href="/category/language/malayalam/">Malayalam</a>
    </nav>
    <header class="entry-header">
      <h1 class="entry-title">To Be Hero X</h1>
      <div class="entry-meta">
        <span class="genres"><a href="/category/action/">Action</a>, <a href="/category/language/english/">English</a>, <a href="/category/language/hindi/">Hindi</a>, <a href="/category/language/japaneses/">Japaneses</a>, <a href="/category/language/tamil/">Tamil</a>, <a href="/category/language/telugu/">Telugu</a></span>
      </div>
    </header>
  `;
  assert.deepEqual(extractTooniboyGenresLanguages(html), ['English', 'Hindi', 'Japanese', 'Tamil', 'Telugu']);
});

test('extractTooniboySeasons and extractTooniboyEpisodes extract season tabs and episodes accurately', () => {
  const html = `
    <button class="season-btn" data-season="2" data-url="/series/jujutsu-kaisen/season/2">Season 2</button>
    <button class="season-btn active" data-season="1" data-url="/series/jujutsu-kaisen/season/1">Season 1</button>
    <ul id="episode_by_temp">
      <li><span class="num-epi">2x1</span><a href="/episode/jujutsu-kaisen-2x1/" class="lnk-blk">Ep 1</a></li>
      <li><span class="num-epi">2x24</span><a href="/episode/jujutsu-kaisen-2x24/" class="lnk-blk">Ep 24</a></li>
    </ul>
  `;
  const seasons = extractTooniboySeasons(html);
  assert.equal(seasons.length, 2);
  assert.deepEqual(seasons.map((s) => s.seasonNum), [1, 2]);
  assert.equal(seasons[1].url, 'https://tooniboy.xyz/series/jujutsu-kaisen/season/2');

  const eps = extractTooniboyEpisodes(html);
  assert.equal(eps.length, 2);
  assert.deepEqual(eps[0], {
    seasonNum: 2,
    epNum: 1,
    url: 'https://tooniboy.xyz/episode/jujutsu-kaisen-2x1/',
    slug: 'jujutsu-kaisen-2x1',
  });
  assert.equal(eps[1].epNum, 24);
});

test('rewriteRubyEmbedUrl & extractRubyMediaFromHtml extract Multi-Audio HLS and skip sprite thumbnails', () => {
  assert.equal(rewriteRubyEmbedUrl('https://rubystm.com/e/yj83fts37ztu.html'), 'https://rubystm.com/embed-yj83fts37ztu.html');
  assert.equal(rewriteRubyEmbedUrl('https://rubystm.com/embed-yj83fts37ztu.html'), 'https://rubystm.com/embed-yj83fts37ztu.html');

  const embedHtml = `
    <script>
      jwplayer("vplayer").setup({
        sources: [{file:"https://ozovxg2t3b2c8m8g.streamruby.net/hls/abc/master.m3u8?t=123"}],
        tracks: [
          {file:"https://cdn.example.com/en.vtt", label:"English", kind:"captions", default:true},
          {file:"https://cdn.example.com/yj83fts37ztu_sli.vtt", kind:"thumbnails"}
        ]
      });
    </script>
  `;
  const media = extractRubyMediaFromHtml('https://rubystm.com/embed-yj83fts37ztu.html', embedHtml);
  assert.equal(media.streamUrl, 'https://ozovxg2t3b2c8m8g.streamruby.net/hls/abc/master.m3u8?t=123');
  assert.equal(media.subtitles.length, 1);
  assert.equal(media.subtitles[0].file, 'https://cdn.example.com/en.vtt');
  assert.equal(media.subtitles[0].default, true);
});

test('extractTooniboyEmbedTabs ignores trailers and orders Ruby/Play/MultiQ/Moly ahead of Watch/DL', () => {
  const html = `
    <ul class="aa-tbs aa-tbs-video">
      <li><a href="#options-0">Server 1 <span class="server">Watch/DL</span></a></li>
      <li><a href="#options-1">Server 2 <span class="server">MultiQ</span></a></li>
      <li><a href="#options-2">Server 3 <span class="server">Ruby</span></a></li>
      <li><a href="#options-3">Server 4 <span class="server">Play</span></a></li>
      <li><a href="#options-4">Server 5 <span class="server">Trailer</span></a></li>
    </ul>
    <div id="options-0"><iframe src="https://filesforever.link/embed/abc"></iframe></div>
    <div id="options-1"><iframe data-src="https://blakiteapi.xyz/embed/95479/1-1"></iframe></div>
    <div id="options-2"><iframe src="https://rubystm.com/e/yj83fts37ztu.html"></iframe></div>
    <div id="options-3"><iframe src="https://ravok.buzz/video/abcdef012345"></iframe></div>
    <div id="options-4"><iframe src="https://www.youtube.com/embed/xyz"></iframe></div>
  `;
  const tabs = extractTooniboyEmbedTabs(html);
  assert.deepEqual(tabs.map((t) => t.provider), ['ruby', 'play', 'multiq', 'watchdl']);
  assert.equal(tabs[0].url, 'https://rubystm.com/embed-yj83fts37ztu.html');
});

test('blakiteapi URL and candidate builders construct MP4 and M3U8 CDN URLs and SSRF permits all hosts', () => {
  assert.equal(
    buildBlakiteApiUrl('https://blakiteapi.xyz/embed/95479/1-1'),
    'https://blakiteapi.xyz/api/get.php?id=1-1&tmdbId=95479',
  );
  assert.equal(
    buildBlakiteApiUrl('https://blakiteapi.xyz/embed/810693'),
    'https://blakiteapi.xyz/api/get.php?tmdbId=810693',
  );

  const mp4s = buildBlakiteStreamCandidates({ dataId: 's8/2/T/i/q/i/Tiqit', qid: 4, format: 'MP4' });
  assert.equal(mp4s[0].url, 'https://hugh.cdn.rumble.cloud/video/s8/2/T/i/q/i/Tiqit.gaa.mp4');
  assert.equal(mp4s.length, 4);

  assert.equal(validateProxyUrl('https://ozovxg2t3b2c8m8g.streamruby.net/hls/a/master.m3u8').valid, true);
  assert.equal(validateProxyUrl('https://hugh.cdn.rumble.cloud/video/s8/2/T/i/q/i/Tiqit.gaa.mp4').valid, true);
  assert.equal(validateProxyUrl('https://prx-1546-ant.vmpx.online/hls2/01/master.m3u8').valid, true);

  // Server 12 (serverId: 'server12') unlocks MULTI AUDIO availability cleanly
  assert.equal(
    computeServerCategoryAvailability({
      animeLoaded: true,
      availLoading: false,
      availData: { sub: true, dub: true, hasMulti: true },
      playbackLoading: false,
      playbackResolved: true,
      hasSub: true,
      hasDub: true,
      streamSid: 'server12',
      currentSid: 'server12',
      activeSlotCategory: 'multi',
      trackCount: 5,
    }).multiAvailable,
    true,
  );
});
