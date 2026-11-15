// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIMPLE_VIEW_INFO, PLAIN_TARGETS, plainCandidate, plainSetAside, plainMotion, plainBrightness, plainVisits, plainLabel, plainTarget, strengthWord,
} from './simple.js';
import { SIMPLE_VIEWS } from '../state.js';
import { TARGETS } from '../core/targets.js';
import { motionVerdict } from '../plots/motion.js';
import { lightCurveVerdict } from '../plots/lightcurve.js';

test('the switch offers exactly the views state.js calls simple', () => {
  assert.deepEqual(SIMPLE_VIEW_INFO.map((v) => v.id), [...SIMPLE_VIEWS]);
  for (const v of SIMPLE_VIEW_INFO) assert.ok(v.label && v.hint.length > 20, v.id);
});

test('every built-in target has a plain description, and no description is orphaned', () => {
  const ids = TARGETS.map((t) => t.id);
  for (const id of ids) assert.ok(PLAIN_TARGETS[id] && PLAIN_TARGETS[id].what && PLAIN_TARGETS[id].look, id);
  for (const id of Object.keys(PLAIN_TARGETS)) assert.ok(ids.includes(id), id);
  for (const t of TARGETS.filter((x) => x.challenge)) assert.ok(PLAIN_TARGETS[t.id].found, `${t.id} needs its measured result in plain words`);
});

test('plainTarget swaps the card text and keeps everything else', () => {
  const t = TARGETS.find((x) => x.id === 'barnard');
  const p = plainTarget(t);
  assert.equal(p.blurb, PLAIN_TARGETS.barnard.what);
  assert.equal(p.why, PLAIN_TARGETS.barnard.look);
  assert.equal(p.found, PLAIN_TARGETS.barnard.found);
  assert.equal(p.ra, t.ra);
  assert.equal(p.pmdec, t.pmdec);
  assert.equal(p.name, t.name);
  const other = { id: 'nowhere', name: 'X', blurb: 'b' };
  assert.equal(plainTarget(other), other);
});

test('the plain numbers match the measured results on the target cards', () => {
  // Guards against the two texts drifting apart: each number quoted in plain words must be in
  // (or be the rounding of a number in) the technical line.
  const found = (id) => TARGETS.find((t) => t.id === id).found;
  assert.match(found('barnard'), /11\.9/);
  assert.match(PLAIN_TARGETS.barnard.found, /11\.9/);
  assert.match(found('barnard'), /10\.4/);
  assert.match(PLAIN_TARGETS.barnard.found, /10\.4/);
  assert.match(found('eps-indi-b'), /4\.51/);
  assert.match(PLAIN_TARGETS['eps-indi-b'].found, /4\.5 /);
  assert.match(found('eps-indi-b'), /60 %/);
  assert.match(PLAIN_TARGETS['eps-indi-b'].found, /60 %/);
  assert.match(found('wise0855'), /8\.0/);
  assert.match(PLAIN_TARGETS.wise0855.found, /8\.0/);
  assert.match(found('rw-aur'), /40 %/);
  assert.match(PLAIN_TARGETS['rw-aur'].found, /40 %/);
  assert.match(found('r-dra'), /28 %/);
  assert.match(PLAIN_TARGETS['r-dra'].found, /28 %/);
});

test('strengthWord', () => {
  assert.equal(strengthWord(31.3), 'We are very sure');
  assert.equal(strengthWord(10), 'We are very sure');
  assert.equal(strengthWord(7.4), 'We are fairly sure');
  assert.equal(strengthWord(5.2), 'We are not so sure');
  assert.equal(strengthWord(NaN), '');
  assert.equal(strengthWord(undefined), '');
});

test('plainCandidate: movers, brightness changes and saturated stars', () => {
  assert.equal(plainCandidate({ kind: 'moved', score: 12 }).title, 'Something moved');
  const up = plainCandidate({ kind: 'varies', score: 8, net: { onSource: true, frac: 0.4, sigma: 11, label: 'Mar 2026' } });
  assert.equal(up.title, 'Something got brighter');
  assert.equal(up.detail, 'Its light rose by about 40 % in Mar 2026.');
  assert.equal(up.strength, 'We are fairly sure');
  const down = plainCandidate({ kind: 'varies', score: 5.5, net: { onSource: true, frac: -0.072, sigma: 6 } });
  assert.equal(down.title, 'Something got fainter');
  assert.equal(down.detail, 'Its light fell by about 7.2 %.');
  assert.equal(down.strength, 'We are not so sure');
  // A net-light figure that is not on the source is not quoted.
  assert.equal(plainCandidate({ kind: 'varies', net: { onSource: false, frac: 0.4 } }).title, 'Something changed brightness');
  assert.equal(plainCandidate({ kind: 'other' }).title, 'Something changed');
  assert.equal(plainCandidate(null).title, 'Something changed');

  const sat = plainCandidate({ kind: 'moved', saturated: true, towards: 'north', between: ['Sep 2025', 'Sep 2026'], score: 10.3 });
  assert.equal(sat.title, 'A bright star moved');
  assert.equal(sat.detail, 'Its glare shifted north between Sep 2025 and Sep 2026.');
  assert.equal(sat.caution, '');
  const turned = plainCandidate({ kind: 'varies', saturated: true, brighter: true, between: ['Sep 2025', 'Mar 2026'], turned: true, score: 19.2 });
  assert.equal(turned.title, 'A bright star got brighter');
  assert.match(turned.detail, /between Sep 2025 and Mar 2026/);
  assert.match(turned.caution, /turned the other way round/);
  assert.equal(plainCandidate({ saturated: true, brighter: false }).title, 'A bright star got fainter');
  assert.equal(plainCandidate({ saturated: true }).title, 'A bright star changed');
});

test('plainSetAside', () => {
  assert.equal(plainSetAside([]), '');
  assert.equal(plainSetAside(Object.assign([], { setAside: 1 })), '1 smudge left by very bright stars was ignored.');
  assert.equal(plainSetAside(Object.assign([], { setAside: 2, setAsideEdge: 1 })), '3 smudges left by very bright stars or at the edge of the pictures were ignored.');
  assert.equal(plainSetAside(Object.assign([], { setAsideEdge: 2 })), '2 smudges at the edge of the pictures were ignored.');
});

test('plainMotion follows the real motion verdict, kind by kind', () => {
  const run = (measured, gaia, opts) => plainMotion(motionVerdict(measured, gaia, opts));
  // Barnard's Star as measured: agrees with Gaia.
  const agree = run({ pmra: -1037, pmdec: 11855, total: 11900, errTotal: 2400 }, { pmra: -802, pmdec: 10362, total: 10393 });
  assert.equal(agree.answer, 'Yes');
  assert.equal(agree.tone, 'yes');
  assert.match(agree.gloss, /star charts/);
  // A catalogue row instead of Gaia is named as such.
  const table = run({ pmra: 3700, pmdec: -2600, total: 4510, errTotal: 650 }, { pmra: 3960, pmdec: -2540, total: 4700, source: 'catalogue' });
  assert.equal(table.answer, 'Yes');
  assert.match(table.gloss, /astronomers have published/);
  // Short of a detection, but as catalogued: probably.
  const weak = run({ pmra: -2000, pmdec: 700, total: 2120, errTotal: 760 }, { pmra: -2760, pmdec: 360, total: 2780 });
  assert.equal(weak.answer, 'Probably');
  assert.equal(weak.tone, 'maybe');
  // Nothing moved.
  const still = run({ pmra: 30, pmdec: -20, total: 36, errTotal: 300 }, null);
  assert.equal(still.answer, 'No');
  assert.equal(still.tone, 'no');
  // Moves, no catalogue star.
  const odd = run({ pmra: 5000, pmdec: 0, total: 5000, errTotal: 400 }, null);
  assert.equal(odd.answer, 'Yes');
  assert.match(odd.gloss, /no known star/);
  // Moves, and not as the catalogue says.
  const differ = run({ pmra: 5000, pmdec: 0, total: 5000, errTotal: 300 }, { pmra: 0, pmdec: 100, total: 100 });
  assert.equal(differ.answer, 'Yes');
  assert.match(differ.gloss, /something else/);
  // Should have moved and did not.
  const missing = run({ pmra: 10, pmdec: 10, total: 14, errTotal: 300 }, { pmra: 9000, pmdec: 0, total: 9000 });
  assert.equal(missing.answer, 'Not that we can see');
  // One visit only.
  const few = run(null, null, { passes: 1 });
  assert.equal(few.tone, 'none');
  assert.match(few.gloss, /two visits/);
  assert.equal(plainMotion(null).tone, 'none');
});

test('plainBrightness follows the real light-curve verdict, kind by kind', () => {
  const pass = (mjd, ratio, n = 8) => Array.from({ length: n }, (_, i) => ({ mjd: mjd + i * 0.1, ratio, err: 0.02 * ratio, value: ratio, flux: ratio }));
  const kinds = new Set();
  const say = (points) => {
    const v = lightCurveVerdict(points);
    kinds.add(v.kind);
    return { v, p: plainBrightness(v) };
  };
  const none = say([]);
  assert.equal(none.p.tone, 'none');
  assert.equal(plainBrightness({ kind: 'single' }).answer, 'Can’t tell yet');
  assert.equal(plainBrightness({ kind: 'changed', direction: 'rose' }).answer, 'Yes, it got brighter');
  assert.equal(plainBrightness({ kind: 'changed', direction: 'fell' }).answer, 'Yes, it got fainter');
  assert.equal(plainBrightness({ kind: 'changed' }).tone, 'yes');
  assert.equal(plainBrightness({ kind: 'possible' }).answer, 'Maybe');
  assert.equal(plainBrightness({ kind: 'steady' }).answer, 'No');
  assert.equal(plainBrightness({ kind: 'noisy' }).answer, 'Can’t tell');
  assert.equal(plainBrightness(undefined).tone, 'none');
  // Whatever kind the real function returns for real-shaped input, there is an answer for it.
  for (const pts of [pass(60900, 1), [...pass(60900, 1), ...pass(61080, 1.4)], [...pass(60900, 1), ...pass(61080, 1.0)]]) {
    const { v, p } = say(pts);
    assert.ok(['empty', 'single', 'changed', 'possible', 'steady', 'noisy'].includes(v.kind), v.kind);
    assert.ok(p.answer && p.gloss);
  }
});

test('plainVisits', () => {
  assert.equal(plainVisits([]), '');
  assert.equal(plainVisits(null), '');
  assert.equal(plainVisits([{ label: 'Jun 2025', total: 14 }]), '14 photos from 1 visit by NASA’s SPHEREx space telescope: Jun 2025.');
  assert.equal(
    plainVisits([{ label: 'Jun 2025', total: 14 }, { label: 'Dec 2025', total: 14 }, { label: 'Jun 2026', total: 14 }]),
    '42 photos from 3 visits by NASA’s SPHEREx space telescope: Jun 2025, Dec 2025 and Jun 2026.',
  );
  assert.equal(plainVisits([{ label: 'Jun 2025', total: 1 }]), '1 photo from 1 visit by NASA’s SPHEREx space telescope: Jun 2025.');
});

test('plainLabel', () => {
  assert.equal(plainLabel(''), 'The star you clicked');
  assert.equal(plainLabel('Gaia star'), 'The star you clicked');
  assert.equal(plainLabel('Clicked source'), 'The star you clicked');
  assert.equal(plainLabel('Candidate 2'), 'Number 2 on the list');
  assert.equal(plainLabel('Moving source'), 'The moving thing you clicked');
  assert.equal(plainLabel("Barnard's Star"), "Barnard's Star");
});
