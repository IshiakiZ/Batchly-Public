// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// "What is this?" plugin. A side panel that, for the source the user clicked, shows
//   1. what the catalogues list there (SIMBAD, through the proxy route GET /identify),
//   2. the nearest Gaia star and how far it should have moved, and
//   3. what the SPHEREx measurements themselves suggest (classify.js), clearly marked as
//      automated hints and not a classification.
// The panel listens to the 'select' event; nothing is fetched until the panel has been opened
// once. All text reaches the page through textContent, and links are limited to https.

import { formatCoord } from '../../core/wcs.js';
import { GAIA_MATCH_ARCSEC, classify, compass, formatMotion, nearestGaia } from './classify.js';
import { ensureIdentifyStyles } from './identify.css.js';

export const meta = {
  id: 'identify',
  title: 'What is this?',
  description: 'Looks the clicked source up in SIMBAD and Gaia, and says what its SPHEREx spectrum, brightness and motion suggest.',
};

/** Search radius around the click: two SPHEREx pixels. */
export const RADIUS_ARCSEC = 12;
const RADIUS_DEG = RADIUS_ARCSEC / 3600;
const SPHEREX_PIXEL_ARCSEC = 6.15;
const MAX_SHOWN = 6;
const CACHE_SIZE = 40;
const FLAGGED = new Set(['unknown-mover', 'cold-atmosphere', 'variable', 'moving-unexpected']);

export const TEXT = Object.freeze({
  idle: 'Click a source in the image. This panel then lists what the catalogues know at that spot, and what its SPHEREx spectrum, brightness and motion suggest.',
  loading: 'Asking SIMBAD what is catalogued here',
  empty: `Nothing catalogued within ${RADIUS_ARCSEC} arcsec, and no catalogued fast mover has a track through here. If it moves or varies, that is interesting.`,
  noGaiaLoaded: 'No Gaia stars are loaded for this field yet.',
  noHints: 'Not enough has been measured here to suggest anything. Brighter sources and more loaded frames give the measurements something to work with.',
  hintsHeading: 'What the SPHEREx data suggest',
  note: 'These hints are produced automatically from the spectrum, brightness and motion measured here. They are a place to start, not a classification.',
});

const CONFIDENCE_TITLES = {
  tentative: 'Tentative: the measurement allows this reading, and others just as well',
  likely: 'Likely: the measurement is clear, the reading is the usual one',
  strong: 'Strong: the measurement is clear and hard to explain another way, though still not proof',
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

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

/** A link that opens in a new tab without handing the new page a reference to this one. */
function outLink(href, label, className = '') {
  const safe = typeof href === 'string' && /^https:\/\//i.test(href) ? href : null;
  if (!safe) return el('span', { class: className, text: label });
  return el(
    'a',
    { class: className, href: safe, target: '_blank', rel: 'noopener noreferrer' },
    label,
    el('span', { class: 'tbi-ext', 'aria-hidden': 'true', text: '↗' }),
    el('span', { class: 'tbi-sr', text: ' (opens in a new tab)' }),
  );
}

function simbadIdUrl(ident) {
  return `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(ident)}`;
}

function sepText(arcsec) {
  if (!isNum(arcsec)) return '';
  if (arcsec < 0.05) return 'at the click';
  return `${arcsec < 10 ? arcsec.toFixed(1) : Math.round(arcsec)} arcsec away`;
}

/** Distance from a parallax in mas, rounded to what a parallax can support. */
function lightYears(parallaxMas) {
  const ly = 3261.56 / parallaxMas;
  if (ly < 100) return ly.toFixed(1);
  const unit = 10 ** (Math.floor(Math.log10(ly)) - 1);
  return String(Math.round(ly / unit) * unit);
}

function mjdNow() {
  return Date.now() / 86400000 + 40587;
}

/** Message and retry advice for a failed lookup. */
function describeFailure(err) {
  const status = err && isNum(err.status) ? err.status : 0;
  let message = err && typeof err.message === 'string' && err.message ? err.message : 'The lookup failed.';
  let retryable = !(err && err.retryable === false);
  if (status === 404) {
    message = 'This data service has no catalogue lookup (the /identify route is missing).';
    retryable = false;
  } else if (err && err.name === 'TypeError') {
    message = 'The data service could not be reached. Check the connection.';
  }
  return { message, retryable };
}

/**
 * Asks the proxy for catalogued objects. Uses app.api.identify() when the shell provides it,
 * otherwise fetches `${app.api.baseUrl}/identify` itself.
 */
export async function fetchCatalogue(app, ra, dec, radiusDeg, signal) {
  const api = app && app.api;
  if (api && typeof api.identify === 'function') return api.identify(ra, dec, radiusDeg, { signal });
  if (!api || typeof api.baseUrl !== 'string') {
    const err = new Error('The catalogue lookup is not available in this build.');
    err.retryable = false;
    throw err;
  }
  const q = new URLSearchParams({ ra: ra.toFixed(6), dec: dec.toFixed(6), radius: radiusDeg.toFixed(6) });
  const response = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/identify?${q}`, { signal });
  if (!response.ok) {
    const err = new Error(`The data service answered ${response.status}.`);
    err.status = response.status;
    err.retryable = response.status >= 500 || response.status === 429 || response.status === 408;
    try {
      const body = await response.json();
      if (body && typeof body.error === 'string' && body.error) err.message = body.error;
      if (body && typeof body.retryable === 'boolean') err.retryable = body.retryable;
    } catch {
      // keep the generic message
    }
    throw err;
  }
  return response.json();
}

function objectItem(o) {
  const name = typeof o.name === 'string' && o.name ? o.name : 'Unnamed entry';
  const facts = [];
  if (isNum(o.pmra) && isNum(o.pmdec)) {
    const dir = compass(o.pmra, o.pmdec);
    facts.push(el('span', null, 'Moves ', el('b', { text: formatMotion(Math.hypot(o.pmra, o.pmdec)) }), dir ? ` ${dir}` : ''));
  }
  if (typeof o.spType === 'string' && o.spType) facts.push(el('span', null, 'Spectral type ', el('b', { text: o.spType })));
  if (isNum(o.parallax) && o.parallax > 0) {
    facts.push(el('span', null, el('b', { text: lightYears(o.parallax) }), ' light-years'));
  }
  const mags = [];
  if (isNum(o.vmag)) mags.push(`V ${o.vmag.toFixed(1)}`);
  if (isNum(o.kmag)) mags.push(`K ${o.kmag.toFixed(1)}`);
  if (mags.length) facts.push(el('span', null, 'Magnitude ', el('b', { text: mags.join(', ') })));
  const others = Array.isArray(o.ids) ? o.ids.filter((id) => typeof id === 'string' && id && id !== name).slice(0, 3) : [];
  // A fast mover found by its track: the catalogue lists it where it used to be.
  const mv = o.mover && typeof o.mover === 'object' && isNum(o.mover.catalogueSepArcsec) ? o.mover : null;
  let moverLine = null;
  if (mv) {
    const far = mv.catalogueSepArcsec >= 90 ? `${(mv.catalogueSepArcsec / 60).toFixed(1)} arcmin` : `${mv.catalogueSepArcsec.toFixed(0)} arcsec`;
    const since = isNum(mv.epoch) ? ` since about ${Math.round(mv.epoch)}` : '';
    moverLine = el('div', { class: 'tbi-facts' }, el('span', null, 'The catalogue lists it ', el('b', { text: far }), ` from here, where it used to be. Its proper motion has carried it to this spot${since}.`));
  }
  return el(
    'li',
    { class: 'tbi-obj' },
    el('div', { class: 'tbi-obj-top' }, outLink(o.url, name, 'tbi-name'), el('span', { class: 'tbi-sep', text: mv ? 'on its track' : sepText(o.sepArcsec) })),
    el('div', { class: 'tbi-type', text: typeof o.typeLabel === 'string' && o.typeLabel ? o.typeLabel : 'catalogued object' }),
    moverLine,
    facts.length ? el('div', { class: 'tbi-facts' }, facts) : null,
    others.length ? el('div', { class: 'tbi-aka', text: `Also ${others.join(', ')}` }) : null,
  );
}

export function install(app) {
  if (!app || typeof app.addPanel !== 'function' || typeof app.on !== 'function') return undefined;
  if (typeof document === 'undefined') return undefined;
  ensureIdentifyStyles(document);

  const cache = new Map();
  let view = null; // DOM handles, set when the panel is first drawn
  let controller = null;
  let token = 0;
  let key = '';
  let catalogue = { state: 'idle', objects: [], source: '', error: null };
  let disposed = false;

  const selection = () => {
    try {
      const s = typeof app.selection === 'function' ? app.selection() : null;
      return s && isNum(s.ra) && isNum(s.dec) ? s : null;
    } catch {
      return null;
    }
  };

  function epochs() {
    let frames = [];
    try {
      frames = typeof app.frames === 'function' ? app.frames() || [] : [];
    } catch {
      frames = [];
    }
    const mjds = frames.map((f) => f && f.mjd).filter(isNum);
    let current = null;
    try {
      const movie = typeof app.movie === 'function' ? app.movie() : null;
      const frame = movie && movie.frames ? movie.frames[movie.index] : null;
      if (frame && isNum(frame.mjd)) current = frame.mjd;
    } catch {
      current = null;
    }
    if (!mjds.length) return { at: current ?? mjdNow(), first: null, last: null };
    const first = Math.min(...mjds);
    const last = Math.max(...mjds);
    return { at: current ?? (first + last) / 2, first, last };
  }

  function gaiaStars() {
    try {
      const stars = typeof app.gaia === 'function' ? app.gaia() : [];
      return Array.isArray(stars) ? stars : [];
    } catch {
      return [];
    }
  }

  // ---- drawing -------------------------------------------------------------------------------

  function drawCatalogue() {
    if (!view) return;
    const host = view.catalogue;
    host.replaceChildren();
    view.catSection.dataset.state = catalogue.state;
    view.catSource.textContent = catalogue.state === 'ready' || catalogue.state === 'empty' ? `${catalogue.source === 'synthetic' ? 'Synthetic test sky' : 'SIMBAD'}, within ${RADIUS_ARCSEC} arcsec` : '';
    if (catalogue.state === 'loading') {
      host.append(
        el('p', { class: 'tbi-state tbi-busy', role: 'status' }, TEXT.loading, el('span', { class: 'tbi-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'))),
      );
    } else if (catalogue.state === 'empty') {
      host.append(el('p', { class: 'tbi-state', role: 'status', text: TEXT.empty }));
    } else if (catalogue.state === 'error') {
      const { message, retryable } = catalogue.error;
      host.append(
        el(
          'div',
          { class: 'tbi-error', role: 'alert' },
          el('p', { text: 'The catalogue lookup did not work.' }),
          el('small', { text: message }),
          retryable ? el('button', { class: 'tbi-btn', type: 'button', onclick: () => lookUp(true) }, 'Try again') : null,
        ),
      );
    } else if (catalogue.state === 'ready') {
      const shown = catalogue.objects.slice(0, MAX_SHOWN);
      host.append(el('ul', { class: 'tbi-list' }, shown.map(objectItem)));
      const extra = catalogue.objects.length - shown.length;
      if (extra > 0) host.append(el('p', { class: 'tbi-more', text: `And ${extra} more further out.` }));
    }
  }

  function drawGaia(sel, near, when) {
    const host = view.gaia;
    host.replaceChildren();
    if (!near) {
      host.append(el('p', { class: 'tbi-state', text: gaiaStars().length ? 'No Gaia star could be placed near this position.' : TEXT.noGaiaLoaded }));
      return;
    }
    const star = near.star;
    const id = star.id !== undefined && star.id !== null && /^\d{1,25}$/.test(String(star.id)) ? String(star.id) : '';
    const title = id ? `Gaia DR3 ${id}` : 'Gaia DR3 star';
    const lines = [];
    const where = near.sepArcsec <= GAIA_MATCH_ARCSEC ? 'close enough to be this source' : 'too far to be this source';
    lines.push(el('p', null, el('b', { text: sepText(near.sepArcsec) }), `, ${where}`, isNum(star.gmag) ? [' · G magnitude ', el('b', { text: star.gmag.toFixed(1) })] : null));
    if (near.pmTotal !== null) {
      const perYear = formatMotion(near.pmTotal);
      const years = isNum(when.first) && isNum(when.last) ? (when.last - when.first) / 365.25 : 0;
      const parts = ['Gaia predicts ', el('b', { text: perYear }), near.direction ? ` towards the ${near.direction}` : ''];
      if (years > 0.05) {
        const shift = (near.pmTotal * years) / 1000;
        const months = Math.max(1, Math.round(years * 12));
        const pixels = shift / SPHEREX_PIXEL_ARCSEC;
        if (pixels >= 0.1) {
          parts.push(': ', el('b', { text: `${shift.toFixed(1)} arcsec` }), ` over the ${months} ${months === 1 ? 'month' : 'months'} of frames loaded (${pixels.toFixed(1)} SPHEREx pixels)`);
        } else {
          parts.push(`, far too little to see at SPHEREx's 6 arcsec pixels over the ${months} ${months === 1 ? 'month' : 'months'} of frames loaded`);
        }
      }
      parts.push('.');
      lines.push(el('p', null, parts));
    } else {
      lines.push(el('p', { text: 'Gaia lists no proper motion for it.' }));
    }
    if (isNum(star.parallax) && star.parallax > 0.5) {
      lines.push(el('p', null, 'Parallax puts it about ', el('b', { text: `${lightYears(star.parallax)} light-years` }), ' away.'));
    }
    host.append(el('div', { class: 'tbi-gaia' }, id ? outLink(simbadIdUrl(title), title, 'tbi-name') : el('span', { class: 'tbi-name', text: title }), lines));
  }

  function drawHints(sel, near) {
    const host = view.hints;
    host.replaceChildren();
    const stars = gaiaStars();
    let result = { hints: [] };
    try {
      result = classify({
        binned: Array.isArray(sel.binned) && sel.binned.length ? sel.binned : sel.spectrum,
        lightCurve: sel.lightCurve,
        motion: sel.motion,
        gaia: stars.length ? (near && near.sepArcsec <= GAIA_MATCH_ARCSEC ? near : null) : undefined,
        size: sel.size,
      });
    } catch {
      result = { hints: [] };
    }
    view.hintSection.dataset.count = String(result.hints.length);
    if (!result.hints.length) {
      host.append(el('p', { class: 'tbi-state', text: TEXT.noHints }));
    } else {
      host.append(
        el(
          'ul',
          { class: 'tbi-hints' },
          result.hints.map((h) =>
            el(
              'li',
              { class: 'tbi-hint', 'data-hint': h.id, 'data-flag': FLAGGED.has(h.id) ? '1' : null },
              el('div', { class: 'tbi-hint-head' }, el('h4', { text: h.title }), el('span', { class: 'tbi-conf', 'data-level': h.confidence, title: CONFIDENCE_TITLES[h.confidence] || null, text: h.confidence })),
              el('p', { text: h.text }),
            ),
          ),
        ),
      );
    }
    host.append(el('p', { class: 'tbi-note', text: TEXT.note }));
  }

  function drawLocal() {
    if (!view) return;
    const sel = selection();
    view.idle.hidden = Boolean(sel);
    view.body.hidden = !sel;
    if (!sel) return;
    let coord = { hms: '', dms: '', deg: `${sel.ra.toFixed(5)} ${sel.dec >= 0 ? '+' : ''}${sel.dec.toFixed(5)}` };
    try {
      coord = formatCoord(sel.ra, sel.dec);
    } catch {
      // keep the plain degrees
    }
    view.coord.textContent = coord.hms ? `${coord.hms} ${coord.dms}` : coord.deg;
    view.coord.title = coord.deg;
    const when = epochs();
    const near = nearestGaia(gaiaStars(), sel.ra, sel.dec, when.at);
    drawGaia(sel, near, when);
    drawHints(sel, near);
  }

  // ---- catalogue lookup ----------------------------------------------------------------------

  function lookUp(force = false) {
    const sel = selection();
    if (!sel) {
      key = '';
      if (controller) controller.abort();
      catalogue = { state: 'idle', objects: [], source: '', error: null };
      drawCatalogue();
      return;
    }
    const wanted = `${sel.ra.toFixed(5)},${sel.dec.toFixed(5)}`;
    if (!force && wanted === key && catalogue.state !== 'idle') return;
    key = wanted;
    if (controller) controller.abort();
    const hit = force ? null : cache.get(wanted);
    if (hit) {
      catalogue = hit;
      drawCatalogue();
      return;
    }
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    const mine = ++token;
    catalogue = { state: 'loading', objects: [], source: '', error: null };
    drawCatalogue();
    Promise.resolve()
      .then(() => fetchCatalogue(app, sel.ra, sel.dec, RADIUS_DEG, controller ? controller.signal : undefined))
      .then((body) => {
        if (mine !== token || disposed) return;
        const objects = body && Array.isArray(body.objects) ? body.objects.filter((o) => o && typeof o === 'object') : [];
        catalogue = { state: objects.length ? 'ready' : 'empty', objects, source: body && typeof body.source === 'string' ? body.source : 'simbad', error: null };
        cache.set(wanted, catalogue);
        if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
        drawCatalogue();
      })
      .catch((err) => {
        if (mine !== token || disposed) return;
        if (err && (err.name === 'AbortError' || err.aborted)) return;
        catalogue = { state: 'error', objects: [], source: '', error: describeFailure(err) };
        drawCatalogue();
      });
  }

  function refresh() {
    try {
      drawLocal();
      if (view) lookUp(false);
    } catch (err) {
      console.warn('[tombaugh] identify', err);
    }
  }

  // ---- panel ---------------------------------------------------------------------------------

  function render(container) {
    const coord = el('div', { class: 'tbi-coord' });
    const catSource = el('span', { class: 'tbi-src' });
    const catalogueHost = el('div', { 'aria-live': 'polite' });
    const gaiaHost = el('div');
    const hintsHost = el('div', { class: 'tbi-hintbox' });
    const catSection = el(
      'section',
      { class: 'tbi-sec', 'data-part': 'catalogue', 'data-state': 'idle' },
      el('div', { class: 'tbi-sec-head' }, el('h3', { class: 'tbi-h', text: 'In the catalogues' }), catSource),
      catalogueHost,
    );
    const hintSection = el('section', { class: 'tbi-sec', 'data-part': 'hints' }, el('h3', { class: 'tbi-h', text: TEXT.hintsHeading }), hintsHost);
    const body = el(
      'div',
      { class: 'tbi', hidden: true },
      el('div', { class: 'tbi-where' }, el('span', { class: 'tbi-label', text: 'Selected source' }), coord),
      catSection,
      el('section', { class: 'tbi-sec', 'data-part': 'gaia' }, el('h3', { class: 'tbi-h', text: 'Nearest Gaia star' }), gaiaHost),
      hintSection,
    );
    const idle = el('div', { class: 'tbi' }, el('p', { class: 'tbi-idle', text: TEXT.idle }));
    container.append(idle, body);
    view = { idle, body, coord, catalogue: catalogueHost, catSource, catSection, gaia: gaiaHost, hints: hintsHost, hintSection };
    refresh();
    return {
      update: refresh,
      dispose() {
        view = null;
        idle.remove();
        body.remove();
      },
    };
  }

  const panel = app.addPanel({ id: meta.id, title: meta.title, order: 35, render });
  const offs = [];
  const listen = (event, fn) => {
    try {
      const off = app.on(event, fn);
      if (typeof off === 'function') offs.push(off);
    } catch {
      // the shell does not know this event
    }
  };
  listen('select', refresh);
  // More frames or a rebuilt movie can change what was measured for the same click.
  const redrawLocal = () => {
    try {
      drawLocal();
    } catch (err) {
      console.warn('[tombaugh] identify', err);
    }
  };
  listen('frames', redrawLocal);
  listen('movie', redrawLocal);
  listen('target', refresh);

  return {
    refresh,
    dispose() {
      disposed = true;
      token++;
      if (controller) controller.abort();
      for (const off of offs.splice(0)) {
        try {
          off();
        } catch {
          // already gone
        }
      }
      try {
        if (panel && typeof panel.remove === 'function') panel.remove();
      } catch {
        // already gone
      }
      view = null;
    },
  };
}
