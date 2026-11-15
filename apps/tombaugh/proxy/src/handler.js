// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The proxy's HTTP surface: createHandler(...) returns async (Request) => Response.
// It routes on the last path segment, so it works at /api/search, /functions/v1/spherex/search
// or anywhere else it is mounted. Endpoints: search, cutout, gaia, resolve, health, fog,
// identify, ephemeris, track, index.
//
// Three backends:
//   's3'         (the hosted default) NASA's public copy of the SPHEREx files on AWS Open Data:
//                the frame search is answered from our own exposure index (expindex.js) and the
//                pixels are cut out of the full files with HTTP Range requests (s3cutout.js).
//                IRSA's TAP and cutout services are the fallback, not the dependency.
//   'irsa'       IRSA's TAP search and cutout service only (the first design).
//   'synthetic'  a deterministic fake sky, no network.
//
// It is not an open proxy: the only upstream URLs it can build are fixed TAP endpoints, the
// JPL Horizons API, and SPHEREx Level-2 file paths on irsa.ipac.caltech.edu or in the public
// bucket nasa-irsa-spherex (see isValidFrameId in irsa.js and idToKey in s3.js).

import { createMemoryCache, cacheKey } from './cache.js';
import {
  IRSA_BASE,
  UpstreamError,
  fetchCutoutHead,
  fetchWaveTable,
  fetchWithTimeout,
  isValidFrameId,
  isWaveTable,
  parseFrameUri,
  searchFrames,
} from './irsa.js';
import { GAIA_MAX_RADIUS, gaiaCone, gaiaFromSynthetic } from './gaia.js';
import { BUILTIN_SOURCE, cleanName, resolveName } from './resolve.js';
import * as expindexDefault from './expindex.js';
import * as s3cutoutDefault from './s3cutout.js';
import { IDENTIFY_DEFAULT_RADIUS, IDENTIFY_MAX_RADIUS, IDENTIFY_MIN_RADIUS, identifyCone, identifyFromSynthetic } from './identify.js';
import { ephemerisRoute } from './horizons.js';

export const DEFAULT_VERSION = '0.1.0';
export const SIZE_MIN = 0.02;
export const SIZE_MAX = 0.2;
export const SIZE_DEFAULT = 0.1;

const SEARCH_TTL_SECONDS = 12 * 3600;
const EMPTY_SEARCH_TTL_SECONDS = 600; // "no frames" may be an archive hiccup; ask again soon
const GAIA_TTL_SECONDS = 30 * 86400;
const RESOLVE_TTL_SECONDS = 30 * 86400;
const JOB_TTL_SECONDS = 900;
const IRSA_STATE_TTL_MS = 10 * 60 * 1000;
const SEARCH_BREAKER_MS = 2 * 60 * 1000; // after a failed search, serve stale answers at once for this long
const FOG_CELLS = 12288;
const IDENTIFY_TTL_SECONDS = 30 * 86400;
const SEARCH_MAX_PER_DET_DEFAULT = 200; // deep fields near the ecliptic poles have thousands
const SEARCH_MAX_PER_DET_LIMIT = 5000;
const TRACK_MAX_SAMPLES = 6000;
const TRACK_MAX_BODY_BYTES = 600 * 1024;
const INDEX_BUILD_BUDGET_MS = 25000;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, apikey, x-client-info',
  'access-control-expose-headers': 'x-tombaugh-cache',
  'access-control-max-age': '86400',
};

const ROUTES = ['search', 'cutout', 'gaia', 'resolve', 'health', 'fog', 'identify', 'ephemeris', 'track', 'index'];
const POST_ROUTES = ['fog', 'track', 'index'];

/** An error with an HTTP status that is the client's to fix (or a plain 404/405). */
export class HttpError extends Error {
  constructor(status, message, retryable = false) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryable = retryable;
  }
}

const defaultLog = (message) => {
  try {
    console.log(`[tombaugh] ${message}`);
  } catch {
    // no console
  }
};

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function roundTo(value, digits) {
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r; // no negative zero
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function numberParam(params, name, { fallback } = {}) {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `Missing parameter "${name}"`);
  }
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) throw new HttpError(400, `Parameter "${name}" must be a number, got "${raw.slice(0, 40)}"`);
  return value;
}

function readPosition(params) {
  let ra = numberParam(params, 'ra');
  const dec = numberParam(params, 'dec');
  if (ra < 0 || ra > 360) throw new HttpError(400, 'ra must be between 0 and 360 degrees');
  if (dec < -90 || dec > 90) throw new HttpError(400, 'dec must be between -90 and 90 degrees');
  if (ra === 360) ra = 0;
  return { ra, dec };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function errorResponse(status, message, retryable) {
  return jsonResponse({ error: String(message), retryable: Boolean(retryable) }, status);
}

function binaryResponse(bytes, headers = {}) {
  return new Response(bytes, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      ...headers,
    },
  });
}

function isTbf1(u8) {
  return !!u8 && u8.byteLength > 8 && u8[0] === 0x54 && u8[1] === 0x42 && u8[2] === 0x46 && u8[3] === 0x31;
}

function decodeJson(bytes) {
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function encodeJson(value) {
  return new TextEncoder().encode(JSON.stringify(value));
}

/** Wavelength tables are tiny (11 x 11 x 2 floats); JSON keeps them readable in the bucket. */
export function encodeWaveTable(table) {
  return encodeJson({
    nx: table.nx,
    ny: table.ny,
    x: Array.from(table.x),
    y: Array.from(table.y),
    values: Array.from(table.values, (v) => (Number.isFinite(v) ? v : null)),
  });
}

export function decodeWaveTable(bytes) {
  const obj = decodeJson(bytes);
  if (!obj || !Array.isArray(obj.x) || !Array.isArray(obj.y) || !Array.isArray(obj.values)) return null;
  const table = {
    x: Int32Array.from(obj.x),
    y: Int32Array.from(obj.y),
    values: Float32Array.from(obj.values, (v) => (v === null ? NaN : v)),
    nx: obj.nx,
    ny: obj.ny,
  };
  return isWaveTable(table) ? table : null;
}

/** Runs at most `max` tasks at once; the rest wait in order. */
function createLimiter(max) {
  let active = 0;
  const waiting = [];
  return async function limit(task) {
    if (active >= max) await new Promise((resolve) => waiting.push(resolve)); // slot is handed over
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Shares one in-flight promise between identical concurrent requests. */
function coalesce(map, key, run) {
  let pending = map.get(key);
  if (!pending) {
    pending = (async () => run())().finally(() => map.delete(key));
    map.set(key, pending);
  }
  return pending;
}

function chunkedStream(u8, chunkBytes = 16384) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= u8.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(u8.byteLength, offset + chunkBytes);
      controller.enqueue(u8.slice(offset, end));
      offset = end;
    },
  });
}

function hashString(text) {
  // FNV-1a, 32 bit: a stable seed for synthetic frames.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * createHandler({ fetchImpl, cache, backend, version, ... }) -> async (Request) => Response
 *
 * backend 's3' reads NASA's public bucket (own exposure index, Range cutouts) with IRSA as the
 * fallback; 'irsa' talks to IRSA only; 'synthetic' serves a deterministic fake sky from
 * proxy/fixtures/synth.js through the same FITS parsing and TBF1 encoding, and never touches
 * the network. Extra options for 's3': s3Options (passed to every bucket request) and
 * deps.expindex / deps.s3cutout / deps.identifyCone / deps.ephemerisRoute for tests.
 *
 * Further options (all optional): log(message); now(); deps to inject modules
 * ({ fits, encode, fog, synth, irsa: { searchFrames, fetchCutoutHead, fetchWaveTable },
 * gaiaCone, resolveName }); syntheticLatencyMs (default 40); searchTimeoutMs (per TAP attempt,
 * default 75 s); searchBudgetMs (whole search, default 130 s, to stay inside an edge function's
 * 150 s limit); staleRefreshBudgetMs (how long to try IRSA when an expired answer is at hand,
 * default 30 s); cutoutTimeoutMs (per cutout attempt, default 30 s, three attempts);
 * waveTimeoutMs (per wave-table attempt, default 45 s, two attempts); maxUpstream (concurrent
 * cutout downloads, default 12).
 */
export function createHandler(options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    cache = createMemoryCache(),
    backend = 'irsa',
    version = DEFAULT_VERSION,
    deps = {},
    log = defaultLog,
    now = Date.now,
    syntheticLatencyMs = 40,
    searchTimeoutMs = 75000,
    searchBudgetMs = 130000,
    staleRefreshBudgetMs = 30000,
    cutoutTimeoutMs = 30000,
    waveTimeoutMs = 45000,
    maxUpstream = 12,
  } = options;
  if (backend !== 'irsa' && backend !== 'synthetic' && backend !== 's3') throw new Error(`unknown backend "${backend}"`);
  const live = backend !== 'synthetic';
  const expindex = deps.expindex || expindexDefault;
  const s3cutout = deps.s3cutout || s3cutoutDefault;
  const identifyConeFn = deps.identifyCone || identifyCone;
  const ephemerisRouteFn = deps.ephemerisRoute || ephemerisRoute;
  const s3Options = options.s3Options || {}; // passed to every S3 request (base, timeoutMs, retries)

  const irsa = {
    searchFrames: deps.irsa?.searchFrames || searchFrames,
    fetchCutoutHead: deps.irsa?.fetchCutoutHead || fetchCutoutHead,
    fetchWaveTable: deps.irsa?.fetchWaveTable || fetchWaveTable,
  };
  const gaiaConeFn = deps.gaiaCone || gaiaCone;
  const resolveNameFn = deps.resolveName || resolveName;

  // Sibling modules are loaded on first use so that this file imports even where they are
  // absent (unit tests inject fakes). The edge function passes them in statically.
  const loaded = {};
  async function moduleOf(name, load) {
    if (deps[name]) return deps[name];
    if (!loaded[name]) {
      try {
        loaded[name] = await load();
      } catch (err) {
        throw new HttpError(500, `The proxy is missing its ${name} module: ${err && err.message}`);
      }
    }
    return loaded[name];
  }
  const fitsModule = () => moduleOf('fits', () => import('./fits.js'));
  const encodeModule = () => moduleOf('encode', () => import('./encode.js'));
  const fogModule = () => moduleOf('fog', () => import('./fog.js'));
  // Computed specifier: bundlers for the edge function must not try to include the fixtures.
  const synthModule = () => moduleOf('synth', () => import(new URL('../fixtures/synth.js', import.meta.url).href));

  // The caches in cache.js never throw; a foreign cache might, and that must only cost speed.
  async function cacheGet(key, opts) {
    try {
      return await cache.get(key, opts);
    } catch (err) {
      log(`cache get ${key} failed: ${err && err.message}`);
      return null;
    }
  }
  async function cachePut(key, bytes, contentType) {
    try {
      return await cache.put(key, bytes, contentType);
    } catch (err) {
      log(`cache put ${key} failed: ${err && err.message}`);
      return false;
    }
  }
  async function cacheDelete(key) {
    try {
      if (typeof cache.delete === 'function') await cache.delete(key);
    } catch (err) {
      log(`cache delete ${key} failed: ${err && err.message}`);
    }
  }

  const waveTables = new Map(); // det -> table
  const waveInflight = new Map();
  const searchInflight = new Map();
  const cutoutInflight = new Map();
  const searchJobs = new Map(); // search key -> { url, at }
  const synthFrames = new Map(); // synthetic frame id -> { ref, ra, dec } from the last searches
  const synthFields = []; // centres of the synthetic fields that were searched, newest last
  const indexMemo = new Map(); // decoded exposure-index directories, kept while the isolate lives
  const layoutMemo = new Map(); // header sizes per processing version and detector (s3cutout.js)
  const limitUpstream = createLimiter(maxUpstream);
  let irsaState = { state: 'unknown', at: 0 };
  let searchFailedAt = -Infinity; // when the IRSA frame search last failed in this instance

  function noteIrsa(err) {
    if (!err) {
      irsaState = { state: 'up', at: now() };
      return;
    }
    const kind = err && err.kind;
    const down = kind === 'timeout' || kind === 'network' || kind === 'html' || (kind === 'http' && err.upstreamStatus >= 500);
    if (down) irsaState = { state: 'down', at: now() };
  }

  async function latency(factor = 1) {
    if (syntheticLatencyMs > 0) await sleepMs(syntheticLatencyMs * factor * (0.6 + 0.8 * Math.random()));
  }

  // ---------------------------------------------------------------- search

  function rememberSynthetic(sky, ra, dec) {
    for (const ref of sky.frameRefs || []) {
      synthFrames.delete(ref.id);
      synthFrames.set(ref.id, { ref, ra, dec });
    }
    while (synthFrames.size > 20000) synthFrames.delete(synthFrames.keys().next().value);
  }

  function publicRef(ref) {
    return { id: String(ref.id), det: Number(ref.det), mjd: Number(ref.mjd), release: String(ref.release ?? ''), obsid: String(ref.obsid ?? '') };
  }

  async function handleSearch(params) {
    const { ra, dec } = readPosition(params);
    const ra4 = roundTo(ra, 4);
    const dec4 = roundTo(dec, 4);

    if (backend === 'synthetic') {
      const synth = await synthModule();
      await latency(6);
      const sky = synth.syntheticSky(ra4, dec4);
      rememberSynthetic(sky, ra4, dec4);
      synthFields.push({ ra: ra4, dec: dec4 });
      while (synthFields.length > 64) synthFields.shift();
      const frames = (sky.frameRefs || []).map(publicRef).sort((a, b) => a.mjd - b.mjd);
      return jsonResponse({ ra, dec, cached: false, fetchedAt: new Date(now()).toISOString(), frames });
    }

    const key = await cacheKey(['search', 'irsa-v1', ra4.toFixed(4), dec4.toFixed(4)]);
    if (backend === 's3') {
      const maxPerDet = Math.round(clamp(numberParam(params, 'max', { fallback: SEARCH_MAX_PER_DET_DEFAULT }), 0, SEARCH_MAX_PER_DET_LIMIT));
      const fromIndex = await searchIndexed(ra4, dec4, maxPerDet);
      if (fromIndex) {
        return jsonResponse({ ...fromIndex, ra, dec }, 200, fromIndex.complete ? { 'cache-control': 'public, max-age=300' } : {});
      }
      // The index has nothing for this position yet (it is still being built): ask IRSA.
    }
    const body = await coalesce(searchInflight, key, () => searchIrsa(key, ra4, dec4));
    const headers = body.stale ? {} : { 'cache-control': 'public, max-age=300' };
    return jsonResponse(backend === 's3' ? { ...body, source: 'irsa-tap', complete: true, ra, dec } : { ...body, ra, dec }, 200, headers);
  }

  function indexSummary(result) {
    return { dirsIndexed: result.dirsIndexed, dirsTotal: result.dirsTotal, dirsSearched: result.dirsSearched, dirsFailed: result.dirsFailed };
  }

  /**
   * The frame search from our own exposure index. Resolves null when the index cannot answer
   * (not built yet, or the store is unreachable) so that the caller can fall back to IRSA.
   * An answer from a partly built index is marked complete: false.
   */
  async function searchIndexed(ra4, dec4, maxPerDet) {
    const t0 = now();
    let result;
    try {
      result = await expindex.searchIndex(cache, ra4, dec4, { maxPerDet, memo: indexMemo });
    } catch (err) {
      log(`search ${ra4},${dec4}: exposure index failed (${err && err.message})`);
      return null;
    }
    if (!result || !Array.isArray(result.frames)) return null;
    if (result.frames.length === 0 && !result.complete) return null;
    log(`search ${ra4},${dec4}: ${result.frames.length} frames from the index (${result.dirsSearched} of ${result.dirsIndexed} directories) in ${now() - t0} ms`);
    return {
      ra: ra4,
      dec: dec4,
      cached: false,
      fetchedAt: new Date(now()).toISOString(),
      source: 'index',
      complete: Boolean(result.complete),
      counts: result.counts,
      index: indexSummary(result),
      frames: result.frames,
    };
  }

  async function searchIrsa(key, ra4, dec4) {
    const cached = decodeJson(await cacheGet(key));
    const usable = cached && Array.isArray(cached.frames) && typeof cached.fetchedAt === 'string';
    if (usable) {
      const ageMs = now() - Date.parse(cached.fetchedAt);
      const ttl = cached.frames.length > 0 ? SEARCH_TTL_SECONDS : EMPTY_SEARCH_TTL_SECONDS;
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < ttl * 1000) {
        return { ra: ra4, dec: dec4, cached: true, fetchedAt: cached.fetchedAt, frames: cached.frames };
      }
    }
    // An expired answer with frames in it is a good fallback (the frame list of a position only
    // grows with new releases). With one at hand, IRSA gets a short time to give a newer list;
    // nobody should wait two minutes for an archive that is down. An expired "no frames" answer
    // is not served: it may have been wrong.
    const staleOk = Boolean(usable && cached.frames.length > 0);
    const staleAnswer = () => ({ ra: ra4, dec: dec4, cached: true, stale: true, fetchedAt: cached.fetchedAt, frames: cached.frames });
    if (staleOk && now() - searchFailedAt < SEARCH_BREAKER_MS) {
      // The archive search failed moments ago: do not make this visitor wait for it again.
      log(`search ${ra4},${dec4}: IRSA search failed recently; serving the stale answer of ${cached.fetchedAt}`);
      return staleAnswer();
    }

    // An async TAP job started by an earlier request that ran out of time can be picked up.
    const jobKey = key.replace(/^search\//, 'searchjob/');
    let job = searchJobs.get(key);
    if (job && now() - job.at > JOB_TTL_SECONDS * 1000) job = null;
    if (!job) {
      const stored = await cacheGet(jobKey, { maxAgeSeconds: JOB_TTL_SECONDS });
      if (stored && stored.byteLength > 0 && stored.byteLength < 600) job = { url: new TextDecoder().decode(stored), at: now() };
    }
    const bookkeeping = [];
    let jobStored = Boolean(job);
    const onJob = (url) => {
      if (url) {
        jobStored = true;
        searchJobs.set(key, { url, at: now() });
        while (searchJobs.size > 500) searchJobs.delete(searchJobs.keys().next().value);
        bookkeeping.push(cachePut(jobKey, new TextEncoder().encode(url), 'text/plain'));
      } else if (jobStored) {
        jobStored = false;
        searchJobs.delete(key);
        bookkeeping.push(cacheDelete(jobKey));
      }
    };

    const t0 = now();
    try {
      const frames = await irsa.searchFrames(ra4, dec4, {
        fetchImpl,
        timeoutMs: searchTimeoutMs,
        totalTimeoutMs: staleOk ? Math.min(searchBudgetMs, staleRefreshBudgetMs) : searchBudgetMs,
        asyncFallback: !staleOk,
        resumeJobUrl: job ? job.url : undefined,
        onJob,
        log,
      });
      noteIrsa(null);
      searchFailedAt = -Infinity;
      const fresh = { ra: ra4, dec: dec4, cached: false, fetchedAt: new Date(now()).toISOString(), frames };
      await cachePut(key, encodeJson(fresh), 'application/json');
      log(`search ${ra4},${dec4}: ${frames.length} frames from IRSA in ${now() - t0} ms`);
      return fresh;
    } catch (err) {
      noteIrsa(err);
      if (err && err.retryable !== false) searchFailedAt = now();
      if (staleOk) {
        log(`search ${ra4},${dec4}: IRSA failed (${err && err.message}); serving the stale answer of ${cached.fetchedAt}`);
        return staleAnswer();
      }
      throw err;
    } finally {
      await Promise.allSettled(bookkeeping);
    }
  }

  // ---------------------------------------------------------------- cutout

  async function waveTableFor(det, sampleId, ra, dec, fits, { fromS3 = false } = {}) {
    const known = waveTables.get(det);
    if (known) return known;
    return coalesce(waveInflight, det, async () => {
      const key = `wave/irsa-d${det}-v1.json`;
      const stored = decodeWaveTable(await cacheGet(key));
      if (stored) {
        waveTables.set(det, stored);
        return stored;
      }
      const t0 = now();
      if (fromS3) {
        // The same table sits in the last 5760 bytes of every full file of the detector.
        try {
          const table = await s3cutout.fetchWaveTableFromS3(sampleId, { ...s3Options, fetchImpl });
          if (!isWaveTable(table)) throw new Error('unexpected layout');
          waveTables.set(det, table);
          await cachePut(key, encodeWaveTable(table), 'application/json');
          log(`wave table for detector ${det} read from S3 in ${now() - t0} ms`);
          return table;
        } catch (err) {
          log(`wave table for detector ${det}: S3 failed (${err && err.message}); asking IRSA`);
        }
      }
      const table = await irsa.fetchWaveTable(det, sampleId, {
        fetchImpl,
        ra,
        dec,
        parseMef: fits.parseMef,
        readWaveTable: fits.readWaveTable,
        timeoutMs: waveTimeoutMs,
        retries: 1,
        log,
      });
      if (!isWaveTable(table)) throw new UpstreamError('wavelength table has an unexpected layout', { kind: 'parse' });
      waveTables.set(det, table);
      await cachePut(key, encodeWaveTable(table), 'application/json');
      log(`wave table for detector ${det} fetched in ${now() - t0} ms`);
      return table;
    });
  }

  /** Throws unless the four image HDUs are present with all of their data. */
  function assertCompleteHead(fits, head) {
    const hdus = fits.parseMef(head);
    for (const name of ['IMAGE', 'FLAGS', 'VARIANCE', 'ZODI']) {
      const hdu = hdus.find((h) => String(h.name || '').trim().toUpperCase() === name);
      if (!hdu) throw new Error(`no ${name} extension`);
      if (Number.isFinite(hdu.dataOffset) && Number.isFinite(hdu.dataBytes) && hdu.dataOffset + hdu.dataBytes > head.byteLength) {
        throw new Error(`${name} data cut short`);
      }
    }
  }

  function detectorOf(fits, head, fallback) {
    let hdus;
    try {
      hdus = fits.parseMef(head);
    } catch (err) {
      throw new UpstreamError(`cutout could not be parsed: ${err && err.message}`, { kind: 'parse' });
    }
    if (!Array.isArray(hdus) || hdus.length < 2) throw new UpstreamError('cutout has no image extension', { kind: 'parse' });
    const image = hdus.find((h) => String(h.name || '').trim().toUpperCase() === 'IMAGE') || hdus[1];
    const det = Number(image && image.header && typeof image.header.get === 'function' ? image.header.get('DETECTOR') : NaN);
    if (Number.isInteger(det) && det >= 1 && det <= 6) return det;
    if (fallback) return fallback;
    throw new UpstreamError('cutout does not say which detector it is from', { kind: 'parse' });
  }

  function encodeFrame(encode, id, head, waveTable) {
    let tbf;
    try {
      tbf = encode.buildFrame({ id, u8: head, waveTable });
    } catch (err) {
      throw new UpstreamError(`cutout could not be encoded: ${err && err.message}`, { kind: 'parse' });
    }
    if (!isTbf1(tbf)) throw new UpstreamError('encoder returned something that is not a TBF1 frame', { kind: 'parse', retryable: false });
    return tbf;
  }

  async function buildIrsaCutout(id, ra, dec, size) {
    const fits = await fitsModule();
    const encode = await encodeModule();
    const detFromId = parseFrameUri(id).det;
    // The wavelength table (a 4 MB download, once per detector) can start right away.
    const early = detFromId ? waveTableFor(detFromId, id, ra, dec, fits) : null;
    if (early) early.catch(() => {}); // observed below; never an unhandled rejection
    let head;
    try {
      head = await irsa.fetchCutoutHead(id, ra, dec, size, {
        fetchImpl,
        readUntilPsf: fits.readUntilPsf,
        validate: (bytes) => assertCompleteHead(fits, bytes),
        timeoutMs: cutoutTimeoutMs,
        log,
      });
      noteIrsa(null);
    } catch (err) {
      noteIrsa(err);
      throw err;
    }
    const det = detectorOf(fits, head, detFromId);
    let table;
    try {
      table = early && det === detFromId ? await early : await waveTableFor(det, id, ra, dec, fits);
    } catch (err) {
      noteIrsa(err);
      throw err;
    }
    return encodeFrame(encode, id, head, table);
  }

  /**
   * A cutout from the full file in the public bucket. Only when S3 itself fails (not when the
   * position is off the detector or the file does not exist) is IRSA's cutout service tried.
   */
  async function buildS3Cutout(id, ra, dec, size) {
    const fits = await fitsModule();
    const encode = await encodeModule();
    const detFromId = parseFrameUri(id).det;
    const early = detFromId ? waveTableFor(detFromId, id, ra, dec, fits, { fromS3: true }) : null;
    if (early) early.catch(() => {}); // observed below; never an unhandled rejection
    let head;
    try {
      head = await s3cutout.fetchCutoutFromS3(id, ra, dec, size, { ...s3Options, fetchImpl, layoutMemo });
    } catch (err) {
      const code = err && err.code;
      if (code === 'OUTSIDE') throw new HttpError(404, 'That position is not on this exposure\'s detector');
      if (code === 'NOT_FOUND') throw new HttpError(404, 'That exposure has no file for this detector');
      if (code === 'BAD_ID') throw new HttpError(400, 'id must be a SPHEREx Level-2 file path as returned by /search');
      log(`cutout ${id}: S3 failed (${err && err.message}); trying IRSA's cutout service`);
      return buildIrsaCutout(id, ra, dec, size);
    }
    const det = detectorOf(fits, head, detFromId);
    const table = early && det === detFromId ? await early : await waveTableFor(det, id, ra, dec, fits, { fromS3: true });
    return encodeFrame(encode, id, head, table);
  }

  /** The FITS bytes of a synthetic frame, or a 404 when the id or the position does not fit. */
  function syntheticMefBytes(synth, id, ra, dec, size) {
    try {
      if (typeof synth.syntheticMef === 'function' && typeof synth.parseSyntheticId === 'function') {
        // The fixture's ids carry their field, so a frame can be rebuilt from the id alone.
        if (!synth.parseSyntheticId(id)) throw new HttpError(404, 'Unknown synthetic frame id');
        return synth.syntheticMef(id, { ra, dec, size });
      }
      // Contract-only fixture: find the frame in the sky that /search built (remembered by id),
      // or, after a restart, in the sky of this position rounded the way /search rounds.
      const entry = synthFrames.get(id);
      let sky = synth.syntheticSky(entry ? entry.ra : roundTo(ra, 4), entry ? entry.dec : roundTo(dec, 4));
      let ref = (sky.frameRefs || []).find((f) => f.id === id);
      if (!ref && entry) {
        sky = synth.syntheticSky(roundTo(ra, 4), roundTo(dec, 4));
        ref = (sky.frameRefs || []).find((f) => f.id === id);
      }
      if (!ref) throw new HttpError(404, 'Unknown synthetic frame id; run /search for this position first');
      return synth.makeSyntheticMef({ seed: hashString(id), ...ref, ra, dec, size, det: ref.det, mjd: ref.mjd, sources: sky.sourcesAt(ref.mjd) });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // For example: the requested centre is not on that exposure's detector.
      throw new HttpError(404, `Synthetic frame is not available here: ${err && err.message}`);
    }
  }

  async function buildSyntheticCutout(id, ra, dec, size) {
    const synth = await synthModule();
    const fits = await fitsModule();
    const encode = await encodeModule();
    await latency(1);
    const mef = syntheticMefBytes(synth, id, ra, dec, size);
    // Same path as a real download: stream -> readUntilPsf -> parse -> wave table -> TBF1.
    const head = await fits.readUntilPsf(chunkedStream(mef));
    const det = detectorOf(fits, head, parseFrameUri(id).det);
    const tableKey = `synthetic-${det}`;
    let table = waveTables.get(tableKey);
    if (!table) {
      const hdu = fits.parseMef(mef).find((h) => String(h.name || '').trim().toUpperCase() === 'WCS-WAVE');
      if (!hdu) throw new HttpError(500, 'Synthetic frame has no WCS-WAVE extension');
      table = fits.readWaveTable(mef, hdu);
      waveTables.set(tableKey, table);
    }
    return encodeFrame(encode, id, head, table);
  }

  async function handleCutout(params) {
    const id = params.get('id') || '';
    if (!id) throw new HttpError(400, 'Missing parameter "id"');
    let validId = live ? isValidFrameId(id) : id.length <= 400;
    if (validId && backend === 'synthetic') {
      const synth = await synthModule();
      if (typeof synth.parseSyntheticId === 'function') validId = Boolean(synth.parseSyntheticId(id));
    }
    if (!validId) throw new HttpError(400, 'id must be a SPHEREx Level-2 file path as returned by /search');
    const { ra, dec } = readPosition(params);
    const size = roundTo(clamp(numberParam(params, 'size', { fallback: SIZE_DEFAULT }), SIZE_MIN, SIZE_MAX), 3);
    const ra5 = roundTo(ra, 5);
    const dec5 = roundTo(dec, 5);
    const headers = { 'cache-control': 'public, max-age=31536000, immutable' };

    // 's3' and 'irsa' cut the same pixels out of the same files, so they share their cache.
    const key = await cacheKey(['cutout', `${live ? 'irsa' : backend}-v1`, id, ra5.toFixed(5), dec5.toFixed(5), size.toFixed(3)]);
    const hit = await cacheGet(key);
    if (isTbf1(hit)) return binaryResponse(hit, { ...headers, 'x-tombaugh-cache': 'hit' });

    const bytes = await coalesce(cutoutInflight, key, () =>
      limitUpstream(async () => {
        let tbf;
        if (backend === 'synthetic') tbf = await buildSyntheticCutout(id, ra5, dec5, size);
        else if (backend === 's3') tbf = await buildS3Cutout(id, ra5, dec5, size);
        else tbf = await buildIrsaCutout(id, ra5, dec5, size);
        await cachePut(key, tbf, 'application/octet-stream');
        return tbf;
      }),
    );
    return binaryResponse(bytes, { ...headers, 'x-tombaugh-cache': 'miss' });
  }

  // ---------------------------------------------------------------- gaia, resolve

  async function handleGaia(params) {
    const { ra, dec } = readPosition(params);
    const radius = roundTo(clamp(numberParam(params, 'radius', { fallback: 0.1 }), 0.001, GAIA_MAX_RADIUS), 3);
    if (backend === 'synthetic') {
      const synth = await synthModule();
      await latency(2);
      const sky = synth.syntheticSky(roundTo(ra, 4), roundTo(dec, 4));
      const { epoch, stars } = gaiaFromSynthetic(sky, ra, dec, radius);
      return jsonResponse({ epoch, stars, source: 'synthetic', cached: false });
    }
    const ra4 = roundTo(ra, 4);
    const dec4 = roundTo(dec, 4);
    const key = await cacheKey(['gaia', 'v1', ra4.toFixed(4), dec4.toFixed(4), radius.toFixed(3)]);
    const cached = decodeJson(await cacheGet(key, { maxAgeSeconds: GAIA_TTL_SECONDS }));
    const headers = { 'cache-control': 'public, max-age=86400' };
    if (cached && Array.isArray(cached.stars)) return jsonResponse({ ...cached, cached: true }, 200, headers);
    const result = await gaiaConeFn(ra4, dec4, radius, { fetchImpl, log });
    const body = { epoch: result.epoch, stars: result.stars, source: result.source };
    await cachePut(key, encodeJson(body), 'application/json');
    return jsonResponse({ ...body, cached: false }, 200, headers);
  }

  async function handleResolve(params) {
    const name = cleanName(params.get('name') || '');
    if (!name) throw new HttpError(400, 'Missing parameter "name"');
    const notFound = () => new HttpError(404, `No object named "${name}" was found`);
    if (backend === 'synthetic') {
      await latency(2);
      const found = await resolveNameFn(name, { offline: true, log });
      if (!found) throw notFound();
      return jsonResponse(found);
    }
    const key = await cacheKey(['resolve', 'v1', name.toLowerCase()]);
    const cached = decodeJson(await cacheGet(key, { maxAgeSeconds: RESOLVE_TTL_SECONDS }));
    const headers = { 'cache-control': 'public, max-age=3600' };
    if (cached && Number.isFinite(cached.ra) && Number.isFinite(cached.dec)) return jsonResponse(cached, 200, headers);
    const found = await resolveNameFn(name, { fetchImpl, log });
    if (!found) throw notFound();
    // A built-in answer means the name services were unreachable; do not freeze it in the cache.
    if (found.source !== BUILTIN_SOURCE) {
      await cachePut(key, encodeJson(found), 'application/json');
      return jsonResponse(found, 200, headers);
    }
    return jsonResponse(found);
  }

  // ---------------------------------------------------------------- identify, ephemeris, track

  async function handleIdentify(params) {
    const { ra, dec } = readPosition(params);
    const radius = roundTo(clamp(numberParam(params, 'radius', { fallback: IDENTIFY_DEFAULT_RADIUS }), IDENTIFY_MIN_RADIUS, IDENTIFY_MAX_RADIUS), 5);
    if (backend === 'synthetic') {
      const synth = await synthModule();
      await latency(2);
      // The fake sky is built around a field centre, so look the click up in the field it
      // belongs to: the most recently searched one within half a degree.
      let centre = null;
      for (let i = synthFields.length - 1; i >= 0 && !centre; i--) {
        const f = synthFields[i];
        const dra = (((ra - f.ra + 540) % 360) - 180) * Math.cos((dec * Math.PI) / 180);
        if (Math.hypot(dra, dec - f.dec) < 0.5) centre = f;
      }
      const sky = centre ? synth.syntheticSky(centre.ra, centre.dec) : synth.syntheticSky(roundTo(ra, 4), roundTo(dec, 4));
      const mjd = numberParam(params, 'mjd', { fallback: NaN });
      return jsonResponse({ ...identifyFromSynthetic(sky, ra, dec, radius, { mjd }), simulated: true, cached: false });
    }
    const ra5 = roundTo(ra, 5);
    const dec5 = roundTo(dec, 5);
    const key = await cacheKey(['identify', 'v1', ra5.toFixed(5), dec5.toFixed(5), radius.toFixed(5)]);
    const cached = decodeJson(await cacheGet(key, { maxAgeSeconds: IDENTIFY_TTL_SECONDS }));
    const headers = { 'cache-control': 'public, max-age=86400' };
    if (cached && Array.isArray(cached.objects)) return jsonResponse({ ...cached, cached: true }, 200, headers);
    const result = await identifyConeFn(ra5, dec5, radius, { fetchImpl });
    const body = { objects: result.objects, source: result.source };
    await cachePut(key, encodeJson(body), 'application/json');
    return jsonResponse({ ...body, cached: false }, 200, headers);
  }

  const offline = (what) => new HttpError(503, `The practice sky works without the network, so it has no ${what}. Switch to live data for that.`, false);

  async function handleEphemeris(params) {
    if (!live) throw offline('solar-system ephemerides');
    const { status, body } = await ephemerisRouteFn(params, { fetchImpl, cache: { get: cacheGet, put: cachePut } });
    return jsonResponse(body, status, status === 200 ? { 'cache-control': 'public, max-age=3600' } : {});
  }

  /** POST /track { samples: [[mjd, ra, dec], ...], dets?, maxPerDet? }: exposures that caught a moving body. */
  async function handleTrack(request) {
    if (!live) throw offline('exposure index to follow a moving body through');
    let payload;
    try {
      const text = await request.text();
      if (text.length > TRACK_MAX_BODY_BYTES) throw new HttpError(413, 'The track is too long; send at most 6000 samples');
      payload = JSON.parse(text);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, 'POST a JSON body { samples: [[mjd, ra, dec], ...] }');
    }
    const rows = payload && Array.isArray(payload.samples) ? payload.samples : null;
    if (!rows || rows.length < 2) throw new HttpError(400, 'samples must list at least two [mjd, ra, dec] rows');
    if (rows.length > TRACK_MAX_SAMPLES) throw new HttpError(413, `samples has ${rows.length} rows; send at most ${TRACK_MAX_SAMPLES}`);
    const samples = rows.map((row) => (Array.isArray(row) ? { mjd: Number(row[0]), ra: Number(row[1]), dec: Number(row[2]) } : { mjd: Number(row && row.mjd), ra: Number(row && row.ra), dec: Number(row && row.dec) }));
    for (const s of samples) {
      if (!Number.isFinite(s.mjd) || !Number.isFinite(s.ra) || !Number.isFinite(s.dec) || s.dec < -90 || s.dec > 90) {
        throw new HttpError(400, 'every sample must be [mjd, ra, dec] in days and degrees');
      }
      s.ra = ((s.ra % 360) + 360) % 360;
    }
    samples.sort((a, b) => a.mjd - b.mjd);
    const dets = Array.isArray(payload.dets) ? payload.dets.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 6) : [1, 2, 3, 4, 5, 6];
    const maxPerDet = Math.round(clamp(Number.isFinite(Number(payload.maxPerDet)) ? Number(payload.maxPerDet) : SEARCH_MAX_PER_DET_DEFAULT, 0, SEARCH_MAX_PER_DET_LIMIT));
    const t0 = now();
    let result;
    try {
      result = await expindex.searchIndexMoving(cache, samples, { dets: dets.length ? dets : [1, 2, 3, 4, 5, 6], maxPerDet, memo: indexMemo });
    } catch (err) {
      if (err instanceof RangeError) throw new HttpError(400, err.message);
      throw new HttpError(503, `The exposure index is not reachable right now: ${err && err.message}`, true);
    }
    log(`track: ${result.frames.length} frames along ${samples.length} samples in ${now() - t0} ms`);
    return jsonResponse({
      cached: false,
      fetchedAt: new Date(now()).toISOString(),
      source: 'index',
      complete: Boolean(result.complete),
      counts: result.counts,
      index: indexSummary(result),
      frames: result.frames,
    });
  }

  // ---------------------------------------------------------------- exposure index upkeep

  // GET  /index                         progress (add full=1 for the per-directory list)
  // POST /index?op=build[&offset=k][&n=600][&steps=4][&release=..&dir=..]
  //                                     bounded work: build the next missing piece(s)
  // POST /index?op=manifest             rebuild manifest.json from the per-directory metas
  // POST /index?op=dirs                 re-list the bucket's directories when the list is old
  // Every operation is idempotent and bounded, and the only upstream is the public bucket.
  async function handleIndex(request, params) {
    if (backend !== 's3') throw new HttpError(404, 'This data service keeps no exposure index');
    const opts = { ...s3Options, fetchImpl };
    try {
      if (request.method !== 'POST') {
        const status = await expindex.indexStatus(cache, { ...opts, offline: params.get('offline') === '1' });
        const dirs = Array.isArray(status.dirs) ? status.dirs : [];
        const body = {
          dirsTotal: dirs.length,
          dirsDone: dirs.filter((d) => d.done).length,
          exposures: status.exposures,
          exposuresDone: status.exposuresDone,
          complete: Boolean(status.complete),
          manifestBuiltAt: status.manifestBuiltAt || null,
        };
        if (params.get('full') === '1') body.dirs = dirs;
        return jsonResponse(body);
      }
      const op = (params.get('op') || 'build').toLowerCase();
      if (op === 'manifest') {
        const manifest = await expindex.rebuildManifest(cache, opts);
        indexMemo.clear();
        return jsonResponse({ builtAt: manifest.builtAt, dirs: manifest.dirs.length });
      }
      if (op === 'dirs') {
        const dirs = await expindex.refreshDirs(cache, opts);
        return jsonResponse({ dirs: dirs.length });
      }
      if (op !== 'build') throw new HttpError(400, 'op must be build, manifest or dirs');
      const maxExposures = Math.round(clamp(numberParam(params, 'n', { fallback: 600 }), 50, 2000));
      const concurrency = Math.round(clamp(numberParam(params, 'c', { fallback: 32 }), 1, 64));
      const buildOpts = { ...opts, maxExposures, concurrency };
      const release = params.get('release');
      const dir = params.get('dir');
      if (release && dir) {
        if (!/^[a-z0-9]{2,8}$/.test(release) || !/^[A-Za-z0-9_]{4,24}$/.test(dir)) throw new HttpError(400, 'release or dir has an unexpected shape');
        const version = params.get('version');
        if (version && !/^[0-9A-Za-z._-]{4,60}$/.test(version)) throw new HttpError(400, 'version has an unexpected shape');
        const step = await expindex.indexBuildStep(cache, version ? { release, dir, version } : { release, dir }, buildOpts);
        indexMemo.clear();
        return jsonResponse({ steps: [step] });
      }
      const offset = Math.round(clamp(numberParam(params, 'offset', { fallback: 0 }), 0, 1000));
      const maxSteps = Math.round(clamp(numberParam(params, 'steps', { fallback: 1 }), 1, 20));
      const t0 = now();
      const steps = [];
      let idle = false;
      while (steps.length < maxSteps && now() - t0 < INDEX_BUILD_BUDGET_MS) {
        const step = await expindex.indexBuildNext(cache, { ...buildOpts, offset });
        if (step.idle) {
          idle = true;
          break;
        }
        steps.push(step);
      }
      if (steps.length) indexMemo.clear();
      const last = steps[steps.length - 1];
      return jsonResponse({ steps, idle, remaining: idle ? 0 : last ? last.remaining : null, ms: now() - t0 });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(503, `The exposure index could not be updated: ${err && err.message}`, true);
    }
  }

  // ---------------------------------------------------------------- health, fog

  async function handleHealth(params) {
    let state = now() - irsaState.at < IRSA_STATE_TTL_MS ? irsaState.state : 'unknown';
    if (live && params.get('probe') === '1') {
      try {
        await fetchWithTimeout(
          fetchImpl,
          `${IRSA_BASE}/TAP/availability`,
          { method: 'GET' },
          4000,
          async (response) => {
            try {
              if (response.body) await response.body.cancel();
            } catch {
              // nothing to release
            }
            if (!response.ok) throw new UpstreamError(`HTTP ${response.status}`, { kind: 'http', upstreamStatus: response.status });
          },
          'IRSA',
        );
        irsaState = { state: 'up', at: now() };
      } catch {
        irsaState = { state: 'down', at: now() };
      }
      state = irsaState.state;
    }
    return jsonResponse({ ok: true, version, irsa: state, backend });
  }

  // fog.js reads, increments and writes back one shared object. It must be told when the store
  // could not be read or written, or a hiccup would replace the shared map with an empty one.
  // One adapter per handler, because fog.js queues marks per cache object.
  const fogCache = {
    get: (key) => cache.get(key, { strict: true }),
    put: async (key, bytes, contentType) => {
      const ok = await cache.put(key, bytes, contentType);
      if (ok === false) throw new Error('cache write failed');
    },
  };

  async function handleFog(request, params) {
    const fog = await fogModule();
    try {
      return await fogRequest(fog, request, params);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(503, `The shared sky map is not reachable right now: ${err && err.message}`, true);
    }
  }

  async function fogRequest(fog, request, params) {
    if (request.method === 'POST') {
      let source = params;
      if (!params.has('ra') || !params.has('dec')) {
        // Also accept a small JSON body { ra, dec }.
        try {
          const body = await request.json();
          source = new URLSearchParams();
          if (body && body.ra !== undefined) source.set('ra', String(body.ra));
          if (body && body.dec !== undefined) source.set('dec', String(body.dec));
        } catch {
          source = params;
        }
      }
      const { ra, dec } = readPosition(source);
      const result = await fog.fogMark(fogCache, ra, dec);
      return jsonResponse({ cell: Number(result.cell), count: Number(result.count) });
    }
    const counts = await fog.fogRead(fogCache);
    const bytes = new Uint8Array(FOG_CELLS * 2);
    const view = new DataView(bytes.buffer);
    const n = Math.min(FOG_CELLS, counts ? counts.length : 0);
    for (let i = 0; i < n; i++) view.setUint16(i * 2, counts[i], true);
    return binaryResponse(bytes, { 'cache-control': 'no-store' });
  }

  // ---------------------------------------------------------------- entry point

  function toErrorResponse(err, route) {
    if (err instanceof HttpError) return errorResponse(err.status, err.message, err.retryable);
    if (err instanceof UpstreamError || (err && err.name === 'UpstreamError')) {
      const status = [400, 404, 502, 504].includes(err.status) ? err.status : 502;
      return errorResponse(status, err.message, err.retryable !== false && status >= 500);
    }
    log(`${route}: unexpected error: ${err && err.stack ? err.stack : err}`);
    return errorResponse(500, `Internal error: ${err && err.message ? err.message : err}`, false);
  }

  return async function handler(request) {
    const t0 = now();
    let route = '';
    let response;
    try {
      const url = new URL(request.url);
      const segments = url.pathname.split('/').filter(Boolean);
      route = segments.length ? segments[segments.length - 1].toLowerCase() : '';
      const method = String(request.method || 'GET').toUpperCase();
      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      if (!ROUTES.includes(route)) {
        throw new HttpError(404, `Unknown endpoint "${route}". Endpoints: ${ROUTES.join(', ')}`);
      }
      const allowed = route === 'track' ? ['POST'] : POST_ROUTES.includes(route) ? ['GET', 'HEAD', 'POST'] : ['GET', 'HEAD'];
      if (!allowed.includes(method)) throw new HttpError(405, `Method ${method} is not allowed on /${route}`);
      const params = url.searchParams;
      if (route === 'search') response = await handleSearch(params);
      else if (route === 'cutout') response = await handleCutout(params);
      else if (route === 'gaia') response = await handleGaia(params);
      else if (route === 'resolve') response = await handleResolve(params);
      else if (route === 'health') response = await handleHealth(params);
      else if (route === 'identify') response = await handleIdentify(params);
      else if (route === 'ephemeris') response = await handleEphemeris(params);
      else if (route === 'track') response = await handleTrack(request);
      else if (route === 'index') response = await handleIndex(request, params);
      else response = await handleFog(request, params);
      if (method === 'HEAD') response = new Response(null, { status: response.status, headers: response.headers });
    } catch (err) {
      response = toErrorResponse(err, route);
    }
    if (route !== 'health') {
      const cacheNote = response.headers.get('x-tombaugh-cache');
      log(`${request.method} /${route} -> ${response.status} in ${now() - t0} ms${cacheNote ? ` (cache ${cacheNote})` : ''}`);
    }
    return response;
  };
}
