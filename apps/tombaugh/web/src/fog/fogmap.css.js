// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Styles for the fog map, injected once per document as <style id="tb-fog-style">.
//   injectFogStyles(doc = document)   idempotent
//   FOG_CSS                            the stylesheet text (tools/build.mjs may inline it instead)
// Colours follow the brand and can be overridden with custom properties on any ancestor:
//   --tb-ink, --tb-paper, --tb-signal, --tb-stone.

export const FOG_STYLE_ID = 'tb-fog-style';

export const FOG_CSS = `
.tb-fog {
  --fog-ink: var(--tb-ink, #171715);
  --fog-paper: var(--tb-paper, #F7F2E7);
  --fog-signal: var(--tb-signal, #E53C27);
  --fog-stone: var(--tb-stone, #77766E);
  --fog-dim: rgba(247, 242, 231, 0.66);
  display: grid;
  gap: 10px;
  min-width: 0;
  color: var(--fog-paper);
  font: 14px/1.45 Arial, Helvetica, sans-serif;
  text-align: left;
}
.tb-fog *, .tb-fog *::before, .tb-fog *::after { box-sizing: border-box; }
.tb-fog-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 20px;
}
.tb-fog-stat { margin: 0; font-size: 15px; color: var(--fog-dim); }
.tb-fog-stat b {
  font-family: Consolas, "SF Mono", Menlo, "DejaVu Sans Mono", monospace;
  font-weight: 400;
  color: var(--fog-paper);
}
.tb-fog-stat .tb-fog-n { font-size: 19px; }
.tb-fog-go {
  appearance: none;
  margin: 0;
  padding: 10px 16px;
  min-height: 40px;
  border: 1px solid var(--fog-paper);
  border-radius: 2px;
  background: transparent;
  color: var(--fog-paper);
  font: 700 14px/1.2 Arial, Helvetica, sans-serif;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.tb-fog-go:hover, .tb-fog-go:active { background: var(--fog-paper); color: var(--fog-ink); }
.tb-fog-go:focus-visible { outline: 2px solid var(--fog-signal); outline-offset: 2px; }
.tb-fog-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 1;
  min-width: 0;
}
.tb-fog-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: crosshair;
  outline: none;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.tb-fog-canvas:focus-visible { outline: 1px dashed var(--fog-stone); outline-offset: 2px; }
.tb-fog-readout {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 18px;
  min-height: 3.1em;
  margin: 0;
  padding: 8px 0 0;
  border-top: 1px solid rgba(119, 118, 110, 0.4);
  font-family: Consolas, "SF Mono", Menlo, "DejaVu Sans Mono", monospace;
  font-size: 13px;
  line-height: 1.5;
}
.tb-fog-readout .tb-fog-deg { color: var(--fog-dim); }
.tb-fog-readout .tb-fog-state { font-family: -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif; font-size: 14px; }
.tb-fog-readout .tb-fog-state.is-new { color: var(--fog-paper); font-weight: 700; }
.tb-fog-readout .tb-fog-hint { font-family: -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif; font-size: 13px; color: var(--fog-dim); }
.tb-fog-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--fog-dim);
}
.tb-fog-legend li { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.tb-fog-legend svg { flex: none; display: block; }
@media (max-width: 520px) {
  .tb-fog-head { align-items: stretch; }
  .tb-fog-go { width: 100%; }
  .tb-fog-readout { min-height: 4.6em; font-size: 12px; }
  .tb-fog-readout .tb-fog-state { font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) {
  .tb-fog-go { transition: none; }
}
`;

/** Add the stylesheet to the document head once. Safe to call repeatedly. */
export function injectFogStyles(doc = globalThis.document) {
  if (!doc || !doc.head) return;
  if (doc.getElementById(FOG_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = FOG_STYLE_ID;
  style.textContent = FOG_CSS;
  doc.head.appendChild(style);
}
