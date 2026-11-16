// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fogRead, fogMark, fogStats, fogCell, fogEncode, fogDecode, ang2pixNest,
  FOG_KEY, FOG_NSIDE, FOG_NPIX, FOG_BYTES, FOG_MAX, FOG_CONTENT_TYPE,
} from './fog.js';
import { ang2pixNest as webAng2pix, pix2angNest } from '../../web/src/fog/healpix.js';

// In-memory cache with the contract's shape. `delay` makes get/put asynchronous for real, so
// overlapping calls interleave; `store` can be shared between two caches to mimic two processes.
function fakeCache({ store = new Map(), delay = 0 } = {}) {
  const log = [];
  const wait = () => (delay ? new Promise((r) => setTimeout(r, Math.random() * delay)) : Promise.resolve());
  return {
    store,
    log,
    async get(key) {
      await wait();
      const v = store.get(key);
      return v ? v.slice() : null;
    },
    async put(key, u8, contentType) {
      await wait();
      log.push({ key, bytes: u8.byteLength, contentType });
      store.set(key, u8.slice());
    },
  };
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

const sum = (counts) => counts.reduce((a, b) => a + b, 0);

test('constants', () => {
  assert.equal(FOG_KEY, 'fog/nside32.bin');
  assert.equal(FOG_NSIDE, 32);
  assert.equal(FOG_NPIX, 12288);
  assert.equal(FOG_BYTES, 24576);
  assert.equal(FOG_MAX, 65535);
  assert.equal(FOG_CONTENT_TYPE, 'application/octet-stream');
});

test('the proxy copy of ang2pixNest agrees with the browser module', () => {
  // Every cell centre, at several resolutions.
  for (const nside of [1, 2, 8, 32]) {
    for (let p = 0; p < 12 * nside * nside; p++) {
      const [ra, dec] = pix2angNest(nside, p);
      assert.equal(ang2pixNest(nside, ra, dec), p);
    }
  }
  const rand = mulberry32(5);
  for (let k = 0; k < 50000; k++) {
    const ra = rand() * 720 - 180;
    const dec = Math.asin(2 * rand() - 1) * (180 / Math.PI);
    const nside = [1, 4, 32, 512][k % 4];
    assert.equal(ang2pixNest(nside, ra, dec), webAng2pix(nside, ra, dec));
  }
  for (const [ra, dec] of [[0, 90], [0, -90], [360, 0], [45, 41.8103148957786], [0, 41.8103148957786]]) {
    assert.equal(ang2pixNest(32, ra, dec), webAng2pix(32, ra, dec));
  }
  assert.ok(ang2pixNest(1, 0, 90) <= 3);
  assert.equal(ang2pixNest(1, 0, 0), 4);
  assert.equal(ang2pixNest(32, NaN, 0), -1);
  assert.throws(() => ang2pixNest(3, 0, 0), RangeError);
});

test('fogCell validates its input', () => {
  assert.equal(fogCell(269.45, 4.69), ang2pixNest(32, 269.45, 4.69));
  assert.equal(fogCell(269.45 + 360, 4.69), fogCell(269.45, 4.69));
  assert.equal(fogCell(-90.55, 4.69), fogCell(269.45, 4.69));
  assert.ok(fogCell(0, 90) >= 0 && fogCell(0, -90) < FOG_NPIX);
  for (const [ra, dec] of [[NaN, 0], [0, NaN], [0, 90.01], [0, -91], [Infinity, 0], ['10', 0], [10, null], [undefined, undefined]]) {
    assert.equal(fogCell(ra, dec), -1);
  }
});

test('encode / decode: little-endian, fixed size', () => {
  const counts = new Uint16Array(FOG_NPIX);
  counts[0] = 1;
  counts[1] = 0x1234;
  counts[FOG_NPIX - 1] = 65535;
  const u8 = fogEncode(counts);
  assert.ok(u8 instanceof Uint8Array);
  assert.equal(u8.byteLength, 24576);
  assert.deepEqual([...u8.subarray(0, 4)], [1, 0, 0x34, 0x12]);
  assert.deepEqual([...u8.subarray(FOG_BYTES - 2)], [255, 255]);
  assert.deepEqual(fogDecode(u8), counts);
  assert.deepEqual(fogDecode(u8.buffer), counts);
  // A view at an odd byte offset still decodes.
  const padded = new Uint8Array(FOG_BYTES + 3);
  padded.set(u8, 3);
  assert.deepEqual(fogDecode(padded.subarray(3)), counts);
  // Clamping and short input.
  const odd = fogEncode([70000, -5, 2.9, NaN]);
  assert.deepEqual([...fogDecode(odd).subarray(0, 5)], [65535, 0, 2, 0, 0]);
  assert.equal(fogEncode(null).byteLength, FOG_BYTES);
});

test('fogRead: zeros when missing', async () => {
  const cache = fakeCache();
  const counts = await fogRead(cache);
  assert.ok(counts instanceof Uint16Array);
  assert.equal(counts.length, 12288);
  assert.equal(sum(counts), 0);
  assert.equal(cache.log.length, 0, 'reading does not write');
});

test('fogRead: zeros when the stored object is malformed', async () => {
  const bad = [
    new Uint8Array(0),
    new Uint8Array(100).fill(7),
    new Uint8Array(FOG_BYTES - 1).fill(1),
    new Uint8Array(FOG_BYTES + 2).fill(1),
    new TextEncoder().encode('{"error":"not found"}'),
  ];
  for (const u8 of bad) {
    const cache = fakeCache();
    cache.store.set(FOG_KEY, u8);
    const counts = await fogRead(cache);
    assert.equal(counts.length, FOG_NPIX);
    assert.equal(sum(counts), 0);
  }
  // Wrong types from a sloppy cache.
  for (const value of ['text', 42, {}, undefined]) {
    const counts = await fogRead({ get: async () => value, put: async () => {} });
    assert.equal(counts.length, FOG_NPIX);
    assert.equal(sum(counts), 0);
  }
});

test('fogMark: increments, writes back, round trips through fogRead', async () => {
  const cache = fakeCache();
  const cell = fogCell(269.45, 4.69);
  assert.deepEqual(await fogMark(cache, 269.45, 4.69), { cell, count: 1 });
  assert.deepEqual(await fogMark(cache, 269.45, 4.69), { cell, count: 2 });
  // A position 0.3 deg away is in the same 1.8 deg cell; RA wraps.
  assert.deepEqual(await fogMark(cache, 269.45 + 360, 4.69), { cell, count: 3 });
  const other = await fogMark(cache, 133.8, -7.25);
  assert.equal(other.count, 1);
  assert.notEqual(other.cell, cell);

  assert.equal(cache.log.length, 4);
  for (const entry of cache.log) {
    assert.deepEqual(entry, { key: 'fog/nside32.bin', bytes: 24576, contentType: 'application/octet-stream' });
  }
  const stored = cache.store.get(FOG_KEY);
  assert.equal(stored[2 * cell], 3, 'low byte first');
  assert.equal(stored[2 * cell + 1], 0);

  const counts = await fogRead(cache);
  assert.equal(counts[cell], 3);
  assert.equal(counts[other.cell], 1);
  assert.equal(sum(counts), 4);
  assert.deepEqual(fogStats(counts), { opened: 2, total: 12288, fraction: 2 / 12288 });
});

test('fogMark: starts from zeros when the stored object is malformed', async () => {
  const cache = fakeCache();
  cache.store.set(FOG_KEY, new Uint8Array(999).fill(255));
  const { cell, count } = await fogMark(cache, 10, 20);
  assert.equal(count, 1);
  assert.equal(cache.store.get(FOG_KEY).byteLength, FOG_BYTES);
  const counts = await fogRead(cache);
  assert.equal(counts[cell], 1);
  assert.equal(sum(counts), 1);
});

test('fogMark: saturates at 65535', async () => {
  const cache = fakeCache();
  const cell = fogCell(76.96, 30.4);
  const counts = new Uint16Array(FOG_NPIX);
  counts[cell] = 65534;
  cache.store.set(FOG_KEY, fogEncode(counts));
  assert.equal((await fogMark(cache, 76.96, 30.4)).count, 65535);
  assert.equal((await fogMark(cache, 76.96, 30.4)).count, 65535);
  assert.equal((await fogRead(cache))[cell], 65535);
  assert.equal(sum(await fogRead(cache)), 65535, 'no overflow into neighbouring cells');
});

test('fogMark: rejects unusable coordinates and writes nothing', async () => {
  const cache = fakeCache();
  for (const [ra, dec] of [[NaN, 0], [0, 91], [0, -90.5], [Infinity, 2], ['1', '2'], [undefined, undefined]]) {
    await assert.rejects(() => fogMark(cache, ra, dec), RangeError);
  }
  assert.equal(cache.log.length, 0);
  assert.equal(cache.store.size, 0);
  // The poles are fine.
  assert.equal((await fogMark(cache, 0, 90)).count, 1);
  assert.equal((await fogMark(cache, 123, -90)).count, 1);
});

test('fogMark: a failed read never overwrites the map; a failed mark does not block the next', async () => {
  const store = new Map();
  const good = new Uint16Array(FOG_NPIX).fill(3);
  store.set(FOG_KEY, fogEncode(good));
  let failGet = true;
  let puts = 0;
  const cache = {
    async get(key) {
      if (failGet) throw new Error('storage unavailable');
      return store.get(key).slice();
    },
    async put(key, u8) { puts++; store.set(key, u8.slice()); },
  };
  await assert.rejects(() => fogMark(cache, 1, 2), /storage unavailable/);
  await assert.rejects(() => fogRead(cache), /storage unavailable/);
  assert.equal(puts, 0);
  assert.deepEqual(fogDecode(store.get(FOG_KEY)), good);
  failGet = false;
  const { cell, count } = await fogMark(cache, 1, 2);
  assert.equal(count, 4);
  assert.equal(puts, 1);
  assert.equal(fogDecode(store.get(FOG_KEY))[cell], 4);

  // A failing put propagates too.
  const readOnly = { get: async () => null, put: async () => { throw new Error('read-only'); } };
  await assert.rejects(() => fogMark(readOnly, 1, 2), /read-only/);
});

test('concurrent marks through one cache lose nothing and never corrupt the array', async () => {
  const cache = fakeCache({ delay: 3 });
  const rand = mulberry32(11);
  const expected = new Uint16Array(FOG_NPIX);
  const jobs = [];
  for (let k = 0; k < 150; k++) {
    // Half the marks pile onto one cell, the rest are spread over the sky.
    const ra = k % 2 ? 269.45 : rand() * 360;
    const dec = k % 2 ? 4.69 : Math.asin(2 * rand() - 1) * (180 / Math.PI);
    expected[fogCell(ra, dec)]++;
    jobs.push(fogMark(cache, ra, dec));
  }
  const results = await Promise.all(jobs);
  const counts = await fogRead(cache);
  assert.equal(cache.store.get(FOG_KEY).byteLength, FOG_BYTES);
  assert.deepEqual(counts, expected);
  assert.equal(sum(counts), 150);
  const busy = fogCell(269.45, 4.69);
  assert.ok(counts[busy] >= 75, 'the busy cell received at least its 75 marks');
  // Each result reports a count that was true at the time: 1..final for its cell.
  for (const { cell, count } of results) assert.ok(count >= 1 && count <= expected[cell]);
  // Marks on one cell were applied one after another: its results are 1, 2, 3, ... with no repeats.
  const seen = results.filter((r) => r.cell === busy).map((r) => r.count).sort((x, y) => x - y);
  assert.deepEqual(seen, Array.from({ length: expected[busy] }, (_, i) => i + 1));
});

test('racing processes may lose increments but the stored array stays well-formed', async () => {
  // Two cache objects over one store behave like two proxy instances with no shared queue.
  const store = new Map();
  const a = fakeCache({ store, delay: 2 });
  const b = fakeCache({ store, delay: 2 });
  const rand = mulberry32(21);
  const expected = new Uint16Array(FOG_NPIX);
  const jobs = [];
  for (let k = 0; k < 120; k++) {
    const ra = rand() * 360;
    const dec = Math.asin(2 * rand() - 1) * (180 / Math.PI);
    expected[fogCell(ra, dec)]++;
    jobs.push(fogMark(k % 2 ? a : b, ra, dec));
  }
  await Promise.all(jobs);
  const bytes = store.get(FOG_KEY);
  assert.equal(bytes.byteLength, FOG_BYTES);
  const counts = fogDecode(bytes);
  let total = 0;
  for (let i = 0; i < FOG_NPIX; i++) {
    assert.ok(counts[i] <= expected[i], `cell ${i} never exceeds the marks it received`);
    total += counts[i];
  }
  assert.ok(total >= 1 && total <= 120);
  for (const entry of [...a.log, ...b.log]) {
    assert.equal(entry.bytes, FOG_BYTES);
    assert.equal(entry.contentType, 'application/octet-stream');
  }
});

test('fogStats', () => {
  assert.deepEqual(fogStats(new Uint16Array(FOG_NPIX)), { opened: 0, total: 12288, fraction: 0 });
  const counts = new Uint16Array(FOG_NPIX);
  counts.fill(2, 0, 3072);
  assert.deepEqual(fogStats(counts), { opened: 3072, total: 12288, fraction: 0.25 });
  assert.deepEqual(fogStats(new Uint16Array(FOG_NPIX).fill(65535)), { opened: 12288, total: 12288, fraction: 1 });
  assert.deepEqual(fogStats(null), { opened: 0, total: 0, fraction: 0 });
});

test('fog.js is environment-neutral: no imports, no Node or DOM globals', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('./fog.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'no import statements');
  assert.ok(!/\b(require|process|Buffer|window|document|Deno)\b\s*[.(]/.test(src), 'no platform globals');
  assert.ok(src.startsWith('// Tombaugh - SPHEREx blink comparator. Apache-2.0.\n// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.'));
});
