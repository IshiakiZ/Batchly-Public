// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// landing.js: the first screen, shown when the URL has no coordinates.
//
//   createLanding(container, { targets, onPick(target), onSearch(text), onSurprise() })
//     -> { show(), hide(), destroy() }
//
// It appends one <section> to `container`, hidden until show() is called. The section is in normal
// flow and at least one viewport tall. show() plays a 400 ms staggered entrance, starts the hero
// and the card previews, and puts focus in the search box (on devices with a mouse or trackpad; on
// touch devices it does not, so the keyboard does not cover the page). hide() stops every
// animation loop at once, lifts the section out of the flow so the page behind takes its place,
// fades it out, and hands focus back to whatever had it before show().
//
// targets: the contract's TARGETS shape ({ id, name, blurb, why, ra, dec, pmra, pmdec, ... }).
// Each becomes a card with an animated preview; the preview kind is guessed from the id and name
// (see previewKindFor in previews.js) or taken from an optional target.preview.
//
// Optional extras (not in the contract):
//   options
//     parseCoord(text)   the contract's core/wcs.js parseCoord, so the inline hint agrees exactly
//                        with what the app will accept. Without it a built-in reader is used.
//     onExplain(topicId) if given, "a plain blink would flicker" in the intro becomes a link that
//                        calls onExplain('flicker').
//     autoFocus          false to never focus the search box on show() (default true)
//     scheduler, reducedMotion   for tests and demos
//   onSearch may return a promise: the box shows a busy state until it settles, and a rejection's
//   message is shown as the hint.
//   returned object also has
//     el                         the root element
//     focusSearch()              focus the search box
//     setSearch(text)            fill the search box
//     setBusy(on, message?)      busy state for the search box
//     setError(message)          show a problem under the search box ('' clears it)
//   classifyQuery(text, parseCoord?) -> { kind: 'empty'|'incomplete'|'coord'|'name'|'invalid', ... }

import { prefersReducedMotion, onReducedMotionChange } from './fx.js';
import { injectStyles } from './experience.css.js';
import { createHero } from './hero.js';
import { createPreview, previewKindFor, PREVIEW_LABELS } from './previews.js';

const PLACEHOLDER = 'RA Dec or a name: "269.452 4.693", "17h57m48s +04d41m36s", "Barnard\'s Star"';
const DEFAULT_HINT = 'Degrees, hours and degrees, or a name. Enter to look.';
const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)';
const DECIMAL_PAIR = new RegExp(`^(${NUM})\\s*(?:deg|d|°)?\\s*[,\\s]\\s*(${NUM})\\s*(?:deg|d|°)?$`, 'i');
const SEXAGESIMAL =
  /^(\d{1,2})\s*(?:h|:|\s)\s*(\d{1,2})\s*(?:m|:|\s|'|′)\s*(\d{1,2}(?:\.\d*)?)\s*s?\s*[,\s]\s*([+\-−]?)\s*(\d{1,2})\s*(?:d|°|:|\s)\s*(\d{1,2})\s*(?:m|:|\s|'|′)\s*(\d{1,2}(?:\.\d*)?)\s*(?:s|"|″)?$/i;

let uid = 0;

const coordResult = (ra, dec) => ({ kind: 'coord', ra, dec, message: '' });

/**
 * Decide what a search string is, for the inline hint. Never throws.
 * @param {string} text
 * @param {(text: string) => ({ ra: number, dec: number } | null)} [parseCoord] the app's own parser
 */
export function classifyQuery(text, parseCoord) {
  const s = String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
  if (!s) return { kind: 'empty', message: DEFAULT_HINT };

  if (typeof parseCoord === 'function') {
    try {
      const c = parseCoord(s);
      if (c && Number.isFinite(c.ra) && Number.isFinite(c.dec)) return coordResult(c.ra, c.dec);
    } catch {
      // fall through to the built-in reader
    }
  }

  let m = s.match(DECIMAL_PAIR);
  if (m) {
    const ra = Number(m[1]);
    const dec = Number(m[2]);
    if (ra < 0 || ra > 360) return { kind: 'invalid', message: 'Right ascension runs from 0 to 360 degrees.' };
    if (dec < -90 || dec > 90) return { kind: 'invalid', message: 'Declination runs from −90 to +90 degrees.' };
    return coordResult(ra === 360 ? 0 : ra, dec);
  }

  m = s.match(SEXAGESIMAL);
  if (m) {
    const [h, min, sec, sign, d, dm, ds] = [m[1], m[2], m[3], m[4], m[5], m[6], m[7]].map((v, i) => (i === 3 ? v : Number(v)));
    if (h >= 24 || min >= 60 || sec >= 60) return { kind: 'invalid', message: 'Right ascension runs from 0h to 24h, with minutes and seconds below 60.' };
    const dec = (d + dm / 60 + ds / 3600) * (sign === '-' || sign === '−' ? -1 : 1);
    if (dm >= 60 || ds >= 60 || Math.abs(dec) > 90) return { kind: 'invalid', message: 'Declination runs from −90 to +90 degrees.' };
    return coordResult((h + min / 60 + sec / 3600) * 15, dec);
  }

  if (/^\d{1,2}\s*h/i.test(s) || /^\d{1,2}:\d/.test(s)) {
    return { kind: 'incomplete', message: 'Keep going: hours, minutes, seconds, then the declination.' };
  }
  if (/[a-z]/i.test(s)) {
    if (s.length < 2) return { kind: 'incomplete', message: DEFAULT_HINT };
    return { kind: 'name', name: s, message: '' };
  }
  if (new RegExp(`^${NUM}\\s*,?$`).test(s)) {
    return { kind: 'incomplete', message: 'Now the declination, for example 269.452 4.693.' };
  }
  return { kind: 'invalid', message: 'That does not read as a position. Try 269.452 4.693 or a name.' };
}

/** Typography for target text written in plain ASCII: "3.3 um" reads better as "3.3 µm". */
const pretty = (text) => String(text).replace(/(\d)\s?um\b/g, '$1 µm');

const fmtRa = (ra) => `${ra.toFixed(4)}°`;
const fmtDec = (dec) => `${dec < 0 ? '−' : '+'}${Math.abs(dec).toFixed(4)}°`;

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ICON_CROSSHAIR =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3">' +
  '<circle cx="8" cy="8" r="4.2"/><path d="M8 0.5v4M8 11.5v4M0.5 8h4M11.5 8h4"/></svg>';
const ICON_ARROW =
  '<svg viewBox="0 0 14 10" width="14" height="10" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">' +
  '<path d="M0 5h12M8 1l4 4-4 4"/></svg>';
const ICON_UNSEEN =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">' +
  '<rect x="1" y="1" width="4" height="4" opacity="0.35"/><rect x="6" y="1" width="4" height="4" opacity="0.6"/><rect x="11" y="1" width="4" height="4" opacity="0.35"/>' +
  '<rect x="1" y="6" width="4" height="4" opacity="0.6"/><rect x="6" y="6" width="4" height="4"/><rect x="11" y="6" width="4" height="4" opacity="0.6"/>' +
  '<rect x="1" y="11" width="4" height="4" opacity="0.35"/><rect x="6" y="11" width="4" height="4" opacity="0.6"/><rect x="11" y="11" width="4" height="4" opacity="0.35"/></svg>';

const ICON_ORBIT =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2">' +
  '<ellipse cx="8" cy="8" rx="7" ry="3.2" transform="rotate(-24 8 8)" opacity="0.6"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/>' +
  '<circle cx="13.6" cy="5.1" r="1.1" fill="currentColor" stroke="none"/></svg>';

/**
 * @param {Element} container
 * @param {Object} opts
 * @param {Array<Object>} [opts.targets]
 * @param {(target: Object) => void} [opts.onPick]
 * @param {(text: string) => (void | Promise<any>)} [opts.onSearch]
 * @param {() => void} [opts.onSurprise]
 * @returns {{ show(): void, hide(): void, destroy(): void, el: HTMLElement, focusSearch(): void, setSearch(text: string): void, setBusy(on: boolean, message?: string): void, setError(message: string): void }}
 */
export function createLanding(container, opts = {}) {
  const doc = container.ownerDocument || globalThis.document;
  const win = doc.defaultView || globalThis;
  injectStyles(doc);
  const targets = Array.isArray(opts.targets) ? opts.targets.filter(Boolean) : [];
  const id = `tbx-landing-${++uid}`;
  const forcedMotion = typeof opts.reducedMotion === 'boolean';
  let reduced = forcedMotion ? opts.reducedMotion : prefersReducedMotion(win);
  let step = 0;
  const stagger = (node, i = step++) => {
    node.setAttribute('data-tbx-in', '');
    node.style.setProperty('--tbx-i', String(i));
    return node;
  };

  // ---- structure ----
  const root = el(doc, 'section', 'tbx tbx-landing');
  root.hidden = true;
  root.setAttribute('aria-labelledby', `${id}-title`);
  const inner = el(doc, 'div', 'tbx-landing__inner');
  root.appendChild(inner);
  const top = el(doc, 'div', 'tbx-top');
  inner.appendChild(top);

  // head: eyebrow, wordmark, promise
  const head = el(doc, 'div', 'tbx-head');
  const eyebrow = stagger(el(doc, 'p', 'tbx-label tbx-eyebrow'));
  for (const part of ['SPHEREx ALL-SKY SURVEY', '0.75 TO 5.0 µm', '6.15″ PIXELS']) eyebrow.appendChild(el(doc, 'span', '', part));
  const wordmark = stagger(el(doc, 'h1', 'tbx-wordmark', 'TOMBAUGH'));
  wordmark.id = `${id}-title`;
  wordmark.tabIndex = -1;
  const tagline = stagger(el(doc, 'p', 'tbx-tagline', 'A blink comparator for the 102-color sky.'));
  head.append(eyebrow, wordmark, tagline);

  // hero
  const heroStep = step++;
  const figure = stagger(el(doc, 'figure', 'tbx-hero'), heroStep);
  const heroCanvas = el(doc, 'canvas', 'tbx-hero__canvas');
  const cap = el(doc, 'figcaption', 'tbx-hero__cap');
  cap.appendChild(
    el(doc, 'p', '', 'Two visits, six months apart. One star hops and one changes brightness. Subtract the predicted sky and they are all that is left.'),
  );
  const pauseBtn = el(doc, 'button', 'tbx-textbtn', 'Pause');
  pauseBtn.type = 'button';
  pauseBtn.setAttribute('aria-pressed', 'false');
  pauseBtn.setAttribute('aria-label', 'Pause the animations on this page');
  cap.appendChild(pauseBtn);
  figure.append(heroCanvas, cap);

  // body: explanation, search, surprise
  const body = el(doc, 'div', 'tbx-body');
  const lede = stagger(el(doc, 'p', 'tbx-lede'), heroStep);
  if (opts.plain) {
    // Simple mode: one sentence, no method.
    lede.append(
      'Give Tombaugh any spot on the sky and it plays every picture the SPHEREx space telescope took of that spot as a movie, so whatever moves or changes brightness stands out. Pick one of the five places below to start.',
    );
  } else {
  lede.append(
    'Give Tombaugh any spot on the sky and it plays every SPHEREx image of that spot as a movie, so whatever moves or changes brightness stands out. ',
  );
  if (typeof opts.onExplain === 'function') {
    const why = el(doc, 'button', '', 'A plain blink would flicker everywhere');
    why.type = 'button';
    why.addEventListener('click', () => opts.onExplain('flicker'));
    lede.append(why);
  } else {
    lede.append('A plain blink would flicker everywhere');
  }
  lede.append(
    ', because SPHEREx sees each spot in a different infrared color on every exposure; Tombaugh learns each pixel’s spectrum, predicts the unchanging sky in that color and subtracts it, so only real change is left.',
  );
  }

  const form = stagger(el(doc, 'form', 'tbx-search'));
  form.setAttribute('role', 'search');
  form.noValidate = true;
  const label = el(doc, 'label', 'tbx-label tbx-search__label', 'Where to look');
  label.htmlFor = `${id}-q`;
  const row = el(doc, 'div', 'tbx-search__row');
  const mark = el(doc, 'span', 'tbx-search__mark');
  mark.innerHTML = ICON_CROSSHAIR;
  const input = el(doc, 'input', 'tbx-search__input');
  input.id = `${id}-q`;
  input.type = 'text';
  input.name = 'q';
  input.placeholder = PLACEHOLDER;
  input.title = PLACEHOLDER;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('enterkeyhint', 'go');
  input.setAttribute('aria-describedby', `${id}-hint`);
  const go = el(doc, 'button', 'tbx-search__go');
  go.type = 'submit';
  go.innerHTML = `<span>Look</span>${ICON_ARROW}`;
  row.append(mark, input, go);
  const hint = el(doc, 'p', 'tbx-search__hint', DEFAULT_HINT);
  hint.id = `${id}-hint`;
  hint.setAttribute('aria-live', 'polite');
  form.append(label, row, hint);

  const surprise = stagger(el(doc, 'button', 'tbx-surprise'));
  surprise.type = 'button';
  surprise.innerHTML = ICON_UNSEEN;
  surprise.append(el(doc, 'span', '', 'Somewhere nobody has looked'));
  // A plain link, so it can be opened in a new tab or shared: the page reads ?body= on load.
  const pluto = stagger(el(doc, 'a', 'tbx-surprise tbx-follow'));
  pluto.href = '?body=pluto';
  pluto.title = 'Follows Pluto through every SPHEREx exposure that caught it and reads its spectrum';
  pluto.innerHTML = ICON_ORBIT;
  pluto.append(el(doc, 'span', '', 'Follow Pluto, the world Tombaugh found'));
  const starts = el(doc, 'div', 'tbx-starts');
  starts.append(surprise, pluto);
  body.append(lede, form, starts);

  top.append(head, figure, body);

  // targets
  const previews = [];
  const cardButtons = [];
  let cardsObserver = null;
  if (targets.length > 0) {
    const section = el(doc, 'section', 'tbx-targets');
    section.setAttribute('aria-labelledby', `${id}-targets`);
    const th = stagger(el(doc, 'div', 'tbx-targets__head'));
    const count = NUMBER_WORDS[targets.length] || String(targets.length);
    const h2 = el(doc, 'h2', 'tbx-label', `${count} ${targets.length === 1 ? 'place' : 'places'} to start`);
    h2.id = `${id}-targets`;
    th.appendChild(h2);
    const list = el(doc, 'ul', 'tbx-cards');
    const cardStep = step++;
    targets.forEach((target, i) => {
      const kind = previewKindFor(target);
      const li = stagger(el(doc, 'li'), Math.min(9, cardStep + Math.floor(i / 2)));
      const btn = el(doc, 'button', 'tbx-card');
      btn.type = 'button';
      btn.dataset.targetId = String(target.id == null ? i : target.id);

      const plate = el(doc, 'span', 'tbx-card__plate');
      plate.setAttribute('aria-hidden', 'true');
      const canvas = el(doc, 'canvas', 'tbx-card__preview');
      const data = el(doc, 'span', 'tbx-card__data');
      data.append(el(doc, 'span', 'tbx-card__num', String(i + 1).padStart(2, '0')), el(doc, 'span', 'tbx-card__kind', PREVIEW_LABELS[kind]));
      const rows = el(doc, 'span', 'tbx-card__rows');
      const addRow = (k, v) => {
        const r = el(doc, 'span');
        if (k) r.append(el(doc, 'i', '', k), ' ');
        r.append(v);
        rows.appendChild(r);
      };
      if (Number.isFinite(target.ra) && Number.isFinite(target.dec)) {
        addRow('α', target.ra.toFixed(2));
        addRow('δ', `${target.dec < 0 ? '−' : '+'}${Math.abs(target.dec).toFixed(2)}`);
      }
      const pm = Math.hypot(Number(target.pmra) || 0, Number(target.pmdec) || 0) / 1000;
      if (pm >= 0.05) addRow('', `${pm >= 10 ? pm.toFixed(1) : pm.toFixed(2)}″/yr`);
      data.appendChild(rows);
      plate.append(canvas, data);

      const text = el(doc, 'span', 'tbx-card__text');
      text.appendChild(el(doc, 'span', 'tbx-card__name', target.name || String(target.id || `Target ${i + 1}`)));
      if (target.blurb) text.appendChild(el(doc, 'span', 'tbx-card__blurb', pretty(target.blurb)));
      if (target.why) {
        const why = el(doc, 'span', 'tbx-card__why');
        why.append(el(doc, 'span', 'tbx-label', 'Look for'), pretty(target.why));
        text.appendChild(why);
      }
      if (target.found) {
        const found = el(doc, 'span', 'tbx-card__why tbx-card__found');
        found.append(el(doc, 'span', 'tbx-label', 'Measured here, on real data'), pretty(target.found));
        text.appendChild(found);
      }
      const goMark = el(doc, 'span', 'tbx-card__go', 'open →');
      goMark.setAttribute('aria-hidden', 'true');
      btn.append(plate, text, goMark);
      btn.addEventListener('click', () => {
        if (typeof opts.onPick === 'function') opts.onPick(target);
      });
      li.appendChild(btn);
      list.appendChild(li);
      cardButtons.push(btn);
      previews.push(createPreview(canvas, kind, { scheduler: opts.scheduler, reducedMotion: forcedMotion ? opts.reducedMotion : undefined }));
    });
    // Arrow keys walk the row; Tab still visits every card.
    list.addEventListener('keydown', (ev) => {
      const i = cardButtons.indexOf(doc.activeElement);
      if (i < 0) return;
      let j = -1;
      if (ev.key === 'ArrowRight') j = Math.min(cardButtons.length - 1, i + 1);
      else if (ev.key === 'ArrowLeft') j = Math.max(0, i - 1);
      else if (ev.key === 'Home') j = 0;
      else if (ev.key === 'End') j = cardButtons.length - 1;
      if (j < 0 || j === i) return;
      ev.preventDefault();
      cardButtons[j].focus();
      if (cardButtons[j].scrollIntoView) cardButtons[j].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    });
    // Fade the right edge of the row while more cards are off screen.
    const syncEdge = () => list.classList.toggle('has-more', list.scrollWidth - list.clientWidth - list.scrollLeft > 4);
    list.addEventListener('scroll', syncEdge, { passive: true });
    if (typeof win.ResizeObserver === 'function') {
      cardsObserver = new win.ResizeObserver(syncEdge);
      cardsObserver.observe(list);
    }
    section.append(th, list);
    inner.appendChild(section);
  }

  // footer
  const foot = stagger(el(doc, 'ul', 'tbx-foot'), 9);
  for (const line of [
    'Checked on real data, 15 Nov 2026: all five test targets measured, 34 comparisons with the catalogues within 3 sigma (Validation tab)',
    'Data: NASA SPHEREx via IRSA',
    'Open source, Apache 2.0',
    'Built by Missing Mass for NASA Space Apps 2026. Not affiliated with or endorsed by NASA.',
    'Code written with Claude (AI)',
  ]) {
    foot.appendChild(el(doc, 'li', '', line));
  }
  if (typeof opts.onMode === 'function') {
    // Simple or Advanced: the start page is the only screen without the top bar's switch.
    const item = el(doc, 'li', 'tbx-foot__mode');
    const btn = el(doc, 'button', '', opts.plain ? 'Switch to Advanced mode' : 'Switch to Simple mode');
    btn.type = 'button';
    btn.addEventListener('click', () => opts.onMode());
    item.appendChild(btn);
    foot.insertBefore(item, foot.lastChild);
  }
  foot.firstChild.className = 'tbx-foot__result';
  inner.appendChild(foot);

  container.appendChild(root);

  // ---- behaviour ----
  const hero = createHero(heroCanvas, { scheduler: opts.scheduler, reducedMotion: forcedMotion ? opts.reducedMotion : undefined });
  let visible = false;
  let paused = false;
  let busy = false;
  let heldError = false; // an error set through setError() while a search was running
  let destroyed = false;
  let prevFocus = null;
  let hideTimer = null;
  let searchToken = 0;

  const runAnimations = () => {
    if (visible && !paused) {
      hero.start();
      for (const p of previews) p.start();
    } else {
      hero.stop();
      for (const p of previews) p.stop();
    }
  };
  const syncPause = () => {
    pauseBtn.hidden = reduced;
    pauseBtn.textContent = paused ? 'Play' : 'Pause';
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.setAttribute('aria-label', paused ? 'Play the animations on this page' : 'Pause the animations on this page');
  };
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    syncPause();
    runAnimations();
  });
  syncPause();
  const offMotion = forcedMotion
    ? () => {}
    : onReducedMotionChange((v) => {
        reduced = v;
        syncPause();
      }, win);

  function setHint(parts, invalid) {
    hint.textContent = '';
    for (const part of [].concat(parts)) {
      if (typeof part === 'string') hint.append(part);
      else hint.appendChild(el(doc, 'b', '', part.value));
    }
    form.classList.toggle('is-invalid', !!invalid);
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  /** Update the hint for the current text. `strict` is true on submit. Returns the classification. */
  function validate(strict) {
    const result = classifyQuery(input.value, opts.parseCoord);
    if (result.kind === 'coord') setHint(['Reads as RA ', { value: fmtRa(result.ra) }, ', Dec ', { value: fmtDec(result.dec) }, '.'], false);
    else if (result.kind === 'name') setHint(['Will look up ', { value: result.name }, ' by name.'], false);
    else if (result.kind === 'invalid') setHint(result.message, true);
    else if (strict) setHint(result.kind === 'empty' ? 'Type a position or a name first, for example 269.452 4.693.' : result.message, true);
    else setHint(result.message, false);
    return result;
  }

  function setBusy(on, message) {
    busy = !!on;
    go.disabled = busy;
    form.setAttribute('aria-busy', String(busy));
    if (busy) setHint(message || 'Looking.', false);
  }

  input.addEventListener('input', () => {
    heldError = false;
    if (!busy) validate(false);
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (busy) return;
    heldError = false;
    const result = validate(true);
    if (result.kind !== 'coord' && result.kind !== 'name') {
      input.focus();
      return;
    }
    if (typeof opts.onSearch !== 'function') return;
    const text = input.value.trim().replace(/\s+/g, ' ');
    let out;
    try {
      out = opts.onSearch(text);
    } catch (err) {
      setHint((err && err.message) || 'That search did not work. Try again.', true);
      return;
    }
    if (out && typeof out.then === 'function') {
      const token = ++searchToken;
      setBusy(true, result.kind === 'name' ? `Looking up ${result.name}.` : 'Looking.');
      out.then(
        () => {
          if (token !== searchToken || destroyed) return;
          setBusy(false);
          if (!heldError) validate(false);
        },
        (err) => {
          if (token !== searchToken || destroyed) return;
          setBusy(false);
          setHint((err && err.message) || 'That search did not work. Try again.', true);
        },
      );
    }
  });

  surprise.addEventListener('click', () => {
    if (typeof opts.onSurprise === 'function') opts.onSurprise();
  });

  const finePointer = () => {
    try {
      return !!win.matchMedia && win.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch {
      return false;
    }
  };

  function clearLift() {
    for (const prop of ['position', 'top', 'left', 'width', 'height', 'z-index', 'pointer-events', 'overflow']) root.style.removeProperty(prop);
  }

  function show() {
    if (destroyed || visible) return;
    visible = true;
    clearTimeout(hideTimer);
    const active = doc.activeElement;
    prevFocus = active && active !== doc.body && !root.contains(active) ? active : null;
    clearLift();
    root.classList.remove('is-out', 'is-in');
    root.hidden = false;
    void root.offsetWidth; // commit the starting state so the entrance transition runs
    root.classList.add('is-in');
    runAnimations();
    if (opts.autoFocus !== false) {
      if (finePointer()) input.focus({ preventScroll: true });
      else wordmark.focus({ preventScroll: true });
    }
  }

  function hide() {
    if (destroyed || !visible) return;
    visible = false;
    searchToken++;
    if (busy) setBusy(false);
    runAnimations(); // stops the hero and every preview now
    const hadFocus = root.contains(doc.activeElement);
    const done = () => {
      if (visible) return;
      root.hidden = true;
      root.classList.remove('is-in', 'is-out');
      clearLift();
    };
    if (reduced) {
      done();
    } else {
      // Pin the section where it is and take it out of the flow, so what comes next is not pushed down.
      const rect = root.getBoundingClientRect();
      root.style.position = 'fixed';
      root.style.top = `${rect.top}px`;
      root.style.left = `${rect.left}px`;
      root.style.width = `${rect.width}px`;
      root.style.height = `${rect.height}px`;
      root.style.zIndex = '50';
      root.style.pointerEvents = 'none';
      root.style.overflow = 'hidden';
      root.classList.add('is-out');
      hideTimer = setTimeout(done, 190);
    }
    if (hadFocus) {
      if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') prevFocus.focus({ preventScroll: true });
      else if (doc.activeElement && typeof doc.activeElement.blur === 'function') doc.activeElement.blur();
    }
    prevFocus = null;
  }

  function destroy() {
    if (destroyed) return;
    visible = false;
    destroyed = true;
    clearTimeout(hideTimer);
    hero.destroy();
    for (const p of previews) p.destroy();
    if (cardsObserver) cardsObserver.disconnect();
    offMotion();
    root.remove();
  }

  return {
    show,
    hide,
    destroy,
    el: root,
    focusSearch: () => input.focus({ preventScroll: true }),
    setSearch(text) {
      input.value = text == null ? '' : String(text);
      if (!busy) validate(false);
    },
    setBusy,
    setError(message) {
      heldError = !!message;
      if (busy) setBusy(false);
      if (message) setHint(String(message), true);
      else validate(false);
    },
  };
}
