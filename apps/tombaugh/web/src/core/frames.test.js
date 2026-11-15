// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DETECTORS, detOf, channelOf, channelRange, channelCenter, splitPasses, medianMjd, passLabel,
  layerWave, groupLayers,
} from './frames.js';

test('DETECTORS: six detectors, 17 channels each, contract ranges', () => {
  assert.equal(DETECTORS.length, 6);
  assert.deepEqual(DETECTORS.map((d) => d.det), [1, 2, 3, 4, 5, 6]);
  for (const d of DETECTORS) assert.equal(d.channels, 17);
  assert.deepEqual([DETECTORS[0].min, DETECTORS[0].max], [0.75, 1.09]);
  assert.deepEqual([DETECTORS[3].min, DETECTORS[3].max], [2.42, 3.82]);
  assert.deepEqual([DETECTORS[5].min, DETECTORS[5].max], [4.42, 5.0]);
  assert.equal(DETECTORS.reduce((s, d) => s + d.channels, 0), 102);
});

test('channelOf: edges, clamping and invalid input', () => {
  assert.equal(channelOf(2, 1.10), 0);
  assert.equal(channelOf(2, 1.62), 16);
  assert.equal(channelOf(2, 1.05), 0, 'below the range clamps to the first channel');
  assert.equal(channelOf(2, 1.667), 16, 'real frames reach past the nominal edge');
  assert.equal(channelOf(2, NaN), -1);
  assert.equal(channelOf(2, -1), -1);
  assert.equal(channelOf(0, 1.3), -1);
  assert.equal(channelOf(7, 1.3), -1);
  for (const d of DETECTORS) {
    for (let ch = 0; ch < 17; ch++) {
      const [lo, hi] = channelRange(d.det, ch);
      assert.equal(channelOf(d.det, lo), ch, `lower edge of D${d.det} channel ${ch} is inclusive`);
      assert.equal(channelOf(d.det, hi * (1 - 1e-6)), ch, 'just below the upper edge');
      if (ch < 16) assert.equal(channelOf(d.det, hi * (1 + 1e-6)), ch + 1, 'just above the upper edge');
      assert.equal(channelOf(d.det, channelCenter(d.det, ch)), ch);
    }
  }
});

test('channelRange: contiguous, log-spaced, spans the detector', () => {
  for (const d of DETECTORS) {
    assert.ok(Math.abs(channelRange(d.det, 0)[0] - d.min) < 1e-12);
    assert.equal(channelRange(d.det, 16)[1], d.max);
    const ratio = channelRange(d.det, 0)[1] / channelRange(d.det, 0)[0];
    for (let ch = 0; ch < 17; ch++) {
      const [lo, hi] = channelRange(d.det, ch);
      assert.ok(hi > lo);
      assert.ok(Math.abs(hi / lo - ratio) < 1e-9, 'constant resolving power');
      if (ch < 16) assert.ok(Math.abs(hi - channelRange(d.det, ch + 1)[0]) < 1e-12);
    }
  }
  assert.ok(Number.isNaN(channelRange(3, 17)[0]));
  assert.ok(Number.isNaN(channelRange(9, 0)[0]));
});

test('detOf: containing detector, nearest in gaps, 0 for nonsense', () => {
  assert.equal(detOf(0.9), 1);
  assert.equal(detOf(2.0), 3);
  assert.equal(detOf(3.3), 4);
  assert.equal(detOf(4.415), 5, 'gap between D5 and D6: nearest');
  assert.equal(detOf(4.418), 6);
  assert.equal(detOf(5.3), 6);
  assert.equal(detOf(0.5), 1);
  assert.equal(detOf(NaN), 0);
  assert.equal(detOf(-2), 0);
});

test('splitPasses: sorts, splits on gaps, drops items without a time', () => {
  const items = [
    { mjd: 61012.5, id: 'c1' }, { mjd: 60830.1, id: 'a1' }, { mjd: 60830.9, id: 'a2' },
    { mjd: 61195.0, id: 'd1' }, { mjd: 61013.0, id: 'c2' }, { mjd: NaN, id: 'bad' }, { id: 'none' },
    { mjd: 60845.0, id: 'a3' },
  ];
  const before = items.map((i) => i.id).join();
  const passes = splitPasses(items);
  assert.equal(items.map((i) => i.id).join(), before, 'input is not reordered');
  assert.deepEqual(passes.map((p) => p.map((i) => i.id)), [['a1', 'a2', 'a3'], ['c1', 'c2'], ['d1']]);
  // A 10 day gap threshold separates a3 from a1/a2.
  assert.deepEqual(splitPasses(items, 10).map((p) => p.length), [2, 1, 2, 1]);
  // Exactly at the threshold is still the same pass; just over is a new one.
  assert.equal(splitPasses([{ mjd: 0 }, { mjd: 45 }]).length, 1);
  assert.equal(splitPasses([{ mjd: 0 }, { mjd: 45.01 }]).length, 2);
  assert.deepEqual(splitPasses([]), []);
  assert.deepEqual(splitPasses(null), []);
});

test('passLabel and medianMjd', () => {
  assert.equal(passLabel(61210.79), 'Jun 2026'); // DATE-OBS 2026-06-19 in the contract
  assert.equal(passLabel(60830), 'Jun 2025');
  assert.equal(passLabel(40587), 'Jan 1970');
  assert.equal(passLabel(51544.5), 'Jan 2000'); // J2000.0
  assert.equal(passLabel([{ mjd: 61010 }, { mjd: 61012 }, { mjd: 61030 }]), 'Dec 2025');
  assert.equal(medianMjd([{ mjd: 3 }, { mjd: 1 }, { mjd: 2 }, { mjd: 10 }]), 2.5);
  assert.equal(passLabel([]), '');
  assert.equal(passLabel(NaN), '');
});

function fakeLayer(det, mjd, wave, n = 5) {
  return {
    frame: { waveCenter: wave }, det, mjd,
    image: new Float32Array(n * n), variance: new Float32Array(n * n).fill(1),
    wave: new Float32Array(n * n).fill(wave), mask: new Uint8Array(n * n),
  };
}

test('layerWave: grid centre first, then frame centre, then mean', () => {
  const l = fakeLayer(3, 60000, 2.0);
  l.wave[12] = 2.1; // centre pixel of the 5 x 5 grid
  assert.ok(Math.abs(layerWave(l) - 2.1) < 1e-6);
  l.wave[12] = NaN;
  assert.equal(layerWave(l), 2.0);
  l.frame = null;
  assert.ok(Math.abs(layerWave(l) - 2.0) < 1e-6);
  assert.ok(Number.isNaN(layerWave({})));
});

test('groupLayers: passes in time order and channels in wavelength order', () => {
  const [lo3, hi3] = channelRange(3, 3);
  const layers = [
    fakeLayer(3, 61012, channelCenter(3, 9)),
    fakeLayer(3, 60830, channelCenter(3, 3)),
    fakeLayer(3, 60831, channelCenter(3, 9)),
    fakeLayer(3, 61013, 0.5 * (lo3 + hi3)),
    fakeLayer(3, 61014, channelCenter(3, 0)),
  ];
  const { passes, byChannel } = groupLayers(layers);
  assert.deepEqual(passes.map((p) => p.map((l) => l.mjd)), [[60830, 60831], [61012, 61013, 61014]]);
  assert.deepEqual([...byChannel.keys()], [0, 3, 9]);
  assert.deepEqual(byChannel.get(3).map((l) => l.mjd), [60830, 61013]);
  assert.deepEqual(byChannel.get(9).map((l) => l.mjd), [60831, 61012]);
  assert.equal(byChannel.get(0).length, 1);
});

test('splitPasses: a deep field visited all year is cut into seasons of at most 90 days', () => {
  const items = [];
  for (let d = 0; d <= 520; d += 2) items.push({ mjd: 60790 + d });
  const seasons = splitPasses(items);
  assert.equal(seasons.length, 6);
  assert.equal(seasons.reduce((n, s) => n + s.length, 0), items.length);
  for (const s of seasons) assert.ok(s[s.length - 1].mjd - s[0].mjd <= 90);
  // an ordinary pass, however densely sampled, stays whole; so does a 100-day one
  assert.equal(splitPasses(items.slice(0, 20)).length, 1);
  assert.equal(splitPasses(items.slice(0, 51)).length, 1);
  // a long run next to a short pass: only the long run is cut
  const mixed = [{ mjd: 60000 }, { mjd: 60003 }, ...items];
  assert.deepEqual(splitPasses(mixed).map((s) => s.length).slice(0, 1), [2]);
  assert.equal(splitPasses(mixed).length, 7);
  // the limit can be lifted
  assert.equal(splitPasses(items, 45, Infinity).length, 1);
});
