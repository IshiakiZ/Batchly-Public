// ─────────────────────────────────────────────────────────────────────────────
//  Pixel-art arena renderer.
//  The scene is drawn into a small buffer where 1 buffer pixel = 1 sprite pixel
//  (a 32 px sprite = 72 world units), then scaled up by a whole number with no
//  smoothing — so fighters, effects and text all share one crisp pixel grid.
//  Rendering is a pure function of (replay, t): live play, scrubbing and the
//  mini sparring views all use it.
//
//  v3: full character animations (idle, walk synced to speed, attack spread over
//  the windup, cast, dash, hurt, KO sequence, victory, block), procedural motion
//  (lunges, recoil, squash & stretch, dust, afterimages, weapon trails), arena
//  obstacles with depth sorting, beams, traps, counters, meteors, cleanses, crits,
//  status icons, look auras and a debug overlay for brains' `draw` shapes.
//  v2 replays (no traps/beams/obstacles/look) render exactly as before or better.
// ─────────────────────────────────────────────────────────────────────────────
import { pixelSprite, whiteOf, tintOf, animFrames, hasAnim, ANIM_FPS, SIZE } from './sprites.js';
import { drawProjectile, impactBurst, drawStatusIcons, drawAura, prand, rgba, mixHex, validHex } from './art-fx.js';
import { obstacleArt } from './art-obstacles.js';
import { createPowersPlugin } from './art-powers.js'; // plugin: godly powers / cinematics layer

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const K = SIZE / 72; // buffer px per world unit
const LIFT = 7;      // projectiles and beams fly at hand height, this many px above the floor point
const STRIDE = 92;   // world units travelled per full walk cycle (walk animation is synced to it)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Critically damped spring toward `target` (no overshoot); returns [value, velocity]. */
function smoothDamp(cur, target, vel, smoothTime, dt, maxSpeed = Infinity) {
  if (!(dt > 0)) return [cur, vel];
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = maxSpeed * smoothTime;
  const change = clamp(cur - target, -maxChange, maxChange);
  const goal = cur - change;
  const temp = (vel + omega * change) * dt;
  let v = (vel - omega * temp) * exp;
  let out = goal + (change + temp) * exp;
  if ((target - cur > 0) === (out > target)) { out = target; v = 0; }
  return [out, v];
}

const F = {
  STUN: 1, SLOW: 2, BURN: 4, INVULN: 8, DASH: 16, POWER: 32, ARMOR: 64, SPEED: 128, REGEN: 256, SHIELD: 512, KO: 1024, HOT: 2048, KNOCK: 4096, CAST: 8192,
  ROOT: 1 << 14, SILENCE: 1 << 15, VULN: 1 << 16, WEAK: 1 << 17, POISON: 1 << 18, IMMUNE: 1 << 19, COUNTER: 1 << 20, CHANNEL: 1 << 21,
  HASTE: 1 << 22, CRITBUFF: 1 << 23, TENACITY: 1 << 24, BLEED: 1 << 25,
};
const HF = {
  STUN: 1, RESISTED: 2, SLOW: 4, BURN: 8, KNOCK: 16, LIFESTEAL: 32, CRIT: 64, ROOT: 128, SILENCE: 256, VULN: 512, WEAK: 1024,
  POISON: 2048, DRAIN: 4096, BLOCK: 8192, BASIC: 16384,
};
export { F as FLAGS, HF as HIT_FLAGS };
export const PIXEL_FONT = '"Press Start 2P", "Courier New", monospace';

const easeOut = (k) => 1 - (1 - k) * (1 - k);
const MELEE_STYLES = new Set(['slash', 'thrust', 'smash', 'claw']);
const KIND_STYLE = { slash: 'slash', thrust: 'thrust', smash: 'smash', claw: 'claw' };

// ── arena themes (purely visual — the rules never change) ────────────────────
export const THEMES = {
  colosseum: { name: 'Stone Colosseum', voidCol: '#07080d', stand: [26, 29, 42], standAlt: [32, 36, 52], rim: [58, 64, 80], rimOut: [18, 21, 30], ringCol: '#8fa9e8', floor: 'tiles', base: [30, 35, 50], ambient: 'motes', ambientCol: ['#8f9bc0', '#6f7aa0'] },
  lava: { name: 'Lava Forge', voidCol: '#0b0403', stand: [38, 20, 16], standAlt: [46, 24, 18], rim: [128, 52, 24], rimOut: [30, 10, 6], ringCol: '#ffb347', floor: 'basalt', base: [40, 29, 28], crack: [255, 106, 30], ambient: 'embers', ambientCol: ['#ff8a1f', '#ffd166', '#ff5a1f'] },
  frost: { name: 'Frost Lake', voidCol: '#04080f', stand: [24, 36, 54], standAlt: [30, 44, 64], rim: [150, 196, 230], rimOut: [16, 28, 44], ringCol: '#bff4ff', floor: 'ice', base: [42, 76, 110], crack: [176, 224, 248], ambient: 'snow', ambientCol: ['#ffffff', '#dff6ff'] },
  neon: { name: 'Neon Grid', voidCol: '#040210', stand: [22, 12, 38], standAlt: [28, 16, 48], rim: [255, 64, 200], rimOut: [20, 6, 30], ringCol: '#3ff2ff', floor: 'grid', base: [14, 10, 30], ambient: 'sparks', ambientCol: ['#ff3fd0', '#3ff2ff', '#fff36b'] },
  forest: { name: 'Forest Glade', voidCol: '#040805', stand: [28, 38, 24], standAlt: [34, 46, 28], rim: [98, 72, 44], rimOut: [20, 16, 10], ringCol: '#c8f07a', floor: 'grass', base: [40, 74, 40], ambient: 'fireflies', ambientCol: ['#e8ff7a', '#b6ff5c'] },
  desert: { name: 'Desert Ruins', voidCol: '#0c0804', stand: [54, 42, 28], standAlt: [64, 50, 32], rim: [156, 122, 74], rimOut: [34, 24, 14], ringCol: '#ffe0a0', floor: 'sand', base: [116, 90, 58], ambient: 'dust', ambientCol: ['#e8c89a', '#c9a878'] },
};
const SKINS = ['#f0cfa8', '#d8a47e', '#a8744e', '#6e4a30', '#ffe0c0'];
const SHIRTS = ['#5b6283', '#8a92b0', '#3a4a6e', '#6e3a4a', '#4a6e52', '#7a6a3a', '#40405a', '#9a5a3a', '#2e5a6a', '#6a4a8a'];
const DUST = {
  colosseum: '#9aa3bd', lava: '#6e5a58', frost: '#dff4ff', neon: '#8a6ad8', forest: '#8a9a64', desert: '#e0c89a', celestial: '#c8b8ff',
  swamp: '#6e7c52', sky: '#eef2fa', graveyard: '#8a948c', dojo: '#c8a070', ship: '#b08a60', jungle: '#8a9a60', crystal: '#b89ae8',
  rooftop: '#9aa8c8', beach: '#f0d0a0', castle: '#b0aab0', factory: '#a8a8b0', candy: '#ffd0e8', olympus: '#fff0c0', abyss: '#a060e0',
};
// v4 stances (frame field 13): 0 balanced, 1 aggressive, 2 defensive, 3 swift
const STANCES = ['balanced', 'aggressive', 'defensive', 'swift'];
const STANCE_COL = ['#c8d0dc', '#ff5a4a', '#6cb8ff', '#ffe066'];
// Celestial (levels 10–12): a cosmic god-arena. Its obstacles reuse the marble pillars.
THEMES.celestial = { name: 'Celestial Throne', voidCol: '#03020a', stand: [18, 14, 40], standAlt: [24, 18, 52], rim: [226, 196, 120], rimOut: [30, 22, 60], ringCol: '#ffe7a0', floor: 'cosmic', base: [22, 18, 48], ambient: 'stars', ambientCol: ['#ffffff', '#ffe7a0', '#b8c8ff'] };
// More arenas (rounds 2–9 rotate through all regular ones; olympus = level 11, abyss = level 12).
// voidFx paints the world outside the stands (sea, clouds, city lights…); mist adds drifting fog puffs.
Object.assign(THEMES, {
  swamp: { name: 'Witchwood Swamp', voidCol: '#030604', stand: [24, 32, 22], standAlt: [30, 38, 26], rim: [76, 88, 54], rimOut: [14, 18, 12], ringCol: '#c8f07a', floor: 'bog', base: [40, 50, 32], ambient: 'wisps', ambientCol: ['#d8ff7a', '#9affc8', '#f4ffa8'], mist: '#b8d0a8' },
  sky: { name: 'Sky Temple', voidCol: '#7fa6dc', stand: [150, 158, 184], standAlt: [164, 172, 198], rim: [232, 206, 136], rimOut: [104, 124, 170], ringCol: '#ffe08a', floor: 'marble', base: [132, 140, 162], ambient: 'clouds', ambientCol: ['#ffffff', '#eef4ff'], voidFx: 'clouds' },
  graveyard: { name: 'Haunted Graveyard', voidCol: '#04050a', stand: [28, 30, 36], standAlt: [34, 36, 44], rim: [88, 92, 100], rimOut: [14, 16, 20], ringCol: '#a8f0d0', floor: 'grave', base: [38, 46, 44], ambient: 'ghosts', ambientCol: ['#bfe8ff', '#a8f0d0'], mist: '#a8b8cc', voidFx: 'moon' },
  dojo: { name: 'Sakura Dojo', voidCol: '#0b0605', stand: [62, 36, 30], standAlt: [72, 42, 34], rim: [168, 44, 38], rimOut: [30, 14, 10], ringCol: '#ffb4cc', floor: 'planks', base: [118, 82, 52], ambient: 'petals', ambientCol: ['#ffb4cc', '#ff8ab4', '#ffe4ee'] },
  ship: { name: 'Pirate Deck', voidCol: '#0d3552', stand: [72, 50, 34], standAlt: [82, 58, 38], rim: [156, 116, 62], rimOut: [34, 22, 14], ringCol: '#ffe0a0', floor: 'deck', base: [104, 72, 44], ambient: 'spray', ambientCol: ['#e8f6ff', '#bfe4f8'], voidFx: 'sea' },
  jungle: { name: 'Jungle Temple', voidCol: '#030803', stand: [30, 44, 26], standAlt: [36, 52, 30], rim: [104, 110, 76], rimOut: [16, 22, 12], ringCol: '#e8f07a', floor: 'temple', base: [74, 80, 62], ambient: 'leaves', ambientCol: ['#6fbf3a', '#9ad85a', '#3f8f2a'] },
  crystal: { name: 'Crystal Cavern', voidCol: '#040209', stand: [26, 20, 40], standAlt: [32, 24, 50], rim: [150, 96, 224], rimOut: [16, 10, 26], ringCol: '#e4a8ff', floor: 'cave', base: [36, 32, 50], ambient: 'sparkle', ambientCol: ['#e0a8ff', '#8af0ff', '#ffa8e8'], voidFx: 'glints' },
  rooftop: { name: 'Rain Rooftop', voidCol: '#05060d', stand: [32, 34, 46], standAlt: [38, 40, 54], rim: [86, 90, 104], rimOut: [12, 12, 18], ringCol: '#ff5ad8', floor: 'roof', base: [46, 48, 56], ambient: 'rain', ambientCol: ['#9ab4dc', '#c8d8f0'], voidFx: 'city' },
  beach: { name: 'Sunset Beach', voidCol: '#3c3f78', stand: [134, 100, 78], standAlt: [146, 108, 82], rim: [236, 206, 156], rimOut: [70, 92, 130], ringCol: '#ffd08a', floor: 'beach', base: [150, 110, 82], ambient: 'glow', ambientCol: ['#ffd9a0', '#ffb080', '#ff9ab0'], voidFx: 'sunsea' },
  castle: { name: 'Castle Courtyard', voidCol: '#06070a', stand: [50, 50, 58], standAlt: [58, 58, 68], rim: [124, 120, 114], rimOut: [20, 20, 26], ringCol: '#ffd166', floor: 'flagstone', base: [86, 84, 92], ambient: 'motes', ambientCol: ['#ffe8b0', '#d8d0c0'], banners: ['#a8242c', '#2a4a9a'] },
  factory: { name: 'Clockwork Factory', voidCol: '#080605', stand: [46, 42, 38], standAlt: [54, 48, 42], rim: [160, 120, 54], rimOut: [20, 16, 12], ringCol: '#ffb347', floor: 'metal', base: [62, 64, 70], ambient: 'steam', ambientCol: ['#e0e0e0', '#bcbcbc', '#ffb347'] },
  candy: { name: 'Candy Kingdom', voidCol: '#24102c', stand: [176, 84, 140], standAlt: [96, 170, 168], rim: [255, 240, 248], rimOut: [150, 60, 118], ringCol: '#ffffff', floor: 'candy', base: [176, 110, 148], ambient: 'sprinkles', ambientCol: ['#ff5aa8', '#5ad8ff', '#fff05a', '#7aff8a', '#ffffff', '#b47aff'] },
});
THEMES.olympus = { name: 'Mount Olympus', voidCol: '#b88a4a', stand: [190, 180, 160], standAlt: [204, 194, 172], rim: [255, 214, 110], rimOut: [150, 112, 60], ringCol: '#fff2b0', floor: 'olympus', base: [156, 142, 114], ambient: 'sunbeams', ambientCol: ['#fff4c8', '#ffe08a'], voidFx: 'goldclouds' };
THEMES.abyss = { name: 'The Abyss', voidCol: '#020104', stand: [22, 10, 30], standAlt: [28, 12, 38], rim: [124, 42, 176], rimOut: [10, 4, 16], ringCol: '#c868ff', floor: 'abyss', base: [16, 8, 24], ambient: 'runes', ambientCol: ['#c868ff', '#ff5aa8', '#8a5aff'], voidFx: 'eyes' };
const OBSTACLE_THEME = { celestial: 'colosseum' };

// Voronoi cells: distance to the nearest and second-nearest seed (for cracks).
function voronoi(x, y, C, salt) {
  const gx = Math.floor(x / C), gy = Math.floor(y / C);
  let d1 = 1e9, d2 = 1e9, id = 0, ax = 0, ay = 0, bx = 0, by = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i, cy = gy + j;
      const h = (cx * 73856093) ^ (cy * 19349663) ^ salt;
      const sx = (cx + prand(h)) * C, sy = (cy + prand(h + 1)) * C;
      const d = Math.hypot(x - sx, y - sy);
      if (d < d1) { d2 = d1; bx = ax; by = ay; d1 = d; id = h; ax = sx; ay = sy; } else if (d < d2) { d2 = d; bx = sx; by = sy; }
    }
  }
  return { edge: d2 - d1, id, sep: Math.hypot(ax - bx, ay - by) };   // sep: distance between the two nearest seeds
}

// ── more floor styles: fn(ux, uy, dx, dy, d, R, px, mark, theme) → [r, g, b] ──────────
// (ux, uy) = floor pixel (offset so always > 0), (dx, dy, d) = from the arena centre,
// R = arena radius in px, px = per-pixel noise in [0,1), mark = centre / half-ring marks.
// smooth value noise in [0, 1] (cell size s px), plus a 2-octave fractal version
function vnoise(x, y, s, seed) {
  const fx = x / s, fy = y / s, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const h = (i, j) => prand(((i * 73856093) ^ (j * 19349663) ^ seed) >>> 0);
  const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fnoise = (x, y, s, seed) => vnoise(x, y, s, seed) * 0.65 + vnoise(x, y, s * 0.45, seed + 7) * 0.35;
const SPRINKLES = [[255, 90, 160], [90, 214, 255], [255, 232, 90], [120, 232, 130], [250, 250, 250], [184, 124, 255]];
const AMBIENT_MORE = new Set(['wisps', 'ghosts', 'petals', 'leaves', 'spray', 'sparkle', 'rain', 'clouds', 'glow', 'steam', 'sprinkles', 'sunbeams', 'runes']);
const FLOORS = {
  bog(ux, uy, dx, dy, d, R, px, mark, th) { // swamp: mud and moss around pools of dark water with lily pads
    const [br, bg, bb] = th.base;
    const n = fnoise(ux, uy, 64, 11);
    if (n > 0.6 && d > 36) {
      const deep = Math.min(1, (n - 0.6) * 6);
      let r = 26 - deep * 8 + px * 4, g = 42 - deep * 10 + px * 5, b = 40 - deep * 4 + px * 5;
      if (uy % 5 === 0 && prand(Math.floor(ux / 6) * 97 + uy * 13) > 0.82) { r += 20; g += 28; b += 24; }
      const tx = Math.floor(ux / 11), ty = Math.floor(uy / 11), h = prand(tx * 131 + ty * 977);
      if (h > 0.88 && deep > 0.25) {
        const qx = ux + 0.5 - (tx * 11 + 5.5), qy = (uy + 0.5 - (ty * 11 + 5.5)) * 1.6, q = Math.hypot(qx, qy);
        if (h > 0.97 && q < 1.1) return [246, 176, 214];
        if (q < 3.3 && !(qx > 0 && Math.abs(qy) < 1)) return q < 2.2 ? [84, 132, 56] : [52, 96, 42];
      }
      return [r, g, b];
    }
    const blk = prand(Math.floor(ux / 2) * 131 + Math.floor(uy / 2) * 7717);
    let r = br + blk * 8 - 3 + mark * 0.5, g = bg + blk * 10 - 4 + mark * 0.6, b = bb + blk * 6 - 3 + mark * 0.4;
    if (n > 0.52) { r -= 6; g -= 3; b -= 2; }
    if (n > 0.57) { r -= 6; g -= 6; b -= 3; if (n <= 0.6 && px > 0.9) return [98, 116, 52]; }   // damp edge + reeds on the shore
    if (px > 0.985) { r += 18; g += 24; b += 4; } else if (px < 0.012) { r -= 10; g -= 10; b -= 8; }
    return [r, g, b];
  },
  marble(ux, uy, dx, dy, d, R, px, mark, th) { // sky temple: big pale marble slabs, grey veins, gold inlay rings
    const [br, bg, bb] = th.base;
    const tile = 24, lx = ux % tile, ly = uy % tile, tx = Math.floor(ux / tile), ty = Math.floor(uy / tile);
    const v = prand(tx * 7919 + ty * 104729) * 10 - 3;
    let r = br + v + px * 3, g = bg + v + px * 3, b = bb + v * 1.1 + px * 3;
    const vein = Math.sin(ux * 0.19 + Math.sin(uy * 0.11 + tx * 1.3) * 2.4 + ty * 1.7);
    if (Math.abs(vein) < 0.05 && prand(tx * 31 + ty * 7) < 0.6) { r -= 16; g -= 14; b -= 8; }
    if (lx === 0 || ly === 0) { r -= 24; g -= 22; b -= 16; } else if (lx === 1 || ly === 1) { r += 10; g += 10; b += 10; }
    if (Math.abs(d - R * 0.5) < 1.2 || (d > 27 && d < 30)) return [214, 182, 104];
    if (d < 27 && d > 12 && (Math.floor(Math.atan2(dy, dx) * 8 / Math.PI + 16) & 1)) { r += 12; g += 10; b += 4; }
    return [r, g, b];
  },
  grave(ux, uy, dx, dy, d, R, px, mark, th) { // graveyard: dead grass, bare earth, fallen leaves, moonlit from the top-left
    const [br, bg, bb] = th.base;
    const n = fnoise(ux, uy, 48, 23);
    const blk = prand(Math.floor(ux / 2) * 131 + Math.floor(uy / 2) * 7717);
    let r, g, b;
    if (n > 0.64) { r = br + 4 + blk * 7; g = bg - 1 + blk * 6; b = bb - 4 + blk * 5; if (px > 0.96) { r += 8; g += 7; b += 5; } }
    else {
      r = br + blk * 8 - 3 + mark * 0.5; g = bg + blk * 12 - 4 + mark * 0.6; b = bb + blk * 9 - 2 + mark * 0.7;
      if (px > 0.93) { r -= 8; g -= 10; b -= 6; }
    }
    const moon = Math.max(0, 1 - Math.hypot(dx + R * 0.45, dy + R * 0.55) / (R * 1.25));
    r += moon * 10; g += moon * 12; b += moon * 18;
    if (px > 0.9975) return [104, 72, 42];              // dead leaves
    if (px < 0.00025) return [176, 176, 164];           // a rare bone / pebble
    if (px > 0.985 && n <= 0.64) { r += 10; g += 16; b += 8; }   // pale grass tufts
    return [r, g, b];
  },
  planks(ux, uy, dx, dy, d, R, px, mark, th) { // dojo: polished boards, grain, a red painted ring, stray petals
    const [br, bg, bb] = th.base;
    const bh = 7, row = Math.floor(uy / bh), off = prand(row * 7331) * 60;
    const blen = 38 + Math.floor(prand(row * 17) * 22), u = ux + off;
    const col = Math.floor(u / blen), tone = prand(row * 911 + col * 37) * 14 - 7;
    const grain = Math.sin(u * 0.22 + Math.sin(u * 0.05 + row) * 3 + (uy % bh) * 0.9) * 4;
    let r = br + tone + grain, g = bg + tone * 0.8 + grain * 0.8, b = bb + tone * 0.6 + grain * 0.5;
    if (uy % bh === 0) { r -= 28; g -= 22; b -= 15; } else if (uy % bh === 1) { r += 8; g += 6; b += 4; }
    if (Math.floor(u) % blen === 0) { r -= 22; g -= 18; b -= 12; }
    if (Math.abs(d - R * 0.5) < 1.3 || (d > 27 && d < 30)) return [168, 46, 40];
    if (px > 0.9965) return px > 0.9985 ? [255, 214, 228] : [255, 164, 196];
    return [r, g, b];
  },
  deck(ux, uy, dx, dy, d, R, px, mark, th) { // ship: planks running north–south, tar seams, nails, a compass rose
    const [br, bg, bb] = th.base;
    const bw = 8, colI = Math.floor(ux / bw), off = prand(colI * 4513) * 80;
    const blen = 60 + Math.floor(prand(colI * 31) * 40), v = uy + off, rowI = Math.floor(v / blen);
    const tone = prand(colI * 733 + rowI * 101) * 16 - 8;
    const grain = Math.sin(v * 0.18 + Math.sin(v * 0.04 + colI) * 3 + (ux % bw) * 1.1) * 4;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax * 4 + ay < 24 || ay * 4 + ax < 24) return (dx < 0) !== (dy < 0) ? [214, 180, 112] : [160, 120, 70];
    let r = br + tone + grain + mark, g = bg + tone * 0.8 + grain * 0.7 + mark, b = bb + tone * 0.5 + grain * 0.4 + mark * 0.7;
    const lx = ux % bw, lv = Math.floor(v) % blen;
    if (lx === 0) return [36, 24, 16];
    if (lx === 1) { r += 8; g += 6; b += 3; }
    if (lv === 0) { r -= 24; g -= 20; b -= 13; } else if (lv === 3 && (lx === 2 || lx === 6)) return [156, 146, 124];
    return [r, g, b];
  },
  temple(ux, uy, dx, dy, d, R, px, mark, th) { // jungle: big mossy temple blocks (running bond), moss and leaves
    const [br, bg, bb] = th.base;
    const tile = 18, rowI = Math.floor(uy / tile), u = ux + ((rowI & 1) ? 9 : 0);
    const tx = Math.floor(u / tile), v = prand(tx * 7919 + rowI * 104729) * 12 - 4;
    const moss = fnoise(ux, uy, 40, 31) + prand(Math.floor(ux / 2) * 131 + Math.floor(uy / 2) * 71) * 0.08;
    const grout = u % tile === 0 || uy % tile === 0;
    let r = br + v + mark, g = bg + v + mark, b = bb + v * 0.8 + mark;
    const mossy = moss > 0.64 || (grout && moss > 0.52);
    if (mossy) { r = 46 + v * 0.6; g = 84 + v; b = 36 + v * 0.5; if (px > 0.9) { r += 12; g += 18; b += 6; } }
    if (grout) { r -= 18; g -= 16; b -= 14; } else if ((u % tile === 1 || uy % tile === 1) && !mossy) { r += 8; g += 8; b += 6; }
    if (px > 0.9975) return [132, 190, 64];
    return [r, g, b];
  },
  cave(ux, uy, dx, dy, d, R, px, mark, th) { // crystal cavern: dark rock cells, some seams glow with crystal light
    const [br, bg, bb] = th.base;
    const vo = voronoi(ux, uy, 26, 29);
    const cell = prand(vo.id) * 12 - 5;
    let r = br + cell + px * 4 + mark * 0.6, g = bg + cell * 0.9 + px * 3 + mark * 0.6, b = bb + cell * 1.2 + px * 5 + mark;
    const lit = prand(vo.id + 3) < 0.4;
    const hue = prand(vo.id + 5), c = hue < 0.5 ? [168, 92, 240] : hue < 0.8 ? [84, 210, 236] : [232, 96, 196];
    if (vo.sep < 9) return [r, g, b];                    // near-coincident seeds: no seam
    if (vo.edge < 1.0) return lit ? c : [r - 12, g - 12, b - 12];
    if (lit && vo.edge < 3) { const k = 0.28 * (1 - (vo.edge - 1) / 2); r += (c[0] - r) * k; g += (c[1] - g) * k; b += (c[2] - b) * k; }
    if (px > 0.9978) return [236, 214, 255];
    return [r, g, b];
  },
  roof(ux, uy, dx, dy, d, R, px, mark, th) { // rooftop: wet concrete slabs, gravel, puddles with neon reflections, a helipad
    const [br, bg, bb] = th.base;
    const blk = prand(Math.floor(ux / 2) * 131 + Math.floor(uy / 2) * 7717);
    let r = br + blk * 6 + px * 4, g = bg + blk * 6 + px * 4, b = bb + blk * 7 + px * 5;
    if (ux % 40 === 0 || uy % 40 === 0) { r -= 12; g -= 12; b -= 10; }
    const n = fnoise(ux, uy, 52, 37);
    if (n > 0.64 && d > 44) {
      const s = (ux + (Math.floor(uy / 2) & 1)) % 37, br2 = prand(ux * 7 + Math.floor(uy / 2) * 3);   // broken, wobbly neon reflections
      if (s === 0 && br2 > 0.6) return br2 > 0.85 ? [236, 110, 214] : [150, 60, 136];
      if (s === 19 && br2 > 0.6) return br2 > 0.85 ? [110, 220, 246] : [48, 128, 156];
      return n < 0.665 ? [38 + px * 6, 40 + px * 6, 54 + px * 8] : [22 + px * 6, 24 + px * 6, 36 + px * 8];
    }
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (((Math.abs(d - 38) < 1.6) || (ax > 7 && ax < 11 && ay < 15) || (ay < 1.6 && ax < 9)) && px > 0.18) return [206, 172, 56];
    if (Math.abs(d - R * 0.5) < 1 && (Math.floor(Math.atan2(dy, dx) * R * 0.1) & 1)) return [150, 156, 172];
    if (px > 0.992) { r += 18; g += 18; b += 18; }
    return [r, g, b];
  },
  beach(ux, uy, dx, dy, d, R, px, mark, th) { // sunset beach: warm rippled sand, shells, starfish, wet sand and foam at the edge
    const [br, bg, bb] = th.base;
    const rip = Math.sin(ux * 0.3 + uy * 0.1 + Math.sin(uy * 0.05) * 2.5 + fnoise(ux, uy, 30, 5) * 6);
    let r = br + px * 8 + mark, g = bg + px * 7 + mark, b = bb + px * 6 + mark;
    if (rip > 0.93) { r += 7; g += 6; b += 4; } else if (rip < -0.95) { r -= 7; g -= 6; b -= 4; }
    const glow = Math.max(0, 1 - Math.hypot(dx - R * 0.6, dy + R * 0.6) / (R * 1.4));
    r += glow * 20; g += glow * 6; b -= glow * 6;
    const wet = (d - (R - 17)) / 14;
    if (wet > 0) {
      if (Math.abs(d - (R - 10 + Math.sin(Math.atan2(dy, dx) * 44) * 1.6)) < 0.8) return [238, 232, 222];
      r -= 30 * wet; g -= 22 * wet; b -= 4 * wet;
    }
    const tx = Math.floor(ux / 16), ty = Math.floor(uy / 16), h = prand(tx * 331 + ty * 1777);
    if (h > 0.972 && d < R - 20) {
      const lx = ux - tx * 16, ly = uy - ty * 16;
      if (h > 0.99) { if ((lx === 7 && ly >= 5 && ly <= 9) || (ly === 7 && lx >= 5 && lx <= 9)) return lx === 7 && ly === 7 ? [255, 164, 112] : [232, 104, 70]; }
      else if ((ly === 7 && lx >= 6 && lx <= 8) || (ly === 6 && lx === 7)) return ly === 6 ? [250, 236, 226] : [226, 170, 160];
    }
    return [r, g, b];
  },
  flagstone(ux, uy, dx, dy, d, R, px, mark, th) { // castle courtyard: irregular flagstones, dark mortar, moss in the joints
    const [br, bg, bb] = th.base;
    const vo = voronoi(ux, uy, 17, 41);
    const cell = prand(vo.id) * 13 - 5, warm = prand(vo.id + 9) > 0.78 ? 1 : 0;
    if (vo.edge < 1.1 && vo.sep > 6) return prand(ux * 13 + uy * 7) > 0.86 ? [54, 84, 46] : [46, 44, 50];
    let r = br + cell + px * 4 + mark + warm * 6, g = bg + cell + px * 4 + mark + warm * 2, b = bb + cell * 1.1 + px * 5 + mark - warm * 4;
    if (vo.edge < 2.1) { r -= 6; g -= 6; b -= 6; }
    return [r, g, b];
  },
  metal(ux, uy, dx, dy, d, R, px, mark, th) { // factory: riveted diamond-plate panels, oil stains, hazard stripes at the edge
    const [br, bg, bb] = th.base;
    if (d > R - 12) return (Math.floor((ux + uy) / 5) & 1) ? [206, 164, 44] : [34, 30, 28];
    const tile = 20, lx = ux % tile, ly = uy % tile, tx = Math.floor(ux / tile), ty = Math.floor(uy / tile);
    const v = prand(tx * 7919 + ty * 104729) * 8 - 2;
    let r = br + v + mark, g = bg + v + mark, b = bb + v * 1.1 + mark;
    const a4 = ux & 3, b4 = uy & 3;
    if (((ux >> 2) + (uy >> 2)) & 1 ? (a4 === b4 && a4 > 0) : (a4 + b4 === 3 && a4 > 0 && a4 < 3)) { r += 12; g += 12; b += 13; }
    if (lx === 0 || ly === 0) { r = br - 20; g = bg - 20; b = bb - 18; } else if (lx === 1 || ly === 1) { r += 10; g += 10; b += 10; }
    if ((lx === 3 || lx === tile - 3) && (ly === 3 || ly === tile - 3)) return [158, 158, 166];
    if (fnoise(ux, uy, 44, 43) > 0.68) { r -= 14; g -= 14; b -= 10; }   // oil stains
    return [r, g, b];
  },
  candy(ux, uy, dx, dy, d, R, px, mark, th) { // candy kingdom: pastel peppermint swirl, frosting rings, sprinkles
    const [br, bg, bb] = th.base;
    const sw = Math.sin(Math.atan2(dy, dx) * 8 + d * 0.035);
    let r = br + px * 5 + mark, g = bg + px * 5 + mark, b = bb + px * 5 + mark;
    if (sw > 0.5) { r += 20; g += 27; b += 24; } else if (sw > 0.35) { r += 10; g += 13; b += 12; }
    if (Math.abs(d - R * 0.5) < 1.5 || (d > 26 && d < 30)) return [252, 240, 246];
    const tx = Math.floor(ux / 7), ty = Math.floor(uy / 7), h = prand(tx * 331 + ty * 1777);
    if (h > 0.89) {
      const lx = ux - tx * 7, ly = uy - ty * 7, hh = Math.floor(h * 1e6);
      const sx = 1 + (hh % 4), sy = 1 + ((hh >> 2) % 4), hor = (hh >> 4) & 1;
      if (hor ? (ly === sy && (lx === sx || lx === sx + 1)) : (lx === sx && (ly === sy || ly === sy + 1))) return SPRINKLES[(hh >> 5) % SPRINKLES.length];
    }
    return [r, g, b];
  },
  olympus(ux, uy, dx, dy, d, R, px, mark, th) { // mount olympus: warm marble with gold seams, a sun mosaic and a gold key band
    const [br, bg, bb] = th.base;
    const an = Math.atan2(dy, dx);
    if (d < R * 0.2) {
      if (d < 12) return [240, 204, 112];
      if (d < 14) return [178, 136, 64];
      return (Math.floor((an + Math.PI) * 12 / Math.PI) & 1) ? [226, 190, 104] : [206, 194, 164];
    }
    const t = d - (R * 0.5 - 3);
    if (t >= 0 && t < 6) {
      const s = Math.floor((an + Math.PI) * R * 0.5) % 8;
      return (t < 1 || t >= 5 || (t >= 2 && t < 4 && s < 4)) ? [214, 176, 88] : [150, 118, 64];
    }
    const tile = 22, lx = ux % tile, ly = uy % tile, tx = Math.floor(ux / tile), ty = Math.floor(uy / tile);
    const v = prand(tx * 7919 + ty * 104729) * 10 - 3;
    let r = br + v + px * 3, g = bg + v + px * 3, b = bb + v * 0.9 + px * 2;
    const vein = Math.sin(ux * 0.17 + Math.sin(uy * 0.12 + tx) * 2.2 + ty * 1.9);
    if (Math.abs(vein) < 0.05 && prand(tx * 17 + ty * 5) < 0.6) { r -= 12; g -= 12; b -= 10; }
    if (lx === 0 || ly === 0) return (tx % 3 === 0 && lx === 0) || (ty % 3 === 0 && ly === 0) ? [190, 152, 78] : [r - 18, g - 18, b - 16];
    if (lx === 1 || ly === 1) { r += 8; g += 7; b += 5; }
    return [r, g, b];
  },
  abyss(ux, uy, dx, dy, d, R, px, mark, th) { // the abyss: a black-violet vortex, rune circles, a few cold stars
    const [br, bg, bb] = th.base;
    const an = Math.atan2(dy, dx);
    const sw = Math.sin(an * 3 - d * 0.05 + Math.sin(d * 0.021) * 2);
    const n = Math.sin(ux * 0.05 + Math.sin(uy * 0.04) * 2) * 0.5 + Math.cos(uy * 0.06 - ux * 0.02) * 0.5;
    let r = br + sw * 6 + n * 4 + px * 3, g = bg + sw * 2 + px * 2, b = bb + sw * 10 + n * 6 + px * 5;
    if (sw > 0.88) { r += 18; g += 3; b += 28; }
    const ring = Math.abs(d - R * 0.5);
    if (ring < 0.8) return [150, 62, 212];
    if (d > R * 0.5 && ring > 2 && ring < 5) {
      const arc = (an + Math.PI) * R * 0.5, gi = Math.floor(arc / 5), u = Math.floor(arc) % 5, vv = Math.floor(ring - 2);
      if (u < 3 && ((Math.floor(prand(gi * 97 + 13) * 512) >> (u * 3 + vv)) & 1)) return [176, 80, 236];
    }
    if (Math.abs(d - R * 0.25) < 0.7 && (Math.floor(an * 20) & 1)) return [110, 44, 160];
    if (d < 30 && d > 27) return [200, 90, 255];
    if (px > 0.9986) return [210, 140, 255];
    return [r, g, b];
  },
};

/** Which body animation an ability plays: attack (weapon swing/shot), cast, dash or block. */
function animKindOf(ab, weapon) {
  if (!ab) return 'cast';
  if (ab.basic) return 'attack';
  switch (ab.type) {
    case 'melee': return 'attack';
    case 'projectile': return weapon && ['shoot', 'gun', 'cast'].includes(weapon.kind) ? 'attack' : 'cast';
    case 'dash': return 'dash';
    case 'counter': return 'block';
    default: return 'cast';
  }
}

/** Binary search: last item with .t <= fr (items sorted by t). */
function lastOf(list, fr) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t <= fr) lo = m + 1; else hi = m; }
  return lo ? list[lo - 1] : null;
}

export class ArenaRenderer {
  constructor(canvas, { mini = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mini = mini;
    this.replay = null;
    this.buf = document.createElement('canvas');
    this.b = this.buf.getContext('2d');
    this.cw = 0; this.ch = 0; this.dpr = 1;
    this.cam = null;
    this.zoom = null;
    this.floor = null;
    this.stripes = null;
    this.themeId = 'colosseum';
    this.theme = THEMES.colosseum;
    this.crowd = null;
    this.crowdKey = null;
    this.koT = null;
    this.excite = 0;
    this.opts = { debug: false };
    this.obstacles = [];
    this.plugins = []; this.addPlugin(createPowersPlugin()); // plugin:
  }

  /** Extra rendering options: { debug: bool } shows the brains' `draw` shapes. */
  setOptions(opts = {}) {
    this.opts = { ...this.opts, ...(opts || {}) };
    return this.opts;
  }

  /** Switch the arena look (floor, stands, particles). */
  setTheme(id) {
    const next = THEMES[id] ? id : 'colosseum';
    if (next === this.themeId && this.floor) return;
    this.themeId = next;
    this.theme = THEMES[next];
    this.floor = null;
    this.crowd = null;
  }

  // plugin: renderer plugins { name, onReplay(replay, r), beforeWorld(ctx), afterFighters(ctx), overlay(ctx), camera(ctx) -> {dx, dy, zoom, shake} }
  addPlugin(p) { if (p) (this.plugins || (this.plugins = [])).push(p); return p; } // plugin:
  pluginCtx(t, anim, hold, state) { // plugin:
    if (!this.plugins || !this.plugins.length) return null; // plugin:
    return { r: this, b: this.b, t, anim, hold, state, X: (x) => this.X(x), Y: (y) => this.Y(y), K, zoom: this.zoom, bw: this.bw, bh: this.bh, replay: this.replay }; // plugin:
  } // plugin:
  pluginCall(name, ctx) { // plugin:
    if (!ctx) return; // plugin:
    for (const p of this.plugins) if (p[name]) { try { p[name](ctx); } catch (e) { if (!p._err) { p._err = 1; console.error('renderer plugin', p.name, name, e); } } } // plugin:
  } // plugin:
  pluginCamera(ctx) { // plugin: offsets/punch-zoom/shake for this frame only (restored after present)
    if (!ctx || !this.cam) return null; // plugin:
    let dx = 0, dy = 0, zoom = 1, shake = 0; // plugin:
    for (const p of this.plugins) if (p.camera) { try { const c = p.camera(ctx); if (c) { dx += c.dx || 0; dy += c.dy || 0; zoom *= c.zoom || 1; shake += c.shake || 0; } } catch (e) { /* ignore */ } } // plugin:
    const saved = { x: this.cam.x, y: this.cam.y, zoom: this.zoom }; // plugin:
    this.cam = { x: this.cam.x + dx, y: this.cam.y + dy }; // plugin:
    if (zoom !== 1 && this.zoom) this.zoom = Math.max(1, Math.round(this.zoom * zoom)); // plugin:
    const s = Math.min(8, shake); // plugin:
    return { saved, sx: Math.round(Math.sin(ctx.anim * 71) * s), sy: Math.round(Math.cos(ctx.anim * 57) * s) }; // plugin:
  } // plugin:
  pluginRestore(pc) { this.cam = { x: pc.saved.x, y: pc.saved.y }; this.zoom = pc.saved.zoom; } // plugin:

  setReplay(replay, aiColors) {
    this.replay = replay;
    this.frames = replay.frames;
    this.events = replay.events || [];
    this.tickRate = replay.tickRate || 30;
    this.R = replay.fighterRadius || 24;
    const ar = replay.arena || {};
    this.arenaR = ar.radius || 520;
    this.shrinkStart = ar.shrinkStart || 30;
    this.shrinkEnd = ar.shrinkEnd || 50;
    this.obstacles = Array.isArray(ar.obstacles)
      ? ar.obstacles.filter(o => o && Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.r) && o.r > 0).map((o, i) => ({ x: o.x, y: o.y, r: o.r, seed: i * 7 + 3 }))
      : [];
    this.duration = (this.frames.length - 1) / this.tickRate;
    this.fighters = replay.fighters.map((f, i) => {
      const look = f.look && typeof f.look === 'object' ? f.look : null;
      const weapon = f.weapon && typeof f.weapon === 'object' ? f.weapon : (typeof f.weapon === 'string' ? { id: f.weapon } : null);
      const abs = Array.isArray(f.abilities) ? f.abilities : [];
      const ai = (aiColors && aiColors[i]) || (i ? '#2fc58e' : '#e8825c');
      return {
        ...f,
        abilities: abs,
        px: pixelSprite(f.sprite, f.colors),
        pxOff: f.spriteOff ? pixelSprite(f.spriteOff, f.colors) : null, // v4: sprite holding the off-hand weapon
        ai,
        weaponInfo: weapon,
        lookInfo: look,
        trail: look && validHex(look.trail) ? look.trail : null,
        aura: look && typeof look.aura === 'string' && look.aura !== 'none' ? look.aura : null,
        abColors: abs.map(a => a.color || (f.colors && f.colors.primary) || '#ffffff'),
        abAnim: abs.map(a => animKindOf(a, weapon)),
        abStyle: abs.map(a => (a && a.type === 'melee') ? (MELEE_STYLES.has(a.style) ? a.style : (weapon && KIND_STYLE[weapon.kind]) || 'slash') : (a && a.style) || null),
      };
    });
    this.prepareTimelines();
    this.cam = null;
    this.zoom = null;
    this.lastT = undefined;
    this.setTheme((replay.theme && replay.theme.id) || (this.mini ? 'colosseum' : this.themeId));
    if (!this.floor || this.floorR !== this.arenaR) this.floor = null;
    this.crowd = null;
    for (const p of this.plugins || []) if (p.onReplay) { try { p.onReplay(replay, this); } catch (e) { console.error('renderer plugin', p.name, e); } } // plugin:
  }

  // Everything that depends only on the replay: per-side event timelines, the walk
  // odometer, footsteps, KO times, meteor impacts.
  prepareTimelines() {
    const ev = this.events;
    const frames = this.frames;
    const last = frames.length - 1;
    const two = () => [[], []];
    this.hitFrames = two();   // times the side was hit (for flashes)
    this.hitInfo = two();     // {t, dir, big, crit, block, dmg}
    this.actFrames = two();   // legacy: swing/fire/burst/zone/dash times
    this.acts = two();        // {t, k, ab, d}
    this.counters = two();    // {t, ok}
    this.drawIdx = two();     // event indices of `draw` events
    this.dashEvents = two();
    this.koAt = [null, null];
    this.koT = null;
    this.meteorBooms = new Set();
    const meteors = [];
    const posAt = (tick, side) => {
      const fr = frames[clamp(tick, 0, last)];
      return fr && fr[1 + side] ? fr[1 + side] : [0, 0];
    };
    for (let idx = 0; idx < ev.length; idx++) {
      const e = ev[idx];
      const a = e.a;
      if (a !== 0 && a !== 1) continue;
      switch (e.k) {
        case 'hit': {
          const v = 1 - a;
          const blocked = !!(e.fl & HF.BLOCK);
          if (e.dmg > 0) this.hitFrames[v].push(e.t);
          if (e.dmg > 0 || blocked) {
            const ap = posAt(e.t, a);
            const dir = Math.atan2((e.y !== undefined ? e.y : posAt(e.t, v)[1]) - ap[1], (e.x !== undefined ? e.x : posAt(e.t, v)[0]) - ap[0]);
            this.hitInfo[v].push({ t: e.t, dir, big: e.dmg >= 70 || !!(e.fl & HF.CRIT), crit: !!(e.fl & HF.CRIT), block: blocked, dmg: e.dmg });
          }
          break;
        }
        case 'swing': case 'fire': case 'burst': case 'zone': case 'dash':
          this.actFrames[a].push(e.t);
          this.acts[a].push({ t: e.t, k: e.k, ab: e.ab, d: e.d });
          if (e.k === 'dash') this.dashEvents[a].push(e);
          break;
        case 'heal': case 'shield': case 'buff': case 'trap': case 'beam': case 'cleanse':
          this.acts[a].push({ t: e.t, k: e.k, ab: e.ab, d: e.d });
          break;
        case 'ko':
          if (this.koAt[a] === null) this.koAt[a] = e.t;
          if (this.koT === null) this.koT = e.t;
          break;
        case 'counter': this.counters[a].push({ t: e.t, ok: !!e.ok }); break;
        case 'draw': this.drawIdx[a].push({ t: e.t, idx }); break;
        case 'meteor': meteors.push(e); break;
        case 'burst': break;
        default: break;
      }
    }
    // A burst that lands where a meteor was called is the meteor's impact (bigger boom).
    for (const m of meteors) {
      const end = m.t + Math.round((m.delay || 0) * this.tickRate);
      this.eventsIn(end - 3, end + 6, (e, idx) => {
        if (e.k === 'burst' && e.a === m.a && Math.hypot((e.x || 0) - m.x, (e.y || 0) - m.y) < 40) this.meteorBooms.add(idx);
      });
    }
    this.meteorList = meteors;
    // walk odometer + footsteps
    this.odo = [0, 1].map(s => {
      const o = new Float32Array(frames.length);
      let acc = 0;
      for (let i = 1; i < frames.length; i++) {
        const p = frames[i - 1][1 + s], q = frames[i][1 + s];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < 40 && !(q[5] & F.DASH)) acc += d;
        o[i] = acc;
      }
      return o;
    });
    this.steps = [0, 1].map(s => {
      const out = [];
      let lastStep = 0;
      for (let i = 1; i < frames.length; i++) {
        const k = Math.floor(this.odo[s][i] / (STRIDE / 2));
        if (k > lastStep) { lastStep = k; const q = frames[i][1 + s]; out.push({ t: i, x: q[0], y: q[1] }); }
      }
      return out;
    });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(rect.width * dpr)), ch = Math.max(1, Math.round(rect.height * dpr));
    if (cw !== this.cw || ch !== this.ch || dpr !== this.dpr) {
      this.cw = cw; this.ch = ch; this.dpr = dpr;
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
  }

  // ── public ────────────────────────────────────────────────────────────────
  render(t, anim = t, hold) { // plugin: hold = cinematic hold from simAt() (SPEC4 §3), null = none; omitted = host without hold support
    if (!this.replay) return this.renderIdle(anim);
    this.resize();
    const tc = clamp(t, 0, this.duration);
    const fr = tc * this.tickRate;
    const last = this.frames.length - 1;
    const i = Math.min(last, Math.floor(fr));
    const a = i >= last ? 0 : fr - i;
    const f0 = this.frames[i], f1 = this.frames[Math.min(last, i + 1)];
    const ringR = lerp(f0[0], f1[0], a);
    const fs = [0, 1].map(s => this.fighterAt(s, f0, f1, a));
    // Effects age with real time (unclamped), so flashes and numbers fade out after the last frame.
    const efr = Math.max(0, t) * this.tickRate;
    const pctx = this.pluginCtx(t, anim, hold, { fr, i, a, f0, f1, ring: ringR, fighters: fs, efr, tc }); // plugin:

    this.updateCamera(fs, ringR, tc, anim);
    const pcam = this.pluginCamera(pctx); // plugin:
    this.prepareBuffer(this.shakeAt(efr));
    if (pctx) { if (pcam) { this.ox += pcam.sx; this.oy += pcam.sy; } pctx.bw = this.bw; pctx.bh = this.bh; pctx.zoom = this.zoom; } // plugin:
    this.excite = this.excitement(efr, t);
    const b = this.b;
    b.fillStyle = this.theme.voidCol;
    b.fillRect(0, 0, this.bw, this.bh);
    this.drawVoidFx(anim);
    this.drawFloor(ringR, tc, anim);
    this.drawObstacleFloors(anim);
    this.drawZones(f0, f1, a, anim);
    this.drawTraps(f0, anim, i);
    for (const f of fs) this.drawTelegraph(f, anim);
    this.drawMeteors(efr, anim);
    this.drawEventsUnder(efr);
    this.pluginCall('beforeWorld', pctx); // plugin: ground layer (after floor/zones, before shadows + fighters)
    this.drawFootsteps(fr, fs);
    for (const f of fs) this.drawShadow(f, anim);
    // depth-sorted: fighters and obstacle bodies
    const items = fs.map(f => ({ y: f.y, f }));
    this.obstacles.forEach((o, k) => items.push({ y: o.y, o, k }));
    if (Array.isArray(f0[7])) for (const tu of f0[7]) items.push({ y: tu[2], tu }); // v4 turrets
    items.sort((p, q) => p.y - q.y);
    const drawn = [];
    for (const it of items) {
      if (it.f) { this.drawFighter(it.f, efr, anim, i, t); drawn.push(it.f); } else if (it.tu) this.drawTurret(it.tu, fs, anim, efr); else this.drawObstacleBody(it.o, anim, drawn);
    }
    this.drawBeams(f0, f1, a, anim, i);
    this.drawProjectiles(f0, f1, a, i);
    for (const f of fs) this.drawFighterOverlay(f, efr, anim);
    this.drawEventsOver(efr, fs, anim);
    this.pluginCall('afterFighters', pctx); // plugin:
    if (this.opts.debug) this.drawDebug(fr);
    this.drawAmbient(anim);
    this.drawOffscreen(fs);
    if (this.mini) this.drawMiniHud(fs, tc);
    this.pluginCall('overlay', pctx); // plugin: screen space (buffer px), drawn last
    this.present();
    this.drawScreenFx(efr);
    if (pcam) this.pluginRestore(pcam); // plugin:
  }

  renderIdle(anim = 0, { cheer = false } = {}) {
    this.resize();
    if (!this.arenaR) this.arenaR = 520;
    const need = 2 * (this.arenaR * 0.62) * K;
    this.zoom = clamp(Math.floor(Math.min(this.cw, this.ch) / need), 1, Math.round(6 * this.dpr));
    this.cam = { x: 0, y: 0 };
    this.prepareBuffer({ x: 0, y: 0 });
    this.excite = cheer ? 1 : 0;
    const b = this.b;
    b.fillStyle = this.theme.voidCol;
    b.fillRect(0, 0, this.bw, this.bh);
    this.drawVoidFx(anim);
    this.drawFloor(this.arenaR, 0, anim, true);
    this.drawAmbient(anim);
    this.present();
    this.cam = null;
    this.zoom = null;
  }

  // How loud the crowd is: big hits, stuns and the knockout get them going.
  excitement(fr, t) {
    if (this.mini) return 0;
    if (t < 1.2) return 1;
    if (this.koT !== null && fr >= this.koT) return 1;
    let ex = 0;
    this.eventsIn(fr - 24, fr, (e) => {
      const age = (fr - e.t) / this.tickRate;
      if (age < 0) return;
      if (e.k === 'hit' && (e.dmg >= 60 || (e.fl & (HF.STUN | HF.CRIT)))) ex = Math.max(ex, 1 - age / 0.8);
      else if (e.k === 'trait' || e.k === 'interrupt' || e.k === 'slam' || (e.k === 'counter' && e.ok)) ex = Math.max(ex, 1 - age / 0.8);
    });
    return ex;
  }

  fighterAt(side, f0, f1, a) {
    const p = f0[1 + side], q = f1[1 + side];
    const sameCast = q[7] === p[7];
    return {
      side,
      def: this.fighters[side],
      x: lerp(p[0], q[0], a), y: lerp(p[1], q[1], a),
      hp: lerp(p[2], q[2], a), en: lerp(p[3], q[3], a), sh: lerp(p[4], q[4], a),
      flags: p[5], facing: p[6] * DEG,
      // v4: flags2 (own bit meanings), stance, ult charge, divinity, active weapon, awakening left
      flags2: typeof p[12] === 'number' ? p[12] : 0, stance: p[13] | 0, ult: p[14] || 0, div: p[15] || 0,
      weaponIdx: p[16] | 0, awakenLeft: (p[17] || 0) / 10,
      castIdx: p[7], castProg: sameCast ? lerp(p[8], q[8], a) : p[8], tx: p[9], ty: p[10],
      cds: p[11],
      moving: Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.4,
      vx: q[0] - p[0], vy: q[1] - p[1],
    };
  }

  stateAt(t) {
    if (!this.replay) return null;
    const tc = clamp(t, 0, this.duration);
    const fr = tc * this.tickRate;
    const last = this.frames.length - 1;
    const i = Math.min(last, Math.floor(fr));
    const a = i >= last ? 0 : fr - i;
    const f0 = this.frames[i], f1 = this.frames[Math.min(last, i + 1)];
    return { fr, i, ring: lerp(f0[0], f1[0], a), fighters: [0, 1].map(s => this.fighterAt(s, f0, f1, a)) };
  }

  // ── camera + buffer ───────────────────────────────────────────────────────
  updateCamera(fs, ringR, tc, anim) {
    const R = this.R;
    const [a, b] = fs;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const outer = ringR + 60;
    let x = (a.x + b.x) / 2, y = (a.y + b.y) / 2 - R;
    // how much of the world must be visible: both fighters plus padding (an ellipse,
    // so wide arena canvases zoom in instead of wasting their width)
    let needX, needY;
    if (this.mini) {
      const r = clamp(d / 2 + 150, 190, outer);
      needX = needY = 2 * r * K;
    } else {
      needX = (Math.min(Math.abs(a.x - b.x), 2 * outer) + 2 * 150) * K;
      needY = (Math.min(Math.abs(a.y - b.y), 2 * outer) + 2 * 175) * K;
    }
    const ended = tc >= this.duration - 1e-6;
    const res = this.replay.result;
    if (ended && res && (res.method === 'KO' || res.method === 'DOUBLE KO') && !this.mini) {
      const loser = res.winner === null ? a : fs[1 - res.winner];
      const winner = res.winner === null ? b : fs[res.winner];
      // frame the knocked-out fighter, but keep the winner's victory dance in view when close
      if (Math.hypot(winner.x - loser.x, winner.y - loser.y) < 220) {
        x = (loser.x + winner.x) / 2; y = (loser.y + winner.y) / 2 - R * 1.5;
        needX = (Math.abs(loser.x - winner.x) + 240) * K; needY = (Math.abs(loser.y - winner.y) + 260) * K;
      } else { x = loser.x; y = loser.y - R * 1.5; needX = needY = 280 * K; }
    }
    // Broadcast-style camera (v4): integer "rest" zoom levels with hysteresis, reached by a smooth
    // tween (the blit is fractional only while tweening); a dead zone so small moves don't move the
    // view; critically damped panning; sub-pixel panning in present(). All deterministic.
    const fMin = 1;
    const fMax = Math.max(1, Math.round((this.mini ? 3 : 5) * this.dpr));
    const zNeed = Math.min(this.cw / needX, this.ch / needY);
    const fit = clamp(Math.floor(zNeed), fMin, fMax);
    const jump = !this.cam || this.zoom === null || Math.abs(tc - (this.lastT === undefined ? -10 : this.lastT)) > 1.5;
    const dt = jump || this.lastAnim === undefined ? 0 : clamp(anim - this.lastAnim, 0, 0.25);
    this.lastAnim = anim;
    this.lastT = tc;
    let rest = jump || !this.zRest ? fit : this.zRest;
    if (!jump) {
      if (fit < rest) { rest = fit; this.zoomInAt = null; } // someone is leaving the frame: zoom out now
      else if (zNeed >= rest + 1.2 && rest < fMax) { // comfortably fits a step closer: only after a steady moment
        if (this.zoomInAt === null || this.zoomInAt === undefined) this.zoomInAt = anim;
        else if (anim - this.zoomInAt > 1.6) { rest += 1; this.zoomInAt = null; }
      } else this.zoomInAt = null;
    }
    this.zRest = rest;
    if (jump) { this.zoom = rest; this.zVel = 0; }
    else {
      [this.zoom, this.zVel] = smoothDamp(this.zoom, rest, this.zVel || 0, rest < this.zoom ? 0.2 : 0.45, dt, 6);
      if (Math.abs(this.zoom - rest) < 0.012) { this.zoom = rest; this.zVel = 0; }
    }
    // stay over the arena
    const maxOff = Math.max(0, ringR - 20);
    const off = Math.hypot(x, y);
    if (off > maxOff && off > 0) { x *= maxOff / off; y *= maxOff / off; }
    // dead zone: the goal only follows once the action leaves a box around it
    const viewHX = this.cw / this.zoom / 2 / K, viewHY = this.ch / this.zoom / 2 / K;
    const koFrame = ended && res && (res.method === 'KO' || res.method === 'DOUBLE KO') && !this.mini;
    const dzX = koFrame ? 0 : clamp(viewHX - Math.abs(a.x - b.x) / 2 - 110, 0, viewHX * 0.2);
    const dzY = koFrame ? 0 : clamp(viewHY - Math.abs(a.y - b.y) / 2 - 130, 0, viewHY * 0.2);
    if (jump || !this.camGoal) this.camGoal = { x, y };
    else {
      const g = this.camGoal;
      if (Math.abs(x - g.x) > dzX) g.x = x - Math.sign(x - g.x) * dzX;
      if (Math.abs(y - g.y) > dzY) g.y = y - Math.sign(y - g.y) * dzY;
    }
    if (jump) { this.cam = { x: this.camGoal.x, y: this.camGoal.y }; this.camVel = { x: 0, y: 0 }; return; }
    const st = koFrame ? 0.7 : 0.5;
    [this.cam.x, this.camVel.x] = smoothDamp(this.cam.x, this.camGoal.x, this.camVel.x, st, dt, 1400);
    [this.cam.y, this.camVel.y] = smoothDamp(this.cam.y, this.camGoal.y, this.camVel.y, st, dt, 1400);
    // hard guarantee: both fighters stay inside the view (fast dashes can outrun the damping)
    for (const f of fs) {
      const mx = viewHX - 36, myTop = viewHY - 90, myBot = viewHY - 30;
      if (mx > 0) { if (f.x > this.cam.x + mx) this.cam.x = f.x - mx; else if (f.x < this.cam.x - mx) this.cam.x = f.x + mx; }
      if (myTop > 0 && f.y < this.cam.y - myTop) this.cam.y = f.y + myTop;
      if (myBot > 0 && f.y > this.cam.y + myBot) this.cam.y = f.y - myBot;
    }
  }

  prepareBuffer(shake) {
    const f = this.zoom || 2;
    // one spare pixel on every side so present() can shift the blit by the camera's sub-pixel offset
    const bw = Math.ceil(this.cw / f) + 2, bh = Math.ceil(this.ch / f) + 2;
    if (this.buf.width !== bw || this.buf.height !== bh) {
      this.buf.width = bw;
      this.buf.height = bh;
      this.stripes = null;
    }
    this.bw = bw; this.bh = bh;
    const cam = this.cam || { x: 0, y: 0 };
    const ux = bw / 2 - cam.x * K + shake.x, uy = bh / 2 - cam.y * K + shake.y;
    this.ox = Math.floor(ux); this.oy = Math.floor(uy);
    this.subX = ux - this.ox; this.subY = uy - this.oy;
    this.b.imageSmoothingEnabled = false;
  }

  present() {
    const c = this.ctx, z = this.zoom || 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    const dx = Math.round(((this.subX || 0) - 1) * z), dy = Math.round(((this.subY || 0) - 1) * z);
    c.drawImage(this.buf, dx, dy, this.bw * z, this.bh * z);
  }

  X(x) { return Math.round(this.ox + x * K); }
  Y(y) { return Math.round(this.oy + y * K); }

  // ── pixel primitives (buffer coordinates) ─────────────────────────────────
  rect(x, y, w, h, col) { const b = this.b; b.fillStyle = col; b.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

  circleFill(cx, cy, r, col) {
    const b = this.b;
    b.fillStyle = col;
    r = Math.max(0, Math.round(r));
    cx = Math.round(cx); cy = Math.round(cy);
    for (let dy = -r; dy <= r; dy++) {
      const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy + r * 0.8)));
      b.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
    }
  }

  circleLine(cx, cy, r, col, thick = 1) {
    const b = this.b;
    b.fillStyle = col;
    cx = Math.round(cx); cy = Math.round(cy);
    for (let t = 0; t < thick; t++) {
      const rr = Math.max(0, Math.round(r) - t);
      let x = rr, y = 0, err = 1 - rr;
      while (x >= y) {
        b.fillRect(cx + x, cy + y, 1, 1); b.fillRect(cx + y, cy + x, 1, 1);
        b.fillRect(cx - y, cy + x, 1, 1); b.fillRect(cx - x, cy + y, 1, 1);
        b.fillRect(cx - x, cy - y, 1, 1); b.fillRect(cx - y, cy - x, 1, 1);
        b.fillRect(cx + y, cy - x, 1, 1); b.fillRect(cx + x, cy - y, 1, 1);
        y++;
        if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
      }
    }
  }

  ellipseFill(cx, cy, rx, ry, col) {
    const b = this.b;
    b.fillStyle = col;
    cx = Math.round(cx); cy = Math.round(cy);
    ry = Math.max(1, Math.round(ry));
    for (let dy = -ry; dy <= ry; dy++) {
      const dx = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry + 0.5))));
      b.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
    }
  }

  ellipseLine(cx, cy, rx, ry, col) {
    const b = this.b;
    b.fillStyle = col;
    cx = Math.round(cx); cy = Math.round(cy);
    const n = Math.max(16, Math.round((rx + ry) * 3));
    let lx = null, ly = null;
    for (let k = 0; k < n; k++) {
      const an = (k / n) * TAU;
      const x = Math.round(cx + Math.cos(an) * rx), y = Math.round(cy + Math.sin(an) * ry);
      if (x !== lx || y !== ly) b.fillRect(x, y, 1, 1);
      lx = x; ly = y;
    }
  }

  line(x0, y0, x1, y1, col, w = 1) {
    const b = this.b;
    b.fillStyle = col;
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let guard = 0;
    while (guard++ < 2000) {
      b.fillRect(x0 - (w >> 1), y0 - (w >> 1), w, w);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  arcPixels(cx, cy, r, a0, a1, col, thick = 1) {
    const b = this.b;
    b.fillStyle = col;
    const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) * r * 1.3));
    for (let t = 0; t < thick; t++) {
      const rr = r - t;
      for (let k = 0; k <= steps; k++) {
        const an = a0 + (a1 - a0) * (k / steps);
        b.fillRect(Math.round(cx + Math.cos(an) * rr), Math.round(cy + Math.sin(an) * rr), 1, 1);
      }
    }
  }

  wedgeFill(cx, cy, r, dir, half, col) {
    const b = this.b;
    b.fillStyle = col;
    r = Math.round(r);
    cx = Math.round(cx); cy = Math.round(cy);
    const full = half >= Math.PI - 1e-3;
    for (let dy = -r; dy <= r; dy++) {
      const span = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
      let start = null;
      for (let dx = -span; dx <= span + 1; dx++) {
        let inside = dx <= span;
        if (inside && !full && (dx || dy)) {
          let d = Math.atan2(dy, dx) - dir;
          d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
          inside = Math.abs(d) <= half;
        }
        if (inside && start === null) start = dx;
        else if (!inside && start !== null) { b.fillRect(cx + start, cy + dy, dx - start, 1); start = null; }
      }
    }
  }

  text(str, x, y, { color = '#fff', size = 8, align = 'center', outline = '#000', alpha = 1 } = {}) {
    const b = this.b;
    b.globalAlpha = alpha;
    b.font = `${size}px ${PIXEL_FONT}`;
    b.textAlign = align;
    b.textBaseline = 'middle';
    x = Math.round(x); y = Math.round(y);
    if (outline) {
      b.fillStyle = outline;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) b.fillText(str, x + dx, y + dy);
    }
    b.fillStyle = color;
    b.fillText(str, x, y);
    b.globalAlpha = 1;
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  eventsIn(from, to, fn) {
    const ev = this.events;
    let lo = 0, hi = ev.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t < from) lo = m + 1; else hi = m; }
    for (let k = lo; k < ev.length && ev[k].t <= to; k++) fn(ev[k], k);
  }

  since(arr, fr) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= fr) lo = m + 1; else hi = m; }
    if (lo === 0) return 99;
    return (fr - arr[lo - 1]) / this.tickRate;
  }

  shakeAt(fr) {
    if (this.mini) return { x: 0, y: 0 };
    let amp = 0;
    this.eventsIn(fr - 20, fr, (e, idx) => {
      const age = (fr - e.t) / this.tickRate;
      if (age < 0) return;
      if (e.k === 'hit' && (e.dmg >= 70 || (e.fl & HF.CRIT))) amp += Math.min(4, Math.max(2, e.dmg / 40)) * Math.max(0, 1 - age / 0.3);
      if (e.k === 'ko') amp += 6 * Math.max(0, 1 - age / 0.6);
      if (e.k === 'slam') amp += 4 * Math.max(0, 1 - age / 0.35);
      if (e.k === 'burst' && this.meteorBooms.has(idx)) amp += 5 * Math.max(0, 1 - age / 0.5);
    });
    amp = Math.min(amp, 6);
    return { x: Math.round(Math.sin(fr * 2.7) * amp), y: Math.round(Math.cos(fr * 3.3) * amp) };
  }

  // ── floor ─────────────────────────────────────────────────────────────────
  buildFloor() {
    const th = this.theme;
    const R = this.arenaR * K;
    const S = Math.ceil(R * 2 + 12);
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const cx = S / 2, cy = S / 2;
    const [br, bg, bb] = th.base;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        if (d > R + 4) continue;
        let r, gg, bl;
        if (d > R) [r, gg, bl] = th.rimOut;
        else if (d > R - 3) [r, gg, bl] = th.rim;
        else {
          const ux = x - Math.floor(cx) + 12000, uy = y - Math.floor(cy) + 12000;
          const inner = d < 30 ? 10 : d < 34 ? -8 : 0;
          const mark = (Math.abs(d - R * 0.5) < 1 ? 7 : 0) + inner;
          const px = prand(ux * 31 + uy * 7919);
          const more = FLOORS[th.floor];
          if (more) [r, gg, bl] = more(ux, uy, dx, dy, d, R, px, mark, th);
          else switch (th.floor) {
            case 'basalt': {
              const v = voronoi(ux, uy, 30, 17);
              const cell = prand(v.id) * 10 - 4;
              if (v.edge < 0.9) {
                const k = 1 - v.edge / 0.9;
                [r, gg, bl] = [th.crack[0] * (0.38 + 0.3 * k), th.crack[1] * (0.22 + 0.3 * k), th.crack[2] * 0.3];
              } else {
                const warm = v.edge < 3 ? 12 * (1 - (v.edge - 1.1) / 1.9) : 0;
                r = br + cell + px * 5 + warm + mark; gg = bg + cell + px * 4 + mark; bl = bb + cell + px * 4 + mark;
              }
              break;
            }
            case 'ice': {
              const v = voronoi(ux, uy, 40, 5);
              const cell = prand(v.id) * 10 - 4;
              r = br + cell + mark; gg = bg + cell + mark; bl = bb + cell * 1.2 + mark;
              if (v.edge < 0.8 && prand(v.id + 7) < 0.6) { r += 26; gg += 32; bl += 34; }
              else if (px > 0.997) [r, gg, bl] = [200, 232, 250];
              else if ((ux + uy) % 9 === 0 && px > 0.7) { r += 6; gg += 8; bl += 10; }
              break;
            }
            case 'grid': {
              const gx = ux % 16 === 0, gy = uy % 16 === 0;
              r = br + px * 4; gg = bg + px * 3; bl = bb + px * 6;
              if (gx && gy) [r, gg, bl] = [150, 100, 160];
              else if (gx) [r, gg, bl] = [72, 22, 70];
              else if (gy) [r, gg, bl] = [18, 58, 82];
              if (Math.abs(d - R * 0.5) < 1 || (d < 31 && d > 29)) [r, gg, bl] = [40, 140, 170];
              break;
            }
            case 'grass': {
              const blk = prand(Math.floor(ux / 2) * 131 + Math.floor(uy / 2) * 7717);
              r = br + blk * 10 - 4 + mark * 0.6; gg = bg + blk * 16 - 6 + mark; bl = bb + blk * 8 - 3;
              if (px > 0.93) { r -= 10; gg -= 16; bl -= 10; }
              if (px > 0.9965) [r, gg, bl] = [[255, 140, 190], [255, 226, 90], [240, 240, 255]][Math.floor(prand(ux + uy * 3) * 3)];
              break;
            }
            case 'sand': {
              const rip = Math.sin(ux * 0.55 + uy * 0.2 + Math.sin(uy * 0.045) * 3);
              r = br + px * 8 + mark; gg = bg + px * 7 + mark; bl = bb + px * 6 + mark;
              if (rip > 0.82) { r += 12; gg += 10; bl += 7; } else if (rip < -0.88) { r -= 12; gg -= 11; bl -= 8; }
              const tx = Math.floor(ux / 14), ty = Math.floor(uy / 14);
              if (prand(tx * 977 + ty * 7919) > 0.965) {
                const grout = ux % 14 === 0 || uy % 14 === 0;
                const v = prand(tx * 31 + ty * 17) * 8;
                [r, gg, bl] = grout ? [92, 72, 50] : [124 + v, 104 + v, 76 + v];
              }
              break;
            }
            case 'cosmic': { // celestial: deep space with nebula swirls, stars and golden rings
              const n1 = Math.sin(ux * 0.035 + Math.sin(uy * 0.02) * 2.2) + Math.cos(uy * 0.03 - ux * 0.012);
              r = br + n1 * 6 + px * 4; gg = bg + n1 * 3 + px * 3; bl = bb + n1 * 10 + px * 6;
              if (n1 > 1.2) { r += 14; gg += 4; bl += 22; }
              if (px > 0.994) [r, gg, bl] = px > 0.998 ? [255, 244, 210] : [170, 180, 255];
              const ringD = Math.abs(d - R * 0.5), ringI = Math.abs(d - R * 0.25);
              if (ringD < 0.8) [r, gg, bl] = [196, 164, 96];
              else if (ringI < 0.6 && (Math.floor(Math.atan2(dy, dx) * 12) & 1)) [r, gg, bl] = [150, 126, 80];
              if (d < 29 && d > 27) [r, gg, bl] = [226, 196, 120];
              break;
            }
            default: { // stone tiles
              const tile = 12;
              const tx = Math.floor(ux / tile), ty = Math.floor(uy / tile);
              const grout = ux % tile === 0 || uy % tile === 0;
              const v = prand(tx * 7919 + ty * 104729) * 10;
              r = br + v + mark; gg = bg + v + mark; bl = bb + v * 1.3 + mark;
              if (grout) { r -= 9; gg -= 9; bl -= 10; }
            }
          }
          if ((x + y) % 2 === 0 && d > R - 10) { r -= 4; gg -= 4; bl -= 4; }
        }
        const o = (y * S + x) * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bl; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.floor = c;
    this.floorR = this.arenaR;
    this.floorS = S;
  }

  // Stands full of tiny fans around the arena: 3 frames (sitting, cheer A, cheer B).
  buildCrowd() {
    const th = this.theme;
    const R = this.arenaR * K;
    const outer = R + 46;
    const S = Math.ceil(outer * 2 + 6);
    const cx = S / 2, cy = S / 2;
    const base = document.createElement('canvas');
    base.width = base.height = S;
    const g0 = base.getContext('2d');
    const img = g0.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < R + 3 || d > outer) continue;
        const band = Math.floor((d - R - 3) / 6);
        let [r, gg, bl] = band % 2 ? th.standAlt : th.stand;
        if ((d - R - 3) % 6 < 1) { r += 12; gg += 12; bl += 12; }
        const deg = ((Math.atan2(y - cy, x - cx) / DEG) + 360) % 30;
        if (deg < 1.6) { r -= 10; gg -= 10; bl -= 10; }
        if (d > outer - 3) { r -= 8; gg -= 8; bl -= 8; }
        const o = (y * S + x) * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bl; img.data[o + 3] = 255;
      }
    }
    g0.putImageData(img, 0, 0);
    if (th.banners) { // castle: heraldic banners hang from the outer wall between the aisles
      for (let k = 0; k < 12; k++) {
        const an = (15 + 30 * k) * DEG;
        if (Math.abs(Math.sin(an)) < 0.45) continue;           // keep clear of the team flags (east / west)
        const bx = Math.round(cx + Math.cos(an) * (outer - 4)) - 2, by = Math.round(cy + Math.sin(an) * (outer - 4)) - 10;
        g0.fillStyle = '#1a1418'; g0.fillRect(bx - 1, by - 1, 7, 13);
        g0.fillStyle = th.banners[k % th.banners.length]; g0.fillRect(bx, by, 5, 10);
        g0.fillRect(bx, by + 10, 2, 1); g0.fillRect(bx + 3, by + 10, 2, 1);
        g0.fillStyle = '#e8c060'; g0.fillRect(bx, by, 5, 1); g0.fillRect(bx + 2, by + 3, 1, 4); g0.fillRect(bx + 1, by + 4, 3, 1);
      }
    }
    const fs = this.fighters || [];
    const swap = this.replay && this.replay.swapStart;
    const team = [fs[0] ? fs[0].ai : null, fs[1] ? fs[1].ai : null];
    const teamAngle = [swap ? 0 : Math.PI, swap ? Math.PI : 0];
    const people = [];
    for (let k = 0; k < 6; k++) {
      const r = R + 3 + 6 * k + 3;
      const n = Math.floor((TAU * r) / 5);
      for (let i = 0; i < n; i++) {
        const an = ((i + 0.5 * (k % 2)) / n) * TAU;
        const deg = ((an / DEG) % 30 + 30) % 30;
        const seed = k * 10007 + i;
        if (deg < 2.6 || prand(seed) < 0.12) continue;
        let shirt = SHIRTS[Math.floor(prand(seed + 1) * SHIRTS.length)];
        for (let s = 0; s < 2; s++) {
          if (!team[s]) continue;
          let da = Math.abs(an - teamAngle[s]) % TAU;
          if (da > Math.PI) da = TAU - da;
          if (da < 55 * DEG && prand(seed + 2) < 0.55) shirt = team[s];
        }
        people.push({ x: Math.round(cx + Math.cos(an) * r), y: Math.round(cy + Math.sin(an) * r), shirt, skin: SKINS[Math.floor(prand(seed + 3) * SKINS.length)], hop: prand(seed + 4) < 0.5 ? 1 : 2 });
      }
    }
    const frames = [0, 1, 2].map((f) => {
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d');
      g.drawImage(base, 0, 0);
      for (const p of people) {
        const up = f && p.hop === f ? 1 : 0;
        g.fillStyle = p.shirt;
        g.fillRect(p.x - 1, p.y - up, 2, 2);
        g.fillStyle = p.skin;
        g.fillRect(p.x - 1, p.y - 2 - up, 2, 2);
        if (up) { g.fillRect(p.x - 2, p.y - 3, 1, 1); g.fillRect(p.x + 1, p.y - 3, 1, 1); }
      }
      for (let s = 0; s < 2; s++) {
        if (!team[s]) continue;
        for (const off of [-22, 0, 22]) {
          const an = teamAngle[s] + off * DEG;
          const fx = Math.round(cx + Math.cos(an) * (outer - 5)), fy = Math.round(cy + Math.sin(an) * (outer - 5));
          const wave = f === 2 ? 1 : 0;
          g.fillStyle = '#c9ccd6';
          g.fillRect(fx, fy - 8, 1, 9);
          g.fillStyle = team[s];
          g.fillRect(fx + 1, fy - 8 + wave, 6, 4);
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(fx + 1, fy - 5 + wave, 6, 1);
        }
      }
      return c;
    });
    this.crowd = frames;
    this.crowdS = S;
  }

  stripePattern() {
    if (this.stripes) return this.stripes;
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const g = c.getContext('2d');
    g.fillStyle = '#34101a';
    g.fillRect(0, 0, 8, 8);
    g.fillStyle = '#6e1a1c';
    for (let k = 0; k < 8; k++) for (let w = 0; w < 3; w++) g.fillRect(k, (k + w) % 8, 1, 1);
    this.stripes = this.b.createPattern(c, 'repeat');
    return this.stripes;
  }

  drawFloor(ringR, t, anim, idle = false) {
    if (!this.floor) this.buildFloor();
    const b = this.b;
    if (!this.mini) {
      if (!this.crowd) this.buildCrowd();
      const frame = this.excite > 0.05 ? 1 + (Math.floor(anim * 8) % 2) : 0;
      b.drawImage(this.crowd[frame], this.ox - Math.floor(this.crowdS / 2), this.oy - Math.floor(this.crowdS / 2));
    }
    const S = this.floorS;
    b.drawImage(this.floor, this.ox - Math.floor(S / 2), this.oy - Math.floor(S / 2));
    const cx = this.ox, cy = this.oy;
    const R0 = Math.round(this.arenaR * K), Rr = Math.round(ringR * K);
    if (!idle && this.fighters) {
      const swap = this.replay && this.replay.swapStart;
      this.fighters.forEach((f, i) => {
        const left = (i === 0) !== !!swap;
        const x = cx + (left ? -1 : 1) * Math.round(260 * K), y = cy;
        b.fillStyle = rgba(f.ai, 0.2);
        for (let dy = -3; dy <= 3; dy++) {
          const w = 3 - Math.abs(dy);
          b.fillRect(x - w * 2, y + dy * 2, w * 4 + 2, 2);
        }
      });
    }
    if (Rr < R0) {
      const pat = this.stripePattern();
      if (pat.setTransform) pat.setTransform(new DOMMatrix().translateSelf((cx + Math.floor(anim * 8)) % 8, cy % 8));
      b.fillStyle = pat;
      for (let dy = -R0; dy <= R0; dy++) {
        const outer = Math.floor(Math.sqrt(Math.max(0, R0 * R0 - dy * dy)));
        const inner = Math.abs(dy) < Rr ? Math.floor(Math.sqrt(Rr * Rr - dy * dy)) : -1;
        if (inner < 0) b.fillRect(cx - outer, cy + dy, outer * 2 + 1, 1);
        else {
          b.fillRect(cx - outer, cy + dy, outer - inner, 1);
          b.fillRect(cx + inner + 1, cy + dy, outer - inner, 1);
        }
      }
    }
    const shrinking = t >= this.shrinkStart && t < this.shrinkEnd;
    const warn = t >= this.shrinkStart - 3 && t < this.shrinkStart;
    const col = shrinking ? (Math.floor(anim * 6) % 2 ? '#ff7a45' : '#ffb347') : warn ? (Math.floor(anim * 4) % 2 ? '#ffd166' : '#ffffff') : this.theme.ringCol;
    if (Rr < R0 || !idle) this.circleLine(cx, cy, Rr, col, 2);
    if (Rr < R0) this.circleLine(cx, cy, Rr + 2, rgba(col, 0.35), 1);
  }

  // ── obstacles ─────────────────────────────────────────────────────────────
  obstacleArtFor(o) {
    try { return obstacleArt(OBSTACLE_THEME[this.themeId] || this.themeId, o.r * K, o.seed); } catch { return null; }
  }

  drawObstacleFloors(anim) {
    for (const o of this.obstacles) {
      const art = this.obstacleArtFor(o);
      const X = this.X(o.x), Y = this.Y(o.y);
      if (!art) { this.ellipseFill(X, Y, o.r * K, o.r * K * 0.5, 'rgba(0,0,0,0.35)'); continue; }
      if (art.floor) this.b.drawImage(art.floor, X - art.fax, Y - art.fay);
    }
  }

  xrayCanvas(w, h) {
    if (!this._xray) this._xray = document.createElement('canvas');
    const c = this._xray;
    if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
    return c;
  }

  drawObstacleBody(o, anim, fightersBehind) {
    const art = this.obstacleArtFor(o);
    const X = this.X(o.x), Y = this.Y(o.y);
    if (!art) {
      const r = Math.max(3, Math.round(o.r * K));
      this.rect(X - r, Y - r * 2.2, r * 2, r * 2.2, '#5a6278');
      this.rect(X - r, Y - r * 2.2, r * 2, 2, '#8a93a8');
      return;
    }
    const frame = art.body[art.fps ? Math.floor(anim * art.fps) % art.body.length : 0];
    const x0 = X - art.ax, y0 = Y - art.ay;
    this.b.drawImage(frame, x0, y0);
    // fighters standing behind the obstacle show through as an outline-tinted ghost
    for (const f of fightersBehind) {
      const fx = this.X(f.x), fy = this.Y(f.y) + Math.round(this.R * 0.55 * K);
      const top = fy - SIZE;
      if (fx + 12 < x0 || fx - 12 > x0 + frame.width || fy < y0 || top > y0 + frame.height) continue;
      const img = f._img;
      if (!img) continue;
      // the ghost only shows where the obstacle actually covers the fighter
      const tmp = this.xrayCanvas(frame.width, frame.height);
      const g = tmp.getContext('2d');
      g.clearRect(0, 0, tmp.width, tmp.height);
      g.globalCompositeOperation = 'source-over';
      const ghost = tintOf(f.def.px, img, f.def.ai);
      const x = Math.round(f._sx) - x0, y = Math.round(f._sy) - y0;
      g.save();
      if (f._flip) { g.translate(x + SIZE, y); g.scale(-1, 1); g.drawImage(ghost, 0, 0); } else g.drawImage(ghost, x, y);
      g.restore();
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(frame, 0, 0);
      g.globalCompositeOperation = 'source-over';
      this.b.globalAlpha = 0.5;
      this.b.drawImage(tmp, 0, 0, frame.width, frame.height, x0, y0, frame.width, frame.height);
      this.b.globalAlpha = 1;
    }
  }

  // ── zones, traps, telegraphs ──────────────────────────────────────────────
  drawZones(f0, f1, a, anim) {
    const zones = f0[4] || [];
    const next = f1 && f1[4] ? new Map(f1[4].map(z => [z[0], z])) : null;
    for (const z of zones) {
      const [id, x0, y0, r, owner, abIdx, left] = z;
      const def = this.fighters[owner];
      if (!def) continue;
      const q = next && next.get(id);
      const x = q ? lerp(x0, q[1], a) : x0, y = q ? lerp(y0, q[2], a) : y0; // following zones glide
      const ab = def.abilities[abIdx] || {};
      const col = def.abColors[abIdx] || '#fff';
      const X = this.X(x), Y = this.Y(y), rr = r * K;
      this.circleFill(X, Y, rr, rgba(col, 0.22));
      this.circleLine(X, Y, rr, rgba(col, 0.9), 1);
      const n = Math.round(24 * left / 100);
      for (let k = 0; k < n; k++) {
        const an = -Math.PI / 2 + (k / 24) * TAU;
        this.rect(X + Math.cos(an) * (rr + 2), Y + Math.sin(an) * (rr + 2), 1, 1, col);
      }
      const style = ab.style || 'fire';
      for (let k = 0; k < 8; k++) {
        const seed = id * 31 + k;
        const ph = (anim * 0.8 + prand(seed)) % 1;
        if (ph > 0.85) continue;
        const an = prand(seed + 1) * TAU, rad = Math.sqrt(prand(seed + 2)) * rr * 0.85;
        const qx = X + Math.cos(an) * rad, qy = Y + Math.sin(an) * rad;
        const c2 = style === 'fire' ? (k % 2 ? '#ffd166' : '#ff6a2a') : style === 'ice' ? '#dff6ff' : style === 'poison' ? '#9dff7a' : style === 'void' ? '#b56cff' : '#fff6c2';
        this.rect(qx, qy - ph * 8, 1, 1, c2);
      }
    }
  }

  // Traps: [id, x, y, radius, owner, abIdx, armed]. Setting = open jaws + ticking ring, armed = snapped shut & glowing.
  drawTraps(f0, anim, tick) {
    const traps = f0[5];
    if (!Array.isArray(traps)) return;
    for (const tr of traps) {
      const [id, x, y, r, owner, abIdx, armed] = tr;
      const def = this.fighters[owner];
      if (!def) continue;
      const col = def.abColors[abIdx] || '#fff';
      const X = this.X(x), Y = this.Y(y), rr = Math.max(4, Math.round(r * K));
      const pulse = 0.5 + 0.5 * Math.sin(anim * 5 + id);
      if (!armed) {
        // being set: dashed circle and open jaws, blinking
        for (let k = 0; k < 16; k++) if ((k + Math.floor(anim * 8)) % 2 === 0) {
          const an = (k / 16) * TAU;
          this.rect(X + Math.cos(an) * rr, Y + Math.sin(an) * rr * 0.6, 1, 1, rgba(col, 0.55));
        }
        this.drawTrapJaws(X, Y, rr, col, 1, 0.55);
      } else {
        this.ellipseFill(X, Y, rr, rr * 0.6, rgba(col, 0.08 + 0.08 * pulse));
        this.ellipseLine(X, Y, rr, rr * 0.6, rgba(col, 0.55 + 0.35 * pulse));
        this.drawTrapJaws(X, Y, rr, col, 0.35, 1);
        if (Math.floor(anim * 3 + id) % 3 === 0) this.rect(X, Y - 1, 1, 1, '#ffffff');
      }
    }
  }

  drawTrapJaws(X, Y, rr, col, open, alpha) {
    const w = Math.max(3, Math.round(rr * 0.8));
    const gap = Math.round(1 + open * 3);
    const metal = rgba('#aeb6c4', alpha), dark = rgba('#3a3f4c', alpha);
    for (const s of [-1, 1]) {
      const yy = Y + s * gap;
      this.rect(X - w, yy, w * 2 + 1, 1, metal);
      for (let k = -w; k <= w; k += 2) this.rect(X + k, yy - s, 1, 1, metal);
      this.rect(X - w - 1, yy, 1, 1, dark); this.rect(X + w + 1, yy, 1, 1, dark);
    }
    this.rect(X - 1, Y, 3, 1, rgba(col, alpha));
  }

  // v4 turrets: [id, x, y, owner, abIdx, leftPct] — a small gun post that tracks the enemy.
  drawTurret(tu, fs, anim) {
    const [id, x, y, owner, abIdx, left] = tu;
    const def = this.fighters[owner];
    if (!def) return;
    const col = def.abColors[abIdx] || def.ai;
    const X = this.X(x), Y = this.Y(y);
    const foe = fs[1 - owner];
    const ang = foe ? Math.atan2(foe.y - y, foe.x - x) : 0;
    this.ellipseFill(X, Y + 1, 7, 2, 'rgba(0,0,0,0.4)');
    this.ellipseLine(X, Y + 1, 8, 3, rgba(def.ai, 0.8));
    this.rect(X - 5, Y - 3, 11, 4, '#16121e'); this.rect(X - 4, Y - 3, 9, 3, '#4a5064'); this.rect(X - 4, Y - 3, 9, 1, '#6e7890');
    this.rect(X - 2, Y - 9, 5, 7, '#16121e'); this.rect(X - 1, Y - 9, 3, 6, '#5a6278'); this.rect(X, Y - 9, 1, 6, '#7a8498');
    const hx = X, hy = Y - 11;
    const bx = hx + Math.cos(ang) * 7, by = hy + Math.sin(ang) * 3.5;
    this.line(hx, hy, bx, by, '#16121e', 3);
    this.line(hx, hy, bx, by, '#aeb6c4');
    this.circleFill(hx, hy, 4, '#16121e');
    this.circleFill(hx, hy, 3, col);
    this.rect(hx - 1, hy - 2, 2, 1, mixHex(col, '#ffffff', 0.55));
    if (Math.floor(anim * 2 + id) % 2) this.rect(hx + (Math.cos(ang) > 0 ? 1 : -1), hy, 1, 1, '#ffffff');
    const n = Math.round(6 * clamp((left || 0) / 100, 0, 1));
    for (let k = 0; k < 6; k++) this.rect(X - 6 + k * 2, Y + 4, 1, 1, k < n ? col : 'rgba(0,0,0,0.45)');
  }

  // v4 emotes: a small speech bubble with a pixel icon.
  emoteBubble(f, v, age) {
    if (!f) return;
    const X = this.X(f.x), top = this.Y(f.y) + Math.round(this.R * 0.55 * K) - SIZE - 26;
    const pop = age < 0.08 ? 2 : age < 0.16 ? -1 : 0;
    const alpha = age > 1.3 ? Math.max(0, 1 - (age - 1.3) / 0.3) : 1;
    const b = this.b;
    b.globalAlpha = alpha;
    const w = 17, h = 12, x0 = X - 8, y0 = top + pop;
    this.rect(x0 - 1, y0, w + 2, h, '#111520'); this.rect(x0, y0 - 1, w, h + 2, '#111520');
    this.rect(x0, y0, w, h, '#f7f8fb');
    this.rect(X - 1, y0 + h, 3, 1, '#111520'); this.rect(X, y0 + h, 1, 1, '#f7f8fb'); this.rect(X, y0 + h + 1, 1, 1, '#111520');
    const cx = X, cy = y0 + 6;
    const px = (pts, col) => { for (const [dx, dy] of pts) this.rect(cx + dx, cy + dy, 1, 1, col); };
    switch (v) {
      case 'rage': px([[-3, -3], [-2, -2], [-3, 2], [-2, 1], [3, -3], [2, -2], [3, 2], [2, 1], [-1, -1], [1, -1], [-1, 0], [1, 0]], '#e0283a'); break;
      case 'cheer': px([[0, -4], [0, -3], [-1, -2], [0, -2], [1, -2], [-4, -1], [-3, -1], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [3, -1], [4, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-2, 1], [2, 1], [-3, 2], [3, 2]], '#f0b020'); break;
      case 'laugh': b.globalAlpha = alpha; this.text('HA', cx + 1, cy, { color: '#e06a1a', size: 8, outline: null, alpha }); break;
      case 'salute': px([[-3, 1], [-2, 0], [-1, -1], [0, -2], [1, -3], [-3, 2], [-2, 2], [-1, 2], [0, 1], [1, 0], [2, -1], [3, -2], [2, -3], [3, -3]], '#3a6ad8'); break;
      case 'bow': px([[-4, 0], [-3, 0], [-1, 0], [0, 0], [2, 0], [3, 0], [-2, 2], [1, 2]], '#6a7488'); break;
      default: px([[0, -4], [0, -3], [0, -2], [0, -1], [0, 0], [0, 2], [-3, -4], [-3, -3], [-3, -2], [-3, -1], [-3, 0], [-3, 2], [3, -4], [3, -3], [3, -2], [3, -1], [3, 0], [3, 2]], '#e0283a'); // taunt: !!!
    }
    b.globalAlpha = 1;
  }

  drawTelegraph(f, anim) {
    if (f.castIdx < 0 || (f.flags & F.KO)) return;
    const ab = f.def.abilities[f.castIdx];
    if (!ab) return;
    const R = this.R;
    const col = f.def.abColors[f.castIdx];
    const p = clamp(f.castProg / 100, 0, 1);
    const dir = Math.atan2(f.ty - f.y, f.tx - f.x);
    const X = this.X(f.x), Y = this.Y(f.y);
    const blink = Math.floor(anim * 4) % 2 === 0;
    switch (ab.type) {
      case 'melee': {
        const reach = (2 * R + (ab.range || 40)) * K, half = Math.min(Math.PI, ((ab.arc || 90) / 2) * DEG);
        this.wedgeFill(X, Y, reach, dir, half, rgba(col, 0.12));
        this.wedgeFill(X, Y, Math.max(3, reach * p), dir, half, rgba(col, 0.28));
        this.arcPixels(X, Y, reach, dir - half, dir + half, blink ? col : rgba(col, 0.6));
        break;
      }
      case 'area': {
        if (ab.target === 'point') { // ground-targeted: telegraph at the target point
          const ZX = this.X(f.tx), ZY = this.Y(f.ty), rr = (ab.radius || 80) * K;
          this.circleFill(ZX, ZY, rr, rgba(col, 0.1));
          this.circleFill(ZX, ZY, rr * p, rgba(col, 0.22));
          this.circleLine(ZX, ZY, rr, blink ? col : rgba(col, 0.6));
          break;
        }
        const rr = ((ab.radius || 80) + R) * K;
        this.circleFill(X, Y, rr, rgba(col, 0.1));
        this.circleFill(X, Y, rr * p, rgba(col, 0.22));
        this.circleLine(X, Y, rr, blink ? col : rgba(col, 0.6));
        break;
      }
      case 'zone': {
        let zx = f.tx, zy = f.ty;
        const d = Math.hypot(zx - f.x, zy - f.y);
        if (ab.range !== undefined && d > ab.range && d > 0) { zx = f.x + (zx - f.x) / d * ab.range; zy = f.y + (zy - f.y) / d * ab.range; }
        const ZX = this.X(zx), ZY = this.Y(zy), rr = (ab.radius || 80) * K;
        const steps = Math.max(1, Math.floor(Math.hypot(ZX - X, ZY - Y) / 2));
        for (let k = 0; k <= steps; k += 2) this.rect(X + (ZX - X) * k / steps, Y + (ZY - Y) * k / steps, 1, 1, rgba(col, 0.6));
        this.circleFill(ZX, ZY, rr, rgba(col, 0.1));
        this.circleFill(ZX, ZY, rr * p, rgba(col, 0.24));
        this.circleLine(ZX, ZY, rr, blink ? col : rgba(col, 0.6));
        break;
      }
      case 'projectile': {
        const len = Math.min(ab.range || 600, 340) * K;
        const n = ab.count || 1;
        for (let k = 0; k < n; k++) {
          const off = n > 1 ? (-(ab.spread || 0) / 2 + ((ab.spread || 0) * k) / (n - 1)) * DEG : 0;
          const an = dir + off;
          const x0 = X + Math.cos(an) * R * K, y0 = Y + Math.sin(an) * R * K;
          const L = len * (0.35 + 0.65 * p);
          const segs = Math.max(2, Math.floor(L / 2));
          for (let s2 = 0; s2 < segs; s2 += 2) {
            const t0 = s2 / segs;
            this.rect(x0 + Math.cos(an) * L * t0, y0 + Math.sin(an) * L * t0, 1, 1, rgba(col, 1 - t0 * 0.7));
          }
        }
        break;
      }
      case 'dash': {
        const L = (ab.distance || 200) * K;
        const x1 = X + Math.cos(dir) * L, y1 = Y + Math.sin(dir) * L;
        const segs = Math.max(2, Math.floor(L / 3));
        for (let s2 = 0; s2 <= segs; s2 += 2) this.rect(X + (x1 - X) * s2 / segs, Y + (y1 - Y) * s2 / segs, 2, 2, rgba(col, 0.75));
        this.line(x1, y1, x1 - Math.cos(dir + 0.6) * 5, y1 - Math.sin(dir + 0.6) * 5, col);
        this.line(x1, y1, x1 - Math.cos(dir - 0.6) * 5, y1 - Math.sin(dir - 0.6) * 5, col);
        break;
      }
      case 'beam': {
        if (f.flags & F.CHANNEL) break; // the beam itself is drawn from the frame data
        const L = Math.min(ab.range || 400, 420) * K;
        for (let k = 0; k < Math.floor(L); k += 3) this.rect(X + Math.cos(dir) * k, Y - LIFT + Math.sin(dir) * k, 1, 1, rgba(col, (1 - k / L) * (0.4 + 0.5 * p)));
        this.circleFill(X + Math.cos(dir) * R * K, Y - LIFT + Math.sin(dir) * R * K, 1 + p * 2, rgba(col, 0.8));
        break;
      }
      case 'trap': {
        const ZX = this.X(f.tx), ZY = this.Y(f.ty);
        const rr = Math.max(4, (ab.radius || 40) * K);
        this.ellipseLine(ZX, ZY, rr, rr * 0.6, blink ? col : rgba(col, 0.5));
        break;
      }
      default: {
        const rr = R * K * 1.6;
        this.arcPixels(X, Y - R * K, rr, -Math.PI / 2, -Math.PI / 2 + TAU * p, col, 2);
      }
    }
  }

  // Meteor calls: a reticle on the ground and a burning rock falling onto it.
  drawMeteors(fr, anim) {
    const list = this.meteorList;
    if (!list || !list.length) return;
    for (const m of list) {
      const dur = Math.max(0.05, m.delay || 0) * this.tickRate;
      const age = fr - m.t;
      if (age < 0 || age > dur) continue;
      const def = this.fighters[m.a];
      const col = def ? def.abColors[m.ab] || '#ff7a2a' : '#ff7a2a';
      const p = age / dur;
      const X = this.X(m.x), Y = this.Y(m.y), rr = Math.max(4, (m.r || 80) * K);
      const blink = Math.floor(anim * (6 + p * 10)) % 2 === 0;
      this.ellipseFill(X, Y, rr, rr * 0.62, rgba(col, 0.08 + 0.12 * p));
      this.ellipseFill(X, Y, rr * p, rr * 0.62 * p, rgba(col, 0.18));
      this.ellipseLine(X, Y, rr, rr * 0.62, blink ? col : rgba(col, 0.55));
      for (const s of [-1, 1]) { this.rect(X + s * (rr + 2), Y, 3 * s, 1, col); this.rect(X, Y + s * (rr * 0.62 + 2), 1, 2 * s, col); }
      // shadow of the falling rock grows
      this.ellipseFill(X, Y, 2 + p * 6, 1 + p * 2, `rgba(0,0,0,${0.2 + 0.3 * p})`);
      // the rock, trailing fire
      const hx = X + (1 - p) * 34, hy = Y - (1 - p) * 120 - 8;
      for (let k = 7; k >= 1; k--) {
        const j = (prand(m.t * 3 + k + Math.floor(anim * 20)) - 0.5) * 2;
        this.circleFill(hx + k * 2.4 + j, hy - k * 7, Math.max(1, 6 - k * 0.7), k % 2 ? rgba('#ffd166', 0.55 - k * 0.05) : rgba(col, 0.6 - k * 0.05));
      }
      this.circleFill(hx, hy, 7, rgba('#ff9a2a', 0.45));
      this.circleFill(hx, hy, 5, '#3a2622');
      this.circleFill(hx - 1, hy - 1, 3, '#6a4a3e');
      this.rect(hx - 2, hy - 2, 1, 1, '#a07a60');
      this.circleLine(hx, hy, 5, '#ffb347');
      if (Math.floor(anim * 16) % 2) this.rect(hx + 3, hy + 3, 2, 1, '#ffe8a0');
    }
  }

  // ── fighters ──────────────────────────────────────────────────────────────
  /** Choose the animation frame for a fighter at this moment. */
  poseFor(f, fr, t, anim) {
    const def = f.def, px = f.weaponIdx === 1 && def.pxOff ? def.pxOff : def.px, s = f.side, tr = this.tickRate;
    const rich = px.rich;
    const out = { img: null, name: 'idle', drop: 0, dy: 0 };
    const pick = (name, k) => { const list = animFrames(px, name); out.name = name; out.img = list[((k % list.length) + list.length) % list.length]; return out; };
    const hold = (name, k) => { const list = animFrames(px, name); out.name = name; out.img = list[clamp(k, 0, list.length - 1)]; return out; };
    if (f.flags & F.KO) {
      if (!hasAnim(px, 'ko')) { out.img = px.koFrame; out.name = 'ko'; out.drop = 8; return out; }
      const kt = this.koAt[s] !== null ? this.koAt[s] : fr;
      hold('ko', Math.floor(Math.max(0, fr - kt) / tr * ANIM_FPS.ko));
      if (!rich) out.drop = 8;
      return out;
    }
    const res = this.replay.result;
    if (t >= this.duration - 1e-6 && res && res.winner === s) {
      if (hasAnim(px, 'victory')) return pick('victory', Math.floor(anim * ANIM_FPS.victory));
      pick('idle', Math.floor(anim * 2.5));
      out.dy = Math.floor(anim * 4) % 4 === 1 ? -2 : Math.floor(anim * 4) % 4 === 2 ? -1 : 0;
      return out;
    }
    const hit = lastOf(this.hitInfo[s], fr);
    if (hit) {
      const age = (fr - hit.t) / tr;
      if (hit.block && age < 0.3 && hasAnim(px, 'block')) return hold('block', 1);
      if (age < 0.24 && (hasAnim(px, 'hurt'))) return hold('hurt', age < 0.12 ? 0 : 1);
    }
    if (f.flags & F.COUNTER) {
      const c = lastOf(this.counters[s], fr);
      return hold('block', c && c.ok && (fr - c.t) / tr < 0.3 ? 1 : 0);
    }
    if (f.flags & F.DASH) return pick('dash', Math.floor(anim * ANIM_FPS.dash));
    if (f.castIdx >= 0 && (f.flags & (F.CAST | F.CHANNEL))) {
      const kind = def.abAnim[f.castIdx] || 'cast';
      const p = clamp(f.castProg / 100, 0, 1);
      if (kind === 'attack') {
        const n = animFrames(px, 'attack').length, half = Math.max(1, Math.floor(n / 2));
        return hold('attack', Math.min(half - 1, Math.floor(p * half)));
      }
      if (kind === 'block') return hold('block', 0);
      if (kind === 'dash') return hold(hasAnim(px, 'dash') ? 'dash' : 'attack', 0);
      const name = hasAnim(px, 'cast') ? 'cast' : 'attack';
      const n = animFrames(px, name).length;
      if (f.flags & F.CHANNEL) return hold(name, n >= 3 ? n - 1 - (Math.floor(anim * 6) % 2) : n - 1);
      return hold(name, Math.min(Math.max(0, n - 2), Math.floor(p * Math.max(1, n - 1))));
    }
    const act = lastOf(this.acts[s], fr);
    if (act) {
      const age = (fr - act.t) / tr;
      const kind = act.k === 'swing' ? 'attack' : act.k === 'dash' ? 'dash' : (def.abAnim[act.ab] || 'cast');
      if (kind === 'attack' && age < 0.3) {
        const n = animFrames(px, 'attack').length, half = Math.floor(n / 2);
        return hold('attack', half + Math.floor((age / 0.3) * (n - half)));
      }
      if (kind === 'cast' && age < 0.26) {
        const name = hasAnim(px, 'cast') ? 'cast' : 'attack';
        return hold(name, animFrames(px, name).length - 1);
      }
    }
    if (f.moving) {
      const n = animFrames(px, 'walk').length;
      const odo = this.odo[s];
      const i0 = Math.min(odo.length - 1, Math.floor(fr)), i1 = Math.min(odo.length - 1, i0 + 1);
      const dist = lerp(odo[i0], odo[i1], fr - i0);
      const k = Math.floor((dist / STRIDE) * n);
      // backing away while facing the enemy: play the cycle in reverse (no moonwalking)
      const sp = Math.hypot(f.vx, f.vy) || 1;
      const back = (f.vx * Math.cos(f.facing) + f.vy * Math.sin(f.facing)) < -0.35 * sp;
      return pick('walk', back ? n - 1 - (k % n) : k);
    }
    return pick('idle', Math.floor(anim * (rich ? ANIM_FPS.idle : 2.5) + s * 1.7));
  }

  /** Procedural motion on top of the frames: lunges, recoil, squash & stretch. */
  motionFor(f, fr) {
    const s = f.side, tr = this.tickRate;
    let dx = 0, dy = 0, sq = 0;
    if (f.flags & F.KO) return { dx, dy, sq };
    const act = lastOf(this.acts[s], fr);
    if (act && act.k === 'swing') {
      const age = (fr - act.t) / tr;
      if (age < 0.22) {
        const k = age / 0.22;
        const amp = 3.2 * Math.sin(k * Math.PI);
        const d = (act.d || 0) * DEG;
        dx += Math.cos(d) * amp; dy += Math.sin(d) * amp * 0.5;
        if (age < 0.06) sq = -1;
      }
    }
    const hit = lastOf(this.hitInfo[s], fr);
    if (hit) {
      const age = (fr - hit.t) / tr;
      if (age < 0.2) {
        const k = 1 - age / 0.2;
        const amp = (hit.block ? 1.5 : hit.big ? 4.5 : 2.5) * k * k;
        dx += Math.cos(hit.dir) * amp; dy += Math.sin(hit.dir) * amp * 0.5;
        if (hit.big && age < 0.14) dx += (Math.floor(fr) & 1) ? 1 : -1;
        if (age < 0.07) sq = 1;
      }
    }
    // landing after a dash: a quick squash
    if (!(f.flags & F.DASH)) {
      const i = Math.floor(fr);
      for (let k = 1; k <= 3; k++) {
        const p = this.frames[i - k];
        if (p && (p[1 + s][5] & F.DASH)) { sq = 1; break; }
      }
    }
    return { dx, dy, sq };
  }

  /** Draw a 32×32 frame with its feet at footY; sq > 0 squashes (top half 1 px lower), sq < 0 stretches. */
  drawSprite(def, frame, X, footY, flip, alpha = 1, white = 0, sq = 0) {
    const b = this.b;
    const x = Math.round(X - SIZE / 2), y = Math.round(footY - SIZE + 1);
    b.save();
    b.globalAlpha = alpha;
    const put = (img) => {
      if (!sq) { b.drawImage(img, 0, 0); return; }
      const cut = 20;
      b.drawImage(img, 0, cut, SIZE, SIZE - cut, 0, cut, SIZE, SIZE - cut);
      if (sq > 0) b.drawImage(img, 0, 0, SIZE, cut, 0, 1, SIZE, cut);
      else { b.drawImage(img, 0, cut - 1, SIZE, 1, 0, cut - 1, SIZE, 1); b.drawImage(img, 0, 0, SIZE, cut, 0, -1, SIZE, cut); }
    };
    if (flip) { b.translate(x + SIZE, y); b.scale(-1, 1); } else b.translate(x, y);
    put(frame);
    if (white > 0) {
      b.globalAlpha = alpha * white;
      put(whiteOf(def.px, frame));
    }
    b.restore();
  }

  drawShadow(f, anim) {
    const X = this.X(f.x), Y = this.Y(f.y);
    const footY = Y + Math.round(this.R * 0.55 * K);
    const ko = !!(f.flags & F.KO);
    this.ellipseFill(X, footY, 10, 3, 'rgba(0,0,0,0.45)');
    this.ellipseLine(X, footY, 12, 4, rgba(f.def.ai, ko ? 0.3 : 0.95));
    const rings = [];
    if (f.flags & F.POWER) rings.push('#ff5d5d');
    if (f.flags & F.ARMOR) rings.push('#c9d3e6');
    if (f.flags & F.SPEED) rings.push('#ffe27a');
    if (f.flags & F.REGEN) rings.push('#5ff2e6');
    if (f.flags & F.HASTE) rings.push('#46e8ff');
    if (f.flags & F.CRITBUFF) rings.push('#ff9a2a');
    if (f.flags & F.TENACITY) rings.push('#9fb4d8');
    rings.slice(0, 4).forEach((col, k) => { if ((Math.floor(anim * 6) + k) % 3) this.ellipseLine(X, footY, 14 + k * 2, 5 + k, col); });
  }

  drawFighter(f, fr, anim, i, t) {
    const R = this.R;
    const def = f.def;
    const ko = !!(f.flags & F.KO);
    const X = this.X(f.x), Y = this.Y(f.y);
    const footY = Y + Math.round(R * 0.55 * K);
    const flip = Math.cos(f.facing) < -0.05;
    const pose = this.poseFor(f, fr, t, anim);
    const frame = pose.img;
    const mo = this.motionFor(f, fr);
    const col = this.dashColor(f, fr);

    if (f.flags & F.DASH) {
      const tp = lastOf(this.dashEvents[f.side], fr);
      if (!(tp && tp.tp)) {
        const tint = mixHex(col, '#ffffff', 0.35);
        for (const [k, al] of [[6, 0.12], [4, 0.2], [2, 0.32]]) {
          const pf = this.frames[Math.max(0, i - k)][1 + f.side];
          const ghost = tintOf(def.px, frame, tint);
          this.drawSprite(def, ghost, this.X(pf[0]), this.Y(pf[1]) + Math.round(R * 0.55 * K), flip, al);
        }
      }
    }
    const sinceHit = this.since(this.hitFrames[f.side], fr);
    const white = sinceHit < 0.05 ? 0.7 : 0;
    const inv = f.flags & (F.INVULN);
    const alpha = ko ? (pose.drop ? 0.85 : 1) : inv ? 0.5 + 0.12 * Math.sin(anim * 9) : 1; // steady see-through, no strobing
    const bob = !ko && !f.moving && (f.flags & F.CAST) === 0 && def.px.frames.idle.length < 2 && pose.name === 'idle' ? (Math.floor(anim * 2) % 2) : 0;
    const sx = X + Math.round(mo.dx);
    const sy = footY + pose.drop + pose.dy - bob + Math.round(mo.dy);
    // counter stance / immunity: a flickering glow outline around the sprite
    if (!ko && (f.flags & (F.COUNTER | F.IMMUNE))) {
      const glow = f.flags & F.COUNTER ? '#ffffff' : '#ffe07a';
      if (true) { // steady glow (a slow pulse, not a strobe)
        const g = tintOf(def.px, frame, glow);
        for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) this.drawSprite(def, g, sx + ox, sy + oy, flip, 0.75);
      }
    }
    this.drawSprite(def, frame, sx, sy, flip, alpha, white, mo.sq);
    // remember where the sprite went (x-ray ghosts behind obstacles)
    f._img = frame; f._flip = flip; f._sx = sx - SIZE / 2; f._sy = sy - SIZE + 1;
    if (def.aura && !ko && !this.mini) drawAura(this, def.aura, sx, footY, anim, f.side * 101 + 7, (f.flags & F.CAST) ? 1 : 0.8);
    this.drawStatusFx(f, sx, footY, anim);
  }

  dashColor(f, fr) {
    const d = lastOf(this.dashEvents[f.side], fr);
    if (d && d.ab !== undefined && f.def.abColors[d.ab]) return f.def.abColors[d.ab];
    return f.def.trail || f.def.ai;
  }

  /** In-world status effects around the body (the icons go above the HP bar). */
  drawStatusFx(f, X, footY, anim) {
    const fl = f.flags;
    if (fl & F.KO) return;
    const headY = footY - SIZE;
    if (fl & F.STUN) {
      for (let k = 0; k < 3; k++) {
        const an = anim * 5 + k * TAU / 3;
        const sx = X + Math.cos(an) * 9, sy = headY + 3 + Math.sin(an) * 3;
        this.rect(sx, sy - 1, 1, 3, '#ffe066');
        this.rect(sx - 1, sy, 3, 1, '#ffe066');
      }
    }
    if (fl & F.SLOW) {
      for (let k = 0; k < 5; k++) {
        const an = k * 1.3 + anim * 1.2;
        this.rect(X + Math.cos(an) * 11, footY - 3 + Math.sin(an) * 3, 1, 1, k % 2 ? '#bfe9ff' : '#6cc6ff');
      }
    }
    if (fl & F.BURN) {
      for (let k = 0; k < 6; k++) {
        const ph = (anim * 1.7 + k / 6) % 1;
        const bx = X + Math.round(Math.sin(k * 2.1 + anim * 3) * 6);
        const sz = ph > 0.6 ? 1 : 2;
        this.rect(bx, footY - 6 - ph * 26, sz, sz, ph > 0.5 ? '#ffd166' : '#ff5a1f');
      }
    }
    if (fl & F.POISON) {
      for (let k = 0; k < 4; k++) {
        const ph = (anim * 1.1 + k / 4) % 1;
        const bx = X + Math.round(Math.sin(k * 2.7 + anim * 2) * 7);
        if (ph < 0.8) this.circleLine(bx, footY - 8 - ph * 20, ph > 0.4 ? 1 : 0, rgba(k % 2 ? '#8cf04a' : '#4ac06a', 1 - ph));
      }
    }
    if (fl & F.BLEED) {
      for (let k = 0; k < 3; k++) {
        const ph = (anim * 1.4 + k / 3) % 1;
        const bx = X - 4 + k * 4 + (k === 1 ? 1 : 0);
        this.rect(bx, footY - 18 + ph * 14, 1, ph < 0.8 ? 2 : 1, rgba('#d8283b', 1 - ph * 0.6));
      }
    }
    if (fl & F.ROOT) {
      for (let k = 0; k < 6; k++) {
        const an = (k / 6) * TAU + 0.3;
        const rx = X + Math.cos(an) * 8, ry = footY + Math.sin(an) * 3;
        const h = 2 + ((k + Math.floor(anim * 2)) % 3);
        for (let j = 0; j < h; j++) this.rect(rx + (j % 2 ? (k % 2 ? 1 : -1) : 0), ry - j, 1, 1, j === h - 1 ? '#8fd46a' : '#6a4a2a');
      }
    }
    if (fl & F.HOT) {
      for (let k = 0; k < 3; k++) {
        const ph = (anim * 0.9 + k / 3) % 1;
        const hx = X - 8 + k * 8, hy = footY - ph * 30;
        this.rect(hx, hy - 1, 1, 3, '#7dffa8');
        this.rect(hx - 1, hy, 3, 1, '#7dffa8');
      }
    }
    if (fl & F.SHIELD) {
      const cy = footY - 15;
      this.circleFill(X, cy, 17, 'rgba(140, 200, 255, 0.12)');
      this.circleLine(X, cy, 17, Math.floor(anim * 8) % 2 ? 'rgba(190, 230, 255, 0.95)' : 'rgba(150, 210, 255, 0.7)');
      const an = anim * 3;
      this.rect(X + Math.cos(an) * 17, cy + Math.sin(an) * 17, 2, 2, '#ffffff');
    }
    if (fl & F.IMMUNE) {
      for (let k = 0; k < 3; k++) {
        const an = anim * 2 + k * TAU / 3;
        this.rect(X + Math.cos(an) * 12, footY - 14 + Math.sin(an) * 12, 1, 1, '#fff6c2');
      }
    }
  }

  /** HP bar, shield bar and status icons: drawn after everything so obstacles never hide them. */
  drawFighterOverlay(f, fr, anim) {
    if (f.flags & F.KO) return;
    const R = this.R, def = f.def;
    const X = this.X(f.x), Y = this.Y(f.y);
    const footY = Y + Math.round(R * 0.55 * K);
    const headY = footY - SIZE;
    const bw = 22, bx = X - 11, by = headY - 5;
    const maxHp = def.maxHp || 1;
    this.rect(bx - 1, by - 1, bw + 2, 4, '#000000');
    this.rect(bx, by, bw, 2, '#3a1418');
    // damage chip: a pale segment trails the last ~0.6 s of lost HP so hits read smoothly
    const fi = clamp(Math.floor(fr), 0, this.frames.length - 1);
    let recent = f.hp;
    for (let j = Math.max(0, fi - 18); j <= fi; j += 3) recent = Math.max(recent, this.frames[j][1 + f.side][2]);
    const hpW = Math.round(bw * clamp(f.hp / maxHp, 0, 1)), chipW = Math.round(bw * clamp(recent / maxHp, 0, 1));
    if (chipW > hpW) this.rect(bx + hpW, by, chipW - hpW, 2, '#f4e0c0');
    this.rect(bx, by, hpW, 2, def.ai);
    if (f.sh > 0) this.rect(bx, by - 2, Math.max(1, Math.round(bw * clamp(f.sh / maxHp, 0, 1))), 1, '#bfe3ff');
    // v4 stance: a small coloured pip left of the bar (balanced shows nothing)
    if (f.stance > 0 && STANCE_COL[f.stance]) { this.rect(bx - 5, by - 1, 3, 4, '#000000'); this.rect(bx - 4, by, 1, 2, STANCE_COL[f.stance]); }
    const icons = this.statusIcons(f.flags);
    if (icons.length) drawStatusIcons(this, this.mini ? icons.slice(0, 3) : icons, X, by - 9, anim);
  }

  statusIcons(fl) {
    const out = [];
    if (fl & F.STUN) out.push('stun');
    if (fl & F.ROOT) out.push('root');
    if (fl & F.SILENCE) out.push('silence');
    if (fl & F.POISON) out.push('poison');
    if (fl & F.BLEED) out.push('bleed');
    if (fl & F.BURN) out.push('burn');
    if (fl & F.SLOW) out.push('slow');
    if (fl & F.VULN) out.push('vuln');
    if (fl & F.WEAK) out.push('weak');
    if (fl & F.IMMUNE) out.push('immune');
    if (fl & F.COUNTER) out.push('counter');
    if (fl & F.POWER) out.push('power');
    if (fl & F.CRITBUFF) out.push('crit');
    if (fl & F.ARMOR) out.push('armor');
    if (fl & F.HASTE) out.push('haste');
    if (fl & F.SPEED) out.push('speed');
    if (fl & F.TENACITY) out.push('tenacity');
    return out;
  }

  // ── projectiles & beams ───────────────────────────────────────────────────
  drawProjectiles(f0, f1, a, i) {
    if (!f0[3] || !f0[3].length) return;
    const next = new Map(f1[3].map(p => [p[0], p]));
    const back = i >= 2 ? new Map(this.frames[i - 2][3].map(p => [p[0], p])) : null;
    for (const p of f0[3]) {
      const [id, x0, y0, owner, abIdx, r, dirDeg] = p;
      const q = next.get(id);
      const wx = q ? lerp(x0, q[1], a) : x0, wy = q ? lerp(y0, q[2], a) : y0;
      const X = this.X(wx), Yf = this.Y(wy), Y = Yf - LIFT;
      let dd = q ? q[6] - dirDeg : 0;
      if (dd > 180) dd -= 360; else if (dd < -180) dd += 360;
      const dir = (dirDeg + dd * a) * DEG;
      const def = this.fighters[owner];
      if (!def) continue;
      const col = def.abColors[abIdx] || '#fff';
      const style = (def.abilities[abIdx] || {}).style || 'orb';
      const rr = Math.max(1, Math.round(r * K));
      // shadow on the floor keeps the height readable
      this.ellipseFill(X, Yf + 1, Math.max(1, rr * 0.8), 1, 'rgba(0,0,0,0.3)');
      const bk = back && back.get(id);
      if (bk && style !== 'bullet') {
        const BX = this.X(bk[1]), BY = this.Y(bk[2]) - LIFT;
        const steps = Math.max(1, Math.round(Math.hypot(X - BX, Y - BY)));
        for (let s2 = 0; s2 < steps; s2++) {
          if (style !== 'fireball' && s2 % 2) continue;
          const t0 = s2 / steps;
          this.rect(BX + (X - BX) * t0, BY + (Y - BY) * t0, 1, 1, rgba(col, 0.25 + 0.5 * t0));
        }
      }
      drawProjectile(this, style, X, Y, dir, rr, col, id, i);
    }
  }

  // Beams: [owner, abIdx, x1, y1, x2, y2, width] — a channelled line at hand height.
  drawBeams(f0, f1, a, anim, tick) {
    const beams = f0[6];
    if (!Array.isArray(beams) || !beams.length) return;
    const next = Array.isArray(f1[6]) ? f1[6] : [];
    for (const bm of beams) {
      const [owner, abIdx] = bm;
      const q = next.find(n => n[0] === owner && n[1] === abIdx);
      const at = (k) => (q ? lerp(bm[k], q[k], a) : bm[k]);
      const def = this.fighters[owner];
      if (!def) continue;
      const col = def.abColors[abIdx] || '#fff';
      const light = mixHex(col, '#ffffff', 0.6);
      const X1 = this.X(at(2)), Y1f = this.Y(at(3)), X2 = this.X(at(4)), Y2f = this.Y(at(5));
      const Y1 = Y1f - LIFT, Y2 = Y2f - LIFT;
      const w = Math.max(1, Math.round((bm[6] || 10) * K));
      const flick = prand(tick * 7 + owner) < 0.5 ? 1 : 0;
      // light cast on the floor under the beam
      this.line(X1, Y1f + 1, X2, Y2f + 1, rgba(col, 0.22), 1);
      // glow, body, hot core (drawn on a scratch layer so the thick strokes don't stack their alpha)
      const g = this.fxLayer();
      g.fillStyle = col;
      this.lineOn(g, X1, Y1, X2, Y2, w + 2 + flick);
      this.b.globalAlpha = 0.3;
      this.b.drawImage(this._fx, 0, 0);
      this.b.globalAlpha = 1;
      this.line(X1, Y1, X2, Y2, col, Math.max(1, w - 1 + flick));
      this.line(X1, Y1, X2, Y2, light, w >= 4 ? 2 : 1);
      const L = Math.hypot(X2 - X1, Y2 - Y1) || 1;
      for (let k = 0; k < 7; k++) {
        const ph = (anim * 2.2 + k / 7) % 1;
        const px2 = X1 + (X2 - X1) * ph + (prand(k + tick) - 0.5) * 2, py2 = Y1 + (Y2 - Y1) * ph + (prand(k * 3 + tick) - 0.5) * 2;
        this.rect(px2, py2, 1, 1, k % 2 ? '#ffffff' : light);
      }
      // end flare
      const fr2 = 2 + flick + (L > 4 ? 1 : 0);
      this.circleFill(X2, Y2, fr2 + 1, rgba(col, 0.35));
      this.circleFill(X2, Y2, fr2, light);
      for (let k = 0; k < 4; k++) {
        const an = anim * 9 + k * TAU / 4;
        this.rect(X2 + Math.cos(an) * (fr2 + 3), Y2 + Math.sin(an) * (fr2 + 3), 1, 1, light);
      }
      // origin glow at the caster's hands
      this.circleFill(X1, Y1, 2 + flick, rgba(light, 0.9));
    }
  }

  /** A cleared scratch canvas the size of the buffer (for translucent thick strokes). */
  fxLayer() {
    if (!this._fx) this._fx = document.createElement('canvas');
    if (this._fx.width !== this.bw || this._fx.height !== this.bh) { this._fx.width = this.bw; this._fx.height = this.bh; }
    const g = this._fx.getContext('2d');
    g.clearRect(0, 0, this.bw, this.bh);
    return g;
  }

  lineOn(g, x0, y0, x1, y1, w = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 2000; guard++) {
      g.fillRect(x0 - (w >> 1), y0 - (w >> 1), w, w);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // ── events ────────────────────────────────────────────────────────────────
  drawEventsUnder(fr) {
    const R = this.R;
    this.eventsIn(fr - 18, fr, (e, idx) => {
      const age = (fr - e.t) / this.tickRate;
      if (age < 0) return;
      const def = this.fighters[e.a];
      if (!def) return;
      const col = e.ab !== undefined ? def.abColors[e.ab] || '#fff' : '#fff';
      if (e.k === 'burst') {
        const big = this.meteorBooms.has(idx);
        const dur = big ? 0.55 : 0.42;
        if (age > dur) return;
        const k = easeOut(age / dur);
        const rr = (R + (e.r || 80) * k) * K;
        const X = this.X(e.x), Y = this.Y(e.y);
        this.circleFill(X, Y, rr, rgba(col, 0.2 * (1 - age / dur)));
        this.circleLine(X, Y, rr, rgba(col, 1 - age / dur), 2);
        if (big) {
          this.circleFill(X, Y, rr * 0.6 * (1 - k), rgba('#fff4c2', 0.7));
          for (let n = 0; n < 10; n++) {
            const an = prand(idx * 11 + n) * TAU, d = rr * (0.3 + k * 0.8);
            this.rect(X + Math.cos(an) * d, Y + Math.sin(an) * d * 0.6 - k * 6, 2, 2, n % 2 ? '#5a4038' : '#ffb347');
          }
        }
      } else if (e.k === 'zone') {
        const dur = 0.35;
        if (age > dur) return;
        this.circleLine(this.X(e.x), this.Y(e.y), (e.r || 80) * K * (0.6 + 0.5 * easeOut(age / dur)), rgba(col, 1 - age / dur), 2);
      } else if (e.k === 'dash') {
        const dur = 0.4;
        if (age > dur) return;
        const dust = DUST[this.themeId] || '#c8c8d2';
        for (let k = 0; k < 6; k++) {
          const an = ((e.d || 0) + 180) * DEG + (prand(e.t * 5 + k) - 0.5) * 1.6;
          const d = 3 + 10 * easeOut(age / dur);
          this.rect(this.X(e.x) + Math.cos(an) * d, this.Y(e.y) + R * 0.5 * K + Math.sin(an) * d * 0.4, 2, 2, rgba(dust, 0.55 * (1 - age / dur)));
        }
      } else if (e.k === 'trap' || e.k === 'trigger') {
        const dur = e.k === 'trap' ? 0.3 : 0.5;
        if (age > dur) return;
        const X = this.X(e.x), Y = this.Y(e.y), rr = Math.max(4, (e.r || 40) * K);
        this.ellipseLine(X, Y, rr * (0.6 + easeOut(age / dur)), rr * 0.6 * (0.6 + easeOut(age / dur)), rgba(col, 1 - age / dur));
      } else if (e.k === 'slam') {
        const dur = 0.45;
        if (age > dur) return;
        const X = this.X(e.x), Y = this.Y(e.y);
        const dust = DUST[this.themeId] || '#c8c8d2';
        for (let k = 0; k < 8; k++) {
          const an = prand(idx * 3 + k) * TAU, d = 3 + 12 * easeOut(age / dur);
          this.rect(X + Math.cos(an) * d, Y + Math.sin(an) * d * 0.5, 2, 2, rgba(dust, 0.6 * (1 - age / dur)));
        }
      }
    });
  }

  drawFootsteps(fr, fs) {
    if (this.mini) return;
    const dust = DUST[this.themeId] || '#c8c8d2';
    for (const f of fs) {
      const list = this.steps[f.side];
      if (!list.length) continue;
      // last few steps
      let lo = 0, hi = list.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t <= fr) lo = m + 1; else hi = m; }
      for (let k = Math.max(0, lo - 3); k < lo; k++) {
        const st = list[k];
        const age = (fr - st.t) / this.tickRate;
        if (age > 0.35) continue;
        const X = this.X(st.x), Y = this.Y(st.y) + Math.round(this.R * 0.55 * K);
        const e = easeOut(age / 0.35), al = 0.45 * (1 - age / 0.35);
        this.rect(X - 3 - e * 3, Y - e * 2, 1, 1, rgba(dust, al));
        this.rect(X + 3 + e * 3, Y - e * 2, 1, 1, rgba(dust, al));
        this.rect(X - 1, Y - 1 - e * 3, 1, 1, rgba(dust, al * 0.8));
      }
    }
  }

  drawSwing(e, idx, age, def, col) {
    const R = this.R;
    const ab = def.abilities[e.ab] || {};
    const style = def.abStyle[e.ab] || 'slash';
    const trail = def.trail || col;
    const light = mixHex(trail, '#ffffff', 0.55);
    const reach = (2 * R + (ab.range || 40)) * K, half = Math.min(Math.PI, ((ab.arc || 90) / 2) * DEG), dir = (e.d || 0) * DEG;
    const X = this.X(e.x), Y = this.Y(e.y);
    if (style === 'thrust') {
      const dur = 0.18;
      if (age > dur) return;
      const k = age / dur;
      const L = reach * (0.5 + 0.5 * easeOut(Math.min(1, k * 2)));
      const x1 = X + Math.cos(dir) * L, y1 = Y - LIFT * 0.6 + Math.sin(dir) * L;
      const x0 = X + Math.cos(dir) * L * 0.35, y0 = Y - LIFT * 0.6 + Math.sin(dir) * L * 0.35;
      this.line(x0, y0, x1, y1, rgba(trail, 0.9 * (1 - k)), 2);
      this.line(x0, y0, x1, y1, k < 0.5 ? '#ffffff' : light);
      for (const s of [-1, 1]) this.line(x1 - Math.cos(dir) * 4 + Math.sin(dir) * 2 * s, y1 - Math.sin(dir) * 4 - Math.cos(dir) * 2 * s, x1, y1, light);
      return;
    }
    if (style === 'claw') {
      const dur = 0.2;
      if (age > dur) return;
      const k = age / dur;
      const cx = X + Math.cos(dir) * reach * 0.75, cy = Y - LIFT * 0.6 + Math.sin(dir) * reach * 0.75;
      const nx = -Math.sin(dir), ny = Math.cos(dir);
      for (let s = -1; s <= 1; s++) {
        const ox = nx * s * 3, oy = ny * s * 3;
        const L = 7 * easeOut(Math.min(1, k * 2.5));
        this.line(cx + ox - Math.cos(dir + 0.9) * L * 0.5, cy + oy - Math.sin(dir + 0.9) * L * 0.5, cx + ox + Math.cos(dir + 0.9) * L * 0.5, cy + oy + Math.sin(dir + 0.9) * L * 0.5, k < 0.5 ? '#ffffff' : rgba(trail, 1 - k));
      }
      return;
    }
    const dur = style === 'smash' ? 0.3 : 0.22;
    if (age > dur) return;
    const k = age / dur;
    if (k < 0.5) this.wedgeFill(X, Y, reach, dir, half, rgba(trail, 0.22 * (1 - k)));
    const a0 = half >= Math.PI - 1e-3 ? dir : dir - half;
    const span = half >= Math.PI - 1e-3 ? TAU : half * 2;
    const end = a0 + span * easeOut(Math.min(1, k * 1.8));
    this.arcPixels(X, Y, reach * 0.9, Math.max(a0, end - 0.9), end, k < 0.6 ? '#ffffff' : trail, 2);
    this.arcPixels(X, Y, reach * 0.9 - 2, Math.max(a0, end - 0.6), end, rgba(light, 0.7 * (1 - k)), 1);
    if (style === 'smash' && k > 0.35) {
      // ground crack where the blow lands
      const gx = X + Math.cos(dir) * reach * 0.8, gy = Y + Math.sin(dir) * reach * 0.8;
      const al = 1 - (k - 0.35) / 0.65;
      for (let s = 0; s < 5; s++) {
        const an = dir + (s - 2) * 0.7;
        const L = 3 + prand(idx + s) * 5;
        this.line(gx, gy, gx + Math.cos(an) * L, gy + Math.sin(an) * L * 0.55, rgba('#1a1420', al));
      }
    }
  }

  drawEventsOver(fr, fs, anim) {
    const R = this.R;
    const texts = [];
    const headAt = (y) => this.Y(y) + Math.round(R * 0.55 * K) - SIZE;
    const posOf = (side) => fs[side] || { x: 0, y: 0 };
    this.eventsIn(fr - Math.ceil(2.6 * this.tickRate), fr, (e, idx) => {
      const age = (fr - e.t) / this.tickRate;
      if (age < 0) return;
      const def = this.fighters[e.a];
      if (!def) return;
      const col = e.ab !== undefined ? def.abColors[e.ab] || '#fff' : '#fff';
      switch (e.k) {
        case 'swing': this.drawSwing(e, idx, age, def, col); break;
        case 'fire': {
          if (age > 0.12) return;
          const dir = (e.d || 0) * DEG;
          this.circleFill(this.X(e.x) + Math.cos(dir) * R * K * 1.2, this.Y(e.y) - LIFT + Math.sin(dir) * R * K * 1.2, 2 + age * 20, rgba(col, 0.9));
          break;
        }
        case 'hit': {
          const X = this.X(e.x), cy = headAt(e.y) + 14;
          const ab = def.abilities[e.ab] || {};
          const crit = !!(e.fl & HF.CRIT), block = !!(e.fl & HF.BLOCK);
          const kind = ab.type === 'melee' ? (def.abStyle[e.ab] || 'slash') : ab.style === 'fireball' ? 'fire' : (ab.style === 'shard' || ab.style === 'frost') ? 'ice' : ab.type === 'dash' ? 'smash' : 'spark';
          if (age < 0.45) impactBurst(this, block ? 'smash' : kind, X, cy, age, block ? '#bfe3ff' : col, idx * 13 + 1, crit || e.dmg >= 100);
          if (age < 1.1 && (e.dmg > 0 || e.abs > 0)) {
            const big = crit || e.dmg >= 100;
            texts.push({ x: X + Math.round((prand(idx) - 0.5) * 12), y: headAt(e.y) - 13, age, text: crit ? `${e.dmg}!` : `${e.dmg}`, color: block ? '#9fb4d8' : e.abs >= e.dmg && e.dmg > 0 ? '#bfe3ff' : crit ? '#ffb02e' : e.dmg >= 100 ? '#ffd166' : '#ffffff', size: big ? 16 : 8, dur: 1.1, pop: crit });
          }
          if (age < 1.0 && crit) texts.push({ x: X, y: headAt(e.y) - 30, age, text: 'CRIT', color: '#ff5a3a', size: 8, dur: 1.0 });
          if (age < 1.0 && block) texts.push({ x: X, y: headAt(e.y) - 24, age, text: 'BLOCK', color: '#bfe3ff', size: 8, dur: 1.0 });
          if (age < 1.2 && (e.fl & HF.STUN)) texts.push({ x: X, y: headAt(e.y) - 24, age, text: 'STUN!', color: '#ffe066', size: 8, dur: 1.2 });
          else if (age < 1.0 && (e.fl & HF.RESISTED)) texts.push({ x: X, y: headAt(e.y) - 24, age, text: 'RESIST', color: '#a7b0c2', size: 8, dur: 1.0 });
          else if (age < 1.0 && !block && !crit) {
            const tag = (e.fl & HF.ROOT) ? ['ROOTED', '#9ad46a'] : (e.fl & HF.SILENCE) ? ['SILENCED', '#b88cff'] : (e.fl & HF.VULN) ? ['EXPOSED', '#ff6a6a'] : (e.fl & HF.WEAK) ? ['WEAKENED', '#b8bcc8'] : (e.fl & HF.POISON) ? ['POISONED', '#8cf04a'] : null;
            if (tag) texts.push({ x: X, y: headAt(e.y) - 24, age, text: tag[0], color: tag[1], size: 8, dur: 1.0 });
          }
          if ((e.fl & (HF.DRAIN | HF.LIFESTEAL)) && age < 0.45) {
            const src = { x: X, y: cy };
            const dst = posOf(e.a);
            const DX = this.X(dst.x), DY = headAt(dst.y) + 16;
            const c2 = e.fl & HF.DRAIN ? '#6cc6ff' : '#ff4d5e';
            for (let n = 0; n < 5; n++) {
              const k2 = clamp(age / 0.45 - n * 0.08, 0, 1);
              if (k2 <= 0 || k2 >= 1) continue;
              const wob = Math.sin(k2 * Math.PI) * 6 * (n % 2 ? 1 : -1);
              this.rect(lerp(src.x, DX, k2), lerp(src.y, DY, k2) - wob, 1, 1, n % 2 ? '#ffffff' : c2);
            }
          }
          break;
        }
        case 'dot':
          if (age < 0.9 && e.dmg >= 3) texts.push({ x: this.X(e.x) + (prand(idx) < 0.5 ? -15 : 15), y: headAt(e.y) + 12, age, side: true, text: `${e.dmg}`, color: e.kind === 'burn' ? '#ffab66' : e.kind === 'thorns' ? '#ff8fa3' : e.kind === 'poison' ? '#9dff7a' : e.kind === 'bleed' ? '#ff5a6a' : '#d6b8ff', size: 8, dur: 0.9 });
          break;
        case 'heal': {
          const f = fs[e.a];
          if (age < 1.2) texts.push({ x: this.X(f.x), y: headAt(f.y) - 13, age, text: `+${e.v}`, color: '#7dffa8', size: 8, dur: 1.2 });
          if (age < 0.5) this.circleLine(this.X(f.x), headAt(f.y) + 16, 10 + age * 20, rgba('#7dffa8', 1 - age / 0.5));
          break;
        }
        case 'shield': {
          const f = fs[e.a];
          if (age < 1.2) texts.push({ x: this.X(f.x), y: headAt(f.y) - 13, age, text: `+${e.v}`, color: '#bfe3ff', size: 8, dur: 1.2 });
          break;
        }
        case 'buff': {
          const f = fs[e.a];
          if (age < 1.3) texts.push({ x: this.X(f.x), y: headAt(f.y) - 13, age, text: `${String(e.stat).toUpperCase()}+`, color: '#ffd76a', size: 8, dur: 1.3 });
          break;
        }
        case 'trait': {
          const f = fs[e.a];
          if (age < 1.6) texts.push({ x: this.X(f.x), y: headAt(f.y) - 24, age, text: e.id === 'second_wind' ? '2ND WIND' : String(e.id).toUpperCase(), color: '#7dffa8', size: 8, dur: 1.6 });
          break;
        }
        case 'evade':
          if (age < 0.9) texts.push({ x: this.X(e.x), y: headAt(e.y) - 16, age, text: 'EVADE', color: '#8fe3ff', size: 8, dur: 0.9 });
          break;
        case 'interrupt': {
          const f = fs[e.a];
          if (age < 1.1) texts.push({ x: this.X(f.x), y: headAt(f.y) - 24, age, text: 'BREAK', color: '#ff9f6b', size: 8, dur: 1.1 });
          break;
        }
        case 'dash': {
          if (!e.tp || age > 0.4) break;
          // teleport: vanish at the start, flash at the destination
          const k = age / 0.4;
          const X1 = this.X(e.x), Y1 = headAt(e.y) + 16, X2 = this.X(e.x2 !== undefined ? e.x2 : e.x), Y2 = headAt(e.y2 !== undefined ? e.y2 : e.y) + 16;
          this.circleLine(X1, Y1, 3 + k * 10, rgba(col, 1 - k));
          for (let n = 0; n < 6; n++) { const an = prand(idx + n) * TAU; this.rect(X1 + Math.cos(an) * (2 + k * 12), Y1 + Math.sin(an) * (2 + k * 12), 1, 1, rgba(col, 1 - k)); }
          if (k < 0.5) { this.circleFill(X2, Y2, 8 * (1 - k * 2), rgba('#ffffff', 0.8)); this.line(X2, Y2 - 14, X2, Y2 + 10, rgba(col, 1 - k * 2), 2); }
          break;
        }
        case 'counter': {
          const f = fs[e.a];
          const X = this.X(f.x), Y = headAt(f.y) + 14;
          if (!e.ok) {
            if (age < 0.25) { const k = age / 0.25; this.rect(X + 6, Y - 6 - k * 4, 1, 3, '#ffffff'); this.rect(X + 5, Y - 5 - k * 4, 3, 1, '#ffffff'); }
            break;
          }
          if (age < 0.4) {
            const k = age / 0.4;
            for (let n = 0; n < 8; n++) { const an = n * TAU / 8; this.line(X + Math.cos(an) * 3, Y + Math.sin(an) * 3, X + Math.cos(an) * (5 + k * 10), Y + Math.sin(an) * (5 + k * 10), rgba(n % 2 ? '#ffe07a' : '#ffffff', 1 - k)); }
            const o = fs[1 - e.a];
            if (o) { const OX = this.X(o.x), OY = headAt(o.y) + 14; this.line(OX - 7, OY - 7, OX + 7, OY + 7, rgba('#ffffff', 1 - k), 2); }
          }
          if (age < 1.3) texts.push({ x: X, y: headAt(f.y) - 24, age, text: 'COUNTER!', color: '#ffe07a', size: this.mini ? 8 : 12, dur: 1.3, pop: true });
          break;
        }
        case 'cleanse': {
          const f = fs[e.a];
          const X = this.X(f.x), foot = headAt(f.y) + SIZE;
          if (age < 0.7) {
            const k = age / 0.7;
            this.ellipseLine(X, foot - k * 26, 9 + k * 6, 3 + k * 2, rgba('#dffcff', 1 - k));
            for (let n = 0; n < 8; n++) { const an = prand(idx + n) * TAU; this.rect(X + Math.cos(an) * (6 + k * 8), foot - 8 - k * 20 + Math.sin(an) * 4, 1, 1, rgba(n % 2 ? '#ffffff' : '#8fe8ff', 1 - k)); }
          }
          if (age < 1.2) texts.push({ x: X, y: headAt(f.y) - 24, age, text: 'CLEANSE', color: '#8fe8ff', size: 8, dur: 1.2 });
          break;
        }
        case 'trigger': {
          if (age < 1.0) texts.push({ x: this.X(e.x), y: this.Y(e.y) - 22, age, text: 'SNAP!', color: '#ffd166', size: 8, dur: 1.0 });
          if (age < 0.25) this.drawTrapJaws(this.X(e.x), this.Y(e.y), Math.max(4, (e.r || 40) * K), col, 0, 1 - age / 0.25);
          if (age < 0.4) impactBurst(this, 'smash', this.X(e.x), this.Y(e.y) - 4, age, col, idx * 7, true);
          break;
        }
        case 'slam': {
          const X = this.X(e.x), Y = this.Y(e.y) - LIFT;
          if (age < 0.4) impactBurst(this, 'smash', X, Y, age, '#ffffff', idx * 5, true);
          if (age < 1.1) texts.push({ x: X, y: Y - 18, age, text: 'SLAM!', color: '#ff9f6b', size: this.mini ? 8 : 12, dur: 1.1, pop: true });
          break;
        }
        case 'beam': {
          if (age > 0.25) break;
          const f = fs[e.a], o = fs[1 - e.a];
          const dir = o ? Math.atan2(o.y - f.y, o.x - f.x) : 0;
          const hx = this.X(f.x) + Math.cos(dir) * 10, hy = headAt(f.y) + 18 + Math.sin(dir) * 5;
          const k = age / 0.25;
          this.circleLine(hx, hy, 2 + k * 7, rgba(mixHex(col, '#ffffff', 0.5), 1 - k));
          break;
        }
        case 'cancel': {
          if (age > 0.3) break;
          const f = fs[e.a];
          const X = this.X(f.x), Y = headAt(f.y) + 10;
          const k = age / 0.3;
          for (let n = 0; n < 4; n++) { const an = n * TAU / 4 + 0.8; this.rect(X + Math.cos(an) * (3 + k * 5), Y + Math.sin(an) * (3 + k * 5), 1, 1, rgba('#c8ccd8', 1 - k)); }
          break;
        }
        case 'relic': { // v4: a relic triggered
          const f = fs[e.a];
          if (!f) break;
          const rel = Array.isArray(def.relics) ? def.relics.find(r => r && (r.id === e.id || r === e.id)) : null;
          const name = rel && rel.name ? rel.name : String(e.id || 'relic').replace(/_/g, ' ');
          const X = this.X(f.x), Y = headAt(f.y) + 14;
          if (age < 0.5) {
            const k = age / 0.5;
            this.circleLine(X, Y, 4 + k * 14, rgba('#ffe07a', 1 - k));
            for (let n = 0; n < 8; n++) { const an = n * TAU / 8 + k; this.rect(X + Math.cos(an) * (6 + k * 12), Y + Math.sin(an) * (6 + k * 12), 1, 1, rgba('#fff6c2', 1 - k)); }
          }
          if (age < 1.6) texts.push({ x: X, y: headAt(f.y) - 24, age, text: String(name).toUpperCase().slice(0, 18), color: '#ffd76a', size: 8, dur: 1.6 });
          break;
        }
        case 'revive': { // v4: back from the dead
          const f = fs[e.a];
          const X = this.X(e.x !== undefined ? e.x : f.x), Yf = this.Y(e.y !== undefined ? e.y : f.y) + Math.round(R * 0.55 * K);
          if (age < 1.0) {
            const k = age / 1.0;
            this.ellipseLine(X, Yf, 6 + k * 22, 2 + k * 8, rgba('#ffe07a', 1 - k));
            this.ellipseLine(X, Yf - k * 30, 9 + k * 5, 3, rgba('#fff6c2', 1 - k));
            for (let n = 0; n < 10; n++) { const an = prand(idx + n) * TAU; this.rect(X + Math.cos(an) * (4 + k * 14), Yf - 6 - k * 34 * prand(idx + n + 3), 1, 2, rgba(n % 2 ? '#ffffff' : '#ffd166', 1 - k)); }
            if (age < 0.25) this.circleFill(X, Yf - 14, 10 * (1 - age / 0.25), rgba('#ffffff', 0.7));
          }
          if (age < 1.8) texts.push({ x: X, y: Yf - SIZE - 24, age, text: 'REVIVED!', color: '#ffe07a', size: 8, dur: 1.8, pop: true });
          break;
        }
        case 'emote':
          if (age < 1.6) this.emoteBubble(fs[e.a], e.v, age);
          break;
        case 'stance': { // v4: stance switch flash
          const f = fs[e.a];
          if (!f || age > 1.0) break;
          const sv = typeof e.v === 'number' ? e.v : STANCES.indexOf(String(e.v));
          const sc = STANCE_COL[sv] || '#c8d0dc';
          const X = this.X(f.x), Yf = this.Y(f.y) + Math.round(R * 0.55 * K);
          if (age < 0.35) { const k = age / 0.35; this.ellipseLine(X, Yf, 8 + k * 10, 3 + k * 3, rgba(sc, 1 - k)); }
          texts.push({ x: X, y: headAt(f.y) - 24, age, text: (STANCES[sv] || 'stance').toUpperCase(), color: sc, size: 8, dur: 1.0 });
          break;
        }
        case 'swap': { // v4: weapon swap
          const f = fs[e.a];
          if (!f || age > 1.0) break;
          const w = e.w ? def.offhand : def.weapon;
          const X = this.X(f.x), Y = headAt(f.y) + 18;
          if (age < 0.3) { const k = age / 0.3; this.arcPixels(X, Y, 8 + k * 3, -Math.PI / 2 + k * 5, Math.PI / 2 + k * 5, rgba('#ffffff', 1 - k), 1); }
          if (w && w.name) texts.push({ x: X, y: headAt(f.y) - 24, age, text: String(w.name).toUpperCase().slice(0, 16), color: '#dfe6f2', size: 8, dur: 1.0 });
          break;
        }
        case 'turret': { // v4: turret placed
          if (age > 0.4) break;
          const k = age / 0.4;
          this.ellipseLine(this.X(e.x), this.Y(e.y) + 1, 4 + k * 10, 2 + k * 4, rgba(col, 1 - k));
          break;
        }
        case 'say':
          if (age < 2.5) this.bubble(fs[e.a], e.text, age);
          break;
        default: break;
      }
    });
    // lay the floating texts out so they never pile on top of each other (newest lowest)
    const placed = [];
    texts.sort((p, q) => p.age - q.age);
    if (texts.length > 12) texts.length = 12; // newest first: drop the oldest instead of stacking a tower
    for (const t of texts) {
      const k = t.age / t.dur;
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const rise = t.side ? Math.round(easeOut(Math.min(1, t.age / 0.5)) * 5) : Math.round(easeOut(Math.min(1, t.age / 0.5)) * 10 + t.age * 3);
      const pop = t.pop && t.age < 0.1 ? 1 : 0;
      // big callouts shrink when zoomed in (8 px text is already large on screen at 3×+)
      const size = this.mini ? 8 : t.size > 8 && (this.zoom || 2) >= 2 * this.dpr ? 8 : t.size;
      const w = String(t.text).length * size * 0.5 + 4, h = size + 2;
      let y = t.y - rise - pop;
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find(p => Math.abs(p.x - t.x) < (p.w + w) / 2 && Math.abs(p.y - y) < (p.h + h) / 2);
        if (!hit) break;
        y = hit.y - (hit.h + h) / 2 - 1;
      }
      placed.push({ x: t.x, y, w, h });
      this.text(t.text, t.x, y, { color: t.color, size, alpha });
    }
  }

  bubble(f, text, age) {
    const b = this.b;
    const alpha = age < 0.12 ? 0.5 : age > 2.1 ? Math.max(0, 1 - (age - 2.1) / 0.4) : 1;
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = '';
    const max = this.mini ? 12 : 16;
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
      if (lines.length >= 3) break;
    }
    if (cur && lines.length < 3) lines.push(cur.slice(0, max + 4));
    const lh = 9;
    b.font = `8px ${PIXEL_FONT}`;
    const w = Math.round(Math.max(...lines.map(l => b.measureText(l).width)) + 8);
    const h = lines.length * lh + 5;
    const X = this.X(f.x);
    const top = this.Y(f.y) + Math.round(this.R * 0.55 * K) - SIZE - h - 12 - (this.statusIcons(f.flags).length ? 8 : 0);
    const bx = Math.round(X - w / 2);
    b.globalAlpha = alpha;
    this.rect(bx - 1, top, w + 2, h, '#111520');
    this.rect(bx, top - 1, w, h + 2, '#111520');
    this.rect(bx, top, w, h, '#f7f8fb');
    this.rect(bx, top, w, 1, f.def.ai);
    this.rect(X - 2, top + h, 5, 1, '#111520');
    this.rect(X - 1, top + h, 3, 1, '#f7f8fb');
    this.rect(X - 1, top + h + 1, 3, 1, '#111520');
    this.rect(X, top + h + 1, 1, 1, '#f7f8fb');
    this.rect(X, top + h + 2, 1, 1, '#111520');
    b.globalAlpha = 1;
    lines.forEach((l, k) => this.text(l, X, top + 4 + lh * (k + 0.5), { color: '#111520', outline: null, alpha }));
  }

  // ── debug overlay: brains' `draw` shapes ────────────────────────────────────
  drawDebug(fr) {
    const maxAge = 0.5 * this.tickRate;
    for (const s of [0, 1]) {
      const d = lastOf(this.drawIdx[s], fr);
      if (!d || fr - d.t > maxAge) continue;
      const e = this.events[d.idx];
      const shapes = Array.isArray(e.shapes) ? e.shapes.slice(0, 300) : [];
      const sideCol = this.fighters[s] ? this.fighters[s].ai : '#ffffff';
      for (const sh of shapes) {
        if (!sh || typeof sh !== 'object') continue;
        const c = validHex(sh.c) ? sh.c : sideCol;
        const num = (v) => (Number.isFinite(v) ? v : null);
        switch (sh.t) {
          case 'circle': {
            const x = num(sh.x), y = num(sh.y), r = num(sh.r);
            if (x === null || y === null || r === null) break;
            this.circleLine(this.X(x), this.Y(y), Math.max(1, Math.min(600, Math.abs(r)) * K), c);
            break;
          }
          case 'line': {
            const x1 = num(sh.x1), y1 = num(sh.y1), x2 = num(sh.x2), y2 = num(sh.y2);
            if (x1 === null || y1 === null || x2 === null || y2 === null) break;
            this.line(this.X(clamp(x1, -2000, 2000)), this.Y(clamp(y1, -2000, 2000)), this.X(clamp(x2, -2000, 2000)), this.Y(clamp(y2, -2000, 2000)), c);
            break;
          }
          case 'text': {
            const x = num(sh.x), y = num(sh.y);
            if (x === null || y === null) break;
            this.text(String(sh.s === undefined ? '' : sh.s).slice(0, 32), this.X(x), this.Y(y), { color: c, size: 8 });
            break;
          }
          case 'point': {
            const x = num(sh.x), y = num(sh.y);
            if (x === null || y === null) break;
            this.rect(this.X(x) - 1, this.Y(y) - 1, 3, 3, '#000000');
            this.rect(this.X(x), this.Y(y), 1, 1, c);
            break;
          }
          default: break;
        }
      }
    }
    this.text('DEBUG', 3, 6, { color: '#ffd166', size: 8, align: 'left' });
  }

  // Weather / atmosphere in screen space: embers, snow, fireflies, dust…
  // The world outside the stands (drawn right after the void fill): sea, clouds, city lights, eyes…
  drawVoidFx(anim) {
    const th = this.theme;
    if (this.mini || !th.voidFx) return;
    const b = this.b, W = this.bw, H = this.bh;
    const put = (x, y, w, h, col, a) => { if (a <= 0.02) return; b.globalAlpha = Math.min(1, a); b.fillStyle = col; b.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
    const puff = (cx, cy, w, col, a) => { // flat-bottomed pixel cloud
      put(cx - w / 2, cy - 3, w, 5, col, a);
      put(cx - w * 0.36, cy - 7, w * 0.5, 5, col, a);
      put(cx - w * 0.02, cy - 9, w * 0.34, 6, col, a);
    };
    switch (th.voidFx) {
      case 'sea': case 'sunsea': {
        const sun = th.voidFx === 'sunsea';
        const cols = sun ? ['#6a5a9a', '#e89a8a', '#ffd0a0'] : ['#1f5a80', '#3f86b0', '#bfe4f8'];
        for (let k = 0; k < 90; k++) {
          const r1 = prand(k * 5 + 1), r2 = prand(k * 5 + 2), r3 = prand(k * 5 + 3);
          const x = ((r1 * (W + 40) + anim * (5 + r3 * 7)) % (W + 40)) - 20;
          const y = r2 * H + Math.sin(anim * 1.3 + k) * 1.5;
          put(x, y, 4 + r3 * 12, 1, cols[k % 3], k % 3 === 2 ? 0.55 : 0.5);
        }
        if (sun) for (let k = 0; k < 40; k++) { // glittering sun path on the water
          const y = prand(k * 7 + 5) * H, x = W * 0.78 + (prand(k * 7 + 6) - 0.5) * 50 + Math.sin(anim * 2 + k) * 3;
          put(x, y, 2 + prand(k) * 5, 1, '#ffe0a0', 0.35 + 0.35 * Math.abs(Math.sin(anim * 2.4 + k)));
        }
        break;
      }
      case 'clouds': case 'goldclouds': {
        const gold = th.voidFx === 'goldclouds';
        for (let k = 0; k < 16; k++) {
          const r1 = prand(k * 5 + 21), r2 = prand(k * 5 + 22), r3 = prand(k * 5 + 23);
          const w = 40 + r3 * 70;
          const x = ((r1 * (W + 160) + anim * (3 + r3 * 4)) % (W + 160)) - 80;
          puff(x, r2 * (H + 20), w, gold ? (k % 2 ? '#fff0c8' : '#f0c878') : (k % 2 ? '#ffffff' : '#dce8fa'), 0.55);
        }
        break;
      }
      case 'moon': {
        for (let k = 0; k < 50; k++) put(prand(k * 3 + 41) * W, prand(k * 3 + 42) * H, 1, 1, '#c8d4ff', 0.25 + 0.5 * Math.max(0, Math.sin(anim * 0.9 + k * 2.1)));
        const mx = Math.round(W * 0.1), my = Math.round(H * 0.14);
        for (let dy = -9; dy <= 9; dy++) {
          const w = Math.floor(Math.sqrt(81 - dy * dy));
          put(mx - w, my + dy, w * 2 + 1, 1, '#e8eef8', 0.9);
        }
        put(mx - 3, my - 3, 3, 2, '#c0cadc', 0.9); put(mx + 2, my + 2, 2, 2, '#c0cadc', 0.9); put(mx - 4, my + 4, 2, 1, '#c0cadc', 0.9);
        break;
      }
      case 'city': {
        const cols = ['#ffd27a', '#6ae0ff', '#ff5ad8', '#fff0c0'];
        for (let k = 0; k < 140; k++) {
          const r1 = prand(k * 3 + 61), r2 = prand(k * 3 + 62), r3 = prand(k * 3 + 63);
          const on = Math.sin(anim * (0.2 + r3 * 0.6) + k * 1.7) > -0.6;
          put(r1 * W, r2 * H, r3 > 0.85 ? 2 : 1, r3 > 0.6 ? 2 : 1, cols[k % 4], on ? 0.55 : 0.12);
        }
        break;
      }
      case 'glints': {
        for (let k = 0; k < 60; k++) put(prand(k * 3 + 81) * W, prand(k * 3 + 82) * H, 1, 1, th.ambientCol[k % 3], 0.6 * Math.max(0, Math.sin(anim * (0.8 + prand(k) * 1.4) + k * 1.9)));
        break;
      }
      case 'eyes': {
        for (let k = 0; k < 40; k++) put(prand(k * 3 + 91) * W, prand(k * 3 + 92) * H, 1, 1, '#8a5aff', 0.2 + 0.3 * Math.max(0, Math.sin(anim * 0.5 + k)));
        for (let k = 0; k < 10; k++) {
          const x = Math.round(prand(k * 3 + 101) * W), y = Math.round(prand(k * 3 + 102) * H);
          const blink = Math.sin(anim * 0.7 + k * 2.3) > 0.93;
          if (blink) { put(x - 3, y, 7, 1, '#a060e0', 0.6); continue; }
          put(x - 2, y - 1, 5, 3, '#e8c8ff', 0.75); put(x - 3, y, 7, 1, '#e8c8ff', 0.75);
          const look = Math.round(Math.sin(anim * 0.4 + k) * 1.5);
          put(x + look, y - 1, 1, 3, '#ff3a8a', 0.95);
        }
        break;
      }
      default: break;
    }
    b.globalAlpha = 1;
  }

  // Drifting fog puffs (swamp, graveyard): very faint so fighters stay readable.
  drawMist(col, anim) {
    const b = this.b, W = this.bw, H = this.bh;
    b.fillStyle = col;
    for (let k = 0; k < 9; k++) {
      const r1 = prand(k * 7 + 201), r2 = prand(k * 7 + 202), r3 = prand(k * 7 + 203);
      const w = 60 + r3 * 90;
      const x = ((r1 * (W + 240) + anim * (2.5 + r3 * 3)) % (W + 240)) - 120;
      const y = Math.round(r2 * H + Math.sin(anim * 0.2 + k) * 4);
      for (const [sw, sh, al] of [[1, 1, 0.035], [0.6, 0.55, 0.035]]) { // soft pixel ellipses, two layers
        const hw = (w / 2) * sw, hh = Math.max(3, Math.round(w * 0.11 * sh));
        b.globalAlpha = al;
        for (let dy = -hh; dy <= hh; dy += 2) {
          const q = hw * Math.sqrt(Math.max(0, 1 - (dy / (hh + 1)) ** 2));
          b.fillRect(Math.round(x - q), y + dy, Math.round(q * 2), 2);
        }
      }
    }
    b.globalAlpha = 1;
  }

  // Ambient styles of the newer arenas (screen space, over everything; deterministic).
  drawAmbientMore(th, anim) {
    const b = this.b, W = this.bw, H = this.bh, cols = th.ambientCol;
    const put = (x, y, w, h, col, a) => { if (a <= 0.02) return; b.globalAlpha = Math.min(1, a); b.fillStyle = col; b.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
    const N = Math.min(90, Math.round((W * H) / 2600));
    const wrap = (v, m) => ((v % m) + m) % m;
    for (let k = 0; k < N; k++) {
      const r1 = prand(k * 3 + 11), r2 = prand(k * 3 + 12), r3 = prand(k * 3 + 13), col = cols[k % cols.length];
      switch (th.ambient) {
        case 'wisps': { // will-o'-wisps: slow, glowing, bobbing
          if (k % 3) break;
          const x = r1 * W + Math.sin(anim * (0.2 + r3 * 0.3) + k) * 30, y = r2 * H + Math.cos(anim * (0.18 + r3 * 0.25) + k * 1.3) * 20;
          const a = Math.max(0, Math.sin(anim * 1.1 + k * 1.7));
          put(x - 1, y - 1, 3, 3, col, a * 0.22); put(x, y, 1, 1, col, a * 0.95);
          break;
        }
        case 'ghosts': { // pale wisps rising from the graves
          if (k % 3) break;
          const y = H - wrap(r2 * (H + 20) + anim * (5 + r3 * 5), H + 20), x = r1 * W + Math.sin(anim * 0.8 + k) * 5;
          const a = 0.35 * Math.max(0, Math.sin(anim * 0.6 + k * 2.2));
          put(x, y, 2, 2, col, a); put(x + Math.round(Math.sin(anim * 2 + k)), y + 2, 1, 2, col, a * 0.6);
          break;
        }
        case 'petals': case 'leaves': { // falling cherry petals / jungle leaves, fluttering
          const leaf = th.ambient === 'leaves';
          if (leaf && k % 2) break;
          const sp = leaf ? 8 + r3 * 7 : 11 + r3 * 10;
          const y = wrap(r2 * (H + 10) + anim * sp, H + 10) - 5;
          const x = wrap(r1 * (W + 20) + anim * sp * 0.6 + Math.sin(anim * 1.5 + k) * 6, W + 20) - 10;
          const flip = Math.floor(anim * 4 + k) % 2;
          put(x, y, flip ? 2 : 1, flip ? 1 : 2, col, 0.85);
          break;
        }
        case 'spray': { // sea spray blowing over the deck
          if (k % 2) break;
          const x = wrap(r1 * (W + 10) + anim * (30 + r3 * 30), W + 10) - 5, y = r2 * H + Math.sin(anim * 2 + k) * 2;
          put(x, y, 1, 1, col, 0.45);
          break;
        }
        case 'sparkle': { // crystal glints: twinkle into little stars
          const tw = Math.sin(anim * (1.2 + r3 * 2) + k * 2.1);
          const x = r1 * W, y = r2 * H;
          if (tw > 0.75) { const a = (tw - 0.75) * 4; put(x, y, 1, 1, '#ffffff', a); put(x - 1, y, 1, 1, col, a * 0.6); put(x + 1, y, 1, 1, col, a * 0.6); put(x, y - 1, 1, 1, col, a * 0.6); put(x, y + 1, 1, 1, col, a * 0.6); }
          else put(x, y, 1, 1, col, 0.18);
          break;
        }
        case 'rain': { // slanted rain streaks + little splashes
          for (let q = 0; q < 2; q++) {
            const s = prand(k * 7 + q * 3 + 300), sp = 150 + s * 70;
            const y = wrap(prand(k * 7 + q * 3 + 301) * (H + 20) + anim * sp, H + 20) - 10;
            const x = wrap(prand(k * 7 + q * 3 + 302) * (W + 20) - anim * sp * 0.22, W + 20) - 10;
            put(x, y, 1, 2, col, 0.32); put(x - 1, y + 2, 1, 2, col, 0.32);
          }
          const ph = (anim * 1.7 + r3) % 1;
          if (ph < 0.12) put(r1 * W - 1, r2 * H, 3, 1, cols[1], 0.35 * (1 - ph / 0.12));
          break;
        }
        case 'clouds': { // sky temple: a few faint cloud wisps drifting over the platform + bright motes
          if (k % 9 === 0) {
            const w = 30 + r3 * 40, x = wrap(r1 * (W + 120) + anim * (6 + r3 * 5), W + 120) - 60, y = r2 * H;
            put(x - w / 2, y - 2, w, 4, col, 0.07); put(x - w * 0.3, y - 5, w * 0.55, 3, col, 0.07);
          } else if (k % 3 === 0) put(r1 * W + Math.sin(anim * 0.3 + k) * 8, r2 * H + Math.cos(anim * 0.25 + k) * 6, 1, 1, col, 0.35);
          break;
        }
        case 'glow': { // warm sunset motes drifting up
          const y = H - wrap(r2 * (H + 10) + anim * (4 + r3 * 5), H + 10), x = r1 * W + Math.sin(anim * 0.7 + k) * 8;
          put(x, y, 1, 1, col, 0.25 + 0.35 * Math.abs(Math.sin(anim * 1.3 + k)));
          break;
        }
        case 'steam': { // steam puffs rising and spreading + a few falling sparks
          if (k % 5 === 0) {
            const y = wrap(r2 * (H + 10) + anim * (40 + r3 * 30), H + 10) - 5;
            put(r1 * W + Math.sin(anim * 3 + k) * 2, y, 1, 1, cols[2], 0.8);
            break;
          }
          if (k % 3) break;
          const ph = (anim * 0.22 + r1) % 1, s = Math.round(2 + ph * 6);
          const x = r2 * W + Math.sin(anim * 0.8 + k) * 4, y = r3 * H * 1.1 - ph * 36;
          put(x - s / 2, y - s / 2 + 1, s, Math.max(1, s - 2), col, (1 - ph) * 0.16);
          put(x - s / 2 + 1, y - s / 2, Math.max(1, s - 2), s, col, (1 - ph) * 0.16);
          break;
        }
        case 'sprinkles': { // candy sprinkles tumbling down
          if (k % 3 === 2) break;
          const y = wrap(r2 * (H + 10) + anim * (12 + r3 * 12), H + 10) - 5, x = r1 * W + Math.sin(anim * 1.3 + k) * 3;
          const flip = Math.floor(anim * 3 + k) % 2;
          put(x, y, flip ? 2 : 1, flip ? 1 : 2, col, 0.85);
          break;
        }
        case 'sunbeams': { // golden motes (the beams are drawn once below)
          if (k % 2) break;
          const x = r1 * W + Math.sin(anim * 0.25 + k) * 10, y = r2 * H + Math.cos(anim * 0.2 + k) * 8;
          put(x, y, 1, 1, col, 0.3 + 0.4 * Math.max(0, Math.sin(anim * 1.4 + k * 1.3)));
          break;
        }
        case 'runes': { // eldritch glyphs drifting up and fading in and out
          if (k % 3) break;
          const bits = Math.floor(prand(k * 13 + 7) * 512) | 0x10;
          const x = Math.round(r1 * W + Math.sin(anim * 0.3 + k) * 6), y = Math.round(H - wrap(r2 * (H + 10) + anim * (3 + r3 * 4), H + 10));
          const a = 0.55 * Math.max(0, Math.sin(anim * 0.9 + k * 1.9));
          for (let q = 0; q < 9; q++) if ((bits >> q) & 1) put(x + (q % 3), y + Math.floor(q / 3), 1, 1, col, a);
          break;
        }
        default: break;
      }
    }
    if (th.ambient === 'sunbeams') { // a few broad, faint light shafts from the top-left
      b.fillStyle = cols[0];
      for (let k = 0; k < 4; k++) {
        const x0 = W * (0.05 + k * 0.27) + Math.sin(anim * 0.15 + k) * 10, w = 14 + prand(k + 900) * 22;
        b.globalAlpha = 0.05 + 0.03 * Math.sin(anim * 0.5 + k * 1.7);
        b.beginPath(); b.moveTo(x0, 0); b.lineTo(x0 + w, 0); b.lineTo(x0 + w + H * 0.55, H); b.lineTo(x0 + H * 0.55, H); b.closePath(); b.fill();
      }
    }
    b.globalAlpha = 1;
  }

  drawAmbient(anim) {
    const th = this.theme;
    if (this.mini || !th.ambient) return;
    if (th.mist) this.drawMist(th.mist, anim);
    if (AMBIENT_MORE.has(th.ambient)) { this.drawAmbientMore(th, anim); return; }
    const b = this.b;
    const W = this.bw, H = this.bh;
    const n = Math.min(90, Math.round((W * H) / 2600));
    for (let k = 0; k < n; k++) {
      const r1 = prand(k * 3 + 11), r2 = prand(k * 3 + 12), r3 = prand(k * 3 + 13);
      let x, y, a = 1, size = 1;
      switch (th.ambient) {
        case 'snow':
          y = ((r2 * (H + 10) + anim * (9 + r3 * 14)) % (H + 10)) - 5;
          x = (((r1 * W + Math.sin(anim * 0.8 + k) * 6 + anim * 4) % W) + W) % W;
          size = r3 > 0.8 ? 2 : 1;
          a = 0.75;
          break;
        case 'embers':
          y = H - ((r2 * (H + 10) + anim * (10 + r3 * 18)) % (H + 10));
          x = r1 * W + Math.sin(anim * 1.4 + k * 2) * 4;
          a = 0.35 + 0.65 * Math.abs(Math.sin(anim * 3 + k));
          break;
        case 'sparks':
          y = H - ((r2 * (H + 10) + anim * (16 + r3 * 22)) % (H + 10));
          x = r1 * W;
          a = 0.6;
          break;
        case 'fireflies':
          x = r1 * W + Math.sin(anim * (0.3 + r3 * 0.4) + k) * 22;
          y = r2 * H + Math.cos(anim * (0.25 + r3 * 0.3) + k * 1.7) * 16;
          a = Math.max(0, Math.sin(anim * 1.8 + k * 1.3));
          break;
        case 'dust':
          x = ((r1 * (W + 10) + anim * (14 + r3 * 20)) % (W + 10)) - 5;
          y = r2 * H + Math.sin(anim * 1.1 + k) * 3;
          a = 0.45;
          break;
        case 'stars': // celestial: slow twinkling stars
          x = r1 * W + Math.sin(anim * 0.05 + k) * 3;
          y = r2 * H + Math.cos(anim * 0.04 + k) * 2;
          a = 0.2 + 0.6 * Math.max(0, Math.sin(anim * (0.8 + r3) + k * 2.3));
          size = r3 > 0.9 ? 2 : 1;
          break;
        default: // motes
          x = r1 * W + Math.sin(anim * 0.2 + k) * 10;
          y = r2 * H + Math.cos(anim * 0.17 + k) * 8;
          a = 0.22;
      }
      if (a <= 0.02) continue;
      b.globalAlpha = a;
      b.fillStyle = th.ambientCol[k % th.ambientCol.length];
      b.fillRect(Math.round(x), Math.round(y), size, size);
    }
    b.globalAlpha = 1;
  }

  drawOffscreen(fs) {
    for (const f of fs) {
      const X = this.X(f.x), Y = this.Y(f.y) - 12;
      const m = 6;
      if (X >= m && X <= this.bw - m && Y >= m && Y <= this.bh - m) continue;
      const cx = clamp(X, m + 2, this.bw - m - 2), cy = clamp(Y, m + 2, this.bh - m - 2);
      const an = Math.atan2(Y - cy, X - cx);
      this.circleFill(cx, cy, 5, '#000000');
      this.circleFill(cx, cy, 4, f.def.ai);
      this.line(cx + Math.cos(an) * 5, cy + Math.sin(an) * 5, cx + Math.cos(an) * 9, cy + Math.sin(an) * 9, '#ffffff', 2);
    }
  }

  drawMiniHud(fs, t) {
    const bw = Math.min(56, Math.floor(this.bw * 0.34)), y = this.bh - 6;
    fs.forEach((f, s) => {
      const x = s === 0 ? 4 : this.bw - 4 - bw;
      const frac = clamp(f.hp / (f.def.maxHp || 1), 0, 1);
      this.rect(x - 1, y - 1, bw + 2, 4, '#000000');
      this.rect(x, y, bw, 2, '#3a1418');
      const w = Math.round(bw * frac);
      this.rect(s === 0 ? x : x + bw - w, y, w, 2, f.def.ai);
    });
    this.text(`${Math.floor(t)}`, this.bw / 2, this.bh - 6, { size: 8, color: '#e9edf5' });
  }

  drawScreenFx(fr) {
    const c = this.ctx;
    this.eventsIn(fr - 15, fr, (e) => {
      if (e.k !== 'ko') return;
      const age = (fr - e.t) / this.tickRate;
      if (age < 0 || age > 0.5) return;
      c.fillStyle = `rgba(255,255,255,${(Math.floor(age * 16) % 2 ? 0.25 : 0.55) * (1 - age / 0.5)})`;
      c.fillRect(0, 0, this.cw, this.ch);
    });
  }
}
