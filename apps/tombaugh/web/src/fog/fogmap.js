// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Fog of war: an all-sky map of which patches anyone using this tool has opened. Dark where
// nobody has looked, lit where somebody has. Mollweide projection, equatorial J2000, north up,
// RA increasing to the left. One cell = one HEALPix NESTED pixel at nside 32 (about 1.8 deg).
//
// Contract API:
//   createFogMap(container, { onPick }) -> { setCounts(Uint16Array), setHere(ra, dec), destroy() }
//   onPick({ ra, dec, cell, count }) is called with the CELL CENTRE (degrees) and the cell's
//   current count when the user clicks a cell, presses Enter on the keyboard cursor, or uses the
//   "Take me somewhere nobody has looked" button. The map does not mark anything itself: the
//   caller records the visit (api.fogMark) and passes fresh counts to setCounts.
//
// Optional extras:
//   options.ra0      centre right ascension of the map in degrees (default 180)
//   options.targets  [{ name, short, ra, dec }] to bracket on the map (default: FOG_TARGETS)
//   options.random   () => [0, 1) used by the random pick (default Math.random)
//   setCounts also accepts the raw 24,576-byte little-endian body of GET /fog (ArrayBuffer or
//     Uint8Array). The first call just shows the map; later calls pulse every cell whose count rose.
//   setHere(null) removes the position marker.
//   markLocal(ra, dec) -> { cell, count }   optimistic local increment (with the pulse)
//   pickUnopened() -> { ra, dec, cell, count } | null   what the button does, including onPick
//   getCounts() -> Uint16Array copy;  cellAt(x, y) -> cell | -1 (CSS px inside the canvas)
//   project(ra, dec) -> { x, y } CSS px inside the canvas;  element -> the root <section>
//   fogGeometry(ra0) (module export): the projected cell outlines, for tests and tools
//   chooseUnopenedCell(counts, { random }) (module export, no DOM): the rule behind the button,
//     -> { cell, ra, dec, count, why } | null. The shell uses it for "Somewhere nobody has looked"
//     on the start page, where no map is mounted.
//
// Rendering: cell outlines are projected once per centre RA in map units and reused at every size.
// The fog, the lit cells and the line work are kept on offscreen canvases; they are repainted only
// when the size or the counts change, and a frame is drawn only when something changed (or while
// a pulse is running). Honours prefers-reduced-motion: no pulse animation, fresh cells get a
// static outline for a few seconds instead.

import {
  ang2pixNest, pix2angNest, cellCorners, neighboursNest,
} from './healpix.js';
import {
  mollweideXY, mollweideInverse, screenLongitude, eqToGal, eclToEq, galToEq, wrap180, wrap360,
} from './projection.js';
import {
  eclipticLine, galacticLine, meridianLine, parallelLine, BRIGHT_STARS, FOG_TARGETS,
} from './skylines.js';
import { injectFogStyles } from './fogmap.css.js';

export const FOG_NSIDE = 32;
export const FOG_NPIX = 12 * FOG_NSIDE * FOG_NSIDE; // 12288

const STEPS = 3; // boundary points per cell edge
const K = 4 * STEPS; // points per cell outline
const PLANE_AVOID_DEG = 5; // the random pick stays this far from the galactic plane
const PULSE_MS = 1700;
const PAPER = '247, 242, 231';
const SIGNAL = '229, 60, 39';
const STONE = '119, 118, 110';
const DEEP = '#0c0c0b'; // the unopened sky: a shade darker than Ink
const MONO = 'Consolas, "SF Mono", Menlo, "DejaVu Sans Mono", monospace';
const SANS = 'Arial, Helvetica, sans-serif';
const LIT_LEVELS = 10;
const D2R = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// Geometry in map units (x in [-2, 2], y in [-1, 1]); built once per centre RA and shared.

const geometryCache = new Map();

// Project a closed outline given in (ra, dec), laid out continuously around `centreRa` so it does
// not tear at the limb. Returns one polygon, or two when the outline straddles the limb (one copy
// clamped to each edge of the map).
function projectOutline(points, centreRa, ra0) {
  const lamC = screenLongitude(centreRa, ra0);
  const n = points.length;
  const lam = new Float64Array(n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lam[i] = lamC - wrap180(points[i][0] - centreRa);
    if (lam[i] < lo) lo = lam[i];
    if (lam[i] > hi) hi = lam[i];
  }
  const build = (shift) => {
    const out = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      const l = Math.max(-180, Math.min(180, lam[i] + shift));
      const xy = mollweideXY(l, points[i][1]);
      out[2 * i] = xy[0];
      out[2 * i + 1] = xy[1];
    }
    return out;
  };
  if (hi > 180 + 1e-6) return [build(0), build(-360)];
  if (lo < -180 - 1e-6) return [build(0), build(360)];
  return [build(0)];
}

// Split a polyline in (ra, dec) into map-unit segments, cutting it where it crosses the limb.
function projectLine(points, ra0) {
  const segs = [];
  let cur = [];
  let prevLam = 0;
  let prevDec = 0;
  for (const [ra, dec] of points) {
    const lam = screenLongitude(ra, ra0);
    if (cur.length && Math.abs(lam - prevLam) > 180) {
      const unwrapped = lam + (lam < prevLam ? 360 : -360);
      const edge = unwrapped > prevLam ? 180 : -180;
      const f = (edge - prevLam) / (unwrapped - prevLam);
      const decEdge = prevDec + f * (dec - prevDec);
      cur.push(mollweideXY(edge, decEdge));
      if (cur.length > 1) segs.push(cur);
      cur = [mollweideXY(-edge, decEdge)];
    }
    cur.push(mollweideXY(lam, dec));
    prevLam = lam;
    prevDec = dec;
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

// Smooth pseudo-noise on the sphere (seamless across RA 0), for the texture of the fog.
const NOISE_WAVES = [
  [3.1, 1.7, -2.3, 0.4, 1], [-2.2, 4.1, 1.9, 1.3, 0.8], [5.3, -3.7, 4.4, 2.1, 0.6],
  [-6.1, -5.2, 3.3, 0.7, 0.45], [7.7, 6.4, -8.2, 4.2, 0.3], [-11.3, 9.1, 10.2, 5.5, 0.22],
];
function fogNoise(ra, dec) {
  const c = Math.cos(dec * D2R);
  const x = c * Math.cos(ra * D2R);
  const y = c * Math.sin(ra * D2R);
  const z = Math.sin(dec * D2R);
  let sum = 0;
  let amp = 0;
  for (const [a, b, d, phase, w] of NOISE_WAVES) {
    sum += w * Math.sin(a * x + b * y + d * z + phase);
    amp += w;
  }
  return 0.5 + (0.5 * sum) / amp;
}

function hash01(i) {
  let t = (i + 0x9e3779b9) | 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/**
 * Projected geometry for a map centred on `ra0`, in map units. Exposed for tests and tools:
 * { poly: Float32Array (12 points per cell), extra: Map<cell, Float32Array> (second copy of
 * cells that straddle the limb), centre, cxy, absB, ... }.
 */
export function fogGeometry(ra0 = 180) {
  return buildGeometry(wrap360(ra0));
}

function buildGeometry(ra0) {
  const cached = geometryCache.get(ra0);
  if (cached) return cached;
  const poly = new Float32Array(FOG_NPIX * K * 2);
  const extra = new Map(); // cell -> second outline for cells that straddle the limb
  const centre = new Float64Array(FOG_NPIX * 2);
  const cxy = new Float32Array(FOG_NPIX * 2);
  const absB = new Float32Array(FOG_NPIX);
  const fog = new Uint8Array(FOG_NPIX); // texture bucket 0..3
  for (let cell = 0; cell < FOG_NPIX; cell++) {
    const [ra, dec] = pix2angNest(FOG_NSIDE, cell);
    centre[2 * cell] = ra;
    centre[2 * cell + 1] = dec;
    const c = mollweideXY(screenLongitude(ra, ra0), dec);
    cxy[2 * cell] = c[0];
    cxy[2 * cell + 1] = c[1];
    absB[cell] = Math.abs(eqToGal(ra, dec)[1]);
    const parts = projectOutline(cellCorners(FOG_NSIDE, cell, STEPS), ra, ra0);
    poly.set(parts[0], cell * K * 2);
    if (parts[1]) extra.set(cell, parts[1]);
    const n = fogNoise(ra, dec) + 0.22 * (hash01(cell) - 0.5);
    fog[cell] = n < 0.4 ? 0 : n < 0.52 ? 1 : n < 0.64 ? 2 : 3;
  }

  // Soft band along the galactic plane: nested strips, the widest reaching 5 deg from the plane.
  const band = [];
  for (const half of [1, 0.8, 0.6, 0.4, 0.2].map((f) => f * PLANE_AVOID_DEG)) {
    const quads = [];
    const lo = galacticLine(-half, 2);
    const hi = galacticLine(half, 2);
    const mid = galacticLine(0, 2);
    for (let i = 0; i + 1 < lo.length; i++) {
      quads.push(...projectOutline([lo[i], lo[i + 1], hi[i + 1], hi[i]], mid[i][0], ra0));
    }
    band.push(quads);
  }

  const meridians = [];
  for (let ra = 0; ra < 360; ra += 30) {
    if (Math.abs(Math.abs(wrap180(ra - ra0)) - 180) < 1e-9) continue; // that one is the limb itself
    meridians.push({ ra, segs: projectLine(meridianLine(ra, 90, 2), ra0) });
  }
  const parallels = [];
  for (let dec = -60; dec <= 60; dec += 30) parallels.push({ dec, segs: projectLine(parallelLine(dec, 3), ra0) });

  const geo = {
    ra0, poly, extra, centre, cxy, absB, fog, band, meridians, parallels,
    ecliptic: projectLine(eclipticLine(1), ra0),
    galactic: projectLine(galacticLine(0, 1), ra0),
  };
  geometryCache.set(ra0, geo);
  return geo;
}

/**
 * Pick a cell nobody has opened: at random among the unopened cells more than 5 degrees from the
 * galactic plane; if there are none, among the unopened cells in the plane; if every cell has been
 * opened, among the least visited. `counts` is a Uint16Array(12288) (or anything indexable of
 * that length). -> { cell, ra, dec, count, why } with the cell centre in degrees, or null when
 * `counts` is unusable. `why` is a sentence for the reader when the pick is not the plain case.
 */
export function chooseUnopenedCell(counts, { random = Math.random, ra0 = 180 } = {}) {
  if (!counts || !(counts.length >= FOG_NPIX)) return null;
  const geo = buildGeometry(wrap360(ra0));
  const clear = [];
  const crowded = [];
  for (let cell = 0; cell < FOG_NPIX; cell++) {
    if (counts[cell]) continue;
    (geo.absB[cell] > PLANE_AVOID_DEG ? clear : crowded).push(cell);
  }
  let pool = clear.length ? clear : crowded;
  let why = clear.length
    ? ''
    : 'Nobody had opened this patch before you. It lies in the crowded galactic plane; every patch outside it has been opened.';
  if (!pool.length) {
    // Every cell has been opened: offer one of the least visited instead.
    let min = Infinity;
    for (let cell = 0; cell < FOG_NPIX; cell++) if (counts[cell] < min) min = counts[cell];
    pool = [];
    for (let cell = 0; cell < FOG_NPIX; cell++) if (counts[cell] === min) pool.push(cell);
    why = 'Every patch has been opened at least once. This is one of the least visited.';
  }
  if (!pool.length) return null;
  const cell = pool[Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))];
  return {
    cell,
    ra: Math.round(geo.centre[2 * cell] * 1e6) / 1e6,
    dec: Math.round(geo.centre[2 * cell + 1] * 1e6) / 1e6,
    count: counts[cell],
    why,
  };
}

// ---------------------------------------------------------------------------------------------
// Formatting.

const pad2 = (n) => String(n).padStart(2, '0');

function formatHms(raDeg) {
  let s = Math.round((wrap360(raDeg) / 15) * 3600) % 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  return `${pad2(h)}h ${pad2(m)}m ${pad2(s - m * 60)}s`;
}

function formatDms(decDeg) {
  let s = Math.round(Math.abs(decDeg) * 3600);
  const d = Math.floor(s / 3600);
  s -= d * 3600;
  const m = Math.floor(s / 60);
  return `${decDeg < 0 ? '−' : '+'}${pad2(d)}° ${pad2(m)}′ ${pad2(s - m * 60)}″`;
}

function formatDeg(ra, dec) {
  return `${wrap360(ra).toFixed(3)}°, ${dec < 0 ? '−' : '+'}${Math.abs(dec).toFixed(3)}°`;
}

const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function describeCount(count, loaded) {
  if (!loaded) return 'visit counts not loaded yet';
  if (count <= 0) return 'nobody has opened this patch yet';
  if (count === 1) return 'opened once';
  if (count >= 65535) return 'opened 65,535 times or more';
  return `opened ${thousands(count)} times`;
}

function percentText(opened) {
  if (opened === 0) return '0.0%';
  const pct = (100 * opened) / FOG_NPIX;
  if (pct < 0.05) return '<0.1%';
  if (opened < FOG_NPIX && pct > 99.9) return '99.9%';
  return `${pct.toFixed(1)}%`;
}

function toCounts(input) {
  const out = new Uint16Array(FOG_NPIX);
  if (!input) return out;
  let bytes = null;
  if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (input instanceof Uint8Array) bytes = input;
  if (bytes) {
    if (bytes.byteLength !== 2 * FOG_NPIX) return out;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < FOG_NPIX; i++) out[i] = view.getUint16(2 * i, true);
    return out;
  }
  const n = Math.min(FOG_NPIX, input.length >>> 0);
  for (let i = 0; i < n; i++) {
    const v = Number(input[i]);
    out[i] = v > 0 ? Math.min(65535, Math.floor(v)) : 0;
  }
  return out;
}

function reducedMotion() {
  try {
    return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) {
    return false;
  }
}

const LEGEND_HTML = `
<li><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1 13 7 7 13 1 7Z" fill="#0c0c0b" stroke="rgba(119,118,110,0.9)"/></svg>not opened yet</li>
<li><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1 13 7 7 13 1 7Z" fill="#F7F2E7"/></svg>opened (brighter = more often)</li>
<li><svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true"><path d="M1 7H21" stroke="rgba(247,242,231,0.75)" stroke-dasharray="5 4"/></svg>ecliptic</li>
<li><svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true"><path d="M1 7H21" stroke="rgba(119,118,110,0.45)" stroke-width="9"/><path d="M2 7H21" stroke="rgba(247,242,231,0.85)" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0.1 4"/></svg>galactic plane</li>
<li><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9" fill="none" stroke="#F7F2E7" stroke-width="1.3"/></svg>challenge target</li>
<li><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="3.6" fill="none" stroke="#E53C27" stroke-width="1.5"/><path d="M7 0v2.4M7 11.6V14M0 7h2.4M11.6 7H14" stroke="#E53C27" stroke-width="1.5"/></svg>where you are</li>`;

let instanceCount = 0;

// ---------------------------------------------------------------------------------------------

/**
 * Mount the fog map in `container`.
 * @param {HTMLElement} container
 * @param {{ onPick?: (pick: { ra: number, dec: number, cell: number, count: number }) => void,
 *           ra0?: number, targets?: Array<{ name: string, short?: string, ra: number, dec: number }>,
 *           random?: () => number }} [options]
 */
export function createFogMap(container, options = {}) {
  const doc = container.ownerDocument || globalThis.document;
  const win = doc.defaultView || globalThis;
  injectFogStyles(doc);

  const onPick = typeof options.onPick === 'function' ? options.onPick : () => {};
  const ra0 = Number.isFinite(options.ra0) ? wrap360(options.ra0) : 180;
  const targets = Array.isArray(options.targets) ? options.targets : FOG_TARGETS;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const geo = buildGeometry(ra0);
  const uid = ++instanceCount;

  // Landmarks by cell, for the readout.
  const landmark = new Map();
  for (let i = BRIGHT_STARS.length - 1; i >= 0; i--) {
    const s = BRIGHT_STARS[i];
    if (s.mag <= 1.7) landmark.set(ang2pixNest(FOG_NSIDE, s.ra, s.dec), s.name);
  }
  for (const t of targets) landmark.set(ang2pixNest(FOG_NSIDE, t.ra, t.dec), t.name);

  // --- DOM -----------------------------------------------------------------------------------
  const root = doc.createElement('section');
  root.className = 'tb-fog';
  root.setAttribute('aria-label', 'Map of the patches of sky that have been opened with this tool');
  root.innerHTML = `
    <div class="tb-fog-head">
      <p class="tb-fog-stat" aria-live="polite"></p>
      <button type="button" class="tb-fog-go">Take me somewhere nobody has looked</button>
    </div>
    <div class="tb-fog-stage">
      <canvas class="tb-fog-canvas" tabindex="0" role="application"
        aria-label="All-sky map. Arrow keys move between patches of sky, Enter opens the selected patch."
        aria-describedby="tb-fog-readout-${uid}"></canvas>
    </div>
    <p class="tb-fog-readout" id="tb-fog-readout-${uid}" aria-live="polite"></p>
    <ul class="tb-fog-legend">${LEGEND_HTML}</ul>`;
  container.appendChild(root);
  const statEl = root.querySelector('.tb-fog-stat');
  const goBtn = root.querySelector('.tb-fog-go');
  const stage = root.querySelector('.tb-fog-stage');
  const canvas = root.querySelector('.tb-fog-canvas');
  const readoutEl = root.querySelector('.tb-fog-readout');
  const ctx = canvas.getContext('2d');

  const makeLayer = () => {
    const c = doc.createElement('canvas');
    return { canvas: c, ctx: c.getContext('2d') };
  };
  const baseLayer = makeLayer(); // unopened sky: fog texture and the galactic band
  const litLayer = makeLayer(); // opened cells
  const glowLayer = makeLayer(); // small scratch canvas for the glow
  const overLayer = makeLayer(); // graticule, lines, stars, targets, labels
  const staticLayer = makeLayer(); // everything above, composed

  // --- State ---------------------------------------------------------------------------------
  let counts = new Uint16Array(FOG_NPIX);
  let loaded = false;
  let opened = 0;
  let here = null; // { ra, dec }
  let active = -1; // highlighted cell
  let activeBy = ''; // 'pointer' | 'key'
  let cursor = -1; // keyboard cursor cell
  let columnRa = 0; // the RA the cursor tries to stay on while moving up and down
  let note = ''; // extra line in the readout after a random pick
  const pulses = new Map(); // cell -> start time (ms)
  const freshStatic = new Set(); // reduced motion: fresh cells shown with a static outline
  let freshTimer = 0;
  let raf = 0;
  let destroyed = false;

  // Layout (CSS px).
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let a = 1; // semi-major axis
  let b = 1; // semi-minor axis
  let cx = 0;
  let cy = 0;
  let narrow = false;

  const toPx = (x, y) => [cx + (x * a) / 2, cy - y * b];
  const skyToPx = (ra, dec) => {
    const xy = mollweideXY(screenLongitude(ra, ra0), dec);
    return toPx(xy[0], xy[1]);
  };
  const cellFromPx = (px, py) => {
    const sky = mollweideInverse((px - cx) / (a / 2), (cy - py) / b, ra0);
    return sky ? ang2pixNest(FOG_NSIDE, sky[0], sky[1]) : -1;
  };
  const cellCentre = (cell) => [geo.centre[2 * cell], geo.centre[2 * cell + 1]];
  const cellPx = (cell) => toPx(geo.cxy[2 * cell], geo.cxy[2 * cell + 1]);
  const cellSizePx = () => (1.83 / 90) * b * 1.2; // rough width of a cell near the equator

  // Canvas helpers. In "map units" the context draws geometry straight from geo.poly.
  const usePx = (c) => c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const useMap = (c) => c.setTransform((dpr * a) / 2, 0, 0, (-dpr * a) / 2, dpr * cx, dpr * cy);
  const ellipsePath = (c, grow = 0) => {
    c.beginPath();
    c.ellipse(cx, cy, a + grow, b + grow, 0, 0, 2 * Math.PI);
  };
  const traceOutline = (c, arr, off) => {
    c.moveTo(arr[off], arr[off + 1]);
    for (let i = 1; i < K; i++) c.lineTo(arr[off + 2 * i], arr[off + 2 * i + 1]);
    c.closePath();
  };
  const traceCell = (c, cell) => {
    traceOutline(c, geo.poly, cell * K * 2);
    const second = geo.extra.get(cell);
    if (second) traceOutline(c, second, 0);
  };
  const strokeSegs = (c, segs) => {
    c.beginPath();
    for (const seg of segs) {
      for (let i = 0; i < seg.length; i++) {
        const p = toPx(seg[i][0], seg[i][1]);
        if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]);
      }
    }
    c.stroke();
  };
  const haloText = (c, text, x, y, color) => {
    c.lineJoin = 'round';
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(12, 12, 11, 0.9)';
    c.strokeText(text, x, y);
    c.fillStyle = color;
    c.fillText(text, x, y);
  };

  // --- Offscreen layers ----------------------------------------------------------------------

  function paintBase() {
    const c = baseLayer.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, baseLayer.canvas.width, baseLayer.canvas.height);
    usePx(c);
    c.save();
    ellipsePath(c);
    c.clip();
    c.fillStyle = DEEP;
    c.fillRect(0, 0, cssW, cssH);
    // Faint mottled texture, one flat tone per cell, so the dark is visibly made of patches.
    useMap(c);
    const tones = [0, 0.022, 0.042, 0.064];
    for (let bucket = 1; bucket < 4; bucket++) {
      c.beginPath();
      for (let cell = 0; cell < FOG_NPIX; cell++) if (geo.fog[cell] === bucket) traceCell(c, cell);
      c.fillStyle = `rgba(${PAPER}, ${tones[bucket]})`;
      c.fill();
    }
    // Galactic band.
    for (const quads of geo.band) {
      c.beginPath();
      for (const q of quads) {
        c.moveTo(q[0], q[1]);
        c.lineTo(q[2], q[3]);
        c.lineTo(q[4], q[5]);
        c.lineTo(q[6], q[7]);
        c.closePath();
      }
      c.fillStyle = `rgba(${STONE}, 0.07)`;
      c.fill();
    }
    c.restore();
  }

  const litLevel = (count) => {
    const t = Math.min(1, Math.log(1 + count) / Math.log(1 + 60));
    return Math.min(LIT_LEVELS - 1, Math.floor(t * LIT_LEVELS));
  };
  const litAlpha = (level) => 0.4 + (0.6 * level) / (LIT_LEVELS - 1);

  function paintLit() {
    const c = litLayer.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, litLayer.canvas.width, litLayer.canvas.height);
    if (!opened) return;
    const byLevel = Array.from({ length: LIT_LEVELS }, () => []);
    for (let cell = 0; cell < FOG_NPIX; cell++) if (counts[cell]) byLevel[litLevel(counts[cell])].push(cell);
    usePx(c);
    c.save();
    ellipsePath(c);
    c.clip();
    useMap(c);
    for (let level = 0; level < LIT_LEVELS; level++) {
      if (!byLevel[level].length) continue;
      c.beginPath();
      for (const cell of byLevel[level]) traceCell(c, cell);
      c.fillStyle = `rgba(${PAPER}, ${litAlpha(level)})`;
      c.fill();
    }
    // Thin seams between lit cells once the cells are big enough to read as tiles.
    if (cellSizePx() >= 4.5) {
      c.beginPath();
      for (let cell = 0; cell < FOG_NPIX; cell++) if (counts[cell]) traceCell(c, cell);
      c.lineWidth = 1 / (a / 2);
      c.strokeStyle = 'rgba(12, 12, 11, 0.36)';
      c.stroke();
    }
    c.restore();
  }

  function paintOverlay() {
    const c = overLayer.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, overLayer.canvas.width, overLayer.canvas.height);
    usePx(c);
    const fs = narrow ? 9 : 11;
    const dim = `rgba(${PAPER}, 0.6)`;
    const boxes = [];
    const gapPx = 4; // labels keep at least this much clear space between them
    const hits = (box) => boxes.some((o) => box.x < o.x + o.w + gapPx && box.x + box.w + gapPx > o.x
      && box.y < o.y + o.h + 1 && box.y + box.h + 1 > o.y);
    const inside = (box) => box.x >= 1 && box.y >= 1 && box.x + box.w <= cssW - 1 && box.y + box.h <= cssH - 1;
    const choose = (candidates, force) => {
      for (const box of candidates) if (inside(box) && !hits(box)) { boxes.push(box); return box; }
      if (!force) return null;
      const box = candidates.find(inside) || candidates[0];
      boxes.push(box);
      return box;
    };

    c.save();
    ellipsePath(c);
    c.clip();

    // Graticule every 30 deg.
    c.lineWidth = 1;
    c.strokeStyle = `rgba(${STONE}, 0.3)`;
    for (const m of geo.meridians) strokeSegs(c, m.segs);
    for (const p of geo.parallels) {
      c.strokeStyle = `rgba(${STONE}, ${p.dec === 0 ? 0.55 : 0.3})`;
      strokeSegs(c, p.segs);
    }

    // Ecliptic (dashed) and galactic plane (dotted).
    // Each is drawn over a dark copy of itself so it stays readable across lit cells.
    const lineOn = (segs, width, alpha) => {
      c.lineWidth = width + 2;
      c.strokeStyle = 'rgba(12, 12, 11, 0.6)';
      strokeSegs(c, segs);
      c.lineWidth = width;
      c.strokeStyle = `rgba(${PAPER}, ${alpha})`;
      strokeSegs(c, segs);
    };
    c.setLineDash(narrow ? [4, 3.5] : [7, 5]);
    lineOn(geo.ecliptic, narrow ? 1 : 1.2, 0.66);
    c.lineCap = 'round';
    c.setLineDash(narrow ? [0.1, 3.4] : [0.1, 5]);
    lineOn(geo.galactic, narrow ? 1.3 : 1.7, 0.76);
    c.setLineDash([]);
    c.lineCap = 'butt';

    // Bright stars.
    const magLimit = narrow ? 1.7 : 3.5;
    c.fillStyle = `rgba(${PAPER}, 0.86)`;
    for (const s of BRIGHT_STARS) {
      if (s.mag > magLimit) break;
      const p = skyToPx(s.ra, s.dec);
      const r = Math.max(0.55, (narrow ? 0.75 : 1) * (0.55 + 0.42 * (2.8 - s.mag)));
      c.beginPath();
      c.arc(p[0], p[1], r, 0, 2 * Math.PI);
      c.fill();
    }
    c.restore();

    // Limb.
    ellipsePath(c);
    c.lineWidth = 1;
    c.strokeStyle = `rgba(${STONE}, 0.85)`;
    c.stroke();

    // Challenge targets: corner brackets first (they claim their space), then their labels.
    const s = narrow ? 4.5 : 6.5;
    const arm = s * 0.6;
    const spots = targets.map((t) => ({ t, p: skyToPx(t.ra, t.dec) }));
    for (const { p } of spots) boxes.push({ x: p[0] - s - 2, y: p[1] - s - 2, w: 2 * s + 4, h: 2 * s + 4 });
    c.lineWidth = narrow ? 1.1 : 1.4;
    for (const { p } of spots) {
      for (const pass of [0, 1]) {
        c.strokeStyle = pass ? `rgb(${PAPER})` : 'rgba(12, 12, 11, 0.85)';
        c.lineWidth = (narrow ? 1.1 : 1.4) + (pass ? 0 : 2);
        c.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          c.moveTo(p[0] + sx * s, p[1] + sy * (s - arm));
          c.lineTo(p[0] + sx * s, p[1] + sy * s);
          c.lineTo(p[0] + sx * (s - arm), p[1] + sy * s);
        }
        c.stroke();
      }
    }
    c.font = `${narrow ? 10 : 12}px ${SANS}`;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    const th = narrow ? 12 : 15;
    for (const { t, p } of spots) {
      const text = narrow ? (t.short || t.name) : t.name;
      const w = c.measureText(text).width;
      const gap = narrow ? 11 : 14; // clears the position marker when the user is on a target
      const box = choose([
        { x: p[0] + gap, y: p[1] - th / 2, w, h: th },
        { x: p[0] - gap - w, y: p[1] - th / 2, w, h: th },
        { x: p[0] - w / 2, y: p[1] - gap - th, w, h: th },
        { x: p[0] - w / 2, y: p[1] + gap, w, h: th },
      ], true);
      haloText(c, text, box.x, box.y + th / 2, `rgb(${PAPER})`);
    }

    // Labels that run along the ecliptic and the galactic plane.
    const along = (text, toSky, positions, offset) => {
      c.font = `italic ${narrow ? 10 : 12}px ${SANS}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const w = c.measureText(text).width;
      const h = narrow ? 12 : 15;
      for (const pos of positions) {
        const p0 = skyToPx(...toSky(pos - 1.5));
        const p1 = skyToPx(...toSky(pos + 1.5));
        const pm = skyToPx(...toSky(pos));
        if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > cssW / 4) continue; // straddles the limb
        let ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        if (Math.cos(ang) < 0) ang += Math.PI;
        const x = pm[0] + Math.sin(ang) * offset;
        const y = pm[1] - Math.cos(ang) * offset;
        const bw = Math.abs(Math.cos(ang)) * w + Math.abs(Math.sin(ang)) * h;
        const bh = Math.abs(Math.sin(ang)) * w + Math.abs(Math.cos(ang)) * h;
        const box = { x: x - bw / 2, y: y - bh / 2, w: bw, h: bh };
        if (!inside(box) || hits(box)) continue;
        boxes.push(box);
        c.save();
        c.translate(x, y);
        c.rotate(ang);
        haloText(c, text, 0, 0, `rgba(${PAPER}, 0.8)`);
        c.restore();
        return;
      }
    };
    const bandPx = (PLANE_AVOID_DEG / 90) * b;
    along('ecliptic', (lon) => eclToEq(lon, 0), [128, 112, 146, 232, 250, 62, 300], narrow ? 8 : 11);
    along('galactic plane', (l) => galToEq(l, 0), [303, 290, 316, 123, 108, 136, 60, 240], bandPx + (narrow ? 8 : 11));

    // RA hours along the equator, Dec along the left limb.
    c.font = `${fs}px ${MONO}`;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    const lh = fs + 3;
    const hourStep = narrow ? 60 : 30;
    const raLabel = (text, px, py, sides) => {
      const w = c.measureText(text).width;
      const cands = [];
      for (const side of sides) {
        const x = side > 0 ? px + 3 : px - 3 - w;
        cands.push({ x, y: py + 3, w, h: lh });
        cands.push({ x, y: py - 3 - lh, w, h: lh });
      }
      const box = choose(cands, false);
      if (box) haloText(c, text, box.x, box.y + lh / 2, dim);
    };
    for (let k = 0; k < 360; k += hourStep) {
      const ra = wrap360(ra0 - 180 + k); // k = 0 is the limb meridian
      const text = `${Math.round(ra / 15) % 24}h`;
      if (k === 0) {
        const right = toPx(2, 0);
        const left = toPx(-2, 0);
        raLabel(text, right[0], right[1], [-1]);
        raLabel(text, left[0], left[1], [1]);
      } else {
        const p = skyToPx(ra, 0);
        raLabel(text, p[0], p[1], [1, -1]);
      }
    }
    c.textAlign = 'right';
    for (let dec = -60; dec <= 60; dec += 30) {
      const xy = mollweideXY(-180, dec);
      const p = toPx(xy[0], xy[1]);
      const text = dec === 0 ? '0°' : `${dec > 0 ? '+' : '−'}${Math.abs(dec)}°`;
      const lift = dec > 0 ? -2 : dec < 0 ? 2 : 0;
      haloText(c, text, p[0] - 5, p[1] + lift, dim);
    }

    // Compass: north up, east (increasing RA) to the left.
    const len = narrow ? 11 : 16;
    const ox = cssW - (narrow ? 13 : 22);
    const oy = (narrow ? 12 : 16) + len + 6;
    c.strokeStyle = dim;
    c.fillStyle = dim;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(ox, oy); c.lineTo(ox, oy - len);
    c.moveTo(ox, oy); c.lineTo(ox - len, oy);
    c.stroke();
    c.beginPath();
    c.moveTo(ox, oy - len - 4); c.lineTo(ox - 3, oy - len + 1); c.lineTo(ox + 3, oy - len + 1); c.closePath();
    c.moveTo(ox - len - 4, oy); c.lineTo(ox - len + 1, oy - 3); c.lineTo(ox - len + 1, oy + 3); c.closePath();
    c.fill();
    c.font = `${fs}px ${MONO}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', ox, oy - len - 4 - fs * 0.7);
    c.fillText('E', ox - len - 4 - fs * 0.65, oy + 0.5);
  }

  function compose() {
    const c = staticLayer.ctx;
    const W = staticLayer.canvas.width;
    const H = staticLayer.canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    c.drawImage(baseLayer.canvas, 0, 0);
    if (opened) {
      // Glow: the lit layer shrunk and stretched back, under the crisp cells.
      const g = glowLayer.ctx;
      const gw = glowLayer.canvas.width;
      const gh = glowLayer.canvas.height;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, gw, gh);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(litLayer.canvas, 0, 0, gw, gh);
      c.save();
      usePx(c);
      ellipsePath(c);
      c.clip();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.globalAlpha = 0.65;
      c.drawImage(glowLayer.canvas, 0, 0, W, H);
      c.restore();
      c.drawImage(litLayer.canvas, 0, 0);
    }
    c.drawImage(overLayer.canvas, 0, 0);
  }

  // --- Frame ---------------------------------------------------------------------------------

  function invalidate() {
    if (raf || destroyed) return;
    raf = win.requestAnimationFrame(frame);
  }

  function outlineCell(cell, color, width) {
    useMap(ctx);
    ctx.beginPath();
    traceCell(ctx, cell);
    ctx.lineJoin = 'round';
    ctx.lineWidth = (width + 2.2) / (a / 2);
    ctx.strokeStyle = 'rgba(12, 12, 11, 0.9)';
    ctx.stroke();
    ctx.lineWidth = width / (a / 2);
    ctx.strokeStyle = color;
    ctx.stroke();
    usePx(ctx);
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !cssW) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticLayer.canvas, 0, 0);
    usePx(ctx);

    // Freshly opened cells: a Signal flash that settles into Paper, with a widening ring.
    if (pulses.size) {
      ctx.save();
      ellipsePath(ctx, 1);
      ctx.clip();
      for (const [cell, t0] of pulses) {
        const p = (now - t0) / PULSE_MS;
        if (p >= 1) { pulses.delete(cell); continue; }
        if (p < 0) continue;
        const fade = (1 - p) * (1 - p);
        useMap(ctx);
        ctx.beginPath();
        traceCell(ctx, cell);
        ctx.fillStyle = `rgba(${SIGNAL}, ${0.95 * fade})`;
        ctx.fill();
        usePx(ctx);
        const centre = cellPx(cell);
        const ease = 1 - (1 - p) ** 3;
        ctx.beginPath();
        ctx.arc(centre[0], centre[1], 3 + ease * (narrow ? 15 : 24), 0, 2 * Math.PI);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(${SIGNAL}, ${0.9 * (1 - p)})`;
        ctx.stroke();
      }
      ctx.restore();
      if (pulses.size) invalidate();
    }
    for (const cell of freshStatic) {
      outlineCell(cell, `rgb(${SIGNAL})`, 1.5);
      const centre = cellPx(cell);
      ctx.beginPath();
      ctx.arc(centre[0], centre[1], narrow ? 7 : 10, 0, 2 * Math.PI);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = `rgba(${SIGNAL}, 0.9)`;
      ctx.stroke();
    }

    // Where the user is.
    if (here) {
      const p = skyToPx(here.ra, here.dec);
      const r = narrow ? 5 : 7;
      const tick = narrow ? 3 : 4;
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass ? `rgb(${SIGNAL})` : 'rgba(12, 12, 11, 0.9)';
        ctx.lineWidth = pass ? 1.6 : 3.8;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, 2 * Math.PI);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.moveTo(p[0] + dx * (r + 1.5), p[1] + dy * (r + 1.5));
          ctx.lineTo(p[0] + dx * (r + 1.5 + tick), p[1] + dy * (r + 1.5 + tick));
        }
        ctx.stroke();
      }
    }

    // Hovered cell or keyboard cursor.
    if (active >= 0) {
      outlineCell(active, `rgb(${PAPER})`, 1.5);
      if (cellSizePx() < 9 || activeBy === 'key') {
        const centre = cellPx(active);
        ctx.beginPath();
        ctx.arc(centre[0], centre[1], Math.max(8, cellSizePx() * 1.25), 0, 2 * Math.PI);
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${PAPER}, 0.85)`;
        ctx.stroke();
      }
    }
  }

  // --- Layout --------------------------------------------------------------------------------

  function resize() {
    if (destroyed) return;
    const w = Math.round(stage.clientWidth);
    let ratio = Math.min(3, win.devicePixelRatio || 1);
    if (w * ratio > 2800) ratio = Math.max(1, 2800 / w);
    if (w === cssW && ratio === dpr) return;
    cssW = w;
    cssH = Math.round(w / 2);
    dpr = ratio;
    if (!cssW) return;
    narrow = cssW < 640;
    const padX = narrow ? 21 : 42;
    a = cssW / 2 - padX;
    b = a / 2;
    cx = cssW / 2;
    cy = cssH / 2;
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    for (const layer of [baseLayer, litLayer, overLayer, staticLayer]) {
      layer.canvas.width = W;
      layer.canvas.height = H;
    }
    canvas.width = W;
    canvas.height = H;
    glowLayer.canvas.width = Math.max(1, Math.round(W / 10));
    glowLayer.canvas.height = Math.max(1, Math.round(H / 10));
    paintBase();
    paintLit();
    paintOverlay();
    compose();
    invalidate();
  }

  // --- Readout -------------------------------------------------------------------------------

  function updateStat() {
    if (!loaded) {
      statEl.innerHTML = `Waiting for the shared map of <b>${thousands(FOG_NPIX)}</b> patches`;
      return;
    }
    statEl.innerHTML = `<b class="tb-fog-n">${thousands(opened)}</b> of <b>${thousands(FOG_NPIX)}</b> patches opened <b>(${percentText(opened)})</b>`;
  }

  function span(cls, text) {
    const el = doc.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  }

  function updateReadout() {
    readoutEl.textContent = '';
    if (active < 0) {
      readoutEl.appendChild(span('tb-fog-hint', note
        || 'Each cell is a patch of sky about 1.8° across. Point at one to inspect it; click it, or press Enter, to open it.'));
      return;
    }
    const [ra, dec] = cellCentre(active);
    readoutEl.appendChild(span('tb-fog-coord', `${formatHms(ra)}  ${formatDms(dec)}`));
    readoutEl.appendChild(span('tb-fog-deg', formatDeg(ra, dec)));
    const count = counts[active];
    let text = describeCount(count, loaded);
    const mark = landmark.get(active);
    if (mark) text += ` · contains ${mark}`;
    readoutEl.appendChild(span(`tb-fog-state${loaded && count === 0 ? ' is-new' : ''}`, text));
    if (note) readoutEl.appendChild(span('tb-fog-hint', note));
  }

  function setActive(cell, by) {
    if (cell === active && by === activeBy) return;
    active = cell;
    activeBy = cell >= 0 ? by : '';
    if (by !== 'pick') note = '';
    updateReadout();
    invalidate();
  }

  // --- Picking -------------------------------------------------------------------------------

  function pickCell(cell, why) {
    if (cell < 0 || cell >= FOG_NPIX) return null;
    const [ra, dec] = cellCentre(cell);
    const pick = {
      ra: Math.round(ra * 1e6) / 1e6,
      dec: Math.round(dec * 1e6) / 1e6,
      cell,
      count: counts[cell],
    };
    cursor = cell;
    columnRa = ra;
    // Worded so it stays true once the caller has recorded this visit and refreshed the counts.
    note = why || (loaded && pick.count === 0 ? 'Nobody had opened this patch before you.' : '');
    setActive(cell, 'pick');
    updateReadout();
    try {
      onPick(pick);
    } catch (err) {
      if (globalThis.console) globalThis.console.error(err);
    }
    return pick;
  }

  function pickUnopened() {
    const choice = chooseUnopenedCell(counts, { random, ra0 });
    if (!choice) return null;
    const { cell, why } = choice;
    if (!reducedMotion()) {
      pulses.set(cell, win.performance.now());
    }
    return pickCell(cell, why);
  }

  // --- Events --------------------------------------------------------------------------------

  const eventCell = (ev) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return -1;
    const scale = cssW / rect.width;
    return cellFromPx((ev.clientX - rect.left) * scale, (ev.clientY - rect.top) * scale);
  };

  function onPointerMove(ev) {
    setActive(eventCell(ev), 'pointer');
  }
  function onPointerLeave() {
    if (activeBy === 'pointer') setActive(-1, '');
  }
  function onClick(ev) {
    const cell = eventCell(ev);
    if (cell >= 0) pickCell(cell, '');
  }

  function startCell() {
    if (cursor >= 0) return cursor;
    if (here) return ang2pixNest(FOG_NSIDE, here.ra, here.dec);
    return ang2pixNest(FOG_NSIDE, ra0, 0);
  }

  function moveCursor(key) {
    if (active < 0) {
      // First key press: show the cursor where it was left (or at the user's position).
      cursor = startCell();
      columnRa = cellCentre(cursor)[0];
      setActive(cursor, 'key');
      return;
    }
    if (active !== cursor) {
      // Carry on from whatever is highlighted: a hovered cell or the last pick.
      cursor = active;
      columnRa = cellCentre(cursor)[0];
    }
    // Neighbours: [SW, W, NW, N, NE, E, SE, S]. East (larger RA) is to the left on the map.
    const nb = neighboursNest(FOG_NSIDE, cursor);
    const dec = cellCentre(cursor)[1];
    let next = -1;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const order = key === 'ArrowLeft' ? [5, 4, 6] : [1, 2, 0];
      for (const i of order) if (nb[i] >= 0) { next = nb[i]; break; }
      if (next >= 0) columnRa = cellCentre(next)[0];
    } else {
      // Rows of cells are staggered, so going up or down alternates between the two cells
      // that touch from that side, keeping as close as possible to the starting RA.
      const up = key === 'ArrowUp';
      let best = Infinity;
      for (const i of up ? [2, 4] : [0, 6]) {
        const q = nb[i];
        if (q < 0) continue;
        const [qra, qdec] = cellCentre(q);
        if (up ? qdec <= dec + 1e-6 : qdec >= dec - 1e-6) continue; // do not step over a pole
        const d = Math.abs(wrap180(qra - columnRa));
        if (d < best) { best = d; next = q; }
      }
    }
    if (next >= 0) {
      cursor = next;
      setActive(next, 'key');
    }
  }

  function onKeyDown(ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      moveCursor(ev.key);
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      if (active >= 0) {
        ev.preventDefault();
        pickCell(active, '');
      }
    } else if (ev.key === 'Escape') {
      setActive(-1, '');
    }
  }

  function onFocus() {
    // Show the keyboard cursor only for keyboard focus, not when the map was clicked.
    let visible = false;
    try { visible = canvas.matches(':focus-visible'); } catch (e) { visible = false; }
    if (visible && active < 0) {
      cursor = startCell();
      columnRa = cellCentre(cursor)[0];
      setActive(cursor, 'key');
    }
  }
  function onBlur() {
    if (activeBy === 'key') setActive(-1, '');
  }

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('focus', onFocus);
  canvas.addEventListener('blur', onBlur);
  goBtn.addEventListener('click', pickUnopened);

  let observer = null;
  if (typeof win.ResizeObserver === 'function') {
    observer = new win.ResizeObserver(resize);
    observer.observe(stage);
  }
  win.addEventListener('resize', resize);

  updateStat();
  updateReadout();
  resize();

  // --- Public API ----------------------------------------------------------------------------

  function applyCounts(next, announce) {
    const fresh = [];
    if (announce) {
      for (let cell = 0; cell < FOG_NPIX; cell++) if (next[cell] > counts[cell]) fresh.push(cell);
    }
    counts = next;
    opened = 0;
    for (let cell = 0; cell < FOG_NPIX; cell++) if (counts[cell]) opened++;
    loaded = true;
    updateStat();
    updateReadout();
    // A wholesale change (hundreds of cells) is a reload, not news: show it without pulses.
    if (fresh.length && fresh.length <= 240) {
      if (reducedMotion()) {
        for (const cell of fresh) freshStatic.add(cell);
        win.clearTimeout(freshTimer);
        freshTimer = win.setTimeout(() => { freshStatic.clear(); invalidate(); }, 4500);
      } else {
        const t0 = win.performance.now();
        const stagger = Math.min(45, 700 / fresh.length);
        fresh.forEach((cell, i) => pulses.set(cell, t0 + i * stagger));
      }
    }
    if (cssW) {
      paintLit();
      compose();
      invalidate();
    }
  }

  return {
    /** Replace the visit counts. Cells whose count rose since the previous call pulse once. */
    setCounts(input) {
      if (destroyed) return;
      applyCounts(toCounts(input), loaded);
    },
    /** Mark the position the user is looking at; setHere(null) removes the marker. */
    setHere(ra, dec) {
      if (destroyed) return;
      here = Number.isFinite(ra) && Number.isFinite(dec)
        ? { ra: wrap360(ra), dec: Math.max(-90, Math.min(90, dec)) }
        : null;
      invalidate();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) win.cancelAnimationFrame(raf);
      win.clearTimeout(freshTimer);
      if (observer) observer.disconnect();
      win.removeEventListener('resize', resize);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('focus', onFocus);
      canvas.removeEventListener('blur', onBlur);
      goBtn.removeEventListener('click', pickUnopened);
      pulses.clear();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
    // Optional extras.
    markLocal(ra, dec) {
      const cell = ang2pixNest(FOG_NSIDE, ra, Math.max(-90, Math.min(90, dec)));
      if (destroyed || cell < 0) return { cell: -1, count: 0 };
      const next = counts.slice();
      next[cell] = Math.min(65535, next[cell] + 1);
      applyCounts(next, true);
      return { cell, count: next[cell] };
    },
    pickUnopened,
    getCounts: () => counts.slice(),
    cellAt: (x, y) => cellFromPx(x, y),
    project(ra, dec) {
      const p = skyToPx(ra, dec);
      return { x: p[0], y: p[1] };
    },
    element: root,
  };
}
