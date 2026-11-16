// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DB_NAME,
  META_NAME,
  STORE_NAME,
  createIdbAdapter,
  createIdbCache,
  createMemoryAdapter,
  formatBytes,
} from './idbcache.js';

// ---------------------------------------------------------------------------------------------
// A small in-memory fake of the IndexedDB calls idbcache.js uses: open (with upgrade), object
// stores with out-of-line keys, transactions that complete or abort as a whole, and the requests
// get / put / delete / clear / getAll / getAllKeys / count. Values are structured-cloned in and
// out, as in a browser. `control` injects failures.
// ---------------------------------------------------------------------------------------------

function createFakeIndexedDB() {
  const dbs = new Map(); // name -> { version, stores: Map<storeName, Map<key, value>> }
  const control = {
    throwOnOpen: null, //  thrown synchronously by open()
    failOpen: null, //     delivered through request.onerror
    failPuts: [], //       errors for the next put requests, in order
    failGets: [], //       errors for the next get requests
    opens: 0,
    puts: 0,
    gets: 0,
    transactions: 0,
  };

  function connection(db) {
    let closed = false;
    const conn = {
      onversionchange: null,
      get version() {
        return db.version;
      },
      objectStoreNames: { contains: (name) => db.stores.has(name) },
      createObjectStore(name) {
        if (!conn.upgrading) throw new Error('InvalidStateError: not in an upgrade');
        db.stores.set(name, new Map());
      },
      close() {
        closed = true;
      },
      transaction(names, mode) {
        if (closed) throw new Error('InvalidStateError: the connection is closed');
        control.transactions += 1;
        const list = Array.isArray(names) ? names : [names];
        for (const n of list) if (!db.stores.has(n)) throw new Error(`NotFoundError: no store ${n}`);
        const before = new Map(list.map((n) => [n, new Map(db.stores.get(n))]));
        const tx = { mode, oncomplete: null, onerror: null, onabort: null, error: null };
        let pending = 0;
        let finished = false;

        const settle = () =>
          queueMicrotask(() => {
            if (finished || pending > 0) return;
            finished = true;
            if (tx.oncomplete) tx.oncomplete();
          });
        const abort = (err) => {
          if (finished) return;
          finished = true;
          for (const [n, snapshot] of before) db.stores.set(n, snapshot);
          tx.error = err;
          queueMicrotask(() => {
            if (tx.onabort) tx.onabort();
          });
        };
        const run = (op, injected) => {
          const request = { result: undefined, error: null, onsuccess: null, onerror: null };
          pending += 1;
          queueMicrotask(() => {
            if (finished) return;
            pending -= 1;
            try {
              const fail = injected ? injected.shift() : null;
              if (fail) throw fail;
              request.result = op();
            } catch (err) {
              request.error = err;
              if (request.onerror) request.onerror();
              abort(err);
              return;
            }
            if (request.onsuccess) request.onsuccess();
            settle();
          });
          return request;
        };

        tx.abort = () => abort(new Error('AbortError'));
        tx.objectStore = (name) => {
          if (!list.includes(name)) throw new Error(`NotFoundError: ${name} is not in this transaction`);
          const data = () => db.stores.get(name);
          const writable = () => {
            if (mode !== 'readwrite') throw new Error('ReadOnlyError');
          };
          return {
            get: (key) => {
              control.gets += 1;
              return run(() => {
                const v = data().get(key);
                return v === undefined ? undefined : structuredClone(v);
              }, control.failGets);
            },
            put: (value, key) => {
              writable();
              control.puts += 1;
              return run(() => {
                data().set(key, structuredClone(value));
                return key;
              }, control.failPuts);
            },
            delete: (key) => {
              writable();
              return run(() => void data().delete(key));
            },
            clear: () => {
              writable();
              return run(() => void data().clear());
            },
            getAll: () => run(() => [...data().values()].map((v) => structuredClone(v))),
            getAllKeys: () => run(() => [...data().keys()]),
            count: () => run(() => data().size),
          };
        };
        settle();
        return tx;
      },
    };
    return conn;
  }

  return {
    control,
    dbs,
    /** Direct access to a store's Map, for assertions. */
    store(name, dbName = DB_NAME) {
      const db = dbs.get(dbName);
      return db ? db.stores.get(name) : undefined;
    },
    open(name, version) {
      control.opens += 1;
      if (control.throwOnOpen) throw control.throwOnOpen;
      const request = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      queueMicrotask(() => {
        if (control.failOpen) {
          request.error = control.failOpen;
          if (request.onerror) request.onerror();
          return;
        }
        let db = dbs.get(name);
        if (!db) {
          db = { version: 0, stores: new Map() };
          dbs.set(name, db);
        }
        const want = version === undefined ? Math.max(db.version, 1) : version;
        const conn = connection(db);
        request.result = conn;
        if (want > db.version) {
          db.version = want;
          conn.upgrading = true;
          if (request.onupgradeneeded) request.onupgradeneeded();
          conn.upgrading = false;
        }
        queueMicrotask(() => {
          if (request.onsuccess) request.onsuccess();
        });
      });
      return request;
    },
  };
}

const quiet = () => {};
const bytesOf = (n, fill = 1) => new Uint8Array(n).fill(fill);
const named = (name, message) => Object.assign(new Error(message || name), { name });

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

/** A cache on the fake IndexedDB with a clock that advances 1 ms per call, so recency is strict. */
function idbCache(fake, extra = {}) {
  let t = extra.start || 1_000_000;
  return createIdbCache({ indexedDB: fake, log: quiet, now: () => (t += 1), ...extra });
}

// ---------------------------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------------------------

test('put then get returns the same bytes as a fresh, offset-free array', async () => {
  const fake = createFakeIndexedDB();
  const cache = idbCache(fake);
  const data = Uint8Array.from([84, 66, 70, 49, 0, 1, 2, 3]);
  assert.equal(await cache.put('cutout/abc', data, 'application/octet-stream'), true);
  const got = await cache.get('cutout/abc');
  assert.ok(got instanceof Uint8Array);
  assert.deepEqual([...got], [...data]);
  assert.equal(got.byteOffset, 0);
  assert.notEqual(got.buffer, data.buffer);
  got[0] = 0; // the caller may change what it was given
  assert.equal((await cache.get('cutout/abc'))[0], 84);
  assert.equal(cache.kind, 'indexeddb');
});

test('values are stored in database "tombaugh", store "cache", as { u8, type, t }', async () => {
  const fake = createFakeIndexedDB();
  const now = clock(5000);
  const cache = createIdbCache({ indexedDB: fake, log: quiet, now });
  await cache.put('k1', bytesOf(10), 'application/json');
  assert.equal(DB_NAME, 'tombaugh');
  assert.equal(STORE_NAME, 'cache');
  const stored = fake.store('cache').get('k1');
  assert.deepEqual(Object.keys(stored).sort(), ['t', 'type', 'u8']);
  assert.equal(stored.type, 'application/json');
  assert.equal(stored.t, 5000);
  assert.equal(stored.u8.byteLength, 10);
  assert.deepEqual(fake.store(META_NAME).get('k1'), { k: 'k1', n: 10, a: 5000, t: 5000, type: 'application/json' });
});

test('a view into a larger buffer is stored tight, not with the whole buffer', async () => {
  const fake = createFakeIndexedDB();
  const cache = idbCache(fake);
  const big = new Uint8Array(1000).fill(7);
  await cache.put('view', big.subarray(100, 120));
  assert.equal(fake.store('cache').get('view').u8.buffer.byteLength, 20);
  assert.equal(cache.stats().bytes, 20);
});

test('accepts ArrayBuffer, typed arrays and strings; refuses anything else', async () => {
  const cache = idbCache(createFakeIndexedDB());
  assert.equal(await cache.put('a', new Uint8Array([1, 2]).buffer), true);
  assert.equal(await cache.put('b', new Uint16Array([1, 2])), true);
  assert.equal(await cache.put('c', 'hello'), true);
  assert.equal(await cache.put('d', { not: 'bytes' }), false);
  assert.equal(await cache.put('', bytesOf(2)), false);
  assert.equal(await cache.put(null, bytesOf(2)), false);
  assert.equal((await cache.get('b')).byteLength, 4);
  assert.equal(new TextDecoder().decode(await cache.get('c')), 'hello');
  assert.equal(await cache.get('d'), null);
});

test('a miss is null, and hits and misses are counted', async () => {
  const cache = idbCache(createFakeIndexedDB());
  assert.equal(await cache.get('nope'), null);
  await cache.put('yes', bytesOf(4));
  await cache.get('yes');
  await cache.get('yes');
  const s = cache.stats();
  assert.equal(s.hits, 2);
  assert.equal(s.misses, 1);
  assert.equal(s.entries, 1);
  assert.equal(s.bytes, 4);
  assert.equal(s.persistent, true);
  assert.equal(s.fallback, null);
});

test('maxAgeSeconds hides entries that are too old', async () => {
  const now = clock();
  const cache = createIdbCache({ indexedDB: createFakeIndexedDB(), log: quiet, now });
  await cache.put('search/x', bytesOf(8));
  now.advance(59_000);
  assert.ok(await cache.get('search/x', { maxAgeSeconds: 60 }));
  now.advance(2_000);
  assert.equal(await cache.get('search/x', { maxAgeSeconds: 60 }), null);
  assert.ok(await cache.get('search/x'), 'still there without an age limit');
});

test('delete removes one entry, clear removes everything from both stores', async () => {
  const fake = createFakeIndexedDB();
  const cache = idbCache(fake);
  await cache.put('a', bytesOf(10));
  await cache.put('b', bytesOf(20));
  assert.equal(await cache.delete('a'), true);
  assert.equal(await cache.delete('a'), false);
  assert.equal(await cache.get('a'), null);
  assert.equal(cache.stats().bytes, 20);
  assert.equal(await cache.clear(), true);
  assert.deepEqual({ entries: cache.stats().entries, bytes: cache.stats().bytes }, { entries: 0, bytes: 0 });
  assert.equal(fake.store('cache').size, 0);
  assert.equal(fake.store(META_NAME).size, 0);
  assert.equal(await cache.get('b'), null);
});

// ---------------------------------------------------------------------------------------------
// Size accounting and least-recently-used eviction
// ---------------------------------------------------------------------------------------------

test('the oldest entries are evicted once the total passes the cap', async () => {
  const fake = createFakeIndexedDB();
  const cache = idbCache(fake, { maxBytes: 1000 });
  for (const k of ['a', 'b', 'c', 'd', 'e']) await cache.put(k, bytesOf(200));
  assert.equal(cache.stats().bytes, 1000);
  await cache.put('f', bytesOf(200));
  assert.equal(await cache.get('a'), null, 'a was the least recently used');
  assert.deepEqual(cache.keys(), ['b', 'c', 'd', 'e', 'f']);
  assert.equal(cache.stats().bytes, 1000);
  assert.equal(cache.stats().evictions, 1);
  assert.equal(fake.store('cache').has('a'), false, 'evicted from IndexedDB, not only from the index');
  assert.equal(fake.store(META_NAME).has('a'), false);
});

test('reading an entry protects it: eviction follows use, not insertion', async () => {
  const cache = idbCache(createFakeIndexedDB(), { maxBytes: 1000 });
  for (const k of ['a', 'b', 'c', 'd', 'e']) await cache.put(k, bytesOf(200));
  await cache.get('a');
  await cache.put('f', bytesOf(200));
  assert.ok(await cache.get('a'));
  assert.equal(await cache.get('b'), null);
});

test('one large put evicts as many entries as it needs', async () => {
  const cache = idbCache(createFakeIndexedDB(), { maxBytes: 1000 });
  for (const k of ['a', 'b', 'c', 'd', 'e']) await cache.put(k, bytesOf(200));
  await cache.put('wide', bytesOf(250));
  assert.deepEqual(cache.keys(), ['c', 'd', 'e', 'wide']);
  assert.equal(cache.stats().bytes, 850);
  assert.equal(cache.stats().evictions, 2);
});

test('an object larger than a quarter of the cap is not stored', async () => {
  const cache = idbCache(createFakeIndexedDB(), { maxBytes: 1000 });
  assert.equal(await cache.put('big', bytesOf(251)), false);
  assert.equal(await cache.put('ok', bytesOf(250)), true);
  assert.equal(await cache.get('big'), null);
  assert.equal(cache.stats().entries, 1);
});

test('overwriting a key replaces its size instead of adding to it', async () => {
  const cache = idbCache(createFakeIndexedDB(), { maxBytes: 1000 });
  await cache.put('a', bytesOf(200));
  await cache.put('a', bytesOf(50, 9));
  assert.equal(cache.stats().bytes, 50);
  assert.equal(cache.stats().entries, 1);
  assert.equal((await cache.get('a'))[0], 9);
  // Replacing an entry with a larger one does not evict the entry itself.
  for (const k of ['b', 'c', 'd']) await cache.put(k, bytesOf(250));
  await cache.put('a', bytesOf(250, 3));
  assert.equal((await cache.get('a'))[0], 3);
  assert.equal(cache.stats().bytes, 1000);
});

test('many puts at once keep the accounting exact', async () => {
  const fake = createFakeIndexedDB();
  const cache = idbCache(fake, { maxBytes: 1000 });
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => cache.put(`k${i}`, bytesOf(100))));
  assert.ok(results.every(Boolean));
  const s = cache.stats();
  assert.equal(s.entries, 10);
  assert.equal(s.bytes, 1000);
  assert.equal(s.evictions, 20);
  assert.equal(fake.store('cache').size, 10);
  let sum = 0;
  for (const v of fake.store('cache').values()) sum += v.u8.byteLength;
  assert.equal(sum, 1000);
  assert.deepEqual(cache.keys(), Array.from({ length: 10 }, (_, i) => `k${i + 20}`));
});

// ---------------------------------------------------------------------------------------------
// Persistence across page loads
// ---------------------------------------------------------------------------------------------

test('a new page finds the entries, their sizes and their order of use', async () => {
  const fake = createFakeIndexedDB();
  const first = idbCache(fake, { maxBytes: 1000 });
  for (const k of ['a', 'b', 'c', 'd']) await first.put(k, bytesOf(200));
  await first.get('a'); // a is now the most recently used
  await first.flush();

  const second = idbCache(fake, { maxBytes: 1000, start: 2_000_000 });
  await second.ready();
  assert.equal(second.stats().entries, 4);
  assert.equal(second.stats().bytes, 800);
  assert.deepEqual(second.keys(), ['b', 'c', 'd', 'a']);
  assert.deepEqual([...(await second.get('c'))], [...bytesOf(200)]);
  await second.put('e', bytesOf(200));
  await second.put('f', bytesOf(200));
  assert.equal(await second.get('b'), null, 'b is evicted first: a was read after it');
  assert.ok(await second.get('a'));
});

test('stats() before ready() reports what is known so far and never throws', async () => {
  const fake = createFakeIndexedDB();
  await idbCache(fake).put('a', bytesOf(10));
  const cache = idbCache(fake);
  assert.equal(cache.stats().entries, 0);
  await cache.ready();
  assert.equal(cache.stats().entries, 1);
});

test('payloads without bookkeeping (an older build) are counted after a rebuild', async () => {
  const fake = createFakeIndexedDB();
  const first = idbCache(fake);
  await first.put('a', bytesOf(30));
  await first.put('b', bytesOf(50));
  fake.store(META_NAME).clear(); // as if the meta store had never been written
  const second = idbCache(fake);
  await second.ready();
  assert.equal(second.stats().entries, 2);
  assert.equal(second.stats().bytes, 80);
  assert.equal(fake.store(META_NAME).size, 2);
});

test('a database of the same name without our stores is upgraded, not replaced', async () => {
  const fake = createFakeIndexedDB();
  fake.dbs.set(DB_NAME, { version: 3, stores: new Map([['other', new Map([['x', 1]])]]) });
  const cache = idbCache(fake);
  assert.equal(await cache.put('a', bytesOf(5)), true);
  assert.equal(cache.kind, 'indexeddb');
  assert.equal(fake.dbs.get(DB_NAME).version, 4);
  assert.equal(fake.store('other').get('x'), 1);
  assert.equal(fake.store('cache').size, 1);
});

test('an entry written by another tab is found and adopted', async () => {
  const fake = createFakeIndexedDB();
  const mine = idbCache(fake);
  await mine.ready();
  const other = idbCache(fake);
  await other.put('shared', bytesOf(12, 5));
  assert.equal(mine.stats().entries, 0);
  assert.equal((await mine.get('shared'))[0], 5);
  assert.equal(mine.stats().entries, 1);
  assert.equal(mine.stats().bytes, 12);
});

// ---------------------------------------------------------------------------------------------
// Falling back to memory
// ---------------------------------------------------------------------------------------------

test('without IndexedDB (Node, old browsers) the cache works in memory', async () => {
  assert.equal(globalThis.indexedDB, undefined, 'this test assumes Node has no IndexedDB');
  const cache = createIdbCache({ log: quiet });
  assert.equal(await cache.put('a', bytesOf(10, 4)), true);
  assert.equal((await cache.get('a'))[0], 4);
  const s = cache.stats();
  assert.equal(s.kind, 'memory');
  assert.equal(s.persistent, false);
  assert.match(s.fallback, /not available/);
});

test('open() throwing (sandboxed opaque-origin frame) falls back to memory', async () => {
  const fake = createFakeIndexedDB();
  fake.control.throwOnOpen = named('SecurityError', 'The operation is insecure.');
  const logs = [];
  const cache = createIdbCache({ indexedDB: fake, log: (m) => logs.push(m), maxBytes: 4000, memoryMaxBytes: 1000 });
  assert.equal(await cache.put('a', bytesOf(100, 2)), true);
  assert.equal((await cache.get('a'))[0], 2);
  const s = cache.stats();
  assert.equal(s.kind, 'memory');
  assert.match(s.fallback, /insecure/);
  assert.equal(s.maxBytes, 1000, 'the memory cap applies');
  assert.equal(logs.length, 1);
  // The LRU rule is the same in memory.
  for (let i = 0; i < 12; i++) await cache.put(`k${i}`, bytesOf(100));
  assert.equal(cache.stats().bytes, 1000);
  assert.equal(await cache.get('a'), null);
});

test('open failing through onerror (private window) falls back to memory', async () => {
  const fake = createFakeIndexedDB();
  fake.control.failOpen = named('InvalidStateError', 'A mutation operation was attempted on a database that did not allow mutations.');
  const cache = createIdbCache({ indexedDB: fake, log: quiet });
  assert.equal(await cache.get('a'), null);
  assert.equal(await cache.put('a', bytesOf(3)), true);
  assert.ok(await cache.get('a'));
  assert.equal(cache.kind, 'memory');
});

test('an open that never answers times out into memory', async () => {
  const hanging = { open: () => ({}) }; // no event ever fires
  const cache = createIdbCache({ adapter: createIdbAdapter({ factory: hanging, openTimeoutMs: 20 }), log: quiet });
  assert.equal(await cache.put('a', bytesOf(3)), true);
  assert.equal(cache.kind, 'memory');
  assert.match(cache.stats().fallback, /in time/);
});

test('a write that fails moves the cache to memory and still stores the object', async () => {
  const fake = createFakeIndexedDB();
  const cache = idbCache(fake);
  await cache.put('before', bytesOf(10));
  fake.control.failPuts.push(named('UnknownError', 'Internal error opening backing store'));
  assert.equal(await cache.put('during', bytesOf(10, 8)), true);
  assert.equal(cache.kind, 'memory');
  assert.equal((await cache.get('during'))[0], 8);
  assert.equal(await cache.get('before'), null, 'what IndexedDB held is no longer consulted');
  assert.equal(fake.store('cache').has('during'), false, 'the failed transaction left nothing behind');
  assert.equal(fake.store('cache').has('before'), true);
});

test('a quota error lowers the cap, evicts and retries in IndexedDB', async () => {
  const fake = createFakeIndexedDB();
  const cache = idbCache(fake, { maxBytes: 10_000 });
  for (let i = 0; i < 8; i++) await cache.put(`k${i}`, bytesOf(100));
  fake.control.failPuts.push(named('QuotaExceededError'));
  assert.equal(await cache.put('new', bytesOf(100, 6)), true);
  const s = cache.stats();
  assert.equal(s.kind, 'indexeddb');
  assert.equal(s.maxBytes, 400);
  assert.ok(s.bytes <= 400);
  assert.equal((await cache.get('new'))[0], 6);
  assert.equal(await cache.get('k0'), null);
  assert.ok(await cache.get('k7'));
});

test('a second quota error in a row gives up on IndexedDB', async () => {
  const fake = createFakeIndexedDB();
  const cache = idbCache(fake, { maxBytes: 10_000 });
  await cache.put('a', bytesOf(100));
  fake.control.failPuts.push(named('QuotaExceededError'), named('QuotaExceededError'));
  assert.equal(await cache.put('b', bytesOf(100, 3)), true);
  assert.equal(cache.kind, 'memory');
  assert.equal((await cache.get('b'))[0], 3);
});

test('get never throws when the store fails; strict get rejects once', async () => {
  const fake = createFakeIndexedDB();
  const cache = idbCache(fake);
  await cache.put('fog/nside32.bin', bytesOf(16));
  fake.control.failGets.push(named('UnknownError', 'disk error'));
  assert.equal(await cache.get('fog/nside32.bin'), null);
  assert.equal(cache.kind, 'memory');

  const fake2 = createFakeIndexedDB();
  const cache2 = idbCache(fake2);
  await cache2.put('fog/nside32.bin', bytesOf(16));
  fake2.control.failGets.push(named('UnknownError', 'disk error'));
  await assert.rejects(cache2.get('fog/nside32.bin', { strict: true }), /disk error/);
  // "Unreachable" was not mistaken for "empty": the stored map is untouched.
  assert.equal(fake2.store('cache').get('fog/nside32.bin').u8.byteLength, 16);
  assert.equal(await cache2.get('fog/nside32.bin', { strict: true }), null, 'memory now, and empty');
});

test('an adapter that always rejects cannot make get, put, delete or clear throw', async () => {
  const boom = () => Promise.reject(new Error('boom'));
  const broken = { kind: 'indexeddb', open: boom, meta: boom, read: boom, write: boom, touch: boom, remove: boom, clear: boom };
  const cache = createIdbCache({ adapter: broken, log: quiet });
  assert.equal(await cache.get('a'), null);
  assert.equal(await cache.put('a', bytesOf(2)), true);
  assert.equal(await cache.delete('a'), true);
  assert.equal(await cache.clear(), true);
  assert.equal(cache.kind, 'memory');
});

test('failing to record "last used" times is harmless', async () => {
  const adapter = createMemoryAdapter();
  adapter.kind = 'indexeddb';
  adapter.touch = () => Promise.reject(new Error('nope'));
  const logs = [];
  const cache = createIdbCache({ adapter, log: (m) => logs.push(m) });
  await cache.put('a', bytesOf(2));
  await cache.get('a');
  await cache.flush();
  assert.equal(cache.kind, 'indexeddb');
  assert.ok(await cache.get('a'));
  assert.match(logs.join('\n'), /could not record cache use/);
});

// ---------------------------------------------------------------------------------------------
// Used as the proxy handler's cache
// ---------------------------------------------------------------------------------------------

test('"last used" writes are batched: reads do not cost a write each', async () => {
  const fake = createFakeIndexedDB();
  const cache = idbCache(fake);
  await cache.put('a', bytesOf(4));
  const before = fake.control.puts;
  for (let i = 0; i < 20; i++) await cache.get('a');
  assert.equal(fake.control.puts, before);
  await cache.flush();
  assert.equal(fake.control.puts, before + 1);
});

test('formatBytes reads naturally', () => {
  assert.equal(formatBytes(0), '0 MB');
  assert.equal(formatBytes(NaN), '0 MB');
  assert.equal(formatBytes(900), '900 bytes');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(57 * 1024), '57 KB');
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
  assert.equal(formatBytes(300 * 1024 * 1024), '300 MB');
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024), '2.00 GB');
});
