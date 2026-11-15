// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Time helpers.
//
// CONVENTIONS
// * Times are MJD in UTC days, as plain numbers. MJD = JD - 2400000.5; MJD 40587.0 is the Unix
//   epoch 1970-01-01T00:00:00Z. Leap seconds are ignored (JS Date does the same), which is far
//   below anything this tool can measure.
// * "Year" is the JULIAN EPOCH: year = 2000.0 + (MJD - 51544.5) / 365.25, so J2000.0 is
//   MJD 51544.5 and Gaia's reference epoch 2016.0 is MJD 57388.5. This is the right clock for
//   proper motion. It differs from "fraction of the calendar year" by up to about 1.5 days,
//   so do not use it to print dates; use mjdToIso / formatDateShort for that.
// * All formatting is in UTC.

export const MJD_UNIX_EPOCH = 40587;
export const MJD_J2000 = 51544.5;
export const DAYS_PER_JULIAN_YEAR = 365.25;
const MS_PER_DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(v) {
  return v < 10 ? `0${v}` : String(v);
}

function pad4(v) {
  const s = String(Math.abs(v));
  return (v < 0 ? '-' : '') + '0000'.slice(Math.min(4, s.length)) + s;
}

/** MJD -> JS Date (invalid Date for non-finite input). */
export function mjdToDate(mjd) {
  return new Date(Number.isFinite(mjd) ? Math.round((mjd - MJD_UNIX_EPOCH) * MS_PER_DAY) : NaN);
}

/** JS Date (or anything Date accepts) -> MJD. */
export function dateToMjd(date) {
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  return t / MS_PER_DAY + MJD_UNIX_EPOCH;
}

/** MJD -> 'YYYY-MM-DD HH:MM' in UTC, rounded to the nearest minute. '' for non-finite input. */
export function mjdToIso(mjd) {
  if (!Number.isFinite(mjd)) return '';
  const ms = Math.round(((mjd - MJD_UNIX_EPOCH) * MS_PER_DAY) / 60000) * 60000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** ISO-8601 string such as FITS DATE-OBS '2026-06-19T19:01:07.407' (UTC assumed) -> MJD, or NaN. */
export function isoToMjd(text) {
  if (typeof text !== 'string') return NaN;
  let s = text.trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z';
  const t = Date.parse(s);
  return Number.isFinite(t) ? t / MS_PER_DAY + MJD_UNIX_EPOCH : NaN;
}

/** MJD -> Julian epoch as a decimal year (J2000.0 = MJD 51544.5). */
export function mjdToYear(mjd) {
  return 2000 + (mjd - MJD_J2000) / DAYS_PER_JULIAN_YEAR;
}

/** Julian epoch (decimal year) -> MJD. Exact inverse of mjdToYear. */
export function yearToMjd(year) {
  return MJD_J2000 + (year - 2000) * DAYS_PER_JULIAN_YEAR;
}

/** MJD -> '2026 Jun 19' (UTC calendar date). '' for non-finite input. */
export function formatDateShort(mjd) {
  const d = mjdToDate(mjd);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Signed elapsed days from mjdA to mjdB (mjdB - mjdA). */
export function daysBetween(mjdA, mjdB) {
  return mjdB - mjdA;
}

/** Current time as MJD. */
export function mjdNow() {
  return Date.now() / MS_PER_DAY + MJD_UNIX_EPOCH;
}
