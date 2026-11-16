# Validation findings about other modules

Written by plugin-validate on 2026-11-15, from `tools/validate-synthetic.mjs` (23 of 23 checks pass on
five synthetic fields) and from reading the shell. None of these blocks anything. Nothing was edited
outside `web/src/plugins/validate/`, `tools/validate-synthetic.mjs` and this folder of docs.

## 1. Residual view: significances are understated by about 0.6 (documented choice, worth a line in the UI)

- File and function: `web/src/core/reproject.js`, `reproject()`, option `variance: 'interp'` (the default).
- Evidence: on blank sky of the synthetic field (RA 150.1, Dec 2.2, D3, 42 exposures, 448 019 pixel
  samples) the standard deviation of residual / sigma is **0.63 on the layers as the app builds them**
  and **0.90 when the same frames are reprojected with `variance: 'propagate'`**. The fake field of the
  unit tests gives 0.59 and 0.84. A value of 1 would mean the noise model is exact.
- Cause: bilinear resampling averages up to four native pixels, which lowers the noise of a grid pixel,
  while the interpolated variance keeps the single-pixel value. The file header says so and explains
  why (aperture sums). The consequence is in `core/skymodel.js`: a "5 sigma" residual is really about
  8 sigma, so the candidate list is conservative, not wrong. The remaining 0.90 instead of 1.00 comes
  from the model floor in `fitSkyModel`.
- Suggestion: either pass `variance: 'propagate'` for the layers that feed `fitSkyModel`, or say
  "conservative by about 0.6" where the residual threshold is explained. The Validation panel reports
  both numbers in its Noise rows.

## 2. `app.goTo` drops the detector and the field size

- File: `web/src/main.js`, the plugin host object, `goTo: (t) => { if (t) goTo({ ra, dec, name }) }`
  (line 2000 at the time of writing). The inner `goTo()` accepts `det` and `fov`; the public one does
  not pass them on. CONTRACT-PLUGINS.md only promises `{ ra, dec, name? }`, so this is by the letter.
- Effect: a plugin cannot send the user to "Epsilon Indi Ba,Bb on D6, 6 arcmin" in one call.
- What the Validation tour does instead: `app.store.set({ det, fov })` first, then `app.goTo(...)`. The
  shell cancels the stale load, so one load runs. It works today and was tested against a fake app that
  mirrors this behaviour. Passing `det` and `fov` through would make it one call; the tour already
  sends both fields.

## 3. The tour relies on `complete` in the 'frames' event

- File: `web/src/main.js`, `emit('frames', { det, count, total, complete })`. The contract lists the
  event but not its payload. The tour treats `complete: true` with `count: 0` as "no exposures", and
  `complete: true` otherwise as "loaded". If the flag is ever removed, `waitForData` falls back to the
  'movie' event followed by 1.5 s of quiet, and to a timeout (90 s without a new exposure, 300 s in all).
- A failed load (`showError`) emits nothing. The tour then waits out the 90 s and reports "nothing
  arrived for 90 s". An `'error'` event, or `complete: true` with an `error` field, would let it say why
  and move on at once.

## 4. Few usable reference stars in a 4 arcmin synthetic field

- File: `proxy/fixtures/synth.js`, `syntheticSky()`: 25 field stars over the tile, of which 3 to 4 are
  inside a 4 arcmin field, isolated (no brighter neighbour within 18.45 arcsec) and bright enough.
- Effect: at `fov=4` the null test rests on 3 to 4 stars and its error of the mean is 70 to 120 mas/yr
  (still 23 of 23 checks at RA 150.1, Dec 2.2, but two other fields came out near 2.7 sigma in earlier
  runs); at `fov=6` it has 8 slow stars of 9 reference stars and about 53 mas/yr.
  `tools/validate-synthetic.mjs` therefore runs at 6 arcmin. Real fields at low galactic latitude have more stars but also more crowding; the panel
  prints how many stars were used and why the others were left out.

## 5. Not a fault: the mover's candidate sits 3.5 arcsec from the star

- File: `web/src/core/skymodel.js`, `findCandidates()` (as listed by `web/src/pipeline.js`
  `prepareResidual`). The candidate for the fast star is 1.15 grid pixels from the star's true mean
  position, the variable's is 0.03 pixel away. A star that moves 10 arcsec a year leaves a positive
  and a negative lobe on either side of its mean position, and the candidate is the centroid of one
  lobe. An earlier version of `findCandidates` returned a ring of duplicate peaks around each source;
  the version in the tree at 08:07 UTC does not, and the list for the synthetic field is exactly the
  two planted objects, with no strays.

## Checked and found in order

- WCS, reprojection, stacking, centroids: field stars sit 0.009 arcsec (median) from their Gaia
  positions with 0.09 arcsec scatter per axis, 0.015 SPHEREx pixel.
- `fitMotion`: 10323 ± 134 mas/yr against 10401 for the synthetic mover, direction 355.30 ± 0.74 deg
  against 355.59. The formal errors of the centroids alone (about 0.02 arcsec) are too small by a factor
  of five because they ignore undersampling; the plugin adds the field-star scatter in quadrature.
- `extractSpectrum` and `lightCurve`: the variable's ratio is 1.989 ± 0.031 against 1.999; a constant
  star stays constant within 1 percent, which is the repeatability floor the plugin adds.
- Methane band depth on D4: 0.784 ± 0.018 against 0.816.
