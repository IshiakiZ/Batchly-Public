// ─────────────────────────────────────────────────────────────────────────────
//  Army Battle — spectator view (pixel art, canvas 2D).
//  The replay stores squads at 5 Hz (position, facing, soldiers, state, morale);
//  every individual soldier, body, arrow and explosion is derived from it
//  deterministically, so drawing is a pure function of (replay, t).
//  Layers: cached ground (terrain, rocks, forest floor) -> decals (scorch, craters,
//  bodies) -> shadows -> soldiers (depth sorted) -> tree canopies -> missiles and
//  spells -> banners, general, speech bubbles -> cloud shadows.
// ─────────────────────────────────────────────────────────────────────────────
import * as sound from '../../sound.js';
import { buildSpriteSet, EMBLEM, shade, mix, lighten, colorDist } from './sprites.js';

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
function lerpAngDeg(a, b, k) { let d = ((b - a + 540) % 360) - 180; return a + d * k; }

const FORMS = ['line', 'wedge', 'square', 'loose'];
const ST = { idle: 0, moving: 1, fighting: 2, charging: 4, routing: 5, dead: 6, fled: 7 };
// display spacing (world units) and hover height (buffer px) per type
const SPACING = { infantry: 13, archers: 13, spearmen: 12.5, shieldwall: 13, cavalry: 20, mages: 14, clerics: 14, catapult: 30, knights: 21, beasts: 28, griffins: 26, dragon: 40, titan: 44, archangels: 28, general: 16 };
const HOVER = { griffins: 9, archangels: 10, dragon: 22 };
const BIG = { dragon: 1, titan: 1 };
// minimum spacing on screen (buffer px) so blocks read as a crowd of little soldiers
const MIN_PX = { infantry: 4.5, archers: 4.5, spearmen: 4.5, shieldwall: 5, cavalry: 7.5, knights: 8, mages: 5, clerics: 5, catapult: 11, beasts: 9, griffins: 9, archangels: 9, general: 6, dragon: 10, titan: 10 };
const TARGET_K = 0.3;

const PALETTES = {
  meadow: { out: '#26331e', grass: ['#4f8b3d', '#5b9946', '#467e36', '#3d6f2f'], dots: ['#f2e45c', '#f6f6f6', '#e883a8', '#ffffff'], floor: '#2c5426', tree: ['#1c4220', '#2d6a2f', '#4b8e3e', '#6aaa4a'], trunk: '#5a3a1e', rock: ['#8e8c84', '#6c6a64', '#b8b6ac', '#46443e'], dust: '#b8a878', blood: '#7a1c16', scorch: '#1e1a14' },
  river: { out: '#223420', grass: ['#4a8c48', '#56984f', '#428040', '#3a7238'], dots: ['#f0f0f0', '#9ad0f0', '#f2e45c'], floor: '#2a5428', tree: ['#1a4020', '#28642e', '#43883e', '#5ea44c'], trunk: '#5a3a1e', rock: ['#8a8c88', '#666a68', '#b4b8b2', '#40423e'], water: ['#24578f', '#2e68a6', '#4a8cc4', '#8cc4e8'], sand: '#b8a276', dust: '#b0a47a', blood: '#7a1c16', scorch: '#1e1a14' },
  highland: { out: '#2a3024', grass: ['#6f8b4a', '#7b9754', '#63803f', '#577038'], dots: ['#9a64aa', '#b07ac0', '#c8c8c0', '#e8e0a0'], floor: '#344a2a', tree: ['#16301f', '#23452c', '#335e38', '#4a7a44'], trunk: '#4a3420', rock: ['#8a8e94', '#666a72', '#b2b6bc', '#3e4248'], dust: '#b4ac8c', blood: '#6a1c16', scorch: '#1e1a14' },
  autumn: { out: '#2e2a1a', grass: ['#7e8b3f', '#8b9646', '#727f37', '#667031'], dots: ['#d8782a', '#b8541e', '#e8a83a', '#f0d060'], floor: '#4a3e20', tree: ['#6a2a12', '#b8541e', '#d8782a', '#f0a840'], trunk: '#4a2e18', rock: ['#8c8678', '#6a6458', '#b4ae9e', '#44403a'], dust: '#c0a878', blood: '#6a1c16', scorch: '#1e1a14' },
  celestial: { out: '#110e22', grass: ['#3b3569', '#453d79', '#35305e', '#2f2a54'], dots: ['#fff6c8', '#b8c8ff', '#ffffff', '#ffd98a'], floor: '#2a2450', tree: ['#8a7440', '#d8c070', '#f0e6b0', '#fff8e0'], trunk: '#7a6a40', rock: ['#7ac0f0', '#4a88c8', '#d8f4ff', '#2a5890'], dust: '#b0a8e0', blood: '#5a1a3a', scorch: '#0e0a1e' },
};
const FALLBACK_MAP = { id: 'greenvale', name: 'Greenvale Fields', palette: 'meadow', rocks: [{ x: 0, y: -300, r: 58 }, { x: -600, y: 340, r: 40 }, { x: 600, y: 340, r: 40 }], woods: [{ x: -330, y: -250, r: 88 }, { x: 330, y: -250, r: 88 }, { x: 0, y: 290, r: 96 }], river: null };
const FIELD = { minX: -800, maxX: 800, minY: -450, maxY: 450, width: 1600, height: 900 };

export function createView(canvas) {
  const ctx = canvas.getContext('2d');
  const buf = document.createElement('canvas');
  const b = buf.getContext('2d');
  let cw = 0, ch = 0, dpr = 1, z = 2, bw = 0, bh = 0, K = 0.46, ox = 0, oy = 0;
  let rep = null, P = null;
  let aiColors = ['#e8825c', '#2fc58e'];
  let ground = null, canopy = null, groundKey = '', shimmer = [];
  let lastT = null;
  const sndLast = {};
  let idleMap = FALLBACK_MAP;

  const dispSpacing = (type) => Math.max(SPACING[type] || 14, (MIN_PX[type] || 5) / K);
  const X = (x) => Math.round(ox + x * K);
  const Y = (y) => Math.round(oy + y * K);

  // ── sizing ────────────────────────────────────────────────────────────────
  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (w !== cw || h !== ch) { cw = w; ch = h; canvas.width = w; canvas.height = h; }
    const fit = Math.min(cw / 1640, ch / 930);
    z = Math.max(1, Math.round(fit / TARGET_K));
    const nbw = Math.ceil(cw / z), nbh = Math.ceil(ch / z);
    if (nbw !== bw || nbh !== bh) { bw = nbw; bh = nbh; buf.width = bw; buf.height = bh; }
    const nK = Math.min((bw - 12) / FIELD.width, (bh - 12) / FIELD.height);
    if (nK !== K) { K = nK; layoutCache.clear(); }
    ox = Math.floor(bw / 2); oy = Math.floor(bh / 2);
  }
  // The pixel buffer reaches the screen at a WHOLE-NUMBER scale (canvas px per buffer px), so every pixel
  // stays square and even; a zoom eases between those steps in about a third of a second, and the view pans
  // in canvas pixels (sub-buffer-pixel), so the camera glides instead of stepping.
  let dispScale = 0, dispTarget = 0, lastPresent = 0, camInfo = null;
  function present(cam) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = lastPresent ? (now - lastPresent) / 1000 : 1;
    lastPresent = now;
    const want = z * (cam ? cam.zoom : 1);
    let target = Math.max(z, Math.round(want));
    if (dispTarget && Math.abs(want - dispTarget) < 0.62) target = dispTarget;   // hysteresis: no flicker between steps
    dispTarget = target;
    if (!dispScale || dt > 0.5) dispScale = target;                              // first frame / after a pause: no animation
    else dispScale += (target - dispScale) * (1 - Math.exp(-dt / 0.09));
    if (Math.abs(dispScale - target) < 0.01) dispScale = target;
    const S = dispScale;
    if (S <= z + 0.001) { ctx.drawImage(buf, 0, 0, bw * z, bh * z); camInfo = { scale: z, x: 0, y: 0 }; return; }
    const vw = cw / S, vh = ch / S;                                              // the view in buffer px
    // keep the view on the battlefield (centred on it when the field is narrower than the view), then inside the buffer
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
  // A pure function of t (so seeking, replays and live all look the same): it frames every squad still on
  // the field and pushes in on the big moments - a general falling, meteors and wrath, dragon fire, titan
  // stomps, flank / rear charges, legendary units dying, and the victor at the end. The replay is known in
  // advance, so each push-in starts a moment before the event.
  const CAM_AUTO_MAX = 1.5, CAM_PAD = 110;
  const FADE = 1.5;
  function squadWeight(q, t) {
    if (q.goneT === undefined) {   // first time: when did this squad fall or flee (Infinity = never)
      q.goneT = Infinity;
      for (let f = 0; f < P.N; f++) if (q.s[f] === ST.dead || q.s[f] === ST.fled) { q.goneT = f / P.hz; break; }
    }
    const w = t <= q.goneT ? 1 : Math.max(0, 1 - (t - q.goneT) / FADE);
    return q.gen ? w * 0.6 : w;
  }
  function frameAt(t) {
    const fr = clamp(t * P.hz, 0, P.N - 1), i = Math.floor(fr), j = Math.min(P.N - 1, i + 1), a = fr - i;
    let W = 0, mx = 0, my = 0;
    const pts = [];
    for (const q of P.squads) {
      const w = squadWeight(q, t);
      if (w <= 0) continue;
      const x = clamp(lerp(q.x[i], q.x[j], a), FIELD.minX, FIELD.maxX), y = clamp(lerp(q.y[i], q.y[j], a), FIELD.minY, FIELD.maxY);
      pts.push([x, y, w]); W += w; mx += w * x; my += w * y;
    }
    if (!W) return null;
    mx /= W; my /= W;
    let vx = 0, vy = 0;
    for (const [x, y, w] of pts) { vx += w * (x - mx) * (x - mx); vy += w * (y - my) * (y - my); }
    // half-extents: about 2.2 standard deviations (covers the army without chasing one straggler)
    const hx = 2.2 * Math.sqrt(vx / W) + CAM_PAD, hy = 2.2 * Math.sqrt(vy / W) + CAM_PAD;
    return { x: mx, y: my, hx, hy };
  }
  function autoFrame(t) {
    // a triangular average over the last 2 s: slow, steady framing
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
    const Q = P.squads, cands = [];
    const add = (e, pri, zoom, hold, focus) => cands.push({ t: e.t, pri, zoom, hold, focus });
    for (const e of ev) {
      const q = Q[e.a];
      switch (e.k) {
        case 'general': add(e, 5, 2.3, 2.2, { squad: e.a, t: e.t }); break;
        case 'power': if (e.p === 'meteor' || e.p === 'wrath') add(e, 4, 1.9, 1.8, { x: e.x, y: e.y }); break;
        case 'boom': if (e.kind === 'meteor' && e.n >= 3) add(e, 3.5, 1.9, 1.4, { x: e.x, y: e.y }); break;
        case 'breath': add(e, 3, 2.0, 1.6, { squad: e.a }); break;
        case 'stomp': add(e, 3, 1.9, 1.4, { squad: e.a }); break;
        case 'destroyed': if (q && q.legend) add(e, 3, 2.0, 1.6, { squad: e.a, t: e.t }); break;
        case 'charge': if (e.fl > 0 || e.br || e.d > 50) add(e, e.fl === 2 ? 2.5 : 2, 1.8, 1.4, { squad: e.a, mid: e.b }); break;
        default: break;
      }
    }
    const end = ev.find(e => e.k === 'end');
    const picked = [];
    const busy = (a0, a1) => picked.some(m => a0 < m.t2 + 2.5 && a1 > m.t0 - 2.5);   // keep a few quiet seconds between push-ins
    if (end) {
      // the closing shot: the general whose fall decided it, otherwise the winner's general
      const slain = ev.find(e => e.k === 'general' && e.t >= end.t - 1);
      const g = slain ? slain.a : end.s >= 0 ? Q.findIndex(q => q.gen && q.side === end.s) : -1;
      picked.push({ t0: end.t - (slain ? 0.6 : 0.3), t1: Infinity, t2: Infinity, zoom: slain ? 2.3 : 1.9, focus: g >= 0 ? { squad: g, t: end.t } : null });
    }
    cands.sort((a, c) => c.pri - a.pri || a.t - c.t);
    for (const c of cands) {
      const t0 = c.t - 0.6, t2 = c.t + c.hold + 0.9;
      if (t0 < 2 || busy(t0, t2)) continue;
      picked.push({ t0, t1: c.t + c.hold, t2, zoom: c.zoom, focus: c.focus });
    }
    return picked.sort((a, c) => a.t0 - c.t0);
  }
  function focusAt(f, t) {
    if (!f) return null;
    if (f.squad === undefined) return { x: f.x, y: f.y };
    const q = P.squads[f.squad];
    if (!q) return null;
    const a = stateAt(q, f.t !== undefined ? Math.min(t, f.t) : t);   // a fallen unit: where it fell
    if (f.mid !== undefined && P.squads[f.mid]) { const b2 = stateAt(P.squads[f.mid], t); return { x: (a.x + b2.x) / 2, y: (a.y + b2.y) / 2 }; }
    return { x: a.x, y: a.y };
  }
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  function cameraAt(t) {
    const base = autoFrame(Math.min(t, P.dur));
    let best = null, bestW = 0;
    for (const m of P.moments) {
      if (t < m.t0 || t > m.t2) continue;
      const w = t < m.t0 + 0.6 ? smooth((t - m.t0) / 0.6) : t <= m.t1 ? 1 : smooth(1 - (t - m.t1) / (m.t2 - m.t1));
      if (w > bestW) { bestW = w; best = m; }
    }
    if (!best) return base;
    const p = focusAt(best.focus, t) || base;
    const zoom = Math.exp(lerp(Math.log(base.zoom), Math.log(Math.max(base.zoom, best.zoom)), bestW));
    return { x: lerp(base.x, p.x, bestW), y: lerp(base.y, p.y, bestW), zoom };
  }

  // ── ground ────────────────────────────────────────────────────────────────
  function inRiver(map, x, y) {
    const r = map.river;
    if (!r || x < r.x0 || x > r.x1) return 0;
    for (const f of r.fords) if (y >= f.y0 && y <= f.y1) return 2;
    return 1;
  }
  function ensureGround(map) {
    const key = `${map.id}|${bw}|${bh}|${K.toFixed(4)}`;
    if (key === groundKey && ground) return;
    groundKey = key;
    const pal = PALETTES[map.palette] || PALETTES.meadow;
    ground = document.createElement('canvas'); ground.width = bw; ground.height = bh;
    canopy = document.createElement('canvas'); canopy.width = bw; canopy.height = bh;
    const g = ground.getContext('2d');
    const img = g.createImageData(bw, bh);
    const d = img.data;
    const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const grass = pal.grass.map(rgb), out = rgb(pal.out), floor = rgb(pal.floor);
    const water = (pal.water || ['#24578f', '#2e68a6', '#4a8cc4', '#8cc4e8']).map(rgb), sand = rgb(pal.sand || '#b8a276');
    shimmer = [];
    for (let py = 0; py < bh; py++) {
      for (let px = 0; px < bw; px++) {
        const wx = (px - ox) / K, wy = (py - oy) / K;
        const inField = wx >= FIELD.minX && wx <= FIELD.maxX && wy >= FIELD.minY && wy <= FIELD.maxY;
        // calm meadow: fine 3-tone dither + very soft large-scale light variation
        const n = vnoise(wx / 26, wy / 26, 5) * 0.55 + h2(px, py) * 0.45;
        const big = 0.93 + 0.12 * vnoise(wx / 180, wy / 180, 11);
        let c = grass[n < 0.3 ? 2 : n < 0.72 ? 0 : 1].map(v => v * big);
        if (vnoise(wx / 55, wy / 55, 21) > 0.78) c = c.map((v, i) => lerp(v, grass[3][i], 0.35));
        // woods: dark forest floor
        for (const w of map.woods) {
          const dd = Math.hypot(wx - w.x, wy - w.y);
          if (dd < w.r + 6) { const k = clamp((w.r + 6 - dd) / 14, 0, 1) * (0.75 + h2(px + 7, py) * 0.25); c = [lerp(c[0], floor[0], k), lerp(c[1], floor[1], k), lerp(c[2], floor[2], k)]; }
        }
        // rock shadows
        for (const r of map.rocks) {
          const dd = Math.hypot(wx - r.x - 10, wy - r.y - 12);
          if (dd < r.r + 6) c = c.map(v => v * 0.72);
        }
        // river
        const rv = map.river;
        if (rv) {
          const edge = Math.min(Math.abs(wx - rv.x0), Math.abs(wx - rv.x1));
          const inside = wx >= rv.x0 && wx <= rv.x1;
          const ford = rv.fords.some(f => wy >= f.y0 && wy <= f.y1);
          if (inside) {
            const depth = Math.min(wx - rv.x0, rv.x1 - wx) / ((rv.x1 - rv.x0) / 2);
            if (ford) c = h2(px, py) < 0.12 ? [140, 150, 150] : water[depth > 0.3 ? 3 : 2].map((v, i) => lerp(v, sand[i], 0.35));
            else c = water[depth > 0.55 ? 0 : depth > 0.25 ? 1 : 2];
            if (!ford && h2(px * 3, py) < 0.02) shimmer.push([px, py, h2(px, py * 5)]);
          } else if (edge < 7 && wy > FIELD.minY && wy < FIELD.maxY) c = sand.map((v, i) => lerp(v, c[i], edge / 9));
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
    // field border: a low hedge line
    const x0 = X(FIELD.minX), x1 = X(FIELD.maxX), y0 = Y(FIELD.minY), y1 = Y(FIELD.maxY);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, 1); g.fillRect(x0 - 1, y1, x1 - x0 + 2, 1);
    g.fillRect(x0 - 1, y0, 1, y1 - y0); g.fillRect(x1, y0, 1, y1 - y0);
    // ground details: tufts and flowers
    for (let i = 0; i < bw * bh / 90; i++) {
      const px = Math.floor(h2(i, 1) * bw), py = Math.floor(h2(i, 2) * bh);
      const wx = (px - ox) / K, wy = (py - oy) / K;
      if (wx < FIELD.minX || wx > FIELD.maxX || wy < FIELD.minY || wy > FIELD.maxY) continue;
      if (inRiver(map, wx, wy) || map.rocks.some(r => Math.hypot(wx - r.x, wy - r.y) < r.r + 4) || map.woods.some(w => Math.hypot(wx - w.x, wy - w.y) < w.r)) continue;
      const r = h2(i, 3);
      if (r < 0.55) { g.fillStyle = shade(pal.grass[1], 1.18); g.fillRect(px, py, 1, 1); g.fillRect(px + 1, py - 1, 1, 1); }
      else if (r < 0.8) { g.fillStyle = shade(pal.grass[3], 0.85); g.fillRect(px, py, 2, 1); }
      else { g.fillStyle = pal.dots[Math.floor(h2(i, 4) * pal.dots.length)]; g.fillRect(px, py, 1, 1); }
    }
    // fords: stepping stones
    if (map.river) for (const f of map.river.fords) {
      for (let i = 0; i < 18; i++) {
        const wx = lerp(map.river.x0 + 6, map.river.x1 - 6, h2(i, 91)), wy = lerp(f.y0 + 8, f.y1 - 8, h2(i, 92));
        g.fillStyle = '#8a8c86'; g.fillRect(X(wx), Y(wy), 2, 1);
        g.fillStyle = '#b8bab2'; g.fillRect(X(wx), Y(wy), 1, 1);
      }
    }
    // rocks: boulder clusters
    for (const r of map.rocks) drawRock(g, r, pal, map.palette === 'celestial');
    // trees: trunks on the ground, canopies on their own layer (drawn over the soldiers)
    const cg = canopy.getContext('2d');
    for (const w of map.woods) drawWood(g, cg, w, pal, map.palette);
  }
  function drawRock(g, r, pal, crystal) {
    const [base, dark, light, edge] = pal.rock;
    const R = r.r * K;
    const parts = [[0, 0, 0.78], [-0.45, 0.25, 0.5], [0.5, 0.2, 0.52], [0.1, -0.45, 0.5], [-0.35, -0.35, 0.4], [0.45, -0.3, 0.38]];
    parts.sort((a, b2) => a[1] - b2[1]);
    for (let i = 0; i < parts.length; i++) {
      const [dx, dy, s] = parts[i];
      const cx = X(r.x) + dx * R, cy = Y(r.y) + dy * R * 0.8, rr = Math.max(2, s * R);
      if (crystal) {
        // a crystal spire: a tall diamond
        const hgt = rr * 2.1;
        g.fillStyle = edge; poly(g, [[cx, cy - hgt - 1], [cx + rr * 0.6 + 1, cy], [cx, cy + rr * 0.45 + 1], [cx - rr * 0.6 - 1, cy]]);
        g.fillStyle = dark; poly(g, [[cx, cy - hgt], [cx + rr * 0.6, cy], [cx, cy + rr * 0.45], [cx - rr * 0.6, cy]]);
        g.fillStyle = base; poly(g, [[cx, cy - hgt], [cx, cy + rr * 0.45], [cx - rr * 0.6, cy]]);
        g.fillStyle = light; g.fillRect(Math.round(cx - rr * 0.25), Math.round(cy - hgt * 0.6), 1, Math.max(2, Math.round(hgt * 0.4)));
        continue;
      }
      blob(g, cx, cy, rr + 1, rr * 0.8 + 1, edge, i * 7 + r.x);
      blob(g, cx, cy, rr, rr * 0.8, dark, i * 7 + r.x);
      blob(g, cx - rr * 0.18, cy - rr * 0.2, rr * 0.8, rr * 0.6, base, i * 7 + r.x + 1);
      blob(g, cx - rr * 0.38, cy - rr * 0.38, rr * 0.35, rr * 0.25, light, i * 7 + r.x + 2);
      g.fillStyle = edge;
      if (rr > 5) { g.fillRect(Math.round(cx + rr * 0.1), Math.round(cy - rr * 0.1), 1, Math.round(rr * 0.5)); g.fillRect(Math.round(cx + rr * 0.1), Math.round(cy + rr * 0.35), Math.round(rr * 0.3), 1); }
    }
  }
  function poly(g, pts) { g.beginPath(); g.moveTo(Math.round(pts[0][0]), Math.round(pts[0][1])); for (const p of pts.slice(1)) g.lineTo(Math.round(p[0]), Math.round(p[1])); g.closePath(); g.fill(); }
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
      const cx = X(t.x), cy = Y(t.y), r = Math.max(3, Math.round(9 * K * t.s + 1.5));
      // shadow + trunk on the ground
      g.fillStyle = 'rgba(0,0,0,0.28)'; blobA(g, cx + 2, cy + 2, r, r * 0.6);
      g.fillStyle = pal.trunk; g.fillRect(cx, cy, 1, 3);
      // canopy on the overlay
      if (palette === 'highland') {
        // pines: stacked triangles
        for (let k = 0; k < 3; k++) {
          const yy = cy - k * r * 0.55, ww = r * (1 - k * 0.28);
          cg.fillStyle = dark; poly(cg, [[cx, yy - r * 0.9 - 1], [cx + ww + 1, yy + 1], [cx - ww - 1, yy + 1]]);
          cg.fillStyle = k === 2 ? light : mid; poly(cg, [[cx, yy - r * 0.9], [cx + ww, yy], [cx - ww, yy]]);
        }
        continue;
      }
      const tint = palette === 'autumn' ? pal.tree[1 + Math.floor(t.v * 3)] : mid;
      blob(cg, cx, cy - r * 0.6, r + 1, r * 0.85 + 1, dark, t.x);
      blob(cg, cx, cy - r * 0.6, r, r * 0.85, tint, t.x);
      blob(cg, cx - r * 0.25, cy - r * 0.85, r * 0.55, r * 0.45, palette === 'autumn' ? lighten(tint, 0.25) : light, t.x + 1);
      cg.fillStyle = hi; cg.fillRect(cx - Math.round(r * 0.4), cy - Math.round(r * 1.1), 1, 1);
    }
  }
  function blobA(g, cx, cy, rx, ry) {
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      const k = 1 - (y * y) / (ry * ry);
      if (k < 0) continue;
      const hw = Math.round(rx * Math.sqrt(k));
      g.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2 + 1, 1);
    }
  }

  // ── replay preparation ────────────────────────────────────────────────────
  function setReplay(replay, colors) {
    rep = replay;
    dispScale = 0; dispTarget = 0;
    if (colors && colors.length === 2) aiColors = colors.slice();
    lastT = null;
    if (!rep || !rep.squads) { P = null; return; }
    resize();
    idleMap = rep.map || FALLBACK_MAP;
    const hz = rep.hz || 5;
    const N = rep.hud ? rep.hud.length : rep.squads[0].x.length;
    // army colours; if both armies picked near-identical colours, the right army wears its AI colour
    const prim = rep.sides.map(s => (s.colors && s.colors.primary) || '#8a94b0');
    const sec = rep.sides.map(s => (s.colors && s.colors.secondary) || '#e8e0c8');
    if (colorDist(prim[0], prim[1]) < 70) prim[1] = aiColors[1];
    const sides = rep.sides.map((s, i) => ({ ...s, primary: prim[i], secondary: sec[i], sprites: buildSpriteSet(prim[i], sec[i]) }));
    const squads = rep.squads.map((q, i) => ({ ...q, i, forms: [[-1, q.f0 || 0]], routT: [], acts: [], odo: new Float32Array(N) }));
    for (const q of squads) {
      let acc = 0;
      for (let f = 1; f < N; f++) { acc += Math.hypot(q.x[f] - q.x[f - 1], q.y[f] - q.y[f - 1]); q.odo[f] = acc; }
      for (let f = 1; f < N; f++) if (q.s[f] === ST.routing && q.s[f - 1] !== ST.routing) q.routT.push(f / hz);
      q.sp = dispSpacing(q.type);
    }
    const ev = rep.events || [];
    const fx = { volleys: [], stones: [], spells: [], booms: [], breaths: [], stomps: [], powers: [], heals: [], charges: [], clashes: [], says: [], aegis: [] };
    for (const e of ev) {
      const q = squads[e.a];
      switch (e.k) {
        case 'form': if (q) q.forms.push([e.t, e.f]); break;
        case 'volley': fx.volleys.push(e); if (q) q.acts.push(e.t); break;
        case 'siege': fx.stones.push(e); if (q) q.acts.push(e.t); break;
        case 'spell': fx.spells.push(e); if (q) q.acts.push(e.t); break;
        case 'boom': fx.booms.push(e); break;
        case 'breath': fx.breaths.push(e); if (q) q.acts.push(e.t); break;
        case 'stomp': fx.stomps.push(e); if (q) q.acts.push(e.t); break;
        case 'power': fx.powers.push(e); if (q) q.acts.push(e.t); break;
        case 'heal': fx.heals.push(e); if (q) q.acts.push(e.t); break;
        case 'charge': fx.charges.push(e); break;
        case 'clash': fx.clashes.push(e); break;
        case 'say': fx.says.push(e); break;
        default: break;
      }
    }
    P = { hz, N, dur: rep.duration || (N - 1) / hz, sides, squads, fx, end: ev.find(e => e.k === 'end') || null };
    // aegis: squads of the caster's side inside the radius when it was cast
    for (const e of fx.powers) {
      if (e.p !== 'aegis') continue;
      const f = Math.round(e.t * hz);
      const gids = squads.filter(q => q.side === e.s && Math.hypot(at(q.x, f) - e.x, at(q.y, f) - e.y) <= e.r).map(q => q.i);
      fx.aegis.push({ t: e.t, t1: e.t + 10, gids });
    }
    P.bodies = buildBodies();
    const decals = [];
    for (const bd of P.bodies) decals.push(Object.assign({}, bd, { kind: 'body', t: bd.t + 0.6 }));
    for (const e of fx.booms) decals.push({ kind: 'boom', t: e.t + 0.2, x: e.x, y: e.y, e });
    for (const q of squads) {
      if (HOVER[q.type]) continue;
      for (let f = 0; f < N; f += 5) {
        if (q.s[f] !== ST.fighting && q.s[f] !== ST.charging) continue;
        decals.push({ kind: 'trample', t: f / hz, x: q.x[f] + (h2(q.i, f) - 0.5) * 16, y: q.y[f] + (h2(f, q.i) - 0.5) * 12, r: q.sp * Math.sqrt(Math.max(1, q.n[f])) * 0.42 });
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
    return {
      x: lerp(q.x[i], q.x[j], a), y: lerp(q.y[i], q.y[j], a),
      ang: lerpAngDeg(q.a[i], q.a[j], a) * Math.PI / 180,
      n: q.n[r], s: q.s[r], m: q.m[r], odo: lerp(q.odo[i], q.odo[j], a),
      vx: (q.x[j] - q.x[i]) * P.hz, vy: (q.y[j] - q.y[i]) * P.hz,
    };
  }
  function formAt(q, t) {
    let cur = q.forms[0], prev = q.forms[0];
    for (const f of q.forms) { if (f[0] <= t) { prev = cur; cur = f; } else break; }
    return { code: cur[1], prevCode: prev[1], since: t - cur[0] };
  }
  // Formation slots for `c` soldiers: [forward, lateral] in world units, front row first.
  const layoutCache = new Map();
  function layout(type, form, n0, c) {
    const key = `${type}|${form}|${n0}|${c}`;
    let L = layoutCache.get(key);
    if (L) return L;
    L = [];
    const sp = dispSpacing(type) * (form === 3 ? 1.55 : 1);
    if (n0 <= 1) L.push([0, 0, 0]);
    else if (form === 1) {
      const rows = []; let placed = 0, r = 0;
      while (placed < n0) { const k = Math.min(r + 2, n0 - placed); rows.push(k); placed += k; r++; }
      let remain = c;
      const depth = rows.length;
      rows.forEach((k, ri) => { const u = Math.min(k, remain); remain -= u; for (let j = 0; j < u; j++) L.push([((depth - 1) / 2 - ri) * sp * 0.8, (j - (u - 1) / 2) * sp * 0.95, ri]); });
    } else {
      const ranks = form === 2 ? Math.ceil(Math.sqrt(n0)) : n0 >= 16 ? 3 : n0 >= 7 ? 2 : 1;
      const files = Math.ceil(n0 / ranks);
      const rows0 = Math.ceil(n0 / files);
      const rows = Math.ceil(c / files);
      for (let rr = 0; rr < rows; rr++) {
        const inRow = Math.min(files, c - rr * files);
        for (let j = 0; j < inRow; j++) L.push([((rows0 - 1) / 2 - rr) * sp * (form === 2 ? 1 : 0.85), (j - (inRow - 1) / 2) * sp, rr]);
      }
    }
    layoutCache.set(key, L);
    return L;
  }
  function soldierPos(q, st, fm, t, idx, L, Lprev, k) {
    let [fw, lt, row] = L[idx];
    if (Lprev && k < 1 && Lprev[idx]) { fw = lerp(Lprev[idx][0], fw, k); lt = lerp(Lprev[idx][1], lt, k); }
    const s1 = h2(q.i * 131 + idx, 7), s2 = h2(q.i * 131 + idx, 8);
    const loose = fm === 3;
    fw += (s1 - 0.5) * q.sp * (loose ? 0.6 : 0.18);
    lt += (s2 - 0.5) * q.sp * (loose ? 0.6 : 0.18);
    if (st.s === ST.routing) {
      const since = q.routT.length ? t - q.routT.filter(x => x <= t + 0.2).slice(-1)[0] : 1;
      const rs = clamp((since || 0) * 0.7, 0, 1.6);
      fw = fw * (1 + rs) + (s1 - 0.5) * 40 * rs; lt = lt * (1 + rs) + (s2 - 0.5) * 50 * rs;
    } else if (st.s === ST.fighting) {
      const ph = Math.sin(t * 7.5 + idx * 1.9);
      if (row === 0) fw += Math.max(0, ph) * 3.5;
      lt += Math.sin(t * 2.1 + idx) * 1.2;
    } else if (st.s === ST.idle) {
      lt += Math.sin(t * 0.9 + idx * 2.3) * 0.5;
    }
    const c = Math.cos(st.ang), s = Math.sin(st.ang);
    return [st.x + c * fw - s * lt, st.y + s * fw + c * lt];
  }

  // Bodies: whenever a squad loses soldiers, they fall where its front rank stood.
  function buildBodies() {
    const out = [];
    for (const q of P.squads) {
      for (let f = 1; f < P.N; f++) {
        const lost = q.n[f - 1] - q.n[f];
        if (lost <= 0) continue;
        const t = (f - 0.5) / P.hz;
        const st = stateAt(q, (f - 1) / P.hz);
        const fm = formAt(q, t).code;
        const L = layout(q.type, fm, q.n0, q.n[f - 1]);
        for (let j = 0; j < lost; j++) {
          const seed = q.i * 977 + f * 31 + j;
          let idx;
          if (st.s === ST.fighting && q.n0 > 4) {
            const front = L.filter(p => p[2] === 0).length || 1;
            idx = Math.floor(h2(seed, 3) * front);
          } else idx = Math.floor(h2(seed, 4) * L.length);
          idx = clamp(idx, 0, L.length - 1);
          const [x, y] = soldierPos(q, st, fm, (f - 1) / P.hz, idx, L, null, 1);
          out.push({ x: x + (h2(seed, 5) - 0.5) * 6, y: y + (h2(seed, 6) - 0.5) * 6, t, side: q.side, type: q.type, seed, flip: h2(seed, 9) < 0.5 });
        }
      }
    }
    out.sort((a, c) => a.t - c.t);
    return out;
  }

  // ── events for the ticker and sounds ──────────────────────────────────────
  function buildFeed(ev) {
    const out = [];
    const S = P.sides, Q = P.squads;
    const who = (q) => (q ? `${S[q.side].label}'s ${q.name}` : '?');
    let clashes = 0, volleys = 0, spells = 0, breaths = 0;
    out.push({ t: 0.05, k: 'horn', side: 0, big: true, text: `${S[0].label}'s ${S[0].name} and ${S[1].label}'s ${S[1].name} take the field at ${(rep.map && rep.map.name) || 'the battlefield'}!` });
    out.push({ t: 0.9, k: 'march', side: 0, big: false, text: null });
    out.push({ t: 1.1, k: 'march', side: 1, big: false, text: null });
    for (const e of ev) {
      const a = Q[e.a], bq = Q[e.b];
      switch (e.k) {
        case 'clash': out.push({ t: e.t, k: 'clash', side: e.s, big: false, text: clashes++ < 1 ? `The lines clash! ${who(a)} meet ${who(bq)}` : null }); break;
        case 'charge': {
          const txt = e.br ? `${who(a)} charge - and break on the braced spears of ${who(bq)}!` : e.fl === 2 ? `${who(a)} charge into the REAR of ${who(bq)}!` : e.fl === 1 ? `${who(a)} crash into the flank of ${who(bq)}!` : `${who(a)} charge ${who(bq)}!`;
          out.push({ t: e.t, k: 'charge', side: e.s, big: e.d > 50 || e.fl > 0 || !!e.br, text: e.d > 25 || e.fl > 0 || e.br ? txt : null });
          break;
        }
        case 'volley': out.push({ t: e.t, k: 'volley', side: e.s, big: e.n >= 14, text: volleys++ < 1 ? `${who(a)} loose the first volley!` : null }); break;
        case 'siege': out.push({ t: e.t, k: 'siege', side: e.s, big: false, text: null }); break;
        case 'spell': out.push({ t: e.t, k: 'spell', side: e.s, big: false, text: spells++ < 1 ? `${who(a)} hurl a fireball!` : null }); break;
        case 'breath': out.push({ t: e.t, k: 'spell', side: e.s, big: true, text: breaths++ < 2 ? `${who(a)} breathes fire!` : null }); break;
        case 'stomp': out.push({ t: e.t, k: 'siege', side: e.s, big: true, text: null }); break;
        case 'boom': if (e.kind === 'meteor') out.push({ t: e.t, k: 'siege', side: e.s, big: true, text: e.n >= 3 ? `The meteor strikes - ${e.n} soldiers fall!` : null }); else if (e.kind === 'bolt') out.push({ t: e.t, k: 'spell', side: e.s, big: false, text: null }); break;
        case 'heal': out.push({ t: e.t, k: 'heal', side: e.s, big: false, text: null }); break;
        case 'rout': if (!e.end) out.push({ t: e.t, k: 'rout', side: e.s, big: true, text: `${who(a)} ${e.br ? 'break and flee!' : 'are routing!'}` }); break;
        case 'rally': out.push({ t: e.t, k: 'horn', side: e.s, big: false, text: `${who(a)} rally and turn to fight!` }); break;
        case 'destroyed': out.push({ t: e.t, k: 'death', side: e.s, big: true, text: `${who(a)} have been wiped out` }); break;
        case 'fled': out.push({ t: e.t, k: 'rout', side: e.s, big: false, text: `${who(a)} fled the field` }); break;
        case 'general': out.push({ t: e.t, k: 'general', side: e.s, big: true, text: `${S[e.s].label}'s general ${S[e.s].general} has FALLEN!` }); break;
        case 'power': {
          const names = { rally: 'sounds the RALLY', meteor: 'calls down a METEOR', aegis: 'raises the AEGIS', wrath: 'unleashes the WRATH OF HEAVEN' };
          out.push({ t: e.t, k: e.p === 'rally' ? 'horn' : e.p === 'aegis' ? 'heal' : 'spell', side: e.s, big: true, text: `${S[e.s].label}'s general ${names[e.p] || e.p}!` });
          break;
        }
        case 'say': out.push({ t: e.t, k: 'say', side: e.s, big: false, text: `${S[e.s].label}: "${e.text}"` }); break;
        case 'end': out.push({ t: e.t, k: 'victory', side: e.s < 0 ? 0 : e.s, big: true, text: (rep.result && rep.result.text) || 'The battle is over' }); break;
        default: break;
      }
    }
    // mass casualties -> death sounds
    for (const q of Q) for (let f = 1; f < P.N; f++) { const lost = q.n[f - 1] - q.n[f]; if (lost >= 3) out.push({ t: (f - 0.5) / P.hz, k: 'death', side: q.side, big: lost >= 6, text: null }); }
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
  const SND_GAP = { volley: 0.3, clash: 0.25, death: 0.35, heal: 1.2, march: 0.5, siege: 0.3, spell: 0.25, charge: 0.2 };
  function playSounds(t0, t1) {
    const fn = sound && typeof sound.modeEvent === 'function' ? sound.modeEvent : null;
    if (!fn) return;
    for (const e of feedRange(t0, t1)) {
      if (e.k === 'say') continue;
      const gap = SND_GAP[e.k] || 0;
      const key = `${e.k}|${e.side}`;
      if (gap && sndLast[key] !== undefined && e.t - sndLast[key] < gap && e.t >= sndLast[key]) continue;
      sndLast[key] = e.t;
      try { fn('army', { k: e.k, side: e.side, big: !!e.big }); } catch { /* sound is optional */ }
    }
  }

  // ── drawing helpers ───────────────────────────────────────────────────────
  function px(x, y, col, w = 1, h = 1) { b.fillStyle = col; b.fillRect(Math.round(x), Math.round(y), w, h); }
  function ringPx(cx, cy, r, col, step = 1) {
    b.fillStyle = col;
    const n = Math.max(8, Math.round(r * 5 / step));
    for (let i = 0; i < n; i++) { const a = i / n * TAU; b.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.8), 1, 1); }
  }
  function discA(cx, cy, r, col, alpha) { b.globalAlpha = alpha; b.fillStyle = col; blobA(b, Math.round(cx), Math.round(cy), r, r * 0.8); b.globalAlpha = 1; }
  function drawSprite(spr, x, y, alpha) {
    if (alpha !== undefined && alpha < 1) b.globalAlpha = alpha;
    b.drawImage(spr.c, Math.round(x) - spr.ax, Math.round(y) - spr.ay);
    if (alpha !== undefined && alpha < 1) b.globalAlpha = 1;
  }
  function lastBefore(list, t) { let r = -99; for (const v of list) { if (v <= t) r = v; else break; } return r; }

  // ── decals: scorch marks, craters, trampled earth, bodies ────────────────
  // Permanent marks are painted once into an accumulation layer (repainted from scratch only
  // when time runs backwards or the size changes), so hundreds of bodies cost nothing per frame.
  let decalCv = null, decalT = -1, decalKey = '';
  function paintDecal(g, d, pal) {
    const cx = X(d.x), cy = Y(d.y);
    if (d.kind === 'trample') {
      g.globalAlpha = 0.09; g.fillStyle = '#5a4630';
      blobA(g, cx, cy, d.r * K, d.r * K * 0.7);
      g.globalAlpha = 1;
      return;
    }
    if (d.kind === 'boom') {
      const r = Math.max(2, d.e.r * K * 0.55);
      if (d.e.kind === 'stone') { g.globalAlpha = 0.5; g.fillStyle = '#4a3a28'; blobA(g, cx, cy, r * 0.55, r * 0.4); g.fillStyle = '#2e2418'; blobA(g, cx, cy, r * 0.3, r * 0.2); }
      else if (d.e.kind !== 'stomp') { g.globalAlpha = 0.38; g.fillStyle = pal.scorch; blobA(g, cx, cy, r, r * 0.75); g.globalAlpha = 0.3; blobA(g, cx, cy, r * 0.55, r * 0.4); }
      g.globalAlpha = 1;
      return;
    }
    // a body
    const side = P.sides[d.side];
    const big = d.type === 'beasts' || d.type === 'titan' || d.type === 'dragon';
    const mounted = d.type === 'cavalry' || d.type === 'knights' || d.type === 'general' || d.type === 'griffins';
    const put = (x, y, col, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h); };
    if (h2(d.seed, 11) < 0.7) put(cx - 1 + (d.flip ? -1 : 1), cy + 1, pal.blood, 2, 1);
    if (big) {
      const col = d.type === 'beasts' ? '#4f6e38' : d.type === 'titan' ? '#7a756a' : shade(side.primary, 0.6);
      put(cx - 5, cy - 2, shade(col, 0.7), 11, 4); put(cx - 4, cy - 2, col, 9, 3);
      put(cx - 2, cy + 2, pal.blood, 5, 1);
      return;
    }
    if (mounted) { put(cx - 3, cy - 1, d.type === 'griffins' ? '#b08850' : d.type === 'general' ? '#d8d4c8' : '#6a4a2c', 6, 2); put(cx + (d.flip ? -4 : 3), cy - 2, d.type === 'griffins' ? '#e8dcb8' : '#4a3020', 1, 2); }
    put(cx - 2, cy, shade(side.primary, 0.85), 3, 1);
    put(d.flip ? cx + 1 : cx - 3, cy, '#d8a880');
    if (h2(d.seed, 12) < 0.4) put(d.flip ? cx - 3 : cx + 2, cy - 1, '#b8bcc4');
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
    // bodies still falling
    for (let i = P.bodies.length - 1; i >= 0; i--) {
      const bd = P.bodies[i];
      if (bd.t > t) continue;
      const age = t - bd.t;
      if (age > 0.6) { if (t - bd.t > 2) break; continue; }
      const k = age / 0.6;
      const side = P.sides[bd.side];
      px(X(bd.x) - 1, Y(bd.y) - 5 + Math.round(k * 4), side.primary, 2, 3 - Math.round(k * 2));
      px(X(bd.x) - 1, Y(bd.y) - 6 + Math.round(k * 4), '#d8a880');
    }
  }

  // ── soldiers ──────────────────────────────────────────────────────────────
  const items = [];
  function collectSoldiers(t) {
    items.length = 0;
    const endT = P.end ? P.end.t : Infinity;
    for (const q of P.squads) {
      const st = stateAt(q, t);
      if (st.s === ST.dead || st.s === ST.fled || st.n <= 0) continue;
      const side = P.sides[q.side];
      const fm = formAt(q, t);
      const L = layout(q.type, fm.code, q.n0, st.n);
      const k = clamp(fm.since / 1.2, 0, 1);
      const Lprev = k < 1 && fm.prevCode !== fm.code ? layout(q.type, fm.prevCode, q.n0, st.n) : null;
      const set = side.sprites[q.type] || side.sprites.infantry;
      const cosA = Math.cos(st.ang);
      const flip = cosA < -0.2 ? true : cosA > 0.2 ? false : q.side === 1;
      const act = lastBefore(q.acts, t);
      const acting = t - act < (q.type === 'catapult' ? 1.6 : 0.6);
      const hover = HOVER[q.type] || 0;
      const cheer = t > endT && P.end && P.end.s === q.side;
      for (let idx = 0; idx < st.n; idx++) {
        const [wx, wy] = soldierPos(q, st, fm.code, t, idx, L, Lprev, k);
        let frame = 0, lift = 0;
        if (hover) { frame = Math.floor(t * (q.type === 'dragon' ? 3 : 6) + idx * 0.5) % 2; lift = hover + Math.round(Math.sin(t * 3 + idx) * 1.5); }
        else if (st.s === ST.moving || st.s === ST.charging || st.s === ST.routing) frame = Math.floor(st.odo / 7 + idx * 0.5) % 2;
        else if (st.s === ST.fighting) frame = Math.sin(t * 7.5 + idx * 1.9) > 0.25 ? 1 : 0;
        else if (acting) frame = 1;
        if (cheer) lift += Math.max(0, Math.round(Math.sin(t * 9 + idx * 1.3) * 2));
        const sx = X(wx), sy = Y(wy);
        items.push({ y: sy, x: sx, spr: set[frame][flip ? 1 : 0], lift, hover: !!hover, q, idx, st, sc: BIG[q.type] ? 2 : 1 });
      }
    }
    items.sort((a, c) => (a.hover - c.hover) || (a.y - c.y) || (a.x - c.x));
  }
  function drawSoldiers(t) {
    // shadows first (flyers cast theirs on the ground far below)
    b.fillStyle = '#000';
    for (const it of items) {
      if (it.hover) { b.globalAlpha = 0.28; blobA(b, it.x, it.y, BIG[it.q.type] ? 7 : 3, BIG[it.q.type] ? 3 : 1); }
      else { b.globalAlpha = 0.22; b.fillRect(it.x - 2, it.y, BIG[it.q.type] ? 9 : it.spr.c.width > 10 ? 7 : 4, 1); }
    }
    b.globalAlpha = 1;
    for (const it of items) {
      const routing = it.st.s === ST.routing;
      if (it.sc > 1) { const s2 = it.spr; b.drawImage(s2.c, it.x - s2.ax * it.sc, it.y - it.lift - s2.ay * it.sc, s2.c.width * it.sc, s2.c.height * it.sc); }
      else drawSprite(it.spr, it.x, it.y - it.lift, routing ? 0.9 : 1);
    }
  }

  // ── banners, generals, auras ──────────────────────────────────────────────
  function drawBanners(t, anim) {
    for (const q of P.squads) {
      const st = stateAt(q, t);
      if (st.s === ST.dead || st.s === ST.fled || st.n <= 0) continue;
      const side = P.sides[q.side];
      const cx = X(st.x), cy = Y(st.y);
      if (q.gen) { drawGeneral(q, st, side, t, anim); continue; }
      if (q.legend && q.n0 <= 1) {
        // a legendary monster: just an AI-colour chevron high above it
        const my = cy - (BIG[q.type] ? 38 : 18) - (HOVER[q.type] || 0) - Math.round(Math.sin(anim * 3 + q.i));
        px(cx - 2, my, aiColors[q.side], 5, 1); px(cx - 1, my + 1, aiColors[q.side], 3, 1); px(cx, my + 2, aiColors[q.side]);
        continue;
      }
      if (st.s === ST.routing) {
        // fleeing: a white "!" over the mob
        if (Math.floor(anim * 3 + q.i) % 2 === 0) { px(cx, cy - 16, '#ffffff', 1, 3); px(cx, cy - 12, '#ffffff'); }
        continue;
      }
      // pole behind the squad (rear centre)
      const fm = formAt(q, t).code;
      const L = layout(q.type, fm, q.n0, st.n);
      const depth = L.length ? (L[0][0] - L[L.length - 1][0]) : 0;
      const back = depth / 2 + 6;
      const bx = X(st.x - Math.cos(st.ang) * back), by = Y(st.y - Math.sin(st.ang) * back);
      const hover = HOVER[q.type] || 0;
      const top = by - 13 - hover;
      const wav = st.m < 30 ? Math.round(Math.sin(anim * 14 + q.i) * 1) : 0;
      px(bx, top, '#3a2a1a', 1, 13);
      px(bx, top - 1, aiColors[q.side]);
      const dir = q.side === 0 ? 1 : -1;
      const fw = 6;
      for (let i = 0; i < fw; i++) {
        const wave = Math.round(Math.sin(anim * 5 + i * 0.9 + q.i) * 0.7) + wav;
        const x = dir > 0 ? bx + 1 + i : bx - 1 - i;
        px(x, top + wave, side.primary, 1, 4);
        if (i === 2 || i === 3) px(x, top + 1 + wave, side.secondary, 1, 2);
      }
      // morale pips: red when wavering
      if (st.m < 30) px(bx + dir * 2, top - 3, Math.floor(anim * 4) % 2 ? '#ff5a4a' : '#ffd166');
    }
  }
  function drawGeneral(q, st, side, t, anim) {
    const cx = X(st.x), cy = Y(st.y);
    // aura ring (faint)
    b.globalAlpha = 0.16 + 0.05 * Math.sin(anim * 2);
    ringPx(cx, cy, 220 * K, lighten(side.primary, 0.4), 2);
    b.globalAlpha = 1;
    // standard
    const dir = q.side === 0 ? -1 : 1;
    const bx = cx + dir * 7, top = cy - 24;
    px(bx, top, '#3a2a1a', 1, 22);
    px(bx - 1, top - 2, '#ffd35a', 3, 2);
    const fw = 9, fh = 8;
    for (let i = 0; i < fw; i++) {
      const wave = Math.round(Math.sin(anim * 4 + i * 0.7) * 1);
      const x = dir < 0 ? bx - 1 - i : bx + 1 + i;
      px(x, top + wave, side.primary, 1, fh);
      px(x, top + wave + fh, shade(side.primary, 0.6), 1, 1);
    }
    const em = EMBLEM[side.banner] || EMBLEM.star;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      if (em[j][i] !== '1') continue;
      const col = i + 2;
      const x = dir < 0 ? bx - 1 - col : bx + 1 + col;
      const wave = Math.round(Math.sin(anim * 4 + col * 0.7) * 1);
      px(x, top + 1 + j + wave, side.secondary);
    }
    // AI-colour marker over the general
    const my = cy - 30 - Math.round(Math.sin(anim * 3) * 1);
    px(cx - 1, my, aiColors[q.side], 3, 1); px(cx, my + 1, aiColors[q.side]); px(cx, my - 1, aiColors[q.side]);
    // wounded general: HP pips
    if (st.m < 100) {
      const w = 12, fill = Math.round(w * st.m / 100);
      px(cx - 6, cy + 3, '#1b1a22', w + 2, 3);
      px(cx - 5, cy + 4, st.m > 50 ? '#5ad06a' : st.m > 25 ? '#ffd166' : '#ff5a4a', fill, 1);
    }
  }

  // ── missiles and spells ───────────────────────────────────────────────────
  function drawMissiles(t) {
    const hz = P.hz;
    for (const e of P.fx.volleys) {
      if (e.t > t) break;
      const t1 = e.t + e.ft;
      if (t > t1) continue;
      const q = P.squads[e.a];
      const st = stateAt(q, e.t);
      const k = (t - e.t) / Math.max(0.05, e.ft);
      const dist = Math.hypot(e.x - st.x, e.y - st.y);
      const H = dist * 0.16 * K;
      const nArrows = Math.min(e.kind === 'holy' ? 3 : 9, e.n);
      for (let i = 0; i < nArrows; i++) {
        const s1 = h3(e.a, Math.round(e.t * 100), i), s2 = h3(i, e.a, Math.round(e.t * 10));
        const kk = clamp(k * (0.9 + s1 * 0.2), 0, 1);
        if (kk >= 1) continue;
        const sx = st.x + (s1 - 0.5) * 30, sy = st.y + (s2 - 0.5) * 30;
        const tx = e.x + (s2 - 0.5) * 44, ty = e.y + (s1 - 0.5) * 36;
        const gx = X(lerp(sx, tx, kk)), gy = Y(lerp(sy, ty, kk));
        const hgt = H * 4 * kk * (1 - kk);
        const dh = H * 4 * (1 - 2 * kk);
        const vx = (tx - sx) * K, vy = (ty - sy) * K - dh;
        const l = Math.hypot(vx, vy) || 1;
        const ux = vx / l, uy = vy / l;
        px(gx, gy, 'rgba(0,0,0,0.25)');
        if (e.kind === 'holy') {
          px(gx - 1, gy - hgt - 1, '#fff6c8', 3, 3); px(gx, gy - hgt, '#ffffff');
          px(gx - ux * 3, gy - hgt - uy * 3, 'rgba(255,230,140,0.6)');
        } else {
          px(gx, gy - hgt, '#e8dcc0');
          px(gx - ux * 1.5, gy - hgt - uy * 1.5, '#8a6a3a');
          px(gx - ux * 2.6, gy - hgt - uy * 2.6, '#f4f4f4');
        }
      }
    }
    for (const e of P.fx.stones) {
      if (e.t > t) break;
      if (t > e.t + e.ft) continue;
      const q = P.squads[e.a];
      const st = stateAt(q, e.t);
      const k = (t - e.t) / e.ft;
      const gx = X(lerp(st.x, e.x, k)), gy = Y(lerp(st.y, e.y, k));
      const H = Math.hypot(e.x - st.x, e.y - st.y) * 0.32 * K;
      const hgt = H * 4 * k * (1 - k);
      discA(gx, gy, 1.5, '#000', 0.3);
      px(gx - 1, gy - hgt - 1, '#5a5650', 3, 3); px(gx - 1, gy - hgt - 1, '#9a948a');
      if (k < 0.15) { discA(X(st.x), Y(st.y) - 2, 4 + k * 20, P.pal.dust, 0.5 * (1 - k / 0.15)); }
    }
    for (const e of P.fx.spells) {
      if (e.t > t) break;
      if (t > e.t + e.ft) continue;
      const q = P.squads[e.a];
      const st = stateAt(q, e.t);
      const k = (t - e.t) / e.ft;
      const H = Math.hypot(e.x - st.x, e.y - st.y) * 0.1 * K;
      const pos = (kk) => [X(lerp(st.x, e.x, kk)), Y(lerp(st.y, e.y, kk)) - H * 4 * kk * (1 - kk) - 5 * (1 - kk)];
      for (let j = 4; j >= 1; j--) { const [tx, ty] = pos(Math.max(0, k - j * 0.05)); b.globalAlpha = 0.18 * (5 - j); px(tx - 1, ty - 1, '#ff7a20', 2, 2); }
      b.globalAlpha = 1;
      const [fx, fy] = pos(k);
      px(fx - 2, fy - 1, '#ff7a20', 4, 3); px(fx - 1, fy - 2, '#ff7a20', 2, 5); px(fx - 1, fy - 1, '#ffd35a', 2, 2); px(fx, fy - 1, '#ffffff');
      // telegraph ring on the ground
      b.globalAlpha = 0.35; ringPx(X(e.x), Y(e.y), e.r * K * 0.8, '#ff9a30', 2); b.globalAlpha = 1;
    }
    // meteor (power) falling
    for (const e of P.fx.powers) {
      if (e.p !== 'meteor' || e.t > t || t > e.t + e.ft) continue;
      const k = (t - e.t) / e.ft;
      const tx = X(e.x), ty = Y(e.y);
      const sx = tx + 160, sy = ty - 260;
      const mx = lerp(sx, tx, k * k), my = lerp(sy, ty, k * k);
      b.globalAlpha = 0.5 + 0.3 * Math.sin(t * 20); ringPx(tx, ty, e.r * K * (1.1 - 0.3 * k), '#ff4a2a', 1); b.globalAlpha = 1;
      for (let j = 1; j <= 8; j++) { const kk = Math.max(0, k * k - j * 0.025); b.globalAlpha = 0.9 - j * 0.1; px(lerp(sx, tx, kk) - 1, lerp(sy, ty, kk) - 1, j < 3 ? '#ffd35a' : '#ff6a20', 3, 3); }
      b.globalAlpha = 1;
      px(mx - 3, my - 3, '#ff6a20', 7, 7); px(mx - 2, my - 2, '#ffd35a', 5, 5); px(mx - 1, my - 1, '#ffffff', 3, 3);
    }
  }
  function drawBlasts(t) {
    for (const e of P.fx.booms) {
      if (e.t > t) break;
      const age = t - e.t;
      const life = e.kind === 'meteor' ? 1.6 : e.kind === 'bolt' ? 0.6 : 0.9;
      if (age > life) continue;
      const k = age / life;
      const cx = X(e.x), cy = Y(e.y), R = e.r * K;
      if (e.kind === 'stone') {
        discA(cx, cy, R * (0.4 + k * 0.7), P.pal.dust, 0.55 * (1 - k));
        for (let i = 0; i < 8; i++) { const a = h2(i, e.x) * TAU, d = R * k * (0.6 + h2(e.y, i) * 0.6); px(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7 - 6 * Math.sin(k * Math.PI), '#6a5a48'); }
        continue;
      }
      if (e.kind === 'bolt') {
        if (age < 0.25) {
          let x = cx + 20, y = cy - 120;
          b.fillStyle = age < 0.1 ? '#ffffff' : '#bfe6ff';
          for (let s = 0; s < 12; s++) { const nx = lerp(x, cx, 1 / (12 - s)) + (h2(s, Math.round(e.t * 10)) - 0.5) * 8, ny = y + (cy - y) / (12 - s); const steps = Math.max(2, Math.ceil(Math.abs(ny - y))); for (let j = 0; j <= steps; j++) b.fillRect(Math.round(lerp(x, nx, j / steps)) - 1, Math.round(lerp(y, ny, j / steps)), 2, 1); x = nx; y = ny; }
          discA(cx, cy, R * 0.9, '#dff4ff', 0.5);
        }
        discA(cx, cy, R * (0.3 + k), '#9ad8ff', 0.35 * (1 - k));
        continue;
      }
      if (e.kind === 'stomp') continue;
      // fire (fireball, breath, meteor)
      const big = e.kind === 'meteor';
      if (age < 0.12) discA(cx, cy, R * (big ? 1.2 : 0.9), '#fff4b0', 0.8);
      discA(cx, cy, R * (0.35 + k * 0.75), '#ff7a20', 0.55 * (1 - k));
      discA(cx, cy, R * (0.2 + k * 0.45), '#ffd35a', 0.6 * (1 - k));
      const nP = big ? 26 : 12;
      for (let i = 0; i < nP; i++) {
        const a = h2(i, Math.round(e.t * 100)) * TAU, sp = 0.4 + h2(Math.round(e.t * 100), i) * 0.8;
        const d = R * k * sp * 1.3;
        px(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.75 - 10 * k * sp, i % 3 ? '#ff9a30' : '#ffe08a');
      }
      if (big) { b.globalAlpha = 0.6 * (1 - k); ringPx(cx, cy, R * (0.5 + k * 1.4), '#ffe08a', 1); b.globalAlpha = 1; }
    }
    for (const e of P.fx.stomps) {
      if (e.t > t) break;
      const age = t - e.t;
      if (age > 0.9) continue;
      const k = age / 0.9;
      b.globalAlpha = 0.7 * (1 - k); ringPx(X(e.x), Y(e.y), e.r * K * (0.2 + k), P.pal.dust, 1); ringPx(X(e.x), Y(e.y), e.r * K * (0.1 + k * 0.8), '#ffffff', 2); b.globalAlpha = 1;
    }
    for (const e of P.fx.breaths) {
      if (e.t > t) break;
      const age = t - e.t;
      if (age > 0.7) continue;
      const q = P.squads[e.a];
      const st = stateAt(q, e.t);
      const sx = X(st.x), sy = Y(st.y) - (HOVER.dragon || 0) - 4, tx = X(e.x), ty = Y(e.y);
      for (let i = 0; i < 26; i++) {
        const kk = clamp(age / 0.35 - h2(i, 3) * 0.6, 0, 1);
        if (kk <= 0) continue;
        const spread = (h2(i, 4) - 0.5) * e.r * K * kk;
        const nx = -(ty - sy), ny = tx - sx, nl = Math.hypot(nx, ny) || 1;
        const x = lerp(sx, tx, kk) + nx / nl * spread, y = lerp(sy, ty, kk) + ny / nl * spread;
        b.globalAlpha = age > 0.35 ? 1 - (age - 0.35) / 0.35 : 1;
        px(x - 1, y - 1, i % 4 === 0 ? '#fff4b0' : i % 2 ? '#ff9a30' : '#ff5a20', 2, 2);
      }
      b.globalAlpha = 1;
    }
  }
  function drawCombatFx(t, anim) {
    // charge impacts
    for (const e of P.fx.charges) {
      if (e.t > t) break;
      const age = t - e.t;
      if (age > 1) continue;
      const a = stateAt(P.squads[e.a], e.t), bq = stateAt(P.squads[e.b], e.t);
      const cx = X((a.x + bq.x) / 2), cy = Y((a.y + bq.y) / 2);
      const k = age;
      discA(cx, cy, 6 + k * 16, P.pal.dust, 0.5 * (1 - k));
      if (age < 0.35) for (let i = 0; i < 10; i++) { const an = h2(i, e.a * 7 + e.b) * TAU, d = 3 + age * 40 * h2(e.b, i); px(cx + Math.cos(an) * d, cy + Math.sin(an) * d * 0.7, e.br ? '#ff5a4a' : i % 2 ? '#ffffff' : '#ffe08a'); }
    }
    for (const q of P.squads) {
      const st = stateAt(q, t);
      // dust behind charging / galloping units
      if ((st.s === ST.charging || (st.s === ST.moving && (q.type === 'cavalry' || q.type === 'knights' || q.type === 'beasts' || q.type === 'general' || q.type === 'titan'))) && !HOVER[q.type]) {
        const sp = Math.hypot(st.vx, st.vy);
        if (sp > 35) {
          for (let j = 1; j <= 5; j++) {
            const p = stateAt(q, t - j * 0.12);
            const off = (h3(q.i, j, Math.floor(t * 8)) - 0.5) * 30;
            const x = X(p.x - Math.cos(p.ang) * 18 - Math.sin(p.ang) * off), y = Y(p.y - Math.sin(p.ang) * 18 + Math.cos(p.ang) * off);
            discA(x, y, 1 + j * 0.8, P.pal.dust, 0.34 - j * 0.05);
          }
        }
      }
      // melee sparks along the front
      if (st.s === ST.fighting) {
        const fm = formAt(q, t).code;
        const L = layout(q.type, fm, q.n0, st.n);
        const front = L.length ? L[0][0] + 7 : 6;
        const fx0 = st.x + Math.cos(st.ang) * front, fy0 = st.y + Math.sin(st.ang) * front;
        const width = Math.min(60, (L.filter(p => p[2] === 0).length || 1) * q.sp * 0.5);
        const tick = Math.floor(anim * 12);
        for (let i = 0; i < 3; i++) {
          if (h3(q.i, tick, i) > 0.55) continue;
          const off = (h3(tick, q.i, i + 5) - 0.5) * 2 * width;
          const sx = X(fx0 - Math.sin(st.ang) * off), sy = Y(fy0 + Math.cos(st.ang) * off) - 3;
          px(sx, sy, h3(i, tick, q.i) < 0.5 ? '#ffffff' : '#ffe08a');
          if (h3(q.i, i, tick) < 0.3) { px(sx - 1, sy, '#ffe08a'); px(sx + 1, sy, '#ffe08a'); }
        }
      }
    }
    // heals: rising sparkles
    for (const e of P.fx.heals) {
      if (e.t > t) break;
      const age = t - e.t;
      if (age > 1.4) continue;
      const q = P.squads[e.b];
      if (!q) continue;
      const st = stateAt(q, t);
      for (let i = 0; i < 7; i++) {
        const x = X(st.x + (h2(i, e.b) - 0.5) * 50), y = Y(st.y + (h2(e.b, i) - 0.5) * 30) - age * 14 - h2(i, 9) * 6;
        b.globalAlpha = 1 - age / 1.4;
        px(x, y, i % 2 ? '#9affa0' : '#fff6a0'); px(x - 1, y, 'rgba(154,255,160,0.5)'); px(x + 1, y, 'rgba(154,255,160,0.5)');
      }
      b.globalAlpha = 1;
    }
    // powers: rally ring, aegis domes
    for (const e of P.fx.powers) {
      if (e.t > t) continue;
      const age = t - e.t;
      if (e.p === 'rally' && age < 1.2) { b.globalAlpha = 0.8 * (1 - age / 1.2); ringPx(X(e.x), Y(e.y), e.r * K * (age / 1.2), '#ffd35a', 1); b.globalAlpha = 1; }
      if (e.p === 'aegis' && age < 1) { b.globalAlpha = 0.7 * (1 - age); ringPx(X(e.x), Y(e.y), e.r * K * age, '#fff6c8', 1); b.globalAlpha = 1; }
      if (e.p === 'wrath' && age < 3.2) { b.globalAlpha = 0.14; b.fillStyle = '#1a2a4a'; b.fillRect(0, 0, bw, bh); b.globalAlpha = 1; }
    }
    for (const ag of P.fx.aegis) {
      if (t < ag.t || t > ag.t1) continue;
      for (const gi of ag.gids) {
        const q = P.squads[gi];
        const st = stateAt(q, t);
        if (st.s === ST.dead || st.s === ST.fled) continue;
        b.globalAlpha = 0.35 + 0.15 * Math.sin(anim * 6 + gi);
        ringPx(X(st.x), Y(st.y) - 2, Math.max(8, (q.gen ? 12 : 30) * K * 1.2 + 4), '#ffe9a0', 2);
        b.globalAlpha = 1;
      }
    }
  }
  function drawSays(t) {
    for (const e of P.fx.says) {
      if (e.t > t || t > e.t + 3) continue;
      const g = P.squads.find(q => q.gen && q.side === e.s);
      if (!g) continue;
      const st = stateAt(g, t);
      if (st.s === ST.dead) continue;
      const text = String(e.text).slice(0, 40);
      b.font = `8px ${PIXEL_FONT}`;
      const w = Math.ceil(b.measureText(text).width) + 6;
      let x = X(st.x) - Math.round(w / 2), y = Y(st.y) - 48;
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
    if (!shimmer.length) return;
    for (const [x, y, ph] of shimmer) {
      const v = Math.sin(anim * 2.2 + ph * 40 + y * 0.1);
      if (v > 0.6) px(x, y, 'rgba(220,240,255,0.75)', 2, 1);
    }
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
    P.pal = PALETTES[map.palette] || PALETTES.meadow;
    if (lastT !== null && t > lastT && t - lastT < 0.6) playSounds(lastT, t);
    lastT = t;
    const tc = clamp(t, 0, P.dur);
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.imageSmoothingEnabled = false;
    b.drawImage(ground, 0, 0);
    drawWater(anim);
    drawDecals(tc, P.pal);
    collectSoldiers(tc);
    drawSoldiers(tc);
    b.globalAlpha = 0.82;
    b.drawImage(canopy, 0, 0);
    b.globalAlpha = 1;
    drawCombatFx(tc, anim);
    drawMissiles(tc);
    drawBlasts(tc);
    drawBanners(tc, anim);
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
    b.drawImage(canopy, 0, 0);
    // two idle standards at the deployment zones
    for (let s = 0; s < 2; s++) {
      const x = X(s === 0 ? -620 : 620), y = Y(0);
      px(x, y - 22, '#3a2a1a', 1, 22);
      const col = aiColors[s];
      for (let i = 0; i < 9; i++) { const wave = Math.round(Math.sin(anim * 4 + i * 0.7)); px(s === 0 ? x + 1 + i : x - 1 - i, y - 22 + wave, col, 1, 7); }
    }
    drawClouds(anim);
    present();
  }
  function hudAt(t) {
    if (!rep || !P) return [null, null];
    const hz = P.hz;
    const f = clamp(Math.round(clamp(t, 0, P.dur) * hz), 0, P.N - 1);
    const h = (rep.hud && rep.hud[f]) || [100, 50, 100, 50];
    return [0, 1].map(s => {
      const own = P.squads.filter(q => q.side === s && !q.gen);
      const alive = own.filter(q => q.s[f] !== ST.dead && q.s[f] !== ST.fled);
      const routing = alive.filter(q => q.s[f] === ST.routing).length;
      const g = P.squads.find(q => q.side === s && q.gen);
      const gHp = g ? (g.s[f] === ST.dead ? 0 : g.m[f]) : 0;
      const soldiers = alive.reduce((a, q) => a + q.n[f], 0);
      const side = P.sides[s];
      return {
        title: side.name,
        sub: `${side.label} · General ${side.general}`,
        bars: [
          { label: 'Army', value: h[s * 2], max: 100, color: aiColors[s] },
          { label: 'Morale', value: h[s * 2 + 1], max: 100, color: '#ffd166' },
          { label: 'General', value: gHp, max: 100, color: gHp > 50 ? '#5ad06a' : gHp > 25 ? '#ffd166' : '#ff5a4a' },
        ],
        chips: [`${alive.length - routing}/${own.length} squads`, `${soldiers} soldiers`].concat(routing ? [`${routing} routing`] : []),
      };
    });
  }
  function eventsBetween(t0, t1) {
    return feedRange(t0, t1).filter(e => e.text || e.big).map(e => ({ k: e.k, side: e.side, big: !!e.big, text: e.text || '' }));
  }
  return {
    setReplay,
    get duration() { return P ? P.dur : 0; },
    get camera() { return camInfo; },   // where the camera is (canvas px) - for tests
    render, renderIdle, resize, hudAt, eventsBetween,
  };
}
