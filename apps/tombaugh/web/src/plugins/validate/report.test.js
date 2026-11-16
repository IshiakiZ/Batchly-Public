// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests of report.js: rows, Markdown and JSON, on measurements of a made-up field. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeLayers, makeFakeField } from './fakefield.js';
import { measureField, measureTarget } from './measure.js';
import { fieldRows, fmt, fmtSigned, fmtValErr, releasesOf, toJson, toMarkdown, toRows } from './report.js';

const field = makeFakeField({ seed: 11 });
const base = { grid: field.grid, layersByDet: fakeLayers(field), frames: field.frames, gaia: field.gaia };
const good = await measureField({ ...base, target: field.target });
const MID = field.truth.passMjds[1] + 1;
const years = 2000 + (MID - 51544.5) / 365.25 - 2016;
const wrongCat = { ...field.truth.mover.star, epoch: 2016, pmdec: 8000, source: 'test', dec: field.truth.mover.star.dec + ((field.truth.mover.pmdec - 8000) * years) / 3.6e6 };
const wrong = await measureTarget({ ...base, target: field.target, catalogue: wrongCat, parts: ['motion'] });
const missing = { noData: true, target: { name: 'WISE 0855-0714', ra: 133.78, dec: -7.24 }, reason: 'the archive lists no exposures of this position on detector 6' };
const meta = { version: '1.2.3', generatedAt: '2026-11-15T08:00:00Z' };

test('number formatting', () => {
  assert.equal(fmt(-1.234, 2), '−1.23');
  assert.equal(fmt(NaN), '');
  assert.equal(fmtSigned(0.44, 1), '+0.4');
  assert.equal(fmtSigned(-0.44, 1), '−0.4');
  assert.equal(fmtValErr(10323.4, 134.2, 'mas/yr'), '10323 ± 134 mas/yr');
  assert.equal(fmtValErr(1.98912, 0.0312), '1.989 ± 0.031');
  assert.equal(fmtValErr(NaN, 1), 'not measured');
});

test('toRows: groups, strings and no flags when measurement and catalogue agree', () => {
  const rows = toRows(good);
  const groups = [...new Set(rows.map((r) => r.group))];
  assert.deepEqual(groups, ['Motion', 'Brightness', 'Spectrum', 'Data', 'Noise']);
  for (const r of rows) {
    for (const key of ['label', 'measured', 'reference', 'difference', 'sigmaText', 'note']) assert.equal(typeof r[key], 'string');
    assert.ok(r.sigma === null || Number.isFinite(r.sigma));
    assert.ok(!/NaN|undefined|null/.test(r.measured + r.reference + r.difference), r.label + ': ' + r.measured);
  }
  const total = rows.find((r) => r.label === 'Proper motion, total');
  assert.match(total.measured, /± \d+ mas\/yr$/);
  assert.match(total.reference, /mas\/yr$/);
  assert.equal(rows.filter((r) => r.flag).length, 0);
  assert.ok(rows.some((r) => /none detected/.test(r.measured)), 'a non-detection is called one');
});

test('toRows: a disagreement beyond 3 sigma is flagged, and only that', () => {
  const rows = toRows(wrong);
  const flagged = rows.filter((r) => r.flag).map((r) => r.label);
  assert.ok(flagged.includes('Proper motion, total'));
  assert.ok(flagged.includes('Proper motion, north'));
  assert.ok(!flagged.includes('Proper motion, east'));
  for (const r of rows) assert.equal(r.flag, r.sigma !== null && Math.abs(r.sigma) > 3);
});

test('toRows and fieldRows on missing data', () => {
  const rows = toRows(missing);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].measured, 'none');
  assert.match(rows[0].note, /no exposures/);
  assert.equal(toRows({}).length > 0, true);
  assert.equal(toRows(null).length > 0, true);
  const fr = fieldRows(null);
  assert.equal(fr.length, 1);
  assert.equal(fr[0].measured, 'not measured');
  assert.ok(fieldRows(good.field).length >= 5);
});

test('toMarkdown: header, how to read it, tables, field stars, honest wording', () => {
  const md = toMarkdown([good, missing], meta);
  assert.match(md, /^# Tombaugh validation report/);
  assert.match(md, /Generated 2026-11-15 08:00 UTC by Tombaugh 1\.2\.3/);
  assert.match(md, /DR1 \(16 exposures\), QR3 \(8 exposures\)/);
  assert.match(md, /## How to read this/);
  assert.match(md, /synthetic test data/);
  assert.match(md, /\| Quantity \| Measured \| Catalogue or expected \| Difference \| Sigma \|/);
  assert.match(md, /### Field stars around /);
  assert.match(md, /Alignment: /);
  assert.match(md, /Null test: /);
  assert.match(md, /## WISE 0855-0714\n\nRA 133\.78000, Dec −7\.24000 deg \(ICRS\)\. No data: the archive lists no exposures.*Nothing was measured\./);
  assert.ok(!md.includes('!'), 'no exclamation marks');
  assert.ok(!/NaN|undefined|\[object/.test(md));
  assert.match(toMarkdown([wrong], meta), /\*\*[+−]\d+\.\d\*\* \(over 3\)/);
  assert.match(toMarkdown([], meta), /Nothing has been measured yet\./);
  assert.match(toMarkdown([{ ...good, partial: 'nothing arrived for 90 s' }], meta), /Partial data: nothing arrived for 90 s\./);
});

test('toJson survives JSON.stringify and keeps the numbers', () => {
  const obj = toJson([good, missing], meta);
  const text = JSON.stringify(obj);
  const back = JSON.parse(text);
  assert.equal(back.kind, 'tombaugh-validation-report');
  assert.equal(back.schema, 1);
  assert.equal(back.version, '1.2.3');
  assert.equal(back.generatedAt, '2026-11-15T08:00:00.000Z');
  assert.deepEqual(back.releases, { dr1: 16, qr3: 8 });
  assert.equal(back.measurements.length, 2);
  assert.equal(back.measurements[0].motion.measured.total, good.motion.measured.total);
  assert.ok(Array.isArray(back.measurements[0].rows) && back.measurements[0].rows.length > 5);
  assert.ok(Array.isArray(back.measurements[0].fieldRows));
  assert.equal(back.measurements[1].noData, true);
  assert.ok(!/NaN|Infinity/.test(text));
  assert.deepEqual(toJson([{ x: NaN, y: new Float32Array([1, 2]), f: () => 1 }]).measurements[0].y, [1, 2]);
  assert.deepEqual(releasesOf([good, good]), { dr1: 32, qr3: 16 });
});
