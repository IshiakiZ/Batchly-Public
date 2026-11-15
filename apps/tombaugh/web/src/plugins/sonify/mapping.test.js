// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Tests for mapping.js (notes and words from measurements) and, with a fake AudioContext, for
// the scheduling done by synth.js. Nothing here makes a sound.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE_HZ,
  MIN_GAIN,
  PENTATONIC,
  SWEEP,
  TOP_STEP,
  describeLightCurve,
  describeSpectrum,
  despike,
  findDip,
  lightCurveToNotes,
  monthYear,
  ratioToStep,
  snrToGain,
  spectrumToNotes,
  splitPasses,
  stepToHz,
  waveToTime,
} from './mapping.js';
import { NO_AUDIO_REASON, createSynth } from './synth.js';

const WAVES = Array.from({ length: 102 }, (_, i) => 0.75 * (5 / 0.75) ** (i / 101));

function planck(wave, teff) {
  return 1 / (wave ** 3 * Math.expm1(14387.77 / (wave * teff)));
}

function spectrum(shape, { peak = 5000, err = 25, bands = [] } = {}) {
  const raw = WAVES.map((w) => {
    let f = shape(w);
    for (const b of bands) f *= 1 - b.depth * Math.exp(-0.5 * ((w - b.center) / b.sigma) ** 2);
    return f;
  });
  const top = Math.max(...raw);
  return WAVES.map((wave, i) => ({ wave, flux_uJy: (raw[i] / top) * peak, err_uJy: err }));
}

const coolStar = () => spectrum((w) => planck(w, 3200));
const dipStar = () => spectrum((w) => planck(w, 3200), { bands: [{ center: 3.3, sigma: 0.12, depth: 0.4 }] });
const tDwarf = () =>
  spectrum((w) => planck(w, 900), {
    peak: 2600,
    err: 20,
    bands: [
      { center: 3.3, sigma: 0.2, depth: 0.93 },
      { center: 2.25, sigma: 0.12, depth: 0.5 },
      { center: 1.67, sigma: 0.07, depth: 0.4 },
    ],
  });

// ---- scale ------------------------------------------------------------------------------------

test('the scale is pentatonic, spans three octaves and rises with every step', () => {
  assert.equal(stepToHz(0), BASE_HZ);
  assert.ok(Math.abs(stepToHz(5) - 2 * BASE_HZ) < 1e-9);
  assert.ok(Math.abs(stepToHz(TOP_STEP) - 8 * BASE_HZ) < 1e-9);
  for (let s = 1; s <= TOP_STEP; s++) assert.ok(stepToHz(s) > stepToHz(s - 1));
  for (let s = 0; s <= TOP_STEP; s++) {
    const semitones = Math.round(12 * Math.log2(stepToHz(s) / BASE_HZ)) % 12;
    assert.ok(PENTATONIC.includes(semitones), `step ${s} is ${semitones} semitones above the root`);
  }
  assert.equal(stepToHz(-3), stepToHz(0));
  assert.equal(stepToHz(99), stepToHz(TOP_STEP));
  assert.equal(stepToHz(NaN), stepToHz(0));
});

test('brightness to pitch is monotonic, centred on the median and clamped', () => {
  assert.equal(ratioToStep(1), 8);
  assert.equal(ratioToStep(4), TOP_STEP);
  assert.equal(ratioToStep(10), TOP_STEP);
  assert.equal(ratioToStep(0.25), 0);
  assert.equal(ratioToStep(1.25), 9);
  assert.equal(ratioToStep(2), 11);
  assert.equal(ratioToStep(1000), TOP_STEP);
  assert.equal(ratioToStep(0.1), 0);
  assert.equal(ratioToStep(1e-6), 0);
  assert.equal(ratioToStep(0), 0);
  assert.equal(ratioToStep(-5), 0);
  assert.equal(ratioToStep(NaN), 0);
  let prev = -1;
  for (let r = 0.01; r < 100; r *= 1.07) {
    const s = ratioToStep(r);
    assert.ok(s >= prev, `step fell at ratio ${r}`);
    assert.ok(Number.isInteger(s) && s >= 0 && s <= TOP_STEP);
    prev = s;
  }
});

test('signal-to-noise to loudness is monotonic and bounded', () => {
  assert.equal(snrToGain(0), MIN_GAIN);
  assert.equal(snrToGain(-4), MIN_GAIN);
  assert.equal(snrToGain(1), MIN_GAIN);
  assert.equal(snrToGain(30), 1);
  assert.equal(snrToGain(1e6), 1);
  assert.equal(snrToGain(null), 0.7);
  let prev = 0;
  for (let s = 0.5; s < 200; s *= 1.3) {
    const g = snrToGain(s);
    assert.ok(g >= prev && g >= MIN_GAIN && g <= 1);
    prev = g;
  }
});

test('wavelength to time sweeps 0.75 to 5 um in four seconds', () => {
  assert.equal(SWEEP.seconds, 4);
  assert.equal(waveToTime(0.75), 0);
  assert.equal(waveToTime(5), 4);
  assert.ok(Math.abs(waveToTime(2.875) - 2) < 1e-12);
  assert.equal(waveToTime(0.1), 0);
  assert.equal(waveToTime(9), 4);
  assert.equal(waveToTime(NaN), 0);
});

// ---- spectrum to notes ------------------------------------------------------------------------

test('a spectrum becomes one note per point, in wavelength order, inside the ranges', () => {
  const plan = spectrumToNotes(coolStar());
  assert.equal(plan.kind, 'spectrum');
  assert.equal(plan.notes.length, 102);
  assert.ok(plan.duration >= 4 && plan.duration < 4.5);
  assert.deepEqual([plan.waveMin, plan.waveMax, plan.seconds], [0.75, WAVES[101], 4]);
  assert.ok(plan.median > 0);
  const lo = stepToHz(0);
  const hi = stepToHz(TOP_STEP);
  plan.notes.forEach((n, i) => {
    assert.ok(n.t >= 0 && n.t <= 4);
    assert.ok(n.dur >= 0.07 && n.dur <= 0.42);
    assert.ok(n.freq >= lo - 1e-9 && n.freq <= hi + 1e-9);
    assert.ok(n.gain >= MIN_GAIN && n.gain <= 1);
    assert.ok(n.timbre === 'sine' || n.timbre === 'triangle');
    if (i > 0) {
      assert.ok(n.t > plan.notes[i - 1].t, 'time increases with wavelength');
      assert.ok(n.wave > plan.notes[i - 1].wave);
    }
  });
  assert.equal(plan.notes[0].t, 0);
  assert.ok(Math.abs(plan.notes[101].t - 4) < 1e-9);
});

test('a partly covered spectrum is swept over its own range, never too fast to follow', () => {
  // One detector: 17 channels between 1.66 and 2.39 um.
  const one = Array.from({ length: 17 }, (_, i) => ({ wave: 1.66 + (0.73 * i) / 16, flux_uJy: 4000 - 40 * i, err_uJy: 60 }));
  const plan = spectrumToNotes(one);
  assert.equal(plan.notes.length, 17);
  assert.equal(plan.notes[0].t, 0, 'no silent lead-in');
  assert.ok(Math.abs(plan.notes[16].t - 2.5) < 1e-9, 'the floor of 2.5 s applies');
  assert.equal(plan.seconds, 2.5);
  assert.ok(Math.abs(plan.waveMin - 1.66) < 1e-9 && Math.abs(plan.waveMax - 2.39) < 1e-9);
  for (let i = 1; i < 17; i++) assert.ok(plan.notes[i].t - plan.notes[i - 1].t > 0.12);
  // Four of six detectors: proportionally shorter than the full sweep.
  const most = WAVES.filter((w) => w >= 1.1 && w <= 4.4).map((wave) => ({ wave, flux_uJy: 100, err_uJy: 5 }));
  const p2 = spectrumToNotes(most);
  assert.ok(p2.seconds > 2.9 && p2.seconds < 3.2, `seconds ${p2.seconds}`);
  // A single point still plays.
  const single = spectrumToNotes([{ wave: 2, flux_uJy: 5, err_uJy: 1 }]);
  assert.equal(single.notes.length, 1);
  assert.equal(single.notes[0].t, 0);
});

test('brighter points are never lower in pitch, and surer points never quieter', () => {
  for (const make of [coolStar, dipStar, tDwarf]) {
    const notes = spectrumToNotes(make()).notes;
    const byFlux = [...notes].sort((a, b) => a.flux - b.flux);
    for (let i = 1; i < byFlux.length; i++) assert.ok(byFlux[i].freq >= byFlux[i - 1].freq - 1e-9);
    const bySnr = [...notes].sort((a, b) => a.snr - b.snr);
    for (let i = 1; i < bySnr.length; i++) assert.ok(bySnr[i].gain >= bySnr[i - 1].gain - 1e-12);
  }
});

test('an absorption dip is audibly lower than its surroundings and is marked', () => {
  const notes = spectrumToNotes(dipStar()).notes;
  const near = (w) => notes.reduce((best, n) => (Math.abs(n.wave - w) < Math.abs(best.wave - w) ? n : best));
  const inDip = near(3.3);
  assert.ok(inDip.step <= near(2.9).step - 1, `dip step ${inDip.step} against ${near(2.9).step}`);
  assert.ok(inDip.step <= near(3.75).step - 1);
  assert.equal(inDip.dip, true);
  assert.equal(inDip.timbre, 'triangle');
  assert.equal(near(1.6).dip, false);
  // Without the band nothing is marked.
  assert.ok(spectrumToNotes(coolStar()).notes.every((n) => !n.dip));
  // The T dwarf's 3.3 um trough bottoms out and its 4.5 um peak is far above it.
  const t = spectrumToNotes(tDwarf()).notes;
  const at = (w) => t.reduce((best, n) => (Math.abs(n.wave - w) < Math.abs(best.wave - w) ? n : best));
  assert.ok(at(4.5).step - at(3.3).step >= 8);
});

test('the median of the spectrum sits mid-range whatever the absolute brightness', () => {
  const faint = spectrumToNotes(spectrum(() => 1, { peak: 3, err: 0.1 })).notes;
  const bright = spectrumToNotes(spectrum(() => 1, { peak: 3e6, err: 1e5 })).notes;
  assert.ok(faint.every((n) => n.step === 8));
  assert.ok(bright.every((n) => n.step === 8));
});

test('awkward spectra still map: gaps, negatives, no errors, too many points, nothing', () => {
  assert.deepEqual(spectrumToNotes([]).notes, []);
  assert.equal(spectrumToNotes(null).duration, 0);
  assert.deepEqual(spectrumToNotes([{ wave: NaN, flux_uJy: 1 }, { wave: 1, flux_uJy: NaN }, null]).notes, []);
  const negative = spectrumToNotes(WAVES.map((wave) => ({ wave, flux_uJy: -5, err_uJy: 10 })));
  assert.ok(negative.notes.every((n) => n.step === 0 && n.gain === MIN_GAIN));
  const bare = spectrumToNotes(coolStar().map(({ wave, flux_uJy }) => ({ wave, flux_uJy })));
  assert.ok(bare.notes.every((n) => n.gain === 0.7 && n.snr === null));
  const flagged = spectrumToNotes(coolStar().map((p, i) => ({ ...p, flagged: i < 10, ok: i !== 50 })));
  assert.equal(flagged.notes.length, 91);
  const many = [];
  for (let i = 0; i < 510; i++) many.push({ wave: 0.75 + (4.25 * i) / 509, flux_uJy: 100 + i, err_uJy: 5 });
  const thinned = spectrumToNotes(many);
  assert.ok(thinned.notes.length <= 128 && thinned.notes.length >= 64);
  for (let i = 1; i < thinned.notes.length; i++) assert.ok(thinned.notes[i].t > thinned.notes[i - 1].t);
  const unsorted = spectrumToNotes([...coolStar()].reverse());
  assert.ok(unsorted.notes[0].wave < unsorted.notes[1].wave);
});

// ---- light curve to notes ---------------------------------------------------------------------

function lightCurve(levels, n = 20, err = 0.03) {
  const starts = [60840, 61025, 61205];
  const out = [];
  levels.forEach((level, k) => {
    for (let i = 0; i < n; i++) out.push({ mjd: starts[k] + (i * 6) / n, ratio: level * (1 + 0.004 * ((i % 3) - 1)), err });
  });
  return out;
}

test('a light curve becomes a slower melody in time order with rests between passes', () => {
  const plan = lightCurveToNotes(lightCurve([1, 2, 1]));
  assert.equal(plan.kind, 'lightcurve');
  assert.equal(plan.passes, 3);
  assert.ok(plan.notes.length >= 24 && plan.notes.length <= 48, `${plan.notes.length} notes`);
  assert.ok(plan.duration > 6 && plan.duration < 16, `duration ${plan.duration}`);
  let rests = 0;
  for (let i = 1; i < plan.notes.length; i++) {
    const a = plan.notes[i - 1];
    const b = plan.notes[i];
    assert.ok(b.t > a.t && b.mjd > a.mjd, 'time maps to time');
    assert.ok(b.t - a.t >= 0.2, 'slower than the spectrum sweep');
    if (b.pass !== a.pass) {
      rests++;
      assert.ok(b.t - a.t > 0.8);
    }
  }
  assert.equal(rests, 2);
  const steps = [0, 1, 2].map((k) => plan.notes.filter((n) => n.pass === k).map((n) => n.step));
  assert.ok(steps[0].every((s) => s === 8));
  assert.ok(steps[1].every((s) => s === TOP_STEP)); // twice as bright: ten steps up, clamped to the top
  assert.ok(steps[2].every((s) => s === 8));
});

test('brightness ratio to pitch is monotonic in the light curve too', () => {
  const pts = [];
  for (let i = 0; i < 30; i++) pts.push({ mjd: 60000 + i, ratio: 0.5 * 1.05 ** i, err: 0.01 });
  const notes = lightCurveToNotes(pts).notes;
  assert.equal(notes.length, 30);
  for (let i = 1; i < notes.length; i++) assert.ok(notes[i].freq >= notes[i - 1].freq);
  assert.ok(notes[29].step > notes[0].step);
  const ten = lightCurveToNotes([{ mjd: 1, ratio: 1 }, { mjd: 2, ratio: 1.1 }, { mjd: 3, ratio: 0.9 }, { mjd: 4, ratio: 0 }, { mjd: 5, ratio: -1 }]).notes;
  assert.deepEqual(ten.map((n) => n.step), [8, 9, 6, 0, 0]);
  assert.deepEqual(lightCurveToNotes([]).notes, []);
  assert.equal(lightCurveToNotes(null).duration, 0);
  assert.deepEqual(splitPasses([{ mjd: 1 }, { mjd: 2 }, { mjd: 100 }]).map((p) => p.length), [2, 1]);
});

// ---- words ------------------------------------------------------------------------------------

test('describeSpectrum names the peak, the dip and the recovery', () => {
  const text = describeSpectrum(dipStar());
  assert.match(text, /^Brightest near 1\.[5-7] micrometres, a dip of (30|35|40) percent near 3\.[23] micrometres, rising again at 3\.[6-9]\. 102 points from 0\.75 to 5\.0 micrometres\.$/);
  const t = describeSpectrum(tDwarf());
  assert.match(t, /^Brightest near (4\.[4-9]|5\.0) micrometres, a dip of (85|90|95) percent near 3\.[2-4] micrometres, rising again at [34]\.\d\./);
  assert.deepEqual(Object.keys(findDip(dipStar())), ['wave', 'depth', 'recoverWave']);
  assert.equal(findDip(coolStar()), null);
});

test('scatter beyond the quoted errors is not described as a dip', () => {
  // A variable source: channels measured on different days differ by tens of percent although
  // each carries a tiny formal error. That is scatter, not absorption.
  const jumpy = coolStar().map((p, i) => ({ ...p, flux_uJy: p.flux_uJy * [1, 1.6, 0.8, 1.4, 0.7][i % 5], err_uJy: 5 }));
  assert.equal(findDip(jumpy), null);
  assert.ok(!/a dip of/.test(describeSpectrum(jumpy)), describeSpectrum(jumpy));
  assert.match(describeSpectrum(jumpy), /scatter more than their error bars allow/);
  assert.ok(!/scatter more|Faint/.test(describeSpectrum(dipStar())));
  assert.ok(spectrumToNotes(jumpy).notes.every((n) => !n.dip));
  // The same errors on a smooth spectrum with a real band still give the dip.
  assert.ok(findDip(dipStar().map((p) => ({ ...p, err_uJy: 5 }))));
  // Without any errors, the scatter itself sets the bar.
  assert.ok(findDip(dipStar().map(({ wave, flux_uJy }) => ({ wave, flux_uJy }))));
  assert.equal(findDip(jumpy.map(({ wave, flux_uJy }) => ({ wave, flux_uJy }))), null);
});

test('isolated spikes from a varying source are set aside, real bands are kept', () => {
  // Values measured in the app for a star that doubles between passes: most channels hold the
  // faint passes, three hold the bright one, and two mixed bins carry large errors.
  const real = [[1.66, 4000, 55], [1.7, 7977, 89], [1.71, 3946, 80], [1.76, 3826, 56], [1.82, 3828, 159], [1.85, 3769, 76], [1.91, 5399, 1898], [1.93, 5410, 1736], [1.98, 3690, 55], [2.04, 3667, 76], [2.07, 3635, 58], [2.11, 7196, 86], [2.16, 3435, 54], [2.21, 3480, 54], [2.28, 4782, 946], [2.31, 3299, 55], [2.39, 3202, 74]].map(([wave, flux_uJy, err_uJy]) => ({ wave, flux_uJy, err_uJy }));
  assert.equal(findDip(real), null);
  const text = describeSpectrum(real);
  assert.ok(!/a dip of/.test(text), text);
  assert.match(text, /17 points from 1\.7 to 2\.4 micrometres\. 2 points stand apart from the neighbouring ones and are left out of this description; a source that varies or moves/);
  const pts = dipStar().map((p) => ({ wave: p.wave, flux: p.flux_uJy, err: p.err_uJy }));
  assert.equal(despike(pts).length, pts.length, 'a smooth spectrum with a real band loses nothing');
  const spiked = pts.map((p, i) => (i === 40 ? { ...p, flux: p.flux * 2 } : i === 70 ? { ...p, flux: p.flux * 0.4 } : p));
  assert.equal(despike(spiked).length, pts.length - 2);
  assert.deepEqual(despike([]), []);
  // Every note is still played: the sound follows the data as measured.
  assert.equal(spectrumToNotes(real).notes.length, 17);
});

test('describeSpectrum handles smooth, faint and missing spectra', () => {
  assert.match(describeSpectrum(spectrum((w) => planck(w, 6000))), /^Brightest near 0\.[78]\d? micrometres, fading towards longer wavelengths\. 102 points/);
  assert.match(describeSpectrum(spectrum((w) => w ** 2)), /^Brightest near (4\.9|5\.0) micrometres, brightening towards longer wavelengths\./);
  assert.match(describeSpectrum(spectrum(() => 1)), /about as bright at both ends/);
  assert.equal(describeSpectrum(spectrum(() => 1)), 'No clear peak: about as bright at both ends. 102 points from 0.75 to 5.0 micrometres.');
  assert.match(describeSpectrum(spectrum(() => 1, { peak: 20, err: 30 })), /Faint: most points are close to the noise/);
  assert.equal(describeSpectrum([]), 'No spectrum has been measured for this source yet.');
  assert.equal(describeSpectrum(null), 'No spectrum has been measured for this source yet.');
  assert.match(describeSpectrum(WAVES.map((wave) => ({ wave, flux_uJy: -1, err_uJy: 1 }))), /^No clear signal/);
  for (const make of [coolStar, dipStar, tDwarf]) assert.ok(!/!/.test(describeSpectrum(make())));
});

test('describeLightCurve reports a change with dates, or steadiness', () => {
  assert.equal(monthYear(60850), 'June 2025');
  assert.equal(monthYear(61040), 'December 2025');
  assert.equal(describeLightCurve(lightCurve([1, 2, 1])), '3 survey passes, 60 measurements. Brightest in December 2025: 2.0 times the level of June 2025, the faintest pass.');
  assert.equal(describeLightCurve(lightCurve([1, 1.3])), '2 survey passes, 40 measurements. Brightest in December 2025: 30 percent above the level of June 2025, the faintest pass.');
  assert.match(describeLightCurve(lightCurve([1, 1.02, 0.99])), /Steady: the passes agree to within 3 percent\.$/);
  assert.match(describeLightCurve(lightCurve([1])), /^1 survey pass, 20 measurements\. One pass cannot show/);
  assert.equal(describeLightCurve([]), 'No light curve has been measured for this source yet.');
  // A faint source whose passes differ by less than their scatter is not said to have changed.
  const noisy = [];
  [60840, 61025].forEach((start, k) => {
    for (let i = 0; i < 12; i++) noisy.push({ mjd: start + i * 0.4, ratio: (k ? 1.2 : 1) + 0.9 * Math.sin(i * 2.3 + k), err: 0.8 });
  });
  assert.match(describeLightCurve(noisy), /^2 survey passes, 24 measurements\. No change that stands clear of the noise/);
});

// ---- synth, against a fake AudioContext -------------------------------------------------------

function fakeAudio() {
  const log = { oscillators: [], gains: [], resumed: 0, closed: 0, compressors: 0 };
  const param = (value = 0) => ({
    value,
    events: [],
    setValueAtTime(v, t) {
      this.events.push(['set', v, t]);
      this.value = v;
    },
    linearRampToValueAtTime(v, t) {
      this.events.push(['linear', v, t]);
    },
    exponentialRampToValueAtTime(v, t) {
      assert.ok(v > 0, 'exponential ramps cannot reach zero');
      this.events.push(['exp', v, t]);
    },
    setTargetAtTime(v, t, c) {
      this.events.push(['target', v, t, c]);
      this.value = v;
    },
    cancelScheduledValues(t) {
      this.events.push(['cancel', t]);
    },
  });
  const node = (extra) => ({ connected: [], connect(to) { this.connected.push(to); return to; }, disconnect() { this.disconnected = true; }, ...extra });
  const ctx = {
    state: 'suspended',
    currentTime: 10,
    destination: node({ name: 'destination' }),
    resume() {
      log.resumed++;
      ctx.state = 'running';
      return Promise.resolve();
    },
    close() {
      log.closed++;
      return Promise.resolve();
    },
    createGain() {
      const g = node({ gain: param(1) });
      log.gains.push(g);
      return g;
    },
    createOscillator() {
      const o = node({ type: 'sine', frequency: param(440), started: null, stopped: null, start(t) { this.started = t; }, stop(t) { this.stopped = t === undefined ? 'now' : t; } });
      log.oscillators.push(o);
      return o;
    },
    createDynamicsCompressor() {
      log.compressors++;
      return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
    },
  };
  return { ctx, log };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the synth is lazy, schedules one oscillator per note and reports the cursor', async () => {
  const { ctx, log } = fakeAudio();
  let made = 0;
  const synth = createSynth({ contextFactory: () => { made++; return ctx; } });
  assert.equal(synth.available, true);
  assert.equal(made, 0, 'no AudioContext before the first play');
  assert.equal(synth.stats().context, 'none');

  const plan = { notes: [{ t: 0, dur: 0.05, freq: 330, gain: 1, timbre: 'sine' }, { t: 0.04, dur: 0.05, freq: 440, gain: 0.2, timbre: 'triangle' }, { t: 0.08, dur: 0.05, freq: 99999, gain: 5 }], duration: 0.13 };
  const seen = [];
  let ended = null;
  const result = synth.play(plan, { onNote: (note, i) => seen.push(i), onEnd: (e) => { ended = e; } });
  assert.deepEqual(result, { ok: true, scheduled: 3, duration: 0.13 });
  assert.equal(made, 1);
  assert.equal(log.resumed, 1);
  assert.equal(log.compressors, 1, 'a limiter sits before the output');
  assert.equal(log.oscillators.length, 3);
  assert.equal(synth.playing, true);
  const [a, b, c] = log.oscillators;
  assert.ok(Math.abs(a.started - 10.06) < 1e-9 && Math.abs(b.started - 10.1) < 1e-9);
  assert.ok(a.stopped > a.started + 0.05);
  assert.equal(a.type, 'sine');
  assert.equal(b.type, 'triangle');
  assert.deepEqual(a.frequency.events[0].slice(0, 2), ['set', 330]);
  assert.equal(c.frequency.events[0][1], 4000, 'frequencies are clamped');
  // Envelope: silent start, quick attack, exponential decay, silent end; loudness follows gain.
  const env = (osc) => osc.connected[0].gain.events;
  assert.deepEqual(env(a).map((e) => e[0]), ['set', 'linear', 'exp', 'set']);
  assert.equal(env(a)[0][1], 0);
  assert.ok(env(a)[1][1] > env(b)[1][1] * 4);
  assert.ok(env(c)[1][1] <= 0.5, 'gain is clamped');
  assert.equal(env(a)[3][1], 0);

  await sleep(260);
  assert.deepEqual(seen, [0, 1, 2]);
  assert.deepEqual(ended, { completed: true });
  assert.equal(synth.playing, false);
  assert.deepEqual(synth.stats(), { available: true, plays: 1, scheduled: 3, playing: false, context: 'running', error: '' });
  synth.dispose();
  assert.equal(log.closed, 1);
});

test('stop fades the performance out and a new play replaces the old one', async () => {
  const { ctx, log } = fakeAudio();
  const synth = createSynth({ contextFactory: () => ctx });
  const long = { notes: [{ t: 0, dur: 0.2, freq: 220, gain: 1 }, { t: 5, dur: 0.2, freq: 330, gain: 1 }], duration: 5.2 };
  const ends = [];
  synth.play(long, { onEnd: (e) => ends.push(e) });
  const bus = log.oscillators[0].connected[0].connected[0];
  synth.stop({ fadeMs: 20 });
  assert.equal(synth.playing, false);
  assert.deepEqual(ends, [{ completed: false }]);
  assert.deepEqual(bus.gain.events.map((e) => e[0]), ['cancel', 'set', 'linear']);
  assert.equal(bus.gain.events[2][1], 0, 'fades to silence');
  assert.ok(bus.gain.events[2][2] > 10, 'over a short time, not at once');
  await sleep(90);
  assert.ok(log.oscillators.every((o) => o.stopped === 'now'), 'voices are released after the fade');
  assert.equal(bus.disconnected, true);
  synth.stop(); // idle: nothing happens
  synth.play(long, { onEnd: (e) => ends.push(e) });
  synth.play(long, { onEnd: (e) => ends.push(e) });
  assert.deepEqual(ends, [{ completed: false }, { completed: false }]);
  assert.equal(synth.stats().plays, 3);
  synth.setVolume(0.5);
  assert.equal(synth.volume, 0.5);
  synth.setVolume(7);
  assert.equal(synth.volume, 1);
  synth.setVolume('x');
  assert.equal(synth.volume, 1);
  synth.dispose();
  assert.equal(synth.playing, false);
});

test('the synth is safe when audio is unavailable or refuses to start', () => {
  const none = createSynth({ win: {} });
  assert.equal(none.available, false);
  assert.deepEqual(none.play({ notes: [{ t: 0, dur: 1, freq: 440, gain: 1 }] }), { ok: false, scheduled: 0, duration: 0, reason: NO_AUDIO_REASON });
  none.stop();
  none.setVolume(0.3);
  none.dispose();
  assert.equal(none.stats().context, 'none');

  const broken = createSynth({ contextFactory: () => { throw new Error('blocked by policy'); } });
  const r = broken.play({ notes: [{ t: 0, dur: 1, freq: 440, gain: 1 }] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Sound could not be started: blocked by policy/);

  const { ctx } = fakeAudio();
  const ok = createSynth({ contextFactory: () => ctx });
  assert.equal(ok.play({ notes: [] }).ok, false);
  assert.equal(ok.play(null).reason, 'There is nothing to play.');
  ctx.createOscillator = () => { throw new Error('no oscillators today'); };
  assert.match(ok.play({ notes: [{ t: 0, dur: 1, freq: 440, gain: 1 }] }).reason, /could not be scheduled/);
  assert.equal(ok.playing, false);
});
