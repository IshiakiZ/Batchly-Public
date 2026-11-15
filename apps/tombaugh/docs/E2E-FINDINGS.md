# End-to-end findings (tooling)

State of the tree on 2026-11-15, about 08:15 UTC, while other modules were still landing.
Re-run the commands below to refresh; nothing here is hand-edited test output.

## Result

| Check | Command | Result |
|---|---|---|
| Bundler tests | `node --test tools/build.test.mjs` | 48 passed, 0 failed |
| File headers | `node tools/check-headers.mjs` | 172 files, 0 without the header |
| Single-file build | `node tools/build.mjs` | `dist/tombaugh.html`, 1239 kB (365 kB gzipped), 68 modules, 0 warnings |
| Page on the dev server | `node test/e2e.mjs` | 11 passed, 0 failed (the 12th step is bundle-only) |
| Single-file bundle | `node test/e2e.mjs --bundle` | 13 passed, 0 failed (the 13th, added 15 Nov, checks Simple mode) |
| Minified bundle | `node tools/build.mjs --minify` then `node test/e2e.mjs --bundle --no-build` | 12 passed, 0 failed (run at 08:04, 49 modules at that time) |
| Edge function upload set | `node tools/deploy-bundle.mjs` | READY, 17 files, 1 warning (item 3) |

Nothing fails. During both runs the page logged no `console.error`, no uncaught exception, no
failed request and no HTTP error. The bundle, opened inside `<iframe sandbox="allow-scripts">`
(opaque origin, `localStorage` throws `SecurityError`), loaded the movie and requested nothing but
itself and the API. A build with `--api <dev server>/api --minify --banner` opened from a
`file://` URL also loaded the movie and requested only `/api/search`, `/api/cutout`, `/api/gaia`
and `/api/fog`.

Plugins: `web/src/plugins/index.js` lists none yet (`PLUGINS = []`), so the shipped page loads no
plugin. In a scratch copy of `web/` with `PLUGINS = ['export', 'identify', 'inject', 'sonify']`
(the four that have an `index.js` today), the native page and the bundle behaved the same: all
four installed, the toolbar gained "Export", "Inject" and "Listen", the tabs gained "What is
this?", "Listen" and "Injection test", and neither logged anything to the console. `validate/`
has no `index.js` yet and was not tried.

Screenshots: `docs/screens/e2e-*.png` (dev server) and `docs/screens/e2e-bundle-*.png`.
Reports: `dist/e2e-report.json`, `dist/e2e-bundle-report.json`.

## Things worth fixing (none of them fail a step)

### 1. After a mouse click on a segmented control, the arrow keys and space stop driving the movie

Owner: ui-shell. Severity: medium (it is the first thing a mouse user hits after "Residual").

Reproduce: open a target, click "Residual" in the view bar, press the right-arrow key. Expected by
`CONTRACT.md` ("space play/pause, arrows step"): the next frame. Observed: the view changes to
"Difference". Pressing space then does nothing. Measured with Playwright:

```
start                    view Passes      focus BODY
after clicking Residual  view Residual    focus BUTTON.seg-btn
after ArrowRight         view Difference  focus BUTTON.seg-btn   (frame did not step)
after Space              view Difference  (movie did not start)
```

Cause: the click leaves keyboard focus on the radio button.
`web/src/ui/controls.js:77-95` (the radiogroup `keydown` handler) then consumes the arrow keys
and calls `stopPropagation()`, and `web/src/main.js:1623` deliberately ignores Space / Enter when
the event target is a button. Both are correct for someone tabbing through the controls, but not
after a pointer click. The same applies to the detector, field, stretch and colormap groups.

Suggested fix: in the option's click handler (`web/src/ui/controls.js:63`), when the click came
from a pointer (`event.detail > 0`), hand focus back to the viewer afterwards
(`document.getElementById('viewer').focus({ preventScroll: true })`; it already has
`tabindex="-1"`, `web/index.html:70`). Keyboard activation (`event.detail === 0`) keeps focus in
the group, so the ARIA radiogroup behaviour is unchanged.

The suite does not catch this because the `step` step blurs the focused element before pressing
the key, as a user who has not touched the controls would have it.

### 2. No `data-testid` hooks yet

Owner: ui-shell, ui-viewer, ui-experience. Severity: low today, a risk for later restyles.

`grep -r data-testid web/` finds nothing. The suite passes on fallbacks: ids (`#search-input`,
`#viewer`, `#player`, `#topbar`, `#landing`, `#panel-spectrum`), roles and aria-labels
("Next frame (right arrow)", "Play (space)", radio "Residual") and class names (`.tbx-card`,
`.caption`). Renaming any of these silently changes what is tested. Please add the hooks listed
in `test/README.md`; the cheapest places:

- `web/index.html`: `data-testid="viewer"` on `#viewer` (line 70), `"search-input"` on
  `#search-input`, `"topbar"` on `#topbar`, `"spectrum-panel"` on `#panel-spectrum`,
  `"landing"` on `#landing`, `"player"` on `#player`;
- `web/src/ui/player.js:59-62`: `"prev"`, `"play"`, `"next"` on the three transport buttons, and
  `"caption"` on the `.caption` element (line 96);
- `web/src/ui/controls.js` where the view options are created (about line 61):
  `data-testid="view-" + value`, which gives `view-residual` and `view-passes`;
- `web/src/ui/landing.js:259` (`button.tbx-card`): `"target-card"`; the landing's own search
  input (line 213) can carry `"search-input"` too, the suite takes the first visible one.

### 3. `proxy/src/handler.js` lazily imports a file that is not uploaded

Owner: proxy-services. Severity: low (only the synthetic backend reaches it).

`proxy/src/handler.js:277` does
`import(new URL('../fixtures/synth.js', import.meta.url).href)`. `proxy/fixtures/` is not part of
the edge function upload set (`index.ts` plus `proxy/src/*.js`), so in the deployed function that
import rejects. `proxy/supabase/functions/spherex/index.ts:30` sets `backend: "irsa"`, and the
synthetic branches (`handler.js:347`, `565`, `588`) are not taken, so production is unaffected;
`tools/deploy-bundle.mjs` therefore reports it as a warning (`--strict` makes it an error).
Suggested: leave as is, and make sure a request can never switch the backend to `synthetic` in
the edge function; or catch the rejection and answer
`{ "error": "synthetic backend is not available here", "retryable": false }` with status 501.

### 4. Seven proxy modules are uploaded but nothing imports them yet

Owner: proxy-services / S3 work. Severity: informational.

`tools/deploy-bundle.mjs --list` reports that `index.ts` reaches neither directly nor indirectly:
`src/expindex.js`, `src/focalplane.js`, `src/horizons.js`, `src/identify.js`, `src/rice.js`,
`src/s3.js`, `src/s3cutout.js` (160 kB of the 303 kB upload). They pass the import checks (no
Node built-ins, nothing outside the set). Presumably `handler.js` will import them once the S3
path is wired; if some stay unused they only cost upload size and cold-start parse time.

### 5. On a 390 px screen two view modes are off screen with no visible cue

Owner: ui-shell. Severity: low.

The page itself does not scroll sideways (pass). The view bar (`.seg-modes`,
`web/styles.css:191-192` and `536-537`) scrolls horizontally with its scrollbar hidden; "Lens"
(x 383 to 432) and "Distance" (x 432 to 504) start beyond the right edge and "Residual" is cut at
the edge (see `docs/screens/e2e-mobile.png`). A user can swipe the row, but nothing says so.
Suggested: a fade on the right edge while `scrollLeft + clientWidth < scrollWidth`, or let the
row wrap to two lines under 420 px.

## Notes on what the suite observed

- Clicking the first target card ("Barnard's Star") leads to
  `/?ra=269.44597&dec=4.77068&name=Barnard%27s+Star`; the first picture is on screen about two
  seconds later (synthetic backend, 42 exposures of detector 3).
- The movie starts playing by itself, whether the target was opened from a card or from a URL;
  the suite pauses it before it compares pictures.
- While the movie plays, `t` is left out of the URL; it is written when the movie is paused or
  stepped by hand (paused on pass 3 of 3 the URL says `t=2`).
- The view switch reaches the URL about 400 ms after the click (debounced `replaceState`,
  `web/src/state.js:221`), and unknown parameters such as `api` are kept, so reloads work in
  bundle mode too.
- Caption texts seen: "Pass 3 of 3 · Jun 2026 2026-06-12 to 2026-06-14 · D3 · 1.63-2.41 µm 14
  exposures stacked", then pass 2 and pass 1 after stepping; "Residual · pass 1 of 3 · jun 2025"
  in the residual view. The spectrum panel went from 1 to 59 plotted points after a click on the
  centre of the picture.

## Bundler notes for the integrator

- `web/src/main.js:1817` loads plugins with `` import(`./plugins/${name}/index.js`) ``. The
  bundler includes every `web/src/plugins/*/index.js` that exists at build time, whether or not
  `PLUGINS` lists it (unlisted ones are never evaluated; they only add bytes: the four present
  today are 19 modules, about 331 kB of the 1239 kB file).
- If a plugin is broken at build time (an import that does not resolve, a name its dependency does
  not export, a syntax error, top-level `await`), the build still succeeds, prints
  `warning: src/plugins/<name>/index.js is LEFT OUT of the bundle ...` and records it under
  `leftOut` in `dist/tombaugh.meta.json`; at run time the shell logs "plugin ... was skipped", as
  it would natively. Use `node tools/build.mjs --strict` before the final upload to turn any such
  warning into a failure.
- Not supported, and reported with file and line if it appears: top-level `await`. Reported as a
  warning: `import.meta.url` (it is the page URL inside the bundle), `new Worker(...)` (worker
  files are not bundled), a named import of an exported `let` that is reassigned later (snapshot
  instead of live binding). None of these occur in `web/` today.
