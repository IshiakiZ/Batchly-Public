// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Anonymous access to the public SPHEREx bucket on AWS Open Data (see CONTRACT-S3.md).
// Web-standard APIs only: fetch, AbortController, TextDecoder. Nothing here keeps state.
//
// Exports (every network function takes an options object, all fields optional):
//   { fetchImpl = fetch, base = S3_BASE, timeoutMs = 20000, retries = 3, backoffMs = 250,
//     sleep, signal }
//
//   S3_BASE, ID_PREFIX
//   listPrefixes(prefix, opts)  -> Promise<string[]>            CommonPrefixes ("dr1/", ...)
//   listKeys(prefix, opts)      -> Promise<[{ key, size }]>     follows continuation tokens
//   rangeGet(key, start, endInclusive, opts)
//                               -> Promise<{ bytes: Uint8Array, total: number|null }>
//   idToKey(id) / keyToId(key)                                  id = 'ibe/data/spherex/' + key
//   isValidKey(key), parseKey(key) -> { release, dir, version, det, obsid, suffix }
//   makeKey({ release, dir, version, det, suffix }) -> key
//   listReleaseDirs(opts)       -> Promise<[{ release, dir, prefix, version }]>
//   mapLimit(items, limit, fn)  -> Promise<results[]>           bounded-concurrency map
//
// Errors thrown by the network functions are S3Error: { code, status, retryable } with code
//   'NOT_FOUND'  the key does not exist (HTTP 404)
//   'RANGE'      the range lies beyond the end of the object (HTTP 416)
//   'UPSTREAM'   everything else: 5xx / SlowDown after all retries, timeouts, network errors,
//                unexpected answers (retryable = true when trying again later may help)
//   'BAD_ID'     the id / key does not have the shape of a SPHEREx Level-2 file (never sent)
//
// Bucket layout:
//   <release>/level2/<dir>/<version>/<det>/level2_<dir>_<suffix>D<det>_spx_<version>.fits
//   e.g. qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits
//   release = dr<N> | qr<N>; dir = observing week part; version = processing version;
//   det = 1..6; OBSID = <dir>_<suffix>, suffix = "<NNNN>_<M>" (sequence and sub-exposure).

export const S3_BASE = 'https://nasa-irsa-spherex.s3.amazonaws.com';
export const ID_PREFIX = 'ibe/data/spherex/';

const KEY_RE =
  /^(dr|qr)\d+\/level2\/[0-9A-Za-z_]+\/[0-9A-Za-z._-]+\/[1-6]\/level2_[0-9A-Za-z_]+D[1-6]_spx_[0-9A-Za-z._-]+\.fits$/;
const RELEASE_RE = /^(dr|qr)(\d+)$/;
const SEGMENT_RE = /^[0-9A-Za-z._-]+$/;
const DIR_RE = /^[0-9A-Za-z_]+$/;

export class S3Error extends Error {
  constructor(message, { code = 'UPSTREAM', status = 0, retryable = false } = {}) {
    super(message);
    this.name = 'S3Error';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

// ---------------------------------------------------------------------------------------------
// Keys and ids
// ---------------------------------------------------------------------------------------------

/** True when `key` has exactly the shape of a Level-2 file key (and no ".." anywhere). */
export function isValidKey(key) {
  return typeof key === 'string' && key.length <= 400 && KEY_RE.test(key) && !key.includes('..');
}

function badId(what) {
  return new S3Error(`Not a SPHEREx Level-2 file id: ${String(what).slice(0, 200)}`, { code: 'BAD_ID', status: 400 });
}

/** IRSA uri ('ibe/data/spherex/<key>') -> S3 key. Throws S3Error code 'BAD_ID' on anything else. */
export function idToKey(id) {
  if (typeof id !== 'string') throw badId(id);
  let text = id;
  if (text.startsWith('/')) text = text.slice(1);
  if (!text.startsWith(ID_PREFIX)) throw badId(id);
  const key = text.slice(ID_PREFIX.length);
  if (!isValidKey(key)) throw badId(id);
  parseKey(key); // also insists that the directory and the file name agree
  return key;
}

/** S3 key -> IRSA uri. Throws on a key that is not a Level-2 file key. */
export function keyToId(key) {
  if (!isValidKey(key)) throw badId(key);
  return ID_PREFIX + key;
}

/**
 * Split a key into its parts. `obsid` is the observation id (`<dir>_<suffix>`), `suffix` the
 * exposure part after the directory name ("0279_1"). Throws when the key is malformed or when
 * the file name disagrees with its directory (detector, version or week directory).
 */
export function parseKey(key) {
  if (!isValidKey(key)) throw badId(key);
  const [release, , dir, version, detText, file] = key.split('/');
  const det = Number(detText);
  const tail = `D${det}_spx_${version}.fits`;
  if (!file.endsWith(tail)) throw badId(key);
  const obsid = file.slice('level2_'.length, file.length - tail.length);
  if (!obsid.startsWith(`${dir}_`) || obsid.length <= dir.length + 1) throw badId(key);
  return { release, dir, version, det, obsid, suffix: obsid.slice(dir.length + 1) };
}

/** Inverse of parseKey. */
export function makeKey({ release, dir, version, det, suffix }) {
  const key = `${release}/level2/${dir}/${version}/${det}/level2_${dir}_${suffix}D${det}_spx_${version}.fits`;
  if (!isValidKey(key)) throw badId(key);
  return key;
}

// ---------------------------------------------------------------------------------------------
// HTTP with timeout and retries
// ---------------------------------------------------------------------------------------------

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run `fn(item, index)` over `items` with at most `limit` running at once; keeps order. */
export async function mapLimit(items, limit, fn) {
  const list = Array.from(items);
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  };
  const workers = [];
  for (let w = 0; w < Math.max(1, Math.min(limit | 0, list.length)); w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

async function drain(response) {
  try {
    if (response.body && typeof response.body.cancel === 'function') await response.body.cancel();
  } catch {
    // nothing to release
  }
}

/**
 * One GET with a timeout that also covers reading the body, retried on 5xx, 429 and network
 * errors with exponential backoff and jitter. Resolves { status, headers, bytes } for any
 * status that is not retried; the caller decides what the status means.
 */
async function httpGet(url, headers, opts, label) {
  const {
    fetchImpl = globalThis.fetch,
    timeoutMs = 20000,
    retries = 3,
    backoffMs = 250,
    sleep = defaultSleep,
    signal,
  } = opts || {};
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal && signal.aborted) throw new S3Error(`${label}: cancelled`, { code: 'UPSTREAM' });
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1) * (0.5 + Math.random() * 0.5));
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1, timeoutMs));
    try {
      const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
      if (response.status >= 500 || response.status === 429) {
        // 500 InternalError and 503 SlowDown are S3's "try again" answers.
        await drain(response);
        lastError = new S3Error(`${label}: HTTP ${response.status} from S3`, { status: response.status, retryable: true });
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, headers: response.headers, bytes };
    } catch (err) {
      if (signal && signal.aborted) throw new S3Error(`${label}: cancelled`, { code: 'UPSTREAM' });
      const why = timedOut ? `no answer within ${timeoutMs} ms` : (err && err.message) || String(err);
      lastError = new S3Error(`${label}: ${why}`, { retryable: true });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  throw lastError || new S3Error(`${label}: failed`, { retryable: true });
}

function baseOf(opts) {
  return String((opts && opts.base) || S3_BASE).replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------------------------
// Listing (ListObjectsV2, XML)
// ---------------------------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode the five XML entities and numeric character references. */
export function decodeXml(text) {
  return String(text).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, name) ? ENTITIES[name] : whole;
  });
}

/**
 * Parse one ListObjectsV2 answer:
 *   <ListBucketResult> <IsTruncated>true</IsTruncated> <NextContinuationToken>..</..>
 *     <Contents><Key>..</Key><Size>123</Size>..</Contents> ...
 *     <CommonPrefixes><Prefix>dr1/</Prefix></CommonPrefixes> ... </ListBucketResult>
 */
export function parseListXml(xml) {
  const prefixes = [];
  const keys = [];
  const prefixRe = /<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>\s*<\/CommonPrefixes>/g;
  for (let m = prefixRe.exec(xml); m; m = prefixRe.exec(xml)) prefixes.push(decodeXml(m[1]));
  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  for (let m = contentsRe.exec(xml); m; m = contentsRe.exec(xml)) {
    const key = /<Key>([^<]*)<\/Key>/.exec(m[1]);
    if (!key) continue;
    const size = /<Size>\s*(\d+)\s*<\/Size>/.exec(m[1]);
    keys.push({ key: decodeXml(key[1]), size: size ? Number(size[1]) : null });
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
  return { prefixes, keys, truncated, next: token ? decodeXml(token[1]) : null };
}

async function listAll(prefix, opts) {
  const base = baseOf(opts);
  const maxKeys = Math.max(1, Math.min(1000, (opts && opts.maxKeys) || 1000));
  const prefixes = [];
  const keys = [];
  let token = null;
  for (let page = 0; page < 10000; page++) {
    let url = `${base}/?list-type=2&delimiter=%2F&max-keys=${maxKeys}&prefix=${encodeURIComponent(prefix)}`;
    if (token !== null) url += `&continuation-token=${encodeURIComponent(token)}`;
    const label = `S3 list ${prefix || '(root)'}`;
    const { status, bytes } = await httpGet(url, {}, opts, label);
    const text = new TextDecoder().decode(bytes);
    if (status !== 200) {
      throw new S3Error(`${label}: HTTP ${status} ${text.slice(0, 160)}`, { status, retryable: false });
    }
    if (!text.includes('<ListBucketResult')) {
      throw new S3Error(`${label}: answer is not a bucket listing`, { status, retryable: true });
    }
    const parsed = parseListXml(text);
    for (const p of parsed.prefixes) prefixes.push(p);
    for (const k of parsed.keys) keys.push(k);
    if (!parsed.truncated) return { prefixes, keys };
    if (!parsed.next) throw new S3Error(`${label}: truncated listing without a continuation token`, { retryable: true });
    token = parsed.next;
  }
  throw new S3Error(`S3 list ${prefix}: more than 10000 pages`, { retryable: false });
}

/** "Sub-directories" directly under `prefix` (which should end with '/' or be ''). */
export async function listPrefixes(prefix, opts = {}) {
  return (await listAll(prefix, opts)).prefixes;
}

/** Objects directly under `prefix`: [{ key, size }], every page. */
export async function listKeys(prefix, opts = {}) {
  return (await listAll(prefix, opts)).keys;
}

// ---------------------------------------------------------------------------------------------
// Range requests
// ---------------------------------------------------------------------------------------------

function keyUrl(key, opts) {
  return `${baseOf(opts)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Read bytes start..endInclusive of an object. Requires a 206 answer whose Content-Range starts
 * at `start`. `total` is the object size from Content-Range (null if the server did not say).
 * If the object ends before `endInclusive` the returned array is simply shorter.
 */
export async function rangeGet(key, start, endInclusive, opts = {}) {
  if (!Number.isInteger(start) || !Number.isInteger(endInclusive) || start < 0 || endInclusive < start) {
    throw new S3Error(`S3 range ${key}: bad range ${start}-${endInclusive}`, { code: 'RANGE' });
  }
  if (typeof key !== 'string' || key === '' || key.includes('..') || key.startsWith('/')) throw badId(key);
  const label = `S3 get ${key.slice(key.lastIndexOf('/') + 1)} bytes ${start}-${endInclusive}`;
  const { status, headers, bytes } = await httpGet(keyUrl(key, opts), { range: `bytes=${start}-${endInclusive}` }, opts, label);
  if (status === 404) throw new S3Error(`${label}: no such file in the bucket`, { code: 'NOT_FOUND', status });
  if (status === 416) throw new S3Error(`${label}: range is beyond the end of the file`, { code: 'RANGE', status });
  if (status !== 206) {
    throw new S3Error(`${label}: expected HTTP 206, got ${status}`, { status, retryable: status === 200 ? false : status >= 500 });
  }
  let total = null;
  const contentRange = headers && typeof headers.get === 'function' ? headers.get('content-range') : null;
  if (contentRange) {
    const m = /^\s*bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(contentRange);
    if (!m) throw new S3Error(`${label}: unreadable Content-Range "${contentRange}"`, { status, retryable: true });
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (from !== start || to > endInclusive || to - from + 1 !== bytes.length) {
      throw new S3Error(`${label}: got ${bytes.length} bytes for Content-Range "${contentRange}"`, { status, retryable: true });
    }
    if (m[3] !== '*') total = Number(m[3]);
  } else if (bytes.length > endInclusive - start + 1) {
    throw new S3Error(`${label}: got ${bytes.length} bytes, more than asked for`, { status, retryable: true });
  }
  return { bytes, total };
}

// ---------------------------------------------------------------------------------------------
// Release rule and directory discovery
// ---------------------------------------------------------------------------------------------

/**
 * Which releases to use, from the top-level prefixes: every dr<N> and only the highest qr<N>.
 * Returned in order of preference (highest DR first, the QR last).
 */
export function chooseReleases(topPrefixes) {
  const drs = [];
  let qr = null;
  for (const p of topPrefixes) {
    const m = RELEASE_RE.exec(String(p).replace(/\/$/, ''));
    if (!m) continue;
    const item = { release: m[0], n: Number(m[2]) };
    if (m[1] === 'dr') drs.push(item);
    else if (!qr || item.n > qr.n) qr = item;
  }
  drs.sort((a, b) => b.n - a.n);
  const out = drs.map((d) => d.release);
  if (qr) out.push(qr.release);
  return out;
}

/** Rank of a release for "which copy of a directory wins": any DR beats any QR, then by number. */
export function releaseRank(release) {
  const m = RELEASE_RE.exec(String(release));
  if (!m) return -1;
  return (m[1] === 'dr' ? 1e6 : 0) + Number(m[2]);
}

/**
 * The folders to index: [{ release, dir, prefix, version }] sorted by dir then version, where
 * prefix = '<release>/level2/<dir>/<version>/'. Release rule: all dr<N>, only the highest
 * qr<N>, and a directory present in both is taken from the DR. A directory has one entry per
 * processing-version folder (measured Nov 15 2026: all 151 directories have "l2b-v27-...",
 * 122 also have "l2b_retry-v27-...").
 *
 * opts.concurrency (default 12) bounds parallel lists.
 */
export async function listReleaseDirs(opts = {}) {
  const { concurrency = 12 } = opts;
  const releases = chooseReleases(await listPrefixes('', opts));
  const perRelease = await mapLimit(releases, 4, async (release) => {
    const root = `${release}/level2/`;
    const prefixes = await listPrefixes(root, opts);
    const dirs = [];
    for (const p of prefixes) {
      if (!p.startsWith(root) || !p.endsWith('/')) continue;
      const dir = p.slice(root.length, -1);
      if (DIR_RE.test(dir)) dirs.push(dir);
    }
    return { release, dirs };
  });

  const chosen = new Map(); // dir -> release; releases come in order of preference
  for (const { release, dirs } of perRelease) {
    for (const dir of dirs) if (!chosen.has(dir)) chosen.set(dir, release);
  }

  // Every processing-version folder of a directory is its own entry. Most weeks have two: the
  // main run and a small "l2b_retry-..." run. They are listed afresh every time, because a
  // retry folder can appear after the main one.
  const entries = [...chosen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out = await mapLimit(entries, concurrency, async ([dir, release]) => {
    const root = `${release}/level2/${dir}/`;
    const versions = (await listPrefixes(root, opts))
      .filter((p) => p.startsWith(root) && p.endsWith('/'))
      .map((p) => p.slice(root.length, -1))
      .filter((v) => SEGMENT_RE.test(v) && !v.includes('..'))
      .sort();
    return versions.map((version) => ({ release, dir, prefix: `${root}${version}/`, version }));
  });
  return out.flat();
}
