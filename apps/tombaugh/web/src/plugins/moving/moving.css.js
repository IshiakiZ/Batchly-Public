// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Styles of the "Solar system" panel, injected once. Every class starts with `tbm-`.
// Colours fall back to the brand values when the shell's custom properties are absent, so the
// panel looks the same in the standalone demo.

export const MOVING_STYLE_ID = 'tbm-moving-css';

export const MOVING_CSS = `
.tbm {
  --tbm-ink: var(--ink, #171715);
  --tbm-paper: var(--paper, #F7F2E7);
  --tbm-signal: var(--signal, #E53C27);
  --tbm-stone: var(--stone, #77766E);
  --tbm-muted: var(--muted, #ADA99E);
  --tbm-rule: var(--rule, rgba(247, 242, 231, 0.14));
  --tbm-rule-strong: var(--rule-strong, rgba(247, 242, 231, 0.3));
  --tbm-raised: var(--ink-raised, #1E1E1B);
  --tbm-sunken: var(--ink-sunken, #11110F);
  --tbm-num: var(--font-num, Consolas, "SFMono-Regular", Menlo, "DejaVu Sans Mono", monospace);
  --tbm-text: var(--font-text, Arial, Helvetica, sans-serif);
  color: var(--tbm-paper);
  font-family: var(--tbm-text);
  font-size: 13px;
  line-height: 1.45;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  container-type: inline-size;
}
.tbm *, .tbm *::before, .tbm *::after { box-sizing: border-box; }
.tbm [hidden] { display: none !important; }
.tbm p { margin: 0; }
.tbm-lede { color: var(--tbm-muted); max-width: 62ch; }
.tbm-num { font-family: var(--tbm-num); font-variant-numeric: tabular-nums; }

.tbm-search { display: flex; gap: 6px; }
.tbm-label { display: block; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tbm-muted); margin-bottom: 5px; }
.tbm-input {
  flex: 1 1 auto; min-width: 0; height: 32px; padding: 0 9px;
  background: var(--tbm-sunken); color: var(--tbm-paper);
  border: 1px solid var(--tbm-rule-strong); border-radius: 3px;
  font: inherit;
}
.tbm-input::placeholder { color: var(--tbm-stone); }
.tbm-input:focus-visible, .tbm-btn:focus-visible, .tbm-chip:focus-visible, .tbm-select:focus-visible, .tbm-check input:focus-visible {
  outline: 2px solid var(--tbm-paper); outline-offset: 2px;
}
.tbm-btn {
  height: 32px; padding: 0 12px; border-radius: 3px; cursor: pointer;
  background: transparent; color: var(--tbm-paper);
  border: 1px solid var(--tbm-rule-strong); font: inherit; white-space: nowrap;
}
.tbm-btn:hover { background: rgba(247, 242, 231, 0.07); }
.tbm-btn[disabled] { opacity: 0.45; cursor: default; }
.tbm-btn-primary { background: var(--tbm-paper); color: var(--tbm-ink); border-color: var(--tbm-paper); font-weight: bold; }
.tbm-btn-primary:hover { background: #fff; }
.tbm-btn[aria-pressed="true"] { background: var(--tbm-paper); color: var(--tbm-ink); border-color: var(--tbm-paper); }
.tbm-btn-small { height: 26px; padding: 0 8px; font-size: 12px; }

.tbm-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.tbm-chip {
  height: 26px; padding: 0 9px; border-radius: 13px; cursor: pointer;
  background: transparent; color: var(--tbm-paper);
  border: 1px solid var(--tbm-rule-strong); font: inherit; font-size: 12px; white-space: nowrap;
}
.tbm-chip:hover { background: rgba(247, 242, 231, 0.07); }
.tbm-chip[aria-pressed="true"] { background: var(--tbm-paper); color: var(--tbm-ink); border-color: var(--tbm-paper); }
.tbm-chip-hypo { border-style: dashed; }

.tbm-card { border: 1px solid var(--tbm-rule); border-radius: 4px; background: var(--tbm-raised); padding: 11px 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.tbm-card-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.tbm-name { font-family: var(--font-head, "Arial Black", Arial, sans-serif); font-size: 15px; font-weight: 900; letter-spacing: 0.01em; }
.tbm-kind { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tbm-muted); }
.tbm-kind-hypo { color: var(--tbm-signal); }
.tbm-look { color: var(--tbm-muted); }
.tbm-look b { color: var(--tbm-paper); font-weight: normal; }

.tbm-hypo { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tbm-hypo .tbm-wide { grid-column: 1 / -1; }
.tbm-check { display: flex; align-items: flex-start; gap: 7px; color: var(--tbm-muted); cursor: pointer; }
.tbm-check input { margin: 2px 0 0; accent-color: #F7F2E7; }
.tbm-warning { border-left: 2px solid var(--tbm-signal); padding-left: 9px; }

.tbm-status { min-height: 1.45em; }
.tbm-status-error { color: var(--tbm-paper); border-left: 2px solid var(--tbm-signal); padding-left: 9px; }
.tbm-matches {
  margin: 6px 0 0; padding: 8px; max-height: 150px; overflow: auto;
  background: var(--tbm-sunken); border: 1px solid var(--tbm-rule); border-radius: 3px;
  font-family: var(--tbm-num); font-size: 11px; line-height: 1.35; white-space: pre; color: var(--tbm-muted);
}

.tbm-plan-text { font-size: 14px; }
.tbm-visits { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbm-visits th { text-align: left; font-weight: normal; color: var(--tbm-muted); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; padding: 0 8px 4px 0; }
.tbm-visits td { padding: 3px 8px 3px 0; border-top: 1px solid var(--tbm-rule); vertical-align: top; }
.tbm-visits td:last-child, .tbm-visits th:last-child { padding-right: 0; }
.tbm-visits .tbm-r { text-align: right; }
.tbm-dets { color: var(--tbm-muted); font-family: var(--tbm-num); font-size: 11px; white-space: nowrap; }

.tbm-track { display: block; width: 100%; height: auto; background: var(--tbm-sunken); border: 1px solid var(--tbm-rule); border-radius: 3px; }
.tbm-figcap { color: var(--tbm-muted); font-size: 12px; margin-top: 4px; }

.tbm-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.tbm-progress { height: 4px; background: var(--tbm-sunken); border-radius: 2px; overflow: hidden; border: 1px solid var(--tbm-rule); }
.tbm-progress-bar { height: 100%; width: 0; background: var(--tbm-paper); transition: width 150ms linear; }

.tbm-stack { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.tbm-stage { position: relative; width: 100%; max-width: 340px; aspect-ratio: 1 / 1; background: #000; border: 1px solid var(--tbm-rule-strong); border-radius: 3px; overflow: hidden; }
.tbm-canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; image-rendering: crisp-edges; }
.tbm-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.tbm-nav { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.tbm-select {
  flex: 1 1 150px; min-width: 0; height: 26px; padding: 0 6px; font: inherit; font-size: 12px;
  background: var(--tbm-sunken); color: var(--tbm-paper); border: 1px solid var(--tbm-rule-strong); border-radius: 3px;
}
.tbm-seg { display: inline-flex; }
.tbm-seg .tbm-btn { border-radius: 0; margin-left: -1px; }
.tbm-seg .tbm-btn:first-child { border-radius: 3px 0 0 3px; margin-left: 0; }
.tbm-seg .tbm-btn:last-child { border-radius: 0 3px 3px 0; }
.tbm-caption { font-size: 12px; color: var(--tbm-muted); }
.tbm-caption b { color: var(--tbm-paper); font-weight: normal; }

.tbm-verdict { display: flex; flex-direction: column; gap: 5px; padding: 0; margin: 0; list-style: none; }
.tbm-verdict li { padding-left: 11px; border-left: 2px solid var(--tbm-rule-strong); }
.tbm-verdict li.tbm-v-warn { border-left-color: var(--tbm-signal); }
.tbm-verdict li.tbm-v-ok { border-left-color: var(--tbm-paper); }

.tbm-spectrum { display: block; width: 100%; height: auto; }
.tbm-foot { color: var(--tbm-stone); font-size: 11px; }
.tbm-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }

@container (min-width: 560px) {
  .tbm-stack { grid-template-columns: minmax(0, 340px) minmax(0, 1fr); align-items: start; }
}
@media (prefers-reduced-motion: reduce) {
  .tbm-progress-bar { transition: none; }
}
`;

/** Inject the stylesheet once. Safe to call many times, and without a document. */
export function ensureMovingStyles(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.head || d.getElementById(MOVING_STYLE_ID)) return;
  const style = d.createElement('style');
  style.id = MOVING_STYLE_ID;
  style.textContent = MOVING_CSS;
  d.head.appendChild(style);
}
