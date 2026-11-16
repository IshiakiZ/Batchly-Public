// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// "Data source" plugin: says where the images on screen come from and lets the user change it.
//
//   Proxy on batch-ly.com                  the normal path, about 50 KB per exposure
//   Direct from NASA's public cloud copy   the same files read by the browser itself, 1.5 MB each
//   Practice sky: simulated                a made-up field with planted objects and an answer key
//
// It adds a toolbar button (group 'extra') and a side panel with: the current source and a plain
// description, the three choices, what is in this browser's cache with a "Clear cache" button,
// and in practice mode a "Show answers" switch that marks the planted objects on the image.
//
// How it reaches the data layer (web/src/local/mode.js):
//   * If the shell built its api with createPageApi(), `app.api.dataSource` is the controller.
//   * Otherwise the plugin wraps `app.api` in place with the same facade, so that later requests
//     go through it. That cannot undo a request the shell already made, so see restart() below.
//   * After a change the frames on screen have to be loaded again. `app.setApi?.(api)` is the
//     hook for that (the shell drops what it loaded and loads the current target again). Without
//     it the page is reloaded with `?source=...`, which only helps if the shell reads that
//     parameter (it does when it uses createPageApi).
//
// Everything simulated is marked: a SIMULATED badge on the image, the word in every frame
// caption (so it is also in exported pictures), and in this panel.

import { formatBytes } from '../../local/idbcache.js';
import { ensureLocalStyles, simulatedBadge } from '../../local/local.css.js';
import { createPageApi, withSourceParam } from '../../local/mode.js';
import { looksSimulated, practiceBannerText, practiceCaptionNote, practiceTruth, revealAnswers } from '../../local/practice.js';
import { ensureDataSourceStyles } from './datasource.css.js';

export const meta = {
  id: 'datasource',
  title: 'Data source',
  description: "Shows where the images come from and switches between the proxy, NASA's public cloud copy and the simulated practice sky.",
};

export const TEXT = Object.freeze({
  toolLabel: 'Data source',
  toolTitle: "Where the images come from: the proxy, NASA's public cloud copy, or the simulated practice sky",
  now: 'Now reading from',
  choose: 'Read the data from',
  cache: 'Cache in this browser',
  clear: 'Clear cache',
  cleared: 'Cache cleared.',
  loading: 'Starting the data service inside this page…',
  cannotReach: "This page cannot reach NASA's public cloud copy from here: the request was blocked or there is no connection. Nothing was changed.",
  nextPosition: 'This applies from the next position you open. The frames on screen were loaded before the change.',
  staleReal: 'The frames on screen were loaded from the real archive before the practice sky was chosen. Open the position again to see the simulated field.',
  staleSimulated: 'The frames on screen are still the simulated ones. Open a position again to load real data.',
  answers: 'Show answers',
  answersHint: 'Marks the planted objects on the image and lists them here. Leave it off to look for them yourself.',
  anywhere: 'The same objects are planted around whatever position you open.',
  truthFailed: 'The answer key of the practice sky could not be loaded.',
});

/** "12.3 MB in 84 items, kept in this browser between visits (limit 300 MB)." */
export function cacheLine(stats) {
  if (!stats) return 'Not in use yet.';
  const items = `${stats.entries} ${stats.entries === 1 ? 'item' : 'items'}`;
  const size = stats.entries ? `${formatBytes(stats.bytes)} in ${items}` : 'Empty';
  if (stats.persistent) return `${size}${stats.entries ? ',' : '.'} ${stats.entries ? 'kept' : 'What the direct and practice sources load is kept'} in this browser between visits (limit ${formatBytes(stats.maxBytes)}).`;
  return `${size}${stats.entries ? ',' : '.'} ${stats.entries ? 'held' : 'Held'} in memory only: this browser does not allow storage here, so it is gone when the page closes.`;
}

/** "41 arcsec east and 27 arcsec north of the field centre" */
export function offsetText(offset) {
  if (!offset || !Number.isFinite(offset.east) || !Number.isFinite(offset.north)) return '';
  const part = (value, plus, minus) => `${Math.abs(value).toFixed(0)} arcsec ${value >= 0 ? plus : minus}`;
  const east = Math.abs(offset.east) >= 0.5 ? part(offset.east, 'east', 'west') : '';
  const north = Math.abs(offset.north) >= 0.5 ? part(offset.north, 'north', 'south') : '';
  if (!east && !north) return 'at the field centre';
  return `${[east, north].filter(Boolean).join(' and ')} of the field centre`;
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const warn = (...args) => {
  try {
    console.warn('[tombaugh] data source:', ...args);
  } catch {
    // no console
  }
};

let uid = 0;

/**
 * install(app) -> { dispose(), controller, switchTo(source), setAnswers(on) }
 * Needs app.api. Uses app.addTool, app.addPanel (or app.openModal), app.addOverlay, app.on,
 * app.toast, app.target, app.frames, app.movie, app.viewer, app.setApi when they exist.
 */
export function install(app) {
  if (!app || typeof document === 'undefined' || !app.api || typeof app.api.search !== 'function') return { dispose() {} };
  ensureDataSourceStyles();
  ensureLocalStyles();

  const cleanups = [];
  let disposed = false;
  let adopted = null;
  let view = null; //          the rendered panel, once it has been shown
  let busy = false;
  let pending = ''; //         the source being started, so the choice shows while it loads
  let notice = null; //        { kind: 'info' | 'warn' | 'error', text }
  let pendingReload = false; // the source changed but the frames on screen were not loaded again
  let answersOn = false;
  let truth = null;
  let truthKey = '';
  let cacheStats = null;
  let badge = null;
  const id = `tbd-${++uid}`;

  const safe = (fn) => (...args) => {
    if (disposed) return undefined;
    try {
      return fn(...args);
    } catch (err) {
      warn(err);
      return undefined;
    }
  };

  // ---- the controller -------------------------------------------------------------------------
  function adopt() {
    try {
      const api = app.api;
      const original = { ...api };
      const facade = createPageApi({ remote: original, win: window });
      const replaced = {};
      for (const key of Object.keys(facade)) {
        if (typeof facade[key] !== 'function') continue;
        replaced[key] = api[key];
        api[key] = facade[key];
      }
      Object.defineProperty(api, 'baseUrl', { configurable: true, enumerable: true, get: () => facade.baseUrl });
      api.dataSource = facade.dataSource;
      adopted = { original, replaced };
      return facade.dataSource;
    } catch (err) {
      warn('the api object could not be wrapped', err);
      return null;
    }
  }
  const ds = app.api.dataSource && typeof app.api.dataSource.current === 'function' ? app.api.dataSource : adopt();
  if (!ds) return { dispose() {} };

  const now = () => ds.current();
  const isPractice = () => now().source === 'practice';
  const loadedFrames = () => {
    try {
      return typeof app.frames === 'function' ? app.frames() || [] : [];
    } catch {
      return [];
    }
  };
  const target = () => {
    try {
      return typeof app.target === 'function' ? app.target() : null;
    } catch {
      return null;
    }
  };
  const toast = (message, opts) => {
    try {
      if (typeof app.toast === 'function') app.toast(message, opts);
    } catch (err) {
      warn(err);
    }
  };

  /**
   * Load the frames on screen again from the current source. True when that is under way or
   * not needed; false when the plugin has no way to do it (the notice then says so).
   */
  function restart(source) {
    if (typeof app.setApi === 'function') {
      app.setApi(app.api);
      return true;
    }
    if (!target()) return true; // nothing on screen: the next position uses the new source
    if (!adopted) {
      // The shell reads ?source= when it starts (createPageApi), so a reload does the job.
      try {
        window.location.assign(withSourceParam(window.location.href, source === 'proxy' ? null : source));
        return true;
      } catch (err) {
        warn('the page could not be reloaded', err);
      }
    }
    return false;
  }

  async function switchTo(source) {
    if (disposed || busy || source === now().source) {
      update();
      return now();
    }
    busy = true;
    pending = source;
    notice = { kind: 'info', text: TEXT.loading };
    update();
    try {
      if (source === 'direct') {
        const probe = await ds.probe();
        if (!probe || !probe.allowed) {
          notice = { kind: 'warn', text: TEXT.cannotReach };
          return now();
        }
      }
      await ds.use(source);
      notice = null;
      truth = null;
      truthKey = '';
      pendingReload = !restart(source);
      if (pendingReload) notice = { kind: 'info', text: TEXT.nextPosition };
    } catch (err) {
      notice = { kind: 'error', text: `${err && err.message ? err.message : 'That source could not be started'}. Nothing was changed.` };
    } finally {
      busy = false;
      pending = '';
      if (!disposed) {
        update();
        refreshTruth();
        refreshCache();
      }
    }
    return now();
  }

  // ---- practice sky: answer key, overlays, SIMULATED marks --------------------------------------
  function refreshOverlays() {
    try {
      if (typeof app.refreshOverlays === 'function') app.refreshOverlays();
      else if (removeOverlay) {
        removeOverlay();
        removeOverlay = typeof app.addOverlay === 'function' ? app.addOverlay(overlay) : null;
      }
    } catch (err) {
      warn(err);
    }
  }

  function overlay(frame) {
    if (!answersOn || !truth || !isPractice()) return null;
    return revealAnswers(truth, frame && Number.isFinite(frame.mjd) ? frame.mjd : undefined);
  }
  let removeOverlay = null;
  try {
    removeOverlay = typeof app.addOverlay === 'function' ? app.addOverlay(overlay) : null;
  } catch (err) {
    warn(err);
  }

  async function refreshTruth() {
    if (!isPractice()) {
      truth = null;
      truthKey = '';
      return;
    }
    const simulated = loadedFrames().find(looksSimulated);
    const t = target();
    const key = simulated ? simulated.id.replace(/^.*(l2b-syn-[^/]+).*$/, '$1') : t ? `${Number(t.ra).toFixed(4)},${Number(t.dec).toFixed(4)}` : '';
    if (!key || key === truthKey) return;
    truthKey = key;
    try {
      const found = simulated ? await practiceTruth(simulated.id) : await practiceTruth(Number(t.ra), Number(t.dec));
      if (disposed || truthKey !== key) return;
      truth = found;
    } catch (err) {
      if (disposed || truthKey !== key) return;
      truth = null;
      truthKey = '';
      notice = { kind: 'error', text: `${TEXT.truthFailed} ${err && err.message ? err.message : ''}`.trim() };
    }
    update();
    refreshOverlays();
  }

  /** Puts the marker where it will be seen: every frame caption, and a badge on the image. */
  function markSimulated() {
    const simulated = loadedFrames().some(looksSimulated);
    if (simulated && typeof app.movie === 'function') {
      try {
        for (const frame of app.movie().frames || []) {
          if (!frame) continue;
          if (frame.caption && typeof frame.caption === 'object') frame.caption.note = practiceCaptionNote(frame.caption.note);
          else frame.caption = { note: practiceCaptionNote('') };
        }
      } catch (err) {
        warn(err);
      }
    }
    const host = app.viewer && app.viewer.element && app.viewer.element.nodeType === 1 ? app.viewer.element : null;
    if (simulated && host) {
      if (!badge) badge = simulatedBadge(document, { overlay: true });
      if (badge.parentNode !== host) host.append(badge);
    } else if (badge) {
      badge.remove();
    }
    return simulated;
  }

  function setAnswers(on) {
    answersOn = Boolean(on);
    update();
    refreshOverlays();
    if (answersOn) refreshTruth();
  }

  // ---- cache ----------------------------------------------------------------------------------
  let cachePromise = null;
  function getCache() {
    if (!cachePromise) cachePromise = Promise.resolve().then(() => ds.cache());
    return cachePromise;
  }
  async function refreshCache() {
    try {
      const cache = await getCache();
      if (!cache || typeof cache.stats !== 'function') return;
      if (typeof cache.ready === 'function') await cache.ready();
      if (disposed) return;
      cacheStats = cache.stats();
      update();
    } catch (err) {
      warn(err);
    }
  }
  async function clearCache() {
    try {
      const cache = await getCache();
      if (cache && typeof cache.clear === 'function') await cache.clear();
      toast(TEXT.cleared, { kind: 'info' });
    } catch (err) {
      warn(err);
    }
    await refreshCache();
  }

  // ---- panel ----------------------------------------------------------------------------------
  function render(container) {
    const root = el('div', { class: 'tbd' });
    const nowLabel = el('span', { class: 'tbd-now-label' });
    const nowBadge = simulatedBadge(document);
    const nowText = el('p', { class: 'tbd-muted' });
    const noticeBox = el('p', { class: 'tbd-notice', role: 'status', 'aria-live': 'polite', hidden: true });

    const options = new Map();
    const fieldset = el('fieldset', { class: 'tbd-set' }, el('legend', { class: 'tbd-head' }, TEXT.choose));
    for (const info of ds.sources()) {
      const descId = `${id}-${info.id}-text`;
      const input = el('input', {
        type: 'radio',
        name: `${id}-source`,
        value: info.id,
        'aria-describedby': descId,
        onchange: safe(() => {
          if (input.checked) switchTo(info.id);
        }),
      });
      const text = el('span', { class: 'tbd-option-text', id: descId }, info.description);
      const label = el('label', { class: 'tbd-option' }, input, el('span', { class: 'tbd-option-label' }, info.label), text);
      options.set(info.id, { input, label, text });
      fieldset.append(label);
    }

    const cacheText = el('p', { class: 'tbd-muted' });
    const clearBtn = el('button', { type: 'button', class: 'tbd-btn', onclick: safe(() => clearCache()) }, TEXT.clear);
    const cacheBlock = el('div', null, el('p', { class: 'tbd-head' }, TEXT.cache), el('div', { class: 'tbd-row' }, cacheText, clearBtn));

    const bannerText = el('span', { class: 'tbl-banner-text' });
    const answersInput = el('input', { type: 'checkbox', 'aria-describedby': `${id}-answers-hint`, onchange: safe(() => setAnswers(answersInput.checked)) });
    const answersList = el('ul', { class: 'tbd-answers', hidden: true });
    const practiceBlock = el(
      'div',
      { class: 'tbd-practice', hidden: true },
      el('p', { class: 'tbl-banner' }, simulatedBadge(document), bannerText),
      el('p', { class: 'tbd-muted' }, TEXT.anywhere),
      el('label', { class: 'tbd-check' }, answersInput, TEXT.answers),
      el('p', { class: 'tbd-muted', id: `${id}-answers-hint` }, TEXT.answersHint),
      answersList,
    );

    root.append(el('div', null, el('p', { class: 'tbd-head' }, TEXT.now), el('p', { class: 'tbd-now' }, nowLabel, nowBadge), nowText), noticeBox, fieldset, cacheBlock, practiceBlock);
    container.append(root);

    function paint() {
      const state = now();
      nowLabel.textContent = state.label;
      nowBadge.hidden = !state.simulated;
      nowText.textContent = state.description;

      // What to say right now, most urgent first.
      const frames = loadedFrames();
      const simulatedOnScreen = frames.some(looksSimulated);
      let say = notice;
      if (!say && frames.length && state.simulated && !simulatedOnScreen) say = { kind: 'warn', text: TEXT.staleReal };
      if (!say && frames.length && !state.simulated && simulatedOnScreen) say = { kind: 'warn', text: TEXT.staleSimulated };
      if (!say && state.note) say = { kind: 'warn', text: state.note };
      const last = ds.lastChange();
      if (!say && last && last.source === state.source && !last.forced && state.source === 'direct') say = { kind: 'warn', text: last.message };
      noticeBox.hidden = !say;
      noticeBox.textContent = say ? say.text : '';
      if (say) noticeBox.dataset.kind = say.kind;

      fieldset.setAttribute('aria-busy', String(busy));
      for (const [key, { input, label, text }] of options) {
        input.checked = key === (pending || state.source);
        input.disabled = busy && key !== pending; // the chosen one keeps the keyboard focus
        label.classList.toggle('is-current', key === state.source);
        text.hidden = key === state.source; // the same words stand under "Now reading from"
      }

      cacheText.textContent = cacheLine(cacheStats);
      clearBtn.disabled = !cacheStats || cacheStats.entries === 0;

      practiceBlock.hidden = !state.simulated;
      if (state.simulated) {
        bannerText.textContent = practiceBannerText({ answers: answersOn, count: truth ? truth.objects.length : 0 }).replace(/^Practice sky: simulated data\.\s*/, '');
        answersInput.checked = answersOn;
        const show = answersOn && truth;
        answersList.hidden = !show;
        answersList.replaceChildren();
        if (show) {
          for (const obj of truth.objects) {
            const where = offsetText(obj.offset);
            answersList.append(
              el(
                'li',
                { class: 'tbd-answer' },
                el('p', { class: 'tbd-answer-title' }, obj.title),
                el('p', null, obj.summary),
                where ? el('p', { class: 'tbd-answer-where' }, `In ${truth.passes[0] ? truth.passes[0].label : 'the first pass'}: ${where}.`) : null,
                obj.lookFor ? el('p', { class: 'tbd-answer-where' }, obj.lookFor) : null,
              ),
            );
          }
        }
      }
    }
    paint();
    refreshCache();
    return {
      update: () => {
        paint();
        refreshCache();
      },
      paint,
      dispose: () => root.remove(),
    };
  }

  function update() {
    if (disposed) return;
    try {
      const state = now();
      if (tool) {
        tool.setActive(state.source !== 'proxy');
        if (tool.el && !tool.el.classList.contains('has-icon')) tool.el.textContent = state.simulated ? `${TEXT.toolLabel}: simulated` : TEXT.toolLabel;
      }
      markSimulated();
      if (view && typeof view.paint === 'function') view.paint();
    } catch (err) {
      warn(err);
    }
  }

  // ---- wiring ---------------------------------------------------------------------------------
  let panel = null;
  let modal = null;
  let tool = null;
  const renderOnce = (container) => {
    view = render(container);
    return view;
  };
  try {
    if (typeof app.addPanel === 'function') panel = app.addPanel({ id: meta.id, title: meta.title, order: 90, render: renderOnce });
  } catch (err) {
    warn(err);
  }
  function open() {
    if (panel && typeof panel.show === 'function') panel.show();
    else if (typeof app.openModal === 'function') {
      modal = app.openModal({
        title: meta.title,
        render: renderOnce,
        onClose: () => {
          view = null;
          modal = null;
        },
      });
    }
  }
  try {
    if (typeof app.addTool === 'function') {
      tool = app.addTool({ id: meta.id, label: TEXT.toolLabel, title: TEXT.toolTitle, group: 'extra', onClick: safe(open) });
    }
  } catch (err) {
    warn(err);
  }

  cleanups.push(
    ds.onChange(
      safe((change) => {
        if (!change.forced) toast(change.message, { kind: 'warn', ms: 12000 });
        else if (change.source === 'practice') toast(change.message, { kind: 'info', ms: 6000 });
        truth = null;
        truthKey = '';
        update();
        refreshTruth();
      }),
    ),
  );
  if (typeof app.on === 'function') {
    let timer = null;
    const later = safe(() => {
      if (timer !== null) return;
      timer = setTimeout(
        safe(() => {
          timer = null;
          pendingReload = false;
          if (notice && notice.text === TEXT.nextPosition) notice = null;
          update();
          refreshTruth();
          refreshCache();
        }),
        400,
      );
    });
    cleanups.push(() => {
      if (timer !== null) clearTimeout(timer);
    });
    for (const [event, fn] of [
      ['target', safe(() => {
        truth = null;
        truthKey = '';
        later();
      })],
      ['frames', later],
      ['movie', safe(() => markSimulated())],
    ]) {
      try {
        const off = app.on(event, fn);
        if (typeof off === 'function') cleanups.push(off);
      } catch (err) {
        warn(err);
      }
    }
  }

  // What happened before the plugin was there to say it.
  const first = now();
  const last = ds.lastChange();
  if (last && !last.forced && last.source === first.source) toast(last.message, { kind: 'warn', ms: 12000 });
  else if (first.simulated) toast(practiceBannerText(), { kind: 'info', ms: 8000 });
  if (adopted && first.source !== 'proxy' && target()) {
    // The shell asked the proxy before this plugin existed. With the hook, load again.
    if (typeof app.setApi === 'function') safe(() => app.setApi(app.api))();
  }
  update();
  refreshTruth();

  return {
    controller: ds,
    switchTo,
    setAnswers,
    open,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const fn of cleanups) {
        try {
          fn();
        } catch (err) {
          warn(err);
        }
      }
      try {
        if (removeOverlay) removeOverlay();
        if (badge) badge.remove();
        if (tool) tool.remove();
        if (modal && typeof modal.close === 'function') modal.close();
        if (panel) panel.remove();
        else if (view && typeof view.dispose === 'function') view.dispose();
        if (adopted) {
          // Give the shell its own api back.
          for (const [key, fn] of Object.entries(adopted.replaced)) app.api[key] = fn;
          Object.defineProperty(app.api, 'baseUrl', { configurable: true, enumerable: true, writable: true, value: adopted.original.baseUrl });
          delete app.api.dataSource;
        }
      } catch (err) {
        warn(err);
      }
    },
  };
}
