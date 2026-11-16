// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// runner.js - a deterministic step sequencer for guided stories. Pure: no DOM, no app, no real
// timers unless the default clock is used. Everything the runner does to the outside world goes
// through an adapter, and all timing goes through an injectable clock, so the whole thing can be
// driven by a fake clock under `node --test`.
//
// A story is data:
//   { id, title, description?, maxSeconds?, maxCaptionWords?, startOnKey?, preload?, steps: [...] }
// A step:
//   { id, at? (seconds from start) | after? (seconds after the previous step ended, default 0),
//     duration (seconds), caption?: { title, text, fallback?: { title, text }, card?: 'title' | 'end',
//     url?, lines? }, do?: [actions], waitFor?: condition, then?: [actions], spotlight?, key?: true }
//   `do` runs when the step starts. `waitFor` is evaluated when `do` has finished; `then` runs when
//   the condition holds. If it never holds, `then` is skipped (event 'skipped') and the caption
//   falls back to caption.fallback when there is one. `key: true` holds the story at the end of
//   the step until resume() / next() is called ("press Space to continue").
// A condition: 'frames' | 'loaded' | 'selection' or { cond, timeoutMs = 1500, settleMs = 0, hold = false }.
//   hold: true freezes the story clock while waiting (for tours); without it the clock keeps
//   running and the wait ends with the step at the latest (for a film that must keep its length).
// Actions (data; `wait` and `blink` are handled here, the rest by adapter.perform):
//   { type: 'goTo', target: 'barnard' | { ra, dec, name? }, state?: { ...URL-state keys } }
//   { type: 'set', state: { view, det, fov, gaia, flags, ch, lens, ... } }
//   { type: 'play' } { type: 'pause' }
//   { type: 'frame', index: number | 'next' | 'prev' | 'first' | 'last' }
//   { type: 'blink', times, periodMs, a = 'first', b = 'last' }     -> `times` frame flips
//   { type: 'select', where: 'target' | { ra, dec } }
//   { type: 'panel', id } { type: 'explain', topic | null } { type: 'zoom', level, at? }
//   { type: 'fog', close? } { type: 'url', show? } { type: 'wait', ms }
//
// Adapter (every member optional):
//   perform(action, ctx) -> false when the action could not be carried out (reported as 'skipped')
//   check(cond) -> boolean          resolve(name) -> text for a {name} placeholder in a caption
//   busy() -> true while something of the current step is still going (its line is being spoken):
//   the step is held, with the story clock frozen, until it ends. Not used with maxSeconds.
//
// Events (runner.on(type, fn)): 'preload' { done, total, label }, 'ready', 'start', 'step',
//   'caption' { caption | null }, 'spotlight' { spotlight | null }, 'action',
//   'waiting' { reason: 'condition' | 'key' | 'busy' },
//   'skipped' { reason: 'unsupported' | 'timeout' | 'error', ... }, 'pause', 'resume', 'seek',
//   'done' { storyMs, wallMs }, 'stop' { reason }.

export const ACTION_TYPES = Object.freeze(['goTo', 'set', 'play', 'pause', 'frame', 'blink', 'select', 'panel', 'explain', 'zoom', 'fog', 'url', 'wait']);
export const CONDITIONS = Object.freeze(['frames', 'loaded', 'selection']);
const FRAME_WORDS = ['next', 'prev', 'first', 'last'];
const EPS_MS = 0.01;
const DEFAULT_TIMEOUT_MS = 1500;
const BUSY_LIMIT_MS = 20000; // the longest a step is held for adapter.busy() (a spoken line)

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const ms = (seconds) => Math.round(seconds * 1000);

/** Number of words in a caption string (placeholders count as one word each). */
export function countWords(text) {
  const t = String(text ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Problems with one action, as a list of messages (empty when it is well formed). */
export function validateAction(action) {
  if (!isObj(action) || typeof action.type !== 'string') return ['an action must be an object with a type'];
  const a = action;
  switch (a.type) {
    case 'goTo':
      if (typeof a.target === 'string' && a.target) break;
      if (isObj(a.target) && isNum(a.target.ra) && isNum(a.target.dec)) break;
      return ['goTo needs target: an id or { ra, dec }'];
    case 'set':
      if (!isObj(a.state)) return ['set needs state: { ... }'];
      break;
    case 'play':
    case 'pause':
    case 'fog':
    case 'url':
      break;
    case 'frame':
      if (!(Number.isInteger(a.index) && a.index >= 0) && !FRAME_WORDS.includes(a.index)) return ["frame needs index: a number, 'next', 'prev', 'first' or 'last'"];
      break;
    case 'blink':
      if (!(Number.isInteger(a.times) && a.times >= 1)) return ['blink needs times: a whole number of flips'];
      if (!(isNum(a.periodMs) && a.periodMs > 0)) return ['blink needs periodMs > 0'];
      break;
    case 'select':
      if (a.where !== 'target' && !(isObj(a.where) && isNum(a.where.ra) && isNum(a.where.dec))) return ["select needs where: 'target' or { ra, dec }"];
      break;
    case 'panel':
      if (typeof a.id !== 'string' || !a.id) return ['panel needs id'];
      break;
    case 'explain':
      if (a.topic !== null && (typeof a.topic !== 'string' || !a.topic)) return ['explain needs topic (or null to close)'];
      break;
    case 'zoom':
      if (!(isNum(a.level) && a.level > 0)) return ['zoom needs level > 0'];
      break;
    case 'wait':
      if (!(isNum(a.ms) && a.ms >= 0)) return ['wait needs ms >= 0'];
      break;
    default:
      return [`unknown action type "${a.type}"`];
  }
  return [];
}

/** A condition in its full form, or null when it is not one. */
export function normalizeCondition(c) {
  if (typeof c === 'string') c = { cond: c };
  if (!isObj(c) || !CONDITIONS.includes(c.cond)) return null;
  return {
    cond: c.cond,
    timeoutMs: isNum(c.timeoutMs) && c.timeoutMs >= 0 ? c.timeoutMs : DEFAULT_TIMEOUT_MS,
    settleMs: isNum(c.settleMs) && c.settleMs > 0 ? c.settleMs : 0,
    hold: c.hold === true,
  };
}

/**
 * Lay a list of actions out in time. `wait` and `blink` take time, everything else is instant.
 * A blink becomes `times` frame actions, alternating a, b, a, ... one period apart.
 * @returns {{ items: Array<{ offsetMs: number, action: object }>, durationMs: number, errors: string[] }}
 */
export function sequenceActions(actions) {
  const items = [];
  const errors = [];
  let offset = 0;
  for (const action of Array.isArray(actions) ? actions : []) {
    const problems = validateAction(action);
    if (problems.length) {
      errors.push(...problems);
      continue;
    }
    if (action.type === 'wait') {
      offset += action.ms;
    } else if (action.type === 'blink') {
      const a = action.a ?? 'first';
      const b = action.b ?? 'last';
      for (let k = 0; k < action.times; k++) {
        items.push({ offsetMs: offset + k * action.periodMs, action: { type: 'frame', index: k % 2 === 0 ? a : b, blink: true } });
      }
      offset += action.times * action.periodMs;
    } else {
      items.push({ offsetMs: offset, action });
    }
  }
  return { items, durationMs: offset, errors };
}

/**
 * The absolute schedule of a story, validated.
 * @returns {{ id: string, title: string, ok: boolean, errors: string[], warnings: string[], total: number,
 *   totalMs: number, maxSeconds: number|null, steps: Array<object>, preload: object|null, story: object }}
 *   Each step: { index, id, start, end, duration (seconds), startMs, endMs, caption, spotlight, key,
 *   do: { items, durationMs }, then: { items, durationMs } | null, waitFor: condition | null }.
 */
export function planTimeline(story) {
  const errors = [];
  const warnings = [];
  const out = { id: '', title: '', ok: false, errors, warnings, total: 0, totalMs: 0, maxSeconds: null, steps: [], preload: null, story };
  if (!isObj(story) || !Array.isArray(story.steps)) {
    errors.push('a story needs steps: [...]');
    return out;
  }
  out.id = String(story.id ?? '');
  out.title = String(story.title ?? out.id);
  if (!out.id) errors.push('a story needs an id');
  if (!story.steps.length) errors.push('a story needs at least one step');
  const maxSeconds = isNum(story.maxSeconds) && story.maxSeconds > 0 ? story.maxSeconds : null;
  out.maxSeconds = maxSeconds;
  const maxWords = isNum(story.maxCaptionWords) ? story.maxCaptionWords : null;

  const seen = new Set();
  let cursor = 0;
  story.steps.forEach((step, index) => {
    const id = isObj(step) && step.id ? String(step.id) : `step-${index + 1}`;
    const where = `step "${id}"`;
    if (!isObj(step)) {
      errors.push(`${where}: not an object`);
      return;
    }
    if (seen.has(id)) errors.push(`${where}: duplicate id`);
    seen.add(id);

    let startMs = cursor;
    if (isNum(step.at)) startMs = ms(step.at);
    else if (isNum(step.after) && step.after >= 0) startMs = cursor + ms(step.after);
    else if (step.at !== undefined || step.after !== undefined) errors.push(`${where}: at / after must be seconds`);
    if (startMs < cursor - EPS_MS) {
      errors.push(`${where}: starts at ${startMs / 1000} s, before the previous step ends (${cursor / 1000} s)`);
      startMs = cursor;
    }
    let durationMs = 0;
    if (isNum(step.duration) && step.duration > 0) durationMs = ms(step.duration);
    else errors.push(`${where}: duration must be a positive number of seconds`);

    const seqDo = sequenceActions(step.do);
    const seqThen = step.then ? sequenceActions(step.then) : null;
    for (const e of seqDo.errors) errors.push(`${where}: ${e}`);
    if (seqThen) for (const e of seqThen.errors) errors.push(`${where}: ${e}`);

    let waitFor = null;
    if (step.waitFor !== undefined && step.waitFor !== null) {
      waitFor = normalizeCondition(step.waitFor);
      if (!waitFor) errors.push(`${where}: unknown condition`);
    }
    if (seqDo.durationMs > durationMs) warnings.push(`${where}: its actions take ${seqDo.durationMs} ms, longer than the step (${durationMs} ms); the rest is cut`);
    else if (seqThen && seqDo.durationMs + seqThen.durationMs > durationMs) warnings.push(`${where}: "do" and "then" together take longer than the step; the rest is cut`);

    const key = step.key === true;
    if (maxSeconds !== null) {
      if (key) errors.push(`${where}: a story with maxSeconds cannot wait for a key`);
      if (waitFor && waitFor.hold) errors.push(`${where}: a story with maxSeconds cannot hold the clock on a condition`);
    }

    let caption = null;
    if (step.caption !== undefined && step.caption !== null) {
      if (!isObj(step.caption)) errors.push(`${where}: caption must be an object`);
      else {
        caption = step.caption;
        if (maxWords !== null && !caption.card) {
          const n = countWords(caption.text);
          if (n > maxWords) warnings.push(`${where}: caption has ${n} words (limit ${maxWords})`);
        }
        if (/\{\w+\}/.test(`${caption.title ?? ''} ${caption.text ?? ''}`) && !caption.fallback) warnings.push(`${where}: caption has a placeholder but no fallback`);
      }
    }

    out.steps.push({
      index,
      id,
      startMs,
      endMs: startMs + durationMs,
      start: startMs / 1000,
      end: (startMs + durationMs) / 1000,
      duration: durationMs / 1000,
      caption,
      spotlight: isObj(step.spotlight) ? step.spotlight : null,
      key,
      do: { items: seqDo.items, durationMs: seqDo.durationMs },
      then: seqThen ? { items: seqThen.items, durationMs: seqThen.durationMs } : null,
      waitFor,
    });
    cursor = startMs + durationMs;
  });

  out.totalMs = cursor;
  out.total = cursor / 1000;
  if (maxSeconds !== null && out.totalMs > ms(maxSeconds) + EPS_MS) errors.push(`the story runs ${out.total} s, longer than its limit of ${maxSeconds} s`);

  if (story.preload !== undefined && story.preload !== null) {
    const p = story.preload;
    if (!isObj(p) || !Array.isArray(p.items)) errors.push('preload needs items: [...]');
    else {
      const items = [];
      p.items.forEach((item, i) => {
        const where = `preload item ${i + 1}`;
        if (!isObj(item)) {
          errors.push(`${where}: not an object`);
          return;
        }
        const seq = sequenceActions(item.do);
        for (const e of seq.errors) errors.push(`${where}: ${e}`);
        let waitFor = null;
        if (item.waitFor !== undefined && item.waitFor !== null) {
          waitFor = normalizeCondition(item.waitFor);
          if (!waitFor) errors.push(`${where}: unknown condition`);
        }
        items.push({ index: i, label: String(item.label ?? ''), do: { items: seq.items, durationMs: seq.durationMs }, waitFor });
      });
      out.preload = { label: String(p.label ?? 'Preparing'), ready: String(p.ready ?? 'Ready'), items };
    }
  }

  out.ok = errors.length === 0;
  return out;
}

/**
 * Fill {name} placeholders in a caption. A caption whose title or text has a placeholder that
 * cannot be filled is replaced by its fallback; a line (or the url) that cannot be filled is dropped.
 * @param {object|null} caption
 * @param {(name: string) => (string|null|undefined)} [resolve]
 * @param {{ forceFallback?: boolean }} [opts]
 */
export function resolveCaption(caption, resolve, opts = {}) {
  if (!isObj(caption)) return null;
  const fill = (text) => {
    let missing = false;
    const s = String(text ?? '').replace(/\{(\w+)\}/g, (m, name) => {
      let v = null;
      try {
        v = resolve ? resolve(name) : null;
      } catch {
        v = null;
      }
      if (v === null || v === undefined || v === '') {
        missing = true;
        return '';
      }
      return String(v);
    });
    return { s, missing };
  };
  const title = fill(caption.title);
  const text = fill(caption.text);
  const out = { ...caption, title: title.s, text: text.s, usedFallback: false };
  delete out.fallback;
  if ((title.missing || text.missing || opts.forceFallback) && isObj(caption.fallback)) {
    const fb = caption.fallback;
    out.title = fill(fb.title ?? caption.title).s;
    out.text = fill(fb.text ?? '').s;
    out.usedFallback = true;
  } else if (title.missing || text.missing) {
    out.title = out.title.replace(/\s{2,}/g, ' ').trim();
    out.text = out.text.replace(/\s{2,}/g, ' ').trim();
  }
  if (caption.url !== undefined) {
    const u = fill(caption.url);
    out.url = u.missing ? '' : u.s;
  }
  if (Array.isArray(caption.lines)) {
    out.lines = caption.lines.map(fill).filter((l) => !l.missing && l.s).map((l) => l.s);
  }
  return out;
}

/**
 * The state a viewer would be in just before step `index`, collapsed to at most a few actions:
 * the last goTo with every later `set` merged into it (or one `set`), and closing actions for a
 * sky map or explainer that an earlier step left open. Used when seeking.
 */
export function stateBefore(plan, index) {
  let goTo = null;
  let merged = {};
  let fogOpen = false;
  let explainOpen = false;
  let panel = null;
  const steps = plan && Array.isArray(plan.steps) ? plan.steps : [];
  for (let i = 0; i < Math.min(index, steps.length); i++) {
    const lists = [steps[i].do, steps[i].then].filter(Boolean);
    for (const seq of lists) {
      for (const { action } of seq.items) {
        if (action.type === 'goTo') {
          goTo = action;
          if (isObj(action.state)) merged = { ...merged, ...action.state };
        } else if (action.type === 'set') merged = { ...merged, ...action.state };
        else if (action.type === 'fog') fogOpen = action.close !== true;
        else if (action.type === 'explain') explainOpen = action.topic !== null;
        else if (action.type === 'panel') panel = action.id;
      }
    }
  }
  const out = [];
  if (fogOpen) out.push({ type: 'fog', close: true });
  if (explainOpen) out.push({ type: 'explain', topic: null });
  if (goTo) out.push({ type: 'goTo', target: goTo.target, state: merged });
  else if (Object.keys(merged).length) out.push({ type: 'set', state: merged });
  if (panel) out.push({ type: 'panel', id: panel });
  return out;
}

/** The real clock: performance.now when there is one, and the host's timers. */
export function systemClock() {
  const perf = globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance : null;
  return {
    now: () => (perf ? perf.now() : Date.now()),
    setTimeout: (fn, delay) => globalThis.setTimeout(fn, delay),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/** A clock for tests: time only moves when advance(ms) is called; timers fire in time order. */
export function createFakeClock(start = 0) {
  let now = start;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, delay) {
      const id = ++nextId;
      timers.set(id, { id, at: now + Math.max(0, Number(delay) || 0), fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(delta) {
      const target = now + delta;
      for (;;) {
        let next = null;
        for (const t of timers.values()) {
          if (t.at <= target + 1e-9 && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
        }
        if (!next) break;
        timers.delete(next.id);
        if (next.at > now) now = next.at;
        next.fn();
      }
      now = target;
    },
    pending: () => timers.size,
  };
}

/**
 * createRunner({ story, adapter, clock, speed, pollMs }) -> runner
 * Throws when the story does not validate (see planTimeline).
 */
export function createRunner({ story, adapter = {}, clock = systemClock(), speed = 1, pollMs = 50 } = {}) {
  const plan = planTimeline(story);
  if (!plan.ok) throw new Error(`Story "${plan.id || '?'}" is not valid: ${plan.errors.join('; ')}`);

  const listeners = new Map();
  let state = 'idle'; //       idle | preparing | ready | running | paused | waiting | done | stopped
  let rate = isNum(speed) && speed > 0 ? speed : 1;
  let storyMs = 0; //          story time when the clock was last frozen or rebased
  let wallBase = 0; //         clock.now() at that moment
  let ticking = false; //      is story time advancing?
  let queue = []; //           { t (story ms), seq, fn }
  let seq = 0;
  let timer = null;
  let index = -1;
  let wait = null; //          the one active wait: condition, key or preload
  let wallTimers = new Set(); // plain wall-clock timers used while preparing
  let startedWall = 0;
  let lastCaptionKey = '';
  let forceFallback = false;
  let prepareResolve = null;

  function emit(type, payload = {}) {
    const set = listeners.get(type);
    const all = listeners.get('*');
    for (const group of [set, all]) {
      if (!group) continue;
      for (const fn of [...group]) {
        try {
          fn({ type, ...payload });
        } catch (err) {
          if (typeof console !== 'undefined') console.error('[story] listener failed', err);
        }
      }
    }
  }

  const storyNow = () => (ticking ? storyMs + (clock.now() - wallBase) * rate : storyMs);

  function freeze() {
    storyMs = storyNow();
    ticking = false;
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }

  function thaw() {
    wallBase = clock.now();
    ticking = true;
    arm();
  }

  function arm() {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    if (!ticking || !queue.length) return;
    let next = queue[0];
    for (const q of queue) if (q.t < next.t || (q.t === next.t && q.seq < next.seq)) next = q;
    timer = clock.setTimeout(fire, Math.max(0, (next.t - storyNow()) / rate));
  }

  function fire() {
    timer = null;
    for (let guard = 0; guard < 10000 && ticking; guard++) {
      const now = storyNow() + EPS_MS;
      let due = null;
      for (const q of queue) if (q.t <= now && (!due || q.t < due.t || (q.t === due.t && q.seq < due.seq))) due = q;
      if (!due) break;
      queue.splice(queue.indexOf(due), 1);
      try {
        due.fn();
      } catch (err) {
        if (typeof console !== 'undefined') console.error('[story] step failed', err);
      }
    }
    arm();
  }

  /** Queue fn at story time t. `owner` is a step index (cut when that step ends) or 'flow'. */
  function schedule(t, fn, owner = 'flow') {
    queue.push({ t, seq: seq++, fn, owner });
    if (ticking) arm();
  }

  function clearAll() {
    queue = [];
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    dropWait();
    for (const id of wallTimers) clock.clearTimeout(id);
    wallTimers = new Set();
  }

  function wallTimeout(fn, delay) {
    const id = clock.setTimeout(() => {
      wallTimers.delete(id);
      fn();
    }, delay);
    wallTimers.add(id);
    return id;
  }

  // ---- actions --------------------------------------------------------------------------------
  function perform(action, ctx) {
    emit('action', { action, index, ...ctx });
    let ok;
    try {
      ok = typeof adapter.perform === 'function' ? adapter.perform(action, { index, step: plan.steps[index] || null, ...ctx }) : false;
    } catch (error) {
      emit('skipped', { reason: 'error', action, index, error });
      return;
    }
    if (ok === false) emit('skipped', { reason: 'unsupported', action, index });
  }

  /** Run a laid-out action list starting at story time `base`; call `done` when it has finished. */
  function runSequence(sequence, base, owner, done) {
    for (const item of sequence.items) {
      if (item.offsetMs <= 0) perform(item.action);
      else schedule(base + item.offsetMs, () => perform(item.action), owner);
    }
    if (!done) return;
    if (sequence.durationMs <= 0) done();
    else schedule(base + sequence.durationMs, done, owner);
  }

  // ---- waits ----------------------------------------------------------------------------------
  function check(cond) {
    try {
      return typeof adapter.check === 'function' ? adapter.check(cond) === true : false;
    } catch {
      return false;
    }
  }

  function dropWait() {
    if (wait && wait.poll !== null && wait.poll !== undefined) clock.clearTimeout(wait.poll);
    wait = null;
  }

  /** Wait for a condition on the wall clock. onDone(true) when it holds, onDone(false) on timeout. */
  function beginWait(cond, owner, onDone) {
    dropWait();
    const w = { kind: 'cond', owner, cond, onDone, elapsed: 0, last: clock.now(), trueSince: null, poll: null };
    wait = w;
    if (evaluate(w)) return;
    if (cond.hold) {
      freeze();
      state = 'waiting';
    }
    emit('waiting', { reason: 'condition', cond: cond.cond, index, hold: cond.hold });
    w.poll = clock.setTimeout(() => pollWait(w), pollMs);
  }

  /** One look at the condition. Returns true when the wait has ended (either way). */
  function evaluate(w) {
    const now = clock.now();
    w.elapsed += now - w.last;
    w.last = now;
    if (check(w.cond.cond)) {
      if (w.trueSince === null) w.trueSince = w.elapsed;
      if (w.elapsed - w.trueSince >= w.cond.settleMs - EPS_MS) {
        endWait(w, true);
        return true;
      }
    } else {
      w.trueSince = null;
    }
    if (w.elapsed >= w.cond.timeoutMs - EPS_MS) {
      endWait(w, false);
      return true;
    }
    return false;
  }

  function pollWait(w) {
    if (wait !== w) return;
    w.poll = null;
    if (!evaluate(w)) w.poll = clock.setTimeout(() => pollWait(w), pollMs);
  }

  function endWait(w, ok) {
    if (wait !== w) return;
    if (w.poll !== null) clock.clearTimeout(w.poll);
    wait = null;
    if (w.cond.hold && state === 'waiting') {
      state = 'running';
      thaw();
    }
    w.onDone(ok);
  }

  // ---- captions -------------------------------------------------------------------------------
  function emitCaption(force) {
    const step = plan.steps[index];
    const caption = step && step.caption ? resolveCaption(step.caption, adapter.resolve ? (n) => adapter.resolve(n) : null, { forceFallback }) : null;
    const key = JSON.stringify(caption);
    if (!force && key === lastCaptionKey) return;
    lastCaptionKey = key;
    emit('caption', { caption, index, id: step ? step.id : null, total: plan.steps.length });
  }

  // ---- steps ----------------------------------------------------------------------------------
  function enterStep(i) {
    index = i;
    const step = plan.steps[i];
    forceFallback = false;
    emit('step', { index: i, id: step.id, step, total: plan.steps.length });
    emitCaption(true);
    emit('spotlight', { spotlight: step.spotlight, index: i });
    schedule(step.endMs, () => exitStep(i));
    runSequence(step.do, step.startMs, i, () => afterDo(i));
  }

  function afterDo(i) {
    if (index !== i) return;
    const step = plan.steps[i];
    const runThen = () => {
      if (step.then) runSequence(step.then, storyNow(), i, null);
    };
    if (!step.waitFor) {
      runThen();
      emitCaption(false);
      return;
    }
    beginWait(step.waitFor, i, (ok) => {
      if (index !== i) return;
      if (ok) runThen();
      else {
        forceFallback = true;
        emit('skipped', { reason: 'timeout', cond: step.waitFor.cond, index: i, id: step.id });
      }
      emitCaption(false);
    });
  }

  function exitStep(i) {
    if (index !== i) return;
    const step = plan.steps[i];
    if (wait && wait.kind === 'cond' && wait.owner === i) {
      // The step is over and its condition never held: give up on it without stretching the story.
      const w = wait;
      dropWait();
      w.onDone(false);
    }
    // Anything of this step still queued (late blink flips) is cut here.
    queue = queue.filter((q) => q.owner !== i);
    if (step.key) {
      freeze();
      state = 'waiting';
      wait = { kind: 'key', owner: i, poll: null };
      emit('waiting', { reason: 'key', index: i });
      return;
    }
    if (plan.maxSeconds === null && typeof adapter.busy === 'function' && isBusy()) {
      // Something of this step is still going (its line is being spoken): hold the story clock
      // until it ends, so no step and no ending ever talks over it or cuts it short.
      freeze();
      state = 'waiting';
      const w = { kind: 'busy', owner: i, poll: null, elapsed: 0, last: clock.now() };
      wait = w;
      emit('waiting', { reason: 'busy', index: i });
      const look = () => {
        if (wait !== w) return;
        w.poll = null;
        const now = clock.now();
        w.elapsed += now - w.last;
        w.last = now;
        if (w.elapsed >= BUSY_LIMIT_MS - EPS_MS || !isBusy()) endBusy(w);
        else w.poll = clock.setTimeout(look, pollMs);
      };
      w.poll = clock.setTimeout(look, pollMs);
      return;
    }
    advance(i);
  }

  function isBusy() {
    try {
      return adapter.busy() === true;
    } catch {
      return false;
    }
  }

  function endBusy(w) {
    if (wait !== w) return;
    if (w.poll !== null) clock.clearTimeout(w.poll);
    wait = null;
    state = 'running';
    thaw();
    advance(w.owner);
  }

  function advance(i) {
    const next = plan.steps[i + 1];
    if (!next) {
      finish();
      return;
    }
    if (next.startMs <= storyNow() + EPS_MS) enterStep(i + 1);
    else {
      lastCaptionKey = 'null';
      emit('caption', { caption: null, index: i, id: null, total: plan.steps.length });
      emit('spotlight', { spotlight: null, index: i });
      schedule(next.startMs, () => enterStep(i + 1));
    }
  }

  function finish() {
    freeze();
    clearAll();
    state = 'done';
    emit('done', { storyMs: plan.totalMs, wallMs: clock.now() - startedWall });
  }

  // ---- preload --------------------------------------------------------------------------------
  function prepare() {
    if (state !== 'idle') return Promise.resolve();
    const promise = new Promise((resolve) => {
      prepareResolve = resolve;
    });
    const items = plan.preload ? plan.preload.items : [];
    const total = items.length;
    const ready = () => {
      state = 'ready';
      emit('ready', { preloaded: total });
      if (prepareResolve) prepareResolve();
      prepareResolve = null;
    };
    if (!total) {
      ready();
      return promise;
    }
    state = 'preparing';
    const runItem = (k) => {
      if (state !== 'preparing') return;
      emit('preload', { done: k, total, label: k < total ? items[k].label : '' });
      if (k >= total) {
        ready();
        return;
      }
      const item = items[k];
      const after = () => {
        if (state !== 'preparing') return;
        if (!item.waitFor) {
          runItem(k + 1);
          return;
        }
        beginWait({ ...item.waitFor, hold: false }, `preload-${k}`, (ok) => {
          if (!ok) emit('skipped', { reason: 'timeout', cond: item.waitFor.cond, preload: k, label: item.label });
          runItem(k + 1);
        });
      };
      for (const it of item.do.items) {
        if (it.offsetMs <= 0) perform(it.action, { preload: k });
        else wallTimeout(() => perform(it.action, { preload: k }), it.offsetMs);
      }
      if (item.do.durationMs <= 0) after();
      else wallTimeout(after, item.do.durationMs);
    };
    runItem(0);
    return promise;
  }

  // ---- transport ------------------------------------------------------------------------------
  function start() {
    if (state === 'preparing') return false;
    if (state === 'running' || state === 'paused' || state === 'waiting') return false;
    clearAll();
    state = 'running';
    storyMs = 0;
    index = -1;
    lastCaptionKey = '';
    startedWall = clock.now();
    thaw();
    emit('start', { total: plan.total, steps: plan.steps.length });
    const first = plan.steps[0];
    if (first.startMs <= 0) enterStep(0);
    else schedule(first.startMs, () => enterStep(0));
    return true;
  }

  function pause() {
    if (state !== 'running') return false;
    freeze();
    if (wait && wait.kind === 'cond') {
      // Stop the wait's stopwatch too.
      const now = clock.now();
      wait.elapsed += now - wait.last;
      if (wait.poll !== null) clock.clearTimeout(wait.poll);
      wait.poll = null;
    }
    state = 'paused';
    emit('pause', { index });
    return true;
  }

  function resume() {
    if (state === 'waiting' && wait && wait.kind === 'key') {
      const i = wait.owner;
      wait = null;
      state = 'running';
      thaw();
      emit('resume', { index, key: true });
      advance(i);
      return true;
    }
    if (state === 'waiting' && wait && wait.kind === 'busy') {
      // Space while the story is held for a spoken line: move on now.
      endBusy(wait);
      return true;
    }
    if (state === 'waiting' && wait && wait.kind === 'cond') {
      // Space while the story is held on a condition: stop waiting and move on.
      const w = wait;
      w.elapsed = w.cond.timeoutMs;
      w.last = clock.now();
      evaluate(w);
      return true;
    }
    if (state !== 'paused') return false;
    state = 'running';
    if (wait && wait.kind === 'cond') {
      const w = wait;
      w.last = clock.now();
      w.poll = clock.setTimeout(() => pollWait(w), pollMs);
    }
    thaw();
    emit('resume', { index });
    return true;
  }

  function toggle() {
    if (state === 'ready' || state === 'idle') return start();
    if (state === 'running') return pause();
    return resume();
  }

  function stop(reason = 'stop') {
    if (state === 'stopped') return false;
    freeze();
    clearAll();
    state = 'stopped';
    if (prepareResolve) prepareResolve();
    prepareResolve = null;
    emit('stop', { reason, index });
    return true;
  }

  function seek(target) {
    if (state !== 'running' && state !== 'paused' && state !== 'waiting') return false;
    let i = typeof target === 'string' ? plan.steps.findIndex((s) => s.id === target) : target;
    if (!Number.isInteger(i)) return false;
    i = Math.max(0, Math.min(plan.steps.length - 1, i));
    freeze();
    clearAll();
    storyMs = plan.steps[i].startMs;
    state = 'running';
    emit('seek', { index: i, id: plan.steps[i].id });
    index = i;
    for (const action of stateBefore(plan, i)) perform(action, { replay: true });
    thaw();
    enterStep(i);
    return true;
  }

  function next() {
    if (state === 'waiting' && wait && wait.kind === 'key') return resume();
    if (state !== 'running' && state !== 'paused' && state !== 'waiting') return false;
    if (index >= plan.steps.length - 1) {
      finish();
      return true;
    }
    return seek(index + 1);
  }

  function prev() {
    if (state !== 'running' && state !== 'paused' && state !== 'waiting') return false;
    const step = plan.steps[Math.max(0, index)];
    const into = storyNow() - step.startMs;
    return seek(into > 1500 || index <= 0 ? Math.max(0, index) : index - 1);
  }

  function restart() {
    if (state === 'preparing') return false;
    freeze();
    clearAll();
    state = 'ready';
    emit('restart', {});
    return start();
  }

  return {
    plan,
    on(type, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },
    prepare,
    start,
    pause,
    resume,
    toggle,
    stop,
    seek,
    next,
    prev,
    restart,
    setSpeed(f) {
      if (!isNum(f) || f <= 0) return;
      if (ticking) {
        storyMs = storyNow();
        wallBase = clock.now();
      }
      rate = f;
      arm();
    },
    speed: () => rate,
    state: () => state,
    /** Story time in seconds. */
    time: () => storyNow() / 1000,
    index: () => index,
    step: () => plan.steps[index] || null,
    /** Look at a pending condition now instead of at the next poll (call it from app events). */
    poke() {
      if (wait && wait.kind === 'cond' && state !== 'paused') {
        const w = wait;
        if (w.poll !== null) clock.clearTimeout(w.poll);
        w.poll = null;
        if (!evaluate(w)) w.poll = clock.setTimeout(() => pollWait(w), pollMs);
      }
    },
    /** Re-resolve the current caption (its placeholders may have values now). */
    refreshCaption() {
      if (state === 'running' || state === 'paused' || state === 'waiting') emitCaption(false);
    },
  };
}
