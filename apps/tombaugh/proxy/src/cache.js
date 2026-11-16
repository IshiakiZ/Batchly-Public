// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Object caches for the proxy: an in-memory LRU and a Supabase Storage bucket.
// Both expose   get(key, { maxAgeSeconds, strict }?) -> Promise<Uint8Array|null>
//               put(key, u8, contentType?)           -> Promise<boolean>
//               delete(key)                          -> Promise<boolean>
// and never throw: a broken cache only costs speed, so failures are logged and reported as a
// miss. Returned arrays are fresh copies (byteOffset 0) that the caller may keep or change.
//
// The one exception is get(key, { strict: true }), for read-modify-write users such as the fog
// map: it still resolves null for a missing object but rejects when the store could not be
// read, so that "unreachable" is never mistaken for "empty" and written back.

const DEFAULT_MEMORY_BYTES = 200 * 1024 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,400}$/;

// Stored objects in Supabase start with a 16-byte prefix so that their age is known without a
// second request: ASCII "TBC1", four zero bytes, then the write time in ms as float64 LE.
const PREFIX_BYTES = 16;
const PREFIX_MAGIC = [0x54, 0x42, 0x43, 0x31];

const defaultLog = (message) => {
  try {
    console.warn(`[tombaugh cache] ${message}`);
  } catch {
    // no console
  }
};

/** True for keys that are safe as object paths: letters, digits, . _ - /, no "..", no "//". */
export function isSafeKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key) && !key.includes('..') && !key.includes('//') && !key.endsWith('/');
}

/**
 * cacheKey(parts) -> Promise<string>: "<prefix>/<sha1 hex>". The prefix is the first part
 * reduced to [a-z0-9-] (a readable folder); the digest covers every part, so any strings or
 * numbers are safe to pass, including file paths.
 */
export async function cacheKey(parts) {
  const list = Array.isArray(parts) ? parts : [parts];
  const text = list.map((part) => String(part)).join('\u001f');
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  const prefix =
    String(list[0] ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'k';
  return `${prefix}/${hex}`;
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return null;
}

/**
 * createMemoryCache({ maxBytes = 200 MB, now }) -> cache. Least-recently-used entries are
 * dropped once the total size passes maxBytes; a single object larger than a quarter of the cap
 * is not stored at all.
 */
export function createMemoryCache({ maxBytes = DEFAULT_MEMORY_BYTES, now = Date.now, log = defaultLog } = {}) {
  const entries = new Map(); // key -> { u8, at, contentType }
  let total = 0;

  function drop(key) {
    const entry = entries.get(key);
    if (!entry) return false;
    total -= entry.u8.byteLength;
    entries.delete(key);
    return true;
  }

  return {
    kind: 'memory',
    async get(key, { maxAgeSeconds } = {}) {
      try {
        const entry = entries.get(key);
        if (!entry) return null;
        if (Number.isFinite(maxAgeSeconds) && now() - entry.at > maxAgeSeconds * 1000) return null;
        entries.delete(key); // re-insert: most recently used goes last
        entries.set(key, entry);
        return entry.u8.slice();
      } catch (err) {
        log(`memory get ${key} failed: ${err && err.message}`);
        return null;
      }
    },
    async put(key, data, contentType = 'application/octet-stream') {
      try {
        const bytes = toBytes(data);
        if (typeof key !== 'string' || !key || !bytes) return false;
        if (bytes.byteLength > maxBytes / 4) return false;
        drop(key);
        entries.set(key, { u8: bytes.slice(), at: now(), contentType });
        total += bytes.byteLength;
        for (const oldest of entries.keys()) {
          if (total <= maxBytes) break;
          if (oldest === key) break;
          drop(oldest);
        }
        return true;
      } catch (err) {
        log(`memory put ${key} failed: ${err && err.message}`);
        return false;
      }
    },
    async delete(key) {
      return drop(key);
    },
    /** For tests and the health endpoint. */
    stats() {
      return { entries: entries.size, bytes: total, maxBytes };
    },
  };
}

function hasPrefix(bytes) {
  if (bytes.byteLength < PREFIX_BYTES) return false;
  for (let i = 0; i < 4; i++) if (bytes[i] !== PREFIX_MAGIC[i]) return false;
  return true;
}

function withPrefix(bytes, at) {
  const out = new Uint8Array(PREFIX_BYTES + bytes.byteLength);
  out.set(PREFIX_MAGIC, 0);
  new DataView(out.buffer).setFloat64(8, at, true);
  out.set(bytes, PREFIX_BYTES);
  return out;
}

/**
 * createSupabaseCache({ url, serviceKey, bucket, fetchImpl, timeoutMs, log, now }) -> cache
 * backed by Supabase Storage over its REST API. The bucket is private and is created on the
 * first write if it does not exist. `ensureBucket()` can also be called directly.
 */
export function createSupabaseCache({ url, serviceKey, bucket, fetchImpl, timeoutMs = 10000, log = defaultLog, now = Date.now } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);
  const auth = { authorization: `Bearer ${serviceKey}`, apikey: String(serviceKey) };
  let bucketReady = null;

  function objectUrl(key) {
    const path = key.split('/').map(encodeURIComponent).join('/');
    return `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`;
  }

  async function timed(run) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  async function bodyText(response) {
    try {
      return (await response.text()).slice(0, 300);
    } catch {
      return '';
    }
  }

  /** Creates the private bucket if it is missing. Resolves true when the bucket is usable. */
  function ensureBucket() {
    if (!bucketReady) {
      bucketReady = (async () => {
        try {
          return await timed(async (signal) => {
            const response = await doFetch(`${base}/storage/v1/bucket`, {
              method: 'POST',
              headers: { ...auth, 'content-type': 'application/json' },
              body: JSON.stringify({ id: bucket, name: bucket, public: false }),
              signal,
            });
            if (response.ok) {
              await bodyText(response);
              return true;
            }
            const text = await bodyText(response);
            if (response.status === 409 || /already exists|duplicate/i.test(text)) return true;
            log(`could not create bucket ${bucket}: HTTP ${response.status} ${text}`);
            return false;
          });
        } catch (err) {
          log(`could not create bucket ${bucket}: ${err && err.message}`);
          return false;
        }
      })().then((ok) => {
        if (!ok) bucketReady = null; // allow another try later
        return ok;
      });
    }
    return bucketReady;
  }

  async function upload(key, body, contentType) {
    return timed(async (signal) => {
      const response = await doFetch(objectUrl(key), {
        method: 'POST',
        headers: { ...auth, 'content-type': contentType || 'application/octet-stream', 'x-upsert': 'true' },
        body,
        signal,
      });
      const text = response.ok ? '' : await bodyText(response);
      if (response.ok) await bodyText(response);
      return { ok: response.ok, status: response.status, text };
    });
  }

  return {
    kind: 'supabase',
    ensureBucket,
    async get(key, { maxAgeSeconds, strict = false } = {}) {
      if (!isSafeKey(key)) {
        log(`refusing unsafe key ${JSON.stringify(key)}`);
        if (strict) throw new Error(`cache: unsafe key ${JSON.stringify(key)}`);
        return null;
      }
      try {
        return await timed(async (signal) => {
          const response = await doFetch(objectUrl(key), { method: 'GET', headers: auth, signal });
          if (!response.ok) {
            const text = await bodyText(response);
            // A missing object is 404, or 400 with "not found" in older Storage versions.
            const missing = response.status === 404 || (response.status === 400 && /not.?found/i.test(text));
            if (!missing && strict) throw new Error(`storage answered HTTP ${response.status} ${text}`);
            if (!missing) log(`get ${key}: HTTP ${response.status} ${text}`);
            return null;
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          let at = NaN;
          let payload = bytes;
          if (hasPrefix(bytes)) {
            at = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(8, true);
            payload = bytes.slice(PREFIX_BYTES);
          }
          if (Number.isFinite(maxAgeSeconds)) {
            if (!Number.isFinite(at) || now() - at > maxAgeSeconds * 1000) return null;
          }
          return payload;
        });
      } catch (err) {
        log(`get ${key} failed: ${err && err.message}`);
        if (strict) throw err instanceof Error ? err : new Error(String(err));
        return null;
      }
    },
    async put(key, data, contentType = 'application/octet-stream') {
      if (!isSafeKey(key)) {
        log(`refusing unsafe key ${JSON.stringify(key)}`);
        return false;
      }
      try {
        const bytes = toBytes(data);
        if (!bytes) return false;
        const body = withPrefix(bytes, now());
        let result = await upload(key, body, contentType);
        if (!result.ok && /bucket.*not.?found|bucket does not exist/i.test(result.text)) {
          if (await ensureBucket()) result = await upload(key, body, contentType);
        }
        if (!result.ok) log(`put ${key}: HTTP ${result.status} ${result.text}`);
        return result.ok;
      } catch (err) {
        log(`put ${key} failed: ${err && err.message}`);
        return false;
      }
    },
    async delete(key) {
      if (!isSafeKey(key)) return false;
      try {
        return await timed(async (signal) => {
          const response = await doFetch(objectUrl(key), { method: 'DELETE', headers: auth, signal });
          await bodyText(response);
          return response.ok;
        });
      } catch (err) {
        log(`delete ${key} failed: ${err && err.message}`);
        return false;
      }
    },
  };
}
