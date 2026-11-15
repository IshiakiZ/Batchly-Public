// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Which data source the page uses, and switching between them.
//
//   proxy     the small relay (web/src/api.js createApi): about 50 KB per exposure
//   direct    the proxy's own code running in this page, reading NASA's public copy of the
//             SPHEREx files on AWS Open Data: about 1.5 MB per exposure, needs no backend
//   practice  the synthetic sky generated in this page: simulated, needs no network at all
//
// chooseDataSource({ url, health, directAllowed })   pure decision table
// probeBucket({ fetchImpl })                          may this page read the public bucket?
// createAutoApi({ remote, makeLocal, probe, url })    an api object with the interface of
//     createApi() that starts on the proxy and moves to `direct` by itself when the proxy stops
//     answering; `?source=proxy|direct|practice` in the URL pins a source.
// createPageApi({ remote, win })                      the same, wired for the real page.
//
// This file is deliberately small and imports nothing heavy: the proxy code behind `direct`
// and `practice` is only loaded (by ./localapi.js) when one of them is first used.

export const SOURCE_IDS = ['proxy', 'direct', 'practice'];

/** Plain descriptions, shown in the data-source panel. */
export const SOURCES = {
  proxy: {
    id: 'proxy',
    label: 'Proxy on batch-ly.com',
    short: 'Proxy',
    description:
      'A small relay asks the archive for each exposure and passes on only the pixels around your position: about 50 KB per exposure. The normal way to use Tombaugh.',
  },
  direct: {
    id: 'direct',
    label: "Direct from NASA's public cloud copy",
    short: 'Direct',
    description:
      'Your browser reads the SPHEREx files itself, from the public copy on AWS Open Data. Same data, no relay needed, but about 1.5 MB per exposure instead of 50 KB, so it is slower.',
  },
  practice: {
    id: 'practice',
    label: 'Practice sky: simulated',
    short: 'Practice',
    description:
      'A made-up patch of sky generated in this page. Nothing in it was observed by SPHEREx. A fast mover, a variable star and a methane-rich object are planted in it, so you can test what you find against the truth. Needs no connection.',
  },
};

/** Backend name that ./localapi.js uses for a source. */
export const LOCAL_BACKEND = { direct: 's3', practice: 'synthetic' };

/** A tiny public object in the bucket (CONTRACT-S3.md): one byte of it is the probe. */
export const BUCKET_PROBE_URL = 'https://nasa-irsa-spherex.s3.amazonaws.com/index.html';

const ALIASES = { proxy: 'proxy', remote: 'proxy', direct: 'direct', s3: 'direct', practice: 'practice', synthetic: 'practice' };

/** The proxy label names the host actually in use ("Proxy on batch-ly.com", "Proxy on localhost"). */
export function sourceLabel(source, baseUrl = '') {
  const info = SOURCES[source];
  if (!info) return String(source);
  if (source !== 'proxy' || !baseUrl || /batch-ly\.com/i.test(baseUrl)) return info.label;
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(String(baseUrl));
  return m ? `Proxy on ${m[1]}` : 'Proxy on this server';
}

/**
 * `?source=` of a URL: 'proxy' | 'direct' | 'practice', or null when absent or not understood.
 * Accepts a URL string, a query string, a URL, or a Location-like { search }.
 */
export function parseSourceParam(url) {
  let search = '';
  try {
    if (url && typeof url === 'object' && typeof url.search === 'string') search = url.search;
    else if (typeof url === 'string') {
      const hash = url.indexOf('#');
      const text = hash >= 0 ? url.slice(0, hash) : url;
      const q = text.indexOf('?');
      search = q >= 0 ? text.slice(q) : '';
    }
    const value = new URLSearchParams(search).get('source');
    if (!value) return null;
    return ALIASES[value.trim().toLowerCase()] || null;
  } catch {
    return null;
  }
}

/** The URL with `?source=` set (or removed for null), everything else kept. */
export function withSourceParam(url, source) {
  const text = String(url || '');
  const hashAt = text.indexOf('#');
  const hash = hashAt >= 0 ? text.slice(hashAt) : '';
  const rest = hashAt >= 0 ? text.slice(0, hashAt) : text;
  const q = rest.indexOf('?');
  const path = q >= 0 ? rest.slice(0, q) : rest;
  const params = new URLSearchParams(q >= 0 ? rest.slice(q + 1) : '');
  if (source) params.set('source', source);
  else params.delete('source');
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ''}${hash}`;
}

/** 'ok' | 'failed' | 'unknown' from a /health body, a boolean, an Error, or nothing. */
export function healthState(health) {
  if (health === undefined || health === null) return 'unknown';
  if (health === true) return 'ok';
  if (health === false || health instanceof Error) return 'failed';
  if (typeof health === 'object') return health.ok === true ? 'ok' : 'failed';
  return 'unknown';
}

/**
 * The decision table. Inputs: the page URL, what is known about the proxy's /health (see
 * healthState), and whether the page may reach the bucket (true | false | undefined = not
 * probed). Returns { source, forced, reason, needsProbe? }.
 *
 *   ?source=x in the URL            -> x, forced (never changed automatically)
 *   proxy healthy or not yet known  -> proxy
 *   proxy failed, bucket reachable  -> direct
 *   proxy failed, bucket blocked    -> proxy (nothing better; never the practice sky by itself:
 *                                      simulated data is only ever shown when asked for)
 *   proxy failed, bucket not probed -> proxy, needsProbe
 */
export function chooseDataSource({ url = '', health, directAllowed } = {}) {
  const forced = parseSourceParam(url);
  if (forced) return { source: forced, forced: true, reason: 'url' };
  const state = healthState(health);
  if (state !== 'failed') return { source: 'proxy', forced: false, reason: state === 'ok' ? 'proxy-ok' : 'default' };
  if (directAllowed === true) return { source: 'direct', forced: false, reason: 'proxy-down' };
  if (directAllowed === false) return { source: 'proxy', forced: false, reason: 'proxy-down-direct-blocked' };
  return { source: 'proxy', forced: false, reason: 'proxy-down-direct-unknown', needsProbe: true };
}

/**
 * Is this failure of a proxy call a reason to leave the proxy?
 *   'switch'  a search or health call that hit a network error or a 5xx
 *   'verify'  any other call that hit a network error: ask /health before deciding
 *   null      everything else (cancelled, 4xx, a bad frame, a 5xx for one cutout)
 */
export function failoverVerdict(err, method = 'search') {
  if (!err || err.aborted === true || err.name === 'AbortError') return null;
  const status = Number(err.status) || 0;
  const networkLike = status === 0 && err.retryable !== false;
  if (method === 'search' || method === 'health') return networkLike || status >= 500 ? 'switch' : null;
  return networkLike ? 'verify' : null;
}

/**
 * May this page read the public bucket? One request for the first byte of a small object.
 * A network failure or a Content-Security-Policy block both reject the fetch and both mean
 * "not allowed". A 200 (the range was ignored) also counts as not allowed: without byte ranges
 * every exposure would be a 65 MB download.
 */
export async function probeBucket({ fetchImpl = globalThis.fetch, url = BUCKET_PROBE_URL, timeoutMs = 6000 } = {}) {
  let timer = null;
  try {
    if (typeof fetchImpl !== 'function') return { allowed: false, status: 0, reason: 'no fetch in this page' };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    });
    try {
      if (response.body && typeof response.body.cancel === 'function') await response.body.cancel();
    } catch {
      // nothing to release
    }
    if (response.status === 206) return { allowed: true, status: 206, reason: 'ok' };
    return { allowed: false, status: response.status, reason: response.status === 200 ? 'byte ranges are not honoured' : `the bucket answered ${response.status}` };
  } catch (err) {
    return { allowed: false, status: 0, reason: err && err.name === 'AbortError' ? 'no answer in time' : 'blocked or unreachable' };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

const defaultLog = (message) => {
  try {
    console.warn(`[tombaugh] ${message}`);
  } catch {
    // no console
  }
};

const MESSAGES = {
  failover:
    "The Tombaugh proxy is not answering, so this page now reads the SPHEREx files straight from NASA's public cloud copy. Same data; each exposure is about 1.5 MB instead of 50 KB, so loading is slower.",
  direct: "Reading the SPHEREx files straight from NASA's public cloud copy: about 1.5 MB per exposure instead of 50 KB, so loading is slower.",
  practice: 'Practice sky: everything shown is simulated. Nothing here was observed by SPHEREx.',
  proxy: 'Using the Tombaugh proxy.',
  blocked: "The Tombaugh proxy is not answering, and this page is not allowed to reach NASA's public cloud copy either. The practice sky still works: it needs no connection.",
};

/**
 * createAutoApi({ remote, makeLocal, probe, url, onChange, eager, healthTimeoutMs, cache })
 *   -> api with exactly the methods of `remote` (search, cutout, gaia, resolve, health, fog,
 *      fogMark, ...), a live `baseUrl`, and `dataSource` (the controller, below).
 *
 * remote      the createApi() instance for the proxy
 * makeLocal   (backend: 's3' | 'synthetic') -> api | Promise<api>, called at most once each
 * probe       () -> Promise<{ allowed }> (default probeBucket)
 * url         the page URL; `?source=` pins a source
 * onChange    ({ source, previous, reason, forced, message }) whenever the source changes
 * eager       check the proxy's /health right away (default true; skipped when pinned)
 * cache       optional () -> cache | Promise<cache>, only handed on through dataSource.cache()
 * log         (message) for things that went wrong but do not matter (default console.warn)
 *
 * Automatic move to `direct` (only while on an unpinned proxy): /health fails; or a search
 * fails with a network error or a 5xx; or another call fails with a network error and /health
 * confirms that the proxy is gone. The bucket must be reachable (probe). The failed call is
 * repeated on `direct`; if that fails as well the caller gets the proxy's error, since that is
 * the one worth reading, and the page stays where it was.
 *
 * dataSource: current(), use(source), onChange(fn) -> unsubscribe, lastChange(), sources(),
 *   apiFor(source), probe(), checkProxy(), cache(), settled().
 */
export function createAutoApi({
  remote,
  makeLocal,
  probe = () => probeBucket(),
  url = '',
  onChange = null,
  eager = true,
  healthTimeoutMs = 8000,
  cache = null,
  now = Date.now,
  log = defaultLog,
} = {}) {
  if (!remote || typeof remote.search !== 'function') throw new TypeError('createAutoApi: `remote` must be an api object');
  const first = chooseDataSource({ url });
  const state = {
    source: first.source,
    forced: first.forced, //    pinned by the URL or chosen by hand: no automatic changes
    reason: first.reason,
    since: now(),
    proxyAlive: null, //        true | false | null (not known)
    directAllowed: null, //     true | false | null (not probed)
    note: '', //                why an automatic move could not happen
  };
  const listeners = new Set();
  if (typeof onChange === 'function') listeners.add(onChange);
  let last = null;
  const locals = new Map(); // backend -> Promise<api>
  const resolved = new Map(); // source -> api, once known
  resolved.set('proxy', remote);

  /** Not worth retrying: the loader and the shell read `retryable` to decide what to say. */
  const cannotRun = (message, cause) => Object.assign(new Error(message), { name: 'LocalModeError', status: 503, retryable: false, cause });

  function apiFor(source) {
    if (source === 'proxy') return Promise.resolve(remote);
    const backend = LOCAL_BACKEND[source];
    if (!backend) return Promise.reject(cannotRun(`Unknown data source "${source}"`));
    if (typeof makeLocal !== 'function') return Promise.reject(cannotRun('This build cannot run the data service inside the page'));
    let promise = locals.get(backend);
    if (!promise) {
      promise = Promise.resolve()
        .then(() => makeLocal(backend))
        .then(
          (api) => {
            if (!api || typeof api.search !== 'function') throw cannotRun('The in-page data service did not start');
            resolved.set(source, api);
            return api;
          },
          (err) => {
            throw cannotRun(`The in-page data service could not be started: ${err && err.message ? err.message : err}`, err);
          },
        );
      locals.set(backend, promise);
      promise.catch(() => {
        if (locals.get(backend) === promise) locals.delete(backend); // allow another try
      });
    }
    return promise;
  }

  function snapshot() {
    const api = resolved.get(state.source);
    const baseUrl = api ? api.baseUrl : `local:${LOCAL_BACKEND[state.source]}`;
    return {
      source: state.source,
      forced: state.forced,
      reason: state.reason,
      since: state.since,
      simulated: state.source === 'practice',
      label: sourceLabel(state.source, remote.baseUrl),
      description: SOURCES[state.source].description,
      baseUrl,
      proxyAlive: state.proxyAlive,
      directAllowed: state.directAllowed,
      note: state.note,
    };
  }

  function setSource(source, { reason, forced, message }) {
    const previous = state.source;
    state.source = source;
    state.reason = reason;
    state.forced = forced;
    state.note = '';
    if (previous === source) return;
    state.since = now();
    last = { source, previous, reason, forced, message, at: state.since };
    for (const fn of [...listeners]) {
      try {
        fn({ ...last });
      } catch (err) {
        log(`a data-source listener failed: ${err && err.message ? err.message : err}`);
      }
    }
  }

  let probing = null;
  function probeOnce() {
    if (state.directAllowed !== null) return Promise.resolve({ allowed: state.directAllowed });
    if (!probing) {
      probing = Promise.resolve()
        .then(() => probe())
        .then(
          (result) => Boolean(result && result.allowed),
          () => false,
        )
        .then((allowed) => {
          state.directAllowed = allowed;
          probing = null;
          return { allowed };
        });
    }
    return probing;
  }

  let checking = null;
  /** Asks the proxy's /health (with a time limit). Resolves true when it answers ok. */
  function checkProxy() {
    if (!checking) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => {
        if (controller) controller.abort();
      }, healthTimeoutMs);
      checking = Promise.resolve()
        .then(() => remote.health(controller ? { signal: controller.signal } : undefined))
        .then(
          (body) => healthState(body) === 'ok',
          () => false,
        )
        .then((ok) => {
          clearTimeout(timer);
          state.proxyAlive = ok;
          checking = null;
          return ok;
        });
    }
    return checking;
  }

  const automatic = () => state.source === 'proxy' && !state.forced;

  /** The proxy is known to be gone: move to `direct` if the bucket can be reached. */
  async function leaveProxy(reason) {
    state.proxyAlive = false;
    const { allowed } = await probeOnce();
    if (!automatic()) return state.source === 'direct';
    const choice = chooseDataSource({ health: false, directAllowed: allowed });
    if (choice.source !== 'direct') {
      state.note = MESSAGES.blocked;
      state.reason = choice.reason;
      return false;
    }
    setSource('direct', { reason, forced: false, message: MESSAGES.failover });
    return true;
  }

  /** A proxy call failed in a way that points at the proxy: repeat it on `direct`. */
  async function retryOnDirect(method, args, original, verdict) {
    if (verdict === 'verify' && (await checkProxy())) throw original; // the proxy is fine; it was this one request
    state.proxyAlive = false;
    if (state.source !== 'direct') {
      if (!automatic()) throw original;
      const { allowed } = await probeOnce();
      if (!allowed) {
        state.note = MESSAGES.blocked;
        state.reason = 'proxy-down-direct-blocked';
        throw original;
      }
    }
    let result;
    try {
      const api = await apiFor('direct');
      result = await api[method](...args);
    } catch (err) {
      if (err && (err.aborted === true || err.name === 'AbortError')) throw err;
      try {
        original.directError = err;
      } catch {
        // a frozen error keeps its own text
      }
      throw original;
    }
    if (automatic()) setSource('direct', { reason: `proxy-${method}-failed`, forced: false, message: MESSAGES.failover });
    return result;
  }

  async function call(method, args) {
    const source = state.source;
    // The shared sky map lives on the proxy. A simulated visit never goes there; a real one
    // read directly still does, while the proxy is not known to be down.
    const useRemoteFog = (method === 'fog' || method === 'fogMark') && source === 'direct' && state.proxyAlive !== false;
    if (useRemoteFog) {
      try {
        return await remote[method](...args);
      } catch (err) {
        if (err && err.aborted === true) throw err;
        state.proxyAlive = false;
      }
    }
    const api = await apiFor(source);
    try {
      const result = await api[method](...args);
      if (source === 'proxy') state.proxyAlive = true;
      if (source === 'practice' && method === 'search' && result && typeof result === 'object' && result.simulated !== true) {
        return { ...result, simulated: true };
      }
      return result;
    } catch (err) {
      if (source !== 'proxy' || state.forced) throw err;
      const verdict = failoverVerdict(err, method);
      if (!verdict) throw err;
      if (method === 'health') {
        // Nothing to repeat: report the failure, and move if possible.
        leaveProxy('proxy-health-failed').catch(() => {});
        throw err;
      }
      return retryOnDirect(method, args, err, verdict);
    }
  }

  /** Switch by hand. Loads the in-page service first, so a broken build fails here, visibly. */
  async function use(source, { reason = 'manual' } = {}) {
    if (!SOURCE_IDS.includes(source)) throw new Error(`Unknown data source "${source}"`);
    await apiFor(source);
    // Choosing the proxy by hand keeps the automatic fallback; the other two stay put.
    setSource(source, { reason, forced: source !== 'proxy', message: MESSAGES[source] });
    if (source === 'proxy') state.proxyAlive = null;
    return snapshot();
  }

  const settled = eager && automatic()
    ? checkProxy().then((ok) => (ok || !automatic() ? null : leaveProxy('proxy-health-failed'))).then(
        () => snapshot(),
        () => snapshot(),
      )
    : Promise.resolve().then(() => snapshot());

  const dataSource = {
    current: snapshot,
    use,
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    lastChange: () => (last ? { ...last } : null),
    sources: () => SOURCE_IDS.map((id) => ({ ...SOURCES[id], label: sourceLabel(id, remote.baseUrl) })),
    apiFor,
    probe: probeOnce,
    checkProxy,
    cache: () => Promise.resolve(typeof cache === 'function' ? cache() : cache),
    settled: () => settled,
  };

  const facade = { dataSource };
  for (const key of Object.keys(remote)) {
    if (typeof remote[key] === 'function') facade[key] = (...args) => call(key, args);
  }
  Object.defineProperty(facade, 'baseUrl', { enumerable: true, get: () => snapshot().baseUrl });
  return facade;
}

/**
 * createPageApi({ remote, win, onChange, indexSource, cache, eager }) -> the api for the page.
 *
 * The one line the shell needs:   const api = createPageApi({ remote: createApi(resolveApiBase()) });
 *
 * `direct` and `practice` share one IndexedDB cache (./idbcache.js). `indexSource` (or
 * window.TOMBAUGH_INDEX) tells `direct` where a public copy of the exposure index lives: a URL
 * prefix such that `<prefix>/index/v2/manifest.json` exists, or a function (key) -> bytes.
 */
export function createPageApi({ remote, win = globalThis, indexSource, cache = null, ...rest } = {}) {
  let url = '';
  let pageFetch;
  let index = indexSource;
  try {
    url = String(win.location.href);
  } catch {
    url = '';
  }
  try {
    if (typeof win.fetch === 'function') pageFetch = win.fetch.bind(win);
    if (index === undefined && win.TOMBAUGH_INDEX) index = win.TOMBAUGH_INDEX;
  } catch {
    // a locked-down frame: defaults apply
  }
  let cachePromise = null;
  const getCache = () => {
    if (!cachePromise) cachePromise = cache ? Promise.resolve(cache) : import('./idbcache.js').then((m) => m.createIdbCache());
    return cachePromise;
  };
  const makeLocal = async (backend) => {
    const [{ createLocalApi }, shared] = await Promise.all([import('./localapi.js'), getCache()]);
    return createLocalApi({ backend, cache: shared, fetchImpl: pageFetch, indexSource: index });
  };
  return createAutoApi({ remote, makeLocal, probe: () => probeBucket({ fetchImpl: pageFetch }), url, cache: getCache, ...rest });
}
