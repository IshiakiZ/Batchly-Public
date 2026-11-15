// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readExposureHeader, encodePart, decodePart, coverageCells, cellOf, indexBuildStep, indexBuildNext, refreshDirs, indexStatus,
  rebuildManifest, searchIndex, searchIndexMoving, DIRS_KEY, MANIFEST_KEY, INDEX_ROOT,
} from './expindex.js';
import { createMemoryCache } from './cache.js';
import { idToKey, makeKey, parseKey } from './s3.js';
import { skyToPixel, pixelToSky } from './s3cutout.js';
import { attitudeFromWcs, detectorWcs, skyToDetPix, detPixToSky, skyBasis, vectorToSky } from './focalplane.js';
import { createFakeS3, makeFakeSurvey, level2HeaderBytes, mulberry32 } from '../fixtures/fakes3.js';
import { syntheticSip } from '../fixtures/synth.js';

const fast = { backoffMs: 1, timeoutMs: 5000 };
const V_DR = 'l2b-v20-2025-300';
const V_QR = 'l2b-v27-2026-273';
const MARGIN = 16;
const TOL = 20; // pixels the approximate WCS may be off (SIP ignored, a few arcsec and arcmin of misalignment)

const SIP = (() => {
  const sip = syntheticSip();
  const terms = (o) => Object.entries(o).map(([k, c]) => [...k.split('_').map(Number), c]);
  return { a: terms(sip.a), b: terms(sip.b), ap: terms(sip.ap), bp: terms(sip.bp) };
})();

/** True 1-based pixel of a sky position on one detector of one exposure (full TAN-SIP header). */
function truePixel(exposure, det, ra, dec) {
  const w = exposure.wcs[det];
  return skyToPixel({ crpix: w.crpix, crval: w.crval, cd: w.pc, ...SIP }, ra, dec);
}

function trueSky(exposure, det, x, y) {
  const w = exposure.wcs[det];
  return pixelToSky({ crpix: w.crpix, crval: w.crval, cd: w.pc, ...SIP }, x, y);
}

const cosSep = (ra1, dec1, ra2, dec2) => {
  const a = skyBasis(ra1, dec1).b;
  const b = skyBasis(ra2, dec2).b;
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
};

/**
 * What a search must and must not return for a target. `positionAt(mjd)` gives the target's
 * true [ra, dec] at an exposure's time (a constant for a fixed target, null outside an
 * ephemeris). An exposure counts only when its detector-1 file exists and was readable (the
 * index is built from detector 1) and when the file of the detector in question exists.
 */
function expectation(truthDirs, positionAt, unreadable = new Set()) {
  const must = new Map();
  const maybe = new Map();
  for (const d of truthDirs) {
    for (const e of d.exposures) {
      if (!(e.dets & 1)) continue;
      if (unreadable.has(e.obsid)) continue;
      const pos = positionAt(e.mjd);
      if (!pos) continue;
      for (let det = 1; det <= 6; det++) {
        if (!((e.dets >> (det - 1)) & 1)) continue;
        const w = e.wcs[det];
        if (cosSep(w.crval[0], w.crval[1], pos[0], pos[1]) < Math.cos((3 * Math.PI) / 180)) continue;
        const pix = truePixel(e, det, pos[0], pos[1]);
        if (!pix) continue;
        const inside = (m) => pix[0] >= m && pix[0] <= 2041 - m && pix[1] >= m && pix[1] <= 2041 - m;
        const id = `ibe/data/spherex/${makeKey({ release: d.release, dir: d.dir, version: d.version, det, suffix: e.suffix })}`;
        const item = { id, det, mjd: e.mjd, x: pix[0], y: pix[1], release: d.release, obsid: e.obsid, pos };
        if (inside(MARGIN + TOL)) must.set(id, item);
        else if (inside(MARGIN - TOL)) maybe.set(id, item);
      }
    }
  }
  return { must, maybe };
}

function checkAgainstTruth(result, expected, label) {
  const got = new Map(result.frames.map((f) => [f.id, f]));
  assert.equal(got.size, result.frames.length, `${label}: duplicate frames`);
  for (const [id, item] of expected.must) {
    assert.ok(got.has(id), `${label}: missing ${id} (true pixel ${item.x.toFixed(1)}, ${item.y.toFixed(1)})`);
  }
  for (const f of result.frames) {
    const item = expected.must.get(f.id) || expected.maybe.get(f.id);
    assert.ok(item, `${label}: ${f.id} returned but the target is not on that detector`);
    assert.equal(f.det, item.det);
    assert.equal(f.mjd, item.mjd);
    assert.equal(f.release, item.release);
    assert.equal(f.obsid, item.obsid);
    assert.ok(Math.abs(f.x - item.x) < TOL && Math.abs(f.y - item.y) < TOL, `${label}: predicted ${f.x}, ${f.y} vs true ${item.x.toFixed(1)}, ${item.y.toFixed(1)}`);
    assert.equal(Math.round(f.x * 10) / 10, f.x);
  }
  for (let i = 1; i < result.frames.length; i++) {
    const a = result.frames[i - 1];
    const b = result.frames[i];
    assert.ok(a.mjd < b.mjd || (a.mjd === b.mjd && a.det <= b.det), `${label}: not sorted by mjd then det`);
  }
}

/** A cache wrapper that counts reads and writes. */
function countingCache(inner = createMemoryCache()) {
  const stats = { gets: 0, puts: 0, keys: [] };
  return {
    stats,
    inner,
    get: async (key, o) => {
      stats.gets += 1;
      stats.keys.push(key);
      return inner.get(key, o);
    },
    put: async (key, u8, type) => {
      stats.puts += 1;
      return inner.put(key, u8, type);
    },
  };
}

const TARGET = [210.80227, 54.34895];

/** A scan pole 90 degrees from `target`, so that the scan circle passes over it. */
function poleFor(target, angle) {
  const { e, n } = skyBasis(target[0], target[1]);
  const c = Math.cos((angle * Math.PI) / 180);
  const s = Math.sin((angle * Math.PI) / 180);
  const [poleRa, poleDec] = vectorToSky([c * e[0] + s * n[0], c * e[1] + s * n[1], c * e[2] + s * n[2]]);
  return { poleRa, poleDec };
}

const SURVEY_DIRS = [
  { release: 'dr1', dir: '2025W30_1B', version: V_DR, n: 420, seed: 101, ...poleFor(TARGET, 20), mjd0: 60877.0, centre: TARGET },
  { release: 'dr1', dir: '2026W20_1A', version: V_DR, n: 300, seed: 102, ...poleFor(TARGET, 50), mjd0: 61170.0, centre: TARGET },
  { release: 'qr2', dir: '2026W10_1A', version: 'l2b-v25-2026-100', n: 40, seed: 103, poleRa: 10, poleDec: 0, mjd0: 61100.0 },
  { release: 'qr3', dir: '2026W20_1A', version: V_QR, n: 40, seed: 104, ...poleFor(TARGET, 50), mjd0: 61170.0, centre: TARGET },
  { release: 'qr3', dir: '2026W25_2A', version: V_QR, n: 500, seed: 105, ...poleFor(TARGET, 80), mjd0: 61209.0, centre: TARGET },
  { release: 'qr3', dir: '2026W26_1A', version: V_QR, n: 350, seed: 106, ...poleFor(TARGET, 110), mjd0: 61213.0, centre: TARGET, hand: 1 },
];
// Every scan pole is within 45 degrees of this point, so no scan circle comes near it.
const NOWHERE = (({ poleRa, poleDec }) => [poleRa, poleDec])(poleFor(TARGET, 65));
const INDEXED = ['dr1/2025W30_1B', 'dr1/2026W20_1A', 'qr3/2026W25_2A', 'qr3/2026W26_1A'];

function setup() {
  const s3 = createFakeS3({ pageSize: 300 });
  const truth = makeFakeSurvey(s3, { dirs: SURVEY_DIRS });
  const cache = countingCache();
  const opts = { fetchImpl: s3.fetchImpl, ...fast };
  const indexedTruth = truth.dirs.filter((d) => INDEXED.includes(`${d.release}/${d.dir}`));
  return { s3, truth, cache, opts, indexedTruth };
}

async function buildAll(cache, opts, extra = {}) {
  const steps = [];
  for (let guard = 0; guard < 200; guard++) {
    const step = await indexBuildNext(cache, { ...opts, ...extra });
    if (step.idle) return steps;
    steps.push(step);
  }
  throw new Error('index build did not finish');
}

/** Sky positions that really are on some detector of some exposure. */
function pickTargets(truthDirs, count, seed) {
  const rand = mulberry32(seed);
  const out = [];
  while (out.length < count) {
    const d = truthDirs[Math.floor(rand() * truthDirs.length)];
    const e = d.exposures[Math.floor(rand() * d.exposures.length)];
    const det = 1 + Math.floor(rand() * 6);
    out.push(trueSky(e, det, 1 + rand() * 2039, 1 + rand() * 2039));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

test('readExposureHeader: one request, exact numbers, MJD-OBS fallback, long headers, moved CRPIX', async () => {
  const s3 = createFakeS3();
  const crval = [203.245672412, 57.074776311];
  const pc = [0.0013519433669, -0.0010984482376, -0.0010481759429, -0.00130936657274];
  const key = makeKey({ release: 'qr3', dir: '2026W25_2A', version: V_QR, det: 1, suffix: '0279_1' });
  const bytes = level2HeaderBytes({ det: 1, obsid: '2026W25_2A_0279_1', crval, pc, mjd: 61210.79311303 });
  assert.equal(bytes.length, 28800);
  const big = (head) => ({ size: 64546560, read: (a, b) => { const out = new Uint8Array(b - a); out.set(head.subarray(Math.min(a, head.length), Math.min(b, head.length))); return out; } });
  s3.put(key, big(bytes));
  const opts = { fetchImpl: s3.fetchImpl, ...fast };
  const h = await readExposureHeader(key, opts);
  assert.deepEqual(h, { mjd: 61210.79311303, crval1: crval[0], crval2: crval[1], pc11: pc[0], pc12: pc[1], pc21: pc[2], pc22: pc[3] });
  assert.deepEqual(s3.summary(), { lists: 0, ranges: 1, bytes: 28800, faults: 0, notFound: 0 });
  assert.deepEqual([s3.requests[0].start, s3.requests[0].end], [0, 28799]);

  // No MJD-AVG card: MJD-OBS is used.
  const text = String.fromCharCode(...bytes);
  const patch = (from, to) => {
    assert.ok(text.includes(from) && from.length === to.length);
    return Uint8Array.from(text.replace(from, to), (c) => c.charCodeAt(0));
  };
  s3.put(key, big(patch('MJD-AVG =', 'MJD-XXX =')));
  const obs = await readExposureHeader(key, opts);
  assert.ok(Math.abs(obs.mjd - (61210.79311303 - 113.5826 / 86400 / 2)) < 1e-9);

  // A header that does not fit in 28800 bytes costs a second request, same answer.
  s3.put(key, big(level2HeaderBytes({ det: 1, obsid: '2026W25_2A_0279_1', crval, pc, mjd: 61210.79311303, total: 400 })));
  s3.resetStats();
  assert.deepEqual(await readExposureHeader(key, opts), h);
  assert.equal(s3.summary().ranges, 2);

  // Reference pixel not at the detector centre: CRVAL is moved to pixel (1020.5, 1020.5).
  s3.put(key, big(patch('CRPIX1  =               1020.5', 'CRPIX1  =               1000.5')));
  const moved = await readExposureHeader(key, opts);
  const expected = detPixToSky({ crval, pc, crpix: [1000.5, 1020.5] }, 1020.5, 1020.5);
  assert.ok(Math.abs(moved.crval1 - expected[0]) < 1e-12 && Math.abs(moved.crval2 - expected[1]) < 1e-12);
  assert.ok(Math.abs(moved.crval1 - crval[0]) > 0.02);

  // Not FITS, missing file.
  s3.put(key, new Uint8Array(40000).fill(0x41));
  await assert.rejects(readExposureHeader(key, opts), /Not a FITS file/);
  s3.delete(key);
  await assert.rejects(readExposureHeader(key, opts), (err) => err.code === 'NOT_FOUND');
});

test('TBX1 container: round trip, NaN rows, alignment, bad input', () => {
  const rows = new Float64Array(3 * 7);
  for (let i = 0; i < rows.length; i++) rows[i] = i * 1.25 - 3;
  rows.fill(NaN, 7, 14);
  const part = { release: 'qr3', dir: '2026W25_2A', version: V_QR, start: 450, exposures: ['0279_1', '0279_2', '0280_1'], rows, dets: [63, 61, 1] };
  const u8 = encodePart(part);
  assert.equal(String.fromCharCode(...u8.subarray(0, 4)), 'TBX1');
  const n = new DataView(u8.buffer).getUint32(4, true);
  assert.equal((8 + n) % 8, 0, 'rows start on a multiple of 8');
  assert.equal(u8.length, 8 + n + 3 * 7 * 8);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + n)));
  assert.deepEqual(header, { v: 1, release: 'qr3', dir: '2026W25_2A', version: V_QR, start: 450, count: 3, exposures: part.exposures, dets: [63, 61, 1] });
  assert.equal(new DataView(u8.buffer).getFloat64(8 + n, true), -3, 'little-endian doubles');
  const back = decodePart(u8);
  assert.deepEqual(back.rows, rows);
  assert.deepEqual(back.exposures, part.exposures);
  assert.deepEqual(back.dets, [63, 61, 1]);
  assert.equal(back.start, 450);
  // A copy at an odd byte offset decodes too.
  const shifted = new Uint8Array(u8.length + 3);
  shifted.set(u8, 3);
  assert.deepEqual(decodePart(shifted.subarray(3)).rows, rows);
  assert.equal(decodePart(encodePart({ ...part, dets: null })).dets, null);
  assert.throws(() => decodePart(new Uint8Array(20)), /magic/);
  assert.throws(() => decodePart(u8.subarray(0, u8.length - 8)), /truncated/);
  assert.throws(() => encodePart({ ...part, rows: new Float64Array(7) }), /numbers/);
});

test('coverage bitmap: cells of the footprints, polar caps as one cell', () => {
  assert.equal(cellOf(0, -90), 0);
  assert.equal(cellOf(359.99, 89.99), 647);
  assert.equal(cellOf(210.8, 54.3), 21 + 36 * 14);
  assert.equal(cellOf(-0.5, 0), 35 + 36 * 9);
  const row = (crval, pc) => [61000, crval[0], crval[1], ...pc];
  const has = (bits, i) => ((bits[i >> 3] >> (i & 7)) & 1) === 1;
  // The real exposure: D1 at (203.2, 57.1), D2 at (208.4, 54.5), D3 at (212.9, 51.7).
  const bits = coverageCells(Float64Array.from(row([203.245672412, 57.074776311], [0.0013519433669, -0.0010984482376, -0.0010481759429, -0.00130936657274])));
  assert.equal(bits.length, 81);
  for (const [ra, dec] of [[203.2, 57.1], [208.4, 54.5], [212.9, 51.7], [210.80227, 54.34895]]) assert.ok(has(bits, cellOf(ra, dec)), `${ra}, ${dec}`);
  assert.ok(!has(bits, cellOf(100, 54)) && !has(bits, cellOf(208, 20)) && !has(bits, cellOf(208, -54)));
  let set = 0;
  for (let i = 0; i < 648; i++) if (has(bits, i)) set += 1;
  assert.ok(set >= 3 && set <= 12, `${set} cells for one exposure`);
  // Near the pole the whole band is set.
  const polar = coverageCells(Float64Array.from(row([40, 84], [0.0012, -0.0012, -0.0012, -0.0012])));
  for (let i = 0; i < 36; i++) assert.ok(has(polar, i + 36 * 17));
  const south = coverageCells(Float64Array.from(row([300, -88], [0.0012, -0.0012, -0.0012, -0.0012])));
  for (let i = 0; i < 36; i++) assert.ok(has(south, i));
  // Unreadable rows contribute nothing.
  assert.ok(coverageCells(new Float64Array(14).fill(NaN)).every((b) => b === 0));
});

test('every footprint point is inside a marked cell (10,000 random points on random detectors)', () => {
  const rand = mulberry32(77);
  for (let k = 0; k < 400; k++) {
    const z = rand() * 2 - 1;
    const crval = [rand() * 360, (Math.asin(z) * 180) / Math.PI];
    const roll = rand() * 2 * Math.PI;
    const s = 6.155 / 3600;
    const pc = [-s * Math.cos(roll), s * Math.sin(roll), s * Math.sin(roll), s * Math.cos(roll)];
    const bits = coverageCells(Float64Array.from([61000, crval[0], crval[1], ...pc]));
    const triad = attitudeFromWcs({ crval, pc });
    for (let j = 0; j < 25; j++) {
      const det = 1 + Math.floor(rand() * 6);
      const [ra, dec] = detPixToSky(detectorWcs(triad, det), -15 + rand() * 2070, -15 + rand() * 2070);
      const c = cellOf(ra, dec);
      assert.ok(((bits[c >> 3] >> (c & 7)) & 1) === 1, `D${det} point ${ra.toFixed(2)}, ${dec.toFixed(2)} of exposure at ${crval} is in an unmarked cell`);
    }
  }
});

test('build step by step, status during a partial build, manifest, search against the truth', async () => {
  const { s3, truth, cache, opts, indexedTruth } = setup();

  // --- directory list and the release rule
  const dirs = await refreshDirs(cache, opts);
  assert.deepEqual(dirs.map((d) => `${d.release}/${d.dir}`), INDEXED);
  assert.deepEqual(dirs[0], { release: 'dr1', dir: '2025W30_1B', prefix: `dr1/level2/2025W30_1B/${V_DR}/`, version: V_DR });
  const stored = JSON.parse(new TextDecoder().decode(await cache.inner.get(DIRS_KEY)));
  assert.ok(Date.parse(stored.fetchedAt) <= Date.now());
  s3.resetStats();
  await refreshDirs(cache, opts);
  assert.equal(s3.requests.length, 0, 'a fresh dirs.json is not listed again');

  // --- nothing built yet
  let status = await indexStatus(cache, opts);
  assert.deepEqual(status.dirs.map((d) => [d.n, d.parts, d.partsDone, d.done]), INDEXED.map(() => [null, null, 0, false]));
  assert.deepEqual([status.exposures, status.exposuresDone, status.complete], [0, 0, false]);
  let found = await searchIndex(cache, TARGET[0], TARGET[1]);
  assert.deepEqual([found.frames.length, found.dirsSearched, found.dirsIndexed, found.dirsTotal, found.complete], [0, 0, 0, 4, false]);

  // --- two files that can never be read: one is not FITS, one always answers 503
  const A = truth.dirs[0];
  const readable = A.exposures.filter((e) => e.dets & 1);
  const junk = readable[7];
  const down = readable[160];
  s3.put(makeKey({ release: 'dr1', dir: A.dir, version: V_DR, det: 1, suffix: junk.suffix }), new Uint8Array(30000).fill(0x20));
  s3.addFault({ match: new RegExp(`level2_${down.obsid}D1_`), status: 503, times: 1e9 });
  const unreadable = new Set([junk.obsid, down.obsid]);

  // --- first step of the first directory: list.json and part 0
  s3.resetStats();
  const step0 = await indexBuildStep(cache, { release: 'dr1', dir: A.dir }, { ...opts, maxExposures: 150, concurrency: 16 });
  const nA = readable.length;
  assert.deepEqual(step0, { release: 'dr1', dir: A.dir, part: 0, parts: Math.ceil(nA / 150), n: nA, done: false });
  assert.equal(step0.parts, 3);
  assert.equal(s3.summary().lists, 6 * 2, 'six detector directories, two pages each');
  assert.equal(s3.summary().ranges, 150, 'one Range request per exposure header; the file that is not FITS is not asked twice');
  const list = JSON.parse(new TextDecoder().decode(await cache.inner.get(`${INDEX_ROOT}/dr1/${A.dir}/list.json`)));
  assert.deepEqual(list.exposures, readable.map((e) => e.suffix).sort());
  assert.deepEqual(list.dets, readable.slice().sort((a, b) => (a.suffix < b.suffix ? -1 : 1)).map((e) => e.dets));
  assert.equal(list.partSize, 150);
  assert.ok(A.exposures.some((e) => !(e.dets & 1)), 'the fake survey has exposures without a detector-1 file');
  assert.ok(A.exposures.some((e) => e.dets !== 63 && e.dets & 1), 'and exposures with another detector missing');

  status = await indexStatus(cache, opts);
  assert.deepEqual(status.dirs[0], { release: 'dr1', dir: A.dir, version: V_DR, n: nA, parts: 3, partsDone: 1, done: false });
  assert.deepEqual([status.exposures, status.exposuresDone, status.complete], [nA, 150, false]);
  found = await searchIndex(cache, TARGET[0], TARGET[1]);
  assert.equal(found.frames.length, 0, 'a directory is searchable only when it is complete');
  assert.equal(found.dirsIndexed, 0);

  // --- the remaining steps; the part size stays what list.json says
  const step1 = await indexBuildStep(cache, { release: 'dr1', dir: A.dir }, { ...opts, maxExposures: 999 });
  assert.deepEqual([step1.part, step1.parts, step1.done], [1, 3, false]);
  s3.resetStats();
  const step2 = await indexBuildStep(cache, { release: 'dr1', dir: A.dir, version: V_DR }, opts);
  assert.deepEqual([step2.part, step2.parts, step2.n, step2.done], [2, 3, nA, true]);
  assert.equal(s3.summary().lists, 0, 'list.json is reused');
  assert.equal(s3.summary().ranges, nA - 300);
  // Idempotent: nothing left to do, no request at all.
  s3.resetStats();
  assert.deepEqual(await indexBuildStep(cache, { release: 'dr1', dir: A.dir }, opts), { release: 'dr1', dir: A.dir, part: -1, parts: 3, n: nA, done: true });
  assert.equal(s3.requests.length, 0);

  const meta = JSON.parse(new TextDecoder().decode(await cache.inner.get(`${INDEX_ROOT}/dr1/${A.dir}/meta.json`)));
  assert.equal(meta.n, nA);
  assert.equal(meta.parts, 3);
  assert.equal(meta.bad, 2, 'the two unreadable files are NaN rows');
  const mjds = readable.filter((e) => !unreadable.has(e.obsid)).map((e) => e.mjd);
  assert.equal(meta.mjdMin, Math.min(...mjds));
  assert.equal(meta.mjdMax, Math.max(...mjds));
  assert.equal(atob(meta.cells).length, 81);
  const part0 = decodePart(await cache.inner.get(`${INDEX_ROOT}/dr1/${A.dir}/part-0.bin`));
  assert.equal(part0.count, 150);
  const junkRow = part0.exposures.indexOf(junk.suffix);
  assert.ok(junkRow >= 0 && Number.isNaN(part0.rows[junkRow * 7]) && Number.isNaN(part0.rows[junkRow * 7 + 6]));
  const good = part0.exposures.indexOf(readable[3].suffix);
  assert.deepEqual(Array.from(part0.rows.subarray(good * 7, good * 7 + 7)), [readable[3].mjd, ...readable[3].wcs[1].crval, ...readable[3].wcs[1].pc]);

  // The finished directory is in the manifest already and can be searched.
  status = await indexStatus(cache, opts);
  assert.deepEqual(status.dirs.map((d) => d.done), [true, false, false, false]);
  found = await searchIndex(cache, TARGET[0], TARGET[1]);
  assert.deepEqual([found.dirsSearched, found.dirsIndexed, found.dirsTotal, found.complete], [1, 1, 4, false]);
  checkAgainstTruth(found, expectation([A], () => TARGET, unreadable), 'first directory');
  assert.ok(found.frames.length > 0);

  // --- everything else, with indexBuildNext
  s3.resetStats();
  const steps = await buildAll(cache, opts, { maxExposures: 200 });
  assert.deepEqual(steps.map((s) => `${s.release}/${s.dir}:${s.part}`), [
    'dr1/2026W20_1A:0', 'dr1/2026W20_1A:1', 'qr3/2026W25_2A:0', 'qr3/2026W25_2A:1', 'qr3/2026W25_2A:2', 'qr3/2026W26_1A:0', 'qr3/2026W26_1A:1',
  ]);
  const total = indexedTruth.reduce((sum, d) => sum + d.exposures.filter((e) => e.dets & 1).length, 0);
  assert.equal(s3.summary().ranges, total - nA, 'every header is read exactly once');
  assert.equal(s3.requests.some((r) => /qr2\//.test(r.key || r.prefix || '')), false, 'the superseded quick release is never touched');
  assert.deepEqual(await indexBuildNext(cache, opts), { done: true, idle: true, remaining: 0 });

  status = await indexStatus(cache, opts);
  assert.equal(status.complete, true);
  assert.deepEqual([status.exposures, status.exposuresDone], [total, total]);
  assert.deepEqual(status.dirs.map((d) => [d.n, d.partsDone === d.parts, d.done]), indexedTruth.map((d) => [d.exposures.filter((e) => e.dets & 1).length, true, true]));

  // --- manifest: the incremental one equals a rebuild
  const incremental = JSON.parse(new TextDecoder().decode(await cache.inner.get(MANIFEST_KEY)));
  const manifest = await rebuildManifest(cache, opts);
  assert.deepEqual(manifest.dirs, incremental.dirs);
  assert.deepEqual(manifest.dirs.map((m) => `${m.release}/${m.dir}`), INDEXED);
  assert.ok(Date.parse(manifest.builtAt) > 0);

  // --- search against the truth: the demo target and 40 positions scattered over the survey
  found = await searchIndex(cache, TARGET[0], TARGET[1]);
  const expectedTarget = expectation(indexedTruth, () => TARGET, unreadable);
  checkAgainstTruth(found, expectedTarget, 'target');
  assert.deepEqual([found.dirsSearched, found.dirsIndexed, found.dirsTotal, found.dirsFailed, found.complete], [4, 4, 4, 0, true]);
  assert.ok(expectedTarget.must.size >= 20, `only ${expectedTarget.must.size} true frames on the target`);
  assert.deepEqual(found.counts.map((c) => c.det), [1, 2, 3, 4, 5, 6]);
  assert.equal(found.counts.reduce((sum, c) => sum + c.total, 0), found.frames.length);
  for (const f of found.frames) {
    assert.ok(s3.has(idToKey(f.id)), `${f.id} does not exist in the bucket`);
    assert.equal(parseKey(idToKey(f.id)).det, f.det);
  }
  assert.ok(new Set(found.frames.map((f) => f.release)).size === 2, 'frames from DR1 and QR3');
  assert.ok(found.frames.every((f) => !/qr3\/level2\/2026W20_1A/.test(f.id)), 'the QR copy of a DR directory is not used');

  let mustTotal = 0;
  let maybeTotal = 0;
  let returned = 0;
  const memo = new Map();
  for (const [ra, dec] of pickTargets(indexedTruth, 40, 2026)) {
    const expected = expectation(indexedTruth, () => [ra, dec], unreadable);
    const result = await searchIndex(cache, ra, dec, { memo });
    checkAgainstTruth(result, expected, `target ${ra.toFixed(3)}, ${dec.toFixed(3)}`);
    mustTotal += expected.must.size;
    maybeTotal += expected.maybe.size;
    returned += result.frames.length;
  }
  assert.ok(mustTotal > 150, `${mustTotal} certain frames over 40 targets`);
  assert.ok(returned >= mustTotal && returned <= mustTotal + maybeTotal);
  console.log(`  search vs truth: ${mustTotal} frames that must be found were found, ${returned - mustTotal} of ${maybeTotal} borderline frames returned, 0 wrong`);

  // Nothing there: empty, quickly, without loading any directory.
  const empty = await searchIndex(cache, NOWHERE[0], NOWHERE[1]);
  assert.deepEqual([empty.frames.length, empty.dirsSearched, empty.complete], [0, 0, true]);

  // --- options: detector subset and margin
  const only = await searchIndex(cache, TARGET[0], TARGET[1], { dets: [5, 2] });
  assert.deepEqual(only.frames.map((f) => f.id), found.frames.filter((f) => f.det === 2 || f.det === 5).map((f) => f.id));
  assert.deepEqual(only.counts.map((c) => c.det), [2, 5]);
  const wide = await searchIndex(cache, TARGET[0], TARGET[1], { margin: 300 });
  assert.ok(wide.frames.length < found.frames.length);
  for (const f of wide.frames) assert.ok(f.x >= 300 && f.x <= 1741 && f.y >= 300 && f.y <= 1741);
  await assert.rejects(searchIndex(cache, NaN, 0), RangeError);
  await assert.rejects(searchIndex(cache, 10, 95), RangeError);
});

test('search predictions agree with focalplane.js, including a right-handed attitude', async () => {
  const { truth, cache, opts } = setup();
  await refreshDirs(cache, opts);
  const D = truth.dirs.find((d) => d.dir === '2026W26_1A'); // built with hand = +1
  let steps = 0;
  while (!(await indexBuildStep(cache, { release: 'qr3', dir: D.dir }, opts)).done) steps += 1;
  assert.equal(steps, 0, 'default part size 900 covers this directory in one step');
  const pcDet = D.exposures[0].wcs[1].pc;
  assert.ok(pcDet[0] * pcDet[3] - pcDet[1] * pcDet[2] > 0, 'this directory is right-handed');
  const rand = mulberry32(5);
  let checked = 0;
  for (let k = 0; k < 60; k++) {
    const e = D.exposures[Math.floor(rand() * D.exposures.length)];
    if (!(e.dets & 1)) continue;
    const det = 1 + Math.floor(rand() * 6);
    const model = detectorWcs(attitudeFromWcs(e.wcs[1]), det);
    const [ra, dec] = detPixToSky(model, 100 + rand() * 1840, 100 + rand() * 1840);
    const result = await searchIndex(cache, ra, dec, { dets: [det] });
    const frame = result.frames.find((f) => f.obsid === e.obsid);
    if (!((e.dets >> (det - 1)) & 1)) {
      assert.equal(frame, undefined, 'a detector without a file is not returned');
      continue;
    }
    assert.ok(frame, `exposure ${e.obsid} D${det} not found`);
    const [x, y] = skyToDetPix(model, ra, dec);
    assert.ok(Math.abs(frame.x - x) <= 0.051 && Math.abs(frame.y - y) <= 0.051, `${frame.x}, ${frame.y} vs ${x}, ${y}`);
    checked += 1;
  }
  assert.ok(checked > 40);
});

test('a directory added later appears after refreshDirs(force) and more build steps', async () => {
  const { s3, truth, cache, opts } = setup();
  await refreshDirs(cache, opts);
  await buildAll(cache, opts);
  const memo = new Map();
  const before = await searchIndex(cache, TARGET[0], TARGET[1], { memo });
  assert.equal(before.complete, true);

  const more = makeFakeSurvey(s3, {
    dirs: [{ release: 'qr3', dir: '2026W40_2A', version: 'l2b-v28-2026-290', n: 260, seed: 201, ...poleFor(TARGET, 35), mjd0: 61315.0, centre: TARGET }],
  });
  assert.equal((await refreshDirs(cache, opts)).length, 4, 'the cached list is still fresh');
  s3.resetStats();
  const dirs = await refreshDirs(cache, { ...opts, force: true });
  assert.deepEqual(dirs.map((d) => d.dir), ['2025W30_1B', '2026W20_1A', '2026W25_2A', '2026W26_1A', '2026W40_2A']);
  assert.equal(dirs[4].version, 'l2b-v28-2026-290');
  assert.equal(s3.summary().lists, 1 + 2 + 1, 'root, two releases, and one version lookup for the new directory only');
  // An old list is also refreshed without force once it is older than six hours.
  const later = await refreshDirs(cache, { ...opts, now: () => Date.now() + 7 * 3600 * 1000 });
  assert.equal(later.length, 5);

  let status = await indexStatus(cache, opts);
  assert.equal(status.complete, false);
  assert.deepEqual(status.dirs[4], { release: 'qr3', dir: '2026W40_2A', version: 'l2b-v28-2026-290', n: null, parts: null, partsDone: 0, done: false });
  const during = await searchIndex(cache, TARGET[0], TARGET[1], { memo, manifestTtlMs: 0 });
  assert.deepEqual([during.dirsIndexed, during.dirsTotal, during.complete], [4, 5, false]);
  assert.deepEqual(during.frames.map((f) => f.id), before.frames.map((f) => f.id));

  const steps = await buildAll(cache, opts, { maxExposures: 100 });
  assert.deepEqual(steps.map((s) => [s.dir, s.part, s.done]), [['2026W40_2A', 0, false], ['2026W40_2A', 1, false], ['2026W40_2A', 2, true]]);
  status = await indexStatus(cache, opts);
  assert.equal(status.complete, true);
  const after = await searchIndex(cache, TARGET[0], TARGET[1], { memo, manifestTtlMs: 0 });
  assert.deepEqual([after.dirsIndexed, after.dirsTotal, after.complete], [5, 5, true]);
  const expected = expectation([...truth.dirs.filter((d) => INDEXED.includes(`${d.release}/${d.dir}`)), ...more.dirs], () => TARGET);
  checkAgainstTruth(after, expected, 'after the new directory');
  const fresh = after.frames.filter((f) => f.obsid.startsWith('2026W40_2A'));
  assert.ok(fresh.length > 0 && after.frames.length === before.frames.length + fresh.length);
  // A memo that is still trusted (default 30 s) keeps answering from the old manifest.
  const stale = await searchIndex(cache, TARGET[0], TARGET[1], { memo: new Map([...memo]), manifestTtlMs: 30000 });
  assert.equal(stale.dirsIndexed, 5);
});

test('status heals a manifest that lost an update, and rebuildManifest drops stale versions', async () => {
  const { cache, opts } = setup();
  await refreshDirs(cache, opts);
  await buildAll(cache, opts);
  // Simulate two workers finishing at once: one manifest update was lost.
  const manifest = JSON.parse(new TextDecoder().decode(await cache.inner.get(MANIFEST_KEY)));
  const lost = manifest.dirs.splice(1, 1)[0];
  await cache.inner.put(MANIFEST_KEY, new TextEncoder().encode(JSON.stringify(manifest)));
  assert.equal((await searchIndex(cache, TARGET[0], TARGET[1])).dirsIndexed, 3);
  const status = await indexStatus(cache, opts);
  assert.equal(status.complete, true, 'the meta exists, so the directory is done');
  assert.equal((await searchIndex(cache, TARGET[0], TARGET[1])).dirsIndexed, 4, 'and the manifest was repaired');

  // A directory reprocessed under a new version: its old index entry must not be used.
  const stored = JSON.parse(new TextDecoder().decode(await cache.inner.get(DIRS_KEY)));
  stored.dirs = stored.dirs.map((d) => (d.dir === lost.dir ? { ...d, version: 'l2b-v99-2027-001', prefix: d.prefix.replace(d.version, 'l2b-v99-2027-001') } : d));
  await cache.inner.put(DIRS_KEY, new TextEncoder().encode(JSON.stringify(stored)));
  const rebuilt = await rebuildManifest(cache, { ...opts, offline: true });
  assert.equal(rebuilt.dirs.length, 3);
  const result = await searchIndex(cache, TARGET[0], TARGET[1]);
  assert.deepEqual([result.dirsIndexed, result.dirsTotal, result.complete], [3, 4, false]);
  assert.ok(result.frames.every((f) => !f.obsid.startsWith(lost.dir)));
  const st = await indexStatus(cache, { ...opts, offline: true });
  assert.equal(st.dirs.find((d) => d.dir === lost.dir).done, false);
});

test('when S3 is failing the step throws and writes nothing; a later step succeeds', async () => {
  const { s3, truth, cache, opts } = setup();
  await refreshDirs(cache, opts);
  const dir = truth.dirs[1].dir;
  const fault = s3.addFault({ match: /D1_spx/, status: 503, times: 1e9 });
  await assert.rejects(
    indexBuildStep(cache, { release: 'dr1', dir }, { ...opts, retries: 1, maxExposures: 60 }),
    (err) => err.retryable === true && err.code === 'UPSTREAM' && /headers of dr1/.test(err.message),
  );
  assert.equal(await cache.inner.get(`${INDEX_ROOT}/dr1/${dir}/part-0.bin`), null, 'no part full of NaN was stored');
  // A listing failure fails the step too.
  fault.times = 0;
  const { cache: cache2 } = setup();
  await refreshDirs(cache2, opts);
  s3.addFault({ match: /^list:dr1\/level2\/.*\/3\/$/, status: 500, times: 1e9 });
  await assert.rejects(indexBuildStep(cache2, { release: 'dr1', dir }, { ...opts, retries: 1 }), (err) => err.retryable === true);
  assert.equal(await cache2.inner.get(`${INDEX_ROOT}/dr1/${dir}/list.json`), null);
  s3.clearFaults();
  const step = await indexBuildStep(cache, { release: 'dr1', dir }, { ...opts, maxExposures: 60 });
  assert.deepEqual([step.part, step.done], [0, false]);
  const status = await indexStatus(cache, opts);
  assert.equal(status.dirs[1].partsDone, 1);
  // A few transient failures (here 2 files that always time out) are tolerated as NaN rows.
  const bad = truth.dirs[1].exposures.filter((e) => e.dets & 1).slice(70, 72);
  for (const e of bad) s3.addFault({ match: new RegExp(`level2_${e.obsid}D1_`), error: true, times: 1e9 });
  const next = await indexBuildStep(cache, { release: 'dr1', dir }, opts);
  assert.equal(next.part, 1);
  const part = decodePart(await cache.inner.get(`${INDEX_ROOT}/dr1/${dir}/part-1.bin`));
  assert.equal(part.rows.filter((v, i) => i % 7 === 0 && Number.isNaN(v)).length, 2);
  // Unknown directory.
  await assert.rejects(indexBuildStep(cache, { release: 'qr3', dir: '2031W01_1A' }, opts), /no directory/);
});

test('concurrent build steps: different directories in parallel, and the same part twice', async () => {
  const { truth, cache, opts, indexedTruth } = setup();
  await refreshDirs(cache, opts);
  const results = await Promise.all([
    indexBuildStep(cache, { release: 'dr1', dir: '2025W30_1B' }, opts),
    indexBuildStep(cache, { release: 'dr1', dir: '2025W30_1B' }, opts),
    indexBuildStep(cache, { release: 'dr1', dir: '2026W20_1A' }, opts),
    indexBuildStep(cache, { release: 'qr3', dir: '2026W25_2A' }, opts),
    indexBuildStep(cache, { release: 'qr3', dir: '2026W26_1A' }, opts),
    indexBuildNext(cache, { ...opts, offset: 3 }),
  ]);
  assert.ok(results.every((r) => r.done && r.part === 0));
  // Whatever the interleaving did to the manifest, status repairs it and the search is right.
  const status = await indexStatus(cache, opts);
  assert.equal(status.complete, true);
  const found = await searchIndex(cache, TARGET[0], TARGET[1]);
  assert.equal(found.complete, true);
  checkAgainstTruth(found, expectation(indexedTruth, () => TARGET), 'after concurrent build');
  void truth;
});

test('thinning: a field observed hundreds of times is cut to maxPerDet, evenly, with counts', async () => {
  const s3 = createFakeS3();
  const field = [90, 66.56];
  const truth = makeFakeSurvey(s3, {
    dirs: [{ release: 'qr3', dir: '2026W30_1A', version: V_QR, n: 400, seed: 301, poleRa: 0, poleDec: 0, mjd0: 61240, step: 0, cross: 0.6, centre: field, missing: 0, missingDet: 0 }],
  });
  const cache = createMemoryCache();
  const opts = { fetchImpl: s3.fetchImpl, ...fast };
  await refreshDirs(cache, opts);
  await buildAll(cache, opts);
  const full = await searchIndex(cache, field[0], field[1]);
  checkAgainstTruth(full, expectation(truth.dirs, () => field), 'deep field');
  const d1 = full.frames.filter((f) => f.det === 1);
  assert.ok(d1.length > 300, `${d1.length} detector-1 frames`);
  assert.deepEqual(full.counts.find((c) => c.det === 1), { det: 1, total: d1.length, returned: d1.length });

  const thinned = await searchIndex(cache, field[0], field[1], { maxPerDet: 25 });
  for (const c of thinned.counts) {
    const all = full.frames.filter((f) => f.det === c.det);
    const kept = thinned.frames.filter((f) => f.det === c.det);
    assert.equal(c.total, all.length);
    assert.equal(c.returned, kept.length);
    assert.equal(kept.length, Math.min(25, all.length));
    if (all.length > 25) {
      assert.equal(kept[0].id, all[0].id, 'first frame kept');
      assert.equal(kept[24].id, all[all.length - 1].id, 'last frame kept');
      const positions = kept.map((f) => all.findIndex((a) => a.id === f.id));
      const stepSize = (all.length - 1) / 24;
      positions.forEach((p, j) => assert.ok(Math.abs(p - j * stepSize) <= 0.5, `frame ${j} of the thinned list is at rank ${p}`));
      assert.equal(new Set(positions).size, 25);
    }
  }
  assert.equal(thinned.frames.length, thinned.counts.reduce((sum, c) => sum + c.returned, 0));
  for (let i = 1; i < thinned.frames.length; i++) assert.ok(thinned.frames[i - 1].mjd <= thinned.frames[i].mjd);
  const one = await searchIndex(cache, field[0], field[1], { maxPerDet: 1, dets: [1] });
  assert.equal(one.frames.length, 1);
  assert.equal(one.frames[0].id, d1[d1.length >> 1].id);
});

test('memo: parts and manifest are kept in memory, capped by bytes', async () => {
  const { cache, opts } = setup();
  await refreshDirs(cache, opts);
  await buildAll(cache, opts);
  const memo = new Map();
  cache.stats.gets = 0;
  cache.stats.keys.length = 0;
  const first = await searchIndex(cache, TARGET[0], TARGET[1], { memo });
  assert.equal(cache.stats.gets, 2 + 4, 'manifest, dirs.json and one all.bin per directory');
  assert.ok(cache.stats.keys.filter((k) => k.endsWith('/all.bin')).length === 4);
  cache.stats.gets = 0;
  const second = await searchIndex(cache, TARGET[0] + 0.01, TARGET[1], { memo });
  assert.equal(cache.stats.gets, 0, 'a warm search reads nothing from the cache');
  assert.ok(second.frames.length > 0);
  assert.equal(memo.size, 5);

  // Without all.bin (older index) the parts are used.
  await cache.inner.delete(`${INDEX_ROOT}/dr1/2025W30_1B/all.bin`);
  const viaParts = await searchIndex(cache, TARGET[0], TARGET[1], {});
  assert.deepEqual(viaParts.frames, first.frames);
  // A directory whose data vanished from the cache is reported, not fatal.
  await cache.inner.delete(`${INDEX_ROOT}/dr1/2025W30_1B/part-0.bin`);
  const partial = await searchIndex(cache, TARGET[0], TARGET[1], {});
  assert.deepEqual([partial.dirsFailed, partial.dirsSearched, partial.complete], [1, 3, false]);
  assert.ok(partial.frames.length < first.frames.length && partial.frames.every((f) => !f.obsid.startsWith('2025W30_1B')));

  // A tiny cap keeps only the most recent entries.
  const small = new Map();
  await searchIndex(cache, TARGET[0], TARGET[1], { memo: small, memoMaxBytes: 60000 });
  let bytes = 0;
  for (const e of small.values()) bytes += e.bytes;
  assert.ok(small.size >= 1 && small.size < 4 && bytes <= 60000 + 50000, `${small.size} entries, ${bytes} bytes`);
});

test('moving body: exactly the exposures that caught it where it was at the time', async () => {
  const s3 = createFakeS3();
  // The body crosses RA = 0 during the first directory and is 30 degrees away a year later.
  const pA = [0.0, 20.0];
  const pC = [28.0, 32.0];
  const tA = 60877.4;
  const tC = 61209.5;
  const truth = makeFakeSurvey(s3, {
    dirs: [
      { release: 'dr1', dir: '2025W30_1B', version: V_DR, n: 420, seed: 401, ...poleFor(pA, 100), mjd0: 60877.0, centre: pA, step: 2.2, cross: 2 },
      { release: 'dr1', dir: '2025W40_1A', version: V_DR, n: 300, seed: 402, poleRa: 100, poleDec: 40, mjd0: 60950.0 },
      { release: 'qr3', dir: '2026W25_2A', version: V_QR, n: 500, seed: 403, ...poleFor(pC, 100), mjd0: 61209.0, centre: pC, step: 2.2, cross: 2 },
      { release: 'qr3', dir: '2026W30_1A', version: V_QR, n: 300, seed: 404, ...poleFor(pA, 100), mjd0: 61300.0, centre: pA, step: 2.2, cross: 2 },
    ],
  });
  const cache = createMemoryCache();
  const opts = { fetchImpl: s3.fetchImpl, ...fast };
  await refreshDirs(cache, opts);
  await buildAll(cache, opts);

  // True path: uniform motion along the great circle through pA (at tA) and pC (at tC).
  const a = skyBasis(pA[0], pA[1]).b;
  const c = skyBasis(pC[0], pC[1]).b;
  const omega = Math.acos(a[0] * c[0] + a[1] * c[1] + a[2] * c[2]);
  const rate = omega / (tC - tA); // radians per day; about 2.6 degrees per month
  assert.ok(rate * 30 * 57.3 > 2 && rate * 30 * 57.3 < 4);
  const positionAt = (mjd) => {
    const angle = rate * (mjd - tA);
    const s = Math.sin(omega);
    const wa = Math.sin(omega - angle) / s;
    const wc = Math.sin(angle) / s;
    return vectorToSky([wa * a[0] + wc * c[0], wa * a[1] + wc * c[1], wa * a[2] + wc * c[2]]);
  };
  const ephemeris = (t0, t1, stepDays) => {
    const out = [];
    for (let t = t0; t <= t1 + 1e-9; t += stepDays) {
      const [ra, dec] = positionAt(t);
      out.push({ mjd: t, ra, dec });
    }
    return out;
  };
  const samples = ephemeris(60870, 61250, 0.5);
  assert.ok(samples.some((s) => s.ra > 359) && samples.some((s) => s.ra < 1), 'the ephemeris wraps through RA 0');
  const inSpan = (mjd) => (mjd >= samples[0].mjd && mjd <= samples[samples.length - 1].mjd ? positionAt(mjd) : null);
  const expected = expectation(truth.dirs, inSpan);
  assert.ok(expected.must.size >= 15, `${expected.must.size} true frames`);

  const memo = new Map();
  const result = await searchIndexMoving(cache, samples, { memo });
  checkAgainstTruth(result, expected, 'moving body');
  assert.ok(result.frames.some((f) => f.obsid.startsWith('2025W30_1B')) && result.frames.some((f) => f.obsid.startsWith('2026W25_2A')));
  assert.ok(result.frames.every((f) => !f.obsid.startsWith('2026W30_1A')), 'the last directory is after the ephemeris');
  assert.deepEqual([result.dirsIndexed, result.dirsTotal, result.complete], [4, 4, true]);
  assert.ok(result.dirsSearched >= 2 && result.dirsSearched <= 3, `${result.dirsSearched} directories searched`);
  // Every frame says where the body was at that exposure.
  let wrapped = 0;
  for (const f of result.frames) {
    const [ra, dec] = positionAt(f.mjd);
    const dra = Math.abs(((f.ra - ra + 540) % 360) - 180);
    assert.ok(dra * Math.cos((dec * Math.PI) / 180) < 2e-5 && Math.abs(f.dec - dec) < 2e-5, `${f.ra}, ${f.dec} vs ${ra}, ${dec}`);
    assert.ok(f.ra >= 0 && f.ra < 360);
    assert.equal(Math.round(f.ra * 1e6) / 1e6, f.ra);
    if (f.ra > 350) wrapped += 1;
  }
  assert.ok(wrapped > 0 && result.frames.some((f) => f.ra < 10), 'frames on both sides of RA 0');

  // A fixed-position search at either end finds only that end: the motion matters.
  const fixedA = await searchIndex(cache, pA[0], pA[1], { memo });
  assert.ok(fixedA.frames.some((f) => f.obsid.startsWith('2026W30_1A')) && fixedA.frames.every((f) => !f.obsid.startsWith('2026W25_2A')));

  // Sparse sampling (one point per day, coarser than the 0.8-day directories): same frames.
  const sparse = await searchIndexMoving(cache, ephemeris(60870, 61250, 1), { memo });
  checkAgainstTruth(sparse, expected, 'moving body, daily samples');
  assert.deepEqual(sparse.frames.map((f) => f.id), result.frames.map((f) => f.id));

  // Options are the same as for searchIndex.
  const d2 = await searchIndexMoving(cache, samples, { memo, dets: [2], maxPerDet: 3 });
  assert.ok(d2.frames.length <= 3 && d2.frames.every((f) => f.det === 2));
  assert.equal(d2.counts[0].total, result.frames.filter((f) => f.det === 2).length);
  // An ephemeris that covers only the first directory.
  const early = await searchIndexMoving(cache, ephemeris(60876, 60879, 0.25), { memo });
  assert.deepEqual(early.frames.map((f) => f.id), result.frames.filter((f) => f.mjd < 60900).map((f) => f.id));
  assert.equal(early.dirsSearched, 1);
  // Bad input.
  await assert.rejects(searchIndexMoving(cache, [{ mjd: 1, ra: 2, dec: 3 }]), RangeError);
  await assert.rejects(searchIndexMoving(cache, [{ mjd: 2, ra: 2, dec: 3 }, { mjd: 1, ra: 2, dec: 3 }]), RangeError);
  await assert.rejects(searchIndexMoving(cache, [{ mjd: 1, ra: 2, dec: 3 }, { mjd: 2, ra: NaN, dec: 3 }]), RangeError);
});

test('search speed: 10 directories, 18,000 exposures x 6 detectors', async () => {
  // Parts written straight into the cache (no header reads): random attitudes within 12 degrees
  // of the target so that every exposure passes the first rejection and is fully projected.
  const cache = createMemoryCache();
  const rand = mulberry32(9);
  const target = [150, 2.2];
  const metas = [];
  const dirs = [];
  const s = 6.155 / 3600;
  for (let d = 0; d < 10; d++) {
    const n = 1800;
    const rows = new Float64Array(n * 7);
    const exposures = [];
    for (let i = 0; i < n; i++) {
      const roll = rand() * 2 * Math.PI;
      rows.set([61000 + d * 3.5 + i * 0.0019, target[0] + (rand() - 0.5) * 16, target[1] + (rand() - 0.5) * 16,
        -s * Math.cos(roll), s * Math.sin(roll), s * Math.sin(roll), s * Math.cos(roll)], i * 7);
      exposures.push(`${String(1 + (i >> 2)).padStart(4, '0')}_${1 + (i & 3)}`);
    }
    const dir = `2026W${10 + d}_1A`;
    const meta = { release: 'qr3', dir, version: V_QR, n, parts: 2, partSize: 900, mjdMin: rows[0], mjdMax: rows[(n - 1) * 7], bad: 0,
      cells: btoa(String.fromCharCode(...coverageCells(rows))), all: true, builtAt: 'x' };
    await cache.put(`${INDEX_ROOT}/qr3/${dir}/all.bin`, encodePart({ release: 'qr3', dir, version: V_QR, start: 0, exposures, rows, dets: null }));
    metas.push(meta);
    dirs.push({ release: 'qr3', dir, version: V_QR, prefix: `qr3/level2/${dir}/${V_QR}/` });
  }
  await cache.put(MANIFEST_KEY, new TextEncoder().encode(JSON.stringify({ builtAt: 'x', dirs: metas })));
  await cache.put(DIRS_KEY, new TextEncoder().encode(JSON.stringify({ fetchedAt: new Date().toISOString(), dirs })));
  const memo = new Map();
  const cold0 = performance.now();
  const cold = await searchIndex(cache, target[0], target[1], { memo });
  const coldMs = performance.now() - cold0;
  assert.equal(cold.dirsSearched, 10);
  assert.ok(cold.frames.length > 1000, `${cold.frames.length} frames`);
  let best = Infinity;
  let frames = 0;
  for (let k = 0; k < 20; k++) {
    const t0 = performance.now();
    const r = await searchIndex(cache, target[0] + k * 0.01, target[1], { memo });
    best = Math.min(best, performance.now() - t0);
    frames = r.frames.length;
  }
  let bestMoving = Infinity;
  const samples = [];
  for (let t = 60990; t <= 61040; t += 0.25) samples.push({ mjd: t, ra: target[0] + (t - 61015) * 0.1, dec: target[1] });
  for (let k = 0; k < 10; k++) {
    const t0 = performance.now();
    await searchIndexMoving(cache, samples, { memo });
    bestMoving = Math.min(bestMoving, performance.now() - t0);
  }
  console.log(`  search speed: warm ${best.toFixed(2)} ms (${frames} frames from 18,000 exposures x 6 detectors), cold ${coldMs.toFixed(1)} ms including decoding 10 directories, moving body ${bestMoving.toFixed(2)} ms`);
  assert.ok(best < 50, `warm search took ${best.toFixed(1)} ms`);
  assert.ok(bestMoving < 50, `warm moving search took ${bestMoving.toFixed(1)} ms`);
  // With thinning the answer is small and still fast.
  const thinned = await searchIndex(cache, target[0], target[1], { memo, maxPerDet: 100 });
  assert.equal(thinned.frames.length, 600);
});
