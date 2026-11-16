# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Check 5, step 3: compare.

Forward  (Astropy/CFITSIO compressed, our riceDecompressInt32 decoded): every value of the
         2040 x 2040 image must equal the original.
Reverse  (our riceCompressInt32 compressed, Astropy decodes), two ways:
  a. every tile is decoded with Astropy's internal codec
     (astropy.io.fits.hdu.compressed._codecs.Rice1, the C routine from CFITSIO);
  b. a complete FITS file is assembled from Astropy's own header (PCOUNT and TFORM1 adjusted),
     freshly computed descriptors and OUR tiles as the heap, then opened with plain
     ``astropy.io.fits.open`` like any tile-compressed image.
Also reported: how many of our tiles are byte-identical to the ones Astropy wrote (rice.js says
its encoder is a port of CFITSIO's and should produce the same bytes).
"""

import sys

import numpy as np
from astropy.io import fits

from cc import Results, load_json, load_raw, out_path

R = Results(5, "RICE_1 tile compression")
node = load_json("c5_node.json")
facts = load_json("c5_astropy.json")

if node.get("missing"):
    R.skip("RICE_1", f"proxy/src/rice.js could not be imported: {node.get('error')}")
    sys.exit(R.save())

N = 2040
original = load_raw("rice_original.i4", "<i4", (N, N))

# What Astropy wrote, as required by the brief.
layout_ok = facts["ZTILE1"] == 2040 and facts["ZTILE2"] == 1 and facts["ZVAL1"] == 32 and facts["ZVAL2"] == 4 and facts["ZCMPTYPE"] == "RICE_1" and facts["ZBITPIX"] == 32
R.add(
    "Astropy wrote the SPHEREx FLAGS layout (RICE_1, ZBITPIX 32, ZTILE1 2040, ZTILE2 1, ZVAL1 32, ZVAL2 4)",
    6, 0 if layout_ok else 1, "differences", tol=0,
    note=f"ZTILE1={facts['ZTILE1']} ZTILE2={facts['ZTILE2']} ZVAL1={facts['ZVAL1']} ZVAL2={facts['ZVAL2']} TFORM1={facts['TFORM1']} PCOUNT={facts['PCOUNT']} THEAP={facts['THEAP']}",
)
same_header = all(node["facts"][k] == facts[k] for k in ("ZTILE1", "ZTILE2", "ZVAL1", "ZVAL2", "NAXIS1", "NAXIS2", "PCOUNT", "TFORM1")) and node["facts"]["dataOffset"] == facts["datLoc"]
R.add("our parseMef reads the same compressed-HDU header values and data offset as Astropy", 9, 0 if same_header else 1, "differences", tol=0)
R.add("descriptors cover the whole heap (largest offset + length = PCOUNT)", N, abs(node["heapUsed"] - facts["PCOUNT"]), "bytes", tol=0)

with fits.open(out_path("rice_astropy.fits"), memmap=False) as hdul:
    theirs = np.asarray(hdul[1].data)
R.add("sanity: Astropy reads back its own file", N * N, int(np.count_nonzero(theirs != original)), "pixels differing", tol=0)

decoded = load_raw("rice_decoded_js.i4", "<i4", (N, N))
R.add("forward: Astropy-compressed tiles decoded by riceDecompressInt32, every value", N * N, int(np.count_nonzero(decoded != original)), "pixels differing", tol=0)

R.add("our encoder followed by our decoder returns the input (all rows)", N, N - node["selfRoundTripRows"], "rows differing", tol=0)

# ---- reverse a: Astropy's internal codec on our tiles ------------------------------------------
heap = np.fromfile(out_path("rice_js_heap.bin"), dtype=np.uint8)
lengths = np.array(node["lengths"], dtype=np.int64)
offsets = np.concatenate([[0], np.cumsum(lengths)[:-1]])
try:
    from astropy.io.fits.hdu.compressed._codecs import Rice1

    codec = Rice1(blocksize=32, bytepix=4, tilesize=N)
    n_bad = 0
    for r in range(N):
        tile = np.ascontiguousarray(heap[offsets[r] : offsets[r] + lengths[r]])
        row = np.asarray(codec.decode(tile))
        if row.size != N or not np.array_equal(row.astype(np.int32), original[r]):
            n_bad += 1
    R.add("reverse a: riceCompressInt32 tiles decoded by Astropy's internal Rice1 codec (CFITSIO), all rows", N * N, n_bad, "rows differing", tol=0)
except ImportError as err:
    R.skip("reverse a: Astropy internal codec", f"not accessible in this Astropy version ({err})")

# ---- reverse b: a real file with our heap ------------------------------------------------------
raw = open(out_path("rice_astropy.fits"), "rb").read()
hdr_loc, dat_loc = facts["hdrLoc"], facts["datLoc"]
header_bytes = bytearray(raw[hdr_loc:dat_loc])


def replace_card(block, keyword, value, comment):
    card = fits.Card(keyword, value, comment).image.encode("ascii")
    assert len(card) == 80
    for i in range(0, len(block), 80):
        if block[i : i + 8].decode("ascii").strip() == keyword:
            block[i : i + 80] = card
            return
    raise KeyError(keyword)


replace_card(header_bytes, "PCOUNT", int(lengths.sum()), "number of group parameters")
replace_card(header_bytes, "TFORM1", f"1PB({int(lengths.max())})", "")
desc = np.empty((N, 2), dtype=">i4")
desc[:, 0] = lengths
desc[:, 1] = offsets
body = desc.tobytes() + heap.tobytes()
body += b"\0" * (-len(body) % 2880)
with open(out_path("rice_js.fits"), "wb") as f:
    f.write(raw[:hdr_loc] + bytes(header_bytes) + body)
problems = ""
try:
    with fits.open(out_path("rice_js.fits"), memmap=False) as hdul:
        hdul.verify("exception")
        ours = np.asarray(hdul[1].data)
        kind = type(hdul[1]).__name__
    n_bad = int(np.count_nonzero(ours != original)) if ours.shape == original.shape else N * N
except Exception as err:
    n_bad = N * N
    kind = "?"
    problems = f"{type(err).__name__}: {err}"
R.add("reverse b: FITS file with OUR tiles as the heap, opened by astropy.io.fits (CompImageHDU), every value", N * N, n_bad, "pixels differing", tol=0, note=problems[:200] or f"opened as {kind}")

R.add("our compressed tiles are byte-identical to Astropy's (CFITSIO) tiles, as rice.js states", N, N - node["identicalTiles"], "tiles differing", tol=0, note=f"heap {node['heapBytesJs']} bytes (ours) vs {facts['PCOUNT']} (Astropy)")
R.note(f"Compressed size: Astropy {facts['PCOUNT']} bytes, ours {node['heapBytesJs']} bytes for the same {N} x {N} int32 image ({N * N * 4} bytes raw).")
sys.exit(R.save())
