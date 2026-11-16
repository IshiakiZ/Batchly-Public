// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Styles for the "Data source" panel, injected once per document by ensureDataSourceStyles().
// Everything is scoped under .tbd. Colours come from the page's custom properties when it has
// them (--ink, --paper, --signal, --stone) and fall back to the brand values.
// Small secondary text is Paper at 66 percent (about 7:1 on Ink); Stone is used for lines only.

export const DATASOURCE_STYLE_ID = 'tbd-datasource-css';

export const DATASOURCE_CSS = `
.tbd {
  --_ink: var(--ink, #171715);
  --_paper: var(--paper, #F7F2E7);
  --_signal: var(--signal, #E53C27);
  --_stone: var(--stone, #77766E);
  --_muted: rgba(247, 242, 231, 0.66);
  --_rule: rgba(247, 242, 231, 0.18);
  display: grid;
  gap: 16px;
  min-width: 0;
  color: var(--_paper);
  font: 13px/1.45 Arial, Helvetica, sans-serif;
}
.tbd *, .tbd *::before, .tbd *::after { box-sizing: border-box; }
.tbd p { margin: 0; }
.tbd [hidden] { display: none !important; }

.tbd-head {
  margin: 0 0 6px;
  color: var(--_muted);
  font: bold 11px/1.3 Arial, Helvetica, sans-serif;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.tbd-now { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; }
.tbd-now-label { font: 900 15px/1.25 "Arial Black", -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif; }
.tbd-muted { color: var(--_muted); }
.tbd-num { font-family: Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace; }

.tbd-notice {
  padding: 8px 10px;
  border: 1px solid var(--_rule);
  border-left: 3px solid var(--_stone);
  border-radius: 2px;
  background: rgba(247, 242, 231, 0.04);
}
.tbd-notice[data-kind="warn"], .tbd-notice[data-kind="error"] { border-left-color: var(--_signal); }

.tbd-set { margin: 0; padding: 0; border: 0; min-width: 0; display: grid; gap: 2px; }
.tbd-set legend { padding: 0; }
.tbd-option {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 2px 10px;
  align-items: start;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 2px;
  cursor: pointer;
}
.tbd-option:hover { background: rgba(247, 242, 231, 0.05); }
.tbd-option.is-current { border-color: var(--_rule); background: rgba(247, 242, 231, 0.04); }
.tbd-option input {
  grid-row: 1 / span 2;
  width: 16px;
  height: 16px;
  margin: 2px 0 0;
  accent-color: var(--_paper);
  cursor: inherit;
}
.tbd-option input:focus-visible { outline: 2px solid var(--_paper); outline-offset: 2px; }
.tbd-option-label { font-weight: bold; }
.tbd-option-text { grid-column: 2; color: var(--_muted); }
.tbd-set[aria-busy="true"] .tbd-option { cursor: progress; opacity: 0.7; }

.tbd-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 14px; }
.tbd-row > :first-child { flex: 1 1 200px; min-width: 0; }
.tbd-btn {
  appearance: none;
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid var(--_stone);
  border-radius: 2px;
  background: transparent;
  color: var(--_paper);
  font: 13px/1 Arial, Helvetica, sans-serif;
  cursor: pointer;
}
.tbd-btn:hover { border-color: var(--_paper); background: rgba(247, 242, 231, 0.06); }
.tbd-btn:focus-visible { outline: 2px solid var(--_paper); outline-offset: 2px; }
.tbd-btn[disabled] { color: var(--_muted); border-color: var(--_rule); cursor: not-allowed; background: transparent; }

.tbd-check { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold; }
.tbd-check input { width: 16px; height: 16px; margin: 0; accent-color: var(--_paper); cursor: inherit; }
.tbd-check input:focus-visible { outline: 2px solid var(--_paper); outline-offset: 2px; }

.tbd-practice { display: grid; gap: 10px; }
.tbd-answers { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.tbd-answer { padding-left: 10px; border-left: 1px solid var(--_stone); }
.tbd-answer-title { font-weight: bold; }
.tbd-answer-where { color: var(--_muted); }

@media (prefers-reduced-motion: no-preference) {
  .tbd-option, .tbd-btn { transition: background-color 120ms ease, border-color 120ms ease; }
}
`;

/** Injects the styles once. Does nothing without a document. */
export function ensureDataSourceStyles(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !doc.head) return false;
  if (doc.getElementById(DATASOURCE_STYLE_ID)) return true;
  const style = doc.createElement('style');
  style.id = DATASOURCE_STYLE_ID;
  style.textContent = DATASOURCE_CSS;
  doc.head.append(style);
  return true;
}
