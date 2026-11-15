# Sources

Everything Tombaugh uses or relies on: data, services, standards, papers, tools, and the idea
itself. Open-source and public-domain material is listed too.

**Status of this list.** The data sources, services and DOIs were checked against the live
services on 15 November 2026. Bibliographic details of the papers are given from memory and were
not re-opened during the hackathon. "Given" marks a link that comes from the challenge statement
or from a real request recorded in [CONTRACT.md](../CONTRACT.md).

## 1. NASA data and resources

| # | Resource | How Tombaugh uses it | Link | Status |
|---|---|---|---|---|
| N1 | **SPHEREx Level 2 spectral images** (calibrated single exposures, six detectors), NASA/IPAC Infrared Science Archive | The only image data in the tool. Every movie frame, stack, residual, spectrum and light curve is computed from these files: the IMAGE, FLAGS, VARIANCE and ZODI layers and the WCS-WAVE wavelength table | <https://irsa.ipac.caltech.edu/Missions/spherex.html> | checked 2026-11-15 |
| N2 | SPHEREx Data Release 1 spectral images, DOI 10.26131/IRSA678 | Citation for `dr1` frames | <https://doi.org/10.26131/IRSA678>; release page <https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html> | checked 2026-11-15 |
| N3 | SPHEREx Quick Release 3 spectral images, DOI 10.26131/IRSA662 | Citation for `qr3` frames | <https://doi.org/10.26131/IRSA662>; release page <https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html> | checked 2026-11-15 |
| N4 | Earlier quick releases: QR1, DOI 10.26131/IRSA629; QR2, DOI 10.26131/IRSA652 | Held in the tool's DOI table so that a frame from them would be cited correctly. No QR1 or QR2 frame was used in the recorded run | <https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html> | checked 2026-11-15 |
| N5 | **NASA's public SPHEREx bucket on AWS Open Data** (`nasa-irsa-spherex`), the same Level 2 files | The normal data path. The proxy lists the bucket to build its exposure index (272,963 exposures in 273 index units) and reads the rows it needs from each file with HTTP Range requests | <https://nasa-irsa-spherex.s3.amazonaws.com> | checked 2026-11-15 |
| N6 | **IRSA TAP service** (tables `spherex.artifact`, `spherex.plane`) | Fallback search: finds every Level 2 file whose footprint contains a position when the exposure index cannot answer | <https://irsa.ipac.caltech.edu/TAP/sync> | given |
| N7 | **IRSA cutout service** for SPHEREx files (`?center=<ra>,<dec>d&size=<deg>`) | Fallback for cutouts when the bucket fails | `https://irsa.ipac.caltech.edu/<uri>` | given |
| N8 | **JPL Horizons** (NASA/JPL Solar System Dynamics), API | Where a solar-system body was at each moment, for the "Follow body" view (`?body=pluto`). Geocentric positions | <https://ssd.jpl.nasa.gov/api/horizons.api> | checked 2026-11-15 |
| N9 | IRSA SPHEREx tutorial notebooks | Read to learn the file layout, the archive query and the wavelength lookup. No code was copied | <https://caltech-ipac.github.io/irsa-tutorials/spherex/> | given |
| N10 | "SPHEREx Explanatory Supplement", IRSA | Meaning of the layers, flag bits, units and the spectral WCS | <https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf> | checked 2026-11-15 |
| N11 | IRSA copy of the Gaia DR3 source table (`gaia_dr3_source`) | Third fallback for the Gaia cone search | <https://irsa.ipac.caltech.edu/TAP/sync> | given |
| N13 | **SPHEREx DR1 all-sky data cube**, HiPS (`ivo://IPAC/P/SPHEREx/DR1/cube`; SPHEREx Science Data Center, Caltech/IPAC; NASA/SPHEREx), served by IRSA | The picture of the whole sky on the Simple-mode start page: the overview image and tiles of orders 3 to 5, first plane of the cube, loaded as images by the browser | <https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube/> | checked 2026-11-15 |
| N14 | **2MASS colour mosaic**, HiPS (`CDS/P/2MASS/color`, built by CDS from the Two Micron All Sky Survey), IRSA mirror | Sharper pictures on the start page when zoomed in past what the SPHEREx map resolves (tile orders 6 to 9), shown in grey | <https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color/> | checked 2026-11-15 |
| N12 | NASA Space Apps Challenge 2026, challenge statement "Planet X and SPHEREx", and the 2026 participant guide | Requirements, test targets, submission rules | no link recorded | given |

Acknowledgement: "This research has made use of the NASA/IPAC Infrared Science Archive, which is
funded by the National Aeronautics and Space Administration and operated by the California
Institute of Technology."

## 2. Space agency partner data

| # | Resource | How Tombaugh uses it | Link | Status |
|---|---|---|---|---|
| P1 | **Gaia Data Release 3**, `gaia_source` (ESA / Gaia / DPAC): positions at epoch 2016.0, proper motions, parallaxes, G magnitudes | Rings at catalogue positions; the reference proper motion in the motion meter and the Validation tab; the track a star should follow; the field-star controls; the blend check | ESA Gaia archive, <https://gea.esac.esa.int/archive/>; TAP endpoint `https://gea.esac.esa.int/tap-server/tap/sync` | checked 2026-11-15 |
| P2 | Gaia DR3 as listed in the challenge resources (MAST) | Listed by the challenge. Tombaugh queries the ESA archive and its mirrors, not MAST | <https://archive.stsci.edu/missions-and-data/gaia> | given |

The challenge also lists Canadian Space Agency resources (NEOSSat pages and data, the Canadian
Astronomy Data Centre). Tombaugh does not use them.

Acknowledgement: "This work has made use of data from the European Space Agency (ESA) mission
Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis
Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has
been provided by national institutions, in particular the institutions participating in the Gaia
Multilateral Agreement."

## 3. Other data services

| # | Resource | How Tombaugh uses it | Link | Status |
|---|---|---|---|---|
| S1 | **CDS Sesame** name resolver | Turns an object name into coordinates | `https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV` | checked 2026-11-15 |
| S2 | **SIMBAD** astronomical database, CDS (TAP at `https://simbad.cds.unistra.fr/simbad/sim-tap/sync`) | Fallback for name resolution; proper motion and parallax of named objects; the catalogued objects near a clicked position ("What is this?"). The tool also links to SIMBAD | <https://simbad.cds.unistra.fr/simbad/> | checked 2026-11-15 |
| S3 | **VizieR** TAP service, CDS, catalogue `I/355/gaiadr3` | Second fallback for the Gaia cone search | `https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync` | fallback, not checked separately |
| S5 | **d3-celestial** data files (`stars.6.json`, `starnames.json`, `constellations.lines.json`), Olaf Frohn, BSD 3-Clause licence; positions from the Hipparcos catalogue (ESA 1997) | The 5,044 bright stars, 468 proper names and constellation figures drawn on the start page and listed in the search box. Reduced to `web/src/sky/stardata.js` by `tools/make-sky-data.mjs`; the licence text is in that file and in NOTICE. No d3-celestial code is used | <https://github.com/ofrohn/d3-celestial> | fetched 2026-11-15 |
| S4 | **WiseView** (Backyard Worlds: Planet 9) | The model for a blink tool. Tombaugh links to it at the same coordinates for WISE epochs. No WiseView code or data is included | <http://byw.tools/wiseview> | given |

A built-in table holds approximate coordinates and proper motions for the five challenge targets,
used when the name services do not answer. Its values come from the challenge statement (WISE
0855) and from rounded catalogue values typed in by hand; the response is labelled "builtin
(approximate)". The Validation tab does not rely on it for the stars: it reads Gaia DR3 at run
time, and uses published values for the two brown dwarfs, which Gaia does not list.

## 4. Standards and methods

| # | Reference | Used for | Status |
|---|---|---|---|
| M1 | Pence, W. D., et al. 2010, "Definition of the Flexible Image Transport System (FITS), version 3.0", A&A 524, A42. doi:10.1051/0004-6361/201015362 | The FITS reader in the proxy | standard reference |
| M2 | Greisen, E. W., & Calabretta, M. R. 2002, "Representations of world coordinates in FITS", A&A 395, 1061. doi:10.1051/0004-6361:20021326 | WCS keywords, PC matrix | standard reference |
| M3 | Calabretta, M. R., & Greisen, E. W. 2002, "Representations of celestial coordinates in FITS", A&A 395, 1077. doi:10.1051/0004-6361:20021327 | Gnomonic (TAN) projection and its inverse | standard reference |
| M4 | Greisen, E. W., Calabretta, M. R., Valdes, F. G., & Allen, S. L. 2006, "Representations of spectral coordinates in FITS", A&A 446, 747. doi:10.1051/0004-6361:20053818 | The `-TAB` lookup convention used by the per-pixel wavelength WCS | standard reference |
| M5 | Shupe, D. L., et al. 2005, "The SIP Convention for Representing Distortion in FITS Image Headers", ASP Conf. Ser. 347 (ADASS XIV), 491 | SIP distortion polynomials, forward and inverse | standard reference |
| M6 | Gorski, K. M., et al. 2005, "HEALPix: A Framework for High-Resolution Discretization and Fast Analysis of Data Distributed on the Sphere", ApJ 622, 759. doi:10.1086/427976 | Nested HEALPix indexing at nside 32 for the fog-of-war map. Implemented from the paper; the HEALPix library is not used | standard reference |
| M7 | IVOA Table Access Protocol (TAP), Astronomical Data Query Language (ADQL) and Universal Worker Service (UWS) recommendations | Archive queries, synchronous and asynchronous | standard reference |
| M8 | Standard results used without a specific source: inverse-variance weighted means, sigma clipping, median absolute deviation as a robust scale (sigma = 1.4826 MAD), weighted polynomial least squares, flux-weighted centroids, the Mollweide projection, Keplerian circular-orbit speed | Stacking, the sky model, astrometry, the sky map, the distance dial | n/a |
| M9 | Bretagnon, P., & Francou, G. 1988, "Planetary theories in rectangular and spherical variables. VSOP 87 solutions", A&A 202, 309 | Position of the Earth, from a truncated VSOP87D series, for parallax and the distance dial (`web/src/core/ephemeris.js`) | standard reference |
| M10 | Meeus, J. 1998, "Astronomical Algorithms", 2nd ed., Willmann-Bell: Appendix III (the truncated VSOP87 term list), chapter 21 (ecliptic precession), eq. 17.2 (position angle), worked example 25.b (used as a test value) | The coefficient table and formulae transcribed into `ephemeris.js` and `astrometry.js` | standard reference |
| M11 | ESA 1997, "The Hipparcos and Tycho Catalogues", ESA SP-1200, vol. 1, section 1.5.5 | The standard model of stellar motion used to move Gaia positions to the observation date | standard reference |
| M12 | Bertin, E., & Arnouts, S. 1996, "SExtractor: Software for source extraction", A&AS 117, 393 | The windowed centroid follows the definition of XWIN/YWIN. SExtractor itself is not used | standard reference |
| M13 | King, I. R. 1983, PASP 95, 163; Condon, J. J. 1997, PASP 109, 166 | Rule-of-thumb centroid error, 0.6 FWHM / SNR | standard reference |
| M14 | Vincenty's formula for angular separation; the IAU 1958 galactic coordinate system with the J2000 pole as defined for Hipparcos; IAU 1976 obliquity and precession constants | Separations; the galactic plane and ecliptic lines on the sky map | standard reference |
| M15 | Standish, E. M. (JPL), "Keplerian Elements for Approximate Positions of the Major Planets" | An independent check of the Earth position in `ephemeris.test.js`: a Kepler orbit from these elements agrees with `ephemeris.js` to 2.5e-4 AU, the accuracy of the elements. The same test file checks one Earth vector for J2000.0 attributed to JPL Horizons, quoted from memory to five figures, with a tolerance of 2e-4 AU. No live Horizons comparison of the Earth position was run. Separately, the Earth position agrees with ERFA (through Astropy) to 1.6e-6 AU ([CROSSCHECK.md](CROSSCHECK.md)) | standard reference |
| M16 | The CFITSIO Rice algorithm (`fits_rdecomp`, `fits_rcomp`) and the FITS tile-compression convention | Reading the tile-compressed FLAGS layer of the full Level 2 files (`proxy/src/rice.js`), which follows the CFITSIO algorithm. The CFITSIO library itself is not used. Checked against the Rice codec inside Astropy ([CROSSCHECK.md](CROSSCHECK.md)) | standard reference |

## 5. Background papers

| # | Reference | Why it is here | Status |
|---|---|---|---|
| B1 | Dore, O., et al. 2014, "Cosmology with the SPHEREX All-Sky Spectral Survey", arXiv:1412.4872 | Mission concept, the linear variable filter design | standard reference |
| B2 | Gaia Collaboration, Prusti, T., et al. 2016, "The Gaia mission", A&A 595, A1. doi:10.1051/0004-6361/201629272 | Gaia citation | standard reference |
| B3 | Gaia Collaboration, Vallenari, A., et al. 2023, "Gaia Data Release 3: Summary of the content and survey properties", A&A 674, A1. doi:10.1051/0004-6361/202243940 | Gaia DR3 citation | standard reference |
| B4 | Wenger, M., et al. 2000, "The SIMBAD astronomical database", A&AS 143, 9. doi:10.1051/aas:2000332 | SIMBAD citation | standard reference |
| B5 | Caselden, D., et al. 2018, "WiseView: Visualizing motion and variability of faint WISE sources", Astrophysics Source Code Library, ascl:1806.004 | WiseView citation | standard reference |
| B6 | Kuchner, M. J., et al. 2017, "The First Brown Dwarf Discovered by the Backyard Worlds: Planet 9 Citizen Science Project", ApJL 841, L19. doi:10.3847/2041-8213/aa7200 | Backyard Worlds, the project WiseView serves | standard reference |
| B7 | Luhman, K. L. 2014, "Discovery of a ~250 K Brown Dwarf at 2 pc from the Sun", ApJL 786, L18. doi:10.1088/2041-8205/786/2/L18 | WISE 0855-0714 | standard reference |
| B8 | Scholz, R.-D., et al. 2003, "epsilon Indi B: A new benchmark T dwarf", A&A 398, L29; McCaughrean, M. J., et al. 2004, "epsilon Indi Ba,Bb: The nearest binary brown dwarf", A&A 413, 1029 | Epsilon Indi B | standard reference |
| B9 | Batygin, K., & Brown, M. E. 2016, "Evidence for a Distant Giant Planet in the Solar System", AJ 151, 22. doi:10.3847/0004-6256/151/2/22 | The modern Planet X hypothesis; context for the distance dial and for the statement that such a body is probably too faint for SPHEREx | standard reference |
| B10 | Tombaugh, C. W. 1946, "The Search for the Ninth Planet, Pluto", Astronomical Society of the Pacific Leaflets 5, 73 | The blink-comparator search the tool is named after | standard reference |

## 6. Software and tools

**No third-party code libraries are bundled; all code in the repository was generated for this
project.** There are no npm dependencies and no CDN imports. Astropy is used only as an
independent check during development. Aladin is not used.

| # | Tool | Role | Link |
|---|---|---|---|
| T1 | Node.js 22 or later | Dev server, unit tests (`node --test`), bundler | <https://nodejs.org/> |
| T2 | Supabase Edge Functions (Deno runtime) and Supabase Storage | Hosting of the proxy, its cache and the exposure index | <https://supabase.com/> |
| T3 | Playwright | End-to-end test of the page in a browser (`test/e2e.mjs`). Development only; not part of the tool and not bundled | <https://playwright.dev/> |
| T4 | Git and GitHub | Source control and public repository (folder `apps/tombaugh`) | <https://github.com/IshiakiZ/Batchly-Public> |
| T5 | Claude (Anthropic) through Claude Code | Wrote all code and tests, researched documentation, drafted text. See [AI-USE.md](AI-USE.md) | <https://www.anthropic.com/> |
| T6 | Web platform APIs: Canvas 2D, SVG, Fetch, Streams, typed arrays, Web Crypto, Web Audio, IndexedDB | Rendering, sound and data handling in the browser and the proxy | n/a |
| T7 | Colour maps. "viridis" in `web/src/render/colormaps.js` is nine samples of the matplotlib colour map of that name (S. van der Walt and N. Smith, released CC0), linearly interpolated. The others are original | Display | <https://matplotlib.org/> |
| T8 | Fonts: Arial, Arial Black, Consolas as installed on the viewer's system | Typography. No font files are distributed | n/a |
| T9 | Astropy (with ERFA and WCSLIB), numpy | Independent cross-check of the FITS reader, world coordinates, wavelength lookup, Rice codec, ephemeris and reprojection: 232 comparisons pass ([CROSSCHECK.md](CROSSCHECK.md)). Development only; not bundled and not needed to run the tool | <https://www.astropy.org/> |

## 7. Images, video and text

- The tool contains no image files. All graphics, including the previews on the landing page, are
  drawn by code at run time. Science images on screen are renderings of SPHEREx data (N1).
- The screenshots in [real/](real/) are captures of the tool showing real SPHEREx data.
- The demonstration video and slides are built from screen captures of the live tool showing
  real SPHEREx data ([demo/](demo/)); the captions and layout are drawn by code
  (`tools/demo/`).
- No NASA logos, insignia or branding are used anywhere.
- All documentation text was drafted with AI assistance and reviewed by the team owner (see
  [AI-USE.md](AI-USE.md)).

## 8. The idea

Harshbarger, P. 2026, "Tombaugh: a blink comparator for the 102-color sky", design note,
13 November 2026. The concept and its five ideas (predicted-sky subtraction, the distance dial,
molecule lenses, the 16-year movie, fog of war) are the team owner's own.

## 9. Citation line shown in the tool

> SPHEREx Level 2 spectral images, DR1, QR3 (NASA/IPAC Infrared Science Archive; DR1 DOI
> 10.26131/IRSA678; QR3 DOI 10.26131/IRSA662), retrieved <date>. Gaia DR3.

The line names the releases of the frames on screen. The DOIs are held in one constant
(`web/src/ui/citation.js`), read from IRSA's release pages on 15 November 2026.
