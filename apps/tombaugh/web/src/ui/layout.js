// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Page layout: element lookup, screens (landing / console / embed), tabs, the narrow-screen
// controls sheet, dialogs, the search suggestions popover, and the status card drawn over the
// viewer while loading or after an error.

/** Tiny DOM builder: h('button', { class: 'btn', onclick }, 'Label'). */
export function h(tag, attrs = null, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

function safeStorage() {
  try {
    const s = globalThis.localStorage;
    const k = '__tombaugh_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

/** localStorage that never throws (sandboxed iframes have none). */
export const storage = {
  get(key) {
    const s = safeStorage();
    try {
      return s ? s.getItem(key) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    const s = safeStorage();
    try {
      if (s) s.setItem(key, value);
    } catch {
      // ignore
    }
  },
};

const BUILTIN_TABS = [
  { id: 'spectrum', order: 10 },
  { id: 'lightcurve', order: 20 },
  { id: 'motion', order: 30 },
  { id: 'candidates', order: 40 },
  { id: 'about', order: 90 },
];

/**
 * Turn a row that may be wider than its box (the view modes, the panel tabs) into a strip that
 * scrolls sideways: the overflowing edge fades out and gets a small arrow button, the mouse wheel
 * scrolls it, and `reveal(child)` brings one item fully into view (used for the active item, so
 * it can never be scrolled out of sight by a layout change).
 * -> { el: the wrapper, reveal(child), refresh() }
 */
export function makeScrollStrip(row, { label = 'items' } = {}) {
  const wrap = h('div', { class: 'strip' });
  const prev = h('button', { type: 'button', class: 'strip-arrow strip-prev', tabindex: '-1', 'aria-hidden': 'true', title: `Earlier ${label}` }, '‹');
  const next = h('button', { type: 'button', class: 'strip-arrow strip-next', tabindex: '-1', 'aria-hidden': 'true', title: `More ${label}` }, '›');
  row.replaceWith(wrap);
  wrap.append(row, prev, next);
  row.classList.add('strip-row');

  function refresh() {
    const max = row.scrollWidth - row.clientWidth;
    const x = row.scrollLeft;
    const left = max > 1 && x > 1;
    const right = max > 1 && x < max - 1;
    prev.hidden = !left;
    next.hidden = !right;
    wrap.classList.toggle('fade-left', left);
    wrap.classList.toggle('fade-right', right);
  }
  function scrollBy(dx) {
    try {
      row.scrollBy({ left: dx, behavior: 'smooth' });
    } catch {
      row.scrollLeft += dx;
    }
  }
  function reveal(child) {
    if (!child || !row.contains(child)) return;
    const pad = 28; // room for the arrow and the fade
    const a = child.offsetLeft - row.offsetLeft;
    const b = a + child.offsetWidth;
    if (a - pad < row.scrollLeft) row.scrollLeft = Math.max(0, a - pad);
    else if (b + pad > row.scrollLeft + row.clientWidth) row.scrollLeft = b + pad - row.clientWidth;
    refresh();
  }
  prev.addEventListener('click', () => scrollBy(-Math.max(120, row.clientWidth * 0.6)));
  next.addEventListener('click', () => scrollBy(Math.max(120, row.clientWidth * 0.6)));
  row.addEventListener('scroll', refresh, { passive: true });
  row.addEventListener(
    'wheel',
    (e) => {
      if (row.scrollWidth - row.clientWidth <= 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const before = row.scrollLeft;
      row.scrollLeft += e.deltaY;
      if (row.scrollLeft !== before) e.preventDefault();
    },
    { passive: false },
  );
  row.addEventListener('focusin', (e) => reveal(e.target.closest('button')));
  try {
    if (typeof ResizeObserver === 'function') new ResizeObserver(refresh).observe(row);
  } catch {
    // no ResizeObserver: the strip still scrolls
  }
  try {
    if (typeof MutationObserver === 'function') new MutationObserver(refresh).observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  } catch {
    // ignore
  }
  refresh();
  return { el: wrap, reveal, refresh };
}

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/**
 * createLayout({ onSearch(text), onHome() }) -> layout object with element references and
 * methods. All elements already exist in index.html; nothing here changes the page's geometry.
 */
export function createLayout({ onSearch = () => {}, onHome = () => {} } = {}) {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const els = {
    app: $('app'),
    topbar: $('topbar'),
    brand: $('brand'),
    simBadge: $('sim-badge'),
    fieldsum: $('fieldsum'),
    search: $('search'),
    searchInput: $('search-input'),
    searchStatus: $('search-status'),
    searchPop: $('search-pop'),
    searchExamples: $('search-examples'),
    searchTour: $('search-tour'),
    searchTourHeading: $('search-tour-heading'),
    btnMap: $('btn-map'),
    btnShare: $('btn-share'),
    btnHelp: $('btn-help'),
    btnMode: $('btn-mode'),
    simplebar: $('simplebar'),
    simple: $('simple'),
    viewSeg: $('view-seg'),
    btnSheet: $('btn-sheet'),
    btnSheetClose: $('btn-sheet-close'),
    modeopts: $('modeopts'),
    controls: $('controls'),
    controlsBody: $('controls-body'),
    viewerFrame: $('viewer-frame'),
    viewer: $('viewer'),
    viewerStatus: $('viewer-status'),
    viewerProgress: $('viewer-progress'),
    viewerProgressFill: $('viewer-progress-fill'),
    viewerProgressText: $('viewer-progress-text'),
    readout: $('readout'),
    toolstrip: $('toolstrip'),
    player: $('player'),
    side: $('side'),
    tabs: $('tabs'),
    panels: $('panels'),
    spectrumBody: $('spectrum-body'),
    lightcurveBody: $('lightcurve-body'),
    motionBody: $('motion-body'),
    candidatesBody: $('candidates-body'),
    candidatesCount: $('tab-candidates-count'),
    aboutBody: $('about-body'),
    cite: $('cite'),
    landing: $('landing'),
    sheetBackdrop: $('sheet-backdrop'),
    helpDialog: $('help-dialog'),
    helpBody: $('help-body'),
    mapDialog: $('map-dialog'),
    mapBody: $('map-body'),
    toasts: $('toasts'),
  };

  // ---- screens -------------------------------------------------------------------------------
  function setScreen(name) {
    root.dataset.screen = name;
    els.landing.hidden = name !== 'landing';
  }
  function setEmbed(on) {
    if (on) root.dataset.embed = '1';
    else delete root.dataset.embed;
  }
  /** 'simple' (the default) or 'advanced': which of the two faces of the console is showing. */
  function setMode(mode) {
    const advanced = mode === 'advanced';
    root.dataset.mode = advanced ? 'advanced' : 'simple';
    if (els.btnMode) {
      els.btnMode.setAttribute('aria-pressed', advanced ? 'true' : 'false');
      els.btnMode.textContent = advanced ? 'Simple' : 'Advanced';
      els.btnMode.title = advanced ? 'Back to the simple view: the picture and what changed' : 'Show every view, detector, plot and tool';
    }
  }
  /** The persistent "SIMULATED SKY, not real data" badge in the top bar. */
  function setSimulated(on) {
    if (els.simBadge) els.simBadge.hidden = !on;
    if (on) root.dataset.simulated = '1';
    else delete root.dataset.simulated;
  }

  // ---- tabs ----------------------------------------------------------------------------------
  let currentTab = 'spectrum';
  const tabs = BUILTIN_TABS.map((t) => ({ ...t, onShow: null }));
  const tabListeners = new Set();
  const stacked = typeof matchMedia === 'function' ? matchMedia('(max-width: 1099px)') : { matches: false };
  const tabIds = () => tabs.map((t) => t.id);

  const tabStrip = makeScrollStrip(els.tabs, { label: 'panels' });

  function selectTab(id, { focus = false, reveal = false } = {}) {
    if (!tabs.some((t) => t.id === id)) return;
    currentTab = id;
    for (const t of tabs) {
      const tab = $(`tab-${t.id}`);
      const panel = $(`panel-${t.id}`);
      if (!tab || !panel) continue;
      const on = t.id === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
      if (on) tabStrip.reveal(tab);
      if (on && focus) tab.focus();
      if (on && t.onShow) t.onShow();
      // Where the panels are stacked (narrow screens) "open this panel" means "scroll to it".
      if (on && reveal && stacked.matches) {
        try {
          panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch {
          // optional
        }
      }
    }
    for (const fn of tabListeners) fn(id);
  }
  els.tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (tab) selectTab(tab.id.replace('tab-', ''));
  });
  els.tabs.addEventListener('keydown', (e) => {
    const ids = tabIds().filter((id) => !$(`tab-${id}`).hidden);
    const i = ids.indexOf(currentTab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % ids.length;
    else if (e.key === 'ArrowLeft') next = (i + ids.length - 1) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    if (next >= 0) {
      e.preventDefault();
      e.stopPropagation();
      selectTab(ids[next], { focus: true });
    }
  });

  /**
   * Add a tab and its panel to the side column (used by plugins).
   * -> { body, show(), hide(), remove() }. `onShow` runs every time the panel becomes visible;
   * on narrow screens, where all panels are stacked, it runs straight away.
   */
  function addTab({ id, title, order = 60, onShow = null }) {
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
    if (tabs.some((t) => t.id === safe)) return null;
    const entry = { id: safe, order, onShow };
    const tab = h('button', { class: 'tab', role: 'tab', type: 'button', id: `tab-${safe}`, 'aria-controls': `panel-${safe}`, 'aria-selected': 'false', tabindex: '-1' }, title);
    const body = h('div', { class: 'panel-body' });
    const panel = h('section', { class: 'panel', id: `panel-${safe}`, role: 'tabpanel', 'aria-labelledby': `tab-${safe}`, tabindex: '0', hidden: true }, h('h2', { class: 'panel-title' }, title), body);
    const after = tabs.filter((t) => t.order <= order).pop();
    tabs.splice(after ? tabs.indexOf(after) + 1 : 0, 0, entry);
    if (after) {
      $(`tab-${after.id}`).after(tab);
      $(`panel-${after.id}`).after(panel);
    } else {
      els.tabs.prepend(tab);
      els.panels.prepend(panel);
    }
    const maybeShowStacked = () => {
      if (stacked.matches && !tab.hidden && entry.onShow) entry.onShow();
    };
    if (stacked.addEventListener) stacked.addEventListener('change', maybeShowStacked);
    // After this call has returned: the caller's onShow may use the handle it is about to get.
    Promise.resolve().then(maybeShowStacked);
    return {
      body,
      panel,
      show() {
        tab.hidden = false;
        panel.classList.remove('is-removed');
        selectTab(safe);
        maybeShowStacked();
      },
      hide() {
        tab.hidden = true;
        panel.classList.add('is-removed');
        if (currentTab === safe) selectTab('about');
      },
      remove() {
        const i = tabs.indexOf(entry);
        if (i >= 0) tabs.splice(i, 1);
        if (stacked.removeEventListener) stacked.removeEventListener('change', maybeShowStacked);
        tab.remove();
        panel.remove();
        if (currentTab === safe) selectTab('about');
      },
    };
  }

  // ---- viewer tool strip (used by plugins) ---------------------------------------------------
  const TOOL_GROUPS = ['view', 'export', 'extra'];
  function addTool({ id, label, title, icon = null, onClick, group = 'extra' }) {
    const g = TOOL_GROUPS.includes(group) ? group : 'extra';
    let host = els.toolstrip.querySelector(`[data-group="${g}"]`);
    if (!host) {
      host = h('div', { class: 'tool-group', dataset: { group: g } });
      const later = TOOL_GROUPS.slice(TOOL_GROUPS.indexOf(g) + 1)
        .map((name) => els.toolstrip.querySelector(`[data-group="${name}"]`))
        .find(Boolean);
      if (later) later.before(host);
      else els.toolstrip.append(host);
    }
    const btn = h('button', {
      type: 'button',
      class: 'tool',
      title: title || label || id,
      'aria-label': label || title || id,
      'aria-pressed': 'false',
      dataset: { tool: String(id) },
      onclick: (e) => {
        if (btn.disabled) return;
        try {
          if (onClick) onClick(e);
        } catch (err) {
          console.warn(`[tombaugh] tool "${id}" failed`, err);
        }
      },
    });
    if (typeof icon === 'string' && /^\s*<svg/i.test(icon)) {
      btn.innerHTML = icon;
      btn.classList.add('has-icon');
    } else if (icon && icon.nodeType) {
      btn.append(icon);
      btn.classList.add('has-icon');
    } else {
      btn.textContent = label || String(id);
    }
    const baseTitle = btn.title;
    host.append(btn);
    return {
      el: btn,
      setActive(on) {
        btn.setAttribute('aria-pressed', String(!!on));
      },
      setDisabled(disabled, reason) {
        btn.disabled = !!disabled;
        btn.title = disabled && reason ? reason : baseTitle;
      },
      remove() {
        btn.remove();
        if (!host.childElementCount) host.remove();
      },
    };
  }

  // ---- controls sheet (narrow screens) -------------------------------------------------------
  let sheetOpen = false;
  function setSheet(open) {
    sheetOpen = open;
    els.controls.classList.toggle('is-open', open);
    els.sheetBackdrop.hidden = !open;
    els.btnSheet.setAttribute('aria-expanded', String(open));
    if (open) {
      const first = els.controls.querySelector('button, select, input');
      if (first) first.focus({ preventScroll: true });
    } else if (document.activeElement && els.controls.contains(document.activeElement)) {
      els.btnSheet.focus({ preventScroll: true });
    }
  }
  els.btnSheet.setAttribute('aria-expanded', 'false');
  els.btnSheet.addEventListener('click', () => setSheet(!sheetOpen));
  els.btnSheetClose.addEventListener('click', () => setSheet(false));
  els.sheetBackdrop.addEventListener('click', () => setSheet(false));

  // ---- dialogs -------------------------------------------------------------------------------
  function openDialog(dialog) {
    try {
      if (!dialog.open) dialog.showModal();
    } catch {
      dialog.setAttribute('open', '');
    }
  }
  function closeDialog(dialog) {
    try {
      dialog.close();
    } catch {
      dialog.removeAttribute('open');
    }
  }
  function wireDialog(dialog) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog || e.target.closest('[data-close-dialog]')) closeDialog(dialog);
    });
  }
  for (const dialog of [els.helpDialog, els.mapDialog]) wireDialog(dialog);

  /** A centred modal (native <dialog>: focus is trapped and Esc closes it). -> { close(), body } */
  let modalCount = 0;
  function openModal({ title = '', render = null, onClose = null, wide = false } = {}) {
    const titleId = `modal-title-${++modalCount}`;
    const body = h('div', { class: 'dialog-body' });
    const dialog = h(
      'dialog',
      { class: `dialog${wide ? ' dialog-wide' : ''}`, 'aria-labelledby': titleId },
      h('div', { class: 'dialog-head' }, h('h2', { class: 'dialog-title', id: titleId }, title), h('button', { class: 'btn btn-quiet', type: 'button', 'data-close-dialog': true, 'aria-label': 'Close' }, 'Close')),
      body,
    );
    wireDialog(dialog);
    let closed = false;
    dialog.addEventListener('close', () => {
      if (closed) return;
      closed = true;
      try {
        if (onClose) onClose();
      } catch (err) {
        console.warn('[tombaugh] modal onClose failed', err);
      }
      dialog.remove();
    });
    document.body.append(dialog);
    try {
      if (render) render(body);
    } catch (err) {
      console.warn('[tombaugh] modal render failed', err);
      body.textContent = 'This panel could not be drawn.';
    }
    openDialog(dialog);
    return {
      body,
      close() {
        if (closed) return;
        closeDialog(dialog);
        if (!closed) dialog.dispatchEvent(new Event('close'));
      },
    };
  }

  // ---- search --------------------------------------------------------------------------------
  let popOpen = false;
  function setPop(open) {
    if (popOpen === open) return;
    popOpen = open;
    els.searchPop.hidden = !open;
    els.searchInput.setAttribute('aria-expanded', String(open));
  }
  els.searchInput.setAttribute('aria-expanded', 'false');
  els.searchInput.addEventListener('focus', () => setPop(true));
  els.searchInput.addEventListener('click', () => setPop(true));
  els.searchInput.addEventListener('input', () => setPop(els.searchInput.value.trim() === ''));
  els.search.addEventListener('focusout', (e) => {
    if (!els.search.contains(e.relatedTarget)) setPop(false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (popOpen && !els.search.contains(e.target)) setPop(false);
  });
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popOpen) {
      e.stopPropagation();
      setPop(false);
    }
  });
  els.search.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.searchInput.value.trim();
    if (!text) {
      els.searchInput.focus();
      return;
    }
    setPop(false);
    onSearch(text);
  });
  els.brand.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onHome();
  });

  function setExamples(examples, onPick) {
    clear(els.searchExamples);
    for (const ex of examples) {
      els.searchExamples.append(
        h(
          'li',
          null,
          h(
            'button',
            {
              type: 'button',
              class: 'pop-example',
              onclick: () => {
                els.searchInput.value = ex.text;
                setPop(false);
                onPick(ex.text);
              },
            },
            h('span', { class: 'num' }, ex.text),
            h('span', { class: 'what' }, ex.what),
          ),
        ),
      );
    }
  }

  function setSearchStatus(nodes, { error = false } = {}) {
    clear(els.searchStatus);
    els.searchStatus.classList.toggle('is-error', error);
    if (nodes === null || nodes === undefined) return;
    for (const n of [].concat(nodes)) els.searchStatus.append(n.nodeType ? n : document.createTextNode(String(n)));
  }

  // ---- status card over the viewer -----------------------------------------------------------
  let elapsedTimer = null;
  let statusKey = '';
  let statusRefs = null;

  function stopElapsed() {
    if (elapsedTimer !== null) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  /**
   * setStatus(null) hides the card. Otherwise:
   *   { kind: 'loading', key, kicker, title, text, done, total, startedAt, soft }
   *   { kind: 'error' | 'empty', title, text, actions: [{ label, onClick, primary }], extra: Node }
   * A loading card with the same `key` is updated in place (no flicker, the clock keeps running).
   */
  function setStatus(status) {
    const host = els.viewerStatus;
    if (!status) {
      stopElapsed();
      statusKey = '';
      statusRefs = null;
      host.hidden = true;
      clear(host);
      return;
    }
    host.classList.toggle('is-soft', !!status.soft);
    if (status.kind === 'loading') {
      const key = `loading:${status.key || ''}`;
      if (statusKey !== key || !statusRefs) {
        stopElapsed();
        clear(host);
        const kicker = h('span');
        const clock = h('span', { class: 'num' });
        const title = h('h2', { class: 'status-title' });
        const text = h('p', { class: 'status-text' });
        const fill = h('span');
        const meter = h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Loading progress' }, fill);
        const sub = h('p', { class: 'status-sub num' });
        const found = h('div', { class: 'status-found', hidden: true });
        host.append(h('div', { class: 'status-card', role: 'status' }, h('div', { class: 'status-kicker' }, kicker, clock), title, meter, found, text, sub));
        statusRefs = { kicker, clock, title, text, fill, meter, sub, found, foundKey: '', ticks: [], startedAt: status.startedAt || Date.now() };
        statusKey = key;
        const tick = () => {
          if (statusRefs) statusRefs.clock.textContent = formatElapsed(Date.now() - statusRefs.startedAt);
        };
        tick();
        elapsedTimer = setInterval(tick, 1000);
      }
      const r = statusRefs;
      r.kicker.textContent = status.kicker || 'Loading';
      r.title.textContent = status.title || '';
      r.text.textContent = status.text || '';
      // What the search found: one group of ticks per survey pass, a tick per exposure, lit as
      // each one arrives.
      const f = status.found;
      r.found.hidden = !f;
      if (f) {
        const key = `${f.line}|${f.groups.map((g) => `${g.label}:${g.total}`).join(',')}`;
        if (key !== r.foundKey) {
          r.foundKey = key;
          r.ticks = [];
          clear(r.found);
          const groups = h('div', { class: 'status-groups', 'aria-hidden': 'true' });
          for (const g of f.groups) {
            const row = h('div', { class: 'status-ticks' });
            const list = [];
            for (let i = 0; i < g.total; i++) {
              const tick = h('i');
              list.push(tick);
              row.append(tick);
            }
            r.ticks.push(list);
            const el = h('div', { class: 'status-group', title: `${g.label}: ${g.dates}, ${g.total} exposures` }, h('div', { class: 'status-group-label' }, `${g.label} · ${g.total}`), row);
            el.style.flex = `${Math.max(1, g.total)} 1 0`;
            groups.append(el);
          }
          r.found.append(h('p', { class: 'status-found-line' }, f.line), groups);
        }
        f.groups.forEach((g, k) => {
          (r.ticks[k] || []).forEach((tick, i) => {
            tick.className = g.states[i] === 1 ? 'is-in' : g.states[i] === 2 ? 'is-out' : '';
          });
        });
      }
      const determinate = Number.isFinite(status.total) && status.total > 0;
      r.meter.classList.toggle('is-indeterminate', !determinate);
      if (determinate) {
        const frac = Math.min(1, Math.max(0, status.done / status.total));
        r.fill.style.width = `${(frac * 100).toFixed(1)}%`;
        r.meter.setAttribute('aria-valuemin', '0');
        r.meter.setAttribute('aria-valuemax', String(status.total));
        r.meter.setAttribute('aria-valuenow', String(status.done));
        r.sub.textContent = status.sub || `${status.done} of ${status.total}`;
      } else {
        r.fill.style.width = '';
        r.meter.removeAttribute('aria-valuenow');
        r.sub.textContent = status.sub || '';
      }
      host.hidden = false;
      return;
    }
    stopElapsed();
    statusKey = status.kind;
    statusRefs = null;
    clear(host);
    const actions = h('div', { class: 'status-actions' });
    for (const a of status.actions || []) {
      actions.append(h('button', { type: 'button', class: `btn${a.primary ? ' btn-solid' : ''}`, onclick: a.onClick }, a.label));
    }
    const card = h(
      'div',
      { class: 'status-card', role: status.kind === 'error' ? 'alert' : 'status' },
      h('div', { class: `status-kicker${status.kind === 'error' ? ' is-alert' : ''}` }, h('span', null, status.kicker || (status.kind === 'error' ? 'Problem' : 'Nothing here'))),
      h('h2', { class: 'status-title' }, status.title || ''),
      status.text ? h('p', { class: 'status-text' }, status.text) : null,
      (status.actions || []).length ? actions : null,
      status.extra || null,
    );
    host.append(card);
    host.hidden = false;
    const primary = host.querySelector('.btn-solid');
    if (primary && status.kind === 'error' && document.activeElement === document.body) primary.focus({ preventScroll: true });
  }

  /** Slim progress line across the top of a movie that is already playing. */
  function setProgress(progress) {
    if (!progress) {
      els.viewerProgress.hidden = true;
      return;
    }
    els.viewerProgress.hidden = false;
    const frac = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
    els.viewerProgressFill.style.width = `${(frac * 100).toFixed(1)}%`;
    els.viewerProgressText.textContent = progress.text || '';
  }

  function setReadout(text) {
    els.readout.textContent = text || ' ';
  }

  return {
    els,
    setScreen,
    setEmbed,
    setMode,
    setSimulated,
    selectTab,
    addTab,
    addTool,
    openModal,
    currentTab: () => currentTab,
    onTab(fn) {
      tabListeners.add(fn);
      return () => tabListeners.delete(fn);
    },
    setSheet,
    isSheetOpen: () => sheetOpen,
    openDialog,
    closeDialog,
    setExamples,
    setSearchStatus,
    setSearchText(text) {
      els.searchInput.value = text;
    },
    closePop: () => setPop(false),
    setStatus,
    setProgress,
    setReadout,
  };
}
