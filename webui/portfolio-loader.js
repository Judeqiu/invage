/* Same private snapshot/revalidation stream used by the dashboard. */
(() => {
  async function load({ onSnapshot, onProgress, signal, refresh = false } = {}) {
    const response = await fetch('/api/domain/invage/dashboard?progress=1&' + (refresh ? 'refresh=1' : 'preview=1'), {
      credentials: 'include', signal, headers: { Accept: 'text/event-stream' },
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'Your session has ended. Sign in again to view positions.' : 'Could not load your portfolio. Please retry.');
    if (!(response.headers.get('content-type') || '').includes('text/event-stream')) return response.json();
    if (!response.body) throw new Error('No portfolio data received. Please retry.');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', result;
    const consume = line => {
      if (!line.startsWith('data:')) return;
      let event;
      try { event = JSON.parse(line.slice(5)); } catch { throw new Error('Portfolio update was interrupted. Please retry.'); }
      if (event.type === 'snapshot' && !refresh) onSnapshot?.(event.payload);
      if (event.type === 'progress') onProgress?.(event);
      if (event.type === 'result') result = event.payload;
      if (event.type === 'error') throw new Error(event.message || 'Portfolio update failed. Please retry.');
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, newline).replace(/\r$/, '')); buffer = buffer.slice(newline + 1); }
        if (done) { if (buffer.trim()) consume(buffer); break; }
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
    if (!result || typeof result !== 'object') throw new Error('Loading stopped before positions were ready. Please retry.');
    return result;
  }
  globalThis.PortfolioLoader = Object.freeze({ load });
})();
