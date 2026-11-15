// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// adapter.js - turns story actions (data, see runner.js) into calls on the plugin `app` object.
// Everything is guarded: where the app lacks a hook the action is skipped (perform returns false)
// and one line is written to the console the first time, so a story never throws.
//
// App hooks used (CONTRACT-PLUGINS.md unless marked optional):
//   app.goTo, app.store.get/set, app.target, app.movie, app.setFrameIndex, app.play, app.pause,
//   app.viewer (canvas, element, getView, setView, resetView), app.grid, app.selection, app.explain,
//   app.on('movie' | 'target' | 'frames' | 'select'), app.frames
//   optional, used when present: app.selectAt({ ra, dec }), app.showPanel(id), app.openSkyMap(),
//   app.closeSkyMap()
// Shell elements used when the optional hooks are absent: #tab-<id> (side panel tabs), #btn-map
//   and #map-dialog (sky map), .tbx-explain .tbx-iconbtn (close an explainer card).
//
// createAdapter(app, opts) -> { perform, check, resolve, skyTarget, snapshot, restore, cleanup,
//   isSynthetic, onChange(fn), dispose }

import { TARGETS, positionNow } from '../../core/targets.js';
import { angSep } from '../../core/wcs.js';
import { skyToClient } from './spotlight.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fn = (obj, name) => !!obj && typeof obj[name] === 'function';
const MJD_UNIX_EPOCH = 40587;
const SNAPSHOT_KEYS = ['ra', 'dec', 'name', 'fov', 'det', 'view', 'ch', 'lens', 'dist', 't', 'stretch', 'gaia', 'flags'];
const REBUILD_KEYS = ['view', 'det', 'fov', 'lens', 'ch', 'dist'];
const STORY_PARAMS = ['story', 'record', 'guide', 'speed'];
const QUIET_MS = 1500;

/** mas/yr -> "10.31" (arcsec/yr), with " ± 0.42" when an error is given. Pure. */
export function formatMotion(totalMas, errMas) {
  if (!isNum(totalMas)) return null;
  const v = (totalMas / 1000).toFixed(2);
  return isNum(errMas) && errMas > 0 ? `${v} ± ${(errMas / 1000).toFixed(2)}` : v;
}

/** The address to print: host and path, without the scheme, a trailing index.html or story parameters. Pure. */
export function displayUrl(href, { query = true } = {}) {
  let u;
  try {
    u = new URL(String(href));
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  let path = u.pathname.replace(/index\.html$/, '');
  if (path === '/' && !query) path = '';
  let search = '';
  if (query) {
    for (const p of STORY_PARAMS) u.searchParams.delete(p);
    const s = u.searchParams.toString();
    if (s) {
      try {
        search = `?${decodeURIComponent(s.replace(/\+/g, ' '))}`;
      } catch {
        search = `?${s}`;
      }
    }
  }
  return `${u.host}${path}${search}`;
}

export function createAdapter(app, opts = {}) {
  const doc = opts.doc || globalThis.document || null;
  const win = opts.win || (doc && doc.defaultView) || globalThis.window || null;
  const targets = opts.targets || TARGETS;
  const positionAt = opts.positionAt || positionNow;
  const nowMs = opts.nowMs || (() => Date.now());
  const ui = opts.ui || {};
  const log = opts.log || ((msg) => console.info(`[story] ${msg}`));

  const noted = new Set();
  const positions = new Map(); // target id -> field centre, fixed for the life of the page
  const changeFns = new Set();
  const unsubs = [];
  let storyTarget = null; //     { id?, name, entry? , ra?, dec? }
  let lastMovie = null; //       { view, key } of the last movie the app announced
  let completeDets = new Set();
  let lastActivity = nowMs();
  let selectCount = 0;
  let selectBaseline = null;
  let fogOpened = false;
  let explainOpened = false;
  const hasOn = fn(app, 'on');

  function missing(what) {
    if (!noted.has(what)) {
      noted.add(what);
      log(`${what} is not available here; that step is skipped.`);
    }
    return false;
  }

  const state = () => {
    try {
      return app && app.store && fn(app.store, 'get') ? app.store.get() || {} : {};
    } catch {
      return {};
    }
  };
  const movie = () => {
    try {
      return fn(app, 'movie') ? app.movie() : null;
    } catch {
      return null;
    }
  };
  const target = () => {
    try {
      return fn(app, 'target') ? app.target() : null;
    } catch {
      return null;
    }
  };
  const targetKey = () => {
    const t = target();
    return t && isNum(t.ra) && isNum(t.dec) ? `${t.ra.toFixed(5)},${t.dec.toFixed(5)}` : '';
  };
  const changed = () => {
    for (const f of [...changeFns]) {
      try {
        f();
      } catch (err) {
        console.warn('[story] listener failed', err);
      }
    }
  };

  if (hasOn) {
    const sub = (event, handler) => {
      try {
        const off = app.on(event, (e) => {
          try {
            handler(e);
          } catch (err) {
            console.warn('[story] event handler failed', err);
          }
        });
        if (typeof off === 'function') unsubs.push(off);
      } catch {
        // an app without this event
      }
    };
    sub('movie', (e) => {
      lastMovie = { view: e && e.view ? e.view : state().view, key: targetKey() };
      lastActivity = nowMs();
      changed();
    });
    sub('target', () => {
      lastMovie = null;
      completeDets = new Set();
      lastActivity = nowMs();
      changed();
    });
    sub('frames', (e) => {
      if (e && e.det !== undefined) {
        if (e.complete) completeDets.add(e.det);
        else completeDets.delete(e.det);
      }
      lastActivity = nowMs();
      changed();
    });
    sub('select', () => {
      selectCount += 1;
      changed();
    });
  }
  {
    const m = movie();
    if (m && Array.isArray(m.frames) && m.frames.length) lastMovie = { view: m.view || state().view, key: targetKey() };
  }

  // ---- targets --------------------------------------------------------------------------------
  function resolveTarget(spec) {
    if (typeof spec === 'string') {
      const q = spec.toLowerCase();
      const entry = targets.find((t) => String(t.id).toLowerCase() === q);
      return entry ? { id: entry.id, name: entry.name, entry } : null;
    }
    if (spec && isNum(spec.ra) && isNum(spec.dec)) return { name: spec.name || '', ra: spec.ra, dec: spec.dec };
    return null;
  }

  const mjdNow = () => nowMs() / 86400000 + MJD_UNIX_EPOCH;

  function positionOf(t, mjd) {
    if (!t.entry) return { ra: t.ra, dec: t.dec };
    try {
      const p = positionAt(t.entry, mjd);
      if (p && isNum(p.ra) && isNum(p.dec)) return p;
    } catch {
      // fall through to the catalogue position
    }
    return { ra: t.entry.ra, dec: t.entry.dec };
  }

  /** The field centre for a target: where it is today, computed once so that a second visit is the same field. */
  function fieldCentre(t) {
    if (!t.entry) return { ra: t.ra, dec: t.dec };
    if (!positions.has(t.id)) positions.set(t.id, positionOf(t, mjdNow()));
    return positions.get(t.id);
  }

  /**
   * Where the story's target is on the sky in the movie now showing.
   * @param {'frame'|'mid'} when 'frame': at the date of the current frame; 'mid': half-way through
   *   the movie, with `spanArcsec` = how far it travels from the first frame to the last.
   */
  function skyTarget(when = 'mid') {
    const t = storyTarget;
    if (!t) {
      const cur = target();
      return cur && isNum(cur.ra) && isNum(cur.dec) ? { ra: cur.ra, dec: cur.dec, spanArcsec: 0 } : null;
    }
    if (!t.entry) return { ra: t.ra, dec: t.dec, spanArcsec: 0 };
    const m = movie();
    const frames = m && Array.isArray(m.frames) ? m.frames : [];
    const mjds = frames.map((f) => (f ? f.mjd : NaN)).filter(isNum);
    if (!mjds.length) return { ...fieldCentre(t), spanArcsec: 0 };
    if (when === 'frame') {
      const f = frames[Math.max(0, Math.min(frames.length - 1, m.index || 0))];
      return { ...positionOf(t, f && isNum(f.mjd) ? f.mjd : mjds[0]), spanArcsec: 0 };
    }
    const lo = Math.min(...mjds);
    const hi = Math.max(...mjds);
    const a = positionOf(t, lo);
    const b = positionOf(t, hi);
    let span = 0;
    try {
      span = angSep(a.ra, a.dec, b.ra, b.dec) * 3600;
    } catch {
      span = 0;
    }
    return { ...positionOf(t, (lo + hi) / 2), spanArcsec: isNum(span) ? span : 0 };
  }

  // ---- actions --------------------------------------------------------------------------------
  function setState(patch) {
    if (!app || !app.store || !fn(app.store, 'set')) return missing('app.store.set');
    const cur = state();
    if (REBUILD_KEYS.some((k) => k in patch && patch[k] !== cur[k])) {
      lastMovie = null;
      if ('det' in patch || 'fov' in patch) completeDets = new Set();
    }
    lastActivity = nowMs();
    app.store.set(patch);
    return true;
  }

  function goTo(action) {
    const t = resolveTarget(action.target);
    if (!t) return missing(`target "${action.target}"`);
    if (!fn(app, 'goTo')) return missing('app.goTo');
    storyTarget = t;
    const pos = fieldCentre(t);
    const patch = { ...(action.state || {}) };
    if (t.entry) {
      if (patch.det === undefined && isNum(t.entry.det)) patch.det = t.entry.det;
      if (patch.fov === undefined && isNum(t.entry.fov)) patch.fov = t.entry.fov;
    }
    const cur = target();
    const same = cur && isNum(cur.ra) && isNum(cur.dec) && Math.abs(cur.ra - pos.ra) < 1e-6 && Math.abs(cur.dec - pos.dec) < 1e-6;
    if (!same) {
      lastMovie = null;
      completeDets = new Set();
      selectBaseline = null;
      lastActivity = nowMs();
      app.goTo({ ra: pos.ra, dec: pos.dec, name: t.name });
    }
    if (Object.keys(patch).length) setState(patch);
    return true;
  }

  function frame(action) {
    if (!fn(app, 'setFrameIndex')) return missing('app.setFrameIndex');
    const m = movie();
    const n = m && Array.isArray(m.frames) ? m.frames.length : 0;
    if (!n) return false;
    const cur = isNum(m.index) ? m.index : 0;
    let i = action.index;
    if (i === 'first') i = 0;
    else if (i === 'last') i = n - 1;
    else if (i === 'next') i = (cur + 1) % n;
    else if (i === 'prev') i = (cur - 1 + n) % n;
    app.setFrameIndex(Math.max(0, Math.min(n - 1, i)));
    return true;
  }

  /** A click on the viewer at a sky position, sent as the pointer events a real click produces. */
  function clickViewer(pos) {
    const viewer = app && app.viewer;
    const canvas = viewer && viewer.canvas;
    const grid = fn(app, 'grid') ? app.grid() : null;
    if (!canvas || !grid || !fn(canvas, 'getBoundingClientRect') || !fn(canvas, 'dispatchEvent') || !win) return false;
    const host = viewer.element && fn(viewer.element, 'getBoundingClientRect') ? viewer.element : canvas;
    let view = null;
    try {
      view = fn(viewer, 'getView') ? viewer.getView() : null;
    } catch {
      view = null;
    }
    const p = skyToClient(grid, view, host.getBoundingClientRect(), pos.ra, pos.dec);
    if (!p || !p.inside) return false;
    const Ev = win.PointerEvent || win.MouseEvent;
    if (typeof Ev !== 'function') return false;
    const init = { bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    canvas.dispatchEvent(new Ev('pointerdown', init));
    canvas.dispatchEvent(new Ev('pointerup', { ...init, buttons: 0 }));
    return true;
  }

  function select(action) {
    const pos = action.where === 'target' ? skyTarget('frame') : action.where;
    if (!pos || !isNum(pos.ra) || !isNum(pos.dec)) return false;
    selectBaseline = selectCount;
    if (fn(app, 'selectAt')) {
      app.selectAt({ ra: pos.ra, dec: pos.dec });
      return true;
    }
    if (clickViewer(pos)) return true;
    selectBaseline = null;
    return missing('app.selectAt (and a viewer canvas to click)');
  }

  function panel(action) {
    if (fn(app, 'showPanel')) {
      app.showPanel(action.id);
      return true;
    }
    const tab = doc && (doc.getElementById(`tab-${action.id}`) || doc.querySelector(`[data-testid="tab-${action.id}"]`));
    if (!tab || !fn(tab, 'click')) return missing(`side panel "${action.id}"`);
    tab.click();
    return true;
  }

  function explain(action) {
    if (action.topic === null) {
      explainOpened = false;
      const close = doc && doc.querySelector('.tbx-explain:not([hidden]) .tbx-iconbtn');
      if (close && fn(close, 'click')) close.click();
      return true;
    }
    if (!fn(app, 'explain')) return missing('app.explain');
    const shown = app.explain(action.topic);
    if (shown === false) return missing(`explainer "${action.topic}"`);
    explainOpened = true;
    return true;
  }

  function zoom(action) {
    const viewer = app && app.viewer;
    if (!viewer || !fn(viewer, 'setView')) return missing('app.viewer.setView');
    const at = action.at === 'target' ? skyTarget('mid') : action.at;
    if (action.level === 1 && !at && fn(viewer, 'resetView')) viewer.resetView();
    else viewer.setView({ zoom: action.level, ...(at && isNum(at.ra) && isNum(at.dec) ? { ra: at.ra, dec: at.dec } : {}) });
    return true;
  }

  function fog(action) {
    if (action.close === true) {
      fogOpened = false;
      if (fn(app, 'closeSkyMap')) {
        app.closeSkyMap();
        return true;
      }
      const dlg = doc && doc.querySelector('#map-dialog[open], [data-testid="map-dialog"][open]');
      if (!dlg) return true;
      const close = dlg.querySelector('[data-close-dialog]');
      if (close && fn(close, 'click')) close.click();
      else if (fn(dlg, 'close')) dlg.close();
      return true;
    }
    if (fn(app, 'openSkyMap')) {
      app.openSkyMap();
      fogOpened = true;
      return true;
    }
    const btn = doc && (doc.getElementById('btn-map') || doc.querySelector('[data-testid="btn-map"]'));
    if (!btn || btn.hidden || !fn(btn, 'click')) return missing('the sky map (app.openSkyMap or #btn-map)');
    btn.click();
    fogOpened = true;
    return true;
  }

  function shareUrl() {
    let text = '';
    try {
      text = displayUrl(win.location.href);
    } catch {
      text = '';
    }
    if (text) return text;
    // No usable address (a sandboxed frame): spell out the state the link would carry.
    const s = state();
    const parts = [];
    if (s.name) parts.push(`name=${s.name}`);
    else if (isNum(s.ra) && isNum(s.dec)) parts.push(`ra=${s.ra.toFixed(5)}`, `dec=${s.dec.toFixed(5)}`);
    for (const k of ['fov', 'det', 'view', 'lens']) if (s[k] !== undefined && s[k] !== null && (k !== 'lens' || s.view === 'lens')) parts.push(`${k}=${s[k]}`);
    return parts.length ? `?${parts.join('&')}` : '';
  }

  function liveUrl() {
    if (opts.liveUrl) return String(opts.liveUrl);
    try {
      if (win && win.TOMBAUGH_LIVE_URL) return String(win.TOMBAUGH_LIVE_URL);
      return displayUrl(win.location.href, { query: false });
    } catch {
      return '';
    }
  }

  function perform(action) {
    let ok = false;
    switch (action.type) {
      case 'goTo':
        ok = goTo(action);
        break;
      case 'set':
        ok = setState(action.state);
        break;
      case 'play':
        ok = fn(app, 'play') ? (app.play(), true) : missing('app.play');
        break;
      case 'pause':
        ok = fn(app, 'pause') ? (app.pause(), true) : missing('app.pause');
        break;
      case 'frame':
        ok = frame(action);
        break;
      case 'select':
        ok = select(action);
        break;
      case 'panel':
        ok = panel(action);
        break;
      case 'explain':
        ok = explain(action);
        break;
      case 'zoom':
        ok = zoom(action);
        break;
      case 'fog':
        ok = fog(action);
        break;
      case 'url':
        if (!fn(ui, 'url')) ok = false;
        else {
          ui.url(action.show === false ? null : shareUrl());
          ok = true;
        }
        break;
      default:
        ok = false;
    }
    if (fn(ui, 'afterAction')) {
      try {
        ui.afterAction(action, ok);
      } catch {
        // cosmetic
      }
    }
    return ok;
  }

  // ---- conditions and caption values ----------------------------------------------------------
  function framesReady() {
    const m = movie();
    if (!m || !Array.isArray(m.frames) || !m.frames.length) return false;
    if (!hasOn) return true;
    return !!lastMovie && lastMovie.view === (state().view ?? lastMovie.view) && lastMovie.key === targetKey();
  }

  function check(cond) {
    if (cond === 'frames') return framesReady();
    if (cond === 'loaded') {
      if (!framesReady()) return false;
      const det = state().det;
      return completeDets.has(det) || nowMs() - lastActivity >= QUIET_MS;
    }
    if (cond === 'selection') {
      let sel = null;
      try {
        sel = fn(app, 'selection') ? app.selection() : null;
      } catch {
        sel = null;
      }
      if (!sel || !Array.isArray(sel.spectrum) || !sel.spectrum.length) return false;
      return !hasOn || selectBaseline === null || selectCount > selectBaseline;
    }
    return false;
  }

  function resolve(name) {
    if (name === 'url') return liveUrl() || null;
    if (name === 'target') {
      const t = target();
      return (storyTarget && storyTarget.name) || (t && t.name) || null;
    }
    if (name === 'motion' || name === 'gaiaMotion') {
      if (!check('selection')) return null;
      const sel = app.selection();
      const m = sel && sel.motion;
      if (!m) return null;
      if (name === 'motion') return m.measured ? formatMotion(m.measured.total, m.measured.errTotal) : null;
      return m.gaia ? formatMotion(m.gaia.total) : null;
    }
    return null;
  }

  // ---- leaving things as they were ------------------------------------------------------------
  function snapshot() {
    const s = state();
    const snap = { state: {}, view: null, target: target() };
    for (const k of SNAPSHOT_KEYS) if (k in s) snap.state[k] = s[k];
    try {
      const v = app && app.viewer && fn(app.viewer, 'getView') ? app.viewer.getView() : null;
      if (v && isNum(v.zoom)) snap.view = { zoom: v.zoom, cx: v.cx, cy: v.cy };
    } catch {
      snap.view = null;
    }
    return snap;
  }

  function cleanup() {
    if (fogOpened) fog({ close: true });
    if (explainOpened) explain({ topic: null });
    if (fn(ui, 'url')) ui.url(null);
  }

  function restore(snap) {
    cleanup();
    if (!snap) return;
    try {
      if (fn(app, 'pause')) app.pause();
      const before = targetKey();
      if (app && app.store && fn(app.store, 'set') && Object.keys(snap.state).length) app.store.set(snap.state);
      else if (snap.target && fn(app, 'goTo')) app.goTo(snap.target);
      const viewer = app && app.viewer;
      if (viewer) {
        if (snap.view && before === targetKey() && fn(viewer, 'setView')) viewer.setView(snap.view);
        else if (fn(viewer, 'resetView')) viewer.resetView();
      }
    } catch (err) {
      console.warn('[story] could not restore the previous view', err);
    }
    storyTarget = null;
    selectBaseline = null;
  }

  function isSynthetic() {
    try {
      const frames = fn(app, 'frames') ? app.frames() : [];
      return Array.isArray(frames) && frames.some((f) => f && /l2b-syn|synthetic/i.test(String(f.id || '')));
    } catch {
      return false;
    }
  }

  return {
    perform,
    check,
    resolve,
    skyTarget,
    snapshot,
    restore,
    cleanup,
    isSynthetic,
    liveUrl,
    onChange(f) {
      changeFns.add(f);
      return () => changeFns.delete(f);
    },
    dispose() {
      for (const off of unsubs.splice(0)) {
        try {
          off();
        } catch {
          // already gone
        }
      }
      changeFns.clear();
    },
  };
}
