# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Check 5, step 1: Astropy writes a RICE_1 tile-compressed FLAGS-like image.

A 2040 x 2040 int32 image of flag-like values is written as a tile-compressed HDU with one tile
per image row, the layout of the FLAGS extension of a full SPHEREx Level-2 file
(CONTRACT-S3.md): ZCMPTYPE = 'RICE_1', ZBITPIX = 32, ZTILE1 = 2040, ZTILE2 = 1, BLOCKSIZE 32,
BYTEPIX 4. The header Astropy actually wrote is read back (without decompression) and saved, so
the next steps can state what was really tested.

The image is mostly realistic (zeros, SOURCE-bit patches, sparse defect bits) and has rows built
to reach every branch of the codec: constant rows, raw 32-bit noise (the escape code), values
that wrap around in 32-bit arithmetic, negative values (bit 31), ramps, single spikes.

Output: rice_astropy.fits, rice_original.i4 (little-endian int32, row-major), c5_astropy.json.
"""

import json
import sys

import numpy as np
from astropy.io import fits

from cc import out_path

N = 2040
rng = np.random.default_rng(5)
data = np.zeros((N, N), dtype=np.int32)

# Known-source patches (bit 21): discs of radius 1.5 to 4 pixels.
yy, xx = np.mgrid[0:N, 0:N]
for _ in range(2500):
    cx, cy, r = rng.uniform(0, N), rng.uniform(0, N), rng.uniform(1.5, 4.0)
    x0, x1 = max(0, int(cx - r - 1)), min(N, int(cx + r + 2))
    y0, y1 = max(0, int(cy - r - 1)), min(N, int(cy + r + 2))
    sub = (xx[y0:y1, x0:x1] - cx) ** 2 + (yy[y0:y1, x0:x1] - cy) ** 2 <= r * r
    data[y0:y1, x0:x1][sub] |= 1 << 21
# Sparse defects: TRANSIENT, NONFUNC, HOT, COLD, PERSIST, OUTLIER, and a large HALO region (bit 28).
for bit, frac in ((0, 6e-4), (6, 4e-4), (10, 1.2e-3), (11, 6e-4), (17, 2e-4), (19, 3e-4)):
    data[rng.random((N, N)) < frac] |= 1 << bit
data[1500:1560, 700:900] |= 1 << 28
data[1520:1530, 760:800] |= (1 << 26) | (1 << 1)

# Rows that exercise the codec branches.
data[0:10, :] = 0                                    # all differences zero
data[10, :] = 1 << 21                                # constant non-zero row
data[100:110, :] = rng.integers(-(2 ** 31), 2 ** 31, size=(10, N), dtype=np.int64).astype(np.int32)  # raw escape
data[100, 0:4] = [-(2 ** 31), 2 ** 31 - 1, -(2 ** 31), 2 ** 31 - 1]
data[200:210, :] = rng.integers(0, 16, size=(10, N))  # small noise, low split
data[210:220, :] = rng.integers(0, 1 << 14, size=(10, N))  # medium split
data[220:225, :] = rng.integers(0, 1 << 24, size=(5, N))   # split 22..24, next to the escape threshold
data[300:305, 0::2] = -(2 ** 31)                     # alternating extremes: differences wrap
data[300:305, 1::2] = 2 ** 31 - 1
data[400:405, :] = np.arange(N, dtype=np.int32) * 3 - 1000  # ramp crossing zero
data[410, :] = -1                                    # all bits set
data[420, :] = 0
data[420, 0] = 1 << 28                               # only the first pixel differs
data[430, :] = 0
data[430, N - 1] = 1 << 28                           # only the last pixel differs (short last block)
data[440, 1000] = -(2 ** 31)                         # one spike: a long run of unary zeros

hdu = fits.CompImageHDU(data, compression_type="RICE_1", tile_shape=(1, N), name="FLAGS")
fits.HDUList([fits.PrimaryHDU(), hdu]).writeto(out_path("rice_astropy.fits"), overwrite=True)
data.astype("<i4").tofile(out_path("rice_original.i4"))

with fits.open(out_path("rice_astropy.fits"), disable_image_compression=True) as hdul:
    h = hdul[1].header
    info = hdul[1].fileinfo()
    facts = {key: h.get(key) for key in ("ZIMAGE", "ZCMPTYPE", "ZBITPIX", "ZNAXIS1", "ZNAXIS2", "ZTILE1", "ZTILE2", "ZNAME1", "ZVAL1", "ZNAME2", "ZVAL2", "NAXIS1", "NAXIS2", "PCOUNT", "TFORM1", "THEAP", "TTYPE1")}
    facts["hdrLoc"] = info["hdrLoc"]
    facts["datLoc"] = info["datLoc"]
with open(out_path("c5_astropy.json"), "w", encoding="utf-8") as f:
    json.dump(facts, f)
print(f"  [astropy] check 5: wrote rice_astropy.fits; ZTILE1={facts['ZTILE1']} ZTILE2={facts['ZTILE2']} ZVAL1={facts['ZVAL1']} ZVAL2={facts['ZVAL2']} TFORM1={facts['TFORM1']} PCOUNT={facts['PCOUNT']}")
sys.exit(0)
