// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The co-moving pipeline on synthetic native frames built right here: a body moving across a
// field of stars, with noise, a random roll and sub-pixel pointing per exposure. No FITS, no
// network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMOVING_NOTE,
  SOURCE_MASK,
  bandDepth,
  bodySpectrum,
  buildComovingLayers,
  centralSnr,
  comovingGrid,
  comovingLayer,
  comovingStacks,
  expectedStackFwhm,
  extendedness,
  groupComoving,
  movieFrames,
  radialProfile,
  stackComoving,
  singleExposureSnr,
  stackRange,
  starFixedStack,
  verdict,
} from './comoving.js';
import { makeWcs, gridPixToSky, gridSkyToPix } from '../../core/wcs.js';
import { dateRangeLabel } from './track.js';

const DEG = Math.PI / 180;
const PIX = 6.15;
const UJY = 889; // microJy per MJy/sr per native pixel

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

function gaussian(rand) {
  let u = 0;
  while (u < 1e-12) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x < 0 ? -y : y;
}

/** Offset a sky position by (east, north) arcsec (small-field, good to far below a pixel here). */
function offset(ra, dec, eastArcsec, northArcsec) {
  const d = dec + northArcsec / 3600;
  return { ra: ra + eastArcsec / 3600 / Math.cos(dec * DEG), dec: d };
}

/**
 * One synthetic native frame, cut out around `center` (where the proxy was asked to centre it).
 * sources: [{ ra, dec, flux_uJy, fwhm? }] rendered as pixel-integrated Gaussians.
 */
function makeFrame({ id, mjd, det = 3, wave = 2.0, center, sources, rand, nx = 45, noise = 0.02, zodi = 0.3, psfFwhm = 7.46, roll, bgOffset = 0 }) {
  const ny = nx;
  const theta = (roll === undefined ? rand() * 360 : roll) * DEG;
  const s = PIX / 3600;
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  // The cutout centre lands within half a pixel of the array centre, as in real cutouts.
  const crpix = [(nx + 1) / 2 + (rand() - 0.5), (ny + 1) / 2 + (rand() - 0.5)];
  const wcs = { crpix, crval: [center.ra, center.dec], pc: [[-s * c, -s * sn], [-s * sn, s * c]], cdelt: [1, 1], sip: null };
  const w = makeWcs(wcs);
  const image = new Float32Array(nx * ny);
  const variance = new Float32Array(nx * ny).fill(noise * noise);
  const zodiArr = new Float32Array(nx * ny).fill(zodi);
  const flags = new Int32Array(nx * ny);
  const waveArr = new Float32Array(nx * ny).fill(wave);
  for (let i = 0; i < image.length; i++) image[i] = zodi + bgOffset + noise * gaussian(rand);
  for (const src of sources) {
    const [x, y] = w.skyToPix(src.ra, src.dec);
    if (!Number.isFinite(x) || x < -8 || y < -8 || x > nx + 8 || y > ny + 8) continue;
    const sigma = ((src.fwhm || psfFwhm) / PIX) / 2.3548;
    const a = 1 / (Math.SQRT2 * sigma);
    const R = Math.ceil(5 * sigma) + 1;
    for (let py = Math.max(0, Math.round(y) - R); py <= Math.min(ny - 1, Math.round(y) + R); py++) {
      const fy = 0.5 * (erf((py + 0.5 - y) * a) - erf((py - 0.5 - y) * a));
      for (let px = Math.max(0, Math.round(x) - R); px <= Math.min(nx - 1, Math.round(x) + R); px++) {
        const fx = 0.5 * (erf((px + 0.5 - x) * a) - erf((px - 0.5 - x) * a));
        image[py * nx + px] += (src.flux_uJy / UJY) * fx * fy;
      }
    }
  }
  return {
    id: id || `syn-${mjd}`, det, nx, ny, mjd, exptime: 113.58, release: 'syn', obsid: `syn_${mjd}`,
    wcs, image, variance, zodi: zodiArr, flags, wave: waveArr, waveCenter: wave, bwCenter: wave / 41, psfFwhm,
  };
}

/**
 * A visit: `count` exposures `stepDays` apart of a body that moves at a constant rate across a
 * fixed star field. Returns { items: [{ frame, ra, dec }], stars, bodyAt }.
 */
function makeVisit({ seed = 1, count = 16, start = 60900, stepDays = 0.1, rate = 12, paDeg = 250, bodyFlux = 300, bodyFwhm, stars = null, nStars = 14, starFlux = 4000, noise = 0.02, det = 3, waveOf = null, fluxOf = null, nx = 45 }) {
  const rand = mulberry32(seed);
  const ra0 = 305.2;
  const dec0 = -23.4;
  const bodyAt = (mjd) => {
    const hours = (mjd - start) * 24;
    return offset(ra0, dec0, rate * hours * Math.sin(paDeg * DEG), rate * hours * Math.cos(paDeg * DEG));
  };
  const field = stars || Array.from({ length: nStars }, () => {
    const p = offset(ra0, dec0, (rand() - 0.5) * 700 - 150, (rand() - 0.5) * 400);
    return { ...p, flux_uJy: starFlux * (0.3 + rand()) };
  });
  const items = [];
  for (let i = 0; i < count; i++) {
    const mjd = start + i * stepDays;
    const pos = bodyAt(mjd);
    const wave = waveOf ? waveOf(i, rand) : 1.7 + 0.6 * rand();
    const flux = fluxOf ? fluxOf(wave) : bodyFlux;
    const frame = makeFrame({
      id: `syn-${seed}-${i}`, mjd, det: typeof det === 'function' ? det(i) : det, wave, center: pos, rand, nx, noise,
      sources: [{ ...pos, flux_uJy: flux, fwhm: bodyFwhm }, ...field],
      bgOffset: 0.02 * (rand() - 0.5),
    });
    items.push({ frame, ra: pos.ra, dec: pos.dec });
  }
  return { items, stars: field, bodyAt };
}

function centreOf(layers) {
  const n = Math.round(Math.sqrt(layers[0].image.length));
  return { n, c: (n - 1) / 2 };
}

/**
 * Largest value between `rArcsec` and `rOuterArcsec` from the centre, in units of the image's
 * robust sigma. The outer limit keeps to the part every exposure covers whatever its roll (the
 * corners of the grid have few samples, hence more noise and nothing to clip against).
 */
function maxOffCentre(stack, n, scale, rArcsec, rOuterArcsec = 105) {
  const vals = [];
  let max = -Infinity;
  const c = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const d = Math.hypot(x - c, y - c) * scale;
      if (stack.mask[i] || d > rOuterArcsec) continue;
      const v = stack.image[i];
      vals.push(v);
      if (d > rArcsec && v > max) max = v;
    }
  }
  vals.sort((a, b) => a - b);
  const med = vals[vals.length >> 1];
  const dev = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const sigma = 1.4826 * dev[dev.length >> 1];
  return { max, sigma, z: (max - med) / sigma };
}

// ---------------------------------------------------------------------------------------------

test('the common grid is body-centred offsets, not sky', () => {
  const g = comovingGrid();
  assert.deepEqual(g, { ra0: 0, dec0: 0, n: 79, scale: 3.075, comoving: true });
  assert.equal(comovingGrid(4, 3.075, 64).n, 64);
  assert.equal(comovingGrid(2).n, 40);
  // A pixel 10 to the left of centre is 30.75 arcsec EAST of the body; 4 up is 12.3 arcsec north.
  const [ra, dec] = gridPixToSky(g, 39 - 10, 39 + 4);
  assert.ok(Math.abs(ra * 3600 - 30.75) < 1e-3, `east offset ${ra * 3600}`);
  assert.ok(Math.abs(dec * 3600 - 12.3) < 1e-3, `north offset ${dec * 3600}`);
});

test('comovingLayer centres the body, whatever the roll and pointing of the exposure', () => {
  const { items } = makeVisit({ seed: 3, count: 6, bodyFlux: 20000, nStars: 0, noise: 0.005 });
  for (const it of items) {
    const layer = comovingLayer(it.frame, it.ra, it.dec);
    const { n, c } = centreOf([layer]);
    assert.equal(n, 79);
    assert.equal(layer.body.ra, it.ra);
    assert.ok(Math.abs(layer.grid.ra0 - it.ra) < 1e-9);
    assert.equal(layer.grid.n, 79);
    assert.ok(Math.abs(layer.background) < 0.05, `background ${layer.background}`);
    // brightest pixel is the centre pixel
    let best = -1;
    for (let i = 0; i < layer.image.length; i++) if (!layer.mask[i] && (best < 0 || layer.image[i] > layer.image[best])) best = i;
    assert.ok(Math.abs((best % n) - c) <= 1 && Math.abs(Math.floor(best / n) - c) <= 1, `peak at ${best % n}, ${Math.floor(best / n)}`);
    const snr = centralSnr(layer, { n });
    assert.ok(Math.hypot(snr.dx_arcsec, snr.dy_arcsec) < 1.5, `centroid offset ${snr.dx_arcsec}, ${snr.dy_arcsec}`);
    // sky background was removed
    assert.ok(Math.abs(snr.background) < 0.01);
  }
  // forced size
  assert.equal(comovingLayer(items[0].frame, items[0].ra, items[0].dec, { n: 64 }).image.length, 64 * 64);
});

test('the co-moving stack recovers the body at the centre with the right flux', async () => {
  const flux = 600;
  const { items } = makeVisit({ seed: 11, count: 25, bodyFlux: flux, nStars: 12 });
  const { layers, failed, grid } = await buildComovingLayers(items);
  assert.equal(layers.length, 25);
  assert.equal(failed, 0);
  assert.equal(grid.comoving, true);
  assert.equal(grid.n, 79);
  const stack = stackComoving(layers);
  assert.equal(stack.n, 25);
  const s = centralSnr(stack, { n: grid.n, scale: grid.scale, psfFwhm: 7.46 });
  assert.equal(s.ok, true);
  assert.equal(s.method, 'empirical');
  assert.ok(s.nRef > 40, `reference apertures ${s.nRef}`);
  assert.ok(s.snr > 25, `snr ${s.snr}`);
  assert.ok(Math.hypot(s.dx_arcsec, s.dy_arcsec) < 1.0, `centroid ${s.dx_arcsec}, ${s.dy_arcsec} arcsec from the centre`);
  assert.ok(Math.abs(s.flux_uJy - flux) / flux < 0.12, `flux ${s.flux_uJy} vs ${flux}`);
  assert.ok(Math.abs(s.limit3_uJy - 3 * s.err_uJy) < 1e-9);
});

test('signal-to-noise grows roughly as the square root of the number of exposures', async () => {
  // No stars, so that only the noise matters. One exposure has S/N of about 4.
  const snrOf = async (count, seed) => {
    const { items } = makeVisit({ seed, count, bodyFlux: 220, nStars: 0 });
    const { layers } = await buildComovingLayers(items);
    return centralSnr(stackComoving(layers), { psfFwhm: 7.46 }).snr;
  };
  const mean = async (count) => {
    let s = 0;
    const seeds = [21, 22, 23, 24, 25, 26];
    for (const seed of seeds) s += await snrOf(count, seed + count);
    return s / seeds.length;
  };
  const s4 = await mean(4);
  const s16 = await mean(16);
  const s64 = await mean(64);
  assert.ok(s4 > 4 && s4 < 16, `S/N of 4 exposures ${s4}`);
  const r1 = s16 / s4;
  const r2 = s64 / s16;
  const r3 = s64 / s4;
  assert.ok(r1 > 1.5 && r1 < 2.6, `16 vs 4 exposures: ${r1} (sqrt gives 2)`);
  assert.ok(r2 > 1.5 && r2 < 2.6, `64 vs 16 exposures: ${r2} (sqrt gives 2)`);
  assert.ok(r3 > 3.0 && r3 < 5.2, `64 vs 4 exposures: ${r3} (sqrt gives 4)`);
});

test('sigma clipping suppresses the stars, which land somewhere else in every layer', async () => {
  const { items } = makeVisit({ seed: 31, count: 20, bodyFlux: 500, nStars: 16, starFlux: 6000 });
  const { layers, grid } = await buildComovingLayers(items);
  const plain = stackComoving(layers, { clip: 0 });
  const clipped = stackComoving(layers, { clip: 3 });
  const med = stackComoving(layers, { method: 'median' });
  const a = maxOffCentre(plain, grid.n, grid.scale, 25);
  const b = maxOffCentre(clipped, grid.n, grid.scale, 25);
  const c = maxOffCentre(med, grid.n, grid.scale, 25);
  assert.ok(a.z > 20, `without clipping the stars leave streaks of dots: ${a.z} sigma`);
  assert.ok(b.z < 7, `with clipping they are gone: ${b.z} sigma`);
  assert.ok(c.z < 7, `the median removes them too: ${c.z} sigma`);
  assert.ok(b.max < a.max / 4);
  // the body survives clipping
  const s0 = centralSnr(plain, { psfFwhm: 7.46 });
  const s1 = centralSnr(clipped, { psfFwhm: 7.46 });
  assert.ok(Math.abs(s1.flux_uJy - 500) / 500 < 0.15, `flux after clipping ${s1.flux_uJy}`);
  assert.ok(s1.snr > s0.snr, `clipping also lowers the noise floor (${s1.snr} vs ${s0.snr})`);
  // fewer samples survive where a star crossed
  let min = Infinity;
  for (let i = 0; i < clipped.count.length; i++) if (!clipped.mask[i] && clipped.count[i] < min) min = clipped.count[i];
  assert.ok(min < 20);
});

test('the star-fixed stack shows sharp stars and a trailed body', async () => {
  // 20 exposures, 12 arcsec per hour, 2.4 hours apart: the body crosses 547 arcsec. Use a
  // shorter visit so that the whole trail stays in the field.
  const rate = 12;
  const pa = 250;
  const star = offset(305.2, -23.4, 20, 45);
  const { items } = makeVisit({ seed: 41, count: 9, stepDays: 0.04, rate, paDeg: pa, bodyFlux: 3000, stars: [{ ...star, flux_uJy: 3000 }], noise: 0.01 });
  const fixed = starFixedStack(items);
  const n = fixed.grid.n;
  assert.equal(fixed.stack.n, 9);
  assert.equal(fixed.track.length, 9);
  const expectTrail = rate * 0.04 * 24 * 8; // arcsec
  assert.ok(Math.abs(fixed.trailArcsec - expectTrail) < 1, `trail ${fixed.trailArcsec} vs ${expectTrail}`);
  assert.ok(Math.abs(fixed.trailPixels - expectTrail / 3.075) < 0.5);

  const { layers } = await buildComovingLayers(items);
  const co = stackComoving(layers, { clip: 0 });
  const peakOf = (img, x, y, r = 3) => {
    let best = -Infinity;
    for (let yy = Math.round(y) - r; yy <= Math.round(y) + r; yy++) {
      for (let xx = Math.round(x) - r; xx <= Math.round(x) + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const v = img[yy * n + xx];
        if (v > best) best = v;
      }
    }
    return best;
  };
  const c = (n - 1) / 2;
  const coPeak = peakOf(co.image, c, c);

  // In the star-fixed stack the star is sharp: as high as the body is in the co-moving stack
  // (same flux), and it sits where the sky says.
  const [sx, sy] = gridSkyToPix(fixed.grid, star.ra, star.dec);
  const starPeak = peakOf(fixed.stack.image, sx, sy);
  assert.ok(starPeak > 0.7 * coPeak && starPeak < 1.3 * coPeak, `star ${starPeak} vs body ${coPeak}`);

  // The body is smeared along its track: much lower everywhere on it than a point source would be...
  let trailMax = -Infinity;
  for (const p of fixed.track) trailMax = Math.max(trailMax, peakOf(fixed.stack.image, p.x, p.y, 2));
  assert.ok(trailMax < 0.45 * coPeak, `trailed body ${trailMax} vs sharp ${coPeak}`);
  // ...and its light is elongated along the direction of motion.
  let sw = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const mid = fixed.track[4];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (fixed.stack.mask[i]) continue;
      if (Math.hypot(x - sx, y - sy) < 8) continue; // not the star
      const v = fixed.stack.image[i];
      if (!(v > 0.25 * trailMax)) continue;
      const dx = x - mid.x;
      const dy = y - mid.y;
      sw += v; sxx += v * dx * dx; syy += v * dy * dy; sxy += v * dx * dy;
    }
  }
  sxx /= sw; syy /= sw; sxy /= sw;
  const tr = sxx + syy;
  const disc = Math.sqrt(Math.max(0, (sxx - syy) ** 2 + 4 * sxy * sxy));
  const major = Math.sqrt((tr + disc) / 2);
  const minor = Math.sqrt(Math.max(1e-9, (tr - disc) / 2));
  assert.ok(major / minor > 3, `elongation ${major / minor}`);
  // Direction: grid x grows to the west, y to the north. PA 250 = west and a little south.
  const angle = Math.atan2(2 * sxy, sxx - syy) / 2; // direction of the major axis in (x, y)
  const expectAngle = Math.atan2(Math.cos(pa * DEG), -Math.sin(pa * DEG));
  const diff = Math.abs(((angle - expectAngle) / DEG + 540) % 180 - 90);
  assert.ok(Math.abs(diff - 90) < 8, `trail direction off by ${Math.abs(diff - 90)} deg`);

  // With clipping the moving body is simply deleted from a star-fixed stack: the reason the
  // comparison uses none.
  const clippedFixed = starFixedStack(items, { clip: 3 });
  let after = -Infinity;
  for (const p of clippedFixed.track) after = Math.max(after, peakOf(clippedFixed.stack.image, p.x, p.y, 2));
  assert.ok(after < 0.4 * trailMax, `clipped trail ${after} vs ${trailMax}`);
});

test('the star-fixed stack of a body that barely moves is not trailed', () => {
  const { items } = makeVisit({ seed: 43, count: 6, stepDays: 0.02, rate: 0.5, bodyFlux: 2000, nStars: 0 });
  const fixed = starFixedStack(items);
  assert.ok(fixed.trailArcsec < 1.5, `trail ${fixed.trailArcsec}`);
  const s = centralSnr(fixed.stack, { psfFwhm: 7.46 });
  assert.ok(Math.abs(s.flux_uJy - 2000) / 2000 < 0.12);
  // explicit centre and size
  const moved = starFixedStack(items, { center: { ra: items[0].ra, dec: items[0].dec + 30 / 3600 }, n: 64 });
  assert.equal(moved.grid.n, 64);
  assert.ok(Math.abs(moved.track[0].y - (31.5 - 30 / 3.075)) < 0.05);
  assert.deepEqual(starFixedStack([]).track, []);
});

test('groupComoving and comovingStacks: per visit and detector, with captions', async () => {
  const a = makeVisit({ seed: 51, count: 12, start: 60900, det: (i) => 3 + (i % 2), bodyFlux: 800, nStars: 6 });
  const b = makeVisit({ seed: 52, count: 8, start: 61080, det: (i) => 3 + (i % 2), bodyFlux: 800, nStars: 6 });
  const { layers } = await buildComovingLayers([...b.items, ...a.items]);
  assert.ok(layers.every((l, i) => i === 0 || l.mjd >= layers[i - 1].mjd), 'time order');
  const { visits, groups } = groupComoving(layers);
  assert.equal(visits.length, 2);
  assert.deepEqual(groups.map((g) => g.key), ['v0d3', 'v0d4', 'v1d3', 'v1d4']);
  assert.deepEqual(groups.map((g) => g.n), [6, 6, 4, 4]);
  assert.deepEqual(groups[0].band, [1.63, 2.41]);
  assert.ok(groups[0].mjdStart === 60900 && groups[0].mjdEnd > 60900.9);

  const stacks = await comovingStacks(layers, { psfFwhm: 7.46 });
  assert.equal(stacks.groups.length, 4);
  assert.equal(stacks.visits.length, 2);
  assert.deepEqual(stacks.dets.map((d) => d.det), [3, 4]);
  assert.equal(stacks.deep.n, 20);
  assert.equal(stacks.groups[0].stack.method, 'wmean');
  assert.equal(stacks.groups[2].stack.method, 'median'); // four layers: too few to clip
  for (const g of [...stacks.groups, ...stacks.visits, ...stacks.dets, stacks.deep]) {
    assert.ok(g.snr.ok && g.snr.snr > 5, `${g.key} snr ${g.snr.snr}`);
  }
  assert.ok(stacks.deep.snr.snr > stacks.groups[0].snr.snr, 'the deep stack is deeper');

  const frames = movieFrames(stacks.groups, { name: 'Pluto', visitCount: 2, dateLabel: dateRangeLabel });
  assert.equal(frames.length, 4);
  const f = frames[0];
  assert.equal(f.caption.title, 'Pluto · visit 1 of 2');
  assert.equal(f.caption.date, '2025 Aug 13 to 14');
  assert.equal(f.caption.wave, 'D3 1.63-2.41 um · 6 exposures');
  assert.equal(f.caption.note, COMOVING_NOTE);
  assert.equal(f.caption.note, 'frame follows the body; stars streak');
  assert.equal(f.image.length, 79 * 79);
  assert.equal(f.mask.length, 79 * 79);
  assert.ok(f.range[1] > f.range[0]);
  assert.ok(f.range[1] >= stacks.groups[0].snr.peak * 0.9, 'the body is inside the display range');
  assert.equal(f.comoving, true);
  assert.equal(frames[3].pass, 1);
  const all = movieFrames([stacks.deep], { name: 'Pluto' });
  assert.equal(all[0].caption.wave, 'all detectors 0.75-5.00 um · 20 exposures');
  assert.equal(all[0].caption.title, 'Pluto');
  assert.deepEqual(movieFrames(null), []);
  assert.deepEqual(stackRange({ image: new Float32Array(16).fill(NaN), mask: new Uint8Array(16).fill(1) }), [0, 1]);
});

test('buildComovingLayers is cooperative: progress, bad input, cancellation', async () => {
  const { items } = makeVisit({ seed: 61, count: 10, nStars: 3 });
  const reports = [];
  const broken = { frame: { nx: 0, ny: 0, image: null, mjd: 1 }, ra: 1, dec: 1 };
  const off = { frame: items[0].frame, ra: items[0].ra + 5, dec: items[0].dec }; // body nowhere near the cutout
  const out = await buildComovingLayers([...items, broken, off, null, { frame: items[1].frame, ra: NaN, dec: 0 }], { onProgress: (r) => reports.push(r) });
  assert.equal(out.layers.length, 10);
  assert.equal(out.failed, 4);
  const lastReport = reports[reports.length - 1];
  assert.deepEqual(lastReport, { done: 14, total: 14, failed: 4, phase: 'align' });
  // a throwing progress handler does not stop the work
  const again = await buildComovingLayers(items, { onProgress: () => { throw new Error('boom'); } });
  assert.equal(again.layers.length, 10);
  // cancellation
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(buildComovingLayers(items, { signal: controller.signal }), (err) => err.name === 'AbortError');
  await assert.rejects(comovingStacks(out.layers, { signal: controller.signal }), (err) => err.name === 'AbortError');
  // nothing in, nothing out
  const empty = await buildComovingLayers([]);
  assert.deepEqual(empty.layers, []);
  assert.equal(empty.grid.n, 79);
  const none = await comovingStacks([]);
  assert.equal(none.deep, null);
  assert.deepEqual(none.groups, []);
});

test('centralSnr: empty sky gives no detection and an honest limit', async () => {
  const { items } = makeVisit({ seed: 71, count: 36, bodyFlux: 0, nStars: 10 });
  const { layers } = await buildComovingLayers(items);
  const s = centralSnr(stackComoving(layers), { psfFwhm: 7.46 });
  assert.ok(Math.abs(s.snr) < 3.5, `snr ${s.snr}`);
  // One exposure: sigma = 0.02 MJy/sr over about 8 pixels = 50 uJy; 36 exposures: about 9 uJy;
  // resampling and the aperture correction raise that somewhat.
  assert.ok(s.limit3_uJy > 15 && s.limit3_uJy < 60, `3-sigma limit ${s.limit3_uJy} uJy`);
  // a body at the limit would have been seen at about 3 sigma
  const { items: faint } = makeVisit({ seed: 71, count: 36, bodyFlux: 3 * s.limit3_uJy, nStars: 10 });
  const sf = centralSnr(stackComoving((await buildComovingLayers(faint)).layers), { psfFwhm: 7.46 });
  assert.ok(sf.snr > 5 && sf.snr < 14, `snr of a body at 3x the limit ${sf.snr}`);
});

test('centralSnr edge cases', () => {
  assert.equal(centralSnr(null).ok, false);
  assert.equal(centralSnr({ image: new Float32Array(10) }).ok, false); // not square
  const n = 21;
  const image = new Float32Array(n * n);
  const mask = new Uint8Array(n * n);
  mask[10 * n + 10] = 1; // the centre pixel is unusable
  const blocked = centralSnr({ image, mask }, { n });
  assert.equal(blocked.ok, false);
  assert.ok(Number.isNaN(blocked.snr));
  // tiny image: no room for reference apertures, falls back to the variance
  const small = { image: new Float32Array(n * n), variance: new Float32Array(n * n).fill(1e-4), mask: new Uint8Array(n * n) };
  small.image[10 * n + 10] = 1;
  const s = centralSnr(small, { n, scale: 3.075 });
  assert.equal(s.ok, true);
  assert.ok(s.method === 'variance' || s.method === 'empirical');
  assert.ok(s.net > 0.9);
  // all-zero image: noise is zero, snr is NaN, nothing throws
  const flat = centralSnr({ image: new Float32Array(79 * 79), mask: new Uint8Array(79 * 79) });
  assert.ok(Number.isNaN(flat.snr));
});

test('the spectrum recovers an injected absorption band across detectors', () => {
  // A flat 1500 uJy body with a methane-like band at 3.3 um, 60% deep, sampled by detector 4
  // (84 exposures) and with flat continuum in detector 3 (40 exposures).
  const depth = 0.6;
  const fluxOf = (w) => 1500 * (1 - depth * Math.exp(-0.5 * ((w - 3.3) / 0.09) ** 2));
  const d4 = makeVisit({ seed: 81, count: 84, det: 4, stepDays: 0.05, nStars: 10, waveOf: (i) => 2.45 + (1.35 * (i + 0.5)) / 84, fluxOf });
  const d3 = makeVisit({ seed: 82, count: 40, det: 3, stepDays: 0.05, start: 60905, nStars: 10, waveOf: (i) => 1.65 + (0.75 * (i + 0.5)) / 40, fluxOf });
  const spec = bodySpectrum([...d4.items, ...d3.items]);
  assert.equal(spec.counts.total, 124);
  assert.equal(spec.points.length, 124);
  assert.ok(spec.counts.used >= 105, `used ${spec.counts.used}`);
  assert.equal(spec.counts.used + spec.counts.star + spec.counts.outlier + spec.counts.flagged + spec.counts.saturated + spec.counts.offFrame, 124);
  for (let i = 1; i < spec.points.length; i++) assert.ok(spec.points[i].wave >= spec.points[i - 1].wave);
  assert.ok(spec.binned.length >= 20, `binned channels ${spec.binned.length}`);
  assert.deepEqual(spec.perDet.map((p) => p.det), [3, 4]);

  const band = bandDepth(spec.binned, 3.3, 0.1);
  assert.ok(band, 'band measured');
  // Channels are 0.08 um wide, so the measured depth is the band averaged over +-0.1 um.
  assert.ok(band.depth > 0.35 && band.depth < 0.65, `depth ${band.depth}`);
  assert.ok(band.depth / band.err > 8, `significance ${band.depth / band.err}`);
  assert.ok(Math.abs(band.continuum_uJy - 1500) / 1500 < 0.12, `continuum ${band.continuum_uJy}`);
  // away from the band the spectrum is flat at the injected level
  const flat = spec.binned.filter((p) => p.wave < 2.9 || p.wave > 3.7);
  for (const p of flat) assert.ok(Math.abs(p.flux_uJy - 1500) / 1500 < 0.12, `flux at ${p.wave}: ${p.flux_uJy}`);
  // no band where none was injected
  const none = bandDepth(spec.binned, 2.0, 0.1);
  assert.ok(Math.abs(none.depth) < 0.08, `depth at 2.0 um ${none.depth}`);
  // the deepest binned point is at the band centre
  const lowest = spec.binned.reduce((a, b) => (b.flux_uJy < a.flux_uJy ? b : a));
  assert.ok(Math.abs(lowest.wave - 3.3) < 0.08, `lowest point at ${lowest.wave}`);
  // the band itself was not rejected as a set of outliers
  const inBand = spec.points.filter((p) => Math.abs(p.wave - 3.3) < 0.08);
  assert.ok(inBand.filter((p) => !p.rejected).length >= inBand.length - 1);
});

test('the quality cut drops exposures where a bright star sits on the body', () => {
  const rand = mulberry32(91);
  const base = { ra: 120, dec: 10 };
  const items = [];
  const contaminated = new Set([5, 17, 23, 31]);
  for (let i = 0; i < 40; i++) {
    const pos = offset(base.ra, base.dec, -20 * i, 3 * i); // the body moves 20 arcsec per exposure
    const sources = [{ ...pos, flux_uJy: 1000 }];
    // a 5000 uJy star 1.2 pixels from the body in four of the exposures
    if (contaminated.has(i)) sources.push({ ...offset(pos.ra, pos.dec, 5, 5.5), flux_uJy: 5000 });
    const frame = makeFrame({ id: `q${i}`, mjd: 60900 + i * 0.05, det: 2, wave: 1.12 + 0.012 * i, center: pos, sources, rand });
    items.push({ frame, ra: pos.ra, dec: pos.dec });
  }
  const spec = bodySpectrum(items);
  const rejected = spec.points.filter((p) => p.rejected === 'star').map((p) => p.id).sort();
  assert.deepEqual(rejected, ['q17', 'q23', 'q31', 'q5']);
  assert.equal(spec.counts.star, 4);
  assert.equal(spec.counts.used, 36);
  assert.equal(spec.sourceFlagUsed, false);
  for (const p of spec.binned) assert.ok(Math.abs(p.flux_uJy - 1000) < 120, `binned flux ${p.flux_uJy}`);
  // Without the cut the contaminated channels would be far off.
  const loose = bodySpectrum(items, { starSigma: Infinity });
  assert.equal(loose.counts.star, 0);
  assert.equal(loose.counts.used, 40);
});

test('the quality cut uses the flags: bad pixels, saturation and the SOURCE bit', () => {
  const rand = mulberry32(95);
  const pos = { ra: 120, dec: 10 };
  const items = [];
  for (let i = 0; i < 30; i++) {
    const frame = makeFrame({ id: `f${i}`, mjd: 60900 + i * 0.05, det: 5, wave: 3.85 + 0.018 * i, center: pos, sources: [{ ...pos, flux_uJy: 800 }], rand });
    items.push({ frame, ra: pos.ra, dec: pos.dec });
  }
  const centre = (frame) => {
    const [x, y] = makeWcs(frame.wcs).skyToPix(pos.ra, pos.dec);
    return Math.round(y) * frame.nx + Math.round(x);
  };
  items[2].frame.flags[centre(items[2].frame)] |= 1 << 10;           // HOT pixel under the body
  items[3].frame.flags[centre(items[3].frame)] |= 1 << 1;            // OVERFLOW: saturated
  items[4].frame.flags[centre(items[4].frame) + 1] |= 1 << 15;       // NONLINEAR next to the centre
  items[6].frame.flags[centre(items[6].frame) + 1] |= SOURCE_MASK;   // a catalogued star 1 pixel away
  items[7].frame.flags[centre(items[7].frame) + items[7].frame.nx] |= SOURCE_MASK;
  items[8].frame.flags[centre(items[8].frame) + 6] |= SOURCE_MASK;   // 6 pixels away: harmless
  items[9].frame.image[centre(items[9].frame)] = NaN;                // a dead pixel
  const off = { frame: items[10].frame, ra: pos.ra + 1, dec: pos.dec }; // body off the cutout
  const spec = bodySpectrum([...items, off]);
  const reason = Object.fromEntries(spec.points.map((p, i) => [p.id + (p.ok ? '' : `-off${i}`), p.rejected]));
  assert.equal(reason.f2, 'flagged');
  assert.equal(reason.f3, 'saturated');
  assert.equal(reason.f4, 'saturated');
  assert.equal(reason.f6, 'star');
  assert.equal(reason.f7, 'star');
  assert.equal(reason.f8, null);
  assert.equal(reason.f9, 'flagged');
  assert.equal(spec.sourceFlagUsed, true);
  assert.deepEqual(spec.counts, { total: 31, used: 24, offFrame: 1, saturated: 2, flagged: 2, star: 2, outlier: 0 });
  // In a crowded field the SOURCE bit is set nearly everywhere; it is then ignored.
  for (const it of items) it.frame.flags[centre(it.frame) + 1] |= SOURCE_MASK;
  const crowded = bodySpectrum(items);
  assert.equal(crowded.sourceFlagUsed, false);
  assert.equal(crowded.counts.star, 0);
  // and it can be switched off
  assert.equal(bodySpectrum(items.slice(5, 9), { useSourceFlag: false }).counts.star, 0);
  // empty input
  const empty = bodySpectrum([]);
  assert.deepEqual(empty.binned, []);
  assert.equal(empty.counts.total, 0);
});

test('bandDepth handles emission, missing parts and junk', () => {
  const mk = (wave, flux) => ({ wave, flux_uJy: flux, err_uJy: 10 });
  const emission = [mk(3.9, 100), mk(4.0, 100), mk(4.27, 300), mk(4.5, 100), mk(4.6, 100)];
  const e = bandDepth(emission, 4.27, 0.1);
  assert.ok(Math.abs(e.depth + 2) < 1e-9, `depth ${e.depth}`);
  assert.equal(e.nBand, 1);
  assert.equal(e.nContinuum, 4);
  assert.equal(bandDepth([mk(4.27, 300)], 4.27, 0.1), null);
  assert.equal(bandDepth([], 3.3), null);
  assert.equal(bandDepth(null, 3.3), null);
  assert.equal(bandDepth([mk(3.3, 0), mk(3.0, 0), mk(3.6, 0)], 3.3, 0.1), null);
});

test('a point source is not called extended; a coma is', async () => {
  const run = async (bodyFwhm, seed) => {
    const { items } = makeVisit({ seed, count: 30, bodyFlux: bodyFwhm ? 9000 : 1500, bodyFwhm, nStars: 8 });
    const { layers, grid } = await buildComovingLayers(items);
    const stack = stackComoving(layers);
    const profile = radialProfile(stack, { n: grid.n, scale: grid.scale });
    return { profile, ext: extendedness(profile, { psfFwhm: 7.46 }) };
  };
  const point = await run(undefined, 101);
  assert.ok(point.profile.length > 10);
  assert.ok(point.profile[0].r < 2 && point.profile[0].value > 0);
  for (let i = 1; i < 5; i++) assert.ok(point.profile[i].value < point.profile[i - 1].value, 'falls outward');
  assert.equal(point.ext.measurable, true);
  assert.equal(point.ext.extended, false, `point source: ratio ${point.ext.ratio}, growth ${point.ext.growthRatio}`);
  assert.ok(Math.abs(point.ext.ratio - 1) < 0.15, `measured ${point.ext.fwhm_arcsec} vs expected ${point.ext.expected_arcsec}`);
  assert.ok(Math.abs(point.ext.growthRatio - 1) < 0.15, `growth ${point.ext.growth} vs ${point.ext.expectedGrowth}`);
  assert.ok(Math.abs(expectedStackFwhm(7.46) - 10.4) < 0.1);

  const coma = await run(28, 102);
  assert.equal(coma.ext.measurable, true);
  assert.equal(coma.ext.extended, true);
  assert.ok(coma.ext.ratio > 2, `coma ratio ${coma.ext.ratio}`);
  assert.ok(coma.ext.growthRatio > 1.5, `coma growth ${coma.ext.growthRatio}`);
  assert.ok(Math.abs(coma.ext.fwhm_arcsec - Math.sqrt(28 * 28 + expectedStackFwhm(7.46) ** 2 - 7.46 ** 2)) < 4, `coma fwhm ${coma.ext.fwhm_arcsec}`);

  // too faint to say
  const { items } = makeVisit({ seed: 103, count: 4, bodyFlux: 30, nStars: 0 });
  const { layers, grid } = await buildComovingLayers(items);
  const faint = extendedness(radialProfile(stackComoving(layers), { n: grid.n, scale: grid.scale }));
  assert.equal(faint.measurable, false);
  assert.equal(faint.extended, false);
  assert.equal(extendedness([]).measurable, false);
  assert.deepEqual(radialProfile(null), []);
});

test('verdict: honest sentences for every outcome', async () => {
  const run = async (opts) => {
    const { items } = makeVisit({ nStars: 6, ...opts });
    const { layers } = await buildComovingLayers(items);
    const stacks = await comovingStacks(layers, { psfFwhm: 7.46 });
    return { items, deep: stacks.deep, spectrum: bodySpectrum(items) };
  };
  const text = (lines) => lines.map((l) => l.text).join(' ');

  assert.equal(text(verdict({ name: 'Sedna', planned: 0 })), 'No SPHEREx exposure contained this body.');
  assert.match(text(verdict({ name: 'Sedna', planned: 12, loaded: 0 })), /None of the 12 exposures could be loaded\./);

  const bright = await run({ seed: 201, count: 20, bodyFlux: 2000 });
  const b = verdict({ name: 'Pluto', planned: 20, loaded: 20, ...bright });
  assert.equal(b[0].kind, 'ok');
  assert.match(b[0].text, /^Pluto is visible in single exposures \(typical S\/N \d+\); the stack of 20 reaches S\/N \d+(\.\d)?\.$/);
  assert.ok(singleExposureSnr(bright.spectrum) > 20);

  const faint = await run({ seed: 202, count: 49, bodyFlux: 90 });
  const f = verdict({ name: 'Eris', planned: 49, loaded: 49, ...faint });
  assert.match(f[0].text, /^Eris is too faint for single exposures \(typical S\/N \d\.\d\); the stack of 49 reaches S\/N \d+\.\d\.$/);
  assert.ok(singleExposureSnr(faint.spectrum) < 4);
  assert.ok(faint.deep.snr.snr > 5, `deep snr ${faint.deep.snr.snr}`);

  const nothing = await run({ seed: 203, count: 30, bodyFlux: 0 });
  const n = verdict({ name: 'Sedna', planned: 30, loaded: 30, ...nothing });
  assert.match(n[0].text, /^Sedna is not detected: the stack of 30 exposures reaches S\/N -?\d\.\d at its position\. 3-sigma upper limit \d+(\.\d)? microJy for a point source/);

  // A hint: force the numbers.
  const hint = verdict({ name: 'Gonggong', planned: 30, loaded: 30, deep: { n: 30, dets: [1, 2], snr: { ok: true, snr: 3.2, flux_uJy: 20, limit3_uJy: 19 } }, spectrum: nothing.spectrum });
  assert.match(hint[0].text, /too faint for single exposures; the stack reaches S\/N 3\.2\. That is a hint, not a detection\./);

  // Saturation and stars are reported.
  const sat = verdict({ name: 'Ceres', planned: 20, loaded: 20, deep: bright.deep, spectrum: { ...bright.spectrum, counts: { total: 20, used: 12, offFrame: 1, saturated: 5, flagged: 1, star: 1, outlier: 0 } } });
  assert.match(text(sat), /Saturated in 5 frames; they are left out of the spectrum\./);
  assert.match(text(sat), /1 exposure left out of the spectrum because a background star/);
  assert.match(text(sat), /2 more left out/);

  // A hypothetical body never becomes a detection.
  const h0 = verdict({ name: 'Hypothetical body', planned: 30, loaded: 30, hypothetical: true, ...nothing });
  assert.equal(h0[0].kind, 'warn');
  assert.match(h0[0].text, /not known to exist/);
  assert.match(h0[1].text, /^Nothing at the predicted position: the stack of 30 exposures has S\/N -?\d\.\d there\. 3-sigma upper limit \d+(\.\d)? microJy/);
  const h1 = verdict({ name: 'Hypothetical body', planned: 20, loaded: 20, hypothetical: true, ...bright });
  assert.match(h1[1].text, /That is not a discovery/);
  assert.ok(!/detected|visible/.test(text(h1)));
  assert.match(text(verdict({ planned: 0, hypothetical: true })), /No SPHEREx exposure contained the predicted track\./);

  // Coma line only for a detected source.
  const ext = { measurable: true, extended: true, fwhm_arcsec: 31.2, expected_arcsec: 10.4 };
  assert.match(text(verdict({ name: '3I/ATLAS', planned: 20, loaded: 20, ...bright, ext })), /Wider than a star: 31 arcsec across at half maximum, where a point source gives 10\.4\./);
  assert.match(text(verdict({ name: 'Chiron', planned: 20, loaded: 20, ...bright, ext: { ...ext, extended: false, fwhm_arcsec: 10.9 } })), /As sharp as a star: 10\.9 arcsec/);
  assert.ok(!/star:/.test(text(verdict({ name: 'x', planned: 30, loaded: 30, ...nothing, ext }))));
  for (const lines of [b, f, n, hint, sat, h0, h1]) for (const l of lines) assert.ok(!l.text.includes('!'));
});
