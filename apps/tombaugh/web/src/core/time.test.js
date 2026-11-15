// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests for time.js. Run: node --test web/src/core/time.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mjdToDate,
  dateToMjd,
  mjdToIso,
  isoToMjd,
  mjdToYear,
  yearToMjd,
  formatDateShort,
  daysBetween,
  mjdNow,
} from './time.js';

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || 'value'}: got ${actual}, expected ${expected} +/- ${tol}`);
}

test('mjdToDate: known epochs', () => {
  assert.equal(mjdToDate(40587).toISOString(), '1970-01-01T00:00:00.000Z');
  assert.equal(mjdToDate(51544.5).toISOString(), '2000-01-01T12:00:00.000Z');
  assert.equal(mjdToDate(51544).toISOString(), '2000-01-01T00:00:00.000Z');
  assert.equal(mjdToDate(0).toISOString(), '1858-11-17T00:00:00.000Z');
  // Real SPHEREx header: DATE-OBS = '2026-06-19T19:01:07.407', MJD-OBS = 61210.79244684.
  assert.equal(mjdToDate(61210.79244684).toISOString(), '2026-06-19T19:01:07.407Z');
  assert.ok(Number.isNaN(mjdToDate(NaN).getTime()));
  assert.ok(Number.isNaN(mjdToDate(undefined).getTime()));
});

test('mjdToIso and formatDateShort use UTC and match the real header', () => {
  assert.equal(mjdToIso(61210.79244684), '2026-06-19 19:01');
  assert.equal(formatDateShort(61210.79244684), '2026 Jun 19');
  assert.equal(mjdToIso(61210.79311303), '2026-06-19 19:02'); // MJD-AVG, 19:02:05
  assert.equal(mjdToIso(51544), '2000-01-01 00:00');
  assert.equal(formatDateShort(51544), '2000 Jan 1');
  assert.equal(formatDateShort(60800), '2025 May 5'); // early in the survey
  // Rounds to the nearest minute, carrying into the next day and year.
  assert.equal(mjdToIso(51544 - 20 / 86400), '2000-01-01 00:00');
  assert.equal(mjdToIso(51544 - 40 / 86400), '1999-12-31 23:59');
  assert.equal(formatDateShort(51544 - 1 / 86400), '1999 Dec 31');
  assert.equal(mjdToIso(NaN), '');
  assert.equal(formatDateShort(NaN), '');
  assert.equal(mjdToIso(Infinity), '');
});

test('isoToMjd and dateToMjd invert the formatting', () => {
  close(isoToMjd('2026-06-19T19:01:07.407'), 61210.79244684, 1e-8, 'DATE-OBS');
  close(isoToMjd('2026-06-19T19:01:07.407Z'), 61210.79244684, 1e-8);
  close(isoToMjd('2026-06-19 19:01'), 61210.79236111, 1e-8);
  assert.equal(isoToMjd('2000-01-01'), 51544);
  assert.equal(isoToMjd('2000-01-01T12:00:00+00:00'), 51544.5);
  assert.ok(Number.isNaN(isoToMjd('not a date')));
  assert.ok(Number.isNaN(isoToMjd(null)));
  assert.equal(dateToMjd(new Date('1970-01-01T00:00:00Z')), 40587);
  for (const mjd of [40587, 51544.5, 60800.123456, 61210.79244684]) {
    close(dateToMjd(mjdToDate(mjd)), mjd, 1e-8, 'round trip to the millisecond');
  }
});

test('mjdToYear / yearToMjd: Julian epoch, exact inverse', () => {
  assert.equal(mjdToYear(51544.5), 2000);
  assert.equal(yearToMjd(2000), 51544.5);
  assert.equal(yearToMjd(2016), 57388.5); // Gaia DR3 reference epoch J2016.0
  assert.equal(mjdToYear(57388.5), 2016);
  assert.equal(yearToMjd(2015.5), 57205.875); // Gaia DR2 epoch
  close(mjdToYear(61210.79244684), 2000 + 9666.29244684 / 365.25, 1e-9);
  close(mjdToYear(61210.79244684), 2026.46487, 1e-5);
  for (const y of [1991.25, 2000, 2016, 2025.37, 2026.4635]) close(mjdToYear(yearToMjd(y)), y, 1e-10);
  for (const m of [48348.5, 51544.5, 60800, 61210.79244684]) close(yearToMjd(mjdToYear(m)), m, 1e-7);
  // One Julian year is exactly 365.25 days.
  assert.equal(yearToMjd(2001) - yearToMjd(2000), 365.25);
  // Within about a day and a half of the calendar-year fraction.
  const cal = 2026 + (61210.79244684 - 61041) / 365; // MJD 61041 = 2026-01-01
  assert.equal(mjdToIso(61041), '2026-01-01 00:00');
  close(mjdToYear(61210.79244684), cal, 2 / 365);
});

test('daysBetween is signed (b - a); mjdNow is sane', () => {
  assert.equal(daysBetween(61000, 61182.5), 182.5);
  assert.equal(daysBetween(61182.5, 61000), -182.5);
  assert.equal(daysBetween(60800, 60800), 0);
  assert.ok(Number.isNaN(daysBetween(NaN, 1)));
  const now = mjdNow();
  close(now, dateToMjd(new Date()), 1e-3);
  assert.ok(now > 60000 && now < 90000);
});
