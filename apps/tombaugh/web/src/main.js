// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The page shell: boots the layout, loads the science and rendering modules (each behind a
// guarded dynamic import, so a missing or broken module degrades one feature instead of blanking
// the page), wires state -> loader -> pipeline -> viewer / player / panels, and hosts plugins.

import { createStore, readUrlState, writeUrlState, shareUrl, DEFAULT_STATE, VIEWS } from './state.js';
import { createApi, resolveApiBase } from './api.js';
import { createLoader, isCancelled } from './loader.js';
import * as pipeline from './pipeline.js';
import { createLayout, h, clear } from './ui/layout.js';
import { createControls } from './ui/controls.js';
import { createPlayer } from './ui/player.js';
import { createPanels } from './ui/panels.js';
import { createCitation } from './ui/citation.js';
import { createFieldSummary, frameWaveSpan, foundLine, summarizePasses } from './ui/fieldsummary.js';
import { createTour, FALLBACK_TARGETS, findTarget } from './ui/tour.js';
import { createToasts, copyText } from './ui/toast.js';

const VERSION = '0.1.0';
const GAIA_RADIUS_DEG = 0.12; // covers the corners of the widest (10 arcmin) field
const PARTIAL_VIEWS = ['passes', 'exposures', 'matched'];
const MICRON = 'µm';
const SIMULATED_WORD = 'SIMULATED';

/** `?debug=1` logs how long each pipeline step takes (once per step and view) to the console. */
const DEBUG = (() => {
  try {
    return new URLSearchParams(location.search).get('debug') === '1';
  } catch {
    return false;
  }
})();
const debugSeen = new Set();
function timed(label, fn) {
  if (!DEBUG) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const ms = performance.now() - t0;
    if (!debugSeen.has(label) || ms > 50) {
      debugSeen.add(label);
      console.info(`[tombaugh debug] ${label}: ${ms.toFixed(1)} ms`);
    }
  }
}

// Literal specifiers on purpose: the single-file build inlines by scanning for them.
const CORE_MODULES = [
  ['wcs', () => import('./core/wcs.js')],
  ['reproject', () => import('./core/reproject.js')],
  ['stretch', () => import('./core/stretch.js')],
  ['time', () => import('./core/time.js')],
  ['flags', () => import('./core/flags.js')],
  ['frames', () => import('./core/frames.js')],
  ['stack', () => import('./core/stack.js')],
  ['skymodel', () => import('./core/skymodel.js')],
  ['photometry', () => import('./core/photometry.js')],
  ['lenses', () => import('./core/lenses.js')],
  ['astrometry', () => import('./core/astrometry.js')],
  ['ephemeris', () => import('./core/ephemeris.js')],
  ['distance', () => import('./core/distance.js')],
  ['targets', () => import('./core/targets.js')],
];

const OPTIONAL_MODULES = [
  ['viewer', () => import('./render/viewer.js')],
  ['colormaps', () => import('./render/colormaps.js')],
  ['spectrum', () => import('./plots/spectrum.js')],
  ['lightcurve', () => import('./plots/lightcurve.js')],
  ['motion', () => import('./plots/motion.js')],
  ['landing', () => import('./ui/landing.js')],
  ['explain', () => import('./ui/explain.js')],
  ['fx', () => import('./ui/fx.js')],
  ['shortcuts', () => import('./ui/shortcuts.js')],
  ['fogmap', () => import('./fog/fogmap.js')],
];

async function importAll(list, quiet = false) {
  const settled = await Promise.allSettled(list.map(([, load]) => load()));
  const mods = {};
  const missing = [];
  settled.forEach((result, i) => {
    const name = list[i][0];
    if (result.status === 'fulfilled') mods[name] = result.value;
    else {
      missing.push(name);
      if (!quiet) console.warn(`[tombaugh] module "${name}" is unavailable:`, result.reason && result.reason.message ? result.reason.message : result.reason);
    }
  });
  return { mods, missing };
}

const nextPaint = () =>
  new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(finish, 0));
    setTimeout(finish, 60);
  });

const mjdNow = () => Date.now() / 86400000 + 40587;
const yearOfMjd = (mjd) => 2000 + (mjd - 51544.5) / 365.25;

function reducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Minimal "deg deg" reader, used only when core/wcs.js is missing. */
function parseCoordFallback(text) {
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)\s*$/.exec(String(text));
  if (!m) return null;
  const ra = Number(m[1]);
  const dec = Number(m[2]);
  if (!(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90)) return null;
  return { ra, dec };
}

/** A stand-in with the viewer's interface, so the page works (without an image) if viewer.js is missing. */
function nullViewer() {
  const noop = () => {};
  return { missing: true, setGrid: noop, setImage: noop, setRgb: noop, setOverlays: noop, setCaption: noop, setOptions: noop, on: () => noop, toDataURL: () => '', destroy: noop, flash: noop };
}

async function boot() {
  const urlState = readUrlState();
  const store = createStore({ ...DEFAULT_STATE, ...urlState });
  let api = createApi(resolveApiBase());

  const layout = createLayout({ onSearch: (text) => handleSearch(text), onHome: () => goHome() });
  const { els } = layout;
  layout.setEmbed(store.get().embed);
  const toasts = createToasts(els.toasts);

  const [{ mods: core, missing: coreMissing }, { mods: opt }] = await Promise.all([importAll(CORE_MODULES), importAll(OPTIONAL_MODULES)]);
  /** Flattened core exports: the `lib` every pipeline function receives. */
  const lib = {};
  for (const [name] of CORE_MODULES) if (core[name]) Object.assign(lib, core[name]);
  if (opt.colormaps && opt.colormaps.COLORMAPS) lib.COLORMAPS = opt.colormaps.COLORMAPS;
  const parseCoord = lib.parseCoord || parseCoordFallback;
  const targets = Array.isArray(lib.TARGETS) && lib.TARGETS.length ? lib.TARGETS : FALLBACK_TARGETS;
  const challenge = targets.filter((t) => t.challenge);
  const tourTargets = (challenge.length ? challenge : targets).slice(0, 5);

  // ---- session ------------------------------------------------------------------------------
  const session = {
    token: 0,
    movieToken: 0,
    key: '',
    byDet: new Map(), //   det -> { frames, layers, grid, failed, skipped, refs, search }
    partial: null, //      { det, frames, layers, grid, done, total } while the selected detector loads
    models: new Map(), //  det -> { model, candidates }
    grid: null,
    search: null,
    gaia: { status: 'idle', stars: [], epoch: 2016.0 },
    movie: null,
    loading: null, //      { phase, det, done, total, failed, startedAt, key, label }
    selection: null,
    retrievedAt: null,
    epochNote: '',
    firstMovie: true,
    fogMarked: new Set(), // targets already recorded on the shared sky map in this session
    captionNote: '', //      extra note for every frame caption (app.setCaptionNote)
    simulated: false, //     the last /search said the sky is synthetic
    found: null, //          { refs, det } as soon as the search has answered
    error: null,
  };
  const explicitT = Number.isInteger(urlState.t) && urlState.t > 0;

  // ---- plugin-facing event bus ----------------------------------------------------------------
  const listeners = new Map();
  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.warn(`[tombaugh] "${event}" listener failed`, err);
      }
    }
  }

  const pluginViews = new Map(); // id -> { id, label, title, needs, build }
  const overlayFns = new Set();

  // ---- viewer ---------------------------------------------------------------------------------
  let viewer = nullViewer();
  if (opt.viewer && typeof opt.viewer.createViewer === 'function') {
    try {
      viewer = opt.viewer.createViewer(els.viewer, { unit: 'MJy/sr', smooth: store.get().smooth, emptyText: '' });
    } catch (err) {
      console.warn('[tombaugh] the viewer failed to start', err);
      viewer = nullViewer();
    }
  }

  const fmtCoord = (ra, dec) => {
    if (lib.formatCoord) {
      try {
        return lib.formatCoord(ra, dec);
      } catch {
        // fall through
      }
    }
    const deg = `${ra.toFixed(5)} ${dec >= 0 ? '+' : ''}${dec.toFixed(5)}`;
    return { deg, hms: '', dms: '' };
  };

  // ---- player ---------------------------------------------------------------------------------
  const player = createPlayer(els.player, {
    onFrame: (index, frame, info) => {
      renderFrame(frame, index);
      if (hasTarget() && (!player.isPlaying() || (info && info.user))) store.set({ t: index });
      emit('frame', { index, frame });
    },
    onPlayState: ({ playing }) => {
      if (!playing && player.frameCount() && hasTarget()) store.set({ t: player.index() });
    },
    onWrap: () => {
      if (player.frameCount() > 6 && viewer.flash && !reducedMotion()) viewer.flash();
    },
  });

  // ---- controls, panels, citation, tour -------------------------------------------------------
  const controls = createControls({ layout, store, lib });
  if (!VIEWS.includes(store.get().view)) {
    // Possibly a plugin view: keep it in the URL until the plugins have had their chance.
  }

  const panels = createPanels({
    layout,
    lib,
    plots: {
      createSpectrumPlot: opt.spectrum && opt.spectrum.createSpectrumPlot,
      createLightCurvePlot: opt.lightcurve && opt.lightcurve.createLightCurvePlot,
      createMotionMeter: opt.motion && opt.motion.createMotionMeter,
    },
    onFullSpectrum: () => loadAllDetectors(),
    onPickCandidate: (c, i) => {
      select({ ra: c.ra, dec: c.dec, label: `Candidate ${i + 1}`, candidate: i });
      if (store.get().view !== 'residual' && lib.fitSkyModel) store.set({ view: 'residual', t: 0 });
    },
    onClearSource: () => select(null),
  });

  let fieldSummary = null;
  try {
    fieldSummary = createFieldSummary(els.fieldsum);
  } catch (err) {
    console.warn('[tombaugh] field summary failed to start', err);
  }

  let explainer = null;
  if (opt.explain && typeof opt.explain.createExplainer === 'function') {
    try {
      explainer = opt.explain.createExplainer(document.body);
    } catch (err) {
      console.warn('[tombaugh] explainer failed to start', err);
    }
  }
  const explainTopics = opt.explain && Array.isArray(opt.explain.TOPICS) ? opt.explain.TOPICS : null;
  function explain(topicId) {
    if (!explainer) return false;
    try {
      return explainer.show(topicId) !== false;
    } catch (err) {
      console.warn('[tombaugh] explainer', err);
      return false;
    }
  }

  const citation = createCitation(els.cite, {
    onCopy: async (text) => {
      const ok = await copyText(text);
      if (ok) toasts.show('Citation copied');
      else toasts.show('Copy the citation:', { copyText: text });
    },
    onPng: () => downloadPng(),
  });

  createTour(els.searchTour, { targets: tourTargets, variant: 'compact', onPick: (t) => pickTarget(t) });
  layout.setExamples(
    [
      { text: '269.45208 4.69339', what: 'decimal degrees' },
      { text: '17h57m48.5s +04d41m36s', what: 'hours and degrees' },
      { text: '08:55:10.83 -07:14:42.5', what: 'colons' },
      { text: "Barnard's Star", what: 'a name, looked up' },
    ],
    (text) => handleSearch(text),
  );

  // ---- small helpers --------------------------------------------------------------------------
  const hasTarget = () => Number.isFinite(store.get().ra) && Number.isFinite(store.get().dec);
  const targetKey = (s = store.get()) => `${Number(s.ra).toFixed(5)},${Number(s.dec).toFixed(5)},${s.fov},${s.zodi ? 1 : 0}`;

  function currentData() {
    const s = store.get();
    const full = session.byDet.get(s.det);
    if (full) return full;
    if (session.partial && session.partial.det === s.det && session.partial.layers.length) return session.partial;
    return null;
  }

  function layersByDet() {
    const map = new Map();
    for (const [det, data] of session.byDet) map.set(det, data.layers);
    return map;
  }

  function allFrames(det = null) {
    if (det !== null && det !== undefined) {
      const d = session.byDet.get(det) || (session.partial && session.partial.det === det ? session.partial : null);
      return d ? d.frames.slice() : [];
    }
    const out = [];
    for (const data of session.byDet.values()) out.push(...data.frames);
    const s = store.get();
    if (!session.byDet.has(s.det) && session.partial && session.partial.det === s.det) out.push(...session.partial.frames);
    return out;
  }

  function viewLabel(id) {
    const info = pipeline.VIEW_INFO.find((v) => v.id === id);
    if (info) return info.label;
    const pv = pluginViews.get(id);
    return pv ? pv.label : id;
  }

  // ---- status ---------------------------------------------------------------------------------
  function loadingCopy(L) {
    const det = `D${L.det}`;
    if (L.phase === 'search') {
      return {
        kicker: 'Step 1 of 2 · search',
        title: 'Finding exposures of this spot',
        text: 'Asking the IRSA archive which SPHEREx exposures cover this position. The archive is slow: this takes about 20 seconds, sometimes longer. Nothing is frozen.',
      };
    }
    if (L.phase === 'model') {
      return {
        kicker: 'Sky model',
        title: 'Fitting the sky model',
        text: 'Fitting a smooth spectrum to every pixel from all exposures of this detector, to predict what the unchanging sky looks like at each wavelength.',
      };
    }
    if (L.phase === 'align') {
      return { kicker: 'Aligning', title: `Aligning ${det} exposures`, text: 'Resampling every exposure onto one north-up grid.' };
    }
    const why = L.label ? ` for ${L.label}` : '';
    const waits = !L.label && !PARTIAL_VIEWS.includes(store.get().view);
    return {
      kicker: L.label ? 'Extra detector' : 'Step 2 of 2 · exposures',
      title: `Loading ${L.total > 0 ? `${L.total} ` : ''}${det} exposures${why}`,
      text: waits
        ? `Each exposure is cut out around your position and aligned to one north-up grid. The ${viewLabel(store.get().view)} view needs all of them, so it appears when the last one is in.`
        : 'Each exposure is cut out around your position and aligned to one north-up grid as it arrives. The movie starts as soon as two are in.',
    };
  }

  /** What the search found for the detector being loaded, for the loading card. */
  function foundFor(L) {
    const f = session.found;
    if (!f || f.det !== L.det || !f.refs.length || L.phase === 'search' || L.phase === 'model') return null;
    const passes = summarizePasses(f.refs);
    let k = 0;
    const groups = passes.map((p) => {
      const states = [];
      for (let i = 0; i < p.total; i++, k++) states.push(L.phase === 'align' ? 1 : L.states ? L.states[k] || 0 : 0);
      return { label: p.label, dates: p.dates, total: p.total, states };
    });
    return { line: `Found ${foundLine(f.refs).replace(/:.*$/, '')}`, groups };
  }

  function renderStatus() {
    const L = session.loading;
    if (!L) {
      layout.setProgress(null);
      return;
    }
    const s = store.get();
    const showingPartial = player.frameCount() > 0 && session.movie && session.movie.key === session.key && L.det === s.det && !L.label && L.phase !== 'search' && L.phase !== 'model';
    if (showingPartial) {
      layout.setStatus(null);
      layout.setProgress({ done: L.done, total: L.total, text: `${L.done} / ${L.total} exposures` });
      return;
    }
    layout.setProgress(null);
    const copy = loadingCopy(L);
    const determinate = (L.phase === 'frames' || L.phase === 'align') && L.total > 0;
    let sub = '';
    if (determinate) {
      sub = `${L.done} of ${L.total} exposures`;
      if (L.failed) sub += ` · ${L.failed} failed`;
      if (L.skipped) sub += ` · ${L.skipped} not in the archive`;
    }
    layout.setStatus({
      kind: 'loading',
      key: L.key,
      startedAt: L.startedAt,
      kicker: copy.kicker,
      title: copy.title,
      text: copy.text,
      done: determinate ? L.done : NaN,
      total: determinate ? L.total : NaN,
      sub,
      found: foundFor(L),
    });
  }

  function onProgress(report) {
    const L = session.loading;
    if (!L) return;
    if (report.det !== undefined && report.det !== L.det) return;
    L.phase = report.phase;
    L.done = report.done;
    L.total = report.total;
    L.failed = report.failed || 0;
    L.skipped = report.skipped || 0;
    if (report.phase === 'frames' && Number.isInteger(report.index)) {
      if (!L.states || L.states.length !== report.total) L.states = new Uint8Array(report.total);
      L.states[report.index] = report.ok ? 1 : 2;
    }
    renderStatus();
  }

  const loader = createLoader({
    api,
    onProgress,
    lib: lib.makeGrid && lib.reproject ? { makeGrid: lib.makeGrid, reproject: lib.reproject } : null,
  });

  function tourExtra(text) {
    const wrap = h('div', null, h('p', { class: 'status-sub' }, text));
    const chips = h('div');
    wrap.append(chips);
    createTour(chips, { targets: tourTargets, variant: 'compact', onPick: (t) => pickTarget(t) });
    return wrap;
  }

  function showError(err) {
    session.error = err;
    player.pause();
    layout.setProgress(null);
    const retryable = !err || err.retryable !== false;
    const message = err && err.message ? String(err.message) : 'Something went wrong while loading this position.';
    layout.setStatus({
      kind: 'error',
      kicker: retryable ? 'The archive did not answer' : 'Could not load this position',
      title: retryable ? 'The exposures could not be fetched' : 'This position could not be loaded',
      text: `${message}${/[.!?]$/.test(message) ? '' : '.'} ${retryable ? 'The IRSA archive is sometimes slow or briefly unavailable; trying again usually works.' : ''}`.trim(),
      actions: [
        { label: 'Try again', primary: true, onClick: () => startLoad() },
        { label: 'Start page', onClick: () => goHome() },
      ],
      extra: tourExtra('Or open a challenge target, which is usually already cached:'),
    });
  }

  // ---- loading --------------------------------------------------------------------------------
  function resetField({ keepSelection = false } = {}) {
    loader.cancel();
    session.token += 1;
    session.movieToken += 1;
    session.byDet.clear();
    session.models.clear();
    session.partial = null;
    session.movie = null;
    session.loading = null;
    session.error = null;
    session.grid = null;
    session.found = null;
    if (!keepSelection) {
      session.selection = null;
      panels.setSource(null);
    }
    panels.setCandidates({ status: 'idle' });
    player.pause();
    player.setMovie([]);
    viewer.setOverlays(null);
    layout.setProgress(null);
  }

  function startTarget() {
    const s = store.get();
    resetField();
    session.key = targetKey(s);
    session.firstMovie = true;
    session.search = null;
    setSimulated(false);
    session.gaia = { status: 'idle', stars: [], epoch: 2016.0 };
    layout.setScreen('console');
    if (landing) landing.hide();
    layout.closePop();
    updateSearchLine();
    updateCitation();
    controls.update({ coverage: null, passes: [], hop: 0, gaia: { status: 'idle', count: 0 } });
    updateFieldSummary();
    emit('target', { ra: s.ra, dec: s.dec, name: s.name });
    startLoad();
    loadGaia();
  }

  function startLoad() {
    if (!hasTarget()) return;
    if (!lib.makeGrid || !lib.reproject) {
      layout.setStatus({
        kind: 'error',
        kicker: 'Incomplete build',
        title: 'The alignment code is missing',
        text: `This copy of Tombaugh was built without ${coreMissing.join(', ') || 'a core module'}, so exposures cannot be aligned. Nothing is wrong with your position.`,
        actions: [{ label: 'Start page', onClick: () => goHome() }],
      });
      return;
    }
    loadSelected();
  }

  let partialTimer = null;
  function onPartial(token, det, part) {
    if (token !== session.token) return;
    session.partial = { det, frames: part.frames, layers: part.layers, grid: part.grid, done: part.done, total: part.total, partial: true };
    session.grid = part.grid;
    emit('frames', { det, count: part.frames.length, total: part.total, complete: false });
    if (partialTimer !== null) return;
    partialTimer = setTimeout(() => {
      partialTimer = null;
      if (token !== session.token || !session.partial) return;
      if (PARTIAL_VIEWS.includes(store.get().view) && session.partial.layers.length >= 2) rebuildMovie({ partial: true });
    }, player.frameCount() ? 1200 : 350);
  }

  async function loadSelected() {
    const s = store.get();
    const det = s.det;
    const token = ++session.token;
    session.error = null;
    if (session.byDet.has(det)) {
      session.loading = null;
      session.partial = null;
      layout.setStatus(null);
      renderStatus();
      rebuildMovie({ reset: true });
      afterLoad(det);
      return;
    }
    loader.cancel();
    session.partial = null;
    session.loading = { phase: 'search', det, done: 0, total: 0, failed: 0, skipped: 0, startedAt: Date.now(), key: `load:${token}`, label: '' };
    if (session.movie && session.movie.key !== session.key) session.movie = null;
    player.pause();
    player.setMovie([]);
    renderStatus();
    try {
      const res = await loader.load({
        ra: s.ra,
        dec: s.dec,
        fov: s.fov,
        det,
        subtractZodi: s.zodi,
        onPartial: (p) => onPartial(token, det, p),
        onSearch: (found) => {
          if (token === session.token) onSearchAnswer(found);
        },
      });
      if (token !== session.token) return;
      session.byDet.set(det, res);
      session.partial = null;
      session.grid = res.grid;
      if (session.search !== res.search) onSearchAnswer({ search: res.search, refs: res.refs, det });
      session.loading = null;
      renderStatus();
      updateCoverage();
      updateCitation();
      emit('frames', { det, count: res.frames.length, total: res.refs.length, complete: true });
      if (!res.layers.length) {
        showNoExposures(res);
        updateAbout();
        return;
      }
      if (res.failed > 0) {
        toasts.show(`${res.failed} of ${res.refs.length} exposures could not be loaded. The movie uses the other ${res.layers.length}.`, { kind: 'alert', timeout: 6000 });
      }
      layout.setStatus(null);
      rebuildMovie({ reset: session.firstMovie });
      afterLoad(det);
    } catch (err) {
      if (isCancelled(err) || token !== session.token) return;
      session.loading = null;
      console.warn('[tombaugh] load failed:', err && err.message ? err.message : err);
      showError(err);
    }
  }

  /** The search has answered: say what was found before the first exposure arrives. */
  function onSearchAnswer({ search, refs, det }) {
    session.search = search;
    session.found = { refs: refs || [], det };
    session.retrievedAt = search && search.fetchedAt ? search.fetchedAt : new Date().toISOString();
    setSimulated(!!(search && search.simulated === true));
    updateCoverage();
    updateCitation();
    updateFieldSummary();
    updateAbout();
    renderStatus();
  }

  /**
   * A synthetic sky must never pass for an observation: a badge in the top bar, the word in every
   * frame caption (which is also what an exported PNG carries) and in the page title.
   */
  function setSimulated(on) {
    if (session.simulated === on) return;
    session.simulated = on;
    syncSimulatedBadge();
    refreshCaptions();
    updateFieldSummary();
    if (hasTarget()) document.title = titleFor(store.get());
  }

  /** The badge shows for a simulated search answer, and when a plugin watermarks the captions as simulated. */
  function syncSimulatedBadge() {
    // Also when a plugin has marked the frame on screen itself (the practice sky leads its note with the word).
    const frame = player.frame();
    const marked = !!frame && !!frame.caption && /^\s*simulated/i.test(String(frame.caption.note || ''));
    layout.setSimulated(session.simulated || marked || /simulat/i.test(session.captionNote));
  }

  /** Notes appended to every frame caption: the plugin note and the simulated-data word. */
  function captionSuffix() {
    const parts = [];
    if (session.captionNote) parts.push(session.captionNote);
    if (session.simulated && !/simulated/i.test(session.captionNote)) parts.push(SIMULATED_WORD);
    return parts.join(' · ');
  }

  /** "showing N of M exposures" when the archive listed more than the proxy passed on. */
  function thinningNote() {
    const cov = coverageCounts();
    if (!cov) return '';
    const det = store.get().det;
    const listed = cov.listed[det] || 0;
    const all = cov.counts[det] || 0;
    return all > listed ? `showing ${listed.toLocaleString('en-US')} of ${all.toLocaleString('en-US')} exposures` : '';
  }

  function dataNotes() {
    const notes = [];
    const search = session.search;
    if (search && search.complete === false) notes.push('The exposure index is still being built; more frames may appear later.');
    const thin = thinningNote();
    if (thin) notes.push(`Crowded field: ${thin} of detector D${store.get().det}, spread evenly over the passes.`);
    return notes;
  }

  function coverageCounts() {
    const search = session.search;
    if (!search) return null;
    const counts = {};
    if (Array.isArray(search.counts)) {
      // [{ det, total, returned }]: `total` exposures cover the spot, `returned` were listed.
      for (const c of search.counts) {
        const det = Number(c && c.det);
        const n = Number(c && (c.total ?? c.count));
        if (det >= 1 && det <= 6 && Number.isFinite(n)) counts[det] = n;
      }
    } else if (search.counts && typeof search.counts === 'object') {
      for (const [key, value] of Object.entries(search.counts)) {
        const det = Number(String(key).replace(/\D/g, ''));
        const n = typeof value === 'number' ? value : value && Number(value.total ?? value.count);
        if (det >= 1 && det <= 6 && Number.isFinite(n)) counts[det] = n;
      }
    }
    const listed = {};
    for (const ref of search.frames || []) listed[ref.det] = (listed[ref.det] || 0) + 1;
    for (let det = 1; det <= 6; det++) if (!(det in counts)) counts[det] = listed[det] || 0;
    return { counts, listed };
  }

  function updateCoverage() {
    const cov = coverageCounts();
    controls.update({ coverage: cov ? cov.counts : null });
  }

  function showNoExposures(res) {
    const s = store.get();
    const cov = coverageCounts();
    const others = cov ? Object.entries(cov.counts).filter(([d, n]) => Number(d) !== s.det && n > 0).map(([d, n]) => ({ det: Number(d), n })) : [];
    player.setMovie([]);
    const attempted = res.refs.length;
    let title = `No D${s.det} exposures of this spot yet`;
    let text = 'SPHEREx maps the whole sky every six months, but this detector has not delivered an exposure of this position in the public releases.';
    if (attempted > 0) {
      title = `None of the ${attempted} D${s.det} exposures could be read`;
      text = `${res.skipped || 0} are missing from the archive and ${res.failed || 0} failed to download.`;
    }
    if (others.length) text += ` Other detectors have data here: ${others.map((o) => `D${o.det} (${o.n})`).join(', ')}.`;
    else if (!attempted) text += ' No other detector has data here either. Try a position a few degrees away, or a challenge target.';
    layout.setStatus({
      kind: 'empty',
      kicker: 'No data',
      title,
      text,
      actions: [
        ...others.slice(0, 3).map((o, i) => ({ label: `Switch to D${o.det}`, primary: i === 0, onClick: () => store.set({ det: o.det, t: 0 }) })),
        ...(attempted > 0 ? [{ label: 'Try again', primary: !others.length, onClick: () => { session.byDet.delete(s.det); loadSelected(); } }] : []),
        { label: 'Start page', onClick: () => goHome() },
      ],
      extra: others.length ? null : tourExtra('Challenge targets:'),
    });
  }

  function afterLoad(det) {
    const s = store.get();
    // Record the visit on the shared sky map: once per target per session, only when at least one
    // frame really loaded, and never in the way (fire and forget, failures ignored).
    const data = session.byDet.get(det);
    const fogKey = `${Number(s.ra).toFixed(3)},${Number(s.dec).toFixed(3)}`;
    if (data && data.frames.length > 0 && !session.fogMarked.has(fogKey) && typeof api.fogMark === 'function') {
      session.fogMarked.add(fogKey);
      try {
        Promise.resolve(api.fogMark(s.ra, s.dec)).catch(() => {});
      } catch {
        // ignored
      }
    }
    if (session.selection) measureSelection();
    scheduleModel(det);
  }

  // Extra detectors (lenses, full spectrum, plugin views): loaded one after another.
  let extraChain = Promise.resolve();
  function ensureDetectors(dets, label) {
    const token = session.token;
    const run = async () => {
      const s = store.get();
      for (const det of dets) {
        if (token !== session.token) throw Object.assign(new Error('cancelled'), { aborted: true });
        if (session.byDet.has(det)) continue;
        session.loading = { phase: 'frames', det, done: 0, total: 0, failed: 0, skipped: 0, startedAt: Date.now(), key: `extra:${token}:${label}`, label };
        renderStatus();
        const res = await loader.load({ ra: s.ra, dec: s.dec, fov: s.fov, det, subtractZodi: s.zodi });
        if (token !== session.token) throw Object.assign(new Error('cancelled'), { aborted: true });
        session.byDet.set(det, res);
        emit('frames', { det, count: res.frames.length, total: res.refs.length, complete: true });
      }
      if (session.loading && session.loading.label === label) {
        session.loading = null;
        renderStatus();
      }
    };
    extraChain = extraChain.then(run, run);
    return extraChain;
  }

  async function loadAllDetectors() {
    const all = [1, 2, 3, 4, 5, 6].filter((d) => !session.byDet.has(d));
    if (!all.length) return;
    const keepMovie = player.frameCount() > 0;
    try {
      refreshSpectrumMore(true);
      // Keep the current movie on screen: the progress goes to the slim bar, not the card.
      const token = session.token;
      const s = store.get();
      for (const det of all) {
        if (token !== session.token) return;
        layout.setProgress({ done: 0, total: 1, text: `Loading D${det} for the full spectrum` });
        const res = await loader.load({ ra: s.ra, dec: s.dec, fov: s.fov, det, subtractZodi: s.zodi });
        if (token !== session.token) return;
        session.byDet.set(det, res);
        emit('frames', { det, count: res.frames.length, total: res.refs.length, complete: true });
        if (session.selection) measureSelection();
      }
    } catch (err) {
      if (!isCancelled(err)) toasts.show('Some detectors could not be loaded for the full spectrum.', { kind: 'alert' });
    } finally {
      if (keepMovie && !session.loading) layout.setProgress(null);
      refreshSpectrumMore(false);
    }
  }

  // ---- Gaia -----------------------------------------------------------------------------------
  async function loadGaia() {
    const s = store.get();
    const key = session.key;
    if (!lib.propagate) return;
    session.gaia = { status: 'loading', stars: [], epoch: 2016.0 };
    controls.update({ gaia: { status: 'loading', count: 0 } });
    try {
      const res = await loader.gaia(s.ra, s.dec, GAIA_RADIUS_DEG);
      if (key !== session.key) return;
      const epoch = Number(res.epoch) || 2016.0;
      const stars = (res.stars || []).filter((st) => Number.isFinite(st.ra) && Number.isFinite(st.dec)).map((st) => ({ ...st, epoch: st.epoch ?? epoch }));
      session.gaia = { status: 'ready', stars, epoch };
      ghostCache = new WeakMap();
      updateOverlays();
      updateGaiaInfo();
      if (session.selection) measureSelection();
    } catch (err) {
      if (key !== session.key) return;
      session.gaia = { status: 'error', stars: [], epoch: 2016.0 };
      controls.update({ gaia: { status: 'error', count: 0 } });
    }
  }

  function updateGaiaInfo() {
    const g = session.gaia;
    let count = g.stars.length;
    if (g.status === 'ready' && session.grid && lib.gridSkyToPix) {
      const n = session.grid.n;
      count = g.stars.filter((st) => {
        const [x, y] = lib.gridSkyToPix(session.grid, st.ra, st.dec);
        return x >= 0 && y >= 0 && x <= n - 1 && y <= n - 1;
      }).length;
    }
    controls.update({ gaia: { status: g.status, count } });
  }

  // ---- sky model and candidates ---------------------------------------------------------------
  let modelTimer = null;
  function scheduleModel(det) {
    if (!lib.fitSkyModel || session.models.has(det)) {
      if (session.models.has(det)) showCandidates(det);
      else panels.setCandidates({ status: 'unavailable' });
      return;
    }
    if (modelTimer !== null) clearTimeout(modelTimer);
    const key = session.key;
    panels.setCandidates({ status: 'working' });
    modelTimer = setTimeout(() => {
      modelTimer = null;
      if (key !== session.key || store.get().det !== det) return;
      try {
        ensureModel(det);
      } catch (err) {
        console.warn('[tombaugh] sky model failed', err);
      }
      showCandidates(det);
      if (store.get().view === 'residual' && player.frameCount() === 0) rebuildMovie({ reset: true });
    }, 600);
  }

  /** Synchronous: fits the model for a fully loaded detector and caches it. */
  function ensureModel(det) {
    if (session.models.has(det)) return session.models.get(det);
    const data = session.byDet.get(det);
    if (!data || !data.layers.length) return null;
    let entry = { model: null, candidates: [] };
    try {
      entry = timed(`prepareResidual (sky model fit) with ${data.layers.length} layers`, () => pipeline.prepareResidual(lib, data.layers, data.grid));
    } catch (err) {
      console.warn('[tombaugh] sky model failed', err);
    }
    session.models.set(det, entry);
    return entry;
  }

  function showCandidates(det) {
    if (store.get().det !== det) return;
    const entry = session.models.get(det);
    if (!entry) return;
    if (!entry.model) {
      panels.setCandidates({ status: 'unavailable', text: 'The change search needs at least four exposures of this spot with this detector.' });
      return;
    }
    const active = session.selection && Number.isInteger(session.selection.candidate) ? session.selection.candidate : -1;
    panels.setCandidates({ status: 'ready', list: entry.candidates, active });
  }

  // ---- movie ----------------------------------------------------------------------------------
  let rebuildQueued = null;
  function scheduleRebuild(opts = {}) {
    if (rebuildQueued) {
      rebuildQueued = { ...rebuildQueued, ...opts, reset: rebuildQueued.reset || opts.reset };
      return;
    }
    rebuildQueued = { ...opts };
    const run = () => {
      const o = rebuildQueued;
      rebuildQueued = null;
      rebuildMovie(o);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function normalizePluginFrames(frames, passes) {
    const out = [];
    (Array.isArray(frames) ? frames : []).forEach((f, i) => {
      if (!f || (!f.image && !f.rgb && !f.rgba)) return;
      const caption = f.caption || {};
      out.push({
        ...f,
        caption: { title: caption.title || `Frame ${i + 1}`, date: caption.date || '', wave: caption.wave || '', note: caption.note || '' },
        pass: Number.isInteger(f.pass) ? f.pass : 0,
        passLabel: f.passLabel || (passes[f.pass] ? passes[f.pass].label : ''),
        short: f.short || caption.title || `Frame ${i + 1}`,
      });
    });
    return out;
  }

  async function rebuildMovie({ reset = false, partial = false } = {}) {
    const s = store.get();
    const data = currentData();
    const token = ++session.movieToken;
    const stale = () => token !== session.movieToken;
    if (!data || !data.layers.length) return;
    const complete = !data.partial;
    const pluginView = pluginViews.get(s.view);
    const view = pluginView ? s.view : VIEWS.includes(s.view) ? s.view : 'passes';
    const needsAll = !PARTIAL_VIEWS.includes(view);
    if (needsAll && !complete) return; // the loading card stays up until every exposure is in

    const ctx = {
      layers: data.layers,
      grid: data.grid,
      det: s.det,
      ch: s.ch,
      lens: s.lens,
      dist: s.dist,
      diffA: s.diffA,
      diffB: s.diffB,
      perExposure: s.perExposure,
      layersByDet: layersByDet(),
      center: { ra: s.ra, dec: s.dec },
    };

    let movie = null;
    try {
      if (pluginView) {
        const needs = typeof pluginView.needs === 'function' ? (pluginView.needs(s) || []).filter((d) => d >= 1 && d <= 6) : [];
        const missing = needs.filter((d) => !session.byDet.has(d));
        if (missing.length) {
          player.pause();
          player.setMovie([]);
          await ensureDetectors(missing, `the ${pluginView.label} view`);
          if (stale()) return;
          ctx.layersByDet = layersByDet();
        }
        const built = await pluginView.build({ app, state: s, grid: data.grid, layers: data.layers, layersByDet: ctx.layersByDet, frames: data.frames, gaia: session.gaia.stars });
        if (stale()) return;
        const passes = pipeline.describePasses(lib, data.layers);
        const frames = normalizePluginFrames(built, passes);
        movie = { view, frames, empty: frames.length ? null : `The ${pluginView.label} view has nothing to show for this field.`, notes: [], candidates: [], passes };
      } else {
        if (view === 'residual' && complete) {
          if (!session.models.has(s.det)) {
            session.loading = { phase: 'model', det: s.det, done: 0, total: 0, startedAt: Date.now(), key: `model:${session.key}:${s.det}`, label: '' };
            player.pause();
            player.setMovie([]);
            renderStatus();
            await nextPaint();
            if (stale()) {
              if (session.loading && session.loading.phase === 'model') session.loading = null;
              return;
            }
            ensureModel(s.det);
            session.loading = null;
            renderStatus();
            showCandidates(s.det);
          }
          const entry = session.models.get(s.det);
          if (entry) {
            ctx.model = entry.model;
            ctx.candidates = entry.candidates;
          }
        }
        if (view === 'lens') {
          const needs = pipeline.lensDetectors(lib, (lib.LENSES || []).some((l) => l.id === s.lens) ? s.lens : ((lib.LENSES || [])[0] || {}).id);
          const missing = needs.filter((d) => !session.byDet.has(d));
          if (missing.length) {
            const lens = (lib.LENSES || []).find((l) => l.id === s.lens) || (lib.LENSES || [])[0];
            player.pause();
            player.setMovie([]);
            await ensureDetectors(missing, `the ${lens ? lens.label : 'spectral'} lens`);
            if (stale()) return;
            ctx.layersByDet = layersByDet();
          }
        }
        movie = timed(`buildMovie(${view}${ctx.perExposure && view === 'residual' ? ', every exposure' : ''}) with ${data.layers.length} layers of ${data.grid.n} x ${data.grid.n}`, () => pipeline.buildMovie(view, ctx, lib));
      }
    } catch (err) {
      if (isCancelled(err) || stale()) return;
      console.warn('[tombaugh] view failed to build', err);
      movie = { view, frames: [], empty: `The ${viewLabel(view)} view could not be computed for this field.`, notes: [], candidates: [], passes: [] };
    }
    if (stale()) return;

    movie.key = session.key;
    movie.det = s.det;
    movie.partial = !complete;
    decorateCaptions(movie.frames);
    session.movie = movie;
    ghostCache = new WeakMap();
    flagCache = new WeakMap();

    if (!movie.frames.length) {
      player.pause();
      player.setMovie([]);
      if (!session.loading) {
        layout.setStatus({
          kind: 'empty',
          kicker: viewLabel(view),
          title: 'Nothing to show in this view',
          text: movie.empty || 'This view has no frames for this field.',
          actions: view === 'passes' ? [] : [{ label: 'Back to Passes', primary: true, onClick: () => store.set({ view: 'passes', t: 0 }) }],
        });
      }
    } else {
      if (!session.loading || (session.loading.det === s.det && !session.loading.label)) layout.setStatus(null);
      viewer.setGrid(data.grid);
      const first = session.firstMovie;
      let index = null;
      let autoplay = false;
      if (first) {
        index = explicitT ? Math.min(store.get().t, movie.frames.length - 1) : 0;
        autoplay = !explicitT && !reducedMotion() && movie.frames.length > 1;
        if (complete) session.firstMovie = false;
      } else if (reset && !partial) {
        index = 0;
      }
      if (partial && player.frameCount() === 0 && !reducedMotion() && !explicitT) autoplay = true;
      player.setMovie(movie.frames, { index, autoplay, keepBlinkPair: partial });
      // Reduced motion: the movie starts paused, so make Play the obvious next step.
      if (first && !autoplay && !explicitT && movie.frames.length > 1 && reducedMotion()) player.setCallToAction(true);
    }
    renderStatus();
    controls.update({
      passes: (movie.passes || []).map((p) => ({ index: p.index, label: p.label })),
      hop: movie.hop || 0,
      fieldArcsec: movie.fieldArcsec || 0,
    });
    updateGaiaInfo();
    updateAbout();
    updateCitation();
    refreshSpectrumMore(false);
    emit('movie', { view, frames: movie.frames });
  }

  // ---- rendering a frame ----------------------------------------------------------------------
  let ghostCache = new WeakMap();
  let flagCache = new WeakMap();
  const rgbaCache = new WeakMap();

  function rgbaOf(frame) {
    if (frame.rgba) return frame.rgba;
    if (frame.rgb && frame.rgb.length) return frame.rgb; // already RGBA bytes
    if (frame.rgb && frame.rgb.r && lib.rgbComposite) {
      let out = rgbaCache.get(frame);
      if (!out) {
        const ranges = frame.rgb.ranges || [frame.rgb.r, frame.rgb.g, frame.rgb.b].map((img) => (lib.autoRange ? lib.autoRange(img, frame.mask || null, { lo: 1, hi: 99.5 }) : [0, 1]));
        out = lib.rgbComposite(frame.rgb.r, frame.rgb.g, frame.rgb.b, ranges);
        rgbaCache.set(frame, out);
      }
      return out;
    }
    return null;
  }

  function renderFrame(frame) {
    if (!frame) return;
    const s = store.get();
    const t0 = DEBUG ? performance.now() : 0;
    try {
      const rgba = frame.rgb || frame.rgba ? rgbaOf(frame) : null;
      if (rgba) viewer.setRgb(rgba);
      else if (frame.image) {
        viewer.setImage({
          image: frame.image,
          mask: frame.mask || undefined,
          range: frame.range || undefined,
          // Two-sided frames stay linear so that zero is neutral and noise is not amplified.
          stretch: frame.diverging ? 'linear' : s.stretch,
          colormap: frame.diverging ? undefined : s.colormap,
          diverging: !!frame.diverging,
        });
      }
      viewer.setCaption(frame.caption || null);
    } catch (err) {
      console.warn('[tombaugh] frame failed to draw', err);
    }
    updateOverlays();
    updateFrameSummary(frame);
    syncSimulatedBadge();
    if (DEBUG) {
      const ms = performance.now() - t0;
      if (ms > 8 && !debugSeen.has(`slow-frame:${s.view}`)) {
        debugSeen.add(`slow-frame:${s.view}`);
        console.info(`[tombaugh debug] renderFrame (${s.view}, stretch ${s.stretch}) took ${ms.toFixed(1)} ms; the budget for an instant switch is 8 ms`);
      }
    }
  }

  /**
   * Put the session-wide notes (the plugin note, SIMULATED) into the caption of every frame of
   * the current movie, so the viewer, the player line, an exported PNG and every plugin that reads
   * `frame.caption` all carry them. They lead the note line, where an ellipsis cannot cut them off.
   */
  function decorateCaptions(frames) {
    const extra = captionSuffix();
    for (const frame of frames || []) {
      if (!frame) continue;
      if (frame.captionBase === undefined) frame.captionBase = frame.caption || { title: '', date: '', wave: '', note: '' };
      const base = frame.captionBase;
      frame.caption = extra ? { ...base, note: [extra, base.note].filter(Boolean).join(' · ') } : base;
    }
  }

  function refreshCaptions() {
    if (!session.movie) return;
    decorateCaptions(session.movie.frames);
    player.refresh();
    const frame = player.frame();
    if (frame) {
      try {
        viewer.setCaption(frame.caption || null);
      } catch {
        // optional
      }
    }
  }

  // ---- field summary --------------------------------------------------------------------------
  function updateFieldSummary() {
    if (!fieldSummary) return;
    const s = store.get();
    if (!hasTarget()) {
      fieldSummary.update(null);
      return;
    }
    const search = session.search;
    const refs = search && Array.isArray(search.frames) ? search.frames : [];
    const releases = new Set();
    for (const ref of refs) if (ref.release) releases.add(String(ref.release).toLowerCase());
    for (const data of session.byDet.values()) for (const f of data.frames) if (f.release) releases.add(String(f.release).toLowerCase());
    const notes = dataNotes();
    if (session.epochNote) notes.unshift(`Centre: ${session.epochNote}.`);
    try {
      fieldSummary.update({
        name: s.name || '',
        coord: fmtCoord(s.ra, s.dec),
        det: s.det,
        fov: s.fov,
        refs,
        refsKey: session.key,
        searching: !search && !session.error,
        releases: [...releases].sort(),
        notes,
        simulated: session.simulated,
      });
    } catch (err) {
      console.warn('[tombaugh] field summary', err);
    }
  }

  function updateFrameSummary(frame) {
    if (!fieldSummary) return;
    try {
      if (!frame) {
        fieldSummary.setFrame(null);
        return;
      }
      const s = store.get();
      const ids = new Set();
      for (const layer of Array.isArray(frame.layers) ? frame.layers : []) if (layer && layer.frame && layer.frame.id) ids.add(layer.frame.id);
      let span = frameWaveSpan(frame, pipeline.layerWave);
      let label = ids.size > 1 ? `Wavelengths in this frame (${ids.size} exposures)` : 'Wavelength of this frame';
      if (!span && s.view === 'lens' && lib.LENSES) {
        const lens = lib.LENSES.find((l) => l.id === s.lens) || lib.LENSES[0];
        if (lens && Array.isArray(lens.band)) {
          span = [lens.band[0], lens.band[1]];
          label = `Band of the ${lens.label} lens`;
        }
      }
      if (!span) {
        const r = pipeline.DETECTOR_RANGES.find((d) => d.det === s.det);
        if (r && !pluginViews.has(s.view) && s.view !== 'lens') {
          span = [r.min, r.max];
          label = `Detector D${s.det} band`;
        }
      }
      fieldSummary.setFrame({ ids: ids.size ? ids : null, span, label });
    } catch (err) {
      console.warn('[tombaugh] field summary', err);
    }
  }

  function flagsFor(frame) {
    let flags = flagCache.get(frame);
    if (flags) return flags;
    const sources = Array.isArray(frame.layers) ? frame.layers.filter((l) => l && l.mask) : [];
    if (!sources.length) {
      flags = frame.mask || null;
    } else if (sources.length === 1) {
      flags = sources[0].mask;
    } else {
      const n = sources[0].mask.length;
      const count = new Uint16Array(n);
      for (const layer of sources) {
        const m = layer.mask;
        for (let i = 0; i < n; i++) count[i] += m[i] ? 1 : 0;
      }
      const limit = Math.max(1, Math.ceil(sources.length * 0.25));
      flags = new Uint8Array(n);
      for (let i = 0; i < n; i++) flags[i] = count[i] >= limit ? 1 : 0;
    }
    if (flags) flagCache.set(frame, flags);
    return flags;
  }

  function ghostsFor(frame) {
    let ghosts = ghostCache.get(frame);
    if (!ghosts) {
      ghosts = pipeline.gaiaGhosts(lib, session.gaia.stars, frame, session.grid, { max: 120 }).map((g) => {
        const out = { ra: g.ra, dec: g.dec, moved: g.moved };
        if (g.label) out.label = g.label;
        else if (Number.isFinite(g.star.gmag)) out.label = `G ${g.star.gmag.toFixed(1)}`;
        return out;
      });
      ghostCache.set(frame, ghosts);
    }
    return ghosts;
  }

  function updateOverlays() {
    const s = store.get();
    const frame = player.frame();
    const overlays = { gaia: null, flags: null, markers: [], trail: null };
    if (frame && session.grid) {
      if (s.gaia && session.gaia.stars.length && lib.gridSkyToPix) {
        try {
          overlays.gaia = ghostsFor(frame);
        } catch (err) {
          console.warn('[tombaugh] Gaia overlay', err);
        }
      }
      if (s.flags) overlays.flags = flagsFor(frame);
      if (Array.isArray(frame.markers)) overlays.markers.push(...frame.markers);
    }
    const sel = session.selection;
    if (sel) {
      overlays.markers.push({ ra: sel.ra, dec: sel.dec, kind: 'click', label: sel.label || '' });
      const track = sel.motion && sel.motion.track ? sel.motion.track : [];
      if (track.length >= 2) overlays.trail = track.map((p) => ({ ra: p.ra, dec: p.dec, mjd: p.mjd }));
    }
    if (frame) {
      for (const fn of overlayFns) {
        try {
          const extra = fn(frame, player.index());
          if (!extra || typeof extra !== 'object') continue;
          for (const key of ['gaia', 'markers', 'trail']) {
            if (Array.isArray(extra[key]) && extra[key].length) overlays[key] = (overlays[key] || []).concat(extra[key]);
          }
          if (extra.flags && !overlays.flags) overlays.flags = extra.flags;
        } catch (err) {
          console.warn('[tombaugh] plugin overlay failed', err);
        }
      }
    }
    try {
      viewer.setOverlays(overlays);
    } catch (err) {
      console.warn('[tombaugh] overlays', err);
    }
  }

  // ---- selection: spectrum, light curve, motion -----------------------------------------------
  function select(sel) {
    if (!sel) {
      session.selection = null;
      panels.setSource(null);
      showCandidatesForCurrent();
      updateOverlays();
      emit('select', null);
      return;
    }
    let x = sel.x;
    let y = sel.y;
    if ((!Number.isFinite(x) || !Number.isFinite(y)) && session.grid && lib.gridSkyToPix) [x, y] = lib.gridSkyToPix(session.grid, sel.ra, sel.dec);
    session.selection = { ra: sel.ra, dec: sel.dec, x, y, label: sel.label || '', candidate: Number.isInteger(sel.candidate) ? sel.candidate : null };
    panels.setSource({ ra: sel.ra, dec: sel.dec, label: sel.label || '' });
    const tab = layout.currentTab();
    if (!['spectrum', 'lightcurve', 'motion'].includes(tab) && !(tab === 'candidates' && Number.isInteger(sel.candidate))) layout.selectTab('spectrum');
    measureSelection();
    showCandidatesForCurrent();
  }

  function showCandidatesForCurrent() {
    const det = store.get().det;
    if (session.models.has(det)) showCandidates(det);
  }

  function refreshSpectrumMore(busy) {
    const sel = session.selection;
    if (!sel) return;
    const loaded = [...session.byDet.keys()].sort();
    const missing = [1, 2, 3, 4, 5, 6].filter((d) => !session.byDet.has(d));
    const more = missing.length
      ? {
          label: busy ? 'Loading the other detectors…' : `Load all six detectors`,
          busy,
          title: `Loaded so far: ${loaded.map((d) => `D${d}`).join(', ') || 'none'}. Loading the rest gives the full 0.75–5.0 ${MICRON} spectrum.`,
        }
      : null;
    const title = sel.label || 'Clicked source';
    const lens = store.get().view === 'lens' && lib.LENSES ? lib.LENSES.find((l) => l.id === store.get().lens) : null;
    const pts = sel.spectrum || [];
    let note = '';
    if (!pts.length) note = 'No exposure covers this position cleanly. Try a source nearer the middle of the field.';
    else if (missing.length) note = `Detectors loaded: ${loaded.map((d) => `D${d}`).join(', ')}. One point per exposure; each exposure sees the source at a different wavelength.`;
    else note = 'All six detectors loaded: 0.75 to 5.0 micrometres. One point per exposure.';
    panels.setSpectrum({ points: pts, binned: sel.binned || [], title, lens, note, more });
  }

  function measureSelection() {
    const sel = session.selection;
    if (!sel) return;
    const data = currentData();
    try {
      const spec = timed('measureSpectrum', () => pipeline.measureSpectrum(lib, allFrames(), sel.ra, sel.dec));
      sel.spectrum = spec.points;
      sel.binned = spec.binned;
      sel.lightCurve = spec.curve;
    } catch (err) {
      console.warn('[tombaugh] photometry failed', err);
      sel.spectrum = [];
      sel.binned = [];
      sel.lightCurve = [];
    }
    const title = sel.label || 'Clicked source';
    refreshSpectrumMore(false);
    panels.setLightCurve({ points: sel.lightCurve, title });
    sel.motion = null;
    if (data && data.layers.length && !data.partial) {
      try {
        const frame = player.frame();
        sel.motion = timed('measureMotion', () =>
          pipeline.measureMotion(lib, data.layers, data.grid, sel.ra, sel.dec, {
            stars: session.gaia.stars,
            startMjd: frame && Number.isFinite(frame.mjd) ? frame.mjd : null,
          }),
        );
      } catch (err) {
        console.warn('[tombaugh] motion measurement failed', err);
      }
    }
    const m = sel.motion;
    panels.setMotion({
      measured: m ? m.measured : null,
      gaia: m && m.gaia && m.gaia.total !== null ? { pmra: m.gaia.pmra, pmdec: m.gaia.pmdec, total: m.gaia.total } : null,
      track: m ? m.track : [],
      title,
    });
    updateOverlays();
    emit('select', { ...sel });
  }

  // ---- about, citation, search line -----------------------------------------------------------
  function updateAbout() {
    const s = store.get();
    const movie = session.movie;
    const data = currentData();
    const pv = pluginViews.get(s.view);
    const vinfo = pipeline.VIEW_INFO.find((v) => v.id === s.view);
    const topic = pv || !vinfo ? '' : s.view === 'passes' && hasTopic('passes') ? 'passes' : vinfo.topic;
    const notes = movie ? [...(movie.notes || [])] : [];
    const search = session.search;
    notes.push(...dataNotes());
    if (session.simulated) notes.push('This is a simulated sky, generated for testing and practice. Nothing shown here was observed by SPHEREx.');
    const cov = coverageCounts();
    const rows = [];
    if (s.name) rows.push(['Target', s.name]);
    const c = fmtCoord(s.ra, s.dec);
    rows.push(['Centre', c.deg]);
    if (c.hms) rows.push(['', `${c.hms} ${c.dms}`]);
    if (session.epochNote) rows.push(['Position', session.epochNote]);
    const r = pipeline.DETECTOR_RANGES.find((d) => d.det === s.det);
    rows.push(['Detector', `D${s.det}${r ? `  ${r.min.toFixed(2)}–${r.max.toFixed(2)} ${MICRON}` : ''}`]);
    if (data) {
      const total = data.refs ? data.refs.length : data.total;
      let text = `${data.layers.length} of ${total} loaded`;
      if (data.failed) text += `, ${data.failed} failed`;
      if (data.skipped) text += `, ${data.skipped} not in the archive`;
      rows.push(['Exposures', text]);
      if (thinningNote()) rows.push(['', thinningNote()]);
      const passes = movie && movie.passes && movie.passes.length ? movie.passes : pipeline.describePasses(lib, data.layers);
      rows.push(['Passes', passes.map((p) => `${p.label} (${p.layers.length})`).join(', ')]);
      const releases = [...new Set(data.frames.map((f) => f.release).filter(Boolean))];
      if (releases.length) rows.push(['Release', releases.map((x) => String(x).toUpperCase()).join(', ')]);
      rows.push(['Field', `${s.fov} arcmin, ${data.grid.n} × ${data.grid.n} px at ${data.grid.scale}″`]);
    }
    if (search && search.source) {
      const sources = { index: 'Tombaugh exposure index', tap: 'IRSA TAP', irsa: 'IRSA TAP', synthetic: 'synthetic sky (simulated)', practice: 'practice sky (simulated)' };
      rows.push(['Search', sources[String(search.source).toLowerCase()] || String(search.source)]);
    }
    if (session.gaia.status === 'ready') rows.push(['Gaia DR3', `${session.gaia.stars.length} stars within ${(GAIA_RADIUS_DEG * 60).toFixed(0)} arcmin`]);
    panels.setAbout({
      view: s.view,
      title: pv ? pv.label : null,
      about: pv ? pv.title || '' : null,
      notes,
      facts: rows,
      explain: explainer && topic && hasTopic(topic) ? { label: 'Explain this with a picture', onClick: () => explain(topic) } : null,
    });
  }

  function hasTopic(id) {
    return !!explainTopics && explainTopics.some((t) => t && t.id === id);
  }

  function updateCitation() {
    const s = store.get();
    const releases = new Set();
    for (const data of session.byDet.values()) for (const f of data.frames) if (f.release) releases.add(String(f.release).toLowerCase());
    if (!releases.size && session.search) for (const ref of session.search.frames || []) if (ref.release) releases.add(String(ref.release).toLowerCase());
    citation.update({
      releases: [...releases],
      retrieved: session.retrievedAt,
      ra: hasTarget() ? s.ra : null,
      dec: hasTarget() ? s.dec : null,
      canPng: player.frameCount() > 0 && !viewer.missing,
    });
  }

  function updateSearchLine() {
    const s = store.get();
    if (!hasTarget()) {
      layout.setSearchStatus(null);
      return;
    }
    const c = fmtCoord(s.ra, s.dec);
    layout.setSearchText(s.name || c.deg);
    const parts = [];
    if (s.name) parts.push(h('span', { class: 'num' }, c.deg), '  ');
    if (c.hms) parts.push(h('span', { class: 'num' }, `${c.hms} ${c.dms}`));
    if (session.epochNote) parts.push(`  ·  ${session.epochNote}`);
    layout.setSearchStatus(parts);
  }

  // ---- search, targets, navigation ------------------------------------------------------------
  let landing = null;
  let landingFallback = null;
  let resolveToken = 0;

  function reportSearchProblem(message) {
    layout.setSearchStatus(message, { error: true });
    if (landingFallback) landingFallback.setError(message);
    if (landing && landing.setError) {
      try {
        landing.setError(message);
      } catch {
        // optional
      }
    }
  }

  function goTo({ ra, dec, name = '', det = null, fov = null, note = '' }) {
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) return;
    const prev = store.get();
    session.epochNote = note;
    const patch = { ra: ((ra % 360) + 360) % 360, dec: Math.max(-90, Math.min(90, dec)), name: name || '', t: 0 };
    if (det >= 1 && det <= 6) patch.det = det;
    if ([2, 4, 6, 10].includes(fov)) patch.fov = fov;
    const same = Number.isFinite(prev.ra) && Math.abs(prev.ra - patch.ra) < 1e-7 && Math.abs(prev.dec - patch.dec) < 1e-7;
    store.set(patch);
    if (same) {
      // Same coordinates again: retry if nothing is showing, otherwise just refresh the labels.
      if (document.documentElement.dataset.screen !== 'console' || session.error || (!session.loading && !player.frameCount())) startTarget();
      else updateSearchLine();
    }
  }

  function pickTarget(target) {
    let pos = { ra: target.ra, dec: target.dec };
    let note = '';
    const now = mjdNow();
    try {
      if (lib.positionNow) pos = lib.positionNow(target, now);
      else if (lib.propagate && Number.isFinite(target.pmra)) pos = lib.propagate({ ...target, epoch: target.epoch ?? 2000.0 }, now, { parallax: false });
      if (Number.isFinite(target.pmra) && Number.isFinite(target.pmdec) && Math.hypot(target.pmra, target.pmdec) > 0) {
        note = `position for ${yearOfMjd(now).toFixed(1)} (catalogue epoch ${Number(target.epoch ?? 2000).toFixed(1)} moved by its proper motion)`;
      }
    } catch {
      pos = { ra: target.ra, dec: target.dec };
    }
    if (!Number.isFinite(pos.ra) || !Number.isFinite(pos.dec)) pos = { ra: target.ra, dec: target.dec };
    const patch = { view: 'passes' };
    store.set(patch);
    goTo({ ra: pos.ra, dec: pos.dec, name: target.name, det: target.det, fov: target.fov, note });
  }

  async function handleSearch(text) {
    const query = String(text || '').trim();
    if (!query) return;
    const coord = parseCoord(query);
    if (coord && Number.isFinite(coord.ra) && Number.isFinite(coord.dec)) {
      goTo({ ra: coord.ra, dec: coord.dec, name: '' });
      return;
    }
    let known = null;
    try {
      known = lib.findTarget ? lib.findTarget(query) : null;
    } catch {
      known = null;
    }
    if (!known) known = findTarget(targets, query);
    if (known) {
      pickTarget(known);
      return;
    }
    const token = ++resolveToken;
    const started = Date.now();
    const tick = () => {
      if (token !== resolveToken) return;
      const sec = Math.floor((Date.now() - started) / 1000);
      layout.setSearchStatus(`Looking up “${query}” in the name service… ${sec} s`);
      if (landingFallback) landingFallback.setBusy(`Looking up “${query}”… ${sec} s`);
    };
    tick();
    const timer = setInterval(tick, 1000);
    try {
      const res = await api.resolve(query);
      if (token !== resolveToken) return;
      if (!res || !Number.isFinite(res.ra) || !Number.isFinite(res.dec)) throw Object.assign(new Error('not found'), { status: 404 });
      let pos = { ra: res.ra, dec: res.dec };
      const epoch = Number.isFinite(res.epoch) ? res.epoch : 2000.0;
      let note = `catalogue position, epoch ${epoch.toFixed(1)}`;
      const hasPm = Number.isFinite(res.pmra) && Number.isFinite(res.pmdec) && Math.hypot(res.pmra, res.pmdec) > 0;
      if (hasPm) {
        const now = mjdNow();
        try {
          let moved = null;
          if (lib.propagate) moved = lib.propagate({ ra: res.ra, dec: res.dec, pmra: res.pmra, pmdec: res.pmdec, parallax: res.parallax || 0, epoch }, now, { parallax: false });
          else if (lib.positionNow) moved = lib.positionNow({ ...res, epoch }, now);
          if (moved && Number.isFinite(moved.ra) && Number.isFinite(moved.dec)) {
            pos = moved;
            note = `position for ${yearOfMjd(now).toFixed(1)} (epoch ${epoch.toFixed(1)} moved by its proper motion, ${(Math.hypot(res.pmra, res.pmdec) / 1000).toFixed(2)}″/yr)`;
          }
        } catch {
          // keep the catalogue position
        }
      }
      goTo({ ra: pos.ra, dec: pos.dec, name: res.name || query, note });
    } catch (err) {
      if (token !== resolveToken) return;
      if (err && err.status === 404) reportSearchProblem(`No object called “${query}” was found. Check the spelling, or type coordinates such as 269.45 4.69.`);
      else reportSearchProblem(`The name service did not answer for “${query}”. Try again, or type coordinates such as 269.45 4.69.`);
    } finally {
      clearInterval(timer);
      if (landingFallback) landingFallback.setBusy('');
    }
  }

  function randomPosition() {
    const ra = Math.random() * 360;
    const dec = (Math.asin(2 * Math.random() - 1) * 180) / Math.PI;
    return { ra, dec };
  }

  /**
   * "Somewhere nobody has looked": ask the shared sky map which patches have been opened and go
   * to the centre of an unopened one away from the galactic plane (the fog module's own rule).
   * If the map cannot be read within a few seconds, a random position does the job.
   */
  let surpriseBusy = false;
  async function surprise() {
    if (surpriseBusy) return;
    surpriseBusy = true;
    let pick = null;
    const choose = opt.fogmap && opt.fogmap.chooseUnopenedCell;
    if (typeof choose === 'function' && typeof api.fog === 'function') {
      const busy = (on) => {
        try {
          if (landing && landing.setBusy) landing.setBusy(on, on ? 'Looking for a patch nobody has opened…' : '');
        } catch {
          // optional
        }
      };
      busy(true);
      try {
        const counts = await Promise.race([
          api.fog(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        pick = choose(counts) || null;
      } catch {
        pick = null;
      }
      busy(false);
    }
    surpriseBusy = false;
    if (pick && Number.isFinite(pick.ra) && Number.isFinite(pick.dec)) {
      goTo({ ra: pick.ra, dec: pick.dec, name: '' });
      toasts.show(pick.why || (pick.count === 0 ? 'Nobody has opened this patch of sky with Tombaugh before.' : 'One of the least visited patches of sky.'), { timeout: 5200 });
      return;
    }
    const p = randomPosition();
    goTo({ ra: p.ra, dec: p.dec, name: '' });
  }

  function buildLandingFallback() {
    const status = h('p', { class: 'landing-status', 'aria-live': 'polite' });
    const input = h('input', {
      class: 'search-input',
      type: 'text',
      id: 'landing-input',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      placeholder: "RA Dec or a name: 269.45 4.69, 17h57m48s +04d41m36s, Barnard's Star",
      'aria-label': 'Sky coordinates or object name',
    });
    const form = h(
      'form',
      {
        class: 'landing-search',
        role: 'search',
        onsubmit: (e) => {
          e.preventDefault();
          if (input.value.trim()) handleSearch(input.value);
          else input.focus();
        },
      },
      input,
      h('button', { class: 'btn btn-solid', type: 'submit' }, 'Look'),
    );
    const chips = h('div');
    const root = h(
      'section',
      { class: 'landing-fallback', 'aria-label': 'Start' },
      h('div', null, h('h1', { class: 'wordmark' }, 'TOMBAUGH'), h('p', { class: 'tagline' }, 'a blink comparator for the 102-color sky ', h('span', { class: 'byline' }, 'by Missing Mass'))),
      h('p', { class: 'lede' }, 'Type a place in the sky. Tombaugh loads every SPHEREx exposure of that patch, lines them up and plays them as a movie, so that things that move or change stand out.'),
      h('div', null, form, status),
      h('div', null, h('p', { class: 'pop-heading' }, 'Or start with a challenge target'), chips),
      h('p', { class: 'landing-foot' }, 'Clyde Tombaugh found Pluto in 1930 by blinking two photographic plates. SPHEREx photographs the whole sky in 102 colours every six months; this is the same trick, with the colour taken into account.'),
    );
    createTour(chips, { targets: tourTargets, variant: 'cards', onPick: (t) => pickTarget(t) });
    els.landing.append(root);
    return {
      show() {
        root.hidden = false;
        try {
          if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
        } catch {
          // ignore
        }
      },
      hide() {
        root.hidden = true;
      },
      setError(message) {
        status.textContent = message || '';
        status.classList.toggle('is-error', !!message);
      },
      setBusy(message) {
        if (message) {
          status.classList.remove('is-error');
          status.textContent = message;
        } else if (!status.classList.contains('is-error')) status.textContent = '';
      },
    };
  }

  function showLanding() {
    loader.cancel();
    session.token += 1;
    session.movieToken += 1;
    session.loading = null;
    player.pause();
    layout.setStatus(null);
    layout.setProgress(null);
    layout.setScreen('landing');
    document.title = 'Tombaugh: a blink comparator for the 102-color sky';
    if (!landing && !landingFallback) {
      if (opt.landing && typeof opt.landing.createLanding === 'function') {
        try {
          landing = opt.landing.createLanding(els.landing, {
            targets: tourTargets,
            onPick: (t) => pickTarget(t),
            onSearch: (text) => handleSearch(text),
            onSurprise: () => surprise(),
            parseCoord: lib.parseCoord,
            onExplain: explainer ? (topic) => explain(topic) : undefined,
          });
        } catch (err) {
          console.warn('[tombaugh] landing failed to start', err);
          landing = null;
          clear(els.landing);
        }
      }
      if (!landing) landingFallback = buildLandingFallback();
    }
    if (landing) landing.show();
    else landingFallback.show();
  }

  function goHome() {
    session.epochNote = '';
    if (!hasTarget()) {
      showLanding();
      return;
    }
    store.set({ ra: null, dec: null, name: '', t: 0 });
  }

  // ---- share, PNG, help, sky map --------------------------------------------------------------
  async function share() {
    const url = shareUrl({ ...store.get(), t: player.frameCount() ? player.index() : 0 });
    const ok = await copyText(url);
    if (ok) toasts.show('Link to this exact view copied');
    else toasts.show('Copy this link:', { copyText: url });
  }

  function downloadPng() {
    let url = '';
    try {
      url = viewer.toDataURL();
    } catch (err) {
      console.warn('[tombaugh] PNG export failed', err);
    }
    if (!url || !player.frameCount()) {
      toasts.show('There is no frame to save yet.');
      return;
    }
    const s = store.get();
    const base = (s.name || `${Number(s.ra).toFixed(4)}_${Number(s.dec).toFixed(4)}`).replace(/[^a-zA-Z0-9._+-]+/g, '_');
    const a = h('a', { href: url, download: `tombaugh_${base}_D${s.det}_${s.view}_${String(player.index() + 1).padStart(2, '0')}.png` });
    document.body.append(a);
    try {
      a.click();
      toasts.show('Frame saved as PNG');
    } catch {
      toasts.show('This browser blocked the download.', { kind: 'alert' });
    }
    a.remove();
  }

  const FALLBACK_SHORTCUTS = [
    { keys: ['Space'], label: 'Play or pause the movie' },
    { keys: ['←', '→'], label: 'Step one frame back or forward' },
    { keys: ['b'], label: 'Blink between frame A and frame B' },
    { keys: ['r'], label: 'Residual view: subtract the predicted sky' },
    { keys: ['g'], label: 'Gaia ghost rings on or off' },
    { keys: ['f'], label: 'Flagged pixels on or off' },
    { keys: ['1', '6'], label: 'Choose a detector, 1 to 6', range: true },
    { keys: ['?'], label: 'Show this help' },
  ];

  function buildHelp() {
    const body = clear(els.helpBody);
    const steps = h(
      'ol',
      { class: 'help-steps' },
      h('li', null, 'Type coordinates or a name in the box at the top, or pick a challenge target.'),
      h('li', null, 'Watch the movie. In the Passes view every frame is one survey pass, six months apart: stars stay put, movers jump.'),
      h('li', null, 'Switch to Residual to subtract what the unchanging sky should look like. What is left moved or changed.'),
      h('li', null, 'Click any source to read its spectrum, its light curve and its motion compared with Gaia.'),
      h('li', null, 'Use Share to copy a link that reopens exactly this view.'),
    );
    const keys = h('dl', { class: 'keys' });
    const list = opt.shortcuts && Array.isArray(opt.shortcuts.SHORTCUTS) ? opt.shortcuts.SHORTCUTS : FALLBACK_SHORTCUTS;
    const fmt = opt.shortcuts && opt.shortcuts.formatKey ? opt.shortcuts.formatKey : (k) => k;
    for (const sc of list) {
      const shown = sc.display || sc.keys;
      const dt = h('dt');
      shown.forEach((k, i) => {
        if (i > 0) dt.append(sc.range ? '–' : ' ');
        dt.append(h('kbd', null, fmt(k)));
      });
      keys.append(dt, h('dd', null, sc.label));
    }
    body.append(h('div', null, h('p', { class: 'pop-heading' }, 'In five steps'), steps), h('div', null, h('p', { class: 'pop-heading' }, 'Keyboard'), keys));
    if (explainer && explainTopics) {
      const row = h('div', { class: 'chips' });
      for (const t of explainTopics) {
        row.append(
          h(
            'button',
            {
              type: 'button',
              class: 'chip',
              onclick: () => {
                layout.closeDialog(els.helpDialog);
                explain(t.id);
              },
            },
            h('span', { class: 'chip-name' }, t.title || t.id),
          ),
        );
      }
      body.append(h('div', null, h('p', { class: 'pop-heading' }, 'Explained with pictures'), row));
    }
    body.append(
      h(
        'p',
        { class: 'panel-note' },
        'All code in this tool was written by an AI system (Claude) under the direction of team Missing Mass. Data: NASA SPHEREx via IRSA. Not affiliated with or endorsed by NASA.',
      ),
      h('p', { class: 'panel-note' }, 'Star positions: Gaia DR3. Built for NASA Space Apps 2026. Version ', h('span', { class: 'num' }, VERSION), '.'),
    );
  }

  function openHelp() {
    buildHelp();
    layout.openDialog(els.helpDialog);
  }

  let fogMap = null;
  async function openSkyMap() {
    layout.openDialog(els.mapDialog);
    if (!fogMap) {
      const host = h('div', { class: 'map-host' });
      clear(els.mapBody).append(host);
      try {
        fogMap = opt.fogmap.createFogMap(host, {
          onPick: ({ ra, dec }) => {
            layout.closeDialog(els.mapDialog);
            goTo({ ra, dec, name: '' });
          },
        });
      } catch (err) {
        console.warn('[tombaugh] sky map failed to start', err);
        clear(els.mapBody).append(h('p', { class: 'panel-note' }, 'The sky map could not be drawn in this browser.'));
        return;
      }
    }
    try {
      if (hasTarget()) fogMap.setHere(store.get().ra, store.get().dec);
      else fogMap.setHere(null);
    } catch {
      // optional
    }
    try {
      const counts = await api.fog();
      fogMap.setCounts(counts);
    } catch {
      toasts.show('The shared map of visited patches could not be loaded.', { kind: 'alert' });
    }
  }

  function closeSkyMap() {
    layout.closeDialog(els.mapDialog);
  }

  els.btnShare.addEventListener('click', () => share());
  els.btnHelp.addEventListener('click', () => openHelp());
  if (opt.fogmap && typeof opt.fogmap.createFogMap === 'function') {
    els.btnMap.hidden = false;
    els.btnMap.title = 'An all-sky map of the patches anyone has opened with this tool';
    els.btnMap.addEventListener('click', () => openSkyMap());
  }

  // ---- viewer events --------------------------------------------------------------------------
  const DEFAULT_READOUT = 'Click a source to measure it';
  layout.setReadout(DEFAULT_READOUT);
  viewer.on('click', (e) => {
    if (!e || !Number.isFinite(e.ra) || !Number.isFinite(e.dec) || !player.frameCount()) return;
    if (e.target && e.target.kind === 'gaia' && e.target.item && Number.isFinite(e.target.item.ra)) {
      select({ ra: e.target.item.ra, dec: e.target.item.dec, label: 'Gaia star' });
    } else {
      select({ ra: e.ra, dec: e.dec, x: e.x, y: e.y });
    }
  });
  viewer.on('hover', (e) => {
    if (!e || !Number.isFinite(e.ra) || !Number.isFinite(e.dec)) return;
    const c = fmtCoord(e.ra, e.dec);
    const frame = player.frame();
    let value = '';
    if (frame && !frame.rgb && !frame.rgba) value = e.masked || e.value === null || !Number.isFinite(e.value) ? '   no data' : `   ${e.value.toFixed(Math.abs(e.value) >= 100 ? 1 : 3)} MJy/sr`;
    layout.setReadout(`${c.deg}${c.hms ? `   ${c.hms} ${c.dms}` : ''}${value}`);
  });
  viewer.on('leave', () => layout.setReadout(DEFAULT_READOUT));
  viewer.on('option', (e) => {
    if (e && e.name === 'smooth') store.set({ smooth: !!e.value });
  });

  // ---- keyboard -------------------------------------------------------------------------------
  const keymap = {
    Space: () => player.toggle(),
    ArrowLeft: () => player.step(-1),
    ArrowRight: () => player.step(1),
    b: () => player.toggleBlink(),
    r: () => store.set({ view: store.get().view === 'residual' ? 'passes' : lib.fitSkyModel ? 'residual' : store.get().view, t: 0 }),
    g: () => store.set({ gaia: !store.get().gaia }),
    f: () => store.set({ flags: !store.get().flags }),
    '?': () => openHelp(),
    Escape: () => {
      if (layout.isSheetOpen()) layout.setSheet(false);
      else return false;
      return undefined;
    },
  };
  for (let d = 1; d <= 6; d++) keymap[String(d)] = () => store.set({ det: d, t: 0 });
  const keysEnabled = () => document.documentElement.dataset.screen === 'console' && !document.querySelector('dialog[open]');
  if (opt.shortcuts && typeof opt.shortcuts.bindShortcuts === 'function') {
    try {
      opt.shortcuts.bindShortcuts(keymap, { enabled: keysEnabled });
    } catch (err) {
      console.warn('[tombaugh] shortcuts failed to bind', err);
    }
  } else {
    document.addEventListener('keydown', (e) => {
      if (!keysEnabled() || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      const tag = el && el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || (el && el.isContentEditable)) return;
      const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if ((key === 'Space' || key === 'Enter') && (tag === 'button' || tag === 'a')) return;
      const fn = keymap[key];
      if (fn && fn() !== false) e.preventDefault();
    });
  }

  // ---- state -> everything --------------------------------------------------------------------
  store.subscribe((s, changed) => {
    writeUrlState(s);
    const has = (k) => changed.includes(k);
    emit('state', { state: s, changed });
    if (has('embed')) layout.setEmbed(s.embed);
    if (has('ra') || has('dec')) {
      if (hasTarget()) startTarget();
      else showLanding();
      return;
    }
    if (has('name')) updateSearchLine();
    if (!hasTarget()) return;
    if (has('fov') || has('zodi')) {
      resetField({ keepSelection: true });
      session.key = targetKey(s);
      session.firstMovie = false;
      startLoad();
      return;
    }
    if (has('det')) {
      session.movieToken += 1;
      loadSelected();
      return;
    }
    if (['view', 'ch', 'lens', 'dist', 'diffA', 'diffB', 'perExposure'].some(has)) {
      if (has('view') && session.loading && session.loading.label) {
        // Leaving a view that was waiting for extra detectors: drop the wait.
        session.loading = null;
      }
      scheduleRebuild({ reset: has('view') || has('perExposure') || has('lens') });
    }
    if (has('stretch') || has('colormap')) renderFrame(player.frame());
    if (has('smooth')) {
      try {
        viewer.setOptions({ smooth: s.smooth });
      } catch {
        // optional
      }
    }
    if (has('gaia') || has('flags')) updateOverlays();
    if (has('name') || has('det')) document.title = titleFor(s);
  });

  function titleFor(s) {
    if (!hasTarget()) return 'Tombaugh: a blink comparator for the 102-color sky';
    return `${s.name || fmtCoord(s.ra, s.dec).deg}${session.simulated ? ' (simulated sky)' : ''} · Tombaugh`;
  }

  // ---- embed credit ---------------------------------------------------------------------------
  if (store.get().embed) {
    const full = shareUrl({ ...store.get(), embed: false });
    player.setCredit(h('span', null, 'TOMBAUGH, a blink comparator for the 102-color sky. ', h('a', { href: full, target: '_blank', rel: 'noopener' }, 'Open the full view')));
  }

  // ---- plugin host ----------------------------------------------------------------------------
  const app = {
    version: VERSION,
    api,
    store,
    viewer: viewer.missing ? null : viewer,
    lib,
    target() {
      const s = store.get();
      return hasTarget() ? { ra: s.ra, dec: s.dec, name: s.name || '' } : null;
    },
    grid: () => session.grid,
    frames: (det) => allFrames(det),
    layers(det) {
      const d = det === undefined || det === null ? currentData() : session.byDet.get(det);
      return d ? d.layers.slice() : [];
    },
    movie() {
      const s = store.get();
      return { frames: session.movie ? session.movie.frames.slice() : [], index: player.index(), playing: player.isPlaying(), view: s.view };
    },
    setFrameIndex(i) {
      if (!player.frameCount()) return;
      player.pause();
      player.setIndex(i);
    },
    play: () => player.play(),
    pause: () => player.pause(),
    goTo: (t) => {
      if (t) goTo({ ra: Number(t.ra), dec: Number(t.dec), name: t.name || '' });
    },
    gaia: () => session.gaia.stars.slice(),
    selection() {
      const sel = session.selection;
      if (!sel) return null;
      return { ra: sel.ra, dec: sel.dec, x: sel.x, y: sel.y, label: sel.label, spectrum: sel.spectrum, binned: sel.binned, lightCurve: sel.lightCurve, motion: sel.motion || undefined };
    },
    on(event, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
    addTool(spec) {
      return layout.addTool(spec || {});
    },
    addPanel({ id, title, order, render } = {}) {
      let rendered = null;
      let done = false;
      const handle = layout.addTab({
        id,
        title: title || String(id),
        order: Number.isFinite(order) ? order : 60,
        onShow: () => {
          if (!done) {
            done = true;
            try {
              rendered = render ? render(handle.body) || null : null;
            } catch (err) {
              console.warn(`[tombaugh] panel "${id}" failed to render`, err);
              handle.body.textContent = 'This panel could not be drawn.';
            }
          } else if (rendered && typeof rendered.update === 'function') {
            try {
              rendered.update();
            } catch (err) {
              console.warn(`[tombaugh] panel "${id}" failed to update`, err);
            }
          }
        },
      });
      if (!handle) return { show() {}, hide() {}, remove() {} };
      return {
        show: () => handle.show(),
        hide: () => handle.hide(),
        remove() {
          try {
            if (rendered && typeof rendered.dispose === 'function') rendered.dispose();
          } catch (err) {
            console.warn(`[tombaugh] panel "${id}" failed to dispose`, err);
          }
          handle.remove();
        },
      };
    },
    addView({ id, label, title, needs, build } = {}) {
      if (!id || typeof build !== 'function' || pluginViews.has(id) || VIEWS.includes(id)) return { remove() {} };
      pluginViews.set(id, { id, label: label || id, title: title || '', needs, build });
      controls.addView({ id, label: label || id, title: title || '' });
      if (store.get().view === id && currentData()) scheduleRebuild({ reset: true });
      return {
        remove() {
          pluginViews.delete(id);
          controls.removeView(id);
          if (store.get().view === id) store.set({ view: 'passes', t: 0 });
        },
      };
    },
    addOverlay(fn) {
      if (typeof fn !== 'function') return () => {};
      overlayFns.add(fn);
      updateOverlays();
      return () => {
        overlayFns.delete(fn);
        updateOverlays();
      };
    },
    toast(message, { kind = 'info', ms } = {}) {
      toasts.show(String(message), { kind: kind === 'warn' || kind === 'error' ? 'alert' : 'info', timeout: Number.isFinite(ms) ? ms : 3600 });
    },
    explain: (topicId) => explain(topicId),
    openModal: (spec) => layout.openModal(spec || {}),
    /** Re-draw overlays (for plugins whose addOverlay output changed). */
    refreshOverlays: () => updateOverlays(),

    /**
     * Replace the data service (an object with the interface of createApi()). Loads in flight
     * are cancelled, everything fetched through the old service is dropped, and the current
     * target is loaded again. Passing the object already in use reloads through it. Emits 'api'.
     */
    setApi(next) {
      if (!next || typeof next.search !== 'function' || typeof next.cutout !== 'function') return false;
      api = next;
      app.api = next;
      loader.setApi(next);
      emit('api', { api: next });
      if (hasTarget()) startTarget();
      return true;
    },
    /**
     * Measure the source at a sky position, exactly as a click on the image there does.
     * -> Promise of the selection (as app.selection()), or of null when no movie is showing.
     */
    selectAt(pos) {
      const ra = pos ? Number(pos.ra) : NaN;
      const dec = pos ? Number(pos.dec) : NaN;
      if (!Number.isFinite(ra) || !Number.isFinite(dec) || !player.frameCount()) return Promise.resolve(null);
      try {
        select({ ra, dec, label: pos.label ? String(pos.label) : '' });
      } catch (err) {
        return Promise.reject(err);
      }
      return Promise.resolve(app.selection());
    },
    /** Show arbitrary points in the spectrum panel (same shapes as the spectrum plot) and open it. */
    showSpectrum({ points = [], binned = [], title = '', colorBy = undefined, note = '' } = {}) {
      panels.setSource(null);
      panels.setSpectrum({ points, binned, title: title || 'Spectrum', colorBy, heading: title || 'Spectrum', note: note || `${points.length} point${points.length === 1 ? '' : 's'} supplied by a tool, not measured from a click on this image.` });
      layout.selectTab('spectrum', { reveal: true });
    },
    /** An extra note for every frame caption (and so for exported images); null or '' removes it. */
    setCaptionNote(text) {
      const next = text === null || text === undefined ? '' : String(text).trim().slice(0, 80);
      if (next === session.captionNote) return;
      session.captionNote = next;
      syncSimulatedBadge();
      refreshCaptions();
    },
    /** Open the all-sky map of visited patches. */
    showFog: () => {
      if (opt.fogmap && typeof opt.fogmap.createFogMap === 'function') openSkyMap();
    },
    openSkyMap: () => app.showFog(),
    closeSkyMap: () => closeSkyMap(),
    /** Open a side panel by id ('spectrum', 'lightcurve', 'motion', 'candidates', 'about' or a plugin panel). */
    showPanel(id) {
      layout.selectTab(String(id), { reveal: true });
      return layout.currentTab() === String(id);
    },
  };
  try {
    window.tombaugh = app;
  } catch {
    // ignore
  }

  async function loadPlugins() {
    let names = [];
    try {
      const index = await import('./plugins/index.js');
      names = Array.isArray(index.PLUGINS) ? index.PLUGINS : [];
    } catch (err) {
      console.warn('[tombaugh] no plugin index:', err && err.message ? err.message : err);
    }
    app.plugins = [];
    for (const name of names) {
      if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) continue;
      try {
        const mod = await import(`./plugins/${name}/index.js`);
        if (typeof mod.install !== 'function') throw new Error('no install() export');
        const handle = (await mod.install(app)) || null;
        app.plugins.push({ name, meta: mod.meta || { id: name }, handle });
      } catch (err) {
        console.warn(`[tombaugh] plugin "${name}" was skipped:`, err && err.message ? err.message : err);
      }
    }
    // A view id in the URL that no plugin claimed falls back to the default view.
    const view = store.get().view;
    if (!VIEWS.includes(view) && !pluginViews.has(view)) store.set({ view: 'passes' });
  }

  // ---- go -------------------------------------------------------------------------------------
  updateAbout();
  updateCitation();
  panels.setCandidates({ status: 'idle' });
  if (hasTarget()) {
    document.title = titleFor(store.get());
    startTarget();
  } else {
    showLanding();
  }
  if (viewer.missing) {
    toasts.show('The image viewer module is missing from this build, so frames cannot be drawn.', { kind: 'alert', timeout: 8000 });
  }
  await loadPlugins();
}

boot().catch((err) => {
  console.error('[tombaugh] failed to start', err);
  try {
    document.documentElement.dataset.screen = 'console';
    const host = document.getElementById('viewer-status');
    if (host) {
      host.hidden = false;
      host.textContent = 'Tombaugh could not start in this browser. Reloading the page usually helps.';
    }
  } catch {
    // nothing more to do
  }
});
