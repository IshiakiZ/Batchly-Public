// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests of measure.js on a made-up field with a known answer (fakefield.js). No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propagate } from '../../core/astrometry.js';
import { fakeLayers, makeFakeField } from './fakefield.js';
import { bandDepth, measureField, measureTarget } from './measure.js';

const field = makeFakeField({ seed: 11 });
const layersByDet = fakeLayers(field);
const base = { grid: field.grid, layersByDet, frames: field.frames, gaia: field.gaia };
const MID = field.truth.passMjds[1] + 1;

test('measureField recovers the motion of the fast star and agrees with Gaia', async () => {
  const steps = [];
  const m = await measureField({ ...base, target: field.target, onProgress: (p) => steps.push(p.step) });
  assert.equal(m.kind, 'tombaugh-measurement');
  assert.equal(m.det, 3);
  assert.equal(m.passes.length, 3);
  const mo = m.motion;
  assert.equal(mo.ok, true, mo.reason);
  assert.equal(mo.moving, true);
  const truth = field.truth.mover;
  assert.ok(Math.abs(mo.measured.total - truth.total) < Math.max(3 * mo.measured.errTotal, 0.05 * truth.total), 'total ' + mo.measured.total);
  assert.ok(Math.abs(mo.measured.paDeg - truth.paDeg) < 5, 'PA ' + mo.measured.paDeg);
  assert.ok(mo.catalogue && /gaia/i.test(mo.catalogue.source), 'Gaia is the reference');
  assert.ok(Math.abs(mo.difference.sigmaTotal) < 3);
  assert.ok(mo.offsetFromTrack.total < 1);
  // The mover does not vary; the report must not claim it does.
  assert.equal(m.variability.ok, true, m.variability.reason);
  assert.equal(m.variability.varied, false);
  assert.equal(m.spectrum.ok, true, m.spectrum.reason);
  assert.equal(m.spectrum.methane.covered, false, 'detector 3 does not reach 3.3 um');
  assert.equal(m.quality.ok, true);
  assert.equal(m.quality.synthetic, true);
  assert.deepEqual(Object.keys(m.quality.releases).sort(), ['dr1', 'qr3']);
  assert.equal(m.residuals.ok, true, m.residuals.reason);
  assert.ok(m.residuals.exact.std > 0.6 && m.residuals.exact.std < 1.3, 'std ' + m.residuals.exact.std);
  assert.ok(m.residuals.exact.fracBeyond5 < 1e-3);
  assert.equal(m.field.ok, true);
  assert.equal(m.field.alignment.ok, true);
  assert.equal(m.field.nullTest.ok, true);
  assert.ok(steps.includes('field stars') && steps.includes('motion') && steps.includes('done'));
});

test('the variable star doubles in the second pass and does not move', async () => {
  const star = field.truth.variable.star;
  const pos = propagate({ ...star, epoch: field.gaia.epoch }, MID);
  const m = await measureTarget({ ...base, target: { ra: pos.ra, dec: pos.dec, name: 'variable' }, parts: ['motion', 'variability'] });
  assert.equal(m.variability.ok, true, m.variability.reason);
  assert.equal(m.variability.varied, true);
  const big = m.variability.largest;
  const ratio = big.ratio > 1 ? big.ratio : 1 / big.ratio;
  assert.ok(Math.abs(ratio - field.truth.variable.factor) < 0.2, 'ratio ' + big.ratio);
  assert.ok(Math.abs(big.significance) > 5);
  assert.equal(m.motion.ok, true, m.motion.reason);
  assert.equal(m.motion.moving, false);
  assert.equal(m.spectrum.ok, false, 'a part that was not asked for stays unmeasured');
});

test('a wrong catalogue is caught', async () => {
  const cat = { ...field.truth.mover.star, epoch: 2016, pmdec: 8000, source: 'test' };
  const years = 2000 + (MID - 51544.5) / 365.25 - 2016;
  cat.dec += ((field.truth.mover.pmdec - 8000) * years) / 3.6e6;
  const m = await measureTarget({ ...base, target: field.target, catalogue: cat, parts: ['motion'] });
  assert.equal(m.motion.ok, true, m.motion.reason);
  assert.ok(Math.abs(m.motion.difference.sigmaTotal) > 3, 'sigma ' + m.motion.difference.sigmaTotal);
});

test('an absorption band at 3.3 um is measured on detector 4', async () => {
  const f = makeFakeField({ seed: 4, dets: [4], exposuresPerPass: 12, variable: false, nStars: 6, moverPm: [300, -200], moverBand: { center: 3.3, sigma: 0.12, depth: 0.6 } });
  const m = await measureTarget({ grid: f.grid, layersByDet: fakeLayers(f), frames: f.frames, gaia: f.gaia, target: f.target, parts: ['motion', 'spectrum'] });
  assert.equal(m.spectrum.ok, true, m.spectrum.reason);
  const me = m.spectrum.methane;
  assert.equal(me.covered, true);
  assert.equal(me.measurable, true);
  assert.ok(me.depth > 0.3 && me.depth < 0.7, 'depth ' + me.depth);
  assert.ok(me.sigma > 5);
});

test('bandDepth on plain points', () => {
  const pts = [];
  for (let w = 2.9; w <= 3.8; w += 0.02) pts.push({ wave: w, flux_uJy: w > 3.15 && w < 3.45 ? 40 : 100, err_uJy: 2 });
  const d = bandDepth(pts);
  assert.equal(d.covered, true);
  assert.ok(Math.abs(d.depth - 0.6) < 0.03, 'depth ' + d.depth);
  assert.equal(bandDepth(pts.filter((p) => p.wave < 3.1)).covered, false);
  assert.equal(bandDepth([]).covered, false);
  const faint = bandDepth(pts.map((p) => ({ ...p, flux_uJy: p.flux_uJy / 1000, err_uJy: 5 })));
  assert.equal(faint.measurable, false);
  assert.ok(faint.reason.length > 0);
});

test('missing input gives reasons, not exceptions', async () => {
  const empty = await measureTarget({});
  for (const key of ['motion', 'variability', 'spectrum', 'quality', 'residuals']) {
    assert.equal(empty[key].ok, false);
    assert.ok(empty[key].reason.length > 0);
  }
  const noTarget = await measureTarget({ ...base, target: {} });
  assert.equal(noTarget.motion.ok, false);
  const noLayers = await measureField({ grid: field.grid, layersByDet: new Map(), target: field.target });
  assert.equal(noLayers.motion.ok, false);
  assert.equal(noLayers.field.ok, false);
  assert.equal(noLayers.field.alignment.ok, false);
  // Blank sky far from every star: no source, said plainly.
  const blank = await measureTarget({ ...base, target: { ra: field.grid.ra0 + 0.02, dec: field.grid.dec0 - 0.027 }, gaia: [], parts: ['motion'] });
  assert.equal(typeof blank.motion.ok, 'boolean');
  if (!blank.motion.ok) assert.ok(blank.motion.reason.length > 0);
  else assert.equal(blank.motion.moving, false);
});

test('a core function that throws is contained', async () => {
  const lib = { centroid: () => { throw new Error('boom'); } };
  const m = await measureTarget({ ...base, target: field.target, lib, parts: ['motion', 'quality'] });
  assert.equal(m.motion.ok, false);
  assert.ok(m.motion.reason.length > 0);
  assert.equal(typeof m.quality.ok, 'boolean');
});

test('cancelling stops the measurement and says so', async () => {
  const controller = new AbortController();
  controller.abort();
  const m = await measureTarget({ ...base, target: field.target, signal: controller.signal });
  assert.equal(m.cancelled, true);
  assert.equal(m.motion.ok, false);
  const later = new AbortController();
  const n = await measureTarget({ ...base, target: field.target, signal: later.signal, onProgress: (p) => { if (p.step === 'variability') later.abort(); } });
  assert.equal(n.cancelled, true);
  assert.equal(n.motion.ok, true);
  assert.equal(n.residuals.ok, false);
});
