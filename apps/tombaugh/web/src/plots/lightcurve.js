// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Light-curve plot: brightness of one source over time, relative to its own average spectrum
// (ratio 1.0 = its usual brightness at that wavelength). SPHEREx revisits a position about every
// six months, so the time axis is broken into one panel per survey pass with a shared y axis.
//
// Contract API (unchanged):
//   createLightCurvePlot(container) -> { setData({ points, title }), clear() }
//   points = [{ mjd, ratio, err, wave }]
//
// Optional extras:
//   getVerdict() -> the object returned by lightCurveVerdict for the current data
//   destroy(), el (the root <figure>)
//   Pure helpers, usable without a DOM: lightCurveVerdict(points, opts), epochMeans(points, opts),
//   lightCurvePanels(points, opts), LIGHTCURVE_EMPTY_TEXT.
//
// How the verdict is computed (lightCurveVerdict):
//   1. Points are split into survey passes at gaps longer than 45 days. A pass that lasts longer
//      than 60 days (continuous coverage near the ecliptic poles) is cut into bins of at most
//      30 days. Each pass or bin is an "epoch".
//   2. Each epoch gets an error-weighted mean ratio. Its error is the formal one, inflated when
//      the scatter is larger than the quoted errors, plus a 1 percent calibration floor.
//   3. Every pair of epochs is compared. A change counts as detected at 5 sigma or more; between
//      3 and 5 sigma it is reported as possible; otherwise the verdict quotes the largest change
//      the data could still hide (observed difference plus 3 sigma, rounded up).

import {
  PAPER, STONE, SIGNAL, INK, WAVE_RAMP,
  isNum, clamp, quantile, weightedMean, splitPasses, detectorOf,
  niceTicks, linearScale, formatTick, formatMonthYear, formatDayMonthYear, formatIsoMinute,
  timeTicks, waveColor,
  svgEl, htmlEl, clearNode, px, watchWidth, createTooltip, attachHover,
} from './svg.js';
import { ensurePlotStyles } from './plots.css.js';

export const LIGHTCURVE_EMPTY_TEXT = 'Click a source in the image to see how its brightness changed.';

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

function validPoints(points) {
  return (points || []).filter((p) => p && isNum(p.mjd) && isNum(p.ratio));
}

/**
 * Mean brightness per epoch (survey pass, or 30-day bin of a long pass).
 * @returns {Array<{ mjd, mjd0, mjd1, mean, err, errTotal, n, pass, label }>} err is the
 *   statistical error of the mean, errTotal adds the calibration floor.
 */
export function epochMeans(points, opts = {}) {
  const gapDays = opts.gapDays ?? 45;
  const longSpanDays = opts.longSpanDays ?? 60;
  const binDays = opts.binDays ?? 30;
  const floor = opts.floor ?? 0.01;
  const groups = splitPasses(validPoints(points), gapDays);
  const epochs = [];
  groups.forEach((g, pass) => {
    const span = g[g.length - 1].mjd - g[0].mjd;
    const nb = span > longSpanDays ? Math.ceil(span / binDays) : 1;
    const bins = Array.from({ length: nb }, () => []);
    for (const p of g) {
      const i = nb === 1 ? 0 : clamp(Math.floor(((p.mjd - g[0].mjd) / span) * nb), 0, nb - 1);
      bins[i].push(p);
    }
    for (const b of bins) {
      if (!b.length) continue;
      const m = weightedMean(b.map((p) => p.ratio), b.map((p) => p.err));
      let t = 0;
      for (const p of b) t += p.mjd;
      epochs.push({
        mjd: t / b.length,
        mjd0: b[0].mjd,
        mjd1: b[b.length - 1].mjd,
        mean: m.mean,
        err: m.err,
        errTotal: isNum(m.err) ? Math.hypot(m.err, floor * Math.abs(m.mean)) : NaN,
        n: b.length,
        pass,
        label: '',
      });
    }
  });
  const count = new Map();
  for (const e of epochs) {
    e.label = formatMonthYear(e.mjd);
    count.set(e.label, (count.get(e.label) || 0) + 1);
  }
  for (const e of epochs) if (count.get(e.label) > 1) e.label = formatDayMonthYear(e.mjd);
  return epochs;
}

const PERCENT_STEPS = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100];

function sigmaText(s) {
  return s >= 10 ? String(Math.round(s)) : s.toFixed(1);
}

/**
 * One plain-language sentence about whether the brightness changed between epochs.
 * @param {Array<{ mjd:number, ratio:number, err?:number }>} points
 * @param {{ minSigma?:number, hintSigma?:number, gapDays?:number, floor?:number }} [opts]
 * @returns {{ kind:'empty'|'single'|'changed'|'possible'|'steady'|'noisy', text:string,
 *   changed:boolean, factor?:number, sigma?:number, direction?:'rose'|'fell', from?:Object,
 *   to?:Object, limitPercent?:number, epochs:Array }}
 */
export function lightCurveVerdict(points, opts = {}) {
  const minSigma = opts.minSigma ?? 5;
  const hintSigma = opts.hintSigma ?? 3;
  const epochs = epochMeans(points, opts);
  if (!epochs.length) {
    return { kind: 'empty', text: 'No brightness measurements yet.', changed: false, epochs };
  }
  if (epochs.length < 2) {
    return {
      kind: 'single',
      text: `Only one survey pass so far (${epochs[0].label}): nothing to compare it with yet.`,
      changed: false,
      epochs,
    };
  }

  const pairs = [];
  for (let i = 0; i < epochs.length; i++) {
    for (let j = i + 1; j < epochs.length; j++) {
      const a = epochs[i];
      const b = epochs[j];
      if (!(a.mean > 0) || !(b.mean > 0) || !isNum(a.errTotal) || !isNum(b.errTotal)) continue;
      const sigma = Math.abs(b.mean - a.mean) / Math.hypot(a.errTotal, b.errTotal);
      const factor = Math.max(a.mean, b.mean) / Math.min(a.mean, b.mean);
      const relErr = factor * Math.hypot(a.errTotal / a.mean, b.errTotal / b.mean);
      pairs.push({ a, b, sigma, factor, relErr, direction: b.mean >= a.mean ? 'rose' : 'fell' });
    }
  }
  if (!pairs.length) {
    return { kind: 'noisy', text: 'Too noisy to tell whether the brightness changed.', changed: false, epochs };
  }

  const describe = (p) => {
    if (p.factor >= 1.2) return `a factor of ${p.factor >= 10 ? Math.round(p.factor) : p.factor.toFixed(1)}`;
    const rel = Math.abs(p.b.mean - p.a.mean) / p.a.mean;
    return `${Math.max(1, Math.round(rel * 100))} percent`;
  };

  let best = null;
  for (const p of pairs) if (p.sigma >= minSigma && (!best || p.factor > best.factor)) best = p;
  if (best) {
    return {
      kind: 'changed',
      text: `Brightness ${best.direction} by ${describe(best)} between ${best.a.label} and ${best.b.label} (${sigmaText(best.sigma)} sigma).`,
      changed: true,
      factor: best.factor,
      sigma: best.sigma,
      direction: best.direction,
      from: best.a,
      to: best.b,
      epochs,
    };
  }

  let hint = null;
  for (const p of pairs) if (p.sigma >= hintSigma && (!hint || p.sigma > hint.sigma)) hint = p;
  if (hint) {
    return {
      kind: 'possible',
      text: `Possible change of ${describe(hint)} between ${hint.a.label} and ${hint.b.label} (${sigmaText(hint.sigma)} sigma): not enough to be sure.`,
      changed: false,
      factor: hint.factor,
      sigma: hint.sigma,
      direction: hint.direction,
      from: hint.a,
      to: hint.b,
      epochs,
    };
  }

  let limit = 0;
  for (const p of pairs) limit = Math.max(limit, p.factor - 1 + 3 * p.relErr);
  const percent = limit * 100;
  if (!isNum(percent) || percent > 100) {
    return { kind: 'noisy', text: 'Too noisy to tell whether the brightness changed.', changed: false, epochs };
  }
  const limitPercent = PERCENT_STEPS.find((s) => s >= percent - 1e-9) ?? 100;
  return {
    kind: 'steady',
    text: `No change larger than ${limitPercent} percent detected.`,
    changed: false,
    limitPercent,
    epochs,
  };
}

/**
 * Time panels for the broken x axis: one per survey pass, or a single continuous panel when
 * there are more passes than fit. Every panel's domain is padded; short passes are widened so
 * that all panels use a comparable time scale.
 * @returns {Array<{ points:Array, t0:number, t1:number, share:number }>}
 */
export function lightCurvePanels(points, opts = {}) {
  const valid = validPoints(points);
  if (!valid.length) return [];
  let groups = splitPasses(valid, opts.gapDays ?? 45);
  if (groups.length > (opts.maxPanels ?? 6)) groups = [groups.flat()];
  const spans = groups.map((g) => g[g.length - 1].mjd - g[0].mjd);
  const longest = Math.max(...spans);
  const durs = spans.map((s) => Math.max(s, 0.35 * longest, 2));
  const total = durs.reduce((a, b) => a + b, 0);
  return groups.map((g, i) => {
    const mid = (g[0].mjd + g[g.length - 1].mjd) / 2;
    const half = durs[i] / 2 + durs[i] * 0.07 + 0.3;
    return { points: g, t0: mid - half, t1: mid + half, share: durs[i] / total };
  });
}

// ---------------------------------------------------------------------------------------------
// The plot
// ---------------------------------------------------------------------------------------------

let uidCounter = 0;

/** @param {HTMLElement} container */
export function createLightCurvePlot(container) {
  ensurePlotStyles(container.ownerDocument);
  const uid = `tbp-lc-${++uidCounter}`;
  const state = { points: [], title: '', hasData: false, width: 0, verdict: null, animate: false };

  const root = htmlEl('figure', { class: 'tbp tbp-lightcurve' });
  const head = htmlEl('div', { class: 'tbp-head' }, root);
  const titles = htmlEl('div', { class: 'tbp-titles' }, head);
  const titleEl = htmlEl('div', { class: 'tbp-title', text: 'Brightness over time' }, titles);
  const subEl = htmlEl('div', { class: 'tbp-sub' }, titles);
  const body = htmlEl('div', { class: 'tbp-body' }, root);
  const svg = svgEl('svg', { class: 'tbp-svg', role: 'img', tabindex: '0', 'aria-label': LIGHTCURVE_EMPTY_TEXT }, body);
  const tip = createTooltip(body);
  const foot = htmlEl('div', { class: 'tbp-foot' }, root);
  const legend = htmlEl('div', { class: 'tbp-legend' }, foot);
  const verdictEl = htmlEl('div', { class: 'tbp-verdict tbp-is-blank', role: 'status' }, foot);
  htmlEl('span', { class: 'tbp-verdict-mark', 'aria-hidden': 'true' }, verdictEl);
  const verdictText = htmlEl('span', {}, verdictEl);
  container.appendChild(root);

  let targets = [];
  let hoverLayer = null;
  let plotBox = { top: 0, bottom: 0 };

  const hover = attachHover(svg, () => targets, (t) => {
    if (!hoverLayer) return;
    clearNode(hoverLayer);
    if (!t) {
      tip.hide();
      return;
    }
    svgEl('line', { x1: px(t.x), x2: px(t.x), y1: plotBox.top, y2: plotBox.bottom, stroke: PAPER, 'stroke-opacity': 0.35, 'stroke-width': 1 }, hoverLayer);
    svgEl('line', { x1: t.panel.x0, x2: t.panel.x1, y1: px(t.y), y2: px(t.y), stroke: PAPER, 'stroke-opacity': 0.35, 'stroke-width': 1 }, hoverLayer);
    svgEl('circle', { cx: px(t.x), cy: px(t.y), r: t.kind === 'mean' ? 7 : 5.5, fill: 'none', stroke: PAPER, 'stroke-width': 1.5 }, hoverLayer);
    const lines = [];
    if (t.kind === 'mean') {
      const e = t.e;
      lines.push({ text: `${e.label} mean`, cls: 'tbp-tip-head' });
      lines.push(`${e.mean.toFixed(3)}${isNum(e.err) ? ` ± ${e.err.toFixed(3)}` : ''} × average`);
      lines.push({ text: `${e.n} measurement${e.n === 1 ? '' : 's'}`, cls: 'tbp-tip-dim' });
    } else {
      const p = t.p;
      lines.push({ text: `${formatIsoMinute(p.mjd)} UTC`, cls: 'tbp-tip-head' });
      lines.push(`${p.ratio.toFixed(3)}${isNum(p.err) ? ` ± ${p.err.toFixed(3)}` : ''} × average`);
      if (isNum(p.wave)) {
        const det = detectorOf(p.wave);
        lines.push({ text: `${p.wave.toFixed(3)} µm${det ? ` · D${det}` : ''}`, cls: 'tbp-tip-dim' });
      }
    }
    tip.show(lines, t.x, t.y);
  });

  function render() {
    const W = Math.max(280, state.width || container.clientWidth || 640);
    const narrow = W < 520;
    const H = narrow ? 250 : 290;
    root.classList.toggle('tbp-narrow', narrow);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('height', H);
    clearNode(svg);
    tip.hide();
    targets = [];
    hoverLayer = null;

    const left = 56;
    const right = 10;
    const top = 10;
    const bottom = H - 44;
    plotBox = { top, bottom };
    const gAxes = svgEl('g', { 'aria-hidden': 'true' }, svg);
    svgEl('text', {
      x: 0, y: 0, transform: `translate(12 ${px((top + bottom) / 2)}) rotate(-90)`, 'text-anchor': 'middle',
      class: 'tbp-axis-title', text: narrow ? 'Brightness ÷ own average' : 'Brightness ÷ own average spectrum',
    }, gAxes);

    if (!state.hasData) {
      svgEl('path', { d: `M${left + 0.5} ${top}V${bottom + 0.5}H${W - right}`, class: 'tbp-axis' }, gAxes);
      // Wrapped to the plot width (about 7 px per character), so it is never clipped on a phone.
      const maxChars = Math.max(14, Math.floor((W - left - right - 16) / 7));
      const lines = [];
      let cur = '';
      for (const word of LIGHTCURVE_EMPTY_TEXT.split(' ')) {
        if (cur && `${cur} ${word}`.length > maxChars) {
          lines.push(cur);
          cur = word;
        } else cur = cur ? `${cur} ${word}` : word;
      }
      if (cur) lines.push(cur);
      const cx = px((left + W - right) / 2);
      const t = svgEl('text', { x: cx, y: px((top + bottom) / 2 + 4 - (lines.length - 1) * 9), 'text-anchor': 'middle', class: 'tbp-empty' }, svg);
      lines.forEach((line, i) => svgEl('tspan', { x: cx, dy: i ? 18 : 0, text: line }, t));
      return;
    }

    const epochs = state.verdict.epochs;
    const maxPanels = narrow ? 4 : 7;
    const panels = lightCurvePanels(state.points, { maxPanels });

    // Shared y axis: always contains 1.0, robust against a few wild points.
    const his = [];
    const los = [];
    for (const p of state.points) {
      const e = isNum(p.err) && p.err > 0 ? p.err : 0;
      his.push(p.ratio + e);
      los.push(p.ratio - e);
    }
    let hi = Math.max(1, quantile(his, 0.995));
    let lo = Math.min(1, quantile(los, 0.005));
    for (const e of epochs) {
      const s = isNum(e.err) ? e.err : 0;
      hi = Math.max(hi, e.mean + s);
      lo = Math.min(lo, e.mean - s);
    }
    if (hi - lo < 0.1) {
      const mid = (hi + lo) / 2;
      hi = mid + 0.05;
      lo = mid - 0.05;
    }
    const padY = (hi - lo) * 0.08;
    hi += padY;
    lo -= padY;
    const ys = linearScale(lo, hi, bottom, top);
    const yTicks = niceTicks(lo, hi, narrow ? 4 : 5);
    const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 0.1;

    const gap = 16;
    const avail = W - right - left - gap * (panels.length - 1);
    let x = left;
    const clipDefs = svgEl('defs', {}, svg);
    const gData = svgEl('g', { class: state.animate ? 'tbp-enter' : null }, svg);
    const gMeans = svgEl('g', { class: state.animate ? 'tbp-enter' : null }, svg);
    const changed = state.verdict.kind === 'changed' ? [state.verdict.from, state.verdict.to] : [];

    panels.forEach((panel, i) => {
      const x0 = Math.round(x);
      const x1 = Math.round(x + avail * panel.share);
      x = x1 + gap;
      const xs = linearScale(panel.t0, panel.t1, x0, x1);
      const box = { x0, x1 };

      // Grid, the 1.0 line and the axis for this panel.
      for (const t of yTicks) {
        const y = Math.round(ys(t)) + 0.5;
        if (y < bottom - 1) svgEl('line', { x1: x0, x2: x1, y1: y, y2: y, class: 'tbp-grid' }, gAxes);
        if (i === 0) svgEl('text', { x: left - 7, y: y + 3.5, 'text-anchor': 'end', class: 'tbp-num', text: formatTick(t, yStep) }, gAxes);
      }
      const yOne = Math.round(ys(1)) + 0.5;
      svgEl('line', { x1: x0, x2: x1, y1: yOne, y2: yOne, stroke: STONE, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, gAxes);
      svgEl('line', { x1: x0, x2: x1, y1: bottom + 0.5, y2: bottom + 0.5, class: 'tbp-axis' }, gAxes);
      if (i === 0) svgEl('line', { x1: left + 0.5, x2: left + 0.5, y1: top, y2: bottom, class: 'tbp-axis' }, gAxes);
      if (i > 0) {
        // Axis break marks in the gap before this panel.
        const bx = x0 - gap / 2;
        svgEl('path', { d: `M${bx - 4.5} ${bottom + 4.5}l4 -8M${bx + 0.5} ${bottom + 4.5}l4 -8`, stroke: STONE, 'stroke-width': 1, fill: 'none' }, gAxes);
      }

      // Calendar ticks and the month caption.
      const tt = timeTicks(panel.t0, panel.t1, clamp(Math.floor((x1 - x0) / 34), 1, 7));
      let lastLabelEnd = -Infinity;
      for (const t of tt.ticks) {
        const tx = Math.round(xs(t.mjd)) + 0.5;
        if (tx < x0 - 0.5 || tx > x1 + 0.5) continue;
        svgEl('line', { x1: tx, x2: tx, y1: bottom, y2: bottom + 4, class: 'tbp-axis' }, gAxes);
        const w = t.label.length * 6.2;
        if (tx - w / 2 < lastLabelEnd + 4 || tx - w / 2 < x0 - 8 || tx + w / 2 > x1 + 8) continue;
        svgEl('text', { x: tx, y: bottom + 16, 'text-anchor': 'middle', class: 'tbp-num', text: t.label }, gAxes);
        lastLabelEnd = tx + w / 2;
      }
      const capW = tt.caption.length * 6;
      const capX = clamp((x0 + x1) / 2, x0 + capW / 2 - 6, Math.max(x0 + capW / 2 - 6, x1 - capW / 2 + 6));
      svgEl('text', { x: px(capX), y: bottom + 32, 'text-anchor': 'middle', class: 'tbp-strong', text: tt.caption }, gAxes);

      // Points.
      const clipId = `${uid}-clip-${i}`;
      const clip = svgEl('clipPath', { id: clipId }, clipDefs);
      svgEl('rect', { x: x0 - 3, y: top - 3, width: x1 - x0 + 6, height: bottom - top + 3 }, clip);
      const g = svgEl('g', { 'clip-path': `url(#${clipId})` }, gData);
      const r = narrow ? 2.1 : 2.4;
      for (const p of panel.points) {
        const cx = xs(p.mjd);
        const cy = ys(p.ratio);
        const color = waveColor(p.wave);
        if (isNum(p.err) && p.err > 0) {
          svgEl('line', { x1: px(cx), x2: px(cx), y1: px(ys(p.ratio + p.err)), y2: px(ys(p.ratio - p.err)), stroke: color, 'stroke-opacity': 0.3, 'stroke-width': 1 }, g);
        }
        targets.push({ x: cx, y: cy, kind: 'point', p, panel: box, skipKeys: true });
      }
      for (const p of panel.points) {
        svgEl('circle', { cx: px(xs(p.mjd)), cy: px(ys(p.ratio)), r, fill: waveColor(p.wave), 'fill-opacity': 0.85 }, g);
      }

      // Epoch means in Paper, with the stretch of time each one covers.
      for (const e of epochs) {
        if (e.mjd < panel.points[0].mjd - 1e-9 || e.mjd > panel.points[panel.points.length - 1].mjd + 1e-9) continue;
        const mx = xs(e.mjd);
        const my = ys(e.mean);
        const xa = Math.max(x0, xs(e.mjd0));
        const xb = Math.min(x1, xs(e.mjd1));
        if (xb - xa > 12) svgEl('line', { x1: px(xa), x2: px(xb), y1: px(my), y2: px(my), stroke: INK, 'stroke-width': 4, 'stroke-linecap': 'round' }, gMeans);
        if (xb - xa > 12) svgEl('line', { x1: px(xa), x2: px(xb), y1: px(my), y2: px(my), stroke: PAPER, 'stroke-width': 1.5, 'stroke-linecap': 'round' }, gMeans);
        if (isNum(e.err) && e.err > 0) {
          const ya = ys(e.mean + e.err);
          const yb = ys(e.mean - e.err);
          if (yb - ya > 10) {
            svgEl('path', { d: `M${px(mx)} ${px(ya)}V${px(yb)}M${px(mx - 3.5)} ${px(ya)}h7M${px(mx - 3.5)} ${px(yb)}h7`, stroke: PAPER, 'stroke-width': 1.5, fill: 'none' }, gMeans);
          }
        }
        if (changed.includes(e)) svgEl('circle', { cx: px(mx), cy: px(my), r: 8, fill: 'none', stroke: SIGNAL, 'stroke-width': 1.75 }, gMeans);
        svgEl('circle', { cx: px(mx), cy: px(my), r: 4.5, fill: PAPER, stroke: INK, 'stroke-width': 2 }, gMeans);
        targets.push({ x: mx, y: my, kind: 'mean', e, panel: box, bias: 0.35 });
      }
    });

    hoverLayer = svgEl('g', { 'aria-hidden': 'true', 'pointer-events': 'none' }, svg);
    svgEl('rect', { x: left, y: top, width: W - right - left, height: bottom - top, fill: 'transparent' }, svg);
    state.animate = false;
  }

  function renderLegend() {
    clearNode(legend);
    if (!state.hasData) return;
    const gradId = `${uid}-grad`;
    const scale = htmlEl('span', { class: 'tbp-legend-item' }, legend);
    htmlEl('span', { text: 'Wavelength' }, scale);
    htmlEl('span', { class: 'tbp-num', text: '0.75' }, scale);
    const bar = svgEl('svg', { width: 72, height: 10, viewBox: '0 0 72 10', 'aria-hidden': 'true' }, scale);
    const defs = svgEl('defs', {}, bar);
    const grad = svgEl('linearGradient', { id: gradId, x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
    for (const stop of WAVE_RAMP) {
      svgEl('stop', { offset: stop.t, 'stop-color': `rgb(${stop.rgb.join(',')})` }, grad);
    }
    svgEl('rect', { x: 0, y: 1, width: 72, height: 8, rx: 2, fill: `url(#${gradId})` }, bar);
    htmlEl('span', { class: 'tbp-num', text: '5.0 µm' }, scale);

    const mean = htmlEl('span', { class: 'tbp-legend-item' }, legend);
    const ms = svgEl('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' }, mean);
    svgEl('path', { d: 'M7 1V13M4.5 1h5M4.5 13h5', stroke: PAPER, 'stroke-width': 1.25, fill: 'none' }, ms);
    svgEl('circle', { cx: 7, cy: 7, r: 3.5, fill: PAPER, stroke: INK, 'stroke-width': 1 }, ms);
    htmlEl('span', { text: 'pass mean' }, mean);

    const one = htmlEl('span', { class: 'tbp-legend-item' }, legend);
    const os = svgEl('svg', { width: 18, height: 12, viewBox: '0 0 18 12', 'aria-hidden': 'true' }, one);
    svgEl('line', { x1: 0, x2: 18, y1: 6, y2: 6, stroke: STONE, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, os);
    htmlEl('span', { text: 'its own average' }, one);
  }

  function renderMeta() {
    titleEl.textContent = state.title || 'Brightness over time';
    verdictEl.classList.toggle('tbp-is-blank', !state.hasData);
    verdictEl.classList.toggle('tbp-is-signal', !!(state.verdict && state.verdict.changed));
    if (!state.hasData) {
      subEl.textContent = '';
      verdictText.textContent = '';
      svg.setAttribute('aria-label', `${state.title ? `${state.title}: ` : ''}${LIGHTCURVE_EMPTY_TEXT}`);
      return;
    }
    const v = state.verdict;
    const n = state.points.length;
    const passes = splitPasses(state.points).length;
    subEl.textContent = `${n} measurement${n === 1 ? '' : 's'} · ${passes} survey pass${passes === 1 ? '' : 'es'}`;
    verdictText.textContent = v.text;
    const means = v.epochs.map((e) => `${e.label} ${e.mean.toFixed(2)}`).join(', ');
    svg.setAttribute('aria-label',
      `Light curve of ${state.title || 'the selected source'}: brightness relative to its own average spectrum, `
      + `${n} measurements in ${passes} survey pass${passes === 1 ? '' : 'es'}. Mean per pass: ${means}. ${v.text}`);
  }

  function renderAll() {
    renderMeta();
    renderLegend();
    render();
  }

  const api = {
    el: root,

    /** @param {{ points: Array<{ mjd:number, ratio:number, err?:number, wave?:number }>, title?: string }} data */
    setData(data) {
      const d = data || {};
      state.points = validPoints(d.points).slice().sort((a, b) => a.mjd - b.mjd);
      state.title = d.title ? String(d.title) : '';
      state.hasData = state.points.length > 0;
      state.verdict = lightCurveVerdict(state.points);
      state.animate = state.hasData;
      renderAll();
    },

    clear() {
      state.points = [];
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
