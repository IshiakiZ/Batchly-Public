// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// tools/make-sky-data.mjs - build web/src/sky/stardata.js, the bright-star list the sky view and
// the search pick-list use.
//
//   node tools/make-sky-data.mjs --src <dir> [--hyg <hygdata_v41.csv>] [--out web/src/sky/stardata.js]
//
// <dir> holds three files from the d3-celestial project (https://github.com/ofrohn/d3-celestial,
// BSD 3-Clause, Copyright (c) 2015 Olaf Frohn), folder data/:
//   stars.6.json                 stars to magnitude 6 (Hipparcos positions, J2000)
//   starnames.json               proper names by Hipparcos number
//   constellations.lines.json    the constellation stick figures
//
// --hyg adds each star's distance, so the sky view can show depth. It is the HYG database v4.1
// (astronexus, https://github.com/astronexus/HYG-Database, file hyg/CURRENT/hygdata_v41.csv),
// licensed CC BY-SA 4.0; its distances come from the Hipparcos parallaxes. Stars are matched by
// Hipparcos number. Without --hyg every distance is written as 0 (unknown).
//
// The output keeps only what the page draws: position, brightness, colour and distance of each
// star, the proper names, and the stick figures, as flat integer lists.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const src = arg('--src', '');
const hygFile = arg('--hyg', '');
const outFile = path.resolve(PROJECT, arg('--out', 'web/src/sky/stardata.js'));
if (!src) {
  console.error('usage: node tools/make-sky-data.mjs --src <dir with the d3-celestial data files> [--hyg <hygdata_v41.csv>]');
  process.exit(2);
}
const read = (name) => JSON.parse(fs.readFileSync(path.join(src, name), 'utf8'));

const stars = read('stars.6.json').features;
const names = read('starnames.json');
const lines = read('constellations.lines.json').features;

const norm = (lon) => ((lon % 360) + 360) % 360;

/** One line of a CSV file -> its fields (quoted fields may hold commas and doubled quotes). */
function csvFields(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Hipparcos number -> distance in parsecs, from the HYG database. Unknown distances are left out. */
function readDistances(file) {
  const map = new Map();
  if (!file) return map;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const head = csvFields(lines[0]);
  const hipAt = head.indexOf('hip');
  const distAt = head.indexOf('dist');
  if (hipAt < 0 || distAt < 0) throw new Error(`${file}: no "hip" and "dist" columns`);
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    const f = csvFields(lines[i]);
    const hip = f[hipAt];
    const dist = Number(f[distAt]);
    // HYG writes 100000 for a missing or dubious parallax.
    if (!hip || !(dist > 0) || dist >= 100000) continue;
    if (!map.has(hip)) map.set(hip, dist);
  }
  return map;
}
const distances = readDistances(hygFile);

const rows = stars
  .map((f) => ({
    hip: String(f.id),
    ra: norm(f.geometry.coordinates[0]),
    dec: f.geometry.coordinates[1],
    mag: Number(f.properties.mag),
    bv: Number(f.properties.bv),
  }))
  .filter((s) => Number.isFinite(s.ra) && Number.isFinite(s.dec) && Number.isFinite(s.mag))
  .sort((a, b) => a.mag - b.mag);

const flat = [];
const named = [];
const seen = new Set();
let withDistance = 0;
rows.forEach((s, i) => {
  const dist = distances.get(s.hip) || 0;
  if (dist > 0) withDistance += 1;
  flat.push(Math.round(s.ra * 1000), Math.round(s.dec * 1000), Math.round(s.mag * 100), Number.isFinite(s.bv) ? Math.round(s.bv * 100) : 60, Math.max(dist > 0 ? 1 : 0, Math.round(dist * 10)));
  const entry = names[s.hip];
  const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
  if (name && !seen.has(name.toLowerCase())) {
    seen.add(name.toLowerCase());
    named.push([i, name]);
  }
});

const figures = [];
for (const f of lines) {
  for (const line of f.geometry.coordinates) {
    const pts = [];
    for (const [lon, lat] of line) pts.push(Math.round(norm(lon) * 100), Math.round(lat * 100));
    figures.push(pts);
  }
}

const body = `// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// stardata.js: the ${rows.length} brightest stars (to magnitude 6), ${named.length} proper names, the
// constellation stick figures and ${withDistance} star distances, for the sky view and the search pick-list.
// GENERATED by tools/make-sky-data.mjs. Do not edit by hand.
//
// TWO SOURCES, TWO LICENCES.
//
// 1. Distances (the fifth number of every star in STARS): the HYG database v4.1 by astronexus
//    (https://github.com/astronexus/HYG-Database, hyg/CURRENT/hygdata_v41.csv; now kept at
//    https://codeberg.org/astronexus/hyg), which takes them from the Hipparcos parallaxes.
//    "This work is licensed under a Creative Commons Attribution-ShareAlike 4.0 International
//    License" (http://creativecommons.org/licenses/by-sa/4.0/). Changes made here: only the
//    distance column is kept, matched to the stars below by Hipparcos number, rounded to a tenth
//    of a parsec, with 0 for "unknown". Those distance values stay under CC BY-SA 4.0.
//
// 2. Everything else: d3-celestial (https://github.com/ofrohn/d3-celestial), data/stars.6.json,
// data/starnames.json and data/constellations.lines.json, which are derived from the Hipparcos
// catalogue (ESA 1997). Used under the BSD 3-Clause licence:
//
//   Copyright (c) 2015, Olaf Frohn. All rights reserved.
//   Redistribution and use in source and binary forms, with or without modification, are
//   permitted provided that the following conditions are met:
//   1. Redistributions of source code must retain the above copyright notice, this list of
//      conditions and the following disclaimer.
//   2. Redistributions in binary form must reproduce the above copyright notice, this list of
//      conditions and the following disclaimer in the documentation and/or other materials
//      provided with the distribution.
//   3. Neither the name of the copyright holder nor the names of its contributors may be used to
//      endorse or promote products derived from this software without specific prior written
//      permission.
//   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
//   IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
//   AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
//   CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
//   CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
//   SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
//   THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
//   OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
//   POSSIBILITY OF SUCH DAMAGE.

/** The notice the licence asks to be kept with the data; shown in the page's credits. */
export const STAR_DATA_CREDIT =
  'Star positions, names and constellation figures: d3-celestial, Copyright (c) 2015 Olaf Frohn, BSD 3-Clause licence, from the Hipparcos catalogue (ESA 1997). Star distances: HYG database v4.1 by astronexus, CC BY-SA 4.0, from the Hipparcos parallaxes.';

/**
 * Five integers per star, brightest first: RA and Dec in thousandths of a degree (J2000),
 * magnitude x 100, B-V colour x 100, distance in tenths of a parsec (0 = unknown).
 */
export const STAR_FIELDS = 5;
export const STARS = [${flat.join(',')}];

/** [index into the star list, proper name]. */
export const STAR_NAMES = ${JSON.stringify(named)};

/** Constellation stick figures: each a list of RA, Dec pairs in hundredths of a degree. */
export const SKY_FIGURES = ${JSON.stringify(figures)};

/** The stars as objects: { ra, dec, mag, bv, dist, name }; dist in parsecs, 0 = unknown. Built once, on first use. */
let cached = null;
export function starList() {
  if (cached) return cached;
  const out = [];
  for (let i = 0; i < STARS.length; i += STAR_FIELDS) {
    out.push({ ra: STARS[i] / 1000, dec: STARS[i + 1] / 1000, mag: STARS[i + 2] / 100, bv: STARS[i + 3] / 100, dist: STARS[i + 4] / 10, name: '' });
  }
  for (const [index, name] of STAR_NAMES) if (out[index]) out[index].name = name;
  cached = out;
  return out;
}

/** The named stars, alphabetical: [{ name, ra, dec, mag }]. */
export function namedStars() {
  return starList()
    .filter((s) => s.name)
    .map((s) => ({ name: s.name, ra: s.ra, dec: s.dec, mag: s.mag }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, body);
console.log(`${path.relative(PROJECT, outFile)}: ${rows.length} stars (${withDistance} with a distance), ${named.length} names, ${figures.length} figure lines, ${(body.length / 1024).toFixed(0)} KB`);
