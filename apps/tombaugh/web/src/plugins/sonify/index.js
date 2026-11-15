// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Listen plugin: hear the spectrum and the light curve of the selected source.
//   - a "Listen" button in the viewer tool strip (group 'extra') that plays or stops the spectrum
//   - a panel with Play spectrum, Play light curve, Stop, a volume slider, a small score of the
//     notes with a playhead, and the same information in words in an aria-live region
// Sound starts only from a click or key press on one of those controls, never by itself.
//
// While playing, the plugin dispatches on window:
//   'tombaugh:sonify-cursor'  detail = { kind: 'spectrum' | 'lightcurve', playing: true, index, total,
//                                        wave?, flux?, mjd?, ratio? }  for each note as it sounds, and
//                             detail = { kind, playing: false, wave: null, mjd: null } when it ends,
//                             so other parts of the page may highlight the current wavelength
//   'tombaugh:sonify-play'    detail = { kind, scheduled, duration }  once the notes are scheduled
//                             (also what tests assert on, since sound cannot be asserted)

import { describeLightCurve, describeSpectrum, lightCurveToNotes, spectrumToNotes, SWEEP, TOP_STEP } from './mapping.js';
import { ensureSonifyStyles } from './sonify.css.js';
import { createSynth } from './synth.js';

export const meta = {
  id: 'sonify',
  title: 'Listen',
  description: 'Plays the spectrum and light curve of the selected source as sound, with a text description for screen readers.',
};

export const CURSOR_EVENT = 'tombaugh:sonify-cursor';
export const PLAY_EVENT = 'tombaugh:sonify-play';
const VOLUME_KEY = 'tombaugh.sonify.volume';

export const TEXT = Object.freeze({
  lead: 'Wavelength runs left to right in time. Brighter is higher, a surer measurement is louder, and an absorption band is a drop in pitch.',
  noSource: 'Click a source in the image first. Its spectrum can then be played.',
  noSpectrum: 'No spectrum has been measured for this source yet.',
  noCurve: 'No light curve for this source yet. The spectrum can still be played.',
  toolTitle: 'Listen to the spectrum of the selected source',
  toolDisabled: 'Click a source in the image first',
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const SVG_NS = 'http://www.w3.org/2000/svg';
const SCORE_W = 400;
const SCORE_H = 76;

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
  return node;
}

function icon(path) {
  const s = svg('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true', focusable: 'false' });
  s.append(svg('path', { d: path }));
  return s;
}
const PLAY_ICON = 'M1.5 0.5 L9.5 5 L1.5 9.5 Z';
const STOP_ICON = 'M1 1 H9 V9 H1 Z';

/** Seconds drawn across the score: the whole sweep for a spectrum, so the axis ends mean what they say. */
function scoreSpan(plan) {
  if (plan.kind === 'spectrum') return SWEEP.seconds;
  const last = plan.notes[plan.notes.length - 1];
  return Math.max(last ? last.t : 0, 0.001);
}
const scoreX = (note, span) => 3 + (Math.min(note.t, span) / span) * (SCORE_W - 14);

function readVolume() {
  try {
    const v = Number(globalThis.localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(v) && v > 0 && v <= 1) return v;
  } catch {
    // storage is unavailable in a sandboxed frame
  }
  return 0.7;
}

function saveVolume(v) {
  try {
    globalThis.localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    // not remembered, nothing else lost
  }
}

function emit(name, detail) {
  try {
    globalThis.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    // no window, or a listener threw
  }
}

export function install(app, { synth: injectedSynth = null } = {}) {
  if (!app || typeof app.on !== 'function') return undefined;
  if (typeof document === 'undefined') return undefined;
  ensureSonifyStyles(document);

  const synth = injectedSynth || createSynth();
  synth.setVolume(readVolume());

  let view = null;
  let playing = null; // 'spectrum' | 'lightcurve' | null
  let plan = null; // the notes drawn in the score
  let dots = [];
  let lit = null;
  let disposed = false;
  let message = '';
  const counters = { plays: 0, scheduled: 0, cursor: 0, lastKind: null };

  const selection = () => {
    try {
      const s = typeof app.selection === 'function' ? app.selection() : null;
      return s && typeof s === 'object' ? s : null;
    } catch {
      return null;
    }
  };
  const spectrumOf = (sel) => (sel && Array.isArray(sel.binned) && sel.binned.length ? sel.binned : sel && Array.isArray(sel.spectrum) ? sel.spectrum : []);
  const curveOf = (sel) => (sel && Array.isArray(sel.lightCurve) ? sel.lightCurve : []);

  /** What can be played right now, and why not when it cannot. */
  function availability() {
    const sel = selection();
    const spec = sel ? spectrumToNotes(spectrumOf(sel)) : { notes: [] };
    const curve = sel ? lightCurveToNotes(curveOf(sel)) : { notes: [] };
    let reason = '';
    if (!synth.available) reason = 'This browser cannot play sound from a web page. The description below says the same in words.';
    else if (!sel) reason = TEXT.noSource;
    else if (!spec.notes.length && !curve.notes.length) reason = TEXT.noSpectrum;
    else if (!curve.notes.length) reason = TEXT.noCurve;
    return { sel, spec, curve, reason, canSpectrum: synth.available && spec.notes.length > 0, canCurve: synth.available && curve.notes.length > 0 };
  }

  // ---- score ---------------------------------------------------------------------------------

  function drawScore(nextPlan) {
    plan = nextPlan && nextPlan.notes && nextPlan.notes.length ? nextPlan : null;
    dots = [];
    lit = null;
    if (!view) return;
    const g = view.notes;
    g.replaceChildren();
    view.head.style.transform = 'translateX(0px)';
    view.head.setAttribute('visibility', 'hidden');
    view.now.textContent = '';
    if (!plan) {
      const t = svg('text', { class: 'tbsn-empty', x: SCORE_W / 2, y: SCORE_H / 2 + 4, 'text-anchor': 'middle' });
      t.textContent = 'Nothing to play yet';
      g.append(t);
      view.left.textContent = '';
      view.right.textContent = '';
      return;
    }
    const pad = 7;
    const span = scoreSpan(plan);
    for (const note of plan.notes) {
      const x = scoreX(note, span);
      const y = pad + (1 - note.step / TOP_STEP) * (SCORE_H - 2 * pad);
      const w = Math.max(2.2, Math.min(9, ((note.dur * 0.55) / span) * SCORE_W));
      const r = svg('rect', { class: 'tbsn-dot', x: x.toFixed(1), y: (y - 1.5).toFixed(1), width: w.toFixed(1), height: 3, rx: 1, opacity: (0.35 + 0.65 * note.gain).toFixed(2) });
      if (note.dip) r.setAttribute('data-dip', '1');
      g.append(r);
      dots.push(r);
    }
    if (plan.kind === 'spectrum') {
      view.left.textContent = `${SWEEP.waveMin} µm`;
      view.right.textContent = `${SWEEP.waveMax.toFixed(1)} µm`;
    } else {
      view.left.textContent = 'first pass';
      view.right.textContent = plan.passes > 1 ? `pass ${plan.passes}` : '';
    }
  }

  function moveCursor(note, index) {
    counters.cursor++;
    const detail = { kind: playing, playing: true, index, total: plan ? plan.notes.length : 0 };
    if (isNum(note.wave)) {
      detail.wave = note.wave;
      detail.flux = note.flux;
    }
    if (isNum(note.mjd)) {
      detail.mjd = note.mjd;
      detail.ratio = note.ratio;
    }
    emit(CURSOR_EVENT, detail);
    if (!view || !plan) return;
    const x = scoreX(note, scoreSpan(plan));
    view.head.setAttribute('visibility', 'visible');
    view.head.style.transform = `translateX(${x.toFixed(1)}px)`;
    if (lit) lit.classList.remove('is-on');
    lit = dots[index] || null;
    if (lit) lit.classList.add('is-on');
    view.now.textContent = isNum(note.wave) ? `${note.wave.toFixed(2)} µm` : isNum(note.ratio) ? `× ${note.ratio.toFixed(2)}` : '';
  }

  // ---- state ---------------------------------------------------------------------------------

  function sync() {
    const a = availability();
    try {
      if (tool) {
        tool.setDisabled(!a.canSpectrum, !synth.available ? 'This browser cannot play sound' : a.sel ? TEXT.noSpectrum : TEXT.toolDisabled);
        tool.setActive(playing === 'spectrum');
      }
    } catch {
      // the tool strip is gone
    }
    if (!view) return a;
    view.playSpec.disabled = !a.canSpectrum;
    view.playCurve.disabled = !a.canCurve;
    view.stop.disabled = !playing;
    view.playSpec.setAttribute('aria-pressed', String(playing === 'spectrum'));
    view.playCurve.setAttribute('aria-pressed', String(playing === 'lightcurve'));
    const reason = message || a.reason;
    view.reason.textContent = reason;
    view.reason.hidden = !reason;
    for (const b of [view.playSpec, view.playCurve]) {
      if (b.disabled && reason) b.setAttribute('aria-describedby', view.reason.id);
      else b.removeAttribute('aria-describedby');
    }
    return a;
  }

  function describe() {
    if (!view) return;
    const sel = selection();
    if (!sel) {
      view.desc.textContent = '';
      view.desc2.textContent = '';
      view.words.hidden = true;
      return;
    }
    view.words.hidden = false;
    // Only touch the live region when the words change, so a screen reader is not made to
    // repeat itself each time more frames arrive.
    const first = describeSpectrum(spectrumOf(sel));
    const second = curveOf(sel).length ? describeLightCurve(curveOf(sel)) : '';
    if (view.desc.textContent !== first) view.desc.textContent = first;
    if (view.desc2.textContent !== second) view.desc2.textContent = second;
  }

  function ended(kind) {
    if (playing === kind) playing = null;
    if (lit) lit.classList.remove('is-on');
    lit = null;
    if (view) {
      view.head.setAttribute('visibility', 'hidden');
      view.now.textContent = '';
    }
    emit(CURSOR_EVENT, { kind, playing: false, wave: null, mjd: null });
    if (!disposed) sync();
  }

  function play(kind) {
    if (disposed) return { ok: false };
    const a = availability();
    const next = kind === 'lightcurve' ? a.curve : a.spec;
    message = '';
    if (!next.notes.length || !synth.available) {
      sync();
      return { ok: false };
    }
    // Stopping first lets the previous performance report its own end before the new one starts.
    synth.stop({ fadeMs: 40 });
    drawScore(next);
    playing = kind;
    const result = synth.play(next, {
      onNote: moveCursor,
      onEnd: () => ended(kind),
    });
    if (!result.ok) {
      playing = null;
      message = result.reason || 'Sound could not be started.';
      sync();
      return result;
    }
    counters.plays++;
    counters.scheduled = result.scheduled;
    counters.lastKind = kind;
    emit(PLAY_EVENT, { kind, scheduled: result.scheduled, duration: result.duration });
    sync();
    return result;
  }

  function stop() {
    synth.stop({ fadeMs: 140 });
    playing = null;
    sync();
  }

  function refresh() {
    try {
      if (playing) synth.stop({ fadeMs: 80 });
      playing = null;
      message = '';
      const a = sync();
      drawScore(a.spec.notes.length ? a.spec : a.curve.notes.length ? a.curve : null);
      describe();
    } catch (err) {
      console.warn('[tombaugh] sonify', err);
    }
  }

  // ---- tool strip and panel ------------------------------------------------------------------

  let tool = null;
  if (typeof app.addTool === 'function') {
    try {
      tool = app.addTool({
        id: 'sonify',
        label: 'Listen',
        title: TEXT.toolTitle,
        group: 'extra',
        onClick: () => {
          if (playing === 'spectrum') stop();
          else play('spectrum');
        },
      });
    } catch {
      tool = null;
    }
  }

  function render(container) {
    const uid = `tbsn-${Math.random().toString(36).slice(2, 8)}`;
    const score = svg('svg', { class: 'tbsn-score', viewBox: `0 0 ${SCORE_W} ${SCORE_H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'The notes that will play: time runs left to right, higher notes are drawn higher.' });
    for (const f of [0.25, 0.5, 0.75]) score.append(svg('line', { class: 'tbsn-grid', x1: 0, x2: SCORE_W, y1: SCORE_H * f, y2: SCORE_H * f }));
    const notes = svg('g', {});
    const head = svg('line', { class: 'tbsn-head', x1: 0, x2: 0, y1: 0, y2: SCORE_H, visibility: 'hidden' });
    score.append(notes, head);
    const left = el('span');
    const now = el('span', { class: 'tbsn-now', 'aria-hidden': 'true' });
    const right = el('span');
    const playSpec = el('button', { class: 'tbsn-btn', type: 'button', 'data-act': 'spectrum', 'aria-pressed': 'false', onclick: () => play('spectrum') }, icon(PLAY_ICON), 'Play spectrum');
    const playCurve = el('button', { class: 'tbsn-btn', type: 'button', 'data-act': 'lightcurve', 'aria-pressed': 'false', onclick: () => play('lightcurve') }, icon(PLAY_ICON), 'Play light curve');
    const stopBtn = el('button', { class: 'tbsn-btn', type: 'button', 'data-act': 'stop', onclick: stop }, icon(STOP_ICON), 'Stop');
    const percent = () => `${Math.round(synth.volume * 100)}%`;
    const out = el('output', { for: `${uid}-vol`, text: percent() });
    const slider = el('input', {
      type: 'range',
      id: `${uid}-vol`,
      min: 0,
      max: 100,
      step: 5,
      value: Math.round(synth.volume * 100),
      oninput: (e) => {
        synth.setVolume(Number(e.target.value) / 100);
        out.textContent = percent();
        saveVolume(synth.volume);
      },
    });
    const reason = el('p', { class: 'tbsn-reason', id: `${uid}-why`, role: 'status', hidden: true });
    const desc = el('p', { class: 'tbsn-desc' });
    const desc2 = el('p', { class: 'tbsn-desc' });
    const words = el('div', { class: 'tbsn-words', 'aria-live': 'polite', hidden: true }, el('span', { class: 'tbsn-label', text: 'In words' }), desc, desc2);
    const root = el(
      'div',
      {
        class: 'tbsn',
        onkeydown: (e) => {
          if (e.key === 'Escape' && playing) {
            e.stopPropagation();
            stop();
          }
        },
      },
      el('p', { class: 'tbsn-lead', text: TEXT.lead }),
      el('div', { class: 'tbsn-stage' }, score, el('div', { class: 'tbsn-axis' }, left, now, right)),
      el('div', { class: 'tbsn-controls', role: 'group', 'aria-label': 'Playback' }, playSpec, playCurve, stopBtn),
      el('div', { class: 'tbsn-vol' }, el('label', { for: `${uid}-vol`, text: 'Volume' }), slider, out),
      reason,
      words,
    );
    container.append(root);
    view = { root, notes, head, left, now, right, playSpec, playCurve, stop: stopBtn, reason, desc, desc2, words };
    refresh();
    return {
      update: refresh,
      dispose() {
        view = null;
        root.remove();
      },
    };
  }

  let panel = null;
  if (typeof app.addPanel === 'function') {
    try {
      panel = app.addPanel({ id: meta.id, title: meta.title, order: 45, render });
    } catch {
      panel = null;
    }
  }

  const offs = [];
  for (const event of ['select', 'target']) {
    try {
      const off = app.on(event, refresh);
      if (typeof off === 'function') offs.push(off);
    } catch {
      // the shell does not know this event
    }
  }
  // More frames can add points to the same selection: refresh what is offered once the
  // arrivals pause, and leave a performance that is under way alone.
  let framesTimer = 0;
  try {
    const off = app.on('frames', () => {
      clearTimeout(framesTimer);
      framesTimer = setTimeout(() => {
        if (!disposed && !playing) refresh();
      }, 400);
    });
    if (typeof off === 'function') offs.push(off);
  } catch {
    // ignore
  }
  sync();

  return {
    play,
    stop,
    /** Counters for tests and the demo: what was scheduled, not what was heard. */
    state: () => ({ ...counters, playing, synth: synth.stats() }),
    dispose() {
      disposed = true;
      clearTimeout(framesTimer);
      try {
        synth.dispose();
      } catch {
        // nothing to release
      }
      playing = null;
      for (const off of offs.splice(0)) {
        try {
          off();
        } catch {
          // already gone
        }
      }
      for (const handle of [tool, panel]) {
        try {
          if (handle && typeof handle.remove === 'function') handle.remove();
        } catch {
          // already gone
        }
      }
      view = null;
    },
  };
}
