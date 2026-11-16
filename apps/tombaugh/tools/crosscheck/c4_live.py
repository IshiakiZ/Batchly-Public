# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Check 4, optional live part: tombaugh.fetch_frame over HTTP against the local dev server.

Starts ``node proxy/dev-server.mjs`` with the SYNTHETIC backend on a private port (no network
beyond localhost, no IRSA), asks /search for frames around a position, downloads three cutouts
with ``tombaugh.fetch_frame`` (urllib) and checks that what arrives is usable: shapes, the WCS
puts the requested position near the cutout centre, wavelengths lie in the detector's band, the
exposure time stamp matches the search result, and an unknown id is reported as an error.

This is an integration test of the client, not a comparison with Astropy. If the server cannot
be started (port in use, dev server changed) the rows are SKIP, never FAIL.
"""

import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

from cc import ROOT, Results

import tombaugh  # clients/python, put on sys.path by cc

R = Results("4L", "Python client over HTTP (local dev server, synthetic backend)")
PORT = int(os.environ.get("CROSSCHECK_PORT", "18787"))
BASE = f"http://127.0.0.1:{PORT}/api"
RA, DEC = 269.452075, 4.693391
BANDS = {1: (0.75, 1.09), 2: (1.10, 1.62), 3: (1.63, 2.41), 4: (2.42, 3.82), 5: (3.83, 4.41), 6: (4.42, 5.00)}

# localhost must not go through an outbound proxy
for key in ("no_proxy", "NO_PROXY"):
    os.environ[key] = "127.0.0.1,localhost"

env = dict(os.environ, PORT=str(PORT), HOST="127.0.0.1", TOMBAUGH_BACKEND="synthetic", TOMBAUGH_QUIET="1")
server = None
try:
    server = subprocess.Popen(["node", os.path.join(ROOT, "proxy", "dev-server.mjs")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    up = False
    for _ in range(50):
        if server.poll() is not None:
            break
        try:
            with urllib.request.urlopen(f"{BASE}/health", timeout=2) as r:
                up = json.loads(r.read().decode("utf-8")).get("ok") is True
                if up:
                    break
        except Exception:
            time.sleep(0.2)
    if not up:
        R.skip("fetch_frame over HTTP", f"dev server did not come up on port {PORT}")
    else:
        with urllib.request.urlopen(f"{BASE}/search?" + urllib.parse.urlencode({"ra": RA, "dec": DEC}), timeout=30) as r:
            found = json.loads(r.read().decode("utf-8"))["frames"]
        picks = [f for f in found if f["det"] == 3][:2] + [f for f in found if f["det"] == 6][:1]
        bad = []
        for ref in picks:
            frame = tombaugh.fetch_frame(BASE, ref["id"], RA, DEC, 0.1)
            ny, nx = frame["image"].shape
            if (ny, nx) != (frame["ny"], frame["nx"]) or frame["flags"].dtype != np.int32:
                bad.append(f"{ref['id']}: shapes or dtypes")
            if frame["id"] != ref["id"] or frame["det"] != ref["det"]:
                bad.append(f"{ref['id']}: id or detector differs from the search result")
            if abs(frame["mjd"] - ref["mjd"]) > 0.01:
                bad.append(f"{ref['id']}: mjd {frame['mjd']} vs search {ref['mjd']}")
            x, y = tombaugh.wcs_of(frame).all_world2pix(RA, DEC, 0)
            if abs(x - (nx - 1) / 2) > 1.5 or abs(y - (ny - 1) / 2) > 1.5:
                bad.append(f"{ref['id']}: requested position falls on pixel ({float(x):.2f}, {float(y):.2f}) of a {nx} x {ny} cutout")
            # The nominal bands are narrower than the detectors: the real detector-2 table runs
            # from 1.095 to 1.668 um for a nominal 1.10-1.62, i.e. up to 3 percent beyond.
            lo, hi = BANDS[frame["det"]]
            if not (lo * 0.99 <= np.nanmin(frame["wave"]) and np.nanmax(frame["wave"]) <= hi * 1.035):
                bad.append(f"{ref['id']}: wavelengths {np.nanmin(frame['wave']):.3f}..{np.nanmax(frame['wave']):.3f} outside detector {frame['det']}")
            hdul = tombaugh.to_hdulist(frame)
            hdul.verify("exception")
        R.add("fetch_frame: three cutouts from /search results decode, WCS centres the target, wavelengths in band", len(picks), len(bad), "problems", tol=0, note="; ".join(bad)[:300])
        try:
            tombaugh.fetch_frame(BASE, "ibe/data/spherex/qr3/level2/none.fits", RA, DEC, 0.1)
            R.add("fetch_frame: unknown id raises RuntimeError with the proxy's message", 1, 1, "problems", tol=0, note="no error raised")
        except RuntimeError as err:
            R.add("fetch_frame: unknown id raises RuntimeError with the proxy's message", 1, 0, "problems", tol=0, note=str(err)[:120])
except FileNotFoundError:
    R.skip("fetch_frame over HTTP", "node or proxy/dev-server.mjs not found")
except Exception as err:  # an integration hiccup must not fail the cross-check
    R.skip("fetch_frame over HTTP", f"{type(err).__name__}: {err}"[:200])
finally:
    if server is not None and server.poll() is None:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()

sys.exit(R.save())
