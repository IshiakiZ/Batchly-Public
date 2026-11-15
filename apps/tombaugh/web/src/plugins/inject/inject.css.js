// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Styles for the "Injection test" panel, injected once per document by ensureInjectStyles().
// Everything is scoped under .tbj, so the plugin needs nothing from the host stylesheet.
// Brand: Ink #171715, Paper #F7F2E7, Signal #E53C27 (the measured limit and the "simulated"
// tag only), Stone #77766E (rules, borders, the blind-search curve). Small text uses Paper at
// 68 percent for contrast. Arial for text, Consolas for numbers.

export const INJECT_STYLE_ID = 'tbj-inject-css';

export const INJECT_CSS = `
.tbj {
  --tbj-ink: #171715;
  --tbj-paper: #F7F2E7;
  --tbj-signal: #E53C27;
  --tbj-stone: #77766E;
  --tbj-muted: rgba(247, 242, 231, 0.68);
  --tbj-rule: rgba(247, 242, 231, 0.14);
  --tbj-rule-strong: rgba(247, 242, 231, 0.3);
  --tbj-raised: rgba(247, 242, 231, 0.05);
  --tbj-num: Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace;
  --tbj-txt: -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif;
  display: grid;
  gap: 16px;
  min-width: 0;
  color: var(--tbj-paper);
  font: 13px/1.5 var(--tbj-txt);
  -webkit-text-size-adjust: 100%;
}
.tbj *, .tbj *::before, .tbj *::after { box-sizing: border-box; }
.tbj p, .tbj h3, .tbj fieldset, .tbj legend { margin: 0; padding: 0; }
.tbj fieldset { border: 0; min-width: 0; }
.tbj [hidden] { display: none !important; }
.tbj-num { font-family: var(--tbj-num); font-variant-numeric: tabular-nums; }

.tbj-lede { color: var(--tbj-paper); }
.tbj-muted { color: var(--tbj-muted); }
.tbj-small { font-size: 12px; line-height: 1.45; color: var(--tbj-muted); }

.tbj-group { display: grid; gap: 10px; padding-top: 14px; border-top: 1px solid var(--tbj-rule); }
.tbj-label {
  display: block;
  font: 11px/1.3 var(--tbj-txt);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tbj-muted);
}

.tbj-field { display: grid; gap: 4px; min-width: 0; }
.tbj-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-width: 0; }
.tbj-row label, .tbj-row .tbj-name { color: var(--tbj-paper); }
.tbj-value { font-family: var(--tbj-num); font-variant-numeric: tabular-nums; white-space: nowrap; }

.tbj select {
  width: 100%;
  height: 32px;
  padding: 0 8px;
  font: 13px/1 var(--tbj-txt);
  color: var(--tbj-paper);
  background: var(--tbj-ink);
  border: 1px solid var(--tbj-rule-strong);
  border-radius: 2px;
  cursor: pointer;
}
.tbj select:hover { border-color: var(--tbj-paper); }
.tbj select option { background: var(--tbj-ink); color: var(--tbj-paper); }

.tbj input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 22px;
  margin: 0;
  background: transparent;
  cursor: pointer;
}
.tbj input[type="range"]::-webkit-slider-runnable-track { height: 2px; background: var(--tbj-rule-strong); }
.tbj input[type="range"]::-moz-range-track { height: 2px; background: var(--tbj-rule-strong); }
.tbj input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px; height: 18px; margin-top: -8px;
  background: var(--tbj-paper); border: 0; border-radius: 1px;
}
.tbj input[type="range"]::-moz-range-thumb {
  width: 12px; height: 18px; background: var(--tbj-paper); border: 0; border-radius: 1px;
}
.tbj input[type="range"]:disabled { opacity: 0.4; cursor: not-allowed; }

.tbj :focus-visible { outline: 2px solid var(--tbj-paper); outline-offset: 2px; border-radius: 2px; }

.tbj-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid var(--tbj-rule-strong); border-radius: 2px; }
.tbj-seg label {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  min-height: 30px; padding: 4px 8px;
  text-align: center; font-size: 12px; line-height: 1.2; color: var(--tbj-muted);
  cursor: pointer;
}
.tbj-seg label + label { border-left: 1px solid var(--tbj-rule-strong); }
.tbj-seg input { position: absolute; opacity: 0; pointer-events: none; }
.tbj-seg label:has(input:checked) { background: var(--tbj-paper); color: var(--tbj-ink); font-weight: bold; }
.tbj-seg label:has(input:focus-visible) { outline: 2px solid var(--tbj-paper); outline-offset: 2px; }

.tbj-check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.tbj-check input { accent-color: var(--tbj-paper); margin: 0; width: 14px; height: 14px; }

.tbj-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tbj-btn {
  appearance: none;
  height: 32px; padding: 0 14px;
  font: 13px/1 var(--tbj-txt);
  color: var(--tbj-paper);
  background: transparent;
  border: 1px solid var(--tbj-rule-strong);
  border-radius: 2px;
  cursor: pointer;
  white-space: nowrap;
}
.tbj-btn:hover { border-color: var(--tbj-paper); background: rgba(247, 242, 231, 0.07); }
.tbj-btn-solid { background: var(--tbj-paper); color: var(--tbj-ink); border-color: var(--tbj-paper); font-weight: bold; }
.tbj-btn-solid:hover { background: #fff; border-color: #fff; }
.tbj-btn[disabled] { color: var(--tbj-stone); border-color: var(--tbj-rule); background: transparent; cursor: not-allowed; font-weight: normal; }

.tbj-progress { display: grid; gap: 4px; }
.tbj-bar { height: 3px; background: var(--tbj-rule); overflow: hidden; }
.tbj-bar > span { display: block; height: 100%; width: 0; background: var(--tbj-paper); transition: width 160ms linear; }

.tbj-result {
  display: grid; gap: 8px;
  padding: 12px;
  background: var(--tbj-raised);
  border: 1px solid var(--tbj-rule);
  border-radius: 2px;
}
.tbj-tag {
  justify-self: start;
  padding: 2px 6px;
  font: bold 10px/1.4 var(--tbj-txt);
  letter-spacing: 0.1em;
  color: var(--tbj-signal);
  border: 1px solid var(--tbj-signal);
  border-radius: 2px;
}
.tbj-headline { font-size: 14px; line-height: 1.45; }
.tbj-headline b, .tbj-result b { font-family: var(--tbj-num); font-weight: normal; font-variant-numeric: tabular-nums; }

.tbj-chart { display: block; width: 100%; height: auto; }
.tbj-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; line-height: 1.4; color: var(--tbj-muted); }
.tbj-legend span { display: inline-flex; align-items: center; gap: 6px; }
.tbj-legend i { display: inline-block; width: 16px; height: 0; border-top: 2px solid var(--tbj-paper); }
.tbj-legend i.tbj-dash { border-top: 2px dashed var(--tbj-stone); }
.tbj-legend i.tbj-lim { border-top: 2px solid var(--tbj-signal); }

.tbj-foot { padding-top: 12px; border-top: 1px solid var(--tbj-rule); }

@media (prefers-reduced-motion: reduce) {
  .tbj-bar > span { transition: none; }
}
`;

/** Add the stylesheet to the document once. Safe to call repeatedly, and outside a browser. */
export function ensureInjectStyles(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.head) return;
  if (d.getElementById(INJECT_STYLE_ID)) return;
  const style = d.createElement('style');
  style.id = INJECT_STYLE_ID;
  style.textContent = INJECT_CSS;
  d.head.append(style);
}
