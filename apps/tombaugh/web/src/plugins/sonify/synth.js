// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// synth.js: a very small WebAudio player for the notes made by mapping.js.
//
//   createSynth({ win, contextFactory }) -> synth
//   synth.available            false when the browser has no AudioContext; play() then reports why
//   synth.play(plan, { onNote(note, index), onEnd({ completed }) }) -> { ok, scheduled, duration, reason? }
//                              plan = { notes: [{ t, dur, freq, gain, timbre }], duration }
//   synth.stop({ fadeMs })     fades out over about a tenth of a second; safe to call any time
//   synth.setVolume(0..1), synth.volume, synth.playing, synth.stats(), synth.dispose()
//
// The AudioContext is created on the first play(), which must come from a user gesture;
// nothing here makes a sound on its own. Each note is one oscillator (sine or triangle) with
// its own gain envelope: a 12 ms attack, so there are no clicks, and an exponential decay.
// Notes go through a per-performance bus (so stop() can fade one performance without touching
// the next), a master volume and a compressor set up as a limiter. Every call is guarded: a
// browser that refuses audio costs the user the sound, never the page.

const ATTACK = 0.012;
const PEAK = 0.42; // per-note ceiling; several notes overlap, the limiter catches the rest
const FLOOR = 0.0008;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const NO_AUDIO_REASON = 'This browser cannot play sound from a web page (no WebAudio).';

export function createSynth({ win = globalThis, contextFactory = null } = {}) {
  const Ctor = contextFactory ? null : win && (win.AudioContext || win.webkitAudioContext);
  const available = Boolean(contextFactory || Ctor);
  const setTimer = (fn, ms) => (win && win.setTimeout ? win.setTimeout(fn, ms) : setTimeout(fn, ms));
  const clearTimer = (id) => (win && win.clearTimeout ? win.clearTimeout(id) : clearTimeout(id));
  const setTick = (fn, ms) => (win && win.setInterval ? win.setInterval(fn, ms) : setInterval(fn, ms));
  const clearTick = (id) => (win && win.clearInterval ? win.clearInterval(id) : clearInterval(id));
  const clock = () => (win && win.performance && win.performance.now ? win.performance.now() : Date.now()) / 1000;

  let ctx = null;
  let master = null;
  let volume = 0.7;
  let failed = '';
  let current = null; // { bus, voices, tick, onEnd, ended }
  let plays = 0;
  let lastScheduled = 0;

  // Slider position to gain: squared, which is close to how loudness is heard.
  const gainFor = (v) => v * v;

  function ensure() {
    if (ctx || !available || failed) return ctx;
    try {
      ctx = contextFactory ? contextFactory() : new Ctor({ latencyHint: 'interactive' });
      master = ctx.createGain();
      master.gain.value = gainFor(volume);
      let out = ctx.destination;
      if (typeof ctx.createDynamicsCompressor === 'function') {
        const limiter = ctx.createDynamicsCompressor();
        const set = (param, value) => {
          if (param && 'value' in param) param.value = value;
        };
        set(limiter.threshold, -14);
        set(limiter.knee, 6);
        set(limiter.ratio, 16);
        set(limiter.attack, 0.003);
        set(limiter.release, 0.15);
        limiter.connect(out);
        out = limiter;
      }
      master.connect(out);
    } catch (err) {
      failed = `Sound could not be started: ${err && err.message ? err.message : err}`;
      ctx = null;
      master = null;
    }
    return ctx;
  }

  function finish(performance, completed) {
    if (!performance || performance.ended) return;
    performance.ended = true;
    clearTick(performance.tick);
    if (current === performance) current = null;
    try {
      if (performance.onEnd) performance.onEnd({ completed });
    } catch {
      // a listener's mistake is not ours to rethrow
    }
  }

  function release(performance, afterSeconds) {
    setTimer(() => {
      for (const voice of performance.voices) {
        try {
          voice.stop();
        } catch {
          // already stopped
        }
      }
      try {
        performance.bus.disconnect();
      } catch {
        // already disconnected
      }
    }, Math.max(0, afterSeconds) * 1000);
  }

  function stop({ fadeMs = 120 } = {}) {
    const performance = current;
    if (!performance) return;
    const fade = clamp(fadeMs, 0, 2000) / 1000;
    try {
      const now = ctx.currentTime;
      const g = performance.bus.gain;
      if (typeof g.cancelScheduledValues === 'function') g.cancelScheduledValues(now);
      g.setValueAtTime(typeof g.value === 'number' ? g.value : 1, now);
      g.linearRampToValueAtTime(0, now + Math.max(0.005, fade));
    } catch {
      // fall through to the hard stop below
    }
    release(performance, fade + 0.03);
    finish(performance, false);
  }

  function play(plan, { onNote = null, onEnd = null } = {}) {
    const notes = plan && Array.isArray(plan.notes) ? plan.notes.filter((n) => n && n.freq > 0 && n.t >= 0 && n.dur > 0) : [];
    if (!available) return { ok: false, scheduled: 0, duration: 0, reason: NO_AUDIO_REASON };
    if (!notes.length) return { ok: false, scheduled: 0, duration: 0, reason: 'There is nothing to play.' };
    stop({ fadeMs: 40 });
    if (!ensure()) return { ok: false, scheduled: 0, duration: 0, reason: failed || NO_AUDIO_REASON };
    try {
      // Browsers start a context suspended until a gesture; this call is that gesture's.
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch {
      // carry on: scheduling against a suspended context is harmless
    }
    const performance = { bus: null, voices: [], tick: 0, onEnd, ended: false };
    const lead = 0.06;
    let scheduled = 0;
    let duration = 0;
    try {
      const bus = ctx.createGain();
      bus.gain.value = 1;
      bus.connect(master);
      performance.bus = bus;
      const t0 = ctx.currentTime + lead;
      for (const note of notes) {
        const start = t0 + note.t;
        const end = start + note.dur;
        const peak = PEAK * clamp(typeof note.gain === 'number' ? note.gain : 0.7, 0, 1);
        const osc = ctx.createOscillator();
        osc.type = note.timbre === 'triangle' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(clamp(note.freq, 40, 4000), start);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(Math.max(FLOOR, peak), start + Math.min(ATTACK, note.dur / 3));
        env.gain.exponentialRampToValueAtTime(FLOOR, end);
        env.gain.setValueAtTime(0, end + 0.005);
        osc.connect(env);
        env.connect(bus);
        osc.start(start);
        osc.stop(end + 0.02);
        performance.voices.push(osc);
        scheduled++;
        if (note.t + note.dur > duration) duration = note.t + note.dur;
      }
    } catch (err) {
      release(performance, 0);
      return { ok: false, scheduled: 0, duration: 0, reason: `Sound could not be scheduled: ${err && err.message ? err.message : err}` };
    }
    if (plan && typeof plan.duration === 'number' && plan.duration > duration) duration = plan.duration;
    current = performance;
    plays++;
    lastScheduled = scheduled;

    // The cursor follows the wall clock, which keeps running if the tab's audio is suspended.
    const started = clock() + lead;
    let next = 0;
    performance.tick = setTick(() => {
      if (performance.ended) return;
      const elapsed = clock() - started;
      while (next < notes.length && notes[next].t <= elapsed) {
        try {
          if (onNote) onNote(notes[next], next);
        } catch {
          // keep playing
        }
        next++;
      }
      if (elapsed >= duration + 0.05) {
        release(performance, 0.1);
        finish(performance, true);
      }
    }, 20);
    return { ok: true, scheduled, duration };
  }

  return {
    available,
    play,
    stop,
    get playing() {
      return Boolean(current);
    },
    get volume() {
      return volume;
    },
    setVolume(v) {
      volume = clamp(Number.isFinite(Number(v)) ? Number(v) : volume, 0, 1);
      if (!master || !ctx) return;
      try {
        if (typeof master.gain.setTargetAtTime === 'function') master.gain.setTargetAtTime(gainFor(volume), ctx.currentTime, 0.02);
        else master.gain.value = gainFor(volume);
      } catch {
        // the next performance picks the volume up
      }
    },
    /** Counters for tests and the demo page: nothing here depends on sound being audible. */
    stats() {
      return { available, plays, scheduled: lastScheduled, playing: Boolean(current), context: ctx ? ctx.state || 'running' : 'none', error: failed };
    },
    dispose() {
      stop({ fadeMs: 0 });
      try {
        if (ctx && typeof ctx.close === 'function') {
          const p = ctx.close();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch {
        // already closed
      }
      ctx = null;
      master = null;
    },
  };
}
