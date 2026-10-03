// ─────────────────────────────────────────────────────────────────────────────
//  Arena effect art: projectile sprites, impact bursts, status icons and look
//  auras. Everything is drawn with the renderer's pixel primitives into its
//  low-res buffer and is a pure function of time (scrubbing works).
// ─────────────────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

export function prand(n) {
  let t = (n * 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rgba(hex, a) {
  const h = String(hex || '#ffffff').replace('#', '');
  const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
  const n = parseInt(full, 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Mix two hex colours (k = 0 → a, 1 → b). */
export function mixHex(a, b, k) {
  const pa = hexRgb(a), pb = hexRgb(b);
  return '#' + [0, 1, 2].map(i => Math.round(pa[i] + (pb[i] - pa[i]) * k).toString(16).padStart(2, '0')).join('');
}
export function hexRgb(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const validHex = (c) => typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);

// ── projectiles ─────────────────────────────────────────────────────────────
/**
 * Draw one projectile. (X, Y) = its position in buffer px (already lifted to chest
 * height), dir = travel direction (radians), rr = radius in px, col = colour,
 * id = stable seed, tick = frame index (for flicker), trail = previous positions.
 */
export function drawProjectile(r, style, X, Y, dir, rr, col, id, tick) {
  const cos = Math.cos(dir), sin = Math.sin(dir);
  const light = mixHex(col, '#ffffff', 0.55);
  switch (style) {
    case 'arrow': {
      // shaft, steel head, coloured fletching
      r.line(X - cos * 7, Y - sin * 7, X - cos * 1, Y - sin * 1, '#d9c7a0');
      r.rect(X - 1 + cos, Y - 1 + sin, 2, 2, '#eef2f8');
      r.rect(X + cos * 2, Y + sin * 2, 1, 1, '#ffffff');
      const fx = X - cos * 7, fy = Y - sin * 7;
      r.rect(fx - sin, fy + cos, 1, 1, col); r.rect(fx + sin, fy - cos, 1, 1, col);
      r.rect(fx - cos - sin, fy - sin + cos, 1, 1, col); r.rect(fx - cos + sin, fy - sin - cos, 1, 1, col);
      break;
    }
    case 'bullet': {
      for (let k = 1; k <= 6; k++) r.rect(X - cos * k, Y - sin * k, 1, 1, rgba(col, 0.9 - k * 0.13));
      r.rect(X - 1, Y - 1, 2, 2, light);
      r.rect(X, Y, 1, 1, '#ffffff');
      break;
    }
    case 'spark': {
      const ph = (tick + id) % 4;
      r.rect(X, Y, 1, 1, '#ffffff');
      if (ph < 2) { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) r.rect(X + dx, Y + dy, 1, 1, light); for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) r.rect(X + dx, Y + dy, 1, 1, col); }
      else { for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) r.rect(X + dx, Y + dy, 1, 1, light); for (const [dx, dy] of [[2, 2], [-2, -2], [2, -2], [-2, 2]]) r.rect(X + dx, Y + dy, 1, 1, rgba(col, 0.7)); }
      for (let k = 1; k <= 3; k++) r.rect(X - cos * (k * 2 + 1), Y - sin * (k * 2 + 1) + ((k + tick) % 2), 1, 1, rgba(col, 0.8 - k * 0.2));
      break;
    }
    case 'bolt': {
      const L = Math.max(6, rr * 3);
      let px = X - cos * L, py = Y - sin * L;
      for (let k = 1; k <= 3; k++) {
        const j = (prand(id * 7 + k + Math.floor(tick / 2)) - 0.5) * 3;
        const nx = X - cos * L * (1 - k / 3) - sin * j, ny = Y - sin * L * (1 - k / 3) + cos * j;
        r.line(px, py, nx, ny, k === 3 ? '#ffffff' : col);
        px = nx; py = ny;
      }
      r.rect(X - 1, Y - 1, 2, 2, light);
      if ((tick + id) % 3 === 0) { r.rect(X + sin * 3, Y - cos * 3, 1, 1, light); r.rect(X - sin * 2 - cos * 3, Y + cos * 2 - sin * 3, 1, 1, col); }
      break;
    }
    case 'shard': {
      r.line(X - cos * rr * 2.2, Y - sin * rr * 2.2, X + cos * rr, Y + sin * rr, col, 2);
      r.line(X - cos * rr * 1.2, Y - sin * rr * 1.2, X + cos * rr, Y + sin * rr, light);
      r.rect(X + cos * (rr + 1), Y + sin * (rr + 1), 1, 1, '#ffffff');
      if ((tick + id) % 4 < 2) r.rect(X - cos * rr * 3 - sin * 2, Y - sin * rr * 3 + cos * 2, 1, 1, light);
      break;
    }
    case 'wave': {
      r.arcPixels(X - cos * rr, Y - sin * rr, rr + 2, dir - 1.1, dir + 1.1, col, 2);
      r.arcPixels(X - cos * rr, Y - sin * rr, rr + 1, dir - 0.7, dir + 0.7, light, 1);
      break;
    }
    case 'fireball': {
      for (let k = 4; k >= 1; k--) {
        const j = prand(id * 13 + k + tick) - 0.5;
        r.circleFill(X - cos * rr * k * 0.8 - sin * j * 2, Y - sin * rr * k * 0.8 + cos * j * 2, Math.max(0, rr - k * 0.8), k % 2 ? rgba('#ffb347', 0.75) : rgba(col, 0.65));
      }
      r.circleFill(X, Y, rr, col);
      r.circleFill(X - 1, Y - 1, Math.max(0, rr - 2), '#fff4c2');
      r.rect(X - 1, Y - 1, 1, 1, '#ffffff');
      for (let k = 0; k < 3; k++) {
        const ph = (tick * 0.13 + prand(id + k * 5)) % 1;
        r.rect(X - cos * (rr + 3 + ph * 8) + (prand(id + k) - 0.5) * 6, Y - sin * (rr + 3 + ph * 8) - ph * 3, 1, 1, ph > 0.5 ? '#ff6a2a' : '#ffd166');
      }
      break;
    }
    case 'boomerang': {
      const a = tick * 0.9 + id;
      for (let k = 0; k < 3; k++) {
        const an = a + k * TAU / 3;
        r.line(X, Y, X + Math.cos(an) * (rr + 2), Y + Math.sin(an) * (rr + 2), k ? col : light);
      }
      break;
    }
    default: { // orb
      r.circleFill(X, Y, rr + 1.5, rgba(col, 0.28));
      r.circleFill(X, Y, rr, col);
      if (rr >= 3) r.circleFill(X - 1, Y - 1, Math.max(1, rr - 2), light);
      r.rect(X - Math.max(1, rr >> 1), Y - Math.max(1, rr >> 1), 1, 1, '#ffffff');
      if ((tick + id) % 6 < 3) r.rect(X + rr + 1, Y - 1, 1, 1, light);
    }
  }
}

// ── impact bursts ───────────────────────────────────────────────────────────
/** Hit sparks shaped by what hit: slash / thrust / smash / claw / magic / fire / ice / bullet. */
export function impactBurst(r, kind, X, Y, age, col, seed, big = false) {
  const dur = big ? 0.42 : 0.3;
  if (age > dur) return;
  const k = age / dur;
  const e = 1 - (1 - k) * (1 - k);
  const light = mixHex(col, '#ffffff', 0.6);
  const n = big ? 12 : 8;
  switch (kind) {
    case 'slash': {
      // a bright diagonal cut + sparks
      if (k < 0.55) {
        const L = 5 + e * 6;
        const a = -0.8 + (prand(seed) - 0.5) * 0.5;
        r.line(X - Math.cos(a) * L, Y - Math.sin(a) * L, X + Math.cos(a) * L, Y + Math.sin(a) * L, k < 0.25 ? '#ffffff' : light, k < 0.3 ? 2 : 1);
      }
      break;
    }
    case 'thrust': {
      if (k < 0.5) { r.line(X - 6 * (1 - e), Y, X + 5, Y, '#ffffff'); r.rect(X + 5, Y - 1, 1, 3, light); }
      break;
    }
    case 'smash': {
      r.circleLine(X, Y, 3 + e * (big ? 12 : 8), rgba(light, 1 - k), 1);
      if (k < 0.4) r.circleFill(X, Y, 3 * (1 - k), '#ffffff');
      break;
    }
    case 'claw': {
      if (k < 0.6) for (let s = -1; s <= 1; s++) r.line(X - 4 + s * 3, Y - 5, X + 2 + s * 3, Y + 5, k < 0.3 ? '#ffffff' : light);
      break;
    }
    case 'fire': {
      for (let i = 0; i < 6; i++) {
        const an = prand(seed + i) * TAU, d = 2 + e * (5 + prand(seed + i + 9) * 6);
        r.rect(X + Math.cos(an) * d, Y + Math.sin(an) * d - e * 4, 2, 2, i % 2 ? '#ffd166' : '#ff5a1f');
      }
      if (k < 0.3) r.circleFill(X, Y, 4 * (1 - k), '#fff4c2');
      break;
    }
    case 'ice': {
      for (let i = 0; i < 5; i++) {
        const an = (i / 5) * TAU + prand(seed) * 2, d = 2 + e * 8;
        r.line(X + Math.cos(an) * d * 0.5, Y + Math.sin(an) * d * 0.5, X + Math.cos(an) * d, Y + Math.sin(an) * d, i % 2 ? '#ffffff' : light);
      }
      break;
    }
    default: break;
  }
  // generic sparks for everything
  for (let i = 0; i < n; i++) {
    const an = prand(seed * 13 + i) * TAU;
    const d = 2 + (6 + prand(seed + i) * (big ? 12 : 8)) * e;
    const s2 = k < 0.5 ? 2 : 1;
    r.rect(X + Math.cos(an) * d, Y + Math.sin(an) * d, s2, s2, i % 3 ? col : '#ffffff');
  }
}

// ── status icons (5×5 pixel bitmaps with a 1px dark outline) ────────────────
const IC = {
  stun: ['..y..', '.yyy.', 'yyyyy', '.yyy.', 'y...y'],
  slow: ['b...b', '.b.b.', '..b..', 'b...b', '.b.b.'],
  burn: ['..o..', '.oo..', '.oyo.', 'oyyyo', '.oyo.'],
  poison: ['..g..', '.gGg.', 'gGGGg', 'ggggg', '.ggg.'],
  bleed: ['..r..', '.rRr.', 'rRRRr', 'rrrrr', '.rrr.'],
  root: ['g.g.g', '.ggg.', '..n..', '.n.n.', 'n...n'],
  silence: ['vvvvv', 'vwvwv', 'vvwvv', 'vwvwv', '.vvvv'],
  vuln: ['rrrrr', 'rr.rr', 'r.r.r', '.rrr.', '..r..'],
  weak: ['..s..', '..s..', 's.s.s', '.sss.', '..s..'],
  immune: ['.YyY.', 'YyyyY', 'yyWyy', '.YyY.', '..Y..'],
  shield: ['BBBBB', 'BwBBB', 'BBBBB', '.BBB.', '..B..'],
  power: ['..r..', '.rrr.', 'r.r.r', '..r..', '..r..'],
  armor: ['sssss', 'sWsss', 'sssss', '.sss.', '..s..'],
  speed: ['y.y..', '.y.y.', '..y.y', '.y.y.', 'y.y..'],
  haste: ['c.c..', '.c.c.', '..c.c', '.c.c.', 'c.c..'],
  crit: ['o.o.o', '.ooo.', 'ooyoo', '.ooo.', 'o.o.o'],
  tenacity: ['.sss.', '..s..', 's.s.s', 's.s.s', '.sss.'],
  regen: ['..g..', '..g..', 'ggggg', '..g..', '..g..'],
  counter: ['w...w', '.w.w.', '..w..', '.w.w.', 'w...w'],
  invuln: ['.www.', 'w...w', 'w.w.w', 'w...w', '.www.'],
};
const ICOL = {
  y: '#ffe066', b: '#6cc6ff', o: '#ff7a2a', g: '#7ee06a', G: '#c8ff9a', r: '#ff4d5e', R: '#ff9aa6', n: '#a0703a',
  v: '#b88cff', w: '#ffffff', W: '#ffffff', Y: '#fff2a8', s: '#c8d0dc', B: '#8fd3ff', c: '#46e8ff',
};
const iconCache = new Map();
function iconCanvas(name) {
  if (iconCache.has(name)) return iconCache.get(name);
  const rows = IC[name];
  if (!rows) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 7;
  const g = c.getContext('2d');
  // outline
  g.fillStyle = '#0c0a12';
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    if (rows[y][x] === '.') continue;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) g.fillRect(x + 1 + dx, y + 1 + dy, 1, 1);
  }
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const ch = rows[y][x];
    if (ch === '.') continue;
    g.fillStyle = ICOL[ch] || '#ffffff';
    g.fillRect(x + 1, y + 1, 1, 1);
  }
  iconCache.set(name, c);
  return c;
}
export const STATUS_ICON_NAMES = Object.keys(IC);
/** Draw a row of status icons centred at (cx, y) (top of the icons). */
export function drawStatusIcons(r, names, cx, y, anim) {
  if (!names.length) return;
  const n = Math.min(names.length, 6);
  const w = n * 6 + 1;
  let x = Math.round(cx - w / 2);
  for (let i = 0; i < n; i++) {
    const c = iconCanvas(names[i]);
    if (!c) continue;
    const bob = (Math.floor(anim * 3 + i) % 4 === 0) ? -1 : 0;
    r.b.drawImage(c, x, y + bob);
    x += 6;
  }
}

// ── look auras ──────────────────────────────────────────────────────────────
/** Particles around a fighter. X = centre, footY = feet row, s = seed (side). */
export function drawAura(r, kind, X, footY, anim, s, strength = 1) {
  const top = footY - 30;
  switch (kind) {
    case 'fire': {
      r.ellipseFill(X, footY, 9, 2, 'rgba(255, 120, 40, 0.12)');
      for (let k = 0; k < 7; k++) {
        const ph = (anim * (0.7 + prand(s * 31 + k) * 0.5) + prand(s * 17 + k)) % 1;
        const x = X + Math.round((prand(s * 5 + k) - 0.5) * 20 + Math.sin(anim * 3 + k) * 1.5);
        const y = footY - 2 - ph * 30;
        if (ph > 0.92) continue;
        r.rect(x, y, 1, 1, rgba(ph < 0.35 ? '#ffe28a' : ph < 0.7 ? '#ff9a2a' : '#ff4a1a', (1 - ph) * strength));
      }
      break;
    }
    case 'frost': {
      r.ellipseFill(X, footY, 11, 2, 'rgba(180, 235, 255, 0.10)');
      for (let k = 0; k < 6; k++) {
        const ph = (anim * (0.25 + prand(s * 31 + k) * 0.2) + prand(s * 17 + k)) % 1;
        const x = X + Math.round((prand(s * 5 + k) - 0.5) * 24 + Math.sin(anim * 1.3 + k * 2) * 2);
        const y = top + ph * 32;
        const a = Math.sin(ph * Math.PI) * strength;
        r.rect(x, y, 1, 1, rgba('#ffffff', a));
        if (k % 3 === 0) { r.rect(x - 1, y, 1, 1, rgba('#bff4ff', a * 0.6)); r.rect(x + 1, y, 1, 1, rgba('#bff4ff', a * 0.6)); }
      }
      break;
    }
    case 'shadow': {
      r.ellipseFill(X, footY, 10, 2, 'rgba(40, 10, 70, 0.22)');
      for (let k = 0; k < 7; k++) {
        const ph = (anim * (0.35 + prand(s * 31 + k) * 0.25) + prand(s * 17 + k)) % 1;
        const x = X + Math.round((prand(s * 5 + k) - 0.5) * 18 + Math.sin(anim * 2 + k + ph * 5) * 3);
        const y = footY - ph * 26;
        r.rect(x, y, 2, 1, rgba(k % 2 ? '#2a1242' : '#6a3aa8', (1 - ph) * 0.8 * strength));
      }
      break;
    }
    case 'holy': {
      const pulse = 0.5 + 0.5 * Math.sin(anim * 2.4 + s);
      r.ellipseLine(X, footY, 11, 3, rgba('#ffe07a', (0.25 + 0.25 * pulse) * strength));
      for (let k = 0; k < 5; k++) {
        const ph = (anim * (0.2 + prand(s * 31 + k) * 0.15) + prand(s * 17 + k)) % 1;
        const x = X + Math.round((prand(s * 5 + k) - 0.5) * 22);
        const y = footY - 3 - ph * 28;
        const a = Math.sin(ph * Math.PI) * strength;
        r.rect(x, y, 1, 1, rgba('#fff6c2', a));
        if (k % 2 === 0) { r.rect(x, y - 1, 1, 1, rgba('#ffe07a', a * 0.6)); r.rect(x, y + 1, 1, 1, rgba('#ffe07a', a * 0.6)); }
      }
      break;
    }
    case 'storm': {
      const t = Math.floor(anim * 9);
      for (let k = 0; k < 2; k++) {
        const on = prand(s * 97 + t * 3 + k) < 0.45;
        if (!on) continue;
        let x = X + Math.round((prand(s * 7 + t + k * 13) - 0.5) * 22), y = top + 4 + Math.round(prand(s * 11 + t + k) * 20);
        for (let j = 0; j < 3; j++) {
          const nx = x + Math.round((prand(t * 5 + j + k) - 0.5) * 4), ny = y + 2 + Math.round(prand(t * 7 + j) * 2);
          r.line(x, y, nx, ny, j === 1 ? '#ffffff' : '#8fd0ff');
          x = nx; y = ny;
        }
      }
      break;
    }
    case 'poison': {
      for (let k = 0; k < 6; k++) {
        const ph = (anim * (0.45 + prand(s * 31 + k) * 0.3) + prand(s * 17 + k)) % 1;
        const x = X + Math.round((prand(s * 5 + k) - 0.5) * 18 + Math.sin(anim * 2.5 + k) * 1.5);
        const y = footY - 4 - ph * 24;
        const a = (1 - ph) * strength;
        if (ph < 0.85) r.circleLine(x, y, ph > 0.5 ? 1 : 0, rgba(k % 2 ? '#8cf04a' : '#4ac06a', a));
        else r.rect(x - 1, y, 3, 1, rgba('#c8ff9a', a));
      }
      break;
    }
    case 'electric': { // yellow-white zigzag arcs crackling on the body outline
      const t = Math.floor(anim * 12), cy = footY - 15;
      for (let k = 0; k < 3; k++) {
        if (prand(s * 53 + t * 5 + k) < 0.3) continue;
        const an = prand(s * 29 + t * 3 + k * 7) * TAU, ux = Math.cos(an), uy = Math.sin(an);
        let px = 0, py = 0;
        for (let j = 0; j <= 4; j++) {
          const z = j % 4 ? (j % 2 ? 1.6 : -1.6) * (0.6 + prand(t * 17 + k * 5 + j) * 0.8) : 0;
          const nx = X + ux * (8 + z) - uy * (j * 2 - 4), ny = cy + uy * (12 + z) + ux * (j * 2 - 4);
          if (j) r.line(px, py, nx, ny, rgba(j === 2 ? '#ffffff' : '#ffe24a', 0.9 * strength));
          px = nx; py = ny;
        }
        r.rect(X + ux * 11, cy + uy * 14, 1, 1, rgba('#fff7b0', 0.7 * strength));
      }
      break;
    }
    case 'void': { // dark motes spiralling INTO the body centre
      r.ellipseFill(X, footY, 10, 2, rgba('#0a0014', 0.45 * strength));
      for (let k = 0; k < 8; k++) {
        const ph = (anim * (0.45 + prand(s * 31 + k) * 0.3) + prand(s * 17 + k)) % 1;
        const an = (k + prand(s * 5 + k)) / 8 * TAU + ph * ph * 2.5, d = 1 + 13 * (1 - ph * ph), ux = Math.cos(an), uy = Math.sin(an);
        const a = Math.min(1, ph * 4, (1 - ph) * 5) * strength;
        r.rect(X + ux * d * 0.8, footY - 14 + uy * d, 1, 1, rgba(k % 3 ? '#7a44c8' : '#c8a8ff', a));
        r.rect(X + ux * (d + 2) * 0.8, footY - 14 + uy * (d + 2), 1, 1, rgba('#3a1664', a * 0.8));
      }
      break;
    }
    case 'blood': { // dark drops dripping off the body into a faint pool
      r.ellipseFill(X, footY, 8, 1, rgba('#5a0010', 0.4 * strength));
      for (let k = 0; k < 6; k++) {
        const ph = (anim * (0.45 + prand(s * 31 + k) * 0.35) + prand(s * 17 + k)) % 1;
        const x = X + Math.round(((k + prand(s * 5 + k)) / 6 - 0.5) * 16), y0 = footY - 10 - prand(s * 11 + k) * 16;
        const y = y0 + (footY - 2 - y0) * ph * ph, a = Math.min(1, ph * 5) * strength;
        if (ph > 0.94) { r.rect(x - 1, footY - 1, 1, 1, rgba('#c0182a', a * 0.7)); r.rect(x + 1, footY - 1, 1, 1, rgba('#c0182a', a * 0.7)); }
        else r.rect(x, y, 1, ph > 0.45 ? 2 : 1, rgba(k % 2 ? '#8e0a18' : '#c8202e', a));
      }
      break;
    }
    case 'sakura': { // two-tone pink petals fluttering down on a breeze
      for (let k = 0; k < 7; k++) {
        const ph = (anim * (0.2 + prand(s * 31 + k) * 0.15) + prand(s * 17 + k)) % 1, f = Math.floor(anim * 3 + k) % 2;
        const x = X + Math.round(((k + prand(s * 5 + k)) / 7 - 0.5) * 16 - 3 + ph * 6 + Math.sin(anim * 1.7 + k * 2) * 1.5), y = Math.round(top + ph * 29);
        const a = Math.sin(ph * Math.PI) * strength;
        r.rect(x, y, 1, 1, rgba('#ffd6e6', a)); r.rect(x + f, y + 1 - f, 1, 1, rgba(k % 3 ? '#ff9cc2' : '#ff76a8', a));
      }
      break;
    }
    case 'bubbles': { // hollow bubbles wobbling up, popping at the top
      for (let k = 0; k < 6; k++) {
        const ph = (anim * (0.3 + prand(s * 31 + k) * 0.2) + prand(s * 17 + k)) % 1, sz = k % 3 ? 1 : 2;
        const x = X + Math.round(((k + prand(s * 5 + k)) / 6 - 0.5) * 18 + Math.sin(anim * 3 + k * 1.7) * 1.5), y = Math.round(footY - 3 - ph * 25);
        const a = Math.min(1, ph * 5) * 0.85 * strength;
        if (ph < 0.9) { r.circleLine(x, y, sz, rgba('#9fe4ff', a)); r.rect(x - sz + 1, y - 1, 1, 1, rgba('#ffffff', a)); }
        else for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) r.rect(x + dx * (sz + 1), y + dy * (sz + 1), 1, 1, rgba('#dff6ff', (1 - ph) * 8 * strength));
      }
      break;
    }
    case 'music': { // little eighth / quarter notes floating up
      for (let k = 0; k < 5; k++) {
        const ph = (anim * (0.22 + prand(s * 31 + k) * 0.15) + prand(s * 17 + k)) % 1;
        const x = X + Math.round(((k + prand(s * 5 + k)) / 5 - 0.5) * 16 + Math.sin(anim * 2 + k * 2) * 2), y = Math.round(footY - 8 - ph * 21);
        const c = rgba(['#ff7ad9', '#7ad0ff', '#ffe066', '#9dff8a'][k % 4], Math.sin(ph * Math.PI) * strength);
        r.rect(x + 1, y, 1, 3, c); r.rect(x, y + 3, 2, 1, c);
        if (k % 2 === 0) r.rect(x + 2, y + 1, 1, 1, c);
      }
      break;
    }
    case 'rainbow': { // two rainbow comets orbiting on a tilted ring, hues flowing down their tails
      const RB = ['#ff5a5a', '#ffa04a', '#ffe45a', '#6ae06a', '#5ab8ff', '#7a7aff', '#c77aff'];
      for (let k = 0; k < 7; k++) for (let h = 0; h < 2; h++) {
        const an = anim * 1.8 + h * Math.PI + s - k * 0.14, c = RB[(k + Math.floor(anim * 6)) % 7];
        const a = (1 - k * 0.1) * (Math.sin(an) > 0 ? 0.8 : 0.35) * strength;
        r.rect(X + Math.cos(an) * 11, footY - 13 + Math.sin(an) * 3 + Math.cos(an) * 2, 1, 1, rgba(c, a));
      }
      break;
    }
    case 'glitch': { // cyan/magenta split bars + blocks, quiet with bursts
      const t = Math.floor(anim * 10), burst = prand(s * 3 + Math.floor(anim * 2.5)) < 0.55;
      for (let k = 0; k < 5; k++) {
        const p = prand(s * 41 + t * 7 + k);
        if (p < (burst ? 0.35 : 0.85)) continue;
        const x = X - 10 + Math.floor(prand(s * 43 + t * 5 + k) * 14), y = footY - 2 - Math.floor(prand(s * 47 + t * 3 + k) * 26);
        if (k < 3) { const w = 2 + Math.floor(prand(t * 9 + k) * 7); r.rect(x - 1, y, w, 1, rgba('#28f0ff', 0.7 * strength)); r.rect(x + 1, y, w, 1, rgba('#ff3cd2', 0.6 * strength)); }
        else r.rect(x, y, 2, 2, rgba(k % 2 ? '#28f0ff' : '#ff3cd2', 0.75 * strength));
      }
      break;
    }
    case 'stars': { // 4-point stars orbiting at different heights, twinkling
      for (let k = 0; k < 5; k++) {
        const an = anim * 0.9 + k * 2.4 + s, x = Math.round(X + Math.cos(an) * 10), y = Math.round(footY - 4 - k * 5.5 + Math.sin(anim * 1.3 + k) * 1.5);
        const tw = 0.5 + 0.5 * Math.sin(anim * 4 + k * 1.9), a = (0.35 + 0.65 * tw) * (Math.sin(an) > 0 ? 1 : 0.55) * strength;
        const arm = rgba(k % 2 ? '#ffe890' : '#a8d8ff', a * 0.7), tip = rgba(k % 2 ? '#ffe890' : '#a8d8ff', a * 0.35);
        r.rect(x, y, 1, 1, rgba('#ffffff', a));
        if (tw > 0.45) { r.rect(x - 1, y, 1, 1, arm); r.rect(x + 1, y, 1, 1, arm); r.rect(x, y - 1, 1, 1, arm); r.rect(x, y + 1, 1, 1, arm); }
        if (tw > 0.9) { r.rect(x - 2, y, 1, 1, tip); r.rect(x + 2, y, 1, 1, tip); r.rect(x, y - 2, 1, 1, tip); r.rect(x, y + 2, 1, 1, tip); }
      }
      break;
    }
    case 'leaves': { // diagonal 2-px leaves tumbling down on a pendulum sway
      for (let k = 0; k < 6; k++) {
        const ph = (anim * (0.3 + prand(s * 31 + k) * 0.2) + prand(s * 17 + k)) % 1, sw = anim * 2.4 + k * 1.3;
        const x = X + Math.round(((k + prand(s * 5 + k)) / 6 - 0.5) * 16 + Math.sin(sw) * 3.5), y = Math.round(top + ph * 29);
        const a = Math.sin(ph * Math.PI) * strength, c = ['#7ad04a', '#f0a030', '#e8683a', '#f0d050', '#5ab84a'][k % 5];
        r.rect(x, y, 1, 1, rgba(c, a)); r.rect(x + (Math.cos(sw) > 0 ? 1 : -1), y + 1, 1, 1, rgba(c, a * 0.75));
      }
      break;
    }
    case 'ash': { // grey flakes and a few dim embers drifting slowly up
      r.ellipseFill(X, footY, 9, 2, rgba('#2a2a2e', 0.3 * strength));
      for (let k = 0; k < 8; k++) {
        const ph = (anim * (0.14 + prand(s * 31 + k) * 0.1) + prand(s * 17 + k)) % 1;
        const x = X + Math.round(((k + prand(s * 5 + k)) / 8 - 0.5) * 20 + Math.sin(anim * 1.1 + k * 2) * 2), y = footY - 2 - ph * 28;
        const a = Math.sin(ph * Math.PI) * 0.85 * strength;
        if (k % 4 === 0) r.rect(x, y, 1, 1, rgba(Math.sin(anim * 7 + k) > 0 ? '#ffa04a' : '#e0501a', a));
        else r.rect(x, y, k % 3 ? 1 : 2, 1, rgba(['#b4b4ba', '#dcdce0', '#909098'][k % 3], a));
      }
      break;
    }
    case 'hearts': { // small pink/red pixel hearts floating up
      for (let k = 0; k < 5; k++) {
        const ph = (anim * (0.25 + prand(s * 31 + k) * 0.15) + prand(s * 17 + k)) % 1;
        const x = X + Math.round(((k + prand(s * 5 + k)) / 5 - 0.5) * 16 + Math.sin(anim * 2 + k * 2.3) * 1.5), y = Math.round(footY - 7 - ph * 20);
        const c = rgba(['#ff5a8a', '#ff2a4a', '#ff8ab8'][k % 3], Math.sin(ph * Math.PI) * strength);
        if (k % 3 === 0) { r.rect(x - 2, y, 2, 1, c); r.rect(x + 1, y, 2, 1, c); r.rect(x - 2, y + 1, 5, 1, c); r.rect(x - 1, y + 2, 3, 1, c); r.rect(x, y + 3, 1, 1, c); }
        else { r.rect(x - 1, y, 1, 1, c); r.rect(x + 1, y, 1, 1, c); r.rect(x - 1, y + 1, 3, 1, c); r.rect(x, y + 2, 1, 1, c); }
      }
      break;
    }
    default: break;
  }
}
