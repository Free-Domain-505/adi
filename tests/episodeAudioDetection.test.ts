import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVerifiedAudioReport } from '../server/episodeAudioDetector.js';
import {
  computeAudioCheckingState,
  computeAvailableAudio,
  reconcileBreakdownWithReport,
} from '../src/lib/audioLabels';

test('episodeAudioDetection: Donghua without dubs reports Chinese original and zero false dubs', () => {
  const report = computeVerifiedAudioReport({
    animeId: 101,
    totalEpisodes: 26,
    countryOfOrigin: 'CN',
    flixResult: { sub: true, dub: false, subEps: 26, dubEps: 0 },
    megaResult: { sub: true, dub: false },
    vidstreamResult: { sub: true, dub: false },
    desiResult: null,
    wawResult: null,
    tooniboyResult: null,
    acdnResult: null,
  });

  assert.equal(report.isDonghua, true);
  assert.equal(report.originalLanguage, 'Chinese');
  assert.equal(report.hasDub, false);
  assert.equal(report.hasMultiDub, false);
  assert.equal(report.hasVerifiedStreams, true);
  assert.equal(report.tracks.length, 1);
  assert.equal(report.tracks[0].type, 'original');
  assert.equal(report.tracks[0].language, 'Chinese');
  assert.equal(report.tracks[0].verifiedEpisodes, 26);
  assert.equal(report.tracks[0].episodeRange, 'All 26 Episodes');
  assert.match(report.accuracyGuarantee, /Zero False Dubs/i);
  assert.match(report.coverageNote, /Original Chinese studio audio/i);
  assert.match(report.summaryLine, /Chinese \(Original\) · Subtitles Only/i);
});

test('episodeAudioDetection: Donghua with genuine partial Hindi dub reports exact episode coverage and servers', () => {
  const report = computeVerifiedAudioReport({
    animeId: 202,
    totalEpisodes: 24,
    countryOfOrigin: 'CN',
    flixResult: { sub: true, dub: false, subEps: 24, dubEps: 0 },
    megaResult: { sub: true, dub: false },
    desiResult: { available: true, episodeCount: 12 },
    tooniboyResult: { available: true, episodeCount: 12, languages: ['Hindi'] },
  });

  assert.equal(report.isDonghua, true);
  assert.equal(report.hasDub, true);
  assert.equal(report.hasMultiDub, false);
  assert.equal(report.tracks.length, 2);

  const origTrack = report.tracks.find((t) => t.type === 'original');
  assert.ok(origTrack);
  assert.equal(origTrack?.language, 'Chinese');
  assert.equal(origTrack?.verifiedEpisodes, 24);

  const hindiTrack = report.tracks.find((t) => t.language === 'Hindi');
  assert.ok(hindiTrack);
  assert.equal(hindiTrack?.type, 'dub');
  assert.equal(hindiTrack?.verifiedEpisodes, 12);
  assert.equal(hindiTrack?.isFullCoverage, false);
  assert.equal(hindiTrack?.episodeRange, 'Episodes 1–12 of 24');
  assert.ok(hindiTrack?.verifiedServers.some((s) => s.includes('DesiDub')));
  assert.ok(hindiTrack?.verifiedServers.some((s) => s.includes('Tooniboy')));
  assert.match(report.summaryLine, /Hindi Dub \(12\/24 eps\)/);
});

test('episodeAudioDetection: Japanese anime with full English dub and partial Hindi dub', () => {
  const report = computeVerifiedAudioReport({
    animeId: 303,
    totalEpisodes: 24,
    countryOfOrigin: 'JP',
    flixResult: { sub: true, dub: true, dubVerified: true, subEps: 24, dubEps: 24 },
    megaResult: { sub: true, dub: true, dubVerified: true, dubEps: 24 },
    desiResult: { available: true, episodeCount: 12 },
  });

  assert.equal(report.isDonghua, false);
  assert.equal(report.originalLanguage, 'Japanese');
  assert.equal(report.hasDub, true);
  assert.equal(report.hasMultiDub, true);

  const engTrack = report.tracks.find((t) => t.language === 'English');
  assert.ok(engTrack);
  assert.equal(engTrack?.isFullCoverage, true);
  assert.equal(engTrack?.episodeRange, 'All 24 Episodes');

  const hindiTrack = report.tracks.find((t) => t.language === 'Hindi');
  assert.ok(hindiTrack);
  assert.equal(hindiTrack?.isFullCoverage, false);
  assert.equal(hindiTrack?.episodeRange, 'Episodes 1–12 of 24');

  assert.match(report.summaryLine, /English Dub · Hindi Dub \(12\/24 eps\)/);
  assert.match(report.badgeText, /Japanese \+ 2 Dub Languages/i);
});

test('episodeAudioDetection: Single episode anime movie reports 1 Episode coverage cleanly', () => {
  const report = computeVerifiedAudioReport({
    animeId: 404,
    totalEpisodes: 1,
    countryOfOrigin: 'JP',
    flixResult: { sub: true, dub: true, dubVerified: true, subEps: 1, dubEps: 1 },
  });

  assert.equal(report.totalEpisodes, 1);
  assert.equal(report.tracks[0].episodeRange, '1 Episode');
  const engTrack = report.tracks.find((t) => t.language === 'English');
  assert.ok(engTrack);
  assert.equal(engTrack?.episodeRange, '1 Episode');
  assert.equal(engTrack?.isFullCoverage, true);
});

test('episodeAudioDetection: Multi-season series (Naruto Shippuden 500 eps) merges Tooniboy/ACDN 390 eps with FlixCloud 500 eps', () => {
  const report = computeVerifiedAudioReport({
    animeId: 1735,
    totalEpisodes: 500,
    countryOfOrigin: 'JP',
    flixResult: { sub: true, dub: true, dubVerified: true, subEps: 500, dubEps: 500 },
    wawResult: {
      available: true,
      episodeCount: 360,
      languages: ['Japanese', 'English', 'Hindi', 'Tamil', 'Malayalam', 'Telugu', 'Bengali'],
    },
    tooniboyResult: {
      available: true,
      episodeCount: 390,
      languages: ['Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Bengali', 'English', 'Japanese'],
    },
    acdnResult: {
      sub: true,
      episodeCount: 390,
      languages: ['Japanese', 'English', 'Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Bengali'],
    },
  });

  assert.equal(report.totalEpisodes, 500);
  assert.equal(report.hasDub, true);
  assert.equal(report.hasMultiDub, true);

  const eng = report.tracks.find((t) => t.language === 'English');
  const hindi = report.tracks.find((t) => t.language === 'Hindi');
  const telugu = report.tracks.find((t) => t.language === 'Telugu');
  const bengali = report.tracks.find((t) => t.language === 'Bengali');

  assert.equal(eng?.verifiedEpisodes, 500);
  assert.equal(eng?.isFullCoverage, true);
  assert.equal(hindi?.verifiedEpisodes, 390);
  assert.equal(hindi?.isFullCoverage, false);
  assert.equal(hindi?.episodeRange, 'Episodes 1–390 of 500');
  assert.equal(telugu?.verifiedEpisodes, 390);
  assert.equal(bengali?.verifiedEpisodes, 390);

  const reconciled = reconcileBreakdownWithReport(
    {
      totalEpisodes: 500,
      airedEpisodes: 500,
      originalLanguage: 'Japanese',
      multiDubCount: 32,
      multiDubPercentage: 6,
      hasMultiDub: true,
      dubCount: 500,
      dubPercentage: 100,
      hasEnglishDub: true,
      hindiDubCount: 32,
      hindiDubPercentage: 6,
      hasHindiDub: true,
      subOnlyCount: 0,
      subOnlyPercentage: 0,
      hasSubOnly: false,
      labels: {
        multiDub: 'Multiple Dubs (Multi-Dub)',
        multiDubDesc: 'Hindi, Tamil, Telugu, English & more regional dubs',
        dualAudio: 'English Dub & Japanese (Dual Audio)',
        dualAudioDesc: 'Official English Dub + Original Japanese Audio',
        hindiDub: 'Hindi Dub',
        hindiDubDesc: 'Hindi dubbed audio track',
        subOnly: 'Only Japanese (Original)',
        subOnlyDesc: 'Original Japanese studio audio with multi-language subtitles',
      },
      insight: 'stale',
    },
    report as any,
  );

  assert.ok(reconciled);
  assert.equal(reconciled?.multiDubCount, 390);
  assert.equal(reconciled?.multiDubPercentage, 78);
  assert.equal(reconciled?.hindiDubCount, 390);
  assert.equal(reconciled?.hindiDubPercentage, 78);
  assert.equal(reconciled?.dubCount, 500);
  assert.equal(reconciled?.dubPercentage, 100);
  assert.equal(reconciled?.subOnlyCount, 0);
});

test('episodeAudioDetection: Anikoto probe honors dubVerified on Donghua and sets hasVerifiedStreams cleanly', () => {
  const unverifiedReport = computeVerifiedAudioReport({
    animeId: 501,
    totalEpisodes: 12,
    countryOfOrigin: 'JP',
  });
  assert.equal(unverifiedReport.hasVerifiedStreams, false);
  assert.equal(unverifiedReport.tracks.length, 1);
  assert.deepEqual(unverifiedReport.tracks[0].verifiedServers, ['Indexed AnimeStream Servers']);

  const donghuaFalseDub = computeVerifiedAudioReport({
    animeId: 502,
    totalEpisodes: 12,
    countryOfOrigin: 'CN',
    anikotoResult: { sub: true, dub: true, dubVerified: false },
  });
  assert.equal(donghuaFalseDub.hasVerifiedStreams, true);
  assert.equal(donghuaFalseDub.hasDub, false);
  assert.ok(donghuaFalseDub.tracks[0].verifiedServers.includes('Server 5 (Anikoto)'));

  const donghuaRealDub = computeVerifiedAudioReport({
    animeId: 503,
    totalEpisodes: 12,
    countryOfOrigin: 'CN',
    anikotoResult: { sub: true, dub: true, dubVerified: true, dubEps: 12 },
  });
  assert.equal(donghuaRealDub.hasVerifiedStreams, true);
  assert.equal(donghuaRealDub.hasDub, true);
  const eng = donghuaRealDub.tracks.find((t) => t.language === 'English');
  assert.ok(eng);
  assert.ok(eng?.verifiedServers.includes('Server 5 (Anikoto)'));
});

test('computeAvailableAudio: merges verifiedReport with servers-available map and enforces Donghua dubVerified', () => {
  const partialReport = computeVerifiedAudioReport({
    animeId: 142777,
    totalEpisodes: 1,
    countryOfOrigin: 'JP',
    flixResult: { sub: true, dub: false, subEps: 1 },
  }) as any;

  const merged = computeAvailableAudio(
    {
      flixcloud: { sub: true, dub: false },
      acdn: { sub: true, dub: true, multi: true, languages: ['Japanese', 'English', 'Hindi'] },
      anikoto: { sub: true, dub: true, dubVerified: true },
    },
    'JP',
    false,
    partialReport,
  );

  assert.equal(merged.originalVerified, true);
  assert.equal(merged.hasAnyVerifiedStream, true);
  assert.equal(merged.hasDub, true);
  assert.equal(merged.hasMulti, true);
  assert.deepEqual(
    merged.dubs.map((d) => d.name),
    ['English', 'Hindi'],
  );
  const eng = merged.dubs.find((d) => d.name === 'English');
  assert.ok(eng?.verifiedServers?.includes('Server 4 (ACDN Multi-Audio)'));
  assert.ok(eng?.verifiedServers?.includes('Server 5 (Anikoto)'));
  assert.match(merged.summaryLine, /Japanese \(Original\).*English Dub.*Hindi Dub/);

  // Donghua unverified dub in servers must NOT leak into merged dubs
  const donghuaReport = computeVerifiedAudioReport({
    animeId: 126403,
    totalEpisodes: 12,
    countryOfOrigin: 'CN',
    flixResult: { sub: true, dub: false, subEps: 12 },
  }) as any;
  const donghuaMerged = computeAvailableAudio(
    {
      megaplay: { sub: true, dub: true, dubVerified: false },
      anikoto: { sub: true, dub: true, dubVerified: true },
    },
    'CN',
    false,
    donghuaReport,
  );
  assert.equal(donghuaMerged.dubs.length, 1);
  assert.equal(donghuaMerged.dubs[0].name, 'English');
  assert.deepEqual(donghuaMerged.dubs[0].verifiedServers, ['Server 5 (Anikoto)']);

  // Fallback-only unverified report with zero server results shows Limited availability
  const emptyReport = computeVerifiedAudioReport({
    animeId: 999,
    totalEpisodes: 12,
    countryOfOrigin: 'JP',
  }) as any;
  const fallback = computeAvailableAudio({}, 'JP', false, emptyReport);
  assert.equal(fallback.originalVerified, false);
  assert.equal(fallback.hasAnyVerifiedStream, false);
  assert.match(fallback.summaryLine, /Limited availability/);
});

test('computeAudioCheckingState: stays checking if report has no verified servers while serverAvail is loading', () => {
  assert.equal(
    computeAudioCheckingState({
      hasAnime: true,
      seasonReady: true,
      detectorStatus: 'verified',
      hasReport: true,
      hasVerifiedReportServers: false,
      serverAvailLoading: true,
      serverAvailHasData: false,
      hasMultipleEpisodes: true,
      remoteBreakdownLoading: false,
      remoteBreakdownHasData: false,
      remoteBreakdownHasError: false,
    }),
    true,
  );

  assert.equal(
    computeAudioCheckingState({
      hasAnime: true,
      seasonReady: true,
      detectorStatus: 'verified',
      hasReport: true,
      hasVerifiedReportServers: false,
      serverAvailLoading: false,
      serverAvailHasData: true,
      hasMultipleEpisodes: true,
      remoteBreakdownLoading: false,
      remoteBreakdownHasData: false,
      remoteBreakdownHasError: false,
    }),
    false,
  );
});
