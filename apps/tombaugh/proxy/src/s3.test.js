// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  S3_BASE, ID_PREFIX, S3Error, listPrefixes, listKeys, rangeGet, idToKey, keyToId, isValidKey, parseKey, makeKey,
  listReleaseDirs, chooseReleases, releaseRank, parseListXml, decodeXml, mapLimit,
} from './s3.js';
import { createFakeS3 } from '../fixtures/fakes3.js';

const REAL_KEY = 'qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits';
const REAL_ID = `ibe/data/spherex/${REAL_KEY}`;
const fast = { backoffMs: 1, timeoutMs: 2000 };

function bytes(n, seed = 0) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

test('constants', () => {
  assert.equal(S3_BASE, 'https://nasa-irsa-spherex.s3.amazonaws.com');
  assert.equal(ID_PREFIX, 'ibe/data/spherex/');
});

test('idToKey / keyToId / parseKey / makeKey on the real file name', () => {
  assert.equal(idToKey(REAL_ID), REAL_KEY);
  assert.equal(idToKey(`/${REAL_ID}`), REAL_KEY);
  assert.equal(keyToId(REAL_KEY), REAL_ID);
  const parts = parseKey(REAL_KEY);
  assert.deepEqual(parts, {
    release: 'qr3', dir: '2026W25_2A', version: 'l2b-v27-2026-273', det: 2, obsid: '2026W25_2A_0279_1', suffix: '0279_1',
  });
  assert.equal(makeKey(parts), REAL_KEY);
  assert.equal(makeKey({ release: 'dr1', dir: '2025W30_1B', version: 'l2b-v20-2025-300', det: 6, suffix: '0009_1' }),
    'dr1/level2/2025W30_1B/l2b-v20-2025-300/6/level2_2025W30_1B_0009_1D6_spx_l2b-v20-2025-300.fits');
});

test('strict validation of ids and keys', () => {
  const bad = [
    '', 'ibe/data/spherex/', REAL_KEY, // a bare key is not an id
    `https://evil.example/${REAL_KEY}`,
    `ibe/data/spherex/../${REAL_KEY}`,
    REAL_ID.replace('qr3', 'xr3'),
    REAL_ID.replace('qr3', 'qr'),
    REAL_ID.replace('/2/', '/7/'),
    REAL_ID.replace('level2/', 'level3/'),
    REAL_ID.replace('.fits', '.fits.gz'),
    REAL_ID.replace('.fits', '.fits?x=1'),
    REAL_ID.replace('l2b-v27-2026-273/', '../'),
    REAL_ID.replace('l2b-v27-2026-273/2', 'l2b-v27..2026-273/2'),
    REAL_ID.replace('2026W25_2A/', '2026W25 2A/'),
    REAL_ID.replace('/2/level2', '/3/level2'), // directory says detector 3, file says D2
    REAL_ID.replace('level2_2026W25_2A_0279', 'level2_2026W26_1A_0279'), // obsid from another week
    REAL_ID.replace('_spx_l2b-v27-2026-273', '_spx_l2b-v28-2026-300'), // version mismatch
    `${REAL_ID}\n`,
    `${REAL_ID}/extra`,
    null, undefined, 42, {},
  ];
  for (const id of bad) {
    assert.throws(() => idToKey(id), (err) => err instanceof S3Error && err.code === 'BAD_ID', `accepted ${JSON.stringify(id)}`);
  }
  assert.equal(isValidKey(REAL_KEY), true);
  assert.equal(isValidKey(`x/${REAL_KEY}`), false);
  assert.throws(() => keyToId('dr1/level2/whatever'), /Not a SPHEREx/);
  assert.throws(() => makeKey({ release: 'dr1', dir: 'a/b', version: 'v', det: 1, suffix: '0001_1' }), /Not a SPHEREx/);
  assert.throws(() => makeKey({ release: 'dr1', dir: 'a', version: 'v', det: 9, suffix: '0001_1' }), /Not a SPHEREx/);
});

test('XML helpers: entities and list parsing', () => {
  assert.equal(decodeXml('a&amp;b&lt;c&gt;d&quot;e&apos;f&#65;&#x42;&unknown;'), 'a&b<c>d"e\'fAB&unknown;');
  const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>
    <NextContinuationToken>1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=</NextContinuationToken>
    <Contents><Key>dr1/a&amp;b.fits</Key><LastModified>x</LastModified><Size>64546560</Size></Contents>
    <Contents><Key>index.html</Key><Size>12</Size></Contents>
    <CommonPrefixes><Prefix>dr1/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>qr3/</Prefix></CommonPrefixes>
  </ListBucketResult>`;
  const parsed = parseListXml(xml);
  assert.deepEqual(parsed.prefixes, ['dr1/', 'qr3/']);
  assert.deepEqual(parsed.keys, [{ key: 'dr1/a&b.fits', size: 64546560 }, { key: 'index.html', size: 12 }]);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.next, '1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=');
});

test('listPrefixes and listKeys follow continuation tokens', async () => {
  const s3 = createFakeS3({ pageSize: 7 });
  s3.put('index.html', bytes(10));
  for (const rel of ['dr1', 'qr2', 'qr3']) {
    for (let d = 0; d < 9; d++) s3.put(`${rel}/level2/2026W${10 + d}_1A/v1/1/file_${d}.fits`, bytes(5));
  }
  for (let i = 0; i < 30; i++) s3.put(`dr1/level2/2026W10_1A/v1/2/level2_x_${String(i).padStart(4, '0')}.fits`, bytes(100 + i));
  const opts = { fetchImpl: s3.fetchImpl, ...fast };

  assert.deepEqual(await listPrefixes('', opts), ['dr1/', 'qr2/', 'qr3/']);
  const dirs = await listPrefixes('dr1/level2/', opts);
  assert.equal(dirs.length, 9);
  assert.equal(dirs[0], 'dr1/level2/2026W10_1A/');
  assert.deepEqual(await listPrefixes('dr1/level2/2026W10_1A/v1/', opts), ['dr1/level2/2026W10_1A/v1/1/', 'dr1/level2/2026W10_1A/v1/2/']);

  s3.resetStats();
  const keys = await listKeys('dr1/level2/2026W10_1A/v1/2/', opts);
  assert.equal(keys.length, 30);
  assert.equal(keys[0].key, 'dr1/level2/2026W10_1A/v1/2/level2_x_0000.fits');
  assert.equal(keys[29].size, 129);
  assert.equal(s3.summary().lists, 5, '30 keys at 7 per page need 5 requests');
  assert.deepEqual(await listKeys('', opts), [{ key: 'index.html', size: 10 }]);
  assert.deepEqual(await listKeys('nothing/here/', opts), []);
  assert.deepEqual(await listPrefixes('nothing/here/', opts), []);
});

test('rangeGet returns the exact bytes and the total size', async () => {
  const s3 = createFakeS3();
  const data = bytes(5000, 7);
  s3.put('some/object.bin', data);
  const opts = { fetchImpl: s3.fetchImpl, ...fast };
  const a = await rangeGet('some/object.bin', 0, 99, opts);
  assert.deepEqual(a.bytes, data.subarray(0, 100));
  assert.equal(a.total, 5000);
  const b = await rangeGet('some/object.bin', 1234, 1234, opts);
  assert.deepEqual(b.bytes, data.subarray(1234, 1235));
  const tail = await rangeGet('some/object.bin', 4990, 6000, opts);
  assert.deepEqual(tail.bytes, data.subarray(4990), 'a range past the end is clipped');
  assert.equal(tail.total, 5000);
});

test('rangeGet error codes: NOT_FOUND, RANGE, bad arguments, non-206 answers', async () => {
  const s3 = createFakeS3();
  s3.put('some/object.bin', bytes(100));
  const opts = { fetchImpl: s3.fetchImpl, ...fast };
  await assert.rejects(rangeGet('some/missing.bin', 0, 9, opts), (err) => err.code === 'NOT_FOUND' && err.status === 404 && !err.retryable);
  await assert.rejects(rangeGet('some/object.bin', 100, 200, opts), (err) => err.code === 'RANGE' && err.status === 416);
  await assert.rejects(rangeGet('some/object.bin', 5, 2, opts), (err) => err.code === 'RANGE');
  await assert.rejects(rangeGet('some/object.bin', -1, 2, opts), (err) => err.code === 'RANGE');
  await assert.rejects(rangeGet('../object.bin', 0, 2, opts), (err) => err.code === 'BAD_ID');
  // A server that ignores Range and answers 200 must not be accepted.
  const whole = async () => new Response(bytes(100), { status: 200 });
  await assert.rejects(rangeGet('some/object.bin', 0, 9, { fetchImpl: whole, ...fast }), (err) => err.code === 'UPSTREAM' && /206/.test(err.message));
  // A 206 whose Content-Range does not match what was asked for.
  const shifted = async () => new Response(bytes(10), { status: 206, headers: { 'content-range': 'bytes 10-19/100' } });
  await assert.rejects(rangeGet('some/object.bin', 0, 9, { fetchImpl: shifted, retries: 0 }), /Content-Range/);
  const short = async () => new Response(bytes(4), { status: 206, headers: { 'content-range': 'bytes 0-9/100' } });
  await assert.rejects(rangeGet('some/object.bin', 0, 9, { fetchImpl: short, retries: 0 }), /Content-Range/);
  // No Content-Range at all: accepted, total unknown.
  const bare = async () => new Response(bytes(10), { status: 206 });
  const r = await rangeGet('some/object.bin', 0, 9, { fetchImpl: bare });
  assert.equal(r.total, null);
  assert.equal(r.bytes.length, 10);
});

test('retries: 503 SlowDown, 500 and network errors are retried with backoff, 404 is not', async () => {
  const s3 = createFakeS3();
  const data = bytes(300);
  s3.put('some/object.bin', data);
  const sleeps = [];
  const opts = { fetchImpl: s3.fetchImpl, backoffMs: 40, sleep: async (ms) => sleeps.push(ms), timeoutMs: 2000 };

  s3.addFault({ match: /object\.bin/, status: 503, times: 2 });
  const a = await rangeGet('some/object.bin', 0, 9, opts);
  assert.deepEqual(a.bytes, data.subarray(0, 10));
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 20 && sleeps[0] <= 40, `first backoff ${sleeps[0]}`);
  assert.ok(sleeps[1] >= 40 && sleeps[1] <= 80, `second backoff ${sleeps[1]}`);

  s3.addFault({ match: /object\.bin/, error: true, times: 1 });
  s3.addFault({ match: /object\.bin/, status: 500, times: 1 });
  assert.equal((await rangeGet('some/object.bin', 10, 19, opts)).bytes.length, 10);

  // More failures than retries: UPSTREAM, retryable.
  s3.clearFaults();
  s3.addFault({ match: /object\.bin/, status: 503, times: 10 });
  s3.resetStats();
  await assert.rejects(rangeGet('some/object.bin', 0, 9, { ...opts, retries: 2 }), (err) => err.code === 'UPSTREAM' && err.retryable && err.status === 503);
  assert.equal(s3.summary().faults, 3, 'one try plus two retries');

  s3.clearFaults();
  s3.resetStats();
  await assert.rejects(rangeGet('some/none.bin', 0, 9, opts), (err) => err.code === 'NOT_FOUND');
  assert.equal(s3.requests.length, 1, 'a 404 is final');

  // Listing retries too.
  s3.addFault({ match: /^list:some\//, status: 503, times: 1 });
  assert.deepEqual((await listKeys('some/', opts)).map((k) => k.key), ['some/object.bin']);
});

test('per-request timeout aborts a hanging request and retries', async () => {
  const s3 = createFakeS3();
  s3.put('some/object.bin', bytes(50));
  s3.addFault({ match: /object\.bin/, hang: true, times: 1 });
  const t0 = Date.now();
  const r = await rangeGet('some/object.bin', 0, 9, { fetchImpl: s3.fetchImpl, timeoutMs: 40, backoffMs: 1 });
  assert.equal(r.bytes.length, 10);
  assert.ok(Date.now() - t0 < 1500);
  s3.addFault({ match: /object\.bin/, hang: true, times: 5 });
  await assert.rejects(
    rangeGet('some/object.bin', 0, 9, { fetchImpl: s3.fetchImpl, timeoutMs: 20, backoffMs: 1, retries: 1 }),
    (err) => err.code === 'UPSTREAM' && err.retryable && /no answer within 20 ms/.test(err.message),
  );
});

test('an outside AbortSignal stops the retries', async () => {
  const s3 = createFakeS3();
  s3.put('some/object.bin', bytes(50));
  s3.addFault({ match: /object\.bin/, hang: true, times: 5 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    rangeGet('some/object.bin', 0, 9, { fetchImpl: s3.fetchImpl, timeoutMs: 5000, signal: controller.signal }),
    /cancelled/,
  );
});

test('chooseReleases and releaseRank implement the release rule', () => {
  assert.deepEqual(chooseReleases(['dr1/', 'qr2/', 'qr3/', 'index.html', 'misc/']), ['dr1', 'qr3']);
  assert.deepEqual(chooseReleases(['qr10/', 'qr9/', 'dr2/', 'dr1/']), ['dr2', 'dr1', 'qr10']);
  assert.deepEqual(chooseReleases(['qr2/']), ['qr2']);
  assert.deepEqual(chooseReleases([]), []);
  assert.ok(releaseRank('dr1') > releaseRank('qr99'));
  assert.ok(releaseRank('dr2') > releaseRank('dr1'));
  assert.ok(releaseRank('qr3') > releaseRank('qr2'));
});

test('listReleaseDirs: all DRs, highest QR only, DR wins, last version prefix, known versions reused', async () => {
  const s3 = createFakeS3({ pageSize: 4 });
  const file = (rel, dir, ver) => s3.put(`${rel}/level2/${dir}/${ver}/1/level2_${dir}_0001_1D1_spx_${ver}.fits`, bytes(4));
  s3.put('index.html', bytes(3));
  for (const dir of ['2025W17_4B', '2025W18_1A', '2026W20_1A']) file('dr1', dir, 'l2b-v20-2025-300');
  file('qr2', '2026W10_1A', 'l2b-v25-2026-100'); // superseded quick release: ignored
  file('qr3', '2026W20_1A', 'l2b-v27-2026-273'); // also in dr1: the DR wins
  for (const dir of ['2026W20_2A', '2026W21_1A', '2026W40_2A']) file('qr3', dir, 'l2b-v27-2026-273');
  file('qr3', '2026W21_1A', 'l2b-v28-2026-290'); // two versions: take the last
  s3.put('qr3/level2/README.txt', bytes(3));
  const opts = { fetchImpl: s3.fetchImpl, ...fast };

  const dirs = await listReleaseDirs(opts);
  assert.deepEqual(dirs, [
    { release: 'dr1', dir: '2025W17_4B', prefix: 'dr1/level2/2025W17_4B/l2b-v20-2025-300/', version: 'l2b-v20-2025-300' },
    { release: 'dr1', dir: '2025W18_1A', prefix: 'dr1/level2/2025W18_1A/l2b-v20-2025-300/', version: 'l2b-v20-2025-300' },
    { release: 'dr1', dir: '2026W20_1A', prefix: 'dr1/level2/2026W20_1A/l2b-v20-2025-300/', version: 'l2b-v20-2025-300' },
    { release: 'qr3', dir: '2026W20_2A', prefix: 'qr3/level2/2026W20_2A/l2b-v27-2026-273/', version: 'l2b-v27-2026-273' },
    { release: 'qr3', dir: '2026W21_1A', prefix: 'qr3/level2/2026W21_1A/l2b-v28-2026-290/', version: 'l2b-v28-2026-290' },
    { release: 'qr3', dir: '2026W40_2A', prefix: 'qr3/level2/2026W40_2A/l2b-v27-2026-273/', version: 'l2b-v27-2026-273' },
  ]);

  // With the previous result as `known`, only a new directory costs a version lookup.
  file('qr3', '2026W41_1A', 'l2b-v28-2026-290');
  s3.resetStats();
  const again = await listReleaseDirs({ ...opts, known: dirs });
  assert.equal(again.length, 7);
  assert.equal(again[6].dir, '2026W41_1A');
  const versionLookups = s3.requests.filter((r) => r.kind === 'list' && /level2\/[^/]+\/$/.test(r.prefix));
  assert.deepEqual(versionLookups.map((r) => r.prefix), ['qr3/level2/2026W41_1A/']);
});

test('mapLimit keeps order and never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (v, i) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, v));
    running -= 1;
    return `${i}:${v}`;
  });
  assert.deepEqual(out, ['0:5', '1:1', '2:4', '3:2', '4:3', '5:0', '6:6']);
  assert.equal(peak, 3);
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
  await assert.rejects(mapLimit([1, 2], 2, async (v) => { if (v === 2) throw new Error('boom'); return v; }), /boom/);
});
