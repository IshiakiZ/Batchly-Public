// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Handler tests. Nothing here reaches the network, and fits.js / encode.js / fog.js / synth.js
// are replaced by small fakes so that these tests stand on their own.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandler, decodeWaveTable, encodeWaveTable } from './handler.js';
import { createMemoryCache } from './cache.js';
import { UpstreamError, fetchCutoutHead, fetchWaveTable, searchFrames } from './irsa.js';

const URI_A = 'ibe/data/spherex/qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits';
const URI_B = 'ibe/data/spherex/qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0280_1D2_spx_l2b-v27-2026-273.fits';
const URI_D3 = 'ibe/data/spherex/qr3/level2/2026W25_2A/l2b-v27-2026-273/3/level2_2026W25_2A_0279_1D3_spx_l2b-v27-2026-273.fits';

const SEARCH_CSV = ['uri,energy_bandpassname,time_bounds_lower', `${URI_B},SPHEREx-D2,61210.9`, `${URI_A},SPHEREx-D2,61210.79244684`, `${URI_D3},SPHEREx-D3,61210.79244684`, ''].join('\n');

const quiet = () => {};
const enc = (text) => new TextEncoder().encode(text);
const noSleep = async () => {};

// The real IRSA client, minus the waiting between retries.
const fastIrsa = {
  searchFrames: (ra, dec, opts) => searchFrames(ra, dec, { ...opts, sleep: noSleep }),
  fetchCutoutHead: (id, ra, dec, size, opts) => fetchCutoutHead(id, ra, dec, size, { ...opts, sleep: noSleep }),
  fetchWaveTable: (det, sampleId, opts) => fetchWaveTable(det, sampleId, { ...opts, sleep: noSleep }),
};

// ---- fake FITS world: a "file" is 'SIMPLE', a detector digit, and a marker for the wave HDU.
function fakeFits(det, withWave) {
  const u8 = new Uint8Array(2880).fill(0x20);
  u8.set(enc(`SIMPLE D${det}${withWave ? ' WAVE' : ''}`), 0);
  return u8;
}

const fakeFitsModule = {
  readUntilPsf: async (stream) => new Uint8Array(await new Response(stream).arrayBuffer()),
  parseMef: (u8) => {
    const text = new TextDecoder().decode(u8.subarray(0, 16));
    if (!text.startsWith('SIMPLE')) throw new Error('not FITS');
    const det = Number(text[8]);
    const hdu = (name) => ({ name, header: new Map([['DETECTOR', det]]), dataOffset: 0, dataBytes: 0 });
    const hdus = [hdu('PRIMARY'), hdu('IMAGE'), hdu('FLAGS'), hdu('VARIANCE'), hdu('ZODI')];
    if (text.includes('WAVE')) hdus.push({ ...hdu('WCS-WAVE'), det });
    return hdus;
  },
  readWaveTable: (u8, hdu) => ({
    x: Int32Array.from({ length: 11 }, (_, i) => 1 + i * 204),
    y: Int32Array.from({ length: 11 }, (_, i) => 1 + i * 204),
    values: Float32Array.from({ length: 242 }, (_, i) => hdu.det + i / 1000),
    nx: 11,
    ny: 11,
  }),
};

const fakeEncodeModule = {
  buildFrame: ({ id, u8, waveTable }) => {
    const json = JSON.stringify({ id, bytes: u8.byteLength, wave0: waveTable.values[0] });
    return enc(`TBF1${json}`);
  },
};

function decodeFake(u8) {
  const text = new TextDecoder().decode(u8);
  assert.equal(text.slice(0, 4), 'TBF1');
  return JSON.parse(text.slice(4));
}

/** A fake of the upstream internet: IRSA TAP, IRSA cutouts, Gaia, Sesame. */
function fakeInternet(overrides = {}) {
  const calls = [];
  const state = { searchCsv: SEARCH_CSV, tap: null, cutout: null, ...overrides };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const call = { url: String(url), method: init.method || 'GET', host: u.hostname, path: u.pathname, params: u.searchParams };
    calls.push(call);
    if (u.hostname === 'irsa.ipac.caltech.edu' && u.pathname === '/TAP/sync') {
      if (state.tap) return state.tap(call, init);
      return new Response(state.searchCsv, { status: 200, headers: { 'content-type': 'text/csv' } });
    }
    if (u.hostname === 'irsa.ipac.caltech.edu' && u.pathname === '/TAP/availability') {
      return new Response('<availability/>', { status: state.availability || 200 });
    }
    if (u.hostname === 'irsa.ipac.caltech.edu' && u.pathname.startsWith('/ibe/data/spherex/')) {
      if (state.cutout) return state.cutout(call, init);
      const det = Number(/D([1-6])_spx/.exec(u.pathname)[1]);
      const full = u.searchParams.get('size') === '0.02';
      return new Response(fakeFits(det, full), { status: 200, headers: { 'content-type': 'application/fits' } });
    }
    if (u.hostname === 'gea.esac.esa.int') {
      if (state.gaia) return state.gaia(call, init);
      return new Response('source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag\n4472832130942575872,269.4485,4.7394,-801.551,10362.394,546.976,8.19\n', { status: 200 });
    }
    if (u.hostname === 'cds.unistra.fr') {
      if (state.sesame) return state.sesame(call, init);
      return new Response('<Sesame><Target><Resolver name="S=Simbad"><jradeg>279.2347</jradeg><jdedeg>38.7837</jdedeg><pm><pmRA>200.94</pmRA><pmDE>286.23</pmDE></pm><oname>* alf Lyr</oname></Resolver></Target></Sesame>', { status: 200 });
    }
    throw new TypeError(`fake internet has no route for ${url}`);
  };
  const count = (pred) => calls.filter(pred).length;
  return {
    fetchImpl,
    calls,
    state,
    tapCalls: () => count((c) => c.path === '/TAP/sync' && c.host === 'irsa.ipac.caltech.edu'),
    cutoutCalls: () => count((c) => c.path.startsWith('/ibe/') && c.params.get('size') !== '0.02'),
    waveCalls: () => count((c) => c.path.startsWith('/ibe/') && c.params.get('size') === '0.02'),
  };
}

function makeHandler(net, extra = {}) {
  const clock = { t: Date.parse('2026-11-15T07:00:00Z') };
  const cache = extra.cache || createMemoryCache({ now: () => clock.t });
  const handler = createHandler({
    fetchImpl: net ? net.fetchImpl : async () => {
      throw new Error('network is off limits');
    },
    cache,
    backend: 'irsa',
    version: '9.9.9',
    log: quiet,
    now: () => clock.t,
    searchBudgetMs: 20000,
    deps: { fits: fakeFitsModule, encode: fakeEncodeModule, irsa: fastIrsa, ...(extra.deps || {}) },
    ...(extra.options || {}),
  });
  const get = (path, init) => handler(new Request(`https://proxy.example${path}`, init));
  return { handler, get, cache, clock };
}

async function expectError(response, status, retryable, pattern) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('content-type'), /^application\/json/);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['error', 'retryable']);
  assert.equal(typeof body.error, 'string');
  assert.equal(body.retryable, retryable);
  if (pattern) assert.match(body.error, pattern);
  return body;
}

// ------------------------------------------------------------------ routing, CORS, errors

test('routes on the last path segment at any mount path', async () => {
  const { get } = makeHandler(fakeInternet());
  for (const path of ['/health', '/api/health', '/functions/v1/spherex/health', '/a/b/c/health/', '/API/Health?x=1']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.deepEqual(await res.json(), { ok: true, version: '9.9.9', irsa: 'unknown', backend: 'irsa' });
  }
  await expectError(await get('/functions/v1/spherex'), 404, false, /Unknown endpoint/);
  await expectError(await get('/'), 404, false);
  await expectError(await get('/api/nothing'), 404, false);
});

test('every response carries CORS headers and OPTIONS preflight is answered', async () => {
  const { get } = makeHandler(fakeInternet());
  const pre = await get('/api/cutout', { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'GET' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-methods'), /GET/);
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  assert.match(pre.headers.get('access-control-allow-methods'), /OPTIONS/);
  assert.match(pre.headers.get('access-control-allow-headers'), /content-type/i);
  assert.equal(await pre.text(), '');
  for (const path of ['/api/health', '/api/search?ra=1&dec=2', '/api/search', '/api/nope', `/api/cutout?id=${URI_A}&ra=1&dec=2`]) {
    const res = await get(path);
    assert.equal(res.headers.get('access-control-allow-origin'), '*', path);
  }
  // OPTIONS on an unknown path is still a valid preflight answer.
  assert.equal((await get('/whatever', { method: 'OPTIONS' })).status, 204);
});

test('wrong methods get 405 and unexpected failures a 500, both in the error shape', async () => {
  const net = fakeInternet();
  const { get } = makeHandler(net, {
    deps: {
      gaiaCone: async () => {
        throw new TypeError('boom');
      },
    },
  });
  await expectError(await get('/api/search?ra=1&dec=2', { method: 'POST' }), 405, false, /not allowed/);
  await expectError(await get('/api/health', { method: 'DELETE' }), 405, false);
  await expectError(await get('/api/gaia?ra=1&dec=2'), 500, false, /boom/);
  assert.equal(net.calls.length, 0);
});

test('HEAD answers like GET without a body', async () => {
  const { get } = makeHandler(fakeInternet());
  const res = await get('/api/health', { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
});

// ------------------------------------------------------------------ validation

test('search validates ra and dec', async () => {
  const net = fakeInternet();
  const { get } = makeHandler(net);
  await expectError(await get('/api/search'), 400, false, /Missing parameter "ra"/);
  await expectError(await get('/api/search?ra=10'), 400, false, /Missing parameter "dec"/);
  await expectError(await get('/api/search?ra=abc&dec=2'), 400, false, /must be a number/);
  await expectError(await get('/api/search?ra=&dec=2'), 400, false);
  await expectError(await get('/api/search?ra=Infinity&dec=2'), 400, false);
  await expectError(await get('/api/search?ra=361&dec=2'), 400, false, /between 0 and 360/);
  await expectError(await get('/api/search?ra=-1&dec=2'), 400, false);
  await expectError(await get('/api/search?ra=10&dec=90.5'), 400, false, /between -90 and 90/);
  await expectError(await get('/api/search?ra=10&dec=-91'), 400, false);
  assert.equal(net.calls.length, 0);
  // The edges are fine; 360 is the same meridian as 0.
  assert.equal((await get('/api/search?ra=360&dec=-90')).status, 200);
  assert.equal(net.tapCalls(), 1);
});

test('cutout refuses anything that is not a Level-2 uri and never fetches it', async () => {
  const net = fakeInternet();
  const { get } = makeHandler(net);
  const bad = [
    'https://example.com/secret.fits',
    '//example.com/x.fits',
    'ibe/data/spherex/qr3/level2/../../../../etc/passwd.fits',
    'ibe/data/spherex/qr3/level2/x.fits?center=1,2',
    'ibe/data/spherex/qr3/level2/x.fits#frag',
    'ibe/data/wise/qr3/level2/x.fits',
    'ibe/data/spherex/qr3/level2/x.txt',
    'ibe/data/spherex/qr3/level2/%2e%2e/x.fits',
  ];
  for (const id of bad) {
    await expectError(await get(`/api/cutout?id=${encodeURIComponent(id)}&ra=1&dec=2&size=0.1`), 400, false, /Level-2 file path/);
  }
  await expectError(await get('/api/cutout?ra=1&dec=2'), 400, false, /Missing parameter "id"/);
  await expectError(await get(`/api/cutout?id=${URI_A}&ra=1`), 400, false);
  await expectError(await get(`/api/cutout?id=${URI_A}&ra=1&dec=2&size=big`), 400, false);
  assert.equal(net.calls.length, 0);
});

test('cutout clamps size to 0.02..0.2 and defaults to 0.1', async () => {
  const net = fakeInternet();
  const { get } = makeHandler(net);
  const sizeOf = (i) => net.calls.filter((c) => c.path.startsWith('/ibe/') && c.path.includes('0279_1D2'))[i].params.get('size');
  assert.equal((await get(`/api/cutout?id=${URI_A}&ra=10&dec=20&size=5`)).status, 200);
  assert.equal(sizeOf(0), '0.2');
  assert.equal((await get(`/api/cutout?id=${URI_A}&ra=10&dec=20&size=0.0001`)).status, 200);
  // 0.02 is also the size of the wave-table download, so look at the request count instead.
  assert.equal(net.calls.filter((c) => c.params.get('size') === '0.02').length, 2);
  assert.equal((await get(`/api/cutout?id=${URI_A}&ra=10&dec=20`)).status, 200);
  assert.equal(net.calls.at(-1).params.get('size'), '0.1');
  assert.equal(net.calls.at(-1).params.get('center'), '10,20d');
});

// ------------------------------------------------------------------ search

test('search returns the contract shape, sorted, and caches for 12 hours', async () => {
  const net = fakeInternet();
  const { get, clock } = makeHandler(net);
  const res = await get('/api/search?ra=269.45207&dec=4.69339');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['cached', 'dec', 'fetchedAt', 'frames', 'ra']);
  assert.equal(body.ra, 269.45207);
  assert.equal(body.dec, 4.69339);
  assert.equal(body.cached, false);
  assert.equal(body.fetchedAt, '2026-11-15T07:00:00.000Z');
  assert.deepEqual(body.frames.map((f) => f.mjd), [61210.79244684, 61210.79244684, 61210.9]);
  assert.deepEqual(body.frames[0], { id: URI_A, det: 2, mjd: 61210.79244684, release: 'qr3', obsid: '2026W25_2A_0279_1' });
  assert.equal(net.tapCalls(), 1);

  // Same position to 1e-4 deg: served from the cache.
  clock.t += 11 * 3600 * 1000;
  const again = await (await get('/api/search?ra=269.45209&dec=4.69341')).json();
  assert.equal(again.cached, true);
  assert.equal(again.stale, undefined);
  assert.equal(again.fetchedAt, '2026-11-15T07:00:00.000Z');
  assert.equal(again.frames.length, 3);
  assert.equal(net.tapCalls(), 1);

  // A different position is a different key.
  assert.equal((await (await get('/api/search?ra=269.4525&dec=4.69339')).json()).cached, false);
  assert.equal(net.tapCalls(), 2);

  // After 12 hours the archive is asked again.
  clock.t += 2 * 3600 * 1000;
  const fresh = await (await get('/api/search?ra=269.45207&dec=4.69339')).json();
  assert.equal(fresh.cached, false);
  assert.equal(net.tapCalls(), 3);
});

test('search serves a stale cache entry when the archive fails, flagged cached + stale', async () => {
  const net = fakeInternet();
  const { get, clock } = makeHandler(net, { options: { searchTimeoutMs: 50 } });
  assert.equal((await get('/api/search?ra=10&dec=20')).status, 200);
  clock.t += 13 * 3600 * 1000;
  net.state.tap = () => new Response('<html><title>502 Bad Gateway</title></html>', { status: 502, headers: { 'content-type': 'text/html' } });
  const res = await get('/api/search?ra=10&dec=20');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.cached, true);
  assert.equal(body.stale, true);
  assert.equal(body.fetchedAt, '2026-11-15T07:00:00.000Z');
  assert.equal(body.frames.length, 3);
  // When the archive is back (and the two-minute pause after a failure is over) the entry is refreshed.
  net.state.tap = null;
  clock.t += 3 * 60 * 1000;
  const back = await (await get('/api/search?ra=10&dec=20')).json();
  assert.equal(back.cached, false);
  assert.equal(back.stale, undefined);
});

test('with an expired answer at hand IRSA gets a short budget; an expired empty answer is not served', async () => {
  const seen = [];
  let mode = 'ok';
  const fake = async (ra, dec, opts) => {
    seen.push({ totalTimeoutMs: opts.totalTimeoutMs, asyncFallback: opts.asyncFallback });
    if (mode === 'fail') throw new UpstreamError('IRSA TAP answered HTTP 502', { kind: 'http', upstreamStatus: 502 });
    return mode === 'empty' ? [] : [{ id: URI_A, det: 2, mjd: 61210.79, release: 'qr3', obsid: '2026W25_2A_0279_1' }];
  };
  const { get, clock } = makeHandler(fakeInternet(), { deps: { irsa: { searchFrames: fake } }, options: { searchBudgetMs: 130000 } });
  await get('/api/search?ra=10&dec=20');
  clock.t += 13 * 3600 * 1000;
  mode = 'fail';
  const stale = await (await get('/api/search?ra=10&dec=20')).json();
  assert.equal(stale.stale, true);
  assert.deepEqual(seen, [
    { totalTimeoutMs: 130000, asyncFallback: true },
    { totalTimeoutMs: 30000, asyncFallback: false },
  ]);
  // Right after a failure the stale answer comes at once, without asking IRSA again...
  clock.t += 60 * 1000;
  assert.equal((await (await get('/api/search?ra=10&dec=20')).json()).stale, true);
  assert.equal(seen.length, 2);
  // ...and two minutes later IRSA is tried again.
  clock.t += 3 * 60 * 1000;
  assert.equal((await (await get('/api/search?ra=10&dec=20')).json()).stale, true);
  assert.equal(seen.length, 3);

  mode = 'empty';
  await get('/api/search?ra=30&dec=40');
  clock.t += 11 * 60 * 1000;
  mode = 'fail';
  await expectError(await get('/api/search?ra=30&dec=40'), 502, true);
  assert.deepEqual(seen.at(-1), { totalTimeoutMs: 130000, asyncFallback: true });
});

test('search without a cache entry reports upstream failures as 502 / 504, retryable', async () => {
  const failing = fakeInternet({ tap: () => new Response('nope', { status: 503 }) });
  const a = makeHandler(failing, {
    deps: { irsa: { searchFrames: (ra, dec, opts) => searchFrames(ra, dec, { ...opts, sleep: noSleep, asyncFallback: false }) } },
  });
  await expectError(await a.get('/api/search?ra=10&dec=20'), 502, true, /HTTP 503/);
  assert.equal(failing.tapCalls(), 3);

  const b = makeHandler(fakeInternet(), {
    deps: {
      irsa: {
        searchFrames: async () => {
          throw new UpstreamError('IRSA TAP did not answer within 75 s', { kind: 'timeout', status: 504 });
        },
      },
    },
  });
  await expectError(await b.get('/api/search?ra=10&dec=20'), 504, true, /did not answer/);
  const health = await (await b.get('/api/health')).json();
  assert.equal(health.irsa, 'down');

  const c = makeHandler(fakeInternet(), {
    deps: {
      irsa: {
        searchFrames: async () => {
          throw new UpstreamError('IRSA TAP answered HTTP 400: bad query', { kind: 'http', retryable: false, upstreamStatus: 400 });
        },
      },
    },
  });
  await expectError(await c.get('/api/search?ra=10&dec=20'), 502, false);
});

test('concurrent identical searches share one upstream request', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const net = fakeInternet({
    tap: async () => {
      await gate;
      return new Response(SEARCH_CSV, { status: 200 });
    },
  });
  const { get } = makeHandler(net);
  const pending = [get('/api/search?ra=10&dec=20'), get('/api/search?ra=10&dec=20'), get('/api/search?ra=10.00001&dec=20')];
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const bodies = await Promise.all(pending.map(async (p) => (await p).json()));
  assert.equal(net.tapCalls(), 1);
  assert.deepEqual(bodies.map((b) => b.frames.length), [3, 3, 3]);
  assert.equal(bodies[2].ra, 10.00001);
});

test('an empty search result is only trusted for ten minutes', async () => {
  const net = fakeInternet({ searchCsv: 'uri,energy_bandpassname,time_bounds_lower\n' });
  const { get, clock } = makeHandler(net);
  assert.deepEqual((await (await get('/api/search?ra=10&dec=20')).json()).frames, []);
  clock.t += 9 * 60 * 1000;
  assert.equal((await (await get('/api/search?ra=10&dec=20')).json()).cached, true);
  clock.t += 2 * 60 * 1000;
  assert.equal((await (await get('/api/search?ra=10&dec=20')).json()).cached, false);
  assert.equal(net.tapCalls(), 2);
});

test('a search cut short hands its async job to the next request, also across handlers', async () => {
  const seen = [];
  const job = 'https://irsa.ipac.caltech.edu/TAP/async/job-77';
  let attempt = 0;
  const searchFramesFake = async (ra, dec, opts) => {
    attempt++;
    seen.push(opts.resumeJobUrl);
    if (attempt === 1) {
      opts.onJob(job);
      throw new UpstreamError('IRSA search job is still executing after 130 s', { kind: 'timeout', status: 504 });
    }
    if (attempt === 2) throw new UpstreamError('still executing', { kind: 'timeout', status: 504 });
    opts.onJob(null);
    return [{ id: URI_A, det: 2, mjd: 61210.79, release: 'qr3', obsid: '2026W25_2A_0279_1' }];
  };
  const cache = createMemoryCache();
  const first = makeHandler(fakeInternet(), { cache, deps: { irsa: { searchFrames: searchFramesFake } } });
  await expectError(await first.get('/api/search?ra=10&dec=20'), 504, true);
  await expectError(await first.get('/api/search?ra=10&dec=20'), 504, true);
  // A different isolate with the same cache picks the job up too.
  const second = makeHandler(fakeInternet(), { cache, deps: { irsa: { searchFrames: searchFramesFake } } });
  const ok = await second.get('/api/search?ra=10&dec=20');
  assert.equal(ok.status, 200);
  assert.deepEqual(seen, [undefined, job, job]);
  // Finished: the job is forgotten.
  attempt = 0;
  second.clock.t += 13 * 3600 * 1000;
  seen.length = 0;
  await second.get('/api/search?ra=10&dec=20');
  assert.deepEqual(seen, [undefined]);
});

// ------------------------------------------------------------------ cutout

test('cutout: head -> wave table -> TBF1, with the contract headers, then served from the cache', async () => {
  const net = fakeInternet();
  const { get } = makeHandler(net);
  const url = `/api/cutout?id=${encodeURIComponent(URI_A)}&ra=210.802274&dec=54.348951&size=0.1`;
  const res = await get(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('x-tombaugh-cache'), 'miss');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(res.headers.get('content-length'), String(bytes.byteLength));
  const frame = decodeFake(bytes);
  assert.equal(frame.id, URI_A);
  assert.equal(frame.bytes, 2880);
  assert.ok(Math.abs(frame.wave0 - 2) < 1e-6); // the detector 2 table
  assert.equal(net.cutoutCalls(), 1);
  assert.equal(net.waveCalls(), 1);
  // Upstream was asked for the rounded position.
  const upstream = net.calls.find((c) => c.params.get('size') === '0.1');
  assert.equal(upstream.url, `https://irsa.ipac.caltech.edu/${URI_A}?center=210.80227,54.34895d&size=0.1`);

  // Same frame, same position to 1e-5 deg, same size to 1e-3: cache hit, nothing fetched.
  const again = await get(`/api/cutout?id=${encodeURIComponent(URI_A)}&ra=210.802271&dec=54.348953&size=0.1004`);
  assert.equal(again.headers.get('x-tombaugh-cache'), 'hit');
  assert.deepEqual(new Uint8Array(await again.arrayBuffer()), bytes);
  assert.equal(net.cutoutCalls(), 1);
  assert.equal(net.waveCalls(), 1);

  // A different size or position is a different object.
  assert.equal((await get(`/api/cutout?id=${encodeURIComponent(URI_A)}&ra=210.802274&dec=54.348951&size=0.12`)).headers.get('x-tombaugh-cache'), 'miss');
  assert.equal((await get(`/api/cutout?id=${encodeURIComponent(URI_A)}&ra=210.8024&dec=54.348951&size=0.1`)).headers.get('x-tombaugh-cache'), 'miss');
  assert.equal(net.cutoutCalls(), 3);
});

test('the wave table is fetched once per detector, kept in memory and in the cache', async () => {
  const net = fakeInternet();
  const cache = createMemoryCache();
  const first = makeHandler(net, { cache });
  const results = await Promise.all([
    first.get(`/api/cutout?id=${URI_A}&ra=10&dec=20`),
    first.get(`/api/cutout?id=${URI_B}&ra=10&dec=20`),
    first.get(`/api/cutout?id=${URI_D3}&ra=10&dec=20`),
  ]);
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
  assert.equal(net.cutoutCalls(), 3);
  assert.equal(net.waveCalls(), 2); // one for detector 2 (shared by two frames), one for detector 3
  const d3 = decodeFake(new Uint8Array(await results[2].arrayBuffer()));
  assert.ok(Math.abs(d3.wave0 - 3) < 1e-6);

  // A new handler (a cold edge function) with the same cache does not download it again.
  const second = makeHandler(net, { cache });
  assert.equal((await second.get(`/api/cutout?id=${URI_B}&ra=11&dec=21`)).status, 200);
  assert.equal(net.waveCalls(), 2);
  const stored = decodeWaveTable(await cache.get('wave/irsa-d2-v1.json'));
  assert.equal(stored.nx, 11);
  assert.equal(stored.values.length, 242);
});

test('wave tables survive the JSON round trip exactly', () => {
  const table = fakeFitsModule.readWaveTable(null, { det: 4 });
  table.values[5] = NaN;
  const back = decodeWaveTable(encodeWaveTable(table));
  assert.deepEqual(back.x, table.x);
  assert.deepEqual(back.y, table.y);
  assert.deepEqual(back.values, table.values);
  assert.equal(decodeWaveTable(enc('{"nx":11}')), null);
  assert.equal(decodeWaveTable(enc('not json')), null);
  assert.equal(decodeWaveTable(null), null);
});

test('concurrent identical cutouts share one download', async () => {
  const net = fakeInternet();
  const { get } = makeHandler(net);
  const url = `/api/cutout?id=${URI_A}&ra=10&dec=20&size=0.1`;
  const responses = await Promise.all([get(url), get(url), get(url)]);
  assert.deepEqual(responses.map((r) => r.status), [200, 200, 200]);
  assert.equal(net.cutoutCalls(), 1);
});

test('cutout maps upstream failures: 404 stays 404, 5xx becomes a retryable 502, nothing bad is cached', async () => {
  const net = fakeInternet({ cutout: () => new Response('no such file', { status: 404 }) });
  const { get } = makeHandler(net);
  await expectError(await get(`/api/cutout?id=${URI_A}&ra=10&dec=20`), 404, false, /no such file/);
  assert.equal(net.cutoutCalls(), 1); // a 404 is not retried

  net.state.cutout = () => new Response('<html><title>500 Internal Server Error</title></html>', { status: 500, headers: { 'content-type': 'text/html' } });
  const slowless = makeHandler(net);
  await expectError(await slowless.get(`/api/cutout?id=${URI_B}&ra=10&dec=20`), 502, true, /HTTP 500/);
  assert.equal((await (await slowless.get('/api/health')).json()).irsa, 'down');

  // Recovery: the same request works once upstream does, and reports a miss (no poisoned cache).
  net.state.cutout = null;
  const ok = await slowless.get(`/api/cutout?id=${URI_B}&ra=10&dec=20`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('x-tombaugh-cache'), 'miss');
  assert.equal((await (await slowless.get('/api/health')).json()).irsa, 'up');
});

test('cutout reports an unreadable or unencodable file as a retryable 502', async () => {
  const net = fakeInternet();
  const badEncode = makeHandler(net, {
    deps: {
      encode: {
        buildFrame: () => {
          throw new Error('IMAGE data truncated');
        },
      },
    },
  });
  await expectError(await badEncode.get(`/api/cutout?id=${URI_A}&ra=10&dec=20`), 502, true, /could not be encoded: IMAGE data truncated/);
  const missing = makeHandler(net, { deps: { encode: undefined, fits: undefined, irsa: { fetchCutoutHead: async () => fakeFits(2, false) } } });
  // With no injected modules the real ones are loaded if present; either way the answer is a
  // well-formed response, never an exception.
  const res = await missing.get(`/api/cutout?id=${URI_A}&ra=10&dec=20`);
  assert.ok([200, 500, 502].includes(res.status));
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

// ------------------------------------------------------------------ gaia, resolve, health

test('gaia clamps the radius, returns the contract shape and caches', async () => {
  const net = fakeInternet();
  const { get } = makeHandler(net);
  const res = await get('/api/gaia?ra=269.45&dec=4.69&radius=3');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.epoch, 2016.0);
  assert.deepEqual(body.stars, [{ id: '4472832130942575872', ra: 269.4485, dec: 4.7394, pmra: -801.551, pmdec: 10362.394, parallax: 546.976, gmag: 8.19 }]);
  assert.equal(body.cached, false);
  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].host, 'gea.esac.esa.int');
  const again = await (await get('/api/gaia?ra=269.45&dec=4.69&radius=0.25')).json();
  assert.equal(again.cached, true);
  assert.equal(net.calls.length, 1);
  await expectError(await get('/api/gaia?ra=269.45'), 400, false);
  await expectError(await get('/api/gaia?ra=269.45&dec=4.69&radius=wide'), 400, false);
});

test('gaia passes the clamped radius on and reports total failure as 502', async () => {
  const seen = [];
  const { get } = makeHandler(fakeInternet(), {
    deps: {
      gaiaCone: async (ra, dec, radius) => {
        seen.push(radius);
        if (seen.length === 3) throw new UpstreamError('No Gaia service answered', { kind: 'http' });
        return { epoch: 2016.0, stars: [], source: 'esa' };
      },
    },
  });
  await get('/api/gaia?ra=1&dec=2&radius=9');
  await get('/api/gaia?ra=3&dec=2');
  assert.deepEqual(seen, [0.25, 0.1]);
  await expectError(await get('/api/gaia?ra=5&dec=2&radius=0.0000001'), 502, true, /No Gaia service/);
  assert.equal(seen[2], 0.001);
});

test('resolve: 400 without a name, 404 for unknown names, caches service answers only', async () => {
  const net = fakeInternet();
  const { get } = makeHandler(net);
  await expectError(await get('/api/resolve'), 400, false, /Missing parameter "name"/);
  await expectError(await get('/api/resolve?name=%20%20'), 400, false);

  const vega = await get('/api/resolve?name=Vega');
  assert.equal(vega.status, 200);
  assert.deepEqual(await vega.json(), { name: '* alf Lyr', ra: 279.2347, dec: 38.7837, epoch: 2000.0, pmra: 200.94, pmdec: 286.23, parallax: null, source: 'sesame' });
  await get('/api/resolve?name=vega');
  assert.equal(net.calls.length, 1); // second answer came from the cache (case-insensitive key)

  net.state.sesame = () => new Response('<Sesame><Target><Resolver name="S"><INFO>*** Nothing found ***</INFO></Resolver></Target></Sesame>', { status: 200 });
  await expectError(await get('/api/resolve?name=zzzz'), 404, false, /No object named "zzzz"/);

  // Built-in fallback while Sesame is down: answered, but not cached.
  net.state.sesame = () => new Response('down', { status: 503 });
  const builtin = await (await get('/api/resolve?name=Barnard%27s%20Star')).json();
  assert.equal(builtin.source, 'builtin (approximate)');
  net.state.sesame = null;
  const before = net.calls.length;
  await get('/api/resolve?name=Barnard%27s%20Star');
  assert.equal(net.calls.length, before + 1);
});

test('health reports the last known IRSA state and can probe on request', async () => {
  const net = fakeInternet();
  const { get, clock } = makeHandler(net);
  assert.equal((await (await get('/api/health')).json()).irsa, 'unknown');
  await get('/api/search?ra=10&dec=20');
  assert.equal((await (await get('/api/health')).json()).irsa, 'up');
  clock.t += 11 * 60 * 1000; // old news
  assert.equal((await (await get('/api/health')).json()).irsa, 'unknown');
  net.state.availability = 503;
  assert.equal((await (await get('/api/health?probe=1')).json()).irsa, 'down');
  net.state.availability = 200;
  const probed = await get('/api/health?probe=1');
  assert.deepEqual(await probed.json(), { ok: true, version: '9.9.9', irsa: 'up', backend: 'irsa' });
  assert.equal(probed.headers.get('cache-control'), 'no-store');
});

// ------------------------------------------------------------------ fog

function fakeFog() {
  const KEY = 'fog/nside32.bin';
  const read = async (cache) => {
    const u8 = await cache.get(KEY);
    const counts = new Uint16Array(12288);
    if (u8 && u8.byteLength === 24576) {
      const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      for (let i = 0; i < 12288; i++) counts[i] = view.getUint16(i * 2, true);
    }
    return counts;
  };
  return {
    fogRead: read,
    fogMark: async (cache, ra, dec) => {
      const counts = await read(cache);
      const cell = Math.floor(ra) % 12288;
      counts[cell] += 1;
      const out = new Uint8Array(24576);
      const view = new DataView(out.buffer);
      for (let i = 0; i < 12288; i++) view.setUint16(i * 2, counts[i], true);
      await cache.put(KEY, out, 'application/octet-stream');
      return { cell, count: counts[cell], dec };
    },
  };
}

test('fog: GET returns 24,576 raw little-endian bytes, POST marks a cell', async () => {
  const { get } = makeHandler(fakeInternet(), { deps: { fog: fakeFog() } });
  const empty = await get('/api/fog');
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('content-type'), 'application/octet-stream');
  assert.equal(empty.headers.get('cache-control'), 'no-store');
  assert.equal((await empty.arrayBuffer()).byteLength, 24576);

  const mark = await get('/api/fog?ra=300.5&dec=-10', { method: 'POST' });
  assert.equal(mark.status, 200);
  assert.deepEqual(await mark.json(), { cell: 300, count: 1 });
  assert.deepEqual(await (await get('/functions/v1/spherex/fog?ra=300.2&dec=5', { method: 'POST' })).json(), { cell: 300, count: 2 });
  // A JSON body works too.
  const viaBody = await get('/api/fog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ra: 7, dec: 1 }) });
  assert.deepEqual(await viaBody.json(), { cell: 7, count: 1 });

  const view = new DataView(await (await get('/api/fog')).arrayBuffer());
  assert.equal(view.getUint16(300 * 2, true), 2);
  assert.equal(view.getUint16(7 * 2, true), 1);
  assert.equal(view.getUint16(0, true), 0);

  await expectError(await get('/api/fog?ra=300&dec=95', { method: 'POST' }), 400, false);
  await expectError(await get('/api/fog', { method: 'POST' }), 400, false);
  await expectError(await get('/api/fog', { method: 'PUT' }), 405, false);
});

test('fog: a store that cannot be read or written gives 503 instead of wiping the map', async () => {
  const puts = [];
  const flaky = {
    get: async (key, opts = {}) => {
      if (opts.strict) throw new Error('storage answered HTTP 500');
      return null;
    },
    put: async (key, bytes) => {
      puts.push(key);
      return true;
    },
  };
  const a = makeHandler(fakeInternet(), { cache: flaky, deps: { fog: fakeFog() } });
  await expectError(await a.get('/api/fog?ra=10&dec=10', { method: 'POST' }), 503, true, /shared sky map/);
  await expectError(await a.get('/api/fog'), 503, true);
  assert.deepEqual(puts, []);

  const readOnly = { get: async () => null, put: async () => false };
  const b = makeHandler(fakeInternet(), { cache: readOnly, deps: { fog: fakeFog() } });
  await expectError(await b.get('/api/fog?ra=10&dec=10', { method: 'POST' }), 503, true);
  assert.equal((await b.get('/api/fog')).status, 200);
});

// ------------------------------------------------------------------ synthetic backend

function fakeSynth() {
  const made = [];
  const refs = [
    { id: 'ibe/data/spherex/qr3/level2/syn/l2b-syn/2/level2_SYN_0001_1D2_spx_l2b-syn.fits', det: 2, mjd: 60836.5, release: 'qr3', obsid: 'SYN_0001_1', rollDeg: 12, secret: 'x' },
    { id: 'ibe/data/spherex/qr3/level2/syn/l2b-syn/2/level2_SYN_0000_1D2_spx_l2b-syn.fits', det: 2, mjd: 60830.5, release: 'qr3', obsid: 'SYN_0000_1', rollDeg: 40 },
  ];
  return {
    made,
    refs,
    module: {
      syntheticSky: (ra, dec) => ({
        frameRefs: refs,
        sourcesAt: (mjd) => [
          { id: 'star01', ra, dec, gmag: 11 },
          { id: 'star02', ra: ra + 0.01, dec, gmag: 9 },
          { id: 'far', ra: ra + 1, dec, gmag: 3 },
        ].map((s) => ({ ...s, mjd })),
      }),
      makeSyntheticMef: (o) => {
        made.push(o);
        return fakeFits(o.det, true);
      },
    },
  };
}

test('synthetic backend serves search, cutout, gaia and resolve without touching the network', async () => {
  const synth = fakeSynth();
  let fetched = 0;
  const handler = createHandler({
    fetchImpl: async () => {
      fetched++;
      throw new Error('the synthetic backend must not fetch');
    },
    cache: createMemoryCache(),
    backend: 'synthetic',
    log: quiet,
    syntheticLatencyMs: 0,
    deps: { fits: fakeFitsModule, encode: fakeEncodeModule, synth: synth.module, fog: fakeFog() },
  });
  const get = (path, init) => handler(new Request(`http://localhost:8787${path}`, init));

  const search = await (await get('/api/search?ra=150&dec=2')).json();
  assert.equal(search.cached, false);
  assert.deepEqual(search.frames.map((f) => f.mjd), [60830.5, 60836.5]);
  assert.deepEqual(Object.keys(search.frames[0]).sort(), ['det', 'id', 'mjd', 'obsid', 'release']);

  const id = search.frames[1].id;
  const res = await get(`/api/cutout?id=${encodeURIComponent(id)}&ra=150.001&dec=2.001&size=0.08`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const frame = decodeFake(new Uint8Array(await res.arrayBuffer()));
  assert.equal(frame.id, id);
  assert.equal(synth.made.length, 1);
  const o = synth.made[0];
  assert.deepEqual([o.ra, o.dec, o.size, o.det, o.mjd, o.rollDeg], [150.001, 2.001, 0.08, 2, 60836.5, 12]);
  assert.equal(o.sources.length, 3);
  assert.equal(o.sources[0].mjd, 60836.5);
  assert.equal(typeof o.seed, 'number');
  assert.equal((await get(`/api/cutout?id=${encodeURIComponent(id)}&ra=150.001&dec=2.001&size=0.08`)).headers.get('x-tombaugh-cache'), 'hit');

  await expectError(await get('/api/cutout?id=unknown-frame&ra=150&dec=2'), 404, false, /Unknown synthetic frame/);

  const gaia = await (await get('/api/gaia?ra=150&dec=2&radius=0.05')).json();
  assert.equal(gaia.epoch, 2016.0);
  assert.deepEqual(gaia.stars.map((s) => s.gmag), [9, 11]);

  assert.equal((await (await get('/api/resolve?name=R%20Dra')).json()).name, 'R Draconis');
  await expectError(await get('/api/resolve?name=Vega'), 404, false);
  assert.deepEqual(await (await get('/api/health')).json(), { ok: true, version: '0.1.0', irsa: 'unknown', backend: 'synthetic' });
  assert.deepEqual(await (await get('/api/fog?ra=5&dec=5', { method: 'POST' })).json(), { cell: 5, count: 1 });
  assert.equal(fetched, 0);
});

test('synthetic backend uses the id-based generator when the fixture has one', async () => {
  const asked = [];
  const module = {
    syntheticSky: () => ({ frameRefs: [], sourcesAt: () => [], gaia: () => ({ epoch: 2016.0, stars: [{ id: '991', ra: 150, dec: 2, pmra: 1, pmdec: 2, parallax: null, gmag: 10 }] }) }),
    makeSyntheticMef: () => {
      throw new Error('not used');
    },
    parseSyntheticId: (id) => (id.includes('l2b-syn') ? { det: 4 } : null),
    syntheticMef: (id, cutout) => {
      asked.push({ id, ...cutout });
      if (cutout.dec > 80) throw new Error('position is not on the detector');
      return fakeFits(4, true);
    },
  };
  const handler = createHandler({ backend: 'synthetic', cache: createMemoryCache(), log: quiet, syntheticLatencyMs: 0, deps: { fits: fakeFitsModule, encode: fakeEncodeModule, synth: module } });
  const get = (path) => handler(new Request(`http://localhost${path}`));
  const id = 'ibe/data/spherex/dr1/level2/x/l2b-syn-r1-dp2/4/level2_X_0001_1D4_spx_l2b-syn-r1-dp2.fits';
  const res = await get(`/api/cutout?id=${id}&ra=150&dec=2&size=0.1`);
  assert.equal(res.status, 200);
  assert.ok(Math.abs(decodeFake(new Uint8Array(await res.arrayBuffer())).wave0 - 4) < 1e-6);
  assert.deepEqual(asked, [{ id, ra: 150, dec: 2, size: 0.1 }]);
  await expectError(await get('/api/cutout?id=ibe/data/spherex/qr3/level2/real.fits&ra=150&dec=2'), 400, false);
  await expectError(await get(`/api/cutout?id=${id}&ra=150&dec=85`), 404, false, /not on the detector/);
  assert.deepEqual((await (await get('/api/gaia?ra=150&dec=2')).json()).stars.map((s) => s.id), ['991']);
});

test('createHandler rejects an unknown backend', () => {
  assert.throws(() => createHandler({ backend: 'live' }), /unknown backend/);
});
