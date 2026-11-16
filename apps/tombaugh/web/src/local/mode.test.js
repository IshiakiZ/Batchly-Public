// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUCKET_PROBE_URL,
  SOURCES,
  chooseDataSource,
  createAutoApi,
  createPageApi,
  failoverVerdict,
  healthState,
  parseSourceParam,
  probeBucket,
  sourceLabel,
  withSourceParam,
} from './mode.js';

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

const METHODS = ['search', 'cutout', 'gaia', 'resolve', 'health', 'fog', 'fogMark'];
const PROXY_URL = 'https://api.batch-ly.com/functions/v1/spherex';

/** An api whose methods answer { from, method } unless `behaviour[method]` says otherwise. */
function fakeApi(name, behaviour = {}) {
  const calls = [];
  const api = { baseUrl: name === 'remote' ? PROXY_URL : `local:${name}` };
  for (const method of METHODS) {
    api[method] = async (...args) => {
      calls.push({ method, args });
      const b = behaviour[method];
      if (b instanceof Error) throw b;
      if (typeof b === 'function') return b(...args);
      if (b !== undefined) return b;
      return method === 'health' ? { ok: true, from: name } : { from: name, method };
    };
  }
  Object.defineProperty(api, 'calls', { value: calls, enumerable: false });
  Object.defineProperty(api, 'behaviour', { value: behaviour, enumerable: false });
  return api;
}

const apiError = (message, fields) => Object.assign(new Error(message), { name: 'ApiError', status: 0, retryable: true, aborted: false }, fields);
const networkError = () => apiError('The Tombaugh data service could not be reached');
const httpError = (status, retryable = status >= 500) => apiError(`The data service answered ${status}`, { status, retryable });
const cancelled = () => apiError('Request cancelled', { aborted: true, retryable: false });

/** createAutoApi with fakes and counters. Not eager unless asked, so tests decide what happens first. */
function setup({ remote = {}, s3 = {}, synthetic = {}, allowed = true, url = 'https://tombaugh.example/', eager = false, makeLocalFails = 0 } = {}) {
  const remoteApi = fakeApi('remote', remote);
  const locals = { s3: fakeApi('s3', s3), synthetic: fakeApi('synthetic', synthetic) };
  const counts = { probe: 0, makeLocal: [] };
  const changes = [];
  let failures = makeLocalFails;
  const api = createAutoApi({
    remote: remoteApi,
    url,
    eager,
    healthTimeoutMs: 200,
    log: () => {},
    makeLocal: async (backend) => {
      counts.makeLocal.push(backend);
      if (failures > 0) {
        failures -= 1;
        throw new Error('proxy/src could not be loaded');
      }
      return locals[backend];
    },
    probe: async () => {
      counts.probe += 1;
      if (allowed instanceof Error) throw allowed;
      return { allowed };
    },
    onChange: (change) => changes.push(change),
  });
  return { api, remote: remoteApi, locals, counts, changes, ds: api.dataSource };
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

test('parseSourceParam reads ?source= from URLs, query strings and Location-like objects', () => {
  const cases = [
    ['https://x.example/?source=proxy', 'proxy'],
    ['https://x.example/?ra=1&source=direct&dec=2', 'direct'],
    ['https://x.example/?source=practice#frag', 'practice'],
    ['?source=PRACTICE', 'practice'],
    ['?source=s3', 'direct'],
    ['?source=synthetic', 'practice'],
    ['?source=%20direct%20', 'direct'],
    ['https://x.example/', null],
    ['https://x.example/?source=', null],
    ['https://x.example/?source=irsa', null],
    ['https://x.example/#?source=practice', null],
    ['', null],
  ];
  for (const [url, want] of cases) assert.equal(parseSourceParam(url), want, url);
  assert.equal(parseSourceParam({ search: '?source=direct' }), 'direct');
  assert.equal(parseSourceParam(new URL('https://x.example/a?source=practice')), 'practice');
  assert.equal(parseSourceParam(null), null);
  assert.equal(parseSourceParam(undefined), null);
  assert.equal(parseSourceParam(42), null);
});

test('withSourceParam sets or removes the parameter and keeps the rest of the URL', () => {
  assert.equal(withSourceParam('https://x.example/', 'practice'), 'https://x.example/?source=practice');
  assert.equal(withSourceParam('https://x.example/?ra=1&dec=2#top', 'direct'), 'https://x.example/?ra=1&dec=2&source=direct#top');
  assert.equal(withSourceParam('https://x.example/?source=practice&ra=1', 'proxy'), 'https://x.example/?source=proxy&ra=1');
  assert.equal(withSourceParam('https://x.example/?source=practice&ra=1', null), 'https://x.example/?ra=1');
  assert.equal(withSourceParam('https://x.example/?source=practice', null), 'https://x.example/');
  assert.equal(parseSourceParam(withSourceParam('/page.html?fov=4', 'practice')), 'practice');
});

test('healthState: a body, a boolean, an error or nothing', () => {
  assert.equal(healthState(undefined), 'unknown');
  assert.equal(healthState(null), 'unknown');
  assert.equal(healthState({ ok: true, version: '0.1.0', irsa: 'down' }), 'ok', 'the proxy is up even when IRSA is not');
  assert.equal(healthState(true), 'ok');
  assert.equal(healthState({ ok: false }), 'failed');
  assert.equal(healthState({}), 'failed');
  assert.equal(healthState(false), 'failed');
  assert.equal(healthState(new Error('unreachable')), 'failed');
});

test('chooseDataSource: the decision table', () => {
  const plain = 'https://tombaugh.example/?ra=1&dec=2';
  const down = new Error('unreachable');
  const table = [
    // url, health, directAllowed -> source, forced, reason
    [plain, undefined, undefined, 'proxy', false, 'default'],
    [plain, { ok: true }, undefined, 'proxy', false, 'proxy-ok'],
    [plain, { ok: true }, false, 'proxy', false, 'proxy-ok'],
    [plain, down, true, 'direct', false, 'proxy-down'],
    [plain, { ok: false }, true, 'direct', false, 'proxy-down'],
    [plain, down, false, 'proxy', false, 'proxy-down-direct-blocked'],
    [plain, down, undefined, 'proxy', false, 'proxy-down-direct-unknown'],
    [`${plain}&source=proxy`, down, true, 'proxy', true, 'url'],
    [`${plain}&source=direct`, { ok: true }, false, 'direct', true, 'url'],
    [`${plain}&source=practice`, { ok: true }, true, 'practice', true, 'url'],
    [`${plain}&source=practice`, down, false, 'practice', true, 'url'],
    [`${plain}&source=nonsense`, undefined, undefined, 'proxy', false, 'default'],
  ];
  for (const [url, health, directAllowed, source, forced, reason] of table) {
    const got = chooseDataSource({ url, health, directAllowed });
    assert.deepEqual({ source: got.source, forced: got.forced, reason: got.reason }, { source, forced, reason }, `${url} ${JSON.stringify(health)} ${directAllowed}`);
  }
  assert.equal(chooseDataSource({ url: plain, health: down }).needsProbe, true);
  assert.deepEqual(chooseDataSource(), { source: 'proxy', forced: false, reason: 'default' });
  // The practice sky is never chosen automatically: simulated data must be asked for.
  for (const health of [undefined, { ok: true }, down]) {
    for (const directAllowed of [undefined, true, false]) {
      assert.notEqual(chooseDataSource({ url: plain, health, directAllowed }).source, 'practice');
    }
  }
});

test('failoverVerdict: which failures point at the proxy itself', () => {
  assert.equal(failoverVerdict(networkError(), 'search'), 'switch');
  assert.equal(failoverVerdict(httpError(502), 'search'), 'switch');
  assert.equal(failoverVerdict(httpError(500, false), 'search'), 'switch');
  assert.equal(failoverVerdict(httpError(503), 'health'), 'switch');
  assert.equal(failoverVerdict(new TypeError('Failed to fetch'), 'search'), 'switch');
  assert.equal(failoverVerdict(httpError(400, false), 'search'), null);
  assert.equal(failoverVerdict(httpError(404, false), 'search'), null);
  assert.equal(failoverVerdict(httpError(429, true), 'search'), null);
  assert.equal(failoverVerdict(cancelled(), 'search'), null);
  assert.equal(failoverVerdict(Object.assign(new Error('x'), { name: 'AbortError' }), 'search'), null);
  assert.equal(failoverVerdict(apiError('Not a TBF1 frame', { retryable: false }), 'cutout'), null);
  assert.equal(failoverVerdict(networkError(), 'cutout'), 'verify');
  assert.equal(failoverVerdict(networkError(), 'gaia'), 'verify');
  assert.equal(failoverVerdict(httpError(502), 'cutout'), null, 'one exposure failing upstream is not the proxy being down');
  assert.equal(failoverVerdict(httpError(404, false), 'cutout'), null);
  assert.equal(failoverVerdict(null, 'search'), null);
});

test('sourceLabel names the proxy host in use', () => {
  assert.equal(sourceLabel('proxy', PROXY_URL), 'Proxy on batch-ly.com');
  assert.equal(sourceLabel('proxy', ''), 'Proxy on batch-ly.com');
  assert.equal(sourceLabel('proxy', '/api'), 'Proxy on this server');
  assert.equal(sourceLabel('proxy', 'http://localhost:8787/api'), 'Proxy on localhost');
  assert.equal(sourceLabel('direct', PROXY_URL), "Direct from NASA's public cloud copy");
  assert.equal(sourceLabel('practice'), 'Practice sky: simulated');
  for (const id of ['proxy', 'direct', 'practice']) {
    assert.ok(SOURCES[id].description.length > 40);
    assert.doesNotMatch(SOURCES[id].description, /!|amazing|powerful|revolution/i);
  }
  assert.match(SOURCES.practice.description, /Nothing in it was observed/);
  assert.match(SOURCES.direct.description, /1\.5 MB/);
});

// ---------------------------------------------------------------------------------------------
// probeBucket
// ---------------------------------------------------------------------------------------------

test('probeBucket asks for one byte and needs a 206', async () => {
  const seen = [];
  const ok = await probeBucket({
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response('x', { status: 206, headers: { 'content-range': 'bytes 0-0/1234' } });
    },
  });
  assert.deepEqual(ok, { allowed: true, status: 206, reason: 'ok' });
  assert.equal(seen[0].url, BUCKET_PROBE_URL);
  assert.match(BUCKET_PROBE_URL, /^https:\/\/nasa-irsa-spherex\.s3\.amazonaws\.com\//);
  assert.equal(seen[0].init.headers.Range, 'bytes=0-0');
  assert.equal(seen[0].init.credentials, 'omit');
  assert.equal(seen[0].init.method, 'GET');
});

test('probeBucket: a block, an error status, an ignored range or silence all mean "not allowed"', async () => {
  // A Content-Security-Policy block and a network failure both reject the fetch with a TypeError.
  const blocked = await probeBucket({ fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'blocked or unreachable');
  const thrown = await probeBucket({
    fetchImpl: () => {
      throw new Error('Refused to connect: violates Content Security Policy');
    },
  });
  assert.equal(thrown.allowed, false);
  const forbidden = await probeBucket({ fetchImpl: async () => new Response('no', { status: 403 }) });
  assert.deepEqual(forbidden, { allowed: false, status: 403, reason: 'the bucket answered 403' });
  const whole = await probeBucket({ fetchImpl: async () => new Response('all of it', { status: 200 }) });
  assert.equal(whole.allowed, false, 'without byte ranges every exposure would be 65 MB');
  assert.match(whole.reason, /ranges/);
  const silent = await probeBucket({
    timeoutMs: 20,
    fetchImpl: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  });
  assert.deepEqual(silent, { allowed: false, status: 0, reason: 'no answer in time' });
  assert.equal((await probeBucket({ fetchImpl: null })).allowed, false);
});

// ---------------------------------------------------------------------------------------------
// createAutoApi
// ---------------------------------------------------------------------------------------------

test('starts on the proxy and forwards every call, with the proxy base URL', async () => {
  const { api, remote, counts, changes, ds } = setup();
  assert.deepEqual(Object.keys(api).filter((k) => typeof api[k] === 'function').sort(), [...METHODS].sort());
  assert.equal(api.baseUrl, PROXY_URL);
  assert.deepEqual(await api.search(10, 20, { signal: null }), { from: 'remote', method: 'search' });
  assert.deepEqual(await api.cutout('id', 10, 20, 0.1), { from: 'remote', method: 'cutout' });
  assert.deepEqual(remote.calls[0], { method: 'search', args: [10, 20, { signal: null }] });
  assert.deepEqual(remote.calls[1].args, ['id', 10, 20, 0.1]);
  assert.equal(counts.probe, 0);
  assert.deepEqual(counts.makeLocal, []);
  assert.equal(changes.length, 0);
  const now = ds.current();
  assert.equal(now.source, 'proxy');
  assert.equal(now.forced, false);
  assert.equal(now.simulated, false);
  assert.equal(now.label, 'Proxy on batch-ly.com');
  assert.equal(ds.lastChange(), null);
});

test('a method the proxy api gains later is forwarded as well', async () => {
  const remote = fakeApi('remote');
  remote.identify = async (ra) => ({ identified: ra });
  const api = createAutoApi({ remote, eager: false, makeLocal: async () => fakeApi('s3'), probe: async () => ({ allowed: true }) });
  assert.deepEqual(await api.identify(5), { identified: 5 });
  assert.throws(() => createAutoApi({ remote: {} }), TypeError);
});

test('a search that hits a network error is repeated on direct, and the user is told once', async () => {
  const { api, remote, locals, counts, changes, ds } = setup({ remote: { search: networkError() } });
  const res = await api.search(10, 20);
  assert.deepEqual(res, { from: 's3', method: 'search' });
  assert.deepEqual(locals.s3.calls[0], { method: 'search', args: [10, 20] });
  assert.equal(counts.probe, 1);
  assert.deepEqual(counts.makeLocal, ['s3']);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].source, 'direct');
  assert.equal(changes[0].previous, 'proxy');
  assert.equal(changes[0].forced, false);
  assert.equal(changes[0].reason, 'proxy-search-failed');
  assert.match(changes[0].message, /proxy is not answering/);
  assert.match(changes[0].message, /1\.5 MB/);
  assert.equal(ds.current().source, 'direct');
  assert.equal(api.baseUrl, 'local:s3');
  assert.deepEqual(ds.lastChange().source, 'direct');
  // From now on everything goes direct, without asking the proxy again.
  const before = remote.calls.length;
  await api.cutout('id', 10, 20, 0.1);
  await api.gaia(10, 20, 0.1);
  await api.search(11, 21);
  assert.equal(remote.calls.length, before);
  assert.equal(counts.probe, 1);
  assert.deepEqual(counts.makeLocal, ['s3']);
  assert.equal(changes.length, 1);
});

test('a search that gets a 5xx fails over; a 4xx or a cancelled search does not', async () => {
  const five = setup({ remote: { search: httpError(502) } });
  assert.equal((await five.api.search(1, 2)).from, 's3');
  assert.equal(five.ds.current().source, 'direct');

  for (const err of [httpError(400, false), httpError(404, false), httpError(429, true), cancelled()]) {
    const t = setup({ remote: { search: err } });
    await assert.rejects(t.api.search(1, 2), (e) => e === err);
    assert.equal(t.ds.current().source, 'proxy');
    assert.equal(t.counts.probe, 0);
    assert.equal(t.changes.length, 0);
  }
});

test('when the bucket cannot be reached the proxy error is reported and nothing changes', async () => {
  for (const allowed of [false, new Error('probe exploded')]) {
    const err = networkError();
    const { api, counts, changes, ds } = setup({ remote: { search: err }, allowed });
    await assert.rejects(api.search(1, 2), (e) => e === err);
    assert.equal(ds.current().source, 'proxy');
    assert.equal(ds.current().directAllowed, false);
    assert.match(ds.current().note, /not allowed to reach/);
    assert.match(ds.current().note, /practice sky still works/);
    assert.deepEqual(counts.makeLocal, [], 'the proxy code is not even loaded');
    assert.equal(changes.length, 0);
    // The probe is not repeated for every failing call.
    await assert.rejects(api.search(1, 2));
    assert.equal(counts.probe, 1);
  }
});

test('if direct fails as well, the caller gets the proxy error and the page stays on the proxy', async () => {
  const err = httpError(502);
  const directErr = apiError('Direct mode has no exposure index to search', { status: 503, retryable: false });
  const { api, changes, ds, locals } = setup({ remote: { search: err }, s3: { search: directErr } });
  await assert.rejects(api.search(1, 2), (e) => e === err && e.directError === directErr);
  assert.equal(ds.current().source, 'proxy');
  assert.equal(changes.length, 0);
  assert.equal(locals.s3.calls.length, 1);
});

test('if the in-page service cannot be loaded, the proxy error is reported; a later call may try again', async () => {
  const err = networkError();
  const { api, counts, ds, remote } = setup({ remote: { search: err }, makeLocalFails: 1 });
  await assert.rejects(api.search(1, 2), (e) => e === err && /could not be loaded/.test(e.directError.message));
  assert.equal(ds.current().source, 'proxy');
  assert.equal((await api.search(1, 2)).from, 's3');
  assert.deepEqual(counts.makeLocal, ['s3', 's3']);
  assert.equal(ds.current().source, 'direct');
  assert.equal(remote.calls.filter((c) => c.method === 'search').length, 2);
});

test('several calls failing at once probe once, load once and announce once', async () => {
  const { api, counts, changes, locals } = setup({ remote: { search: networkError(), cutout: networkError(), health: networkError() } });
  const results = await Promise.all([api.search(1, 2), api.search(3, 4), api.cutout('a', 1, 2, 0.1), api.cutout('b', 1, 2, 0.1)]);
  assert.deepEqual(results.map((r) => r.from), ['s3', 's3', 's3', 's3']);
  assert.equal(counts.probe, 1);
  assert.deepEqual(counts.makeLocal, ['s3']);
  assert.equal(changes.length, 1);
  assert.equal(locals.s3.calls.length, 4);
});

test('a cutout network error is checked against /health before leaving the proxy', async () => {
  // The proxy is fine: that one request was unlucky.
  const lucky = setup({ remote: { cutout: networkError() } });
  await assert.rejects(lucky.api.cutout('id', 1, 2, 0.1), /could not be reached/);
  assert.equal(lucky.ds.current().source, 'proxy');
  assert.equal(lucky.remote.calls.filter((c) => c.method === 'health').length, 1);
  assert.equal(lucky.counts.probe, 0);

  // The proxy is gone: the cutout is read directly (the frame ids are the same in both).
  const gone = setup({ remote: { cutout: networkError(), health: networkError() } });
  assert.equal((await gone.api.cutout('id', 1, 2, 0.1)).from, 's3');
  assert.equal(gone.ds.current().source, 'direct');
  assert.equal(gone.changes[0].reason, 'proxy-cutout-failed');

  // An upstream failure for one exposure is passed on untouched.
  const upstream = setup({ remote: { cutout: httpError(502) } });
  await assert.rejects(upstream.api.cutout('id', 1, 2, 0.1), /answered 502/);
  assert.equal(upstream.remote.calls.filter((c) => c.method === 'health').length, 0);
  assert.equal(upstream.ds.current().source, 'proxy');
});

test('a health check that hangs counts as failed', async () => {
  const { api, ds } = setup({
    remote: {
      cutout: networkError(),
      health: (opts) => new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(cancelled()))),
    },
  });
  assert.equal((await api.cutout('id', 1, 2, 0.1)).from, 's3');
  assert.equal(ds.current().source, 'direct');
  assert.equal(ds.current().proxyAlive, false);
});

test('eager: a failing /health at start-up moves to direct before the first call', async () => {
  const { api, ds, changes, remote, locals } = setup({ remote: { health: networkError() }, eager: true });
  const state = await ds.settled();
  assert.equal(state.source, 'direct');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].reason, 'proxy-health-failed');
  assert.equal((await api.search(1, 2)).from, 's3');
  assert.equal(remote.calls.filter((c) => c.method === 'search').length, 0);
  assert.equal(locals.s3.calls.length, 1);
});

test('eager: a healthy proxy stays; a dead proxy with a blocked bucket stays and says why', async () => {
  const healthy = setup({ eager: true });
  assert.equal((await healthy.ds.settled()).source, 'proxy');
  assert.equal(healthy.ds.current().proxyAlive, true);
  assert.equal(healthy.counts.probe, 0);

  const stuck = setup({ remote: { health: httpError(503) }, eager: true, allowed: false });
  const state = await stuck.ds.settled();
  assert.equal(state.source, 'proxy');
  assert.equal(state.reason, 'proxy-down-direct-blocked');
  assert.match(state.note, /practice sky still works/);
  assert.equal(stuck.changes.length, 0);
});

test('calling health() on a dead proxy reports the failure and moves on', async () => {
  const err = networkError();
  const { api, ds } = setup({ remote: { health: err } });
  await assert.rejects(api.health(), (e) => e === err);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ds.current().source, 'direct');
  assert.equal((await api.health()).from, 's3');
});

test('?source=proxy pins the proxy: no health check, no failover', async () => {
  const err = networkError();
  const { api, ds, counts, remote } = setup({ remote: { search: err, health: networkError() }, url: 'https://t.example/?source=proxy', eager: true });
  await ds.settled();
  assert.equal(remote.calls.length, 0, 'no eager health check when pinned');
  await assert.rejects(api.search(1, 2), (e) => e === err);
  assert.equal(ds.current().source, 'proxy');
  assert.equal(ds.current().forced, true);
  assert.equal(counts.probe, 0);
});

test('?source=direct uses the in-page S3 service from the first call', async () => {
  const { api, ds, counts, remote, locals, changes } = setup({ url: 'https://t.example/?ra=1&source=direct', eager: true });
  assert.equal(ds.current().source, 'direct');
  assert.equal(ds.current().forced, true);
  assert.equal(api.baseUrl, 'local:s3');
  assert.equal((await api.search(1, 2)).from, 's3');
  assert.equal((await api.cutout('id', 1, 2, 0.1)).from, 's3');
  assert.equal(remote.calls.length, 0);
  assert.equal(counts.probe, 0, 'a pinned source is not second-guessed');
  assert.equal(changes.length, 0);
  assert.equal(locals.s3.calls.length, 2);
  // A failure in direct mode is reported as it is.
  locals.s3.behaviour.search = httpError(502);
  await assert.rejects(api.search(1, 2), /answered 502/);
  assert.equal(ds.current().source, 'direct');
});

test('direct mode still records real visits on the shared map while the proxy answers', async () => {
  const up = setup({ url: 'https://t.example/?source=direct' });
  assert.equal((await up.api.fogMark(1, 2)).from, 'remote');
  assert.equal((await up.api.fog()).from, 'remote');

  const down = setup({ url: 'https://t.example/?source=direct', remote: { fogMark: networkError(), fog: networkError() } });
  assert.equal((await down.api.fogMark(1, 2)).from, 's3', 'falls back to the map kept in this browser');
  assert.equal((await down.api.fog()).from, 's3');
  assert.equal(down.remote.calls.length, 1, 'and does not keep asking a proxy that is gone');
});

test('?source=practice: simulated, marked, and never in contact with the proxy', async () => {
  const { api, ds, remote, locals, counts } = setup({
    url: 'https://t.example/?source=practice',
    eager: true,
    synthetic: { search: { ra: 1, dec: 2, frames: [] } },
  });
  assert.equal(ds.current().source, 'practice');
  assert.equal(ds.current().simulated, true);
  assert.equal(ds.current().label, 'Practice sky: simulated');
  assert.equal(api.baseUrl, 'local:synthetic');
  const res = await api.search(1, 2);
  assert.equal(res.simulated, true, 'added here even if the local api forgot');
  await api.cutout('id', 1, 2, 0.1);
  await api.fogMark(1, 2);
  await api.fog();
  await api.gaia(1, 2, 0.1);
  await api.resolve('x');
  assert.equal(remote.calls.length, 0, 'a simulated visit never reaches the shared sky map');
  assert.equal(locals.synthetic.calls.length, 6);
  assert.equal(counts.probe, 0);
});

test('use(): switching by hand, notifications, and back to automatic', async () => {
  const { api, ds, changes, counts, remote } = setup({ remote: { search: networkError() } });
  const seen = [];
  const off = ds.onChange((c) => seen.push(c.source));
  ds.onChange(() => {
    throw new Error('a broken listener must not matter');
  });

  let state = await ds.use('practice');
  assert.equal(state.source, 'practice');
  assert.equal(state.forced, true);
  assert.match(changes[0].message, /simulated/);
  assert.equal((await api.search(1, 2)).simulated, true);

  state = await ds.use('direct');
  assert.equal(state.source, 'direct');
  assert.match(changes[1].message, /1\.5 MB/);
  await ds.use('direct'); // no change, no event
  assert.equal(changes.length, 2);

  state = await ds.use('proxy');
  assert.equal(state.source, 'proxy');
  assert.equal(state.forced, false, 'the proxy chosen by hand keeps its safety net');
  assert.equal((await api.search(1, 2)).from, 's3');
  assert.equal(ds.current().source, 'direct');
  assert.deepEqual(seen, ['practice', 'direct', 'proxy', 'direct']);

  off();
  await ds.use('practice');
  assert.equal(seen.length, 4);
  await assert.rejects(ds.use('irsa'), /Unknown data source/);
  assert.deepEqual(counts.makeLocal.sort(), ['s3', 'synthetic']);
  assert.ok(remote.calls.length >= 1);
  assert.deepEqual(ds.sources().map((s) => s.id), ['proxy', 'direct', 'practice']);
});

test('use() fails visibly when the in-page service cannot be loaded, and nothing changes', async () => {
  const { ds, changes } = setup({ makeLocalFails: 1 });
  await assert.rejects(ds.use('practice'), /could not be loaded/);
  assert.equal(ds.current().source, 'proxy');
  assert.equal(changes.length, 0);
  assert.equal((await ds.use('practice')).source, 'practice');

  const none = createAutoApi({ remote: fakeApi('remote'), eager: false });
  await assert.rejects(none.dataSource.use('practice'), /cannot run the data service inside the page/);
});

// ---------------------------------------------------------------------------------------------
// createPageApi: the real wiring, in Node
// ---------------------------------------------------------------------------------------------

test('createPageApi reads the page URL and runs the practice sky with the real modules', async (t) => {
  try {
    await import('../../../proxy/src/handler.js');
    await import('../../../proxy/fixtures/synth.js');
  } catch {
    t.skip('proxy/src/handler.js or proxy/fixtures/synth.js is not there yet');
    return;
  }
  const remote = fakeApi('remote');
  const changes = [];
  const win = { location: { href: 'https://tombaugh.example/?ra=150&dec=2.2&source=practice' }, fetch: () => Promise.reject(new Error('no network in tests')) };
  const api = createPageApi({ remote, win, onChange: (c) => changes.push(c) });
  assert.equal(api.dataSource.current().source, 'practice');
  const res = await api.search(150, 2.2);
  assert.equal(res.simulated, true);
  assert.ok(res.frames.length > 100);
  const frame = await api.cutout(res.frames[0].id, 150, 2.2, 0.1);
  assert.equal(frame.image.length, frame.nx * frame.ny);
  assert.equal(api.baseUrl, 'local:synthetic');
  assert.equal(remote.calls.length, 0);
  const cache = await api.dataSource.cache();
  assert.ok(cache.stats().entries >= 1, 'the cutout went through the shared cache');
});

test('createPageApi survives a window that refuses to be read', async () => {
  const hostile = {
    get location() {
      throw new Error('SecurityError');
    },
    get fetch() {
      throw new Error('SecurityError');
    },
  };
  const api = createPageApi({ remote: fakeApi('remote'), win: hostile, eager: false });
  assert.equal(api.dataSource.current().source, 'proxy');
  assert.equal((await api.search(1, 2)).from, 'remote');
});
