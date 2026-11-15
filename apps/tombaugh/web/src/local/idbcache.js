// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The proxy's cache interface (proxy/src/cache.js) on IndexedDB, for running the proxy handler
// inside the page:
//
//   const cache = createIdbCache({ maxBytes });        // default cap 300 MB
//   await cache.get(key, { maxAgeSeconds, strict }?)   -> Uint8Array | null
//   await cache.put(key, u8, contentType?)             -> true | false
//   await cache.delete(key)                            -> true | false
//   await cache.clear()                                -> true | false
//   cache.stats()                                      -> { kind, entries, bytes, maxBytes, hits,
//                                                           misses, evictions, persistent, fallback }
//   await cache.ready()                                   resolves once the index has been read
//
// Storage: database 'tombaugh', object store 'cache', values { u8, type, t } (t = write time, ms).
// A second small store, 'cache-meta', holds { k, n, a, t, type } per key (n = bytes, a = last
// use) so that sizes and recency are known at start-up without reading the payloads.
//
// Least-recently-used entries are dropped once the total passes the cap. One object larger than
// a quarter of the cap is not stored. get and put never throw (get(key, { strict: true }) is the
// one exception, as in the proxy caches: it rejects when the store could not be read).
//
// When IndexedDB is missing or throws (private windows, sandboxed opaque-origin iframes, a full
// disk), the cache carries on in memory with a smaller cap and says so in stats().fallback.
//
// IndexedDB itself is only touched in createIdbAdapter(); the LRU logic works on any adapter
// with the same seven methods, which is how it is unit-tested in Node.

export const DB_NAME = 'tombaugh';
export const STORE_NAME = 'cache';
export const META_NAME = 'cache-meta';
export const DEFAULT_MAX_BYTES = 300 * 1024 * 1024;
export const DEFAULT_MEMORY_BYTES = 64 * 1024 * 1024;

const defaultLog = (message) => {
  try {
    console.warn(`[tombaugh cache] ${message}`);
  } catch {
    // no console
  }
};

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return null;
}

function messageOf(err) {
  return err && err.message ? String(err.message) : String(err);
}

function isQuotaError(err) {
  const name = err && err.name ? String(err.name) : '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(messageOf(err));
}

// ---------------------------------------------------------------------------------------------
// Adapters: open(), meta(), read(key), write(key, value, meta, evict), touch(metas),
// remove(keys), clear(). All return promises and may reject.
// ---------------------------------------------------------------------------------------------

/** The in-memory stand-in: same interface, nothing survives a reload. */
export function createMemoryAdapter() {
  const values = new Map(); // key -> { u8, type, t }
  const metas = new Map(); //  key -> { k, n, a, t, type }
  return {
    kind: 'memory',
    async open() {},
    async meta() {
      return [...metas.values()].map((m) => ({ ...m }));
    },
    async read(key) {
      const value = values.get(key);
      return value ? { u8: value.u8.slice(), type: value.type, t: value.t } : undefined;
    },
    async write(key, value, meta, evict = []) {
      for (const k of evict) {
        values.delete(k);
        metas.delete(k);
      }
      values.set(key, { u8: value.u8.slice(), type: value.type, t: value.t });
      metas.set(key, { ...meta });
    },
    async touch(list) {
      for (const m of list) if (values.has(m.k)) metas.set(m.k, { ...m });
    },
    async remove(keys) {
      for (const k of keys) {
        values.delete(k);
        metas.delete(k);
      }
    },
    async clear() {
      values.clear();
      metas.clear();
    },
  };
}

/**
 * The IndexedDB adapter. `factory` is the IDBFactory to use (default globalThis.indexedDB; a
 * fake in tests). Every method rejects when the database cannot be used.
 */
export function createIdbAdapter({ dbName = DB_NAME, storeName = STORE_NAME, metaName = META_NAME, factory, openTimeoutMs = 4000 } = {}) {
  let dbPromise = null;

  function getFactory() {
    // Reading globalThis.indexedDB itself can throw in a sandboxed frame.
    const f = factory || globalThis.indexedDB;
    if (!f || typeof f.open !== 'function') throw new Error('IndexedDB is not available here');
    return f;
  }

  function openOnce(version) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => finish(reject, new Error('IndexedDB did not open in time')), openTimeoutMs);
      let request;
      try {
        request = version === undefined ? getFactory().open(dbName) : getFactory().open(dbName, version);
      } catch (err) {
        finish(reject, err);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        if (!db.objectStoreNames.contains(metaName)) db.createObjectStore(metaName);
      };
      request.onblocked = () => finish(reject, new Error('IndexedDB is blocked by another tab'));
      request.onerror = () => finish(reject, request.error || new Error('IndexedDB could not be opened'));
      request.onsuccess = () => {
        if (settled) {
          // Opened after the timeout: do not leave a connection behind.
          try {
            request.result.close();
          } catch {
            // nothing to close
          }
          return;
        }
        finish(resolve, request.result);
      };
    });
  }

  function open() {
    if (!dbPromise) {
      dbPromise = (async () => {
        let db = await openOnce();
        if (!db.objectStoreNames.contains(storeName) || !db.objectStoreNames.contains(metaName)) {
          // A database of this name without our stores (older build, another module): add them.
          const next = (Number(db.version) || 1) + 1;
          db.close();
          db = await openOnce(next);
        }
        db.onversionchange = () => {
          // Another tab wants to upgrade or delete: let go, reopen on the next call.
          try {
            db.close();
          } catch {
            // already closed
          }
          dbPromise = null;
        };
        return db;
      })();
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  }

  /** Runs `body(tx, out)` in one transaction and resolves `out` when the transaction completes. */
  async function transact(names, mode, body) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const out = {};
      let tx;
      try {
        tx = db.transaction(names, mode);
      } catch (err) {
        dbPromise = null; // the connection may have been closed under us
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction was aborted'));
      try {
        body(tx, out);
      } catch (err) {
        try {
          tx.abort();
        } catch {
          // already finished
        }
        reject(err);
      }
    });
  }

  /** Rebuilds 'cache-meta' from the payload store (after a build that did not write it). */
  async function rebuildMeta() {
    const { keys } = await transact([storeName], 'readonly', (tx, out) => {
      const request = tx.objectStore(storeName).getAllKeys();
      request.onsuccess = () => {
        out.keys = request.result || [];
      };
    });
    const metas = [];
    for (const key of keys) {
      const { value } = await transact([storeName], 'readonly', (tx, out) => {
        const request = tx.objectStore(storeName).get(key);
        request.onsuccess = () => {
          out.value = request.result;
        };
      });
      const n = value && value.u8 && Number.isFinite(value.u8.byteLength) ? value.u8.byteLength : 0;
      const t = value && Number.isFinite(value.t) ? value.t : 0;
      metas.push({ k: String(key), n, a: t, t, type: value && value.type ? String(value.type) : '' });
    }
    await transact([metaName], 'readwrite', (tx) => {
      const store = tx.objectStore(metaName);
      store.clear();
      for (const m of metas) store.put(m, m.k);
    });
    return metas;
  }

  return {
    kind: 'indexeddb',
    async open() {
      await open();
    },
    async meta() {
      const { metas, count } = await transact([storeName, metaName], 'readonly', (tx, out) => {
        const all = tx.objectStore(metaName).getAll();
        all.onsuccess = () => {
          out.metas = all.result || [];
        };
        const counted = tx.objectStore(storeName).count();
        counted.onsuccess = () => {
          out.count = counted.result;
        };
      });
      if (metas.length === count) return metas;
      return rebuildMeta();
    },
    async read(key) {
      const { value } = await transact([storeName], 'readonly', (tx, out) => {
        const request = tx.objectStore(storeName).get(key);
        request.onsuccess = () => {
          out.value = request.result;
        };
      });
      return value || undefined;
    },
    async write(key, value, meta, evict = []) {
      await transact([storeName, metaName], 'readwrite', (tx) => {
        const store = tx.objectStore(storeName);
        const metaStore = tx.objectStore(metaName);
        for (const k of evict) {
          store.delete(k);
          metaStore.delete(k);
        }
        store.put(value, key);
        metaStore.put(meta, key);
      });
    },
    async touch(list) {
      if (!list.length) return;
      await transact([metaName], 'readwrite', (tx) => {
        const metaStore = tx.objectStore(metaName);
        for (const m of list) metaStore.put(m, m.k);
      });
    },
    async remove(keys) {
      if (!keys.length) return;
      await transact([storeName, metaName], 'readwrite', (tx) => {
        const store = tx.objectStore(storeName);
        const metaStore = tx.objectStore(metaName);
        for (const k of keys) {
          store.delete(k);
          metaStore.delete(k);
        }
      });
    },
    async clear() {
      await transact([storeName, metaName], 'readwrite', (tx) => {
        tx.objectStore(storeName).clear();
        tx.objectStore(metaName).clear();
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------------------------

/**
 * createIdbCache(options) -> cache (see the top of this file).
 *
 * options (all optional): maxBytes (300 MB); memoryMaxBytes (cap after falling back to memory,
 * default the smaller of maxBytes and 64 MB); adapter (default: IndexedDB when the page has it,
 * otherwise memory); indexedDB (an IDBFactory for the default adapter); dbName, storeName; now;
 * log; touchDelayMs (how long "last used" times are batched before they are written, 1500).
 */
export function createIdbCache(options = {}) {
  const {
    maxBytes = DEFAULT_MAX_BYTES,
    dbName = DB_NAME,
    storeName = STORE_NAME,
    now = Date.now,
    log = defaultLog,
    touchDelayMs = 1500,
  } = options;
  const memoryMaxBytes = Number.isFinite(options.memoryMaxBytes) ? options.memoryMaxBytes : Math.min(maxBytes, DEFAULT_MEMORY_BYTES);

  let adapter = options.adapter || null;
  let fallback = null; // why the cache is in memory, when it did not start there by choice
  if (!adapter) {
    let hasIdb = false;
    try {
      hasIdb = Boolean(options.indexedDB || globalThis.indexedDB);
    } catch {
      hasIdb = false;
    }
    if (hasIdb) adapter = createIdbAdapter({ dbName, storeName, factory: options.indexedDB });
    else {
      adapter = createMemoryAdapter();
      fallback = 'IndexedDB is not available here';
    }
  }

  let cap = adapter.kind === 'memory' ? Math.min(maxBytes, memoryMaxBytes) : maxBytes;
  const index = new Map(); // key -> { k, n, a, t, type }, least recently used first
  let total = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;
  let readyPromise = null;
  let writeChain = Promise.resolve();
  const touched = new Map();
  let touchTimer = null;

  function setEntry(meta) {
    const old = index.get(meta.k);
    if (old) {
      total -= old.n;
      index.delete(meta.k);
    }
    index.set(meta.k, meta);
    total += meta.n;
  }

  function dropEntry(key) {
    const old = index.get(key);
    if (!old) return false;
    total -= old.n;
    index.delete(key);
    touched.delete(key);
    return true;
  }

  /** Moves everything to memory. What IndexedDB held is left where it is, just not used. */
  function fallBack(err) {
    if (adapter.kind === 'memory') return;
    fallback = messageOf(err) || 'IndexedDB failed';
    log(`IndexedDB cannot be used (${fallback}); caching in memory instead`);
    adapter = createMemoryAdapter();
    cap = Math.min(maxBytes, memoryMaxBytes);
    index.clear();
    touched.clear();
    total = 0;
  }

  function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
        try {
          await adapter.open();
          const metas = await adapter.meta();
          metas.sort((a, b) => (a.a || 0) - (b.a || 0));
          for (const m of metas) {
            if (!m || typeof m.k !== 'string') continue;
            setEntry({ k: m.k, n: Number(m.n) || 0, a: Number(m.a) || 0, t: Number(m.t) || 0, type: m.type || '' });
          }
        } catch (err) {
          fallBack(err);
        }
      })();
    }
    return readyPromise;
  }

  function scheduleTouch(meta) {
    touched.set(meta.k, meta);
    if (touchTimer !== null) return;
    touchTimer = setTimeout(() => {
      touchTimer = null;
      flush().catch(() => {});
    }, touchDelayMs);
    if (touchTimer && typeof touchTimer.unref === 'function') touchTimer.unref();
  }

  /** Writes the batched "last used" times now. */
  async function flush() {
    if (touchTimer !== null) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
    if (!touched.size) return;
    const list = [...touched.values()].map((m) => ({ ...m }));
    touched.clear();
    try {
      await adapter.touch(list);
    } catch (err) {
      log(`could not record cache use: ${messageOf(err)}`); // only costs eviction order
    }
  }

  /** Keys to drop, oldest first, so that `incoming` more bytes fit under the cap. */
  function evictionsFor(key, incoming, limit) {
    const old = index.get(key);
    let after = total - (old ? old.n : 0) + incoming;
    const out = [];
    for (const [k, m] of index) {
      if (after <= limit) break;
      if (k === key) continue;
      out.push(k);
      after -= m.n;
    }
    return out;
  }

  function enqueue(task) {
    const run = writeChain.then(task, task);
    writeChain = run.catch(() => {});
    return run;
  }

  async function get(key, { maxAgeSeconds, strict = false } = {}) {
    try {
      await ready();
      if (typeof key !== 'string' || !key) return null;
      let value;
      try {
        value = await adapter.read(key);
      } catch (err) {
        fallBack(err);
        if (strict) throw err instanceof Error ? err : new Error(String(err));
        misses += 1;
        return null;
      }
      if (!value || !value.u8) {
        dropEntry(key);
        misses += 1;
        return null;
      }
      const bytes = toBytes(value.u8);
      if (!bytes) {
        misses += 1;
        return null;
      }
      if (Number.isFinite(maxAgeSeconds) && !(now() - Number(value.t) <= maxAgeSeconds * 1000)) {
        misses += 1;
        return null;
      }
      // Most recently used goes last. An entry another tab wrote is adopted here.
      const meta = { k: key, n: bytes.byteLength, a: now(), t: Number(value.t) || 0, type: value.type || '' };
      setEntry(meta);
      scheduleTouch(meta);
      hits += 1;
      return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
    } catch (err) {
      if (strict) throw err;
      log(`get ${key} failed: ${messageOf(err)}`);
      return null;
    }
  }

  function put(key, data, contentType = 'application/octet-stream') {
    return enqueue(async () => {
      try {
        await ready();
        const bytes = toBytes(data);
        if (typeof key !== 'string' || !key || !bytes) return false;
        const n = bytes.byteLength;
        if (n > cap / 4) return false;
        const t = now();
        const tight = bytes.byteOffset === 0 && n === bytes.buffer.byteLength;
        const value = { u8: tight ? bytes : bytes.slice(), type: String(contentType || ''), t };
        const meta = { k: key, n, a: t, t, type: value.type };

        const attempt = async (limit) => {
          const evict = evictionsFor(key, n, limit);
          await adapter.write(key, value, meta, evict);
          for (const k of evict) if (dropEntry(k)) evictions += 1;
          setEntry(meta);
          touched.delete(key);
        };

        try {
          await attempt(cap);
          return true;
        } catch (err) {
          if (adapter.kind !== 'memory' && isQuotaError(err) && index.size > 0) {
            // The browser allows less than our cap: live within half of what is stored now.
            const smaller = Math.max(4 * n, Math.floor(total / 2));
            log(`storage quota reached at ${total} bytes; lowering the cache cap to ${smaller} bytes`);
            cap = Math.min(cap, smaller);
            try {
              await attempt(cap);
              return true;
            } catch (again) {
              fallBack(again);
            }
          } else {
            fallBack(err);
          }
        }
        // Now in memory (or it was memory that failed, which it does not).
        if (n > cap / 4) return false;
        await attempt(cap);
        return true;
      } catch (err) {
        log(`put ${key} failed: ${messageOf(err)}`);
        return false;
      }
    });
  }

  function remove(key) {
    return enqueue(async () => {
      try {
        await ready();
        const had = index.has(key);
        try {
          await adapter.remove([key]);
        } catch (err) {
          fallBack(err);
          return false;
        }
        dropEntry(key);
        return had;
      } catch (err) {
        log(`delete ${key} failed: ${messageOf(err)}`);
        return false;
      }
    });
  }

  function clear() {
    return enqueue(async () => {
      try {
        await ready();
        try {
          await adapter.clear();
        } catch (err) {
          fallBack(err);
        }
        index.clear();
        touched.clear();
        total = 0;
        return true;
      } catch (err) {
        log(`clear failed: ${messageOf(err)}`);
        return false;
      }
    });
  }

  return {
    get kind() {
      return adapter.kind;
    },
    get,
    put,
    delete: remove,
    clear,
    flush,
    ready,
    /** Counts since this page loaded, sizes as far as the index has been read (see ready()). */
    stats() {
      return {
        kind: adapter.kind,
        persistent: adapter.kind === 'indexeddb',
        entries: index.size,
        bytes: total,
        maxBytes: cap,
        hits,
        misses,
        evictions,
        fallback,
      };
    },
    /** Keys from least to most recently used (for tests and debugging). */
    keys() {
      return [...index.keys()];
    },
  };
}

/** "12.3 MB" and friends, for the cache line in the data-source panel. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n < 1024) return `${Math.round(n)} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
