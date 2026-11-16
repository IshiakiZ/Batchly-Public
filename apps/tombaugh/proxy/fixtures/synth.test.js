// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeSyntheticMef, syntheticSky, syntheticMef, parseSyntheticId, makeTanSip, syntheticSip, fitInverseSip,
  rollToPc, pointingFor, detectorWaveTable, evalSpectrum, zodiModel, tanProject, tanDeproject,
} from './synth.js';
import { parseMef, findHdu, readWaveTable, readUntilPsf } from '../src/fits.js';
import { waveAt } from '../src/wavetab.js';
import { buildFrame, decodeFrame, headerToWcs, parseFrameId } from '../src/encode.js';

const close = (actual, expected, tol, message) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${message ?? 'value'}: ${actual} is not within ${tol} of ${expected}`);

const RAD = Math.PI / 180;

/** Angular separation in arcsec (small angles). */
function sepArcsec(ra1, dec1, ra2, dec2) {
  const dra = (((ra1 - ra2 + 540) % 360) - 180) * Math.cos(((dec1 + dec2) / 2) * RAD);
  return Math.hypot(dra, dec1 - dec2) * 3600;
}

// --- the real IMAGE header of CONTRACT.md -----------------------------------------------------

const REAL_HEADER = new Map(Object.entries({
  NAXIS1: 59, NAXIS2: 59, CTYPE1: 'RA---TAN-SIP', CTYPE2: 'DEC--TAN-SIP',
  CRPIX1: -625.5, CRPIX2: 511.5, CRVAL1: 208.4483499, CRVAL2: 54.5491081503, CDELT1: 1.0, CDELT2: 1.0,
  PC1_1: 0.00123274981054, PC1_2: -0.00118000897293, PC2_1: -0.00117635107879, PC2_2: -0.00123440903284,
  A_ORDER: 3, A_0_0: 0.0905846568112, A_0_1: 0.00142149437078, A_0_2: -2.32575728759e-9,
  A_0_3: 2.12692602413e-11, A_1_0: -0.00040775220791, A_1_1: 3.95116388931e-6, A_1_2: 6.08925674497e-10,
  A_2_0: -7.40546138386e-9, A_2_1: 9.58797339985e-12, A_3_0: 6.24932043516e-10,
  B_ORDER: 3, B_0_0: -1.14138384439, B_0_1: -0.00037568269309, B_0_2: 1.94165517112e-6,
  B_0_3: 4.94514136332e-10, B_1_0: -0.000119205208267, B_1_1: 1.73252607291e-8, B_1_2: -2.05541848269e-11,
  B_2_0: 6.56833753216e-6, B_2_1: 6.30028459135e-10, B_3_0: -1.56259036826e-11,
  AP_ORDER: 3, AP_0_0: -0.092314618979, AP_0_1: -0.00142224960004, AP_0_2: 1.10099113746e-8,
  AP_0_3: -1.97302284155e-11, AP_1_0: 0.000402194977753, AP_1_1: -3.93833797294e-6,
  AP_1_2: -5.84194146156e-10, AP_2_0: 1.65539043149e-8, AP_2_1: -6.46051676537e-12, AP_3_0: -5.97770072336e-10,
  BP_ORDER: 3, BP_0_0: 1.13669351605, BP_0_1: 0.000370299612606, BP_0_2: -1.93170896437e-6,
  BP_0_3: -4.85997193773e-10, BP_1_0: 0.000120546016558, BP_1_1: 3.10385882354e-10, BP_1_2: 2.18904853902e-11,
  BP_2_0: -6.55630767898e-6, BP_2_1: -5.51398355215e-10, BP_3_0: 1.53023228315e-11,
}));

// --- an independent TAN-SIP implementation, written against the FITS header directly ---------
// (vector form of the gnomonic projection, plain loops for the polynomial, finite-difference
//  Newton for the inverse; shares no code with synth.js)

/** FITS (1-based) pixel -> [ra, dec] degrees. */
function independentPixToSky(h, xFits, yFits) {
  const u = xFits - h.get('CRPIX1');
  const v = yFits - h.get('CRPIX2');
  let f = 0;
  let g = 0;
  if (String(h.get('CTYPE1')).endsWith('-SIP')) {
    for (let p = 0; p <= h.get('A_ORDER'); p++) {
      for (let q = 0; p + q <= h.get('A_ORDER'); q++) f += (h.get(`A_${p}_${q}`) ?? 0) * u ** p * v ** q;
    }
    for (let p = 0; p <= h.get('B_ORDER'); p++) {
      for (let q = 0; p + q <= h.get('B_ORDER'); q++) g += (h.get(`B_${p}_${q}`) ?? 0) * u ** p * v ** q;
    }
  }
  const U = u + f;
  const V = v + g;
  const x = h.get('CDELT1') * (h.get('PC1_1') * U + h.get('PC1_2') * V) * RAD; // east, radians
  const y = h.get('CDELT2') * (h.get('PC2_1') * U + h.get('PC2_2') * V) * RAD; // north, radians
  const a0 = h.get('CRVAL1') * RAD;
  const d0 = h.get('CRVAL2') * RAD;
  // Point on the tangent plane = centre + x * east + y * north (unit vectors on the sphere).
  const centre = [Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0)];
  const east = [-Math.sin(a0), Math.cos(a0), 0];
  const north = [-Math.sin(d0) * Math.cos(a0), -Math.sin(d0) * Math.sin(a0), Math.cos(d0)];
  const p = [0, 1, 2].map((i) => centre[i] + x * east[i] + y * north[i]);
  const ra = (Math.atan2(p[1], p[0]) / RAD + 360) % 360;
  const dec = Math.atan2(p[2], Math.hypot(p[0], p[1])) / RAD;
  return [ra, dec];
}

/** [ra, dec] -> FITS (1-based) pixel, by Newton iteration with a numerical Jacobian. */
function independentSkyToPix(h, ra, dec) {
  let x = (h.get('NAXIS1') + 1) / 2;
  let y = (h.get('NAXIS2') + 1) / 2;
  const residual = (px, py) => {
    const [r, d] = independentPixToSky(h, px, py);
    return [(((r - ra + 540) % 360) - 180) * Math.cos(dec * RAD), d - dec];
  };
  for (let iter = 0; iter < 20; iter++) {
    const [f1, f2] = residual(x, y);
    const [ax, ay] = residual(x + 0.5, y);
    const [bx, by] = residual(x, y + 0.5);
    const j11 = (ax - f1) / 0.5;
    const j21 = (ay - f2) / 0.5;
    const j12 = (bx - f1) / 0.5;
    const j22 = (by - f2) / 0.5;
    const det = j11 * j22 - j12 * j21;
    const dx = (f1 * j22 - f2 * j12) / det;
    const dy = (f2 * j11 - f1 * j21) / det;
    x -= dx;
    y -= dy;
    if (Math.abs(dx) + Math.abs(dy) < 1e-9) break;
  }
  return [x, y];
}

/** Open a synthetic MEF: headers, arrays and the decoded TBF1 frame. */
function open(mef, id = 'test') {
  const hdus = parseMef(mef);
  const header = findHdu(hdus, 'IMAGE').header;
  const frame = decodeFrame(buildFrame({ id, u8: mef }));
  return { hdus, header, frame, nx: frame.nx, ny: frame.ny };
}

const BAD_BITS = ~(1 << 21); // everything except SOURCE

/** Flux-weighted centroid and summed flux (MJy/sr) of image - zodi - sky in a box, 0-based pixels. */
function centroid(frame, x0, y0, half = 4, sky = 0.02) {
  let sum = 0;
  let sx = 0;
  let sy = 0;
  for (let y = Math.round(y0) - half; y <= Math.round(y0) + half; y++) {
    for (let x = Math.round(x0) - half; x <= Math.round(x0) + half; x++) {
      if (x < 0 || y < 0 || x >= frame.nx || y >= frame.ny) continue;
      const i = y * frame.nx + x;
      if (!Number.isFinite(frame.image[i]) || frame.flags[i] & BAD_BITS) continue;
      const v = frame.image[i] - frame.zodi[i] - sky;
      sum += v;
      sx += v * x;
      sy += v * y;
    }
  }
  return { x: sx / sum, y: sy / sum, sum };
}

// --- WCS helper ------------------------------------------------------------------------------

test('real-data test vector: FITS pixel (30, 30) of the real header', () => {
  const wcs = makeTanSip(headerToWcs(REAL_HEADER));
  const [ra, dec] = wcs.pixToSky(29, 29); // 0-based pixel 29 = FITS pixel 30
  close(ra, 210.8023, 0.003, 'RA');
  close(dec, 54.349, 0.003, 'Dec');
  // The cutout was requested at (210.80227, 54.34895): its central pixel must contain that point.
  assert.ok(sepArcsec(ra, dec, 210.80227, 54.34895) < 6.15 * Math.SQRT1_2, 'centre pixel holds the requested position');

  // The independent implementation agrees to well under a milliarcsecond.
  const [ra2, dec2] = independentPixToSky(REAL_HEADER, 30, 30);
  assert.ok(sepArcsec(ra, dec, ra2, dec2) < 1e-4);
  close(ra2, 210.8023, 0.003, 'RA (independent)');
  close(dec2, 54.349, 0.003, 'Dec (independent)');

  // Ignoring the SIP terms would move the position by several pixels: they matter.
  const [ra3, dec3] = makeTanSip({ ...headerToWcs(REAL_HEADER), sip: null }).pixToSky(29, 29);
  assert.ok(sepArcsec(ra, dec, ra3, dec3) > 10);
});

test('skyToPix inverts pixToSky exactly, with the real header', () => {
  const wcs = makeTanSip(headerToWcs(REAL_HEADER));
  for (const [x, y] of [[0, 0], [29, 29], [58, 58], [12.3, 45.6], [-200, 300], [-1645, -508], [394, 1531]]) {
    const [ra, dec] = wcs.pixToSky(x, y);
    const [bx, by] = wcs.skyToPix(ra, dec);
    close(bx, x, 1e-6, `x of (${x}, ${y})`);
    close(by, y, 1e-6, `y of (${x}, ${y})`);
    const [ix, iy] = independentSkyToPix(REAL_HEADER, ra, dec);
    close(ix - 1, x, 1e-5, `independent x of (${x}, ${y})`);
    close(iy - 1, y, 1e-5, `independent y of (${x}, ${y})`);
  }
  // Pixel scale and parity: one pixel is 6.15 arcsec (within 1 %), and the determinant of PC is negative.
  const [ra0, dec0] = wcs.pixToSky(29, 29);
  const [ra1, dec1] = wcs.pixToSky(30, 29);
  const [ra2, dec2] = wcs.pixToSky(29, 30);
  close(sepArcsec(ra0, dec0, ra1, dec1), 6.15, 0.06);
  close(sepArcsec(ra0, dec0, ra2, dec2), 6.15, 0.06);
});

test('tanProject / tanDeproject are inverses, also across RA = 0 and near the pole', () => {
  for (const [ra0, dec0] of [[210.8, 54.35], [0.0005, -30], [359.9995, 12], [123, 89.5], [45, -89.2]]) {
    for (const [xi, eta] of [[0, 0], [0.3, -0.2], [-1.7, 1.1], [0.001, 1.9]]) {
      const [ra, dec] = tanDeproject(xi, eta, ra0, dec0);
      assert.ok(ra >= 0 && ra < 360);
      const [bxi, beta] = tanProject(ra, dec, ra0, dec0);
      close(bxi, xi, 1e-10);
      close(beta, eta, 1e-10);
    }
  }
  // East is +xi, north is +eta.
  const [east] = tanDeproject(0.01, 0, 100, 0);
  assert.ok(east > 100);
  assert.ok(tanDeproject(0, 0.01, 100, 20)[1] > 20);
  assert.ok(Number.isNaN(tanProject(280, -54, 100, 54)[0]), 'points behind the tangent plane are not projected');
});

test('the fitted inverse SIP matches the forward polynomial and the real AP/BP', () => {
  const sip = syntheticSip();
  // The forward terms are the real ones.
  assert.equal(sip.a['0_0'], REAL_HEADER.get('A_0_0'));
  assert.equal(sip.b['2_0'], REAL_HEADER.get('B_2_0'));
  // A least-squares inverse of the real forward terms lands on the real inverse terms.
  for (const [name, prefix] of [['ap', 'AP'], ['bp', 'BP']]) {
    for (const [key, value] of Object.entries(sip[name])) {
      const realValue = REAL_HEADER.get(`${prefix}_${key}`);
      const [p, q] = key.split('_').map(Number);
      // Compare the effect of each term at the detector corner, in pixels.
      close(value * 1020 ** (p + q), realValue * 1020 ** (p + q), 0.03, `${prefix}_${key}`);
    }
  }
  // Polynomial-only inversion is good to a few hundredths of a pixel over the whole detector.
  const poly = (coeffs, u, v) =>
    Object.entries(coeffs).reduce((s, [key, c]) => s + c * u ** Number(key[0]) * v ** Number(key[2]), 0);
  let worst = 0;
  for (let u = -1020; u <= 1020; u += 120) {
    for (let v = -1020; v <= 1020; v += 120) {
      const U = u + poly(sip.a, u, v);
      const V = v + poly(sip.b, u, v);
      worst = Math.max(worst, Math.hypot(U + poly(sip.ap, U, V) - u, V + poly(sip.bp, U, V) - v));
    }
  }
  assert.ok(worst < 0.05, `inverse SIP residual ${worst} px`);
  // fitInverseSip of "no distortion" is zero.
  const none = fitInverseSip({}, {}, 2);
  assert.ok(Object.values(none.ap).every((c) => Math.abs(c) < 1e-12));
});

test('pointingFor puts the requested sky position on the requested detector pixel', () => {
  for (const [ra, dec, detX, detY, rollDeg] of [
    [210.80227, 54.34895, 1676, 539, 223.7], [0.0002, -45, 100.25, 1900.75, 12], [359.9999, 66.56, 1999, 40, 301], [83.6, 88.9, 1020.5, 1700, 0], [83.6, -89.6, 1000, 1700, 180],
  ]) {
    const crval = pointingFor({ ra, dec, detX, detY, rollDeg });
    const wcs = makeTanSip({ crpix: [1020.5, 1020.5], crval, pc: rollToPc(rollDeg), cdelt: [1, 1], sip: syntheticSip() });
    const [x, y] = wcs.skyToPix(ra, dec);
    close(x + 1, detX, 1e-6, 'detector x');
    close(y + 1, detY, 1e-6, 'detector y');
    const [bra, bdec] = wcs.pixToSky(detX - 1, detY - 1);
    assert.ok(sepArcsec(bra, bdec, ra, dec) < 1e-5);
  }
  // A degree from the pole, a pixel 1.2 degrees east or west of the detector's central meridian
  // cannot be reached at this roll; that is reported rather than answered wrongly.
  assert.throws(() => pointingFor({ ra: 83.6, dec: 88.9, detX: 300, detY: 300, rollDeg: 90 }), /No pointing/);
  // rollToPc reproduces the PC matrix of the real file at its roll angle and scale.
  const realRoll = Math.atan2(REAL_HEADER.get('PC1_2'), REAL_HEADER.get('PC2_2')) / RAD;
  const pc = rollToPc(realRoll);
  close(pc[0][0], REAL_HEADER.get('PC1_1'), 1e-5);
  close(pc[0][1], REAL_HEADER.get('PC1_2'), 1e-5);
  close(pc[1][0], REAL_HEADER.get('PC2_1'), 1e-5);
  close(pc[1][1], REAL_HEADER.get('PC2_2'), 1e-5);
});

// --- wavelength tables -----------------------------------------------------------------------

test('detector wavelength tables: real layout, monotonic in y, smile in x, right resolving power', () => {
  const bands = [[0.75, 1.09], [1.10, 1.62], [1.63, 2.41], [2.42, 3.82], [3.83, 4.41], [4.42, 5.00]];
  const nodes = [1, 205, 409, 613, 817, 1021, 1224, 1428, 1632, 1836, 2040];
  for (let det = 1; det <= 6; det++) {
    const t = detectorWaveTable(det);
    assert.deepEqual(Array.from(t.x), nodes);
    assert.deepEqual(Array.from(t.y), nodes);
    assert.ok(t.values instanceof Float32Array && t.values.length === 242);
    assert.deepEqual([t.nx, t.ny, t.nk], [11, 11, 2]);
    const [lo, hi] = bands[det - 1];
    for (const x of [1, 333, 1020.5, 1700, 2040]) {
      let previous = Infinity;
      for (let y = 1; y <= 2040; y += 13) {
        const { wave, bandwidth } = waveAt(t, x, y);
        assert.ok(wave < previous, `detector ${det}: wavelength must fall with y (x=${x}, y=${y})`);
        previous = wave;
        const r = wave / bandwidth;
        if (det <= 4) assert.ok(r > 35 && r < 45, `detector ${det}: R = ${r}`);
        else assert.ok(r > 105 && r < 135, `detector ${det}: R = ${r}`);
      }
      // The detector covers its nominal band (with a small margin) in every column.
      assert.ok(waveAt(t, x, 1).wave >= hi && waveAt(t, x, 1).wave < hi * 1.04, `detector ${det} top`);
      assert.ok(waveAt(t, x, 2040).wave <= lo && waveAt(t, x, 2040).wave > lo * 0.97, `detector ${det} bottom`);
    }
    // Smile: about 1 % lower at the centre column than at the edges, symmetric.
    const edge = waveAt(t, 1, 700).wave;
    const centre = waveAt(t, 1021, 700).wave;
    close(centre / edge, 0.9894, 0.001, `detector ${det} smile`);
    close(waveAt(t, 2040, 700).wave, edge, 1e-6);
    assert.equal(detectorWaveTable(det), t, 'tables are cached');
  }
  // Detector 2 against the numbers measured in the real table.
  const d2 = detectorWaveTable(2);
  close(d2.values[0], 1.6677, 1e-6, 'VALUES[0]');
  close(d2.values[1], 0.03979, 1e-5, 'VALUES[1]');
  close(d2.values[2], 1.66112, 3e-4, 'VALUES[2]');
  close(waveAt(d2, 409, 1).wave, 1.6563, 3e-4);
  close(waveAt(d2, 1021, 1).wave, 1.6501, 3e-4);
  close(waveAt(d2, 2040, 1).wave, 1.6675, 3e-4);
  close(waveAt(d2, 1, 2040).wave, 1.095, 1e-6);
  assert.throws(() => detectorWaveTable(7), /detector/);
});

// --- makeSyntheticMef ------------------------------------------------------------------------

test('default pointing reproduces the header geometry of the real file', () => {
  const mef = makeSyntheticMef({ ra: 210.80227, dec: 54.34895, size: 0.1, det: 2, mjd: 61210.79244684, rollDeg: 223.7, obsid: '2026W25_2A_0279_1' });
  const { hdus, header: h } = open(mef);
  assert.equal(hdus[0].header.get('VERSION'), '7.0.5');
  assert.equal(hdus[0].header.get('SIMPLE'), true);
  const expected = {
    NAXIS1: 59, NAXIS2: 59, BITPIX: -32, BUNIT: 'MJy / sr', DETECTOR: 2, OBSID: '2026W25_2A_0279_1', EXPIDN: 202625201027912,
    CTYPE1: 'RA---TAN-SIP', CTYPE2: 'DEC--TAN-SIP', CUNIT1: 'deg', CUNIT2: 'deg', RADESYS: 'ICRS',
    CRPIX1: -625.5, CRPIX2: 511.5, CDELT1: 1, CDELT2: 1, LONPOLE: 180,
    A_ORDER: 3, B_ORDER: 3, AP_ORDER: 3, BP_ORDER: 3,
    'DATE-OBS': '2026-06-19T19:01:07.407', 'MJD-OBS': 61210.79244684, XPOSURE: 113.5826, TIMESYS: 'UTC',
    WCSNAMEW: 'Approximated per-pixel wavelength and bandwidth',
    CTYPE1W: 'WAVE-TAB', CTYPE2W: 'WAVE-TAB', CUNIT1W: 'um', CUNIT2W: 'um', CRPIX1W: -1645, CRPIX2W: -508,
    CDELT1W: 1, CDELT2W: 1, CRVAL1W: 1, CRVAL2W: 1, PV1_3W: 1, PV2_3W: 2,
    PS1_0W: 'WCS-WAVE', PS2_0W: 'WCS-WAVE', PS1_1W: 'VALUES', PS2_1W: 'VALUES', PS1_2W: 'X', PS2_2W: 'Y',
    CTYPE1A: 'LINEAR', CTYPE2A: 'LINEAR', CRPIX1A: -1645, CRPIX2A: -508, CRVAL1A: 0, CRVAL2A: 0,
  };
  for (const [key, value] of Object.entries(expected)) assert.equal(h.get(key), value, key);
  close(h.get('MJD-AVG'), 61210.79311303, 2e-8, 'MJD-AVG');
  close(h.get('MJD-END'), 61210.793779219, 2e-8, 'MJD-END');
  close(h.get('PSF_FWHM'), 7.4607, 1e-3);
  assert.equal(h.get('LATPOLE'), h.get('CRVAL2'));
  assert.equal(h.get('SYNTHETC'), true, 'synthetic files say so');

  // The reference pixel is the detector centre, far outside the cutout.
  assert.ok(h.get('CRPIX1') < 1 || h.get('CRPIX1') > 59);
  // PC carries the 6.15 arcsec scale and the roll angle; parity is the usual sky parity.
  const det = h.get('PC1_1') * h.get('PC2_2') - h.get('PC1_2') * h.get('PC2_1');
  assert.ok(det < 0);
  close(Math.sqrt(-det) * 3600, 6.15, 1e-9, 'pixel scale');
  close(((Math.atan2(h.get('PC1_2'), h.get('PC2_2')) / RAD) + 360) % 360, 223.7, 1e-9, 'roll');
  // With the same roll and detector position the pointing comes out close to the real CRVAL
  // (the real PC matrix is slightly non-orthogonal, so not exactly).
  assert.ok(sepArcsec(h.get('CRVAL1'), h.get('CRVAL2'), 208.4483499, 54.5491081503) < 30);

  // All four image HDUs carry the same WCS; BUNIT differs.
  for (const name of ['FLAGS', 'VARIANCE', 'ZODI']) {
    const other = findHdu(hdus, name).header;
    for (const key of ['CRPIX1', 'CRVAL1', 'PC1_2', 'A_2_0', 'BP_0_1', 'CRPIX2W', 'DETECTOR']) assert.equal(other.get(key), h.get(key), `${name} ${key}`);
  }
  assert.equal(findHdu(hdus, 'VARIANCE').header.get('BUNIT'), 'MJy2 / sr2');
  assert.equal(findHdu(hdus, 'FLAGS').header.get('BITPIX'), 32);

  // The requested position is inside the central pixel (FITS pixel 30, 30).
  const [x, y] = independentSkyToPix(h, 210.80227, 54.34895);
  assert.ok(Math.abs(x - 30) <= 0.5 && Math.abs(y - 30) <= 0.5, `centre at ${x}, ${y}`);
});

test('a source at a known RA/Dec lands on the pixel predicted by an independent TAN-SIP', () => {
  const cases = [
    { ra: 210.80227, dec: 54.34895, det: 2, rollDeg: 223.7, detX: 1676, detY: 539, off: [0.011, -0.007] },
    { ra: 0.0031, dec: -12.5, det: 1, rollDeg: 10, detX: 120.4, detY: 1850.2, off: [-0.004, 0.019] },
    { ra: 269.4521, dec: 4.6934, det: 4, rollDeg: 137, detX: 1950, detY: 90, off: [0.0003, 0.0002] },
    { ra: 270, dec: 66.56, det: 6, rollDeg: 301, detX: 700.5, detY: 1020.5, off: [-0.05, -0.012] },
  ];
  for (const c of cases) {
    const sra = c.ra + c.off[0];
    const sdec = c.dec + c.off[1];
    const fluxUJy = 50000;
    const args = { ...c, size: 0.1, mjd: 61000.25, seed: 5, sources: [{ ra: sra, dec: sdec, fluxUJy }] };

    // Noise-free: the centroid must match to a few thousandths of a pixel.
    const clean = open(makeSyntheticMef({ ...args, noise: false, badPixels: false }));
    const [xFits, yFits] = independentSkyToPix(clean.header, sra, sdec);
    const px = xFits - 1; // 0-based
    const py = yFits - 1;
    assert.ok(px > 3 && px < clean.nx - 4 && py > 3 && py < clean.ny - 4, 'test source must be inside the cutout');
    const got = centroid(clean.frame, px, py);
    close(got.x, px, 0.005, `x centroid, detector ${c.det}`);
    close(got.y, py, 0.005, `y centroid, detector ${c.det}`);
    // The brightest pixel is the predicted one.
    const peak = clean.frame.image.indexOf(Math.max(...clean.frame.image));
    assert.deepEqual([peak % clean.nx, Math.floor(peak / clean.nx)], [Math.round(px), Math.round(py)]);
    // All of the flux is there: 1 MJy/sr in one pixel is 889 microJy.
    close(got.sum * 889, fluxUJy, fluxUJy * 0.002, 'recovered flux');
    // The SOURCE bit (21) is set under the source and nowhere else; no defect bits.
    clean.frame.flags.forEach((f, i) => {
      const d = Math.hypot((i % clean.nx) - px, Math.floor(i / clean.nx) - py);
      assert.equal(f, d <= 2 ? 1 << 21 : 0, `flags at distance ${d}`);
    });

    // With noise and defects: same place within a tenth of a pixel.
    const noisy = open(makeSyntheticMef(args));
    const got2 = centroid(noisy.frame, px, py);
    close(got2.x, px, 0.1, `noisy x centroid, detector ${c.det}`);
    close(got2.y, py, 0.1, `noisy y centroid, detector ${c.det}`);
    // The frame's own WCS, as shipped in TBF1 and used by the browser, agrees too.
    const [wx, wy] = makeTanSip(noisy.frame.wcs).skyToPix(sra, sdec);
    close(wx, px, 1e-5);
    close(wy, py, 1e-5);
  }
});

test('source flux follows the spectrum at the wavelength of the pixel it lands on', () => {
  const ra = 150.1;
  const dec = 2.2;
  const spectrum = (wave) => 3000 * wave ** 3; // steep, so the wavelength matters
  const sources = [
    { ra: ra + 0.02, dec: dec + 0.03, spectrum },
    { ra: ra - 0.03, dec: dec - 0.035, spectrum },
    { ra: ra + 0.01, dec: dec - 0.02, spectrum: { fluxUJy: 8000, refWave: 1.6, teff: 4200 } },
    { ra: ra - 0.02, dec: dec + 0.01, fluxUJy: 12345, catalog: false },
  ];
  const { frame, header } = open(makeSyntheticMef({ ra, dec, size: 0.2, det: 3, rollDeg: 77, detX: 500, detY: 1300, sources, noise: false, badPixels: false }));
  const table = detectorWaveTable(3);
  const seen = [];
  for (const s of sources) {
    const [xf, yf] = independentSkyToPix(header, s.ra, s.dec);
    const got = centroid(frame, xf - 1, yf - 1);
    // Detector position of the source -> wavelength -> expected flux.
    const wave = waveAt(table, frame.detXY0[0] + xf - 1, frame.detXY0[1] + yf - 1).wave;
    close(wave, frame.wave[Math.round(yf - 1) * frame.nx + Math.round(xf - 1)], 2e-3, 'wave array at the source');
    const expected = evalSpectrum(s.spectrum ?? s.fluxUJy, wave);
    close(got.sum * 889, expected, expected * 0.003, 'flux');
    seen.push(wave);
    const flagged = frame.flags[Math.round(yf - 1) * frame.nx + Math.round(xf - 1)] & (1 << 21);
    assert.equal(Boolean(flagged), s.catalog !== false, 'SOURCE bit only for catalogue sources');
  }
  // The two copies of the steep spectrum sit on different rows, hence different wavelengths.
  assert.ok(Math.abs(seen[0] - seen[1]) > 0.01);
  assert.ok(seen.every((w) => w > 1.6 && w < 2.5));

  // evalSpectrum forms.
  assert.equal(evalSpectrum(42, 3), 42);
  assert.equal(evalSpectrum((w) => 2 * w, 3), 6);
  assert.equal(evalSpectrum(null, 3), 0);
  close(evalSpectrum({ fluxUJy: 500, refWave: 2.2, teff: 5000 }, 2.2), 500, 1e-9);
  close(evalSpectrum({ fluxUJy: 500, refWave: 2.2, teff: 5000, scale: 2 }, 2.2), 1000, 1e-9);
  // A 5000 K blackbody in F_nu peaks near 1 um and falls towards 5 um.
  assert.ok(evalSpectrum({ teff: 5000 }, 1.1) > evalSpectrum({ teff: 5000 }, 2.2));
  assert.ok(evalSpectrum({ teff: 5000 }, 2.2) > evalSpectrum({ teff: 5000 }, 4.5));
});

test('background, noise and VARIANCE are consistent', () => {
  const { frame } = open(makeSyntheticMef({ ra: 30, dec: -20, size: 0.2, det: 2, seed: 99, badPixels: false }));
  // ZODI holds the zodiacal model at each pixel's wavelength.
  const mid = Math.floor(frame.ny / 2) * frame.nx + Math.floor(frame.nx / 2);
  close(frame.zodi[mid], zodiModel(frame.wave[mid], frame.mjd), 1e-4);
  assert.ok(frame.zodi.every((z) => z > 0.08 && z < 0.3), 'detector-2 zodi level is realistic');
  assert.ok(frame.variance.every((v) => v > 0.0005 && v < 0.002), 'variance near the real 0.0010');
  // (image - model) / sigma is a unit Gaussian.
  let s1 = 0;
  let s2 = 0;
  const n = frame.image.length;
  for (let i = 0; i < n; i++) {
    const z = (frame.image[i] - frame.zodi[i] - 0.02) / Math.sqrt(frame.variance[i]);
    s1 += z;
    s2 += z * z;
  }
  const mean = s1 / n;
  const std = Math.sqrt(s2 / n - mean * mean);
  close(mean, 0, 0.04, 'mean of normalised residuals');
  close(std, 1, 0.04, 'scatter of normalised residuals');

  // Zodi is brighter in the thermal infrared and noise is larger on the long-wavelength detectors.
  assert.ok(zodiModel(4.8) > zodiModel(3.0));
  assert.ok(zodiModel(1.0) > zodiModel(3.0));
  const d6 = open(makeSyntheticMef({ ra: 30, dec: -20, det: 6, seed: 99, badPixels: false })).frame;
  assert.ok(d6.variance[0] > 2 * frame.variance[0]);

  // Variance grows under a bright source (photon noise).
  const lit = open(makeSyntheticMef({ ra: 30, dec: -20, det: 2, seed: 99, badPixels: false, sources: [{ ra: 30, dec: -20, fluxUJy: 40000 }] })).frame;
  assert.ok(lit.variance[29 * 59 + 29] > 5 * lit.variance[0]);
});

test('bad pixels: flag bits, wild values, fixed to the detector; cosmic rays change', () => {
  const args = { ra: 77, dec: 33, size: 0.2, det: 3, rollDeg: 40, detX: 900, detY: 1500 };
  const a = open(makeSyntheticMef({ ...args, seed: 1 })).frame;
  const b = open(makeSyntheticMef({ ...args, seed: 2 })).frame;
  const where = (frame, bit) => Array.from(frame.flags.keys()).filter((i) => frame.flags[i] & (1 << bit));
  const hot = where(a, 10);
  const cold = where(a, 11);
  const dead = where(a, 6);
  const rays = where(a, 0);
  assert.ok(hot.length >= 3 && cold.length >= 1 && dead.length >= 1 && rays.length >= 1, `hot ${hot.length}, cold ${cold.length}, dead ${dead.length}, rays ${rays.length}`);
  const flagged = hot.length + cold.length + dead.length + rays.length;
  assert.ok(flagged < 0.01 * a.image.length, 'only a few pixels are bad');
  for (const i of hot) assert.ok(a.image[i] > 100, 'hot pixels are wildly high');
  for (const i of cold) assert.ok(a.image[i] < -10, 'cold pixels are wildly low');
  for (const i of dead) assert.ok(Number.isNaN(a.image[i]) && Number.isNaN(a.variance[i]), 'non-functional pixels are NaN');
  for (const i of rays) assert.ok(a.image[i] > 20, 'cosmic-ray hits are high');
  // Every non-finite pixel is flagged, and no unflagged pixel is wild.
  a.image.forEach((v, i) => {
    if (!Number.isFinite(v)) assert.ok(a.flags[i] & (1 << 6));
    else if (a.flags[i] === 0) assert.ok(Math.abs(v) < 2, `unflagged pixel ${i} = ${v}`);
  });
  // Only documented bits are used.
  const used = a.flags.reduce((acc, f) => acc | f, 0);
  assert.equal(used & ~((1 << 0) | (1 << 6) | (1 << 10) | (1 << 11) | (1 << 21)), 0);

  // Detector defects are the same in another exposure; cosmic rays are not.
  assert.deepEqual(where(b, 10), hot);
  assert.deepEqual(where(b, 11), cold);
  assert.deepEqual(where(b, 6), dead);
  assert.notDeepEqual(where(b, 0), rays);
  // A different detector has different defects.
  assert.notDeepEqual(where(open(makeSyntheticMef({ ...args, det: 4, seed: 1 })).frame, 10), hot);
});

test('makeSyntheticMef is deterministic and consistent between overlapping cutouts', () => {
  const sources = [{ ra: 120.004, dec: -5.003, fluxUJy: 7000 }, { ra: 119.99, dec: -4.99, fluxUJy: 900 }];
  const args = { ra: 120, dec: -5, size: 0.1, det: 5, mjd: 60900.5, rollDeg: 310, crval: [120.4, -5.3], sources, seed: 8 };
  const first = makeSyntheticMef(args);
  assert.deepEqual(makeSyntheticMef(args), first, 'same arguments, same bytes');
  const reseeded = open(makeSyntheticMef({ ...args, seed: 9 })).frame;
  const base = open(first).frame;
  assert.notDeepEqual(reseeded.image, base.image, 'another seed, another noise realisation');
  assert.deepEqual(reseeded.zodi, base.zodi);

  // The same exposure cut out around a point 5 pixels away: identical where the two overlap.
  const shifted = open(makeSyntheticMef({ ...args, ra: 120.006, dec: -5.004 })).frame;
  const dx = shifted.detXY0[0] - base.detXY0[0];
  const dy = shifted.detXY0[1] - base.detXY0[1];
  assert.ok((dx !== 0 || dy !== 0) && Math.abs(dx) < 10 && Math.abs(dy) < 10, `shift ${dx}, ${dy}`);
  assert.deepEqual(shifted.wcs.crval, base.wcs.crval);
  let compared = 0;
  for (let y = 0; y < base.ny; y++) {
    for (let x = 0; x < base.nx; x++) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= shifted.nx || sy >= shifted.ny) continue;
      const i = y * base.nx + x;
      const j = sy * shifted.nx + sx;
      assert.equal(shifted.flags[j], base.flags[i]);
      assert.equal(shifted.wave[j], base.wave[i]);
      if (Number.isNaN(base.image[i])) assert.ok(Number.isNaN(shifted.image[j]));
      else close(shifted.image[j], base.image[i], 1e-5 * Math.max(1, Math.abs(base.image[i])));
      compared++;
    }
  }
  assert.ok(compared > 2500);
});

test('cutout sizes and detector edges', () => {
  for (const [size, n] of [[0.02, 12], [0.05, 29], [0.1, 59], [0.15, 88], [0.2, 117]]) {
    const { header } = open(makeSyntheticMef({ ra: 10, dec: 10, size }));
    assert.deepEqual([header.get('NAXIS1'), header.get('NAXIS2')], [n, n], `size ${size}`);
  }
  // Near a detector corner the cutout is clipped, like a real one.
  const mef = makeSyntheticMef({ ra: 10, dec: 10, size: 0.1, detX: 12.2, detY: 2031.6, sources: [{ ra: 10, dec: 10, fluxUJy: 30000 }], noise: false, badPixels: false });
  const { header, frame, hdus } = open(mef);
  assert.deepEqual([frame.nx, frame.ny], [41, 38]); // columns 1..41, rows 2003..2040
  assert.deepEqual(frame.detXY0, [1, 2003]);
  assert.equal(header.get('CRPIX1W'), 1);
  assert.equal(header.get('CRPIX1'), 1020.5);
  assert.equal(hdus[1].dataBytes, 41 * 38 * 4);
  const [xf, yf] = independentSkyToPix(header, 10, 10);
  close(xf, 12.2, 1e-4);
  close(yf, 2031.6 - 2002, 1e-4);
  const got = centroid(frame, xf - 1, yf - 1);
  close(got.x, xf - 1, 0.005);
  close(got.y, yf - 1, 0.005);
  // A position that is not on the detector at all.
  assert.throws(() => makeSyntheticMef({ ra: 10, dec: 10, crval: [10, 14] }), /does not cover/);
  assert.throws(() => makeSyntheticMef({ ra: 10, dec: 10, crval: [190, -10] }), /does not cover/);
  assert.throws(() => makeSyntheticMef({ dec: 10 }), /ra and dec/);
});

// --- syntheticSky ----------------------------------------------------------------------------

const FIELD = [269.4521, 4.6934];
const SKY = syntheticSky(...FIELD);
const PASS_MID = [60837.7, 61020.2, 61202.6];

test('syntheticSky: frame references look like the /search response', () => {
  assert.equal(SKY.frameRefs.length, 252);
  const idPattern = /^ibe\/data\/spherex\/(dr1|qr3)\/level2\/(\d{4}W\d{2}_\d[A-C])\/([^/]+)\/([1-6])\/level2_(\d{4}W\d{2}_\d[A-C]_\d{4}_\d)D([1-6])_spx_([^/]+)\.fits$/;
  const ids = new Set();
  let previous = -Infinity;
  for (const ref of SKY.frameRefs) {
    assert.deepEqual(Object.keys(ref), ['id', 'det', 'mjd', 'release', 'obsid']);
    const m = idPattern.exec(ref.id);
    assert.ok(m, `id does not look like an IRSA uri: ${ref.id}`);
    assert.equal(m[1], ref.release);
    assert.ok(ref.obsid.startsWith(m[2]), 'directory is the obsid prefix');
    assert.equal(m[3], m[7], 'processing version appears twice, as in real uris');
    assert.equal(Number(m[4]), ref.det);
    assert.equal(m[5], ref.obsid);
    assert.equal(Number(m[6]), ref.det);
    // The proxy's own id parser reads the same things out of it.
    assert.deepEqual(parseFrameId(ref.id), { release: ref.release, det: ref.det, obsid: ref.obsid });
    assert.ok(ref.mjd >= previous, 'sorted by mjd');
    previous = ref.mjd;
    ids.add(ref.id);
    assert.deepEqual(parseSyntheticId(ref.id), { ra: FIELD[0], dec: FIELD[1], det: ref.det, obsid: ref.obsid });
  }
  assert.equal(ids.size, 252, 'ids are unique');

  // Three passes (June 2025, December 2025, June 2026), 14 exposures per detector in each.
  const passes = [[]];
  for (const ref of SKY.frameRefs) {
    const current = passes[passes.length - 1];
    if (current.length > 0 && ref.mjd - current[current.length - 1].mjd > 45) passes.push([ref]);
    else current.push(ref);
  }
  assert.equal(passes.length, 3);
  const month = (mjd) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 7);
  assert.deepEqual(passes.map((p) => month(p[0].mjd)), ['2025-06', '2025-12', '2026-06']);
  assert.deepEqual(passes.map((p) => p[0].release), ['dr1', 'dr1', 'qr3']);
  for (const pass of passes) {
    assert.ok(pass[pass.length - 1].mjd - pass[0].mjd < 20, 'a pass lasts days, not months');
    for (let det = 1; det <= 6; det++) assert.equal(pass.filter((r) => r.det === det).length, 14);
    // The observation id carries the year and week of the exposure.
    assert.ok(pass.every((r) => r.obsid.startsWith(month(r.mjd).slice(0, 4))));
  }
  assert.equal(SKY.ra, FIELD[0]);
  assert.equal(SKY.dec, FIELD[1]);
});

test('syntheticSky is deterministic and each field is different', () => {
  assert.equal(syntheticSky(...FIELD), SKY, 'cached');
  assert.equal(syntheticSky(FIELD[0] + 2e-6, FIELD[1] - 3e-6), SKY, 'coordinates are quantised to 1e-5 deg');
  const refs = JSON.stringify(SKY.frameRefs);
  const sources = JSON.stringify(SKY.sourcesAt(61000));
  const bytes = SKY.mefFor(SKY.frameRefs[100].id);
  // Push the field out of the cache, then build it again from scratch.
  for (let i = 1; i <= 20; i++) syntheticSky(FIELD[0] + i * 0.01, FIELD[1]);
  const again = syntheticSky(...FIELD);
  assert.notEqual(again, SKY);
  assert.equal(JSON.stringify(again.frameRefs), refs);
  assert.equal(JSON.stringify(again.sourcesAt(61000)), sources);
  assert.deepEqual(again.mefFor(again.frameRefs[100].id), bytes);

  const other = syntheticSky(10.5, -30.25);
  assert.notEqual(JSON.stringify(other.sourcesAt(61000).map((s) => s.spectrum)), JSON.stringify(SKY.sourcesAt(61000).map((s) => s.spectrum)));
  assert.match(other.frameRefs[0].id, /l2b-syn-r01050000-dm3025000/);
  assert.deepEqual(parseSyntheticId(other.frameRefs[0].id).dec, -30.25);
  // Fields at and next to the celestial poles work too.
  for (const [ra, dec] of [[10, 89.5], [200, -89.95], [0, 90]]) {
    const polar = syntheticSky(ra, dec);
    assert.equal(polar.frameRefs.length, 252);
    const e = polar.exposures[17];
    const frame = decodeFrame(buildFrame({ id: e.id, u8: polar.mefFor(e.id) }));
    const [x, y] = makeTanSip(frame.wcs).skyToPix(polar.ra, polar.dec);
    assert.ok(Math.abs(x - 29) <= 0.5 && Math.abs(y - 29) <= 0.5, `polar field centre at ${x}, ${y}`);
  }
  // RA wraps: 359.999999 is the same field as 0.
  assert.equal(syntheticSky(359.999999, 12).ra, 0);
  assert.equal(parseSyntheticId('ibe/data/spherex/qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits'), null);
});

test('syntheticSky: the cast of sources', () => {
  const sources = SKY.sourcesAt(PASS_MID[0]);
  const kinds = sources.map((s) => s.kind);
  assert.equal(kinds.filter((k) => k === 'star').length, 25);
  for (const kind of ['mover', 'variable', 'methane']) assert.equal(kinds.filter((k) => k === kind).length, 1);
  for (const s of sources) {
    assert.ok(Number.isFinite(s.ra) && Number.isFinite(s.dec));
    assert.ok(sepArcsec(s.ra, s.dec, ...FIELD) < 420, 'sources lie within 7 arcmin of the field centre');
    assert.ok(evalSpectrum(s.spectrum, 1.6) > 0);
  }
  // Enough of them are near the centre for a small field of view to show something.
  assert.ok(sources.filter((s) => sepArcsec(s.ra, s.dec, ...FIELD) < 150).length >= 5);
  const by = (list, kind) => list.find((s) => s.kind === kind);

  // Field stars: smooth blackbody-like spectra, no bands.
  for (const s of sources.filter((x) => x.kind === 'star')) {
    assert.ok(!s.spectrum.bands);
    const f = [1.0, 1.5, 2.2, 3.3, 4.5].map((w) => evalSpectrum(s.spectrum, w));
    assert.ok(f[3] > f[4] && f[2] > f[3], 'Rayleigh-Jeans side falls smoothly');
    assert.ok(f[2] > 30 && f[1] < 40000);
  }

  // Fast mover: starts near the centre, 10.4 arcsec/yr.
  const m0 = by(sources, 'mover');
  assert.ok(sepArcsec(m0.ra, m0.dec, ...FIELD) < 6, 'mover starts near the field centre');
  const m1 = by(SKY.sourcesAt(PASS_MID[0] + 365.25), 'mover');
  close(sepArcsec(m0.ra, m0.dec, m1.ra, m1.dec), 10.4, 0.02, 'proper motion per year');
  assert.ok(m1.dec > m0.dec, 'moving north');
  // Ordinary stars barely move.
  const s0 = by(sources, 'star');
  const s1 = SKY.sourcesAt(PASS_MID[0] + 365.25).find((s) => s.id === s0.id);
  assert.ok(sepArcsec(s0.ra, s0.dec, s1.ra, s1.dec) < 0.05);

  // Variable: a factor of two between passes.
  const v = PASS_MID.map((mjd) => evalSpectrum(by(SKY.sourcesAt(mjd), 'variable').spectrum, 1.6));
  close(v[1] / v[0], 2, 0.03, 'December / June brightness');
  close(v[2] / v[0], 1, 0.03, 'back to the June level a year later');
  const others = PASS_MID.map((mjd) => evalSpectrum(by(SKY.sourcesAt(mjd), 'star').spectrum, 1.6));
  assert.ok(others[0] === others[1] && others[1] === others[2], 'field stars are constant');

  // Methane-like object: deep dip at 3.3 um, bright at 4.5 um, faint in the near infrared.
  const ch4 = by(sources, 'methane').spectrum;
  const f = (w) => evalSpectrum(ch4, w);
  assert.ok(f(3.3) < 0.15 * f(4.5), 'dark in the methane band');
  assert.ok(f(3.3) < 0.2 * f(2.9) && f(3.3) < 0.2 * f(3.7), 'a dip, not just a slope');
  assert.ok(f(4.5) > 2000, 'bright at 4.5 um');
  assert.ok(f(1.2) < 0.2 * f(4.5), 'cold');
  for (const kind of ['mover', 'variable', 'methane']) {
    const s = by(sources, kind);
    assert.ok(sepArcsec(s.ra, s.dec, ...FIELD) < 60, `${kind} is inside a 2 arcmin field`);
  }
  // Nothing sits on top of the special objects, wherever the mover is.
  for (const mjd of PASS_MID) {
    const list = SKY.sourcesAt(mjd);
    for (const special of list.filter((s) => s.kind !== 'star')) {
      for (const s of list) {
        if (s !== special) assert.ok(sepArcsec(s.ra, s.dec, special.ra, special.dec) > 14, `${s.id} crowds ${special.id}`);
      }
    }
  }
});

test('syntheticSky: every exposure has its own roll angle, detector row and wavelength', () => {
  for (const det of [2, 4]) {
    const exposures = SKY.exposures.filter((e) => e.det === det);
    assert.equal(exposures.length, 42);
    assert.equal(new Set(exposures.map((e) => e.rollDeg.toFixed(4))).size, 42, 'distinct roll angles');
    // The spacecraft is flipped between half-year passes.
    const rollOf = (pass) => exposures.find((e) => e.pass === pass).rollDeg;
    close(Math.abs(rollOf(1) - rollOf(0)), 180, 8);

    const frames = exposures.map((e) => decodeFrame(buildFrame({ id: e.id, u8: SKY.mefFor(e.id) })));
    frames.forEach((frame, i) => {
      const e = exposures[i];
      assert.deepEqual([frame.det, frame.nx, frame.ny, frame.obsid, frame.release], [det, 59, 59, e.obsid, e.release]);
      // /search reports the start of the exposure; the frame carries the mid-point.
      close((frame.mjd - e.mjd) * 86400, 57.56, 0.01, 'MJD-AVG minus MJD-OBS in seconds');
      // The field centre is on the planned detector pixel, i.e. in the central cutout pixel.
      close(frame.detXY0[0] + 29, e.detX, 0.5001);
      close(frame.detXY0[1] + 29, e.detY, 0.5001);
      const roll = ((Math.atan2(frame.wcs.pc[0][1], frame.wcs.pc[1][1]) / RAD) + 360) % 360;
      close(roll, e.rollDeg, 1e-9);
      // CRPIX is outside the cutout, as in real data.
      assert.ok(frame.wcs.crpix[0] < 1 || frame.wcs.crpix[0] > frame.nx);
    });
    const rows = new Set(frames.map((f) => f.detXY0[1]));
    assert.equal(rows.size, 42, 'distinct detector rows');
    const [lo, hi] = det === 2 ? [1.10, 1.62] : [2.42, 3.82];
    const waves = frames.map((f) => f.waveCenter).sort((a, b) => a - b);
    assert.equal(new Set(waves).size, 42, 'distinct wavelengths');
    // Within a pass, consecutive exposures are well separated in wavelength.
    for (let pass = 0; pass < 3; pass++) {
      const inPass = frames.filter((_, i) => exposures[i].pass === pass).map((f) => f.waveCenter).sort((a, b) => a - b);
      for (let i = 1; i < inPass.length; i++) assert.ok(inPass[i] - inPass[i - 1] > 0.01 * (hi - lo), `pass ${pass} wavelength step`);
    }
    // Together the exposures sample most of the detector's band.
    assert.ok(waves[0] < lo + 0.12 * (hi - lo) && waves[41] > hi - 0.12 * (hi - lo), `coverage ${waves[0]} .. ${waves[41]}`);
    // Within one pass the 14 exposures already spread over the band.
    const pass0 = frames.filter((_, i) => exposures[i].pass === 0).map((f) => f.waveCenter);
    assert.ok(Math.max(...pass0) - Math.min(...pass0) > 0.7 * (hi - lo));
  }
  // Detectors d and d + 3 share exposures (same sky through a dichroic).
  const d1 = SKY.exposures.filter((e) => e.det === 1);
  const d4 = SKY.exposures.filter((e) => e.det === 4);
  assert.deepEqual(d1.map((e) => [e.mjd, e.obsid, e.rollDeg]), d4.map((e) => [e.mjd, e.obsid, e.rollDeg]));
});

test('syntheticSky: regenerating frames by id, at any cutout centre and size', async () => {
  const ref = SKY.frameRefs.find((r) => r.det === 3);
  const bytes = SKY.mefFor(ref.id);
  assert.deepEqual(SKY.mefFor(ref.id), bytes, 'regenerated bytes are identical');
  assert.deepEqual(syntheticMef(ref.id), bytes, 'the id alone is enough');
  assert.deepEqual(syntheticMef(ref.id, { ra: FIELD[0], dec: FIELD[1], size: 0.1 }), bytes);

  const hdus = parseMef(bytes);
  assert.deepEqual(hdus.map((h) => h.name), ['PRIMARY', 'IMAGE', 'FLAGS', 'VARIANCE', 'ZODI', 'EPSF', 'WCS-WAVE']);
  assert.equal(hdus[1].header.get('MJD-OBS'), ref.mjd);
  assert.equal(hdus[1].header.get('OBSID'), ref.obsid);
  assert.equal(hdus[1].header.get('DETECTOR'), 3);

  // The same path the proxy takes: stream -> head -> TBF1, with the detector table fetched once.
  const head = await readUntilPsf(new Response(bytes).body);
  assert.equal(head.length, hdus[5].headerOffset);
  const frame = decodeFrame(buildFrame({ id: ref.id, u8: head, waveTable: readWaveTable(bytes, hdus[6]) }));
  assert.equal(frame.id, ref.id);
  assert.ok(frame.waveCenter > 1.55 && frame.waveCenter < 2.5);

  // Bigger cutout of the same exposure: same WCS reference, more pixels.
  const big = decodeFrame(buildFrame({ id: ref.id, u8: syntheticMef(ref.id, { size: 0.2 }) }));
  assert.deepEqual([big.nx, big.ny], [117, 117]);
  assert.deepEqual(big.wcs.crval, frame.wcs.crval);
  assert.equal(big.mjd, frame.mjd);
  // Off-centre cutout: the requested point is in its central pixel.
  const ra = FIELD[0] + 0.01;
  const dec = FIELD[1] - 0.008;
  const off = decodeFrame(buildFrame({ id: ref.id, u8: syntheticMef(ref.id, { ra, dec, size: 0.05 }) }));
  const [x, y] = makeTanSip(off.wcs).skyToPix(ra, dec);
  assert.ok(Math.abs(x - 14) <= 0.5 && Math.abs(y - 14) <= 0.5, `centre at ${x}, ${y}`);

  assert.throws(() => SKY.mefFor('nope'), /Unknown synthetic frame/);
  assert.throws(() => syntheticMef('ibe/data/spherex/qr3/level2/x.fits'), /Not a synthetic frame/);
  assert.throws(() => syntheticMef(ref.id, { ra: FIELD[0] + 20, dec: FIELD[1] }), /does not cover/);
});

test('syntheticSky end to end: the mover moves, the variable varies, methane absorbs', () => {
  const load = (e) => decodeFrame(buildFrame({ id: e.id, u8: SKY.mefFor(e.id) }));
  /** Measure a source in a frame: sky position of its centroid and flux in microJy. */
  const measure = (frame, which) => {
    const truth = SKY.sourcesAt(frame.mjd).find((s) => s.kind === which || s.id === which);
    const wcs = makeTanSip(frame.wcs);
    const [px, py] = wcs.skyToPix(truth.ra, truth.dec);
    const c = centroid(frame, px, py, 3);
    const [ra, dec] = wcs.pixToSky(c.x, c.y);
    return { ra, dec, flux: c.sum * 889, truth, wave: frame.wave[Math.round(py) * frame.nx + Math.round(px)], offset: Math.hypot(c.x - px, c.y - py) };
  };
  const pick = (det, pass, count = 4) => SKY.exposures.filter((e) => e.det === det && e.pass === pass).slice(0, count).map(load);
  const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;

  // Mover, detector 2: found where the truth says, and its measured positions a year apart
  // give 10.4 arcsec/yr.
  const early = pick(2, 0).map((f) => ({ f, m: measure(f, 'mover') }));
  const late = pick(2, 2).map((f) => ({ f, m: measure(f, 'mover') }));
  for (const { m } of [...early, ...late]) assert.ok(m.offset < 0.15, `mover centroid off by ${m.offset} px`);
  const pos = (list) => [mean(list.map((x) => x.m.ra)), mean(list.map((x) => x.m.dec)), mean(list.map((x) => x.f.mjd))];
  const [ra1, dec1, t1] = pos(early);
  const [ra2, dec2, t2] = pos(late);
  const rate = sepArcsec(ra1, dec1, ra2, dec2) / ((t2 - t1) / 365.25);
  close(rate, 10.4, 0.3, 'measured proper motion, arcsec/yr');
  // The brightest field star inside the cutouts, measured the same way, stays put.
  const starId = SKY.sourcesAt(t1)
    .filter((s) => s.kind === 'star' && sepArcsec(s.ra, s.dec, ...FIELD) < 120)
    .sort((a, b) => evalSpectrum(b.spectrum, 1.3) - evalSpectrum(a.spectrum, 1.3))[0].id;
  const starPos = (list) => {
    const ms = list.map((x) => measure(x.f, starId));
    return [mean(ms.map((m) => m.ra)), mean(ms.map((m) => m.dec))];
  };
  assert.ok(sepArcsec(...starPos(early), ...starPos(late)) < 0.5, 'field star does not move');

  // Variable, detector 2: December is twice June at matched wavelengths (ratio to the model
  // spectrum removes the colour term).
  const ratioAt = (pass) => mean(pick(2, pass, 8).map((f) => {
    const m = measure(f, 'variable');
    return m.flux / evalSpectrum({ ...m.truth.spectrum, scale: 1 }, m.wave);
  }));
  const june = ratioAt(0);
  close(june, 1, 0.08, 'June level');
  close(ratioAt(1) / june, 2, 0.12, 'December / June');
  close(ratioAt(2) / june, 1, 0.1, 'June again');

  // Methane: detector-4 frames near 3.3 um are dark, detector-6 frames near 4.5 um are bright.
  const d4 = SKY.exposures.filter((e) => e.det === 4).map(load);
  const d6 = SKY.exposures.filter((e) => e.det === 6).map(load);
  const nearest = (frames, wave) => frames.slice().sort((a, b) => Math.abs(a.waveCenter - wave) - Math.abs(b.waveCenter - wave)).slice(0, 3);
  const inBand = mean(nearest(d4, 3.3).map((f) => measure(f, 'methane').flux));
  const continuum = mean(nearest(d4, 3.75).map((f) => measure(f, 'methane').flux));
  const bright = mean(nearest(d6, 4.5).map((f) => measure(f, 'methane').flux));
  close(bright, 2600, 500, 'methane object at 4.5 um, microJy');
  assert.ok(inBand < 0.25 * bright, `3.3 um flux ${inBand} vs 4.5 um ${bright}`);
  assert.ok(inBand < 0.4 * continuum, `3.3 um flux ${inBand} vs 3.75 um ${continuum}`);
});

test('syntheticSky.gaia() is shaped like the /gaia response and agrees with the frames', () => {
  const gaia = SKY.gaia();
  assert.equal(gaia.epoch, 2016.0);
  assert.equal(gaia.stars.length, 27, '25 stars, the mover and the variable; the methane object is too cold for Gaia');
  let previous = -Infinity;
  for (const star of gaia.stars) {
    assert.deepEqual(Object.keys(star), ['id', 'ra', 'dec', 'pmra', 'pmdec', 'parallax', 'gmag']);
    assert.match(star.id, /^\d{15,19}$/);
    assert.equal(star.parallax, null);
    assert.ok(star.gmag > 8 && star.gmag < 24, `gmag ${star.gmag}`);
    assert.ok(star.gmag >= previous, 'brightest first');
    previous = star.gmag;
  }
  assert.equal(new Set(gaia.stars.map((s) => s.id)).size, 27);
  const mover = gaia.stars.find((s) => Math.hypot(s.pmra, s.pmdec) > 5000);
  close(Math.hypot(mover.pmra, mover.pmdec), 10400, 10, 'mover proper motion, mas/yr');

  // Propagating the catalogue from 2016.0 to an observation epoch lands on the rendered sources.
  const mjd = PASS_MID[2];
  const years = (mjd - 57388.5) / 365.25;
  const now = SKY.sourcesAt(mjd).filter((s) => s.kind !== 'methane');
  for (const star of gaia.stars) {
    const dec = star.dec + (star.pmdec / 3.6e6) * years;
    const ra = star.ra + ((star.pmra / 3.6e6) * years) / Math.cos(star.dec * RAD);
    const nearest = Math.min(...now.map((s) => sepArcsec(ra, dec, s.ra, s.dec)));
    assert.ok(nearest < 0.05, `catalogue star ${star.id} is ${nearest} arcsec from any source`);
  }
});
