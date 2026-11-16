// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// card.js: the share card, a 1200 x 630 canvas (the size link previews use).
//
//   renderShareCard({ frameCanvasOrImage, title, coords, date, wave, note, url,
//                     kicker?, field?, doc? }) -> HTMLCanvasElement
//
// Left: the current frame, enlarged with nearest-neighbour so SPHEREx pixels stay crisp squares.
// Right: the object name (or its coordinates) in Arial Black, the coordinates, date and
// wavelength in Consolas, a one-line note, then the wordmark and the data credit.
// Brand colours only; no logos or insignia of any kind.
//
//   frameCanvasOrImage  a canvas, <img>, ImageBitmap, ImageData, or { data, n } from
//                       renderFrameRgba (anything else leaves an empty frame)
//   kicker              small line above the title, e.g. the view name (optional)
//   field               small line under the frame, e.g. "4 arcmin field" (optional)
//   doc                 the document to create canvases in (default: globalThis.document)

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

export const INK = '#171715';
export const PAPER = '#F7F2E7';
export const SIGNAL = '#E53C27';
export const STONE = '#77766E';
const PAPER_SOFT = 'rgba(247, 242, 231, 0.78)';
const RULE = 'rgba(247, 242, 231, 0.22)';

const FONT_HEAD = '-apple-system, BlinkMacSystemFont, Segoe UI Variable Display, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif';
const FONT_TEXT = '-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif';
const FONT_NUM = 'Consolas, "SFMono-Regular", Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace';

const clean = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

function setSpacing(ctx, value) {
  try {
    if ('letterSpacing' in ctx) ctx.letterSpacing = value;
  } catch {
    // older canvases have no letter spacing; the text is drawn without it
  }
}

/** Shorten `text` with an ellipsis until it fits `maxWidth` in the current font. */
export function fitEllipsis(ctx, text, maxWidth, where = 'end') {
  const s = clean(text);
  if (!s || ctx.measureText(s).width <= maxWidth) return s;
  const dots = '…';
  let lo = 0;
  let hi = s.length;
  const cut = (k) => {
    if (where === 'middle') {
      const head = Math.ceil(k * 0.6);
      return `${s.slice(0, head).trimEnd()}${dots}${s.slice(s.length - (k - head)).trimStart()}`;
    }
    return `${s.slice(0, k).trimEnd()}${dots}`;
  };
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(cut(mid)).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? cut(lo) : dots;
}

/** Greedy word wrap into at most `maxLines` lines; the last line is ellipsised if text is left. */
export function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = clean(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const tryLine = line ? `${line} ${words[i]}` : words[i];
    if (!line || ctx.measureText(tryLine).width <= maxWidth) {
      line = tryLine;
      continue;
    }
    if (lines.length === maxLines - 1) {
      lines.push(fitEllipsis(ctx, `${line} ${words.slice(i).join(' ')}`, maxWidth));
      return lines;
    }
    lines.push(line);
    line = words[i];
  }
  if (line) lines.push(ctx.measureText(line).width <= maxWidth ? line : fitEllipsis(ctx, line, maxWidth));
  return lines;
}

/** Largest font size (from `sizes`, big to small) at which the title fits in two lines. */
function fitTitle(ctx, title, maxWidth, sizes) {
  for (const size of sizes) {
    ctx.font = `900 ${size}px ${FONT_HEAD}`;
    const lines = wrapLines(ctx, title, maxWidth, 2);
    const whole = lines.join(' ').replace(/…$/, '') === clean(title);
    const fits = lines.every((l) => ctx.measureText(l).width <= maxWidth);
    if (whole && fits) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  ctx.font = `900 ${size}px ${FONT_HEAD}`;
  return { size, lines: wrapLines(ctx, title, maxWidth, 2) };
}

/** Turn whatever was given into something drawImage accepts, with its size. */
function toDrawable(source, doc) {
  if (!source) return null;
  try {
    if (source.data && (source.n || (source.width && source.height))) {
      const w = source.n || source.width;
      const h = source.n || source.height;
      if (source.data.length < w * h * 4) return null;
      const c = doc.createElement('canvas');
      c.width = w;
      c.height = h;
      const cx = c.getContext('2d');
      const img = cx.createImageData(w, h);
      img.data.set(source.data.subarray(0, w * h * 4));
      cx.putImageData(img, 0, 0);
      return { el: c, w, h };
    }
    const w = source.naturalWidth || source.videoWidth || source.width;
    const h = source.naturalHeight || source.videoHeight || source.height;
    if (w > 0 && h > 0) return { el: source, w, h };
  } catch {
    // fall through: draw the card without a frame
  }
  return null;
}

export function renderShareCard({
  frameCanvasOrImage = null,
  title = '',
  coords = '',
  date = '',
  wave = '',
  note = '',
  url = '',
  kicker = '',
  field = '',
  doc = null,
} = {}) {
  const d = doc || globalThis.document;
  const canvas = d.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // ---- frame ---------------------------------------------------------------------------------
  const box = { x: 40, y: 40, size: 550 };
  ctx.fillStyle = '#0E0E0D';
  ctx.fillRect(box.x, box.y, box.size, box.size);
  const src = toDrawable(frameCanvasOrImage, d);
  if (src) {
    const scale = Math.min(box.size / src.w, box.size / src.h);
    const w = Math.round(src.w * scale);
    const h = Math.round(src.h * scale);
    ctx.save();
    ctx.imageSmoothingEnabled = false; // crisp pixels
    try {
      ctx.drawImage(src.el, box.x + Math.round((box.size - w) / 2), box.y + Math.round((box.size - h) / 2), w, h);
    } catch {
      // a tainted or broken image: leave the frame empty rather than fail the card
    }
    ctx.restore();
  }
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x - 0.5, box.y - 0.5, box.size + 1, box.size + 1);

  // Orientation and field size, small, under the frame.
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `14px ${FONT_NUM}`;
  ctx.fillStyle = STONE;
  const under = [clean(field), 'north up, east left'].filter(Boolean).join('  ·  ');
  ctx.fillText(fitEllipsis(ctx, under, box.size), box.x, box.y + box.size + 24);

  // ---- text column ---------------------------------------------------------------------------
  const x = 640;
  const w = CARD_WIDTH - x - 48;
  let y = 46;

  ctx.fillStyle = SIGNAL;
  ctx.fillRect(x, y, 56, 6);
  y += 6;

  const kick = clean(kicker).toUpperCase();
  if (kick) {
    ctx.font = `15px ${FONT_NUM}`;
    ctx.fillStyle = PAPER_SOFT;
    setSpacing(ctx, '1.5px');
    ctx.fillText(fitEllipsis(ctx, kick, w), x, y + 34);
    setSpacing(ctx, '0px');
    y += 34;
  }

  const coordText = clean(coords);
  const head = clean(title) || coordText || 'Unnamed patch of sky';
  const headIsCoords = !clean(title) && !!coordText;
  const fitted = fitTitle(ctx, head, w, headIsCoords ? [44, 40, 36, 32, 28] : [68, 60, 52, 46, 40, 36, 32]);
  ctx.fillStyle = PAPER;
  ctx.font = `900 ${fitted.size}px ${FONT_HEAD}`;
  y += 22;
  for (const line of fitted.lines) {
    y += Math.round(fitted.size * 1.08);
    ctx.fillText(line, x, y);
  }

  if (coordText && !headIsCoords) {
    y += 40;
    ctx.font = `24px ${FONT_NUM}`;
    ctx.fillStyle = PAPER_SOFT;
    ctx.fillText(fitEllipsis(ctx, coordText, w), x, y);
  }

  // Date and wavelength: small label, value in Consolas.
  const rows = [
    ['DATE', clean(date)],
    ['WAVELENGTH', clean(wave)],
  ].filter((r) => r[1]);
  if (rows.length) {
    y += 30;
    ctx.fillStyle = RULE;
    ctx.fillRect(x, y, w, 1);
    for (const [label, value] of rows) {
      y += 30;
      ctx.font = `13px ${FONT_NUM}`;
      ctx.fillStyle = STONE;
      setSpacing(ctx, '1.5px');
      ctx.fillText(label, x, y);
      setSpacing(ctx, '0px');
      y += 30;
      ctx.font = `26px ${FONT_NUM}`;
      ctx.fillStyle = PAPER;
      ctx.fillText(fitEllipsis(ctx, value, w), x, y);
    }
  }

  // Footer block is anchored to the bottom; the note takes what is left above it.
  const footTop = CARD_HEIGHT - 132;
  const noteText = clean(note);
  if (noteText && y + 44 < footTop) {
    y += 44;
    ctx.font = `21px ${FONT_TEXT}`;
    ctx.fillStyle = PAPER_SOFT;
    ctx.fillText(fitEllipsis(ctx, noteText, w), x, y);
  }

  ctx.fillStyle = RULE;
  ctx.fillRect(x, footTop, w, 1);
  ctx.font = `900 38px ${FONT_HEAD}`;
  ctx.fillStyle = PAPER;
  setSpacing(ctx, '5px');
  ctx.fillText('TOMBAUGH', x, footTop + 52);
  setSpacing(ctx, '0px');
  ctx.font = `17px ${FONT_TEXT}`;
  ctx.fillStyle = STONE;
  ctx.fillText('Data: NASA SPHEREx via IRSA', x, footTop + 82);
  const link = clean(url).replace(/^https?:\/\//, '');
  if (link) {
    ctx.font = `14px ${FONT_NUM}`;
    ctx.fillStyle = PAPER_SOFT;
    // The whole link when it fits; otherwise where the tool lives, without the query.
    const short = ctx.measureText(link).width <= w ? link : link.split(/[?#]/)[0];
    ctx.fillText(fitEllipsis(ctx, short, w, 'middle'), x, footTop + 108);
  }
  return canvas;
}
