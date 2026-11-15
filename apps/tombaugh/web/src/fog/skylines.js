// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Reference lines and landmarks for the fog map, all in equatorial J2000 degrees. No
// constellation figures: only great circles, a graticule, bright stars and the challenge targets.
//
//   eclipticLine(stepDeg = 1)            -> [[ra, dec], ...]  closed loop, ecliptic longitude 0..360
//   galacticLine(bDeg = 0, stepDeg = 1)  -> [[ra, dec], ...]  closed loop at galactic latitude b
//   meridianLine(raDeg, decMax = 90, stepDeg = 2) -> [[ra, dec], ...]
//   parallelLine(decDeg, stepDeg = 2)    -> [[ra, dec], ...]  ra 0..360
//   BRIGHT_STARS: [{ name, ra, dec, mag }]   brightest first, for orientation only (0.01 deg)
//   FOG_TARGETS:  [{ id, name, short, ra, dec }]  the five challenge targets

import { eclToEq, galToEq } from './projection.js';

export function eclipticLine(stepDeg = 1) {
  const out = [];
  const n = Math.max(8, Math.round(360 / stepDeg));
  for (let i = 0; i <= n; i++) out.push(eclToEq((360 * i) / n, 0));
  return out;
}

export function galacticLine(bDeg = 0, stepDeg = 1) {
  const out = [];
  const n = Math.max(8, Math.round(360 / stepDeg));
  for (let i = 0; i <= n; i++) out.push(galToEq((360 * i) / n, bDeg));
  return out;
}

export function meridianLine(raDeg, decMax = 90, stepDeg = 2) {
  const out = [];
  const n = Math.max(2, Math.round((2 * decMax) / stepDeg));
  for (let i = 0; i <= n; i++) out.push([raDeg, -decMax + (2 * decMax * i) / n]);
  return out;
}

export function parallelLine(decDeg, stepDeg = 2) {
  const out = [];
  const n = Math.max(8, Math.round(360 / stepDeg));
  for (let i = 0; i <= n; i++) out.push([(360 * i) / n, decDeg]);
  return out;
}

// Brightest stars plus a few that complete familiar shapes (the Plough, Cassiopeia, Orion's
// belt, the Southern Cross). Positions J2000, rounded; magnitudes are V.
export const BRIGHT_STARS = [
  { name: 'Sirius', ra: 101.287, dec: -16.716, mag: -1.46 },
  { name: 'Canopus', ra: 95.988, dec: -52.696, mag: -0.74 },
  { name: 'Rigil Kentaurus', ra: 219.902, dec: -60.834, mag: -0.27 },
  { name: 'Arcturus', ra: 213.915, dec: 19.182, mag: -0.05 },
  { name: 'Vega', ra: 279.235, dec: 38.784, mag: 0.03 },
  { name: 'Capella', ra: 79.172, dec: 45.998, mag: 0.08 },
  { name: 'Rigel', ra: 78.634, dec: -8.202, mag: 0.13 },
  { name: 'Procyon', ra: 114.825, dec: 5.225, mag: 0.34 },
  { name: 'Achernar', ra: 24.429, dec: -57.237, mag: 0.46 },
  { name: 'Betelgeuse', ra: 88.793, dec: 7.407, mag: 0.5 },
  { name: 'Hadar', ra: 210.956, dec: -60.373, mag: 0.61 },
  { name: 'Altair', ra: 297.696, dec: 8.868, mag: 0.77 },
  { name: 'Acrux', ra: 186.65, dec: -63.099, mag: 0.76 },
  { name: 'Aldebaran', ra: 68.98, dec: 16.509, mag: 0.85 },
  { name: 'Antares', ra: 247.352, dec: -26.432, mag: 0.96 },
  { name: 'Spica', ra: 201.298, dec: -11.161, mag: 0.97 },
  { name: 'Pollux', ra: 116.329, dec: 28.026, mag: 1.14 },
  { name: 'Fomalhaut', ra: 344.413, dec: -29.622, mag: 1.16 },
  { name: 'Deneb', ra: 310.358, dec: 45.28, mag: 1.25 },
  { name: 'Mimosa', ra: 191.93, dec: -59.689, mag: 1.25 },
  { name: 'Regulus', ra: 152.093, dec: 11.967, mag: 1.35 },
  { name: 'Adhara', ra: 104.656, dec: -28.972, mag: 1.5 },
  { name: 'Castor', ra: 113.65, dec: 31.888, mag: 1.58 },
  { name: 'Shaula', ra: 263.402, dec: -37.104, mag: 1.62 },
  { name: 'Gacrux', ra: 187.791, dec: -57.113, mag: 1.63 },
  { name: 'Bellatrix', ra: 81.283, dec: 6.35, mag: 1.64 },
  { name: 'Elnath', ra: 81.573, dec: 28.608, mag: 1.65 },
  { name: 'Miaplacidus', ra: 138.3, dec: -69.717, mag: 1.68 },
  { name: 'Alnilam', ra: 84.053, dec: -1.202, mag: 1.69 },
  { name: 'Alnair', ra: 332.058, dec: -46.961, mag: 1.74 },
  { name: 'Alnitak', ra: 85.19, dec: -1.943, mag: 1.77 },
  { name: 'Alioth', ra: 193.507, dec: 55.96, mag: 1.77 },
  { name: 'Regor', ra: 122.383, dec: -47.337, mag: 1.78 },
  { name: 'Dubhe', ra: 165.932, dec: 61.751, mag: 1.79 },
  { name: 'Mirfak', ra: 51.081, dec: 49.861, mag: 1.8 },
  { name: 'Wezen', ra: 107.098, dec: -26.393, mag: 1.84 },
  { name: 'Kaus Australis', ra: 276.043, dec: -34.385, mag: 1.85 },
  { name: 'Avior', ra: 125.628, dec: -59.51, mag: 1.86 },
  { name: 'Alkaid', ra: 206.885, dec: 49.313, mag: 1.86 },
  { name: 'Sargas', ra: 264.33, dec: -42.998, mag: 1.87 },
  { name: 'Menkalinan', ra: 89.882, dec: 44.947, mag: 1.9 },
  { name: 'Atria', ra: 252.166, dec: -69.028, mag: 1.92 },
  { name: 'Alhena', ra: 99.428, dec: 16.399, mag: 1.92 },
  { name: 'Peacock', ra: 306.412, dec: -56.735, mag: 1.94 },
  { name: 'Alsephina', ra: 131.176, dec: -54.709, mag: 1.96 },
  { name: 'Polaris', ra: 37.955, dec: 89.264, mag: 1.98 },
  { name: 'Mirzam', ra: 95.675, dec: -17.956, mag: 1.98 },
  { name: 'Alphard', ra: 141.897, dec: -8.659, mag: 1.98 },
  { name: 'Hamal', ra: 31.793, dec: 23.462, mag: 2.0 },
  { name: 'Diphda', ra: 10.897, dec: -17.987, mag: 2.02 },
  { name: 'Nunki', ra: 283.816, dec: -26.297, mag: 2.02 },
  { name: 'Mirach', ra: 17.433, dec: 35.621, mag: 2.05 },
  { name: 'Alpheratz', ra: 2.097, dec: 29.09, mag: 2.06 },
  { name: 'Menkent', ra: 211.671, dec: -36.37, mag: 2.06 },
  { name: 'Rasalhague', ra: 263.734, dec: 12.56, mag: 2.07 },
  { name: 'Kochab', ra: 222.676, dec: 74.156, mag: 2.08 },
  { name: 'Algieba', ra: 154.993, dec: 19.842, mag: 2.08 },
  { name: 'Saiph', ra: 86.939, dec: -9.67, mag: 2.09 },
  { name: 'Algol', ra: 47.042, dec: 40.956, mag: 2.12 },
  { name: 'Denebola', ra: 177.265, dec: 14.572, mag: 2.14 },
  { name: 'Sadr', ra: 305.557, dec: 40.257, mag: 2.2 },
  { name: 'Suhail', ra: 136.999, dec: -43.433, mag: 2.21 },
  { name: 'Mintaka', ra: 83.002, dec: -0.299, mag: 2.23 },
  { name: 'Schedar', ra: 10.127, dec: 56.537, mag: 2.23 },
  { name: 'Eltanin', ra: 269.152, dec: 51.489, mag: 2.23 },
  { name: 'Alphecca', ra: 233.672, dec: 26.715, mag: 2.23 },
  { name: 'Naos', ra: 120.896, dec: -40.003, mag: 2.25 },
  { name: 'Aspidiske', ra: 139.273, dec: -59.275, mag: 2.25 },
  { name: 'Almach', ra: 30.975, dec: 42.33, mag: 2.26 },
  { name: 'Mizar', ra: 200.981, dec: 54.925, mag: 2.27 },
  { name: 'Caph', ra: 2.295, dec: 59.15, mag: 2.27 },
  { name: 'Dschubba', ra: 240.083, dec: -22.622, mag: 2.32 },
  { name: 'Merak', ra: 165.46, dec: 56.382, mag: 2.37 },
  { name: 'Ankaa', ra: 6.571, dec: -42.306, mag: 2.38 },
  { name: 'Enif', ra: 326.046, dec: 9.875, mag: 2.39 },
  { name: 'Scheat', ra: 345.944, dec: 28.083, mag: 2.42 },
  { name: 'Phecda', ra: 178.458, dec: 53.695, mag: 2.44 },
  { name: 'Gamma Cassiopeiae', ra: 14.177, dec: 60.717, mag: 2.47 },
  { name: 'Markab', ra: 346.19, dec: 15.205, mag: 2.49 },
  { name: 'Ruchbah', ra: 21.454, dec: 60.235, mag: 2.68 },
  { name: 'Megrez', ra: 183.857, dec: 57.033, mag: 3.31 },
  { name: 'Segin', ra: 28.599, dec: 63.67, mag: 3.37 },
].sort((a, b) => a.mag - b.mag);

// The five challenge targets (positions as given in the challenge brief, degrees).
export const FOG_TARGETS = [
  { id: 'barnard', name: "Barnard's Star", short: "Barnard's", ra: 269.45, dec: 4.69 },
  { id: 'epsindi', name: 'Epsilon Indi B', short: 'Eps Ind B', ra: 331.04, dec: -56.78 },
  { id: 'wise0855', name: 'WISE 0855', short: 'WISE 0855', ra: 133.8, dec: -7.25 },
  { id: 'rwaur', name: 'RW Aurigae', short: 'RW Aur', ra: 76.96, dec: 30.4 },
  { id: 'rdra', name: 'R Draconis', short: 'R Dra', ra: 248.17, dec: 66.75 },
];
