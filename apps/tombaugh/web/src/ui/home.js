// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// home.js: the start page in Simple mode. It is the whole sky: drag to look around, scroll to
// zoom, click a star (or pick one from the list in the search box), then press the button to see
// what SPHEREx saw there. As few words as possible.
//
//   createHome(container, { targets, stars, figures, starts, bodies, onOpen, onBody, onSearch, onMode, view, onView })
//     -> { el, show(), hide(), destroy(), focusSearch(), setSearch(text), setBusy(on, message), setError(message) }
//
//   targets  every built-in place: [{ id, name, ra, dec, short? }], ringed on the sky
//   starts   the few to offer as buttons ("Start here")
//   stars    the bright-star list (stardata.js starList()); figures: its constellation lines
//   bodies   solar system bodies to offer: [{ id, name, kind }]; onBody (id) => void follows one
//   onOpen   ({ ra, dec, name, target }) => void   go and look at that place
//   onSearch (text) => void | Promise              free text that is not in the list

import { h } from './layout.js';
import { createSkyGlobe, SKY_SURVEYS } from '../sky/globe.js';
import { attachPickList } from './picklist.js';

/** A kind of solar system body in everyday words. Pure. */
export function plainKind(kind) {
  return (
    {
      'dwarf planet': 'Dwarf planet',
      asteroid: 'Asteroid',
      comet: 'Comet',
      'interstellar comet': 'Comet from another star',
      centaur: 'Icy body between the planets',
    }[kind] || ''
  );
}

/**
 * The names offered in a search box: built-in places first, then the solar system bodies, then
 * every named star A to Z. Pure.
 */
export function pickItems(targets, stars, bodies) {
  const out = [];
  const seen = new Set();
  for (const t of targets || []) {
    if (!t || !t.name || seen.has(t.name.toLowerCase())) continue;
    seen.add(t.name.toLowerCase());
    out.push({ name: t.name, group: 'Start here', ra: t.ra, dec: t.dec, target: t });
  }
  for (const b of bodies || []) {
    if (!b || !b.id || !b.name || seen.has(b.name.toLowerCase())) continue;
    seen.add(b.name.toLowerCase());
    out.push({ name: b.name, group: 'Solar system', body: b.id });
  }
  const named = (stars || []).filter((s) => s && s.name && !seen.has(s.name.toLowerCase()));
  named.sort((a, b) => a.name.localeCompare(b.name));
  for (const s of named) out.push({ name: s.name, ra: s.ra, dec: s.dec, mag: s.mag });
  return out;
}

/** What to call a picked spot on the card. Pure. */
export function selectionTitle(sel) {
  if (!sel) return '';
  if (sel.name) return sel.name;
  return sel.kind === 'star' ? 'A star with no name' : 'This spot';
}

export function createHome(container, opts = {}) {
  const targets = Array.isArray(opts.targets) ? opts.targets : [];
  const starts = Array.isArray(opts.starts) ? opts.starts : targets.slice(0, 5);
  const stars = Array.isArray(opts.stars) ? opts.stars : [];
  const bodies = Array.isArray(opts.bodies) ? opts.bodies.filter((b) => b && b.id && b.name) : [];
  const items = pickItems(targets, stars, bodies);

  const skyHost = h('div', { class: 'skyhome-sky' });
  const input = h('input', {
    class: 'skyhome-input',
    id: 'home-search',
    type: 'text',
    name: 'q',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'Search for a star',
    'aria-label': 'Search for a star',
    'data-testid': 'home-search',
  });
  const status = h('p', { class: 'skyhome-status', 'aria-live': 'polite' });
  const field = h('div', { class: 'skyhome-field' }, h('div', { class: 'skyhome-inputwrap glass' }, input), h('button', { class: 'btn btn-solid', type: 'submit' }, 'Go'));
  const form = h('form', { class: 'skyhome-search', role: 'search', autocomplete: 'off' }, field, status);

  const cardName = h('strong', { class: 'skyhome-card-name' });
  const cardLine = h('span', { class: 'skyhome-card-line' });
  const cardGo = h('button', { class: 'btn btn-solid skyhome-go', type: 'button', 'data-testid': 'home-open' }, 'See what changed');
  const cardClose = h('button', { class: 'btn btn-quiet skyhome-x', type: 'button', 'aria-label': 'Close' }, '×');
  const card = h('div', { class: 'skyhome-card glass', role: 'status', 'data-testid': 'home-card' }, h('div', { class: 'skyhome-card-text' }, cardName, cardLine), cardGo, cardClose);
  card.hidden = true;

  const chips = h('nav', { class: 'skyhome-starts', 'aria-label': 'Start here' }, h('span', { class: 'skyhome-starts-label' }, 'Start here'));
  const hint = h('p', { class: 'skyhome-hint glass' }, 'Drag to look around. Scroll to zoom. Click a star.');
  // One line of credit, with the full acknowledgements folded underneath.
  const creditLine = h('summary', null);
  const credit = h(
    'details',
    { class: 'skyhome-credit' },
    creditLine,
    h(
      'div',
      { class: 'skyhome-credit-body' },
      h('p', null, 'The wide sky is the SPHEREx DR1 all-sky map (NASA/SPHEREx; SPHEREx Science Data Center, Caltech/IPAC), served by the NASA/IPAC Infrared Science Archive.'),
      h('p', null, 'Zoomed in close, the sharper pictures are from the Two Micron All Sky Survey (2MASS), a joint project of the University of Massachusetts and IPAC/Caltech, funded by NASA and the National Science Foundation; colour mosaic by CDS, served by IRSA.'),
      opts.starCredit ? h('p', null, opts.starCredit) : null,
      h('p', null, 'Tombaugh is a NASA Space Apps Challenge 2026 project by team Missing Mass. It is not affiliated with or endorsed by NASA. All of its code was written by an AI system, Claude, under the team’s direction.'),
    ),
  );
  const zoomIn = h('button', { class: 'skyhome-zoom-btn glass', 'data-glass-interactive': '', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in' }, '+');
  const zoomOut = h('button', { class: 'skyhome-zoom-btn glass', 'data-glass-interactive': '', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out' }, '−');
  const modeBtn =
    typeof opts.onMode === 'function'
      ? h('button', { class: 'skyhome-mode glass', 'data-glass-interactive': '', type: 'button', 'data-testid': 'home-mode', title: opts.modeTitle || 'Show every view, plot and tool', onclick: () => opts.onMode() }, opts.modeLabel || 'Advanced')
      : null;

  const root = h(
    'section',
    { class: 'skyhome', 'aria-label': 'The sky', 'data-testid': 'home' },
    skyHost,
    h(
      'header',
      { class: 'skyhome-top' },
      h('div', { class: 'skyhome-brand' }, h('span', { class: 'wordmark' }, 'TOMBAUGH'), h('span', { class: 'skyhome-tag' }, 'Pick a star. See what changed.')),
      form,
      h('div', { class: 'skyhome-actions' }, modeBtn),
    ),
    hint,
    card,
    h('div', { class: 'skyhome-bottom' }, chips, h('div', { class: 'skyhome-zoom' }, zoomOut, zoomIn)),
    credit,
  );
  root.hidden = true;
  container.append(root);

  let selection = null;
  let survey = '';

  const globe = createSkyGlobe(skyHost, {
    stars,
    figures: opts.figures,
    // A target with a measured parallax (mas) has a distance (pc), so it takes part in the depth effect.
    targets: targets.map((t) => ({ name: t.name, ra: t.ra, dec: t.dec, dist: t.parallax > 0 ? 1000 / t.parallax : undefined, target: t })),
    layers: opts.layers,
    reducedMotion: opts.reducedMotion,
    photos: opts.photos,
    ...(opts.view || {}),
    onSelect: (sel) => showSelection(sel),
    onView: (v) => {
      if (typeof opts.onView === 'function') opts.onView(v);
      if (globe) setCredit();
    },
  });

  function setCredit() {
    const st = globe.status();
    const key = st.photos ? st.survey : '';
    if (key === survey && creditLine.textContent) return;
    survey = key;
    const s = SKY_SURVEYS[key];
    creditLine.textContent = `${s ? `Sky: ${s.credit}. ` : ''}Not affiliated with NASA. Code written with AI.`;
  }
  setCredit();

  function hideHint() {
    hint.classList.add('is-gone');
  }
  skyHost.addEventListener('pointerdown', hideHint, { once: true });
  skyHost.addEventListener('wheel', hideHint, { once: true, passive: true });

  function showSelection(sel) {
    selection = sel || null;
    card.hidden = !selection;
    root.classList.toggle('has-pick', !!selection);
    if (!selection) return;
    hideHint();
    const known = selection.target || (selection.name ? targets.find((t) => t.name === selection.name) : null);
    if (known) selection.target = known;
    cardName.textContent = selectionTitle(selection);
    cardLine.textContent = known && known.short ? known.short : '';
    cardLine.hidden = !cardLine.textContent;
  }

  function choose(item, { fov = 14 } = {}) {
    const sel = { kind: item.target ? 'target' : 'star', name: item.name, ra: item.ra, dec: item.dec, mag: item.mag, target: item.target || null };
    globe.select(sel);
    globe.flyTo(item.ra, item.dec, Math.min(globe.getView().fov, fov));
    showSelection(sel);
    setError('');
  }

  for (const t of starts) {
    chips.append(h('button', { class: 'skyhome-chip glass', 'data-glass-interactive': '', type: 'button', onclick: () => choose({ name: t.name, ra: t.ra, dec: t.dec, target: t }) }, h('span', { class: 'skyhome-dot', 'aria-hidden': 'true' }), t.name));
  }

  // The solar system: these move, so they are not on the map. One button opens the list.
  let menu = null;
  if (bodies.length && typeof opts.onBody === 'function') {
    const list = h('div', { class: 'skyhome-menu-list', role: 'menu', 'aria-label': 'Solar system' });
    for (const b of bodies) {
      list.append(
        h(
          'button',
          { class: 'skyhome-menu-row', type: 'button', role: 'menuitem', onclick: () => opts.onBody(b.id) },
          h('strong', null, b.name),
          h('span', null, plainKind(b.kind)),
        ),
      );
    }
    menu = h('div', { class: 'skyhome-menu glass', 'data-testid': 'home-bodies' }, list);
    menu.hidden = true;
    const btn = h(
      'button',
      { class: 'skyhome-chip skyhome-solar glass', 'data-glass-interactive': '', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-testid': 'home-solar' },
      h('span', { class: 'skyhome-orbit', 'aria-hidden': 'true' }),
      'Solar system',
    );
    const setOpen = (on) => {
      menu.hidden = !on;
      btn.setAttribute('aria-expanded', String(on));
    };
    btn.addEventListener('click', () => setOpen(menu.hidden));
    root.addEventListener('pointerdown', (ev) => {
      if (!menu.hidden && !menu.contains(ev.target) && !btn.contains(ev.target)) setOpen(false);
    });
    root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !menu.hidden) {
        setOpen(false);
        btn.focus();
      }
    });
    chips.append(btn);
    root.append(menu);
  }

  const picker = attachPickList(input, {
    items,
    host: field,
    onPick: (item) => {
      if (item.body && typeof opts.onBody === 'function') opts.onBody(item.body);
      else choose(item);
    },
  });

  function setError(message) {
    status.textContent = message || '';
    status.classList.toggle('is-error', !!message);
  }
  function setBusy(on, message) {
    form.classList.toggle('is-busy', !!on);
    if (on || message) {
      status.classList.remove('is-error');
      status.textContent = message || 'Looking…';
    } else if (!status.classList.contains('is-error')) status.textContent = '';
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    picker.close();
    if (typeof opts.onSearch !== 'function') return;
    setBusy(true, `Looking for “${text}”…`);
    let out;
    try {
      out = opts.onSearch(text);
    } catch (err) {
      setBusy(false);
      setError(err && err.message ? err.message : 'That did not work. Try another name.');
      return;
    }
    Promise.resolve(out).then(
      () => setBusy(false),
      (err) => {
        setBusy(false);
        setError(err && err.message ? err.message : 'That did not work. Try another name.');
      },
    );
  });

  cardGo.addEventListener('click', () => {
    if (!selection || typeof opts.onOpen !== 'function') return;
    opts.onOpen({ ra: selection.ra, dec: selection.dec, name: selection.name || '', mag: selection.mag, target: selection.target || null });
  });
  cardClose.addEventListener('click', () => {
    globe.select(null);
    showSelection(null);
  });
  zoomIn.addEventListener('click', () => globe.zoomBy(0.5));
  zoomOut.addEventListener('click', () => globe.zoomBy(2));

  return {
    el: root,
    globe,
    show() {
      root.hidden = false;
      globe.resize();
    },
    hide() {
      root.hidden = true;
      picker.close();
    },
    destroy() {
      picker.destroy();
      globe.destroy();
      root.remove();
    },
    focusSearch() {
      input.focus();
    },
    setSearch(text) {
      input.value = text || '';
    },
    setBusy,
    setError,
  };
}
