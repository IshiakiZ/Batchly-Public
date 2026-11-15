// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Styles for the Listen panel, injected once per document by ensureSonifyStyles(). Everything
// is scoped under .tbsn. Brand: Ink #171715, Paper #F7F2E7, Signal #E53C27 (the playhead and
// nothing else), Stone #77766E (rules; small text uses Paper at 68 percent for contrast).

export const SONIFY_STYLE_ID = 'tbsn-sonify-css';

export const SONIFY_CSS = `
.tbsn {
  --tbsn-ink: #171715;
  --tbsn-paper: #F7F2E7;
  --tbsn-signal: #E53C27;
  --tbsn-stone: #77766E;
  --tbsn-muted: rgba(247, 242, 231, 0.68);
  --tbsn-rule: rgba(247, 242, 231, 0.14);
  --tbsn-raised: rgba(247, 242, 231, 0.05);
  --tbsn-num: Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace;
  --tbsn-txt: -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif;
  display: grid;
  gap: 12px;
  min-width: 0;
  color: var(--tbsn-paper);
  font: 13px/1.5 var(--tbsn-txt);
  -webkit-text-size-adjust: 100%;
}
.tbsn *, .tbsn *::before, .tbsn *::after { box-sizing: border-box; }
.tbsn p { margin: 0; }
.tbsn [hidden] { display: none !important; }

.tbsn-lead { color: var(--tbsn-muted); font-size: 12px; max-width: 60ch; }

.tbsn-stage { display: grid; gap: 4px; min-width: 0; }
.tbsn-score {
  display: block;
  width: 100%;
  height: 76px;
  background: var(--tbsn-raised);
  border: 1px solid var(--tbsn-rule);
  border-radius: 3px;
}
.tbsn-score .tbsn-grid { stroke: var(--tbsn-rule); stroke-width: 1; vector-effect: non-scaling-stroke; }
.tbsn-score .tbsn-dot { fill: var(--tbsn-paper); }
.tbsn-score .tbsn-dot[data-dip="1"] { fill: none; stroke: var(--tbsn-paper); stroke-width: 1; vector-effect: non-scaling-stroke; }
.tbsn-score .tbsn-dot.is-on { fill: var(--tbsn-signal); stroke: var(--tbsn-signal); }
.tbsn-score .tbsn-head { stroke: var(--tbsn-signal); stroke-width: 1.5; vector-effect: non-scaling-stroke; transition: transform 70ms linear; }
.tbsn-score .tbsn-empty { fill: var(--tbsn-muted); font: 11px var(--tbsn-txt); }
.tbsn-axis { display: flex; justify-content: space-between; gap: 8px; font: 11px/1.3 var(--tbsn-num); color: var(--tbsn-muted); }
.tbsn-axis .tbsn-now { color: var(--tbsn-paper); min-width: 9ch; text-align: center; }

.tbsn-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tbsn-btn {
  appearance: none;
  -webkit-appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(119, 118, 110, 0.9);
  border-radius: 3px;
  background: transparent;
  color: var(--tbsn-paper);
  font: 12px/1 var(--tbsn-txt);
  letter-spacing: 0.02em;
  cursor: pointer;
  white-space: nowrap;
}
.tbsn-btn svg { width: 10px; height: 10px; fill: currentColor; flex: none; }
.tbsn-btn:hover:not(:disabled):not([aria-pressed="true"]) { border-color: var(--tbsn-paper); background: var(--tbsn-raised); }
.tbsn-btn:focus-visible, .tbsn-vol input:focus-visible { outline: 2px solid var(--tbsn-paper); outline-offset: 2px; border-radius: 2px; }
.tbsn-btn[aria-pressed="true"] { background: var(--tbsn-paper); border-color: var(--tbsn-paper); color: var(--tbsn-ink); }
.tbsn-btn:disabled { color: var(--tbsn-muted); border-color: var(--tbsn-rule); cursor: not-allowed; opacity: 0.75; }

.tbsn-vol { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--tbsn-muted); }
.tbsn-vol label { flex: none; }
.tbsn-vol input { flex: 1 1 120px; max-width: 220px; min-width: 0; height: 20px; margin: 0; accent-color: var(--tbsn-paper); cursor: pointer; }
.tbsn-vol output { flex: none; min-width: 4ch; font: 12px/1 var(--tbsn-num); color: var(--tbsn-paper); text-align: right; }

.tbsn-reason { font-size: 12px; color: var(--tbsn-paper); padding: 7px 10px; background: var(--tbsn-raised); border-left: 2px solid var(--tbsn-stone); border-radius: 0 3px 3px 0; }
.tbsn-words { display: grid; gap: 3px; padding-top: 12px; border-top: 1px solid var(--tbsn-rule); }
.tbsn-label { font: 11px/1.3 var(--tbsn-txt); letter-spacing: 0.08em; text-transform: uppercase; color: var(--tbsn-muted); }
.tbsn-desc { color: var(--tbsn-paper); max-width: 62ch; }
.tbsn-desc + .tbsn-desc { color: var(--tbsn-muted); font-size: 12px; }

@media (prefers-reduced-motion: reduce) {
  .tbsn-score .tbsn-head { transition: none; }
}
`;

/** Adds the stylesheet to the document once. Safe to call repeatedly and without a document. */
export function ensureSonifyStyles(doc = globalThis.document) {
  if (!doc || !doc.head || doc.getElementById(SONIFY_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = SONIFY_STYLE_ID;
  style.textContent = SONIFY_CSS;
  doc.head.append(style);
}
