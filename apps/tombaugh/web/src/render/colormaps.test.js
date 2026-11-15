// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLORMAPS,
  COLORMAP_NAMES,
  applyColormap,
  colormapLut,
  STRETCHES,
  stretchValue,
  divergingValue,
  autoRange,
  displayRange,
  renderScalar,
  MASK_RGB,
  MASK_RGB_LIGHT,
  isLightMap,
  maskColorFor,
} from './colormaps.js';

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('contract colormaps exist, plus inverted gray', () => {
  for (const name of ['gray', 'heat', 'viridis', 'diverging', 'grayinv']) {
    assert.equal(typeof COLORMAPS[name], 'function', name);
    assert.equal(COLORMAPS[name].id, name);
    assert.ok(COLORMAPS[name].label.length > 0);
    assert.ok(COLORMAP_NAMES.includes(name));
  }
  assert.equal(COLORMAPS.diverging.diverging, true);
  assert.equal(COLORMAPS.gray.diverging, false);
});

test('applyColormap returns integer rgb triples in range for any input', () => {
  for (const name of [...COLORMAP_NAMES, 'no-such-map']) {
    for (const t of [-1, 0, 0.001, 0.25, 0.5, 0.75, 0.999, 1, 2, NaN, Infinity, -Infinity]) {
      const c = applyColormap(name, t);
      assert.equal(c.length, 3);
      for (const ch of c) assert.ok(Number.isInteger(ch) && ch >= 0 && ch <= 255, `${name} ${t} ${c}`);
    }
  }
  assert.deepEqual(applyColormap('no-such-map', 1), [255, 255, 255]);
  assert.deepEqual(applyColormap('gray', NaN), [0, 0, 0]);
  assert.deepEqual(applyColormap('gray', -3), applyColormap('gray', 0));
  assert.deepEqual(applyColormap('gray', 3), applyColormap('gray', 1));
});

test('gray is linear and neutral; inverted gray is its mirror', () => {
  assert.deepEqual(applyColormap('gray', 0), [0, 0, 0]);
  assert.deepEqual(applyColormap('gray', 1), [255, 255, 255]);
  assert.deepEqual(applyColormap('gray', 0.5), [128, 128, 128]);
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const [r, g, b] = applyColormap('gray', t);
    assert.ok(r === g && g === b);
    close(applyColormap('grayinv', t)[0], applyColormap('gray', 1 - t)[0], 1);
  }
});

test('sequential maps get monotonically brighter', () => {
  for (const name of ['gray', 'heat', 'viridis']) {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const l = luma(applyColormap(name, i / 100));
      assert.ok(l >= prev - 0.5, `${name} at ${i}: ${l} < ${prev}`);
      prev = l;
    }
    assert.ok(luma(applyColormap(name, 1)) - luma(applyColormap(name, 0)) > 150, name);
  }
  assert.deepEqual(applyColormap('heat', 0), [0, 0, 0]);
  assert.deepEqual(applyColormap('viridis', 0), [68, 1, 84]);
  assert.deepEqual(applyColormap('viridis', 1), [253, 231, 37]);
});

test('diverging map: black at zero, blue below, red above, brighter outwards', () => {
  const mid = applyColormap('diverging', 0.5);
  assert.ok(luma(mid) < 12, 'centre is near black');
  const neg = applyColormap('diverging', 0.2);
  const pos = applyColormap('diverging', 0.8);
  assert.ok(neg[2] > neg[0] + 60, 'negative side is blue');
  assert.ok(pos[0] > pos[2] + 60, 'positive side is red');
  let prev = -1;
  for (let i = 50; i <= 100; i++) {
    const l = luma(applyColormap('diverging', i / 100));
    assert.ok(l >= prev - 0.5);
    prev = l;
  }
  prev = -1;
  for (let i = 50; i >= 0; i--) {
    const l = luma(applyColormap('diverging', i / 100));
    assert.ok(l >= prev - 0.5);
    prev = l;
  }
});

test('lookup tables match applyColormap and are cached', () => {
  const lut = colormapLut('viridis', 256);
  assert.equal(lut.length, 768);
  assert.equal(colormapLut('viridis', 256), lut);
  for (const i of [0, 1, 77, 128, 254, 255]) {
    assert.deepEqual(Array.from(lut.subarray(i * 3, i * 3 + 3)), applyColormap('viridis', i / 255));
  }
  assert.deepEqual(Array.from(colormapLut('nope', 2)), [0, 0, 0, 255, 255, 255]);
});

test('stretches: endpoints, clamping, monotonic, and their shapes', () => {
  assert.deepEqual(STRETCHES, ['linear', 'asinh', 'log', 'sqrt']);
  for (const mode of STRETCHES) {
    assert.equal(stretchValue(2, 2, 10, mode), 0, mode);
    close(stretchValue(10, 2, 10, mode), 1, 1e-12);
    assert.equal(stretchValue(-50, 2, 10, mode), 0);
    close(stretchValue(500, 2, 10, mode), 1, 1e-12);
    assert.equal(stretchValue(NaN, 2, 10, mode), 0);
    let prev = -1;
    for (let i = 0; i <= 50; i++) {
      const t = stretchValue(2 + (8 * i) / 50, 2, 10, mode);
      assert.ok(t >= prev && t >= 0 && t <= 1, mode);
      prev = t;
    }
  }
  close(stretchValue(6, 2, 10, 'linear'), 0.5, 1e-12);
  close(stretchValue(4, 2, 10, 'sqrt'), 0.5, 1e-12);
  close(stretchValue(6, 2, 10, 'asinh'), Math.asinh(5) / Math.asinh(10), 1e-12);
  close(stretchValue(6, 2, 10, 'log'), Math.log(501) / Math.log(1001), 1e-12);
  // the non-linear stretches lift faint values
  for (const mode of ['asinh', 'log', 'sqrt']) assert.ok(stretchValue(3, 2, 10, mode) > 0.125);
  // unknown mode behaves as linear; degenerate range does not divide by zero
  close(stretchValue(6, 2, 10, 'whatever'), 0.5, 1e-12);
  assert.equal(stretchValue(5, 5, 5, 'linear'), 0);
  assert.equal(stretchValue(6, 5, 5, 'linear'), 1);
});

test('diverging stretch is antisymmetric about zero', () => {
  for (const mode of STRETCHES) {
    assert.equal(divergingValue(0, 3, mode), 0.5);
    close(divergingValue(3, 3, mode), 1, 1e-12);
    close(divergingValue(-3, 3, mode), 0, 1e-12);
    close(divergingValue(99, 3, mode), 1, 1e-12);
    for (const v of [0.1, 0.7, 2.2]) {
      close(divergingValue(v, 3, mode) + divergingValue(-v, 3, mode), 1, 1e-12);
      assert.ok(divergingValue(v, 3, mode) > 0.5);
    }
  }
  assert.equal(divergingValue(NaN, 3), 0.5);
  assert.equal(divergingValue(1, 0), 0.5);
});

test('autoRange ignores masked and non-finite pixels', () => {
  const n = 1000;
  const img = new Float32Array(n);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) img[i] = i / (n - 1); // 0..1
  img[10] = NaN;
  img[11] = Infinity;
  img[12] = -Infinity;
  img[500] = 1e9; mask[500] = 1; // masked outlier
  const [a, b] = autoRange(img, mask, { lo: 0, hi: 100 });
  close(a, 0, 1e-6);
  close(b, 1, 1e-6);
  const [lo, hi] = autoRange(img, mask);
  assert.ok(lo > 0 && lo < 0.02 && hi > 0.98 && hi < 1);
  // degenerate inputs still give a usable range
  assert.deepEqual(autoRange(new Float32Array(0), null), [0, 1]);
  assert.deepEqual(autoRange(new Float32Array([NaN, NaN]), null), [0, 1]);
  const flat = autoRange(new Float32Array([3, 3, 3]), null);
  assert.ok(flat[1] > flat[0] && flat[0] < 3 && flat[1] > 3);
  const all = autoRange(new Float32Array([1, 2]), new Uint8Array([1, 1]));
  assert.deepEqual(all, [0, 1]);
  // diverging: symmetric
  const d = autoRange(new Float32Array([-4, -1, 0, 1, 2]), null, { diverging: true, hi: 100 });
  assert.deepEqual(d, [-4, 4]);
});

test('displayRange', () => {
  assert.deepEqual(displayRange([1, 5], false), [1, 5]);
  assert.deepEqual(displayRange([5, 1], false), [1, 5]);
  assert.deepEqual(displayRange([-2, 5], true), [-5, 5]);
  assert.deepEqual(displayRange([-7, 5], true), [-7, 7]);
  assert.deepEqual(displayRange(undefined, false), [0, 1]);
  assert.deepEqual(displayRange([NaN, 1], true), [-1, 1]);
  const r = displayRange([2, 2], false);
  assert.ok(r[1] > r[0]);
});

test('renderScalar: north up (row 0 at the bottom), opaque, correct colours', () => {
  const n = 3;
  // value = row index, so row 0 (south) is darkest
  const image = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  const rgba = renderScalar({ image, n, range: [0, 2] });
  assert.equal(rgba.length, n * n * 4);
  const px = (col, row) => Array.from(rgba.subarray((row * n + col) * 4, (row * n + col) * 4 + 4));
  assert.deepEqual(px(0, 0), [255, 255, 255, 255], 'top output row is the northern (last) array row');
  assert.deepEqual(px(1, 1), [128, 128, 128, 255]);
  assert.deepEqual(px(2, 2), [0, 0, 0, 255], 'bottom output row is array row 0');
  const raw = renderScalar({ image, n, range: [0, 2], flipY: false });
  assert.deepEqual(Array.from(raw.subarray(0, 4)), [0, 0, 0, 255]);
});

test('renderScalar keeps x order: column 0 (east) stays at the left', () => {
  const n = 2;
  const image = new Float32Array([0, 1, 0, 1]);
  const rgba = renderScalar({ image, n, range: [0, 1] });
  assert.deepEqual(Array.from(rgba.subarray(0, 4)), [0, 0, 0, 255]);
  assert.deepEqual(Array.from(rgba.subarray(4, 8)), [255, 255, 255, 255]);
});

test('renderScalar never draws masked or non-finite pixels as data', () => {
  const n = 2;
  const image = new Float32Array([5, NaN, Infinity, 1]);
  const mask = new Uint8Array([1, 0, 0, 0]);
  const missing = new Uint8Array(4).fill(9);
  const rgba = renderScalar({ image, mask, n, range: [0, 1], colormap: 'heat', missing });
  const px = (i) => Array.from(rgba.subarray(i * 4, i * 4 + 4));
  const maskPx = [...MASK_RGB, 255];
  // output order: top row = array row 1 = [Infinity, 1]; bottom row = array row 0 = [masked 5, NaN]
  assert.deepEqual(px(0), maskPx);
  assert.deepEqual(px(1), [...applyColormap('heat', 1), 255]);
  assert.deepEqual(px(2), maskPx);
  assert.deepEqual(px(3), maskPx);
  assert.deepEqual(Array.from(missing), [1, 0, 1, 1]);
  // the mask colour is not a colour any map produces at its dark end
  for (const name of COLORMAP_NAMES) assert.notDeepEqual(applyColormap(name, 0), MASK_RGB);
});

test('missing pixels stay distinct from data on light maps too', () => {
  assert.equal(isLightMap('grayinv'), true);
  for (const name of ['gray', 'heat', 'viridis', 'diverging']) assert.equal(isLightMap(name), false, name);
  assert.deepEqual(maskColorFor('grayinv'), MASK_RGB_LIGHT);
  assert.deepEqual(maskColorFor('gray'), MASK_RGB);
  const rgba = renderScalar({ image: new Float32Array([NaN]), n: 1, range: [0, 1], colormap: 'grayinv' });
  assert.deepEqual(Array.from(rgba), [...MASK_RGB_LIGHT, 255]);
  // not a neutral gray, so it cannot be mistaken for a value on the inverted map
  assert.ok(MASK_RGB_LIGHT[0] - MASK_RGB_LIGHT[2] >= 12);
  const custom = renderScalar({ image: new Float32Array([NaN]), n: 1, range: [0, 1], maskRgb: [1, 2, 3] });
  assert.deepEqual(Array.from(custom), [1, 2, 3, 255]);
});

test('renderScalar diverging: zero is black, sign picks the hue, range is symmetric', () => {
  const n = 2;
  const image = new Float32Array([-2, 0, 2, 0.5]);
  const rgba = renderScalar({ image, n, range: [-1, 2], colormap: 'diverging', diverging: true, flipY: false });
  const px = (i) => Array.from(rgba.subarray(i * 4, i * 4 + 3));
  assert.deepEqual(px(0), applyColormap('diverging', 0));
  assert.ok(luma(px(1)) < 12);
  assert.deepEqual(px(2), applyColormap('diverging', 1));
  assert.ok(px(3)[0] > px(3)[2], 'positive residual is red');
});

test('renderScalar reuses the output buffer and tolerates short or missing input', () => {
  const n = 4;
  const out = new Uint8ClampedArray(n * n * 4);
  const image = new Float32Array(n * n).fill(0.5);
  assert.equal(renderScalar({ image, n, range: [0, 1], out }), out);
  const bad = renderScalar({ image: new Float32Array(3), n, range: [0, 1] });
  assert.deepEqual(Array.from(bad.subarray(0, 4)), [...MASK_RGB, 255]);
  const none = renderScalar({ image: null, n, range: [0, 1] });
  assert.deepEqual(Array.from(none.subarray(60, 64)), [...MASK_RGB, 255]);
});

test('renderScalar is fast enough for 20 frames per second at 200 x 200', () => {
  const n = 200;
  const image = new Float32Array(n * n);
  for (let i = 0; i < image.length; i++) image[i] = Math.sin(i * 0.37) * 3 + 3;
  const out = new Uint8ClampedArray(n * n * 4);
  renderScalar({ image, n, range: [0, 6], stretch: 'asinh', colormap: 'viridis', out });
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) renderScalar({ image, n, range: [0, 6], stretch: 'asinh', colormap: 'viridis', out });
  const per = (performance.now() - t0) / 20;
  assert.ok(per < 25, `renderScalar took ${per.toFixed(2)} ms per frame`);
});
