// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests for stretch.js. Run: node --test web/src/core/stretch.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentile,
  robustStats,
  autoRange,
  zscaleRange,
  stretchValue,
  stretchImage,
  STRETCH_MODES,
} from './stretch.js';

// Small deterministic generator (mulberry32) and a Gaussian deviate on top of it.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || 'value'}: got ${actual}, expected ${expected} +/- ${tol}`);
}

/** Reference percentile: full sort and linear interpolation (numpy "linear"). */
function refPercentile(values, p) {
  const s = Float64Array.from(values).sort();
  if (s.length === 0) return NaN;
  const rank = (p / 100) * (s.length - 1);
  const k = Math.floor(rank);
  return k + 1 < s.length ? s[k] + (s[k + 1] - s[k]) * (rank - k) : s[k];
}

test('percentile: small exact cases', () => {
  assert.equal(percentile([1, 2, 3, 4], null, 50), 2.5);
  assert.equal(percentile([4, 1, 3, 2], null, 0), 1);
  assert.equal(percentile([4, 1, 3, 2], null, 100), 4);
  assert.equal(percentile([4, 1, 3, 2], null, 25), 1.75);
  assert.equal(percentile([5], null, 73), 5);
  assert.equal(percentile([3, 1, 2], null, 50), 2);
  assert.equal(percentile([7, 7, 7, 7], null, 31), 7);
  assert.equal(percentile(new Float32Array([10, 20]), null, 50), 15);
  // Out-of-range p is clamped.
  assert.equal(percentile([1, 2, 3], null, -5), 1);
  assert.equal(percentile([1, 2, 3], null, 250), 3);
  // Nothing usable.
  assert.ok(Number.isNaN(percentile([], null, 50)));
  assert.ok(Number.isNaN(percentile([NaN, Infinity], null, 50)));
  assert.ok(Number.isNaN(percentile([1, 2], [1, 1], 50)));
  assert.ok(Number.isNaN(percentile(null, null, 50)));
});

test('percentile: ignores masked and non-finite values, does not modify its input', () => {
  const data = new Float32Array([5, NaN, 1, Infinity, 3, -Infinity, 100, 2, 4]);
  const mask = new Uint8Array([0, 0, 0, 0, 0, 0, 1, 0, 0]);
  const copy = Float32Array.from(data);
  assert.equal(percentile(data, mask, 50), 3); // of 1, 2, 3, 4, 5
  assert.equal(percentile(data, mask, 100), 5);
  assert.equal(percentile(data, null, 100), 100);
  assert.deepEqual(data, copy);
});

test('percentile: matches a full sort on random data with a mask', () => {
  const rand = rng(42);
  for (const n of [2, 3, 10, 101, 1000, 6241]) {
    const data = new Float32Array(n);
    const mask = new Uint8Array(n);
    const kept = [];
    for (let i = 0; i < n; i++) {
      data[i] = Math.fround(gaussian(rand) * 3 + (rand() < 0.02 ? 500 : 1));
      if (rand() < 0.1) data[i] = NaN;
      mask[i] = rand() < 0.2 ? 1 : 0;
      // Many duplicates stress the partitioning.
      if (rand() < 0.3) data[i] = 1;
      if (!mask[i] && Number.isFinite(data[i])) kept.push(data[i]);
    }
    for (const p of [0, 0.5, 1, 10, 25, 50, 75, 90, 99, 99.7, 100]) {
      const got = percentile(data, mask, p);
      const want = refPercentile(kept, p);
      if (kept.length === 0) assert.ok(Number.isNaN(got));
      else close(got, want, 1e-5 * Math.max(1, Math.abs(want)), `n=${n}, p=${p}`);
    }
  }
  // Plain arrays and Float64Array work too and keep double precision.
  const d64 = new Float64Array([0.1, 0.2, 0.30000000000000004]);
  assert.equal(percentile(d64, null, 100), 0.30000000000000004);
});

test('robustStats: Gaussian noise, outliers, masks', () => {
  const rand = rng(7);
  const n = 20000;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = 0.89 + 0.03 * gaussian(rand);
  let s = robustStats(data, null);
  close(s.median, 0.89, 0.001, 'median');
  close(s.sigma, 0.03, 0.0015, 'sigma');
  assert.equal(s.n, n);
  close(s.sigma, 1.4826 * s.mad, 1e-12);
  // Ten percent wild outliers barely move a robust estimate.
  for (let i = 0; i < n; i += 10) data[i] = 51.6;
  s = robustStats(data, null);
  close(s.median, 0.89, 0.006, 'median with outliers');
  close(s.sigma, 0.03, 0.006, 'sigma with outliers');
  // Masking them restores the clean answer.
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i += 10) mask[i] = 1;
  s = robustStats(data, mask);
  close(s.sigma, 0.03, 0.0015);
  assert.equal(s.n, n - n / 10);
  // Exact small case: median 3, |dev| = 2,1,0,1,2 -> MAD 1.
  s = robustStats([1, 2, 3, 4, 5], null);
  assert.equal(s.median, 3);
  close(s.sigma, 1.4826, 1e-12);
  // Empty.
  s = robustStats([NaN], null);
  assert.ok(Number.isNaN(s.median) && Number.isNaN(s.sigma));
  assert.equal(s.n, 0);
});

test('autoRange: percentile range, defaults, degenerate inputs', () => {
  const n = 10001;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = i; // 0..10000, shuffled order is irrelevant
  let [lo, hi] = autoRange(data, null);
  close(lo, 50, 1e-3, 'default 0.5 percentile');
  close(hi, 9970, 1e-3, 'default 99.7 percentile');
  [lo, hi] = autoRange(data, null, { lo: 10, hi: 90 });
  close(lo, 1000, 1e-3);
  close(hi, 9000, 1e-3);
  [lo, hi] = autoRange(data, null, {});
  close(lo, 50, 1e-3);
  // Masks and NaN are ignored.
  const mask = new Uint8Array(n);
  for (let i = 5001; i < n; i++) mask[i] = 1;
  data[0] = NaN;
  [lo, hi] = autoRange(data, mask, { lo: 0, hi: 100 });
  assert.equal(lo, 1);
  assert.equal(hi, 5000);
  // Constant image: still a usable, strictly increasing range around the value.
  [lo, hi] = autoRange(new Float32Array(100).fill(3), null);
  assert.ok(lo < 3 && hi > 3 && Number.isFinite(lo) && Number.isFinite(hi));
  [lo, hi] = autoRange(new Float32Array(100), null);
  assert.ok(lo < hi);
  // Nothing usable.
  assert.deepEqual(autoRange(new Float32Array([NaN, NaN]), null), [0, 1]);
  assert.deepEqual(autoRange([], null), [0, 1]);
  // Swapped percentiles still give an increasing range.
  [lo, hi] = autoRange(data, mask, { lo: 90, hi: 10 });
  assert.ok(lo < hi);
});

test('zscaleRange: sky-dominated image gives a tight range around the sky', () => {
  const rand = rng(99);
  const n = 100 * 100;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = 0.89 + 0.03 * gaussian(rand);
  // A few bright stars.
  for (let k = 0; k < 30; k++) data[Math.floor(rand() * n)] = 5 + 50 * rand();
  const copy = Float32Array.from(data);
  const [z1, z2] = zscaleRange(data, null);
  assert.deepEqual(data, copy, 'input untouched');
  assert.ok(z1 < 0.89 && z2 > 0.89, `range ${z1}..${z2} brackets the sky`);
  assert.ok(z1 > 0.89 - 0.4 && z2 < 0.89 + 0.6, `range ${z1}..${z2} is tight, not min/max`);
  assert.ok(z2 < 5, 'stars saturate');
  // Lower contrast widens the range.
  const [w1, w2] = zscaleRange(data, null, { contrast: 0.1 });
  assert.ok(w2 - w1 > z2 - z1);
  // Degenerate inputs.
  assert.deepEqual(zscaleRange([], null), [0, 1]);
  assert.deepEqual(zscaleRange([NaN], null), [0, 1]);
  let [a, b] = zscaleRange([2, 2, 2, 2, 2, 2, 2, 2], null);
  assert.ok(a < b && a < 2 && b > 2);
  [a, b] = zscaleRange([1, 2, 3], null);
  assert.deepEqual([a, b], [1, 3]);
  // Mask respected.
  const mask = new Uint8Array(n).fill(1);
  assert.deepEqual(zscaleRange(data, mask), [0, 1]);
  // A pure linear ramp returns (nearly) its full range at contrast 1.
  const ramp = Float32Array.from({ length: 500 }, (_, i) => i);
  [a, b] = zscaleRange(ramp, null, { contrast: 1 });
  close(a, 0, 2);
  close(b, 499, 2);
});

test('stretchValue: endpoints, clamping and NaN safety in every mode', () => {
  for (const mode of [...STRETCH_MODES, undefined, 'nonsense']) {
    assert.equal(stretchValue(2, 2, 10, mode), 0, `${mode}: vmin -> 0`);
    close(stretchValue(10, 2, 10, mode), 1, 1e-12, `${mode}: vmax -> 1`);
    assert.equal(stretchValue(-5, 2, 10, mode), 0, `${mode}: below range`);
    assert.equal(stretchValue(1e9, 2, 10, mode), 1, `${mode}: above range`);
    assert.equal(stretchValue(NaN, 2, 10, mode), 0, `${mode}: NaN`);
    assert.equal(stretchValue(Infinity, 2, 10, mode), 1, `${mode}: +Infinity`);
    assert.equal(stretchValue(-Infinity, 2, 10, mode), 0, `${mode}: -Infinity`);
    assert.equal(stretchValue(undefined, 2, 10, mode), 0, `${mode}: undefined`);
    // Degenerate or broken ranges never produce NaN.
    assert.equal(stretchValue(5, 3, 3, mode), 0);
    assert.equal(stretchValue(5, 10, 2, mode), 0);
    assert.equal(stretchValue(5, NaN, 10, mode), 0);
    assert.equal(stretchValue(5, 0, NaN, mode), 0);
    assert.equal(stretchValue(5, -Infinity, Infinity, mode), 0);
    // Negative ranges are fine.
    close(stretchValue(-2, -4, 0, 'linear'), 0.5, 1e-12);
  }
  assert.deepEqual(STRETCH_MODES, ['linear', 'asinh', 'log', 'sqrt']);
});

test('stretchValue: every mode is monotonic and stays inside 0..1', () => {
  const vmin = -0.2;
  const vmax = 51.6;
  for (const mode of STRETCH_MODES) {
    let prev = -1;
    let strictlyIncreasing = 0;
    for (let i = -50; i <= 2050; i++) {
      const v = vmin + ((vmax - vmin) * i) / 2000;
      const s = stretchValue(v, vmin, vmax, mode);
      assert.ok(s >= 0 && s <= 1, `${mode}: ${s} out of range`);
      assert.ok(s >= prev, `${mode}: not monotonic at step ${i}`);
      if (s > prev) strictlyIncreasing++;
      prev = s;
    }
    assert.ok(strictlyIncreasing >= 2000, `${mode}: strictly increasing inside the range`);
  }
});

test('stretchValue: shapes', () => {
  close(stretchValue(5, 0, 10, 'linear'), 0.5, 1e-12);
  close(stretchValue(2.5, 0, 10, 'sqrt'), 0.5, 1e-12);
  close(stretchValue(5, 0, 10, 'log'), Math.log(501) / Math.log(1001), 1e-12);
  close(stretchValue(1, 0, 10, 'asinh'), Math.asinh(1) / Math.asinh(10), 1e-12);
  // Non-linear modes lift faint pixels: asinh, sqrt and log are all above linear mid-range.
  for (const mode of ['asinh', 'log', 'sqrt']) {
    assert.ok(stretchValue(1, 0, 10, mode) > 0.1, mode);
    assert.ok(stretchValue(9, 0, 10, mode) > 0.9, mode);
  }
  // asinh is nearly linear near zero (slope 1 / (softening * asinh(1 / softening))).
  const a = stretchValue(0.001, 0, 1, 'asinh');
  const b = stretchValue(0.002, 0, 1, 'asinh');
  close(b / a, 2, 1e-3);
  // The softening is tied to the range: scaling data and range together changes nothing.
  close(stretchValue(3, 0, 10, 'asinh'), stretchValue(300, 0, 1000, 'asinh'), 1e-12);
});

test('stretchImage: masked and non-finite pixels give 0, reuses the output buffer', () => {
  const data = new Float32Array([0, 5, 10, NaN, 7]);
  const mask = new Uint8Array([0, 0, 0, 0, 1]);
  const out = stretchImage(data, mask, 0, 10, 'linear');
  assert.deepEqual(Array.from(out), [0, 0.5, 1, 0, 0]);
  const buf = new Float32Array(5);
  assert.equal(stretchImage(data, null, 0, 10, 'sqrt', buf), buf);
  close(buf[4], Math.sqrt(0.7), 1e-6);
});
