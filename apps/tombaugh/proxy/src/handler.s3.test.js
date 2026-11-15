// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The 's3' backend of the handler, end to end against the in-memory bucket of fixtures/fakes3.js:
// build the exposure index through POST /index, search it, follow a moving body, cut a frame
// out of a full file with Range requests, and fall back to IRSA when the index cannot answer.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from './handler.js';
import { createMemoryCache } from './cache.js';
import { decodeFrame } from './encode.js';
import { createFakeS3, makeFakeLevel2, makeFakeSurvey } from '../fixtures/fakes3.js';

const TARGET = [210.80227, 54.34895];
const V_QR = 'l2b-v27-2026-273';
const KEY = `qr3/level2/2026W25_2A/${V_QR}/2/level2_2026W25_2A_0279_1D2_spx_${V_QR}.fits`;
const ID = `ibe/data/spherex/${KEY}`;
const D2R = Math.PI / 180;

/** A scan pole 90 degrees from the target, so that the scan circle passes over it. */
function poleFor([ra, dec], angle) {
  const e = [-Math.sin(ra * D2R), Math.cos(ra * D2R), 0];
  const n = [-Math.sin(dec * D2R) * Math.cos(ra * D2R), -Math.sin(dec * D2R) * Math.sin(ra * D2R), Math.cos(dec * D2R)];
  const c = Math.cos(angle * D2R);
  const s = Math.sin(angle * D2R);
  const v = [c * e[0] + s * n[0], c * e[1] + s * n[1], c * e[2] + s * n[2]];
  return { poleRa: ((Math.atan2(v[1], v[0]) / D2R) + 360) % 360, poleDec: Math.asin(v[2]) / D2R };
}

function setup({ irsa } = {}) {
  const s3 = createFakeS3();
  makeFakeSurvey(s3, {
    dirs: [
      { release: 'qr3', dir: '2026W25_2A', version: V_QR, n: 260, seed: 5, ...poleFor(TARGET, 80), mjd0: 61209.0, centre: TARGET },
      { release: 'qr3', dir: '2026W26_1A', version: V_QR, n: 220, seed: 6, ...poleFor(TARGET, 20), mjd0: 61213.0, centre: TARGET },
    ],
  });
  const cache = createMemoryCache();
  const logs = [];
  const handler = createHandler({
    backend: 's3',
    cache,
    fetchImpl: s3.fetchImpl,
    s3Options: { backoffMs: 1, timeoutMs: 5000 },
    log: (m) => logs.push(m),
    deps: irsa ? { irsa } : {},
  });
  const call = async (path, init) => handler(new Request(`https://proxy.test/functions/v1/spherex/${path}`, init));
  return { s3, cache, handler, call, logs };
}

async function buildIndex(call) {
  for (let guard = 0; guard < 50; guard++) {
    const response = await call('index?op=build&steps=20&n=150', { method: 'POST' });
    assert.equal(response.status, 200);
    const body = await response.json();
    if (body.idle) return;
  }
  throw new Error('index build did not finish');
}

test('s3 backend: the index is built through POST /index and answers /search', async () => {
  const { call } = setup();
  const before = await (await call('index')).json();
  assert.equal(before.complete, false);

  await buildIndex(call);
  const status = await (await call('index?full=1')).json();
  assert.equal(status.complete, true);
  assert.equal(status.dirsTotal, 2);
  assert.equal(status.dirsDone, 2);
  assert.equal(status.dirs.length, 2);
  assert.ok(status.exposuresDone > 400);

  const response = await call(`search?ra=${TARGET[0]}&dec=${TARGET[1]}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, 'index');
  assert.equal(body.complete, true);
  assert.ok(body.frames.length > 0, 'frames over the target');
  assert.deepEqual(body.index, { dirsIndexed: 2, dirsTotal: 2, dirsSearched: body.index.dirsSearched, dirsFailed: 0 });
  for (const f of body.frames) {
    assert.match(f.id, /^ibe\/data\/spherex\/qr3\/level2\/2026W2[56]_[12]A\//);
    assert.ok(f.det >= 1 && f.det <= 6);
    assert.ok(f.x >= 1 && f.x <= 2040 && f.y >= 1 && f.y <= 2040);
  }
  const mjds = body.frames.map((f) => f.mjd);
  assert.deepEqual(mjds, [...mjds].sort((a, b) => a - b));
  assert.equal(body.counts.reduce((sum, c) => sum + c.returned, 0), body.frames.length);

  // max thins every detector
  const thinned = await (await call(`search?ra=${TARGET[0]}&dec=${TARGET[1]}&max=2`)).json();
  for (const c of thinned.counts) assert.ok(c.returned <= 2);
});

test('s3 backend: a position the complete index does not cover is an empty, complete answer', async () => {
  const { call } = setup({ irsa: { searchFrames: async () => assert.fail('IRSA must not be asked') } });
  await buildIndex(call);
  const body = await (await call('search?ra=30&dec=-70')).json();
  assert.equal(body.source, 'index');
  assert.equal(body.complete, true);
  assert.deepEqual(body.frames, []);
});

test('s3 backend: before the index exists /search falls back to IRSA TAP', async () => {
  let asked = 0;
  const { call } = setup({
    irsa: {
      searchFrames: async () => {
        asked += 1;
        return [{ id: ID, det: 2, mjd: 61210.79, release: 'qr3', obsid: '2026W25_2A_0279_1' }];
      },
    },
  });
  const body = await (await call(`search?ra=${TARGET[0]}&dec=${TARGET[1]}`)).json();
  assert.equal(asked, 1);
  assert.equal(body.source, 'irsa-tap');
  assert.equal(body.frames.length, 1);
});

test('s3 backend: /track follows a moving body through the index', async () => {
  const { call } = setup();
  await buildIndex(call);
  const samples = [];
  for (let i = 0; i <= 40; i++) samples.push([61208 + i * 0.25, TARGET[0] + (i - 20) * 0.01, TARGET[1] + (i - 20) * 0.004]);
  const response = await call('track', { method: 'POST', body: JSON.stringify({ samples, dets: [1, 2, 3], maxPerDet: 0 }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, 'index');
  assert.ok(body.frames.length > 0);
  for (const f of body.frames) {
    assert.ok([1, 2, 3].includes(f.det));
    assert.ok(Math.abs(f.ra - TARGET[0]) < 0.3 && Math.abs(f.dec - TARGET[1]) < 0.1, 'frame carries the interpolated position');
  }
  assert.equal((await call('track')).status, 405);
  assert.equal((await call('track', { method: 'POST', body: '{"samples":[[1,2,3]]}' })).status, 400);
  assert.equal((await call('track', { method: 'POST', body: 'nope' })).status, 400);
});

test('s3 backend: /cutout reads a window out of the full file and encodes TBF1', async () => {
  const irsa = {
    fetchCutoutHead: async () => assert.fail('IRSA cutout must not be used'),
    fetchWaveTable: async () => assert.fail('IRSA wave table must not be used'),
  };
  const { call, s3 } = setup({ irsa });
  s3.put(KEY, makeFakeLevel2({ seed: 11 }));
  const response = await call(`cutout?id=${encodeURIComponent(ID)}&ra=${TARGET[0]}&dec=${TARGET[1]}&size=0.1`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-tombaugh-cache'), 'miss');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const frame = decodeFrame(bytes);
  assert.equal(frame.id, ID);
  assert.equal(frame.det, 2);
  assert.equal(frame.nx, 59);
  assert.equal(frame.ny, 59);
  assert.ok(frame.image instanceof Float32Array && frame.image.length === 59 * 59);

  const again = await call(`cutout?id=${encodeURIComponent(ID)}&ra=${TARGET[0]}&dec=${TARGET[1]}&size=0.1`);
  assert.equal(again.headers.get('x-tombaugh-cache'), 'hit');

  // off the detector, and a file that does not exist: plain 404s, no IRSA fallback
  const off = await call(`cutout?id=${encodeURIComponent(ID)}&ra=10&dec=-40&size=0.1`);
  assert.equal(off.status, 404);
  const missing = await call(`cutout?id=${encodeURIComponent(ID.replace('0279_1D2', '0999_1D2'))}&ra=${TARGET[0]}&dec=${TARGET[1]}`);
  assert.equal(missing.status, 404);
});

test('s3 backend: /identify and /ephemeris use the injected services and cache the catalogue answer', async () => {
  let cones = 0;
  const handler = createHandler({
    backend: 's3',
    cache: createMemoryCache(),
    fetchImpl: async () => assert.fail('no network in this test'),
    log: () => {},
    deps: {
      identifyCone: async (ra, dec, radius) => {
        cones += 1;
        return { objects: [{ name: 'Barnard\'s Star', ra, dec, sepArcsec: 0.4, radius }], source: 'simbad' };
      },
      ephemerisRoute: async (params) => ({ status: 200, body: { body: params.get('body'), samples: [{ mjd: 61000, ra: 1, dec: 2 }] } }),
    },
  });
  const get = (path) => handler(new Request(`https://proxy.test/api/${path}`));
  const first = await (await get('identify?ra=269.45&dec=4.69&radius=0.004')).json();
  assert.equal(first.cached, false);
  assert.equal(first.objects[0].name, 'Barnard\'s Star');
  const second = await (await get('identify?ra=269.45&dec=4.69&radius=0.004')).json();
  assert.equal(second.cached, true);
  assert.equal(cones, 1);
  const eph = await (await get('ephemeris?body=999')).json();
  assert.equal(eph.body, '999');
});

test('synthetic backend: /identify answers from the fake sky, /ephemeris, /track and /index decline', async () => {
  const handler = createHandler({ backend: 'synthetic', syntheticLatencyMs: 0, log: () => {} });
  const base = 'https://proxy.test/api/';
  const identify = await handler(new Request(`${base}identify?ra=269.4521&dec=4.6934&radius=0.05`));
  assert.equal(identify.status, 200);
  const body = await identify.json();
  assert.equal(body.simulated, true);
  assert.ok(Array.isArray(body.objects));
  assert.equal((await handler(new Request(`${base}ephemeris?body=999`))).status, 503);
  assert.equal((await handler(new Request(`${base}track`, { method: 'POST', body: '{}' }))).status, 503);
  assert.equal((await handler(new Request(`${base}index`))).status, 404);
});

test('s3 backend: a week with a main and a retry folder is indexed as two units and searched as one', async () => {
  const s3 = createFakeS3();
  const V_RETRY = 'l2b_retry-v27-2026-273';
  const OTHER = [100, -30];
  makeFakeSurvey(s3, {
    dirs: [
      { release: 'qr3', dir: '2026W25_2A', version: V_QR, n: 200, seed: 5, ...poleFor(TARGET, 80), mjd0: 61209.0, centre: TARGET },
      { release: 'qr3', dir: '2026W25_2A', version: V_RETRY, n: 60, seed: 9, ...poleFor(OTHER, 30), mjd0: 61209.5, centre: OTHER, missing: 0 },
    ],
  });
  const handler = createHandler({ backend: 's3', cache: createMemoryCache(), fetchImpl: s3.fetchImpl, s3Options: { backoffMs: 1, timeoutMs: 5000 }, log: () => {} });
  const call = async (path, init) => handler(new Request(`https://proxy.test/api/${path}`, init));
  await buildIndex(call);
  const status = await (await call('index?full=1')).json();
  assert.equal(status.dirsTotal, 2);
  assert.deepEqual(status.dirs.map((d) => d.version).sort(), [V_QR, V_RETRY].sort());
  assert.equal(status.complete, true);

  const main = await (await call(`search?ra=${TARGET[0]}&dec=${TARGET[1]}&max=0`)).json();
  assert.equal(main.complete, true);
  assert.ok(main.frames.length > 0 && main.frames.every((f) => f.id.includes(`/${V_QR}/`)), 'the main run answers at its field');
  const retry = await (await call(`search?ra=${OTHER[0]}&dec=${OTHER[1]}&max=0`)).json();
  assert.ok(retry.frames.length > 0 && retry.frames.every((f) => f.id.includes(`/${V_RETRY}/`)), 'the retry run answers at its field');
  for (const body of [main, retry]) {
    const keys = body.frames.map((f) => `${f.obsid}/${f.det}`);
    assert.equal(new Set(keys).size, keys.length, 'one frame per exposure and detector');
  }
});
