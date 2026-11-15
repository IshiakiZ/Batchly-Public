# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Check 1, reverse direction, step 1: Astropy WRITES a multi-extension FITS file, which our
JavaScript reader then has to read (c1_fits.mjs), and c1_fits.py compares.

Why: the synthetic files of the forward direction are written by proxy/fixtures/synth.js, by the
same engineer who wrote the reader, so a shared misunderstanding of the format would cancel out.
The SPHEREx pipeline writes its files with Astropy; this file is written the same way and
contains the header constructs a real file may contain that synth.js never produces: CONTINUE
long strings, quotes inside strings, HIERARCH cards, cards without a value, lower-case and
D exponents are not produced by Astropy, but E exponents, negative zero, very small and very
large numbers are; and the pixel types BITPIX 8, 16 (plain, unsigned via BZERO, scaled with
BLANK), 32, 64, -32, -64.

Deterministic: every array comes from numpy's default_rng with a fixed seed.
"""

import sys

import numpy as np
from astropy.io import fits

from cc import out_path, real_header

rng = np.random.default_rng(20261115)
ny, nx = 37, 59  # deliberately not square, so a swapped axis order cannot go unnoticed

primary = fits.PrimaryHDU()
h = primary.header
h["VERSION"] = ("7.0.5", "pipeline version")
h["LONGSTR"] = "A long string value that does not fit on one eighty-character card and so must be written with the CONTINUE convention; it ends here."
h["QUOTED"] = "Barnard's Star"
h["LEADSP"] = "  two leading blanks"
h["TINY"] = 1.25e-300
h["HUGE"] = -6.02214076e23
h["NEGZERO"] = -0.0
h["BIGINT"] = 202625201027912
h["FLAGT"] = True
h["FLAGF"] = False
h["UNDEF"] = fits.Undefined()
h["HIERARCH ESO LONG KEYWORD NAME"] = 42
h["COMMENT"] = "A comment card with = an equals sign in column nine or elsewhere"
h["HISTORY"] = "written by tools/crosscheck/c1_write.py"

image = rng.normal(0.9, 0.05, size=(ny, nx)).astype(np.float32)
image[3, 7] = np.nan
image[20, 58] = np.inf
image[0, 0] = -0.0
flags = np.zeros((ny, nx), dtype=np.int32)
flags[rng.random((ny, nx)) < 0.05] = 1 << 21
flags[5, 5] = -(2 ** 31)
flags[6, 6] = 2 ** 31 - 1
flags[7, 7] = (1 << 28) | (1 << 10) | 1

hdu_image = fits.ImageHDU(image, header=real_header(), name="IMAGE")
hdu_image.header["NAXIS1"] = nx
hdu_image.header["NAXIS2"] = ny
hdu_flags = fits.ImageHDU(flags, name="FLAGS")
hdu_f64 = fits.ImageHDU(rng.normal(size=(ny, nx)).astype(np.float64) * 1e-12, name="F64")
hdu_i16 = fits.ImageHDU(rng.integers(-32768, 32768, size=(ny, nx)).astype(np.int16), name="I16")
hdu_u16 = fits.ImageHDU(rng.integers(0, 65536, size=(ny, nx)).astype(np.uint16), name="U16")  # BZERO = 32768
hdu_u8 = fits.ImageHDU(rng.integers(0, 256, size=(ny, nx)).astype(np.uint8), name="U8")
hdu_i64 = fits.ImageHDU(rng.integers(-(2 ** 40), 2 ** 40, size=(ny, nx)).astype(np.int64), name="I64")

# Scaled 16-bit integers with a BLANK value, stored raw: physical = 5 + 0.01 * stored, and the
# stored value -32768 means "no data". (The scaling keywords are set after construction, which is
# how Astropy is told that the array already holds the stored integers.)
raw = rng.integers(-32000, 32000, size=(ny, nx)).astype(np.int16)
raw[2, 2] = -32768
hdu_scaled = fits.ImageHDU(raw, name="SCALED", do_not_scale_image_data=True)
hdu_scaled.header["BSCALE"] = 0.01
hdu_scaled.header["BZERO"] = 5.0
hdu_scaled.header["BLANK"] = -32768

# Plain 16-bit integers with a BLANK value and no scaling.
raw2 = rng.integers(-32000, 32000, size=(ny, nx)).astype(np.int16)
raw2[4, 4] = -32768
hdu_blank = fits.ImageHDU(raw2, name="BLANKINT", do_not_scale_image_data=True)
hdu_blank.header["BLANK"] = -32768

# A wavelength table with the layout of the real WCS-WAVE extension, but other numbers.
nodes = np.array([1, 205, 409, 613, 817, 1021, 1224, 1428, 1632, 1836, 2040], dtype=np.int32)
values = rng.uniform(1.0, 1.7, size=(11, 11, 2)).astype(np.float32)  # numpy (ny, nx, nk) = TDIM (2,11,11)
table = fits.BinTableHDU.from_columns(
    [
        fits.Column(name="X", format="11J", array=nodes[None, :]),
        fits.Column(name="Y", format="11J", array=nodes[None, :]),
        fits.Column(name="VALUES", format="242E", dim="(2,11,11)", unit="um", array=values[None, ...]),
    ],
    name="WCS-WAVE",
)

hdul = fits.HDUList([primary, hdu_image, hdu_flags, hdu_f64, hdu_i16, hdu_u16, hdu_u8, hdu_i64, hdu_scaled, hdu_blank, table])
hdul.writeto(out_path("astropy-written.fits"), overwrite=True, output_verify="exception")
print(f"  [astropy] check 1: wrote astropy-written.fits, {len(hdul)} HDUs")
sys.exit(0)
