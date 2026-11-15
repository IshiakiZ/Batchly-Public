// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The bodies the "Solar system" panel offers, and the locally computed ephemeris of a
// hypothetical one. Pure data and functions, no DOM.
//
// Each entry: id, name, kind, command (the JPL Horizons COMMAND value, the same strings as
// proxy/src/horizons.js so the proxy never has to guess), stepHours (how finely to sample the
// ephemeris: slow bodies 12 h, comets 6 h), blurb (one line on what it is), lookFor (what
// SPHEREx can show), bands (spectral features to mark on the spectrum, wavelengths in um) and
// optional flags: bright (may saturate), faint (needs stacking), coma (measure whether the
// source is wider than a star).
//
// Distances and magnitudes are round numbers for 2025-2026 to set expectations; the numbers the
// tool actually uses come from the ephemeris.

import { heliocentricFromApparent, keplerRate, predictedTrack } from '../../core/distance.js';
import { OBLIQUITY_J2000_DEG } from '../../core/ephemeris.js';

const DEG = Math.PI / 180;
/** First SPHEREx exposures (April 2025). */
export const SURVEY_START_MJD = 60770;

const CH4_ICE = [
  { wave: 0.89, label: 'CH4 ice', what: 'Methane ice, 0.89 um' },
  { wave: 1.16, label: 'CH4 ice', what: 'Methane ice, 1.16 um' },
  { wave: 1.38, label: 'CH4 ice', what: 'Methane ice, the bands at 1.33 and 1.40 um' },
  { wave: 1.72, label: 'CH4 ice', what: 'Methane ice, a group of bands near 1.7 um' },
  { wave: 2.3, label: 'CH4 ice', what: 'Methane ice, the strong bands at 2.2 to 2.4 um' },
  { wave: 3.3, label: 'CH4 ice', what: 'Methane ice, the deep band at 3.3 um' },
];
const H2O_ICE = [
  { wave: 1.5, label: 'H2O ice', what: 'Water ice, 1.5 um' },
  { wave: 2.0, label: 'H2O ice', what: 'Water ice, 2.0 um' },
  { wave: 3.05, label: 'H2O ice', what: 'Water ice, the broad band at 3 um' },
];
const HYDRATION = [
  { wave: 2.72, label: 'OH', what: 'Water bound in clay minerals, 2.7 um' },
  { wave: 3.06, label: 'NH4', what: 'Ammonium-bearing clays, 3.06 um' },
];

export const BODIES = [
  {
    id: 'pluto',
    name: 'Pluto',
    kind: 'dwarf planet',
    command: '999',
    stepHours: 12,
    blurb: 'About 34 AU away at magnitude 14.4: visible in single exposures, in a crowded star field.',
    lookFor: 'Methane ice bands, the deepest near 1.7, 2.3 and 3.3 um. They are deep enough to show in single exposures; following the body across all of them draws the whole spectrum.',
    bands: CH4_ICE,
  },
  {
    id: 'ceres',
    name: 'Ceres',
    kind: 'dwarf planet',
    command: 'Ceres;',
    stepHours: 6,
    bright: true,
    blurb: 'The largest body in the asteroid belt, magnitude 7 to 9. Bright enough that some exposures may saturate.',
    lookFor: 'A 3 um hydration band from clay minerals, and beyond 4 um the glow of its own heat on top of reflected sunlight.',
    bands: [...HYDRATION, { wave: 3.95, label: 'CO3', what: 'Carbonates, 3.95 um' }],
  },
  {
    id: 'atlas3i',
    name: '3I/ATLAS',
    aliases: ['3I', 'C/2025 N1', 'ATLAS 3I', 'C/2025 N1 (ATLAS)'],
    kind: 'interstellar comet',
    command: 'DES=C/2025 N1;',
    stepHours: 6,
    coma: true,
    blurb: 'The third known object from another star system, found in July 2025. SPHEREx saw it that August, 2.7 AU from Earth at magnitude 17.8.',
    lookFor: 'Carbon dioxide gas at 4.27 um in a coma wider than a star. Compare the width of the stack in detector 5 with the other detectors.',
    bands: [
      { wave: 4.27, label: 'CO2', what: 'Carbon dioxide gas, 4.27 um' },
      { wave: 4.67, label: 'CO', what: 'Carbon monoxide gas, 4.67 um' },
      { wave: 3.05, label: 'H2O ice', what: 'Water ice grains in the coma, 3 um' },
    ],
  },
  {
    id: 'eris',
    name: 'Eris',
    kind: 'dwarf planet',
    command: '136199;',
    stepHours: 12,
    faint: true,
    blurb: 'About 95 AU away at magnitude 18.7: a little more massive than Pluto and almost three times as far.',
    lookFor: 'Methane ice, as on Pluto. Too faint for single exposures: it needs the stack.',
    bands: CH4_ICE,
  },
  {
    id: 'makemake',
    name: 'Makemake',
    kind: 'dwarf planet',
    command: '136472;',
    stepHours: 12,
    faint: true,
    blurb: 'About 53 AU away at magnitude 17.2, covered in methane frost.',
    lookFor: 'Methane ice bands, stronger than Pluto\'s. Faint: it needs the stack.',
    bands: CH4_ICE,
  },
  {
    id: 'haumea',
    name: 'Haumea',
    kind: 'dwarf planet',
    command: '136108;',
    stepHours: 12,
    faint: true,
    blurb: 'About 50 AU away at magnitude 17.4, elongated and turning once every 3.9 hours.',
    lookFor: 'Water ice at 1.5 and 2.0 um. Its brightness changes by a quarter as it turns, which adds scatter to the spectrum.',
    bands: H2O_ICE,
  },
  {
    id: 'quaoar',
    name: 'Quaoar',
    kind: 'dwarf planet',
    command: '50000;',
    stepHours: 12,
    faint: true,
    blurb: 'About 42 AU away at magnitude 18.8, a ringed body half the size of Pluto.',
    lookFor: 'Water ice at 1.5 and 2.0 um, if the stack reaches it.',
    bands: H2O_ICE,
  },
  {
    id: 'orcus',
    name: 'Orcus',
    kind: 'dwarf planet',
    command: '90482;',
    stepHours: 12,
    faint: true,
    blurb: 'About 48 AU away at magnitude 19.1, on an orbit like Pluto\'s but on the opposite side of the Sun.',
    lookFor: 'Water ice at 1.5 and 2.0 um, if the stack reaches it.',
    bands: H2O_ICE,
  },
  {
    id: 'gonggong',
    name: 'Gonggong',
    kind: 'dwarf planet',
    command: '225088;',
    stepHours: 12,
    faint: true,
    blurb: 'About 89 AU away at magnitude 21.4, one of the reddest large bodies known.',
    lookFor: 'Probably nothing: it is expected to stay below the stack. An honest upper limit is the result.',
    bands: CH4_ICE.slice(4),
  },
  {
    id: 'sedna',
    name: 'Sedna',
    kind: 'dwarf planet',
    command: 'Sedna;',
    stepHours: 12,
    faint: true,
    blurb: 'About 83 AU away at magnitude 20.8, on an 11,000-year orbit that never comes near Neptune.',
    lookFor: 'Probably too faint. A fair test of the limit: the stack either reaches it or says how close it came.',
    bands: CH4_ICE.slice(4),
  },
  {
    id: 'chiron',
    name: 'Chiron',
    kind: 'centaur',
    command: '2060;',
    stepHours: 12,
    faint: true,
    coma: true,
    blurb: 'A centaur between Saturn and Uranus, about 18 AU away at magnitude 18 to 19, with rings or a dust shell and occasional outbursts.',
    lookFor: 'Whether the stack is wider than a star, and carbon dioxide at 4.27 um.',
    bands: [
      { wave: 4.27, label: 'CO2', what: 'Carbon dioxide, 4.27 um' },
      { wave: 2.0, label: 'H2O ice', what: 'Water ice, 2.0 um' },
    ],
  },
  {
    id: 'vesta',
    name: 'Vesta',
    kind: 'asteroid',
    command: '4;',
    stepHours: 6,
    bright: true,
    blurb: 'The brightest asteroid, magnitude 6 to 8, with a basalt crust. Some exposures may saturate.',
    lookFor: 'Pyroxene bands near 0.9 and 1.9 um, the fingerprint of volcanic rock.',
    bands: [
      { wave: 0.92, label: 'pyroxene', what: 'Pyroxene, 0.9 um' },
      { wave: 1.95, label: 'pyroxene', what: 'Pyroxene, 1.9 um' },
    ],
  },
  {
    id: 'pallas',
    name: 'Pallas',
    kind: 'asteroid',
    command: '2;',
    stepHours: 6,
    bright: true,
    blurb: 'The third-largest asteroid, magnitude 8 to 10, on a steeply tilted orbit.',
    lookFor: 'A sharp 3 um hydration band.',
    bands: HYDRATION.slice(0, 1),
  },
  {
    id: 'hygiea',
    name: 'Hygiea',
    kind: 'asteroid',
    command: '10;',
    stepHours: 6,
    blurb: 'The fourth-largest asteroid, magnitude 10 to 12, dark and carbon-rich.',
    lookFor: 'A 3 um hydration band like the one on Ceres.',
    bands: HYDRATION,
  },
];

/** The entry for a body nobody has seen. Its ephemeris is built here, not by Horizons. */
export const HYPOTHETICAL = {
  id: 'hypothetical',
  name: 'Hypothetical body',
  kind: 'hypothetical',
  command: null,
  local: true,
  stepHours: 24,
  faint: true,
  blurb: 'Something not known to exist. You give a sky position, a distance and optionally an orbital drift; the tool follows where such a body would have been.',
  lookFor: 'A search, not a detection: the result is the signal-to-noise at the predicted position and an upper limit in microjansky.',
  bands: [],
};

export const CATALOGUE = [...BODIES, HYPOTHETICAL];

/** Plain-language label of a kind, for the chip tooltip and the heading. */
export function kindLabel(kind) {
  return {
    'dwarf planet': 'Dwarf planet',
    asteroid: 'Asteroid',
    comet: 'Comet',
    'interstellar comet': 'Interstellar comet',
    centaur: 'Centaur',
    hypothetical: 'Not known to exist',
  }[kind] || 'Solar-system body';
}

function norm(text) {
  return String(text || '').toLowerCase().replace(/[\s/()-]+/g, '');
}

/** Catalogue entry for typed text (name, alias, id or Horizons command), or null. */
export function findBody(text) {
  const key = norm(text).replace(/;+$/, '');
  if (!key) return null;
  for (const b of CATALOGUE) {
    if (norm(b.name) === key || b.id === key) return b;
    if (b.command && b.command === String(text).trim()) return b;
    // A command without its semicolon also counts, except for small numbers: "4" is a
    // major-body id for Horizons (the Mars system), not asteroid 4.
    if (b.command && norm(b.command).replace(/;+$/, '') === key && (/\D/.test(key) || Number(key) >= 1000)) return b;
    if (Array.isArray(b.aliases) && b.aliases.some((a) => norm(a) === key)) return b;
  }
  return null;
}

/**
 * What to send to the proxy's /ephemeris for typed text: the catalogue command when the text
 * names a catalogue body, otherwise the text itself (the proxy validates it and looks it up in
 * the Horizons small-body index). Returns { body, entry } with entry = null for free text.
 */
export function bodyQuery(text) {
  const entry = findBody(text);
  if (entry && entry.command) return { body: entry.command, entry };
  return { body: String(text || '').trim().replace(/\s+/g, ' '), entry: entry || null };
}

/**
 * Direction of prograde motion along the ecliptic at a sky position: the unit direction of
 * increasing ecliptic longitude, as on-sky components. Returns { east, north, paDeg } with
 * east^2 + north^2 = 1 and paDeg the position angle (degrees east of north).
 * A body on a low-inclination circular orbit drifts this way as seen from the Sun.
 */
export function eclipticPrograde(ra, dec) {
  const eps = OBLIQUITY_J2000_DEG * DEG;
  const a = ra * DEG;
  const d = dec * DEG;
  const u = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const p = [0, -Math.sin(eps), Math.cos(eps)]; // north ecliptic pole
  const v = [p[1] * u[2] - p[2] * u[1], p[2] * u[0] - p[0] * u[2], p[0] * u[1] - p[1] * u[0]];
  const e = [-Math.sin(a), Math.cos(a), 0];
  const n = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  let east = v[0] * e[0] + v[1] * e[1] + v[2] * e[2];
  let north = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  const len = Math.hypot(east, north);
  if (!(len > 1e-9)) return { east: 1, north: 0, paDeg: 90 }; // at the ecliptic pole: any direction
  east /= len;
  north /= len;
  let pa = Math.atan2(east, north) / DEG;
  if (pa < 0) pa += 360;
  return { east, north, paDeg: pa };
}

/**
 * Ephemeris of a hypothetical body, in the same shape as the proxy's /ephemeris answer, built
 * with the distance dial's parallax model (core/distance.js) instead of a known orbit.
 *
 *   ra, dec   where the body is assumed to APPEAR from the Earth on refMjd (degrees)
 *   distAU    assumed distance from the Sun, AU (at least 2: the model wants a body well
 *             outside the Earth's orbit)
 *   refMjd    the date the position refers to (default: the middle of the time range)
 *   drift     'none' (default): the body sits still as seen from the Sun, so all apparent
 *             motion is the reflex of the Earth's orbit (the parallax loop);
 *             'circular': it also moves at the circular-orbit rate for that distance
 *             (1,296,000 / d^1.5 arcsec per year), prograde along the ecliptic, or along
 *             driftPaDeg if given;
 *             or { raRate_arcsecPerYr, decRate_arcsecPerYr } (on-sky rates as seen from the Sun)
 *   startMjd, endMjd, stepHours   sampling (default: the survey so far, one sample a day)
 *
 * Returns { body: 'hypothetical', name, source, center: 'geocentric', hypothetical: true,
 *           samples: [[mjd, ra, dec, deltaAU, null], ...], params }.
 * Throws RangeError for unusable input. Magnitudes are null: nobody knows how bright it is.
 */
export function hypotheticalEphemeris({
  ra, dec, distAU, refMjd, drift = 'none', driftPaDeg,
  startMjd = SURVEY_START_MJD, endMjd, stepHours = 24, now = Date.now(),
} = {}) {
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || dec < -90 || dec > 90) {
    throw new RangeError('Give a sky position: RA 0 to 360 and Dec -90 to 90 degrees.');
  }
  if (!Number.isFinite(distAU) || distAU < 2) {
    throw new RangeError('Give a distance of at least 2 AU.');
  }
  const end = Number.isFinite(endMjd) ? endMjd : now / 86400000 + 40587;
  if (!Number.isFinite(startMjd) || !(end > startMjd)) throw new RangeError('The time range is empty.');
  const step = Math.max(1 / 60, Number.isFinite(stepHours) && stepHours > 0 ? stepHours : 24) / 24;
  const count = Math.min(6000, Math.floor((end - startMjd) / step + 1e-9) + 1);
  const mjds = [];
  for (let i = 0; i < count; i++) mjds.push(startMjd + i * ((end - startMjd) / Math.max(1, count - 1)));
  const ref = Number.isFinite(refMjd) ? refMjd : 0.5 * (startMjd + end);

  let motion = null;
  if (drift === 'circular') {
    const rate = keplerRate(distAU);
    let dir;
    if (Number.isFinite(driftPaDeg)) dir = { east: Math.sin(driftPaDeg * DEG), north: Math.cos(driftPaDeg * DEG) };
    else dir = eclipticPrograde(ra, dec);
    motion = { raRate_arcsecPerYr: rate * dir.east, decRate_arcsecPerYr: rate * dir.north };
  } else if (drift && typeof drift === 'object') {
    motion = {
      raRate_arcsecPerYr: Number.isFinite(drift.raRate_arcsecPerYr) ? drift.raRate_arcsecPerYr : 0,
      decRate_arcsecPerYr: Number.isFinite(drift.decRate_arcsecPerYr) ? drift.decRate_arcsecPerYr : 0,
    };
  }

  // Apparent position on the reference date -> direction from the Sun -> apparent track.
  const helio = heliocentricFromApparent(ra, dec, distAU, ref);
  if (!Number.isFinite(helio.ra) || !Number.isFinite(helio.dec)) {
    throw new RangeError('That position and distance have no solution; try a larger distance.');
  }
  const track = predictedTrack(helio.ra, helio.dec, distAU, mjds, motion ? { motion: { ...motion, refMjd: ref } } : {});
  const samples = [];
  for (const p of track) {
    if (!Number.isFinite(p.ra) || !Number.isFinite(p.dec)) continue;
    samples.push([p.mjd, p.ra, p.dec, Number.isFinite(p.distGeoAU) ? p.distGeoAU : null, null]);
  }
  const driftRate = motion ? Math.hypot(motion.raRate_arcsecPerYr, motion.decRate_arcsecPerYr) : 0;
  return {
    body: 'hypothetical',
    name: `Hypothetical body at ${distAU >= 100 ? Math.round(distAU) : Math.round(distAU * 10) / 10} AU`,
    source: 'parallax model (not an observed orbit)',
    center: 'geocentric',
    hypothetical: true,
    samples,
    params: { ra, dec, distAU, refMjd: ref, drift: motion, driftArcsecPerYr: driftRate, helio: { ra: helio.ra, dec: helio.dec } },
  };
}
