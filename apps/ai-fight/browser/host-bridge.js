export async function hostRequest(action, args) {
  if (parent === window) throw new Error('MCP sessions must be opened inside the signed-in Batchly host page.');
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Batchly account bridge is unavailable. Local play remains available without a session link.')), 10000);
    function finish(error, result) {
      clearTimeout(timer);
      removeEventListener('message', receive);
      if (error) reject(error); else resolve(result);
    }
    function receive(event) {
      if (event.source !== parent || !['https://batch-ly.com', 'https://www.batch-ly.com'].includes(event.origin)) return;
      if (event.data?.type !== 'ai-fight-response' || event.data.requestId !== requestId) return;
      const result = event.data.result;
      if (!result?.ok) finish(new Error(result?.error || 'Account session request failed'));
      else finish(null, result.session);
    }
    addEventListener('message', receive);
    // No credentials cross this channel; the authenticated parent owns the fetch.
    parent.postMessage({ type: 'ai-fight-request', requestId, action, args }, '*');
  });
}
