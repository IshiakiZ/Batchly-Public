// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// spotlight.js - draws attention without clutter: one thin Signal ring with a short label that
// eases onto a screen element (by data-testid, id or selector) or onto a sky position in the
// viewer, and follows it while it is shown. One spotlight at a time.
//
// A sky position is converted to the screen with the common grid (app.grid()) and the viewer's
// current view (app.viewer.getView(), app.viewer.element). When the viewer cannot tell us where
// its pixels are, the position is handed to the viewer instead as an overlay marker
// (app.addOverlay), which is less animated but always lands in the right place.
//
// createSpotlight({ host, app, doc, win, unit(), bounds(), reducedMotion }) -> { point(spec), clear(), destroy() }
//   spec: { element: 'panel-motion', label?, pad? } | { sky: { ra, dec, spanArcsec? }, label? }
// skyToClient, easeOutCubic, lerpRect and ringForSky are pure and exported for tests.

import { gridSkyToPix } from '../../core/wcs.js';

const EASE_MS = 420;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const easeOutCubic = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** Blend two rectangles { x, y, w, h }. */
export function lerpRect(a, b, t) {
  const m = (p, q) => p + (q - p) * t;
  return { x: m(a.x, b.x), y: m(a.y, b.y), w: m(a.w, b.w), h: m(a.h, b.h) };
}

/**
 * Sky position -> client pixel, for a viewer that letterboxes an n x n grid into a square.
 * @param {{ ra0, dec0, n, scale }} grid the common grid (scale in arcsec per grid pixel)
 * @param {{ zoom?: number, cx?: number, cy?: number }|null} view the viewer's view (default: whole grid)
 * @param {{ left, top, width, height }} box the viewer element in client pixels
 * @returns {{ x: number, y: number, pxPerArcsec: number, inside: boolean } | null}
 */
export function skyToClient(grid, view, box, ra, dec) {
  if (!grid || !isNum(grid.n) || !(grid.n > 0) || !box || !isNum(ra) || !isNum(dec)) return null;
  const size = Math.floor(Math.min(box.width, box.height));
  if (!(size > 0)) return null;
  const p = gridSkyToPix(grid, ra, dec);
  if (!p || !isNum(p[0]) || !isNum(p[1])) return null;
  const c = (grid.n - 1) / 2;
  const zoom = view && isNum(view.zoom) && view.zoom > 0 ? view.zoom : 1;
  const cx = view && isNum(view.cx) ? view.cx : c;
  const cy = view && isNum(view.cy) ? view.cy : c;
  const k = (size * zoom) / grid.n;
  const ox = Math.floor((box.width - size) / 2);
  const oy = Math.floor((box.height - size) / 2);
  const u = ox + size / 2 + (p[0] - cx) * k;
  const v = oy + size / 2 - (p[1] - cy) * k;
  return {
    x: box.left + u,
    y: box.top + v,
    pxPerArcsec: isNum(grid.scale) && grid.scale > 0 ? k / grid.scale : 0,
    inside: u >= ox && v >= oy && u <= ox + size && v <= oy + size,
  };
}

/** The ring around a sky position: wide enough to hold the object's whole track across the movie. */
export function ringForSky(point, spanArcsec, unit) {
  const u = isNum(unit) && unit > 0 ? unit : 8;
  const span = isNum(spanArcsec) && spanArcsec > 0 ? spanArcsec * point.pxPerArcsec : 0;
  const r = Math.max(u * 2.6, 22, span / 2 + u * 1.7);
  return { x: point.x - r, y: point.y - r, w: 2 * r, h: 2 * r };
}

function findElement(doc, name) {
  if (!doc || !name) return null;
  const id = String(name);
  try {
    const esc = id.replace(/["\\]/g, '\\$&');
    const byTest = doc.querySelector(`[data-testid="${esc}"]`);
    if (byTest) return byTest;
  } catch {
    // not a valid attribute value
  }
  const byId = doc.getElementById(id);
  if (byId) return byId;
  try {
    return doc.querySelector(id);
  } catch {
    return null;
  }
}

export function createSpotlight({ host, app = null, doc = globalThis.document, win = null, unit = () => 8, bounds = null, reducedMotion = false } = {}) {
  const view = win || (doc && doc.defaultView) || globalThis.window;
  const node = doc.createElement('div');
  node.className = 'tbs-spot';
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('data-testid', 'story-spotlight');
  const ring = doc.createElement('div');
  ring.className = 'tbs-spot__ring';
  const label = doc.createElement('div');
  label.className = 'tbs-spot__label';
  node.append(ring, label);
  (host || doc.body).appendChild(node);

  let spec = null;
  let raf = 0;
  let from = null; //     rectangle the ease started from
  let shown = null; //    rectangle drawn last
  let easeStart = 0;
  let fade = 0; //        0..1
  let removeOverlay = null;
  let destroyed = false;

  const now = () => (view && view.performance ? view.performance.now() : Date.now());

  function dropOverlay() {
    if (removeOverlay) {
      try {
        removeOverlay();
      } catch {
        // the app is gone
      }
    }
    removeOverlay = null;
  }

  /** Bring what the ring points at into sight: unfold its panel and scroll it to the middle of the screen. */
  function reveal() {
    try {
      let target = null;
      if (spec.sky) {
        const viewer = app && app.viewer;
        target = viewer && (viewer.element || viewer.canvas);
      } else {
        target = findElement(doc, spec.element);
      }
      if (!target || typeof target.getBoundingClientRect !== 'function') return;
      const folded = typeof target.closest === 'function' ? target.closest('.panel.is-folded') : null;
      const title = folded && typeof folded.querySelector === 'function' ? folded.querySelector('.panel-title') : null;
      if (title && typeof title.click === 'function') title.click();
      const height = (view && view.innerHeight) || 0;
      if (!height || typeof target.scrollIntoView !== 'function') return;
      const r = target.getBoundingClientRect();
      const tall = r.height > height * 0.9;
      if (tall ? r.top >= 0 && r.top <= height * 0.25 : r.top >= 0 && r.bottom <= height) return;
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: tall ? 'start' : 'center' });
    } catch {
      // pointing still works without the scroll
    }
  }

  /** Where the current target is on screen: { rect, round } or null when it cannot be found. */
  function locate() {
    if (!spec) return null;
    if (spec.sky) {
      const viewer = app && app.viewer;
      const grid = app && typeof app.grid === 'function' ? app.grid() : null;
      const elv = viewer && (viewer.element || viewer.canvas);
      if (!grid || !elv || typeof elv.getBoundingClientRect !== 'function') return null;
      let v = null;
      try {
        v = typeof viewer.getView === 'function' ? viewer.getView() : null;
      } catch {
        v = null;
      }
      const p = skyToClient(grid, v, elv.getBoundingClientRect(), spec.sky.ra, spec.sky.dec);
      if (!p || !p.inside) return null;
      return { rect: ringForSky(p, spec.sky.spanArcsec, unit()), round: true };
    }
    const target = findElement(doc, spec.element);
    if (!target || typeof target.getBoundingClientRect !== 'function') return null;
    const r = target.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return null;
    const pad = isNum(spec.pad) ? spec.pad : 6;
    let x0 = r.left - pad;
    let y0 = r.top - pad;
    let x1 = r.right + pad;
    let y1 = r.bottom + pad;
    const b = bounds ? bounds() : null;
    if (b) {
      x0 = Math.max(x0, b.left + 3);
      y0 = Math.max(y0, b.top + 3);
      x1 = Math.min(x1, b.right - 3);
      y1 = Math.min(y1, b.bottom - 3);
    }
    if (x1 - x0 < 8 || y1 - y0 < 8) return null;
    return { rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, round: false };
  }

  function draw(rect, opacity, round) {
    const s = node.style;
    s.transform = `translate(${rect.x.toFixed(1)}px, ${rect.y.toFixed(1)}px)`;
    s.width = `${rect.w.toFixed(1)}px`;
    s.height = `${rect.h.toFixed(1)}px`;
    s.opacity = String(opacity);
    node.classList.toggle('is-round', !!round);
    const b = bounds ? bounds() : null;
    const right = b ? b.right : (view && view.innerWidth) || 0;
    const top = b ? b.top : 0;
    node.classList.toggle('is-left', !!round && right > 0 && rect.x + rect.w > right * 0.7);
    const need = Math.max(30, unit() * 3.2); // room a label needs above the ring
    const bottom = b ? b.bottom : (view && view.innerHeight) || 0;
    const above = rect.y - top >= need;
    const below = !above && rect.y + rect.h + need <= bottom;
    node.classList.toggle('is-below', !round && below);
    node.classList.toggle('is-inside', !round && !above && !below);
  }

  function frame() {
    raf = 0;
    if (destroyed || !spec) return;
    const hit = locate();
    if (!hit) {
      node.style.opacity = '0';
      shown = null;
      from = null;
    } else {
      if (removeOverlay) dropOverlay();
      if (!from) {
        // First appearance: settle inwards from a slightly larger ring.
        const g = 0.18;
        from = { x: hit.rect.x - hit.rect.w * g, y: hit.rect.y - hit.rect.h * g, w: hit.rect.w * (1 + 2 * g), h: hit.rect.h * (1 + 2 * g) };
        fade = 0;
        easeStart = now();
      }
      const t = reducedMotion ? 1 : easeOutCubic((now() - easeStart) / EASE_MS);
      shown = lerpRect(from, hit.rect, t);
      fade = reducedMotion ? 1 : Math.max(fade, Math.min(1, t * 1.6));
      draw(shown, fade, hit.round);
    }
    schedule();
  }

  function schedule() {
    if (raf || destroyed || !spec) return;
    if (view && typeof view.requestAnimationFrame === 'function') raf = view.requestAnimationFrame(frame);
  }

  function point(next) {
    if (destroyed) return false;
    if (!next || (!next.element && !next.sky)) {
      clear();
      return false;
    }
    dropOverlay();
    spec = next;
    label.textContent = next.label || '';
    reveal();
    const hit = locate();
    if (!hit) {
      // No way to place the ring: let the viewer mark a sky position itself.
      if (next.sky && app && typeof app.addOverlay === 'function') {
        const marker = { ra: next.sky.ra, dec: next.sky.dec, kind: 'target', label: next.label || '' };
        try {
          removeOverlay = app.addOverlay(() => ({ markers: [marker] }));
          if (typeof app.refreshOverlays === 'function') app.refreshOverlays();
        } catch {
          removeOverlay = null;
        }
      }
      node.style.opacity = '0';
      from = null;
      shown = null;
      schedule(); // the element may appear a moment later (a panel that is still opening)
      return !!removeOverlay;
    }
    // Ease from where the ring is now, or settle in when it was hidden.
    from = shown ? { ...shown } : null;
    easeStart = now();
    if (!(view && typeof view.requestAnimationFrame === 'function')) {
      shown = hit.rect;
      draw(hit.rect, 1, hit.round);
    } else {
      if (raf) view.cancelAnimationFrame(raf);
      raf = 0;
      frame();
    }
    return true;
  }

  function clear() {
    spec = null;
    dropOverlay();
    if (raf && view && typeof view.cancelAnimationFrame === 'function') view.cancelAnimationFrame(raf);
    raf = 0;
    node.style.opacity = '0';
    from = null;
    shown = null;
    label.textContent = '';
  }

  return {
    el: node,
    point,
    clear,
    current: () => spec,
    destroy() {
      clear();
      destroyed = true;
      node.remove();
    },
  };
}
