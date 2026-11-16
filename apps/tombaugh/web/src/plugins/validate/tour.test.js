// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests of tour.js and of the pure helpers of index.js against the fake app. No network, no DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as targets from '../../core/targets.js';
import { createFakeApp } from './fakeapp.js';
import { fakeLayers, makeFakeField } from './fakefield.js';
import { install, meta, scatterRange, scatterSvg, summaryText, tally } from './index.js';
import { challengeTargets, collectContext, extraDetectors, matchKnownTarget, measureLoaded, runTour, waitForData } from './tour.js';

const PASSES = [60836, 61018, 61200];
const MID = PASSES[1] + 1;
const cache = new Map();
function provide(request) {
  const known = targets.findTarget(request.name);
  if (known && known.id === 'wise0855') return null;
  if (known && known.id === 'rw-aur') return 'never';
  const key = (known ? known.id : 'plain') + ':' + request.det + ':' + request.fov;
  if (!cache.has(key)) {
    const mid = known ? targets.positionNow(known, MID, { parallax: false }) : { ra: request.ra, dec: request.dec };
    const f = makeFakeField({
      ra0: mid.ra, dec0: mid.dec, fov: request.fov, dets: [request.det], passMjds: PASSES, exposuresPerPass: 6, nStars: 10,
      ...(known ? { moverPm: [known.pmra, known.pmdec], moverParallax: known.parallax, variable: false } : {}),
    });
    cache.set(key, { ...f, layersByDet: fakeLayers(f) });
  }
  return cache.get(key);
}
const FAST = { idleMs: 150, maxMs: 400, settleMs: 30, gaiaWaitMs: 30 };
const loaded = (app) => new Promise((resolve) => { const off = app.on('frames', (p) => { if (p.complete !== false) { off(); resolve(p); } }); });

test('the challenge list has the five targets', () => {
  const list = challengeTargets(targets);
  assert.deepEqual(list.map((t) => t.id), ['barnard', 'eps-indi-b', 'wise0855', 'rw-aur', 'r-dra']);
  assert.deepEqual(challengeTargets(null), []);
  assert.deepEqual(extraDetectors(targets.findTarget('eps indi')), [4]);
  assert.deepEqual(extraDetectors(targets.findTarget('barnard')), []);
});

test('matchKnownTarget: by name near the place, by place alone, or not at all', () => {
  const b = targets.findTarget('barnard');
  const now = targets.positionNow(b, MID);
  assert.equal(matchKnownTarget(targets, { ...now, name: "Barnard's Star" }, MID).id, 'barnard');
  assert.equal(matchKnownTarget(targets, { ...now, name: '' }, MID).id, 'barnard');
  assert.equal(matchKnownTarget(targets, { ra: 10, dec: 10, name: "Barnard's Star" }, MID), null);
  assert.equal(matchKnownTarget(null, now, MID), null);
});

test('collectContext says what is missing', async () => {
  const app = createFakeApp({ provide });
  assert.match(collectContext(app).reason, /No target/);
  app.goTo({ ra: 150, dec: 20, name: 'Somewhere' });
  assert.match(collectContext(app).reason, /No exposures/);
  await loaded(app);
  const c = collectContext(app, { targetsModule: targets });
  assert.equal(c.ok, true);
  assert.equal(c.summary.det, 3);
  assert.equal(c.summary.nLayers, 18);
  assert.ok(c.summary.nStars > 5);
  assert.equal(c.ctx.gaia.epoch, 2016);
  assert.equal(c.ctx.target.name, 'Somewhere');
  app.select({ ra: 150.01, dec: 20.01, label: 'picked' });
  const s = collectContext(app, { useSelection: true });
  assert.equal(s.summary.selected, true);
  assert.equal(s.ctx.target.name, 'picked');
  assert.equal(collectContext(null).ok, false);
  app.dispose();
});

test('waitForData: complete, empty, silent, cancelled, and a shell without the complete flag', async () => {
  const app = createFakeApp({ provide, delayMs: 20 });
  let w = waitForData(app, { det: 3, ...FAST });
  app.goTo({ ra: 150, dec: 20, name: 'Somewhere' });
  let got = await w;
  assert.equal(got.ok, true);
  assert.equal(got.count, 18);

  w = waitForData(app, { det: 3, ...FAST });
  app.goTo({ ra: 133.8, dec: -7.2, name: 'WISE 0855-0714' });
  got = await w;
  assert.equal(got.ok, false);
  assert.equal(got.noData, true);
  assert.match(got.reason, /lists no exposures/);

  w = waitForData(app, { det: 3, ...FAST });
  app.goTo({ ra: 76.9, dec: 30.4, name: 'RW Aurigae' });
  got = await w;
  assert.equal(got.noData, true);
  assert.equal(got.timedOut, true);
  assert.match(got.reason, /nothing arrived for 0\.2 s/);

  const controller = new AbortController();
  w = waitForData(app, { det: 3, ...FAST, signal: controller.signal });
  controller.abort();
  got = await w;
  assert.equal(got.cancelled, true);
  assert.equal(app.listenerCount(), 0, 'listeners are removed');
  app.dispose();

  const old = createFakeApp({ provide, delayMs: 10, completeFlag: false });
  w = waitForData(old, { det: 3, ...FAST });
  old.goTo({ ra: 150, dec: 20, name: 'Somewhere' });
  got = await w;
  assert.equal(got.ok, true);
  assert.equal(got.settled, true);
  old.dispose();
});

test('measureLoaded measures what is loaded, or says why not', async () => {
  const app = createFakeApp({ provide });
  const none = await measureLoaded(app, { targetsModule: targets, gaiaWaitMs: 10 });
  assert.equal(none.ok, false);
  assert.match(none.reason, /No target/);
  app.goTo({ ra: 150, dec: 20, name: 'Somewhere' });
  await loaded(app);
  const out = await measureLoaded(app, { targetsModule: targets, gaiaWaitMs: 10 });
  assert.equal(out.ok, true);
  assert.equal(out.measurement.motion.ok, true, out.measurement.motion.reason);
  assert.equal(out.measurement.field.alignment.ok, true);
  app.dispose();
});

test('runTour: goes to each target, sets the detector, reports missing data, can be cancelled', async () => {
  const app = createFakeApp({ provide, delayMs: 5 });
  const seen = [];
  const out = await runTour(app, { targetsModule: targets, ...FAST, onStatus: (s) => { if (s.phase === 'load') seen.push(s.target.name + ' D' + s.det); } });
  assert.equal(out.total, 5);
  assert.equal(out.cancelled, false);
  assert.equal(out.results.length, 5);
  assert.deepEqual(seen, ["Barnard's Star D3", 'Epsilon Indi Ba,Bb D6', 'Epsilon Indi Ba,Bb D4', 'WISE 0855-0714 D6', 'RW Aurigae D2', 'R Draconis D3']);
  const [barnard, eps, wise, rw, rdra] = out.results;
  assert.equal(barnard.motion.ok, true, barnard.motion.reason);
  assert.equal(barnard.target.name, "Barnard's Star");
  assert.ok(Math.abs(barnard.motion.measured.total - 10393) < 1500, 'total ' + barnard.motion.measured.total);
  assert.ok(Math.abs(barnard.motion.difference.sigmaTotal) < 3);
  assert.equal(eps.det, 6);
  assert.deepEqual(eps.spectrum.detectors, [4, 6]);
  assert.equal(wise.noData, true);
  assert.match(wise.reason, /lists no exposures/);
  assert.equal(rw.noData, true);
  assert.match(rw.reason, /nothing arrived/);
  assert.equal(rdra.motion.ok, true, rdra.motion.reason);
  assert.equal(app.store.get().det, 3);
  assert.equal(app.listenerCount(), 0);
  const text = summaryText(out.results, { total: 5 });
  assert.match(text, /^Measured 3 of 5 targets\. WISE 0855-0714 and RW Aurigae returned no data\./);
  assert.equal(tally(out.results).measured, 3);

  const controller = new AbortController();
  const cut = await runTour(app, { targetsModule: targets, ...FAST, signal: controller.signal, onResult: () => controller.abort() });
  assert.equal(cut.cancelled, true);
  assert.equal(cut.results.length, 1);
  assert.match(summaryText(cut.results, { total: 5, cancelled: true }), /^Cancelled after 1 of 5 targets/);
  app.dispose();
});

test('scatterSvg: numbers in, markup out, east to the left', () => {
  assert.equal(scatterSvg(null), '');
  assert.equal(scatterSvg({ points: [] }), '');
  const a = { sigma: 0.1, medianEast: 0, medianNorth: 0, points: [{ dEast: 0.2, dNorth: 0 }, { dEast: -0.1, dNorth: 0.1 }, { dEast: 9, dNorth: 0 }, { dEast: NaN, dNorth: 0 }] };
  assert.equal(scatterRange({ ...a, points: a.points.slice(0, 2) }), 0.2);
  const svg = scatterSvg(a, { size: 168 });
  assert.match(svg, /^<svg [^>]*role="img"/);
  assert.equal((svg.match(/<circle /g) || []).length, 4, 'three dots and the 1-sigma circle');
  assert.match(svg, /stroke-dasharray/);
  const east = Number(/<circle cx="([\d.]+)"/.exec(scatterSvg({ sigma: 0, points: [{ dEast: 0.5, dNorth: 0 }, { dEast: 0.4, dNorth: 0 }] }))[1]);
  assert.ok(east < 84, 'a star east of its Gaia position is drawn left of centre');
  assert.ok(!/NaN|undefined/.test(svg));
});

test('install does nothing where there is no page', () => {
  assert.equal(meta.id, 'validate');
  assert.equal(meta.title, 'Validation');
  assert.equal(install(null), undefined);
  assert.equal(install({}), undefined);
  assert.equal(install(createFakeApp({ provide })), undefined, 'no document in Node');
});
