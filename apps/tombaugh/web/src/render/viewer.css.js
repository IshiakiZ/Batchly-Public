// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Styles for the image viewer, injected once per document (or shadow root) so that viewer.js is
// self-contained and needs nothing from web/styles.css. All class names are prefixed `tbv-`.

export const VIEWER_STYLE_ID = 'tbv-styles';

export const VIEWER_CSS = `
.tbv {
  position: relative;
  display: block;
  box-sizing: border-box;
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 100%;
  min-width: 0;
  overflow: hidden;
  background: #171715;
  color: #F7F2E7;
  line-height: 1;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.tbv.tbv-fill { aspect-ratio: auto; height: 100%; }
.tbv-canvas {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: block;
  outline: none;
  cursor: crosshair;
  touch-action: pan-y;
}
.tbv-canvas.tbv-zoomed { touch-action: none; cursor: grab; }
.tbv-canvas.tbv-dragging { cursor: grabbing; }
.tbv-canvas:focus-visible { outline: 1px solid rgba(247, 242, 231, 0.6); outline-offset: -1px; }
.tbv-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 1px;
  padding: 0;
  margin: 0;
  background: rgba(23, 23, 21, 0.72);
  border: 1px solid rgba(247, 242, 231, 0.14);
  border-radius: 3px;
  opacity: 0.55;
  transition: opacity 140ms ease-out;
}
.tbv:hover .tbv-toolbar,
.tbv:focus-within .tbv-toolbar { opacity: 1; }
.tbv-toolbar[hidden] { display: none; }
.tbv-btn {
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  width: 26px;
  height: 26px;
  margin: 0;
  padding: 5px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: rgba(247, 242, 231, 0.78);
  font: 12px/1 Arial, Helvetica, sans-serif;
  cursor: pointer;
}
.tbv-btn svg { display: block; width: 16px; height: 16px; pointer-events: none; }
.tbv-btn:hover { color: #F7F2E7; background: rgba(247, 242, 231, 0.12); }
.tbv-btn:active { background: rgba(247, 242, 231, 0.2); }
.tbv-btn:focus-visible { outline: 1px solid #F7F2E7; outline-offset: -1px; }
.tbv-btn[aria-pressed="true"] { color: #171715; background: #F7F2E7; }
.tbv-btn[disabled] { color: rgba(247, 242, 231, 0.28); cursor: default; background: transparent; }
.tbv-btn[hidden] { display: none; }
.tbv-sep { width: 1px; margin: 5px 2px; background: rgba(247, 242, 231, 0.16); }
.tbv-sep[hidden] { display: none; }
@media (hover: none) {
  .tbv-toolbar { opacity: 0.85; }
  .tbv-btn { width: 32px; height: 32px; padding: 8px; }
  .tbv-btn-loupe { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .tbv-toolbar { transition: none; }
}
`;

/**
 * Add the viewer stylesheet to the document (or shadow root) that `node` lives in. Safe to call
 * many times. Returns the <style> element, or null when there is no DOM.
 */
export function injectViewerStyles(node) {
  const doc = (node && node.ownerDocument) || (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;
  let host = doc.head || doc.documentElement;
  const rootNode = node && node.getRootNode ? node.getRootNode() : doc;
  if (rootNode && rootNode !== doc && rootNode.host) host = rootNode; // inside a shadow root
  const existing = host.querySelector ? host.querySelector(`#${VIEWER_STYLE_ID}`) : null;
  if (existing) return existing;
  const style = doc.createElement('style');
  style.id = VIEWER_STYLE_ID;
  style.textContent = VIEWER_CSS;
  host.appendChild(style);
  return style;
}
