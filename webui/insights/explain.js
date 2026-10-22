/* Explicit, snapshot-scoped explanations in the same side-chat protocol as Dashboard. */
(() => {
  const descriptors = new WeakMap(), conversations = new Map(), requests = new Map(), selections = new Map();
  let active = null, trigger = null;
  const send = data => window.parent.postMessage(data, location.origin);
  const clean = node => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('button').forEach(n => n.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };
  function status(text, error = false) {
    const node = document.getElementById('insightsExplainStatus');
    node.textContent = text; node.classList.toggle('down', error);
  }
  function sync() {
    document.querySelectorAll('[data-insights-explain-button]').forEach(button => {
      const descriptor = descriptors.get(button);
      const record = conversations.get(selections.get(descriptor?.key));
      button.disabled = record?.pending === true;
      button.textContent = record?.pending ? 'Opening…' : 'Explain';
      button.setAttribute('aria-expanded', String(record?.requestId === active));
    });
  }
  const findButton = key => [...document.querySelectorAll('[data-insights-explain-button]')].find(b => descriptors.get(b)?.key === key);
  async function launch(descriptor, figure, retry) {
    const prompt = [
      `Explain the aggregated figure on my Insights page, "${descriptor.title}", in plain language.`,
      `Displayed figures: ${descriptor.figures.join('; ')}.`,
      `Selected figure to explain: ${figure}. Focus on this figure.`,
      `Selected Insights: ${descriptor.context}. Reporting currency: ${descriptor.ccy || 'unavailable'}.`,
      `Broker snapshot dates: ${JSON.stringify(descriptor.dates)}.`,
      descriptor.notes ? `Calculation notes: ${descriptor.notes}` : '',
      'Explain what the displayed figure means, how it is calculated, and which recorded components contribute to it. Reconcile it against my portfolio records where possible. Distinguish option lines from contract quantities, open P&L from realized returns, and probability of finishing ITM from early assignment. Explain missing history, quotes, currency conversion, fees, and date ranges where relevant. If a value is unavailable or cannot be reconciled, say why without inventing figures. Treat these displayed figures as a snapshot, which may differ from current data.',
    ].filter(Boolean).join('\n\n');
    let record = conversations.get(prompt);
    if (record?.pending) return;
    if (!record) {
      record = { requestId: crypto.randomUUID(), title: `Explain · ${descriptor.title}`, context: descriptor.context, descriptor, figure, prompt };
      conversations.set(prompt, record); requests.set(record.requestId, record);
    }
    selections.set(descriptor.key, prompt); active = record.requestId; trigger = findButton(descriptor.key);
    send({ type: 'utarus:chat-panel:open', requestId: record.requestId, title: record.title, context: record.context, ...(record.conversationId ? { conversationId: record.conversationId } : {}) });
    if (record.conversationId && !retry) { status(''); sync(); return; }
    record.pending = true; status('Starting your explanation…'); sync();
    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: record.prompt, composeSource: { kind: 'host_seed' } }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || body.error || 'Chat is unavailable.');
      if (typeof body.conversationId !== 'string' || !body.conversationId.trim()) throw new Error('The chat did not return a conversation.');
      record.conversationId = body.conversationId;
      send({ type: 'utarus:chat-panel:ready', requestId: record.requestId, conversationId: record.conversationId }); status('');
      if (window.parent === window) location.assign(`/?c=${encodeURIComponent(body.conversationId)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please try again.';
      send({ type: 'utarus:chat-panel:error', requestId: record.requestId, error: message });
      status(`Couldn't open the explanation. ${message}`, true);
    } finally { record.pending = false; sync(); }
  }
  function choose(button) {
    const descriptor = descriptors.get(button);
    if (!descriptor) return;
    if (descriptor.figures.length === 1) { void launch(descriptor, descriptor.figures[0]); return; }
    let dialog = document.getElementById('insightsExplainChoice');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'insightsExplainChoice'; dialog.className = 'insights-explain-choice';
      dialog.setAttribute('aria-labelledby', 'insightsExplainTitle');
      dialog.innerHTML = '<form method="dialog"><h2 id="insightsExplainTitle">Which number would you like explained?</h2><p>Choose a figure from this section.</p><label for="insightsExplainMetric">Insights figure</label><select id="insightsExplainMetric" required></select><div class="insights-explain-actions"><button value="cancel" class="chip-btn">Cancel</button><button value="explain" class="chip-btn on">Explain this number</button></div></form>';
      document.body.appendChild(dialog);
    }
    dialog.querySelector('select').replaceChildren(...descriptor.figures.map((text, i) => new Option(text, String(i))));
    dialog.onclose = () => {
      if (dialog.returnValue === 'explain') void launch(descriptor, descriptor.figures[Number(dialog.querySelector('select').value)]);
      if (button.isConnected) button.focus();
    };
    dialog.returnValue = 'cancel'; dialog.showModal();
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || !event.data) return;
    const record = requests.get(event.data.requestId);
    if (event.data.type === 'utarus:chat-panel:retry' && record && !record.conversationId) void launch(record.descriptor, record.figure, true);
    if (event.data.type === 'utarus:chat-panel:activated' && record) { selections.set(record.descriptor.key, record.prompt); active = record.requestId; trigger = findButton(record.descriptor.key); sync(); }
    if (event.data.type === 'utarus:chat-panel:closed') {
      const previous = requests.get(active); active = null; sync();
      const button = trigger?.isConnected ? trigger : findButton(previous?.descriptor.key); button?.focus({ preventScroll: true });
    }
  });
  function install({ payload, channel, ccy, notes = '' }) {
    const context = `${channel === 'all' || channel === 'merged' ? 'All brokers (merged)' : channel} · Snapshot ${payload?.generatedAt || 'date unavailable'}`;
    const dates = Object.fromEntries(Object.entries(payload?.brokerAsOf || {}).filter(([ch]) => channel === 'all' || channel === 'merged' || ch === channel));
    document.querySelectorAll('#metrics .metric-card, #statistics .metric-card, #edge .metric-card, #patterns .metric-card, #conc .metric-card, [data-explain-figures]').forEach(card => {
      const heading = card.querySelector('.label-eyebrow, h3');
      const title = card.dataset.explainTitle || (heading ? clean(heading) : 'Option book');
      const main = card.querySelector('.metric-value'), sub = card.querySelector('.metric-sub');
      const figures = card.hasAttribute('data-explain-figures') ? JSON.parse(card.dataset.explainFigures)
        : [main ? `${title} — ${clean(main)}` : '', sub && /[0-9]/.test(clean(sub)) ? `${title} · detail — ${clean(sub)}` : ''].filter(Boolean);
      if (!figures.length) return;
      const calculation = [notes, ...[...card.querySelectorAll('p')].map(clean), ...[...card.querySelectorAll('[data-help]')].map(n => n.dataset.help)].filter(Boolean).join(' ');
      const descriptor = { title, figures, context, dates, ccy, notes: calculation };
      descriptor.key = JSON.stringify(descriptor);
      let button = card.querySelector('[data-insights-explain-button]');
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'insights-explain'; button.dataset.insightsExplainButton = '';
        button.addEventListener('click', () => choose(button));
        if (card.tagName === 'TR') { card.cells[0].appendChild(button); button.classList.add('insights-explain-row'); }
        else { card.classList.add('insights-explain-card'); card.appendChild(button); }
      }
      button.setAttribute('aria-label', `Explain ${title}`); descriptors.set(button, descriptor);
    });
    sync();
  }
  globalThis.InsightsExplain = Object.freeze({ install });
})();
