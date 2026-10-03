const MAX_INPUT = 180 * 1024;
export const JOB_TIMEOUT_MS = 20000;
const FRAME_DOCUMENT = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><script>
let started = false;
addEventListener('message', event => {
  if (event.source !== parent || started || event.data.type !== 'start') return;
  started = true;
  const worker = new Worker(URL.createObjectURL(new Blob([event.data.source], {type:'text/javascript'})));
  worker.onmessage = event => {
    const data = event.data;
    worker.terminate();
    if (!data || typeof data !== 'object' || (data.text && (typeof data.text !== 'string' || data.text.length > 25165824))) {
      parent.postMessage({type:'result',ok:false,error:'Worker output refused'}, '*'); return;
    }
    parent.postMessage({type:'result',ok:data.ok === true,text:data.text,error:typeof data.error === 'string' ? data.error.slice(0,1000) : ''}, '*');
  };
  worker.onerror = () => {worker.terminate(); parent.postMessage({type:'result',ok:false,error:'Simulation Worker failed'}, '*');};
  worker.postMessage(event.data.job);
});
parent.postMessage({type:'runner-ready'}, '*');
<\/script>`;
let sourcePromise;
export async function runSimulation(job, { timeoutMs = JOB_TIMEOUT_MS, signal } = {}) {
  if (JSON.stringify(job).length > MAX_INPUT) throw new Error('Builds exceed 180 KiB browser limit');
  if (signal?.aborted) throw new Error('Simulation cancelled');
  sourcePromise ||= fetch(new URL('./engine-worker.js', import.meta.url)).then(response => {
    if (!response.ok) throw new Error('Engine bundle could not be loaded');
    return response.text();
  }).catch(error => { sourcePromise = null; throw error; });
  const source = await sourcePromise;
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeEventListener('message', receive);
      signal?.removeEventListener('abort', abort);
      // Removing the entire opaque frame also terminates its dedicated Worker.
      frame.remove();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new Error('Simulation cancelled'));
    const timer = setTimeout(() => finish(new Error('Simulation timed out. Its Worker was terminated.')), timeoutMs);
    const receive = event => {
      if (event.source !== frame.contentWindow || event.origin !== 'null') return;
      if (event.data?.type === 'runner-ready') frame.contentWindow.postMessage({ type: 'start', source, job }, '*');
      if (event.data?.type !== 'result') return;
      if (!event.data.ok) return finish(new Error(event.data.error || 'Simulation failed'));
      try {
        const parsed = JSON.parse(event.data.text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid result');
        // A brain can forge its Worker's output. Never turn that into a ranked or
        // server-verified result, including in local displays and exported replays.
        if (parsed.result && typeof parsed.result === 'object') parsed.result = { ...parsed.result, unranked: true, source: 'host-browser' };
        if (parsed.replay && typeof parsed.replay === 'object') parsed.replay = { ...parsed.replay, unranked: true, source: 'host-browser' };
        finish(null, parsed);
      } catch { finish(new Error('Invalid Worker result')); }
    };
    addEventListener('message', receive);
    signal?.addEventListener('abort', abort, { once: true });
    frame.srcdoc = FRAME_DOCUMENT;
    document.body.append(frame);
    if (signal?.aborted) abort();
  });
}
