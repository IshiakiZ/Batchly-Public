// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Tests for classify.js with synthetic spectra, light curves and motions.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BANDS,
  CONFIDENCE_WORDS,
  DISCLAIMER,
  bandDepth,
  bandFlux,
  calibrateErrors,
  classify,
  compass,
  despike,
  formatMotion,
  formatMotionWithError,
  gaiaPositionAt,
  monthYear,
  nearestGaia,
  spectralSlope,
  summarizeLightCurve,
  usablePoints,
} from './classify.js';

// ---- synthetic data ---------------------------------------------------------------------------

/** 102 channel centres from 0.75 to 5.0 um, evenly spaced in log wavelength like SPHEREx. */
const WAVES = Array.from({ length: 102 }, (_, i) => 0.75 * (5 / 0.75) ** (i / 101));

/** Planck F_nu (arbitrary units) at wavelength um and temperature K. */
function planck(wave, teff) {
  const x = 14387.77 / (wave * teff);
  return 1 / (wave ** 3 * Math.expm1(x));
}

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
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/**
 * A binned spectrum: shape(wave) scaled so its maximum is `peak` uJy, with Gaussian noise of
 * `noise` uJy per point and optional absorption bands [{ center, sigma, depth }].
 */
function spectrum(shape, { peak = 5000, noise = 25, bands = [], seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const raw = WAVES.map((w) => {
    let f = shape(w);
    for (const b of bands) f *= 1 - b.depth * Math.exp(-0.5 * ((w - b.center) / b.sigma) ** 2);
    return f;
  });
  const top = Math.max(...raw);
  return WAVES.map((wave, i) => ({ wave, flux_uJy: (raw[i] / top) * peak + noise * gaussian(rand), err_uJy: noise }));
}

const warmStar = () => spectrum((w) => planck(w, 6000));
const coolStar = () => spectrum((w) => planck(w, 3200));
const dusty = () => spectrum((w) => w ** 1.6);
const tDwarf = (opts = {}) =>
  spectrum((w) => planck(w, 900), {
    peak: 2600,
    noise: 20,
    bands: [
      { center: 3.3, sigma: 0.2, depth: 0.93 },
      { center: 2.25, sigma: 0.12, depth: 0.5 },
      { center: 1.67, sigma: 0.07, depth: 0.4 },
    ],
    ...opts,
  });

const ids = (result) => result.hints.map((h) => h.id);
const hint = (result, id) => result.hints.find((h) => h.id === id);

// ---- measurements -----------------------------------------------------------------------------

test('usablePoints drops flagged and non-finite points and sorts by wavelength', () => {
  const pts = usablePoints([
    { wave: 2, flux_uJy: 5, err_uJy: 1 },
    { wave: 1, flux_uJy: 4, err_uJy: 0 },
    { wave: 3, flux_uJy: NaN, err_uJy: 1 },
    { wave: 4, flux_uJy: 5, err_uJy: 1, flagged: true },
    { wave: 5, flux_uJy: 5, err_uJy: 1, ok: false },
    null,
    { flux_uJy: 5 },
  ]);
  assert.deepEqual(pts, [{ wave: 1, flux: 4, err: null }, { wave: 2, flux: 5, err: 1 }]);
  assert.deepEqual(usablePoints(null), []);
  assert.deepEqual(usablePoints('nope'), []);
});

test('bandFlux averages a window and bandDepth recovers a known dip', () => {
  const flat = spectrum(() => 1, { peak: 1000, noise: 5, bands: [{ center: 3.3, sigma: 0.08, depth: 0.4 }] });
  const cont = bandFlux(flat, 3.6, 3.8);
  assert.ok(Math.abs(cont.flux - 1000) < 15);
  assert.ok(cont.n >= 2 && cont.err > 0 && cont.wave > 3.6 && cont.wave < 3.8);
  assert.equal(bandFlux(flat, 9, 10), null);
  const d = bandDepth(flat, BANDS.ch4);
  assert.ok(d.depth > 0.2 && d.depth < 0.4, `depth ${d.depth}`); // the window average of a 40 percent Gaussian dip
  assert.ok(d.sigma > 10);
  assert.equal(d.sides, 2);
  // No dip: depth compatible with zero.
  const none = bandDepth(spectrum(() => 1, { peak: 1000, noise: 5 }), BANDS.ch4);
  assert.ok(Math.abs(none.depth) < 0.03);
  // A sloping continuum is interpolated, not averaged: no false dip on a steep red spectrum.
  const steep = bandDepth(spectrum((w) => w ** 3, { noise: 1 }), BANDS.ch4);
  assert.ok(Math.abs(steep.depth) < 0.04, `steep depth ${steep.depth}`);
  // Too faint to divide by.
  assert.equal(bandDepth(spectrum(() => 1, { peak: 2, noise: 5 }), BANDS.ch4), null);
  // One side only.
  const half = flat.filter((p) => p.wave < 3.5);
  assert.equal(bandDepth(half, BANDS.ch4).sides, 1);
  assert.equal(bandDepth([], BANDS.ch4), null);
});

test('calibrateErrors widens error bars that are too small and fills in missing ones', () => {
  const honest = calibrateErrors(usablePoints(spectrum((w) => planck(w, 4000), { noise: 40 })));
  assert.ok(honest.scale >= 1 && honest.scale < 1.4, `scale ${honest.scale}`);
  // The same noise with errors quoted ten times too small.
  const liar = spectrum(() => 1, { peak: 1000, noise: 60, seed: 5 }).map((p) => ({ ...p, err_uJy: 6 }));
  const fixed = calibrateErrors(usablePoints(liar));
  assert.ok(fixed.scale > 6 && fixed.scale < 15, `scale ${fixed.scale}`);
  assert.ok(Math.abs(fixed.points[10].err - 6 * fixed.scale) < 1e-9);
  // No errors at all: the scatter stands in.
  const bare = calibrateErrors(usablePoints(spectrum(() => 1, { peak: 1000, noise: 60, seed: 5 }).map(({ wave, flux_uJy }) => ({ wave, flux_uJy }))));
  assert.ok(bare.points.every((p) => p.err > 30 && p.err < 120), `err ${bare.points[0].err}`);
  assert.equal(calibrateErrors([]).scale, 1);
  // Underestimated errors must not turn noise into features.
  let found = 0;
  for (let seed = 200; seed < 240; seed++) {
    const r = classify({ binned: spectrum(() => 1, { peak: 1000, noise: 60, seed }).map((p) => ({ ...p, err_uJy: 6 })) });
    for (const id of ['band-3.3', 'band-co2', 'band-co', 'cold-atmosphere']) if (ids(r).includes(id)) found++;
  }
  assert.ok(found <= 2, `${found} false features in 40 spectra with understated errors`);
});

test('isolated spikes from a varying source do not become band hints', () => {
  // A star twice as bright in one pass: a tenth of the channels hold only that pass.
  let found = 0;
  for (let seed = 300; seed < 330; seed++) {
    const base = spectrum((w) => planck(w, 3400), { peak: 8000, noise: 40, seed });
    const mixed = base.map((p, i) => ((i * 7 + seed) % 10 === 0 ? { ...p, flux_uJy: p.flux_uJy * 2 } : (i * 3 + seed) % 23 === 0 ? { ...p, flux_uJy: p.flux_uJy * 0.5 } : p));
    const r = classify({ binned: mixed, lightCurve: lightCurve([1, 2]) });
    assert.ok(r.measures.spikesDropped >= 5, `seed ${seed} dropped ${r.measures.spikesDropped}`);
    assert.equal(classify({ binned: mixed }).measures.spikesDropped, 0, 'nothing is dropped unless the light curve varies');
    for (const id of ['band-3.3', 'band-co2', 'band-co', 'cold-atmosphere']) if (ids(r).includes(id)) found++;
  }
  assert.ok(found <= 1, `${found} false band hints in 30 spiky spectra`);
  // Real bands survive despiking untouched.
  const t = usablePoints(tDwarf());
  assert.equal(despike(t).length, t.length);
  // A steady source keeps even a one-channel band, so narrow CO2 ice is still found.
  const ices = spectrum((w) => w ** 1.2, { noise: 10, bands: [{ center: 4.27, sigma: 0.035, depth: 0.6 }] });
  assert.ok(ids(classify({ binned: ices, lightCurve: lightCurve([1, 1.01]) })).includes('band-co2'));
});

test('spectralSlope recovers a power law', () => {
  const up = spectralSlope(spectrum((w) => w ** 1.5, { noise: 5 }));
  assert.ok(Math.abs(up.alpha - 1.5) < 0.05, `alpha ${up.alpha}`);
  assert.ok(up.err > 0 && up.err < 0.1);
  const rj = spectralSlope(spectrum((w) => w ** -2, { noise: 1 }));
  assert.ok(Math.abs(rj.alpha + 2) < 0.05);
  assert.equal(spectralSlope(spectrum(() => 1).slice(0, 5)), null); // too few points
  assert.equal(spectralSlope(spectrum(() => 1).slice(0, 20)), null); // too short a span
});

test('monthYear converts MJD without a Date object', () => {
  assert.equal(monthYear(51544.5), 'January 2000');
  assert.equal(monthYear(61210.79), 'June 2026');
  assert.equal(monthYear(60850), 'June 2025');
  assert.equal(monthYear(61040), 'December 2025');
  assert.equal(monthYear(60309.99), 'December 2023');
  assert.equal(monthYear(60310), 'January 2024');
  assert.equal(monthYear(NaN), '');
});

// ---- spectra ----------------------------------------------------------------------------------

test('a warm star falls to the red and shows no bands', () => {
  const r = classify({ binned: warmStar() });
  assert.deepEqual(ids(r), ['slope-blue']);
  assert.match(hint(r, 'slope-blue').title, /warm star/);
  assert.match(hint(r, 'slope-blue').text, /falls with wavelength/);
  assert.equal(hint(r, 'slope-blue').confidence, 'likely');
  assert.ok(r.measures.slope.alpha < -1 && r.measures.slope.alpha > -1.3);
  assert.equal(r.disclaimer, DISCLAIMER);
});

test('a dusty source rises to the red', () => {
  const r = classify({ binned: dusty() });
  assert.deepEqual(ids(r), ['slope-red']);
  assert.match(hint(r, 'slope-red').title, /cool or dusty/);
  assert.match(hint(r, 'slope-red').text, /slope \+1\.6/);
  assert.equal(hint(r, 'slope-red').confidence, 'likely');
});

test('a cool star peaks inside the range and gets only a tentative word', () => {
  const r = classify({ binned: coolStar() });
  assert.deepEqual(ids(r), ['slope-flat']);
  assert.equal(hint(r, 'slope-flat').confidence, 'tentative');
  assert.match(hint(r, 'slope-flat').text, /brightest near 1\.[5-9] µm/);
});

test('a T dwarf spectrum yields the methane hints first', () => {
  const r = classify({ binned: tDwarf() });
  assert.equal(ids(r)[0], 'cold-atmosphere');
  assert.ok(ids(r).includes('band-3.3'));
  const cold = hint(r, 'cold-atmosphere');
  assert.match(cold.title, /methane-rich cold atmosphere, like a T or Y dwarf/);
  assert.match(cold.title, /^May be/); // never a certainty
  assert.match(cold.text, /brighter at 4\.5 µm than at 3\.3 µm/);
  assert.ok(['likely', 'strong'].includes(cold.confidence));
  const band = hint(r, 'band-3.3');
  assert.match(band.text, /percent below the level on either side/);
  assert.ok(r.measures.ch4.depth > 0.6);
  assert.ok(r.measures.ratio45to33.value > 5);
  assert.ok(ids(r).includes('slope-red'));
  assert.ok(!ids(r).includes('band-co2') && !ids(r).includes('band-co'));
});

test('a shallow or noisy 3.3 um dip is reported with less confidence, or not at all', () => {
  const shallow = classify({ binned: spectrum((w) => planck(w, 3500), { noise: 15, bands: [{ center: 3.3, sigma: 0.1, depth: 0.3 }] }) });
  assert.ok(ids(shallow).includes('band-3.3'));
  assert.notEqual(hint(shallow, 'band-3.3').confidence, 'strong');
  assert.ok(!ids(shallow).includes('cold-atmosphere')); // a dip without the 4.5 um excess is not a T dwarf
  const noisy = classify({ binned: spectrum((w) => planck(w, 3500), { peak: 300, noise: 150, bands: [{ center: 3.3, sigma: 0.1, depth: 0.3 }] }) });
  assert.ok(!ids(noisy).includes('band-3.3'));
  assert.ok(!ids(noisy).includes('cold-atmosphere'));
  // A red spectrum without a dip is dusty, not methane.
  assert.ok(!ids(classify({ binned: spectrum((w) => w ** 3) })).includes('cold-atmosphere'));
});

test('carbon dioxide and carbon monoxide dips are found where they are', () => {
  const ices = classify({
    binned: spectrum((w) => w ** 1.2, {
      noise: 10,
      bands: [
        { center: 4.27, sigma: 0.035, depth: 0.6 },
        { center: 4.67, sigma: 0.035, depth: 0.45 },
      ],
    }),
  });
  assert.ok(ids(ices).includes('band-co2'));
  assert.ok(ids(ices).includes('band-co'));
  assert.match(hint(ices, 'band-co2').title, /4\.27 µm: carbon dioxide/);
  assert.match(hint(ices, 'band-co').title, /4\.67 µm: carbon monoxide/);
  assert.match(hint(ices, 'band-co2').text, /ice/);
  assert.ok(!ids(ices).includes('band-3.3'));
  const only = classify({ binned: spectrum((w) => w ** 1.2, { noise: 10, bands: [{ center: 4.27, sigma: 0.035, depth: 0.6 }] }) });
  assert.ok(ids(only).includes('band-co2') && !ids(only).includes('band-co'));
});

test('a faint spectrum carries a caution and no false features', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const r = classify({ binned: spectrum(() => 1, { peak: 30, noise: 30, seed }) });
    assert.ok(ids(r).includes('faint'), `seed ${seed}`);
    for (const id of ['band-3.3', 'band-co2', 'band-co', 'cold-atmosphere', 'slope-red', 'slope-blue']) {
      assert.ok(!ids(r).includes(id), `seed ${seed} gave ${id}`);
    }
  }
});

test('pure noise does not produce feature hints', () => {
  let falsePositives = 0;
  for (let seed = 100; seed < 160; seed++) {
    const r = classify({ binned: spectrum(() => 1, { peak: 1000, noise: 60, seed }) });
    for (const id of ['band-3.3', 'band-co2', 'band-co', 'cold-atmosphere']) if (ids(r).includes(id)) falsePositives++;
  }
  assert.ok(falsePositives <= 2, `${falsePositives} false positives in 60 flat noisy spectra`);
});

// ---- light curves -----------------------------------------------------------------------------

function lightCurve(levels, { n = 20, err = 0.03, seed = 7 } = {}) {
  const rand = mulberry32(seed);
  const starts = [60840, 61025, 61205, 61390];
  const out = [];
  levels.forEach((level, k) => {
    for (let i = 0; i < n; i++) out.push({ mjd: starts[k] + (i * 6) / n, ratio: level + err * gaussian(rand), err, wave: 1 + i * 0.1 });
  });
  return out;
}

test('summarizeLightCurve groups passes and finds the largest change', () => {
  const lc = summarizeLightCurve(lightCurve([1, 2, 1]));
  assert.equal(lc.passes.length, 3);
  assert.deepEqual(lc.passes.map((p) => p.n), [20, 20, 20]);
  assert.ok(Math.abs(lc.passes[1].ratio - 2) < 0.03);
  assert.ok(Math.abs(lc.change - 1) < 0.05);
  assert.ok(lc.sigma > 20);
  assert.ok(lc.bright.mjd > 61000 && lc.bright.mjd < 61100);
  assert.equal(summarizeLightCurve([]), null);
  assert.equal(summarizeLightCurve(null), null);
  const single = summarizeLightCurve(lightCurve([1]));
  assert.equal(single.passes.length, 1);
  assert.equal(single.sigma, null);
  // One wild point in a pass does not fake a change.
  const spiky = lightCurve([1, 1]);
  spiky[3].ratio = 40;
  assert.ok(summarizeLightCurve(spiky).sigma < 3);
});

test('a source that doubles between passes is called variable, with dates', () => {
  const r = classify({ lightCurve: lightCurve([1, 2, 1]) });
  assert.deepEqual(ids(r), ['variable']);
  const v = hint(r, 'variable');
  assert.equal(v.confidence, 'strong');
  assert.match(v.title, /^Variable/);
  assert.match(v.text, /About 2\.0 times brighter in December 2025 than in June 202[56]/);
});

test('a steady source is called steady, a noisy one is left alone', () => {
  const steady = classify({ lightCurve: lightCurve([1, 1.01, 0.99]) });
  assert.deepEqual(ids(steady), ['steady']);
  assert.match(hint(steady, 'steady').text, /across 3 survey passes/);
  const small = classify({ lightCurve: lightCurve([1, 1.25], { err: 0.02 }) });
  assert.equal(hint(small, 'variable').confidence, 'likely');
  assert.match(hint(small, 'variable').text, /25 percent brighter/);
  const noisy = classify({ lightCurve: lightCurve([1, 1.1], { n: 4, err: 0.5 }) });
  assert.deepEqual(ids(noisy), []);
  assert.deepEqual(ids(classify({ lightCurve: lightCurve([1]) })), []);
});

// ---- motion and Gaia --------------------------------------------------------------------------

test('compass, formatMotion and Gaia propagation', () => {
  assert.equal(compass(0, 10), 'north');
  assert.equal(compass(10, 10), 'north-east');
  assert.equal(compass(10, 0), 'east');
  assert.equal(compass(-10, -10), 'south-west');
  assert.equal(compass(-1, 100), 'north');
  assert.equal(compass(0, 0), '');
  assert.equal(formatMotion(10393), '10.4 arcsec/yr');
  assert.equal(formatMotion(1500), '1.50 arcsec/yr');
  assert.equal(formatMotion(812.4), '812 mas/yr');
  assert.equal(formatMotion(42.6), '43 mas/yr');
  assert.equal(formatMotion(4.26), '4.3 mas/yr');
  assert.equal(formatMotion(NaN), '');
  assert.equal(formatMotionWithError(10437.7, 180), '10.4 ± 0.2 arcsec/yr');
  assert.equal(formatMotionWithError(1500, 40), '1.50 ± 0.04 arcsec/yr');
  assert.equal(formatMotionWithError(241.9, 30), '242 ± 30 mas/yr');
  assert.equal(formatMotionWithError(41.26, 3.5), '41.3 ± 3.5 mas/yr');
  assert.equal(formatMotionWithError(2000, null), '2.00 arcsec/yr');
  // Barnard's star moves 10.36 arcsec/yr north: ten years after J2016.0 it is 103.6 arcsec up.
  const star = { id: '4472832130942575872', ra: 269.4485, dec: 4.738, pmra: -801.551, pmdec: 10362.394, parallax: 546.98, gmag: 8.2 };
  const pos = gaiaPositionAt(star, 57388.5 + 3652.5);
  assert.ok(Math.abs((pos.dec - star.dec) * 3600 - 103.62) < 0.01);
  assert.ok(Math.abs((pos.ra - star.ra) * 3600 * Math.cos((star.dec * Math.PI) / 180) + 8.016) < 0.01);
  assert.equal(gaiaPositionAt({ ra: NaN, dec: 1 }, 60000), null);
  const still = { id: '1', ra: 269.449, dec: 4.7665, pmra: null, pmdec: null, gmag: 15 };
  // At the 2026 epoch the moving star has passed the still one; at 2016 it had not.
  const now = nearestGaia([still, star], 269.4463, 4.7668, 57388.5 + 3652.5);
  assert.equal(now.star, star);
  assert.ok(now.sepArcsec < 2);
  assert.ok(Math.abs(now.pmTotal - 10393.3) < 0.5);
  assert.equal(now.direction, 'north');
  const then = nearestGaia([still, star], 269.4463, 4.7668, 57388.5);
  assert.equal(then.star, still);
  assert.equal(then.pmTotal, null);
  assert.equal(nearestGaia([], 1, 2, 60000), null);
  assert.equal(nearestGaia(null, 1, 2, 60000), null);
});

test('a mover with no Gaia star is flagged as worth a careful look', () => {
  const motion = { pmra: 120, pmdec: -210, total: 241.9, errTotal: 30, n: 3 };
  const r = classify({ motion, gaia: null });
  assert.deepEqual(ids(r), ['unknown-mover']);
  const h = hint(r, 'unknown-mover');
  assert.equal(h.title, 'Not in Gaia and moving: worth a careful look');
  assert.equal(h.confidence, 'likely');
  assert.match(h.text, /242 ± 30 mas\/yr towards the south-east \(8\.1 sigma\)/);
  // A Gaia star 20 arcsec away is somebody else.
  const far = classify({ motion, gaia: { star: { ra: 1, dec: 1, pmra: 1, pmdec: 1 }, sepArcsec: 20 } });
  assert.deepEqual(ids(far), ['unknown-mover']);
  // Not checked: just "moving".
  assert.deepEqual(ids(classify({ motion })), ['moving']);
  // The pipeline wrapper is understood, and its null Gaia match is not taken as "not in Gaia".
  assert.deepEqual(ids(classify({ motion: { measured: motion, gaia: null, track: [] } })), ['moving']);
  // Weakly detected: tentative.
  assert.equal(hint(classify({ motion: { ...motion, errTotal: 70 }, gaia: null }), 'unknown-mover').confidence, 'tentative');
});

test('motion that agrees with Gaia is said to be that star', () => {
  const star = { id: '4472832130942575872', ra: 269.4485, dec: 4.738, pmra: -801.551, pmdec: 10362.394 };
  const motion = { pmra: -760, pmdec: 10410, total: 10437.7, errTotal: 180, n: 3 };
  const r = classify({ motion, gaia: { star, sepArcsec: 0.8 } });
  assert.deepEqual(ids(r), ['moving']);
  assert.equal(hint(r, 'moving').title, 'Moving, as Gaia predicts');
  assert.equal(hint(r, 'moving').confidence, 'strong');
  assert.match(hint(r, 'moving').text, /Gaia lists 10\.4 arcsec\/yr for the star 0\.8 arcsec away/);
  // The same through the pipeline wrapper.
  const wrapped = classify({ motion: { measured: motion, gaia: { pmra: star.pmra, pmdec: star.pmdec, total: 10393, star } } });
  assert.equal(hint(wrapped, 'moving').title, 'Moving, as Gaia predicts');
});

test('motion that disagrees with Gaia, or is absent, is described without overreach', () => {
  const quiet = { id: '9', ra: 10, dec: 10, pmra: 2, pmdec: -3 };
  const odd = classify({ motion: { pmra: 400, pmdec: 0, total: 400, errTotal: 40 }, gaia: { star: quiet, sepArcsec: 3 } });
  assert.deepEqual(ids(odd), ['moving-unexpected']);
  assert.equal(hint(odd, 'moving-unexpected').confidence, 'likely');
  assert.match(hint(odd, 'moving-unexpected').text, /different object, or a neighbour/);
  const still = classify({ motion: { pmra: 10, pmdec: 5, total: 11.2, errTotal: 40 }, gaia: { star: quiet, sepArcsec: 3 } });
  assert.deepEqual(ids(still), ['still']);
  assert.match(hint(still, 'still').text, /below about 120 mas\/yr \(3 sigma\)/);
  const unseen = classify({ motion: { pmra: 10, pmdec: 5, total: 11.2, errTotal: 40 }, gaia: { star: { ra: 1, dec: 1, pmra: 900, pmdec: 0 }, sepArcsec: 5 } });
  assert.deepEqual(ids(unseen), ['gaia-motion-unseen']);
  const noGaia = classify({ motion: { pmra: 10, pmdec: 5, total: 11.2, errTotal: 40 }, gaia: null });
  assert.deepEqual(ids(noGaia), ['not-in-gaia', 'still']);
  assert.equal(hint(noGaia, 'not-in-gaia').confidence, 'tentative');
  // A large value without an error bar is not trusted unless it is very large.
  assert.deepEqual(ids(classify({ motion: { pmra: 200, pmdec: 0 } })), []);
  assert.deepEqual(ids(classify({ motion: { pmra: 2000, pmdec: 0 } })), ['moving']);
});

test('a fast mover that leaves the aperture is not called variable', () => {
  const motion = { pmra: -800, pmdec: 10370, total: 10400, errTotal: 200, n: 3 };
  const r = classify({ lightCurve: lightCurve([1, 0.4, 0.5]), motion });
  assert.ok(!ids(r).includes('variable'));
  assert.ok(ids(r).includes('faded-by-motion'));
  assert.match(hint(r, 'faded-by-motion').text, /moved about 10 arcsec while the light curve was taken/);
  // A slow mover that changes brightness is still variable.
  const slow = classify({ lightCurve: lightCurve([1, 2, 1]), motion: { pmra: 120, pmdec: -210, total: 241.9, errTotal: 30, n: 3 } });
  assert.ok(ids(slow).includes('variable') && !ids(slow).includes('faded-by-motion'));
});

// ---- size, and everything together ------------------------------------------------------------

test('size estimates distinguish extended from point-like', () => {
  assert.deepEqual(ids(classify({ size: { fwhmArcsec: 15, psfArcsec: 7.5 } })), ['extended']);
  assert.equal(hint(classify({ size: { fwhmArcsec: 15, psfArcsec: 7.5 } }), 'extended').confidence, 'likely');
  assert.equal(hint(classify({ size: { fwhmArcsec: 11, psfArcsec: 7.5 } }), 'extended').confidence, 'tentative');
  assert.deepEqual(ids(classify({ size: { fwhmArcsec: 7.6, psfArcsec: 7.5 } })), ['point-like']);
  assert.deepEqual(ids(classify({ size: { fwhmArcsec: 9.5, psfArcsec: 7.5 } })), []);
  assert.deepEqual(ids(classify({ size: { fwhmArcsec: 9 } })), []);
});

test('the full picture of a cold moving dwarf, in order of consequence', () => {
  const r = classify({
    binned: tDwarf(),
    lightCurve: lightCurve([1, 1, 1]),
    motion: { pmra: 120, pmdec: -210, total: 241.9, errTotal: 30, n: 3 },
    gaia: null,
    size: { fwhmArcsec: 7.4, psfArcsec: 7.5 },
  });
  assert.deepEqual(ids(r).slice(0, 2), ['unknown-mover', 'cold-atmosphere']);
  assert.ok(ids(r).includes('steady') && ids(r).includes('point-like'));
  for (const h of r.hints) {
    assert.deepEqual(Object.keys(h), ['id', 'title', 'text', 'confidence']);
    assert.ok(CONFIDENCE_WORDS.includes(h.confidence));
    assert.ok(!/!/.test(h.title + h.text), 'no exclamation marks');
    assert.ok(!/\b(definitely|certainly|is a (star|galaxy|brown dwarf|T dwarf))\b/i.test(h.title + h.text), `overclaim in ${h.id}`);
    assert.ok(h.text.length > 40 && h.text.length < 420);
  }
});

test('classify never throws on missing or malformed input', () => {
  for (const input of [undefined, null, {}, { binned: null }, { binned: 'x' }, { binned: [{}, null, 3] }, { lightCurve: [{}] }, { motion: 5 }, { motion: {} }, { gaia: {} }, { size: 'big' }, { binned: [{ wave: 1, flux_uJy: 1 }] }]) {
    const r = classify(input);
    assert.deepEqual(r.hints, []);
    assert.equal(r.disclaimer, DISCLAIMER);
  }
  // Spectra with missing errors, zeros and negatives still classify.
  const bare = warmStar().map(({ wave, flux_uJy }) => ({ wave, flux_uJy }));
  assert.ok(ids(classify({ binned: bare })).includes('slope-blue'));
  const holes = tDwarf().map((p, i) => (i % 7 === 0 ? { ...p, flux_uJy: -Math.abs(p.flux_uJy) } : p));
  assert.ok(Array.isArray(classify({ binned: holes }).hints));
});
