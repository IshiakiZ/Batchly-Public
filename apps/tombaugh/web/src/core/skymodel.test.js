// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Tests of predicted-sky subtraction on synthetic layers (no FITS, no network).
//
// The synthetic field mimics what SPHEREx delivers for one detector: three survey passes of 30
// exposures each, every exposure at a different wavelength (with a small wavelength gradient
// across the grid, as in real frames), and sources with smooth power-law spectra, so the raw
// frames differ by tens of percent from one exposure to the next.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitSkyModel, predictLayer, residualLayer, evalModelAt, changeMap, residualPassStacks,
  findCandidates, CHANGE_KINDS, saturatedCores, haloChange,
} from './skymodel.js';

const NOISE = 0.02; // MJy/sr per pixel per exposure
const PSF = 1.1;    // Gaussian sigma in grid pixels
const W_MIN = 1.63; // detector 3
const W_MAX = 2.41;

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

function blob(image, n, x0, y0, amp) {
  const xa = Math.max(0, Math.floor(x0 - 7));
  const xb = Math.min(n - 1, Math.ceil(x0 + 7));
  const ya = Math.max(0, Math.floor(y0 - 7));
  const yb = Math.min(n - 1, Math.ceil(y0 + 7));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      image[y * n + x] += amp * Math.exp(-((x - x0) ** 2 + (y - y0) ** 2) / (2 * PSF * PSF));
    }
  }
}

/**
 * Build layers. stars: [{ x, y, amp, alpha }] with flux = amp (wave / 2 um)^alpha.
 * `extra(layer, pass, index, r)` may add anything to layer.image before the noise goes in.
 * Returns { layers, truth } where truth[l] is the noise-free static image of layer l.
 */
function makeField({ n = 40, perPass = 30, nPass = 3, stars = [], seed = 1, extra = null, noise = NOISE }) {
  const r = rng(seed);
  const layers = [];
  const truth = [];
  for (let p = 0; p < nPass; p++) {
    for (let j = 0; j < perPass; j++) {
      // Quasi-random wavelength order: every pass covers the whole detector range.
      const f = ((j + 0.5) * 0.61803398875 + p * 0.37) % 1;
      const w0 = W_MIN * Math.pow(W_MAX / W_MIN, 0.02 + 0.96 * f);
      const image = new Float32Array(n * n);
      const wave = new Float32Array(n * n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          wave[y * n + x] = w0 * Math.exp(0.01 * (y - n / 2) / n + 0.003 * (x - n / 2) / n);
        }
      }
      for (const s of stars) {
        // The colour term uses the wavelength at the star: exact enough over a 15 pixel stamp.
        const w = wave[Math.round(s.y) * n + Math.round(s.x)];
        blob(image, n, s.x, s.y, s.amp * Math.pow(w / 2, s.alpha));
      }
      const layer = {
        frame: null, det: 3, mjd: 60830 + p * 182 + j * 0.07, pass: p,
        image, variance: new Float32Array(n * n).fill(noise * noise), wave, mask: new Uint8Array(n * n),
      };
      truth.push(Float32Array.from(image));
      if (extra) extra(layer, p, j, r);
      for (let i = 0; i < n * n; i++) image[i] += noise * r.g();
      layers.push(layer);
    }
  }
  return { layers, truth };
}

const STARS = [
  { x: 6.3, y: 7.1, amp: 2.0, alpha: -1.5 },
  { x: 20.2, y: 6.4, amp: 0.8, alpha: 1.2 },
  { x: 33.1, y: 8.8, amp: 0.3, alpha: 0 },
  { x: 7.7, y: 19.5, amp: 1.2, alpha: 0.7 },
  { x: 19.6, y: 20.3, amp: 0.5, alpha: -1.0 },
  { x: 33.4, y: 21.0, amp: 1.6, alpha: 1.5 },
];

function snrStats(model, layers, select = null) {
  let s = 0;
  let s2 = 0;
  let k = 0;
  for (const layer of layers) {
    const r = residualLayer(model, layer);
    for (let i = 0; i < r.snr.length; i++) {
      if (r.mask[i] || (select && !select[i])) continue;
      s += r.snr[i];
      s2 += r.snr[i] * r.snr[i];
      k++;
    }
  }
  return { mean: s / k, rms: Math.sqrt(s2 / k), count: k };
}

test('static sky: residuals are pure noise although the raw frames differ by tens of percent', () => {
  const n = 40;
  const { layers, truth } = makeField({ n, stars: STARS, seed: 11 });
  const model = fitSkyModel(layers);

  assert.equal(model.n, n);
  assert.equal(model.order, 2);
  assert.equal(model.det, 3);
  assert.equal(model.nPasses, 3);
  assert.equal(model.coeffs.length, n * n * 3);
  assert.ok(Math.abs(Math.exp(model.lnw0) - Math.sqrt(W_MIN * W_MAX)) < 0.05, 'reference near the middle of the detector');

  // The raw frames really do flicker: at the core of the reddest and bluest stars the
  // brightest exposure is far above the faintest.
  for (const s of [STARS[0], STARS[5]]) {
    const i = Math.round(s.y) * n + Math.round(s.x);
    const vals = truth.map((t) => t[i]);
    assert.ok(Math.max(...vals) / Math.min(...vals) > 1.5, 'tens of percent between exposures');
  }

  // After subtracting the predicted sky, everything is consistent with noise.
  const all = snrStats(model, layers);
  assert.ok(Math.abs(all.mean) < 0.01, `mean snr ${all.mean}`);
  assert.ok(all.rms > 0.93 && all.rms < 1.03, `rms snr ${all.rms}`);

  // Also at the stars themselves, where the raw scatter is many times the noise. For this
  // check the 3% systematic allowance is switched off, so that snr is a pure noise statistic.
  const onStars = new Uint8Array(n * n);
  for (const s of STARS) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (Math.hypot(x - s.x, y - s.y) < 2) onStars[y * n + x] = 1;
  }
  const exact = fitSkyModel(layers, { sysFrac: 0 });
  const star = snrStats(exact, layers, onStars);
  assert.ok(Math.abs(star.mean) < 0.05, `mean snr on stars ${star.mean}`);
  assert.ok(star.rms > 0.9 && star.rms < 1.1, `rms snr on stars ${star.rms}`);
  // With the allowance (the default) bright cores are judged more cautiously, never less.
  const cautious = snrStats(model, layers, onStars);
  assert.ok(cautious.rms < star.rms && cautious.rms > 0.4, `default rms snr on stars ${cautious.rms}`);
  assert.deepEqual(exact.coeffs, model.coeffs, 'the allowance changes significances, not the model');
  const i0 = Math.round(STARS[0].y) * n + Math.round(STARS[0].x);
  const raw = layers.map((l) => l.image[i0]);
  const rawMean = raw.reduce((a, b) => a + b, 0) / raw.length;
  const rawRms = Math.sqrt(raw.reduce((a, b) => a + (b - rawMean) ** 2, 0) / raw.length);
  assert.ok(rawRms > 10 * NOISE, 'raw scatter at a star core is over ten times the noise');
  assert.ok(model.rms[i0] < 1.3 * NOISE, `model rms there ${model.rms[i0]} is back at the noise`);

  // The prediction reproduces the noise-free sky of each exposure.
  let worst = 0;
  for (let l = 0; l < layers.length; l += 7) {
    const pred = predictLayer(model, layers[l]);
    for (let i = 0; i < n * n; i++) worst = Math.max(worst, Math.abs(pred[i] - truth[l][i]));
  }
  assert.ok(worst < 0.04, `largest prediction error ${worst} MJy/sr (noise per exposure ${NOISE})`);

  // The monochromatic model gives each star its brightness at that wavelength.
  for (const wave of [1.8, 2.0, 2.3]) {
    const mono = evalModelAt(model, wave);
    for (const s of STARS) {
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      const expect = s.amp * Math.pow(wave / 2, s.alpha) * Math.exp(-((x - s.x) ** 2 + (y - s.y) ** 2) / (2 * PSF * PSF));
      assert.ok(Math.abs(mono[y * n + x] - expect) < 0.02 + 0.02 * expect, `star at ${s.x},${s.y} at ${wave} um`);
    }
  }

  // Nothing changed, so nothing is reported.
  assert.ok(model.nUsed.every((k) => k >= 80), 'nearly every sample is used');
  const cm = changeMap(model, layers);
  assert.ok(cm.kind.every((k) => k === 0), 'no pixel classified as changed');
  assert.equal(findCandidates(model, layers).length, 0);
  assert.equal(cm.score.length, n * n);
  assert.ok(Math.max(...cm.score) < 5, `largest change score ${Math.max(...cm.score)}`);
});

test('a mover and a variable stand out; static and jittery stars do not', () => {
  const n = 40;
  const moverAt = [[10, 34], [13, 34], [16, 34]]; // 3 grid pixels per pass
  const variable = { x: 28, y: 12, amp: 1.0, alpha: -0.5 };
  const jittery = { x: 30, y: 31, amp: 5, alpha: -1 }; // undersampled bright core: 5% jitter
  const { layers } = makeField({
    n,
    stars: STARS,
    seed: 23,
    extra(layer, p, j, r) {
      const w = layer.wave[(n >> 1) * n + (n >> 1)];
      blob(layer.image, n, moverAt[p][0], moverAt[p][1], 0.5);
      blob(layer.image, n, variable.x, variable.y, variable.amp * Math.pow(w / 2, variable.alpha) * (p === 1 ? 2 : 1));
      blob(layer.image, n, jittery.x, jittery.y, jittery.amp * Math.pow(w / 2, jittery.alpha) * (1 + 0.05 * r.g()));
    },
  });
  const model = fitSkyModel(layers);
  const stacks = residualPassStacks(model, layers);
  const at = (arr, x, y) => arr[y * n + x];

  assert.equal(stacks.length, 3);
  assert.deepEqual(stacks.map((s) => s.label), ['Jun 2025', 'Dec 2025', 'Jun 2026']);
  assert.ok(stacks.every((s) => s.image.length === n * n && s.snr.length === n * n && s.mask.length === n * n));
  assert.ok(stacks[0].mjd < stacks[1].mjd && stacks[1].mjd < stacks[2].mjd);

  // The mover: bright in its own pass at its own position, with its full flux (the model was
  // not dragged up by it), and no ghost at that position in the other passes.
  for (let p = 0; p < 3; p++) {
    const [x, y] = moverAt[p];
    assert.ok(at(stacks[p].snr, x, y) > 40, `mover pass ${p} snr ${at(stacks[p].snr, x, y)}`);
    assert.ok(Math.abs(at(stacks[p].image, x, y) - 0.5) < 0.03, `mover flux ${at(stacks[p].image, x, y)}`);
    const far = p === 0 ? 2 : 0; // the pass in which the mover is 6 pixels away
    assert.ok(Math.abs(at(stacks[far].snr, x, y)) < 4, `ghost in pass ${far}: ${at(stacks[far].snr, x, y)}`);
  }

  // The variable: the model keeps the quiet level, the bright pass shows the whole excess.
  const quiet = variable.amp * Math.pow(2.0 / 2, variable.alpha);
  assert.ok(Math.abs(at(evalModelAt(model, 2.0), variable.x, variable.y) - quiet) < 0.03, 'model = quiet level');
  // (A doubling against the 3% systematic allowance can reach at most 33 sigma.)
  assert.ok(at(stacks[1].snr, variable.x, variable.y) > 25, `variable snr ${at(stacks[1].snr, variable.x, variable.y)}`);
  assert.ok(Math.abs(at(stacks[1].image, variable.x, variable.y) - 1.0) < 0.1, 'excess = one more times the quiet flux');
  assert.ok(Math.abs(at(stacks[0].snr, variable.x, variable.y)) < 4);
  assert.ok(Math.abs(at(stacks[2].snr, variable.x, variable.y)) < 4);

  // Classification.
  const cm = changeMap(model, layers, { stacks });
  for (const [x, y] of moverAt) assert.equal(at(cm.kind, x, y), 2, `mover pixel ${x},${y} is "moved"`);
  assert.equal(at(cm.kind, variable.x, variable.y), 1, 'variable is "varies"');
  assert.equal(CHANGE_KINDS[at(cm.kind, variable.x, variable.y)], 'varies');
  for (const s of [...STARS, jittery]) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        assert.equal(at(cm.kind, Math.round(s.x) + dx, Math.round(s.y) + dy), 0, `static star at ${s.x},${s.y} is unchanged`);
      }
    }
  }
  // Every classified pixel belongs to the mover's track or to the variable.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = at(cm.kind, x, y);
      if (k === 2) assert.ok(Math.abs(y - 34) <= 3 && x >= 6 && x <= 20, `stray "moved" pixel at ${x},${y}`);
      if (k === 1) assert.ok(Math.hypot(x - variable.x, y - variable.y) <= 4, `stray "varies" pixel at ${x},${y}`);
    }
  }
  assert.ok(at(cm.score, variable.x, variable.y) > 20);
  assert.ok(at(cm.score, 13, 34) > 20);
  assert.ok(at(cm.score, Math.round(STARS[0].x), Math.round(STARS[0].y)) < 5);
  // The jittery star scatters far beyond its noise, and the model knows it.
  assert.ok(at(model.scatter, jittery.x, jittery.y) > 50, `scatter factor ${at(model.scatter, jittery.x, jittery.y)}`);
  assert.ok(at(model.floor, jittery.x, jittery.y) > 50 * NOISE * NOISE);
  assert.ok(Math.abs(at(stacks[0].snr, jittery.x, jittery.y)) < 3);
  assert.ok(at(model.scatter, 3, 3) < 1.6, 'blank sky scatters like its noise');

  // Candidate list: the variable and the three mover positions, strongest first, each once,
  // located at the centroid of its residual flux.
  const cands = findCandidates(model, layers, { stacks });
  assert.ok(cands.length >= 4 && cands.length <= 8, `${cands.length} candidates`);
  for (let k = 1; k < cands.length; k++) assert.ok(Math.abs(cands[k - 1].snr) >= Math.abs(cands[k].snr));
  const near = (x, y) => cands.filter((q) => Math.hypot(q.x - x, q.y - y) < 0.5);
  const cv = near(variable.x, variable.y);
  assert.equal(cv.length, 1, 'the variable is listed once');
  assert.deepEqual([cv[0].kind, cv[0].passIndex, cv[0].label, cv[0].px, cv[0].py], [1, 1, 'Dec 2025', variable.x, variable.y]);
  assert.ok(cv[0].snr > 25 && cv[0].npix >= 9);
  for (let p = 0; p < 3; p++) {
    const c = near(moverAt[p][0], moverAt[p][1]);
    assert.equal(c.length, 1, `mover position of pass ${p} is listed once`);
    assert.equal(c[0].kind, 2);
    assert.equal(c[0].passIndex, p);
    assert.ok(c[0].snr > 40);
  }
  for (const c of cands) {
    const onMover = Math.abs(c.y - 34) <= 2 && c.x >= 8 && c.x <= 18;
    const onVariable = Math.hypot(c.x - variable.x, c.y - variable.y) <= 2;
    assert.ok(onMover || onVariable, `unexpected candidate at ${c.x},${c.y}`);
  }
  assert.equal(findCandidates(model, layers, { stacks, max: 2 }).length, 2);
  assert.equal(findCandidates(model, layers, { stacks, minSnr: 1000 }).length, 0);
});

test('a mover too faint to see in one exposure is recovered through pass coherence', () => {
  const n = 40;
  const faintAt = [[8, 10], [20, 10], [32, 10]];
  const amp = 3 * NOISE; // 3 sigma per exposure at the peak pixel
  const { layers } = makeField({
    n,
    stars: STARS.slice(3),
    seed: 31,
    extra(layer, p) { blob(layer.image, n, faintAt[p][0], faintAt[p][1], amp); },
  });
  const at = (arr, x, y) => arr[y * n + x];

  const model = fitSkyModel(layers);
  const stacks = residualPassStacks(model, layers);
  for (let p = 0; p < 3; p++) {
    const [x, y] = faintAt[p];
    assert.ok(at(stacks[p].snr, x, y) > 8, `faint mover pass ${p} snr ${at(stacks[p].snr, x, y)}`);
    assert.ok(at(stacks[p].image, x, y) > 0.8 * amp, `recovered ${at(stacks[p].image, x, y)} of ${amp}`);
    for (let q = 0; q < 3; q++) {
      if (q !== p) assert.ok(Math.abs(at(stacks[q].snr, x, y)) < 3.5, `ghost in pass ${q}: ${at(stacks[q].snr, x, y)}`);
    }
    // The pass that contains the object was left out of the static model at this pixel.
    assert.ok(at(model.nUsed, x, y) <= 62, `nUsed ${at(model.nUsed, x, y)}`);
  }
  const cands = findCandidates(model, layers, { stacks });
  for (const [x, y] of faintAt) assert.ok(cands.some((c) => Math.hypot(c.x - x, c.y - y) <= 1), `candidate near ${x},${y}`);

  // Without the pass-level step the object leaks into the model: weaker signal, negative ghosts.
  const naive = fitSkyModel(layers, { passAware: false });
  const naiveStacks = residualPassStacks(naive, layers);
  for (let p = 0; p < 3; p++) {
    const [x, y] = faintAt[p];
    assert.ok(at(naiveStacks[p].image, x, y) < at(stacks[p].image, x, y) - 0.1 * amp, 'diluted without pass coherence');
    assert.ok(at(naiveStacks[(p + 1) % 3].image, x, y) < -0.1 * amp, 'negative ghost without pass coherence');
  }
});

test('two passes only: changes are still found, as dipoles and in-place sign flips', () => {
  // With two passes nobody can say which one shows the "true" sky, so the model sits halfway
  // and each pass shows half the change with opposite signs.
  const n = 40;
  const moverAt = [[12, 30], [15, 30]];
  const variable = { x: 27, y: 12, amp: 1.0, alpha: -1.5 }; // steep spectrum, 1.6 times brighter in pass 1
  const { layers } = makeField({
    n,
    nPass: 2,
    stars: STARS,
    seed: 47,
    extra(layer, p) {
      const w = layer.wave[(n >> 1) * n + (n >> 1)];
      blob(layer.image, n, moverAt[p][0], moverAt[p][1], 0.4);
      blob(layer.image, n, variable.x, variable.y, variable.amp * Math.pow(w / 2, variable.alpha) * (p === 1 ? 1.6 : 1));
    },
  });
  const model = fitSkyModel(layers);
  assert.equal(model.nPasses, 2);
  const stacks = residualPassStacks(model, layers);
  const at = (arr, x, y) => arr[y * n + x];
  assert.equal(stacks.length, 2);

  // Mover: plus half where it is, minus half where it was (and the reverse in the other pass).
  assert.ok(Math.abs(at(stacks[0].image, 12, 30) - 0.2) < 0.03, `pass 0 at its own position ${at(stacks[0].image, 12, 30)}`);
  assert.ok(Math.abs(at(stacks[0].image, 15, 30) + 0.2) < 0.03);
  assert.ok(at(stacks[0].snr, 12, 30) > 15 && at(stacks[0].snr, 15, 30) < -15);
  assert.ok(at(stacks[1].snr, 15, 30) > 15 && at(stacks[1].snr, 12, 30) < -15);
  // Variable: fainter than the model in one pass, brighter in the other, same place.
  // (Half of a 60% change is 23% of the model; against the 3% allowance that is under 8 sigma.)
  assert.ok(at(stacks[0].snr, variable.x, variable.y) < -6, `variable pass 0 ${at(stacks[0].snr, variable.x, variable.y)}`);
  assert.ok(at(stacks[1].snr, variable.x, variable.y) > 6, `variable pass 1 ${at(stacks[1].snr, variable.x, variable.y)}`);

  const cm = changeMap(model, layers, { stacks });
  for (const [x, y] of moverAt) assert.equal(at(cm.kind, x, y), 2, `mover pixel ${x},${y}`);
  assert.equal(at(cm.kind, variable.x, variable.y), 1);
  for (const s of STARS) assert.equal(at(cm.kind, Math.round(s.x), Math.round(s.y)), 0);
  const cands = findCandidates(model, layers, { stacks });
  assert.ok(cands.some((c) => c.kind === 2 && Math.hypot(c.x - 12, c.y - 30) <= 1));
  assert.ok(cands.some((c) => c.kind === 2 && Math.hypot(c.x - 15, c.y - 30) <= 1));
  const cv = cands.filter((c) => Math.hypot(c.x - variable.x, c.y - variable.y) <= 1);
  assert.equal(cv.length, 1, 'the two signs of one variable are listed once');
  assert.equal(cv[0].kind, 1);
  assert.ok(cands.length <= 6, `${cands.length} candidates`);
});

test('a single wild exposure is rejected and does not move the model', () => {
  const n = 16;
  const clean = makeField({ n, stars: [{ x: 8, y: 8, amp: 1, alpha: 1 }], seed: 5 });
  const hit = makeField({
    n,
    stars: [{ x: 8, y: 8, amp: 1, alpha: 1 }],
    seed: 5,
    extra(layer, p, j) { if (p === 1 && j === 4) layer.image[5 * n + 5] += 100 * NOISE; },
  });
  const a = fitSkyModel(clean.layers);
  const b = fitSkyModel(hit.layers);
  const i = 5 * n + 5;
  assert.equal(a.nUsed[i], 90);
  assert.equal(b.nUsed[i], 89);
  assert.ok(Math.abs(a.coeffs[i * 3] - b.coeffs[i * 3]) < 0.3 * NOISE / Math.sqrt(90) * 3, 'level unchanged');
  const r = residualLayer(b, hit.layers[34]);
  assert.ok(r.snr[i] > 80, `the hit itself is obvious: ${r.snr[i]}`);
  // And it does not survive into the pass stack.
  const stacks = residualPassStacks(b, hit.layers);
  assert.ok(Math.abs(stacks[1].snr[i]) < 4, `pass stack snr ${stacks[1].snr[i]}`);
});

test('adaptive order, missing data and bad pixels', () => {
  const n = 8;
  const { layers } = makeField({ n, stars: [{ x: 4, y: 4, amp: 1, alpha: -1 }], seed: 9 });
  const L = layers.length;
  const keep = (pixel, count) => {
    // Leave `count` usable samples at this pixel, spread over the passes.
    const step = Math.floor(L / count);
    for (let l = 0; l < L; l++) if (l % step !== 0 || l / step >= count) layers[l].mask[pixel] = 1;
  };
  keep(0, 5);   // order 1
  keep(1, 3);   // order 0
  keep(2, 1);   // no model
  keep(3, 0 + 2); // order 0 with two samples
  for (const layer of layers) layer.mask[4] = 1; // never observed
  for (let l = 0; l < L; l++) {
    if (l % 2) layers[l].image[5] = NaN;      // non-finite values are missing data
    if (l % 3 === 0) layers[l].variance[6] = 0; // so are unusable variances
  }
  // Pixel 7: plenty of samples, but all at nearly the same wavelength -> at most a straight line.
  for (const layer of layers) layer.wave[7] = 2.0 + 0.001 * (layer.mjd % 1);

  const model = fitSkyModel(layers);
  const c = (p, k) => model.coeffs[p * 3 + k];
  assert.equal(model.nUsed[0], 5);
  assert.ok(Number.isFinite(c(0, 0)) && c(0, 2) === 0, 'five samples: straight line');
  assert.equal(model.nUsed[1], 3);
  assert.ok(Number.isFinite(c(1, 0)) && c(1, 1) === 0 && c(1, 2) === 0, 'three samples: constant');
  assert.equal(model.nUsed[2], 0);
  assert.ok(Number.isNaN(c(2, 0)), 'one sample: no model');
  assert.equal(model.nUsed[3], 2);
  assert.ok(Number.isFinite(c(3, 0)) && c(3, 1) === 0);
  assert.equal(model.nUsed[4], 0);
  assert.ok(Number.isNaN(c(4, 0)));
  assert.ok(model.nUsed[5] >= 40 && model.nUsed[5] <= 45);
  assert.ok(model.nUsed[6] >= 55 && model.nUsed[6] <= 60);
  assert.ok(c(7, 2) === 0 && Number.isFinite(c(7, 0)), 'no wavelength spread: no curvature term');
  assert.ok(Number.isFinite(c(9, 2)) && c(9, 2) !== 0, 'a normal pixel gets the full quadratic');

  // Residuals: masked or model-less pixels are flagged, never thrown on.
  const r = residualLayer(model, layers[0]);
  assert.equal(r.mask[2], 1);
  assert.equal(r.mask[4], 1);
  assert.ok(Number.isNaN(r.image[4]) && Number.isNaN(r.snr[4]));
  assert.equal(r.mask[9], 0);
  assert.ok(Number.isFinite(r.snr[9]));
  assert.ok(Number.isNaN(evalModelAt(model, 2.0)[2]));
  assert.ok(Number.isFinite(evalModelAt(model, 2.0)[9]));
  const stacks = residualPassStacks(model, layers);
  assert.equal(stacks[0].mask[4], 1);

  // Degenerate inputs.
  const none = fitSkyModel([]);
  assert.equal(none.n, 0);
  assert.equal(none.coeffs.length, 0);
  const lowOrder = fitSkyModel(layers, { order: 0 });
  assert.equal(lowOrder.order, 0);
  assert.equal(lowOrder.coeffs.length, n * n);
  assert.equal(predictLayer(lowOrder, layers[0]).length, n * n);
  const twoPasses = fitSkyModel(layers.filter((l) => l.pass < 2));
  assert.equal(twoPasses.nPasses, 2);
  assert.ok(Number.isFinite(twoPasses.coeffs[9 * 3]));
});

test('speed: 80 x 80 and 200 x 200 grids with 100 layers', (t) => {
  const time = (n) => {
    const stars = [];
    for (let k = 0; k < Math.round(n * n / 130); k++) {
      stars.push({ x: 3 + ((k * 7.31) % (n - 6)), y: 3 + ((k * 11.17) % (n - 6)), amp: 0.2 + (k % 5) * 0.4, alpha: -1.5 + (k % 7) * 0.5 });
    }
    const { layers } = makeField({ n, perPass: 34, stars, seed: 3 });
    const layers100 = layers.slice(0, 100);
    let best = Infinity;
    let model = null;
    for (let k = 0; k < 4; k++) {
      const t0 = performance.now();
      model = fitSkyModel(layers100);
      best = Math.min(best, performance.now() - t0);
    }
    const t1 = performance.now();
    residualPassStacks(model, layers100);
    return { fit: best, stacks: performance.now() - t1 };
  };
  const small = time(80);
  t.diagnostic(`80 x 80 x 100 layers: fit ${small.fit.toFixed(1)} ms, pass residual stacks ${small.stacks.toFixed(1)} ms`);
  // Target is well under 100 ms; the assertion leaves room for a busy test machine.
  assert.ok(small.fit < 250, `80 x 80 fit took ${small.fit} ms`);
  const big = time(200);
  t.diagnostic(`200 x 200 x 100 layers: fit ${big.fit.toFixed(1)} ms, pass residual stacks ${big.stacks.toFixed(1)} ms`);
  assert.ok(big.fit < 2500, `200 x 200 fit took ${big.fit} ms`);
});

/** A bright star with a wide halo and a flagged core of radius `rCore`, at (x0, y0). */
function saturatedStar(layer, n, x0, y0, amp, rCore = 3, width = 5) {
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r2 = (x - x0) ** 2 + (y - y0) ** 2;
      layer.image[y * n + x] += amp / (1 + r2 / (width * width)) ** 1.5;
      if (r2 <= rCore * rCore) layer.mask[y * n + x] = 1;
    }
  }
}

test('a saturated star that moved is one candidate, read from its halo as a whole', () => {
  const n = 60;
  const { layers } = makeField({
    n,
    stars: STARS,
    seed: 31,
    extra(layer, p) {
      // 0.7 grid pixels towards +y per pass, far less than the halo is wide
      saturatedStar(layer, n, 30.2, 38 + 0.7 * p, 40);
    },
  });
  const cores = saturatedCores(layers, n);
  assert.equal(cores.length, 1);
  assert.ok(Math.abs(cores[0].x - 30.2) < 1 && Math.abs(cores[0].y - 38.7) < 1.2, JSON.stringify(cores[0]));
  assert.ok(cores[0].r > 2 && cores[0].r < 4.5);
  const model = fitSkyModel(layers);
  const stacks = residualPassStacks(model, layers);
  const change = haloChange(stacks, n, cores[0], 30);
  assert.equal(change.kind, 2, JSON.stringify(change));
  assert.ok(change.dy > 0.9 && Math.abs(change.dx) < 0.4, JSON.stringify(change));
  const found = findCandidates(model, layers, { stacks });
  const sat = found.filter((c) => c.saturated);
  assert.equal(sat.length, 1);
  assert.equal(CHANGE_KINDS[sat[0].kind], 'moved');
  assert.ok(sat[0].peaks >= 2, `the halo left ${sat[0].peaks} patches`);
  assert.ok(sat[0].shift && sat[0].shift.dy > 0.9);
  // nothing else in the halo is listed on its own
  const others = found.filter((c) => !c.saturated && Math.hypot(c.x - cores[0].x, c.y - cores[0].y) <= sat[0].rHalo);
  assert.equal(others.length, 0, JSON.stringify(others));
});

test('a saturated star that brightened is a change in place; an unsaturated field has no cores', () => {
  const n = 60;
  const { layers } = makeField({
    n,
    stars: STARS,
    seed: 37,
    extra(layer, p) {
      saturatedStar(layer, n, 30.2, 38, p === 2 ? 60 : 40);
    },
  });
  const cores = saturatedCores(layers, n);
  assert.equal(cores.length, 1);
  const model = fitSkyModel(layers);
  const found = findCandidates(model, layers);
  const sat = found.filter((c) => c.saturated);
  assert.equal(sat.length, 1);
  assert.equal(CHANGE_KINDS[sat[0].kind], 'varies');
  assert.equal(sat[0].brighter, true);
  assert.equal(sat[0].shift, null);

  const plain = makeField({ n: 40, stars: STARS, seed: 5 });
  assert.deepEqual(saturatedCores(plain.layers, 40), []);
  // a flagged edge strip and a bad column are not stars
  for (const layer of plain.layers) {
    for (let y = 0; y < 40; y++) { layer.mask[y * 40] = 1; layer.mask[y * 40 + 1] = 1; layer.mask[y * 40 + 20] = 1; }
  }
  assert.deepEqual(saturatedCores(plain.layers, 40), []);
});
