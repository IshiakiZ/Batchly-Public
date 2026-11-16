# Tombaugh proxy

> **Current state (15 November 2026).** This README describes the first proxy, which asked IRSA for
> everything. The proxy now has a third backend, `s3`, and it is the one the deployed function
> uses: `/search` is answered from this project's own index of every public SPHEREx exposure
> (272,963 exposures, built from NASA's public bucket `nasa-irsa-spherex` on AWS Open Data), and
> `/cutout` reads only the needed bytes of each file from that bucket with HTTP Range requests.
> IRSA is the fallback. Run it locally with `TOMBAUGH_BACKEND=s3`. New routes: `/identify`
> (SIMBAD), `/ephemeris` (JPL Horizons), `POST /track` (exposures along a moving body's path) and
> `/index` (status and build of the exposure index). The file layout, the RICE-compressed flag
> tiles and the focal-plane geometry are described in `CONTRACT-S3.md`; the code is in
> `src/s3.js`, `src/s3cutout.js`, `src/expindex.js`, `src/rice.js`, `src/focalplane.js`,
> `src/wavetab.js`, `src/horizons.js` and `src/identify.js`. Everything below about caching,
> error shapes and safety still holds. The function deployed at
> `https://api.batch-ly.com/functions/v1/spherex` was built from an earlier commit of this folder;
> the one later change is the epoch of the built-in WISE 0855-0714 position in `src/resolve.js`
> (2010.35, matching `web/src/core/targets.js`), which the web page already applies on its own.


The browser cannot talk to IRSA (no CORS headers), and a SPHEREx cutout is a 4 MB FITS file of
which the page needs about 70 KB. This proxy sits in between: it searches the archive, downloads
only the first ~130 KB of each cutout, attaches the wavelength of every pixel, and answers in a
compact binary format (TBF1). It also looks up Gaia DR3 stars, resolves object names and keeps
the shared "fog of war" map.

The HTTP API and the TBF1 format are specified in [`../CONTRACT.md`](../CONTRACT.md). This file
describes how the proxy is put together and how to run it.

AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

## Run it

```sh
node proxy/dev-server.mjs                         # http://localhost:8787/  synthetic sky, no network
TOMBAUGH_BACKEND=irsa node proxy/dev-server.mjs   # live IRSA, Gaia and CDS
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port of the dev server |
| `TOMBAUGH_BACKEND` | `synthetic` | `synthetic` (fake sky from `fixtures/synth.js`) or `irsa` |
| `TOMBAUGH_CACHE_DIR` | unset | Keep the cache on disk in this directory, so answers from IRSA survive a restart. Useful before a demo: open the targets once, and they load from disk afterwards |
| `TOMBAUGH_QUIET` | unset | `1` turns off the per-request log lines |

The dev server serves `web/` with no caching (unknown paths without a file extension get
`index.html`) and mounts the API at `/api/*`. It needs Node 22 or later and has no dependencies.

Tests (no network):

```sh
node --test proxy/src/handler.test.js proxy/src/irsa.test.js proxy/src/gaia.test.js \
            proxy/src/resolve.test.js proxy/src/cache.test.js
```

## Files

| File | What it does |
|---|---|
| `src/handler.js` | `createHandler({ fetchImpl, cache, backend, version })` -> `async (Request) => Response`. Routing, validation, caching, error shapes, CORS |
| `src/irsa.js` | IRSA client: frame search over TAP, cutout head download, wavelength table download, id validation |
| `src/gaia.js` | Gaia DR3 cone search: ESA archive, then VizieR, then IRSA |
| `src/resolve.js` | Name resolver: built-in table of the challenge targets, CDS Sesame, SIMBAD TAP |
| `src/cache.js` | `createMemoryCache()`, `createSupabaseCache()`, `cacheKey()` |
| `src/fits.js`, `wavetab.js`, `encode.js` | FITS parsing, wavelength lookup, TBF1 encoding (module proxy-fits) |
| `src/fog.js` | Fog-of-war storage (module fog-of-war) |
| `fixtures/synth.js` | The synthetic sky used by the dev server and tests |
| `dev-server.mjs` | Node-only static server + API mount |
| `supabase/functions/spherex/` | The production entry point, a Supabase Edge Function; see its README |

Everything under `src/` uses Web-standard APIs only and runs unchanged in Node, Deno and
browsers. The handler is a plain `Request -> Response` function, so it can be mounted in any
runtime that speaks the Fetch API.

## Endpoints

The handler looks only at the last path segment, so `/api/search`, `/functions/v1/spherex/search`
and `/anything/search` are the same endpoint.

| Endpoint | Notes beyond the contract |
|---|---|
| `GET /search?ra&dec` | Cached 12 h, keyed by the position rounded to 1e-4 deg (an empty result only 10 min). If IRSA fails and an older answer with frames exists, that answer is served with `"cached": true, "stale": true` |
| `GET /cutout?id&ra&dec&size` | `size` clamped to 0.02..0.2 (default 0.1). Cached without expiry, keyed by id, position rounded to 1e-5 deg and size rounded to 1e-3. Header `x-tombaugh-cache: hit\|miss` |
| `GET /gaia?ra&dec&radius` | `radius` clamped to 0.001..0.25 (default 0.1). Cached 30 days. Adds `"source"` (`esa`, `vizier`, `irsa`, `synthetic`) and `"cached"` |
| `GET /resolve?name` | Answers from Sesame or SIMBAD are cached 30 days. A built-in answer has `"source": "builtin (approximate)"` and is not cached, so it is replaced once Sesame answers again |
| `GET /health` | Adds `"backend"`. `irsa` is the outcome of the most recent IRSA request in this instance within the last 10 minutes, else `unknown`. `?probe=1` asks IRSA's TAP availability endpoint (4 s timeout) |
| `GET /fog`, `POST /fog?ra&dec` | Logic in `fog.js`. A storage failure gives 503 rather than an empty map (see below) |
| `OPTIONS *` | 204 with the CORS headers |

Input rules: `ra` must be a number in 0..360 (360 is treated as 0), `dec` in -90..90; anything
else is a 400. Errors are `{ "error": "...", "retryable": true|false }` with status 400 (bad
input), 404 (unknown name, endpoint or file), 405, 502 (an archive failed; retry), 503 (fog
storage unreachable; retry), 504 (an archive timed out; retry) or 500 (a bug here).

## How it copes with a slow or failing IRSA

Search (`searchFrames` in `irsa.js`), in this order, inside one overall time budget (130 s in the
handler, so the answer leaves before an edge function's 150 s limit):

1. If an earlier request for the same position left an async TAP job behind, poll that job
   (for at most 45 s).
2. TAP sync, up to 3 attempts, 75 s timeout each, with backoff. Answers that are not the expected
   CSV (HTML error pages, VOTable error documents, any non-200) count as failures. A timeout ends
   this step early, because a second 75 s wait rarely helps.
3. TAP async (UWS): `POST /TAP/async` with `PHASE=RUN`, poll `<job>/phase`, fetch
   `<job>/results/result`. The job URL is remembered in memory and in the cache for 15 minutes.
   If the budget runs out while the job is still running the client gets a retryable 504, and
   its retry resumes the same job instead of starting from scratch.

If the cache holds an expired answer that lists frames, the search is cut down to the sync step
with a 30 s budget, and when that fails the expired answer is served, marked stale. Nobody waits
two minutes for an archive that is down when a usable list is at hand. For two minutes after a
failed search, an instance serves such stale answers at once without asking IRSA again. An
expired "no frames" answer is never served this way. Identical concurrent searches share one upstream request.

Cutouts (`fetchCutoutHead`): the response stream goes to `readUntilPsf`, which stops reading when
the PSF table begins, so about 130 KB of the 4 MB are downloaded. 30 s timeout per attempt, two
retries for transient failures (5xx, 429, network errors, timeouts, truncated or non-FITS
bodies). An upstream 404 is passed on as 404 without retrying. At most 12 cutout downloads run at
once per instance; identical concurrent requests share one download.

Wavelength table (`fetchWaveTable`): the `WCS-WAVE` table is at the very end of a cutout file and
is identical for every file of a detector. The first cutout of a detector triggers one full
download of a 0.02 deg cutout (4 MB), in parallel with the head download. The table is then kept
in memory and in the cache (`wave/irsa-d<N>-v1.json`), so this happens once per detector, ever.

Results are only cached after they have been parsed and encoded successfully; a failure is never
cached.

## Caches

Both caches expose `get(key, { maxAgeSeconds }?)`, `put(key, bytes, contentType)` and
`delete(key)`, and never throw: a failing cache is logged and treated as a miss. Returned arrays
are fresh copies.

- `createMemoryCache({ maxBytes })`: a `Map` with least-recently-used eviction, 200 MB by default.
- `createSupabaseCache({ url, serviceKey, bucket })`: Supabase Storage over REST. Objects are
  written with `x-upsert: true`; the private bucket is created on the first write if it is
  missing. Each stored object starts with a 16-byte prefix (`TBC1`, four zero bytes, write time
  in ms as float64 LE) so that its age is known from one request; `get` strips it.
- `cacheKey(parts)` -> `"<prefix>/<sha1 hex>"`, safe for any strings or numbers.

Keys in use: `search/<sha1>`, `searchjob/<sha1>`, `cutout/<sha1>`, `gaia/<sha1>`,
`resolve/<sha1>`, `wave/irsa-d<N>-v1.json`, `fog/nside32.bin`.

`get(key, { strict: true })` is the one call that may reject: it resolves `null` for a missing
object but rejects when the store could not be read. The handler uses it for the fog map, which
is read, incremented and written back; without it a storage hiccup would be read as "empty map"
and the empty map would be written over the real one.

## Not an open proxy

- No request parameter is ever used as a URL or host. Upstream hosts are fixed in the code:
  `irsa.ipac.caltech.edu`, `gea.esac.esa.int`, `tapvizier.cds.unistra.fr`, `cds.unistra.fr`,
  `simbad.cds.unistra.fr`.
- `id` must match `^ibe/data/spherex/[a-z0-9]+/level2/.+\.fits$`, consist only of
  `A-Z a-z 0-9 _ - . /`, contain no `..` or `//`, and be at most 400 characters. So no query
  strings, fragments, percent-escapes, other hosts or other IRSA datasets. Invalid ids get a 400
  and nothing is fetched.
- Coordinates, size and radius are parsed as numbers, range-checked and clamped, and written
  into upstream URLs and ADQL in fixed notation.
- Object names are length-limited, stripped of control characters, URL-encoded for Sesame and
  quote-escaped for SIMBAD's ADQL.
- Async TAP job URLs are accepted only on the IRSA host under `/TAP/async/`.
- Upstream bodies are size-limited (cutouts 24 MB, text 48 MB); the PSF table is never forwarded.

There is no rate limiting in the proxy itself.

## Extending

`createHandler` takes `deps` to replace parts: `{ fits, encode, fog, synth, irsa: { searchFrames,
fetchCutoutHead, fetchWaveTable }, gaiaCone, resolveName }`. A second data path (for example the
S3 exposure index) can be wired in by passing an `irsa.searchFrames` that tries the index first
and calls the TAP search from `irsa.js` otherwise; the caching and stale handling stay as they
are. `fetchWaveTable(det, sampleId, { ra, dec })` needs a position inside the sample frame,
because IRSA only makes cutouts around a position.
