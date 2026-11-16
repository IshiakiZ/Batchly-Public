// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Export plugin: an "Export" tool in the viewer tool strip that opens a compact dialog.
//
//   Save this frame (PNG)      the viewer's own image when app.viewer.toDataURL works, else the
//                              MovieFrame drawn by frame.js
//   Save share card (PNG)      1200 x 630, card.js
//   Save movie as GIF          every frame of app.movie(), 256 / 384 / 512 px, 2 / 4 / 8 frames
//                              per second, date and wavelength optionally burned into a corner;
//                              encoded in slices with a progress bar and a Cancel button
//   Save movie as WebM         where the browser can record a canvas (webm.js)
//   Copy link                  the page address with the current frame index
//   Download source data (CSV) when app.selection() has a spectrum
//
// install(app) returns { dispose(), open(), close() }. Everything the plugin needs from the shell
// is optional: without app.addTool there is no button (call open() yourself), without
// app.openModal a small dialog of its own is used, without app.viewer frames are drawn here.
// Handlers never throw; downloads go through Blob URLs and the clipboard is wrapped in try/catch.

import { ensureExportStyles, EXPORT_STYLE_ID } from './export.css.js';
import { createGifEncoder } from './gif.js';
import { createPaletteBuilder, createMapper, mapPixels } from './quantize.js';
import {
  renderFrameRgba, upscaleNearest, isDrawable, frameCaption, exportFileName, coordSlug, spectrumCsv,
  spectrumRowCount, shareLink, formatCoords, formatBytes, dataUrlToBytes, defaultFps,
} from './frame.js';
import { renderShareCard, fitEllipsis, INK, PAPER } from './card.js';
import { recordCanvas, videoSupport } from './webm.js';

export const meta = {
  id: 'export',
  title: 'Export',
  description: 'Save the current frame, the movie as a GIF or WebM, a share card, a link, or the clicked source as CSV.',
};

export const GIF_SIZES = [256, 384, 512];
export const GIF_SPEEDS = [2, 4, 8]; // frames per second
export const GIF_COLORS = 128;

const NUM_FONT = 'Consolas, "SFMono-Regular", Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace';
const EVENTS = ['target', 'frames', 'movie', 'frame', 'select', 'state'];

// Choices survive closing and reopening the dialog (per page load).
const prefs = { size: 384, fps: 0, captions: true };

let dialogCount = 0;

// ---------------------------------------------------------------------------------------------
// Small DOM helpers

function h(doc, tag, attrs, ...children) {
  const el = doc.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : doc.createTextNode(String(child)));
  }
  return el;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function nowMs() {
  try {
    return performance.now();
  } catch {
    return Date.now();
  }
}

function abortError() {
  const err = new Error('cancelled');
  err.code = 'aborted';
  return err;
}

function call(fn, fallback) {
  try {
    const v = typeof fn === 'function' ? fn() : undefined;
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve) => {
    const viaDataUrl = () => {
      try {
        const parsed = dataUrlToBytes(canvas.toDataURL(type));
        resolve(parsed ? new Blob([parsed.bytes], { type: parsed.type }) : null);
      } catch {
        resolve(null);
      }
    };
    try {
      if (typeof canvas.toBlob === 'function') canvas.toBlob((blob) => (blob ? resolve(blob) : viaDataUrl()), type);
      else viaDataUrl();
    } catch {
      viaDataUrl();
    }
  });
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog of our own for shells without app.openModal: native <dialog> (focus trap and Esc for
 * free) with a hand-made trap when showModal is missing. Same shape as app.openModal's result.
 */
function openFallbackDialog(doc, { title = '', render = null, onClose = null } = {}) {
  const titleId = `tbe-dialog-title-${++dialogCount}`;
  const body = h(doc, 'div', { class: 'tbe-dialog-body' });
  const closeBtn = h(doc, 'button', { type: 'button', class: 'tbe-btn tbe-btn-quiet tbe-btn-small', 'aria-label': 'Close export' }, 'Close');
  const dialog = h(
    doc,
    'dialog',
    { class: 'tbe-dialog', 'aria-labelledby': titleId },
    h(doc, 'div', { class: 'tbe-dialog-head' }, h(doc, 'h2', { class: 'tbe-dialog-title', id: titleId }, title), closeBtn),
    body,
  );
  const previous = doc.activeElement;
  let closed = false;
  let native = false;
  let keyHandler = null;

  function finish() {
    if (closed) return;
    closed = true;
    if (keyHandler) doc.removeEventListener('keydown', keyHandler, true);
    dialog.remove();
    try {
      if (onClose) onClose();
    } catch (err) {
      console.warn('[tombaugh] export dialog onClose failed', err);
    }
    try {
      if (previous && typeof previous.focus === 'function' && doc.contains(previous)) previous.focus({ preventScroll: true });
    } catch {
      // focus is a courtesy
    }
  }
  function close() {
    if (closed) return;
    try {
      if (native && dialog.open) dialog.close();
    } catch {
      // fall through to the manual clean-up
    }
    finish();
  }

  dialog.addEventListener('close', finish);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(); // the backdrop
  });
  closeBtn.addEventListener('click', close);
  (doc.body || doc.documentElement).append(dialog);
  try {
    if (render) render(body);
  } catch (err) {
    console.warn('[tombaugh] export dialog failed to draw', err);
    body.textContent = 'The export options could not be drawn.';
  }
  try {
    dialog.showModal();
    native = true;
  } catch {
    // No modal <dialog> here: show it and keep focus inside by hand.
    dialog.setAttribute('open', '');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    keyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    doc.addEventListener('keydown', keyHandler, true);
    try {
      const first = dialog.querySelector(FOCUSABLE);
      if (first) first.focus({ preventScroll: true });
    } catch {
      // focus is a courtesy
    }
  }
  return { body, close };
}

// ---------------------------------------------------------------------------------------------
// Drawing

/** Date and wavelength on an opaque Ink plate in the bottom-left corner of a size x size frame. */
export function drawCornerCaption(ctx, size, caption) {
  const lines = [caption && caption.date, caption && caption.wave].filter(Boolean);
  if (!lines.length) return;
  const fontPx = Math.round(Math.min(17, Math.max(11, size * 0.034)));
  const pad = Math.round(fontPx * 0.55);
  const lineH = Math.round(fontPx * 1.32);
  const margin = Math.max(4, Math.round(size * 0.02));
  ctx.save();
  ctx.font = `${fontPx}px ${NUM_FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const maxWidth = size - 2 * margin - 2 * pad;
  const fitted = lines.map((line) => fitEllipsis(ctx, line, maxWidth));
  let width = 0;
  for (const line of fitted) width = Math.max(width, ctx.measureText(line).width);
  const boxW = Math.ceil(width) + 2 * pad;
  const boxH = fitted.length * lineH + pad;
  const x = margin;
  const y = size - margin - boxH;
  ctx.fillStyle = INK;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.fillStyle = PAPER;
  fitted.forEach((line, i) => ctx.fillText(line, x + pad, y + Math.round(pad * 0.5) + (i + 1) * lineH - Math.round(fontPx * 0.28)));
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// The plugin

export function install(app) {
  const doc = globalThis.document;
  if (!app || typeof app !== 'object' || !doc || !doc.createElement) return { dispose() {}, open() {}, close() {} };
  ensureExportStyles(doc);

  let modal = null; //   { handle, ui, offs: [], resumePlay }
  let job = null; //     { kind, cancelled, controller }
  let disposed = false;
  let liveUrls = [];
  const composedRgba = new WeakMap(); // MovieFrame -> rgba composed from frame.rgb

  // ---- what there is to export ---------------------------------------------------------------
  function snapshot() {
    const movie = call(() => app.movie(), null) || {};
    const all = Array.isArray(movie.frames) ? movie.frames : [];
    const frames = all.filter(isDrawable);
    const rawIndex = Number.isFinite(movie.index) ? Math.min(Math.max(0, Math.round(movie.index)), Math.max(0, all.length - 1)) : 0;
    let index = frames.indexOf(all[rawIndex]);
    if (index < 0) index = 0;
    const state = call(() => app.store.get(), null) || {};
    const lib = app.lib && typeof app.lib === 'object' ? app.lib : null;
    const maps = lib && lib.COLORMAPS;
    const colormap = maps && state.colormap && state.colormap !== 'gray' && typeof maps[state.colormap] === 'function' ? maps[state.colormap] : null;
    const target = call(() => app.target(), null);
    return {
      frames,
      index,
      rawIndex,
      current: frames[index] || null,
      view: String(movie.view || state.view || ''),
      state,
      stretch: state.stretch,
      colormap,
      target: target && typeof target === 'object' ? target : null,
      selection: call(() => app.selection(), null),
      grid: call(() => app.grid(), null),
      link: shareLink(call(() => globalThis.location.href, ''), state, rawIndex),
    };
  }

  /** A colour frame without composed pixels gets them from the shell's own compositor if any. */
  function prepared(frame) {
    if (!frame || frame.rgba || !frame.rgb) return frame;
    let rgba = composedRgba.get(frame);
    if (rgba === undefined) {
      rgba = null;
      try {
        const compose = app.lib && app.lib.rgbComposite;
        if (typeof compose === 'function' && frame.rgb.ranges) rgba = compose(frame.rgb.r, frame.rgb.g, frame.rgb.b, frame.rgb.ranges) || null;
      } catch {
        rgba = null;
      }
      composedRgba.set(frame, rgba);
    }
    return rgba ? { ...frame, rgba } : frame;
  }

  function renderNative(snap, frame) {
    return renderFrameRgba(prepared(frame), { stretch: snap.stretch, colormap: snap.colormap });
  }

  /**
   * Frame i of the movie at size x size. pixels(i) -> RGBA (valid until the next call);
   * drawTo(ctx, i) paints it on a 2D context of that size.
   */
  function makeComposer(snap, size, captions) {
    const out = new Uint8ClampedArray(size * size * 4);
    let scratch = null;
    function upscaled(i) {
      const { data, n } = renderNative(snap, snap.frames[i]);
      return upscaleNearest(data, n, size, out);
    }
    function drawTo(ctx, i) {
      const image = ctx.createImageData(size, size);
      image.data.set(upscaled(i));
      ctx.putImageData(image, 0, 0);
      if (captions) drawCornerCaption(ctx, size, frameCaption(snap.frames[i]));
    }
    function pixels(i) {
      if (!captions) return upscaled(i);
      if (!scratch) {
        const canvas = doc.createElement('canvas');
        canvas.width = canvas.height = size;
        scratch = canvas.getContext('2d', { willReadFrequently: true });
      }
      drawTo(scratch, i);
      return scratch.getImageData(0, 0, size, size).data;
    }
    return { pixels, drawTo };
  }

  // ---- saving --------------------------------------------------------------------------------
  function revokeLater(urls, delayMs) {
    if (!urls.length) return;
    setTimeout(() => {
      for (const url of urls) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // nothing to clean up
        }
      }
    }, delayMs);
  }

  /** Start a download. Returns the Blob URL (kept alive while the dialog is open) or ''. */
  function saveBlob(blob, name) {
    let url = '';
    try {
      url = URL.createObjectURL(blob);
    } catch {
      return '';
    }
    revokeLater(liveUrls, 15000); // the previous export's link has served its purpose
    liveUrls = [url];
    try {
      const a = h(doc, 'a', { href: url, download: name, rel: 'noopener', style: 'display:none' });
      // Inside the dialog: the rest of the page is inert while a modal dialog is open.
      const host = (modal && modal.ui && modal.ui.root) || doc.body || doc.documentElement;
      host.append(a);
      a.click();
      a.remove();
    } catch {
      // The link in the status line still works.
    }
    return url;
  }

  function reportSaved(name, detail, url) {
    if (!modal) return;
    modal.ui.setStatus('ok', [
      `Saved ${name}${detail ? ` (${detail})` : ''}. `,
      url ? 'Nothing arrived? ' : '',
      url ? h(doc, 'a', { href: url, download: name }, 'Save it again') : '',
      url ? '.' : '',
    ]);
  }

  function reportError(what, err) {
    console.warn(`[tombaugh] export: ${what}`, err);
    if (!modal) return;
    const why = err && err.message ? ` ${String(err.message).replace(/\.$/, '')}.` : '';
    modal.ui.setStatus('error', [`${what}.${why}`]);
  }

  function frameSuffix(snap) {
    const n = snap.index + 1;
    return snap.frames.length > 1 ? `f${n < 10 ? '0' : ''}${n}` : '';
  }

  async function savePng() {
    const snap = snapshot();
    if (!snap.current) {
      modal.ui.setStatus('error', ['There is no frame to save yet.']);
      return;
    }
    let blob = null;
    let how = 'as shown in the viewer';
    try {
      if (app.viewer && typeof app.viewer.toDataURL === 'function') {
        const parsed = dataUrlToBytes(app.viewer.toDataURL({ scale: 2 }));
        if (parsed && parsed.bytes.length > 200 && /^image\//.test(parsed.type)) blob = new Blob([parsed.bytes], { type: parsed.type });
      }
    } catch {
      blob = null;
    }
    if (!blob) {
      const size = 768;
      const canvas = doc.createElement('canvas');
      canvas.width = canvas.height = size;
      makeComposer(snap, size, true).drawTo(canvas.getContext('2d'), snap.index);
      blob = await canvasToBlob(canvas);
      how = `${size} px`;
    }
    if (!blob) throw new Error('The browser could not make a PNG');
    const name = exportFileName({ target: snap.target, view: snap.view, suffix: frameSuffix(snap), ext: /jpeg/.test(blob.type) ? 'jpg' : 'png' });
    reportSaved(name, `${how}, ${formatBytes(blob.size)}`, saveBlob(blob, name));
  }

  async function saveCard() {
    const snap = snapshot();
    if (!snap.current) {
      modal.ui.setStatus('error', ['There is no frame to put on a card yet.']);
      return;
    }
    const cap = frameCaption(snap.current);
    const t = snap.target || {};
    let field = '';
    if (snap.grid && Number.isFinite(snap.grid.n) && Number.isFinite(snap.grid.scale)) {
      field = `${Number(((snap.grid.n * snap.grid.scale) / 60).toFixed(1))} arcmin field`;
    }
    const canvas = renderShareCard({
      frameCanvasOrImage: renderNative(snap, snap.current),
      title: t.name || '',
      coords: formatCoords(t.ra, t.dec),
      date: cap.date,
      wave: cap.wave,
      note: cap.note || cap.title,
      url: snap.link,
      kicker: snap.view ? `${snap.view} view` : '',
      field,
      doc,
    });
    const blob = await canvasToBlob(canvas);
    if (!blob) throw new Error('The browser could not make a PNG');
    const name = exportFileName({ target: snap.target, view: snap.view, suffix: 'card', ext: 'png' });
    reportSaved(name, `1200 × 630, ${formatBytes(blob.size)}`, saveBlob(blob, name));
  }

  function beginJob(kind) {
    job = { kind, cancelled: false, controller: typeof AbortController === 'function' ? new AbortController() : null };
    if (modal) modal.ui.setBusy(kind);
    return job;
  }
  function endJob(mine) {
    if (job === mine) job = null;
    if (modal) modal.ui.setBusy(null);
  }
  function cancelJob() {
    if (!job) return;
    job.cancelled = true;
    try {
      if (job.controller) job.controller.abort();
    } catch {
      // the cancelled flag is enough
    }
  }

  async function saveGif() {
    const snap = snapshot();
    const count = snap.frames.length;
    if (!count) {
      modal.ui.setStatus('error', ['There is no movie to save yet.']);
      return;
    }
    const { size, fps, captions } = modal.ui.options();
    const mine = beginJob('gif');
    try {
      const composer = makeComposer(snap, size, captions);
      const delayMs = 1000 / fps;
      let last = nowMs();
      const breathe = async () => {
        if (mine.cancelled || !modal) throw abortError();
        if (nowMs() - last < 12) return;
        await tick();
        last = nowMs();
        if (mine.cancelled || !modal) throw abortError();
      };

      // Pass 1: one palette for the whole movie, so the blink does not shimmer.
      const builder = createPaletteBuilder();
      for (let i = 0; i < count; i++) {
        builder.add(composer.pixels(i));
        modal.ui.setProgress(((i + 1) / count) * 0.3, `Reading colours: frame ${i + 1} of ${count}`);
        await breathe();
      }
      const palette = builder.build(GIF_COLORS);
      const mapper = createMapper(palette);

      // Pass 2: map and compress, one frame per slice.
      const encoder = createGifEncoder({ width: size, height: size, palette, loop: 0 });
      const indices = new Uint8Array(size * size);
      for (let i = 0; i < count; i++) {
        mapPixels(composer.pixels(i), size, size, mapper, { out: indices });
        encoder.addFrame(indices, delayMs);
        modal.ui.setProgress(0.3 + ((i + 1) / count) * 0.7, `Encoding GIF: frame ${i + 1} of ${count}`);
        await breathe();
      }
      const bytes = encoder.finish();
      const blob = new Blob([bytes], { type: 'image/gif' });
      const name = exportFileName({ target: snap.target, view: snap.view, ext: 'gif' });
      const url = saveBlob(blob, name);
      endJob(mine);
      reportSaved(name, `${count} frame${count === 1 ? '' : 's'}, ${size} px, ${formatBytes(blob.size)}`, url);
    } catch (err) {
      endJob(mine);
      if (err && err.code === 'aborted') {
        if (modal) modal.ui.setStatus('info', ['GIF export cancelled.']);
      } else reportError('The GIF could not be encoded', err);
    }
  }

  async function saveVideo() {
    const snap = snapshot();
    const count = snap.frames.length;
    if (!count) {
      modal.ui.setStatus('error', ['There is no movie to save yet.']);
      return;
    }
    const support = videoSupport(globalThis);
    if (!support.supported) {
      modal.ui.setStatus('error', [support.reason]);
      return;
    }
    const { size, fps, captions } = modal.ui.options();
    const mine = beginJob('video');
    try {
      const composer = makeComposer(snap, size, captions);
      const canvas = doc.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      // A two-frame blink would be a one-second file: repeat short movies up to about 3 s.
      const loops = Math.min(8, Math.max(1, Math.ceil(3 / (count / fps))));
      const seconds = (count * loops) / fps;
      modal.ui.setProgress(0, `Recording ${support.label} in real time: about ${Math.ceil(seconds)} s`);
      const blob = await recordCanvas(canvas, (i) => composer.drawTo(ctx, i), {
        frames: count,
        fps,
        loops,
        mimeType: support.mimeType,
        signal: mine.controller ? mine.controller.signal : null,
        onProgress: ({ done, total }) => {
          if (modal && job === mine) modal.ui.setProgress(done / total, `Recording ${support.label}: frame ${done} of ${total}`);
        },
      });
      if (mine.cancelled || !modal) throw abortError();
      const ext = blob.ext || support.ext || 'webm';
      const name = exportFileName({ target: snap.target, view: snap.view, ext });
      const url = saveBlob(blob, name);
      endJob(mine);
      reportSaved(name, `${count} frame${count === 1 ? '' : 's'}${loops > 1 ? ` × ${loops}` : ''}, ${size} px, ${formatBytes(blob.size)}`, url);
    } catch (err) {
      endJob(mine);
      if (err && err.code === 'aborted') {
        if (modal) modal.ui.setStatus('info', ['Video export cancelled.']);
      } else reportError('The video could not be recorded', err);
    }
  }

  async function copyLink() {
    const snap = snapshot();
    if (!snap.link) {
      modal.ui.setStatus('error', ['This page has no address that can be shared.']);
      return;
    }
    modal.ui.linkInput.value = snap.link;
    let ok = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(snap.link);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!modal) return;
    if (!ok) {
      try {
        modal.ui.linkInput.focus();
        modal.ui.linkInput.select();
        ok = !!doc.execCommand && doc.execCommand('copy');
      } catch {
        ok = false;
      }
    }
    if (ok) modal.ui.setStatus('ok', ['Link copied.']);
    else {
      try {
        modal.ui.linkInput.focus();
        modal.ui.linkInput.select();
      } catch {
        // selection is a courtesy
      }
      modal.ui.setStatus('info', ['Copying is blocked here. The link is selected: copy it with Ctrl+C or ⌘C.']);
    }
  }

  function saveCsv() {
    const snap = snapshot();
    const sel = snap.selection;
    const rows = sel ? spectrumRowCount(sel.spectrum) : 0;
    if (!rows) {
      modal.ui.setStatus('error', ['Click a source in the image first; its measurements can then be saved.']);
      return;
    }
    const blob = new Blob([spectrumCsv(sel.spectrum)], { type: 'text/csv;charset=utf-8' });
    const name = exportFileName({ target: snap.target, view: 'spectrum', suffix: coordSlug(sel.ra, sel.dec), ext: 'csv' });
    reportSaved(name, `${rows} row${rows === 1 ? '' : 's'}, ${formatBytes(blob.size)}`, saveBlob(blob, name));
  }

  /** Wrap a handler so that nothing it does can throw into the page. */
  function guard(what, fn) {
    return () => {
      if (!modal || job) return;
      try {
        const result = fn();
        if (result && typeof result.catch === 'function') result.catch((err) => reportError(what, err));
      } catch (err) {
        reportError(what, err);
      }
    };
  }

  // ---- dialog content ------------------------------------------------------------------------
  function buildUi(container) {
    const uid = ++dialogCount;
    const thumb = h(doc, 'canvas', { class: 'tbe-thumb', width: 64, height: 64, 'aria-hidden': 'true' });
    const what = h(doc, 'div', { class: 'tbe-what' });
    const sub = h(doc, 'div', { class: 'tbe-sub' });

    const btnPng = h(doc, 'button', { type: 'button', class: 'tbe-btn', 'data-action': 'png', onclick: guard('The frame could not be saved', savePng) }, 'Save this frame', h(doc, 'span', { class: 'tbe-fmt' }, 'PNG'));
    const btnCard = h(doc, 'button', { type: 'button', class: 'tbe-btn', 'data-action': 'card', onclick: guard('The share card could not be saved', saveCard) }, 'Save share card', h(doc, 'span', { class: 'tbe-fmt' }, 'PNG'));
    const imageHint = h(doc, 'p', { class: 'tbe-hint', hidden: true });

    function segmented(name, legend, values, labelOf, ariaOf) {
      const items = h(doc, 'div', { class: 'tbe-seg-items' });
      const inputs = values.map((value) => {
        const input = h(doc, 'input', { type: 'radio', name: `tbe-${name}-${uid}`, value: String(value), 'aria-label': ariaOf(value) });
        items.append(h(doc, 'label', null, input, h(doc, 'span', null, labelOf(value))));
        return input;
      });
      const field = h(doc, 'fieldset', { class: 'tbe-seg', 'data-option': name }, h(doc, 'legend', null, legend), items);
      return {
        field,
        inputs,
        get value() {
          const on = inputs.find((i) => i.checked);
          return on ? Number(on.value) : Number(inputs[0].value);
        },
        set value(v) {
          for (const i of inputs) i.checked = Number(i.value) === v;
          if (!inputs.some((i) => i.checked)) inputs[0].checked = true;
        },
      };
    }
    const sizeSeg = segmented('size', 'Size', GIF_SIZES, (v) => String(v), (v) => `${v} pixels`);
    const speedSeg = segmented('speed', 'Speed', GIF_SPEEDS, (v) => `${v}/s`, (v) => `${v} frames per second`);
    const captionBox = h(doc, 'input', { type: 'checkbox', 'data-option': 'captions' });
    const captionLabel = h(doc, 'label', { class: 'tbe-check' }, captionBox, 'Date and wavelength in the corner');
    sizeSeg.field.addEventListener('change', () => {
      prefs.size = sizeSeg.value;
    });
    speedSeg.field.addEventListener('change', () => {
      prefs.fps = speedSeg.value;
    });
    captionBox.addEventListener('change', () => {
      prefs.captions = captionBox.checked;
    });

    const count = h(doc, 'span', { class: 'tbe-count' });
    const btnGif = h(doc, 'button', { type: 'button', class: 'tbe-btn tbe-btn-main', 'data-action': 'gif', onclick: guard('The GIF could not be encoded', saveGif) }, 'Save movie as GIF');
    const support = videoSupport(globalThis);
    const btnVideo = h(doc, 'button', { type: 'button', class: 'tbe-btn', 'data-action': 'video', onclick: guard('The video could not be recorded', saveVideo) }, `Save movie as ${support.label || 'WebM'}`);
    const movieHint = h(doc, 'p', { class: 'tbe-hint', hidden: true });
    const bar = h(doc, 'progress', { class: 'tbe-bar', max: 1, value: 0, 'aria-label': 'Export progress' });
    const btnCancel = h(doc, 'button', {
      type: 'button',
      class: 'tbe-btn tbe-btn-small',
      'data-action': 'cancel',
      onclick: () => {
        try {
          cancelJob();
        } catch {
          // never throw from a handler
        }
      },
    }, 'Cancel');
    const progress = h(doc, 'div', { class: 'tbe-progress', hidden: true }, bar, btnCancel);

    const linkInput = h(doc, 'input', { type: 'text', class: 'tbe-link-input', readonly: true, 'aria-label': 'Link to this view', spellcheck: 'false' });
    linkInput.addEventListener('focus', () => {
      try {
        linkInput.select();
      } catch {
        // selection is a courtesy
      }
    });
    const btnCopy = h(doc, 'button', { type: 'button', class: 'tbe-btn', 'data-action': 'copy', onclick: guard('The link could not be copied', copyLink) }, 'Copy link');
    const btnCsv = h(doc, 'button', { type: 'button', class: 'tbe-btn', 'data-action': 'csv', onclick: guard('The source data could not be saved', saveCsv) }, 'Download source data', h(doc, 'span', { class: 'tbe-fmt' }, 'CSV'));
    const dataHint = h(doc, 'p', { class: 'tbe-hint' });

    const status = h(doc, 'p', { class: 'tbe-status', role: 'status', 'aria-live': 'polite' });

    const section = (title, extra, ...rows) =>
      h(doc, 'section', { class: 'tbe-sec' }, h(doc, 'h3', { class: 'tbe-sec-title' }, title, extra), ...rows);

    const root = h(
      doc,
      'div',
      { class: 'tbe' },
      h(doc, 'div', { class: 'tbe-head' }, thumb, h(doc, 'div', null, what, sub)),
      section('Image', null, h(doc, 'div', { class: 'tbe-row' }, btnPng, btnCard), imageHint),
      section(
        'Movie',
        count,
        h(doc, 'div', { class: 'tbe-opts' }, sizeSeg.field, speedSeg.field, captionLabel),
        h(doc, 'div', { class: 'tbe-row' }, btnGif, btnVideo),
        movieHint,
        progress,
      ),
      section('Link and data', null, h(doc, 'div', { class: 'tbe-link' }, linkInput, btnCopy), h(doc, 'div', { class: 'tbe-row' }, btnCsv, dataHint)),
      status,
    );
    container.append(root);

    sizeSeg.value = GIF_SIZES.includes(prefs.size) ? prefs.size : 384;
    captionBox.checked = prefs.captions !== false;

    let busy = null;
    let lastSpoken = 0;
    let speedChosen = false;

    function setDisabled(el, off) {
      el.disabled = !!off;
    }

    function refresh() {
      const snap = snapshot();
      const n = snap.frames.length;
      const t = snap.target;
      const cap = frameCaption(snap.current);
      what.textContent = (t && (t.name || formatCoords(t.ra, t.dec))) || 'No target yet';
      sub.textContent = [
        snap.view ? `${snap.view} view` : '',
        n ? `frame ${snap.index + 1} of ${n}` : '',
        cap.date,
        cap.wave,
      ].filter(Boolean).join(' · ') || 'Pick a target to have something to export.';

      // thumbnail of the current frame
      try {
        const ctx = thumb.getContext('2d');
        ctx.fillStyle = '#11110F';
        ctx.fillRect(0, 0, 64, 64);
        if (snap.current) {
          const { data, n: side } = renderNative(snap, snap.current);
          const image = ctx.createImageData(64, 64);
          image.data.set(upscaleNearest(data, side, 64));
          ctx.putImageData(image, 0, 0);
        }
      } catch {
        // the thumbnail is decoration
      }

      if (!speedChosen || !GIF_SPEEDS.includes(speedSeg.value)) {
        speedSeg.value = GIF_SPEEDS.includes(prefs.fps) ? prefs.fps : defaultFps(n);
        speedChosen = true;
      }
      count.textContent = n ? `${n} frame${n === 1 ? '' : 's'}` : '';

      const none = !snap.current;
      setDisabled(btnPng, busy || none);
      setDisabled(btnCard, busy || none);
      imageHint.hidden = !none;
      imageHint.textContent = none ? 'No frame is loaded yet.' : '';

      setDisabled(btnGif, busy || !n);
      setDisabled(btnVideo, busy || !n || !support.supported);
      for (const input of [...sizeSeg.inputs, ...speedSeg.inputs, captionBox]) setDisabled(input, busy || !n);
      const hints = [];
      if (!n) hints.push('No movie is loaded yet.');
      else if (!support.supported) hints.push(`${support.reason} The GIF works everywhere.`);
      movieHint.hidden = !hints.length;
      movieHint.textContent = hints.join(' ');

      if (doc.activeElement !== linkInput) linkInput.value = snap.link;
      setDisabled(btnCopy, busy || !snap.link);
      linkInput.placeholder = snap.link ? '' : 'This page has no address to share';

      const sel = snap.selection;
      const rows = sel ? spectrumRowCount(sel.spectrum) : 0;
      setDisabled(btnCsv, busy || !rows);
      dataHint.textContent = rows
        ? `${rows} measurement${rows === 1 ? '' : 's'} of the source at ${formatCoords(sel.ra, sel.dec) || 'the clicked position'}.`
        : 'Click a source in the image to measure it; its spectrum can then be saved here.';
    }

    let lastKind = null;
    function setBusy(kind) {
      // Cancel is about to be hidden: note whether it holds the focus before that happens.
      const hadFocus = doc.activeElement === btnCancel;
      busy = kind || null;
      progress.hidden = !busy;
      if (busy) {
        lastKind = busy;
        bar.value = 0;
        lastSpoken = 0;
      }
      refresh();
      try {
        // Keyboard users land on Cancel while a job runs and back on the button that started it.
        if (busy) btnCancel.focus({ preventScroll: true });
        else if (hadFocus) (lastKind === 'video' ? btnVideo : btnGif).focus({ preventScroll: true });
      } catch {
        // focus is a courtesy
      }
    }

    /** The bar moves every frame; the spoken line is refreshed at most every 1.5 s. */
    function setProgress(fraction, text) {
      bar.value = Math.min(1, Math.max(0, fraction));
      const t = nowMs();
      if (text && (t - lastSpoken > 1500 || fraction >= 1 || lastSpoken === 0)) {
        lastSpoken = t;
        setStatus('info', [text]);
      }
    }

    function setStatus(kind, parts) {
      status.className = `tbe-status${kind === 'ok' ? ' is-ok' : kind === 'error' ? ' is-error' : ''}`;
      status.replaceChildren(...parts.filter((p) => p !== '' && p !== null && p !== undefined).map((p) => (p.nodeType ? p : doc.createTextNode(String(p)))));
    }

    function options() {
      return { size: sizeSeg.value, fps: speedSeg.value, captions: captionBox.checked };
    }

    refresh();
    return { root, refresh, setBusy, setProgress, setStatus, options, linkInput };
  }

  // ---- open / close --------------------------------------------------------------------------
  let tool = null;

  function onClosed() {
    const was = modal;
    modal = null;
    cancelJob();
    if (was) {
      for (const off of was.offs) {
        try {
          off();
        } catch {
          // already gone
        }
      }
      if (was.timer) clearTimeout(was.timer);
      if (was.resumePlay) call(() => app.play());
    }
    revokeLater(liveUrls, 15000);
    liveUrls = [];
    if (tool && typeof tool.setActive === 'function') call(() => tool.setActive(false));
  }

  function open() {
    if (disposed || modal) return;
    let ui = null;
    const spec = {
      title: 'Export',
      render: (container) => {
        ui = buildUi(container);
      },
      onClose: onClosed,
    };
    // "This frame" should not change while the dialog is open.
    const wasPlaying = !!(call(() => app.movie(), null) || {}).playing;
    if (wasPlaying) call(() => app.pause());

    let handle = null;
    if (typeof app.openModal === 'function') {
      try {
        handle = app.openModal(spec) || null;
      } catch (err) {
        console.warn('[tombaugh] export: app.openModal failed, using the built-in dialog', err);
        handle = null;
      }
      if (handle && !ui) {
        call(() => handle.close());
        handle = null;
      }
    }
    if (!handle) {
      ui = null;
      handle = openFallbackDialog(doc, spec);
    }
    if (!ui) {
      call(() => handle.close());
      if (wasPlaying) call(() => app.play());
      return;
    }
    modal = { handle, ui, offs: [], timer: null, resumePlay: wasPlaying };
    const mine = modal;
    const refreshSoon = () => {
      if (modal !== mine || mine.timer) return;
      mine.timer = setTimeout(() => {
        mine.timer = null;
        if (modal !== mine) return;
        try {
          mine.ui.refresh();
        } catch (err) {
          console.warn('[tombaugh] export: refresh failed', err);
        }
      }, 60);
    };
    if (typeof app.on === 'function') {
      for (const event of EVENTS) {
        const off = call(() => app.on(event, refreshSoon), null);
        if (typeof off === 'function') mine.offs.push(off);
      }
    }
    if (tool && typeof tool.setActive === 'function') call(() => tool.setActive(true));
  }

  function close() {
    if (!modal) return;
    const handle = modal.handle;
    call(() => handle.close());
    if (modal && modal.handle === handle) onClosed(); // a shell modal that did not call onClose
  }

  if (typeof app.addTool === 'function') {
    try {
      tool = app.addTool({
        id: 'export',
        label: 'Export',
        title: 'Export: save this frame, the movie, a share card, a link or the source data',
        group: 'export',
        onClick: () => {
          try {
            if (modal) close();
            else open();
          } catch (err) {
            console.warn('[tombaugh] export: could not open', err);
          }
        },
      }) || null;
    } catch (err) {
      console.warn('[tombaugh] export: no tool button', err);
      tool = null;
    }
  }

  return {
    open,
    close,
    dispose() {
      if (disposed) return;
      close();
      disposed = true;
      if (tool && typeof tool.remove === 'function') call(() => tool.remove());
      tool = null;
      const style = doc.getElementById(EXPORT_STYLE_ID);
      if (style) style.remove();
    },
  };
}
