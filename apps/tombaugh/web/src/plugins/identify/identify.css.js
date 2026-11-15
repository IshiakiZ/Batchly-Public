// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Styles for the "What is this?" panel, injected once per document by ensureIdentifyStyles().
// Everything is scoped under .tbi, so the plugin needs nothing from the host stylesheet.
// Brand: Ink #171715, Paper #F7F2E7, Signal #E53C27 (one accent per hint list, no more),
// Stone #77766E (rules and borders only; small text uses Paper at 68 percent, which is 7:1 on
// Ink where Stone is 3.9:1). Arial for text, Consolas for numbers.

export const IDENTIFY_STYLE_ID = 'tbi-identify-css';

export const IDENTIFY_CSS = `
.tbi {
  --tbi-ink: #171715;
  --tbi-paper: #F7F2E7;
  --tbi-signal: #E53C27;
  --tbi-stone: #77766E;
  --tbi-muted: rgba(247, 242, 231, 0.68);
  --tbi-rule: rgba(247, 242, 231, 0.14);
  --tbi-raised: rgba(247, 242, 231, 0.05);
  --tbi-num: Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace;
  --tbi-txt: Arial, Helvetica, sans-serif;
  display: grid;
  gap: 18px;
  min-width: 0;
  color: var(--tbi-paper);
  font: 13px/1.5 var(--tbi-txt);
  -webkit-text-size-adjust: 100%;
}
.tbi *, .tbi *::before, .tbi *::after { box-sizing: border-box; }
.tbi :where(p, ul, li, h3, h4) { margin: 0; padding: 0; }
.tbi :where(ul) { list-style: none; }
.tbi[hidden], .tbi [hidden] { display: none !important; }

.tbi-where { display: grid; gap: 2px; }
.tbi-label {
  font: 11px/1.3 var(--tbi-txt);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tbi-muted);
}
.tbi-coord { font: 13px/1.4 var(--tbi-num); color: var(--tbi-paper); overflow-wrap: anywhere; }
.tbi-idle { color: var(--tbi-muted); max-width: 46ch; }

.tbi-sec { display: grid; gap: 10px; min-width: 0; }
.tbi-sec + .tbi-sec { padding-top: 16px; border-top: 1px solid var(--tbi-rule); }
.tbi-sec-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; }
.tbi-h { font: bold 13px/1.35 var(--tbi-txt); color: var(--tbi-paper); letter-spacing: 0.01em; }
.tbi-src { font: 11px/1.35 var(--tbi-txt); color: var(--tbi-muted); }

.tbi-state { color: var(--tbi-muted); }
.tbi-state b { color: var(--tbi-paper); font-weight: normal; }
.tbi-busy { display: inline-flex; align-items: baseline; gap: 6px; }
.tbi-dots { display: inline-flex; gap: 3px; transform: translateY(-1px); }
.tbi-dots i { width: 4px; height: 4px; border-radius: 50%; background: var(--tbi-paper); opacity: 0.25; animation: tbi-pulse 1.2s ease-in-out infinite; }
.tbi-dots i:nth-child(2) { animation-delay: 0.2s; }
.tbi-dots i:nth-child(3) { animation-delay: 0.4s; }
@keyframes tbi-pulse { 0%, 100% { opacity: 0.25; } 40% { opacity: 1; } }

.tbi-error { display: grid; gap: 8px; justify-items: start; }
.tbi-error p { color: var(--tbi-paper); }
.tbi-error small { font-size: 12px; color: var(--tbi-muted); overflow-wrap: anywhere; }
.tbi-btn {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid rgba(119, 118, 110, 0.9);
  border-radius: 3px;
  background: transparent;
  color: var(--tbi-paper);
  font: 12px/1 var(--tbi-txt);
  letter-spacing: 0.02em;
  cursor: pointer;
}
.tbi-btn:hover { border-color: var(--tbi-paper); background: var(--tbi-raised); }
.tbi-btn:focus-visible, .tbi a:focus-visible { outline: 2px solid var(--tbi-paper); outline-offset: 2px; border-radius: 2px; }

.tbi-list { display: grid; gap: 0; }
.tbi-obj { display: grid; gap: 2px; padding: 9px 0; border-top: 1px solid var(--tbi-rule); min-width: 0; }
.tbi-obj:first-child { border-top: 0; padding-top: 0; }
.tbi-obj:last-child { padding-bottom: 0; }
.tbi-obj-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; }
.tbi-name { font: bold 13px/1.4 var(--tbi-txt); min-width: 0; overflow-wrap: anywhere; }
.tbi a { color: var(--tbi-paper); text-decoration: underline; text-decoration-color: var(--tbi-stone); text-underline-offset: 3px; text-decoration-thickness: 1px; }
.tbi a:hover { text-decoration-color: var(--tbi-paper); }
.tbi-ext { display: inline-block; margin-left: 4px; font: 11px/1 var(--tbi-txt); color: var(--tbi-muted); text-decoration: none; }
.tbi-sep { flex: none; font: 12px/1.4 var(--tbi-num); color: var(--tbi-muted); white-space: nowrap; }
.tbi-type { color: var(--tbi-paper); }
.tbi-type::first-letter { text-transform: uppercase; }
.tbi-facts { display: flex; flex-wrap: wrap; gap: 0 14px; font-size: 12px; color: var(--tbi-muted); }
.tbi-facts span { white-space: nowrap; }
.tbi-facts b, .tbi-num { font: 12px/1.5 var(--tbi-num); font-weight: normal; color: var(--tbi-paper); }
.tbi-aka { font-size: 11px; line-height: 1.45; color: var(--tbi-muted); overflow-wrap: anywhere; }
.tbi-more { font-size: 12px; color: var(--tbi-muted); padding-top: 8px; }

.tbi-gaia { display: grid; gap: 4px; }
.tbi-gaia p { color: var(--tbi-muted); font-size: 12px; }
.tbi-gaia p b { color: var(--tbi-paper); font-weight: normal; }
.tbi-gaia .tbi-name { font-weight: normal; font-family: var(--tbi-num); }

.tbi-hintbox { display: grid; gap: 14px; }
.tbi-hints { display: grid; gap: 12px; }
.tbi-hint { display: grid; gap: 3px; padding: 1px 0 1px 12px; border-left: 2px solid var(--tbi-stone); min-width: 0; }
.tbi-hint[data-flag="1"] { border-left-color: var(--tbi-signal); }
.tbi-hint-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.tbi-hint h4 { font: bold 13px/1.4 var(--tbi-txt); color: var(--tbi-paper); }
.tbi-conf {
  flex: none;
  padding: 1px 6px 0;
  border: 1px solid var(--tbi-stone);
  border-radius: 9px;
  font: 10px/14px var(--tbi-txt);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--tbi-muted);
  white-space: nowrap;
}
.tbi-conf[data-level="likely"] { border-color: rgba(247, 242, 231, 0.6); color: var(--tbi-paper); }
.tbi-conf[data-level="strong"] { border-color: var(--tbi-paper); background: var(--tbi-paper); color: var(--tbi-ink); }
.tbi-hint p { font-size: 12px; line-height: 1.5; color: var(--tbi-muted); max-width: 62ch; }
.tbi-note {
  font-size: 12px;
  line-height: 1.5;
  color: var(--tbi-muted);
  padding: 8px 10px;
  background: var(--tbi-raised);
  border-radius: 3px;
}
.tbi-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (prefers-reduced-motion: reduce) {
  .tbi-dots i { animation: none; opacity: 0.6; }
}
`;

/** Adds the stylesheet to the document once. Safe to call repeatedly and without a document. */
export function ensureIdentifyStyles(doc = globalThis.document) {
  if (!doc || !doc.head || doc.getElementById(IDENTIFY_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = IDENTIFY_STYLE_ID;
  style.textContent = IDENTIFY_CSS;
  doc.head.append(style);
}
