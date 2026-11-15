// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// A tiny stand-in for the shell's `app` object, with only the parts the Validation plugin uses,
// for the unit tests (no DOM needed) and for demo.html. It behaves like web/src/main.js where
// that matters here: goTo() takes ra, dec and name only, the detector and the field size live in
// the store, a new target or detector starts a load, a second detector of the same target joins
// what is loaded, and a load announces itself with 'frames' events ({ det, count, total,
// complete }) followed by 'movie'.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {object} [options]
 *   provide(request) -> field | null   called for every load with { ra, dec, name, det, fov };
 *       field = { grid, frames, layersByDet: Map<det, Layer[]>, gaia: { epoch, stars } }.
 *       null (or a field without layers for that detector) means "no exposures here".
 *       'never' means the load hangs, as when the archive does not answer.
 *   delayMs      time one load takes (default 0: next timer tick)
 *   steps        partial 'frames' events before the complete one (default 2)
 *   completeFlag false to leave `complete` out of the 'frames' payload, like an older shell
 *   det, fov     initial store values (default 3 and 4)
 *   version      app.version
 *   panelHost    element to draw panels into (demo.html); without it addPanel keeps the spec
 * @returns the fake app; extra members for tests: log (array of what happened), panels, dispose()
 */
export function createFakeApp(options = {}) {
  const { provide = () => null, delayMs = 0, steps = 2, completeFlag = true, version = '0.0.0-fake', panelHost = null } = options;
  let state = { ra: null, dec: null, name: '', det: isNum(options.det) ? options.det : 3, fov: isNum(options.fov) ? options.fov : 4 };
  const subscribers = new Set();
  const listeners = new Map();
  const timers = new Set();
  const log = [];
  const panels = [];
  let token = 0;
  let data = null; // { grid, frames, layersByDet, gaia }
  let selection = null;
  let disposed = false;

  const hasTarget = () => isNum(state.ra) && isNum(state.dec);
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
  };
  function emit(event, payload) {
    log.push({ event, payload });
    for (const fn of Array.from(listeners.get(event) || [])) {
      try {
        fn(payload);
      } catch {
        // a listener that throws must not stop the others
      }
    }
  }

  function startLoad({ keep = false } = {}) {
    const mine = ++token;
    const request = { ra: state.ra, dec: state.dec, name: state.name, det: state.det, fov: state.fov };
    if (!keep) {
      data = null;
      selection = null;
    } else if (data && data.layersByDet.has(request.det)) {
      // Like the shell: a detector that is already loaded only rebuilds the movie.
      const have = data.layersByDet.get(request.det);
      later(() => {
        if (mine === token) emit('movie', { view: 'passes', frames: have.map((l) => ({ image: l.image, mask: l.mask, mjd: l.mjd, range: [0, 1], caption: {} })) });
      }, 0);
      return;
    }
    log.push({ event: 'load', payload: request });
    let field = null;
    try {
      field = provide(request);
    } catch {
      field = null;
    }
    if (field === 'never') return;
    const layers = field && field.layersByDet && field.layersByDet.get(request.det) ? field.layersByDet.get(request.det) : [];
    const total = layers.length;
    const flag = (complete) => (completeFlag ? { complete } : {});
    const step = Math.max(0, delayMs) / (steps + 1);
    for (let i = 1; i <= steps && total > 0; i++) {
      later(() => {
        if (mine !== token) return;
        emit('frames', { det: request.det, count: Math.floor((total * i) / (steps + 1)), total, ...flag(false) });
      }, step * i);
    }
    later(() => {
      if (mine !== token) return;
      if (total > 0) {
        if (keep && data) {
          // A second detector of the same target joins what is loaded.
          data.layersByDet.set(request.det, layers);
          data.frames = data.frames.filter((f) => f.det !== request.det).concat((field.frames || []).filter((f) => f.det === request.det));
        } else {
          data = { ...field, frames: (field.frames || []).slice(), layersByDet: new Map(field.layersByDet) };
        }
      }
      emit('frames', { det: request.det, count: total, total, ...flag(true) });
      if (total > 0) emit('movie', { view: 'passes', frames: layers.map((l) => ({ image: l.image, mask: l.mask, mjd: l.mjd, range: [0, 1], caption: {} })) });
    }, Math.max(0, delayMs));
  }

  const store = {
    get: () => ({ ...state }),
    set(patch) {
      const changed = Object.keys(patch || {}).filter((k) => patch[k] !== state[k]);
      if (!changed.length) return;
      state = { ...state, ...patch };
      for (const fn of Array.from(subscribers)) {
        try {
          fn(store.get(), changed);
        } catch {
          // ignore
        }
      }
      emit('state', { state: store.get(), changed });
      const moved = changed.includes('ra') || changed.includes('dec');
      if (!hasTarget()) return;
      if (moved) {
        // Like the shell: the old field is dropped before the new target is announced.
        token++;
        data = null;
        selection = null;
        emit('target', { ra: state.ra, dec: state.dec, name: state.name });
      }
      if (moved || changed.includes('fov')) startLoad();
      else if (changed.includes('det')) startLoad({ keep: true });
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };

  const app = {
    version,
    store,
    viewer: null,
    log,
    panels,
    target: () => (hasTarget() ? { ra: state.ra, dec: state.dec, name: state.name || '' } : null),
    grid: () => (data ? data.grid : null),
    frames(det) {
      if (!data) return [];
      const all = data.frames || [];
      return det === undefined || det === null ? all.slice() : all.filter((f) => f.det === det);
    },
    layers(det) {
      if (!data) return [];
      const d = det === undefined || det === null ? state.det : det;
      return (data.layersByDet.get(d) || []).slice();
    },
    gaia() {
      const stars = data && data.gaia ? data.gaia.stars || [] : [];
      const epoch = data && data.gaia && isNum(data.gaia.epoch) ? data.gaia.epoch : 2016.0;
      return stars.map((s) => ({ ...s, epoch: s.epoch ?? epoch }));
    },
    selection: () => (selection ? { ...selection } : null),
    select(sel) {
      selection = sel ? { ...sel } : null;
      emit('select', selection);
    },
    movie: () => ({ frames: [], index: 0, playing: false, view: 'passes' }),
    goTo(t) {
      // Like the shell: only the position and the name are taken.
      if (!t || !isNum(Number(t.ra)) || !isNum(Number(t.dec))) return;
      store.set({ ra: Number(t.ra), dec: Number(t.dec), name: t.name || '' });
    },
    on(event, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
    listenerCount: () => Array.from(listeners.values()).reduce((a, set) => a + set.size, 0),
    addPanel(spec = {}) {
      const entry = { spec, rendered: null, removed: false, body: null, section: null };
      panels.push(entry);
      if (panelHost && typeof panelHost.ownerDocument !== 'undefined') {
        const doc = panelHost.ownerDocument;
        entry.section = doc.createElement('section');
        entry.section.className = 'panel';
        const title = doc.createElement('h2');
        title.className = 'panel-title';
        title.textContent = spec.title || String(spec.id);
        entry.body = doc.createElement('div');
        entry.body.className = 'panel-body';
        entry.section.append(title, entry.body);
        panelHost.append(entry.section);
        entry.rendered = spec.render ? spec.render(entry.body) || null : null;
      }
      return {
        show() {
          if (entry.rendered && typeof entry.rendered.update === 'function') entry.rendered.update();
        },
        hide() {},
        remove() {
          if (entry.removed) return;
          entry.removed = true;
          if (entry.rendered && typeof entry.rendered.dispose === 'function') entry.rendered.dispose();
          if (entry.section) entry.section.remove();
        },
      };
    },
    toast(message) {
      log.push({ event: 'toast', payload: String(message) });
    },
    dispose() {
      disposed = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
    },
  };
  return app;
}
