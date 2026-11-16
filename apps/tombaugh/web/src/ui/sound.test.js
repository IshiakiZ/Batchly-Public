// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIPS, CUES, synthClip, cueForClick, cueForChange, createSound, cue } from './sound.js';

/** A stand-in element: `is` lists the selectors it matches, `attrs` its attributes. */
function el(is = [], attrs = {}, props = {}) {
  return {
    ...props,
    matches: (selector) => selector.split(',').some((part) => is.includes(part.trim())),
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
  };
}

test('every cue uses known clips with small gains', () => {
  for (const [name, parts] of Object.entries(CUES)) {
    assert.ok(parts.length >= 1, name);
    for (const part of parts) {
      assert.ok(CLIPS.includes(part.clip), `${name} uses ${part.clip}`);
      assert.ok(part.gain > 0 && part.gain <= 0.6, `${name} gain`);
      assert.ok((part.rate || 1) >= 0.3 && (part.rate || 1) <= 2, `${name} rate`);
      assert.ok((part.at || 0) < 0.5, `${name} offset`);
    }
  }
});

test('every clip has a generated stand-in that is finite, short and not clipped', () => {
  for (const name of CLIPS) {
    const data = synthClip(name, 44100);
    assert.ok(data instanceof Float32Array, name);
    assert.ok(data.length > 44100 * 0.02 && data.length < 44100 * 2, `${name} length`);
    let peak = 0;
    for (const v of data) {
      assert.ok(Number.isFinite(v), `${name} finite`);
      peak = Math.max(peak, Math.abs(v));
    }
    assert.ok(peak > 0.05 && peak <= 0.9, `${name} peak ${peak}`);
    assert.ok(Math.abs(data[data.length - 1]) < 0.05, `${name} ends quietly`);
  }
  assert.equal(synthClip('nope'), null);
  assert.deepEqual(Array.from(synthClip('whoosh', 8000)), Array.from(synthClip('whoosh', 8000)), 'same every time');
});

test('a press picks its sound from what the control is', () => {
  assert.equal(cueForClick(null), null);
  assert.equal(cueForClick(el(['button'])), 'tap');
  assert.equal(cueForClick(el(['.btn-solid'])), 'press');
  assert.equal(cueForClick(el(['.seg'])), 'tab');
  assert.equal(cueForClick(el(['.picklist-row'])), 'pick');
  assert.equal(cueForClick(el(['.skyhome-chip'])), 'pick');
  assert.equal(cueForClick(el(['[data-close-dialog]'])), 'close');
  assert.equal(cueForClick(el(['[aria-haspopup]'], { 'aria-haspopup': 'dialog' })), 'open');
  assert.equal(cueForClick(el(['[aria-expanded]', '.skyhome-chip'], { 'aria-expanded': 'true' })), 'open');
  assert.equal(cueForClick(el(['[aria-expanded]'], { 'aria-expanded': 'false' })), 'close');
  assert.equal(cueForClick(el(['[aria-pressed]'], { 'aria-pressed': 'true' })), 'on');
  assert.equal(cueForClick(el(['[aria-pressed]'], { 'aria-pressed': 'false' })), 'off');
});

test('silent controls, named sounds and the play button', () => {
  assert.equal(cueForClick(el(['button'], { 'data-sound': 'none' })), null);
  assert.equal(cueForClick(el(['button'], { 'data-sound': 'fly' })), 'fly');
  assert.equal(cueForClick(el(['button'], {}, { disabled: true })), null);
  assert.equal(cueForClick(el(['button'], { 'aria-disabled': 'true' })), null);
  assert.equal(cueForClick(el(['input'])), null, 'inputs answer on change');
  assert.equal(cueForClick(el(['button'], { 'data-sound': 'playpause', 'aria-pressed': 'true' })), 'play');
  assert.equal(cueForClick(el(['button'], { 'data-sound': 'playpause', 'aria-pressed': 'false' })), 'pause');
});

test('switches, radios and selects answer on change', () => {
  assert.equal(cueForChange(null), null);
  assert.equal(cueForChange(el([], {}, { type: 'checkbox', checked: true })), 'on');
  assert.equal(cueForChange(el([], {}, { type: 'checkbox', checked: false })), 'off');
  assert.equal(cueForChange(el([], {}, { type: 'radio' })), 'tab');
  assert.equal(cueForChange(el(['select'], {}, { type: 'select-one' })), 'pick');
  assert.equal(cueForChange(el([], {}, { type: 'text' })), null);
  assert.equal(cueForChange(el([], { 'data-sound': 'none' }, { type: 'checkbox', checked: true })), null);
});

/** A browser with just enough Web Audio to follow what would have played. */
function fakeBrowser({ stored = null } = {}) {
  const listeners = new Map();
  const started = [];
  const store = new Map(stored === null ? [] : [['tombaugh.sound', stored]]);
  class Ctx {
    constructor() {
      this.state = 'running';
      this.sampleRate = 8000;
      this.currentTime = 1;
      this.destination = {};
    }
    createGain() {
      return { gain: { value: 1 }, connect() {}, disconnect() {} };
    }
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      return { length, getChannelData: () => data };
    }
    createBufferSource() {
      const src = { playbackRate: { value: 1 }, connect() {}, start: (when) => started.push({ when, rate: src.playbackRate.value, length: src.buffer.length }) };
      return src;
    }
    decodeAudioData(bytes) {
      return Promise.resolve({ length: bytes.byteLength, recorded: true, getChannelData: () => new Float32Array(1) });
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  let clock = 0;
  const win = {
    AudioContext: Ctx,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    performance: { now: () => clock },
    setTimeout: (fn) => fn(),
  };
  const classes = new Set();
  const doc = {
    hidden: false,
    documentElement: { dataset: { screen: 'landing', mode: 'simple' } },
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
    removeEventListener: () => {},
    createElement: () => ({
      attrs: {},
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      addEventListener(type, fn) {
        this.onclick = fn;
      },
    }),
  };
  const fire = (type, ev = {}) => (listeners.get(type) || []).forEach((fn) => fn(ev));
  return { win, doc, fire, started, store, classes, tick: (ms) => (clock += ms) };
}

test('nothing plays before the first press, then cues play and repeat no faster than their gap', async () => {
  const b = fakeBrowser();
  const sound = createSound({ win: b.win, doc: b.doc });
  assert.equal(sound.play('tap'), false, 'no sound before a press');
  assert.equal(sound.status().state, 'idle');
  b.fire('pointerdown');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sound.status().clips.sort(), [...CLIPS].sort());
  assert.equal(sound.status().recorded, 0, 'all generated');
  assert.equal(sound.play('flip'), true);
  assert.equal(sound.play('flip'), false, 'too soon');
  b.tick(100);
  assert.equal(sound.play('flip'), true);
  assert.equal(sound.play('nope'), false);
  assert.equal(b.started.length, 2);
  cue('on');
  assert.equal(b.started.length, 4, 'a switch plays two tones through cue()');
  assert.ok(b.started[3].when > b.started[2].when);
  b.doc.hidden = true;
  b.tick(100);
  assert.equal(sound.play('tap'), false, 'silent while the page is hidden');
  sound.destroy();
  cue('tap'); // no player: must not throw
});

test('the Sound button mutes, remembers, and recorded clips replace generated ones', async () => {
  const b = fakeBrowser({ stored: '0' });
  const uri = `data:audio/wav;base64,${Buffer.from('RIFFxxxx').toString('base64')}`;
  const sound = createSound({ win: b.win, doc: b.doc, clips: { tock: uri, bogus: uri, pip: 'https://example.com/a.wav' } });
  assert.equal(sound.muted(), true, 'remembered as off');
  const btn = sound.button('btn');
  assert.equal(btn.attrs['aria-pressed'], 'false');
  assert.ok(b.classes.has('is-muted'));
  b.fire('pointerdown');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sound.status().recorded, 1, 'only the data URI for a known clip is used');
  assert.equal(sound.play('tap'), false, 'muted');
  btn.onclick();
  assert.equal(sound.muted(), false);
  assert.equal(b.store.get('tombaugh.sound'), '1');
  assert.equal(btn.attrs['aria-pressed'], 'true');
  assert.equal(sound.status().last, 'on', 'turning sound on answers with a sound');
  b.tick(50);
  assert.equal(sound.play('tap'), true);
  sound.destroy();
});

test('without Web Audio the player is silent and harmless', () => {
  const b = fakeBrowser();
  delete b.win.AudioContext;
  const sound = createSound({ win: b.win, doc: b.doc });
  b.fire('pointerdown');
  assert.equal(sound.play('tap'), false);
  assert.equal(sound.status().supported, false);
  sound.destroy();
});

test('typing, hovering and zooming have their own quiet cues', async () => {
  for (const name of ['type', 'hover', 'zoom', 'focus', 'copy', 'key']) assert.ok(CUES[name], name);
  assert.equal(cueForClick(el(['button'], { 'data-sound': 'copy' })), 'copy');
  const b = fakeBrowser();
  const sound = createSound({ win: b.win, doc: b.doc });
  b.fire('pointerdown');
  await new Promise((r) => setTimeout(r, 0));
  const field = el(['input[type="text"]'], {}, { type: 'text' });
  b.fire('input', { target: field });
  assert.equal(sound.status().last, 'type');
  const button = { ...el(['button']), closest: () => button };
  b.fire('pointerover', { pointerType: 'mouse', target: button });
  assert.equal(sound.status().last, 'hover');
  const before = sound.status().played;
  b.fire('pointerover', { pointerType: 'mouse', target: button });
  b.fire('pointerover', { pointerType: 'touch', target: { closest: () => ({ ...button }) } });
  assert.equal(sound.status().played, before, 'once per control, and never for a finger');
  b.fire('wheel', { deltaY: -1, target: { closest: () => ({}) } });
  assert.equal(sound.status().last, 'zoom');
  sound.destroy();
});

test('the music bed stays off without real Web Audio, and status says so', async () => {
  const b = fakeBrowser();
  const sound = createSound({ win: b.win, doc: b.doc, clips: { music: 'data:audio/mpeg;base64,AAAA' } });
  b.fire('pointerdown');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sound.status().music, 'off', 'the stand-in browser has no oscillators or ramps');
  assert.equal(sound.status().recorded, 0, 'the bed is not counted as a cue');
  sound.destroy();
});
