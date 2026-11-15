// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, createApi } from '../api.js';
import { createIdbCache, createMemoryAdapter } from './idbcache.js';
import { LocalModeError, createLocalApi, makeIndexSource, withIndexSource } from './localapi.js';

const quiet = () => {};
const RA = 150.0;
const DEC = 2.2;

/** A cache that counts what the handler does with it. */
function spyCache() {
  const inner = createIdbCache({ adapter: createMemoryAdapter(), log: quiet });
  const calls = { get: [], put: [] };
  return {
    calls,
    inner,
    kind: 'memory',
    get: (key, opts) => {
      calls.get.push(key);
      return inner.get(key, opts);
    },
    put: (key, bytes, type) => {
      calls.put.push(key);
      return inner.put(key, bytes, type);
    },
    delete: (key) => inner.delete(key),
    stats: () => inner.stats(),
  };
}

async function optional(path) {
  try {
    return await import(path);
  } catch {
    return null;
  }
}

const handlerModule = await optional('../../../proxy/src/handler.js');
const synthModule = await optional('../../../proxy/fixtures/synth.js');
const haveSynthetic = Boolean(handlerModule && synthModule);
const skipSynthetic = haveSynthetic ? false : 'proxy/src/handler.js or proxy/fixtures/synth.js is not there yet';

// ---------------------------------------------------------------------------------------------
// The synthetic backend, end to end through the real handler
// ---------------------------------------------------------------------------------------------

test('is a drop-in for createApi: same methods, baseUrl "local:<backend>"', () => {
  const remote = createApi('https://example.invalid/api');
  const local = createLocalApi({ backend: 'synthetic', cache: spyCache(), log: quiet });
  for (const key of Object.keys(remote)) {
    assert.equal(typeof local[key], typeof remote[key], `api.${key}`);
  }
  assert.equal(local.baseUrl, 'local:synthetic');
  assert.equal(local.simulated, true);
  assert.equal(createLocalApi({ backend: 's3', cache: spyCache(), log: quiet }).baseUrl, 'local:s3');
  assert.throws(() => createLocalApi({ backend: 'irsa' }), LocalModeError);
});

test('practice search returns sorted frames and is marked simulated', { skip: skipSynthetic }, async () => {
  const api = createLocalApi({ backend: 'synthetic', cache: spyCache(), log: quiet });
  const res = await api.search(RA, DEC);
  assert.equal(res.simulated, true);
  assert.equal(res.ra, RA);
  assert.equal(res.dec, DEC);
  assert.equal(typeof res.fetchedAt, 'string');
  assert.ok(Array.isArray(res.frames) && res.frames.length > 100, `${res.frames.length} frames`);
  for (let i = 1; i < res.frames.length; i++) assert.ok(res.frames[i].mjd >= res.frames[i - 1].mjd);
  const dets = new Set(res.frames.map((f) => f.det));
  assert.deepEqual([...dets].sort(), [1, 2, 3, 4, 5, 6]);
  const f = res.frames[0];
  assert.deepEqual(Object.keys(f).sort(), ['det', 'id', 'mjd', 'obsid', 'release']);
  assert.match(f.id, /^ibe\/data\/spherex\//);
});

test('a practice cutout decodes to a Frame with arrays of the right size', { skip: skipSynthetic }, async () => {
  const api = createLocalApi({ backend: 'synthetic', cache: spyCache(), log: quiet });
  const { frames } = await api.search(RA, DEC);
  const ref = frames.find((f) => f.det === 3);
  const frame = await api.cutout(ref.id, RA, DEC, 0.1);
  assert.equal(frame.id, ref.id);
  assert.equal(frame.det, 3);
  assert.ok(frame.nx > 20 && frame.nx <= 59 && frame.ny > 20 && frame.ny <= 59, `${frame.nx} x ${frame.ny}`);
  const n = frame.nx * frame.ny;
  assert.ok(frame.image instanceof Float32Array && frame.image.length === n);
  assert.ok(frame.variance instanceof Float32Array && frame.variance.length === n);
  assert.ok(frame.zodi instanceof Float32Array && frame.zodi.length === n);
  assert.ok(frame.flags instanceof Int32Array && frame.flags.length === n);
  assert.ok(frame.wave instanceof Float32Array && frame.wave.length === n);
  assert.ok(Math.abs(frame.mjd - ref.mjd) < 0.01);
  assert.ok(frame.waveCenter > 1.6 && frame.waveCenter < 2.45, `D3 wavelength ${frame.waveCenter}`);
  assert.ok(frame.wcs && Array.isArray(frame.wcs.crpix) && Array.isArray(frame.wcs.crval));
  let finite = 0;
  for (const v of frame.image) if (Number.isFinite(v)) finite += 1;
  assert.ok(finite > 0.9 * n, 'most pixels are finite');
  // A wider cutout is wider.
  const wide = await api.cutout(ref.id, RA, DEC, 0.2);
  assert.ok(wide.nx > frame.nx || wide.ny > frame.ny);
});

test('the second identical cutout comes from the cache', { skip: skipSynthetic }, async () => {
  const cache = spyCache();
  const api = createLocalApi({ backend: 'synthetic', cache, log: quiet });
  const { frames } = await api.search(RA, DEC);
  const a = await api.cutout(frames[0].id, RA, DEC, 0.1);
  const cutoutPuts = cache.calls.put.filter((k) => k.startsWith('cutout/'));
  assert.equal(cutoutPuts.length, 1);
  const hitsBefore = cache.stats().hits;
  const b = await api.cutout(frames[0].id, RA, DEC, 0.1);
  assert.equal(cache.stats().hits, hitsBefore + 1, 'served from the cache');
  assert.equal(cache.calls.put.filter((k) => k.startsWith('cutout/')).length, 1, 'not rebuilt');
  assert.deepEqual([...a.image.slice(0, 50)], [...b.image.slice(0, 50)]);
  // A second api object on the same cache (a reloaded page) hits it as well.
  const again = createLocalApi({ backend: 'synthetic', cache, log: quiet });
  await again.cutout(frames[0].id, RA, DEC, 0.1);
  assert.equal(cache.stats().hits, hitsBefore + 2);
});

test('practice mode never touches the network', { skip: skipSynthetic }, async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    return Promise.reject(new Error('no network in tests'));
  };
  try {
    const api = createLocalApi({ backend: 'synthetic', cache: spyCache(), log: quiet });
    const { frames } = await api.search(RA, DEC);
    await api.cutout(frames[3].id, RA, DEC, 0.1);
    await api.gaia(RA, DEC, 0.1);
    await api.resolve("Barnard's Star");
    await api.health();
    await api.fog();
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('gaia, resolve, health, fog and fogMark answer in the shapes of api.js', { skip: skipSynthetic }, async () => {
  const api = createLocalApi({ backend: 'synthetic', cache: spyCache(), log: quiet });
  const gaia = await api.gaia(RA, DEC, 0.1);
  assert.equal(gaia.epoch, 2016.0);
  assert.ok(gaia.stars.length > 5);
  assert.deepEqual(Object.keys(gaia.stars[0]).sort(), ['dec', 'gmag', 'id', 'parallax', 'pmdec', 'pmra', 'ra']);
  assert.equal(typeof gaia.stars[0].id, 'string');

  const barnard = await api.resolve("Barnard's Star");
  assert.ok(Math.abs(barnard.ra - 269.452) < 0.01 && Math.abs(barnard.dec - 4.693) < 0.01);
  await assert.rejects(api.resolve('no such thing 12345'), (err) => err instanceof ApiError && err.status === 404 && err.retryable === false);

  const health = await api.health();
  assert.equal(health.ok, true);
  assert.equal(health.backend, 'synthetic');

  const before = await api.fog();
  assert.ok(before instanceof Uint16Array && before.length === 12288);
  const mark = await api.fogMark(RA, DEC);
  assert.equal(mark.count, 1);
  const after = await api.fog();
  assert.equal(after[mark.cell], 1);
});

test('bad requests come back as ApiError with the handler status', { skip: skipSynthetic }, async () => {
  const api = createLocalApi({ backend: 'synthetic', cache: spyCache(), log: quiet });
  await assert.rejects(api.search(400, 0), (err) => err instanceof ApiError && err.status === 400);
  await assert.rejects(api.cutout('not-a-frame', RA, DEC, 0.1), (err) => err instanceof ApiError && err.status === 400 && err.retryable === false);
});

test('an aborted signal cancels the call the way api.js reports it', { skip: skipSynthetic }, async () => {
  const api = createLocalApi({ backend: 'synthetic', cache: spyCache(), log: quiet });
  const already = new AbortController();
  already.abort();
  await assert.rejects(api.search(RA, DEC, { signal: already.signal }), (err) => err instanceof ApiError && err.aborted === true);
  const later = new AbortController();
  const pending = api.search(RA, DEC, { signal: later.signal });
  later.abort();
  await assert.rejects(pending, (err) => err instanceof ApiError && err.aborted === true);
});

test('ready() resolves once the handler exists; the default cache works without IndexedDB', { skip: skipSynthetic }, async () => {
  const api = createLocalApi({ backend: 'synthetic', log: quiet });
  assert.equal(await api.ready(), true);
  assert.equal(api.cache.kind, 'memory');
  const res = await api.search(10, -30);
  assert.ok(res.frames.length > 0);
});

// ---------------------------------------------------------------------------------------------
// handlerFactory: requests in, responses out
// ---------------------------------------------------------------------------------------------

test('handlerFactory receives the options and the handler receives Web Requests', async () => {
  const seen = [];
  let options = null;
  const cache = spyCache();
  const api = createLocalApi({
    backend: 'synthetic',
    cache,
    log: quiet,
    handlerFactory: (opts) => {
      options = opts;
      return async (request) => {
        seen.push({ url: request.url, method: request.method });
        const url = new URL(request.url);
        if (url.pathname.endsWith('/search')) return Response.json({ ra: 1, dec: 2, frames: [{ id: 'b', mjd: 5 }, { id: 'a', mjd: 3 }] });
        if (url.pathname.endsWith('/fog')) return Response.json({ cell: 7, count: 2 });
        return Response.json({ error: 'teapot', retryable: false }, { status: 418 });
      };
    },
  });
  const res = await api.search(1, 2);
  assert.equal(options.backend, 'synthetic');
  assert.equal(options.cache, cache);
  assert.equal(typeof options.fetchImpl, 'function');
  assert.deepEqual(res.frames.map((f) => f.id), ['a', 'b'], 'sorted by api.js, as for the remote proxy');
  assert.equal(res.simulated, true);
  assert.deepEqual(await api.fogMark(10, 20), { cell: 7, count: 2 });
  await assert.rejects(api.health(), (err) => err instanceof ApiError && err.status === 418 && err.message === 'teapot');
  assert.equal(seen.length, 3);
  const first = new URL(seen[0].url);
  assert.ok(first.pathname.endsWith('/search'));
  assert.equal(first.searchParams.get('ra'), '1');
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[1].method, 'POST');
  assert.equal(new URL(seen[1].url).searchParams.get('dec'), '20');
});

test('a handler that cannot be built gives a clear, catchable error on every call', async () => {
  let attempts = 0;
  const api = createLocalApi({
    backend: 'synthetic',
    cache: spyCache(),
    log: quiet,
    handlerFactory: () => {
      attempts += 1;
      throw new Error('module not found: proxy/src/handler.js');
    },
  });
  const check = (err) => {
    assert.ok(err instanceof ApiError, 'an ApiError, like every other api failure');
    assert.equal(err.status, 503);
    assert.equal(err.retryable, false);
    assert.match(err.message, /in-page data service could not start/);
    assert.match(err.message, /module not found/);
    return true;
  };
  await assert.rejects(api.search(1, 2), check);
  await assert.rejects(api.cutout('x', 1, 2, 0.1), check);
  await assert.rejects(api.fog(), check);
  await assert.rejects(api.ready(), (err) => err instanceof LocalModeError && err.retryable === false);
  assert.ok(attempts >= 2, 'a later call tries again');
});

test('a handler that is not a function is reported, not called', async () => {
  const api = createLocalApi({ backend: 'synthetic', cache: spyCache(), log: quiet, handlerFactory: () => ({}) });
  await assert.rejects(api.health(), (err) => err instanceof ApiError && /did not start/.test(err.message));
});

// ---------------------------------------------------------------------------------------------
// The exposure index read through the cache
// ---------------------------------------------------------------------------------------------

test('makeIndexSource: a URL prefix, a function, or nothing', async () => {
  assert.equal(makeIndexSource(null), null);
  assert.equal(makeIndexSource(''), null);
  const urls = [];
  const fromUrl = makeIndexSource('https://files.example/pub/', {
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.endsWith('missing.bin')) return new Response('no', { status: 404 });
      if (url.endsWith('broken.bin')) return new Response('no', { status: 500 });
      return new Response(Uint8Array.from([1, 2, 3]));
    },
  });
  assert.deepEqual([...(await fromUrl('index/v1/manifest.json'))], [1, 2, 3]);
  assert.equal(urls[0], 'https://files.example/pub/index/v1/manifest.json');
  assert.equal(await fromUrl('index/v1/missing.bin'), null);
  await assert.rejects(fromUrl('index/v1/broken.bin'), /answered 500/);

  // Objects copied out of the proxy's Supabase cache carry a 16-byte "TBC1" prefix.
  const prefixed = new Uint8Array(20);
  prefixed.set([0x54, 0x42, 0x43, 0x31], 0);
  prefixed.set([9, 8, 7, 6], 16);
  const fromFn = makeIndexSource(async () => prefixed.buffer);
  assert.deepEqual([...(await fromFn('index/v1/x'))], [9, 8, 7, 6]);
});

test('withIndexSource fills index keys from the source once and keeps them', async () => {
  const cache = createIdbCache({ adapter: createMemoryAdapter(), log: quiet });
  let fetches = 0;
  let online = true;
  const layered = withIndexSource(cache, async (key) => {
    fetches += 1;
    if (!online) throw new Error('offline');
    return key.endsWith('nothing.bin') ? null : new TextEncoder().encode(`data for ${key}`);
  });
  const key = 'index/v1/qr3/2026W25_2A/all.bin';
  const [a, b] = await Promise.all([layered.get(key), layered.get(key)]);
  assert.equal(new TextDecoder().decode(a), `data for ${key}`);
  assert.equal(new TextDecoder().decode(b), `data for ${key}`);
  assert.equal(fetches, 1, 'concurrent reads share one download');
  await layered.get(key);
  assert.equal(fetches, 1, 'then it is local');
  assert.equal(await layered.get('index/v1/nothing.bin'), null);
  // Other keys never reach the source.
  await layered.put('cutout/abc', Uint8Array.from([5]));
  assert.deepEqual([...(await layered.get('cutout/abc'))], [5]);
  assert.equal(await layered.get('cutout/zzz'), null);
  assert.equal(fetches, 2);
  // When the index cannot be reached, a miss is a miss, not an exception.
  online = false;
  assert.equal(await layered.get('index/v1/other.bin'), null);
  // Without a source the cache is returned untouched.
  assert.equal(withIndexSource(cache, null), cache);
});

test('withIndexSource refreshes an old manifest and falls back to the old copy offline', async () => {
  let t = 1_000_000;
  const cache = createIdbCache({ adapter: createMemoryAdapter(), log: quiet, now: () => t });
  let version = 1;
  let online = true;
  const layered = withIndexSource(cache, async () => {
    if (!online) throw new Error('offline');
    return new TextEncoder().encode(`manifest v${version}`);
  });
  const key = 'index/v1/manifest.json';
  const text = async () => new TextDecoder().decode(await layered.get(key));
  assert.equal(await text(), 'manifest v1');
  version = 2;
  t += 30 * 60 * 1000;
  assert.equal(await text(), 'manifest v1', 'half an hour old: still trusted');
  t += 31 * 60 * 1000;
  assert.equal(await text(), 'manifest v2', 'over an hour old: fetched again');
  version = 3;
  online = false;
  t += 2 * 3600 * 1000;
  assert.equal(await text(), 'manifest v2', 'offline: the old copy is better than nothing');
});

// ---------------------------------------------------------------------------------------------
// The 's3' backend (the handler's own, fed by withIndexSource), against a fake bucket
// ---------------------------------------------------------------------------------------------

const expindex = await optional('../../../proxy/src/expindex.js');
const s3cutout = await optional('../../../proxy/src/s3cutout.js');
const fakes3 = await optional('../../../proxy/fixtures/fakes3.js');
const skipS3 = handlerModule ? false : 'proxy/src/handler.js is not there yet';

// The real exposure 2026W25_2A_0279_1 (CONTRACT-S3.md): detector 1 pointing, as the index stores it.
const D1_ROW = [61210.79311303, 203.245672412, 57.074776311, 0.0013519433669, -0.0010984482376, -0.0010481759429, -0.00130936657274];
const TARGET = { ra: 210.80227, dec: 54.34895 }; // on detector 2 (and 5) of that exposure
const S3_KEY = 'qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits';
const S3_ID = `ibe/data/spherex/${S3_KEY}`;

/** A one-directory exposure index, as files keyed like the proxy cache. */
function tinyIndex() {
  const rows = Float64Array.from(D1_ROW);
  const cells = expindex.coverageCells(rows);
  let b64 = '';
  for (const byte of cells) b64 += String.fromCharCode(byte);
  const meta = { release: 'qr3', dir: '2026W25_2A', version: 'l2b-v27-2026-273', n: 1, parts: 1, partSize: 900, mjdMin: D1_ROW[0], mjdMax: D1_ROW[0], bad: 0, cells: btoa(b64), all: true, builtAt: '2026-11-15T00:00:00Z' };
  const enc = (v) => new TextEncoder().encode(JSON.stringify(v));
  return new Map([
    [expindex.MANIFEST_KEY, enc({ builtAt: meta.builtAt, dirs: [meta] })],
    [`${expindex.INDEX_ROOT}/qr3/2026W25_2A/${meta.version}/all.bin`, expindex.encodePart({ release: 'qr3', dir: '2026W25_2A', version: meta.version, start: 0, exposures: ['0279_1'], rows, dets: [63] })],
  ]);
}

test('direct mode: search reads the published index and answers like /search', { skip: skipS3 || (expindex ? false : 'proxy/src/expindex.js is not there yet') }, async () => {
  const files = tinyIndex();
  const asked = [];
  const api = createLocalApi({
    backend: 's3',
    cache: spyCache(),
    log: quiet,
    fetchImpl: () => Promise.reject(new Error('no network in tests')),
    indexSource: async (key) => {
      asked.push(key);
      return files.get(key) || null;
    },
  });
  const res = await api.search(TARGET.ra, TARGET.dec);
  assert.equal(res.simulated, undefined);
  assert.equal(res.source, 'index');
  assert.deepEqual(res.frames.map((f) => f.det).sort(), [2, 5]);
  const d2 = res.frames.find((f) => f.det === 2);
  assert.equal(d2.id, S3_ID);
  assert.equal(d2.obsid, '2026W25_2A_0279_1');
  assert.equal(d2.release, 'qr3');
  assert.ok(Number.isFinite(d2.mjd));
  assert.ok(res.counts, 'exposures per detector are passed on as the handler reports them');
  assert.ok(asked.includes(expindex.MANIFEST_KEY));
  // Somewhere the exposure does not cover: an empty, valid answer.
  const empty = await api.search(30, -40);
  assert.deepEqual(empty.frames, []);
  // The second search needs no further index downloads.
  const n = asked.length;
  await api.search(TARGET.ra, TARGET.dec);
  assert.equal(asked.filter((k) => k.endsWith('all.bin')).length, 1);
  assert.ok(asked.length <= n + 1);

  const health = await api.health();
  assert.equal(health.ok, true);
  assert.equal(health.backend, 's3');
});

test('direct mode without a published index says so instead of failing vaguely', { skip: skipS3 }, async () => {
  const api = createLocalApi({ backend: 's3', cache: spyCache(), log: quiet, fetchImpl: () => Promise.reject(new Error('no network in tests')) });
  await assert.rejects(api.search(TARGET.ra, TARGET.dec), (err) => err instanceof ApiError && err.status === 503 && err.retryable === false && /no exposure index/.test(err.message));
  await assert.rejects(api.cutout('nonsense', 1, 2, 0.1), (err) => err instanceof ApiError && err.status === 400);
  // Routes that need no archive still work: the built-in name table needs no network.
  const barnard = await api.resolve("Barnard's Star");
  assert.ok(Math.abs(barnard.ra - 269.452) < 0.01);
  const mark = await api.fogMark(10, 10);
  assert.equal(mark.count, 1);
});

test('direct mode: a cutout is read from the bucket with Range requests, decoded, then cached', { skip: skipS3 || (s3cutout && fakes3 ? false : 'proxy/src/s3cutout.js or proxy/fixtures/fakes3.js is not there yet') }, async () => {
  const bucket = fakes3.createFakeS3();
  bucket.put(S3_KEY, fakes3.makeFakeLevel2({ seed: 11 }));
  const cache = spyCache();
  const api = createLocalApi({ backend: 's3', cache, log: quiet, fetchImpl: bucket.fetchImpl });
  const frame = await api.cutout(S3_ID, TARGET.ra, TARGET.dec, 0.1);
  assert.equal(frame.id, S3_ID);
  assert.equal(frame.det, 2);
  assert.equal(frame.nx, 59);
  assert.equal(frame.ny, 59);
  assert.equal(frame.image.length, 59 * 59);
  assert.equal(frame.flags.length, 59 * 59);
  assert.equal(frame.wave.length, 59 * 59);
  assert.deepEqual(frame.detXY0, [1647, 510]);
  assert.ok(frame.waveCenter > 1.0 && frame.waveCenter < 1.7, `D2 wavelength ${frame.waveCenter}`);
  const requests = bucket.requests.length;
  assert.ok(requests > 0);
  const again = await api.cutout(S3_ID, TARGET.ra, TARGET.dec, 0.1);
  assert.equal(bucket.requests.length, requests, 'the second read does not touch the bucket');
  assert.deepEqual([...again.image.slice(0, 40)], [...frame.image.slice(0, 40)]);
  // A second exposure of the same detector re-uses the wavelength table.
  assert.ok(cache.calls.put.some((k) => /^wave\/.*d2.*\.json$/.test(k)), `wave table cached (${cache.calls.put.join(', ')})`);
  // A file that is not in the bucket is a 404, which the loader counts as "not in the archive".
  const missing = S3_ID.replace('0279_1', '0999_1');
  await assert.rejects(api.cutout(missing, TARGET.ra, TARGET.dec, 0.1), (err) => err instanceof ApiError && err.status === 404);
  // A position that is not on this detector is also a 404, and not retried.
  await assert.rejects(api.cutout(S3_ID, 30, -40, 0.1), (err) => err instanceof ApiError && err.status === 404 && err.retryable === false);
});
