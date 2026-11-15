// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Helpers for the practice sky: the synthetic field of proxy/fixtures/synth.js, generated in the
// page. Its point is that the truth is known, so this module reads that truth out of the
// generator (positions, motions, spectra, exposure dates) instead of repeating numbers here:
//
//   practiceTruth(ra, dec)            -> Promise<truth>   what is hidden in the field, and where
//   describeTruth(synth, ra, dec)     -> truth            the same, given the loaded synth module
//   revealAnswers(truth, mjd)         -> { markers }      viewer overlays for an "answers" toggle
//   practiceBannerText(), practiceCaptionNote(note), markSimulated(caption), looksSimulated(id)
//
// Everything made in practice mode must say so. SIMULATED_LABEL is the word to show.

export const SIMULATED_LABEL = 'SIMULATED';

/** The banner above anything drawn from the practice sky. `count` = how many objects are planted, when known. */
export function practiceBannerText({ answers = false, count = 0 } = {}) {
  const base = 'Practice sky: simulated data. Nothing shown here was observed by SPHEREx.';
  if (answers) return `${base} The planted objects are marked.`;
  const words = ['', 'One object is', 'Two objects are', 'Three objects are', 'Four objects are', 'Five objects are'];
  return `${base} ${words[count] || 'A few objects are'} planted in it for you to find.`;
}

/**
 * True for a frame (or frame id) made by the practice sky. Synthetic ids carry their field in a
 * processing-version segment that starts with "l2b-syn-" (see parseSyntheticId in synth.js);
 * this is the same test without loading the generator.
 */
export function looksSimulated(frameOrId) {
  const id = frameOrId && typeof frameOrId === 'object' ? frameOrId.id : frameOrId;
  return typeof id === 'string' && /\/l2b-syn-r\d{8}-d[pm]\d{7}\//.test(id);
}

/** True when a caption note already carries the marker. */
export function isSimulatedNote(note) {
  return typeof note === 'string' && note.startsWith(SIMULATED_LABEL);
}

/** The note for a frame caption in practice mode: the marker first, then whatever was there. */
export function practiceCaptionNote(note = '') {
  const text = note === null || note === undefined ? '' : String(note);
  if (isSimulatedNote(text)) return text;
  return text ? `${SIMULATED_LABEL} practice sky · ${text}` : `${SIMULATED_LABEL} practice sky`;
}

/** A copy of a viewer caption { title, date, wave, note } with the marker in its note. */
export function markSimulated(caption) {
  const c = caption && typeof caption === 'object' ? caption : {};
  return { ...c, note: practiceCaptionNote(c.note) };
}

/** A clear, catchable failure of anything in this file. */
export class PracticeError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'PracticeError';
    this.retryable = false;
    if (cause) this.cause = cause;
  }
}

let synthPromise = null;

/** The synthetic-sky module, loaded on first use. Rejects with PracticeError if it is absent. */
export function loadSynth() {
  if (!synthPromise) {
    synthPromise = import('../../../proxy/fixtures/synth.js').catch((err) => {
      synthPromise = null;
      throw new PracticeError(`The practice sky is not part of this build (${err && err.message ? err.message : err})`, err);
    });
  }
  return synthPromise;
}

/** /search rounds a position to 1e-4 deg before it builds the field; the truth must match. */
export function practiceField(ra, dec) {
  const round4 = (v) => {
    const r = Math.round(Number(v) * 1e4) / 1e4;
    return r === 0 ? 0 : r;
  };
  return { ra: round4(ra), dec: round4(dec) };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(mjd) {
  const d = new Date(Math.round((mjd - 40587) * 86400000));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

function compass(paDeg) {
  return COMPASS[Math.round((((paDeg % 360) + 360) % 360) / 45) % 8];
}

/** Offset of (ra, dec) from (ra0, dec0) on the tangent plane, arcsec: east and north positive. */
function tangentOffset(ra, dec, ra0, dec0) {
  const d2r = Math.PI / 180;
  const dra = (ra - ra0) * d2r;
  const sd = Math.sin(dec * d2r);
  const cd = Math.cos(dec * d2r);
  const s0 = Math.sin(dec0 * d2r);
  const c0 = Math.cos(dec0 * d2r);
  const cosc = s0 * sd + c0 * cd * Math.cos(dra);
  if (!(cosc > 0)) return { east: NaN, north: NaN };
  return { east: ((cd * Math.sin(dra)) / cosc / d2r) * 3600, north: ((c0 * sd - s0 * cd * Math.cos(dra)) / cosc / d2r) * 3600 };
}

function fix(value, digits) {
  const text = Number(value).toFixed(digits);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** What each kind of planted object is called and how the tool shows it. The numbers come from the generator. */
const KINDS = {
  mover: {
    title: 'Fast mover',
    lookFor: 'Blink the passes: it is the dot that hops while everything else stays put. Click it and open Motion.',
  },
  variable: {
    title: 'Variable star',
    lookFor: 'Open the residual view: it stands out in the pass where it is brighter. Click it and open the light curve.',
  },
  methane: {
    title: 'Methane-rich object',
    lookFor: 'Use the methane lens: it goes dark at 3.3 micrometres where ordinary stars do not. Click it for the spectrum.',
  },
};

/**
 * describeTruth(synth, ra, dec) -> truth, read from synth.syntheticSky(ra, dec):
 *
 * { simulated: true, ra, dec,                      // the field centre the generator used
 *   passes: [{ index, label, mjdStart, mjdEnd, mjdMid, exposures }],
 *   objects: [{ id, kind, title, summary, lookFor, inCatalog,
 *               offset: { east, north },           // arcsec from the field centre at the first pass
 *               motion: { east, north, total, paDeg },   // arcsec per year
 *               positions: [{ pass, mjd, ra, dec, scale }],   // at the middle of each pass
 *               detail }],                         // numbers behind the summary
 *   fieldStars: n,
 *   positionsAt(mjd) -> [{ id, kind, ra, dec }]    // the planted objects only
 * }
 *
 * `ra`, `dec` may also be a synthetic frame id (string): the field is then read from the id.
 */
export function describeTruth(synth, ra, dec) {
  if (!synth || typeof synth.syntheticSky !== 'function') throw new PracticeError('The practice sky generator is missing');
  let field = null;
  if (typeof ra === 'string') {
    const parsed = typeof synth.parseSyntheticId === 'function' ? synth.parseSyntheticId(ra) : null;
    if (!parsed) throw new PracticeError('That exposure is not from the practice sky');
    field = { ra: parsed.ra, dec: parsed.dec };
  } else {
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) throw new PracticeError('The practice sky needs a position');
    field = practiceField(ra, dec);
  }
  const sky = synth.syntheticSky(field.ra, field.dec);
  const exposures = Array.isArray(sky.exposures) && sky.exposures.length ? sky.exposures : sky.frameRefs || [];

  // Passes: from the generator's own pass numbers, or from gaps of more than 45 days.
  const groups = new Map();
  const sorted = [...exposures].sort((a, b) => a.mjd - b.mjd);
  let auto = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].mjd - sorted[i - 1].mjd > 45) auto += 1;
    const key = Number.isInteger(sorted[i].pass) ? sorted[i].pass : auto;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sorted[i].mjd);
  }
  const passes = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, mjds], index) => {
      const mjdStart = Math.min(...mjds);
      const mjdEnd = Math.max(...mjds);
      const mjdMid = (mjdStart + mjdEnd) / 2;
      return { index, label: monthLabel(mjdMid), mjdStart, mjdEnd, mjdMid, exposures: mjds.length };
    });
  const epochs = passes.length ? passes.map((p) => p.mjdMid) : [60836];
  const spanYears = (epochs[epochs.length - 1] - epochs[0]) / 365.25;

  const atEpoch = epochs.map((mjd) => new Map((sky.sourcesAt(mjd) || []).map((s) => [s.id, s])));
  const truthObjects = Array.isArray(sky.objects) ? sky.objects : [];
  const planted = truthObjects.filter((o) => o && o.kind && o.kind !== 'star');

  const objects = planted.map((o) => {
    const kind = KINDS[o.kind] || { title: String(o.kind), lookFor: '' };
    const east = Number(o.pmE) || 0;
    const north = Number(o.pmN) || 0;
    const total = Math.hypot(east, north);
    const paDeg = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
    const positions = epochs.map((mjd, i) => {
      const s = atEpoch[i].get(o.id);
      const scale = s && s.spectrum && Number.isFinite(s.spectrum.scale) ? s.spectrum.scale : 1;
      return { pass: i, mjd, ra: s ? s.ra : NaN, dec: s ? s.dec : NaN, scale };
    });
    const scales = positions.map((p) => p.scale);
    const ratio = Math.max(...scales) / Math.min(...scales);
    const brightest = positions[scales.indexOf(Math.max(...scales))];
    const bands = o.spectrum && Array.isArray(o.spectrum.bands) ? o.spectrum.bands.filter((b) => b.depth > 0) : [];
    const deepest = bands.length ? bands.reduce((a, b) => (b.depth > a.depth ? b : a)) : null;
    const inCatalog = o.inGaia !== false;
    const detail = { hopArcsec: total * spanYears, spanYears, ratio, brightestPass: brightest ? brightest.pass : 0, band: deepest ? { ...deepest } : null };

    let summary;
    if (o.kind === 'mover') {
      summary = `Moves ${fix(total, 1)} arcsec per year towards the ${compass(paDeg)}: about ${fix(detail.hopArcsec, 0)} arcsec (${fix(detail.hopArcsec / 6.15, 1)} SPHEREx pixels) between the first and the last pass.`;
    } else if (o.kind === 'variable') {
      summary = `Its brightness changes by a factor of ${fix(ratio, 1)}: brightest in ${passes[detail.brightestPass] ? passes[detail.brightestPass].label : 'one pass'}.${total < 0.05 ? ' It does not move.' : ''}`;
    } else if (o.kind === 'methane' && deepest) {
      summary = `Absorbs ${fix(deepest.depth * 100, 0)} percent of its light near ${fix(deepest.center, 2)} micrometres, like methane in a cold atmosphere.${inCatalog ? '' : ' It is not in the star catalogue.'}`;
    } else {
      const parts = [];
      if (total > 0.05) parts.push(`moves ${fix(total, 2)} arcsec per year`);
      if (ratio > 1.05) parts.push(`varies by a factor of ${fix(ratio, 1)}`);
      if (deepest) parts.push(`absorbs near ${fix(deepest.center, 2)} micrometres`);
      summary = parts.length ? `Planted object: ${parts.join(', ')}.` : 'Planted object.';
    }

    return {
      id: String(o.id),
      kind: String(o.kind),
      title: kind.title,
      summary,
      lookFor: kind.lookFor,
      inCatalog,
      offset: tangentOffset(positions[0].ra, positions[0].dec, sky.ra ?? field.ra, sky.dec ?? field.dec),
      motion: { east, north, total, paDeg },
      positions,
      detail,
    };
  });
  const plantedIds = new Set(objects.map((o) => o.id));
  return {
    simulated: true,
    ra: sky.ra ?? field.ra,
    dec: sky.dec ?? field.dec,
    passes,
    objects,
    fieldStars: truthObjects.length - planted.length,
    positionsAt(mjd) {
      const when = Number.isFinite(mjd) ? mjd : epochs[Math.floor(epochs.length / 2)];
      return (sky.sourcesAt(when) || []).filter((s) => plantedIds.has(String(s.id))).map((s) => ({ id: String(s.id), kind: s.kind, ra: s.ra, dec: s.dec }));
    },
  };
}

/** practiceTruth(ra, dec) or practiceTruth(frameId): loads the generator, then describeTruth. */
export async function practiceTruth(ra, dec, { synth = null } = {}) {
  return describeTruth(synth || (await loadSynth()), ra, dec);
}

/**
 * Overlays for an "answers" toggle: one labelled marker per planted object at its position at
 * `mjd` (the date of the frame on screen; the fast mover is somewhere else in every pass).
 * The result merges into viewer.setOverlays / app.addOverlay: { markers: [{ ra, dec, kind, label }] }.
 */
export function revealAnswers(truth, mjd) {
  if (!truth || typeof truth.positionsAt !== 'function') return { markers: [] };
  const titles = new Map(truth.objects.map((o) => [o.id, o.title]));
  const markers = [];
  for (const p of truth.positionsAt(mjd)) {
    if (!Number.isFinite(p.ra) || !Number.isFinite(p.dec)) continue;
    markers.push({ ra: p.ra, dec: p.dec, kind: 'target', label: `Planted: ${String(titles.get(p.id) || p.kind).toLowerCase()}`, simulated: true, id: p.id });
  }
  return { markers };
}
