// ─────────────────────────────────────────────────────────────────────────────
//  Pixel sprites: {palette, frames: {idle, walk (alias move), attack, cast, dash,
//  hurt, ko, victory, block}} → canvases. Every frame is 32×32 and faces right.
//  Portraits are PNG data-URLs shown with pixelated scaling.
//  Old sprites (idle/move/attack/hurt/ko only) keep working: missing animations
//  fall back to the closest one that exists (see animFrames).
// ─────────────────────────────────────────────────────────────────────────────

export const SIZE = 32;

/** Every animation the arena understands, in display order, with its playback speed. */
export const ANIMS = ['idle', 'walk', 'attack', 'cast', 'dash', 'hurt', 'ko', 'victory', 'block'];
export const ANIM_FPS = { idle: 5, walk: 10, attack: 9, cast: 7, dash: 12, hurt: 7, ko: 6, victory: 7, block: 5 };
// Where to look when a sprite does not have an animation.
const FALLBACK = {
  walk: ['move', 'idle'],
  move: ['walk', 'idle'],
  attack: ['idle'],
  cast: ['attack', 'idle'],
  dash: ['walk', 'move', 'attack', 'idle'],
  hurt: ['idle'],
  ko: [],
  victory: ['idle'],
  block: ['idle'],
  idle: [],
};

const cache = new Map();
const byObject = new WeakMap();

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shadeHex(hex, amount) {
  // quick lightness shift in sRGB (only used for the fallback sprite)
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)));
  return '#' + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function buildFrame(rows, palette) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  const img = g.createImageData(SIZE, SIZE);
  const rgb = {};
  for (const [k, v] of Object.entries(palette)) rgb[k] = hexToRgb(v);
  for (let y = 0; y < SIZE; y++) {
    const row = rows[y] || '';
    for (let x = 0; x < SIZE; x++) {
      const ch = row[x];
      if (!ch || ch === '.' || !rgb[ch]) continue;
      const o = (y * SIZE + x) * 4;
      const [r, gg, b] = rgb[ch];
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function rotated(canvas, dir) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.translate(SIZE / 2, SIZE / 2);
  g.rotate(dir * Math.PI / 2);
  g.drawImage(canvas, -SIZE / 2, -SIZE / 2);
  return c;
}

// A plain creature used when a fighter has no (valid) sprite.json.
const TEMPLATE = [
  '................................',
  '................................',
  '................................',
  '................................',
  '................................',
  '................................',
  '..............oooo..............',
  '...........ooopppphoo...........',
  '.........oopppppppphhoo.........',
  '........oppppppppppphhpo........',
  '.......opppppwwopppwwopho.......',
  '.......oppppwwkwopwwkwpho.......',
  '......oppppppwwoppwwopppho......',
  '......opppppppppppppppppho......',
  '......oppppppppopppopppppo......',
  '......opppppppppooopppppdo......',
  '......oppppppsssssssspppdo......',
  '.....oopppppssssssssssppdoo.....',
  '....odoopppsssssssssssppdood....',
  '...oddoppppssssssssssspppodo....',
  '...odoopppppsssssssssppppdoo....',
  '....o.oppppppppppppppppppdo.....',
  '......opppppppppppppppppddo.....',
  '......odppppppppppppppppddo.....',
  '.......oddpppppppppppppddo......',
  '........ooddddddddddddddo.......',
  '.........oooooooooooooo.........',
  '..........odddo..odddo..........',
  '..........odddo..odddo..........',
  '.........oddddo..oddddo.........',
  '.........oooooo..oooooo.........',
  '................................',
];

export function defaultSprite(colors = {}) {
  const p = /^#[0-9a-f]{3,6}$/i.test(colors.primary || '') ? colors.primary : '#8ab4ff';
  const s = /^#[0-9a-f]{3,6}$/i.test(colors.secondary || '') ? colors.secondary : '#ffe08a';
  return {
    palette: { o: shadeHex(p, -0.6), p, h: shadeHex(p, 0.18), d: shadeHex(p, -0.25), s, w: '#ffffff', k: '#15161c' },
    frames: { idle: [TEMPLATE, [TEMPLATE[31], ...TEMPLATE.slice(0, 31)]] },
  };
}

function keyOf(sprite, colors) {
  if (!sprite) return `default:${(colors && colors.primary) || ''}:${(colors && colors.secondary) || ''}`;
  const text = JSON.stringify(sprite);
  return `s:${hashStr(text)}:${text.length}`;
}

/**
 * Cached entry: { key, frames: {name: [canvas]}, koFrame, url, fallback, anims }
 *  - frames holds exactly what the sprite provides (walk and move are kept as given)
 *  - animFrames(entry, name) resolves aliases / fallbacks
 */
export function pixelSprite(sprite, colors) {
  if (sprite && typeof sprite === 'object' && byObject.has(sprite)) return byObject.get(sprite);
  const key = keyOf(sprite, colors);
  let e = cache.get(key);
  if (!e) {
    let src = sprite;
    let fallback = false;
    try {
      if (!src || !src.palette || !src.frames || !src.frames.idle || !src.frames.idle.length) { src = defaultSprite(colors); fallback = !!sprite; }
      e = { key, frames: {}, white: new WeakMap(), tint: new Map(), fallback };
      for (const [name, list] of Object.entries(src.frames)) {
        if (!Array.isArray(list) || !list.length) continue;
        // a single frame given directly (array of strings) is accepted too
        const frames = typeof list[0] === 'string' ? [list] : list;
        e.frames[name] = frames.map(rows => buildFrame(rows, src.palette));
      }
    } catch {
      src = defaultSprite(colors);
      e = { key, frames: { idle: src.frames.idle.map(r => buildFrame(r, src.palette)) }, white: new WeakMap(), tint: new Map(), fallback: true };
    }
    const ko = e.frames.ko;
    e.koFrame = ko ? ko[ko.length - 1] : rotated(e.frames.idle[0], 1);
    e.rich = !!(e.frames.walk || e.frames.cast || e.frames.victory || e.frames.block || e.frames.dash);
    e.url = e.frames.idle[0].toDataURL('image/png');
    e.anims = ANIMS.filter(a => e.frames[a] || (a === 'walk' && e.frames.move));
    cache.set(key, e);
    if (cache.size > 80) cache.delete(cache.keys().next().value);
  }
  if (sprite && typeof sprite === 'object') byObject.set(sprite, e);
  return e;
}

/** Frames for an animation, following aliases (walk ⇄ move) and fallbacks. Never empty. */
export function animFrames(entry, name) {
  if (entry.frames[name]) return entry.frames[name];
  for (const alt of FALLBACK[name] || []) if (entry.frames[alt]) return entry.frames[alt];
  if (name === 'ko') return [entry.koFrame];
  return entry.frames.idle;
}

/** Does the sprite really have this animation (aliases count, fallbacks do not)? */
export function hasAnim(entry, name) {
  return !!(entry.frames[name] || (name === 'walk' && entry.frames.move) || (name === 'move' && entry.frames.walk));
}

/** White silhouette of a frame canvas (hit flash). */
export function whiteOf(entry, frame) {
  let w = entry.white.get(frame);
  if (w) return w;
  w = tintCanvas(frame, '#ffffff');
  entry.white.set(frame, w);
  return w;
}

/** Solid-colour silhouette of a frame (afterimages, x-ray outlines, glows). */
export function tintOf(entry, frame, color) {
  let m = entry.tint.get(color);
  if (!m) { m = new WeakMap(); entry.tint.set(color, m); }
  let c = m.get(frame);
  if (c) return c;
  c = tintCanvas(frame, color);
  m.set(frame, c);
  return c;
}

function tintCanvas(frame, color) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.drawImage(frame, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, SIZE, SIZE);
  return c;
}

/** A static <img> of the first idle frame, scaled up with crisp pixels. */
export function spriteImg(sprite, colors, attrs = {}) {
  const e = pixelSprite(sprite, colors);
  const img = document.createElement('img');
  img.alt = attrs.alt || '';
  img.draggable = false;
  img.src = e.url;
  img.className = `px-img${attrs.class ? ` ${attrs.class}` : ''}`;
  return img;
}

/**
 * An animated <canvas>.
 *  - default: loops through every animation the sprite has (idle → walk → attack → …)
 *    so spectators see every frame the AI drew;
 *  - { anim: 'attack' } plays just that animation on a loop (fallbacks apply);
 *  - { sequence: false } only plays idle.
 * `a.label` (optional element) shows the current animation name.
 * `a.setAnim(name|null)` switches what it plays.
 */
const animators = new Set();
export function spriteAnimator(sprite, colors, { scale = 4, sequence = true, anim = null } = {}) {
  const e = pixelSprite(sprite, colors);
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  c.className = 'px-img';
  c.style.width = c.style.height = `${SIZE * scale}px`;
  const g = c.getContext('2d');
  let plan = [];
  let total = 1;
  const makePlan = (only) => {
    plan = [];
    const push = (name, loops = 1, secs = null) => {
      const frames = animFrames(e, name);
      const fps = ANIM_FPS[name] || 6;
      const len = secs !== null ? secs : Math.max(0.5, (frames.length / fps) * loops);
      plan.push({ name, secs: len, fps, hold: name === 'ko' });
    };
    if (only) {
      push(only, only === 'ko' ? 1 : 3, only === 'ko' ? Math.max(1.6, animFrames(e, 'ko').length / ANIM_FPS.ko + 1) : null);
    } else if (!sequence) {
      push('idle', 2, 2.4);
    } else {
      push('idle', 2, 2.4);
      for (const name of ANIMS) {
        if (name === 'idle' || !hasAnim(e, name)) continue;
        if (name === 'ko') { push('ko', 1, animFrames(e, 'ko').length / ANIM_FPS.ko + 0.8); continue; }
        push(name, name === 'walk' ? 2 : name === 'victory' ? 2 : 1);
        if (name === 'attack' || name === 'cast') push('idle', 1, 0.5);
      }
    }
    total = plan.reduce((a, p) => a + p.secs, 0) || 1;
  };
  makePlan(anim);
  const a = {
    el: c, entry: e, label: null, last: null, anim: anim || null, start: null,
    setAnim(name) { a.anim = name || null; a.start = null; makePlan(a.anim); a.last = null; },
    draw(now) {
      if (a.start === null || now < a.start) a.start = now;
      let t = (Math.max(0, now - a.start) / 1000) % total;
      let step = plan[0];
      for (const p of plan) { if (t < p.secs) { step = p; break; } t -= p.secs; }
      const frames = animFrames(e, step.name);
      let k = Math.floor(t * step.fps);
      k = step.hold ? Math.min(frames.length - 1, k) : k % frames.length;
      const fr = frames[Math.max(0, k) % Math.max(1, frames.length)];
      if (!fr || fr === a.last) return;
      a.last = fr;
      g.clearRect(0, 0, SIZE, SIZE);
      g.drawImage(fr, 0, 0);
      if (a.label) a.label.textContent = step.name.toUpperCase();
    },
  };
  animators.add(a);
  a.draw(performance.now());
  return a;
}

export function tickAnimators(now) {
  for (const a of animators) {
    if (!a.el.isConnected) { animators.delete(a); continue; }
    a.draw(now);
  }
}
