
## ui-plots (web/src/plots/)

- **Contract signatures are implemented exactly**; everything below is additive. Extras:
  `createSpectrumPlot(container, { colorBy, units, logY, features })`, `setData({ ..., colorBy: 'pass' })`,
  `setOptions()`, `getOptions()`; `createLightCurvePlot().getVerdict()`; `createMotionMeter().setData({ ..., title })`
  and `.getVerdict()`; `destroy()` and `el` on all three. Pure helpers are exported for reuse and tests
  (`lightCurveVerdict`, `epochMeans`, `motionVerdict`, `spectrumToCsv`, `spectrumAxis`, ...).
- **`model` shape was not specified.** The spectrum accepts `[{ wave, flux_uJy }]`, `{ wave: [], flux_uJy: [] }`
  or a function `wave_um -> flux_uJy`.
- **Self-contained on purpose:** `svg.js` re-implements `splitPasses` (45-day gap), the detector band table and
  MJD-to-calendar conversion instead of importing `core/frames.js` / `core/time.js`, so the plots work and test
  without the science library. Same numbers as the contract; if the detector bands change, change `DETECTORS`
  in `web/src/plots/svg.js` too.
- **Styles are injected by JS** (`plots.css.js`, one `<style id="tbp-plots-css">`), not in `web/styles.css`.
  All classes are prefixed `tbp-`; colours can be overridden with `--tbp-ink/paper/stone/signal/muted/raised`.
  The figures have a transparent background and expect an Ink panel behind them.
- **Stone is used for lines only.** Stone `#77766E` on Ink is 3.9:1, too low for 11 px tick labels, so small
  secondary text is Paper at 66 percent opacity (about 7:1). No new brand colour is introduced.
- **Extra data colours.** Survey passes use blue `#3987E5`, amber `#C98500`, green `#199E70` (validated
  colour-blind safe for all pairs on Ink), a fourth pass magenta `#D55181` with a diamond marker, later passes
  neutral. The light-curve wavelength ramp runs blue to pale to amber. Red is avoided so Signal keeps its
  meaning: the lens band, a detected brightness change, unexplained or Gaia-contradicting motion.
- **Pass colouring replaces the all-pass channel means.** With `colorBy: 'pass'` (or the "Passes" toolbar
  toggle) and two or more passes, the plot draws one channel-mean line per pass, computed inside the plot,
  and hides `binned`: a mean across passes of a source that changed is not a spectrum of anything.
- **Verdict wording.** Light curve: "Brightness rose/fell by a factor of 1.9 between Jun 2025 and Dec 2025
  (12 sigma)." (direction instead of "changed"); detection needs 5 sigma, 3 to 5 sigma reads "Possible change
  ...: not enough to be sure.", otherwise "No change larger than N percent detected." where N is the observed
  difference plus 3 sigma, rounded up. Epoch errors include a 1 percent calibration floor (an assumption, set
  in `epochMeans`, option `floor`). Motion: agreement with Gaia is judged on the vector difference of the two
  proper motions divided by `errTotal`; below 3 sigma the motion itself reads "No motion detected: less than X
  (2 sigma)". Uses the "±" character rather than "+/-".
- **Demo page header.** `demo.html` carries the required two-line header as an HTML comment directly after
  the doctype (an HTML file cannot start with `//`).

## proxy-services

- `fetchWaveTable(det, sampleId, { fetchImpl })` also needs `ra` and `dec` in its options (a
  position inside the sample frame). IRSA only makes cutouts around a position; without one it
  would send the full 65 MB file. The handler passes the position of the cutout request.
- Cache objects have more than the contract's `get(key)` / `put(key, u8, contentType)`:
  `get(key, { maxAgeSeconds, strict })`, `put` resolves `true|false`, and there is `delete(key)`.
  Plain `get(key)` / `put(...)` calls work as specified. Objects written through
  `createSupabaseCache` carry a 16-byte age prefix in the bucket, which `get` strips.
- `fog.js` expects `cache.get` / `cache.put` to throw when storage fails, while the proxy's
  caches never throw. The handler therefore gives `fogRead` / `fogMark` an adapter that reads
  with `{ strict: true }` and turns a failed write into an error; a storage failure on `/fog`
  is answered with 503 (retryable) and the stored map is left alone.
- Additive response fields: `/search` may carry `"stale": true` (with `"cached": true`) when
  IRSA failed and an expired cache entry was served; `/gaia` adds `"source"` and `"cached"`;
  `/health` adds `"backend"` and accepts `?probe=1`; `/cutout` sets `x-tombaugh-cache: hit|miss`.
- `ra` outside 0..360 is rejected with 400 rather than wrapped (360 is accepted as 0).
- `createHandler` accepts further optional settings (`version`, `deps`, `log`, `now`, timeouts);
  see `proxy/README.md`. The synthetic backend uses `syntheticMef(id, cutout)` and `sky.gaia()`
  from `fixtures/synth.js` when they exist, and falls back to the contract's `makeSyntheticMef` /
  `syntheticSky` otherwise.

## ui-viewer (web/src/render/)

- **Contract API is implemented exactly**; everything else is additive and listed at the top of `viewer.js`
  (`createViewer(container, options)`, `setOptions`, `setView/getView/resetView/zoomBy`, `flash`, `toCanvas`,
  `off`, events `leave`, `view`, `option`, properties `element`, `canvas`).
- **`setOverlays` merges by key.** The contract does not say whether a call replaces everything. Keys that
  are absent stay as they were; a key that is present with `null`, `undefined` or `[]` clears that overlay;
  `setOverlays(null)` clears all four. So both `setOverlays({ markers })` after a click and
  `setOverlays({ gaia: on ? stars : undefined, ... })` do what they look like.
- **`COLORMAPS` entries are functions** `t -> [r, g, b]` carrying `.id`, `.label`, `.stops`, `.diverging`
  (the contract only names the keys). A fifth map, `grayinv`, is added. `diverging: true` in `setImage`
  makes the range symmetric about zero (`[-m, m]`, m = the larger of |vmin|, |vmax|) and picks the
  `diverging` map unless another is named.
- **Event payloads carry more than the contract lists**: click adds `value, ix, iy, target, pointerType`;
  hover adds `x, y, ix, iy, masked`. `value` is `null` over masked or non-finite pixels and for RGB images;
  `ra`/`dec` are `null` until `setGrid` has been called. A separate `leave` event fires when the pointer
  leaves (hover never fires with an empty payload).
- **A double-click emits one click, then resets the view** (only while zoomed in; at 1x both clicks are
  ordinary clicks). Clicks are not delayed to wait for a possible second one.
- **Arrow keys pan only while zoomed in.** At 1x they are not handled, so the page-level frame-stepping
  shortcuts keep working with the canvas focused. Keys the viewer handles (`+ = - _ 0`, arrows when zoomed)
  call `preventDefault()` and `stopPropagation()`.
- **Wheel zoom is on by default** and takes the wheel while the pointer is over the image, except when
  fully zoomed out and scrolling down, which scrolls the page. `{ wheelZoom: 'ctrl' }` restricts it to
  Ctrl/Cmd + wheel. On touch screens the canvas is `touch-action: pan-y` at 1x (the page scrolls) and
  `none` once zoomed.
- **Frame cache.** Rendered frames are cached per `image` array object (WeakMap). A sampled content check
  re-renders most arrays refilled in place; `setImage({ ..., cache: false })` bypasses the cache.
- **Cross-fade becomes a cut** when frames arrive less than 1.5 x the fade time apart (so a movie faster
  than about 5 fps is never smeared), under `prefers-reduced-motion`, and for the first frame.
- **Scale bar labels are spelled out** ("30 arcsec", "1 arcmin") rather than using the prime marks, which
  are illegible at 11 px over an image.
- **Self-contained on purpose:** the grid/tangent-plane math (`viewmath.js`), stretches and percentile range
  (`colormaps.js`) are local; the formulas equal `core/wcs.js` and `core/stretch.js`. Styles are injected by
  `viewer.css.js` (one `<style id="tbv-styles">`, classes prefixed `tbv-`), nothing is needed in
  `web/styles.css`. The root element is `width: 100%`, square, `max-height: 100%`.
- **Demo page header.** `demo.html` carries the two-line header as HTML comments before the doctype.

## core-astrometry (web/src/core/astrometry.js, ephemeris.js, distance.js, targets.js)

- **Contract signatures are implemented as written**; everything below is additive or pins down
  something the contract left open.
- **Barnard's Star, Gaia DR3 declination.** The brief asked for a test against Gaia DR3
  (269.44850, +4.73798) at epoch 2016.0, and the contract's `/gaia` example shows `"dec": 4.7380`.
  That declination is 5.3 arcsec off. The stated 2000.0 position and proper motion force
  4.693391 + 16 x 10.3625 / 3600 = +4.73945 at 2016.0, and Gaia DR3 4472832130942575872 is at
  +4.73942 (carried back to 2000.0 it lands 0.07 arcsec from the 2000.0 position in the brief).
  The test uses +4.73942 and passes at 0.10 arcsec. Nothing in the code depends on the wrong value;
  only the example in CONTRACT.md line 193 shows it.
- **`centroid(..., { box })`: `box` is the half-width** of the square window in pixels (window is
  `(2*box+1)^2`, 11 x 11 for the default 5), not the full width: a 7.5 arcsec PSF on the 3.075
  arcsec grid needs that much room for a local sky estimate. The result also carries `snr`,
  `background`, `noise`, `xErr`, `yErr`, `fluxErr`, `peak`, `iterations`, `validFrac`; when
  `ok` is false, `x`, `y` are the input guess. Options `sigma`, `minSnr` (default 4), `maxIter`,
  `tol`, `minValidFrac`, `noise`.
- **`propagate`: a star without `epoch` is taken to be at 2016.0** (Gaia DR3), because `/gaia` puts
  the epoch on the response, not on each star. Optional `star.rv` (km/s) adds perspective
  acceleration. `null` proper motion or parallax counts as zero.
- **`fitMotion` weights:** `w` is read as an inverse variance in arcsec^-2; `sigma` (arcsec) is
  accepted instead and wins. Errors are formal when every point is weighted (inflated by
  sqrt(chi2/dof) if the scatter is larger), from the scatter alone when no point is weighted, and
  NaN for two unweighted points. Extra result fields: `errPmra`, `errPmdec`, `errPaDeg`, `ra0`,
  `dec0`, `mjd0`, `chi2`, `dof`, `rmsArcsec`, `parallax`, `errParallax` (null unless fitted).
  `fitMotionWithParallax(points, { gapDays = 45 })` fits parallax only when the points span three
  or more passes, otherwise returns the plain fit.
- **`matchGaia`** returns the star object from the input array (same reference); extra sixth
  argument `{ epoch, parallax }`; `matchGaiaDetailed` returns `{ star, sepArcsec, ra, dec, index }`.
- **`parallaxOffset`** also returns the apparent `ra`, `dec` and `distGeoAU`. `dra_arcsec` is
  `(ra_apparent - ra) * cos(dec_heliocentric) * 3600`, exactly invertible at any distance.
- **`predictedTrack`** entries also carry `dEast`, `dNorth` (tangent-plane arcsec from the input
  direction) and `distGeoAU`. The heliocentric reference epoch is `mjds[0]` unless
  `motion.refMjd` is given.
- **`shiftAndStack(layers, grid, offsets, { clip, psfFwhmArcsec, region })`** also returns `snr`
  and `noise`. `snr` is the matched-filter (psi/phi) signal-to-noise of a point source, not
  `image / sqrt(variance)`: the per-pixel ratio changes by up to 60 percent with the sub-pixel
  phase of the shifts, which puts false structure in a focus curve. Masked pixels are NaN in
  `image`, `variance` and `snr` (and 1 in `mask`). Layers without `variance` get a uniform
  variance from their own scatter.
- **Additional exports:** astrometry `separationArcsec`, `positionAngle`, `offsetBy` (returns
  `{ ra, dec }`), `tangentOffset`, `yearFromMjd`, `mjdFromYear`, `centroidError`,
  `GAIA_DR3_EPOCH`; ephemeris `parallaxFactors`, `sunElongation`, `earthBaselineBetween`,
  `earthEclipticOfDate`, `earthEclipticJ2000`, `OBLIQUITY_J2000_DEG`, `ARCSEC_PER_RAD`; distance
  `hopArcsec`, `distanceFromHop`, `keplerRate`, `heliocentricFromApparent`, `trackThrough`,
  `trackOffsets`, `dialSweep`, `focusPeak`; targets `findTarget`, `motionSummary`,
  `CHALLENGE_TARGET_IDS`. No export name collides with another `core/` module.
- **`TARGETS` extras:** each entry also has `kind`, `challenge` and `aliases`. R Draconis and M101
  carry `pmra = pmdec = parallax = 0`, meaning "not applied" (invisible at this pixel scale), not
  a measurement.
- **Imports:** `astrometry.js` imports `ephemeris.js`; `distance.js` and `targets.js` import
  those two. Nothing is imported from modules owned by anyone else.

## fog-of-war

No contract signature was changed. Notes for whoever wires the module:

- `fogMark(cache, ra, dec)` rejects with `RangeError` when `ra`/`dec` are not finite numbers or
  `dec` is outside [-90, 90] (RA is wrapped). Nothing is written. `fogCell(ra, dec)` returns -1 for
  the same inputs, so the handler can answer 400 before calling `fogMark`.
- Errors from `cache.get` / `cache.put` propagate out of `fogRead` and `fogMark` ("zeros" is only
  for a missing or malformed object). `fogMark` never writes after a failed read, so a storage
  hiccup cannot replace the shared map with an empty one.
- Marks made through the same cache object in one process are queued and lose nothing; across
  processes it is plain read-modify-write, as the contract allows.
- The map never marks anything itself. `onPick` hands the cell centre to the shell, which calls
  `api.fogMark` and then `setCounts`. The first `setCounts` just shows the map; later calls pulse
  the cells whose count rose. Until the first `setCounts` the header reads "Waiting for the shared
  map" rather than claiming that nothing has been opened.
- Additions beyond the contract (all optional): `fogStats`, `fogCell`, `fogEncode`, `fogDecode`,
  `ang2pixNest` and constants in `proxy/src/fog.js`; `npix`, `cellSizeDeg`, `neighboursNest`,
  `xyf2nest`, `nest2xyf`, `xyf2loc` in `healpix.js`; `createFogMap` options `ra0`, `targets`,
  `random` and methods `markLocal`, `pickUnopened`, `getCounts`, `cellAt`, `project`, `element`;
  `setCounts` also accepts the raw 24,576-byte body of `GET /fog`; `setHere(null)` clears the marker.
- The five target positions are hard-coded in `web/src/fog/skylines.js` (`FOG_TARGETS`) instead of
  imported from `core/targets.js`, so the map has no dependency outside `web/src/fog/`. Pass
  `targets` to `createFogMap` to use the shared list.
- `web/src/fog/projection.test.js` also covers `skylines.js` and the map's cell geometry
  (`fogGeometry` from `fogmap.js`), since those files have no test file of their own.

## proxy-fits (proxy/src/fits.js, wavetab.js, encode.js, proxy/fixtures/synth.js)

- **Contract signatures are implemented as written**; everything below is additive or a
  clarification.
- `parseHeaderBlock` returns `null` only for "need more bytes". If the bytes at `offset` do not
  start an HDU (first keyword neither `SIMPLE` nor `XTENSION`, for example an HTML error page) it
  **throws** `Not a FITS file: ...`. A keyword with no value is stored as `null`. `CONTINUE` long
  strings are joined; if a keyword repeats, the first occurrence wins.
- `Hdu` also carries `index`, `type` (`PRIMARY` | `IMAGE` | `BINTABLE`), `headerOffset`,
  `headerBytes`, `paddedDataBytes`. HDU 0 is named `PRIMARY`. `parseMef` on a truncated buffer
  lists the HDUs whose header is complete; `readImage` throws if that HDU's data are cut short.
  Extra exports: `findHdu(hdus, name)`, `tableColumns(header)`, `FITS_BLOCK`.
- `readImage` returns `Int16Array` / `Uint8Array` / `Float64Array` for BITPIX 16 / 8 / -64 and 64.
  With a non-trivial BSCALE/BZERO the result is floating point (`Float64Array` for 32-bit integers).
- `readWaveTable` returns `nk` (planes per node, 2 in real files) next to `x, y, values, nx, ny`.
  `waveAt` treats a missing `nk` as 2.
- `readUntilPsf(stream, { maxBytes = 64 MiB })` also accepts an async iterable of chunks. It
  cancels as soon as the last byte of ZODI's padded data has arrived (the ZODI header says where
  that is), without waiting for the EPSF header that follows; the returned bytes are the same. If
  `EPSF` ever came before `ZODI` it stops at the EPSF header and the result ends before `ZODI`
  (the table can only be skipped by not reading it).
- `wavetab.js` also exports `bandwidthAt`, `bandwidthMap`, `detectorXY(header, x, y)`. If the `W`
  keys are missing it falls back to the `A` keys (0-based detector pixel) and throws if both are absent.
- `buildFrame`: `waveTable` may be omitted when `u8` is a complete file that still contains the
  `WCS-WAVE` extension. Header values that are missing become `null` in the JSON (never NaN).
  `exptime` falls back to `EXPTIME`, `obsid`/`det` fall back to the id, `release` is `null` when the
  id is not an IRSA uri. A header with `CDi_j` instead of `PCi_j` is returned as `pc` with
  `cdelt = [1, 1]`. Extra exports: `headerToWcs(header)`, `parseFrameId(id)`.
- `decodeFrame` returns typed arrays that are **views into the input buffer** when aligned
  (little-endian hosts), copies otherwise. It also returns `version`, `dateObs`, `bunit`, `detXY0`.
- `makeSyntheticMef`: `mjd` is the exposure **start** (MJD-OBS, like `/search`); MJD-AVG is 57.6 s
  later. `rollDeg` is the position angle (east of north) of detector +y. Extra options: `crval`
  (pointing) or `detX`/`detY` (detector pixel the cutout centre falls on, default 1676, 539 as in
  the real file), `obsid`, `version`, `noise`, `badPixels`. Cutouts are clipped at the detector edge
  (NAXIS shrinks) and it throws when the position is off the detector. Every HDU carries
  `SYNTHETC = T` and a COMMENT saying the data are not real. The EPSF stand-in is 121 rows of 1776
  bytes (215 kB), not 441 x 8752.
- `syntheticSky` has 14 exposures per detector per pass (42 per detector, 252 frames). The field
  centre is rounded to 1e-5 deg and written into the id's processing-version segment
  (`l2b-syn-rRRRRRRRR-d[pm]DDDDDDD`), so `syntheticMef(id, { ra, dec, size })` rebuilds a frame from
  the id alone. The sky object also has `mefFor(id, { ra, dec, size })`, `exposures`, `gaia()`
  (shaped like the `/gaia` response, epoch 2016.0, parallax always `null`: the fake sky has proper
  motion but no parallax) and `objects` (truth). The methane object is not in `gaia()`.
- Synthetic wavelength tables fall with detector y on **all six** detectors, copying detector 2.
  Only detector 2 was measured; the direction on the other five real detectors is an assumption.

## tooling (tools/build.mjs, tools/check-headers.mjs, tools/deploy-bundle.mjs, test/e2e*.mjs)

- Playwright: `import { chromium } from 'playwright'` does **not** resolve from this repository
  (ES module resolution ignores `NODE_PATH`, and the package is installed globally). The tools call
  `loadPlaywright()` from `test/e2e-lib.mjs`, which tries the plain import, then `NODE_PATH`, then
  the global `node_modules` next to the `node` binary.
- `tools/build.mjs` has options beyond the brief: `--root`, `--html`, `--meta`, `--asset-limit`,
  `--keep-dynamic`, `--strict`, `--no-check`, `--quiet`. `--banner` takes an optional text; without
  one it writes name, licence, the AI-generated notice, build time and source hash as an HTML
  comment after the doctype. The two-line file header is always the first thing in the bundled
  script (once, not once per module).
- Computed dynamic imports (the plugin loader's `` import(`./plugins/${name}/index.js`) ``) are
  supported: every file matching `./plugins/*/index.js` is bundled and resolved at run time. A
  module reachable **only** through such a pattern that is broken (unresolved import, missing
  export, syntax error) is left out with a loud warning and importing it rejects, which is what
  the shell's try/catch expects; `--strict` turns that into a build failure. Everything reachable
  through static or literal dynamic imports still fails the build, as the brief asks.
- Bundler limits: no top-level `await` (reported with file and line); a *named* import of an
  exported `let` that is reassigned after export is a snapshot (warning printed; namespace imports
  and re-exports are live); `import.meta.url` is the page URL inside the bundle (warning printed).
- `test/e2e.mjs --bundle` writes `dist/e2e-bundle-report.json` and `docs/screens/e2e-bundle-*.png`
  so that it does not overwrite the dev-server run, and adds a twelfth step, `sandbox`, that loads
  the bundle in `<iframe sandbox="allow-scripts">` (opaque origin) and checks that the page asked
  for nothing but itself and the API.
- `tools/deploy-bundle.mjs` also writes `dist/edge/manifest.json` and the files themselves under
  `dist/edge/spherex/`. The lazy `import(new URL('../fixtures/synth.js', import.meta.url).href)`
  in `proxy/src/handler.js` leaves the upload set; it is reported as a warning (an error with
  `--strict`) because it only runs for the synthetic backend.
- Extra test hooks asked for in `test/README.md` beyond the ten in the brief: `landing`, `topbar`,
  `player`.

## ui-experience (web/src/ui/landing.js, explain.js, fx.js, shortcuts.js, hero.js, previews.js, experience.css.js)

- **Contract signatures are implemented exactly**; everything else is additive and listed at the top
  of each file. The ones the shell is most likely to want: `createLanding(container, { ..., parseCoord,
  onExplain, autoFocus })` and the returned `setError(message)`, `setBusy(on, message)`, `setSearch(text)`,
  `focusSearch()`, `el`; `onSearch` may return a promise (busy state until it settles, a rejection's
  message becomes the hint); `createExplainer(container, { onChange })` with `isOpen()`, `current()`,
  `next()`, `destroy()`, and `show()` returning `false` for an unknown id; `explainButton(explainer,
  topicId)`; `createShortcutHelp(container)`; `bindShortcuts(map, { target, enabled })`; `formatKey`.
- **The landing starts hidden.** `createLanding` appends a `<section hidden>`; nothing shows or animates
  until `show()`. It is in normal flow and at least one viewport tall. During `hide()` it is pinned
  with `position: fixed` for 190 ms so the page behind takes its place while it fades.
- **Explainer topics:** the contract's seven plus `'passes'` and `'limits'`. `TOPICS` entries are
  `{ id, title, text: string[], diagram() -> SVG markup }`.
- **`SHORTCUTS`** has one entry beyond the contract list (`close`, Escape) and two optional display
  fields: `display` (keys to show instead of `keys`) and `range` (show as "1 to 6").
- **Escape** for the explainer card and the shortcut help goes through one capture-phase listener
  (`onEscape` in fx.js, a last-opened-first stack) that prevents default, so an `Escape` binding in
  `bindShortcuts` does not also fire while one of them is open.
- **Styles are injected by JS** (`experience.css.js`, one `<style id="tbx-experience-css">`), not in
  `web/styles.css`. Classes are prefixed `tbx-` and scoped under `.tbx`. The explainer card is
  `position: fixed`; move it with `--tbx-explain-top`, `--tbx-explain-right`, `--tbx-z`.
- **One colour outside the brand:** cold blue `#4B8FDB` for the negative half of a subtraction dipole
  (hero, residual diagrams) and the short-wavelength end of the filter ramp in the 'flicker' diagram.
  The brief asks for a red/blue dipole. Small secondary text uses `#A8A59A` (Stone lightened toward
  Paper) because Stone on Ink is 3.9:1; Stone itself is used for lines and marks only.
- **The hero is an illustration, not data.** Its mover hops 2.5 pixels between visits so the blink is
  visible at a glance; Barnard's Star really moves 0.85 pixel per visit (the 'limits' explainer and
  the target cards give the true figures). The residual view keeps blinking, so the dipole and the
  variable flip sign between visits as real per-visit residuals do.
- **Previews:** a seventh kind, `'field'` (plain star field), is the default for unrecognised targets.
  `previewKindFor(target)` honours `target.preview`, then `target.kind` (with `cold` -> `faint`,
  `lpv` -> `longperiod`), then matches id, name and text. The canvas backing store is 64 x 64 and is
  shown at 128 CSS px (a whole multiple, so pixels stay square at any device pixel ratio).
- **A "Pause" control** under the hero stops every animation on the landing (WCAG 2.2.2); it is hidden
  when reduced motion is on, where nothing moves anyway.
- **Target text typography:** `"3.3 um"` in a target's `blurb` / `why` is displayed as `"3.3 µm"`.
- **Demo page header:** `demo.html` carries the two-line header as an HTML comment after the doctype.

## ui-shell (web/index.html, styles.css, src/main.js, state.js, api.js, loader.js, pipeline.js, src/ui/layout.js, controls.js, player.js, tour.js, panels.js, citation.js, toast.js)

- **Contract signatures are kept**; the additions below are all optional extras.
- **Core functions reach the pipeline through one `lib` object.** `main.js` loads every core, render,
  plot and UI module with a literal dynamic `import()` inside `Promise.allSettled`, flattens their
  exports into `lib`, and passes it to `pipeline.js` and `loader.js`. Each use is an adapter with a
  local fallback (pass splitting, inverse-variance stack, robust range, subtraction, sky level), so a
  missing or throwing module costs one feature, not the page. `pipeline.js` imports nothing.
- **`createLoader` extras:** `createLoader({ api, onProgress, lib, concurrency, retries, backoffMs, sleep })`;
  `load({ ra, dec, fov, det, subtractZodi, onPartial })` resolves to
  `{ frames, layers, grid, failed, skipped, refs, search, det }`; also `realign()`, `gaia(ra, dec, radius)`,
  `coverage()`, `clear()`. A cutout that answers HTTP 404 goes to `skipped` and is not retried; other
  failures get two retries with backoff and then go to `failed`. Neither stops the load. The frame
  cache holds the last two targets. `onPartial` fires as frames arrive so the Passes, Exposures and
  Matched views show a growing movie; Residual, Difference, Lens and Distance wait for the full set.
- **`/search` extras are surfaced, not required:** `counts` gives "showing N of M exposures" in About
  this view and drives the "Switch to D…" buttons of the no-exposure state; `complete: false` and
  `source` add one line in About this view; per-frame `x`/`y` are ignored.
- **`createStore`:** subscribers receive `(state, changedKeys, previousState)`.
- **URL state:** only the contract keys are written (defaults omitted, unknown parameters such as
  `api` preserved). `view` also accepts a plugin view id (`/^[a-z][a-z0-9_-]{0,31}$/`); an id that no
  plugin claims falls back to `passes` after the plugins have loaded. `t` is written only while the
  movie is paused, so the address bar does not churn during playback. Colormap, smoothing, clean-sky,
  speed, the blink pair, the difference pair and "every exposure" are session state and are not shared.
- **MovieFrame** carries extra fields beyond the contract: `mjd`, `pass`, `passLabel`, `short`, `layers`,
  `markers`, `snr`, `lensKind`, and for colour frames both `rgb: { r, g, b, ranges }` and a ready
  `rgba` buffer. `buildMovie(view, ctx, lib)` returns `{ view, frames, empty, notes, candidates, passes, ... }`
  where `empty` is the plain-language reason when there are no frames.
- **Two-sided views are always drawn with a linear stretch** (Residual, Difference, depth lenses) and
  a fixed symmetric range (12 sigma for pass stacks and differences, 8 sigma per exposure). An asinh
  stretch of a signed image turns the noise into saturated colour. The Stretch and Colormap controls
  are disabled, with the reason as a tooltip, while such a view is shown.
- **Candidates are clustered.** Up to 40 raw peaks from `findCandidates` are merged within 30 arcsec
  (a mover leaves a bright and a dark lobe per pass) and the strongest of each group is listed, with
  the magnitude of its significance.
- **Distance dial:** logarithmic from 5 AU to 50,000 AU, with the last stop meaning infinity. When a
  body at the chosen distance would hop further than the field between passes, only the exposures
  that stay inside the field are combined and the view says so.
- **Gaia:** one cone of 0.12 degrees per target (covers the widest field), kept for the session;
  at most 120 ghosts are drawn per frame. A ghost counts as "displaced" when the light
  centroid is more than 3.2 arcsec and less than five pixels from the propagated position.
- **Explainer:** the card from `ui/explain.js` is fixed-position, so it is mounted on `document.body`
  and opened from an "Explain this with a picture" button in About this view and from the Help dialog,
  not rendered inline in the tab.
- **Landing:** `createLanding` is used when present; otherwise a built-in list of the tour targets is
  shown. "Surprise me" picks a random position (it does not consult the fog map).
- **Export GIF is not in the shell.** The citation line has Copy citation and Download PNG; animated
  export is left to the `export` plugin through `app.addTool`.
- **Plugin host extras:** besides the `app` members in CONTRACT-PLUGINS.md the object has `app.lib`
  (the flattened core exports), `app.refreshOverlays()` (re-run `addOverlay` functions now) and
  `app.plugins` (what was installed). `addView` builds may be async; a build that throws is logged and the
  view shows its empty state, so it never breaks the shell. The object is also `window.tombaugh`.
- **Embed (`embed=1`)** shows the viewer, the transport and a one-line credit linking to the full view.
  The blink A/B pickers are hidden there (Blink uses the first and last frame); under 720 px the speed
  picker and the caption detail are hidden too, since the image carries its own caption.
- **Source text:** these files contain literal Unicode characters (µ, σ, ″, ·, −) rather than escapes.

## core-spectral (web/src/core/frames.js, stack.js, skymodel.js, photometry.js, lenses.js)

- **Contract signatures are implemented as written**; everything below is additive or a documented choice.
- **Masked output pixels are NaN with mask 1** in every image these modules return (stacks, residuals,
  pass stacks, lens images), never 0, so a renderer cannot mistake "no data" for "no signal".
- **`fitSkyModel`:** `order` is clamped to at most 2 (the adaptive order is still 2 / 1 / 0 / no fit per
  pixel: lower orders are zero-padded, a pixel without a fit has a NaN level and `nUsed` 0). Extra options: `ridge` (1e-4), `passAware` (true: a whole survey
  pass that disagrees with the others is down-weighted, needs at least 3 passes), `gapDays` (45),
  `sysFrac` (0.03). `iterations` is an upper bound; the loop stops early once the rejected set is stable.
  Extra model fields: `scatter` (per-pixel variance inflation measured WITHIN passes), `floor`,
  `stackFloor`, `tMin`, `tMax`, `nLayers`, `nPasses`. Predictions are clamped just outside the fitted wavelength
  range (10% of the range in ln wavelength) instead of extrapolating the polynomial.
- **Significance model.** `residualLayer().snr` = residual / sqrt(variance x scatter + floor) and the
  pass stacks use scatter x stack variance + stackFloor, where the floors include (3% of the model
  brightness)^2 for flat-field, PSF and reprojection systematics. Consequence: on a bright source no
  change can score above about 1 / 0.03 = 33 sigma per unit fractional change.
- **`residualPassStacks`** returns one entry per pass of `splitPasses(layers)` (same order) with the
  extra fields `count`, `variance`, `passIndex`. Options `{ clip = 4, gapDays = 45 }`.
- **`changeMap`** takes `{ threshold = 5, radius = 4, minSep = 1.5, stacks }` and returns `{ score, kind }`
  plus `stacks` and `blobs`. `findCandidates` takes the same extras; each candidate has the contract
  fields `{ x, y, snr, kind, passIndex }` where `x`, `y` are the FRACTIONAL flux-weighted centroid of
  the changed blob (grid pixels) and `snr` is the signed peak, plus `px`, `py` (peak pixel), `npix`,
  `label`, `mjd`. One candidate per distinct position (blobs of other passes within `minSep` pixels are
  merged into the strongest), so a variable is listed once and a mover once per pass position. `CHANGE_KINDS = ['none', 'varies', 'moved']` names the codes.
- **Heuristic for kind** (conservative, documented in skymodel.js): "moved" needs a second blob, in
  another pass or of opposite sign, between 1.5 and 4 grid pixels away; anything else is "varies".
  A body that moves more than 4 grid pixels (about 25 arcsec) between passes is therefore labelled
  "varies" at each position; the distance dial is the tool for those.
- **`aperturePhot`** applies a point-source aperture correction by default (`apCorr: true`, Gaussian
  PSF of `frame.psfFwhm` integrated over the pixels at the source's sub-pixel phase; factor returned as
  `apcor`). Without it a 1.6 pixel aperture on the undersampled PSF reads 4 to 6% low, depending on
  where the source falls on the pixel grid. Extra options `badMask`, `subtractZodi`, `wcsFactory`
  (defaults to `makeWcs`); extra result fields `x`, `y`, `bg`, `nAnnulus`, `npix`, `apcor`.
- **`extractSpectrum`** drops frames where the position is off the detector or the aperture has no
  valid pixels (`keepFailed: true` keeps them with `ok: false`); `track(mjd) -> { ra, dec }` follows a
  moving target. **`binSpectrum`** with `perChannel: false` gives one bin per detector; bins carry
  `n`, `nRejected`, `ch`. **`lightCurve`** points also carry `wave`, `det`, `flux_uJy`, `model_uJy`.
- **`LENSES`** has a sixth lens, `cold` (4.6 um over 3.3 um brightness ratio, kind `ratio`), and every
  lens has a `kind` (`depth` / `ratio` / `rgb`). The `co2` lens uses detector 5 only: its red continuum
  window is [4.38, 4.45] um, of which detector 5 covers the part up to about 4.42 um; loading
  detector 6 for the remainder is not worth a second set of cutouts. `lensImage` accepts a Map or a plain object, takes `{ minSnr = 3, gapDays = 45 }` and
  also returns `kind`, `sigma`, `band`, `continuum`, and `limit` / `rgba` where they apply.
- **Lenses are pass-balanced.** Band and continuum are averaged per survey pass and the passes are
  combined with common weights, so a source that brightened or moved between passes does not fake an
  absorption feature. Pixels with no complete pass fall back to pooling all exposures.
- **`rgbComposite(r, g, b, ranges, { Q = 8, preserveColor = false })`** has a fifth, optional argument;
  inputs may be arrays or `{ image, mask }`.
- **Extra exports:** `detOf`, `channelCenter`, `medianMjd`, `layerWave` (frames.js); `selectKth`,
  `medianInPlace` (stack.js); `CHANGE_KINDS` (skymodel.js); `fitSpectrumModel`, `MJYSR_TO_UJY_PER_PIX`,
  `PHOT_BAD_BITS`, `PHOT_BAD_MASK` (photometry.js, same value as `DEFAULT_BAD_MASK` in flags.js).
- **Tests:** `photometry.test.js` injects a linear WCS through `wcsFactory` and registers a Node
  resolve hook that stubs `./wcs.js` only when that file cannot be resolved.

## plugin-identify-sonify (web/src/plugins/identify/, web/src/plugins/sonify/, proxy/src/identify.js)

- **New proxy route, not yet in CONTRACT.md:** `GET /identify?ra=<deg>&dec=<deg>&radius=<deg>` ->
  `{ "objects": [{ name, type, typeLabel, ra, dec, sepArcsec, pmra, pmdec, parallax, spType, vmag, kmag,
  ids, url }], "source": "simbad" }`, nearest first, at most 20, `radius` clamped to [0.001, 0.1] deg
  (default 12 arcsec). Logic is `identifyCone(ra, dec, radiusDeg, { fetchImpl, timeoutMs = 8000 })` in
  `proxy/src/identify.js`; the route itself has to be wired in `handler.js` by the integrator. Errors
  are `UpstreamError` (imported from `irsa.js`) with status 400 / 502 / 504 and `retryable`, which the
  handler's `toErrorResponse` already maps. The page calls `app.api.identify?.(ra, dec, radius, { signal })`
  when the shell's API client has it and otherwise fetches `${app.api.baseUrl}/identify` itself, so
  `web/src/api.js` needs no change.
- **Two queries instead of one.** The ADQL in the task (`FROM basic`) cannot supply `vmag`, `kmag` or
  `ids`. `identifyCone` therefore first sends the same query with two outer joins
  (`allfluxes.V AS vmag, allfluxes.K AS kmag, ids.ids AS ids`), and if SIMBAD refuses it (HTTP 4xx or an
  unreadable table) sends the plain query from the task once; `vmag`, `kmag` are then `null` and `ids`
  is `[]`. `{ extended: false }` skips the first attempt. The joined query has not been run against
  the live service (no network on the build machine); the fallback is what makes that safe.
- **`identifyFromSynthetic(sky, ra, dec, radiusDeg, { mjd })`** is an extra export for the synthetic
  backend: the fake sky's sources shaped like the `/identify` answer (`source: "synthetic"`), with the
  methane dwarf left out on purpose so the "nothing catalogued" state can be seen in the dev server.
- **`name`** is SIMBAD's `main_id` without its `NAME ` prefix; `url` is built from the unmodified
  `main_id`. `sepArcsec` is computed from the returned coordinates (SIMBAD's `dist` column is only a
  fallback) and results are cut to the requested radius on our side as well.
- **classify.js input:** `motion` may be a `fitMotion()` result or the pipeline's
  `{ measured, gaia, track }` wrapper (what `app.selection().motion` holds). `gaia: null` means "Gaia
  was searched and has nothing within 8 arcsec"; `undefined` means "not checked". The wrapper's own
  `gaia: null` is not read as "not in Gaia", because it is also null when no stars were loaded. Quoted
  spectrum errors are scaled up (never down) when neighbouring points scatter more than they allow.
- **`app.selection().size`** (`{ fwhmArcsec, psfArcsec }`) is read if the shell ever provides it; the
  extended / point-like hints stay silent without it.
- **Sonify events on `window`:** `tombaugh:sonify-cursor` (`detail = { kind, playing, index, total, wave,
  flux }` for a spectrum, `{ ..., mjd, ratio }` for a light curve, and `{ kind, playing: false, wave: null,
  mjd: null }` at the end) and an extra `tombaugh:sonify-play` (`{ kind, scheduled, duration }`) when the
  notes have been scheduled. `install()` returns `{ play(kind), stop(), state(), dispose() }`; `state()`
  is the test hook. The light-curve melody keeps time order but paces notes evenly within a pass and
  replaces the six months between passes with a 0.7 s rest.
- **`mapping.test.js` also covers `synth.js`** (with a fake AudioContext), since no separate test file
  was assigned to the synth.

## plugin-export (`web/src/plugins/export/`)

- **Two extra files:** `frame.js` (the pure half: stand-alone MovieFrame renderer, file names, CSV,
  share link, small formatters) and `frame.test.js`, so that this logic is unit-tested without a DOM.
- **`install(app)` returns `{ dispose(), open(), close() }`.** `open()` lets a shell without
  `app.addTool` (or a keyboard shortcut) show the dialog.
- **Optional shell extras are used when present, never required:** `app.lib.COLORMAPS` (movie exports
  follow the chosen colour map; gray otherwise), `app.lib.rgbComposite` (colour frames that carry
  `rgb` planes but no composed `rgba`), and `app.viewer.toDataURL({ scale: 2 })`. "Save this frame"
  is the viewer's own picture (overlays and caption included); when the viewer is missing or returns
  nothing the frame is drawn by the plugin at 768 px with date and wavelength in the corner.
- **Two-sided frames (`diverging`) are drawn linear** in exports whatever the stretch setting, as the
  shell does; other frames use `state.stretch` (default asinh).
- **Opening the dialog pauses playback** so that "this frame" is well defined, and resumes it on close
  if it was playing.
- **Copy link** is built in the plugin (plugins may import core modules only, and `shareUrl` lives in
  `state.js`): the page address with the URL-state keys taken from `app.store.get()`, contract defaults
  left out, and `t` = the current frame index. Without an http(s) address (sandboxed `srcdoc`) the
  button is disabled.
- **GIF:** one 128-colour palette for the whole movie, no dithering, every frame full-size (no
  inter-frame transparency), loop forever, delays rounded to centiseconds (2/s, 4/s, 8/s = 500, 250,
  130 ms). The default speed depends on the frame count (2/s up to 6 frames, 4/s up to 30, else 8/s).
- **WebM** records in real time through `MediaRecorder`, so it takes as long as the movie; movies
  shorter than about 3 s are repeated to reach it. A browser that can only record MP4 (Safari) gets an
  `.mp4` and the button says so. The file has no duration header (a MediaRecorder limitation).
- **CSV columns** are exactly `wave_um,flux_uJy,err_uJy,mjd,det,flagged`; every spectrum point with a
  wavelength is written (also those with `ok === false`, whose flux cells are then empty), `det` comes
  from the point or, failing that, from its wavelength, `flagged` is 1 or 0.
- **`gif.test.js`** finds Playwright through `import 'playwright'`, then `NODE_PATH`, then the global
  `node_modules` next to the Node binary, and skips its browser test if none is there. The page it
  opens is served from memory under a made-up https origin (no network), because `ImageDecoder`, used
  to check every frame, needs a secure context.

## s3-index (proxy/src/s3.js, rice.js, focalplane.js, expindex.js, s3cutout.js, proxy/fixtures/fakes3.js)

- **Detector shape constants (`DET_SHAPE` in focalplane.js).** The rigid-body matrices alone do not
  reproduce the real PC matrices: the outer detectors have a constant skew of about 2.2 degrees between
  their pixel axes and scales that differ by up to 0.5 %, which is more than 30 pixels at a detector
  edge. `detectorWcs(triad1, det, scaleDeg, shape = DET_SHAPE[det])` therefore applies three measured
  numbers per detector (`[kx, ka, kc]`: column 1 = S·kx·ux, column 2 = S·(ka·ux + kc·uy), S = 6.155
  arcsec). With them the table in CONTRACT-S3.md is reproduced to 1 arcsec in CRVAL and 2e-5 relative
  in PC (D6 of the DR1 exposure: 15 arcsec). The search hot loop uses the same constants.
- **The index is built from detector 1 only**, as designed, so an exposure with no detector-1 file is
  not indexed at all. `list.json` gained `partSize` (fixed when the list is first written, so a later
  step with another `maxExposures` cannot misalign parts) and `dets` (one bit mask per exposure of the
  detectors that have a file, from listing the six detector directories: 12 list requests per week
  directory instead of 2). The search never returns a frame whose file does not exist. The TBX1 JSON
  header carries the same `dets`. `{ detMasks: false }` skips the extra listings.
- **Extra cache objects and fields:** `<release>/<dir>/all.bin` (one TBX1 with the whole directory,
  written together with `meta.json`; a search reads one object per directory, and falls back to the
  parts if it is missing) and meta fields `partSize`, `bad` (number of NaN rows), `all`, `builtAt`.
  `dirs.json` is `{ fetchedAt, dirs }`.
- **Manifest maintenance:** `indexBuildStep` merges a finished directory's meta into `manifest.json`
  itself (`{ updateManifest: false }` turns that off), and `indexStatus` repairs a manifest that lost
  an update when two workers finished at once. `rebuildManifest` is still there and gives the same
  result. A manifest entry whose version is no longer the one in `dirs.json` is ignored by the search,
  and when a week exists in both a DR and a QR only the DR copy is used.
- **Coverage bitmap is slightly generous:** every one of the 5x5 lattice points of detectors 1 to 3
  also marks the cells 0.75 degrees around it, because lattice points 510 pixels apart can straddle a
  cell corner. A test checks 10,000 random footprint points against it.
- **Unreadable headers:** a file that answers but is not a Level-2 FITS file, or is missing, becomes a
  NaN row. Transient failures (5xx, timeouts) are retried once more at low concurrency; if more than
  max(3, 2 %) of a part still fail the step throws a retryable `UPSTREAM` error and stores nothing,
  so an S3 outage cannot be written into the index as permanent NaN rows.
- **Build defaults** follow the measurements from the deployed edge function: `maxExposures = 900`,
  `concurrency = 32`.
- **Extra exports:** `indexBuildNext(cache, { offset })` (one step for the next directory that is not
  in the manifest), `searchIndexMoving(cache, samples, opts)` (requested by the coordinator), `cellOf`,
  `coverageCells`. Search results also carry `counts: [{ det, total, returned }]` and `dirsFailed`.
  Thinning with `maxPerDet` keeps frames evenly spaced by rank in the time-ordered list of a detector,
  first and last included.
- **`readExposureHeader`** returns CRVAL moved to pixel (1020.5, 1020.5) if a header ever has another
  CRPIX, uses MJD-OBS + half the exposure time when MJD-AVG is absent, and reads a second range when
  the IMAGE header is longer than the first 28,800 bytes.
- **s3.js:** error class `S3Error` with `code` `NOT_FOUND | RANGE | UPSTREAM | BAD_ID`; `listKeys`
  returns `[{ key, size }]`; `listReleaseDirs({ known })` reuses known versions so a refresh costs one
  listing per release plus one per new directory; extra helpers `parseKey`, `makeKey`, `mapLimit`,
  `chooseReleases`, `releaseRank`. Keys with `..` are rejected.
- **rice.js:** the decoder also throws on a split code above 26 and on a tile that ends early (the
  reference reads `undefined` there). The encoder is a port of CFITSIO `fits_rcomp` and is checked
  byte for byte on hand-computed vectors and against `docs/rice-reference.js` on random data.
- **s3cutout.js, request plan.** Round 1 fetches bytes 0..28,799 and, in parallel, the FLAGS header and
  descriptor table at the offset every Level-2 file seen so far uses (16,675,200), so the careful path
  is 8 Range requests in 4 round trips. With `layoutMemo` (a Map keyed `"<version>/D<det>"` holding
  `{ headBytes, flagsOffset, flagsHeaderBytes, flagsTableBytes, varianceHeaderBytes, zodiHeaderBytes }`)
  every later cutout of that version and detector is 8 requests in 2 round trips. Each guess is checked
  against what the file says (XTENSION, EXTNAME, sizes) and anything that does not fit is fetched again
  the careful way; `stats.fallbacks` says which. Extra error code `BAD_ID`.
- **s3cutout.js, output headers.** IMAGE, VARIANCE and ZODI keep their original cards byte for byte
  except NAXIS1/NAXIS2, every `CRPIX1x`/`CRPIX2x` (shifted by the window origin, alternate WCS
  included) and CHECKSUM/DATASUM (dropped: they would be wrong for a cutout). FLAGS is written as a
  plain int32 IMAGE extension whose header is the rewritten IMAGE header's WCS and metadata plus the
  FLAGS-only cards (the MSKN names), without the table and compression keywords.
- **fakes3.js** exports more than an in-memory bucket: `makeFakeLevel2` (a lazily generated 60 MB file
  with the real layout and RICE-compressed FLAGS) and `makeFakeSurvey` (week directories of exposures
  with per-detector headers perturbed by a few arcsec and arcmin, missing exposures and detectors),
  plus fault injection and a count of round trips.
