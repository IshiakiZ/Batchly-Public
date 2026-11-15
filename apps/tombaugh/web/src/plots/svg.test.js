// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Node tests for the pure parts of the plots: ticks, scales, number and date formatting, unit
// switching, CSV export, the light-curve verdict and the motion verdict. No DOM is needed; the
// plot modules must import cleanly without one.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  niceStep, niceTicks, niceDomain, logTicks, linearScale, logScale,
  formatFixed, formatTick, formatLogTick, formatNumber, errorDecimals, formatWithError,
  fluxUnit, uJyToAbMag, abMagToUJy, abMagErr,
  mjdToDate, dateToMjd, formatMonthYear, formatDayMonthYear, formatIsoDate, formatIsoMinute, timeTicks,
  splitPasses, weightedMean, quantile, extent, detectorOf, positionAngle,
  waveColor, passStyle, csvCell, chemParts, slug, DETECTORS, FEATURES,
} from './svg.js';
import {
  spectrumToCsv, spectrumAxis, assignPasses, passChannelMeans, normalizeModel,
  SPECTRUM_CSV_HEADER, SPECTRUM_EMPTY_TEXT, createSpectrumPlot,
} from './spectrum.js';
import { lightCurveVerdict, epochMeans, lightCurvePanels, createLightCurvePlot } from './lightcurve.js';
import { motionVerdict, normalizeTrack, passPositions, wrapText, MOTION_FEW_TEXT, createMotionMeter } from './motion.js';
import { PLOT_CSS, ensurePlotStyles } from './plots.css.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

// Deterministic pseudo-random numbers for synthetic data.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

// MJD of 2025-06-15, 2025-12-15 and 2026-06-19 (the contract's sample exposure is MJD 61210.79).
const JUN25 = 60841;
const DEC25 = 61024;
const JUN26 = 61210;

function lightCurve(levels, { n = 40, scatter = 0.03, err = 0.03, seed = 7 } = {}) {
  const r = rng(seed);
  const pts = [];
  levels.forEach((level, i) => {
    const t0 = [JUN25, DEC25, JUN26, JUN26 + 183][i];
    for (let k = 0; k < n; k++) {
      pts.push({ mjd: t0 + r() * 10, ratio: level * (1 + scatter * gauss(r)), err: err * level, wave: 0.75 + r() * 4.25 });
    }
  });
  return pts;
}

test('modules import without a DOM and export the contract API', () => {
  assert.equal(typeof createSpectrumPlot, 'function');
  assert.equal(typeof createLightCurvePlot, 'function');
  assert.equal(typeof createMotionMeter, 'function');
  assert.equal(typeof ensurePlotStyles, 'function');
  assert.doesNotThrow(() => ensurePlotStyles(undefined));
  assert.match(PLOT_CSS, /prefers-reduced-motion/);
  assert.equal(SPECTRUM_EMPTY_TEXT, 'Click a source in the image to read its spectrum.');
});

test('niceStep picks 1, 2 or 5 times a power of ten', () => {
  assert.equal(niceStep(10, 5), 2);
  assert.equal(niceStep(1, 5), 0.2);
  assert.equal(niceStep(4.4, 4), 1);
  assert.equal(niceStep(0.03, 3), 0.01);
  assert.equal(niceStep(7000, 5), 1000);
  assert.equal(niceStep(9000, 5), 2000);
  assert.equal(niceStep(26, 5), 5);
  assert.equal(niceStep(0, 5), 1);
  assert.equal(niceStep(NaN, 5), 1);
});

test('niceTicks stays inside the range and has no floating-point noise', () => {
  assert.deepEqual(niceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(niceTicks(0.7, 5.1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(niceTicks(-0.3, 0.3, 3), [-0.2, 0, 0.2]);
  assert.deepEqual(niceTicks(0.05, 0.31, 5), [0.05, 0.1, 0.15, 0.2, 0.25, 0.3]);
  assert.deepEqual(niceTicks(5, 1, 4), [1, 2, 3, 4, 5], 'reversed input is accepted');
  assert.deepEqual(niceTicks(3, 3), [3]);
  assert.deepEqual(niceTicks(NaN, 3), []);
  for (const t of niceTicks(-1234, 9876, 6)) assert.ok(t >= -1234 && t <= 9876 && Number.isInteger(t / 2000));
  assert.ok(Object.is(niceTicks(-1, 1, 2)[1], 0), 'zero is not negative zero');
});

test('niceDomain widens to tick multiples', () => {
  assert.deepEqual(niceDomain(0.13, 0.87, 5), [0.1, 0.9]);
  assert.deepEqual(niceDomain(0.13, 0.87, 2), [0, 1]);
  assert.deepEqual(niceDomain(-3, 47, 5), [-10, 50]);
  assert.deepEqual(niceDomain(2, 2), [1.8, 2.2]);
});

test('logTicks covers decades and adds 2 and 5 on short ranges', () => {
  assert.deepEqual(logTicks(1, 1000), [1, 3, 10, 30, 100, 300, 1000]);
  assert.deepEqual(logTicks(1, 1e5), [1, 10, 100, 1000, 10000, 100000]);
  assert.deepEqual(logTicks(20, 300), [20, 50, 100, 200]);
  assert.deepEqual(logTicks(0.02, 0.5), [0.02, 0.05, 0.1, 0.2, 0.5]);
  assert.deepEqual(logTicks(-1, 10), []);
  assert.ok(logTicks(110, 180).length >= 2, 'falls back to linear ticks inside one decade');
});

test('linear and log scales map, invert and reverse', () => {
  const s = linearScale(0.7, 5.1, 56, 496);
  close(s(0.7), 56);
  close(s(5.1), 496);
  close(s(2.9), 276);
  close(s.invert(276), 2.9);
  const east = linearScale(5, -5, 0, 100); // east to the left
  close(east(5), 0);
  close(east(-5), 100);
  close(east(0), 50);
  const y = linearScale(0, 10, 300, 20); // pixels grow downwards
  close(y(10), 20);
  close(y.invert(160), 5);
  const l = logScale(10, 1000, 300, 20);
  close(l(10), 300);
  close(l(100), 160);
  close(l(1000), 20);
  close(l.invert(160), 100, 1e-9);
  assert.ok(Number.isNaN(l(0)));
  assert.ok(Number.isNaN(l(-5)));
});

test('number formatting', () => {
  assert.equal(formatFixed(10.128, 1), '10.1');
  assert.equal(formatFixed(10128, -2), '10100');
  assert.equal(formatFixed(-0.0001, 2), '0.00');
  assert.equal(formatFixed(NaN, 2), '-');
  assert.equal(formatTick(0.2, 0.2), '0.2');
  assert.equal(formatTick(1, 0.2), '1.0');
  assert.equal(formatTick(1500, 500), '1500');
  assert.equal(formatTick(0.25, 0.05), '0.25');
  assert.equal(formatTick(-0, 1), '0');
  assert.equal(formatLogTick(0.05), '0.05');
  assert.equal(formatLogTick(3000), '3000');
  assert.equal(formatNumber(1234.5, 3), '1235');
  assert.equal(formatNumber(12.345, 3), '12.3');
  assert.equal(formatNumber(1.9, 3), '1.9');
  assert.equal(formatNumber(0.012345, 2), '0.012');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(Infinity), '-');
});

test('value with uncertainty', () => {
  assert.equal(errorDecimals(0.6), 1);
  assert.equal(errorDecimals(0.14), 2, 'an error starting with 1 keeps two figures');
  assert.equal(errorDecimals(600), -2);
  assert.equal(errorDecimals(0.96), 1, '0.96 rounds to 1.0');
  assert.equal(errorDecimals(31, 2), 0);
  assert.equal(errorDecimals(0), null);
  assert.equal(formatWithError(10.128, 0.6).text, '10.1 ± 0.6');
  assert.equal(formatWithError(10128, 600).text, '10100 ± 600');
  assert.equal(formatWithError(412.3, 31.4, 2).text, '412 ± 31');
  assert.equal(formatWithError(0.0123, 0.0014).text, '0.0123 ± 0.0014');
  assert.equal(formatWithError(5.5, NaN).text, '5.5');
});

test('flux unit switching: microJy, mJy, Jy and AB magnitudes', () => {
  assert.deepEqual(fluxUnit(420), { unit: 'uJy', label: 'µJy', factor: 1 });
  assert.equal(fluxUnit(999.9).unit, 'uJy');
  assert.equal(fluxUnit(1000).unit, 'mJy');
  assert.equal(fluxUnit(85000).factor, 1e-3);
  assert.equal(fluxUnit(2.5e6).unit, 'Jy');
  assert.equal(fluxUnit(-5000).unit, 'mJy', 'sign is ignored');
  assert.equal(fluxUnit(NaN).unit, 'uJy');
  close(uJyToAbMag(3631e6), 0, 1e-3); // 3631 Jy is AB 0 (23.9 is the usual rounded zero point)
  close(uJyToAbMag(1), 23.9);
  close(uJyToAbMag(100), 18.9);
  assert.ok(Number.isNaN(uJyToAbMag(0)));
  assert.ok(Number.isNaN(uJyToAbMag(-3)));
  close(abMagToUJy(uJyToAbMag(321.5)), 321.5, 1e-9);
  close(abMagErr(100, 10), 0.108574, 1e-5);
  assert.ok(Number.isNaN(abMagErr(-1, 1)));
});

test('spectrumAxis chooses units, ticks and direction', () => {
  const faint = [];
  for (let i = 0; i < 50; i++) faint.push({ f: 100 + i * 8, e: 10, robust: true });
  const lin = spectrumAxis(faint, { units: 'flux' });
  assert.equal(lin.mode, 'linear');
  assert.equal(lin.unit.unit, 'uJy');
  assert.equal(lin.title, 'Flux density (µJy)');
  assert.equal(lin.domain[0], 0, 'a linear flux axis starts at zero');
  assert.ok(lin.domain[1] > 492 && lin.domain[1] < 560);
  assert.deepEqual(lin.ticks.map((t) => t.label), ['0', '100', '200', '300', '400', '500']);

  const bright = faint.map((s) => ({ ...s, f: s.f * 20, e: s.e * 20 }));
  const mjy = spectrumAxis(bright, {});
  assert.equal(mjy.unit.unit, 'mJy');
  assert.equal(mjy.ticks[1].label, '2');
  close(mjy.ticks[1].v, 2000, 1e-6); // tick values stay in microJy

  const log = spectrumAxis(faint, { logY: true });
  assert.equal(log.mode, 'log');
  assert.ok(log.domain[0] > 0 && log.domain[0] < 110 && log.domain[1] > 492);
  assert.ok(Number.isNaN(log.value(-4)));
  assert.ok(log.ticks.length >= 2);

  const ab = spectrumAxis(faint, { units: 'ab', logY: true });
  assert.equal(ab.mode, 'ab', 'AB view ignores the log toggle');
  assert.ok(ab.domain[0] > ab.domain[1], 'faint magnitudes at the bottom, bright at the top');
  close(ab.value(100), 18.9);
  assert.ok(ab.ticks.every((t) => t.v <= ab.domain[0] && t.v >= ab.domain[1]));

  // One wild exposure must not flatten the plot, but channel means are always inside.
  const wild = faint.concat([{ f: 1e6, e: 10, robust: true }]);
  assert.ok(spectrumAxis(wild, {}).domain[1] < 3e5);
  assert.ok(spectrumAxis(faint.concat([{ f: 5000, e: 0 }]), {}).domain[1] >= 5000);

  const negative = spectrumAxis([{ f: -30, e: 10, robust: true }, { f: 50, e: 10, robust: true }], {});
  assert.ok(negative.domain[0] < -30);
  const none = spectrumAxis([], {});
  assert.deepEqual(none.domain.map((v) => Math.round(v)), [0, 1]);
  assert.doesNotThrow(() => spectrumAxis([{ f: NaN }], { units: 'ab' }));
});

test('dates', () => {
  assert.equal(mjdToDate(40587).toISOString(), '1970-01-01T00:00:00.000Z');
  close(dateToMjd(new Date(Date.UTC(2025, 5, 15))), JUN25);
  assert.equal(formatMonthYear(61210.79244684), 'Jun 2026');
  assert.equal(formatIsoDate(61210.79244684), '2026-06-19');
  assert.equal(formatIsoMinute(61210.79244684), '2026-06-19 19:01');
  assert.equal(formatDayMonthYear(JUN25), '15 Jun 2025');
  assert.equal(formatMonthYear(NaN), '');
});

test('timeTicks gives day ticks for a pass and month ticks for a long span', () => {
  const pass = timeTicks(JUN25, JUN25 + 12, 4);
  assert.equal(pass.unit, 'day');
  assert.equal(pass.caption, 'Jun 2025');
  assert.deepEqual(pass.ticks.map((t) => t.label), ['19', '24']);
  assert.ok(pass.ticks.every((t) => t.mjd >= JUN25 && t.mjd <= JUN25 + 12));
  assert.ok(timeTicks(JUN25, JUN25 + 12, 13).ticks.length === 13);

  const cross = timeTicks(JUN25 + 10, JUN25 + 22, 4); // 25 Jun to 7 Jul
  assert.equal(cross.caption, 'Jun–Jul 2025');
  assert.equal(timeTicks(61020, 61045, 4).caption, 'Dec 2025 – Jan 2026');

  const year = timeTicks(JUN25, JUN26, 4);
  assert.equal(year.unit, 'month');
  assert.equal(year.caption, '2025–2026');
  assert.ok(year.ticks.length >= 2 && year.ticks.length <= 5);
  for (const t of year.ticks) assert.equal(mjdToDate(t.mjd).getUTCDate(), 1, 'month ticks fall on the 1st');
  assert.match(year.ticks[0].label, /^[A-Z][a-z]{2} 2025$/);

  const sameYear = timeTicks(60700, 60900, 6);
  assert.equal(sameYear.caption, '2025');
  assert.ok(sameYear.ticks.every((t) => /^[A-Z][a-z]{2}$/.test(t.label)));
  assert.deepEqual(timeTicks(NaN, 1).ticks, []);
});

test('splitPasses, weightedMean, quantile, extent', () => {
  const items = [{ mjd: 61210 }, { mjd: 60841 }, { mjd: 60845 }, { mjd: 61024 }, { mjd: NaN }, null];
  const passes = splitPasses(items);
  assert.deepEqual(passes.map((p) => p.length), [2, 1, 1]);
  assert.equal(passes[0][0].mjd, 60841);
  assert.equal(splitPasses(items, 400).length, 1);
  assert.deepEqual(splitPasses([]), []);

  const m = weightedMean([1, 3], [1, 1]);
  close(m.mean, 2);
  close(m.err, Math.SQRT1_2 * Math.sqrt(2), 1e-12); // formal 0.707 inflated by sqrt(chi2_red = 2)
  close(weightedMean([10, 20], [1, 1e6]).mean, 10, 1e-6);
  close(weightedMean([1, 2, 3], null).mean, 2);
  close(weightedMean([1, 2, 3], null).err, Math.sqrt(1 / 3), 1e-12);
  assert.equal(weightedMean([], []).n, 0);
  assert.ok(weightedMean([2.5], [0.1]).err === 0.1);

  close(quantile([1, 2, 3, 4, 5], 0.5), 3);
  close(quantile([5, 1, NaN, 3], 0.25), 2);
  assert.ok(Number.isNaN(quantile([], 0.5)));
  assert.deepEqual(extent([3, NaN, -1, 8]), [-1, 8]);
  assert.equal(extent([NaN]), null);
});

test('detectors, position angle, colours, small text helpers', () => {
  assert.equal(DETECTORS.length, 6);
  assert.equal(detectorOf(0.9), 1);
  assert.equal(detectorOf(1.3), 2);
  assert.equal(detectorOf(3.3), 4);
  assert.equal(detectorOf(4.67), 6);
  assert.equal(detectorOf(1.095), 1, 'a wavelength in a gap goes to the nearer band');
  assert.equal(detectorOf(6), 0);
  assert.equal(detectorOf(NaN), 0);
  assert.deepEqual(FEATURES.map((f) => f.wave), [1.4, 1.9, 3.05, 3.3, 4.27, 4.67]);

  close(positionAngle(0, 1), 0);
  close(positionAngle(1, 0), 90); // due east
  close(positionAngle(0, -1), 180);
  close(positionAngle(-1, 0), 270);
  close(positionAngle(-801.551, 10362.394), 355.577, 1e-3); // Barnard's Star
  assert.ok(Number.isNaN(positionAngle(0, 0)));

  assert.equal(waveColor(0.75), 'rgb(57,135,229)');
  assert.equal(waveColor(5.0), 'rgb(217,138,28)');
  assert.equal(waveColor(99), waveColor(5.0));
  assert.match(waveColor(NaN), /^rgb\(/);
  assert.notEqual(passStyle(0).color, passStyle(1).color);
  assert.equal(passStyle(3).shape, 'diamond');
  assert.equal(passStyle(9).shape, 'square');

  assert.equal(csvCell(1.5), '1.5');
  assert.equal(csvCell(NaN), '');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(true), '1');
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.deepEqual(chemParts('CH4'), [{ text: 'CH', sub: false }, { text: '4', sub: true }]);
  assert.deepEqual(chemParts('H2O').map((p) => p.text), ['H', '2', 'O']);
  assert.deepEqual(chemParts('ice'), [{ text: 'ice', sub: false }]);
  assert.equal(chemParts('CH4 / PAH').map((p) => p.text).join(''), 'CH4 / PAH');
  assert.equal(slug("Barnard's Star"), 'barnard-s-star');
  assert.equal(slug(''), 'source');
});

test('spectrum CSV, passes, per-pass means and model shapes', () => {
  const points = [
    { flux_uJy: 300, err_uJy: 20, wave: 3.3, bw: 0.09, mjd: DEC25 + 1, flagged: true, ok: true, det: 4 },
    { flux_uJy: 812.5, err_uJy: 31, wave: 1.25, bw: 0.03, mjd: 61210.79244684, flagged: false, ok: true },
    { flux_uJy: NaN, err_uJy: NaN, wave: 2.0, bw: 0.05, mjd: JUN25, flagged: false, ok: false },
  ];
  const csv = spectrumToCsv(points);
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines[0], SPECTRUM_CSV_HEADER);
  assert.equal(lines.length, 4, 'header plus every point, failed ones included');
  assert.equal(lines[1], '1.25,0.03,812.5,31,61210.79244684,2026-06-19,2,3,0,1');
  assert.equal(lines[2], '2,0.05,,,60841,2025-06-15,3,1,0,0');
  assert.equal(lines[3], `3.3,0.09,300,20,${DEC25 + 1},2025-12-16,4,2,1,1`);
  assert.equal(spectrumToCsv([]), `${SPECTRUM_CSV_HEADER}\n`);
  assert.equal(spectrumToCsv(null), `${SPECTRUM_CSV_HEADER}\n`);

  const { passOf, passes } = assignPasses(points);
  assert.deepEqual(passes.map((p) => p.label), ['Jun 2025', 'Dec 2025', 'Jun 2026']);
  assert.equal(passOf.get(points[1]), 2);

  const pts = [];
  for (let i = 0; i < 20; i++) {
    pts.push({ wave: 1.2 + (i % 2) * 0.001, flux_uJy: 100, err_uJy: 5, mjd: JUN25 + i * 0.1, ok: true });
    pts.push({ wave: 1.2 + (i % 2) * 0.001, flux_uJy: 200, err_uJy: 5, mjd: DEC25 + i * 0.1, ok: true });
  }
  const a = assignPasses(pts);
  const means = passChannelMeans(pts, a.passOf, a.passes.length);
  assert.equal(means.length, 2);
  assert.equal(means[0].length, 1);
  close(means[0][0].flux_uJy, 100);
  close(means[1][0].flux_uJy, 200);
  assert.equal(means[1][0].n, 20);

  assert.deepEqual(normalizeModel([{ wave: 2, flux_uJy: 5 }, { wave: 1, flux_uJy: 3 }, { wave: NaN, flux_uJy: 1 }]),
    [{ wave: 1, flux_uJy: 3 }, { wave: 2, flux_uJy: 5 }]);
  assert.deepEqual(normalizeModel({ wave: [1, 2], flux_uJy: [3, 5] }), [{ wave: 1, flux_uJy: 3 }, { wave: 2, flux_uJy: 5 }]);
  const fn = normalizeModel((w) => w * 10);
  assert.ok(fn.length > 100 && fn[0].wave >= 0.7 && fn[fn.length - 1].wave <= 5.1);
  assert.deepEqual(normalizeModel(null), []);
});

test('light-curve verdict: a clear change', () => {
  const v = lightCurveVerdict(lightCurve([0.7, 1.33, 0.97]));
  assert.equal(v.kind, 'changed');
  assert.equal(v.changed, true);
  assert.equal(v.direction, 'rose');
  assert.equal(v.from.label, 'Jun 2025');
  assert.equal(v.to.label, 'Dec 2025');
  assert.ok(v.factor > 1.85 && v.factor < 1.95, `factor ${v.factor}`);
  assert.ok(v.sigma > 5);
  assert.match(v.text, /^Brightness rose by a factor of 1\.9 between Jun 2025 and Dec 2025 \(\d+ sigma\)\.$/);
  assert.equal(v.epochs.length, 3);
});

test('light-curve verdict: a fall and a small but real change', () => {
  const fall = lightCurveVerdict(lightCurve([1.5, 0.5]));
  assert.equal(fall.direction, 'fell');
  assert.match(fall.text, /^Brightness fell by a factor of 3\.0 between Jun 2025 and Dec 2025 \(\d+ sigma\)\.$/);

  const small = lightCurveVerdict(lightCurve([1.0, 1.12], { n: 200, scatter: 0.01, err: 0.01 }));
  assert.equal(small.kind, 'changed');
  assert.match(small.text, /^Brightness rose by 12 percent between Jun 2025 and Dec 2025 \(\d+(\.\d)? sigma\)\.$/);
});

test('light-curve verdict: steady, possible, single pass, empty and noisy', () => {
  const steady = lightCurveVerdict(lightCurve([1, 1, 1], { n: 300, scatter: 0.01, err: 0.01 }));
  assert.equal(steady.kind, 'steady');
  assert.equal(steady.changed, false);
  assert.equal(steady.text, 'No change larger than 5 percent detected.');
  assert.equal(steady.limitPercent, 5);

  const looser = lightCurveVerdict(lightCurve([1, 1.01], { n: 6, scatter: 0.08, err: 0.08 }));
  assert.equal(looser.kind, 'steady');
  assert.ok(looser.limitPercent > 5 && looser.limitPercent <= 100);
  assert.equal(looser.text, `No change larger than ${looser.limitPercent} percent detected.`);

  const pts = [];
  for (let i = 0; i < 10; i++) {
    pts.push({ mjd: JUN25 + i, ratio: 1.0, err: 0.1 });
    pts.push({ mjd: DEC25 + i, ratio: 1.18, err: 0.1 });
  }
  const possible = lightCurveVerdict(pts); // 0.18 / hypot(0.0332, 0.0338) = 3.8 sigma
  assert.equal(possible.kind, 'possible');
  assert.match(possible.text, /^Possible change of 18 percent between Jun 2025 and Dec 2025 \(3\.\d sigma\): not enough to be sure\.$/);

  const single = lightCurveVerdict(lightCurve([1.2]));
  assert.equal(single.kind, 'single');
  assert.match(single.text, /Only one survey pass so far \(Jun 2025\)/);

  assert.equal(lightCurveVerdict([]).kind, 'empty');
  assert.equal(lightCurveVerdict(null).kind, 'empty');
  assert.equal(lightCurveVerdict([{ mjd: NaN, ratio: 1 }]).kind, 'empty');

  const noisy = lightCurveVerdict([
    { mjd: JUN25, ratio: 1, err: 0.9 }, { mjd: JUN25 + 1, ratio: 1.4, err: 0.9 },
    { mjd: DEC25, ratio: 1.1, err: 0.9 }, { mjd: DEC25 + 1, ratio: 0.7, err: 0.9 },
  ]);
  assert.equal(noisy.kind, 'noisy');
  assert.doesNotThrow(() => lightCurveVerdict([{ mjd: JUN25, ratio: -1 }, { mjd: DEC25, ratio: 2 }]));
});

test('epoch means: passes, calibration floor, long passes are binned, labels stay unique', () => {
  const e = epochMeans(lightCurve([0.7, 1.33, 0.97]));
  assert.equal(e.length, 3);
  assert.deepEqual(e.map((x) => x.label), ['Jun 2025', 'Dec 2025', 'Jun 2026']);
  close(e[0].mean, 0.7, 0.02);
  close(e[1].mean, 1.33, 0.03);
  for (const x of e) assert.ok(x.errTotal >= 0.01 * x.mean && x.errTotal >= x.err && x.n === 40);

  // Continuous coverage for 200 days (a source near an ecliptic pole) with a slow rise.
  const long = [];
  for (let d = 0; d < 200; d += 2) long.push({ mjd: JUN25 + d, ratio: 0.8 + 0.004 * d, err: 0.02 });
  const bins = epochMeans(long);
  assert.ok(bins.length >= 6 && bins.length <= 8, `${bins.length} bins`);
  assert.equal(new Set(bins.map((b) => b.label)).size, bins.length, 'labels are unique');
  assert.ok(bins.every((b) => b.pass === 0));
  const v = lightCurveVerdict(long);
  assert.equal(v.kind, 'changed');
  assert.equal(v.direction, 'rose');
});

test('light-curve panels: one per pass, shares add up, too many passes merge', () => {
  const panels = lightCurvePanels(lightCurve([1, 1, 1]));
  assert.equal(panels.length, 3);
  close(panels.reduce((s, p) => s + p.share, 0), 1, 1e-12);
  for (const p of panels) {
    assert.ok(p.t0 < p.points[0].mjd && p.t1 > p.points[p.points.length - 1].mjd, 'domain is padded');
    assert.ok(p.share > 0.25 && p.share < 0.4);
  }
  assert.equal(lightCurvePanels(lightCurve([1, 1, 1, 1]), { maxPanels: 3 }).length, 1);
  assert.deepEqual(lightCurvePanels([]), []);
  const one = lightCurvePanels([{ mjd: JUN25, ratio: 1 }]);
  assert.ok(one[0].t1 - one[0].t0 >= 2, 'a single exposure still gets a usable time range');
});

test('motion verdict: agreement, disagreement, unexplained, static, too few passes', () => {
  const barnardGaia = { pmra: -801.551, pmdec: 10362.394, total: 10393.349 };
  const agree = motionVerdict({ pmra: -779, pmdec: 10070, total: 10100, errTotal: 600 }, barnardGaia, { passes: 3 });
  assert.equal(agree.kind, 'agree');
  assert.equal(agree.signal, false);
  assert.equal(agree.unit, 'arcsec/yr');
  assert.equal(agree.text, 'Measured 10.1 ± 0.6 arcsec/yr; Gaia says 10.39. Agreement within 0.5 sigma.');

  const differ = motionVerdict({ pmra: 3000, pmdec: 4000, total: 5000, errTotal: 300 }, barnardGaia);
  assert.equal(differ.kind, 'disagree');
  assert.equal(differ.signal, true);
  assert.match(differ.text, /^Measured 5\.0 ± 0\.3 arcsec\/yr; Gaia says 10\.39\. They differ by \d+ sigma\.$/);

  const alone = motionVerdict({ pmra: 3000, pmdec: 4000, total: 5000, errTotal: 300 }, null, { passes: 2 });
  assert.equal(alone.kind, 'unexplained');
  assert.equal(alone.signal, true);
  assert.equal(alone.text, 'Measured 5.0 ± 0.3 arcsec/yr. No Gaia star here: this motion is unexplained.');

  const still = motionVerdict({ pmra: 80, pmdec: -90, total: 120, errTotal: 300 }, { pmra: 8, pmdec: -9, total: 12.04 });
  assert.equal(still.kind, 'static');
  assert.equal(still.signal, false);
  assert.equal(still.text, 'No motion detected: less than 0.72 arcsec/yr (2 sigma). Gaia says 0.012: too small to see here.');

  const zero = motionVerdict({ pmra: 0, pmdec: 0, total: 0, errTotal: 250 }, null);
  assert.equal(zero.kind, 'static');
  assert.equal(zero.text, 'No motion detected: less than 0.5 arcsec/yr (2 sigma).');
  assert.equal(motionVerdict({ pmra: 0, pmdec: 0, total: 0 }, null).text, 'No motion detected.');

  const missed = motionVerdict({ pmra: 0, pmdec: 100, total: 100, errTotal: 300 }, barnardGaia);
  assert.equal(missed.kind, 'disagree');
  assert.match(missed.text, /Gaia says 10: that should have shown up\.$/);

  assert.equal(motionVerdict(null, barnardGaia).kind, 'few');
  assert.equal(motionVerdict(null, null).text, MOTION_FEW_TEXT);
  assert.equal(motionVerdict({ pmra: 1, pmdec: 1, total: 1.4, errTotal: 1 }, null, { passes: 1 }).kind, 'few');

  // Small motions are quoted in mas/yr; total is recomputed when missing.
  const slow = motionVerdict({ pmra: 30, pmdec: 40, errTotal: 5 }, { pmra: 31, pmdec: 42 });
  assert.equal(slow.unit, 'mas/yr');
  assert.match(slow.text, /^Measured 50 ± 5 mas\/yr; Gaia says 52\.2\. Agreement within 0\.4 sigma\.$/);
  assert.equal(motionVerdict({ pmra: 3000, pmdec: 4000 }, barnardGaia).kind, 'measured');
  assert.match(motionVerdict({ pmra: 3000, pmdec: 4000, errTotal: 300 }, { pmra: null, pmdec: null }).text,
    /Gaia has a star here but lists no motion for it\.$/);
});

test('track normalisation and per-pass positions', () => {
  const offsets = normalizeTrack([
    { mjd: DEC25, dEast_arcsec: -0.4, dNorth_arcsec: 5.2, err_arcsec: 0.3 },
    { mjd: JUN25, dEast_arcsec: 0, dNorth_arcsec: 0, err_arcsec: 0.3 },
    { mjd: NaN, dEast_arcsec: 1, dNorth_arcsec: 1 },
    { mjd: JUN26 },
  ]);
  assert.deepEqual(offsets, [{ mjd: JUN25, e: 0, n: 0, err: 0.3 }, { mjd: DEC25, e: -0.4, n: 5.2, err: 0.3 }]);

  // RA/Dec input: one arcsec north and one arcsec east (RA scaled by cos dec) at dec 60.
  const sky = normalizeTrack([
    { mjd: JUN25, ra: 10, dec: 60 },
    { mjd: DEC25, ra: 10 + 1 / 3600 / Math.cos(Math.PI / 3), dec: 60 + 1 / 3600 },
  ]);
  close(sky[0].e, 0);
  close(sky[1].e, 1, 1e-6);
  close(sky[1].n, 1, 1e-6);
  assert.ok(Number.isNaN(sky[1].err));
  const wrap = normalizeTrack([{ mjd: 1, ra: 359.9999, dec: 0 }, { mjd: 2, ra: 0.0001, dec: 0 }]);
  close(wrap[1].e, 0.72, 1e-6); // RA wraps through zero

  const track = [];
  for (let i = 0; i < 5; i++) {
    track.push({ mjd: JUN25 + i, dEast_arcsec: 0.1 * (i - 2), dNorth_arcsec: 0, err_arcsec: 0.3 });
    track.push({ mjd: DEC25 + i, dEast_arcsec: -0.4, dNorth_arcsec: 5.2 + 0.1 * (i - 2), err_arcsec: 0.3 });
  }
  const passes = passPositions(track);
  assert.equal(passes.length, 2);
  assert.deepEqual(passes.map((p) => p.label), ['Jun 2025', 'Dec 2025']);
  close(passes[0].e, 0, 1e-12);
  close(passes[1].n, 5.2, 1e-12);
  assert.equal(passes[1].count, 5);
  close(passes[0].err, 0.3 / Math.sqrt(5), 1e-12);
  assert.deepEqual(passPositions([]), []);
  assert.equal(passPositions([{ mjd: JUN25, dEast_arcsec: 0, dNorth_arcsec: 0, err_arcsec: 0.25 }])[0].err, 0.25);
  assert.deepEqual(wrapText(MOTION_FEW_TEXT, 28), ['Need at least two survey', 'passes to measure motion.']);
});
