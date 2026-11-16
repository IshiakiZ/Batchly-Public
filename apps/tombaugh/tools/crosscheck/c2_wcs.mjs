// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Check 2, Node half: world coordinates. Runs web/src/core/wcs.js (makeWcs, tanProject,
// tanDeproject, angSep, parseCoord, formatCoord, grid functions) and proxy/src/focalplane.js on
// fixed lattices and writes inputs and outputs to c2_wcs.json. The lattices are written out with
// the results so that the Astropy half evaluates exactly the same points.
//
// Pixel convention of everything dumped here: OUR convention, 0-based, first pixel centre (0, 0).
// The Astropy half passes origin = 0 to all_pix2world / all_world2pix, and separately repeats the
// forward transform with FITS 1-based pixels and origin = 1 to show that the two agree.

import { makeWcs, tanProject, tanDeproject, angSep, parseCoord, formatCoord, makeGrid, gridPixToSky, gridSkyToPix } from '../../web/src/core/wcs.js';
import { parseMef, findHdu } from '../../proxy/src/fits.js';
import { headerToWcs } from '../../proxy/src/encode.js';
import { CASES, REAL, realHeaderMap, readBytes, writeJson, linspace, rng, log } from './lib.mjs';

const out = { subjects: [] };

function lattice(xs, ys) {
  const x = [];
  const y = [];
  for (const yy of ys) for (const xx of xs) { x.push(xx); y.push(yy); }
  return { x, y };
}

function subject(name, header, center) {
  const wcsObj = headerToWcs(header);
  const w = makeWcs(wcsObj);
  const nx = header.get('NAXIS1');
  const ny = header.get('NAXIS2');
  const [c1, c2] = wcsObj.crpix;
  const s = { name, nx, ny, wcs: wcsObj, hasSip: w.hasSip, pix: {}, sky: {} };

  const pixLattices = {
    // every half pixel of the cutout, edge to edge
    cutout: lattice(linspace(-0.5, nx - 0.5, 2 * nx + 1), linspace(-0.5, ny - 0.5, 2 * ny + 1)),
    // the whole 2040 x 2040 detector the cutout was taken from (CRPIX is its centre)
    detector: lattice(linspace(c1 - 1 - 1019.5, c1 - 1 + 1019.5, 61), linspace(c2 - 1 - 1019.5, c2 - 1 + 1019.5, 61)),
    // well outside the detector: +-1600 pixels about CRPIX
    beyond: lattice(linspace(c1 - 1 - 1600, c1 - 1 + 1600, 33), linspace(c2 - 1 - 1600, c2 - 1 + 1600, 33)),
  };
  for (const [key, lat] of Object.entries(pixLattices)) {
    const ra = [];
    const dec = [];
    const rx = [];
    const ry = [];
    for (let i = 0; i < lat.x.length; i++) {
      const [a, d] = w.pixToSky(lat.x[i], lat.y[i]);
      ra.push(a);
      dec.push(d);
      const [bx, by] = w.skyToPix(a, d); // round trip through our own inverse
      rx.push(bx);
      ry.push(by);
    }
    s.pix[key] = { ...lat, ra, dec, rx, ry };
  }

  const cosd = Math.cos((center[1] * Math.PI) / 180);
  const [v1, v2] = wcsObj.crval;
  const cosv = Math.cos((v2 * Math.PI) / 180);
  const skyLattices = {
    // a plain RA/Dec lattice, +-0.06 deg about the cutout centre
    cutout: lattice(linspace(center[0] - 0.06 / cosd, center[0] + 0.06 / cosd, 41), linspace(center[1] - 0.06, center[1] + 0.06, 41)),
    // +-1.5 deg about CRVAL: most of the detector
    detector: lattice(linspace(v1 - 1.5 / cosv, v1 + 1.5 / cosv, 41), linspace(v2 - 1.5, v2 + 1.5, 41)),
  };
  for (const [key, lat] of Object.entries(skyLattices)) {
    const x = [];
    const y = [];
    for (let i = 0; i < lat.x.length; i++) {
      const [px, py] = w.skyToPix(lat.x[i], lat.y[i]);
      x.push(px);
      y.push(py);
    }
    s.sky[key] = { ra: lat.x, dec: lat.y, x, y };
  }
  out.subjects.push(s);
  return w;
}

// ---- TAN-SIP: the three synthetic files and the real header -------------------------------------

for (const c of CASES) {
  const hdus = parseMef(readBytes(`${c.name}.fits`));
  subject(c.name, findHdu(hdus, 'IMAGE').header, [c.args.ra, c.args.dec]);
}
const realWcs = subject('real', realHeaderMap(), REAL.center);

// The contract's real test vector: FITS pixel (30, 30) is JS pixel (29, 29).
{
  const [fx, fy] = REAL.testVector.fitsPixel;
  const [ra, dec] = realWcs.pixToSky(fx - 1, fy - 1);
  out.testVector = { fitsPixel: [fx, fy], ra, dec };
}

// ---- tanProject / tanDeproject / angSep ----------------------------------------------------------

{
  const r = rng(20261115);
  const tan = { ra0: [], dec0: [], ra: [], dec: [], xi: [], eta: [], xiIn: [], etaIn: [], raOut: [], decOut: [] };
  const N = 3000;
  for (let i = 0; i < N; i++) {
    let ra0 = r() * 360;
    let dec0 = Math.asin(2 * r() - 1) * (180 / Math.PI);
    if (i % 100 === 0) dec0 = 90; // tangent point exactly at a pole
    if (i % 100 === 1) dec0 = -90;
    if (i % 100 === 2) ra0 = 359.9999; // RA wrap
    if (i % 100 === 3) { ra0 = 0; dec0 = 0; }
    // offsets from micro-arcseconds to 60 degrees, log-uniform, in a random direction
    const rho = 10 ** (-9 + r() * (Math.log10(60) + 9));
    const th = r() * 2 * Math.PI;
    const xiIn = rho * Math.cos(th);
    const etaIn = rho * Math.sin(th);
    const [raOut, decOut] = tanDeproject(xiIn, etaIn, ra0, dec0);
    // forward: project a point given in RA/Dec (use the deprojected point, rounded to 1e-9 deg so
    // the input is an independent set of decimal numbers)
    const ra = Number(raOut.toFixed(9));
    const dec = Number(decOut.toFixed(9));
    const [xi, eta] = tanProject(ra, dec, ra0, dec0);
    tan.ra0.push(ra0); tan.dec0.push(dec0); tan.ra.push(ra); tan.dec.push(dec); tan.xi.push(xi); tan.eta.push(eta);
    tan.xiIn.push(xiIn); tan.etaIn.push(etaIn); tan.raOut.push(raOut); tan.decOut.push(decOut);
  }
  out.tan = tan;

  const sep = { ra1: [], dec1: [], ra2: [], dec2: [], sep: [] };
  for (let i = 0; i < N; i++) {
    const ra1 = r() * 360;
    const dec1 = Math.asin(2 * r() - 1) * (180 / Math.PI);
    let ra2;
    let dec2;
    if (i % 3 === 0) {
      ra2 = r() * 360;
      dec2 = Math.asin(2 * r() - 1) * (180 / Math.PI);
    } else if (i % 3 === 1) {
      const d = 10 ** (-10 + r() * 9); // tiny separations
      ra2 = ra1 + d * (2 * r() - 1) / Math.max(0.01, Math.cos((dec1 * Math.PI) / 180));
      dec2 = Math.max(-90, Math.min(90, dec1 + d * (2 * r() - 1)));
    } else {
      const d = 10 ** (-8 + r() * 7); // close to the antipode
      ra2 = ra1 + 180 + d;
      dec2 = Math.max(-90, Math.min(90, -dec1 + d * (2 * r() - 1)));
    }
    sep.ra1.push(ra1); sep.dec1.push(dec1); sep.ra2.push(ra2); sep.dec2.push(dec2); sep.sep.push(angSep(ra1, dec1, ra2, dec2));
  }
  out.sep = sep;
}

// ---- the Grid (common north-up raster) -----------------------------------------------------------

{
  const grids = [
    makeGrid(269.452075, 4.693391, 4),     // Barnard's Star, default scale
    makeGrid(0.004, -72.3, 6),             // RA wrap, far south
    makeGrid(210.80227, 54.34895, 10, 6.15),
    makeGrid(123.4, 89.95, 4),             // 3 arcmin from the pole
    makeGrid(45, -89.99, 2),
  ];
  out.grids = grids.map((grid) => {
    const c = (grid.n - 1) / 2;
    const lat = lattice(linspace(-0.5, grid.n - 0.5, 23), linspace(-0.5, grid.n - 0.5, 23));
    const ra = [];
    const dec = [];
    const bx = [];
    const by = [];
    for (let i = 0; i < lat.x.length; i++) {
      const [a, d] = gridPixToSky(grid, lat.x[i], lat.y[i]);
      ra.push(a);
      dec.push(d);
      // sky -> pixel on an independent input: the same position rounded to 1e-9 deg
      const [px, py] = gridSkyToPix(grid, Number(a.toFixed(9)), Number(d.toFixed(9)));
      bx.push(px);
      by.push(py);
    }
    return { grid, centre: c, x: lat.x, y: lat.y, ra, dec, skyRa: ra.map((v) => Number(v.toFixed(9))), skyDec: dec.map((v) => Number(v.toFixed(9))), bx, by };
  });
}

// ---- coordinate strings ---------------------------------------------------------------------------

{
  // `astropy` says how the Python side must read the same text: unit of the first angle, and
  // optionally a rewritten string for forms Astropy does not parse.
  const strings = [
    { text: '269.45 4.69', units: 'deg' },
    { text: '17h57m48.5s +04d41m36s', units: 'hourangle' },
    { text: '17:57:48.5 +04:41:36', units: 'hourangle' },
    { text: '08h55m10.831s -7d14m42.53s', units: 'hourangle' },
    { text: '17 57 48.5 +04 41 36', units: 'hourangle' },
    { text: 'J085510.83-071442.5', units: 'hourangle', astropy: '08 55 10.83 -07 14 42.5' },
    { text: '00h00m00.5s -00d00m30s', units: 'hourangle' },
    { text: '00:00:02 -00:00:01.5', units: 'hourangle' },
    { text: '23h59m59.99s +89d59m59.9s', units: 'hourangle' },
    { text: '10.5, -0.25', units: 'deg', astropy: '10.5 -0.25' },
    { text: '359.99999 -89.99999', units: 'deg' },
    { text: '14h29m43s -62d40m46s', units: 'hourangle' },
  ];
  out.parse = strings.map((s) => ({ ...s, result: parseCoord(s.text) }));

  const r = rng(7);
  out.format = [];
  for (let i = 0; i < 300; i++) {
    const ra = i === 0 ? 359.999999 : i === 1 ? 0 : r() * 360;
    const dec = i === 0 ? -0.00001 : i === 1 ? 89.99999 : Math.asin(2 * r() - 1) * (180 / Math.PI);
    out.format.push({ ra, dec, ...formatCoord(ra, dec) });
  }
}

// ---- focalplane.js: plain TAN used by the exposure index ------------------------------------------

try {
  const fp = await import('../../proxy/src/focalplane.js');
  out.focalplane = REAL.focalPlane.detectors.map((d) => {
    const wcs = { crval: d.crval, pc: d.pc, crpix: [REAL.focalPlane.crpix, REAL.focalPlane.crpix] };
    const lat = lattice(linspace(1, 2040, 21), linspace(1, 2040, 21)); // 1-based detector pixels
    const ra = [];
    const dec = [];
    const bx = [];
    const by = [];
    for (let i = 0; i < lat.x.length; i++) {
      const [a, dd] = fp.detPixToSky(wcs, lat.x[i], lat.y[i]);
      ra.push(a);
      dec.push(dd);
      const p = fp.skyToDetPix(wcs, Number(a.toFixed(9)), Number(dd.toFixed(9)));
      bx.push(p ? p[0] : NaN);
      by.push(p ? p[1] : NaN);
    }
    return { det: d.det, crval: d.crval, pc: d.pc, crpix: REAL.focalPlane.crpix, x: lat.x, y: lat.y, ra, dec, skyRa: ra.map((v) => Number(v.toFixed(9))), skyDec: dec.map((v) => Number(v.toFixed(9))), bx, by };
  });
} catch (err) {
  out.focalplane = null;
  out.focalplaneError = String(err && err.message ? err.message : err);
}

writeJson('c2_wcs.json', out);
log(`check 2: ${out.subjects.length} WCS subjects, ${out.tan.ra.length} projection points, ${out.grids.length} grids, focalplane ${out.focalplane ? 'present' : 'absent'}`);
