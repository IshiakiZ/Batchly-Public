# Tombaugh frames in Python

`tombaugh.py` is one file. It reads the binary frames (TBF1) that the Tombaugh proxy sends to the
browser, so the same cutouts can be opened in a notebook with numpy and Astropy. Copy the file
next to your script, or add this folder to `sys.path`.

Needs Python 3.9 or later, numpy and astropy. Nothing is downloaded unless you call `fetch_frame`.

## What is in it

| Function | What it does |
|---|---|
| `read_tbf1(path_or_bytes)` | Decodes a frame. Returns a dict: the header fields of the frame (`id`, `det`, `mjd`, `exptime`, `wcs`, `detXY0`, `waveCenter`, ...) and the arrays `image`, `variance`, `zodi`, `flags`, `wave`, each a numpy array of shape `(ny, nx)`. |
| `wcs_of(frame)` | The `astropy.wcs.WCS` of the frame (TAN-SIP, with every SIP coefficient the frame carries). |
| `wcs_header(frame)` | The same WCS as a `fits.Header`, if you want the cards. |
| `to_hdulist(frame)` | An `astropy.io.fits.HDUList`: PRIMARY, IMAGE, FLAGS, VARIANCE, ZODI, WAVELENGTH. It passes `verify('exception')` and can be written with `writeto`. |
| `fetch_frame(base_url, id, ra, dec, size)` | Asks a Tombaugh proxy for one cutout (`GET /cutout`) and decodes it. Uses `urllib` only. |
| `citation(frames, retrieved)` | The citation line for the data. |

Constants: `DEFAULT_BASE_URL`, `DEFAULT_BAD_MASK`, `FLAG_BITS`, `DOI_MISSION`, `DOI_RELEASES`.

## Example

```python
import numpy as np
import tombaugh

frame = tombaugh.read_tbf1("m101.tbf1")          # or bytes, or an open binary file
print(frame["id"], "detector", frame["det"], "MJD", frame["mjd"])

image = frame["image"] - frame["zodi"]            # MJy/sr, zodiacal light removed
good = (frame["flags"] & tombaugh.DEFAULT_BAD_MASK) == 0
sigma = np.sqrt(frame["variance"])
print("median surface brightness:", np.nanmedian(image[good]), frame["bunit"])
print("wavelength at the centre:", frame["wave"][frame["ny"] // 2, frame["nx"] // 2], "um")

wcs = tombaugh.wcs_of(frame)
ra, dec = wcs.all_pix2world(29.0, 29.0, 0)        # 0-based pixel (29, 29) is FITS pixel (30, 30)
x, y = wcs.all_world2pix(210.8023, 54.3490, 0)

tombaugh.to_hdulist(frame).writeto("m101_cutout.fits", overwrite=True)
print(tombaugh.citation([frame]))
```

To get a frame from a running proxy (the local dev server here; `id` comes from `GET /search`):

```python
frame = tombaugh.fetch_frame("http://localhost:8787/api", frame_id, 210.8023, 54.3490, 0.1)
```

## Conventions worth knowing

- **Arrays are `[row, column]` = `[y, x]`**, row 0 at the bottom, as Astropy reads FITS images.
  `frame["image"][y, x]` is the pixel the JavaScript calls `image[y * nx + x]`.
- **Pixels are 0-based**: the first pixel centre is (0, 0). `frame["wcs"]["crpix"]` is the FITS
  1-based CRPIX. With Astropy, pass `origin=0` for these 0-based pixels (as in the example) or
  `origin=1` for FITS pixel numbers. FITS pixel = 0-based pixel + 1.
- **Use `all_pix2world` and `all_world2pix`** on the WCS from `wcs_of`. The `wcs_*` variants skip
  the SIP distortion: on the real header that was 3 to 66 pixels wrong at the six points tried.
- **`image` still contains the zodiacal light.** Subtract `zodi` for a sky-subtracted image.
- **`variance` is a variance** in (MJy/sr)^2. The noise is its square root.
- **`flags`** is the SPHEREx bit mask (int32). `DEFAULT_BAD_MASK` is the set of bits the tool
  treats as bad; `FLAG_BITS` names every bit. Bit 21 (SOURCE) marks a known source and is not bad.
- **`wave`** is the central wavelength of each pixel in micrometres. It varies across the cutout,
  because every SPHEREx detector sits behind a linear variable filter.
- **`mjd`** is the middle of the exposure (MJD-AVG, UTC).
- **The FITS file from `to_hdulist` is a repackaged cutout**, not the IRSA file: no PSF cube, and
  the wavelength is an image HDU (WAVELENGTH) in place of the original lookup table. The alternate
  WCS `A` of each HDU gives the position on the 2040 x 2040 detector (1-based), from `detXY0`.

## Was it checked?

Yes. `tools/crosscheck/run.sh` compares what this file returns with the JavaScript decoder and
with Astropy reading the original FITS file: the arrays bit for bit, the WCS to better than
0.001 milliarcsecond, the repackaged FITS file through Astropy's own verification. The numbers are
in `docs/CROSSCHECK.md`. `fetch_frame` was run against the local dev server with synthetic data,
never against the deployed proxy or IRSA.

## Citation

If you use data obtained this way, cite each release used, as the tool does:

> SPHEREx Level 2 spectral images, DR1, QR3 (NASA/IPAC Infrared Science Archive; DR1 DOI 10.26131/IRSA678; QR3 DOI 10.26131/IRSA662), retrieved YYYY-MM-DD. Gaia DR3.

`tombaugh.citation(frames)` writes this line with today's date and the releases of the frames you
pass. The Gaia DR3 part applies when you use the tool's star positions.
