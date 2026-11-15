// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Loads every exposure of one detector for a sky position through the proxy: one search, then
// cutouts with bounded concurrency and retries, each reprojected onto the common grid as it
// arrives so that a movie can start before the download finishes. Decoded frames are cached in
// memory per target, so switching detector or field of view re-uses what it can.

const MAX_TARGETS_CACHED = 2;

/** Cutout width in degrees for a field of view in arcmin (padded for roll, clamped by the proxy). */
export function cutoutSizeDeg(fovArcmin) {
  const padded = (fovArcmin / 60) * 1.42 + 0.004;
  return Math.round(Math.min(0.2, Math.max(0.02, padded)) * 1000) / 1000;
}

export function targetKey(ra, dec) {
  return `${Number(ra).toFixed(5)},${Number(dec).toFixed(5)}`;
}

function cancelledError() {
  const err = new Error('Load cancelled');
  err.name = 'AbortError';
  err.aborted = true;
  err.retryable = false;
  return err;
}

export function isCancelled(err) {
  return !!err && (err.aborted === true || err.name === 'AbortError');
}

async function defaultLib() {
  const [wcs, rep] = await Promise.all([import('./core/wcs.js'), import('./core/reproject.js')]);
  return { makeGrid: wcs.makeGrid, reproject: rep.reproject };
}

/**
 * createLoader({ api, onProgress }) -> { load({ ra, dec, fov, det }), cancel(), ... }
 *
 * Optional extras (all injectable for tests): `lib` = { makeGrid, reproject } (defaults to the
 * core modules, imported lazily), `concurrency`, `retries`, `backoffMs`, `sleep`.
 *
 * load() resolves to { frames, grid, layers, failed, skipped, refs, search } with frames and
 * layers in time order (`skipped` counts exposures the archive has no file for, HTTP 404). It accepts `subtractZodi` (default true) and `onPartial({ layers, frames, grid,
 * done, total })`, called whenever another exposure has been aligned.
 * Progress reports are { phase: 'search' | 'frames' | 'align' | 'model', done, total, failed, det };
 * a 'frames' report that follows one exposure also carries `index` (its place in `refs`) and
 * `ok`. `onSearch({ search, refs, det })` is called once, as soon as the search has answered, so
 * the page can say what was found before the first exposure arrives.
 * `setApi(api)` swaps the data service: loads in flight are cancelled and the caches dropped.
 */
export function createLoader({
  api,
  onProgress = () => {},
  lib = null,
  concurrency = 6,
  retries = 2,
  backoffMs = 500,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let generation = 0;
  let controller = new AbortController();
  let libPromise = lib ? Promise.resolve(lib) : null;
  /** @type {Map<string, { searchPromise: Promise<any>|null, frames: Map<string, { size: number, frame: any }>, gaia: Map<string, Promise<any>> }>} */
  const targets = new Map();

  function getLib() {
    if (!libPromise) {
      libPromise = defaultLib();
      libPromise.catch(() => {
        libPromise = null;
      });
    }
    return libPromise;
  }

  function entryFor(ra, dec) {
    const key = targetKey(ra, dec);
    let entry = targets.get(key);
    if (entry) {
      targets.delete(key);
      targets.set(key, entry); // most recently used last
      return entry;
    }
    entry = { searchPromise: null, frames: new Map(), gaia: new Map() };
    targets.set(key, entry);
    while (targets.size > MAX_TARGETS_CACHED) targets.delete(targets.keys().next().value);
    return entry;
  }

  function emit(report) {
    try {
      onProgress(report);
    } catch (err) {
      if (typeof console !== 'undefined') console.error(err);
    }
  }

  async function withRetries(fn, isCurrent, attempts) {
    let lastError = null;
    for (let attempt = 0; attempt <= attempts; attempt++) {
      if (!isCurrent()) throw cancelledError();
      try {
        return await fn(attempt);
      } catch (err) {
        if (isCancelled(err) || !isCurrent()) throw cancelledError();
        lastError = err;
        if (err && (err.retryable === false || err.status === 404)) break;
        if (attempt < attempts) await sleep(backoffMs * Math.pow(3, attempt));
      }
    }
    throw lastError;
  }

  function searchCached(entry, ra, dec, isCurrent, signal) {
    if (!entry.searchPromise) {
      const promise = withRetries(() => api.search(ra, dec, { signal }), isCurrent, 1);
      entry.searchPromise = promise;
      promise.catch(() => {
        if (entry.searchPromise === promise) entry.searchPromise = null;
      });
    }
    return entry.searchPromise;
  }

  async function load({ ra, dec, fov, det, subtractZodi = true, onPartial = null, onSearch = null } = {}) {
    const myGeneration = generation;
    const signal = controller.signal;
    const isCurrent = () => myGeneration === generation;
    const check = () => {
      if (!isCurrent()) throw cancelledError();
    };

    emit({ phase: 'search', done: 0, total: 0, failed: 0, det });
    const L = await getLib();
    check();
    const grid = L.makeGrid(ra, dec, fov);
    const entry = entryFor(ra, dec);
    let search;
    try {
      search = await searchCached(entry, ra, dec, isCurrent, signal);
    } catch (err) {
      if (isCancelled(err)) throw cancelledError();
      throw err;
    }
    check();

    const refs = (search.frames || []).filter((ref) => ref.det === det).sort((a, b) => a.mjd - b.mjd);
    const total = refs.length;
    if (onSearch) {
      try {
        onSearch({ search, refs, det });
      } catch (err) {
        if (typeof console !== 'undefined') console.error(err);
      }
    }
    const size = cutoutSizeDeg(fov);
    const frames = new Array(total).fill(null);
    const layers = new Array(total).fill(null);
    let done = 0;
    let failed = 0;
    let skipped = 0; // HTTP 404: this detector has no file for that exposure; not an error
    let lastError = null;

    const snapshot = () => {
      const f = [];
      const l = [];
      for (let i = 0; i < total; i++) {
        if (layers[i]) {
          f.push(frames[i]);
          l.push(layers[i]);
        }
      }
      return { frames: f, layers: l };
    };

    const place = (index, frame) => {
      try {
        const layer = L.reproject(frame, grid, { subtractZodi });
        frames[index] = frame;
        layers[index] = layer;
      } catch (err) {
        failed += 1;
        lastError = err;
      }
    };

    // Frames already in memory at a sufficient size are aligned first, without the network.
    const missing = [];
    const cachedIdx = [];
    for (let i = 0; i < total; i++) {
      const hit = entry.frames.get(refs[i].id);
      if (hit && hit.size >= size - 1e-9) cachedIdx.push(i);
      else missing.push(i);
    }
    if (cachedIdx.length) {
      emit({ phase: 'align', done: 0, total: cachedIdx.length, failed, det });
      for (let k = 0; k < cachedIdx.length; k++) {
        place(cachedIdx[k], entry.frames.get(refs[cachedIdx[k]].id).frame);
        done += 1;
        if (k % 12 === 11) {
          emit({ phase: 'align', done: k + 1, total: cachedIdx.length, failed, det });
          await sleep(0);
          check();
        }
      }
      if (onPartial && missing.length) onPartial({ ...snapshot(), grid, done, total });
    }

    if (missing.length) {
      emit({ phase: 'frames', done, total, failed, det });
      let cursor = 0;
      const worker = async () => {
        while (cursor < missing.length) {
          const index = missing[cursor++];
          const ref = refs[index];
          let ok = false;
          try {
            const frame = await withRetries(() => api.cutout(ref.id, ra, dec, size, { signal }), isCurrent, retries);
            check();
            if (!Number.isFinite(frame.mjd)) frame.mjd = ref.mjd;
            if (!frame.det) frame.det = ref.det;
            if (!frame.release && ref.release) frame.release = ref.release;
            if (!frame.obsid && ref.obsid) frame.obsid = ref.obsid;
            entry.frames.set(ref.id, { size, frame });
            place(index, frame);
            ok = !!layers[index];
          } catch (err) {
            if (isCancelled(err) || !isCurrent()) throw cancelledError();
            if (err && err.status === 404) skipped += 1;
            else {
              failed += 1;
              lastError = err;
            }
          }
          done += 1;
          emit({ phase: 'frames', done, total, failed, skipped, det, index, ok });
          if (onPartial && done < total) {
            try {
              onPartial({ ...snapshot(), grid, done, total });
            } catch (err) {
              if (typeof console !== 'undefined') console.error(err);
            }
          }
        }
      };
      const pool = [];
      for (let i = 0; i < Math.min(concurrency, missing.length); i++) pool.push(worker());
      const settled = await Promise.allSettled(pool);
      check();
      const rejected = settled.find((s) => s.status === 'rejected');
      if (rejected) throw rejected.reason;
    }

    const final = snapshot();
    if (total > 0 && final.layers.length === 0 && lastError) {
      // Nothing usable at all: surface the underlying reason instead of an empty movie.
      throw lastError;
    }
    emit({ phase: 'align', done: total, total, failed, skipped, det });
    return { frames: final.frames, layers: final.layers, grid, failed, skipped, refs, search, det };
  }

  /** Re-align already decoded frames (for example after toggling zodi subtraction). */
  async function realign(frames, grid, { subtractZodi = true } = {}) {
    const L = await getLib();
    const outFrames = [];
    const outLayers = [];
    for (const frame of frames) {
      try {
        outLayers.push(L.reproject(frame, grid, { subtractZodi }));
        outFrames.push(frame);
      } catch {
        // skip frames that cannot be aligned
      }
    }
    return { frames: outFrames, layers: outLayers };
  }

  /** Gaia stars around the target, cached per target and radius. */
  function gaia(ra, dec, radius) {
    const entry = entryFor(ra, dec);
    const key = Number(radius).toFixed(4);
    let promise = entry.gaia.get(key);
    if (!promise) {
      // Deliberately not tied to cancel(): switching detector must not drop the catalogue request.
      promise = withRetries(() => api.gaia(ra, dec, radius), () => true, 1);
      entry.gaia.set(key, promise);
      promise.catch(() => {
        if (entry.gaia.get(key) === promise) entry.gaia.delete(key);
      });
    }
    return promise;
  }

  /** Detectors that have exposures for a target, from the cached search ({} before a search). */
  function coverage(ra, dec) {
    const entry = targets.get(targetKey(ra, dec));
    if (!entry || !entry.searchPromise) return Promise.resolve({});
    return entry.searchPromise.then(
      (search) => {
        const counts = {};
        for (const ref of search.frames || []) counts[ref.det] = (counts[ref.det] || 0) + 1;
        return counts;
      },
      () => ({}),
    );
  }

  function cancel() {
    generation += 1;
    try {
      controller.abort();
    } catch {
      // ignore
    }
    controller = new AbortController();
  }

  function clear() {
    cancel();
    targets.clear();
  }

  /** Use another data service from now on. Nothing fetched through the old one is kept. */
  function setApi(next) {
    if (!next || typeof next.search !== 'function' || typeof next.cutout !== 'function') return false;
    api = next;
    clear();
    return true;
  }

  return { load, cancel, realign, gaia, coverage, clear, setApi };
}
