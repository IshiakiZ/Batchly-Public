// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Simple mode, the default face of the console: the picture, three views ("Photos", "What
// changed" and "In colour"), a few small tools under it, and a side column that says in plain
// words what the field is, what changed in it and what the thing you clicked is doing. Nothing here measures anything: every answer is the
// Advanced mode's own verdict (the same candidate list, motion fit and light curve), reworded,
// with the exact sentence kept underneath as fine print.

import { h, clear } from './layout.js';

/** The views Simple mode offers, with the words shown as each button's tooltip. */
export const SIMPLE_VIEW_INFO = Object.freeze([
  {
    id: 'passes',
    label: 'Photos',
    hint: 'One photo per visit, months apart',
  },
  {
    id: 'residual',
    label: 'What changed',
    hint: 'Only what moved or changed is left',
  },
  {
    id: 'lens',
    label: 'In colour',
    hint: 'Three kinds of infrared light shown as red, green and blue',
  },
]);

/** How fast the photos flip, slowest first: [player speed, label]. */
export const SIMPLE_SPEEDS = Object.freeze([
  ['1', 'Slow'],
  ['auto', 'Normal'],
  ['4', 'Fast'],
]);

const MOON_ARCSEC = 1800; // the full Moon is about half a degree across

/**
 * A speed across the sky in everyday words. `masPerYear` is the measured motion.
 * "The Moon's width every 150 years". '' when there is nothing to say. Pure.
 */
export function plainSpeed(masPerYear) {
  if (!isNum(masPerYear) || masPerYear <= 0) return '';
  const years = MOON_ARCSEC / (masPerYear / 1000);
  if (years > 1e6) return '';
  const round = years >= 1000 ? Math.round(years / 100) * 100 : years >= 100 ? Math.round(years / 10) * 10 : Math.max(1, Math.round(years));
  return `The Moon’s width every ${round.toLocaleString('en-US')} year${round === 1 ? '' : 's'}`;
}

/** "About 40 % brighter" from the light-curve verdict (factor = brighter visit over fainter). Pure. */
export function plainAmount(verdict) {
  const v = verdict || {};
  if (!isNum(v.factor) || v.factor <= 1 || !['changed', 'possible'].includes(v.kind) || !v.direction) return '';
  if (v.direction === 'rose') {
    if (v.factor >= 2) return `${v.factor >= 10 ? Math.round(v.factor) : v.factor.toFixed(1)} times brighter`;
    return `About ${Math.max(1, Math.round(100 * (v.factor - 1)))} % brighter`;
  }
  return `About ${Math.max(1, Math.round(100 * (1 - 1 / v.factor)))} % fainter`;
}

/** Plain-language descriptions of the built-in targets: a few words, what it is, and what to look for. */
export const PLAIN_TARGETS = Object.freeze({
  barnard: {
    short: 'The fastest-moving star in the sky.',
    what: 'A small red star six light-years away. It crosses our sky faster than any other star.',
    look: 'Press play and watch the star in the middle step upward while every other star holds still.',
    found: 'On the real photos it moves 11.9 arcseconds a year. Astronomers list 10.4, inside our margin of error.',
  },
  'eps-indi-b': {
    short: 'Two faint failed stars, drifting.',
    what: 'Two failed stars circling each other 12 light-years away, too close together to tell apart here.',
    look: 'Press play: the faint dot in the middle drifts between visits.',
    found: 'On the real photos it drifts 4.5 arcseconds a year (published: 4.6), and methane gas blocks 60 % of its light at one colour.',
  },
  wise0855: {
    short: 'The coldest failed star we know.',
    what: 'A failed star colder than ice, 7.4 light-years away. It is almost too faint for this telescope.',
    look: 'It gives off only a faint warm glow, and it moves quickly. Look for a faint dot that changes place between visits.',
    found: 'It shows up on the real photos, moving 8.0 arcseconds a year. The published value is 8.2.',
  },
  'rw-aur': {
    short: 'A young star that flickers.',
    what: 'A young star, 530 light-years away, that is still pulling in gas. It brightens and fades without warning.',
    look: 'Nothing moves here. Switch to “What changed” and one star lights up because its brightness changed.',
    found: 'On the real photos it got 40 % brighter between Sep 2025 and Mar 2026.',
  },
  'r-dra': {
    short: 'A giant star that pulses.',
    what: 'An old, swollen red star that grows and shrinks, getting brighter and fainter about every eight months.',
    look: 'Nothing moves here. Switch to “What changed” to see the one star whose brightness changed.',
    found: 'On the real photos it faded by 28 % between Mar and Apr 2026.',
  },
  proxima: {
    short: 'The nearest star to the Sun.',
    what: 'The closest star to the Sun, 4.2 light-years away.',
    look: 'Press play and watch it move against the stars behind it.',
  },
  luhman16: {
    short: 'The nearest failed stars.',
    what: 'The nearest failed stars to the Sun: a pair 6.5 light-years away, found only in 2013.',
    look: 'Press play and watch the pair move between visits.',
  },
  teegarden: {
    short: 'A dim star that moves fast.',
    what: 'A dim red star 12.5 light-years away that nobody noticed until 2003, even though it moves quickly.',
    look: 'Press play and watch it move against the stars behind it.',
  },
  m101: {
    short: 'A quiet spiral galaxy.',
    what: 'The Pinwheel Galaxy, a spiral of stars 21 million light-years away.',
    look: 'Nothing here should move or change. This is what a quiet patch of sky looks like.',
  },
});

/** A target with its card text in plain words (for the start page in Simple mode). Pure. */
export function plainTarget(target) {
  const plain = target && PLAIN_TARGETS[target.id];
  if (!plain) return target;
  return { ...target, short: plain.short, blurb: plain.what, why: plain.look, found: plain.found || target.found };
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** "between Sep 2025 and Mar 2026", or '' when the candidate does not carry two dates. */
function betweenText(c) {
  const b = c && Array.isArray(c.between) ? c.between : null;
  return b && b[0] && b[1] && b[0] !== b[1] ? `between ${b[0]} and ${b[1]}` : '';
}

/** How sure the search is, in a word. `score` is the candidate's significance in sigma. */
export function strengthWord(score) {
  if (!isNum(score)) return '';
  if (score >= 10) return 'We are very sure';
  if (score >= 6) return 'We are fairly sure';
  return 'We are not so sure';
}

/**
 * One candidate from the change search, in plain words. Pure.
 * `checked` (or c.checked) is what measuring the spot itself said, once that has been done:
 * { moving, bright: 'yes' | 'maybe' | 'no' | 'none', direction: 'rose' | 'fell' | '' }. The list
 * never claims more than that measurement supports: "moved" is only said when it measured as moving.
 * -> { title, detail, caution, strength }
 */
export function plainCandidate(c, checked = null) {
  const out = { title: 'Something changed', detail: 'This spot does not look the same on every visit.', caution: '', strength: strengthWord(c && c.score) };
  if (!c) return out;
  const k = checked || c.checked || null;
  const when = betweenText(c);
  if (c.saturated) {
    // A star too bright for the detector: only its glare can be compared from visit to visit.
    if (c.kind === 'moved') {
      out.title = k && k.moving === 'yes' ? 'A bright star moved' : 'A bright star may have moved';
      out.detail = `Its glare shifted${c.towards ? ` ${c.towards}` : ''}${when ? ` ${when}` : ' between visits'}.`;
    } else if (c.brighter === true || c.brighter === false) {
      const doubt = !!k && k.bright === 'no';
      out.title = doubt ? 'A bright star may have changed' : c.brighter ? 'A bright star got brighter' : 'A bright star got fainter';
      out.detail = `Its glare ${c.brighter ? 'grew' : 'shrank'}${when ? ` ${when}` : ' between visits'}.`;
    } else {
      out.title = 'A bright star changed';
      out.detail = 'Its glare is not the same on every visit.';
    }
    if (c.turned) out.caution = 'Take this one with care: the telescope was turned the other way round on the second visit, and that alone can change how a very bright star looks.';
    return out;
  }
  // What the search itself guessed from the comparison picture.
  const net = c.net && c.net.onSource && isNum(c.net.frac) ? c.net : null;
  let guess = 'changed';
  if (c.kind === 'moved') guess = 'moved';
  else if (net) guess = net.frac > 0 ? 'rose' : 'fell';
  else if (c.kind === 'varies') guess = 'varies';
  // What the measurement of the spot allows the list to say.
  let say = guess;
  if (k) {
    const brightSay = k.bright === 'yes' ? k.direction || (guess === 'rose' || guess === 'fell' ? guess : 'varies') : k.bright === 'maybe' ? 'maybe-bright' : '';
    if (k.moving === 'yes') say = 'moved';
    else if (guess === 'moved') say = brightSay || (k.moving === 'no' ? 'maybe' : 'maybe-moved');
    else if (guess !== 'changed') say = k.bright === 'no' ? 'maybe' : brightSay || 'maybe-bright';
    else say = brightSay || (k.moving === 'maybe' ? 'maybe-moved' : 'changed');
  } else if (guess === 'moved') say = 'maybe-moved';
  const TITLES = {
    moved: 'Something moved',
    'maybe-moved': 'Something may have moved',
    rose: 'Something got brighter',
    fell: 'Something got fainter',
    varies: 'Something changed brightness',
    'maybe-bright': 'Something may have changed brightness',
    maybe: 'Something may have changed',
    changed: 'Something changed',
  };
  out.title = TITLES[say] || TITLES.changed;
  if (say === 'moved') out.detail = 'It is in a different place on different visits.';
  else if ((say === 'rose' || say === 'fell') && net && say === guess) {
    const pct = Math.abs(100 * net.frac);
    const size = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
    out.detail = `Its light ${say === 'rose' ? 'rose' : 'fell'} by about ${size} %${net.label ? ` in ${net.label}` : ''}.`;
  } else if (say === 'rose' || say === 'fell' || say === 'varies') out.detail = 'It is brighter on some visits than on others.';
  else if (say === 'maybe-moved') out.detail = 'It looks as if it shifted a little between visits.';
  else if (say === 'maybe' || say === 'maybe-bright') out.detail = 'This spot looks a little different between visits.';
  // "We are very sure" belongs to what the search guessed, so it is only said when that still stands.
  if (say !== guess) out.strength = '';
  return out;
}

/** What the search set aside, in one plain sentence ('' when nothing). Pure. */
export function plainSetAside(list) {
  const k = list && isNum(list.setAside) ? list.setAside : 0;
  const e = list && isNum(list.setAsideEdge) ? list.setAsideEdge : 0;
  const n = k + e;
  if (!n) return '';
  const what = k && e ? 'left by very bright stars or at the edge of the pictures' : k ? 'left by very bright stars' : 'at the edge of the pictures';
  return `${n} smudge${n === 1 ? '' : 's'} ${what} ${n === 1 ? 'was' : 'were'} ignored.`;
}

/**
 * "Is it moving?" from the motion verdict (plots/motion.js motionVerdict). Pure.
 * -> { answer, tone: 'yes' | 'no' | 'maybe' | 'none', gloss }
 */
export function plainMotion(verdict) {
  const v = verdict || {};
  const table = /catalogue says/i.test(v.text || '');
  const book = table ? 'what astronomers have published for it' : 'what the star charts say for it';
  switch (v.kind) {
    case 'agree':
      return v.weak
        ? { answer: 'Probably', tone: 'maybe', gloss: `There is a hint of movement, in the direction and at the speed of ${book}. On its own it is too faint to be sure.` }
        : { answer: 'Yes', tone: 'yes', gloss: `It changes place from visit to visit, and its speed matches ${book}.` };
    case 'disagree':
      return /No motion detected/i.test(v.text || '')
        ? { answer: 'Not that we can see', tone: 'maybe', gloss: 'The star charts say it should have moved enough to notice, yet it looks still. Something here does not add up.' }
        : { answer: 'Yes', tone: 'yes', gloss: 'It changes place from visit to visit, but not the way the star charts say the star here should. It may be something else.' };
    case 'unexplained':
      return { answer: 'Yes', tone: 'yes', gloss: 'It changes place from visit to visit, and no known star at this spot explains that.' };
    case 'measured':
      return { answer: 'Yes', tone: 'yes', gloss: 'It changes place from visit to visit.' };
    case 'static':
      return { answer: 'No', tone: 'no', gloss: 'It is in the same place on every visit, as far as these photos can tell.' };
    default:
      return { answer: 'Can’t tell yet', tone: 'none', gloss: 'Movement needs at least two visits to this spot, months apart.' };
  }
}

/**
 * "Did its brightness change?" from the light-curve verdict (plots/lightcurve.js). Pure.
 * -> { answer, tone, gloss }
 */
export function plainBrightness(verdict) {
  const v = verdict || {};
  switch (v.kind) {
    case 'changed':
      return {
        answer: v.direction === 'rose' ? 'Yes, it got brighter' : v.direction === 'fell' ? 'Yes, it got fainter' : 'Yes',
        tone: 'yes',
        gloss: 'Its brightness is clearly different from one visit to another.',
      };
    case 'possible':
      return { answer: 'Maybe', tone: 'maybe', gloss: 'There is a hint of a change, but not enough to be sure.' };
    case 'steady':
      return { answer: 'No', tone: 'no', gloss: 'It is as bright on every visit, as far as these photos can tell.' };
    case 'single':
      return { answer: 'Can’t tell yet', tone: 'none', gloss: 'The telescope has visited this spot only once so far, so there is nothing to compare with.' };
    case 'noisy':
      return { answer: 'Can’t tell', tone: 'none', gloss: 'It is too faint here to say whether its brightness changed.' };
    default:
      return { answer: 'Can’t tell yet', tone: 'none', gloss: 'There is nothing to compare for this spot yet.' };
  }
}

/** The heading over the answers: a name when there is one, plain words otherwise. Pure. */
export function plainLabel(label) {
  const text = String(label || '').trim();
  if (!text || ['Clicked source', 'Gaia star'].includes(text)) return 'The star you clicked';
  const m = /^Candidate (\d+)$/.exec(text);
  if (m) return `Number ${m[1]} on the list`;
  if (text === 'Moving source') return 'The moving thing you clicked';
  return text;
}

/** "12 pictures from 3 visits: Sep 2025, Mar 2026 and Sep 2026." Pure. */
export function plainVisits(passes) {
  const list = Array.isArray(passes) ? passes.filter((p) => p && p.total > 0) : [];
  const n = list.reduce((sum, p) => sum + p.total, 0);
  if (!n) return '';
  const labels = [];
  for (const p of list) if (p.label && !labels.includes(p.label)) labels.push(p.label);
  const when = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0] || '';
  return `${n} photo${n === 1 ? '' : 's'} from ${list.length} visit${list.length === 1 ? '' : 's'} by NASA’s SPHEREx space telescope${when ? `: ${when}` : ''}.`;
}

/**
 * createSimpleView({ bar, host, plots, findTarget, verdicts, onView, onPickCandidate, onClear })
 *   bar, host   the two empty containers from index.html (#simplebar and #simple)
 *   plots       { createSpectrumPlot? }
 *   verdicts    { motionVerdict?, lightCurveVerdict? } (either may be missing)
 */
export function createSimpleView({
  bar,
  host,
  plots = {},
  findTarget = null,
  verdicts = {},
  tools = null,
  onView = () => {},
  onPickCandidate = () => {},
  onClear = () => {},
  onSpeed = () => {},
  onField = () => {},
  onSmooth = () => {},
  onKnown = () => {},
  onSave = null,
} = {}) {
  // ---- the two-way switch above the picture ----------------------------------------------------
  const viewButtons = new Map();
  const seg = h('div', { class: 'seg simple-seg', role: 'radiogroup', 'aria-label': 'What to show' });
  for (const info of SIMPLE_VIEW_INFO) {
    const btn = h('button', { type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': 'false', 'data-view': info.id, title: info.hint, onclick: () => onView(info.id) }, info.label);
    viewButtons.set(info.id, btn);
    seg.append(btn);
  }
  if (bar) clear(bar).append(seg);

  function setView(view) {
    const shown = SIMPLE_VIEW_INFO.some((v) => v.id === view);
    for (const [id, btn] of viewButtons) {
      const on = id === view;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on || (!shown && id === SIMPLE_VIEW_INFO[0].id) ? 0 : -1;
    }
  }
  function setViewDisabled(view, reason) {
    const btn = viewButtons.get(view);
    if (!btn) return;
    btn.disabled = true;
    btn.title = reason || '';
  }
  seg.addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
    const ids = [...viewButtons.keys()].filter((id) => !viewButtons.get(id).disabled);
    const at = ids.findIndex((id) => viewButtons.get(id).getAttribute('aria-checked') === 'true');
    const next = ids[(at + (ev.key === 'ArrowRight' ? 1 : ids.length - 1) + ids.length) % ids.length];
    if (!next) return;
    ev.preventDefault();
    onView(next);
    viewButtons.get(next).focus();
  });

  /** A closed drop-down: a few words to click, the explanation inside. */
  function more(label, ...children) {
    const body = h('div', { class: 'simple-more-body' }, ...children);
    return { el: h('details', { class: 'simple-more' }, h('summary', null, label), body), body };
  }

  // ---- the small tools under the picture --------------------------------------------------------
  const speedButtons = new Map();
  const speedSeg = h('div', { class: 'seg simple-tool-seg', role: 'radiogroup', 'aria-label': 'Speed' });
  for (const [value, label] of SIMPLE_SPEEDS) {
    const btn = h('button', { type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': 'false', onclick: () => onSpeed(value) }, label);
    speedButtons.set(value, btn);
    speedSeg.append(btn);
  }
  const btnWider = h('button', { type: 'button', class: 'btn simple-tool', title: 'Show more sky around it', onclick: () => onField(1) }, 'Wider');
  const btnCloser = h('button', { type: 'button', class: 'btn simple-tool', title: 'Show less sky, closer in', onclick: () => onField(-1) }, 'Closer');
  const btnSmooth = h('button', { type: 'button', class: 'btn simple-tool', 'aria-pressed': 'false', title: 'Blend the camera’s square pixels together', onclick: () => onSmooth() }, 'Smooth');
  const btnKnown = h('button', { type: 'button', class: 'btn simple-tool', 'aria-pressed': 'false', title: 'Ring the stars that are already on the star charts', onclick: () => onKnown() }, 'Known stars');
  const btnSave = typeof onSave === 'function' ? h('button', { type: 'button', class: 'btn simple-tool', title: 'Save this photo as a picture file', onclick: () => onSave() }, 'Save') : null;
  if (tools) clear(tools).append(h('div', { class: 'simple-tool-group' }, btnWider, btnCloser), btnSmooth, btnKnown, btnSave);

  function setTools({ speed, wider, closer, smooth, known } = {}) {
    if (speed !== undefined) for (const [value, btn] of speedButtons) btn.setAttribute('aria-checked', String(value === String(speed)));
    if (wider !== undefined) btnWider.disabled = !wider;
    if (closer !== undefined) btnCloser.disabled = !closer;
    if (smooth !== undefined) btnSmooth.setAttribute('aria-pressed', String(!!smooth));
    if (known !== undefined) btnKnown.setAttribute('aria-pressed', String(!!known));
  }
  setTools({ speed: 'auto', wider: true, closer: true, smooth: false, known: false });

  // ---- the place -------------------------------------------------------------------------------
  const fieldName = h('h2', { class: 'simple-name' });
  const fieldShort = h('p', { class: 'simple-line' });
  const fieldWhat = h('p', { class: 'simple-text' });
  const fieldLook = h('p', { class: 'simple-text' });
  const fieldVisits = h('p', { class: 'simple-text' });
  const fieldMore = more('About this place', fieldWhat, fieldLook, fieldVisits);
  const fieldCard = h('section', { class: 'simple-card simple-field glass' }, fieldName, fieldShort, fieldMore.el);

  let field = { name: '', coord: '' };
  let visits = { loading: true, passes: [], error: '' };

  function renderField() {
    const known = field.name && typeof findTarget === 'function' ? findTarget(field.name) : null;
    const plain = known && PLAIN_TARGETS[known.id] ? PLAIN_TARGETS[known.id] : null;
    clear(fieldName).append(field.name || 'A patch of sky');
    fieldShort.textContent = plain ? plain.short : '';
    fieldShort.hidden = !plain;
    fieldWhat.textContent = plain ? plain.what : '';
    fieldWhat.hidden = !plain;
    fieldLook.textContent = plain ? plain.look : '';
    fieldLook.hidden = !plain;
    if (visits.error) fieldVisits.textContent = visits.error;
    else if (visits.loading) fieldVisits.textContent = 'Getting the photos…';
    else fieldVisits.textContent = plainVisits(visits.passes) || 'The telescope has no photos of this spot yet.';
  }

  // ---- what changed ----------------------------------------------------------------------------
  const changeBody = h('div', { class: 'simple-changes' });
  const changeCard = h('section', { class: 'simple-card glass' }, h('h3', { class: 'simple-title' }, 'What changed'), changeBody);

  let cands = { status: 'idle', list: [], active: -1 };
  let titleEls = [];

  /** An entry is named once its spot has been measured; until then it says so. */
  const shownCandidate = (c) => (c && (c.checked || c.unchecked) ? plainCandidate(c) : { title: 'Checking…' });

  /** A check of the spot has come in: the list says what that check found. */
  function refreshTitle(i) {
    const c = cands.list[i];
    const el = titleEls[i];
    if (!c || !el) return;
    const p = shownCandidate(c);
    if (el.textContent === p.title) return;
    el.textContent = p.title;
    if (el.parentNode && typeof el.parentNode.setAttribute === 'function') el.parentNode.setAttribute('aria-label', `${i + 1}. ${p.title}. Show it.`);
  }

  function renderChanges() {
    clear(changeBody);
    const { status, list, active } = cands;
    if (status === 'working' || status === 'idle') {
      changeBody.append(h('p', { class: 'simple-wait' }, status === 'working' ? 'Comparing the photos…' : 'Getting the photos…'));
      return;
    }
    if (status === 'unavailable') {
      changeBody.append(h('p', { class: 'simple-wait' }, 'Not enough photos to compare yet.'));
      return;
    }
    if (!list.length) {
      changeBody.append(h('p', { class: 'simple-answer' }, 'Nothing changed here.'));
      return;
    }
    const ol = h('ol', { class: 'simple-list' });
    titleEls = [];
    list.forEach((c, i) => {
      const p = shownCandidate(c);
      const title = h('span', { class: 'simple-change-title' }, p.title);
      titleEls[i] = title;
      ol.append(
        h(
          'li',
          null,
          h(
            'button',
            {
              type: 'button',
              class: 'simple-change',
              'aria-current': i === active ? 'true' : null,
              'aria-label': `${i + 1}. ${p.title}. Show it.`,
              onclick: () => onPickCandidate(c, i),
            },
            h('span', { class: 'cand-n' }, String(i + 1)),
            title,
          ),
        ),
      );
    });
    changeBody.append(ol);
  }

  // ---- the thing you clicked -------------------------------------------------------------------
  const pickTitle = h('h3', { class: 'simple-title' }, 'Click a star to check it');
  const pickBody = h('div', { class: 'simple-pick' });
  const pickDetail = h('div', { class: 'simple-detail' });
  const pickMore = more('Why', pickDetail);
  pickMore.el.hidden = true;
  const btnClear = h('button', { type: 'button', class: 'btn btn-small btn-quiet', onclick: () => onClear() }, 'Clear');
  btnClear.hidden = true;
  // Two charts, each folded away: the star's light split into colours, and its brightness over time.
  const specHost = h('div', { class: 'plot-host simple-plot' });
  const specMore = more('Its light, colour by colour', specHost);
  specMore.el.hidden = true;
  const curveHost = h('div', { class: 'plot-host simple-plot' });
  const curveMore = more('Its brightness over time', curveHost);
  curveMore.el.hidden = true;
  const pickCard = h('section', { class: 'simple-card glass' }, h('div', { class: 'simple-card-head' }, pickTitle, btnClear), pickBody, pickMore.el, specMore.el, curveMore.el);

  let selection = null;
  let spectrumPlot = null;
  let curvePlot = null;
  let spectrum = null;
  const mount = (make, where, what) => {
    if (typeof make !== 'function') return null;
    try {
      return make(where);
    } catch (err) {
      console.warn(`[tombaugh] simple view: ${what} failed to mount`, err);
      return null;
    }
  };
  spectrumPlot = mount(plots.createSpectrumPlot, specHost, 'spectrum plot');
  curvePlot = mount(plots.createLightCurvePlot, curveHost, 'light-curve plot');

  function renderPlots() {
    const hasSpec = !!(selection && spectrumPlot && spectrum && spectrum.points.length);
    specMore.el.hidden = !hasSpec;
    if (hasSpec) {
      try {
        spectrumPlot.setData({ points: spectrum.points, binned: spectrum.binned, title: '' });
      } catch (err) {
        console.warn('[tombaugh] simple view: spectrum plot', err);
      }
    }
    const curve = selection && Array.isArray(selection.lightCurve) ? selection.lightCurve : [];
    const hasCurve = !!(curvePlot && curve.length > 1);
    curveMore.el.hidden = !hasCurve;
    if (hasCurve) {
      try {
        curvePlot.setData({ points: curve, title: '' });
      } catch (err) {
        console.warn('[tombaugh] simple view: light-curve plot', err);
      }
    }
  }
  // A chart drawn while folded away has no size: draw it again when its drop-down opens.
  for (const m of [specMore, curveMore]) m.el.addEventListener('toggle', () => m.el.open && renderPlots());

  /** One question and its answer on a single line. */
  function answerRow(q, a) {
    return h('div', { class: 'simple-row' }, h('span', { class: 'simple-row-q' }, q), h('span', { class: `simple-answer is-${a.tone}` }, a.answer));
  }

  /** The two answers for a measured spot: { mv, lv, motion, bright }. */
  function judge(sel) {
    let mv = { kind: 'few', text: '' };
    let lv = { kind: 'empty', text: '' };
    try {
      if (typeof verdicts.motionVerdict === 'function') mv = verdicts.motionVerdict(sel.measured, sel.gaia, { passes: sel.passes }) || mv;
    } catch (err) {
      console.warn('[tombaugh] simple view: motion verdict', err);
    }
    try {
      if (typeof verdicts.lightCurveVerdict === 'function') lv = verdicts.lightCurveVerdict(sel.lightCurve || []) || lv;
    } catch (err) {
      console.warn('[tombaugh] simple view: light-curve verdict', err);
    }
    return { mv, lv, motion: plainMotion(mv), bright: plainBrightness(lv) };
  }
  const checkedOf = (j) => ({ moving: j.motion.tone, bright: j.bright.tone, direction: j.lv.direction === 'rose' || j.lv.direction === 'fell' ? j.lv.direction : '' });

  function renderPick() {
    clear(pickBody);
    clear(pickDetail);
    btnClear.hidden = !selection;
    pickMore.el.hidden = !selection;
    pickBody.hidden = !selection;
    if (!selection) {
      pickTitle.textContent = 'Click a star to check it';
      return;
    }
    const sel = selection;
    pickTitle.textContent = plainLabel(sel.label);
    const judged = judge(sel);
    const { lv, bright } = judged;
    let { motion } = judged;
    // A pick from the list: the list and these answers must say the same thing.
    const m = /^c(\d+)$/.exec(String(sel.key || ''));
    const cand = m ? cands.list[Number(m[1])] : null;
    if (cand) {
      cand.checked = checkedOf(judged);
      refreshTitle(Number(m[1]));
      if (cand.saturated && cand.kind === 'moved' && motion.tone !== 'yes') {
        motion = { answer: 'Maybe', tone: 'maybe', gloss: 'Its glare shifted between visits, but the star is too bright for the camera to pin down its place.' };
      }
    }
    if (sel.saturated) {
      // The camera overflowed on this star: say so rather than trust a measurement of it.
      bright.gloss = `${bright.gloss} This star is too bright for the camera, so its brightness is less certain.`;
    }
    pickBody.append(answerRow('Moving?', motion));
    const speed = motion.tone === 'yes' && sel.measured ? plainSpeed(isNum(sel.measured.total) ? Math.abs(sel.measured.total) : Math.hypot(sel.measured.pmra, sel.measured.pmdec)) : '';
    if (speed) pickBody.append(answerRow('How fast?', { answer: speed, tone: 'fact' }));
    pickBody.append(answerRow('Brightness changed?', bright));
    const amount = plainAmount(lv);
    if (amount && bright.tone !== 'no') pickBody.append(answerRow('By how much?', { answer: amount, tone: 'fact' }));
    pickDetail.append(h('p', { class: 'simple-text' }, motion.gloss), h('p', { class: 'simple-text' }, bright.gloss));
    if (cand) {
      // Why the search listed it, when that adds something to the two answers above.
      const p = plainCandidate(cand);
      if (p.strength && p.detail) pickDetail.append(h('p', { class: 'simple-text' }, `${p.strength}.`));
      if (p.caution) pickDetail.append(h('p', { class: 'simple-text' }, p.caution));
    }
    renderPlots();
  }

  // ---- data credit -----------------------------------------------------------------------------
  // The full citation block (the same one Advanced mode shows) is moved in here by the page.
  const credit = more('Where the photos come from');
  credit.el.classList.add('simple-credit');
  const creditCard = h('section', { class: 'simple-card glass' }, credit.el);

  if (host) clear(host).append(fieldCard, changeCard, pickCard, creditCard);
  setView('passes');
  renderField();
  renderChanges();
  renderPick();

  return {
    setView,
    setViewDisabled,
    /** Where the page puts the citation block while Simple mode is showing. */
    creditBody: credit.body,

    /** { name, coord } of the field now open. */
    setField({ name = '', coord = '' } = {}) {
      field = { name, coord };
      renderField();
    },

    /** { loading, passes: [{ label, total }], error } for the detector on screen. */
    setVisits({ loading = false, passes = [], error = '' } = {}) {
      visits = { loading: !!loading, passes: Array.isArray(passes) ? passes : [], error: error || '' };
      renderField();
    },

    /** The same object panels.setCandidates takes. */
    setCandidates({ status = 'idle', list = [], active = -1 } = {}) {
      cands = { status, list: Array.isArray(list) ? list : [], active };
      renderChanges();
      if (selection) renderPick();
    },

    /**
     * The measurement of entry `index` of the list (the object setSelection takes), made in the
     * background so the list says what was measured before anyone clicks.
     */
    setChecked(index, sel) {
      const c = cands.list[index];
      if (!c) return;
      // No measurement could be made: the search's own guess stands, in its careful wording.
      if (!sel) c.unchecked = true;
      else if (!(selection && selection.key === `c${index}`)) c.checked = checkedOf(judge(sel));
      refreshTitle(index);
    },

    /**
     * What is selected, or null: { key, label, measured, gaia, passes, lightCurve, saturated }.
     * key names the pick (a new key scrolls the answers into view).
     * measured / gaia are what the motion meter is given; lightCurve is its points.
     */
    setSelection(sel) {
      const fresh = !!sel && (!selection || selection.key !== sel.key);
      selection = sel || null;
      if (!selection) spectrum = null;
      renderPick();
      // A new pick: bring its answers into view (they sit below the list of changes).
      if (fresh && host && host.offsetParent !== null && typeof pickCard.scrollIntoView === 'function') {
        try {
          pickCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch {
          // older browsers: leave the scroll where it is
        }
      }
    },

    /** The same object panels.setSpectrum takes: the measured points go in a folded chart. */
    setSpectrum({ points = [], binned = [] } = {}) {
      spectrum = Array.isArray(points) && points.length ? { points, binned: Array.isArray(binned) ? binned : [] } : null;
      renderPlots();
    },

    /** { speed, wider, closer, smooth, known }: the state of the small tools under the picture. */
    setTools,
    /** The Slow / Normal / Fast switch; the page puts it beside the Play button. */
    speedEl: speedSeg,
  };
}
