// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Pure coordinate math for the image viewer. No DOM, importable in Node.
//
// Three coordinate systems are involved:
//   sky     (ra, dec) in degrees, ICRS
//   grid    (x, y) continuous 0-based grid pixels; integer values are pixel centres, array row 0
//           is SOUTH (y increases north), x increases WEST (east is to the left)
//   canvas  (u, v) CSS pixels inside the viewer; v increases DOWN, so the viewer flips y
//
// Grid definition (from CONTRACT.md): { ra0, dec0, n, scale }, scale in arcsec per pixel,
//   xi_arcsec  = -(x - (n-1)/2) * scale      (east positive)
//   eta_arcsec =  (y - (n-1)/2) * scale      (north positive)
// with (xi, eta) the gnomonic (TAN) projection about (ra0, dec0).
//
// A view transform `t` is a plain object { n, size, ox, oy, zoom, cx, cy }:
//   n      grid pixels per side
//   size   side of the square viewport in CSS pixels, with its top-left corner at (ox, oy)
//   zoom   magnification, 1 = whole grid fits the viewport
//   cx, cy grid coordinate shown at the centre of the viewport

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Gnomonic projection. Returns [xi_deg, eta_deg], xi positive east; [NaN, NaN] behind the tangent plane. */
export function tanProject(ra, dec, ra0, dec0) {
  const d = dec * D2R;
  const d0 = dec0 * D2R;
  const da = (ra - ra0) * D2R;
  const sd = Math.sin(d), cd = Math.cos(d);
  const sd0 = Math.sin(d0), cd0 = Math.cos(d0);
  const cda = Math.cos(da);
  const cosc = sd0 * sd + cd0 * cd * cda;
  if (!(cosc > 1e-9)) return [NaN, NaN];
  const xi = (cd * Math.sin(da)) / cosc;
  const eta = (cd0 * sd - sd0 * cd * cda) / cosc;
  return [xi * R2D, eta * R2D];
}

/** Inverse gnomonic projection. Returns [ra, dec] in degrees, ra in [0, 360). */
export function tanDeproject(xiDeg, etaDeg, ra0, dec0) {
  const xi = xiDeg * D2R;
  const eta = etaDeg * D2R;
  const d0 = dec0 * D2R;
  const sd0 = Math.sin(d0), cd0 = Math.cos(d0);
  const den = cd0 - eta * sd0;
  const ra = ra0 + Math.atan2(xi, den) * R2D;
  const dec = Math.atan2(sd0 + eta * cd0, Math.hypot(xi, den)) * R2D;
  return [((ra % 360) + 360) % 360, dec];
}

/** Sky position -> continuous grid pixel [x, y]. */
export function gridSkyToPix(grid, ra, dec) {
  const [xi, eta] = tanProject(ra, dec, grid.ra0, grid.dec0);
  const c = (grid.n - 1) / 2;
  return [c - (xi * 3600) / grid.scale, c + (eta * 3600) / grid.scale];
}

/** Continuous grid pixel -> sky position [ra, dec]. */
export function gridPixToSky(grid, x, y) {
  const c = (grid.n - 1) / 2;
  const xi = (-(x - c) * grid.scale) / 3600;
  const eta = ((y - c) * grid.scale) / 3600;
  return tanDeproject(xi, eta, grid.ra0, grid.dec0);
}

/** Largest centred square inside a w x h box. */
export function letterbox(w, h) {
  const size = Math.max(0, Math.floor(Math.min(w, h)));
  return { ox: Math.floor((w - size) / 2), oy: Math.floor((h - size) / 2), size };
}

/** The default view: whole grid visible. */
export function defaultView(n) {
  return { zoom: 1, cx: (n - 1) / 2, cy: (n - 1) / 2 };
}

/** Highest useful zoom: about four grid pixels across the viewport, never less than 4x. */
export function maxZoomFor(n) {
  return Math.max(4, n / 4);
}

/** Keep the zoom in [1, maxZoom] and the image covering the whole viewport (no empty borders). */
export function clampView(n, view, maxZoom = maxZoomFor(n)) {
  let zoom = Number.isFinite(view.zoom) ? view.zoom : 1;
  zoom = Math.min(Math.max(zoom, 1), Math.max(1, maxZoom));
  const half = n / (2 * zoom);
  const lo = -0.5 + half;
  const hi = n - 0.5 - half;
  const mid = (n - 1) / 2;
  const fix = (c) => (Number.isFinite(c) ? (lo > hi ? mid : Math.min(Math.max(c, lo), hi)) : mid);
  return { zoom, cx: fix(view.cx), cy: fix(view.cy) };
}

/** CSS pixels per grid pixel. */
export function pixelScale(t) {
  return (t.size * t.zoom) / t.n;
}

/** Grid pixel -> canvas CSS pixel. North (larger y) is nearer the top; east (smaller x) is left. */
export function gridToCanvas(t, x, y) {
  const k = pixelScale(t);
  return [t.ox + t.size / 2 + (x - t.cx) * k, t.oy + t.size / 2 - (y - t.cy) * k];
}

/** Canvas CSS pixel -> continuous grid pixel. */
export function canvasToGrid(t, u, v) {
  const k = pixelScale(t);
  return [t.cx + (u - t.ox - t.size / 2) / k, t.cy - (v - t.oy - t.size / 2) / k];
}

export function skyToCanvas(grid, t, ra, dec) {
  const [x, y] = gridSkyToPix(grid, ra, dec);
  return gridToCanvas(t, x, y);
}

export function canvasToSky(grid, t, u, v) {
  const [x, y] = canvasToGrid(t, u, v);
  return gridPixToSky(grid, x, y);
}

/** Canvas rectangle covered by the whole n x n image (pixel edges, not centres). */
export function imageRect(t) {
  const k = pixelScale(t);
  return {
    x: t.ox + t.size / 2 + (-0.5 - t.cx) * k,
    y: t.oy + t.size / 2 - (t.n - 0.5 - t.cy) * k,
    w: t.n * k,
    h: t.n * k,
  };
}

/** Zoom by `factor` keeping the grid point under canvas position (u, v) fixed. Returns a clamped view. */
export function zoomAbout(t, u, v, factor, maxZoom = maxZoomFor(t.n)) {
  const [gx, gy] = canvasToGrid(t, u, v);
  const zoom = Math.min(Math.max(t.zoom * factor, 1), Math.max(1, maxZoom));
  const k = (t.size * zoom) / t.n;
  const cx = gx - (u - t.ox - t.size / 2) / k;
  const cy = gy + (v - t.oy - t.size / 2) / k;
  return clampView(t.n, { zoom, cx, cy }, maxZoom);
}

/** Pan so the image follows a pointer that moved by (du, dv) CSS pixels. Returns a clamped view. */
export function panBy(t, du, dv, maxZoom = maxZoomFor(t.n)) {
  const k = pixelScale(t);
  return clampView(t.n, { zoom: t.zoom, cx: t.cx - du / k, cy: t.cy + dv / k }, maxZoom);
}

/** Nearest grid pixel index (y * n + x) for a continuous grid position, or -1 outside the grid. */
export function nearestPixel(n, x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (!(ix >= 0 && iy >= 0 && ix < n && iy < n)) return -1;
  return iy * n + ix;
}

const BAR_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200];

/** "30 arcsec", "2 arcmin", "1 deg": a label for a round angle given in arcsec. */
export function formatAngle(arcsec) {
  if (arcsec < 60) return `${+arcsec.toFixed(1)} arcsec`;
  if (arcsec < 3600) return `${+(arcsec / 60).toFixed(1)} arcmin`;
  return `${+(arcsec / 3600).toFixed(1)} deg`;
}

/**
 * Pick a round scale-bar length: the longest of 10", 30", 60", 2', 5' (and smaller or larger round
 * steps when zoomed) that is no wider than maxPx. Returns { arcsec, px, label }.
 */
export function pickScaleBar(arcsecPerPx, maxPx) {
  if (!(arcsecPerPx > 0) || !(maxPx > 0)) return null;
  let best = BAR_STEPS[0];
  for (const s of BAR_STEPS) {
    if (s / arcsecPerPx <= maxPx) best = s;
    else break;
  }
  return { arcsec: best, px: best / arcsecPerPx, label: formatAngle(best) };
}

/** Three significant figures, compact, for colourbar ends and the pixel readout. */
export function formatValue(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e5 || a < 1e-3) return v.toExponential(1).replace('e+', 'e');
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.1) return v.toFixed(3);
  return v.toFixed(4);
}

/** "269.45213 +4.69012" decimal degrees, 5 places (0.04 arcsec). */
export function formatDeg(ra, dec) {
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return '';
  return `${ra.toFixed(5)} ${dec >= 0 ? '+' : '-'}${Math.abs(dec).toFixed(5)}`;
}

/** MJD (UTC) -> "YYYY-MM-DD" or "YYYY-MM-DD HH:MM". */
export function mjdToIso(mjd, withTime = false) {
  if (!Number.isFinite(mjd)) return '';
  const d = new Date(Math.round((mjd - 40587) * 86400000));
  if (Number.isNaN(d.getTime())) return '';
  const iso = d.toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

/**
 * Run-length encode the set pixels of an n x n mask as rectangles one pixel high, for building a
 * clip path. Returns a flat Int32Array [x, row, length, ...]. With flipY (the default, for arrays
 * in grid order) `row` is the DISPLAY row: 0 at the top (north), i.e. n - 1 - y.
 */
export function maskRuns(mask, n, flipY = true) {
  const out = [];
  if (!mask) return new Int32Array(0);
  for (let y = 0; y < n; y++) {
    const row = flipY ? n - 1 - y : y;
    const base = y * n;
    let x = 0;
    while (x < n) {
      if (mask[base + x]) {
        const x0 = x;
        while (x < n && mask[base + x]) x++;
        out.push(x0, row, x - x0);
      } else {
        x++;
      }
    }
  }
  return Int32Array.from(out);
}
