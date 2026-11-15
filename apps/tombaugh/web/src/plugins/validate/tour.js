// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// tour.js - everything the Validation panel does with the `app` object, without any DOM, so it
// can be tested in Node against a fake app:
//
//   collectContext(app, opts)   gather what is loaded into the ctx that measure.js wants
//   waitForData(app, opts)      resolve when the exposures of a new target have arrived (or not)
//   measureLoaded(app, opts)    "Measure this field": field stars and target on what is loaded
//   runTour(app, opts)          "Run the five challenge targets": go to each, wait, measure
//
// Nothing here throws. A target that brings no data becomes { noData: true, target, reason },
// and the report says so in plain words.

import { separationArcsec } from '../../core/astrometry.js';
import { measureField } from './measure.js';
import { median } from './fieldstars.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Waiting times, in milliseconds. idleMs: give up when no exposure has arrived for this long.
 * maxMs: give up on one target after this long whatever happens. settleMs: quiet time that
 * counts as "loaded" on a shell that does not say when a load is complete. gaiaWaitMs: how long
 * to wait for the Gaia stars after the exposures are in.
 */
export const TOUR_DEFAULTS = Object.freeze({ idleMs: 90000, maxMs: 300000, settleMs: 1500, gaiaWaitMs: 8000 });

const FOVS = [2, 4, 6, 10];
/** A source selected further than this from the field centre is measured instead of the centre. */
const SELECTION_MIN_ARCSEC = 10;
/** A named target is accepted as a table entry when the field centre is within this of it. */
const NAME_MATCH_ARCSEC = 300;
const POSITION_MATCH_ARCSEC = 30;

export function mjdNow(ms = Date.now()) {
  return 40587 + ms / 86400000;
}

function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(); return; }
    let id = null;
    const done = () => {
      clearTimeout(id);
      if (signal) signal.removeEventListener('abort', done);
      resolve();
    };
    id = setTimeout(done, Math.max(0, ms));
    if (signal) signal.addEventListener('abort', done, { once: true });
  });
}

/** The challenge targets of core/targets.js, in table order. */
export function challengeTargets(targetsModule) {
  const list = targetsModule && Array.isArray(targetsModule.TARGETS) ? targetsModule.TARGETS : [];
  return list.filter((t) => t && t.challenge && isNum(t.ra) && isNum(t.dec));
}

/**
 * The entry of the target table that this field is about, or null: by name when the field
 * centre is near where that target is on the given date, otherwise by position alone.
 */
export function matchKnownTarget(targetsModule, target, mjd) {
  const mod = targetsModule;
  if (!mod || !Array.isArray(mod.TARGETS) || !target || !isNum(target.ra) || !isNum(target.dec)) return null;
  const distance = (t) => {
    let pos = t;
    try {
      if (typeof mod.positionNow === 'function' && isNum(mjd)) pos = mod.positionNow(t, mjd);
    } catch {
      pos = t;
    }
    const d = pos && isNum(pos.ra) && isNum(pos.dec) ? separationArcsec(pos.ra, pos.dec, target.ra, target.dec) : NaN;
    return isNum(d) ? d : Infinity;
  };
  if (target.name && typeof mod.findTarget === 'function') {
    const named = safe(() => mod.findTarget(target.name), null);
    if (named && distance(named) < NAME_MATCH_ARCSEC) return named;
  }
  let best = null;
  let bestD = POSITION_MATCH_ARCSEC;
  for (const t of mod.TARGETS) {
    const d = distance(t);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

/**
 * Gather what the app has loaded.
 * @param {object} app the plugin host (or a fake of it)
 * @param {{ targetsModule?: object, det?: number, known?: object, useSelection?: boolean }} [opts]
 *   det: the detector to measure on (default: the selected one); known: the target-table entry
 *   when the caller already knows it; useSelection: measure the clicked source when there is one
 *   away from the field centre
 * @returns {{ ok: boolean, reason?: string, ctx?: object, summary: object }}
 *   ctx is ready for measure.js measureField; summary = { name, det, dets, nLayers, nFrames,
 *   nStars, selected }
 */
export function collectContext(app, opts = {}) {
  const summary = { name: '', det: null, dets: [], nLayers: 0, nFrames: 0, nStars: 0, selected: false };
  if (!app) return { ok: false, reason: 'The app is not available', summary };
  const centre = safe(() => app.target(), null);
  const state = safe(() => app.store.get(), {});
  const grid = safe(() => app.grid(), null);
  const frames = safe(() => app.frames(), []).filter((f) => f && isNum(f.det));
  const stars = safe(() => app.gaia(), []).filter((s) => s && isNum(s.ra) && isNum(s.dec));
  summary.nFrames = frames.length;
  summary.nStars = stars.length;
  if (!centre || !isNum(centre.ra) || !isNum(centre.dec)) {
    return { ok: false, reason: 'No target is chosen yet. Search for one, or run the challenge targets from here.', summary };
  }
  summary.name = centre.name || '';

  const layersByDet = new Map();
  for (const d of [...new Set(frames.map((f) => f.det))].sort((a, b) => a - b)) {
    const list = safe(() => app.layers(d), []);
    if (list.length) layersByDet.set(d, list);
  }
  const current = safe(() => app.layers(), []);
  if (current.length && isNum(current[0].det) && !layersByDet.has(current[0].det)) layersByDet.set(current[0].det, current);
  let det = isNum(opts.det) ? opts.det : state.det;
  if (!layersByDet.has(det)) {
    if (isNum(opts.det)) {
      const list = safe(() => app.layers(opts.det), []);
      if (list.length) layersByDet.set(opts.det, list);
    }
    if (!layersByDet.has(det)) det = current.length && isNum(current[0].det) ? current[0].det : layersByDet.size ? Math.min(...layersByDet.keys()) : null;
  }
  summary.dets = [...layersByDet.keys()].sort((a, b) => a - b);
  summary.det = det;
  summary.nLayers = det !== null && layersByDet.has(det) ? layersByDet.get(det).length : 0;
  if (!grid || !(grid.n > 0) || det === null || !summary.nLayers) {
    return { ok: false, reason: 'No exposures are loaded for this target yet. Wait for the movie, then measure.', summary };
  }

  let target = { ra: centre.ra, dec: centre.dec, name: centre.name || '' };
  if (opts.useSelection) {
    const sel = safe(() => app.selection(), null);
    if (sel && isNum(sel.ra) && isNum(sel.dec) && separationArcsec(sel.ra, sel.dec, centre.ra, centre.dec) > SELECTION_MIN_ARCSEC) {
      target = { ra: sel.ra, dec: sel.dec, name: sel.label ? String(sel.label) : 'Selected source' };
      summary.selected = true;
    }
  }
  if (!summary.selected) {
    const mjds = layersByDet.get(det).map((l) => l && l.mjd).filter(isNum);
    const known = opts.known || matchKnownTarget(opts.targetsModule, target, mjds.length ? median(mjds) : mjdNow());
    if (known) {
      target = {
        id: known.id || '', name: target.name || known.name || '', ra: known.ra, dec: known.dec,
        epoch: known.epoch, pmra: known.pmra, pmdec: known.pmdec, parallax: known.parallax,
      };
    }
  }
  const epoch = stars.length && isNum(stars[0].epoch) ? stars[0].epoch : 2016.0;
  return {
    ok: true,
    ctx: { grid, det, layersByDet, frames, gaia: { epoch, stars }, target },
    summary,
  };
}

/**
 * Wait for the exposures of a target that is about to be requested. Call it BEFORE app.goTo so
 * that no event is missed. It listens to 'frames' (the shell sends { det, count, total,
 * complete }) and, on a shell that sends no `complete`, to 'movie' followed by a quiet spell.
 *
 * @param {object} app
 * @param {{ det?: number, signal?: AbortSignal, idleMs?: number, maxMs?: number, settleMs?: number,
 *           assumeLoaded?: boolean, onProgress?: (p: { count: number, total: number }) => void }} [opts]
 *   assumeLoaded: the request will not trigger a load (same position and detector as now), so
 *   the layers that are there count once things stay quiet
 * @returns {Promise<{ ok: boolean, noData?: boolean, partial?: boolean, timedOut?: boolean,
 *                     cancelled?: boolean, reason: string, count: number, total: number }>}
 */
export function waitForData(app, opts = {}) {
  const { det = null, signal = null, assumeLoaded = false, onProgress = null } = opts;
  const idleMs = isNum(opts.idleMs) ? opts.idleMs : TOUR_DEFAULTS.idleMs;
  const maxMs = isNum(opts.maxMs) ? opts.maxMs : TOUR_DEFAULTS.maxMs;
  const settleMs = isNum(opts.settleMs) ? opts.settleMs : TOUR_DEFAULTS.settleMs;
  return new Promise((resolve) => {
    let finished = false;
    let idle = null;
    let hard = null;
    let quiet = null;
    let sawFlag = false;
    const last = { count: 0, total: 0 };
    const offs = [];
    const layerCount = () => safe(() => (det === null ? app.layers() : app.layers(det)), []).length;
    const seconds = (ms) => `${Math.round(ms / 100) / 10} s`;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(idle);
      clearTimeout(hard);
      clearTimeout(quiet);
      for (const off of offs) {
        try {
          off();
        } catch {
          // an unsubscribe that fails is not our problem
        }
      }
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ reason: '', count: last.count, total: last.total, ...result });
    };
    function onAbort() {
      finish({ ok: false, cancelled: true, reason: 'cancelled' });
    }
    const timedOut = (what) => {
      const n = layerCount();
      if (n >= 2) finish({ ok: true, partial: true, timedOut: true, reason: `${what}; measured on the ${n} exposures that had arrived by then` });
      else finish({ ok: false, noData: true, timedOut: true, reason: `${what}, and no exposures had arrived. The archive may be slow or out of reach` });
    };
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => timedOut(`nothing arrived for ${seconds(idleMs)}`), idleMs);
    };
    const armQuiet = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        if (layerCount() > 0) finish({ ok: true, settled: true });
      }, settleMs);
    };
    const onFrames = (p) => {
      try {
        if (finished || !p) return;
        if (det !== null && isNum(p.det) && p.det !== det) return;
        if (isNum(p.count)) last.count = p.count;
        if (isNum(p.total)) last.total = p.total;
        armIdle();
        if (typeof onProgress === 'function') onProgress({ count: last.count, total: last.total });
        if (p.complete === true) {
          if (last.count > 0) finish({ ok: true });
          else if (last.total > 0) finish({ ok: false, noData: true, reason: `none of the ${last.total} exposures the archive lists could be read` });
          else finish({ ok: false, noData: true, reason: `the archive lists no exposures of this position${det !== null ? ` on detector ${det}` : ''}` });
        } else if (p.complete === false) {
          sawFlag = true;
          clearTimeout(quiet);
        } else if (!sawFlag) {
          armQuiet();
        }
      } catch {
        // never throw from an event handler
      }
    };
    const onMovie = (p) => {
      try {
        if (!finished && !sawFlag && p && Array.isArray(p.frames) && p.frames.length) armQuiet();
      } catch {
        // never throw from an event handler
      }
    };
    if (signal && signal.aborted) { onAbort(); return; }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    if (app && typeof app.on === 'function') {
      offs.push(safe(() => app.on('frames', onFrames), () => {}));
      offs.push(safe(() => app.on('movie', onMovie), () => {}));
    }
    armIdle();
    hard = setTimeout(() => timedOut(`the load did not finish within ${seconds(maxMs)}`), maxMs);
    if (assumeLoaded && layerCount() > 0) armQuiet();
  });
}

/** Give the Gaia query a moment: resolves when stars are there, on timeout, or on abort. */
export async function waitForGaia(app, ms, signal) {
  const until = Date.now() + (isNum(ms) ? ms : 0);
  while (Date.now() < until && !(signal && signal.aborted)) {
    if (safe(() => app.gaia(), []).length) return true;
    await sleep(Math.min(200, Math.max(10, until - Date.now())), signal);
  }
  return safe(() => app.gaia(), []).length > 0;
}

/**
 * "Measure this field": the field-star tests and the target, on what is loaded right now.
 * @returns {Promise<{ ok: boolean, reason?: string, measurement?: object, summary: object }>}
 */
export async function measureLoaded(app, opts = {}) {
  const first = collectContext(app, opts);
  if (!first.ok) return { ok: false, reason: first.reason, summary: first.summary };
  if (!first.summary.nStars) await waitForGaia(app, isNum(opts.gaiaWaitMs) ? opts.gaiaWaitMs : 2500, opts.signal);
  const c = collectContext(app, { useSelection: true, ...opts });
  if (!c.ok) return { ok: false, reason: c.reason, summary: c.summary };
  try {
    const measurement = await measureField({ ...c.ctx, signal: opts.signal, onProgress: opts.onProgress, lib: opts.lib });
    return { ok: true, measurement, summary: c.summary };
  } catch (err) {
    return { ok: false, reason: `The measurement failed: ${err && err.message ? err.message : err}`, summary: c.summary };
  }
}

/**
 * "Run the five challenge targets": for each target go there, wait for its exposures, measure.
 *
 * @param {object} app
 * @param {object} [opts]
 *   targetsModule  core/targets.js (TARGETS, positionNow, findTarget)
 *   targets        the list to run (default: the challenge targets of targetsModule)
 *   signal         AbortSignal; the tour stops at the next step and returns what it has
 *   now            MJD used to place the targets (default: today), as the shell does
 *   idleMs, maxMs, settleMs, gaiaWaitMs   see TOUR_DEFAULTS
 *   onStatus({ phase: 'load' | 'frames' | 'measure', index, total, target, count?, loadTotal?, step?, done?, steps? })
 *   onResult(measurement, index)   after each target, also for one without data
 * @returns {Promise<{ results: object[], total: number, cancelled: boolean }>}
 *   results holds a measurement (measure.js measureField) or { noData: true, target, det, reason }
 *   per target reached
 */
export async function runTour(app, opts = {}) {
  const mod = opts.targetsModule || null;
  const list = Array.isArray(opts.targets) ? opts.targets : challengeTargets(mod);
  const signal = opts.signal || null;
  const results = [];
  const aborted = () => !!(signal && signal.aborted);
  const say = (info) => {
    if (typeof opts.onStatus !== 'function') return;
    try {
      opts.onStatus(info);
    } catch {
      // a broken status handler must not stop the tour
    }
  };
  const push = (m, index) => {
    results.push(m);
    if (typeof opts.onResult !== 'function') return;
    try {
      opts.onResult(m, index);
    } catch {
      // same
    }
  };
  for (let index = 0; index < list.length; index++) {
    if (aborted()) break;
    const t = list[index];
    const total = list.length;
    let pos = { ra: t.ra, dec: t.dec };
    try {
      if (mod && typeof mod.positionNow === 'function') {
        const p = mod.positionNow(t, isNum(opts.now) ? opts.now : mjdNow());
        if (p && isNum(p.ra) && isNum(p.dec)) pos = p;
      }
    } catch {
      pos = { ra: t.ra, dec: t.dec };
    }
    const state = safe(() => app.store.get(), {});
    const det = isNum(t.det) && t.det >= 1 && t.det <= 6 ? t.det : isNum(state.det) ? state.det : null;
    const label = { name: t.name || t.id || `Target ${index + 1}`, id: t.id || '', ra: pos.ra, dec: pos.dec };
    say({ phase: 'load', index, total, target: label, det });

    // Detector and field size first, in one patch, then the position: the shell starts one load.
    const patch = {};
    if (det !== null && state.det !== det) patch.det = det;
    if (FOVS.includes(t.fov) && state.fov !== t.fov) patch.fov = t.fov;
    const here = safe(() => app.target(), null);
    const samePlace = !!here && Math.abs(here.ra - pos.ra) < 1e-7 && Math.abs(here.dec - pos.dec) < 1e-7 && !Object.keys(patch).length;
    const waiting = waitForData(app, {
      det, signal, assumeLoaded: samePlace,
      idleMs: opts.idleMs, maxMs: opts.maxMs, settleMs: opts.settleMs,
      onProgress: (p) => say({ phase: 'frames', index, total, target: label, det, count: p.count, loadTotal: p.total }),
    });
    let goError = '';
    try {
      if (Object.keys(patch).length && app.store && typeof app.store.set === 'function') app.store.set(patch);
      app.goTo({ ra: pos.ra, dec: pos.dec, name: label.name, det, fov: t.fov });
    } catch (err) {
      goError = err && err.message ? err.message : String(err);
    }
    const got = await waiting;
    if (got.cancelled || aborted()) break;
    if (!got.ok) {
      push({ noData: true, target: label, det, reason: goError ? `the app could not go there (${goError})` : got.reason }, index);
      continue;
    }
    await waitForGaia(app, isNum(opts.gaiaWaitMs) ? opts.gaiaWaitMs : TOUR_DEFAULTS.gaiaWaitMs, signal);
    if (aborted()) break;
    const c = collectContext(app, { targetsModule: mod, det, known: t });
    if (!c.ok) {
      push({ noData: true, target: label, det, reason: c.reason }, index);
      continue;
    }
    c.ctx.target.name = label.name;
    let m;
    try {
      m = await measureField({
        ...c.ctx, signal, lib: opts.lib,
        onProgress: (p) => say({ phase: 'measure', index, total, target: label, det, step: p.step, done: p.done, steps: p.total }),
      });
    } catch (err) {
      push({ noData: true, target: label, det, reason: `the measurement failed (${err && err.message ? err.message : err})` }, index);
      continue;
    }
    if (got.partial) m.partial = got.reason;
    push(m, index);
  }
  return { results, total: list.length, cancelled: aborted() };
}
