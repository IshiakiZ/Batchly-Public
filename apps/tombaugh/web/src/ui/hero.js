// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// hero.js: the animated blink-comparator scene on the landing page. Entirely procedural.
//
//   createHero(canvas) -> { start(), stop(), destroy() }
//
// What it shows, on a loop of 14.4 s:
//   1. A small patch of infrared sky in chunky SPHEREx-like pixels, blinking between two visits
//      ("2025 Jun" and "2025 Dec") every 1.2 s, the way a blink comparator does. Every star stays
//      put except one that hops by a couple of pixels and one that changes brightness.
//   2. A wipe to the residual view (frame minus predicted sky). The static stars cancel to flat
//      grey noise. The mover is left as a red/blue pair, the variable as a dot that flips sign,
//      and two small labels appear: "moved", "varied".
//   3. A wipe back.
// With prefers-reduced-motion it draws one still image instead: before and after subtraction,
// side by side.
//
// The sky is computed at one value per sky pixel and scaled up with nearest-neighbour, so a frame
// costs a few thousand pixel writes. Nothing is redrawn unless something on screen changed, which
// is most of the time between blinks. Frame, ticks and text are drawn at device resolution.
//
// Optional extras (not in the contract):
//   createHero(canvas, { seed?, scheduler?, reducedMotion? })
//   returned object also has: seek(seconds), redraw(), running (getter)
//   heroTimeline(seconds) -> the state of the loop at a given time (pure, exported for tests)

import {
  BRAND,
  clamp,
  easing,
  smoothstep,
  mulberry32,
  gaussianField,
  stampPsf,
  SKY_LUT,
  skyStretch,
  RESIDUAL_LUT,
  residualIndex,
  prefersReducedMotion,
  onReducedMotionChange,
  scheduler as sharedScheduler,
} from './fx.js';

const BLINK_S = 1.2; // one epoch is held this long
const FADE_S = 0.1; // length of the cross-fade at each blink
const CYCLE_S = 14.4; // twelve blinks
const WIPE_IN = [6.25, 7.15]; // residual sweeps in, left to right
const WIPE_OUT = [13.45, 14.35]; // frames sweep back in, left to right
const ARCSEC_PER_PIXEL = 6.15;
const EPOCHS = [
  { date: '2025 Jun', wave: '2.19' },
  { date: '2025 Dec', wave: '2.23' },
];
const MONO = 'Consolas, "SFMono-Regular", Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace';

/**
 * State of the hero loop at time t (seconds since start).
 * mix: weight of the second epoch (0 = June, 1 = December); flip: 0..1 progress of the last blink;
 * resL..resR: the fraction of the width showing the residual; labels: opacity of the labels.
 */
export function heroTimeline(t) {
  const time = Math.max(0, t);
  const idx = Math.floor(time / BLINK_S);
  const into = time - idx * BLINK_S;
  const epoch = idx % 2;
  const flip = idx === 0 ? 1 : easing.inOutQuad(into / FADE_S);
  const mix = epoch === 1 ? flip : 1 - flip;
  const tc = time % CYCLE_S;
  let resL = 0;
  let resR = 0;
  let wiping = false;
  if (tc >= WIPE_IN[0] && tc < WIPE_IN[1]) {
    resR = easing.inOutCubic((tc - WIPE_IN[0]) / (WIPE_IN[1] - WIPE_IN[0]));
    wiping = true;
  } else if (tc >= WIPE_IN[1] && tc < WIPE_OUT[0]) {
    resR = 1;
  } else if (tc >= WIPE_OUT[0] && tc < WIPE_OUT[1]) {
    resL = easing.inOutCubic((tc - WIPE_OUT[0]) / (WIPE_OUT[1] - WIPE_OUT[0]));
    resR = 1;
    wiping = true;
  }
  const labels = Math.min(smoothstep(WIPE_IN[1] - 0.1, WIPE_IN[1] + 0.3, tc), 1 - smoothstep(WIPE_OUT[0] - 0.3, WIPE_OUT[0], tc));
  return { epoch, mix, flip, resL, resR, wiping, labels, residual: resR - resL >= 0.5 };
}

// ---------------------------------------------------------------------------------------------
// Scene: two epochs of the same w x h patch, and their residuals against the fitted sky.

function buildScene(w, h, seed) {
  const n = w * h;
  const rand = mulberry32(seed);
  const sigma = 0.6; // FWHM about 1.4 pixels, like the real PSF on 6.15 arcsec pixels

  const mover = {
    ax: Math.round(w * 0.33) + 0.5,
    ay: Math.round(h * 0.45) + 0.5,
    flux: 150,
  };
  mover.bx = mover.ax + 2.25;
  mover.by = mover.ay - 1.25;
  const variable = { x: Math.round(w * 0.69) + 0.5, y: Math.round(h * 0.6) + 0.5, lo: 42, hi: 150 };

  const stat = new Float32Array(n);
  const keepClear = (x, y, r) =>
    Math.hypot(x - (mover.ax + mover.bx) / 2, y - (mover.ay + mover.by) / 2) < r || Math.hypot(x - variable.x, y - variable.y) < r;

  // A few placed anchors give the field a composition; the rest is a seeded power-law field.
  const anchors = [
    [0.12, 0.27, 900],
    [0.885, 0.19, 430],
    [0.545, 0.85, 300],
    [0.255, 0.8, 150],
    [0.47, 0.17, 110],
  ];
  for (const [fx, fy, flux] of anchors) {
    const x = Math.round(w * fx) + 0.5;
    const y = Math.round(h * fy) + 0.5;
    stampPsf(stat, w, h, x, y, flux * 0.93, sigma);
    stampPsf(stat, w, h, x, y, flux * 0.07, 1.9); // faint wings on the bright ones
  }
  const count = Math.round(n / 88);
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const flux = 10 * Math.pow(1 - 0.965 * rand(), -0.9);
    if (keepClear(x, y, 6.5)) continue;
    stampPsf(stat, w, h, x, y, flux, sigma);
  }
  // One small fuzzy galaxy, so not everything is a point.
  {
    const gx = Math.round(w * 0.835) + 0.5;
    const gy = Math.round(h * 0.76) + 0.5;
    for (let k = -2; k <= 2; k++) stampPsf(stat, w, h, gx + k * 0.75, gy - k * 0.42, 15 - Math.abs(k) * 3.5, 1.05);
  }

  const movA = stampPsf(new Float32Array(n), w, h, mover.ax, mover.ay, mover.flux, sigma);
  const movB = stampPsf(new Float32Array(n), w, h, mover.bx, mover.by, mover.flux, sigma);
  const varStamp = stampPsf(new Float32Array(n), w, h, variable.x, variable.y, 1, sigma);
  const noiseA = gaussianField(rand, n, 1);
  const noiseB = gaussianField(rand, n, 1);

  const rawA = new Float32Array(n); // stretched 0..1
  const rawB = new Float32Array(n);
  const resA = new Float32Array(n); // in units of the background noise
  const resB = new Float32Array(n);
  const varMean = (variable.lo + variable.hi) / 2;
  for (let i = 0; i < n; i++) {
    const model = stat[i] + 0.5 * (movA[i] + movB[i]) + varMean * varStamp[i];
    const noiseSigma = Math.sqrt(1 + 0.014 * model); // photon noise: bright stars subtract less cleanly
    const a = stat[i] + movA[i] + variable.lo * varStamp[i] + noiseA[i] * noiseSigma;
    const b = stat[i] + movB[i] + variable.hi * varStamp[i] + noiseB[i] * noiseSigma;
    rawA[i] = skyStretch(a);
    rawB[i] = skyStretch(b);
    resA[i] = a - model;
    resB[i] = b - model;
  }
  return { w, h, mover, variable, rawA, rawB, resA, resB };
}

/** Write the sky into RGBA bytes: residual where resL <= x/w < resR, blinked frames elsewhere. */
function paintSky(data, scene, mix, resL, resR) {
  const { w, h, rawA, rawB, resA, resB } = scene;
  const xl = Math.round(resL * w);
  const xr = Math.round(resR * w);
  let p = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p += 4) {
      const i = y * w + x;
      let lut;
      let k;
      if (x >= xl && x < xr) {
        k = residualIndex(resA[i] + (resB[i] - resA[i]) * mix);
        lut = RESIDUAL_LUT;
      } else {
        k = Math.round((rawA[i] + (rawB[i] - rawA[i]) * mix) * 255) * 3;
        lut = SKY_LUT;
      }
      data[p] = lut[k];
      data[p + 1] = lut[k + 1];
      data[p + 2] = lut[k + 2];
      data[p + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------------------------

/**
 * @param {HTMLCanvasElement} canvas sized by CSS; the hero follows its size and the device pixel ratio
 * @param {{ seed?: number, scheduler?: Object, reducedMotion?: boolean }} [opts]
 * @returns {{ start(): void, stop(): void, destroy(): void, seek(seconds: number): void, redraw(): void, running: boolean }}
 */
export function createHero(canvas, opts = {}) {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView || globalThis;
  const ctx = canvas.getContext('2d', { alpha: false });
  const sched = opts.scheduler || sharedScheduler;
  const seed = opts.seed === undefined ? 1930 : opts.seed; // the year Clyde Tombaugh found Pluto
  const forced = typeof opts.reducedMotion === 'boolean';
  let reduced = forced ? opts.reducedMotion : prefersReducedMotion(win);

  const off = doc.createElement('canvas');
  const offCtx = off.getContext('2d', { alpha: false });
  let image = null;
  let scene = null;
  let L = null; // layout in device pixels
  let lastSig = '';
  let destroyed = false;
  let started = false;

  const task = sched.add((t) => draw(t), { element: canvas });

  function layout() {
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || canvas.clientWidth;
    const cssH = rect.height || canvas.clientHeight;
    if (!(cssW >= 80) || !(cssH >= 60)) {
      L = null;
      return;
    }
    const dpr = clamp(win.devicePixelRatio || 1, 1, 3);
    const cw = Math.round(cssW * dpr);
    const ch = Math.round(cssH * dpr);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const narrow = cssW < 440;
    const px = (v) => Math.round(v * dpr);
    const headerH = px(narrow ? 27 : 31);
    const footerH = px(narrow ? 27 : 31);
    const side = px(narrow ? 7 : 13);
    const cell = Math.max(1, Math.round((cssW < 440 ? 5 : cssW < 720 ? 6 : 7) * dpr));
    const panels = reduced ? 2 : 1;
    const gap = reduced ? px(narrow ? 10 : 18) : 0;
    const availW = cw - 2 * side;
    const availH = ch - headerH - footerH;
    const w = Math.max(8, Math.floor((availW - gap) / panels / cell));
    const h = Math.max(8, Math.floor(availH / cell));
    const imgW = w * cell;
    const imgH = h * cell;
    const ox = Math.round((cw - (imgW * panels + gap)) / 2);
    const oy = headerH + Math.floor((availH - imgH) / 2);
    L = { dpr, cw, ch, px, cell, w, h, imgW, imgH, ox, oy, gap, panels, narrow, fontPx: px(narrow ? 10 : 11) };
    if (!scene || scene.w !== w || scene.h !== h) {
      scene = buildScene(w, h, seed);
      off.width = w;
      off.height = h;
      image = offCtx.createImageData(w, h);
    }
    lastSig = '';
  }

  // ---- drawing helpers (device pixels) ----

  const setFont = () => {
    ctx.font = `${L.fontPx}px ${MONO}`;
    ctx.textBaseline = 'alphabetic';
  };
  const hline = (x0, x1, y, lw) => ctx.fillRect(Math.round(x0), Math.round(y - lw / 2), Math.round(x1 - x0), lw);
  const vline = (x, y0, y1, lw) => ctx.fillRect(Math.round(x - lw / 2), Math.round(y0), lw, Math.round(y1 - y0));

  function blitSky(x) {
    offCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, L.w, L.h, x, L.oy, L.imgW, L.imgH);
  }

  function drawFrame(x) {
    const { px, oy, imgW, imgH, cell } = L;
    const lw = Math.max(1, px(1));
    const y = oy;
    // hairline frame
    ctx.fillStyle = 'rgba(119, 118, 110, 0.9)';
    hline(x - lw, x + imgW + lw, y - lw / 2, lw);
    hline(x - lw, x + imgW + lw, y + imgH + lw / 2, lw);
    vline(x - lw / 2, y, y + imgH, lw);
    vline(x + imgW + lw / 2, y, y + imgH, lw);
    // edge ticks every 10 sky pixels (about one arcminute), longer every 50
    const tick = px(4);
    for (let i = 10; i < L.w; i += 10) {
      const len = i % 50 === 0 ? tick * 1.8 : tick;
      const tx = x + i * cell;
      vline(tx, y - lw - len, y - lw, lw);
      vline(tx, y + imgH + lw, y + imgH + lw + len, lw);
    }
    for (let j = 10; j < L.h; j += 10) {
      const len = j % 50 === 0 ? tick * 1.8 : tick;
      const ty = y + imgH - j * cell;
      hline(x - lw - len, x - lw, ty, lw);
      hline(x + imgW + lw, x + imgW + lw + len, ty, lw);
    }
    // corner ticks
    const c = px(10);
    const cw2 = Math.max(1, px(1.5));
    const o = lw + px(3);
    ctx.fillStyle = BRAND.paper;
    const corner = (cx, cy, sx, sy) => {
      ctx.fillRect(sx > 0 ? cx : cx - c, sy > 0 ? cy : cy - cw2, c, cw2);
      ctx.fillRect(sx > 0 ? cx : cx - cw2, sy > 0 ? cy : cy - c, cw2, c);
    };
    corner(x - o, y - o, 1, 1);
    corner(x + imgW + o, y - o, -1, 1);
    corner(x - o, y + imgH + o, 1, -1);
    corner(x + imgW + o, y + imgH + o, -1, -1);
  }

  /** Bracket and caption around a point of interest in the residual. */
  function drawCallout(x, cxSky, cySky, halfSky, text, alpha) {
    if (alpha <= 0.01) return;
    const { px, oy, cell, imgW } = L;
    const cx = x + cxSky * cell;
    const cy = oy + cySky * cell;
    const half = Math.round(halfSky * cell);
    const lw = Math.max(1, px(1));
    const arm = Math.max(px(4), Math.round(half * 0.42));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = BRAND.paper;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const ex = cx + sx * half;
        const ey = cy + sy * half;
        ctx.fillRect(Math.round(sx > 0 ? ex - arm : ex), Math.round(ey - lw / 2), arm, lw);
        ctx.fillRect(Math.round(ex - lw / 2), Math.round(sy > 0 ? ey - arm : ey), lw, arm);
      }
    }
    setFont();
    const tw = ctx.measureText(text).width;
    const padX = px(5);
    const boxH = L.fontPx + px(7);
    let tx = cx + half + px(9);
    let ty = cy;
    if (tx + tw + padX * 2 <= x + imgW - px(4)) {
      // label to the right, joined by a short leader
      ctx.fillRect(Math.round(cx + half), Math.round(cy - lw / 2), Math.round(tx - cx - half), lw);
    } else {
      // no room on the right: label underneath
      tx = Math.min(x + imgW - px(4) - tw - padX * 2, Math.max(x + px(4), cx - tw / 2 - padX));
      ty = cy + half + px(8) + boxH / 2;
      ctx.fillRect(Math.round(cx - lw / 2), Math.round(cy + half), lw, Math.round(ty - boxH / 2 - cy - half));
    }
    ctx.fillStyle = BRAND.ink;
    ctx.fillRect(Math.round(tx), Math.round(ty - boxH / 2), Math.round(tw + padX * 2), boxH);
    ctx.fillStyle = BRAND.paper;
    ctx.textAlign = 'left';
    ctx.fillText(text, Math.round(tx + padX), Math.round(ty + L.fontPx * 0.36));
    ctx.globalAlpha = 1;
  }

  function drawCallouts(x, alpha) {
    const { mover, variable } = scene;
    drawCallout(x, (mover.ax + mover.bx) / 2, (mover.ay + mover.by) / 2, 4.2, 'moved', alpha);
    drawCallout(x, variable.x, variable.y, 3.4, 'varied', alpha);
  }

  /** Two-part readout: a dim label followed by a bright value. Returns the x after it. */
  function readout(x, y, label, value, alpha = 1, dy = 0) {
    setFont();
    ctx.textAlign = 'left';
    ctx.fillStyle = BRAND.dim;
    ctx.fillText(label, x, y);
    const lx = x + ctx.measureText(label + ' ').width;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = BRAND.paper;
    ctx.fillText(value, lx, y + dy);
    ctx.globalAlpha = 1;
    return lx + ctx.measureText(value).width;
  }
  function readoutRight(xRight, y, label, value, alpha = 1, dy = 0) {
    setFont();
    const wv = ctx.measureText(value).width;
    const wl = ctx.measureText(label + ' ').width;
    readout(xRight - wv - wl, y, label, value, alpha, dy);
    return xRight - wv - wl;
  }

  function drawScaleBar(x, y) {
    const { px, cell } = L;
    const lw = Math.max(1, px(1));
    const len = Math.round((60 / ARCSEC_PER_PIXEL) * cell); // one arcminute of sky
    ctx.fillStyle = BRAND.paper;
    hline(x, x + len, y - px(4), lw);
    vline(x + lw / 2, y - px(7), y - px(1), lw);
    vline(x + len - lw / 2, y - px(7), y - px(1), lw);
    setFont();
    ctx.textAlign = 'left';
    ctx.fillStyle = BRAND.dim;
    ctx.fillText('1 arcmin', x + len + px(8), y);
  }

  function drawAnimated(t) {
    const s = heroTimeline(t);
    const { px, ox, oy, imgW, imgH, cw, ch, cell } = L;
    // Skip the frame if nothing visible changed.
    const sig = [Math.round(s.mix * 24), Math.round(s.resL * L.w), Math.round(s.resR * L.w), Math.round(s.labels * 16), Math.round(s.flip * 12), s.residual ? 1 : 0].join('|');
    if (sig === lastSig) return;
    lastSig = sig;

    ctx.fillStyle = BRAND.ink;
    ctx.fillRect(0, 0, cw, ch);
    paintSky(image.data, scene, s.mix, s.resL, s.resR);
    blitSky(ox);
    drawFrame(ox);

    // the wipe edge
    if (s.wiping) {
      const edge = (s.resL > 0 ? s.resL : s.resR) * L.w;
      const ex = ox + Math.round(edge) * cell;
      const lw = Math.max(1, px(1.5));
      ctx.fillStyle = BRAND.paper;
      vline(ex, oy - px(5), oy + imgH + px(5), lw);
    }
    drawCallouts(ox, s.labels);

    // header: epoch, A/B lamps, wavelength
    const ep = EPOCHS[s.mix >= 0.5 ? 1 : 0];
    const settle = s.mix >= 0.5 ? s.mix * 2 - 1 : 1 - s.mix * 2; // 0 at the swap, 1 when settled
    const dy = Math.round((1 - settle) * px(3));
    const alpha = 0.25 + 0.75 * settle;
    const hy = oy - px(11);
    let x = readout(ox, hy, L.narrow ? '' : 'VISIT', ep.date, alpha, dy);
    const lamp = px(7);
    x += px(12);
    for (let i = 0; i < 2; i++) {
      const on = (s.mix >= 0.5 ? 1 : 0) === i;
      const lx = x + i * (lamp + px(4));
      const ly = hy - lamp + px(1);
      ctx.fillStyle = on ? BRAND.paper : BRAND.stone;
      if (on) ctx.fillRect(lx, ly, lamp, lamp);
      else {
        const lw = Math.max(1, px(1));
        ctx.fillRect(lx, ly, lamp, lw);
        ctx.fillRect(lx, ly + lamp - lw, lamp, lw);
        ctx.fillRect(lx, ly, lw, lamp);
        ctx.fillRect(lx + lamp - lw, ly, lw, lamp);
      }
    }
    readoutRight(ox + imgW, hy, L.narrow ? 'λ' : 'WAVELENGTH', `${ep.wave} µm`, alpha, dy);

    // footer: scale bar and what is on screen
    const fy = oy + imgH + px(20);
    drawScaleBar(ox, fy);
    const vx = readoutRight(ox + imgW, fy, 'VIEW', s.residual ? 'frame − predicted sky' : 'frame');
    if (s.residual) {
      // the one use of Signal in the chrome: a small mark that the subtraction is on
      const m = px(5);
      ctx.fillStyle = BRAND.signal;
      ctx.fillRect(Math.round(vx - px(8) - m), fy - m - px(1), m, m);
    }
  }

  function drawStatic() {
    const { px, ox, oy, imgW, imgH, cw, ch, gap } = L;
    lastSig = 'static';
    ctx.fillStyle = BRAND.ink;
    ctx.fillRect(0, 0, cw, ch);
    const x2 = ox + imgW + gap;
    paintSky(image.data, scene, 1, 0, 0);
    blitSky(ox);
    drawFrame(ox);
    paintSky(image.data, scene, 1, 0, 1);
    blitSky(x2);
    drawFrame(x2);
    drawCallouts(x2, 1);
    const hy = oy - px(11);
    setFont();
    ctx.textAlign = 'left';
    ctx.fillStyle = BRAND.dim;
    ctx.fillText('BEFORE', ox, hy);
    ctx.fillText(L.narrow ? 'AFTER' : 'AFTER SUBTRACTION', x2, hy);
    readoutRight(ox + imgW, hy, '', EPOCHS[1].date);
    readoutRight(x2 + imgW, hy, L.narrow ? '' : 'λ', `${EPOCHS[1].wave} µm`);
    const fy = oy + imgH + px(20);
    drawScaleBar(ox, fy);
    ctx.textAlign = 'right';
    ctx.fillStyle = BRAND.paper;
    ctx.fillText(L.narrow ? 'frame − predicted' : 'frame − predicted sky', x2 + imgW, fy);
  }

  function draw(t) {
    if (destroyed) return;
    if (!L) layout();
    if (!L) return;
    if (reduced) {
      if (lastSig !== 'static') drawStatic();
    } else {
      drawAnimated(t);
    }
  }

  function redraw() {
    layout();
    draw(task.time);
  }

  function applyMotion() {
    if (reduced) task.stop();
    else if (started) task.start();
    redraw();
  }

  // Follow size changes. ResizeObserver also fires once on observe, which draws the first frame.
  let ro = null;
  const onWinResize = () => redraw();
  if (typeof win.ResizeObserver === 'function') {
    ro = new win.ResizeObserver(() => redraw());
    ro.observe(canvas);
  } else if (win.addEventListener) {
    win.addEventListener('resize', onWinResize);
  }
  const offMotion = forced
    ? () => {}
    : onReducedMotionChange((v) => {
        reduced = v;
        applyMotion();
      }, win);

  if (!canvas.hasAttribute('role')) canvas.setAttribute('role', 'img');
  if (!canvas.hasAttribute('aria-label')) {
    canvas.setAttribute(
      'aria-label',
      'Animation: a patch of infrared sky blinks between two visits six months apart. One star hops and one changes brightness. ' +
        'Then the predicted sky is subtracted and only those two remain, labelled moved and varied.',
    );
  }
  redraw();

  return {
    start() {
      if (destroyed) return;
      started = true;
      if (!reduced) task.start();
      redraw();
    },
    stop() {
      started = false;
      task.stop();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      started = false;
      task.destroy();
      if (ro) ro.disconnect();
      else if (win.removeEventListener) win.removeEventListener('resize', onWinResize);
      offMotion();
    },
    /** Jump the loop to a time in seconds and draw it. */
    seek(seconds) {
      task.time = seconds;
      lastSig = '';
      draw(task.time);
    },
    redraw,
    get running() {
      return started && !reduced;
    },
  };
}
