// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  lerp,
  invLerp,
  remap,
  smoothstep,
  easing,
  mulberry32,
  hashSeed,
  gaussian,
  prefersReducedMotion,
  onReducedMotionChange,
  createScheduler,
  tween,
  createSpring,
  onEscape,
  hexToRgb,
  makeLut,
  stampPsf,
  gaussianField,
} from './fx.js';

// A fake browser environment with a hand-cranked clock.
function fakeEnv({ withIO = true } = {}) {
  let clock = 0;
  let nextId = 1;
  const queue = new Map();
  const docListeners = new Set();
  const document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => type === 'visibilitychange' && docListeners.add(fn),
    removeEventListener: (type, fn) => type === 'visibilitychange' && docListeners.delete(fn),
  };
  const observers = [];
  class FakeIO {
    constructor(cb) {
      this.cb = cb;
      this.targets = new Set();
      observers.push(this);
    }
    observe(el) {
      this.targets.add(el);
    }
    unobserve(el) {
      this.targets.delete(el);
    }
    disconnect() {
      this.targets.clear();
    }
  }
  return {
    env: {
      now: () => clock,
      raf: (cb) => {
        const id = nextId++;
        queue.set(id, cb);
        return id;
      },
      caf: (id) => queue.delete(id),
      document,
      IntersectionObserver: withIO ? FakeIO : null,
    },
    /** Advance the clock by ms and run the frame callbacks that were queued. */
    frame(ms = 16) {
      clock += ms;
      const cbs = Array.from(queue.values());
      queue.clear();
      for (const cb of cbs) cb(clock);
      return cbs.length;
    },
    get pending() {
      return queue.size;
    },
    get docListenerCount() {
      return docListeners.size;
    },
    setHidden(hidden) {
      document.visibilityState = hidden ? 'hidden' : 'visible';
      for (const fn of Array.from(docListeners)) fn();
    },
    intersect(el, isIntersecting) {
      for (const o of observers) if (o.targets.has(el)) o.cb([{ target: el, isIntersecting }]);
    },
    observers,
  };
}

test('clamp, lerp, invLerp, remap, smoothstep', () => {
  assert.equal(clamp(2), 1);
  assert.equal(clamp(-2), 0);
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.equal(invLerp(10, 20, 12.5), 0.25);
  assert.equal(invLerp(3, 3, 7), 0);
  assert.equal(remap(5, 0, 10, 100, 200), 150);
  assert.equal(remap(50, 0, 10, 100, 200), 200);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
});

test('every easing starts at 0, ends at 1 and clamps its input', () => {
  for (const [name, fn] of Object.entries(easing)) {
    assert.ok(Math.abs(fn(0)) < 1e-9, `${name}(0)`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name}(1)`);
    assert.equal(fn(-3), fn(0), `${name} clamps low`);
    assert.equal(fn(7), fn(1), `${name} clamps high`);
    assert.ok(Number.isFinite(fn(0.37)), `${name} finite`);
  }
});

test('easings have the expected shape', () => {
  assert.equal(easing.linear(0.3), 0.3);
  assert.ok(easing.inQuad(0.5) < 0.5);
  assert.ok(easing.outQuad(0.5) > 0.5);
  assert.ok(easing.inCubic(0.5) < easing.inQuad(0.5));
  assert.ok(Math.abs(easing.inOutCubic(0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(easing.inOutQuad(0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(easing.inOutSine(0.5) - 0.5) < 1e-12);
  assert.ok(easing.outBack(0.7) > 1, 'outBack overshoots');
  // monotonic ones never go backwards
  for (const name of ['inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic', 'outQuart', 'inOutSine', 'outExpo']) {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = easing[name](i / 100);
      assert.ok(v >= prev - 1e-12, `${name} monotonic at ${i}`);
      prev = v;
    }
  }
});

test('mulberry32 is deterministic, seed-dependent and uniform in [0, 1)', () => {
  const a = mulberry32(1930);
  const b = mulberry32(1930);
  const c = mulberry32(1931);
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  const seqC = Array.from({ length: 50 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  const r = mulberry32(42);
  let sum = 0;
  const bins = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
    sum += v;
    bins[Math.floor(v * 10)]++;
  }
  assert.ok(Math.abs(sum / 20000 - 0.5) < 0.01, 'mean near 0.5');
  for (const n of bins) assert.ok(n > 1700 && n < 2300, 'bins roughly even');
});

test('mulberry32 matches the reference implementation', () => {
  // Reference values computed from the canonical mulberry32 with the same integer steps.
  const ref = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  for (const seed of [0, 1, 0xdeadbeef, -5, 2 ** 32 + 7]) {
    const x = mulberry32(seed);
    const y = ref(seed);
    for (let i = 0; i < 8; i++) assert.equal(x(), y());
  }
  // Seeds are taken modulo 2^32.
  assert.equal(mulberry32(7)(), mulberry32(2 ** 32 + 7)());
});

test('hashSeed and gaussian', () => {
  assert.equal(hashSeed('barnard'), hashSeed('barnard'));
  assert.notEqual(hashSeed('barnard'), hashSeed('barnarD'));
  assert.equal(hashSeed(''), 0x811c9dc5);
  assert.ok(Number.isInteger(hashSeed('x')) && hashSeed('x') >= 0);
  const r = mulberry32(7);
  let s = 0;
  let s2 = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const v = gaussian(r);
    assert.ok(Number.isFinite(v));
    s += v;
    s2 += v * v;
  }
  assert.ok(Math.abs(s / n) < 0.03, 'mean near 0');
  assert.ok(Math.abs(s2 / n - 1) < 0.05, 'variance near 1');
});

test('prefersReducedMotion reads matchMedia and survives its absence', () => {
  assert.equal(prefersReducedMotion({}), false);
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(
    prefersReducedMotion({
      matchMedia: () => {
        throw new Error('sandboxed');
      },
    }),
    false,
  );
  let handler = null;
  const win = {
    matchMedia: () => ({
      matches: false,
      addEventListener: (_t, fn) => (handler = fn),
      removeEventListener: () => (handler = null),
    }),
  };
  const seen = [];
  const off = onReducedMotionChange((v) => seen.push(v), win);
  handler({ matches: true });
  assert.deepEqual(seen, [true]);
  off();
  assert.equal(handler, null);
});

test('scheduler runs started tasks with their own clock and stops the loop when idle', () => {
  const f = fakeEnv();
  const s = createScheduler(f.env);
  const calls = [];
  const task = s.add((t, dt) => calls.push([t, dt]));
  assert.equal(s.size, 1);
  assert.equal(s.running, false, 'nothing scheduled before start');
  assert.equal(f.pending, 0);
  task.start();
  assert.equal(task.running, true);
  assert.equal(s.running, true);
  f.frame(16);
  f.frame(16);
  assert.equal(calls.length, 2);
  assert.ok(Math.abs(calls[0][0] - 0.016) < 1e-9);
  assert.ok(Math.abs(calls[1][0] - 0.032) < 1e-9);
  assert.ok(Math.abs(calls[1][1] - 0.016) < 1e-9);
  task.stop();
  assert.equal(s.running, false, 'loop cancelled when no task is active');
  assert.equal(f.pending, 0);
  f.frame(500);
  assert.equal(calls.length, 2);
  // Restart: the task clock resumes where it left off, the pause is not counted.
  task.start();
  f.frame(16);
  assert.ok(Math.abs(calls[2][0] - 0.048) < 1e-9);
  task.destroy();
  assert.equal(s.size, 0);
  assert.equal(s.running, false);
  assert.equal(f.docListenerCount, 0, 'visibility listener released with the last task');
});

test('scheduler pauses while the tab is hidden and resumes without a jump', () => {
  const f = fakeEnv();
  const s = createScheduler(f.env);
  const times = [];
  const task = s.add((t) => times.push(t)).start();
  f.frame(16);
  assert.equal(times.length, 1);
  f.setHidden(true);
  assert.equal(s.running, false);
  assert.equal(task.active, false);
  assert.equal(task.running, true, 'still wanted, just paused');
  assert.equal(f.frame(60000), 0, 'no frame callbacks while hidden');
  f.setHidden(false);
  assert.equal(s.running, true);
  f.frame(16);
  assert.equal(times.length, 2);
  assert.ok(Math.abs(times[1] - 0.032) < 1e-9, 'a minute in the background did not advance the animation');
});

test('scheduler clamps long frames', () => {
  const f = fakeEnv();
  const s = createScheduler(f.env);
  const dts = [];
  s.add((_t, dt) => dts.push(dt)).start();
  f.frame(5000);
  assert.ok(Math.abs(dts[0] - 0.1) < 1e-9);
});

test('scheduler only runs tasks whose element is on screen', () => {
  const f = fakeEnv();
  const s = createScheduler(f.env);
  const el = { id: 'canvas' };
  let n = 0;
  let m = 0;
  const a = s.add(() => n++, { element: el }).start();
  const b = s.add(() => m++).start();
  f.frame();
  assert.equal(n, 1, 'assumed on screen until told otherwise');
  f.intersect(el, false);
  assert.equal(a.inView, false);
  assert.equal(a.active, false);
  f.frame();
  f.frame();
  assert.equal(n, 1);
  assert.equal(m, 3, 'the other task keeps running');
  b.stop();
  assert.equal(s.running, false, 'the only started-and-visible task stopped, so the loop stops');
  f.intersect(el, true);
  assert.equal(s.running, true, 'coming back on screen restarts the loop');
  f.frame();
  assert.equal(n, 2);
  a.destroy();
  assert.equal(f.observers[0].targets.size, 0, 'element unobserved on destroy');
  b.destroy();
});

test('scheduler works without IntersectionObserver and supports setInView', () => {
  const f = fakeEnv({ withIO: false });
  const s = createScheduler(f.env);
  let n = 0;
  const task = s.add(() => n++, { element: {} }).start();
  f.frame();
  assert.equal(n, 1);
  task.setInView(false);
  assert.equal(s.running, false);
  task.setInView(true);
  f.frame();
  assert.equal(n, 2);
});

test('scheduler fps cap, seeking and failure isolation', () => {
  const f = fakeEnv();
  const s = createScheduler(f.env);
  const steps = [];
  const slow = s.add((t, dt) => steps.push(dt), { fps: 20 }).start();
  for (let i = 0; i < 60; i++) f.frame(1000 / 60);
  assert.ok(steps.length >= 19 && steps.length <= 21, `about 20 calls in one second, got ${steps.length}`);
  assert.ok(Math.abs(slow.time - 1) < 0.06, 'throttled task still keeps real time');
  slow.time = 5;
  assert.equal(slow.time, 5);
  slow.destroy();

  let good = 0;
  const origError = console.error;
  console.error = () => {};
  try {
    const bad = s
      .add(() => {
        throw new Error('boom');
      })
      .start();
    s.add(() => good++).start();
    f.frame();
    f.frame();
    assert.equal(bad.running, false, 'a throwing task is stopped');
    assert.equal(good, 2, 'other tasks are unaffected');
  } finally {
    console.error = origError;
  }
});

test('scheduler tolerates a task destroying another during a frame, and autoStart', () => {
  const f = fakeEnv();
  const s = createScheduler(f.env);
  let later = 0;
  let second = null;
  s.add(() => second.destroy(), { autoStart: true });
  second = s.add(() => later++, { autoStart: true });
  f.frame();
  assert.equal(later, 0);
  assert.equal(s.size, 1);
  s.destroy();
  assert.equal(s.size, 0);
  assert.equal(s.running, false);
});

test('tween interpolates, eases, delays and finishes exactly on the target', () => {
  const f = fakeEnv();
  const s = createScheduler(f.env);
  const seen = [];
  let done = 0;
  const tw = tween({ from: 10, to: 20, duration: 100, ease: easing.linear, onUpdate: (v) => seen.push(v), onDone: () => done++, scheduler: s });
  f.frame(50);
  assert.ok(Math.abs(seen[0] - 15) < 1e-9);
  f.frame(50);
  assert.equal(seen[seen.length - 1], 20);
  assert.equal(done, 1);
  assert.equal(tw.done, true);
  assert.equal(s.size, 0, 'tween task removed when finished');

  const late = [];
  tween({ duration: 40, delay: 60, ease: easing.linear, onUpdate: (v) => late.push(v), scheduler: s });
  f.frame(50);
  assert.equal(late.length, 0, 'nothing before the delay');
  f.frame(30);
  assert.ok(Math.abs(late[0] - 0.5) < 1e-9);

  let cancelledDone = 0;
  const c = tween({ duration: 100, onDone: () => cancelledDone++, scheduler: s });
  c.cancel();
  f.frame(200);
  assert.equal(cancelledDone, 0);

  const instant = [];
  const z = tween({ from: 3, to: 9, duration: 0, onUpdate: (v) => instant.push(v), scheduler: s });
  assert.deepEqual(instant, [9]);
  assert.equal(z.done, true);
});

test('spring settles on its target and can overshoot when underdamped', () => {
  const sp = createSpring({ value: 0, target: 1 });
  for (let i = 0; i < 240; i++) sp.step(1 / 60);
  assert.equal(sp.value, 1);
  assert.equal(sp.atRest, true);

  const bouncy = createSpring({ value: 0, target: 1, stiffness: 300, damping: 6 });
  let max = 0;
  for (let i = 0; i < 120; i++) max = Math.max(max, bouncy.step(1 / 60));
  assert.ok(max > 1.05, 'underdamped spring overshoots');
  assert.ok(Number.isFinite(bouncy.step(10)), 'huge dt stays finite');
  bouncy.jump(4);
  assert.equal(bouncy.value, 4);
  assert.equal(bouncy.atRest, true);
});

test('onEscape gives the key to the most recently opened card', () => {
  const listeners = new Set();
  const doc = {
    addEventListener: (_t, fn) => listeners.add(fn),
    removeEventListener: (_t, fn) => listeners.delete(fn),
  };
  const press = (key = 'Escape') => {
    const ev = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const fn of Array.from(listeners)) fn(ev);
    return ev;
  };
  const log = [];
  const offA = onEscape(() => log.push('a'), doc);
  const offB = onEscape(() => log.push('b'), doc);
  assert.equal(listeners.size, 1, 'one shared listener');
  assert.equal(press().defaultPrevented, true);
  assert.deepEqual(log, ['b']);
  press('Enter');
  assert.deepEqual(log, ['b']);
  offB();
  press();
  assert.deepEqual(log, ['b', 'a']);
  offA();
  assert.equal(listeners.size, 0);
  assert.equal(press().defaultPrevented, false);
});

test('pixel-art helpers: colours, lookup tables, PSF stamps, noise', () => {
  assert.deepEqual(hexToRgb('#E53C27'), [229, 60, 39]);
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  const lut = makeLut([[0, '#000000'], [1, '#ffffff']], 3);
  assert.deepEqual(Array.from(lut), [0, 0, 0, 128, 128, 128, 255, 255, 255]);
  const three = makeLut([[0, '#000000'], [0.5, '#ff0000'], [1, '#ffffff']], 5);
  assert.deepEqual(Array.from(three.slice(6, 9)), [255, 0, 0]);

  const w = 15;
  const img = new Float32Array(w * w);
  stampPsf(img, w, w, 7.5, 7.5, 100, 0.6);
  const total = img.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 100) < 1.5, `flux conserved, got ${total}`);
  assert.equal(img.indexOf(Math.max(...img)), 7 * w + 7, 'peak in the centre pixel');
  assert.ok(Math.abs(img[7 * w + 6] - img[7 * w + 8]) < 1e-4, 'symmetric');
  // A source off the edge must not write out of bounds or throw.
  stampPsf(img, w, w, -3, 40, 100, 0.6);
  stampPsf(img, w, w, 0.2, 0.2, 10, 0.6);
  assert.equal(img.length, w * w);

  const a = gaussianField(mulberry32(3), 500, 2);
  const b = gaussianField(mulberry32(3), 500, 2);
  assert.deepEqual(Array.from(a), Array.from(b));
  const rms = Math.sqrt(a.reduce((acc, v) => acc + v * v, 0) / a.length);
  assert.ok(rms > 1.7 && rms < 2.3);
});
