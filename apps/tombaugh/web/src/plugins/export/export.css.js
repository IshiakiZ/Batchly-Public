// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Styles for the export plugin, injected once per document by ensureExportStyles(). Everything
// is scoped under .tbe (the modal content) or .tbe-dialog (the fallback dialog used when the
// shell offers no app.openModal). Colours come from the shell's custom properties when they
// exist (--ink, --paper, --signal, --stone, ...) and fall back to the brand values.

export const EXPORT_STYLE_ID = 'tbe-export-css';

export const EXPORT_CSS = `
.tbe, .tbe-dialog {
  --_ink: var(--ink, #171715);
  --_raised: var(--ink-raised, #1E1E1B);
  --_sunken: var(--ink-sunken, #11110F);
  --_paper: var(--paper, #F7F2E7);
  --_signal: var(--signal, #E53C27);
  --_stone: var(--stone, #77766E);
  --_muted: var(--muted, #ADA99E);
  --_rule: var(--rule, rgba(247, 242, 231, 0.14));
  --_rule-strong: var(--rule-strong, rgba(247, 242, 231, 0.3));
  --_hover: var(--hover, rgba(247, 242, 231, 0.07));
  --_head: var(--font-head, -apple-system, BlinkMacSystemFont, Segoe UI Variable Display, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif);
  --_text: var(--font-text, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif);
  --_num: var(--font-num, Consolas, "SFMono-Regular", Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace);
}
.tbe {
  display: grid;
  gap: 14px;
  min-width: 0;
  color: var(--_paper);
  font: 13px/1.4 var(--_text);
  -webkit-text-size-adjust: 100%;
}
.tbe *, .tbe *::before, .tbe *::after { box-sizing: border-box; }
.tbe [hidden] { display: none !important; }

/* what is being exported */
.tbe-head { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; align-items: center; }
.tbe-thumb {
  width: 64px; height: 64px; display: block; background: var(--_sunken);
  border: 1px solid var(--_rule-strong); image-rendering: pixelated;
}
.tbe-what { font-family: var(--_head); font-weight: 700; font-size: 15px; line-height: 1.2; overflow-wrap: anywhere; }
.tbe-sub { margin-top: 4px; font-family: var(--_num); font-size: 12px; color: var(--_muted); overflow-wrap: anywhere; }

/* sections */
.tbe-sec { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid var(--_rule); min-width: 0; }
.tbe-sec-title {
  margin: 0; display: flex; align-items: baseline; gap: 8px;
  font: bold 11px/1 var(--_text); letter-spacing: 0.08em; text-transform: uppercase; color: var(--_muted);
}
.tbe-count { font: 12px/1 var(--_num); letter-spacing: 0; text-transform: none; color: var(--_paper); }
.tbe-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-width: 0; }
.tbe p { max-width: none; text-align: left; }
.tbe-hint { margin: 0; font-size: 12px; color: var(--_muted); }
.tbe-row > .tbe-hint { flex: 1 1 220px; min-width: 0; }

/* buttons */
.tbe-btn {
  appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 34px; padding: 6px 12px; background: transparent; color: var(--_paper);
  border: 1px solid var(--_rule-strong); border-radius: 2px;
  font: 13px/1.1 var(--_text); cursor: pointer; text-align: left;
  transition: background 150ms, border-color 150ms, color 150ms;
}
.tbe-btn:hover { background: var(--_hover); border-color: var(--_paper); }
.tbe-btn:active { background: rgba(247, 242, 231, 0.12); }
.tbe-btn:focus-visible, .tbe-link-input:focus-visible { outline: 2px solid var(--_paper); outline-offset: 2px; }
.tbe-btn[disabled] { color: var(--_stone); border-color: var(--_rule); cursor: not-allowed; background: transparent; }
.tbe-btn-main { background: var(--_paper); color: var(--_ink); border-color: var(--_paper); font-weight: bold; }
.tbe-btn-main:hover { background: #fff; border-color: #fff; }
.tbe-btn-main[disabled] { background: transparent; font-weight: normal; }
.tbe-fmt { font: 11px/1 var(--_num); letter-spacing: 0.04em; opacity: 0.72; }

/* options: segmented radio groups and a checkbox */
.tbe-opts { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; }
.tbe-seg { display: inline-flex; align-items: center; gap: 8px; margin: 0; padding: 0; border: 0; min-width: 0; }
.tbe-seg legend { float: left; padding: 0; margin-right: 8px; font-size: 12px; color: var(--_muted); line-height: 28px; }
.tbe-seg-items { display: inline-flex; border: 1px solid var(--_rule-strong); border-radius: 2px; }
.tbe-seg label { position: relative; display: block; border-left: 1px solid var(--_rule); cursor: pointer; }
.tbe-seg label:first-child { border-left: 0; }
.tbe-seg input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.tbe-seg span {
  display: block; min-width: 44px; padding: 0 10px; font: 12px/26px var(--_num); text-align: center; color: var(--_muted);
  transition: color 150ms, background 150ms;
}
.tbe-seg label:hover span { color: var(--_paper); background: var(--_hover); }
.tbe-seg input:checked + span { color: var(--_paper); box-shadow: inset 0 -2px 0 var(--_signal); background: var(--_hover); }
.tbe-seg input:focus-visible + span { outline: 2px solid var(--_paper); outline-offset: 1px; }
.tbe-seg input:disabled + span { color: var(--_stone); cursor: not-allowed; }
.tbe-check { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--_paper); cursor: pointer; min-height: 28px; }
.tbe-check input { width: 15px; height: 15px; margin: 0; accent-color: var(--_paper); cursor: pointer; }
.tbe-check input:focus-visible { outline: 2px solid var(--_paper); outline-offset: 2px; }

/* progress */
.tbe-progress { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.tbe-bar {
  appearance: none; -webkit-appearance: none; display: block; width: 100%; height: 6px; border: 0; border-radius: 0;
  background: var(--_rule); color: var(--_signal); overflow: hidden;
}
.tbe-bar::-webkit-progress-bar { background: var(--_rule); }
.tbe-bar::-webkit-progress-value { background: var(--_signal); transition: width 120ms linear; }
.tbe-bar::-moz-progress-bar { background: var(--_signal); }
.tbe-btn-small { min-height: 26px; padding: 3px 10px; font-size: 12px; }

/* link */
.tbe-link { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.tbe-link-input {
  min-width: 0; height: 34px; padding: 0 10px; background: var(--_sunken); color: var(--_paper);
  border: 1px solid var(--_rule-strong); border-radius: 2px; font: 12px/1 var(--_num);
}

/* status line */
.tbe-status { margin: 0; min-height: 18px; font-size: 12px; color: var(--_muted); overflow-wrap: anywhere; }
.tbe-status.is-ok { color: var(--_paper); }
.tbe-status.is-error { color: var(--_paper); }
.tbe-status.is-error::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 7px; background: var(--_signal); }
.tbe-status a { color: var(--_paper); text-decoration: underline; text-decoration-color: var(--_stone); text-underline-offset: 3px; }
.tbe-status a:hover { text-decoration-color: var(--_paper); }
.tbe-status a:focus-visible { outline: 2px solid var(--_paper); outline-offset: 2px; }

/* fallback dialog (only when the shell has no openModal) */
.tbe-dialog {
  width: min(600px, calc(100vw - 24px)); max-height: min(88vh, 760px); padding: 0;
  background: var(--_raised); color: var(--_paper); border: 1px solid var(--_rule-strong); border-radius: 2px; overflow: hidden;
}
.tbe-dialog[open] { display: flex; flex-direction: column; }
.tbe-dialog:not(dialog) { position: fixed; z-index: 1000; left: 50%; top: 50%; transform: translate(-50%, -50%); }
.tbe-dialog::backdrop { background: rgba(10, 10, 9, 0.72); }
.tbe-dialog-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px;
  border-bottom: 1px solid var(--_rule);
}
.tbe-dialog-title { margin: 0; font: 900 15px/1.2 var(--_head); letter-spacing: 0.04em; color: var(--_paper); }
.tbe-dialog-body { padding: 16px 18px 18px; overflow-y: auto; }
.tbe-dialog .tbe-btn-quiet { border-color: transparent; color: var(--_muted); font: 13px/1.1 var(--_text); }
.tbe-dialog .tbe-btn-quiet:hover { color: var(--_paper); border-color: var(--_rule-strong); }

@media (max-width: 480px) {
  .tbe-row .tbe-btn { flex: 1 1 100%; justify-content: space-between; }
  .tbe-opts { gap: 8px 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .tbe *, .tbe-dialog * { transition: none !important; animation: none !important; }
}
`;

/** Add the stylesheet to a document once. Safe to call repeatedly; returns the <style> or null. */
export function ensureExportStyles(doc = globalThis.document) {
  if (!doc || !doc.head) return null;
  let el = doc.getElementById(EXPORT_STYLE_ID);
  if (el) return el;
  el = doc.createElement('style');
  el.id = EXPORT_STYLE_ID;
  el.textContent = EXPORT_CSS;
  doc.head.append(el);
  return el;
}
