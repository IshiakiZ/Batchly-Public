// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// plugin-story: the tool performs its own demonstration. `?story=demo&record=1` plays the
// 30-second film of docs/DEMO-SCRIPT.md with recordable captions, after preparing every view it
// needs, starting on a keypress so that one take is enough. `?story=tour` is a first-visit tour
// of the controls, and each challenge target has a short story of its own (`?story=barnard`).
//
// URL parameters (read once from location.search; `window.TOMBAUGH_STORY = { story, record, guide,
// speed }` does the same where the address cannot be read, as in a sandboxed frame):
//   story=<id>   demo | tour | barnard | eps-indi-b | wise0855 | rw-aur | r-dra
//   record=1     recording mode: only the viewer, the player, the open side panel and the captions
//   guide=1      draw the 16:9 frame and its 5 % safe area (for setting up the window)
//   speed=<f>    play faster or slower (rehearsal only; the film is timed for 1)
// Keys while a story runs: Space pause / resume (or start, or continue), Esc stop, Left / Right
// previous / next step, R restart. Without a story: Shift+T starts the tour, Shift+D the film in
// recording mode. Stopping always puts the view, detector and target back as they were.

import { createRunner, planTimeline } from './runner.js';
import { STORIES, getStory } from './script.js';
import { createCaptions, BAND_UNITS } from './captions.js';
import { createSpotlight } from './spotlight.js';
import { createAdapter } from './adapter.js';
import { injectStyles } from './story.css.js';
import { say, hush } from '../../ui/sound.js';

export const meta = {
  id: 'story',
  title: 'Tour',
  description: 'Guided stories: the 30-second demonstration film, a tour of the controls, and what to look for at each challenge target.',
};

/** Parse the story parameters out of a query string. Pure. */
export function readStoryParams(search) {
  const out = { story: '', record: false, guide: false, speed: 1 };
  let params;
  try {
    params = new URLSearchParams(String(search || ''));
  } catch {
    return out;
  }
  const on = (v) => v === '1' || v === 'true';
  out.story = (params.get('story') || '').trim().toLowerCase();
  out.record = on(params.get('record'));
  out.guide = on(params.get('guide'));
  const speed = Number(params.get('speed'));
  if (Number.isFinite(speed) && speed >= 0.25 && speed <= 8) out.speed = speed;
  return out;
}

/** "29 s" or "about 1.5 min". Pure. */
export function formatLength(seconds) {
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  return `about ${(Math.round(seconds / 30) / 2).toString()} min`;
}

function isTyping(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(String(el.type || 'text').toLowerCase());
  return !!el.isContentEditable;
}

export function install(app, opts = {}) {
  const doc = opts.doc || globalThis.document;
  if (!app || !doc || !doc.body) return { dispose() {} };
  const win = opts.win || doc.defaultView || globalThis.window;
  injectStyles(doc);

  let session = null;
  let tool = null;
  let panel = null;
  let autoTimer = null;
  const skipNotes = new Set();

  const ui = {
    url: (text) => {
      if (session) session.captions.url(text);
    },
    afterAction: (action) => {
      // A sky map or card may have opened above the captions; lift them back on top.
      if (session && (action.type === 'fog' || action.type === 'explain')) session.captions.promote();
    },
  };
  const adapter = createAdapter(app, { doc, win, ui, liveUrl: opts.liveUrl });

  const reducedMotion = () => {
    try {
      return !!(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  };

  const safe = (f) => (...args) => {
    try {
      return f(...args);
    } catch (err) {
      console.warn('[story] handler failed', err);
      return undefined;
    }
  };

  // ---- one run of one story -------------------------------------------------------------------
  function start(id, { record = false, guide = false, speed = 1 } = {}) {
    const story = getStory(id);
    if (!story) {
      const msg = `There is no story called "${id}". Try: ${STORIES.map((s) => s.id).join(', ')}.`;
      if (typeof app.toast === 'function') app.toast(msg, { kind: 'warn' });
      else console.info(`[story] ${msg}`);
      return false;
    }
    if (session) finish({ restore: true });

    let runner;
    try {
      runner = createRunner({ story, adapter: { perform: adapter.perform, check: adapter.check, resolve: adapter.resolve }, speed });
    } catch (err) {
      console.warn('[story]', err && err.message ? err.message : err);
      return false;
    }
    const recording = !!record;
    const s = { story, runner, recording, snapshot: adapter.snapshot(), offs: [], raf: 0, endHeld: false, wasPlaying: false, spot: null, spotKey: '' };
    s.captions = createCaptions({
      doc,
      win,
      recording,
      guide,
      reducedMotion: reducedMotion(),
      onStop: () => stop(),
      onShield: () => {
        // A click during a take: never trap the user. Pause and show the way out.
        if (s.endHeld) finish({ restore: true });
        else if (runner.state() === 'paused') runner.resume(); // a press carries on: a phone has no Space key
        else if (recording && runner.state() === 'running') runner.pause();
        else s.captions.showControls(true); // a tour keeps running; the press only shows the way out
      },
    });
    s.captions.setStopLabel(story.kind === 'film' ? 'Stop the film' : 'Stop tour');
    s.spotlight = createSpotlight({
      host: s.captions.el,
      app,
      doc,
      win,
      reducedMotion: reducedMotion(),
      unit: () => s.captions.rect().u,
      bounds: () => {
        const r = s.captions.rect();
        return { left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h - r.u * BAND_UNITS };
      },
    });
    session = s;
    if (tool) tool.setActive(true);

    const tag = () => s.captions.setTag(adapter.isSynthetic() ? 'Synthetic data' : null);

    const coarse = () => !!(win && typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches);
    const showPicture = () => {
      const frame = doc && typeof doc.getElementById === 'function' ? doc.getElementById('viewer-frame') : null;
      if (!frame || typeof frame.getBoundingClientRect !== 'function' || typeof frame.scrollIntoView !== 'function') return;
      const r = frame.getBoundingClientRect();
      const height = (win && win.innerHeight) || 0;
      if (!height || (r.top >= 0 && r.top <= height * 0.3)) return;
      frame.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    };

    const respot = () => {
      const spec = s.spot;
      if (!spec) {
        if (s.spotKey) s.spotlight.clear();
        s.spotKey = '';
        return;
      }
      let resolved = spec;
      if (spec.sky === 'target') {
        const pos = adapter.skyTarget('mid');
        resolved = pos ? { ...spec, sky: pos } : null;
      }
      const key = JSON.stringify(resolved);
      if (key === s.spotKey) return;
      s.spotKey = key;
      if (resolved) s.spotlight.point(resolved);
      else s.spotlight.clear();
    };

    const on = (type, f) => s.offs.push(runner.on(type, safe(f)));
    on('preload', (e) => s.captions.status({ label: runner.plan.preload ? runner.plan.preload.label : 'Preparing', sub: e.label, done: e.done, total: e.total }));
    on('ready', () => {
      if (story.startOnKey) s.captions.ready(runner.plan.preload ? runner.plan.preload.ready : 'Ready. Press Space to start');
      else runner.start();
    });
    on('start', () => {
      s.endHeld = false;
      s.captions.status(null);
      s.captions.showControls(false);
      s.captions.setRunning(true);
      tag();
    });
    on('step', () => tag());
    on('caption', (e) => {
      if (!e.caption) s.captions.clear();
      else if (e.caption.card) s.captions.card({ ...e.caption, id: e.id });
      else s.captions.show({ ...e.caption, id: e.id });
      // Spoken too, where the build carries a recorded line for this step (see ui/sound.js).
      // The line is left to finish when the caption clears; only a pause or the end stops it.
      if (e.caption && e.id) say(`${story.id}-${e.id}`);
    });
    on('spotlight', (e) => {
      s.spot = e.spotlight || null;
      respot();
      // A step that points at nothing is about the picture: bring the picture into view.
      if (!s.spot && !recording) showPicture();
    });
    on('waiting', (e) => {
      if (e.reason === 'key') s.captions.hint('Press Space to continue');
      else if (e.hold) s.captions.hint('Loading…');
    });
    on('pause', () => {
      const m = typeof app.movie === 'function' ? app.movie() : null;
      s.wasPlaying = !!(m && m.playing);
      if (typeof app.pause === 'function') app.pause();
      hush();
      s.captions.hint(coarse() ? 'Paused. Tap to go on' : 'Paused. Click or press Space to go on');
      s.captions.setRunning(false);
      s.captions.showControls(true);
    });
    on('resume', () => {
      s.captions.hint(null);
      s.captions.showControls(false);
      s.captions.setRunning(true);
      if (s.wasPlaying && typeof app.play === 'function') app.play();
      s.wasPlaying = false;
    });
    on('skipped', (e) => {
      const what = e.reason === 'timeout' ? `condition "${e.cond}" did not hold in time` : e.reason === 'error' ? `action "${e.action && e.action.type}" failed` : `action "${e.action && e.action.type}" is not supported here`;
      if (skipNotes.has(what)) return;
      skipNotes.add(what);
      console.info(`[story] skipped: ${what}${e.error ? ` (${e.error.message || e.error})` : ''}`);
    });
    on('done', () => {
      if (s.recording && story.holdEnd) {
        // Hold the last card so the tail of a recording is clean; any key or click lets go.
        s.endHeld = true;
        return;
      }
      finish({ restore: !!story.restoreOnDone });
    });
    on('stop', () => finish({ restore: true }));
    s.offs.push(
      adapter.onChange(
        safe(() => {
          runner.poke();
          runner.refreshCaption();
          respot();
          tag();
        }),
      ),
    );

    const tick = () => {
      if (session !== s) return;
      const total = runner.plan.total || 1;
      const st = runner.state();
      s.captions.progress(st === 'done' ? 1 : st === 'running' || st === 'paused' || st === 'waiting' ? runner.time() / total : 0);
      s.raf = win.requestAnimationFrame(tick);
    };
    if (win && typeof win.requestAnimationFrame === 'function') s.raf = win.requestAnimationFrame(tick);

    runner.prepare();
    return true;
  }

  function finish({ restore }) {
    const s = session;
    if (!s) return;
    session = null;
    hush();
    if (s.raf && win && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(s.raf);
    for (const off of s.offs) {
      try {
        off();
      } catch {
        // already removed
      }
    }
    if (s.runner.state() !== 'stopped' && s.runner.state() !== 'done') s.runner.stop('finish');
    s.spotlight.destroy();
    s.captions.destroy();
    if (restore) adapter.restore(s.snapshot);
    else adapter.cleanup();
    if (tool) tool.setActive(false);
  }

  function stop() {
    if (!session) return false;
    const st = session.runner.state();
    if (st === 'done' || st === 'stopped') finish({ restore: true });
    else session.runner.stop('user'); // -> 'stop' event -> finish({ restore: true })
    return true;
  }

  // ---- keyboard -------------------------------------------------------------------------------
  const onKey = safe((e) => {
    if (!e || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (isTyping(e.target)) return;
    const key = e.key;
    let handled = true;
    if (!session) {
      if (e.shiftKey && (key === 'T' || key === 't')) start('tour');
      else if (e.shiftKey && (key === 'D' || key === 'd')) start('demo', { record: true });
      else handled = false;
    } else {
      const s = session;
      const inLayer = e.target && typeof e.target.closest === 'function' && e.target.closest('.tbs-controls');
      if ((key === ' ' || key === 'Enter') && inLayer) return; // let the Stop button work from the keyboard
      if (s.endHeld) {
        if (key === 'r' || key === 'R') s.runner.restart();
        else if (key === ' ' || key === 'Spacebar' || key === 'Escape' || key === 'Enter') finish({ restore: true });
        else handled = false;
      } else if (key === ' ' || key === 'Spacebar') s.runner.toggle();
      else if (key === 'Escape') stop();
      else if (key === 'ArrowRight') s.runner.next();
      else if (key === 'ArrowLeft') s.runner.prev();
      else if (key === 'r' || key === 'R') s.runner.restart();
      else handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });
  if (win && typeof win.addEventListener === 'function') win.addEventListener('keydown', onKey, true);

  // ---- tool and launcher ----------------------------------------------------------------------
  if (typeof app.addTool === 'function') {
    try {
      tool = app.addTool({
        id: 'story-tour',
        label: 'Tour',
        title: 'A guided tour of the controls (Shift+T). Press again to stop.',
        group: 'extra',
        onClick: safe(() => (session ? stop() : start('tour'))),
      });
    } catch (err) {
      console.warn('[story] could not add the Tour tool', err);
    }
  }

  function renderLauncher(container) {
    const el = (tagName, cls, text) => {
      const node = doc.createElement(tagName);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const box = el('div', 'tbs-launch');
    box.append(el('p', 'tbs-launch__intro', 'Let the tool show itself. A story opens the views it talks about and puts everything back when you stop it.'));
    const list = el('ul', 'tbs-launch__list');
    for (const story of STORIES) {
      const item = el('li', 'tbs-launch__item');
      const name = el('div', 'tbs-launch__name', story.title);
      name.append(el('span', 'tbs-launch__time', formatLength(planTimeline(story).total)));
      const btns = el('div', 'tbs-launch__btns');
      const play = el('button', 'tbs-launch__btn', 'Play');
      play.type = 'button';
      play.setAttribute('aria-label', `Play: ${story.title}`);
      play.dataset.story = story.id;
      play.addEventListener('click', safe(() => start(story.id)));
      btns.append(play);
      if (story.kind === 'film') {
        const rec = el('button', 'tbs-launch__btn', 'Record');
        rec.type = 'button';
        rec.title = 'Recording mode: prepares every view, then waits for Space';
        rec.setAttribute('aria-label', `Play in recording mode: ${story.title}`);
        rec.dataset.story = story.id;
        rec.dataset.record = '1';
        rec.addEventListener('click', safe(() => start(story.id, { record: true })));
        btns.append(rec);
      }
      item.append(name, btns, el('div', 'tbs-launch__desc', story.description || ''));
      list.append(item);
    }
    box.append(list);
    box.append(el('p', 'tbs-launch__keys', 'Space pauses or continues, the arrow keys step, R restarts, Esc stops. A link can start a story: add ?story=tour to the address.'));
    container.append(box);
    return {
      dispose() {
        box.remove();
      },
    };
  }

  if (typeof app.addPanel === 'function') {
    try {
      panel = app.addPanel({ id: 'story', title: 'Tours', order: 90, render: renderLauncher });
    } catch (err) {
      console.warn('[story] could not add the Tours panel', err);
    }
  }

  // ---- start from the address -----------------------------------------------------------------
  let params = { story: '' };
  try {
    params = readStoryParams(win.location.search);
  } catch {
    params = { story: '' };
  }
  try {
    const preset = opts.autostart || (win && win.TOMBAUGH_STORY);
    if (!params.story && preset && preset.story) params = { record: false, guide: false, speed: 1, ...preset, story: String(preset.story).toLowerCase() };
  } catch {
    // no preset
  }
  if (params.story) autoTimer = win.setTimeout(safe(() => start(params.story, params)), 60);

  return {
    start,
    stop,
    isActive: () => !!session,
    /** The running story's sequencer, for tests and for the curious. */
    runner: () => (session ? session.runner : null),
    stories: STORIES,
    dispose() {
      if (autoTimer !== null) win.clearTimeout(autoTimer);
      if (session) finish({ restore: true });
      if (win && typeof win.removeEventListener === 'function') win.removeEventListener('keydown', onKey, true);
      adapter.dispose();
      for (const handle of [tool, panel]) {
        try {
          if (handle && typeof handle.remove === 'function') handle.remove();
        } catch {
          // the shell is gone
        }
      }
    },
  };
}
