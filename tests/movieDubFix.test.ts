import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMovieBoxCdnHost } from '../server/handler.js';
import {
  cleanMovieDubLabel,
  normalizeMovieDubLanguage,
  isOriginalMovieDubLabel,
  resolveRequestedDubInfo,
  backupMatchesRequestedDub,
} from '../src/lib/movieServers.ts';

test('classifyMovieBoxCdnHost distinguishes direct app CDNs from web mirror CDNs', () => {
  assert.deepEqual(classifyMovieBoxCdnHost('bcdn.hakunaymatata.com'), {
    isWebMirrorCdn: false,
    isDirectAppCdn: true,
  });
  assert.deepEqual(classifyMovieBoxCdnHost('valiw.hakunaymatata.com'), {
    isWebMirrorCdn: false,
    isDirectAppCdn: true,
  });
  assert.deepEqual(classifyMovieBoxCdnHost('cdn.aoneroom.com'), {
    isWebMirrorCdn: false,
    isDirectAppCdn: true,
  });
  assert.deepEqual(classifyMovieBoxCdnHost('bcdnxw.hakunaymatata.com'), {
    isWebMirrorCdn: true,
    isDirectAppCdn: false,
  });
  assert.deepEqual(classifyMovieBoxCdnHost('123moviesfree.club'), {
    isWebMirrorCdn: true,
    isDirectAppCdn: false,
  });
  assert.deepEqual(classifyMovieBoxCdnHost('example.com'), {
    isWebMirrorCdn: false,
    isDirectAppCdn: false,
  });
});

test('cleanMovieDubLabel and normalizeMovieDubLanguage strip server prefixes and noisy tokens', () => {
  assert.equal(cleanMovieDubLabel('MovieBox · Hindi dub'), 'Hindi dub');
  assert.equal(cleanMovieDubLabel('Vidzee Direct: Spanish'), 'Spanish');
  assert.equal(normalizeMovieDubLanguage('MovieBox · Hindi dub (720p)'), 'hindi');
  assert.equal(normalizeMovieDubLanguage('Vidzee · Spanish Audio'), 'spanish');
  assert.equal(isOriginalMovieDubLabel('Original'), true);
  assert.equal(isOriginalMovieDubLabel('Hindi dub'), false);
});

test('resolveRequestedDubInfo resolves numeric MovieBox dub IDs to human language labels', () => {
  const dubs = [
    { id: '12345', label: 'Original' },
    { id: '998877', label: 'Hindi dub' },
    { id: '554433', label: 'Spanish' },
  ];

  const hindi = resolveRequestedDubInfo('-998877', dubs);
  assert.equal(hindi.cleanId, '998877');
  assert.equal(hindi.label, 'Hindi dub');
  assert.equal(hindi.langQuery, 'Hindi');
  assert.equal(hindi.isNonOriginal, true);

  const vidzeeEs = resolveRequestedDubInfo('vidzee:Spanish', dubs);
  assert.equal(vidzeeEs.label, 'Spanish');
  assert.equal(vidzeeEs.langQuery, 'Spanish');
  assert.equal(vidzeeEs.isNonOriginal, true);

  const orig = resolveRequestedDubInfo('12345', dubs);
  assert.equal(orig.label, 'Original');
  assert.equal(orig.langQuery, null);
  assert.equal(orig.isNonOriginal, false);

  const unknownNumeric = resolveRequestedDubInfo('777777', dubs);
  assert.equal(unknownNumeric.cleanId, '777777');
  assert.equal(unknownNumeric.langQuery, null);
});

test('backupMatchesRequestedDub strictly filters backups by requested dub language', () => {
  const hindiBackup = {
    activeLanguage: 'Hindi',
    dubs: [{ label: 'Hindi', selected: true }],
    streams: [{ language: 'Hindi', quality: '720p' }],
  };
  const originalBackup = {
    activeLanguage: 'English',
    dubs: [{ label: 'Original', selected: true }],
    streams: [{ language: 'English', quality: '1080p' }],
  };

  assert.equal(backupMatchesRequestedDub(hindiBackup, 'Hindi'), true);
  assert.equal(backupMatchesRequestedDub(originalBackup, 'Hindi'), false);
  assert.equal(backupMatchesRequestedDub(originalBackup, null), true);
});
