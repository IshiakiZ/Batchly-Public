// ─────────────────────────────────────────────────────────────────────────────
//  Arena obstacles: procedurally generated pixel-art props that stand upright on
//  their round footprint (3/4 "JRPG" view, light from the top-left).
//
//    obstacleArt(themeId, rPx, seed) → { body[], fps, ax, ay, floor, fax, fay, top, halfW }
//
//  Every prop is modelled as a tiny 3D solid (height fields, prisms, spheres),
//  rasterised pixel by pixel into typed arrays as (material, tone) pairs, then
//  mapped to a hand-picked palette, outlined and converted to canvases once.
//  Deterministic (seeded hash, never Math.random) and cached. The props of the newer
//  arenas live in art-props-nature/built/mystic.js and get this module's toolkit (KIT).
// ─────────────────────────────────────────────────────────────────────────────

// More arenas: their props live in art-props-*.js; each builder is (R, seed, kit) → finish(...)
// and gets this module's toolkit (see KIT at the bottom), so those files need no imports.
import { PROPS_NATURE } from './art-props-nature.js';
import { PROPS_BUILT } from './art-props-built.js';
import { PROPS_MYSTIC } from './art-props-mystic.js';

export const OBSTACLE_THEMES = ['colosseum', 'lava', 'frost', 'neon', 'forest', 'desert',
  'swamp', 'sky', 'graveyard', 'dojo', 'ship', 'jungle', 'crystal', 'rooftop', 'beach', 'castle', 'factory', 'candy', 'olympus', 'abyss'];

const TAU = Math.PI * 2;
const SQ = 0.45;                                    // plan depth → screen rows (base ellipse ry = 0.45·rx)
const LIGHT = norm3(-0.62, 0.32, 0.72);             // from the left, above, slightly in front
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const cache = new Map();
const CACHE_MAX = 384;

// ── small maths ─────────────────────────────────────────────────────────────
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function len2(x, y) { return Math.sqrt(x * x + y * y); }
function norm3(x, y, z) { const l = Math.sqrt(x * x + y * y + z * z) || 1; return [x / l, y / l, z / l]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function lit(nx, ny, nz) { const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; return (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / l; }

function prand(n) {
  let t = (n * 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function hash3(a, b, c) {
  let h = Math.imul((a | 0) ^ 0x2545f491, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15) ^ (b | 0), 0x85ebca77);
  h = Math.imul(h ^ (h >>> 13) ^ (c | 0), 0xc2b2ae3d);
  return (h ^ (h >>> 16)) >>> 0;
}
const hrand = (a, b, c) => prand(hash3(a, b, c));
function stream(seed, salt) {
  let k = 0;
  const r = () => prand(hash3(seed, salt, k++));
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => a + Math.floor((b - a + 1) * r());
  r.sign = () => (r() < 0.5 ? -1 : 1);
  return r;
}
// smooth periodic noise in [-1, 1] around a circle (irregular outlines)
function ringNoise(seed, n) {
  const v = [];
  for (let k = 0; k < n; k++) v.push(hrand(seed, k, 77) * 2 - 1);
  return (th) => {
    const t = ((((th / TAU) % 1) + 1) % 1) * n, k0 = Math.floor(t), f = t - k0, s = f * f * (3 - 2 * f);
    const a = v[k0 % n], b = v[(k0 + 1) % n];
    return a + (b - a) * s;
  };
}
// 2D value noise in [0, 1]
function vnoise(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hrand(seed, x0, y0), b = hrand(seed, x0 + 1, y0), c = hrand(seed, x0, y0 + 1), d = hrand(seed, x0 + 1, y0 + 1);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

// ── colours ─────────────────────────────────────────────────────────────────
function C(hex, a = 255) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return LE ? (((a << 24) | (b << 16) | (g << 8) | r) >>> 0) : (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
}
const pal = (...hs) => hs.map((h) => C(h));
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

// ── pixel buffer: material id + tone index + depth per pixel ───────────────
// material 0 = empty; material | 128 = outline of that material.
class Pix {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.m = new Uint8Array(w * h);
    this.t = new Uint8Array(w * h);
    this.d = new Float32Array(w * h).fill(-1e9);
  }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  zput(x, y, m, t, d) {
    if (!this.in(x, y)) return false;
    const k = y * this.w + x;
    if (d < this.d[k]) return false;
    this.m[k] = m; this.t[k] = t; this.d[k] = d;
    return true;
  }
  mat(x, y) { return this.in(x, y) ? this.m[y * this.w + x] : 0; }
  tone(x, y) { return this.in(x, y) ? this.t[y * this.w + x] : 0; }
  setTone(x, y, t) { if (this.in(x, y)) this.t[y * this.w + x] = t; }
  set(x, y, m, t) { if (this.in(x, y)) { const k = y * this.w + x; this.m[k] = m; this.t[k] = t; this.d[k] = 1e8; } }
  erase(x, y) { if (!this.in(x, y)) return; const k = y * this.w + x; this.m[k] = 0; this.t[k] = 0; this.d[k] = -1e9; }
  clone() {                                           // colour-only copy (animation frames)
    const p = Object.create(Pix.prototype);
    p.w = this.w; p.h = this.h; p.m = this.m.slice(); p.t = this.t.slice(); p.d = this.d;
    return p;
  }
}

// floor decal buffer (straight-alpha RGBA bytes, source-over blending)
class Dec {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Uint8ClampedArray(w * h * 4); }
  over(x, y, c, al = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || al <= 0) return;
    const o = (y * this.w + x) * 4, d = this.px, da = d[o + 3] / 255, na = al + da * (1 - al), kd = (da * (1 - al)) / na, ks = al / na;
    d[o] = c[0] * ks + d[o] * kd;
    d[o + 1] = c[1] * ks + d[o + 1] * kd;
    d[o + 2] = c[2] * ks + d[o + 2] * kd;
    d[o + 3] = na * 255;
  }
}

// working area: anchor (floor centre) at pixel (AX, AY); cx/cy are continuous centre coords
function area(side, up, down) {
  side = Math.ceil(side) + 4; up = Math.ceil(up) + 4; down = Math.ceil(down) + 4;
  return { W: side * 2 + 1, H: up + down + 1, AX: side, AY: up, cx: side + 0.5, cy: up + 0.5 };
}

// ── rasterisers ─────────────────────────────────────────────────────────────
// Height-field solid: hf(x, y) → height (≥ z0 inside, < z0 outside); may set HF.mat.
// Plan coords: x right, y toward the viewer, in px. Every pixel is depth-tested, so
// the order of calls never matters. shade(kind, mat, x, y, z, nx, ny, nz, i, j, ft, fb)
// → (mat << 8 | tone) or -1 to skip; kind 0 = surface, 1 = vertical wall; for wall
// rows ft = rows below the top edge (1 = first wall row), fb = rows above the bottom.
const HF = { mat: 1, step: 0.5 };                  // step: plan-y sampling (set per build by size)
function renderHF(p, cx, cy, o, hf, shade) {
  const step = o.step || HF.step, z0 = o.z0 || 0;
  const kA = Math.ceil(o.y0 / step), kB = Math.floor(o.y1 / step), n = kB - kA + 1;
  const i0 = Math.floor(cx + o.x0) - 1, i1 = Math.ceil(cx + o.x1) + 1, cols = i1 - i0 + 3;
  const H = new Float32Array(cols * n), M = new Uint8Array(cols * n);
  for (let c = 0; c < cols; c++) {
    const x = i0 - 1 + c + 0.5 - cx;
    for (let k = 0; k < n; k++) {
      HF.mat = o.mat || 1;
      H[c * n + k] = hf(x, (kA + k) * step);
      M[c * n + k] = HF.mat;
    }
  }
  for (let c = 1; c < cols - 1; c++) {
    const i = i0 - 1 + c, x = i + 0.5 - cx, row = c * n;
    for (let k = 0; k < n; k++) {
      const h = H[row + k];
      if (!(h >= z0)) continue;
      const y = (kA + k) * step, mat = M[row + k];
      const hl = H[row - n + k], hr = H[row + n + k];
      const gx = ((hr >= z0 ? hr : h) - (hl >= z0 ? hl : h)) * 0.5;
      const hb = k > 0 && H[row + k - 1] >= z0 ? H[row + k - 1] : h;
      const nh = k + 1 < n ? H[row + k + 1] : -1e9;
      const last = !(nh >= z0);
      const top = Math.floor(cy + y * SQ - h);
      let v = shade(0, mat, x, y, h, -gx, -(h - hb) / step, 1, i, top, 0, 0);
      if (v >= 0) p.zput(i, top, v >> 8, v & 255, y + 0.45 * h);
      let end, wall;
      if (last) { end = Math.floor(cy + y * SQ - z0 - 1e-4); wall = true; }
      else { end = Math.floor(cy + (y + step) * SQ - nh) - 1; wall = (h - nh) / step > 4; }
      const gyF = last ? 0 : (nh - h) / step;
      for (let j = top + 1; j <= end; j++) {
        const z = cy + y * SQ - (j + 0.5);
        v = shade(wall ? 1 : 0, mat, x, y, z, -gx, -gyF, 1, i, j, j - top, end - j);
        if (v >= 0) p.zput(i, j, v >> 8, v & 255, y + 0.45 * z);
      }
    }
  }
}

// shape tests: 0 circle, 1 square, 2 octagon (flat face toward the viewer)
function inShape(shape, a, x, y) {
  if (shape === 0) return x * x + y * y <= a * a + 0.5 * a;
  const ax = Math.abs(x), ay = Math.abs(y);
  if (shape === 1) return ax <= a + 0.25 && ay <= a;
  return ax <= a + 0.25 && ay <= a && ax + ay <= a * Math.SQRT2 + 0.25;
}
function slab(p, cx, cy, shape, a, z0, z1, shade, mat = 1) {
  const e = a + 1.5;
  renderHF(p, cx, cy, { x0: -e, x1: e, y0: -e, y1: e, z0, mat }, (x, y) => (inShape(shape, a, x, y) ? z1 : -1), shade);
}

// flat-shaded triangle with depth test; world points [x, y, z]; frag(w0, w1, w2) → (mat << 8 | tone) or -1
function tri3(p, cx, cy, A, B, Q, frag) {
  const ax = cx + A[0], ay = cy + A[1] * SQ - A[2];
  const bx = cx + B[0], by = cy + B[1] * SQ - B[2];
  const qx = cx + Q[0], qy = cy + Q[1] * SQ - Q[2];
  const ar = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
  if (Math.abs(ar) < 1e-6) return;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, qx))), maxX = Math.min(p.w - 1, Math.ceil(Math.max(ax, bx, qx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, qy))), maxY = Math.min(p.h - 1, Math.ceil(Math.max(ay, by, qy)));
  const dA = A[1] + 0.45 * A[2], dB = B[1] + 0.45 * B[2], dQ = Q[1] + 0.45 * Q[2];
  for (let j = minY; j <= maxY; j++) {
    const py = j + 0.5;
    for (let i = minX; i <= maxX; i++) {
      const px = i + 0.5;
      const w0 = ((bx - px) * (qy - py) - (by - py) * (qx - px)) / ar;
      const w1 = ((qx - px) * (ay - py) - (qy - py) * (ax - px)) / ar;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
      if (w0 * A[2] + w1 * B[2] + w2 * Q[2] < 0) continue;       // below the floor
      const v = frag(w0, w1, w2);
      if (v >= 0) p.zput(i, j, v >> 8, v & 255, w0 * dA + w1 * dB + w2 * dQ);
    }
  }
}

// ── post passes ─────────────────────────────────────────────────────────────
function outline(p, mats) {
  const { w, h, m, t } = p, src = m.slice();
  // outline priority per material id (0 = casts no outline)
  const pri = new Uint8Array(256);
  for (let v = 1; v < mats.length; v++) if (mats[v] && mats[v].ol) pri[v] = (mats[v].pr || 0) + 1;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (src[k]) continue;
      let best = 0, bp = 0, v;
      if (j > 0 && (v = src[k - w]) && pri[v] > bp) { bp = pri[v]; best = v; }
      if (j < h - 1 && (v = src[k + w]) && pri[v] > bp) { bp = pri[v]; best = v; }
      if (i > 0 && (v = src[k - 1]) && pri[v] > bp) { bp = pri[v]; best = v; }
      if (i < w - 1 && (v = src[k + 1]) && pri[v] > bp) { bp = pri[v]; best = v; }
      if (best) { m[k] = best | 128; t[k] = 0; }
    }
  }
}
// Inner outlines where a nearer part overlaps a farther one (depth jump > thr): the
// farther pixel next to the nearer part's silhouette takes the nearer material's
// outline colour, exactly as if that part were outlined against empty space.
// onlyFront limits the lines to overlaps by that material. Run before any set().
function depthEdges(p, thr, onlyFront = 0) {
  const { w, h, m, t, d } = p, mark = [];
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const k = j * w + i, mk = m[k];
      if (!mk || mk & 128 || (onlyFront && mk !== onlyFront)) continue;
      const dk = d[k] - thr;
      let n = k - w, mn = m[n];
      if (mn && !(mn & 128) && d[n] < dk) mark.push(n, mk);
      n = k + w; mn = m[n];
      if (mn && !(mn & 128) && d[n] < dk) mark.push(n, mk);
      n = k - 1; mn = m[n];
      if (mn && !(mn & 128) && d[n] < dk) mark.push(n, mk);
      n = k + 1; mn = m[n];
      if (mn && !(mn & 128) && d[n] < dk) mark.push(n, mk);
    }
  }
  for (let q = 0; q < mark.length; q += 2) { m[mark[q]] = mark[q + 1] | 128; t[mark[q]] = 0; }
}
// remove lone pixels whose 4 neighbours all share another tone of the same material
function despeckle(p, mat) {
  const { w, h, m, t } = p, src = t.slice();
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      if (m[k] !== mat) continue;
      const a = src[k - w], b = src[k + w], c = src[k - 1], d = src[k + 1];
      if (m[k - w] === mat && m[k + w] === mat && m[k - 1] === mat && m[k + 1] === mat && a === b && b === c && c === d && a !== src[k]) t[k] = a;
    }
  }
}

function toCanvas(p, mats, x0, y0, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const img = g.createImageData(w, h);
  const out = new Uint32Array(img.data.buffer);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (j + y0) * p.w + i + x0, v = p.m[k];
      if (!v) continue;
      const mt = mats[v & 127];
      out[j * w + i] = v & 128 ? mt.ol : mt.pal[Math.min(mt.pal.length - 1, p.t[k])];
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}
function decToCanvas(d, x0, y0, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const img = g.createImageData(w, h);
  for (let j = 0; j < h; j++) img.data.set(d.px.subarray(((j + y0) * d.w + x0) * 4, ((j + y0) * d.w + x0 + w) * 4), j * w * 4);
  g.putImageData(img, 0, 0);
  return cv;
}

// crop the frames + decal and build the public record
function finish(frames, mats, G, dec, DG, fps) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (const f of frames) {
    const { w: fw, m } = f;
    for (let j = 0; j < f.h; j++) {
      const r = j * fw;
      let a = 0;
      while (a < fw && !m[r + a]) a++;
      if (a === fw) continue;
      let b = fw - 1;
      while (!m[r + b]) b--;
      if (a < x0) x0 = a;
      if (b > x1) x1 = b;
      if (j < y0) y0 = j;
      y1 = Math.max(y1, j);
    }
  }
  if (x1 < 0) { x0 = G.AX; y0 = G.AY; x1 = G.AX; y1 = G.AY; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const body = frames.map((f) => toCanvas(f, mats, x0, y0, w, h));
  const ax = G.AX - x0, ay = G.AY - y0;
  let floor = null, fax = 0, fay = 0;
  if (dec) {
    let u0 = 1e9, v0 = 1e9, u1 = -1, v1 = -1;
    for (let j = 0; j < dec.h; j++) {
      for (let i = 0; i < dec.w; i++) {
        if (!dec.px[(j * dec.w + i) * 4 + 3]) continue;
        if (i < u0) u0 = i;
        if (i > u1) u1 = i;
        if (j < v0) v0 = j;
        if (j > v1) v1 = j;
      }
    }
    if (u1 >= 0) {
      floor = decToCanvas(dec, u0, v0, u1 - u0 + 1, v1 - v0 + 1);
      fax = DG.AX - u0; fay = DG.AY - v0;
    }
  }
  return { body, fps: body.length > 1 ? fps : 0, ax, ay, floor, fax, fay, top: ay, halfW: Math.max(ax, w - 1 - ax) + 0.5 };
}

// ── decal helpers ───────────────────────────────────────────────────────────
function dEllipse(d, cx, cy, rx, ry, c, al) {
  for (let j = Math.floor(cy - ry) - 1; j <= Math.ceil(cy + ry) + 1; j++) {
    for (let i = Math.floor(cx - rx) - 1; i <= Math.ceil(cx + rx) + 1; i++) {
      const dx = (i + 0.5 - cx) / rx, dy = (j + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) d.over(i, j, c, al);
    }
  }
}
// two-step pixel shadow (dark core, lighter rim)
function dShadow(d, cx, cy, rx, ry, al = 0.34, col = [0, 0, 0]) {
  dEllipse(d, cx, cy, rx, ry, col, al * 0.55);
  dEllipse(d, cx, cy, Math.max(1, rx - 2), Math.max(1, ry - 1.2), col, al * 0.55);
}
// a little pebble / rubble chunk: tones [light, mid, dark, outline]
function dPebble(d, x, y, w, h, tones, rn) {
  const cells = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const corner = (i === 0 || i === w - 1) && (j === 0 || j === h - 1);
      if (corner && w > 2 && h > 1 && rn() < 0.6) continue;
      cells.push([i, j]);
    }
  }
  const has = (i, j) => cells.some((c) => c[0] === i && c[1] === j);
  for (const [i, j] of cells) {
    for (const [di, dj] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (!has(i + di, j + dj)) d.over(x + i + di, y + j + dj, tones[3], 1);
    }
  }
  for (const [i, j] of cells) {
    const top = j === 0 || !has(i, j - 1);
    d.over(x + i, y + j, top && i < w - 1 ? tones[0] : j === h - 1 || i === w - 1 ? tones[2] : tones[1], 1);
  }
}

// cylinder side tones (index into a 6-tone ramp: 1 dark … 4 light, 5 highlight)
function cylTone(u) {
  if (u < -0.8) return 3;
  if (u < -0.62) return 4;
  if (u < -0.4) return 5;
  if (u < 0.04) return 4;
  if (u < 0.44) return 3;
  if (u < 0.8) return 2;
  return 1;
}

// ═════════════════════════════════════════════════════════════════════════════
//  COLOSSEUM — Doric stone column on a stepped plinth
// ═════════════════════════════════════════════════════════════════════════════
function buildColosseum(R, seed) {
  const rn = stream(seed, 11);
  const PL = 1, SH = 2, CA = 3;                    // plinth / shaft / capital (same stone)
  const stone = pal('#262b3a', '#3a4054', '#5a6278', '#8a93a8', '#b8c0d0', '#e2e7f0');
  const OL = C('#151822');
  const mats = [null, { pal: stone, ol: OL, pr: 1 }, { pal: stone, ol: OL, pr: 2 }, { pal: stone, ol: OL, pr: 3 }];
  const k = clamp((R - 10) / 38, 0, 1);
  const rs = R * (0.6 - 0.2 * k);
  const a1 = R, h1 = Math.max(3, Math.round(R * 0.11));
  const a2 = Math.round(R * 0.8), h2 = R >= 12 ? Math.max(2, Math.round(R * 0.075)) : 0;
  const rt = rs + Math.max(1.5, rs * 0.16), ht = Math.max(2, Math.round(rs * 0.18));
  const re = rs + Math.max(2, rs * 0.3), he = Math.max(3, Math.round(rs * 0.25));
  const aa = Math.round(re + 1), ha = Math.max(3, Math.round(rs * 0.22));
  const vis = Math.min(R >= 40 ? 104 : 100, Math.round(2.3 * (2 * R + 2)));
  const zTop = Math.round(vis - R * SQ - aa * SQ);
  const zP = h1 + h2, zS0 = zP + ht, zS1 = zTop - ha - he;
  const G = area(R + 2, zTop + aa * SQ + 2, R * SQ + 2);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX } = G;
  const gs = hash3(seed, 11, 5);
  const grain = (i, j) => hrand(gs, i, j) < 0.02;

  // the shaft's shadow on the plinth tops (light comes from the left/front)
  const lh = norm3(LIGHT[0], LIGHT[1], 0);
  const inShaftShadow = (x, y) => {
    const t = -(x * lh[0] + y * lh[1]);
    if (t < 0) return false;
    const qx = x + t * lh[0], qy = y + t * lh[1];
    return qx * qx + qy * qy <= rs * rs;
  };
  // masonry joints in the plinth blocks
  const seam1 = new Set(), seam2 = new Set();
  if (R >= 16) {
    if (R >= 28) { const o = rn.range(0.26, 0.4); seam1.add(Math.round(-a1 * o)); seam1.add(Math.round(a1 * rn.range(0.26, 0.4))); }
    else seam1.add(Math.round(rn.range(-0.4, 0.4) * a1));
    seam2.add(Math.round(rn.range(-0.45, 0.45) * a2));
  }
  const aoStep = (x, y) => h2 > 0 && y > a2 - 0.2 && y < a2 + 1.3 && Math.abs(x) <= a2 + 0.5;
  const aoTorus = (x, y) => { const d = len2(x, y); return y > -rt * 0.3 && d > rt - 0.3 && d < rt + 1.2; };
  const box = (mat, seams, ao) => (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    const xi = i - AX;
    if (kind === 0) {
      let t = 4;
      if (seams && seams.has(xi)) t = 3;
      else if (ao && ao(x, y)) t = 3;
      else if (mat !== CA && inShaftShadow(x, y)) t = 3;
      else if (grain(i, j)) t = 3;
      return (mat << 8) | t;
    }
    let t = ft === 1 ? 5 : fb === 0 ? 2 : 3;
    if (t === 3 && seams && seams.has(xi)) t = 2;
    return (mat << 8) | t;
  };
  slab(p, cx, cy, 1, a1, 0, h1, box(PL, seam1, h2 ? aoStep : aoTorus), PL);
  if (h2) slab(p, cx, cy, 1, a2, h1, zP, box(PL, seam2, aoTorus), PL);
  // torus (rounded base moulding)
  slab(p, cx, cy, 0, rt, zP, zS0, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return (PL << 8) | 4;
    let t = cylTone(x / rt);
    if (ft === 1) t = Math.min(5, t + 1); else if (fb === 0) t = Math.max(1, t - 1);
    return (PL << 8) | t;
  }, PL);
  // fluted shaft
  const nF = Math.max(8, Math.min(22, 2 * Math.round((TAU * rs) / 7)));
  const flute = new Uint8Array(G.W);
  for (let f = 0; f < nF / 2; f++) {
    const th = -Math.PI / 2 + (f + 0.5) * (TAU / nF), x = rs * Math.sin(th);
    if (Math.abs(x) <= rs * 0.84) flute[AX + Math.round(x)] = 1;
  }
  slab(p, cx, cy, 0, rs, zS0, zS1, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return (SH << 8) | 4;
    let t = cylTone(x / rs);
    const inF = z > zS0 + 1.5 && z < zS1 - 3;
    if (flute[i] && inF) t = Math.max(1, t - 1);
    else if (flute[i - 1] && x < 0 && inF) t = Math.min(5, t + 1);
    if (fb === 0 || (z > zS1 - 2.5 && z <= zS1 - 1.5)) t = Math.max(1, t - 1);
    return (SH << 8) | t;
  }, SH);
  // echinus: a flared cushion under the abacus, built from thin rings
  for (let s = 0; s < he; s++) {
    const f = (s + 1) / he, r = rs + (re - rs) * Math.sin((f * Math.PI) / 2);
    slab(p, cx, cy, 0, r, zS1 + s, zS1 + s + 1, (kind, m, x) => {
      let t = kind === 0 ? 4 : cylTone(x / r);
      if (kind === 1) {
        if (s === he - 1) t = Math.max(1, t - 1);
        else if (s < he - 2 || he <= 3) t = Math.min(5, t + 1);
      }
      return (CA << 8) | t;
    }, CA);
  }
  // abacus
  slab(p, cx, cy, 1, aa, zTop - ha, zTop, box(CA, null, null), CA);
  depthEdges(p, 4);

  // ── wear: chipped corners, cracks down the shaft ──
  const span = (j) => { let a = -1, b = -1; for (let i = 0; i < p.w; i++) if (p.mat(i, j)) { if (a < 0) a = i; b = i; } return [a, b]; };
  let jTop = 0;
  while (jTop < p.h && span(jTop)[0] < 0) jTop++;
  const chip = (i, j, dir, size) => {
    p.erase(i, j);
    if (size > 1) { p.erase(i + dir, j); p.erase(i, j + 1); }
    if (size > 2) { p.erase(i + 2 * dir, j); p.erase(i, j + 2); p.erase(i + dir, j + 1); }
  };
  const [tl, tr] = span(jTop);
  if (rn() < 0.7) chip(tl, jTop, 1, R > 16 ? rn.int(1, 3) : rn.int(1, 2));
  if (rn() < 0.45) chip(tr, jTop, -1, R > 16 ? rn.int(1, 2) : 1);
  const jAbBot = Math.floor(cy + aa * SQ - (zTop - ha) - 1e-4);
  if (rn() < 0.5) { const [l, r] = span(jAbBot); const left = rn() < 0.5; chip(left ? l : r, jAbBot, left ? 1 : -1, 1); }
  const jPl = Math.floor(cy + a1 * SQ - h1 + 0.5);
  if (rn() < 0.6) { const [l, r] = span(jPl); const left = rn() < 0.5; chip(left ? l : r, jPl, left ? 1 : -1, R > 14 ? 2 : 1); }
  if (R >= 12 && rn() < 0.55) {
    const left = rn() < 0.5, z = zS0 + (zS1 - zS0) * rn.range(0.25, 0.8), hgt = rn.int(2, R > 24 ? 4 : 3);
    const j0 = Math.floor(cy - z);
    for (let q = 0; q < hgt; q++) {
      const [l, r] = span(j0 + q);
      if (l < 0) continue;
      const depth = q === 0 || q === hgt - 1 ? 1 : R > 24 ? 2 : 1;
      for (let e = 0; e < depth; e++) p.erase(left ? l + e : r - e, j0 + q);
    }
  }
  const nC = R < 14 ? rn.int(0, 1) : rn.int(1, 2);
  for (let c = 0; c < nC; c++) {
    const x = Math.round(rn.range(-0.5, 0.45) * rs);
    const yf = Math.sqrt(Math.max(0, rs * rs - x * x));
    const z = zS0 + (zS1 - zS0) * rn.range(0.35, 0.92);
    let i = AX + x, j = Math.floor(cy + yf * SQ - z);
    const len = rn.int(3, Math.max(4, Math.round((zS1 - zS0) * 0.28)));
    for (let s = 0; s < len; s++) {
      if (p.mat(i, j) !== SH || p.mat(i - 1, j) !== SH || p.mat(i + 1, j) !== SH) break;
      p.setTone(i, j, 1);
      if (p.tone(i + 1, j) >= 2 && p.tone(i + 1, j) < 5 && rn() < 0.6) p.setTone(i + 1, j, p.tone(i + 1, j) + 1);
      j++;
      const r = rn();
      if (r < 0.22) i--; else if (r < 0.44) i++;
    }
  }
  outline(p, mats);

  // ── floor decal: contact shadow + rubble ──
  const DG = area(R * 1.5 + 4, R * 0.9 + 4, R * 0.9 + 6);
  const d = new Dec(DG.W, DG.H);
  dShadow(d, DG.cx + R * 0.16, DG.cy + R * 0.1, R * 1.1 + 1, R * 0.56 + 1, 0.36, [6, 8, 16]);
  const rub = [rgb('#b8c0d0'), rgb('#8a93a8'), rgb('#5a6278'), rgb('#151822')];
  const nR = R < 14 ? rn.int(0, 1) : rn.int(1, 3);
  for (let q = 0; q < nR; q++) {
    const an = rn.range(0.12, 0.88) * Math.PI, dist = rn.range(1.04, 1.2);
    const s = R > 22 ? rn.int(2, 3) : 2;
    dPebble(d, Math.round(DG.cx + Math.cos(an) * R * dist), Math.round(DG.cy + Math.sin(an) * R * 0.62 * dist), s + 1, s, rub, rn);
  }
  return finish([p], mats, G, d, DG, 0);
}

// ═════════════════════════════════════════════════════════════════════════════
//  LAVA — chunky faceted basalt boulders with glowing magma veins
// ═════════════════════════════════════════════════════════════════════════════
// convex faceted boulder: steep planar sides, a tilted flat top (or a peak)
function boulder(rn, bx, by, b, H, n, peak) {
  const dirs = [], sl = [], bb = [];
  const rot = rn() * TAU;
  for (let k = 0; k < n; k++) {
    const an = rot + (k / n) * TAU + rn.range(-0.28, 0.28);
    dirs.push(Math.cos(an), Math.sin(an));
    const bk = b * rn.range(0.82, 1.06);
    bb.push(bk);
    sl.push((H * (peak ? rn.range(0.95, 1.1) : rn.range(1.5, 2.1))) / bk);
  }
  const tx = rn.range(-0.5, 0.5) * (H / b) * 0.3, ty = rn.range(-0.4, 0.2) * (H / b) * 0.3;
  const reach2 = (b * 1.08 + 0.5) * (b * 1.08 + 0.5) / Math.pow(Math.cos(Math.PI / n), 2);
  return (x, y) => {
    const dx = x - bx, dy = y - by;
    if (dx * dx + dy * dy > reach2) return -1;
    let v = peak ? 1e9 : H + tx * dx + ty * dy;
    for (let k = 0; k < n; k++) {
      const q = sl[k] * (bb[k] - (dx * dirs[2 * k] + dy * dirs[2 * k + 1]));
      if (q < v) v = q;
    }
    return v;
  };
}

function buildLava(R, seed) {
  const rn = stream(seed, 22);
  const ROCK = 1, MAG = 2, WARM = 3;
  const mats = [null,
    { pal: pal('#1d1619', '#2a2226', '#3d3236', '#55474d', '#76646b'), ol: C('#0b0708'), pr: 3 },
    { pal: pal('#9a2e10', '#ff6a1e', '#ffb347', '#fff0a0'), ol: C('#0b0708'), pr: 1 },
    { pal: pal('#4a2420', '#6a3224', '#8c4526', '#b0582a'), ol: C('#0b0708'), pr: 2 },
  ];
  const vis = clamp(Math.round(rn.range(0.82, 1.06) * 2 * R), 12, 96);
  const mainH = Math.max(6, vis - R * SQ * 1.25);
  const parts = [boulder(rn, rn.range(-0.1, 0.1) * R, -R * 0.14, R * 0.62, mainH, rn.int(6, 8), false)];
  const nS = R < 12 ? 2 : R < 20 ? 3 : R < 30 ? 4 : 5;
  const slots = [[178, 0.56], [4, 0.56], [128, 0.52], [54, 0.52], [210, 0.5], [-30, 0.5]];
  const off = rn.int(0, 1);
  for (let s = 1; s < nS; s++) {
    const [deg, dist] = slots[(s - 1 + off) % slots.length];
    const an = (deg + rn.range(-16, 16)) * (Math.PI / 180);
    const peak = s === 1 && R >= 18 && rn() < 0.55;
    const b = R * (peak ? rn.range(0.26, 0.32) : rn.range(0.3, 0.42));
    const dd = Math.min(R * dist, R - b * 0.9);
    const h = mainH * (peak ? rn.range(0.7, 0.85) : rn.range(0.32, 0.6) * (s > 2 ? 0.8 : 1));
    parts.push(boulder(rn, Math.cos(an) * dd, Math.sin(an) * dd, b, h, rn.int(5, 7), peak));
  }
  const hf = (x, y) => {
    let v = -1;
    for (const f of parts) { const q = f(x, y); if (q > v) v = q; }
    return v > 0.4 ? v : -1;
  };
  const G = area(R + 3, vis + 4, R * SQ + 3);
  const p = new Pix(G.W, G.H);
  const { cx, cy } = G;
  renderHF(p, cx, cy, { x0: -R - 2, x1: R + 2, y0: -R - 2, y1: R + 2, mat: ROCK }, hf, (kind, m, x, y, z, nx, ny, nz) => {
    const I = lit(nx, ny, nz);
    return (ROCK << 8) | (I > 0.66 ? 3 : I > 0.4 ? 2 : I > 0.12 ? 1 : 0);
  });
  depthEdges(p, 4);
  despeckle(p, ROCK);
  // crisp highlight along the top edges of the silhouette
  const rim = [];
  for (let j = 1; j < p.h; j++) for (let i = 0; i < p.w; i++) if (p.mat(i, j) === ROCK && !p.mat(i, j - 1) && p.tone(i, j) >= 1) rim.push([i, j]);
  for (const [i, j] of rim) p.setTone(i, j, Math.min(4, p.tone(i, j) + 1));
  // basalt grain: a few pits and glints inside the faces
  const gsd = hash3(seed, 22, 9);
  for (let j = 1; j < p.h - 1; j++) {
    for (let i = 1; i < p.w - 1; i++) {
      if (p.mat(i, j) !== ROCK || p.mat(i - 1, j) !== ROCK || p.mat(i + 1, j) !== ROCK || p.mat(i, j - 1) !== ROCK || p.mat(i, j + 1) !== ROCK) continue;
      const h = hrand(gsd, i, j), t = p.tone(i, j);
      if (h < 0.03 && t >= 1) p.setTone(i, j, t - 1);
      else if (h > 0.985 && t >= 1 && t <= 2) p.setTone(i, j, t + 1);
    }
  }
  // underglow: the rock's lowest pixels are lit orange by the lava around the base
  let jMin = p.h, jMax = 0;
  for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) if (p.mat(i, j)) { if (j < jMin) jMin = j; if (j > jMax) jMax = j; }
  const under = [];
  for (let j = jMin; j <= jMax; j++) {
    for (let i = 0; i < p.w; i++) {
      if (p.mat(i, j) !== ROCK || p.mat(i, j + 1)) continue;
      if (j < jMax - R * 0.62) continue;
      under.push([i, j, 1]);
      if (p.mat(i, j - 1) === ROCK && R >= 14) under.push([i, j - 1, 0]);
    }
  }

  // magma veins: random walks upward through the rock interior
  const interior = (i, j) => p.mat(i, j) === ROCK && p.mat(i - 1, j) === ROCK && p.mat(i + 1, j) === ROCK && p.mat(i, j - 1) === ROCK && p.mat(i, j + 1) === ROCK;
  const cand = [];
  for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) if (interior(i, j) && j > jMin + (jMax - jMin) * 0.4 && j < jMax - 1) cand.push([i, j]);
  const veins = [];
  const used = new Set();
  const nV = R < 13 ? 1 : R < 22 ? 2 : 3;
  const walk = (i, j, len, dir, depth) => {
    const path = [];
    for (let s = 0; s < len; s++) {
      if (!interior(i, j) || used.has(j * p.w + i)) break;
      used.add(j * p.w + i);
      path.push([i, j]);
      if (depth === 0 && s > 2 && rn() < 0.12 && veins.length < 8) {
        const b = walk(i + (rn() < 0.5 ? -1 : 1), j - 1, rn.int(2, Math.max(3, len >> 2)), rn.sign(), 1);
        if (b.length > 1) veins.push({ path: b, ph: rn.int(0, 3) });
      }
      const r = rn();
      if (r < 0.34) i += dir; else if (r < 0.42) i -= dir;
      if (rn() < 0.12) dir = -dir;
      j -= 1;
    }
    return path;
  };
  let cx0 = 1e9, cx1 = -1;
  for (const [i] of cand) { if (i < cx0) cx0 = i; if (i > cx1) cx1 = i; }
  for (let v = 0; v < nV && cand.length; v++) {
    const lo = cx0 + ((cx1 - cx0 + 1) * v) / nV, hi = cx0 + ((cx1 - cx0 + 1) * (v + 1)) / nV;
    const bin = cand.filter(([i]) => i >= lo && i < hi);
    const pool = bin.length ? bin : cand;
    const [i, j] = pool[Math.floor(rn() * pool.length)];
    const path = walk(i, j, Math.round(rn.range(0.45, 0.8) * vis), rn.sign(), 0);
    if (path.length > 2) veins.push({ path, ph: rn.int(0, 3) });
  }
  outline(p, mats);
  const phase = seed & 3;
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const q = p.clone();
    const ff = (f + phase) & 3;
    const pulse = [0, 1, 2, 1][ff];
    for (const [i, j, lv] of under) q.set(i, j, WARM, Math.min(3, lv + (pulse >> 1) + (lv ? 1 : 0)));
    const glow = [];
    for (const v of veins) {
      v.path.forEach(([i, j], s) => {
        const ph = ((((s + v.ph * 2) / 6 - ff / 4) % 1) + 1) % 1;
        const t = ph < 0.2 ? 3 : ph < 0.5 ? 2 : 1;
        q.set(i, j, MAG, t);
        if (R >= 14) glow.push([i - 1, j, t], [i + 1, j, t]);
      });
    }
    for (const [i, j, t] of glow) if (q.mat(i, j) === ROCK) q.set(i, j, WARM, t >= 3 ? 2 : t === 2 ? 1 : 0);
    frames.push(q);
  }

  // ── floor decal: heat glow, dark contact shadow, molten pools, glowing cracks ──
  const DG = area(R * 1.6 + 6, R * 0.9 + 6, R * 0.9 + 8);
  const d = new Dec(DG.W, DG.H);
  const O1 = rgb('#ff6a1e'), O2 = rgb('#ffb347'), O3 = rgb('#fff0a0'), O0 = rgb('#9a2e10');
  for (let g = 3; g >= 1; g--) dEllipse(d, DG.cx, DG.cy + 0.5, R + 1 + g * 2.2, R * SQ + 1 + g * 1.3, O1, 0.07 + (3 - g) * 0.03);
  dShadow(d, DG.cx + R * 0.1, DG.cy + R * 0.05, R * 0.98, R * SQ + 0.8, 0.42, [10, 4, 4]);
  const nP = R < 14 ? 2 : rn.int(3, 4);
  for (let q = 0; q < nP; q++) {
    const an = rn.range(0.12, 0.88) * Math.PI;
    const px = DG.cx + Math.cos(an) * R * 0.94, py = DG.cy + Math.sin(an) * R * SQ + 1.2;
    const rx = rn.range(1.5, Math.max(2, R * 0.16)), ry = Math.max(1, rx * 0.45);
    for (let j = Math.floor(py - ry) - 1; j <= Math.ceil(py + ry) + 1; j++) {
      for (let i = Math.floor(px - rx) - 1; i <= Math.ceil(px + rx) + 1; i++) {
        const u = (i + 0.5 - px) / rx, v = (j + 0.5 - py) / ry, qd = u * u + v * v;
        if (qd > 1.35) continue;
        d.over(i, j, qd > 1 ? O0 : qd > 0.55 ? O1 : qd > 0.15 || rx < 2.5 ? O2 : O3, 1);
      }
    }
  }
  const nK = R < 14 ? 2 : rn.int(3, 4);
  for (let c = 0; c < nK; c++) {
    const an = rn.range(0.25, Math.PI - 0.25);
    let x = DG.cx + Math.cos(an) * R * 0.92, y = DG.cy + Math.sin(an) * R * SQ + 1;
    const len = rn.int(3, Math.max(4, Math.round(R * 0.3)));
    let dx = Math.cos(an) * 0.8, dy = Math.sin(an) * 0.55;
    for (let s = 0; s < len; s++) {
      d.over(Math.floor(x), Math.floor(y), s < 2 ? O2 : s < len - 1 ? O1 : O0, 1);
      if (rn() < 0.35) { const t = dx; dx = dx * 0.8 - dy * 0.6 * rn.sign(); dy = dy * 0.8 + t * 0.3; }
      x += dx; y += dy;
    }
  }
  return finish(frames, mats, G, d, DG, 6);
}

// ═════════════════════════════════════════════════════════════════════════════
//  FROST — cluster of hexagonal ice crystals rising from lumpy snow
// ═════════════════════════════════════════════════════════════════════════════
function buildFrost(R, seed) {
  const rn = stream(seed, 33);
  const ICE = 1, SNOW = 2, GL = 3;
  const mats = [null,
    { pal: pal('#2a5a8a', '#4a8fc4', '#7fc8ee', '#bff4ff', '#e8fbff', '#ffffff'), ol: C('#10264a'), pr: 3 },
    { pal: pal('#8db4d6', '#b6d6ec', '#ddf0fa', '#f7fcff'), ol: null, pr: 2 },          // snow: soft, no outline
    { pal: pal('#ffffff', '#bff4ff'), ol: null, pr: 0 },
  ];
  const vis = Math.min(98, Math.round(rn.range(1.32, 1.72) * 2 * R));
  const G = area(R * 1.35 + 3, vis + 4, R * SQ + 3);
  const p = new Pix(G.W, G.H);
  const { cx, cy } = G;

  // crystal layout
  const rc0 = Math.max(2.4, R * 0.26);
  const zTop = vis - R * SQ * 0.4;
  const tip0 = rc0 * 1.7;
  const list = [{ P: [rn.range(-0.08, 0.08) * R, -R * 0.12, -1], dir: [rn.range(-0.12, 0.12), -0.05, 1], rc: rc0, len: zTop - tip0 + 1, tip: tip0, rot: rn() < 0.5 ? Math.PI / 6 : rn() * TAU }];
  const nC = R < 13 ? rn.int(2, 3) : R < 22 ? rn.int(3, 5) : rn.int(5, 7);
  const angs = [196, -16, 140, 40, 100, 250, 290];
  const shift = rn.int(0, 1);
  for (let c = 1; c < nC; c++) {
    const an = ((angs[(c - 1 + shift) % angs.length] + rn.range(-14, 14)) * Math.PI) / 180;
    const dist = R * rn.range(0.34, 0.56);
    const tilt = rn.range(0.35, 0.75);
    const rc = rc0 * rn.range(0.5, 0.78);
    const len = (zTop - tip0) * rn.range(0.3, 0.62) * (c > 2 ? 0.8 : 1);
    const behind = Math.sin(an) < -0.2;                        // shards at the back sit in deeper shade
    list.push({ P: [Math.cos(an) * dist, Math.sin(an) * dist, -1], dir: [Math.cos(an) * tilt, Math.sin(an) * tilt * 0.8, 1], rc, len, tip: rc * rn.range(1.4, 2), rot: rn() * TAU, bias: behind || rn() < 0.25 ? -1 : 0 });
  }
  // lumpy snow: a low central drift plus a small heap around each crystal's foot
  const hs = Math.max(1.8, R * 0.15);
  const mounds = [{ x: 0, y: -R * 0.05, r: R * 0.8, h: hs }];
  for (const c of list) mounds.push({ x: c.P[0], y: c.P[1], r: c.rc * 2 + 2, h: c.rc * 0.6 + 0.8 });
  const rimN = ringNoise(hash3(seed, 5, 1), 8);
  let reachS = 0;
  for (const m of mounds) reachS = Math.max(reachS, len2(m.x, m.y) + m.r * 1.13);
  renderHF(p, cx, cy, { x0: -R * 1.2, x1: R * 1.2, y0: -R * 1.2, y1: R * 1.2, mat: SNOW }, (x, y) => {
    if (x * x + y * y > reachS * reachS) return -1;
    const wob = 1 + 0.12 * rimN(Math.atan2(y, x));
    let v = 0;
    for (const m of mounds) {
      const dx = x - m.x, dy = y - m.y, q = (dx * dx + dy * dy) / (m.r * m.r * wob * wob);
      if (q < 1) v += m.h * (1 - q) * (1 - q);
    }
    return v > 0.35 ? Math.min(v, hs * 2.2) : -1;
  }, (kind, m, x, y, z, nx, ny, nz) => {
    const I = lit(nx, ny, nz);
    return (SNOW << 8) | (kind === 1 ? 1 : I > 0.68 ? 3 : I > 0.5 ? 2 : I > 0.25 ? 1 : 0);
  });

  const toneN = (n) => { const I = lit(n[0], n[1], n[2]); return I > 0.74 ? 4 : I > 0.5 ? 3 : I > 0.2 ? 2 : I > -0.12 ? 1 : 0; };
  const prism = (P, dir, rc, len, tip, rot, bias = 0) => {
    const d = norm3(dir[0], dir[1], dir[2]);
    const e1 = norm3(-d[2], 0, d[0]);
    const e2 = cross3(d, e1);
    const r0 = [], r1 = [];
    for (let k = 0; k < 6; k++) {
      const a = rot + (k * Math.PI) / 3, ca = Math.cos(a) * rc, sa = Math.sin(a) * rc;
      const o = [e1[0] * ca + e2[0] * sa, e1[1] * ca + e2[1] * sa, e1[2] * ca + e2[2] * sa];
      r0.push([P[0] + o[0], P[1] + o[1], P[2] + o[2]]);
      r1.push([P[0] + o[0] + d[0] * len, P[1] + o[1] + d[1] * len, P[2] + o[2] + d[2] * len]);
    }
    const T = [P[0] + d[0] * (len + tip), P[1] + d[1] * (len + tip), P[2] + d[2] * (len + tip)];
    for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6, am = rot + ((k + 0.5) * Math.PI) / 3;
      const n = [e1[0] * Math.cos(am) + e2[0] * Math.sin(am), e1[1] * Math.cos(am) + e2[1] * Math.sin(am), e1[2] * Math.cos(am) + e2[2] * Math.sin(am)];
      if (n[1] + 0.45 * n[2] > 0.01) {
        const base = Math.max(0, toneN(n) + bias), wpx = Math.abs(r0[k2][0] - r0[k][0]);
        // a lighter bevel along the face's lit edge + a faint inner streak on wide faces
        const sh = (u, v) => {
          let t = base;
          if (wpx >= 2.5 && u > 1 - 1.1 / wpx) t = Math.min(4, t + 1);
          else if (wpx >= 4.5 && u > 0.3 && u < 0.3 + 1.1 / wpx && v > 0.15 && v < 0.85) t = Math.min(4, t + 1);
          return (ICE << 8) | t;
        };
        tri3(p, cx, cy, r0[k], r0[k2], r1[k2], (w0, w1, w2) => sh(w1 + w2, w2));
        tri3(p, cx, cy, r0[k], r1[k2], r1[k], (w0, w1, w2) => sh(w1, w1 + w2));
      }
      let tn = cross3([r1[k2][0] - r1[k][0], r1[k2][1] - r1[k][1], r1[k2][2] - r1[k][2]], [T[0] - r1[k][0], T[1] - r1[k][1], T[2] - r1[k][2]]);
      tn = norm3(tn[0], tn[1], tn[2]);
      if (tn[0] * n[0] + tn[1] * n[1] + tn[2] * n[2] < 0) tn = [-tn[0], -tn[1], -tn[2]];
      if (tn[1] + 0.45 * tn[2] > 0.01) {
        const t = Math.max(0, Math.min(4, toneN(tn) + 1 + bias));
        tri3(p, cx, cy, r1[k], r1[k2], T, () => (ICE << 8) | t);
      }
    }
  };
  for (const c of list) prism(c.P, c.dir, c.rc, c.len, c.tip, c.rot, c.bias || 0);
  depthEdges(p, 4, ICE);
  despeckle(p, ICE);
  // crisp rim light on the top-left silhouette of the crystals
  const rim = [];
  for (let j = 1; j < p.h - 1; j++) {
    for (let i = 1; i < p.w - 1; i++) {
      if (p.mat(i, j) !== ICE) continue;
      const up = p.mat(i, j - 1), lf = p.mat(i - 1, j);
      if ((up === 0 || up === SNOW) && (lf === 0 || lf === SNOW || p.tone(i, j) >= 3)) rim.push([i, j]);
    }
  }
  for (const [i, j] of rim) if (p.tone(i, j) >= 2) p.setTone(i, j, Math.min(5, p.tone(i, j) + 1));
  outline(p, mats);
  // sparkle on the main crystal's lit edge (twinkles; phase from the seed)
  const m0 = list[0], d0 = norm3(m0.dir[0], m0.dir[1], m0.dir[2]), ts = m0.len * 0.74;
  const sj = Math.floor(cy + (m0.P[1] + d0[1] * ts) * SQ - (m0.P[2] + d0[2] * ts));
  let si = Math.floor(cx + m0.P[0] + d0[0] * ts);
  while (p.mat(si - 1, sj) === ICE) si--;
  si -= 1;                                                   // on the outline, so the star reads against the dark
  const phase = seed & 3;
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const q = p.clone();
    const s = [0, 1, 2, 1][(f + phase) & 3];
    if (s) {
      q.set(si, sj, GL, 0);
      for (let a = 1; a <= s; a++) {
        const tt = a === 2 ? 1 : 0;
        q.set(si + a, sj, GL, tt); q.set(si - a, sj, GL, tt); q.set(si, sj + a, GL, tt); q.set(si, sj - a, GL, tt);
      }
    }
    frames.push(q);
  }

  // ── floor decal: a flat, ragged snow drift + bluish shadow + loose ice chips ──
  const DG = area(R * 1.6 + 6, R * 0.9 + 6, R * 0.95 + 8);
  const d = new Dec(DG.W, DG.H);
  const sN = ringNoise(hash3(seed, 9, 2), 11);
  const S0 = rgb('#a3c8e2'), S1 = rgb('#c6e0f1'), S2 = rgb('#e2f3fc');
  const rx = R * 1.08, ry = R * 0.54, oy = R * 0.06;
  for (let j = 0; j < DG.H; j++) {
    for (let i = 0; i < DG.W; i++) {
      const dx = (i + 0.5 - DG.cx) / rx, dy = (j + 0.5 - DG.cy - oy) / ry;
      if (dx * dx + dy * dy > 1.44) continue;
      const q = len2(dx, dy) / (1 + 0.2 * sN(Math.atan2(dy, dx)));
      if (q > 1) continue;
      const edge = q > 1 - 1.4 / ry;
      if (edge && hrand(seed, i, j) < 0.2) continue;
      d.over(i, j, edge ? S0 : dx < -0.15 && dy < 0.35 ? S2 : S1, 1);
    }
  }
  for (let s = 0; s < (R < 14 ? 2 : 4); s++) {
    const an = rn.range(0, TAU), rr = rn.range(1.08, 1.3);
    d.over(Math.floor(DG.cx + Math.cos(an) * rx * rr), Math.floor(DG.cy + oy + Math.sin(an) * ry * rr), S1, 1);
  }
  dShadow(d, DG.cx + R * 0.2, DG.cy + R * 0.12, R * 1.0, R * SQ + 1, 0.3, [20, 50, 90]);
  const chips = [rgb('#e8fbff'), rgb('#bff4ff'), rgb('#7fc8ee'), rgb('#3a78b0')];
  const nI = R < 14 ? 1 : rn.int(2, 3);
  for (let c = 0; c < nI; c++) {
    const an = rn.range(0.15, 0.85) * Math.PI;
    const s = rn.int(1, 2);
    dPebble(d, Math.round(DG.cx + Math.cos(an) * R * rn.range(1.05, 1.3)), Math.round(DG.cy + Math.sin(an) * R * 0.66), s + 1, s, chips, rn);
  }
  return finish(frames, mats, G, d, DG, 4);
}

// ═════════════════════════════════════════════════════════════════════════════
//  NEON — dark metal pylon with emissive strips, rings, a lit cap and an orb
// ═════════════════════════════════════════════════════════════════════════════
function octFace(x, y) {
  // -2 left, -1 front-left, 0 front, 1 front-right, 2 right (the faces we can see)
  const ax = Math.abs(x), ay = Math.abs(y), dg = (ax + ay) / Math.SQRT2;
  if (ay >= ax && ay >= dg) return 0;
  if (ax >= dg) return x < 0 ? -2 : 2;
  return x < 0 ? -1 : 1;
}
function buildNeon(R, seed) {
  const MET = 1, CY = 2, MG = 3;
  const mats = [null,
    { pal: pal('#0e0b1a', '#1c1830', '#2c2648', '#3d3566', '#5a4f8a'), ol: C('#05030b'), pr: 3 },
    { pal: pal('#123848', '#1c7c9c', '#3ff2ff', '#b8ffff', '#ffffff'), ol: C('#05030b'), pr: 2 },
    { pal: pal('#3a1036', '#8a2078', '#ff3fd0', '#ffb8ee', '#ffffff'), ol: C('#05030b'), pr: 1 },
  ];
  const rn = stream(seed, 44);
  const faceTone = [3, 3, 2, 1, 0];                 // by face index + 2
  const vis = Math.min(R >= 40 ? 104 : 98, Math.round(2.05 * (2 * R + 2)));
  const a1 = R, h1 = Math.max(3, Math.round(R * 0.15));
  const a2 = Math.max(3, Math.round(R * 0.8)), h2 = Math.max(1, Math.round(R * 0.055));
  const ac = Math.max(3, Math.round(R * 0.4 - Math.max(0, R - 24) * 0.12));
  const acap = Math.round(ac * (R > 30 ? 1.36 : 1.5) + 1), hcap = Math.max(2, Math.round(R * 0.11));
  const orbS = R >= 12 ? Math.max(3, Math.round(R * 0.17)) : 0;
  const zCapTop = Math.round(vis - R * SQ - (orbS ? orbS * 2.6 + 3 : acap * SQ));
  const zC0 = h1 + h2, zC1 = zCapTop - hcap;
  const G = area(R + 2, vis + 4, R * SQ + 3);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX } = G;
  const nRings = Math.max(1, (zC1 - zC0 > 44 ? 3 : zC1 - zC0 > 20 ? 2 : 1) - (rn() < 0.3 ? 1 : 0) + (zC1 - zC0 > 30 && rn() < 0.3 ? 1 : 0));
  const topHeavy = rn() < 0.4;                       // rings bunched under the cap
  const ringZ = [];
  for (let r = 0; r < nRings; r++) {
    const f = topHeavy ? 1 - (r + 1) * Math.min(0.2, 0.8 / (nRings + 1)) : (r + 1) / (nRings + 1);
    ringZ.push(Math.round(zC0 + f * (zC1 - zC0)));
  }
  const stripW = R >= 20 ? 1 : 0;                    // half-width of the front strip (px)
  const dashed = rn() < 0.4;                         // segmented strip
  const dotGap = rn.int(3, 5);                       // plinth running-light spacing
  const seamX = rn() < 0.5 ? 0.5 : 0.62;             // panel seam position on the plinth top
  // base plinth with a glowing rim and running lights
  slab(p, cx, cy, 2, a1, 0, h1, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) {
      const ax = Math.abs(x), ay = Math.abs(y), o = Math.max(ax, ay, (ax + ay) / Math.SQRT2);
      if (o > a1 - 1.2) return (MET << 8) | 4;
      if (Math.abs(o - a1 * seamX - a2 * (1 - seamX)) < 0.5) return (MET << 8) | 1;
      return (MET << 8) | 3;
    }
    if (ft === 1) return (CY << 8) | 2;
    let t = faceTone[octFace(x, y) + 2];
    if (fb === 0) t = Math.max(0, t - 1);
    return (MET << 8) | Math.max(0, t - 1);
  }, MET);
  slab(p, cx, cy, 2, a2, h1, zC0, (kind, m, x, y, z, nx, ny, nz, i, j, ft) => {
    if (kind === 0) return (MET << 8) | 3;
    return (MET << 8) | (ft === 1 ? 4 : faceTone[octFace(x, y) + 2]);
  }, MET);
  // column
  slab(p, cx, cy, 2, ac, zC0, zC1, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return (MET << 8) | 3;
    for (const rz of ringZ) if (z >= rz && z < rz + 1) return (MG << 8) | 2;
    if (Math.abs(i - AX) <= stripW && z > zC0 + 1 && z < zC1 - 1 && !(dashed && Math.floor(z - zC0) % 4 === 3)) return (CY << 8) | (i === AX ? 1 : 0);
    let t = faceTone[octFace(x, y) + 2];
    if (fb === 0) t = Math.max(0, t - 1);
    return (MET << 8) | t;
  }, MET);
  // cap
  slab(p, cx, cy, 2, acap, zC1, zCapTop, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) {
      const ax = Math.abs(x), ay = Math.abs(y), o = Math.max(ax, ay, (ax + ay) / Math.SQRT2);
      if (o < acap * 0.36) return (CY << 8) | 4;
      if (o < acap * 0.66) return (CY << 8) | 2;
      return (MET << 8) | (o > acap - 1.2 ? 4 : 3);
    }
    if (fb === 0) return (CY << 8) | 2;
    return (MET << 8) | (ft === 1 ? 4 : faceTone[octFace(x, y) + 2]);
  }, MET);
  depthEdges(p, 4);
  for (let k = 0; k < 8; k++) {
    const an = ((k + 0.5) / 8) * TAU, rr = a1 * 1.0824 * 0.9;
    const i = Math.floor(cx + Math.cos(an) * rr), j = Math.floor(cy + Math.sin(an) * rr * SQ - h1);
    if (p.mat(i, j) === MET && R >= 12) p.set(i, j, CY, 1);
  }
  outline(p, mats);

  // animation: a pulse climbs the strip, rings flash in turn, plinth lights chase, orb bobs
  const phase = seed & 3;
  const frames = [];
  const zSpan = zC1 - zC0;
  const jl = Math.floor(cy + a1 * SQ - h1 * 0.45);
  let orb = null;
  if (orbS) {
    const hh = Math.round(orbS * 1.35), ow = orbS * 2 + 5, oh = hh * 2 + 5;
    orb = new Pix(ow, oh);
    for (let j = -hh; j <= hh; j++) {
      for (let i = -orbS; i <= orbS; i++) {
        const e = Math.abs(i) / (orbS + 0.5) + Math.abs(j) / (hh + 0.5);
        if (e > 1) continue;
        let t = i <= 0 && j <= 0 ? 3 : i > 0 && j > 0 ? 1 : 2;
        if (i === 0 && j === -1) t = 4;
        if (e > 0.78 && t > 1) t -= 1;
        orb.set(orbS + 2 + i, hh + 2 + j, MG, t);
      }
    }
    outline(orb, mats);
    orb.ox = AX - orbS - 2;
    orb.oy = Math.floor(cy - zCapTop - orbS * 1.3 - 2) - hh - 2;
  }
  for (let f = 0; f < 4; f++) {
    const q = p.clone();
    const ff = (f + phase) & 3;
    for (let j = 0; j < q.h; j++) {
      for (let i = AX - stripW; i <= AX + stripW; i++) {
        if (q.mat(i, j) !== CY) continue;
        const z = cy - (j + 0.5) + ac * SQ;
        if (z < zC0 || z > zC1) continue;
        const u = ((((z - zC0) / zSpan - ff / 4) % 1) + 1) % 1;
        const hot = u < 0.1 ? 2 : u < 0.2 ? 1 : 0;
        if (hot) q.setTone(i, j, i === AX ? (hot === 2 ? 4 : 3) : 2);
      }
    }
    // the lit ring cycles
    const lit1 = ff % (nRings + 1);
    if (lit1 < nRings) {
      const rz = ringZ[lit1];
      for (let j = 0; j < q.h; j++) {
        for (let i = AX - ac - 1; i <= AX + ac + 1; i++) {
          if (q.mat(i, j) !== MG) continue;
          const dx = Math.abs(i - AX), yf = dx <= ac * 0.414 ? ac : ac * Math.SQRT2 - dx;
          if (Math.abs(cy - (j + 0.5) + yf * SQ - rz - 0.5) < 1.2) q.setTone(i, j, 3);
        }
      }
    }
    // plinth running lights
    for (let i = AX - a1 + 2; i <= AX + a1 - 2; i++) {
      if (q.mat(i, jl) !== MET) continue;
      const k = i - AX + 1000;
      if (k % dotGap === 0) q.set(i, jl, MG, (Math.floor(k / dotGap) & 1) === (ff & 1) ? 3 : 1);
    }
    if (orb) {
      const bob = [0, 0, -1, -1][ff];
      for (let j = 0; j < orb.h; j++) {
        for (let i = 0; i < orb.w; i++) {
          const v = orb.m[j * orb.w + i];
          if (!v) continue;
          const x = orb.ox + i, y = orb.oy + j + bob;
          if (!q.in(x, y)) continue;
          const kk = y * q.w + x;
          q.m[kk] = v; q.t[kk] = orb.t[j * orb.w + i];
        }
      }
    }
    frames.push(q);
  }

  // ── floor decal: cyan light spill + magenta floor lights ──
  const DG = area(R * 1.6 + 8, R * 0.9 + 8, R * 0.9 + 8);
  const d = new Dec(DG.W, DG.H);
  const CYc = rgb('#3ff2ff'), MGc = rgb('#ff3fd0');
  for (let g = 4; g >= 1; g--) dEllipse(d, DG.cx, DG.cy + 0.5, R + 1 + g * 2, R * SQ + 1 + g * 1.1, CYc, 0.05 + (4 - g) * 0.025);
  dShadow(d, DG.cx, DG.cy + 1, R * 0.96, R * SQ + 0.6, 0.35, [0, 0, 8]);
  for (let k = 0; k < 8; k++) {
    const an = (k / 8) * TAU + Math.PI / 8;
    if (Math.sin(an) < -0.2) continue;
    const x = Math.floor(DG.cx + Math.cos(an) * (R + 4)), y = Math.floor(DG.cy + Math.sin(an) * (R * SQ + 3));
    d.over(x, y, MGc, 1);
    d.over(x - 1, y, MGc, 0.35); d.over(x + 1, y, MGc, 0.35);
  }
  return finish(frames, mats, G, d, DG, 8);
}

// ═════════════════════════════════════════════════════════════════════════════
//  FOREST — a leafy tree with flared roots
// ═════════════════════════════════════════════════════════════════════════════
function buildForest(R, seed) {
  const rn = stream(seed, 55);
  const BARK = 1, LEAF = 2, FR = 3;
  const mats = [null,
    { pal: pal('#241810', '#3d2a19', '#5a3a22', '#7a5232', '#96683e'), ol: C('#160e08'), pr: 1 },
    { pal: pal('#153a1c', '#1f4a26', '#2f6a34', '#4a8f3c', '#7cc050', '#b6e27a'), ol: C('#0c200f'), pr: 2 },
    { pal: pal('#6e1420', '#d8323c', '#ff8a7a', '#fff4f8', '#ffb0d0', '#ffe070'), ol: C('#0c200f'), pr: 0 },
  ];
  const vis = Math.min(108 + Math.max(0, R - 36), Math.round(2.2 * (2 * R + 2)));
  const Rc = Math.min(R * 1.4, R + 10, (vis - R * SQ - Math.max(6, R * 0.3)) / (2 * 0.84));
  const chh = Rc * 0.84;
  const zc = vis - R * SQ - chh;
  const rt = Math.max(3, R * 0.34);
  const G = area(Math.max(R, Rc) + 3, vis + 4, R * SQ + 3);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX } = G;
  // trunk with a flared base and roots
  const roots = [];
  const nr = R < 14 ? 3 : rn.int(4, 5);
  const rot = rn.range(0, TAU);
  for (let k = 0; k < nr; k++) {
    const an = rot + (k / nr) * TAU + rn.range(-0.3, 0.3);
    roots.push({ c: Math.cos(an), s: Math.sin(an), len: R * rn.range(0.88, 1.04), h: rt * rn.range(0.75, 1.1), w: Math.max(1.4, rt * 0.55) });
  }
  const hf = (x, y) => {
    const d = len2(x, y);
    if (d <= rt) return zc;
    let h = d < rt * 1.7 ? rt * 1.5 * Math.pow(1 - (d - rt) / (rt * 0.7), 2) : -1;
    for (const r of roots) {
      const along = x * r.c + y * r.s, perp = Math.abs(-x * r.s + y * r.c);
      if (along < 0 || along > r.len) continue;
      const q = r.h * Math.pow(1 - along / r.len, 1.1) - perp * (r.h / r.w) * 0.9;
      if (q > h) h = q;
    }
    return h > 0.4 ? h : -1;
  };
  const barkN = hash3(seed, 7, 7);
  renderHF(p, cx, cy, { x0: -R - 1, x1: R + 1, y0: -R - 1, y1: R + 1, mat: BARK }, hf, (kind, m, x, y, z, nx, ny, nz, i) => {
    let t;
    if (kind === 1 || len2(x, y) <= rt + 0.3) {
      const u = x / rt;
      t = u < -0.75 ? 3 : u < -0.1 ? 4 : u < 0.35 ? 3 : u < 0.72 ? 2 : 1;
      if (t > 1 && hrand(barkN, i, Math.floor((z + (i % 3) * 2) / 4)) > 0.7 && (i + 1000) % 2 === 0) t--;
      if (z > zc - chh - 3) t = Math.max(0, t - 1);
    } else {
      const I = lit(nx, ny, nz);
      t = I > 0.62 ? 4 : I > 0.4 ? 3 : I > 0.15 ? 2 : 1;
    }
    return (BARK << 8) | t;
  });
  depthEdges(p, 4);
  // canopy clumps (screen space, painter's order: back/top first)
  const balls = [{ x: 0, y: -chh * 0.12, r: Rc * 0.6 }];
  const nRing = Rc > 22 ? rn.int(7, 8) : rn.int(5, 6);
  const r0 = rn() * TAU;
  for (let k = 0; k < nRing; k++) {
    const an = r0 + (k / nRing) * TAU + rn.range(-0.2, 0.2);
    balls.push({ x: Math.cos(an) * Rc * 0.55, y: Math.sin(an) * chh * 0.55, r: Rc * rn.range(0.4, 0.5) });
  }
  balls.push({ x: -Rc * rn.range(0.15, 0.35), y: chh * 0.4, r: Rc * 0.42 }, { x: Rc * rn.range(0.15, 0.35), y: chh * 0.42, r: Rc * 0.4 });
  balls.sort((a, b) => a.y - b.y);
  const leafN = hash3(seed, 3, 3);
  const edgeN = balls.map((b, k) => ringNoise(hash3(seed, 20 + k, 1), 9));
  const LS = norm3(-0.55, -0.62, 0.56);
  const oyC = cy - zc;
  const drawCanopy = (q, dx) => {
    balls.forEach((b, bk) => {
      const bx = cx + b.x + dx, by = oyC + b.y, r = b.r;
      for (let j = Math.floor(by - r) - 1; j <= Math.ceil(by + r) + 1; j++) {
        for (let i = Math.floor(bx - r) - 1; i <= Math.ceil(bx + r) + 1; i++) {
          const ux = (i + 0.5 - bx) / r, uy = (j + 0.5 - by) / r;
          const qd = ux * ux + uy * uy;
          if (qd > 1) continue;
          const lim = qd < 0.84 ? 1 : 1 - 0.14 * (0.5 + 0.5 * edgeN[bk](Math.atan2(uy, ux) * 2.2));
          if (qd > lim) continue;
          const nz = Math.sqrt(Math.max(0, 1 - qd));
          let I = ux * LS[0] + uy * LS[1] + nz * LS[2];
          I -= 0.38 * clamp((j + 0.5 - oyC) / chh, -0.2, 1);
          I += (vnoise(leafN, (i - dx) / 1.7, j / 1.4) - 0.5) * 0.46;
          let t = I > 0.84 ? 5 : I > 0.6 ? 4 : I > 0.36 ? 3 : I > 0.12 ? 2 : I > -0.18 ? 1 : 0;
          if (bk > 0 && qd > lim - 0.16 && ux + uy > 0.35) t = Math.max(0, t - 1);    // clump shadow rim
          q.set(i, j, LEAF, t);
        }
      }
    });
  };
  // fruit / blossoms
  const kind = rn();
  const fruit = [];
  if (R >= 12 && kind < 0.66) {
    const n = rn.int(3, R > 22 ? 7 : 4);
    for (let f = 0; f < n; f++) {
      const an = rn.range(0, TAU), rr = rn.range(0.15, 0.72);
      fruit.push([Math.round(Math.cos(an) * Rc * rr), Math.round(oyC - cy + Math.sin(an) * chh * rr)]);
    }
  }
  // the canopy is rendered once into its own layer, then composited with a 1 px sway
  const cl = new Pix(p.w, p.h);
  drawCanopy(cl, 0);
  for (const [fx, fy] of fruit) {
    const i = AX + fx, j = Math.floor(cy + fy);
    if (cl.mat(i, j) !== LEAF || cl.mat(i + 1, j + 1) !== LEAF) continue;
    if (kind < 0.36) { cl.set(i, j, FR, 2); cl.set(i + 1, j, FR, 1); cl.set(i, j + 1, FR, 1); cl.set(i + 1, j + 1, FR, 0); }
    else { cl.set(i, j, FR, 3); cl.set(i + 1, j, FR, 4); cl.set(i, j + 1, FR, 4); cl.set(i + 1, j + 1, FR, 5); }
  }
  despeckle(cl, LEAF);
  const frames = [];
  for (let f0 = 0; f0 < 2; f0++) {
    const f = (f0 + seed) & 1;                        // odd seeds sway in counter-phase
    const q = p.clone();
    for (let j = 0; j < cl.h; j++) {
      for (let i = 0; i < cl.w - 1; i++) {
        const k = j * cl.w + i;
        if (cl.m[k]) { const kk = k + f; q.m[kk] = cl.m[k]; q.t[kk] = cl.t[k]; }
      }
    }
    outline(q, mats);
    frames.push(q);
  }

  // ── floor decal: dappled canopy shadow, leaves, grass tufts ──
  const DG = area(Math.max(R, Rc) * 1.25 + 6, R * 0.9 + 6, R * 0.9 + 8);
  const d = new Dec(DG.W, DG.H);
  const scx = DG.cx + Rc * 0.18, scy = DG.cy + R * 0.18;
  for (let j = 0; j < DG.H; j++) {
    for (let i = 0; i < DG.W; i++) {
      const dx = (i + 0.5 - scx) / (Rc * 1.02), dy = (j + 0.5 - scy) / (Rc * 0.52);
      const qd = dx * dx + dy * dy;
      if (qd > 1) continue;
      const hole = hrand(seed, (i >> 1) + 50, (j >> 1) + 50) > 0.9;
      d.over(i, j, [6, 20, 8], hole ? 0.1 : qd > 0.8 ? 0.2 : 0.32);
    }
  }
  const leafC = [rgb('#7cc050'), rgb('#4a8f3c'), rgb('#b6e27a'), rgb('#2f6a34')];
  const nL = R < 14 ? 2 : rn.int(3, 6);
  for (let l = 0; l < nL; l++) {
    const x = Math.floor(DG.cx + rn.range(-1.2, 1.2) * Rc), y = Math.floor(DG.cy + rn.range(-0.2, 0.9) * R * 0.7);
    d.over(x, y, leafC[rn.int(0, 2)], 1);
    if (rn() < 0.6) d.over(x + 1, y, leafC[3], 1);
  }
  const tuft = rgb('#4a8f3c'), tuftD = rgb('#2f6a34');
  const nT = R < 14 ? 2 : rn.int(3, 4);
  for (let t = 0; t < nT; t++) {
    const an = rn.range(0.05, 0.95) * Math.PI;
    const x = Math.floor(DG.cx + Math.cos(an) * R * rn.range(0.9, 1.1)), y = Math.floor(DG.cy + Math.sin(an) * R * 0.6);
    d.over(x, y, tuftD, 1); d.over(x - 1, y - 1, tuft, 1); d.over(x + 1, y - 1, tuft, 1); d.over(x, y - 2, tuft, 1);
  }
  return finish(frames, mats, G, d, DG, 1.5);
}

// ═════════════════════════════════════════════════════════════════════════════
//  DESERT — broken sandstone column, carved glyphs, half-buried in a drift
// ═════════════════════════════════════════════════════════════════════════════
const GLYPHS = [
  ['.#.', '#.#', '.#.', '.#.'],
  ['#..', '##.', '#.#', '#..'],
  ['...', '#.#', '.#.', '...'],
  ['###', '...', '###', '...'],
  ['.#.', '###', '.#.', '#.#'],
  ['##.', '#.#', '##.', '#..'],
  ['#.#', '###', '#.#', '...'],
  ['.#.', '#.#', '#.#', '.#.'],
];
function buildDesert(R, seed) {
  const rn = stream(seed, 66);
  const SS = 1, SAND = 2;
  const mats = [null,
    { pal: pal('#4e3a24', '#6a5034', '#9a7a50', '#c9a878', '#e8c89a', '#f6e2bc'), ol: C('#2e2012'), pr: 2 },
    { pal: pal('#654b30', '#7c603f', '#94764e', '#ab8b5d'), ol: null, pr: 1 },   // sand: no outline, it melts into the floor
  ];
  const rs = R * rn.range(0.56, 0.64);
  const vis = Math.min(96, Math.round(rn.range(1.0, 1.8) * 2 * R));
  const Hb = Math.max(6, vis - R * SQ - rs * SQ - 1);
  const gx = rn.range(0.25, 0.7) * rn.sign(), gy = rn.range(-0.35, 0.15);
  const A = Math.max(1.5, rs * 0.26);
  const nX = rn.range(-0.5, 0.5) * rs, nW = rs * rn.range(0.35, 0.6), nD = rs * rn.range(0.4, 0.9);
  const bn = hash3(seed, 12, 1);
  const brk = (x, y) => {
    let h = Hb - Math.abs(gx) * rs * 0.5 + gx * x + gy * y;
    h += A * (vnoise(bn, x / 4.5 + 10, y / 4.5 + 10) - 0.5) * 2 + (vnoise(bn + 1, x / 2 + 3, y / 2 + 3) - 0.5) * 1.6;
    h -= nD * Math.max(0, 1 - Math.abs(x - nX) / nW);
    return h;
  };
  // sand piled up against the column: a low skirt plus a ramp hugging the stone,
  // higher on the windward side, with a ragged edge that melts into the floor
  const hs = Math.max(2, R * rn.range(0.26, 0.34));
  const wind = rn.sign();
  const sN = ringNoise(hash3(seed, 13, 2), 7);
  const sand = (x, y) => {
    const dx = x - wind * R * 0.1, dy = y - R * 0.03;
    const d = len2(dx, dy) / (R * 0.88 * (1 + 0.14 * sN(Math.atan2(dy, dx))));
    if (d >= 1) return -1;
    const dc = Math.max(0, len2(x, y) - rs);
    const ramp = Math.max(0, 1 - dc / (R * 0.36));
    const h = hs * (0.32 * Math.pow(1 - d * d, 1.2) + 0.85 * ramp * ramp) * (1 + 0.4 * wind * clamp(x / R, -1, 1));
    return h < 0.3 ? -1 : h;
  };
  const rip = hash3(seed, 14, 4);
  // an optional fallen block beside the column
  const blk = R >= 14 && rn() < 0.6 ? { x: rn.sign() * R * rn.range(0.5, 0.62), y: R * rn.range(0.15, 0.35), a: R * rn.range(0.2, 0.26), h: R * rn.range(0.28, 0.38) } : null;
  const hd = Math.max(6, Math.round(rs * rn.range(0.9, 1.2)));        // drum height
  const j0 = rn.int(0, hd - 1);
  const gDrum = Math.max(1, Math.floor((Hb * 0.55) / hd));             // drum carrying the glyph band
  const gz0 = j0 + gDrum * hd - hd + Math.max(2, Math.round((hd - 4) / 2));
  const gOff = rn.int(0, 7);
  const G = area(R + 2, vis + 4, R * SQ + 3);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX } = G;
  const glyphAt = (i, z) => {
    if (z < gz0 || z >= gz0 + 4) return false;
    const col = i - AX + 60, gi = Math.floor(col / 4), gc = col % 4, gr = Math.floor(gz0 + 3.999 - z);
    return gc < 3 && GLYPHS[(gi + gOff) % GLYPHS.length][gr][gc] === '#';
  };
  renderHF(p, cx, cy, { x0: -R - 2, x1: R + 2, y0: -R - 2, y1: R + 2 }, (x, y) => {
    const s = sand(x, y);
    let c = -1;
    if (x * x + y * y <= rs * rs + 0.5 * rs) c = brk(x, y);
    if (blk && Math.abs(x - blk.x) <= blk.a && Math.abs(y - blk.y) <= blk.a) c = Math.max(c, blk.h + (hrand(bn, Math.floor(x), 99) - 0.5));
    if (c > s) { HF.mat = SS; return c; }
    if (s >= 0) { HF.mat = SAND; return s; }
    return -1;
  }, (kind, m, x, y, z, nx, ny, nz, i) => {
    if (m === SAND) {
      const I = lit(nx, ny, nz);
      let t = kind === 1 ? 1 : I > 0.76 ? 3 : I > 0.6 ? 2 : I > 0.34 ? 1 : 0;
      // faint wind ripples
      if (R >= 14 && t >= 2 && Math.sin(x * 0.55 + y * 1.3 + vnoise(rip, x / 6, y / 6) * 4) > 0.86) t--;
      return (SAND << 8) | t;
    }
    const onCol = x * x + y * y <= rs * rs + 0.5 * rs + 0.5;
    if (kind === 0) {
      const I = lit(nx, ny, nz);
      return (SS << 8) | (I > 0.86 ? 5 : I > 0.6 ? 4 : I > 0.32 ? 3 : I > 0.05 ? 2 : 1);
    }
    if (!onCol) return (SS << 8) | 3;          // block wall
    if (x * x + y * y < (rs - 1.2) * (rs - 1.2)) {  // a cliff inside the broken top
      const I = lit(nx, ny, nz);
      return (SS << 8) | (I > 0.6 ? 4 : I > 0.32 ? 3 : I > 0.05 ? 2 : 1);
    }
    const u = x / rs;
    let t = u < -0.8 ? 3 : u < 0.04 ? 4 : u < 0.44 ? 3 : u < 0.8 ? 2 : 1;
    const zz = z - j0;
    if (((zz % hd) + hd) % hd < 1 && z > 1.5) t = Math.max(1, t - 2);
    if (Math.abs(u) < 0.72) {
      if (glyphAt(i, z)) t = 1;
      else if (glyphAt(i, z + 1) && t < 5) t = Math.min(5, t + 1);            // lit lower lip of the carving
    }
    if (((z >= gz0 - 2 && z < gz0 - 1) || (z >= gz0 + 5 && z < gz0 + 6)) && Math.abs(u) < 0.95) t = Math.max(1, t - 1);
    return (SS << 8) | t;
  });
  depthEdges(p, 6.5, SS);
  despeckle(p, SAND);
  despeckle(p, SS);
  // erosion notches along the column silhouette and a crack from the break
  for (let j = 0; j < p.h; j++) {
    let l = -1, r = -1;
    for (let i = 0; i < p.w; i++) if (p.mat(i, j) === SS) { if (l < 0) l = i; r = i; }
    if (l < 0 || r - l < 4) continue;
    if (hrand(seed, j, 31) < 0.1 && p.mat(l, j + 1) === SS) p.erase(l, j);
    if (hrand(seed, j, 37) < 0.1 && p.mat(r, j + 1) === SS) p.erase(r, j);
  }
  if (R >= 12) {
    let i = AX + Math.round(rn.range(-0.45, 0.4) * rs);
    let j = 0;
    while (j < p.h && p.mat(i, j) !== SS) j++;
    j += Math.round(rs * 0.5) + 1;
    const len = rn.int(3, Math.max(4, Math.round(Hb * 0.25)));
    for (let s = 0; s < len; s++) {
      if (p.mat(i, j) !== SS || p.mat(i - 1, j) !== SS || p.mat(i + 1, j) !== SS) break;
      p.setTone(i, j, 1);
      j++;
      const r = rn();
      if (r < 0.25) i--; else if (r < 0.5) i++;
    }
  }
  outline(p, mats);

  // ── floor decal: shadow, a thin sand spill, rubble ──
  const DG = area(R * 1.6 + 6, R * 0.9 + 6, R * 0.95 + 8);
  const d = new Dec(DG.W, DG.H);
  const pN = ringNoise(hash3(seed, 17, 3), 8);
  const P0 = rgb('#7c6040'), P1 = rgb('#886a46');
  for (let j = 0; j < DG.H; j++) {
    for (let i = 0; i < DG.W; i++) {
      const dx = (i + 0.5 - DG.cx - wind * R * 0.2) / (R * 1.3), dy = (j + 0.5 - DG.cy - R * 0.08) / (R * 0.68);
      if (dx * dx + dy * dy > 1.35) continue;
      const q = len2(dx, dy) / (1 + 0.16 * pN(Math.atan2(dy, dx)));
      if (q > 1) continue;
      if (q > 0.84 && hrand(seed, i, j + 3) < 0.45) continue;
      d.over(i, j, q < 0.8 && hrand(seed, i, j + 7) > 0.86 ? P1 : P0, 1);
    }
  }
  dShadow(d, DG.cx + R * 0.2, DG.cy + R * 0.12, R * 1.02, R * SQ + 1, 0.3, [40, 22, 8]);
  const rub = [rgb('#e8c89a'), rgb('#c9a878'), rgb('#9a7a50'), rgb('#2e2012')];
  const nR = R < 14 ? rn.int(1, 2) : rn.int(2, 4);
  for (let q = 0; q < nR; q++) {
    const an = rn.range(0.05, 0.95) * Math.PI, dist = rn.range(1.05, 1.35);
    const s = R > 22 ? rn.int(2, 4) : rn.int(1, 2);
    dPebble(d, Math.round(DG.cx + Math.cos(an) * R * dist), Math.round(DG.cy + Math.sin(an) * R * 0.66 * dist), s + 1, Math.max(1, s), rub, rn);
  }
  return finish([p], mats, G, d, DG, 0);
}

const BUILD = { colosseum: buildColosseum, lava: buildLava, frost: buildFrost, neon: buildNeon, forest: buildForest, desert: buildDesert };

// Toolkit handed to the prop builders in art-props-*.js (same primitives as the builders above).
const KIT = {
  TAU, SQ, LIGHT, HF, clamp, len2, norm3, cross3, lit, prand, hash3, hrand, stream, ringNoise, vnoise,
  C, pal, rgb, Pix, Dec, area, renderHF, inShape, slab, tri3, outline, depthEdges, despeckle, finish,
  dEllipse, dShadow, dPebble, cylTone, octFace,
};
for (const set of [PROPS_NATURE, PROPS_BUILT, PROPS_MYSTIC]) {
  for (const [id, fn] of Object.entries(set || {})) if (typeof fn === 'function') BUILD[id] = (R, seed) => fn(R, seed, KIT);
}

/**
 * Pixel-art obstacle sprite for an arena theme.
 * @param {string} themeId  one of OBSTACLE_THEMES (unknown → 'colosseum')
 * @param {number} rPx      footprint radius in buffer px (clamped to 6..48)
 * @param {number} seed     integer for deterministic variation
 * @returns {{body: HTMLCanvasElement[], fps: number, ax: number, ay: number, floor: HTMLCanvasElement|null,
 *            fax: number, fay: number, top: number, halfW: number}}
 */
export function obstacleArt(themeId, rPx, seed) {
  const theme = OBSTACLE_THEMES.includes(themeId) && BUILD[themeId] ? themeId : 'colosseum';
  const R = clamp(Math.round(Number(rPx) || 0), 6, 48);
  const s = Math.floor(Number(seed) || 0);
  const key = `${theme}:${R}:${s}`;
  let art = cache.get(key);
  if (!art) {
    HF.step = R >= 30 ? 0.75 : 0.5;                   // sub-pixel either way; big props need fewer samples
    art = BUILD[theme](R, s >>> 0);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);   // drop the oldest entry
    cache.set(key, art);
  }
  return art;
}
