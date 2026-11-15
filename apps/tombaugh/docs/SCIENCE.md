# Tombaugh: the method

Written for a reader who knows astronomy and wants to know what the tool computes, what it assumes
and where it fails.

**How to read this document.** It describes what the code does, as specified in
[CONTRACT.md](../CONTRACT.md), and how the result will be checked. The tool has not yet been run
end to end on real SPHEREx data, so no measured result appears here. Numbers that must come from a
real run are placeholders of the form `[RESULT: ...]`. Catalogue values and mission facts that were
written from memory without network access are marked `(verify)`. Facts about the file format were
measured on real files on 2026-11-14 and are recorded in the contract.

Contents:
[1 Data](#1-the-data) ·
[2 Common grid](#2-from-frames-to-a-common-grid) ·
[3 Passes and stacks](#3-passes-stacks-and-the-matched-view) ·
[4 Predicted-sky subtraction](#4-predicted-sky-subtraction) ·
[5 What change looks like](#5-what-change-looks-like) ·
[6 Photometry](#6-photometry-spectra-and-light-curves) ·
[7 Proper motion](#7-proper-motion-and-the-comparison-with-gaia) ·
[8 Distance dial](#8-the-distance-dial) ·
[9 Molecule lenses](#9-molecule-lenses) ·
[10 Validation](#10-validation) ·
[11 Limits](#limits-and-failure-modes)

## 1. The data

**Instrument.** SPHEREx images the sky onto six 2040 x 2040 detectors with 6.15 arcsecond pixels.
A linear variable filter (LVF) sits above each detector, so the wavelength reaching a pixel is a
function of its position on the detector, mostly of its row. There is no filter wheel and no
dispersing element. The spacecraft steps across the sky, and a given sky position lands on a
different row, and therefore a different wavelength, in each exposure. The spectrum of a position
is assembled from many exposures.

| Detector | Wavelength (um) | Channels |
|---|---|---|
| D1 | 0.75 - 1.09 | 17 |
| D2 | 1.10 - 1.62 | 17 |
| D3 | 1.63 - 2.41 | 17 |
| D4 | 2.42 - 3.82 | 17 |
| D5 | 3.83 - 4.41 | 17 |
| D6 | 4.42 - 5.00 | 17 |

Six detectors of 17 channels give the 102 bands. A channel is a range of wavelength, not a fixed
set of pixels, and within a detector the channels are evenly spaced in ln(wavelength) to a good
approximation (constant resolving power per detector).

**Files.** Tombaugh uses Level 2 spectral images from IRSA: one calibrated exposure of one
detector, in MJy/sr, with these layers.

| Layer | Use in Tombaugh |
|---|---|
| IMAGE (float32, MJy/sr) | The data |
| FLAGS (int32 bit mask) | Masking, and the flag overlay |
| VARIANCE (MJy2/sr2) | Weights and the noise model |
| ZODI (MJy/sr) | Model of the zodiacal light, subtracted on request (default on) |
| WCS-WAVE (lookup table) | Wavelength and bandwidth of every pixel |
| EPSF | Not used |

Astrometry is a TAN projection with SIP distortion (third order in the files examined). Because
the files are cutouts of a full detector, the reference pixel lies far outside the array and the
SIP polynomial is evaluated at arguments of hundreds of pixels, with non-zero zeroth- and
first-order terms. All terms are honoured.

**Wavelength of a pixel.** The alternate WCS `W` (`WAVE-TAB`, the FITS `-TAB` convention) maps a
cutout pixel to a full-detector pixel; the WCS-WAVE table gives wavelength and bandwidth on an
11 x 11 grid of control points across the detector, interpolated bilinearly. On detector 2 the
wavelength runs from about 1.667 um at row 1 to 1.095 um at row 2040, with a slight curvature
along a row. The table was found to be identical, byte for byte, in a 2025 and a 2026 file of the
same detector. The proxy evaluates it once and sends each frame with a wavelength for every pixel.

**Passes.** The all-sky survey returns to a position about every six months. Data begin in May
2025, so most of the sky has about three passes. At one measured position there were roughly 84
exposures per detector in total. Each exposure is about 113.6 s (`XPOSURE` in the measured file).

**Units.** Surface brightness in MJy/sr. One MJy/sr over one 6.15 arcsecond pixel is 889 microJy.
Times are MJD (UTC), from `MJD-AVG`. Coordinates are ICRS.

## 2. From frames to a common grid

Every exposure has its own orientation and distortion. Before anything is compared, each frame is
resampled onto one grid per session:

- **Grid.** North up, tangent plane about the requested centre, 3.075 arcsec per pixel (half a
  SPHEREx pixel), wide enough for the chosen field of view.
- **Mapping.** For each grid pixel centre: tangent-plane offset to sky, sky to frame pixel through
  the inverse SIP polynomial, then bilinear interpolation of image, variance and wavelength over
  the good pixels among the four neighbours, with the weights renormalised. Surface brightness is
  an intensive quantity, so no flux scaling is needed.
- **Mask.** A grid pixel is unusable if it falls off the frame or if its nearest detector pixel
  is non-finite or carries any of the default bad bits: TRANSIENT, OVERFLOW, SUR_ERROR, NONFUNC, MISSING_DATA, HOT,
  COLD, NONLINEAR, PERSIST, OUTLIER, STREAK, BLOOM, SNOWBALL (bits 0, 1, 2, 6, 9, 10, 11, 15, 17,
  19, 25, 26, 27). The SOURCE bit (21) marks a pixel mapped to a known source and is not a defect.
- **Zodiacal light.** The ZODI layer is subtracted before resampling unless the user turns it off.
  The zodiacal foreground changes between passes because the line of sight through the
  interplanetary dust changes, so leaving it in adds a pass-to-pass offset that is not
  astrophysical change in the target field.

The result is a **layer**: image, variance, per-pixel wavelength and mask on the common grid, with
the time and detector of the exposure.

Three consequences of the resampling matter later. The grid oversamples the detector by two, so
neighbouring grid pixels are correlated. Bilinear interpolation smooths, by an amount that depends
on where the grid pixel falls relative to the detector pixels. And the variance is interpolated
with the same weights as the image, which never understates the noise of a single grid pixel but
does not describe the correlation between neighbours. For that reason photometry is done on the
native frames, not on the grid.

## 3. Passes, stacks and the matched view

**Passes.** Layers are sorted in time and split wherever the gap exceeds 45 days.

**Per-pass stacks** (`view=passes`, the default). Each layer first has its own robust sky level
removed (a clipped median), because zodi-subtracted frames still carry small offsets. All layers
of one detector in one pass are then combined, by default with an inverse-variance weighted mean
with 3-sigma clipping; median and sum are available. The clipping is done about the per-pixel
median with a scale that adds, to each sample's pipeline variance, the excess scatter measured
from the median absolute deviation. In SPHEREx data a real source scatters more than its noise
from exposure to exposure because the wavelength changes; the excess term keeps that from being
clipped as if it were a defect.

The stack is in effect a broadband image through that detector's whole wavelength range, about 28
exposures deep if the 84 are shared evenly among three passes. Blinking the stacks is the nearest
thing to a classical blink comparator that these data allow. The stacks are not identical in
effective wavelength from pass to pass, because each pass samples the detector's range at
different wavelengths, so a very red or very blue source can differ slightly between stacks
without having changed.

**Matched view** (`view=matched`). For a chosen channel, the tool keeps only the layers in which
the target was seen in that channel and shows one image per pass. This is a like-for-like blink at
nearly one wavelength. It uses few exposures, so it is noisier, and the match is exact only at the
centre: across a 4 arcminute field (39 detector rows of 2040) the wavelength drifts by about a
third of a channel, and across 10 arcminutes by about 0.8 of a channel.

**Exposures** (`view=exposures`). Every exposure in time order, with its date and wavelength in the
caption. This is the naive blink movie. It is kept because it shows the problem plainly.

**Add and subtract** (`view=diff`). Any two pass stacks, added or subtracted pixel by pixel.

## 4. Predicted-sky subtraction

The question is whether a frame differs from what the unchanging sky would have produced. The
difficulty is that no two frames of a position share a wavelength, so there is no reference image
to subtract. Tombaugh builds one from the spectrum.

**Model.** For each grid pixel `p` and one detector, the surface brightness is modelled as a
low-order polynomial in ln(wavelength):

```
S_p(lambda) = sum_{k=0..K} c_{p,k} * (ln lambda - ln lambda_0)^k        K = 2 by default
```

where `lambda_0` is a reference wavelength in the detector's range. The fit uses every layer of
that detector, from all passes together: about 84 points for 3 coefficients.

**Why ln(wavelength), and why one detector.** Channels are evenly spaced in ln(wavelength), so the
samples are evenly spread in the fit variable. One detector spans a factor of about 1.1 to 1.6 in
wavelength, over which stellar and galaxy continua are smooth enough for a quadratic. Across
detector boundaries the PSF, the calibration and the noise all change, so the model does not try
to bridge them.

**Fit.** Weighted least squares with weights `1 / variance` from the resampled VARIANCE layer,
using each layer's own wavelength at that pixel. Masked samples are never used. The order adapts
to the data at each pixel: quadratic with at least 8 samples spanning a third of the detector's
range, linear with at least 4, a constant with at least 2, no model otherwise. A small ridge term
on slope and curvature keeps poorly conditioned pixels stable without biasing the level.

A plain least-squares fit would be pulled toward the very objects the tool is looking for, which
dilutes their signal and leaves a negative imprint in the other passes. So the fit is made robust
at two levels, over 3 iterations with weights recomputed from scratch each time:

1. **Per sample.** Normalised residuals are compared with their median, on a scale of the larger
   of 1 and 1.4826 times their median absolute deviation. Samples get Huber weights (full weight
   within 1.345 scale units, falling beyond) and are cut entirely beyond 3.5. This removes cosmic
   rays, satellite trails and anything bright enough to stand out in one exposure. A pixel that
   scatters more than its noise, such as an undersampled star core, gets a proportionally wider
   tolerance.
2. **Per pass.** With at least three passes, the mean residual of each pass at a pixel is
   compared with the median of the pass means, and a pass that disagrees is down-weighted or
   dropped at that pixel. This catches a mover or a variable that is too faint to be an outlier
   in any single exposure but is significant in the average of a pass. The static model is then,
   in effect, the sky as the majority of passes saw it.

The model stores, for every pixel, the coefficients, the rms of the samples used (`rms`), their
number (`nUsed`), and two noise floors described below.

**Prediction and residual.** For a layer `i`, the predicted image is the model evaluated, pixel by
pixel, at the wavelength that pixel had in that exposure:

```
P_i(p) = S_p(lambda_i(p))
R_i(p) = I_i(p) - P_i(p)
snr_i(p) = R_i(p) / sigma_i(p)
```

with

```
sigma_i(p)^2 = variance_i(p) + floor(p)
floor(p)     = excess scatter of the pixel about its model + variance of the model itself
```

The residual movie (`view=residual`) shows one residual image per pass: the residuals of the
pass's exposures combined with a clipped inverse-variance mean, on a diverging colour scale so
that positive and negative are told apart at a glance. Its significance is

```
snr_pass(p) = mean residual / sqrt(variance of the mean + stack floor(p))
```

The floor is added once and does not shrink with the number of exposures, because the model's
error and a pixel's unexplained scatter are common to the whole pass. For a pass that took part
in the fit this is conservative. For a pass the fit rejected at that pixel, which is the case of
interest, it is the right significance.

**What cancels.** Any source whose position and spectrum are constant, and whose spectrum is
smooth across the detector, to the accuracy of the fit. Diffuse emission cancels the same way. The
zodiacal model and a robust per-layer background level deal with foreground that changes between
exposures.

**What does not cancel**, and is not change, is listed under
[Limits and failure modes](#limits-and-failure-modes). The short version: sharp spectral features,
undersampled bright stars, and PSF variation with wavelength.

**Noise in the residual.** Three things to keep in mind when reading `snr`:

1. Resampling correlates neighbouring grid pixels, so a 2 x 2 block of high `snr` is closer to one
   independent detection than to four. The candidate finder requires a peak to have neighbours of
   the same sign for this reason, and does not count pixels.
2. The model was fitted to the same data it is subtracted from. With about 84 points and 3
   parameters the loss of variance is a few percent, and the floor includes the model's own
   variance. A pixel with few usable points has a lower-order model or none.
3. The pipeline variance describes read noise and photon noise. It does not describe sub-pixel
   sampling effects, which dominate for bright stars. That is what the excess-scatter term in the
   floor is for: a bright star core that jitters from exposure to exposure is given a
   correspondingly large sigma, so it does not look like a discovery. The price is reduced
   sensitivity to real change on top of bright stars.

## 5. What change looks like

**A mover that shifts by less than the PSF between passes** (Barnard's Star: about 5.2 arcsec per
pass against a PSF of about 7.5 arcsec FWHM (verify units of `PSF_FWHM`) and 6.15 arcsec pixels).
The model describes a source at an intermediate position, close to where the star was in the
middle pass. In an early pass the star is behind that position and in a late pass it is ahead.
The residual is therefore a **dipole**: positive on the side the star is on, negative on the
other, with the sign pattern reversing from the first pass to the last. The axis of the dipole is
the direction of motion.

**A mover that shifts by more than the PSF.** The source is at any one position in only one pass,
the fit rejects that pass there, and the model at that position is just the background. The
residual shows a positive source that appears at a new position each pass.

**A variable.** The model describes the brightness the majority of passes agree on. The residual
is a single-signed **pulse** at a fixed position: positive in passes where the star is brighter,
negative where it is fainter, with no spatial sign change.

**A transient or a moving solar-system body within one pass** appears in one or a few consecutive
exposures only. The clipped per-pass residual removes it, as it removes cosmic rays; it shows in
the residuals of single exposures.

**The change map.** For each pixel, the squared pass significances are summed into a chi-square
and converted to an equivalent Gaussian sigma: the significance that the pass residuals are not
all zero. About 5 and above is worth a look.

**Candidates.** A peak is a pixel whose pass `snr` reaches 5 in absolute value, is the extreme of
its 3 x 3 neighbourhood, and has at least two neighbours of the same sign above half the
threshold. Peaks are then labelled by a deliberately simple rule. Something that moved leaves
displaced blobs: a positive one where it is in this pass, and either a negative one beside it in
the same pass or blobs at a neighbouring position in other passes. So a peak with another peak
between 1.5 and 4 grid pixels away (4.6 to 12.3 arcsec) is labelled **moved**, unless that
neighbour is in the same pass with the same sign. Every other peak is labelled **varies**: a
variable, a transient, or a mover too fast to pair up within that radius. The interface lists up
to 20 candidates, strongest first, each with a position that can be clicked. A candidate is a
place to look, not a detection: see the failure modes.

**Gaia rings.** With `gaia=1` the viewer draws a ring for each Gaia DR3 source in the field. A
star with a large proper motion is no longer where the catalogue epoch (2016.0) put it and sits
outside its ring. Barnard's Star has moved about 100 arcseconds, 16 pixels, since 2016.0. The
rings also show at a glance whether the frame astrometry and the resampling are right: ordinary
field stars should sit centred in theirs.

## 6. Photometry, spectra and light curves

**Aperture photometry** is done on the native frames, not on the resampled grid, so the
interpolation does not enter. For each frame the position is converted to pixel coordinates and
the flux is summed in a circular aperture of radius 1.6 pixels (9.8 arcsec), with the background
taken from an annulus of 3.5 to 6 pixels (21.5 to 36.9 arcsec). Surface brightness is converted at
889 microJy per MJy/sr per pixel. Each measurement carries the wavelength and bandwidth of the
pixel at the source position, the time, an error from the VARIANCE layer and a `flagged` mark if
bad pixels fall in the aperture.

**Spectrum.** One point per frame, sorted by wavelength, across all detectors that were loaded;
optionally binned to one point per channel. The plot shades the detector ranges and can export
CSV.

**Light curve.** Each exposure is at a different wavelength, so raw fluxes cannot be compared in
time. The light curve divides each flux by a smooth spectrum fitted to all points of the source
and plots the ratio against time. For a constant source with a smooth spectrum the ratio is 1
within errors at all times.

**Caveats.** No aperture correction is applied (verify), and the PSF grows with wavelength, so
absolute fluxes are low by a wavelength-dependent factor. The annulus is contaminated in crowded
fields. For a source whose spectrum changes shape as it varies, as a Mira variable's does, the
ratio mixes brightness change with spectral change.

## 7. Proper motion and the comparison with Gaia

This is the tool's quantitative check on itself, and it runs in the browser for any star the user
clicks.

1. **Centroid.** In each pass stack (or each layer), an iterated Gaussian-windowed first moment
   about a local median background gives a sub-pixel position (the windowed centroid of Bertin &
   Arnouts 1996), in a window of half-width 5 grid pixels. It is converted to RA and Dec. The
   error per axis combines in quadrature the noise-limited estimate, 0.6 FWHM / SNR, and a floor
   of 0.05 grid pixels for undersampling and resampling.
2. **Fit.** A weighted straight-line fit in the tangent plane gives `pmra` (including cos Dec),
   `pmdec`, the total motion, its position angle and errors, in mas/yr. Formal errors are
   inflated when the scatter about the line is larger than the weights imply. With three or more
   passes a second fit also solves for parallax, when the geometry allows it.
3. **Compare.** The nearest Gaia DR3 source is moved from epoch 2016.0 to each observation date
   with the standard model of uniform space motion, applied as a vector so that it is exact for a
   10 arcsec/yr star over a decade, plus the parallax for Earth's position on that date. That is
   the expected track. The motion meter shows the measured vector beside Gaia's.

**What to expect, before measuring.** With centroids good to a fraction of a 6.15 arcsec pixel
and a time span of about one year, the error on a proper motion is of order an arcsecond per
year. Barnard's Star at 10.4 arcsec/yr should be recovered clearly, with a large fractional error;
stars moving less than about an arcsecond per year should be consistent with zero. The measured
errors replace this estimate in the table below.

**Parallax and few epochs.** SPHEREx observes near 90 degrees from the Sun (verify), which is where
the parallactic displacement is greatest, and consecutive passes see it with opposite sign.
Barnard's Star has a parallax of 0.547 arcsec, so its position swings by about 1.1 arcsec between
passes on top of 5.2 arcsec of proper motion. With two passes, a straight-line fit absorbs that
swing into the proper motion, an error of up to about 2 arcsec/yr for this star. With three evenly
spaced passes the alternating pattern largely cancels in the slope. The comparison against the
Gaia track that includes parallax is the fairer test, and both numbers are reported.

**The null test.** Field stars with Gaia proper motions below 50 mas/yr should show no motion.
The scatter of their measured motions is the empirical error of the method in that field, and it
is a more honest error bar than the formal one.

## 8. The distance dial

**Geometry.** Take a body at heliocentric distance `d` in the direction `n` as seen from the Sun.
From Earth, at heliocentric position `E(t)`, it appears in the direction of `d*n - E(t)`. For
`d` much greater than 1 AU the apparent displacement from `n` is

```
theta(t) = - E_perp(t) / d      (radians; E_perp is the part of E perpendicular to n)
```

Two observations from opposite sides of Earth's orbit are separated by a baseline of up to 2 AU.

**Worked number.** For `d` = 500 AU and a 2 AU baseline:

```
2 AU / 500 AU = 0.004 rad = 825 arcsec = 13.75 arcmin = 134 SPHEREx pixels
```

Background stars do not move by a measurable amount. A body at 500 AU is in a completely different
place six months later, for a reason that has nothing to do with its own orbit.

**What the dial does.** The user chooses `d`. For each frame time the tool computes Earth's
position from an analytic ephemeris (a truncated VSOP87 series; required to be good to 1e-4 AU,
which is 0.04 arcsec at 500 AU, and tested to be better), derives the parallactic offset for that distance, shifts each layer by minus that offset
and stacks. A body at the chosen distance lands on the same grid pixels in every frame and adds
up. Stars are smeared along the parallax track and average down. Turning the dial sweeps the
focus through distance, as a focus knob sweeps through depth.

**Depth of focus.** The shift between passes changes by one pixel when the distance changes by a
fraction `theta_pixel * d / (2 AU)`. At 500 AU that is 0.75 percent, or 3.7 AU. The dial therefore
steps finely, and a blind search has to scan many distances.

**The body's own motion.** A body on a circular orbit at 500 AU moves about 116 arcsec per year,
58 arcsec between passes, in a direction that is not known in advance. That is 7 percent of the
parallactic shift but more than nine pixels. `predictedTrack` accepts an optional motion vector;
a blind search would have to scan it, which makes the search three-dimensional. The tool does not
run that search automatically.

**Field of view.** At 500 AU the shift between passes (13.75 arcmin) is larger than the largest
field (10 arcmin). Frames from different passes overlap within one loaded patch only for distances
beyond about 700 AU at 10 arcmin. For nearer bodies the frames have to be taken along the
predicted track, not at a fixed position.

**How it is demonstrated.** A real Planet X would probably be far too faint for SPHEREx (see
limits). The dial is shown working on a known solar-system body, or on a synthetic source injected
into real frames along the track for a chosen distance, which is then recovered by turning the
dial to that distance and lost on either side. `[RESULT: body or injected source used, its
distance, the dial setting at which the stack peaks, and the peak signal-to-noise against the
unshifted stack]`

## 9. Molecule lenses

A lens colours the field by the depth of an absorption band:

```
depth = 1 - (brightness in the band) / (brightness in the continuum windows)
```

computed from stacks of the layers whose wavelengths fall in the band and in the continuum
windows.

| Lens | Band (um) | Detector | What it traces |
|---|---|---|---|
| `methane` | 3.3, against continuum near 4.5 | D4, D6 | CH4 fundamental. Deep in T and Y dwarfs, which are faint at 3.3 um and bright near 4.5 um. The same contrast as the WISE W1 - W2 colour used to find cold brown dwarfs |
| `water` | 3.05 | D4 | H2O ice (O-H stretch) toward stars behind dense clouds; water vapour in cool atmospheres |
| `co2` | 4.27 | D5 | CO2 ice |
| `co` | 4.67 | D6 | CO, ice and gas |
| `rgb` | three detectors | three | A three-colour composite, not an absorption depth |

The exact band and continuum windows are in `web/src/core/lenses.js`.

A depth is meaningful only where there is a source: on empty sky it is a ratio of two noise
values. For the methane lens the band and the continuum are on different detectors, so the two
stacks have different PSFs, and compact sources show ring-shaped artefacts at their edges.

## 10. Validation

### Completed checks

These were done on real files or are enforced by unit tests that run without network access
(`node --test`).

| Check | Status |
|---|---|
| File layout of a Level 2 cutout (HDU order, types, offsets, header keys) | Measured on real IRSA files, 2026-11-14 (see CONTRACT.md) |
| WCS-WAVE table identical across files of one detector | Verified byte for byte on a 2025 and a 2026 file |
| TAN-SIP forward transform against a real header | Unit test: FITS pixel (30, 30) of a real cutout header must map to RA 210.8023, Dec 54.3490 within 0.003 deg. This tolerance is loose (10.8 arcsec); the tight test is the Gaia ring alignment below |
| Pixel solid angle: 1 MJy/sr over a 6.15 arcsec pixel = 889 microJy | Arithmetic, checked |
| Parallax worked number: 2 AU at 500 AU = 13.75 arcmin | Arithmetic, checked |
| Recovery of a synthetic 10 arcsec/yr mover, a factor-2 variable and a methane-like absorber from synthetic SPHEREx-style files | Unit and end-to-end tests on the synthetic sky. `[RESULT: number of tests and pass/fail at the submitted commit]` |

### Planned checks on real data

None of these has been run. Each row says what will be measured and what it will be compared with.
Reference values marked (verify) were written from memory and must be checked against the
catalogue before they are quoted anywhere.

| Target | Kind | Reference | What Tombaugh measures | Result |
|---|---|---|---|---|
| Barnard's Star | Fast mover | Gaia DR3 4472832130942575872: pmra -801.551, pmdec +10362.394 mas/yr, total 10 393 mas/yr at PA 355.6 deg; parallax 546.98 mas (verify against the live `/gaia` response) | Proper motion from pass centroids; dipole in the residual; offset from the 2016.0 Gaia ring | `[RESULT: measured proper motion of Barnard's Star, mas/yr, with error and position angle]` `[RESULT: difference from Gaia in mas/yr and in sigma]` `[RESULT: number of passes and exposures used; fraction of frames flagged OVERFLOW or NONLINEAR at the star]` |
| Epsilon Indi B (Ba, Bb) | Mover; methane | Common proper motion with Epsilon Indi A, about 4.7 arcsec/yr (verify); T1 and T6 dwarfs (verify); pair separation under 1 arcsec, unresolved by SPHEREx (verify); distance 3.64 pc (verify) | Proper motion of the blended pair; methane-lens depth; spectrum at 3.3 and 4.5 um | `[RESULT: measured proper motion of Epsilon Indi B]` `[RESULT: methane lens depth at Epsilon Indi B and its error]` `[RESULT: detectors in which the pair is detected]` |
| WISE 0855-0714 | Fast, very faint, cold | Proper motion about 8.1 arcsec/yr (verify); parallax about 0.44 arcsec (verify); about 2.3 pc (verify); not in Gaia | Whether it is detected at all: single frames, per-pass stacks in D5 and D6; position against the literature track | `[RESULT: WISE 0855 detected or not, in which detector and stack, at what signal-to-noise]` `[RESULT: measured displacement between passes, if detected]` |
| RW Aurigae | Irregular variable (T Tauri) | Known irregular variable with deep dimming episodes (verify); no fixed period | Light-curve ratio per pass; residual pulse; proper motion consistent with Gaia | `[RESULT: ratio of RW Aur brightness between passes, per detector, with error]` |
| R Draconis | Long-period variable (Mira) | Period about 245 days (verify); large visual amplitude (verify) | Light-curve ratio per pass against the phase expected from the period; residual pulse; flag fractions, since it is bright | `[RESULT: ratio of R Dra brightness between passes, per detector, with error]` `[RESULT: fraction of frames flagged OVERFLOW or NONLINEAR at R Dra]` |

Checks on the method that do not depend on a famous target:

| Check | What it shows | Result |
|---|---|---|
| Gaia ring alignment: offset between Gaia-predicted and measured centroids of field stars | Frame astrometry and resampling are right | `[RESULT: median and scatter of centroid offsets, arcsec, for N field stars]` |
| Null test: measured motion of field stars with Gaia proper motion below 50 mas/yr | Empirical error of the proper-motion measurement | `[RESULT: median and scatter of measured motion, mas/yr, for N stars]` |
| Residual noise: distribution of `snr` on empty sky | Whether the noise model is right | `[RESULT: standard deviation of snr on blank sky; fraction beyond 5 sigma]` |
| Candidate purity in a field with no known mover or variable | False-alarm rate of the change map | `[RESULT: number of candidates per square arcminute in a control field, and what they are]` |
| Injection and recovery for the distance dial | The dial focuses at the right distance | See section 8 |

## Limits and failure modes

**Pixels are 6.15 arcseconds and the PSF is undersampled** at the short-wavelength end. The flux a
star puts in its central pixel depends on where in the pixel it lands, and that changes from
exposure to exposure. To the per-pixel fit this is scatter with nothing to do with wavelength or
time. On bright stars it is far larger than the formal noise, so bright stationary stars leave
residuals of both signs. They are recognisable because they do not form a consistent dipole from
pass to pass, and because the model `rms` is high there.

**The PSF changes with wavelength.** Within one detector the wavelength changes by a factor of up
to 1.6 and the PSF with it. The model fits each pixel independently, so on the wings of a bright
star the "spectrum" of a pixel includes the changing PSF. A quadratic absorbs most of that. What
is left appears as faint rings around bright stars in the residual.

**Sharp spectral features break the smooth-spectrum assumption.** Emission lines in nebulae, the
3.3 um PAH feature, deep molecular bands in late-type stars and brown dwarfs, and ice bands are
not quadratics in ln(wavelength). They leave residuals that depend on wavelength, not on time: the
same sign whenever the same wavelength comes round. The tool does not yet separate these
automatically from true change. Checking a candidate in a second detector, and in the matched
view, is the remedy.

**Saturated and non-linear stars.** Bright targets trip the OVERFLOW and NONLINEAR flags and their
cores are masked. Centroids of a star with a masked core are biased and its photometry is
meaningless. Two of the five challenge targets, Barnard's Star and R Draconis, are bright in the
infrared and may be affected in some detectors (verify on real frames). The flag overlay shows
when this is happening.

**Crowded fields.** Near the Galactic plane, neighbouring stars overlap at 6.15 arcsec. Centroids
are pulled toward neighbours, the photometry annulus is contaminated, and a moving star merging
with or separating from a neighbour looks like variability in both.

**Few passes.** About three exist. The per-pass safeguard in the fit needs at least three; with
two, a mover or a variable pulls the model toward itself and its residual is diluted. Three points
determine a straight line with one degree of freedom per axis. Proper motion and parallax cannot be separated without assuming one of them. A
variable observed three times has a light curve of three points; a period cannot be measured, only
compared with a known one.

**Pass stacks are not identical in colour.** Each pass samples the detector's range at different
wavelengths. For most sources the effect is small; for very red sources a pass-to-pass difference
of a few percent in a stack is not evidence of variability. The residual view and the light-curve
ratio are designed to remove this; the plain stack blink is not.

**WISE 0855 is near the single-frame limit.** It is among the coldest known brown dwarfs and emits
almost nothing short of 4 um. It may be visible only in stacks of the two longest-wavelength
detectors, and its motion of about 4 arcsec per pass is under one pixel. A non-detection is a
possible and honest outcome.

**Planet X.** A planet of a few Earth masses at several hundred AU is expected to be far fainter
at 1 to 5 um than a single SPHEREx exposure reaches, and probably fainter than any stack the
survey allows (verify against published brightness predictions). Tombaugh does not claim to be
able to find it. It makes the search geometry concrete, it works on the nearby fast-moving objects
SPHEREx does detect, and it would work unchanged on a deeper survey with the same data model.

**The fog-of-war map** records which 1.8 degree cells have been opened in Tombaugh. It is a count
of views through this tool, it can be incremented by anyone, and it is not a record of what
astronomers have examined by other means.

**Not affiliated with or endorsed by NASA.** Calibration, flags, variance and the zodiacal model
are the SPHEREx pipeline's. Tombaugh displays and combines them and adds no calibration of its
own.
