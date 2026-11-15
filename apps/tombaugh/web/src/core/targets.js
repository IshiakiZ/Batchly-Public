// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// targets.js - the five challenge targets and a few more worth a look.
//
// All numbers are APPROXIMATE CATALOGUE VALUES (SIMBAD / Gaia DR3 / discovery papers), rounded,
// typed in by hand and good enough to point a 6 arcsec pixel at the right place and to draw a
// reference arrow on the motion meter. They are not a substitute for a catalogue query; the
// /resolve and /gaia endpoints give the real thing when the network is up.
//
// Fields:
//   ra, dec    degrees, ICRS, at `epoch` (Julian year). NOT necessarily 2000.0: WISE 0855-0714
//              and Luhman 16 are given at the epoch of the measurement quoted.
//   pmra       mu_alpha* = d(RA)/dt * cos(Dec), mas/yr, positive east.   pmdec: mas/yr, north.
//   parallax   mas. 0 means "not applied": too small to matter at this pixel scale, or not known
//              to the author with confidence (R Dra), or meaningless (M101).
//   det        suggested SPHEREx detector (1-6); fov: suggested field of view, arcmin (2, 4, 6, 10).
//   blurb      one line saying what the object is.
//   why        one sentence saying what the tool should reveal there.
//   kind       'mover' | 'pair' | 'cold' | 'irregular' | 'lpv' | 'galaxy': which preview/animation fits.
//   challenge  true for the five targets named in the challenge statement.
//   aliases    other names findTarget should recognise.

import { propagate } from './astrometry.js';

/** One SPHEREx pixel, arcsec. */
const SPHEREX_PIXEL_ARCSEC = 6.15;

export const TARGETS = [
  {
    id: 'barnard',
    name: "Barnard's Star",
    // ICRS at epoch 2000.0. Carried to 2016.0 this lands within 0.1 arcsec of Gaia DR3
    // (269.44850, +4.73942).
    ra: 269.452075, dec: 4.693391, epoch: 2000.0,
    pmra: -802.8, pmdec: 10362.5, parallax: 547.0,
    det: 3, fov: 4,
    kind: 'mover', challenge: true,
    aliases: ['Barnards Star', 'GJ 699', 'Gliese 699', 'HIP 87937', 'V2500 Oph'],
    blurb: 'A red dwarf six light-years away with the largest proper motion of any star: 10.4 arcsec a year, about 1.7 SPHEREx pixels.',
    why: 'Blink the passes and one star steps north while the rest hold still; the motion meter should land near the 10.4 arcsec a year that Gaia measures.',
    // Measured by the Validation tab on real SPHEREx data, 2026-11-15 (docs/RESULTS.md).
    found: '11.9 ± 2.4 arcsec a year heading 355°. Gaia says 10.4 at 356°.',
  },
  {
    id: 'eps-indi-b',
    name: 'Epsilon Indi Ba,Bb',
    // Epoch 2000.0, approximate. Shares the proper motion and parallax of Epsilon Indi A,
    // which is about 400 arcsec to the west.
    ra: 331.0438, dec: -56.7827, epoch: 2000.0,
    pmra: 3960.9, pmdec: -2539.2, parallax: 274.8,
    det: 6, fov: 6,
    kind: 'pair', challenge: true,
    aliases: ['Eps Indi B', 'Epsilon Indi B', 'eps Ind B', 'Epsilon Indi Bab'],
    blurb: 'Two methane-rich T dwarfs circling each other 12 light-years away, about 400 arcsec from the star Epsilon Indi A.',
    why: 'The two are under an arcsecond apart, so they share one pixel, but their blended spectrum should dip at 3.3 um where methane absorbs, and the pair drifts 4.7 arcsec a year in step with Epsilon Indi A.',
    // Measured by the Validation tab on real SPHEREx data, 2026-11-15 (docs/RESULTS.md).
    found: '4.51 ± 0.65 arcsec a year at 126° (catalogue: 4.64 at 124°). Methane removes 60 % of the light at 3.3 um.',
  },
  {
    id: 'wise0855',
    name: 'WISE 0855-0714',
    // Position from the challenge statement, 08h55m10.831s -07d14m42.53s. These are the
    // coordinates in the object's WISE designation (J085510.83-071442.5), so they are where
    // WISE saw it in its first pass over this field, May 2010 (epoch 2010.35), not where it was
    // when the discovery was published in 2014. Checked against the sky: carried forward from
    // 2010.35 with the proper motion below, the position lands 0.2 arcsec from the source
    // SPHEREx sees at 4.4 to 5.0 um in November 2025; from 2014.3 it would miss by 31 arcsec.
    ra: 133.795129, dec: -7.245147, epoch: 2010.35,
    pmra: -8118, pmdec: 680, parallax: 439,
    det: 6, fov: 4,
    kind: 'cold', challenge: true,
    aliases: ['WISE 0855', 'WISE J0855-0714', 'WISE J085510.83-071442.5', 'W0855', 'WISEA J085510.74-071442.5'],
    blurb: 'The coldest brown dwarf known, about 250 K (below freezing), 7.4 light-years away.',
    why: 'It sits near the limit of a single SPHEREx exposure and shows, if at all, only between 4.5 and 5 um; stacking along its 8.1 arcsec a year track is the fair test of whether it is there.',
    // Measured by the Validation tab on real SPHEREx data, 2026-11-15 (docs/RESULTS.md).
    found: 'It is there: 8.0 ± 1.2 arcsec a year at 278° from three visits (published: 8.17 at 275°).',
  },
  {
    id: 'rw-aur',
    name: 'RW Aurigae',
    ra: 76.95642, dec: 30.40142, epoch: 2000.0,
    pmra: 4, pmdec: -25, parallax: 6.1,
    det: 2, fov: 4,
    kind: 'irregular', challenge: true,
    aliases: ['RW Aur', 'RW Aur A', 'HD 240764'],
    blurb: 'A young star about 530 light-years away, still pulling in gas from its disc, that brightens and fades with no fixed period.',
    why: 'Nothing moves here: the residual view and the light curve should show one star changing between passes while its neighbours stay flat.',
    // Measured by the Validation tab on real SPHEREx data, 2026-11-15 (docs/RESULTS.md).
    found: 'Brightened by 40 % between Sep 2025 and Mar 2026 (11 sigma). No motion.',
  },
  {
    id: 'r-dra',
    name: 'R Draconis',
    // Proper motion is a few mas/yr and the parallax about 1-2 mas: both invisible at 6 arcsec
    // pixels and not quoted here with confidence, so they are set to 0 (not applied).
    ra: 248.16763, dec: 66.75497, epoch: 2000.0,
    pmra: 0, pmdec: 0, parallax: 0,
    det: 3, fov: 4,
    kind: 'lpv', challenge: true,
    aliases: ['R Dra', 'HD 149880', 'HIP 81014'],
    blurb: 'A Mira-type red giant that swells and fades over about 245 days.',
    why: 'Passes six months apart catch it at different points of its 245-day cycle, so its brightness should differ from pass to pass and the water band near 1.9 um should change depth with it.',
    // Measured by the Validation tab on real SPHEREx data, 2026-11-15 (docs/RESULTS.md).
    found: 'Faded by 28 % between Mar and Apr 2026 (4.3 sigma). No motion.',
  },
  {
    id: 'proxima',
    name: 'Proxima Centauri',
    ra: 217.42895, dec: -62.67948, epoch: 2000.0,
    pmra: -3781.7, pmdec: 769.5, parallax: 768.1,
    det: 3, fov: 4,
    kind: 'mover', challenge: false,
    aliases: ['Proxima', 'Proxima Cen', 'Alpha Centauri C', 'GJ 551', 'V645 Cen'],
    blurb: 'The nearest star to the Sun, 4.2 light-years away, moving 3.9 arcsec a year.',
    why: 'A smaller step than Barnard\'s Star, about 0.6 pixel a year, so it shows how small a motion the centroid fit can pull out of two or three passes; its parallax, 0.77 arcsec, is the largest of any star.',
  },
  {
    id: 'luhman16',
    name: 'Luhman 16',
    // WISE J104915.57-531906.1, approximate position at epoch 2010.4.
    ra: 162.3288, dec: -53.3194, epoch: 2010.4,
    pmra: -2759, pmdec: 354, parallax: 501,
    det: 4, fov: 4,
    kind: 'pair', challenge: false,
    aliases: ['Luhman 16AB', 'WISE 1049-5319', 'WISE J1049-5319', 'WISE J104915.57-531906.1', 'W1049'],
    blurb: 'The nearest brown dwarfs: an L dwarf and a T dwarf in a tight pair 6.5 light-years away, found in WISE images in 2013.',
    why: 'Bright enough for a clean spectrum of the blended pair: look for methane at 3.3 um here, carbon monoxide at 4.7 um on detector 6, and a 2.8 arcsec a year drift to the west.',
  },
  {
    id: 'teegarden',
    name: "Teegarden's Star",
    ra: 43.2537, dec: 16.8813, epoch: 2000.0,
    pmra: 3429, pmdec: -3806, parallax: 261,
    det: 2, fov: 4,
    kind: 'mover', challenge: false,
    aliases: ['Teegardens Star', 'Teegarden', 'SO J025300.5+165258', 'GJ 10393', 'LSPM J0253+1652'],
    blurb: 'A dim red dwarf 12.5 light-years away that went unnoticed until 2003 despite moving 5.1 arcsec a year.',
    why: 'A second check on the motion meter: about 0.8 pixel a year towards the south-east.',
  },
  {
    id: 'm101',
    name: 'M101',
    ra: 210.80227, dec: 54.34895, epoch: 2000.0,
    pmra: 0, pmdec: 0, parallax: 0,
    det: 2, fov: 10,
    kind: 'galaxy', challenge: false,
    aliases: ['Messier 101', 'Pinwheel Galaxy', 'Pinwheel', 'NGC 5457'],
    blurb: 'The Pinwheel Galaxy, a face-on spiral about 21 million light-years away.',
    why: 'A control: nothing here should move, so the residual view should come out flat apart from noise, and anything that does stand out is a transient, a passing asteroid or an artefact worth checking.',
  },
];

/** Ids of the five targets named in the challenge statement, in order. */
export const CHALLENGE_TARGET_IDS = TARGETS.filter((t) => t.challenge).map((t) => t.id);

/**
 * Where a target is at a given date: its catalogue position carried forward by proper motion,
 * plus the parallax shift for that date.
 * @param {object} target an entry of TARGETS (or anything with ra, dec, epoch, pmra, pmdec, parallax)
 * @param {number} mjd MJD (UTC)
 * @param {{ parallax?: boolean }} [opts] parallax = false for the heliocentric direction
 * @returns {{ ra: number, dec: number }} degrees
 */
export function positionNow(target, mjd, opts = {}) {
  return propagate(target, mjd, opts);
}

/**
 * Size and direction of a target's catalogue proper motion in friendly units.
 * @returns {{ arcsecPerYr: number, pixPerYr: number, paDeg: number }} paDeg east of north
 */
export function motionSummary(target) {
  const a = target && Number.isFinite(target.pmra) ? target.pmra : 0;
  const d = target && Number.isFinite(target.pmdec) ? target.pmdec : 0;
  const total = Math.hypot(a, d) / 1000;
  const pa = (Math.atan2(a, d) * 180) / Math.PI;
  return { arcsecPerYr: total, pixPerYr: total / SPHEREX_PIXEL_ARCSEC, paDeg: total > 0 ? (pa + 360) % 360 : 0 };
}

/** Lower-case, spell out Greek letters, drop everything that is not a letter or digit. */
function normalise(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/ε|ϵ/g, 'eps')      // epsilon
    .replace(/α/g, 'alpha')
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '');
}

function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const KEYS = TARGETS.map((t) => {
  const keys = new Set([normalise(t.id), normalise(t.name), ...(t.aliases || []).map(normalise)]);
  // "epsilon" and "eps" are interchangeable
  for (const k of Array.from(keys)) {
    if (k.includes('epsilon')) keys.add(k.replace('epsilon', 'eps'));
  }
  return { target: t, keys: Array.from(keys) };
});

/**
 * Find a target by id, name or alias, forgiving case, spacing, punctuation and small typos:
 * "barnard", "Barnards star", "GJ699", "eps indi", "wise 0855", "pinwheel", "proxma cen".
 * Tries, in order: exact match, prefix, substring, then a one- or two-letter typo (never in the
 * digits or in the first or last character). Returns null for anything else, including other
 * real objects such as "Epsilon Indi A": the caller should then ask the /resolve endpoint.
 * @param {string} text
 * @returns {object|null} the TARGETS entry, or null
 */
export function findTarget(text) {
  const q = normalise(text).replace(/^epsilon/, 'eps');
  if (q.length < 2) return null;
  for (const { target, keys } of KEYS) if (keys.includes(q)) return target;
  if (q.length >= 3) {
    for (const { target, keys } of KEYS) if (keys.some((k) => k.startsWith(q) || (k.length >= 4 && q.startsWith(k)))) return target;
    for (const { target, keys } of KEYS) if (keys.some((k) => k.includes(q))) return target;
  }
  if (q.length >= 5) {
    const allow = q.length >= 8 ? 2 : 1;
    let best = null, bestD = allow + 1;
    for (const { target, keys } of KEYS) {
      for (const k of keys) {
        // A typo is a slip in the middle of a word. Different digits or a different first or
        // last character usually mean a different object (Epsilon Indi A is not B).
        if (k[0] !== q[0] || k[k.length - 1] !== q[q.length - 1]) continue;
        if (k.replace(/[^0-9]/g, '') !== q.replace(/[^0-9]/g, '')) continue;
        const d = editDistance(q, k);
        if (d < bestD) { bestD = d; best = target; }
      }
    }
    if (best) return best;
  }
  return null;
}
