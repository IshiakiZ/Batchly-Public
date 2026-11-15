// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planck, thermalFlux_uJy, reflectedFlux_uJy, solarFlux_uJy, lambertPhase, methaneTransmission,
  bodyFlux_uJy, fluxParts_uJy, scaledSpectrum, PRESETS, presetById,
  H_PLANCK, C_LIGHT, K_BOLTZMANN, C2_UM_K, AU_KM, R_SUN_KM, R_JUPITER_KM, R_EARTH_KM, T_SUN_K,
} from './blackbody.js';

const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

test('constants are the CODATA 2018 / IAU values', () => {
  assert.equal(H_PLANCK, 6.62607015e-34);
  assert.equal(C_LIGHT, 2.99792458e8);
  assert.equal(K_BOLTZMANN, 1.380649e-23);
  assert.equal(AU_KM, 1.495978707e8);
  assert.equal(T_SUN_K, 5772);
  assert.equal(R_SUN_KM, 695700);
  // hc/k = 6.62607015e-34 * 2.99792458e8 / 1.380649e-23 = 1.438777e-2 m K = 14387.77 um K
  assert.ok(rel(C2_UM_K, 14387.77) < 1e-6);
});

test('Planck function against values worked by hand', () => {
  // B_nu = (2 h c / lambda^3) / (exp(x) - 1), x = 14387.77 / (lambda_um T).
  // 250 K, 4.5 um: x = 12.78913; 2hc/lambda^3 = 3.97289e-25 / 9.1125e-17 = 4.35983e-9;
  //   exp(x) = 3.58301e5  ->  B = 1.21681e-14 W m^-2 Hz^-1 sr^-1
  assert.ok(rel(planck(250, 4.5), 1.21681e-14) < 2e-4);
  // 5772 K, 4.5 um: x = 0.553923; exp(x) - 1 = 0.740066  ->  B = 5.89114e-9
  assert.ok(rel(planck(5772, 4.5), 5.89114e-9) < 2e-4);
  // 300 K, 10 um: x = 4.795923; exp(x) - 1 = 120.016; 2hc/lambda^3 = 3.97289e-10  ->  B = 3.31030e-12
  assert.ok(rel(planck(300, 10), 3.3103e-12) < 2e-4);
});

test('Planck function limits and bad input', () => {
  // Rayleigh-Jeans: B -> 2 k T / lambda^2 when x << 1 (1 mm, 5000 K: x = 0.0029)
  const lam = 1000e-6;
  const rj = (2 * K_BOLTZMANN * 5000) / (lam * lam);
  assert.ok(rel(planck(5000, 1000), rj) < 2e-3);
  // Wien displacement in frequency: the peak of B_nu sits at x = 2.821439, lambda T = 5099.4 um K
  const T = 300;
  const peak = 5099.4 / T;
  assert.ok(planck(T, peak) > planck(T, peak * 1.02));
  assert.ok(planck(T, peak) > planck(T, peak * 0.98));
  assert.equal(planck(0, 4.5), 0);
  assert.equal(planck(-5, 4.5), 0);
  assert.ok(Number.isNaN(planck(300, 0)));
  assert.equal(planck(1, 0.1), 0);                    // exponent overflows: zero, not NaN
});

test('Planck function integrates to the Stefan-Boltzmann law', () => {
  // integral of B_nu d(nu) = sigma T^4 / pi, sigma = 5.670374419e-8 W m^-2 K^-4.
  const T = 400;
  let sum = 0;
  const n = 20000;
  const lo = Math.log(0.5), hi = Math.log(3000);
  for (let i = 0; i < n; i++) {
    const w = Math.exp(lo + (hi - lo) * (i + 0.5) / n);       // um, log-spaced midpoints
    const nu = C_LIGHT / (w * 1e-6);
    sum += planck(T, w) * nu * ((hi - lo) / n);                // d(nu) = nu d(ln lambda)
  }
  assert.ok(rel(sum, (5.670374419e-8 * T ** 4) / Math.PI) < 1e-3);
});

test('thermal flux: hand value and scaling laws', () => {
  // Jupiter radius, 250 K, 474,000 AU, 4.5 um:
  //   R/d = 69911 / (474000 * 1.495978707e8) = 9.8592e-10, squared 9.7204e-19
  //   F = pi * 1.21681e-14 * 9.7204e-19 = 3.7158e-32 W m^-2 Hz^-1 = 3.716 uJy
  const base = { T_K: 250, radius_km: R_JUPITER_KM, dist_AU: 474000, wave_um: 4.5 };
  const f = thermalFlux_uJy(base);
  assert.ok(rel(f, 3.716) < 1e-3, `got ${f}`);
  assert.ok(rel(thermalFlux_uJy({ ...base, radius_km: 2 * R_JUPITER_KM }), 4 * f) < 1e-12);   // R^2
  assert.ok(rel(thermalFlux_uJy({ ...base, dist_AU: 4740000 }), f / 100) < 1e-12);            // d^-2
  // Wien tail: 250 K -> 300 K changes x from 12.78913 to 10.65761, a factor exp(2.13152) = 8.43
  assert.ok(rel(thermalFlux_uJy({ ...base, T_K: 300 }) / f, 8.428) < 2e-3);
  assert.equal(thermalFlux_uJy({ ...base, radius_km: 0 }), 0);
});

test('the Sun as a blackbody gives a sensible solar flux', () => {
  // pi B_nu(5772 K, 4.5 um) (R_sun / 1 AU)^2 = pi * 5.89114e-9 * (695700 / 1.495978707e8)^2
  //   = pi * 5.89114e-9 * 2.16266e-5 = 4.0025e-13 W m^-2 Hz^-1 = 4.0e13 Jy
  assert.ok(rel(solarFlux_uJy(1, 4.5), 4.0025e19) < 1e-3);
  assert.ok(rel(solarFlux_uJy(10, 4.5), solarFlux_uJy(1, 4.5) / 100) < 1e-12);
});

test('reflected flux: hand value and scaling laws', () => {
  // Neptune-size (25,500 km), geometric albedo 0.4, 500 AU from Sun and observer, 4.5 um:
  //   F_sun(500 AU) = 4.0025e-13 / 250000 = 1.6010e-18
  //   (R/d)^2 = (25500 / 7.479894e10)^2 = 1.16222e-13
  //   F = 0.4 * 1.6010e-18 * 1.16222e-13 = 7.443e-32 = 7.44 uJy
  const base = { albedo: 0.4, radius_km: 25500, helioDist_AU: 500, geoDist_AU: 500, wave_um: 4.5 };
  const f = reflectedFlux_uJy(base);
  assert.ok(rel(f, 7.443) < 2e-3, `got ${f}`);
  assert.ok(rel(reflectedFlux_uJy({ ...base, albedo: 0.2 }), f / 2) < 1e-12);
  assert.ok(rel(reflectedFlux_uJy({ ...base, radius_km: 51000 }), 4 * f) < 1e-12);
  // both distances doubled: d^-4
  assert.ok(rel(reflectedFlux_uJy({ ...base, helioDist_AU: 1000, geoDist_AU: 1000 }), f / 16) < 1e-12);
  // only the observer's distance doubled: d^-2
  assert.ok(rel(reflectedFlux_uJy({ ...base, geoDist_AU: 1000 }), f / 4) < 1e-12);
  // geoDist defaults to helioDist
  assert.ok(rel(reflectedFlux_uJy({ ...base, geoDist_AU: undefined }), f) < 1e-12);
  assert.equal(reflectedFlux_uJy({ ...base, albedo: 0 }), 0);
});

test('Lambert phase function', () => {
  assert.equal(lambertPhase(0), 1);
  assert.ok(Math.abs(lambertPhase(90) - 1 / Math.PI) < 1e-12);
  assert.ok(Math.abs(lambertPhase(180)) < 1e-12);
  assert.ok(lambertPhase(2) > 0.999);
  const full = reflectedFlux_uJy({ albedo: 0.3, radius_km: 1000, helioDist_AU: 40, wave_um: 2 });
  const half = reflectedFlux_uJy({ albedo: 0.3, radius_km: 1000, helioDist_AU: 40, wave_um: 2, phase_deg: 90 });
  assert.ok(rel(half, full / Math.PI) < 1e-12);
});

test('methane band carves 3.3 um and leaves 4.5 um alone', () => {
  assert.ok(Math.abs(methaneTransmission(3.3) - 0.1) < 1e-12);
  assert.ok(methaneTransmission(4.5) > 0.999999);
  assert.ok(methaneTransmission(2.0) > 0.999999);
  assert.ok(methaneTransmission(3.3, { depth: 0.5 }) === 0.5);
  const m = { radius_km: 25500, albedo: 0.4, dist_AU: 500 };
  const plain = bodyFlux_uJy(m, 3.3);
  const carved = bodyFlux_uJy({ ...m, methane: true }, 3.3);
  assert.ok(rel(carved, 0.1 * plain) < 1e-9);
  assert.ok(rel(bodyFlux_uJy({ ...m, methane: true }, 4.5), bodyFlux_uJy(m, 4.5)) < 1e-6);
});

test('bodyFlux is the sum of the parts', () => {
  const m = { radius_km: 3000, T_K: 900, albedo: 0.3, dist_AU: 40 };
  const p = fluxParts_uJy(m, 4.5);
  assert.ok(p.thermal > 0 && p.reflected > 0);
  assert.ok(rel(bodyFlux_uJy(m, 4.5), p.thermal + p.reflected) < 1e-12);
  assert.ok(rel(p.thermal, thermalFlux_uJy({ T_K: 900, radius_km: 3000, dist_AU: 40, wave_um: 4.5 })) < 1e-12);
  assert.equal(bodyFlux_uJy({}, 4.5), 0);
  assert.equal(bodyFlux_uJy(null, 4.5), 0);
});

test('preset: Planet X is reflected light only, about 7 uJy at 4.5 um', () => {
  const p = presetById('planetx');
  assert.ok(rel(p.model.radius_km, 25500) < 0.01);            // 4 Earth radii
  assert.equal(4 * R_EARTH_KM, p.model.radius_km);
  const parts = fluxParts_uJy(p.model, 4.5);
  assert.ok(parts.thermal < 1e-15, '45 K emits nothing at 4.5 um');
  assert.ok(parts.total > 6.5 && parts.total < 8.5, `got ${parts.total}`);
});

test('preset: cold brown dwarf, blackbody floor and window value', () => {
  const p = presetById('coldbd');
  assert.equal(p.model.dist_AU, 474000);
  // Without the window the preset is the 250 K blackbody worked above: 3.7 uJy.
  const bare = bodyFlux_uJy({ ...p.model, window: null, methane: false }, 4.5);
  assert.ok(rel(bare, 3.716) < 1e-3);
  // With the 400 K window: x = 14387.77 / (4.5 * 400) = 7.99321, exp(x) - 1 = 2959.8,
  //   B = 4.35983e-9 / 2959.8 = 1.4730e-12, F = pi * 1.4730e-12 * 9.7204e-19 = 4.50e-30 = 450 uJy.
  const f = bodyFlux_uJy(p.model, 4.5);
  assert.ok(rel(f, 450) < 0.01, `got ${f}`);
  // WISE 0855-0714: Spitzer [4.5] = 13.89 mag with a 179.7 Jy zero point is about 500 uJy
  // (quoted from memory). The preset should sit within a factor of 3 of that.
  assert.ok(f > 500 / 3 && f < 500 * 3);
  // Almost nothing short of 4 um, as observed.
  assert.ok(bodyFlux_uJy(p.model, 2.0) < 1e-3);
  assert.ok(bodyFlux_uJy(p.model, 3.3) < 0.1);
});

test('preset: dwarf planet is a fraction of a microjansky', () => {
  const p = presetById('dwarf');
  const f = bodyFlux_uJy(p.model, 4.5);
  // 0.1 * F_sun(60 AU) * (100 km / 60 AU)^2 = 0.1 * 1.1118e-16 * 1.24143e-16 = 1.380e-33 = 0.138 uJy
  assert.ok(rel(f, 0.138) < 5e-3, `got ${f}`);
  assert.equal(PRESETS.length, 3);
  assert.equal(presetById('nope'), null);
});

test('scaledSpectrum pins the brightness at the reference wavelength', () => {
  const p = presetById('planetx');
  const s = scaledSpectrum(p.model, 300, 4.5);
  assert.ok(rel(s(4.5), 300) < 1e-12);
  // shape preserved: sunlight is bluer than flat in F_nu
  assert.ok(rel(s(2.0) / s(4.5), bodyFlux_uJy(p.model, 2.0) / bodyFlux_uJy(p.model, 4.5)) < 1e-12);
  assert.ok(s(2.0) > s(4.5));
  // no model, or a model that is dark at the reference: flat spectrum
  assert.equal(scaledSpectrum(null, 50)(1.2), 50);
  assert.equal(scaledSpectrum({ radius_km: 1, T_K: 5, dist_AU: 100 }, 50, 1.0)(3.0), 50);
});
