// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// The astronomical image viewer. Canvas 2D, north up, east left, crisp pixels by default.
// Self-contained: injects its own styles (viewer.css.js) and does its own sky <-> grid math
// (viewmath.js), so it imports nothing from web/src/core.
//
// ---- Contract API ---------------------------------------------------------------------------
//   const viewer = createViewer(container)
//   viewer.setGrid({ ra0, dec0, n, scale })
//   viewer.setImage({ image, mask?, range?, stretch?, colormap?, diverging? })   n*n scalar, row 0 = south
//   viewer.setRgb(uint8ClampedArray)                                             n*n*4, row 0 = south
//   viewer.setOverlays({ gaia?, flags?, markers?, trail? })
//   viewer.setCaption({ title, date, wave, note })
//   viewer.on('click', ({ ra, dec, x, y }) => {});  viewer.on('hover', ({ ra, dec, value }) => {})
//   viewer.toDataURL() -> string;  viewer.destroy()
//
// ---- Optional extras (all additive) ----------------------------------------------------------
//   createViewer(container, options)   options = any of the keys of DEFAULT_OPTIONS below
//   setImage extras    { transition: 'fade' | 'cut', cache: false } in the same object. Rendered
//                      frames are cached per `image` array (WeakMap) so a movie replays without
//                      recomputing: treat arrays as immutable. A sampled content check catches
//                      most arrays refilled in place; pass cache: false to be certain.
//                      Without `range` a 0.5-99.7 percentile range is used.
//                      'fade' (default, about 120 ms) turns into a cut automatically when frames
//                      arrive faster than 1.5 x the fade time, and under prefers-reduced-motion.
//   setRgb(rgba, { transition })       alpha 0 pixels are drawn as missing data
//   setOverlays        MERGES by key: keys you leave out are untouched, a key that is present
//                      with null / undefined / [] clears that overlay; setOverlays(null) clears all.
//                      gaia items may add `to: { ra, dec }` (measured position; drawn for moved
//                      stars) and `radius` (arcsec). trail items may add `mjd` or `label` for date
//                      ticks. flags is any n*n typed array, non-zero = flagged, grid order.
//   setCaption         date may be an MJD number, wave a number in micrometres; null clears.
//   on(type, fn) -> unsubscribe;  off(type, fn)
//     'click'  { ra, dec, x, y, value, ix, iy, target }  target = { kind: 'gaia', index, item } | null
//     'hover'  { ra, dec, value, x, y, ix, iy, masked }  value is null where there is no data
//     'leave'  {}                                         pointer left the image
//     'view'   { zoom, cx, cy, ra, dec }                  after any pan / zoom
//     'option' { name, value }                            user flipped a toolbar toggle
//     ra / dec are null until setGrid has been called. A drag never produces a click; a
//     double-click (or double-tap) while zoomed resets the view and emits only the first click.
//   setOptions(patch), getOptions()
//   setView({ zoom?, ra?, dec?, x?, y? }), getView(), resetView(), zoomBy(factor)
//   flash()            brief Signal outline of the frame edge (e.g. when a movie wraps around)
//   toDataURL({ scale = 2, type, quality }), toCanvas({ scale })   image + overlays + caption
//   resize()           force a re-measure (a ResizeObserver normally does this)
//   element, canvas    the root <div class="tbv"> and the <canvas>
//
// Keyboard (canvas focused): + / = zoom in, - zoom out, 0 reset, arrow keys pan WHEN ZOOMED IN.
// At 1x the arrow keys are left alone so page-level shortcuts (frame stepping) keep working.
// Handled keys call preventDefault() and stopPropagation().
// Sizing: the root is width 100% and square (aspect-ratio 1/1, max-height 100%); the image is
// letterboxed inside whatever box results. Pass { fill: true } to fill a container that has its
// own height.

import { injectViewerStyles } from './viewer.css.js';
import { COLORMAPS, colormapLut, autoRange, displayRange, renderScalar, isLightMap, MASK_RGB } from './colormaps.js';
import {
  gridSkyToPix,
  gridPixToSky,
  letterbox,
  defaultView,
  maxZoomFor,
  clampView,
  pixelScale,
  gridToCanvas,
  canvasToGrid,
  imageRect,
  zoomAbout,
  panBy,
  nearestPixel,
  pickScaleBar,
  formatValue,
  formatDeg,
  mjdToIso,
  maskRuns,
} from './viewmath.js';
import {
  BRAND,
  rgba,
  hitGaia,
  drawGaia,
  drawMarkers,
  markerObstacles,
  drawTrail,
  drawCompass,
  drawScaleBar,
  drawCrosshair,
  drawPixelGrid,
  drawRegionHatch,
  drawCaption,
  drawColorbar,
  drawLoupe,
  drawFlash,
  drawEmpty,
} from './overlays.js';

export const DEFAULT_OPTIONS = {
  smooth: false, //        bilinear interpolation instead of crisp pixels
  transition: 'fade', //   default setImage transition: 'fade' | 'cut'
  fadeMs: 120,
  stretch: 'linear', //    used when setImage gives none
  colormap: 'gray', //     used when setImage gives none
  compass: true,
  scaleBar: true,
  colorbar: true,
  caption: true,
  plainCaption: false, //  the caption in the page's own type on a round pill
  crosshair: false, //     open reticle at the grid centre
  pixelGrid: true, //      pixel boundaries at high zoom
  loupe: false, //         magnified inset beside the cursor (mouse / pen only)
  readout: false, //       live "ra dec value" line above the caption
  toolbar: true, //        zoom / reset / smooth / crosshair / loupe buttons
  interactive: true, //    pan and zoom
  wheelZoom: true, //      true | 'ctrl' (only with Ctrl / Cmd held) | false
  keyboard: true,
  maxZoom: null, //        default: about four grid pixels across the viewport
  fill: false, //          fill the container's height instead of being square
  unit: '', //             appended to pixel values in the loupe and readout, e.g. 'MJy/sr'
  emptyText: '', //        text under the idle reticle before any image arrives; null hides the reticle too
};

const ICONS = {
  zoomOut: '<path d="M3.5 8h9"/>',
  zoomIn: '<path d="M8 3.5v9M3.5 8h9"/>',
  reset: '<path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/>',
  smooth: '<path d="M1.5 12.5c3.3 0 3.7-9 6.5-9s3.2 9 6.5 9"/>',
  crosshair: '<path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4"/>',
  loupe: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2l3.8 3.8"/>',
};

const FLASH_MS = 420;
const TAP_SLOP = 4; //      px of movement that turns a press into a drag
const DOUBLE_MS = 320;
const DOUBLE_SLOP = 24;

const easeOut = (p) => 1 - (1 - p) * (1 - p);

// A cheap content check (about 250 samples) so that an array which was refilled in place is not
// served from the frame cache. It is a safety net, not a guarantee: pass cache: false to be sure.
function fingerprint(a) {
  if (!a || !a.length) return 0;
  const len = a.length;
  const step = Math.max(1, Math.floor(len / 251));
  let sum = len;
  for (let i = 0; i < len; i += step) {
    const v = a[i];
    sum += (v - v === 0 ? v : 7.5) * (1 + (i % 13));
  }
  return sum;
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function createViewer(container, options = {}) {
  if (!container || !container.ownerDocument) throw new Error('createViewer: a container element is required');
  const doc = container.ownerDocument;
  const win = doc.defaultView || globalThis;
  const now = () => (win.performance ? win.performance.now() : Date.now());
  injectViewerStyles(container);

  let opts = { ...DEFAULT_OPTIONS, ...(options || {}) };

  // ---- DOM ------------------------------------------------------------------------------------
  const root = doc.createElement('div');
  root.className = 'tbv';
  const canvas = doc.createElement('canvas');
  canvas.className = 'tbv-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('tabindex', '0');
  canvas.setAttribute('aria-label', 'Sky image. North is up, east is left.');
  const ctx = canvas.getContext('2d');
  root.appendChild(canvas);

  const toolbar = doc.createElement('div');
  toolbar.className = 'tbv-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Image view');
  const buttons = {};
  const addButton = (name, label, toggle) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'tbv-btn';
    b.title = label;
    b.setAttribute('aria-label', label);
    if (toggle) b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true">${ICONS[name]}</svg>`;
    toolbar.appendChild(b);
    buttons[name] = b;
    return b;
  };
  addButton('zoomOut', 'Zoom out (-)');
  addButton('zoomIn', 'Zoom in (+)');
  addButton('reset', 'Reset view (0)');
  const sep = doc.createElement('span');
  sep.className = 'tbv-sep';
  sep.setAttribute('aria-hidden', 'true');
  toolbar.appendChild(sep);
  addButton('smooth', 'Smooth interpolation', true);
  addButton('crosshair', 'Centre crosshair', true);
  addButton('loupe', 'Loupe', true).classList.add('tbv-btn-loupe');
  root.appendChild(toolbar);
  container.appendChild(root);

  // ---- state ----------------------------------------------------------------------------------
  let destroyed = false;
  let grid = null; //   { ra0, dec0, n, scale } once setGrid has been called
  let n = 0; //         raster side in pixels
  let view = defaultView(1);
  const makeLayer = () => {
    const c = doc.createElement('canvas');
    c.width = c.height = 1;
    return { c, x: c.getContext('2d') };
  };
  let front = makeLayer(); // the current frame, already north-up
  let back = makeLayer(); //  the previous frame, for cross-fades
  let haveFront = false;
  let haveBack = false;
  let frame = null; //  { kind: 'scalar' | 'rgb', image, mask, vmin, vmax, colormap, diverging, path }
  let fade = null; //   { t0, dur }
  let lastFrameAt = -Infinity;
  let flashAt = -Infinity;
  const overlays = { gaia: [], flags: null, markers: [], trail: [] };
  let caption = null;
  let pointerAt = null; // { u, v } of a hovering mouse / pen
  let hoverInfo = null;
  let hoverGaia = -1;
  let geom = { w: 0, h: 0, ox: 0, oy: 0, size: 0 };
  let dpr = 1;
  let raf = 0;
  const listeners = new Map();
  const scalarCache = new WeakMap(); // image array -> rendered ImageData + parameters
  const rgbCache = new WeakMap();
  const rangeCache = new WeakMap();
  const flagsCache = new WeakMap();
  const barCache = new Map(); //        colormap name -> 1 x 256 canvas
  const motion = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = () => !!(motion && motion.matches);

  // ---- helpers --------------------------------------------------------------------------------
  const transform = (g = geom) => ({ n: n || 1, size: g.size, ox: g.ox, oy: g.oy, zoom: view.zoom, cx: view.cx, cy: view.cy });
  const zoomLimit = () => (isNum(opts.maxZoom) && opts.maxZoom >= 1 ? opts.maxZoom : maxZoomFor(n || 1));
  const skyAt = (x, y) => (grid ? gridPixToSky(grid, x, y) : [null, null]);
  const inViewport = (u, v) => u >= geom.ox && v >= geom.oy && u <= geom.ox + geom.size && v <= geom.oy + geom.size;

  function emit(type, payload) {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        if (win.console) win.console.error(`[tombaugh viewer] ${type} handler failed`, err);
      }
    }
  }

  function invalidate() {
    if (destroyed || raf) return;
    raf = win.requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  function setRasterSize(m) {
    if (m === n) return;
    n = m;
    for (const l of [front, back]) l.c.width = l.c.height = Math.max(1, n);
    haveFront = haveBack = false;
    frame = null;
    fade = null;
    if (grid) grid = { ...grid, n };
    applyView(defaultView(n || 1), true);
  }

  // Make sure the raster matches an incoming array of `len` elements; false when it cannot.
  function fitRaster(len) {
    if (n > 0 && len === n * n) return true;
    const m = Math.round(Math.sqrt(len));
    if (m > 0 && m * m === len) {
      setRasterSize(m);
      return true;
    }
    return false;
  }

  function runsToPath(runs) {
    if (!runs.length || typeof win.Path2D !== 'function') return null;
    const p = new win.Path2D();
    for (let i = 0; i < runs.length; i += 3) p.rect(runs[i], runs[i + 1], runs[i + 2], 1);
    return p;
  }

  function flagsPath() {
    const f = overlays.flags;
    if (!f || !n || f.length < n * n) return null;
    const fp = fingerprint(f);
    let e = flagsCache.get(f);
    if (!e || e.n !== n || e.fp !== fp) {
      e = { n, fp, path: runsToPath(maskRuns(f, n, true)) };
      flagsCache.set(f, e);
    }
    return e.path;
  }

  function colorbarCanvas(name) {
    let c = barCache.get(name);
    if (!c) {
      c = doc.createElement('canvas');
      c.width = 1;
      c.height = 256;
      const lut = colormapLut(name, 256);
      const id = c.getContext('2d').createImageData(1, 256);
      for (let i = 0; i < 256; i++) {
        const j = (255 - i) * 3; // top of the bar = high values
        id.data[i * 4] = lut[j];
        id.data[i * 4 + 1] = lut[j + 1];
        id.data[i * 4 + 2] = lut[j + 2];
        id.data[i * 4 + 3] = 255;
      }
      c.getContext('2d').putImageData(id, 0, 0);
      barCache.set(name, c);
    }
    return c;
  }

  // ---- frames ---------------------------------------------------------------------------------
  function resolveRange(image, mask, range, diverging) {
    if (range && isNum(Number(range[0])) && isNum(Number(range[1])) && Number(range[0]) !== Number(range[1])) {
      return displayRange(range, diverging);
    }
    let e = rangeCache.get(image);
    const fp = fingerprint(image) + fingerprint(mask);
    if (!e || e.mask !== mask || e.diverging !== diverging || e.fp !== fp) {
      e = { mask, diverging, fp, range: autoRange(image, mask, { diverging }) };
      rangeCache.set(image, e);
    }
    return displayRange(e.range, diverging);
  }

  function renderScalarFrame(spec) {
    const image = spec.image;
    const mask = spec.mask && spec.mask.length >= n * n ? spec.mask : null;
    const named = typeof spec.colormap === 'string' && COLORMAPS[spec.colormap] ? spec.colormap : null;
    const diverging = spec.diverging !== undefined && spec.diverging !== null ? !!spec.diverging : named === 'diverging';
    const colormap = named || (diverging ? 'diverging' : COLORMAPS[opts.colormap] ? opts.colormap : 'gray');
    const stretch = spec.stretch || opts.stretch || 'linear';
    const [vmin, vmax] = resolveRange(image, mask, spec.range, diverging);
    const fp = fingerprint(image) + fingerprint(mask);
    let e = spec.cache === false ? null : scalarCache.get(image);
    if (
      !e || e.n !== n || e.mask !== mask || e.vmin !== vmin || e.vmax !== vmax || e.fp !== fp ||
      e.stretch !== stretch || e.colormap !== colormap || e.diverging !== diverging
    ) {
      const data = e && e.n === n ? e.data : front.x.createImageData(n, n);
      const missing = new Uint8Array(n * n);
      renderScalar({ image, mask, n, range: [vmin, vmax], stretch, colormap, diverging, out: data.data, missing });
      e = {
        kind: 'scalar', n, image, mask, vmin, vmax, stretch, colormap, diverging, data, fp,
        light: isLightMap(colormap),
        path: runsToPath(maskRuns(missing, n, false)),
      };
      if (spec.cache !== false) scalarCache.set(image, e);
    }
    return e;
  }

  function renderRgbFrame(src) {
    const fp = fingerprint(src);
    let e = rgbCache.get(src);
    if (!e || e.n !== n || e.fp !== fp) {
      const data = front.x.createImageData(n, n);
      const out = data.data;
      const missing = new Uint8Array(n * n);
      for (let y = 0; y < n; y++) {
        const s = y * n * 4;
        const d = (n - 1 - y) * n; // row 0 of the array is south: write it at the bottom
        for (let x = 0; x < n; x++) {
          const i = s + x * 4;
          const o = (d + x) * 4;
          if (src[i + 3] === 0) {
            out[o] = MASK_RGB[0];
            out[o + 1] = MASK_RGB[1];
            out[o + 2] = MASK_RGB[2];
            missing[d + x] = 1;
          } else {
            out[o] = src[i];
            out[o + 1] = src[i + 1];
            out[o + 2] = src[i + 2];
          }
          out[o + 3] = 255;
        }
      }
      e = { kind: 'rgb', n, image: null, mask: null, data, fp, path: runsToPath(maskRuns(missing, n, false)) };
      rgbCache.set(src, e);
    }
    return e;
  }

  function present(entry, transition) {
    const t = now();
    const mode = transition === 'cut' || transition === 'fade' ? transition : opts.transition;
    const canFade =
      mode === 'fade' && haveFront && opts.fadeMs > 0 && !reducedMotion() && !doc.hidden &&
      t - lastFrameAt > opts.fadeMs * 1.5;
    if (canFade) {
      [front, back] = [back, front];
      haveBack = true;
      fade = { t0: t, dur: opts.fadeMs };
    } else {
      fade = null;
    }
    front.x.putImageData(entry.data, 0, 0);
    haveFront = true;
    lastFrameAt = t;
    frame = entry;
    if (pointerAt) updateHover(true);
    invalidate();
  }

  // ---- public: data ---------------------------------------------------------------------------
  function setGrid(g) {
    if (!g || !(g.n > 0) || !isNum(g.ra0) || !isNum(g.dec0) || !(g.scale > 0)) return;
    const m = Math.round(g.n);
    const moved = !grid || grid.ra0 !== g.ra0 || grid.dec0 !== g.dec0 || grid.scale !== g.scale;
    grid = { ra0: g.ra0, dec0: g.dec0, n: m, scale: g.scale };
    if (m !== n) setRasterSize(m);
    else if (moved) applyView(defaultView(n), true);
    invalidate();
  }

  function setImage(spec) {
    if (!spec || !spec.image || !spec.image.length) return;
    if (!fitRaster(spec.image.length)) return;
    present(renderScalarFrame(spec), spec.transition);
  }

  function setRgb(data, o = {}) {
    if (!data || !data.length || data.length % 4 !== 0) return;
    if (!fitRaster(data.length / 4)) return;
    present(renderRgbFrame(data), o && o.transition);
  }

  function setOverlays(o) {
    if (o === null || o === undefined) {
      overlays.gaia = [];
      overlays.flags = null;
      overlays.markers = [];
      overlays.trail = [];
    } else if (typeof o === 'object') {
      if ('gaia' in o) overlays.gaia = Array.isArray(o.gaia) ? o.gaia : [];
      if ('flags' in o) overlays.flags = o.flags && o.flags.length ? o.flags : null;
      if ('markers' in o) overlays.markers = Array.isArray(o.markers) ? o.markers : [];
      if ('trail' in o) overlays.trail = Array.isArray(o.trail) ? o.trail : [];
    }
    hoverGaia = -1;
    if (pointerAt) updateHover(false);
    invalidate();
  }

  function captionParts() {
    if (!caption) return { title: '', date: '', wave: '', note: '' };
    const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
    const date = typeof caption.date === 'number' ? mjdToIso(caption.date, true) : text(caption.date);
    const wave = typeof caption.wave === 'number' ? (isNum(caption.wave) ? `${caption.wave.toFixed(3)} \u00b5m` : '') : text(caption.wave);
    return { title: text(caption.title), date, wave, note: text(caption.note) };
  }

  function setCaption(c) {
    caption = c && typeof c === 'object' ? { ...c } : null;
    const p = captionParts();
    const said = [p.title, [p.date, p.wave].filter(Boolean).join(', '), p.note].filter(Boolean).join('. ');
    canvas.setAttribute('aria-label', `Sky image${said ? `: ${said}` : ''}. North is up, east is left.`);
    invalidate();
  }

  // ---- view -----------------------------------------------------------------------------------
  function syncToolbar() {
    // small viewers keep only the zoom buttons; tiny ones drop the toolbar
    toolbar.hidden = !opts.toolbar || (geom.size > 0 && geom.size < 200);
    const compact = geom.size > 0 && geom.size < 300;
    for (const el of [sep, buttons.smooth, buttons.crosshair, buttons.loupe]) el.hidden = compact;
    const zoomed = view.zoom > 1.0001;
    buttons.zoomOut.disabled = !opts.interactive || !zoomed;
    buttons.reset.disabled = !opts.interactive || !zoomed;
    buttons.zoomIn.disabled = !opts.interactive || view.zoom >= zoomLimit() - 1e-9;
    buttons.smooth.setAttribute('aria-pressed', String(!!opts.smooth));
    buttons.crosshair.setAttribute('aria-pressed', String(!!opts.crosshair));
    buttons.loupe.setAttribute('aria-pressed', String(!!opts.loupe));
    toolbar.style.top = `${geom.oy + 8}px`;
    toolbar.style.right = `${Math.max(0, geom.w - geom.ox - geom.size) + 8}px`;
    canvas.classList.toggle('tbv-zoomed', zoomed);
    root.classList.toggle('tbv-fill', !!opts.fill);
  }

  function applyView(next, silent) {
    const v = clampView(n || 1, next, zoomLimit());
    const changed = v.zoom !== view.zoom || v.cx !== view.cx || v.cy !== view.cy;
    view = v;
    syncToolbar();
    if (!changed) return false;
    if (pointerAt) updateHover(false);
    if (!silent) {
      const [ra, dec] = skyAt(view.cx, view.cy);
      emit('view', { zoom: view.zoom, cx: view.cx, cy: view.cy, ra, dec });
    }
    invalidate();
    return true;
  }

  function resetView() {
    applyView(defaultView(n || 1));
  }

  function zoomBy(factor, u, v) {
    if (!n || !geom.size) return;
    const cu = isNum(u) ? u : geom.ox + geom.size / 2;
    const cv = isNum(v) ? v : geom.oy + geom.size / 2;
    applyView(zoomAbout(transform(), cu, cv, factor, zoomLimit()));
  }

  function setView(v = {}) {
    let { cx, cy } = view;
    if (grid && isNum(v.ra) && isNum(v.dec)) {
      const p = gridSkyToPix(grid, v.ra, v.dec);
      if (isNum(p[0]) && isNum(p[1])) [cx, cy] = p;
    }
    if (isNum(v.x)) cx = v.x;
    if (isNum(v.y)) cy = v.y;
    if (isNum(v.cx)) cx = v.cx;
    if (isNum(v.cy)) cy = v.cy;
    applyView({ zoom: isNum(v.zoom) ? v.zoom : view.zoom, cx, cy }, v.silent === true);
  }

  function getView() {
    const [ra, dec] = skyAt(view.cx, view.cy);
    return { zoom: view.zoom, cx: view.cx, cy: view.cy, ra, dec };
  }

  // ---- hover ----------------------------------------------------------------------------------
  function probe(u, v) {
    if (!n || !geom.size || !inViewport(u, v)) return null;
    const [x, y] = canvasToGrid(transform(), u, v);
    const idx = nearestPixel(n, x, y);
    if (idx < 0) return null;
    const [ra, dec] = skyAt(x, y);
    let value = null;
    let masked = false;
    if (frame && frame.kind === 'scalar') {
      const raw = frame.image[idx];
      masked = !!(frame.mask && frame.mask[idx]) || !Number.isFinite(raw);
      value = masked ? null : raw;
    }
    return { ra, dec, value, x, y, ix: idx % n, iy: Math.floor(idx / n), masked };
  }

  function environment(t, rect) {
    const k = pixelScale(t);
    return {
      k,
      rect,
      arcsecPerPx: grid && k > 0 ? grid.scale / k : 0,
      project: grid
        ? (ra, dec) => {
            const p = gridSkyToPix(grid, ra, dec);
            return isNum(p[0]) && isNum(p[1]) ? gridToCanvas(t, p[0], p[1]) : null;
          }
        : () => null,
    };
  }

  function updateHover(force) {
    if (!pointerAt) return;
    const info = probe(pointerAt.u, pointerAt.v);
    const was = hoverInfo;
    hoverInfo = info;
    const env = environment(transform(), { x: geom.ox, y: geom.oy, size: geom.size });
    const g = info ? hitGaia(env, overlays.gaia, pointerAt.u, pointerAt.v) : -1;
    const gaiaChanged = g !== hoverGaia;
    hoverGaia = g;
    if (info) {
      if (force || !was || was.x !== info.x || was.y !== info.y || was.value !== info.value) emit('hover', info);
    } else if (was) {
      emit('leave', {});
    }
    if (gaiaChanged || opts.loupe || opts.readout || (!info && was)) invalidate();
  }

  function clearHover() {
    const was = hoverInfo;
    pointerAt = null;
    hoverInfo = null;
    const hadRing = hoverGaia >= 0;
    hoverGaia = -1;
    if (was) emit('leave', {});
    if (was || hadRing) invalidate();
  }

  // ---- drawing --------------------------------------------------------------------------------
  function syncSize() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    let ratio = win.devicePixelRatio || 1;
    const longest = Math.max(w, h, 1);
    if (longest * ratio > 4096) ratio = 4096 / longest;
    const bw = Math.max(1, Math.round(w * ratio));
    const bh = Math.max(1, Math.round(h * ratio));
    const resized = canvas.width !== bw || canvas.height !== bh;
    if (resized) {
      canvas.width = bw;
      canvas.height = bh;
    }
    if (resized || w !== geom.w || h !== geom.h || ratio !== dpr) {
      dpr = ratio;
      geom = { w, h, ...letterbox(w, h) };
      syncToolbar();
      return true;
    }
    return false;
  }

  function readoutText() {
    if (!hoverInfo) return '';
    const h = hoverInfo;
    const where = isNum(h.ra) ? formatDeg(h.ra, h.dec) : `x ${h.x.toFixed(1)}  y ${h.y.toFixed(1)}`;
    const what = frame && frame.kind === 'scalar' ? (h.masked ? 'no data' : `${formatValue(h.value)}${opts.unit ? ` ${opts.unit}` : ''}`) : '';
    return what ? `${where}   ${what}` : where;
  }

  // Draws everything into `c` (already scaled so one unit is one CSS pixel). `live` adds the
  // transient parts: cross-fade, hover label, loupe, readout, flash. Returns true while animating.
  function renderScene(c, g, time, live) {
    let animating = false;
    c.fillStyle = BRAND.ink;
    c.fillRect(0, 0, g.w, g.h);
    if (!(g.size > 0)) return false;
    const rect = { x: g.ox, y: g.oy, size: g.size };
    const t = transform(g);
    const k = pixelScale(t);
    const img = imageRect(t);
    const env = environment(t, rect);

    if (haveFront && n > 0) {
      let a = 1;
      if (fade) {
        const p = live ? (time - fade.t0) / fade.dur : 1;
        if (p >= 1) fade = null;
        else {
          a = easeOut(Math.max(0, p));
          animating = true;
        }
      }
      c.save();
      c.beginPath();
      c.rect(rect.x, rect.y, rect.size, rect.size);
      c.clip();
      c.imageSmoothingEnabled = !!opts.smooth;
      if (opts.smooth) c.imageSmoothingQuality = 'high';
      if (a < 1 && haveBack) c.drawImage(back.c, img.x, img.y, img.w, img.h);
      c.globalAlpha = a;
      c.drawImage(front.c, img.x, img.y, img.w, img.h);
      c.restore();
      if (frame && frame.path) {
        // missing data: a quiet hatch over a flat colour, dark on dark maps and dark on light ones
        const style = frame.light
          ? { color: BRAND.ink, alpha: 0.5 * a, spacing: 6, dir: 1 }
          : { color: BRAND.stone, alpha: 0.42 * a, spacing: 6, dir: 1 };
        drawRegionHatch(c, rect, img, k, frame.path, style);
      }
      if (opts.pixelGrid) drawPixelGrid(c, rect, img, k, n);
    } else if (opts.emptyText !== null) {
      drawEmpty(c, rect, opts.emptyText);
    }

    // sky-anchored overlays
    c.save();
    c.beginPath();
    c.rect(rect.x, rect.y, rect.size, rect.size);
    c.clip();
    const fp = flagsPath();
    if (fp) drawRegionHatch(c, rect, img, k, fp, { color: BRAND.signal, alpha: 0.85, tint: 0.16, spacing: 5, dir: -1 });
    env.placed = markerObstacles(env, overlays.markers);
    drawTrail(c, env, overlays.trail);
    drawGaia(c, env, overlays.gaia, live ? hoverGaia : -1);
    drawMarkers(c, env, overlays.markers);
    if (opts.crosshair && n > 0) {
      const [u, v] = gridToCanvas(t, (n - 1) / 2, (n - 1) / 2);
      drawCrosshair(c, u, v);
    }
    c.restore();

    // furniture
    if (n > 0 && haveFront) {
      if (opts.compass) drawCompass(c, rect);
      let barWidth = 0;
      if (opts.scaleBar && env.arcsecPerPx > 0) {
        const bar = pickScaleBar(env.arcsecPerPx, Math.min(170, Math.max(44, rect.size * 0.24)));
        barWidth = drawScaleBar(c, rect, bar);
      }
      if (opts.colorbar && frame && frame.kind === 'scalar') {
        drawColorbar(c, rect, { lut: colorbarCanvas(frame.colormap), vmin: frame.vmin, vmax: frame.vmax, diverging: frame.diverging });
      }
      const p = captionParts();
      const lines = opts.caption
        ? [
            { text: p.title, bold: true, size: 12 },
            { parts: [p.date, p.wave], color: rgba(BRAND.paper, 0.92) },
            { text: p.note, color: rgba(BRAND.paper, 0.66) },
          ]
        : [];
      drawCaption(c, rect, lines, {
        maxWidth: rect.size - 20 - (barWidth ? barWidth + 28 : 0),
        readout: live && opts.readout ? readoutText() : '',
        plain: !!opts.plainCaption,
      });
    }

    // a hairline frame so the image edge reads as an instrument window
    c.lineWidth = 1;
    c.strokeStyle = rgba(BRAND.paper, 0.14);
    c.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.size - 1, rect.size - 1);

    if (live) {
      if (opts.loupe && hoverInfo && pointerAt && haveFront) {
        const h = hoverInfo;
        const text = frame && frame.kind === 'scalar' ? (h.masked ? 'no data' : `${formatValue(h.value)}${opts.unit ? ` ${opts.unit}` : ''}`) : '';
        drawLoupe(c, rect, { source: front.c, n, col: h.ix, row: n - 1 - h.iy, u: pointerAt.u, v: pointerAt.v, text });
      }
      const p = (time - flashAt) / FLASH_MS;
      if (p >= 0 && p < 1) {
        if (reducedMotion()) drawFlash(c, rect, p < 0.4 ? 0.6 : 0);
        else drawFlash(c, rect, 0.9 * (1 - p) * (1 - p));
        animating = true;
      }
    }
    return animating;
  }

  function draw() {
    if (destroyed) return;
    syncSize();
    if (!geom.w || !geom.h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (renderScene(ctx, geom, now(), true)) invalidate();
  }

  function toCanvas(o = {}) {
    const scale = isNum(o.scale) && o.scale > 0 ? o.scale : 2;
    const size = geom.size > 0 ? geom.size : 512;
    const out = doc.createElement('canvas');
    out.width = out.height = Math.round(size * scale);
    const c = out.getContext('2d');
    c.setTransform(out.width / size, 0, 0, out.height / size, 0, 0);
    const keepFade = fade;
    renderScene(c, { w: size, h: size, ox: 0, oy: 0, size }, now(), false);
    fade = keepFade;
    return out;
  }

  function toDataURL(o = {}) {
    try {
      return toCanvas(o).toDataURL(o.type || 'image/png', o.quality);
    } catch (err) {
      return '';
    }
  }

  function flash() {
    flashAt = now();
    invalidate();
  }

  // ---- options --------------------------------------------------------------------------------
  function setOptions(patch) {
    if (!patch || typeof patch !== 'object') return;
    opts = { ...opts, ...patch };
    applyView(view, true); // re-clamp in case maxZoom changed
    syncToolbar();
    if (syncSize()) draw();
    else invalidate();
  }

  function toggle(name) {
    setOptions({ [name]: !opts[name] });
    emit('option', { name, value: opts[name] });
  }

  // ---- input ----------------------------------------------------------------------------------
  const ac = new AbortController();
  const listen = (target, type, fn, extra) => target.addEventListener(type, fn, { signal: ac.signal, ...(extra || {}) });
  const pointers = new Map(); // pointerId -> { u, v }
  let gesture = null; //         { moved, multi, dist, mu, mv }
  let lastTap = null; //         { t, u, v }

  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return { u: e.clientX - r.left, v: e.clientY - r.top };
  };

  function pinchState() {
    const [a, b] = Array.from(pointers.values());
    return { dist: Math.hypot(a.u - b.u, a.v - b.v), mu: (a.u + b.u) / 2, mv: (a.v + b.v) / 2 };
  }

  listen(canvas, 'pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = at(e);
    if (pointers.size === 0 && !inViewport(p.u, p.v)) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* synthetic events have no active pointer */
    }
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      gesture = { moved: false, multi: false, startU: p.u, startV: p.v, dist: 0, mu: 0, mv: 0 };
    } else if (gesture && pointers.size === 2) {
      gesture.multi = true;
      Object.assign(gesture, pinchState());
    }
  });

  listen(canvas, 'pointermove', (e) => {
    const p = at(e);
    const held = pointers.get(e.pointerId);
    if (!held || !gesture) {
      if (e.pointerType === 'touch') return;
      pointerAt = p;
      updateHover(false);
      return;
    }
    const du = p.u - held.u;
    const dv = p.v - held.v;
    held.u = p.u;
    held.v = p.v;
    if (!opts.interactive) {
      if (Math.hypot(p.u - gesture.startU, p.v - gesture.startV) > TAP_SLOP) gesture.moved = true;
      return;
    }
    if (pointers.size >= 2) {
      const s = pinchState();
      let next = transform();
      // scale about where the fingers were, then carry that point to where they are now
      if (gesture.dist > 0 && s.dist > 0) {
        next = { ...next, ...zoomAbout(next, gesture.mu, gesture.mv, s.dist / gesture.dist, zoomLimit()) };
      }
      applyView(panBy(next, s.mu - gesture.mu, s.mv - gesture.mv, zoomLimit()));
      Object.assign(gesture, s);
      gesture.moved = true;
      return;
    }
    if (!gesture.moved && Math.hypot(p.u - gesture.startU, p.v - gesture.startV) > TAP_SLOP) {
      gesture.moved = true;
      if (view.zoom > 1) canvas.classList.add('tbv-dragging');
      if (hoverInfo) clearHover();
    }
    if (gesture.moved) applyView(panBy(transform(), du, dv, zoomLimit()));
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* already released */
    }
    if (!gesture) return;
    if (pointers.size >= 2) {
      Object.assign(gesture, pinchState());
      return;
    }
    if (pointers.size === 1) return; // one finger left after a pinch: keep panning with it
    const g = gesture;
    gesture = null;
    canvas.classList.remove('tbv-dragging');
    const p = at(e);
    if (e.type === 'pointerup' && !g.moved && !g.multi) tap(p, e);
    if (e.pointerType !== 'touch' && e.type === 'pointerup') {
      pointerAt = p;
      updateHover(false);
    }
  }
  listen(canvas, 'pointerup', endPointer);
  listen(canvas, 'pointercancel', endPointer);
  listen(canvas, 'pointerleave', (e) => {
    if (!pointers.has(e.pointerId)) clearHover();
  });

  function tap(p, e) {
    const info = probe(p.u, p.v);
    if (!info) return;
    const t = now();
    const second = lastTap && t - lastTap.t < DOUBLE_MS && Math.hypot(p.u - lastTap.u, p.v - lastTap.v) < DOUBLE_SLOP;
    if (second && opts.interactive && view.zoom > 1.0001) {
      lastTap = null;
      resetView();
      return;
    }
    lastTap = { t, u: p.u, v: p.v };
    const env = environment(transform(), { x: geom.ox, y: geom.oy, size: geom.size });
    const gi = hitGaia(env, overlays.gaia, p.u, p.v);
    emit('click', {
      ra: info.ra,
      dec: info.dec,
      x: info.x,
      y: info.y,
      value: info.value,
      ix: info.ix,
      iy: info.iy,
      target: gi >= 0 ? { kind: 'gaia', index: gi, item: overlays.gaia[gi] } : null,
      pointerType: e.pointerType || 'mouse',
    });
  }

  listen(
    canvas,
    'wheel',
    (e) => {
      if (!opts.interactive || !opts.wheelZoom || !n) return;
      if (opts.wheelZoom === 'ctrl' && !(e.ctrlKey || e.metaKey)) return;
      let p = at(e);
      if (!inViewport(p.u, p.v)) return;
      // wheel events carry integer coordinates; prefer the exact pointer position when it agrees
      if (pointerAt && Math.abs(pointerAt.u - p.u) < 1.5 && Math.abs(pointerAt.v - p.v) < 1.5) p = pointerAt;
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= 400;
      if (!dy) return;
      if (dy > 0 && view.zoom <= 1) return; // fully zoomed out: let the page scroll on
      e.preventDefault();
      pointerAt = p;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018));
      applyView(zoomAbout(transform(), p.u, p.v, factor, zoomLimit()));
    },
    { passive: false },
  );

  listen(canvas, 'keydown', (e) => {
    if (!opts.keyboard || !opts.interactive || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = geom.size * 0.12;
    let handled = true;
    switch (e.key) {
      case '+':
      case '=':
        zoomBy(1.5);
        break;
      case '-':
      case '_':
        zoomBy(1 / 1.5);
        break;
      case '0':
        resetView();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!(view.zoom > 1.0001)) {
          handled = false;
          break;
        }
        const du = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;
        const dv = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
        applyView(panBy(transform(), du, dv, zoomLimit()));
        break;
      }
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  listen(canvas, 'contextmenu', () => {
    pointers.clear();
    gesture = null;
  });

  listen(buttons.zoomIn, 'click', () => zoomBy(1.6));
  listen(buttons.zoomOut, 'click', () => zoomBy(1 / 1.6));
  listen(buttons.reset, 'click', () => resetView());
  listen(buttons.smooth, 'click', () => toggle('smooth'));
  listen(buttons.crosshair, 'click', () => toggle('crosshair'));
  listen(buttons.loupe, 'click', () => toggle('loupe'));

  // ---- lifecycle ------------------------------------------------------------------------------
  const onResize = () => {
    if (destroyed) return;
    if (syncSize()) draw(); // redraw at once: resizing a canvas clears it
  };
  let observer = null;
  if (typeof win.ResizeObserver === 'function') {
    observer = new win.ResizeObserver(onResize);
    observer.observe(root);
  }
  listen(win, 'resize', onResize);
  if (motion && motion.addEventListener) listen(motion, 'change', invalidate);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    ac.abort();
    if (observer) observer.disconnect();
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
    listeners.clear();
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  function on(type, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => off(type, fn);
  }

  function off(type, fn) {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  }

  syncToolbar();
  syncSize();
  invalidate();

  return {
    setGrid,
    setImage,
    setRgb,
    setOverlays,
    setCaption,
    on,
    off,
    toDataURL,
    toCanvas,
    destroy,
    setOptions,
    getOptions: () => ({ ...opts }),
    setView,
    getView,
    resetView,
    zoomBy: (factor) => zoomBy(factor),
    flash,
    resize: onResize,
    element: root,
    canvas,
  };
}
