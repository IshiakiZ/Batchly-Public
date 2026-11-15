# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Check 4, Python half: the TBF1 frame and the Python client (clients/python/tombaugh.py).

Node encoded each synthetic file with buildFrame (c4_tbf1.mjs). Here:
  * the container is checked against the layout in CONTRACT.md (magic, padded JSON length,
    offsets, order and sizes of the arrays);
  * tombaugh.read_tbf1 decodes it; the arrays must equal, bit for bit, both what our own
    JavaScript decodeFrame returned and what Astropy reads from the FITS file the frame was
    built from; `wave` is compared with Astropy's -TAB evaluation;
  * every scalar and every WCS number in the frame header is compared with the FITS header as
    Astropy reads it;
  * tombaugh.wcs_of(frame) is compared with astropy.wcs.WCS of the original header and with the
    JavaScript makeWcs results of check 2;
  * tombaugh.to_hdulist(frame) is verified, written, read back and compared.
"""

import io
import json
import struct
import sys
import warnings

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from cc import CASES, Results, arr, describe_warnings, load_json, load_raw, nanmax, out_path, sep_mas

import tombaugh  # clients/python, put on sys.path by cc

R = Results(4, "TBF1 frame and Python client")
C2 = {s["name"]: s for s in load_json("c2_wcs.json")["subjects"]}
ARRAYS = [("image", "IMAGE", "<f4"), ("variance", "VARIANCE", "<f4"), ("zodi", "ZODI", "<f4"), ("flags", "FLAGS", "<i4"), ("wave", None, "<f4")]


def same_bits(a, b):
    a = np.ascontiguousarray(a)
    b = np.ascontiguousarray(b)
    return a.shape == b.shape and a.dtype == b.dtype and a.tobytes() == b.tobytes()


def same_values(a, b):
    """Equal values with NaN in the same places (NaN payload bits may differ between writers)."""
    a = np.asarray(a)
    b = np.asarray(b)
    if a.shape != b.shape:
        return False
    if a.dtype.kind == "f":
        return bool(np.array_equal(np.isnan(a), np.isnan(b)) and np.array_equal(a[~np.isnan(a)], b[~np.isnan(b)]))
    return bool(np.array_equal(a, b))


def quiet_wcs(header, **kw):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return WCS(header, **kw)


for case in CASES:
    name = case["name"]
    js = load_json(f"c4_{name}.json")
    path = out_path(f"{name}.tbf1")
    raw = open(path, "rb").read()
    hdul = fits.open(out_path(f"{name}.fits"), memmap=False)
    h = hdul["IMAGE"].header
    ny, nx = hdul["IMAGE"].data.shape

    # ---- container layout, read with nothing but struct and json -------------------------------
    bad = []
    if raw[:4] != b"TBF1":
        bad.append("magic is not TBF1")
    (n,) = struct.unpack_from("<I", raw, 4)
    if (8 + n) % 8:
        bad.append(f"8 + N = {8 + n} is not a multiple of 8")
    head = json.loads(raw[8 : 8 + n].decode("utf-8"))
    want = [("image", "f4"), ("variance", "f4"), ("zodi", "f4"), ("flags", "i4"), ("wave", "f4")]
    got = [(a["name"], a["dtype"]) for a in head["arrays"]]
    if got != want:
        bad.append(f"arrays are {got}")
    expect_offset = 8 + n
    for a in head["arrays"]:
        if a["offset"] % 4:
            bad.append(f"{a['name']} offset {a['offset']} is not a multiple of 4")
        if a["offset"] != expect_offset:
            bad.append(f"{a['name']} offset {a['offset']}, expected {expect_offset} (contiguous)")
        if a["length"] != nx * ny:
            bad.append(f"{a['name']} length {a['length']} != nx * ny")
        expect_offset = a["offset"] + 4 * a["length"]
    if expect_offset != len(raw):
        bad.append(f"file is {len(raw)} bytes, arrays end at {expect_offset}")
    if head.get("v") != 1:
        bad.append(f"v = {head.get('v')}")
    R.add(f"{name}: TBF1 container follows CONTRACT.md (magic, padding, offsets, order, sizes)", 5 + 3 * len(head["arrays"]), len(bad), "violations", tol=0, note="; ".join(bad)[:300])

    # ---- the client ----------------------------------------------------------------------------
    frame = tombaugh.read_tbf1(path)
    f2 = tombaugh.read_tbf1(raw)
    f3 = tombaugh.read_tbf1(io.BytesIO(raw))
    bad = []
    for key, _, dtype in ARRAYS:
        if frame[key].shape != (ny, nx):
            bad.append(f"{key} shape {frame[key].shape}")
        if frame[key].dtype != np.dtype(dtype):
            bad.append(f"{key} dtype {frame[key].dtype}")
        if not (same_bits(frame[key], f2[key]) and same_bits(frame[key], f3[key])):
            bad.append(f"{key}: path, bytes and file object give different arrays")
    try:
        tombaugh.read_tbf1(raw[: len(raw) - 100])
        bad.append("a truncated frame was accepted")
    except ValueError:
        pass
    try:
        tombaugh.read_tbf1(b"XXXX" + raw[4:])
        bad.append("a frame with a wrong magic was accepted")
    except ValueError:
        pass
    R.add(f"{name}: read_tbf1 shapes (ny, nx), dtypes, input kinds, rejection of damaged frames", 5 * 3 + 2, len(bad), "problems", tol=0, note="; ".join(bad)[:300])

    n_pix = 0
    bad = []
    for key, _, dtype in ARRAYS:
        ours = load_raw(f"{name}.tbf1.{key}", dtype).reshape(ny, nx)
        n_pix += ours.size
        if not same_bits(frame[key].astype(dtype), ours):
            bad.append(key)
    R.add(f"{name}: read_tbf1 arrays vs JavaScript decodeFrame, bit for bit", n_pix, len(bad), "arrays differing", tol=0, note=", ".join(bad))

    n_pix = 0
    bad = []
    for key, ext, dtype in ARRAYS:
        if ext is None:
            continue
        theirs = hdul[ext].data
        n_pix += theirs.size
        if not same_values(frame[key], theirs) or frame[key].dtype.name != theirs.dtype.name:
            bad.append(key)
    R.add(f"{name}: read_tbf1 image, variance, zodi, flags vs astropy.io.fits on the source file", n_pix, len(bad), "arrays differing", tol=0, note=", ".join(bad))

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ww = WCS(h, fobj=hdul, key="W")
    yy, xx = np.mgrid[0:ny, 0:nx]
    wave_a = ww.wcs_pix2world(np.column_stack([xx.ravel().astype(float), yy.ravel().astype(float)]), 0)[:, 0].reshape(ny, nx)
    R.add(f"{name}: read_tbf1 wave vs astropy -TAB", nx * ny, nanmax(np.abs(frame["wave"] - wave_a)), "um", tol=5e-7)

    # ---- header fields vs the FITS header ------------------------------------------------------
    bad = []
    n_fields = 0

    def check(label, got, want):
        global n_fields
        n_fields += 1
        if got != want:
            bad.append(f"{label}: frame {got!r}, FITS {want!r}")

    check("nx", frame["nx"], h["NAXIS1"])
    check("ny", frame["ny"], h["NAXIS2"])
    check("mjd (MJD-AVG)", frame["mjd"], h["MJD-AVG"])
    check("exptime (XPOSURE)", frame["exptime"], h["XPOSURE"])
    check("dateObs", frame["dateObs"], h["DATE-OBS"])
    check("bunit", frame["bunit"], h["BUNIT"])
    check("psfFwhm", frame["psfFwhm"], h["PSF_FWHM"])
    check("det", frame["det"], h["DETECTOR"])
    check("obsid", frame["obsid"], h["OBSID"])
    check("version", frame["version"], hdul[0].header["VERSION"])
    check("id", frame["id"], case["id"])
    check("release", frame["release"], case["id"].split("/")[3])
    w = frame["wcs"]
    check("crpix", w["crpix"], [h["CRPIX1"], h["CRPIX2"]])
    check("crval", w["crval"], [h["CRVAL1"], h["CRVAL2"]])
    check("cdelt", w["cdelt"], [h["CDELT1"], h["CDELT2"]])
    check("pc", w["pc"], [[h["PC1_1"], h["PC1_2"]], [h["PC2_1"], h["PC2_2"]]])
    for prefix, key, okey in (("A", "a", "aOrder"), ("B", "b", "bOrder"), ("AP", "ap", "apOrder"), ("BP", "bp", "bpOrder")):
        check(f"{prefix}_ORDER", w["sip"][okey], h[f"{prefix}_ORDER"])
        in_fits = {k[len(prefix) + 1 :]: h[k] for k in h if k.startswith(prefix + "_") and k != f"{prefix}_ORDER" and k[len(prefix) + 1 :].replace("_", "").isdigit()}
        check(f"{prefix} coefficients", w["sip"][key], in_fits)
        n_fields += len(in_fits)
    # the same fields as our JS decoder reports them (JSON round trip of the same header)
    for key, value in js["fields"].items():
        n_fields += 1
        if frame.get(key) != value:
            bad.append(f"{key}: Python {frame.get(key)!r}, JS {value!r}")
    if js.get("web") is not None:
        n_fields += 1
        if not js["web"]["arraysEqual"] or js["web"]["wcs"] != frame["wcs"] or js["web"]["mjd"] != frame["mjd"]:
            bad.append("web/src/api.js decodeFrame disagrees with proxy/src/encode.js decodeFrame")
    if not js["truncatedPathSameBytes"]:
        bad.append("buildFrame on bytes cut at the end of ZODI + separate wave table gives different bytes")
    R.add(f"{name}: frame header fields and WCS numbers vs FITS header (astropy), JS decoders, cut-at-ZODI path", n_fields, len(bad), "mismatches", tol=0, note="; ".join(bad)[:300])

    # ---- wcs_of ----------------------------------------------------------------------------------
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        wf = tombaugh.wcs_of(frame)
    msgs = describe_warnings(caught)
    w0 = quiet_wcs(h)
    worst = 0.0
    npts = 0
    for key in ("cutout", "detector"):
        p = C2[name]["pix"][key]
        x, y = arr(p["x"]), arr(p["y"])
        ra_f, dec_f = wf.all_pix2world(x, y, 0)
        ra_0, dec_0 = w0.all_pix2world(x, y, 0)
        worst = max(worst, nanmax(sep_mas(ra_f, dec_f, ra_0, dec_0)), nanmax(sep_mas(ra_f, dec_f, arr(p["ra"]), arr(p["dec"]))))
        npts += x.size
    R.add(f"{name}: wcs_of(frame) pixel -> sky vs astropy WCS of the source header and vs JS makeWcs (check 2)", npts, worst, "mas", tol=1e-3, note=("no astropy warning" if not msgs else "; ".join(msgs))[:200])
    q = C2[name]["sky"]["cutout"]
    xf, yf = wf.all_world2pix(arr(q["ra"]), arr(q["dec"]), 0, tolerance=1e-12, maxiter=100)
    R.add(f"{name}: wcs_of(frame) sky -> pixel vs JS makeWcs (check 2)", len(q["ra"]), nanmax(np.hypot(xf - arr(q["x"]), yf - arr(q["y"]))), "pixel", tol=1e-6)

    # ---- to_hdulist ------------------------------------------------------------------------------
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        out = tombaugh.to_hdulist(frame)
        problems = ""
        try:
            out.verify("exception")
        except Exception as err:
            problems = " ".join(str(err).split())
        repacked = out_path(f"{name}.repacked.fits")
        out.writeto(repacked, overwrite=True, output_verify="exception")
        back = fits.open(repacked, memmap=False)
        back.verify("exception")
        wb = WCS(back["IMAGE"].header)
        wba = WCS(back["IMAGE"].header, key="A")
    msgs = [m for m in describe_warnings(caught)]
    bad = []
    if problems:
        bad.append(problems)
    if [x.name for x in back] != ["PRIMARY", "IMAGE", "FLAGS", "VARIANCE", "ZODI", "WAVELENGTH"]:
        bad.append(f"HDUs {[x.name for x in back]}")
    for key, ext in (("image", "IMAGE"), ("flags", "FLAGS"), ("variance", "VARIANCE"), ("zodi", "ZODI"), ("wave", "WAVELENGTH")):
        if not same_values(back[ext].data, frame[key]) or back[ext].data.dtype.name != frame[key].dtype.name:
            bad.append(f"{ext} data changed")
    if msgs:
        bad.append("astropy warnings: " + "; ".join(msgs))
    R.add(f"{name}: to_hdulist verifies, writes, reads back with identical data and no astropy warning", 5 * nx * ny, len(bad), "problems", tol=0, note="; ".join(bad)[:300])
    p = C2[name]["pix"]["cutout"]
    x, y = arr(p["x"]), arr(p["y"])
    ra_b, dec_b = wb.all_pix2world(x, y, 0)
    ra_0, dec_0 = w0.all_pix2world(x, y, 0)
    R.add(f"{name}: WCS of the re-packed FITS file vs WCS of the source file", x.size, nanmax(sep_mas(ra_b, dec_b, ra_0, dec_0)), "mas", tol=1e-3)
    wa0 = quiet_wcs(h, key="A")
    da = np.abs(wba.wcs_pix2world(np.column_stack([x, y]), 0) - wa0.wcs_pix2world(np.column_stack([x, y]), 0)).max()
    R.add(f"{name}: detector coordinates (alternate WCS A) of the re-packed file vs the source file", x.size, float(da), "pixel", tol=1e-9)
    back.close()
    hdul.close()

text = tombaugh.citation(["qr3", "dr1"], retrieved="2026-11-15")
want = "SPHEREx Level 2 spectral images, DR1, QR3 (IRSA, DOI 10.26131/IRSA629 for the mission archive; QR3 10.26131/IRSA662), retrieved 2026-11-15. Gaia DR3."
R.add("citation() gives the contract's citation line", 1, 0 if text == want else 1, "mismatch", tol=0, note="" if text == want else text)
mask = sum(1 << b for b in (0, 1, 2, 6, 9, 10, 11, 15, 17, 19, 25, 26, 27))
R.add("tombaugh.DEFAULT_BAD_MASK equals the contract's bit list", 13, 0 if tombaugh.DEFAULT_BAD_MASK == mask else 1, "mismatch", tol=0)
R.note("fetch_frame (urllib) is not exercised: the build machine has no proxy to call. Its decoding path is read_tbf1, which is.")
sys.exit(R.save())
