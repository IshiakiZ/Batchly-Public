# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Check the checker: put a known fault into a COPY of the code and see whether run.sh notices.

A cross-check that passes says little unless it would have failed on a wrong program. This
script copies the parts of the repository the cross-check needs into a temporary directory
(the repository itself is never touched), changes one line of one file, runs the whole
cross-check on the copy, and records which checks fail. It does that once per fault.

  PYTHON=/path/to/venv/bin/python
  $PYTHON tools/crosscheck/selftest.py              # all faults, 4 at a time
  $PYTHON tools/crosscheck/selftest.py wcs rice     # only faults whose name contains a word

Each fault is (name, file, text to find, replacement, checks expected to fail). The text must
occur exactly once in the file; if the code under test has changed so that it no longer does,
the fault is reported as STALE and the script exits 1, so a stale list cannot pass silently.
Faults marked `small` are below the tolerance of the checks on purpose: they show how large an
error can hide, and surviving is the expected outcome.

Output: a table on stdout and $CROSSCHECK_OUT/selftest.md. Exit status 1 if a fault that should
be caught survives, a fault is stale, or the unchanged copy does not pass.
"""

import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.abspath(os.environ.get("CROSSCHECK_OUT") or os.path.join(ROOT, "tmp", "crosscheck"))
COPY = ["package.json", "web/src", "proxy/src", "proxy/fixtures", "proxy/dev-server.mjs", "tools/crosscheck", "clients/python"]

# name, file, find, replace, expected failing checks, small
FAULTS = [
    ("wcs: pixel -> plane forgets the 0-based to 1-based step in x",
     "web/src/core/wcs.js", "const u = x + 1 - crpix1;", "const u = x - crpix1;", ["2"], False),
    ("wcs: plane -> pixel forgets it (inverse only)",
     "web/src/core/wcs.js", "out[0] = u + crpix1 - 1;", "out[0] = u + crpix1;", ["2"], False),
    ("wcs: SIP B polynomial uses the powers of u and v the wrong way round",
     "web/src/core/wcs.js", "g += bC[i] * pu[bP[i]] * pv[bQ[i]];", "g += bC[i] * pu[bQ[i]] * pv[bP[i]];", ["2"], False),
    ("wcs: grid has east to the right",
     "web/src/core/wcs.js", "return tanDeproject(-(x - c) * k, (y - c) * k, grid.ra0, grid.dec0);",
     "return tanDeproject((x - c) * k, (y - c) * k, grid.ra0, grid.dec0);", ["2"], False),
    ("wcs: Newton inverse stops at 0.01 pixel instead of 1e-7",
     "web/src/core/wcs.js", "const NEWTON_TOL = 1e-7;", "const NEWTON_TOL = 1e-2;", ["2"], True),
    ("wavetab: one of the four table corners taken from the wrong neighbour",
     "proxy/src/wavetab.js", "const v10 = values[k + nk * (ix1 + nx * iy)];", "const v10 = values[k + nk * (ix + nx * iy1)];", ["3"], False),
    ("wavetab: detector row off by one pixel",
     "proxy/src/wavetab.js", "bracket(table.y, table.ny, ay.crval + ay.cdelt * (y + 1 - ay.crpix));",
     "bracket(table.y, table.ny, ay.crval + ay.cdelt * (y - ay.crpix));", ["3"], False),
    ("fits: 32-bit integers read little-endian",
     "proxy/src/fits.js", "const get = (o) => dv.getInt32(o, false);", "const get = (o) => dv.getInt32(o, true);", ["1"], False),
    ("fits: BZERO ignored",
     "proxy/src/fits.js", "NaN : bzero + bscale * raw;", "NaN : bscale * raw;", ["1"], False),
    ("rice: decoder takes the raw-pixel escape one code too early",
     "proxy/src/rice.js", "} else if (fs === FSMAX) {", "} else if (fs === FSMAX - 1) {", ["5"], False),
    ("rice: FSMAX 24 in decoder and encoder alike (self-consistent, not CFITSIO)",
     "proxy/src/rice.js", "const FSMAX = 25;", "const FSMAX = 24;", ["5"], False),
    ("ephemeris: precession from the equinox of date to J2000 left out",
     "web/src/core/ephemeris.js", "const [lon, lat] = eclipticDateToJ2000(e.lon * DEG, e.lat * DEG, T);",
     "const [lon, lat] = [e.lon * DEG, e.lat * DEG];", ["6"], False),
    ("ephemeris: z of the Earth has the wrong sign of the obliquity",
     "web/src/core/ephemeris.js", "return [xe, ye * ce - ze * se, ye * se + ze * ce];",
     "return [xe, ye * ce - ze * se, -ye * se + ze * ce];", ["6"], False),
    ("ephemeris: TT - UTC left out (Earth 69 s behind, about 2000 km)",
     "web/src/core/ephemeris.js", "const jde = mjd + 2400000.5 + TT_MINUS_UTC_DAYS;", "const jde = mjd + 2400000.5;", ["6"], False),
    ("ephemeris: obliquity wrong by 0.4 arcsec",
     "web/src/core/ephemeris.js", "export const OBLIQUITY_J2000_DEG = 23.4392911111;", "export const OBLIQUITY_J2000_DEG = 23.4394022222;", ["6"], True),
    ("ephemeris: parallaxOffset adds the Earth instead of subtracting it",
     "web/src/core/ephemeris.js", "const g = [distAU * u[0] - E[0], distAU * u[1] - E[1], distAU * u[2] - E[2]];",
     "const g = [distAU * u[0] + E[0], distAU * u[1] + E[1], distAU * u[2] + E[2]];", ["6"], False),
    ("astrometry: east unit vector has the wrong sign",
     "web/src/core/astrometry.js", "const q = [-sa, ca, 0];", "const q = [sa, -ca, 0];", ["6"], False),
    ("astrometry: stellar parallax applied with the wrong sign",
     "web/src/core/astrometry.js", "u = [u[0] - k * E[0], u[1] - k * E[1], u[2] - k * E[2]];",
     "u = [u[0] + k * E[0], u[1] + k * E[1], u[2] + k * E[2]];", ["6"], False),
    ("astrometry: J2000.0 placed at MJD 51544.0 (half a day early)",
     "web/src/core/astrometry.js", "const MJD_J2000 = 51544.5;", "const MJD_J2000 = 51544.0;", ["6"], False),
    ("time: J2000.0 placed at MJD 51544.0",
     "web/src/core/time.js", "export const MJD_J2000 = 51544.5;", "export const MJD_J2000 = 51544.0;", ["6"], False),
    ("reproject: east-west mirror of the grid",
     "web/src/core/reproject.js", "const xi = -(gx - centre) * s;", "const xi = (gx - centre) * s;", ["7"], False),
    ("reproject: bilinear weight of the right-hand neighbour uses the wrong fraction",
     "web/src/core/reproject.js", "const w10 = fx * gy;", "const w10 = gx * fy;", ["7"], False),
    ("encode: frame date taken from MJD-OBS (start) instead of MJD-AVG (middle)",
     "proxy/src/encode.js", "finiteOrNull(h.get('MJD-AVG')) ?? finiteOrNull(h.get('MJD-OBS'))", "finiteOrNull(h.get('MJD-OBS'))", ["4"], False),
    ("encode: variance array filled from the ZODI HDU",
     "proxy/src/encode.js", "data: read('VARIANCE', Float32Array) }", "data: read('ZODI', Float32Array) }", ["4"], False),
    ("encode: header length written big-endian",
     "proxy/src/encode.js", "dv.setUint32(4, n, true);", "dv.setUint32(4, n, false);", ["4"], False),
    ("focalplane: sign of an off-diagonal matrix term in the inverse",
     "proxy/src/focalplane.js", "crpix[0] + (pc22 * xi - pc12 * eta) / det", "crpix[0] + (pc22 * xi + pc12 * eta) / det", ["2"], False),
    ("python client: CRPIX1 written 0-based",
     "clients/python/tombaugh.py", '("CRPIX1", float(w["crpix"][0]), "pixel coordinate of reference point"),',
     '("CRPIX1", float(w["crpix"][0]) - 1.0, "pixel coordinate of reference point"),', ["4"], False),
]


def make_copy(dest):
    for rel in COPY:
        src = os.path.join(ROOT, rel)
        dst = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.isdir(src):
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
        else:
            shutil.copy2(src, dst)


def run_one(index, fault, base):
    name, rel, find, replace, expect, small = fault if fault else ("(unchanged copy)", None, None, None, [], False)
    work = os.path.join(base, f"m{index:02d}")
    make_copy(work)
    res = {"name": name, "file": rel, "expect": expect, "small": small, "failed": [], "rows": 0, "first": "", "state": ""}
    if rel:
        path = os.path.join(work, rel)
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        if text.count(find) != 1:
            res["state"] = "STALE"
            res["first"] = f"the text to change occurs {text.count(find)} times in {rel}"
            shutil.rmtree(work, ignore_errors=True)
            return res
        with open(path, "w", encoding="utf-8") as f:
            f.write(text.replace(find, replace))
    env = dict(os.environ, PYTHON=sys.executable, CROSSCHECK_OUT=os.path.join(work, "out"), CROSSCHECK_LIVE="0")
    proc = subprocess.run(["bash", os.path.join(work, "tools", "crosscheck", "run.sh")], env=env, capture_output=True, text=True)
    summary = os.path.join(work, "out", "summary.json")
    failed, rows, first = [], 0, ""
    if os.path.exists(summary):
        with open(summary, "r", encoding="utf-8") as f:
            s = json.load(f)
        for r in s["rows"]:
            if r["status"] == "FAIL":
                rows += 1
                if r["check"] not in failed:
                    failed.append(r["check"])
                if not first:
                    worst = r["worst"] if isinstance(r["worst"], str) else f"{r['worst']:.3g}"
                    first = f"{r['item']}: {worst} {r['unit']}"
        for m in s.get("missing", []):
            if m not in failed:
                failed.append(m)
            if not first:
                first = f"check {m} stopped with an error"
    else:
        failed, first = ["all"], "no summary written"
    res.update(failed=failed, rows=rows, first=first)
    caught = bool(failed) or proc.returncode != 0
    if not rel:
        res["state"] = "FAILS" if caught else "passes"
    elif caught:
        res["state"] = "caught"
    else:
        res["state"] = "survives (expected)" if small else "SURVIVES"
    shutil.rmtree(work, ignore_errors=True)
    return res


def main():
    words = [w.lower() for w in sys.argv[1:]]
    faults = [f for f in FAULTS if not words or any(w in f[0].lower() for w in words)]
    base = tempfile.mkdtemp(prefix="tombaugh-selftest-")
    jobs = [None] + faults
    workers = max(1, min(4, os.cpu_count() or 1))
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(lambda a: run_one(a[0], a[1], base), enumerate(jobs)))
    finally:
        shutil.rmtree(base, ignore_errors=True)

    lines = ["| Fault put into a copy of the code | File | Outcome | Checks that failed | Rows | First failing row |", "|---|---|---|---|---:|---|"]
    bad = 0
    for r in results:
        if r["state"] in ("SURVIVES", "STALE", "FAILS"):
            bad += 1
        if r["state"] == "caught" and not set(r["expect"]) & set(r["failed"]) and "all" not in r["failed"]:
            r["state"] = "caught elsewhere"
        print(f"  {r['state']:<20}{r['name'][:84]:<86}{','.join(r['failed']) or '-':<10}{r['rows']:>4}  {r['first'][:110]}")
        lines.append(f"| {r['name']} | {r['file'] or '-'} | {r['state']} | {', '.join(r['failed']) or '-'} | {r['rows']} | {r['first'].replace('|', '/')} |")
    caught = sum(1 for r in results if r["state"].startswith("caught"))
    small = sum(1 for r in results if r["state"] == "survives (expected)")
    print(f"\n  {len(faults)} faults: {caught} caught, {small} below tolerance as expected, {bad} problems.")
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "selftest.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
