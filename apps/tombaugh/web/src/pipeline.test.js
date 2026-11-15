// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Tests for the view-mode pipeline. The pipeline takes its science functions through `lib`, so
// these run against the built-in fallbacks ({}), and against small fakes where a view needs more.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIEW_INFO,
  buildMovie,
  channelOfLayer,
  channelRange,
  clusterCandidates,
  describePasses,
  fmtDistance,
  fmtWave,
  gaiaGhosts,
  lensDetectors,
  measureMotion,
  passHop,
  prepareResidual,
  selectChannel,
  splitPasses,
  timelineGroups,
  trackOffsets,
} from './pipeline.js';

const N = 16;
const GRID = { ra0: 150, dec0: 2, n: N, scale: 3.075 };

/** A flat sky at `sky` with one Gaussian-ish source at (sx, sy). */
function layer({ mjd, wave = 2.0, det = 3, sky = 0, sx = 8, sy = 8, flux = 100, bad = null }) {
  const image = new Float32Array(N * N);
  const variance = new Float32Array(N * N).fill(1);
  const mask = new Uint8Array(N * N);
  const wav = new Float32Array(N * N).fill(wave);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const r2 = (x - sx) ** 2 + (y - sy) ** 2;
      image[y * N + x] = sky + flux * Math.exp(-r2 / 2);
    }
  }
  if (bad !== null) mask[bad] = 1;
  return { image, variance, mask, wave: wav, mjd, det, frame: { id: `f${mjd}`, det, mjd, waveCenter: wave } };
}

/** Two passes (60 days apart is more than the 45-day gap), three exposures each. */
function twoPasses(opts = {}) {
  const out = [];
  for (let i = 0; i < 3; i++) out.push(layer({ mjd: 60800 + i, wave: 1.7 + 0.2 * i, ...opts.first }));
  for (let i = 0; i < 3; i++) out.push(layer({ mjd: 60980 + i, wave: 1.7 + 0.2 * i, ...opts.second }));
  return out;
}

// Flat-sky pixel <-> sky maps that are good enough for tests near the grid centre.
const gridLib = {
  gridSkyToPix(grid, ra, dec) {
    const c = (grid.n - 1) / 2;
    const cosd = Math.cos((grid.dec0 * Math.PI) / 180);
    return [c - ((ra - grid.ra0) * cosd * 3600) / grid.scale, c + ((dec - grid.dec0) * 3600) / grid.scale];
  },
  gridPixToSky(grid, x, y) {
    const c = (grid.n - 1) / 2;
    const cosd = Math.cos((grid.dec0 * Math.PI) / 180);
    return [grid.ra0 - ((x - c) * grid.scale) / 3600 / cosd, grid.dec0 + ((y - c) * grid.scale) / 3600];
  },
  centroid(image, mask, n, x, y, { box = 5 } = {}) {
    let sx = 0;
    let sy = 0;
    let s = 0;
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    for (let j = y0 - box; j <= y0 + box; j++) {
      for (let i = x0 - box; i <= x0 + box; i++) {
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const v = image[j * n + i];
        if (!Number.isFinite(v) || v <= 0) continue;
        sx += v * i;
        sy += v * j;
        s += v;
      }
    }
    if (!(s > 0)) return { ok: false };
    return { ok: true, x: sx / s, y: sy / s, flux: s, xErr: 0.05, yErr: 0.05, snr: 50 };
  },
};

test('VIEW_INFO lists the seven view modes in control order', () => {
  assert.deepEqual(
    VIEW_INFO.map((v) => v.id),
    ['passes', 'exposures', 'matched', 'residual', 'diff', 'lens', 'distance'],
  );
  for (const v of VIEW_INFO) {
    assert.ok(v.label && v.hint && v.about, `view ${v.id} has label, hint and about text`);
  }
});

test('formatting helpers', () => {
  assert.equal(fmtDistance(Infinity), 'infinity');
  assert.match(fmtDistance(40), /^40(\.0)? AU$/);
  assert.match(fmtWave(2.345), /^2\.345/);
  assert.equal(typeof fmtWave(NaN), 'string');
});

test('splitPasses falls back to a 45-day gap and honours lib.splitPasses', () => {
  const items = [{ mjd: 3 }, { mjd: 1 }, { mjd: 100 }, { mjd: 2 }];
  const local = splitPasses({}, items);
  assert.deepEqual(local.map((p) => p.map((i) => i.mjd)), [[1, 2, 3], [100]]);
  const viaLib = splitPasses({ splitPasses: (x) => [x.slice(0, 1), [], x.slice(1)] }, items);
  assert.equal(viaLib.length, 2, 'empty groups are dropped');
  const broken = splitPasses({ splitPasses: () => { throw new Error('nope'); } }, items);
  assert.equal(broken.length, 2, 'a throwing core function falls back');
});

test('describePasses labels each pass with its dates', () => {
  const passes = describePasses({}, twoPasses());
  assert.equal(passes.length, 2);
  assert.equal(passes[0].index, 0);
  assert.equal(passes[0].layers.length, 3);
  assert.ok(passes[0].mjd0 <= passes[0].mjd && passes[0].mjd <= passes[0].mjd1);
  assert.match(passes[0].dates, /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/);
  assert.notEqual(passes[0].label, passes[1].label);
});

test('passes view: one frame per pass, shared range, sky level removed', () => {
  const layers = twoPasses({ first: { sky: 5 }, second: { sky: 9 } });
  const movie = buildMovie('passes', { layers, grid: GRID, det: 3 }, {});
  assert.equal(movie.view, 'passes');
  assert.equal(movie.empty, null);
  assert.equal(movie.frames.length, 2);
  const [a, b] = movie.frames;
  assert.deepEqual(a.range, b.range, 'blinked frames share one display range');
  assert.ok(a.range[1] > a.range[0]);
  assert.ok(Math.abs(a.image[0]) < 1e-3 && Math.abs(b.image[0]) < 1e-3, 'different sky levels are normalised away');
  assert.ok(a.image[8 * N + 8] > 90, 'the source survives stacking');
  assert.equal(a.pass, 0);
  assert.equal(b.pass, 1);
  assert.match(a.caption.title, /^Pass 1 of 2/);
  assert.match(a.caption.note, /3 exposures stacked/);
  assert.match(a.caption.wave, /D3/);
  for (const f of movie.frames) {
    for (const key of ['title', 'date', 'wave', 'note']) assert.equal(typeof f.caption[key], 'string');
    assert.equal(f.image.length, N * N);
    assert.equal(f.mask.length, N * N);
  }
});

test('passes view notes a single pass, and no layers gives a plain reason', () => {
  const one = buildMovie('passes', { layers: twoPasses().slice(0, 3), grid: GRID, det: 3 }, {});
  assert.equal(one.frames.length, 1);
  assert.equal(one.notes.length, 1);
  const none = buildMovie('passes', { layers: [], grid: GRID, det: 3 }, {});
  assert.equal(none.frames.length, 0);
  assert.match(none.empty, /No exposures/);
  assert.equal(buildMovie('nonsense', { layers: twoPasses(), grid: GRID, det: 3 }, {}).view, 'passes', 'unknown views fall back');
});

test('masked pixels are left out of a stack', () => {
  const layers = twoPasses().slice(0, 3).map((l) => ({ ...l, mask: Uint8Array.from(l.mask, (_, i) => (i === 5 ? 1 : 0)) }));
  const movie = buildMovie('passes', { layers, grid: GRID, det: 3 }, {});
  assert.equal(movie.frames[0].mask[5], 1);
  assert.ok(Number.isNaN(movie.frames[0].image[5]));
  assert.equal(movie.frames[0].mask[6], 0);
});

test('exposures view: one frame per exposure in time order, grouped by pass', () => {
  const layers = twoPasses();
  const movie = buildMovie('exposures', { layers: [...layers].reverse(), grid: GRID, det: 3 }, {});
  assert.equal(movie.frames.length, 6);
  const mjds = movie.frames.map((f) => f.mjd);
  assert.deepEqual(mjds, [...mjds].sort((x, y) => x - y));
  assert.match(movie.frames[0].caption.title, /^Exposure 1 of 6$/);
  const groups = timelineGroups(movie.frames);
  assert.deepEqual(
    groups.map((g) => [g.pass, g.start, g.end]),
    [
      [0, 0, 2],
      [1, 3, 5],
    ],
  );
  assert.ok(groups[0].label);
});

test('timelineGroups handles an empty movie and a single frame', () => {
  assert.deepEqual(timelineGroups([]), []);
  assert.deepEqual(timelineGroups([{ pass: 0, passLabel: 'x' }]), [{ pass: 0, label: 'x', start: 0, end: 0 }]);
});

test('channel helpers split a detector into 17 log-spaced channels', () => {
  const [lo] = channelRange({}, 3, 0);
  const [, hi] = channelRange({}, 3, 16);
  assert.ok(Math.abs(lo - 1.63) < 0.02 && Math.abs(hi - 2.41) < 0.02);
  const mid = channelRange({}, 3, 8);
  const wave = Math.sqrt(mid[0] * mid[1]);
  assert.equal(channelOfLayer({}, { det: 3, frame: { det: 3, waveCenter: wave } }), 8);
  assert.equal(channelOfLayer({}, { det: 3, frame: { det: 3, waveCenter: 0.1 } }), 0, 'clamped below');
  assert.equal(channelOfLayer({ channelOf: () => 4 }, { det: 3, frame: { det: 3, waveCenter: wave } }), 4, 'core wins when present');
});

test('selectChannel widens to neighbours until two exposures match', () => {
  const lib = { channelOf: (det, wave) => Math.round(wave) };
  const mk = (ch, mjd) => ({ det: 3, mjd, frame: { det: 3, waveCenter: ch } });
  const layers = [mk(2, 1), mk(8, 2), mk(8, 3), mk(9, 4), mk(14, 5)];
  const exact = selectChannel(lib, layers, 8);
  assert.equal(exact.radius, 0);
  assert.equal(exact.layers.length, 2);
  assert.deepEqual([exact.chLo, exact.chHi], [8, 8]);
  const widened = selectChannel(lib, layers, 13);
  assert.equal(widened.radius, 4);
  assert.deepEqual(widened.layers.map((l) => l.mjd), [4, 5]);
  assert.deepEqual([widened.chLo, widened.chHi], [9, 14]);
  const lonely = selectChannel(lib, [mk(3, 1)], 8);
  assert.equal(lonely.layers.length, 1, 'with a single exposure everything is used');
});

test('matched view stacks only the chosen channel and says when it widened', () => {
  const lib = { channelOf: (det, wave) => Math.round((wave - 1.7) / 0.2) };
  const layers = twoPasses();
  const movie = buildMovie('matched', { layers, grid: GRID, det: 3, ch: 1 }, lib);
  assert.equal(movie.frames.length, 2);
  assert.deepEqual(movie.channels, [1, 1]);
  assert.match(movie.frames[0].caption.note, /1 exposure at matched wavelength/);
  assert.match(movie.frames[0].caption.wave, /^channel 2/);
  assert.equal(movie.notes.length, 0);
  const wide = buildMovie('matched', { layers: layers.slice(0, 3), grid: GRID, det: 3, ch: 1 }, lib);
  assert.ok(wide.notes.some((n) => /combined/.test(n)));
});

test('difference view subtracts the earlier pass from the later one', () => {
  const layers = twoPasses({ first: { sx: 5 }, second: { sx: 11 } });
  const movie = buildMovie('diff', { layers, grid: GRID, det: 3, diffA: 0, diffB: -1 }, {});
  assert.equal(movie.frames.length, 1);
  assert.deepEqual(movie.pair, [0, 1]);
  const f = movie.frames[0];
  assert.equal(f.diverging, true);
  assert.ok(Math.abs(f.range[0] + f.range[1]) < 1e-6, 'range is symmetric about zero');
  assert.ok(f.image[8 * N + 11] > 50, 'positive where the source arrived');
  assert.ok(f.image[8 * N + 5] < -50, 'negative where it left');
  assert.match(f.caption.title, /Pass 2 minus pass 1/);
  const same = buildMovie('diff', { layers, grid: GRID, det: 3, diffA: 1, diffB: 1 }, {});
  assert.notEqual(same.pair[0], same.pair[1], 'a pass is never subtracted from itself');
});

test('difference view explains itself when there is one pass', () => {
  const movie = buildMovie('diff', { layers: twoPasses().slice(0, 3), grid: GRID, det: 3 }, {});
  assert.equal(movie.frames.length, 0);
  assert.match(movie.empty, /Only one survey pass/);
});

// A toy sky model: the per-pixel mean of all layers; the residual is observed minus that mean.
const modelLib = {
  fitSkyModel(layers) {
    const mean = new Float32Array(layers[0].image.length);
    for (const l of layers) for (let i = 0; i < mean.length; i++) mean[i] += l.image[i] / layers.length;
    return { mean };
  },
  residualLayer(model, l) {
    const image = new Float32Array(l.image.length);
    for (let i = 0; i < image.length; i++) image[i] = l.image[i] - model.mean[i];
    return { ...l, image };
  },
  findCandidates() {
    return [
      { x: 5, y: 8, snr: -30, kind: 1, passIndex: 0 },
      { x: 11, y: 8, snr: 28, kind: 1, passIndex: 1 },
      { x: 6, y: 8, snr: 9, kind: 2, passIndex: 0 },
    ];
  },
  ...gridLib,
};

test('residual view: diverging frames per pass, with numbered candidate marks', () => {
  const layers = twoPasses({ first: { sx: 5 }, second: { sx: 11 } });
  const movie = buildMovie('residual', { layers, grid: GRID, det: 3 }, modelLib);
  assert.equal(movie.empty, null);
  assert.equal(movie.frames.length, 2);
  assert.ok(movie.model);
  for (const f of movie.frames) {
    assert.equal(f.diverging, true);
    assert.ok(Math.abs(f.range[0] + f.range[1]) < 1e-6);
    assert.equal(f.markers.length, movie.candidates.length);
  }
  assert.ok(movie.frames[0].image[8 * N + 5] > 0 && movie.frames[1].image[8 * N + 5] < 0);
  assert.ok(movie.candidates.length >= 1);
  assert.deepEqual(movie.frames[0].markers.map((m) => m.label), movie.candidates.map((_, i) => String(i + 1)));
  for (const c of movie.candidates) {
    assert.ok(Number.isFinite(c.ra) && Number.isFinite(c.dec));
    assert.ok(c.score >= 0, 'scores are magnitudes, never negative');
  }
  const each = buildMovie('residual', { layers, grid: GRID, det: 3, perExposure: true, model: movie.model, candidates: movie.candidates }, modelLib);
  assert.equal(each.frames.length, 6);
});

test('residual view says why it cannot run', () => {
  const layers = twoPasses();
  assert.match(buildMovie('residual', { layers, grid: GRID, det: 3 }, {}).empty, /not available/);
  assert.match(buildMovie('residual', { layers: layers.slice(0, 3), grid: GRID, det: 3 }, modelLib).empty, /at least four/);
  assert.deepEqual(prepareResidual({}, layers, GRID), { model: null, candidates: [] });
  const prepared = prepareResidual(modelLib, layers, GRID);
  assert.ok(prepared.model);
  assert.ok(Array.isArray(prepared.candidates));
});

test('clusterCandidates merges nearby peaks, keeps the strongest and caps the list', () => {
  const list = [
    { x: 10, y: 10, score: 5, kind: 'varies' },
    { x: 12, y: 11, score: 9, kind: 'varies' },
    { x: 14, y: 10, score: 4, kind: 'moved' },
    { x: 60, y: 60, score: 7, kind: 'varies' },
  ];
  const out = clusterCandidates(list, GRID);
  assert.equal(out.length, 2);
  assert.equal(out[0].score, 9);
  assert.equal(out[0].peaks, 3);
  assert.equal(out[0].kind, 'moved', 'a group with any moved member is a mover');
  assert.equal(out[1].score, 7);
  assert.match(out[0].label, /9\.0/);
  assert.equal(clusterCandidates(list, GRID, 1).length, 1);
  assert.deepEqual(clusterCandidates([], GRID), []);
});

test('lens view asks for the detectors it is missing, then builds a frame', () => {
  const lens = { id: 'methane', label: 'Methane', dets: [4, 3], band: [3.2, 3.4], kind: 'depth' };
  const lib = {
    LENSES: [lens],
    lensImage(l, byDet) {
      const any = byDet.get(3)[0];
      return { image: Float32Array.from(any.image, () => 0.1), mask: new Uint8Array(any.image.length), kind: 'depth', label: l.label };
    },
  };
  assert.deepEqual(lensDetectors(lib, 'methane'), [3, 4]);
  assert.deepEqual(lensDetectors(lib, 'unknown'), []);
  assert.deepEqual(lensDetectors({ ...lib, lensNeeds: () => ({ dets: [5, 4, 5] }) }, 'methane'), [4, 5]);

  const d3 = twoPasses().slice(0, 3);
  const missing = buildMovie('lens', { lens: 'methane', layersByDet: new Map([[3, d3]]), grid: GRID, det: 3 }, lib);
  assert.equal(missing.frames.length, 0);
  assert.deepEqual(missing.needs, [4]);
  assert.match(missing.empty, /needs detector D4/);

  const d4 = twoPasses().slice(0, 3).map((l) => ({ ...l, det: 4 }));
  const movie = buildMovie('lens', { lens: 'methane', layersByDet: new Map([[3, d3], [4, d4]]), grid: GRID, det: 3 }, lib);
  assert.equal(movie.frames.length, 1);
  assert.equal(movie.frames[0].diverging, true);
  assert.equal(movie.frames[0].lensKind, 'depth');
  assert.ok(movie.frames[0].range[0] < 0 && movie.frames[0].range[1] > 0);
  assert.match(movie.frames[0].caption.wave, /3\.20/);
  assert.match(buildMovie('lens', { lens: 'methane' }, {}).empty, /not available/);
});

test('distance view: still frame at infinity, a tracked frame inside the field', () => {
  const layers = twoPasses();
  const still = buildMovie('distance', { layers, grid: GRID, det: 3, dist: Infinity }, {});
  assert.equal(still.frames.length, 1);
  assert.match(still.notes[0], /infinity/);

  const calls = [];
  const lib = {
    // 0.5 arcsec per day eastward: about 90 arcsec between the two passes.
    trackThrough(ra, dec, dist, mjds, { refIndex }) {
      return mjds.map((m) => ({ mjd: m, ra, dec, dEast: 0.5 * (m - mjds[refIndex]) * (1000 / dist), dNorth: 0 }));
    },
    shiftAndStack(kept, grid, offsets) {
      calls.push({ n: kept.length, offsets });
      return { image: kept[0].image, mask: kept[0].mask };
    },
  };
  const near = buildMovie('distance', { layers, grid: GRID, det: 3, dist: 1000 }, lib);
  assert.equal(near.frames.length, 2);
  assert.equal(calls[0].n, 3, 'exposures that would leave the field are dropped');
  assert.equal(near.used, 3);
  assert.ok(near.hop > 80 && near.hop < 100);
  assert.ok(near.notes.some((n) => /hops about/.test(n)));
  assert.deepEqual(near.frames[0].range, near.frames[1].range);
  assert.match(near.frames[1].caption.title, /Tracking a body/);

  calls.length = 0;
  const far = buildMovie('distance', { layers, grid: GRID, det: 3, dist: 20000 }, lib);
  assert.equal(calls[0].n, 6, 'far bodies barely move, so everything is combined');
  assert.equal(far.notes.length, 0);

  const without = buildMovie('distance', { layers, grid: GRID, det: 3, dist: 1000 }, {});
  assert.equal(without.frames.length, 1);
  assert.match(without.notes[0], /not available/);
});

test('trackOffsets is zero at the reference epoch with either core function', () => {
  const viaThrough = trackOffsets(
    { trackThrough: (ra, dec, d, mjds, { refIndex }) => mjds.map((m) => ({ dEast: m - mjds[refIndex], dNorth: 0 })) },
    10, 20, 40, [100, 110], 100,
  );
  assert.deepEqual(viaThrough.offsets, [{ dEast: 0, dNorth: 0 }, { dEast: 10, dNorth: 0 }]);
  const viaTrack = trackOffsets(
    { predictedTrack: (ra, dec, d, mjds) => mjds.map((m) => ({ ra: ra + (m - 100) / 3600, dec })) },
    359.9999, 0, 40, [100, 110], 100,
  );
  assert.ok(Math.abs(viaTrack.offsets[0].dEast) < 1e-9);
  assert.ok(Math.abs(viaTrack.offsets[1].dEast - 10) < 1e-6);
  assert.equal(passHop({}, 0, 0, Infinity, []), 0);
  assert.ok(Math.abs(passHop({}, 0, 0, 40, []) - (2 / 40) * 206264.8) < 1e-6, 'small-angle fallback');
});

test('gaiaGhosts places stars at the frame date and flags the ones that are elsewhere', () => {
  const frame = buildMovie('passes', { layers: twoPasses().slice(0, 3), grid: GRID, det: 3 }, {}).frames[0];
  const [ra, dec] = gridLib.gridPixToSky(GRID, 8, 8);
  const [raOff, decOff] = gridLib.gridPixToSky(GRID, 10, 8);
  const stars = [
    { ra, dec, pmra: 0, pmdec: 0, gmag: 9 },
    { ra: raOff, dec: decOff, pmra: 800, pmdec: -600, gmag: 10 },
    { ra: ra + 1, dec, pmra: 0, pmdec: 0, gmag: 11 },
  ];
  const ghosts = gaiaGhosts(gridLib, stars, frame, GRID);
  assert.equal(ghosts.length, 2, 'stars outside the field are dropped');
  assert.equal(ghosts[0].moved, false, 'a star where Gaia says is not flagged');
  assert.equal(ghosts[1].moved, true, 'a ghost two pixels from the light is flagged');
  assert.equal(ghosts[0].label, undefined);
  assert.match(ghosts[1].label, /^1\.0.*\/yr$/, 'fast stars carry their proper motion');
  assert.equal(ghosts[1].star, stars[1]);

  let seen = null;
  const moving = gaiaGhosts(
    { ...gridLib, propagate: (star, mjd) => { seen = { star, mjd }; return { ra: star.ra, dec: star.dec + 3.075 / 3600 }; } },
    stars.slice(0, 1), frame, GRID, { measure: false },
  );
  assert.equal(seen.mjd, frame.mjd);
  assert.equal(seen.star.epoch, 2016.0, 'Gaia DR3 epoch is assumed when a star has none');
  assert.ok(moving[0].dec > dec);
  assert.deepEqual(gaiaGhosts({}, stars, frame, GRID), [], 'no pixel map, no ghosts');
  assert.deepEqual(gaiaGhosts(gridLib, [], frame, GRID), []);
  assert.equal(gaiaGhosts(gridLib, [stars[0], stars[0], stars[0]], frame, GRID, { max: 2 }).length, 2);
});

test('measureMotion follows a source from pass to pass and compares it with Gaia', () => {
  const layers = twoPasses({ first: { sx: 6 }, second: { sx: 9 } });
  const [ra, dec] = gridLib.gridPixToSky(GRID, 6, 8);
  let fitted = null;
  const lib = {
    ...gridLib,
    fitMotion(points) {
      fitted = points;
      const dt = (points[points.length - 1].mjd - points[0].mjd) / 365.25;
      const cosd = Math.cos((points[0].dec * Math.PI) / 180);
      return {
        pmra: ((points[points.length - 1].ra - points[0].ra) * cosd * 3.6e6) / dt,
        pmdec: ((points[points.length - 1].dec - points[0].dec) * 3.6e6) / dt,
      };
    },
    matchGaia: (stars) => stars[0],
  };
  const star = { ra, dec, pmra: -18000, pmdec: 0 };
  const out = measureMotion(lib, layers, GRID, ra, dec, { stars: [star], startMjd: 60801 });
  assert.equal(out.track.length, 2);
  assert.equal(fitted.length, 2);
  for (const p of out.track) {
    assert.ok(p.sigma >= 0.15 && Math.abs(p.w - 1 / (p.sigma * p.sigma)) < 1e-9);
  }
  // Three pixels west in 180 days: about -18.7 arcsec per year in RA.
  const expected = (-3 * GRID.scale * 1000) / (180 / 365.25);
  assert.ok(Math.abs(out.measured.pmra - expected) / Math.abs(expected) < 0.02, `pmra ${out.measured.pmra} vs ${expected}`);
  assert.ok(Math.abs(out.measured.pmdec) < 200);
  assert.equal(out.gaia.star, star);
  assert.equal(out.gaia.total, 18000);

  assert.deepEqual(measureMotion({}, layers, GRID, ra, dec), { track: [], measured: null, gaia: null });
  const noFit = measureMotion(gridLib, layers.slice(0, 3), GRID, ra, dec);
  assert.equal(noFit.track.length, 1);
  assert.equal(noFit.measured, null, 'one pass gives a position but no motion');
});
