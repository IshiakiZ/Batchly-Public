// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests for frame.js: the stand-alone MovieFrame renderer, file names, CSV and link helpers.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderFrameRgba, upscaleNearest, frameSize, isDrawable, frameCaption, stretchUnit, divergingRgb,
  exportFileName, slug, coordSlug, spectrumCsv, spectrumRowCount, shareLink, formatCoords, formatBytes,
  dataUrlToBytes, defaultFps, mjdToText, MASK_RGB, MASK_RGB_LIGHT, CSV_HEADER,
} from './frame.js';

const px = (data, n, x, y) => [...data.subarray((y * n + x) * 4, (y * n + x) * 4 + 4)];

test('scalar frame: north up (row 0 of the array is drawn at the bottom), east stays left', () => {
  // 3 x 3, values rise with y (north) and with x.
  const image = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const { data, n } = renderFrameRgba({ image, range: [0, 8] }, { stretch: 'linear' });
  assert.equal(n, 3);
  assert.deepEqual(px(data, 3, 0, 2), [0, 0, 0, 255]); // array (0,0), south-west... drawn bottom-left
  assert.deepEqual(px(data, 3, 2, 0), [255, 255, 255, 255]); // array (2,2) drawn top-right
  assert.deepEqual(px(data, 3, 0, 0), [191, 191, 191, 255]); // array (0,2) = 6 -> 6/8
  assert.deepEqual(px(data, 3, 2, 2), [64, 64, 64, 255]); // array (2,0) = 2 -> 2/8
});

test('stretch: asinh by default, clamped to the range, monotonic', () => {
  const image = new Float32Array([-5, 0, 1, 2, 5, 10, 20, 1e9, 3]);
  const { data } = renderFrameRgba({ image, range: [0, 10] });
  const gray = (i) => data[((2 - Math.floor(i / 3)) * 3 + (i % 3)) * 4];
  assert.equal(gray(0), 0);
  assert.equal(gray(1), 0);
  assert.equal(gray(5), 255);
  assert.equal(gray(6), 255);
  assert.equal(gray(7), 255);
  assert.ok(gray(2) > 25, 'asinh lifts faint pixels above linear (10 percent -> more than 10 percent gray)');
  assert.ok(gray(2) < gray(3) && gray(3) < gray(8) && gray(8) < gray(4));
  assert.equal(gray(2), Math.round(255 * (Math.asinh(1) / Math.asinh(10))));
  for (const mode of ['linear', 'asinh', 'log', 'sqrt', 'nonsense']) {
    assert.equal(stretchUnit(0, mode), 0);
    assert.ok(Math.abs(stretchUnit(1, mode) - 1) < 1e-12);
    assert.equal(stretchUnit(NaN, mode), 0);
    assert.equal(stretchUnit(7, mode), stretchUnit(1, mode));
  }
});

test('masked and non-finite pixels get the flat dark colour, never a data colour', () => {
  const image = new Float32Array([1, NaN, Infinity, 2, 3, -Infinity, 4, 5, 6]);
  const mask = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 0]);
  const { data } = renderFrameRgba({ image, mask, range: [0, 6] });
  const at = (x, y) => px(data, 3, x, 2 - y); // array coordinates
  for (const [x, y] of [[1, 0], [2, 0], [0, 1], [2, 1]]) assert.deepEqual(at(x, y), [...MASK_RGB, 255]);
  assert.notDeepEqual(at(1, 1), [...MASK_RGB, 255]);
  for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255, 'opaque everywhere');
});

test('diverging frame: zero is near black, positive red, negative blue, symmetric and linear', () => {
  const image = new Float32Array([-4, -2, 0, 2, 4, 100, -100, 1, -1]);
  const { data } = renderFrameRgba({ image, range: [-1, 4], diverging: true }, { stretch: 'asinh' });
  const at = (i) => px(data, 3, i % 3, 2 - Math.floor(i / 3));
  assert.deepEqual(at(2).slice(0, 3), [8, 8, 9]);
  assert.deepEqual(at(4).slice(0, 3), divergingRgb(1));
  assert.deepEqual(at(0).slice(0, 3), divergingRgb(0));
  assert.deepEqual(at(5), at(4), 'clamped above');
  assert.deepEqual(at(6), at(0), 'clamped below');
  const pos = at(3);
  const neg = at(1);
  assert.ok(pos[0] > pos[2] + 60, 'positive is red');
  assert.ok(neg[2] > neg[0] + 60, 'negative is blue');
  // linear: +2 of 4 sits at t = 0.75
  assert.deepEqual(pos.slice(0, 3), divergingRgb(0.75));
  assert.deepEqual(neg.slice(0, 3), divergingRgb(0.25));
});

test('missing or broken range falls back to percentiles of the good pixels', () => {
  const image = new Float32Array(100);
  for (let i = 0; i < 100; i++) image[i] = i;
  for (const range of [undefined, null, [NaN, 1], [5, 5]]) {
    const { data } = renderFrameRgba({ image, range }, { stretch: 'linear' });
    assert.equal(data.length, 400);
    if (!range || Number.isNaN(range[0])) {
      assert.ok(data[(9 * 10 + 0) * 4] <= 2, 'lowest value is dark');
      assert.ok(data[(0 * 10 + 9) * 4] >= 253, 'highest value is bright');
    }
  }
  const flat = renderFrameRgba({ image: new Float32Array(16).fill(3) });
  assert.equal(flat.n, 4);
  const allBad = renderFrameRgba({ image: new Float32Array(4).fill(NaN) });
  assert.deepEqual(px(allBad.data, 2, 0, 0), [...MASK_RGB, 255]);
});

test('optional colormap function replaces gray; light maps get a light missing colour', () => {
  const image = new Float32Array([0, 1, NaN, 0.5]);
  const heat = (t) => [Math.round(255 * t), 0, Math.round(255 * (1 - t))];
  const { data } = renderFrameRgba({ image, range: [0, 1] }, { stretch: 'linear', colormap: heat });
  assert.deepEqual(px(data, 2, 0, 1), [0, 0, 255, 255]);
  assert.deepEqual(px(data, 2, 1, 1), [255, 0, 0, 255]);
  assert.deepEqual(px(data, 2, 0, 0), [...MASK_RGB, 255]);
  const inv = (t) => [255 - Math.round(255 * t), 255 - Math.round(255 * t), 255 - Math.round(255 * t)];
  const light = renderFrameRgba({ image, range: [0, 1] }, { stretch: 'linear', colormap: inv });
  assert.deepEqual(px(light.data, 2, 0, 0), [...MASK_RGB_LIGHT, 255]);
  const broken = renderFrameRgba({ image, range: [0, 1] }, { stretch: 'linear', colormap: () => { throw new Error('no'); } });
  assert.deepEqual(px(broken.data, 2, 1, 1), [255, 255, 255, 255]);
  // The colormap never applies to a two-sided frame.
  const div = renderFrameRgba({ image, range: [-1, 1], diverging: true }, { colormap: heat });
  assert.deepEqual(px(div.data, 2, 1, 1).slice(0, 3), divergingRgb(1));
});

test('colour frames: composed rgba is flipped north up; r, g, b planes are stretched per channel', () => {
  const rgba = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
  const a = renderFrameRgba({ rgba, image: new Float32Array(4) });
  assert.equal(a.n, 2);
  assert.deepEqual(px(a.data, 2, 0, 1), [1, 2, 3, 255]);
  assert.deepEqual(px(a.data, 2, 1, 0), [10, 11, 12, 255]);
  const masked = renderFrameRgba({ rgba, mask: new Uint8Array([1, 0, 0, 0]) });
  assert.deepEqual(px(masked.data, 2, 0, 1), [...MASK_RGB, 255]);

  const r = new Float32Array([0, 10, 5, NaN]);
  const g = new Float32Array([0, 0, 2, 1]);
  const b = new Float32Array([4, 4, 4, 4]);
  const out = renderFrameRgba({ rgb: { r, g, b, ranges: [[0, 10], [0, 2], [0, 8]] } }, { stretch: 'linear' });
  assert.deepEqual(px(out.data, 2, 0, 1), [0, 0, 128, 255]);
  assert.deepEqual(px(out.data, 2, 1, 1), [255, 0, 128, 255]);
  assert.deepEqual(px(out.data, 2, 0, 0), [128, 255, 128, 255]);
  assert.deepEqual(px(out.data, 2, 1, 0), [...MASK_RGB, 255]);
  // No ranges: derived from the data, does not throw.
  assert.equal(renderFrameRgba({ rgb: { r, g, b } }).n, 2);
});

test('nothing drawable: a 1 x 1 dark image, never a throw', () => {
  for (const frame of [null, undefined, {}, { image: new Float32Array(0) }, { caption: {} }]) {
    const { data, n } = renderFrameRgba(frame);
    assert.equal(n, 1);
    assert.deepEqual([...data], [...MASK_RGB, 255]);
    assert.equal(isDrawable(frame), false);
  }
  assert.equal(frameSize({ image: new Float32Array(59 * 59) }), 59);
  assert.equal(frameSize({ rgba: new Uint8ClampedArray(78 * 78 * 4) }), 78);
  assert.equal(isDrawable({ image: new Float32Array(4) }), true);
});

test('renderFrameRgba reuses a matching output buffer and does not touch the frame', () => {
  const image = new Float32Array([1, 2, 3, 4]);
  const copy = image.slice();
  const out = new Uint8ClampedArray(16);
  const res = renderFrameRgba({ image, range: [1, 4] }, { out });
  assert.equal(res.data, out);
  assert.deepEqual(image, copy);
});

test('upscaleNearest: every output pixel is a copy of the right source pixel', () => {
  const n = 5;
  const src = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) src.set([i, 2 * i, 255 - i, 255], i * 4);
  for (const size of [5, 10, 13, 64, 3, 1]) {
    const out = upscaleNearest(src, n, size);
    assert.equal(out.length, size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sx = Math.min(n - 1, Math.floor(((x + 0.5) * n) / size));
        const sy = Math.min(n - 1, Math.floor(((y + 0.5) * n) / size));
        assert.deepEqual(px(out, size, x, y), px(src, n, sx, sy), `size ${size} at ${x},${y}`);
      }
    }
  }
  // Integer zoom: blocks of equal pixels.
  const out = upscaleNearest(src, n, 20);
  assert.deepEqual(px(out, 20, 3, 3), px(src, n, 0, 0));
  assert.deepEqual(px(out, 20, 4, 3), px(src, n, 1, 0));
  // An unaligned source view still works.
  const buf = new Uint8ClampedArray(n * n * 4 + 3);
  buf.set(src, 3);
  const odd = buf.subarray(3);
  assert.deepEqual([...upscaleNearest(odd, n, 10)], [...upscaleNearest(src, n, 10)]);
});

test('frameCaption: strings pass through, numbers are formatted, mjd fills a missing date', () => {
  assert.deepEqual(frameCaption({ caption: { title: ' Pass 2 ', date: '2025 Jun 12', wave: '1.63 to 2.41 um', note: 'x' } }), { title: 'Pass 2', date: '2025 Jun 12', wave: '1.63 to 2.41 um', note: 'x' });
  assert.deepEqual(frameCaption({ caption: { date: 61210.79311303, wave: 1.23456 } }), { title: '', date: '2026-06-19 19:02', wave: '1.235 µm', note: '' });
  assert.deepEqual(frameCaption({ mjd: 61210.79311303 }), { title: '', date: '2026-06-19', wave: '', note: '' });
  assert.deepEqual(frameCaption(null), { title: '', date: '', wave: '', note: '' });
  assert.deepEqual(frameCaption({ caption: { date: NaN, wave: NaN } }), { title: '', date: '', wave: '', note: '' });
  assert.equal(mjdToText(40587), '1970-01-01');
  assert.equal(mjdToText('x'), '');
});

test('file names: tombaugh_<name-or-coords>_<view>.<ext>', () => {
  assert.equal(exportFileName({ target: { name: "Barnard's Star", ra: 269.45, dec: 4.69 }, view: 'passes', ext: 'gif' }), 'tombaugh_barnards-star_passes.gif');
  assert.equal(exportFileName({ target: { name: '', ra: 269.452083, dec: 4.693391 }, view: 'residual', ext: 'gif' }), 'tombaugh_269.4521+4.6934_residual.gif');
  assert.equal(exportFileName({ target: { ra: 133.7951, dec: -7.2451 }, view: 'diff', ext: 'webm' }), 'tombaugh_133.7951-7.2451_diff.webm');
  assert.equal(exportFileName({ target: { name: 'WISE J085510.83−071442.5' }, view: 'lens', ext: 'png', suffix: 'f03' }), 'tombaugh_wise-j085510.83-071442.5_lens_f03.png');
  assert.equal(exportFileName({ target: null, view: '', ext: 'png' }), 'tombaugh_sky.png');
  assert.equal(exportFileName({ target: { name: '../../etc/passwd' }, view: 'a/b\\c', ext: 'p*ng' }), 'tombaugh_etc-passwd_a-b-c.p-ng');
  assert.equal(exportFileName(), 'tombaugh_sky.png');
  const long = exportFileName({ target: { name: 'x'.repeat(200) }, view: 'passes', ext: 'gif' });
  assert.ok(long.length <= 64, long);
  for (const name of ['Éta Carinæ', 'α Cen', '  ', '***', 'V* R Dor']) {
    const f = exportFileName({ target: { name, ra: 10, dec: -5 }, view: 'passes', ext: 'gif' });
    assert.match(f, /^tombaugh_[a-z0-9.+-]+_passes\.gif$/, `${name} -> ${f}`);
  }
  assert.equal(slug('Éta  Carinae!'), 'eta-carinae');
  assert.equal(coordSlug(1.5, 0), '1.5000+0.0000');
  assert.equal(coordSlug(NaN, 0), '');
});

test('spectrum CSV: header, one row per point, missing numbers empty, det filled from wavelength', () => {
  const points = [
    { wave: 1.2345000505447388, flux_uJy: 812.3399658203125, err_uJy: 14.25, mjd: 61210.79311303, det: 2, flagged: false, ok: true },
    { wave: 3.3, flux_uJy: -4.5, err_uJy: 20, mjd: 60850.5, flagged: true },
    { wave: 4.6, flux_uJy: NaN, err_uJy: undefined, mjd: null, det: 6 },
    { wave: NaN, flux_uJy: 1 },
    null,
    { wave: 0.8, flux_uJy: 1e-7, err_uJy: 123456.789, mjd: 60000, det: 1, flagged: 0 },
  ];
  const csv = spectrumCsv(points);
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines[0], 'wave_um,flux_uJy,err_uJy,mjd,det,flagged');
  assert.equal(lines[0], CSV_HEADER);
  assert.deepEqual(lines.slice(1), [
    '1.2345,812.34,14.25,61210.79311,2,0',
    '3.3,-4.5,20,60850.50000,4,1',
    '4.6,,,,6,0',
    '0.8,1e-7,123460,60000.00000,1,0',
  ]);
  assert.ok(csv.endsWith('\n'));
  assert.equal(spectrumRowCount(points), 4);
  for (const line of lines) assert.equal(line.split(',').length, 6);
  assert.equal(spectrumCsv(null), `${CSV_HEADER}\n`);
  assert.equal(spectrumCsv([]), `${CSV_HEADER}\n`);
  // Detector edges
  const dets = spectrumCsv([0.9, 1.3, 2.0, 3.0, 4.2, 4.8].map((wave) => ({ wave }))).trim().split('\n').slice(1).map((l) => l.split(',')[4]);
  assert.deepEqual(dets, ['1', '2', '3', '4', '5', '6']);
});

test('share link: state wins over a stale address, defaults are left out, frame index is t', () => {
  assert.equal(shareLink('https://example.org/tombaugh/?ra=269.45&dec=4.69&view=residual', null, 3), 'https://example.org/tombaugh/?ra=269.45&dec=4.69&view=residual&t=3');
  assert.equal(shareLink('https://example.org/?ra=1&dec=2&t=5#frag', {}, 0), 'https://example.org/?ra=1&dec=2');
  assert.equal(shareLink('https://example.org/?ra=1&dec=2&t=5', {}, null), 'https://example.org/?ra=1&dec=2&t=5');
  const state = { ra: 269.4520833, dec: 4.6933911, name: "Barnard's Star", fov: 4, det: 3, view: 'residual', ch: 8, lens: 'methane', dist: Infinity, stretch: 'asinh', gaia: true, flags: true, junk: 'x', colormap: 'heat' };
  const filled = new URL(shareLink('http://localhost:8787/?api=/api&view=passes&det=5&dist=40', state, 2));
  assert.equal(filled.searchParams.get('ra'), '269.45208');
  assert.equal(filled.searchParams.get('dec'), '4.69339');
  assert.equal(filled.searchParams.get('name'), "Barnard's Star");
  assert.equal(filled.searchParams.get('view'), 'residual', 'state wins over the address');
  assert.equal(filled.searchParams.get('flags'), '1');
  assert.equal(filled.searchParams.get('t'), '2');
  assert.equal(filled.searchParams.get('api'), '/api', 'unknown parameters are kept');
  for (const gone of ['fov', 'det', 'ch', 'lens', 'dist', 'stretch', 'gaia', 'junk', 'colormap']) assert.equal(filled.searchParams.has(gone), false, `${gone} is a default or not URL state`);
  // Non-default values are written.
  const other = new URL(shareLink('https://x.test/', { ra: 10, dec: -5.5, fov: 10, det: 6, view: 'distance', dist: 550, gaia: false, stretch: 'log' }, 0));
  assert.equal(other.search, '?ra=10&dec=-5.5&fov=10&det=6&view=distance&dist=550&stretch=log&gaia=0');
  // Keys the state does not have stay as the address has them.
  assert.equal(new URL(shareLink('https://x.test/?view=diff&embed=1', { ra: 1, dec: 2 })).search, '?view=diff&embed=1&ra=1&dec=2');
  for (const bad of ['about:srcdoc', 'blob:null/abc', 'not a url', '', null, 'file:///tmp/x.html']) assert.equal(shareLink(bad, { ra: 1, dec: 2 }), '');
});

test('small formatters', () => {
  assert.equal(formatCoords(269.452083, 4.693391), 'RA 269.4521°  Dec +4.6934°');
  assert.equal(formatCoords(133.7951, -7.2451), 'RA 133.7951°  Dec −7.2451°');
  assert.equal(formatCoords(NaN, 1), '');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(212345), '212 kB');
  assert.equal(formatBytes(2123456), '2.12 MB');
  assert.equal(formatBytes(21234567), '21.2 MB');
  assert.equal(formatBytes(-1), '');
  assert.equal(defaultFps(2), 2);
  assert.equal(defaultFps(6), 2);
  assert.equal(defaultFps(8), 4);
  assert.equal(defaultFps(84), 8);
  assert.equal(defaultFps(undefined), 2);
});

test('dataUrlToBytes: base64 and plain data URLs, null for anything else', () => {
  const png = dataUrlToBytes('data:image/png;base64,iVBORw0KGgo=');
  assert.equal(png.type, 'image/png');
  assert.deepEqual([...png.bytes], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const txt = dataUrlToBytes('data:text/plain,a%20b');
  assert.equal(new TextDecoder().decode(txt.bytes), 'a b');
  for (const bad of ['', null, 'https://x', 'data:image/png;base64,***']) assert.equal(dataUrlToBytes(bad), null);
});
