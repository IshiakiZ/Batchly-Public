// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoader, isCancelled } from './loader.js';

const lib = {
  makeGrid: (ra, dec, fov) => ({ ra, dec, fov, n: 4 }),
  reproject: (frame) => ({ mjd: frame.mjd, det: frame.det, image: new Float32Array(16) }),
};

function fakeApi({ searchDelay = 20 } = {}) {
  const calls = { search: 0, cutout: 0 };
  return {
    calls,
    search(ra, dec, opts = {}) {
      calls.search += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({
          ra, dec,
          frames: [
            { id: 'a', det: 2, mjd: 1 }, { id: 'b', det: 2, mjd: 2 },
            { id: 'c', det: 3, mjd: 1 }, { id: 'd', det: 3, mjd: 2 }, { id: 'e', det: 3, mjd: 3 },
          ],
        }), searchDelay);
        if (opts.signal) opts.signal.addEventListener('abort', () => { clearTimeout(timer); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      });
    },
    async cutout(id) {
      calls.cutout += 1;
      return { id, mjd: NaN, det: 0 };
    },
    async gaia() { return { stars: [] }; },
  };
}

test('load returns the frames of the chosen detector in time order', async () => {
  const api = fakeApi();
  const loader = createLoader({ api, lib });
  const out = await loader.load({ ra: 10, dec: 20, fov: 4, det: 3 });
  assert.equal(out.layers.length, 3);
  assert.deepEqual(out.refs.map((r) => r.id), ['c', 'd', 'e']);
  assert.equal(out.failed, 0);
});

test('switching detector while the search is still out does not strand the second load', async () => {
  const api = fakeApi({ searchDelay: 40 });
  const loader = createLoader({ api, lib });
  const first = loader.load({ ra: 10, dec: 20, fov: 4, det: 3 });
  // The page does exactly this when a detector button is pressed during "Finding exposures".
  loader.cancel();
  const second = loader.load({ ra: 10, dec: 20, fov: 4, det: 2 });
  await assert.rejects(first, (err) => isCancelled(err));
  const out = await second;
  assert.equal(out.layers.length, 2);
  assert.deepEqual(out.refs.map((r) => r.id), ['a', 'b']);
  assert.equal(api.calls.search, 1, 'one search serves both loads of the same target');
});

test('a failed search is retried by the next load instead of being remembered', async () => {
  let n = 0;
  const api = fakeApi();
  const good = api.search;
  api.search = (ra, dec, opts) => {
    n += 1;
    if (n <= 2) { const e = new Error('down'); e.retryable = false; return Promise.reject(e); }
    return good(ra, dec, opts);
  };
  const loader = createLoader({ api, lib, backoffMs: 1 });
  await assert.rejects(loader.load({ ra: 1, dec: 2, fov: 4, det: 3 }), /down/);
  await assert.rejects(loader.load({ ra: 1, dec: 2, fov: 4, det: 3 }), /down/);
  const out = await loader.load({ ra: 1, dec: 2, fov: 4, det: 3 });
  assert.equal(out.layers.length, 3);
});
