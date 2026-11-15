// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The control strip: view-mode segmented control with its contextual options, detector, field of
// view, stretch, colormap and the overlay switches. Every control reads from and writes to the
// store; nothing here touches the data.

import { h, clear } from './layout.js';
import { VIEW_INFO, DETECTOR_RANGES, fmtDistance } from '../pipeline.js';
import { FOVS, STRETCHES } from '../state.js';

const MICRON = 'µm';
const DIST_MIN = 5;
const DIST_MAX = 50000;
const DIST_STEPS = 1000;

/** Log slider position (0..1000) <-> distance in AU; the last step is infinity. */
export function distFromSlider(v) {
  if (v >= DIST_STEPS) return Infinity;
  const f = Math.max(0, v) / (DIST_STEPS - 1);
  const d = DIST_MIN * Math.pow(DIST_MAX / DIST_MIN, f);
  // Round to three significant figures so the URL and the readout stay tidy.
  const mag = Math.pow(10, Math.floor(Math.log10(d)) - 2);
  return Math.round(d / mag) * mag;
}

export function sliderFromDist(d) {
  if (!Number.isFinite(d)) return DIST_STEPS;
  const f = Math.log(Math.min(DIST_MAX, Math.max(DIST_MIN, d)) / DIST_MIN) / Math.log(DIST_MAX / DIST_MIN);
  return Math.round(f * (DIST_STEPS - 1));
}

/**
 * A radio-style segmented control with roving focus and arrow keys.
 * options: [{ value, label, title }] -> { el, set(value), setDisabled(value, reason), setAllDisabled(reason) }
 */
export function makeSeg({ label, options, value, onChange, className = 'seg', grid = false }) {
  const el = h('div', { class: className, role: 'radiogroup', 'aria-label': label });
  const buttons = new Map();
  let current = value;

  function refresh() {
    let focusable = null;
    for (const [val, btn] of buttons) {
      const on = val === current;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = -1;
      if (on && !btn.disabled) focusable = btn;
    }
    if (!focusable) focusable = [...buttons.values()].find((b) => !b.disabled) || null;
    if (focusable) focusable.tabIndex = 0;
  }

  function addOption(opt) {
    if (buttons.has(opt.value)) return;
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'seg-btn',
        role: 'radio',
        title: opt.title || null,
        onclick: () => {
          if (btn.disabled) return;
          if (opt.value !== current) onChange(opt.value);
        },
      },
      opt.label,
    );
    btn.dataset.value = String(opt.value);
    btn.dataset.baseTitle = opt.title || '';
    buttons.set(opt.value, btn);
    el.append(btn);
  }
  for (const opt of options) addOption(opt);

  el.addEventListener('keydown', (e) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const list = [...buttons.entries()].filter(([, b]) => !b.disabled);
    if (!list.length) return;
    let i = list.findIndex(([, b]) => b === document.activeElement);
    if (i < 0) i = list.findIndex(([v]) => v === current);
    const cols = grid ? 3 : 1;
    if (e.key === 'ArrowRight') i = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') i = (i + list.length - 1) % list.length;
    else if (e.key === 'ArrowDown') i = grid ? (i + cols) % list.length : (i + 1) % list.length;
    else if (e.key === 'ArrowUp') i = grid ? (i + list.length - cols) % list.length : (i + list.length - 1) % list.length;
    else if (e.key === 'Home') i = 0;
    else i = list.length - 1;
    e.preventDefault();
    e.stopPropagation();
    const [val, btn] = list[i];
    btn.focus();
    if (val !== current) onChange(val);
  });

  refresh();
  return {
    el,
    set(v) {
      current = v;
      refresh();
    },
    setDisabled(v, reason) {
      const btn = buttons.get(v);
      if (!btn) return;
      btn.disabled = !!reason;
      btn.title = reason || btn.dataset.baseTitle || '';
      refresh();
    },
    setAllDisabled(reason) {
      for (const btn of buttons.values()) {
        btn.disabled = !!reason;
        btn.title = reason || btn.dataset.baseTitle || '';
      }
      refresh();
    },
    button: (v) => buttons.get(v),
    add(opt) {
      addOption(opt);
      refresh();
    },
    remove(v) {
      const btn = buttons.get(v);
      if (!btn) return;
      btn.remove();
      buttons.delete(v);
      refresh();
    },
  };
}

/** An on/off switch. -> { el, set(on), setDisabled(reason), setSub(text) } */
export function makeSwitch({ label, sub = '', checked = false, onChange, title = '' }) {
  const subEl = h('span', { class: 'switch-sub' }, sub);
  const el = h(
    'button',
    {
      type: 'button',
      class: 'switch',
      role: 'switch',
      'aria-checked': String(!!checked),
      title: title || null,
      onclick: () => {
        if (el.disabled) return;
        onChange(el.getAttribute('aria-checked') !== 'true');
      },
    },
    h('span', { class: 'switch-text' }, h('span', null, label), subEl),
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
  );
  el.dataset.baseTitle = title;
  return {
    el,
    set(on) {
      el.setAttribute('aria-checked', String(!!on));
    },
    setDisabled(reason) {
      el.disabled = !!reason;
      el.title = reason || el.dataset.baseTitle || '';
    },
    setSub(text) {
      subEl.textContent = text || '';
    },
  };
}

function group(label, valueEl, body, wide = false) {
  return h(
    'div',
    { class: `ctl${wide ? ' ctl-wide' : ''}` },
    h('div', { class: 'ctl-head' }, h('span', { class: 'ctl-label' }, label), valueEl || null),
    body,
  );
}

/**
 * createControls({ layout, store, lib }) -> { update(info) }
 * info (all optional): { coverage: { det: count }, passes: [{ index, label }], hop, fieldArcsec,
 *   gaia: { status, count }, channels: [lo, hi], lensNote, busy }
 */
export function createControls({ layout, store, lib = {} }) {
  const { els } = layout;
  let info = { coverage: null, passes: [], hop: 0, fieldArcsec: 0, gaia: { status: 'idle', count: 0 }, channels: null };
  const detRanges = Array.isArray(lib.DETECTORS) && lib.DETECTORS.length ? lib.DETECTORS : DETECTOR_RANGES;
  const lenses = Array.isArray(lib.LENSES) ? lib.LENSES : [];
  const cmapNames = lib.COLORMAPS ? ['gray', 'heat', 'viridis'].filter((n) => lib.COLORMAPS[n]) : ['gray'];

  // ---- view mode ------------------------------------------------------------------------------
  clear(els.viewSeg);
  const viewSeg = makeSeg({
    label: 'View mode',
    className: 'seg seg-modes',
    options: VIEW_INFO.map((v) => ({ value: v.id, label: v.label, title: v.hint })),
    value: store.get().view,
    onChange: (view) => store.set({ view, t: 0 }),
  });
  els.viewSeg.replaceWith(viewSeg.el);
  viewSeg.el.id = 'view-seg';
  els.viewSeg = viewSeg.el;
  if (!lenses.length || !lib.lensImage) viewSeg.setDisabled('lens', 'Spectral lenses are not available in this build');
  if (!lib.fitSkyModel || !lib.residualLayer) viewSeg.setDisabled('residual', 'Predicted-sky subtraction is not available in this build');
  if (!lib.predictedTrack || !lib.shiftAndStack) viewSeg.setDisabled('distance', 'The distance dial is not available in this build');

  // ---- rail -----------------------------------------------------------------------------------
  const detValue = h('span', { class: 'ctl-value' });
  const detSeg = makeSeg({
    label: 'Detector',
    className: 'det-grid',
    grid: true,
    options: detRanges.map((d) => ({ value: d.det, label: `D${d.det}`, title: `Detector ${d.det}: ${d.min.toFixed(2)}–${d.max.toFixed(2)} ${MICRON}` })),
    value: store.get().det,
    onChange: (det) => store.set({ det, t: 0 }),
  });

  const fovValue = h('span', { class: 'ctl-value' });
  const fovSeg = makeSeg({
    label: 'Field of view in arcminutes',
    options: FOVS.map((f) => ({ value: f, label: `${f}′`, title: `${f} arcminutes across` })),
    value: store.get().fov,
    onChange: (fov) => store.set({ fov }),
  });

  const stretchSeg = makeSeg({
    label: 'Brightness stretch',
    options: STRETCHES.map((s) => ({ value: s, label: s, title: { asinh: 'asinh: faint detail and bright stars together', linear: 'linear: brightness as measured', log: 'log: strongest compression', sqrt: 'square root: gentle compression' }[s] })),
    value: store.get().stretch,
    onChange: (stretch) => store.set({ stretch }),
  });

  const cmapSeg = makeSeg({
    label: 'Colormap',
    options: cmapNames.map((c) => ({ value: c, label: c, title: `${c} colormap` })),
    value: store.get().colormap,
    onChange: (colormap) => store.set({ colormap }),
  });

  const gaiaSwitch = makeSwitch({
    label: 'Gaia ghosts',
    sub: '',
    checked: store.get().gaia,
    title: 'Rings where Gaia says each star should be on the date of the frame (g)',
    onChange: (gaia) => store.set({ gaia }),
  });
  const flagsSwitch = makeSwitch({
    label: 'Flagged pixels',
    checked: store.get().flags,
    title: 'Hatch pixels the pipeline flagged as unusable (f)',
    onChange: (flags) => store.set({ flags }),
  });
  const zodiSwitch = makeSwitch({
    label: 'Clean sky',
    sub: 'zodiacal light removed',
    checked: store.get().zodi,
    title: 'Subtract the zodiacal light model that ships with every exposure',
    onChange: (zodi) => store.set({ zodi }),
  });
  const smoothSwitch = makeSwitch({
    label: 'Smooth pixels',
    checked: store.get().smooth,
    title: 'Interpolate between pixels instead of showing them as crisp squares',
    onChange: (smooth) => store.set({ smooth }),
  });

  clear(els.controlsBody);
  els.controlsBody.append(
    group('Detector', detValue, detSeg.el),
    group('Field', fovValue, fovSeg.el),
    group('Stretch', null, stretchSeg.el),
    group('Colormap', null, cmapSeg.el),
    group('Overlays', null, h('div', { class: 'switches' }, gaiaSwitch.el, flagsSwitch.el, zodiSwitch.el, smoothSwitch.el), true),
  );

  // ---- contextual mode options ----------------------------------------------------------------
  /** Views registered by plugins: id -> { id, label, title, diverging? } */
  const extraViews = new Map();
  const viewInfo = (id) => VIEW_INFO.find((v) => v.id === id) || (extraViews.has(id) ? { id, label: extraViews.get(id).label, hint: extraViews.get(id).title || extraViews.get(id).label } : VIEW_INFO[0]);
  let optsView = null;
  let optsRefs = {};

  function passOptions(select, selected) {
    clear(select);
    for (const p of info.passes) select.append(h('option', { value: String(p.index) }, `Pass ${p.index + 1} · ${p.label}`));
    select.value = String(selected);
    select.disabled = info.passes.length < 2;
    select.title = info.passes.length < 2 ? 'Only one survey pass covers this spot so far' : '';
  }

  function buildModeOpts(view) {
    optsView = view;
    optsRefs = {};
    clear(els.modeopts);
    const vinfo = viewInfo(view);
    const hint = h('p', { class: 'modeopts-hint' }, vinfo.hint);
    optsRefs.hint = hint;
    els.modeopts.append(hint);
    const s = store.get();
    if (view === 'matched') {
      const val = h('span', { class: 'val' });
      const range = h('input', {
        type: 'range',
        class: 'range',
        id: 'opt-ch',
        min: '0',
        max: '16',
        step: '1',
        value: String(s.ch),
        'aria-label': 'Spectral channel',
        oninput: () => store.set({ ch: Number(range.value), t: 0 }),
      });
      optsRefs.ch = range;
      optsRefs.chVal = val;
      els.modeopts.append(h('div', { class: 'modeopts-ctl' }, h('label', { for: 'opt-ch' }, 'Channel'), range, val));
    } else if (view === 'residual') {
      const sw = makeSwitch({
        label: 'Every exposure',
        checked: s.perExposure,
        title: 'Show the residual of every single exposure instead of one stacked residual per pass',
        onChange: (perExposure) => store.set({ perExposure, t: 0 }),
      });
      sw.el.style.width = 'auto';
      optsRefs.per = sw;
      els.modeopts.append(h('div', { class: 'modeopts-ctl' }, sw.el));
    } else if (view === 'diff') {
      const a = h('select', { class: 'select', id: 'opt-diff-a', 'aria-label': 'Pass to subtract', onchange: () => store.set({ diffA: Number(a.value) }) });
      const b = h('select', { class: 'select', id: 'opt-diff-b', 'aria-label': 'Pass to subtract from', onchange: () => store.set({ diffB: Number(b.value) }) });
      optsRefs.diffA = a;
      optsRefs.diffB = b;
      els.modeopts.append(h('div', { class: 'modeopts-ctl' }, b, h('span', { class: 'lbl' }, 'minus'), a));
    } else if (view === 'lens') {
      const sel = h('select', { class: 'select', id: 'opt-lens', 'aria-label': 'Spectral lens', onchange: () => store.set({ lens: sel.value, t: 0 }) });
      for (const lens of lenses) sel.append(h('option', { value: lens.id }, lens.label));
      sel.value = lenses.some((l) => l.id === s.lens) ? s.lens : lenses.length ? lenses[0].id : '';
      optsRefs.lens = sel;
      els.modeopts.append(h('div', { class: 'modeopts-ctl' }, h('label', { for: 'opt-lens' }, 'Lens'), sel));
    } else if (view === 'distance') {
      const val = h('span', { class: 'val' });
      const range = h('input', {
        type: 'range',
        class: 'range',
        id: 'opt-dist',
        min: '0',
        max: String(DIST_STEPS),
        step: '1',
        value: String(sliderFromDist(s.dist)),
        'aria-label': 'Distance in astronomical units, logarithmic, from 5 AU to infinity',
        oninput: () => store.set({ dist: distFromSlider(Number(range.value)) }),
      });
      optsRefs.dist = range;
      optsRefs.distVal = val;
      els.modeopts.append(h('div', { class: 'modeopts-ctl' }, h('label', { for: 'opt-dist' }, 'Distance'), range, val));
    }
    refreshModeOpts();
  }

  function refreshModeOpts() {
    const s = store.get();
    const vinfo = viewInfo(s.view);
    if (optsRefs.hint) {
      let hint = vinfo.hint;
      if (s.view === 'lens') {
        const lens = lenses.find((l) => l.id === s.lens) || lenses[0];
        if (lens && lens.description) hint = lens.description;
      }
      optsRefs.hint.textContent = hint;
    }
    if (optsRefs.ch) {
      if (document.activeElement !== optsRefs.ch) optsRefs.ch.value = String(s.ch);
      const r = detRanges.find((d) => d.det === s.det);
      let text = `${s.ch + 1} of 17`;
      if (lib.channelRange && r) {
        const [a, b] = lib.channelRange(s.det, s.ch);
        if (Number.isFinite(a)) text = `${s.ch + 1} · ${a.toFixed(2)}–${b.toFixed(2)} ${MICRON}`;
      }
      optsRefs.chVal.textContent = text;
      optsRefs.ch.setAttribute('aria-valuetext', `channel ${text}`);
    }
    if (optsRefs.per) optsRefs.per.set(s.perExposure);
    if (optsRefs.diffA) {
      const last = info.passes.length - 1;
      const b = s.diffB >= 0 && s.diffB <= last ? s.diffB : Math.max(0, last);
      const a = s.diffA >= 0 && s.diffA <= last ? s.diffA : 0;
      passOptions(optsRefs.diffA, a);
      passOptions(optsRefs.diffB, b);
    }
    if (optsRefs.lens && document.activeElement !== optsRefs.lens && lenses.some((l) => l.id === s.lens)) optsRefs.lens.value = s.lens;
    if (optsRefs.dist) {
      if (document.activeElement !== optsRefs.dist) optsRefs.dist.value = String(sliderFromDist(s.dist));
      let text = Number.isFinite(s.dist) ? fmtDistance(s.dist) : '∞ (stars fixed)';
      if (Number.isFinite(s.dist) && info.hop > 0) text += ` · hop ${info.hop >= 100 ? Math.round(info.hop) : info.hop.toFixed(1)}″`;
      optsRefs.distVal.textContent = text;
      optsRefs.dist.setAttribute('aria-valuetext', Number.isFinite(s.dist) ? `${fmtDistance(s.dist)}` : 'infinity');
    }
  }

  // ---- reflect state --------------------------------------------------------------------------
  function refresh() {
    const s = store.get();
    viewSeg.set(s.view);
    detSeg.set(s.det);
    fovSeg.set(s.fov);
    stretchSeg.set(s.stretch);
    cmapSeg.set(s.colormap);
    gaiaSwitch.set(s.gaia);
    flagsSwitch.set(s.flags);
    zodiSwitch.set(s.zodi);
    smoothSwitch.set(s.smooth);

    const r = detRanges.find((d) => d.det === s.det);
    detValue.textContent = r ? `${r.min.toFixed(2)}–${r.max.toFixed(2)} ${MICRON}` : '';
    fovValue.textContent = `${s.fov} arcmin`;

    for (const d of detRanges) {
      const btn = detSeg.button(d.det);
      if (!btn) continue;
      const count = info.coverage ? info.coverage[d.det] || 0 : null;
      btn.classList.toggle('is-empty', count === 0);
      const base = `Detector ${d.det}: ${d.min.toFixed(2)}–${d.max.toFixed(2)} ${MICRON}`;
      btn.title = count === null ? base : count === 0 ? `${base}. No exposures of this spot yet.` : `${base}. ${count} exposures of this spot.`;
    }

    const lensNow = s.view === 'lens' ? lenses.find((l) => l.id === s.lens) || lenses[0] : null;
    const lensKind = lensNow ? lensNow.kind || (lensNow.id === 'rgb' ? 'rgb' : 'depth') : '';
    const diverging = s.view === 'residual' || s.view === 'diff' || lensKind === 'depth';
    const rgb = lensKind === 'rgb';
    cmapSeg.setAllDisabled(diverging ? 'This view uses a fixed two-sided colormap: blue below zero, red above' : rgb ? 'The colour lens sets its own colours' : '');
    stretchSeg.setAllDisabled(rgb ? 'The colour lens sets its own stretch' : diverging ? 'Two-sided views are shown on a linear scale so that zero stays neutral' : '');

    const g = info.gaia || { status: 'idle', count: 0 };
    gaiaSwitch.setSub(
      g.status === 'loading'
        ? 'asking the Gaia archive…'
        : g.status === 'error'
          ? 'catalogue unavailable'
          : g.status === 'ready'
            ? `${g.count} star${g.count === 1 ? '' : 's'} in the field`
            : '',
    );
    gaiaSwitch.setDisabled(lib.propagate ? '' : 'Gaia overlays are not available in this build');

    if (optsView !== s.view) buildModeOpts(s.view);
    else refreshModeOpts();
  }

  store.subscribe(refresh);
  refresh();

  return {
    update(patch) {
      info = { ...info, ...patch };
      refresh();
    },
    refresh,
    /** Add a plugin view to the view-mode control. */
    addView({ id, label, title }) {
      if (VIEW_INFO.some((v) => v.id === id) || extraViews.has(id)) return false;
      extraViews.set(id, { id, label: label || id, title: title || '' });
      viewSeg.add({ value: id, label: label || id, title: title || '' });
      viewSeg.set(store.get().view);
      if (store.get().view === id) buildModeOpts(id);
      return true;
    },
    removeView(id) {
      if (!extraViews.delete(id)) return;
      viewSeg.remove(id);
    },
    hasView: (id) => VIEW_INFO.some((v) => v.id === id) || extraViews.has(id),
  };
}
