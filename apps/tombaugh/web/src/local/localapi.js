// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The proxy, running inside the page.
//
//   createLocalApi({ backend, cache, fetchImpl, handlerFactory, indexSource })
//
// returns an object with exactly the methods and return shapes of createApi() in ../api.js
// (search, cutout, gaia, resolve, health, fog, fogMark, identify, ephemeris, track, ..., baseUrl:
// whatever createApi has, because it is one), but instead of sending HTTP
// requests to the proxy it hands Request objects to the proxy's own handler
// (proxy/src/handler.js, which uses only Web-standard APIs) and decodes the Response with
// api.js itself: the local api IS a createApi() whose fetch is the handler.
//
//   backend 'synthetic'   the practice sky of proxy/fixtures/synth.js. No network at all.
//                         Every search answer carries `simulated: true`.
//   backend 's3'          SPHEREx files read straight from NASA's public bucket on AWS Open
//                         Data with Range requests (about 1.5 MB per exposure). The handler's
//                         own 's3' backend does the work; this module adds only the place the
//                         exposure-index files are read from (`indexSource`).
//
// The proxy code is loaded with dynamic import() on first use, so a page that never leaves the
// remote proxy does not evaluate it. If it cannot be loaded, every call rejects with an
// ApiError (status 503, retryable false) that says so, and ready() rejects with LocalModeError.

import { createApi } from '../api.js';
import { createIdbCache } from './idbcache.js';

/** Thrown by ready() (and wrapped into ApiError by the api methods) when local mode cannot run. */
export class LocalModeError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'LocalModeError';
    this.retryable = false;
    this.status = 503;
    if (cause) this.cause = cause;
  }
}

/** createApi needs absolute URLs and the handler routes on the last path segment; nothing is ever sent here. */
const LOCAL_ORIGIN = 'https://local.tombaugh.invalid';

const messageOf = (err) => (err && err.message ? String(err.message) : String(err));

let proxyModules = null;

/** The proxy modules every backend needs: { handler, cache }. Loaded once. */
export function loadProxyModules() {
  if (!proxyModules) {
    proxyModules = Promise.all([import('../../../proxy/src/handler.js'), import('../../../proxy/src/cache.js')]).then(
      ([handler, cache]) => ({ handler, cache }),
      (err) => {
        proxyModules = null;
        throw new LocalModeError(`This copy of Tombaugh does not include the in-page data service (proxy/src could not be loaded: ${messageOf(err)})`, err);
      },
    );
  }
  return proxyModules;
}

/** The synthetic sky. The handler would find it by URL; a bundle needs it handed in. */
function loadSynth() {
  return import('../../../proxy/fixtures/synth.js').catch((err) => {
    throw new LocalModeError(`The practice sky is not part of this build (proxy/fixtures/synth.js could not be loaded: ${messageOf(err)})`, err);
  });
}

function abortError() {
  try {
    return new DOMException('Request cancelled', 'AbortError');
  } catch {
    const err = new Error('Request cancelled');
    err.name = 'AbortError';
    return err;
  }
}

function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

const errorResponse = (status, message, retryable = false) => jsonResponse({ error: String(message), retryable: Boolean(retryable) }, status);

// ---------------------------------------------------------------------------------------------
// The exposure index, read through the page's cache
// ---------------------------------------------------------------------------------------------

const INDEX_PREFIX = 'index/';
const INDEX_LIST_TTL_S = 3600; //        manifest.json and dirs.json change while the index grows
const INDEX_DATA_TTL_S = 7 * 86400; //   a directory's exposures change only with a new version

/** Objects stored through the proxy's Supabase cache start with a 16-byte "TBC1" age prefix. */
function stripCachePrefix(bytes) {
  if (bytes.byteLength >= 16 && bytes[0] === 0x54 && bytes[1] === 0x42 && bytes[2] === 0x43 && bytes[3] === 0x31 && bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0) {
    return bytes.slice(16);
  }
  return bytes;
}

/**
 * indexSource -> (key) => Promise<Uint8Array|null>. A string is a URL prefix (`<prefix>/<key>`,
 * for example `<prefix>/index/v1/manifest.json`); a function is used as it is; anything else
 * means "no index published".
 */
export function makeIndexSource(indexSource, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof indexSource === 'function') {
    return async (key) => {
      const data = await indexSource(key);
      if (!data) return null;
      return stripCachePrefix(data instanceof Uint8Array ? data : new Uint8Array(data));
    };
  }
  if (typeof indexSource !== 'string' || !indexSource) return null;
  const prefix = indexSource.replace(/\/+$/, '');
  return async (key) => {
    const response = await fetchImpl(`${prefix}/${key.split('/').map(encodeURIComponent).join('/')}`, { method: 'GET', credentials: 'omit' });
    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok) throw new Error(`the exposure index answered ${response.status} for ${key}`);
    return stripCachePrefix(new Uint8Array(await response.arrayBuffer()));
  };
}

/**
 * A cache whose `index/...` keys are filled from the published index on a miss (or when the
 * local copy is old) and kept locally; when the index cannot be reached, an old local copy is
 * better than nothing. Everything else passes straight through.
 */
export function withIndexSource(cache, source, { log = () => {} } = {}) {
  if (!source) return cache;
  const inflight = new Map();
  const fetchOnce = (key) => {
    let pending = inflight.get(key);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => source(key))
        .finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return pending;
  };
  return {
    ...cache,
    kind: cache.kind,
    async get(key, opts) {
      if (typeof key !== 'string' || !key.startsWith(INDEX_PREFIX)) return cache.get(key, opts);
      const ttl = /\/(manifest|dirs)\.json$/.test(key) ? INDEX_LIST_TTL_S : INDEX_DATA_TTL_S;
      const fresh = await cache.get(key, { maxAgeSeconds: ttl });
      if (fresh) return fresh;
      try {
        const bytes = await fetchOnce(key);
        if (bytes) {
          await cache.put(key, bytes, key.endsWith('.json') ? 'application/json' : 'application/octet-stream');
          return bytes.slice();
        }
      } catch (err) {
        log(`exposure index: ${key} could not be fetched (${messageOf(err)})`);
      }
      return cache.get(key); // an old copy, if there is one
    },
    put: (key, bytes, type) => cache.put(key, bytes, type),
    delete: (key) => (typeof cache.delete === 'function' ? cache.delete(key) : Promise.resolve(false)),
  };
}

// ---------------------------------------------------------------------------------------------
// createLocalApi
// ---------------------------------------------------------------------------------------------

const offline = () => Promise.reject(new TypeError('The practice sky makes no network requests'));

/**
 * createLocalApi({ backend = 'synthetic', cache, fetchImpl, handlerFactory, indexSource, log,
 *                  latencyMs = 0, version })
 *
 * cache            the proxy cache interface (default: createIdbCache(), IndexedDB with an
 *                  in-memory fallback)
 * fetchImpl        for the 's3' backend (default: the page's fetch). Never used by 'synthetic'.
 * handlerFactory   (options) -> handler | Promise<handler>, where handler is
 *                  async (Request) => Response. Default: createHandler from proxy/src/handler.js,
 *                  loaded lazily. It receives { backend, cache, fetchImpl, log, deps, ... }.
 * indexSource      's3' only: where the exposure index can be read (see makeIndexSource)
 *
 * Returns the createApi() interface plus: backend, simulated, cache, ready() (resolves true
 * once the handler exists; rejects with LocalModeError if it cannot be built).
 */
export function createLocalApi({
  backend = 'synthetic',
  cache = null,
  fetchImpl = null,
  handlerFactory = null,
  indexSource = null,
  log = () => {},
  latencyMs = 0,
  version,
} = {}) {
  if (backend !== 'synthetic' && backend !== 's3') throw new LocalModeError(`Unknown local backend "${backend}" (use "synthetic" or "s3")`);
  const simulated = backend === 'synthetic';
  const store = cache || createIdbCache();
  const netFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  let handlerPromise = null;
  let hasIndex = false;

  async function buildHandler() {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      throw new LocalModeError('The in-page data service needs a secure page (https or localhost): this browser hides its hashing functions here');
    }
    const mods = handlerFactory ? null : await loadProxyModules();
    const factory = handlerFactory || mods.handler.createHandler;
    const handlerOptions = { syntheticLatencyMs: latencyMs };
    if (version) handlerOptions.version = version;
    if (simulated) {
      const deps = handlerFactory ? undefined : { synth: await loadSynth() };
      return factory({ ...handlerOptions, backend: 'synthetic', cache: store, fetchImpl: offline, log, ...(deps ? { deps } : {}) });
    }
    // The handler runs the 's3' backend itself (exposure index, Range cutouts, IRSA as its
    // fallback). The one thing a page adds is where the index files come from.
    const source = makeIndexSource(indexSource, { fetchImpl: netFetch });
    hasIndex = Boolean(source);
    return factory({ ...handlerOptions, backend: 's3', cache: withIndexSource(store, source, { log }), fetchImpl: netFetch, log });
  }

  function getHandler() {
    if (!handlerPromise) {
      handlerPromise = Promise.resolve()
        .then(buildHandler)
        .then((handler) => {
          if (typeof handler !== 'function') throw new LocalModeError('The in-page data service did not start (no handler)');
          return handler;
        })
        .catch((err) => {
          handlerPromise = null; // a later call may try again
          throw err instanceof LocalModeError ? err : new LocalModeError(`The in-page data service could not start: ${messageOf(err)}`, err);
        });
    }
    return handlerPromise;
  }

  /** What createApi() uses as its fetch: the handler, in this page. */
  async function localFetch(url, init = {}) {
    const signal = init.signal || null;
    if (signal && signal.aborted) throw abortError();
    let handler;
    try {
      handler = await getHandler();
    } catch (err) {
      return errorResponse(503, messageOf(err), false);
    }
    const method = String(init.method || 'GET').toUpperCase();
    const requestInit = { method };
    if (init.headers) requestInit.headers = init.headers;
    if (init.body !== undefined && init.body !== null && method !== 'GET' && method !== 'HEAD') requestInit.body = init.body;
    const work = Promise.resolve()
      .then(() => handler(new Request(url, requestInit)))
      .then((response) => explainSearchFailure(url, response));
    return withAbort(work, signal);
  }

  /**
   * Direct mode without a published index: the handler falls back to the archive's own search,
   * which a browser usually cannot reach. Say what is missing instead of "request failed".
   */
  async function explainSearchFailure(url, response) {
    if (simulated || hasIndex || response.status < 500 || !/\/search(\?|$)/.test(String(url))) return response;
    let detail = '';
    try {
      const body = await response.clone().json();
      if (body && typeof body.error === 'string') detail = body.error;
    } catch {
      // keep the general explanation
    }
    return errorResponse(
      503,
      `Direct mode has no exposure index to search: no public copy of the index is configured for this page (TOMBAUGH_INDEX), and the archive's own search did not answer from here${detail ? ` (${detail})` : ''}`,
      false,
    );
  }

  const inner = createApi(`${LOCAL_ORIGIN}/${backend}`, { fetchImpl: localFetch });
  return {
    ...inner,
    baseUrl: `local:${backend}`,
    backend,
    simulated,
    cache: store,
    ready: () => getHandler().then(() => true),
    async search(ra, dec, opts) {
      const body = await inner.search(ra, dec, opts);
      return simulated ? { ...body, simulated: true } : body;
    },
  };
}
