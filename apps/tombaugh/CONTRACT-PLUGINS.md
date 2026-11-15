# Tombaugh contract, part 3: plugins

Read `CONTRACT.md` first. Extra features are added as **plugins** so that they can be built in parallel
and wired with one line. A plugin is a folder `web/src/plugins/<name>/` whose `index.js` exports

```js
export const meta = { id: 'export', title: 'Export', description: 'one sentence' };
export function install(app) { /* register tools, panels, views; return optional { dispose() } */ }
```

`web/src/main.js` (owner: ui-shell) builds the `app` object once the page is up and then loads every
plugin listed in `web/src/plugins/index.js` (owner: integrator; `export const PLUGINS = ['export', ...]`)
with `import('./plugins/<name>/index.js')` inside try/catch: a plugin that throws is logged and skipped.
Plugins must be self-contained (own CSS injected once from a `*.css.js` module, no edits to shell files),
must import core modules only through relative paths (`../../core/x.js`), must work when a feature they
want is missing (`if (!app.viewer) return`), must never throw from event handlers, and must clean up in
`dispose()`. Same coding rules as CONTRACT.md (file header, zero dependencies, no CDN, pure logic split
from DOM code so it can be unit-tested with `node --test`, brand colours, reduced-motion, keyboard access).

## The `app` object (provided by the shell)

```ts
app.version: string
app.api                       // createApi() instance: search, cutout, gaia, resolve, fog, fogMark, baseUrl
app.store                     // { get(): State, set(patch), subscribe(fn) -> unsubscribe }   State = URL state keys in CONTRACT.md
app.viewer                    // the createViewer() instance (may be null in tests)
app.target(): { ra, dec, name } | null
app.grid(): Grid | null                         // current common grid
app.frames(det?): Frame[]                       // decoded native frames loaded so far (all detectors, or one)
app.layers(det?): Layer[]                       // reprojected layers on the current grid (default: selected detector)
app.movie(): { frames: MovieFrame[], index: number, playing: boolean, view: string }
                                                // MovieFrame = { image: Float32Array, mask: Uint8Array, range: [lo, hi],
                                                //   caption: { title, date, wave, note }, mjd?: number, diverging?: boolean, rgb?: {r,g,b} }
app.setFrameIndex(i), app.play(), app.pause()
app.goTo({ ra, dec, name? })                     // load a new target
app.gaia(): GaiaStar[]                           // stars loaded for the field ([] if none)
app.selection(): { ra, dec, x, y, spectrum?: SpecPoint[], binned?: SpecPoint[], lightCurve?: [], motion?: {} } | null
                                                // the last clicked source and what was measured for it

app.on(event, fn) -> unsubscribe                 // events: 'target' (new target chosen), 'frames' (more frames arrived),
                                                //   'movie' (movie rebuilt), 'frame' (index changed), 'select' (source clicked),
                                                //   'state' (URL state changed)
app.addTool({ id, label, title, icon?, onClick, group? }) -> { setActive(bool), setDisabled(bool, reason?), remove() }
                                                // a button in the viewer toolbar strip (group 'view' | 'export' | 'extra')
app.addPanel({ id, title, order?, render(container) -> ({ update?(), dispose?() } | void) }) -> { show(), hide(), remove() }
                                                // a tab/section in the side column; `render` is called once when first shown
app.addView({ id, label, title, needs?: (state) => number[]            // extra detectors to load, optional
            , build(ctx) -> MovieFrame[] | Promise<MovieFrame[]> }) -> { remove() }
                                                // an extra entry in the view-mode control; ctx = { app, state, grid, layers,
                                                //   layersByDet: Map<det, Layer[]>, frames, gaia }
app.addOverlay(fn) -> remove                    // fn(movieFrame, index) -> extra viewer overlay objects merged into setOverlays
app.toast(message, { kind?: 'info' | 'warn' | 'error', ms? })
app.explain(topicId)                            // open an explainer card if the explainer is present
app.openModal({ title, render(container), onClose? }) -> { close() }   // a centred dialog with focus trap and Esc
```

For unit tests and a standalone `demo.html`, each plugin should ship a tiny fake `app` (only the parts
it uses) so that it can be exercised without the shell.
