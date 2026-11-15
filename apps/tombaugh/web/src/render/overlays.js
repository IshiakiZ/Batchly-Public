// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Vector overlays for the image viewer, drawn on a Canvas 2D context in CSS pixels. Everything is
// scale-independent: positions come from sky coordinates through `env.project`, sizes are in
// screen pixels. Thin lines get a dark halo so they stay legible over bright pixels and over the
// inverted-gray map.
//
// `env` (built by viewer.js) is:
//   { project(ra, dec) -> [u, v] | null,   canvas position of a sky position
//     k,            CSS pixels per grid pixel
//     arcsecPerPx,  arcsec per CSS pixel (0 when the grid has no sky scale)
//     rect: { x, y, size } }               the square viewport
// Nothing here touches the DOM at import time.

import { formatValue, mjdToIso } from './viewmath.js';

export const BRAND = { ink: '#171715', paper: '#F7F2E7', signal: '#E53C27', stone: '#77766E' };
export const FONT_MONO = 'Consolas, "SFMono-Regular", Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace';
export const FONT_SANS = 'Arial, Helvetica, sans-serif';

const TAU = Math.PI * 2;

export function rgba(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

const INK_BACK = rgba(BRAND.ink, 0.74);
const SIGNAL_TEXT = '#FFB4A6'; // Signal lightened until it reads as text on the Ink backdrop

/** Stroke the current path twice: a wider Ink under-stroke, then the colour. */
export function haloStroke(ctx, color, width = 1, halo = 0.62) {
  ctx.lineWidth = width + 2;
  ctx.strokeStyle = rgba(BRAND.ink, halo);
  ctx.stroke();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Fill the current path with a thin Ink outline behind it. */
function haloFill(ctx, color) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(BRAND.ink, 0.62);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Text with an Ink outline, for single letters and short labels placed directly on the image. */
export function haloText(ctx, text, x, y, color = BRAND.paper) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = rgba(BRAND.ink, 0.8);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Shorten text with an ellipsis until it fits maxWidth (uses the context's current font). */
export function fitText(ctx, text, maxWidth) {
  text = String(text);
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}...`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}...` : '';
}

function tagBox(ctx, text, x, y, opts) {
  const { align = 'left', valign = 'middle', size = 11, bold = false, within = null } = opts;
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT_MONO}`;
  const padX = 5;
  const h = size + 7;
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  let bx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  let by = valign === 'top' ? y : valign === 'bottom' ? y - h : y - h / 2;
  if (within) {
    bx = Math.min(Math.max(bx, within.x + 2), within.x + within.size - w - 2);
    by = Math.min(Math.max(by, within.y + 2), within.y + within.size - h - 2);
  }
  return { x: Math.round(bx), y: Math.round(by), w, h, padX };
}

/**
 * A small label on an Ink backdrop. (x, y) is the anchor; align 'left' | 'right' | 'center',
 * valign 'middle' | 'top' | 'bottom'. The tag is nudged to stay inside `within` when given.
 * Returns the backdrop box.
 */
export function drawTag(ctx, text, x, y, opts = {}) {
  const box = tagBox(ctx, text, x, y, opts);
  ctx.fillStyle = INK_BACK;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = opts.color || BRAND.paper;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, box.x + box.padX, box.y + box.h / 2 + 0.5);
  return box;
}

const overlaps = (a, b) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2;

/**
 * Draw a tag at the first of several candidate anchors ([{ x, y, align, valign }]) that lies
 * inside the viewport and does not cover a tag already placed in this frame (env.placed).
 * When every anchor is taken the tag goes to the first one anyway, unless `opts.optional` is set:
 * then it is dropped (returns null), which is what date labels along a short trail want.
 */
export function placeTag(ctx, env, text, anchors, opts = {}) {
  if (!env.placed) env.placed = [];
  const r = env.rect;
  let pick = opts.optional ? null : anchors[0];
  for (const a of anchors) {
    const b = tagBox(ctx, text, a.x, a.y, { ...opts, ...a });
    const inside = b.x >= r.x + 2 && b.y >= r.y + 2 && b.x + b.w <= r.x + r.size - 2 && b.y + b.h <= r.y + r.size - 2;
    if (inside && !env.placed.some((p) => overlaps(b, p))) {
      pick = a;
      break;
    }
  }
  if (!pick) return null;
  const box = drawTag(ctx, text, pick.x, pick.y, { ...opts, ...pick, within: r });
  env.placed.push(box);
  return box;
}

function inView(env, p, margin = 0) {
  const r = env.rect;
  return p[0] >= r.x - margin && p[0] <= r.x + r.size + margin && p[1] >= r.y - margin && p[1] <= r.y + r.size + margin;
}

// ---------------------------------------------------------------------------------------------
// Gaia "ghost rings": where the catalogue says a star should be.

/** Ring radius in CSS pixels: about 7 arcsec on the sky (one PSF width), kept between 6 and 72 px. */
export function ringRadius(env, star) {
  const arcsec = star && Number.isFinite(star.radius) ? star.radius : 7;
  const px = env.arcsecPerPx > 0 ? arcsec / env.arcsecPerPx : 9;
  return Math.min(72, Math.max(6, px));
}

/** Index of the ring under canvas position (u, v), or -1. The nearest centre wins. */
export function hitGaia(env, stars, u, v) {
  let best = -1;
  let bestD = Infinity;
  if (!stars) return best;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (!s) continue;
    const p = env.project(s.ra, s.dec);
    if (!p || !inView(env, p)) continue;
    const d = Math.hypot(p[0] - u, p[1] - v);
    if (d <= ringRadius(env, s) + 4 && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/**
 * stars: [{ ra, dec, label?, moved?, to?: { ra, dec }, radius? (arcsec) }]
 * Thin Paper circles with a small gap. `moved` ones are Signal, and when `to` is given the gap
 * faces the measured position and a short line runs from the ring to it.
 */
export function drawGaia(ctx, env, stars, hoverIndex = -1) {
  if (!stars || !stars.length) return;
  ctx.save();
  ctx.lineCap = 'butt';
  const gap = 0.34;
  let hover = null;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (!s) continue;
    const p = env.project(s.ra, s.dec);
    if (!p || !inView(env, p, 40)) continue;
    const r = ringRadius(env, s);
    const moved = !!s.moved;
    const hot = i === hoverIndex;
    const color = moved ? BRAND.signal : rgba(BRAND.paper, hot ? 1 : 0.82);
    let ang = -Math.PI / 4;
    let q = null;
    if (s.to && Number.isFinite(s.to.ra) && Number.isFinite(s.to.dec)) {
      q = env.project(s.to.ra, s.to.dec);
      if (q && Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.5) ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    }
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, ang + gap, ang + TAU - gap);
    haloStroke(ctx, color, hot || moved ? 1.5 : 1);
    if (q && moved) {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d > r + 1.5) {
        ctx.beginPath();
        ctx.moveTo(p[0] + Math.cos(ang) * r, p[1] + Math.sin(ang) * r);
        ctx.lineTo(q[0], q[1]);
        haloStroke(ctx, color, 1.5);
      }
      ctx.beginPath();
      ctx.arc(q[0], q[1], 2.2, 0, TAU);
      haloFill(ctx, color);
    }
    if (hot) hover = { s, p, r };
  }
  if (hover && hover.s.label) {
    const { s, p, r } = hover;
    placeTag(
      ctx,
      env,
      String(s.label),
      [
        { x: p[0] + r + 7, y: p[1], align: 'left', valign: 'middle' },
        { x: p[0] - r - 7, y: p[1], align: 'right', valign: 'middle' },
        { x: p[0], y: p[1] - r - 6, align: 'center', valign: 'bottom' },
        { x: p[0], y: p[1] + r + 6, align: 'center', valign: 'top' },
      ],
      { color: s.moved ? SIGNAL_TEXT : BRAND.paper },
    );
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Markers

/** Boxes around the marker glyphs, so that labels drawn earlier (trail dates) keep clear of them. */
export function markerObstacles(env, markers) {
  const out = [];
  if (!markers) return out;
  for (const m of markers) {
    if (!m) continue;
    const p = env.project(m.ra, m.dec);
    if (p && inView(env, p, 30)) out.push({ x: p[0] - 10, y: p[1] - 10, w: 20, h: 20 });
  }
  return out;
}

/** markers: [{ ra, dec, kind: 'click' | 'candidate' | 'target', label? }] */
export function drawMarkers(ctx, env, markers) {
  if (!markers || !markers.length) return;
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  const labels = [];
  for (const m of markers) {
    if (!m) continue;
    const p = env.project(m.ra, m.dec);
    if (!p || !inView(env, p, 30)) continue;
    const u = Math.round(p[0]) + 0.5;
    const v = Math.round(p[1]) + 0.5;
    let labelDx = 12;
    let color = BRAND.paper;
    ctx.beginPath();
    if (m.kind === 'click') {
      const a = 5;
      const b = 13;
      ctx.moveTo(u - b, v); ctx.lineTo(u - a, v);
      ctx.moveTo(u + a, v); ctx.lineTo(u + b, v);
      ctx.moveTo(u, v - b); ctx.lineTo(u, v - a);
      ctx.moveTo(u, v + a); ctx.lineTo(u, v + b);
      haloStroke(ctx, color, 1);
      labelDx = 16;
    } else if (m.kind === 'candidate') {
      const d = 10;
      color = BRAND.signal;
      ctx.moveTo(u, v - d); ctx.lineTo(u + d, v); ctx.lineTo(u, v + d); ctx.lineTo(u - d, v);
      ctx.closePath();
      haloStroke(ctx, color, 1.5);
      labelDx = 14;
    } else if (m.kind === 'target') {
      const h = 13;
      const c = 5;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(u + sx * h, v + sy * (h - c));
        ctx.lineTo(u + sx * h, v + sy * h);
        ctx.lineTo(u + sx * (h - c), v + sy * h);
      }
      haloStroke(ctx, color, 1.25);
      labelDx = 17;
    } else {
      ctx.arc(u, v, 5, 0, TAU);
      haloStroke(ctx, color, 1);
    }
    if (m.label) labels.push({ m, u, v, d: labelDx });
  }
  for (const { m, u, v, d } of labels) {
    placeTag(
      ctx,
      env,
      String(m.label),
      [
        { x: u + d, y: v, align: 'left', valign: 'middle' },
        { x: u + d - 4, y: v + d, align: 'left', valign: 'middle' },
        { x: u + d - 4, y: v - d, align: 'left', valign: 'middle' },
        { x: u - d, y: v, align: 'right', valign: 'middle' },
        { x: u, y: v + d + 2, align: 'center', valign: 'top' },
        { x: u, y: v - d - 2, align: 'center', valign: 'bottom' },
      ],
      { color: m.kind === 'candidate' ? SIGNAL_TEXT : BRAND.paper },
    );
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Trail: where something has been (or should be), in time order.

/**
 * trail: [{ ra, dec, mjd?, label? }]. A polyline with a dot per point. Points carrying a `label`
 * (or an `mjd`, shown as a date, with the time when the trail spans under three days) get a tick
 * across the path and the text beside it; labels that would crowd are skipped, the first and
 * last are kept.
 */
export function drawTrail(ctx, env, trail) {
  if (!trail || !trail.length) return;
  const pts = [];
  for (const t of trail) {
    if (!t) continue;
    const p = env.project(t.ra, t.dec);
    if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push({ p, t });
  }
  if (!pts.length) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (pts.length > 1) {
    ctx.beginPath();
    ctx.moveTo(pts[0].p[0], pts[0].p[1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].p[0], pts[i].p[1]);
    haloStroke(ctx, rgba(BRAND.paper, 0.9), 1);
  }
  // path direction at each point, for ticks and label placement
  const normalAt = (i) => {
    const a = pts[Math.max(0, i - 1)].p;
    const b = pts[Math.min(pts.length - 1, i + 1)].p;
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-6)) return [0, -1];
    dx /= len;
    dy /= len;
    // perpendicular, chosen to point up-right-ish so labels sit on a consistent side
    let nx = -dy;
    let ny = dx;
    if (ny > 0 || (ny === 0 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    return [nx, ny];
  };
  // dates alone repeat when the whole trail spans a day or two: add the time then
  let lo = Infinity;
  let hi = -Infinity;
  for (const { t } of pts) {
    if (Number.isFinite(t.mjd)) {
      lo = Math.min(lo, t.mjd);
      hi = Math.max(hi, t.mjd);
    }
  }
  const withTime = hi - lo < 3;
  const textOf = (t) => {
    if (t.label !== undefined && t.label !== null) return String(t.label);
    if (!Number.isFinite(t.mjd)) return '';
    return withTime ? mjdToIso(t.mjd, true).slice(5) : mjdToIso(t.mjd);
  };
  const labels = [];
  let lastLabel = null;
  let lastText = '';
  const end = pts[pts.length - 1].p;
  for (let i = 0; i < pts.length; i++) {
    const { p, t } = pts[i];
    if (!inView(env, p, 20)) continue;
    const text = textOf(t);
    const ends = i === 0 || i === pts.length - 1;
    let show = false;
    if (text && text !== lastText) {
      show = ends || !lastLabel || Math.hypot(p[0] - lastLabel[0], p[1] - lastLabel[1]) >= 72;
      // keep room for the final label
      if (show && !ends && Math.hypot(p[0] - end[0], p[1] - end[1]) < 72) show = false;
    }
    const [nx, ny] = normalAt(i);
    if (show) {
      ctx.beginPath();
      ctx.moveTo(p[0] - nx * 5, p[1] - ny * 5);
      ctx.lineTo(p[0] + nx * 5, p[1] + ny * 5);
      haloStroke(ctx, BRAND.paper, 1);
      labels.push({ text, p, nx, ny });
      lastLabel = p;
      lastText = text;
    }
    ctx.beginPath();
    ctx.arc(p[0], p[1], ends ? 2.6 : 2, 0, TAU);
    haloFill(ctx, BRAND.paper);
  }
  // The newest date first, then the oldest, then the ones between: when the trail is short on
  // screen (a fast mover in a wide field) the labels that find no free spot, beside the path or a
  // little further out, are dropped instead of being drawn over one another.
  const order = labels.length > 1 ? [labels[labels.length - 1], labels[0], ...labels.slice(1, -1)] : labels;
  for (const l of order) {
    const side = (sign, dist) => ({
      x: l.p[0] + sign * l.nx * dist,
      y: l.p[1] + sign * l.ny * dist,
      align: sign * l.nx < -0.3 ? 'right' : sign * l.nx > 0.3 ? 'left' : 'center',
      valign: sign * l.ny < 0 ? 'bottom' : 'top',
    });
    placeTag(ctx, env, l.text, [side(1, 10), side(-1, 10), side(1, 26), side(-1, 26)], { size: 10, optional: true });
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Fixed furniture: compass, scale bar, centre crosshair, pixel grid, hatches

/** N-up, E-left arrows in the top-left corner of the viewport. */
export function drawCompass(ctx, rect) {
  const small = rect.size < 300;
  const len = small ? 16 : 22;
  const ox = Math.round(rect.x + 14 + 11 + len) + 0.5;
  const oy = Math.round(rect.y + 14 + 12 + len) + 0.5;
  const head = 4;
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(ox, oy - len + head);
  ctx.lineTo(ox, oy);
  ctx.lineTo(ox - len + head, oy);
  haloStroke(ctx, BRAND.paper, 1);
  ctx.beginPath();
  ctx.moveTo(ox, oy - len - 1);
  ctx.lineTo(ox - 3.5, oy - len + head + 1.5);
  ctx.lineTo(ox + 3.5, oy - len + head + 1.5);
  ctx.closePath();
  ctx.moveTo(ox - len - 1, oy);
  ctx.lineTo(ox - len + head + 1.5, oy - 3.5);
  ctx.lineTo(ox - len + head + 1.5, oy + 3.5);
  ctx.closePath();
  haloFill(ctx, BRAND.paper);
  ctx.font = `bold 10px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  haloText(ctx, 'N', ox, oy - len - 5);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  haloText(ctx, 'E', ox - len - 5, oy + 0.5);
  ctx.restore();
}

/** bar: { px, label } from pickScaleBar. Drawn in the bottom-right corner. Returns its width. */
export function drawScaleBar(ctx, rect, bar) {
  if (!bar || !(bar.px > 2)) return 0;
  const xr = Math.round(rect.x + rect.size - 12) + 0.5;
  const xl = Math.round(xr - bar.px) + 0.5;
  const y = Math.round(rect.y + rect.size - 15) + 0.5;
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(xl, y - 4);
  ctx.lineTo(xl, y + 4);
  ctx.moveTo(xl, y);
  ctx.lineTo(xr, y);
  ctx.moveTo(xr, y - 4);
  ctx.lineTo(xr, y + 4);
  haloStroke(ctx, BRAND.paper, 1);
  ctx.font = `11px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  haloText(ctx, bar.label, (xl + xr) / 2, y - 7);
  ctx.restore();
  return xr - xl;
}

/** Open reticle at canvas position (u, v): four ticks with a clear centre. */
export function drawCrosshair(ctx, u, v) {
  const x = Math.round(u) + 0.5;
  const y = Math.round(v) + 0.5;
  const a = 9;
  const b = 24;
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x - b, y); ctx.lineTo(x - a, y);
  ctx.moveTo(x + a, y); ctx.lineTo(x + b, y);
  ctx.moveTo(x, y - b); ctx.lineTo(x, y - a);
  ctx.moveTo(x, y + a); ctx.lineTo(x, y + b);
  haloStroke(ctx, rgba(BRAND.paper, 0.85), 1, 0.5);
  ctx.restore();
}

/** Pixel boundaries, faded in as cells grow past about 14 CSS pixels. `img` is the image rect. */
export function drawPixelGrid(ctx, rect, img, k, n) {
  const alpha = Math.min(1, (k - 14) / 14) * 0.16;
  if (!(alpha > 0.005)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.size, rect.size);
  ctx.clip();
  ctx.beginPath();
  const i0 = Math.max(0, Math.floor((rect.x - img.x) / k));
  const i1 = Math.min(n, Math.ceil((rect.x + rect.size - img.x) / k));
  for (let i = i0; i <= i1; i++) {
    const x = Math.round(img.x + i * k) + 0.5;
    ctx.moveTo(x, rect.y);
    ctx.lineTo(x, rect.y + rect.size);
  }
  const j0 = Math.max(0, Math.floor((rect.y - img.y) / k));
  const j1 = Math.min(n, Math.ceil((rect.y + rect.size - img.y) / k));
  for (let j = j0; j <= j1; j++) {
    const y = Math.round(img.y + j * k) + 0.5;
    ctx.moveTo(rect.x, y);
    ctx.lineTo(rect.x + rect.size, y);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(BRAND.paper, alpha);
  ctx.stroke();
  ctx.restore();
}

/**
 * Hatch a set of grid pixels. `path` is a Path2D in display-grid units (1 unit = 1 pixel, origin
 * at the top-left of the image); `img` is the image rect and k the cell size in CSS pixels.
 * style: { color, alpha, tint, spacing, dir (+1 "/" or -1 "\"), width }
 */
export function drawRegionHatch(ctx, rect, img, k, path, style) {
  if (!path) return;
  const { color = BRAND.stone, alpha = 0.5, tint = 0, spacing = 6, dir = 1, width = 1 } = style || {};
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.size, rect.size);
  ctx.clip();
  ctx.translate(img.x, img.y);
  ctx.scale(k, k);
  ctx.clip(path);
  ctx.scale(1 / k, 1 / k);
  ctx.translate(-img.x, -img.y);
  if (tint > 0) {
    ctx.fillStyle = rgba(color, tint);
    ctx.fillRect(rect.x, rect.y, rect.size, rect.size);
  }
  const s = rect.size;
  ctx.beginPath();
  for (let d = -s; d < s; d += spacing) {
    if (dir > 0) {
      ctx.moveTo(rect.x + d, rect.y + s);
      ctx.lineTo(rect.x + d + s, rect.y);
    } else {
      ctx.moveTo(rect.x + d, rect.y);
      ctx.lineTo(rect.x + d + s, rect.y + s);
    }
  }
  ctx.lineWidth = width;
  ctx.strokeStyle = rgba(color, alpha);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Caption, colourbar, loupe, flash, empty state

/**
 * Caption strip in the bottom-left corner: title / date and wavelength / note, Consolas on an Ink
 * backdrop. `lines` is [{ text | parts, color?, bold?, size? }]; `readout` an optional live line
 * shown above it.
 * Returns the height used.
 */
export function drawCaption(ctx, rect, lines, { maxWidth, readout = '' } = {}) {
  const pad = 10;
  const padX = 8;
  const padY = 6;
  const lh = 15;
  const limit = Math.max(60, (maxWidth || rect.size - 2 * pad) - padX * 2);
  const x = Math.round(rect.x + pad);
  let bottom = Math.round(rect.y + rect.size - pad);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let used = 0;
  // a line may carry `parts`: joined with a middle dot when that fits, else one part per line
  const shown = [];
  for (const l of lines || []) {
    if (!l) continue;
    if (l.parts) {
      const parts = l.parts.filter(Boolean);
      if (!parts.length) continue;
      ctx.font = `${l.bold ? 'bold ' : ''}${l.size || 11}px ${FONT_MONO}`;
      const joined = parts.join('  \u00b7  ');
      if (parts.length === 1 || ctx.measureText(joined).width <= limit) shown.push({ ...l, text: joined });
      else for (const part of parts) shown.push({ ...l, text: part });
    } else if (l.text) {
      shown.push(l);
    }
  }
  if (shown.length) {
    let w = 0;
    const fitted = shown.map((l) => {
      ctx.font = `${l.bold ? 'bold ' : ''}${l.size || 11}px ${FONT_MONO}`;
      const text = fitText(ctx, l.text, limit);
      w = Math.max(w, ctx.measureText(text).width);
      return { ...l, text, font: ctx.font };
    });
    const h = fitted.length * lh + padY * 2;
    const bw = Math.ceil(w) + padX * 2;
    ctx.fillStyle = INK_BACK;
    ctx.fillRect(x, bottom - h, bw, h);
    fitted.forEach((l, i) => {
      ctx.font = l.font;
      ctx.fillStyle = l.color || BRAND.paper;
      ctx.fillText(l.text, x + padX, bottom - h + padY + lh * i + lh / 2 + 0.5);
    });
    used = h;
    bottom -= h + 4;
  }
  if (readout) {
    ctx.font = `11px ${FONT_MONO}`;
    const text = fitText(ctx, readout, limit);
    const bw = Math.ceil(ctx.measureText(text).width) + padX * 2;
    const h = 20;
    ctx.fillStyle = INK_BACK;
    ctx.fillRect(x, bottom - h, bw, h);
    ctx.fillStyle = BRAND.paper;
    ctx.fillText(text, x + padX, bottom - h / 2 + 0.5);
    used += h + 4;
  }
  ctx.restore();
  return used;
}

/**
 * Slim vertical colourbar at the right edge, high values at the top.
 * bar: { lut: CanvasImageSource (1 px wide, top = high), vmin, vmax, diverging }
 */
export function drawColorbar(ctx, rect, bar) {
  if (!bar || !bar.lut || rect.size < 200) return;
  const w = 7;
  const h = Math.round(Math.min(190, Math.max(72, rect.size * 0.34)));
  const x = Math.round(rect.x + rect.size - 12 - w);
  const y = Math.round(rect.y + (rect.size - h) / 2);
  ctx.save();
  ctx.fillStyle = INK_BACK;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bar.lut, x, y, w, h);
  ctx.imageSmoothingEnabled = smooth;
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(BRAND.paper, 0.55);
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  if (bar.diverging) {
    const ym = Math.round(y + h / 2) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x - 5, ym);
    ctx.lineTo(x - 1, ym);
    haloStroke(ctx, BRAND.paper, 1);
    ctx.font = `10px ${FONT_MONO}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    haloText(ctx, '0', x - 8, ym + 0.5);
  }
  const xr = rect.x + rect.size - 10;
  drawTag(ctx, formatValue(bar.vmax), xr, y - 6, { align: 'right', valign: 'bottom', size: 10 });
  drawTag(ctx, formatValue(bar.vmin), xr, y + h + 6, { align: 'right', valign: 'top', size: 10 });
  ctx.restore();
}

/**
 * Magnified inset near the cursor.
 * l: { source (display-oriented n x n canvas), n, col, row (display row), u, v (cursor), text }
 */
export function drawLoupe(ctx, rect, l) {
  const cells = rect.size < 320 ? 9 : 11;
  const cell = rect.size < 320 ? 10 : 12;
  const size = cells * cell;
  const half = (cells - 1) / 2;
  const gap = 18;
  const labelH = l.text ? 19 : 0;
  let x = l.u + gap;
  let y = l.v + gap;
  if (x + size + 4 > rect.x + rect.size) x = l.u - gap - size;
  if (y + size + labelH + 4 > rect.y + rect.size) y = l.v - gap - size - labelH;
  x = Math.round(Math.max(rect.x + 4, x));
  y = Math.round(Math.max(rect.y + 4, y));
  ctx.save();
  ctx.fillStyle = BRAND.ink;
  ctx.fillRect(x - 1, y - 1, size + 2, size + labelH + 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  // draw the whole source scaled so that (col, row) lands on the centre cell; the clip does the cropping
  ctx.drawImage(l.source, x - (l.col - half) * cell, y - (l.row - half) * cell, l.n * cell, l.n * cell);
  ctx.restore();
  const c = x + half * cell;
  const r = y + half * cell;
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(BRAND.ink, 0.8);
  ctx.strokeRect(c - 0.5, r - 0.5, cell + 1, cell + 1);
  ctx.strokeStyle = BRAND.paper;
  ctx.strokeRect(c + 0.5, r + 0.5, cell - 1, cell - 1);
  ctx.strokeStyle = rgba(BRAND.paper, 0.7);
  ctx.strokeRect(x - 0.5, y - 0.5, size + 1, size + labelH + 1);
  if (l.text) {
    ctx.font = `11px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = BRAND.paper;
    ctx.fillText(fitText(ctx, l.text, size - 8), x + size / 2, y + size + labelH / 2 + 0.5);
  }
  ctx.restore();
}

/** Frame-edge outline in Signal, alpha 0..1. Used when a movie wraps around. */
export function drawFlash(ctx, rect, alpha) {
  if (!(alpha > 0)) return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(BRAND.signal, Math.min(1, alpha));
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.size - 2, rect.size - 2);
  ctx.restore();
}

/** Shown before any image arrives: a quiet reticle and one line of text. */
export function drawEmpty(ctx, rect, text) {
  const cx = Math.round(rect.x + rect.size / 2) + 0.5;
  const cy = Math.round(rect.y + rect.size / 2) + 0.5;
  ctx.save();
  ctx.strokeStyle = rgba(BRAND.stone, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, TAU);
  ctx.moveTo(cx - 30, cy); ctx.lineTo(cx - 8, cy);
  ctx.moveTo(cx + 8, cy); ctx.lineTo(cx + 30, cy);
  ctx.moveTo(cx, cy - 30); ctx.lineTo(cx, cy - 8);
  ctx.moveTo(cx, cy + 8); ctx.lineTo(cx, cy + 30);
  ctx.stroke();
  if (text) {
    ctx.font = `11px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = BRAND.stone;
    ctx.fillText(fitText(ctx, text, rect.size - 24), cx, cy + 42);
  }
  ctx.restore();
}
