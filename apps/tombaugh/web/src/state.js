// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// A small observable store plus the URL state codec. Everything here is pure except
// readUrlState / writeUrlState, which touch `location` and `history` behind try/catch because
// the page may run inside a sandboxed iframe with an opaque origin.

export const VIEWS = ['passes', 'exposures', 'matched', 'residual', 'diff', 'lens', 'distance'];
export const FOVS = [2, 4, 6, 10];
export const STRETCHES = ['asinh', 'linear', 'log', 'sqrt'];
export const LENS_IDS = ['methane', 'water', 'co2', 'co', 'rgb'];

/** Keys that are mirrored in the URL, with their defaults (a default is never written). */
export const URL_DEFAULTS = Object.freeze({
  ra: null,
  dec: null,
  name: '',
  fov: 4,
  det: 3,
  view: 'passes',
  ch: 8,
  lens: 'methane',
  dist: Infinity,
  t: 0,
  stretch: 'asinh',
  gaia: true,
  flags: false,
  embed: false,
});

/** Session-only state (not in the URL). */
export const SESSION_DEFAULTS = Object.freeze({
  colormap: 'gray',
  smooth: false,
  zodi: true,
  playing: false,
  speed: 2,
  blink: false,
  blinkA: 0,
  blinkB: 1,
  diffA: 0,
  diffB: -1,
  perExposure: false,
  mark: null,
});

export const DEFAULT_STATE = Object.freeze({ ...URL_DEFAULTS, ...SESSION_DEFAULTS });

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return false;
}

/**
 * createStore(initial) -> { get(), set(patch), subscribe(fn) -> unsubscribe }
 * Subscribers receive (state, changedKeys, previousState) and are only called when at least
 * one key really changed.
 */
export function createStore(initial = {}) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get() {
      return state;
    },
    set(patch) {
      if (!patch) return state;
      const changed = [];
      for (const key of Object.keys(patch)) {
        if (!shallowEqual(state[key], patch[key])) changed.push(key);
      }
      if (!changed.length) return state;
      const prev = state;
      state = { ...state, ...patch };
      for (const fn of [...subs]) {
        try {
          fn(state, changed, prev);
        } catch (err) {
          if (typeof console !== 'undefined') console.error(err);
        }
      }
      return state;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

function num(text) {
  if (text === null || text === undefined || String(text).trim() === '') return NaN;
  return Number(text);
}

function bool(text) {
  return text === '1' || text === 'true';
}

/** Parse a query string ("?ra=..&dec=..") into a validated partial state. Pure. */
export function parseQuery(search) {
  const out = {};
  let params;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    return out;
  }
  const ra = num(params.get('ra'));
  const dec = num(params.get('dec'));
  if (Number.isFinite(ra) && Number.isFinite(dec) && dec >= -90 && dec <= 90) {
    out.ra = ra >= 0 && ra < 360 ? ra : ((ra % 360) + 360) % 360;
    out.dec = dec;
  }
  const name = params.get('name');
  if (name && name.trim()) out.name = name.trim().slice(0, 120);
  const fov = num(params.get('fov'));
  if (FOVS.includes(fov)) out.fov = fov;
  const det = num(params.get('det'));
  if (Number.isInteger(det) && det >= 1 && det <= 6) out.det = det;
  const view = params.get('view');
  // Built-in views, or a view id registered later by a plugin.
  if (view && /^[a-z][a-z0-9_-]{0,31}$/.test(view)) out.view = view;
  const ch = num(params.get('ch'));
  if (Number.isInteger(ch) && ch >= 0 && ch <= 16) out.ch = ch;
  const lens = params.get('lens');
  if (lens && /^[a-z0-9_-]{1,24}$/i.test(lens)) out.lens = lens;
  const distText = params.get('dist');
  if (distText !== null) {
    if (/^inf/i.test(distText)) out.dist = Infinity;
    else {
      const dist = num(distText);
      if (Number.isFinite(dist) && dist > 0) out.dist = dist;
    }
  }
  const t = num(params.get('t'));
  if (Number.isInteger(t) && t >= 0 && t < 100000) out.t = t;
  const stretch = params.get('stretch');
  if (STRETCHES.includes(stretch)) out.stretch = stretch;
  if (params.has('gaia')) out.gaia = bool(params.get('gaia'));
  if (params.has('flags')) out.flags = bool(params.get('flags'));
  if (params.has('embed')) out.embed = bool(params.get('embed'));
  return out;
}

function trimNumber(value, digits) {
  return String(Number(value.toFixed(digits)));
}

/**
 * Serialise the URL-mirrored part of a state into a query string (no leading "?").
 * Defaults are omitted. `keep` is an existing query string whose unknown parameters (for
 * example `api`) are preserved. Pure.
 */
export function stateToQuery(state, keep = '') {
  const params = new URLSearchParams();
  const s = state || {};
  if (Number.isFinite(s.ra) && Number.isFinite(s.dec)) {
    params.set('ra', trimNumber(s.ra, 5));
    params.set('dec', trimNumber(s.dec, 5));
  }
  if (s.name) params.set('name', s.name);
  if (FOVS.includes(s.fov) && s.fov !== URL_DEFAULTS.fov) params.set('fov', String(s.fov));
  if (Number.isInteger(s.det) && s.det !== URL_DEFAULTS.det) params.set('det', String(s.det));
  if (typeof s.view === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(s.view) && s.view !== URL_DEFAULTS.view) params.set('view', s.view);
  if (Number.isInteger(s.ch) && s.ch !== URL_DEFAULTS.ch) params.set('ch', String(s.ch));
  if (s.lens && s.lens !== URL_DEFAULTS.lens) params.set('lens', s.lens);
  if (Number.isFinite(s.dist) && s.dist > 0) params.set('dist', trimNumber(s.dist, s.dist < 100 ? 1 : 0));
  if (Number.isInteger(s.t) && s.t > 0) params.set('t', String(s.t));
  if (STRETCHES.includes(s.stretch) && s.stretch !== URL_DEFAULTS.stretch) params.set('stretch', s.stretch);
  if (typeof s.gaia === 'boolean' && s.gaia !== URL_DEFAULTS.gaia) params.set('gaia', s.gaia ? '1' : '0');
  if (typeof s.flags === 'boolean' && s.flags !== URL_DEFAULTS.flags) params.set('flags', s.flags ? '1' : '0');
  if (s.embed) params.set('embed', '1');
  if (keep) {
    let old;
    try {
      old = new URLSearchParams(keep);
    } catch {
      old = null;
    }
    if (old) {
      for (const [key, value] of old) {
        if (!(key in URL_DEFAULTS) && !params.has(key)) params.set(key, value);
      }
    }
  }
  return params.toString();
}

/** readUrlState() -> partial state from the current address (empty object when unavailable). */
export function readUrlState() {
  try {
    return parseQuery(globalThis.location ? globalThis.location.search : '');
  } catch {
    return {};
  }
}

let writeTimer = null;
let pendingState = null;

function flushUrl() {
  writeTimer = null;
  const state = pendingState;
  pendingState = null;
  if (!state) return;
  try {
    const loc = globalThis.location;
    const hist = globalThis.history;
    if (!loc || !hist || typeof hist.replaceState !== 'function') return;
    const query = stateToQuery(state, loc.search);
    const next = loc.pathname + (query ? `?${query}` : '') + (loc.hash || '');
    if (next !== loc.pathname + loc.search + (loc.hash || '')) hist.replaceState(null, '', next);
  } catch {
    // Sandboxed iframes may forbid replaceState; the page works without it.
  }
}

/** writeUrlState(state): debounced history.replaceState, safe in sandboxed iframes. */
export function writeUrlState(state, delayMs = 400) {
  pendingState = state;
  if (writeTimer !== null) return;
  try {
    writeTimer = setTimeout(flushUrl, delayMs);
  } catch {
    writeTimer = null;
  }
}

/** A shareable absolute URL for a state (falls back to a relative query when no location). */
export function shareUrl(state) {
  let query = '';
  try {
    query = stateToQuery(state, globalThis.location ? globalThis.location.search : '');
  } catch {
    query = stateToQuery(state);
  }
  try {
    const loc = globalThis.location;
    if (loc && loc.origin && loc.origin !== 'null') return `${loc.origin}${loc.pathname}${query ? `?${query}` : ''}`;
    if (loc && loc.href) return `${loc.href.split(/[?#]/)[0]}${query ? `?${query}` : ''}`;
  } catch {
    // ignore
  }
  return query ? `?${query}` : '';
}
