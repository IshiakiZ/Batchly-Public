// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// IRSA client: frame search over TAP (sync with retries, then the UWS async protocol) and
// cutout downloads. Web-standard APIs only; runs unchanged in Node, Deno and browsers.
//
// IRSA is slow (a search takes about 20 s) and at times answers 502 or hangs, so every request
// has its own timeout, transient failures are retried, and a search that cannot finish over the
// sync endpoint is handed to an async job that survives our own request being cut short.

export const IRSA_BASE = 'https://irsa.ipac.caltech.edu';

/** Only SPHEREx Level-2 FITS paths may be fetched through the proxy. */
export const FRAME_URI_PATTERN = /^ibe\/data\/spherex\/[a-z0-9]+\/level2\/.+\.fits$/;

const SAFE_URI_CHARS = /^[A-Za-z0-9_\-./]+$/;
const MAX_URI_LENGTH = 400;
const MAX_TEXT_BYTES = 48 * 1024 * 1024;
const MAX_CUTOUT_BYTES = 24 * 1024 * 1024;

/**
 * An upstream failure. `status` is the HTTP status our proxy should answer with (502, 504 or
 * 404), `retryable` says whether trying again can help, `kind` is one of
 * 'timeout' | 'network' | 'http' | 'html' | 'parse' | 'job' | 'notfound' | 'input'.
 */
export class UpstreamError extends Error {
  constructor(message, { kind = 'network', status = 502, retryable = true, upstreamStatus = 0 } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
    this.upstreamStatus = upstreamStatus;
  }
}

/** True when `id` is a SPHEREx Level-2 uri and nothing else (no traversal, no query, no host). */
export function isValidFrameId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_URI_LENGTH) return false;
  if (!SAFE_URI_CHARS.test(id)) return false; // rejects ? # % & = : \ spaces, control characters
  if (id.includes('..') || id.includes('//')) return false;
  return FRAME_URI_PATTERN.test(id);
}

/** Splits a uri into { release, det, obsid }; fields are null when the name does not follow the pattern. */
export function parseFrameUri(uri) {
  const out = { release: null, det: null, obsid: null };
  if (typeof uri !== 'string') return out;
  const parts = uri.split('/');
  if (parts.length > 3 && parts[0] === 'ibe' && parts[2] === 'spherex') out.release = parts[3];
  const file = parts[parts.length - 1] || '';
  const m = /^level2_(.+)D([1-6])_spx_/.exec(file);
  if (m) {
    out.obsid = m[1];
    out.det = Number(m[2]);
  } else if (parts.length >= 2 && /^[1-6]$/.test(parts[parts.length - 2])) {
    out.det = Number(parts[parts.length - 2]);
  }
  return out;
}

/**
 * RFC 4180 style CSV parser: quoted fields, doubled quotes, commas and newlines inside quotes,
 * CRLF or LF, a leading BOM, blank lines skipped. Returns an array of rows of strings.
 */
export function parseCsv(text) {
  const rows = [];
  if (typeof text !== 'string' || text.length === 0) return rows;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  let row = [];
  let field = '';
  let quoted = false; // the current field started with a quote
  let inQuotes = false;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0].trim() !== '' || quoted) rows.push(row);
    row = [];
    quoted = false;
  };
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
      quoted = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
      i++;
    } else if (c === '\n') {
      endRow();
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Parses a CSV with a header row into objects keyed by lower-cased, trimmed column names. */
export function parseCsvTable(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { columns: [], records: [] };
  const columns = rows[0].map((name) => name.trim().toLowerCase());
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const rec = {};
    for (let c = 0; c < columns.length; c++) rec[columns[c]] = (rows[r][c] ?? '').trim();
    records.push(rec);
  }
  return { columns, records };
}

/** True when a body looks like an HTML page (gateway errors arrive as HTML with any status). */
export function looksLikeHtml(text, contentType = '') {
  if (/text\/html|application\/xhtml/i.test(contentType || '')) return true;
  const head = String(text || '').slice(0, 512).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body');
}

/** Pulls a human-readable message out of an HTML page or a VOTable error document. */
export function extractErrorText(text) {
  const body = String(text || '');
  const info = /<INFO[^>]*name="QUERY_STATUS"[^>]*value="ERROR"[^>]*>([\s\S]*?)<\/INFO>/i.exec(body);
  if (info) return collapse(info[1]);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  if (title) return collapse(title[1]);
  return collapse(body.replace(/<[^>]*>/g, ' ')).slice(0, 200);
}

function collapse(text) {
  return String(text).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const noLog = () => {};

/**
 * Runs `fetchImpl(url, init)` and `consume(response)` under one timeout. The timer covers the
 * body as well as the headers. Rejects with UpstreamError (kind 'timeout' or 'network').
 * `consume` may throw UpstreamError itself; other errors are wrapped as retryable.
 */
export async function fetchWithTimeout(fetchImpl, url, init, timeoutMs, consume, label = 'upstream') {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));
  try {
    const response = await fetchImpl(url, { ...(init || {}), signal: controller.signal });
    return await consume(response);
  } catch (err) {
    if (timedOut) {
      throw new UpstreamError(`${label} did not answer within ${Math.round(timeoutMs / 100) / 10} s`, {
        kind: 'timeout',
        status: 504,
      });
    }
    if (err instanceof UpstreamError) throw err;
    const message = err && err.message ? err.message : String(err);
    throw new UpstreamError(`${label} request failed: ${message}`, { kind: 'network' });
  } finally {
    clearTimeout(timer);
    // Make sure the connection is released even when the body was only partly read.
    if (!controller.signal.aborted) {
      try {
        controller.abort();
      } catch {
        // nothing to release
      }
    }
  }
}

/** Reads a response body as bytes, refusing to buffer more than `maxBytes`. */
export async function readBytesLimited(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const all = new Uint8Array(await response.arrayBuffer());
    if (all.byteLength > maxBytes) throw new UpstreamError('upstream answer is too large', { kind: 'parse', retryable: false });
    return all;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // already closed
      }
      throw new UpstreamError('upstream answer is too large', { kind: 'parse', retryable: false });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Reads a response body as UTF-8 text with a size bound. */
export async function readTextLimited(response, maxBytes = MAX_TEXT_BYTES) {
  return new TextDecoder().decode(await readBytesLimited(response, maxBytes));
}

async function discardBody(response) {
  try {
    if (response && response.body) await response.body.cancel();
  } catch {
    // body already consumed or locked
  }
}

/**
 * Turns a non-2xx response into an UpstreamError. 5xx, 408 and 429 are worth retrying; other
 * 4xx are not. `notFoundIs404` maps an upstream 404 to our own 404.
 */
export async function httpFailure(response, label, { notFoundIs404 = false } = {}) {
  let detail = '';
  try {
    detail = extractErrorText(await readTextLimited(response, 64 * 1024));
  } catch {
    await discardBody(response);
  }
  const status = response.status;
  const retryable = status >= 500 || status === 408 || status === 429;
  const suffix = detail ? `: ${detail}` : '';
  if (status === 404 && notFoundIs404) {
    return new UpstreamError(`${label} has no such file (404)`, { kind: 'notfound', status: 404, retryable: false, upstreamStatus: 404 });
  }
  return new UpstreamError(`${label} answered HTTP ${status}${suffix}`, {
    kind: 'http',
    status: 502,
    retryable,
    upstreamStatus: status,
  });
}

function formatDeg(value, digits = 6) {
  // Fixed notation without exponent, trailing zeros removed.
  let text = Number(value).toFixed(digits);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

function assertPosition(ra, dec) {
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || ra < 0 || ra > 360 || dec < -90 || dec > 90) {
    throw new UpstreamError('ra must be within 0..360 and dec within -90..90 degrees', {
      kind: 'input',
      status: 400,
      retryable: false,
    });
  }
}

/** The ADQL of the contract: every Level-2 artifact whose footprint contains the point. */
export function buildSearchQuery(ra, dec) {
  return (
    'SELECT a.uri, p.energy_bandpassname, p.time_bounds_lower ' +
    'FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid ' +
    `WHERE 1 = CONTAINS(POINT('ICRS', ${formatDeg(ra, 7)}, ${formatDeg(dec, 7)}), p.poly) ` +
    'ORDER BY p.time_bounds_lower'
  );
}

function releaseRank(release) {
  // Data releases beat quick releases; within a kind the higher number wins.
  const m = /^([a-z]+)(\d+)$/.exec(String(release || ''));
  if (!m) return 0;
  const kind = m[1] === 'dr' ? 2 : m[1] === 'qr' ? 1 : 0;
  return kind * 1000 + Number(m[2]);
}

/**
 * Turns the TAP CSV into FrameRef[]: valid Level-2 uris only, one entry per obsid + detector
 * (dr1 preferred over qr3), sorted by mjd. Throws UpstreamError('parse') when the text is not
 * the expected table at all.
 */
export function parseSearchCsv(text) {
  if (looksLikeHtml(text)) {
    throw new UpstreamError(`IRSA sent an HTML page instead of a table: ${extractErrorText(text)}`, { kind: 'html' });
  }
  const trimmed = String(text || '').trimStart();
  if (trimmed.startsWith('<')) {
    throw new UpstreamError(`IRSA sent an error document: ${extractErrorText(text)}`, { kind: 'parse' });
  }
  const { columns, records } = parseCsvTable(text);
  if (!columns.includes('uri')) {
    throw new UpstreamError('IRSA search answer has no uri column', { kind: 'parse' });
  }
  const best = new Map();
  for (const rec of records) {
    const uri = rec.uri;
    if (!isValidFrameId(uri)) continue;
    const fromUri = parseFrameUri(uri);
    const band = /D([1-6])\s*$/.exec(rec.energy_bandpassname || '');
    const det = band ? Number(band[1]) : fromUri.det;
    const mjd = Number(rec.time_bounds_lower);
    if (!det || !Number.isFinite(mjd) || rec.time_bounds_lower === '') continue;
    const obsid = fromUri.obsid || uri;
    const ref = { id: uri, det, mjd, release: fromUri.release || '', obsid };
    const key = `${obsid}|${det}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, ref);
      continue;
    }
    const a = releaseRank(ref.release);
    const b = releaseRank(prev.release);
    if (a > b || (a === b && ref.id > prev.id)) best.set(key, ref);
  }
  return [...best.values()].sort((p, q) => p.mjd - q.mjd || p.det - q.det || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}

function tapForm(query, extra) {
  const form = new URLSearchParams();
  form.set('REQUEST', 'doQuery');
  form.set('LANG', 'ADQL');
  form.set('FORMAT', 'csv');
  form.set('QUERY', query);
  for (const [k, v] of Object.entries(extra || {})) form.set(k, v);
  return form.toString();
}

const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/csv, text/plain, */*' };

/**
 * One synchronous TAP query. Returns the CSV text. Used for IRSA and for other TAP services
 * (Gaia, VizieR, SIMBAD), hence the `label`.
 */
export async function tapSyncCsv(endpoint, query, { fetchImpl = globalThis.fetch, timeoutMs = 75000, label = 'TAP', format = 'csv' } = {}) {
  const body = tapForm(query, { FORMAT: format });
  return fetchWithTimeout(
    fetchImpl,
    endpoint,
    { method: 'POST', headers: FORM_HEADERS, body },
    timeoutMs,
    async (response) => {
      if (!response.ok) throw await httpFailure(response, label);
      const text = await readTextLimited(response);
      if (looksLikeHtml(text, response.headers.get('content-type') || '')) {
        throw new UpstreamError(`${label} sent an HTML page instead of a table: ${extractErrorText(text)}`, { kind: 'html' });
      }
      return text;
    },
    label,
  );
}

/** Accepts only https job URLs on the IRSA host under /TAP/async/. */
export function normalizeJobUrl(candidate, base = IRSA_BASE) {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 500) return null;
  let url;
  let home;
  try {
    home = new URL(base);
    url = new URL(candidate, `${home.origin}/TAP/async/`);
  } catch {
    return null;
  }
  if (url.hostname !== home.hostname) return null;
  const m = /^\/TAP\/async\/([A-Za-z0-9_.\-]+)\/?$/.exec(url.pathname);
  if (!m) return null;
  return `${home.origin}/TAP/async/${m[1]}`;
}

async function submitAsyncJob(base, query, { fetchImpl, timeoutMs }) {
  return fetchWithTimeout(
    fetchImpl,
    `${base}/TAP/async`,
    { method: 'POST', headers: FORM_HEADERS, body: tapForm(query, { PHASE: 'RUN' }) },
    timeoutMs,
    async (response) => {
      // UWS answers 303 with the job URL. fetch normally follows it, so the job URL is then
      // response.url; a runtime that does not follow leaves it in the Location header.
      const location = response.headers.get('location');
      let jobUrl = normalizeJobUrl(location || '', base);
      if (!jobUrl && response.status >= 400) throw await httpFailure(response, 'IRSA TAP async');
      let text = '';
      try {
        text = await readTextLimited(response, 256 * 1024);
      } catch {
        text = '';
      }
      if (!jobUrl) jobUrl = normalizeJobUrl(response.url || '', base);
      if (!jobUrl) {
        const m = /<(?:uws:)?jobId>\s*([A-Za-z0-9_.\-]+)\s*<\/(?:uws:)?jobId>/.exec(text);
        if (m) jobUrl = normalizeJobUrl(`${base}/TAP/async/${m[1]}`, base);
      }
      if (!jobUrl) {
        const kind = looksLikeHtml(text, response.headers.get('content-type') || '') ? 'html' : 'parse';
        throw new UpstreamError(`IRSA TAP async did not return a job: ${extractErrorText(text) || `HTTP ${response.status}`}`, { kind });
      }
      return jobUrl;
    },
    'IRSA TAP async',
  );
}

async function readJobPhase(jobUrl, { fetchImpl, timeoutMs }) {
  return fetchWithTimeout(
    fetchImpl,
    `${jobUrl}/phase`,
    { method: 'GET', headers: { accept: 'text/plain, */*' } },
    timeoutMs,
    async (response) => {
      if (response.status === 404 || response.status === 410) {
        await discardBody(response);
        throw new UpstreamError('IRSA async job no longer exists', { kind: 'job', upstreamStatus: response.status });
      }
      if (!response.ok) throw await httpFailure(response, 'IRSA TAP async phase');
      const text = (await readTextLimited(response, 64 * 1024)).trim();
      const m = /\b(PENDING|QUEUED|EXECUTING|COMPLETED|ERROR|ABORTED|HELD|SUSPENDED|ARCHIVED|UNKNOWN)\b/.exec(text.toUpperCase());
      if (!m) throw new UpstreamError(`IRSA async job phase is unreadable: ${extractErrorText(text)}`, { kind: 'parse' });
      return m[1];
    },
    'IRSA TAP async phase',
  );
}

async function readJobError(jobUrl, { fetchImpl }) {
  try {
    return await fetchWithTimeout(
      fetchImpl,
      `${jobUrl}/error`,
      { method: 'GET' },
      10000,
      async (response) => extractErrorText(await readTextLimited(response, 64 * 1024)),
      'IRSA TAP async error',
    );
  } catch {
    return '';
  }
}

async function readJobResult(jobUrl, { fetchImpl, timeoutMs }) {
  return fetchWithTimeout(
    fetchImpl,
    `${jobUrl}/results/result`,
    { method: 'GET', headers: { accept: 'text/csv, text/plain, */*' } },
    timeoutMs,
    async (response) => {
      if (!response.ok) throw await httpFailure(response, 'IRSA TAP async result');
      return readTextLimited(response);
    },
    'IRSA TAP async result',
  );
}

/**
 * Polls an async job until it completes or `waitMs` runs out. Resolves with FrameRef[].
 * Throws kind 'timeout' while the job is still alive (it can be resumed later) and kind 'job'
 * when the job is dead.
 */
async function waitForJob(jobUrl, waitMs, ctx) {
  const { fetchImpl, sleep, pollMs, log } = ctx;
  const started = Date.now();
  const left = () => waitMs - (Date.now() - started);
  let failures = 0;
  let interval = pollMs;
  let lastPhase = 'UNKNOWN';
  for (;;) {
    if (left() <= 0) break;
    let phase;
    try {
      phase = await readJobPhase(jobUrl, { fetchImpl, timeoutMs: Math.max(1, Math.min(15000, left())) });
      failures = 0;
    } catch (err) {
      if (err.kind === 'job') throw err;
      failures++;
      log(`irsa async: phase check failed (${failures}): ${err.message}`);
      if (failures >= 3 && err.kind !== 'timeout') throw err;
      if (failures >= 4) throw err;
      phase = lastPhase;
    }
    lastPhase = phase;
    if (phase === 'COMPLETED') {
      // The job is done; a failed download of its result is worth one more try.
      for (let attempt = 0; ; attempt++) {
        const budget = Math.max(5000, Math.min(60000, left()));
        try {
          const text = await readJobResult(jobUrl, { fetchImpl, timeoutMs: budget });
          return parseSearchCsv(text);
        } catch (err) {
          if (attempt >= 1 || !err.retryable) throw err;
          log(`irsa async: result download failed (${err.message}), retrying`);
          await sleep(Math.min(1000, pollMs));
        }
      }
    }
    if (phase === 'ERROR' || phase === 'ABORTED' || phase === 'ARCHIVED') {
      const detail = phase === 'ERROR' ? await readJobError(jobUrl, { fetchImpl }) : '';
      throw new UpstreamError(`IRSA async job ended in ${phase}${detail ? `: ${detail}` : ''}`, { kind: 'job' });
    }
    const pause = Math.min(interval, left());
    if (pause <= 0) break;
    await sleep(pause);
    interval = Math.min(5000, Math.round(interval * 1.5));
  }
  throw new UpstreamError(`IRSA search job is still ${lastPhase.toLowerCase()} after ${Math.round(waitMs / 1000)} s`, {
    kind: 'timeout',
    status: 504,
  });
}

/**
 * searchFrames(ra, dec, opts) -> Promise<FrameRef[]>, sorted by mjd.
 *
 * opts: fetchImpl; timeoutMs (per sync attempt, default 75 s); attempts (default 3);
 * backoffMs (default 1500, doubled each retry); totalTimeoutMs (overall budget, default
 * unlimited); asyncFallback (default true); pollMs (first async poll interval, default 2000);
 * resumeJobUrl (an async job from an earlier, cut-short request); onJob(url|null) (called when
 * a job is created, and with null when it is finished or dead); sleep, log, base (for tests).
 *
 * Order: resume a known job (briefly) -> sync attempts (a timeout ends them early, since a
 * second 75 s wait rarely helps) -> async job with whatever budget is left.
 */
export async function searchFrames(ra, dec, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    timeoutMs = 75000,
    attempts = 3,
    backoffMs = 1500,
    totalTimeoutMs = Infinity,
    asyncFallback = true,
    pollMs = 2000,
    resumeWaitMs = 45000,
    sleep = defaultSleep,
    log = noLog,
    base = IRSA_BASE,
    onJob = null,
  } = opts;
  assertPosition(ra, dec);
  const started = Date.now();
  const remaining = () => totalTimeoutMs - (Date.now() - started);
  const query = buildSearchQuery(ra, dec);
  const ctx = { fetchImpl, sleep, pollMs, log };
  const notify = (url) => {
    if (typeof onJob !== 'function') return;
    try {
      onJob(url);
    } catch {
      // a bookkeeping callback must not break the search
    }
  };
  let lastError = null;
  let jobUrl = normalizeJobUrl(opts.resumeJobUrl || '', base);

  if (jobUrl) {
    try {
      const frames = await waitForJob(jobUrl, Math.min(resumeWaitMs, remaining() - 1000), ctx);
      notify(null);
      log(`irsa search: resumed async job gave ${frames.length} frames`);
      return frames;
    } catch (err) {
      lastError = err;
      log(`irsa search: resumed job not usable: ${err.message}`);
      if (err.kind !== 'timeout') {
        jobUrl = null;
        notify(null);
      }
    }
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const budget = Math.min(timeoutMs, remaining() - 500);
    if (budget < Math.min(1000, timeoutMs)) break; // not enough time left for a useful attempt
    const t0 = Date.now();
    try {
      const text = await tapSyncCsv(`${base}/TAP/sync`, query, { fetchImpl, timeoutMs: budget, label: 'IRSA TAP' });
      const frames = parseSearchCsv(text);
      log(`irsa search: sync attempt ${attempt} ok, ${frames.length} frames in ${Date.now() - t0} ms`);
      return frames;
    } catch (err) {
      lastError = err;
      log(`irsa search: sync attempt ${attempt}/${attempts} failed after ${Date.now() - t0} ms: ${err.message}`);
      if (!err.retryable) throw err;
      if (err.kind === 'timeout') break;
      if (attempt < attempts) {
        const pause = Math.min(backoffMs * 2 ** (attempt - 1), Math.max(0, remaining() - 1000));
        if (pause > 0) await sleep(pause);
      }
    }
  }

  if (asyncFallback && remaining() > 2000) {
    try {
      if (!jobUrl) {
        jobUrl = await submitAsyncJob(base, query, { fetchImpl, timeoutMs: Math.min(30000, remaining() - 500) });
        log(`irsa search: async job started ${jobUrl}`);
        notify(jobUrl);
      }
      const frames = await waitForJob(jobUrl, remaining() - 500, ctx);
      notify(null);
      log(`irsa search: async job gave ${frames.length} frames`);
      return frames;
    } catch (err) {
      log(`irsa search: async fallback failed: ${err.message}`);
      if (err.kind !== 'timeout') notify(null);
      // Report the timeout of a live job; otherwise keep the more telling sync error.
      if (err.kind === 'timeout' || !lastError) lastError = err;
    }
  }

  throw lastError || new UpstreamError('IRSA search ran out of time', { kind: 'timeout', status: 504 });
}

/** The cutout URL for a validated id. Coordinates are written in plain fixed notation. */
export function cutoutUrl(id, ra, dec, size, base = IRSA_BASE) {
  if (!isValidFrameId(id)) {
    throw new UpstreamError('id is not a SPHEREx Level-2 file path', { kind: 'input', status: 400, retryable: false });
  }
  assertPosition(ra, dec);
  if (!Number.isFinite(size) || size <= 0 || size > 1) {
    throw new UpstreamError('size must be a positive number of degrees', { kind: 'input', status: 400, retryable: false });
  }
  return `${base}/${id}?center=${formatDeg(ra)},${formatDeg(dec)}d&size=${formatDeg(size, 4)}`;
}

async function withRetries(run, { retries, backoffMs, sleep, log, label }) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await run(attempt);
    } catch (err) {
      lastError = err instanceof UpstreamError ? err : new UpstreamError(`${label} failed: ${err && err.message ? err.message : err}`);
      if (!lastError.retryable || attempt === retries) break;
      log(`${label}: attempt ${attempt + 1} failed (${lastError.message}), retrying`);
      await sleep(backoffMs * 2 ** attempt);
    }
  }
  throw lastError;
}

function startsWithSimple(u8) {
  // 'SIMPLE  =' opens every FITS file.
  const magic = [0x53, 0x49, 0x4d, 0x50, 0x4c, 0x45];
  if (!u8 || u8.byteLength < 2880) return false;
  for (let i = 0; i < magic.length; i++) if (u8[i] !== magic[i]) return false;
  return true;
}

/**
 * fetchCutoutHead(id, ra, dec, size, opts) -> Promise<Uint8Array>: the bytes of a cutout up to
 * the end of the ZODI HDU. The 3.9 MB PSF table that follows is never downloaded: the stream is
 * handed to readUntilPsf, which cancels it as soon as the EPSF header appears.
 *
 * opts: fetchImpl; timeoutMs (per attempt, default 40 s); retries (default 2); backoffMs;
 * readUntilPsf (defaults to the one in fits.js); validate(head) (may throw to force a retry);
 * sleep, log, base.
 */
export async function fetchCutoutHead(id, ra, dec, size, opts = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = 40000, retries = 2, backoffMs = 600, sleep = defaultSleep, log = noLog, base = IRSA_BASE } = opts;
  const url = cutoutUrl(id, ra, dec, size, base);
  const readUntilPsf = opts.readUntilPsf || (await import('./fits.js')).readUntilPsf;
  return withRetries(
    () =>
      fetchWithTimeout(
        fetchImpl,
        url,
        { method: 'GET', headers: { accept: 'application/fits, application/octet-stream, */*' } },
        timeoutMs,
        async (response) => {
          if (!response.ok) throw await httpFailure(response, 'IRSA cutout', { notFoundIs404: true });
          if (/text\/html/i.test(response.headers.get('content-type') || '')) {
            const text = await readTextLimited(response, 64 * 1024).catch(() => '');
            throw new UpstreamError(`IRSA sent an HTML page instead of a FITS file: ${extractErrorText(text)}`, { kind: 'html' });
          }
          if (!response.body) throw new UpstreamError('IRSA cutout answer has no body', { kind: 'network' });
          let head;
          try {
            head = await readUntilPsf(response.body);
          } catch (err) {
            if (err instanceof UpstreamError) throw err;
            throw new UpstreamError(`IRSA cutout could not be read: ${err && err.message ? err.message : err}`, { kind: 'parse' });
          }
          if (!startsWithSimple(head)) {
            throw new UpstreamError('IRSA cutout is not a FITS file', { kind: 'parse' });
          }
          if (typeof opts.validate === 'function') {
            // readUntilPsf returns what it has when a connection drops early; let the caller
            // reject an incomplete head so that it is downloaded again.
            try {
              opts.validate(head);
            } catch (err) {
              if (err instanceof UpstreamError) throw err;
              throw new UpstreamError(`IRSA cutout is incomplete: ${err && err.message ? err.message : err}`, { kind: 'parse' });
            }
          }
          return head;
        },
        'IRSA cutout',
      ),
    { retries, backoffMs, sleep, log, label: 'irsa cutout' },
  );
}

/**
 * fetchWaveTable(det, sampleId, opts) -> Promise<table>: downloads one whole 0.02 deg cutout of
 * `sampleId` (about 4 MB, the WCS-WAVE HDU is at the very end) and returns its wavelength
 * lookup table. The table is the same for every file of a detector, so call this once per
 * detector and keep the result.
 *
 * opts.ra / opts.dec are required: IRSA only cuts out around a position inside the image, and
 * without a centre it would send the full 70 MB file. Other opts: fetchImpl, timeoutMs
 * (default 90 s), retries (default 2), parseMef / readWaveTable (default to fits.js), size.
 */
export async function fetchWaveTable(det, sampleId, opts = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = 90000, retries = 2, backoffMs = 800, sleep = defaultSleep, log = noLog, base = IRSA_BASE, size = 0.02 } = opts;
  if (!Number.isInteger(det) || det < 1 || det > 6) {
    throw new UpstreamError('det must be 1..6', { kind: 'input', status: 400, retryable: false });
  }
  if (!Number.isFinite(opts.ra) || !Number.isFinite(opts.dec)) {
    throw new UpstreamError('fetchWaveTable needs opts.ra and opts.dec (a position inside the sample frame)', {
      kind: 'input',
      status: 400,
      retryable: false,
    });
  }
  const url = cutoutUrl(sampleId, opts.ra, opts.dec, size, base);
  const fromId = parseFrameUri(sampleId).det;
  if (fromId && fromId !== det) {
    throw new UpstreamError(`sample frame is detector ${fromId}, not ${det}`, { kind: 'input', status: 400, retryable: false });
  }
  let parseMef = opts.parseMef;
  let readWaveTable = opts.readWaveTable;
  if (!parseMef || !readWaveTable) {
    const fits = await import('./fits.js');
    parseMef = parseMef || fits.parseMef;
    readWaveTable = readWaveTable || fits.readWaveTable;
  }
  return withRetries(
    () =>
      fetchWithTimeout(
        fetchImpl,
        url,
        { method: 'GET', headers: { accept: 'application/fits, application/octet-stream, */*' } },
        timeoutMs,
        async (response) => {
          if (!response.ok) throw await httpFailure(response, 'IRSA cutout', { notFoundIs404: true });
          const u8 = await readBytesLimited(response, MAX_CUTOUT_BYTES);
          if (!startsWithSimple(u8)) {
            const text = new TextDecoder().decode(u8.subarray(0, 2048));
            throw new UpstreamError(`IRSA cutout is not a FITS file: ${extractErrorText(text)}`, { kind: looksLikeHtml(text) ? 'html' : 'parse' });
          }
          let table;
          try {
            const hdus = parseMef(u8);
            const hdu = hdus.find((h) => String(h.name || '').trim().toUpperCase() === 'WCS-WAVE');
            if (!hdu) throw new Error('no WCS-WAVE extension (download cut short?)');
            table = readWaveTable(u8, hdu);
          } catch (err) {
            if (err instanceof UpstreamError) throw err;
            throw new UpstreamError(`wavelength table could not be read: ${err && err.message ? err.message : err}`, { kind: 'parse' });
          }
          if (!isWaveTable(table)) throw new UpstreamError('wavelength table has an unexpected layout', { kind: 'parse' });
          log(`irsa wave table: detector ${det} read from ${u8.byteLength} bytes`);
          return table;
        },
        'IRSA cutout',
      ),
    { retries, backoffMs, sleep, log, label: 'irsa wave table' },
  );
}

/** Structural check of a wavelength table: nx * ny nodes, two values per node. */
export function isWaveTable(table) {
  if (!table || typeof table !== 'object') return false;
  const { x, y, values, nx, ny } = table;
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 2 || ny < 2) return false;
  if (!x || !y || !values) return false;
  return x.length === nx && y.length === ny && values.length === 2 * nx * ny;
}
