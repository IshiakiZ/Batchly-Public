// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// tools/validate-synthetic.mjs - run the whole science chain on the synthetic sky, where the
// truth is known, without a browser and without the network, and compare what comes out with
// what was put in.
//
//   node tools/validate-synthetic.mjs [--ra 150.1] [--dec 2.2] [--fov 6] [--det 3] [--no-write] [--quiet]
//
// The chain is the one the page runs: the proxy handler (synthetic backend, called in-process)
// builds FITS files, parses them and encodes TBF1 frames; web/src/api.js decodes them;
// web/src/loader.js fetches and reprojects every exposure; core/stack.js stacks the passes;
// core/skymodel.js fits the static sky and lists candidates; core/astrometry.js and
// core/photometry.js measure them, driven by web/src/plugins/validate/. The truth comes
// straight from proxy/fixtures/synth.js (the object list of syntheticSky), never from the
// measurement side.
//
// Prints a table, writes docs/VALIDATION-SYNTHETIC.md, and exits 1 when a check is outside its
// stated tolerance (2 when the chain could not run), so it doubles as an end-to-end regression
// test.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_FILE = path.join(ROOT, 'docs', 'VALIDATION-SYNTHETIC.md');
const RETRIES = 4;
const RETRY_WAIT_MS = Number(process.env.TOMBAUGH_VALIDATE_WAIT_MS) || 180000;

const MODULES = {
  handler: 'proxy/src/handler.js',
  cache: 'proxy/src/cache.js',
  synth: 'proxy/fixtures/synth.js',
  api: 'web/src/api.js',
  loader: 'web/src/loader.js',
  wcs: 'web/src/core/wcs.js',
  frames: 'web/src/core/frames.js',
  stack: 'web/src/core/stack.js',
  skymodel: 'web/src/core/skymodel.js',
  astrometry: 'web/src/core/astrometry.js',
  photometry: 'web/src/core/photometry.js',
  pipeline: 'web/src/pipeline.js',
  measure: 'web/src/plugins/validate/measure.js',
  report: 'web/src/plugins/validate/report.js',
};

function parseArgs(argv) {
  const opts = { ra: 150.1, dec: 2.2, fov: 6, det: 3, write: true, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-write') opts.write = false;
    else if (a === '--quiet') opts.quiet = true;
    else if (['--ra', '--dec', '--fov', '--det'].includes(a)) opts[a.slice(2)] = Number(argv[++i]);
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Import every module of the chain; if one is missing, wait and retry, then say exactly which. */
async function importChain(log) {
  let missing = [];
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const mods = {};
    missing = [];
    for (const [name, rel] of Object.entries(MODULES)) {
      try {
        mods[name] = await import(`${pathToFileURL(path.join(ROOT, rel)).href}${attempt ? `?retry=${attempt}` : ''}`);
      } catch (err) {
        missing.push(`${rel}: ${err && err.message ? err.message.split('\n')[0] : err}`);
      }
    }
    if (!missing.length) return mods;
    if (attempt < RETRIES) {
      log(`Cannot import ${missing.length} module(s); retry ${attempt + 1} of ${RETRIES} in ${Math.round(RETRY_WAIT_MS / 1000)} s:`);
      for (const m of missing) log(`  ${m}`);
      await sleep(RETRY_WAIT_MS);
    }
  }
  const err = new Error(`The chain is blocked by:\n  ${missing.join('\n  ')}`);
  err.blocked = true;
  throw err;
}

const MINUS = '−';
function num(v, d = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'n/a';
  const r = Number(v.toFixed(d));
  return `${r < 0 ? MINUS : ''}${Math.abs(r).toFixed(d)}`;
}
function signed(v, d = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'n/a';
  const t = num(v, d);
  return t.startsWith(MINUS) || Number(v.toFixed(d)) === 0 ? t : `+${t}`;
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('node tools/validate-synthetic.mjs [--ra deg] [--dec deg] [--fov arcmin] [--det 1-6] [--no-write] [--quiet]');
    return 0;
  }
  const log = (...args) => { if (!opts.quiet) console.log(...args); };
  const started = Date.now();
  const M = await importChain(log);
  const { makeGrid, gridSkyToPix, gridPixToSky } = M.wcs;

  // The handler rounds field centres to 1e-4 deg; keep to that so that truth and data agree.
  const ra = Math.round(opts.ra * 1e4) / 1e4;
  const dec = Math.round(opts.dec * 1e4) / 1e4;
  const det = opts.det;
  const fov = opts.fov;
  const spectralDets = [4]; // carries the 3.3 um methane band and its continuum (core/lenses.js)
  const dets = [det, ...spectralDets.filter((d) => d !== det)];

  // ---- the proxy, in-process ------------------------------------------------------------------
  const handler = M.handler.createHandler({
    backend: 'synthetic', cache: M.cache.createMemoryCache(), fetchImpl: () => Promise.reject(new Error('no network in this test')),
    syntheticLatencyMs: 0, log: () => {},
  });
  let requests = 0;
  const fetchImpl = (url, init = {}) => {
    requests++;
    return handler(new Request(url, { method: init.method || 'GET', signal: init.signal }));
  };
  const api = M.api.createApi('http://tombaugh.test/api', { fetchImpl });
  const health = await api.health();
  log(`Proxy handler in-process: backend ${health.backend || 'synthetic'}, version ${health.version}`);

  // ---- load: search, fetch, decode, reproject -------------------------------------------------
  const loader = M.loader.createLoader({ api, backoffMs: 5 });
  const layersByDet = new Map();
  const frames = [];
  const loadInfo = {};
  let grid = null;
  for (const d of dets) {
    const res = await loader.load({ ra, dec, fov, det: d });
    grid = res.grid;
    layersByDet.set(d, res.layers);
    for (const f of res.frames) frames.push(f);
    loadInfo[d] = { refs: res.refs.length, frames: res.frames.length, failed: res.failed, skipped: res.skipped || 0 };
    log(`Detector ${d}: ${res.frames.length} of ${res.refs.length} exposures fetched, decoded and reprojected (${res.failed} failed)`);
  }
  if (!grid) grid = makeGrid(ra, dec, fov);
  const gaia = await api.gaia(ra, dec, 0.12);
  log(`Gaia (synthetic): ${gaia.stars.length} stars, epoch ${gaia.epoch}; ${requests} requests to the handler`);

  // ---- truth, from the fixture ----------------------------------------------------------------
  const sky = M.synth.syntheticSky(ra, dec);
  const object = (id) => sky.objects.find((o) => o.id === id);
  const mover = object('mover');
  const variable = object('variable');
  const methane = object('methane');
  if (!mover || !variable || !methane) throw new Error('proxy/fixtures/synth.js no longer has objects with ids mover, variable and methane');
  const truthAt = (id, mjd) => sky.sourcesAt(mjd).find((s) => s.id === id);
  const moverTruth = {
    pmra: mover.pmE * 1000, pmdec: mover.pmN * 1000, total: Math.hypot(mover.pmE, mover.pmN) * 1000,
    paDeg: ((Math.atan2(mover.pmE, mover.pmN) * 180) / Math.PI + 360) % 360,
  };
  const exposures = sky.exposures.filter((e) => e.det === det);
  const passesOfDet = M.frames.splitPasses(exposures);
  const variableScale = passesOfDet.map((pass) => mean(pass.map((e) => variable.scaleAt(e.mjd))));
  // Depth of the methane band of the injected spectrum, by the same definition the tool uses:
  // 1 - mean(band) / mean of the continuum windows, each averaged over wavelength.
  const band = M.measure.METHANE_BAND;
  const windowMean = ([lo, hi]) => {
    const v = [];
    for (let k = 0; k < 200; k++) v.push(M.synth.evalSpectrum(methane.spectrum, lo + ((k + 0.5) / 200) * (hi - lo)));
    return mean(v);
  };
  const methaneTruth = 1 - windowMean(band.band) / mean(band.continuum.map(windowMean));

  // ---- sky model and candidates, as the page makes them ---------------------------------------
  const layers = layersByDet.get(det);
  const lib = {
    normalizeBackground: M.stack.normalizeBackground, fitSkyModel: M.skymodel.fitSkyModel,
    residualLayer: M.skymodel.residualLayer, findCandidates: M.skymodel.findCandidates,
    changeMap: M.skymodel.changeMap, gridPixToSky, gridSkyToPix,
  };
  const prepared = M.pipeline.prepareResidual(lib, layers, grid);
  if (!prepared.model) throw new Error('web/src/pipeline.js prepareResidual returned no sky model');
  const candidates = prepared.candidates;
  const stacks = M.measure.buildPassStacks(layers);
  const stackMjd = (label) => (stacks.find((s) => s.label === label) || stacks[Math.floor(stacks.length / 2)]).mjd;
  log(`Sky model fitted to ${layers.length} layers (${grid.n} x ${grid.n} pixels); ${candidates.length} candidates listed`);
  // Distance of every candidate from the injected objects at the date of the pass it was seen in.
  const located = candidates.map((c, i) => {
    const mjd = Number.isFinite(c.mjd) ? c.mjd : stackMjd(c.passLabel);
    let best = null;
    for (const o of sky.objects) {
      const t = truthAt(o.id, mjd);
      const [tx, ty] = gridSkyToPix(grid, t.ra, t.dec);
      const d = Math.hypot(c.x - tx, c.y - ty);
      if (!best || d < best.distPix) best = { id: o.id, kind: o.kind, distPix: d };
    }
    return { ...c, mjd, rank: i + 1, nearest: best };
  });
  const TOL_PIX = 6.15 / grid.scale; // one SPHEREx pixel
  const nearest = (id) => located.filter((c) => c.nearest.id === id).sort((a, b) => a.nearest.distPix - b.nearest.distPix)[0] || null;
  const candMover = nearest('mover');
  const candVariable = nearest('variable');
  const candOk = (c) => !!c && c.nearest.distPix <= TOL_PIX;
  const strays = located.filter((c) => !(['mover', 'variable'].includes(c.nearest.id) && c.nearest.distPix <= 3 * TOL_PIX));

  // ---- measure --------------------------------------------------------------------------------
  // Start positions come from the candidate list (what a user would click), not from the truth.
  const startAt = (cand, id, name) => {
    if (candOk(cand)) return { ra: cand.ra, dec: cand.dec, mjd: cand.mjd, name };
    const t = truthAt(id, exposures[Math.floor(exposures.length / 2)].mjd);
    return { ra: t.ra, dec: t.dec, mjd: exposures[Math.floor(exposures.length / 2)].mjd, name: `${name} (candidate not found; started from the true position)` };
  };
  const ctx = { grid, det, layersByDet, frames, gaia };
  const mMover = await M.measure.measureField({ ...ctx, target: startAt(candMover, 'mover', 'Injected fast mover') });
  const mVariable = await M.measure.measureTarget({ ...ctx, target: startAt(candVariable, 'variable', 'Injected variable'), floorArcsec: mMover.field.floorArcsec || undefined });
  // The methane object is steady and not in the catalogue: its position is taken from the
  // truth table, and what is tested is its spectrum.
  const midMjd = exposures[Math.floor(exposures.length / 2)].mjd;
  const tMeth = truthAt('methane', midMjd);
  const mMethane = await M.measure.measureTarget({
    ...ctx, target: { ra: tMeth.ra, dec: tMeth.dec, mjd: midMjd, name: 'Injected methane-like object' },
    floorArcsec: mMover.field.floorArcsec || undefined, parts: ['motion', 'variability', 'spectrum', 'quality'],
  });

  // ---- checks ---------------------------------------------------------------------------------
  const checks = [];
  const add = (name, measured, truth, difference, tolerance, pass, note = '') => {
    checks.push({ name, measured, truth, difference, tolerance, pass: !!pass, note });
  };
  const expected = dets.reduce((a, d) => a + sky.frameRefs.filter((r) => r.det === d).length, 0);
  add('Exposures fetched, decoded and reprojected', `${frames.length}`, `${expected}`, `${frames.length - expected}`, 'all', frames.length === expected && expected > 0,
    `Detectors ${dets.join(' and ')}, through the proxy handler, TBF1 decoding and the page's loader.`);

  const al = mMover.field.alignment;
  add('Field stars: median offset from Gaia', al.ok ? `${num(al.medianOffset, 3)} arcsec` : 'not measured', '0',
    al.ok ? `${signed(al.medianEast, 3)} E, ${signed(al.medianNorth, 3)} N` : '', '0.31 arcsec (0.05 pixel)', al.ok && al.medianOffset <= 0.31,
    al.ok ? `${al.nStars} stars, ${al.n} centroids.` : al.reason);
  add('Field stars: scatter of offsets, per axis', al.ok ? `${num(al.sigma, 3)} arcsec` : 'not measured', '0', '', '0.62 arcsec (0.10 pixel)', al.ok && al.sigma <= 0.62,
    'Accuracy of one stacked centroid: WCS, resampling, stacking and centroiding together.');

  const nt = mMover.field.nullTest;
  add('Null test: mean motion of slow stars, east', nt.ok ? `${num(nt.meanPmra, 0)} ${'±'} ${num(nt.errMeanPmra, 0)} mas/yr` : 'not measured', '0',
    nt.ok ? `${signed(nt.zPmra, 1)} sigma` : '', '3 sigma', nt.ok && Math.abs(nt.zPmra) <= 3, nt.ok ? `${nt.n} stars with a true motion under 50 mas/yr.` : nt.reason);
  add('Null test: mean motion of slow stars, north', nt.ok ? `${num(nt.meanPmdec, 0)} ${'±'} ${num(nt.errMeanPmdec, 0)} mas/yr` : 'not measured', '0',
    nt.ok ? `${signed(nt.zPmdec, 1)} sigma` : '', '3 sigma', nt.ok && Math.abs(nt.zPmdec) <= 3,
    nt.ok ? `One star's measured motion scatters by ${num(nt.scatter, 0)} mas/yr per axis.` : '');

  const candText = (c) => (c ? `candidate ${c.rank} of ${candidates.length}, ${num(c.nearest.distPix * grid.scale, 1)} arcsec away` : 'not listed');
  const candNote = (c) => (c ? `Listed as "${c.label}" in ${c.passLabel || 'one pass'}${c.peaks > 1 ? `, ${c.peaks} residual peaks merged` : ''}.` : '');
  add('Candidate list finds the mover', candText(candMover), 'at the true position', candMover ? `${num(candMover.nearest.distPix, 2)} grid pixel` : '',
    '6.15 arcsec (1 pixel)', candOk(candMover), `${candNote(candMover)} The residual of a mover peaks ahead of or behind the star, not on it, so some offset is expected.`);
  add('Candidate list finds the variable', candText(candVariable), 'at the true position', candVariable ? `${num(candVariable.nearest.distPix, 2)} grid pixel` : '',
    '6.15 arcsec (1 pixel)', candOk(candVariable), candNote(candVariable));
  add('Candidates that are neither the mover nor the variable', `${strays.length} of ${candidates.length}`, '0', `${strays.length}`, '0', strays.length === 0,
    strays.length ? `Strays: ${strays.map((c) => `#${c.rank} ${c.label}, nearest ${c.nearest.id} at ${num(c.nearest.distPix * grid.scale, 0)} arcsec`).join('; ')}.` : 'The steady stars and the methane-like object leave nothing in the candidate list.');

  const mo = mMover.motion;
  if (mo.ok) {
    const me = mo.measured;
    const dTot = me.total - moverTruth.total;
    add('Mover: proper motion, total', `${num(me.total, 0)} ${'±'} ${num(me.errTotal, 0)} mas/yr`, `${num(moverTruth.total, 0)} mas/yr`,
      `${signed(dTot, 0)} mas/yr (${signed(dTot / me.errTotal, 1)} sigma)`, '3 sigma and 5 percent', Math.abs(dTot) <= 3 * me.errTotal && Math.abs(dTot) <= 0.05 * moverTruth.total,
      `Centroids in ${mo.nFound} pass stacks over ${num(mo.spanYears, 2)} yr; the injected motion is ${num(moverTruth.total / 1000, 2)} arcsec/yr.`);
    const dE = me.pmra - moverTruth.pmra;
    const dN = me.pmdec - moverTruth.pmdec;
    add('Mover: proper motion, east', `${num(me.pmra, 0)} ${'±'} ${num(me.errPmra, 0)} mas/yr`, `${num(moverTruth.pmra, 0)} mas/yr`,
      `${signed(dE, 0)} mas/yr (${signed(dE / me.errPmra, 1)} sigma)`, '3 sigma', Math.abs(dE) <= 3 * me.errPmra);
    add('Mover: proper motion, north', `${num(me.pmdec, 0)} ${'±'} ${num(me.errPmdec, 0)} mas/yr`, `${num(moverTruth.pmdec, 0)} mas/yr`,
      `${signed(dN, 0)} mas/yr (${signed(dN / me.errPmdec, 1)} sigma)`, '3 sigma', Math.abs(dN) <= 3 * me.errPmdec);
    const dPa = ((me.paDeg - moverTruth.paDeg + 540) % 360) - 180;
    add('Mover: direction, east of north', `${num(me.paDeg, 2)} ${'±'} ${num(me.errPaDeg, 2)} deg`, `${num(moverTruth.paDeg, 2)} deg`, `${signed(dPa, 2)} deg`, '3 deg', Math.abs(dPa) <= 3);
    // Position against the true track at the pass dates.
    let worst = 0;
    for (const p of mo.points) {
      const t = truthAt('mover', p.mjd);
      worst = Math.max(worst, M.astrometry.separationArcsec(p.ra, p.dec, t.ra, t.dec));
    }
    add('Mover: largest distance from the true track', `${num(worst, 3)} arcsec`, '0', `${num(worst / 6.15, 3)} pixel`, '0.62 arcsec (0.10 pixel)', worst <= 0.62,
      'Measured stack centroids against the injected positions at the pass dates.');
    const cat = mo.catalogue;
    add('Mover: matched to its catalogue entry', cat ? `${cat.source} ${cat.id}` : 'no match', 'the synthetic Gaia entry of the mover',
      cat ? `catalogue ${num(Math.hypot(cat.pmra, cat.pmdec), 0)} mas/yr` : '', 'within 1 mas/yr of the truth',
      !!cat && Math.abs(Math.hypot(cat.pmra, cat.pmdec) - moverTruth.total) < 1, 'Shows that propagating the 2016.0 catalogue position by 10 years lands on the star.');
  } else {
    add('Mover: proper motion', 'not measured', `${num(moverTruth.total, 0)} mas/yr`, '', '3 sigma and 5 percent', false, mo.reason);
  }

  const va = mVariable.variability;
  const perDet = va.ok ? va.perDet.find((d) => d.det === det && d.ok) : null;
  if (perDet && perDet.passes.length >= 2) {
    for (let j = 1; j < perDet.passes.length; j++) {
      const a = perDet.passes[0];
      const b = perDet.passes[j];
      const pair = perDet.pairs.find((p) => p.fromIndex === a.index && p.toIndex === b.index);
      const truth = variableScale[b.index] / variableScale[a.index];
      if (!pair) continue;
      const d = pair.ratio - truth;
      add(`Variable: brightness, ${a.label} to ${b.label}`, `${'×'}${num(pair.ratio, 3)} ${'±'} ${num(pair.err, 3)}`, `${'×'}${num(truth, 3)}`,
        `${signed((pair.ratio / truth - 1) * 100, 1)} percent (${signed(d / pair.err, 1)} sigma)`, '5 percent', Math.abs(pair.ratio / truth - 1) <= 0.05,
        `Detector ${det}, ${va.method}. Truth is the injected brightness averaged over the exposure dates of each pass.`);
    }
    add('Variable: change detected', va.varied ? `yes, ${num(va.largest.significance, 1)} sigma` : `no, ${num(va.largest.significance, 1)} sigma`, 'yes', '', 'over 5 sigma', va.varied && va.largest.significance > 5);
  } else {
    add('Variable: brightness ratio', 'not measured', `${'×'}${num(variableScale[1] / variableScale[0], 3)}`, '', '5 percent', false, va.reason || (perDet && perDet.reason) || 'no photometry');
  }
  const vm = mVariable.motion;
  add('Variable: no motion', vm.ok ? `${num(vm.measured.total, 0)} ${'±'} ${num(vm.measured.errTotal, 0)} mas/yr` : 'not measured', `${num(Math.hypot(variable.pmE, variable.pmN) * 1000, 0)} mas/yr`,
    vm.ok ? `${num(vm.significance, 1)} sigma from zero` : '', 'under 3 sigma', vm.ok && !vm.moving, 'A star that changes brightness must not be reported as moving.');
  const steady = mMover.variability;
  add('Mover: no brightness change', steady.ok ? `${'×'}${num(steady.largest.ratio, 3)} ${'±'} ${num(steady.largest.err, 3)}` : 'not measured', `${'×'}1.000`,
    steady.ok ? `${num(steady.largest.significance, 1)} sigma` : '', 'under 3 sigma', steady.ok && !steady.varied,
    'The aperture follows the star; a fixed aperture would lose light as it moves and fake a change.');

  const sp = mMethane.spectrum;
  const me4 = sp.ok ? sp.methane : null;
  if (me4 && me4.measurable) {
    const d = me4.depth - methaneTruth;
    add(`Methane-like object: depth of the ${band.band[0]}-${band.band[1]} um band`, `${num(me4.depth, 3)} ${'±'} ${num(me4.err, 3)}`, num(methaneTruth, 3),
      `${signed(d, 3)} (${signed(d / me4.err, 1)} sigma)`, '0.08', Math.abs(d) <= 0.08,
      `${me4.nBand} exposures in the band, ${me4.nContinuum} in the continuum windows, detector 4. Truth: the injected spectrum averaged over the same windows.`);
  } else {
    add('Methane-like object: band depth', 'not measured', num(methaneTruth, 3), '', '0.08', false, (me4 && me4.reason) || sp.reason || 'band not covered');
  }
  const sm = mMover.spectrum;
  const moverBand = sm.ok ? sm.methane : null;
  add('Mover: no methane band', moverBand && moverBand.measurable ? `${num(moverBand.depth, 3)} ${'±'} ${num(moverBand.err, 3)}` : 'not measured', '0.000',
    moverBand && moverBand.measurable ? `${signed(moverBand.depth / moverBand.err, 1)} sigma` : '', '0.05', !!moverBand && moverBand.measurable && Math.abs(moverBand.depth) <= 0.05,
    'A star with a smooth spectrum must show no band.');

  const rs = mMover.residuals;
  const ex = rs.ok && rs.exact && rs.exact.ok ? rs.exact : null;
  add('Blank sky: standard deviation of residual / sigma', ex ? num(ex.std, 3) : 'not measured', '1', ex ? signed(ex.std - 1, 3) : '', '0.80 to 1.15', !!ex && ex.std >= 0.8 && ex.std <= 1.15,
    ex ? `${ex.nPixels} pixel samples from ${ex.nLayers} exposures, exact single-pixel variance. On the layers as displayed the value is ${num(rs.std, 2)} (see findings).` : (rs.reason || (rs.exact && rs.exact.reason) || ''));
  add('Blank sky: samples beyond 5 sigma', ex ? `${ex.nBeyond5} of ${ex.nPixels}` : 'not measured', ex ? `${num(ex.nPixels * 5.7e-7, 2)} for Gaussian noise` : '', '', 'at most 1 in 20 000', !!ex && ex.fracBeyond5 <= 5e-5,
    'Unflagged outliers would show up here.');

  // ---- output ---------------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  const seconds = (Date.now() - started) / 1000;
  const widths = [0, 0, 0, 0, 0];
  const cells = checks.map((c) => [c.name, c.measured, c.truth, c.difference, c.tolerance]);
  for (const r of cells) r.forEach((t, i) => { widths[i] = Math.max(widths[i], String(t).length); });
  console.log('');
  console.log(`Synthetic-sky validation: RA ${ra.toFixed(4)}, Dec ${dec.toFixed(4)}, detector ${det}, ${fov} arcmin field`);
  console.log(['Check', 'Measured', 'Truth', 'Difference', 'Tolerance'].map((t, i) => t.padEnd(widths[i])).join('  ') + '  Result');
  cells.forEach((r, k) => {
    console.log(r.map((t, i) => String(t).padEnd(widths[i])).join('  ') + `  ${checks[k].pass ? 'pass' : 'FAIL'}`);
  });
  console.log('');
  console.log(`${checks.length - failed.length} of ${checks.length} checks pass in ${seconds.toFixed(1)} s.`);

  if (opts.write) {
    let version = 'unknown';
    try {
      version = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')).version || version;
    } catch {
      // keep the default
    }
    const when = new Date();
    const md = [];
    md.push('# Synthetic-sky validation');
    md.push('');
    md.push(`Written by \`node tools/validate-synthetic.mjs\` on ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC, Tombaugh ${version}. Do not edit by hand: run the script again.`);
    md.push('');
    md.push('This is a test of the software, not of the sky. The frames are synthetic (`proxy/fixtures/synth.js`): a field of ordinary stars, '
      + `one star moving ${num(moverTruth.total / 1000, 2)} arcsec a year, one star that doubles in brightness between passes, and a cold object with a deep 3.3 um band. `
      + 'Because the truth is known exactly, every measured number can be checked against what was put in. The same chain runs in the page on real SPHEREx data.');
    md.push('');
    md.push(`**Result: ${failed.length ? `${failed.length} of ${checks.length} checks FAIL` : `all ${checks.length} checks pass`}.**`);
    md.push('');
    md.push(`Field: RA ${ra.toFixed(4)}, Dec ${dec >= 0 ? '+' : ''}${dec.toFixed(4)} deg, ${fov} arcmin, grid ${grid.n} x ${grid.n} pixels of ${grid.scale} arcsec. `
      + `Detector ${det} carries the motion, brightness and noise checks (${loadInfo[det].frames} exposures in ${passesOfDet.length} passes); `
      + `detector${spectralDets.length === 1 ? '' : 's'} ${spectralDets.join(', ')} adds the methane band. Run time ${seconds.toFixed(1)} s.`);
    md.push('');
    md.push('## What ran');
    md.push('');
    md.push('1. `proxy/src/handler.js` with the synthetic backend, called in-process: `/search`, `/cutout` (FITS written by the fixture, parsed by `fits.js`, wavelengths from `wavetab.js`, encoded by `encode.js`), `/gaia`.');
    md.push('2. `web/src/api.js` decodes each TBF1 frame; `web/src/loader.js` fetches every exposure and resamples it with `core/reproject.js` (TAN-SIP with the reference pixel off the cutout) onto the common grid.');
    md.push('3. `core/stack.js` stacks each survey pass; `core/skymodel.js` fits the static sky and finds residual peaks; `web/src/pipeline.js` merges them into the candidate list the page shows.');
    md.push('4. `web/src/plugins/validate/` measures: field-star offsets from Gaia and the null test (`core/astrometry.js`), the motion of the mover from its pass centroids, the brightness ratio of the variable from native aperture photometry (`core/photometry.js`), the band depth of the cold object, and the residual noise on blank sky.');
    md.push('5. The truth is read from the object list of `syntheticSky()` in the fixture. Start positions for the mover and the variable come from the candidate list, as a user would click them.');
    md.push('');
    md.push('## Checks');
    md.push('');
    md.push('| Check | Measured | Truth | Difference | Tolerance | Result |');
    md.push('|---|---|---|---|---|---|');
    for (const c of checks) md.push(`| ${c.name} | ${c.measured} | ${c.truth} | ${c.difference} | ${c.tolerance} | ${c.pass ? 'pass' : '**FAIL**'} |`);
    md.push('');
    md.push('Tolerances: a tenth of a SPHEREx pixel (0.62 arcsec) for measured positions, one pixel for where a candidate is listed, 3 sigma of the tool\'s own error for motions, '
      + '5 percent for the size of the motion and for the brightness ratio, 0.08 for a band depth, and 0.80 to 1.15 for the noise ratio (the sky model deliberately errs on the conservative side).');
    md.push('');
    const notes = checks.filter((c) => c.note);
    if (notes.length) {
      md.push('Notes:');
      md.push('');
      for (const c of notes) md.push(`- ${c.name}: ${c.note}`);
      md.push('');
    }
    md.push('## Candidates, as the page lists them');
    md.push('');
    md.push('| # | Listed as | Pass | Nearest injected object | Distance |');
    md.push('|---|---|---|---|---|');
    for (const c of located.slice(0, 12)) {
      md.push(`| ${c.rank} | ${c.label} | ${c.passLabel || ''} | ${c.nearest.id} (${c.nearest.kind}) | ${num(c.nearest.distPix * grid.scale, 1)} arcsec |`);
    }
    if (!located.length) md.push('| | none | | | |');
    md.push('');
    md.push('## Full report, as the page would write it');
    md.push('');
    const report = M.report.toMarkdown([mMover, mVariable, mMethane], {
      version, generatedAt: when, title: 'Report for the synthetic field',
      source: 'synthetic SPHEREx-style frames from the Tombaugh test fixture', note: 'Catalogue values here are those of the synthetic Gaia-like catalogue that the fixture serves.',
    });
    // Nest the report's headings under this section.
    md.push(report.replace(/^# /m, '### ').replace(/^(#{2,4}) /gm, '#$1 ').replace(/^#### Report/m, '### Report'));
    await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
    await fs.writeFile(OUT_FILE, `${md.join('\n').trimEnd()}\n`);
    log(`Wrote ${path.relative(ROOT, OUT_FILE)}`);
  }
  if (failed.length) {
    console.log('Failed checks:');
    for (const c of failed) console.log(`  ${c.name}: measured ${c.measured}, truth ${c.truth}, tolerance ${c.tolerance}. ${c.note}`);
  }
  return failed.length ? 1 : 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    console.error(err && err.blocked ? err.message : `validate-synthetic could not run: ${err && err.stack ? err.stack : err}`);
    process.exitCode = 2;
  },
);
