# Sources

Everything Tombaugh uses or relies on: data, services, standards, papers, tools, and the idea
itself. Open-source and public-domain material is listed too.

**Status of this list.** It was written without network access. Links given in the challenge
statement or recorded in [CONTRACT.md](../CONTRACT.md) from real requests are marked "given".
Bibliographic details and other links written from memory are marked "(verify)" and must be opened
and checked before submission.

## 1. NASA data and resources

| # | Resource | How Tombaugh uses it | Link | Checked |
|---|---|---|---|---|
| N1 | **SPHEREx Level 2 spectral images** (calibrated single exposures, six detectors), NASA/IPAC Infrared Science Archive | The only image data in the tool. Every movie frame, stack, residual, spectrum and light curve is computed from these files: the IMAGE, FLAGS, VARIANCE and ZODI layers and the WCS-WAVE wavelength table | <https://irsa.ipac.caltech.edu/Missions/spherex.html> | given |
| N2 | SPHEREx mission archive at IRSA, DOI 10.26131/IRSA629 | Citation | <https://doi.org/10.26131/IRSA629> | (verify) |
| N3 | SPHEREx Quick Release 3 spectral images, DOI 10.26131/IRSA662 | Citation for `qr3` frames | <https://doi.org/10.26131/IRSA662> | (verify) |
| N4 | SPHEREx Data Release 1 spectral images, DOI [DR1-DOI] | Citation for `dr1` frames | [DR1-DOI] | (verify) |
| N5 | **IRSA TAP service** (tables `spherex.artifact`, `spherex.plane`) | Finds every Level 2 file whose footprint contains a position | <https://irsa.ipac.caltech.edu/TAP/sync> | given |
| N6 | **IRSA cutout service** for SPHEREx files (`?center=<ra>,<dec>d&size=<deg>`) | Retrieves the cutout of each exposure | `https://irsa.ipac.caltech.edu/<uri>` | given |
| N7 | IRSA SPHEREx tutorial notebooks | Read to learn the file layout, the archive query and the wavelength lookup. No code was copied | <https://caltech-ipac.github.io/irsa-tutorials/spherex/> | given |
| N8 | SPHEREx Explanatory Supplement, IRSA (verify title) | Meaning of the layers, flag bits, units and the spectral WCS | (verify URL) | (verify) |
| N9 | IRSA copy of the Gaia DR3 source table (`gaia_dr3_source`) | Third fallback for the Gaia cone search | <https://irsa.ipac.caltech.edu/TAP/sync> | given |
| N10 | NASA Space Apps Challenge 2026, challenge statement "Planet X and SPHEREx", and the 2026 participant guide | Requirements, test targets, submission rules | (verify URL) | (verify) |

Requested acknowledgement for IRSA (verify wording): "This research has made use of the NASA/IPAC
Infrared Science Archive, which is funded by the National Aeronautics and Space Administration and
operated by the California Institute of Technology."

## 2. Space agency partner data

| # | Resource | How Tombaugh uses it | Link | Checked |
|---|---|---|---|---|
| P1 | **Gaia Data Release 3**, `gaia_source` (ESA / Gaia / DPAC): positions at epoch 2016.0, proper motions, parallaxes, G magnitudes | Rings at catalogue positions; the reference proper motion in the motion meter; the track a star should follow | ESA Gaia archive, <https://gea.esac.esa.int/archive/>; TAP endpoint `https://gea.esac.esa.int/tap-server/tap/sync` | (verify) |
| P2 | Gaia DR3 as listed in the challenge resources (MAST) | Listed by the challenge. Tombaugh queries the ESA archive and its mirrors, not MAST | <https://archive.stsci.edu/missions-and-data/gaia> | given |

The challenge also lists Canadian Space Agency resources (NEOSSat pages and data, the Canadian
Astronomy Data Centre). Tombaugh does not use them.

Gaia acknowledgement (verify wording): "This work has made use of data from the European Space
Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing
and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for
the DPAC has been provided by national institutions, in particular the institutions participating
in the Gaia Multilateral Agreement."

## 3. Other data services

| # | Resource | How Tombaugh uses it | Link | Checked |
|---|---|---|---|---|
| S1 | **CDS Sesame** name resolver | Turns an object name into coordinates | `https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV` | (verify) |
| S2 | **SIMBAD** astronomical database, CDS (TAP at `https://simbad.cds.unistra.fr/simbad/sim-tap/sync`) | Fallback for name resolution; proper motion and parallax of named objects. The tool also links to SIMBAD for the objects near a position | <https://simbad.cds.unistra.fr/simbad/> | (verify) |
| S3 | **VizieR** TAP service, CDS, catalogue `I/355/gaiadr3` | Second fallback for the Gaia cone search | `https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync` | (verify) |
| S4 | **WiseView** (Backyard Worlds: Planet 9) | The model for a blink tool. Tombaugh links to it at the same coordinates for WISE epochs. No WiseView code or data is included | <http://byw.tools/wiseview> | given |

A built-in table holds approximate coordinates and proper motions for the five challenge targets,
used when the name services do not answer. Its values come from the challenge statement (WISE
0855) and from memory of SIMBAD and Gaia values (verify each against SIMBAD); the response is
labelled "builtin (approximate)".

## 4. Standards and methods

| # | Reference | Used for | Checked |
|---|---|---|---|
| M1 | Pence, W. D., et al. 2010, "Definition of the Flexible Image Transport System (FITS), version 3.0", A&A 524, A42. doi:10.1051/0004-6361/201015362 | The FITS reader in the proxy | (verify) |
| M2 | Greisen, E. W., & Calabretta, M. R. 2002, "Representations of world coordinates in FITS", A&A 395, 1061. doi:10.1051/0004-6361:20021326 | WCS keywords, PC matrix | (verify) |
| M3 | Calabretta, M. R., & Greisen, E. W. 2002, "Representations of celestial coordinates in FITS", A&A 395, 1077. doi:10.1051/0004-6361:20021327 | Gnomonic (TAN) projection and its inverse | (verify) |
| M4 | Greisen, E. W., Calabretta, M. R., Valdes, F. G., & Allen, S. L. 2006, "Representations of spectral coordinates in FITS", A&A 446, 747. doi:10.1051/0004-6361:20053818 | The `-TAB` lookup convention used by the per-pixel wavelength WCS | (verify) |
| M5 | Shupe, D. L., et al. 2005, "The SIP Convention for Representing Distortion in FITS Image Headers", ASP Conf. Ser. 347 (ADASS XIV), 491 | SIP distortion polynomials, forward and inverse | (verify) |
| M6 | Gorski, K. M., et al. 2005, "HEALPix: A Framework for High-Resolution Discretization and Fast Analysis of Data Distributed on the Sphere", ApJ 622, 759. doi:10.1086/427976 | Nested HEALPix indexing at nside 32 for the fog-of-war map. Implemented from the paper; the HEALPix library is not used | (verify) |
| M7 | IVOA Table Access Protocol (TAP), Astronomical Data Query Language (ADQL) and Universal Worker Service (UWS) recommendations | Archive queries, synchronous and asynchronous | (verify titles and versions) |
| M8 | Standard results used without a specific source: inverse-variance weighted means, sigma clipping, median absolute deviation as a robust scale (sigma = 1.4826 MAD), weighted polynomial least squares, flux-weighted centroids, the Mollweide projection, Keplerian circular-orbit speed | Stacking, the sky model, astrometry, the sky map, the distance dial | n/a |
| M9 | Bretagnon, P., & Francou, G. 1988, "Planetary theories in rectangular and spherical variables. VSOP 87 solutions", A&A 202, 309 | Position of the Earth, from a truncated VSOP87D series, for parallax and the distance dial (`web/src/core/ephemeris.js`) | (verify) |
| M10 | Meeus, J. 1998, "Astronomical Algorithms", 2nd ed., Willmann-Bell: Appendix III (the truncated VSOP87 term list), chapter 21 (ecliptic precession), eq. 17.2 (position angle), worked example 25.b (used as a test value) | The coefficient table and formulae transcribed into `ephemeris.js` and `astrometry.js` | (verify) |
| M11 | ESA 1997, "The Hipparcos and Tycho Catalogues", ESA SP-1200, vol. 1, section 1.5.5 | The standard model of stellar motion used to move Gaia positions to the observation date | (verify) |
| M12 | Bertin, E., & Arnouts, S. 1996, "SExtractor: Software for source extraction", A&AS 117, 393 | The windowed centroid follows the definition of XWIN/YWIN. SExtractor itself is not used | (verify) |
| M13 | King, I. R. 1983, PASP 95, 163; Condon, J. J. 1997, PASP 109, 166 | Rule-of-thumb centroid error, 0.6 FWHM / SNR | (verify) |
| M14 | Vincenty's formula for angular separation; the IAU 1958 galactic coordinate system with the J2000 pole as defined for Hipparcos; IAU 1976 obliquity and precession constants | Separations; the galactic plane and ecliptic lines on the sky map | (verify) |
| M15 | JPL Horizons and JPL's approximate planetary elements (NASA/JPL Solar System Dynamics) | Named in `ephemeris.js` as independent checks of the Earth position (verify that these comparisons were run and how) | (verify) |

## 5. Background papers

| # | Reference | Why it is here | Checked |
|---|---|---|---|
| B1 | Dore, O., et al. 2014, "Cosmology with the SPHEREX All-Sky Spectral Survey", arXiv:1412.4872 | Mission concept, the linear variable filter design | (verify) |
| B2 | A current SPHEREx mission or data-processing overview paper (author, year, journal to be filled) | Detector layout, channels, survey strategy | (verify) |
| B3 | Gaia Collaboration, Prusti, T., et al. 2016, "The Gaia mission", A&A 595, A1. doi:10.1051/0004-6361/201629272 | Gaia citation | (verify) |
| B4 | Gaia Collaboration, Vallenari, A., et al. 2023, "Gaia Data Release 3: Summary of the content and survey properties", A&A 674, A1. doi:10.1051/0004-6361/202243940 | Gaia DR3 citation | (verify) |
| B5 | Wenger, M., et al. 2000, "The SIMBAD astronomical database", A&AS 143, 9. doi:10.1051/aas:2000332 | SIMBAD citation | (verify) |
| B6 | Caselden, D., et al. 2018, "WiseView: Visualizing motion and variability of faint WISE sources", Astrophysics Source Code Library, ascl:1806.004 | WiseView citation | (verify) |
| B7 | Kuchner, M. J., et al. 2017, "The First Brown Dwarf Discovered by the Backyard Worlds: Planet 9 Citizen Science Project", ApJL 841, L19. doi:10.3847/2041-8213/aa7200 | Backyard Worlds, the project WiseView serves | (verify) |
| B8 | Luhman, K. L. 2014, "Discovery of a ~250 K Brown Dwarf at 2 pc from the Sun", ApJL 786, L18. doi:10.1088/2041-8205/786/2/L18 | WISE 0855-0714 | (verify) |
| B9 | Scholz, R.-D., et al. 2003, "epsilon Indi B: A new benchmark T dwarf", A&A 398, L29; McCaughrean, M. J., et al. 2004, "epsilon Indi Ba,Bb: The nearest binary brown dwarf", A&A 413, 1029 | Epsilon Indi B | (verify) |
| B10 | Batygin, K., & Brown, M. E. 2016, "Evidence for a Distant Giant Planet in the Solar System", AJ 151, 22. doi:10.3847/0004-6256/151/2/22 | The modern Planet X hypothesis; context for the distance dial and for the statement that such a body is probably too faint for SPHEREx | (verify) |
| B11 | Tombaugh, C. W. 1946, "The Search for the Ninth Planet, Pluto", Astronomical Society of the Pacific Leaflets 5, 73 | The blink-comparator search the tool is named after | (verify) |

## 6. Software and tools

**No third-party code libraries are bundled; all code in the repository was generated for this
project.** There are no npm dependencies and no CDN imports. Astropy and Aladin, which the
challenge suggests, are not used.

| # | Tool | Role | Link |
|---|---|---|---|
| T1 | Node.js 22 or later | Dev server, unit tests (`node --test`), bundler | <https://nodejs.org/> |
| T2 | Supabase Edge Functions (Deno runtime) and Supabase Storage | Hosting of the proxy and its cache | <https://supabase.com/> |
| T3 | Playwright | End-to-end test of the page in a browser (`test/e2e.mjs`). Development only; not part of the tool and not bundled | <https://playwright.dev/> |
| T4 | Git and GitHub | Source control and public repository | [REPO-URL] |
| T5 | Claude Fable 5.2 (Anthropic) through Claude Code | Wrote all code and tests, researched documentation, drafted text. See [AI-USE.md](AI-USE.md) | <https://www.anthropic.com/> |
| T6 | Web platform APIs: Canvas 2D, SVG, Fetch, Streams, typed arrays, Web Crypto | Rendering and data handling in the browser and the proxy | n/a |
| T7 | Colour maps. "viridis" in `web/src/render/colormaps.js` is an approximation by colour stops of the matplotlib colour map of that name (S. van der Walt and N. Smith, released CC0) (verify how the stops were obtained). The others are original | Display | <https://matplotlib.org/> |
| T8 | Fonts: Arial, Arial Black, Consolas as installed on the viewer's system | Typography. No font files are distributed | n/a |

## 7. Images, video and text

- The tool contains no image files. All graphics, including the previews on the landing page, are
  drawn by code at run time. Science images on screen are renderings of SPHEREx data (N1).
- The demonstration video is a screen recording of the live tool. `[DEMO-URL]`
- No NASA logos, insignia or branding are used anywhere.
- All documentation text was drafted with AI assistance and reviewed by the team owner (see
  [AI-USE.md](AI-USE.md)).

## 8. The idea

Harshbarger, P. 2026, "Tombaugh: a blink comparator for the 102-color sky", design note,
13 November 2026. The concept and its five ideas (predicted-sky subtraction, the distance dial,
molecule lenses, the 16-year movie, fog of war) are the team owner's own. `[IDEA-NOTE-URL, if the
note is published]`

## 9. Citation line shown in the tool

> SPHEREx Level 2 spectral images, <release list> (IRSA, DOI 10.26131/IRSA629 for the mission
> archive; QR3 10.26131/IRSA662), retrieved <date>. Gaia DR3.

The DOIs are held in one constant in the page source so that they can be corrected in one place
once verified.
