// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// webm.js: record a movie drawn on a canvas with MediaRecorder (canvas.captureStream).
//
//   videoSupport(win?) -> { supported, mimeType, ext, label, reason }
//       Feature detection. `reason` says in plain words what is missing when unsupported.
//       WebM (VP9, then VP8) is preferred; a browser that can only record MP4 gets MP4.
//   recordCanvas(canvas, drawFrame, { frames, fps = 4, mimeType, loops = 1,
//                                     bitsPerSecond, signal, onProgress }) -> Promise<Blob>
//       Calls drawFrame(i, canvas) for i = 0..frames-1 (repeated `loops` times), holding each
//       frame for 1 / fps seconds while the recorder runs, and resolves with the recording.
//       Recording happens in real time: it takes frames * loops / fps seconds.
//       Rejects with an Error whose .code is 'unsupported', 'aborted' or 'failed'.
//       onProgress({ done, total }) is called after every frame; `signal` is an AbortSignal.
//
// MediaRecorder writes a live stream, so the file carries no total duration; players show it
// correctly but some cannot seek in it.

const CANDIDATES = [
  { mimeType: 'video/webm;codecs=vp9', ext: 'webm', label: 'WebM' },
  { mimeType: 'video/webm;codecs=vp8', ext: 'webm', label: 'WebM' },
  { mimeType: 'video/webm', ext: 'webm', label: 'WebM' },
  { mimeType: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', label: 'MP4' },
  { mimeType: 'video/mp4', ext: 'mp4', label: 'MP4' },
];

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** What this browser can record from a canvas, if anything. */
export function videoSupport(win = globalThis) {
  const none = (reason) => ({ supported: false, mimeType: '', ext: '', label: '', reason });
  try {
    const Recorder = win && win.MediaRecorder;
    if (typeof Recorder !== 'function') return none('This browser cannot record video (no MediaRecorder).');
    const proto = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
    if (!proto || typeof proto.captureStream !== 'function') return none('This browser cannot capture a canvas as video.');
    if (typeof Recorder.isTypeSupported !== 'function') return { supported: true, mimeType: '', ext: 'webm', label: 'WebM', reason: '' };
    for (const c of CANDIDATES) {
      if (Recorder.isTypeSupported(c.mimeType)) return { supported: true, ...c, reason: '' };
    }
    return none('This browser can record video, but not as WebM or MP4.');
  } catch (err) {
    return none(`Video recording is not available here (${err && err.message ? err.message : 'blocked'}).`);
  }
}

function extensionFor(mimeType) {
  return /mp4/i.test(mimeType || '') ? 'mp4' : 'webm';
}

export async function recordCanvas(canvas, drawFrame, { frames, fps = 4, mimeType = '', loops = 1, bitsPerSecond = 0, signal = null, onProgress = null } = {}) {
  const count = Math.floor(Number(frames));
  if (!(count > 0)) throw fail('failed', 'There are no frames to record.');
  if (typeof drawFrame !== 'function') throw fail('failed', 'recordCanvas needs a drawFrame function.');
  if (signal && signal.aborted) throw fail('aborted', 'Recording was cancelled.');
  const win = (canvas && canvas.ownerDocument && canvas.ownerDocument.defaultView) || globalThis;
  const support = videoSupport(win);
  if (!support.supported) throw fail('unsupported', support.reason);
  let type = mimeType || support.mimeType;
  try {
    if (mimeType && win.MediaRecorder.isTypeSupported && !win.MediaRecorder.isTypeSupported(mimeType)) type = support.mimeType;
  } catch {
    type = support.mimeType;
  }
  const rate = Number.isFinite(fps) && fps > 0 ? Math.min(60, fps) : 4;
  const interval = 1000 / rate;
  const passes = Math.max(1, Math.floor(Number(loops)) || 1);
  const total = count * passes;

  // Something must be on the canvas before the stream starts.
  drawFrame(0, canvas);

  let stream;
  let track = null;
  let manual = false;
  try {
    stream = canvas.captureStream(0); // 0 = capture only when asked
    track = stream.getVideoTracks()[0] || null;
    manual = !!(track && typeof track.requestFrame === 'function') || typeof stream.requestFrame === 'function';
    if (!manual) {
      for (const t of stream.getTracks()) t.stop();
      stream = canvas.captureStream(Math.max(rate * 2, 15));
      track = stream.getVideoTracks()[0] || null;
    }
  } catch (err) {
    throw fail('unsupported', `This browser could not capture the canvas (${err && err.message ? err.message : 'unknown error'}).`);
  }
  const requestFrame = () => {
    try {
      if (track && typeof track.requestFrame === 'function') track.requestFrame();
      else if (typeof stream.requestFrame === 'function') stream.requestFrame();
    } catch {
      // the next automatic capture will pick the frame up
    }
  };

  let recorder;
  try {
    const options = {};
    if (type) options.mimeType = type;
    options.videoBitsPerSecond = bitsPerSecond > 0 ? bitsPerSecond : Math.round(Math.min(12e6, Math.max(1.5e6, canvas.width * canvas.height * 10)));
    recorder = new win.MediaRecorder(stream, options);
  } catch (err) {
    for (const t of stream.getTracks()) t.stop();
    throw fail('unsupported', `This browser could not start a video recorder (${err && err.message ? err.message : 'unknown error'}).`);
  }

  const chunks = [];
  let recorderError = null;
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onerror = (e) => {
    recorderError = (e && e.error) || new Error('recorder error');
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve();
  });

  const sleepUntil = (when) =>
    new Promise((resolve) => {
      const wait = Math.max(0, when - win.performance.now());
      win.setTimeout(resolve, wait);
    });

  let aborted = false;
  try {
    recorder.start();
    const t0 = win.performance.now();
    for (let k = 0; k < total; k++) {
      if ((signal && signal.aborted) || recorderError) {
        aborted = !!(signal && signal.aborted);
        break;
      }
      drawFrame(k % count, canvas);
      requestFrame();
      await sleepUntil(t0 + (k + 1) * interval);
      if (onProgress) {
        try {
          onProgress({ done: k + 1, total });
        } catch {
          // a failing progress callback must not spoil the recording
        }
      }
    }
    // One more capture of the last frame so its full duration is in the file.
    if (!aborted && !recorderError) {
      requestFrame();
      await sleepUntil(win.performance.now() + Math.min(interval, 120));
    }
  } catch (err) {
    recorderError = recorderError || err;
  } finally {
    try {
      if (recorder.state !== 'inactive') recorder.stop();
      else recorder.onstop();
    } catch {
      recorder.onstop();
    }
    await stopped;
    for (const t of stream.getTracks()) {
      try {
        t.stop();
      } catch {
        // already stopped
      }
    }
  }
  if (aborted) throw fail('aborted', 'Recording was cancelled.');
  if (recorderError) throw fail('failed', `The video recorder stopped (${recorderError.message || recorderError}).`);
  const outType = recorder.mimeType || type || 'video/webm';
  const blob = new win.Blob(chunks, { type: outType.split(';')[0] });
  if (!blob.size) throw fail('failed', 'The video recorder produced no data.');
  blob.ext = extensionFor(outType);
  return blob;
}
