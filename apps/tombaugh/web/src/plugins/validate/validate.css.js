// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Styles for the Validation panel, injected once per document by ensureValidateStyles().
// Everything is scoped under .tbv, so the plugin needs nothing from the host stylesheet.
// Brand: Ink #171715, Paper #F7F2E7, Stone #77766E (rules and borders only: small text uses
// Paper at 68 percent, 7:1 on Ink, where Stone is 3.9:1), and Signal #E53C27 for exactly one
// thing: the mark beside a number that disagrees with its catalogue value by more than three
// sigma. Arial for text, Consolas for numbers.

export const VALIDATE_STYLE_ID = 'tbv-validate-css';

export const VALIDATE_CSS = `
.tbv {
  --tbv-ink: #171715;
  --tbv-paper: #F7F2E7;
  --tbv-signal: #E53C27;
  --tbv-stone: #77766E;
  --tbv-muted: rgba(247, 242, 231, 0.68);
  --tbv-rule: rgba(247, 242, 231, 0.14);
  --tbv-rule-strong: rgba(247, 242, 231, 0.3);
  --tbv-raised: rgba(247, 242, 231, 0.05);
  --tbv-num: Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace;
  --tbv-txt: Arial, Helvetica, sans-serif;
  display: grid;
  gap: 14px;
  min-width: 0;
  container-type: inline-size;
  color: var(--tbv-paper);
  font: 13px/1.5 var(--tbv-txt);
  -webkit-text-size-adjust: 100%;
}
.tbv *, .tbv *::before, .tbv *::after { box-sizing: border-box; }
.tbv p, .tbv ul, .tbv li, .tbv h3, .tbv h4, .tbv table, .tbv figure { margin: 0; padding: 0; }
.tbv ul { list-style: none; }
.tbv [hidden] { display: none !important; }

.tbv-lede { color: var(--tbv-muted); max-width: 52ch; }

.tbv-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.tbv-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 5px 12px;
  background: transparent;
  border: 1px solid var(--tbv-rule-strong);
  border-radius: 2px;
  color: var(--tbv-paper);
  font: 13px/1.2 var(--tbv-txt);
  text-align: center;
  cursor: pointer;
  transition: background 150ms, border-color 150ms;
}
.tbv-btn:hover { background: rgba(247, 242, 231, 0.07); border-color: var(--tbv-paper); }
.tbv-btn:active { background: rgba(247, 242, 231, 0.12); }
.tbv-btn:focus-visible { outline: 2px solid var(--tbv-paper); outline-offset: 2px; }
.tbv-btn[disabled] { color: var(--tbv-stone); border-color: var(--tbv-rule); cursor: not-allowed; background: transparent; }
.tbv-btn-solid { background: var(--tbv-paper); border-color: var(--tbv-paper); color: var(--tbv-ink); font-weight: bold; }
.tbv-btn-solid:hover { background: #fff; border-color: #fff; }
.tbv-btn-solid[disabled] { background: transparent; }
.tbv-btn-small { min-height: 26px; padding: 3px 9px; font-size: 12px; }

.tbv-run { display: grid; gap: 6px; }
.tbv-status { min-height: 18px; font: 12px/1.5 var(--tbv-txt); color: var(--tbv-muted); overflow-wrap: anywhere; }
.tbv-status.is-busy { color: var(--tbv-paper); }
.tbv-bar { height: 2px; background: var(--tbv-rule); overflow: hidden; }
.tbv-bar > span { display: block; height: 100%; width: 0; background: var(--tbv-paper); transition: width 200ms; }

.tbv-results { display: grid; gap: 22px; min-width: 0; }
.tbv-card { display: grid; gap: 10px; min-width: 0; padding-top: 14px; border-top: 1px solid var(--tbv-rule-strong); }
.tbv-card-head { display: grid; gap: 2px; }
.tbv-name { font: bold 14px/1.3 var(--tbv-txt); letter-spacing: 0.01em; }
.tbv-meta { font: 12px/1.45 var(--tbv-txt); color: var(--tbv-muted); }
.tbv-meta .tbv-n { font-family: var(--tbv-num); }
.tbv-none { color: var(--tbv-muted); }

.tbv-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.tbv-table caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.tbv-table col.tbv-c-q { width: 31%; }
.tbv-table col.tbv-c-m { width: 30%; }
.tbv-table col.tbv-c-r { width: 26%; }
.tbv-table col.tbv-c-s { width: 13%; }
.tbv-table th, .tbv-table td { padding: 5px 8px 5px 0; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
.tbv-table th:last-child, .tbv-table td:last-child { padding-right: 0; text-align: right; }
.tbv-table thead th {
  font: 10.5px/1.3 var(--tbv-txt);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tbv-muted);
  font-weight: normal;
  border-bottom: 1px solid var(--tbv-rule-strong);
  padding-bottom: 6px;
}
.tbv-table thead th.tbv-th-s { text-transform: none; font-size: 12px; line-height: 1.1; letter-spacing: 0; }
.tbv-table tbody th { font: 12px/1.4 var(--tbv-txt); font-weight: normal; color: var(--tbv-paper); }
.tbv-table tbody td { font: 12px/1.4 var(--tbv-num); color: var(--tbv-paper); }
.tbv-table tbody td.tbv-ref { color: var(--tbv-muted); }
.tbv-table tbody tr + tr th, .tbv-table tbody tr + tr td { border-top: 1px solid var(--tbv-rule); }
.tbv-table tr.tbv-group th {
  padding-top: 12px;
  font: 10.5px/1.3 var(--tbv-txt);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tbv-muted);
  border-top: 0;
  text-align: left;
}
.tbv-table tr.tbv-group + tr th, .tbv-table tr.tbv-group + tr td { border-top: 1px solid var(--tbv-rule-strong); }
.tbv-sig { white-space: nowrap; }
.tbv-flag {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 5px;
  border-radius: 50%;
  background: var(--tbv-signal);
  vertical-align: 1px;
}
.tbv-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.tbv-sub { font: bold 12px/1.3 var(--tbv-txt); letter-spacing: 0.02em; margin-top: 6px; }
.tbv-field { display: grid; gap: 10px; min-width: 0; }
.tbv-plot { display: grid; grid-template-columns: 156px minmax(0, 1fr); gap: 12px; align-items: center; min-width: 0; }
.tbv-plot svg { display: block; width: 100%; height: auto; }
.tbv-plot figcaption { font: 11px/1.45 var(--tbv-txt); color: var(--tbv-muted); }
.tbv-verdicts { display: grid; gap: 8px; min-width: 0; font: 12px/1.5 var(--tbv-txt); }
.tbv-verdicts b { font-weight: bold; }
.tbv-verdicts .tbv-n { font-family: var(--tbv-num); }
@container (max-width: 270px) { .tbv-plot { grid-template-columns: minmax(0, 1fr); } .tbv-plot svg { max-width: 168px; } }

.tbv-notes { font: 12px/1.5 var(--tbv-txt); color: var(--tbv-muted); }
.tbv-notes summary { cursor: pointer; color: var(--tbv-paper); width: fit-content; padding: 2px 0; }
.tbv-notes summary:focus-visible { outline: 2px solid var(--tbv-paper); outline-offset: 2px; }
.tbv-notes ul { display: grid; gap: 5px; margin-top: 6px; }
.tbv-notes li b { color: var(--tbv-paper); font-weight: normal; }

.tbv-export { display: grid; gap: 8px; padding-top: 14px; border-top: 1px solid var(--tbv-rule-strong); }
.tbv-copybox {
  width: 100%;
  min-height: 140px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--tbv-rule-strong);
  border-radius: 2px;
  color: var(--tbv-paper);
  font: 11px/1.45 var(--tbv-num);
  resize: vertical;
}
.tbv-copybox:focus-visible { outline: 2px solid var(--tbv-paper); outline-offset: 2px; }
.tbv-how { font: 12px/1.5 var(--tbv-txt); color: var(--tbv-muted); max-width: 60ch; }

@media (prefers-reduced-motion: reduce) {
  .tbv-btn, .tbv-bar > span { transition: none; }
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
