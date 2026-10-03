'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  AI FIGHT — look composer: "paper-doll" pixel characters.
//
//  A fighter's `look` (base, build, hair, face, headgear, outfit, cape, colours…)
//  plus its weapon id → a complete 32×32 sprite (palette + animation frames):
//    idle 4 · walk 6 · attack 4 (shaped by the weapon kind) · cast 3 · dash 2 ·
//    hurt 2 · ko 4 · victory 4 · block 2
//  Characters are posed with a tiny 2D skeleton (forward kinematics + 2-bone IK),
//  every part is rasterised as pixel shapes with 3-tone hue-shifted shading, then
//  a 1 px dark outline is added. Sprites face RIGHT; feet stand on row 30.
//
//  Pure, deterministic, dependency-free CommonJS (no browser APIs).
//    validateLook(raw[, {colors}]) -> { look, errors, warnings }
//    composeSprite(look, weaponId)  -> { palette, frames }
//    lookCatalog()                   -> every option with a short description
//    LOOK_SCHEMA                     -> field definitions
// ─────────────────────────────────────────────────────────────────────────────

const N = 32;               // frame size
const GROUND = 30;          // bottom row of the feet
const CX = 15;              // horizontal centre of the body (hip joint x)
const DEG = Math.PI / 180;

// ═════════════════════════════════════════════════════════════════════════════
//  Colour helpers
// ═════════════════════════════════════════════════════════════════════════════

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hexToRgb(hex) {
  let s = String(hex).replace('#', '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
// OKLab / OKLCH: perceptual lightness steps make much nicer pixel-art ramps than HSL.
function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function linToSrgb(c) { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return v * 255; }
function toOklch(hex) {
  const [R, G, B] = hexToRgb(hex).map(srgbToLin);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, b), H: Math.atan2(b, a) };
}
function oklchRgb(L, C, H) {
  const a = C * Math.cos(H), b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
function fromOklch(L, C, H) {
  // pull chroma in until the colour fits in sRGB
  for (let k = 0; k < 24; k++) {
    const rgb = oklchRgb(L, C, H);
    if (rgb.every(v => v >= -0.5 && v <= 255.5)) return rgbToHex(...rgb);
    C *= 0.88;
  }
  return rgbToHex(...oklchRgb(L, 0, H));
}
function hueToward(h, target, amt) {
  let d = ((target - h + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  if (Math.abs(d) < amt) return target;
  return h + Math.sign(d) * amt;
}
/** Hue-shifted tone of a colour: dl = OK-lightness change. Shadows lean violet, lights lean warm. */
function tone(hex, dl, { chroma = 1 } = {}) {
  const o = toOklch(hex);
  let H = o.H, C = o.C;
  if (C > 0.015) {
    if (dl < 0) { H = hueToward(H, 290 * DEG, Math.min(0.2, -dl * 0.9)); C *= 1.06; }
    else if (dl > 0) { H = hueToward(H, 95 * DEG, Math.min(0.16, dl * 0.9)); C *= 0.9; }
  } else if (dl < 0) { H = 265 * DEG; C = Math.max(C, 0.012); }
  return fromOklch(clamp(o.L + dl, 0.04, 0.985), C * chroma, H);
}
/** [highlight, base, shadow] ramp for a material colour. */
function ramp(hex) {
  const { L } = toOklch(hex);
  const up = L > 0.9 ? Math.max(0.03, 0.985 - L) : clamp(0.1 + (0.5 - L) * 0.06, 0.07, 0.13);
  const down = L < 0.3 ? clamp(L * 0.35, 0.05, 0.1) : clamp(0.1 + (L - 0.5) * 0.12, 0.1, 0.16);
  return [tone(hex, up), hex.toLowerCase(), tone(hex, -down)];
}
function mix(a, b, k) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
}
function lum(hex) { return rgbToHsl(...hexToRgb(hex))[2]; }
function dist2(a, b) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const rm = (A[0] + B[0]) / 2;
  const dr = A[0] - B[0], dg = A[1] - B[1], db = A[2] - B[2];
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

// Friendly colour names (any colour field accepts "#rgb", "#rrggbb" or one of these).
const NAMED = {
  red: '#d8403a', crimson: '#b41c34', maroon: '#6e1c28', scarlet: '#e83a2a', orange: '#ee7a2a', amber: '#f2a030',
  gold: '#e8b830', yellow: '#f2d84a', lime: '#9cd84a', green: '#4aa452', emerald: '#2e9a60', forest: '#2e6a38',
  olive: '#7a8a3a', teal: '#2a9a8e', cyan: '#46d6e8', sky: '#7ec4f0', blue: '#3a6ad8', royal: '#2f4fb8', navy: '#253a78',
  indigo: '#4a3a9a', purple: '#7a4ab8', violet: '#a070e0', magenta: '#d040b8', pink: '#f08ab8', rose: '#e05a7a',
  brown: '#7a4e2e', chocolate: '#553420', tan: '#c8a070', beige: '#e0cca0', cream: '#f2e6c8', white: '#f2f2ee',
  silver: '#c4ccd8', grey: '#8a8e98', gray: '#8a8e98', slate: '#5a6478', charcoal: '#34363e', black: '#22222c',
  bronze: '#b07a3a', copper: '#c46a3a', steel: '#9aa6b8', iron: '#6e7684', ivory: '#f0e8d0', bone: '#e6dcc0',
  obsidian: '#2a2436', jade: '#48b088', ruby: '#d0204a', sapphire: '#2a5ad0', amethyst: '#9a58d8', mint: '#8ee8c0',
  lavender: '#b8a0e8', peach: '#f8c0a0', sand: '#d8c090', rust: '#a4502a', ember: '#ff7a2a', ice: '#bff0ff', frost: '#8fd8ff',
  shadow: '#3a2e52', blood: '#9a1424', toxic: '#8cf04a', holy: '#ffe89a', void: '#6a3aa8', neon: '#3ff2ff',
};
const SKIN_NAMES = {
  pale: '#f8dcc8', porcelain: '#fbe4d6', fair: '#f2c9a0', light: '#eec29c', peach: '#f4c0a0', tan: '#d6a070', olive: '#c09468',
  golden: '#d8a468', brown: '#a8704a', umber: '#8a5634', dark: '#6e4630', ebony: '#4c3020',
  green: '#6ea860', orc: '#6e9a52', goblin: '#8cb84a', grey: '#9a9ea8', gray: '#9a9ea8', ash: '#b4b0a8', blue: '#6a98d8',
  red: '#c8503e', crimson: '#a8303a', purple: '#9a70c8', violet: '#9a70c8', pink: '#e8a0b0', teal: '#58a8a0', zombie: '#8aa088',
  bone: '#e8dfc4', steel: '#a8b2c0', iron: '#7c8594', gold: '#e0b048', bronze: '#b8844a', copper: '#c87a4a', stone: '#9a948a',
  granite: '#8a8e96', sandstone: '#c8a878', obsidian: '#3c3444', straw: '#e0c078', burlap: '#c8a46e', fur: '#b8865a',
  cream: '#f0dcb0', white: '#eeeae4', black: '#3a3440', scales: '#5aa06a', jade: '#58b08c',
};
const HAIR_NAMES = {
  black: '#2a2430', brown: '#6a4228', chestnut: '#8a4e2a', auburn: '#9a3e24', red: '#c8402a', ginger: '#e0702a',
  blonde: '#e8c860', gold: '#f0c040', platinum: '#f0ead0', white: '#eeeef0', silver: '#c4c8d4', grey: '#8e9098', gray: '#8e9098',
  blue: '#3a6ae0', navy: '#283a80', teal: '#2aa89a', green: '#48a040', lime: '#9ce040', pink: '#f07ab8', magenta: '#d040b8',
  purple: '#8048c8', violet: '#a070e0', orange: '#f08a2a', cyan: '#48d8f0', fire: '#ff6a2a', ice: '#c8f4ff',
};

function parseColor(v, names) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (HEX_RE.test(s)) {
    const m = HEX_RE.exec(s)[1];
    return '#' + (m.length === 3 ? m.split('').map(c => c + c).join('') : m);
  }
  if (names && names[s]) return names[s];
  if (NAMED[s]) return NAMED[s];
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  Colour roles (what a pixel *is*), their template characters and palette keys
// ═════════════════════════════════════════════════════════════════════════════

const ROLE_LIST = [
  // [role, template/palette char]
  ['out', 'o'],
  ['skinH', 'S'], ['skin', 's'], ['skinL', 'z'],
  ['hairH', 'H'], ['hair', 'h'], ['hairL', 'd'],
  ['priH', 'P'], ['pri', 'p'], ['priL', 'q'],
  ['secH', 'C'], ['sec', 'c'], ['secL', 'x'],
  ['accH', 'A'], ['acc', 'a'], ['accL', 'y'],
  ['metH', 'M'], ['met', 'm'], ['metL', 'n'],
  ['leaH', 'L'], ['lea', 'l'], ['leaL', 'k'],
  ['woodH', 'R'], ['wood', 'r'], ['woodL', 'f'],
  ['bladeH', 'B'], ['blade', 'b'], ['bladeL', 'v'],
  ['eye', 'e'], ['white', 'w'], ['dark', 'D'],
  ['glowH', 'G'], ['glow', 'g'], ['glowL', 'j'],
  ['trailH', 'T'], ['trail', 't'],
  ['skinD', 'Z'], ['priD', 'Q'], ['metD', 'N'],
  ['pantH', 'U'], ['pant', 'u'], ['pantL', 'i'],
  // v2 roles (appended so every older look keeps exactly the same palette keys)
  ['acc2H', 'E'], ['acc2', 'F'], ['acc2L', 'I'],      // colors.accent2: wings, tails, extra trims
  ['markH', 'J'], ['mark', 'K'], ['markL', 'O'],      // colors.marking: tattoos, stripes, runes…
  ['wglowH', 'V'], ['wglow', 'W'], ['wglowL', 'X'],   // weapon glow (element or colors.glow)
  ['altH', 'Y'], ['alt', '0'], ['altL', '1'],         // fixed extra material of a base / item (beak, pumpkin, bone…)
  ['eye2', '2'], ['blush', '3'],
];
const ROLE = {};
const ROLE_CHAR = [''];
const CHAR_ROLE = {};
ROLE_LIST.forEach(([name, ch], i) => { ROLE[name] = i + 1; ROLE_CHAR[i + 1] = ch; CHAR_ROLE[ch] = i + 1; });
// Material ramps: [highlight, base, shadow]
const RAMP = {
  skin: [ROLE.skinH, ROLE.skin, ROLE.skinL], hair: [ROLE.hairH, ROLE.hair, ROLE.hairL],
  pri: [ROLE.priH, ROLE.pri, ROLE.priL], sec: [ROLE.secH, ROLE.sec, ROLE.secL], acc: [ROLE.accH, ROLE.acc, ROLE.accL],
  met: [ROLE.metH, ROLE.met, ROLE.metL], lea: [ROLE.leaH, ROLE.lea, ROLE.leaL], wood: [ROLE.woodH, ROLE.wood, ROLE.woodL],
  blade: [ROLE.bladeH, ROLE.blade, ROLE.bladeL], glow: [ROLE.glowH, ROLE.glow, ROLE.glowL], trail: [ROLE.trailH, ROLE.trail, ROLE.trail],
  pant: [ROLE.pantH, ROLE.pant, ROLE.pantL],
  acc2: [ROLE.acc2H, ROLE.acc2, ROLE.acc2L], mark: [ROLE.markH, ROLE.mark, ROLE.markL],
  wglow: [ROLE.wglowH, ROLE.wglow, ROLE.wglowL], alt: [ROLE.altH, ROLE.alt, ROLE.altL],
  eye2: [ROLE.eye2, ROLE.eye2, ROLE.eye2], blush: [ROLE.blush, ROLE.blush, ROLE.blush],
  eye: [ROLE.eye, ROLE.eye, ROLE.eye], white: [ROLE.white, ROLE.white, ROLE.white], dark: [ROLE.dark, ROLE.dark, ROLE.dark],
  out: [ROLE.out, ROLE.out, ROLE.out],
};
// A darker version of each ramp for limbs on the far side of the body.
const DIM = {};
for (const [k, r] of Object.entries(RAMP)) DIM[k] = [r[1], r[2], r[2]];
DIM.skin = [ROLE.skin, ROLE.skinL, ROLE.skinD];
DIM.pri = [ROLE.pri, ROLE.priL, ROLE.priD];
DIM.met = [ROLE.met, ROLE.metL, ROLE.metL];
DIM.pant = [ROLE.pant, ROLE.pantL, ROLE.pantL];

// ═════════════════════════════════════════════════════════════════════════════
//  Pixel canvas + masks
// ═════════════════════════════════════════════════════════════════════════════

class Cv {
  constructor(w = N, h = N) { this.w = w; this.h = h; this.c = new Uint8Array(w * h); this.p = new Uint8Array(w * h); }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.in(x, y) ? this.c[y * this.w + x] : 0; }
  part(x, y) { return this.in(x, y) ? this.p[y * this.w + x] : 0; }
  put(x, y, role, part = 0) {
    x = Math.round(x); y = Math.round(y);
    if (!role || !this.in(x, y)) return;
    this.c[y * this.w + x] = role;
    this.p[y * this.w + x] = part;
  }
  clear(x, y) { if (this.in(x, y)) { this.c[y * this.w + x] = 0; this.p[y * this.w + x] = 0; } }
}

class Mask {
  constructor(w = N, h = N) { this.w = w; this.h = h; this.a = new Uint8Array(w * h); this.x0 = w; this.y0 = h; this.x1 = -1; this.y1 = -1; this.n = 0; }
  add(x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.a[i]) return;
    this.a[i] = 1; this.n++;
    if (x < this.x0) this.x0 = x;
    if (x > this.x1) this.x1 = x;
    if (y < this.y0) this.y0 = y;
    if (y > this.y1) this.y1 = y;
  }
  del(x, y) { if (this.has(x, y)) { this.a[y * this.w + x] = 0; this.n--; } }
  has(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.a[y * this.w + x] === 1; }
  each(fn) {
    for (let y = this.y0; y <= this.y1; y++) for (let x = this.x0; x <= this.x1; x++) if (this.a[y * this.w + x]) fn(x, y);
  }
  union(m) { m.each((x, y) => this.add(x, y)); return this; }
  minus(m) { m.each((x, y) => this.del(x, y)); return this; }
}

function rectMask(m, x0, y0, x1, y1) {
  for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) m.add(x, y);
  return m;
}
function ellipseMask(m, cx, cy, rx, ry) {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1.0) m.add(x, y);
    }
  }
  return m;
}
/** Scanline fill of a polygon (pixel centres inside). */
function polyMask(m, pts) {
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const py = y + 0.5;
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py)) xs.push(xi + ((py - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    // half-open span rule: exact widths, no double-counted edges
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k] - 0.5); x <= Math.ceil(xs[k + 1] - 0.5) - 1; x++) m.add(x, y);
    }
  }
  return m;
}
/** Bresenham line stamped with a span of `w` pixels perpendicular to its main axis. */
function lineMask(m, x0, y0, x1, y1, w = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  const steep = -dy > dx;
  const lo = -Math.floor((w - 1) / 2), hi = Math.ceil((w - 1) / 2);
  let err = dx + dy, x = x0, y = y0;
  for (let guard = 0; guard < 400; guard++) {
    for (let k = lo; k <= hi; k++) { if (steep) m.add(x + k, y); else m.add(x, y + k); }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return m;
}
function linePoints(x0, y0, x1, y1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const pts = [];
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (let guard = 0; guard < 400; guard++) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return pts;
}

// ── painting ────────────────────────────────────────────────────────────────
// Light comes from the upper FRONT (the side the fighter faces): top and front
// (right) edges get the highlight, bottom and back (left) edges the shadow.
function shadeAt(m, x, y, opt) {
  const up = m.has(x, y - 1) || (opt && opt.openTop && y === m.y0), dn = m.has(x, y + 1), bk = m.has(x - 1, y), fr = m.has(x + 1, y);
  if (!dn || !bk) return 2;
  if (opt && opt.soft && !m.has(x - 2, y)) return 2;
  if (!up || !fr) return (opt && opt.noHi) ? 1 : 0;
  return 1;
}
/** Fill a mask with a 3-tone ramp ([hi, base, lo] roles). */
function paint(cv, m, rp, part, opt = {}) {
  if (opt.over) outlineOver(cv, m, part, opt.over === true ? ROLE.out : opt.over);
  m.each((x, y) => {
    const t = opt.flat ? 1 : shadeAt(m, x, y, opt);
    cv.put(x, y, rp[t], part);
  });
}
/** Pixels just outside `m` that belong to other parts become a separation line. */
function outlineOver(cv, m, part, role = ROLE.out) {
  const hits = [];
  m.each((x, y) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (m.has(nx, ny)) continue;
      if (cv.get(nx, ny) && cv.part(nx, ny) !== part && cv.get(nx, ny) !== ROLE.out) hits.push([nx, ny]);
    }
  });
  for (const [x, y] of hits) cv.put(x, y, role, cv.part(x, y));
}
/** 1 px outer outline around everything drawn so far. */
function outlineAll(cv, role = ROLE.out) {
  const add = [];
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      if (cv.c[y * cv.w + x]) continue;
      if (cv.get(x + 1, y) || cv.get(x - 1, y) || cv.get(x, y + 1) || cv.get(x, y - 1)) add.push(y * cv.w + x);
    }
  }
  for (const i of add) { cv.c[i] = role; cv.p[i] = 0; }
}
/** Draw a character template (array of strings, role chars, '.' = skip) at (ox, oy). */
function stamp(cv, rows, ox, oy, part = 0, { flip = false, map = null } = {}) {
  const w = rows.reduce((a, r) => Math.max(a, r.length), 0);
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      let ch = row[i];
      if (ch === '.' || ch === ' ') continue;
      if (map && map[ch]) ch = map[ch];
      const role = CHAR_ROLE[ch];
      if (!role) continue;
      cv.put(ox + (flip ? w - 1 - i : i), oy + j, role, part);
    }
  }
}
function templateMask(rows, ox, oy, w = N, h = N) {
  const m = new Mask(w, h);
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.' && row[i] !== ' ') m.add(ox + i, oy + j); });
  return m;
}

// ═════════════════════════════════════════════════════════════════════════════
//  Heads. Head-local coordinates: (0,0) = top-left of the head box. `neck` is the
//  column that sits on top of the spine. Eyes are 1×2 px (near eye, far eye).
// ═════════════════════════════════════════════════════════════════════════════

const HEADS = {
  round: {
    mask: [
      '..#####..',
      '.#######.',
      '#########',
      '#########',
      '#########',
      '#########',
      '.#######.',
      '..#####..',
    ], neck: 4, eyes: [[5, 3], [7, 3]], ear: [2, 4], mouth: [6, 6],
  },
  skull: {
    mask: [
      '..#####..',
      '.#######.',
      '#########',
      '#########',
      '#########',
      '.#######.',
      '..#####..',
      '...###...',
    ], neck: 4, eyes: [[5, 3], [7, 3]], ear: null, mouth: [6, 6],
  },
  box: {
    mask: [
      '.#######.',
      '#########',
      '#########',
      '#########',
      '#########',
      '#########',
      '#########',
      '.#######.',
    ], neck: 4, eyes: [[5, 3], [7, 3]], ear: [1, 4], mouth: [6, 6],
  },
  rock: {
    mask: [
      '..######.',
      '.########',
      '#########',
      '#########',
      '#########',
      '.#######.',
    ], neck: 4, eyes: [[5, 2], [7, 2]], ear: null, mouth: null,
  },
  snout: {
    mask: [
      '.#####.....',
      '#######....',
      '#########..',
      '##########.',
      '###########',
      '.##########',
      '..######...',
      '...###.....',
    ], neck: 4, eyes: [[5, 2], [7, 2]], ear: [2, 4], mouth: [8, 5],
  },
  sack: {
    mask: [
      '..#####..',
      '.#######.',
      '#########',
      '#########',
      '#########',
      '#########',
      '.#######.',
      '...###...',
    ], neck: 4, eyes: [[5, 3], [7, 3]], ear: null, mouth: [6, 5],
  },
};
// v2 heads (appended: older looks keep exactly the same tables)
Object.assign(HEADS, {
  frog: {
    mask: [
      '...##.##..',
      '..#######.',
      '.#########',
      '##########',
      '##########',
      '.#########',
      '..#######.',
    ], neck: 4, eyes: [[4, 0], [7, 0]], ear: null, mouth: [8, 4],
  },
  dome: {
    mask: [
      '..######..',
      '.########.',
      '##########',
      '##########',
      '##########',
      '.########.',
      '..######..',
      '...####...',
      '....##....',
    ], neck: 4, eyes: [[4, 4], [7, 4]], ear: null, mouth: [6, 7],
  },
  gem: {
    mask: [
      '...###...',
      '..#####..',
      '.#######.',
      '#########',
      '#########',
      '.#######.',
      '..#####..',
      '...###...',
    ], neck: 4, eyes: [[5, 3], [7, 3]], ear: null, mouth: [6, 6],
  },
});

// ═════════════════════════════════════════════════════════════════════════════
//  Hair (head-local templates; h/H/d = hair base/highlight/shadow).
//  `flow`: rows from this index on sway with motion (long hair, ponytails).
// ═════════════════════════════════════════════════════════════════════════════

const HAIR = {
  none: { name: 'Bald', desc: 'No hair at all.' },
  short: {
    name: 'Short', desc: 'Neat short cut with a small fringe.', ox: 0, oy: -1, rows: [
      '..hhhHH..',
      '.hhhhhHH.',
      'hhhhhhhHH',
      'hhhdhdhd.',
      'hhd......',
      'hd.......',
      'hd.......',
    ],
  },
  crop: {
    name: 'Buzz cut', desc: 'Very short cropped hair.', ox: 0, oy: 0, rows: [
      '..hhhHH..',
      '.hhhhhHH.',
      'hhhhhdd..',
      'hhd......',
      'hd.......',
    ],
  },
  spiky: {
    name: 'Spiky', desc: 'Big anime spikes.', ox: -1, oy: -4, rows: [
      '..h...H....',
      '..hh.HH..H.',
      '.hhhhHHHHH.',
      'hhhhhhhHHHH',
      '.hhhhhhhHH.',
      'hhhhhhhhhhH',
      'hhhhhdhhdhd',
      '.hhhd.d....',
      'hhhd.......',
      '.hd........',
      'hd.........',
    ],
  },
  messy: {
    name: 'Messy', desc: 'Tousled bedhead.', ox: -1, oy: -2, rows: [
      '...h.hH....',
      '..hhhhHHh..',
      '.hhhhhhHHH.',
      'hhhhhhhhhHH',
      'hhhhdhhdhd.',
      '.hhd.......',
      'hhd........',
      '.hd........',
      '.d.........',
    ],
  },
  long: {
    name: 'Long', desc: 'Long straight hair down the back.', ox: -1, oy: -1, rows: [
      '...hhhHH...',
      '..hhhhhHH..',
      '.hhhhhhhHH.',
      '.hhhhdhdhd.',
      'hhhd.......',
      'hhhd.......',
      'hhhd.......',
      'hhhd.......',
      'hhd........',
      'hhd........',
      '.hd........',
    ], flow: 5,
  },
  ponytail: {
    name: 'Ponytail', desc: 'Tied back in a swinging ponytail.', ox: -3, oy: -1, rows: [
      '.....hhhHH...',
      '....hhhhhHH..',
      '...hhhhhhhHH.',
      '..hhhhhdhdhd.',
      '.hhhhd.......',
      'hhdhd........',
      'hhd.d........',
      'hd...........',
      'hd...........',
      'd............',
    ], flow: 4,
  },
  topknot: {
    name: 'Topknot', desc: 'Samurai-style top knot.', ox: 0, oy: -3, rows: [
      '...hHh...',
      '...hhd...',
      '..hhhHH..',
      '.hhhhhHH.',
      'hhhhhhhHH',
      'hhhd.....',
      'hhd......',
      'hd.......',
    ],
  },
  bun: {
    name: 'Bun', desc: 'Hair wound into a bun at the back.', ox: -2, oy: -1, rows: [
      '....hhhHH..',
      '...hhhhhHH.',
      '.hhhhhhhhHH',
      'hhHhhhdhdhd',
      'hhhhhd.....',
      '.hdhd......',
      '...hd......',
    ],
  },
  braids: {
    name: 'Braids', desc: 'Two long braids.', ox: -1, oy: -1, rows: [
      '...hhhHH...',
      '..hhhhhHH..',
      '.hhhhhhhHH.',
      '.hhhhdhdhd.',
      '.hhd.......',
      'hdh........',
      'hhd........',
      'dhd........',
      'hhd........',
      'dh.........',
      'a..........',
    ], flow: 5,
  },
  mohawk: {
    name: 'Mohawk', desc: 'A proud crest of hair.', ox: 0, oy: -3, rows: [
      '...hHH...',
      '..hhhhHH.',
      '.dhhhhhhH',
      '.dd..z...',
    ],
  },
  afro: {
    name: 'Afro', desc: 'Big round afro.', ox: -2, oy: -4, rows: [
      '....hhhHH....',
      '..hhhhhhhHH..',
      '.hhhhhhhhhHH.',
      'hhhhhhhhhhhHH',
      'hhhhhhhhhhhhH',
      'hhhhhhhhhhhh.',
      'hhhhhhdhdh...',
      'hhhhd........',
      '.hhhd........',
      '..hd.........',
    ],
  },
  pigtails: {
    name: 'Pigtails', desc: 'Two bouncy pigtails.', ox: -3, oy: -1, rows: [
      '.....hhhHH...',
      '....hhhhhHH..',
      '...hhhhhhhHH.',
      '.h.hhhhdhdhd.',
      'hhahhhd......',
      'hhd.hd.......',
      'hhd..........',
      '.hd..........',
      '.d...........',
    ], flow: 4,
  },
  sidepart: {
    name: 'Side part', desc: 'Slick side-parted hair.', ox: 0, oy: -1, rows: [
      '..hHHHh..',
      '.hhhHHHhh',
      'hhhhhhhhh',
      'hhhhhhdd.',
      'hhd......',
      'hd.......',
      'hd.......',
    ],
  },
  wild: {
    name: 'Wild mane', desc: 'Huge untamed mane.', ox: -2, oy: -2, rows: [
      '...h.hhH.H...',
      '..hhhhhhHHH..',
      '.hhhhhhhhhHH.',
      'hhhhhhhhhhHHH',
      'hhhhhhdhdhdh.',
      'hhhhhd.......',
      'hhhhd........',
      'hhhd.........',
      '.hhd.........',
      '.hd..........',
      '..d..........',
    ], flow: 5,
  },
};
Object.assign(HAIR, {
  bob: {
    name: 'Bob', desc: 'Chin-length bob with a straight fringe.', ox: -1, oy: -1, rows: [
      '...hhhHH...',
      '..hhhhhhHH.',
      '.hhhhhhhhHH',
      '.hhhhhhhhhH',
      'hhhhd......',
      'hhhhd......',
      'hhhhd......',
      'hhhhhd.....',
      '.dddd......',
    ],
  },
  curly: {
    name: 'Curly', desc: 'A big mop of tight curls.', ox: -2, oy: -3, rows: [
      '...hh.hH.....',
      '..hhhhhhHH...',
      '.hhdhhhhdhH..',
      'hhhhhhhhhhHH.',
      'hdhhhdhhhhhH.',
      'hhhhhhhdhd...',
      'hhhdhd.......',
      '.hhhhd.......',
      'hhdhh........',
      '.hhd.........',
    ],
  },
  undercut: {
    name: 'Undercut', desc: 'Shaved sides with a long swept top.', ox: 0, oy: -3, rows: [
      '...hhhH....',
      '..hhhhhHH..',
      '.hhhhhhhHHH',
      '.dhhhhhhhhH',
      'zzddhhdd...',
      'zz.........',
      'z..........',
    ],
  },
  dreads: {
    name: 'Dreadlocks', desc: 'Thick locks hanging down the back.', ox: -1, oy: -1, rows: [
      '...hhhHH...',
      '..hhhhhhHH.',
      '.hhhhhhhhHH',
      '.hhdhhdhhd.',
      'hdhdh......',
      'hdhdh......',
      'hdhd.......',
      'hdhdh......',
      'hd.hd......',
      'd..hd......',
      '...d.......',
    ], flow: 4,
  },
  twintails: {
    name: 'Twintails', desc: 'Two long tails tied with ribbons.', ox: -3, oy: -1, rows: [
      '.....hhhHH...',
      '....hhhhhHH..',
      '...hhhhhhhHH.',
      '.a.hhhhdhdhd.',
      'hhhhhhd......',
      'hhd.hd.......',
      'hhd..........',
      'hhd..........',
      'hhd..........',
      '.hd..........',
      '.hd..........',
      '..d..........',
    ], flow: 4,
  },
  pompadour: {
    name: 'Pompadour', desc: 'A towering greased quiff.', ox: 0, oy: -4, rows: [
      '.....hhHH..',
      '...hhhhhHHH',
      '..hhhhhhhHH',
      '.hhhhhhhhhH',
      'hhhhhhhdd..',
      'hhhd.......',
      'hhd........',
      'hd.........',
      'hd.........',
    ],
  },
  emo: {
    name: 'Side fringe', desc: 'Long swept fringe hiding one eye.', ox: -1, oy: -1, rows: [
      '...hhhHH...',
      '..hhhhhhHH.',
      '.hhhhhhhhHH',
      '.hhhhhhhhhH',
      'hhhhdhhh...',
      'hhhd.hhd...',
      'hhhd..d....',
      'hhd........',
      'hd.........',
    ],
  },
  mullet: {
    name: 'Mullet', desc: 'Business in front, party in the back.', ox: -1, oy: -2, rows: [
      '...h.hH....',
      '..hhhhhHH..',
      '.hhhhhhhHH.',
      '.hhhhhhhhH.',
      '.hhhdhdhd..',
      'hhhd.......',
      'hhhd.......',
      'hhhd.......',
      'hhhhd......',
      'hhhhd......',
      '.hdhd......',
      '..d........',
    ], flow: 6,
  },
  flame: {
    name: 'Flames', desc: 'Hair of living fire that flickers (try hairColor "fire").', ox: -2, oy: -5, frames: [[
      '..H.....H...',
      '..hH...hH...',
      '.hhhH.hhhH..',
      '.hhhhhhhhhH.',
      'hhhhhhhhhhH.',
      'hhhhhhhhhhhH',
      'hhhhhdhdhdh.',
      'hhhd........',
      '.hd.........',
    ], [
      '....H....H..',
      '.H..hH..hH..',
      '.hH.hhHhhh..',
      '.hhhhhhhhhH.',
      'hhhhhhhhhhH.',
      'hhhhhhhhhhhH',
      'hhhhhdhdhdh.',
      'hhhd........',
      '.hd.........',
    ]],
  },
  longspiky: {
    name: 'Long spikes', desc: 'Wild spikes flowing far down the back.', ox: -2, oy: -4, rows: [
      '...h....H....',
      '...hh..HH..H.',
      '..hhhhHHHHHH.',
      '.hhhhhhhhhHH.',
      'hhhhhhhhhhhhH',
      'hhhhhhdhhdhdh',
      'hhhhhd.d.....',
      'hhhhd........',
      'hhhd.........',
      '.hhd.........',
      'hhd..........',
      'hd...........',
    ], flow: 6,
  },
});
HAIR.flame.rows = HAIR.flame.frames[0];

// ═════════════════════════════════════════════════════════════════════════════
//  Headgear (head-local templates). `hair`: which hair stays visible:
//  'all' | 'back' (only below the head top) | 'none'.
// ═════════════════════════════════════════════════════════════════════════════

const HEADGEAR = {
  none: { name: 'None', desc: 'Bare head.' },
  hood: {
    name: 'Hood', desc: 'A deep cloth hood framing the face.', hair: 'none', ox: -1, oy: -2, rows: [
      '...qpppP...',
      '..qpppppPP.',
      '.qppppppPPP',
      'qpppppppppP',
      'qpppqqqqqqq',
      'qppq.......',
      'qppq.......',
      'qppq.......',
      'qpppq......',
      '.qqppq.....',
      '...qqq.....',
    ],
  },
  helm: {
    name: 'Knight helm', desc: 'Closed steel helm with a visor slit.', hair: 'none', ox: -1, oy: -2, rows: [
      '...nmmmM...',
      '..nmmmmMMM.',
      '.nmmmmmmMMM',
      'nmmmmmmmmMM',
      'nmmmmmmmmmM',
      'nmmmmnDDDDD',
      'nmmmmmmmmmm',
      'nmmmmmmnmnm',
      'nmmmmmmmmmm',
      '.nnmmmmmmm.',
    ],
  },
  plume: {
    name: 'Plumed helm', desc: 'Knight helm crowned with a feather plume.', hair: 'none', ox: -3, oy: -5, rows: [
      '...AAa.......',
      '.AAaaaa......',
      'Aaa.aaaa.....',
      'a....nmmmM...',
      '....nmmmmMMM.',
      '...nmmmmmmMMM',
      '..nmmmmmmmmMM',
      '..nmmmmmmmmmM',
      '..nmmmmnDDDDD',
      '..nmmmmmmmmmm',
      '..nmmmmmmnmnm',
      '..nmmmmmmmmmm',
      '...nnmmmmmmm.',
    ],
  },
  horned: {
    name: 'Horned helm', desc: 'Viking helm with curved horns.', hair: 'back', ox: -3, oy: -5, rows: [
      'w...........w',
      'ww..........w',
      '.ww........w.',
      '..wwnmmmM.w..',
      '...nmmmmmMM..',
      '..nmmmmmmmMM.',
      '..nmmmmmmmmM.',
      '..mmmmmmmmmm.',
      '....mn.......',
    ],
  },
  wizard: {
    name: 'Wizard hat', desc: 'Tall pointed hat with a starry band.', hair: 'back', ox: -2, oy: -9, rows: [
      '.qq..........',
      '..qpq........',
      '...qpP.......',
      '...qppP......',
      '...qpppP.....',
      '..qpppppP....',
      '..qppppppP...',
      '.qpppppppPP..',
      '.qaAaaAaaaA..',
      'qqppppppppppP',
      '.qqqqqqqqqqq.',
    ],
  },
  witch: {
    name: 'Witch hat', desc: 'Wide-brimmed crooked witch hat.', hair: 'back', ox: -3, oy: -9, rows: [
      '...........qq..',
      '.........qpq...',
      '........qpP....',
      '.......qppP....',
      '......qpppP....',
      '.....qppppP....',
      '....qpppppPP...',
      '....yaaaaaaA...',
      'qqpppppppppppPP',
      '.qqqqqqqqqqqqq.',
    ],
  },
  crown: {
    name: 'Crown', desc: 'A royal golden crown.', hair: 'all', ox: 0, oy: -4, rows: [
      '.a.y.a.A.',
      '.aaaaaAAA',
      '.aAagaAAA',
      '.yyyyyyy.',
    ], gold: true,
  },
  circlet: {
    name: 'Circlet', desc: 'A slim metal band with a gem.', hair: 'all', ox: 0, oy: 1, rows: [
      'nmmmmmmgG',
    ],
  },
  bandana: {
    name: 'Bandana', desc: 'Cloth tied round the head, knot at the back.', hair: 'back', ox: -2, oy: -1, rows: [
      '....ppppP..',
      '...ppppppP.',
      '..qppppppPP',
      'q.qppppppPP',
      'qqqqqqqqqqq',
      '.q.........',
    ],
  },
  headband: {
    name: 'Headband', desc: 'A thin band with trailing tails.', hair: 'all', ox: -3, oy: 1, rows: [
      '...ppppppppP',
      'pqqq........',
      '.q..........',
    ],
  },
  cowboy: {
    name: 'Cowboy hat', desc: 'Wide-brimmed ranch hat.', hair: 'back', ox: -2, oy: -4, rows: [
      '....kllLL....',
      '...klllllL...',
      '...kaaaaaa...',
      'lkkllllllllLL',
      '.kkkkkkkkkkk.',
    ],
  },
  kabuto: {
    name: 'Kabuto', desc: 'Samurai helmet with a golden crest.', hair: 'none', ox: -2, oy: -6, rows: [
      '..a.......A..',
      '...a.....A...',
      '....aa.AA....',
      '.....aAa.....',
      '....qpppPP...',
      '...qpppppPP..',
      '..qpppppppPP.',
      '.qqqqqqqqqqq.',
      'qppq.........',
      'qppq.........',
      'qqppq........',
      '.qqq.........',
    ],
  },
  halo: {
    name: 'Halo', desc: 'A floating ring of light.', hair: 'all', ox: 0, oy: -4, rows: [
      '.jgggggj.',
      'gG.....Gg',
      '.jgggggj.',
    ], float: true,
  },
  tophat: {
    name: 'Top hat', desc: 'A tall dapper top hat.', hair: 'back', ox: 0, oy: -7, rows: [
      '.qpppPP..',
      '.qpppPP..',
      '.qpppPP..',
      '.qpppPP..',
      '.yaaaaA..',
      'qqqqqqqqq',
    ],
  },
  horns: {
    name: 'Horns', desc: 'Natural curved horns.', hair: 'all', ox: -1, oy: -4, rows: [
      '.D.......D.',
      '.dD.....Dd.',
      '..dD...Dd..',
      '...d...d...',
    ],
  },
  goggles: {
    name: 'Goggles', desc: 'Brass goggles pushed up on the forehead.', hair: 'all', ox: 0, oy: 0, rows: [
      '.........',
      'kkkmgGmgG',
      '...nmmnmm',
    ],
  },
  antlers: {
    name: 'Antlers', desc: 'Branching antlers.', hair: 'all', ox: -2, oy: -6, rows: [
      'l.l.......l.l',
      '.ll.l...l.ll.',
      '..lll...lll..',
      '...ll...ll...',
      '....l...l....',
      '....k...k....',
    ],
  },
};
Object.assign(HEADGEAR, {
  catears: {
    name: 'Cat ears', desc: 'Pointed cat ears in your hair colour.', hair: 'all', ox: 1, oy: -3, rows: [
      '.h...h.',
      'h3h.h3H',
      'hhh.hhh',
    ],
  },
  bunnyears: {
    name: 'Bunny ears', desc: 'Tall floppy bunny ears.', hair: 'all', ox: 0, oy: -7, rows: [
      '.ww......',
      'w3w...w..',
      'w3w..w3w.',
      'w3w..w3w.',
      '.w3w.w3w.',
      '.w3w..ww.',
      '..ww..w..',
    ],
  },
  spacehelmet: {
    name: 'Space helmet', desc: 'Round helmet with a gold visor.', hair: 'none', ox: -1, oy: -2, rows: [
      '...nmmmM...',
      '..nmmmmmMM.',
      '.nmmmmmmmMM',
      'nmmmmyyyyyM',
      'nmmmyaaaAwy',
      'nmmmyaaaaAy',
      'nmmmmyyyyyM',
      'nmmmmmmmmMm',
      '.nmmmmmmmm.',
      'nnmmmmmmmmn',
    ],
  },
  turban: {
    name: 'Turban', desc: 'Wrapped cloth turban with a jewel.', hair: 'back', ox: -1, oy: -4, rows: [
      '...pppPP...',
      '..qpppppPP.',
      '.qppqppqpPP',
      '.qpppppaGgP',
      'qqpqppqpppq',
      '.qqqqqqqqq.',
    ],
  },
  feathers: {
    name: 'Feather headdress', desc: 'A crest of feathers on a beaded band.', hair: 'back', ox: -2, oy: -6, rows: [
      '.a.a.a.......',
      '.w.w.w.a.....',
      '.w.w.w.w.....',
      '.w.w.w.w.....',
      '..wwwwww.....',
      '...wwww......',
      '..pp.........',
      '.qpaapaapaP..',
    ],
  },
  pharaoh: {
    name: 'Pharaoh headdress', desc: 'Striped nemes cloth with a gold band.', hair: 'none', ox: -2, oy: -2, rows: [
      '....aaaaaA..',
      '...pppppppP.',
      '..yaaaaaaaaA',
      '.ppppp......',
      '.aaaaa......',
      'ppppp.......',
      'aaaaa.......',
      'ppppp.......',
      '.aaaa.......',
      '..pp........',
    ],
  },
  beret: {
    name: 'Beret', desc: 'A soft flat beret worn at an angle.', hair: 'back', ox: -1, oy: -2, rows: [
      '.....p.....',
      '...qppppP..',
      '.qpppppppPP',
      'qqqqqqqqq..',
    ],
  },
  pumpkin: {
    name: 'Pumpkin head', desc: 'A carved jack-o\'-lantern with a glowing face.', hair: 'none', ox: -1, oy: -3, alt: '#e8782a', rows: [
      '.....fr....',
      '.....r.....',
      '..1000Y00..',
      '.100100YY0.',
      '10001000Y00',
      '1000100D0D0',
      '10001DGDDGD',
      '10001000000',
      '100D1DGDGD0',
      '.1000DDDD0.',
      '..1110001..',
    ],
  },
  plague: {
    name: 'Plague mask', desc: 'Beaked plague-doctor mask and hat.', hair: 'none', ox: -1, oy: -5, rows: [
      '...qpppP.....',
      '...qpppP.....',
      '...qaaaA.....',
      '.qqpppppPP...',
      '.kllllllL....',
      'kllllllllL...',
      'kllllDDlll...',
      'klllDwDllll..',
      'kllllDDllllL.',
      'klllllllllllL',
      '.kllllllkkk..',
      '..kkkkkk.....',
    ],
  },
  oni: {
    name: 'Oni mask', desc: 'A snarling horned demon mask.', hair: 'all', ox: 3, oy: -3, rows: [
      '.w...w.',
      '.ww..ww',
      'qppppPP',
      'qpaappA',
      'qDapDaP',
      'qpppppP',
      'qpppppp',
      'qwDDDwP',
      'qpwpwpP',
      '.qqppp.',
    ],
  },
  tiara: {
    name: 'Tiara', desc: 'A delicate jewelled tiara.', hair: 'all', ox: 1, oy: -2, rows: [
      '...A...',
      '.a.a.a.',
      'yaagaaA',
    ],
  },
  bucket: {
    name: 'Great helm', desc: 'Flat-topped bucket helm with breaths.', hair: 'none', ox: -1, oy: -2, rows: [
      '.nmmmmmmmM.',
      'nmmmmmmmmmM',
      'nmmmmmmmmmM',
      'nmmmmmmmmmM',
      'nmmmmDDDDDD',
      'nmmmmmmmmmM',
      'nmmmmmmmDmM',
      'nmmmmmmmDmM',
      'nmmmmmmmmmM',
      '.nnnnnnnnn.',
    ],
  },
});

// ═════════════════════════════════════════════════════════════════════════════
//  Faces: drawn over the head (head-local templates).
// ═════════════════════════════════════════════════════════════════════════════

const FACES = {
  plain: { name: 'Plain', desc: 'Nothing special.' },
  beard: { name: 'Beard', desc: 'A full beard.', ox: 2, oy: 5, rows: ['.hhhhhhh', '.hhhdhhh', '..hhhhh.', '...hdh..'] },
  longbeard: { name: 'Long beard', desc: 'A long wizard or dwarf beard.', ox: 2, oy: 5, rows: ['.hhhhhhh', '.hhhdhhh', '.hhhhhhh', '..hhhhh.', '..hhdhd.', '...hhh..', '...hd...'] },
  goatee: { name: 'Goatee', desc: 'A pointed chin beard.', ox: 5, oy: 6, rows: ['hhh', 'hd.', 'h..'] },
  mustache: { name: 'Mustache', desc: 'A bold mustache.', ox: 5, oy: 5, rows: ['hhhh', 'h..h'] },
  stubble: { name: 'Stubble', desc: 'A rough five o\'clock shadow.', ox: 3, oy: 5, rows: ['.z.z.z', 'z.z.z.', '.z.z..'] },
  mask: { name: 'Cloth mask', desc: 'A cloth mask over the lower face.', ox: 3, oy: 5, rows: ['qppppP', 'qppppp', '.qqqq.'] },
  visor: { name: 'Visor', desc: 'A glowing visor across the eyes.', ox: 3, oy: 3, rows: ['DgggGG', 'Djjjgg'] },
  scar: { name: 'Scar', desc: 'A scar across the eye.', over: true, ox: 4, oy: 1, rows: ['..Z', '..Z', '...', '...', 'Z..', 'Z..'] },
  warpaint: { name: 'War paint', desc: 'Stripes of paint on the cheek.', ox: 4, oy: 5, rows: ['a.a', 'a.a'] },
  eyepatch: { name: 'Eye patch', desc: 'A patch over one eye.', ox: 0, oy: 2, rows: ['DDDDDDD', '.....DD', '.....DD'] },
  bandage: { name: 'Bandage', desc: 'A bandage wrapped round the head.', over: true, ox: -1, oy: 2, rows: ['wwwwwwwwww', 'ww........', '.w........'] },
  fangs: { name: 'Fangs', desc: 'Sharp fangs showing.', ox: 5, oy: 5, rows: ['.D', 'ww'] },
};
Object.assign(FACES, {
  glasses: { name: 'Glasses', desc: 'Round-rimmed spectacles.', late: true, ox: 2, oy: 2, rows: ['...m.m.', 'nnm.m.m'] },
  sunglasses: { name: 'Sunglasses', desc: 'Dark shades with a glint.', late: true, ox: 2, oy: 3, rows: ['kkDDDDw', '..DD.DD'] },
  monocle: { name: 'Monocle', desc: 'A metal monocle on a chain.', late: true, ox: 6, oy: 2, rows: ['.M.', 'm.M', 'm.m', '.n.', '..n'] },
  blindfold: { name: 'Blindfold', desc: 'A cloth band tied over the eyes.', over: true, ox: -2, oy: 3, rows: ['..pppppppppP', 'qppppppppppp', 'q...........', '.q..........'] },
  whiskers: { name: 'Whiskers', desc: 'Long cat whiskers.', ox: 8, oy: 3, rows: ['..w', '.w.', '.ww', '.w.', '..w'] },
  blush: { name: 'Blush', desc: 'Rosy cheeks.', ox: 3, oy: 5, rows: ['3...33'] },
  stitched: { name: 'Stitched mouth', desc: 'A mouth sewn shut.', ox: 4, oy: 5, rows: ['.D.D', 'DDDD', '.D..'] },
  gasmask: { name: 'Gas mask', desc: 'Goggled gas mask with a filter.', late: true, ox: 3, oy: 3, rows: ['kDwkDw', 'kDDkDD', 'kkkkkkm', '.kkkkmmm', '..kkkmm.'] },
  tusks: { name: 'Tusks', desc: 'Big boar tusks.', ox: 7, oy: 4, rows: ['.w', 'ww', 'w.'] },
  grin: { name: 'Big grin', desc: 'A huge toothy grin.', ox: 4, oy: 5, rows: ['Dwwww', '.DDD.'] },
});

// ═════════════════════════════════════════════════════════════════════════════
//  Bases (species / body types) and builds
//  legs/torso/arms are pixel lengths; sw/ww = shoulder/waist width (side view).
// ═════════════════════════════════════════════════════════════════════════════

const BASES = {
  human: {
    name: 'Human', desc: 'Balanced, classic proportions.',
    head: 'round', skin: 'fair', hair: 'short', hairColor: 'brown', eyes: '#2e2a3a', ears: 'round',
    legs: 10, torso: 7, arms: 9, sw: 8, ww: 6,
  },
  elf: {
    name: 'Elf', desc: 'Tall and graceful with long pointed ears.',
    head: 'round', skin: 'porcelain', hair: 'long', hairColor: 'platinum', eyes: '#2f8a62', ears: 'elf',
    legs: 11, torso: 7, arms: 9, sw: 7, ww: 5, slimmer: true,
  },
  dwarf: {
    name: 'Dwarf', desc: 'Short, broad and bearded.',
    head: 'round', skin: 'tan', hair: 'crop', hairColor: 'auburn', eyes: '#2e2a3a', ears: 'round', face: 'longbeard',
    legs: 6, torso: 7, arms: 8, sw: 10, ww: 9, stocky: true,
  },
  orc: {
    name: 'Orc', desc: 'Hulking green brute with tusks.',
    head: 'round', skin: 'orc', hair: 'mohawk', hairColor: 'black', eyes: '#e8b020', ears: 'elf', tusks: true, brow: true,
    legs: 10, torso: 8, arms: 10, sw: 9, ww: 7, build: 'bulky',
  },
  goblin: {
    name: 'Goblin', desc: 'Small, sneaky, all ears and nose.',
    head: 'round', skin: 'goblin', hair: 'none', hairColor: 'black', eyes: '#f2d020', ears: 'goblin', nose: true,
    legs: 6, torso: 6, arms: 8, sw: 7, ww: 6,
  },
  skeleton: {
    name: 'Skeleton', desc: 'Rattling bones with glowing eye sockets.',
    head: 'skull', skin: 'bone', hair: 'none', hairColor: 'black', eyes: '#58e0ff', ears: null, bones: true, glowEyes: true,
    legs: 10, torso: 7, arms: 9, sw: 8, ww: 5, build: 'slim',
  },
  undead: {
    name: 'Undead', desc: 'A shambling zombie, stitched together.',
    head: 'round', skin: 'zombie', hair: 'messy', hairColor: '#3e3a36', eyes: '#c8f060', ears: 'round', stitches: true, glowEyes: true,
    legs: 10, torso: 7, arms: 9, sw: 8, ww: 6,
  },
  robot: {
    name: 'Robot', desc: 'Riveted metal automaton with a visor eye.',
    head: 'box', skin: 'steel', hair: 'none', hairColor: 'black', eyes: '#48e8ff', ears: 'bolt', robot: true, glowEyes: true,
    legs: 10, torso: 7, arms: 9, sw: 9, ww: 7,
  },
  golem: {
    name: 'Golem', desc: 'Hulking living stone veined with runes.',
    head: 'rock', skin: 'stone', hair: 'none', hairColor: 'black', eyes: '#58d0ff', ears: null, rock: true, glowEyes: true,
    legs: 8, torso: 9, arms: 10, sw: 11, ww: 9, build: 'bulky', bigHands: true,
  },
  beast: {
    name: 'Beastfolk', desc: 'Furry animal folk with ears, muzzle and tail.',
    head: 'round', skin: 'fur', hair: 'short', hairColor: '#8a5a34', eyes: '#e8a020', ears: 'beast', muzzle: true, tail: 'fluffy',
    legs: 10, torso: 7, arms: 9, sw: 8, ww: 6,
  },
  lizard: {
    name: 'Lizardfolk', desc: 'Scaly reptile with a long snout and tail.',
    head: 'snout', skin: 'scales', hair: 'none', hairColor: 'black', eyes: '#f0c830', ears: null, tail: 'lizard', crest: true, scales: true,
    legs: 10, torso: 7, arms: 9, sw: 8, ww: 6,
  },
  demon: {
    name: 'Demon', desc: 'Red-skinned fiend with horns and a spaded tail.',
    head: 'round', skin: 'red', hair: 'short', hairColor: 'black', eyes: '#ffd23a', ears: 'elf', horns: true, tail: 'demon', glowEyes: true,
    legs: 10, torso: 7, arms: 9, sw: 8, ww: 6,
  },
  dummy: {
    name: 'Training dummy', desc: 'A straw dummy on a wooden post (it does not walk).',
    head: 'sack', skin: 'burlap', hair: 'none', hairColor: 'straw', eyes: '#3a2615', ears: null, dummy: true,
    legs: 10, torso: 7, arms: 9, sw: 9, ww: 8,
  },
};
// v2 bases. bodyStyle = BASE_TORSO pattern when uncovered; bare = no clothes by default;
// back / tail2 = default back item / tail; hover = floats that many px.
Object.assign(BASES, {
  slime: {
    name: 'Slime', desc: 'A wobbling blob of living goo on a gooey mound (no legs).',
    head: 'round', skin: '#58c858', hair: 'none', hairColor: '#3a9a3a', eyes: '#1e2a1e', ears: null, blob: true, slime: true, bare: true, bodyStyle: 'slime',
    legs: 8, torso: 6, arms: 8, sw: 9, ww: 8,
  },
  ghost: {
    name: 'Ghost', desc: 'A floating spirit whose body fades into a wisp.',
    head: 'round', skin: '#dce8f4', hair: 'none', hairColor: '#c8d4e8', eyes: '#3a4a78', ears: null, wisp: true, hover: 1, ghost: true, bare: true, bodyStyle: 'ghost',
    legs: 10, torso: 7, arms: 8, sw: 8, ww: 6, build: 'slim',
  },
  insectoid: {
    name: 'Insectoid', desc: 'Chitin-plated bug folk with antennae, mandibles and compound eyes.',
    head: 'round', skin: '#3a8a78', hair: 'none', hairColor: 'black', eyes: '#e8402a', ears: null, antennae: true, mandibles: true, bugEyes: true, bare: true, bodyStyle: 'insect',
    legs: 11, torso: 7, arms: 9, sw: 7, ww: 5, build: 'slim',
  },
  birdfolk: {
    name: 'Birdfolk', desc: 'Feathered folk with a beak and a crest (crest = hairColor).',
    head: 'round', skin: '#e8e0d0', hair: 'none', hairColor: '#4a7ad8', eyes: '#1e1a24', ears: null, beak: true, alt: '#f0a830', bodyStyle: 'bird',
    legs: 10, torso: 7, arms: 9, sw: 8, ww: 6,
  },
  catfolk: {
    name: 'Catfolk', desc: 'Nimble feline folk with pointed ears and a swishing tail.',
    head: 'round', skin: '#e8a860', hair: 'short', hairColor: '#b86a2a', eyes: '#58c030', ears: 'cat', catNose: true, tail2: 'cat',
    legs: 10, torso: 7, arms: 9, sw: 8, ww: 6,
  },
  frogfolk: {
    name: 'Frogfolk', desc: 'Wide-mouthed amphibian with bulging eyes.',
    head: 'frog', skin: '#5aa84a', hair: 'none', hairColor: 'black', eyes: '#f0c830', ears: null, frog: true, bodyStyle: 'frog',
    legs: 9, torso: 7, arms: 9, sw: 9, ww: 8,
  },
  mushroom: {
    name: 'Mushroom folk', desc: 'A stubby walking toadstool; the cap takes your hairColor.',
    head: 'round', skin: '#f0e2c8', hair: 'none', hairColor: '#d83a34', eyes: '#2e2a3a', ears: null, cap: true,
    legs: 6, torso: 6, arms: 8, sw: 9, ww: 8, stocky: true,
  },
  crystal: {
    name: 'Crystal being', desc: 'Faceted living crystal that glows from within.',
    head: 'gem', skin: '#8ad8f0', hair: 'none', hairColor: 'black', eyes: '#ffffff', ears: null, crystal: true, glowEyes: true, bare: true, bodyStyle: 'crystal',
    legs: 10, torso: 8, arms: 9, sw: 9, ww: 7,
  },
  fire: {
    name: 'Fire elemental', desc: 'A living flame with flickering fiery hair.',
    head: 'round', skin: '#ff8a2a', hair: 'flame', hairColor: '#ffb030', eyes: '#fff6c0', ears: null, flame: true, glowEyes: true, bare: true, bodyStyle: 'fire',
    legs: 10, torso: 7, arms: 9, sw: 8, ww: 6,
  },
  fairy: {
    name: 'Fairy', desc: 'A tiny hovering fairy with gossamer wings.',
    head: 'round', skin: 'porcelain', hair: 'bun', hairColor: 'pink', eyes: '#3a8ad8', ears: 'elf', back: 'fairy', hover: 1,
    legs: 7, torso: 6, arms: 7, sw: 6, ww: 5, build: 'slim',
  },
  dragonkin: {
    name: 'Dragonkin', desc: 'Horned, scaled dragon folk with a heavy tail.',
    head: 'snout', skin: '#b8483a', hair: 'none', hairColor: 'black', eyes: '#ffc830', ears: null, dragonHorns: true, scales: true, tail2: 'dragon', bodyStyle: 'scaly',
    legs: 10, torso: 8, arms: 10, sw: 9, ww: 7,
  },
  alien: {
    name: 'Alien', desc: 'Big-headed grey visitor with huge black eyes.',
    head: 'dome', skin: '#9ab8a8', hair: 'none', hairColor: 'black', eyes: '#141820', ears: null, alienEyes: true,
    legs: 10, torso: 6, arms: 9, sw: 7, ww: 5, build: 'slim',
  },
});

const BUILDS = {
  slim: { name: 'Slim', desc: 'Lean and narrow.', sw: -1, ww: -1, arm: 2, leg: 2, hand: 2 },
  average: { name: 'Average', desc: 'Regular build.', sw: 0, ww: 0, arm: 2, leg: 3, hand: 2 },
  bulky: { name: 'Bulky', desc: 'Broad, heavy and muscular.', sw: 3, ww: 2, arm: 3, leg: 3, hand: 3 },
};

// ═════════════════════════════════════════════════════════════════════════════
//  Outfits. `torso(c)` is a tiny shader in body-local coordinates:
//    c.u  -1 (back) .. +1 (front)      c.v  0 (neck) .. 1 (hips)
//    c.row / c.rows, c.col / c.cols    integer grid of the torso
//  It returns a material: pri sec acc met lea skin hair dark white glow
//  (or an exact role like 'priL'). Limbs: upper/fore/hand/thigh/shin/boot/foot.
//  skirt: {len: px below the hips, 'long' = to the ankles, mat, hem, flare, back}
// ═════════════════════════════════════════════════════════════════════════════

const beltRow = (c) => c.row === c.rows - 2;
const OUTFITS = {
  tunic: {
    name: 'Tunic', desc: 'Simple belted tunic, trousers and boots.',
    torso(c) {
      if (beltRow(c)) return c.col === c.cols - 3 ? 'met' : 'lea';
      if (c.row === 0) return c.u > -0.2 ? 'sec' : 'pri';
      if (c.row === 1 && c.u > 0.15 && c.u < 0.75) return 'skin';
      return 'pri';
    },
    skirt: { len: 2, mat: 'pri', hem: 'sec', flare: 1 },
    upper: 'pri', fore: 'skin', hand: 'skin', cuff: null, thigh: 'pant', shin: 'pant', boot: 'lea', bootH: 3, foot: 'lea',
  },
  robe: {
    name: 'Robe', desc: 'Long flowing mage robe with a sash.',
    torso(c) {
      if (c.row === c.rows - 3) return 'sec';
      if (c.row <= 1 && c.u > -0.1) return 'sec';
      if (c.u > 0.55 && c.row > 1) return 'acc';
      return 'pri';
    },
    skirt: { len: 'long', mat: 'pri', hem: 'acc', flare: 2, trim: 'acc' },
    upper: 'pri', fore: 'pri', hand: 'skin', cuff: 'sec', thigh: 'pri', shin: 'pri', boot: 'lea', bootH: 1, foot: 'lea', wideSleeves: true,
  },
  plate: {
    name: 'Plate armour', desc: 'Full steel plate with a coloured skirt.',
    torso(c) {
      if (beltRow(c)) return c.col === c.cols - 3 ? 'acc' : 'lea';
      if (c.row === 3 && c.u > -0.6) return 'metL';
      if (c.row === 1 && c.u > 0.2) return 'metH';
      return 'met';
    },
    skirt: { len: 3, mat: 'pri', hem: 'priL', flare: 1, plates: 'met' },
    upper: 'met', fore: 'met', hand: 'met', cuff: null, thigh: 'met', shin: 'met', boot: 'met', bootH: 2, foot: 'met', shoulders: 'pauldrons',
  },
  chainmail: {
    name: 'Chainmail', desc: 'A mail shirt over a padded coat.',
    torso(c) {
      if (beltRow(c)) return c.col === c.cols - 3 ? 'met' : 'lea';
      if (c.row === 0) return 'pri';
      return ((c.x + c.y) & 1) ? 'met' : 'metL';
    },
    skirt: { len: 3, mat: 'met', hem: 'metL', flare: 1, chain: true },
    upper: 'met', fore: 'pri', hand: 'lea', cuff: null, thigh: 'pant', shin: 'pant', boot: 'lea', bootH: 3, foot: 'lea', chainArms: true,
  },
  leather: {
    name: 'Leather armour', desc: 'Stitched jerkin with straps and bracers.',
    torso(c) {
      if (beltRow(c)) return c.col === c.cols - 3 ? 'met' : 'leaL';
      const strap = Math.abs(c.col - (c.cols - 2) + c.row * 0.8) < 0.7;
      if (strap && c.row < c.rows - 2) return 'lea';
      if (c.row === 0) return 'sec';
      return 'pri';
    },
    skirt: { len: 2, mat: 'pri', hem: 'priL', flare: 0 },
    upper: 'pri', fore: 'lea', hand: 'lea', cuff: null, thigh: 'pant', shin: 'pant', boot: 'lea', bootH: 4, foot: 'lea',
  },
  gi: {
    name: 'Martial gi', desc: 'Wrapped gi with a black belt, barefoot.',
    torso(c) {
      if (beltRow(c)) return 'dark';
      const lap = c.cols - 1 - Math.round(c.row * 0.9);
      if (c.row < c.rows - 2 && c.col > lap) return c.row < 3 ? 'skin' : 'pri';
      if (c.col === lap && c.row < c.rows - 2) return 'sec';
      return 'pri';
    },
    skirt: { len: 2, mat: 'pri', hem: 'priL', flare: 1 },
    upper: 'pri', fore: 'pri', hand: 'skin', cuff: null, thigh: 'pri', shin: 'pri', boot: null, bootH: 0, foot: 'skin', wideSleeves: true, belt: 'dark',
  },
  coat: {
    name: 'Long coat', desc: 'Open duster coat with long tails.',
    torso(c) {
      if (c.u > 0.35) return c.row === c.rows - 2 ? 'lea' : (c.col === c.cols - 2 && c.row % 2 === 1 ? 'acc' : 'sec');
      if (c.row === 0) return 'priH';
      return 'pri';
    },
    skirt: { len: 7, mat: 'pri', hem: 'priL', flare: 2, back: true },
    upper: 'pri', fore: 'pri', hand: 'lea', cuff: 'priL', thigh: 'pant', shin: 'pant', boot: 'lea', bootH: 4, foot: 'lea',
  },
  ninja: {
    name: 'Ninja garb', desc: 'Dark wrapped shinobi garb with a sash.',
    torso(c) {
      if (c.row === c.rows - 2) return 'sec';
      if (Math.abs(c.col - (c.cols - 2) + c.row) < 0.6) return 'priL';
      return 'pri';
    },
    skirt: { len: 1, mat: 'pri', hem: 'priL', flare: 0, sash: 'sec' },
    upper: 'pri', fore: 'pri', hand: 'pri', cuff: 'priL', thigh: 'pri', shin: 'pri', boot: 'priL', bootH: 3, foot: 'pri', wraps: true,
  },
  tabard: {
    name: 'Tabard', desc: 'Heraldic tabard over mail.',
    torso(c) {
      if (beltRow(c)) return c.u > -0.1 ? 'lea' : 'met';
      if (c.u > -0.25) {
        const cx = Math.round(c.cols * 0.62), cy = Math.round(c.rows * 0.4);
        if ((c.col === cx && Math.abs(c.row - cy) <= 1) || (c.row === cy && Math.abs(c.col - cx) <= 1)) return 'acc';
        return 'pri';
      }
      return ((c.x + c.y) & 1) ? 'met' : 'metL';
    },
    skirt: { len: 5, mat: 'pri', hem: 'priL', flare: 0, front: true, backMat: 'met' },
    upper: 'met', fore: 'met', hand: 'lea', cuff: null, thigh: 'met', shin: 'lea', boot: 'lea', bootH: 3, foot: 'lea', chainArms: true,
  },
  vest: {
    name: 'Vest', desc: 'Shirt and buttoned vest.',
    torso(c) {
      if (beltRow(c)) return c.col === c.cols - 3 ? 'acc' : 'lea';
      if (c.u > 0.45) return c.row < 2 ? 'secH' : 'sec';
      if (c.col === c.cols - 3 && c.row % 2 === 0) return 'acc';
      return 'pri';
    },
    skirt: null,
    upper: 'sec', fore: 'sec', hand: 'skin', cuff: 'secL', thigh: 'pant', shin: 'pant', boot: 'lea', bootH: 4, foot: 'lea',
  },
  barbarian: {
    name: 'Barbarian', desc: 'Bare chest, fur kilt and a cross strap.',
    torso(c) {
      if (beltRow(c)) return c.col === c.cols - 3 ? 'met' : 'lea';
      if (Math.abs(c.col - (c.cols - 1) + c.row) < 0.7 && c.row < c.rows - 2) return 'lea';
      if (c.row === 3 && c.col === c.cols - 3) return 'skinL';
      return 'skin';
    },
    skirt: { len: 4, mat: 'lea', hem: 'leaL', flare: 1, jagged: true },
    upper: 'skin', fore: 'skin', hand: 'skin', cuff: 'lea', thigh: 'skin', shin: 'skin', boot: 'lea', bootH: 3, foot: 'lea',
  },
  rags: {
    name: 'Rags', desc: 'Torn, patched peasant clothes.',
    torso(c) {
      if (beltRow(c)) return 'lea';
      if (c.row >= 2 && c.row <= 3 && c.col >= 1 && c.col <= 2) return 'sec';
      if (c.row === 4 && c.col === c.cols - 3) return 'priL';
      return 'pri';
    },
    skirt: { len: 3, mat: 'pri', hem: 'priL', flare: 1, jagged: true },
    upper: 'pri', fore: 'skin', hand: 'skin', cuff: null, thigh: 'pant', shin: 'skin', boot: null, bootH: 0, foot: 'skin',
  },
  bodysuit: {
    name: 'Bodysuit', desc: 'Sleek suit with glowing trim.',
    torso(c) {
      if (c.u < -0.55) return 'sec';
      if (c.row === 2 && c.col === c.cols - 3) return 'glow';
      if (beltRow(c)) return 'sec';
      return 'pri';
    },
    skirt: null,
    upper: 'pri', fore: 'pri', hand: 'sec', cuff: 'sec', thigh: 'pri', shin: 'pri', boot: 'sec', bootH: 3, foot: 'sec',
  },
  none: {
    name: 'None', desc: 'No clothes: the base body (shorts for fleshy folk).',
    torso(c) { return c.base.torso ? c.base.torso(c) : 'skin'; },
    skirt: null,
    upper: 'skin', fore: 'skin', hand: 'skin', cuff: null, thigh: 'pant', shin: 'skin', boot: null, bootH: 0, foot: 'skin', bare: true,
  },
};
Object.assign(OUTFITS, {
  kimono: {
    name: 'Kimono', desc: 'Wrapped silk kimono with a wide obi sash.',
    torso(c) {
      if (c.row === c.rows - 3 || c.row === c.rows - 2) return c.row === c.rows - 3 && c.col === c.cols - 3 ? 'acc' : 'sec';
      const lap = c.cols - 1 - Math.round(c.row * 0.8);
      if (c.col === lap) return 'sec';
      if (c.col > lap && c.row < 2) return 'skin';
      return 'pri';
    },
    skirt: { len: 'long', mat: 'pri', hem: 'priL', flare: 1, trim: 'sec' },
    upper: 'pri', fore: 'pri', hand: 'skin', cuff: 'priL', thigh: 'pri', shin: 'pri', boot: null, bootH: 0, foot: 'white', wideSleeves: true,
  },
  samurai: {
    name: 'Samurai armour', desc: 'Laced lamellar armour with a plated skirt and shoulder guards.',
    torso(c) {
      if (beltRow(c)) return 'sec';
      if (c.row === 0) return c.u > -0.2 ? 'acc' : 'priL';
      if (c.row % 2 === 0) return 'priL';
      return c.col % 3 === 1 ? 'acc' : 'pri';
    },
    skirt: { len: 4, mat: 'pri', hem: 'acc', flare: 2, bands: 'priL' },
    upper: 'pri', fore: 'met', hand: 'lea', cuff: null, thigh: 'sec', shin: 'met', boot: 'lea', bootH: 2, foot: 'lea', shoulders: 'pads',
  },
  pirate: {
    name: 'Captain\'s coat', desc: 'Gold-trimmed pirate captain\'s coat over a white shirt.',
    torso(c) {
      if (beltRow(c)) return 'sec';
      if (c.u > 0.45) return 'white';
      if (c.u > 0.2) return 'acc';
      if (c.row === 0) return 'priH';
      return 'pri';
    },
    skirt: { len: 7, mat: 'pri', hem: 'acc', flare: 2, back: true },
    upper: 'pri', fore: 'pri', hand: 'skin', cuff: 'acc', thigh: 'pant', shin: 'pant', boot: 'lea', bootH: 5, foot: 'lea',
  },
  spacesuit: {
    name: 'Spacesuit', desc: 'Bulky pressurised suit with a glowing chest panel.',
    torso(c) {
      if (beltRow(c) || c.row === 0) return 'met';
      if (c.row >= 2 && c.row <= 3 && c.u > 0.05 && c.u < 0.85) return c.row === 2 && c.col === c.cols - 3 ? 'glow' : (c.col % 2 ? 'metL' : 'met');
      return 'pri';
    },
    skirt: null,
    upper: 'pri', fore: 'pri', hand: 'met', cuff: 'met', thigh: 'pri', shin: 'pri', boot: 'met', bootH: 3, foot: 'met',
  },
  royal: {
    name: 'Royal robes', desc: 'Regal robes with an ermine collar and gold trim.',
    torso(c) {
      if (c.row <= 1) return (c.col + c.row) % 3 === 0 ? 'dark' : 'white';
      if (beltRow(c)) return 'acc';
      if (c.col === c.cols - 3) return 'acc';
      return 'pri';
    },
    skirt: { len: 'long', mat: 'pri', hem: 'white', flare: 2, trim: 'acc' },
    upper: 'pri', fore: 'pri', hand: 'skin', cuff: 'white', thigh: 'pri', shin: 'pri', boot: 'lea', bootH: 1, foot: 'acc', wideSleeves: true,
  },
  priest: {
    name: 'Priest vestments', desc: 'A long alb under a coloured chasuble with a gold stole.',
    torso(c) {
      if (c.row === 0) return 'sec';
      if (c.col === c.cols - 3 || c.col === c.cols - 2) return c.row % 3 === 1 && c.col === c.cols - 3 ? 'accH' : 'acc';
      return 'pri';
    },
    skirt: { len: 'long', mat: 'sec', hem: 'secL', flare: 1, trim: 'acc' },
    upper: 'pri', fore: 'sec', hand: 'skin', cuff: 'sec', thigh: 'sec', shin: 'sec', boot: 'lea', bootH: 1, foot: 'lea', wideSleeves: true,
  },
  suit: {
    name: 'Suit and tie', desc: 'Sharp tailored suit, white shirt and a tie (accent).',
    torso(c) {
      if (c.col === c.cols - 2 && c.row >= 1 && c.row < c.rows - 1) return c.row === 1 ? 'accH' : 'acc';
      if (c.u > 0.3 && c.row < 4) return 'white';
      if (c.u > 0.12 && c.row < 4) return 'priL';
      return 'pri';
    },
    skirt: null,
    upper: 'pri', fore: 'pri', hand: 'skin', cuff: 'white', thigh: 'pant', shin: 'pant', boot: 'dark', bootH: 1, foot: 'dark',
  },
  bone: {
    name: 'Bone armour', desc: 'Ribs, spine and skull plates lashed over dark leather.',
    torso(c) {
      if (beltRow(c)) return c.col === c.cols - 3 ? 'alt' : 'lea';
      if (c.col <= 1) return 'altL';
      if (c.row % 2 === 1 && c.row < c.rows - 2) return c.col >= c.cols - 1 ? 'altL' : 'alt';
      return 'pri';
    },
    skirt: { len: 3, mat: 'pri', hem: 'alt', flare: 1, jagged: true },
    upper: 'alt', fore: 'pri', hand: 'lea', cuff: 'alt', thigh: 'pant', shin: 'alt', boot: 'lea', bootH: 2, foot: 'lea', shoulders: 'skull', alt: '#e6dcc0',
  },
  crystal: {
    name: 'Crystal armour', desc: 'Faceted crystal plates (primary) with a glowing core.',
    torso(c) {
      if (beltRow(c)) return 'sec';
      if (c.row === 2 && c.col === c.cols - 3) return 'glow';
      const f = (c.col + c.row * 2) % 5;
      if (f === 0) return 'priH';
      if (f === 3) return 'priL';
      return 'pri';
    },
    skirt: { len: 3, mat: 'pri', hem: 'priH', flare: 1, jagged: true },
    upper: 'pri', fore: 'pri', hand: 'sec', cuff: 'priH', thigh: 'pant', shin: 'pri', boot: 'pri', bootH: 3, foot: 'pri', shoulders: 'crystal',
  },
  leaf: {
    name: 'Leaf armour', desc: 'Overlapping leaves (primary) bound with vines.',
    torso(c) {
      if (beltRow(c)) return 'wood';
      const k = (c.col + (c.row % 2) * 2) % 4;
      if (k === 0) return 'priL';
      if (k === 2 && c.row % 2 === 0) return 'priH';
      return 'pri';
    },
    skirt: { len: 4, mat: 'pri', hem: 'priL', flare: 2, jagged: true },
    upper: 'pri', fore: 'skin', hand: 'skin', cuff: 'pri', thigh: 'pant', shin: 'skin', boot: 'pri', bootH: 2, foot: 'lea',
  },
});

// Bodies of non-fleshy bases when not covered (outfit 'none').
const BASE_TORSO = {
  skeleton(c) {
    // collar bone, ribs curving from a back spine, a hollow ribcage, then the pelvis
    if (c.row >= c.rows - 2) return c.col >= 1 && c.col <= c.cols - 1 ? (c.row === c.rows - 1 ? 'skinL' : 'skin') : 'dark';
    if (c.row === 0) return 'skin';
    if (c.col <= 1) return c.col === 1 ? 'skin' : 'skinL';
    if (c.row === c.rows - 3) return c.col === 2 ? 'skin' : 'dark';
    if (c.row % 2 === 1) return c.col >= c.cols - 1 ? 'dark' : 'skin';
    return c.col === c.cols - 2 && c.row < 4 ? 'skinL' : 'dark';
  },
  robot(c) {
    if (c.row === 2 && c.col === c.cols - 3) return 'glow';
    if (c.row === c.rows - 2) return 'skinL';
    if (c.row === 4 && c.col > 1) return 'skinL';
    return 'skin';
  },
  golem(c) {
    const h = ((c.x * 7 + c.y * 13) % 11);
    if (h === 0 && c.col > 1) return 'glow';
    if (h === 3) return 'skinL';
    return 'skin';
  },
  dummy(c) {
    if (c.row === 2 && Math.abs(c.col - (c.cols >> 1)) <= 1) return 'acc';
    if ((c.col + c.row) % 4 === 0) return 'skinL';
    return 'skin';
  },
};
Object.assign(BASE_TORSO, {
  slime(c) {
    if (c.row === 1 && c.col === c.cols - 2) return 'white';
    if ((c.col * 3 + c.row * 5) % 11 === 0) return 'skinH';
    return 'skin';
  },
  ghost(c) { return c.row >= c.rows - 2 ? 'skinL' : 'skin'; },
  insect(c) {
    if (c.row % 3 === 2) return 'skinL';
    if (c.u > 0.45 && c.row % 3 === 0) return 'skinH';
    return 'skin';
  },
  bird(c) {
    if (c.u > 0.35) return 'skinH';
    return (c.col + c.row) % 3 === 0 && c.row > 0 ? 'skinL' : 'skin';
  },
  frog(c) { return c.u > 0.3 ? 'skinH' : 'skin'; },
  scaly(c) { return c.u > 0.35 ? (c.row % 2 ? 'skinH' : 'skin') : ((c.col + c.row) % 3 === 0 ? 'skinL' : 'skin'); },
  crystal(c) {
    if (c.row === 2 && c.col === c.cols - 3) return 'glow';
    const f = (c.col * 2 + c.row) % 5;
    if (f === 0) return 'skinH';
    if (f === 3) return 'skinL';
    return 'skin';
  },
  fire(c) {
    if (c.row >= 2 && c.row <= 3 && c.col >= c.cols - 4 && c.col <= c.cols - 3) return 'glow';
    if ((c.row + c.col) % 4 === 0) return 'skinH';
    return c.row >= c.rows - 2 ? 'skinL' : 'skin';
  },
});

// ═════════════════════════════════════════════════════════════════════════════
//  Capes, shoulders
// ═════════════════════════════════════════════════════════════════════════════

const CAPES = {
  none: { name: 'None', desc: 'No cape.' },
  short: { name: 'Short cape', desc: 'A cape down to the waist.', len: 'waist' },
  long: { name: 'Long cape', desc: 'A heroic floor-length cape.', len: 'long' },
  tattered: { name: 'Tattered cloak', desc: 'A long ragged cloak.', len: 'long', jagged: true },
  scarf: { name: 'Scarf', desc: 'A long scarf trailing in the wind.', scarf: true },
  mantle: { name: 'Fur mantle', desc: 'A shaggy fur mantle over the shoulders.', mantle: true },
};

const SHOULDERS = {
  none: { name: 'None', desc: 'Nothing on the shoulders.' },
  pads: { name: 'Pads', desc: 'Padded cloth shoulder guards.', mat: 'sec', w: 4, h: 3 },
  pauldrons: { name: 'Pauldrons', desc: 'Round steel pauldrons.', mat: 'met', w: 5, h: 3 },
  spiked: { name: 'Spiked pauldrons', desc: 'Pauldrons with spikes.', mat: 'met', w: 5, h: 3, spikes: true },
  fur: { name: 'Fur', desc: 'Shaggy fur on the shoulders.', mat: 'hair', w: 5, h: 3, fur: true },
};
Object.assign(CAPES, {
  royal: { name: 'Royal cape', desc: 'A floor-length cape (secondary) with ermine trim.', len: 'long', ermine: true },
  feathered: { name: 'Feathered cloak', desc: 'A long cloak of layered feathers.', len: 'long', feathers: true },
  vampire: { name: 'High-collar cape', desc: 'A dramatic cape with a tall stiff collar.', len: 'long', collar: true },
  starry: { name: 'Starry cloak', desc: 'A night-sky cloak sprinkled with stars.', len: 'long', stars: true },
});
Object.assign(SHOULDERS, {
  epaulettes: { name: 'Epaulettes', desc: 'Gold (accent) fringed epaulettes.', mat: 'acc', w: 4, h: 2, fringe: true },
  skull: { name: 'Skull pauldrons', desc: 'Bone pauldrons carved like skulls.', mat: 'alt', w: 5, h: 3, skull: true, alt: '#e6dcc0' },
  crystal: { name: 'Crystal shards', desc: 'Jagged crystal (primary) growing from the shoulders.', mat: 'pri', w: 4, h: 3, shards: true },
});

// ═════════════════════════════════════════════════════════════════════════════
//  v2 parts: back items, tails, eye styles, markings, chest emblems, gloves,
//  boots, accessories, weapon glows. All optional; absent = drawn exactly as before.
// ═════════════════════════════════════════════════════════════════════════════

const BACKS = {
  none: { name: 'None', desc: 'Nothing on the back.' },
  angel: { name: 'Angel wings', desc: 'Feathered wings (white unless colors.accent2).', wing: 'feather', color: '#f4f0e6' },
  bat: { name: 'Bat wings', desc: 'Leathery bat wings.', wing: 'membrane', color: '#4a3a58' },
  dragon: { name: 'Dragon wings', desc: 'Big clawed dragon wings (skin-coloured on scaly folk).', wing: 'membrane', big: true, color: '#9a3a34' },
  fairy: { name: 'Fairy wings', desc: 'Gossamer insect wings that shimmer.', wing: 'fairy', color: '#bff0ff' },
  mech: { name: 'Mech wings', desc: 'Angular metal wing blades with glowing thrusters.', wing: 'mech', color: null },
  jetpack: { name: 'Jetpack', desc: 'Twin-nozzle jetpack that blasts when you dash.', item: 'jetpack', color: null },
  quiver: { name: 'Quiver', desc: 'A quiver of arrows over the shoulder.', item: 'quiver', color: null },
  backpack: { name: 'Backpack', desc: 'An adventurer\'s pack with a bedroll.', item: 'backpack', color: null },
  greatsword: { name: 'Sword on back', desc: 'A huge sword slung across the back.', item: 'sword', color: null },
  banner: { name: 'War banner', desc: 'A tall banner on a pole flying your primary colour.', item: 'banner', color: null },
};

const TAILS = {
  none: { name: 'None', desc: 'No tail (also removes a base\'s own tail).' },
  fox: { name: 'Fox tail', desc: 'Big bushy tail with a white tip.', n: 11, a0: -60, curl: -10, thick: [2, 3, 3, 4, 4, 4, 4, 3, 3, 2, 2], mat: 'hair', tip: 3, tipMat: 'white', sway: 6 },
  cat: { name: 'Cat tail', desc: 'Long thin swishing tail.', n: 12, a0: -80, curl: -9, thick: [2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1], mat: 'hair', sway: 14, wiggle: true },
  dragon: { name: 'Dragon tail', desc: 'Heavy tail with spikes and a spade.', n: 12, a0: -58, curl: 2.5, thick: [4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1], mat: 'skin', spikes: true, spade: true, sway: 4 },
  devil: { name: 'Devil tail', desc: 'Thin whip tail with a spade tip.', n: 10, a0: -70, curl: -9, thick: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], mat: 'skinL', spade: true, spadeMat: 'dark', sway: 10, wiggle: true },
  lizard: { name: 'Lizard tail', desc: 'Thick scaly tail.', n: 11, a0: -52, curl: 3, thick: [3, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1], mat: 'skin', sway: 3 },
  mech: { name: 'Mech tail', desc: 'Segmented metal tail with a glowing tip.', n: 11, a0: -75, curl: -9, thick: [2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1], mat: 'met', segments: true, tip: 1, tipMat: 'glowH', sway: 6 },
  fish: { name: 'Fish tail', desc: 'Scaled tail ending in a forked fin.', n: 8, a0: -62, curl: 4, thick: [3, 3, 3, 2, 2, 2, 1, 1], mat: 'skin', fin: true, sway: 6 },
};

const EYE_STYLES = {
  normal: { name: 'Normal', desc: 'Regular eyes.' },
  glowing: { name: 'Glowing', desc: 'White-hot eyes glowing in your eye colour.' },
  angry: { name: 'Angry', desc: 'Scowling brows.' },
  sleepy: { name: 'Sleepy', desc: 'Heavy half-closed lids.' },
  closed: { name: 'Serene', desc: 'Calm closed eyes.' },
  cyclops: { name: 'Cyclops', desc: 'One big central eye.' },
  visor: { name: 'Visor glow', desc: 'A glowing band across the eyes (glow colour).' },
  hetero: { name: 'Heterochromia', desc: 'Two eye colours (second one: "eyes2").' },
};

// Markings are painted on bare skin (head, arms, bare chest/legs) in colors.marking.
const MARKINGS = {
  none: { name: 'None', desc: 'No markings.' },
  tattoos: { name: 'Tattoos', desc: 'Inked sleeve bands and a small chest piece.', color: '#2a3a7a' },
  stripes: { name: 'Stripes', desc: 'Tiger stripes.', color: null },
  spots: { name: 'Spots', desc: 'Leopard-like spots.', color: null },
  runes: { name: 'Glowing runes', desc: 'Luminous runes (glow colour unless colors.marking).', color: 'glow' },
  tribal: { name: 'Tribal', desc: 'Bold tribal bands and chevrons.', color: '#241c2c' },
  scars: { name: 'Scars', desc: 'Old battle scars.', color: 'scar' },
  freckles: { name: 'Freckles', desc: 'Freckled cheeks and shoulders.', color: 'freckle' },
  warpaint: { name: 'War paint', desc: 'A painted band across the eyes and stripes (white unless colors.marking).', color: '#f0ece0' },
};
// head-local [x, y, bright] marks (only painted over skin pixels)
const HEAD_MARKS = {
  tattoos: [[3, 5, 0], [3, 6, 0], [4, 6, 0]],
  stripes: [[1, 1, 0], [2, 1, 0], [0, 3, 0], [1, 3, 0], [0, 5, 0], [1, 5, 0], [5, 1, 0], [6, 2, 0], [8, 5, 0]],
  spots: [[1, 2, 0], [3, 1, 0], [0, 4, 0], [2, 6, 0], [6, 1, 0], [3, 5, 0]],
  runes: [[6, 0, 1], [6, 1, 0], [5, 1, 1], [7, 1, 1], [8, 5, 1], [2, 5, 1]],
  tribal: [[2, 3, 0], [2, 4, 0], [3, 5, 0], [4, 5, 0], [5, 6, 0], [8, 2, 0], [8, 5, 0]],
  scars: [[6, 5, 0], [7, 5, 0], [8, 6, 0], [3, 1, 0], [4, 2, 0]],
  freckles: [[6, 5, 0], [8, 5, 0], [7, 6, 0], [4, 5, 0]],
  warpaint: [[1, 3, 0], [2, 3, 0], [3, 3, 0], [4, 3, 0], [6, 3, 0], [8, 3, 0], [2, 4, 0], [3, 4, 0], [4, 4, 0], [6, 4, 0], [8, 4, 0], [7, 6, 0]],
};

// 5×5 chest emblems: # accent, + highlight, - shadow, w white, D dark
const EMBLEM_MAT = { '#': 'acc', '+': 'accH', '-': 'accL', w: 'white', D: 'dark' };
const EMBLEMS = {
  none: { name: 'None', desc: 'No emblem.' },
  skull: { name: 'Skull', desc: 'A grinning skull.', rows: ['.###.', '#####', '#D#D#', '.###.', '.#.#.'] },
  sun: { name: 'Sun', desc: 'A radiant sun.', rows: ['#.#.#', '.+++.', '#+++#', '.+++.', '#.#.#'] },
  moon: { name: 'Moon', desc: 'A crescent moon.', rows: ['.###.', '##...', '#+...', '##...', '.###.'] },
  star: { name: 'Star', desc: 'A five-pointed star.', rows: ['..#..', '.#+#.', '#####', '.###.', '.#.#.'] },
  flame: { name: 'Flame', desc: 'A burning flame.', rows: ['..#..', '.##+.', '.#++#', '##++#', '.###.'] },
  leaf: { name: 'Leaf', desc: 'A leaf.', rows: ['...##', '..#+#', '.#+#.', '#+#..', '-....'] },
  gear: { name: 'Gear', desc: 'A cog wheel.', rows: ['.#.#.', '#####', '.#D#.', '#####', '.#.#.'] },
  cross: { name: 'Cross', desc: 'A holy cross.', rows: ['..#..', '#####', '..#..', '..#..', '..-..'] },
  eye: { name: 'Eye', desc: 'An all-seeing eye.', rows: ['.....', '.###.', '#wDw#', '.###.', '.....'] },
  crown: { name: 'Crown', desc: 'A royal crown.', rows: ['#.#.#', '#####', '#+#+#', '#####', '.....'] },
  lightning: { name: 'Lightning', desc: 'A lightning bolt.', rows: ['...#.', '..#..', '.####', '..#..', '.#...'] },
  heart: { name: 'Heart', desc: 'A heart.', rows: ['##.##', '#+###', '.###.', '..#..', '.....'] },
};

const GLOVES = {
  none: { name: 'None', desc: 'Whatever the outfit comes with.' },
  leather: { name: 'Leather gloves', desc: 'Plain leather gloves.', hand: 'lea' },
  gauntlets: { name: 'Gauntlets', desc: 'Steel gauntlets with cuffs.', hand: 'met', cuff: 'met' },
  wraps: { name: 'Hand wraps', desc: 'Cloth-wrapped hands.', hand: 'white', cuff: 'white' },
  spiked: { name: 'Spiked gauntlets', desc: 'Gauntlets with knuckle spikes.', hand: 'met', cuff: 'met', spikes: true },
  long: { name: 'Long gloves', desc: 'Elbow-length gloves (secondary colour).', hand: 'sec', fore: 'sec' },
  claws: { name: 'Clawed gloves', desc: 'Dark gloves with sharp claw tips.', hand: 'dark', clawTips: true },
};

const BOOTS = {
  none: { name: 'None', desc: 'Whatever the outfit comes with.' },
  leather: { name: 'Leather boots', desc: 'Sturdy leather boots.', boot: 'lea', bootH: 3, foot: 'lea' },
  armored: { name: 'Armoured greaves', desc: 'Steel greaves and sabatons.', boot: 'met', bootH: 4, foot: 'met' },
  sandals: { name: 'Sandals', desc: 'Strapped sandals, bare toes.', sandals: true },
  fur: { name: 'Fur boots', desc: 'Warm boots with a fur rim.', boot: 'lea', bootH: 3, foot: 'lea', rim: 'white' },
  tall: { name: 'Tall boots', desc: 'Knee-high riding boots.', boot: 'lea', bootH: 99, foot: 'lea', rim: 'leaH' },
  pointed: { name: 'Pointed shoes', desc: 'Curly-toed shoes (primary colour).', boot: 'pri', bootH: 1, foot: 'pri', curl: true },
};

const ACCESSORIES = {
  none: { name: 'None', desc: 'No accessory. "accessory" may also be a list of up to 3.' },
  amulet: { name: 'Amulet', desc: 'A gold chain with a glowing pendant.' },
  pouches: { name: 'Belt pouches', desc: 'Leather pouches on the belt.' },
  sash: { name: 'Sash', desc: 'A diagonal sash (secondary colour) knotted at the hip.' },
  bandolier: { name: 'Bandolier', desc: 'A strap of shells across the chest.' },
  earrings: { name: 'Earrings', desc: 'Gold earrings.' },
  goggles: { name: 'Neck goggles', desc: 'Goggles hanging round the neck.' },
};

const WEAPON_GLOWS = {
  none: { name: 'None', desc: 'A plain weapon.' },
  flame: { name: 'Flame', desc: 'Burning edge and rising embers.', color: '#ff7a2a' },
  frost: { name: 'Frost', desc: 'Icy edge and glittering frost.', color: '#8fe0ff' },
  void: { name: 'Void', desc: 'Dark purple edge and drifting motes.', color: '#8a4ae8' },
  holy: { name: 'Holy', desc: 'Golden radiance and sparkles.', color: '#ffe07a' },
  electric: { name: 'Electric', desc: 'Crackling yellow sparks.', color: '#fff06a' },
  poison: { name: 'Poison', desc: 'Dripping toxic green.', color: '#8cf04a' },
};

// ═════════════════════════════════════════════════════════════════════════════
//  Rig: model (resolved look) → skeleton solve → part rasterisers
// ═════════════════════════════════════════════════════════════════════════════

// Materials (per-pixel, before shading). Exact roles are encoded as 100 + role.
const MAT = { pri: 1, sec: 2, acc: 3, met: 4, lea: 5, skin: 6, hair: 7, dark: 8, white: 9, glow: 10, wood: 11, blade: 12, eye: 13, out: 14, trail: 15, pant: 16, acc2: 17, mark: 18, wglow: 19, alt: 20, eye2: 21, blush: 22 };
const MAT_RAMP = [null, 'pri', 'sec', 'acc', 'met', 'lea', 'skin', 'hair', 'dark', 'white', 'glow', 'wood', 'blade', 'eye', 'out', 'trail', 'pant', 'acc2', 'mark', 'wglow', 'alt', 'eye2', 'blush'];
function matId(m) {
  if (m === null || m === undefined) return 0;
  if (typeof m === 'number') return m;
  if (MAT[m]) return MAT[m];
  if (ROLE[m]) return 100 + ROLE[m];
  return MAT.pri;
}

// Part ids (for separation lines between overlapping parts).
const PT = { tail: 1, cape: 2, wback: 3, armB: 4, legB: 5, legF: 6, skirtB: 7, torso: 8, skirt: 9, off: 10, head: 11, hair: 12, gear: 13, capeF: 14, weapon: 15, armF: 16, hand: 17, shoulder: 18, fx: 19, handB: 20, wingB: 21, back: 22 };

class Part {
  constructor(id, w = N, h = N) { this.id = id; this.m = new Mask(w, h); this.mat = new Uint8Array(w * h); }
  add(x, y, mat) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.m.w || y >= this.m.h) return;
    this.m.add(x, y);
    this.mat[y * this.m.w + x] = matId(mat);
  }
  addMask(mask, mat) { mask.each((x, y) => this.add(x, y, mat)); return this; }
  del(x, y) { this.m.del(x, y); }
}

function roleFor(mat, t, dim) {
  if (mat >= 100) return mat - 100;
  const key = MAT_RAMP[mat] || 'pri';
  return (dim ? DIM : RAMP)[key][t];
}
/** Shade a part by its own silhouette and put it on the canvas. */
function commit(cv, part, { dim = false, over = true, overRole = ROLE.out, flat = false, soft = false, noHi = false, openTop = false } = {}) {
  if (!part.m.n) return;
  if (over) outlineOver(cv, part.m, part.id, overRole);
  const opt = { soft, noHi, openTop };
  part.m.each((x, y) => {
    const mat = part.mat[y * part.m.w + x];
    const t = flat ? 1 : shadeAt(part.m, x, y, opt);
    cv.put(x, y, roleFor(mat, t, dim), part.id);
  });
}

// ── vectors ─────────────────────────────────────────────────────────────────
// Angles use one convention everywhere: 0° = straight down, 90° = forward
// (the way the fighter faces, +x), 180° = straight up, -90° = backwards.
const dirv = (deg) => [Math.sin(deg * DEG), Math.cos(deg * DEG)];
const add2 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const angOf = (dx, dy) => Math.atan2(dx, dy) / DEG;

/** 2-bone IK: shoulder s → target t with bone lengths l1, l2. bend ±1 picks the elbow side;
 *  bend 0 = automatic (elbow hangs low / back). */
function ik2(s, t, l1, l2, bend) {
  if (!bend) {
    const a = ik2(s, t, l1, l2, 1), b = ik2(s, t, l1, l2, -1);
    const sa = a.elbow[1] - a.elbow[0] * 0.35, sb = b.elbow[1] - b.elbow[0] * 0.35;
    return sa >= sb ? a : b;
  }
  let dx = t[0] - s[0], dy = t[1] - s[1];
  let d = Math.hypot(dx, dy);
  const maxd = l1 + l2 - 0.05;
  if (d > maxd) { dx *= maxd / d; dy *= maxd / d; d = maxd; }
  if (d < 0.5) { d = 0.5; dy = 0.5; dx = 0; }
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const base = Math.atan2(dy, dx);
  const ang = base + bend * a;
  const elbow = [s[0] + Math.cos(ang) * l1, s[1] + Math.sin(ang) * l1];
  return { elbow, hand: [s[0] + dx, s[1] + dy] };
}

// ═════════════════════════════════════════════════════════════════════════════
//  Model: everything the rasteriser needs, resolved once per sprite
// ═════════════════════════════════════════════════════════════════════════════

function buildModel(look, weaponId) {
  const base = BASES[look.base] || BASES.human;
  const build = BUILDS[look.build] || BUILDS.average;
  const outfit = OUTFITS[look.outfit] || OUTFITS.tunic;
  const weapon = WEAPONS[weaponId] || WEAPONS.fists;
  const thigh = Math.ceil(base.legs / 2), shin = base.legs - thigh;
  const upper = Math.ceil(base.arms / 2), fore = base.arms - upper;
  const B = {
    thigh, shin, torso: base.torso, upper, fore,
    sw: Math.max(5, base.sw + build.sw), ww: Math.max(4, base.ww + build.ww),
    armW: base.bones ? Math.min(2, build.arm) : build.arm + (base.rock ? 1 : 0),
    legW: base.bones ? 2 : build.leg + (base.rock ? 1 : 0),
    hand: build.hand + (base.bigHands ? 1 : 0),
    hipGap: build.leg >= 3 ? 1 : 1,
  };
  const M = {
    look, base, build, outfit, weapon, weaponId: WEAPONS[weaponId] ? weaponId : 'fists', B,
    head: HEADS[base.head] || HEADS.round,
    hair: HAIR[look.hair] || HAIR.none,
    face: FACES[look.face] || FACES.plain,
    gear: HEADGEAR[look.headgear] || HEADGEAR.none,
    cape: CAPES[look.cape] || CAPES.none,
    shoulders: SHOULDERS[look.shoulders] || SHOULDERS.none,
  };
  if (M.shoulders === SHOULDERS.none && outfit.shoulders && look.shoulders === 'auto') M.shoulders = SHOULDERS[outfit.shoulders];
  // v2 parts: all null unless the look asks for them (older looks render exactly as before)
  const on = (v, T) => (v && v !== 'none' && T[v] ? T[v] : null);
  M.back = on(look.back, BACKS);
  M.backId = M.back ? look.back : null;
  M.tailId = look.tail !== undefined ? look.tail : null;
  M.eyeStyle = look.eyeStyle && look.eyeStyle !== 'normal' && EYE_STYLES[look.eyeStyle] ? look.eyeStyle : null;
  M.mark = on(look.markings, MARKINGS);
  M.markId = M.mark ? look.markings : null;
  M.emblem = on(look.emblem, EMBLEMS);
  M.acc = look.accessory ? [].concat(look.accessory).filter(a => ACCESSORIES[a] && a !== 'none') : null;
  if (M.acc && !M.acc.length) M.acc = null;
  M.wglow = on(look.weaponGlow, WEAPON_GLOWS);
  M.wglowId = M.wglow ? look.weaponGlow : null;
  const G = on(look.gloves, GLOVES), Bo = on(look.boots, BOOTS);
  if (G || Bo) {
    const o = { ...outfit };
    if (G) { o.hand = G.hand; if (G.cuff) o.cuff = G.cuff; if (G.fore) { o.fore = G.fore; o.cuff = null; } o.gloves = G; }
    if (Bo) {
      if (Bo.sandals) { o.boot = null; o.bootH = 0; o.foot = 'lea'; } else { o.boot = Bo.boot; o.bootH = Bo.bootH; o.foot = Bo.foot; }
      o.boots = Bo;
    }
    M.outfit = o;
  }
  M.colors = resolveColors(M);
  return M;
}

const AURA_GLOW = {
  fire: '#ff8a2a', frost: '#7fe0ff', shadow: '#a070ff', holy: '#ffe07a', storm: '#8fd0ff', poison: '#8cf04a',
  electric: '#fff06a', void: '#8a4ae8', blood: '#d0203a', sakura: '#ffa8cc', bubbles: '#8ae8ff', music: '#c8a0ff',
  rainbow: '#ff8ae0', glitch: '#3ff2ff', stars: '#fff0a0', leaves: '#9cd84a', ash: '#c8b8a8', hearts: '#ff6aa0',
};

function defaultPants(primary) {
  const o = toOklch(primary);
  return fromOklch(clamp(o.L * 0.62, 0.22, 0.42), Math.min(o.C * 0.55, 0.06), o.H);
}

function resolveColors(M) {
  const L = M.look, c = L.colors;
  const out = {};
  const set = (key, [h, b, l]) => { out[key + 'H'] = h; out[key] = b; out[key + 'L'] = l; };
  set('skin', ramp(L.skin));
  set('hair', ramp(L.hairColor));
  set('pri', ramp(c.primary));
  set('sec', ramp(c.secondary));
  set('acc', ramp(c.accent));
  set('met', ramp(c.metal));
  set('lea', ramp(L.leather || '#6e4a2e'));
  set('pant', ramp(c.pants || defaultPants(c.primary)));
  set('wood', ramp('#8a5a32'));
  set('blade', ramp(L.weaponColor || '#d4dce6'));
  const glow = c.glow || (L.aura && AURA_GLOW[L.aura] ? AURA_GLOW[L.aura] : c.accent);
  out.glowH = mix(glow, '#ffffff', 0.72);
  out.glow = mix(glow, '#ffffff', 0.25);
  out.glowL = glow;
  const trail = L.trail || (L.aura && AURA_GLOW[L.aura] ? mix(AURA_GLOW[L.aura], '#ffffff', 0.3) : '#dcecff');
  out.trailH = mix(trail, '#ffffff', 0.55);
  out.trail = trail;
  out.eye = L.eyes;
  out.white = '#f6f2ea';
  out.dark = '#2a2230';
  out.skinD = tone(L.skin, -0.24);
  out.priD = tone(c.primary, -0.24);
  out.metD = tone(c.metal, -0.24);
  out.out = mix('#120e18', c.primary, 0.12);
  // v2 roles (only ever painted by v2 parts, so they never change an older sprite)
  set('acc2', ramp(c.accent2 || acc2Default(M)));
  set('mark', ramp(markColor(M, glow)));
  const wg = c.glow || (M.wglow && M.wglow.color) || glow;
  out.wglowH = mix(wg, '#ffffff', 0.72);
  out.wglow = mix(wg, '#ffffff', 0.22);
  out.wglowL = wg;
  set('alt', ramp(altColor(M)));
  out.eye2 = L.eyes2 || (lum(L.eyes) < 0.5 && rgbToHsl(...hexToRgb(L.eyes))[0] > 150 ? '#e8b020' : '#3a8ad8');
  out.blush = mix(L.skin, '#ff4a7a', 0.45);
  return out;
}
/** Default colour of the accent2 ramp: the back item's own colour, else the secondary colour. */
function acc2Default(M) {
  const L = M.look, bk = M.back;
  if (bk) {
    if (M.backId === 'dragon' && (M.base.scales || M.base.horns || M.base.dragonHorns)) return L.skin;
    if (bk.color) return bk.color;
    return L.colors.metal;
  }
  return L.colors.secondary;
}
function markColor(M, glow) {
  const L = M.look;
  if (L.colors.marking) return L.colors.marking;
  const mk = M.mark;
  if (!mk || !mk.color) return tone(L.skin, -0.3);
  if (mk.color === 'glow') return L.colors.glow || '#58d0ff';
  if (mk.color === 'scar') return mix(L.skin, '#f0b0a8', 0.55);
  if (mk.color === 'freckle') return mix(tone(L.skin, -0.2), '#a0522d', 0.35);
  return mk.color;
}
/** The fixed "alt" material: pumpkin > bone armour > skull pauldrons > beak. */
function altColor(M) {
  return (M.gear && M.gear.alt) || (M.outfit && M.outfit.alt) || (M.shoulders && M.shoulders.alt) || M.base.alt || '#e6dcc0';
}

// ═════════════════════════════════════════════════════════════════════════════
//  Skeleton solve
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Pose fields (all optional):
 *  dx, dy       body offset (dy < 0 = airborne)
 *  lean         torso lean in degrees (+ = forward)
 *  legB, legF   [thigh angle, knee bend]
 *  armB, armF   [shoulder angle, elbow bend]  or  handB/handF: [x, y] targets (IK)
 *  gripB        true → the back hand holds the weapon at its second grip
 *  w            weapon angle (0 down, 90 forward, 180 up); wz 'back' draws it behind the body
 *  off          off-hand item angle (second dagger / shield); oz 'back'|'mid'
 *  hdx, hdy     head offset;  face: n blink hurt ko yell happy focus
 *  wave         cape/hair flow (0..2);  fx: [...] effects drawn after the outline
 */
function solve(M, P) {
  const B = M.B;
  const leg = (spec) => {
    const [th, kn] = spec || [0, 0];
    const a = dirv(th), b = dirv(th - kn);
    const knee = [a[0] * B.thigh, a[1] * B.thigh];
    const ank = [knee[0] + b[0] * B.shin, knee[1] + b[1] * B.shin];
    return { knee, ank };
  };
  const lb = leg(P.legB), lf = leg(P.legF);
  const low = Math.max(lb.ank[1], lf.ank[1], lb.knee[1] + 0.2, lf.knee[1] + 0.2);
  const hipY = Math.round(GROUND - 1 - low + (P.dy || 0));
  const hipX = CX + Math.round(P.dx || 0);
  const J = { hip: [hipX, hipY] };
  const gap = B.hipGap;
  J.hipB = [hipX - gap, hipY];
  J.hipF = [hipX + gap, hipY];
  J.kneeB = add2(J.hipB, lb.knee); J.ankB = add2(J.hipB, lb.ank);
  J.kneeF = add2(J.hipF, lf.knee); J.ankF = add2(J.hipF, lf.ank);
  const lean = (P.lean || 0) * DEG;
  J.up = [Math.sin(lean), -Math.cos(lean)];
  J.fwd = [Math.cos(lean), Math.sin(lean)];
  J.lean = P.lean || 0;
  J.neck = add2(J.hip, J.up, B.torso - (P.sq || 0));
  const sh = add2(J.neck, J.up, -1.6);
  J.shF = add2(sh, J.fwd, 0.4);
  J.shB = add2(sh, J.fwd, -1.2);
  // arms
  const arm = (shoulder, spec, target, bend) => {
    if (target) return ik2(shoulder, target, B.upper, B.fore, bend);
    const [t, e] = spec || [0, 0];
    const elbow = add2(shoulder, dirv(t), B.upper);
    return { elbow, hand: add2(elbow, dirv(t + e), B.fore) };
  };
  const tgt = (h) => (h ? [J.neck[0] + h[0], J.neck[1] + h[1]] : null);
  const aF = arm(J.shF, P.armF, P.handF || tgt(P.hF), P.bendF || 0);
  J.elbF = aF.elbow; J.handF = aF.hand;
  J.w = P.w === undefined ? null : P.w;
  let tB = (Array.isArray(P.handB) ? P.handB : null) || tgt(P.hB);
  if (P.gripB && J.w !== null && M.weapon.grip2 !== undefined) tB = add2(J.handF, dirv(J.w), M.weapon.grip2);
  const aB = arm(J.shB, P.armB, tB, P.bendB || 0);
  J.elbB = aB.elbow; J.handB = aB.hand;
  return J;
}

// ═════════════════════════════════════════════════════════════════════════════
//  Part rasterisers
// ═════════════════════════════════════════════════════════════════════════════

function segPixels(part, a, b, w, matFn) {
  const m = lineMask(new Mask(), a[0], a[1], b[0], b[1], w);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  m.each((x, y) => {
    const k = clamp(((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (L * L), 0, 1);
    part.add(x, y, typeof matFn === 'function' ? matFn(k, x, y) : matFn);
  });
}

// ── markings on limbs / torso (v2) ──────────────────────────────────────────
const SKIN_MATS = new Set(['skin', 'skinH', 'skinL']);
const inBand = (k, bands) => bands.some(([a, b]) => k >= a && k <= b);
const LIMB_MARKS = {
  // seg 0 = upper arm / thigh, 1 = forearm / shin: [bands, dotted?, bright?]
  tattoos: [[[0.35, 0.72]], []],
  stripes: [[[0.25, 0.4], [0.65, 0.8]], [[0.2, 0.35], [0.55, 0.7]]],
  spots: [[[0.2, 0.3], [0.65, 0.75]], [[0.4, 0.5]], 'dots'],
  runes: [[[0.45, 0.55]], [[0.5, 0.62]], null, true],
  tribal: [[[0.2, 0.32], [0.5, 0.6]], [[0.3, 0.45]]],
  scars: [[], [[0.4, 0.55]], 'dots'],
  freckles: [[[0.1, 0.3]], [], 'dots'],
  warpaint: [[], [[0.15, 0.4]]],
};
/** Wrap a limb material (fn or string) so bare skin gets the marking pattern. */
function markLimb(M, seg, matFn) {
  const spec = M.mark && LIMB_MARKS[M.markId];
  if (!spec) return matFn;
  return (k, x, y) => {
    const m = typeof matFn === 'function' ? matFn(k, x, y) : matFn;
    if (!SKIN_MATS.has(m)) return m;
    if (!inBand(k, spec[seg])) return m;
    if (spec[2] === 'dots' && ((x + y) & 1)) return m;
    return spec[3] && seg === 0 ? 'markH' : 'mark';
  };
}
/** Marking material for a bare torso pixel (or null). */
function markTorso(M, c) {
  const r = c.row, k = c.col, R = c.rows, K = c.cols;
  if (r >= R - 2) return null;
  switch (M.markId) {
    case 'tattoos': return Math.abs(r - 3) + Math.abs(k - (K - 3)) <= 1 ? 'mark' : null;
    case 'stripes': return (r * 2 + k) % 5 === 0 && k < K - 1 ? 'mark' : null;
    case 'spots': return (k * 7 + r * 13) % 9 === 0 ? 'mark' : null;
    case 'runes': return k === K - 3 && r >= 1 && r <= 4 ? (r % 2 ? 'markH' : 'mark') : (r === 2 && k === 2 ? 'markH' : null);
    case 'tribal': return Math.abs(k - (K - 3)) === r % 4 ? 'mark' : null;
    case 'scars': return k === K - 1 - r && r >= 1 && r <= 5 ? 'mark' : null;
    case 'freckles': return r <= 1 && (k * 3 + r) % 4 === 1 ? 'mark' : null;
    case 'warpaint': return (k === K - 2 || k === K - 4) && r >= 1 && r <= 4 ? 'mark' : null;
    default: return null;
  }
}

function drawLeg(cv, M, J, side, P) {
  const O = M.outfit, B = M.B;
  const hip = side === 'F' ? J.hipF : J.hipB, knee = side === 'F' ? J.kneeF : J.kneeB, ank = side === 'F' ? J.ankF : J.ankB;
  const part = new Part(side === 'F' ? PT.legF : PT.legB);
  if (M.base.dummy) return;
  const Bo = O.boots;
  const bootK = O.bootH && O.boot ? 1 - (Bo ? Math.min(O.bootH, B.shin) : O.bootH) / Math.max(1, B.shin) : 2;
  const bareBody = O.bare && (M.base.bones || M.base.robot || M.base.rock || M.base.bare);
  segPixels(part, hip, knee, B.legW, markLimb(M, 0, bareBody ? 'skin' : (O.thigh || 'pant')));
  const rimK = Bo && Bo.rim ? bootK + 1 / Math.max(1, B.shin) : -1;
  segPixels(part, knee, ank, B.legW, markLimb(M, 1, (k) => (k >= bootK ? (k < rimK ? Bo.rim : O.boot) : (O.shin || O.thigh))));
  // foot: toes forward
  const fx = Math.round(ank[0]), fy = Math.round(ank[1]);
  const len = B.legW >= 3 ? 4 : 3;
  const footMat = O.foot || O.boot || 'skin';
  for (let i = -1; i < len - 1; i++) part.add(fx + i, fy + 1, footMat);
  for (let i = -1; i < len - 2; i++) part.add(fx + i, fy, Bo && Bo.sandals ? (i === 0 ? 'lea' : 'skin') : footMat);
  if (Bo && Bo.curl) { part.add(fx + len - 1, fy, footMat); part.add(fx + len, fy - 1, footMat); }
  if (O.wraps) { part.add(fx, fy - 2, 'priL'); }
  commit(cv, part, { dim: side === 'B' });
}

/** Slime: a gooey mound instead of legs (wobbles while idle / walking). */
function drawBlob(cv, M, J, P) {
  const part = new Part(PT.legF);
  const B = M.B;
  const top = Math.round(J.hip[1]) - 1;
  const bottom = Math.min(GROUND, Math.round(J.hip[1] + B.thigh + B.shin));
  const wob = (P.anim === 'idle' || P.anim === 'walk') ? [0, 1, 0, -1, 0, 1][(P.bob || 0) % 6] : P.anim === 'hurt' ? 1 : 0;
  const cx = J.hip[0] + 0.5;
  for (let y = top; y <= bottom; y++) {
    const k = (y - top) / Math.max(1, bottom - top);
    const half = B.ww / 2 + 0.5 + k * k * (3.5 + wob);
    const x0 = Math.round(cx - half - k * 1.5), x1 = Math.round(cx + half);
    for (let x = x0; x < x1; x++) {
      if (y === bottom && (x === x0 || x === x1 - 1)) continue;
      part.add(x, y, 'skin');
    }
  }
  const hl = Math.round(cx + B.ww / 2 - 1);
  part.add(hl, top + 2, 'white'); part.add(hl + 1, top + 3, 'skinH');
  part.add(Math.round(cx - 2), bottom - 2, 'skinH');
  commit(cv, part, {});
}

/** Ghost: the body fades into a curling wisp instead of legs. */
function drawWisp(cv, M, J, P) {
  const part = new Part(PT.legF);
  const B = M.B;
  const top = Math.round(J.hip[1]) - 1;
  const len = Math.max(4, Math.min(GROUND - 1, Math.round(J.hip[1] + B.thigh + B.shin + 2)) - top);
  const wave = P.wave || 0, ph = (P.bob || 0) * 1.4;
  for (let j = 0; j <= len; j++) {
    const k = j / len;
    const half = (B.ww / 2 + 0.6) * (1 - k * 0.8);
    const cx = J.hip[0] + 0.5 - k * k * (4 + wave * 1.5) + Math.sin(ph + j * 0.7) * 0.9 * k;
    const x0 = Math.round(cx - half), x1 = Math.max(x0 + 1, Math.round(cx + half));
    for (let x = x0; x < x1; x++) part.add(x, top + j, j >= len - 1 ? 'skinL' : 'skin');
  }
  commit(cv, part, {});
}

function drawDummyPost(cv, M, J) {
  const part = new Part(PT.legF);
  const x = J.hip[0];
  for (let y = J.hip[1]; y <= GROUND; y++) { part.add(x, y, 'wood'); part.add(x + 1, y, 'wood'); }
  for (let i = -4; i <= 5; i++) part.add(x + i, GROUND, 'wood');
  for (let i = -3; i <= 4; i++) part.add(x + i, GROUND - 1, i === -3 || i === 4 ? null : 'wood');
  commit(cv, part, {});
}

/** Torso + outfit shader. */
function drawTorso(cv, M, J, P) {
  const B = M.B, O = M.outfit;
  const part = new Part(PT.torso);
  const top = add2(J.neck, J.up, 0), bot = add2(J.hip, J.up, -1);
  const len = B.torso + 1;
  const cxOff = 0.5;
  const q = (p, across) => add2(add2(p, J.fwd, cxOff), J.fwd, across);
  const pts = [q(top, -B.sw / 2 + 0.5), q(top, B.sw / 2 - 0.5), q(add2(top, J.up, -1), B.sw / 2), q(bot, B.ww / 2), q(bot, -B.ww / 2), q(add2(top, J.up, -1), -B.sw / 2)];
  const m = polyMask(new Mask(), pts);
  const rows = len + 1, cols = Math.max(B.sw, B.ww);
  const baseTorso = BASE_TORSO[M.base.bones ? 'skeleton' : M.base.robot ? 'robot' : M.base.rock ? 'golem' : M.base.dummy ? 'dummy' : (M.base.bodyStyle || 'x')];
  const em = M.emblem;
  m.each((x, y) => {
    const rx = x + 0.5 - top[0], ry = y + 0.5 - top[1];
    const along = -(rx * J.up[0] + ry * J.up[1]);
    const across = rx * J.fwd[0] + ry * J.fwd[1] - cxOff;
    const v = clamp(along / len, 0, 1);
    const half = (B.sw + (B.ww - B.sw) * v) / 2;
    const u = clamp(across / Math.max(1, half), -1, 1);
    const row = clamp(Math.floor(along), 0, rows - 1);
    const col = clamp(Math.floor(((u + 1) / 2) * cols), 0, cols - 1);
    const c = { u, v, row, rows, col, cols, x, y, base: { torso: baseTorso } };
    let mat = O.torso(c);
    if (mat === 'skin' && baseTorso && O !== OUTFITS.none) mat = 'skin';
    if (mat === null) return;
    if (M.mark && SKIN_MATS.has(mat)) mat = markTorso(M, c) || mat;
    if (em) {
      const er = Math.floor(along - 1), ec = Math.floor(across + 2);
      const ch = er >= 0 && er < 5 && ec >= 0 && ec < 5 ? em.rows[er][ec] : '.';
      if (ch !== '.') mat = R_(EMBLEM_MAT[ch]);
    }
    part.add(x, y, mat);
  });
  commit(cv, part, { soft: B.sw >= 10 });
}

/** Skirts, robes, coat tails, loincloths. */
function drawSkirt(cv, M, J, P, layer) {
  const S = M.outfit.skirt;
  if (!S || M.base.dummy) return;
  const back = !!S.back;
  if ((layer === 'back') !== back && !(layer === 'back' && S.front)) return;
  const part = new Part(layer === 'back' ? PT.skirtB : PT.skirt);
  const B = M.B;
  const top = J.hip[1] + 1;
  const cx = J.hip[0] + 0.5 + J.fwd[0] * 0.5;
  let bottom;
  if (S.len === 'long') bottom = Math.max(J.ankB[1], J.ankF[1]) - 0.5;
  else bottom = top + S.len;
  bottom = Math.min(bottom, GROUND - 1);
  const minFoot = Math.min(J.ankB[0], J.ankF[0]), maxFoot = Math.max(J.ankB[0], J.ankF[0]);
  const wave = (P.wave || 0);
  for (let y = Math.round(top); y <= Math.round(bottom); y++) {
    const k = (y - top) / Math.max(1, bottom - top);
    let x0 = cx - B.ww / 2 - S.flare * k, x1 = cx + B.ww / 2 + S.flare * k;
    if (S.len === 'long') {
      x0 = Math.min(x0, minFoot - 1.5 * k);
      x1 = Math.max(x1, maxFoot + 2.5 * k);
    }
    if (back) { x1 = cx - 1; x0 -= wave * k * 2 + 1; }
    if (layer === 'back' && S.front) { x1 = cx; }
    if (!back && S.front && layer !== 'back') { x0 = cx - 1; }
    for (let x = Math.round(x0); x <= Math.round(x1) - 1; x++) {
      let mat = S.mat;
      if (layer === 'back' && S.front) mat = S.backMat || S.mat;
      if (y === Math.round(bottom) && S.hem) mat = S.hem;
      if (S.jagged && y === Math.round(bottom) && (x & 1)) continue;
      if (S.chain) mat = ((x + y) & 1) ? 'met' : 'metL';
      if (S.trim && Math.abs(x - (x1 - 2)) < 0.6 && y < Math.round(bottom)) mat = S.trim;
      if (S.plates && y === Math.round(top)) mat = S.plates;
      part.add(x, y, mat);
    }
  }
  commit(cv, part, { dim: layer === 'back' && back, over: back, openTop: true });
}

function drawArm(cv, M, J, side, P) {
  const O = M.outfit, B = M.B;
  const sh = side === 'F' ? J.shF : J.shB, el = side === 'F' ? J.elbF : J.elbB, hd = side === 'F' ? J.handF : J.handB;
  const part = new Part(side === 'F' ? PT.armF : PT.armB);
  if (M.base.dummy) {
    const y = Math.round(J.shF[1]);
    for (let x = J.hip[0] - 7; x <= J.hip[0] + 8; x++) { part.add(x, y, 'wood'); if (x < J.hip[0] - 5 || x > J.hip[0] + 6) part.add(x, y + 1, 'skin'); }
    commit(cv, part, {});
    return;
  }
  const w = B.armW + (O.wideSleeves && side === 'F' ? 0 : 0);
  segPixels(part, sh, el, w, markLimb(M, 0, O.upper));
  segPixels(part, el, hd, w, markLimb(M, 1, (k) => (O.cuff && k > 0.72 ? O.cuff : O.fore)));
  if (O.chainArms) part.m.each((x, y) => { if (part.mat[y * N + x] === MAT.met && ((x + y) & 1)) part.mat[y * N + x] = 100 + ROLE.metL; });
  commit(cv, part, { dim: side === 'B' });
}

function drawHand(cv, M, J, side, P, { fist = true } = {}) {
  const O = M.outfit, B = M.B;
  if (M.base.dummy) return;
  const hd = side === 'F' ? J.handF : J.handB;
  const part = new Part(side === 'F' ? PT.hand : PT.handB);
  const W = M.weapon;
  const s = B.hand + (W.handGrow || 0);
  const hmat = (O.gloves && O.hand) || W.handMat || O.hand;
  const x0 = Math.round(hd[0] - (s - 1) / 2), y0 = Math.round(hd[1] - (s - 1) / 2);
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) part.add(x0 + i, y0 + j, j === 0 && W.handMat && s >= 3 ? O.hand : hmat);
  if (s >= 3) part.del(x0, y0 + s - 1);
  if (O.gloves && O.gloves.spikes) { part.add(x0 + s, y0, R_('white')); part.add(x0 + s - 1, y0 - 1, R_('white')); }
  if (O.gloves && O.gloves.clawTips) { part.add(x0 + s, y0, R_('white')); part.add(x0 + s, y0 + s - 1, R_('white')); }
  commit(cv, part, { dim: side === 'B', over: true });
}

// ── head ────────────────────────────────────────────────────────────────────
function headOrigin(M, J, P) {
  const H = M.head;
  return [Math.round(J.neck[0] + 0.5 - H.neck + (P.hdx || 0)), Math.round(J.neck[1] - H.mask.length + 2 + (P.hdy || 0))];
}

/** v2 eye styles and the special eyes of v2 bases. Returns true when it drew the eyes. */
function eyesV2(cv, M, ox, oy, face) {
  const H = M.head, pt = PT.head, E = ROLE.eye, D = ROLE.dark, W = ROLE.white;
  const st = M.eyeStyle, b = M.base;
  const put = (x, y, r) => cv.put(ox + x, oy + y, r, pt);
  const [[x0, y0], [x1, y1]] = H.eyes;
  const shut = face === 'blink' || face === 'ko';
  if (st === 'cyclops') {
    const cx = Math.round((x0 + x1) / 2), cy = y0;
    if (shut || face === 'happy') { for (let i = -1; i <= 1; i++) put(cx + i, cy + 1, D); return true; }
    for (let i = -1; i <= 1; i++) { put(cx + i, cy, W); put(cx + i, cy + 1, W); }
    put(cx, cy, E); put(cx, cy + 1, face === 'hurt' ? D : E);
    if (face === 'yell' || face === 'focus') for (let i = -1; i <= 1; i++) put(cx + i, cy - 1, D);
    return true;
  }
  if (st === 'visor') {
    for (let x = x0 - 2; x <= x1 + 1; x++) { put(x, y0, face === 'ko' ? D : (x >= x1 ? ROLE.glowH : ROLE.glow)); put(x, y0 + 1, face === 'ko' || face === 'hurt' ? D : ROLE.glowL); }
    return true;
  }
  if (b.bugEyes && !st) {
    if (shut) { put(x1, y1 + 1, D); put(x1 + 1, y1 + 1, D); put(x0, y0 + 1, D); return true; }
    put(x1, y1 - 1, E); put(x1 + 1, y1 - 1, W); put(x1, y1, E); put(x1 + 1, y1, E); put(x1, y1 + 1, E); put(x1 + 1, y1 + 1, E);
    put(x0, y0, E); put(x0, y0 + 1, E);
    return true;
  }
  if (b.alienEyes && !st) {
    if (shut) { put(x1 - 1, y1 + 1, D); put(x1, y1 + 1, D); put(x1 + 1, y1, D); put(x0, y0 + 1, D); return true; }
    put(x1 - 1, y1 + 1, E); put(x1, y1, E); put(x1 + 1, y1, E); put(x1, y1 + 1, E); put(x1 + 1, y1 - 1, E); put(x1, y1 - 1, face === 'hurt' ? E : W);
    put(x0, y0, E); put(x0, y0 + 1, E); put(x0 - 1, y0 + 1, E);
    return true;
  }
  if (!st || b.robot || b.head === 'skull') return false;
  H.eyes.forEach(([ex, ey], k) => {
    const x = ex, y = ey;
    const col = st === 'hetero' && k === 0 ? ROLE.eye2 : E;
    switch (face) {
      case 'blink': case 'ko':
        put(x, y + 1, D); if (k === 0) put(x - 1, y + 1, D);
        return;
      case 'hurt':
        put(x, y, D); put(x + (k === 0 ? -1 : 0), y + 1, D);
        return;
      case 'happy':
        put(x, y, D); if (k === 0) put(x - 1, y + 1, D);
        return;
      default: break;
    }
    if (st === 'closed') { put(x, y + 1, D); put(x - 1, y, D); return; }
    if (st === 'sleepy') { put(x, y, ROLE.skinL); put(x, y + 1, col); if (k === 0) put(x - 1, y + 1, W); return; }
    if (st === 'angry' || face === 'yell') { put(x, y, D); put(x, y + 1, col); put(x - 1, y - 1, D); if (k === 0) put(x - 1, y + 1, W); return; }
    if (st === 'glowing') { put(x, y, W); put(x, y + 1, col); if (k === 0) put(x - 1, y, col); else put(x + 1, y, col); return; }
    put(x, y, col); put(x, y + 1, col);
    if (k === 0 && !b.glowEyes) put(x - 1, y, W);
  });
  if (H.mouth && (face === 'yell' || face === 'hurt' || face === 'happy')) {
    const [mx, my] = H.mouth;
    put(mx, my, face === 'happy' ? ROLE.skinL : D);
    if (face === 'yell') put(mx + 1, my, D);
  }
  return true;
}

const SKIN_ROLES = new Set([ROLE.skin, ROLE.skinH, ROLE.skinL, ROLE.skinD]);
function headMarks(cv, M, ox, oy) {
  for (const [x, y, br] of HEAD_MARKS[M.markId] || []) {
    const X = ox + x, Y = oy + y;
    if (SKIN_ROLES.has(cv.get(X, Y)) && cv.part(X, Y) === PT.head) cv.put(X, Y, br ? ROLE.markH : ROLE.mark, PT.head);
  }
}

// mushroom cap (hair ramp + white spots), head-local
const CAP_ROWS = [
  '....hhhhH....',
  '..hhhwhhhHH..',
  '.hwhhhhhhwHH.',
  'hhhhhhwhhhhHH',
  'hhhwhhhhhhhhH',
  '.dddddddddddd',
];

function eyes(cv, M, ox, oy, face) {
  const H = M.head;
  if (!H.eyes) return;
  if ((M.eyeStyle || M.base.bugEyes || M.base.alienEyes) && eyesV2(cv, M, ox, oy, face)) return;
  const P = PT.head;
  const E = ROLE.eye, D = ROLE.dark, Z = ROLE.skinL;
  const skull = M.base.head === 'skull';
  H.eyes.forEach(([ex, ey], k) => {
    const x = ox + ex, y = oy + ey;
    if (skull) {
      cv.put(x, y, D, P); cv.put(x, y + 1, D, P);
      if (k === 0) { cv.put(x - 1, y, D, P); cv.put(x - 1, y + 1, D, P); }
      if (face !== 'ko' && face !== 'hurt') cv.put(x, y, E, P);
      return;
    }
    if (M.base.robot) {
      if (k === 0) for (let i = -2; i <= 3; i++) { cv.put(x + i, y, D, P); cv.put(x + i, y + 1, D, P); }
      if (face === 'ko') return;
      cv.put(x, y, E, P); cv.put(x + 2, y, E, P);
      if (face !== 'hurt') { cv.put(x, y + 1, E, P); cv.put(x + 2, y + 1, E, P); }
      return;
    }
    switch (face) {
      case 'blink': case 'ko':
        cv.put(x, y + 1, D, P);
        if (k === 0) cv.put(x - 1, y + 1, D, P);
        break;
      case 'hurt':
        cv.put(x, y, D, P); cv.put(x + (k === 0 ? -1 : 0), y + 1, D, P);
        break;
      case 'happy':
        cv.put(x, y, D, P);
        if (k === 0) { cv.put(x - 1, y + 1, D, P); }
        break;
      case 'yell':
        cv.put(x, y, E, P); cv.put(x, y + 1, E, P);
        cv.put(x - 1, y - 1, D, P); if (k === 1) cv.put(x, y - 1, D, P);
        break;
      default:
        cv.put(x, y, E, P); cv.put(x, y + 1, E, P);
        if (k === 0 && !M.base.glowEyes) cv.put(x - 1, y, ROLE.white, P);
    }
  });
  if (H.mouth && (face === 'yell' || face === 'hurt' || face === 'happy')) {
    const [mx, my] = H.mouth;
    cv.put(ox + mx, oy + my, face === 'happy' ? Z : D, PT.head);
    if (face === 'yell') cv.put(ox + mx + 1, oy + my, D, PT.head);
  }
}

function drawHeadExtras(cv, M, ox, oy, P, phase) {
  const b = M.base, pt = PT.head;
  const put = (x, y, r) => cv.put(ox + x, oy + y, r, pt);
  const S = ROLE.skin, SH = ROLE.skinH, SL = ROLE.skinL;
  if (phase === 'under') {
    if (b.ears === 'round') { put(2, 4, SL); put(2, 5, SL); put(3, 5, SL); }
    if (b.ears === 'bolt') { put(0, 3, ROLE.metL); put(0, 4, ROLE.met); put(0, 5, ROLE.metL); }
    if (b.tusks) { put(7, 6, ROLE.white); put(7, 5, ROLE.white); }
    if (b.brow) { for (let x = 4; x <= 8; x++) put(x, 2, SL); }
    if (b.nose) { put(9, 3, S); put(9, 4, S); put(10, 4, SL); put(9, 5, SL); }
    if (b.muzzle) { put(9, 4, S); put(9, 5, SL); put(8, 6, SL); put(10, 4, ROLE.dark); }
    if (b.stitches) { put(6, 1, ROLE.dark); put(5, 2, ROLE.skinH); put(7, 2, ROLE.dark); put(3, 6, ROLE.dark); put(4, 7, ROLE.dark); }
    if (b.rock) { put(3, 1, SL); put(4, 2, SL); put(1, 3, SL); put(6, 4, SL); }
    if (b.dummy) { put(3, 5, ROLE.dark); put(5, 5, ROLE.dark); put(7, 5, ROLE.dark); put(4, 6, SL); put(6, 6, SL); }
    if (b.head === 'skull') { put(6, 5, ROLE.dark); for (let x = 4; x <= 7; x++) put(x, 6, (x & 1) ? ROLE.white : ROLE.dark); }
    if (b.head === 'snout') { put(10, 3, ROLE.dark); for (let x = 6; x <= 10; x++) put(x, 5, SL); }
    if (b.scales) { put(2, 2, SL); put(4, 1, SL); put(1, 4, SL); put(3, 6, SL); }
    // v2 bases
    if (b.beak) { put(9, 3, ROLE.altH); put(9, 4, ROLE.alt); put(10, 4, ROLE.alt); put(9, 5, ROLE.altL); put(8, 5, ROLE.altL); }
    if (b.frog) { for (let x = 5; x <= 9; x++) put(x, 4, SL); put(9, 3, SL); put(2, 2, SL); put(6, 5, SH); }
    if (b.mandibles) { put(9, 5, ROLE.dark); put(9, 6, SL); put(8, 7, ROLE.dark); }
    if (b.catNose) { put(8, 4, ROLE.blush); put(7, 5, SL); }
    if (b.slime) { put(6, 1, ROLE.white); put(7, 1, SH); put(2, 5, SH); }
    if (b.ghost) { put(6, 6, ROLE.dark); put(1, 5, SL); }
    if (b.crystal) { put(2, 3, SH); put(3, 5, SL); put(6, 1, SH); put(4, 2, SL); }
    if (b.head === 'dome') { put(3, 1, SH); put(2, 2, SH); }
    if (b.flame) { put(3, 6, SH); put(6, 6, SL); }
  } else {
    // things that poke out over the hair
    if (b.ears === 'elf') { put(2, 4, S); put(1, 3, S); put(0, 2, SH); put(1, 4, SL); put(-1, 1, SH); }
    if (b.ears === 'goblin') { put(2, 4, S); put(1, 4, S); put(0, 4, SL); put(1, 3, S); put(0, 3, S); put(-1, 3, SH); put(-2, 2, SH); put(-1, 4, SL); }
    if (b.ears === 'beast') {
      for (const ex of [1, 5]) { put(ex, -1, S); put(ex + 1, -1, SH); put(ex + 2, -1, S); put(ex, -2, S); put(ex + 1, -2, ROLE.skinH); put(ex, -3, SH); put(ex + 1, -1, SL); }
    }
    if (b.horns) { put(2, -1, ROLE.dark); put(1, -2, ROLE.dark); put(1, -3, ROLE.white); put(6, -1, ROLE.dark); put(7, -2, ROLE.dark); put(8, -3, ROLE.white); }
    if (b.crest) { put(0, 0, ROLE.acc); put(1, -1, ROLE.accH); put(-1, 1, ROLE.acc); put(3, -1, ROLE.acc); put(2, -1, ROLE.accL); }
    if (b.robot) { put(4, -1, ROLE.metL); put(4, -2, ROLE.met); put(4, -3, ROLE.glow); }
    // v2 bases
    if (b.ears === 'cat') for (const ex of [1, 5]) { put(ex, -1, S); put(ex + 1, -1, S); put(ex + 2, -1, SL); put(ex, -2, S); put(ex + 1, -2, ROLE.blush); put(ex + 2, -2, SL); put(ex + 1, -3, SH); }
    if (b.beak) { put(3, -1, ROLE.hair); put(2, -1, ROLE.hair); put(1, -2, ROLE.hairH); put(0, -2, ROLE.hair); put(-1, -3, ROLE.hairH); put(1, -1, ROLE.hairL); put(-1, -1, ROLE.hairL); }
    if (b.antennae) { put(6, -1, ROLE.dark); put(7, -2, ROLE.dark); put(8, -3, SH); put(4, -1, ROLE.dark); put(4, -2, ROLE.dark); put(3, -3, SH); }
    if (b.dragonHorns) { put(3, 0, ROLE.dark); put(2, -1, ROLE.dark); put(1, -1, ROLE.dark); put(0, -2, ROLE.white); put(5, -1, ROLE.dark); put(4, -2, ROLE.dark); put(3, -3, ROLE.white); }
    if (b.crystal) { put(3, -1, SH); put(3, -2, ROLE.white); put(6, -1, S); put(6, -2, SH); put(7, -3, ROLE.white); put(1, 0, SH); }
    if (b.cap) stamp(cv, CAP_ROWS, ox - 2, oy - 4, pt);
  }
}

function hairRows(M) {
  const g = M.gear;
  const hr = M.hair;
  if (!hr || !hr.rows) return null;
  if (g && g.hair === 'none') return null;
  return hr;
}

function drawHairTemplate(cv, M, ox, oy, P, mode) {
  const hr = hairRows(M);
  if (!hr) return;
  const g = M.gear;
  const onlyBack = g && g.hair === 'back';
  const wave = P.wave || 0;
  const rows = hr.frames ? hr.frames[(P.bob || 0) % hr.frames.length] : hr.rows;
  rows.forEach((row, j) => {
    const hy = hr.oy + j; // head-local y
    const flow = hr.flow !== undefined && j >= hr.flow ? -Math.round(wave * (j - hr.flow + 1) / 3) : 0;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      const hx = hr.ox + i;
      if (onlyBack && (hy < 2 || hx > 4)) continue;
      const role = CHAR_ROLE[ch];
      cv.put(ox + hx + flow, oy + hy, role, PT.hair);
    }
  });
}

function drawHead(cv, M, J, P) {
  const H = M.head;
  const [ox, oy] = headOrigin(M, J, P);
  const face = P.face || 'n';
  // skin
  const m = templateMask(H.mask, ox, oy);
  const part = new Part(PT.head).addMask(m, 'skin');
  commit(cv, part, { over: true });
  drawHeadExtras(cv, M, ox, oy, P, 'under');
  eyes(cv, M, ox, oy, face);
  if (M.mark) headMarks(cv, M, ox, oy);
  // face accessories under the hair
  const F = M.face;
  const late = F === FACES.visor || F === FACES.eyepatch || F.over || F.late;
  if (F.rows && !late) stamp(cv, F.rows, ox + F.ox, oy + F.oy, PT.head);
  if (M.base.face && M.look.face === 'plain' && M.look.baseFace !== false) {
    const bf = FACES[M.base.face];
    if (bf && bf.rows) stamp(cv, bf.rows, ox + bf.ox, oy + bf.oy, PT.head);
  }
  drawHairTemplate(cv, M, ox, oy, P);
  if (F.rows && late) stamp(cv, F.rows, ox + F.ox, oy + F.oy, PT.head);
  drawHeadExtras(cv, M, ox, oy, P, 'over');
  if (M.acc && M.acc.includes('earrings') && H.ear) {
    cv.put(ox + H.ear[0], oy + H.ear[1] + 2, ROLE.acc, PT.head);
    cv.put(ox + H.ear[0], oy + H.ear[1] + 3, ROLE.accH, PT.head);
  }
  // headgear
  const g = M.gear;
  if (g && g.rows) {
    const bob = g.float ? ((P.bob || 0) & 1) : 0;
    stamp(cv, g.rows, ox + g.ox, oy + g.oy - bob, g.float ? PT.fx : PT.gear, { map: g.gold ? null : null });
  }
  J.headBox = [ox, oy, ox + H.mask[0].length - 1, oy + H.mask.length - 1];
}

// ── capes, tails, shoulders ─────────────────────────────────────────────────
function drawCape(cv, M, J, P, layer) {
  const C = M.cape;
  if (!C || C === CAPES.none) return;
  const B = M.B;
  const wave = P.wave || 0;
  if (C.scarf) {
    const part = new Part(layer === 'back' ? PT.cape : PT.capeF);
    const nx = J.neck[0] + 0.5, ny = J.neck[1] + 1;
    if (layer === 'back') {
      for (let i = 0; i < 8; i++) {
        const x = nx - 2 - i * (0.7 + wave * 0.25), y = ny + i * (0.9 - wave * 0.35) + Math.sin(i * 1.3 + wave * 2) * 0.6;
        part.add(x, y, 'acc'); part.add(x, y + 1, 'acc');
        if (i > 3) { const x2 = x + 1, y2 = y + 2; part.add(x2, y2, 'accL'); }
      }
      commit(cv, part, { dim: true });
    } else {
      for (let i = -Math.round(B.sw / 2); i <= Math.round(B.sw / 2) - 1; i++) { part.add(nx + i, ny, 'acc'); part.add(nx + i, ny + 1, i > 0 ? 'acc' : 'accL'); }
      commit(cv, part, {});
    }
    return;
  }
  if (C.mantle) {
    const part = new Part(layer === 'front' ? PT.capeF : PT.cape);
    const nx = J.neck[0] + 0.5, ny = J.neck[1] + 1;
    const hw = Math.round(B.sw / 2) + 1;
    if (layer === 'back') {
      for (let y = ny; y <= ny + 4; y++) for (let x = Math.round(nx - hw - 1 - (y - ny) * 0.3); x <= nx - 1; x++) if (!(y === ny + 4 && (x & 1))) part.add(x, y, 'sec');
      commit(cv, part, { dim: true, over: false });
      return;
    }
    for (let i = -hw; i <= hw - 1; i++) {
      part.add(nx + i, ny, 'sec'); part.add(nx + i, ny + 1, 'sec');
      if ((i & 1) === 0) part.add(nx + i, ny + 2, 'secL');
    }
    part.add(nx - hw, ny - 1, 'secH'); part.add(nx + hw - 1, ny - 1, 'secH');
    commit(cv, part, {});
    return;
  }
  if (layer === 'front') {
    // clasp at the throat
    const part = new Part(PT.capeF);
    const nx = Math.round(J.neck[0] + 0.5), ny = Math.round(J.neck[1] + 1);
    part.add(nx - 1, ny - 1, 'sec'); part.add(nx, ny - 1, 'sec'); part.add(nx + 1, ny - 1, 'secH');
    part.add(nx + 1, ny, 'acc');
    commit(cv, part, {});
    return;
  }
  const part = new Part(PT.cape);
  const top = Math.round(J.neck[1] + 1);
  const bottom = C.len === 'long' ? GROUND - 1 : Math.round(J.hip[1] + 1);
  const x0top = J.neck[0] + 0.5 - B.sw / 2 - 0.5, x1top = J.neck[0] + 1.5;
  for (let y = top; y <= bottom; y++) {
    const k = (y - top) / Math.max(1, bottom - top);
    const flow = wave * k * (C.len === 'long' ? 4 : 2.5);
    const x0 = x0top - (C.len === 'long' ? 3.5 : 2) * k - flow - (Math.sin(y * 0.9 + wave * 3) * 0.5 * wave);
    const x1 = x1top - flow * 0.6 + k * 0.5;
    for (let x = Math.round(x0); x <= Math.round(x1); x++) {
      if (C.jagged && y >= bottom - 1 && ((x + (y === bottom ? 0 : 1)) % 3 === 0)) continue;
      if (C.feathers && y >= bottom - 1 && ((x + (y === bottom ? 0 : 1)) & 1)) continue;
      const edge = x === Math.round(x1);
      let mat = edge ? 'secL' : 'sec';
      if (C.ermine && (y >= bottom - 1 || x <= Math.round(x0) + 1)) mat = (x * 3 + y * 2) % 7 === 0 ? 'dark' : 'white';
      else if (C.feathers && !edge && (y - top) % 3 === 2 && ((x + y) & 1)) mat = 'secL';
      else if (C.stars && !edge) { const h = ((x - Math.round(x0)) * 7 + (y - top) * 13) % 23; if (h === 0) mat = 'white'; else if (h === 11) mat = 'accH'; }
      part.add(x, y, mat);
    }
  }
  if (C.collar) {
    // stiff collar rising behind the head
    const cx = J.neck[0] + 0.5 - B.sw / 2;
    for (let j = 1; j <= 5; j++) for (let i = 0; i <= 2 + (j >> 1); i++) part.add(cx - i + 1, top - j, i === 0 ? 'secL' : 'sec');
  }
  commit(cv, part, { over: false });
}

/** v2 tails: a swaying chain of discs from the lower back. */
function drawTailV2(cv, M, J, P) {
  const T = TAILS[M.tailId];
  if (!T || !T.n) return;
  const part = new Part(PT.tail);
  const own = M.look.colors.accent2 ? 'acc2' : null;
  const mat = own || T.mat;
  const ph = (P.bob || 0) * 1.3 + (P.wave || 0);
  let x = J.hip[0] - M.B.ww / 2 + 1, y = J.hip[1] - 1;
  let a = T.a0 + (T.wiggle ? Math.sin(ph) * T.sway * 0.6 : 0);
  const pts = [];
  for (let i = 0; i < T.n; i++) {
    pts.push([x, y, a]);
    a += T.curl + (T.sway || 0) * Math.sin(ph + i * 0.55) * (i / T.n) * (T.wiggle ? 0.5 : 0.25);
    const d = dirv(a);
    x += d[0]; y += d[1];
  }
  pts.forEach(([px, py], i) => {
    const t = T.thick[i] || 1;
    const tip = T.tip && i >= T.n - T.tip;
    let m = tip ? T.tipMat : mat;
    if (T.segments && !tip && i % 3 === 2) m = own ? 'acc2L' : 'metL';
    const r0 = -Math.floor((t - 1) / 2), r1 = Math.ceil((t - 1) / 2);
    for (let dy = r0; dy <= r1; dy++) for (let dx = r0; dx <= r1; dx++) {
      if (t >= 4 && Math.abs(dx - 0.5) + Math.abs(dy - 0.5) > 2.2) continue;
      part.add(px + dx, py + dy, m);
    }
  });
  const [ex, ey, ea] = pts[pts.length - 1];
  const d = dirv(ea), n = [d[1], -d[0]];
  if (T.spikes) pts.forEach(([px, py, pa], i) => {
    if (i % 2 || i > T.n - 3) return;
    const dd = dirv(pa); let nn = [dd[1], -dd[0]];
    if (nn[1] > 0) nn = [-nn[0], -nn[1]];
    const s = (T.thick[i] || 1) / 2 + 0.6;
    part.add(px + nn[0] * s, py + nn[1] * s, own ? 'acc2H' : 'accL');
  });
  if (T.spade) {
    const sm = T.spadeMat || mat;
    const c = [ex + d[0], ey + d[1]];
    part.add(c[0], c[1], sm); part.add(c[0] + n[0], c[1] + n[1], sm); part.add(c[0] - n[0], c[1] - n[1], sm);
    part.add(c[0] + d[0], c[1] + d[1], sm); part.add(c[0] + d[0] * 2, c[1] + d[1] * 2, sm);
  }
  if (T.fin) {
    for (let k = 1; k <= 3; k++) {
      part.add(ex + d[0] * k + n[0] * k, ey + d[1] * k + n[1] * k, k === 3 ? mat + 'H' : mat);
      part.add(ex + d[0] * k - n[0] * k, ey + d[1] * k - n[1] * k, k === 3 ? mat + 'H' : mat);
    }
  }
  commit(cv, part, { over: false });
}

function drawTail(cv, M, J, P) {
  if (M.tailId !== null) { drawTailV2(cv, M, J, P); return; }
  const t = M.base.tail;
  if (!t) return;
  const part = new Part(PT.tail);
  const wave = P.wave || 0;
  const hx = J.hip[0] - M.B.ww / 2 + 1, hy = J.hip[1];
  if (t === 'lizard') {
    for (let i = 0; i < 9; i++) {
      const x = hx - i * 0.9 - wave * i * 0.15, y = hy + i * 0.85 + Math.sin(i * 0.8 + (P.bob || 0)) * 0.3;
      const w = i < 4 ? 3 : i < 7 ? 2 : 1;
      for (let k = 0; k < w; k++) part.add(x, y + k - 1, 'skin');
    }
  } else if (t === 'fluffy') {
    const pts = [[0, 0], [-1, -1], [-2, -2], [-3, -4], [-3, -6], [-2, -7]];
    pts.forEach(([dx, dy], i) => {
      const x = hx + dx - wave * (i > 2 ? 1 : 0), y = hy + dy;
      part.add(x, y, 'hair'); part.add(x - 1, y, 'hair'); if (i > 1) part.add(x + 1, y, 'hair');
      if (i === pts.length - 1) { part.add(x, y - 1, 'hairH'); part.add(x - 1, y, 'hairH'); }
    });
  } else if (t === 'demon') {
    const pts = [[0, 1], [-1, 2], [-2, 3], [-3, 3], [-4, 2], [-5, 1], [-5, 0]];
    pts.forEach(([dx, dy], i) => part.add(hx + dx - (i > 3 ? wave : 0), hy + dy, 'skinL'));
    const [ex, ey] = pts[pts.length - 1];
    const tx = hx + ex - wave, ty = hy + ey;
    part.add(tx, ty - 1, 'dark'); part.add(tx - 1, ty - 1, 'dark'); part.add(tx + 1, ty - 1, 'dark'); part.add(tx, ty - 2, 'dark');
  }
  commit(cv, part, { over: false });
}

// ── back items (v2): wings, jetpack, quiver, backpack, sword, banner ──────────
// Geometry is authored in a body frame (bx = distance behind the back, by = up), anchored
// between the shoulder blades, so everything follows lean, jumps and the KO rotation.
const FLAP = { idle: [0, 1, 1, 0], walk: [1, 2, 1, 0, 1, 2], attack: [1, 0, 2, 2], cast: [1, 2, 2], dash: [-1, -1], hurt: [2, 1], ko: [0, 0, -1, -1], victory: [1, 2, 2, 1], block: [0, 0] };
const FLAP_ROT = { '-1': -38, 0: -16, 1: 0, 2: 16 };
const WING_POLY = {
  feather: [[0, 1], [2, 5], [4, 8], [6, 10], [9, 10.5], [12, 9], [11, 6.5], [9.5, 5.5], [10, 3.5], [8, 3], [7.5, 1.2], [5.5, 0.8], [4.5, -1], [2, -1.2], [0, -2.5]],
  membrane: [[0, 1], [4, 8], [8, 11], [8, 7.5], [11, 7], [8.5, 3.5], [10, 2], [5, 0.5], [1, -3]],
  fairyA: [[0, 0.5], [1, 4], [3, 8], [6, 10], [8, 9.5], [7.5, 6], [4, 2]],
  fairyB: [[0, -1], [3, -1], [6, -3.5], [6, -5.5], [4, -5.5], [1, -3]],
};
function drawBack(cv, M, J, P, layer) {
  const bk = M.back;
  const isWing = !!bk.wing;
  if (layer === 'far' && !isWing) return;
  const B = M.B;
  const fl = FLAP[P.anim] || [0];
  const flap = M.base.dummy ? 0 : fl[(P.bob || 0) % fl.length];
  const A0 = add2(add2(J.neck, J.fwd, 1.5 - B.sw / 2), J.up, -2);
  const A = layer === 'far' ? add2(add2(A0, J.fwd, 3), J.up, 1) : A0;
  const part = new Part(layer === 'far' ? PT.wingB : PT.back);
  const rot = (FLAP_ROT[flap] || 0) * DEG, cr = Math.cos(rot), sr = Math.sin(rot);
  const S = bk.big ? 1.2 : 1;
  // body frame -> screen (optionally rotated by the flap around the root)
  const pt = (bx, by, flapIt = true) => {
    let x = bx * S, y = by * S;
    if (flapIt) { const nx = x * cr - y * sr, ny = x * sr + y * cr; x = nx; y = ny; }
    return [A[0] - J.fwd[0] * x + J.up[0] * y, A[1] - J.fwd[1] * x + J.up[1] * y];
  };
  const poly = (pts, mat) => { const m = polyMask(new Mask(), pts.map(([x, y]) => pt(x, y))); part.addMask(m, mat); return m; };
  const line = (a, b, mat, w = 1) => { const p = pt(...a), q = pt(...b); lineMask(new Mask(), p[0], p[1], q[0], q[1], w).each((x, y) => part.add(x, y, mat)); };
  const dot = (bx, by, mat, flapIt = true) => { const p = pt(bx, by, flapIt); part.add(p[0], p[1], mat); };
  if (bk.wing === 'feather') {
    const m = poly(WING_POLY.feather, 'acc2');
    // feather rows: short darker strokes toward the trailing edge
    m.each((x, y) => { if (m.has(x, y - 1) && m.has(x, y - 2) && !m.has(x + 1, y + 1) && ((x + y) & 1)) part.add(x, y, 'acc2L'); });
    line([0.5, 0.5], [6, 9.5], 'acc2H');
  } else if (bk.wing === 'membrane') {
    poly(WING_POLY.membrane, 'acc2');
    const bone = R_('acc2L');
    line([0, 0.5], [4, 8], bone); line([4, 8], [8, 11], bone); line([4, 8], [11, 7], bone); line([4, 8], [10, 2], bone);
    dot(4, 9, R_('white'));
    if (bk.big) { dot(8, 12, R_('white')); dot(11.5, 7.5, R_('white')); }
  } else if (bk.wing === 'fairy') {
    poly(WING_POLY.fairyA, 'acc2');
    poly(WING_POLY.fairyB, 'acc2');
    line([0.5, 0.5], [5, 8], R_('acc2H'));
    dot(6, 9, R_('white')); dot(4, -4, R_('white'));
  } else if (bk.wing === 'mech') {
    const tips = [[4, 10], [8, 8], [10, 4]];
    for (const [tx, ty] of tips) { line([0.5, 0.5], [tx, ty], 'acc2', 2); dot(tx, ty, R_('glowH')); }
    dot(0, 0, R_('acc2L')); dot(1, 1, R_('acc2L'));
  } else if (bk.item === 'jetpack') {
    poly([[-0.5, 1.5], [3.5, 1.5], [3.5, -5.5], [-0.5, -5.5]], 'sec');
    for (let bx = 0; bx <= 3; bx++) dot(bx, -1, R_('met'), false);
    dot(0.5, -6, R_('dark'), false); dot(2.5, -6, R_('dark'), false);
    const L = P.anim === 'dash' ? 4 : P.anim === 'victory' ? 3 : P.anim === 'ko' ? 0 : 1 + ((P.bob || 0) & 1);
    for (let j = 0; j < L; j++) for (const bx of [0.5, 2.5]) dot(bx, -7 - j, R_(j === 0 ? 'glowH' : j < L - 1 ? 'glow' : 'glowL'), false);
  } else if (bk.item === 'quiver') {
    line([4, -6], [0.5, 4], 'lea', 3);
    line([4, -6], [0.5, 4], R_('leaL'));
    dot(0, 4.5, R_('met'), false); dot(1.2, 4.8, R_('met'), false);
    for (const [bx, h] of [[-0.5, 3], [0.8, 2], [2, 3]]) { for (let j = 1; j < h; j++) dot(bx, 4.5 + j, R_('wood'), false); dot(bx, 4.5 + h, R_('white'), false); dot(bx - 0.8, 4.5 + h, R_('accH'), false); }
  } else if (bk.item === 'backpack') {
    poly([[-0.5, 1], [4.5, 1], [4.5, -6], [-0.5, -6]], 'lea');
    for (let bx = 0; bx <= 4; bx++) { dot(bx, 1.5, R_('leaL'), false); dot(bx, 2.5, 'sec', false); dot(bx, 3.5, 'sec', false); }
    dot(4.5, 2.5, R_('secL'), false); dot(4.5, 3.5, R_('secL'), false);
    dot(3.5, -2, R_('met'), false); dot(3.5, -3, R_('metL'), false);
  } else if (bk.item === 'sword') {
    const g = pt(-0.5, 3.5, false), tip = pt(7, -10, false);
    WEAPONS.greatsword.draw(part, g, angOf(tip[0] - g[0], tip[1] - g[1]));
  } else if (bk.item === 'banner') {
    for (let by = -8; by <= 14; by++) dot(0.5, by, R_('wood'), false);
    dot(0.5, 15, R_('accH'), false);
    const ph = (P.bob || 0) * 1.1 + (P.wave || 0);
    for (let bx = 1; bx <= 7; bx++) {
      const off = Math.round(Math.sin(ph + bx * 0.8) * 0.8 * (bx / 7));
      const bot = bx === 7 ? 9 : 7;
      for (let by = bot; by <= 13; by++) {
        if (bx === 7 && by === 11) continue;
        const emblem = (bx === 3 || bx === 4) && (by === 10 || by === 11);
        dot(bx, by + off, emblem ? R_('acc') : by === 13 ? 'priH' : 'pri', false);
      }
    }
  }
  commit(cv, part, { dim: layer === 'far', over: true });
}

// ── accessories (v2) drawn over the torso ───────────────────────────────────
function drawAccessories(cv, M, J, P) {
  const B = M.B;
  const part = new Part(PT.capeF);
  // torso frame: along = rows down from the neck, across = px toward the front
  const tp = (along, across) => [J.neck[0] - J.up[0] * along + J.fwd[0] * (across + 0.5), J.neck[1] - J.up[1] * along + J.fwd[1] * (across + 0.5)];
  const onBody = (x, y) => { const p = cv.part(x, y); return p === PT.torso || p === PT.skirt || p === PT.skirtB; };
  const seg = (a, b, mat, w = 1, clip = true) => {
    const p = tp(...a), q = tp(...b);
    lineMask(new Mask(), p[0], p[1], q[0], q[1], w).each((x, y) => { if (!clip || onBody(x, y)) part.add(x, y, mat); });
  };
  const px = (a, mat) => { const p = tp(...a); part.add(p[0], p[1], mat); };
  const sw = B.sw / 2;
  for (const a of M.acc) {
    if (a === 'sash') {
      seg([0.5, sw - 1], [B.torso, -sw + 1], 'sec', 2);
      px([B.torso + 0.5, -sw], R_('secL')); px([B.torso + 1.5, -sw - 0.5], 'sec'); px([B.torso + 2.5, -sw - 0.5], R_('secL'));
    } else if (a === 'bandolier') {
      seg([0.5, -sw + 1], [B.torso - 0.5, sw - 1], 'lea', 1);
      const p = tp(0.5, -sw + 1), q = tp(B.torso - 0.5, sw - 1);
      linePoints(p[0], p[1], q[0], q[1]).forEach(([x, y], i) => { if (i % 2 === 1 && onBody(x, y - 1)) part.add(x, y - 1, R_(i % 4 === 1 ? 'metH' : 'acc')); });
    } else if (a === 'amulet') {
      seg([0.2, -1.5], [2.5, 0.5], R_('acc'), 1);
      seg([0.2, 2.5], [2.5, 0.5], R_('acc'), 1);
      px([3.2, 0.5], R_('glowH')); px([3.2, 1.3], R_('glow')); px([4, 0.8], R_('accL'));
    } else if (a === 'pouches') {
      for (const ac of [sw - 1.8, -sw + 0.6]) {
        for (let r = 0; r <= 1; r++) for (let c = 0; c <= 1; c++) px([B.torso + r, ac + c], r === 0 ? 'lea' : R_('leaL'));
        px([B.torso - 0.2, ac + 1], R_('met'));
      }
    } else if (a === 'goggles') {
      seg([1.2, -sw], [1.2, sw], R_('leaL'), 1);
      px([0.6, 0.6], R_('met')); px([0.6, 1.6], R_('glowH')); px([0.6, 2.6], R_('met')); px([0.6, 3.6], R_('glowH'));
      px([1.4, 1.1], R_('metL')); px([1.4, 3.1], R_('metL'));
    }
  }
  commit(cv, part, { over: false });
}

function drawShoulder(cv, M, J, side) {
  const S = M.shoulders;
  if (!S || S === SHOULDERS.none || M.base.dummy) return;
  const part = new Part(PT.shoulder);
  const sh = side === 'F' ? J.shF : J.shB;
  const w = S.w + 1 + (M.build === BUILDS.bulky ? 1 : 0), h = S.h + 1;
  const cx = sh[0] + (side === 'F' ? 0.5 : -0.5), cy = sh[1] + 0.8;
  ellipseMask(part.m, cx, cy, w / 2, h / 2 + 0.2);
  part.m.each((x, y) => part.add(x, y, S.mat));
  if (S.spikes) { part.add(Math.round(cx) + 2, Math.round(cy - h / 2) + 1, 'white'); part.add(Math.round(cx) + 3, Math.round(cy - h / 2), 'white'); part.add(Math.round(cx) - 2, Math.round(cy - h / 2) + 1, 'white'); part.add(Math.round(cx) - 3, Math.round(cy - h / 2), 'white'); }
  if (S.fur) part.m.each((x, y) => { if (y === part.m.y1 && (x & 1)) part.del(x, y); });
  if (S.fringe) { const yb = part.m.y1; for (let x = part.m.x0; x <= part.m.x1; x++) if (part.m.has(x, yb) && !(x & 1)) part.add(x, yb + 1, 'accL'); }
  if (S.skull) { const X = Math.round(cx), Y = Math.round(cy); part.add(X, Y, R_('dark')); part.add(X + 2, Y, R_('dark')); part.add(X + 1, Y + 1, R_('altL')); }
  if (S.shards) {
    const X = Math.round(cx), Y = Math.round(cy - h / 2);
    for (const [dx, dy, r] of [[-1, 0, 'priH'], [-1, -1, 'white'], [1, 0, 'pri'], [1, -1, 'priH'], [1, -2, 'white'], [2, 0, 'priL']]) part.add(X + dx, Y + dy, dy === 0 ? r : R_(r));
  }
  // the head is in front of the shoulders: never paint over it
  part.m.each((x, y) => { const p = cv.part(x, y); if (p === PT.head || p === PT.hair || p === PT.gear) part.del(x, y); });
  commit(cv, part, { dim: side === 'B' });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Weapons. Each is drawn procedurally from the front hand position along the
//  weapon angle (same angle convention as limbs). `grip` selects the pose set,
//  `grip2` (px along the weapon from the front hand) is where a second hand holds.
// ═════════════════════════════════════════════════════════════════════════════

const LIGHT = [0.7, -0.7];
/** Unit normal of direction d that faces the light (top-front). */
function litNormal(d) {
  let n = [d[1], -d[0]];
  if (n[0] * LIGHT[0] + n[1] * LIGHT[1] < 0) n = [-n[0], -n[1]];
  return n;
}
function R_(name) { return 100 + ROLE[name]; }

/** A straight shaft/blade: pixels from a (inclusive) along angle for `len` px. */
function axis(hand, ang, from, to) {
  const d = dirv(ang);
  const a = add2(hand, d, from), b = add2(hand, d, to);
  return linePoints(a[0], a[1], b[0], b[1]);
}
function shaft(part, hand, ang, from, to, mat = 'wood') {
  const d = dirv(ang), n = litNormal(d);
  for (const [x, y] of axis(hand, ang, from, to)) part.add(x, y, mat === 'wood' ? R_('wood') : mat);
  void n;
}
/** Offset of one pixel toward the lit side along the dominant axis (clean staircases). */
function litStep(d) {
  const n = litNormal(d);
  return Math.abs(n[0]) >= Math.abs(n[1]) ? [Math.sign(n[0]), 0] : [0, Math.sign(n[1])];
}
/** Blade of width w (1..3): core line + lit edge (+ shadow edge), pointed tip. */
function blade(part, hand, ang, from, to, w, { taper = 0, lo = 'bladeL', mid = 'blade', hi = 'bladeH', tip = 'bladeH' } = {}) {
  const d = dirv(ang), off = litStep(d);
  const pts = axis(hand, ang, from, to);
  pts.forEach(([x, y], i) => {
    const left = pts.length - 1 - i;
    if (i === pts.length - 1) { part.add(x, y, R_(tip)); return; }
    const ww = taper && left <= taper ? Math.max(1, w - (taper - left + 1)) : w;
    part.add(x, y, R_(ww === 1 ? (i % 4 === 1 ? hi : mid) : mid));
    if (ww >= 2) part.add(x + off[0], y + off[1], R_(hi));
    if (ww >= 3) part.add(x - off[0], y - off[1], R_(lo));
  });
}
function cross(part, hand, ang, at, half, mat) {
  const d = dirv(ang), n = [d[1], -d[0]];
  const c = add2(hand, d, at);
  for (let k = -half; k <= half; k++) part.add(c[0] + n[0] * k, c[1] + n[1] * k, R_(k === -half || k === half ? mat + 'L' : mat));
}

const WEAPONS = {
  fists: {
    name: 'Bare Fists', kind: 'claw', grip: 'fists', desc: 'Wrapped fists.', handGrow: 1, handMat: 'sec',
    draw() { },
  },
  shortsword: {
    name: 'Shortsword', kind: 'slash', grip: 'sword', desc: 'A trusty arming sword.',
    draw(part, hand, ang) {
      shaft(part, hand, ang, -2, -2, R_('met'));
      shaft(part, hand, ang, -1, 0, R_('lea'));
      cross(part, hand, ang, 1, 1, 'met');
      blade(part, hand, ang, 2, 8, 2, { taper: 1 });
    },
  },
  greatsword: {
    name: 'Greatsword', kind: 'slash', grip: 'great', grip2: -2, desc: 'A huge two-handed blade.',
    draw(part, hand, ang) {
      shaft(part, hand, ang, -4, -4, R_('acc'));
      shaft(part, hand, ang, -3, 0, R_('lea'));
      cross(part, hand, ang, 1, 2, 'met');
      blade(part, hand, ang, 2, 13, 3, { taper: 2 });
    },
  },
  dagger: {
    name: 'Twin Daggers', kind: 'thrust', grip: 'daggers', desc: 'A pair of quick daggers.',
    draw(part, hand, ang) {
      shaft(part, hand, ang, -1, 0, R_('lea'));
      cross(part, hand, ang, 1, 1, 'met');
      blade(part, hand, ang, 2, 5, 1);
    },
    drawOff(part, hand, ang) {
      shaft(part, hand, ang, -1, 0, R_('lea'));
      cross(part, hand, ang, 1, 1, 'met');
      blade(part, hand, ang, 2, 5, 1);
    },
  },
  spear: {
    name: 'Spear', kind: 'thrust', grip: 'spear', grip2: -5, desc: 'A long leaf-bladed spear.',
    draw(part, hand, ang) {
      shaft(part, hand, ang, -8, 7, 'wood');
      const d = dirv(ang), n = [d[1], -d[0]];
      const t = add2(hand, d, 6);
      part.add(t[0] + n[0], t[1] + n[1], R_('acc')); part.add(t[0] - n[0], t[1] - n[1], R_('accL'));
      blade(part, hand, ang, 8, 11, 3, { taper: 2 });
    },
  },
  hammer: {
    name: 'Warhammer', kind: 'smash', grip: 'hammer', grip2: -3, desc: 'A heavy two-handed maul.',
    draw(part, hand, ang) {
      shaft(part, hand, ang, -4, 7, 'wood');
      const d = dirv(ang), n = [d[1], -d[0]];
      for (let a = 7; a <= 10; a++) {
        for (let k = -3; k <= 3; k++) {
          const p = add2(add2(hand, d, a), n, k);
          const edge = a === 7 || a === 10 || k === -3 || k === 3;
          const band = a === 8 || a === 9 ? (k === 0 ? 'acc' : null) : null;
          part.add(p[0], p[1], R_(band || (edge ? (a === 10 || k === 3 ? 'metL' : 'metH') : 'met')));
        }
      }
    },
  },
  axe: {
    name: 'Battle Axe', kind: 'slash', grip: 'axe', desc: 'A bearded battle axe.',
    draw(part, hand, ang) {
      shaft(part, hand, ang, -2, 9, 'wood');
      const d = dirv(ang), nb = [-d[1], d[0]];
      // bearded head: [along the haft, from, to] across toward the edge; the edge is bright steel
      const prof = [[4, 2, 3], [5, 1, 4], [6, 1, 4], [7, 1, 5], [8, 1, 5], [9, 1, 4], [10, 2, 2]];
      for (const [a, k0, k1] of prof) {
        for (let k = k0; k <= k1; k++) {
          const p = add2(add2(hand, d, a), nb, k);
          part.add(p[0], p[1], R_(k === k1 ? 'bladeH' : k === k1 - 1 ? 'blade' : k === 1 ? 'metL' : 'met'));
        }
      }
      for (const a of [7, 8]) { const sp = add2(add2(hand, d, a), nb, -1); part.add(sp[0], sp[1], R_('metL')); }
      const tp = add2(hand, d, 10);
      part.add(tp[0], tp[1], R_('met'));
    },
  },
  scythe: {
    name: 'Scythe', kind: 'slash', grip: 'scythe', grip2: -5, desc: 'A reaper\'s long scythe.',
    draw(part, hand, ang) {
      shaft(part, hand, ang, -9, 6, 'wood');
      const d = dirv(ang), nb = [-d[1], d[0]];
      const top = add2(hand, d, 6);
      const curve = [0, 0, 1, 1, 2, 3, 4];
      for (let k = 1; k <= 7; k++) {
        const p = add2(add2(top, nb, k), d, -curve[k - 1]);
        part.add(p[0], p[1], R_(k === 7 ? 'bladeH' : 'blade'));
        if (k < 5) { const q = add2(p, d, -1); part.add(q[0], q[1], R_('bladeL')); }
      }
      part.add(top[0], top[1], R_('met'));
    },
  },
  whip: {
    name: 'Whip', kind: 'slash', grip: 'whip', desc: 'A long leather whip.',
    draw(part, hand, ang, P) {
      shaft(part, hand, ang, -1, 1, R_('leaL'));
      const d = dirv(ang);
      let p = add2(hand, d, 2);
      const lash = P.lash || [[0, 2], [1, 2], [2, 1], [2, 0], [1, 0]];
      let k = 0;
      for (const [dx, dy] of lash) {
        const q = [p[0] + dx, p[1] + dy];
        for (const [x, y] of linePoints(p[0], p[1], q[0], q[1])) part.add(x, y, R_(k++ % 3 === 0 ? 'leaH' : 'lea'));
        p = q;
      }
    },
  },
  katana: {
    name: 'Katana', kind: 'slash', grip: 'katana', grip2: -2, desc: 'A razor-sharp curved katana.',
    draw(part, hand, ang) {
      const hp = axis(hand, ang, -3, 0);
      hp.forEach(([x, y], i) => part.add(x, y, R_(i % 2 ? 'dark' : 'pri')));
      cross(part, hand, ang, 1, 1, 'acc');
      const d = dirv(ang), n = litNormal(d);
      const pts = axis(hand, ang, 2, 12);
      pts.forEach(([x, y], i) => {
        const bend = i >= 7 ? 1 : 0;
        const bx = x - Math.round(n[0]) * bend, by = y - Math.round(n[1]) * bend;
        part.add(bx, by, R_(i === pts.length - 1 ? 'white' : 'blade'));
        if (i < pts.length - 2) part.add(bx + Math.round(n[0]), by + Math.round(n[1]), R_('bladeH'));
      });
    },
  },
  shield: {
    name: 'Sword & Shield', kind: 'slash', grip: 'shield', desc: 'Arming sword with a heater shield.',
    draw(part, hand, ang) { WEAPONS.shortsword.draw(part, hand, ang); },
  },
  claws: {
    name: 'Claws', kind: 'claw', grip: 'claws', desc: 'Triple steel claws on both fists.', handMat: 'lea',
    draw(part, hand, ang) { clawBlades(part, hand, ang); },
    drawOff(part, hand, ang) { clawBlades(part, hand, ang); },
  },
  bow: {
    name: 'Longbow', kind: 'shoot', grip: 'bow', desc: 'A tall recurve longbow.',
    draw(part, hand, ang, P, J, fx) {
      const d = dirv(ang), n = [d[1], -d[0]];
      const tips = [];
      for (let t = -7; t <= 7; t++) {
        const bulge = 2.2 * (1 - (t / 7) ** 2) - (Math.abs(t) === 7 ? 0.6 : 0);
        const p = add2(add2(hand, n, t), d, bulge - 1);
        part.add(p[0], p[1], R_(Math.abs(t) <= 1 ? 'lea' : (t < 0 ? 'woodH' : 'wood')));
        if (Math.abs(t) === 7) tips.push([Math.round(p[0]), Math.round(p[1])]);
      }
      const nock = P.draw ? [Math.round(J.handB[0]), Math.round(J.handB[1])] : null;
      if (nock) {
        fx.push({ t: 'line', a: tips[0], b: nock, role: ROLE.white });
        fx.push({ t: 'line', a: tips[1], b: nock, role: ROLE.white });
      } else fx.push({ t: 'line', a: tips[0], b: tips[1], role: ROLE.white, vib: P.vib || 0 });
      if (P.arrow) {
        const from = nock || add2(hand, d, -3);
        const tip = add2(from, d, 10);
        fx.push({ t: 'arrow', a: [Math.round(from[0]), Math.round(from[1])], b: [Math.round(tip[0]), Math.round(tip[1])] });
      }
    },
  },
  crossbow: {
    name: 'Crossbow', kind: 'shoot', grip: 'crossbow', grip2: -4, desc: 'A heavy bolt-throwing crossbow.',
    draw(part, hand, ang, P, J, fx) {
      const d = dirv(ang), n = [d[1], -d[0]];
      for (const [x, y] of axis(hand, ang, -5, 5)) { part.add(x, y, R_('wood')); }
      for (const [x, y] of axis(add2(hand, n, 1), ang, -5, 1)) part.add(x, y, R_('woodL'));
      const front = add2(hand, d, 5);
      const tips = [];
      for (let t = -4; t <= 4; t++) {
        const back = Math.abs(t) >= 3 ? 1 : 0;
        const p = add2(add2(front, n, t), d, -back);
        part.add(p[0], p[1], R_(Math.abs(t) <= 1 ? 'met' : 'metL'));
        if (Math.abs(t) === 4) tips.push([Math.round(p[0]), Math.round(p[1])]);
      }
      const latch = add2(hand, d, P.loaded === false ? 3 : 0);
      fx.push({ t: 'line', a: tips[0], b: [Math.round(latch[0]), Math.round(latch[1])], role: ROLE.white });
      fx.push({ t: 'line', a: tips[1], b: [Math.round(latch[0]), Math.round(latch[1])], role: ROLE.white });
      if (P.loaded !== false) {
        const top = add2(hand, n, -1);
        for (const [x, y] of axis(top, ang, 0, 6)) part.add(x, y, R_('lea'));
        const tp = add2(top, d, 7);
        part.add(tp[0], tp[1], R_('bladeH'));
      }
    },
  },
  staff: {
    name: 'Staff', kind: 'cast', grip: 'staff', grip2: -6, desc: 'A tall staff crowned with a glowing orb.',
    draw(part, hand, ang, P, J, fx) {
      shaft(part, hand, ang, -10, 6, 'wood');
      const d = dirv(ang), n = [d[1], -d[0]];
      const c = add2(hand, d, 8);
      const cl = add2(hand, d, 6);
      part.add(cl[0] + n[0] * 1.2, cl[1] + n[1] * 1.2, R_('met'));
      part.add(cl[0] - n[0] * 1.2, cl[1] - n[1] * 1.2, R_('met'));
      const c7 = add2(hand, d, 7);
      part.add(c7[0] + n[0] * 1.6, c7[1] + n[1] * 1.6, R_('metL'));
      part.add(c7[0] - n[0] * 1.6, c7[1] - n[1] * 1.6, R_('metL'));
      fx.push({ t: 'orb', c: [Math.round(c[0]), Math.round(c[1])], r: P.glow || 1 });
    },
  },
  wand: {
    name: 'Wand', kind: 'cast', grip: 'wand', desc: 'A slender wand with a star tip.',
    draw(part, hand, ang, P, J, fx) {
      for (const [x, y] of axis(hand, ang, -1, 4)) part.add(x, y, R_('woodL'));
      const c = add2(hand, dirv(ang), 5);
      fx.push({ t: 'star', c: [Math.round(c[0]), Math.round(c[1])], r: P.glow || 1 });
    },
  },
  pistol: {
    name: 'Flintlock', kind: 'gun', grip: 'pistol', desc: 'An ornate flintlock pistol.',
    draw(part, hand, ang, P, J, fx) {
      const d = dirv(ang), n = litNormal(d);
      for (const [x, y] of axis(hand, ang, 0, 5)) part.add(x, y, R_('met'));
      for (const [x, y] of axis(add2(hand, n, 1), ang, 1, 4)) part.add(x, y, R_('metH'));
      const g1 = add2(add2(hand, d, -1), n, -1), g2 = add2(add2(hand, d, -2), n, -2);
      part.add(g1[0], g1[1], R_('wood')); part.add(g2[0], g2[1], R_('woodL'));
      const hm = add2(add2(hand, d, 0), n, 2);
      part.add(hm[0], hm[1], R_('dark'));
      if (P.flash) { const m = add2(hand, d, 7); fx.push({ t: 'flash', c: [Math.round(m[0]), Math.round(m[1])], r: P.flash, d }); }
    },
  },
};

function clawBlades(part, hand, ang) {
  const d = dirv(ang), n = [d[1], -d[0]];
  for (const k of [-1, 0, 1]) {
    for (let a = 1; a <= 4; a++) {
      const p = add2(add2(hand, d, a + (k === 0 ? 1 : 0)), n, k * 1.1);
      part.add(p[0], p[1], R_(a === 4 ? 'bladeH' : 'blade'));
    }
  }
}

/** Heater shield held on the back (off) arm. */
const SHIELD_ROWS = [
  'nmmmmmmM',
  'nppaapPM',
  'npaaaaPM',
  'nppaapPM',
  'nppaapPM',
  '.nppapM.',
  '..nppM..',
  '...nM...',
];
function drawShieldItem(cv, M, J, P) {
  const part = new Part(PT.off);
  const hx = Math.round(J.handB[0]), hy = Math.round(J.handB[1]);
  const ox = hx - 3 + (P.shieldDx || 0), oy = hy - 4 + (P.shieldDy || 0);
  SHIELD_ROWS.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') part.add(ox + i, oy + j, 100 + CHAR_ROLE[row[i]]); });
  commit(cv, part, { over: true });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Animation library.
//  Body motion (legs, lean, bob) is shared; each grip style supplies the arms and
//  weapon for every frame: hF/hB = hand targets relative to the neck (IK), or
//  armF/armB = [shoulder, elbow] angles (FK). Frame counts:
//  idle 4, walk 6, attack 4, cast 3, dash 2, hurt 2, ko 4, victory 4, block 2.
//  Everything is authored to stay inside the 32×32 frame.
// ═════════════════════════════════════════════════════════════════════════════

const STANCE = { legB: [-12, 10], legF: [12, 14] };
const BODY = {
  idle: [
    { ...STANCE, sq: 0, wave: 0.2 },
    { ...STANCE, sq: 0, wave: 0.4 },
    { ...STANCE, sq: 1, wave: 0.6 },
    { ...STANCE, sq: 1, wave: 0.4 },
  ],
  walk: [
    { legF: [24, 6], legB: [-22, 18], sq: 0, lean: 4, wave: 0.8 },
    { legF: [10, 22], legB: [-12, 46], sq: 1, lean: 5, wave: 1.0 },
    { legF: [-8, 8], legB: [16, 54], sq: 0, lean: 4, wave: 1.2 },
    { legB: [24, 6], legF: [-22, 18], sq: 0, lean: 4, wave: 0.8 },
    { legB: [10, 22], legF: [-12, 46], sq: 1, lean: 5, wave: 1.0 },
    { legB: [-8, 8], legF: [16, 54], sq: 0, lean: 4, wave: 1.2 },
  ],
  attack: [
    { legB: [-24, 16], legF: [14, 24], dx: -1, lean: -6, wave: 0.4, face: 'focus' },
    { legB: [-18, 10], legF: [22, 14], dx: 0, lean: 2, wave: 0.8, face: 'yell' },
    { legB: [-32, 6], legF: [34, 26], dx: 1, lean: 12, wave: 1.4, face: 'yell' },
    { legB: [-26, 10], legF: [26, 22], dx: 1, lean: 8, wave: 1.0 },
  ],
  cast: [
    { ...STANCE, lean: -2, wave: 0.4, face: 'focus' },
    { legB: [-14, 8], legF: [14, 10], lean: -6, wave: 0.8, face: 'focus' },
    { legB: [-20, 10], legF: [20, 18], dx: 1, lean: 8, wave: 1.2, face: 'yell' },
  ],
  dash: [
    { legF: [62, 84], legB: [-52, 18], lean: 24, dy: -1, wave: 2 },
    { legF: [40, 74], legB: [-68, 30], lean: 28, dy: -2, wave: 2 },
  ],
  hurt: [
    { legB: [-6, 26], legF: [22, 34], dx: -2, lean: -16, hdx: -1, wave: 1.6, face: 'hurt' },
    { legB: [-10, 18], legF: [16, 24], dx: -1, lean: -8, wave: 1.0, face: 'hurt' },
  ],
  victory: [
    { legB: [-14, 40], legF: [22, 46], sq: 1, lean: 2, face: 'happy', wave: 0.4 },
    { legB: [-22, 30], legF: [30, 52], dy: -2, lean: -2, face: 'happy', wave: 1.2 },
    { legB: [-12, 52], legF: [40, 64], dy: -3, lean: -4, face: 'happy', wave: 1.4 },
    { legB: [-12, 12], legF: [14, 14], lean: 0, face: 'happy', wave: 0.6 },
  ],
  block: [
    { legB: [-26, 16], legF: [20, 28], dx: -1, lean: -6, wave: 0.6, face: 'focus' },
    { legB: [-28, 18], legF: [18, 30], dx: -2, lean: -9, wave: 0.9, face: 'focus' },
  ],
  ko: [
    { legB: [4, 42], legF: [26, 46], dx: -2, lean: -18, face: 'ko', wave: 1 },
    { legB: [0, 92], legF: [84, 86], dx: 0, lean: 26, hdy: 1, face: 'ko', wave: 0.3 },
    { legB: [8, 24], legF: [32, 34], lean: -6, face: 'ko', wave: 1.6, rot: -64 },
    { legB: [-2, 0], legF: [4, 0], lean: 0, face: 'ko', wave: 0, rot: 90 },
  ],
};

const SWING = [-18, -8, 8, 18, 8, -8]; // walk arm swing (front arm), back arm opposite
const BREATH = [0, 0.3, 0.6, 0.3];
const idleB = (i) => ({ armB: [-8, 18 + BREATH[i] * 6] });
const walkB = (i) => ({ armB: [-6 - SWING[i], 22] });
const KO_ARMS = [
  { armF: [30, 20], armB: [-24, 10] },
  { armF: [6, 4], armB: [-10, 6] },
  { armF: [60, 30], armB: [-40, 24] },
  { armF: [4, 0], armB: [-4, 0] },
];
const HURT_ARMS = [
  { armF: [118, 36], armB: [-56, 30] },
  { armF: [56, 44], armB: [-26, 26] },
];
const pick = (arr, i) => arr[Math.min(i, arr.length - 1)];
const merge = (...o) => Object.assign({}, ...o);

// Per-grip arms/weapon: (anim, i, M) -> partial pose. Weapon angle `w`: 0 down, 90 forward, 180 up.
const GRIPS = {};

GRIPS.sword = (a, i) => {
  switch (a) {
    case 'idle': return merge({ hF: [6.5, 5.5], w: 146 - BREATH[i] * 3 }, idleB(i));
    case 'walk': return merge({ armF: [30 + SWING[i] * 0.6, 62], w: 140 + SWING[i] * 0.4 }, walkB(i));
    case 'attack': return pick([
      { hF: [-3.5, -0.5], armB: [40, 40], w: 236, wz: 'back', armZ: 'back' },
      { hF: [2.5, -3], armB: [20, 30], w: 202, armZ: 'back' },
      { hF: [7.5, 1.5], armB: [-40, 20], w: 72, fx: [{ t: 'smear', a0: 205, a1: 72, r: 12, w: 3 }] },
      { hF: [6, 5], armB: [-30, 20], w: 34, fx: [{ t: 'smear', a0: 88, a1: 34, r: 11, w: 1 }] },
    ], i);
    case 'block': return pick([
      { hF: [5, 1.5], armB: [40, 60], w: 188 },
      { hF: [4.5, 1.8], armB: [42, 58], w: 190, fx: [{ t: 'glint', on: 'weapon' }] },
    ], i);
    case 'victory': return pick([
      { hF: [6, 6], armB: [-20, 30], w: 110 },
      { hF: [6.5, -1.5], armB: [150, 30], w: 150 },
      { hF: [6.5, -2.5], armB: [160, 20], w: 158, fx: [{ t: 'sparkle', on: 'tip' }] },
      { hF: [6.5, -1], armB: [-10, 30], w: 150 },
    ], i);
    case 'dash': return { armF: [-45, 40], armB: [-70, 20], w: 258 };
    case 'hurt': return merge(pick(HURT_ARMS, i), { w: [212, 160][i] });
    case 'ko': return merge(KO_ARMS[i], { w: [60, 18, 200, 6][i] });
    default: return null;
  }
};
GRIPS.axe = (a, i, M) => {
  if (a === 'attack') return pick([
    { hF: [-3.5, -1], armB: [40, 40], w: 226, wz: 'back', armZ: 'back' },
    { hF: [2.5, -3], armB: [20, 30], w: 196, armZ: 'back' },
    { hF: [7, 2], armB: [-40, 20], w: 58, fx: [{ t: 'smear', a0: 200, a1: 58, r: 12, w: 3 }] },
    { hF: [5.5, 5.5], armB: [-30, 20], w: 22, fx: [{ t: 'smear', a0: 80, a1: 22, r: 11, w: 1 }] },
  ], i);
  if (a === 'idle') return merge({ hF: [6.5, 5.5], w: 152 - BREATH[i] * 3 }, idleB(i));
  return GRIPS.sword(a, i, M);
};
GRIPS.shield = (a, i, M) => {
  const p = GRIPS.sword(a, i, M) || {};
  const hold = { hB: [5.5, 4.5], armB: undefined };
  switch (a) {
    case 'idle': return merge(p, { hB: [6.5, 3.5], armB: undefined }, { hF: [3, 8.5], w: 62 + BREATH[i] * 3 });
    case 'walk': return merge(p, { hB: [6.5, 3.5], armB: undefined }, { armF: [14 + SWING[i] * 0.4, 30], w: 64 });
    case 'attack': return merge(p, { hB: [5, 5], armB: undefined });
    case 'block': return pick([
      { hB: [7, 0.5], hF: [-2, 5], w: 150, wz: 'back' },
      { hB: [7, 0.5], hF: [-2, 5], w: 152, wz: 'back', fx: [{ t: 'glint', on: 'shield' }] },
    ], i);
    case 'victory': return merge(p, { hB: [3, 6], armB: undefined });
    case 'dash': return merge(p, { hB: [6, 3], armB: undefined });
    case 'hurt': return merge(p, { hB: [4, 3], armB: undefined });
    case 'cast': return pick([
      { hF: [5, 2], hB: [5.5, 4.5], w: 150, tipGlow: 1 },
      { hF: [5, -1], hB: [5.5, 4.5], w: 160, tipGlow: 2 },
      { hF: [7.5, 1.5], hB: [5.5, 4.5], w: 120, tipGlow: 3 },
    ], i);
    default: return p;
  }
};
GRIPS.great = (a, i) => {
  switch (a) {
    case 'idle': return { hF: [5, 6.5], gripB: true, w: 150 - BREATH[i] * 2 };
    case 'walk': return { hF: [5 + SWING[i] * 0.05, 6.5], gripB: true, w: 148 + SWING[i] * 0.2 };
    case 'attack': return pick([
      { hF: [0, -1], gripB: true, w: 238, wz: 'back', armZ: 'back' },
      { hF: [4, 0], gripB: true, w: 214, armZ: 'back' },
      { hF: [2, 3], gripB: true, w: 62, dx: -1, fx: [{ t: 'smear', a0: 214, a1: 62, r: 13, w: 4 }] },
      { hF: [2, 6], gripB: true, w: 40, dx: -1, fx: [{ t: 'smear', a0: 90, a1: 40, r: 12, w: 2 }] },
    ], i);
    case 'block': return pick([{ hF: [4, 2.5], gripB: true, w: 182 }, { hF: [3.5, 2.8], gripB: true, w: 184, fx: [{ t: 'glint', on: 'weapon' }] }], i);
    case 'victory': return pick([
      { hF: [5, 6], gripB: true, w: 120 },
      { hF: [5, 0], gripB: true, w: 145 },
      { hF: [5, -0.5], gripB: true, w: 150, fx: [{ t: 'sparkle', on: 'tip' }] },
      { hF: [5, 0.5], gripB: true, w: 145 },
    ], i);
    case 'dash': return { hF: [-3, 3], gripB: true, w: 236 };
    case 'hurt': return pick([{ hF: [2, -1], gripB: true, w: 212 }, { hF: [5, 4], gripB: true, w: 160 }], i);
    case 'ko': return merge(KO_ARMS[i], { w: [70, 16, 210, 6][i] });
    case 'cast': return pick([
      { hF: [5, 4], gripB: true, w: 150, tipGlow: 1 },
      { hF: [5, 0], gripB: true, w: 150, tipGlow: 2 },
      { hF: [4, 2], gripB: true, w: 120, tipGlow: 3 },
    ], i);
    default: return null;
  }
};
GRIPS.katana = (a, i, M) => {
  if (a === 'idle') return { hF: [5, 3.5], gripB: true, w: 130 - BREATH[i] * 2 };
  if (a === 'walk') return { hF: [5 + SWING[i] * 0.05, 3.5], gripB: true, w: 128 };
  if (a === 'attack') return pick([
    { hF: [0, 7], gripB: true, w: 250, wz: 'back' },
    { hF: [3, 1], gripB: true, w: 214, armZ: 'back' },
    { hF: [3.5, 2.5], gripB: true, w: 70, fx: [{ t: 'smear', a0: 214, a1: 70, r: 13, w: 3 }] },
    { hF: [4, 5], gripB: true, w: 48, fx: [{ t: 'speed', on: 'tip' }] },
  ], i);
  return GRIPS.great(a, i, M);
};
GRIPS.scythe = (a, i, M) => {
  switch (a) {
    case 'idle': return { hF: [5, 2.5], gripB: true, w: 176 - BREATH[i] * 2 };
    case 'walk': return { hF: [5, 2.5], gripB: true, w: 174 + SWING[i] * 0.2 };
    case 'attack': return pick([
      { hF: [-2, 1], gripB: true, w: 226, wz: 'back', armZ: 'back' },
      { hF: [2, -1], gripB: true, w: 192, armZ: 'back' },
      { hF: [6, 4], gripB: true, w: 80, fx: [{ t: 'smear', a0: 200, a1: 80, r: 14, w: 4 }] },
      { hF: [5, 6], gripB: true, w: 52, fx: [{ t: 'smear', a0: 96, a1: 52, r: 13, w: 2 }] },
    ], i);
    case 'block': return pick([{ hF: [4, 2.5], gripB: true, w: 182 }, { hF: [3.5, 2.8], gripB: true, w: 184, fx: [{ t: 'glint', on: 'weapon' }] }], i);
    case 'victory': return pick([
      { hF: [5, 5], gripB: true, w: 160 },
      { hF: [5, 0], gripB: true, w: 176 },
      { hF: [5, -1], gripB: true, w: 180, fx: [{ t: 'sparkle', on: 'tip' }] },
      { hF: [5, 1], gripB: true, w: 176 },
    ], i);
    default: return GRIPS.great(a, i, M);
  }
};
GRIPS.daggers = (a, i) => {
  switch (a) {
    case 'idle': return { hF: [6, 5 + BREATH[i]], hB: [4, 7 + BREATH[i]], w: 104, off: 116 };
    case 'walk': return { armF: [48 + SWING[i] * 0.6, 62], armB: [34 - SWING[i] * 0.6, 74], w: 108, off: 110 };
    case 'attack': return pick([
      { hF: [2, 6], hB: [3, 5], w: 96, off: 112 },
      { hF: [9, 2], hB: [3, 6], w: 92, off: 112, fx: [{ t: 'speed', on: 'tip' }] },
      { hF: [3, 5], hB: [9, 3], w: 112, off: 92, fx: [{ t: 'speed', on: 'offtip' }] },
      { hF: [6, 4], hB: [5, 6], w: 104, off: 112 },
    ], i);
    case 'block': return pick([{ hF: [5, 1], hB: [6, 2], w: 160, off: 200 }, { hF: [4.5, 1.3], hB: [5.5, 2.3], w: 162, off: 202, fx: [{ t: 'glint', on: 'weapon' }] }], i);
    case 'victory': return pick([
      { hF: [5, 6], hB: [4, 7], w: 120, off: 116 },
      { hF: [5.5, -1], hB: [3, -2], w: 150, off: 206 },
      { hF: [5.5, -2], hB: [3, -3], w: 156, off: 210, fx: [{ t: 'sparkle', on: 'tip' }] },
      { hF: [5.5, 0], hB: [4, 6], w: 150, off: 116 },
    ], i);
    case 'dash': return { armF: [-40, 30], armB: [-66, 20], w: 256, off: 250 };
    case 'hurt': return merge(pick(HURT_ARMS, i), { w: [212, 150][i], off: [230, 120][i] });
    case 'cast': return pick([
      { hF: [5, 3], hB: [4, 7], w: 150, off: 116, tipGlow: 1 },
      { hF: [5, 0], hB: [4, 7], w: 160, off: 116, tipGlow: 2 },
      { hF: [8, 2], hB: [4, 7], w: 110, off: 116, tipGlow: 3 },
    ], i);
    case 'ko': return merge(KO_ARMS[i], { w: [60, 18, 200, 6][i], off: [40, 20, 150, 10][i] });
    default: return null;
  }
};
GRIPS.spear = (a, i) => {
  switch (a) {
    case 'idle': return { hF: [5, 5.5 + BREATH[i]], gripB: true, w: 152 };
    case 'walk': return { hF: [5, 5.5], gripB: true, w: 150 + SWING[i] * 0.2 };
    case 'attack': return pick([
      { hF: [1, 5], gripB: true, w: 98, dx: -2 },
      { hF: [3, 4], gripB: true, w: 94, dx: -2 },
      { hF: [5, 3.5], gripB: true, w: 91, dx: -2, fx: [{ t: 'speed', on: 'tip' }] },
      { hF: [4, 4], gripB: true, w: 95, dx: -2 },
    ], i);
    case 'block': return pick([{ hF: [4, 3], gripB: true, w: 180 }, { hF: [3.5, 3.3], gripB: true, w: 182, fx: [{ t: 'glint', on: 'weapon' }] }], i);
    case 'victory': return pick([
      { hF: [5, 5], gripB: true, w: 160 },
      { hF: [5, 1], gripB: true, w: 172 },
      { hF: [5, 0.5], gripB: true, w: 176, fx: [{ t: 'sparkle', on: 'tip' }] },
      { hF: [5, 1.5], gripB: true, w: 172 },
    ], i);
    case 'dash': return { hF: [3, 4], gripB: true, w: 100 };
    case 'hurt': return pick([{ hF: [2, -1], gripB: true, w: 206 }, { hF: [5, 4], gripB: true, w: 160 }], i);
    case 'cast': return pick([
      { hF: [5, 4], gripB: true, w: 160, tipGlow: 1 },
      { hF: [5, 1], gripB: true, w: 168, tipGlow: 2 },
      { hF: [5, 3], gripB: true, w: 130, tipGlow: 3 },
    ], i);
    case 'ko': return merge(KO_ARMS[i], { w: [70, 16, 210, 6][i] });
    default: return null;
  }
};
GRIPS.hammer = (a, i) => {
  switch (a) {
    case 'idle': return { hF: [4.5, 6 + BREATH[i]], gripB: true, w: 158 };
    case 'walk': return { hF: [4.5, 6], gripB: true, w: 156 + SWING[i] * 0.2 };
    case 'attack': return pick([
      { hF: [0, -1], gripB: true, w: 214, wz: 'back', armZ: 'back', lean: -8 },
      { hF: [-1, -2], gripB: true, w: 234, wz: 'back', armZ: 'back', lean: -14, dy: -1 },
      { hF: [5.5, 5], gripB: true, w: 50, lean: 18, sq: 1, fx: [{ t: 'smear', a0: 214, a1: 56, r: 12, w: 3 }, { t: 'dust', on: 'tip' }] },
      { hF: [5, 6], gripB: true, w: 44, lean: 12, fx: [{ t: 'dust', on: 'tip', k: 2 }] },
    ], i);
    case 'block': return pick([{ hF: [4, 3], gripB: true, w: 180 }, { hF: [3.5, 3.3], gripB: true, w: 182, fx: [{ t: 'glint', on: 'weapon' }] }], i);
    case 'victory': return pick([
      { hF: [4.5, 6], gripB: true, w: 150 },
      { hF: [4.5, 0], gripB: true, w: 162 },
      { hF: [4.5, -0.5], gripB: true, w: 166, fx: [{ t: 'sparkle', on: 'tip' }] },
      { hF: [4.5, 0.5], gripB: true, w: 162 },
    ], i);
    case 'dash': return { hF: [-2, 4], gripB: true, w: 230 };
    case 'hurt': return pick([{ hF: [2, -1], gripB: true, w: 206 }, { hF: [5, 4], gripB: true, w: 160 }], i);
    case 'cast': return pick([
      { hF: [4.5, 4], gripB: true, w: 162, tipGlow: 1 },
      { hF: [4.5, 1], gripB: true, w: 168, tipGlow: 2 },
      { hF: [5, 3], gripB: true, w: 128, tipGlow: 3 },
    ], i);
    case 'ko': return merge(KO_ARMS[i], { w: [70, 16, 210, 6][i] });
    default: return null;
  }
};
GRIPS.whip = (a, i) => {
  const hang = [[1, 2], [1, 3], [0, 2], [-1, 1], [0, 1]];
  switch (a) {
    case 'idle': return merge({ hF: [6, 4 + BREATH[i]], w: 124, lash: hang }, idleB(i));
    case 'walk': return merge({ armF: [36 + SWING[i] * 0.6, 60], w: 118, lash: [[SWING[i] > 0 ? 0 : 1, 3], [0, 3], [-1, 2], [0, 1]] }, walkB(i));
    case 'attack': return pick([
      { hF: [-3, -1], armB: [30, 40], w: 230, lash: [[-2, 1], [-3, 2], [-2, 3], [-1, 2]], wz: 'back', armZ: 'back' },
      { hF: [2, -3], armB: [10, 30], w: 150, lash: [[2, -2], [3, -1], [3, 0], [2, 1]], armZ: 'back' },
      { hF: [7.5, 1.5], armB: [-30, 20], w: 92, lash: [[3, 0], [3, -1], [3, 1], [2, 0]], fx: [{ t: 'crack', on: 'lash' }] },
      { hF: [6.5, 3.5], armB: [-24, 20], w: 80, lash: [[2, 1], [2, 2], [1, 3], [-1, 2]] },
    ], i);
    case 'block': return pick([{ hF: [5, 1], armB: [40, 60], w: 180, lash: [[1, 2], [0, 3], [-1, 2]] }, { hF: [4.5, 1.3], armB: [42, 58], w: 182, lash: [[1, 2], [0, 3], [-1, 2]] }], i);
    case 'victory': return pick([
      { hF: [6, 6], armB: [-20, 30], w: 130, lash: hang },
      { hF: [6, -1.5], armB: [150, 30], w: 160, lash: [[1, -2], [2, -1], [2, 1], [1, 2]] },
      { hF: [6, -2.5], armB: [160, 20], w: 166, lash: [[-1, -2], [-2, -1], [-2, 1], [-1, 2]] },
      { hF: [6, -1], armB: [-10, 30], w: 160, lash: [[1, 2], [0, 3], [-1, 2]] },
    ], i);
    case 'dash': return { armF: [-40, 30], armB: [-70, 20], w: 250, lash: [[-2, 0], [-3, 1], [-2, 1]] };
    case 'hurt': return merge(pick(HURT_ARMS, i), { w: [200, 140][i], lash: [[-1, 2], [-2, 2]] });
    case 'ko': return merge(KO_ARMS[i], { w: [60, 18, 200, 6][i], lash: hang });
    default: return null;
  }
};
GRIPS.fists = (a, i) => {
  switch (a) {
    case 'idle': return { hF: [4.5, 1.5 + BREATH[i]], hB: [6, 1 + BREATH[i]], w: null };
    case 'walk': return { hF: [4.5 + SWING[i] * 0.04, 2], hB: [6 - SWING[i] * 0.04, 1.5], w: null };
    case 'attack': return pick([
      { hF: [3, 3], hB: [5, 2], w: null, lean: 2 },
      { hF: [9.5, 1.5], hB: [5, 2], w: null, fx: [{ t: 'speed', on: 'handF' }] },
      { hF: [4, 2.5], hB: [9.5, 1.5], w: null, fx: [{ t: 'impact', on: 'handB' }] },
      { hF: [5, 2], hB: [6.5, 2], w: null },
    ], i);
    case 'block': return pick([{ hF: [4, -1], hB: [5, 0], w: null }, { hF: [3.5, -0.7], hB: [4.5, 0.3], w: null, fx: [{ t: 'glint', on: 'handF' }] }], i);
    case 'victory': return pick([
      { hF: [4, 3], hB: [5, 3], w: null },
      { hF: [3, -7.5], hB: [0, -7], w: null },
      { hF: [3.5, -8], hB: [-0.5, -7.5], w: null, fx: [{ t: 'sparkle', on: 'handF' }] },
      { hF: [3, -7], hB: [5, 3], w: null },
    ], i);
    case 'dash': return { armF: [-40, 60], armB: [-60, 50], w: null };
    case 'hurt': return merge(pick(HURT_ARMS, i), { w: null });
    case 'cast': return pick([
      { hF: [2.5, 5.5], hB: [3, 6.5], w: null, glowB: 1 },
      { hF: [5.5, 3.5], hB: [6.5, 3], w: null, glowB: 2 },
      { hF: [8.5, 2.5], hB: [9.5, 2], w: null, glowB: 3 },
    ], i);
    case 'ko': return merge(KO_ARMS[i], { w: null });
    default: return null;
  }
};
GRIPS.claws = (a, i, M) => {
  const p = GRIPS.fists(a, i, M);
  return p ? { ...p, w: null, clawF: true, clawB: true } : p;
};
GRIPS.bow = (a, i) => {
  switch (a) {
    case 'idle': return merge({ hF: [5, 8 + BREATH[i]], w: 100 }, idleB(i));
    case 'walk': return merge({ armF: [26 + SWING[i] * 0.5, 26], w: 100 }, walkB(i));
    case 'attack': return pick([
      { hF: [8, 1.5], handB: 'bowgrip', w: 90, arrow: true, face: 'focus' },
      { hF: [8.5, 1.5], handB: 'cheek', w: 90, arrow: true, draw: true, face: 'focus' },
      { hF: [8.5, 1], handB: 'cheek', w: 91, arrow: true, draw: true, face: 'focus', lean: -3 },
      { hF: [8.5, 1.5], handB: 'release', w: 90, vib: 1, fx: [{ t: 'sparkle', on: 'handF' }] },
    ], i);
    case 'block': return pick([{ hF: [5, 1], hB: [4, 4], w: 178 }, { hF: [4.5, 1.3], hB: [3.5, 4.3], w: 180 }], i);
    case 'victory': return pick([
      { hF: [5, 7], armB: [-20, 30], w: 110 },
      { hF: [5.5, -3], armB: [150, 30], w: 150 },
      { hF: [5.5, -3.5], armB: [160, 20], w: 154, fx: [{ t: 'sparkle', on: 'handF' }] },
      { hF: [5.5, -2.5], armB: [-10, 30], w: 150 },
    ], i);
    case 'dash': return { armF: [-30, 30], armB: [-60, 20], w: 60 };
    case 'hurt': return merge(pick(HURT_ARMS, i), { w: [150, 110][i] });
    case 'ko': return merge(KO_ARMS[i], { w: [70, 30, 200, 10][i] });
    default: return null;
  }
};
GRIPS.crossbow = (a, i) => {
  switch (a) {
    case 'idle': return { hF: [4, 6 + BREATH[i]], gripB: true, w: 104 };
    case 'walk': return { hF: [4, 6], gripB: true, w: 104 + SWING[i] * 0.2 };
    case 'attack': return pick([
      { hF: [4, 3], gripB: true, w: 96, dx: -1 },
      { hF: [5, 2], gripB: true, w: 92, dx: -1, face: 'focus' },
      { hF: [4.5, 1.5], gripB: true, w: 100, dx: -2, loaded: false, fx: [{ t: 'flash', on: 'tip', r: 2 }] },
      { hF: [4.5, 2.5], gripB: true, w: 94, dx: -1, loaded: false },
    ], i);
    case 'block': return pick([{ hF: [4, 2], gripB: true, w: 178 }, { hF: [3.5, 2.3], gripB: true, w: 180 }], i);
    case 'victory': return pick([
      { hF: [4, 6], gripB: true, w: 120 },
      { hF: [4.5, 0], gripB: true, w: 160 },
      { hF: [4.5, -0.5], gripB: true, w: 164, fx: [{ t: 'sparkle', on: 'tip' }] },
      { hF: [4.5, 0.5], gripB: true, w: 160 },
    ], i);
    case 'dash': return { hF: [2, 5], gripB: true, w: 110 };
    case 'hurt': return pick([{ hF: [2, -1], gripB: true, w: 200 }, { hF: [4, 5], gripB: true, w: 120 }], i);
    case 'ko': return merge(KO_ARMS[i], { w: [70, 30, 210, 10][i] });
    default: return null;
  }
};
GRIPS.staff = (a, i) => {
  switch (a) {
    case 'idle': return merge({ hF: [5, 4 + BREATH[i]], w: 178, glow: i === 2 ? 2 : 1 }, idleB(i));
    case 'walk': return merge({ hF: [5 + SWING[i] * 0.05, 4], w: 176 + SWING[i] * 0.3, glow: 1 }, walkB(i));
    case 'attack': return pick([
      { hF: [4, 1], armB: [30, 40], w: 196, glow: 1 },
      { hF: [3, -1], armB: [50, 70], w: 200, glow: 2, face: 'focus' },
      { hF: [7, 2], armB: [-20, 20], w: 128, glow: 3 },
      { hF: [6, 4], armB: [-10, 20], w: 156, glow: 1 },
    ], i);
    case 'cast': return pick([
      { hF: [5, 4], hB: [3, 6.5], w: 172, glow: 1, glowB: 1 },
      { hF: [4.5, 1], hB: [6.5, 3.5], w: 182, glow: 2, glowB: 2 },
      { hF: [6.5, 2.5], hB: [9.5, 2], w: 130, glow: 2, glowB: 3 },
    ], i);
    case 'block': return pick([{ hF: [5, 2], hB: [4, 4], w: 176, glow: 1 }, { hF: [4.5, 2.3], hB: [3.5, 4.3], w: 178, glow: 2 }], i);
    case 'victory': return pick([
      { hF: [5, 4], armB: [-20, 30], w: 176, glow: 1 },
      { hF: [5, 0], armB: [150, 30], w: 176, glow: 2 },
      { hF: [5, -0.5], armB: [160, 20], w: 178, glow: 3 },
      { hF: [5, 0.5], armB: [-10, 30], w: 176, glow: 2 },
    ], i);
    case 'dash': return { armF: [-30, 60], armB: [-60, 20], w: 240, glow: 1 };
    case 'hurt': return merge(pick(HURT_ARMS, i), { w: [210, 170][i], glow: 1 });
    case 'ko': return merge(KO_ARMS[i], { w: [60, 18, 200, 6][i] });
    default: return null;
  }
};
GRIPS.wand = (a, i) => {
  switch (a) {
    case 'idle': return merge({ hF: [6, 3 + BREATH[i]], w: 150, glow: i === 2 ? 2 : 1 }, idleB(i));
    case 'walk': return merge({ armF: [40 + SWING[i] * 0.5, 70], w: 148, glow: 1 }, walkB(i));
    case 'attack': return pick([
      { hF: [4, 0], armB: [30, 40], w: 196, glow: 1 },
      { hF: [2.5, -3], armB: [20, 30], w: 222, glow: 2, face: 'focus', armZ: 'back' },
      { hF: [9, 1.5], armB: [-30, 20], w: 92, glow: 3 },
      { hF: [7, 3], armB: [-20, 20], w: 112, glow: 1 },
    ], i);
    case 'cast': return pick([
      { hF: [6, 3], hB: [3, 6.5], w: 150, glow: 1, glowB: 1 },
      { hF: [4.5, 0], hB: [6.5, 3.5], w: 196, glow: 2, glowB: 2 },
      { hF: [9, 1.5], hB: [7.5, 3.5], w: 92, glow: 3, glowB: 2 },
    ], i);
    case 'block': return pick([{ hF: [4.5, 0], hB: [5, 1], w: 180, glow: 1 }, { hF: [4, 0.3], hB: [4.5, 1.3], w: 182, glow: 2 }], i);
    case 'victory': return pick([
      { hF: [6, 5], armB: [-20, 30], w: 140, glow: 1 },
      { hF: [5.5, -3], armB: [150, 30], w: 170, glow: 2 },
      { hF: [5.5, -4], armB: [160, 20], w: 176, glow: 3 },
      { hF: [5.5, -2.5], armB: [-10, 30], w: 170, glow: 2 },
    ], i);
    case 'dash': return { armF: [-40, 30], armB: [-66, 20], w: 250 };
    case 'hurt': return merge(pick(HURT_ARMS, i), { w: [200, 150][i] });
    case 'ko': return merge(KO_ARMS[i], { w: [60, 18, 200, 6][i] });
    default: return null;
  }
};
GRIPS.pistol = (a, i) => {
  switch (a) {
    case 'idle': return merge({ hF: [4.5, 8 + BREATH[i]], w: 62 }, idleB(i));
    case 'walk': return merge({ armF: [22 + SWING[i] * 0.6, 34], w: 64 }, walkB(i));
    case 'attack': return pick([
      { hF: [6, 4], armB: [-10, 30], w: 80 },
      { hF: [9, 1.5], armB: [-20, 30], w: 90, face: 'focus' },
      { hF: [8.5, 0.5], armB: [-20, 30], w: 104, dx: -1, flash: 2 },
      { hF: [9, 1.5], armB: [-16, 30], w: 94, fx: [{ t: 'smoke', on: 'tip' }] },
    ], i);
    case 'block': return pick([{ hF: [4, 0], hB: [5, 2], w: 180 }, { hF: [3.5, 0.3], hB: [4.5, 2.3], w: 182 }], i);
    case 'victory': return pick([
      { hF: [4.5, 7], armB: [-20, 30], w: 70 },
      { hF: [6, -2], armB: [150, 30], w: 176 },
      { hF: [6, -3], armB: [160, 20], w: 178, flash: 1 },
      { hF: [6, -1.5], armB: [-10, 30], w: 176, fx: [{ t: 'smoke', on: 'tip' }] },
    ], i);
    case 'dash': return { armF: [-40, 30], armB: [-66, 20], w: 250 };
    case 'hurt': return merge(pick(HURT_ARMS, i), { w: [200, 80][i] });
    case 'ko': return merge(KO_ARMS[i], { w: [60, 18, 200, 6][i] });
    default: return null;
  }
};

/** Generic spell pose for grips with a free off hand. */
function genericCast(i, idle) {
  const base = { ...(idle || {}) };
  delete base.hB; delete base.armB;
  return [
    { ...base, hB: [2.5, 6.5], glowB: 1 },
    { ...base, hB: [6.5, 3], glowB: 2 },
    { ...base, hB: [9.5, 2], glowB: 3 },
  ][i];
}

const ANIM_COUNTS = { idle: 4, walk: 6, attack: 4, cast: 3, dash: 2, hurt: 2, ko: 4, victory: 4, block: 2 };

function buildPoses(M) {
  const grip = M.weapon.grip;
  const G = GRIPS[grip] || GRIPS.sword;
  const out = {};
  for (const [anim, n] of Object.entries(ANIM_COUNTS)) {
    out[anim] = [];
    for (let i = 0; i < n; i++) {
      const body = BODY[anim][i];
      let arms = G(anim, i, M);
      if (anim === 'cast' && !arms) arms = genericCast(i, G('idle', 0, M));
      if (!arms && anim === 'dash') arms = G('walk', 2, M);
      const P = { ...body, ...(arms || {}) };
      if (arms && arms.dx !== undefined) P.dx = (body.dx || 0) + arms.dx;
      if (arms && arms.dy !== undefined) P.dy = (body.dy || 0) + arms.dy;
      if (arms && arms.lean !== undefined) P.lean = arms.lean;
      if (arms && arms.face) P.face = arms.face;
      P.bob = i;
      P.anim = anim;
      if (M.base.hover && anim !== 'ko' && anim !== 'victory' && anim !== 'dash') P.dy = (P.dy || 0) - M.base.hover - (i & 1);
      if (M.base.dummy) Object.assign(P, dummyPose(anim, i));
      out[anim].push(P);
    }
  }
  return out;
}

function dummyPose(anim, i) {
  const wob = { idle: [0, 2, 0, -2], walk: [0, 2, 0, -2, 0, 2], attack: [-4, 8, 12, 4], cast: [0, -4, 6], dash: [10, 14], hurt: [-14, -7], victory: [4, -4, 4, -4], block: [-4, -6], ko: [-10, 18, -30, 0] }[anim] || [0];
  const P = { lean: wob[i % wob.length], legB: [0, 0], legF: [0, 0], dx: 0, dy: 0, w: null, hF: null, hB: null, face: anim === 'hurt' || anim === 'ko' ? 'ko' : 'n', glowB: 0, tipGlow: 0, fx: [] };
  if (anim === 'ko' && i >= 2) { P.rot = i === 2 ? -64 : 90; P.lean = 0; }
  if (anim === 'victory') P.dy = i === 1 || i === 2 ? -1 : 0;
  return P;
}

// ═════════════════════════════════════════════════════════════════════════════
//  Frame rendering
// ═════════════════════════════════════════════════════════════════════════════

const TIP = { shortsword: 8, greatsword: 13, dagger: 5, spear: 11, hammer: 10, axe: 9, scythe: 6, whip: 2, katana: 12, shield: 8, claws: 5, bow: 0, crossbow: 7, staff: 8, wand: 5, pistol: 6, fists: 1 };

function specialTargets(M, J, P) {
  if (typeof P.handB !== 'string') return;
  const n = J.neck;
  if (P.handB === 'bowgrip') P._tB = [J.handF[0] - 2, J.handF[1] + 0.5];
  else if (P.handB === 'cheek') P._tB = [n[0] + 2.5, n[1] - 2.5];
  else if (P.handB === 'release') P._tB = [n[0] - 2.5, n[1] - 3.5];
}

/** Solve + rasterise one pose (no outline yet). */
function rawFrame(M, P) {
  const cv = new Cv();
  let J = solve(M, P);
  if (typeof P.handB === 'string') {
    specialTargets(M, J, P);
    J = solve(M, { ...P, handB: P._tB });
  }
  const fx = [];
  const W = M.weapon;
  const drawWeapon = (over) => {
    if (J.w === null || J.w === undefined || !W.draw) return;
    const part = new Part(PT.weapon);
    W.draw(part, J.handF, J.w, P, J, fx);
    if (M.wglow) glowEdges(part, J);
    commit(cv, part, { over });
  };
  const claws = (side) => {
    const el = side === 'F' ? J.elbF : J.elbB, hd = side === 'F' ? J.handF : J.handB;
    const part = new Part(side === 'F' ? PT.weapon : PT.off);
    // claws follow the forearm but lean toward the front, so a raised guard does not stab the face
    const fa = angOf(hd[0] - el[0], hd[1] - el[1]);
    clawBlades(part, hd, fa + (100 - fa) * 0.6);
    if (M.wglow) glowEdges(part, J);
    commit(cv, part, { over: side === 'F', dim: side === 'B' });
  };

  if (M.back) drawBack(cv, M, J, P, 'far');
  drawTail(cv, M, J, P);
  drawCape(cv, M, J, P, 'back');
  if (M.back) drawBack(cv, M, J, P, 'near');
  drawSkirt(cv, M, J, P, 'back');
  if (P.wz === 'back') drawWeapon(false);
  if (W.drawOff && P.off !== undefined && P.off !== null) {
    const op = new Part(PT.off);
    W.drawOff(op, J.handB, P.off, P, J, fx);
    commit(cv, op, { dim: false, over: false });
  }
  if (P.clawB) claws('B');
  drawShoulder(cv, M, J, 'B');
  drawArm(cv, M, J, 'B', P);
  if (!P.gripB) drawHand(cv, M, J, 'B', P);
  if (M.base.dummy) drawDummyPost(cv, M, J);
  else if (M.base.blob) drawBlob(cv, M, J, P);
  else if (M.base.wisp) drawWisp(cv, M, J, P);
  else { drawLeg(cv, M, J, 'B', P); drawLeg(cv, M, J, 'F', P); }
  drawTorso(cv, M, J, P);
  drawSkirt(cv, M, J, P, 'front');
  if (M.acc) drawAccessories(cv, M, J, P);
  if (W.grip === 'shield' && !M.base.dummy) drawShieldItem(cv, M, J, P);
  const armBehind = P.armZ === 'back' || (P.armZ !== 'front' && J.handF[1] < J.neck[1] - 4);
  if (armBehind) { drawArm(cv, M, J, 'F', P); drawHand(cv, M, J, 'F', P); }
  drawHead(cv, M, J, P);
  drawCape(cv, M, J, P, 'front');
  if (P.wz !== 'back') drawWeapon(true);
  if (P.gripB) drawHand(cv, M, J, 'B', P);
  if (!armBehind) drawArm(cv, M, J, 'F', P);
  drawShoulder(cv, M, J, 'F');
  if (!armBehind) drawHand(cv, M, J, 'F', P);
  if (P.clawF) claws('F');
  // glow sources
  if (P.glowB) {
    const up = J.handB[1] < J.neck[1] - 2;
    fx.push({ t: 'orb', c: [Math.round(J.handB[0]) + (up ? 0 : 2), Math.round(J.handB[1]) - (up ? 2 : 1)], r: P.glowB });
  }
  if (P.tipGlow && J.w !== null && J.w !== undefined) {
    const tp = add2(J.handF, dirv(J.w), TIP[M.weaponId] || 8);
    fx.push({ t: 'orb', c: [Math.round(tp[0]), Math.round(tp[1])], r: P.tipGlow });
  }
  if (M.wglow && !J.wpix) J.wpix = [J.handF, J.handB].map(([x, y]) => [Math.round(x), Math.round(y)]);
  return { cv, J, fx };
}

/** Weapon glow (v2): the weapon's outer edge takes the glow colour; its pixels seed the particles. */
function glowEdges(part, J) {
  const m = part.m, W = part.m.w;
  const edge = [];
  let metal = 0;
  m.each((x, y) => {
    const mt = part.mat[y * W + x];
    const r = mt >= 100 ? mt - 100 : -1;
    const isMetal = r === ROLE.blade || r === ROLE.bladeH || r === ROLE.bladeL || r === ROLE.met || r === ROLE.metH || r === ROLE.metL || r === ROLE.white;
    if (isMetal) metal++;
    const out = !m.has(x + 1, y) || !m.has(x - 1, y) || !m.has(x, y + 1) || !m.has(x, y - 1);
    if (out) edge.push([x, y, isMetal]);
  });
  const pix = [];
  for (const [x, y, isMetal] of edge) {
    if (metal && !isMetal) continue;
    if (!metal && (x + y) & 1) continue;
    part.mat[y * W + x] = 100 + (!m.has(x, y - 1) || !m.has(x + 1, y) ? ROLE.wglowH : ROLE.wglow);
    pix.push([x, y]);
  }
  J.wpix = (J.wpix || []).concat(pix);
}

/** Element particles around the glowing weapon (drawn after the outline, like other fx). */
function drawWeaponGlowFx(cv, M, J, P) {
  const pix = J.wpix;
  if (!pix || !pix.length) return;
  const id = M.wglowId, seed = (P.bob || 0) * 7 + (ANIM_SEED[P.anim] || 0);
  const H = ROLE.wglowH, G = ROLE.wglow, L = ROLE.wglowL, Wt = ROLE.white;
  const n = Math.min(4, 1 + (pix.length >> 2));
  for (let k = 0; k < n; k++) {
    const [x, y] = pix[(seed * 5 + k * 11 + k * k * 3) % pix.length];
    const s = (seed + k * 3) % 4;
    switch (id) {
      case 'flame': putFx(cv, x, y - 1 - s, s < 2 ? H : G, true); if (s === 1) putFx(cv, x + 1, y - 3, L, true); break;
      case 'frost': putFx(cv, x + (s & 1 ? 1 : -1), y - 1, Wt, true); if (s === 0) { putFx(cv, x + 2, y - 1, H, true); putFx(cv, x + 1, y - 2, H, true); } break;
      case 'void': putFx(cv, x - 1 - (s >> 1), y - 1 + (s & 1), L, true); putFx(cv, x - 2 - (s >> 1), y - 1 + (s & 1), G, true); break;
      case 'holy': putFx(cv, x, y - 2, Wt, true); if (s < 2) { putFx(cv, x - 1, y - 2, H, true); putFx(cv, x + 1, y - 2, H, true); putFx(cv, x, y - 3, H, true); } break;
      case 'electric': putFx(cv, x + 1, y - 1, H, true); putFx(cv, x + 2, y, Wt, true); putFx(cv, x + 3, y - 1, G, true); break;
      case 'poison': putFx(cv, x, y + 1 + (s >> 1), G, true); if (s === 3) putFx(cv, x, y + 3, L, true); break;
      default: break;
    }
  }
}
const ANIM_SEED = { idle: 0, walk: 3, attack: 5, cast: 7, dash: 11, hurt: 13, ko: 17, victory: 19, block: 23 };

function fxPoint(M, J, P, on) {
  const tipLen = TIP[M.weaponId] || 8;
  switch (on) {
    case 'tip': return J.w === null || J.w === undefined ? J.handF : add2(J.handF, dirv(J.w), tipLen);
    case 'offtip': return add2(J.handB, dirv(P.off || 90), 5);
    case 'handB': return J.handB;
    case 'lash': return add2(J.handF, [8, 0]);
    case 'shield': return [J.handB[0] + 3, J.handB[1] - 3];
    case 'weapon': return J.w === null || J.w === undefined ? J.handF : add2(J.handF, dirv(J.w), tipLen * 0.6);
    default: return J.handF;
  }
}

function putFx(cv, x, y, role, onlyEmpty = false) {
  x = Math.round(x); y = Math.round(y);
  if (!cv.in(x, y)) return;
  const cur = cv.get(x, y);
  if (onlyEmpty && cur && cur !== ROLE.out) return;
  const pt = cv.part(x, y);
  if (cur && (pt === PT.weapon || pt === PT.hand)) return;
  cv.put(x, y, role, PT.fx);
}

function drawFx(cv, M, J, P, list) {
  const wg = !!M.wglow; // a weapon glow tints orbs / stars in its element colour
  const G = wg ? ROLE.wglowH : ROLE.glowH, g = wg ? ROLE.wglow : ROLE.glow, gl = wg ? ROLE.wglowL : ROLE.glowL, W = ROLE.white;
  for (const f of list) {
    const p = f.c || (f.on ? fxPoint(M, J, P, f.on) : J.handF);
    const [x, y] = [Math.round(p[0]), Math.round(p[1])];
    switch (f.t) {
      case 'line': {
        const pts = linePoints(f.a[0], f.a[1], f.b[0], f.b[1]);
        pts.forEach(([px, py], i) => { if (i > 0 && i < pts.length - 1) cv.put(px + (f.vib && i % 4 === 2 ? f.vib : 0), py, f.role, PT.fx); });
        break;
      }
      case 'arrow': {
        const pts = linePoints(f.a[0], f.a[1], f.b[0], f.b[1]);
        pts.forEach(([px, py], i) => cv.put(px, py, i < 2 ? ROLE.acc : i === pts.length - 1 ? ROLE.white : i === pts.length - 2 ? ROLE.metH : ROLE.wood, PT.fx));
        break;
      }
      case 'orb': {
        const r = f.r || 1;
        if (r === 1) {
          putFx(cv, x, y, G); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) putFx(cv, x + dx, y + dy, g);
        } else {
          const R = r === 2 ? 2 : 2.6;
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const d = Math.hypot(dx, dy);
            if (d > R + 0.3) continue;
            putFx(cv, x + dx, y + dy, d < 1 ? G : d < R - 0.6 ? g : gl);
          }
          putFx(cv, x - 1, y - 1, G);
          const s = r === 2 ? 3 : 4;
          for (const [dx, dy] of [[s, -1], [-s + 1, s - 1], [1, -s], [-1, s]]) putFx(cv, x + dx, y + dy, r === 3 ? G : g, true);
          if (r >= 3) for (const [dx, dy] of [[5, 0], [-5, 0], [0, -5], [0, 5], [3, 3], [-3, -3], [3, -3], [-3, 3]]) putFx(cv, x + dx, y + dy, gl, true);
        }
        break;
      }
      case 'star': {
        const r = f.r || 1;
        putFx(cv, x, y, G);
        for (let k = 1; k <= r; k++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) putFx(cv, x + dx * k, y + dy * k, k === 1 ? g : gl);
        if (r >= 2) for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) putFx(cv, x + dx, y + dy, gl);
        if (r >= 3) for (const [dx, dy] of [[3, -3], [-3, 3], [4, 1], [-2, -4]]) putFx(cv, x + dx, y + dy, G, true);
        break;
      }
      case 'flash': {
        const d = f.d || [1, 0];
        const n = [d[1], -d[0]];
        putFx(cv, x, y, W);
        for (let k = 1; k <= (f.r || 1) + 1; k++) putFx(cv, x + d[0] * k, y + d[1] * k, k === 1 ? G : g);
        putFx(cv, x + n[0], y + n[1], g); putFx(cv, x - n[0], y - n[1], g);
        if ((f.r || 1) >= 2) { putFx(cv, x + d[0] + n[0] * 2, y + d[1] + n[1] * 2, gl); putFx(cv, x + d[0] - n[0] * 2, y + d[1] - n[1] * 2, gl); }
        break;
      }
      case 'smear': {
        const c = J.shF;
        const lo = Math.min(f.a0, f.a1), hi = Math.max(f.a0, f.a1);
        const R = f.r, w = f.w || 2;
        for (let dy = -R - 1; dy <= R + 1; dy++) {
          for (let dx = -R - 1; dx <= R + 1; dx++) {
            const px = Math.round(c[0]) + dx, py = Math.round(c[1]) + dy;
            const d = Math.hypot(px - c[0], py - c[1]);
            let a = angOf(px - c[0], py - c[1]);
            if (a < lo - 1) a += 360;
            if (a < lo || a > hi) continue;
            const k = (a - lo) / Math.max(1, hi - lo);
            const lead = f.a1 < f.a0 ? 1 - k : k;
            const thick = Math.max(0.6, w * Math.sin(Math.PI * clamp(0.15 + lead * 0.85, 0, 1)));
            if (d > R + 0.5 || d < R + 0.5 - thick) continue;
            putFx(cv, px, py, d > R - 0.5 ? ROLE.trailH : ROLE.trail, true);
          }
        }
        break;
      }
      case 'speed': {
        for (const [oy, len] of [[-2, 3], [0, 5], [2, 3]]) for (let k = 2; k < 2 + len; k++) putFx(cv, x - k, y + oy, k < 4 ? ROLE.trailH : ROLE.trail, true);
        break;
      }
      case 'impact': {
        putFx(cv, x + 2, y, W, true);
        for (const [dx, dy] of [[3, -2], [3, 2], [4, 0], [2, -3], [2, 3]]) putFx(cv, x + dx, y + dy, ROLE.trailH, true);
        break;
      }
      case 'glint': {
        putFx(cv, x, y, W); putFx(cv, x + 1, y, G); putFx(cv, x - 1, y, G); putFx(cv, x, y - 1, G); putFx(cv, x, y + 1, G);
        break;
      }
      case 'sparkle': {
        putFx(cv, x, y - 2, W, true);
        for (const [dx, dy] of [[1, -2], [-1, -2], [0, -3], [0, -1]]) putFx(cv, x + dx, y + dy, G, true);
        putFx(cv, x + 3, y, G, true); putFx(cv, x - 3, y + 1, g, true);
        break;
      }
      case 'dust': {
        const k = f.k || 1;
        const gy = GROUND;
        for (const [dx, dy] of [[-3, 0], [-2, -1], [2, 0], [3, -1], [0, -1], [4, 0], [-4, 0]]) putFx(cv, x + dx * k, gy + dy - (k - 1), k > 1 ? ROLE.metL : ROLE.white, true);
        break;
      }
      case 'crack': {
        putFx(cv, x, y, W, true);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) putFx(cv, x + dx, y + dy, ROLE.trailH, true);
        for (const [dx, dy] of [[2, -2], [2, 2], [-2, -2], [-2, 2]]) putFx(cv, x + dx, y + dy, ROLE.trail, true);
        break;
      }
      case 'smoke': {
        putFx(cv, x + 1, y - 2, ROLE.metL, true); putFx(cv, x, y - 3, ROLE.met, true); putFx(cv, x + 1, y - 4, ROLE.metL, true);
        break;
      }
      default: break;
    }
  }
}

// ── rotation (KO frames) ────────────────────────────────────────────────────
function rotate90(cv) {
  // counter-clockwise on screen: head goes to the left, face turns up
  const out = new Cv(cv.h, cv.w);
  for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) {
    const r = cv.c[y * cv.w + x];
    if (!r) continue;
    const nx = y, ny = cv.w - 1 - x;
    out.c[ny * out.w + nx] = r; out.p[ny * out.w + nx] = cv.p[y * cv.w + x];
  }
  return out;
}
function scale2x(src, w, h) {
  const dst = new Uint8Array(w * h * 4);
  const W2 = w * 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const P = src[y * w + x];
      const A = y > 0 ? src[(y - 1) * w + x] : P, B = x < w - 1 ? src[y * w + x + 1] : P;
      const C = x > 0 ? src[y * w + x - 1] : P, D = y < h - 1 ? src[(y + 1) * w + x] : P;
      dst[(2 * y) * W2 + 2 * x] = C === A && C !== D && A !== B ? A : P;
      dst[(2 * y) * W2 + 2 * x + 1] = A === B && A !== C && B !== D ? B : P;
      dst[(2 * y + 1) * W2 + 2 * x] = D === C && D !== B && C !== A ? C : P;
      dst[(2 * y + 1) * W2 + 2 * x + 1] = B === D && B !== A && D !== C ? D : P;
    }
  }
  return dst;
}
/** RotSprite-style rotation (8x EPX upscale, nearest rotate, centre-sample down). ccw degrees. */
function rotSprite(cv, deg, pivot) {
  let buf = cv.c, w = cv.w, h = cv.h;
  for (let k = 0; k < 3; k++) { buf = scale2x(buf, w, h); w *= 2; h *= 2; }
  const S = 8;
  const OW = 48, OH = 48;
  const out = new Cv(OW, OH);
  const a = deg * DEG, cos = Math.cos(a), sin = Math.sin(a);
  const px = pivot[0] * S, py = pivot[1] * S;
  const ox = 8, oy = 8; // output origin offset (in 1x px) so rotated art is not clipped
  for (let Y = 0; Y < OH; Y++) {
    for (let X = 0; X < OW; X++) {
      // centre of the output pixel in 8x space, relative to the pivot
      const cx = ((X - ox) + 0.5) * S - px, cy = ((Y - oy) + 0.5) * S - py;
      // inverse of a ccw screen rotation
      const sx = cx * cos - cy * sin + px, sy = cx * sin + cy * cos + py;
      const ix = Math.floor(sx), iy = Math.floor(sy);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      const r = buf[iy * w + ix];
      if (r) out.c[Y * OW + X] = r;
    }
  }
  return out;
}
/** Crop to content and drop it on the ground line of a fresh 32×32 frame. */
function placeOnGround(src, centerX = CX + 0.5) {
  let x0 = src.w, x1 = -1, y0 = src.h, y1 = -1;
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) if (src.c[y * src.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const out = new Cv();
  if (x1 < 0) return out;
  const dx = Math.round(centerX - (x0 + x1 + 1) / 2), dy = GROUND - y1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const r = src.c[y * src.w + x];
    if (r) out.put(x + dx, y + dy, r, src.p[y * src.w + x]);
  }
  return out;
}

function renderFrame(M, P) {
  const { cv, J, fx } = rawFrame(M, P);
  if (P.rot) {
    let rot;
    if (P.rot === 90) rot = rotate90(cv);
    else rot = rotSprite(cv, -P.rot, [J.hip[0] + 0.5, GROUND]);
    const placed = placeOnGround(rot, P.rot === 90 ? CX + 1 : CX - 1);
    outlineAll(placed);
    return placed;
  }
  outlineAll(cv);
  drawFx(cv, M, J, P, fx.concat(P.fx || []));
  if (M.wglow) drawWeaponGlowFx(cv, M, J, P);
  return cv;
}

// ═════════════════════════════════════════════════════════════════════════════
//  Palette + output
// ═════════════════════════════════════════════════════════════════════════════

const MAX_COLORS = 32;
function toSprite(M, frameSets) {
  const count = new Map();
  for (const list of Object.values(frameSets)) for (const cv of list) for (let i = 0; i < cv.c.length; i++) if (cv.c[i]) count.set(cv.c[i], (count.get(cv.c[i]) || 0) + 1);
  const roleKey = {};
  const keyHex = {};
  const keyUse = {};
  const hexKey = new Map();
  for (let role = 1; role < ROLE_CHAR.length; role++) {
    if (!count.has(role)) continue;
    const name = ROLE_LIST[role - 1][0];
    const hex = (M.colors[name] || '#ff00ff').toLowerCase();
    if (hexKey.has(hex)) { roleKey[role] = hexKey.get(hex); keyUse[roleKey[role]] += count.get(role); continue; }
    const key = ROLE_CHAR[role];
    hexKey.set(hex, key);
    keyHex[key] = hex;
    keyUse[key] = count.get(role);
    roleKey[role] = key;
  }
  // too many colours? merge the closest pair (the rarer colour gives way)
  while (Object.keys(keyHex).length > MAX_COLORS) {
    const keys = Object.keys(keyHex).filter(k => k !== 'o');
    let best = null;
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const d = dist2(keyHex[keys[i]], keyHex[keys[j]]);
      if (!best || d < best.d) best = { d, a: keys[i], b: keys[j] };
    }
    const [keep, drop] = keyUse[best.a] >= keyUse[best.b] ? [best.a, best.b] : [best.b, best.a];
    for (const r of Object.keys(roleKey)) if (roleKey[r] === drop) roleKey[r] = keep;
    keyUse[keep] += keyUse[drop];
    delete keyHex[drop]; delete keyUse[drop];
  }
  const frames = {};
  for (const [name, list] of Object.entries(frameSets)) {
    frames[name] = list.map(cv => {
      const rows = [];
      for (let y = 0; y < N; y++) {
        let s = '';
        for (let x = 0; x < N; x++) { const r = cv.c[y * N + x]; s += r ? roleKey[r] : '.'; }
        rows.push(s);
      }
      return rows;
    });
  }
  const palette = {};
  for (const k of Object.keys(keyHex)) palette[k] = keyHex[k];
  return { palette, frames };
}

// ═════════════════════════════════════════════════════════════════════════════
//  Public API: schema, validation, composition, catalog
// ═════════════════════════════════════════════════════════════════════════════

const AURAS = {
  none: { name: 'None', desc: 'No aura.' },
  fire: { name: 'Fire', desc: 'Embers and heat shimmer.' },
  frost: { name: 'Frost', desc: 'Drifting snowflakes and cold mist.' },
  shadow: { name: 'Shadow', desc: 'Dark wisps curling around you.' },
  holy: { name: 'Holy', desc: 'Golden motes of light.' },
  storm: { name: 'Storm', desc: 'Crackling sparks.' },
  poison: { name: 'Poison', desc: 'Bubbling toxic fumes.' },
  electric: { name: 'Electric', desc: 'Yellow sparks arcing around you.' },
  void: { name: 'Void', desc: 'Dark motes sucked inward.' },
  blood: { name: 'Blood', desc: 'Dripping red droplets.' },
  sakura: { name: 'Sakura', desc: 'Drifting cherry petals.' },
  bubbles: { name: 'Bubbles', desc: 'Rising, popping bubbles.' },
  music: { name: 'Music', desc: 'Floating music notes.' },
  rainbow: { name: 'Rainbow', desc: 'Rainbow comets orbiting you.' },
  glitch: { name: 'Glitch', desc: 'Flickering digital glitches.' },
  stars: { name: 'Stars', desc: 'Twinkling stars.' },
  leaves: { name: 'Leaves', desc: 'Tumbling leaves.' },
  ash: { name: 'Ash', desc: 'Grey ash and dim embers drifting up.' },
  hearts: { name: 'Hearts', desc: 'Little floating hearts.' },
};

// Ready-made skins: `"look": {"preset": "samurai"}` -- any other field overrides the preset.
const PRESETS = {
  knight: { name: 'Knight', desc: 'Plumed helm, plate, shield and a long cape.', weapon: 'shield', look: { base: 'human', build: 'bulky', headgear: 'plume', outfit: 'plate', cape: 'long', colors: { primary: '#2f5fb3', secondary: '#2f5fb3', accent: '#e8c35a', metal: '#c3cbd6' }, aura: 'holy' } },
  ranger: { name: 'Ranger', desc: 'Hooded elven archer in leather.', weapon: 'bow', look: { base: 'elf', build: 'slim', hair: 'long', hairColor: 'platinum', headgear: 'hood', outfit: 'leather', cape: 'short', colors: { primary: '#3f9a5c', secondary: '#e8d8a8', accent: '#b7f5ff', pants: '#4a3a2a' } } },
  wizard: { name: 'Wizard', desc: 'Bearded sage with a starry hat.', weapon: 'staff', look: { base: 'human', build: 'slim', hair: 'long', hairColor: 'white', face: 'longbeard', headgear: 'wizard', outfit: 'robe', colors: { primary: '#6a45c8', secondary: '#ffd84a', accent: '#ffe066' }, aura: 'storm' } },
  witch: { name: 'Witch', desc: 'Crooked hat, long hair and a wand.', weapon: 'wand', look: { base: 'elf', hair: 'long', hairColor: 'purple', headgear: 'witch', outfit: 'robe', colors: { primary: '#2e2a44', secondary: '#9a58d8', accent: '#8cf04a' }, aura: 'poison' } },
  samurai: { name: 'Samurai', desc: 'Kabuto, gi and a katana.', weapon: 'katana', look: { base: 'human', hair: 'topknot', hairColor: 'black', headgear: 'kabuto', outfit: 'gi', shoulders: 'pads', colors: { primary: '#b8282e', secondary: '#1e1e26', accent: '#e8b830', metal: '#c4ccd8' } } },
  ninja: { name: 'Ninja', desc: 'Hood, mask, scarf and twin daggers.', weapon: 'dagger', look: { base: 'human', build: 'slim', hair: 'none', face: 'mask', headgear: 'hood', outfit: 'ninja', cape: 'scarf', colors: { primary: '#3a3358', secondary: '#d8283b', accent: '#d8283b', pants: '#2e2946' }, aura: 'shadow' } },
  barbarian: { name: 'Barbarian', desc: 'Horned helm, wild mane and war paint.', weapon: 'axe', look: { base: 'human', build: 'bulky', skin: 'tan', hair: 'wild', hairColor: 'red', face: 'warpaint', headgear: 'horned', outfit: 'barbarian', shoulders: 'fur', colors: { primary: '#6e4a2e', secondary: '#8a5a34', accent: '#c0182a' } } },
  monk: { name: 'Monk', desc: 'Buzz cut, headband and a gi.', weapon: 'fists', look: { base: 'human', hair: 'crop', hairColor: 'black', headgear: 'headband', outfit: 'gi', colors: { primary: '#f0e6d0', secondary: '#e07a2a', accent: '#e07a2a' } } },
  pirate: { name: 'Pirate', desc: 'Bandana, eye patch and a vest.', weapon: 'pistol', look: { base: 'human', skin: 'tan', hair: 'long', hairColor: 'black', face: 'eyepatch', headgear: 'bandana', outfit: 'vest', colors: { primary: '#8a2230', secondary: '#f0e6d0', accent: '#e8b830', pants: '#2e3442' } } },
  cowboy: { name: 'Cowboy', desc: 'Wide hat, duster and stubble.', weapon: 'pistol', look: { base: 'human', skin: 'tan', hair: 'short', hairColor: 'chestnut', face: 'stubble', headgear: 'cowboy', outfit: 'coat', colors: { primary: '#6e5a44', secondary: '#c8a070', accent: '#e8b830', pants: '#3e4658' } } },
  necromancer: { name: 'Necromancer', desc: 'A hooded skeleton with a scythe.', weapon: 'scythe', look: { base: 'skeleton', headgear: 'hood', outfit: 'robe', eyes: '#8cf04a', colors: { primary: '#2a2436', secondary: '#4a3a5a', accent: '#8cf04a' }, aura: 'shadow', trail: '#8cf04a' } },
  vampire: { name: 'Vampire', desc: 'Pale noble with fangs and a long cape.', weapon: 'claws', look: { base: 'human', skin: 'pale', hair: 'sidepart', hairColor: 'black', face: 'fangs', eyes: '#d0203a', outfit: 'coat', cape: 'long', colors: { primary: '#2a2230', secondary: '#9a1424', accent: '#d0203a', pants: '#1e1a24' }, aura: 'shadow' } },
  druid: { name: 'Druid', desc: 'Antlered elf in green robes.', weapon: 'staff', look: { base: 'elf', hair: 'braids', hairColor: 'chestnut', headgear: 'antlers', outfit: 'robe', colors: { primary: '#3f7a3a', secondary: '#c8a070', accent: '#9cd84a' }, aura: 'poison' } },
  valkyrie: { name: 'Valkyrie', desc: 'Braided warrior in mail with a spear.', weapon: 'spear', look: { base: 'human', hair: 'braids', hairColor: 'blonde', headgear: 'horned', outfit: 'chainmail', cape: 'long', colors: { primary: '#3a6ad8', secondary: '#c4ccd8', accent: '#e8b830' }, aura: 'holy' } },
  android: { name: 'Android', desc: 'Sleek robot in a glowing bodysuit.', weapon: 'pistol', look: { base: 'robot', outfit: 'bodysuit', eyes: '#46e8ff', colors: { primary: '#2a3242', secondary: '#46e8ff', accent: '#46e8ff', metal: '#c4ccd8' }, aura: 'storm' } },
  mech: { name: 'Mech knight', desc: 'A plated war machine with a maul.', weapon: 'hammer', look: { base: 'robot', build: 'bulky', outfit: 'plate', shoulders: 'spiked', eyes: '#ff5a3a', colors: { primary: '#3a3f4c', secondary: '#ff5a3a', accent: '#ff9a2a', metal: '#8a93a8' } } },
  golem: { name: 'Stone golem', desc: 'Living rock veined with runes.', weapon: 'hammer', look: { base: 'golem', eyes: '#39c0ff', colors: { primary: '#8d8a86', secondary: '#5f5b57', accent: '#39c0ff' } } },
  dwarf: { name: 'Dwarf warrior', desc: 'Horned helm, mail and a huge beard.', weapon: 'axe', look: { base: 'dwarf', hairColor: 'auburn', headgear: 'horned', outfit: 'chainmail', colors: { primary: '#6a3a2a', secondary: '#3e4658', accent: '#e8b830' } } },
  goblin: { name: 'Goblin rogue', desc: 'Sneaky goblin in rags.', weapon: 'dagger', look: { base: 'goblin', headgear: 'bandana', outfit: 'rags', colors: { primary: '#6e5a3a', secondary: '#8a2230', accent: '#e8b830' } } },
  warlord: { name: 'Orc warlord', desc: 'Spiked armour and a greatsword.', weapon: 'greatsword', look: { base: 'orc', build: 'bulky', hair: 'mohawk', outfit: 'plate', shoulders: 'spiked', cape: 'tattered', colors: { primary: '#5a2a2a', secondary: '#3a2e2e', accent: '#e8b830', metal: '#6e7684' } } },
  hunter: { name: 'Lizard hunter', desc: 'Scaled spear hunter.', weapon: 'spear', look: { base: 'lizard', outfit: 'leather', colors: { primary: '#7a5a3a', secondary: '#c8a070', accent: '#e84a3a' } } },
  demonlord: { name: 'Demon lord', desc: 'Crowned fiend with a scythe.', weapon: 'scythe', look: { base: 'demon', headgear: 'crown', outfit: 'coat', cape: 'long', colors: { primary: '#2a1a24', secondary: '#9a1424', accent: '#ffb02e' }, aura: 'fire' } },
  zombie: { name: 'Zombie', desc: 'Shambling undead in rags.', weapon: 'claws', look: { base: 'undead', outfit: 'rags', colors: { primary: '#5a5a4a', secondary: '#6e4a3a', accent: '#c8f060' }, aura: 'poison' } },
  angel: { name: 'Angel', desc: 'Haloed guardian in white.', weapon: 'shortsword', look: { base: 'human', hair: 'long', hairColor: 'gold', headgear: 'halo', outfit: 'robe', colors: { primary: '#f0ece0', secondary: '#e8b830', accent: '#ffe89a', metal: '#e8d8a0' }, aura: 'holy', trail: '#fff1b0' } },
  beast: { name: 'Beast warrior', desc: 'Fox-folk brawler with claws.', weapon: 'claws', look: { base: 'beast', outfit: 'leather', colors: { primary: '#3a4a6a', secondary: '#c8a070', accent: '#ff9a2a' } } },
  scarecrow: { name: 'Scarecrow', desc: 'A training dummy that fights back.', weapon: 'fists', look: { base: 'dummy', skin: 'straw', colors: { primary: '#d9b77e', secondary: '#6b4a2b', accent: '#c0392b' } } },
};
// v2 presets: show off wings, tails, markings, emblems, glows and the new bases.
Object.assign(PRESETS, {
  seraph: { name: 'Seraph', desc: 'Winged angel in royal robes with a holy greatsword.', weapon: 'greatsword', look: { base: 'human', hair: 'long', hairColor: 'platinum', headgear: 'halo', outfit: 'royal', back: 'angel', eyeStyle: 'glowing', eyes: '#ffc830', weaponGlow: 'holy', emblem: 'sun', colors: { primary: '#f2eee2', secondary: '#e8c050', accent: '#ffd23a', metal: '#e8d8a0' }, aura: 'holy', trail: '#fff1b0' } },
  vampirelord: { name: 'Vampire lord', desc: 'Bat-winged noble with a high collar and a blood aura.', weapon: 'whip', look: { base: 'human', skin: 'pale', hair: 'sidepart', hairColor: 'black', face: 'fangs', eyes: '#e0203a', eyeStyle: 'glowing', outfit: 'suit', cape: 'vampire', back: 'bat', gloves: 'long', colors: { primary: '#1e1a26', secondary: '#9a1424', accent: '#d0203a', accent2: '#3a2a48' }, aura: 'blood' } },
  dragonknight: { name: 'Dragon knight', desc: 'Dragonkin in plate with wings and a flaming blade.', weapon: 'greatsword', look: { base: 'dragonkin', build: 'bulky', outfit: 'plate', back: 'dragon', weaponGlow: 'flame', emblem: 'flame', colors: { primary: '#6a1e1e', secondary: '#3a2a2a', accent: '#ffb02e', metal: '#8a8f9e' }, aura: 'fire' } },
  fairyqueen: { name: 'Fairy queen', desc: 'Tiny winged royal with a tiara and cherry petals.', weapon: 'wand', look: { base: 'fairy', hair: 'twintails', hairColor: 'pink', headgear: 'tiara', outfit: 'robe', face: 'blush', colors: { primary: '#f0a8d0', secondary: '#ffffff', accent: '#ffd23a', accent2: '#c8f4ff' }, aura: 'sakura' } },
  astronaut: { name: 'Astronaut', desc: 'Spacesuit, gold-visor helmet and a jetpack.', weapon: 'pistol', look: { base: 'human', headgear: 'spacehelmet', outfit: 'spacesuit', back: 'jetpack', emblem: 'star', colors: { primary: '#e8ecf0', secondary: '#3a6ad8', accent: '#ffb02e', metal: '#9aa6b8', glow: '#46e8ff' }, aura: 'stars' } },
  pharaoh: { name: 'Pharaoh', desc: 'Striped nemes, gold amulet and a holy staff.', weapon: 'staff', look: { base: 'human', skin: 'golden', headgear: 'pharaoh', outfit: 'priest', accessory: 'amulet', emblem: 'eye', weaponGlow: 'holy', colors: { primary: '#2a4ab8', secondary: '#f0e6c8', accent: '#e8b830' }, aura: 'holy' } },
  plaguedoctor: { name: 'Plague doctor', desc: 'Beaked mask, long coat and a toxic cloud.', weapon: 'staff', look: { base: 'human', headgear: 'plague', outfit: 'coat', gloves: 'leather', boots: 'tall', accessory: ['bandolier', 'pouches'], weaponGlow: 'poison', colors: { primary: '#2a2630', secondary: '#3e3a44', accent: '#8cf04a', metal: '#8a8e98' }, aura: 'poison' } },
  oni: { name: 'Oni', desc: 'Demon-masked samurai with tribal marks and a void katana.', weapon: 'katana', look: { base: 'human', build: 'bulky', skin: 'tan', hair: 'wild', hairColor: 'white', headgear: 'oni', outfit: 'samurai', markings: 'tribal', weaponGlow: 'void', colors: { primary: '#2a2a34', secondary: '#6a1e1e', accent: '#e8b830', marking: '#c0182a' }, aura: 'blood' } },
  pumpkinking: { name: 'Pumpkin king', desc: 'Jack-o\'-lantern head, royal robes and a burning scythe.', weapon: 'scythe', look: { base: 'undead', headgear: 'pumpkin', outfit: 'royal', cape: 'tattered', weaponGlow: 'flame', colors: { primary: '#3a2a4a', secondary: '#4a2a1a', accent: '#ffb02e', glow: '#ffb030' }, aura: 'ash' } },
  neko: { name: 'Neko idol', desc: 'Catfolk with twintails, odd eyes and hearts.', weapon: 'claws', look: { base: 'catfolk', skin: 'cream', hair: 'twintails', hairColor: 'white', eyeStyle: 'hetero', eyes: '#3a8ad8', eyes2: '#e8b020', face: 'blush', outfit: 'vest', accessory: 'earrings', boots: 'tall', colors: { primary: '#f07ab8', secondary: '#2a2a3a', accent: '#ffd23a' }, aura: 'hearts' } },
  frogmonk: { name: 'Frog monk', desc: 'Serene frogfolk in a kimono.', weapon: 'staff', look: { base: 'frogfolk', eyeStyle: 'closed', outfit: 'kimono', accessory: 'amulet', colors: { primary: '#c8a070', secondary: '#3a6a3a', accent: '#e8b830' }, aura: 'leaves' } },
  shroom: { name: 'Shroom druid', desc: 'Mushroom folk in leaf armour.', weapon: 'staff', look: { base: 'mushroom', hairColor: '#d83a34', outfit: 'leaf', colors: { primary: '#4a8a3a', secondary: '#8a5a32', accent: '#9cd84a' }, aura: 'leaves' } },
  crystalmage: { name: 'Crystal mage', desc: 'Living crystal in crystal armour with a frost wand.', weapon: 'wand', look: { base: 'crystal', outfit: 'crystal', weaponGlow: 'frost', colors: { primary: '#9a58d8', secondary: '#4a2a6a', accent: '#bff0ff' }, aura: 'frost' } },
  inferno: { name: 'Inferno', desc: 'Fire elemental with glowing runes and blazing fists.', weapon: 'fists', look: { base: 'fire', markings: 'runes', weaponGlow: 'flame', colors: { primary: '#6a1e0a', secondary: '#ffb030', accent: '#ffe08a', marking: '#fff0a0' }, aura: 'fire' } },
  ghostpirate: { name: 'Ghost pirate', desc: 'Spectral captain with a flintlock.', weapon: 'pistol', look: { base: 'ghost', headgear: 'bandana', face: 'eyepatch', outfit: 'pirate', colors: { primary: '#2a3a5a', secondary: '#8a2230', accent: '#e8b830' }, aura: 'void' } },
  slime: { name: 'Slime king', desc: 'A crowned slime in a bubble aura.', weapon: 'fists', look: { base: 'slime', headgear: 'crown', colors: { primary: '#3a9a3a', secondary: '#2a6a2a', accent: '#ffd23a' }, aura: 'bubbles' } },
  alien: { name: 'Alien invader', desc: 'Grey visitor in a spacesuit with an electric blaster.', weapon: 'pistol', look: { base: 'alien', outfit: 'spacesuit', weaponGlow: 'electric', colors: { primary: '#3a3a4a', secondary: '#8cf04a', accent: '#8cf04a', metal: '#9aa6b8', glow: '#8cf04a' }, aura: 'glitch' } },
  tengu: { name: 'Tengu archer', desc: 'Birdfolk archer with a quiver.', weapon: 'bow', look: { base: 'birdfolk', hairColor: '#c83a2a', outfit: 'leather', back: 'quiver', boots: 'sandals', colors: { primary: '#3a4a6a', secondary: '#c8a070', accent: '#e84a3a' }, aura: 'leaves' } },
  mantis: { name: 'Mantis assassin', desc: 'Insectoid ninja with poisoned daggers.', weapon: 'dagger', look: { base: 'insectoid', outfit: 'ninja', cape: 'scarf', weaponGlow: 'poison', colors: { primary: '#2a3a2e', secondary: '#8cf04a', accent: '#8cf04a' }, aura: 'poison' } },
  cyborg: { name: 'Cyber ronin', desc: 'Mech-winged robot with an electric katana.', weapon: 'katana', look: { base: 'robot', eyeStyle: 'visor', outfit: 'samurai', back: 'mech', tail: 'mech', weaponGlow: 'electric', colors: { primary: '#2a2e3a', secondary: '#ff3a6a', accent: '#3ff2ff', metal: '#9aa6b8', glow: '#3ff2ff' }, aura: 'glitch' } },
  gentleman: { name: 'Gentleman', desc: 'Suit, top hat and monocle.', weapon: 'pistol', look: { base: 'human', hair: 'sidepart', hairColor: 'grey', face: 'monocle', headgear: 'tophat', outfit: 'suit', gloves: 'wraps', colors: { primary: '#2a2a34', secondary: '#f0ece0', accent: '#b8282e' }, aura: 'music' } },
  kitsune: { name: 'Kitsune', desc: 'Fox spirit in a kimono with a bushy tail.', weapon: 'wand', look: { base: 'human', hair: 'long', hairColor: 'white', headgear: 'catears', tail: 'fox', outfit: 'kimono', markings: 'warpaint', eyes: '#e8a020', colors: { primary: '#f0ece0', secondary: '#c0182a', accent: '#e8b830', accent2: '#f0f0f0', marking: '#c0182a' }, aura: 'sakura' } },
  paladin: { name: 'Paladin', desc: 'Great helm, cross emblem, royal cape and a holy hammer.', weapon: 'hammer', look: { base: 'human', build: 'bulky', headgear: 'bucket', outfit: 'plate', emblem: 'cross', cape: 'royal', weaponGlow: 'holy', colors: { primary: '#f0ece0', secondary: '#b8282e', accent: '#e8b830', metal: '#c4ccd8' }, aura: 'holy' } },
  tiger: { name: 'Tiger brawler', desc: 'Striped catfolk with wrapped fists.', weapon: 'fists', look: { base: 'catfolk', skin: '#f0a040', hair: 'spiky', hairColor: '#e07a20', markings: 'stripes', outfit: 'barbarian', gloves: 'wraps', colors: { primary: '#2a2a2a', secondary: '#e07a20', accent: '#c0182a', marking: '#2a2230' }, aura: 'electric' } },
  shogun: { name: 'Shogun', desc: 'Samurai general with a war banner.', weapon: 'katana', look: { base: 'human', build: 'bulky', hair: 'topknot', hairColor: 'black', face: 'mustache', headgear: 'kabuto', outfit: 'samurai', back: 'banner', colors: { primary: '#b8282e', secondary: '#1e1e2a', accent: '#e8b830' } } },
  rockstar: { name: 'Rockstar', desc: 'Pompadour, shades and an electric axe.', weapon: 'axe', look: { base: 'human', hair: 'pompadour', hairColor: 'black', face: 'sunglasses', outfit: 'leather', accessory: ['bandolier', 'earrings'], gloves: 'spiked', boots: 'tall', weaponGlow: 'electric', colors: { primary: '#2a2a30', secondary: '#c0182a', accent: '#e8e8f0', pants: '#1e1e28' }, aura: 'music' } },
  adventurer: { name: 'Adventurer', desc: 'Backpack, sash, goggles and a trusty sword.', weapon: 'shortsword', look: { base: 'human', hair: 'messy', hairColor: 'auburn', markings: 'freckles', outfit: 'tunic', back: 'backpack', accessory: ['sash', 'goggles'], boots: 'leather', colors: { primary: '#3a7a4a', secondary: '#c0582a', accent: '#e8b830' }, aura: 'none' } },
  berserker: { name: 'Berserker', desc: 'Scarred, tattooed and carrying a sword on the back.', weapon: 'axe', look: { base: 'human', build: 'bulky', skin: 'tan', hair: 'undercut', hairColor: 'red', face: 'beard', markings: 'tattoos', outfit: 'barbarian', back: 'greatsword', boots: 'fur', shoulders: 'fur', colors: { primary: '#6e4a2e', secondary: '#8a5a34', accent: '#c0182a' }, aura: 'blood' } },
  starmage: { name: 'Star mage', desc: 'Starry cloak, star emblem and twinkling stars.', weapon: 'staff', look: { base: 'elf', hair: 'long', hairColor: 'silver', headgear: 'wizard', outfit: 'robe', cape: 'starry', emblem: 'moon', eyeStyle: 'glowing', eyes: '#9ad8ff', colors: { primary: '#2a2a6a', secondary: '#1e1e4a', accent: '#fff0a0' }, aura: 'stars' } },
});

const enumOf = (table) => Object.keys(table);
const DEFAULT_COLORS = { primary: '#4a6fb5', secondary: '#e8c878', accent: '#ffd23a', metal: '#b8c2d0' };

const LOOK_SCHEMA = {
  preset: { type: 'enum', values: ['none', ...enumOf(PRESETS)], default: 'none', desc: 'Start from a ready-made skin; every other field overrides it.' },
  base: { type: 'enum', values: enumOf(BASES), default: 'human', desc: 'Species / body type.' },
  build: { type: 'enum', values: enumOf(BUILDS), default: 'average', desc: 'Body build (base default if omitted).' },
  skin: { type: 'color', names: 'skin', default: 'base', desc: 'Skin / fur / bone / metal / stone colour: hex or a skin name.' },
  hair: { type: 'enum', values: enumOf(HAIR), default: 'base', desc: 'Hair style (base default if omitted).' },
  hairColor: { type: 'color', names: 'hair', default: 'base', desc: 'Hair colour: hex or a hair colour name.' },
  face: { type: 'enum', values: enumOf(FACES), default: 'plain', desc: 'Facial feature / accessory.' },
  eyes: { type: 'color', default: 'base', desc: 'Eye colour.' },
  headgear: { type: 'enum', values: enumOf(HEADGEAR), default: 'none', desc: 'Hat / helmet / crown…' },
  outfit: { type: 'enum', values: enumOf(OUTFITS), default: 'tunic', desc: 'Clothing / armour.' },
  cape: { type: 'enum', values: enumOf(CAPES), default: 'none', desc: 'Cape, cloak, scarf or mantle.' },
  shoulders: { type: 'enum', values: ['auto', ...enumOf(SHOULDERS)], default: 'auto', desc: 'Shoulder guards (auto = what the outfit comes with).' },
  colors: {
    type: 'object', desc: 'Outfit colours (default: the fighter\'s colors.primary/secondary).',
    fields: {
      primary: { type: 'color', default: DEFAULT_COLORS.primary, desc: 'Main clothing colour.' },
      secondary: { type: 'color', default: DEFAULT_COLORS.secondary, desc: 'Trim, trousers, cape.' },
      accent: { type: 'color', default: DEFAULT_COLORS.accent, desc: 'Emblems, gems, glowing bits, war paint.' },
      metal: { type: 'color', default: DEFAULT_COLORS.metal, desc: 'Armour and buckles.' },
      pants: { type: 'color', default: 'auto', desc: 'Trousers / leggings (default: a dark shade of primary).' },
      glow: { type: 'color', default: 'auto', desc: 'Glowing bits: orbs, visor, runes, weapon glow (default: aura / accent).' },
      accent2: { type: 'color', default: 'auto', desc: 'Wings, tails and back items (default: the item\'s own colour).' },
      marking: { type: 'color', default: 'auto', desc: 'Markings colour (default depends on the marking).' },
    },
  },
  leather: { type: 'color', default: '#6e4a2e', desc: 'Boots, belts, straps and gloves.' },
  weaponColor: { type: 'color', default: '#d4dce6', desc: 'Blade / weapon metal colour.' },
  aura: { type: 'enum', values: enumOf(AURAS), default: 'none', desc: 'Particle aura the arena draws around you.' },
  trail: { type: 'color', default: 'auto', desc: 'Weapon swing trail colour (default: from aura / accent).' },
  back: { type: 'enum', values: enumOf(BACKS), default: 'none', desc: 'Wings or an item on the back (wings flap in every animation).' },
  tail: { type: 'enum', values: enumOf(TAILS), default: 'base', desc: 'Tail (any base; "none" removes a base\'s own tail).' },
  eyeStyle: { type: 'enum', values: enumOf(EYE_STYLES), default: 'normal', desc: 'Eye style (the "eyes" field stays the eye colour).' },
  eyes2: { type: 'color', default: 'auto', desc: 'Second eye colour for eyeStyle "hetero".' },
  markings: { type: 'enum', values: enumOf(MARKINGS), default: 'none', desc: 'Skin markings (colour: colors.marking).' },
  emblem: { type: 'enum', values: enumOf(EMBLEMS), default: 'none', desc: 'Chest emblem in the accent colour.' },
  gloves: { type: 'enum', values: enumOf(GLOVES), default: 'none', desc: 'Gloves (none = what the outfit comes with).' },
  boots: { type: 'enum', values: enumOf(BOOTS), default: 'none', desc: 'Footwear (none = what the outfit comes with).' },
  accessory: { type: 'enum', values: enumOf(ACCESSORIES), default: 'none', list: 3, desc: 'Accessory, or a list of up to 3.' },
  weaponGlow: { type: 'enum', values: enumOf(WEAPON_GLOWS), default: 'none', desc: 'Elemental glow on your weapon (or fists).' },
};

function listNames(o) { return Object.keys(o).join(', '); }

/**
 * Normalise a raw look. Never throws: unknown fields/values produce warnings and defaults.
 * opts.colors: the fighter's {primary, secondary} used when look.colors omits them.
 */
function validateLook(raw, opts = {}) {
  const errors = [];
  const warnings = [];
  const fc = (opts && opts.colors) || {};
  let r = raw;
  if (r === undefined || r === null) r = {};
  else if (typeof r !== 'object' || Array.isArray(r)) {
    warnings.push('look must be an object like {"base": "elf", "outfit": "robe"} (ignored, using the default look)');
    r = {};
  }
  if (r.preset !== undefined && r.preset !== null && r.preset !== '' && r.preset !== 'none') {
    const pid = String(r.preset).trim().toLowerCase();
    if (PRESETS[pid]) {
      const pl = PRESETS[pid].look;
      const own = r.colors && typeof r.colors === 'object' && !Array.isArray(r.colors) ? r.colors : {};
      r = { ...pl, ...r, colors: { ...(pl.colors || {}), ...own } };
    } else warnings.push(`look.preset "${r.preset}" is unknown (ignored). Presets: ${Object.keys(PRESETS).join(', ')}`);
  }
  for (const k of Object.keys(r)) if (!LOOK_SCHEMA[k]) warnings.push(`look.${k} is not a look field (ignored). Fields: ${Object.keys(LOOK_SCHEMA).join(', ')}`);
  const pick = (key, table, def) => {
    const v = r[key];
    if (v === undefined || v === null || v === '') return def;
    const s = String(v).trim().toLowerCase();
    if (table[s] || (key === 'shoulders' && s === 'auto')) return s;
    warnings.push(`look.${key} "${v}" is unknown (using "${def}"). Options: ${key === 'shoulders' ? 'auto, ' : ''}${listNames(table)}`);
    return def;
  };
  const color = (path, v, def, names) => {
    if (v === undefined || v === null || v === '') return def;
    const c = parseColor(v, names);
    if (c) return c;
    warnings.push(`look.${path} "${v}" is not a colour (use "#rrggbb" or a colour name; using ${def})`);
    return def;
  };
  const look = {};
  if (r.preset && PRESETS[String(r.preset).trim().toLowerCase()]) look.preset = String(r.preset).trim().toLowerCase();
  look.base = pick('base', BASES, 'human');
  const B = BASES[look.base];
  look.build = pick('build', BUILDS, B.build || 'average');
  look.skin = color('skin', r.skin, SKIN_NAMES[B.skin] || parseColor(B.skin, SKIN_NAMES) || '#f2c9a0', SKIN_NAMES);
  look.hair = pick('hair', HAIR, B.hair || 'short');
  look.hairColor = color('hairColor', r.hairColor, parseColor(B.hairColor, HAIR_NAMES) || parseColor(B.hairColor, SKIN_NAMES) || '#6a4228', HAIR_NAMES);
  look.face = pick('face', FACES, B.face || 'plain');
  // friendly: "eyes": "glowing" is an eye STYLE, not a colour
  let eyeStyleFromEyes;
  if (typeof r.eyes === 'string' && EYE_STYLES[r.eyes.trim().toLowerCase()] && !parseColor(r.eyes)) {
    eyeStyleFromEyes = r.eyes.trim().toLowerCase();
    warnings.push(`look.eyes is the eye colour; "${r.eyes}" is an eye style, so it was used as "eyeStyle"`);
  }
  look.eyes = eyeStyleFromEyes ? (B.eyes || '#2e2a3a') : color('eyes', r.eyes, B.eyes || '#2e2a3a');
  look.headgear = pick('headgear', HEADGEAR, 'none');
  look.outfit = pick('outfit', OUTFITS, B.bones || B.robot || B.rock || B.dummy || B.bare ? 'none' : 'tunic');
  look.cape = pick('cape', CAPES, 'none');
  look.shoulders = pick('shoulders', SHOULDERS, 'auto');
  const rc = r.colors;
  if (rc !== undefined && (typeof rc !== 'object' || rc === null || Array.isArray(rc))) warnings.push('look.colors must be an object like {"primary": "#3355aa"} (ignored)');
  const cc = rc && typeof rc === 'object' && !Array.isArray(rc) ? rc : {};
  for (const k of Object.keys(cc)) if (!LOOK_SCHEMA.colors.fields[k]) warnings.push(`look.colors.${k} is not a colour slot (ignored). Slots: ${Object.keys(LOOK_SCHEMA.colors.fields).join(', ')}`);
  const fp = parseColor(fc.primary) || DEFAULT_COLORS.primary;
  const fs = parseColor(fc.secondary) || DEFAULT_COLORS.secondary;
  look.colors = {
    primary: color('colors.primary', cc.primary, fp),
    secondary: color('colors.secondary', cc.secondary, fs),
    accent: color('colors.accent', cc.accent, DEFAULT_COLORS.accent),
    metal: color('colors.metal', cc.metal, DEFAULT_COLORS.metal),
  };
  const pants = color('colors.pants', cc.pants, null);
  if (pants) look.colors.pants = pants;
  look.leather = color('leather', r.leather, '#6e4a2e');
  look.weaponColor = color('weaponColor', r.weaponColor, '#d4dce6');
  look.aura = pick('aura', AURAS, 'none');
  look.trail = r.trail === undefined || r.trail === null || r.trail === '' ? null : color('trail', r.trail, null);
  // ── v2 fields: only written when set (or implied by the base), so older looks validate exactly as before ──
  for (const k of ['glow', 'accent2', 'marking']) { const v = color(`colors.${k}`, cc[k], null); if (v) look.colors[k] = v; }
  const opt = (key, table) => {
    const v = r[key];
    if (v === undefined || v === null || v === '') return undefined;
    const s = String(v).trim().toLowerCase();
    if (table[s]) return s;
    warnings.push(`look.${key} "${v}" is unknown (ignored). Options: ${listNames(table)}`);
    return undefined;
  };
  const back = opt('back', BACKS);
  if (back !== undefined) look.back = back; else if (B.back) look.back = B.back;
  const tail = opt('tail', TAILS);
  if (tail !== undefined) look.tail = tail; else if (B.tail2) look.tail = B.tail2;
  const es = opt('eyeStyle', EYE_STYLES) || eyeStyleFromEyes;
  if (es) look.eyeStyle = es;
  const e2 = color('eyes2', r.eyes2, null);
  if (e2) look.eyes2 = e2;
  for (const [key, table] of [['markings', MARKINGS], ['emblem', EMBLEMS], ['gloves', GLOVES], ['boots', BOOTS], ['weaponGlow', WEAPON_GLOWS]]) {
    const v = opt(key, table);
    if (v !== undefined) look[key] = v; // an explicit 'none' is kept so it also overrides a preset
  }
  if (r.accessory !== undefined && r.accessory !== null && r.accessory !== '') {
    const list = Array.isArray(r.accessory) ? r.accessory : [r.accessory];
    const good = [];
    for (const a of list) {
      const s = String(a).trim().toLowerCase();
      if (s === 'none') continue;
      if (ACCESSORIES[s]) { if (!good.includes(s)) good.push(s); } else warnings.push(`look.accessory "${a}" is unknown (ignored). Options: ${listNames(ACCESSORIES)}`);
    }
    if (good.length > 3) { warnings.push('look.accessory: at most 3 accessories (the rest are ignored)'); good.length = 3; }
    look.accessory = good.length === 0 ? 'none' : good.length === 1 ? good[0] : good;
  }
  return { look, errors, warnings };
}

const cache = new Map();
/** look (raw or validated) + weapon id → { palette, frames }. Deterministic. */
function composeSprite(look, weaponId) {
  const v = validateLook(look).look;
  const wid = WEAPONS[weaponId] ? weaponId : 'fists';
  const key = JSON.stringify(v) + '|' + wid;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const M = buildModel(v, wid);
  const poses = buildPoses(M);
  const sets = {};
  for (const [anim, list] of Object.entries(poses)) sets[anim] = list.map(P => renderFrame(M, P));
  const sprite = toSprite(M, sets);
  const text = JSON.stringify(sprite);
  cache.set(key, text);
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  return JSON.parse(text);
}

function describe(table) { return Object.entries(table).map(([id, o]) => ({ id, name: o.name, desc: o.desc })); }

/** Every option with a short description (for docs / UI pickers). */
function lookCatalog() {
  return {
    bases: describe(BASES),
    builds: describe(BUILDS),
    hair: describe(HAIR),
    faces: describe(FACES),
    headgear: describe(HEADGEAR),
    outfits: describe(OUTFITS),
    capes: describe(CAPES),
    shoulders: [{ id: 'auto', name: 'Auto', desc: 'Whatever the outfit comes with.' }, ...describe(SHOULDERS)],
    backs: describe(BACKS),
    tails: describe(TAILS),
    eyeStyles: describe(EYE_STYLES),
    markings: describe(MARKINGS),
    emblems: describe(EMBLEMS),
    gloves: describe(GLOVES),
    boots: describe(BOOTS),
    accessories: describe(ACCESSORIES),
    weaponGlows: describe(WEAPON_GLOWS),
    auras: describe(AURAS),
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name, desc: p.desc, weapon: p.weapon, look: { preset: id } })),
    weapons: Object.entries(WEAPONS).map(([id, w]) => ({ id, name: w.name, kind: w.kind, desc: w.desc })),
    colors: {
      slots: Object.keys(LOOK_SCHEMA.colors.fields),
      names: Object.keys(NAMED),
      skin: Object.keys(SKIN_NAMES),
      hair: Object.keys(HAIR_NAMES),
    },
    animations: { ...ANIM_COUNTS },
  };
}

module.exports = {
  LOOK_SCHEMA, validateLook, composeSprite, lookCatalog,
  ANIMATIONS: { ...ANIM_COUNTS },
  WEAPON_KINDS: Object.fromEntries(Object.entries(WEAPONS).map(([id, w]) => [id, w.kind])),
  PRESETS,
  _internal: { buildModel, buildPoses, renderFrame, rawFrame, toSprite, ramp, tone, parseColor, BASES, HAIR, HEADGEAR, FACES, OUTFITS, CAPES, SHOULDERS, WEAPONS, GRIPS, BODY, BACKS, TAILS, EYE_STYLES, MARKINGS, EMBLEMS, GLOVES, BOOTS, ACCESSORIES, WEAPON_GLOWS, AURAS },
};
