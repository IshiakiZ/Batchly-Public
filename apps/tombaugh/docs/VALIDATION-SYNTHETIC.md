# Synthetic-sky validation

Written by `node tools/validate-synthetic.mjs` on 2026-11-15 08:29 UTC, Tombaugh 0.1.0. Do not edit by hand: run the script again.

This is a test of the software, not of the sky. The frames are synthetic (`proxy/fixtures/synth.js`): a field of ordinary stars, one star moving 10.40 arcsec a year, one star that doubles in brightness between passes, and a cold object with a deep 3.3 um band. Because the truth is known exactly, every measured number can be checked against what was put in. The same chain runs in the page on real SPHEREx data.

**Result: all 23 checks pass.**

Field: RA 150.1000, Dec +2.2000 deg, 6 arcmin, grid 118 x 118 pixels of 3.075 arcsec. Detector 3 carries the motion, brightness and noise checks (42 exposures in 3 passes); detector 4 adds the methane band. Run time 4.7 s.

## What ran

1. `proxy/src/handler.js` with the synthetic backend, called in-process: `/search`, `/cutout` (FITS written by the fixture, parsed by `fits.js`, wavelengths from `wavetab.js`, encoded by `encode.js`), `/gaia`.
2. `web/src/api.js` decodes each TBF1 frame; `web/src/loader.js` fetches every exposure and resamples it with `core/reproject.js` (TAN-SIP with the reference pixel off the cutout) onto the common grid.
3. `core/stack.js` stacks each survey pass; `core/skymodel.js` fits the static sky and finds residual peaks; `web/src/pipeline.js` merges them into the candidate list the page shows.
4. `web/src/plugins/validate/` measures: field-star offsets from Gaia and the null test (`core/astrometry.js`), the motion of the mover from its pass centroids, the brightness ratio of the variable from native aperture photometry (`core/photometry.js`), the band depth of the cold object, and the residual noise on blank sky.
5. The truth is read from the object list of `syntheticSky()` in the fixture. Start positions for the mover and the variable come from the candidate list, as a user would click them.

## Checks

| Check | Measured | Truth | Difference | Tolerance | Result |
|---|---|---|---|---|---|
| Exposures fetched, decoded and reprojected | 84 | 84 | 0 | all | pass |
| Field stars: median offset from Gaia | 0.009 arcsec | 0 | −0.009 E, +0.003 N | 0.31 arcsec (0.05 pixel) | pass |
| Field stars: scatter of offsets, per axis | 0.092 arcsec | 0 |  | 0.62 arcsec (0.10 pixel) | pass |
| Null test: mean motion of slow stars, east | 41 ± 53 mas/yr | 0 | +0.8 sigma | 3 sigma | pass |
| Null test: mean motion of slow stars, north | −3 ± 52 mas/yr | 0 | −0.1 sigma | 3 sigma | pass |
| Candidate list finds the mover | candidate 1 of 2, 3.5 arcsec away | at the true position | 1.15 grid pixel | 6.15 arcsec (1 pixel) | pass |
| Candidate list finds the variable | candidate 2 of 2, 0.1 arcsec away | at the true position | 0.03 grid pixel | 6.15 arcsec (1 pixel) | pass |
| Candidates that are neither the mover nor the variable | 0 of 2 | 0 | 0 | 0 | pass |
| Mover: proper motion, total | 10323 ± 134 mas/yr | 10401 mas/yr | −78 mas/yr (−0.6 sigma) | 3 sigma and 5 percent | pass |
| Mover: proper motion, east | −846 ± 134 mas/yr | −800 mas/yr | −46 mas/yr (−0.3 sigma) | 3 sigma | pass |
| Mover: proper motion, north | 10288 ± 134 mas/yr | 10370 mas/yr | −82 mas/yr (−0.6 sigma) | 3 sigma | pass |
| Mover: direction, east of north | 355.30 ± 0.74 deg | 355.59 deg | −0.29 deg | 3 deg | pass |
| Mover: largest distance from the true track | 0.077 arcsec | 0 | 0.013 pixel | 0.62 arcsec (0.10 pixel) | pass |
| Mover: matched to its catalogue entry | Gaia DR3 992046291631000 | the synthetic Gaia entry of the mover | catalogue 10401 mas/yr | within 1 mas/yr of the truth | pass |
| Variable: brightness, Jun 2025 to Dec 2025 | ×1.989 ± 0.031 | ×1.999 | −0.5 percent (−0.3 sigma) | 5 percent | pass |
| Variable: brightness, Jun 2025 to Jun 2026 | ×0.993 ± 0.017 | ×1.000 | −0.7 percent (−0.4 sigma) | 5 percent | pass |
| Variable: change detected | yes, 41.3 sigma | yes |  | over 5 sigma | pass |
| Variable: no motion | 52 ± 137 mas/yr | 7 mas/yr | 0.4 sigma from zero | under 3 sigma | pass |
| Mover: no brightness change | ×0.994 ± 0.014 | ×1.000 | 0.4 sigma | under 3 sigma | pass |
| Methane-like object: depth of the 3.15-3.45 um band | 0.784 ± 0.018 | 0.816 | −0.032 (−1.8 sigma) | 0.08 | pass |
| Mover: no methane band | −0.011 ± 0.005 | 0.000 | −2.1 sigma | 0.05 | pass |
| Blank sky: standard deviation of residual / sigma | 0.901 | 1 | −0.099 | 0.80 to 1.15 | pass |
| Blank sky: samples beyond 5 sigma | 0 of 448019 | 0.26 for Gaussian noise |  | at most 1 in 20 000 | pass |

Tolerances: a tenth of a SPHEREx pixel (0.62 arcsec) for measured positions, one pixel for where a candidate is listed, 3 sigma of the tool's own error for motions, 5 percent for the size of the motion and for the brightness ratio, 0.08 for a band depth, and 0.80 to 1.15 for the noise ratio (the sky model deliberately errs on the conservative side).

Notes:

- Exposures fetched, decoded and reprojected: Detectors 3 and 4, through the proxy handler, TBF1 decoding and the page's loader.
- Field stars: median offset from Gaia: 9 stars, 27 centroids.
- Field stars: scatter of offsets, per axis: Accuracy of one stacked centroid: WCS, resampling, stacking and centroiding together.
- Null test: mean motion of slow stars, east: 8 stars with a true motion under 50 mas/yr.
- Null test: mean motion of slow stars, north: One star's measured motion scatters by 100 mas/yr per axis.
- Candidate list finds the mover: Listed as "moved · 105.5σ" in Jun 2025, 6 residual peaks merged. The residual of a mover peaks ahead of or behind the star, not on it, so some offset is expected.
- Candidate list finds the variable: Listed as "varies · 19.9σ" in Dec 2025.
- Candidates that are neither the mover nor the variable: The steady stars and the methane-like object leave nothing in the candidate list.
- Mover: proper motion, total: Centroids in 3 pass stacks over 1.00 yr; the injected motion is 10.40 arcsec/yr.
- Mover: largest distance from the true track: Measured stack centroids against the injected positions at the pass dates.
- Mover: matched to its catalogue entry: Shows that propagating the 2016.0 catalogue position by 10 years lands on the star.
- Variable: brightness, Jun 2025 to Dec 2025: Detector 3, native aperture photometry against a smooth spectrum. Truth is the injected brightness averaged over the exposure dates of each pass.
- Variable: brightness, Jun 2025 to Jun 2026: Detector 3, native aperture photometry against a smooth spectrum. Truth is the injected brightness averaged over the exposure dates of each pass.
- Variable: no motion: A star that changes brightness must not be reported as moving.
- Mover: no brightness change: The aperture follows the star; a fixed aperture would lose light as it moves and fake a change.
- Methane-like object: depth of the 3.15-3.45 um band: 9 exposures in the band, 9 in the continuum windows, detector 4. Truth: the injected spectrum averaged over the same windows.
- Mover: no methane band: A star with a smooth spectrum must show no band.
- Blank sky: standard deviation of residual / sigma: 448019 pixel samples from 42 exposures, exact single-pixel variance. On the layers as displayed the value is 0.63 (see findings).
- Blank sky: samples beyond 5 sigma: Unflagged outliers would show up here.

## Candidates, as the page lists them

| # | Listed as | Pass | Nearest injected object | Distance |
|---|---|---|---|---|
| 1 | moved · 105.5σ | Jun 2025 | mover (mover) | 3.5 arcsec |
| 2 | varies · 19.9σ | Dec 2025 | variable (variable) | 0.1 arcsec |

## Full report, as the page would write it

### Report for the synthetic field

Generated 2026-11-15 08:29 UTC by Tombaugh 0.1.0. Data: synthetic SPHEREx-style frames from the Tombaugh test fixture, data releases dr1 (168 exposures), qr3 (84 exposures). Reference catalogue: Gaia DR3, epoch 2016.0.

These frames are synthetic test data made by Tombaugh, not observations.

Catalogue values here are those of the synthetic Gaia-like catalogue that the fixture serves.

### How to read this

Every number in the Measured column was computed by the tool from the images, on the spot. The next column is the independent value it should agree with: a catalogue, or what theory says for pure noise. Sigma is the difference divided by the measurement’s own 1-sigma error; values within about 2 are agreement, and anything over 3 is marked. The field-star rows are the controls. The offset from Gaia shows that frames, resampling and centroids line up, and the null test shows what the method reports for stars that do not move, which is the honest size of its error. SPHEREx pixels are 6.15 arcsec and a position is revisited about every six months, so only motions of a good fraction of an arcsecond per year can be seen. "Not measured" and "not detected" mean exactly that; nothing is filled in.

### Injected fast mover

RA 150.10020, Dec +2.19761 deg (ICRS); detector 3 (1.63–2.41 µm); 42 exposures in 3 passes: Jun 2025, Dec 2025, Jun 2026.

Reference: Gaia DR3 992046291631000: proper motion −800.0 east, +10370.0 north mas/yr, no parallax, position at epoch 2016.0. The catalogue column for motion is a straight line fitted through the catalogue track at the dates of the passes, parallax included, so it is what a perfect measurement on these dates would give.

| Quantity | Measured | Catalogue or expected | Difference | Sigma |
|---|---|---|---|---|
| **Motion** | | | | |
| Proper motion, total | 10323 ± 134 mas/yr | 10401 mas/yr | −78 mas/yr | −0.6 |
| Proper motion, east | −846 ± 134 mas/yr | −800 mas/yr | −46 mas/yr | −0.3 |
| Proper motion, north | 10288 ± 134 mas/yr | 10370 mas/yr | −82 mas/yr | −0.6 |
| Direction (east of north) | 355.30 ± 0.74 deg | 355.59 deg | −0.29 deg | −0.4 |
| Mean offset from the catalogue track | 0.04 arcsec | 0 | −0.04 E, +0.02 N arcsec |  |
| Moved since 2016.0 | 108.7 arcsec |  |  |  |
| **Brightness** | | | | |
| Largest change between passes | none detected; largest is ×0.994 ± 0.014 (0.4 sigma) |  | −0.6 % |  |
| D3, Jun 2025 → Dec 2025 | ×0.998 ± 0.014 (0.2 sigma) |  | −0.2 % |  |
| D3, Jun 2025 → Jun 2026 | ×0.994 ± 0.014 (0.4 sigma) |  | −0.6 % |  |
| D3, Dec 2025 → Jun 2026 | ×0.996 ± 0.014 (0.3 sigma) |  | −0.4 % |  |
| D4, Jun 2025 → Dec 2025 | ×1.006 ± 0.015 (0.4 sigma) |  | +0.6 % |  |
| D4, Dec 2025 → Jun 2026 | ×0.999 ± 0.015 (0.1 sigma) |  | −0.1 % |  |
| **Spectrum** | | | | |
| Exposures with clean photometry | 79 of 84 |  |  |  |
| Wavelength coverage | 1.65–3.81 µm |  |  |  |
| Median signal-to-noise per exposure | 128 |  |  |  |
| Depth of the 3.15–3.45 µm methane band | −0.0106 ± 0.0049 | 0 for a smooth spectrum |  |  |
| **Data** | | | | |
| Survey passes | 3: Jun 2025 (14), Dec 2025 (14), Jun 2026 (14) |  |  |  |
| Exposures used, detector 3 | 42 |  |  |  |
| Flagged pixels in the aperture | 0.82 % |  |  |  |
| Data releases | dr1 (56), qr3 (28) |  |  |  |
| **Noise** | | | | |
| Residual / sigma on blank sky, standard deviation | 0.90 | 1 | −0.10 |  |
| Samples beyond 5 sigma | 0 of 448 019 | about 0.26 expected |  |  |
| The same on the layers as displayed | 0.63 | about 0.6 |  |  |

- Proper motion, total: Motion detected at 77.3 sigma.
- Mean offset from the catalogue track: 0.007 SPHEREx pixel, averaged over the passes.
- Moved since 2016.0: 17.7 SPHEREx pixels from the catalogue position at that epoch.
- Largest change between passes: Below the 3 sigma needed to call it a change. Method: native aperture photometry against a smooth spectrum. Errors include a 1 percent repeatability floor per pass.
- Exposures with clean photometry: 5 left out because a flagged pixel lies in the aperture.
- Wavelength coverage: Detectors 3, 4.
- Median signal-to-noise per exposure: 79 of 79 exposures detect the target above 3 sigma.
- Depth of the 3.15–3.45 µm methane band: No absorption detected (−2.1 sigma).
- Survey passes: 2025-06-13, 2025-12-13, 2026-06-13
- Exposures used, detector 3: Loaded in all: D3 42, D4 42.
- Flagged pixels in the aperture: 3 of 42 exposures have a flagged pixel within 9.8 arcsec of the target.
- Data releases: Synthetic test frames, not observations.
- Residual / sigma on blank sky, standard deviation: The noise model matches the residuals on blank sky. 448 019 pixel samples from 42 exposures, exact single-pixel variance.
- The same on the layers as displayed: Resampling averages neighbouring pixels while the quoted variance is kept, so the residual view understates significance by this factor.

#### Field stars around Injected fast mover

| Quantity | Measured | Catalogue or expected | Difference | Sigma |
|---|---|---|---|---|
| **Field stars** | | | | |
| Reference stars used | 9 of 27 Gaia stars |  |  |  |
| Median offset from Gaia | 0.01 arcsec | 0 | −0.01 E, 0.00 N arcsec | +0.4 |
| Scatter of the offsets, per axis | 0.09 arcsec | under 1.54 arcsec |  |  |
| Null test: mean motion of 8 slow stars, east | 41 ± 53 mas/yr | 0 | +41 mas/yr | +0.8 |
| Null test: mean motion of 8 slow stars, north | −3 ± 52 mas/yr | 0 | −3 mas/yr | −0.1 |
| Scatter of one star’s measured motion, per axis | 100 mas/yr |  |  |  |

Alignment: Aligned. 9 field stars sit a median 0.01 arcsec (0.00 SPHEREx pixel) from where Gaia predicts, with a scatter of 0.09 arcsec per axis.

Null test: No motion, as expected. 8 stars that Gaia says move under 50 mas/yr have a mean measured motion of 41 mas/yr east and −3 mas/yr north, within 0.8 sigma of zero. One star scatters by 100 mas/yr per axis, so a single object must move faster than about 300 mas/yr to be called moving here.

- Reference stars used: Left out: 18 off the field or near its edge.
- Median offset from Gaia: 0.002 SPHEREx pixel, from 27 centroids. Sigma is against the standard error of the median, 0.022 arcsec.
- Scatter of the offsets, per axis: 0.015 SPHEREx pixel: the accuracy of one stacked centroid in this field (WCS, resampling, stacking and centroiding together).
- Scatter of one star’s measured motion, per axis: The empirical error of a proper motion here. A single object must move faster than about 300 mas/yr to be called moving. Chi-square per degree of freedom against the formal errors: 0.64.

### Injected variable

RA 150.11139, Dec +2.20752 deg (ICRS); detector 3 (1.63–2.41 µm); 42 exposures in 3 passes: Jun 2025, Dec 2025, Jun 2026.

Reference: Gaia DR3 990124174608001: proper motion +4.0 east, −6.0 north mas/yr, no parallax, position at epoch 2016.0. The catalogue column for motion is a straight line fitted through the catalogue track at the dates of the passes, parallax included, so it is what a perfect measurement on these dates would give.

| Quantity | Measured | Catalogue or expected | Difference | Sigma |
|---|---|---|---|---|
| **Motion** | | | | |
| Proper motion, total | 52 ± 137 mas/yr | 7 mas/yr | +45 mas/yr | +0.3 |
| Proper motion, east | −31 ± 137 mas/yr | 4 mas/yr | −35 mas/yr | −0.3 |
| Proper motion, north | 42 ± 137 mas/yr | −6 mas/yr | +48 mas/yr | +0.3 |
| Direction (east of north) | undefined without a detected motion |  |  |  |
| Mean offset from the catalogue track | 0.07 arcsec | 0 | +0.02 E, −0.07 N arcsec |  |
| **Brightness** | | | | |
| Largest change between passes | ×1.989 ± 0.031 (41.3 sigma), Jun 2025 → Dec 2025, D3 |  | +99 % |  |
| D3, Jun 2025 → Dec 2025 | ×1.989 ± 0.031 (41.3 sigma) |  | +99 % |  |
| D3, Dec 2025 → Jun 2026 | ×0.499 ± 0.008 (40.5 sigma) |  | −50 % |  |
| D4, Jun 2025 → Dec 2025 | ×2.001 ± 0.038 (36.5 sigma) |  | +100 % |  |
| D4, Dec 2025 → Jun 2026 | ×0.495 ± 0.009 (37.7 sigma) |  | −50 % |  |
| **Spectrum** | | | | |
| Exposures with clean photometry | 80 of 84 |  |  |  |
| Wavelength coverage | 1.65–3.82 µm |  |  |  |
| Median signal-to-noise per exposure | 45 |  |  |  |
| Depth of the 3.15–3.45 µm methane band | 0.011 ± 0.014 | 0 for a smooth spectrum |  |  |
| **Data** | | | | |
| Survey passes | 3: Jun 2025 (14), Dec 2025 (14), Jun 2026 (14) |  |  |  |
| Exposures used, detector 3 | 42 |  |  |  |
| Flagged pixels in the aperture | 0.07 % |  |  |  |
| Data releases | dr1 (56), qr3 (28) |  |  |  |
| **Noise** | | | | |
| Residual / sigma on blank sky, standard deviation | 0.90 | 1 | −0.10 |  |
| Samples beyond 5 sigma | 0 of 448 019 | about 0.26 expected |  |  |
| The same on the layers as displayed | 0.63 | about 0.6 |  |  |

- Proper motion, total: No motion detected: 0.4 sigma, below the 3 sigma needed. The value is an upper bound on what could hide here.
- Mean offset from the catalogue track: 0.012 SPHEREx pixel, averaged over the passes.
- Largest change between passes: Brightness relative to the smooth spectrum, later pass over earlier pass. Method: native aperture photometry against a smooth spectrum. Errors include a 1 percent repeatability floor per pass.
- Exposures with clean photometry: 4 left out because a flagged pixel lies in the aperture.
- Wavelength coverage: Detectors 3, 4.
- Median signal-to-noise per exposure: 80 of 80 exposures detect the target above 3 sigma.
- Depth of the 3.15–3.45 µm methane band: No absorption detected (0.8 sigma).
- Survey passes: 2025-06-13, 2025-12-13, 2026-06-13
- Exposures used, detector 3: Loaded in all: D3 42, D4 42.
- Flagged pixels in the aperture: 1 of 42 exposures have a flagged pixel within 9.8 arcsec of the target.
- Data releases: Synthetic test frames, not observations.
- Residual / sigma on blank sky, standard deviation: The noise model matches the residuals on blank sky. 448 019 pixel samples from 42 exposures, exact single-pixel variance.
- The same on the layers as displayed: Resampling averages neighbouring pixels while the quoted variance is kept, so the residual view understates significance by this factor.

### Injected methane-like object

RA 150.09001, Dec +2.19136 deg (ICRS); detector 3 (1.63–2.41 µm); 42 exposures in 3 passes: Jun 2025, Dec 2025, Jun 2026.

No catalogue motion is known for this position, so measured values stand alone.

| Quantity | Measured | Catalogue or expected | Difference | Sigma |
|---|---|---|---|---|
| **Motion** | | | | |
| Proper motion, total | 499 ± 463 mas/yr |  |  |  |
| Proper motion, east | −84 ± 463 mas/yr |  |  |  |
| Proper motion, north | −492 ± 463 mas/yr |  |  |  |
| Direction (east of north) | undefined without a detected motion |  |  |  |
| **Brightness** | | | | |
| Largest change between passes | none detected; largest is ×0.895 ± 0.107 (0.9 sigma) |  | −10 % |  |
| D3, Jun 2025 → Dec 2025 | ×0.895 ± 0.107 (0.9 sigma) |  | −10 % |  |
| D3, Dec 2025 → Jun 2026 | ×1.045 ± 0.123 (0.4 sigma) |  | +4.5 % |  |
| D4, Jun 2025 → Dec 2025 | ×1.012 ± 0.176 (0.1 sigma) |  | +1.2 % |  |
| D4, Dec 2025 → Jun 2026 | ×0.980 ± 0.168 (0.1 sigma) |  | −2.0 % |  |
| **Spectrum** | | | | |
| Exposures with clean photometry | 80 of 84 |  |  |  |
| Wavelength coverage | 1.64–3.82 µm |  |  |  |
| Median signal-to-noise per exposure | 5.5 |  |  |  |
| Depth of the 3.15–3.45 µm methane band | 0.784 ± 0.018 | 0 for a smooth spectrum |  |  |
| **Data** | | | | |
| Survey passes | 3: Jun 2025 (14), Dec 2025 (14), Jun 2026 (14) |  |  |  |
| Exposures used, detector 3 | 42 |  |  |  |
| Flagged pixels in the aperture | 0.08 % |  |  |  |
| Data releases | dr1 (56), qr3 (28) |  |  |  |
| **Noise** | | | | |
| Residuals on blank sky | not measured |  |  |  |

- Proper motion, total: No motion detected: 1.1 sigma, below the 3 sigma needed. The value is an upper bound on what could hide here.
- Largest change between passes: Below the 3 sigma needed to call it a change. Method: native aperture photometry against a smooth spectrum. Errors include a 1 percent repeatability floor per pass.
- Exposures with clean photometry: 4 left out because a flagged pixel lies in the aperture.
- Wavelength coverage: Detectors 3, 4.
- Median signal-to-noise per exposure: 63 of 80 exposures detect the target above 3 sigma.
- Depth of the 3.15–3.45 µm methane band: Absorption detected at 44.6 sigma: the band is 78 % darker than the continuum beside it.
- Survey passes: 2025-06-13, 2025-12-13, 2026-06-13
- Exposures used, detector 3: Loaded in all: D3 42, D4 42.
- Flagged pixels in the aperture: 1 of 42 exposures have a flagged pixel within 9.8 arcsec of the target.
- Data releases: Synthetic test frames, not observations.
- Residuals on blank sky: Not measured
