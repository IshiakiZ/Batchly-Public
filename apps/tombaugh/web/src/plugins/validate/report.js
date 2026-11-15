// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// report.js - turn measurements (measure.js) into a table, a Markdown report and a JSON record.
// Pure: no DOM, no network, no clock except where a date is passed in.
//
//   toRows(measurement)                 rows for the target table
//   fieldRows(field)                    rows for the field-star tests
//   toMarkdown(measurements, meta)      the whole report as Markdown
//   toJson(measurements, meta)          a plain, JSON-safe object (numbers at full precision)
//
// A row is { group, label, measured, reference, difference, sigma, sigmaText, flag, note }:
// strings ready to print, `sigma` the number behind sigmaText (or null), and `flag` true when a
// measured value disagrees with its reference by more than three sigma. Only comparisons with a
// catalogue or an expected value can be flagged; the significance of a detection is not a
// disagreement and is written into the `measured` text instead.

import { DETECTORS } from '../../core/frames.js';

const MINUS = '−';
const TIMES = '×';
const PM = '±';
const MICRON = 'µm';
const ARROW = '→';
const DASH = '–';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Fixed decimals with a real minus sign; '' for a non-number. */
export function fmt(v, decimals = 2) {
  if (!isNum(v)) return '';
  const r = Number(v.toFixed(decimals));
  const text = Math.abs(r).toFixed(decimals);
  return r < 0 ? `${MINUS}${text}` : text;
}

/** Like fmt but always signed: +1.2 or −0.4. */
export function fmtSigned(v, decimals = 1) {
  if (!isNum(v)) return '';
  const text = fmt(v, decimals);
  return text.startsWith(MINUS) || Number(v.toFixed(decimals)) === 0 ? text : `+${text}`;
}

/** Decimals that show an error to two significant figures (0 for errors of 10 and above). */
function decimalsFor(err) {
  if (!isNum(err) || !(err > 0)) return 1;
  return Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(err))));
}

/** "value ± error unit", both rounded to the place of the error's second significant figure. */
export function fmtValErr(v, err, unit = '') {
  if (!isNum(v)) return 'not measured';
  const d = decimalsFor(err);
  const tail = unit ? ` ${unit}` : '';
  if (!isNum(err)) return `${fmt(v, d)}${tail}`;
  return `${fmt(v, d)} ${PM} ${fmt(err, d)}${tail}`;
}

function fmtSigma(z) {
  return isNum(z) ? fmtSigned(z, 1) : '';
}

function fmtCount(n) {
  return isNum(n) ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '';
}

function fmtFraction(f) {
  if (!isNum(f)) return '';
  if (f === 0) return '0';
  if (f < 1e-4) return f.toExponential(1).replace('e-', ` ${TIMES} 10^${MINUS}`).replace('e+', ` ${TIMES} 10^`);
  return `${(f * 100).toFixed(f < 0.01 ? 2 : 1)} %`;
}

function detRange(det) {
  const d = DETECTORS[det - 1];
  return d ? `${d.min}${DASH}${d.max} ${MICRON}` : '';
}

function row(group, label, measured, extra = {}) {
  const sigma = isNum(extra.sigma) ? extra.sigma : null;
  return {
    group, label, measured: measured || '', reference: extra.reference || '', difference: extra.difference || '',
    sigma, sigmaText: fmtSigma(sigma), flag: sigma !== null && Math.abs(sigma) > 3, note: extra.note || '',
  };
}

function motionRows(m) {
  const g = 'Motion';
  const mo = m.motion || {};
  if (!mo.ok) {
    const cat = mo.catalogue || m.catalogue;
    const ref = cat && isNum(cat.pmra) && isNum(cat.pmdec) ? `${fmt(Math.hypot(cat.pmra, cat.pmdec), 0)} mas/yr` : '';
    return [row(g, 'Proper motion', 'not measured', { reference: ref, note: mo.reason || '' })];
  }
  const me = mo.measured;
  const ex = mo.expected;
  const df = mo.difference;
  const d = decimalsFor(me.errTotal);
  const rows = [];
  const sig = isNum(mo.significance) ? mo.significance : 0;
  rows.push(row(g, 'Proper motion, total', fmtValErr(me.total, me.errTotal, 'mas/yr'), {
    reference: ex ? `${fmt(ex.total, d)} mas/yr` : '', difference: df ? `${fmtSigned(df.total, d)} mas/yr` : '',
    sigma: df ? df.sigmaTotal : null,
    note: (mo.moving
      ? `Motion detected at ${fmt(sig, 1)} sigma.`
      : `No motion detected: ${fmt(sig, 1)} sigma, below the 3 sigma needed. The value is an upper bound on what could hide here.`)
      + (mo.saturated ? ' The star saturates the detector, so each position is taken from the unsaturated light around its flagged core.' : ''),
  }));
  rows.push(row(g, 'Proper motion, east', fmtValErr(me.pmra, me.errPmra, 'mas/yr'), {
    reference: ex ? `${fmt(ex.pmra, d)} mas/yr` : '', difference: df ? `${fmtSigned(df.pmra, d)} mas/yr` : '',
    sigma: df ? df.sigmaPmra : null,
  }));
  rows.push(row(g, 'Proper motion, north', fmtValErr(me.pmdec, me.errPmdec, 'mas/yr'), {
    reference: ex ? `${fmt(ex.pmdec, d)} mas/yr` : '', difference: df ? `${fmtSigned(df.pmdec, d)} mas/yr` : '',
    sigma: df ? df.sigmaPmdec : null,
  }));
  if (mo.moving) {
    rows.push(row(g, 'Direction (east of north)', fmtValErr(me.paDeg, me.errPaDeg, 'deg'), {
      reference: ex && ex.total > 0 ? `${fmt(ex.paDeg, decimalsFor(me.errPaDeg))} deg` : '',
      difference: df && isNum(df.paDeg) ? `${fmtSigned(df.paDeg, decimalsFor(me.errPaDeg))} deg` : '',
      sigma: df ? df.sigmaPa : null,
    }));
  } else {
    rows.push(row(g, 'Direction (east of north)', 'undefined without a detected motion', {
      reference: ex && ex.total > 0 && mo.catalogue && mo.catalogue.total > 50 ? `${fmt(ex.paDeg, 1)} deg` : '',
    }));
  }
  const catPlx = mo.catalogue && isNum(mo.catalogue.parallax) ? mo.catalogue.parallax : null;
  // The fitted parallax is shown when there is a catalogue value to hold it against, or when
  // it is significant on its own.
  if (mo.parallaxFit && (catPlx !== null || Math.abs(mo.parallaxFit.parallax) >= 3 * mo.parallaxFit.errParallax)) {
    const cat = catPlx;
    const pf = mo.parallaxFit;
    const dp = decimalsFor(pf.errParallax);
    rows.push(row(g, 'Parallax (fitted with the motion)', fmtValErr(pf.parallax, pf.errParallax, 'mas'), {
      reference: cat !== null ? `${fmt(cat, dp)} mas` : '',
      difference: cat !== null ? `${fmtSigned(pf.parallax - cat, dp)} mas` : '',
      sigma: cat !== null && pf.errParallax > 0 ? (pf.parallax - cat) / pf.errParallax : null,
      note: 'Three passes leave one degree of freedom for this fit; read it as a consistency check, not a measurement.',
    }));
  }
  if (mo.offsetFromTrack) {
    const o = mo.offsetFromTrack;
    rows.push(row(g, 'Mean offset from the catalogue track', `${fmt(o.total, 2)} arcsec`, {
      reference: '0', difference: `${fmtSigned(o.dEast, 2)} E, ${fmtSigned(o.dNorth, 2)} N arcsec`,
      note: `${fmt(o.total / 6.15, 3)} SPHEREx pixel, averaged over the passes.`,
    }));
  }
  if (mo.displacement && mo.displacement.arcsec >= 3) {
    rows.push(row(g, `Moved since ${fmt(mo.displacement.sinceEpoch, 1)}`, `${fmt(mo.displacement.arcsec, 1)} arcsec`, {
      note: `${fmt(mo.displacement.pixels, 1)} SPHEREx pixels from the catalogue position at that epoch.`,
    }));
  }
  return rows;
}

function changeText(p) {
  return `${TIMES}${fmt(p.ratio, 3)} ${PM} ${fmt(p.err, 3)} (${fmt(p.significance, 1)} sigma)`;
}

function blendText(b) {
  return `In ${b.pass} a Gaia star${isNum(b.gmag) ? ` (G ${fmt(b.gmag, 1)})` : ''} lies ${fmt(b.sepArcsec, 1)} arcsec from the target, inside the aperture, so the change is partly that star's light and is not counted as the target varying.`;
}

function variabilityRows(m) {
  const g = 'Brightness';
  const v = m.variability || {};
  if (!v.ok) return [row(g, 'Change between passes', 'not measured', { note: v.reason || '' })];
  const rows = [];
  const top = v.largest;
  const floorNote = v.floor > 0 ? ` Errors include a ${fmt(v.floor * 100, 0)} percent repeatability floor per pass.` : '';
  rows.push(row(g, 'Largest change between passes', v.varied
    ? `${changeText(top)}, ${top.from} ${ARROW} ${top.to}, D${top.det}`
    : top.blend
      ? `not counted: ${changeText(top)} is blended with a Gaia star`
      : `none detected; largest is ${changeText(top)}`, {
    difference: `${fmtSigned(v.percent, Math.abs(v.percent) < 10 ? 1 : 0)} %`,
    note: v.varied
      ? `Brightness relative to the smooth spectrum, later pass over earlier pass. Method: ${v.method}.${floorNote}`
      : top.blend
        ? `${blendText(top.blend)} Method: ${v.method}.${floorNote}`
        : `Below the 3 sigma needed to call it a change. Method: ${v.method}.${floorNote}`,
  }));
  for (const d of v.perDet || []) {
    if (!d.ok) {
      rows.push(row(g, `Detector ${d.det}`, 'not measured', { note: d.reason || '' }));
      continue;
    }
    for (const p of d.pairs || []) {
      if (p.toIndex !== p.fromIndex + 1 && (d.pairs || []).length > 1 && p !== d.largest) continue; // consecutive passes, and the largest
      rows.push(row(g, `D${d.det}, ${p.from} ${ARROW} ${p.to}`, changeText(p), {
        difference: `${fmtSigned((p.ratio - 1) * 100, Math.abs(p.ratio - 1) < 0.1 ? 1 : 0)} %`,
        note: p.blend ? blendText(p.blend) : '',
      }));
    }
  }
  return rows;
}

function spectrumRows(m) {
  const g = 'Spectrum';
  const s = m.spectrum || {};
  if (!s.ok) return [row(g, 'Spectrum', 'not measured', { note: s.reason || '' })];
  const rows = [];
  rows.push(row(g, 'Exposures with clean photometry', `${fmtCount(s.nExposures)} of ${fmtCount(s.nTotal)}`, {
    note: s.nFlagged ? `${fmtCount(s.nFlagged)} left out because a flagged pixel lies in the aperture.` : '',
  }));
  rows.push(row(g, 'Wavelength coverage', `${fmt(s.coverage[0], 2)}${DASH}${fmt(s.coverage[1], 2)} ${MICRON}`, {
    note: `Detector${s.detectors.length === 1 ? '' : 's'} ${s.detectors.join(', ')}.`,
  }));
  rows.push(row(g, 'Median signal-to-noise per exposure', fmt(s.medianSnr, s.medianSnr >= 10 ? 0 : 1), {
    note: `${fmtCount(s.nDetected)} of ${fmtCount(s.nExposures)} exposures detect the target above 3 sigma.`,
  }));
  const me = s.methane || {};
  const label = `Depth of the ${me.band ? `${me.band[0]}${DASH}${me.band[1]}` : '3.3'} ${MICRON} methane band`;
  if (!me.covered) {
    rows.push(row(g, label, 'not covered', { note: 'The loaded exposures do not reach both the band and its continuum (detector 4 covers them).' }));
  } else if (!me.measurable) {
    rows.push(row(g, label, 'not measurable', { note: me.reason || '' }));
  } else {
    const z = isNum(me.sigma) ? me.sigma : 0;
    rows.push(row(g, label, fmtValErr(me.depth, me.err), {
      reference: '0 for a smooth spectrum',
      note: z >= 3
        ? `Absorption detected at ${fmt(z, 1)} sigma: the band is ${fmt(me.depth * 100, 0)} % darker than the continuum beside it.`
        : `No absorption detected (${fmt(z, 1)} sigma).`,
    }));
  }
  return rows;
}

function qualityRows(m) {
  const g = 'Data';
  const q = m.quality || {};
  if (!q.ok) return [row(g, 'Data quality', 'not measured', { note: q.reason || '' })];
  const rows = [];
  const passes = q.passes || [];
  rows.push(row(g, 'Survey passes', `${passes.length}: ${passes.map((p) => `${p.label} (${p.nExposures})`).join(', ')}`, {
    note: passes.map((p) => String(p.date).slice(0, 10)).join(', '),
  }));
  rows.push(row(g, `Exposures used, detector ${q.det}`, fmtCount(q.exposuresUsed), {
    note: Object.keys(q.framesByDet || {}).length > 1
      ? `Loaded in all: ${Object.entries(q.framesByDet).map(([d, n]) => `D${d} ${n}`).join(', ')}.` : '',
  }));
  if (q.aperture && isNum(q.aperture.flaggedPixelFraction)) {
    rows.push(row(g, 'Flagged pixels in the aperture', fmtFraction(q.aperture.flaggedPixelFraction) || '0', {
      note: `${fmtCount(q.aperture.exposuresWithFlags)} of ${fmtCount(q.aperture.exposures)} exposures have a flagged pixel within ${fmt(q.aperture.radiusArcsec, 1)} arcsec of the target`
        + `${q.aperture.offFrame ? `; ${fmtCount(q.aperture.offFrame)} more do not cover it` : ''}.`,
    }));
  }
  const rel = Object.entries(q.releases || {});
  if (rel.length) rows.push(row(g, 'Data releases', rel.map(([name, n]) => `${name} (${n})`).join(', '), { note: q.synthetic ? 'Synthetic test frames, not observations.' : '' }));
  return rows;
}

function residualRows(m) {
  const g = 'Noise';
  const r = m.residuals || {};
  if (!r.ok) return [row(g, 'Residuals on blank sky', 'not measured', { note: r.reason || '' })];
  const rows = [];
  const ex = r.exact && r.exact.ok ? r.exact : null;
  if (ex) {
    rows.push(row(g, 'Residual / sigma on blank sky, standard deviation', fmt(ex.std, 2), {
      reference: '1', difference: fmtSigned(ex.std - 1, 2),
      note: `${r.verdict} ${fmtCount(ex.nPixels)} pixel samples from ${ex.nLayers} exposures, exact single-pixel variance.`,
    }));
    rows.push(row(g, 'Samples beyond 5 sigma', `${fmtCount(ex.nBeyond5)} of ${fmtCount(ex.nPixels)}`, {
      reference: `about ${fmt(ex.nPixels * 5.7e-7, 2)} expected`,
      note: ex.nBeyond5 > Math.max(3, 20 * ex.nPixels * 5.7e-7) ? 'More outliers than Gaussian noise gives: unflagged cosmic rays or faint sources on the "blank" sky.' : '',
    }));
  }
  rows.push(row(g, 'The same on the layers as displayed', fmt(r.std, 2), {
    reference: 'about 0.6',
    note: ex ? 'Resampling averages neighbouring pixels while the quoted variance is kept, so the residual view understates significance by this factor.' : r.verdict,
  }));
  if (!ex) {
    rows.push(row(g, 'Samples beyond 5 sigma', `${fmtCount(r.nBeyond5)} of ${fmtCount(r.nPixels)}`, {
      reference: `about ${fmt(r.nPixels * 5.7e-7, 2)} expected`,
    }));
  }
  return rows;
}

/** Rows of the target table: motion, brightness, spectrum, data, noise. */
export function toRows(measurement) {
  const m = measurement || {};
  if (m.noData) return [row('Data', 'SPHEREx exposures', 'none', { note: m.reason || 'No data for this target.' })];
  return [...motionRows(m), ...variabilityRows(m), ...spectrumRows(m), ...qualityRows(m), ...residualRows(m)];
}

/** Rows of the field-star tests (alignment and null test). */
export function fieldRows(field) {
  const g = 'Field stars';
  const f = field || {};
  const a = f.alignment || {};
  const nt = f.nullTest || {};
  if (!f.ok && !a.ok) return [row(g, 'Field-star tests', 'not measured', { note: f.reason || a.reason || '' })];
  const rows = [];
  const rej = f.rejected || {};
  const why = [
    [rej.outside, 'off the field or near its edge'], [rej.crowded, 'crowded'], [rej.masked, 'flagged or saturated'],
    [rej.faint, 'too faint'], [rej.mismatch, 'not where predicted'], [rej.noPosition, 'no position'], [rej.surplus, 'surplus'],
  ].filter(([n]) => n > 0).map(([n, text]) => `${n} ${text}`);
  rows.push(row(g, 'Reference stars used', `${fmtCount(f.nMeasured)} of ${fmtCount(f.nCatalogue)} Gaia stars`, {
    note: why.length ? `Left out: ${why.join(', ')}.` : '',
  }));
  if (a.ok) {
    rows.push(row(g, 'Median offset from Gaia', `${fmt(a.medianOffset, 2)} arcsec`, {
      reference: '0', difference: `${fmtSigned(a.medianEast, 2)} E, ${fmtSigned(a.medianNorth, 2)} N arcsec`,
      sigma: a.errMedian > 0 ? a.medianOffset / a.errMedian : null,
      note: `${fmt(a.medianOffsetPix, 3)} SPHEREx pixel, from ${fmtCount(a.n)} centroids. Sigma is against the standard error of the median, ${fmt(a.errMedian, 3)} arcsec.`,
    }));
    rows.push(row(g, 'Scatter of the offsets, per axis', `${fmt(a.sigma, 2)} arcsec`, {
      reference: `under ${fmt(a.toleranceArcsec, 2)} arcsec`,
      note: `${fmt(a.sigmaPix, 3)} SPHEREx pixel: the accuracy of one stacked centroid in this field (WCS, resampling, stacking and centroiding together).`,
    }));
  } else {
    rows.push(row(g, 'Offset from Gaia', 'not measured', { note: a.reason || '' }));
  }
  if (nt.ok) {
    rows.push(row(g, `Null test: mean motion of ${nt.n} slow stars, east`, fmtValErr(nt.meanPmra, nt.errMeanPmra, 'mas/yr'), {
      reference: '0', difference: `${fmtSigned(nt.meanPmra, decimalsFor(nt.errMeanPmra))} mas/yr`, sigma: nt.zPmra,
    }));
    rows.push(row(g, `Null test: mean motion of ${nt.n} slow stars, north`, fmtValErr(nt.meanPmdec, nt.errMeanPmdec, 'mas/yr'), {
      reference: '0', difference: `${fmtSigned(nt.meanPmdec, decimalsFor(nt.errMeanPmdec))} mas/yr`, sigma: nt.zPmdec,
    }));
    rows.push(row(g, 'Scatter of one star’s measured motion, per axis', `${fmt(nt.scatter, 0)} mas/yr`, {
      note: `The empirical error of a proper motion here. A single object must move faster than about ${fmt(nt.detectable3Sigma, 0)} mas/yr to be called moving.`
        + (isNum(nt.reducedChi2) ? ` Chi-square per degree of freedom against the formal errors: ${fmt(nt.reducedChi2, 2)}.` : ''),
    }));
  } else {
    rows.push(row(g, 'Null test', 'not measured', { note: nt.reason || '' }));
  }
  return rows;
}

// ---- Markdown -----------------------------------------------------------------------------------

function cell(text) {
  return String(text == null ? '' : text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

function mdTable(rows) {
  const lines = ['| Quantity | Measured | Catalogue or expected | Difference | Sigma |', '|---|---|---|---|---|'];
  let group = '';
  for (const r of rows) {
    if (r.group !== group) {
      group = r.group;
      lines.push(`| **${cell(group)}** | | | | |`);
    }
    const sigma = r.sigmaText ? (r.flag ? `**${r.sigmaText}** (over 3)` : r.sigmaText) : '';
    lines.push(`| ${cell(r.label)} | ${cell(r.measured)} | ${cell(r.reference)} | ${cell(r.difference)} | ${sigma} |`);
  }
  return lines.join('\n');
}

function mdNotes(rows) {
  const notes = rows.filter((r) => r.note).map((r) => `- ${r.label}: ${r.note}`);
  return notes.length ? notes.join('\n') : '';
}

function coordText(t) {
  if (!t || !isNum(t.ra) || !isNum(t.dec)) return '';
  return `RA ${t.ra.toFixed(5)}, Dec ${t.dec >= 0 ? '+' : MINUS}${Math.abs(t.dec).toFixed(5)} deg (ICRS)`;
}

function catalogueText(c) {
  if (!c) return 'No catalogue motion is known for this position, so measured values stand alone.';
  const plx = isNum(c.parallax) ? `, parallax ${fmt(c.parallax, 1)} mas` : ', no parallax';
  return `Reference: ${c.source}${c.id ? ` ${c.id}` : ''}: proper motion ${fmtSigned(c.pmra, 1)} east, ${fmtSigned(c.pmdec, 1)} north mas/yr${plx}, `
    + `position at epoch ${fmt(c.epoch, 1)}. The catalogue column for motion is a straight line fitted through the catalogue track at the dates of the passes, `
    + 'parallax included, so it is what a perfect measurement on these dates would give.';
}

/** All release names found in the measurements, with exposure counts. */
export function releasesOf(measurements) {
  const out = {};
  for (const m of measurements || []) {
    const rel = m && m.quality && m.quality.releases;
    if (!rel) continue;
    for (const [name, n] of Object.entries(rel)) out[name] = (out[name] || 0) + n;
  }
  return out;
}

function nameOf(m, i) {
  return (m && m.target && (m.target.name || m.target.id)) || `Target ${i + 1}`;
}

/**
 * The report as Markdown.
 * @param {Array<object>} measurements results of measure.js measureField / measureTarget, or
 *   { noData: true, target, reason } for a target that returned nothing
 * @param {{ version?: string, generatedAt?: string|Date, title?: string, note?: string, source?: string }} [meta]
 */
export function toMarkdown(measurements, meta = {}) {
  const list = (measurements || []).filter(Boolean);
  const when = meta.generatedAt ? new Date(meta.generatedAt) : new Date();
  const stamp = Number.isFinite(when.getTime()) ? `${when.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';
  const releases = releasesOf(list);
  const relText = Object.keys(releases).length
    ? Object.entries(releases).map(([name, n]) => `${name} (${n} exposures)`).join(', ')
    : 'none found in the loaded frames';
  const synthetic = list.some((m) => m && m.quality && m.quality.synthetic);
  const out = [];
  out.push(`# ${meta.title || 'Tombaugh validation report'}`);
  out.push('');
  out.push(`Generated ${stamp} by Tombaugh ${meta.version || 'unknown version'}. `
    + `Data: ${meta.source || 'SPHEREx Level 2 spectral images from IRSA'}, data releases ${relText}. Reference catalogue: Gaia DR3, epoch 2016.0.`);
  if (synthetic) out.push('', 'These frames are synthetic test data made by Tombaugh, not observations.');
  if (meta.note) out.push('', meta.note);
  out.push('');
  out.push('## How to read this');
  out.push('');
  out.push('Every number in the Measured column was computed by the tool from the images, on the spot. '
    + 'The next column is the independent value it should agree with: a catalogue, or what theory says for pure noise. '
    + 'Sigma is the difference divided by the measurement’s own 1-sigma error; values within about 2 are agreement, and anything over 3 is marked. '
    + 'The field-star rows are the controls. The offset from Gaia shows that frames, resampling and centroids line up, '
    + 'and the null test shows what the method reports for stars that do not move, which is the honest size of its error. '
    + 'SPHEREx pixels are 6.15 arcsec and a position is revisited about every six months, so only motions of a good fraction of an arcsecond per year can be seen. '
    + '"Not measured" and "not detected" mean exactly that; nothing is filled in.');
  list.forEach((m, i) => {
    out.push('');
    out.push(`## ${nameOf(m, i)}`);
    out.push('');
    if (m.noData) {
      out.push(`${coordText(m.target)}${coordText(m.target) ? '. ' : ''}No data: ${m.reason || 'no SPHEREx exposures arrived for this target'}. Nothing was measured.`);
      return;
    }
    const passes = m.passes || [];
    const nExp = passes.reduce((a, p) => a + (p.nExposures || 0), 0);
    const head = [coordText(m.target)];
    if (isNum(m.det)) head.push(`detector ${m.det} (${detRange(m.det)})`);
    if (passes.length) head.push(`${nExp} exposures in ${passes.length} pass${passes.length === 1 ? '' : 'es'}: ${passes.map((p) => p.label).join(', ')}`);
    out.push(`${head.filter(Boolean).join('; ')}.`);
    if (m.cancelled) out.push('', 'The measurement was cancelled before it finished; the rows below are what was done by then.');
    if (m.partial) out.push('', `Partial data: ${m.partial}.`);
    out.push('');
    out.push(catalogueText(m.motion && m.motion.catalogue ? m.motion.catalogue : m.catalogue));
    out.push('');
    const rows = toRows(m);
    out.push(mdTable(rows));
    const notes = mdNotes(rows);
    if (notes) out.push('', notes);
    if (m.field) {
      out.push('');
      out.push(`### Field stars around ${nameOf(m, i)}`);
      out.push('');
      const fr = fieldRows(m.field);
      out.push(mdTable(fr));
      const a = m.field.alignment;
      const nt = m.field.nullTest;
      if (a && a.verdict) out.push('', `Alignment: ${a.verdict}`);
      if (nt && nt.verdict) out.push('', `Null test: ${nt.verdict}`);
      const fn = mdNotes(fr);
      if (fn) out.push('', fn);
    }
  });
  if (!list.length) out.push('', 'Nothing has been measured yet.');
  out.push('');
  return out.join('\n');
}

// ---- JSON ---------------------------------------------------------------------------------------

function clean(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'function' || depth > 12) return undefined;
  if (ArrayBuffer.isView(value)) return value.length > 4096 ? undefined : Array.from(value, (v) => (Number.isFinite(v) ? v : null));
  if (Array.isArray(value)) return value.map((v) => { const c = clean(v, depth + 1); return c === undefined ? null : c; });
  if (value instanceof Map) return clean(Object.fromEntries(value), depth + 1);
  if (value instanceof Date) return value.toISOString();
  const out = {};
  for (const key of Object.keys(value)) {
    const c = clean(value[key], depth + 1);
    if (c !== undefined) out[key] = c;
  }
  return out;
}

/**
 * The report as a plain object that survives JSON.stringify: non-finite numbers become null,
 * typed arrays become arrays, functions are dropped. Numbers keep full precision.
 * { kind: 'tombaugh-validation-report', schema: 1, generatedAt, version, releases, measurements }
 */
export function toJson(measurements, meta = {}) {
  const list = (measurements || []).filter(Boolean);
  const when = meta.generatedAt ? new Date(meta.generatedAt) : new Date();
  return {
    kind: 'tombaugh-validation-report', schema: 1,
    generatedAt: Number.isFinite(when.getTime()) ? when.toISOString() : null,
    version: meta.version || null, source: meta.source || 'SPHEREx Level 2 spectral images (IRSA); Gaia DR3',
    note: meta.note || null, releases: releasesOf(list),
    measurements: list.map((m) => ({ ...clean(m), rows: clean(toRows(m)), fieldRows: m.field ? clean(fieldRows(m.field)) : null })),
  };
}
