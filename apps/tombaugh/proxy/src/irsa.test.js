// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UpstreamError,
  buildSearchQuery,
  cutoutUrl,
  extractErrorText,
  fetchCutoutHead,
  fetchWaveTable,
  isValidFrameId,
  looksLikeHtml,
  normalizeJobUrl,
  parseCsv,
  parseCsvTable,
  parseFrameUri,
  parseSearchCsv,
  searchFrames,
} from './irsa.js';

const URI_QR3 = 'ibe/data/spherex/qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits';
const URI_DR1 = 'ibe/data/spherex/dr1/level2/2026W25_2A/l2b-v30-2026-300/2/level2_2026W25_2A_0279_1D2_spx_l2b-v30-2026-300.fits';
const URI_D3 = 'ibe/data/spherex/qr3/level2/2026W25_2A/l2b-v27-2026-273/3/level2_2026W25_2A_0279_1D3_spx_l2b-v27-2026-273.fits';
const URI_EARLY = 'ibe/data/spherex/qr3/level2/2025W23_1B/l2b-v27-2026-273/2/level2_2025W23_1B_0101_2D2_spx_l2b-v27-2026-273.fits';

const CSV_OK = [
  'uri,energy_bandpassname,time_bounds_lower',
  `${URI_QR3},SPHEREx-D2,61210.79244684`,
  `${URI_DR1},SPHEREx-D2,61210.79244684`,
  `${URI_D3},SPHEREx-D3,61210.79244684`,
  `${URI_EARLY},SPHEREx-D2,60834.123`,
  '',
].join('\n');

const HTML_502 = '<!DOCTYPE html>\n<html><head><title>502 Bad Gateway</title></head><body><h1>Bad Gateway</h1></body></html>';

const noSleep = async () => {};

/** A fetch whose answers come from a queue of functions (the last one repeats). */
function queueFetch(steps) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const step = steps.length > 1 ? steps.shift() : steps[0];
    return step(String(url), init);
  };
  return { fetchImpl, calls };
}

const text = (body, status = 200, headers = { 'content-type': 'text/csv' }) => () => new Response(body, { status, headers });
const hang = (url, init) =>
  new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
  });

function fitsBytes(length = 5760) {
  const u8 = new Uint8Array(length).fill(0x20);
  u8.set(new TextEncoder().encode('SIMPLE  =                    T'), 0);
  return u8;
}

// ------------------------------------------------------------------ ids

test('isValidFrameId accepts Level-2 uris only', () => {
  assert.equal(isValidFrameId(URI_QR3), true);
  assert.equal(isValidFrameId(URI_DR1), true);
  for (const bad of [
    '',
    null,
    42,
    `https://irsa.ipac.caltech.edu/${URI_QR3}`,
    `/${URI_QR3}`,
    'ibe/data/spherex/qr3/level2/../../../../etc/passwd.fits',
    'ibe/data/spherex/qr3/level2/a/..%2f..%2fsecret.fits',
    `${URI_QR3}?center=1,2`,
    `${URI_QR3}#x`,
    'ibe/data/spherex/qr3/level2/a b.fits',
    'ibe/data/spherex/QR3/level2/a.fits',
    'ibe/data/spherex/qr3/level1/a.fits',
    'ibe/data/wise/qr3/level2/a.fits',
    'ibe/data/spherex/qr3/level2/a.fits.txt',
    'ibe/data/spherex/qr3/level2//a.fits',
    'ibe/data/spherex/qr3/level2/a\n.fits',
    'ibe/data/spherex/qr3/level2/@evil.example/a.fits',
    `ibe/data/spherex/qr3/level2/${'a'.repeat(500)}.fits`,
  ]) {
    assert.equal(isValidFrameId(bad), false, `should reject ${String(bad).slice(0, 60)}`);
  }
});

test('parseFrameUri extracts release, detector and observation id', () => {
  assert.deepEqual(parseFrameUri(URI_QR3), { release: 'qr3', det: 2, obsid: '2026W25_2A_0279_1' });
  assert.deepEqual(parseFrameUri(URI_DR1), { release: 'dr1', det: 2, obsid: '2026W25_2A_0279_1' });
  assert.deepEqual(parseFrameUri('nonsense'), { release: null, det: null, obsid: null });
});

test('cutoutUrl builds the IRSA cutout request and refuses anything else', () => {
  assert.equal(
    cutoutUrl(URI_QR3, 210.80227, 54.34895, 0.1),
    `https://irsa.ipac.caltech.edu/${URI_QR3}?center=210.80227,54.34895d&size=0.1`,
  );
  assert.equal(cutoutUrl(URI_QR3, 0.0000001, -7.2451472, 0.02).endsWith('?center=0,-7.245147d&size=0.02'), true);
  assert.throws(() => cutoutUrl('http://evil.example/x.fits', 1, 2, 0.1), (e) => e instanceof UpstreamError && e.status === 400);
  assert.throws(() => cutoutUrl(URI_QR3, 400, 2, 0.1), (e) => e.status === 400);
  assert.throws(() => cutoutUrl(URI_QR3, 1, 2, NaN), (e) => e.status === 400);
});

// ------------------------------------------------------------------ CSV

test('parseCsv handles quotes, embedded commas and newlines, CRLF, BOM and blank lines', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""",3\r\n\r\n"multi\nline",,\n last , z,\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'he said "hi"', '3'],
    ['multi\nline', '', ''],
    [' last ', ' z', ''],
  ]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('only'), [['only']]);
  assert.deepEqual(parseCsv('""\n'), [['']]);
});

test('parseCsvTable lower-cases column names and trims values', () => {
  const { columns, records } = parseCsvTable('URI, Energy_BandpassName\n a , b \n');
  assert.deepEqual(columns, ['uri', 'energy_bandpassname']);
  assert.deepEqual(records, [{ uri: 'a', energy_bandpassname: 'b' }]);
});

test('parseSearchCsv sorts by mjd, dedupes obsid+det preferring dr1, and drops bad rows', () => {
  const csv =
    CSV_OK +
    [
      'ibe/data/spherex/qr3/level2/../../x.fits,SPHEREx-D2,60000',
      'https://evil.example/a.fits,SPHEREx-D2,60000',
      'ibe/data/spherex/qr3/level3/mosaic.fits,SPHEREx-D2,60000',
      `${URI_D3.replace('0279_1D3', '0280_1D3')},SPHEREx-D3,not-a-number`,
      `${URI_D3.replace('0279_1D3', '0281_1D3')},SPHEREx-D3,`,
    ].join('\n');
  const frames = parseSearchCsv(csv);
  assert.equal(frames.length, 3);
  assert.deepEqual(frames[0], { id: URI_EARLY, det: 2, mjd: 60834.123, release: 'qr3', obsid: '2025W23_1B_0101_2' });
  assert.deepEqual(frames[1], { id: URI_DR1, det: 2, mjd: 61210.79244684, release: 'dr1', obsid: '2026W25_2A_0279_1' });
  assert.deepEqual(frames[2], { id: URI_D3, det: 3, mjd: 61210.79244684, release: 'qr3', obsid: '2026W25_2A_0279_1' });
});

test('parseSearchCsv prefers dr1 whatever the row order, and newer processing within a release', () => {
  const header = 'uri,energy_bandpassname,time_bounds_lower\n';
  const a = parseSearchCsv(`${header}${URI_DR1},SPHEREx-D2,61210.7\n${URI_QR3},SPHEREx-D2,61210.7\n`);
  assert.equal(a.length, 1);
  assert.equal(a[0].release, 'dr1');
  const newer = URI_QR3.replaceAll('l2b-v27-2026-273', 'l2b-v28-2026-290');
  const b = parseSearchCsv(`${header}${newer},SPHEREx-D2,61210.7\n${URI_QR3},SPHEREx-D2,61210.7\n`);
  assert.equal(b.length, 1);
  assert.equal(b[0].id, newer);
});

test('parseSearchCsv accepts an empty result and takes the detector from the uri if the band is odd', () => {
  assert.deepEqual(parseSearchCsv('uri,energy_bandpassname,time_bounds_lower\n'), []);
  const frames = parseSearchCsv(`"uri","energy_bandpassname","time_bounds_lower"\n"${URI_D3}","",61000.5\n`);
  assert.equal(frames[0].det, 3);
});

test('parseSearchCsv rejects HTML, VOTable errors and tables without a uri column', () => {
  assert.throws(() => parseSearchCsv(HTML_502), (e) => e instanceof UpstreamError && e.kind === 'html' && e.retryable && /502 Bad Gateway/.test(e.message));
  const votable = '<?xml version="1.0"?><VOTABLE><RESOURCE type="results"><INFO name="QUERY_STATUS" value="ERROR">table not found</INFO></RESOURCE></VOTABLE>';
  assert.throws(() => parseSearchCsv(votable), (e) => e.kind === 'parse' && /table not found/.test(e.message));
  assert.throws(() => parseSearchCsv('foo,bar\n1,2\n'), (e) => e.kind === 'parse');
  assert.throws(() => parseSearchCsv(''), (e) => e.kind === 'parse');
});

test('looksLikeHtml and extractErrorText', () => {
  assert.equal(looksLikeHtml('  <html><body>x</body></html>'), true);
  assert.equal(looksLikeHtml('uri,a\n', 'text/html; charset=utf-8'), true);
  assert.equal(looksLikeHtml('uri,a\n', 'text/csv'), false);
  assert.equal(extractErrorText(HTML_502), '502 Bad Gateway');
  assert.equal(extractErrorText('<p>plain   words</p>'), 'plain words');
});

test('buildSearchQuery is the ADQL of the contract', () => {
  const q = buildSearchQuery(269.452075, 4.693391);
  assert.match(q, /^SELECT a\.uri, p\.energy_bandpassname, p\.time_bounds_lower FROM spherex\.artifact a JOIN spherex\.plane p ON a\.planeid = p\.planeid/);
  assert.match(q, /WHERE 1 = CONTAINS\(POINT\('ICRS', 269\.452075, 4\.693391\), p\.poly\)/);
  assert.match(q, /ORDER BY p\.time_bounds_lower$/);
  assert.match(buildSearchQuery(1e-7, -1e-7), /POINT\('ICRS', 0\.0000001, -0\.0000001\)/);
});

// ------------------------------------------------------------------ searchFrames

test('searchFrames posts a form-encoded sync query and parses the answer', async () => {
  const { fetchImpl, calls } = queueFetch([text(CSV_OK)]);
  const frames = await searchFrames(269.45, 4.69, { fetchImpl, sleep: noSleep });
  assert.equal(frames.length, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://irsa.ipac.caltech.edu/TAP/sync');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('REQUEST'), 'doQuery');
  assert.equal(form.get('LANG'), 'ADQL');
  assert.equal(form.get('FORMAT'), 'csv');
  assert.equal(form.get('QUERY'), buildSearchQuery(269.45, 4.69));
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('searchFrames retries 502s and HTML pages with backoff, then succeeds', async () => {
  const { fetchImpl, calls } = queueFetch([text(HTML_502, 502, { 'content-type': 'text/html' }), text(HTML_502, 200, { 'content-type': 'text/html' }), text(CSV_OK)]);
  const pauses = [];
  const frames = await searchFrames(10, 20, { fetchImpl, sleep: async (ms) => pauses.push(ms), backoffMs: 100 });
  assert.equal(frames.length, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(pauses, [100, 200]);
});

test('searchFrames does not retry a 400 and does not start an async job for it', async () => {
  const { fetchImpl, calls } = queueFetch([text('<VOTABLE><INFO name="QUERY_STATUS" value="ERROR">bad column</INFO></VOTABLE>', 400, { 'content-type': 'text/xml' })]);
  await assert.rejects(
    searchFrames(10, 20, { fetchImpl, sleep: noSleep }),
    (e) => e instanceof UpstreamError && e.retryable === false && e.status === 502 && /bad column/.test(e.message),
  );
  assert.equal(calls.length, 1);
});

test('searchFrames rejects bad coordinates without calling upstream', async () => {
  const { fetchImpl, calls } = queueFetch([text(CSV_OK)]);
  await assert.rejects(searchFrames(NaN, 0, { fetchImpl }), (e) => e.status === 400);
  await assert.rejects(searchFrames(10, 91, { fetchImpl }), (e) => e.status === 400);
  assert.equal(calls.length, 0);
});

test('searchFrames: a sync timeout goes straight to the async protocol', async () => {
  const job = 'https://irsa.ipac.caltech.edu/TAP/async/job-123';
  const { fetchImpl, calls } = queueFetch([
    hang,
    () => new Response('', { status: 303, headers: { location: 'http://irsa.ipac.caltech.edu/TAP/async/job-123' } }),
    text('QUEUED', 200, { 'content-type': 'text/plain' }),
    text('EXECUTING\n', 200, { 'content-type': 'text/plain' }),
    text('COMPLETED', 200, { 'content-type': 'text/plain' }),
    text(CSV_OK),
  ]);
  const jobs = [];
  const frames = await searchFrames(10, 20, { fetchImpl, timeoutMs: 30, sleep: noSleep, onJob: (u) => jobs.push(u) });
  assert.equal(frames.length, 3);
  assert.deepEqual(
    calls.map((c) => `${c.init.method} ${c.url}`),
    [
      'POST https://irsa.ipac.caltech.edu/TAP/sync',
      'POST https://irsa.ipac.caltech.edu/TAP/async',
      `GET ${job}/phase`,
      `GET ${job}/phase`,
      `GET ${job}/phase`,
      `GET ${job}/results/result`,
    ],
  );
  assert.equal(new URLSearchParams(calls[1].init.body).get('PHASE'), 'RUN');
  assert.deepEqual(jobs, [job, null]);
});

test('searchFrames: three failed sync attempts fall back to an async job (job id from the XML)', async () => {
  const jobXml = '<?xml version="1.0"?><uws:job xmlns:uws="http://www.ivoa.net/xml/UWS/v1.0"><uws:jobId>abc_42</uws:jobId><uws:phase>QUEUED</uws:phase></uws:job>';
  const { fetchImpl, calls } = queueFetch([
    text('gateway', 502),
    text('gateway', 503),
    async () => {
      throw new TypeError('fetch failed');
    },
    text(jobXml, 200, { 'content-type': 'text/xml' }),
    text('COMPLETED'),
    text(CSV_OK),
  ]);
  const frames = await searchFrames(10, 20, { fetchImpl, sleep: noSleep });
  assert.equal(frames.length, 3);
  assert.equal(calls.length, 6);
  assert.equal(calls[4].url, 'https://irsa.ipac.caltech.edu/TAP/async/abc_42/phase');
});

test('searchFrames: a failed async job reports the sync error and forgets the job', async () => {
  const { fetchImpl } = queueFetch([
    text('gateway', 502),
    () => new Response('', { status: 303, headers: { location: 'https://irsa.ipac.caltech.edu/TAP/async/j1' } }),
    text('ERROR'),
    text('<VOTABLE><INFO name="QUERY_STATUS" value="ERROR">out of memory</INFO></VOTABLE>'),
  ]);
  const jobs = [];
  await assert.rejects(
    searchFrames(10, 20, { fetchImpl, attempts: 1, sleep: noSleep, onJob: (u) => jobs.push(u) }),
    (e) => e instanceof UpstreamError && e.kind === 'http' && e.status === 502 && e.retryable === true,
  );
  assert.deepEqual(jobs, ['https://irsa.ipac.caltech.edu/TAP/async/j1', null]);
});

test('searchFrames: when the budget runs out the job stays registered and the error is a 504', async () => {
  const { fetchImpl } = queueFetch([
    text('gateway', 502),
    () => new Response('', { status: 303, headers: { location: 'https://irsa.ipac.caltech.edu/TAP/async/slow' } }),
    text('EXECUTING'),
  ]);
  const jobs = [];
  await assert.rejects(
    searchFrames(10, 20, { fetchImpl, attempts: 1, totalTimeoutMs: 2600, pollMs: 20, timeoutMs: 50, onJob: (u) => jobs.push(u) }),
    (e) => e.kind === 'timeout' && e.status === 504 && e.retryable === true && /still executing/.test(e.message),
  );
  assert.deepEqual(jobs, ['https://irsa.ipac.caltech.edu/TAP/async/slow']);
});

test('searchFrames resumes a known async job before trying anything else', async () => {
  const job = 'https://irsa.ipac.caltech.edu/TAP/async/resume-me';
  const { fetchImpl, calls } = queueFetch([text('COMPLETED'), text(CSV_OK)]);
  const jobs = [];
  const frames = await searchFrames(10, 20, { fetchImpl, resumeJobUrl: job, sleep: noSleep, onJob: (u) => jobs.push(u) });
  assert.equal(frames.length, 3);
  assert.deepEqual(calls.map((c) => c.url), [`${job}/phase`, `${job}/results/result`]);
  assert.deepEqual(jobs, [null]);
});

test('searchFrames drops a dead resumed job and carries on with sync', async () => {
  const job = 'https://irsa.ipac.caltech.edu/TAP/async/gone';
  const { fetchImpl, calls } = queueFetch([text('not found', 404), text(CSV_OK)]);
  const jobs = [];
  const frames = await searchFrames(10, 20, { fetchImpl, resumeJobUrl: job, sleep: noSleep, onJob: (u) => jobs.push(u) });
  assert.equal(frames.length, 3);
  assert.equal(calls[1].url, 'https://irsa.ipac.caltech.edu/TAP/sync');
  assert.deepEqual(jobs, [null]);
});

test('searchFrames ignores a resume URL that is not an IRSA job', async () => {
  const { fetchImpl, calls } = queueFetch([text(CSV_OK)]);
  await searchFrames(10, 20, { fetchImpl, resumeJobUrl: 'https://evil.example/TAP/async/1', sleep: noSleep });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://irsa.ipac.caltech.edu/TAP/sync');
});

test('searchFrames with asyncFallback off throws the last sync error after all attempts', async () => {
  const { fetchImpl, calls } = queueFetch([text('gateway', 502)]);
  await assert.rejects(searchFrames(10, 20, { fetchImpl, sleep: noSleep, asyncFallback: false }), (e) => e.kind === 'http' && e.upstreamStatus === 502);
  assert.equal(calls.length, 3);
});

test('normalizeJobUrl only accepts job URLs on the IRSA host', () => {
  assert.equal(normalizeJobUrl('http://irsa.ipac.caltech.edu/TAP/async/abc'), 'https://irsa.ipac.caltech.edu/TAP/async/abc');
  assert.equal(normalizeJobUrl('/TAP/async/abc/'), 'https://irsa.ipac.caltech.edu/TAP/async/abc');
  assert.equal(normalizeJobUrl('https://evil.example/TAP/async/abc'), null);
  assert.equal(normalizeJobUrl('https://irsa.ipac.caltech.edu/TAP/async/abc/../../secret'), null);
  assert.equal(normalizeJobUrl('https://irsa.ipac.caltech.edu/other/abc'), null);
  assert.equal(normalizeJobUrl('https://irsa.ipac.caltech.edu@evil.example/TAP/async/abc'), null);
  assert.equal(normalizeJobUrl(''), null);
});

// ------------------------------------------------------------------ cutouts

test('fetchCutoutHead hands the body stream to readUntilPsf and returns its bytes', async () => {
  const bytes = fitsBytes();
  const { fetchImpl, calls } = queueFetch([() => new Response(bytes, { status: 200, headers: { 'content-type': 'application/fits' } })]);
  let sawStream = false;
  const readUntilPsf = async (stream) => {
    sawStream = typeof stream.getReader === 'function';
    const reader = stream.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    return value.slice(0, 2880);
  };
  const head = await fetchCutoutHead(URI_QR3, 210.80227, 54.34895, 0.1, { fetchImpl, readUntilPsf });
  assert.equal(sawStream, true);
  assert.equal(head.byteLength, 2880);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://irsa.ipac.caltech.edu/${URI_QR3}?center=210.80227,54.34895d&size=0.1`);
});

test('fetchCutoutHead retries transient failures twice', async () => {
  const bytes = fitsBytes();
  const { fetchImpl, calls } = queueFetch([
    text('busy', 503),
    text(HTML_502, 200, { 'content-type': 'text/html' }),
    () => new Response(bytes, { status: 200 }),
  ]);
  const readUntilPsf = async (stream) => new Uint8Array(await new Response(stream).arrayBuffer());
  const head = await fetchCutoutHead(URI_QR3, 1, 2, 0.1, { fetchImpl, readUntilPsf, sleep: noSleep });
  assert.equal(head.byteLength, bytes.byteLength);
  assert.equal(calls.length, 3);
});

test('fetchCutoutHead gives up after three attempts with a retryable 502', async () => {
  const { fetchImpl, calls } = queueFetch([text('busy', 500)]);
  await assert.rejects(
    fetchCutoutHead(URI_QR3, 1, 2, 0.1, { fetchImpl, readUntilPsf: async () => fitsBytes(), sleep: noSleep }),
    (e) => e instanceof UpstreamError && e.status === 502 && e.retryable === true,
  );
  assert.equal(calls.length, 3);
});

test('fetchCutoutHead maps 404 to a non-retryable 404 without retrying', async () => {
  const { fetchImpl, calls } = queueFetch([text('no such file', 404)]);
  await assert.rejects(
    fetchCutoutHead(URI_QR3, 1, 2, 0.1, { fetchImpl, readUntilPsf: async () => fitsBytes(), sleep: noSleep }),
    (e) => e.status === 404 && e.retryable === false,
  );
  assert.equal(calls.length, 1);
});

test('fetchCutoutHead times out each attempt and reports a 504', async () => {
  const { fetchImpl, calls } = queueFetch([hang]);
  await assert.rejects(
    fetchCutoutHead(URI_QR3, 1, 2, 0.1, { fetchImpl, readUntilPsf: async () => fitsBytes(), timeoutMs: 20, sleep: noSleep }),
    (e) => e.kind === 'timeout' && e.status === 504 && e.retryable === true,
  );
  assert.equal(calls.length, 3);
});

test('fetchCutoutHead retries when the reader fails, the bytes are not FITS, or validation fails', async () => {
  let n = 0;
  const { fetchImpl, calls } = queueFetch([() => new Response(fitsBytes(), { status: 200 })]);
  const readUntilPsf = async (stream) => {
    await stream.cancel();
    n++;
    if (n === 1) throw new Error('stream ended early');
    if (n === 2) return new TextEncoder().encode('garbage');
    return fitsBytes();
  };
  let validated = 0;
  const validate = () => {
    validated++;
  };
  const head = await fetchCutoutHead(URI_QR3, 1, 2, 0.1, { fetchImpl, readUntilPsf, validate, sleep: noSleep });
  assert.equal(head.byteLength, 5760);
  assert.equal(calls.length, 3);
  assert.equal(validated, 1);

  const strict = queueFetch([() => new Response(fitsBytes(), { status: 200 })]);
  await assert.rejects(
    fetchCutoutHead(URI_QR3, 1, 2, 0.1, {
      fetchImpl: strict.fetchImpl,
      readUntilPsf: async (stream) => {
        await stream.cancel();
        return fitsBytes();
      },
      validate: () => {
        throw new Error('ZODI data cut short');
      },
      sleep: noSleep,
    }),
    (e) => e.kind === 'parse' && /cut short/.test(e.message),
  );
  assert.equal(strict.calls.length, 3);
});

test('fetchCutoutHead refuses ids that are not Level-2 uris and never calls upstream for them', async () => {
  const { fetchImpl, calls } = queueFetch([text('x')]);
  for (const bad of ['https://example.com/a.fits', 'ibe/data/spherex/qr3/level2/../../a.fits', `${URI_QR3}?x=1`]) {
    await assert.rejects(fetchCutoutHead(bad, 1, 2, 0.1, { fetchImpl, readUntilPsf: async () => fitsBytes() }), (e) => e.status === 400 && e.retryable === false);
  }
  assert.equal(calls.length, 0);
});

test('fetchWaveTable downloads one 0.02 deg cutout and reads its WCS-WAVE extension', async () => {
  const bytes = fitsBytes(8640);
  const { fetchImpl, calls } = queueFetch([text('busy', 502), () => new Response(bytes, { status: 200 })]);
  const table = { x: new Int32Array(11), y: new Int32Array(11), values: new Float32Array(242), nx: 11, ny: 11 };
  let parsedLength = 0;
  const parseMef = (u8) => {
    parsedLength = u8.byteLength;
    return [{ name: 'PRIMARY' }, { name: 'IMAGE' }, { name: 'WCS-WAVE', marker: true }];
  };
  const readWaveTable = (u8, hdu) => {
    assert.equal(hdu.marker, true);
    return table;
  };
  const got = await fetchWaveTable(2, URI_QR3, { fetchImpl, ra: 210.8, dec: 54.3, parseMef, readWaveTable, sleep: noSleep });
  assert.equal(got, table);
  assert.equal(parsedLength, 8640);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, `https://irsa.ipac.caltech.edu/${URI_QR3}?center=210.8,54.3d&size=0.02`);
});

test('fetchWaveTable validates its arguments and the table', async () => {
  const { fetchImpl, calls } = queueFetch([() => new Response(fitsBytes(), { status: 200 })]);
  const deps = { parseMef: () => [{ name: 'WCS-WAVE' }], readWaveTable: () => ({ nx: 11, ny: 11, x: [], y: [], values: [] }), sleep: noSleep };
  await assert.rejects(fetchWaveTable(2, URI_QR3, { fetchImpl, ...deps }), (e) => e.status === 400 && /opts\.ra/.test(e.message));
  await assert.rejects(fetchWaveTable(3, URI_QR3, { fetchImpl, ra: 1, dec: 2, ...deps }), (e) => e.status === 400 && /detector 2/.test(e.message));
  await assert.rejects(fetchWaveTable(9, URI_QR3, { fetchImpl, ra: 1, dec: 2, ...deps }), (e) => e.status === 400);
  assert.equal(calls.length, 0);
  await assert.rejects(fetchWaveTable(2, URI_QR3, { fetchImpl, ra: 1, dec: 2, ...deps }), (e) => e.kind === 'parse' && /unexpected layout/.test(e.message));
  await assert.rejects(
    fetchWaveTable(2, URI_QR3, { fetchImpl, ra: 1, dec: 2, ...deps, parseMef: () => [{ name: 'IMAGE' }] }),
    (e) => e.kind === 'parse' && /no WCS-WAVE/.test(e.message),
  );
});
