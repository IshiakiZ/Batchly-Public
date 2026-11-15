// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, decodeFrame, resolveApiBase, ApiError, PRODUCTION_API, FOG_CELLS } from './api.js';

/** Build a TBF1 buffer by hand, exactly as the contract describes it. */
function makeTbf1({ nx = 3, ny = 2, extra = {}, omit = [] } = {}) {
  const count = nx * ny;
  const names = ['image', 'variance', 'zodi', 'flags', 'wave'].filter((n) => !omit.includes(n));
  const header = {
    v: 1,
    id: 'ibe/data/spherex/qr3/level2/x/2/level2_x_D2_spx.fits',
    release: 'qr3',
    obsid: '2026W25_2A_0279_1',
    version: '7.0.5',
    det: 2,
    nx,
    ny,
    mjd: 61210.79311303,
    exptime: 113.5826,
    dateObs: '2026-06-19T19:01:07.407',
    bunit: 'MJy / sr',
    psfFwhm: 7.46,
    wcs: { crpix: [-625.5, 511.5], crval: [208.4483499, 54.5491081503], pc: [[1, 0], [0, 1]], cdelt: [1, 1], sip: null },
    detXY0: [1647, 510],
    waveCenter: 1.2345,
    bwCenter: 0.031,
    arrays: [],
    ...extra,
  };
  // Two passes: the header length depends on the offsets, so pad generously first.
  let headerBytes;
  let headerLength = 0;
  for (let pass = 0; pass < 3; pass++) {
    let offset = 8 + headerLength;
    header.arrays = names.map((name) => {
      const spec = { name, dtype: name === 'flags' ? 'i4' : 'f4', offset, length: count };
      offset += count * 4;
      return spec;
    });
    let text = JSON.stringify(header);
    const raw = new TextEncoder().encode(text).length;
    const padded = Math.ceil((8 + raw + 16) / 8) * 8 - 8;
    text = text + ' '.repeat(padded - raw);
    headerBytes = new TextEncoder().encode(text);
    if (headerBytes.length === headerLength) break;
    headerLength = headerBytes.length;
  }
  const total = 8 + headerLength + names.length * count * 4;
  const u8 = new Uint8Array(total);
  u8.set([0x54, 0x42, 0x46, 0x31], 0);
  const view = new DataView(u8.buffer);
  view.setUint32(4, headerLength, true);
  u8.set(headerBytes, 8);
  for (const spec of header.arrays) {
    for (let i = 0; i < count; i++) {
      if (spec.name === 'flags') view.setInt32(spec.offset + i * 4, i === 1 ? 1 << 21 : 0, true);
      else {
        const base = { image: 10, variance: 0.001, zodi: 0.13, wave: 1.2 }[spec.name];
        view.setFloat32(spec.offset + i * 4, base + i, true);
      }
    }
  }
  return u8;
}

test('decodeFrame decodes a TBF1 frame', () => {
  const u8 = makeTbf1();
  const frame = decodeFrame(u8.buffer);
  assert.equal(frame.id, 'ibe/data/spherex/qr3/level2/x/2/level2_x_D2_spx.fits');
  assert.equal(frame.det, 2);
  assert.equal(frame.nx, 3);
  assert.equal(frame.ny, 2);
  assert.equal(frame.mjd, 61210.79311303);
  assert.equal(frame.release, 'qr3');
  assert.equal(frame.obsid, '2026W25_2A_0279_1');
  assert.equal(frame.exptime, 113.5826);
  assert.equal(frame.psfFwhm, 7.46);
  assert.equal(frame.waveCenter, 1.2345);
  assert.equal(frame.bwCenter, 0.031);
  assert.deepEqual(frame.wcs.crpix, [-625.5, 511.5]);
  assert.deepEqual(frame.detXY0, [1647, 510]);
  assert.ok(frame.image instanceof Float32Array);
  assert.ok(frame.flags instanceof Int32Array);
  assert.deepEqual(Array.from(frame.image), [10, 11, 12, 13, 14, 15]);
  assert.equal(frame.flags[1], 1 << 21);
  assert.equal(frame.flags[0], 0);
  assert.ok(Math.abs(frame.wave[5] - 6.2) < 1e-5);
  assert.ok(Math.abs(frame.zodi[0] - 0.13) < 1e-6);
});

test('decodeFrame accepts a view with a byte offset and returns independent copies', () => {
  const u8 = makeTbf1();
  const shifted = new Uint8Array(u8.length + 3);
  shifted.set(u8, 3);
  const frame = decodeFrame(shifted.subarray(3));
  assert.deepEqual(Array.from(frame.image), [10, 11, 12, 13, 14, 15]);
  shifted.fill(0);
  assert.equal(frame.image[0], 10);
});

test('decodeFrame fills in missing optional arrays', () => {
  const frame = decodeFrame(makeTbf1({ omit: ['variance', 'zodi', 'flags', 'wave'] }));
  assert.equal(frame.zodi.length, 6);
  assert.equal(frame.zodi[0], 0);
  assert.equal(frame.flags[3], 0);
  assert.ok(Number.isNaN(frame.variance[0]));
  assert.ok(Math.abs(frame.wave[0] - 1.2345) < 1e-6);
});

test('decodeFrame rejects garbage', () => {
  assert.throws(() => decodeFrame(new Uint8Array(4)), ApiError);
  assert.throws(() => decodeFrame(new TextEncoder().encode('NOPE0000{}')), /TBF1/);
  const truncated = makeTbf1().slice(0, 40);
  assert.throws(() => decodeFrame(truncated), ApiError);
  const short = makeTbf1();
  assert.throws(() => decodeFrame(short.slice(0, short.length - 8)), /past the end/);
  assert.throws(() => decodeFrame('text'), ApiError);
});

test('resolveApiBase follows the contract order', () => {
  assert.equal(resolveApiBase({ TOMBAUGH_API: 'https://x.test/api/', location: { search: '?api=/y', hostname: 'localhost' } }), 'https://x.test/api');
  assert.equal(resolveApiBase({ location: { search: '?api=http%3A%2F%2Fh%2Fz', hostname: 'localhost' } }), 'http://h/z');
  assert.equal(resolveApiBase({ location: { search: '', hostname: 'localhost' } }), '/api');
  assert.equal(resolveApiBase({ location: { search: '?ra=1', hostname: '127.0.0.1' } }), '/api');
  assert.equal(resolveApiBase({ location: { search: '', hostname: 'missingmass.example' } }), PRODUCTION_API);
  assert.equal(resolveApiBase({}), PRODUCTION_API);
  assert.equal(resolveApiBase(null), PRODUCTION_API);
});

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const path = new URL(url, 'http://local').pathname.split('/').pop();
    const route = routes[`${init.method || 'GET'} ${path}`];
    if (!route) return new Response(JSON.stringify({ error: 'no route', retryable: false }), { status: 404 });
    return route(new URL(url, 'http://local'), init);
  };
  impl.calls = calls;
  return impl;
}

test('createApi: search sorts frames and builds the query', async () => {
  const fetchImpl = fakeFetch({
    'GET search': () =>
      Response.json({ ra: 1, dec: 2, cached: true, frames: [{ id: 'b', det: 2, mjd: 5 }, { id: 'a', det: 2, mjd: 3 }] }),
  });
  const api = createApi('http://h/api/', { fetchImpl });
  const result = await api.search(269.45, 4.74);
  assert.equal(fetchImpl.calls[0].url, 'http://h/api/search?ra=269.45&dec=4.74');
  assert.deepEqual(result.frames.map((f) => f.id), ['a', 'b']);
  assert.equal(result.cached, true);
});

test('createApi: cutout decodes TBF1 and passes the abort signal', async () => {
  const fetchImpl = fakeFetch({
    'GET cutout': () => new Response(makeTbf1(), { headers: { 'content-type': 'application/octet-stream' } }),
  });
  const api = createApi('/api', { fetchImpl });
  const controller = new AbortController();
  const frame = await api.cutout('ibe/a b.fits', 10, -20, 0.1, { signal: controller.signal });
  assert.equal(frame.nx, 3);
  assert.equal(fetchImpl.calls[0].url, '/api/cutout?id=ibe%2Fa+b.fits&ra=10&dec=-20&size=0.1');
  assert.equal(fetchImpl.calls[0].init.signal, controller.signal);
});

test('createApi: gaia, resolve, health', async () => {
  const fetchImpl = fakeFetch({
    'GET gaia': () => Response.json({ epoch: 2016.0, stars: [{ id: '1', ra: 1, dec: 2, pmra: null, pmdec: null, parallax: null, gmag: 8 }] }),
    'GET resolve': (u) => Response.json({ name: u.searchParams.get('name'), ra: 269.4521, dec: 4.6934, epoch: 2000 }),
    'GET health': () => Response.json({ ok: true, version: '0.1.0', irsa: 'up' }),
  });
  const api = createApi('/api', { fetchImpl });
  const gaia = await api.gaia(1, 2, 0.05);
  assert.equal(gaia.epoch, 2016);
  assert.equal(gaia.stars.length, 1);
  const resolved = await api.resolve("Barnard's Star");
  assert.equal(resolved.name, "Barnard's Star");
  assert.equal((await api.health()).ok, true);
});

test('createApi: fog reads little-endian counts and fogMark posts', async () => {
  const fetchImpl = fakeFetch({
    'GET fog': () => {
      const u8 = new Uint8Array(FOG_CELLS * 2);
      u8[0] = 0x02;
      u8[1] = 0x01; // cell 0 = 258
      u8[2 * 12287] = 7;
      return new Response(u8);
    },
    'POST fog': (u) => Response.json({ cell: 42, count: 3, ra: u.searchParams.get('ra') }),
  });
  const api = createApi('/api', { fetchImpl });
  const counts = await api.fog();
  assert.ok(counts instanceof Uint16Array);
  assert.equal(counts.length, FOG_CELLS);
  assert.equal(counts[0], 258);
  assert.equal(counts[12287], 7);
  const mark = await api.fogMark(10.5, -3);
  assert.equal(mark.cell, 42);
  assert.equal(fetchImpl.calls[1].init.method, 'POST');
  assert.equal(fetchImpl.calls[1].url, '/api/fog?ra=10.5&dec=-3');
});

test('createApi: proxy errors surface message and retryable flag', async () => {
  const fetchImpl = fakeFetch({
    'GET search': () => new Response(JSON.stringify({ error: 'IRSA timed out', retryable: true }), { status: 504 }),
    'GET gaia': () => new Response('<html>bad gateway</html>', { status: 502 }),
  });
  const api = createApi('/api', { fetchImpl });
  await assert.rejects(api.search(1, 2), (err) => err instanceof ApiError && err.message === 'IRSA timed out' && err.retryable && err.status === 504);
  await assert.rejects(api.gaia(1, 2, 0.1), (err) => err.status === 502 && err.retryable === true);
  await assert.rejects(api.resolve('zzz'), (err) => err.status === 404 && err.retryable === false);
});

test('createApi: network failure and abort are distinguished', async () => {
  const api = createApi('/api', {
    fetchImpl: async (_url, init) => {
      if (init.signal && init.signal.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      throw new TypeError('Failed to fetch');
    },
  });
  await assert.rejects(api.health(), (err) => err instanceof ApiError && err.retryable && !err.aborted);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.health({ signal: controller.signal }), (err) => err.aborted === true && err.retryable === false);
});

test('createApi: search passes the optional extras through untouched', async () => {
  const fetchImpl = fakeFetch({
    'GET search': () =>
      Response.json({
        ra: 1,
        dec: 2,
        source: 'index',
        complete: false,
        simulated: true,
        counts: { 3: 900 },
        frames: [
          { id: 'b', det: 3, mjd: 2, x: 10.5, y: 20.5 },
          { id: 'a', det: 3, mjd: 1, x: 11.5, y: 21.5 },
        ],
      }),
  });
  const api = createApi('/api', { fetchImpl });
  const res = await api.search(1, 2);
  assert.equal(res.source, 'index');
  assert.equal(res.complete, false);
  assert.equal(res.simulated, true);
  assert.deepEqual(res.counts, { 3: 900 });
  assert.deepEqual(res.frames.map((f) => [f.id, f.x, f.y]), [['a', 11.5, 21.5], ['b', 10.5, 20.5]]);
});

test('createApi: identify, ephemeris, track, indexStatus', async () => {
  const fetchImpl = fakeFetch({
    'GET identify': (u) => Response.json({ objects: [], radius: u.searchParams.get('radius') }),
    'GET ephemeris': (u) => Response.json({ body: u.searchParams.get('body'), samples: [] }),
    'POST track': () => Response.json({ frames: [] }),
    'GET status': () => Response.json({ complete: false, dirs: 3 }),
  });
  const api = createApi('http://h/api', { fetchImpl });
  const controller = new AbortController();

  assert.equal((await api.identify(10, -20)).radius, '0.0033');
  assert.equal(fetchImpl.calls[0].url, 'http://h/api/identify?ra=10&dec=-20&radius=0.0033');
  await api.identify(10, -20, 0.01, { signal: controller.signal });
  assert.equal(fetchImpl.calls[1].url, 'http://h/api/identify?ra=10&dec=-20&radius=0.01');
  assert.equal(fetchImpl.calls[1].init.signal, controller.signal);

  const eph = await api.ephemeris('Pluto', { startMjd: 60800, endMjd: 61300, stepHours: 24 });
  assert.equal(eph.body, 'Pluto');
  assert.equal(fetchImpl.calls[2].url, 'http://h/api/ephemeris?body=Pluto&start=60800&end=61300&step=24');
  await api.ephemeris('Pluto');
  assert.equal(fetchImpl.calls[3].url, 'http://h/api/ephemeris?body=Pluto');

  const samples = [{ mjd: 60800, ra: 1, dec: 2 }];
  await api.track(samples, { dets: [3, 4], maxPerDet: 20, signal: controller.signal });
  const call = fetchImpl.calls[4];
  assert.equal(call.url, 'http://h/api/track');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(call.init.body), { samples, dets: [3, 4], maxPerDet: 20 });
  assert.equal(call.init.signal, controller.signal);

  assert.equal((await api.indexStatus()).dirs, 3);
  assert.equal(fetchImpl.calls[5].url, 'http://h/api/index/status');
});

test('createApi: the new methods reject with ApiError like the others', async () => {
  const fetchImpl = fakeFetch({
    'GET identify': () => new Response(JSON.stringify({ error: 'catalogue down', retryable: true }), { status: 503 }),
  });
  const api = createApi('/api', { fetchImpl });
  await assert.rejects(api.identify(1, 2), (err) => err instanceof ApiError && err.message === 'catalogue down' && err.status === 503);
  await assert.rejects(api.track([], {}), (err) => err instanceof ApiError && err.status === 404);
});
