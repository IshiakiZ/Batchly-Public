// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// HTTP client for the Tombaugh proxy and the TBF1 frame decoder.

/** @typedef {Object} Frame
 * @property {string} id  @property {number} det  @property {number} nx  @property {number} ny
 * @property {number} mjd @property {number} exptime @property {string} release @property {string} obsid
 * @property {Object} wcs   // as in the TBF1 header
 * @property {Float32Array} image @property {Float32Array} variance @property {Float32Array} zodi
 * @property {Int32Array} flags   @property {Float32Array} wave
 * @property {number} waveCenter  @property {number} bwCenter @property {number} psfFwhm */

export const PRODUCTION_API = 'https://api.batch-ly.com/functions/v1/spherex';
export const FOG_CELLS = 12288;

/** An error from the proxy or the network, with a `retryable` hint and the HTTP status. */
export class ApiError extends Error {
  constructor(message, { status = 0, retryable = true, aborted = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryable = retryable;
    this.aborted = aborted;
  }
}

/**
 * API base: window.TOMBAUGH_API, else ?api=, else /api on localhost, else production.
 * `win` is injectable for tests.
 */
export function resolveApiBase(win = globalThis) {
  try {
    if (win && typeof win.TOMBAUGH_API === 'string' && win.TOMBAUGH_API) return stripSlash(win.TOMBAUGH_API);
  } catch {
    // ignore
  }
  let loc = null;
  try {
    loc = win ? win.location : null;
  } catch {
    loc = null;
  }
  if (loc) {
    try {
      const q = new URLSearchParams(loc.search || '').get('api');
      if (q) return stripSlash(q);
    } catch {
      // ignore
    }
    const host = String(loc.hostname || '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return '/api';
  }
  return PRODUCTION_API;
}

function stripSlash(text) {
  return String(text).replace(/\/+$/, '');
}

const DTYPES = {
  f4: { ctor: Float32Array, bytes: 4 },
  i4: { ctor: Int32Array, bytes: 4 },
  u4: { ctor: Uint32Array, bytes: 4 },
  i2: { ctor: Int16Array, bytes: 2 },
  u2: { ctor: Uint16Array, bytes: 2 },
  u1: { ctor: Uint8Array, bytes: 1 },
  f8: { ctor: Float64Array, bytes: 8 },
};

const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function readArray(u8, spec) {
  const type = DTYPES[spec.dtype];
  if (!type) throw new ApiError(`TBF1: unknown dtype ${spec.dtype}`, { retryable: false });
  const start = spec.offset;
  const byteLength = spec.length * type.bytes;
  if (!Number.isInteger(start) || start < 0 || start + byteLength > u8.byteLength) {
    throw new ApiError(`TBF1: array ${spec.name} runs past the end of the frame`, { retryable: true });
  }
  // Copy into a fresh, aligned buffer so the result is independent of the response body.
  const copy = u8.slice(start, start + byteLength);
  if (!HOST_LITTLE_ENDIAN && type.bytes > 1) {
    for (let i = 0; i < copy.length; i += type.bytes) copy.subarray(i, i + type.bytes).reverse();
  }
  return new type.ctor(copy.buffer, 0, spec.length);
}

/** decodeFrame(arrayBuffer) -> Frame. Accepts an ArrayBuffer or any typed-array view. */
export function decodeFrame(input) {
  let u8;
  if (input instanceof ArrayBuffer) u8 = new Uint8Array(input);
  else if (ArrayBuffer.isView(input)) u8 = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else throw new ApiError('TBF1: expected binary data', { retryable: false });
  if (u8.byteLength < 8 || u8[0] !== 0x54 || u8[1] !== 0x42 || u8[2] !== 0x46 || u8[3] !== 0x31) {
    throw new ApiError('Not a TBF1 frame', { retryable: false });
  }
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const headerLength = view.getUint32(4, true);
  if (8 + headerLength > u8.byteLength) throw new ApiError('TBF1: truncated header', { retryable: true });
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + headerLength)));
  } catch {
    throw new ApiError('TBF1: header is not valid JSON', { retryable: false });
  }
  const arrays = {};
  for (const spec of header.arrays || []) arrays[spec.name] = readArray(u8, spec);
  const nx = header.nx | 0;
  const ny = header.ny | 0;
  const count = nx * ny;
  if (!arrays.image || arrays.image.length !== count) {
    throw new ApiError('TBF1: image array missing or wrong size', { retryable: false });
  }
  const filled = (value) => {
    const a = new Float32Array(count);
    if (value !== 0) a.fill(value);
    return a;
  };
  const frame = {
    id: String(header.id ?? ''),
    det: Number(header.det) || 0,
    nx,
    ny,
    mjd: Number(header.mjd),
    exptime: Number(header.exptime) || 0,
    release: String(header.release ?? ''),
    obsid: String(header.obsid ?? ''),
    version: header.version ?? '',
    dateObs: header.dateObs ?? '',
    bunit: header.bunit ?? 'MJy / sr',
    wcs: header.wcs,
    detXY0: header.detXY0 ?? null,
    image: arrays.image,
    variance: arrays.variance && arrays.variance.length === count ? arrays.variance : filled(NaN),
    zodi: arrays.zodi && arrays.zodi.length === count ? arrays.zodi : filled(0),
    flags: arrays.flags && arrays.flags.length === count ? arrays.flags : new Int32Array(count),
    wave: arrays.wave && arrays.wave.length === count ? arrays.wave : filled(Number(header.waveCenter) || NaN),
    waveCenter: Number(header.waveCenter),
    bwCenter: Number(header.bwCenter),
    psfFwhm: Number(header.psfFwhm),
  };
  return frame;
}

function isAbort(err) {
  return !!err && (err.name === 'AbortError' || err.code === 20);
}

/**
 * createApi(baseUrl) -> { search, cutout, gaia, resolve, health, fog, fogMark, identify,
 *                         ephemeris, track, indexStatus }
 * Every method takes an optional trailing `{ signal }`. Failures reject with ApiError.
 *
 * `search` passes every field of the response through untouched, so the optional extras reach
 * the page: `source` ('index' | 'tap' | ...), `complete` (false while the exposure index is
 * still being built), `counts` (exposures per detector before thinning), `simulated` (true for
 * a synthetic sky) and per-frame `x`, `y` (detector pixel of the position).
 */
export function createApi(baseUrl, { fetchImpl } = {}) {
  const base = stripSlash(baseUrl || '');
  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  function url(path, params) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null) q.set(key, String(value));
    }
    const qs = q.toString();
    return `${base}/${path}${qs ? `?${qs}` : ''}`;
  }

  async function request(path, params, { signal, method = 'GET', body = undefined } = {}) {
    let response;
    try {
      const init = { method, signal };
      if (body !== undefined) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
        init.headers = { 'content-type': 'application/json' };
      }
      response = await doFetch(url(path, params), init);
    } catch (err) {
      if (isAbort(err)) throw new ApiError('Request cancelled', { aborted: true, retryable: false });
      throw new ApiError('The Tombaugh data service could not be reached', { retryable: true });
    }
    if (!response.ok) {
      let message = `The data service answered ${response.status}`;
      let retryable = response.status >= 500 || response.status === 429 || response.status === 408;
      try {
        const body = await response.json();
        if (body && typeof body.error === 'string') message = body.error;
        if (body && typeof body.retryable === 'boolean') retryable = body.retryable;
      } catch {
        // keep the generic message
      }
      throw new ApiError(message, { status: response.status, retryable });
    }
    return response;
  }

  async function json(path, params, opts) {
    const response = await request(path, params, opts);
    try {
      return await response.json();
    } catch (err) {
      if (isAbort(err)) throw new ApiError('Request cancelled', { aborted: true, retryable: false });
      throw new ApiError('The data service sent an unreadable answer', { retryable: true });
    }
  }

  async function binary(path, params, opts) {
    const response = await request(path, params, opts);
    try {
      return await response.arrayBuffer();
    } catch (err) {
      if (isAbort(err)) throw new ApiError('Request cancelled', { aborted: true, retryable: false });
      throw new ApiError('The download was interrupted', { retryable: true });
    }
  }

  return {
    baseUrl: base,
    async search(ra, dec, opts) {
      const body = await json('search', { ra, dec }, opts);
      const frames = Array.isArray(body.frames) ? body.frames.slice() : [];
      frames.sort((a, b) => a.mjd - b.mjd);
      return { ...body, frames };
    },
    async cutout(id, ra, dec, size, opts) {
      return decodeFrame(await binary('cutout', { id, ra, dec, size }, opts));
    },
    async gaia(ra, dec, radius, opts) {
      const body = await json('gaia', { ra, dec, radius }, opts);
      return { epoch: Number(body.epoch) || 2016.0, stars: Array.isArray(body.stars) ? body.stars : [] };
    },
    resolve(name, opts) {
      return json('resolve', { name }, opts);
    },
    health(opts) {
      return json('health', {}, opts);
    },
    async fog(opts) {
      const buffer = await binary('fog', {}, opts);
      const counts = new Uint16Array(FOG_CELLS);
      const view = new DataView(buffer);
      const n = Math.min(FOG_CELLS, Math.floor(buffer.byteLength / 2));
      for (let i = 0; i < n; i++) counts[i] = view.getUint16(i * 2, true);
      return counts;
    },
    fogMark(ra, dec, opts) {
      return json('fog', { ra, dec }, { ...(opts || {}), method: 'POST' });
    },
    /** Catalogued objects near a position (GET /identify). The default radius is 12 arcsec. */
    identify(ra, dec, radiusDeg = 0.0033, opts) {
      return json('identify', { ra, dec, radius: radiusDeg }, opts);
    },
    /** Positions of a solar-system body over time (GET /ephemeris?body&start&end&step). */
    ephemeris(body, { startMjd, endMjd, stepHours, signal } = {}, opts) {
      return json('ephemeris', { body, start: startMjd, end: endMjd, step: stepHours }, { ...(opts || {}), ...(signal ? { signal } : {}) });
    },
    /** Exposures along a moving track (POST /track, JSON body { samples, dets, maxPerDet }). */
    track(samples, { dets, maxPerDet, signal } = {}, opts) {
      return json('track', {}, { ...(opts || {}), ...(signal ? { signal } : {}), method: 'POST', body: { samples, dets, maxPerDet } });
    },
    /** How far the exposure index has been built (GET /index/status). */
    indexStatus(opts) {
      return json('index/status', {}, opts);
    },
  };
}
