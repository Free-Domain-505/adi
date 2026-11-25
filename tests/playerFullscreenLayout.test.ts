import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateControlBarWidthPx, formatCompactAudioLabel } from '../src/lib/playerControlsLayout';

test('formatCompactAudioLabel keeps full labels on desktop and shortens verbose parentheticals when compact', () => {
  assert.equal(formatCompactAudioLabel('Japanese (Original)', false), 'Japanese (Original)');
  assert.equal(formatCompactAudioLabel('Japanese (Original)', true), 'Japanese');
  assert.equal(formatCompactAudioLabel('English (Dub)', true), 'English');
  assert.equal(formatCompactAudioLabel('Hindi (Regional Dub)', true), 'Hindi');
  assert.equal(formatCompactAudioLabel('   ', true), 'Audio');
});

test('estimateControlBarWidthPx ensures Fullscreen fits inside mobile and narrow embed containers even with Cast & Watch Together', () => {
  const widths = [300, 320, 360, 390, 412, 480, 667, 768, 1280];
  for (const w of widths) {
    const res = estimateControlBarWidthPx({
      containerWidthPx: w,
      hasQuality: true,
      hasAudio: true,
      hasWatchTogether: true,
      hasCast: true,
      compactMode: w <= 480,
      audioPillWidthPx: 150,
    });
    assert.equal(
      res.fitsInsideContainer,
      true,
      `Expected all player controls (including Fullscreen) to fit inside ${w}px player (total=${res.totalControlsWidthPx}px, inner=${res.innerWidthPx}px)`,
    );
  }
});
