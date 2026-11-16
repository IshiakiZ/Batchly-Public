// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Styles for the practice-sky markers (the SIMULATED badge and banner), injected once per
// document by ensureLocalStyles(). Classes are prefixed `tbl-`. Brand colours come from the
// page's custom properties when it defines them (--ink, --paper, --signal, --stone).
//
// The badge text is Paper on Ink (16:1). Signal is used for the frame around it only: Signal on
// Ink is 4.3:1, too low for small text.

export const LOCAL_STYLE_ID = 'tbl-local-css';

export const LOCAL_CSS = `
.tbl-sim {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px 2px 5px;
  border: 1px solid var(--signal, #E53C27);
  border-radius: 2px;
  background: var(--ink, #171715);
  color: var(--paper, #F7F2E7);
  font: bold 11px/1.3 Arial, Helvetica, sans-serif;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
  vertical-align: baseline;
}
.tbl-sim::before {
  content: "";
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  background: var(--signal, #E53C27);
}
.tbl-sim-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 5;
  pointer-events: none;
}
.tbl-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgba(247, 242, 231, 0.18);
  border-left: 3px solid var(--signal, #E53C27);
  border-radius: 2px;
  background: rgba(247, 242, 231, 0.04);
  color: var(--paper, #F7F2E7);
  font: 13px/1.45 Arial, Helvetica, sans-serif;
}
.tbl-banner-text { flex: 1 1 220px; min-width: 0; }
`;

/** Injects the styles once. Safe to call anywhere; does nothing without a document. */
export function ensureLocalStyles(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !doc.head) return false;
  if (doc.getElementById(LOCAL_STYLE_ID)) return true;
  const style = doc.createElement('style');
  style.id = LOCAL_STYLE_ID;
  style.textContent = LOCAL_CSS;
  doc.head.append(style);
  return true;
}

/** A SIMULATED badge element. `overlay: true` positions it in the top-left corner of its (positioned) parent. */
export function simulatedBadge(doc = document, { overlay = false, text = 'Simulated' } = {}) {
  ensureLocalStyles(doc);
  const badge = doc.createElement('span');
  badge.className = overlay ? 'tbl-sim tbl-sim-overlay' : 'tbl-sim';
  badge.textContent = text;
  return badge;
}
