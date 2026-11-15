// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests of fieldstars.js on a made-up field with a known answer (fakefield.js). No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeLayers, makeFakeField } from './fakefield.js';
import { alignment, buildPassStacks, measureFieldStars, median, nullTest, robustSigma, selectReferenceStars } from './fieldstars.js';

const field = makeFakeField({ seed: 11 });
const layers = fakeLayers(field).get(3);
const stacks = buildPassStacks(layers);
const stats = measureFieldStars({ grid: field.grid, stacks, stars: field.gaia });

test('median and robustSigma', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
  const s = robustSigma([-2, -1, 0, 1, 2, 100]);
  assert.ok(s > 1 && s < 4, 'one outlier does not blow up the scatter');
});

test('one stack per survey pass', () => {
  assert.equal(stacks.length, 3);
  for (const s of stacks) {
    assert.equal(s.nExposures, 8);
    assert.equal(s.image.length, field.grid.n * field.grid.n);
  }
  assert.ok(stacks[1].mjd - stacks[0].mjd > 150);
});

test('reference stars: the close pair and the star on the rim are left out', () => {
  const sel = selectReferenceStars(field.grid, field.gaia.stars, stacks, { epoch: field.gaia.epoch });
  const ids = sel.selected.map((s) => s.star.id);
  for (const id of field.truth.crowded) assert.ok(!ids.includes(id), id + ' is crowded');
  assert.ok(!ids.includes(field.truth.edge), 'the rim star is outside the margin');
  assert.ok(sel.rejected.crowded >= 2);
  assert.ok(sel.rejected.outside >= 1);
  assert.ok(ids.length >= 8);
  assert.equal(sel.nCatalogue, field.gaia.stars.length);
});

test('alignment: centroids sit on the Gaia positions', () => {
  assert.equal(stats.ok, true);
  const a = alignment(stats);
  assert.equal(a.ok, true);
  assert.ok(a.medianOffset < 0.15, 'median offset ' + a.medianOffset);
  assert.ok(a.sigma > 0 && a.sigma < 0.6, 'scatter ' + a.sigma);
  assert.equal(a.pass, true);
  assert.ok(a.points.length >= 20);
  assert.ok(a.points.every((p) => Number.isFinite(p.dEast) && Number.isFinite(p.dNorth)));
  assert.ok(a.verdict.length > 20 && !a.verdict.includes('!'));
});

test('null test: slow stars show no motion', () => {
  const nt = nullTest(stats);
  assert.equal(nt.ok, true);
  assert.ok(nt.n >= 5);
  assert.ok(Math.abs(nt.zPmra) < 3.5 && Math.abs(nt.zPmdec) < 3.5, nt.zPmra + ' ' + nt.zPmdec);
  assert.equal(nt.consistent, true);
  assert.ok(nt.scatter > 10 && nt.scatter < 1500, 'scatter ' + nt.scatter);
  assert.ok(nt.detectable3Sigma > nt.scatter);
  assert.ok(nt.verdict.length > 20);
  // The fast star is not part of the null sample.
  assert.ok(!nt.points.some((p) => p.id === 'fake-mover'));
});

test('the fast star is measured as fast', () => {
  const mover = stats.stars.find((s) => s.id === 'fake-mover');
  assert.ok(mover && mover.motion, 'mover measured');
  assert.equal(mover.lowPm, false);
  assert.ok(Math.abs(mover.motion.total - field.truth.mover.total) < 800, 'total ' + mover.motion.total);
});

test('nothing throws on missing input', () => {
  assert.equal(alignment(null).ok, false);
  assert.equal(nullTest(null).ok, false);
  assert.equal(nullTest({ ok: true, stars: [] }).ok, false);
  const none = measureFieldStars({});
  assert.equal(none.ok, false);
  assert.ok(none.reason.length > 0);
  const noStars = measureFieldStars({ grid: field.grid, stacks, stars: [] });
  assert.equal(noStars.ok, false);
  assert.equal(alignment(noStars).ok, false);
  assert.deepEqual(buildPassStacks([]), []);
});
