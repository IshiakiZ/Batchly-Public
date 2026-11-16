// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Interface sounds: a quiet click for every press, a pair of tones for a switch, a whoosh when a
// list opens or the page moves, a tick each time the photos flip, a sparkle when photos arrive.
//
// Where the sounds come from. A build can hand over recorded clips in window.TOMBAUGH_SOUNDS
// ({ name: 'data:audio/...;base64,...' }, see tools/build.mjs --sounds). The team's live page does
// that with short excerpts of sound effects it licensed from Ocular Sounds; those files are not
// open source and are not in this repository. Every clip that is not handed over is generated
// here from sine waves and filtered noise, so the page sounds much the same without them.
//
// Nothing plays before the first press or key (browsers do not allow it), nothing plays while the
// page is hidden, and the Sound button turns everything off and remembers that.

/** The clips a cue can use. */
export const CLIPS = ['tock', 'tick', 'pip', 'beep', 'whoosh', 'rush', 'fly', 'arrive'];

/**
 * What each cue plays: one or more clips, each with a gain, a playback rate and a start offset in
 * seconds. Gains are small on purpose: these sit under the page, not on top of it.
 */
export const CUES = {
  tap: [{ clip: 'tock', gain: 0.42 }],
  press: [{ clip: 'tock', gain: 0.55, rate: 0.82 }],
  tab: [{ clip: 'tock', gain: 0.4, rate: 1.18 }],
  play: [{ clip: 'tock', gain: 0.5, rate: 1.1 }, { clip: 'pip', gain: 0.1, rate: 0.5, at: 0.03 }],
  pause: [{ clip: 'tock', gain: 0.5, rate: 0.8 }],
  on: [{ clip: 'pip', gain: 0.15, rate: 0.5 }, { clip: 'pip', gain: 0.15, rate: 0.667, at: 0.075 }],
  off: [{ clip: 'pip', gain: 0.15, rate: 0.667 }, { clip: 'pip', gain: 0.13, rate: 0.5, at: 0.075 }],
  pick: [{ clip: 'tock', gain: 0.3 }, { clip: 'beep', gain: 0.13, rate: 0.5, at: 0.01 }],
  open: [{ clip: 'whoosh', gain: 0.4, rate: 1.5 }],
  close: [{ clip: 'whoosh', gain: 0.3, rate: 1.15 }],
  go: [{ clip: 'rush', gain: 0.5 }],
  fly: [{ clip: 'fly', gain: 0.5 }],
  arrive: [{ clip: 'arrive', gain: 0.45 }],
  flip: [{ clip: 'tick', gain: 0.09 }],
  step: [{ clip: 'tick', gain: 0.3 }],
  slide: [{ clip: 'tick', gain: 0.16 }],
  notice: [{ clip: 'beep', gain: 0.14, rate: 0.5 }],
  alert: [{ clip: 'beep', gain: 0.16, rate: 0.4 }, { clip: 'beep', gain: 0.16, rate: 0.333, at: 0.16 }],
  type: [{ clip: 'tick', gain: 0.12, rate: 1.3 }],
  hover: [{ clip: 'tick', gain: 0.05, rate: 1.7 }],
  zoom: [{ clip: 'tick', gain: 0.14 }],
  focus: [{ clip: 'pip', gain: 0.07, rate: 0.75 }],
  copy: [{ clip: 'tock', gain: 0.4 }, { clip: 'pip', gain: 0.13, rate: 0.667, at: 0.05 }, { clip: 'pip', gain: 0.13, rate: 1, at: 0.13 }],
  key: [{ clip: 'tock', gain: 0.3, rate: 1.3 }],
};

/** Cues that repeat quickly, and the shortest gap between two of them in milliseconds. */
const GAPS = { flip: 70, step: 40, slide: 45, tap: 25, notice: 400, alert: 400, arrive: 1500, go: 300, fly: 300, type: 35, hover: 70, zoom: 80, focus: 300, copy: 300, close: 250, key: 60 };

const STORE_KEY = 'tombaugh.sound';

// ---- generated clips ---------------------------------------------------------------------------

/** A small repeatable noise source, so the generated clips are the same on every visit. */
function noiseSource(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** A tone that dies away: frequency in Hz, length and decay in seconds. */
function ping(out, sr, freq, len, decay, gain, start = 0) {
  const n = Math.min(out.length, Math.round((start + len) * sr));
  for (let i = Math.round(start * sr), k = 0; i < n; i++, k++) {
    const t = k / sr;
    const attack = Math.min(1, t / 0.003);
    const tail = Math.min(1, (len - t) / 0.01);
    out[i] += Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / decay) * attack * tail * gain;
  }
}

/** Noise through a moving low-pass filter under a bell-shaped loudness curve. */
function gust(out, sr, { seed, peakAt, lowHz, highHz, gain }) {
  const rnd = noiseSource(seed);
  const n = out.length;
  let y = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const bell = Math.exp(-(((u - peakAt) / 0.2) ** 2));
    const cut = lowHz + (highHz - lowHz) * bell;
    const k = 1 - Math.exp((-2 * Math.PI * cut) / sr);
    y += (rnd() - y) * k;
    y2 += (y - y2) * k;
    const edge = Math.min(1, u / 0.08, (1 - u) / 0.12);
    out[i] = y2 * bell * edge * gain;
  }
}

/**
 * synthClip(name, sampleRate) -> Float32Array | null
 * The generated stand-in for one clip, mono, peaking below 0.9.
 */
export function synthClip(name, sampleRate = 44100) {
  const sr = sampleRate;
  const make = (seconds) => new Float32Array(Math.round(seconds * sr));
  let out;
  if (name === 'tock') {
    out = make(0.05);
    ping(out, sr, 430, 0.05, 0.011, 0.8);
    ping(out, sr, 860, 0.03, 0.005, 0.25);
  } else if (name === 'tick') {
    out = make(0.03);
    ping(out, sr, 1500, 0.03, 0.005, 0.7);
    ping(out, sr, 2300, 0.02, 0.003, 0.25);
  } else if (name === 'pip') {
    out = make(0.07);
    ping(out, sr, 2950, 0.07, 0.022, 0.75);
  } else if (name === 'beep') {
    out = make(0.17);
    ping(out, sr, 2350, 0.17, 0.06, 0.75);
  } else if (name === 'whoosh') {
    out = make(0.62);
    gust(out, sr, { seed: 11, peakAt: 0.4, lowHz: 120, highHz: 900, gain: 2.6 });
  } else if (name === 'rush') {
    out = make(1.15);
    gust(out, sr, { seed: 23, peakAt: 0.5, lowHz: 200, highHz: 1900, gain: 2.2 });
  } else if (name === 'fly') {
    out = make(1.3);
    gust(out, sr, { seed: 37, peakAt: 0.28, lowHz: 110, highHz: 1300, gain: 2.4 });
  } else if (name === 'arrive') {
    out = make(1.7);
    const notes = [587, 880, 1175, 1320, 1760, 2349];
    notes.forEach((f, i) => ping(out, sr, f, 1.7 - i * 0.07 - 0.01, 0.28 + i * 0.03, 0.2, i * 0.07));
  } else {
    return null;
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.85) for (let i = 0; i < out.length; i++) out[i] *= 0.85 / peak;
  return out;
}

// ---- which sound a control makes ----------------------------------------------------------------

const matches = (el, selector) => !!el && typeof el.matches === 'function' && el.matches(selector);

/**
 * cueForClick(el) -> cue name | null
 * `el` is the control that was pressed (already resolved with closest()), read after its own
 * handler has run, so aria-pressed and aria-expanded show the new state. Checkboxes, radios and
 * selects answer on `change` instead, so a click on them is silent here.
 */
export function cueForClick(el) {
  if (!el) return null;
  const named = el.getAttribute ? el.getAttribute('data-sound') : null;
  if (named === 'playpause') return el.getAttribute('aria-pressed') === 'true' ? 'play' : 'pause';
  if (named) return named === 'none' ? null : named;
  if (el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')) return null;
  if (matches(el, 'input, select, textarea, label, summary')) return null;
  if (matches(el, '[data-close-dialog], .skyhome-x, #btn-sheet-close')) return 'close';
  if (matches(el, '[aria-expanded]')) return el.getAttribute('aria-expanded') === 'true' ? 'open' : 'close';
  if (matches(el, '[aria-haspopup]')) return 'open';
  if (matches(el, '[aria-pressed]')) return el.getAttribute('aria-pressed') === 'true' ? 'on' : 'off';
  if (matches(el, '[role="option"], [role="menuitem"], .picklist-row, .skyhome-chip, .chip')) return 'pick';
  if (matches(el, '[role="tab"], [role="radio"], .seg, .seg button')) return 'tab';
  if (matches(el, '[type="submit"], .btn-solid')) return 'press';
  return 'tap';
}

/** cueForChange(el) -> cue name | null, for a control that reports `change`. */
export function cueForChange(el) {
  if (!el || !el.getAttribute) return null;
  const named = el.getAttribute('data-sound');
  if (named) return named === 'none' ? null : named;
  const type = String(el.type || '').toLowerCase();
  if (type === 'checkbox') return el.checked ? 'on' : 'off';
  if (type === 'radio') return 'tab';
  if (matches(el, 'select')) return 'pick';
  return null;
}

const TYPING = 'input[type="text"], input[type="search"], input:not([type]), textarea';
const PRESSABLE = 'button, a.btn, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="radio"], .picklist-row, [data-sound]';

// ---- the player ----------------------------------------------------------------------------------

let current = null;

/** cue(name, opts): play a cue on the page's sound player, if there is one. Safe to call anywhere. */
export function cue(name, opts) {
  if (current) current.play(name, opts);
}

/** say(id): speak the recorded line `say-<id>` if the build has one (the tours). -> true when it will play. */
export function say(id) {
  return current ? current.say(id) : false;
}

/** hush(): stop the line being spoken. */
export function hush() {
  if (current) current.hush();
}

function dataUriBytes(uri, win) {
  const comma = uri.indexOf(',');
  if (comma < 0 || !/;base64/i.test(uri.slice(0, comma))) return null;
  const bin = win.atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * createSound({ win, doc, clips, muted }) -> { play, muted, setMuted, toggle, button, status, destroy }
 *
 * `clips` is the optional { name: data URI } map of recorded clips (default
 * win.TOMBAUGH_SOUNDS). `muted` is the starting state when the visitor has not chosen one.
 * Returns an object even where the browser has no Web Audio; it then stays silent.
 */
export function createSound({ win = globalThis.window, doc = globalThis.document, clips = null, muted = false } = {}) {
  const AudioCtx = win && (win.AudioContext || win.webkitAudioContext);
  const recorded = clips || (win && win.TOMBAUGH_SOUNDS) || {};
  const buffers = new Map(); // clip -> AudioBuffer
  const lastAt = new Map(); // cue -> time of the last play, ms
  const buttons = new Set();
  const offs = [];
  let ctx = null;
  let master = null;
  let loading = null;
  let live = 0;
  let played = 0;
  let lastCue = null;
  const recent = [];
  let licensed = 0;
  let wokeAt = -1e9;
  let summaryAt = -1e9;
  let isMuted = !!muted;
  try {
    const saved = win.localStorage.getItem(STORE_KEY);
    if (saved === '0') isMuted = true;
    else if (saved === '1') isMuted = false;
  } catch {
    // private windows: keep the default
  }

  const now = () => (win.performance && win.performance.now ? win.performance.now() : Date.now());

  function decode(context, bytes) {
    return new Promise((resolve, reject) => {
      try {
        const p = context.decodeAudioData(bytes, resolve, reject);
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  function loadClips() {
    if (loading) return loading;
    loading = Promise.all(
      CLIPS.map(async (name) => {
        const uri = recorded[name];
        if (typeof uri === 'string' && uri.startsWith('data:audio/')) {
          try {
            const bytes = dataUriBytes(uri, win);
            if (bytes) {
              buffers.set(name, await decode(ctx, bytes));
              licensed += 1;
              return;
            }
          } catch {
            // fall through to the generated clip
          }
        }
        const data = synthClip(name, ctx.sampleRate);
        if (!data) return;
        const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
        buf.getChannelData(0).set(data);
        buffers.set(name, buf);
      }),
    );
    return loading;
  }

  /** Called from the first press or key: browsers only let sound start from one. */
  function wake() {
    if (!AudioCtx) return;
    wokeAt = now();
    try {
      if (!ctx) {
        ctx = new AudioCtx({ latencyHint: 'interactive' });
        master = ctx.createGain();
        master.gain.value = 0.7;
        master.connect(ctx.destination);
        loadClips();
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      syncBed();
    } catch {
      ctx = null;
    }
  }

  function start(part, opts, when) {
    const buf = buffers.get(part.clip);
    if (!buf || live >= 10) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (part.rate || 1) * (opts.rate || 1);
    const gain = ctx.createGain();
    gain.gain.value = (part.gain == null ? 0.3 : part.gain) * (opts.gain == null ? 1 : opts.gain);
    src.connect(gain);
    gain.connect(master);
    live += 1;
    src.onended = () => {
      live -= 1;
      try {
        gain.disconnect();
      } catch {
        // already gone
      }
    };
    src.start(when + (part.at || 0));
  }

  // ---- a quiet bed of music under the whole-sky page ------------------------------------------
  let bed = null; // { kind, stop() } while it plays
  // Recorded beds are the clips named music, music2, music3...: a different one each visit.
  const bedNames = Object.keys(recorded).filter((k) => /^music\d*$/.test(k) && typeof recorded[k] === 'string' && recorded[k].startsWith('data:audio/'));
  const bedBuffers = new Map(); // name -> AudioBuffer, decoded when first wanted
  let lastBed = '';
  let bedPending = false;

  const wantBed = () => !!ctx && !isMuted && !(doc && doc.hidden) && !!doc && doc.documentElement.dataset.screen === 'landing' && doc.documentElement.dataset.music !== 'off';

  /** -> the next bed to play (not the one just heard), or null for the generated notes. */
  function pickBed() {
    if (!bedNames.length) return Promise.resolve(null);
    const pool = bedNames.length > 1 ? bedNames.filter((n) => n !== lastBed) : bedNames;
    const name = pool[Math.floor(Math.random() * pool.length)];
    lastBed = name;
    if (bedBuffers.has(name)) return Promise.resolve(bedBuffers.get(name));
    return Promise.resolve()
      .then(() => decode(ctx, dataUriBytes(recorded[name], win)))
      .then((buf) => {
        bedBuffers.set(name, buf);
        return buf;
      })
      .catch(() => null);
  }

  function startBed(bedBuffer) {
    // Needs real Web Audio (oscillators, ramps); anything less stays silent.
    if (bed || !ctx || typeof ctx.createOscillator !== 'function') return;
    const c = ctx;
    const out = c.createGain();
    out.gain.setValueAtTime(0, c.currentTime);
    out.connect(master);
    const nodes = [];
    let timer = 0;
    let stopped = false;
    let level = 0.2;
    if (bedBuffer) {
      // The clip fades in and out over three seconds: each pass starts under the end of the last.
      const period = Math.max(4, bedBuffer.duration - 3);
      const pass = (when) => {
        if (stopped) return;
        const src = c.createBufferSource();
        src.buffer = bedBuffer;
        src.connect(out);
        src.start(when);
        nodes.push(src);
        if (nodes.length > 3) nodes.shift();
        timer = win.setTimeout(() => pass(when + period), Math.max(0, (when + period - c.currentTime - 1.5) * 1000));
      };
      pass(c.currentTime + 0.05);
    } else {
      // No recording: five soft notes of an open chord, each swelling at its own slow pace.
      level = 0.16;
      const tone = c.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 900;
      tone.connect(out);
      [110, 164.81, 220, 277.18, 329.63].forEach((hz, i) => {
        const osc = c.createOscillator();
        osc.type = i % 2 ? 'triangle' : 'sine';
        osc.frequency.value = hz;
        osc.detune.value = (i - 2) * 4;
        const voice = c.createGain();
        voice.gain.value = 0.05;
        const swell = c.createOscillator();
        swell.frequency.value = 0.03 + i * 0.011;
        const depth = c.createGain();
        depth.gain.value = 0.04;
        swell.connect(depth);
        depth.connect(voice.gain);
        osc.connect(voice);
        voice.connect(tone);
        osc.start();
        swell.start();
        nodes.push(osc, swell);
      });
    }
    out.gain.linearRampToValueAtTime(level, c.currentTime + 3);
    bed = {
      kind: bedBuffer ? 'recorded' : 'generated',
      stop() {
        stopped = true;
        win.clearTimeout(timer);
        try {
          const t = c.currentTime;
          out.gain.cancelScheduledValues(t);
          out.gain.setValueAtTime(out.gain.value, t);
          out.gain.linearRampToValueAtTime(0, t + 1.2);
        } catch {
          // the context has closed
        }
        win.setTimeout(() => {
          for (const n of nodes) {
            try {
              n.stop();
            } catch {
              // never started, or already stopped
            }
          }
          try {
            out.disconnect();
          } catch {
            // already gone
          }
        }, 1400);
      },
    };
  }

  /** Starts or fades the bed to match where the visitor is, and whether sound is on. */
  function syncBed() {
    if (!ctx) return;
    if (wantBed()) {
      if (bed || bedPending) return;
      bedPending = true;
      pickBed().then((buf) => {
        bedPending = false;
        if (wantBed()) startBed(buf);
      });
    } else if (bed) {
      bed.stop();
      bed = null;
    }
  }

  // ---- a voice for the tours: recorded clips named say-<story>-<step> ---------------------------
  const lines = new Map(); // id -> AudioBuffer
  let voice = null;
  let speaking = '';

  let nextLine = ''; // a line asked for while another is still being spoken
  function hush() {
    nextLine = '';
    speaking = '';
    if (!voice) return;
    try {
      voice.stop();
    } catch {
      // already ended
    }
    voice = null;
  }

  function say(id) {
    // A line is never cut short: the next one waits for it to end.
    if (voice) {
      nextLine = id;
      return true;
    }
    hush();
    if (doc && doc.documentElement.dataset.voice === 'off') return false;
    const uri = recorded[`say-${id}`];
    if (!ctx || isMuted || typeof uri !== 'string' || !uri.startsWith('data:audio/')) return false;
    speaking = id;
    const go = (buf) => {
      if (speaking !== id || isMuted || !ctx || !buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = 1.25;
      src.connect(gain);
      gain.connect(master);
      src.onended = () => {
        const mine = voice === src;
        if (mine) voice = null;
        try {
          gain.disconnect();
        } catch {
          // already gone
        }
        if (mine && nextLine) {
          const next = nextLine;
          nextLine = '';
          say(next);
        }
      };
      src.start();
      voice = src;
    };
    if (lines.has(id)) go(lines.get(id));
    else {
      Promise.resolve()
        .then(() => decode(ctx, dataUriBytes(uri, win)))
        .then((buf) => {
          lines.set(id, buf);
          go(buf);
        })
        .catch(() => {});
    }
    return true;
  }

  /** play(name, { rate, gain }): play a cue now. Unknown names and muted pages are silent. */
  function play(name, opts = {}) {
    const parts = CUES[name];
    if (!parts || isMuted || !ctx || (doc && doc.hidden)) return false;
    const t = now();
    // A context that was woken a moment ago starts within a few milliseconds and plays what was
    // scheduled; one the browser has put to sleep must not collect a queue of old sounds.
    if (ctx.state !== 'running' && t - wokeAt > 1000) return false;
    const gap = GAPS[name] || 0;
    if (gap && lastAt.has(name) && t - lastAt.get(name) < gap) return false;
    lastAt.set(name, t);
    const run = () => {
      if (isMuted || !ctx) return;
      const when = ctx.currentTime + 0.004;
      for (const part of parts) start(part, opts, when);
    };
    if (parts.every((p) => buffers.has(p.clip))) run();
    else if (loading) loading.then(run, () => {}); // the very first press, while the clips decode
    played += 1;
    lastCue = name;
    recent.push(name);
    if (recent.length > 16) recent.shift();
    return true;
  }

  function paint(btn) {
    btn.setAttribute('aria-pressed', String(!isMuted));
    btn.setAttribute('aria-label', isMuted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
    btn.title = isMuted ? 'Turn sound on' : 'Turn sound off';
    btn.classList.toggle('is-muted', isMuted);
  }

  function setMuted(next) {
    isMuted = !!next;
    try {
      win.localStorage.setItem(STORE_KEY, isMuted ? '0' : '1');
    } catch {
      // not remembered, still works for this visit
    }
    for (const b of buttons) paint(b);
    if (isMuted) hush();
    if (!isMuted) {
      wake();
      play('on');
    }
    syncBed();
  }

  /** button(className) -> a Sound on/off button kept in step with the state. */
  function button(className = 'btn') {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `${className} sound-toggle`;
    btn.setAttribute('data-sound', 'none');
    btn.setAttribute('data-testid', 'sound-toggle');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
      '<path d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z" fill="currentColor"/>' +
      '<path class="sound-waves" d="M15.2 9.2a4 4 0 0 1 0 5.6M17.6 6.9a7.3 7.3 0 0 1 0 10.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path class="sound-cross" d="M15.6 9.6l4.8 4.8M20.4 9.6l-4.8 4.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '</svg>';
    btn.addEventListener('click', () => setMuted(!isMuted));
    buttons.add(btn);
    paint(btn);
    return btn;
  }

  // ---- listening to the page -----------------------------------------------------------------
  function on(target, type, fn, options) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, fn, options);
    offs.push(() => target.removeEventListener(type, fn, options));
  }

  if (doc && AudioCtx) {
    for (const type of ['pointerdown', 'keydown', 'touchend']) on(doc, type, wake, { capture: true, passive: true });
    on(doc, 'click', (ev) => {
      if (!ev.target || !ev.target.closest) return;
      if (ev.target.closest('summary')) summaryAt = now();
      const el = ev.target.closest(PRESSABLE);
      if (!el) return;
      // aria-expanded is set by the control's own handler, which has run by the next task.
      if (matches(el, '[aria-expanded]')) win.setTimeout(() => play(cueForClick(el)), 0);
      else play(cueForClick(el));
    });
    on(doc, 'change', (ev) => play(cueForChange(ev.target)));
    on(doc, 'input', (ev) => {
      const el = ev.target;
      if (el && matches(el, TYPING)) play('type', { rate: 1.15 + 0.3 * Math.random() });
      if (!el || String(el.type).toLowerCase() !== 'range') return;
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const u = max > min ? (Number(el.value) - min) / (max - min) : 0.5;
      play('slide', { rate: 0.85 + 0.5 * Math.min(1, Math.max(0, u)) });
    });
    on(doc, 'focusin', (ev) => {
      if (matches(ev.target, TYPING)) play('focus');
    });
    // A mouse coming to rest on a control: one very quiet tick each.
    let hovered = null;
    on(doc, 'pointerover', (ev) => {
      if (ev.pointerType !== 'mouse' || !ev.target || !ev.target.closest) return;
      const el = ev.target.closest(PRESSABLE);
      if (el === hovered) return;
      hovered = el;
      if (el && !el.disabled && el.getAttribute('data-sound') !== 'none') play('hover');
    }, { passive: true });
    // Zooming the sky or a photo with the wheel: higher going in, lower coming out.
    on(doc, 'wheel', (ev) => {
      if (ev.target && ev.target.closest && ev.target.closest('canvas, .viewer, .skyhome')) play('zoom', { rate: ev.deltaY < 0 ? 1.25 : 0.85 });
    }, { passive: true, capture: true });
    // A window closed with Escape or a press outside it (its own Close button has already answered).
    on(doc, 'close', (ev) => {
      if (matches(ev.target, 'dialog')) play('close');
    }, true);
    // Keyboard shortcuts that press nothing on screen.
    on(doc, 'keydown', (ev) => {
      if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey || !ev.target || matches(ev.target, 'input, textarea, select, [contenteditable]')) return;
      if (ev.key === ' ' && doc.documentElement.dataset.screen === 'console' && !matches(ev.target, 'button, a, summary')) play('key');
    });
    // Only a drop-down the visitor opened: the page also opens and closes them as it redraws.
    on(doc, 'toggle', (ev) => {
      if (matches(ev.target, 'details') && now() - summaryAt < 400) play(ev.target.open ? 'open' : 'close');
    }, true);

    on(doc, 'visibilitychange', syncBed);
    // The page moving between the sky and the photos, and between Simple and Advanced.
    const root = doc.documentElement;
    let screen = root.dataset.screen;
    let mode = root.dataset.mode;
    if (typeof win.MutationObserver === 'function') {
      const mo = new win.MutationObserver(() => {
        const s = root.dataset.screen;
        const m = root.dataset.mode;
        if (s !== screen) {
          if (s === 'console' && screen === 'landing') play('go');
          else if (s === 'landing' && screen === 'console') play('fly');
          screen = s;
          syncBed();
        }
        if (m !== mode) {
          if (mode) play('open');
          mode = m;
        }
        // Settings: music and the spoken tour can each be turned off.
        syncBed();
        if (root.dataset.voice === 'off') hush();
      });
      mo.observe(root, { attributes: true, attributeFilter: ['data-screen', 'data-mode', 'data-music', 'data-voice'] });
      offs.push(() => mo.disconnect());
    }
  }

  const api = {
    play,
    say,
    hush,
    muted: () => isMuted,
    setMuted,
    toggle: () => setMuted(!isMuted),
    button,
    /** For tests and the console: what is loaded and what has played. */
    status: () => ({
      supported: !!AudioCtx,
      state: ctx ? ctx.state : 'idle',
      muted: isMuted,
      clips: [...buffers.keys()],
      recorded: licensed,
      played,
      last: lastCue,
      music: bed ? bed.kind : 'off',
      speaking,
      recent: recent.slice(),
    }),
    destroy() {
      for (const off of offs.splice(0)) off();
      buttons.clear();
      hush();
      if (bed) bed.stop();
      bed = null;
      if (current === api) current = null;
      if (ctx && ctx.close) ctx.close().catch(() => {});
      ctx = null;
    },
  };
  current = api;
  return api;
}
