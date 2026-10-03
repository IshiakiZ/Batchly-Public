// Modern Warfare — pixel-art sprites, built per army colour into small canvases.
// Soldiers are tiny side-view figures (facing right, flipped for left); vehicles, aircraft and ships are
// TOP-DOWN (nose toward +x) and pre-rotated into 32 directions (nearest-neighbour, so pixels stay crisp).
// Keys: P primary, p primary shade, q primary deep shade, Q primary light, S secondary, s secondary shade;
// everything else is a fixed palette colour. '.' is transparent.
import { shade, mix, lighten, colorDist, EMBLEM as ARMY_EMBLEM } from '../army/sprites.js';

export { shade, mix, lighten, colorDist };

const BASE = {
  k: '#15161c', d: '#343841', g: '#5d636e', G: '#9aa2ae', w: '#f2f2ee', y: '#ffd35a', o: '#ff9a30', r: '#c0392b',
  b: '#1d2129', c: '#8fd8ff', C: '#4a8cc4', n: '#e0ab80', t: '#23252a', T: '#474a52', h: '#8a92a0', H: '#4b515e',
  D: '#a89a78', e: '#6f7a5a', E: '#44502e', m: '#2e3a22', z: '#5a4a32',
};

// ── soldiers: side view, facing right; anchor = feet ────────────────────────
export const SOLDIERS = {
  rifle: { anchor: [2, 6], frames: [
    ['.pp..', '.pn..', 'PPPgg', '.PP..', '.qq..', '.q.q.', '.q.q.'],
    ['.pp..', '.pn..', 'PPPgg', '.PP..', '.qq..', '.q..q', 'q...q'],
    ['.pp..', '.pnoy', 'PPPgg', '.PP..', '.qq..', '.q.q.', '.q.q.'],
  ] },
  mg: { anchor: [2, 6], frames: [
    ['.pp...', '.pn...', 'PPggg.', '.PPg..', '.qq...', '.q.q..', '.q.q..'],
    ['.pp...', '.pn...', 'PPggg.', '.PPg..', '.qq...', '.q..q.', 'q...q.'],
    // set up: lying behind the gun on its bipod
    ['........', '........', '........', '........', '.pp...gg', 'qqPPPggg', '.....k.k'],
  ] },
  rocket: { anchor: [2, 6], frames: [
    ['.pp...', 'gggggo', '.PP...', '.PP...', '.qq...', '.q.q..', '.q.q..'],
    ['.pp...', 'gggggo', '.PP...', '.PP...', '.qq...', '.q..q.', 'q...q.'],
    ['.pp...', 'gggggy', '.PP...', '.PP...', '.qq...', '.q.q..', '.q.q..'],
  ] },
  sniper: { anchor: [3, 2], frames: [
    ['..EE....', 'eeEEeggg', '.E......'],
    ['..EE....', 'eeEEeggg', '.E......'],
    ['..EE....', 'eeEEeggy', '.E......'],
  ] },
  crew: { anchor: [2, 6], frames: [
    ['.pp..', '.pn..', 'PPP..', '.PP..', '.qq..', '.q.q.', '.q.q.'],
    ['.pp..', '.pn..', 'PPPn.', '.PP..', '.qq..', '.q..q', 'q...q'],
    ['.pp..', '.pn..', 'PPPn.', '.PP..', '.qq..', '.q.q.', '.q.q.'],
  ] },
};

// ── vehicles, aircraft, ships: top-down, nose toward +x ─────────────────────
// turret: [x, y] pivot of a gun turret drawn by the view (barrel = a pixel line), in sprite pixels
export const TOP = {
  jeep: { rows: [
    '.k...k..',
    'pPPPPcPQ',
    'pPPgPcPQ',
    'pPPPPcPQ',
    '.k...k..',
  ] },
  apc: { rows: [
    '.k.k.k.k..',
    'qpPPPPPPPQ',
    'qpPPPPPPPQ',
    'qpPPPPPPPQ',
    'qpPPPPPPPQ',
    '.k.k.k.k..',
  ], turret: [5, 2.5] },
  tank: { rows: [
    'tTtTtTtTtT.',
    'tTtTtTtTtT.',
    'qpPPPPPPPPQ',
    'qpPPPPPPPPQ',
    'qpPPPPPPPPQ',
    'tTtTtTtTtT.',
    'tTtTtTtTtT.',
  ], turret: [4.5, 3] },
  artillery: { rows: [
    'k......',
    '.k.....',
    '..gGGg.',
    '..gPPGg',
    '..gGGg.',
    '.k.....',
    'k......',
  ], turret: [4, 3] },
  antiair: { rows: [
    'tTtTtTtTt.',
    'qpPPPPPPPQ',
    'qpPPPPPPPQ',
    'qpPPPPPPPQ',
    'tTtTtTtTt.',
  ], turret: [4, 2] },
  mlrs: { rows: [
    '.k..k..k...',
    'GGGGGGG.pcP',
    'GkGkGkG.PcQ',
    'GkGkGkG.PcQ',
    'GGGGGGG.pcP',
    '.k..k..k...',
  ] },
  mammoth: { rows: [
    'tTtTtTtTtTtTt.',
    'tTtTtTtTtTtTt.',
    'tTtTtTtTtTtTt.',
    'qppPPPPPPPPPPQ',
    'qpPPPPPPPPPPPQ',
    'qpPPPPPPPPPPPQ',
    'qpPPPPPPPPPPPQ',
    'qppPPPPPPPPPPQ',
    'tTtTtTtTtTtTt.',
    'tTtTtTtTtTtTt.',
    'tTtTtTtTtTtTt.',
  ], turret: [6, 5] },
  hq: { rows: [
    '.k..k....k..k..',
    'qpPPPPPPPPPPPcQ',
    'qpPSSSSSSSPPPcQ',
    'qpPSGGGGGSPPPcQ',
    'qpPSSSSSSSPPPcQ',
    'qpPPPPPPPPPPPcQ',
    '.k..k....k..k..',
  ] },
  helicopter: { rows: [
    '.........gg..',
    'kp.....pPPPc.',
    '.ppppPPPPPPcc',
    'kp.....pPPPc.',
    '.........gg..',
  ], rotor: [8, 2] },
  drone: { rows: [
    '....g...',
    '....g...',
    'g...g...',
    'gGGGGGGw',
    'g...g...',
    '....g...',
    '....g...',
  ] },
  fighter: { rows: [
    '.k..........',
    '.kp.........',
    '..pPp.......',
    '..pPPPp.....',
    'kkPPPPPPPcQw',
    '..pPPPp.....',
    '..pPp.......',
    '.kp.........',
    '.k..........',
  ] },
  bomber: { rows: [
    '......p.......',
    '......pP......',
    '.....pPP......',
    '.....pPPg.....',
    '..k.pPPP......',
    '..kpPPP.......',
    'kpPPPPPPPPPPcw',
    '..kpPPP.......',
    '..k.pPPP......',
    '.....pPPg.....',
    '.....pPP......',
    '......pP......',
    '......p.......',
  ] },
  stealthbomber: { rows: [
    'b..........',
    'bb.........',
    '.bbb.......',
    'bbbbb......',
    '.bbbbbb....',
    '..bbbbbbb..',
    '.bbbbbbbbbq',
    '..bbbbbbb..',
    '.bbbbbb....',
    'bbbbb......',
    '.bbb.......',
    'bb.........',
    'b..........',
  ] },
  patrolboat: { rows: [
    '.HHHHHHHHH...',
    'HhhhhhPPhhhH.',
    'HhhhhGGPPhhhw',
    'HhhhhhPPhhhH.',
    '.HHHHHHHHH...',
  ], turret: [10, 2] },
  destroyer: { rows: [
    '..HHHHHHHHHHHHHHHH....',
    '.HhhhhhhhhhhhhhhhhhH..',
    'HhhhhgGGGhhPPPhhhhhhH.',
    'HhhhgGGGGGhPSPhhhhhhhw',
    'HhhhhgGGGhhPPPhhhhhhH.',
    '.HhhhhhhhhhhhhhhhhhH..',
    '..HHHHHHHHHHHHHHHH....',
  ], turret: [17, 3], turret2: [3, 3] },
  submarine: { rows: [
    '..HHHHHHHHHHHH...',
    'HHHHHHHHHkkHHHHH.',
    'HHHHHHHHHkkHHHHHH',
    'HHHHHHHHHHHHHHHH.',
    '..HHHHHHHHHHHH...',
  ] },
  battleship: { rows: [
    '...HHHHHHHHHHHHHHHHHHHHHHHH.....',
    '..HhhhhhhhhhhhhhhhhhhhhhhhhhH...',
    '.HhhhhhhhhhhhhhhhhhhhhhhhhhhhH..',
    'HhhhhhhhhhhGGGGPPPPhhhhhhhhhhhH.',
    'HhhhhhhhhhGGGGGPSSPhhhhhhhhhhhhw',
    'HhhhhhhhhhhGGGGPPPPhhhhhhhhhhhH.',
    '.HhhhhhhhhhhhhhhhhhhhhhhhhhhhH..',
    '..HhhhhhhhhhhhhhhhhhhhhhhhhhH...',
    '...HHHHHHHHHHHHHHHHHHHHHHHH.....',
  ], turret: [25, 4], turret2: [21, 4], turret3: [5, 4] },
};

function paint(rows, pal, flip) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  for (let j = 0; j < h; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.' || ch === ' ') continue;
      const col = pal[ch] || BASE[ch];
      if (!col) continue;
      x.fillStyle = col;
      x.fillRect(flip ? w - 1 - i : i, j, 1, 1);
    }
  }
  return c;
}
/** A copy of `src` with a 1-px rim of colour `col` around every opaque pixel (1 px of padding). */
function outlined(src, col) {
  const w = src.width + 2, h = src.height + 2;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const tint = silhouette(src, col);
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) x.drawImage(tint, dx, dy);
  x.drawImage(src, 1, 1);
  return c;
}
function silhouette(src, col) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = col;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** A burnt-out copy: the shape in soot tones, keeping a hint of the original shading. */
function charred(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    const v = 38 + l * 44;
    d[i] = v + 6; d[i + 1] = v; d[i + 2] = v - 4; d[i + 3] = 235;
  }
  g.putImageData(img, 0, 0);
  return c;
}
/** Rotate a pixel canvas by angle a (radians, screen coordinates: +y down) around (px, py), nearest neighbour. */
function rotate(src, a, px, py) {
  const w = src.width, h = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
  const R = Math.ceil(Math.hypot(Math.max(px, w - px), Math.max(py, h - py))) + 1;
  const size = R * 2 + 1;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const ca = Math.cos(a), sa = Math.sin(a);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - R, dy = y - R;
      const sx = Math.floor(px + dx * ca + dy * sa), sy = Math.floor(py - dx * sa + dy * ca);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const o = (sy * w + sx) * 4;
      if (sd[o + 3] === 0) continue;
      const p = (y * size + x) * 4;
      d[p] = sd[o]; d[p + 1] = sd[o + 1]; d[p + 2] = sd[o + 2]; d[p + 3] = sd[o + 3];
    }
  }
  g.putImageData(img, 0, 0);
  return { c, ax: R, ay: R };
}

export const DIRS = 32;

/** Everything one army wears: soldiers[type][frame][flip] and top-down sprites built lazily per direction. */
export function buildWarSprites(primary, secondary) {
  const pal = { P: primary, p: shade(primary, 0.72), q: shade(primary, 0.5), Q: lighten(primary, 0.3), S: secondary, s: shade(secondary, 0.7) };
  const soldiers = {};
  for (const [type, def] of Object.entries(SOLDIERS)) {
    soldiers[type] = def.frames.map(rows => [false, true].map(flip => {
      const w = Math.max(...rows.map(r => r.length));
      const c = outlined(paint(rows, pal, flip), 'rgba(12,12,16,0.55)');
      return { c, ax: (flip ? w - 1 - def.anchor[0] : def.anchor[0]) + 1, ay: def.anchor[1] + 1 };
    }));
  }
  const base = {};
  for (const [type, def] of Object.entries(TOP)) base[type] = paint(def.rows, pal, false);
  const cache = new Map();
  /** { c, ax, ay } for `type` facing angle a (radians); kind: 'body' | 'shadow' */
  function top(type, a, kind = 'body') {
    const def = TOP[type];
    if (!def) return null;
    let i = Math.round((((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * DIRS) % DIRS;
    const key = `${type}|${i}|${kind}`;
    let s = cache.get(key);
    if (s) return s;
    const src = base[type];
    const px = src.width / 2, py = src.height / 2;
    const r = rotate(src, i / DIRS * 2 * Math.PI, px, py);
    if (kind === 'shadow') s = { c: silhouette(r.c, '#000'), ax: r.ax, ay: r.ay };
    else if (kind === 'wreck') s = { c: charred(r.c), ax: r.ax, ay: r.ay };
    else if (kind === 'white') s = { c: silhouette(r.c, '#ffffff'), ax: r.ax, ay: r.ay };
    else { const o = outlined(r.c, 'rgba(10,10,14,0.6)'); s = { c: o, ax: r.ax + 1, ay: r.ay + 1 }; }
    cache.set(key, s);
    return s;
  }
  /** where a point of the unrotated sprite (sprite px) lands, relative to the sprite centre, at angle a */
  function mount(type, pt, a) {
    const def = TOP[type];
    const src = base[type];
    if (!def || !pt) return [0, 0];
    const dx = pt[0] - src.width / 2, dy = pt[1] - src.height / 2;
    const i = Math.round((((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * DIRS) % DIRS;
    const b = i / DIRS * 2 * Math.PI;
    return [dx * Math.cos(b) - dy * Math.sin(b), dx * Math.sin(b) + dy * Math.cos(b)];
  }
  return { soldiers, top, mount, pal };
}

// 5x5 flag emblems (1 = secondary colour): the war set, falling back to the army set
export const EMBLEM = Object.assign({}, ARMY_EMBLEM, {
  shield: ['11111', '11111', '11111', '.111.', '..1..'], lightning: ['...11', '..11.', '.111.', '.11..', '11...'],
  anchor: ['..1..', '.111.', '..1..', '1.1.1', '.111.'], wings: ['1...1', '11.11', '11111', '..1..', '.....'],
  crosshair: ['..1..', '.1.1.', '11.11', '.1.1.', '..1..'], trident: ['1.1.1', '1.1.1', '11111', '..1..', '..1..'],
  globe: ['.111.', '1.1.1', '11111', '1.1.1', '.111.'], hawk: ['1...1', '.1.1.', '11111', '.111.', '..1..'],
  tiger: ['1.1.1', '11111', '1.1.1', '11111', '.....'], cobra: ['.111.', '1.1.1', '.111.', '..1..', '.11..'],
});
