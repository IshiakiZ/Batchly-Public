// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cacheKey, createMemoryCache, createSupabaseCache, isSafeKey } from './cache.js';

const bytes = (...values) => new Uint8Array(values);
const quiet = () => {};

test('cacheKey is a stable, path-safe sha-1 key with a readable prefix', async () => {
  const a = await cacheKey(['cutout', 'ibe/data/spherex/qr3/level2/x.fits', 210.80227, 0.1]);
  const b = await cacheKey(['cutout', 'ibe/data/spherex/qr3/level2/x.fits', 210.80227, 0.1]);
  const c = await cacheKey(['cutout', 'ibe/data/spherex/qr3/level2/x.fits', 210.80228, 0.1]);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^cutout\/[0-9a-f]{40}$/);
  assert.equal(isSafeKey(a), true);
  // Known digest: sha1("abc") = a9993e36...
  assert.equal(await cacheKey('abc'), 'abc/a9993e364706816aba3e25717850c26c9cd0d89d');
  // Parts are separated, so ['ab','c'] and ['a','bc'] differ.
  assert.notEqual((await cacheKey(['x', 'ab', 'c'])).slice(2), (await cacheKey(['x', 'a', 'bc'])).slice(2));
  assert.match(await cacheKey(['../../Etc Passwd?', 1]), /^etc-passwd\/[0-9a-f]{40}$/);
  assert.match(await cacheKey([]), /^k\/[0-9a-f]{40}$/);
});

test('isSafeKey rejects traversal and odd characters', () => {
  assert.equal(isSafeKey('fog/nside32.bin'), true);
  assert.equal(isSafeKey('wave/irsa-d2-v1.json'), true);
  for (const bad of ['', '/abs', 'a/../b', 'a//b', 'a b', 'a?b', 'a/', null, 'a\\b', 'a%2e']) {
    assert.equal(isSafeKey(bad), false, String(bad));
  }
});

test('memory cache stores copies and returns copies', async () => {
  const cache = createMemoryCache();
  const original = bytes(1, 2, 3);
  assert.equal(await cache.get('k'), null);
  assert.equal(await cache.put('k', original, 'application/octet-stream'), true);
  original[0] = 99;
  const first = await cache.get('k');
  assert.deepEqual([...first], [1, 2, 3]);
  first[1] = 77;
  assert.deepEqual([...(await cache.get('k'))], [1, 2, 3]);
  assert.equal(first.byteOffset, 0);
  assert.equal(await cache.delete('k'), true);
  assert.equal(await cache.get('k'), null);
});

test('memory cache honours maxAgeSeconds but keeps the stale entry for callers that accept it', async () => {
  let t = 1_000_000;
  const cache = createMemoryCache({ now: () => t });
  await cache.put('k', bytes(5));
  t += 59_000;
  assert.deepEqual([...(await cache.get('k', { maxAgeSeconds: 60 }))], [5]);
  t += 2_000;
  assert.equal(await cache.get('k', { maxAgeSeconds: 60 }), null);
  assert.deepEqual([...(await cache.get('k'))], [5]);
});

test('memory cache evicts least recently used entries beyond the byte cap', async () => {
  const cache = createMemoryCache({ maxBytes: 1000 });
  await cache.put('a', new Uint8Array(200));
  await cache.put('b', new Uint8Array(200));
  await cache.put('c', new Uint8Array(200));
  await cache.put('d', new Uint8Array(200));
  await cache.get('a'); // a is now the most recently used
  await cache.put('e', new Uint8Array(200));
  await cache.put('f', new Uint8Array(200)); // 1200 bytes -> b must go
  assert.equal(await cache.get('b'), null);
  assert.ok(await cache.get('a'));
  assert.ok(await cache.get('f'));
  assert.ok(cache.stats().bytes <= 1000);
  // Too large for the cache at all: refused, nothing evicted.
  assert.equal(await cache.put('huge', new Uint8Array(400)), false);
  assert.ok(await cache.get('a'));
  // Replacing a key does not double count.
  await cache.put('a', new Uint8Array(100));
  assert.equal(cache.stats().bytes, 900);
});

test('memory cache never throws on odd input', async () => {
  const cache = createMemoryCache({ log: quiet });
  assert.equal(await cache.put('k', { not: 'bytes' }), false);
  assert.equal(await cache.put('', bytes(1)), false);
  assert.equal(await cache.get(undefined), null);
  assert.equal(await cache.put('s', 'text'), true);
  assert.equal(new TextDecoder().decode(await cache.get('s')), 'text');
  assert.equal(await cache.put('ab', new Uint16Array([1, 2]).buffer), true);
  assert.equal((await cache.get('ab')).byteLength, 4);
});

/** A tiny in-memory imitation of the Supabase Storage REST API. */
function fakeStorage({ bucketExists = true } = {}) {
  const objects = new Map();
  const calls = [];
  const state = { bucketExists };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push({ method, path: u.pathname, headers: init.headers || {} });
    if (u.pathname === '/storage/v1/bucket' && method === 'POST') {
      if (state.bucketExists) return new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }), { status: 400 });
      state.bucketExists = true;
      state.created = JSON.parse(init.body);
      return new Response(JSON.stringify({ name: 'spherex-cache' }), { status: 200 });
    }
    const m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (!m) return new Response('nope', { status: 404 });
    if (!state.bucketExists) return new Response(JSON.stringify({ statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }), { status: 400 });
    const key = decodeURIComponent(m[2]);
    if (method === 'GET') {
      if (!objects.has(key)) return new Response(JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' }), { status: 400 });
      return new Response(objects.get(key), { status: 200 });
    }
    if (method === 'POST') {
      objects.set(key, new Uint8Array(init.body));
      return new Response(JSON.stringify({ Key: key }), { status: 200 });
    }
    if (method === 'DELETE') {
      return new Response('{}', { status: objects.delete(key) ? 200 : 404 });
    }
    return new Response('nope', { status: 405 });
  };
  return { fetchImpl, objects, calls, state };
}

test('supabase cache round-trips objects through the storage REST API', async () => {
  const storage = fakeStorage();
  const cache = createSupabaseCache({ url: 'https://proj.supabase.co/', serviceKey: 'svc-key', bucket: 'spherex-cache', fetchImpl: storage.fetchImpl, log: quiet });
  assert.equal(await cache.get('cutout/abc'), null);
  assert.equal(await cache.put('cutout/abc', bytes(9, 8, 7), 'application/octet-stream'), true);
  const got = await cache.get('cutout/abc');
  assert.deepEqual([...got], [9, 8, 7]);
  assert.equal(got.byteOffset, 0);

  const put = storage.calls.find((c) => c.method === 'POST');
  assert.equal(put.path, '/storage/v1/object/spherex-cache/cutout/abc');
  assert.equal(put.headers.authorization, 'Bearer svc-key');
  assert.equal(put.headers.apikey, 'svc-key');
  assert.equal(put.headers['x-upsert'], 'true');
  assert.equal(put.headers['content-type'], 'application/octet-stream');
  const getCall = storage.calls.find((c) => c.method === 'GET');
  assert.equal(getCall.headers.authorization, 'Bearer svc-key');

  // The stored object carries the 16-byte age prefix.
  const stored = storage.objects.get('cutout/abc');
  assert.equal(stored.byteLength, 19);
  assert.equal(new TextDecoder().decode(stored.subarray(0, 4)), 'TBC1');

  assert.equal(await cache.delete('cutout/abc'), true);
  assert.equal(await cache.get('cutout/abc'), null);
});

test('supabase cache honours maxAgeSeconds via the stored timestamp', async () => {
  const storage = fakeStorage();
  let t = 5_000_000;
  const cache = createSupabaseCache({ url: 'https://p.supabase.co', serviceKey: 'k', bucket: 'b', fetchImpl: storage.fetchImpl, now: () => t, log: quiet });
  await cache.put('search/x', bytes(1));
  t += 3600_000;
  assert.deepEqual([...(await cache.get('search/x', { maxAgeSeconds: 7200 }))], [1]);
  assert.equal(await cache.get('search/x', { maxAgeSeconds: 1800 }), null);
  assert.deepEqual([...(await cache.get('search/x'))], [1]);
  // An object written by something else (no prefix) is returned raw, and counts as too old
  // whenever an age limit is given.
  storage.objects.set('raw/obj', bytes(4, 5, 6));
  assert.deepEqual([...(await cache.get('raw/obj'))], [4, 5, 6]);
  assert.equal(await cache.get('raw/obj', { maxAgeSeconds: 10 }), null);
});

test('supabase cache creates the private bucket when the first write finds none', async () => {
  const storage = fakeStorage({ bucketExists: false });
  const cache = createSupabaseCache({ url: 'https://p.supabase.co', serviceKey: 'k', bucket: 'spherex-cache', fetchImpl: storage.fetchImpl, log: quiet });
  assert.equal(await cache.get('fog/nside32.bin'), null);
  assert.equal(await cache.put('fog/nside32.bin', bytes(1, 2)), true);
  assert.deepEqual(storage.state.created, { id: 'spherex-cache', name: 'spherex-cache', public: false });
  assert.deepEqual([...(await cache.get('fog/nside32.bin'))], [1, 2]);
});

test('ensureBucket treats "already exists" as success', async () => {
  const storage = fakeStorage({ bucketExists: true });
  const cache = createSupabaseCache({ url: 'https://p.supabase.co', serviceKey: 'k', bucket: 'b', fetchImpl: storage.fetchImpl, log: quiet });
  assert.equal(await cache.ensureBucket(), true);
  assert.equal(await cache.ensureBucket(), true);
  assert.equal(storage.calls.filter((c) => c.path === '/storage/v1/bucket').length, 1);
});

test('supabase cache never throws: network errors, 500s, timeouts and unsafe keys are misses', async () => {
  const logs = [];
  const log = (m) => logs.push(m);
  const broken = createSupabaseCache({
    url: 'https://p.supabase.co',
    serviceKey: 'k',
    bucket: 'b',
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
    log,
  });
  assert.equal(await broken.get('a/b'), null);
  assert.equal(await broken.put('a/b', bytes(1)), false);
  assert.equal(await broken.delete('a/b'), false);
  assert.equal(await broken.ensureBucket(), false);

  const failing = createSupabaseCache({ url: 'https://p.supabase.co', serviceKey: 'k', bucket: 'b', fetchImpl: async () => new Response('boom', { status: 500 }), log });
  assert.equal(await failing.get('a/b'), null);
  assert.equal(await failing.put('a/b', bytes(1)), false);

  const hanging = createSupabaseCache({
    url: 'https://p.supabase.co',
    serviceKey: 'k',
    bucket: 'b',
    timeoutMs: 20,
    fetchImpl: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    log,
  });
  assert.equal(await hanging.get('a/b'), null);
  assert.equal(await hanging.put('a/b', bytes(1)), false);

  let called = 0;
  const guarded = createSupabaseCache({
    url: 'https://p.supabase.co',
    serviceKey: 'k',
    bucket: 'b',
    fetchImpl: async () => {
      called++;
      return new Response('', { status: 200 });
    },
    log,
  });
  assert.equal(await guarded.get('../secret'), null);
  assert.equal(await guarded.put('a/../../b', bytes(1)), false);
  assert.equal(called, 0);
  assert.ok(logs.length >= 6);
});
