# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Check 6, Astropy half: Earth ephemeris, proper-motion propagation, parallax, time.

Reference for the Earth: Astropy's BUILT-IN ephemeris (``solar_system_ephemeris.set('builtin')``;
no JPL file, nothing downloaded). For the Earth it is ERFA's ``epv00`` (Bretagnon's VSOP2000
series fitted to DE405). ERFA documents its accuracy over 1900-2100 against DE405: heliocentric
position RMS 3.7 km, maximum 11.2 km (7.5e-8 AU); barycentric RMS 4.6 km, maximum 13.4 km. So
the reference is itself approximate, but about a hundred times better than what it is used to
judge here. The heliocentric Earth is ``get_body_barycentric('earth') - get_body_barycentric('sun')``
in ICRS axes, in AU. Times: our MJD numbers are UTC; Astropy converts UTC -> TDB itself (leap
seconds are built in; no IERS table is needed for this).

Proper motion: ``SkyCoord.apply_space_motion`` (ERFA ``pmsafe``/``starpm``), which needs a
distance and a radial velocity. Handling, identical on both sides:
  * distance: 1000 / parallax(mas) pc on the Astropy side; our propagate() needs the parallax
    only for the radial-velocity term and for the annual parallax, which is switched OFF
    (``{ parallax: false }``) in these rows, because apply_space_motion returns the barycentric
    direction;
  * radial velocity: 0 km/s on both sides in the main rows (our star has no ``rv`` field);
    a second pair of rows sets -110.6 km/s on both sides.
Epochs are Julian epochs: J2000.0, J2016.0, J2026.5 (elapsed time exactly 16 and 26.5 Julian
years on both sides).

Annual parallax: the exact geocentric direction is the direction of (star or body position
vector) - (Earth position vector), built here with Astropy vectors. No aberration, no light
deflection, no light-time: our functions do not apply them either (they are absorbed by the
image WCS or negligible, as ephemeris.js explains).
"""

import sys
import warnings

import numpy as np
from astropy import units as u
from astropy.coordinates import CartesianRepresentation, Distance, SkyCoord, get_body_barycentric, solar_system_ephemeris
from astropy.time import Time

from cc import Results, arr, load_json, nanmax, sep_mas

R = Results(6, "Ephemeris, proper motion, parallax, time")
J = load_json("c6_ephem.json")
solar_system_ephemeris.set("builtin")

mjd = arr(J["mjds"])
t = Time(mjd, format="mjd", scale="utc")
earth_b = get_body_barycentric("earth", t)
sun_b = get_body_barycentric("sun", t)
E = (earth_b - sun_b).xyz.to_value(u.au).T  # heliocentric Earth, ICRS axes, AU; shape (n, 3)
EB = earth_b.xyz.to_value(u.au).T  # barycentric Earth
ours = np.array(J["earth"], dtype=float)

# ---- earthPosition --------------------------------------------------------------------------------

dr = np.linalg.norm(ours - E, axis=1)
cosang = np.sum(ours * E, axis=1) / (np.linalg.norm(ours, axis=1) * np.linalg.norm(E, axis=1))
cross = np.linalg.norm(np.cross(ours, E), axis=1) / (np.linalg.norm(ours, axis=1) * np.linalg.norm(E, axis=1))
ang = np.degrees(np.arctan2(cross, cosang)) * 3600.0
drad = np.abs(np.linalg.norm(ours, axis=1) - np.linalg.norm(E, axis=1))
R.add("earthPosition vs astropy builtin (epv00), 200 dates 2025-2027: position difference", mjd.size, nanmax(dr), "AU", tol=1e-4, note="tolerance = the contract's 'good to ~1e-4 AU'")
R.add("earthPosition: same, against the accuracy ephemeris.js claims for itself (1e-5 AU)", mjd.size, nanmax(dr), "AU", tol=1e-5)
R.add("earthPosition: direction difference", mjd.size, nanmax(ang), "arcsec", tol=1.5, note="ephemeris.js claims about 1 arcsec")
R.add("earthPosition: (information) radial (distance) difference", mjd.size, nanmax(drad), "AU")
dbary = np.linalg.norm(ours - EB, axis=1)
R.add("earthPosition: (information) heliocentric (ours) vs BARYCENTRIC Earth: the Sun's offset from the barycentre", mjd.size, nanmax(dbary), "AU")
R.note(f"earthPosition vs astropy builtin: RMS {np.sqrt(np.mean(dr ** 2)):.2e} AU, max {dr.max():.2e} AU; direction RMS {np.sqrt(np.mean(ang ** 2)):.3f} arcsec, max {ang.max():.3f} arcsec.")

# ---- propagate: Barnard's Star ----------------------------------------------------------------------

b = J["barnard"]
s = b["star"]


def star_coord(star, rv):
    return SkyCoord(
        ra=star["ra"] * u.deg,
        dec=star["dec"] * u.deg,
        pm_ra_cosdec=star["pmra"] * u.mas / u.yr,
        pm_dec=star["pmdec"] * u.mas / u.yr,
        distance=Distance(parallax=star["parallax"] * u.mas),
        radial_velocity=rv * u.km / u.s,
        obstime=Time(star["epoch"], format="jyear", scale="tdb"),
        frame="icrs",
    )


def moved(c, year=None, when=None):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # erfa "distance overridden" style notes, none expected
        return c.apply_space_motion(new_obstime=when if when is not None else Time(year, format="jyear", scale="tdb"))


c0 = star_coord(s, 0.0)
crv = star_coord(s, b["rv"])
for e in b["epochs"]:
    a = moved(c0, e["year"])
    d = float(sep_mas(a.ra.deg, a.dec.deg, e["noRv"]["ra"], e["noRv"]["dec"]))
    span = e["year"] - s["epoch"]
    R.add(f"propagate, Barnard's Star {s['epoch']:.1f} -> {e['year']}, rv = 0 both sides, parallax shift off", 1, d, "mas", tol=1.0, note=f"JS {e['noRv']['ra']:.7f}, {e['noRv']['dec']:.7f}; astropy {a.ra.deg:.7f}, {a.dec.deg:.7f}; motion {span * 10.3935:.0f} arcsec")
    a = moved(crv, e["year"])
    d = float(sep_mas(a.ra.deg, a.dec.deg, e["withRv"]["ra"], e["withRv"]["dec"]))
    R.add(f"propagate, Barnard's Star {s['epoch']:.1f} -> {e['year']}, rv = {b['rv']} km/s both sides", 1, d, "mas", tol=1.0)
    # how much the radial velocity matters at all (JS, with vs without)
    d = float(sep_mas(e["withRv"]["ra"], e["withRv"]["dec"], e["noRv"]["ra"], e["noRv"]["dec"]))
    R.add(f"(information) effect of the radial velocity on Barnard's Star at {e['year']} (JS, rv = {b['rv']} vs 0)", 1, d, "mas")

worst = 0.0
for tg in J["targets"]:
    a = moved(star_coord(tg["star"], 0.0) if tg["star"]["parallax"] else SkyCoord(ra=tg["star"]["ra"] * u.deg, dec=tg["star"]["dec"] * u.deg, pm_ra_cosdec=tg["star"]["pmra"] * u.mas / u.yr, pm_dec=tg["star"]["pmdec"] * u.mas / u.yr, obstime=Time(tg["star"]["epoch"], format="jyear", scale="tdb")), tg["at"])
    worst = max(worst, float(sep_mas(a.ra.deg, a.dec.deg, tg["result"]["ra"], tg["result"]["dec"])))
R.add(f"propagate, every target with a proper motion ({', '.join(x['id'] for x in J['targets'])}) -> 2026.5, rv = 0", len(J["targets"]), worst, "mas", tol=1.0)

# ---- propagate with annual parallax -----------------------------------------------------------------

bary = moved(c0, when=t)  # barycentric direction and distance at each date
ra_bj = arr([p["ra"] for p in b["barycentric"]])
dec_bj = arr([p["dec"] for p in b["barycentric"]])
d_utc = nanmax(sep_mas(bary.ra.deg, bary.dec.deg, ra_bj, dec_bj))
R.add("propagate, Barnard's Star at the 200 dates, parallax shift off, vs apply_space_motion", mjd.size, d_utc, "mas", tol=1.0, note="see the next row for where this comes from")
# astrometry.js turns the UTC MJD into a Julian epoch without adding TT - UTC (69.184 s), and says
# so. For Barnard's Star that is 10.39 arcsec/yr x 69.184 s = 0.023 mas. Prove that this is all of
# it: tell Astropy that the same numbers are TT, so that both sides use the same elapsed time.
bary_tt = moved(c0, when=Time(mjd, format="mjd", scale="tt"))
R.add("same, with Astropy reading the MJD as TT (elapsed time identical on both sides)", mjd.size, nanmax(sep_mas(bary_tt.ra.deg, bary_tt.dec.deg, ra_bj, dec_bj)), "mas", tol=1e-3)
star_xyz = bary.cartesian.xyz.to_value(u.au).T  # AU, barycentric


def direction(vec):
    rep = CartesianRepresentation(vec.T * u.au)
    sph = SkyCoord(rep, frame="icrs")
    return sph.ra.deg, sph.dec.deg


ra_aj = arr([p["ra"] for p in b["apparent"]])
dec_aj = arr([p["dec"] for p in b["apparent"]])
ra_h, dec_h = direction(star_xyz - E)
ra_bb, dec_bb = direction(star_xyz - EB)
# Formula only: Astropy vector geometry, but starting from OUR barycentric direction (at
# Astropy's distance) and OUR Earth vector, so that only the parallax step itself is compared.
ours_xyz = SkyCoord(ra=ra_bj * u.deg, dec=dec_bj * u.deg, distance=bary.distance, frame="icrs").cartesian.xyz.to_value(u.au).T
ra_j, dec_j = direction(ours_xyz - ours)
shift = sep_mas(ra_aj, dec_aj, ra_bj, dec_bj)
R.add("propagate with parallax: the parallax step alone (Astropy vector geometry fed with our direction and our Earth)", mjd.size, nanmax(sep_mas(ra_j, dec_j, ra_aj, dec_aj)), "mas", tol=1e-3)
R.add("propagate with parallax vs exact geocentric direction, Astropy heliocentric Earth", mjd.size, nanmax(sep_mas(ra_h, dec_h, ra_aj, dec_aj)), "mas", tol=1.0, note=f"the parallax shift itself reaches {nanmax(shift):.0f} mas")
R.add("propagate with parallax vs exact geocentric direction, Astropy BARYCENTRIC Earth (the rigorous one)", mjd.size, nanmax(sep_mas(ra_bb, dec_bb, ra_aj, dec_aj)), "mas", tol=10.0, note="our Earth is heliocentric; ephemeris.js states up to 1 percent of the parallax, 5 mas here")

# ---- parallaxOffset ---------------------------------------------------------------------------------

for body in J["parallax"]:
    res = np.array(body["results"], dtype=float)
    dra, ddec, ra2, dec2, dist_geo = res.T
    u0 = SkyCoord(ra=body["ra"] * u.deg, dec=body["dec"] * u.deg, distance=body["dist"] * u.au, frame="icrs").cartesian.xyz.to_value(u.au)
    ra_x, dec_x = direction(u0[None, :] - E)
    ra_f, dec_f = direction(u0[None, :] - ours)
    # The offsets must reproduce the apparent position the way ephemeris.js documents:
    ra_rec = body["ra"] + dra / (3600.0 * np.cos(np.radians(body["dec"])))
    dec_rec = body["dec"] + ddec / 3600.0
    label = f"parallaxOffset, body at {body['dist']} AU towards ({body['ra']}, {body['dec']})"
    size = nanmax(sep_mas(ra2, dec2, body["ra"], body["dec"])) / 1000.0
    d_formula = max(nanmax(sep_mas(ra_f, dec_f, ra2, dec2)), nanmax(sep_mas(ra_rec, dec_rec, ra2, dec2)), 0.0)
    R.add(f"{label}: formula only (Astropy vectors, our Earth) and offsets reproduce the position", mjd.size, d_formula, "mas", tol=0.01)
    d_exact = nanmax(sep_mas(ra_x, dec_x, ra2, dec2))
    # What the Earth difference found above can explain: (difference in AU) / distance.
    allowed = 1.1 * float(dr.max()) / body["dist"] * 206264806.2 + 0.001
    R.add(f"{label}: vs exact geocentric direction from Astropy vectors", mjd.size, d_exact, "mas", tol=allowed, note=f"shift up to {size:.1f} arcsec; tolerance = 1.1 x (largest Earth difference) / distance")
    dg = np.abs(dist_geo - np.linalg.norm(u0[None, :] - E, axis=1))
    R.add(f"{label}: geocentric distance", mjd.size, nanmax(dg), "AU", tol=1e-4)

# ---- time -------------------------------------------------------------------------------------------

tm = J["time"]
R.add("mjdToYear vs astropy Time.jyear (Julian epoch, same time scale)", mjd.size, nanmax(np.abs(arr(tm["years"]) - t.jyear)), "yr", tol=1e-9)
R.add("yearToMjd(mjdToYear(mjd)) returns mjd", mjd.size, nanmax(np.abs(arr(tm["backToMjd"]) - mjd)), "d", tol=1e-9)
ep = tm["epochs"]
d = max(abs(e["mjd"] - Time(e["year"], format="jyear", scale="utc").mjd) for e in ep)
R.add("yearToMjd for J2000.0, J2016.0, J2026.5 vs astropy", len(ep), float(d), "d", tol=1e-9)
iso_a = Time(tm["isoStrings"], scale="utc").mjd
R.add("isoToMjd (FITS DATE-OBS strings) vs astropy Time", len(tm["isoStrings"]), nanmax(np.abs(arr(tm["isoMjd"]) - iso_a)), "d", tol=1e-9)
real = abs(tm["isoMjd"][0] - 61210.79244684)
R.add("isoToMjd('2026-06-19T19:01:07.407') vs MJD-OBS = 61210.79244684 of the same real header", 1, float(real), "d", tol=1e-8, note="the header value is printed to 1e-8 d")
date_a = [x.replace(" ", "T")[:23] for x in t.iso]
n_bad = sum(1 for a, j in zip(date_a, tm["date"]) if abs((Time(j[:23], scale="utc") - Time(a, scale="utc")).to_value(u.s)) > 0.0015)
R.add("mjdToDate vs astropy calendar date and time (to the millisecond)", mjd.size, n_bad, "dates differing", tol=0)
n_bad = 0
for a, j in zip(t, tm["iso"]):
    rounded = Time(round(a.mjd * 1440.0) / 1440.0, format="mjd", scale="utc").strftime("%Y-%m-%d %H:%M")
    if rounded != j:
        n_bad += 1
R.add("mjdToIso ('YYYY-MM-DD HH:MM', rounded to the minute) vs astropy", mjd.size, n_bad, "strings differing", tol=0)

R.note("Reference accuracy (ERFA epv00 documentation, vs JPL DE405, 1900-2100): heliocentric position RMS 3.7 km, max 11.2 km (7.5e-8 AU); barycentric RMS 4.6 km, max 13.4 km.")
sys.exit(R.save())
