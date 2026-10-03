// ─────────────────────────────────────────────────────────────────────────────
//  Modern Warfare — spectator view (pixel art, canvas 2D).
//  The replay stores every unit at 5 Hz (position, facing, elements, state, morale, fire target);
//  every soldier, vehicle, tracer, shell and explosion is derived from it deterministically, so
//  drawing is a pure function of (replay, t).
//  Layers: cached ground (terrain, towns, roads, water, bridges) -> decals (craters, wrecks, tracks,
//  foxholes) -> ships -> ground units (depth sorted) -> tree canopies -> smoke screens -> fire and
//  smoke columns -> low aircraft -> tracers, missiles, shells -> explosions -> jets -> markers,
//  speech bubbles -> cloud shadows.
// ─────────────────────────────────────────────────────────────────────────────
import * as sound from '../../sound.js';
import { buildWarSprites, EMBLEM, shade, lighten, colorDist, TOP } from './sprites.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, k) => a + (b - a) * k;
const PIXEL_FONT = '"Press Start 2P", "Courier New", monospace';
function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; n = Math.imul(n, 0x2c1b3c6d); n ^= n >>> 12; return (n >>> 0) / 4294967296; }
const h2 = (a, b) => hash(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663));
const h3 = (a, b, c) => hash(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791));
function vnoise(x, y, salt) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (t) => t * t * (3 - 2 * t);
  const a = h3(xi, yi, salt), b = h3(xi + 1, yi, salt), c = h3(xi, yi + 1, salt), d = h3(xi + 1, yi + 1, salt);
  return lerp(lerp(a, b, s(xf)), lerp(c, d, s(xf)), s(yf));
}
function lerpAngDeg(a, b, k) { const d = ((b - a + 540) % 360) - 180; return a + d * k; }
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };

const ST = { idle: 0, moving: 1, fighting: 2, assault: 3, routing: 5, dead: 6, fled: 7, away: 8 };
const FIELD = { minX: -1200, maxX: 1200, minY: -675, maxY: 675, width: 2400, height: 1350 };
const INF = { riflemen: 'rifle', machinegun: 'mg', rockets: 'rocket', snipers: 'sniper' };
// display spacing (world units) of the elements of a unit
const SPACING = { riflemen: 11, machinegun: 13, rockets: 13, snipers: 20, jeep: 30, apc: 34, tank: 38, artillery: 40, antiair: 36, mlrs: 42, helicopter: 52, drone: 36, fighter: 44, bomber: 64, patrolboat: 62 };
const MIN_PX = 5;             // soldiers never closer than this on screen (buffer px)
const ALT = { helicopter: 7, drone: 10, fighter: 20, bomber: 16, stealthbomber: 22 };
// guns drawn as pixel lines: [mount key, length px, twin]
const GUNS = {
  apc: [['turret', 4, false]], tank: [['turret', 6, false]], artillery: [['turret', 7, false]], antiair: [['turret', 4, true]],
  mammoth: [['turret', 8, true]], patrolboat: [['turret', 3, false]], destroyer: [['turret', 4, false], ['turret2', 3, false]],
  battleship: [['turret', 6, true], ['turret2', 6, true], ['turret3', 5, true]],
};
const TRACER = {
  riflemen: { rate: 0.13, col: '#fff2a8', len: 0.1 }, machinegun: { rate: 0.55, col: '#ffe060', len: 0.14 }, rockets: { rate: 0.08, col: '#fff2a8', len: 0.1 },
  snipers: { rate: 0, col: '#ffffff', len: 0.2 }, jeep: { rate: 0.45, col: '#ffe060', len: 0.14 }, apc: { rate: 0.35, col: '#ffb040', len: 0.16, thick: true },
  tank: { rate: 0.18, col: '#ffe060', len: 0.12 }, antiair: { rate: 0.55, col: '#ffb040', len: 0.16, thick: true, flak: true },
  helicopter: { rate: 0.4, col: '#ffb040', len: 0.14 }, fighter: { rate: 0.6, col: '#ffd060', len: 0.2 }, patrolboat: { rate: 0.4, col: '#ffb040', len: 0.14 },
  destroyer: { rate: 0.3, col: '#ffb040', len: 0.14, flak: true }, battleship: { rate: 0.35, col: '#ffb040', len: 0.14, flak: true }, mammoth: { rate: 0.25, col: '#ffe060', len: 0.12 },
  hq: { rate: 0.3, col: '#ffe060', len: 0.12 },
};
const FORM = { line: 0, column: 1, spread: 2 };

const PALETTES = {
  farm: { out: '#27321e', ground: ['#5b8c3c', '#669a45', '#507d34', '#476f2e'], dots: ['#f2e45c', '#ffffff', '#e8a0c0', '#9ac860'],
    crops: [['#c9b35a', '#b39c48'], ['#8aa84a', '#76943c'], ['#7a5a3a', '#684a2e'], ['#6e9440', '#5e8236'], ['#b8a050', '#a08a40']],
    road: '#9a8a64', roadEdge: '#7a6c4c', tree: ['#1c4220', '#2d6a2f', '#4b8e3e', '#6aaa4a'], trunk: '#5a3a1e',
    roofs: [['#a8483a', '#7e3228'], ['#b86a40', '#8e4e2c'], ['#6a6a72', '#4c4c54'], ['#8a3a30', '#662a22']], sand: '#c8b27c', scorch: '#1e1a14', dust: '#b8a878' },
  river: { out: '#223420', ground: ['#4f8c44', '#5a984d', '#46803c', '#3e7236'], dots: ['#f0f0f0', '#9ad0f0', '#f2e45c'],
    road: '#8e8a7c', roadEdge: '#6c6a60', tree: ['#1a4020', '#28642e', '#43883e', '#5ea44c'], trunk: '#5a3a1e',
    roofs: [['#9a4a3a', '#743628'], ['#5a6878', '#404c5a'], ['#a86a48', '#7e4e34'], ['#6a6a72', '#4c4c54']], water: ['#1f4f84', '#285f9a', '#3c7cb8', '#86bfe6'], sand: '#b8a276', scorch: '#1e1a14', dust: '#b0a47a' },
  desert: { out: '#3a2e1c', ground: ['#d9c088', '#e0c994', '#ccb07a', '#c2a46e'], dots: ['#b89a60', '#f0e2b8', '#a08050'],
    road: '#6e6a62', roadEdge: '#56524c', tree: ['#2e5a24', '#3f7a2e', '#5a9a3a', '#7ab84a'], trunk: '#6a4a2a',
    roofs: [['#e4d4ac', '#c8b48a'], ['#d8c090', '#b89e70'], ['#ece0c4', '#cdbf9e'], ['#c89a70', '#a67a52']], rock: ['#a8795a', '#7c5540', '#c99a70', '#5a3c2a'], sand: '#e8d6a4', scorch: '#2a2014', dust: '#d8c090' },
  city: { out: '#1e2024', ground: ['#5c5f64', '#64676c', '#56595e', '#4f5257'], dots: ['#8a8c8e', '#44474c'],
    road: '#3e4146', roadEdge: '#e8e0b0', tree: ['#1c3e22', '#2a5e30', '#44803e', '#62a04c'], trunk: '#4a3420',
    roofs: [['#7a7e86', '#5c6068'], ['#8c8478', '#6c665c'], ['#6a727c', '#4e5660'], ['#9a9488', '#78746a']], park: '#4c7a3c', walk: '#8a8c8a', sand: '#9a9486', scorch: '#141416', dust: '#8a8a86' },
  coast: { out: '#1f3040', ground: ['#62923f', '#6e9e48', '#588636', '#4e7a30'], dots: ['#f4f4f0', '#f2e45c', '#e8a0c0'],
    road: '#8e8a7c', roadEdge: '#6c6a60', tree: ['#1c4220', '#2d6a2f', '#4b8e3e', '#6aaa4a'], trunk: '#5a3a1e',
    roofs: [['#c04a3a', '#8e3428'], ['#e8e4d8', '#bcb8ac'], ['#4a6a9a', '#34507a'], ['#b86a40', '#8e4e2c']], water: ['#15406e', '#1d5286', '#2e6ea6', '#7ab4de'], sand: '#e2cc90', scorch: '#1e1a14', dust: '#c8b890' },
  islands: { out: '#18303e', ground: ['#5e9040', '#6a9c4a', '#548438', '#4a7630'], dots: ['#f4f4f0', '#f2e45c', '#9ad0f0'],
    road: '#8e8a7c', roadEdge: '#6c6a60', tree: ['#1a4020', '#28642e', '#43883e', '#5ea44c'], trunk: '#5a3a1e',
    roofs: [['#e8e4d8', '#bcb8ac'], ['#c04a3a', '#8e3428'], ['#5a7a9a', '#40607a'], ['#d8a060', '#b07c44']], water: ['#133c68', '#1b4e80', '#2c6aa2', '#78b2dc'], rock: ['#8e8c84', '#6c6a64', '#b8b6ac', '#46443e'], sand: '#e0ca8e', scorch: '#1e1a14', dust: '#c8b890' },
};
// roads (visual only): polylines per battlefield
const ROADS = {
  farmland: [[[-1260, 70], [-700, 40], [-300, 72], [0, 60], [300, 72], [700, 40], [1260, 70]], [[0, -720], [0, 720]]],
  rivertown: [[[-1260, 0], [1260, 0]], [[-1260, -440], [1260, -440]], [[-1260, 440], [1260, 440]]],
  desert: [[[-1260, 0], [-600, -30], [0, 0], [600, -30], [1260, 0]]],
  city: [],
  coast: [[[-1260, -250], [-600, -240], [0, -262], [600, -240], [1260, -250]], [[0, -262], [0, 720]]],
  islands: [[[-1260, -530], [1260, -530]], [[-1260, 0], [1260, 0]], [[-1260, 530], [1260, 530]], [[-760, -720], [-760, 720]], [[760, -720], [760, 720]]],
};
const FALLBACK_MAP = { id: 'farmland', name: 'Farmland', palette: 'farm', towns: [{ x: 0, y: -330, r: 130 }, { x: 0, y: 330, r: 130 }], forests: [{ x: -560, y: -420, r: 120 }, { x: 560, y: -420, r: 120 }, { x: -560, y: 440, r: 120 }, { x: 560, y: 440, r: 120 }, { x: -260, y: 20, r: 70 }, { x: 260, y: 20, r: 70 }], blocks: [{ x: 0, y: 0, r: 44 }], water: [], bridges: [] };

export function createView(canvas) {
  const ctx = canvas.getContext('2d');
  const buf = document.createElement('canvas');
  const b = buf.getContext('2d');
  let cw = 0, ch = 0, dpr = 1, z = 2, bw = 0, bh = 0, K = 0.26, ox = 0, oy = 0;
  let rep = null, P = null;
  let aiColors = ['#e8825c', '#2fc58e'];
  let ground = null, canopy = null, deck = null, groundKey = '', shimmer = [], foam = [];
  let lastT = null;
  const sndLast = {};
  let idleMap = FALLBACK_MAP;

  const X = (x) => Math.round(ox + x * K);
  const Y = (y) => Math.round(oy + y * K);
  const dispSpacing = (type) => (INF[type] ? Math.max(SPACING[type] || 12, MIN_PX / K) : Math.max(SPACING[type] || 40, ((TOP[type] ? TOP[type].rows[0].length : 8) + 3) / K));

  // ── sizing ────────────────────────────────────────────────────────────────
  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (w !== cw || h !== ch) { cw = w; ch = h; canvas.width = w; canvas.height = h; }
    const fit = Math.min(cw / 2440, ch / 1380);
    z = Math.max(1, Math.round(fit / 0.27));
    const nbw = Math.ceil(cw / z), nbh = Math.ceil(ch / z);
    if (nbw !== bw || nbh !== bh) { bw = nbw; bh = nbh; buf.width = bw; buf.height = bh; }
    const nK = Math.min((bw - 12) / FIELD.width, (bh - 12) / FIELD.height);
    if (nK !== K) { K = nK; layoutCache.clear(); }
    ox = Math.floor(bw / 2); oy = Math.floor(bh / 2);
  }
  // The pixel buffer reaches the screen at a WHOLE-NUMBER scale, so every pixel stays square; a zoom
  // eases between those steps and the view pans in canvas pixels, so the camera glides.
  let dispScale = 0, dispTarget = 0, lastPresent = 0, camInfo = null;
  function present(cam) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = lastPresent ? (now - lastPresent) / 1000 : 1;
    lastPresent = now;
    const want = z * (cam ? cam.zoom : 1);
    let target = Math.max(z, Math.round(want));
    if (dispTarget && Math.abs(want - dispTarget) < 0.62) target = dispTarget;
    dispTarget = target;
    if (!dispScale || dt > 0.5) dispScale = target;
    else dispScale += (target - dispScale) * (1 - Math.exp(-dt / 0.09));
    if (Math.abs(dispScale - target) < 0.01) dispScale = target;
    const S = dispScale;
    if (S <= z + 0.001) { ctx.drawImage(buf, 0, 0, bw * z, bh * z); camInfo = { scale: z, x: 0, y: 0 }; return; }
    const vw = cw / S, vh = ch / S;
    const keep = (c, s0, lo, hi) => (s0 >= hi - lo ? (lo + hi) / 2 - s0 / 2 : clamp(c - s0 / 2, lo, hi - s0));
    const cx = ox + (cam ? cam.x : 0) * K, cy = oy + (cam ? cam.y : 0) * K;
    const sx = clamp(keep(cx, vw, ox + FIELD.minX * K - 6, ox + FIELD.maxX * K + 6), 0, Math.max(0, bw - vw));
    const sy = clamp(keep(cy, vh, oy + FIELD.minY * K - 6, oy + FIELD.maxY * K + 6), 0, Math.max(0, bh - vh));
    const ix = Math.floor(sx), iy = Math.floor(sy);
    const offX = Math.round((sx - ix) * S), offY = Math.round((sy - iy) * S);
    const w = Math.min(bw - ix, Math.ceil(vw) + 2), h = Math.min(bh - iy, Math.ceil(vh) + 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(buf, ix, iy, w, h, -offX, -offY, w * S, h * S);
    camInfo = { scale: S, x: sx * S, y: sy * S };
  }

  // ── camera ────────────────────────────────────────────────────────────────
  // A pure function of t: it frames the armies on the ground and at sea (jets never drag it around) and
  // pushes in on the big moments - a command post destroyed, cruise missiles, carpet bombing, air strikes,
  // EMP bursts, aircraft shot down, legendary units lost, and the winner at the end.
  const CAM_AUTO_MAX = 2.0, CAM_PAD = 120, FADE = 1.5;
  function unitWeight(q, t) {
    if (q.jet) return 0;
    if (q.goneT === undefined) {
      q.goneT = Infinity;
      for (let f = 0; f < P.N; f++) if (q.s[f] === ST.dead || q.s[f] === ST.fled) { q.goneT = f / P.hz; break; }
    }
    const w = t <= q.goneT ? 1 : Math.max(0, 1 - (t - q.goneT) / FADE);
    return q.hq ? w * 0.3 : q.fly ? w * 0.4 : w;
  }
  function frameAt(t) {
    const fr = clamp(t * P.hz, 0, P.N - 1), i = Math.floor(fr), j = Math.min(P.N - 1, i + 1), a = fr - i;
    let W = 0, mx = 0, my = 0;
    const pts = [];
    for (const q of P.units) {
      const w = unitWeight(q, t);
      if (w <= 0) continue;
      const x = clamp(lerp(q.x[i], q.x[j], a), FIELD.minX, FIELD.maxX), y = clamp(lerp(q.y[i], q.y[j], a), FIELD.minY, FIELD.maxY);
      pts.push([x, y, w, q.side]);
    }
    // the front matters most: a unit counts less the further it is from the nearest enemy
    for (const p of pts) {
      let dmin = Infinity;
      for (const o of pts) if (o[3] !== p[3]) dmin = Math.min(dmin, Math.hypot(o[0] - p[0], o[1] - p[1]));
      const w = p[2] * clamp(1.5 - dmin / 700, 0.12, 1);
      W += w; mx += w * p[0]; my += w * p[1]; p[2] = w;
    }
    if (!W) return null;
    mx /= W; my /= W;
    let vx = 0, vy = 0;
    for (const [x, y, w] of pts) { vx += w * (x - mx) * (x - mx); vy += w * (y - my) * (y - my); }
    return { x: mx, y: my, hx: 2.0 * Math.sqrt(vx / W) + CAM_PAD, hy: 2.0 * Math.sqrt(vy / W) + CAM_PAD };
  }
  function autoFrame(t) {
    let wx = 0, wy = 0, wz = 0, wsum = 0;
    for (let k = 0; k < 9; k++) {
      const f = frameAt(Math.max(0, t - k * 0.25));
      if (!f) continue;
      const w = 9 - k;
      const zf = clamp(Math.min(bw / (K * 2 * f.hx), bh / (K * 2 * f.hy)) / Math.min(bw / (K * FIELD.width), bh / (K * FIELD.height)), 1, CAM_AUTO_MAX);
      wx += w * f.x; wy += w * f.y; wz += w * Math.log(zf); wsum += w;
    }
    if (!wsum) return { x: 0, y: 0, zoom: 1 };
    return { x: wx / wsum, y: wy / wsum, zoom: Math.exp(wz / wsum) };
  }
  function pickMoments(ev) {
    const Q = P.units, cands = [];
    let bigGuns = 0;
    const add = (t, pri, zoom, hold, focus) => cands.push({ t, pri, zoom, hold, focus });
    for (const e of ev) {
      const q = Q[e.a];
      switch (e.k) {
        case 'hq': add(e.t, 5, 2.4, 2.4, { unit: e.a, t: e.t }); break;
        case 'power':
          if (e.p === 'cruise') add(e.t + (e.ft || 4), 4.5, 2.2, 1.8, { x: e.x, y: e.y });
          else if (e.p === 'carpet') add(e.t + (e.ft || 3) + 0.8, 4, 1.9, 2.2, { x: e.x, y: e.y });
          else if (e.p === 'airstrike') add(e.t + (e.ft || 2.5) + 0.4, 3.2, 2.0, 1.6, { x: e.x, y: e.y });
          else if (e.p === 'emp') add(e.t, 3.4, 2.0, 1.6, { x: e.x, y: e.y });
          break;
        case 'destroyed': if (q && (q.legend || q.naval)) add(e.t, 3.3, 2.1, 1.8, { unit: e.a, t: e.t }); break;
        case 'boom': if (e.n >= 5) add(e.t, 3, 2.0, 1.4, { x: e.x, y: e.y }); break;
        case 'kill': if (q && q.fly) add(e.t, 2.4, 2.1, 1.3, { x: e.x, y: e.y }); break;
        case 'shell': if (q && q.type === 'battleship' && (bigGuns = (bigGuns || 0) + 1) <= 2) add(e.t, 2.2, 1.9, 1.2, { unit: e.a }); break;
        default: break;
      }
    }
    const end = ev.find(e => e.k === 'end');
    const picked = [];
    const busy = (a0, a1) => picked.some(m => a0 < m.t2 + 2.5 && a1 > m.t0 - 2.5);
    if (end) {
      const fallen = ev.find(e => e.k === 'hq' && e.t >= end.t - 1);
      const g = fallen ? fallen.a : end.s >= 0 ? Q.findIndex(q => q.hq && q.side === end.s) : -1;
      picked.push({ t0: end.t - (fallen ? 0.6 : 0.3), t1: Infinity, t2: Infinity, zoom: fallen ? 2.4 : 1.9, focus: g >= 0 ? { unit: g, t: end.t } : null });
    }
    cands.sort((a, c) => c.pri - a.pri || a.t - c.t);
    for (const c of cands) {
      const t0 = c.t - 0.7, t2 = c.t + c.hold + 0.9;
      if (t0 < 2 || busy(t0, t2)) continue;
      picked.push({ t0, t1: c.t + c.hold, t2, zoom: c.zoom, focus: c.focus });
    }
    return picked.sort((a, c) => a.t0 - c.t0);
  }
  function focusAt(f, t) {
    if (!f) return null;
    if (f.unit === undefined) return { x: f.x, y: f.y };
    const q = P.units[f.unit];
    if (!q) return null;
    const a = stateAt(q, f.t !== undefined ? Math.min(t, f.t) : t);
    return { x: a.x, y: a.y };
  }
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  function cameraAt(t) {
    const base = autoFrame(Math.min(t, P.dur));
    let best = null, bestW = 0;
    for (const m of P.moments) {
      if (t < m.t0 || t > m.t2) continue;
      const w = t < m.t0 + 0.7 ? smooth((t - m.t0) / 0.7) : t <= m.t1 ? 1 : smooth(1 - (t - m.t1) / (m.t2 - m.t1));
      if (w > bestW) { bestW = w; best = m; }
    }
    if (!best) return base;
    const p = focusAt(best.focus, t) || base;
    const zoom = Math.exp(lerp(Math.log(base.zoom), Math.log(Math.max(base.zoom, best.zoom)), bestW));
    return { x: lerp(base.x, p.x, bestW), y: lerp(base.y, p.y, bestW), zoom };
  }

  // ── ground ────────────────────────────────────────────────────────────────
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const inRect = (r, x, y, m = 0) => x >= r.x0 - m && x <= r.x1 + m && y >= r.y0 - m && y <= r.y1 + m;
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const k = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
  }
  function roadDist(map, x, y) {
    let d = Infinity;
    for (const line of ROADS[map.id] || []) for (let i = 1; i < line.length; i++) d = Math.min(d, segDist(x, y, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]));
    return d;
  }
  // city: a street grid (blocks 150 x 120, streets 26 wide)
  const cityStreet = (x, y) => { const gx = ((x + 1275) % 150 + 150) % 150, gy = ((y + 60) % 120 + 120) % 120; return gx < 26 || gy < 22; };
  function ensureGround(map) {
    const key = `${map.id}|${bw}|${bh}|${K.toFixed(4)}`;
    if (key === groundKey && ground) return;
    groundKey = key;
    const pal = PALETTES[map.palette] || PALETTES.farm;
    ground = document.createElement('canvas'); ground.width = bw; ground.height = bh;
    canopy = document.createElement('canvas'); canopy.width = bw; canopy.height = bh;
    deck = document.createElement('canvas'); deck.width = bw; deck.height = bh;
    const g = ground.getContext('2d');
    const img = g.createImageData(bw, bh);
    const d = img.data;
    const base = pal.ground.map(rgb), out = rgb(pal.out), sand = rgb(pal.sand || '#c8b27c');
    const water = (pal.water || ['#1f4f84', '#285f9a', '#3c7cb8', '#86bfe6']).map(rgb);
    const crops = (pal.crops || []).map(c => c.map(rgb));
    const road = rgb(pal.road), roadEdge = rgb(pal.roadEdge);
    shimmer = []; foam = [];
    const W = map.water || [], BR = map.bridges || [];
    const shoreDist = (x, y) => {
      // distance from (x, y) to the nearest water edge (inside water: negative)
      let best = Infinity, inside = false;
      for (const w of W) {
        if (inRect(w, x, y)) { inside = true; best = Math.min(best, Math.min(x - w.x0, w.x1 - x, y - w.y0, w.y1 - y) + (w.x0 <= FIELD.minX ? 0 : 0)); }
      }
      if (inside) {
        // edges that touch the field border are not shores
        let m = Infinity;
        for (const w of W) {
          if (!inRect(w, x, y)) continue;
          if (w.x0 > FIELD.minX) m = Math.min(m, x - w.x0);
          if (w.x1 < FIELD.maxX) m = Math.min(m, w.x1 - x);
          if (w.y0 > FIELD.minY) m = Math.min(m, y - w.y0);
          if (w.y1 < FIELD.maxY) m = Math.min(m, w.y1 - y);
        }
        return -m;
      }
      for (const w of W) {
        const dx = Math.max(w.x0 - x, 0, x - w.x1), dy = Math.max(w.y0 - y, 0, y - w.y1);
        best = Math.min(best, Math.hypot(dx, dy));
      }
      return best;
    };
    for (let py = 0; py < bh; py++) {
      for (let px = 0; px < bw; px++) {
        const wx = (px - ox) / K, wy = (py - oy) / K;
        const inField = wx >= FIELD.minX && wx <= FIELD.maxX && wy >= FIELD.minY && wy <= FIELD.maxY;
        const n = vnoise(wx / 26, wy / 26, 5) * 0.55 + h2(px, py) * 0.45;
        const big = 0.93 + 0.12 * vnoise(wx / 190, wy / 190, 11);
        let c = base[n < 0.3 ? 2 : n < 0.72 ? 0 : 1].map(v => v * big);
        if (vnoise(wx / 55, wy / 55, 21) > 0.78) c = c.map((v, i) => lerp(v, base[3][i], 0.35));
        if (map.palette === 'farm' && crops.length) {
          // a patchwork of fields
          const cx = Math.floor((wx + 1300) / 170), cy = Math.floor((wy + 700) / 125);
          const pick = h2(cx * 7 + 3, cy * 13 + 1);
          const edge = Math.min(((wx + 1300) % 170 + 170) % 170, ((wy + 700) % 125 + 125) % 125);
          if (pick < 0.62 && edge > 5) {
            const cc = crops[Math.floor(h2(cx, cy) * crops.length)];
            const vert = h2(cy, cx * 3) < 0.5;
            const stripe = Math.floor((vert ? wx : wy) / 7) % 2 === 0;
            c = (stripe ? cc[0] : cc[1]).map(v => v * (0.96 + 0.08 * h2(px, py)));
          } else if (edge <= 5 && pick < 0.8) c = c.map(v => v * 0.78);   // hedgerows between fields
        } else if (map.palette === 'desert') {
          const rip = Math.sin((wx * 0.8 + wy * 0.35) / 11 + vnoise(wx / 90, wy / 90, 3) * 7);
          if (rip > 0.72) c = c.map(v => v * 1.06); else if (rip < -0.8) c = c.map(v => v * 0.92);
        } else if (map.palette === 'city') {
          if (cityStreet(wx, wy)) {
            const gx = ((wx + 1275) % 150 + 150) % 150, gy = ((wy + 60) % 120 + 120) % 120;
            c = rgb(pal.road).map(v => v * (0.95 + 0.08 * h2(px, py)));
            const mid = (Math.abs(gx - 13) < 1.2 && gy >= 22 && Math.floor(wy / 12) % 2 === 0) || (Math.abs(gy - 11) < 1.2 && gx >= 26 && Math.floor(wx / 12) % 2 === 0);
            if (mid) c = rgb(pal.roadEdge);
          } else {
            const gx = ((wx + 1275) % 150 + 150) % 150, gy = ((wy + 60) % 120 + 120) % 120;
            const nearStreet = gx < 32 || gy < 28 || gx > 144 || gy > 114;
            const bx = Math.floor((wx + 1275) / 150), by = Math.floor((wy + 60) / 120);
            if (nearStreet) c = rgb(pal.walk).map(v => v * (0.94 + 0.08 * h2(px, py)));
            else if (h2(bx, by) < 0.3) c = rgb(pal.park).map(v => v * (0.9 + 0.15 * n));
          }
        }
        // roads
        if (map.palette !== 'city') {
          const rd = roadDist(map, wx, wy);
          if (rd < 11) c = (rd > 8.5 ? roadEdge : road).map(v => v * (0.94 + 0.1 * h2(px, py)));
        }
        // water, beaches
        if (W.length) {
          const sd = shoreDist(wx, wy);
          const onBridge = BR.some(r => inRect(r, wx, wy));
          if (sd < 0) {
            const depth = -sd;
            c = water[depth > 70 ? 0 : depth > 30 ? 1 : 2].map(v => v * (0.97 + 0.05 * vnoise(wx / 40, wy / 40, 9)));
            if (depth < 5) { c = water[3]; foam.push([px, py, h2(px, py * 7)]); }
            else if (h2(px * 3, py) < 0.015) shimmer.push([px, py, h2(px, py * 5)]);
          } else if (sd < 22 && !onBridge && map.palette !== 'river') c = sand.map((v, i) => lerp(v, c[i], clamp((sd - 12) / 10, 0, 1)) * (0.95 + 0.08 * h2(px, py)));
          else if (sd < 8 && !onBridge) c = sand.map((v, i) => lerp(v, c[i], sd / 9));
        }
        if (!inField) {
          const k = 0.55 + 0.1 * h2(px, py);
          c = [lerp(out[0], c[0] * 0.5, 0.25) * k / 0.6, lerp(out[1], c[1] * 0.5, 0.25) * k / 0.6, lerp(out[2], c[2] * 0.5, 0.25) * k / 0.6];
        }
        const o = (py * bw + px) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // field border
    const x0 = X(FIELD.minX), x1 = X(FIELD.maxX), y0 = Y(FIELD.minY), y1 = Y(FIELD.maxY);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, 1); g.fillRect(x0 - 1, y1, x1 - x0 + 2, 1);
    g.fillRect(x0 - 1, y0, 1, y1 - y0); g.fillRect(x1, y0, 1, y1 - y0);
    // ground details
    const blocked = (wx, wy) => W.some(w => inRect(w, wx, wy, 6)) || (map.towns || []).some(t => Math.hypot(wx - t.x, wy - t.y) < t.r) || (map.forests || []).some(f => Math.hypot(wx - f.x, wy - f.y) < f.r) || (map.blocks || []).some(r => Math.hypot(wx - r.x, wy - r.y) < r.r + 6) || roadDist(map, wx, wy) < 12;
    for (let i = 0; i < bw * bh / 110; i++) {
      const px = Math.floor(h2(i, 1) * bw), py = Math.floor(h2(i, 2) * bh);
      const wx = (px - ox) / K, wy = (py - oy) / K;
      if (wx < FIELD.minX || wx > FIELD.maxX || wy < FIELD.minY || wy > FIELD.maxY || blocked(wx, wy)) continue;
      if (map.palette === 'city' && cityStreet(wx, wy)) continue;
      const r = h2(i, 3);
      if (r < 0.55) { g.fillStyle = shade(pal.ground[1], map.palette === 'desert' ? 0.9 : 1.18); g.fillRect(px, py, 1, 1); if (map.palette !== 'desert') g.fillRect(px + 1, py - 1, 1, 1); }
      else if (r < 0.8) { g.fillStyle = shade(pal.ground[3], 0.85); g.fillRect(px, py, 2, 1); }
      else { g.fillStyle = pal.dots[Math.floor(h2(i, 4) * pal.dots.length)]; g.fillRect(px, py, 1, 1); }
    }
    // bridges and causeways: on their own layer, so ships sail under them
    const dg = deck.getContext('2d');
    for (const r of BR) drawBridge(dg, r, pal);
    // towns, blocks, forests
    for (const t of map.towns || []) drawTown(g, t, pal, map);
    for (const r of map.blocks || []) drawBlock(g, r, pal, map);
    const cg = canopy.getContext('2d');
    for (const f of map.forests || []) drawWood(g, cg, f, pal, map.palette);
  }
  function blobA(g, cx, cy, rx, ry) {
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      const k = 1 - (y * y) / (ry * ry);
      if (k < 0) continue;
      const hw = Math.round(rx * Math.sqrt(k));
      g.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2 + 1, 1);
    }
  }
  function blob(g, cx, cy, rx, ry, col, seed) {
    g.fillStyle = col;
    rx = Math.max(1, rx); ry = Math.max(1, ry);
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      const k = 1 - (y * y) / (ry * ry);
      if (k < 0) continue;
      const wob = 1 + (h2(seed | 0, y) - 0.5) * 0.18;
      const hw = Math.round(rx * Math.sqrt(k) * wob);
      g.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2 + 1, 1);
    }
  }
  function drawBridge(g, r, pal) {
    const x0 = X(r.x0) - 2, x1 = X(r.x1) + 2, y0 = Y(r.y0), y1 = Y(r.y1);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0, y1, x1 - x0, 2);
    g.fillStyle = '#6c6a64'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = '#8a8880'; g.fillRect(x0, y0 + 1, x1 - x0, y1 - y0 - 2);
    g.fillStyle = '#3c3a36'; g.fillRect(x0, y0, x1 - x0, 1); g.fillRect(x0, y1 - 1, x1 - x0, 1);
    // lane marks and pylons
    g.fillStyle = '#d8d0a0';
    const my = Math.round((y0 + y1) / 2);
    for (let x = x0 + 2; x < x1 - 2; x += 4) g.fillRect(x, my, 2, 1);
    g.fillStyle = '#4a4844';
    for (let x = x0 + 5; x < x1 - 3; x += 12) { g.fillRect(x, y0 - 1, 1, 1); g.fillRect(x, y1, 1, 1); }
  }
  function drawHouse(g, x, y, w, h, roof, flat, seed) {
    // shadow, then a two-tone roof (ridge along the long side) - or a flat roof with a parapet
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 1, y + 1, w, h);
    if (flat) {
      g.fillStyle = roof[1]; g.fillRect(x, y, w, h);
      g.fillStyle = roof[0]; g.fillRect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2));
      if (w > 4 && h > 3 && h2(seed, 5) < 0.6) { g.fillStyle = roof[1]; g.fillRect(x + 1 + Math.floor(h2(seed, 6) * (w - 3)), y + 1 + Math.floor(h2(seed, 7) * (h - 2)), 2, 1); }
      return;
    }
    if (w >= h) { const hh = Math.ceil(h / 2); g.fillStyle = roof[0]; g.fillRect(x, y, w, hh); g.fillStyle = roof[1]; g.fillRect(x, y + hh, w, h - hh); }
    else { const hw = Math.ceil(w / 2); g.fillStyle = roof[0]; g.fillRect(x, y, hw, h); g.fillStyle = roof[1]; g.fillRect(x + hw, y, w - hw, h); }
    if (h2(seed, 8) < 0.4) { g.fillStyle = '#3a3230'; g.fillRect(x + Math.floor(w * 0.7), y, 1, 1); }
  }
  function drawTown(g, t, pal, map) {
    const flat = map.palette === 'desert' || map.palette === 'city';
    const step = map.palette === 'city' ? 40 : 34;
    for (let gx = -t.r; gx <= t.r; gx += step) {
      for (let gy = -t.r; gy <= t.r; gy += step * 0.85) {
        const jx = (h2(gx + t.x | 0, gy | 0) - 0.5) * step * 0.35, jy = (h2(gy | 0, gx + t.y | 0) - 0.5) * step * 0.3;
        const x = t.x + gx + jx, y = t.y + gy + jy;
        if (Math.hypot(x - t.x, y - t.y) > t.r - 12) continue;
        if (map.palette === 'city' && cityStreet(x, y)) continue;
        if (map.palette !== 'city' && roadDist(map, x, y) < 16) continue;
        if ((map.water || []).some(w => inRect(w, x, y, 8))) continue;
        if (h2(x | 0, y | 0) < 0.12) continue;   // a yard / a square
        const seed = (x * 31 + y * 17) | 0;
        const big = map.palette === 'city' ? 1.5 : 1;
        const w = Math.max(3, Math.round((14 + h2(seed, 1) * 10) * big * K + 1)), h = Math.max(3, Math.round((12 + h2(seed, 2) * 8) * big * K + 1));
        const roof = pal.roofs[Math.floor(h2(seed, 3) * pal.roofs.length)];
        drawHouse(g, X(x) - Math.floor(w / 2), Y(y) - Math.floor(h / 2), w, h, roof, flat, seed);
      }
    }
    if (map.palette === 'desert') {
      // the oasis: a pool of water with palms around (palms are drawn by the forests)
      g.fillStyle = '#3c7cb8'; blobA(g, X(t.x), Y(t.y), Math.max(2, 16 * K), Math.max(2, 11 * K));
    }
  }
  function drawBlock(g, r, pal, map) {
    const cx = X(r.x), cy = Y(r.y), R = r.r * K;
    if (map.palette === 'city') {
      // an office tower: shadow, walls, roof with details, a helipad on some
      const w = Math.round(R * 1.7), h = Math.round(R * 1.5);
      const x = cx - Math.floor(w / 2), y = cy - Math.floor(h / 2);
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + 3, y + 3, w, h);
      g.fillStyle = '#4a4e56'; g.fillRect(x, y, w, h);
      g.fillStyle = '#7a8088'; g.fillRect(x + 1, y + 1, w - 2, h - 2);
      g.fillStyle = '#8e949c'; g.fillRect(x + 1, y + 1, w - 2, 1);
      g.fillStyle = '#5c6068';
      for (let i = 0; i < 3; i++) g.fillRect(x + 2 + Math.floor(h2(r.x | 0, i) * (w - 5)), y + 2 + Math.floor(h2(i, r.y | 0) * (h - 4)), 2, 2);
      if (Math.abs(r.y) > 400) {
        g.fillStyle = '#e8e4d8'; const hx = cx - 2, hy = cy - 2;
        g.fillRect(hx, hy, 1, 5); g.fillRect(hx + 3, hy, 1, 5); g.fillRect(hx + 1, hy + 2, 2, 1);
      }
      return;
    }
    if (map.palette === 'desert' || map.palette === 'islands') {
      // a rock mesa / an islet: cliffs, a lit top, cracks
      const [base, dark, light, edge] = pal.rock || ['#8e8c84', '#6c6a64', '#b8b6ac', '#46443e'];
      blob(g, cx + 2, cy + 3, R + 1, R * 0.8 + 1, 'rgba(0,0,0,0.35)', r.x);
      blob(g, cx, cy + 2, R + 1, R * 0.8 + 1, edge, r.x);
      blob(g, cx, cy + 1, R, R * 0.8, dark, r.x + 1);
      blob(g, cx - R * 0.08, cy - R * 0.1, R * 0.86, R * 0.64, base, r.x + 2);
      blob(g, cx - R * 0.3, cy - R * 0.32, R * 0.4, R * 0.26, light, r.x + 3);
      g.fillStyle = edge;
      for (let i = 0; i < 4; i++) { const a = h2(i, r.x | 0) * TAU, l = R * 0.5; g.fillRect(Math.round(cx + Math.cos(a) * l * 0.3), Math.round(cy + Math.sin(a) * l * 0.3), 1, Math.max(1, Math.round(l * 0.4))); }
      if (map.palette === 'islands') {
        // a lighthouse
        g.fillStyle = '#e8e4d8'; g.fillRect(cx - 1, cy - 6, 3, 6);
        g.fillStyle = '#c0392b'; g.fillRect(cx - 1, cy - 4, 3, 1); g.fillRect(cx - 1, cy - 7, 3, 1);
        g.fillStyle = '#ffd35a'; g.fillRect(cx, cy - 8, 1, 1);
      }
      return;
    }
    // farmstead: a big barn and a silo in a fenced yard
    g.fillStyle = '#8a7a58'; blobA(g, cx, cy, R, R * 0.8);
    g.fillStyle = '#5a4a34';
    const n = Math.max(12, Math.round(R * 5));
    for (let i = 0; i < n; i++) { const a = i / n * TAU; g.fillRect(Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R * 0.8), 1, 1); }
    drawHouse(g, cx - Math.round(R * 0.7), cy - Math.round(R * 0.45), Math.round(R * 1.0), Math.round(R * 0.7), ['#a8483a', '#7e3228'], false, 11);
    g.fillStyle = 'rgba(0,0,0,0.3)'; blobA(g, cx + Math.round(R * 0.5) + 1, cy + Math.round(R * 0.2) + 1, Math.max(2, R * 0.22), Math.max(2, R * 0.22));
    g.fillStyle = '#9aa0a8'; blobA(g, cx + Math.round(R * 0.5), cy + Math.round(R * 0.2), Math.max(2, R * 0.22), Math.max(2, R * 0.22));
    g.fillStyle = '#c8ccd2'; g.fillRect(cx + Math.round(R * 0.45), cy + Math.round(R * 0.12), 1, 1);
  }
  function drawWood(g, cg, w, pal, palette) {
    const trees = [];
    const step = 21;
    for (let gx = -w.r; gx <= w.r; gx += step) for (let gy = -w.r; gy <= w.r; gy += step * 0.8) {
      const jx = (h2(gx + w.x | 0, gy | 0) - 0.5) * step * 0.8, jy = (h2(gy | 0, gx + w.y | 0) - 0.5) * step * 0.7;
      const x = w.x + gx + jx, y = w.y + gy + jy;
      if (Math.hypot(x - w.x, y - w.y) > w.r - 6) continue;
      trees.push({ x, y, s: 0.8 + h2(x | 0, y | 0) * 0.5, v: h2(y | 0, x | 0) });
    }
    trees.sort((a, c) => a.y - c.y);
    const [dark, mid, light, hi] = pal.tree;
    for (const t of trees) {
      const cx = X(t.x), cy = Y(t.y), r = Math.max(2, Math.round(9 * K * t.s + 1.5));
      g.fillStyle = 'rgba(0,0,0,0.28)'; blobA(g, cx + 2, cy + 2, r, r * 0.6);
      g.fillStyle = pal.trunk; g.fillRect(cx, cy, 1, 2);
      if (palette === 'desert') {
        // palms: a star of fronds
        cg.fillStyle = dark;
        for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + t.v; for (let s = 1; s <= r + 1; s++) cg.fillRect(Math.round(cx + Math.cos(a) * s), Math.round(cy - r * 0.5 + Math.sin(a) * s * 0.7), 1, 1); }
        cg.fillStyle = light; cg.fillRect(cx, cy - Math.round(r * 0.5), 1, 1);
        continue;
      }
      blob(cg, cx, cy - r * 0.6, r + 1, r * 0.85 + 1, dark, t.x);
      blob(cg, cx, cy - r * 0.6, r, r * 0.85, mid, t.x);
      blob(cg, cx - r * 0.25, cy - r * 0.85, r * 0.55, r * 0.45, light, t.x + 1);
      cg.fillStyle = hi; cg.fillRect(cx - Math.round(r * 0.4), cy - Math.round(r * 1.1), 1, 1);
    }
  }

  // ── replay preparation ────────────────────────────────────────────────────
  function setReplay(replay, colors) {
    rep = replay;
    dispScale = 0; dispTarget = 0;
    if (colors && colors.length === 2) aiColors = colors.slice();
    lastT = null;
    if (!rep || !rep.units) { P = null; return; }
    resize();
    idleMap = rep.map || FALLBACK_MAP;
    const hz = rep.hz || 5;
    const N = rep.hud ? rep.hud.length : rep.units[0].x.length;
    const prim = rep.sides.map(s => (s.colors && s.colors.primary) || '#6b7b5a');
    const sec = rep.sides.map(s => (s.colors && s.colors.secondary) || '#e8e0c8');
    if (colorDist(prim[0], prim[1]) < 70) prim[1] = aiColors[1];
    const sides = rep.sides.map((s, i) => ({ ...s, primary: prim[i], secondary: sec[i], sprites: buildWarSprites(prim[i], sec[i]) }));
    const units = rep.units.map((q, i) => ({ ...q, i, forms: [[-1, q.f0 || 0]], routT: [], fires: [], odo: new Float32Array(N), emp: [] }));
    for (const q of units) {
      let acc = 0;
      for (let f = 1; f < N; f++) {
        const dd = Math.hypot(q.x[f] - q.x[f - 1], q.y[f] - q.y[f - 1]);
        acc += dd < 200 ? dd : 0;
        q.odo[f] = acc;
      }
      for (let f = 1; f < N; f++) if (q.s[f] === ST.routing && q.s[f - 1] !== ST.routing) q.routT.push(f / hz);
      q.sp = dispSpacing(q.type);
      q.inf = !!INF[q.type];
    }
    const ev = rep.events || [];
    const fx = { fires: [], shells: [], booms: [], powers: [], kills: [], says: [], assaults: [], smokes: [], cruise: [], strikes: [], emps: [], sorties: [] };
    for (const e of ev) {
      const q = units[e.a];
      switch (e.k) {
        case 'form': if (q) q.forms.push([e.t, e.f]); break;
        case 'fire': fx.fires.push(e); if (q) q.fires.push(e.t); break;
        case 'shell': fx.shells.push(e); if (q) q.fires.push(e.t); break;
        case 'boom': fx.booms.push(e); break;
        case 'power':
          fx.powers.push(e);
          if (e.p === 'smoke') fx.smokes.push({ t0: e.t + (e.ft || 1), t1: e.t + (e.ft || 1) + 12, x: e.x, y: e.y, r: e.r, s: e.s });
          if (e.p === 'cruise') fx.cruise.push(e);
          if (e.p === 'airstrike' || e.p === 'carpet') fx.strikes.push(e);
          if (e.p === 'emp') fx.emps.push(e);
          break;
        case 'kill': fx.kills.push(e); break;
        case 'say': fx.says.push(e); break;
        case 'assault': fx.assaults.push(e); break;
        case 'sortie': fx.sorties.push(e); break;
        default: break;
      }
    }
    P = { hz, N, dur: rep.duration || (N - 1) / hz, sides, units, fx, end: ev.find(e => e.k === 'end') || null, hqs: [0, 1].map(s => units.findIndex(q => q.hq && q.side === s)) };
    // EMP: every vehicle, aircraft and ship inside the burst is disabled for 7 s
    for (const e of fx.emps) {
      const f = Math.round(e.t * hz);
      for (const q of units) {
        if (q.inf || q.s[clamp(f, 0, N - 1)] >= ST.dead) continue;
        if (Math.hypot(at(q.x, f) - e.x, at(q.y, f) - e.y) <= e.r + 24) q.emp.push([e.t, e.t + 7]);
      }
    }
    P.bodies = buildLosses();
    const decals = [];
    for (const bd of P.bodies) {
      if (bd.air) continue;
      decals.push(Object.assign({}, bd, { kind: bd.inf ? 'body' : bd.naval ? 'slick' : 'wreck', t: bd.t + (bd.inf ? 0.5 : 0.35) }));
    }
    for (const e of fx.booms) decals.push({ kind: 'crater', t: e.t + 0.25, x: e.x, y: e.y, e });
    for (const e of ev) if (e.k === 'dug' && units[e.a]) { const f = Math.round(e.t * hz); decals.push({ kind: 'dug', t: e.t, x: at(units[e.a].x, f), y: at(units[e.a].y, f), q: units[e.a], ang: at(units[e.a].a, f) * Math.PI / 180 }); }
    // tracks behind tracked vehicles
    for (const q of units) {
      if (!(q.type === 'tank' || q.type === 'antiair' || q.type === 'mammoth' || q.type === 'apc' || q.type === 'jeep' || q.type === 'mlrs' || q.type === 'hq')) continue;
      let last = -1e9;
      for (let f = 1; f < N; f++) {
        if (q.s[f] >= ST.dead || q.odo[f] - last < 26) continue;
        if (Math.hypot(q.x[f] - q.x[f - 1], q.y[f] - q.y[f - 1]) < 1) continue;
        last = q.odo[f];
        decals.push({ kind: 'track', t: f / hz, q, f });
      }
    }
    decals.sort((a, c) => a.t - c.t);
    P.decals = decals;
    decalT = -1; decalKey = '';
    P.feed = buildFeed(ev);
    P.moments = pickMoments(ev);
    resize();
    ensureGround(idleMap);
  }
  const at = (arr, f) => arr[clamp(f, 0, arr.length - 1)];

  function stateAt(q, t) {
    const fr = clamp(t * P.hz, 0, P.N - 1);
    const i = Math.floor(fr), j = Math.min(P.N - 1, i + 1), a = fr - i;
    const r = Math.min(P.N - 1, Math.round(fr));
    let x = lerp(q.x[i], q.x[j], a), y = lerp(q.y[i], q.y[j], a);
    let ang = lerpAngDeg(q.a[i], q.a[j], a) * Math.PI / 180;
    if (q.jet || q.fly) {
      // aircraft: a Catmull-Rom curve through the recorded points (no kinks at 5 Hz), heading along it
      const i0 = Math.max(0, i - 1), i3 = Math.min(P.N - 1, j + 1);
      const ok = [i0, i, j, i3].every(k => q.s[k] !== ST.away) && Math.hypot(q.x[j] - q.x[i], q.y[j] - q.y[i]) < 400;
      if (ok) {
        const cr = (p0, p1, p2, p3, u) => 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
        const dr = (p0, p1, p2, p3, u) => 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u * u);
        x = cr(q.x[i0], q.x[i], q.x[j], q.x[i3], a); y = cr(q.y[i0], q.y[i], q.y[j], q.y[i3], a);
        if (q.jet) {
          const dx = dr(q.x[i0], q.x[i], q.x[j], q.x[i3], a), dy = dr(q.y[i0], q.y[i], q.y[j], q.y[i3], a);
          if (Math.hypot(dx, dy) > 1) ang = Math.atan2(dy, dx);
        }
      }
    }
    return { x, y, ang, n: q.n[r], s: q.s[r], m: q.m[r], f: q.f[r], odo: lerp(q.odo[i], q.odo[j], a), vx: (q.x[j] - q.x[i]) * P.hz, vy: (q.y[j] - q.y[i]) * P.hz };
  }
  function formAt(q, t) {
    let cur = q.forms[0], prev = q.forms[0];
    for (const f of q.forms) { if (f[0] <= t) { prev = cur; cur = f; } else break; }
    return { code: cur[1], prevCode: prev[1], since: t - cur[0] };
  }
  // slots for `c` elements: [forward, lateral, row] in world units, front row first
  const layoutCache = new Map();
  function layout(q, form, c) {
    const key = `${q.type}|${form}|${q.n0}|${c}`;
    let L = layoutCache.get(key);
    if (L) return L;
    L = [];
    const n0 = q.n0;
    if (!q.inf) {
      const k = form === 2 ? 1.5 : 1;
      const sp = q.sp * k;
      const S = form === 1 ? [[0.9, 0], [0, 0], [-0.9, 0]] : n0 >= 3 ? [[0.45, 0], [-0.35, -0.95], [-0.35, 0.95]] : n0 === 2 ? [[0.25, -0.55], [-0.25, 0.55]] : [[0, 0]];
      for (let idx = 0; idx < c && idx < S.length; idx++) L.push([S[idx][0] * sp, S[idx][1] * sp, idx]);
    } else if (n0 <= 1) L.push([0, 0, 0]);
    else {
      const sp = q.sp * (form === 2 ? 1.6 : 1);
      const ranks = form === 1 ? Math.ceil(n0 / 2) : form === 2 ? Math.ceil(Math.sqrt(n0)) : n0 >= 10 ? 2 : 1;
      const files = Math.ceil(n0 / ranks);
      const rows0 = Math.ceil(n0 / files);
      const rows = Math.ceil(c / files);
      for (let rr = 0; rr < rows; rr++) {
        const inRow = Math.min(files, c - rr * files);
        for (let j = 0; j < inRow; j++) L.push([((rows0 - 1) / 2 - rr) * sp * (form === 1 ? 0.9 : 0.85), (j - (inRow - 1) / 2) * sp, rr]);
      }
    }
    layoutCache.set(key, L);
    return L;
  }
  function elemPos(q, st, fm, t, idx, L, Lprev, k) {
    let [fw, lt, row] = L[idx] || [0, 0, 0];
    if (Lprev && k < 1 && Lprev[idx]) { fw = lerp(Lprev[idx][0], fw, k); lt = lerp(Lprev[idx][1], lt, k); }
    const s1 = h2(q.i * 131 + idx, 7), s2 = h2(q.i * 131 + idx, 8);
    if (q.inf) {
      const loose = fm === 2;
      fw += (s1 - 0.5) * q.sp * (loose ? 0.7 : 0.25);
      lt += (s2 - 0.5) * q.sp * (loose ? 0.7 : 0.25);
      if (st.s === ST.routing) {
        const since = q.routT.length ? t - (q.routT.filter(x => x <= t + 0.2).slice(-1)[0] || t) : 1;
        const rs = clamp(since * 0.7, 0, 1.6);
        fw = fw * (1 + rs) + (s1 - 0.5) * 40 * rs; lt = lt * (1 + rs) + (s2 - 0.5) * 50 * rs;
      } else if (st.s === ST.assault) {
        fw += Math.max(0, Math.sin(t * 6 + idx * 1.9)) * 4; lt += Math.sin(t * 2.1 + idx) * 1.5;
      }
    } else if (q.fly && !q.jet) {
      fw += Math.sin(t * 0.8 + idx * 2) * 3; lt += Math.cos(t * 0.7 + idx) * 3;
    }
    const c = Math.cos(st.ang), s = Math.sin(st.ang);
    return [st.x + c * fw - s * lt, st.y + s * fw + c * lt];
  }

  // Losses: whenever a unit loses elements, they fall where they stood (soldiers) or are left as
  // burning wrecks (vehicles), sinking hulks (ships) or falling aircraft.
  function buildLosses() {
    const out = [];
    for (const q of P.units) {
      if (q.hq) {
        const f = q.s.findIndex(s => s === ST.dead);
        if (f > 0) { const st = stateAt(q, (f - 1) / P.hz); out.push({ x: st.x, y: st.y, ang: st.ang, t: (f - 0.5) / P.hz, side: q.side, type: 'hq', seed: q.i * 977, inf: false, naval: false, air: false }); }
        continue;
      }
      for (let f = 1; f < P.N; f++) {
        const lost = q.n[f - 1] - q.n[f];
        if (lost <= 0) continue;
        const t = (f - 0.5) / P.hz;
        const st = stateAt(q, (f - 1) / P.hz);
        const fm = formAt(q, t).code;
        const L = layout(q, fm, q.n[f - 1]);
        for (let j = 0; j < lost; j++) {
          const seed = q.i * 977 + f * 31 + j;
          let idx = q.inf ? Math.floor(h2(seed, 4) * L.length) : q.n[f - 1] - 1 - j;
          idx = clamp(idx, 0, L.length - 1);
          const [x, y] = elemPos(q, st, fm, (f - 1) / P.hz, idx, L, null, 1);
          out.push({ x: x + (q.inf ? (h2(seed, 5) - 0.5) * 6 : 0), y: y + (q.inf ? (h2(seed, 6) - 0.5) * 6 : 0), t, side: q.side, type: q.type, seed, flip: h2(seed, 9) < 0.5, ang: st.ang, inf: q.inf, naval: !!q.naval, air: !!q.fly, jet: !!q.jet, vx: st.vx, vy: st.vy });
        }
      }
    }
    out.sort((a, c) => a.t - c.t);
    return out;
  }

  // ── events for the ticker and sounds ──────────────────────────────────────
  function buildFeed(ev) {
    const out = [];
    const S = P.sides, Q = P.units;
    const who = (q) => (q ? `${S[q.side].label}'s ${q.name}` : '?');
    const mapName = (rep.map && rep.map.name) || 'the battlefield';
    out.push({ t: 0.05, k: 'start', side: 0, big: true, text: `${S[0].label}'s ${S[0].name} and ${S[1].label}'s ${S[1].name} deploy at ${mapName}!` });
    let contact = false;
    const firstShell = [false, false];
    for (const e of ev) {
      const a = Q[e.a], bq = Q[e.b];
      switch (e.k) {
        case 'fire': {
          const k = e.w === 'cannon' ? 'cannon' : e.w === 'rocket' ? 'rocket' : e.w === 'missile' ? 'missile' : e.w === 'aa' ? 'missile' : e.w === 'torpedo' ? 'torpedo' : e.w === 'sniper' ? 'sniper' : 'rifle';
          out.push({ t: e.t, k, side: e.s, big: !!(a && a.legend), text: null });
          if (!contact && e.t > 1) { contact = true; out.push({ t: e.t, k: 'contact', side: e.s, big: true, text: `Contact! ${who(a)} open fire on ${who(bq)}` }); }
          break;
        }
        case 'shell': {
          const naval = a && a.naval;
          out.push({ t: e.t, k: e.w === 'bomb' ? 'bombdrop' : naval ? 'naval' : 'artillery', side: e.s, big: e.n >= 3 || (a && a.legend), text: null });
          if (!firstShell[e.s] && e.w !== 'bomb') { firstShell[e.s] = true; out.push({ t: e.t, k: 'artillery', side: e.s, big: false, text: `${who(a)} open fire - shells in the air!` }); }
          break;
        }
        case 'boom': out.push({ t: e.t, k: 'explosion', side: e.s, big: e.w === 'bomb' || e.w === 'cruise' || e.r >= 85 || e.n >= 3, text: e.n >= 5 ? `A direct hit - ${Math.round(e.n)} down!` : null }); break;
        case 'kill': {
          if (!a) break;
          const txt = a.jet || a.fly ? `${who(a)}: one shot down!` : a.naval ? `${who(a)}: a ship is going down!` : null;
          out.push({ t: e.t, k: a.fly ? 'shotdown' : 'wreck', side: e.s, big: !!(a.fly || a.naval || a.legend), text: txt });
          break;
        }
        case 'destroyed': out.push({ t: e.t, k: 'destroyed', side: e.s, big: true, text: `${who(a)} ${a && (a.inf) ? 'have been wiped out' : 'destroyed'}` }); break;
        case 'hq': out.push({ t: e.t, k: 'hq', side: e.s, big: true, text: `${S[e.s].label}'s command post ${S[e.s].hq || ''} has been DESTROYED!` }); break;
        case 'rout': if (!e.end) out.push({ t: e.t, k: 'retreat', side: e.s, big: true, text: `${who(a)} ${e.br ? 'break and run!' : 'fall back!'}` }); break;
        case 'rally': out.push({ t: e.t, k: 'rally', side: e.s, big: false, text: `${who(a)} regroup and fight on!` }); break;
        case 'fled': out.push({ t: e.t, k: 'retreat', side: e.s, big: false, text: `${who(a)} left the battlefield` }); break;
        case 'assault': out.push({ t: e.t, k: 'assault', side: e.s, big: false, text: null }); break;
        case 'sortie': if (e.m === 'in' || (e.m === undefined)) out.push({ t: e.t, k: 'jet', side: e.s, big: false, text: null }); break;
        case 'power': {
          const names = { rally: 'sounds the RALLY', smoke: 'lays a SMOKE SCREEN', barrage: 'calls in an ARTILLERY BARRAGE', airstrike: 'calls in an AIRSTRIKE', cruise: 'launches a CRUISE MISSILE', emp: 'fires an EMP BURST', carpet: 'orders CARPET BOMBING' };
          out.push({ t: e.t, k: e.p === 'rally' ? 'rally' : e.p === 'smoke' ? 'smoke' : 'power', side: e.s, big: e.p !== 'smoke', text: `${S[e.s].label}'s command ${names[e.p] || e.p}!`, p: e.p });
          if (e.p === 'airstrike' || e.p === 'carpet') out.push({ t: e.t + Math.max(0, (e.ft || 2.5) - 1), k: 'jet', side: e.s, big: true, text: null });
          if (e.p === 'cruise') out.push({ t: e.t + 0.2, k: 'missile', side: e.s, big: true, text: null });
          break;
        }
        case 'say': out.push({ t: e.t, k: 'say', side: e.s, big: false, text: `${S[e.s].label}: "${e.text}"` }); break;
        case 'end': out.push({ t: e.t, k: 'victory', side: e.s < 0 ? 0 : e.s, big: true, text: (rep.result && rep.result.text) || 'The battle is over' }); break;
        default: break;
      }
    }
    // small arms: the rattle of the firefight, from the recorded fire targets
    for (let f = 0; f < P.N; f += 2) {
      const cnt = [0, 0], mg = [0, 0];
      for (const q of Q) {
        if (q.f[f] < 0 || !q.inf || q.s[f] >= ST.dead) continue;
        if (q.type === 'machinegun') mg[q.side]++; else cnt[q.side]++;
      }
      for (let s = 0; s < 2; s++) {
        if (mg[s]) out.push({ t: f / P.hz + s * 0.07, k: 'mg', side: s, big: mg[s] >= 2, text: null });
        else if (cnt[s]) out.push({ t: f / P.hz + s * 0.07, k: 'rifle', side: s, big: cnt[s] >= 3, text: null });
      }
    }
    out.sort((a, c) => a.t - c.t);
    return out;
  }
  function feedRange(t0, t1) {
    if (!P) return [];
    const F = P.feed;
    let lo = 0, hi = F.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (F[m].t <= t0) lo = m + 1; else hi = m; }
    const out = [];
    for (let i = lo; i < F.length && F[i].t <= t1; i++) out.push(F[i]);
    return out;
  }
  const SND_GAP = { rifle: 0.35, mg: 0.45, cannon: 0.18, rocket: 0.2, missile: 0.25, sniper: 0.4, torpedo: 0.5, artillery: 0.3, naval: 0.3, bombdrop: 0.5, explosion: 0.12, wreck: 0.3, shotdown: 0.4, assault: 0.4, jet: 1.2, retreat: 0.5 };
  function playSounds(t0, t1) {
    const fn = sound && typeof sound.modeEvent === 'function' ? sound.modeEvent : null;
    if (!fn) return;
    for (const e of feedRange(t0, t1)) {
      if (e.k === 'say' || e.k === 'contact') continue;
      const gap = SND_GAP[e.k] || 0;
      const key = `${e.k}|${e.side}`;
      if (gap && sndLast[key] !== undefined && e.t - sndLast[key] < gap && e.t >= sndLast[key]) continue;
      sndLast[key] = e.t;
      try { fn('war', { k: e.k, side: e.side, big: !!e.big, p: e.p }); } catch { /* sound is optional */ }
    }
  }

  // ── drawing helpers ───────────────────────────────────────────────────────
  function px(x, y, col, w = 1, h = 1) { b.fillStyle = col; b.fillRect(Math.round(x), Math.round(y), w, h); }
  function ringPx(cx, cy, r, col, step = 1) {
    b.fillStyle = col;
    const n = Math.max(8, Math.round(r * 5 / step));
    for (let i = 0; i < n; i++) { const a = i / n * TAU; b.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.8), 1, 1); }
  }
  // a pixel-art fade: a filled ellipse that keeps only a `keep` share of its pixels (a fixed pattern per seed)
  function dither(cx, cy, rx, ry, col, keep, seed) {
    if (keep <= 0.02) return;
    cx = Math.round(cx); cy = Math.round(cy);
    rx = Math.max(1, rx); ry = Math.max(1, ry);
    b.fillStyle = col;
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      const k = 1 - (y * y) / (ry * ry);
      if (k < 0) continue;
      const hw = Math.round(rx * Math.sqrt(k));
      if (keep >= 0.999) { b.fillRect(cx - hw, cy + y, hw * 2 + 1, 1); continue; }
      for (let x = -hw; x <= hw; x++) if (h3(x + seed, y, seed) < keep) b.fillRect(cx + x, cy + y, 1, 1);
    }
  }
  function discA(cx, cy, r, col, alpha) { if (alpha <= 0) return; b.globalAlpha = Math.min(1, alpha); b.fillStyle = col; blobA(b, Math.round(cx), Math.round(cy), r, r * 0.8); b.globalAlpha = 1; }
  function line(x0, y0, x1, y1, col) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, n = 0;
    b.fillStyle = col;
    for (;;) {
      b.fillRect(x0, y0, 1, 1);
      if ((x0 === x1 && y0 === y1) || ++n > 600) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function drawSprite(spr, x, y, alpha) {
    if (!spr) return;
    if (alpha !== undefined && alpha < 1) b.globalAlpha = Math.max(0, alpha);
    b.drawImage(spr.c, Math.round(x) - spr.ax, Math.round(y) - spr.ay);
    if (alpha !== undefined && alpha < 1) b.globalAlpha = 1;
  }
  function lastBefore(list, t) { let r = -99; for (const v of list) { if (v <= t) r = v; else break; } return r; }
  const empAt = (q, t) => q.emp.some(([a, c]) => t >= a && t <= c);

  // ── decals: craters, wrecks, tracks, foxholes, bodies ─────────────────────
  let decalCv = null, decalT = -1, decalKey = '';
  function paintDecal(g, d, pal) {
    if (d.kind === 'track') {
      const q = d.q, f = d.f;
      const st = { x: q.x[f], y: q.y[f], ang: q.a[f] * Math.PI / 180, s: q.s[f] };
      const n = q.n[f], fm = formAt(q, f / P.hz).code;
      const L = layout(q, fm, n);
      g.fillStyle = 'rgba(40,32,24,0.16)';
      for (let idx = 0; idx < n; idx++) {
        const [x, y] = elemPos(q, st, fm, f / P.hz, idx, L, null, 1);
        const c = Math.cos(st.ang), s = Math.sin(st.ang), w = q.type === 'mammoth' ? 5 : 3;
        for (const side of [-1, 1]) g.fillRect(X(x - s * side * w * 0.9 / K * 0.5), Y(y + c * side * w * 0.9 / K * 0.5), 1, 1);
      }
      return;
    }
    const cx = X(d.x), cy = Y(d.y);
    if (d.kind === 'crater') {
      const r = Math.max(1, d.e.r * K * (d.e.w === 'cruise' ? 0.3 : 0.16));
      const inWater = (rep.map.water || []).some(w => inRect(w, d.x, d.y)) && !(rep.map.bridges || []).some(w => inRect(w, d.x, d.y));
      if (inWater) return;
      g.globalAlpha = 0.14; g.fillStyle = pal.scorch; blobA(g, cx, cy, r * 2.2, r * 1.6);
      g.globalAlpha = 0.45; g.fillStyle = '#3a3026'; blobA(g, cx, cy, r, r * 0.7);
      g.globalAlpha = 0.35; g.fillStyle = '#8a7a5c'; g.fillRect(cx - Math.round(r), cy - Math.round(r * 0.7) - 1, Math.max(1, Math.round(r * 1.6)), 1);
      g.globalAlpha = 1;
      return;
    }
    if (d.kind === 'dug') {
      // sandbags in a shallow arc in front of the position
      g.fillStyle = '#b8a070';
      const r = Math.max(4, d.q.sp * Math.sqrt(d.q.n0) * 0.5 * K + 2);
      for (let i = -3; i <= 3; i++) { const a = d.ang + i * 0.26; g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.8), 2, 1); }
      g.fillStyle = '#8a7450';
      for (let i = -3; i <= 3; i += 2) { const a = d.ang + i * 0.26; g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.8) + 1, 2, 1); }
      return;
    }
    if (d.kind === 'slick') {
      g.globalAlpha = 0.35; g.fillStyle = '#10141a'; blobA(g, cx, cy, 7, 4); g.globalAlpha = 1;
      return;
    }
    if (d.kind === 'wreck') {
      g.globalAlpha = 0.16; g.fillStyle = pal.scorch; blobA(g, cx, cy, 5, 3.5); g.globalAlpha = 1;
      const spr = P.sides[d.side].sprites.top(d.type === 'hq' ? 'hq' : d.type, d.ang, 'wreck');
      if (spr) g.drawImage(spr.c, cx - spr.ax, cy - spr.ay);
      g.fillStyle = '#7a4a28'; g.fillRect(cx + Math.round((h2(d.seed, 3) - 0.5) * 4), cy + Math.round((h2(d.seed, 4) - 0.5) * 3), 1, 1);
      g.fillStyle = '#6a625a'; g.fillRect(cx + Math.round((h2(d.seed, 5) - 0.5) * 5), cy + Math.round((h2(d.seed, 6) - 0.5) * 3), 1, 1);
      return;
    }
    // a fallen soldier
    const side = P.sides[d.side];
    const put = (x, y, col, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h); };
    put(cx - 1, cy, shade(side.primary, 0.8), 3, 1);
    put(d.flip ? cx + 2 : cx - 2, cy, shade(side.primary, 0.55));
    if (h2(d.seed, 11) < 0.35) put(cx, cy + 1, '#6a1c16');
  }
  function drawDecals(t, pal) {
    const key = `${groundKey}|${bw}|${bh}`;
    if (!decalCv || decalKey !== key || t < decalT) {
      if (!decalCv) decalCv = document.createElement('canvas');
      decalCv.width = bw; decalCv.height = bh;
      decalKey = key; decalT = -1;
    }
    const g = decalCv.getContext('2d');
    const list = P.decals;
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t <= decalT) lo = m + 1; else hi = m; }
    for (let i = lo; i < list.length && list[i].t <= t; i++) paintDecal(g, list[i], pal);
    decalT = t;
    b.drawImage(decalCv, 0, 0);
  }

  // ── units ─────────────────────────────────────────────────────────────────
  const items = [];
  const elems = new Map();   // unit index -> [[screen x, screen y, lift]] of its elements this frame
  function collectUnits(t) {
    items.length = 0;
    elems.clear();
    const endT = P.end ? P.end.t : Infinity;
    const fi = clamp(Math.round(t * P.hz), 0, P.N - 1);
    for (const q of P.units) {
      const st = stateAt(q, t);
      if (st.s === ST.dead || st.s === ST.fled || st.s === ST.away || st.n <= 0) continue;
      const side = P.sides[q.side];
      const fm = formAt(q, t);
      const L = layout(q, fm.code, st.n);
      const k = clamp(fm.since / 1.2, 0, 1);
      const Lprev = k < 1 && fm.prevCode !== fm.code ? layout(q, fm.prevCode, st.n) : null;
      const list = [];
      elems.set(q.i, list);
      const firing = q.f[fi] >= 0;
      const emp = empAt(q, t);
      if (q.hq) {
        const sx = X(st.x), sy = Y(st.y);
        list.push([sx, sy, 0]);
        items.push({ y: sy, layer: 1, draw: () => drawHQ(q, st, side, t) });
        continue;
      }
      if (q.inf) {
        const set = side.sprites.soldiers[INF[q.type]];
        const cosA = Math.cos(st.ang);
        const flip = cosA < -0.2 ? true : cosA > 0.2 ? false : q.side === 1;
        const cheer = t > endT && P.end && P.end.s === q.side;
        const moving = st.s === ST.moving || st.s === ST.routing || Math.hypot(st.vx, st.vy) > 6;
        const tick = Math.floor(t * 10);
        for (let idx = 0; idx < st.n; idx++) {
          const [wx, wy] = elemPos(q, st, fm.code, t, idx, L, Lprev, k);
          let frame = 0, lift = 0;
          if (q.type === 'snipers') frame = firing && h3(q.i, idx, tick) < 0.08 ? 2 : 0;
          else if (moving) frame = Math.floor(st.odo / 6 + idx * 0.5) % 2;
          else if (q.type === 'machinegun' && (firing || st.s === ST.idle || st.s === ST.fighting)) frame = 2;
          else if (firing && h3(q.i, idx, tick) < (TRACER[q.type] ? TRACER[q.type].rate * 1.6 : 0.2)) frame = 2;
          if (cheer) lift = Math.max(0, Math.round(Math.sin(t * 9 + idx * 1.3) * 2));
          const sx = X(wx), sy = Y(wy);
          list.push([sx, sy - 3, 0]);
          const spr = set[frame] ? set[frame][flip ? 1 : 0] : set[0][flip ? 1 : 0];
          items.push({ y: sy, layer: 1, spr, x: sx, lift, alpha: st.s === ST.routing ? 0.9 : 1 });
        }
        continue;
      }
      // vehicles, helicopters, drones, jets, ships
      const layer = q.naval ? 0 : q.jet ? 4 : q.fly ? 3 : 1;
      const alt = ALT[q.type] || 0;
      for (let idx = 0; idx < st.n; idx++) {
        const [wx, wy] = elemPos(q, st, fm.code, t, idx, L, Lprev, k);
        const sx = X(wx), sy = Y(wy);
        const bob = q.fly && !q.jet ? Math.round(Math.sin(t * 2.2 + idx * 1.7 + q.i) * 1) : 0;
        const lift = alt + bob;
        list.push([sx, sy - lift, lift]);
        items.push({ y: sy, layer, draw: () => drawMachine(q, st, side, t, sx, sy, lift, idx, firing, emp) });
      }
    }
    items.sort((a, c) => (a.layer - c.layer) || (a.y - c.y));
  }
  function drawItems(layerLo, layerHi) {
    for (const it of items) {
      if (it.layer < layerLo || it.layer > layerHi) continue;
      if (it.draw) it.draw();
      else drawSprite(it.spr, it.x, it.y - it.lift, it.alpha);
    }
  }
  function unitTargetPos(q, st, t) {
    // where this unit's guns point: its fire target, else its heading
    const g = st.f;
    if (g >= 0 && P.units[g]) {
      const e = P.units[g];
      const es = stateAt(e, t);
      if (es.s < ST.dead) return { x: es.x, y: es.y, alt: ALT[e.type] || 0 };
    }
    return null;
  }
  function drawMachine(q, st, side, t, sx, sy, lift, idx, firing, emp) {
    const spr = side.sprites;
    const type = q.type;
    const ang = st.ang;
    if (q.naval) {
      // wake: foam behind the hull while under way
      const sp = Math.hypot(st.vx, st.vy);
      if (sp > 8) {
        const len = type === 'battleship' ? 16 : type === 'destroyer' ? 12 : 9;
        for (let j = 2; j < len; j += 1) {
          const bx = sx - Math.cos(ang) * j, by = sy - Math.sin(ang) * j;
          const wdt = j * 0.35;
          b.globalAlpha = 0.5 * (1 - j / len);
          px(bx - Math.sin(ang) * wdt, by + Math.cos(ang) * wdt, '#e8f4ff');
          px(bx + Math.sin(ang) * wdt, by - Math.cos(ang) * wdt, '#e8f4ff');
        }
        b.globalAlpha = 1;
      }
      const alpha = type === 'submarine' ? 0.5 : 1;
      drawSprite(spr.top(type, ang), sx, sy, alpha);
      if (type === 'submarine') { if (sp > 8) px(sx + Math.cos(ang) * 3, sy + Math.sin(ang) * 3, '#e8f4ff'); }
    } else if (q.fly) {
      // shadow on the ground, then the aircraft up in the air
      const sh = spr.top(type, ang, 'shadow');
      if (sh) { b.globalAlpha = q.jet ? 0.18 : 0.25; b.drawImage(sh.c, sx - sh.ax + Math.round(lift * 0.35), sy - sh.ay + Math.round(lift * 0.2)); b.globalAlpha = 1; }
      const yy = sy - lift;
      if (q.jet) {
        // contrails from the wingtips, afterburner
        for (let j = 1; j <= 7; j++) {
          const p = stateAt(q, t - j * 0.07);
          if (p.s === ST.away) break;
          const tx = X(p.x), ty = Y(p.y) - lift;
          const wv = type === 'fighter' ? 3 : 5;
          b.globalAlpha = 0.28 - j * 0.035;
          px(tx - Math.sin(p.ang) * wv, ty + Math.cos(p.ang) * wv, '#ffffff');
          px(tx + Math.sin(p.ang) * wv, ty - Math.cos(p.ang) * wv, '#ffffff');
        }
        b.globalAlpha = 1;
        if (type !== 'stealthbomber' && Math.floor(t * 20 + idx) % 2 === 0) px(sx - Math.cos(ang) * 6, yy - Math.sin(ang) * 6, '#ffb040');
      }
      drawSprite(spr.top(type, ang), sx, yy, emp ? 0.7 : 1);
      if (type === 'helicopter' && !emp) {
        const [rx, ry] = spr.mount(type, TOP.helicopter.rotor, ang);
        const hx = sx + rx, hy = yy + ry;
        const ra = t * 23 + idx;
        b.globalAlpha = 0.75;
        for (const o of [0, Math.PI / 2]) line(hx - Math.cos(ra + o) * 6, hy - Math.sin(ra + o) * 6, hx + Math.cos(ra + o) * 6, hy + Math.sin(ra + o) * 6, '#cfd4da');
        b.globalAlpha = 0.12; ringPx(hx, hy, 6, '#ffffff', 2); b.globalAlpha = 1;
      }
      if (type === 'drone' && Math.floor(t * 16) % 2) px(sx - Math.cos(ang) * 4, yy - Math.sin(ang) * 4, '#dfe6ee');
    } else {
      // ground vehicle: shadow, hull, dust
      const sh = spr.top(type, ang, 'shadow');
      if (sh) { b.globalAlpha = 0.3; b.drawImage(sh.c, sx - sh.ax + 1, sy - sh.ay + 1); b.globalAlpha = 1; }
      const sp = Math.hypot(st.vx, st.vy);
      if (sp > 20 && (rep.map.palette === 'desert' || type === 'jeep')) {
        for (let j = 1; j <= 3; j++) discA(sx - Math.cos(ang) * (5 + j * 3), sy - Math.sin(ang) * (5 + j * 3), 1 + j * 0.6, P.pal.dust, 0.3 - j * 0.07);
      }
      drawSprite(spr.top(type, ang), sx, sy);
    }
    // guns: turrets turn toward the fire target
    const guns = GUNS[type];
    if (guns) {
      const tp = firing ? unitTargetPos(q, st, t) : null;
      const recoil = t - lastBefore(q.fires, t) < 0.15;
      for (const [mk, len, twin] of guns) {
        const [mx, my] = spr.mount(type, TOP[type][mk], ang);
        const gx = sx + mx, gy = sy - (q.fly ? lift : 0) + my;
        let ga = ang;
        if (tp) ga = Math.atan2(Y(tp.y) - tp.alt - gy, X(tp.x) - gx);
        if (mk === 'turret3' && !tp) ga = ang + Math.PI;
        const tcol = side.sprites.pal.Q;
        const tw = type === 'mammoth' || type === 'battleship' ? 4 : type === 'tank' || type === 'destroyer' ? 3 : 2;
        const o2 = Math.floor(tw / 2);
        px(gx - o2 - 1, gy - o2 - 1, 'rgba(12,12,16,0.7)', tw + 2, tw + 2);
        px(gx - o2, gy - o2, q.naval ? '#6a727e' : side.sprites.pal.p, tw, tw);
        px(gx - o2, gy - o2, q.naval ? '#a4acb8' : tcol, tw - 1, tw - 1);
        const L2 = len - (recoil && mk === 'turret' ? 1 : 0);
        const col = q.naval ? '#2c3038' : '#1e2024';
        const c = Math.cos(ga), s = Math.sin(ga);
        if (twin) { line(gx - s + c * o2, gy + c + s * o2, gx - s + c * L2, gy + c + s * L2, col); line(gx + s + c * o2, gy - c + s * o2, gx + s + c * L2, gy - c + s * L2, col); }
        else line(gx + c * o2, gy + s * o2, gx + c * L2, gy + s * L2, col);
        if (recoil && mk === 'turret') { px(gx + c * (L2 + 1) - 1, gy + s * (L2 + 1) - 1, '#fff4b0', 3, 3); px(gx + c * (L2 + 1), gy + s * (L2 + 1), '#ffffff'); }
      }
    }
    if (emp) {
      // EMP: blue sparks crawling over the hull
      const tk = Math.floor(t * 14);
      for (let i = 0; i < 3; i++) if (h3(q.i * 7 + idx, tk, i) < 0.6) px(sx + (h3(tk, i, q.i) - 0.5) * 10, sy - (q.fly ? lift : 0) + (h3(i, tk, idx) - 0.5) * 8, i % 2 ? '#9ae8ff' : '#ffffff');
    }
  }
  function drawHQ(q, st, side, t) {
    const sx = X(st.x), sy = Y(st.y);
    const spr = side.sprites;
    const sh = spr.top('hq', st.ang, 'shadow');
    if (sh) { b.globalAlpha = 0.3; b.drawImage(sh.c, sx - sh.ax + 1, sy - sh.ay + 1); b.globalAlpha = 1; }
    drawSprite(spr.top('hq', st.ang), sx, sy);
    // radar dish turning, antennas
    const ra = t * 2.4 + q.side;
    line(sx - Math.cos(ra) * 3, sy - 1 - Math.sin(ra) * 1.5, sx + Math.cos(ra) * 3, sy - 1 + Math.sin(ra) * 1.5, '#dfe6ee');
    line(sx - 4, sy - 2, sx - 4, sy - 9, '#2a2c30');
    px(sx - 4, sy - 10, Math.floor(t * 2) % 2 ? '#ff5a4a' : '#7a2a24');
    // the flag with the army emblem
    const dir = q.side === 0 ? -1 : 1;
    const bx = sx + dir * 6, top = sy - 20;
    px(bx, top, '#2a2c30', 1, 18);
    const fw = 9, fh = 7;
    for (let i = 0; i < fw; i++) {
      const wave = Math.round(Math.sin(t * 4 + i * 0.7) * 1);
      const x = dir < 0 ? bx - 1 - i : bx + 1 + i;
      px(x, top + wave, side.primary, 1, fh);
      px(x, top + wave + fh, shade(side.primary, 0.6), 1, 1);
    }
    const em = EMBLEM[side.emblem] || EMBLEM.star;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      if (em[j][i] !== '1') continue;
      const col = i + 2;
      const x = dir < 0 ? bx - 1 - col : bx + 1 + col;
      const wave = Math.round(Math.sin(t * 4 + col * 0.7) * 1);
      px(x, top + 1 + j + wave, side.secondary);
    }
    const my = sy - 26 - Math.round(Math.sin(t * 3) * 1);
    px(sx - 1, my, aiColors[q.side], 3, 1); px(sx, my + 1, aiColors[q.side]); px(sx, my - 1, aiColors[q.side]);
    if (st.m < 100) {
      const w = 14, fill = Math.round(w * clamp(st.m, 0, 100) / 100);
      px(sx - 7, sy + 7, '#1b1a22', w + 2, 3);
      px(sx - 6, sy + 8, st.m > 50 ? '#5ad06a' : st.m > 25 ? '#ffd166' : '#ff5a4a', fill, 1);
    }
  }
  function drawMarkers(t) {
    // a small AI-colour pip over every unit on the ground and at sea; a white flag over retreating ones
    for (const q of P.units) {
      if (q.hq || q.jet) continue;
      const list = elems.get(q.i);
      if (!list || !list.length) continue;
      const st = stateAt(q, t);
      let cx = 0, top = Infinity;
      for (const [x, y] of list) { cx += x; top = Math.min(top, y); }
      cx = Math.round(cx / list.length);
      const y = top - (q.inf ? 9 : q.naval ? 7 : 8);
      if (st.s === ST.routing) {
        if (Math.floor(t * 3 + q.i) % 2 === 0) { px(cx, y - 3, '#d8d8d0', 1, 5); px(cx + 1, y - 3, '#ffffff', 3, 2); }
        continue;
      }
      px(cx - 1, y, aiColors[q.side], 3, 1); px(cx, y + 1, aiColors[q.side]);
      if (q.legend) { px(cx - 2, y - 1, '#ffd35a', 5, 1); }
    }
  }

  // ── gunfire: tracers from the recorded fire targets ───────────────────────
  function drawTracers(t) {
    const fi = clamp(Math.round(t * P.hz), 0, P.N - 1);
    const tick = Math.floor(t * 10), ph = t * 10 - tick;
    for (const q of P.units) {
      const g = q.f[fi];
      if (g < 0 || q.s[fi] >= ST.dead || q.s[fi] === ST.away) continue;
      const spec = TRACER[q.type];
      if (!spec || !spec.rate) continue;
      const e = P.units[g];
      if (!e) continue;
      const es = stateAt(e, t);
      if (es.s >= ST.dead) continue;
      const tx = X(es.x), ty = Y(es.y) - (ALT[e.type] || 0);
      const list = elems.get(q.i);
      if (!list || !list.length) continue;
      if (empAt(q, t)) continue;
      const shooters = Math.min(list.length, q.inf ? 8 : 3);
      let hits = 0;
      for (let k = 0; k < shooters; k++) {
        const idx = Math.floor(h3(q.i, k, tick >> 2) * list.length);
        if (h3(q.i, idx + k * 13, tick) >= spec.rate) continue;
        const [sx, sy] = list[idx];
        const jx = (h3(idx, tick, q.i) - 0.5) * 8, jy = (h3(tick, idx, q.i) - 0.5) * 6;
        const ex = tx + jx, ey = ty + jy;
        const p0 = ph, p1 = Math.min(1, ph + spec.len * 3);
        const ax = lerp(sx, ex, p0), ay = lerp(sy, ey, p0), bx = lerp(sx, ex, p1), by = lerp(sy, ey, p1);
        line(ax, ay, bx, by, spec.col);
        if (spec.thick) line(ax + 1, ay, bx + 1, by, shade(spec.col, 0.8));
        if (ph < 0.3) px(sx + Math.sign(ex - sx), sy, '#fff4b0');
        hits++;
        if (spec.flak && (ALT[e.type] || 0) > 0 && h3(tick, k, q.i) < 0.5) {
          // flak bursts around aircraft
          const fx2 = tx + (h3(k, tick, 3) - 0.5) * 16, fy2 = ty + (h3(tick, k, 4) - 0.5) * 12;
          discA(fx2, fy2, 1.5 + ph * 1.5, '#5a5a5a', 0.6 * (1 - ph));
          if (ph < 0.25) px(fx2, fy2, '#ffb040');
        }
      }
      // dust kicked up around a ground target
      if (hits && !(ALT[e.type] || 0) && !e.naval) {
        for (let k = 0; k < 2; k++) if (h3(g, tick, k) < 0.5) px(tx + (h3(k, g, tick) - 0.5) * 14, ty + (h3(tick, k, g) - 0.5) * 10 + 2, P.pal.dust);
      }
    }
  }

  // ── big guns, missiles, shells, bombs ─────────────────────────────────────
  function shooterPos(q, t) {
    const st = stateAt(q, t);
    return { x: X(st.x), y: Y(st.y) - (ALT[q.type] || 0), st };
  }
  function targetPos(gid, t) {
    const e = P.units[gid];
    if (!e) return null;
    const st = stateAt(e, t);
    return { x: X(st.x), y: Y(st.y) - (ALT[e.type] || 0), st, e };
  }
  function drawFires(t) {
    const F = P.fx.fires;
    for (let i = 0; i < F.length; i++) {
      const e = F[i];
      if (e.t > t) break;
      const life = (e.ft || 0) + 0.45;
      if (t - e.t > life) continue;
      const q = P.units[e.a];
      if (!q) continue;
      const age = t - e.t;
      const s = shooterPos(q, e.t);
      if (e.w === 'cannon' || e.w === 'sniper') {
        const d = targetPos(e.b, e.t);
        if (!d) continue;
        if (age < 0.07) line(s.x, s.y, d.x, d.y, e.w === 'sniper' ? 'rgba(255,255,255,0.8)' : '#fff0b0');
        if (age < 0.12 && e.w === 'cannon') discA(s.x + Math.cos(s.st.ang) * 6, s.y + Math.sin(s.st.ang) * 6, 2.5, '#fff4b0', 0.9);
        if (age < 0.35) { discA(d.x, d.y, 1.5 + age * 8, '#ffb040', 0.8 * (1 - age / 0.35)); discA(d.x, d.y - age * 10, 1 + age * 6, '#7a7066', 0.5 * (1 - age / 0.35)); }
        continue;
      }
      // guided: rocket, missile, aa, torpedo - flies from shooter to where the target is
      const ft = Math.max(0.05, e.ft || 0.3);
      const k = clamp(age / ft, 0, 1);
      const d = targetPos(e.b, Math.min(t, e.t + ft));
      if (!d) continue;
      if (e.w === 'torpedo') {
        const x = lerp(s.x, d.x, k), y = lerp(s.y, d.y, k);
        for (let j = 0; j < 8; j++) { const kk = Math.max(0, k - j * 0.03); b.globalAlpha = 0.7 - j * 0.08; px(lerp(s.x, d.x, kk), lerp(s.y, d.y, kk), '#e8f4ff'); }
        b.globalAlpha = 1;
        if (k >= 1 && age - ft < 0.45) { discA(d.x, d.y, 3 + (age - ft) * 14, '#e8f4ff', 0.8 * (1 - (age - ft) / 0.45)); }
        else px(x, y, '#ffffff');
        continue;
      }
      if (k < 1) {
        const arc = e.w === 'aa' ? 0 : Math.hypot(d.x - s.x, d.y - s.y) * 0.12;
        const pos = (kk) => [lerp(s.x, d.x, kk), lerp(s.y, d.y, kk) - arc * 4 * kk * (1 - kk)];
        const trail = e.w === 'aa' ? '#f4f4f4' : '#b8b4ac';
        for (let j = 7; j >= 1; j--) { const [x, y] = pos(Math.max(0, k - j * 0.045)); b.globalAlpha = 0.07 * (8 - j); px(x, y, trail, 2, 1); }
        b.globalAlpha = 1;
        const [mx, my] = pos(k);
        px(mx, my, '#e8e8e0'); px(mx - Math.sign(d.x - s.x), my, Math.floor(t * 30) % 2 ? '#ffb040' : '#fff4b0');
      } else if (age - ft < 0.45) {
        const a2 = (age - ft) / 0.45;
        discA(d.x, d.y, 2 + a2 * 5, '#ffb040', 0.9 * (1 - a2));
        discA(d.x, d.y - a2 * 6, 1.5 + a2 * 4, '#8a8076', 0.6 * (1 - a2));
        if (a2 < 0.2) px(d.x - 1, d.y - 1, '#ffffff', 3, 3);
      }
    }
  }
  function drawShells(t) {
    for (const e of P.fx.shells) {
      if (e.t > t) break;
      const n = Math.max(1, e.n || 1);
      const ft = Math.max(0.1, e.ft || 1);
      const last = ft + (n - 1) * 0.25;
      const age = t - e.t;
      if (age > last + 0.1) continue;
      const q = P.units[e.a];
      if (!q) continue;
      const s = shooterPos(q, e.t);
      const tx = X(e.x), ty = Y(e.y);
      if (e.w === 'bomb') {
        // bombs fall from the aircraft, carried forward a little
        for (let i = 0; i < n; i++) {
          const k = clamp((age - i * 0.25) / ft, 0, 1);
          if (age - i * 0.25 < 0 || k >= 1) continue;
          const ox = (h3(e.a, i, Math.round(e.t * 10)) - 0.5) * 10;
          const x = lerp(s.x, tx + ox, k), y = lerp(s.y, ty, k * k);
          px(x, y, '#2a2c30', 2, 2); px(x, y, '#5a5e66');
        }
        continue;
      }
      if (age < 0.18) {
        // muzzle blast
        discA(s.x + Math.cos(s.st.ang) * 5, s.y + Math.sin(s.st.ang) * 5, 3 + age * 16, '#fff4b0', 0.9 * (1 - age / 0.18));
        discA(s.x, s.y - 2, 3 + age * 22, '#9a948a', 0.35 * (1 - age / 0.18));
      }
      const dist = Math.hypot(tx - s.x, ty - s.y);
      const H = dist * (e.w === 'salvo' ? 0.22 : 0.3);
      for (let i = 0; i < Math.min(n, 12); i++) {
        const t0 = i * 0.25 * (e.w === 'salvo' ? 0.4 : 1);
        const k = (age - t0) / ft;
        if (k < 0 || k >= 1) continue;
        const jx = (h3(e.a, i, 5) - 0.5) * e.r * K * 0.9, jy = (h3(i, e.a, 6) - 0.5) * e.r * K * 0.7;
        const x = lerp(s.x, tx + jx, k), y = lerp(s.y, ty + jy, k) - H * 4 * k * (1 - k);
        if (e.w === 'salvo') {
          for (let j = 1; j <= 4; j++) { const kk = Math.max(0, k - j * 0.04); b.globalAlpha = 0.5 - j * 0.1; px(lerp(s.x, tx + jx, kk), lerp(s.y, ty + jy, kk) - H * 4 * kk * (1 - kk), '#d8d4cc'); }
          b.globalAlpha = 1;
          px(x, y, '#ffb040');
        } else { px(x, y, '#3a3c40', 2, 2); px(x, y, '#8a8e96'); }
      }
    }
  }
  function drawBooms(t) {
    for (const e of P.fx.booms) {
      if (e.t > t) break;
      const age = t - e.t;
      const big = e.w === 'bomb' || e.w === 'cruise' || e.r >= 85;
      const life = e.w === 'cruise' ? 3.2 : big ? 2.2 : 1.6;
      if (age > life) continue;
      const cx = X(e.x), cy = Y(e.y), R = Math.max(2, e.r * K * (e.w === 'cruise' ? 0.9 : 0.6));
      const water = (rep.map.water || []).some(w => inRect(w, e.x, e.y)) && !(rep.map.bridges || []).some(w => inRect(w, e.x, e.y));
      const seed = Math.round(e.t * 100) + (e.x | 0);
      if (water) {
        // a white water column
        const k = age / life;
        for (let i = 0; i < 14; i++) { const a = h2(i, seed) * TAU, d = R * 0.6 * h2(seed, i); const hgt = Math.sin(Math.min(1, age / 0.9) * Math.PI) * (8 + 10 * h2(i, 3)); px(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.6 - hgt, i % 3 ? '#e8f4ff' : '#9ac4e8'); }
        b.globalAlpha = 0.6 * (1 - k); ringPx(cx, cy, R * (0.4 + k), '#e8f4ff', 1); b.globalAlpha = 1;
        continue;
      }
      if (age < 0.05) dither(cx, cy, R * 0.8, R * 0.62, '#ffffff', 1, seed);
      if (big && age < 0.3) { b.globalAlpha = 0.8 * (1 - age / 0.3); ringPx(cx, cy, R * (0.5 + age * 6), '#fff4d0', 1); b.globalAlpha = 1; }
      // smoke rising and drifting (under the fire)
      const ks = age / life;
      const nS = big ? 6 : 4;
      if (age > 0.12) for (let i = 0; i < nS; i++) {
        const a = h2(i, seed) * TAU, d = R * 0.45 * h2(seed, i);
        const x = cx + Math.cos(a) * d + ks * 9 * h2(i, 7), y = cy + Math.sin(a) * d * 0.6 - ks * (10 + 9 * h2(i, 9)) - 2;
        const keep = clamp((1 - ks) * 1.15, 0, 1) * clamp((age - 0.12) / 0.2, 0, 1);
        dither(x, y, R * (0.22 + ks * 0.38), R * (0.18 + ks * 0.3), i % 2 ? '#6a6660' : '#8a8680', keep, seed + i);
      }
      // the fireball: opaque pixel fire that breaks up as it cools
      const kf = clamp(age / 0.5, 0, 1);
      if (kf < 1) {
        dither(cx, cy - kf * 3, R * (0.42 + kf * 0.35), R * (0.34 + kf * 0.28), '#d8401c', 1 - kf, seed + 11);
        dither(cx, cy - kf * 4, R * (0.32 + kf * 0.25), R * (0.26 + kf * 0.2), '#ff8a20', 1 - kf * 1.1, seed + 12);
        dither(cx, cy - kf * 5, R * (0.2 + kf * 0.1), R * (0.16 + kf * 0.08), '#ffd35a', 1 - kf * 1.4, seed + 13);
        if (kf < 0.35) dither(cx, cy - 1, R * 0.12, R * 0.1, '#fff4b0', 1, seed);
      }
      // debris
      if (age < 0.8) {
        const nD = big ? 16 : 9;
        for (let i = 0; i < nD; i++) {
          const a = h2(i, seed + 3) * TAU, sp = 0.5 + h2(seed + 3, i);
          const d = R * age * 2.2 * sp;
          px(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.6 - (18 * age - 22 * age * age) * sp, i % 3 ? '#3a3026' : '#ffb040');
        }
      }
    }
  }
  function drawLosses(t, pal) {
    // burning wrecks, falling aircraft, sinking ships, fallen soldiers
    for (let i = P.bodies.length - 1; i >= 0; i--) {
      const bd = P.bodies[i];
      if (bd.t > t) continue;
      const age = t - bd.t;
      if (age > 14) { if (age > 40) break; continue; }
      if (bd.inf) {
        if (age < 0.5) { const k = age / 0.5; const side = P.sides[bd.side]; px(X(bd.x) - 1, Y(bd.y) - 4 + Math.round(k * 3), side.primary, 2, 3 - Math.round(k * 2)); }
        continue;
      }
      const cx = X(bd.x), cy = Y(bd.y);
      if (bd.air) {
        // an aircraft going down: it keeps some speed, spins, trails smoke, then hits the ground
        const fall = bd.jet ? 1.3 : 1.0;
        const alt = ALT[bd.type] || 8;
        if (age < fall) {
          const k = age / fall;
          const x = cx + bd.vx * K * age * 0.6, y = cy + bd.vy * K * age * 0.6 - alt * (1 - k * k);
          for (let j = 1; j <= 6; j++) { const kk = Math.max(0, k - j * 0.05), aa = age - j * 0.05 * fall; discA(cx + bd.vx * K * aa * 0.6, cy + bd.vy * K * aa * 0.6 - alt * (1 - kk * kk), 1 + j * 0.3, '#4a4642', 0.5 - j * 0.07); }
          const spr = P.sides[bd.side].sprites.top(bd.type, bd.ang + age * 6, 'body');
          drawSprite(spr, x, y, 0.95);
          px(x, y, Math.floor(t * 20) % 2 ? '#ff7a20' : '#ffd35a');
        } else if (age < fall + 1.2) {
          const k = (age - fall) / 1.2, gx = cx + bd.vx * K * fall * 0.6, gy = cy + bd.vy * K * fall * 0.6;
          if (k < 0.1) discA(gx, gy, 6, '#ffffff', 0.8);
          discA(gx, gy - k * 4, 3 + k * 6, '#ff7a20', 0.8 * (1 - k));
          discA(gx, gy - k * 8, 2 + k * 6, '#4a4642', 0.5 * (1 - k));
        }
        continue;
      }
      if (bd.naval) {
        // sinking: the hull fades into the water, fire and smoke above it
        if (age < 4) {
          const spr = P.sides[bd.side].sprites.top(bd.type, bd.ang + age * 0.08, 'body');
          drawSprite(spr, cx, cy + age * 0.5, 0.9 * (1 - age / 4));
        }
        if (age < 8) fireAt(cx, cy, t, bd.seed, 1 - age / 8, true);
        continue;
      }
      // a burning wreck: flames for a few seconds, smoke for longer
      const burn = bd.type === 'hq' || bd.type === 'mammoth' ? 14 : 9;
      if (age < burn) fireAt(cx, cy, t, bd.seed, 1 - age / burn, age < burn * 0.6);
      if (age < 0.3) discA(cx, cy, 5 + age * 12, '#ffd35a', 0.9 * (1 - age / 0.3));
    }
  }
  function fireAt(cx, cy, t, seed, k, flames) {
    const tick = Math.floor(t * 12);
    if (flames) for (let i = 0; i < 4; i++) { if (h3(seed, tick, i) < 0.35) continue; px(cx + (h3(i, seed, tick) - 0.5) * 5, cy - 1 - h3(tick, i, seed) * 4, i % 2 ? '#ff7a20' : '#ffd35a'); }
    // a smoke column drifting with the wind
    for (let j = 0; j < 6; j++) {
      const ph = ((t * 0.7 + j / 6 + h2(seed, j)) % 1);
      const x = cx + ph * 10 + Math.sin(t + j) * 1.5, y = cy - 3 - ph * 22;
      discA(x, y, 1.2 + ph * 3.2, j % 2 ? '#5e5a56' : '#7a7670', 0.32 * (1 - ph) * k);
    }
  }
  function drawAssaults(t) {
    const fi = clamp(Math.round(t * P.hz), 0, P.N - 1);
    const tick = Math.floor(t * 12);
    for (const q of P.units) {
      if (q.s[fi] !== ST.assault) continue;
      const list = elems.get(q.i);
      if (!list) continue;
      for (let i = 0; i < 2; i++) {
        if (h3(q.i, tick, i) > 0.5) continue;
        const [x, y] = list[Math.floor(h3(tick, q.i, i) * list.length)];
        px(x + (h3(i, tick, 3) - 0.5) * 4, y - 1, i ? '#fff4b0' : '#ffffff');
      }
    }
  }

  // ── support powers ────────────────────────────────────────────────────────
  function drawSmokes(t) {
    for (const s of P.fx.smokes) {
      if (t < s.t0 - 1 || t > s.t1 + 2.5) continue;
      if (t < s.t0) {
        // canisters popping
        const k = (t - (s.t0 - 1));
        for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; px(X(s.x + Math.cos(a) * s.r * 0.5 * k), Y(s.y + Math.sin(a) * s.r * 0.5 * k), '#d8d8d0'); }
        continue;
      }
      const fadeIn = clamp((t - s.t0) / 1.5, 0, 1), fadeOut = clamp((s.t1 + 2.5 - t) / 2.5, 0, 1);
      const a0 = 0.62 * fadeIn * fadeOut;
      const R = s.r * K;
      for (let i = 0; i < 22; i++) {
        const a = h2(i, s.x | 0) * TAU, d = Math.sqrt(h2(s.y | 0, i)) * R * 0.85;
        const x = X(s.x) + Math.cos(a) * d + Math.sin(t * 0.6 + i) * 2 + (t - s.t0) * 0.6;
        const y = Y(s.y) + Math.sin(a) * d * 0.75 + Math.cos(t * 0.5 + i * 1.3) * 1.5;
        const r = R * (0.22 + 0.14 * h2(i, 3)) * (0.7 + 0.3 * fadeIn);
        discA(x, y, r + 1, '#8a8a86', a0 * 0.8);
        discA(x - 1, y - 1, r, i % 3 ? '#cfcfc8' : '#e8e8e2', a0);
      }
    }
  }
  function drawPowers(t) {
    for (const e of P.fx.powers) {
      if (e.t > t) break;
      const age = t - e.t;
      const cx = X(e.x), cy = Y(e.y);
      if (e.p === 'rally' && age < 1.2) { b.globalAlpha = 0.8 * (1 - age / 1.2); ringPx(cx, cy, e.r * K * (age / 1.2), '#ffd35a', 1); b.globalAlpha = 1; }
      if (e.p === 'emp' && age < 1.2) {
        const k = age / 1.2;
        if (age < 0.12) { b.globalAlpha = 0.25; b.fillStyle = '#bfe6ff'; b.fillRect(0, 0, bw, bh); b.globalAlpha = 1; }
        b.globalAlpha = 0.9 * (1 - k); ringPx(cx, cy, e.r * K * Math.min(1, k * 2.5), '#9ae8ff', 1); ringPx(cx, cy, e.r * K * Math.min(1, k * 2.5) - 2, '#ffffff', 2); b.globalAlpha = 1;
        for (let i = 0; i < 10; i++) {
          const a = h2(i, Math.round(e.t * 10)) * TAU, r = e.r * K * Math.min(1, k * 2.5);
          let x = cx, y = cy;
          b.fillStyle = '#dff4ff';
          for (let s = 1; s <= 6; s++) { const nx = cx + Math.cos(a + (h3(i, s, 2) - 0.5) * 0.4) * r * s / 6, ny = cy + Math.sin(a + (h3(i, s, 3) - 0.5) * 0.4) * r * s / 6 * 0.8; if (Math.floor(t * 20 + i) % 3) line(x, y, nx, ny, '#bfe6ff'); x = nx; y = ny; }
        }
      }
      if ((e.p === 'barrage' || e.p === 'airstrike' || e.p === 'carpet' || e.p === 'cruise') && age < (e.ft || 3) + 0.3) {
        // the target marker: a blinking crosshair while the strike is inbound
        if (Math.floor(age * 4) % 2 === 0) {
          const r = Math.max(4, (e.p === 'barrage' ? e.r : e.p === 'cruise' ? e.r : 40) * K * 0.6);
          const col = aiColors[e.s];
          b.globalAlpha = 0.8;
          ringPx(cx, cy, r, col, 2);
          px(cx - r - 2, cy, col, 3, 1); px(cx + r, cy, col, 3, 1); px(cx, cy - r * 0.8 - 2, col, 1, 3); px(cx, cy + r * 0.8, col, 1, 3);
          b.globalAlpha = 1;
        }
      }
    }
    // barrage shells coming in from off the map, bombs falling from the strike aircraft
    const hq = new Set(P.hqs);
    for (const e of P.fx.booms) {
      if (!hq.has(e.a)) continue;
      if (e.w === 'bomb') {
        const k = (t - (e.t - 0.45)) / 0.45;
        if (k < 0 || k >= 1) continue;
        const dir = e.s === 0 ? -1 : 1;
        const x = X(e.x) + dir * 10 * (1 - k), y = Y(e.y) - 20 * (1 - k * k);
        px(x, y, '#2a2c30', 2, 2); px(x, y, '#6a6e76');
        continue;
      }
      if (e.w !== 'shell') continue;
      const k = (t - (e.t - 0.5)) / 0.5;
      if (k < 0 || k >= 1) continue;
      const dir = e.s === 0 ? -1 : 1;
      const x0 = X(e.x) + dir * 40, y0 = Y(e.y) - 70;
      const x = lerp(x0, X(e.x), k), y = lerp(y0, Y(e.y), k);
      line(lerp(x0, X(e.x), Math.max(0, k - 0.12)), lerp(y0, Y(e.y), Math.max(0, k - 0.12)), x, y, 'rgba(255,240,200,0.7)');
      px(x, y, '#ffffff');
    }
    // cruise missiles: from our edge, low and fast, trailing smoke
    for (const e of P.fx.cruise) {
      const ft = e.ft || 4;
      const age = t - e.t;
      if (age < 0 || age > ft) continue;
      const k = age / ft;
      const sx = e.s === 0 ? FIELD.minX - 80 : FIELD.maxX + 80, sy = e.y * 0.4;
      const pos = (kk) => [X(lerp(sx, e.x, kk)), Y(lerp(sy, e.y, kk)) - 14 * (1 - kk * kk)];
      for (let j = 14; j >= 1; j--) { const [x, y] = pos(Math.max(0, k - j * 0.012)); b.globalAlpha = 0.04 * (15 - j); px(x, y, '#e8e8e2', 2, 2); }
      b.globalAlpha = 1;
      const [mx, my] = pos(k);
      px(mx - 1, my, '#d8dce2', 3, 1); px(mx + (e.s === 0 ? 2 : -2), my, '#ff5a4a');
      px(mx + (e.s === 0 ? -2 : 2), my, Math.floor(t * 30) % 2 ? '#ffb040' : '#fff4b0');
    }
    // strike aircraft over the target line
    for (const e of P.fx.strikes) {
      const carpet = e.p === 'carpet';
      const delay = e.ft || (carpet ? 3 : 2.5);
      const span = carpet ? 18 * 0.12 : 6 * 0.18;
      const speed = carpet ? 300 : 420;
      const tMid = e.t + delay + span / 2;
      const age = t - tMid;
      const halfT = 2400 / speed;
      if (age < -halfT || age > halfT) continue;
      const dir = e.s === 0 ? 1 : -1;
      const side = P.sides[e.s];
      const n = carpet ? 3 : 2;
      for (let j = 0; j < n; j++) {
        const lag = j * 0.35;
        const x = e.x + dir * (age - lag) * speed, y = e.y + (j - (n - 1) / 2) * (carpet ? 70 : 40);
        if (x < FIELD.minX - 200 || x > FIELD.maxX + 200) continue;
        const type = carpet ? 'bomber' : 'fighter', alt = carpet ? 18 : 22;
        const a = dir > 0 ? 0 : Math.PI;
        const sh = side.sprites.top(type, a, 'shadow');
        if (sh) { b.globalAlpha = 0.18; b.drawImage(sh.c, X(x) - sh.ax + 6, Y(y) - sh.ay + 4); b.globalAlpha = 1; }
        for (let k = 1; k <= 8; k++) { b.globalAlpha = 0.25 - k * 0.028; px(X(x - dir * k * 14), Y(y) - alt - 3, '#ffffff'); px(X(x - dir * k * 14), Y(y) - alt + 3, '#ffffff'); }
        b.globalAlpha = 1;
        drawSprite(side.sprites.top(type, a), X(x), Y(y) - alt);
      }
    }
  }
  function drawSays(t) {
    for (const e of P.fx.says) {
      if (e.t > t || t > e.t + 3) continue;
      const g = P.units[P.hqs[e.s]];
      if (!g) continue;
      const st = stateAt(g, t);
      if (st.s === ST.dead) continue;
      const text = String(e.text).slice(0, 40);
      b.font = `8px ${PIXEL_FONT}`;
      const w = Math.ceil(b.measureText(text).width) + 6;
      let x = X(st.x) - Math.round(w / 2), y = Y(st.y) - 44;
      x = clamp(x, 2, bw - w - 2); y = Math.max(2, y);
      px(x - 1, y - 1, '#1b1a22', w + 2, 13);
      px(x, y, '#f4f0e0', w, 11);
      px(X(st.x) - 1, y + 11, '#f4f0e0', 3, 2); px(X(st.x), y + 13, '#f4f0e0');
      b.fillStyle = '#1b1a22';
      b.textBaseline = 'top';
      b.fillText(text, x + 3, y + 2);
    }
  }
  function drawWater(anim) {
    for (const [x, y, ph] of shimmer) { if (Math.sin(anim * 2.2 + ph * 40 + y * 0.1) > 0.6) px(x, y, 'rgba(220,240,255,0.7)', 2, 1); }
    for (const [x, y, ph] of foam) { if (Math.sin(anim * 1.6 + ph * 30 + x * 0.05) > 0.2) px(x, y, 'rgba(240,250,255,0.8)'); }
  }
  function drawClouds(anim) {
    b.globalAlpha = 0.07;
    b.fillStyle = '#000814';
    for (let i = 0; i < 4; i++) {
      const sp = 6 + i * 2;
      const x = ((anim * sp + i * 420) % (bw + 400)) - 200;
      const y = bh * (0.15 + 0.23 * i) + Math.sin(anim * 0.05 + i) * 20;
      blobA(b, Math.round(x), Math.round(y), 70 + i * 12, 26 + i * 4);
      blobA(b, Math.round(x + 50), Math.round(y + 12), 50, 20);
    }
    b.globalAlpha = 1;
  }

  // ── public ────────────────────────────────────────────────────────────────
  function render(t, anim = t) {
    if (!rep || !P) return renderIdle(anim);
    resize();
    const map = rep.map || FALLBACK_MAP;
    ensureGround(map);
    P.pal = PALETTES[map.palette] || PALETTES.farm;
    if (lastT !== null && t > lastT && t - lastT < 0.6) playSounds(lastT, t);
    lastT = t;
    const tc = clamp(t, 0, P.dur);
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.imageSmoothingEnabled = false;
    b.drawImage(ground, 0, 0);
    drawWater(anim);
    drawDecals(tc, P.pal);
    collectUnits(tc);
    drawItems(0, 0);            // ships
    b.drawImage(deck, 0, 0);    // bridges over them
    drawItems(1, 1);            // ground units
    b.globalAlpha = 0.82;
    b.drawImage(canopy, 0, 0);
    b.globalAlpha = 1;
    drawAssaults(tc);
    drawLosses(tc, P.pal);
    drawSmokes(tc);
    drawItems(3, 3);            // helicopters, drones
    drawTracers(tc);
    drawFires(tc);
    drawShells(tc);
    drawBooms(tc);
    drawItems(4, 4);            // jets
    drawPowers(tc);
    drawMarkers(tc);
    drawSays(tc);
    drawClouds(anim);
    present(cameraAt(t));
  }
  function renderIdle(anim = 0) {
    resize();
    const map = idleMap || FALLBACK_MAP;
    ensureGround(map);
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.imageSmoothingEnabled = false;
    b.drawImage(ground, 0, 0);
    drawWater(anim);
    b.drawImage(deck, 0, 0);
    b.drawImage(canopy, 0, 0);
    for (let s = 0; s < 2; s++) {
      const x = X(s === 0 ? -980 : 980), y = Y(0);
      px(x, y - 20, '#2a2c30', 1, 20);
      const col = aiColors[s];
      for (let i = 0; i < 9; i++) { const wave = Math.round(Math.sin(anim * 4 + i * 0.7)); px(s === 0 ? x + 1 + i : x - 1 - i, y - 20 + wave, col, 1, 7); }
    }
    drawClouds(anim);
    present();
  }
  function hudAt(t) {
    if (!rep || !P) return [null, null];
    const f = clamp(Math.round(clamp(t, 0, P.dur) * P.hz), 0, P.N - 1);
    const h = (rep.hud && rep.hud[f]) || [100, 50, 100, 50];
    return [0, 1].map(s => {
      const own = P.units.filter(q => q.side === s && !q.hq);
      const alive = own.filter(q => q.s[f] !== ST.dead && q.s[f] !== ST.fled);
      const retreating = alive.filter(q => q.s[f] === ST.routing).length;
      const air = alive.filter(q => q.fly && q.s[f] !== ST.away).length;
      const ships = alive.filter(q => q.naval).length;
      const g = P.units[P.hqs[s]];
      const hqHp = g ? (g.s[f] === ST.dead ? 0 : g.m[f]) : 0;
      const side = P.sides[s];
      const chips = [`${alive.length - retreating}/${own.length} units`];
      if (air) chips.push(`${air} in the air`);
      if (ships) chips.push(`${ships} at sea`);
      if (retreating) chips.push(`${retreating} retreating`);
      return {
        title: side.name,
        sub: `${side.label} · ${side.hq || 'Command Post'}`,
        bars: [
          { label: 'Army', value: h[s * 2], max: 100, color: aiColors[s] },
          { label: 'Morale', value: h[s * 2 + 1], max: 100, color: '#ffd166' },
          { label: 'Command', value: hqHp, max: 100, color: hqHp > 50 ? '#5ad06a' : hqHp > 25 ? '#ffd166' : '#ff5a4a' },
        ],
        chips,
      };
    });
  }
  function eventsBetween(t0, t1) {
    return feedRange(t0, t1).filter(e => e.text).map(e => ({ k: e.k, side: e.side, big: !!e.big, text: e.text || '' }));
  }
  return {
    setReplay,
    get duration() { return P ? P.dur : 0; },
    get camera() { return camInfo; },
    render, renderIdle, resize, hudAt, eventsBetween,
  };
}
