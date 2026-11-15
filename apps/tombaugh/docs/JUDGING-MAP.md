# Judging map

Where to look for each thing a judge scores. Every row points to something that can be opened: a
view of the live tool, a file, or a section of a document. Rows that depend on a measurement say
so and point to where the number will be.

Live tool: `[LIVE-URL]` · Source: `[REPO-URL]` · Demo: `[DEMO-URL]`

## Judging criteria (each scored 1 to 5)

| Criterion | What Tombaugh offers | Where to see it |
|---|---|---|
| **Impact** | Opens SPHEREx time-domain data to anyone with a browser: no account, no install, no knowledge of the file format. Works for any position on the sky, not only the test targets. Picks up new survey passes as the archive releases them. Usable in teaching: proper motion, parallax and molecular absorption from current mission data | Live tool, landing page and tour; [ARCHITECTURE.md](ARCHITECTURE.md#new-data-releases-without-code-changes) |
| | States plainly what it cannot do, so nobody is misled about Planet X | [README limits](../README.md#limits); [SCIENCE.md limits](SCIENCE.md#limits-and-failure-modes) |
| **Creativity** | Predicted-sky subtraction: a reference image built from the spectrum, because SPHEREx never repeats a colour | `view=residual`; [SCIENCE.md section 4](SCIENCE.md#4-predicted-sky-subtraction) |
| | Distance dial: focus the survey at a chosen distance by undoing the parallax | `view=distance`; [SCIENCE.md section 8](SCIENCE.md#8-the-distance-dial) |
| | Molecule lenses: colour the field by chemistry | `view=lens&lens=methane` |
| | Gaia rings that a moving star leaves behind; fog-of-war map of the unexplored sky | `gaia=1`; sky map on the landing page |
| **Validity** | The tool checks itself against an independent catalogue: measured proper motion beside Gaia's, on screen, for any star | Motion meter; [SCIENCE.md section 7](SCIENCE.md#7-proper-motion-and-the-comparison-with-gaia) |
| | Validation plan for the five targets with reference values, null tests on field stars, noise test, injection and recovery. Completed checks are listed apart from planned ones; measured values are `[RESULT: ...]` placeholders until run | [SCIENCE.md section 10](SCIENCE.md#10-validation) |
| | Facts about the data measured on real files before code was written; coordinate transform tested against a real header; unit tests for every module; synthetic sky with known mover, variable and absorber | [CONTRACT.md](../CONTRACT.md) "Verified facts"; `node --test` |
| | Failure modes named: undersampling, PSF change with wavelength, sharp spectral features, saturation, crowding, few passes | [SCIENCE.md limits](SCIENCE.md#limits-and-failure-modes) |
| | Uses the pipeline's own flags, variance and zodiacal model; follows FITS WCS, SIP and HEALPix as published | [SOURCES.md](SOURCES.md#4-standards-and-methods) |
| **Relevance** | Meets the objective as written: public web tool, RA and Dec in, a movie of SPHEREx images out, moving objects made easy to spot, tested on the five named targets | Table below |
| | Addresses every optional consideration, and says which one is only partly met (WISE overlay) | Table below |
| **Presentation** | 30-second demo in three beats: see it, measure it, know it | `[DEMO-URL]`; [DEMO-SCRIPT.md](DEMO-SCRIPT.md) |
| | The tool explains itself: a first screen with one sentence and five targets, short explainer cards for each idea, captions with date and wavelength on every frame, keyboard help | Live tool; `?` key |
| | Complete written submission, full source list, plain AI disclosure | [SUBMISSION.md](SUBMISSION.md); [SOURCES.md](SOURCES.md); [AI-USE.md](AI-USE.md) |

## Challenge objective

| The challenge asks for | Feature | Where to see it |
|---|---|---|
| A public-facing web tool | One page, public, no sign-in | `[LIVE-URL]` |
| Users enter RA and Dec | Search box takes decimal degrees, sexagesimal (`17h57m48.5s +04d41m36s`, `17:57:48.5 +04:41:36`) or a name | Search box; `?ra=..&dec=..`; `?name=..` |
| Display a series of SPHEREx images of that patch like a little video | Movie player: play, pause, speed, step, blink A/B. Frames are every exposure in time order, or one stack per survey pass | `view=exposures`; `view=passes` |
| Making it easy to spot moving objects | Residual movie; candidate list; Gaia rings; motion meter | `view=residual`; `gaia=1` |
| Test on Barnard's Star | Tour target. Expected: star outside its 2016.0 Gaia ring, bright-dark pair in the residual, proper motion near 10.4 arcsec/yr | Tour; `[RESULT: in SCIENCE.md section 10]` |
| Test on Epsilon Indi B | Tour target. Expected: motion near 4.7 arcsec/yr (verify), methane absorption | Tour with `view=lens&lens=methane`; `[RESULT: in SCIENCE.md section 10]` |
| Test on WISE 0855 | Tour target at the challenge's coordinates, propagated to today. Near the detection limit; a non-detection is reported as such | Tour, detectors 5 and 6; `[RESULT: in SCIENCE.md section 10]` |
| Test on RW Aurigae | Tour target. Expected: brightness ratio between passes differs from 1 | Tour; click for light curve; `[RESULT: in SCIENCE.md section 10]` |
| Test on R Draconis | Tour target. Expected: large brightness change between passes; possibly saturated | Tour; click for light curve; `[RESULT: in SCIENCE.md section 10]` |

## Optional considerations

| Consideration | Feature | Where to see it | Met |
|---|---|---|---|
| Easy to update with new releases | Frame list comes from a live archive query; release read from the file path; passes found from time gaps; DOIs in one constant | [ARCHITECTURE.md](ARCHITECTURE.md#new-data-releases-without-code-changes); citation line under each view | Yes |
| Creative display of the 102 bands, for example adding together each of the six detector arrays | Per-pass stack for each of the six detectors (keys `1` to `6`); matched-channel view; molecule lenses; three-detector colour | `view=passes&det=1..6`; `view=matched&ch=..`; `view=lens&lens=rgb` | Yes |
| Extra kudos: spectra on the fly | Click any position: aperture photometry on every loaded frame, plotted against wavelength, with a light curve and CSV export | Click in the viewer | Yes |
| Add or subtract images taken at different times | Add or subtract any two passes; and the residual view, which subtracts a predicted image | `view=diff`; `view=residual` | Yes |
| User-chosen field of view | 2, 4, 6 or 10 arcminutes | `fov=` | Yes, four sizes |
| Overlays from Gaia or WISE | Gaia DR3 rings with proper motion. WISE sources are not overlaid; a link opens WiseView at the same coordinates | `gaia=1`; "Open in WiseView" | Gaia yes, WISE by link only |
| Coordinates in the URL so it can be embedded | Whole view state in the URL; `embed=1` hides the chrome; runs in a sandboxed iframe | Address bar; [README](../README.md#try-it) | Yes |
| Metadata such as contamination flags | Flag overlay with named bits; date, wavelength, observation id and release for each frame; photometry notes flagged pixels | `flags=1`; frame caption | Yes |
| Reuse of public tools such as Astropy and Aladin | Public services and standards are reused (IRSA TAP and cutouts, Gaia, CDS Sesame and SIMBAD, FITS WCS, SIP, HEALPix), and the design follows WiseView. Astropy and Aladin themselves are not used: the page has no dependencies so that it ships as one embeddable file | [SOURCES.md](SOURCES.md) | In spirit, not in letter |

## Awards the project could fit

Pick the one the finished evidence supports.

| Award | The case | Evidence needed |
|---|---|---|
| Best Use of Science | A stated method with a noise model, a built-in comparison against Gaia, null tests and named failure modes | The validation table in [SCIENCE.md](SCIENCE.md#10-validation) filled with real measurements |
| Best Use of Data | SPHEREx's own data model (a wavelength for every pixel, flags, variance, zodiacal model) is used in full, and the awkward property of the data, no repeated colour, is turned into the method | `view=residual` working on real frames; click-spectra |
| Best Use of Technology | A 4 MB file trimmed to about 72 kB by stopping the download early; all science in the browser with no libraries; one-file build; embeddable by URL; survives a slow archive | [ARCHITECTURE.md](ARCHITECTURE.md); the live tool loading a target |

## What is not there

Stated here so that it is not found by surprise.

- The 16-year SPHEREx-plus-WISE movie was planned and not built.
- No measured results are quoted until they have been measured. See the placeholders in
  [SCIENCE.md](SCIENCE.md#10-validation).
- The distance dial is demonstrated on a known body or an injected synthetic source, not on a
  discovery.
- Astropy and Aladin are not used.
