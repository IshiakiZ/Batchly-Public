# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Check 3, Astropy half: the -TAB wavelength lookup.

SPHEREx describes the wavelength of every pixel with a FITS "-TAB" alternate WCS, key W
(Greisen et al. 2006, A&A 446, 747, section 6): CTYPE1W = CTYPE2W = 'WAVE-TAB', both axes share
one coordinate array (PS1_1W = PS2_1W = 'VALUES', TDIM (2, 11, 11)), axis 1 is indexed by column
'X' and axis 2 by column 'Y'; PV1_3W = 1 makes world axis 1 the first element of the array
(wavelength), PV2_3W = 2 makes world axis 2 the second (bandwidth).

Two references are used:
  A. Astropy / WCSLIB: ``WCS(header, fobj=hdul, key='W')`` and ``wcs_pix2world``.
     (``all_pix2world`` must NOT be used on this WCS: Astropy attaches the SIP polynomial of the
     celestial WCS to every key of the header, and would distort the detector coordinates before
     the table lookup. The script measures how large that error would be.)
  B. A numpy implementation written here straight from the paper (function ``tab_lookup``),
     independent of both WCSLIB and our JavaScript.
A and B are compared with each other, then our wavetab.js (waveMap, bandwidthMap, waveAt) and
the ``wave`` array of the TBF1 frame are compared with A at every pixel.
"""

import sys
import warnings

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from cc import CASES, Results, arr, describe_warnings, load_json, load_raw, nanmax, out_path

R = Results(3, "Wavelength lookup (-TAB)")
caught_all = []


def tab_wcs(header, hdul):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        w = WCS(header, fobj=hdul, key="W")
    caught_all.extend(describe_warnings(caught))
    return w


def tab_lookup(header, table_row, x, y):
    """-TAB lookup from the paper, for 0-based pixel coordinates x, y (arrays).

    Step 1 (eq. 1 of paper I with PC = identity): psi_m = CRVALm + CDELTm * (p_m - CRPIXm) with
    p the 1-based pixel. Step 2: find psi_m in the index vector Psi_m (1-based index k) and form
    the fractional index Upsilon_m = k + (psi_m - Psi_k) / (Psi_k+1 - Psi_k). Step 3: multilinear
    interpolation in the coordinate array at (Upsilon_1, Upsilon_2); element PVi_3 of the result
    is the coordinate of world axis i. Outside the index vector the paper permits extrapolation
    by at most half a cell; here anything outside is returned as NaN and treated separately.
    """
    out = []
    ups = []
    for axis, p in ((1, np.asarray(x, dtype=float) + 1.0), (2, np.asarray(y, dtype=float) + 1.0)):
        psi = header[f"CRVAL{axis}W"] + header[f"CDELT{axis}W"] * (p - header[f"CRPIX{axis}W"])
        index = np.asarray(table_row[header[f"PS{axis}_2W"]], dtype=float)
        k = np.clip(np.searchsorted(index, psi, side="right") - 1, 0, index.size - 2)
        frac = (psi - index[k]) / (index[k + 1] - index[k])
        inside = (psi >= index[0]) & (psi <= index[-1])
        ups.append((k, np.where(inside, frac, np.nan)))
    coords = np.asarray(table_row[header["PS1_1W"]], dtype=float)  # numpy shape (K2, K1, M)
    (kx, fx), (ky, fy) = ups
    for axis in (1, 2):
        m = int(header[f"PV{axis}_3W"]) - 1
        c = coords[..., m]
        v = (1 - fy) * ((1 - fx) * c[ky, kx] + fx * c[ky, kx + 1]) + fy * ((1 - fx) * c[ky + 1, kx] + fx * c[ky + 1, kx + 1])
        out.append(v)
    return out


def ulps32(a, b):
    """Difference in units of the float32 spacing at that value."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    return np.abs(a - b) / np.spacing(np.abs(b).astype(np.float32)).astype(np.float64)


driven = True
for case in CASES:
    name = case["name"]
    js = load_json(f"c3_{name}.json")
    hdul = fits.open(out_path(f"{name}.fits"), memmap=False)
    header = hdul["IMAGE"].header
    row = hdul["WCS-WAVE"].data[0]
    ny, nx = hdul["IMAGE"].data.shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    x, y = xx.ravel().astype(float), yy.ravel().astype(float)

    wave_b, bw_b = tab_lookup(header, row, x, y)
    try:
        w = tab_wcs(header, hdul)
        world = w.wcs_pix2world(np.column_stack([x, y]), 0)
        wave_a, bw_a = world[:, 0], world[:, 1]
    except Exception as err:  # WCSLIB could not be driven: fall back to the numpy reference
        driven = False
        R.note(f"{name}: astropy -TAB could not be driven ({type(err).__name__}: {err}); the numpy implementation of Greisen et al. 2006 is the only reference.")
        wave_a, bw_a = wave_b, bw_b

    if driven:
        d = max(nanmax(np.abs(wave_a - wave_b)), nanmax(np.abs(bw_a - bw_b)))
        R.add(f"{name}: astropy -TAB (WCSLIB) vs numpy implementation of the paper", 2 * x.size, d, "um", tol=1e-12)
        # What all_pix2world would have done (SIP applied to the detector coordinates):
        world_bad = w.all_pix2world(np.column_stack([x, y]), 0)
        R.add(f"{name}: (information) error if all_pix2world were used on key W instead of wcs_pix2world", x.size, nanmax(np.abs(world_bad[:, 0] - wave_a)), "um")

    ours_wave = load_raw(f"{name}.wave.bin", "<f4")
    ours_bw = load_raw(f"{name}.bw.bin", "<f4")
    tbf_wave = load_raw(f"{name}.tbfwave.bin", "<f4")
    ref = "astropy -TAB" if driven else "numpy -TAB"
    R.add(f"{name}: waveMap (wavetab.js) vs {ref}, every pixel", x.size, nanmax(np.abs(ours_wave - wave_a)), "um", tol=5e-7, note=f"{nanmax(ulps32(ours_wave, wave_a)):.2f} float32 ulp")
    R.add(f"{name}: bandwidthMap vs {ref}, every pixel", x.size, nanmax(np.abs(ours_bw - bw_a)), "um", tol=5e-7, note=f"{nanmax(ulps32(ours_bw, bw_a)):.2f} float32 ulp")
    R.add(f"{name}: `wave` array of the TBF1 frame vs {ref}, every pixel", x.size, nanmax(np.abs(tbf_wave - wave_a)), "um", tol=5e-7)
    R.add(f"{name}: TBF1 `wave` identical to waveMap", x.size, int(np.count_nonzero(tbf_wave != ours_wave)), "pixels differing", tol=0)

    # Scalars of the frame header.
    det0 = [header["CRVAL1W"] + header["CDELT1W"] * (1 - header["CRPIX1W"]), header["CRVAL2W"] + header["CDELT2W"] * (1 - header["CRPIX2W"])]
    # Alternate WCS 'A' is the 0-based detector pixel: an independent second statement of the same.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # the benign 'datfix' note, recorded in check 2
        wa = WCS(header, key="A")
    det0_a = wa.wcs_pix2world([[1.0, 1.0]], 1)[0] + 1.0
    d0 = max(abs(js["frame"]["detXY0"][0] - det0[0]), abs(js["frame"]["detXY0"][1] - det0[1]), abs(det0_a[0] - det0[0]), abs(det0_a[1] - det0[1]))
    R.add(f"{name}: detXY0 vs header key W and key A (1-based detector pixel of FITS pixel 1, 1)", 2, float(d0), "pixel", tol=0, note=f"detXY0 = {js['frame']['detXY0']}")
    cx, cy = (nx - 1) / 2, (ny - 1) / 2
    if driven:
        wc = w.wcs_pix2world([[cx, cy]], 0)[0]
    else:
        wc = [float(v[0]) for v in tab_lookup(header, row, [cx], [cy])]
    dc = max(abs(js["frame"]["waveCenter"] - wc[0]), abs(js["frame"]["bwCenter"] - wc[1]))
    R.add(f"{name}: waveCenter, bwCenter vs {ref} at the array centre", 2, float(dc), "um", tol=1e-12)

    # ---- whole detector: a file whose image IS the detector (CRPIXnW = 1) ----------------------
    lat = js["lattice"]
    hfull = fits.Header()
    for key in ("CTYPE1W", "CTYPE2W", "CUNIT1W", "CUNIT2W", "CDELT1W", "CDELT2W", "CRVAL1W", "CRVAL2W", "PV1_3W", "PV2_3W", "PS1_0W", "PS2_0W", "PS1_1W", "PS2_1W", "PS1_2W", "PS2_2W"):
        hfull[key] = header[key]
    hfull["CRPIX1W"] = 1.0
    hfull["CRPIX2W"] = 1.0
    full = fits.HDUList([fits.PrimaryHDU(), fits.ImageHDU(np.zeros((2, 2), dtype=np.float32), header=hfull, name="IMAGE"), hdul["WCS-WAVE"].copy()])
    lx, ly = arr(lat["x"]), arr(lat["y"])
    inside = (lx >= 1) & (lx <= 2040) & (ly >= 1) & (ly <= 2040)
    wave_fb, bw_fb = tab_lookup(hfull, row, lx - 1.0, ly - 1.0)
    if driven:
        wf = tab_wcs(hfull, full)
        # detector pixel (1-based) = FITS pixel of this pseudo full frame: origin 1
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            try:
                wd = wf.wcs_pix2world(np.column_stack([lx, ly]), 1)
            except Exception:
                # WCSLIB refuses the whole call when some points are outside the table: do the
                # inside points only.
                wd = np.full((lx.size, 2), np.nan)
                wd[inside] = wf.wcs_pix2world(np.column_stack([lx[inside], ly[inside]]), 1)
        wave_f, bw_f = wd[:, 0], wd[:, 1]
    else:
        wave_f, bw_f = wave_fb, bw_fb
    d = max(nanmax(np.abs(arr(lat["wave"])[inside] - wave_f[inside])), nanmax(np.abs(arr(lat["bw"])[inside] - bw_f[inside])))
    R.add(f"{name}: waveAt over the whole detector {case['args']['det']} (nodes, mid-points, fractional pixels) vs {ref}", int(inside.sum()), d, "um", tol=1e-9)
    # Half a pixel outside the table (detector coordinate 0.5 or 2040.5): we clamp.
    rim = ~inside
    if rim.any():
        ext = np.abs(arr(lat["wave"])[rim] - wave_f[rim])
        n_valid = int(np.isfinite(ext).sum())
        R.add(f"{name}: (information) outer half-pixel rim of the detector: JS clamps, WCSLIB extrapolates", int(rim.sum()), nanmax(ext) if n_valid else float("nan"), "um", note=f"WCSLIB gave a value at {n_valid} of {int(rim.sum())} rim points")
    # Far outside: our lookup must return the edge value.
    cl = js["clamp"]
    cxs, cys = np.clip(arr(cl["x"]), 1, 2040), np.clip(arr(cl["y"]), 1, 2040)
    wave_c, bw_c = tab_lookup(hfull, row, cxs - 1.0, cys - 1.0)
    dcl = max(nanmax(np.abs(arr(cl["wave"]) - wave_c)), nanmax(np.abs(arr(cl["bw"]) - bw_c)))
    R.add(f"{name}: waveAt outside the detector equals the value at the nearest edge (documented clamping)", len(cl["x"]), dcl, "um", tol=1e-9)
    hdul.close()

if driven:
    R.note("Astropy logs 'Inconsistent SIP distortion information' when the W (or A) WCS is built, because the header's SIP coefficients belong to the celestial WCS only; that is why wcs_pix2world (no SIP) is the right call for key W.")
    R.note("Astropy's WCSLIB -TAB support could be driven: WCS(header, fobj=hdul, key='W').wcs_pix2world. The numpy implementation is a second, independent reference and agrees with it.")
for msg in dict.fromkeys(caught_all):
    if "datfix" in msg:
        continue
    R.note(f"astropy message while building the W WCS: {msg}")
sys.exit(R.save())
