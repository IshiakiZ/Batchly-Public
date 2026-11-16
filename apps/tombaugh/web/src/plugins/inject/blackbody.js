// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// blackbody.js - how bright would a body be? Pure functions, no DOM.
//
// Two sources of light, both treated as simply as honesty allows:
//
//   thermal    the body glows at its own temperature T. A sphere of radius R seen from distance d
//              covers a solid angle pi (R/d)^2, so   F_nu = pi B_nu(T) (R/d)^2.
//   reflected  the body is lit by the Sun at heliocentric distance r and seen from distance d at
//              small phase angle:   F_nu = p * F_sun(r) * (R/d)^2 * Phi(alpha),
//              with p the geometric albedo, F_sun(r) = pi B_nu(5772 K) (R_sun/r)^2 the solar flux
//              density at the body, and Phi the phase function of a Lambertian sphere (1 at
//              opposition). For a Lambertian sphere p = 2/3 of the Bond albedo.
//
// Units: wavelength in micrometres, temperature in kelvin, sizes in km, distances in AU, flux
// density in microjansky (1 uJy = 1e-32 W m^-2 Hz^-1).
//
// What this is not: a model atmosphere. Real planets and brown dwarfs are far from grey
// blackbodies between 1 and 5 um. Two optional, clearly crude, corrections are provided:
// a methane-like absorption band at 3.3 um (methaneTransmission) and an "atmospheric window"
// (model.window) in which the thermal emission comes from deeper, warmer layers. Numbers from
// this file are order-of-magnitude estimates and the UI must say so.

// ---- constants (CODATA 2018 exact SI values; IAU 2012 and 2015 nominal values) -----------------

export const H_PLANCK = 6.62607015e-34;      // J s
export const C_LIGHT = 2.99792458e8;         // m / s
export const K_BOLTZMANN = 1.380649e-23;     // J / K
export const AU_M = 1.495978707e11;          // m
export const AU_KM = 1.495978707e8;          // km
export const R_SUN_KM = 695700;              // IAU 2015 nominal solar radius
export const T_SUN_K = 5772;                 // IAU 2015 nominal solar effective temperature
export const R_EARTH_KM = 6371;              // mean radius
export const R_JUPITER_KM = 69911;           // mean radius
export const AU_PER_PARSEC = 206264.80624709636;
export const UJY_SI = 1e-32;                 // W m^-2 Hz^-1 per microjansky
/** hc/k in micrometre kelvin: the exponent of the Planck function is this / (wavelength * T). */
export const C2_UM_K = (H_PLANCK * C_LIGHT / K_BOLTZMANN) * 1e6;   // 14387.77 um K
/** The wavelength at which the UI quotes brightness by default. */
export const REF_WAVE_UM = 4.5;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Planck function B_nu(T) at a wavelength: specific intensity per unit frequency,
 *     B_nu = (2 h nu^3 / c^2) / (exp(h nu / k T) - 1),     nu = c / wavelength,
 * in W m^-2 Hz^-1 sr^-1. Returns 0 for T <= 0 and NaN for a wavelength that is not positive.
 * @param {number} T_K @param {number} wave_um
 */
export function planck(T_K, wave_um) {
  if (!(wave_um > 0) || !isNum(wave_um)) return NaN;
  if (!(T_K > 0) || !isNum(T_K)) return 0;
  const lam = wave_um * 1e-6;
  const x = C2_UM_K / (wave_um * T_K);
  const pre = (2 * H_PLANCK * C_LIGHT) / (lam * lam * lam);     // 2 h nu^3 / c^2 = 2 h c / lambda^3
  const den = Math.expm1(x);
  return den === Infinity ? 0 : pre / den;
}

/**
 * Thermal emission of a sphere seen from a distance: F_nu = pi B_nu(T) (R/d)^2, in microjansky.
 * @param {{ T_K: number, radius_km: number, dist_AU: number, wave_um: number }} p
 *   dist_AU is the distance from the observer.
 */
export function thermalFlux_uJy({ T_K, radius_km, dist_AU, wave_um }) {
  if (!(radius_km > 0) || !(dist_AU > 0)) return 0;
  const ratio = radius_km / (dist_AU * AU_KM);
  return (Math.PI * planck(T_K, wave_um) * ratio * ratio) / UJY_SI;
}

/** Flux density of the Sun (a 5772 K blackbody of one solar radius) at a distance, microjansky. */
export function solarFlux_uJy(helioDist_AU, wave_um) {
  return thermalFlux_uJy({ T_K: T_SUN_K, radius_km: R_SUN_KM, dist_AU: helioDist_AU, wave_um });
}

/**
 * Phase function of a Lambertian sphere, normalised to 1 at opposition:
 *     Phi(alpha) = (sin alpha + (pi - alpha) cos alpha) / pi.
 * Beyond 30 AU the phase angle never exceeds 2 degrees and Phi stays above 0.999.
 * @param {number} phase_deg Sun-body-observer angle, 0..180
 */
export function lambertPhase(phase_deg) {
  const a = Math.min(Math.PI, Math.max(0, (isNum(phase_deg) ? phase_deg : 0) * Math.PI / 180));
  return (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI;
}

/**
 * Sunlight reflected by a sphere, in microjansky.
 * @param {{ albedo: number, radius_km: number, helioDist_AU: number, geoDist_AU?: number,
 *           wave_um: number, phase_deg?: number }} p
 *   albedo is the GEOMETRIC albedo (Neptune: 0.41 in visible light). geoDist_AU defaults to
 *   helioDist_AU, which is right to 1/helioDist for SPHEREx (it observes near quadrature).
 */
export function reflectedFlux_uJy({ albedo, radius_km, helioDist_AU, geoDist_AU, wave_um, phase_deg = 0 }) {
  if (!(albedo > 0) || !(radius_km > 0) || !(helioDist_AU > 0)) return 0;
  const d = geoDist_AU > 0 ? geoDist_AU : helioDist_AU;
  const ratio = radius_km / (d * AU_KM);
  return albedo * solarFlux_uJy(helioDist_AU, wave_um) * ratio * ratio * lambertPhase(phase_deg);
}

/**
 * Transmission of a methane-like absorption band: a Gaussian dip centred on the 3.3 um
 * fundamental. A cartoon of the real band (which is a forest of lines with broad wings), meant
 * only to give the planted source the kind of spectral feature the tool's methane lens looks for.
 * @param {number} wave_um
 * @param {{ depth?: number, center_um?: number, fwhm_um?: number }} [band]
 * @returns {number} 1 away from the band, 1 - depth at its centre
 */
export function methaneTransmission(wave_um, { depth = 0.9, center_um = 3.3, fwhm_um = 0.45 } = {}) {
  const s = fwhm_um / 2.3548200450309493;
  const u = (wave_um - center_um) / s;
  return 1 - Math.min(1, Math.max(0, depth)) * Math.exp(-0.5 * u * u);
}

/** Smooth 0..1 weight of an atmospheric window between lo_um and hi_um (edges 0.08 um soft). */
function windowWeight(wave_um, win) {
  const soft = win.soft_um > 0 ? win.soft_um : 0.08;
  const up = 1 / (1 + Math.exp(-(wave_um - win.lo_um) / soft));
  const down = 1 / (1 + Math.exp((wave_um - win.hi_um) / soft));
  return up * down;
}

/**
 * The parts of a body's brightness at one wavelength.
 *
 * model = {
 *   radius_km, dist_AU,            // size and HELIOCENTRIC distance (required)
 *   geoDist_AU?,                   // distance from the observer; defaults to dist_AU
 *   T_K?,                          // temperature for the thermal part (omit or 0: none)
 *   albedo?,                       // geometric albedo for the reflected part (omit or 0: none)
 *   phase_deg?,                    // phase angle, default 0
 *   methane?: boolean | { depth, center_um, fwhm_um },   // carve the 3.3 um band out of both parts
 *   window?: { lo_um, hi_um, T_K } // inside this band the thermal part uses this brightness
 *                                  // temperature instead of T_K (see the brown dwarf preset)
 * }
 * @returns {{ thermal: number, reflected: number, total: number }} microjansky
 */
export function fluxParts_uJy(model, wave_um) {
  const m = model || {};
  const geo = m.geoDist_AU > 0 ? m.geoDist_AU : m.dist_AU;
  let thermal = 0;
  if (m.T_K > 0) {
    thermal = thermalFlux_uJy({ T_K: m.T_K, radius_km: m.radius_km, dist_AU: geo, wave_um });
    const win = m.window;
    if (win && win.T_K > 0 && win.hi_um > win.lo_um) {
      const w = windowWeight(wave_um, win);
      const deep = thermalFlux_uJy({ T_K: win.T_K, radius_km: m.radius_km, dist_AU: geo, wave_um });
      thermal = (1 - w) * thermal + w * deep;
    }
  }
  let reflected = 0;
  if (m.albedo > 0) {
    reflected = reflectedFlux_uJy({
      albedo: m.albedo, radius_km: m.radius_km, helioDist_AU: m.dist_AU, geoDist_AU: geo,
      wave_um, phase_deg: m.phase_deg || 0,
    });
  }
  if (m.methane) {
    const t = methaneTransmission(wave_um, typeof m.methane === 'object' ? m.methane : undefined);
    thermal *= t;
    reflected *= t;
  }
  if (!isNum(thermal)) thermal = 0;
  if (!isNum(reflected)) reflected = 0;
  return { thermal, reflected, total: thermal + reflected };
}

/** Thermal plus reflected brightness of a body at one wavelength, microjansky. See fluxParts_uJy. */
export function bodyFlux_uJy(model, wave_um) {
  return fluxParts_uJy(model, wave_um).total;
}

/**
 * A spectrum with the shape of `model` but scaled to a chosen brightness at one wavelength:
 * returns fluxAt(wave_um) -> microjansky with fluxAt(refWave_um) = flux_uJy. If the model emits
 * nothing measurable at the reference wavelength (or no model is given) the spectrum is flat in
 * F_nu, which is the neutral choice.
 */
export function scaledSpectrum(model, flux_uJy, refWave_um = REF_WAVE_UM) {
  const ref = model ? bodyFlux_uJy(model, refWave_um) : 0;
  if (!(ref > 1e-300) || !isNum(ref)) return () => flux_uJy;
  return (wave_um) => {
    const f = bodyFlux_uJy(model, wave_um);
    return isNum(f) ? (flux_uJy * f) / ref : 0;
  };
}

/**
 * Presets for the injection test. `model` feeds bodyFlux_uJy; `caveat` is shown beside any
 * number computed from it.
 *
 * planetx   A Neptune-size planet (4 Earth radii) at 500 AU with a geometric albedo of 0.4 at
 *           every wavelength and 45 K of internal heat. At 1 to 5 um it shines only by reflected
 *           sunlight: 45 K emits nothing here. The grey albedo is generous: cold giant planets
 *           absorb strongly in the infrared.
 * coldbd    A Jupiter-size brown dwarf with an effective temperature of 250 K at 2.3 pc, the
 *           size, temperature and distance usually quoted for WISE 0855-0714. As a plain 250 K
 *           blackbody it would give only about 4 uJy at 4.5 um. The real object is roughly a
 *           hundred times brighter there (Spitzer [4.5] = 13.9 mag, about 500 uJy; quoted from
 *           memory, to be verified), because 4 to 5 um is an opacity window that looks down to
 *           warmer layers. The preset imitates that with a 400 K brightness temperature between
 *           3.9 and 5.2 um, and carves the methane band at 3.3 um.
 * dwarf     An icy body 100 km in radius at 60 AU with a geometric albedo of 0.1.
 */
export const PRESETS = [
  {
    id: 'planetx',
    label: 'Planet X at 500 AU',
    short: 'A Neptune-size planet at 500 AU',
    model: { radius_km: 4 * R_EARTH_KM, T_K: 45, albedo: 0.4, dist_AU: 500 },
    caveat: 'reflected sunlight with a grey albedo of 0.4, which is generous in the infrared',
  },
  {
    id: 'coldbd',
    label: 'Cold brown dwarf at 2.3 pc',
    short: 'A 250 K brown dwarf at 2.3 pc',
    model: {
      radius_km: R_JUPITER_KM, T_K: 250, albedo: 0, dist_AU: 474000, methane: true,
      window: { lo_um: 3.9, hi_um: 5.2, T_K: 400 },
    },
    caveat: 'a 250 K blackbody with a 400 K window at 4 to 5 µm, a rough stand-in for a real atmosphere',
  },
  {
    id: 'dwarf',
    label: 'Dwarf planet at 60 AU',
    short: 'An icy body 100 km in radius at 60 AU',
    model: { radius_km: 100, T_K: 40, albedo: 0.1, dist_AU: 60 },
    caveat: 'reflected sunlight with a grey albedo of 0.1',
  },
];

/** Look a preset up by id (null if unknown). */
export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}
