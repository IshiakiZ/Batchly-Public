#!/usr/bin/env bash
# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
#
# tools/crosscheck/run.sh - run the whole cross-check of our JavaScript against Astropy and
# print the table. Deterministic: fixed inputs, fixed seeds, no network (the optional step 4L
# talks to a dev server it starts itself on 127.0.0.1).
#
#   python3 -m venv /tmp/tombaugh-venv
#   /tmp/tombaugh-venv/bin/pip install numpy astropy          # reproject is optional
#   PYTHON=/tmp/tombaugh-venv/bin/python tools/crosscheck/run.sh
#
# Environment:
#   PYTHON           Python with numpy and astropy (default: python3)
#   NODE             Node >= 22 (default: node)
#   CROSSCHECK_OUT   work directory (default: <repo>/tmp/crosscheck, git-ignored)
#   CROSSCHECK_LIVE  set to 0 to leave out step 4L (Python client over HTTP against the local
#                    dev server with the synthetic backend)
#   CROSSCHECK_PORT  port for step 4L (default 18787)
#
# Exit status: 0 when no row failed, 1 otherwise, 2 when the tools are missing.
# Each check is a pair: cN_*.mjs runs our JavaScript and dumps what it got, cN_*.py computes the
# same with Astropy and compares. Results: $CROSSCHECK_OUT/summary.md, summary_full.md,
# summary.json. The written record is docs/CROSSCHECK.md.

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PY="${PYTHON:-python3}"
NODE="${NODE:-node}"
export NODE
export CROSSCHECK_OUT="${CROSSCHECK_OUT:-$ROOT/tmp/crosscheck}"
export PYTHONDONTWRITEBYTECODE=1

if ! "$PY" -c "import numpy, astropy" 2>/dev/null; then
  echo "crosscheck: $PY has no numpy/astropy. Create a virtual environment, pip install numpy astropy," >&2
  echo "            and run again with PYTHON=/path/to/venv/bin/python." >&2
  exit 2
fi
if ! "$NODE" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" 2>/dev/null; then
  echo "crosscheck: Node >= 22 is required ($NODE)." >&2
  exit 2
fi

mkdir -p "$CROSSCHECK_OUT"
rm -f "$CROSSCHECK_OUT"/result_*.json "$CROSSCHECK_OUT"/summary*.md "$CROSSCHECK_OUT"/summary.json
cd "$HERE" || exit 2

status=0
node_step() { "$NODE" "$HERE/$1" || { echo "  !! $1 failed"; status=1; }; }
py_step() { "$PY" "$HERE/$1" || status=1; }

echo "== Check 1: FITS reading (synthetic files both ways, an Astropy-written file)"
py_step c1_write.py
node_step c1_fits.mjs
py_step c1_fits.py

echo "== Check 2: world coordinates (TAN-SIP, projections, grid, coordinate strings)"
node_step c2_wcs.mjs
py_step c2_wcs.py

echo "== Check 3: wavelength lookup (-TAB)"
node_step c3_wave.mjs
py_step c3_wave.py

echo "== Check 4: TBF1 frame and Python client"
node_step c4_tbf1.mjs
py_step c4_tbf1.py
if [ "${CROSSCHECK_LIVE:-1}" != "0" ]; then
  echo "== Check 4L: Python client over HTTP (local dev server, synthetic backend)"
  py_step c4_live.py
fi

echo "== Check 5: RICE_1 tile compression"
py_step c5_rice_write.py
node_step c5_rice.mjs
py_step c5_rice_check.py

echo "== Check 6: ephemeris, proper motion, parallax, time"
node_step c6_ephem.mjs
py_step c6_ephem.py

echo "== Check 7: reprojection"
node_step c7_reproject.mjs
py_step c7_reproject.py

"$PY" "$HERE/report.py" || status=1
exit $status
