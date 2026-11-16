# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Check 7, Astropy half: reprojection onto the north-up grid.

Independent recomputation:
  1. Geometry with Astropy only. The Grid is written as a FITS TAN header (CRVAL = grid centre,
     CRPIX = (n-1)/2 + 1, CDELT = (-scale, +scale) arcsec: east left, row 0 south); every grid
     pixel centre goes grid -> sky with ``wcs_pix2world`` and sky -> native frame pixel with
     ``all_world2pix`` of the frame's TAN-SIP WCS (tolerance 1e-11 pixel).
  2. Resampling with numpy only, following the rules written at the top of reproject.js:
     bilinear interpolation of (image - zodi); a native pixel is bad when image, variance, wave
     (or zodi) is not finite or (flags & DEFAULT_BAD_MASK) != 0; a grid pixel is masked when it
     falls off the frame or its nearest native pixel is bad; otherwise the weights of the good
     neighbours are renormalised. Variance: same weights ('interp') or sum(w^2 var)/sum(w)^2
     ('propagate'). Wavelength: all in-frame neighbours.
  3. As a third opinion, the ``reproject`` package (reproject_interp, bilinear), if installed,
     on the pixels where no bad neighbour is involved.

"Noise" below is the square root of the reprojected variance of the same grid pixel.
The bad-pixel mask value is computed here from the bit list in CONTRACT.md, not taken from JS.
"""

import sys
import warnings

import numpy as np
from astropy.wcs import WCS

from cc import CASES, Results, load_json, load_raw, nanmax, out_path

import tombaugh  # clients/python, put on sys.path by cc

R = Results(7, "Reprojection onto the north-up grid")
BAD_MASK = sum(1 << b for b in (0, 1, 2, 6, 9, 10, 11, 15, 17, 19, 25, 26, 27))

try:
    import reproject as reproject_pkg
    from reproject import reproject_interp
except ImportError:
    reproject_pkg = None


def grid_wcs(grid):
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [grid["ra0"], grid["dec0"]]
    w.wcs.crpix = [(grid["n"] - 1) / 2 + 1, (grid["n"] - 1) / 2 + 1]
    w.wcs.cdelt = [-grid["scale"] / 3600.0, grid["scale"] / 3600.0]
    w.wcs.lonpole = 180.0
    return w


def resample(frame, px, py, subtract_zodi=True, variance="interp"):
    """numpy implementation of the documented resampling rules. px, py: native pixel position of
    every output pixel (0-based, any shape). Returns image, variance, wave, mask, plain where
    ``plain`` marks pixels for which all four neighbours were inside the frame and good."""
    img = frame["image"].astype(np.float32)
    var = frame["variance"].astype(np.float64)
    wav = frame["wave"].astype(np.float64)
    zod = frame["zodi"].astype(np.float32)
    ny, nx = img.shape
    bad = ~np.isfinite(img) | ~np.isfinite(var) | ((frame["flags"] & BAD_MASK) != 0) | ~np.isfinite(wav)
    if subtract_zodi:
        bad |= ~np.isfinite(zod)
        with np.errstate(invalid="ignore"):
            src = (img - zod).astype(np.float64)  # float32 subtraction, as stored by the JS
    else:
        src = img.astype(np.float64)

    inside = (px >= -0.5) & (px < nx - 0.5) & (py >= -0.5) & (py < ny - 0.5)
    pxs = np.where(inside, px, 0.0)
    pys = np.where(inside, py, 0.0)
    x0 = np.floor(pxs).astype(int)
    y0 = np.floor(pys).astype(int)
    fx = pxs - x0
    fy = pys - y0
    sw = np.zeros(px.shape)
    si = np.zeros(px.shape)
    sv = np.zeros(px.shape)
    sww = np.zeros(px.shape)
    swave = np.zeros(px.shape)
    n_good = np.zeros(px.shape, dtype=int)
    for dy in (0, 1):
        for dx in (0, 1):
            xx = x0 + dx
            yy = y0 + dy
            ok = (xx >= 0) & (xx < nx) & (yy >= 0) & (yy < ny)
            xc = np.clip(xx, 0, nx - 1)
            yc = np.clip(yy, 0, ny - 1)
            w = (fx if dx else 1 - fx) * (fy if dy else 1 - fy)
            wave_ok = ok & np.isfinite(wav[yc, xc])
            sww += np.where(wave_ok, w, 0.0)
            swave += np.where(wave_ok, w * np.where(np.isfinite(wav[yc, xc]), wav[yc, xc], 0.0), 0.0)
            good = ok & ~bad[yc, xc]
            n_good += good
            sw += np.where(good, w, 0.0)
            si += np.where(good, w * np.where(good, src[yc, xc], 0.0), 0.0)
            vv = np.where(good, var[yc, xc], 0.0)
            sv += np.where(good, (w * w if variance == "propagate" else w) * vv, 0.0)
    xn = np.clip(np.floor(pxs + 0.5).astype(int), 0, nx - 1)
    yn = np.clip(np.floor(pys + 0.5).astype(int), 0, ny - 1)
    mask = ~inside | bad[yn, xn] | ~(sw > 0)
    with np.errstate(invalid="ignore", divide="ignore"):
        image = np.where(mask, np.nan, si / sw)
        var_out = np.where(mask, np.nan, sv / (sw * sw if variance == "propagate" else sw))
        wave = np.where(inside & (sww > 0), swave / sww, np.nan)
    return image, var_out, wave, mask, (n_good == 4) & ~mask


for case in CASES:
    name = case["name"]
    js = load_json(f"c7_{name}.json")
    grid = js["grid"]
    n = grid["n"]
    frame = tombaugh.read_tbf1(out_path(f"{name}.tbf1"))
    ny, nx = frame["image"].shape

    R.add(f"{name}: DEFAULT_BAD_MASK (flags.js) equals the contract's bit list", 13, 0 if js["badMask"] == BAD_MASK else 1, "mismatch", tol=0)

    # ---- geometry --------------------------------------------------------------------------------
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wf = tombaugh.wcs_of(frame)
    wg = grid_wcs(grid)
    gy, gx = np.mgrid[0:n, 0:n]
    ra, dec = wg.wcs_pix2world(gx.astype(float), gy.astype(float), 0)
    px, py = wf.all_world2pix(ra, dec, 0, tolerance=1e-11, maxiter=100)
    mx = load_raw(f"{name}.rp.mapexact.x.bin", "<f8", (n, n))
    my = load_raw(f"{name}.rp.mapexact.y.bin", "<f8", (n, n))
    fxm = load_raw(f"{name}.rp.mapfast.x.bin", "<f8", (n, n))
    fym = load_raw(f"{name}.rp.mapfast.y.bin", "<f8", (n, n))
    R.add(f"{name}: grid pixel -> native pixel, exact path (mapGridToFrame exact) vs astropy", n * n, nanmax(np.hypot(mx - px, my - py)), "native pixel", tol=1e-6)
    R.add(f"{name}: grid pixel -> native pixel, default fast path (lattice every {js['fast']['step']} px) vs astropy", n * n, nanmax(np.hypot(fxm - px, fym - py)), "native pixel", tol=0.002 * np.sqrt(2), note=f"reproject.js allows 0.002 per axis; it measured {js['fast']['latticeError']:.1e}")

    # ---- resampling ------------------------------------------------------------------------------
    ref_img, ref_var, ref_wave, ref_mask, plain = resample(frame, px, py)
    sigma = np.sqrt(ref_var)

    def load(variant, what, dtype="<f4"):
        return load_raw(f"{name}.rp.{variant}.{what}.bin", dtype, (n, n))

    for variant, label in (("exact", "exact path"), ("fast", "default fast path")):
        img = load(variant, "image").astype(np.float64)
        var = load(variant, "variance").astype(np.float64)
        wave = load(variant, "wave").astype(np.float64)
        mask = load(variant, "mask", "u1").astype(bool)
        n_mask = int(np.count_nonzero(mask != ref_mask))
        tol_mask = 0 if variant == "exact" else max(4, int(0.001 * n * n))
        R.add(f"{name}: mask, {label}: pixels where JS and the numpy/astropy recomputation disagree", n * n, n_mask, "pixels", tol=tol_mask, note=f"{int(ref_mask.sum())} of {n * n} masked (off-frame or bad)" + ("" if variant == "exact" else "; a position error of 0.002 px can flip a pixel at a boundary"))
        both = ~mask & ~ref_mask
        nb = int(both.sum())
        finite_ok = bool(np.isfinite(img[~mask]).all() and np.isfinite(var[~mask]).all() and np.isfinite(wave[~mask]).all())
        R.add(f"{name}: {label}: mask = 0 implies finite image, variance and wave", int((~mask).sum()), 0 if finite_ok else 1, "violations", tol=0)
        d = (img - ref_img)[both] / sigma[both]
        tol_sigma = 1e-4 if variant == "exact" else 0.05
        R.add(f"{name}: image, {label}, where both valid: max |difference| / noise", nb, nanmax(np.abs(d)), "sigma", tol=tol_sigma, note=f"RMS {np.sqrt(np.mean(d ** 2)):.2e} sigma; max |difference| {nanmax(np.abs((img - ref_img)[both])):.2e} MJy/sr")
        # the easy pixels alone: four good neighbours, plain bilinear interpolation
        pb = both & plain
        dp = (img - ref_img)[pb] / sigma[pb]
        R.add(f"{name}: image, {label}, pixels with four good neighbours only (plain bilinear)", int(pb.sum()), nanmax(np.abs(dp)), "sigma", tol=tol_sigma, note=f"RMS {np.sqrt(np.mean(dp ** 2)):.2e} sigma")
        dv = np.abs(var - ref_var)[both] / ref_var[both]
        R.add(f"{name}: variance, {label}: max relative difference", nb, nanmax(dv), "", tol=1e-5 if variant == "exact" else 0.02)
        ww = np.isfinite(wave) & np.isfinite(ref_wave)
        nan_same = int(np.count_nonzero(np.isfinite(wave) != np.isfinite(ref_wave)))
        R.add(f"{name}: wavelength, {label}: max difference", int(ww.sum()), nanmax(np.abs(wave - ref_wave)[ww]), "um", tol=1e-6 if variant == "exact" else 2e-5, note=f"{nan_same} pixels finite on one side only")

    # zodi not subtracted, and propagated variance (exact geometry)
    r_img, r_var, _, r_mask, _ = resample(frame, px, py, subtract_zodi=False)
    img = load("nozodi", "image").astype(np.float64)
    mask = load("nozodi", "mask", "u1").astype(bool)
    both = ~mask & ~r_mask
    R.add(f"{name}: image without zodi subtraction (exact path): max |difference| / noise", int(both.sum()), nanmax(np.abs((img - r_img)[both]) / np.sqrt(r_var[both])), "sigma", tol=1e-4, note=f"{int(np.count_nonzero(mask != r_mask))} mask pixels differ")
    p_img, p_var, _, p_mask, _ = resample(frame, px, py, variance="propagate")
    var = load("prop", "variance").astype(np.float64)
    mask = load("prop", "mask", "u1").astype(bool)
    both = ~mask & ~p_mask
    R.add(f"{name}: variance: 'propagate' (exact path): max relative difference", int(both.sum()), nanmax(np.abs(var - p_var)[both] / p_var[both]), "", tol=1e-5)

    # ---- third opinion: the reproject package ----------------------------------------------------
    if reproject_pkg is not None:
        with np.errstate(invalid="ignore"):
            src = (frame["image"].astype(np.float32) - frame["zodi"].astype(np.float32)).astype(np.float64)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            rp, footprint = reproject_interp((src, wf), wg, shape_out=(n, n), order="bilinear")
        img = load("fast", "image").astype(np.float64)
        mask = load("fast", "mask", "u1").astype(bool)
        sel = plain & ~mask & np.isfinite(rp)
        d = (img - rp)[sel] / sigma[sel]
        R.add(f"{name}: image, default fast path vs reproject.reproject_interp (bilinear), four-good-neighbour pixels", int(sel.sum()), nanmax(np.abs(d)), "sigma", tol=0.05, note=f"RMS {np.sqrt(np.mean(d ** 2)):.2e} sigma; reproject {reproject_pkg.__version__}")
    else:
        R.skip(f"{name}: reproject package", "not installed (optional)")

    R.note(f"{name}: grid {n} x {n} at {grid['scale']} arcsec on a {nx} x {ny} frame; JS coverage {js['coverage'] * 100:.1f} %; median noise {np.nanmedian(sigma):.4f} MJy/sr.")

sys.exit(R.save())
