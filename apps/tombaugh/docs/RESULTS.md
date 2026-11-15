# Results on real SPHEREx data

Everything on this page was measured by Tombaugh itself, in a browser, on real SPHEREx Level 2
spectral images (Data Release 1 and Quick Release 3) on 15 November 2026. Nothing here comes from
the synthetic test sky. Each number can be reproduced from the live tool: the link or the button
that produces it is named beside it.

The catalogue values in the tables are not typed in by hand. The Validation tab reads them at run
time (Gaia DR3 for stars; published values for the two brown dwarfs, which Gaia does not list) and
turns them into "what a perfect measurement on these dates would give", parallax included.

Screenshots from these runs are in [real/](real/).

## 1. Headline

- **Five of five challenge targets measured. All 34 comparisons with the catalogues agree within
  3 sigma** (Validation tab, "Run the five challenge targets", run of 2026-11-15 10:44 UTC; a
  second run an hour later gave the same verdict).
- **Three fast movers recovered** from 6-arcsecond pixels and two to four visits: Barnard's Star,
  Epsilon Indi Ba,Bb and WISE 0855-0714, each with the right speed and the right direction.
- **Two variables recovered**: RW Aurigae rose by 40 % between September 2025 and March 2026
  (11 sigma); R Draconis fell by 28 % between March and April 2026 (4.3 sigma).
- **Methane seen twice**: in the T dwarfs Epsilon Indi Ba,Bb (3.3 µm band depth 0.600 ± 0.002) and
  as ice on Pluto, whose spectrum shows the methane-ice bands at 0.89, 1.16, 1.38, 1.72, 2.3 and
  3.3 µm.
- **Blind search works**: with no catalogue input, the candidate list on Barnard's field holds one
  entry, "moved, halo shifted north"; on a control field it holds none.

## 2. The five challenge targets

Proper motions are in milliarcseconds per year (mas/yr). "Sigma" is the difference from the
catalogue divided by the measurement's own 1-sigma error.

### Motion

| Target | Passes used | Measured total | Catalogue | Sigma | Measured direction | Catalogue |
|---|---|---|---|---|---|---|
| Barnard's Star | 3 (Aug 2025, Mar 2026, Aug 2026), D3 | 11903 ± 2426 | 10380 | +0.6 | 355 ± 12 deg | 356 deg |
| Epsilon Indi Ba,Bb | 4 (Apr 2025 to Sep 2026), D6 | 4511 ± 648 | 4635 | −0.2 | 125.9 ± 8.2 deg | 123.9 deg |
| WISE 0855-0714 | 3 (May 2025, Nov 2025, Apr 2026), D6 | 8016 ± 1249 | 8169 | −0.1 | 277.9 ± 8.9 deg | 274.6 deg |
| RW Aurigae | 3 (Sep 2025, Mar 2026, Sep 2026), D2 | 1189 ± 666 | 25 | +1.7 | no motion detected | |
| R Draconis | 3 (May 2025, Mar 2026, Apr 2026), D3 | 2082 ± 1173 | 21 | +1.8 | no motion detected | |

The two variables are the controls for motion: they should not move, and they do not (under
2 sigma). Barnard's Star saturates the detector, so each of its positions is taken from the
unsaturated light around the flagged core; that is why its error is the largest.

Components for the three movers:

| Target | East, measured | East, catalogue | North, measured | North, catalogue | Parallax fitted | Parallax, catalogue |
|---|---|---|---|---|---|---|
| Barnard's Star | −1022 ± 2426 | −667 | 11859 ± 2426 | 10359 | 1537 ± 551 mas | 547 mas |
| Epsilon Indi Ba,Bb | 3655 ± 648 | 3849 | −2644 ± 648 | −2583 | 329 ± 402 mas | 271 mas |
| WISE 0855-0714 | −7939 ± 1249 | −8143 | 1104 ± 1249 | 656 | 187 ± 513 mas | 439 mas |

The parallaxes are consistent with the catalogue but not detections on their own: SPHEREx revisits
a position about every six months, which is the worst cadence for parallax.

### Brightness

| Target | Result | Detail |
|---|---|---|
| RW Aurigae | **×1.397 ± 0.041 (11.0 sigma)**, Sep 2025 → Mar 2026, D2 | then steady: ×0.963 ± 0.029 to Sep 2026 |
| R Draconis | **×0.717 ± 0.056 (4.3 sigma)**, Mar 2026 → Apr 2026, D3 | steady before: ×1.029 ± 0.098, May 2025 → Mar 2026 |
| Barnard's Star | no change: largest is ×1.245 ± 0.098 (2.9 sigma) | |
| Epsilon Indi Ba,Bb | no change: D6 pairs ×1.005 ± 0.023, ×0.997 ± 0.022, ×0.977 ± 0.022, ×0.980 ± 0.023 | steady to about 2 % over 17 months |
| WISE 0855-0714 | no change counted: D6 ×0.991 ± 0.106 | a ×2.19 jump in D4 is rejected because a G = 16.3 Gaia star sits 3.3 arcsec away on those dates |

The last row matters as much as the first two. The tool tracks where the brown dwarf is on each
date, finds that a background star is inside the aperture on some dates and not others, and
declines to call the difference a brightening.

### Spectrum

| Target | Exposures with clean photometry | Coverage | Median signal-to-noise per exposure | Depth of the 3.15–3.45 µm methane band |
|---|---|---|---|---|
| Epsilon Indi Ba,Bb | 109 of 135 | 2.44–5.01 µm | 63 | **0.600 ± 0.002** |
| WISE 0855-0714 | 68 of 79 | 2.43–5.00 µm | 4.7 | 0.175 ± 0.071 |

A depth of 0 is a smooth spectrum. Epsilon Indi Ba,Bb are T dwarfs and methane removes 60 % of
their light in this band. WISE 0855 is near the detection limit in single exposures; its band is
seen at 2.5 sigma.

## 3. Controls: how far the numbers can be trusted

Measured on ordinary field stars in the same fields, by the same code.

| Field | Reference stars | Median offset from Gaia | Scatter per axis | Null test, east | Null test, north | Residual / sigma on blank sky |
|---|---|---|---|---|---|---|
| Barnard's Star | 6 | 0.13 arcsec | 0.69 arcsec | 7 ± 561 | 41 ± 561 | 1.14 |
| Epsilon Indi Ba,Bb | 22 | 0.04 arcsec | 0.70 arcsec | −44 ± 188 | −135 ± 188 | 1.69 |
| WISE 0855-0714 | 7 | 0.26 arcsec | 0.79 arcsec | −276 ± 1488 | −82 ± 1021 | 1.34 |
| RW Aurigae | 12 | 0.22 arcsec | 0.36 arcsec | 26 ± 163 | 5 ± 163 | 0.94 |
| R Draconis | too few clean stars | | | | | 1.15 |

- **Offset from Gaia.** Field stars land within 0.3 arcsec of where Gaia says they are, about
  one twentieth of a 6.15-arcsec pixel. Frames, resampling and centroids line up.
- **Null test.** The mean measured motion of stars that Gaia says do not move (mas/yr). It is
  zero within its error in every field. This is the honest size of the method's error.
- **Noise.** The residual divided by its predicted sigma should have a standard deviation of 1.
  It is between 0.94 and 1.69: the noise model is right to within tens of percent, and slightly
  optimistic in the crowded Epsilon Indi field.

## 4. The viewer's own readings

Clicking the target in the main view (no Validation tab) gives the same answers:

| Target | Tombaugh | Reference |
|---|---|---|
| Barnard's Star | 11 ± 3 arcsec/yr at position angle 357° | Gaia: 10.39 arcsec/yr at 356° |
| WISE 0855-0714 | 8.2 ± 0.6 arcsec/yr at 281° | published: 8.15 arcsec/yr at 274.8° |
| Epsilon Indi Ba,Bb | 4.7 ± 0.6 arcsec/yr at 128° | catalogue: 4.64 arcsec/yr at 124° |
| RW Aurigae | rose by a factor of 1.4 between Sep 2025 and Sep 2026 (8.6 sigma) | known irregular variable |
| R Draconis | fell by a factor of 2.2 between Feb and Apr 2026 | known Mira variable |

## 5. Blind search for things that changed

The Candidates tab subtracts a model of the unchanging sky and lists what is left, with no
catalogue input.

| Field | Candidates | Top entry |
|---|---|---|
| Barnard's Star | 1 | "Moved. Saturated star: its halo shifted north between Aug 2025 and Aug 2026; 25 residual patches belong to it." 10.2 sigma |
| R Draconis | 1 | "Saturated star: its halo faded; 14 residual patches belong to it." 13.1 sigma |
| RW Aurigae | 3 | "Saturated star: its halo brightened between Sep 2025 and Mar 2026; 5 residual patches belong to it." 18.6 sigma; the other two are bright blended stars |
| WISE 0855-0714 | 1 | the brown dwarf |
| Control field, RA 56.25, Dec +34.22887 (373 exposures, 3 passes) | 0 | "Nothing stands out" |

Before the saturated-star step was added, Barnard's field listed 12 false "changed brightness"
entries, all of them pieces of one moving halo. That fix came from looking at real data.

## 6. Pluto: following a body that moves

Link: `?body=pluto`. The tool asks JPL Horizons where Pluto was, finds every SPHEREx exposure
that caught it, and stacks them in Pluto's frame so that the stars streak and Pluto stays put.

- 225 exposures in 4 visits: April 2025, October 2025, April to May 2026, September to October 2026.
- 98 exposures gave a clean measurement; 19 stacks in the frame that follows Pluto.
- Spectrum from 0.76 to 4.97 µm, peaking near 10 mJy at 0.93 µm.
- Methane-ice absorption at 0.89 µm, 1.14–1.17 µm, 1.31–1.41 µm, 1.64–1.80 µm (about 48 % deep at
  1.65 µm), 2.15–2.39 µm (about 53 % deep at 2.31 µm), 3.3–3.5 µm and 3.8 µm.

Pluto is the object Clyde Tombaugh found with a blink comparator in 1930. This is the same
search, with 102 colours, done by a web page.

## 7. The data behind it

- Exposure index built by this project from NASA's public SPHEREx bucket: 272,963 exposures in
  273 index units.
- Releases used in the validation run: DR1 (450 exposures) and QR3 (76 exposures).
- Data: SPHEREx Level 2 spectral images, NASA/IPAC Infrared Science Archive. DR1 spectral images
  DOI 10.26131/IRSA678; QR3 DOI 10.26131/IRSA662. Reference catalogue: Gaia DR3, epoch 2016.0.
  Ephemerides: JPL Horizons.

## 8. What these results do not show

- Motions under about 1 arcsec/yr cannot be seen with this pixel size and this time span. The
  error on a single target is 0.6 to 2.4 arcsec/yr.
- Saturated stars (Barnard's Star, R Draconis) have every aperture pixel flagged, so their
  brightness ratios come from the unsaturated wings and are less certain than the formal error.
- No new object is claimed. The control field is one field. A real search for an unknown body
  needs many fields and a human to look at each candidate, which is what the tool is built for.
- The Epsilon Indi field's noise ratio of 1.69 means the noise there is underestimated, so
  significances quoted in that field are somewhat overstated.
