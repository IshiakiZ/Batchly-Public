// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The side column: Spectrum, Light curve, Motion, Candidates and About this view. The plots
// themselves come from web/src/plots/* (passed in; any of them may be missing).

import { h, clear } from './layout.js';
import { VIEW_INFO } from '../pipeline.js';

function emptyBlock(title, text, action = null) {
  return h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), h('p', { class: 'empty-text' }, text), action);
}

function fmtPos(formatCoord, ra, dec) {
  if (formatCoord) {
    try {
      const f = formatCoord(ra, dec);
      if (f && f.deg) return f.deg;
    } catch {
      // fall through
    }
  }
  return `${ra.toFixed(5)} ${dec >= 0 ? '+' : ''}${dec.toFixed(5)}`;
}

/**
 * createPanels({ layout, plots, lib, onFullSpectrum, onPickCandidate, onClearSource })
 * plots: { createSpectrumPlot?, createLightCurvePlot?, createMotionMeter? }
 */
export function createPanels({ layout, plots = {}, lib = {}, onFullSpectrum = () => {}, onPickCandidate = () => {}, onClearSource = () => {} }) {
  const { els } = layout;

  // ---- shared "which source" header ----------------------------------------------------------
  function sourceHeader() {
    const what = h('p', { class: 'panel-what' });
    const actions = h('div', { class: 'panel-actions' });
    const head = h('div', { class: 'panel-head' }, what, actions);
    head.hidden = true;
    return { head, what, actions };
  }

  function mountPlot(host, factory, missingTitle, missingText) {
    if (typeof factory !== 'function') {
      host.append(emptyBlock(missingTitle, missingText));
      return null;
    }
    try {
      return factory(host);
    } catch (err) {
      console.warn('[tombaugh] plot failed to mount', err);
      clear(host);
      host.append(emptyBlock(missingTitle, 'This plot could not be drawn in this browser.'));
      return null;
    }
  }

  // ---- Spectrum ------------------------------------------------------------------------------
  const spec = sourceHeader();
  const specHost = h('div', { class: 'plot-host' });
  const specNote = h('p', { class: 'panel-note' }, 'Click a source in the image. Every loaded exposure contributes one point at its own wavelength, so one click gives a spectrum.');
  const btnFull = h('button', { type: 'button', class: 'btn btn-small', onclick: () => onFullSpectrum() }, 'Load all six detectors');
  btnFull.hidden = true;
  const btnClear = h('button', { type: 'button', class: 'btn btn-small btn-quiet', onclick: () => onClearSource() }, 'Clear');
  spec.actions.append(btnFull, btnClear);
  clear(els.spectrumBody).append(spec.head, specHost, specNote);
  const spectrumPlot = mountPlot(specHost, plots.createSpectrumPlot, 'Spectrum', 'The spectrum plot is not available in this build.');

  // ---- Light curve ---------------------------------------------------------------------------
  const lc = sourceHeader();
  const lcHost = h('div', { class: 'plot-host' });
  const LC_NOTE = 'Brightness over time, relative to the source’s own average spectrum, so that a change of wavelength is not mistaken for a change of brightness.';
  const lcNote = h('p', { class: 'panel-note' }, LC_NOTE);
  clear(els.lightcurveBody).append(lc.head, lcHost, lcNote);
  const lightPlot = mountPlot(lcHost, plots.createLightCurvePlot, 'Light curve', 'The light-curve plot is not available in this build.');

  // ---- Motion --------------------------------------------------------------------------------
  const mo = sourceHeader();
  const moHost = h('div', { class: 'plot-host is-short' });
  const MO_NOTE = 'The source is centroided in the stack of each survey pass; a straight line through those positions gives its motion, compared with the proper motion Gaia lists for the nearest star.';
  const moNote = h('p', { class: 'panel-note' }, MO_NOTE);
  clear(els.motionBody).append(mo.head, moHost, moNote);
  const motionMeter = mountPlot(moHost, plots.createMotionMeter, 'Motion', 'The motion meter is not available in this build.');

  // ---- Candidates ----------------------------------------------------------------------------
  const candHost = h('div');
  const candNote = h('p', { class: 'panel-note' });
  clear(els.candidatesBody).append(candHost, candNote);
  let candidates = [];
  let candidateActive = -1;

  function renderCandidates(status, text) {
    clear(candHost);
    candNote.textContent = '';
    els.candidatesCount.hidden = !(status === 'ready' && candidates.length);
    els.candidatesCount.textContent = candidates.length ? String(candidates.length) : '';
    if (status === 'working') {
      candHost.append(emptyBlock('Searching this field', text || 'Fitting a spectrum to every pixel and looking for places where the sky did not match it.'));
      return;
    }
    if (status === 'unavailable') {
      candHost.append(emptyBlock('No search for this field', text || 'The change search needs the sky model, which is not available here.'));
      return;
    }
    if (status !== 'ready') {
      candHost.append(emptyBlock('Nothing searched yet', text || 'Once the exposures are loaded, Tombaugh looks for places that moved or changed brightness and lists them here.'));
      return;
    }
    const aside = setAsideNote(candidates);
    if (!candidates.length) {
      candHost.append(emptyBlock('Nothing stands out', aside ? `Nothing in this field moved or changed its brightness by more than the noise allows. ${aside}` : 'No pixel in this field changed by more than the noise allows. Try another detector or a wider field.'));
      return;
    }
    const list = h('div', { class: 'cand-list', role: 'list' });
    candidates.forEach((c, i) => {
      const kind = c.kind === 'moved' ? 'Moved' : c.kind === 'varies' ? 'Changed brightness' : 'Changed';
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'cand',
          role: 'listitem',
          'aria-current': i === candidateActive ? 'true' : null,
          'aria-label': `Candidate ${i + 1}: ${kind}, significance ${Number.isFinite(c.score) ? c.score.toFixed(1) : 'unknown'} sigma. Mark it and measure it.`,
          onclick: () => onPickCandidate(c, i),
        },
        h('span', { class: 'cand-n' }, String(i + 1)),
        h('span', { class: 'cand-main' }, h('span', { class: 'cand-kind' }, kind), h('span', { class: 'cand-pos' }, fmtPos(lib.formatCoord, c.ra, c.dec)), whyNote(c) ? h('span', { class: 'cand-why' }, whyNote(c)) : null),
        h('span', { class: 'cand-score' }, Number.isFinite(c.score) ? `${c.score.toFixed(1)}σ` : ''),
      );
      list.append(btn);
    });
    candHost.append(list);
    candNote.textContent =
      `Numbered marks appear on the image in the Residual view. Click a candidate to mark it and read its spectrum, light curve and motion. A candidate is a place to look, not a discovery: bright stars, image edges and cosmic rays can all leave residue.${aside ? ` ${aside}` : ''}`;
  }
  renderCandidates('idle');

  // ---- About ---------------------------------------------------------------------------------
  const aboutText = h('div', { class: 'about' });
  const aboutNotes = h('div', { class: 'about-notes' });
  const explainHost = h('div', { class: 'panel-actions' });
  const factsHead = h('p', { class: 'subhead' }, 'This field');
  const facts = h('dl', { class: 'facts' });
  clear(els.aboutBody).append(aboutText, aboutNotes, explainHost, factsHead, facts);

  /** What the search set aside: the patches every bright fixed star leaves. '' when none. */
  function setAsideNote(list) {
    const k = list && Number.isFinite(list.setAside) ? list.setAside : 0;
    const e = list && Number.isFinite(list.setAsideEdge) ? list.setAsideEdge : 0;
    const parts = [];
    if (k > 0) parts.push(`${k} leftover patch${k === 1 ? '' : 'es'} on bright fixed stars ${k === 1 ? 'was' : 'were'} set aside: the star's total light did not change, only its image did.`);
    if (e > 0) parts.push(`${e} patch${e === 1 ? '' : 'es'} at the edge of the data ${e === 1 ? 'was' : 'were'} set aside: where one pass ends there is nothing to compare with.`);
    return parts.join(' ');
  }

  /** One line on why a candidate is listed: a saturated star's halo, or a source whose total light changed. */
  function whyNote(c) {
    const sat = saturatedNote(c);
    if (sat) return sat;
    const net = c && c.net;
    if (!net || !net.onSource || !Number.isFinite(net.frac) || !Number.isFinite(net.sigma)) return '';
    const pct = Math.abs(100 * net.frac);
    const size = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
    return `The total light of this source ${net.frac > 0 ? 'rose' : 'fell'} by ${size} %${net.label ? ` in ${net.label}` : ''} (${Math.abs(net.sigma).toFixed(1)} sigma).`;
  }

  /** One line on a candidate that is a saturated star: what its halo did between the passes. */
  function saturatedNote(c) {
    if (!c || !c.saturated) return '';
    const lumps = c.peaks > 1 ? `; ${c.peaks} residual patches belong to it` : '';
    const when = Array.isArray(c.between) && c.between[0] && c.between[1] && c.between[0] !== c.between[1] ? `between ${c.between[0]} and ${c.between[1]}` : 'between the passes';
    if (c.kind === 'moved') return `Saturated star: its halo shifted${c.towards ? ` ${c.towards}` : ''} ${when}${lumps}.`;
    if (c.brighter === true) return `Saturated star: its halo brightened ${when}${lumps}.`;
    if (c.brighter === false) return `Saturated star: its halo faded ${when}${lumps}.`;
    return `Saturated star: its halo changed between the passes${lumps}.`;
  }

  function setSourceHeader(target, source) {
    if (!source) {
      target.head.hidden = true;
      return;
    }
    target.head.hidden = false;
    clear(target.what);
    target.what.append(source.label ? `${source.label}  ` : 'Source at  ', h('span', { class: 'num' }, fmtPos(lib.formatCoord, source.ra, source.dec)));
  }

  return {
    explainHost,
    spectrumPlot,
    lightPlot,
    motionMeter,

    /** source: { ra, dec, label } | null */
    setSource(source) {
      setSourceHeader(spec, source);
      setSourceHeader(lc, source);
      setSourceHeader(mo, source);
      if (!source) {
        if (spectrumPlot) spectrumPlot.clear();
        if (lightPlot) lightPlot.clear();
        if (motionMeter) motionMeter.clear();
        btnFull.hidden = true;
      }
    },

    setSpectrum({ points = [], binned = [], title = '', lens = null, note = '', more = null, colorBy = undefined, heading = '', features = null } = {}) {
      if (heading) {
        // Points handed in by a tool rather than measured from a click: name them in the header.
        spec.head.hidden = false;
        clear(spec.what).append(heading);
      }
      if (spectrumPlot) {
        try {
          const data = { points, binned, lens: lens || undefined, title };
          if (colorBy) data.colorBy = colorBy;
          if (Array.isArray(features) && features.length) data.features = features;
          spectrumPlot.setData(data);
        } catch (err) {
          console.warn('[tombaugh] spectrum plot', err);
        }
      }
      specNote.textContent = note || '';
      specNote.hidden = !note;
      btnFull.hidden = !more;
      if (more) {
        btnFull.textContent = more.label;
        btnFull.disabled = !!more.busy;
        btnFull.title = more.title || '';
      }
    },

    setLightCurve({ points = [], title = '', note = '' } = {}) {
      if (lightPlot) {
        try {
          lightPlot.setData({ points, title });
        } catch (err) {
          console.warn('[tombaugh] light curve plot', err);
        }
      }
      if (note) lcNote.textContent = note;
      else lcNote.textContent = LC_NOTE;
    },

    setMotion({ measured = null, gaia = null, track = [], title = '', note = '' } = {}) {
      if (motionMeter) {
        try {
          if (measured || track.length) motionMeter.setData({ measured, gaia, track, title });
          else motionMeter.clear();
        } catch (err) {
          console.warn('[tombaugh] motion meter', err);
        }
      }
      if (note) moNote.textContent = note;
      else moNote.textContent = MO_NOTE;
    },

    /** status: 'idle' | 'working' | 'ready' | 'unavailable' */
    setCandidates({ status = 'idle', list = [], active = -1, text = '' } = {}) {
      candidates = list;
      candidateActive = active;
      renderCandidates(status, text);
    },

    setAbout({ view, title = null, about = null, notes = [], facts: rows = [], explain = null } = {}) {
      clear(explainHost);
      if (explain) explainHost.append(h('button', { type: 'button', class: 'btn btn-small', onclick: explain.onClick }, explain.label));
      const info = VIEW_INFO.find((v) => v.id === view);
      clear(aboutText).append(h('h3', null, title || (info ? `${info.label} view` : 'This view')), h('p', null, about || (info ? info.about : '')));
      clear(aboutNotes);
      for (const note of notes) aboutNotes.append(h('p', { class: 'about-note' }, note));
      aboutNotes.hidden = !notes.length;
      clear(facts);
      for (const [key, value] of rows) {
        if (value === null || value === undefined || value === '') continue;
        facts.append(h('dt', null, key), h('dd', null, value));
      }
      factsHead.hidden = !facts.childElementCount;
    },
  };
}
