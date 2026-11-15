# Cross-check against Astropy

Tombaugh does its own astrometry and reads FITS files with its own JavaScript. This page records
an independent test of that code: the same inputs were given to our JavaScript and to Astropy
(with ERFA and WCSLIB underneath), and the answers were compared number by number.

**Result: 232 comparisons pass, none fails.** 14 further rows are reported for information only
(they measure an effect; they are not a test). No defect was found in the modules under test.
Section 5 lists what we noticed on the way, and section 6 what this test could not cover.

## 1. How to reproduce

```sh
python3 -m venv /tmp/tombaugh-venv
/tmp/tombaugh-venv/bin/pip install numpy astropy          # reproject is optional (one row in check 7)
PYTHON=/tmp/tombaugh-venv/bin/python tools/crosscheck/run.sh
```

It takes about 12 seconds, needs no network and prints the table below. Exit status 0 means no
row failed. Three runs in a row gave identical tables: inputs and random seeds are fixed.
Work files go to `tmp/crosscheck/` (git-ignored, about 56 MB); set `CROSSCHECK_OUT` to move them.

Astropy is kept offline: `astropy.utils.iers.conf.auto_download = False`,
`astropy.utils.data.conf.allow_internet = False`, `solar_system_ephemeris.set('builtin')`.

Versions used for the numbers on this page: Python 3.13.18, numpy 2.5.4, astropy 8.0.2,
pyerfa 2.0.1.5, reproject 0.21.0, scipy 1.18.1, Node v22.23.4, Linux x86_64. Run on 2026-11-15.

Each check is a pair of scripts in `tools/crosscheck/`: `cN_*.mjs` runs our JavaScript and writes
what it got, `cN_*.py` computes the same with Astropy and compares. `report.py` prints the table.

## 2. Summary

| Check | Code under test | Compared with | Points | Largest disagreement | Tolerance | Result |
|---|---|---|---:|---|---|---|
| 1 FITS reading | `proxy/src/fits.js`, `proxy/fixtures/synth.js` | `astropy.io.fits` | 97,193 | none: every header card, pixel and table cell equal | exact | PASS |
| 2 World coordinates | `web/src/core/wcs.js`, `proxy/src/focalplane.js` | `astropy.wcs` (WCSLIB), `SkyCoord` | 342,455 | pixel to sky 2.5e-7 mas; sky to pixel 6.3e-11 pixel | 0.001 mas; 1e-6 pixel | PASS |
| 3 Wavelength (-TAB) | `proxy/src/wavetab.js` | WCSLIB -TAB and a numpy implementation of Greisen et al. 2006 | 131,667 | 1.2e-7 um in float32 arrays (half a unit in the last place); 1.8e-15 um in float64 | 5e-7 um; 1e-9 um | PASS |
| 4 TBF1 and Python client | `proxy/src/encode.js`, `web/src/api.js`, `clients/python/tombaugh.py` | Astropy on the source FITS file, the JavaScript decoders | 522,707 | arrays bit-identical; WCS 2.4e-7 mas | exact; 0.001 mas | PASS |
| 4L Client over HTTP | `tombaugh.fetch_frame`, `proxy/dev-server.mjs` | local dev server, synthetic backend | 4 | none | - | PASS |
| 5 RICE_1 | `proxy/src/rice.js` | CFITSIO Rice codec inside Astropy | 16,652,535 | none, both directions; our compressed tiles are byte-identical to Astropy's | exact | PASS |
| 6 Ephemeris and motion | `web/src/core/ephemeris.js`, `astrometry.js`, `time.js` | ERFA `epv00`, `SkyCoord.apply_space_motion`, `Time` | 6,022 | Earth 1.6e-6 AU (0.27 arcsec); proper motion 2.6e-8 mas; body at 500 AU 0.65 mas | 1e-5 AU; 1 mas; see 3.6 | PASS |
| 7 Reprojection | `web/src/core/reproject.js` | numpy bilinear driven by `astropy.wcs`; `reproject_interp` | 379,734 | exact path 3.1e-6 sigma; default fast path 0.0145 sigma; masks identical | 1e-4 sigma; 0.05 sigma | PASS |

"mas" is milliarcsecond. A SPHEREx pixel is 6150 mas, so 2.5e-7 mas is 4e-11 pixel: the two
programs agree to the last few bits of double precision.

## 3. The checks one by one

### 3.1 FITS reading

Three synthetic SPHEREx Level-2 files were written by `makeSyntheticMef` (a 59 x 59 cutout like
the real one, a 117 x 117 cutout across RA = 0 at Dec -72, and a 40 x 37 cutout clipped by the
detector edge). Astropy opened each without a warning and `hdul.verify('exception')` found
nothing. Then, for every HDU, `parseMef` and `readImage` were compared with Astropy: name, kind,
byte offset, size, all 482 header cards per file (keyword, value and type), every pixel of IMAGE,
FLAGS, VARIANCE and ZODI bit for bit, and the WCS-WAVE table.

The other direction too: Astropy wrote a file our code had never seen (11 HDUs; BITPIX 8, 16,
32, 64, -32, -64; BZERO/BSCALE/BLANK; CONTINUE and HIERARCH cards; a string with a quote in it; a
card without a value) and our reader returned the same 207 cards and 19,647 pixels.

Two things differ by design, values being equal. For scaled integers our reader computes
`BZERO + BSCALE * stored` in double precision and rounds once; Astropy does it in float32 and is
off by up to 3.1e-5 from that, so ours is the more exact of the two. And see observation 5.1.

### 3.2 World coordinates

Four headers: the three synthetic ones and the **real** IMAGE header quoted in `CONTRACT.md`
(all keywords, every SIP coefficient A, B, AP, BP). `makeWcs` was compared with
`WCS.all_pix2world` and `WCS.all_world2pix`.

Pixel convention, stated once: the JavaScript counts pixels from 0, FITS from 1. The comparison
passes our 0-based pixels to Astropy with `origin=0`, and separately passes pixel + 1 with
`origin=1`. Both agree, so the convention is the same on both sides.

Lattices: every half pixel of the cutout; 61 x 61 points over the whole 2040 x 2040 detector;
33 x 33 points out to 1600 pixels from CRPIX, well beyond the detector; sky lattices of
+-0.06 deg about the cutout centre and +-1.5 deg about CRVAL.

- Pixel to sky: at most 2.5e-7 mas. Sky to pixel: at most 2.6e-11 pixel. Our own round trip
  pixel to sky to pixel: at most 1.4e-11 pixel.
- The contract's test vector, FITS pixel (30, 30) of the real header: our code and Astropy both
  give (210.8015485, 54.3491496) and differ from each other by 6e-8 mas. The contract quotes
  (210.8023, 54.3490), which is 1.7 arcsec (0.27 pixel) away on the sky. That is inside the
  contract's own tolerance of 0.003 deg; the contract value is a rounded one.
- `tanProject`, `tanDeproject`, `angSep` (3000 points each, offsets from 1e-9 to 60 deg, both
  poles, nearly antipodal pairs): at most 3.4e-7 mas.
- The north-up grid (`makeGrid`, `gridPixToSky`, `gridSkyToPix`) against an Astropy TAN header
  with CRPIX = (n-1)/2 + 1 and CDELT = (-scale, +scale): 3.8e-7 mas, 6.3e-11 grid pixel.
- `parseCoord` against `SkyCoord` string parsing, 12 strings: 3.7e-7 mas.
- `formatCoord`: the printed string, read back by Astropy, is up to 83 mas from the position that
  was formatted. This is the only number above 1 mas in this check, and it is the rounding of the
  printed digits (0.01 s of time in RA, 0.1 arcsec in Dec, limit 90 mas), not an error.
- `focalplane.js` (`detPixToSky`, `skyToDetPix`) with the 8 real detector headers of
  `CONTRACT-S3.md`: 2.2e-7 mas, 3.0e-11 pixel.

### 3.3 Wavelength lookup (-TAB)

Astropy can evaluate the SPHEREx wavelength table itself:
`WCS(header, fobj=hdul, key='W').wcs_pix2world(...)`. We also wrote the lookup in numpy straight
from the paper (Greisen et al. 2006, section 6), as a second reference. The two references agree
to 1.8e-15 um.

Against them: `waveMap`, `bandwidthMap` and the `wave` array of the TBF1 frame at every pixel of
the three cutouts (float32 arrays: at most 1.2e-7 um, which is half a unit in the last place of a
float32 at these wavelengths), and `waveAt` on a lattice over three whole detectors, at table
nodes, mid-points and fractional pixels (float64: at most 1.8e-15 um). `detXY0` and
`waveCenter` agree exactly and to 4e-16 um.

Two rows are for information. With Astropy, key W must be used with `wcs_pix2world`: Astropy
attaches the SIP distortion of the celestial WCS to every key, and `all_pix2world` on key W would
be wrong by up to 0.013 um. And see observation 5.2 about the outer half pixel.

### 3.4 TBF1 frame and the Python client

`buildFrame` turned each synthetic file into a TBF1 frame. `clients/python/tombaugh.py` read it.

- The container follows `CONTRACT.md` (magic, little-endian length, padding to 8, array order,
  offsets, sizes): 60 properties over the three frames, no violation.
- `read_tbf1` arrays against the JavaScript `decodeFrame` and against Astropy reading the source
  FITS file: bit-identical (93,250 and 74,600 values). The `wave` array against Astropy -TAB:
  1.2e-7 um.
- 81 header and WCS numbers per frame against the FITS header: equal. `mjd` is MJD-AVG.
- Building the frame from only the leading part of the file (cut at ZODI, as the proxy does to
  save a download) gives byte-identical output. The browser decoder in `web/src/api.js` agrees
  with the proxy's.
- `wcs_of(frame)` against the Astropy WCS of the source header and against the numbers of check
  2: 2.4e-7 mas, 2.6e-11 pixel.
- `to_hdulist(frame)` passes `verify('exception')`, is written and read back with identical
  data, and Astropy raises no warning on it.
- Check 4L starts `proxy/dev-server.mjs` on 127.0.0.1 with the synthetic backend and calls
  `fetch_frame` for three frames from `/search`; an unknown id raises `RuntimeError` with the
  proxy's message. Set `CROSSCHECK_LIVE=0` to leave it out.

### 3.5 RICE_1 tile compression

Astropy wrote a 2040 x 2040 int32 image as a `CompImageHDU` with `tile_shape=(1, 2040)`. The image
looks like a FLAGS plane (zeros, patches of the SOURCE bit, sparse defect bits), with rows added
to reach every branch of the coder, among them constant rows and raw 32-bit noise that forces
the escape code. The
header Astropy wrote is the SPHEREx layout: ZCMPTYPE RICE_1, ZBITPIX 32, ZTILE1 2040, ZTILE2 1,
ZVAL1 32, ZVAL2 4, TFORM1 `1PB(8204)`, PCOUNT 1,803,686, no THEAP.

- Forward: our code found the 2040 descriptors and the heap as `CONTRACT-S3.md` describes and
  `riceDecompressInt32` returned all 4,161,600 values exactly.
- Reverse: `riceCompressInt32` compressed each row. Astropy's internal codec (CFITSIO's
  `fits_rdecomp`) decoded every row exactly, and a FITS file built from Astropy's header with
  **our** bytes as the heap was opened by `astropy.io.fits` and gave back every value.
- All 2040 of our compressed tiles are byte-identical to Astropy's.

### 3.6 Ephemeris, proper motion, parallax, time

**Earth.** `earthPosition` against Astropy's built-in ephemeris on 200 dates from 2025-01-01 to
2027-12-31. Position differs by at most 1.60e-6 AU (RMS 8.5e-7 AU), direction by at most 0.27
arcsec (RMS 0.15). `ephemeris.js` claims 1e-5 AU for itself, so it does about six times better
than it claims.

How good is the reference? Astropy's built-in ephemeris is ERFA `epv00`, whose documentation
gives, against JPL DE405 over 1900-2100: heliocentric position RMS 3.7 km, maximum 11.2 km
(7.5e-8 AU); barycentric RMS 4.6 km, maximum 13.4 km. So the 1.6e-6 AU is ours, not Astropy's.
Our position is heliocentric. The Sun is up to 0.0075 AU from the barycentre in these years
(information row), which matters below.

**Proper motion.** `propagate` for Barnard's Star from J2000.0, against
`SkyCoord.apply_space_motion` (ERFA `pmsafe`). The annual parallax shift is switched off on our
side for this comparison, because `apply_space_motion` returns the barycentric direction.

| Case | To 2016.0 | To 2026.5 |
|---|---|---|
| radial velocity 0 on both sides | 0 mas | 2.6e-8 mas |
| radial velocity -110.6 km/s on both sides, parallax 546.98 mas for the distance | 0.030 mas | 0.083 mas |
| what the radial velocity itself changes (our code, with and without) | 165 mas | 452 mas |

With a radial velocity the two differ by 0.03 to 0.08 mas: ERFA's star model includes light-time
and relativistic terms, ours is the straight-line model. It is below anything SPHEREx can see.
All seven catalogue targets with a proper motion agree to 2.6e-8 mas at 2026.5.

On the 200 dates the difference is 0.023 mas. The cause is known and documented in
`astrometry.js`: it turns a UTC MJD into a Julian epoch without adding TT - UTC (69.184 s), and
Barnard's Star moves 10.39 arcsec/yr x 69.184 s = 0.023 mas in that time. With Astropy told to
read the same MJD as TT, the difference drops to 6e-7 mas.

**Stellar parallax.** The parallax step alone, fed with our own direction and our own Earth:
1.2e-4 mas. The whole of `propagate` against the exact geocentric direction built from Astropy
vectors: 0.023 mas with Astropy's heliocentric Earth, 3.3 mas with the barycentric Earth, which
is the rigorous choice. That 3.3 mas is the Sun's offset from the barycentre times the parallax
(0.0075 AU x 547 mas), the documented simplification. It is the largest known approximation in
the motion code and is 1/1800 of a pixel for the nearest star in the list.

**A body at 500 AU.** `parallaxOffset` against the exact geocentric direction, Astropy vectors
with Astropy's Earth, 200 dates, four directions (ecliptic pole, ecliptic plane, RA near 0,
Dec -80): at most 0.65 mas on a shift of about 415 arcsec. The tolerance is not a round number:
it is 1.1 x (largest Earth position difference) / distance, 0.73 mas at 500 AU, because the only
thing that can differ is the Earth. The formula alone, given our Earth, agrees to 4e-7 mas. At
30 AU the difference is 10.7 mas on a shift of 6907 arcsec (same cause, 17 times closer); at
100,000 AU it is 0.003 mas.

**Time.** `mjdToYear`, `yearToMjd`, `isoToMjd`, `mjdToDate`, `mjdToIso` against `astropy.time`:
equal to 1e-9 day or exactly. `isoToMjd` of the real header's DATE-OBS reproduces its MJD-OBS to
2.8e-10 day.

### 3.7 Reprojection

Each frame was reprojected onto the viewer's north-up grid by `reproject`, in its default fast
mode (geometry computed on a lattice every 16 pixels and interpolated) and in its exact mode. The
reference is a numpy implementation of the rules written in `reproject.js` (bilinear, bad pixels
dropped and weights renormalised), with the geometry from `astropy.wcs`.

| Quantity | Exact mode | Default fast mode |
|---|---|---|
| where a grid pixel falls on the detector | 3.7e-11 pixel | 1.5e-4 pixel |
| mask (pixels that differ) | 0 of 26,406 | 0 of 26,406 |
| image, in units of the pixel noise | 3.1e-6 sigma | 0.0145 sigma (RMS about 5e-4) |
| variance, relative | 5.0e-8 | 1.5e-4 |
| wavelength | 1.2e-7 um | 1.7e-7 um |

The fast mode's 0.0145 sigma is the price of the lattice: 1.5e-4 pixel of position error on the
steepest star profile. It is 70 times smaller than the noise in the worst pixel. The exact mode
is limited by float32 rounding. `reproject.reproject_interp`, a third program, agrees with our
default mode to the same 0.0145 sigma on the pixels with four good neighbours.

## 4. Would it have failed on wrong code?

A check that passes proves little unless it fails when the code is wrong. `selftest.py` copies
the code to a temporary directory, changes one line, runs everything, and repeats for 27 faults.
The repository itself is not touched. It takes about 90 seconds:

```sh
/tmp/tombaugh-venv/bin/python tools/crosscheck/selftest.py
```

Result: 25 of the 27 faults are caught, and the unchanged copy passes. The other 2 were chosen
to be smaller than the tolerances and survive, as expected.

| Fault put into a copy of the code | File | Outcome | Checks that failed | Rows | First failing row |
|---|---|---|---|---:|---|
| (unchanged copy) | - | passes | - | 0 |  |
| wcs: pixel -> plane forgets the 0-based to 1-based step in x | web/src/core/wcs.js | caught | 2, 4 | 32 | real-like: pixel -> sky, cutout, every half pixel: 6.14e+03 mas |
| wcs: plane -> pixel forgets it (inverse only) | web/src/core/wcs.js | caught | 2, 4, 7 | 68 | real-like: JS round trip pixel -> sky -> pixel, cutout: 1 pixel |
| wcs: SIP B polynomial uses the powers of u and v the wrong way round | web/src/core/wcs.js | caught | 2, 4 | 32 | real-like: pixel -> sky, cutout, every half pixel: 6.62e+03 mas |
| wcs: grid has east to the right | web/src/core/wcs.js | caught | 2 | 1 | Grid: gridPixToSky vs astropy TAN header (CRPIX = (n-1)/2 + 1, CDELT = -scale, +scale): 6.03e+05 mas |
| wcs: Newton inverse stops at 0.01 pixel instead of 1e-7 | web/src/core/wcs.js | survives (expected) | - | 0 |  |
| wavetab: one of the four table corners taken from the wrong neighbour | proxy/src/wavetab.js | caught | 3, 4 | 21 | real-like: waveMap (wavetab.js) vs astropy -TAB, every pixel: 0.0122 um |
| wavetab: detector row off by one pixel | proxy/src/wavetab.js | caught | 3, 4 | 12 | real-like: waveMap (wavetab.js) vs astropy -TAB, every pixel: 0.000308 um |
| fits: 32-bit integers read little-endian | proxy/src/fits.js | caught | 1, 4, 7 | 19 | real-like: image pixels, bit for bit (IMAGE, FLAGS, VARIANCE, ZODI): 1 HDUs differing |
| fits: BZERO ignored | proxy/src/fits.js | caught | 1 | 1 | astropy-written: pixels of BITPIX 8, 16, 32, 64, -32, -64 and BZERO/BSCALE/BLANK images: 2 HDUs differing |
| rice: decoder takes the raw-pixel escape one code too early | proxy/src/rice.js | caught | 5 | 0 | check 5 stopped with an error |
| rice: FSMAX 24 in decoder and encoder alike (self-consistent, not CFITSIO) | proxy/src/rice.js | caught | 5 | 0 | check 5 stopped with an error |
| ephemeris: precession from the equinox of date to J2000 left out | web/src/core/ephemeris.js | caught | 6 | 9 | earthPosition vs astropy builtin (epv00), 200 dates 2025-2027: position difference: 0.00683 AU |
| ephemeris: z of the Earth has the wrong sign of the obliquity | web/src/core/ephemeris.js | caught | 6 | 11 | earthPosition vs astropy builtin (epv00), 200 dates 2025-2027: position difference: 0.808 AU |
| ephemeris: TT - UTC left out (Earth 69 s behind, about 2000 km) | web/src/core/ephemeris.js | caught | 6 | 2 | earthPosition: same, against the accuracy ephemeris.js claims for itself (1e-5 AU): 1.46e-05 AU |
| ephemeris: obliquity wrong by 0.4 arcsec | web/src/core/ephemeris.js | survives (expected) | - | 0 |  |
| ephemeris: parallaxOffset adds the Earth instead of subtracting it | web/src/core/ephemeris.js | caught | 6 | 18 | parallaxOffset, body at 500 AU towards (269.452075, 4.693391): formula only (Astropy vectors, our Earth) and offsets reproduce the position: 8.28e+05 mas |
| astrometry: east unit vector has the wrong sign | web/src/core/astrometry.js | caught | 6 | 9 | propagate, Barnard's Star 2000.0 -> 2016, rv = 0 both sides, parallax shift off: 2.57e+04 mas |
| astrometry: stellar parallax applied with the wrong sign | web/src/core/astrometry.js | caught | 6 | 3 | propagate with parallax: the parallax step alone (Astropy vector geometry fed with our direction and our Earth): 1.1e+03 mas |
| astrometry: J2000.0 placed at MJD 51544.0 (half a day early) | web/src/core/astrometry.js | caught | 6 | 9 | propagate, Barnard's Star 2000.0 -> 2016, rv = 0 both sides, parallax shift off: 14.2 mas |
| time: J2000.0 placed at MJD 51544.0 | web/src/core/time.js | caught | 6 | 7 | propagate, Barnard's Star 2000.0 -> 2016, rv = 0 both sides, parallax shift off: 14.2 mas |
| reproject: east-west mirror of the grid | web/src/core/reproject.js | caught | 7 | 45 | real-like: grid pixel -> native pixel, exact path (mapGridToFrame exact) vs astropy: 59 native pixel |
| reproject: bilinear weight of the right-hand neighbour uses the wrong fraction | web/src/core/reproject.js | caught | 7 | 33 | real-like: image, exact path, where both valid: max /difference/ / noise: 98.2 sigma |
| encode: frame date taken from MJD-OBS (start) instead of MJD-AVG (middle) | proxy/src/encode.js | caught | 4 | 3 | real-like: frame header fields and WCS numbers vs FITS header (astropy), JS decoders, cut-at-ZODI path: 1 mismatches |
| encode: variance array filled from the ZODI HDU | proxy/src/encode.js | caught | 4 | 3 | real-like: read_tbf1 image, variance, zodi, flags vs astropy.io.fits on the source file: 1 arrays differing |
| encode: header length written big-endian | proxy/src/encode.js | caught | 3, 4, 7 | 0 | check 3 stopped with an error |
| focalplane: sign of an off-diagonal matrix term in the inverse | proxy/src/focalplane.js | caught | 2 | 1 | focalplane.js skyToDetPix vs astropy: 2.18e+03 pixel |
| python client: CRPIX1 written 0-based | clients/python/tombaugh.py | caught | 4, 7 | 54 | real-like: wcs_of(frame) pixel -> sky vs astropy WCS of the source header and vs JS makeWcs (check 2): 6.18e+03 mas |

Three faults stop a script with an error ("check N stopped with an error") instead of giving a
failing row; the driver counts a missing result as a failure.

The two that survive show the limits. Stopping the WCS inverse at 0.01 pixel still passes
the 1e-6 pixel tolerance, because Newton's last step squares the error. An obliquity wrong by 0.4 arcsec moves the
Earth by less than our series already differs from Astropy's, so the Earth check cannot see
errors below about 1e-5 AU, or 4 mas for a body at 500 AU.

## 5. What we noticed (none is a defect)

1. **BLANK on unscaled integers.** For an integer image with a BLANK card but no BSCALE/BZERO,
   Astropy returns floats with NaN; `readImage` returns the stored integers. This is documented
   in `fits.js`. In a SPHEREx file the only integer image is FLAGS, a bit mask, so nothing
   depends on it.
2. **Outer half pixel of the detector.** `wavetab.js` clamps to the edge of the table; WCSLIB
   extrapolates. They differ by up to 2.8e-4 um in the outermost half pixel only. Inside, they
   agree to 1.8e-15 um. Clamping is the documented choice.
3. **AP/BP in real headers.** The comment in `wcs.js` says the inverse polynomial is good to
   about 1e-3 pixel. On the real header we measured 3.3e-3 pixel, and 0.020 pixel on one
   synthetic header. It has no effect: `wcs.js` only starts from AP/BP and then iterates on the
   forward polynomial, which is why the inverse agrees with Astropy to 2.6e-11 pixel.
4. **The contract's test vector** is 0.27 pixel from the true mapping (section 3.2). Tests that
   use it need its stated tolerance of 0.003 deg; a tighter one would fail for the wrong reason.
5. **Two documented simplifications, now measured:** no TT - UTC in the epoch of proper motion
   (0.023 mas for Barnard's Star), and the Sun in place of the barycentre for parallax (3.3 mas
   for Barnard's Star, 0.6 mas for a body at 500 AU through the Earth position).
6. **Astropy prints a `datfix` warning** when it builds a WCS from a SPHEREx header ("Set
   DATE-AVG from MJD-AVG"). It is harmless and real SPHEREx files cause it too. The FITS files
   from the Python client carry both keywords and do not.
7. **The synthetic header's MJD-END** is 61210.793779224 where the real header has
   61210.793779219 (4e-7 s). Fixture only.

## 6. What this could not check

- **No real SPHEREx file.** There is no access to IRSA from the build machine. The only real
  data is the IMAGE header quoted in `CONTRACT.md` and the eight detector headers in
  `CONTRACT-S3.md`. Every pixel, the wavelength table and the compressed FLAGS tiles are
  synthetic or written by Astropy. A real file could still hold something neither side expects.
- **No JPL ephemeris.** Astropy was not allowed to download one, so the Earth is tested against
  `epv00`, good to 11 km. That is 20 times finer than the difference we measured, so it is
  enough for this test, but nothing here compares with JPL Horizons, and `proxy/src/horizons.js` is not covered.
- **Not covered at all:** `photometry.js`, `skymodel.js`, `stack.js`, `lenses.js`,
  `distance.js` (except `parallaxOffset`, which it calls), `identify.js`, `expindex.js`,
  `s3cutout.js` (except its Rice and focal-plane parts), the request handler beyond check 4L,
  and everything in `web/src/ui`.
- **`fetch_frame`** ran against the local dev server with synthetic data only, never against the
  deployed proxy or IRSA.
- **The browser.** All JavaScript ran in Node 22. The same modules run in the browser, but no
  browser was driven here.
- **Reprojection rules.** The geometry is checked against Astropy. The masking rules (which bad
  neighbours drop a pixel) are Tombaugh's own, so the reference for them is our reading of the
  comments in `reproject.js`, plus `reproject_interp` on pixels with four good neighbours. Flux
  conservation under resampling is not tested; bilinear interpolation does not promise it.
- **Aberration and light-time** are left out of the motion code by design and are not tested.
- **RICE_1** was tested for int32 data, block size 32, one row per tile: the FLAGS layout. Other
  layouts, quantised floats and GZIP tiles are not supported by `rice.js` and not tested.
- **One machine.** Linux x86_64, one version of each package.

## 7. Every row

Rows that differ only by the test frame are merged: points are added and the largest
disagreement is kept. The unmerged table is `tmp/crosscheck/summary_full.md` after a run.

| Check | What was compared | Points | Largest disagreement | Tolerance | Result |
|---|---|---:|---|---|---|
| 1 | astropy opens the file, verify('exception') (3 frames) | 21 | clean | - | PASS |
| 1 | HDU names, kinds, byte offsets and sizes (4 frames) | 192 | 0 mismatches | 0 mismatches | PASS |
| 1 | header cards (keyword, value, type) (4 frames) | 1653 | 0 mismatches | 0 mismatches | PASS |
| 1 | image pixels, bit for bit (IMAGE, FLAGS, VARIANCE, ZODI) (3 frames) | 74600 | 0 HDUs differing | 0 HDUs differing | PASS |
| 1 | binary tables (columns, WCS-WAVE X, Y, VALUES) (4 frames) | 1080 | 0 mismatches | 0 mismatches | PASS |
| 1 | pixels of BITPIX 8, 16, 32, 64, -32, -64 and BZERO/BSCALE/BLANK images (astropy-written) | 19647 | 0 HDUs differing | 0 HDUs differing | PASS |
| 2 | pixel -> sky, cutout, every half pixel (4 frames) | 89622 | 2.40e-07 mas | 0.001 mas | PASS |
| 2 | same, given to astropy as FITS 1-based pixels (origin = 1) (4 frames) | 89622 | 2.40e-07 mas | 0.001 mas | PASS |
| 2 | JS round trip pixel -> sky -> pixel, cutout (4 frames) | 89622 | 1.37e-11 pixel | 1.00e-06 pixel | PASS |
| 2 | pixel -> sky, whole 2040 x 2040 detector (4 frames) | 14884 | 2.46e-07 mas | 0.001 mas | PASS |
| 2 | JS round trip pixel -> sky -> pixel, detector (4 frames) | 14884 | 1.19e-11 pixel | 1.00e-06 pixel | PASS |
| 2 | pixel -> sky, +-1600 px about CRPIX (4 frames) | 4356 | 2.18e-07 mas | 0.001 mas | PASS |
| 2 | JS round trip pixel -> sky -> pixel, beyond (4 frames) | 4356 | 1.12e-11 pixel | 1.00e-06 pixel | PASS |
| 2 | sky -> pixel, RA/Dec lattice +-0.06 deg about the cutout centre (4 frames) | 6724 | 2.25e-11 pixel | 1.00e-06 pixel | PASS |
| 2 | (information) AP/BP inverse polynomial alone vs exact inverse (4 frames) | 6724 | 0.0203 pixel | - | INFO |
| 2 | sky -> pixel, RA/Dec lattice +-1.5 deg about CRVAL (4 frames) | 6724 | 1.82e-11 pixel | 1.00e-06 pixel | PASS |
| 2 | real header: FITS pixel (30, 30) vs contract (210.8023, 54.3490), JS | 1 | 7.51e-04 deg | 0.003 deg | PASS |
| 2 | real header: FITS pixel (30, 30) vs contract, astropy | 1 | 7.51e-04 deg | 0.003 deg | PASS |
| 2 | real header: FITS pixel (30, 30), JS vs astropy | 1 | 6.35e-08 mas | 0.001 mas | PASS |
| 2 | tanProject vs astropy TAN (offsets 1e-9 to 60 deg, tangent points incl. both poles) | 3000 | 2.36e-07 mas per deg of offset (min 1 deg) | 0.001 mas per deg of offset (min 1 deg) | PASS |
| 2 | tanDeproject vs astropy TAN | 3000 | 3.35e-07 mas | 0.001 mas | PASS |
| 2 | angSep vs SkyCoord.separation (random, tiny and near-antipodal pairs) | 3000 | 2.05e-07 mas | 0.001 mas | PASS |
| 2 | Grid: gridPixToSky vs astropy TAN header (CRPIX = (n-1)/2 + 1, CDELT = -scale, +scale) | 2645 | 3.82e-07 mas | 0.001 mas | PASS |
| 2 | Grid: gridSkyToPix vs astropy | 2645 | 6.33e-11 grid pixel | 1.00e-06 grid pixel | PASS |
| 2 | parseCoord vs SkyCoord string parsing (contract examples and others) | 12 | 3.65e-07 mas | 0.001 mas | PASS |
| 2 | formatCoord strings read back by astropy vs the position formatted | 300 | 83.1 mas | 90.14 mas | PASS |
| 2 | focalplane.js detPixToSky vs astropy plain TAN (8 real detector headers, 1-based pixels) | 3528 | 2.15e-07 mas | 0.001 mas | PASS |
| 2 | focalplane.js skyToDetPix vs astropy | 3528 | 2.98e-11 pixel | 1.00e-06 pixel | PASS |
| 3 | astropy -TAB (WCSLIB) vs numpy implementation of the paper (3 frames) | 37300 | 1.78e-15 um | 1.00e-12 um | PASS |
| 3 | (information) error if all_pix2world were used on key W instead of wcs_pix2world (3 frames) | 18650 | 0.01287 um | - | INFO |
| 3 | waveMap (wavetab.js) vs astropy -TAB, every pixel (3 frames) | 18650 | 1.19e-07 um | 5.00e-07 um | PASS |
| 3 | bandwidthMap vs astropy -TAB, every pixel (3 frames) | 18650 | 1.86e-09 um | 5.00e-07 um | PASS |
| 3 | `wave` array of the TBF1 frame vs astropy -TAB, every pixel (3 frames) | 18650 | 1.19e-07 um | 5.00e-07 um | PASS |
| 3 | TBF1 `wave` identical to waveMap (3 frames) | 18650 | 0 pixels differing | 0 pixels differing | PASS |
| 3 | detXY0 vs header key W and key A (1-based detector pixel of FITS pixel 1, 1) (3 frames) | 6 | 0 pixel | 0 pixel | PASS |
| 3 | waveCenter, bwCenter vs astropy -TAB at the array centre (3 frames) | 6 | 4.44e-16 um | 1.00e-12 um | PASS |
| 3 | waveAt over the whole detector 2 (nodes, mid-points, fractional pixels) vs astropy -TAB (real-like) | 6561 | 6.66e-16 um | 1.00e-09 um | PASS |
| 3 | (information) outer half-pixel rim of the detector: JS clamps, WCSLIB extrapolates (3 frames) | 984 | 2.76e-04 um | - | INFO |
| 3 | waveAt outside the detector equals the value at the nearest edge (documented clamping) (3 frames) | 72 | 0 um | 1.00e-09 um | PASS |
| 3 | waveAt over the whole detector 5 (nodes, mid-points, fractional pixels) vs astropy -TAB (south-wrap) | 6561 | 1.78e-15 um | 1.00e-09 um | PASS |
| 3 | waveAt over the whole detector 3 (nodes, mid-points, fractional pixels) vs astropy -TAB (edge-clipped) | 6561 | 8.88e-16 um | 1.00e-09 um | PASS |
| 4 | TBF1 container follows CONTRACT.md (magic, padding, offsets, order, sizes) (3 frames) | 60 | 0 violations | 0 violations | PASS |
| 4 | read_tbf1 shapes (ny, nx), dtypes, input kinds, rejection of damaged frames (3 frames) | 51 | 0 problems | 0 problems | PASS |
| 4 | read_tbf1 arrays vs JavaScript decodeFrame, bit for bit (3 frames) | 93250 | 0 arrays differing | 0 arrays differing | PASS |
| 4 | read_tbf1 image, variance, zodi, flags vs astropy.io.fits on the source file (3 frames) | 74600 | 0 arrays differing | 0 arrays differing | PASS |
| 4 | read_tbf1 wave vs astropy -TAB (3 frames) | 18650 | 1.19e-07 um | 5.00e-07 um | PASS |
| 4 | frame header fields and WCS numbers vs FITS header (astropy), JS decoders, cut-at-ZODI path (3 frames) | 243 | 0 mismatches | 0 mismatches | PASS |
| 4 | wcs_of(frame) pixel -> sky vs astropy WCS of the source header and vs JS makeWcs (check 2) (3 frames) | 86624 | 2.40e-07 mas | 0.001 mas | PASS |
| 4 | wcs_of(frame) sky -> pixel vs JS makeWcs (check 2) (3 frames) | 5043 | 2.64e-11 pixel | 1.00e-06 pixel | PASS |
| 4 | to_hdulist verifies, writes, reads back with identical data and no astropy warning (3 frames) | 93250 | 0 problems | 0 problems | PASS |
| 4 | WCS of the re-packed FITS file vs WCS of the source file (3 frames) | 75461 | 2.24e-07 mas | 0.001 mas | PASS |
| 4 | detector coordinates (alternate WCS A) of the re-packed file vs the source file (3 frames) | 75461 | 0 pixel | 1.00e-09 pixel | PASS |
| 4 | citation() gives the contract's citation line | 1 | 0 mismatch | 0 mismatch | PASS |
| 4 | tombaugh.DEFAULT_BAD_MASK equals the contract's bit list | 13 | 0 mismatch | 0 mismatch | PASS |
| 4L | fetch_frame: three cutouts from /search results decode, WCS centres the target, wavelengths in band | 3 | 0 problems | 0 problems | PASS |
| 4L | fetch_frame: unknown id raises RuntimeError with the proxy's message | 1 | 0 problems | 0 problems | PASS |
| 5 | Astropy wrote the SPHEREx FLAGS layout (RICE_1, ZBITPIX 32, ZTILE1 2040, ZTILE2 1, ZVAL1 32, ZVAL2 4) | 6 | 0 differences | 0 differences | PASS |
| 5 | our parseMef reads the same compressed-HDU header values and data offset as Astropy | 9 | 0 differences | 0 differences | PASS |
| 5 | descriptors cover the whole heap (largest offset + length = PCOUNT) | 2040 | 0 bytes | 0 bytes | PASS |
| 5 | sanity: Astropy reads back its own file | 4161600 | 0 pixels differing | 0 pixels differing | PASS |
| 5 | forward: Astropy-compressed tiles decoded by riceDecompressInt32, every value | 4161600 | 0 pixels differing | 0 pixels differing | PASS |
| 5 | our encoder followed by our decoder returns the input (all rows) | 2040 | 0 rows differing | 0 rows differing | PASS |
| 5 | reverse a: riceCompressInt32 tiles decoded by Astropy's internal Rice1 codec (CFITSIO), all rows | 4161600 | 0 rows differing | 0 rows differing | PASS |
| 5 | reverse b: FITS file with OUR tiles as the heap, opened by astropy.io.fits (CompImageHDU), every value | 4161600 | 0 pixels differing | 0 pixels differing | PASS |
| 5 | our compressed tiles are byte-identical to Astropy's (CFITSIO) tiles, as rice.js states | 2040 | 0 tiles differing | 0 tiles differing | PASS |
| 6 | earthPosition vs astropy builtin (epv00), 200 dates 2025-2027: position difference | 200 | 1.60e-06 AU | 1.00e-04 AU | PASS |
| 6 | earthPosition: same, against the accuracy ephemeris.js claims for itself (1e-5 AU) | 200 | 1.60e-06 AU | 1.00e-05 AU | PASS |
| 6 | earthPosition: direction difference | 200 | 0.2691 arcsec | 1.5 arcsec | PASS |
| 6 | earthPosition: (information) radial (distance) difference | 200 | 1.41e-06 AU | - | INFO |
| 6 | earthPosition: (information) heliocentric (ours) vs BARYCENTRIC Earth: the Sun's offset from the barycentre | 200 | 0.007547 AU | - | INFO |
| 6 | propagate, Barnard's Star 2000.0 -> 2016, rv = 0 both sides, parallax shift off | 1 | 0 mas | 1 mas | PASS |
| 6 | propagate, Barnard's Star 2000.0 -> 2016, rv = -110.6 km/s both sides | 1 | 0.03041 mas | 1 mas | PASS |
| 6 | (information) effect of the radial velocity on Barnard's Star at 2016 (JS, rv = -110.6 vs 0) | 1 | 164.8 mas | - | INFO |
| 6 | propagate, Barnard's Star 2000.0 -> 2026.5, rv = 0 both sides, parallax shift off | 1 | 2.58e-08 mas | 1 mas | PASS |
| 6 | propagate, Barnard's Star 2000.0 -> 2026.5, rv = -110.6 km/s both sides | 1 | 0.08348 mas | 1 mas | PASS |
| 6 | (information) effect of the radial velocity on Barnard's Star at 2026.5 (JS, rv = -110.6 vs 0) | 1 | 452.3 mas | - | INFO |
| 6 | propagate, every target with a proper motion (barnard, eps-indi-b, wise0855, rw-aur, proxima, luhman16, teegarden) -> 2026.5, rv = 0 | 7 | 2.58e-08 mas | 1 mas | PASS |
| 6 | propagate, Barnard's Star at the 200 dates, parallax shift off, vs apply_space_motion | 200 | 0.02279 mas | 1 mas | PASS |
| 6 | same, with Astropy reading the MJD as TT (elapsed time identical on both sides) | 200 | 5.99e-07 mas | 0.001 mas | PASS |
| 6 | propagate with parallax: the parallax step alone (Astropy vector geometry fed with our direction and our Earth) | 200 | 1.15e-04 mas | 0.001 mas | PASS |
| 6 | propagate with parallax vs exact geocentric direction, Astropy heliocentric Earth | 200 | 0.02321 mas | 1 mas | PASS |
| 6 | propagate with parallax vs exact geocentric direction, Astropy BARYCENTRIC Earth (the rigorous one) | 200 | 3.334 mas | 10 mas | PASS |
| 6 | parallaxOffset, body at 500 AU towards (269.452075, 4.693391): formula only (Astropy vectors, our Earth) and offsets reproduce the position | 200 | 3.65e-07 mas | 0.01 mas | PASS |
| 6 | parallaxOffset, body at 500 AU towards (269.452075, 4.693391): vs exact geocentric direction from Astropy vectors | 200 | 0.6539 mas | 0.7265 mas | PASS |
| 6 | parallaxOffset, body at 500 AU towards (269.452075, 4.693391): geocentric distance | 200 | 1.12e-06 AU | 1.00e-04 AU | PASS |
| 6 | parallaxOffset, body at 500 AU towards (270, 66.5607): formula only (Astropy vectors, our Earth) and offsets reproduce the position | 200 | 1.73e-07 mas | 0.01 mas | PASS |
| 6 | parallaxOffset, body at 500 AU towards (270, 66.5607): vs exact geocentric direction from Astropy vectors | 200 | 0.6356 mas | 0.7265 mas | PASS |
| 6 | parallaxOffset, body at 500 AU towards (270, 66.5607): geocentric distance | 200 | 1.11e-06 AU | 1.00e-04 AU | PASS |
| 6 | parallaxOffset, body at 500 AU towards (0.001, -0.5): formula only (Astropy vectors, our Earth) and offsets reproduce the position | 200 | 4.17e-07 mas | 0.01 mas | PASS |
| 6 | parallaxOffset, body at 500 AU towards (0.001, -0.5): vs exact geocentric direction from Astropy vectors | 200 | 0.5923 mas | 0.7265 mas | PASS |
| 6 | parallaxOffset, body at 500 AU towards (0.001, -0.5): geocentric distance | 200 | 1.47e-06 AU | 1.00e-04 AU | PASS |
| 6 | parallaxOffset, body at 500 AU towards (45, -80): formula only (Astropy vectors, our Earth) and offsets reproduce the position | 200 | 9.73e-08 mas | 0.01 mas | PASS |
| 6 | parallaxOffset, body at 500 AU towards (45, -80): vs exact geocentric direction from Astropy vectors | 200 | 0.6437 mas | 0.7265 mas | PASS |
| 6 | parallaxOffset, body at 500 AU towards (45, -80): geocentric distance | 200 | 1.21e-06 AU | 1.00e-04 AU | PASS |
| 6 | parallaxOffset, body at 30 AU towards (123.4, 20): formula only (Astropy vectors, our Earth) and offsets reproduce the position | 200 | 8.92e-08 mas | 0.01 mas | PASS |
| 6 | parallaxOffset, body at 30 AU towards (123.4, 20): vs exact geocentric direction from Astropy vectors | 200 | 10.71 mas | 12.09 mas | PASS |
| 6 | parallaxOffset, body at 30 AU towards (123.4, 20): geocentric distance | 200 | 1.08e-06 AU | 1.00e-04 AU | PASS |
| 6 | parallaxOffset, body at 100000 AU towards (200, -10): formula only (Astropy vectors, our Earth) and offsets reproduce the position | 200 | 1.81e-07 mas | 0.01 mas | PASS |
| 6 | parallaxOffset, body at 100000 AU towards (200, -10): vs exact geocentric direction from Astropy vectors | 200 | 0.002913 mas | 0.004627 mas | PASS |
| 6 | parallaxOffset, body at 100000 AU towards (200, -10): geocentric distance | 200 | 1.55e-06 AU | 1.00e-04 AU | PASS |
| 6 | mjdToYear vs astropy Time.jyear (Julian epoch, same time scale) | 200 | 0 yr | 1.00e-09 yr | PASS |
| 6 | yearToMjd(mjdToYear(mjd)) returns mjd | 200 | 4.37e-11 d | 1.00e-09 d | PASS |
| 6 | yearToMjd for J2000.0, J2016.0, J2026.5 vs astropy | 3 | 0 d | 1.00e-09 d | PASS |
| 6 | isoToMjd (FITS DATE-OBS strings) vs astropy Time | 7 | 7.28e-12 d | 1.00e-09 d | PASS |
| 6 | isoToMjd('2026-06-19T19:01:07.407') vs MJD-OBS = 61210.79244684 of the same real header | 1 | 2.76e-10 d | 1.00e-08 d | PASS |
| 6 | mjdToDate vs astropy calendar date and time (to the millisecond) | 200 | 0 dates differing | 0 dates differing | PASS |
| 6 | mjdToIso ('YYYY-MM-DD HH:MM', rounded to the minute) vs astropy | 200 | 0 strings differing | 0 strings differing | PASS |
| 7 | DEFAULT_BAD_MASK (flags.js) equals the contract's bit list (3 frames) | 39 | 0 mismatch | 0 mismatch | PASS |
| 7 | grid pixel -> native pixel, exact path (mapGridToFrame exact) vs astropy (3 frames) | 26406 | 3.69e-11 native pixel | 1.00e-06 native pixel | PASS |
| 7 | grid pixel -> native pixel, default fast path (lattice every 16 px) vs astropy (3 frames) | 26406 | 1.47e-04 native pixel | 0.002828 native pixel | PASS |
| 7 | mask, exact path: pixels where JS and the numpy/astropy recomputation disagree (3 frames) | 26406 | 0 pixels | 0 pixels | PASS |
| 7 | exact path: mask = 0 implies finite image, variance and wave (3 frames) | 21184 | 0 violations | 0 violations | PASS |
| 7 | image, exact path, where both valid: max \|difference\| / noise (3 frames) | 21184 | 3.11e-06 sigma | 1.00e-04 sigma | PASS |
| 7 | image, exact path, pixels with four good neighbours only (plain bilinear) (3 frames) | 20717 | 3.11e-06 sigma | 1.00e-04 sigma | PASS |
| 7 | variance, exact path: max relative difference (3 frames) | 21184 | 5.00e-08 | 1.00e-05 | PASS |
| 7 | wavelength, exact path: max difference (3 frames) | 21224 | 1.19e-07 um | 1.00e-06 um | PASS |
| 7 | mask, default fast path: pixels where JS and the numpy/astropy recomputation disagree (3 frames) | 26406 | 0 pixels | 13 pixels | PASS |
| 7 | default fast path: mask = 0 implies finite image, variance and wave (3 frames) | 21184 | 0 violations | 0 violations | PASS |
| 7 | image, default fast path, where both valid: max \|difference\| / noise (3 frames) | 21184 | 0.01449 sigma | 0.05 sigma | PASS |
| 7 | image, default fast path, pixels with four good neighbours only (plain bilinear) (3 frames) | 20717 | 0.01449 sigma | 0.05 sigma | PASS |
| 7 | variance, default fast path: max relative difference (3 frames) | 21184 | 1.53e-04 | 0.02 | PASS |
| 7 | wavelength, default fast path: max difference (3 frames) | 21224 | 1.74e-07 um | 2.00e-05 um | PASS |
| 7 | image without zodi subtraction (exact path): max \|difference\| / noise (3 frames) | 21184 | 3.28e-06 sigma | 1.00e-04 sigma | PASS |
| 7 | variance: 'propagate' (exact path): max relative difference (3 frames) | 21184 | 5.93e-08 | 1.00e-05 | PASS |
| 7 | image, default fast path vs reproject.reproject_interp (bilinear), four-good-neighbour pixels (3 frames) | 20717 | 0.01449 sigma | 0.05 sigma | PASS |
