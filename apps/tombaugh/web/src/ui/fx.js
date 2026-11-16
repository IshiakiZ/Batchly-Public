// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// fx.js: motion and procedural-art primitives shared by the landing, hero, previews and explainers.
// Pure ES module. Nothing here touches the DOM at import time, so it loads in Node for tests.
//
// Contract surface: easing helpers, a requestAnimationFrame scheduler that pauses when the tab is
// hidden, and prefersReducedMotion().
//
// Optional extras (not in the contract, safe to ignore):
//   clamp, lerp, invLerp, remap, smoothstep
//   easing                      table of easing functions, all map 0..1 -> 0..1
//   mulberry32(seed), hashSeed(text), gaussian(rand)   deterministic randomness
//   createScheduler(env)        a private scheduler with injectable clock, for tests
//   scheduler                   the shared page-wide scheduler (one rAF loop for everything)
//   tween(opts), createSpring(opts)
//   onReducedMotionChange(fn)   subscribe to the OS setting changing
//   onEscape(fn)                LIFO Escape-key stack so the top-most card closes first
//   BRAND, hexToRgb, makeLut, stampPsf, gaussianField   helpers for pixel-sky art
//   SKY_LUT, skyStretch(v), RESIDUAL_LUT, RESIDUAL_RANGE, residualIndex(r), rgbCss(lut, index)
//                               the one palette shared by the hero, the previews and the diagrams

// ---------------------------------------------------------------------------------------------
// Numbers

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp(invLerp(a, b, v)));
export const smoothstep = (a, b, v) => {
  const t = clamp(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// Easing. Every function maps 0 -> 0 and 1 -> 1 and accepts inputs outside 0..1 by clamping.

const e = (fn) => (t) => fn(clamp(t));

export const easing = {
  linear: e((t) => t),
  inQuad: e((t) => t * t),
  outQuad: e((t) => 1 - (1 - t) * (1 - t)),
  inOutQuad: e((t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t))),
  inCubic: e((t) => t * t * t),
  outCubic: e((t) => 1 - (1 - t) ** 3),
  inOutCubic: e((t) => (t < 0.5 ? 4 * t * t * t : 1 - 4 * (1 - t) ** 3)),
  outQuart: e((t) => 1 - (1 - t) ** 4),
  inOutSine: e((t) => 0.5 - 0.5 * Math.cos(Math.PI * t)),
  outExpo: e((t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t))),
  // Slight overshoot, for things that should feel like a needle settling.
  outBack: e((t) => {
    const c = 1.70158;
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  }),
};

// ---------------------------------------------------------------------------------------------
// Deterministic randomness

/** mulberry32: a small, fast 32-bit PRNG. Returns a function giving floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, as an unsigned 32-bit seed. */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One standard-normal deviate from a uniform generator (Box-Muller). */
export function gaussian(rand) {
  let u = rand();
  if (u < 1e-12) u = 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// ---------------------------------------------------------------------------------------------
// Reduced motion

function motionQuery(win) {
  const w = win || globalThis.window;
  try {
    return w && typeof w.matchMedia === 'function' ? w.matchMedia('(prefers-reduced-motion: reduce)') : null;
  } catch {
    return null;
  }
}

/** True when the OS asks for reduced motion. False when it cannot be determined. */
export function prefersReducedMotion(win) {
  const q = motionQuery(win);
  return !!(q && q.matches);
}

/** Calls fn(boolean) whenever the reduced-motion setting changes. Returns an unsubscribe. */
export function onReducedMotionChange(fn, win) {
  const q = motionQuery(win);
  if (!q) return () => {};
  const handler = (ev) => fn(!!ev.matches);
  if (q.addEventListener) {
    q.addEventListener('change', handler);
    return () => q.removeEventListener('change', handler);
  }
  if (q.addListener) {
    q.addListener(handler);
    return () => q.removeListener(handler);
  }
  return () => {};
}

// ---------------------------------------------------------------------------------------------
// Scheduler
//
// One requestAnimationFrame loop drives every animation on the page. A task runs only while
//   (a) it has been started, (b) the tab is visible, and (c) its element, if it gave one, is on
//   screen according to IntersectionObserver.
// When no task qualifies the loop is cancelled, so an idle page costs nothing.
// Each task has its own clock that advances only while the task runs: pausing never makes an
// animation jump. Task callbacks receive (timeSeconds, deltaSeconds).

const MAX_DT_MS = 100; // after a stall, never advance an animation by more than this in one step

/**
 * @param {Object} [env] injectable environment, for tests
 * @param {() => number} [env.now] clock in milliseconds
 * @param {(cb: Function) => any} [env.raf]
 * @param {(id: any) => void} [env.caf]
 * @param {Object|null} [env.document] needs visibilityState and add/removeEventListener
 * @param {Function|null} [env.IntersectionObserver]
 */
export function createScheduler(env = {}) {
  const g = globalThis;
  const now = env.now || (() => (g.performance && g.performance.now ? g.performance.now() : Date.now()));
  const raf =
    env.raf ||
    ((cb) => (typeof g.requestAnimationFrame === 'function' ? g.requestAnimationFrame(cb) : setTimeout(cb, 16)));
  const caf =
    env.caf ||
    ((id) => (typeof g.cancelAnimationFrame === 'function' ? g.cancelAnimationFrame(id) : clearTimeout(id)));
  const getDoc = () => ('document' in env ? env.document : g.document) || null;
  const getIO = () => ('IntersectionObserver' in env ? env.IntersectionObserver : g.IntersectionObserver) || null;

  const tasks = new Set();
  const byElement = new Map(); // element -> Set<task>
  let rafId = null;
  let last = 0;
  let io = null;
  let listeningDoc = null;

  const tabHidden = () => {
    const doc = getDoc();
    return !!doc && doc.visibilityState === 'hidden';
  };
  const isActive = (task) => task.wanted && task.inView;
  const anyActive = () => {
    for (const task of tasks) if (isActive(task)) return true;
    return false;
  };

  function tick() {
    rafId = null;
    const t = now();
    let dt = t - last;
    last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_DT_MS) dt = MAX_DT_MS;
    for (const task of Array.from(tasks)) {
      if (!tasks.has(task) || !isActive(task)) continue;
      task.acc += dt;
      if (task.acc < task.minInterval - 1) continue; // fps throttle, 1 ms tolerance
      const step = task.acc;
      task.acc = 0;
      task.time += step;
      task.frames += 1;
      try {
        task.fn(task.time / 1000, step / 1000);
      } catch (err) {
        task.wanted = false; // a broken animation must not take the others down
        if (g.console) g.console.error('[tombaugh fx] animation task failed', err);
      }
    }
    if (!tabHidden() && anyActive()) rafId = raf(tick);
  }

  /** Bring the loop state in line with what the tasks need. */
  function pump() {
    const need = !tabHidden() && anyActive();
    if (need && rafId === null) {
      last = now();
      rafId = raf(tick);
    } else if (!need && rafId !== null) {
      caf(rafId);
      rafId = null;
    }
  }

  function listen() {
    const doc = getDoc();
    if (listeningDoc || !doc || !doc.addEventListener) return;
    doc.addEventListener('visibilitychange', pump);
    listeningDoc = doc;
  }
  function unlisten() {
    if (!listeningDoc) return;
    listeningDoc.removeEventListener('visibilitychange', pump);
    listeningDoc = null;
  }

  function observe(task) {
    const IO = getIO();
    if (!task.element || !IO) return;
    if (!io) {
      io = new IO(
        (entries) => {
          for (const entry of entries) {
            const set = byElement.get(entry.target);
            if (set) for (const tk of set) tk.inView = !!entry.isIntersecting;
          }
          pump();
        },
        { rootMargin: '48px' },
      );
    }
    let set = byElement.get(task.element);
    if (!set) {
      set = new Set();
      byElement.set(task.element, set);
      io.observe(task.element);
    }
    set.add(task);
  }
  function unobserve(task) {
    const set = task.element && byElement.get(task.element);
    if (!set) return;
    set.delete(task);
    if (set.size === 0) {
      byElement.delete(task.element);
      if (io) io.unobserve(task.element);
    }
  }

  /**
   * Register an animation.
   * @param {(timeSeconds: number, deltaSeconds: number) => void} fn
   * @param {Object} [opts]
   * @param {Element} [opts.element] only run while this element is on screen
   * @param {number} [opts.fps] cap the callback rate (default: every frame)
   * @param {boolean} [opts.autoStart] start immediately
   */
  function add(fn, opts = {}) {
    const task = {
      fn,
      element: opts.element || null,
      minInterval: opts.fps > 0 ? 1000 / opts.fps : 0,
      wanted: false,
      inView: true, // until IntersectionObserver says otherwise
      time: 0,
      acc: 0,
      frames: 0,
    };
    tasks.add(task);
    listen();
    observe(task);
    const handle = {
      start() {
        if (!tasks.has(task)) return handle;
        task.wanted = true;
        pump();
        return handle;
      },
      stop() {
        task.wanted = false;
        task.acc = 0;
        pump();
        return handle;
      },
      destroy() {
        task.wanted = false;
        unobserve(task);
        tasks.delete(task);
        if (tasks.size === 0) unlisten();
        pump();
      },
      /** Manual override of the on-screen state (used when no IntersectionObserver exists). */
      setInView(v) {
        task.inView = !!v;
        pump();
      },
      /** True once start() was called and until stop(). */
      get running() {
        return task.wanted;
      },
      /** True when the callback is actually being called: started, on screen, tab visible. */
      get active() {
        return isActive(task) && !tabHidden();
      },
      get inView() {
        return task.inView;
      },
      /** Seconds of animation time; settable to seek. */
      get time() {
        return task.time / 1000;
      },
      set time(seconds) {
        task.time = Math.max(0, seconds) * 1000;
      },
      get frames() {
        return task.frames;
      },
    };
    if (opts.autoStart) handle.start();
    return handle;
  }

  return {
    add,
    /** Number of registered tasks. */
    get size() {
      return tasks.size;
    },
    /** True while a frame is scheduled. */
    get running() {
      return rafId !== null;
    },
    destroy() {
      for (const task of tasks) task.wanted = false;
      tasks.clear();
      byElement.clear();
      if (io) io.disconnect();
      io = null;
      unlisten();
      pump();
    },
  };
}

/** The shared scheduler. Everything in ui/ uses this one loop unless told otherwise. */
export const scheduler = createScheduler();

// ---------------------------------------------------------------------------------------------
// Tween and spring

/**
 * Animate a number. Durations are milliseconds.
 * @returns {{ cancel(): void, finish(): void, done: boolean }}
 */
export function tween({
  from = 0,
  to = 1,
  duration = 300,
  delay = 0,
  ease = easing.outCubic,
  onUpdate,
  onDone,
  scheduler: sched = scheduler,
} = {}) {
  let done = false;
  let task = null;
  const end = (callDone) => {
    if (done) return;
    done = true;
    if (task) task.destroy();
    if (callDone && onDone) onDone();
  };
  const api = {
    cancel: () => end(false),
    finish: () => {
      if (done) return;
      if (onUpdate) onUpdate(to, 1);
      end(true);
    },
    get done() {
      return done;
    },
  };
  if (!(duration > 0) && !(delay > 0)) {
    api.finish();
    return api;
  }
  task = sched.add((t) => {
    const ms = t * 1000 - delay;
    if (ms < 0) return;
    const p = duration > 0 ? clamp(ms / duration) : 1;
    if (onUpdate) onUpdate(lerp(from, to, ease(p)), p);
    if (p >= 1) end(true);
  });
  task.start();
  return api;
}

/**
 * A damped spring on one number. Call step(dtSeconds) from an animation task.
 * @returns {{ value: number, velocity: number, target: number, step(dt: number): number, jump(v: number): void, atRest: boolean }}
 */
export function createSpring({ value = 0, target = value, stiffness = 170, damping = 26, mass = 1, precision = 0.001 } = {}) {
  const s = {
    value,
    target,
    velocity: 0,
    step(dt) {
      let remaining = clamp(dt, 0, 0.25);
      while (remaining > 1e-9) {
        const h = Math.min(remaining, 1 / 240); // small fixed sub-steps keep it stable
        const accel = (-stiffness * (s.value - s.target) - damping * s.velocity) / mass;
        s.velocity += accel * h;
        s.value += s.velocity * h;
        remaining -= h;
      }
      if (s.atRest) {
        s.value = s.target;
        s.velocity = 0;
      }
      return s.value;
    },
    jump(v) {
      s.value = v;
      s.target = v;
      s.velocity = 0;
    },
    get atRest() {
      return Math.abs(s.value - s.target) < precision && Math.abs(s.velocity) < precision;
    },
  };
  return s;
}

// ---------------------------------------------------------------------------------------------
// Escape stack: the most recently opened card gets the Escape key.

const escapeStack = [];
let escapeDoc = null;

function onEscapeKey(ev) {
  if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
  if (ev.defaultPrevented || escapeStack.length === 0) return;
  const top = escapeStack[escapeStack.length - 1];
  ev.preventDefault();
  ev.stopPropagation();
  top();
}

/** Register fn to run on Escape while it is top of the stack. Returns a release function. */
export function onEscape(fn, doc = globalThis.document) {
  if (!doc || !doc.addEventListener) return () => {};
  if (escapeStack.length === 0) {
    escapeDoc = doc;
    escapeDoc.addEventListener('keydown', onEscapeKey, true);
  }
  escapeStack.push(fn);
  return function release() {
    const i = escapeStack.lastIndexOf(fn);
    if (i >= 0) escapeStack.splice(i, 1);
    if (escapeStack.length === 0 && escapeDoc) {
      escapeDoc.removeEventListener('keydown', onEscapeKey, true);
      escapeDoc = null;
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Pixel-sky art helpers (typed arrays only)

/** Brand colours. COLD is the one off-brand colour: the negative half of a subtraction dipole. */
export const BRAND = Object.freeze({
  ink: '#171715',
  paper: '#F7F2E7',
  signal: '#E53C27',
  stone: '#77766E',
  dim: '#A8A59A',
  cold: '#4B8FDB',
});

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Build a colour lookup table from stops [[position 0..1, '#hex'], ...].
 * @returns {Uint8Array} n * 3 bytes, RGB
 */
export function makeLut(stops, n = 256) {
  const pts = stops.map(([p, c]) => [p, typeof c === 'string' ? hexToRgb(c) : c]).sort((a, b) => a[0] - b[0]);
  const lut = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    let k = 0;
    while (k < pts.length - 2 && t > pts[k + 1][0]) k++;
    const [p0, c0] = pts[k];
    const [p1, c1] = pts[Math.min(k + 1, pts.length - 1)];
    const f = clamp(invLerp(p0, p1, t));
    lut[i * 3] = Math.round(lerp(c0[0], c1[0], f));
    lut[i * 3 + 1] = Math.round(lerp(c0[1], c1[1], f));
    lut[i * 3 + 2] = Math.round(lerp(c0[2], c1[2], f));
  }
  return lut;
}

/**
 * Add a pixel-integrated Gaussian source of total `flux` to a w x h image.
 * (cx, cy) are continuous pixel coordinates; pixel i covers [i, i + 1).
 */
export function stampPsf(img, w, h, cx, cy, flux, sigma = 0.6) {
  const r = Math.max(2, Math.ceil(sigma * 4));
  const x0 = Math.max(0, Math.floor(cx) - r);
  const x1 = Math.min(w - 1, Math.floor(cx) + r);
  const y0 = Math.max(0, Math.floor(cy) - r);
  const y1 = Math.min(h - 1, Math.floor(cy) + r);
  const k = -0.5 / (sigma * sigma);
  const norm = flux / (2 * Math.PI * sigma * sigma) / 9;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let sum = 0;
      for (let sy = 0; sy < 3; sy++) {
        const dy = y + (sy + 0.5) / 3 - cy;
        for (let sx = 0; sx < 3; sx++) {
          const dx = x + (sx + 0.5) / 3 - cx;
          sum += Math.exp(k * (dx * dx + dy * dy));
        }
      }
      img[y * w + x] += norm * sum;
    }
  }
  return img;
}

/** n Gaussian deviates with the given sigma. */
export function gaussianField(rand, n, sigma = 1) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = gaussian(rand) * sigma;
  return out;
}

// One palette for every procedural sky on the page. Values are in units of the background noise.

/** 256-entry frame palette: near-black to Paper. Index with Math.round(skyStretch(v) * 255) * 3. */
export const SKY_LUT = makeLut([
  [0, '#10100E'],
  [0.55, '#8F8B80'],
  [1, BRAND.paper],
]);

const SKY_LO = -2.2;
const SKY_SOFT = 6;
const SKY_NORM = 1 / Math.asinh((200 - SKY_LO) / SKY_SOFT);

/** asinh stretch of a sky value to 0..1: noise stays a quiet texture, bright stars do not clip early. */
export const skyStretch = (v) => clamp(Math.asinh(Math.max(0, v - SKY_LO) / SKY_SOFT) * SKY_NORM);

/** The residual palette covers -RESIDUAL_RANGE..+RESIDUAL_RANGE. */
export const RESIDUAL_RANGE = 16;
const RESIDUAL_N = 512;

/** Residual palette: flat grey for noise, Signal red for excess, cold blue for deficit. */
export const RESIDUAL_LUT = (() => {
  const ink = hexToRgb(BRAND.ink);
  const paper = hexToRgb(BRAND.paper);
  const hot = hexToRgb(BRAND.signal);
  const cold = hexToRgb(BRAND.cold);
  const lut = new Uint8Array(RESIDUAL_N * 3);
  for (let i = 0; i < RESIDUAL_N; i++) {
    const r = (i / (RESIDUAL_N - 1)) * 2 * RESIDUAL_RANGE - RESIDUAL_RANGE;
    const grey = 0.205 + 0.026 * clamp(r, -3.2, 3.2);
    const tint = smoothstep(4.2, 10.5, Math.abs(r));
    const target = r > 0 ? hot : cold;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(lerp(lerp(ink[c], paper[c], grey), target[c], tint));
  }
  return lut;
})();

/** Byte offset into RESIDUAL_LUT for a residual value. */
export const residualIndex = (r) =>
  Math.round(((clamp(r, -RESIDUAL_RANGE, RESIDUAL_RANGE) + RESIDUAL_RANGE) * (RESIDUAL_N - 1)) / (2 * RESIDUAL_RANGE)) * 3;

/** CSS colour for the palette entry at a byte offset. */
export const rgbCss = (lut, index) => `rgb(${lut[index]},${lut[index + 1]},${lut[index + 2]})`;
