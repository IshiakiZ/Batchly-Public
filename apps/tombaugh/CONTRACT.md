# Tombaugh build contract

Tombaugh is a public web tool for the NASA Space Apps 2026 challenge "Planet X and SPHEREx".
A user enters RA/Dec (or a name); the tool plays SPHEREx images of that patch as a movie so
moving and varying objects stand out. Its signature feature is **predicted-sky subtraction**:
fit a smooth spectrum to every pixel from all visits, subtract what the static sky should look
like at each frame's wavelength, and show the residual.

This file is the single source of truth for interfaces between modules. Several engineers build
modules in parallel. **Only edit files you own. Do not change a signature defined here**; if a
signature is wrong or missing, implement the closest reasonable thing and record the deviation in
`docs/DEVIATIONS.md` (append a short entry with your module name).

## Ground rules

- Plain JavaScript ES modules, no TypeScript, no bundler, **zero runtime dependencies**, no CDN
  imports. Node >= 22 for tests (`node --test`), modern evergreen browsers for the page.
- `web/src/core/**` and `proxy/src/**` must be pure and environment-neutral: no DOM, no `fs`, no
  Node-only APIs. Use only Web-standard APIs (`fetch`, `TextDecoder`, `DataView`, typed arrays,
  `ReadableStream`, `crypto.subtle`). They must import in Node, Deno and browsers unchanged.
- Tests live beside the code as `*.test.js` and run with `node --test <file>`. Run only your own
  tests while working. Do not add npm dependencies.
- Every source file starts with this header (code was written by an AI model, and the hackathon
  rules require that to be stated in the file):
  ```js
  // Tombaugh - SPHEREx blink comparator. Apache-2.0.
  // AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
  ```
- Angles are **degrees** unless a name says otherwise (`_rad`, `_arcsec`, `_mas`). Times are
  **MJD (UTC days)** as numbers. Wavelengths are **micrometres**. Surface brightness is **MJy/sr**.
- Pixel coordinates in JS are **0-based**, `x` = column (FITS axis 1), `y` = row (FITS axis 2);
  array index = `y * nx + x`. FITS headers are 1-based: `fitsPixel = jsPixel + 1`.
- Never throw on bad pixels: treat non-finite values and masked pixels as missing.
- No NASA logos or insignia anywhere. No hype in UI copy: curious, direct, specific.
- Do not reach the network in tests. The build machine cannot reach IRSA.

## Verified facts about the data (measured on real files, 2026-11-14)

A SPHEREx Level-2 cutout from IRSA
(`https://irsa.ipac.caltech.edu/<uri>?center=<ra>,<dec>d&size=<deg>`) is a multi-extension FITS
of about 4.0 MB whatever the cutout size, because the PSF table dominates. No HTTP Range support.
A 0.1 deg cutout is 59 x 59 pixels (6.15 arcsec/pixel). HDUs, in order:

| # | EXTNAME | Type | Notes |
|---|---|---|---|
| 0 | (primary) | no data | 6 cards; `VERSION` (e.g. `7.0.5`) |
| 1 | IMAGE | float32, BITPIX -32, NAXIS1 x NAXIS2 | `BUNIT = 'MJy / sr'`; header ~292 cards (25,920 bytes) |
| 2 | FLAGS | int32, BITPIX 32 | bit definitions below |
| 3 | VARIANCE | float32 | `MJy2 / sr2` |
| 4 | ZODI | float32 | zodiacal light model, `MJy / sr` |
| 5 | EPSF | BINTABLE, NAXIS1=8752, NAXIS2=441 | 3.86 MB; **never needed, never forwarded** |
| 6 | WCS-WAVE | BINTABLE, NAXIS1=1056, NAXIS2=1 | wavelength lookup, below |

In the measured file IMAGE starts at byte 2880, FLAGS at 43200, VARIANCE at 74880, ZODI at
100800, EPSF at 126720, WCS-WAVE at 3994560. Offsets vary; always parse headers.

IMAGE header keys that matter (values from a real file, cutout centred on RA 210.80227,
Dec 54.34895, size 0.1 deg, detector 2):

```
NAXIS1=59 NAXIS2=59 BUNIT='MJy / sr' DETECTOR=2 OBSID='2026W25_2A_0279_1' EXPIDN=202625201027912
CTYPE1='RA---TAN-SIP' CTYPE2='DEC--TAN-SIP' CUNIT1='deg' CUNIT2='deg' RADESYS='ICRS'
CRPIX1=-625.5 CRPIX2=511.5 CRVAL1=208.4483499 CRVAL2=54.5491081503 CDELT1=1.0 CDELT2=1.0
PC1_1=0.00123274981054 PC1_2=-0.00118000897293 PC2_1=-0.00117635107879 PC2_2=-0.00123440903284
LONPOLE=180.0 LATPOLE=54.5491081503
A_ORDER=3 A_0_0=0.0905846568112 A_0_1=0.00142149437078 A_0_2=-2.32575728759E-09
A_0_3=2.12692602413E-11 A_1_0=-0.00040775220791 A_1_1=3.95116388931E-06 A_1_2=6.08925674497E-10
A_2_0=-7.40546138386E-09 A_2_1=9.58797339985E-12 A_3_0=6.24932043516E-10
B_ORDER=3 B_0_0=-1.14138384439 B_0_1=-0.00037568269309 B_0_2=1.94165517112E-06
B_0_3=4.94514136332E-10 B_1_0=-0.000119205208267 B_1_1=1.73252607291E-08 B_1_2=-2.05541848269E-11
B_2_0=6.56833753216E-06 B_2_1=6.30028459135E-10 B_3_0=-1.56259036826E-11
AP_ORDER=3 AP_0_0=-0.092314618979 AP_0_1=-0.00142224960004 AP_0_2=1.10099113746E-08
AP_0_3=-1.97302284155E-11 AP_1_0=0.000402194977753 AP_1_1=-3.93833797294E-06
AP_1_2=-5.84194146156E-10 AP_2_0=1.65539043149E-08 AP_2_1=-6.46051676537E-12 AP_3_0=-5.97770072336E-10
BP_ORDER=3 BP_0_0=1.13669351605 BP_0_1=0.000370299612606 BP_0_2=-1.93170896437E-06
BP_0_3=-4.85997193773E-10 BP_1_0=0.000120546016558 BP_1_1=3.10385882354E-10 BP_1_2=2.18904853902E-11
BP_2_0=-6.55630767898E-06 BP_2_1=-5.51398355215E-10 BP_3_0=1.53023228315E-11
PSF_FWHM=7.46070125580342
DATE-OBS='2026-06-19T19:01:07.407' MJD-OBS=61210.79244684 MJD-AVG=61210.79311303
MJD-END=61210.793779219 XPOSURE=113.5826 TIMESYS='UTC'
WCSNAMEW='Approximated per-pixel wavelength and bandwidth'
CTYPE1W='WAVE-TAB' CTYPE2W='WAVE-TAB' CUNIT1W='um' CUNIT2W='um' CRPIX1W=-1645.0 CRPIX2W=-508.0
CDELT1W=1 CDELT2W=1 CRVAL1W=1 CRVAL2W=1 PV1_3W=1 PV2_3W=2
PS1_0W='WCS-WAVE' PS2_0W='WCS-WAVE' PS1_1W='VALUES' PS2_1W='VALUES' PS1_2W='X' PS2_2W='Y'
CTYPE1A='LINEAR' CTYPE2A='LINEAR' CRPIX1A=-1645.0 CRPIX2A=-508.0 CRVAL1A=0.0 CRVAL2A=0.0
```

Important consequences:

- The reference pixel is the centre of the full 2040 x 2040 detector (1020.5, 1020.5), so in a
  cutout `CRPIX` is far outside the array and the SIP polynomial arguments `u = x_fits - CRPIX1`,
  `v = y_fits - CRPIX2` are hundreds of pixels. `PC` carries the pixel scale (CDELT = 1 deg).
  The SIP has non-zero zeroth and first order terms (`A_0_0`, `A_1_0`, ...); honour all terms.
- **Real test vector:** FITS pixel (30, 30) of that file must map to RA 210.8023, Dec 54.3490
  within 0.003 deg. Forward: `u' = u + sum A_p_q u^p v^q`, `v' = v + sum B_p_q u^p v^q`,
  `(xi, eta) = PC * (u', v')` in degrees, then gnomonic (TAN) deprojection about CRVAL.
- Wavelength: detector pixel (1-based) of a cutout FITS pixel `p` is
  `CRVAL1W + CDELT1W * (p - CRPIX1W)`, here `p + 1646`. Look that detector coordinate up in the
  WCS-WAVE table by bilinear interpolation.
- WCS-WAVE table: one row, three columns, big-endian: `X` = 11 int32
  `[1,205,409,613,817,1021,1224,1428,1632,1836,2040]`, `Y` = the same 11 int32, `VALUES` = 242
  float32 with `TDIM=(2,11,11)`. Index `VALUES[k + 2*(ix + 11*iy)]`, `k=0` wavelength (um),
  `k=1` bandwidth (um). Detector 2: wavelength runs from about 1.667 um at y=1 to 1.095 um at
  y=2040, with a slight smile along x (1.6677, 1.6611, 1.6563, ... 1.6501 ... 1.6675 at y=1).
  The table is identical in every file of a detector (verified byte-for-byte, 2025 vs 2026).
- Typical values in that cutout: image median 0.89, max 51.6 MJy/sr; zodi median 0.13;
  variance median 0.0010. 1 MJy/sr over one 6.15 arcsec pixel = 889 microJy.
- Detectors: D1 0.75-1.09 um, D2 1.10-1.62, D3 1.63-2.41, D4 2.42-3.82, D5 3.83-4.41,
  D6 4.42-5.00. Each detector covers 17 spectral channels (102 in total).
- One sky position has roughly 84 exposures per detector. Each exposure sees the position at a
  **different wavelength**, which is why naive blinking flickers.
- Survey passes revisit a position about every six months; data begin May 2025.

FLAGS bits (`MSKNnnnn` name, bit index):
0 TRANSIENT, 1 OVERFLOW, 2 SUR_ERROR, 6 NONFUNC, 7 DICHROIC, 9 MISSING_DATA, 10 HOT, 11 COLD,
12 FULLSAMPLE, 14 PHANMISS, 15 NONLINEAR, 17 PERSIST, 19 OUTLIER, 20 CROSSTALK, 21 SOURCE
(pixel mapped to a known source; **not** a defect), 22 GHOST, 23 GHOST_FPA, 24 GHOST_EXT,
25 STREAK, 26 BLOOM, 27 SNOWBALL, 28 HALO.
Default "bad pixel" mask for science = bits 0,1,2,6,9,10,11,15,17,19,25,26,27.

IRSA search (ADQL on `https://irsa.ipac.caltech.edu/TAP/sync`, about 20 s, often flaky):

```sql
SELECT a.uri, p.energy_bandpassname, p.time_bounds_lower
FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', <ra>, <dec>), p.poly)
ORDER BY p.time_bounds_lower
```

`uri` looks like
`ibe/data/spherex/qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits`
(release `qr3` or `dr1`; `.../2/...` and `D2` give the detector; `2026W25_2A_0279_1` is the
observation id). `energy_bandpassname` is `SPHEREx-D1` .. `SPHEREx-D6`. `time_bounds_lower` is
MJD. IRSA sends **no CORS headers**, so browsers cannot call it; everything goes through our proxy.

## Proxy HTTP API (`proxy/`)

Base URL in production: `https://api.batch-ly.com/functions/v1/spherex`. In dev: `/api` on the
dev server. All responses carry `Access-Control-Allow-Origin: *`. Errors are JSON
`{ "error": "<message>", "retryable": true|false }` with a 4xx/5xx status.

### `GET /search?ra=<deg>&dec=<deg>`

```json
{ "ra": 269.45, "dec": 4.74, "cached": false, "fetchedAt": "2026-11-15T07:00:00Z",
  "frames": [ { "id": "<uri>", "det": 2, "mjd": 61210.7924, "release": "qr3",
                "obsid": "2026W25_2A_0279_1" } ] }
```

Frames are sorted by `mjd`. `id` is the IRSA `uri` (path without host).

### `GET /cutout?id=<uri>&ra=<deg>&dec=<deg>&size=<deg>`

`size` is the cutout width in degrees, clamped to [0.02, 0.2]. Returns `application/octet-stream`
in the **TBF1** format, little-endian:

```
bytes 0..3   ASCII "TBF1"
bytes 4..7   uint32 LE: N = byte length of the JSON header (space-padded so 8+N is a multiple of 8)
bytes 8..8+N UTF-8 JSON header
then         raw arrays at the byte offsets given in header.arrays (offsets from start of file)
```

JSON header:

```json
{ "v": 1, "id": "<uri>", "release": "qr3", "obsid": "2026W25_2A_0279_1", "version": "7.0.5",
  "det": 2, "nx": 59, "ny": 59, "mjd": 61210.79311303, "exptime": 113.5826,
  "dateObs": "2026-06-19T19:01:07.407", "bunit": "MJy / sr", "psfFwhm": 7.46,
  "wcs": { "crpix": [-625.5, 511.5], "crval": [208.4483499, 54.5491081503],
           "pc": [[0.0012327, -0.0011800], [-0.0011764, -0.0012344]], "cdelt": [1, 1],
           "sip": { "aOrder": 3, "bOrder": 3, "apOrder": 3, "bpOrder": 3,
                    "a": { "0_0": 0.0906, "0_1": 0.00142 }, "b": {}, "ap": {}, "bp": {} } },
  "detXY0": [1647, 510],
  "waveCenter": 1.2345, "bwCenter": 0.031,
  "arrays": [ { "name": "image", "dtype": "f4", "offset": 2048, "length": 3481 },
              { "name": "variance", "dtype": "f4", "offset": 15972, "length": 3481 },
              { "name": "zodi", "dtype": "f4", "offset": 29896, "length": 3481 },
              { "name": "flags", "dtype": "i4", "offset": 43820, "length": 3481 },
              { "name": "wave", "dtype": "f4", "offset": 57744, "length": 3481 } ] }
```

`wcs.crpix` is the FITS 1-based CRPIX. `wcs.sip` may be `null`. `mjd` is `MJD-AVG` (fall back to
`MJD-OBS`). `detXY0` is the 1-based detector pixel of FITS pixel (1,1). `wave` holds the
wavelength in um of every pixel, row-major like the image. `waveCenter`/`bwCenter` are the
wavelength and bandwidth at the array centre. Array offsets are multiples of 4.

### `GET /gaia?ra=<deg>&dec=<deg>&radius=<deg>`

Gaia DR3 sources in the cone (radius clamped to 0.25 deg, at most 500, brightest first):

```json
{ "epoch": 2016.0, "stars": [ { "id": "4472832130942575872", "ra": 269.4485, "dec": 4.7380,
    "pmra": -801.551, "pmdec": 10362.394, "parallax": 546.98, "gmag": 8.2 } ] }
```

`pmra` is mu_alpha* (includes cos dec), mas/yr. Missing values are `null`.

### `GET /resolve?name=<text>`

```json
{ "name": "Barnard's Star", "ra": 269.4521, "dec": 4.6934, "epoch": 2000.0,
  "pmra": -802.8, "pmdec": 10362.5, "parallax": 547.0, "source": "sesame" }
```

Coordinates are at `epoch`; proper motion and parallax may be `null`. 404 if unknown.

### `GET /health`

`{ "ok": true, "version": "<semver>", "irsa": "up"|"down"|"unknown" }`

## Proxy modules (`proxy/src/`)

```js
// fits.js  (owner: proxy-fits)
parseHeaderBlock(u8, offset) -> { cards: Map<string, string|number|boolean>, headerBytes, dataBytes, paddedDataBytes } | null
//   null means "need more bytes". String values are unquoted and right-trimmed.
parseMef(u8) -> Hdu[]                      // Hdu = { name, header: Map, dataOffset, dataBytes }
readImage(u8, hdu) -> Float32Array|Int32Array  // big-endian FITS -> native typed array, applies BSCALE/BZERO
readWaveTable(u8, hdu) -> { x: Int32Array, y: Int32Array, values: Float32Array, nx: 11, ny: 11 }
async readUntilPsf(stream) -> Uint8Array   // reads a ReadableStream<Uint8Array> only until the EPSF
//   header has been seen, then cancels the stream and returns the bytes up to the end of ZODI.

// wavetab.js  (owner: proxy-fits)
waveAt(table, detX, detY) -> { wave, bandwidth }      // 1-based detector coords, bilinear, clamped
waveMap(table, header, nx, ny) -> Float32Array        // wavelength for every cutout pixel

// encode.js  (owner: proxy-fits)
buildFrame({ id, u8, waveTable }) -> Uint8Array       // u8 = bytes through ZODI; returns TBF1 bytes
decodeFrame(u8|ArrayBuffer) -> Frame                  // inverse; same shape as web/src/api.js Frame

// irsa.js  (owner: proxy-services)
searchFrames(ra, dec, { fetchImpl, timeoutMs }) -> Promise<FrameRef[]>
fetchCutoutHead(id, ra, dec, size, { fetchImpl }) -> Promise<Uint8Array>   // uses readUntilPsf
fetchWaveTable(det, sampleId, { fetchImpl }) -> Promise<table>             // full download, once per detector

// cache.js  (owner: proxy-services)
createMemoryCache() / createSupabaseCache({ url, serviceKey, bucket }) -> { get(key)->Uint8Array|null, put(key, u8, contentType) }

// handler.js  (owner: proxy-services)
createHandler({ fetchImpl, cache, backend }) -> (request: Request) => Promise<Response>
//   backend = 'irsa' | 'synthetic'. Routes on the last path segment (search, cutout, gaia, resolve, health).
```

`proxy/fixtures/synth.js` (owner: proxy-fits) exports
`makeSyntheticMef({ ra, dec, size, det, mjd, rollDeg, sources, seed }) -> Uint8Array` producing a
byte-accurate SPHEREx-style MEF (all seven HDUs, a small EPSF table, real WCS-WAVE layout,
TAN-SIP header with CRPIX outside the cutout), and
`syntheticSky(ra, dec) -> { frameRefs, sourcesAt(mjd) }`, a deterministic fake sky used by the dev
server: about 40 exposures per detector over three passes (2025-06, 2025-12, 2026-06), field
stars with smooth spectra, one fast mover (10 arcsec/yr), one variable star (factor 2), and a
methane-like absorber (deep dip at 3.3 um). Different exposures have different roll angles and
put the target at different detector rows, hence different wavelengths.

## Browser data model (`web/src/api.js`, owner: ui-shell)

```js
/** @typedef {Object} Frame
 * @property {string} id  @property {number} det  @property {number} nx  @property {number} ny
 * @property {number} mjd @property {number} exptime @property {string} release @property {string} obsid
 * @property {Object} wcs   // as in the TBF1 header
 * @property {Float32Array} image @property {Float32Array} variance @property {Float32Array} zodi
 * @property {Int32Array} flags   @property {Float32Array} wave
 * @property {number} waveCenter  @property {number} bwCenter @property {number} psfFwhm */
createApi(baseUrl) -> { search(ra,dec), cutout(id,ra,dec,size) -> Promise<Frame>, gaia(ra,dec,radius), resolve(name), health() }
decodeFrame(arrayBuffer) -> Frame
```

## Science library (`web/src/core/`)

A **Grid** is the common north-up tangent-plane raster everything is resampled to:
`{ ra0, dec0, n, scale }` = centre, `n x n` pixels, `scale` arcsec/pixel (default 3.075, half a
SPHEREx pixel). East is to the **left** (x decreases with RA), north is up **in display**, but
arrays are stored with `y` increasing north (row 0 = south); the viewer flips for display.
Grid pixel (x, y) centre: `xi_arcsec = -(x - (n-1)/2) * scale` (east positive xi),
`eta_arcsec = (y - (n-1)/2) * scale`.

A **Layer** is a frame resampled to the grid:
`{ frame, mjd, det, image, variance, wave, mask }` with `Float32Array(n*n)` data (zodi already
subtracted when requested) and `mask: Uint8Array(n*n)` (1 = unusable: off-frame, flagged or
non-finite).

```js
// wcs.js (owner: core-geometry)
makeWcs(wcs) -> { pixToSky(x, y) -> [ra, dec], skyToPix(ra, dec) -> [x, y] }   // 0-based pixels, full TAN-SIP
tanProject(ra, dec, ra0, dec0) -> [xi_deg, eta_deg];  tanDeproject(xi_deg, eta_deg, ra0, dec0) -> [ra, dec]
angSep(ra1, dec1, ra2, dec2) -> deg
gridSkyToPix(grid, ra, dec) -> [x, y];  gridPixToSky(grid, x, y) -> [ra, dec]
makeGrid(ra0, dec0, fovArcmin, scaleArcsec = 3.075) -> Grid
parseCoord(text) -> { ra, dec } | null   // "269.45 4.69", "17h57m48.5s +04d41m36s", "17:57:48.5 +04:41:36", "08h55m10.831s -7d14m42.53s"
formatCoord(ra, dec) -> { hms: string, dms: string, deg: string }

// reproject.js (owner: core-geometry)
reproject(frame, grid, { subtractZodi = true, badMask = DEFAULT_BAD_MASK }) -> Layer   // bilinear; nearest for flags/mask

// stretch.js (owner: core-geometry)
percentile(data, mask, p) -> number;  robustStats(data, mask) -> { median, sigma }   // sigma = 1.4826*MAD
autoRange(data, mask, { lo = 0.5, hi = 99.7 }) -> [vmin, vmax]
stretchValue(v, vmin, vmax, mode) -> 0..1          // mode: 'linear' | 'asinh' | 'log' | 'sqrt'

// time.js (owner: core-geometry)
mjdToDate(mjd) -> Date;  mjdToIso(mjd) -> 'YYYY-MM-DD HH:MM';  mjdToYear(mjd) -> decimal year;  yearToMjd(y) -> mjd

// flags.js (owner: core-geometry)
FLAG_BITS: [{ bit, name, description, bad }];  DEFAULT_BAD_MASK: number;  describeFlags(value) -> string[]

// frames.js (owner: core-spectral)
DETECTORS: [{ det, min, max, channels: 17 }]
splitPasses(items, gapDays = 45) -> Array<Array<item>>    // items have .mjd; sorted, split on gaps
channelOf(det, wave) -> 0..16;  channelRange(det, ch) -> [min, max]
groupLayers(layers) -> { passes: Layer[][], byChannel: Map<ch, Layer[]> }

// stack.js (owner: core-spectral)
stackLayers(layers, { method = 'wmean', clip = 3 }) -> { image, variance, count, mask }   // 'wmean' | 'median' | 'sum'
subtractImages(a, b) -> { image, mask }
backgroundLevel(layer) -> number            // robust per-layer sky offset

// skymodel.js (owner: core-spectral)   -- the signature feature
fitSkyModel(layers, { order = 2, clip = 3.5, iterations = 3 }) -> SkyModel
//   Per grid pixel, robust weighted polynomial fit of surface brightness vs ln(wavelength) across
//   all layers of ONE detector. SkyModel = { n, order, det, lnw0, coeffs: Float32Array(n*n*(order+1)),
//   rms: Float32Array(n*n), nUsed: Uint16Array(n*n) }
predictLayer(model, layer) -> Float32Array        // predicted image at that layer's per-pixel wavelengths
residualLayer(model, layer) -> { image, snr, mask }   // image - prediction, and residual / sigma
evalModelAt(model, wave) -> Float32Array          // monochromatic model image at one wavelength
changeMap(model, layers) -> { score: Float32Array, kind: Uint8Array }   // per-pixel significance of change; kind 0 none, 1 varies, 2 moved

// photometry.js (owner: core-spectral)
aperturePhot(frame, ra, dec, { rPix = 1.6, rIn = 3.5, rOut = 6 }) -> { flux_uJy, err_uJy, wave, bw, mjd, flagged, ok }
extractSpectrum(frames, ra, dec, opts) -> SpecPoint[]          // one point per native frame, sorted by wave
binSpectrum(points, { perChannel = true }) -> SpecPoint[]
lightCurve(points) -> [{ mjd, ratio, err, wave }]             // flux / smooth-spectrum model, for variability
MJYSR_TO_UJY_PER_PIX = 889

// lenses.js (owner: core-spectral)
LENSES: [{ id, label, description, band: [min,max], continuum: [[min,max], ...], dets: number[] }]
//   ids: 'methane' (3.3 vs 4.5), 'water' (3.05), 'co2' (4.27), 'co' (4.67), 'rgb' (three-detector colour)
lensImage(lens, layersByDet) -> { image: Float32Array, mask, label }      // absorption depth 1 - band/continuum
rgbComposite(r, g, b, ranges) -> Uint8ClampedArray(n*n*4)

// astrometry.js (owner: core-astrometry)
propagate(star, mjd, { parallax = true }) -> { ra, dec }      // star: { ra, dec, pmra, pmdec, parallax, epoch (decimal year) }
centroid(image, mask, n, x0, y0, { box = 5 }) -> { x, y, flux, ok }       // iterative flux-weighted, sub-pixel
fitMotion(points) -> { pmra, pmdec, total, paDeg, errTotal, n }           // points: [{ mjd, ra, dec, w }] -> mas/yr
matchGaia(stars, ra, dec, mjd, tolArcsec) -> star | null

// ephemeris.js (owner: core-astrometry)
earthPosition(mjd) -> [x, y, z]   // AU, heliocentric, equatorial J2000; low-precision analytic, good to ~1e-4 AU
parallaxOffset(ra, dec, distAU, mjd) -> { dra_arcsec (times cos dec), ddec_arcsec }   // apparent shift vs heliocentric direction

// distance.js (owner: core-astrometry)
predictedTrack(ra, dec, distAU, mjds, { motion } = {}) -> [{ mjd, ra, dec }]   // where a body at distAU, seen at (ra,dec) from the Sun, appears from Earth
shiftAndStack(layers, grid, offsetsArcsec) -> { image, variance, count, mask }  // integer+bilinear shifts then weighted mean

// targets.js (owner: core-astrometry)
TARGETS: [{ id, name, blurb, ra, dec, epoch, pmra, pmdec, parallax, det, fov, why }]   // the five challenge targets + extras
positionNow(target, mjd) -> { ra, dec }
```

## Page (`web/`)

`web/index.html` loads `web/styles.css` and `web/src/main.js` (module). Brand: Ink `#171715`
(background), Paper `#F7F2E7` (text), Signal `#E53C27` (accent, used sparingly), Stone `#77766E`
(secondary). Fonts: `"Arial Black"` for the wordmark and headings, Arial for text, Consolas /
monospace for numbers. Dark, calm, instrument-like. Works from 360 px wide to desktop. Must run
inside a sandboxed iframe with an opaque origin: wrap `localStorage`, `history.replaceState` and
clipboard calls in try/catch, and never rely on cookies.

API base: `window.TOMBAUGH_API` if set, else `?api=` query parameter, else `/api` when served
from localhost, else `https://api.batch-ly.com/functions/v1/spherex`.

URL state (all optional): `ra`, `dec` (deg), `name`, `fov` (arcmin: 2, 4, 6, 10; default 4), `det`
(1-6, default 3), `view` (`passes` default | `exposures` | `matched` | `residual` | `diff` |
`lens` | `distance`), `ch` (0-16), `lens`, `dist` (AU), `t` (frame index), `stretch`, `gaia` (0/1),
`flags` (0/1), `embed` (1 hides chrome).

```js
// state.js (owner: ui-shell)
createStore(initial) -> { get(), set(patch), subscribe(fn) -> unsubscribe }
readUrlState() -> partial state;  writeUrlState(state)

// loader.js (owner: ui-shell)
createLoader({ api, onProgress }) -> { load({ ra, dec, fov, det }) -> Promise<{ frames, grid, layers, failed }>, cancel() }
//   Concurrency 6, retries twice, tolerates failed frames, reports { done, total, phase }.

// render/viewer.js (owner: ui-viewer)
createViewer(container) -> viewer
viewer.setGrid(grid)
viewer.setImage({ image: Float32Array, mask?, range?: [vmin, vmax], stretch?, colormap?, diverging?: boolean }) // n*n scalar
viewer.setRgb(uint8ClampedArray)                    // n*n*4, alternative to setImage
viewer.setOverlays({ gaia?: [{ ra, dec, label?, moved?: boolean }], flags?: Uint8Array|null, markers?: [{ ra, dec, kind, label }], trail?: [{ ra, dec }] })
viewer.setCaption({ title, date, wave, note })
viewer.on('click', ({ ra, dec, x, y }) => {});  viewer.on('hover', ({ ra, dec, value }) => {})
viewer.toDataURL() -> string;  viewer.destroy()
//   Canvas 2D (no WebGL needed at these sizes). North up, east left, crisp nearest-neighbour by
//   default with a smooth toggle, compass, scale bar, crosshair, pan/zoom optional.

// render/colormaps.js (owner: ui-viewer)
COLORMAPS: { gray, heat, viridis, diverging };  applyColormap(name, t) -> [r, g, b]

// plots/spectrum.js, plots/lightcurve.js, plots/motion.js (owner: ui-plots)
createSpectrumPlot(container) -> { setData({ points, binned, model?, lens?, title }), clear(), toCsv() -> string }
createLightCurvePlot(container) -> { setData({ points, title }), clear() }
createMotionMeter(container) -> { setData({ measured: { pmra, pmdec, total, errTotal }, gaia: { pmra, pmdec, total } | null, track }), clear() }
//   SVG, no libraries, readable on dark background, tooltips, detector bands shaded.

// ui/* and main.js (owner: ui-shell) own the layout, controls, movie player (play/pause, speed,
// step, blink A/B), target tour, citation line, loading and error states, and wire everything.
```

Citation line for every view: "SPHEREx Level 2 spectral images, <release list> (IRSA, DOI
10.26131/IRSA629 for the mission archive; QR3 10.26131/IRSA662), retrieved <date>. Gaia DR3."
Keep DOIs in one constant so they are easy to correct.

## Dev server and tests

`node proxy/dev-server.mjs` serves `web/` at `http://localhost:8787/` and the API at `/api/*`
using the synthetic backend (`TOMBAUGH_BACKEND=irsa` switches to live IRSA). `tools/build.mjs`
inlines everything into `dist/tombaugh.html`. `test/e2e.mjs` drives the page with Playwright.

## Additions

### Fog of war (owner: fog-of-war)

A shared all-sky map of which patches anyone has opened. Storage is one small binary object in
the proxy cache (key `fog/nside32.bin`): `Uint16Array(12288)` little-endian visit counts indexed
by HEALPix **nested** pixel at nside 32 (cells about 1.8 deg across). Read-modify-write; a lost
increment under a race is acceptable.

```js
// proxy/src/fog.js (owner: fog-of-war)
fogRead(cache) -> Promise<Uint16Array>                 // zeros if missing
fogMark(cache, ra, dec) -> Promise<{ cell, count }>    // increments (saturating) and writes back
// web/src/fog/healpix.js (owner: fog-of-war): ang2pixNest(nside, ra, dec), pix2angNest(nside, ipix) -> [ra, dec], cellCorners(nside, ipix, steps)
// web/src/fog/fogmap.js (owner: fog-of-war)
createFogMap(container, { onPick({ ra, dec, cell, count }) }) -> { setCounts(Uint16Array), setHere(ra, dec), destroy() }
//   Canvas all-sky map (Mollweide, equatorial, RA increasing to the left) drawn dark where nobody
//   has looked and lit where they have, with the ecliptic and galactic plane as faint lines, the
//   five challenge targets marked, hover readout, click to pick a cell centre, and a
//   "take me somewhere nobody has looked" button. Shows "N of 12,288 patches opened (x%)".
```

HTTP (wired by proxy-services, logic in fog.js): `GET /fog` returns the raw 24,576-byte array
(`application/octet-stream`); `POST /fog?ra=<deg>&dec=<deg>` marks and returns `{ "cell": n, "count": c }`.
`web/src/api.js` adds `fog() -> Promise<Uint16Array>` and `fogMark(ra, dec)`.

### Landing and explainers (owner: ui-experience)

```js
// web/src/ui/landing.js
createLanding(container, { targets, onPick(target), onSearch(text), onSurprise() }) -> { show(), hide(), destroy() }
//   First screen when the URL has no coordinates: wordmark, one-sentence promise, a coordinate/name
//   search box, the five challenge targets as cards (each with a tiny animated canvas preview of
//   what the tool reveals for it: mover, pair, faint cold dwarf, irregular variable, long-period
//   variable), and an animated blink-comparator hero drawn on canvas (procedural, no image files).
// web/src/ui/explain.js
createExplainer(container) -> { show(topicId), hide() }   // short plain-language cards: 'flicker' (why naive blinking
//   flickers), 'residual', 'ghosts', 'lens', 'distance', 'flags', 'spectrum'. TOPICS exported.
// web/src/ui/fx.js
easing helpers, a requestAnimationFrame scheduler that pauses when the tab is hidden, and `prefersReducedMotion()`.
// web/src/ui/shortcuts.js
bindShortcuts(map) -> unbind;  SHORTCUTS list for the help overlay (space play/pause, arrows step, b blink, r residual, g Gaia, f flags, 1-6 detector, ? help)
```

`ui-shell` imports these and decides where they mount. All animation honours
`prefers-reduced-motion`.
