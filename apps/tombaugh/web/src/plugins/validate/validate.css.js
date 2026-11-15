// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Styles for the Validation panel, injected once per document by ensureValidateStyles().
// Everything is scoped under .tbq, so the plugin needs nothing from the host stylesheet.
// Brand: Ink #171715, Paper #F7F2E7, Stone #77766E (rules and borders only: small text uses
// Paper at 68 percent, 7:1 on Ink, where Stone is 3.9:1), and Signal #E53C27 for exactly one
// thing: the mark beside a number that disagrees with its catalogue value by more than three
// sigma. Arial for text, Consolas for numbers.

export const VALIDATE_STYLE_ID = 'tbq-validate-css';

export const VALIDATE_CSS = `
.tbq {
  --tbq-ink: #171715;
  --tbq-paper: #F7F2E7;
  --tbq-signal: #E53C27;
  --tbq-stone: #77766E;
  --tbq-muted: rgba(247, 242, 231, 0.68);
  --tbq-rule: rgba(247, 242, 231, 0.14);
  --tbq-rule-strong: rgba(247, 242, 231, 0.3);
  --tbq-raised: rgba(247, 242, 231, 0.05);
  --tbq-num: Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace;
  --tbq-txt: Arial, Helvetica, sans-serif;
  display: grid;
  gap: 14px;
  min-width: 0;
  container-type: inline-size;
  color: var(--tbq-paper);
  font: 13px/1.5 var(--tbq-txt);
  -webkit-text-size-adjust: 100%;
}
.tbq *, .tbq *::before, .tbq *::after { box-sizing: border-box; }
.tbq p, .tbq ul, .tbq li, .tbq h3, .tbq h4, .tbq table, .tbq figure { margin: 0; padding: 0; }
.tbq ul { list-style: none; }
.tbq [hidden] { display: none !important; }

.tbq-lede { color: var(--tbq-muted); max-width: 52ch; }

.tbq-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.tbq-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 5px 12px;
  background: transparent;
  border: 1px solid var(--tbq-rule-strong);
  border-radius: 2px;
  color: var(--tbq-paper);
  font: 13px/1.2 var(--tbq-txt);
  text-align: center;
  cursor: pointer;
  transition: background 150ms, border-color 150ms;
}
.tbq-btn:hover { background: rgba(247, 242, 231, 0.07); border-color: var(--tbq-paper); }
.tbq-btn:active { background: rgba(247, 242, 231, 0.12); }
.tbq-btn:focus-visible { outline: 2px solid var(--tbq-paper); outline-offset: 2px; }
.tbq-btn[disabled] { color: var(--tbq-stone); border-color: var(--tbq-rule); cursor: not-allowed; background: transparent; }
.tbq-btn-solid { background: var(--tbq-paper); border-color: var(--tbq-paper); color: var(--tbq-ink); font-weight: bold; }
.tbq-btn-solid:hover { background: #fff; border-color: #fff; }
.tbq-btn-solid[disabled] { background: transparent; }
.tbq-btn-small { min-height: 26px; padding: 3px 9px; font-size: 12px; }

.tbq-run { display: grid; gap: 6px; }
.tbq-status { min-height: 18px; font: 12px/1.5 var(--tbq-txt); color: var(--tbq-muted); overflow-wrap: anywhere; }
.tbq-status.is-busy { color: var(--tbq-paper); }
.tbq-bar { height: 2px; background: var(--tbq-rule); overflow: hidden; }
.tbq-bar > span { display: block; height: 100%; width: 0; background: var(--tbq-paper); transition: width 200ms; }

.tbq-results { display: grid; gap: 22px; min-width: 0; }
.tbq-card { display: grid; gap: 10px; min-width: 0; padding-top: 14px; border-top: 1px solid var(--tbq-rule-strong); }
.tbq-card-head { display: grid; gap: 2px; }
.tbq-name { font: bold 14px/1.3 var(--tbq-txt); letter-spacing: 0.01em; }
.tbq-meta { font: 12px/1.45 var(--tbq-txt); color: var(--tbq-muted); }
.tbq-meta .tbq-n { font-family: var(--tbq-num); }
.tbq-none { color: var(--tbq-muted); }

.tbq-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.tbq-table caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.tbq-table col.tbq-c-q { width: 31%; }
.tbq-table col.tbq-c-m { width: 30%; }
.tbq-table col.tbq-c-r { width: 26%; }
.tbq-table col.tbq-c-s { width: 13%; }
.tbq-table th, .tbq-table td { padding: 5px 8px 5px 0; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
.tbq-table th:last-child, .tbq-table td:last-child { padding-right: 0; text-align: right; }
.tbq-table thead th {
  font: 10.5px/1.3 var(--tbq-txt);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tbq-muted);
  font-weight: normal;
  border-bottom: 1px solid var(--tbq-rule-strong);
  padding-bottom: 6px;
}
.tbq-table thead th.tbq-th-s { text-transform: none; font-size: 12px; line-height: 1.1; letter-spacing: 0; }
.tbq-table tbody th { font: 12px/1.4 var(--tbq-txt); font-weight: normal; color: var(--tbq-paper); }
.tbq-table tbody td { font: 12px/1.4 var(--tbq-num); color: var(--tbq-paper); }
.tbq-table tbody td.tbq-ref { color: var(--tbq-muted); }
.tbq-table tbody tr + tr th, .tbq-table tbody tr + tr td { border-top: 1px solid var(--tbq-rule); }
.tbq-table tr.tbq-group th {
  padding-top: 12px;
  font: 10.5px/1.3 var(--tbq-txt);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tbq-muted);
  border-top: 0;
  text-align: left;
}
.tbq-table tr.tbq-group + tr th, .tbq-table tr.tbq-group + tr td { border-top: 1px solid var(--tbq-rule-strong); }
.tbq-sig { white-space: nowrap; }
.tbq-flag {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 5px;
  border-radius: 50%;
  background: var(--tbq-signal);
  vertical-align: 1px;
}
.tbq-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.tbq-sub { font: bold 12px/1.3 var(--tbq-txt); letter-spacing: 0.02em; margin-top: 6px; }
.tbq-field { display: grid; gap: 10px; min-width: 0; }
.tbq-plot { display: grid; grid-template-columns: 156px minmax(0, 1fr); gap: 12px; align-items: center; min-width: 0; }
.tbq-plot svg { display: block; width: 100%; height: auto; }
.tbq-plot figcaption { font: 11px/1.45 var(--tbq-txt); color: var(--tbq-muted); }
.tbq-verdicts { display: grid; gap: 8px; min-width: 0; font: 12px/1.5 var(--tbq-txt); }
.tbq-verdicts b { font-weight: bold; }
.tbq-verdicts .tbq-n { font-family: var(--tbq-num); }
@container (max-width: 270px) { .tbq-plot { grid-template-columns: minmax(0, 1fr); } .tbq-plot svg { max-width: 168px; } }

.tbq-notes { font: 12px/1.5 var(--tbq-txt); color: var(--tbq-muted); }
.tbq-notes summary { cursor: pointer; color: var(--tbq-paper); width: fit-content; padding: 2px 0; }
.tbq-notes summary:focus-visible { outline: 2px solid var(--tbq-paper); outline-offset: 2px; }
.tbq-notes ul { display: grid; gap: 5px; margin-top: 6px; }
.tbq-notes li b { color: var(--tbq-paper); font-weight: normal; }

.tbq-export { display: grid; gap: 8px; padding-top: 14px; border-top: 1px solid var(--tbq-rule-strong); }
.tbq-copybox {
  width: 100%;
  min-height: 140px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--tbq-rule-strong);
  border-radius: 2px;
  color: var(--tbq-paper);
  font: 11px/1.45 var(--tbq-num);
  resize: vertical;
}
.tbq-copybox:focus-visible { outline: 2px solid var(--tbq-paper); outline-offset: 2px; }
.tbq-how { font: 12px/1.5 var(--tbq-txt); color: var(--tbq-muted); max-width: 60ch; }

@media (prefers-reduced-motion: reduce) {
  .tbq-btn, .tbq-bar > span { transition: none; }
}
`;

/** Inject the styles once per document. Safe to call repeatedly, and where there is no DOM. */
export function ensureValidateStyles(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !doc.head || doc.getElementById(VALIDATE_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = VALIDATE_STYLE_ID;
  style.textContent = VALIDATE_CSS;
  doc.head.appendChild(style);
}
