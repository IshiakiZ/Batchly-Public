# Tombaugh contract, part 2: the AWS Open Data path and our own exposure index

Read `CONTRACT.md` first. This file adds a second, IRSA-independent data path. Reason: on the night of
Nov 14-15 2026 IRSA's TAP and SIA services returned `502 Proxy Error` for hours (twice), which leaves
the tool with no way to find exposures. NASA/IRSA also publish the same SPHEREx files in a public,
listable S3 bucket with HTTP Range support. We use it for two things:

1. **Exposure index** (critical): our own spatial index of every exposure, built from FITS headers, so a
   search takes milliseconds and never depends on TAP.
2. **S3 cutouts** (insurance): read only the rows we need out of the full 65 MB file with Range requests.

Everything below was measured on real files through a browser on Nov 15 2026.

> **Correction, Nov 15 2026 (measured on the live bucket).** A week directory does not have exactly
> one version prefix. All 151 directories have a main run (`l2b-v27-<year>-<day>/`) and 122 of
> them also have a small retry run (`l2b_retry-v27-<year>-<day>/`, a few to a few dozen
> exposures that were processed again; file names carry the same version text). The index
> therefore treats every `<release>/<dir>/<version>` folder as its own unit (storage root
> `index/v2/`), searches both, and keeps the retry copy when an exposure is in both.

## Bucket facts (verified)

- Base URL: `https://nasa-irsa-spherex.s3.amazonaws.com` (virtual-hosted, no region in the host; the
  `s3.us-west-2` host answers `PermanentRedirect`). Anonymous. `GET /?list-type=2&delimiter=/&prefix=...`
  works (XML, `<CommonPrefixes><Prefix>`, `<Contents><Key>..<Size>`, `<IsTruncated>`,
  `<NextContinuationToken>`; pass `continuation-token`, `max-keys` up to 1000). `Range: bytes=a-b`
  returns `206` with `Content-Range: bytes a-b/total`.
- Top-level prefixes: `dr1/`, `qr2/`, `qr3/` (+ `index.html`). QR2 is superseded by QR3. Rule: use every
  `dr<N>/` and only the highest-numbered `qr<N>/`; if the same week directory exists in a DR and a QR,
  prefer the DR.
- `dr1/level2/` has 110 directories `2025W17_4B/` .. `2026W20_1A/`; `qr3/level2/` has 41 directories
  `2026W20_2A/` .. `2026W40_2A/` (about 3.5 days of observing each). New weekly releases add directories.
- Inside a week directory: exactly one processing-version prefix, for example
  `qr3/level2/2026W25_2A/l2b-v27-2026-273/`, then `1/` .. `6/` (detector), then files
  `level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits`
  = `level2_<OBSID>D<det>_spx_<version>.fits` with `OBSID = <weekdir>_<NNNN>_<M>` (NNNN zero-padded
  sequence, M = 1..4). Directory `2026W25_2A` has 1804 D1 files and 1810 D2 files (a detector can be
  missing for an exposure; not every NNNN_M exists). Two list pages per detector directory took 0.6 s.
- The IRSA uri (`id` in CONTRACT.md) is exactly `'ibe/data/spherex/' + <S3 key>`.

## Full Level-2 file layout (verified on `qr3/.../2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits`, 64,546,560 bytes)

| HDU | offset | header bytes | content |
|---|---|---|---|
| PRIMARY | 0 | 2880 (6 cards) | no data |
| IMAGE | 2880 | 25920 (292 cards) | float32 2040x2040, big-endian, 16,646,400 bytes; data starts at byte 28800 |
| FLAGS | 16,675,200 | 17280 (204 cards) | **tile-compressed** BINTABLE: `ZIMAGE=T`, `ZCMPTYPE='RICE_1'`, `ZBITPIX=32`, `ZNAXIS1=ZNAXIS2=2040`, `ZTILE1=2040`, `ZTILE2=1` (one tile per image row), `ZNAME1='BLOCKSIZE' ZVAL1=32`, `ZNAME2='BYTEPIX' ZVAL2=4`, `NAXIS1=8`, `NAXIS2=2040`, `TFORM1='1PB(6141)'`, `PCOUNT=10646803` (varies per file), no `THEAP` card (heap starts right after the 2040x8-byte table) |
| VARIANCE | 27,357,120 (varies) | 11520 (120 cards) | float32 2040x2040 |
| ZODI | 44,015,040 (varies) | 11520 (123 cards) | float32 2040x2040 |
| EPSF | 60,672,960 (varies) | 5760 | BINTABLE 8752 x 441 |
| WCS-WAVE | file size - 5760 | 2880 | BINTABLE 1056 x 1 (2880 data bytes), same layout as in CONTRACT.md |

File sizes vary (64.5 to 65.5 MB) only because the compressed FLAGS heap varies. So IMAGE and the FLAGS
header are at fixed offsets; VARIANCE and ZODI offsets must be computed from the FLAGS header
(`offset + headerBytes + pad2880(NAXIS1*NAXIS2 + PCOUNT)`), and their own header sizes must be parsed or
verified, never assumed.

The full-file IMAGE header is the same as the cutout header in CONTRACT.md except: `NAXIS1=NAXIS2=2040`,
`CRPIX1=CRPIX2=1020.5`, `CRPIX1W=CRPIX2W=1`. Card positions in this file (0-based card index counted from
the start of the file, 36 cards per 2880 bytes): `DETECTOR` 46, `OBSID` 47, `CRPIX1` 127, `PC1_1` 129,
`CTYPE1` 137, `CRVAL1` 139, `CRVAL2` 140, `PSF_FWHM` 159, `A_ORDER` 193, `MJD-OBS` 253, `MJD-AVG` 257,
`CRPIX1W` 266, `END` 327. Do not rely on positions; parse the header. One request for bytes 0..28799
returns the primary and the complete IMAGE header.

A cutout made by IRSA from this file with `center=210.80227,54.34895d&size=0.1` has `NAXIS=59`,
`CRPIX1=-625.5`, `CRPIX2=511.5`, `CRPIX1W=-1645`, `CRPIX2W=-508`: so the cutout's first pixel is detector
pixel x=1647, y=510 (1-based), that is `CRPIX_cut = CRPIX_full - (x0 - 1)` with `x0 = 1647`.

### FITS tile compression, RICE_1 (what the FLAGS reader must implement)

Binary table row r (0-based, big-endian): `int32 nbytes, int32 heapOffset` (a `1PB` descriptor). The
compressed bytes of image row r are `heap[heapOffset .. heapOffset+nbytes)` where the heap begins at
`dataStart + NAXIS1*NAXIS2`. Each tile decompresses to `ZTILE1` = 2040 int32 values with the CFITSIO
`fits_rdecomp` algorithm (bsize 4): `fsbits = 5`, `fsmax = 25`, `bbits = 32`, block size 32.

```
lastpix = first 4 bytes as big-endian int32; c = 4
b = bytes[c++]; nbits = 8
for i in 0, 32, 64, ... < nx:
  nbits -= fsbits; while (nbits < 0) { b = (b << 8) | bytes[c++]; nbits += 8 }
  fs = (b >>> nbits) - 1; b &= (1 << nbits) - 1
  imax = min(i + 32, nx)
  if fs < 0:            every value in the block = lastpix
  else if fs == fsmax:  for each pixel: k = bbits - nbits; diff = b << k;
                          for (k -= 8; k >= 0; k -= 8) { b = bytes[c++]; diff |= b << k }
                          if (nbits > 0) { b = bytes[c++]; diff |= b >>> (-k); b &= (1 << nbits) - 1 } else b = 0
                          then un-zigzag and add
  else:                 for each pixel: while (b == 0) { nbits += 8; b = bytes[c++] }
                          nzero = nbits - (position of highest set bit of b, 1-based); nbits -= nzero + 1
                          b ^= 1 << nbits; nbits -= fs
                          while (nbits < 0) { b = (b << 8) | bytes[c++]; nbits += 8 }
                          diff = (nzero << fs) | (b >>> nbits); b &= (1 << nbits) - 1
                          then un-zigzag and add
  un-zigzag: diff = (diff & 1) ? ~(diff >>> 1) : (diff >>> 1);  value = (diff + lastpix) | 0;  lastpix = value
```
In C `b` is an unsigned 32-bit int. In JS keep it unsigned (`>>> 0`) or use arithmetic that cannot
overflow; `b << 8` must not go negative. Mean compressed row size in the sample file is 5.2 KB.

## Focal-plane geometry (verified)

All six detectors expose at once. D1/D4, D2/D5 and D3/D6 see the same sky; D1-D2-D3 sit side by side.
Headers of one exposure (`2026W25_2A_0279_1`, MJD-AVG 61210.79311303), CRPIX = 1020.5 for all:

| det | CRVAL1 | CRVAL2 | PC1_1 | PC1_2 | PC2_1 | PC2_2 |
|---|---|---|---|---|---|---|
| 1 | 203.245672412 | 57.074776311 | 0.0013519433669 | -0.0010984482376 | -0.0010481759429 | -0.00130936657274 |
| 2 | 208.4483499 | 54.5491081503 | 0.00123274981054 | -0.00118000897293 | -0.00117635107879 | -0.00123440903284 |
| 3 | 212.893828568 | 51.7466916852 | 0.0011252118048 | -0.00124393014935 | -0.00128984687451 | -0.00117239798481 |
| 4 | 203.212883655 | 57.0640758254 | 0.00135024354054 | -0.00110069678127 | -0.00104996614764 | -0.00130940273357 |
| 5 | 208.424186819 | 54.5389522846 | 0.00123557648256 | -0.00118440073813 | -0.00118440073813 | -0.00123557648256 |

Pixel scale from the PC columns is 6.13 to 6.16 arcsec. Other exposures for tests:
`2026W25_2A_0506_2` D1: CRVAL 111.292339525, -63.3167406276, PC 0.000194530094885, -0.00170381333933,
-0.00169955469884, -0.00012945991451, MJD-AVG 61211.835186664. DR1 `2025W30_1B_0009_1` D1: CRVAL
3.40805287656, 65.3983156426, PC -0.00131533332266, -0.00104090943207, -0.00109339332625, 0.0013551177306,
MJD-AVG 60877.037576803; same exposure D6: CRVAL 351.124600326, 60.0652606581, PC -0.00116649208456,
-0.00130157242042, -0.00126102056953, 0.0011107466594.

**Rigid-body model.** Build an attitude triad for a detector from its WCS: `b` = unit vector of CRVAL;
`e`, `n` = local east and north unit vectors at CRVAL; `ux = normalize(PC1_1*e + PC2_1*n)` (sky direction
of +x pixel), `uy` = `PC1_2*e + PC2_2*n` made orthogonal to `ux` and normalized; `A = [ux, uy, b]`.
Then for detector d, `A_d[j] = sum_i M_d[i][j] * A_1[i]` with constant matrices (row-major `M[i][j]`):

```
M2 = [0.99735647,-0.027309166,0.067337072, 0.027302803,0.999626694,0.001014964, -0.067339653,0.00082621,0.997729767]
M3 = [0.989315981,-0.056487661,0.134398784, 0.056463232,0.998396681,0.003996431, -0.134409049,0.003634857,0.990919268]
M4 = [0.999998155,-0.00191638,-0.00013151, 0.001916425,0.999998106,0.000338182, 0.000130862,-0.000338433,0.999999934]
M5 = [0.997285546,-0.029928082,0.067274435, 0.029907691,0.999551806,0.001310473, -0.067283503,0.000705107,0.997733648]
M6 = [0.989178966,-0.058822169,0.134405825, 0.058773226,0.998261946,0.004335336, -0.134427235,0.003611041,0.990916888]
```
Calibrated on `2026W25_2A_0279_1` and checked on the two other exposures above (one 11 months earlier,
in DR1): predicted boresights of D2..D6 were within 2.5 to 12.3 arcsec of the true headers, and the
predicted x-axis direction within 1 to 16 arcmin. That is 1 to 10 pixels at a detector edge: good enough
to decide which exposures cover a position (use a margin), never good enough for astrometry. The real
header of each file is always used for the science.

## Index design (owner: s3-index)

Storage goes through the same `cache` object as everything else (`get(key)`, `put(key, u8, type)`),
keys under `index/v1/`:

- `index/v1/dirs.json`: the S3 directory list `[{ release, dir, prefix, version }]`, refreshed when older
  than 6 hours (store `fetchedAt` inside).
- `index/v1/<release>/<dir>/list.json`: `{ release, dir, version, exposures: ["0001_1", ...] }` from the
  D1 listing (the part after `<dir>_` in the OBSID), sorted.
- `index/v1/<release>/<dir>/part-<k>.bin`: container `"TBX1"`, uint32 LE JSON length (padded so data
  starts on a multiple of 8), JSON `{ v:1, release, dir, version, start, count, exposures:[...] }`, then
  `Float64Array(count*7)` little-endian rows `mjd, crval1, crval2, pc11, pc12, pc21, pc22` of detector 1
  (`NaN` row when a header could not be read).
- `index/v1/<release>/<dir>/meta.json`: written when every part exists: `{ release, dir, version, n,
  parts, mjdMin, mjdMax, cells: "<base64 bitmap>" }`.
- `index/v1/manifest.json`: `{ builtAt, dirs: [meta...] }` assembled from the metas.

Coverage bitmap: 10-degree cells, 36 in RA by 18 in Dec (cell = floor(ra/10) + 36*floor((dec+90)/10),
648 bits), plus: treat Dec bands above +80 and below -80 as a single cell each (set all 36 bits). A cell
is set when any detector 1, 2 or 3 footprint touches it (sample a 5x5 lattice across each 2040-pixel
detector through the approximate WCS).

A search loads the manifest, keeps the directories whose bitmap has the target's cell, loads their parts
(memory LRU on top of the cache), and for every exposure and detector projects the target into detector
pixels with the approximate WCS (plain TAN, no SIP). A frame is returned when `margin <= x <= 2041-margin`
and the same for y (default margin 16 pixels).
