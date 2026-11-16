# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Check 2, Astropy half: world coordinates.

astropy.wcs.WCS is built
  * from the IMAGE header of each synthetic file (read with astropy.io.fits), and
  * from the REAL header of CONTRACT.md (every keyword, every SIP coefficient),
and compared with web/src/core/wcs.js makeWcs on the lattices dumped by c2_wcs.mjs.

Pixel conventions, stated once: our JavaScript uses 0-based pixels (first pixel centre = 0, 0);
FITS is 1-based (first pixel centre = 1, 1). Astropy's ``origin`` argument selects which of the
two the caller is using. Every comparison below passes our 0-based numbers with origin = 0; one
row repeats the forward transform as FITS pixels (x + 1, y + 1) with origin = 1 and requires the
same sky positions, so an off-by-one on either side cannot hide.

SIP: ``all_pix2world`` applies the forward SIP polynomial (A, B) and then the core WCS.
``all_world2pix`` inverts numerically the forward polynomial (it does not use AP/BP), which is
the exact inverse; it is run with tolerance 1e-12 pixel. Our skyToPix starts from AP/BP and
refines with Newton on the same forward polynomial, so the two should agree to rounding. For
information the AP/BP-only inverse (``wcs_world2pix`` + ``sip_foc2pix``) is also evaluated: it
shows how approximate the inverse polynomials in the header are.
"""

import sys
import warnings

import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS

from cc import CASES, REAL, Results, arr, describe_warnings, load_json, nanmax, out_path, real_header, sep_mas, wrap180

R = Results(2, "World coordinates (TAN-SIP, gnomonic projection, grid, coordinate strings)")
J = load_json("c2_wcs.json")

TOL_MAS = 1.0e-3  # required: 1 mas; what double precision should deliver: far below 0.001 mas
TOL_PIX = 1.0e-6  # required: 1e-3 pixel
REQ_MAS, REQ_PIX = 1.0, 1.0e-3

caught_all = []


def build_wcs(header):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        w = WCS(header)
    caught_all.extend(describe_warnings(caught))
    return w


def headers():
    out = {}
    for case in CASES:
        with fits.open(out_path(f"{case['name']}.fits"), memmap=False) as hdul:
            out[case["name"]] = hdul["IMAGE"].header.copy()
    out["real"] = real_header()
    return out


H = headers()

for s in J["subjects"]:
    name = s["name"]
    w = build_wcs(H[name])
    if w.sip is None:
        R.add(f"{name}: astropy sees the SIP distortion", 1, "no SIP", "", ok=False)
        continue

    # ---- pixel -> sky --------------------------------------------------------------------------
    for key in ("cutout", "detector", "beyond"):
        p = s["pix"][key]
        x, y = arr(p["x"]), arr(p["y"])
        ra, dec = w.all_pix2world(x, y, 0)
        d = sep_mas(ra, dec, arr(p["ra"]), arr(p["dec"]))
        where = {"cutout": "cutout, every half pixel", "detector": "whole 2040 x 2040 detector", "beyond": "+-1600 px about CRPIX"}[key]
        R.add(f"{name}: pixel -> sky, {where}", x.size, nanmax(d), "mas", tol=TOL_MAS)
        if key == "cutout":
            ra1, dec1 = w.all_pix2world(x + 1.0, y + 1.0, 1)
            d1 = sep_mas(ra1, dec1, arr(p["ra"]), arr(p["dec"]))
            R.add(f"{name}: same, given to astropy as FITS 1-based pixels (origin = 1)", x.size, nanmax(d1), "mas", tol=TOL_MAS)
        # our own round trip pixel -> sky -> pixel
        rt = np.hypot(arr(p["rx"]) - x, arr(p["ry"]) - y)
        R.add(f"{name}: JS round trip pixel -> sky -> pixel, {key}", x.size, nanmax(rt), "pixel", tol=TOL_PIX)

    # ---- sky -> pixel --------------------------------------------------------------------------
    for key in ("cutout", "detector"):
        q = s["sky"][key]
        ra, dec = arr(q["ra"]), arr(q["dec"])
        x, y = w.all_world2pix(ra, dec, 0, tolerance=1e-12, maxiter=100, quiet=False)
        d = np.hypot(x - arr(q["x"]), y - arr(q["y"]))
        where = {"cutout": "RA/Dec lattice +-0.06 deg about the cutout centre", "detector": "RA/Dec lattice +-1.5 deg about CRVAL"}[key]
        R.add(f"{name}: sky -> pixel, {where}", ra.size, nanmax(d), "pixel", tol=TOL_PIX)
        if key == "cutout":
            # AP/BP only, no refinement: how good are the inverse polynomials themselves?
            # wcs_world2pix gives the undistorted ("focal plane") position as a 1-based pixel;
            # astropy's sip_foc2pix wants it relative to CRPIX and returns a 1-based pixel.
            fx, fy = w.wcs_world2pix(ra, dec, 1)
            px, py = w.sip_foc2pix(fx - w.wcs.crpix[0], fy - w.wcs.crpix[1], 1)
            dap = np.hypot(px - 1 - x, py - 1 - y)
            R.add(f"{name}: (information) AP/BP inverse polynomial alone vs exact inverse", ra.size, nanmax(dap), "pixel")

# ---- the real test vector ---------------------------------------------------------------------------

tv = REAL["testVector"]
w = build_wcs(H["real"])
fx, fy = tv["fitsPixel"]
ra_a, dec_a = (float(v) for v in w.all_pix2world(fx, fy, 1))
ra_j, dec_j = J["testVector"]["ra"], J["testVector"]["dec"]
d_contract_js = max(abs(wrap180(ra_j - tv["ra"])), abs(dec_j - tv["dec"]))
d_contract_ap = max(abs(wrap180(ra_a - tv["ra"])), abs(dec_a - tv["dec"]))
R.add("real header: FITS pixel (30, 30) vs contract (210.8023, 54.3490), JS", 1, float(d_contract_js), "deg", tol=tv["tolDeg"], note=f"JS {ra_j:.7f}, {dec_j:.7f}")
R.add("real header: FITS pixel (30, 30) vs contract, astropy", 1, float(d_contract_ap), "deg", tol=tv["tolDeg"], note=f"astropy {ra_a:.7f}, {dec_a:.7f}")
R.add("real header: FITS pixel (30, 30), JS vs astropy", 1, float(sep_mas(ra_a, dec_a, ra_j, dec_j)), "mas", tol=TOL_MAS)

# ---- gnomonic projection functions ------------------------------------------------------------------

t = J["tan"]
ra0, dec0 = arr(t["ra0"]), arr(t["dec0"])
n = ra0.size
xi_a = np.empty(n)
eta_a = np.empty(n)
ra_a = np.empty(n)
dec_a = np.empty(n)
for i in range(n):
    # Plain TAN with CRPIX = 0 and unit CDELT: with origin = 1 the "pixel" coordinates ARE the
    # standard coordinates (xi, eta) in degrees. LONPOLE = 180 is stated because at a tangent
    # point exactly on the north pole the FITS default would be 0, which turns the axes by 180 deg.
    wt = WCS(naxis=2)
    wt.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wt.wcs.crval = [ra0[i], dec0[i]]
    wt.wcs.crpix = [0.0, 0.0]
    wt.wcs.cdelt = [1.0, 1.0]
    wt.wcs.lonpole = 180.0
    xi_a[i], eta_a[i] = wt.wcs_world2pix(t["ra"][i], t["dec"][i], 1)
    ra_a[i], dec_a[i] = wt.wcs_pix2world(t["xiIn"][i], t["etaIn"][i], 1)
d_plane = np.hypot(xi_a - arr(t["xi"]), eta_a - arr(t["eta"])) * 3.6e6
rho = np.hypot(arr(t["xi"]), arr(t["eta"]))
# The plane coordinate grows as tan(angle): compare absolutely near the tangent point and
# relatively far from it (at 60 deg the plane coordinate is 99 deg).
rel = d_plane / np.maximum(1.0, rho)
R.add("tanProject vs astropy TAN (offsets 1e-9 to 60 deg, tangent points incl. both poles)", n, nanmax(rel), "mas per deg of offset (min 1 deg)", tol=TOL_MAS)
d_sky = sep_mas(ra_a, dec_a, arr(t["raOut"]), arr(t["decOut"]))
R.add("tanDeproject vs astropy TAN", n, nanmax(d_sky), "mas", tol=TOL_MAS)

q = J["sep"]
c1 = SkyCoord(arr(q["ra1"]) * u.deg, arr(q["dec1"]) * u.deg)
c2 = SkyCoord(arr(q["ra2"]) * u.deg, arr(q["dec2"]) * u.deg)
sep_a = c1.separation(c2).deg
ds = np.abs(sep_a - arr(q["sep"])) * 3.6e6
R.add("angSep vs SkyCoord.separation (random, tiny and near-antipodal pairs)", sep_a.size, nanmax(ds), "mas", tol=TOL_MAS)

# ---- the Grid ---------------------------------------------------------------------------------------

worst_sky = 0.0
worst_pix = 0.0
npts = 0
for g in J["grids"]:
    grid = g["grid"]
    wg = WCS(naxis=2)
    wg.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wg.wcs.crval = [grid["ra0"], grid["dec0"]]
    # Grid pixel (x, y), 0-based: xi = -(x - (n-1)/2) * scale, eta = (y - (n-1)/2) * scale.
    # As a FITS header: CRPIX = (n-1)/2 + 1, CDELT1 = -scale, CDELT2 = +scale.
    wg.wcs.crpix = [(grid["n"] - 1) / 2 + 1, (grid["n"] - 1) / 2 + 1]
    wg.wcs.cdelt = [-grid["scale"] / 3600.0, grid["scale"] / 3600.0]
    wg.wcs.lonpole = 180.0
    ra, dec = wg.wcs_pix2world(arr(g["x"]), arr(g["y"]), 0)
    worst_sky = max(worst_sky, nanmax(sep_mas(ra, dec, arr(g["ra"]), arr(g["dec"]))))
    x, y = wg.wcs_world2pix(arr(g["skyRa"]), arr(g["skyDec"]), 0)
    worst_pix = max(worst_pix, nanmax(np.hypot(x - arr(g["bx"]), y - arr(g["by"]))))
    npts += len(g["x"])
R.add("Grid: gridPixToSky vs astropy TAN header (CRPIX = (n-1)/2 + 1, CDELT = -scale, +scale)", npts, worst_sky, "mas", tol=TOL_MAS)
R.add("Grid: gridSkyToPix vs astropy", npts, worst_pix, "grid pixel", tol=TOL_PIX)

# ---- coordinate strings -----------------------------------------------------------------------------

worst = 0.0
bad = []
for p in J["parse"]:
    text = p.get("astropy", p["text"])
    unit = (u.hourangle, u.deg) if p["units"] == "hourangle" else (u.deg, u.deg)
    c = SkyCoord(text, unit=unit)
    if p["result"] is None:
        bad.append(f"{p['text']!r}: parseCoord returned null")
        continue
    d = float(sep_mas(c.ra.deg, c.dec.deg, p["result"]["ra"], p["result"]["dec"]))
    worst = max(worst, d)
    if d > TOL_MAS:
        bad.append(f"{p['text']!r}: {d:.3g} mas (JS {p['result']}, astropy {c.ra.deg}, {c.dec.deg})")
R.add("parseCoord vs SkyCoord string parsing (contract examples and others)", len(J["parse"]), worst, "mas", ok=not bad, tol=TOL_MAS, note="; ".join(bad)[:300])

f = J["format"]
c = SkyCoord([f"{p['hms']} {p['dms']}" for p in f], unit=(u.hourangle, u.deg))
d = sep_mas(c.ra.deg, c.dec.deg, arr([p["ra"] for p in f]), arr([p["dec"] for p in f]))
# formatCoord prints 0.01 s of time and 0.1 arcsec: rounding can move a position by up to
# 0.075 arcsec in RA and 0.05 arcsec in Dec.
R.add("formatCoord strings read back by astropy vs the position formatted", len(f), nanmax(d), "mas", tol=1000 * float(np.hypot(0.075, 0.05)) + 1e-3, note="limit = rounding of the printed digits")

# ---- focalplane.js ----------------------------------------------------------------------------------

if J.get("focalplane"):
    worst_sky = 0.0
    worst_pix = 0.0
    npts = 0
    for d in J["focalplane"]:
        wf = WCS(naxis=2)
        wf.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        wf.wcs.crval = d["crval"]
        wf.wcs.crpix = [d["crpix"], d["crpix"]]
        wf.wcs.cdelt = [1.0, 1.0]
        wf.wcs.pc = [[d["pc"][0], d["pc"][1]], [d["pc"][2], d["pc"][3]]]
        wf.wcs.lonpole = 180.0
        ra, dec = wf.wcs_pix2world(arr(d["x"]), arr(d["y"]), 1)  # focalplane.js uses 1-based pixels
        worst_sky = max(worst_sky, nanmax(sep_mas(ra, dec, arr(d["ra"]), arr(d["dec"]))))
        x, y = wf.wcs_world2pix(arr(d["skyRa"]), arr(d["skyDec"]), 1)
        worst_pix = max(worst_pix, nanmax(np.hypot(x - arr(d["bx"]), y - arr(d["by"]))))
        npts += len(d["x"])
    R.add("focalplane.js detPixToSky vs astropy plain TAN (8 real detector headers, 1-based pixels)", npts, worst_sky, "mas", tol=TOL_MAS)
    R.add("focalplane.js skyToDetPix vs astropy", npts, worst_pix, "pixel", tol=TOL_PIX)
else:
    R.skip("focalplane.js", f"module not importable: {J.get('focalplaneError', 'missing')}")

R.note(f"Tolerances used: {TOL_MAS} mas and {TOL_PIX} pixel, a thousand times tighter than the 1 mas / 1e-3 pixel the brief asks for ({REQ_MAS} mas, {REQ_PIX} pixel).")
for msg in dict.fromkeys(caught_all):
    R.note(f"astropy warning while building a WCS: {msg}")
sys.exit(R.save())
