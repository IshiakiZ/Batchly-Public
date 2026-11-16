# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Collect the result_<check>.json files written by the cN_*.py scripts and print the table.

Output:
  stdout                 one line per check, then the condensed table
  summary.md             the condensed table as Markdown (rows that differ only by the test
                         frame are merged: points added, the worst value kept)
  summary_full.md        every row, unmerged
  summary.json           versions, counts, all rows
Exit status 1 if any row is FAIL or an expected result file is missing.
"""

import json
import os
import platform
import subprocess
import sys

from cc import OUT, fmt, out_path

ORDER = ["1", "2", "3", "4", "4L", "5", "6", "7"]
PREFIXES = ("real-like: ", "south-wrap: ", "edge-clipped: ", "real: ", "astropy-written: ")
RANK = {"FAIL": 3, "SKIP": 2, "PASS": 1, "INFO": 0}


def versions():
    import astropy
    import erfa
    import numpy

    v = {"python": platform.python_version(), "numpy": numpy.__version__, "astropy": astropy.__version__, "pyerfa": erfa.__version__}
    try:
        import reproject

        v["reproject"] = reproject.__version__
    except ImportError:
        v["reproject"] = "not installed"
    try:
        import scipy

        v["scipy"] = scipy.__version__
    except ImportError:
        pass
    try:
        v["node"] = subprocess.run([os.environ.get("NODE", "node"), "--version"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        v["node"] = "unknown"
    v["platform"] = f"{platform.system()} {platform.machine()}"
    return v


def strip_case(item):
    for p in PREFIXES:
        if item.startswith(p):
            return p[:-2], item[len(p):]
    return None, item


def merge(rows):
    merged = []
    index = {}
    for r in rows:
        case, text = strip_case(r["item"])
        key = (r["check"], text, r["unit"])
        if key not in index:
            index[key] = dict(r, item=text, cases=[case] if case else [], n=1)
            merged.append(index[key])
            continue
        m = index[key]
        m["n"] += 1
        if case:
            m["cases"].append(case)
        m["points"] = (m["points"] or 0) + (r["points"] or 0)
        if isinstance(r["worst"], (int, float)) and isinstance(m["worst"], (int, float)):
            m["worst"] = max(m["worst"], r["worst"])
        elif isinstance(m["worst"], str) and r["worst"] != m["worst"]:
            m["worst"] = f"{m['worst']}; {r['worst']}"
        if r["tol"] is not None and m["tol"] is not None:
            m["tol"] = max(m["tol"], r["tol"])
        if RANK[r["status"]] > RANK[m["status"]]:
            m["status"] = r["status"]
        if r["note"] and r["status"] in ("FAIL", "SKIP"):
            m["note"] = r["note"]
        elif m["n"] > 1 and m["status"] not in ("FAIL", "SKIP"):
            m["note"] = ""  # a note of one frame would mislead on a merged row
    return merged


def md_table(rows, with_cases):
    lines = ["| Check | What was compared | Points | Largest disagreement | Tolerance | Result |", "|---|---|---:|---|---|---|"]
    for r in rows:
        item = r["item"].replace("|", "\\|")
        if with_cases and r.get("cases"):
            item += f" ({len(r['cases'])} frames)" if len(r["cases"]) > 1 else f" ({r['cases'][0]})"
        worst = "-" if r["worst"] is None else f"{fmt(r['worst'])} {r['unit']}".strip()
        tol = "-" if r["tol"] is None else f"{fmt(r['tol'])} {r['unit']}".strip()
        note = f" {r['note']}" if r.get("note") and r["status"] in ("FAIL", "SKIP") else ""
        lines.append(f"| {r['check']} | {item} | {fmt(r['points'])} | {worst} | {tol} | {r['status']}{note.replace('|', '/')} |")
    return "\n".join(lines)


def main():
    results = []
    missing = []
    for check in ORDER:
        path = out_path(f"result_{check}.json")
        if not os.path.exists(path):
            if check != "4L":
                missing.append(check)
            continue
        with open(path, "r", encoding="utf-8") as f:
            results.append(json.load(f))

    rows = [r for res in results for r in res["rows"]]
    v = versions()
    print()
    print("Tombaugh cross-check against Astropy")
    print("  " + ", ".join(f"{k} {val}" for k, val in v.items()))
    print()
    print(f"  {'check':<6}{'title':<78}{'rows':>5}{'points':>12}{'PASS':>6}{'FAIL':>6}{'INFO':>6}{'SKIP':>6}")
    total = {"PASS": 0, "FAIL": 0, "INFO": 0, "SKIP": 0}
    per_check = []
    for res in results:
        c = {"PASS": 0, "FAIL": 0, "INFO": 0, "SKIP": 0}
        for r in res["rows"]:
            c[r["status"]] += 1
            total[r["status"]] += 1
        points = sum(r["points"] or 0 for r in res["rows"] if r["status"] in ("PASS", "FAIL"))
        per_check.append({"check": res["check"], "title": res["title"], "rows": len(res["rows"]), "points": points, **c})
        print(f"  {res['check']:<6}{res['title'][:76]:<78}{len(res['rows']):>5}{points:>12}{c['PASS']:>6}{c['FAIL']:>6}{c['INFO']:>6}{c['SKIP']:>6}")
    print(f"  {'':<6}{'total':<78}{len(rows):>5}{sum(p['points'] for p in per_check):>12}{total['PASS']:>6}{total['FAIL']:>6}{total['INFO']:>6}{total['SKIP']:>6}")
    for m in missing:
        print(f"  check {m}: NO RESULT FILE (the script did not finish)")
    print()

    merged = merge(rows)
    width = max(len(r["item"]) for r in merged) if merged else 10
    width = min(width, 118)
    for r in merged:
        worst = "-" if r["worst"] is None else f"{fmt(r['worst'])} {r['unit']}".strip()
        tol = "" if r["tol"] is None else f"tol {fmt(r['tol'])}"
        print(f"  {r['status']:<5}{r['check']:<4}{r['item'][:width]:<{width}}  {fmt(r['points']):>9}  {worst:<28}{tol}")
    fails = [r for r in rows if r["status"] == "FAIL"]
    if fails:
        print()
        print("FAILED rows:")
        for r in fails:
            print(f"  {r['check']} {r['item']}: worst {fmt(r['worst'])} {r['unit']}, tolerance {fmt(r['tol'])}. {r['note']}")
    print()
    print(f"  {total['PASS']} PASS, {total['FAIL']} FAIL, {total['INFO']} reported for information, {total['SKIP']} skipped. Details: {OUT}/summary.md")

    with open(out_path("summary.md"), "w", encoding="utf-8") as f:
        f.write(md_table(merged, True) + "\n")
    with open(out_path("summary_full.md"), "w", encoding="utf-8") as f:
        f.write(md_table(rows, False) + "\n\n")
        for res in results:
            for note in res.get("notes", []):
                f.write(f"- Check {res['check']}: {note}\n")
    with open(out_path("summary.json"), "w", encoding="utf-8") as f:
        json.dump({"versions": v, "totals": total, "checks": per_check, "missing": missing, "rows": rows, "notes": {res["check"]: res.get("notes", []) for res in results}}, f, indent=1)
    return 1 if fails or missing else 0


if __name__ == "__main__":
    sys.exit(main())
