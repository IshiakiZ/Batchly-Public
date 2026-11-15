// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// story.css.js - styles for the story plugin, injected once. Everything is prefixed `tbs-`.
// Sizes are multiples of --tbs-u, a unit that captions.js sets from the frame width (1 % of it in
// recording mode), so the captions keep their proportions at any recording size.
// Brand: Ink #171715, Paper #F7F2E7, Signal #E53C27, Stone #77766E.

const STYLE_ID = 'tbs-story-style';

export const CSS = `
.tbs-layer {
  position: fixed; inset: 0; z-index: 2147483000; margin: 0; padding: 0; border: 0;
  width: 100%; height: 100%; max-width: none; max-height: none; overflow: hidden;
  background: transparent; color: #F7F2E7; pointer-events: none;
  font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.3; text-align: left;
  --tbs-u: 8px; --tbs-fx: 0px; --tbs-fy: 0px; --tbs-fw: 100vw; --tbs-fh: 100vh;
}
.tbs-layer *, .tbs-layer *::before, .tbs-layer *::after { box-sizing: border-box; }
:where(.tbs-layer) :where(p) { margin: 0; padding: 0; }
.tbs-layer [hidden] { display: none !important; }
.tbs-frame { position: absolute; left: var(--tbs-fx); top: var(--tbs-fy); width: var(--tbs-fw); height: var(--tbs-fh); }

/* ---- lower third ---- */
.tbs-band {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: calc(var(--tbs-u) * 1.5) calc(var(--tbs-u) * 5) calc(var(--tbs-u) * 1.8);
  background: rgba(23, 23, 21, 0.9);
  opacity: 0; transition: opacity 150ms ease;
}
.tbs-band.is-on { opacity: 1; }
.tbs-band__in { display: flex; align-items: stretch; gap: calc(var(--tbs-u) * 1.5); }
.tbs-rule { flex: 0 0 auto; width: max(3px, calc(var(--tbs-u) * 0.4)); background: #E53C27; }
.tbs-words { min-width: 0; }
.tbs-words.is-in { animation: tbs-in 150ms ease-out both; }
.tbs-title {
  font-family: "Arial Black", "Arial Bold", Arial, Helvetica, sans-serif; font-weight: 900;
  font-size: max(11px, calc(var(--tbs-u) * 1.7)); line-height: 1.15; letter-spacing: 0.1em; text-transform: uppercase;
  margin-bottom: calc(var(--tbs-u) * 0.4);
}
.tbs-title:empty { display: none; }
.tbs-text { font-size: max(15px, calc(var(--tbs-u) * 2.8)); line-height: 1.2; max-width: 36em; text-wrap: balance; }
.tbs-hair { position: absolute; left: 0; right: 0; bottom: 0; height: max(2px, calc(var(--tbs-u) * 0.24)); background: rgba(247, 242, 231, 0.14); }
.tbs-hair i { display: block; width: 100%; height: 100%; transform-origin: 0 50%; transform: scaleX(0); background: rgba(247, 242, 231, 0.72); }
.tbs-hint {
  position: absolute; right: calc(var(--tbs-u) * 5); bottom: calc(var(--tbs-u) * 1.8);
  font-size: max(12px, calc(var(--tbs-u) * 1.5)); color: rgba(247, 242, 231, 0.86);
}
.tbs-kbd {
  display: inline-block; min-width: 1.7em; padding: 0.1em 0.45em; margin: 0 0.15em; border: 1px solid rgba(247, 242, 231, 0.55);
  border-radius: 2px; font-family: Consolas, "Lucida Console", Menlo, monospace; font-size: 0.92em; text-align: center;
}
.tbs-url {
  position: absolute; left: calc(var(--tbs-u) * 5); right: calc(var(--tbs-u) * 5); bottom: calc(var(--tbs-u) * 10.6);
  display: flex; pointer-events: none;
}
.tbs-layer.is-recording .tbs-url { bottom: auto; top: calc(var(--tbs-u) * 0.75); left: calc(var(--tbs-u) * 17); right: calc(var(--tbs-u) * 2); }
.tbs-url span {
  max-width: 100%; padding: calc(var(--tbs-u) * 0.45) calc(var(--tbs-u) * 1.2); background: #171715;
  border: max(2px, calc(var(--tbs-u) * 0.18)) solid #E53C27; border-radius: 2px;
  font-family: Consolas, "Lucida Console", Menlo, monospace; font-size: max(12px, calc(var(--tbs-u) * 1.9)); line-height: 1.25;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; animation: tbs-in 150ms ease-out both;
}

/* ---- full-frame cards ---- */
.tbs-card { position: absolute; inset: 0; background: #171715; opacity: 0; transition: opacity 150ms ease; }
.tbs-card.is-on { opacity: 1; }
.tbs-card__in {
  position: absolute; left: var(--tbs-fx); top: var(--tbs-fy); width: var(--tbs-fw); height: var(--tbs-fh);
  display: flex; flex-direction: column; justify-content: center; padding: 0 calc(var(--tbs-u) * 9);
}
.tbs-card__word {
  font-family: "Arial Black", "Arial Bold", Arial, Helvetica, sans-serif; font-weight: 900;
  font-size: calc(var(--tbs-u) * 9); line-height: 1; letter-spacing: 0.1em; margin-left: -0.04em;
}
.tbs-card__rule { width: calc(var(--tbs-u) * 9); height: max(3px, calc(var(--tbs-u) * 0.5)); margin: calc(var(--tbs-u) * 2.6) 0 calc(var(--tbs-u) * 2.2); background: #E53C27; }
.tbs-card__tag { font-size: calc(var(--tbs-u) * 3.1); line-height: 1.2; }
.tbs-card__url {
  margin-top: calc(var(--tbs-u) * 3.4); font-family: Consolas, "Lucida Console", Menlo, monospace; font-weight: bold;
  font-size: calc(var(--tbs-u) * 3); line-height: 1.2; overflow-wrap: anywhere;
}
.tbs-card__lines { margin-top: calc(var(--tbs-u) * 2.2); display: grid; gap: calc(var(--tbs-u) * 0.6); }
.tbs-card__line { font-size: calc(var(--tbs-u) * 2.2); line-height: 1.25; color: rgba(247, 242, 231, 0.88); }
.tbs-card__line.is-team {
  font-family: "Arial Black", "Arial Bold", Arial, Helvetica, sans-serif; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase;
  font-size: calc(var(--tbs-u) * 1.9); color: #F7F2E7;
}
.tbs-card.is-end .tbs-card__word { font-size: calc(var(--tbs-u) * 6); }
.tbs-card.is-end .tbs-card__tag { font-size: calc(var(--tbs-u) * 2.4); margin-top: calc(var(--tbs-u) * 1.2); color: rgba(247, 242, 231, 0.88); }
.tbs-card.is-end .tbs-card__rule { margin: calc(var(--tbs-u) * 2.6) 0 0; }
.tbs-card.is-end .tbs-card__url { margin-top: calc(var(--tbs-u) * 2.6); }

/* ---- small furniture ---- */
.tbs-mark {
  position: absolute; left: calc(var(--tbs-u) * 2); top: calc(var(--tbs-u) * 1.6);
  font-family: "Arial Black", "Arial Bold", Arial, Helvetica, sans-serif; font-weight: 900;
  font-size: max(11px, calc(var(--tbs-u) * 1.7)); letter-spacing: 0.14em; line-height: 1;
}
.tbs-tag {
  position: absolute; right: calc(var(--tbs-u) * 5); top: calc(var(--tbs-u) * 1.5); padding: 0.3em 0.7em;
  border: 1px solid rgba(247, 242, 231, 0.5); border-radius: 2px; color: rgba(247, 242, 231, 0.9);
  font-family: Consolas, "Lucida Console", Menlo, monospace; font-size: max(11px, calc(var(--tbs-u) * 1.4)); letter-spacing: 0.06em; text-transform: uppercase;
}
.tbs-status {
  position: absolute; left: 50%; bottom: calc(var(--tbs-u) * 3); transform: translateX(-50%);
  min-width: min(340px, 90%); max-width: 90%; padding: 10px 16px 11px; background: rgba(23, 23, 21, 0.94);
  border: 1px solid rgba(247, 242, 231, 0.28); border-radius: 2px; font-size: 13px; line-height: 1.35; text-align: center;
}
.tbs-status__sub { color: rgba(247, 242, 231, 0.7); font-family: Consolas, "Lucida Console", Menlo, monospace; font-size: 11px; margin-top: 2px; min-height: 1.3em; }
.tbs-status__bar { height: 2px; margin-top: 8px; background: rgba(247, 242, 231, 0.16); }
.tbs-status__bar i { display: block; height: 100%; width: 0; background: rgba(247, 242, 231, 0.8); transition: width 200ms linear; }
.tbs-status.is-ready { font-size: max(15px, calc(var(--tbs-u) * 2)); padding: 14px 22px; border-color: #E53C27; }
.tbs-status.is-ready .tbs-status__bar { display: none; }
.tbs-controls {
  position: absolute; right: calc(var(--tbs-fx) + 6px); top: calc(var(--tbs-fy) + 6px);
  display: flex; align-items: center; gap: 10px; pointer-events: auto;
  /* opaque, and tall enough to cover the header buttons it sits on */
  padding: 8px 8px 8px 14px; background: #171715; border-radius: 2px;
}
.tbs-keys { padding: 5px 0; border-radius: 2px; font-size: 12px; color: rgba(247, 242, 231, 0.86); white-space: nowrap; }
.tbs-stop {
  appearance: none; height: 32px; padding: 0 14px; background: #171715; color: #F7F2E7; border: 1px solid rgba(247, 242, 231, 0.6);
  border-radius: 2px; font: inherit; font-size: 13px; line-height: 1; cursor: pointer; white-space: nowrap;
}
.tbs-stop:hover { border-color: #F7F2E7; }
.tbs-stop:focus-visible { outline: 2px solid #E53C27; outline-offset: 2px; }
.tbs-shield { position: absolute; inset: 0; pointer-events: auto; }
.tbs-guide { position: absolute; inset: 0; border: 1px dashed rgba(247, 242, 231, 0.6); }
.tbs-guide::after { content: ""; position: absolute; inset: 5%; border: 1px dashed rgba(229, 60, 39, 0.75); }
.tbs-guide::before {
  content: "16:9 frame, 5% safe area"; position: absolute; left: 6px; top: 4px; padding: 1px 5px; background: rgba(23, 23, 21, 0.8);
  font-family: Consolas, "Lucida Console", Menlo, monospace; font-size: 11px; color: rgba(247, 242, 231, 0.9);
}
.tbs-sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }

/* ---- recording mode: the layer ---- */
.tbs-layer.is-recording .tbs-controls { display: none; }
.tbs-layer.is-recording.show-controls .tbs-controls { display: flex; }
.tbs-layer:not(.is-recording) .tbs-mark { display: none; }
.tbs-layer.is-recording .tbs-shield { cursor: none; }
.tbs-layer.is-recording.show-controls .tbs-shield { cursor: default; }

/* ---- spotlight ---- */
.tbs-spot { position: absolute; left: 0; top: 0; width: 0; height: 0; opacity: 0; pointer-events: none; will-change: transform, width, height, opacity; }
.tbs-spot__ring {
  position: absolute; inset: 0; border: max(2px, calc(var(--tbs-u) * 0.2)) solid #E53C27; border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(23, 23, 21, 0.75), inset 0 0 0 1px rgba(23, 23, 21, 0.75);
}
.tbs-spot.is-round .tbs-spot__ring { border-radius: 50%; }
.tbs-spot__label {
  position: absolute; left: 0; bottom: calc(100% + 6px); padding: 0.28em 0.6em; background: #171715; color: #F7F2E7;
  border-left: max(2px, calc(var(--tbs-u) * 0.2)) solid #E53C27;
  font-family: Arial, Helvetica, sans-serif; font-weight: bold; font-size: max(12px, calc(var(--tbs-u) * 1.5)); line-height: 1.2; white-space: nowrap;
}
.tbs-spot.is-round .tbs-spot__label { left: calc(100% + 8px); bottom: auto; top: 50%; transform: translateY(-50%); }
.tbs-spot.is-round.is-left .tbs-spot__label { left: auto; right: calc(100% + 8px); border-left: 0; border-right: max(2px, calc(var(--tbs-u) * 0.2)) solid #E53C27; }
.tbs-spot.is-below .tbs-spot__label { bottom: auto; top: calc(100% + 6px); }
.tbs-spot.is-inside .tbs-spot__label { bottom: auto; top: 6px; left: 6px; }
.tbs-spot__label:empty { display: none; }

/* ---- launcher panel ---- */
.tbs-launch { display: grid; gap: 14px; }
.tbs-launch__intro { font-size: 13px; line-height: 1.45; color: inherit; opacity: 0.86; }
.tbs-launch__list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; border-top: 1px solid rgba(247, 242, 231, 0.16); }
.tbs-launch__item { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(247, 242, 231, 0.16); }
.tbs-launch__name { font-weight: bold; font-size: 14px; }
.tbs-launch__time { font-family: Consolas, "Lucida Console", Menlo, monospace; font-size: 11px; opacity: 0.7; margin-left: 8px; font-weight: normal; }
.tbs-launch__desc { grid-column: 1; font-size: 12px; line-height: 1.4; opacity: 0.8; }
.tbs-launch__btns { grid-column: 2; grid-row: 1 / span 2; display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.tbs-launch__btn {
  appearance: none; height: 30px; padding: 0 12px; background: transparent; color: inherit; border: 1px solid rgba(247, 242, 231, 0.45);
  border-radius: 2px; font: inherit; font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap;
}
.tbs-launch__btn:hover { border-color: #F7F2E7; }
.tbs-launch__btn:focus-visible { outline: 2px solid #E53C27; outline-offset: 2px; }
.tbs-launch__keys { font-size: 12px; line-height: 1.5; opacity: 0.8; }

/* ---- recording mode: the page. Only the viewer, the player, the open side panel and the
        captions stay. Selectors are the shell's; where one is missing the rule does nothing. ---- */
html.tbs-recording .topbar, html.tbs-recording .modebar, html.tbs-recording .modeopts, html.tbs-recording .controls,
html.tbs-recording .toolrow, html.tbs-recording .tabs, html.tbs-recording .cite, html.tbs-recording .toasts,
html.tbs-recording .skip-link, html.tbs-recording .sheet-backdrop, html.tbs-recording .embed-credit,
html.tbs-recording [data-story-hide] { display: none !important; }
html.tbs-recording, html.tbs-recording body { overflow: hidden; }
html.tbs-recording {
  --viewer-size: clamp(200px, min(calc(100vh - var(--tbs-band-h, 120px) - 150px), calc(100vw - 420px)), 1200px);
}
html.tbs-recording .console { height: calc(100vh - var(--tbs-band-h, 120px)); min-height: 0; }
html.tbs-recording .stage { padding-top: calc(var(--tbs-top, 40px) + 12px); }
html.tbs-recording .side { padding-top: var(--tbs-top, 40px); }
html.tbs-recording.tbs-running, html.tbs-recording.tbs-running * { cursor: none !important; }
html.tbs-recording.tbs-running :focus-visible { outline-color: transparent !important; }
/* A modal dialog (the sky map) sits above the band instead of behind it. */
html.tbs-recording dialog[open] {
  margin-top: calc(var(--tbs-top, 40px) + 8px); margin-bottom: auto;
  max-height: calc(100vh - var(--tbs-band-h, 120px) - var(--tbs-top, 40px) - 20px);
}

@keyframes tbs-in { from { opacity: 0; transform: translateY(calc(var(--tbs-u) * 0.6)); } to { opacity: 1; transform: none; } }
.tbs-layer.is-still *, .tbs-layer.is-still *::before, .tbs-layer.is-still *::after { animation: none !important; transition: none !important; }
@media (prefers-reduced-motion: reduce) {
  .tbs-layer *, .tbs-layer *::before, .tbs-layer *::after { animation: none !important; transition: none !important; }
}
`;

/** Add the stylesheet to a document once. Safe to call many times. */
export function injectStyles(doc = globalThis.document) {
  if (!doc || !doc.head) return null;
  let el = doc.getElementById(STYLE_ID);
  if (el) return el;
  el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
  return el;
}
