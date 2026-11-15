// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// captions.js - the on-screen caption layer, designed to be recorded: a lower-third band (Arial
// Black title, Arial text, Paper on translucent Ink, a thin Signal rule, a progress hairline),
// full-frame title and end cards, a discreet preparation line, a "ready" prompt, an address chip
// and the Stop control. The layer never takes pointer events except on its own buttons (and, in
// recording mode, on a shield that keeps hover chrome off the page during a take).
//
// createCaptions(opts) -> {
//   el, show(caption), card(caption), clear(), hint(text|null), status(info|null), ready(text),
//   url(text|null), progress(fraction), setTag(text|null), setRecording(bool), setGuide(bool),
//   setRunning(bool), showControls(bool), promote(), layout(), destroy() }
// opts: { doc, win, recording, guide, live (announce captions to screen readers, default true),
//         reducedMotion, onStop(), onShield() }
//
// frameRect(w, h, opts) is pure and exported for tests.

import { injectStyles } from './story.css.js';

/** Height of the lower-third band, in caption units (see story.css.js). */
export const BAND_UNITS = 9.2;

/**
 * The frame captions are laid out in, and the caption unit `u` (px).
 * Recording: the largest centred 16:9 rectangle of the window, u = 1 % of its width, so a
 * 1280 px wide recording gets 36 px caption text. Otherwise the whole window and a smaller unit.
 */
export function frameRect(w, h, { recording = false, aspect = 16 / 9 } = {}) {
  const W = Math.max(0, Number(w) || 0);
  const H = Math.max(0, Number(h) || 0);
  if (!recording) {
    const u = Math.min(8.4, Math.max(5.6, W * 0.0062));
    return { x: 0, y: 0, w: W, h: H, u };
  }
  let fw = W;
  let fh = W / aspect;
  if (fh > H) {
    fh = H;
    fw = H * aspect;
  }
  fw = Math.floor(fw);
  fh = Math.floor(fh);
  return { x: Math.floor((W - fw) / 2), y: Math.floor((H - fh) / 2), w: fw, h: fh, u: fw / 100 };
}

/** Split "Press Space to continue" into text and key parts, for <kbd> styling. Pure. */
export function splitKeys(text) {
  const out = [];
  const re = /\b(Space|Esc|Enter)\b/g;
  const s = String(text ?? '');
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ key: m[1] });
    last = m.index + m[1].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

export function createCaptions(opts = {}) {
  const doc = opts.doc || globalThis.document;
  const win = opts.win || (doc && doc.defaultView) || globalThis.window;
  injectStyles(doc);
  const root = doc.documentElement;
  let recording = !!opts.recording;
  let destroyed = false;
  const live = opts.live !== false;

  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const layer = el('div', 'tbs-layer');
  layer.setAttribute('data-testid', 'story-layer');
  if (opts.reducedMotion) layer.classList.add('is-still');

  const shield = el('div', 'tbs-shield');
  shield.hidden = true;
  const frame = el('div', 'tbs-frame');
  const guide = el('div', 'tbs-guide');
  guide.hidden = !opts.guide;
  guide.setAttribute('aria-hidden', 'true');
  const mark = el('div', 'tbs-mark', 'TOMBAUGH');
  mark.setAttribute('aria-hidden', 'true');
  const tag = el('div', 'tbs-tag');
  tag.hidden = true;

  const band = el('div', 'tbs-band');
  band.hidden = true;
  band.setAttribute('data-testid', 'story-caption');
  if (live) band.setAttribute('aria-hidden', 'true');
  const urlBox = el('div', 'tbs-url');
  urlBox.hidden = true;
  const urlText = el('span');
  urlText.setAttribute('data-testid', 'story-url');
  urlBox.append(urlText);
  const bandIn = el('div', 'tbs-band__in');
  const words = el('div', 'tbs-words');
  const title = el('p', 'tbs-title');
  const text = el('p', 'tbs-text');
  words.append(title, text);
  bandIn.append(el('div', 'tbs-rule'), words);
  const hintEl = el('p', 'tbs-hint');
  hintEl.hidden = true;
  const hair = el('div', 'tbs-hair');
  const hairFill = el('i');
  hair.append(hairFill);
  band.append(urlBox, bandIn, hintEl, hair);

  const status = el('div', 'tbs-status');
  status.hidden = true;
  status.setAttribute('data-testid', 'story-status');
  status.setAttribute('role', 'status');
  const statusMain = el('div', 'tbs-status__main');
  const statusSub = el('div', 'tbs-status__sub');
  const statusBar = el('div', 'tbs-status__bar');
  const statusFill = el('i');
  statusBar.append(statusFill);
  status.append(statusMain, statusSub, statusBar);

  frame.append(guide, mark, tag, band, status);

  const card = el('div', 'tbs-card');
  card.hidden = true;
  card.setAttribute('data-testid', 'story-card');
  if (live) card.setAttribute('aria-hidden', 'true');
  const cardIn = el('div', 'tbs-card__in');
  card.append(cardIn);

  const controls = el('div', 'tbs-controls');
  const keys = el('span', 'tbs-keys', 'Space pause · ← → step · R restart · Esc stop');
  const stop = el('button', 'tbs-stop', 'Stop tour');
  stop.type = 'button';
  stop.setAttribute('data-testid', 'story-stop');
  stop.title = 'Stop and go back to where you were (Esc)';
  controls.append(keys, stop);

  const liveEl = el('div', 'tbs-sr');
  liveEl.setAttribute('aria-live', 'polite');
  liveEl.setAttribute('data-testid', 'story-live');

  layer.append(shield, frame, card, controls, liveEl);

  const safe = (fn) => (ev) => {
    try {
      if (fn) fn(ev);
    } catch (err) {
      console.warn('[story] control failed', err);
    }
  };
  stop.addEventListener('click', safe(opts.onStop));
  shield.addEventListener('click', safe(opts.onShield));

  // The layer goes into the top layer when the browser can do that, so that captions stay above
  // a modal <dialog> (the sky map). Otherwise it is a fixed element with a very high z-index.
  const canPop = typeof layer.showPopover === 'function';
  if (canPop) layer.setAttribute('popover', 'manual');
  doc.body.appendChild(layer);
  let popped = false;
  let dialogsSeen = 0;
  function pop() {
    if (!canPop) return;
    try {
      layer.showPopover();
      popped = true;
    } catch {
      popped = false;
    }
  }
  pop();

  function promote() {
    if (!canPop || destroyed) return;
    let open = 0;
    try {
      open = doc.querySelectorAll('dialog[open]').length;
    } catch {
      open = 0;
    }
    if (open === dialogsSeen && popped) return;
    dialogsSeen = open;
    try {
      if (popped) layer.hidePopover();
    } catch {
      // not open
    }
    pop();
  }

  let rect = { x: 0, y: 0, w: 0, h: 0, u: 8 };
  function layout() {
    if (destroyed) return rect;
    const w = (win && win.innerWidth) || root.clientWidth || 0;
    const h = (win && win.innerHeight) || root.clientHeight || 0;
    rect = frameRect(w, h, { recording });
    const s = layer.style;
    s.setProperty('--tbs-u', `${rect.u}px`);
    s.setProperty('--tbs-fx', `${rect.x}px`);
    s.setProperty('--tbs-fy', `${rect.y}px`);
    s.setProperty('--tbs-fw', `${rect.w}px`);
    s.setProperty('--tbs-fh', `${rect.h}px`);
    band.style.minHeight = `${Math.round(rect.u * BAND_UNITS)}px`;
    if (recording) {
      root.style.setProperty('--tbs-band-h', `${Math.round(rect.u * BAND_UNITS) + (h - rect.y - rect.h)}px`);
      root.style.setProperty('--tbs-top', `${Math.round(rect.y + rect.u * 3.4)}px`);
    }
    return rect;
  }
  const onResize = () => layout();
  if (win && win.addEventListener) win.addEventListener('resize', onResize);

  function setRecording(on) {
    recording = !!on;
    layer.classList.toggle('is-recording', recording);
    root.classList.toggle('tbs-recording', recording);
    if (!recording) {
      shield.hidden = true;
      root.style.removeProperty('--tbs-band-h');
      root.style.removeProperty('--tbs-top');
      root.classList.remove('tbs-running');
    }
    layout();
  }

  function announce(parts) {
    if (!live) return;
    liveEl.textContent = parts.filter(Boolean).join('. ');
  }

  function restartIn(node) {
    node.classList.remove('is-in');
    void node.offsetWidth; // commit, so that the animation runs again
    node.classList.add('is-in');
  }

  function setOn(node, on) {
    if (on) {
      node.hidden = false;
      void node.offsetWidth;
      node.classList.add('is-on');
    } else {
      node.classList.remove('is-on');
      node.hidden = true;
    }
  }

  function show(caption) {
    if (destroyed || !caption) return;
    setOn(card, false);
    title.textContent = caption.title || '';
    text.textContent = caption.text || '';
    band.dataset.step = caption.id || '';
    hint(null);
    if (band.hidden) setOn(band, true);
    restartIn(words);
    announce([caption.title, caption.text]);
  }

  function showCard(caption) {
    if (destroyed || !caption) return;
    setOn(band, false);
    cardIn.textContent = '';
    const kind = caption.card === 'end' ? 'end' : 'title';
    card.className = `tbs-card is-${kind}`;
    card.dataset.step = caption.id || '';
    cardIn.append(el('p', 'tbs-card__word', caption.title || 'TOMBAUGH'));
    if (kind === 'title') cardIn.append(el('div', 'tbs-card__rule'));
    if (caption.text) cardIn.append(el('p', 'tbs-card__tag', caption.text));
    if (kind === 'end') cardIn.append(el('div', 'tbs-card__rule'));
    if (caption.url) cardIn.append(el('p', 'tbs-card__url', caption.url));
    const lines = Array.isArray(caption.lines) ? caption.lines : [];
    if (lines.length) {
      const box = el('div', 'tbs-card__lines');
      lines.forEach((line, i) => box.append(el('p', `tbs-card__line${i === lines.length - 1 && lines.length > 1 ? ' is-team' : ''}`, line)));
      cardIn.append(box);
    }
    setOn(card, true);
    announce([caption.title, caption.text, caption.url, ...lines]);
  }

  function clear() {
    setOn(band, false);
    setOn(card, false);
    urlBox.hidden = true;
    hint(null);
  }

  function hint(message) {
    hintEl.textContent = '';
    if (!message) {
      hintEl.hidden = true;
      return;
    }
    for (const part of splitKeys(message)) {
      if (part.key) hintEl.append(el('span', 'tbs-kbd', part.key));
      else hintEl.append(doc.createTextNode(part.text));
    }
    hintEl.hidden = false;
    announce([message]);
  }

  function setStatus(info) {
    status.classList.remove('is-ready');
    if (!info) {
      status.hidden = true;
      return;
    }
    statusMain.textContent = info.label || '';
    const total = Number(info.total) || 0;
    const done = Math.min(total, Number(info.done) || 0);
    statusSub.textContent = [total ? `${Math.min(total, done + 1)} of ${total}` : '', info.sub || ''].filter(Boolean).join(' · ');
    statusFill.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
    status.hidden = false;
  }

  function ready(message) {
    statusMain.textContent = '';
    for (const part of splitKeys(message)) {
      if (part.key) statusMain.append(el('span', 'tbs-kbd', part.key));
      else statusMain.append(doc.createTextNode(part.text));
    }
    statusSub.textContent = '';
    status.classList.add('is-ready');
    status.hidden = false;
    announce([message]);
  }

  function url(value) {
    if (!value) {
      urlBox.hidden = true;
      return;
    }
    urlText.textContent = value;
    urlBox.hidden = false;
  }

  function progress(fraction) {
    const f = Math.max(0, Math.min(1, Number(fraction) || 0));
    hairFill.style.transform = `scaleX(${f.toFixed(4)})`;
  }

  function setTag(value) {
    tag.textContent = value || '';
    tag.hidden = !value;
    layer.classList.toggle('has-tag', !!value);
  }

  setRecording(recording);

  return {
    el: layer,
    show,
    card: showCard,
    clear,
    hint,
    status: setStatus,
    ready,
    url,
    progress,
    setTag,
    setRecording,
    setGuide(on) {
      guide.hidden = !on;
    },
    /** While a recording take runs, the pointer is hidden and the shield swallows hover. */
    setRunning(on) {
      root.classList.toggle('tbs-running', !!on && recording);
      shield.hidden = !(on && recording);
    },
    showControls(on) {
      layer.classList.toggle('show-controls', !!on);
    },
    setStopLabel(label) {
      stop.textContent = label;
    },
    promote,
    layout,
    rect: () => rect,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (win && win.removeEventListener) win.removeEventListener('resize', onResize);
      root.classList.remove('tbs-recording', 'tbs-running');
      root.style.removeProperty('--tbs-band-h');
      root.style.removeProperty('--tbs-top');
      try {
        if (popped) layer.hidePopover();
      } catch {
        // already closed
      }
      layer.remove();
    },
  };
}
