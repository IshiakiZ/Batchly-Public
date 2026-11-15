// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectKth, medianInPlace, stackLayers, backgroundLevel, normalizeBackground, subtractImages,
} from './stack.js';

// Small deterministic generator (mulberry32) with Gaussian deviates.
function rng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const g = () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, g };
}

function layer(values, variance = 1, mask = null) {
  return {
    image: Float32Array.from(values),
    variance: new Float32Array(values.length).fill(variance),
    mask: mask ? Uint8Array.from(mask) : new Uint8Array(values.length),
  };
}

test('selectKth and medianInPlace agree with sorting', () => {
  const r = rng(1);
  for (let n = 1; n <= 40; n++) {
    const vals = Array.from({ length: n }, () => Math.round(r.g() * 5) + 0); // many ties; + 0 avoids -0
    const sorted = [...vals].sort((a, b) => a - b);
    for (const k of [0, n >> 1, n - 1]) {
      assert.equal(selectKth(Float64Array.from(vals), n, k), sorted[k]);
    }
    const expect = n % 2 ? sorted[n >> 1] : 0.5 * (sorted[n / 2 - 1] + sorted[n / 2]);
    assert.equal(medianInPlace(Float64Array.from(vals), n), expect);
  }
  assert.ok(Number.isNaN(medianInPlace(new Float64Array(4), 0)));
  // Only the first n entries are considered.
  assert.equal(medianInPlace(Float64Array.from([3, 1, 2, 99, 99]), 3), 2);
});

test('wmean: inverse-variance weights, propagated variance, count', () => {
  const st = stackLayers([layer([1, 5], 1), layer([3, 5], 3)], { clip: 0 });
  assert.ok(Math.abs(st.image[0] - 1.5) < 1e-6); // (1/1 + 3/3) / (1 + 1/3)
  assert.ok(Math.abs(st.variance[0] - 0.75) < 1e-6);
  assert.equal(st.image[1], 5);
  assert.deepEqual([...st.count], [2, 2]);
  assert.deepEqual([...st.mask], [0, 0]);
});

test('masks and non-finite values are missing; no coverage means masked', () => {
  const a = layer([1, NaN, 7, 2], 1, [0, 0, 1, 1]);
  const b = layer([3, 4, 9, Infinity], 1, [0, 0, 1, 0]);
  b.variance[0] = 0; // unusable variance: sample dropped
  const st = stackLayers([a, b]);
  assert.equal(st.image[0], 1);
  assert.equal(st.count[0], 1);
  assert.equal(st.image[1], 4);
  assert.equal(st.count[1], 1);
  for (const i of [2, 3]) {
    assert.equal(st.mask[i], 1);
    assert.equal(st.count[i], 0);
    assert.ok(Number.isNaN(st.image[i]));
    assert.ok(Number.isNaN(st.variance[i]));
  }
  const empty = stackLayers([]);
  assert.equal(empty.image.length, 0);
});

test('sigma clipping rejects an outlier that a plain mean would keep', () => {
  const r = rng(7);
  const sigma = 0.1;
  const layers = [];
  for (let l = 0; l < 10; l++) layers.push(layer([5 + sigma * r.g(), 5 + sigma * r.g()], sigma * sigma));
  layers[4].image[0] = 50; // cosmic ray in one exposure, pixel 0 only
  const clipped = stackLayers(layers);
  const plain = stackLayers(layers, { clip: 0 });
  assert.equal(clipped.count[0], 9);
  assert.equal(clipped.count[1], 10);
  assert.ok(Math.abs(clipped.image[0] - 5) < 0.1, `clipped mean ${clipped.image[0]}`);
  assert.ok(plain.image[0] > 9, 'without clipping the outlier drags the mean');
  assert.equal(plain.count[0], 10);
  // With only three samples the outlier is still caught (median/MAD, not mean/rms).
  const three = stackLayers([layer([5.02], 0.01), layer([4.97], 0.01), layer([60], 0.01)]);
  assert.equal(three.count[0], 2);
  assert.ok(Math.abs(three.image[0] - 5) < 0.1);
});

test('clipping tolerates real scatter larger than the noise', () => {
  // A star seen at ten different wavelengths: values spread far more than the tiny noise.
  const layers = [];
  for (let l = 0; l < 10; l++) layers.push(layer([1 + 0.1 * l], 1e-6));
  const st = stackLayers(layers);
  assert.equal(st.count[0], 10, 'nothing rejected');
  assert.ok(Math.abs(st.image[0] - 1.45) < 1e-5);
});

test('median and sum methods', () => {
  const layers = [layer([1, 2], 0.5), layer([100, 4], 0.5), layer([3, NaN], 0.5), layer([2, 6], 0.5)];
  const med = stackLayers(layers, { method: 'median' });
  assert.equal(med.image[0], 2.5);
  assert.equal(med.image[1], 4);
  assert.deepEqual([...med.count], [4, 3]);
  assert.ok(Math.abs(med.variance[0] - (Math.PI / 2) * 0.5 / 4) < 1e-6);
  const sum = stackLayers(layers, { method: 'sum', clip: 0 });
  assert.equal(sum.image[0], 106);
  assert.equal(sum.image[1], 12);
  assert.equal(sum.variance[0], 2);
  assert.equal(sum.variance[1], 1.5);
  // Layers without a variance array are averaged with equal weight.
  const bare = stackLayers([{ image: Float32Array.from([1]) }, { image: Float32Array.from([2]) }], { clip: 0 });
  assert.equal(bare.image[0], 1.5);
});

function skyLayer(n, level, seed, withSources = true) {
  const r = rng(seed);
  const image = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) image[i] = level + 0.02 * r.g();
  if (withSources) {
    for (let s = 0; s < 12; s++) {
      const x0 = 3 + r.u() * (n - 6);
      const y0 = 3 + r.u() * (n - 6);
      const amp = 0.5 + 5 * r.u();
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const d2 = (x - x0) ** 2 + (y - y0) ** 2;
          if (d2 < 40) image[y * n + x] += amp * Math.exp(-d2 / 2.4);
        }
      }
    }
  }
  return { image, variance: new Float32Array(n * n).fill(4e-4), mask: new Uint8Array(n * n), mjd: 60000 + seed, det: 3 };
}

test('backgroundLevel: sky offset despite sources, masks and NaN', () => {
  const l = skyLayer(60, 0.3, 3);
  assert.ok(Math.abs(backgroundLevel(l) - 0.3) < 0.006, `level ${backgroundLevel(l)}`);
  // Garbage under the mask and NaN pixels do not matter.
  for (let i = 0; i < 400; i++) { l.image[i] = 1000; l.mask[i] = 1; }
  l.image[2000] = NaN;
  assert.ok(Math.abs(backgroundLevel(l) - 0.3) < 0.006);
  // Negative offsets work too, and an unusable layer gives 0.
  assert.ok(Math.abs(backgroundLevel(skyLayer(40, -0.07, 4)) + 0.07) < 0.006);
  const dead = { image: new Float32Array(16).fill(NaN), mask: new Uint8Array(16) };
  assert.equal(backgroundLevel(dead), 0);
  assert.equal(backgroundLevel({ image: new Float32Array(16), mask: new Uint8Array(16).fill(1) }), 0);
});

test('normalizeBackground: removes per-layer offsets without touching the inputs', () => {
  const layers = [skyLayer(50, 0.21, 5), skyLayer(50, -0.04, 6), skyLayer(50, 0.0, 7)];
  const copies = layers.map((l) => Float32Array.from(l.image));
  const out = normalizeBackground(layers);
  assert.equal(out.length, 3);
  for (let k = 0; k < 3; k++) {
    assert.deepEqual(layers[k].image, copies[k], 'input image unchanged');
    assert.notEqual(out[k].image, layers[k].image);
    assert.equal(out[k].variance, layers[k].variance, 'other fields are shared');
    assert.equal(out[k].mjd, layers[k].mjd);
    assert.ok(Math.abs(out[k].background - [0.21, -0.04, 0][k]) < 0.006);
    assert.ok(Math.abs(backgroundLevel(out[k])) < 0.003, 'residual offset is gone');
  }
  assert.deepEqual(normalizeBackground([]), []);
});

test('subtractImages: arrays or objects, masks combined', () => {
  const d = subtractImages(Float32Array.from([5, 4, NaN]), Float32Array.from([1, 1, 1]));
  assert.equal(d.image[0], 4);
  assert.equal(d.image[1], 3);
  assert.deepEqual([...d.mask], [0, 0, 1]);
  assert.ok(Number.isNaN(d.image[2]));
  assert.equal(d.variance, undefined);

  const a = { image: Float32Array.from([5, 4, 3, 2]), mask: Uint8Array.from([0, 1, 0, 0]), variance: Float32Array.from([1, 1, 1, 1]) };
  const b = { image: Float32Array.from([1, 1, 1, 1]), mask: Uint8Array.from([0, 0, 1, 0]), variance: Float32Array.from([2, 2, 2, 2]) };
  const e = subtractImages(a, b);
  assert.deepEqual([...e.mask], [0, 1, 1, 0]);
  assert.equal(e.image[0], 4);
  assert.equal(e.image[3], 1);
  assert.ok(Number.isNaN(e.image[1]) && Number.isNaN(e.image[2]));
  assert.equal(e.variance[0], 3);
});
