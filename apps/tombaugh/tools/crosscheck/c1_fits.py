# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Check 1, Astropy half: does astropy.io.fits read our synthetic files, and does it see exactly
what our JavaScript reader (proxy/src/fits.js) sees?

Forward direction, for every file written by makeSyntheticMef (c1_fits.mjs):
  * open with astropy.io.fits, every warning recorded; hdul.verify('exception');
  * HDU count, EXTNAME, kind, header and data byte offsets, data sizes;
  * every header card that carries a value: same keyword set, same value, same type;
  * every image HDU: shape, dtype, and pixel values bit for bit (NaN in the same pixels);
  * binary tables: column names, formats, byte offsets; the WCS-WAVE table values.

Reverse direction, for the file Astropy wrote (c1_write.py): the same comparisons, with physical
(BSCALE/BZERO-applied) pixel values, since that is what both readers return.
"""

import sys
import warnings

import numpy as np
from astropy.io import fits

from cc import CASES, Results, describe_warnings, load_json, load_raw, out_path

R = Results(1, "FITS reading")

JS_DTYPE = {"Float32Array": "<f4", "Int32Array": "<i4", "Float64Array": "<f8", "Int16Array": "<i2", "Uint8Array": "u1"}
# What proxy/src/fits.js readImage documents: BITPIX -> class, (unscaled, scaled).
JS_CLASS = {
    -32: ("Float32Array", "Float32Array"),
    32: ("Int32Array", "Float64Array"),
    16: ("Int16Array", "Float32Array"),
    8: ("Uint8Array", "Float32Array"),
    -64: ("Float64Array", "Float64Array"),
    64: ("Float64Array", "Float64Array"),
}


def kind_of(hdu):
    if isinstance(hdu, fits.PrimaryHDU):
        return "PRIMARY"
    if isinstance(hdu, fits.BinTableHDU):
        return "BINTABLE"
    if isinstance(hdu, fits.ImageHDU):
        return "IMAGE"
    return type(hdu).__name__


def compare_structure(name, hdul, js):
    bad = []
    if len(hdul) != len(js["hdus"]):
        bad.append(f"HDU count {len(hdul)} vs JS {len(js['hdus'])}")
    for hdu, j in zip(hdul, js["hdus"]):
        info = hdu.fileinfo()
        pairs = [
            ("name", hdu.name, j["name"]),
            ("type", kind_of(hdu), j["type"]),
            ("header offset", info["hdrLoc"], j["headerOffset"]),
            ("data offset", info["datLoc"], j["dataOffset"]),
            ("padded data bytes", info["datSpan"], j["paddedDataBytes"]),
            ("data bytes", hdu.size, j["dataBytes"]),
        ]
        for label, a, b in pairs:
            if a != b:
                bad.append(f"HDU {j['index']} {label}: astropy {a!r}, JS {b!r}")
    R.add(f"{name}: HDU names, kinds, byte offsets and sizes", 6 * len(hdul), len(bad), "mismatches", tol=0, note="; ".join(bad)[:300])


def compare_cards(name, hdul, js):
    n_cards = 0
    bad = []
    for hdu, j in zip(hdul, js["hdus"]):
        theirs = {}
        for card in hdu.header.cards:
            key = card.keyword
            # COMMENT, HISTORY and blank cards carry no value; HIERARCH cards (keyword longer than
            # 8 characters) are not standard keywords and our reader documents that it skips them.
            if key in ("COMMENT", "HISTORY", "") or len(key) > 8 or key in theirs:
                continue
            value = card.value
            theirs[key] = None if isinstance(value, fits.Undefined) else value
        ours = j["cards"]
        for key in sorted(set(theirs) | set(ours)):
            n_cards += 1
            if key not in ours:
                bad.append(f"HDU {j['index']} {key}: missing in JS")
            elif key not in theirs:
                bad.append(f"HDU {j['index']} {key}: missing in astropy")
            else:
                a, b = theirs[key], ours[key]
                same_type = (isinstance(a, bool) == isinstance(b, bool)) and (isinstance(a, str) == isinstance(b, str)) and ((a is None) == (b is None))
                if not same_type or a != b:
                    bad.append(f"HDU {j['index']} {key}: astropy {a!r}, JS {b!r}")
    R.add(f"{name}: header cards (keyword, value, type)", n_cards, len(bad), "mismatches", tol=0, note="; ".join(bad)[:300])


def compare_tables(name, hdul, js):
    n = 0
    bad = []
    for hdu, j in zip(hdul, js["hdus"]):
        if "columns" not in j:
            continue
        cols = hdu.columns
        offset = 0
        for col, jc in zip(cols, j["columns"]):
            n += 1
            form = f"{jc['repeat']}{jc['type']}"
            if col.name != jc["name"] or col.format != form or jc["offset"] != offset:
                bad.append(f"{hdu.name}.{col.name}: astropy {col.format} at byte {offset}, JS {jc['name']} {form} at byte {jc['offset']}")
            offset += hdu.data.dtype[col.name].itemsize
        if len(cols) != len(j["columns"]):
            bad.append(f"{hdu.name}: {len(cols)} columns vs JS {len(j['columns'])}")
        if "waveTable" in j:
            t = j["waveTable"]
            row = hdu.data[0]
            x, y, v = np.asarray(row["X"]), np.asarray(row["Y"]), np.asarray(row["VALUES"])
            n += x.size + y.size + v.size
            # astropy applies TDIM: VALUES comes back as (ny, nx, nk) in numpy order.
            if v.shape != (t["ny"], t["nx"], t["nk"]):
                bad.append(f"VALUES shape: astropy {v.shape}, JS (ny, nx, nk) = ({t['ny']}, {t['nx']}, {t['nk']})")
            if not np.array_equal(x, np.array(t["x"])) or not np.array_equal(y, np.array(t["y"])):
                bad.append("X or Y index vector differs")
            if not np.array_equal(v.astype("<f4").ravel(), np.array(t["values"], dtype="<f4")):
                bad.append("VALUES differ")
    R.add(f"{name}: binary tables (columns, WCS-WAVE X, Y, VALUES)", n, len(bad), "mismatches", tol=0, note="; ".join(bad)[:300])


def bits_differ(a, b):
    """Number of elements that are not identical: same NaN pixels, and every other value equal bit
    for bit (so +0 and -0 count as different)."""
    if a.dtype.kind != "f":
        return int(np.count_nonzero(a != b))
    nan_a, nan_b = np.isnan(a), np.isnan(b)
    both = ~nan_a & ~nan_b
    u = "<u4" if a.dtype.itemsize == 4 else "<u8"
    return int(np.count_nonzero(nan_a != nan_b)) + int(np.count_nonzero(a[both].view(u) != b[both].view(u)))


# ---- forward: our writer, both readers -----------------------------------------------------------

all_warnings = []
for case in CASES:
    name = case["name"]
    js = load_json(f"c1_{name}.json")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        hdul = fits.open(out_path(f"{name}.fits"), memmap=False)
        problems = ""
        try:
            hdul.verify("exception")
        except Exception as err:  # astropy raises VerifyError with the full list
            problems = " ".join(str(err).split())
    msgs = describe_warnings(caught)
    all_warnings += msgs
    R.add(f"{name}: astropy opens the file, verify('exception')", len(hdul), "clean" if not problems and not msgs else (problems or "; ".join(msgs))[:200], "", ok=not problems and not msgs)
    compare_structure(name, hdul, js)
    compare_cards(name, hdul, js)

    n_pix = 0
    bad = []
    for hdu, j in zip(hdul, js["hdus"]):
        if "file" not in j:
            continue
        data = hdu.data
        h = hdu.header
        shape = (h["NAXIS2"], h["NAXIS1"])
        ours = load_raw(j["file"], JS_DTYPE[j["array"]])
        if data.shape != shape or ours.size != data.size:
            bad.append(f"HDU {j['index']} shape: astropy {data.shape}, header {shape}, JS length {ours.size}")
            continue
        if np.dtype(JS_DTYPE[j["array"]]).name != data.dtype.name or j["array"] != JS_CLASS[h["BITPIX"]][0]:
            bad.append(f"HDU {j['index']} dtype: astropy {data.dtype.name}, JS {j['array']}")
        theirs = np.ascontiguousarray(data).astype(data.dtype.newbyteorder("<"))
        n_pix += data.size
        n_bad = bits_differ(theirs, ours.reshape(shape))
        if n_bad:
            bad.append(f"HDU {j['index']} ({hdu.name}): {n_bad} pixels differ")
    R.add(f"{name}: image pixels, bit for bit (IMAGE, FLAGS, VARIANCE, ZODI)", n_pix, len(bad), "HDUs differing", tol=0, note="; ".join(bad)[:300])
    compare_tables(name, hdul, js)
    hdul.close()

if all_warnings:
    for w in dict.fromkeys(all_warnings):
        R.note(f"astropy warning while opening a synthetic file: {w}")
else:
    R.note("astropy.io.fits raised no warning on open and hdul.verify('exception') found nothing in any synthetic file.")

# ---- reverse: Astropy's writer, both readers -----------------------------------------------------

name = "astropy-written"
try:
    js = load_json(f"c1_{name}.json")
except FileNotFoundError:
    js = None
    R.skip(f"{name}: reverse direction", "c1_write.py / c1_fits.mjs did not produce the dump")
if js is not None:
    raw = fits.open(out_path(f"{name}.fits"), memmap=False, do_not_scale_image_data=True)
    phys = fits.open(out_path(f"{name}.fits"), memmap=False)
    compare_structure(name, raw, js)
    compare_cards(name, raw, js)
    n_pix = 0
    bad = []
    notes = []
    worst_scaled = 0.0
    blank_note = ""
    for hraw, hphys, j in zip(raw, phys, js["hdus"]):
        if "file" not in j:
            continue
        h = hraw.header
        scaled = h.get("BSCALE", 1) != 1 or h.get("BZERO", 0) != 0
        want_class = JS_CLASS[h["BITPIX"]][1 if scaled else 0]
        if j["array"] != want_class:
            bad.append(f"{hraw.name}: JS returned {j['array']}, its documentation says {want_class}")
        theirs = np.asarray(hphys.data)
        ours = load_raw(j["file"], JS_DTYPE[j["array"]]).reshape(h["NAXIS2"], h["NAXIS1"])
        n_pix += theirs.size
        if theirs.shape != ours.shape:
            bad.append(f"{hraw.name}: shape astropy {theirs.shape}, JS {ours.shape}")
            continue
        if not scaled and "BLANK" in h and h["BITPIX"] > 0:
            # Integer image with BLANK but no scaling: Astropy converts to float and puts NaN in
            # the BLANK pixels; our reader documents that it applies BLANK only together with
            # BSCALE/BZERO and returns the stored integers. Compare the stored integers.
            stored = np.asarray(hraw.data)
            if not np.array_equal(stored.astype(np.int64), ours.astype(np.int64)):
                bad.append(f"{hraw.name}: stored integers differ")
            blank_note = (
                f"{hraw.name} (unscaled int16 with a BLANK card): Astropy returns {theirs.dtype.name} with NaN in the "
                f"{int(np.isnan(theirs).sum())} BLANK pixel(s); readImage returns the stored {j['array']} unchanged "
                "(documented: BLANK is honoured only together with BSCALE/BZERO). Only integer images can carry BLANK; in a SPHEREx file "
                "that is FLAGS alone, a bit mask that must stay integer, so nothing in the tool depends on this."
            )
        elif not scaled and theirs.dtype.name == ours.dtype.name:
            n_bad = bits_differ(np.ascontiguousarray(theirs).astype(theirs.dtype.newbyteorder("<")), ours)
            if n_bad:
                bad.append(f"{hraw.name}: {n_bad} pixels differ")
        else:
            # Different container types by design (JS has no int64 array it wants to use, and
            # returns floats for scaled integers): compare the numbers.
            a = theirs.astype(np.float64)
            b = ours.astype(np.float64)
            if not np.array_equal(np.isnan(a), np.isnan(b)):
                bad.append(f"{hraw.name}: NaN (BLANK) pixels differ")
                continue
            ok = ~np.isnan(a)
            if scaled:
                # The exact physical value is BZERO + BSCALE * stored, evaluated in float64. Our
                # reader must return that, rounded once to its container type. Astropy scales
                # 16-bit data in float32 arithmetic, so it can be a few 1e-6 away; report that.
                stored = np.asarray(hraw.data).astype(np.float64)
                exact = h.get("BZERO", 0) + h.get("BSCALE", 1) * stored
                want = exact.astype(ours.dtype)
                if not np.array_equal(want[ok], ours[ok]):
                    bad.append(f"{hraw.name}: {int(np.count_nonzero(want[ok] != ours[ok]))} values are not BZERO + BSCALE * stored")
                worst_scaled = max(worst_scaled, float(np.abs(a[ok] - b[ok]).max()))
            elif not np.array_equal(a[ok], b[ok]):
                bad.append(f"{hraw.name}: {int(np.count_nonzero(a[ok] != b[ok]))} values differ")
            notes.append(f"{hraw.name}: astropy {theirs.dtype.name}, JS {j['array']}")
    R.add(f"{name}: pixels of BITPIX 8, 16, 32, 64, -32, -64 and BZERO/BSCALE/BLANK images", n_pix, len(bad), "HDUs differing", tol=0, note="; ".join(bad)[:300])
    R.note("Astropy-written file, container types that differ by design (values equal): " + "; ".join(notes) + f". Scaled images: JS equals BZERO + BSCALE * stored (float64, rounded once) exactly; Astropy differs from that by at most {worst_scaled:.1e} because it scales 16-bit data in float32 arithmetic.")
    if blank_note:
        R.note(blank_note)
    compare_tables(name, raw, js)
    raw.close()
    phys.close()

sys.exit(R.save())
