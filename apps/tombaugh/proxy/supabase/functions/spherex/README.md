# `spherex` edge function

The production home of the Tombaugh proxy: a Supabase Edge Function (Deno) reachable at

```
https://<project-ref>.supabase.co/functions/v1/spherex/<endpoint>
https://api.batch-ly.com/functions/v1/spherex/<endpoint>      (custom domain)
```

with `<endpoint>` one of `search`, `cutout`, `gaia`, `resolve`, `health`, `fog`, `identify`,
`ephemeris`, `track` (POST) and `index`. The deployed function runs the `s3` backend (NASA's public
SPHEREx bucket plus this project's exposure index, IRSA as fallback); see the note at the top of
`proxy/README.md`. The API is
described in `CONTRACT.md` and `proxy/README.md`.

AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

## What is in this directory

`index.ts` is the whole function: it builds a cache and calls
`Deno.serve(createHandler({ ... }))`. All logic lives in `proxy/src/*.js`, which is shared with
the dev server and the tests.

**The deploy step copies `proxy/src` next to `index.ts`.** `index.ts` imports
`./src/handler.js`, `./src/cache.js`, `./src/fits.js`, `./src/encode.js` and `./src/fog.js`, and
those import their siblings (`./irsa.js`, `./gaia.js`, `./resolve.js`, `./wavetab.js`, ...).
Copy every non-test `.js` file of `proxy/src`, so the function does not break when a module
gains an import. The copy `./src/` is a build product: do not edit it and do not commit it.

`proxy/fixtures/synth.js` is not needed here (the function always runs with `backend: "irsa"`),
and the `*.test.js` files must not be copied (they import `node:test`).

## Deploy

With the Supabase CLI, from `proxy/` (the directory that contains `supabase/`):

```sh
cd proxy
rm -rf supabase/functions/spherex/src
mkdir -p supabase/functions/spherex/src
cp src/*.js supabase/functions/spherex/src/
rm -f supabase/functions/spherex/src/*.test.js

supabase functions deploy spherex --no-verify-jwt --project-ref <project-ref>
```

With a tool that uploads a list of files instead (for example the Supabase MCP server's
`deploy_edge_function`), upload `index.ts` as the entry point plus every copied file under its
relative name (`src/handler.js`, `src/irsa.js`, `src/cache.js`, `src/fits.js` and so on, one
entry per non-test `.js` file of `proxy/src`), and turn JWT verification off.

Check it:

```sh
curl https://<project-ref>.supabase.co/functions/v1/spherex/health
# {"ok":true,"version":"0.1.0","irsa":"unknown","backend":"irsa"}
curl "https://<project-ref>.supabase.co/functions/v1/spherex/health?probe=1"   # asks IRSA
curl "https://<project-ref>.supabase.co/functions/v1/spherex/resolve?name=Barnard%27s%20Star"
```

## JWT verification must be off

Tombaugh is a public page with no login. The browser calls this function with plain `fetch`
and no `Authorization` header, also from inside sandboxed iframes with an opaque origin. With
JWT verification on, Supabase's gateway rejects those requests with 401 before the function
runs, and the CORS preflight fails with them.

So deploy with `--no-verify-jwt`, or put this in `proxy/supabase/config.toml`:

```toml
[functions.spherex]
verify_jwt = false
```

A redeploy without the flag or the config entry turns verification back on. If the page
suddenly gets 401 on every request, this is the first thing to check.

The function does its own input validation (below) and exposes nothing private: it only reads
public archives.

## Environment and storage

| Variable | Source | Use |
|---|---|---|
| `SUPABASE_URL` | set by Supabase for every edge function | Base URL of the Storage REST API |
| `SUPABASE_SERVICE_ROLE_KEY` | set by Supabase for every edge function | Reads and writes the cache bucket. Never sent to the browser or to any other host |

Nothing has to be configured by hand. The cache is the private Storage bucket `spherex-cache`;
it is created on the first write if it does not exist (or create it yourself, private, in the
dashboard). If either variable is missing the function logs a warning and uses a 48 MB memory
cache per instance, which works but forgets everything when the instance is recycled.

What ends up in the bucket (all small): search results (`search/`), encoded cutouts of about
70 KB each (`cutout/`), Gaia cones (`gaia/`), resolved names (`resolve/`), the six wavelength
tables (`wave/`), short-lived async job pointers (`searchjob/`) and the fog-of-war map
(`fog/nside32.bin`, 24.6 KB). Every object starts with a 16-byte age prefix, so read them through
`createSupabaseCache`, not directly. Cutouts never expire; delete the `cutout/` folder to clear
them, for example after a change to the TBF1 format.

## Limits to keep in mind

Platform limits, as documented by Supabase when this was written (check the current numbers):

- A request must start answering within 150 s. The handler gives a frame search a budget of
  130 s; a search that does not finish in that time returns a retryable 504, and the retry picks
  up the same IRSA async job.
- 256 MB of memory per instance. The largest thing the function holds is one 4 MB cutout while a
  wavelength table is read (once per detector, then cached); everything else is streamed or
  small. The memory cache fallback is capped at 48 MB for this reason.
- About 2 s of CPU time per request. Waiting on IRSA does not count; parsing a cutout and
  encoding a frame take milliseconds.
- Instances are short-lived and there can be several at once. In-memory state (wavelength
  tables, in-flight request sharing, the `irsa` field of `/health`) is per instance; anything
  that must last goes to the bucket.

Limits of this code:

- No rate limiting. Each instance runs at most 12 cutout downloads from IRSA at a time.
- `/health` reports IRSA as `unknown` on a fresh instance. Use `/health?probe=1` to ask IRSA.
- The fog-of-war map is read, changed and written back; two marks at the same moment from
  different instances can lose one increment (accepted in the contract).

## Why this is not an open proxy

- The function never fetches a URL, host or path taken from a request. Upstream hosts are
  constants: `irsa.ipac.caltech.edu`, `gea.esac.esa.int`, `tapvizier.cds.unistra.fr`,
  `cds.unistra.fr`, `simbad.cds.unistra.fr`, plus the project's own Storage API.
- The only free-form path is the cutout `id`. It must match
  `^ibe/data/spherex/[a-z0-9]+/level2/.+\.fits$`, use only `A-Z a-z 0-9 _ - . /`, contain no
  `..` or `//`, and be at most 400 characters; otherwise the answer is 400 and nothing is
  fetched. That rules out other hosts, other IRSA datasets, query strings and path traversal.
- `ra`, `dec`, `size` and `radius` are parsed as numbers, range-checked and clamped (`size` to
  0.02..0.2 deg, `radius` to at most 0.25 deg).
- Names for `/resolve` are limited to 80 characters and are URL-encoded or quote-escaped before
  they reach CDS.
- IRSA async job URLs are only followed on the IRSA host under `/TAP/async/`.
- Responses are bounded: the 3.9 MB PSF table of a cutout is never downloaded in full or
  forwarded, and upstream bodies are size-limited.
- `POST /fog` is the only write a visitor can cause: it adds one to a saturating counter.
