# Submission text

Ready-to-paste text for each field of the NASA Space Apps 2026 project form, followed by a
checklist. Replace every `[PLACEHOLDER]` before pasting. Do not paste a `[RESULT: ...]` line: fill
it with a number measured on real data, or delete the sentence that contains it.

Placeholders used here: `[LIVE-URL]` the hosted tool, `[REPO-URL]` the public GitHub repository,
`[DEMO-URL]` the public demo video or slides, `[DR1-DOI]` the DOI of SPHEREx Data Release 1.

---

## Project Name

```
Tombaugh
```

Tagline, if the form has room for one: `A blink comparator for the 102-color sky`

---

## High-Level Project Summary

*What did you develop, how does it address the challenge, why is it important. (148 words.)*

```
Tombaugh is a public web tool that turns the SPHEREx all-sky infrared survey into a blink comparator. Enter a position or a name and it plays the SPHEREx images of that patch as a short movie, so that objects which move or change brightness stand out.

SPHEREx never images a patch in the same colour twice. A filter that varies across each detector gives every exposure a different wavelength, so a plain movie flickers because the colour changed, not the sky. Tombaugh fits a smooth spectrum to every pixel, predicts what the unchanging sky should look like in each frame, and shows what is left. It then measures the motion and sets it beside Gaia's value, so the tool checks itself.

A survey that revisits the whole sky every six months is a search for anything nearby that moves. Tombaugh opens that search to anyone with a browser.
```

---

## Link to Project Demo

```
[DEMO-URL]
```

A screen recording of 30 seconds or less, in English, at a public link. Script:
[DEMO-SCRIPT.md](DEMO-SCRIPT.md).

---

## Link to Final Project

```
[REPO-URL]
```

The repository README opens with the link to the live tool, `[LIVE-URL]`. If the form allows only
one link and a working tool is preferred over source, use `[LIVE-URL]` here and keep `[REPO-URL]`
in the first line of the detailed description.

---

## Detailed Project Description

*What it does, how it works, benefits, what you hope to achieve, tools and languages used. (About
690 words with the result paragraph, 650 without.)*

```
Live tool: [LIVE-URL]
Source code: [REPO-URL]

WHAT IT DOES

Tombaugh is a web page. Type sky coordinates (RA and Dec) or an object name, choose a field of view from 2 to 10 arcminutes, and it shows the SPHEREx images of that patch as a movie. A five-target tour covers the challenge's test objects: Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae and R Draconis.

It offers several ways to look at the same patch:
- Exposures: every exposure in time order. This is the simple movie, and it flickers.
- Passes: one stacked image per six-month survey pass, for each of the six detectors.
- Matched: only exposures at nearly the same wavelength, one image per pass.
- Residual: each frame minus the sky predicted for it, with a list of places that changed.
- Add or subtract any two passes.
- Molecule lenses: colour the field by the depth of the methane, water, CO2 or CO absorption band.
- Distance dial: shift the frames by the parallax a body at a chosen distance would show, and stack.

Click anywhere for a spectrum and a light curve. Gaia DR3 stars are drawn as rings at their catalogue positions; a fast-moving star has left its ring. A motion meter shows the proper motion Tombaugh measures beside Gaia's. Pixel flags can be overlaid. The whole view is stored in the URL, so any view can be shared or embedded in another page. A "fog of war" sky map shows which patches anyone has opened in Tombaugh, and offers one nobody has.

HOW IT WORKS

SPHEREx has a linear variable filter above each detector, so the wavelength a pixel records depends on its position. A patch of sky is seen at a different wavelength in every exposure. Blink those exposures and every star changes brightness because the colour changed. And a SPHEREx pixel is 6.15 arcseconds, while even Barnard's Star moves only about 5 arcseconds between passes.

Tombaugh's answer is predicted-sky subtraction. All exposures are resampled onto one north-up grid. For each pixel, a smooth curve of brightness against wavelength is fitted through all exposures of one detector. For each frame, the curve predicts what a static sky would give at the wavelengths that frame saw. Subtract, and a constant star cancels; a star that moved leaves a bright and dark pair; a star that varied leaves a pulse. Centroids in each pass give a proper motion, which is compared with Gaia.

A small proxy does the archive work. It queries the NASA/IPAC Infrared Science Archive for every SPHEREx Level 2 image covering the position, downloads only the part of each 4 MB file that is needed, attaches a wavelength to every pixel, and caches the result. All science and drawing happen in the browser. New data appear without code changes, because the list of images comes from a live archive query.

BENEFITS

Anyone can inspect SPHEREx time-domain data without installing software or learning the file format. The tool states its limits and shows how far to trust it by comparing its measurements with Gaia. Teachers get a working demonstration of proper motion, parallax and molecular absorption from current mission data.

WHAT WE HOPE TO ACHIEVE

A real Planet X is probably too faint for SPHEREx, and we say so. What Tombaugh can do is make the search concrete, find the nearby fast movers and variables that SPHEREx does detect, and be ready for each new pass.

[RESULT: one or two sentences giving the measured proper motion of Barnard's Star beside Gaia's value, and which of the five targets were detected. Delete this paragraph if the measurements have not been made.]

Not built: the planned 16-year movie joining SPHEREx to WISE. Tombaugh links to WiseView instead.

TOOLS

JavaScript (ES modules) with no third-party libraries, HTML, CSS, Canvas and SVG. Node.js for tests and the build. A serverless edge function (Deno runtime) with object storage for the proxy and cache. Data from IRSA (SPHEREx), Gaia DR3 and CDS. Code written by an AI model (Claude) under the team owner's direction; see the SI field. Licensed under Apache 2.0.

Tombaugh is not affiliated with or endorsed by NASA.
```

---

## Use of Super Intelligence (SI)

*Did you use SI tools, and how.*

```
Yes.

The idea is human. The concept and its five ideas (predicted-sky subtraction, a distance dial, molecule lenses, a SPHEREx-plus-WISE movie, and a "fog of war" sky map) are the team owner's own, written in their design note "Tombaugh: a blink comparator for the 102-color sky" on 13 November 2026. SI was not the source of the idea.

All source code and tests were generated by Claude (an AI model made by Anthropic; model "Claude Fable 5.2", used through Claude Code), under the team owner's direction and review. This is stated in a header at the top of every source file, in the repository's NOTICE and README, and in docs/AI-USE.md.

SI also helped research public documentation and draft the project text, which the team owner reviewed.

No SI-generated images, video or audio are used. The demo is a screen recording of the live tool. The tool itself contains no AI model: everything on screen is computed from archive data by readable code. No NASA branding appears anywhere.
```

---

## NASA Data

*Specific NASA data and resources used. At least one is required.*

```
1. SPHEREx Level 2 spectral images (calibrated single exposures), from the NASA/IPAC Infrared Science Archive (IRSA). Releases: Quick Release 3 and Data Release 1 as available at each position. DOI 10.26131/IRSA629 (SPHEREx archive), 10.26131/IRSA662 (Quick Release 3), [DR1-DOI] (Data Release 1).
https://irsa.ipac.caltech.edu/Missions/spherex.html
Use: this is the only image data in the tool. Every movie frame, stack, residual image, spectrum and light curve is computed from the image, flags, variance and zodiacal-light layers of these files and from their per-pixel wavelength table.

2. IRSA Table Access Protocol service (tables spherex.artifact and spherex.plane).
https://irsa.ipac.caltech.edu/TAP/sync
Use: for each position, a live query lists every SPHEREx Level 2 image whose footprint contains it. This is how new releases appear in the tool without code changes.

3. IRSA image cutout service for SPHEREx files.
Use: retrieves the cutout of each exposure around the requested position.

4. IRSA SPHEREx tutorial notebooks.
https://caltech-ipac.github.io/irsa-tutorials/spherex/
Use: consulted to understand the file layout, the archive query and the wavelength lookup. No code was copied.

5. SPHEREx Explanatory Supplement (IRSA).
Use: meaning of the image layers, pixel flags, units and the spectral coordinate system.

6. NASA Space Apps 2026 challenge statement "Planet X and SPHEREx".
Use: requirements, the five test targets and the coordinates of WISE 0855.
```

Before pasting: confirm the three DOIs and the exact title of item 5 (all marked (verify) in
[SOURCES.md](SOURCES.md)), and delete "Data Release 1" from item 1 if no `dr1` frames were
actually shown.

---

## Space Agency Partner Data and Other References

*All data, resources, tools, code, text and images, even if open source.*

```
SPACE AGENCY PARTNER DATA
- Gaia Data Release 3 (European Space Agency; Gaia Data Processing and Analysis Consortium): source positions at epoch 2016.0, proper motions, parallaxes and G magnitudes. Queried from the ESA Gaia archive (https://gea.esac.esa.int/archive/), with VizieR (catalogue I/355/gaiadr3) and IRSA as fallbacks. Use: overlay rings, and the reference proper motion against which Tombaugh's measurement is compared. The challenge lists Gaia DR3 at https://archive.stsci.edu/missions-and-data/gaia
- Canadian Space Agency resources listed with the challenge (NEOSSat, Canadian Astronomy Data Centre) were not used.

OTHER DATA SERVICES
- CDS Sesame name resolver and the SIMBAD database (CDS, Strasbourg): object names to coordinates and proper motions.
- VizieR (CDS): fallback copy of Gaia DR3.
- WiseView, http://byw.tools/wiseview (Caselden et al. 2018; Backyard Worlds: Planet 9): the model for a blink tool; Tombaugh links to it at the same coordinates. No WiseView code or data is included.

STANDARDS AND PAPERS
- Pence et al. 2010, A&A 524, A42: the FITS standard.
- Greisen & Calabretta 2002, A&A 395, 1061: world coordinates in FITS.
- Calabretta & Greisen 2002, A&A 395, 1077: celestial coordinates in FITS (TAN projection).
- Greisen et al. 2006, A&A 446, 747: spectral coordinates in FITS (the -TAB convention).
- Shupe et al. 2005, ASP Conf. Ser. 347, 491: the SIP distortion convention.
- Gorski et al. 2005, ApJ 622, 759: HEALPix (implemented from the paper for the sky map).
- Bretagnon & Francou 1988, A&A 202, 309 (VSOP87), with the truncated term list and precession formulae from Meeus 1998, "Astronomical Algorithms", 2nd ed.: position of the Earth for parallax.
- ESA 1997, "The Hipparcos and Tycho Catalogues", ESA SP-1200: the standard model of stellar motion.
- Bertin & Arnouts 1996, A&AS 117, 393: definition of the windowed centroid (SExtractor itself is not used).
- King 1983, PASP 95, 163; Condon 1997, PASP 109, 166: centroid error estimate.
- IVOA TAP, ADQL and UWS recommendations: archive query protocols.
- Gaia Collaboration, Prusti et al. 2016, A&A 595, A1; Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1.
- Wenger et al. 2000, A&AS 143, 9: SIMBAD.
- Kuchner et al. 2017, ApJL 841, L19: Backyard Worlds: Planet 9.
- Luhman 2014, ApJL 786, L18: WISE 0855-0714.
- Scholz et al. 2003, A&A 398, L29; McCaughrean et al. 2004, A&A 413, 1029: Epsilon Indi B.
- Batygin & Brown 2016, AJ 151, 22: the distant-planet hypothesis.
- Dore et al. 2014, arXiv:1412.4872: the SPHEREx mission concept.

THE IDEA
- Harshbarger, P., "Tombaugh: a blink comparator for the 102-color sky", design note, 13 November 2026 (the team owner's own).

CODE
- No third-party code libraries are bundled; all code in the repository was generated for this project. It was generated by Claude (Anthropic) under the team owner's direction, as described in the SI field. The "viridis" colour scale is an approximation of the matplotlib colour map of that name (CC0).

TOOLS
- Node.js (tests, build, development server). Supabase Edge Functions on the Deno runtime, and Supabase Storage (proxy and cache). Playwright (browser test during development). Git and GitHub. Claude Code with Claude Fable 5.2.

IMAGES, VIDEO, TEXT
- No third-party images. All graphics are rendered by the tool from SPHEREx data or drawn by code. The demo is a screen recording of the tool. No NASA logos or insignia are used. Project text was drafted with AI assistance and reviewed by the team owner.

The full list with links is in docs/SOURCES.md in the repository.
```

Before pasting: every bibliographic entry above is marked (verify) in [SOURCES.md](SOURCES.md).
Open each one. Remove any tool that was not in fact used (Playwright is the one to check). The
source of `ephemeris.js` names JPL Horizons and JPL's approximate planetary elements as checks of
the Earth position; if those comparisons were really run, add "JPL Horizons (NASA/JPL): used to
check the Earth ephemeris" to the NASA Data field, and if not, correct the comment in the code.

---

## Pre-submission checklist

### Links

- [ ] `[LIVE-URL]` opens in a private browser window, signed out, on a phone and on a laptop.
- [ ] From that private window: the first screen loads, one tour target loads real SPHEREx frames,
      the movie plays, the residual view shows, a click gives a spectrum.
- [ ] The landing page a judge sees shows Tombaugh only. No promotion of a commercial product or
      service on the page or around it.
- [ ] `[REPO-URL]` is public and opens in a private window. README renders, including the diagrams.
- [ ] `[DEMO-URL]` is public (not "unlisted to signed-in users", not a share link that expires) and
      plays in a private window without sign-in.
- [ ] Every link pasted into the form was clicked after pasting.
- [ ] All `[LIVE-URL]`, `[REPO-URL]`, `[DEMO-URL]`, `[DR1-DOI]` and `[IDEA-NOTE-URL]` placeholders
      are replaced, in the form and in the repository (`grep -rn "\[LIVE-URL\]\|\[REPO-URL\]\|\[DEMO-URL\]" .`).

### Demo

- [ ] Video is 30 seconds or less (check the file's duration, not the editor's timeline), or the
      deck is seven slides or fewer including the title and intro slides.
- [ ] English, on screen and in any voice-over. English subtitles if there is speech.
- [ ] It shows the real tool on real data. Anything recorded on the synthetic sky is labelled
      "synthetic data" on screen.
- [ ] No persons under 18 appear. No NASA logos. No AI-generated imagery without a visible
      watermark.
- [ ] Every caption that states a number matches what the tool showed in that recording.

### Content

- [ ] Every form field is filled. The written submission stands on its own without the video.
- [ ] No `[RESULT: ...]` text remains in the form. Each result quoted was measured on real data
      and is recorded in `docs/SCIENCE.md`.
- [ ] No `(verify)` remains next to a fact quoted in the form: the DOIs, the Explanatory Supplement
      title, the references.
- [ ] NASA Data field lists at least one NASA resource (it lists SPHEREx at IRSA).
- [ ] SI field states that code was AI-generated; source files carry the header; NOTICE says so.
- [ ] The words "not affiliated with or endorsed by NASA" appear; no NASA logo or insignia
      appears anywhere.
- [ ] Limits are stated: pixel size, number of passes, WISE 0855, Planet X faintness, the WISE
      movie not built.
- [ ] Working behaviour and future plans are kept apart in the text.

### Repository

- [ ] `LICENSE` (Apache 2.0) and `NOTICE` are present at the top level.
- [ ] `node --test` passes on the submitted commit.
- [ ] `node tools/build.mjs` produces `dist/tombaugh.html`, and the hosted page is that build.
- [ ] No secrets in the repository (service keys, tokens).
- [ ] The first commit is dated after the event start (14 November 2026, 9 a.m. local time).

### Eligibility and timing

- [ ] **Team size.** Missing Mass has one member. Teams registered at the Universal Event need at
      least two members. Confirm that the team is registered at a local event that accepts a team
      of one, or add a second member before submitting (verify against the 2026 participant
      guide).
- [ ] The design note is dated 13 November, the day before the event. Idea and topic selection
      before the start are allowed; challenge work is not. Confirm that nothing in the submission
      was built before the start (verify against the 2026 participant guide).
- [ ] Submitted before the deadline in the local event's time zone (verify the exact deadline in
      the 2026 guide). The form was saved and the confirmation seen.
- [ ] Re-read the 2026 guide once more for format, language and length limits before pressing
      submit.

### Award fit

The finished evidence decides. Best Use of Science if the Gaia comparison and the validation table
are filled with real measurements. Best Use of Data if the strongest part is the transformation of
SPHEREx exposures (per-pixel wavelength, predicted-sky subtraction). Best Use of Technology if the
strongest part is the delivery (trimmed frames, in-browser science, one file, embeddable).
