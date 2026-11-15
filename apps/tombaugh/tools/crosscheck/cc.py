# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Shared helpers of the Python (Astropy) half of the cross-check.

Each cN_*.py script reads what the matching Node script dumped, computes the same quantity with
Astropy (or, where Astropy has no such function, with plain numpy written from the published
formula), compares, and records one row per comparison with ``Results.add``. ``report.py``
collects the rows into the table.

Work directory: $CROSSCHECK_OUT, default <repo>/tmp/crosscheck (git-ignored).
Astropy is told never to download anything.
"""

import json
import math
import os
import sys
import warnings

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.abspath(os.environ.get("CROSSCHECK_OUT") or os.path.join(ROOT, "tmp", "crosscheck"))

# The Python client under test lives in clients/python.
sys.path.insert(0, os.path.join(ROOT, "clients", "python"))


def offline_astropy():
    """No network: no IERS download, built-in ephemeris only."""
    from astropy.utils import iers
    from astropy.utils.data import conf as data_conf

    from astropy import log

    log.setLevel("ERROR")  # INFO messages are reported in the notes of the checks instead
    iers.conf.auto_download = False
    iers.conf.auto_max_age = None
    data_conf.allow_internet = False


offline_astropy()


def out_path(name):
    return os.path.join(OUT, name)


def load_json(name, base=None):
    with open(os.path.join(base or OUT, name), "r", encoding="utf-8") as f:
        return json.load(f)


def arr(values):
    """List from the Node dump -> float64 array; JSON null (a JS NaN) -> NaN."""
    return np.array([np.nan if v is None else v for v in values], dtype=float)


def load_raw(name, dtype, shape=None):
    a = np.fromfile(out_path(name), dtype=dtype)
    return a.reshape(shape) if shape is not None else a


CASES = load_json("cases.json", HERE)["synthetic"]
REAL = load_json("real_header.json", HERE)


def real_header():
    """The real IMAGE header of CONTRACT.md as an astropy.io.fits.Header (every keyword listed)."""
    from astropy.io import fits

    h = fits.Header()
    for key, value in REAL["cards"]:
        h[key] = value
    return h


def sep_mas(ra1, dec1, ra2, dec2):
    """Angular separation in milliarcseconds (Vincenty formula, numpy, degrees in)."""
    ra1, dec1, ra2, dec2 = (np.radians(np.asarray(v, dtype=float)) for v in (ra1, dec1, ra2, dec2))
    dl = ra2 - ra1
    num = np.hypot(np.cos(dec2) * np.sin(dl), np.cos(dec1) * np.sin(dec2) - np.sin(dec1) * np.cos(dec2) * np.cos(dl))
    den = np.sin(dec1) * np.sin(dec2) + np.cos(dec1) * np.cos(dec2) * np.cos(dl)
    return np.degrees(np.arctan2(num, den)) * 3.6e6


def wrap180(d):
    return (np.asarray(d, dtype=float) + 180.0) % 360.0 - 180.0


def nanmax(a):
    a = np.asarray(a, dtype=float)
    return float(np.nanmax(a)) if a.size and np.isfinite(a).any() else float("nan")


def fmt(x):
    """Short text for a number in the table."""
    if isinstance(x, str):
        return x
    if x is None:
        return "-"
    if isinstance(x, (bool, np.bool_)):
        return "yes" if x else "no"
    if isinstance(x, (int, np.integer)):
        return str(int(x))
    x = float(x)
    if math.isnan(x):
        return "nan"
    if x == 0:
        return "0"
    if abs(x) >= 1e4 or abs(x) < 1e-3:
        return f"{x:.2e}"
    return f"{x:.4g}"


class Results:
    """Rows of one check. status: PASS, FAIL, INFO (reported, not judged) or SKIP."""

    def __init__(self, check, title):
        self.check = str(check)
        self.title = title
        self.rows = []
        self.notes = []

    def add(self, item, points, worst, unit, tol=None, ok=None, note=""):
        if ok is None and tol is not None:
            ok = bool(isinstance(worst, (int, float, np.floating, np.integer)) and not math.isnan(float(worst)) and float(worst) <= tol)
        status = "INFO" if ok is None else ("PASS" if ok else "FAIL")
        row = {
            "check": self.check,
            "item": item,
            "points": int(points) if points is not None else None,
            "worst": worst if isinstance(worst, str) else (None if worst is None else float(worst)),
            "unit": unit,
            "tol": tol,
            "status": status,
            "note": note,
        }
        self.rows.append(row)
        tol_text = "" if tol is None else f"  (tolerance {fmt(tol)} {unit})"
        print(f"  [{status}] {self.check} {item}: {fmt(points)} points, worst {fmt(worst)} {unit}{tol_text}{'  ' + note if note else ''}")
        return status == "PASS" or status == "INFO"

    def skip(self, item, why):
        self.rows.append({"check": self.check, "item": item, "points": None, "worst": None, "unit": "", "tol": None, "status": "SKIP", "note": why})
        print(f"  [SKIP] {self.check} {item}: {why}")

    def note(self, text):
        self.notes.append(text)
        print(f"  note: {text}")

    def save(self, extra=None):
        payload = {"check": self.check, "title": self.title, "rows": self.rows, "notes": self.notes}
        if extra:
            payload["extra"] = extra
        with open(out_path(f"result_{self.check}.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=1)
        return 0 if all(r["status"] != "FAIL" for r in self.rows) else 1


def record_warnings():
    """Context manager: collect every warning instead of printing it."""
    cm = warnings.catch_warnings(record=True)
    return cm


def describe_warnings(caught):
    out = []
    for w in caught:
        text = " ".join(str(w.message).split())
        out.append(f"{w.category.__name__}: {text}")
    # keep order, drop repeats
    return list(dict.fromkeys(out))
