// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// experience.css.js: the styles for the landing, hero, target cards, explainer card and shortcut
// help. Kept in a JS module and injected once so the ui-experience module needs no stylesheet
// edits. Every selector is scoped under .tbx and every class is prefixed tbx-, so nothing here
// leaks into the rest of the page.
//
// Exports:
//   CSS                 the stylesheet text
//   injectStyles(doc?)  adds <style id="tbx-experience-css"> to <head> once; safe to call often
//
// The page shell can tune placement with custom properties on any ancestor:
//   --tbx-explain-top, --tbx-explain-right   where the explainer card sits on wide screens
//   --tbx-z                                  base z-index for the explainer (help overlay is +10)

export const STYLE_ID = 'tbx-experience-css';

export const CSS = `
.tbx {
  --tbx-ink: #171715;
  --tbx-paper: #F7F2E7;
  --tbx-signal: #E53C27;
  --tbx-stone: #77766E;
  --tbx-dim: #A8A59A;
  --tbx-raise: #1E1E1B;
  --tbx-line: rgba(247, 242, 231, 0.13);
  --tbx-line-strong: rgba(247, 242, 231, 0.30);
  --tbx-display: -apple-system, BlinkMacSystemFont, Segoe UI Variable Display, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif;
  --tbx-text: -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif;
  --tbx-mono: Consolas, "SFMono-Regular", Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace;
  --tbx-ease: cubic-bezier(0.2, 0.7, 0.2, 1);
  box-sizing: border-box;
  color: var(--tbx-paper);
  font-family: var(--tbx-text);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
.tbx *, .tbx *::before, .tbx *::after { box-sizing: border-box; }
.tbx[hidden], .tbx [hidden] { display: none !important; }
:where(.tbx) button { font: inherit; color: inherit; }
.tbx :focus { outline: none; }
.tbx :focus-visible {
  outline: 2px solid var(--tbx-paper);
  outline-offset: 3px;
}
.tbx-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}
.tbx-label {
  font-family: var(--tbx-mono);
  font-size: 11px;
  line-height: 1.2;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--tbx-dim);
}

/* ---------------------------------------------------------------- landing */

.tbx-landing {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--tbx-ink);
  overflow-x: hidden;
  opacity: 1;
  transition: opacity 170ms ease-out;
}
.tbx-landing[hidden] { display: none; }
.tbx-landing.is-out { opacity: 0; }
.tbx-landing__inner {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: clamp(16px, 2.5vh, 32px) clamp(16px, 4vw, 60px) 0;
}

/* staggered entrance: 9 steps of 20 ms plus a 220 ms move = 400 ms in all */
.tbx-landing [data-tbx-in] {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
  transition:
    opacity 220ms var(--tbx-ease) calc(var(--tbx-i, 0) * 20ms),
    transform 220ms var(--tbx-ease) calc(var(--tbx-i, 0) * 20ms);
}
.tbx-landing.is-in [data-tbx-in] { opacity: 1; transform: none; }

.tbx-top {
  flex: 1 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 0.94fr) minmax(0, 1.06fr);
  grid-template-rows: auto auto;
  grid-template-areas: "head hero" "body hero";
  column-gap: clamp(28px, 4.4vw, 72px);
  align-content: center;
  padding-bottom: clamp(16px, 2.3vh, 28px);
}
.tbx-head { grid-area: head; align-self: end; }
.tbx-body { grid-area: body; align-self: start; }
.tbx-hero { grid-area: hero; align-self: center; }

.tbx-eyebrow { margin: 0 0 clamp(10px, 1.6vh, 16px); display: flex; flex-wrap: wrap; gap: 4px 14px; text-transform: none; }
.tbx-eyebrow span + span::before { content: "/"; margin-right: 14px; color: var(--tbx-stone); }
.tbx-wordmark {
  margin: 0;
  margin-right: -0.17em;
  font-family: var(--tbx-display);
  font-weight: 700;
  font-size: clamp(36px, 5.3vw, 78px);
  line-height: 0.96;
  letter-spacing: 0.17em;
  color: var(--tbx-paper);
  white-space: nowrap;
}
.tbx-tagline {
  margin: clamp(10px, 1.6vh, 16px) 0 0;
  font-size: clamp(18px, 1.55vw, 23px);
  line-height: 1.3;
  color: var(--tbx-paper);
}
.tbx-lede {
  margin: clamp(12px, 2vh, 20px) 0 0;
  max-width: 37.5em;
  font-size: clamp(14.5px, 1.08vw, 16px);
  line-height: 1.58;
  color: rgba(247, 242, 231, 0.80);
}
.tbx-lede button {
  padding: 0; border: 0; background: none; cursor: pointer;
  color: var(--tbx-paper);
  text-decoration: underline; text-decoration-color: var(--tbx-stone); text-underline-offset: 3px;
}
.tbx-lede button:hover { text-decoration-color: var(--tbx-paper); }

/* search */
.tbx-search { margin: clamp(14px, 1.9vh, 20px) 0 0; max-width: 600px; }
.tbx-search__label { display: block; margin-bottom: 8px; }
.tbx-search__row {
  display: flex;
  align-items: stretch;
  height: 54px;
  border: 1px solid var(--tbx-line-strong);
  background: rgba(247, 242, 231, 0.035);
  transition: border-color 120ms, background-color 120ms;
}
.tbx-search__row:hover { border-color: rgba(247, 242, 231, 0.5); }
.tbx-search__row:focus-within { border-color: var(--tbx-paper); background: rgba(247, 242, 231, 0.06); }
.tbx-search.is-invalid .tbx-search__row { border-color: var(--tbx-signal); }
.tbx-search__mark {
  flex: 0 0 auto; width: 46px; display: grid; place-items: center; color: var(--tbx-dim);
}
.tbx-search__input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 12px 0 0;
  border: 0;
  background: transparent;
  color: var(--tbx-paper);
  font-family: var(--tbx-mono);
  font-size: 16px;
  letter-spacing: 0.01em;
  caret-color: var(--tbx-signal);
  text-overflow: ellipsis;
}
.tbx-search__input::placeholder { color: #8A887F; opacity: 1; text-overflow: ellipsis; }
.tbx-search__input:focus-visible { outline: none; }
.tbx-search__go {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 8px;
  margin: 4px;
  padding: 0 18px;
  border: 0;
  background: var(--tbx-signal);
  color: var(--tbx-ink);
  font-family: var(--tbx-display);
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 120ms, transform 120ms;
}
.tbx-search__go:hover { background: #F04A33; }
.tbx-search__go:active { transform: translateY(1px); }
.tbx-search__go[disabled] { background: var(--tbx-stone); cursor: progress; }
.tbx-search__hint {
  margin: 8px 0 0;
  min-height: 19px;
  font-size: 13px;
  line-height: 19px;
  color: var(--tbx-dim);
}
.tbx-search__hint b { font-family: var(--tbx-mono); font-weight: 400; color: var(--tbx-paper); }
.tbx-search.is-invalid .tbx-search__hint { color: #FF8672; }

.tbx-starts { display: flex; flex-wrap: wrap; gap: 0 10px; }
.tbx-surprise {
  display: inline-flex; align-items: center; gap: 10px;
  margin: clamp(10px, 1.6vh, 14px) 0 0;
  text-decoration: none;
  padding: 9px 14px 9px 11px;
  border: 1px dashed var(--tbx-line-strong);
  background: transparent;
  font-size: 14px;
  line-height: 20px;
  color: var(--tbx-paper);
  cursor: pointer;
  transition: border-color 120ms, background-color 120ms;
}
.tbx-surprise:hover { border-color: var(--tbx-paper); border-style: solid; background: rgba(247, 242, 231, 0.04); }
.tbx-surprise svg { color: var(--tbx-dim); flex: 0 0 auto; }
.tbx-surprise:hover svg { color: var(--tbx-signal); }

/* hero */
.tbx-hero { margin: 0; min-width: 0; }
.tbx-hero__canvas {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9.8;
  max-height: 60vh;
  background: var(--tbx-ink);
}
.tbx-hero__cap {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  margin: 8px 12px 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--tbx-dim);
}
.tbx-hero__cap p { margin: 0; max-width: 46em; }
.tbx-textbtn {
  flex: 0 0 auto;
  padding: 2px 0;
  border: 0;
  border-bottom: 1px solid var(--tbx-stone);
  background: none;
  font-family: var(--tbx-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--tbx-dim);
  cursor: pointer;
}
.tbx-textbtn:hover { color: var(--tbx-paper); border-color: var(--tbx-paper); }

/* targets */
.tbx-targets { padding-bottom: clamp(12px, 1.6vh, 20px); }
.tbx-targets__head { display: flex; align-items: center; gap: 16px; margin: 0 0 12px; }
.tbx-targets__head h2 { margin: 0; font-weight: 400; white-space: nowrap; }
.tbx-targets__head::after { content: ""; flex: 1 1 auto; height: 1px; background: var(--tbx-line); }
.tbx-cards {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(204px, 1fr);
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
  scrollbar-color: var(--tbx-stone) transparent;
  /* room for focus rings inside the scroll box */
  margin: -6px; padding: 6px;
}
.tbx-cards.has-more {
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 40px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 40px), transparent);
}
.tbx-cards > li { display: flex; min-width: 0; scroll-snap-align: start; scroll-margin: 6px; }
.tbx-card {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  border: 1px solid var(--tbx-line);
  background: rgba(247, 242, 231, 0.02);
  text-align: left;
  cursor: pointer;
  transition: border-color 140ms, background-color 140ms, transform 140ms var(--tbx-ease);
}
.tbx-card:hover, .tbx-card:focus-visible {
  border-color: rgba(247, 242, 231, 0.55);
  background: rgba(247, 242, 231, 0.045);
}
.tbx-card:active { transform: translateY(1px); }
.tbx-card__plate {
  display: flex;
  border-bottom: 1px solid var(--tbx-line);
}
.tbx-card__preview {
  flex: 0 0 auto;
  display: block;
  width: 128px;
  height: 128px;
  background: #121210;
  image-rendering: -moz-crisp-edges;
  image-rendering: crisp-edges;
  image-rendering: pixelated;
}
.tbx-card__data {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 7px 8px 9px;
  border-left: 1px solid var(--tbx-line);
  font-family: var(--tbx-mono);
  font-size: 10px;
  line-height: 14px;
  color: var(--tbx-dim);
  white-space: nowrap;
  overflow: hidden;
}
.tbx-card__num { font-size: 12px; color: var(--tbx-paper); letter-spacing: 0.06em; }
.tbx-card__kind { letter-spacing: 0.12em; text-transform: uppercase; }
.tbx-card__rows { display: flex; flex-direction: column; margin-top: auto; }
.tbx-card__rows i { font-style: normal; color: var(--tbx-stone); }
.tbx-card__text { display: flex; flex-direction: column; flex: 1 1 auto; padding: 12px 13px 13px; }
.tbx-card__name, .tbx-card__blurb, .tbx-card__why { display: block; }
.tbx-card__name {
  font-family: var(--tbx-display);
  font-weight: 700;
  font-size: 15px;
  line-height: 1.25;
  letter-spacing: 0.02em;
  color: var(--tbx-paper);
}
.tbx-card__blurb { margin-top: 5px; font-size: 13px; line-height: 1.42; color: rgba(247, 242, 231, 0.78); }
.tbx-card__why { margin-top: 10px; font-size: 13px; line-height: 1.42; color: var(--tbx-paper); }
.tbx-card__why .tbx-label { display: block; margin-bottom: 3px; font-size: 10px; }
.tbx-card__found .tbx-label { color: var(--tbx-signal); }
.tbx-card__go {
  position: absolute; right: 10px; bottom: 9px;
  font-family: var(--tbx-mono); font-size: 12px; color: var(--tbx-signal);
  opacity: 0; transform: translateX(-4px);
  transition: opacity 140ms, transform 140ms var(--tbx-ease);
}
.tbx-card:hover .tbx-card__go, .tbx-card:focus-visible .tbx-card__go { opacity: 1; transform: none; }

/* footer */
.tbx-foot {
  display: flex; flex-wrap: wrap; gap: 4px 28px;
  margin: 0;
  padding: 10px 0 12px;
  border-top: 1px solid var(--tbx-line);
  font-size: 12px;
  line-height: 18px;
  color: var(--tbx-dim);
  list-style: none;
}
.tbx-foot li:last-child { margin-left: auto; }
.tbx-foot .tbx-foot__result { flex: 1 1 100%; color: var(--tbx-paper); }
.tbx-foot button { appearance: none; background: none; border: 0; padding: 0; font: inherit; color: var(--tbx-paper); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }

@media (max-width: 900px) {
  .tbx-top {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "head" "hero" "body";
    align-content: start;
  }
  .tbx-hero { margin-top: 16px; }
  .tbx-hero__canvas { aspect-ratio: 16 / 11.2; max-height: 46vh; }
  .tbx-hero__cap { margin: 6px 0 0; }
  .tbx-search { max-width: none; }
  .tbx-cards { grid-auto-columns: 236px; margin-right: calc(-1 * clamp(16px, 4vw, 60px)); padding-right: clamp(16px, 4vw, 60px); }
  .tbx-foot li:last-child { margin-left: 0; }
}
@media (max-width: 480px) {
  .tbx-search__row { height: 50px; }
  .tbx-search__mark { width: 38px; }
  .tbx-search__go { padding: 0 14px; }
  .tbx-hero__cap { flex-direction: column; gap: 6px; }
  .tbx-foot { flex-direction: column; }
}

/* ---------------------------------------------------------------- explainer card */

.tbx-explain {
  position: fixed;
  z-index: var(--tbx-z, 60);
  top: var(--tbx-explain-top, 72px);
  right: var(--tbx-explain-right, 16px);
  width: min(388px, calc(100vw - 32px));
  max-height: calc(100vh - var(--tbx-explain-top, 72px) - 16px);
  max-height: calc(100dvh - var(--tbx-explain-top, 72px) - 16px);
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px 18px 14px;
  background: var(--tbx-raise);
  border: 1px solid var(--tbx-line-strong);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transform: translate3d(14px, 0, 0);
  transition: opacity 180ms var(--tbx-ease), transform 180ms var(--tbx-ease);
}
.tbx-explain.is-open { opacity: 1; transform: none; }
.tbx-explain:focus-visible, .tbx-wordmark:focus-visible, .tbx-help__panel:focus-visible { outline: none; }
.tbx-explain__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tbx-explain__title {
  margin: 10px 0 0;
  font-family: var(--tbx-display);
  font-weight: 700;
  font-size: 19px;
  line-height: 1.2;
  letter-spacing: 0.01em;
}
.tbx-explain__fig {
  margin: 14px 0 0;
  border: 1px solid var(--tbx-line);
  background: var(--tbx-ink);
}
.tbx-explain__fig svg { display: block; width: 100%; height: auto; }
.tbx-explain__body { margin: 14px 0 0; }
.tbx-explain__body p { margin: 0 0 9px; font-size: 14.5px; line-height: 1.55; color: rgba(247, 242, 231, 0.88); }
.tbx-explain__foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-top: 6px; padding-top: 11px;
  border-top: 1px solid var(--tbx-line);
}
.tbx-explain__next {
  padding: 2px 0;
  border: 0;
  background: none;
  font-size: 13.5px;
  color: var(--tbx-paper);
  text-align: left;
  cursor: pointer;
}
.tbx-explain__next span { color: var(--tbx-dim); }
.tbx-explain__next b { font-weight: 400; text-decoration: underline; text-decoration-color: var(--tbx-stone); text-underline-offset: 3px; }
.tbx-explain__next:hover b { text-decoration-color: var(--tbx-paper); }
.tbx-explain__next i { font-style: normal; color: var(--tbx-signal); margin-left: 4px; }
.tbx-iconbtn {
  flex: 0 0 auto;
  display: grid; place-items: center;
  width: 28px; height: 28px;
  margin: -4px -6px -4px 0;
  padding: 0;
  border: 1px solid transparent;
  background: none;
  color: var(--tbx-dim);
  cursor: pointer;
}
.tbx-iconbtn:hover { color: var(--tbx-paper); border-color: var(--tbx-line-strong); }
.tbx-whybtn {
  display: inline-grid; place-items: center;
  width: 18px; height: 18px;
  padding: 0;
  border: 1px solid var(--tbx-stone);
  border-radius: 50%;
  background: none;
  font-family: var(--tbx-mono);
  font-size: 11px;
  line-height: 1;
  color: var(--tbx-dim);
  cursor: pointer;
  vertical-align: middle;
}
.tbx-whybtn:hover { color: var(--tbx-paper); border-color: var(--tbx-paper); }

@media (max-width: 640px) {
  .tbx-explain {
    top: auto; right: 8px; left: 8px; bottom: 8px;
    width: auto;
    max-height: 72vh;
    max-height: 72dvh;
    transform: translate3d(0, 14px, 0);
  }
}

/* ---------------------------------------------------------------- shortcut help */

.tbx-help {
  position: fixed; inset: 0;
  z-index: calc(var(--tbx-z, 60) + 10);
  display: grid; place-items: center;
  padding: 16px;
}
.tbx-help__backdrop {
  position: absolute; inset: 0;
  background: rgba(10, 10, 9, 0.66);
  opacity: 0;
  transition: opacity 160ms ease-out;
}
.tbx-help__panel {
  position: relative;
  width: min(440px, 100%);
  max-height: 100%;
  overflow: auto;
  padding: 18px 20px 16px;
  background: var(--tbx-raise);
  border: 1px solid var(--tbx-line-strong);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55);
  opacity: 0;
  transform: translate3d(0, 8px, 0);
  transition: opacity 160ms var(--tbx-ease), transform 160ms var(--tbx-ease);
}
.tbx-help.is-open .tbx-help__backdrop { opacity: 1; }
.tbx-help.is-open .tbx-help__panel { opacity: 1; transform: none; }
.tbx-help__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.tbx-help__title { margin: 0; font-family: var(--tbx-display); font-weight: 700; font-size: 17px; letter-spacing: 0.04em; }
.tbx-help__list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 18px;
  margin: 0;
  border-top: 1px solid var(--tbx-line);
}
.tbx-help__list dt, .tbx-help__list dd {
  margin: 0; padding: 8px 0;
  border-bottom: 1px solid var(--tbx-line);
  font-size: 14px; line-height: 22px;
}
.tbx-help__list dt { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.tbx-help__list dd { color: rgba(247, 242, 231, 0.88); }
.tbx-help__sep { font-family: var(--tbx-mono); font-size: 11px; color: var(--tbx-stone); }
.tbx-kbd {
  display: inline-grid; place-items: center;
  min-width: 24px; height: 22px;
  padding: 0 6px;
  border: 1px solid var(--tbx-line-strong);
  border-bottom-width: 2px;
  background: rgba(247, 242, 231, 0.04);
  font-family: var(--tbx-mono);
  font-size: 12px;
  line-height: 1;
  color: var(--tbx-paper);
}
.tbx-help__note { margin: 12px 0 0; font-size: 12.5px; color: var(--tbx-dim); }

/* ---------------------------------------------------------------- reduced motion */

@media (prefers-reduced-motion: reduce) {
  .tbx-landing, .tbx-landing [data-tbx-in], .tbx-explain, .tbx-help__backdrop, .tbx-help__panel,
  .tbx-card, .tbx-card__go, .tbx-search__go {
    transition: none !important;
  }
  .tbx-landing [data-tbx-in], .tbx-explain, .tbx-help__panel, .tbx-card__go { transform: none !important; }
}
`;

/**
 * Add the stylesheet to the document once. Returns the <style> element, or null without a DOM.
 * @param {Document} [doc]
 */
export function injectStyles(doc = globalThis.document) {
  if (!doc || !doc.createElement) return null;
  const existing = doc.getElementById(STYLE_ID);
  if (existing) return existing;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
  return style;
}
