// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The movie player: play / pause, step, speed, a timeline with one tick per frame grouped by
// survey pass, blink A/B between two chosen frames, and the frame caption.

import { h, clear } from './layout.js';
import { timelineGroups } from '../pipeline.js';

const ICON = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>',
  prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h2v11H3zM13 2.5v11L5.5 8z"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 2.5h2v11h-2zM3 2.5v11L10.5 8z"/></svg>',
};

const SPEEDS = [
  { value: 'auto', label: 'Auto speed' },
  { value: '1', label: '1 frame/s' },
  { value: '2', label: '2 frames/s' },
  { value: '4', label: '4 frames/s' },
  { value: '8', label: '8 frames/s' },
  { value: '16', label: '16 frames/s' },
];

/** Frames per second for a movie of n frames when the speed is 'auto'. */
export function autoFps(n) {
  if (n <= 6) return 1.5;
  if (n <= 24) return 4;
  return 8;
}

function iconButton(label, icon, onClick, extra = '') {
  const btn = h('button', { type: 'button', class: `btn btn-icon ${extra}`.trim(), 'aria-label': label, title: label, onclick: onClick });
  btn.innerHTML = icon;
  return btn;
}

/**
 * createPlayer(container, { onFrame(index, frame), onPlayState({ playing, blink }), onWrap() })
 *   -> { setMovie(frames, { index, autoplay }), setIndex(i), index(), play(), pause(), toggle(),
 *        step(delta), toggleBlink(), isPlaying(), isBlinking(), destroy() }
 */
export function createPlayer(container, { onFrame = () => {}, onPlayState = () => {}, onWrap = () => {} } = {}) {
  let frames = [];
  let groups = [];
  let index = 0;
  let playing = false;
  let blink = false;
  let blinkA = 0;
  let blinkB = 0;
  let speed = 'auto';
  let timer = null;
  let ticks = [];
  let groupEls = [];
  let dragging = false;

  // ---- DOM ------------------------------------------------------------------------------------
  const btnPrev = iconButton('Previous frame (left arrow)', ICON.prev, () => step(-1));
  const btnPlay = iconButton('Play (space)', ICON.play, () => toggle(), 'btn-play');
  btnPlay.setAttribute('aria-pressed', 'false');
  const btnNext = iconButton('Next frame (right arrow)', ICON.next, () => step(1));

  const speedSel = h('select', { class: 'select', 'aria-label': 'Playback speed', onchange: () => setSpeed(speedSel.value) });
  for (const s of SPEEDS) speedSel.append(h('option', { value: s.value }, s.label));

  const btnBlink = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      'aria-pressed': 'false',
      title: 'Alternate between frame A and frame B (b)',
      onclick: () => toggleBlink(),
    },
    'Blink',
  );
  const selA = h('select', { class: 'select', 'aria-label': 'Blink frame A', onchange: () => setBlinkPair(Number(selA.value), blinkB, 'a') });
  const selB = h('select', { class: 'select', 'aria-label': 'Blink frame B', onchange: () => setBlinkPair(blinkA, Number(selB.value), 'b') });
  const count = h('span', { class: 'player-count', 'aria-hidden': 'true' });

  const timeline = h('div', {
    class: 'timeline is-empty',
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Frame',
    'aria-valuemin': '1',
    'aria-valuemax': '1',
    'aria-valuenow': '1',
    'aria-orientation': 'horizontal',
  });

  const capTitle = h('span', { class: 'caption-title' });
  const capMeta = h('span', { class: 'caption-meta' });
  const capNote = h('span', { class: 'caption-note' });
  const caption = h('div', { class: 'caption', 'aria-live': 'off' }, capTitle, capMeta, capNote, count);
  const credit = h('div', { class: 'embed-credit' });

  clear(container);
  container.append(
    h(
      'div',
      { class: 'player-row' },
      h('div', { class: 'player-transport' }, btnPrev, btnPlay, btnNext),
      speedSel,
      h('div', { class: 'player-blink' }, btnBlink, h('span', { class: 'ab' }, 'A'), selA, h('span', { class: 'ab' }, 'B'), selB),
    ),
    timeline,
    caption,
    credit,
  );

  // ---- timeline -------------------------------------------------------------------------------
  function buildTimeline() {
    clear(timeline);
    ticks = [];
    groupEls = [];
    timeline.classList.toggle('is-empty', frames.length === 0);
    if (!frames.length) return;
    const wide = frames.length <= 12;
    for (const g of groups) {
      const size = g.end - g.start + 1;
      const label = h('div', { class: 'tl-label' }, g.label);
      label.title = g.label;
      const row = h('div', { class: 'tl-ticks' });
      for (let i = g.start; i <= g.end; i++) {
        const tick = h('div', { class: `tl-tick${wide ? ' is-wide' : ''}` });
        ticks.push(tick);
        row.append(tick);
      }
      const el = h('div', { class: 'tl-group' }, label, row);
      el.style.flex = `${size} 1 0`;
      groupEls.push(el);
      timeline.append(el);
    }
  }

  function indexFromEvent(e) {
    if (!ticks.length) return 0;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < ticks.length; i++) {
      const r = ticks[i].getBoundingClientRect();
      const d = Math.abs(e.clientX - (r.left + r.width / 2));
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  timeline.addEventListener('pointerdown', (e) => {
    if (frames.length < 2 || e.button > 0) return;
    dragging = true;
    try {
      timeline.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    pause();
    setBlink(false);
    setIndex(indexFromEvent(e), { user: true });
    e.preventDefault();
    timeline.focus({ preventScroll: true });
  });
  timeline.addEventListener('pointermove', (e) => {
    if (dragging) setIndex(indexFromEvent(e), { user: true });
  });
  const endDrag = () => {
    dragging = false;
  };
  timeline.addEventListener('pointerup', endDrag);
  timeline.addEventListener('pointercancel', endDrag);
  timeline.addEventListener('keydown', (e) => {
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = index - 1;
    else if (e.key === 'PageUp') next = index + 10;
    else if (e.key === 'PageDown') next = index - 10;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = frames.length - 1;
    if (next === null || !frames.length) return;
    e.preventDefault();
    e.stopPropagation();
    pause();
    setBlink(false);
    setIndex(Math.min(frames.length - 1, Math.max(0, next)), { user: true });
  });

  // ---- state ----------------------------------------------------------------------------------
  function fps() {
    if (speed === 'auto') return blink ? 1.5 : autoFps(frames.length);
    return Number(speed) || 2;
  }

  function schedule() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!playing || frames.length < 2) return;
    timer = setTimeout(tick, 1000 / fps());
  }

  function tick() {
    timer = null;
    if (!playing) return;
    if (typeof document !== 'undefined' && document.hidden) {
      schedule();
      return;
    }
    if (blink) {
      setIndex(index === blinkA ? blinkB : blinkA, { fromTimer: true });
    } else {
      const next = (index + 1) % frames.length;
      if (next === 0) onWrap();
      setIndex(next, { fromTimer: true });
    }
    schedule();
  }

  function refreshTransport() {
    const many = frames.length > 1;
    btnPlay.innerHTML = playing ? ICON.pause : ICON.play;
    btnPlay.setAttribute('aria-pressed', String(playing));
    const playLabel = !many ? 'Only one frame in this view, nothing to play' : playing ? 'Pause (space)' : 'Play (space)';
    btnPlay.setAttribute('aria-label', playLabel);
    btnPlay.title = playLabel;
    btnPlay.disabled = !many;
    btnPrev.disabled = !many;
    btnNext.disabled = !many;
    speedSel.disabled = !many;
    btnBlink.disabled = !many;
    btnBlink.title = many ? 'Alternate between frame A and frame B (b)' : 'Only one frame in this view, nothing to blink';
    btnBlink.setAttribute('aria-pressed', String(blink));
    selA.disabled = !many;
    selB.disabled = !many;
    timeline.setAttribute('aria-disabled', String(!many));
  }

  function refreshMarks() {
    for (let i = 0; i < ticks.length; i++) {
      const t = ticks[i];
      t.classList.toggle('is-live', i === index);
      t.classList.toggle('is-a', i === blinkA && frames.length > 1);
      t.classList.toggle('is-b', i === blinkB && frames.length > 1);
    }
    groups.forEach((g, k) => groupEls[k] && groupEls[k].classList.toggle('is-live', index >= g.start && index <= g.end));
  }

  function refreshCaption() {
    const f = frames[index];
    const n = frames.length;
    count.innerHTML = '';
    if (n) {
      count.append(h('b', null, String(index + 1).padStart(String(n).length, '0')), ` / ${n}`);
    }
    const c = f ? f.caption || {} : {};
    capTitle.textContent = c.title || '';
    capMeta.textContent = [c.date, c.wave].filter(Boolean).join('  ·  ');
    capNote.textContent = c.note || '';
    capNote.title = c.note || '';
    timeline.setAttribute('aria-valuemax', String(Math.max(1, n)));
    timeline.setAttribute('aria-valuenow', String(n ? index + 1 : 1));
    timeline.setAttribute('aria-valuetext', f ? `Frame ${index + 1} of ${n}: ${[c.title, c.date, c.wave].filter(Boolean).join(', ')}` : 'No frames');
  }

  function setIndex(i, { user = false, fromTimer = false, silent = false } = {}) {
    if (!frames.length) return;
    const next = Math.min(frames.length - 1, Math.max(0, i | 0));
    const changed = next !== index;
    index = next;
    refreshMarks();
    refreshCaption();
    if (!silent && (changed || user)) onFrame(index, frames[index], { user, fromTimer });
  }

  function emitState() {
    onPlayState({ playing, blink });
  }

  function play() {
    if (frames.length < 2 || playing) return;
    playing = true;
    refreshTransport();
    schedule();
    emitState();
  }

  function pause() {
    if (!playing) return;
    playing = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    refreshTransport();
    emitState();
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  function step(delta) {
    if (frames.length < 2) return;
    pause();
    setBlink(false);
    setIndex((index + delta + frames.length) % frames.length, { user: true });
  }

  function setSpeed(value) {
    speed = SPEEDS.some((s) => s.value === String(value)) ? String(value) : 'auto';
    speedSel.value = speed;
    schedule();
  }

  function setBlink(on) {
    const want = !!on && frames.length > 1;
    if (want === blink) return;
    blink = want;
    refreshTransport();
    if (blink) {
      if (blinkA === blinkB) blinkB = blinkA === frames.length - 1 ? 0 : frames.length - 1;
      syncSelects();
      refreshMarks();
      setIndex(blinkA, { user: true });
      if (!playing) play();
      else schedule();
    } else {
      schedule();
    }
    emitState();
  }

  function toggleBlink() {
    setBlink(!blink);
  }

  function setBlinkPair(a, b, moved = null) {
    const n = frames.length;
    if (!n) return;
    blinkA = Math.min(n - 1, Math.max(0, a | 0));
    blinkB = Math.min(n - 1, Math.max(0, b | 0));
    syncSelects();
    refreshMarks();
    if (moved) {
      // Show the frame that was just chosen, so the choice is visible.
      pause();
      setIndex(moved === 'a' ? blinkA : blinkB, { user: true });
      if (blink) play();
    }
  }

  function syncSelects() {
    selA.value = String(blinkA);
    selB.value = String(blinkB);
  }

  function fillSelect(sel) {
    clear(sel);
    frames.forEach((f, i) => sel.append(h('option', { value: String(i) }, f.short || (f.caption && f.caption.title) || `Frame ${i + 1}`)));
  }

  /**
   * Replace the movie. Keeps the current index when the frame count is unchanged or `index`
   * is given; `autoplay` starts playback when there is something to play.
   */
  function setMovie(nextFrames, { index: wantIndex = null, autoplay = false, keepBlinkPair = false } = {}) {
    const sameShape = nextFrames.length === frames.length;
    frames = nextFrames || [];
    groups = timelineGroups(frames);
    buildTimeline();
    fillSelect(selA);
    fillSelect(selB);
    if (!(keepBlinkPair && sameShape) || blinkA >= frames.length || blinkB >= frames.length) {
      blinkA = 0;
      blinkB = groups.length >= 2 ? groups[groups.length - 1].start : Math.max(0, frames.length - 1);
    }
    syncSelects();
    if (frames.length < 2) {
      playing = false;
      blink = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }
    let i = wantIndex !== null && Number.isFinite(wantIndex) ? wantIndex : sameShape ? index : Math.min(index, frames.length - 1);
    if (!sameShape && wantIndex === null && !playing) i = 0;
    index = Math.min(Math.max(0, frames.length - 1), Math.max(0, i | 0));
    refreshTransport();
    refreshMarks();
    refreshCaption();
    if (frames.length) onFrame(index, frames[index], { user: false, fromTimer: false, reset: true });
    if (autoplay && frames.length > 1 && !playing) play();
    else schedule();
    emitState();
  }

  function onVisibility() {
    if (!document.hidden && playing) schedule();
  }
  document.addEventListener('visibilitychange', onVisibility);

  refreshTransport();
  refreshCaption();
  setSpeed('auto');

  return {
    setMovie,
    setIndex: (i) => setIndex(i, { user: true }),
    index: () => index,
    frame: () => frames[index] || null,
    frameCount: () => frames.length,
    play,
    pause,
    toggle,
    step,
    setBlink,
    toggleBlink,
    setSpeed,
    isPlaying: () => playing,
    isBlinking: () => blink,
    setCredit(node) {
      clear(credit);
      if (node) credit.append(node);
    },
    destroy() {
      pause();
      document.removeEventListener('visibilitychange', onVisibility);
      clear(container);
    },
  };
}
