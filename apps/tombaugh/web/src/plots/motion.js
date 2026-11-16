// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Motion meter: did this source move between survey passes, and does Gaia know about it?
// Left: the measured positions on the tangent plane (east left, north up, arcsec, equal aspect)
// with the fitted motion as an arrow. Right: measured proper motion against Gaia's as two
// aligned bars, with the direction of each as a small compass. Below: a one-line verdict.
//
// Contract API (unchanged):
//   createMotionMeter(container) -> { setData({ measured, gaia, track }), clear() }
//   measured = { pmra, pmdec, total, errTotal }  mas/yr (pmra includes cos dec)
//   gaia     = { pmra, pmdec, total } | null
//   track    = [{ mjd, dEast_arcsec, dNorth_arcsec, err_arcsec }]  offsets from the first position
//              (also accepted: [{ mjd, ra, dec, err_arcsec? }] in degrees, converted here)
//
// Optional extras:
//   setData({ ..., title })    names the source in the heading and the accessible label
//   getVerdict() -> the object returned by motionVerdict for the current data
//   destroy(), el (the root <figure>)
//   Pure helpers, usable without a DOM: motionVerdict(measured, gaia, { passes }),
//   normalizeTrack(track), passPositions(track), MOTION_EMPTY_TEXT, MOTION_FEW_TEXT.
//
// Colour: measured is Paper and Gaia is Stone. Signal is used only when the result is the thing
// that matters: motion with no Gaia star to explain it, or a clear disagreement with Gaia.
// "total" and "errTotal" are optional: total is recomputed from the components when missing.

import {
  PAPER, STONE, SIGNAL, INK,
  isNum, clamp, weightedMean, splitPasses, positionAngle,
  niceTicks, linearScale, formatTick, formatNumber, formatFixed, formatWithError,
  formatMonthYear, formatDayMonthYear, formatIsoDate,
  svgEl, htmlEl, clearNode, px, watchWidth, createTooltip, attachHover,
} from './svg.js';
import { ensurePlotStyles } from './plots.css.js';

export const MOTION_EMPTY_TEXT = 'Click a source in the image to measure its motion.';
export const MOTION_FEW_TEXT = 'Need at least two survey passes to measure motion.';

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** Track in arcsec offsets, sorted by time: [{ mjd, e, n, err }]. Accepts dEast/dNorth offsets
 * or ra/dec in degrees (offsets are then taken from the first position). */
export function normalizeTrack(track) {
  const list = (track || []).filter((t) => t && isNum(t.mjd)).slice().sort((a, b) => a.mjd - b.mjd);
  const out = [];
  let ref = null;
  for (const t of list) {
    let e;
    let n;
    if (isNum(t.dEast_arcsec) && isNum(t.dNorth_arcsec)) {
      e = t.dEast_arcsec;
      n = t.dNorth_arcsec;
    } else if (isNum(t.ra) && isNum(t.dec)) {
      if (!ref) ref = t;
      let dra = t.ra - ref.ra;
      if (dra > 180) dra -= 360;
      if (dra < -180) dra += 360;
      e = dra * Math.cos((ref.dec * Math.PI) / 180) * 3600;
      n = (t.dec - ref.dec) * 3600;
    } else {
      continue;
    }
    out.push({ mjd: t.mjd, e, n, err: isNum(t.err_arcsec) && t.err_arcsec > 0 ? t.err_arcsec : NaN });
  }
  return out;
}

/** One mean position per survey pass: [{ mjd, e, n, err, count, label }]. */
export function passPositions(track, gapDays = 45) {
  const groups = splitPasses(normalizeTrack(track), gapDays);
  const out = groups.map((g) => {
    const errs = g.map((p) => p.err);
    const me = weightedMean(g.map((p) => p.e), errs);
    const mn = weightedMean(g.map((p) => p.n), errs);
    let t = 0;
    for (const p of g) t += p.mjd;
    let err = Math.max(isNum(me.err) ? me.err : 0, isNum(mn.err) ? mn.err : 0);
    if (g.length === 1) err = isNum(g[0].err) ? g[0].err : NaN;
    return { mjd: t / g.length, e: me.mean, n: mn.mean, err: err > 0 ? err : NaN, count: g.length, label: '' };
  });
  const seen = new Map();
  for (const p of out) {
    p.label = formatMonthYear(p.mjd);
    seen.set(p.label, (seen.get(p.label) || 0) + 1);
  }
  for (const p of out) if (seen.get(p.label) > 1) p.label = formatDayMonthYear(p.mjd);
  return out;
}

function normalizePm(pm) {
  if (!pm || typeof pm !== 'object') return null;
  const pmra = isNum(pm.pmra) ? pm.pmra : NaN;
  const pmdec = isNum(pm.pmdec) ? pm.pmdec : NaN;
  let total = isNum(pm.total) ? Math.abs(pm.total) : NaN;
  if (!isNum(total) && isNum(pmra) && isNum(pmdec)) total = Math.hypot(pmra, pmdec);
  return { pmra, pmdec, total, errTotal: isNum(pm.errTotal) && pm.errTotal > 0 ? pm.errTotal : NaN };
}

/**
 * The one-line verdict.
 * @param {{ pmra:number, pmdec:number, total?:number, errTotal?:number }|null} measured mas/yr
 * @param {{ pmra:number, pmdec:number, total?:number }|null} gaia mas/yr, or null for no Gaia star
 * @param {{ passes?: number }} [opts] number of survey passes in the track, when known.
 *   A `gaia` object with source 'catalogue' is a published motion from the target table, for an
 *   object Gaia does not list; the sentence then says "the catalogue" instead of "Gaia".
 * @returns {{ kind:'few'|'agree'|'disagree'|'unexplained'|'static'|'measured', text:string,
 *   signal:boolean, sigma?:number, weak?:boolean, unit:'arcsec/yr'|'mas/yr' }}
 *   `weak` marks an agreement where the measurement alone is under 3 sigma.
 */
export function motionVerdict(measured, gaia, opts = {}) {
  const m = normalizePm(measured);
  if (!m || !isNum(m.total) || (isNum(opts.passes) && opts.passes < 2)) {
    return { kind: 'few', text: MOTION_FEW_TEXT, signal: false, unit: 'arcsec/yr' };
  }
  const g = normalizePm(gaia);
  const gaiaPm = !!g && isNum(g.total);
  const table = !!gaia && gaia.source === 'catalogue';
  const Says = table ? 'The catalogue says' : 'Gaia says';
  const says = table ? 'the catalogue says' : 'Gaia says';
  const hasErr = isNum(m.errTotal);
  // Quote arcsec/yr once anything on the line (value, Gaia, or the upper limit) reaches 0.1.
  const arcsec = Math.max(m.total + (hasErr ? 2 * m.errTotal : 0), gaiaPm ? g.total : 0) >= 100;
  const k = arcsec ? 1e-3 : 1;
  const unit = arcsec ? 'arcsec/yr' : 'mas/yr';
  const mv = formatWithError(m.total * k, hasErr ? m.errTotal * k : NaN);
  const significant = hasErr ? m.total >= 3 * m.errTotal : m.total > 0;

  if (!significant) {
    const upper = hasErr ? m.total + 2 * m.errTotal : NaN;
    // Short of a detection by itself, yet the size and direction a catalogue says it should
    // have, and that motion is large enough to show here: say both, and claim no more.
    if (hasErr && gaiaPm && m.total >= 2 * m.errTotal && g.total >= 2 * m.errTotal
      && isNum(m.pmra) && isNum(m.pmdec) && isNum(g.pmra) && isNum(g.pmdec)) {
      const diff = Math.hypot(m.pmra - g.pmra, m.pmdec - g.pmdec);
      if (diff <= 2 * m.errTotal) {
        const gv = mv.dec === null ? formatNumber(g.total * k, 4) : formatFixed(g.total * k, clamp(mv.dec + 1, 0, 4));
        return {
          kind: 'agree',
          weak: true,
          text: `Measured ${mv.text} ${unit}: ${(m.total / m.errTotal).toFixed(1)} sigma, short of a detection on its own. ${Says} ${gv}, in the same direction: consistent.`,
          signal: false,
          sigma: diff / m.errTotal,
          unit,
        };
      }
    }
    let text = hasErr
      ? `No motion detected: less than ${formatNumber(upper * k, 2)} ${unit} (2 sigma).`
      : 'No motion detected.';
    if (gaiaPm) {
      const gv = formatNumber(g.total * k, 2);
      if (!hasErr || g.total <= upper) {
        return { kind: 'static', text: `${text} ${Says} ${gv}: too small to see here.`, signal: false, unit };
      }
      return { kind: 'disagree', text: `${text} ${Says} ${gv}: that should have shown up.`, signal: true, unit };
    }
    if (g) text += ' Gaia has a star here but lists no motion for it.';
    return { kind: 'static', text, signal: false, unit };
  }

  const head = `Measured ${mv.text} ${unit}`;
  if (gaiaPm) {
    const gv = mv.dec === null ? formatNumber(g.total * k, 4) : formatFixed(g.total * k, clamp(mv.dec + 1, 0, 4));
    if (!hasErr) return { kind: 'measured', text: `${head}; ${says} ${gv}.`, signal: false, unit };
    const vector = isNum(m.pmra) && isNum(m.pmdec) && isNum(g.pmra) && isNum(g.pmdec);
    const diff = vector ? Math.hypot(m.pmra - g.pmra, m.pmdec - g.pmdec) : Math.abs(m.total - g.total);
    const sigma = diff / m.errTotal;
    if (sigma <= 3) {
      return {
        kind: 'agree',
        text: `${head}; ${says} ${gv}. Agreement within ${Math.max(0.1, sigma).toFixed(1)} sigma.`,
        signal: false,
        sigma,
        unit,
      };
    }
    return {
      kind: 'disagree',
      text: `${head}; ${says} ${gv}. They differ by ${sigma >= 10 ? Math.round(sigma) : sigma.toFixed(1)} sigma.`,
      signal: true,
      sigma,
      unit,
    };
  }
  if (g) {
    return { kind: 'measured', text: `${head}. Gaia has a star here but lists no motion for it.`, signal: false, unit };
  }
  return { kind: 'unexplained', text: `${head}. No Gaia star here: this motion is unexplained.`, signal: true, unit };
}

/** Break a sentence into lines of at most maxChars characters. */
export function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// The meter
// ---------------------------------------------------------------------------------------------

const TRACK_W = 256;
const TRACK_H = 240;
const COMPARE_H = 150;

function arrowHead(x, y, ux, uy, size) {
  const bx = x - ux * size;
  const by = y - uy * size;
  const wx = -uy * size * 0.5;
  const wy = ux * size * 0.5;
  return `M${px(x)} ${px(y)}L${px(bx + wx)} ${px(by + wy)}L${px(bx - wx)} ${px(by - wy)}Z`;
}

/** @param {HTMLElement} container */
export function createMotionMeter(container) {
  ensurePlotStyles(container.ownerDocument);
  const state = {
    measured: null, gaia: null, track: [], passes: [], title: '', hasData: false, width: 0,
    verdict: null, animate: false,
  };

  const root = htmlEl('figure', { class: 'tbp tbp-motion' });
  const head = htmlEl('div', { class: 'tbp-head' }, root);
  const titles = htmlEl('div', { class: 'tbp-titles' }, head);
  const titleEl = htmlEl('div', { class: 'tbp-title', text: 'Motion' }, titles);
  const subEl = htmlEl('div', { class: 'tbp-sub' }, titles);
  const body = htmlEl('div', { class: 'tbp-body' }, root);
  const grid = htmlEl('div', { class: 'tbp-motion-grid', role: 'img', 'aria-label': MOTION_EMPTY_TEXT }, body);
  const trackHost = htmlEl('div', { class: 'tbp-motion-track' }, grid);
  const trackSvg = svgEl('svg', { class: 'tbp-svg', 'aria-hidden': 'true' }, trackHost);
  const compareHost = htmlEl('div', { class: 'tbp-motion-compare' }, grid);
  const compareSvg = svgEl('svg', { class: 'tbp-svg', 'aria-hidden': 'true' }, compareHost);
  const tip = createTooltip(body);
  const foot = htmlEl('div', { class: 'tbp-foot' }, root);
  const legend = htmlEl('div', { class: 'tbp-legend' }, foot);
  const verdictEl = htmlEl('div', { class: 'tbp-verdict tbp-is-blank', role: 'status' }, foot);
  htmlEl('span', { class: 'tbp-verdict-mark', 'aria-hidden': 'true' }, verdictEl);
  const verdictText = htmlEl('span', {}, verdictEl);
  container.appendChild(root);

  let targets = [];
  let hoverLayer = null;

  const hover = attachHover(trackSvg, () => targets, (t) => {
    if (!hoverLayer) return;
    clearNode(hoverLayer);
    if (!t) {
      tip.hide();
      return;
    }
    svgEl('circle', { cx: px(t.x), cy: px(t.y), r: 7.5, fill: 'none', stroke: PAPER, 'stroke-width': 1.5 }, hoverLayer);
    const p = t.p;
    const lines = [
      { text: t.kind === 'pass' ? `${p.label}${p.count > 1 ? ` · mean of ${p.count}` : ''}` : formatIsoDate(p.mjd), cls: 'tbp-tip-head' },
      `${p.e >= 0 ? '+' : '−'}${Math.abs(p.e).toFixed(2)}″ east  ${p.n >= 0 ? '+' : '−'}${Math.abs(p.n).toFixed(2)}″ north`,
    ];
    if (isNum(p.err)) lines.push({ text: `± ${p.err.toFixed(2)}″`, cls: 'tbp-tip-dim' });
    const off = trackHost.offsetLeft || 0;
    const top = trackHost.offsetTop || 0;
    tip.show(lines, t.x + off, t.y + top);
  }, 22);

  // --- track plot -------------------------------------------------------------------------
  function renderTrack(W, narrow) {
    const Wt = narrow ? W : TRACK_W;
    trackSvg.setAttribute('viewBox', `0 0 ${Wt} ${TRACK_H}`);
    trackSvg.setAttribute('height', TRACK_H);
    clearNode(trackSvg);
    targets = [];
    hoverLayer = null;
    tip.hide();

    const side = Math.min(Wt - 58, TRACK_H - 44);
    const x0 = Math.round(Math.max(48, (Wt - side) / 2 + 19));
    const y0 = 8;
    const x1 = x0 + side;
    const y1 = y0 + side;
    const gAxes = svgEl('g', {}, trackSvg);
    svgEl('path', { d: `M${x0 + 0.5} ${y0}V${y1 + 0.5}H${x1}`, class: 'tbp-axis' }, gAxes);
    svgEl('text', { x: px((x0 + x1) / 2), y: TRACK_H - 5, 'text-anchor': 'middle', class: 'tbp-axis-title', text: 'Offset east (arcsec)' }, gAxes);
    svgEl('text', { x: 0, y: 0, transform: `translate(${x0 - 36} ${px((y0 + y1) / 2)}) rotate(-90)`, 'text-anchor': 'middle', class: 'tbp-axis-title', text: 'Offset north (arcsec)' }, gAxes);

    const pts = state.track;
    const passes = state.passes;
    if (!pts.length) {
      drawCompassRose(gAxes, x1 - 12, y0 + 30);
      return;
    }

    // Fitted motion line through the weighted centroid of the pass positions.
    const m = state.measured;
    const moving = !!state.verdict && state.verdict.kind !== 'few' && state.verdict.kind !== 'static';
    const fit = moving ? fittedLine(m) : null;
    const gaiaLine = fit && state.gaia && isNum(state.gaia.pmra) && isNum(state.gaia.pmdec)
      ? { e0: fit.e0, n0: fit.n0, e1: fit.e0 + (state.gaia.pmra / 1000) * fit.years, n1: fit.n0 + (state.gaia.pmdec / 1000) * fit.years }
      : null;

    // Equal-aspect extent around everything that will be drawn.
    let eMin = Infinity;
    let eMax = -Infinity;
    let nMin = Infinity;
    let nMax = -Infinity;
    const grow = (e, n, r = 0) => {
      if (!isNum(e) || !isNum(n)) return;
      eMin = Math.min(eMin, e - r);
      eMax = Math.max(eMax, e + r);
      nMin = Math.min(nMin, n - r);
      nMax = Math.max(nMax, n + r);
    };
    for (const p of pts) grow(p.e, p.n, isNum(p.err) ? p.err : 0);
    for (const p of passes) grow(p.e, p.n, isNum(p.err) ? p.err : 0);
    if (fit) {
      grow(fit.e0, fit.n0);
      grow(fit.e1, fit.n1);
    }
    if (gaiaLine) grow(gaiaLine.e1, gaiaLine.n1);
    const half = Math.max((eMax - eMin) / 2, (nMax - nMin) / 2, 0.25) * 1.22;
    const ce = (eMin + eMax) / 2;
    const cn = (nMin + nMax) / 2;
    const xs = linearScale(ce + half, ce - half, x0, x1); // east is to the left
    const ys = linearScale(cn - half, cn + half, y1, y0);

    const ticksE = niceTicks(ce - half, ce + half, 4);
    const ticksN = niceTicks(cn - half, cn + half, 4);
    const stepE = ticksE.length > 1 ? ticksE[1] - ticksE[0] : 1;
    const stepN = ticksN.length > 1 ? ticksN[1] - ticksN[0] : 1;
    for (const t of ticksE) {
      const x = Math.round(xs(t)) + 0.5;
      if (x > x0 + 1) svgEl('line', { x1: x, x2: x, y1: y0, y2: y1, class: 'tbp-grid' }, gAxes);
      svgEl('line', { x1: x, x2: x, y1: y1, y2: y1 + 4, class: 'tbp-axis' }, gAxes);
      svgEl('text', { x, y: y1 + 16, 'text-anchor': 'middle', class: 'tbp-num', text: formatTick(t, stepE) }, gAxes);
    }
    for (const t of ticksN) {
      const y = Math.round(ys(t)) + 0.5;
      if (y < y1 - 1) svgEl('line', { x1: x0, x2: x1, y1: y, y2: y, class: 'tbp-grid' }, gAxes);
      svgEl('text', { x: x0 - 7, y: y + 3.5, 'text-anchor': 'end', class: 'tbp-num', text: formatTick(t, stepN) }, gAxes);
    }

    // Compass rose in the corner farthest from the data.
    const corners = [[x1 - 12, y0 + 30], [x0 + 34, y0 + 30], [x1 - 12, y1 - 10], [x0 + 34, y1 - 10]];
    let bestCorner = corners[0];
    let bestDist = -1;
    for (const c of corners) {
      let d = Infinity;
      for (const p of passes) d = Math.min(d, Math.hypot(xs(p.e) - c[0], ys(p.n) - c[1]));
      if (d > bestDist) {
        bestDist = d;
        bestCorner = c;
      }
    }
    drawCompassRose(gAxes, bestCorner[0], bestCorner[1]);

    const enter = state.animate ? 'tbp-enter' : null;
    const gData = svgEl('g', { class: enter }, trackSvg);
    const accent = state.verdict && state.verdict.signal ? SIGNAL : PAPER;

    if (gaiaLine) {
      svgEl('line', {
        x1: px(xs(gaiaLine.e0)), y1: px(ys(gaiaLine.n0)), x2: px(xs(gaiaLine.e1)), y2: px(ys(gaiaLine.n1)),
        stroke: STONE, 'stroke-opacity': 0.75, 'stroke-width': 7, 'stroke-linecap': 'round',
      }, gData);
    }
    if (fit) {
      const ax = xs(fit.e0);
      const ay = ys(fit.n0);
      const bx = xs(fit.e1);
      const by = ys(fit.n1);
      const len = Math.hypot(bx - ax, by - ay);
      if (len >= 10) {
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        const tipX = bx + ux * 13;
        const tipY = by + uy * 13;
        svgEl('line', { x1: px(ax), y1: px(ay), x2: px(tipX - ux * 6), y2: px(tipY - uy * 6), stroke: accent, 'stroke-width': 1.75 }, gData);
        svgEl('path', { d: arrowHead(tipX, tipY, ux, uy, 8), fill: accent }, gData);
      }
    }

    // Individual measurements (only when there are several per pass), then the pass means.
    if (pts.length > passes.length) {
      for (const p of pts) {
        const cx = xs(p.e);
        const cy = ys(p.n);
        svgEl('circle', { cx: px(cx), cy: px(cy), r: 1.8, fill: PAPER, 'fill-opacity': 0.4 }, gData);
        targets.push({ x: cx, y: cy, kind: 'point', p, bias: 1.6, skipKeys: true });
      }
    }
    const labelBoxes = [];
    for (const p of passes) {
      const cx = xs(p.e);
      const cy = ys(p.n);
      let reach = 0;
      if (isNum(p.err)) {
        const r = Math.abs(xs(p.e + p.err) - cx);
        if (r > 5.5) {
          reach = r;
          svgEl('path', { d: `M${px(cx - r)} ${px(cy)}H${px(cx + r)}M${px(cx)} ${px(cy - r)}V${px(cy + r)}`, stroke: PAPER, 'stroke-width': 1.25, fill: 'none' }, gData);
        }
      }
      svgEl('circle', { cx: px(cx), cy: px(cy), r: 4.2, fill: PAPER, stroke: INK, 'stroke-width': 1.5 }, gData);
      targets.push({ x: cx, y: cy, kind: 'pass', p });

      // Date label beside the point, on the side with more room, skipped when it would collide.
      const w = p.label.length * 5.9;
      const pad = Math.max(11, reach + 5);
      const right = cx + pad + w <= x1 + 6;
      const lx = right ? cx + pad : cx - pad;
      const box = { x0: right ? lx : lx - w, x1: right ? lx + w : lx, y0: cy - 7, y1: cy + 7 };
      if (labelBoxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
      labelBoxes.push(box);
      svgEl('text', { x: px(lx), y: px(cy + 3.5), 'text-anchor': right ? 'start' : 'end', class: 'tbp-halo', 'font-size': 10.5, text: p.label }, gData);
    }

    hoverLayer = svgEl('g', { 'pointer-events': 'none' }, trackSvg);
    svgEl('rect', { x: x0, y: y0, width: side, height: side, fill: 'transparent' }, trackSvg);
  }

  function fittedLine(m) {
    const passes = state.passes;
    if (!m || !isNum(m.pmra) || !isNum(m.pmdec) || passes.length < 2) return null;
    let sw = 0;
    let st = 0;
    let se = 0;
    let sn = 0;
    for (const p of passes) {
      const w = isNum(p.err) ? 1 / (p.err * p.err) : 1;
      sw += w;
      st += w * p.mjd;
      se += w * p.e;
      sn += w * p.n;
    }
    const tm = st / sw;
    const t0 = passes[0].mjd;
    const t1 = passes[passes.length - 1].mjd;
    const ve = m.pmra / 1000 / 365.25; // arcsec per day
    const vn = m.pmdec / 1000 / 365.25;
    return {
      e0: se / sw + ve * (t0 - tm),
      n0: sn / sw + vn * (t0 - tm),
      e1: se / sw + ve * (t1 - tm),
      n1: sn / sw + vn * (t1 - tm),
      years: (t1 - t0) / 365.25,
    };
  }

  function drawCompassRose(parent, cx, cy) {
    const g = svgEl('g', {}, parent);
    svgEl('path', { d: `M${cx} ${cy}V${cy - 13}M${cx} ${cy}H${cx - 13}`, stroke: STONE, 'stroke-width': 1, fill: 'none' }, g);
    svgEl('path', { d: arrowHead(cx, cy - 15, 0, -1, 5), fill: STONE }, g);
    svgEl('path', { d: arrowHead(cx - 15, cy, -1, 0, 5), fill: STONE }, g);
    svgEl('text', { x: cx, y: cy - 18, 'text-anchor': 'middle', 'font-size': 9.5, text: 'N' }, g);
    svgEl('text', { x: cx - 18, y: cy + 3.5, 'text-anchor': 'end', 'font-size': 9.5, text: 'E' }, g);
  }

  // --- comparison panel -------------------------------------------------------------------
  function drawDirection(parent, cx, cy, r, pa, color) {
    svgEl('circle', { cx, cy, r, fill: 'none', stroke: STONE, 'stroke-width': 1 }, parent);
    svgEl('line', { x1: cx, x2: cx, y1: cy - r - 3, y2: cy - r + 3, stroke: STONE, 'stroke-width': 1 }, parent);
    if (!isNum(pa)) {
      svgEl('circle', { cx, cy, r: 2, fill: color }, parent);
      return;
    }
    const a = (pa * Math.PI) / 180;
    const ux = -Math.sin(a); // east is to the left
    const uy = -Math.cos(a);
    const tipX = cx + ux * (r - 3);
    const tipY = cy + uy * (r - 3);
    svgEl('line', { x1: px(cx - ux * (r - 6)), y1: px(cy - uy * (r - 6)), x2: px(tipX - ux * 5), y2: px(tipY - uy * 5), stroke: color, 'stroke-width': 1.75 }, parent);
    svgEl('path', { d: arrowHead(tipX, tipY, ux, uy, 7), fill: color }, parent);
  }

  function renderCompare(W, narrow) {
    const Wc = Math.max(220, narrow ? W : Math.min(W - TRACK_W - 22, 560));
    compareSvg.setAttribute('viewBox', `0 0 ${Wc} ${COMPARE_H}`);
    compareSvg.setAttribute('height', COMPARE_H);
    clearNode(compareSvg);

    const message = !state.hasData ? MOTION_EMPTY_TEXT : state.verdict.kind === 'few' ? MOTION_FEW_TEXT : null;
    if (message) {
      const lines = wrapText(message, Math.max(16, Math.floor(Wc / 7.4)));
      const t = svgEl('text', { x: narrow ? px(Wc / 2) : 0, y: px(COMPARE_H / 2 - (lines.length - 1) * 9 + 4), 'text-anchor': narrow ? 'middle' : 'start', class: 'tbp-empty' }, compareSvg);
      lines.forEach((line, i) => svgEl('tspan', { x: narrow ? px(Wc / 2) : 0, dy: i ? 18 : 0, text: line }, t));
      return;
    }

    const m = normalizePm(state.measured);
    const g = normalizePm(state.gaia);
    const gaiaPm = !!g && isNum(g.total);
    const accent = state.verdict.signal ? SIGNAL : PAPER;
    const barMax = Wc - 70;
    const top = Math.max(m.total + (isNum(m.errTotal) ? m.errTotal : 0), gaiaPm ? g.total : 0);
    const xb = linearScale(0, top > 0 ? top * 1.04 : 1, 0, barMax);
    const gAll = svgEl('g', { class: state.animate ? 'tbp-enter' : null }, compareSvg);

    const row = (y, label, pm, color, isMeasured) => {
      svgEl('text', { x: 0, y: y + 10, 'font-size': 10, 'letter-spacing': '0.08em', text: label }, gAll);
      const by = y + 18;
      svgEl('rect', { x: 0, y: by, width: barMax, height: 10, fill: PAPER, 'fill-opacity': 0.06, rx: 2 }, gAll);
      const hasPm = pm && isNum(pm.total);
      const cx = Wc - 28;
      const cy = y + 25;
      if (!hasPm) {
        svgEl('text', { x: 0, y: y + 51, class: 'tbp-strong', 'font-size': 13, text: pm ? 'star listed, no motion given' : 'no star at this position' }, gAll);
        drawDirection(gAll, cx, cy, 15, NaN, 'none');
        return;
      }
      const w = Math.max(1.5, xb(pm.total));
      const r = Math.min(3, w / 2);
      svgEl('path', { d: `M0 ${by}H${px(w - r)}a${r} ${r} 0 0 1 ${r} ${r}V${by + 10 - r}a${r} ${r} 0 0 1 ${-r} ${r}H0Z`, fill: color }, gAll);
      if (isMeasured && isNum(pm.errTotal)) {
        // The uncertainty is a bracket under the bar, so it never cuts through the bar itself.
        const xa = Math.max(0, xb(pm.total - pm.errTotal));
        const xc = xb(pm.total + pm.errTotal);
        const ey = by + 15.5;
        svgEl('path', { d: `M${px(xa)} ${ey - 3}v6M${px(xa)} ${ey}H${px(xc)}M${px(xc)} ${ey - 3}v6`, stroke: PAPER, 'stroke-opacity': 0.7, 'stroke-width': 1.25, fill: 'none' }, gAll);
      }
      const arc = formatWithError(pm.total / 1000, isMeasured && isNum(pm.errTotal) ? pm.errTotal / 1000 : NaN);
      const mas = formatWithError(pm.total, isMeasured && isNum(pm.errTotal) ? pm.errTotal : NaN);
      let arcText = arc.text;
      let masText = mas.text;
      if (!isMeasured || !isNum(pm.errTotal)) {
        arcText = pm.total >= 100 ? formatFixed(pm.total / 1000, pm.total >= 10000 ? 2 : 3) : formatNumber(pm.total / 1000, 2);
        masText = pm.total >= 100 ? formatFixed(pm.total, 0) : formatNumber(pm.total, 3);
      }
      const line = svgEl('text', { x: 0, y: y + 51, class: 'tbp-num tbp-strong', 'font-size': 14 }, gAll);
      svgEl('tspan', { text: arcText }, line);
      svgEl('tspan', { text: ' arcsec/yr', 'font-size': 11, 'fill-opacity': 0.66 }, line);
      svgEl('text', { x: 0, y: y + 66, class: 'tbp-num', text: `${masText} mas/yr` }, gAll);
      const pa = positionAngle(pm.pmra, pm.pmdec);
      const still = isMeasured && state.verdict.kind === 'static';
      drawDirection(gAll, cx, cy, 15, still ? NaN : pa, color);
      svgEl('text', { x: cx, y: y + 58, 'text-anchor': 'middle', class: 'tbp-num', 'font-size': 10.5, text: isNum(pa) && !still ? `PA ${Math.round(pa) % 360}°` : 'PA –' }, gAll);
    };

    row(2, 'MEASURED', m, accent, true);
    row(80, state.gaia && state.gaia.source === 'catalogue' ? 'CATALOGUE' : 'GAIA DR3', g, STONE, false);
  }

  // --- legend, verdict, labels ------------------------------------------------------------
  function renderLegend() {
    clearNode(legend);
    if (!state.hasData || !state.track.length) return;
    const item = (build, text, w = 18) => {
      const el = htmlEl('span', { class: 'tbp-legend-item' }, legend);
      const s = svgEl('svg', { width: w, height: 12, viewBox: `0 0 ${w} 12`, 'aria-hidden': 'true' }, el);
      build(s);
      htmlEl('span', { text }, el);
    };
    item((s) => svgEl('circle', { cx: 6, cy: 6, r: 3.6, fill: PAPER }, s), 'position per pass', 12);
    if (state.verdict && state.verdict.kind !== 'few' && state.verdict.kind !== 'static' && state.passes.length > 1) {
      const accent = state.verdict.signal ? SIGNAL : PAPER;
      item((s) => {
        svgEl('line', { x1: 0, x2: 12, y1: 6, y2: 6, stroke: accent, 'stroke-width': 1.75 }, s);
        svgEl('path', { d: arrowHead(18, 6, 1, 0, 7), fill: accent }, s);
      }, 'fitted motion');
      if (state.gaia && isNum(state.gaia.pmra) && isNum(state.gaia.pmdec)) {
        item((s) => svgEl('line', { x1: 3, x2: 15, y1: 6, y2: 6, stroke: STONE, 'stroke-opacity': 0.75, 'stroke-width': 6, 'stroke-linecap': 'round' }, s), state.gaia.source === 'catalogue' ? 'catalogue prediction' : 'Gaia DR3 prediction');
      }
    }
  }

  function renderMeta() {
    titleEl.textContent = state.title ? `Motion of ${state.title}` : 'Motion';
    const v = state.verdict;
    verdictEl.classList.toggle('tbp-is-blank', !state.hasData || v.kind === 'few');
    verdictEl.classList.toggle('tbp-is-signal', !!(v && v.signal));
    verdictEl.classList.toggle('tbp-text-signal', !!(v && v.signal && v.kind === 'unexplained'));
    if (!state.hasData) {
      subEl.textContent = '';
      verdictText.textContent = '';
      grid.setAttribute('aria-label', MOTION_EMPTY_TEXT);
      return;
    }
    const n = state.passes.length;
    const parts = [];
    if (n) parts.push(`${n} survey pass${n === 1 ? '' : 'es'}`);
    if (n > 1) parts.push(`${((state.passes[n - 1].mjd - state.passes[0].mjd) / 365.25).toFixed(1)} yr baseline`);
    subEl.textContent = parts.join(' · ');
    verdictText.textContent = v.kind === 'few' ? '' : v.text;

    let label = `Motion of ${state.title || 'the selected source'}. ${v.text}`;
    const m = normalizePm(state.measured);
    if (v.kind !== 'few' && v.kind !== 'static' && m) {
      const pa = positionAngle(m.pmra, m.pmdec);
      if (isNum(pa)) label += ` Measured direction: position angle ${Math.round(pa) % 360} degrees, north through east.`;
    }
    if (n) {
      label += ` Positions relative to the first pass: ${state.passes
        .map((p) => `${p.label} ${p.e.toFixed(1)} east, ${p.n.toFixed(1)} north`).join('; ')} arcseconds.`;
    }
    grid.setAttribute('aria-label', label);
  }

  function render() {
    const W = Math.max(260, state.width || container.clientWidth || 640);
    const narrow = W < 560;
    root.classList.toggle('tbp-narrow', narrow);
    renderTrack(W, narrow);
    renderCompare(W, narrow);
    state.animate = false;
  }

  function renderAll() {
    renderMeta();
    renderLegend();
    render();
  }

  const api = {
    el: root,

    /**
     * @param {{ measured: { pmra:number, pmdec:number, total?:number, errTotal?:number }|null,
     *   gaia: { pmra:number, pmdec:number, total?:number }|null, track?: Array, title?: string }} data
     */
    setData(data) {
      const d = data || {};
      state.measured = d.measured && typeof d.measured === 'object' ? d.measured : null;
      state.gaia = d.gaia && typeof d.gaia === 'object' ? d.gaia : null;
      state.track = normalizeTrack(d.track);
      state.passes = passPositions(d.track);
      state.title = d.title ? String(d.title) : '';
      state.hasData = !!state.measured || state.track.length > 0;
      state.verdict = motionVerdict(state.measured, state.gaia, {
        passes: state.track.length ? state.passes.length : undefined,
      });
      state.animate = state.hasData;
      renderAll();
    },

    clear() {
      state.measured = null;
      state.gaia = null;
      state.track = [];
      state.passes = [];
      state.title = '';
      state.hasData = false;
      state.verdict = null;
      state.animate = false;
      renderAll();
    },

    /** The verdict object for the current data, or null when empty. */
    getVerdict() {
      return state.verdict;
    },

    destroy() {
      stopWatching();
      hover.destroy();
      root.remove();
    },
  };

  const stopWatching = watchWidth(body, (w) => {
    state.width = w;
    render();
  });
  state.width = Math.round(body.clientWidth || 0);
  renderAll();
  return api;
}
