// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests for quantize.js: palette building (exact, grayscale ramp, median cut), nearest-colour
// mapping with its cache, Floyd-Steinberg dithering and the shared movie palette.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPaletteBuilder, buildPalette, createMapper, mapPixels, quantizeFrames } from './quantize.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgbaOf(colours) {
  const out = new Uint8ClampedArray(colours.length * 4);
  colours.forEach((c, i) => out.set([c[0], c[1], c[2], c[3] === undefined ? 255 : c[3]], i * 4));
  return out;
}

function randomRgba(count, rand) {
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    out[i * 4] = Math.floor(rand() * 256);
    out[i * 4 + 1] = Math.floor(rand() * 256);
    out[i * 4 + 2] = Math.floor(rand() * 256);
    out[i * 4 + 3] = 255;
  }
  return out;
}

function paletteColours(palette) {
  const out = [];
  for (let i = 0; i < palette.length; i += 3) out.push([palette[i], palette[i + 1], palette[i + 2]]);
  return out;
}

function bruteNearest(palette, r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length / 3; i++) {
    const d = (r - palette[i * 3]) ** 2 + (g - palette[i * 3 + 1]) ** 2 + (b - palette[i * 3 + 2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, d: bestD };
}

function rmsError(rgba, indices, palette) {
  let sum = 0;
  for (let i = 0; i < indices.length; i++) {
    const p = indices[i] * 3;
    sum += (rgba[i * 4] - palette[p]) ** 2 + (rgba[i * 4 + 1] - palette[p + 1]) ** 2 + (rgba[i * 4 + 2] - palette[p + 2]) ** 2;
  }
  return Math.sqrt(sum / indices.length);
}

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// ---------------------------------------------------------------------------------------------
// Palette

test('few colours: the palette is exactly those colours, dark to light', () => {
  const colours = [[247, 242, 231], [23, 23, 21], [229, 60, 39], [119, 118, 110], [23, 23, 21], [229, 60, 39]];
  const palette = buildPalette(rgbaOf(colours), 128);
  assert.equal(palette.length, 12);
  assert.deepEqual(paletteColours(palette), [[23, 23, 21], [229, 60, 39], [119, 118, 110], [247, 242, 231]]);
  const lum = paletteColours(palette).map(luma);
  for (let i = 1; i < lum.length; i++) assert.ok(lum[i] >= lum[i - 1]);
});

test('exactly maxColors distinct colours are kept exactly; one more triggers reduction', () => {
  const rand = mulberry32(2);
  const distinct = new Map();
  while (distinct.size < 33) {
    const c = [Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)];
    distinct.set(c.join(','), c);
  }
  const all = [...distinct.values()];
  const p32 = buildPalette(rgbaOf(all.slice(0, 32)), 32);
  assert.equal(p32.length / 3, 32);
  const want = new Set(all.slice(0, 32).map((c) => c.join(',')));
  for (const c of paletteColours(p32)) assert.ok(want.has(c.join(',')));
  const p33 = buildPalette(rgbaOf(all), 32);
  assert.equal(p33.length / 3, 32);
});

test('maxColors is clamped to 2..256 and never exceeded', () => {
  const rand = mulberry32(3);
  const rgba = randomRgba(5000, rand);
  for (const [asked, most] of [[0, 2], [1, 2], [2, 2], [7, 7], [16, 16], [128, 128], [256, 256], [1000, 256], [NaN, 128], [undefined, 128]]) {
    const palette = buildPalette(rgba, asked);
    assert.equal(palette.length % 3, 0);
    assert.ok(palette.length / 3 <= most, `asked ${asked}: got ${palette.length / 3}`);
    assert.ok(palette.length / 3 >= 2);
  }
  assert.equal(buildPalette(rgba, 16).length / 3, 16, 'uses the whole budget on a rich image');
});

test('empty input gives a one-colour palette instead of throwing', () => {
  assert.deepEqual([...buildPalette(new Uint8ClampedArray(0))], [0, 0, 0]);
  assert.deepEqual([...buildPalette([])], [0, 0, 0]);
  assert.deepEqual([...createPaletteBuilder().build(16)], [0, 0, 0]);
});

test('grayscale fast path: exact levels when they fit', () => {
  const levels = [0, 3, 17, 200, 255, 17, 17];
  const rgba = rgbaOf(levels.map((v) => [v, v, v]));
  const builder = createPaletteBuilder();
  builder.add(rgba);
  assert.equal(builder.isGray, true);
  assert.equal(builder.colours, 5);
  assert.equal(builder.pixels, 7);
  const palette = builder.build(128);
  assert.deepEqual([...palette], [0, 0, 0, 3, 3, 3, 17, 17, 17, 200, 200, 200, 255, 255, 255]);
});

test('grayscale fast path: an even ramp from darkest to brightest when there are too many levels', () => {
  const colours = [];
  for (let v = 10; v <= 240; v++) colours.push([v, v, v]);
  const rgba = rgbaOf(colours);
  const palette = buildPalette(rgba, 64);
  assert.equal(palette.length / 3, 64);
  assert.deepEqual([...palette.subarray(0, 3)], [10, 10, 10]);
  assert.deepEqual([...palette.subarray(63 * 3)], [240, 240, 240]);
  for (let i = 0; i < 64; i++) {
    assert.equal(palette[i * 3], palette[i * 3 + 1]);
    assert.equal(palette[i * 3], palette[i * 3 + 2]);
    if (i > 0) assert.ok(palette[i * 3] > palette[(i - 1) * 3], 'strictly increasing');
  }
  const mapper = createMapper(palette);
  assert.equal(mapper.isGray, true);
  const indices = mapPixels(rgba, colours.length, 1, mapper);
  let worst = 0;
  for (let i = 0; i < colours.length; i++) worst = Math.max(worst, Math.abs(palette[indices[i] * 3] - colours[i][0]));
  assert.ok(worst <= 2, `worst gray error ${worst} for a step of 3.65`);
  // 256 levels into 128: never more than one level off
  const full = rgbaOf(Array.from({ length: 256 }, (_, v) => [v, v, v]));
  const p128 = buildPalette(full, 128);
  const idx = mapPixels(full, 256, 1, p128);
  for (let v = 0; v < 256; v++) assert.ok(Math.abs(p128[idx[v] * 3] - v) <= 1);
});

test('one coloured pixel after many gray ones leaves the gray path and keeps what was counted', () => {
  const builder = createPaletteBuilder();
  builder.add(rgbaOf([[5, 5, 5], [5, 5, 5], [90, 90, 90]]));
  assert.equal(builder.isGray, true);
  builder.add(rgbaOf([[200, 200, 200], [229, 60, 39], [5, 5, 5]]));
  assert.equal(builder.isGray, false);
  assert.equal(builder.pixels, 6);
  assert.equal(builder.colours, 4);
  assert.deepEqual(paletteColours(builder.build(8)), [[5, 5, 5], [90, 90, 90], [229, 60, 39], [200, 200, 200]]);
});

test('median cut: a few bright star pixels are not swallowed by the dark sky', () => {
  // 10,000 sky pixels in a narrow, slightly tinted dark range and 12 pixels of one bright colour.
  const rand = mulberry32(8);
  const colours = [];
  for (let i = 0; i < 10000; i++) {
    const v = 20 + Math.floor(rand() * 40);
    colours.push([v, v, Math.min(255, v + Math.floor(rand() * 12))]);
  }
  for (let i = 0; i < 12; i++) colours.push([250, 240, 180]);
  const rgba = rgbaOf(colours);
  const palette = buildPalette(rgba, 8);
  assert.equal(palette.length / 3, 8);
  const near = bruteNearest(palette, 250, 240, 180);
  assert.ok(near.d <= 3, `bright colour should have its own entry, nearest is ${Math.sqrt(near.d).toFixed(1)} away`);
});

test('median cut: error falls as the palette grows', () => {
  const rand = mulberry32(13);
  // A smooth two-dimensional colour gradient plus noise.
  const w = 64;
  const h = 64;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      rgba.set([x * 4 + rand() * 3, y * 4 + rand() * 3, 255 - (x + y) * 2, 255], (y * w + x) * 4);
    }
  }
  let last = Infinity;
  const errors = [];
  for (const n of [2, 4, 8, 16, 32, 64, 128, 256]) {
    const palette = buildPalette(rgba, n);
    assert.ok(palette.length / 3 <= n);
    const err = rmsError(rgba, mapPixels(rgba, w, h, palette), palette);
    errors.push(err.toFixed(2));
    assert.ok(err < last, `rms error should fall: ${errors.join(', ')}`);
    last = err;
  }
  // The colours fill a 252 x 252 plane: 256 ideal square cells would be 15.75 wide, rms 6.4.
  assert.ok(last < 8, `256 colours: rms ${last.toFixed(2)}`);
});

test('median cut on random colours beats a uniform 3-3-2 palette', () => {
  const rand = mulberry32(21);
  const rgba = randomRgba(20000, rand);
  const palette = buildPalette(rgba, 256);
  const err = rmsError(rgba, mapPixels(rgba, 20000, 1, palette), palette);
  const uniform = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    uniform[i * 3] = Math.round((((i >> 5) & 7) * 255) / 7);
    uniform[i * 3 + 1] = Math.round((((i >> 2) & 7) * 255) / 7);
    uniform[i * 3 + 2] = Math.round(((i & 3) * 255) / 3);
  }
  const errUniform = rmsError(rgba, mapPixels(rgba, 20000, 1, uniform), uniform);
  assert.ok(err < errUniform, `median cut ${err.toFixed(2)} vs uniform ${errUniform.toFixed(2)}`);
});

test('a very large number of distinct colours is handled (coarser bins) without losing the budget', () => {
  const rand = mulberry32(34);
  const rgba = randomRgba(120000, rand); // far more distinct colours than the histogram keeps exactly
  const builder = createPaletteBuilder();
  builder.add(rgba);
  assert.equal(builder.pixels, 120000);
  assert.ok(builder.colours <= 49152);
  const palette = builder.build(64);
  assert.equal(palette.length / 3, 64);
  const err = rmsError(rgba, mapPixels(rgba, 120000, 1, palette), palette);
  assert.ok(err < 40, `rms ${err.toFixed(2)}`);
});

test('stride samples every n-th pixel', () => {
  const rgba = rgbaOf([[1, 2, 3], [9, 9, 9], [4, 5, 6], [9, 9, 9], [7, 8, 9], [9, 9, 9]]);
  const builder = createPaletteBuilder();
  builder.add(rgba, 2);
  assert.equal(builder.pixels, 3);
  assert.deepEqual(paletteColours(builder.build(8)), [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
});

test('alpha is ignored and inputs are not modified', () => {
  const rgba = rgbaOf([[10, 20, 30, 0], [10, 20, 30, 128], [200, 100, 50, 7]]);
  const copy = rgba.slice();
  const palette = buildPalette(rgba, 4);
  assert.deepEqual(paletteColours(palette), [[10, 20, 30], [200, 100, 50]]);
  mapPixels(rgba, 3, 1, palette, { dither: true });
  assert.deepEqual(rgba, copy);
});

test('palette building is deterministic', () => {
  const rgba = randomRgba(8000, mulberry32(55));
  assert.deepEqual(buildPalette(rgba, 32), buildPalette(rgba, 32));
});

// ---------------------------------------------------------------------------------------------
// Mapping

test('nearest: every pixel gets a true nearest palette entry (cache included)', () => {
  const rand = mulberry32(60);
  const palette = new Uint8Array(40 * 3);
  for (let i = 0; i < palette.length; i++) palette[i] = Math.floor(rand() * 256);
  const mapper = createMapper(palette);
  const rgba = randomRgba(30000, rand);
  // Repeat some colours so the cache is hit, and include gray pixels.
  for (let i = 0; i < 10000; i++) rgba.set(rgba.subarray((i % 50) * 4, (i % 50) * 4 + 4), (20000 + i) * 4);
  for (let i = 0; i < 300; i++) rgba.set([i % 256, i % 256, i % 256, 255], i * 4 * 7);
  const indices = mapPixels(rgba, 30000, 1, mapper);
  for (let i = 0; i < 30000; i++) {
    const want = bruteNearest(palette, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    const got = indices[i] * 3;
    const d = (rgba[i * 4] - palette[got]) ** 2 + (rgba[i * 4 + 1] - palette[got + 1]) ** 2 + (rgba[i * 4 + 2] - palette[got + 2]) ** 2;
    assert.equal(d, want.d, `pixel ${i}`);
    assert.equal(mapper.nearest(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]), indices[i]);
  }
});

test('palette colours map to themselves', () => {
  const rand = mulberry32(61);
  const rgba = randomRgba(100, rand);
  const palette = buildPalette(rgba, 256);
  const idx = mapPixels(rgba, 100, 1, palette);
  for (let i = 0; i < 100; i++) {
    assert.deepEqual([...palette.subarray(idx[i] * 3, idx[i] * 3 + 3)], [...rgba.subarray(i * 4, i * 4 + 3)]);
  }
});

test('mapPixels accepts a palette or a mapper, reuses an output buffer, checks its input', () => {
  const palette = new Uint8Array([0, 0, 0, 255, 255, 255]);
  const rgba = rgbaOf([[10, 10, 10], [250, 250, 250], [120, 120, 120], [140, 140, 140]]);
  assert.deepEqual([...mapPixels(rgba, 2, 2, palette)], [0, 1, 0, 1]);
  const out = new Uint8Array(4);
  assert.equal(mapPixels(rgba, 2, 2, createMapper(palette), { out }), out);
  assert.deepEqual([...out], [0, 1, 0, 1]);
  assert.throws(() => mapPixels(rgba, 3, 3, palette), /RGBA/);
  assert.throws(() => createMapper(new Uint8Array(4)), /Palette/);
  assert.throws(() => createMapper(null), /Palette/);
});

// ---------------------------------------------------------------------------------------------
// Dithering

test('Floyd-Steinberg keeps the mean brightness of a flat gray with a two-colour palette', () => {
  const palette = new Uint8Array([0, 0, 0, 255, 255, 255]);
  for (const level of [32, 64, 128, 200]) {
    const w = 64;
    const h = 64;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([level, level, level, 255], i * 4);
    const plain = mapPixels(rgba, w, h, palette);
    const flat = plain.every((v) => v === plain[0]);
    assert.ok(flat, 'without dithering a flat field maps to one colour');
    const dithered = mapPixels(rgba, w, h, palette, { dither: true });
    let white = 0;
    for (const v of dithered) white += v;
    const mean = (white / (w * h)) * 255;
    assert.ok(Math.abs(mean - level) < 4, `level ${level}: dithered mean ${mean.toFixed(1)}`);
  }
});

test('dithering leaves exactly representable pixels alone and reduces smooth-gradient error', () => {
  const palette = new Uint8Array([0, 0, 0, 85, 85, 85, 170, 170, 170, 255, 255, 255]);
  const exact = rgbaOf([[0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255], [85, 85, 85], [0, 0, 0]]);
  assert.deepEqual([...mapPixels(exact, 3, 2, palette, { dither: true })], [0, 1, 2, 3, 1, 0]);
  // Gradient: compare 8x8 block means against the original.
  const w = 128;
  const h = 32;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set([x * 2, x * 2, x * 2, 255], (y * w + x) * 4);
  const blockError = (indices) => {
    let sum = 0;
    let count = 0;
    for (let by = 0; by < h; by += 8) {
      for (let bx = 0; bx < w; bx += 8) {
        let a = 0;
        let b = 0;
        for (let y = by; y < by + 8; y++) {
          for (let x = bx; x < bx + 8; x++) {
            a += rgba[(y * w + x) * 4];
            b += palette[indices[y * w + x] * 3];
          }
        }
        sum += Math.abs(a - b) / 64;
        count++;
      }
    }
    return sum / count;
  };
  const plain = blockError(mapPixels(rgba, w, h, palette));
  const dith = blockError(mapPixels(rgba, w, h, palette, { dither: true }));
  assert.ok(dith < plain / 3, `block error ${dith.toFixed(2)} dithered vs ${plain.toFixed(2)} plain`);
});

// ---------------------------------------------------------------------------------------------
// Movie

test('quantizeFrames: one palette covers colours that appear only in a later frame', () => {
  const a = { data: rgbaOf([[10, 10, 10], [20, 20, 20], [10, 10, 10], [20, 20, 20]]), width: 2, height: 2 };
  const b = { data: rgbaOf([[10, 10, 10], [229, 60, 39], [229, 60, 39], [20, 20, 20]]), width: 2, height: 2 };
  const { palette, indexed } = quantizeFrames([a, b], { maxColors: 16 });
  assert.deepEqual(paletteColours(palette), [[10, 10, 10], [20, 20, 20], [229, 60, 39]]);
  assert.deepEqual([...indexed[0]], [0, 1, 0, 1]);
  assert.deepEqual([...indexed[1]], [0, 2, 2, 1]);
});

test('quantizeFrames: the same colour maps to the same index in every frame (no shimmer)', () => {
  const rand = mulberry32(70);
  const frames = [];
  const shared = randomRgba(200, rand);
  for (let f = 0; f < 4; f++) {
    const data = randomRgba(1000, rand);
    data.set(shared, 0);
    frames.push({ data, width: 50, height: 20 });
  }
  const { palette, indexed } = quantizeFrames(frames, { maxColors: 32 });
  assert.equal(palette.length / 3, 32);
  for (let f = 1; f < 4; f++) {
    for (let i = 0; i < 200; i++) assert.equal(indexed[f][i], indexed[0][i]);
  }
});
