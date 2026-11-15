// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// explain.js: short plain-language cards that explain what the tool is showing.
//
//   createExplainer(container) -> { show(topicId), hide() }
//   TOPICS                        [{ id, title, text: string[], alt, diagram() -> SVG markup }]
//
// Topic ids: 'flicker', 'passes', 'residual', 'ghosts', 'spectrum', 'lens', 'distance', 'flags',
// 'limits'. ('passes' and 'limits' are additions to the contract list.)
//
// The card is not modal: it sits at the side (a bottom sheet on phones) and the page stays usable.
// It has a close button, Escape closes it, focus returns to whatever opened it, and a "next" link
// walks through the topics in order. Every diagram is inline SVG generated here; no image files.
//
// Optional extras (not in the contract):
//   createExplainer(container, { onChange(topicId | null) })
//   returned object also has: isOpen(), current(), next(), destroy(), el
//   show() returns false for an unknown topic id instead of throwing
//   TOPIC_IDS, getTopic(id)
//   explainButton(explainer, topicId, label?) -> a small round "?" <button> that opens a topic
//   Placement on wide screens via CSS custom properties: --tbx-explain-top, --tbx-explain-right.

import {
  BRAND,
  clamp,
  mulberry32,
  gaussian,
  stampPsf,
  onEscape,
  SKY_LUT,
  skyStretch,
  RESIDUAL_LUT,
  residualIndex,
  rgbCss,
} from './fx.js';
import { injectStyles } from './experience.css.js';

// ---------------------------------------------------------------------------------------------
// Tiny SVG toolkit. All diagrams share one 320 x 132 viewBox.

const C = BRAND;
const MONO = "Consolas, 'SFMono-Regular', Menlo, 'DejaVu Sans Mono', 'Liberation Mono', monospace";
const r1 = (n) => Math.round(n * 10) / 10;
const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
const tag = (name, o, inner) => (inner === undefined ? `<${name} ${attrs(o)}/>` : `<${name} ${attrs(o)}>${inner}</${name}>`);
const text = (x, y, s, o = {}) =>
  tag('text', { x: r1(x), y: r1(y), fill: o.fill || C.dim, 'font-size': o.size || 9, 'text-anchor': o.anchor, transform: o.transform, opacity: o.opacity }, s);
const line = (x1, y1, x2, y2, o = {}) =>
  tag('line', { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), stroke: o.stroke || C.stone, 'stroke-width': o.w || 1, 'stroke-dasharray': o.dash, opacity: o.opacity });
const rect = (x, y, w, h, o = {}) =>
  tag('rect', { x: r1(x), y: r1(y), width: r1(w), height: r1(h), fill: o.fill || 'none', stroke: o.stroke, 'stroke-width': o.stroke ? o.w || 1 : undefined, 'stroke-dasharray': o.dash, opacity: o.opacity });
const circle = (cx, cy, r, o = {}) =>
  tag('circle', { cx: r1(cx), cy: r1(cy), r: r1(r), fill: o.fill || 'none', stroke: o.stroke, 'stroke-width': o.stroke ? o.w || 1 : undefined, 'stroke-dasharray': o.dash, opacity: o.opacity });
const path = (d, o = {}) =>
  tag('path', { d, fill: o.fill || 'none', stroke: o.stroke === null ? undefined : o.stroke || C.stone, 'stroke-width': o.w || 1, 'stroke-dasharray': o.dash, 'stroke-linejoin': 'round', opacity: o.opacity });
const arrowHead = (x, y, angleDeg, o = {}) => {
  const a = (angleDeg * Math.PI) / 180;
  const s = o.size || 4;
  const p = (da) => `${r1(x - s * Math.cos(a + da))},${r1(y - s * Math.sin(a + da))}`;
  return path(`M${p(0.45)} L${r1(x)},${r1(y)} L${p(-0.45)}`, { stroke: o.stroke || C.paper, w: o.w || 1 });
};
const svg = (label, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 132" role="img" aria-label="${label}" font-family="${MONO}">${body}</svg>`;

const skyCss = (v) => rgbCss(SKY_LUT, Math.round(skyStretch(v) * 255) * 3);
const resCss = (v) => rgbCss(RESIDUAL_LUT, residualIndex(v));

/**
 * A small pixelated image: n x n cells of `cell` units at (x0, y0).
 * sources: [{ x, y, flux, sigma? }] in cell coordinates, or { x, y, flux, pixel: true } for a
 * single-pixel defect. mode: 'sky' (a frame), 'res' (a residual), 'model' (a frame without noise).
 */
function patch(x0, y0, n, cell, { seed = 1, sources = [], mode = 'sky', noise = 0.75 } = {}) {
  const img = new Float32Array(n * n);
  for (const s of sources) {
    if (s.pixel) img[Math.floor(s.y) * n + Math.floor(s.x)] += s.flux;
    else stampPsf(img, n, n, s.x, s.y, s.flux, s.sigma || 0.62);
  }
  const rand = mulberry32(seed);
  const colour = mode === 'res' ? resCss : skyCss;
  let out = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = img[y * n + x] + (mode === 'model' ? 0 : gaussian(rand) * noise);
      out += `<rect x="${r1(x0 + x * cell)}" y="${r1(y0 + y * cell)}" width="${cell}" height="${cell}" fill="${colour(v)}"/>`;
    }
  }
  return `<g shape-rendering="crispEdges">${out}</g>` + rect(x0 - 0.5, y0 - 0.5, n * cell + 1, n * cell + 1, { stroke: C.stone, opacity: 0.9 });
}

// ---------------------------------------------------------------------------------------------
// Diagrams

function diagramFlicker() {
  let b = '';
  // the detector, with the filter's colour changing down it
  const bands = 12;
  const mix = (a, c, t) => a.map((v, i) => Math.round(v + (c[i] - v) * t));
  const cold = [75, 143, 219];
  const paper = [247, 242, 231];
  const hot = [229, 60, 39];
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const rgb = t < 0.5 ? mix(cold, paper, t * 2) : mix(paper, hot, t * 2 - 1);
    b += rect(14, 16 + i * 8, 96, 8, { fill: `rgb(${rgb.join(',')})`, opacity: 0.5 });
  }
  b += rect(13.5, 15.5, 97, 97, { stroke: C.stone });
  b += text(62, 124, 'one detector', { anchor: 'middle' });
  b += text(116, 23, '1.1 µm');
  b += text(116, 111, '1.6 µm');
  b += line(128, 30, 128, 98, { opacity: 0.7 });
  b += arrowHead(128, 99, 90, { stroke: C.stone });
  // the same star lands in two places
  const spots = [
    [42, 36, 16, 'exposure 1', '1.21 µm', 150],
    [84, 92, 76, 'exposure 2', '1.52 µm', 48],
  ];
  spots.forEach(([sx, sy, py, name, wave, flux], i) => {
    b += circle(sx, sy, 3, { fill: C.ink });
    b += circle(sx, sy, 5.5, { stroke: C.ink, w: 1.4 });
    b += path(`M${sx + 7},${sy} L170,${sy} L186,${py + 21}`, { stroke: C.paper, dash: '2 2', opacity: 0.75 });
    b += patch(190, py, 7, 6, { seed: 11 + i, sources: [{ x: 3.5, y: 3.5, flux }] });
    b += text(240, py + 18, name, { fill: C.paper });
    b += text(240, py + 30, wave);
  });
  b += text(240, 128, 'same star', { size: 8.5 });
  return svg('One detector with a filter whose color changes from top to bottom. The same star lands on two different rows in two exposures, so it is recorded at 1.21 and 1.52 micrometres and looks brighter in one than the other.', b);
}

function diagramPasses() {
  let b = '';
  const rand = mulberry32(61210);
  const visits = [
    [58, '2025 Jun'],
    [160, '2025 Dec'],
    [262, '2026 Jun'],
  ];
  b += text(160, 14, 'each visit: many exposures, combined into one image', { anchor: 'middle' });
  b += line(14, 86, 306, 86);
  visits.forEach(([cx, label], i) => {
    for (let k = 0; k < 15; k++) {
      const x = cx - 24 + rand() * 48;
      b += line(x, 72, x, 86, { stroke: C.paper, opacity: 0.55 + rand() * 0.4 });
    }
    b += path(`M${cx - 28},66 L${cx - 28},60 L${cx + 28},60 L${cx + 28},66`, { stroke: C.paper });
    b += line(cx, 60, cx, 52, { stroke: C.paper });
    b += rect(cx - 9, 32, 18, 18, { fill: C.paper, opacity: 0.12 });
    b += rect(cx - 9, 32, 18, 18, { stroke: C.paper });
    b += circle(cx - 3 + i * 2.6, 44 - i * 2, 2, { fill: C.paper });
    b += text(cx, 100, label, { anchor: 'middle', fill: C.paper });
  });
  for (const mid of [109, 211]) {
    b += line(mid - 34, 116, mid + 34, 116, { opacity: 0.8 });
    b += arrowHead(mid - 35, 116, 180, { stroke: C.stone });
    b += arrowHead(mid + 35, 116, 0, { stroke: C.stone });
    b += rect(mid - 27, 110, 54, 12, { fill: C.ink });
    b += text(mid, 119, '6 months', { anchor: 'middle' });
  }
  return svg('A timeline with three clusters of exposures, in June 2025, December 2025 and June 2026. Each cluster is combined into one image; a dot in the image sits in a slightly different place each time.', b);
}

function diagramResidual() {
  const n = 11;
  const cell = 7;
  const y = 16;
  const stat = [
    { x: 2.0, y: 2.0, flux: 70 },
    { x: 8.6, y: 2.2, flux: 26 },
    { x: 1.6, y: 8.9, flux: 34 },
    { x: 9.4, y: 5.4, flux: 110 },
  ];
  const a = { x: 3.3, y: 6.0 };
  const bpos = { x: 5.0, y: 4.9 };
  const v = { x: 6.9, y: 8.5 };
  let b = '';
  b += patch(14, y, n, cell, { seed: 5, sources: [...stat, { ...bpos, flux: 80 }, { ...v, flux: 95 }] });
  b += patch(121.5, y, n, cell, { mode: 'model', sources: [...stat, { ...a, flux: 40 }, { ...bpos, flux: 40 }, { ...v, flux: 55 }] });
  b += patch(229, y, n, cell, { seed: 9, mode: 'res', sources: [{ ...bpos, flux: 40 }, { ...a, flux: -40 }, { ...v, flux: 40 }] });
  b += text(106.2, y + 44, '−', { anchor: 'middle', fill: C.paper, size: 15 });
  b += text(213.7, y + 44, '=', { anchor: 'middle', fill: C.paper, size: 15 });
  b += text(52.5, 108, 'this frame', { anchor: 'middle', fill: C.paper });
  b += text(160, 108, 'predicted sky', { anchor: 'middle', fill: C.paper });
  b += text(267.5, 108, 'residual', { anchor: 'middle', fill: C.paper });
  b += text(52.5, 120, 'one color, one date', { anchor: 'middle', size: 8 });
  b += text(160, 120, 'from every visit', { anchor: 'middle', size: 8 });
  b += text(267.5, 120, 'only what changed', { anchor: 'middle', size: 8 });
  return svg('Three small images: this frame, minus the predicted sky, equals the residual. In the residual the steady stars are gone; a red and blue pair marks a star that moved and a single red dot marks one that brightened.', b);
}

function diagramGhosts() {
  const n = 9;
  const cell = 8;
  const y = 12;
  const xs = [18, 124, 230];
  const centre = (x0) => [x0 + 4.5 * cell, y + 4.5 * cell];
  let b = '';
  // in its ring
  b += patch(xs[0], y, n, cell, { seed: 21, sources: [{ x: 4.5, y: 4.5, flux: 120 }] });
  b += circle(...centre(xs[0]), 13, { stroke: C.signal, w: 1.3 });
  // left its ring
  b += patch(xs[1], y, n, cell, { seed: 22, sources: [{ x: 6.4, y: 2.7, flux: 120 }] });
  b += circle(...centre(xs[1]), 13, { stroke: C.signal, w: 1.3 });
  b += line(xs[1] + 4.5 * cell + 6, y + 4.5 * cell - 6, xs[1] + 6.4 * cell - 6, y + 2.7 * cell + 6, { stroke: C.paper, dash: '2 2' });
  // no ring
  b += patch(xs[2], y, n, cell, { seed: 23, sources: [{ x: 4.5, y: 4.5, flux: 120 }] });
  const labels = [
    ['in its ring', 'as predicted'],
    ['left its ring', 'moved more'],
    ['no ring', 'not in Gaia'],
  ];
  xs.forEach((x0, i) => {
    b += text(x0 + 36, 100, labels[i][0], { anchor: 'middle', fill: C.paper });
    b += text(x0 + 36, 112, labels[i][1], { anchor: 'middle' });
  });
  return svg('Three cases. A star inside its red ring is where Gaia predicts. A star outside its ring has moved more than predicted. A star with no ring is not in the Gaia catalog.', b);
}

const SPEC_X = (wave) => 22 + ((wave - 0.75) / 4.25) * 274;
const FEATURES = [
  { wave: 3.05, name: 'water ice', width: 0.15, depth: 0.5 },
  { wave: 3.3, name: 'methane', width: 0.055, depth: 0.42 },
  { wave: 4.27, name: 'CO2', width: 0.05, depth: 0.7 },
  { wave: 4.67, name: 'CO', width: 0.045, depth: 0.45 },
];
const specModel = (wave) => {
  let f = 0.52 + 0.4 * Math.exp(-0.5 * ((wave - 1.5) / 1.1) ** 2) + 0.05 * (wave - 0.75);
  for (const ft of FEATURES) f *= 1 - ft.depth * Math.exp(-0.5 * ((wave - ft.wave) / ft.width) ** 2);
  return f;
};

function diagramSpectrum() {
  let b = '';
  const y0 = 104;
  const yTop = 34;
  const Y = (f) => y0 - f * (y0 - yTop);
  // detector bands, alternately shaded
  const edges = [0.75, 1.1, 1.63, 2.42, 3.83, 4.42, 5.0];
  for (let d = 0; d < 6; d++) {
    if (d % 2 === 1) b += rect(SPEC_X(edges[d]), yTop - 4, SPEC_X(edges[d + 1]) - SPEC_X(edges[d]), y0 - yTop + 4, { fill: C.paper, opacity: 0.045 });
  }
  b += line(22, y0, 296, y0);
  for (let w = 1; w <= 5; w++) {
    b += line(SPEC_X(w), y0, SPEC_X(w), y0 + 3);
    b += text(SPEC_X(w), y0 + 13, w === 5 ? '5 µm' : String(w), { anchor: 'middle' });
  }
  b += text(9, 70, 'brightness', { anchor: 'middle', transform: 'rotate(-90 9 70)', size: 8.5 });
  // features
  FEATURES.forEach((ft, i) => {
    const x = SPEC_X(ft.wave);
    const row = i % 2;
    const start = row === 1; // second-row labels read to the right of their line
    b += line(x, row ? 24 : 13, x, y0, { stroke: C.signal, opacity: 0.7, dash: '2 2' });
    b += text(start ? x + 3 : x - 3, row ? 22 : 11, `${ft.name} ${ft.wave}`, { anchor: start ? 'start' : 'end', fill: C.paper, size: 8 });
  });
  // one point per exposure
  const rand = mulberry32(102);
  for (let i = 0; i < 102; i++) {
    const wave = 0.78 + (i / 101) * 4.19 + (rand() - 0.5) * 0.02;
    const f = specModel(wave) + gaussian(rand) * 0.018;
    b += circle(SPEC_X(wave), Y(f), 1.25, { fill: C.paper, opacity: 0.92 });
  }
  return svg('A spectrum from 0.75 to 5 micrometres built from about a hundred points, one per exposure. Dips are marked at 3.05 (water ice), 3.3 (methane), 4.27 (carbon dioxide) and 4.67 micrometres (carbon monoxide).', b);
}

function diagramLens() {
  let b = '';
  // a zoom on one absorption band
  const X = (u) => 16 + u * 132;
  const Y = (f) => 92 - f * 58;
  const f = (u) => 0.86 - 0.08 * u - 0.6 * Math.exp(-0.5 * ((u - 0.5) / 0.075) ** 2);
  b += rect(X(0.08), 26, X(0.34) - X(0.08), 70, { fill: C.paper, opacity: 0.07 });
  b += rect(X(0.66), 26, X(0.92) - X(0.66), 70, { fill: C.paper, opacity: 0.07 });
  b += rect(X(0.4), 26, X(0.6) - X(0.4), 70, { fill: C.signal, opacity: 0.22 });
  b += text(X(0.21), 20, 'continuum', { anchor: 'middle', size: 8 });
  b += text(X(0.5), 20, 'band', { anchor: 'middle', size: 8, fill: C.paper });
  b += text(X(0.79), 20, 'continuum', { anchor: 'middle', size: 8 });
  let d = '';
  for (let i = 0; i <= 60; i++) d += `${i ? 'L' : 'M'}${r1(X(i / 60))},${r1(Y(f(i / 60)))}`;
  b += path(d, { stroke: C.paper, w: 1.4 });
  b += line(16, 96, 148, 96);
  b += text(16, 114, 'depth = 1 − band / continuum', { fill: C.paper });
  // arrow to the image
  b += line(160, 62, 186, 62, { stroke: C.paper });
  b += arrowHead(187, 62, 0);
  // the lens image: only the absorber lights up
  const n = 11;
  const cell = 8;
  const x0 = 202;
  const y0 = 16;
  const img = new Float32Array(n * n);
  stampPsf(img, n, n, 6.5, 4.5, 1, 0.62);
  const rand = mulberry32(33);
  let cells = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const t = clamp(img[y * n + x] * 2.7 + rand() * 0.035);
      const c = [18, 18, 16].map((v, i) => Math.round(v + ([229, 60, 39][i] - v) * t));
      cells += `<rect x="${x0 + x * cell}" y="${y0 + y * cell}" width="${cell}" height="${cell}" fill="rgb(${c.join(',')})"/>`;
    }
  }
  b += `<g shape-rendering="crispEdges">${cells}</g>` + rect(x0 - 0.5, y0 - 0.5, n * cell + 1, n * cell + 1, { stroke: C.stone });
  for (const [sx, sy] of [[2.5, 2.5], [8.5, 8.5], [3, 8.2]]) b += circle(x0 + sx * cell, y0 + sy * cell, 5, { stroke: C.stone, dash: '1.5 2' });
  b += text(x0 + 44, 118, 'ordinary stars stay dark', { anchor: 'middle', size: 8 });
  return svg('Left: a spectrum with one absorption band shaded and the continuum on either side marked; depth is one minus band over continuum. Right: an image colored by that depth, where one source glows and ordinary stars, shown as dotted rings, stay dark.', b);
}

function diagramDistance() {
  let b = '';
  const sun = [54, 64];
  const R = 30;
  const body = [196, 64];
  const wall = 292;
  b += circle(sun[0], sun[1], R, { stroke: C.stone, dash: '2 3' });
  b += circle(sun[0], sun[1], 4, { fill: C.paper });
  b += text(sun[0] + 8, sun[1] + 3, 'Sun');
  const earths = [
    [sun[0], sun[1] - R, 'Jun'],
    [sun[0], sun[1] + R, 'Dec'],
  ];
  // background sky
  b += line(wall, 16, wall, 112);
  for (const sy of [22, 37, 59, 71, 93, 106]) b += circle(wall, sy, 1.4, { fill: C.dim });
  for (const [ex, ey, label] of earths) {
    const slope = (body[1] - ey) / (body[0] - ex);
    const hitY = body[1] + slope * (wall - body[0]);
    b += line(ex, ey, wall, hitY, { stroke: C.paper, opacity: 0.7, w: 0.8 });
    b += circle(ex, ey, 2.6, { fill: C.cold });
    b += text(ex - 6, ey + (ey < sun[1] ? -4 : 11), `Earth, ${label}`, { anchor: 'start', size: 8.5 });
    b += circle(wall, hitY, 3, { stroke: C.signal, w: 1.3 });
    b += text(wall + 6, hitY + 3, label, { fill: C.paper, size: 8.5 });
  }
  // baseline
  b += line(8, sun[1] - R, 8, sun[1] + R, { stroke: C.dim });
  b += line(5, sun[1] - R, 11, sun[1] - R, { stroke: C.dim });
  b += line(5, sun[1] + R, 11, sun[1] + R, { stroke: C.dim });
  b += text(18, sun[1], '2 AU', { size: 8.5, anchor: 'middle', transform: `rotate(-90 18 ${sun[1]})` });
  // the body
  b += circle(body[0], body[1], 3.2, { fill: C.signal });
  b += text(body[0], body[1] - 12, 'body at 500 AU', { anchor: 'middle', fill: C.paper });
  b += text(wall - 6, 126, 'seen 14 arcmin apart against the stars', { anchor: 'end' });
  return svg('Seen from above: Earth in June and in December sits on opposite sides of the Sun, 2 AU apart. Lines of sight from the two positions through a body at 500 AU reach the background stars 14 arcminutes apart.', b);
}

function diagramFlags() {
  const n = 13;
  const cell = 8;
  const x0 = 14;
  const y0 = 14;
  const streak = [
    [1, 5],
    [2, 4],
    [3, 3],
    [4, 2],
    [5, 1],
    [6, 0],
  ];
  const cosmic = [3, 10];
  const hot = [10, 8];
  let b = patch(x0, y0, n, cell, {
    seed: 44,
    sources: [
      { x: 7.5, y: 6.5, flux: 150 },
      { x: 11.4, y: 2.5, flux: 30 },
      ...streak.map(([x, y]) => ({ x, y, flux: 9, pixel: true })),
      { x: cosmic[0], y: cosmic[1], flux: 70, pixel: true },
      { x: hot[0], y: hot[1], flux: 30, pixel: true },
    ],
  });
  const mark = ([x, y]) => rect(x0 + x * cell + 0.5, y0 + y * cell + 0.5, cell - 1, cell - 1, { stroke: C.signal, w: 1.2 });
  for (const c of [...streak, cosmic, hot]) b += mark(c);
  const lead = (cx, cy, ty, label) => {
    const px = x0 + (cx + 1) * cell + 1;
    const py = y0 + cy * cell + cell / 2;
    return path(`M${px},${py} L${px + 8},${py} L140,${ty - 3} L146,${ty - 3}`, { stroke: C.dim, w: 0.8 }) + text(150, ty, label, { fill: C.paper });
  };
  b += lead(6, 0, 24, 'satellite streak');
  b += lead(hot[0], hot[1], 88, 'hot pixel');
  b += lead(cosmic[0], cosmic[1], 104, 'cosmic ray hit');
  b += rect(150, 42, 7, 7, { stroke: C.signal, w: 1.2 });
  b += text(162, 49, '= flagged, left out of');
  b += text(162, 60, '  fits and stacks');
  return svg('A small image with one star. Pixels outlined in red are flagged: a diagonal satellite streak, one hot pixel and one cosmic ray hit. Flagged pixels are left out of fits and stacks.', b);
}

function diagramLimits() {
  let b = '';
  const cell = 30;
  const x0 = 14;
  const y0 = 14;
  for (let i = 0; i <= 5; i++) b += line(x0 + i * cell, y0, x0 + i * cell, y0 + 3 * cell, { opacity: 0.6 });
  for (let j = 0; j <= 3; j++) b += line(x0, y0 + j * cell, x0 + 5 * cell, y0 + j * cell, { opacity: 0.6 });
  const p1 = [x0 + 2.42 * cell, y0 + 1.95 * cell];
  const p2 = [p1[0] - 0.09 * cell, p1[1] - 0.845 * cell];
  b += circle(p1[0], p1[1], 12, { stroke: C.dim, dash: '2.5 2.5' });
  b += circle(p2[0], p2[1], 13, { fill: C.paper, opacity: 0.2 });
  b += circle(p2[0], p2[1], 7.5, { fill: C.paper, opacity: 0.45 });
  b += circle(p2[0], p2[1], 3, { fill: C.paper });
  b += line(p1[0], p1[1], p2[0] + 0.6, p2[1] + 5.5, { stroke: C.signal, w: 1.3 });
  b += arrowHead(p2[0] + 0.5, p2[1] + 4.5, -96, { stroke: C.signal, w: 1.3 });
  b += circle(p1[0], p1[1], 1.6, { fill: C.dim });
  // pixel size
  b += line(x0, 114, x0 + cell, 114, { stroke: C.paper });
  b += line(x0, 111, x0, 117, { stroke: C.paper });
  b += line(x0 + cell, 111, x0 + cell, 117, { stroke: C.paper });
  b += text(x0 + cell + 6, 117, '1 pixel = 6.15″', { fill: C.paper });
  // the numbers
  b += text(174, 24, "Barnard's Star", { fill: C.paper });
  b += text(174, 37, '10.4″ per year');
  b += text(174, 49, '= 1.7 pixels per year');
  b += text(174, 61, '= 0.85 pixel per visit');
  // what the residual shows
  b += patch(174, 74, 6, 7, { seed: 77, mode: 'res', sources: [{ x: 3.1, y: 2.4, flux: 42 }, { x: 2.9, y: 3.6, flux: -42 }] });
  b += text(222, 91, 'in the residual:', { size: 8 });
  b += text(222, 103, 'a pair, not a streak', { fill: C.paper, size: 8 });
  return svg("A pixel grid. Barnard's Star moves 0.85 of one 6.15 arcsecond pixel between visits six months apart, so it shows as a small shift and, in the residual, as a red and blue pair rather than a streak.", b);
}

// ---------------------------------------------------------------------------------------------
// Topics

/** @type {ReadonlyArray<{ id: string, title: string, text: string[], alt?: string, diagram: () => string }>} */
export const TOPICS = Object.freeze([
  {
    id: 'flicker',
    title: 'Why a plain blink flickers',
    text: [
      'SPHEREx has no filter wheel. A linear variable filter sits over each detector, so the color a source is recorded in depends on where it lands.',
      'Every exposure puts your spot on a different part of the filter. Blink two frames and everything changes brightness, because the color changed and the sky did not.',
    ],
    diagram: diagramFlicker,
  },
  {
    id: 'passes',
    title: 'Visits, six months apart',
    text: [
      'SPHEREx returns to each patch of sky about every six months and takes a run of exposures as it passes. The data begin in May 2025.',
      'Tombaugh combines the frames from one visit into one image, so blinking between visits compares the sky half a year apart.',
    ],
    diagram: diagramPasses,
  },
  {
    id: 'residual',
    title: 'Predicted-sky subtraction',
    text: [
      'Tombaugh fits a smooth spectrum to every pixel using all visits, then predicts what the unchanging sky should look like in each frame’s color and subtracts it.',
      'Stars that stay put cancel to flat noise. Something that moved leaves a dark and bright pair side by side. Something that varied pulses in place.',
    ],
    diagram: diagramResidual,
  },
  {
    id: 'ghosts',
    title: 'Ghost rings',
    text: [
      'Each ring marks where Gaia predicts a star should be on that frame’s date, with its proper motion and parallax applied.',
      'A star sitting in its ring is behaving. A star that has left its ring moved more than predicted, and a star with no ring is not in Gaia at all.',
    ],
    diagram: diagramGhosts,
  },
  {
    id: 'spectrum',
    title: 'One color per exposure',
    text: [
      'Each exposure measures a source in a single color. More than 100 exposures, each at a different wavelength, add up to a spectrum from 0.75 to 5 µm.',
      'Dips mark molecules: water ice at 3.05 µm, methane at 3.3, carbon dioxide at 4.27 and carbon monoxide at 4.67.',
    ],
    diagram: diagramSpectrum,
  },
  {
    id: 'lens',
    title: 'Molecule lenses',
    text: [
      'A lens colors the image by how deep one molecule’s absorption is: the brightness inside the band compared with the continuum on either side.',
      'Sources that carry the molecule light up and ordinary stars stay dark. The methane lens picks out cold brown dwarfs, which have a deep notch at 3.3 µm.',
    ],
    diagram: diagramLens,
  },
  {
    id: 'distance',
    title: 'Focusing on a distance',
    text: [
      'SPHEREx looks about 90 degrees from the Sun, so visits six months apart view a nearby body from opposite sides of Earth’s orbit. It appears to hop against the stars: about 14 arcminutes at 500 AU.',
      'Shifting the frames by the parallax for a chosen distance brings bodies at that distance into focus and smears everything else.',
    ],
    diagram: diagramDistance,
  },
  {
    id: 'flags',
    title: 'Flagged pixels',
    text: [
      'The SPHEREx pipeline marks pixels it does not trust: cosmic ray hits, hot pixels, optical ghosts, satellite streaks. Tombaugh leaves them out of fits and stacks.',
      'Turn the overlay on when something looks odd. A discovery that sits on a flagged pixel is usually the detector, not the sky.',
    ],
    diagram: diagramFlags,
  },
  {
    id: 'limits',
    title: 'What the pixels can show',
    text: [
      'SPHEREx pixels are 6.15 arcseconds across. Barnard’s Star, the fastest in the sky, moves 10.4 arcseconds per year: about 1.7 pixels.',
      'So expect a shifted centroid and a subtraction dipole, not a streak. Slower stars move a fraction of a pixel and show only in the measured positions.',
    ],
    diagram: diagramLimits,
  },
]);

export const TOPIC_IDS = Object.freeze(TOPICS.map((t) => t.id));

/** Look up a topic by id; undefined if there is none. */
export const getTopic = (id) => TOPICS.find((t) => t.id === id);

// ---------------------------------------------------------------------------------------------
// The card

const ICON_CLOSE =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';

let uid = 0;

/**
 * @param {Element} container where the card element is appended (it positions itself: fixed)
 * @param {{ onChange?: (topicId: string|null) => void }} [opts]
 * @returns {{ show(topicId: string): boolean, hide(): void, isOpen(): boolean, current(): string|null, next(): void, destroy(): void, el: HTMLElement }}
 */
export function createExplainer(container, opts = {}) {
  const doc = container.ownerDocument || globalThis.document;
  injectStyles(doc);
  const id = `tbx-explain-${++uid}`;

  const root = doc.createElement('aside');
  root.className = 'tbx tbx-explain';
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute('aria-labelledby', `${id}-title`);

  const head = doc.createElement('div');
  head.className = 'tbx-explain__head';
  const counter = doc.createElement('span');
  counter.className = 'tbx-label';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'tbx-iconbtn';
  close.setAttribute('aria-label', 'Close explanation');
  close.innerHTML = ICON_CLOSE;
  head.append(counter, close);

  const title = doc.createElement('h2');
  title.className = 'tbx-explain__title';
  title.id = `${id}-title`;
  const fig = doc.createElement('div');
  fig.className = 'tbx-explain__fig';
  const body = doc.createElement('div');
  body.className = 'tbx-explain__body';
  const foot = doc.createElement('div');
  foot.className = 'tbx-explain__foot';
  const nextBtn = doc.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'tbx-explain__next';
  const hintEsc = doc.createElement('span');
  hintEsc.className = 'tbx-label';
  hintEsc.textContent = 'Esc closes';
  hintEsc.setAttribute('aria-hidden', 'true');
  foot.append(nextBtn, hintEsc);
  const live = doc.createElement('div');
  live.className = 'tbx-sr';
  live.setAttribute('aria-live', 'polite');

  root.append(head, title, fig, body, foot, live);
  container.appendChild(root);

  let open = false;
  let currentId = null;
  let opener = null;
  let releaseEscape = null;
  let hideTimer = null;

  function render(topic, announce) {
    const index = TOPICS.indexOf(topic);
    const following = TOPICS[(index + 1) % TOPICS.length];
    counter.textContent = `Explainer ${index + 1} of ${TOPICS.length}`;
    title.textContent = topic.title;
    fig.innerHTML = topic.diagram();
    body.textContent = '';
    for (const para of topic.text) {
      const p = doc.createElement('p');
      p.textContent = para;
      body.appendChild(p);
    }
    nextBtn.textContent = '';
    const lead = doc.createElement('span');
    lead.textContent = 'Next: ';
    const name = doc.createElement('b');
    name.textContent = following.title;
    const arrow = doc.createElement('i');
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');
    nextBtn.append(lead, name, arrow);
    nextBtn.dataset.topic = following.id;
    root.scrollTop = 0;
    if (announce) live.textContent = `${topic.title}. ${topic.text.join(' ')}`;
  }

  function show(topicId) {
    const topic = getTopic(topicId);
    if (!topic) {
      if (globalThis.console) globalThis.console.warn(`[tombaugh] no explainer topic "${topicId}"`);
      return false;
    }
    const wasOpen = open;
    if (!wasOpen) {
      const active = doc.activeElement;
      opener = active && active !== doc.body && !root.contains(active) ? active : null;
    }
    currentId = topic.id;
    render(topic, wasOpen);
    if (!wasOpen) {
      open = true;
      clearTimeout(hideTimer);
      root.hidden = false;
      void root.offsetWidth; // commit the starting state so the transition runs
      root.classList.add('is-open');
      releaseEscape = onEscape(hide, doc);
      root.focus({ preventScroll: true });
    }
    if (opts.onChange) opts.onChange(currentId);
    return true;
  }

  function hide() {
    if (!open) return;
    open = false;
    currentId = null;
    root.classList.remove('is-open');
    if (releaseEscape) releaseEscape();
    releaseEscape = null;
    const active = doc.activeElement;
    const focusInside = !active || active === doc.body || root.contains(active);
    hideTimer = setTimeout(() => {
      if (!open) root.hidden = true;
    }, 190);
    if (focusInside && opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    opener = null;
    live.textContent = '';
    if (opts.onChange) opts.onChange(null);
  }

  function next() {
    const index = TOPICS.findIndex((t) => t.id === currentId);
    show(TOPICS[(index + 1) % TOPICS.length].id);
  }

  close.addEventListener('click', hide);
  nextBtn.addEventListener('click', next);

  return {
    show,
    hide,
    next,
    isOpen: () => open,
    current: () => currentId,
    el: root,
    destroy() {
      hide();
      clearTimeout(hideTimer);
      root.remove();
    },
  };
}

/**
 * A small round "?" button that opens a topic. Give it to any control that deserves a "why".
 * @param {{ show(topicId: string): any }} explainer
 * @param {string} topicId
 * @param {string} [label] accessible name; defaults to "Explain: <topic title>"
 */
export function explainButton(explainer, topicId, label) {
  const doc = globalThis.document;
  injectStyles(doc);
  const topic = getTopic(topicId);
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'tbx tbx-whybtn';
  btn.textContent = '?';
  btn.setAttribute('aria-label', label || `Explain: ${topic ? topic.title : topicId}`);
  btn.addEventListener('click', () => explainer.show(topicId));
  return btn;
}
