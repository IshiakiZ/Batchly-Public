// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, lensNeeds, lensImage, rgbComposite } from './lenses.js';
import { DETECTORS } from './frames.js';

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

const N = 24;
const NOISE = 0.02;

/**
 * Layers of one detector: `count` exposures spread over the detector's wavelength range, with
 * a strong wavelength gradient across the grid (4% from bottom to top) so that one exposure
 * is inside a band for some pixels and outside it for others. sources: [{ x, y, spectrum(w) }].
 */
function detLayers(det, sources, { count = 60, seed = 1, noise = NOISE } = {}) {
  const r = rng(seed + det);
  const d = DETECTORS[det - 1];
  const layers = [];
  for (let k = 0; k < count; k++) {
    const f = ((k + 0.5) * 0.61803398875) % 1;
    const w0 = d.min * Math.pow(d.max / d.min, f);
    const image = new Float32Array(N * N);
    const wave = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const w = w0 * (1 + 0.04 * (y - N / 2) / N);
        wave[i] = w;
        let v = 0;
        for (const s of sources) {
          const d2 = (x - s.x) ** 2 + (y - s.y) ** 2;
          if (d2 < 50) v += s.spectrum(w) * Math.exp(-d2 / (2 * 1.1 * 1.1));
        }
        image[i] = v + noise * r.g();
      }
    }
    layers.push({
      frame: null, det, mjd: 60830 + k * 0.1, image, wave,
      variance: new Float32Array(N * N).fill(noise * noise), mask: new Uint8Array(N * N),
    });
  }
  return layers;
}

const powerLaw = (amp, alpha) => (w) => amp * Math.pow(w / 3.3, alpha);
const inBand = (w, [lo, hi]) => w >= lo && w < hi;

test('LENSES: the documented bands, each covered by its detectors', () => {
  const ids = LENSES.map((l) => l.id);
  for (const id of ['methane', 'cold', 'water', 'co2', 'co', 'rgb']) assert.ok(ids.includes(id), `lens ${id}`);
  assert.equal(new Set(ids).size, ids.length);
  const get = (id) => LENSES.find((l) => l.id === id);
  assert.deepEqual(get('methane').band, [3.15, 3.45]);
  assert.deepEqual(get('methane').continuum, [[2.9, 3.05], [3.6, 3.8]]);
  assert.deepEqual(get('cold').band, [4.5, 4.8]);
  assert.deepEqual(get('cold').continuum, [[3.2, 3.5]]);
  assert.deepEqual(get('water').band, [2.95, 3.15]);
  assert.deepEqual(get('water').continuum, [[2.6, 2.8], [3.5, 3.7]]);
  assert.deepEqual(get('co2').band, [4.20, 4.33]);
  assert.deepEqual(get('co2').continuum, [[4.05, 4.15], [4.38, 4.45]]);
  assert.deepEqual(get('co').band, [4.62, 4.72]);
  assert.deepEqual(get('co').continuum, [[4.45, 4.55], [4.80, 4.90]]);
  for (const l of LENSES) {
    assert.ok(l.label && l.description, `${l.id} has a label and a description`);
    assert.ok(Array.isArray(l.band) && l.band[1] > l.band[0]);
    assert.ok(Array.isArray(l.continuum));
    // Every window is at least partly inside one of the listed detectors.
    for (const [lo, hi] of [l.band, ...l.continuum]) {
      assert.ok(l.dets.some((d) => hi > DETECTORS[d - 1].min && lo < DETECTORS[d - 1].max), `${l.id} window ${lo}-${hi}`);
    }
    if (l.kind === 'depth') {
      assert.ok(l.continuum.some(([, hi]) => hi <= l.band[0]) && l.continuum.some(([lo]) => lo >= l.band[1]), 'continuum on both sides');
    }
  }
});

test('lensNeeds: detectors to load, by lens or by id', () => {
  assert.deepEqual(lensNeeds('methane'), [4]);
  assert.deepEqual(lensNeeds('water'), [4]);
  assert.deepEqual(lensNeeds('cold'), [4, 6]);
  assert.deepEqual(lensNeeds('co2'), [5]);
  assert.deepEqual(lensNeeds('co'), [6]);
  assert.deepEqual(lensNeeds('rgb'), [2, 4, 6]);
  assert.deepEqual(lensNeeds(LENSES[0]), [4]);
  assert.deepEqual(lensNeeds('nope'), []);
  // A custom lens without `dets` gets them from its windows.
  assert.deepEqual(lensNeeds({ band: [2.3, 2.5], continuum: [[2.0, 2.1]] }), [3, 4]);
});

test('methane lens recovers an injected 3.3 um absorption depth within 0.1', () => {
  const band = LENSES.find((l) => l.id === 'methane').band;
  const sources = [
    // A cold object: 60% of the light missing in the band, on a sloped continuum.
    { x: 6, y: 6, spectrum: (w) => powerLaw(1.5, -1.5)(w) * (inBand(w, band) ? 0.4 : 1) },
    // The same absorber near the top of the grid, where every exposure is ~2% redder.
    { x: 17, y: 19, spectrum: (w) => powerLaw(1.0, 1.0)(w) * (inBand(w, band) ? 0.4 : 1) },
    // Ordinary stars with steep but smooth spectra: no absorption.
    { x: 17, y: 6, spectrum: powerLaw(1.5, -2.0) },
    { x: 6, y: 18, spectrum: powerLaw(1.2, 1.5) },
  ];
  const byDet = new Map([[4, detLayers(4, sources)], [3, detLayers(3, [])]]);
  const out = lensImage('methane', byDet);
  const at = (arr, x, y) => arr[y * N + x];
  assert.equal(out.image.length, N * N);
  assert.equal(out.mask.length, N * N);
  assert.ok(out.label.includes('Methane'));
  assert.equal(out.kind, 'depth');

  for (const [x, y] of [[6, 6], [17, 19]]) {
    assert.equal(at(out.mask, x, y), 0);
    assert.ok(Math.abs(at(out.image, x, y) - 0.6) < 0.1, `depth at absorber ${x},${y}: ${at(out.image, x, y)}`);
    assert.ok(at(out.sigma, x, y) < 0.05);
  }
  for (const [x, y] of [[17, 6], [6, 18]]) {
    assert.equal(at(out.mask, x, y), 0);
    assert.ok(Math.abs(at(out.image, x, y)) < 0.1, `depth at plain star ${x},${y}: ${at(out.image, x, y)}`);
  }
  // Blank sky has no continuum to compare with: masked, not a spurious depth.
  let masked = 0;
  for (let i = 0; i < N * N; i++) {
    if (out.mask[i]) { masked++; assert.ok(Number.isNaN(out.image[i])); }
  }
  assert.ok(masked > 0.6 * N * N, `${masked} of ${N * N} pixels masked`);
  assert.equal(at(out.mask, 12, 12), 1);
  assert.ok(at(out.band, 6, 6) > 0 && at(out.continuum, 6, 6) > at(out.band, 6, 6));

  // A plain object keyed by detector works as well as a Map, and the lens object as well as its id.
  const again = lensImage(LENSES.find((l) => l.id === 'methane'), { 4: byDet.get(4) });
  assert.ok(Math.abs(at(again.image, 6, 6) - at(out.image, 6, 6)) < 1e-6);
  // Other lenses on the same data see nothing at the methane absorber's neighbour.
  const water = lensImage('water', byDet);
  assert.ok(Math.abs(at(water.image, 17, 6)) < 0.1);
});

test('a source that brightened between passes does not fake an absorption', () => {
  const lens = LENSES.find((l) => l.id === 'methane');
  // Flat spectrum, no feature; twice as bright in the second pass. In that pass most of the
  // exposures that fall in the band are missing, so a plain average over all exposures would
  // weigh the band towards the faint epoch and the continuum towards the bright one.
  const flat = (amp) => [{ x: 12, y: 12, spectrum: () => amp }];
  const pass1 = detLayers(4, flat(1.0), { seed: 11 });
  const pass2 = detLayers(4, flat(2.0), { seed: 12 })
    .filter((layer, k) => !inBand(layer.wave[12 * N + 12], lens.band) || k % 5 === 0)
    .map((layer) => ({ ...layer, mjd: layer.mjd + 182 }));
  const i = 12 * N + 12;

  const out = lensImage('methane', new Map([[4, [...pass1, ...pass2]]]));
  assert.equal(out.mask[i], 0);
  assert.ok(Math.abs(out.image[i]) < 0.05, `depth of a featureless variable source: ${out.image[i]}`);
  assert.ok(out.sigma[i] > 0 && out.sigma[i] < 0.05);

  // The same exposures without their times cannot be told apart and are pooled: the bias this
  // lens avoids is then visible, which shows that the check above is not trivially satisfied.
  const undated = [...pass1, ...pass2].map((layer) => ({ ...layer, mjd: NaN }));
  const pooled = lensImage('methane', new Map([[4, undated]]));
  assert.ok(pooled.image[i] > 0.1, `pooled depth ${pooled.image[i]}`);
});

test('lensImage selects samples per pixel and respects masks', () => {
  const band = [3.15, 3.45];
  const src = { x: 12, y: 12, spectrum: (w) => (inBand(w, band) ? 0.5 : 1) };
  const layers = detLayers(4, [src], { noise: 0.002 });
  // Poison every in-band sample of the source's pixel in half of the layers, under the mask.
  const i = 12 * N + 12;
  layers.forEach((l, k) => { if (k % 2) { l.image[i] = 1000; l.mask[i] = 1; } });
  const out = lensImage('methane', new Map([[4, layers]]));
  assert.ok(Math.abs(out.image[i] - 0.5) < 0.03, `depth ${out.image[i]}`);
  // Missing detector or no layers: everything masked, nothing thrown.
  const empty = lensImage('methane', new Map());
  assert.equal(empty.image.length, 0);
  const none = lensImage('co', new Map([[6, detLayers(6, [], { count: 3 })]]));
  assert.ok(none.mask.every((m) => m === 1));
  assert.equal(lensImage('unknown-lens', new Map()).label, '');
});

test('cold lens: bright at 4.6 um, faint at 3.3 um', () => {
  const sources = [
    // Methane dwarf: ten times brighter at 4.6 um than at 3.3 um.
    { x: 7, y: 7, spectrum: (w) => (w > 4 ? 1.0 : 0.1) },
    // So cold that nothing is detected at 3.3 um at all.
    { x: 16, y: 7, spectrum: (w) => (w > 4 ? 0.5 : 0) },
    // An ordinary star: flat.
    { x: 12, y: 17, spectrum: () => 1.0 },
  ];
  const byDet = new Map([[4, detLayers(4, sources)], [6, detLayers(6, sources)]]);
  const out = lensImage('cold', byDet);
  const at = (arr, x, y) => arr[y * N + x];
  assert.equal(out.kind, 'ratio');
  assert.ok(Math.abs(at(out.image, 7, 7) - 10) < 1.5, `dwarf ratio ${at(out.image, 7, 7)}`);
  assert.equal(at(out.limit, 7, 7), 0);
  assert.ok(Math.abs(at(out.image, 12, 17) - 1) < 0.1, `plain star ratio ${at(out.image, 12, 17)}`);
  // Undetected at 3.3 um: not masked, reported as a lower limit well above 1.
  assert.equal(at(out.mask, 16, 7), 0);
  assert.equal(at(out.limit, 16, 7), 1);
  assert.ok(at(out.image, 16, 7) > 10, `lower limit ${at(out.image, 16, 7)}`);
  assert.equal(at(out.mask, 2, 20), 1, 'blank sky is masked');
});

test('rgbComposite: asinh stretch, ranges, missing pixels, colour preservation', () => {
  const r = Float32Array.from([0, 1, 0.5, NaN, 8, 4]);
  const g = Float32Array.from([0, 1, 0.5, 1, 4, 4]);
  const b = Float32Array.from([0, 1, 0.5, 1, 2, 4]);
  const ranges = [[0, 1], [0, 1], [0, 1]];
  const out = rgbComposite(r, g, b, ranges);
  assert.ok(out instanceof Uint8ClampedArray);
  assert.equal(out.length, 24);
  assert.deepEqual([...out.slice(0, 4)], [0, 0, 0, 255], 'at the minimum: black, opaque');
  assert.deepEqual([...out.slice(4, 8)], [255, 255, 255, 255], 'at the maximum: white');
  const mid = out[8];
  assert.ok(mid > 128 && mid < 255, `asinh lifts the midtones: ${mid}`);
  assert.equal(out[9], mid);
  assert.deepEqual([...out.slice(12, 16)], [0, 255, 255, 255], 'a missing channel is black in that channel');
  // Above the range each channel saturates on its own: colour is lost...
  assert.deepEqual([...out.slice(16, 19)], [255, 255, 255]);
  // ...unless colour preservation is on: the 4:2:1 ratio survives.
  const lup = rgbComposite(r, g, b, ranges, { preserveColor: true });
  assert.equal(lup[16], 255);
  assert.ok(Math.abs(lup[17] - 127.5) <= 1 && Math.abs(lup[18] - 63.75) <= 1, `preserved ${[...lup.slice(16, 19)]}`);
  assert.deepEqual([...lup.slice(20, 23)], [255, 255, 255], 'equal channels stay neutral');
  assert.deepEqual([...lup.slice(0, 3)], [0, 0, 0]);

  // Ranges as an object, masks from { image, mask } inputs, and automatic ranges.
  const obj = rgbComposite({ image: r, mask: Uint8Array.from([0, 1, 0, 0, 0, 0]) }, g, b, { r: [0, 1], g: [0, 1], b: [0, 1] });
  assert.deepEqual([...obj.slice(4, 8)], [0, 255, 255, 255]);
  const auto = rgbComposite(g, g, g);
  assert.equal(auto.length, 24);
  assert.ok(auto[0] === 0 && auto[16] === 255 && auto[3] === 255);
  // A larger Q brings up faint detail.
  const soft = rgbComposite(r, g, b, ranges, { Q: 2 });
  const hard = rgbComposite(r, g, b, ranges, { Q: 50 });
  assert.ok(hard[8] > mid && mid > soft[8]);
});

test('rgb lens: three detector stacks into one colour image', () => {
  const red = { x: 6, y: 12, spectrum: (w) => (w > 4 ? 2 : w > 2 ? 0.5 : 0.1) };
  const blue = { x: 17, y: 12, spectrum: (w) => (w > 4 ? 0.1 : w > 2 ? 0.5 : 2) };
  const byDet = new Map([2, 4, 6].map((d) => [d, detLayers(d, [red, blue], { count: 12 })]));
  const out = lensImage('rgb', byDet);
  assert.equal(out.kind, 'rgb');
  assert.equal(out.image.length, N * N);
  assert.equal(out.rgba.length, N * N * 4);
  assert.ok(out.label.includes('D6') && out.label.includes('D2'));
  const px = (x, y) => [...out.rgba.slice((y * N + x) * 4, (y * N + x) * 4 + 3)];
  const [rr, , rb] = px(6, 12);
  const [br, , bb] = px(17, 12);
  assert.ok(rr > 200 && rb < 120, `red source ${px(6, 12)}`);
  assert.ok(bb > 200 && br < 120, `blue source ${px(17, 12)}`);
  assert.equal(out.mask[12 * N + 6], 0);
  // With a detector missing the image is still produced, that channel is just dark.
  const partial = lensImage('rgb', new Map([[2, byDet.get(2)], [4, byDet.get(4)]]));
  assert.equal(partial.rgba.length, N * N * 4);
  assert.equal(partial.rgba[(12 * N + 6) * 4], 0);
});
