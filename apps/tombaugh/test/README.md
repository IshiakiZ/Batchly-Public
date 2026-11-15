# Tombaugh end-to-end tests and tooling

Everything here runs offline against the synthetic sky of `proxy/dev-server.mjs`. No npm
dependencies; Playwright (already installed globally) drives headless Chromium.

## Quick reference

| Command | What it does |
|---|---|
| `node test/e2e.mjs` | Start the dev server on a free port, drive the page, report each step |
| `node test/e2e.mjs --bundle` | Same steps against `dist/tombaugh.html` (built first if stale), served by a throwaway static server with `?api=` pointing at the dev server, plus a sandboxed-iframe step |
| `node test/e2e.mjs --url http://localhost:8787` | Use a server that is already running |
| `node test/e2e.mjs --only canvas,spectrum` | Run only some steps (`--list` shows the names) |
| `node tools/build.mjs [--minify] [--api <url>] [--banner] [--out <path>]` | Bundle `web/` into one HTML file plus `dist/tombaugh.meta.json` |
| `node --test tools/build.test.mjs` | Bundler tests (fixture graphs run as native modules and as a bundle in Chromium) |
| `node tools/check-headers.mjs [--fix]` | Check the two-line file header on every `.js/.mjs/.ts` under `web/ proxy/ tools/ test/` |
| `node tools/deploy-bundle.mjs [--print\|--list]` | Verify and write the Supabase edge function upload set to `dist/edge/` |

Other `e2e.mjs` options: `--timeout <seconds>` (how long a movie may take to load, default 90),
`--no-build` (bundle mode: never rebuild). Exit code 0 only if every step that ran passed.

## What the e2e suite checks

Each step is reported separately; a failure never stops the others. A screenshot is saved per
step (`deviceScaleFactor` 1, desktop 1280 x 800) to `docs/screens/e2e-<step>.png`
(`e2e-bundle-<step>.png` in bundle mode). The machine-readable report goes to
`dist/e2e-report.json` (`dist/e2e-bundle-report.json`): per step `status`, `ms`, `error`, `notes`,
`data` (captions, canvas statistics, URLs) and every console / network event seen.

| Step | Passes when |
|---|---|
| `load` | `/` loads with no `console.error`, uncaught exception, failed request or HTTP status >= 400. In bundle mode also: nothing is requested except the file itself and the API |
| `landing` | the landing screen is visible and contains an editable search box |
| `target` | clicking the first target card leads to the viewer (URL gets `ra`/`dec`, landing hides). If there is no card the suite opens `/?ra=269.4486&dec=4.7652&fov=4&det=3` and says so; a card that exists but does nothing is a failure |
| `canvas` | a canvas inside the viewer is not blank: more than 8 distinct colours among about 4000 sampled pixels |
| `step` | the caption text changes after the next-frame control **and** after the right-arrow key |
| `play` | the play control starts the movie (the caption / picture changes by itself) and stops it again |
| `residual` | switching the view to residual changes the canvas content while the movie is paused, and the picture is not blank |
| `spectrum` | clicking the centre of the canvas produces an SVG with at least 3 plotted points in the spectrum panel |
| `url` | the URL carries numeric `ra` and `dec` that match the target, and after a reload the same position is shown again |
| `mobile` | at 390 x 844 (mobile emulation) neither the landing screen nor the viewer is wider than the screen; controls that are cut off are listed as notes |
| `embed` | `?embed=1` hides the top bar that is visible without it, and the picture still loads |
| `sandbox` | bundle mode only: `dist/tombaugh.html` inside `<iframe sandbox="allow-scripts">` (opaque origin, `localStorage` throws) still shows a picture with no errors, and during the whole run the page requested nothing but itself and the API |

Notes are informational (for example "the URL says view=null, expected view=residual"); they do
not fail a step but are worth reading.

## Test hooks requested from the page authors

The suite finds elements defensively, in this order: a `data-testid` hook, an element whose `id`
equals the hook name, then roles / aria-labels / text / class names. The heuristics work with the
current markup, but they are guesses. **Please add these `data-testid` attributes** so that a
later restyle or rename cannot silently break the tests:

| `data-testid` | Element | Fallback used today |
|---|---|---|
| `search-input` | the coordinate / name text input | `#search-input`, inputs inside the landing, `role="searchbox"`, placeholder text |
| `target-card` | each clickable challenge-target card or chip (the element that receives the click) | `button` / `a` with "card", "target" or "chip" in the class |
| `viewer` | the container that holds the image canvas | `#viewer`, class containing "viewer" |
| `play` | the play / pause button | a button named Play or Pause inside `#player` |
| `next` | the next-frame button | a button whose name contains "next frame" |
| `prev` | the previous-frame button | a button whose name contains "previous frame" |
| `view-residual` | the control that switches to the residual view | `role="radio"` / tab / button named "Residual", a `select` option, the `r` key |
| `view-passes` | the control that switches to the passes view | same, named "Passes" |
| `spectrum-panel` | the element that contains the spectrum SVG | `#panel-spectrum`, `#spectrum-body`, class containing "spectrum" |
| `caption` | the DOM element with the current frame caption text | class `caption` |

Three more are useful and cheap: `landing` (the landing screen root), `topbar` (the bar that
`embed=1` hides; today `header` / `#topbar`) and `player` (the transport group).

Behaviour the suite relies on, all from `CONTRACT.md`:

- the dev server honours `PORT` and serves the page at `/` and the API under `/api`;
- `ArrowRight` steps one frame and `Space` toggles play when focus is not in a form control;
- the caption changes from frame to frame (title, date or wavelength differ);
- `ra` and `dec` are written to the URL with `history.replaceState`, and unknown query
  parameters such as `api` are kept, so a reload shows the same thing;
- API calls go to `window.TOMBAUGH_API`, else `?api=`, else `/api` on localhost;
- all API responses carry `Access-Control-Allow-Origin: *` (the bundle is served from another
  port, and from an opaque origin in the `sandbox` step).

## The bundler in one paragraph

`tools/build.mjs` reads `web/index.html`, inlines `styles.css` (and `@import`s, `url()` assets,
icons and images as data URIs), and rewrites the module graph that starts at
`<script type="module" src="src/main.js">` into one `<script type="module">`: every source module
becomes a function in a small registry, `import` becomes a registry call hoisted to the top of
that function, `export` becomes a getter on the module's namespace object. `*.test.js` files and
demo pages are never reached. A literal `import('./x.js')` is bundled; a computed
`` import(`./plugins/${name}/index.js`) `` bundles everything that matches `./plugins/*/index.js`
and resolves at run time. A module that only such a pattern can reach and that is broken is left
out with a loud warning (importing it rejects, as it would natively); `--strict` makes that an
error. Unresolved or bare imports, missing exports, top-level `await` and syntax errors stop the
build with `file:line:col`. Limits: no top-level `await`; a *named* import of an exported `let`
that is reassigned later is a snapshot (a warning is printed; namespace imports are live).

## Files

- `test/e2e.mjs` - the suite. `test/e2e-lib.mjs` - Playwright loader, free ports, static server,
  dev-server lifecycle, step runner, canvas sampling and overflow probes (also used by
  `tools/build.test.mjs`).
- Playwright is found through a normal import, then `NODE_PATH`, then the global `node_modules`
  next to the `node` binary. Never run `playwright install`.
