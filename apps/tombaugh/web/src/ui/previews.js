// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// previews.js: tiny looping previews for the target cards. Each one shows, in three seconds and
// 64 x 64 pixels, what the tool reveals for that kind of target.
//
//   createPreview(canvas, kind) -> { start(), stop(), destroy() }
//
// Kinds:
//   'mover'       a star stepping across pixels, its Gaia ring left behind
//   'pair'        two faint red dots moving together beside a bright star
//   'faint'       a barely-there dot that emerges as frames are stacked
//   'irregular'   a star that flickers without a pattern, with its light curve
//   'longperiod'  a slow smooth pulse, with a spectrum whose absorption bands change
//   'galaxy'      a galaxy that does nothing at all between visits
//   'field'       a plain star field (the default for unknown targets)
//
// The canvas backing store is set to 64 x 64; size it with CSS at a whole multiple (128 px, 192 px)
// with `image-rendering: pixelated`. The sky is a 32 x 32 grid of 2 x 2 blocks, so stars are as
// chunky as real 6.15 arcsec pixels, while rings and traces use the full 64 x 64.
//
// All previews share one scheduler (fx.js), run at 20 frames per second, and only while the canvas
// is on screen and the tab is visible. With prefers-reduced-motion they show one telling still.
//
// Optional extras (not in the contract):
//   createPreview(canvas, kind, { seed?, scheduler?, reducedMotion?, trigger? })
//     trigger: 'view' (default: animate while on screen) or 'hover' (animate only between
//     setActive(true) and setActive(false), for hover or focus driven cards)
//   returned object also has: kind, setActive(bool), renderAt(seconds)
//   PREVIEW_KINDS, PREVIEW_LABELS, previewKindFor(target)

import {
  BRAND,
  clamp,
  lerp,
  mulberry32,
  hashSeed,
  gaussianField,
  stampPsf,
  SKY_LUT,
  skyStretch,
  hexToRgb,
  prefersReducedMotion,
  scheduler as sharedScheduler,
} from './fx.js';

export const PREVIEW_KINDS = Object.freeze(['mover', 'pair', 'faint', 'irregular', 'longperiod', 'galaxy', 'field']);

/** Short tags for the card data plate. */
export const PREVIEW_LABELS = Object.freeze({
  mover: 'mover',
  pair: 'pair',
  faint: 'faint',
  irregular: 'flicker',
  longperiod: 'pulse',
  galaxy: 'static',
  field: 'field',
});

/** Other spellings a target's own `kind` field may use (core/targets.js uses 'cold' and 'lpv'). */
const KIND_ALIASES = { cold: 'faint', lpv: 'longperiod', mira: 'longperiod', variable: 'irregular', binary: 'pair', static: 'galaxy' };

const KIND_RULES = [
  ['pair', /luhman|binary|\bpair\b|companions?\b|eps(ilon)?[\s_-]*ind|co-?moving|two (brown )?dwarfs/i],
  ['faint', /wise[\s_-]*j?0855|0855|coldest|cold(est)? (brown )?dwarf|y[\s-]?dwarf|\bfaint\b|planet[\s_-]*(x|nine|9)/i],
  ['longperiod', /\bmira\b|long[\s_-]*period|\blpv\b|chi[\s_-]*cyg|r[\s_-]+(leo|hya|cas|dor)\b|pulsat/i],
  ['irregular', /irregular|flicker|r[\s_-]*cr[\s_-]*b|yso\b|t[\s_-]*tauri|young star|erupt|dipper|betelgeuse|semi-?regular/i],
  ['mover', /barnard|proper[\s_-]*motion|fast(est)?[\s_-]*(star|mover)|\bmover\b|high[\s_-]*pm|kapteyn|teegarden|asteroid|comet/i],
  ['galaxy', /galaxy|\bm\s?(31|33|51|81|82|101)\b|\bngc\b|nebula|static/i],
];

/**
 * Pick a preview kind for a target ({ id, name, blurb, why, pmra, pmdec, preview? }).
 * An explicit target.preview or target.kind wins; otherwise the id and name are matched, then the descriptions,
 * then a large proper motion means 'mover'. Anything else gets the plain 'field'.
 */
export function previewKindFor(target) {
  if (!target) return 'field';
  for (const given of [target.preview, target.kind]) {
    const kind = KIND_ALIASES[given] || given;
    if (PREVIEW_KINDS.includes(kind)) return kind;
  }
  const texts = [`${target.id || ''} ${target.name || ''}`, `${target.blurb || ''} ${target.why || ''}`];
  for (const text of texts) {
    for (const [kind, re] of KIND_RULES) if (re.test(text)) return kind;
  }
  const pm = Math.hypot(Number(target.pmra) || 0, Number(target.pmdec) || 0);
  return pm >= 1000 ? 'mover' : 'field';
}

// ---------------------------------------------------------------------------------------------

const N = 64; // canvas pixels
const G = 32; // sky pixels
const LOOP_S = 3;
const FPS = 20;
const SIGMA = 0.62;

const PAPER = hexToRgb(BRAND.paper);
const SIGNAL = hexToRgb(BRAND.signal);
const STONE = hexToRgb(BRAND.stone);
const PANEL = hexToRgb('#121210');
const UNLIT = [70, 69, 64];

/** Elongated Gaussian, for the galaxy. */
function stampEllipse(img, cx, cy, flux, sa, sb, paDeg) {
  const c = Math.cos((paDeg * Math.PI) / 180);
  const s = Math.sin((paDeg * Math.PI) / 180);
  const norm = flux / (2 * Math.PI * sa * sb);
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const u = dx * c + dy * s;
      const v = -dx * s + dy * c;
      img[y * G + x] += norm * Math.exp(-0.5 * ((u * u) / (sa * sa) + (v * v) / (sb * sb)));
    }
  }
}

function fieldStars(rand, count, avoid = [], minDist = 5) {
  const img = new Float32Array(G * G);
  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < 200) {
    const x = 2 + rand() * (G - 4);
    const y = 2 + rand() * (G - 4);
    const flux = 9 * Math.pow(1 - 0.93 * rand(), -0.9);
    if (avoid.some(([ax, ay, r]) => Math.hypot(x - ax, y - ay) < (r || minDist))) continue;
    stampPsf(img, G, G, x, y, flux, SIGMA);
    placed++;
  }
  return img;
}

const noiseSet = (rand, count) => Array.from({ length: count }, () => gaussianField(rand, G * G, 1));

/** Step index for an animation of `steps` equal steps followed by a hold on the last one. */
const stepAt = (t, steps, stepS) => Math.min(steps - 1, Math.floor(t / stepS));

// Each factory returns { sky(t, out, accent), overlay(t, o), still, stretch? }.
const FACTORIES = {
  mover(rand) {
    const steps = 5;
    const p0 = [10.5, 22.5];
    const d = [2.15, -2.35];
    const track = Array.from({ length: steps }, (_, k) => [p0[0] + d[0] * k, p0[1] + d[1] * k]);
    const base = fieldStars(rand, 6, track.map(([x, y]) => [x, y, 5]));
    const star = track.map(([x, y]) => stampPsf(new Float32Array(G * G), G, G, x, y, 240, SIGMA));
    const noise = noiseSet(rand, steps);
    return {
      still: 2.7,
      sky(t, out) {
        const k = stepAt(t, steps, 0.55);
        for (let i = 0; i < out.length; i++) out[i] = base[i] + star[k][i] + noise[k][i];
      },
      overlay(t, o) {
        const k = stepAt(t, steps, 0.55);
        o.ring(p0[0] * 2, p0[1] * 2, 7, SIGNAL, 1); // where the catalogue says it should be
        o.ticks(steps, k);
      },
    };
  },

  pair(rand) {
    const steps = 5;
    const bright = [9.5, 19.5];
    const p0 = [17.5, 8.5];
    const sep = [2.7, 1.4];
    const d = [1.35, 1.45];
    const base = fieldStars(rand, 4, [[bright[0], bright[1], 7], [21, 13, 9]]);
    stampPsf(base, G, G, bright[0], bright[1], 640, SIGMA);
    stampPsf(base, G, G, bright[0], bright[1], 60, 2);
    const dots = Array.from({ length: steps }, (_, k) => {
      const img = new Float32Array(G * G);
      stampPsf(img, G, G, p0[0] + d[0] * k, p0[1] + d[1] * k, 30, SIGMA);
      stampPsf(img, G, G, p0[0] + sep[0] + d[0] * k, p0[1] + sep[1] + d[1] * k, 24, SIGMA);
      return img;
    });
    const noise = noiseSet(rand, steps);
    return {
      still: 2.7,
      sky(t, out, accent) {
        const k = stepAt(t, steps, 0.55);
        for (let i = 0; i < out.length; i++) {
          out[i] = base[i] + dots[k][i] + noise[k][i];
          accent[i] = dots[k][i] / (dots[k][i] + 3.5);
        }
      },
      overlay(t, o) {
        o.ticks(steps, stepAt(t, steps, 0.55));
      },
    };
  },

  faint(rand) {
    const levels = [1, 2, 4, 8, 16, 32, 64];
    const target = stampPsf(new Float32Array(G * G), G, G, 15.5, 16.5, 4.4, SIGMA);
    stampPsf(target, G, G, 24.5, 7.5, 26, SIGMA);
    stampPsf(target, G, G, 6.5, 25.5, 9, SIGMA);
    // Running mean of 64 independent noise frames, sampled at each stack depth.
    const sum = new Float32Array(G * G);
    const means = [];
    let n = 0;
    for (const level of levels) {
      while (n < level) {
        const f = gaussianField(rand, G * G, 1);
        for (let i = 0; i < sum.length; i++) sum[i] += f[i];
        n++;
      }
      means.push(Float32Array.from(sum, (v) => v / level));
    }
    return {
      still: 2.9,
      stretch: (v) => Math.pow(clamp((v + 0.35) / 4.6), 0.75),
      sky(t, out) {
        const k = stepAt(t, levels.length, 0.36);
        for (let i = 0; i < out.length; i++) out[i] = target[i] + means[k][i];
      },
      overlay(t, o) {
        o.ticks(levels.length, stepAt(t, levels.length, 0.36));
      },
    };
  },

  irregular(rand) {
    const samples = LOOP_S * FPS;
    const knots = Array.from({ length: 9 }, () => 0.3 + 0.7 * rand());
    knots[3] = 0.08; // one deep, sudden fade
    knots[6] = Math.min(knots[6], 0.35);
    const curve = new Float32Array(samples);
    for (let j = 0; j < samples; j++) {
      const u = (j / samples) * knots.length;
      const a = Math.floor(u) % knots.length;
      const b = (a + 1) % knots.length;
      const f = u - Math.floor(u);
      const s = f * f * (3 - 2 * f);
      curve[j] = clamp(lerp(knots[a], knots[b], s) + (rand() - 0.5) * 0.14, 0.05, 1);
    }
    const base = fieldStars(rand, 4, [[16.5, 11.5, 6]]);
    for (let i = 23 * G; i < base.length; i++) base[i] = 0;
    const star = stampPsf(new Float32Array(G * G), G, G, 16.5, 11.5, 1, SIGMA);
    const noise = noiseSet(rand, 4);
    const at = (t) => curve[Math.floor((t / LOOP_S) * samples) % samples];
    return {
      still: 1.05,
      sky(t, out) {
        const flux = 30 + 330 * at(t);
        const nz = noise[Math.floor(t / 0.375) % noise.length];
        for (let i = 0; i < out.length; i++) out[i] = base[i] + star[i] * flux + nz[i];
      },
      overlay(t, o) {
        o.panel(47);
        const now = Math.floor((t / LOOP_S) * samples) % samples;
        const x0 = 4;
        const wPlot = 56;
        let cx = 0;
        let cy = 0;
        for (let x = 0; x < wPlot; x++) {
          const j = Math.floor((x / wPlot) * samples);
          const y = 60 - Math.round(curve[j] * 10);
          const played = j <= now;
          o.px(x0 + x, y, played ? PAPER : STONE, played ? 1 : 0.8);
          if (j <= now) {
            cx = x0 + x;
            cy = y;
          }
        }
        o.rect(cx - 1, cy - 1, 3, 3, SIGNAL, 1);
      },
    };
  },

  longperiod(rand) {
    const base = fieldStars(rand, 4, [[16.5, 10.5, 6]]);
    for (let i = 20 * G; i < base.length; i++) base[i] = 0;
    const star = stampPsf(new Float32Array(G * G), G, G, 16.5, 10.5, 1, SIGMA);
    stampPsf(star, G, G, 16.5, 10.5, 0.08, 1.9);
    const noise = noiseSet(rand, 4);
    const phase = (t) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / LOOP_S); // 0 faint, 1 bright
    return {
      still: 1.5,
      sky(t, out) {
        const flux = 36 + 420 * phase(t);
        const nz = noise[Math.floor(t / 0.375) % noise.length];
        for (let i = 0; i < out.length; i++) out[i] = base[i] + star[i] * flux + nz[i];
      },
      overlay(t, o) {
        o.panel(40);
        const ph = phase(t);
        const depth = lerp(0.78, 0.2, ph); // bands deepen as the star cools and fades
        const level = lerp(0.52, 1, ph);
        const bands = [
          [0.42, 0.05, 1],
          [0.74, 0.04, 0.8],
        ];
        let prev = null;
        for (let x = 0; x < 54; x++) {
          const u = x / 53;
          const continuum = 0.42 + 0.58 * Math.exp(-(((u - 0.26) / 0.4) ** 2));
          let dip = 1;
          for (const [c, w, d] of bands) dip -= depth * d * Math.exp(-0.5 * ((u - c) / w) ** 2);
          const y = 60 - Math.round(clamp(continuum * dip * level) * 17);
          const from = prev === null ? y : prev;
          const lo = Math.min(from, y);
          const hi = Math.max(from, y);
          for (let yy = lo; yy <= hi; yy++) o.px(5 + x, yy, PAPER, yy === y ? 1 : 0.55);
          prev = y;
        }
        for (const [c] of bands) o.rect(5 + Math.round(c * 53), 62, 1, 2, SIGNAL, 1);
      },
    };
  },

  galaxy(rand) {
    const base = fieldStars(rand, 5, [[16, 15.5, 9]]);
    stampEllipse(base, 16, 15.5, 420, 5.2, 2.1, -32);
    stampEllipse(base, 16, 15.5, 200, 2.4, 1.3, -32);
    stampEllipse(base, 16, 15.5, 90, 0.9, 0.8, 0);
    const noise = noiseSet(rand, 4);
    return {
      still: 0,
      sky(t, out) {
        const nz = noise[Math.floor(t / 0.75) % 4];
        for (let i = 0; i < out.length; i++) out[i] = base[i] + nz[i] * Math.sqrt(1 + 0.05 * base[i]);
      },
      overlay(t, o) {
        o.ticks(4, Math.floor(t / 0.75) % 4, true);
      },
    };
  },

  field(rand) {
    const base = fieldStars(rand, 12, [], 0);
    const noise = noiseSet(rand, 4);
    return {
      still: 0,
      sky(t, out) {
        const nz = noise[Math.floor(t / 0.75) % 4];
        for (let i = 0; i < out.length; i++) out[i] = base[i] + nz[i];
      },
      overlay(t, o) {
        o.ticks(4, Math.floor(t / 0.75) % 4, true);
      },
    };
  },
};

/** Painter for a 64 x 64 RGBA buffer. */
function makePainter(data) {
  const px = (x, y, rgb, a = 1) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const p = (y * N + x) * 4;
    data[p] = data[p] + (rgb[0] - data[p]) * a;
    data[p + 1] = data[p + 1] + (rgb[1] - data[p + 1]) * a;
    data[p + 2] = data[p + 2] + (rgb[2] - data[p + 2]) * a;
  };
  const rect = (x, y, w, h, rgb, a = 1) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(xx, yy, rgb, a);
  };
  return {
    px,
    rect,
    /** One-pixel ring centred on (cx, cy) in canvas pixels. */
    ring(cx, cy, r, rgb, a = 1) {
      const x0 = Math.floor(cx - r - 1);
      const x1 = Math.ceil(cx + r + 1);
      for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
        for (let x = x0; x <= x1; x++) {
          const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (Math.abs(dist - r) < 0.55) px(x, y, rgb, a);
        }
      }
    },
    /** A flat strip at the bottom for a trace, with a hairline above it. */
    panel(y0) {
      rect(0, y0, N, N - y0, PANEL, 1);
      rect(0, y0, N, 1, STONE, 0.55);
    },
    /** A row of time ticks, bottom left. `only`: light just the current one. */
    ticks(count, current, only = false) {
      for (let i = 0; i < count; i++) {
        const lit = only ? i === current : i <= current;
        rect(3 + i * 4, 59, 2, 2, lit ? PAPER : UNLIT, 1);
      }
    },
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} kind one of PREVIEW_KINDS; anything else falls back to 'field'
 * @param {{ seed?: number, scheduler?: Object, reducedMotion?: boolean, trigger?: 'view'|'hover' }} [opts]
 * @returns {{ start(): void, stop(): void, destroy(): void, kind: string, setActive(on: boolean): void, renderAt(seconds: number): void }}
 */
export function createPreview(canvas, kind, opts = {}) {
  const k = PREVIEW_KINDS.includes(kind) ? kind : 'field';
  const doc = canvas.ownerDocument;
  const win = doc.defaultView || globalThis;
  const sched = opts.scheduler || sharedScheduler;
  const trigger = opts.trigger === 'hover' ? 'hover' : 'view';
  const isReduced = () => (typeof opts.reducedMotion === 'boolean' ? opts.reducedMotion : prefersReducedMotion(win));

  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d', { alpha: false });
  const image = ctx.createImageData(N, N);
  const data = image.data;
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const painter = makePainter(data);
  const sky = new Float32Array(G * G);
  const accent = new Float32Array(G * G);
  const model = FACTORIES[k](mulberry32(opts.seed === undefined ? hashSeed(`tombaugh:${k}`) : opts.seed));
  const stretch = model.stretch || skyStretch;

  function renderAt(seconds) {
    const t = ((seconds % LOOP_S) + LOOP_S) % LOOP_S;
    accent.fill(0);
    model.sky(t, sky, accent);
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const i = gy * G + gx;
        const c = Math.round(stretch(sky[i]) * 255) * 3;
        const a = accent[i];
        const r = SKY_LUT[c] + (SIGNAL[0] - SKY_LUT[c]) * a;
        const g = SKY_LUT[c + 1] + (SIGNAL[1] - SKY_LUT[c + 1]) * a;
        const b = SKY_LUT[c + 2] + (SIGNAL[2] - SKY_LUT[c + 2]) * a;
        const p = (gy * 2 * N + gx * 2) * 4;
        data[p] = data[p + 4] = data[p + N * 4] = data[p + N * 4 + 4] = r;
        data[p + 1] = data[p + 5] = data[p + N * 4 + 1] = data[p + N * 4 + 5] = g;
        data[p + 2] = data[p + 6] = data[p + N * 4 + 2] = data[p + N * 4 + 6] = b;
      }
    }
    model.overlay(t, painter);
    ctx.putImageData(image, 0, 0);
  }

  let lastFrame = -1;
  const task = sched.add(
    (t) => {
      const frame = Math.floor(t * FPS);
      if (frame === lastFrame) return;
      lastFrame = frame;
      renderAt(t);
    },
    { element: canvas, fps: FPS },
  );
  let started = false;
  let active = trigger === 'view';
  let destroyed = false;

  const sync = () => {
    if (destroyed) return;
    if (started && active && !isReduced()) task.start();
    else task.stop();
  };

  renderAt(model.still);

  return {
    kind: k,
    start() {
      started = true;
      if (isReduced()) renderAt(model.still);
      sync();
    },
    stop() {
      started = false;
      sync();
    },
    /** For trigger 'hover': run while on, rest on the still frame while off. */
    setActive(on) {
      active = trigger === 'view' ? true : !!on;
      sync();
      if (!active && !destroyed) renderAt(model.still);
    },
    renderAt,
    destroy() {
      destroyed = true;
      task.destroy();
    },
  };
}
