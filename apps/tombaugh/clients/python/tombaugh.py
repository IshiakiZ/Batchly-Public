# Tombaugh - SPHEREx blink comparator. Apache-2.0.
# AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
"""Read what the Tombaugh proxy serves, in Python.

The proxy answers ``GET /cutout`` with a compact binary frame, "TBF1": one SPHEREx Level-2
exposure cut out around a sky position, with its image, variance, zodiacal-light model, flags
and per-pixel wavelength, plus the world coordinate system (TAN-SIP) of the cutout.

    import tombaugh

    frame = tombaugh.read_tbf1("frame.tbf1")        # or bytes; needs numpy only
    frame["image"].shape                             # (ny, nx), float32, MJy/sr
    frame["wave"][29, 29]                            # wavelength of that pixel, micrometres
    good = (frame["flags"] & tombaugh.DEFAULT_BAD_MASK) == 0

    wcs = tombaugh.wcs_of(frame)                     # astropy.wcs.WCS with SIP
    ra, dec = wcs.all_pix2world(29, 29, 0)           # 0-based pixel -> degrees (ICRS)

    tombaugh.to_hdulist(frame).writeto("frame.fits") # open it in DS9, CARTA, photutils, ...

Conventions
  * Arrays are numpy arrays of shape (ny, nx), indexed [y, x], 0-based, like astropy.io.fits.
    The first pixel centre is (0, 0); in FITS numbering it is (1, 1). ``frame["wcs"]["crpix"]``
    is the FITS (1-based) CRPIX.
  * image, zodi: MJy/sr (surface brightness); variance: (MJy/sr)^2; wave: micrometres;
    flags: int32 bit mask (see FLAG_BITS); mjd: MJD (UTC) of the middle of the exposure.
  * ``frame["detXY0"]`` is the 1-based detector pixel of FITS pixel (1, 1) of the cutout.
  * Zodiacal light is NOT subtracted from ``image``; subtract ``frame["zodi"]`` yourself.

``read_tbf1`` needs numpy. ``wcs_of`` and ``to_hdulist`` also need astropy (imported lazily).
The TBF1 layout is defined in CONTRACT.md of the Tombaugh repository.
"""

import json
import struct
import urllib.error
import urllib.parse
import urllib.request

import numpy as np

__all__ = [
    "read_tbf1",
    "wcs_header",
    "wcs_of",
    "to_hdulist",
    "fetch_frame",
    "citation",
    "DEFAULT_BASE_URL",
    "DEFAULT_BAD_MASK",
    "FLAG_BITS",
    "DOI_MISSION",
    "DOI_RELEASES",
]

DEFAULT_BASE_URL = "https://api.batch-ly.com/functions/v1/spherex"

# DOIs in one place so they are easy to correct (same values as web/src/ui/citation.js).
DOI_MISSION = "10.26131/IRSA629"
DOI_RELEASES = {"qr3": "10.26131/IRSA662"}

# FLAGS bits of SPHEREx Level-2 images: bit index -> name (CONTRACT.md).
FLAG_BITS = {
    0: "TRANSIENT", 1: "OVERFLOW", 2: "SUR_ERROR", 6: "NONFUNC", 7: "DICHROIC", 9: "MISSING_DATA",
    10: "HOT", 11: "COLD", 12: "FULLSAMPLE", 14: "PHANMISS", 15: "NONLINEAR", 17: "PERSIST",
    19: "OUTLIER", 20: "CROSSTALK", 21: "SOURCE", 22: "GHOST", 23: "GHOST_FPA", 24: "GHOST_EXT",
    25: "STREAK", 26: "BLOOM", 27: "SNOWBALL", 28: "HALO",
}
# Default "bad pixel" mask for science. Bit 21 (SOURCE) marks a known source, not a defect.
_BAD_BITS = (0, 1, 2, 6, 9, 10, 11, 15, 17, 19, 25, 26, 27)
DEFAULT_BAD_MASK = sum(1 << b for b in _BAD_BITS)

_MAGIC = b"TBF1"
_DTYPES = {"f4": "<f4", "i4": "<i4", "f8": "<f8", "i2": "<i2", "u1": "u1"}


def read_tbf1(source):
    """Decode a TBF1 frame.

    Parameters
    ----------
    source : str, os.PathLike, bytes, bytearray, memoryview or a binary file object
        A path, the bytes themselves, or anything with ``.read()``.

    Returns
    -------
    dict
        Every field of the frame's JSON header (``id``, ``release``, ``obsid``, ``version``,
        ``det``, ``nx``, ``ny``, ``mjd``, ``exptime``, ``dateObs``, ``bunit``, ``psfFwhm``,
        ``wcs``, ``detXY0``, ``waveCenter``, ``bwCenter``), the arrays ``image``, ``variance``,
        ``zodi``, ``flags``, ``wave`` as numpy arrays of shape (ny, nx), and ``header``: the JSON
        header as it was sent (including the ``arrays`` directory).

    The arrays are copies (writable, native byte order), so the input can be discarded.
    """
    if isinstance(source, (bytes, bytearray, memoryview)):
        buf = bytes(source)
    elif hasattr(source, "read"):
        buf = source.read()
    else:
        with open(source, "rb") as f:
            buf = f.read()

    if len(buf) < 8 or buf[:4] != _MAGIC:
        raise ValueError("Not a TBF1 frame: bad magic bytes")
    (n,) = struct.unpack_from("<I", buf, 4)
    if 8 + n > len(buf):
        raise ValueError("TBF1 frame is truncated inside its header")
    try:
        header = json.loads(buf[8 : 8 + n].decode("utf-8"))
    except ValueError as err:
        raise ValueError(f"TBF1 frame has an unreadable header: {err}") from None
    if not isinstance(header, dict) or header.get("v") != 1 or not isinstance(header.get("arrays"), list):
        raise ValueError(f"Unsupported TBF1 header version {header.get('v') if isinstance(header, dict) else header!r}")

    frame = {k: v for k, v in header.items() if k not in ("arrays", "v")}
    nx, ny = int(header["nx"]), int(header["ny"])
    for spec in header["arrays"]:
        name, dtype = spec["name"], _DTYPES.get(spec["dtype"])
        if dtype is None:
            raise ValueError(f"TBF1 array {name}: unknown dtype {spec['dtype']}")
        offset, length = int(spec["offset"]), int(spec["length"])
        nbytes = length * np.dtype(dtype).itemsize
        if offset < 8 + n or offset + nbytes > len(buf):
            raise ValueError(f"TBF1 array {name} lies outside the frame (truncated download?)")
        data = np.frombuffer(buf, dtype=dtype, count=length, offset=offset).astype(np.dtype(dtype).newbyteorder("="))
        frame[name] = data.reshape(ny, nx) if length == nx * ny else data
    frame["header"] = header
    return frame


def _sip_cards(sip):
    cards = []
    for prefix, key, order_key in (("A", "a", "aOrder"), ("B", "b", "bOrder"), ("AP", "ap", "apOrder"), ("BP", "bp", "bpOrder")):
        coeffs = sip.get(key) or {}
        terms = []
        for name, value in coeffs.items():
            p, q = (int(t) for t in name.split("_"))
            terms.append((p, q, float(value)))
        order = int(sip.get(order_key) or 0)
        if terms:
            order = max(order, max(p + q for p, q, _ in terms))
        if not terms and not order:
            continue
        cards.append((f"{prefix}_ORDER", order, "SIP polynomial order"))
        for p, q, value in sorted(terms):
            cards.append((f"{prefix}_{p}_{q}", value, "SIP distortion coefficient"))
    return cards


def wcs_header(frame):
    """The celestial WCS of a frame as a list of FITS cards (key, value, comment).

    Rebuilt from ``frame["wcs"]``: gnomonic projection, with the SIP distortion polynomials when
    the frame has them (CTYPE '...-TAN-SIP'). CRPIX is the FITS 1-based reference pixel, which in
    a SPHEREx cutout is the centre of the full detector and lies far outside the cutout.
    """
    w = frame["wcs"]
    sip = w.get("sip")
    sip_cards = _sip_cards(sip) if sip else []
    suffix = "-SIP" if sip_cards else ""
    pc = w.get("pc") or [[1.0, 0.0], [0.0, 1.0]]
    cdelt = w.get("cdelt") or [1.0, 1.0]
    cards = [
        ("WCSAXES", 2, "number of World Coordinate System axes"),
        ("CTYPE1", "RA---TAN" + suffix, "gnomonic projection" + (" + SIP distortion" if suffix else "")),
        ("CTYPE2", "DEC--TAN" + suffix, "gnomonic projection" + (" + SIP distortion" if suffix else "")),
        ("CUNIT1", "deg", ""),
        ("CUNIT2", "deg", ""),
        ("RADESYS", "ICRS", "equatorial coordinate system"),
        ("CRPIX1", float(w["crpix"][0]), "pixel coordinate of reference point"),
        ("CRPIX2", float(w["crpix"][1]), "pixel coordinate of reference point"),
        ("CRVAL1", float(w["crval"][0]), "[deg] coordinate value at reference point"),
        ("CRVAL2", float(w["crval"][1]), "[deg] coordinate value at reference point"),
        ("CDELT1", float(cdelt[0]), "[deg] coordinate increment at reference point"),
        ("CDELT2", float(cdelt[1]), "[deg] coordinate increment at reference point"),
        ("PC1_1", float(pc[0][0]), "coordinate transformation matrix element"),
        ("PC1_2", float(pc[0][1]), "coordinate transformation matrix element"),
        ("PC2_1", float(pc[1][0]), "coordinate transformation matrix element"),
        ("PC2_2", float(pc[1][1]), "coordinate transformation matrix element"),
        ("LONPOLE", 180.0, "[deg] native longitude of celestial pole"),
        ("LATPOLE", float(w["crval"][1]), "[deg] native latitude of celestial pole"),
    ]
    return cards + sip_cards


def wcs_of(frame):
    """astropy.wcs.WCS of a frame (TAN, with SIP when present).

    Use ``all_pix2world`` / ``all_world2pix`` so that the SIP distortion is applied; pass
    origin 0 for numpy-style pixels (as in the arrays of ``read_tbf1``) or 1 for FITS pixels.
    """
    from astropy.io import fits
    from astropy.wcs import WCS

    header = fits.Header()
    header["NAXIS"] = 2
    header["NAXIS1"] = int(frame["nx"])
    header["NAXIS2"] = int(frame["ny"])
    for key, value, comment in wcs_header(frame):
        header[key] = (value, comment)
    return WCS(header)


def _mjd_to_isot(mjd):
    """MJD (UTC) -> 'YYYY-MM-DDThh:mm:ss.sss' (proleptic Gregorian, leap seconds ignored)."""
    import datetime

    ms = int(round((float(mjd) - 40587.0) * 86400000.0))
    t = datetime.datetime(1970, 1, 1) + datetime.timedelta(milliseconds=ms)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}"


def _isot_to_mjd(text):
    import datetime

    t = datetime.datetime.fromisoformat(str(text).strip().replace("Z", ""))
    return (t - datetime.datetime(1970, 1, 1)) / datetime.timedelta(days=1) + 40587.0


def to_hdulist(frame):
    """An astropy.io.fits.HDUList holding the frame, usable in any astronomy software.

    HDUs: PRIMARY (no data), IMAGE (float32, MJy/sr), FLAGS (int32), VARIANCE (float32),
    ZODI (float32), WAVELENGTH (float32, micrometres per pixel). The first four image extensions
    have the names and order of a SPHEREx Level-2 file. Every image extension carries the
    celestial WCS (TAN-SIP), the observation keywords, and an alternate WCS 'A' giving 0-based
    detector pixel coordinates as in the original files.

    Differences from an original SPHEREx file: the EPSF and WCS-WAVE tables are not here (the
    proxy never forwards them); instead of the -TAB wavelength description the wavelength of
    every pixel is given as an image; only the keywords needed to use the data are kept.
    """
    from astropy.io import fits

    shared = []
    add = shared.append
    if frame.get("det") is not None:
        add(("DETECTOR", int(frame["det"]), "detector number"))
    if frame.get("obsid"):
        add(("OBSID", str(frame["obsid"]), "observation identifier"))
    if frame.get("release"):
        add(("RELEASE", str(frame["release"]), "IRSA data release of the source file"))
    mjd_obs = None
    if frame.get("dateObs"):
        add(("DATE-OBS", str(frame["dateObs"]), "UTC start of exposure"))
        try:
            mjd_obs = _isot_to_mjd(frame["dateObs"])
            add(("MJD-OBS", round(mjd_obs, 8), "[d] MJD at start of exposure"))
        except ValueError:
            mjd_obs = None
    if frame.get("mjd") is not None:
        add(("DATE-AVG", _mjd_to_isot(frame["mjd"]), "UTC middle of exposure"))
        add(("MJD-AVG", float(frame["mjd"]), "[d] MJD at middle of exposure"))
    if frame.get("exptime") is not None:
        add(("XPOSURE", float(frame["exptime"]), "[s] exposure time"))
    add(("TIMESYS", "UTC", ""))
    if frame.get("psfFwhm") is not None:
        add(("PSF_FWHM", float(frame["psfFwhm"]), "[arcsec] PSF full width at half maximum"))
    if frame.get("waveCenter") is not None:
        add(("WAVE_CEN", float(frame["waveCenter"]), "[um] wavelength at the array centre"))
    if frame.get("bwCenter") is not None:
        add(("BW_CEN", float(frame["bwCenter"]), "[um] bandwidth at the array centre"))
    shared += wcs_header(frame)
    if frame.get("detXY0"):
        x0, y0 = (float(v) for v in frame["detXY0"])
        shared += [
            ("WCSNAMEA", "Detector pixel coordinates (0-based)", ""),
            ("CTYPE1A", "LINEAR", ""),
            ("CTYPE2A", "LINEAR", ""),
            ("CRPIX1A", 2.0 - x0, ""),
            ("CRPIX2A", 2.0 - y0, ""),
            ("CRVAL1A", 0.0, ""),
            ("CRVAL2A", 0.0, ""),
        ]

    primary = fits.PrimaryHDU()
    if frame.get("version"):
        primary.header["VERSION"] = (str(frame["version"]), "SPHEREx pipeline version")
    primary.header["ORIGIN"] = ("Tombaugh", "cutout re-packed from a TBF1 frame")
    if frame.get("id"):
        primary.header["FRAMEID"] = str(frame["id"])
    primary.header["COMMENT"] = "SPHEREx Level-2 cutout served by the Tombaugh proxy (TBF1), re-packed as FITS"
    primary.header["COMMENT"] = "by clients/python/tombaugh.py. Source data: NASA/IPAC Infrared Science Archive."
    primary.header["COMMENT"] = "Zodiacal light (ZODI) is not subtracted from IMAGE."

    def image_hdu(name, data, bunit):
        hdu = fits.ImageHDU(np.ascontiguousarray(data), name=name)
        if bunit:
            hdu.header["BUNIT"] = bunit
        for key, value, comment in shared:
            hdu.header[key] = (value, comment) if comment else value
        return hdu

    bunit = frame.get("bunit") or "MJy / sr"
    hdus = [
        primary,
        image_hdu("IMAGE", frame["image"], bunit),
        image_hdu("FLAGS", frame["flags"], None),
        image_hdu("VARIANCE", frame["variance"], "MJy2 / sr2" if bunit == "MJy / sr" else None),
        image_hdu("ZODI", frame["zodi"], bunit),
        image_hdu("WAVELENGTH", frame["wave"], "um"),
    ]
    return fits.HDUList(hdus)


def fetch_frame(base_url, id, ra, dec, size, timeout=60):
    """Download one cutout from a Tombaugh proxy and decode it.

    Parameters
    ----------
    base_url : str
        The proxy, for example ``tombaugh.DEFAULT_BASE_URL`` or ``http://localhost:8787/api``.
    id : str
        Frame id from ``GET /search`` (the IRSA uri, path without host).
    ra, dec : float
        Cutout centre, degrees (ICRS).
    size : float
        Cutout width in degrees (the proxy clamps it to 0.02 .. 0.2).

    Returns the same dict as ``read_tbf1``. Raises RuntimeError with the proxy's message when
    the proxy answers with an error.
    """
    query = urllib.parse.urlencode({"id": id, "ra": repr(float(ra)), "dec": repr(float(dec)), "size": repr(float(size))})
    url = base_url.rstrip("/") + "/cutout?" + query
    request = urllib.request.Request(url, headers={"Accept": "application/octet-stream", "User-Agent": "tombaugh-python-client/1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as err:
        detail = err.read()
        try:
            message = json.loads(detail.decode("utf-8")).get("error")
        except ValueError:
            message = None
        raise RuntimeError(f"Tombaugh proxy answered {err.code}: {message or err.reason}") from None
    return read_tbf1(body)


def citation(frames=(), retrieved=None):
    """The citation line for data obtained through Tombaugh.

    ``frames`` is an iterable of frames (or of release names such as 'qr3'); ``retrieved`` is a
    date string 'YYYY-MM-DD' (default: today, UTC).
    """
    import datetime

    names = {"qr1": "QR1", "qr2": "QR2", "qr3": "QR3", "dr1": "DR1", "dr2": "DR2"}
    releases = sorted({str(f.get("release") if isinstance(f, dict) else f).lower() for f in frames if (f.get("release") if isinstance(f, dict) else f)})
    listed = ", ".join(names.get(r, r.upper()) for r in releases) if releases else "quick release"
    extra = [f"{names.get(r, r.upper())} {DOI_RELEASES[r]}" for r in releases if r in DOI_RELEASES]
    if not extra:
        extra = [f"QR3 {DOI_RELEASES['qr3']}"]
    day = retrieved or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    return (
        f"SPHEREx Level 2 spectral images, {listed} (IRSA, DOI {DOI_MISSION} for the mission archive; "
        f"{'; '.join(extra)}), retrieved {day}. Gaia DR3."
    )
