# Submission text

Ready-to-paste text for each field of the NASA Space Apps 2026 project form, followed by a
checklist. The text blocks are finished and no placeholder is left. The demo link below works
now; a second one, for the video, works once the page is live on batch-ly.com.

Every number in the blocks is quoted from [docs/RESULTS.md](RESULTS.md), the record of the run on real
SPHEREx data of 15 November 2026.

---

## Project Name

```
Tombaugh
```

Tagline, if the form has room for one: `A blink comparator for the 102-color sky`

---

## High-Level Project Summary

*What did you develop, how does it address the challenge, why is it important. (184 words.)*

```
Tombaugh is a public web tool that turns the SPHEREx all-sky infrared survey into a blink comparator. Enter a position or a name and it plays the SPHEREx images of that patch as a short movie, so that objects which move or change brightness stand out.

SPHEREx never images a patch in the same colour twice. A filter that varies across each detector gives every exposure a different wavelength, so a plain movie flickers because the colour changed, not the sky. Tombaugh fits a smooth spectrum to every pixel, predicts what the unchanging sky should look like in each frame, and shows what is left. It then measures the motion and sets it beside Gaia's value, so the tool checks itself.

On real SPHEREx data it measured all five challenge targets, and all 34 comparisons with catalogues agree within 3 sigma. It also follows Pluto, the object Clyde Tombaugh found with a blink comparator, across 225 exposures.

A survey that revisits the whole sky every six months is a search for anything nearby that moves. Tombaugh opens that search to anyone with a browser.
```

---

## Link to Project Demo

```
https://github.com/IshiakiZ/Batchly-Public/blob/claude/tombaugh/apps/tombaugh/docs/demo/tombaugh-slides.pdf
```

The form asks for a video of 30 seconds or less, or seven slides, in English, at a public link.
Both are ready in [demo/](demo/), made from captures of the live tool on real data.

- **The seven slides** (the link above): the PDF's GitHub page opens in a browser without
  sign-in. It works now.
- **The 30-second video**: `https://batch-ly.com/tombaugh/demo.mp4`. The file sits beside the
  page in the site's `public/tombaugh/` folder, so this link works as soon as the page is live
  on batch-ly.com. Prefer it once it opens. The same file can also be uploaded to any video
  host.

Shot list and notes: [DEMO-SCRIPT.md](DEMO-SCRIPT.md).

---

## Link to Final Project

```
https://github.com/IshiakiZ/Batchly-Public/tree/claude/tombaugh/apps/tombaugh
```

The code is in the folder `apps/tombaugh` of the repository
`https://github.com/IshiakiZ/Batchly-Public`, on the branch `claude/tombaugh` until it is merged.
Its README opens with the link to the live tool, `https://batch-ly.com/tombaugh/index.html`. If
the form allows only one link and a working tool is preferred over source, use the live tool here
and keep the repository link in the first lines of the detailed description.

---

## Detailed Project Description

*What it does, how it works, benefits, what you hope to achieve, tools and languages used. (About
1,040 words. If the form allows fewer, cut the list of views first, then BENEFITS.)*

```
Live tool: https://batch-ly.com/tombaugh/index.html
Pluto, followed: https://batch-ly.com/tombaugh/index.html?body=pluto
Source code: https://github.com/IshiakiZ/Batchly-Public/tree/claude/tombaugh/apps/tombaugh

WHAT IT DOES

Tombaugh is a web page. Type sky coordinates (RA and Dec) or an object name, choose a field of view from 2 to 10 arcminutes, and it shows the SPHEREx images of that patch as a movie. A five-target tour covers the challenge's test objects: Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae and R Draconis.

It opens on the whole sky: SPHEREx's own all-sky map, which you drag to look around and scroll to zoom, with sharper pictures loading as you go in. The stars have depth: while the view moves, near stars slide against far ones by their real distances. Click any star, or pick a name from the list in the search box, and the tool opens that spot (a "Solar system" button lists Pluto and thirteen other bodies to follow instead). Simple mode shows the photos with a Play button, a switch between "Photos", "What changed" and "In colour", a few small tools, and short answers in everyday words (is it moving, how fast, did its brightness change). One button opens Advanced mode, the full console described below. Each entry in its list of changes is named only after that spot has been measured, so the list says "moved" only for something that measured as moving. Simple mode measures nothing of its own; each answer is Advanced mode's verdict reworded.

Advanced mode offers several ways to look at the same patch:
- Exposures: every exposure in time order. This is the simple movie, and it flickers.
- Passes: one stacked image per six-month survey pass, for each of the six detectors.
- Matched: only exposures at nearly the same wavelength, one image per pass.
- Residual: each frame minus the sky predicted for it.
- Add or subtract any two passes.
- Molecule lenses: colour the field by the depth of the methane, water, CO2 or CO absorption band.
- Distance dial: shift the frames by the parallax a body at a chosen distance would show, and stack.
- Follow body: name a solar-system body and the frames are stacked in its own frame, so the body holds still and the stars streak.

Click anywhere for a spectrum and a light curve. Gaia DR3 stars are drawn as rings at their catalogue positions; a fast-moving star has left its ring. A motion meter shows the proper motion Tombaugh measures beside Gaia's. A Candidates tab lists what changed in the field, with no catalogue input. A Validation tab measures the five challenge targets against catalogues with one button. Pixel flags can be overlaid. The whole view is stored in the URL, so any view can be shared or embedded in another page. A "fog of war" sky map shows which patches anyone has opened in Tombaugh, and offers one nobody has.

HOW IT WORKS

SPHEREx has a linear variable filter above each detector, so the wavelength a pixel records depends on its position. A patch of sky is seen at a different wavelength in every exposure. Blink those exposures and every star changes brightness because the colour changed. And a SPHEREx pixel is 6.15 arcseconds, while even Barnard's Star moves only about 5 arcseconds between passes.

Tombaugh's answer is predicted-sky subtraction. All exposures are resampled onto one north-up grid. For each pixel, a smooth curve of brightness against wavelength is fitted through all exposures of one detector. For each frame, the curve predicts what a static sky would give at the wavelengths that frame saw. Subtract, and a constant star cancels; a star that moved leaves a bright and dark pair; a star that varied leaves a pulse. Centroids in each pass give a proper motion, which is compared with Gaia. Stars that saturate the detector are measured from their unsaturated wings and listed as one candidate that moved, brightened or faded.

A small proxy does the data work. It reads NASA's public SPHEREx bucket on AWS Open Data, using our own index of every exposure in it: 272,963 exposures. For a position, the index says which exposures cover it. The proxy then reads only the rows it needs from each 65 MB file, attaches a wavelength to every pixel, and caches the result. The NASA/IPAC Infrared Science Archive (IRSA) services are the fallback. All science and drawing happen in the browser. A new week of data needs an index update and no code change.

RESULTS ON REAL DATA

Measured by the tool itself, in a browser, on SPHEREx Data Release 1 and Quick Release 3, on 15 November 2026. All five challenge targets were measured, and all 34 comparisons with catalogues agree within 3 sigma.

- Barnard's Star: 11903 ± 2426 mas/yr at 355 degrees. Gaia: 10380 mas/yr at 356 degrees.
- Epsilon Indi Ba,Bb: 4511 ± 648 mas/yr. Catalogue: 4635 mas/yr. Methane band depth 0.600 ± 0.002.
- WISE 0855-0714: 8016 ± 1249 mas/yr. Catalogue: 8169 mas/yr.
- RW Aurigae: brightness ×1.397 ± 0.041 (11.0 sigma) between September 2025 and March 2026.
- R Draconis: brightness ×0.717 ± 0.056 (4.3 sigma) between March and April 2026.

Field stars that should not move show zero motion within the error in every field, and they land within 0.3 arcseconds of where Gaia puts them. With no catalogue input, every challenge target is the top entry in its own field's candidate list (the only one in four of the five fields), and nine empty control fields list nothing. Bodies planted in the real frames of an empty field give the search's reach: a body at 500 AU is recovered half of the time at 51 microjansky, about twice as bright as a Neptune-size planet there would be. Pluto, followed across 225 exposures, gives a spectrum from 0.76 to 4.97 micrometres with methane-ice bands at 0.89, 1.16, 1.38, 1.72, 2.3 and 3.3 micrometres.

Limits: motions under about 1 arcsecond per year cannot be seen with this pixel size and time span. The two saturated stars are less certain than their formal errors. Nine control fields are a tiny part of the sky. No new object is claimed.

BENEFITS

Anyone can inspect SPHEREx time-domain data without installing software or learning the file format. The tool states its limits and shows how far to trust it by comparing its measurements with Gaia. Teachers get a working demonstration of proper motion, parallax and molecular absorption from current mission data.

WHAT WE HOPE TO ACHIEVE

A real Planet X is probably too faint for SPHEREx, and we say so. What Tombaugh can do is make the search concrete, find the nearby fast movers and variables that SPHEREx does detect, and be ready for each new pass.

Not built: the planned 16-year movie joining SPHEREx to WISE. Tombaugh links to WiseView instead.

TOOLS

JavaScript (ES modules), HTML, CSS, Canvas, WebGL and SVG. No third-party code libraries: the science, the data path and the glass look of the controls are all the project's own code. Node.js for tests and the build. A serverless edge function (Deno runtime) with object storage for the proxy, cache and index. Data from NASA's SPHEREx bucket and IRSA, Gaia DR3, JPL Horizons and CDS. Astropy was used to check the code, not to run it. Code written by an AI model (Claude) under the team owner's direction; see the SI field. Licensed under Apache 2.0.

Tombaugh is not affiliated with or endorsed by NASA.
```

---

## Use of Super Intelligence (SI)

*Did you use SI tools, and how.*

```
Yes.

The idea is human. The concept and its five ideas (predicted-sky subtraction, a distance dial, molecule lenses, a SPHEREx-plus-WISE movie, and a "fog of war" sky map) are the team owner's own, written in their design note "Tombaugh: a blink comparator for the 102-color sky" on 13 November 2026. SI was not the source of the idea.

All source code and tests were generated by Claude (an AI model made by Anthropic, used through Claude Code), under the team owner's direction and review. This is stated in a header at the top of every source file, in the repository's NOTICE and README, and in docs/AI-USE.md.

SI also helped research public documentation and draft the project text, which the team owner reviewed.

No SI-generated images or video are used. One piece of SI-generated audio: on the live page the Guided tour and the five target tours are read aloud by an SI voice (ElevenLabs text to speech), reading the tour's own captions; all other sound is licensed recordings or made by ordinary code. The demo is a screen recording of the live tool. The tool itself contains no AI model: everything on screen is computed from archive data by readable code. No NASA branding appears anywhere.
```

---

## NASA Data

*Specific NASA data and resources used. At least one is required.*

```
1. SPHEREx Level 2 spectral images (calibrated single exposures), NASA/IPAC Infrared Science Archive (IRSA). Releases: Data Release 1, DOI 10.26131/IRSA678, and Quick Release 3, DOI 10.26131/IRSA662.
https://irsa.ipac.caltech.edu/Missions/spherex.html
Use: this is the only image data in the tool. Every movie frame, stack, residual image, spectrum and light curve is computed from the image, flags, variance and zodiacal-light layers of these files and from their per-pixel wavelength table.

2. NASA's public SPHEREx bucket on AWS Open Data (nasa-irsa-spherex), which holds the same Level 2 files.
https://nasa-irsa-spherex.s3.amazonaws.com
Use: the normal data path. The tool keeps its own index of the 272,963 exposures in the bucket and reads only the rows it needs from each file.

3. JPL Horizons (NASA/JPL Solar System Dynamics).
https://ssd.jpl.nasa.gov/api/horizons.api
Use: where a solar-system body was at each moment, so that the tool can find the exposures that caught it and follow it. Used for Pluto.

4. IRSA Table Access Protocol service (tables spherex.artifact and spherex.plane) and IRSA image cutout service for SPHEREx files.
https://irsa.ipac.caltech.edu/TAP/sync
Use: the fallback when the bucket or the index cannot answer.

5. IRSA SPHEREx tutorial notebooks.
https://caltech-ipac.github.io/irsa-tutorials/spherex/
Use: consulted to understand the file layout, the archive query and the wavelength lookup. No code was copied.

6. SPHEREx Explanatory Supplement (IRSA).
https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf
Use: meaning of the image layers, pixel flags, units and the spectral coordinate system.

7. NASA Space Apps 2026 challenge statement "Planet X and SPHEREx".
Use: requirements, the five test targets and the coordinates of WISE 0855.
```

The DOIs and the Explanatory Supplement link were read from IRSA's own pages on 15 November 2026.
The validation run used both releases: 450 exposures from Data Release 1 and 76 from Quick
Release 3.

---

## Space Agency Partner Data and Other References

*All data, resources, tools, code, text and images, even if open source.*

```
SPACE AGENCY PARTNER DATA
- Gaia Data Release 3 (European Space Agency; Gaia Data Processing and Analysis Consortium): source positions at epoch 2016.0, proper motions, parallaxes and G magnitudes. Queried from the ESA Gaia archive (https://gea.esac.esa.int/archive/), with VizieR (catalogue I/355/gaiadr3) and IRSA as fallbacks. Use: overlay rings, and the reference proper motion against which Tombaugh's measurement is compared. The challenge lists Gaia DR3 at https://archive.stsci.edu/missions-and-data/gaia
- Canadian Space Agency resources listed with the challenge (NEOSSat, Canadian Astronomy Data Centre) were not used.

OTHER DATA SERVICES
- CDS Sesame name resolver and the SIMBAD database (CDS, Strasbourg): object names to coordinates and proper motions, and the catalogued objects near a clicked position.
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
- Standish (JPL), "Keplerian Elements for Approximate Positions of the Major Planets": an independent check of the Earth position in the tests.
- ESA 1997, "The Hipparcos and Tycho Catalogues", ESA SP-1200: the standard model of stellar motion.
- Bertin & Arnouts 1996, A&AS 117, 393: definition of the windowed centroid (SExtractor itself is not used).
- King 1983, PASP 95, 163; Condon 1997, PASP 109, 166: centroid error estimate.
- The CFITSIO Rice algorithm and the FITS tile-compression convention: reading the compressed flag layer (the CFITSIO library itself is not used).
- IVOA TAP, ADQL and UWS recommendations: archive query protocols.
- Gaia Collaboration, Prusti et al. 2016, A&A 595, A1; Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1.
- Wenger et al. 2000, A&AS 143, 9: SIMBAD.
- Kuchner et al. 2017, ApJL 841, L19: Backyard Worlds: Planet 9.
- Luhman 2014, ApJL 786, L18: WISE 0855-0714.
- Scholz et al. 2003, A&A 398, L29; McCaughrean et al. 2004, A&A 413, 1029: Epsilon Indi B.
- Batygin & Brown 2016, AJ 151, 22: the distant-planet hypothesis.
- Dore et al. 2014, arXiv:1412.4872: the SPHEREx mission concept.
- Tombaugh 1946, Astronomical Society of the Pacific Leaflets 5, 73: the search for Pluto.

THE IDEA
- Harshbarger, P., "Tombaugh: a blink comparator for the 102-color sky", design note, 13 November 2026 (the team owner's own).

CODE
- No third-party code library is bundled. All code in the repository was generated for this project. It was generated by Claude (Anthropic) under the team owner's direction, as described in the SI field. The "viridis" colour scale is nine samples of the matplotlib colour map of that name (CC0).

TOOLS
- Node.js (tests, build, development server). Supabase Edge Functions on the Deno runtime, and Supabase Storage (proxy, cache and index). Playwright (browser test during development). Astropy and numpy (independent check of the code during development; not bundled). Git and GitHub. Claude Code with Claude Fable 5.2.

IMAGES, VIDEO, TEXT
- No third-party images. All graphics are rendered by the tool from SPHEREx data or drawn by code. The screenshots in the repository are captures of the tool on real data. The demo is a screen recording of the tool. No NASA logos or insignia are used. Project text was drafted with AI assistance and reviewed by the team owner.

The full list with links is in docs/SOURCES.md in the repository.
```

The bibliographic details of the papers are given from memory and were not re-opened during the
hackathon; [SOURCES.md](SOURCES.md) says so. The data services and DOIs were checked against the
live services on 15 November 2026.

---

## Pre-submission checklist

### For the team lead: only they can do these

- [x] **Demo made.** `docs/demo/tombaugh-demo.mp4` (29.6 s) and `docs/demo/tombaugh-slides.pdf`
      (seven slides), from captures of the live tool.
- [ ] **Paste the demo link.** The slides link in the block above works now. Once
      `https://batch-ly.com/tombaugh/demo.mp4` opens, use that for the video.
- [ ] **Confirm the live URL opens signed out.** Open
      `https://batch-ly.com/tombaugh/index.html` in a private browser window, on a phone and on a
      laptop.
- [ ] **Confirm team eligibility.** Teams registered at the Universal Event need two or more
      members. Missing Mass has two: Pearce Harshbarger and Reese Harshbarger. Before submitting,
      make sure Reese has registered on the Space Apps site and joined the team there.
- [ ] **Confirm the AI disclosure is complete.** If any other AI tool was used, for example a
      synthetic voice in the video, add it to the SI field and to [AI-USE.md](AI-USE.md).

### Links

- [ ] From a private window: the first screen loads, one tour target loads real SPHEREx frames,
      the movie plays, the residual view shows, a click gives a spectrum.
- [ ] `https://batch-ly.com/tombaugh/index.html?body=pluto` loads Pluto and shows its spectrum.
- [ ] The landing page a judge sees shows Tombaugh only. No promotion of a commercial product or
      service on the page or around it.
- [ ] The repository link is public and opens in a private window. README renders, including the
      diagrams and the screenshots.
- [ ] The demo link is public (not "unlisted to signed-in users", not a share link that expires)
      and plays in a private window without sign-in.
- [ ] Every link pasted into the form was clicked after pasting.

### Demo

- [ ] Video is 30 seconds or less (check the file's duration, not the editor's timeline), or the
      deck is seven slides or fewer including the title and intro slides.
- [ ] English, on screen and in any voice-over. English subtitles if there is speech.
- [ ] It shows the real tool on real data. Anything recorded on the practice sky is labelled
      "simulated" on screen.
- [ ] No persons under 18 appear. No NASA logos. No AI-generated imagery without a visible
      watermark.
- [ ] Every caption that states a number matches what the tool showed in that recording.

### Content

- [ ] Every form field is filled. The written submission stands on its own without the video.
- [ ] Every number quoted in the form is in `docs/RESULTS.md`.
- [ ] Every DOI and link quoted in the form matches `docs/SOURCES.md`.
- [ ] NASA Data field lists at least one NASA resource (it lists SPHEREx, the public bucket and
      JPL Horizons).
- [ ] SI field states that code was AI-generated; source files carry the header; NOTICE says so.
- [ ] The words "not affiliated with or endorsed by NASA" appear; no NASA logo or insignia
      appears anywhere.
- [ ] Limits are stated: pixel size, number of passes, saturated stars, Planet X faintness, no new
      object claimed, the WISE movie not built.
- [ ] Working behaviour and future plans are kept apart in the text.

### Repository

- [ ] `LICENSE` (Apache 2.0) and `NOTICE` are present at the top level.
- [ ] `NOTICE` lists the same DOIs as `docs/SOURCES.md` (Data Release 1 10.26131/IRSA678, Quick
      Release 3 10.26131/IRSA662).
- [ ] `node --test` passes on the submitted commit (1063 tests at the time of writing).
- [ ] `node tools/build.mjs` produces `dist/tombaugh.html`, and the hosted page is that build.
- [ ] No secrets in the repository (service keys, tokens).
- [ ] The first commit is dated after the event start (14 November 2026, 9 a.m. local time).

### Eligibility and timing

- [ ] The design note is dated 13 November, the day before the event. Idea and topic selection
      before the start are allowed; challenge work is not. Confirm against the 2026 participant
      guide that nothing in the submission was built before the start.
- [ ] Submitted before the deadline in the local event's time zone; check the exact deadline in
      the 2026 guide. The form was saved and the confirmation seen.
- [ ] Re-read the 2026 guide once more for format, language and length limits before pressing
      submit.

### Award fit

The evidence is in [docs/RESULTS.md](RESULTS.md). Best Use of Science rests on the Gaia comparison and
the validation table: five of five targets, 34 comparisons within 3 sigma, null tests zero within
error. Best Use of Data rests on the transformation of SPHEREx exposures (per-pixel wavelength,
predicted-sky subtraction, Pluto's spectrum from 225 exposures). Best Use of Technology rests on
the delivery (an index of 272,963 exposures, trimmed frames, in-browser science, one file,
embeddable).
