// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Simple mode, the default face of the console: the picture, two views ("The sky" and "What
// changed") and a side column that says in plain words what the field is, what changed in it and
// what the thing you clicked is doing. Nothing here measures anything: every answer is the
// Advanced mode's own verdict (the same candidate list, motion fit and light curve), reworded,
// with the exact sentence kept underneath as fine print.

import { h, clear } from './layout.js';

/** The two views Simple mode offers, with the sentence shown under the switch. */
export const SIMPLE_VIEW_INFO = Object.freeze([
  {
    id: 'passes',
    label: 'The sky',
    hint: 'One frame per visit by the telescope, months apart. Press play and watch for anything that moves or changes.',
  },
  {
    id: 'residual',
    label: 'What changed',
    hint: 'Everything that stayed the same is subtracted. Whatever is left moved or changed brightness.',
  },
]);

/** Plain-language descriptions of the built-in targets: what it is, and what to look for. */
export const PLAIN_TARGETS = Object.freeze({
  barnard: {
    what: 'A small red star six light-years away. It crosses our sky faster than any other star.',
    look: 'Press play and watch the star in the middle step upward while every other star holds still.',
    found: 'On the real pictures it moves 11.9 arcseconds a year. The star catalogue says 10.4, inside our margin of error.',
  },
  'eps-indi-b': {
    what: 'Two failed stars (brown dwarfs) orbiting each other 12 light-years away, too close together to tell apart here.',
    look: 'Press play: the faint dot in the middle drifts between visits. Click it to see the dip that methane gas cuts in its light.',
    found: 'On the real pictures it drifts 4.5 arcseconds a year (published: 4.6), and methane removes 60 % of its light at one colour.',
  },
  wise0855: {
    what: 'The coldest known brown dwarf, colder than ice, 7.4 light-years away. It is almost too faint for this telescope.',
    look: 'It glows only in the reddest infrared and moves quickly. Look for a faint dot that changes place between visits.',
    found: 'It is there on the real pictures, moving 8.0 arcseconds a year. The published value is 8.2.',
  },
  'rw-aur': {
    what: 'A young star, 530 light-years away, that is still pulling in gas. It brightens and fades without warning.',
    look: 'Nothing moves here. Switch to “What changed” and one star lights up because its brightness changed.',
    found: 'On the real pictures it brightened by 40 % between Sep 2025 and Mar 2026.',
  },
  'r-dra': {
    what: 'An old red giant star that swells and shrinks, getting brighter and fainter about every eight months.',
    look: 'Nothing moves here. Switch to “What changed” to see the one star whose brightness changed.',
    found: 'On the real pictures it faded by 28 % between Mar and Apr 2026.',
  },
  proxima: {
    what: 'The closest star to the Sun, 4.2 light-years away.',
    look: 'Press play and watch it move against the stars behind it.',
  },
  luhman16: {
    what: 'The nearest brown dwarfs to the Sun: a pair 6.5 light-years away, found only in 2013.',
    look: 'Press play and watch the pair move between visits.',
  },
  teegarden: {
    what: 'A dim red star 12.5 light-years away that nobody noticed until 2003, even though it moves quickly.',
    look: 'Press play and watch it move against the stars behind it.',
  },
  m101: {
    what: 'The Pinwheel Galaxy, a spiral of stars 21 million light-years away.',
    look: 'Nothing here should move or change. This is what a quiet patch of sky looks like.',
  },
});

/** A target with its card text in plain words (for the start page in Simple mode). Pure. */
export function plainTarget(target) {
  const plain = target && PLAIN_TARGETS[target.id];
  if (!plain) return target;
  return { ...target, blurb: plain.what, why: plain.look, found: plain.found || target.found };
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
  if (score >= 10) return 'Strong signal';
  if (score >= 6) return 'Clear signal';
  return 'Weak signal';
}

/**
 * One candidate from the change search, in plain words. Pure.
 * -> { title, detail, caution, strength }
 */
export function plainCandidate(c) {
  const out = { title: 'Something changed', detail: 'This spot does not look the same on every visit.', caution: '', strength: strengthWord(c && c.score) };
  if (!c) return out;
  const when = betweenText(c);
  if (c.saturated) {
    // A star too bright for the detector: only its glare can be compared from visit to visit.
    if (c.kind === 'moved') {
      out.title = 'A bright star moved';
      out.detail = `Its glare shifted${c.towards ? ` ${c.towards}` : ''}${when ? ` ${when}` : ' between visits'}.`;
    } else if (c.brighter === true || c.brighter === false) {
      out.title = c.brighter ? 'A bright star got brighter' : 'A bright star got fainter';
      out.detail = `Its glare ${c.brighter ? 'grew' : 'shrank'}${when ? ` ${when}` : ' between visits'}.`;
    } else {
      out.title = 'A bright star changed';
      out.detail = 'Its glare is not the same on every visit.';
    }
    if (c.turned) out.caution = 'Treat this one with care: the two visits were half a year apart, with the telescope turned round, and that alone can change how a very bright star looks.';
    return out;
  }
  if (c.kind === 'moved') {
    out.title = 'Something moved';
    out.detail = 'It is in a different place on different visits.';
    return out;
  }
  const net = c.net;
  if (net && net.onSource && isNum(net.frac)) {
    const pct = Math.abs(100 * net.frac);
    const size = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
    out.title = net.frac > 0 ? 'Something got brighter' : 'Something got fainter';
    out.detail = `Its light ${net.frac > 0 ? 'rose' : 'fell'} by about ${size} %${net.label ? ` in ${net.label}` : ''}.`;
    return out;
  }
  if (c.kind === 'varies') {
    out.title = 'Something changed brightness';
    out.detail = 'It is brighter on some visits than on others.';
  }
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
  const book = table ? 'its published motion' : 'what the Gaia star catalogue lists for it';
  switch (v.kind) {
    case 'agree':
      return v.weak
        ? { answer: 'Probably', tone: 'maybe', gloss: `There is a hint of movement, in the direction and at the speed of ${book}. On its own it is too faint to be sure.` }
        : { answer: 'Yes', tone: 'yes', gloss: `It changes place from visit to visit, and its speed matches ${book}.` };
    case 'disagree':
      return /No motion detected/i.test(v.text || '')
        ? { answer: 'Not that we can see', tone: 'maybe', gloss: 'A catalogue says it should have moved enough to notice, yet it looks still. Something here does not add up.' }
        : { answer: 'Yes', tone: 'yes', gloss: 'It changes place from visit to visit, but not the way the catalogue says the star here should. It may be a different object.' };
    case 'unexplained':
      return { answer: 'Yes', tone: 'yes', gloss: 'It changes place from visit to visit, and no catalogued star at this spot explains that.' };
    case 'measured':
      return { answer: 'Yes', tone: 'yes', gloss: 'It changes place from visit to visit.' };
    case 'static':
      return { answer: 'No', tone: 'no', gloss: 'It is in the same place on every visit, as far as these pictures can tell.' };
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
      return { answer: 'No', tone: 'no', gloss: 'It is as bright on every visit, within what these pictures can measure.' };
    case 'single':
      return { answer: 'Can’t tell yet', tone: 'none', gloss: 'The telescope has visited this spot only once so far, so there is nothing to compare with.' };
    case 'noisy':
      return { answer: 'Can’t tell', tone: 'none', gloss: 'It is too faint here to say whether its brightness changed.' };
    default:
      return { answer: 'Can’t tell yet', tone: 'none', gloss: 'There are no brightness measurements for this spot yet.' };
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
  return `${n} picture${n === 1 ? '' : 's'} from ${list.length} visit${list.length === 1 ? '' : 's'} by the SPHEREx telescope${when ? `: ${when}` : ''}.`;
}

/**
 * createSimpleView({ bar, host, lib, plots, findTarget, verdicts, onView, onPickCandidate, onClear, onAdvanced })
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
  onView = () => {},
  onPickCandidate = () => {},
  onClear = () => {},
  onAdvanced = () => {},
} = {}) {
  // ---- the two-way switch above the picture ----------------------------------------------------
  const viewButtons = new Map();
  const seg = h('div', { class: 'seg simple-seg', role: 'radiogroup', 'aria-label': 'What to show' });
  for (const info of SIMPLE_VIEW_INFO) {
    const btn = h('button', { type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': 'false', 'data-view': info.id, onclick: () => onView(info.id) }, info.label);
    viewButtons.set(info.id, btn);
    seg.append(btn);
  }
  const hint = h('p', { class: 'simple-hint', 'aria-live': 'polite' });
  if (bar) clear(bar).append(seg, hint);

  function setView(view) {
    let shown = SIMPLE_VIEW_INFO.find((v) => v.id === view) || null;
    for (const [id, btn] of viewButtons) {
      const on = id === view;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on || (!shown && id === SIMPLE_VIEW_INFO[0].id) ? 0 : -1;
    }
    if (!shown) shown = SIMPLE_VIEW_INFO[0];
    hint.textContent = shown.hint;
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

  // ---- "You are looking at" --------------------------------------------------------------------
  const fieldName = h('h2', { class: 'simple-name' });
  const fieldWhat = h('p', { class: 'simple-text' });
  const fieldLook = h('p', { class: 'simple-look' });
  const fieldVisits = h('p', { class: 'simple-fine' });
  const fieldCard = h('section', { class: 'simple-card simple-field' }, h('p', { class: 'simple-eyebrow' }, 'You are looking at'), fieldName, fieldWhat, fieldLook, fieldVisits);

  let field = { name: '', coord: '' };
  let visits = { loading: true, passes: [], error: '' };

  function renderField() {
    const known = field.name && typeof findTarget === 'function' ? findTarget(field.name) : null;
    const plain = known && PLAIN_TARGETS[known.id] ? PLAIN_TARGETS[known.id] : null;
    clear(fieldName).append(field.name || 'This patch of sky');
    if (plain) {
      fieldWhat.textContent = plain.what;
      fieldLook.textContent = plain.look;
    } else if (known && known.blurb) {
      fieldWhat.textContent = known.blurb;
      fieldLook.textContent = '';
    } else {
      fieldWhat.textContent = field.coord ? `A small square of sky centred on ${field.coord}.` : 'A small square of sky.';
      fieldLook.textContent = 'Press play to flip between the telescope’s visits, then see what changed.';
    }
    fieldLook.hidden = !fieldLook.textContent;
    if (visits.error) fieldVisits.textContent = visits.error;
    else if (visits.loading) fieldVisits.textContent = 'Fetching the telescope’s pictures of this spot…';
    else fieldVisits.textContent = plainVisits(visits.passes) || 'The telescope has no pictures of this spot yet.';
  }

  // ---- "What changed here" ---------------------------------------------------------------------
  const changeBody = h('div', { class: 'simple-changes' });
  const changeFine = h('p', { class: 'simple-fine' });
  const changeCard = h('section', { class: 'simple-card' }, h('h3', { class: 'simple-title' }, 'What changed here'), changeBody, changeFine);

  let cands = { status: 'idle', list: [], active: -1 };

  function renderChanges() {
    clear(changeBody);
    changeFine.textContent = '';
    const { status, list, active } = cands;
    if (status === 'working' || status === 'idle') {
      changeBody.append(
        h('p', { class: 'simple-wait' }, status === 'working' ? 'Comparing every visit, pixel by pixel…' : 'Once the pictures are in, Tombaugh compares the visits and lists anything that moved or changed brightness.'),
      );
      return;
    }
    if (status === 'unavailable') {
      changeBody.append(h('p', { class: 'simple-wait' }, 'There are not enough pictures of this spot yet to compare one visit with another.'));
      return;
    }
    const aside = plainSetAside(list);
    if (!list.length) {
      changeBody.append(
        h('p', { class: 'simple-answer' }, 'Nothing.'),
        h('p', { class: 'simple-text' }, 'Every star in this patch stayed where it was and kept its brightness, as far as these pictures can tell.'),
      );
      changeFine.textContent = aside;
      return;
    }
    const ol = h('ol', { class: 'simple-list' });
    list.forEach((c, i) => {
      const p = plainCandidate(c);
      const sigma = isNum(c.score) ? `${c.score.toFixed(1)} sigma` : '';
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
              'aria-label': `${i + 1}. ${p.title}. ${p.detail} ${p.strength}. Show it.`,
              onclick: () => onPickCandidate(c, i),
            },
            h('span', { class: 'cand-n' }, String(i + 1)),
            h(
              'span',
              { class: 'simple-change-main' },
              h('span', { class: 'simple-change-title' }, p.title),
              h('span', { class: 'simple-change-detail' }, p.detail),
              p.caution ? h('span', { class: 'simple-change-caution' }, p.caution) : null,
              h('span', { class: 'simple-change-strength' }, p.strength, sigma ? h('span', { class: 'num' }, ` (${sigma})`) : null),
            ),
          ),
        ),
      );
    });
    changeBody.append(ol);
    changeFine.textContent = `Click one to circle it in the picture. These are places worth a look, not discoveries.${aside ? ` ${aside}` : ''}`;
  }

  // ---- "What you clicked" ----------------------------------------------------------------------
  const pickTitle = h('h3', { class: 'simple-title' }, 'Click any star');
  const pickBody = h('div', { class: 'simple-pick' });
  const specHost = h('div', { class: 'plot-host simple-plot' });
  const specNote = h('p', { class: 'simple-fine' }, 'Each dot is one picture, taken in a different infrared colour. The shape of this curve tells astronomers what the object is made of.');
  const specBlock = h('div', { class: 'simple-spec' }, h('p', { class: 'simple-q' }, 'Its light, colour by colour'), specHost, specNote);
  specBlock.hidden = true;
  const btnClear = h('button', { type: 'button', class: 'btn btn-small btn-quiet', onclick: () => onClear() }, 'Clear');
  btnClear.hidden = true;
  const pickCard = h('section', { class: 'simple-card' }, h('div', { class: 'simple-card-head' }, pickTitle, btnClear), pickBody, specBlock);

  let spectrumPlot = null;
  if (typeof plots.createSpectrumPlot === 'function') {
    try {
      spectrumPlot = plots.createSpectrumPlot(specHost);
    } catch (err) {
      console.warn('[tombaugh] simple view: spectrum plot failed to mount', err);
      spectrumPlot = null;
    }
  }

  let selection = null;
  let hasSpectrum = false;

  function question(q, a) {
    return h(
      'div',
      { class: 'simple-qa' },
      h('p', { class: 'simple-q' }, q),
      h('p', { class: `simple-answer is-${a.tone}` }, a.answer),
      h('p', { class: 'simple-text' }, a.gloss),
      a.exact ? h('p', { class: 'simple-fine' }, a.exact) : null,
    );
  }

  function renderPick() {
    clear(pickBody);
    btnClear.hidden = !selection;
    specBlock.hidden = !(selection && hasSpectrum && spectrumPlot);
    if (!selection) {
      pickTitle.textContent = 'Click any star';
      pickBody.append(h('p', { class: 'simple-text' }, 'Click a star in the picture to find out whether it is moving, whether its brightness changed, and what its light looks like.'));
      return;
    }
    const sel = selection;
    pickTitle.textContent = plainLabel(sel.label);
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
    const motion = plainMotion(mv);
    const bright = plainBrightness(lv);
    if (sel.saturated) {
      // The detector overflowed on this star: say so rather than trust a measurement of it.
      bright.gloss = `${bright.gloss} This star is so bright that it overflows the detector, so take its brightness with caution.`;
    }
    pickBody.append(
      question('Is it moving?', { ...motion, exact: mv.kind === 'few' ? '' : mv.text }),
      question('Did its brightness change?', { ...bright, exact: ['empty', 'single'].includes(lv.kind) ? '' : lv.text }),
    );
  }

  // ---- footer ----------------------------------------------------------------------------------
  const foot = h(
    'section',
    { class: 'simple-card simple-foot' },
    h('p', { class: 'simple-text' }, 'This is the simple view. Advanced mode adds every view, all six detectors, the plots behind these answers and the measuring tools.'),
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => onAdvanced() }, 'Open Advanced mode'),
  );

  if (host) clear(host).append(fieldCard, changeCard, pickCard, foot);
  setView('passes');
  renderField();
  renderChanges();
  renderPick();

  return {
    setView,
    setViewDisabled,

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
    },

    /**
     * What is selected, or null: { key, label, measured, gaia, passes, lightCurve, saturated }.
     * key names the pick (a new key scrolls the answers into view).
     * measured / gaia are what the motion meter is given; lightCurve is its points.
     */
    setSelection(sel) {
      const fresh = !!sel && (!selection || selection.key !== sel.key);
      selection = sel || null;
      if (!selection) {
        hasSpectrum = false;
        if (spectrumPlot) {
          try {
            spectrumPlot.clear();
          } catch {
            // ignore
          }
        }
      }
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

    /** The same object panels.setSpectrum takes (only the measured points are drawn here). */
    setSpectrum({ points = [], binned = [], lens = null, title = '' } = {}) {
      hasSpectrum = Array.isArray(points) && points.length > 0;
      if (spectrumPlot && hasSpectrum) {
        try {
          spectrumPlot.setData({ points, binned, lens: lens || undefined, title });
        } catch (err) {
          console.warn('[tombaugh] simple view: spectrum plot', err);
        }
      }
      specBlock.hidden = !(selection && hasSpectrum && spectrumPlot);
    },
  };
}
