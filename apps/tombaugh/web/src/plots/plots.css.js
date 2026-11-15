// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Styles for the plots, injected once per document by ensurePlotStyles(). Keeping the CSS here
// makes web/src/plots/ self-contained: a host page needs no stylesheet for the plots to look
// right. Everything is scoped under the .tbp class and can be themed with CSS custom properties
// set on any ancestor:
//   --tbp-ink, --tbp-paper, --tbp-stone, --tbp-signal  brand colours
//   --tbp-muted   small secondary text (default: Paper at 66 percent, 7:1 on Ink; Stone itself
//                 is 3.9:1 on Ink, too low for 11 px text, so Stone is used for lines only)
//   --tbp-raised  tooltip and button background

export const PLOT_STYLE_ID = 'tbp-plots-css';

export const PLOT_CSS = `
.tbp {
  --_ink: var(--tbp-ink, #171715);
  --_paper: var(--tbp-paper, #F7F2E7);
  --_stone: var(--tbp-stone, #77766E);
  --_signal: var(--tbp-signal, #E53C27);
  --_muted: var(--tbp-muted, rgba(247, 242, 231, 0.66));
  --_raised: var(--tbp-raised, #23231F);
  --_num: Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace;
  --_txt: Arial, Helvetica, sans-serif;
  display: block;
  margin: 0;
  padding: 0;
  color: var(--_paper);
  font: 13px/1.35 var(--_txt);
  min-width: 0;
  -webkit-text-size-adjust: 100%;
}
.tbp *, .tbp *::before, .tbp *::after { box-sizing: border-box; }

.tbp-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  min-height: 28px;
  margin: 0 0 6px;
}
.tbp-titles { min-width: 0; flex: 1 1 140px; }
.tbp-title {
  font: bold 13px/17px var(--_txt);
  height: 17px;
  color: var(--_paper);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tbp-sub {
  font: 11px/15px var(--_txt);
  color: var(--_muted);
  height: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tbp-tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tbp-tools-group { display: inline-flex; gap: 6px; }
.tbp-seg { display: inline-flex; }
.tbp-btn {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
  height: 26px;
  padding: 0 9px;
  border: 1px solid rgba(119, 118, 110, 0.7);
  border-radius: 3px;
  background: transparent;
  color: var(--_paper);
  font: 11px/1 var(--_txt);
  letter-spacing: 0.02em;
  cursor: pointer;
  white-space: nowrap;
}
.tbp-seg .tbp-btn { border-radius: 0; margin-left: -1px; }
.tbp-seg .tbp-btn:first-child { border-radius: 3px 0 0 3px; margin-left: 0; }
.tbp-seg .tbp-btn:last-child { border-radius: 0 3px 3px 0; }
.tbp-btn:hover:not(:disabled) { border-color: var(--_paper); }
.tbp-btn:focus-visible { outline: 2px solid var(--_paper); outline-offset: 1px; }
.tbp-btn[aria-pressed="true"] {
  background: var(--_paper);
  border-color: var(--_paper);
  color: var(--_ink);
  position: relative;
}
.tbp-btn:disabled { opacity: 0.4; cursor: default; }
.tbp-btn-fixed { min-width: 84px; text-align: center; }

.tbp-body { position: relative; }
.tbp-svg {
  display: block;
  width: 100%;
  overflow: visible;
  touch-action: pan-y;
  -webkit-tap-highlight-color: transparent;
}
.tbp-svg:focus { outline: none; }
.tbp-svg:focus-visible { outline: 1px solid var(--_stone); outline-offset: 2px; }
.tbp-svg text { font-family: var(--_txt); font-size: 11px; fill: var(--_muted); }
.tbp-svg .tbp-num { font-family: var(--_num); }
.tbp-svg .tbp-axis-title { fill: var(--_muted); font-size: 11px; }
.tbp-svg .tbp-strong { fill: var(--_paper); }
.tbp-svg .tbp-empty { fill: var(--_muted); font-size: 13px; }
.tbp-svg .tbp-halo { paint-order: stroke; stroke: var(--_ink); stroke-width: 3px; stroke-linejoin: round; }
.tbp-axis { stroke: var(--_stone); stroke-width: 1; fill: none; shape-rendering: crispEdges; }
.tbp-grid { stroke: var(--_paper); stroke-opacity: 0.07; stroke-width: 1; fill: none; shape-rendering: crispEdges; }

.tbp-enter { animation: tbp-in 200ms ease-out both; }
@keyframes tbp-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .tbp-enter { animation: none; }
}

.tbp-tip {
  position: absolute;
  z-index: 5;
  left: 0;
  top: 0;
  max-width: 240px;
  padding: 6px 8px;
  background: var(--_raised);
  border: 1px solid rgba(119, 118, 110, 0.8);
  border-radius: 3px;
  color: var(--_paper);
  font: 11px/1.45 var(--_num);
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
}
.tbp-tip[hidden] { display: none; }
.tbp-tip-head { font-weight: bold; }
.tbp-tip-dim { color: var(--_muted); }
.tbp-tip-flag { color: var(--_paper); font-family: var(--_txt); }

.tbp-foot { margin: 6px 0 0; }
.tbp-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  min-height: 18px;
  font: 11px/1.3 var(--_txt);
  color: var(--_muted);
}
.tbp-narrow .tbp-legend { min-height: 36px; align-content: flex-start; }
.tbp-legend-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.tbp-legend-item svg { display: block; flex: none; }
.tbp-legend-item .tbp-num { font-family: var(--_num); }

.tbp-verdict {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-height: 20px;
  margin: 8px 0 0;
  font: 13px/1.4 var(--_txt);
  color: var(--_paper);
}
.tbp-narrow .tbp-verdict { min-height: 37px; }
.tbp-verdict-mark {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--_stone);
  transform: translateY(-1px);
}
.tbp-verdict.tbp-is-signal .tbp-verdict-mark { background: var(--_signal); }
.tbp-verdict.tbp-text-signal { color: var(--_signal); }
.tbp-verdict:empty, .tbp-verdict.tbp-is-blank .tbp-verdict-mark { visibility: hidden; }

.tbp-motion-grid { display: flex; gap: 8px 22px; align-items: center; }
.tbp-motion-track { flex: 0 0 256px; min-width: 0; }
.tbp-motion-compare { flex: 1 1 0; min-width: 0; max-width: 560px; }
.tbp-narrow .tbp-motion-grid { flex-direction: column; align-items: stretch; }
.tbp-narrow .tbp-motion-track { flex: 0 0 auto; }
.tbp-narrow .tbp-motion-compare { flex: 0 0 auto; max-width: none; }

.tbp-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
`;

/** Inject the plot stylesheet into the document once. Safe to call many times. */
export function ensurePlotStyles(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.head) return;
  if (d.getElementById(PLOT_STYLE_ID)) return;
  const style = d.createElement('style');
  style.id = PLOT_STYLE_ID;
  style.textContent = PLOT_CSS;
  d.head.appendChild(style);
}
