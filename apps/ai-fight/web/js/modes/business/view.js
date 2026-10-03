// ─────────────────────────────────────────────────────────────────────────────
//  BUSINESS MODE — spectator view: a living pixel city.
//  Districts with their own architecture, company-coloured stores that are
//  built (scaffolding), open (confetti), get busy (little shoppers walking in,
//  +$ floating up), and close (boarded up). Seasons, a day/night cycle, weather
//  for the calendar events, and a big net-worth race chart at the bottom.
//  Pure function of (replay, t): scrubbing works. Everything is drawn into a
//  small buffer on one pixel grid and scaled up by a whole number.
// ─────────────────────────────────────────────────────────────────────────────
import * as Sound from '../../sound.js';

const DW = 400, DH = 226;            // design area (buffer px)
const CHART_Y = 170;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);

function hash(n) {
  let t = (n * 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function hexRgb(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  const f = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
  const n = parseInt(f, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, k) {
  const p = hexRgb(a), q = hexRgb(b);
  return '#' + [0, 1, 2].map(i => Math.round(p[i] + (q[i] - p[i]) * k).toString(16).padStart(2, '0')).join('');
}
function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function fmtMoney(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${s}$${Math.round(a / 1e3)}K`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${Math.round(a)}`;
}

// ── 3x5 pixel font ───────────────────────────────────────────────────────────
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', $: '011110010011110', '.': '000000000000010', ',': '000000000010100', ':': '000010000010000',
  '!': '010010010000010', '?': '110001010000010', '%': '101001010100101', '+': '000010111010000', '-': '000000111000000',
  '/': '001001010100100', "'": '010010000000000', '(': '001010010010001', ')': '100010010010100', '&': '010101010101011',
  '#': '101111101111101', '>': '100010001010100', '<': '001010100010001', '=': '000111000111000', ' ': '000000000000000',
  '*': '000101010101000', '"': '101101000000000',
};
function textWidth(s) { return String(s).length * 4 - 1; }

// ── 5x5 logo icons ───────────────────────────────────────────────────────────
const ICONS = {
  cup: '0000011110111011111001100', taco: '0000001110111111000111111', burger: '0111011111101011111101110',
  star: '0010011111011100101010001', bolt: '0011001100111100011001100', leaf: '0011101111111101110010000',
  crown: '1010110101111111111111111', rocket: '0010001110011101111110101', heart: '0101011111111110111000100',
  diamond: '0010001110111110111000100', robot: '1111110101111110111001010', planet: '0000101110111110111010000',
  flame: '0010001100011101111101110', tag: '1110010110110110110100110', gear: '1010101110110110111010101',
  anchor: '0010001110001001010101110',
};

// ── district layout (design px) ──────────────────────────────────────────────
const L = {
  oldtown:    { x: 6,   y: 16,  w: 100, h: 46, style: 'oldtown' },
  downtown:   { x: 112, y: 16,  w: 100, h: 46, style: 'downtown' },
  techpark:   { x: 218, y: 16,  w: 100, h: 46, style: 'techpark' },
  airport:    { x: 324, y: 16,  w: 70,  h: 46, style: 'airport' },
  university: { x: 6,   y: 70,  w: 100, h: 46, style: 'university' },
  mall:       { x: 112, y: 70,  w: 100, h: 46, style: 'mall' },
  suburbs:    { x: 218, y: 70,  w: 100, h: 46, style: 'suburbs' },
  harbor:     { x: 6,   y: 124, w: 206, h: 38, style: 'harbor' },
  tokyo:      { x: 328, y: 70,  w: 66,  h: 28, style: 'tokyo', island: true },
  paris:      { x: 328, y: 102, w: 66,  h: 28, style: 'paris', island: true },
  newyork:    { x: 328, y: 134, w: 66,  h: 28, style: 'newyork', island: true },
  moon:       { x: 222, y: 126, w: 64,  h: 34, style: 'moon', island: true },
};
const NAMES = { downtown: 'DOWNTOWN', university: 'UNIVERSITY', suburbs: 'SUBURBS', harbor: 'HARBOR', oldtown: 'OLD TOWN', techpark: 'TECH PARK', mall: 'MALL', airport: 'AIRPORT', tokyo: 'NEO TOKYO', paris: 'PARIS', newyork: 'NEW YORK', moon: 'MOON' };
const ALL_DISTRICTS = Object.keys(L);
const WEB = { x: 290, y: 128, w: 30, h: 32 };   // logistics park (online stores)
const SEASON_COL = [
  { grass: '#5aa64c', grass2: '#4d9442', tree: '#3f8a3c', tree2: '#f2a7c4', ground: '#b9ad92' },
  { grass: '#57a83d', grass2: '#4a9634', tree: '#2f7d2f', tree2: '#3f9a3a', ground: '#c2b590' },
  { grass: '#9a9a48', grass2: '#8a8a40', tree: '#d9822b', tree2: '#c8552b', ground: '#b3a07e' },
  { grass: '#dfe8ef', grass2: '#cfdbe6', tree: '#4f6f5f', tree2: '#ffffff', ground: '#c9d3dd' },
];
const SEA = '#2a5d8f', SEA2 = '#244f7c', SEA_DEEP = '#1b3d63';
const SKIN = ['#f0cfa8', '#d8a47e', '#a8744e', '#6e4a30', '#ffe0c0'];
const SHIRT = ['#5b6283', '#c0504d', '#3a4a6e', '#9bbb59', '#4bacc6', '#f79646', '#8064a2', '#e8e8e8', '#2e5a6a', '#d4a017'];

export function createView(canvas) {
  const ctx = canvas.getContext('2d');
  const buf = document.createElement('canvas');
  const b = buf.getContext('2d');
  let cw = 0, ch = 0, dpr = 1, z = 1, bw = DW, bh = DH, ox = 0, oy = 0;
  let replay = null, sideCol = ['#e8825c', '#2fc58e'];
  let frames = [], storeMaps = [], evs = [], stores = [], daySec = 0.6, days = 120, level = 1, startCash = 10000;
  let open = new Set(ALL_DISTRICTS.filter(d => d !== 'moon'));
  const staticCache = new Map();
  let lastSaleSound = 0;

  // ── pixel primitives (buffer coords) ──
  function rect(x, y, w, h, col) { b.fillStyle = col; b.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function px(x, y, col) { b.fillStyle = col; b.fillRect(Math.round(x), Math.round(y), 1, 1); }
  function text(str, x, y, col = '#fff', { align = 'left', shadow = '#000', scale = 1 } = {}) {
    const s = String(str).toUpperCase();
    let w = textWidth(s) * scale;
    let cx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
    const cy = Math.round(y);
    for (const pass of shadow ? [0, 1] : [1]) {
      b.fillStyle = pass === 0 ? shadow : col;
      let xx = cx + (pass === 0 ? 1 : 0), yy = cy + (pass === 0 ? 1 : 0);
      for (const chr of s) {
        const g = GLYPHS[chr] || GLYPHS['?'];
        for (let i = 0; i < 15; i++) if (g[i] === '1') b.fillRect(xx + (i % 3) * scale, yy + Math.floor(i / 3) * scale, scale, scale);
        xx += 4 * scale;
      }
    }
    return w;
  }
  function icon(name, x, y, fg, bg) {
    const g = ICONS[name] || ICONS.star;
    if (bg) rect(x - 1, y - 1, 7, 7, bg);
    b.fillStyle = fg;
    for (let i = 0; i < 25; i++) if (g[i] === '1') b.fillRect(x + (i % 5), y + Math.floor(i / 5), 1, 1);
  }
  function line(x0, y0, x1, y1, col) {
    b.fillStyle = col;
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, guard = 0;
    while (guard++ < 1200) {
      b.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // ── sizing ──
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (w !== cw || h !== ch) { cw = w; ch = h; canvas.width = w; canvas.height = h; }
  }
  function prepare() {
    resize();
    // whole-number zoom keeps pixels even; switch to a fractional zoom when that would waste over ~12% of the stage
    const fit = Math.min(cw / DW, ch / DH);
    z = fit < 1 ? Math.max(0.5, fit) : (Math.floor(fit) / fit < 0.88 ? fit : Math.floor(fit));
    bw = Math.ceil(cw / z); bh = Math.ceil(ch / z);
    if (buf.width !== bw || buf.height !== bh) { buf.width = bw; buf.height = bh; }
    ox = Math.floor((bw - DW) / 2); oy = Math.floor((bh - DH) / 2);
    b.imageSmoothingEnabled = false;
  }
  function present() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(buf, 0, 0, bw * z, bh * z);
  }

  // ── the static city layer (per season + unlocked set), cached ──
  function staticLayer(season) {
    const key = `${season}|${[...open].join(',')}|${bw}x${bh}`;
    if (staticCache.has(key)) return staticCache.get(key);
    const c = document.createElement('canvas');
    c.width = bw; c.height = bh;
    const save = b;
    const g = c.getContext('2d');
    // temporarily draw into the cache canvas
    drawStaticInto(g, season);
    void save;
    if (staticCache.size > 12) staticCache.clear();
    staticCache.set(key, c);
    return c;
  }

  function drawStaticInto(g, season) {
    const S = SEASON_COL[season];
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    const P = (x, y, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), 1, 1); };
    // sea everywhere
    R(0, 0, bw, bh, SEA);
    for (let y = 0; y < bh; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < bw; x += 11) if (hash(x * 31 + y * 7) > 0.6) R(x, y, 3, 1, SEA2);
    // mainland
    const X = ox, Y = oy;
    const land = [[X + 2, Y + 10, 320, 116], [X + 2, Y + 118, 214, 48], [X + 318, Y + 10, 80, 56], [X + 214, Y + 118, 110, 48]];
    for (const [x, y, w, h] of land) R(x, y, w, h, '#c9b98f');
    for (const [x, y, w, h] of land) R(x + 1, y + 1, w - 2, h - 2, S.grass);
    // beach edge
    R(X + 2, Y + 164, 322, 2, '#e3d3a0');
    // roads (the grid between blocks)
    const road = '#3b3f4a', dash = '#d8c65a';
    R(X + 2, Y + 62, 396, 8, road);  R(X + 2, Y + 116, 322, 8, road);
    R(X + 106, Y + 12, 6, 152, road); R(X + 212, Y + 12, 6, 152, road); R(X + 318, Y + 12, 6, 58, road);
    R(X + 2, Y + 11, 396, 5, road);
    for (let x = X + 4; x < X + 396; x += 6) { R(x, Y + 66, 3, 1, dash); if (x < X + 322) R(x, Y + 120, 3, 1, dash); }
    for (let y = Y + 14; y < Y + 162; y += 6) { R(X + 109, y, 1, 3, dash); R(X + 215, y, 1, 3, dash); }
    // crossings
    for (const cx of [X + 106, X + 212]) for (const cy of [Y + 62, Y + 116]) for (let k = 0; k < 6; k += 2) R(cx + k, cy + 1, 1, 6, '#c8ccd6');
    // bridge to the islands + the logistics park
    R(X + 322, Y + 84, 6, 3, '#8a7a5a'); R(X + 322, Y + 116, 6, 3, '#8a7a5a'); R(X + 322, Y + 148, 6, 3, '#8a7a5a');
    // central park (the Moon Colony's launch pad takes it over at level 12)
    if (!open.has('moon')) {
      const PX = X + 220, PY = Y + 126;
      R(PX, PY, 66, 34, S.grass2);
      R(PX + 30, PY + 10, 22, 12, '#3f7fb8'); R(PX + 32, PY + 11, 18, 10, '#4f93cc'); R(PX + 36, PY + 13, 5, 1, '#9fd0ff');
      R(PX + 4, PY + 16, 58, 2, '#cbbd96'); R(PX + 20, PY + 2, 2, 30, '#cbbd96');
      R(PX + 19, PY + 14, 4, 5, '#d8d8d8'); P(PX + 21, PY + 13, '#9fd0ff');
      for (let k = 0; k < 9; k++) {
        const tx = PX + 3 + hash(k * 29 + 1) * 58, ty = PY + 2 + hash(k * 13 + 7) * 24;
        if (tx > PX + 28 && tx < PX + 54 && ty > PY + 7 && ty < PY + 23) continue;
        R(tx + 1, ty + 3, 1, 2, '#6b4a2b'); g.fillStyle = S.tree; g.fillRect(tx, ty, 3, 3); g.fillRect(tx - 1, ty + 1, 5, 1);
        if (season === 3) P(tx + 1, ty, '#ffffff'); else if (season !== 1) P(tx, ty + 1, S.tree2);
      }
      R(PX + 8, PY + 20, 5, 1, '#8a5a3a'); R(PX + 44, PY + 26, 5, 1, '#8a5a3a');
    }
    // districts
    for (const d of ALL_DISTRICTS) {
      const l = L[d];
      if (d === 'moon' && !open.has('moon')) continue;
      drawDistrictStatic(g, R, P, d, l, S, season, open.has(d));
    }
    // logistics park (online stores)
    const wx = X + WEB.x, wy = Y + WEB.y;
    R(wx - 2, wy - 2, WEB.w + 4, WEB.h + 4, '#8a8f99');
    R(wx - 1, wy - 1, WEB.w + 2, WEB.h + 2, '#5d626e');
    for (let k = 0; k < WEB.w; k += 5) R(wx + k, wy + WEB.h - 3, 3, 1, '#e8e8e8');
  }

  function drawDistrictStatic(g, R, P, d, l, S, season, isOpen) {
    const X = ox + l.x, Y = oy + l.y, w = l.w, h = l.h;
    const snow = season === 3;
    if (l.island) {
      if (d === 'moon') {
        R(X + 4, Y + 2, w - 8, h - 4, '#8d8f9a'); R(X + 2, Y + 5, w - 4, h - 10, '#8d8f9a'); R(X + 8, Y + 4, w - 16, 2, '#a9abb5');
        for (let k = 0; k < 7; k++) { const cx = X + 8 + hash(k * 9 + 3) * (w - 16), cy = Y + 8 + hash(k * 5 + 1) * (h - 18); R(cx, cy, 4, 3, '#71737e'); R(cx + 1, cy, 2, 1, '#5d5f69'); }
      } else {
        R(X - 2, Y - 2, w + 4, h + 4, '#e3d3a0');
        R(X, Y, w, h, S.grass);
      }
    } else if (d === 'harbor') {
      R(X, Y, w, h, '#9c8a66');
      for (let k = 0; k < w; k += 4) R(X + k, Y + 1, 1, h - 2, '#8a7856');
      R(X, Y + h - 4, w, 4, '#6f5f45');
    } else {
      R(X, Y, w, h, '#b7b0a2');                       // sidewalk
      R(X + 1, Y + 1, w - 2, h - 2, blockGround(l.style, S));
    }
    // decor in the upper part (y < storeline - 12)
    const top = Y + 2, deco = h - 22;
    const bb = (x, y, ww, hh, col, roof) => { R(x, y, ww, hh, col); if (roof) R(x - 1, y - 1, ww + 2, 2, roof); if (snow && roof) R(x - 1, y - 2, ww + 2, 1, '#ffffff'); };
    const win = (x, y, ww, hh, col, step = 3) => { for (let yy = y + 2; yy < y + hh - 2; yy += step) for (let xx = x + 1; xx < x + ww - 1; xx += 2) P(xx, yy, col); };
    const tree = (x, y, big) => {
      R(x + 1, y + 3 + (big ? 1 : 0), 1, 3, '#6b4a2b');
      g.fillStyle = S.tree; g.fillRect(x, y, 3, 3 + (big ? 1 : 0)); g.fillRect(x - 1, y + 1, 5, 2);
      if (season === 0 || season === 2) { P(x + 1, y, S.tree2); P(x - 1, y + 2, S.tree2); }
      if (snow) { P(x, y, '#ffffff'); P(x + 1, y, '#ffffff'); }
    };
    switch (l.style) {
      case 'downtown':
        for (let k = 0; k < 7; k++) {
          const hh = 12 + Math.floor(hash(k + 11) * 12), ww = 8 + Math.floor(hash(k + 3) * 5);
          const x = X + 4 + k * 13, y = top + deco + 2 - hh;
          bb(x, y, ww, hh, ['#6c7a91', '#56627a', '#7e8aa3', '#4c5870'][k % 4], '#3a4254');
          win(x, y, ww, hh, '#9fb4d8');
        }
        break;
      case 'university':
        bb(X + 30, top + 6, 36, 14, '#a8503c', '#6e2f24'); win(X + 30, top + 6, 36, 14, '#f3dca8', 3);
        R(X + 45, top - 1, 6, 8, '#a8503c'); R(X + 46, top + 1, 4, 3, '#f5f0e0'); P(X + 48, top + 2, '#333');
        for (let k = 0; k < 4; k++) tree(X + 6 + k * 6, top + 12);
        for (let k = 0; k < 3; k++) tree(X + 72 + k * 8, top + 12);
        break;
      case 'suburbs':
        for (let k = 0; k < 8; k++) {
          const x = X + 4 + k * 12, y = top + 10 + (k % 2) * 3;
          const roof = ['#c0504d', '#4f81bd', '#9bbb59', '#8064a2'][k % 4];
          bb(x, y + 2, 8, 6, '#efe6d2', roof); R(x + 1, y, 6, 2, roof); P(x + 3, y + 5, '#6b4a2b'); P(x + 5, y + 4, '#9fd0ff');
          if (k % 3 === 0) tree(x + 9, y + 3);
        }
        break;
      case 'oldtown':
        for (let k = 0; k < 8; k++) {
          const x = X + 4 + k * 11, hh = 10 + (k % 3) * 2, y = top + deco + 2 - hh;
          const col = ['#d9a066', '#c7875a', '#e0b47a', '#b87450'][k % 4];
          bb(x, y, 9, hh, col, '#7a3b2a'); R(x + 1, y - 3, 7, 2, '#7a3b2a'); R(x + 3, y - 4, 3, 1, '#7a3b2a');
          win(x, y, 9, hh, '#fff1c1', 4);
        }
        R(X + 88, top + 1, 5, 18, '#9b8a78'); R(X + 89, top - 3, 3, 4, '#6e5a4a'); P(X + 90, top - 5, '#ffd76a');
        break;
      case 'techpark':
        for (let k = 0; k < 5; k++) {
          const hh = 14 + (k % 2) * 6, x = X + 6 + k * 19, y = top + deco + 2 - hh;
          bb(x, y, 14, hh, ['#5fc4d6', '#4aa8c0'][k % 2], '#2f6f80');
          for (let yy = y + 2; yy < y + hh - 1; yy += 2) R(x + 1, yy, 12, 1, '#8fe6f2');
        }
        R(X + 92, top + 2, 1, 6, '#ccc'); R(X + 90, top + 1, 5, 2, '#e8e8e8');
        break;
      case 'mall':
        bb(X + 8, top + 4, 84, 16, '#d8c9a8', '#8a7a5a'); R(X + 10, top + 6, 80, 3, '#9fd8f0');
        for (let k = 0; k < 8; k++) R(X + 12 + k * 10, top + 12, 6, 6, '#a0c8e0');
        text2(g, 'MALL', X + 42, top + 13, '#6a4a2a');
        break;
      case 'airport':
        R(X + 4, top + 4, w - 8, 8, '#555a66'); for (let k = X + 6; k < X + w - 6; k += 6) R(k, top + 7, 3, 1, '#f0f0f0');
        R(X + w - 16, top + 13, 6, 10, '#d0d6e0'); R(X + w - 18, top + 11, 10, 3, '#8fb4d8');
        // plane
        R(X + 20, top + 6, 14, 2, '#f4f4f4'); R(X + 25, top + 3, 3, 8, '#f4f4f4'); R(X + 32, top + 5, 2, 4, '#c0504d');
        break;
      case 'harbor':
        R(X + 150, Y + 4, 5, 18, '#f0f0f0'); R(X + 150, Y + 8, 5, 3, '#c0504d'); R(X + 149, Y + 2, 7, 3, '#ffd76a');
        for (let k = 0; k < 4; k++) { const x = X + 10 + k * 34; R(x, Y + 4, 16, 6, ['#c9b8a0', '#d8c7ad'][k % 2]); R(x + 2, Y + 2, 12, 2, '#8a5a3a'); }
        R(X + 176, Y + 6, 18, 4, '#6b4a2b'); R(X + 184, Y + 1, 1, 6, '#ddd'); R(X + 185, Y + 2, 4, 3, '#f5f5f5');
        break;
      case 'tokyo':
        R(X + 4, Y + 2, 6, 12, '#c0504d'); R(X + 3, Y + 2, 8, 1, '#333'); R(X + 3, Y + 6, 8, 1, '#333'); R(X + 3, Y + 10, 8, 1, '#333');
        for (let k = 0; k < 4; k++) { R(X + 16 + k * 11, Y + 2 + (k % 2) * 3, 8, 12 - (k % 2) * 3, '#3a3f5c'); for (let yy = Y + 4; yy < Y + 13; yy += 2) P(X + 18 + k * 11, yy, ['#ff4fd8', '#4ff2ff'][k % 2]); }
        break;
      case 'paris':
        for (let k = 0; k < 3; k++) { R(X + 20 + k * 14, Y + 6, 10, 8, '#e8dcc0'); R(X + 20 + k * 14, Y + 5, 10, 1, '#5a6a7a'); }
        // eiffel tower
        line2(g, X + 8, Y + 14, X + 11, Y + 1, '#6b5a4a'); line2(g, X + 14, Y + 14, X + 11, Y + 1, '#6b5a4a'); R(X + 9, Y + 9, 5, 1, '#6b5a4a'); R(X + 10, Y + 5, 3, 1, '#6b5a4a');
        break;
      case 'newyork':
        for (let k = 0; k < 6; k++) { const hh = 8 + Math.floor(hash(k + 40) * 8); R(X + 4 + k * 9, Y + 15 - hh, 7, hh, ['#7e8aa3', '#5d6a82'][k % 2]); }
        R(X + 58, Y + 4, 2, 10, '#5fb89a'); R(X + 57, Y + 2, 4, 2, '#5fb89a'); P(X + 60, Y + 1, '#ffd76a');
        break;
      default: break;
    }
    if (!isOpen) {
      g.fillStyle = 'rgba(40,44,58,0.62)'; g.fillRect(X, Y, w, h);
      for (let k = 0; k < w; k += 4) { g.fillStyle = '#c8a040'; g.fillRect(X + k, Y + h - 5, 2, 1); g.fillStyle = '#3a3f4a'; g.fillRect(X + k + 2, Y + h - 5, 2, 1); }
      const lv = { oldtown: 4, techpark: 5, mall: 6, airport: 7, suburbs: 2, harbor: 3, tokyo: 10, paris: 10, newyork: 10, moon: 12 }[d] || '';
      text2(g, `LOCKED  LV ${lv}`, X + w / 2 - textWidth(`LOCKED  LV ${lv}`) / 2, Y + h / 2 - 3, '#c8ccd6');
    }
  }
  function blockGround(style, S) {
    switch (style) {
      case 'downtown': return '#8e8f96';
      case 'techpark': return '#8fa6a8';
      case 'mall': return '#a7a39a';
      case 'oldtown': return '#b09a7c';
      case 'airport': return '#9aa08e';
      default: return S.grass2;
    }
  }
  function text2(g, s, x, y, col) {
    g.fillStyle = col;
    let xx = Math.round(x);
    for (const chr of String(s).toUpperCase()) {
      const gl = GLYPHS[chr] || GLYPHS['?'];
      for (let i = 0; i < 15; i++) if (gl[i] === '1') g.fillRect(xx + (i % 3), Math.round(y) + Math.floor(i / 3), 1, 1);
      xx += 4;
    }
  }
  function line2(g, x0, y0, x1, y1, col) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    g.fillStyle = col;
    for (let k = 0; k <= n; k++) g.fillRect(Math.round(lerp(x0, x1, k / n)), Math.round(lerp(y0, y1, k / n)), 1, 1);
  }

  // ── replay helpers ──
  function setReplay(rep, colors) {
    replay = rep || null;
    if (Array.isArray(colors)) sideCol = [colors[0] || sideCol[0], colors[1] || sideCol[1]];
    if (!replay) { frames = []; stores = []; evs = []; return; }
    frames = replay.frames || [];
    daySec = replay.daySec || 0.6;
    days = frames.length;
    level = replay.level || 1;
    stores = (replay.stores || []).slice();
    evs = (replay.events || []).slice().sort((p, q) => p.t - q.t);
    storeMaps = frames.map(() => null);
    open = new Set(replay.districts || []);
    startCash = frames.length ? Math.max(1, frames[0].s[0][1] - frames[0].s[0][5]) : 10000;
    staticCache.clear();
  }
  function storeMap(k) {
    if (k < 0 || k >= frames.length) return null;
    if (!storeMaps[k]) { const m = new Map(); for (const e of frames[k].st || []) m.set(e[0], e); storeMaps[k] = m; }
    return storeMaps[k];
  }
  function lastEntry(arr, day) { let v = arr[0]; for (const e of arr) if (e[0] <= day) v = e; return v; }
  /** side value (column c) at fractional day position */
  function val(side, c, dayF) {
    if (!frames.length) return 0;
    const k = Math.floor(dayF);
    const a = k <= 0 ? startVal(side, c) : frames[Math.min(frames.length, k) - 1].s[side][c];
    const bv = frames[Math.min(frames.length - 1, k)].s[side][c];
    if (k >= frames.length) return frames[frames.length - 1].s[side][c];
    return lerp(a, bv, smooth(dayF - k));
  }
  function startVal(side, c) {
    if (c === 1 || c === 0) return startCash;
    return frames[0].s[side][c];
  }

  // ── dynamic drawing ──
  function storePos(st) {
    if (!st.district) return { x: ox + WEB.x + 4 + st.side * 14, y: oy + WEB.y + WEB.h - 4 };
    const l = L[st.district];
    const slots = l.island ? 6 : Math.min(8, Math.floor((l.w - 4) / 12));
    const sl = clamp(st.slot, 0, 7);
    const k = slots >= 8 ? sl : Math.round(sl * (slots - 1) / 7);
    const step = (l.w - 6) / slots;
    return { x: ox + l.x + 3 + k * step + step / 2, y: oy + l.y + l.h - 2 };
  }

  function drawStore(st, cur, dayF, anim, night, custToday) {
    const p = storePos(st);
    const x = Math.round(p.x), y = Math.round(p.y);
    const side = lastEntry(st.owners, cur)[1];
    const col = sideCol[side] || '#ccc';
    const S = replay.sides[side] || {};
    const logo = S.logo || { icon: 'star', primary: col, secondary: '#fff' };
    const tier = lastEntry(st.tiers, cur)[1];
    const readyT = (st.ready - 1) * daySec;
    const tNow = dayF * daySec;
    if (st.closed && cur >= st.closed) {
      const since = dayF - (st.closed - 1);
      if (!st.bankrupt && since > 6) return;
      boarded(x, y, tier, since);
      return;
    }
    if (cur < st.ready) {
      const prog = clamp((dayF - (st.start - 1)) / Math.max(1, st.ready - st.start), 0, 1);
      scaffold(x, y, tier, prog, col, anim);
      return;
    }
    const bounce = tNow - readyT < 0.5 && tNow >= readyT ? Math.round(Math.sin((tNow - readyT) / 0.5 * Math.PI) * 2) : 0;
    const busy = clamp(custToday / ({ cart: 150, shop: 480, flagship: 1400, megastore: 3600, online: 3000 }[tier] || 400), 0, 1);
    const island = st.district && L[st.district].island;
    if (island && tier !== 'cart') {
      // overseas + moon: compact storefronts, stars mark flagships / megastores
      shop(x, y - bounce, col, logo, night, st.franchise, busy, anim);
      const stars = tier === 'megastore' ? 2 : tier === 'flagship' ? 1 : 0;
      for (let k = 0; k < stars; k++) px(x - 1 + k * 2, y - 13, '#ffd76a');
      return;
    }
    switch (tier) {
      case 'cart': cart(x, y - bounce, col, logo, anim, busy); break;
      case 'shop': shop(x, y - bounce, col, logo, night, st.franchise, busy, anim); break;
      case 'flagship': flagship(x, y - bounce, col, logo, night, anim, st.franchise); break;
      case 'megastore': megastore(x, y - bounce, col, logo, night, anim); break;
      case 'online': warehouse(x, y, col, logo, night, anim); break;
      default: shop(x, y, col, logo, night, st.franchise, busy, anim);
    }
    // grand opening confetti
    const since = tNow - readyT;
    if (since >= 0 && since < 1.4 && st.start > 0) {
      for (let k = 0; k < 14; k++) {
        const a = hash(st.id * 97 + k) * TAU, sp = 6 + hash(k * 13 + st.id) * 10;
        const cx = x + Math.cos(a) * sp * since * 1.4, cy = y - 12 + Math.sin(a) * sp * since - 6 * since + 14 * since * since;
        px(cx, cy, [col, '#ffd76a', '#ffffff', logo.primary][k % 4]);
      }
    }
  }

  function awning(x, y, w, col) {
    for (let k = 0; k < w; k++) rect(x + k, y, 1, 2, k % 2 ? '#fdf6e3' : col);
    for (let k = 0; k < w; k += 2) px(x + k, y + 2, col);
  }
  function cart(x, y, col, logo, anim, busy) {
    const wob = busy > 0.5 && Math.sin(anim * 8) > 0.6 ? 1 : 0;
    rect(x - 4, y - 5, 8, 4, '#8a5a3a'); rect(x - 4, y - 5, 8, 1, '#a9764e');
    rect(x - 3, y - 1, 2, 2, '#2b2b2b'); rect(x + 2, y - 1, 2, 2, '#2b2b2b');
    rect(x - 1, y - 11, 1, 6, '#cfcfcf');
    // umbrella
    for (let k = -4; k <= 4; k++) { const hh = 3 - Math.floor(Math.abs(k) / 2); rect(x + k, y - 12 - hh + 2 + wob * 0, 1, hh, (k + 8) % 2 ? '#fdf6e3' : col); }
    px(x - 1, y - 14, col);
    px(x + 2, y - 4, logo.primary);
    if (busy > 0.2) { const st = Math.floor(anim * 3) % 2; px(x - 2 + st, y - 7, '#ffffff'); }
  }
  function shop(x, y, col, logo, night, franchise, busy, anim) {
    const w = 11, h = 11, l = x - 5;
    rect(l, y - h, w, h, franchise ? '#d8d0c0' : '#efe4cc');
    rect(l, y - h - 1, w, 1, '#7a6a5a');
    rect(l + 1, y - h + 1, 9, 5, rgba(logo.secondary, 1)); icon(logo.icon, l + 3, y - h + 1, logo.primary, null);
    awning(l, y - 5, w, col);
    rect(l + 1, y - 3, 3, 3, night ? '#ffe9a0' : '#8ec5e8'); rect(l + 7, y - 3, 3, 3, night ? '#ffe9a0' : '#8ec5e8');
    rect(l + 4, y - 3, 3, 3, '#5a3a2a');
    if (franchise) px(l + 10, y - h - 2, '#ffd76a');
    if (busy > 0.85 && Math.floor(anim * 2) % 2) px(l + 5, y - h - 2, '#ff5a4a');
  }
  function flagship(x, y, col, logo, night, anim, franchise) {
    const w = 13, h = 17, l = x - 6;
    rect(l, y - h, w, h, '#e9e2d4'); rect(l, y - h - 1, w, 1, '#5a5048');
    rect(l, y - h + 1, w, 5, logo.primary); icon(logo.icon, l + 4, y - h + 1, logo.secondary, null);
    for (let k = 0; k < 3; k++) rect(l + 1 + k * 4, y - h + 7, 3, 3, night ? '#ffe9a0' : '#9fc8e6');
    awning(l, y - 6, w, col);
    rect(l + 1, y - 4, 4, 4, night ? '#ffe9a0' : '#8ec5e8'); rect(l + 8, y - 4, 4, 4, night ? '#ffe9a0' : '#8ec5e8'); rect(l + 5, y - 4, 3, 4, '#4a3a2a');
    // flag
    rect(l + 6, y - h - 6, 1, 5, '#cfcfcf');
    const fl = Math.floor(anim * 4) % 2;
    rect(l + 7, y - h - 6, 3, 2, col); px(l + 10, y - h - 6 + fl, col);
    if (franchise) px(l + 12, y - h - 2, '#ffd76a');
  }
  function megastore(x, y, col, logo, night, anim) {
    const w = 15, h = 21, l = x - 7;
    rect(l, y - h, w, h, '#dcd6ca'); rect(l, y - h - 1, w, 1, '#4a4440');
    rect(l, y - h + 1, w, 7, col); rect(l + 4, y - h + 1, 7, 7, logo.secondary); icon(logo.icon, l + 5, y - h + 2, logo.primary, null);
    for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) rect(l + 1 + k * 4 - (k > 1 ? 0 : 0), y - h + 10 + r * 4, 2, 2, night ? '#ffe9a0' : '#a8d0ea');
    awning(l, y - 5, w, col);
    rect(l + 5, y - 3, 5, 3, '#3a3a4a');
    if (night) { for (let k = 0; k < 3; k++) px(l + 2 + k * 5, y - h - 2, ['#ff5a4a', '#ffd76a', '#5aff8a'][(k + Math.floor(anim * 3)) % 3]); }
    // crane of spotlights
    const sp = Math.sin(anim * 1.5) * 3;
    line(l + 2, y - h - 1, l - 3 + sp, y - h - 9, rgba('#fff7c0', 0.35));
    line(l + w - 2, y - h - 1, l + w + 3 - sp, y - h - 9, rgba('#fff7c0', 0.35));
  }
  function warehouse(x, y, col, logo, night, anim) {
    const l = x - 6;
    rect(l, y - 12, 13, 12, '#9aa3b5'); rect(l - 1, y - 13, 15, 2, col);
    for (let k = 0; k < 3; k++) rect(l + 1 + k * 4, y - 8, 3, 6, '#6a7385');
    rect(l + 5, y - 17, 1, 4, '#dddddd'); px(l + 5, y - 18, Math.floor(anim * 2) % 2 ? '#ff5a4a' : '#5a1a1a');
    icon(logo.icon, l + 4, y - 12, logo.primary, null);
    // drone
    const dx = Math.sin(anim * 1.3 + x) * 10, dy = -22 + Math.cos(anim * 2.1) * 2;
    rect(x + dx - 1, y + dy, 3, 1, '#dddddd'); px(x + dx, y + dy + 1, col);
    void night;
  }
  function scaffold(x, y, tier, prog, col, anim) {
    const w = tier === 'cart' ? 9 : tier === 'shop' ? 11 : tier === 'flagship' ? 13 : 15;
    const h = tier === 'cart' ? 10 : tier === 'shop' ? 11 : tier === 'flagship' ? 17 : 21;
    const l = x - Math.floor(w / 2);
    const built = Math.round(h * prog);
    rect(l, y - built, w, built, '#cdbfa6');
    for (let yy = y - h; yy <= y; yy += 4) rect(l - 1, yy, w + 2, 1, '#8a6a3a');
    for (const xx of [l - 1, l + w]) rect(xx, y - h, 1, h, '#8a6a3a');
    // crane
    rect(l + w + 2, y - h - 6, 1, h + 6, '#e0b030');
    rect(l - 2, y - h - 6, w + 5, 1, '#e0b030');
    const hook = l + Math.round((Math.sin(anim * 1.7) * 0.5 + 0.5) * (w - 2));
    rect(hook, y - h - 5, 1, 3, '#333'); rect(hook - 1, y - h - 2, 3, 2, col);
    // progress bar
    rect(l, y + 1, w, 1, '#222'); rect(l, y + 1, Math.round(w * prog), 1, '#ffd76a');
  }
  function boarded(x, y, tier, since) {
    const w = tier === 'cart' ? 8 : tier === 'shop' ? 11 : tier === 'flagship' ? 13 : 15;
    const h = tier === 'cart' ? 6 : tier === 'shop' ? 11 : tier === 'flagship' ? 17 : 21;
    const l = x - Math.floor(w / 2);
    const a = since > 4 ? clamp(1 - (since - 4) / 2, 0, 1) : 1;
    b.globalAlpha = a;
    rect(l, y - h, w, h, '#6a625a');
    for (let k = 0; k < h; k += 3) rect(l, y - h + k, w, 1, '#8a6a4a');
    line(l, y - h, l + w - 1, y - 1, '#5a3a2a');
    if (w > 9) text('X', x - 1, y - h / 2 - 2, '#ff5a4a', { shadow: null });
    b.globalAlpha = 1;
  }

  function person(x, y, shirt, skin, step, bag) {
    x = Math.round(x); y = Math.round(y);
    px(x, y - 4, skin);
    rect(x - 1 + 1, y - 3, 1, 2, shirt); px(x - 1, y - 3, shirt); px(x + 1, y - 3, shirt);
    if (step) { px(x - 1, y - 1, '#333'); px(x + 1, y, '#333'); } else { px(x, y - 1, '#333'); px(x, y, '#333'); }
    if (bag) rect(x + 1, y - 2, 2, 2, bag);
  }

  function walkers(st, cur, dayF, cust, anim, side) {
    if (!(cust > 0)) return;
    const p = storePos(st);
    const l = st.district ? L[st.district] : null;
    const n = clamp(Math.ceil(Math.log2(1 + cust / 25)), 1, l && l.island ? 2 : 7);
    const roadY = l ? oy + l.y + l.h + 4 : oy + WEB.y + WEB.h + 2;
    const col = sideCol[side];
    for (let k = 0; k < n; k++) {
      const hsh = hash(st.id * 131 + k * 17);
      const period = 2.2 + hsh * 1.6;
      const ph = ((anim / period + hsh) % 1 + 1) % 1;
      const fromLeft = hash(st.id * 7 + k) > 0.5;
      const leaving = k % 3 === 2;
      const sx = l ? (fromLeft ? ox + l.x - 4 : ox + l.x + l.w + 4) : p.x + (fromLeft ? -18 : 18);
      const q = leaving ? 1 - ph : ph;
      // path: along the road to below the door (80%), then up to the door (20%)
      let x, y;
      if (q < 0.8) { x = lerp(sx, p.x, q / 0.8); y = roadY + (k % 2); }
      else { x = p.x; y = lerp(roadY + (k % 2), p.y + 1, (q - 0.8) / 0.2); }
      if (!l) { x = lerp(p.x + (fromLeft ? -26 : 26), p.x, q); y = roadY; }
      const skin = SKIN[Math.floor(hsh * SKIN.length)], shirt = SHIRT[Math.floor(hash(k * 3 + st.id) * SHIRT.length)];
      if (!l) { rect(x - 2, y - 3, 5, 3, '#e8e8e8'); rect(x - 2, y - 1, 5, 1, col); continue; }
      person(x, y, shirt, skin, Math.floor(anim * 6 + k) % 2, leaving ? col : null);
    }
  }

  function moneyFloats(cur, dayF, fm, side) {
    if (!fm) return;
    const frac = dayF - Math.floor(dayF);
    if (frac > 0.85) return;
    const mine = [];
    for (const st of stores) {
      const e = fm.get(st.id);
      if (!e) continue;
      if (lastEntry(st.owners, cur)[1] !== side) continue;
      mine.push([e[2], st]);
    }
    mine.sort((p, q) => (q[0] - p[0]) || (p[1].id - q[1].id));
    // one float per company per day, rotating over its three busiest stores (no pile-ups)
    const top = mine.filter(m => !(m[1].district && L[m[1].district].island)).slice(0, 3);
    if (!top.length) return;
    const pick = top[(cur + side) % top.length];
    for (const [rev, st] of [pick]) {
      if (rev < 1) continue;
      const p = storePos(st);
      const yy = p.y - 22 - frac * 10;
      const a = frac < 0.15 ? frac / 0.15 : 1 - (frac - 0.15) / 0.7;
      b.globalAlpha = clamp(a, 0, 1);
      text(`+${fmtMoney(rev)}`, p.x, yy, '#7dff9a', { align: 'center', shadow: '#0b2a14' });
      b.globalAlpha = 1;
    }
  }

  /** Name plates (on top of the stores) + a share bar per district: side A vs side B customers today. */
  function districtBars(dayF) {
    const f = frames.length ? frames[clamp(Math.floor(dayF), 0, frames.length - 1)] : null;
    for (const d of ALL_DISTRICTS) {
      const l = L[d];
      if (d === 'moon' && !open.has('moon')) continue;
      const nm = NAMES[d], tw = textWidth(nm);
      const X = ox + l.x + 1, Y = oy + l.y + 1;
      b.fillStyle = 'rgba(12,14,22,0.78)';
      b.fillRect(X, Y, tw + 4, 7);
      text(nm, X + 2, Y + 1, open.has(d) ? '#f4f1e6' : '#8a8f99', { shadow: null });
      const v = f && f.dm && f.dm[d];
      if (!v) continue;
      const tot = v[0] + v[1];
      rect(X, Y + 7, tw + 4, 2, '#20232e');
      if (tot > 0) {
        const wa = Math.round((tw + 4) * v[0] / tot);
        rect(X, Y + 7, wa, 2, sideCol[0]); rect(X + wa, Y + 7, tw + 4 - wa, 2, sideCol[1]);
      }
    }
  }

  // ── weather, seasons, night ──
  function activeEvents(day) { return (replay && replay.calendar || []).filter(e => day >= e.from && day <= e.to); }
  function weather(day, dayF, anim) {
    const act = activeEvents(day);
    const icons = new Set(act.map(e => e.icon));
    const season = Math.min(3, Math.floor((day - 1) / 30));
    const X = ox, Y = oy + 12, W = DW, H = CHART_Y - 14;
    if (icons.has('sun')) {
      b.fillStyle = 'rgba(255,170,60,0.10)'; b.fillRect(X, Y, W, H);
      for (let k = 0; k < 18; k++) { const xx = X + hash(k * 7) * W, yy = Y + ((hash(k * 3) * H + anim * 6) % H); px(xx, yy, 'rgba(255,240,200,0.5)'); px(xx + 1, yy - 1, 'rgba(255,240,200,0.35)'); }
    }
    if (icons.has('rain')) {
      b.fillStyle = 'rgba(30,50,80,0.18)'; b.fillRect(X, Y, W, H);
      for (let k = 0; k < 90; k++) { const xx = X + ((hash(k * 5) * W + anim * 40) % W), yy = Y + ((hash(k * 11) * H + anim * 120) % H); line(xx, yy, xx - 1, yy + 3, 'rgba(170,200,255,0.55)'); }
    }
    if (icons.has('down')) { b.fillStyle = 'rgba(60,60,70,0.22)'; b.fillRect(X, Y, W, H); }
    if (icons.has('snow') || season === 3) {
      const n = icons.has('snow') ? 90 : 40;
      for (let k = 0; k < n; k++) { const xx = X + ((hash(k * 5 + 1) * W + Math.sin(anim + k) * 6) % W), yy = Y + ((hash(k * 13) * H + anim * 14) % H); px(xx, yy, '#ffffff'); }
    }
    if (icons.has('chip') || icons.has('up')) {
      const t = open.has('techpark') ? L.techpark : L.downtown;
      for (let k = 0; k < 16; k++) { const ph = (anim * 1.5 + hash(k)) % 1; const xx = ox + t.x + hash(k * 3) * t.w, yy = oy + t.y + t.h - ph * (t.h + 10); px(xx, yy, ['#7dff9a', '#4ff2ff', '#ffd76a'][k % 3]); }
    }
    if (['flag', 'note', 'plane', 'ball', 'star', 'pad', 'book', 'heart'].some(i => icons.has(i))) {
      for (let k = 0; k < 40; k++) { const ph = (anim * 0.6 + hash(k * 9)) % 1; const xx = X + hash(k * 17) * W, yy = Y + ph * H; px(xx, yy, ['#ff5a8a', '#ffd76a', '#5ad8ff', '#7dff9a'][k % 4]); }
    }
    if (icons.has('truck')) {
      for (let k = 0; k < 3; k++) { const xx = ox + 30 + k * 110 + Math.sin(anim * 0.5 + k) * 3, yy = oy + 64; rect(xx, yy, 7, 4, '#d0d0d0'); rect(xx + 7, yy + 1, 3, 3, '#c0504d'); if (Math.floor(anim * 2 + k) % 2) text('!', xx + 2, yy - 7, '#ffd76a', { shadow: '#000' }); }
    }
    if (icons.has('gift')) {
      // string lights over every open district
      for (const d of open) {
        const l = L[d]; if (!l || l.island && d === 'moon') continue;
        for (let k = 2; k < l.w - 2; k += 3) px(ox + l.x + k, oy + l.y + l.h - 23 + (k % 6 === 2 ? 1 : 0), ['#ff5a4a', '#ffd76a', '#5aff8a', '#5ad8ff'][(k + Math.floor(anim * 3)) % 4]);
      }
    }
    return act;
  }
  function nightAmount(dayF) {
    // a gentle cycle: ~8 days per day/night loop, dark for about a third of it
    const ph = (dayF / 8) % 1;
    const c = Math.cos(ph * TAU);
    return clamp((c - 0.35) / 0.65, 0, 1) * 0.55;
  }

  // ── the banner + chart ──
  function banner(day, dayF, act) {
    const X = ox, Y = oy;
    rect(0, 0, bw, Y + 11, '#12141d'); rect(0, Y + 11, bw, 1, '#2a2e3d');
    const season = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'][Math.min(3, Math.floor((day - 1) / 30))];
    const wk = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][(day - 1) % 7];
    text(`YEAR ${replay ? replay.round || level : ''}  DAY ${day}/${replay ? replay.yearDays || days : 120}  ${wk}  ${season}`, X + 4, Y + 3, '#f4f1e6');
    let x = X + DW - 4;
    for (const e of act.slice(0, 2)) {
      const s = e.name.toUpperCase();
      const w = textWidth(s) + 8;
      x -= w;
      rect(x, Y + 1, w, 9, e.kind === 'bad' ? '#7a2a2a' : e.kind === 'mixed' ? '#7a5a1a' : '#1f5a36');
      text(s, x + 4, Y + 3, '#ffffff', { shadow: null });
      x -= 3;
    }
    // year progress
    const k = clamp(dayF / (replay ? replay.yearDays || days : 120), 0, 1);
    rect(X, Y + 11, Math.round(DW * k), 1, '#ffd76a');
  }

  function chart(dayF, anim) {
    const X = ox + 2, Y = oy + CHART_Y, W = DW - 4, H = DH - CHART_Y - 1;
    rect(0, Y - 1, bw, bh - Y + 1, '#0b0d14');
    rect(X, Y, W, H, '#0f1119'); rect(X, Y, W, 1, '#2d3243'); rect(X, Y + H - 1, W, 1, '#2d3243');
    text('NET WORTH', X + 4, Y + 3, '#c8ccd6');
    if (!frames.length) return;
    const n = replay.yearDays || 120;
    const upto = clamp(dayF, 0, frames.length);
    const k = Math.floor(upto);
    let maxV = startCash * 1.2, minV = 0;
    for (let i = 0; i < Math.min(frames.length, k + 1); i++) for (const s of frames[i].s) { maxV = Math.max(maxV, s[1]); minV = Math.min(minV, s[1]); }
    maxV = niceMax(maxV);
    const px0 = X + 26, py0 = Y + H - 5, pw = W - 32, ph = H - 16;
    const Xd = (d) => px0 + d / n * pw, Yv = (v) => py0 - (v - minV) / (maxV - minV) * ph;
    // calendar strip
    for (const e of replay.calendar || []) rect(Xd(e.from - 1), py0 + 2, Math.max(1, Xd(e.to) - Xd(e.from - 1)), 2, e.kind === 'bad' ? '#a03a3a' : e.kind === 'mixed' ? '#a07a2a' : '#2f8a4f');
    // grid
    for (let g = 0; g <= 2; g++) {
      const v = minV + (maxV - minV) * g / 2, yy = Math.round(Yv(v));
      for (let xx = px0; xx < px0 + pw; xx += 3) px(xx, yy, '#262a38');
      text(fmtMoney(v).replace('$', ''), px0 - 3, yy - 2, '#6f7688', { align: 'right', shadow: null });
    }
    for (let q = 1; q < 4; q++) { const xx = Math.round(Xd(q * 30)); for (let yy = Y + 10; yy < py0; yy += 3) px(xx, yy, '#1d202c'); }
    // lines
    const tips = [];
    for (let side = 0; side < 2; side++) {
      const col = sideCol[side];
      let lx = Xd(0), ly = Yv(startCash);
      for (let i = 0; i < k && i < frames.length; i++) {
        const nx = Xd(i + 1), ny = Yv(frames[i].s[side][1]);
        line(lx, ly, nx, ny, col); line(lx, ly - 1, nx, ny - 1, mix(col, '#000000', 0.35));
        lx = nx; ly = ny;
      }
      if (k < frames.length) {
        const v = val(side, 1, upto);
        const nx = Xd(upto), ny = Yv(v);
        line(lx, ly, nx, ny, col); line(lx, ly - 1, nx, ny - 1, mix(col, '#000000', 0.35));
        lx = nx; ly = ny;
      }
      tips.push({ x: lx, y: ly, v: val(side, 1, upto), col, side });
    }
    const lead = tips[0].v === tips[1].v ? -1 : tips[0].v > tips[1].v ? 0 : 1;
    for (const tp of tips) {
      rect(tp.x - 1, tp.y - 1, 3, 3, Math.floor(anim * 3) % 2 ? '#ffffff' : tp.col);
      if (tp.side === lead) { const cx = Math.round(tp.x) - 2, cy = Math.round(tp.y) - 7; rect(cx, cy + 1, 5, 2, '#ffd76a'); px(cx, cy, '#ffd76a'); px(cx + 2, cy, '#ffd76a'); px(cx + 4, cy, '#ffd76a'); }
    }
    // legend (top right): logo, name, value
    let lx = X + W - 4;
    for (let side = 1; side >= 0; side--) {
      const s = replay.sides[side] || {};
      const nm = String(s.name || `SIDE ${side + 1}`).toUpperCase().slice(0, 16);
      const vtxt = fmtMoney(tips[side].v);
      const w = textWidth(nm) + textWidth(vtxt) + 18;
      lx -= w;
      icon((s.logo || {}).icon || 'star', lx, Y + 2, (s.logo || {}).primary || sideCol[side], (s.logo || {}).secondary || '#fff');
      text(nm, lx + 8, Y + 3, sideCol[side]);
      text(vtxt, lx + 10 + textWidth(nm), Y + 3, '#f4f1e6');
      lx -= 8;
    }
  }
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v))));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  // ── idle ambience ──
  function idleWalkers(anim) {
    for (let k = 0; k < 26; k++) {
      const hsh = hash(k * 71 + 5);
      const row = [oy + 66, oy + 120, oy + 14][k % 3];
      const sp = 8 + hsh * 10, dir = k % 2 ? 1 : -1;
      const x = ox + (((hsh * 400 + anim * sp * dir) % 400) + 400) % 400;
      person(x, row + (k % 2), SHIRT[k % SHIRT.length], SKIN[k % SKIN.length], Math.floor(anim * 6 + k) % 2, null);
    }
    // cars
    for (let k = 0; k < 4; k++) {
      const x = ox + (((k * 97 + anim * (20 + k * 6)) % 400) + 400) % 400;
      rect(x, oy + 63 + (k % 2) * 3, 6, 3, ['#c0504d', '#4f81bd', '#ffd76a', '#9bbb59'][k]);
    }
  }

  function traffic(anim, night) {
    for (let k = 0; k < 6; k++) {
      const dir = k % 2 ? 1 : -1;
      const lane = k % 2 ? 64 : 67;
      const x = ox + (((k * 71 + anim * (18 + k * 5) * dir) % 396) + 396) % 396;
      rect(x, oy + lane, 6, 2, ['#c0504d', '#4f81bd', '#ffd76a', '#9bbb59', '#e8e8e8', '#8064a2'][k]);
      if (night) px(dir > 0 ? x + 6 : x - 1, oy + lane, '#fff7c0');
    }
    for (let k = 0; k < 3; k++) {
      const y = oy + ((((k * 53 + anim * (14 + k * 4)) % 150) + 150) % 150) + 14;
      rect(ox + 108 + (k % 2) * 2, y, 2, 5, ['#e8e8e8', '#c0504d', '#4f81bd'][k]);
    }
  }

  // ── public API ──
  function render(t, anim = 0) {
    if (!replay || !frames.length) return renderIdle(anim);
    prepare();
    const dur = frames.length * daySec;
    const tc = clamp(t, 0, dur);
    const dayF = tc / daySec;
    const cur = clamp(Math.floor(dayF) + 1, 1, frames.length);
    const season = Math.min(3, Math.floor((cur - 1) / 30));
    b.drawImage(staticLayer(season), 0, 0);
    const night = nightAmount(dayF);
    traffic(anim, night > 0.25);
    const fm = storeMap(cur - 1);
    // stores (back to front by y)
    const vis = stores.filter(st => st.start <= cur);
    vis.sort((p, q) => (storePos(p).y - storePos(q).y) || (p.id - q.id));
    for (const st of vis) {
      const e = fm && fm.get(st.id);
      drawStore(st, cur, dayF, anim, night > 0.25, e ? e[1] : 0);
    }
    // shoppers
    for (const st of vis) {
      if (st.closed && cur >= st.closed) continue;
      if (cur < st.ready) continue;
      const e = fm && fm.get(st.id);
      if (e) walkers(st, cur, dayF, e[1], anim, lastEntry(st.owners, cur)[1]);
    }
    const act = weather(cur, dayF, anim);
    if (night > 0) {
      b.fillStyle = `rgba(10,14,40,${night.toFixed(3)})`;
      b.fillRect(0, 0, bw, bh);
      // lights on top of the dark
      for (const st of vis) {
        if (st.closed && cur >= st.closed) continue;
        if (cur < st.ready) continue;
        const p = storePos(st);
        const col = sideCol[lastEntry(st.owners, cur)[1]];
        b.fillStyle = rgba('#ffe9a0', 0.55 * night / 0.55);
        b.fillRect(Math.round(p.x) - 3, Math.round(p.y) - 3, 7, 3);
        b.fillStyle = rgba(col, 0.25 * night / 0.55);
        b.fillRect(Math.round(p.x) - 5, Math.round(p.y) - 1, 11, 2);
      }
      for (let k = 0; k < 60; k++) { if (hash(k * 19 + Math.floor(dayF / 8)) > 0.55) continue; const d = ALL_DISTRICTS[k % 8]; if (!open.has(d)) continue; const l = L[d]; px(ox + l.x + 3 + hash(k * 7) * (l.w - 6), oy + l.y + 4 + hash(k * 11) * 16, rgba('#ffe28a', night / 0.55)); }
    }
    districtBars(dayF);
    for (let side = 0; side < 2; side++) moneyFloats(cur, dayF, fm, side);
    // bankruptcy stamp
    for (let side = 0; side < 2; side++) {
      const f = frames[cur - 1];
      if (f && f.s[side][10]) {
        const s = `${String((replay.sides[side] || {}).name || '').toUpperCase().slice(0, 18)} BANKRUPT`;
        const w = textWidth(s) * 2 + 10;
        const xx = ox + DW / 2 - w / 2, yy = oy + 40 + side * 30;
        rect(xx, yy, w, 16, '#5a1010'); rect(xx + 1, yy + 1, w - 2, 14, '#a01818');
        text(s, xx + 5, yy + 3, '#ffffff', { scale: 2, shadow: '#300' });
      }
    }
    banner(cur, dayF, act || []);
    chart(dayF, anim);
    // winner flourish after the end
    if (t > dur && replay.result) {
      const w = replay.result.winner;
      const s = w === null || w === undefined ? 'DRAW!' : `${String((replay.sides[w] || {}).name || '').toUpperCase().slice(0, 20)} WINS!`;
      const k = clamp((t - dur) / 0.6, 0, 1);
      const ww = textWidth(s) * 2 + 16;
      const xx = ox + DW / 2 - ww / 2, yy = oy + 70 - (1 - k) * 20;
      b.globalAlpha = k;
      rect(xx, yy, ww, 20, '#12141d'); rect(xx + 1, yy + 1, ww - 2, 18, w === null || w === undefined ? '#444a5a' : sideCol[w]);
      text(s, xx + 8, yy + 5, '#ffffff', { scale: 2, shadow: '#000' });
      for (let q = 0; q < 30; q++) { const a = hash(q * 7) * TAU, r = 10 + (anim * 30 + hash(q) * 60) % 70; px(ox + DW / 2 + Math.cos(a) * r * 1.6, yy + 10 + Math.sin(a) * r * 0.7, ['#ffd76a', '#ffffff', sideCol[w || 0]][q % 3]); }
      b.globalAlpha = 1;
    }
    present();
  }

  function renderIdle(anim = 0) {
    prepare();
    const season = Math.floor((anim / 20) % 4);
    if (!replay) open = new Set(ALL_DISTRICTS.filter(d => d !== 'moon'));
    b.drawImage(staticLayer(season), 0, 0);
    const night = nightAmount(anim / 1.2);
    traffic(anim, night > 0.25);
    idleWalkers(anim);
    if (night > 0) { b.fillStyle = `rgba(10,14,40,${night.toFixed(3)})`; b.fillRect(ox, oy + 12, DW, CHART_Y - 12); }
    rect(ox, oy, DW, 11, '#12141d');
    text('BUSINESS TYCOON  -  THE CITY AWAITS ITS FIRST COMPANIES', ox + 4, oy + 3, '#f4f1e6');
    const X = ox + 2, Y = oy + CHART_Y, W = DW - 4, H = DH - CHART_Y - 1;
    rect(X, Y, W, H, '#0f1119');
    text('NET WORTH', X + 4, Y + 3, '#c8ccd6');
    const blink = Math.floor(anim * 2) % 2;
    text(blink ? 'WAITING FOR THE YEAR TO BEGIN...' : 'WAITING FOR THE YEAR TO BEGIN', X + W / 2, Y + H / 2, '#6f7688', { align: 'center', shadow: null });
    present();
  }

  function hudAt(t) {
    if (!replay || !frames.length) return [];
    const dayF = clamp(t / daySec, 0, frames.length);
    const cur = clamp(Math.floor(dayF) + 1, 1, frames.length);
    const nws = [0, 1].map(s => val(s, 1, dayF));
    const maxNw = Math.max(startCash * 1.2, ...nws.map(Math.abs)) * 1.15;
    return [0, 1].map(side => {
      const s = replay.sides[side] || {};
      const f = frames[cur - 1];
      const row = f.s[side];
      const nOpen = stores.filter(st => st.ready <= cur && !(st.closed && cur >= st.closed) && lastEntry(st.owners, cur)[1] === side).length;
      const prices = row[11] || {};
      const chips = [`${nOpen} store${nOpen === 1 ? '' : 's'}`, `rep ${Math.round(row[3])}`];
      for (const [c, p] of Object.entries(prices).slice(0, 3)) chips.push(`${c} $${p >= 100 ? Math.round(p) : Number(p).toFixed(2)}`);
      if (row[2] > 0) chips.push(`debt ${fmtMoney(row[2])}`);
      if (row[10]) chips.unshift('BANKRUPT');
      return {
        title: s.name || s.label || `Side ${side + 1}`,
        sub: `${s.label || ''}${s.slogan ? ` · "${s.slogan}"` : ''}`,
        bars: [
          { label: `Net worth ${fmtMoney(nws[side])}`, value: Math.max(0, nws[side]), max: maxNw, color: sideCol[side] },
          { label: `Cash ${fmtMoney(val(side, 0, dayF))}`, value: Math.max(0, val(side, 0, dayF)), max: maxNw, color: mix(sideCol[side], '#ffffff', 0.35) },
          { label: `Market share ${Math.round(row[7] / 10)}%`, value: row[7] / 10, max: 100, color: mix(sideCol[side], '#000000', 0.2) },
        ],
        chips,
      };
    });
  }

  function eventsBetween(t0, t1) {
    if (!replay) return [];
    const out = [];
    for (const e of evs) {
      if (e.t <= t0) continue;
      if (e.t > t1) break;
      out.push({ k: e.k, side: e.side, big: !!e.big, text: e.text });
    }
    // sounds only for normal playback (not for a big seek)
    if (t1 - t0 > 0 && t1 - t0 < 1.5 && typeof Sound.modeEvent === 'function') {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      let n = 0;
      for (const e of out) {
        if (e.k === 'sale') { if (now - lastSaleSound < 900) continue; lastSaleSound = now; }
        if (n++ > 3) break;
        try { Sound.modeEvent('business', { k: e.k, side: e.side, big: e.big }); } catch { /* sound is optional */ }
      }
      // a soft cash-register tick on busy days
      if (!out.length && Math.floor(t1 / daySec) !== Math.floor(t0 / daySec) && now - lastSaleSound > 2600) {
        const d = Math.floor(t1 / daySec);
        const f = frames[Math.min(frames.length - 1, d)];
        if (f && d < frames.length && (f.s[0][4] + f.s[1][4]) > 0) {
          lastSaleSound = now;
          const side = f.s[0][4] >= f.s[1][4] ? 0 : 1;
          try { Sound.modeEvent('business', { k: 'sale', side, big: false }); } catch { /* optional */ }
        }
      }
    }
    return out;
  }

  return {
    setReplay,
    get duration() { return replay ? (replay.duration || frames.length * daySec) : 0; },
    render,
    renderIdle,
    resize() { resize(); staticCache.clear(); },
    hudAt,
    eventsBetween,
  };
}
