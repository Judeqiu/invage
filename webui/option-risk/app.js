const api = '/api/domain/invage/option-index';
const input = document.getElementById('contract'), lookup = document.getElementById('lookup');
const output = document.getElementById('output'), status = document.getElementById('status');
const error = document.getElementById('error'), run = document.getElementById('run');
let result = null, controller = null, requestId = 0;
const text = (id, value) => { document.getElementById(id).textContent = value; };
const money = value => `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
const node = (tag, value, className) => { const e = document.createElement(tag); e.textContent = value; if (className) e.className = className; return e; };

async function json(response) {
  let data;
  try { data = await response.json(); } catch { throw new Error('The lookup service returned an unreadable response.'); }
  if (!response.ok) throw new Error(data.error || 'Option index unavailable; no score was calculated.');
  return data;
}
async function initialize() {
  try {
    const capabilities = await json(await fetch(`${api}/capabilities`, { credentials: 'same-origin', cache: 'no-store' }));
    lookup.hidden = !capabilities.enabled;
    status.textContent = capabilities.enabled ? 'Enter an exact option contract to get its calculated index.' : 'This page is hidden in Management. Ask Velovest in chat for an option’s risk index.';
  } catch (e) { status.textContent = e.message; }
}
function clear() {
  requestId++; controller?.abort(); controller = null; result = null;
  output.hidden = true; error.hidden = true; run.disabled = false;
}
input.addEventListener('input', () => { clear(); status.textContent = 'Contract changed. Get its index to see an updated result.'; });
input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); calculate(); } });
run.addEventListener('click', calculate);
async function calculate() {
  clear();
  const contract = input.value.trim();
  if (!contract) { error.textContent = 'Enter an exact option contract.'; error.hidden = false; return; }
  const id = requestId; controller = new AbortController(); run.disabled = true;
  status.textContent = 'Fetching contract, price, volatility, dividends and interest rate…';
  try {
    const data = await json(await fetch(api, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contract }) }));
    if (id !== requestId) return;
    result = data;
    render(data);
    status.textContent = 'Risk index calculated from fetched market inputs.';
  } catch (e) {
    if (id !== requestId || e.name === 'AbortError') return;
    error.textContent = e.message; error.hidden = false;
    status.textContent = 'No index was calculated. No manual inputs or invented prices were substituted.';
  } finally { if (id === requestId) run.disabled = false; }
}
function render(data) {
  text('identity', `${data.contract.underlying} · ${data.contract.expiry} · ${data.contract.strike} ${data.contract.right}`);
  text('generated', `${data.contract.symbol} · Calculated ${new Date(data.generatedAt).toLocaleString()}`);
  const scores = document.getElementById('scores'); scores.replaceChildren();
  for (const score of data.scores) {
    const card = node('article', '', 'panel score-card');
    card.append(node('div', score.side === 'long' ? 'Buyer / long option' : 'Seller / short option', 'label-eyebrow'), node('div', `${score.index.toFixed(2)}%`, 'score'),
      node('p', 'of underlying notional', 'hint'), node('p', `Worst grid loss: ${money(score.stressLoss)} per contract.`),
      node('p', `Expiry maximum loss: ${score.unboundedLoss ? 'UNBOUNDED' : money(score.maximumLoss)}.`, score.unboundedLoss ? 'unbounded' : 'hint'));
    if (score.unboundedLoss) card.append(node('p', 'Uncovered call loss has no finite cap. The index does not bound it.', 'unbounded'));
    if (score.grossPutFunding !== null) card.append(node('p', `Gross put-assignment cash: ${money(score.grossPutFunding)}. Not a margin estimate.`, 'hint'));
    scores.append(card);
  }
  const warnings = document.getElementById('warnings'); warnings.replaceChildren();
  for (const warning of data.warnings) warnings.append(node('p', warning));
  const m = data.market, evidence = document.getElementById('evidence'); evidence.replaceChildren();
  for (const [label, value] of [['Underlying price', money(m.spot)], ['Option last trade / share', money(m.premiumPerShare)],
    ['Implied volatility', `${(m.impliedVolatility * 100).toFixed(2)}%`], ['Option last trade time', m.optionAsOf], ['Underlying quote time', m.spotAsOf],
    ['IV observation time', 'Unavailable; chain fetch time does not establish IV freshness'], ['Source', m.source], ['Interest rate', m.rateReference], ['Dividend proxy', m.dividendReference],
    ['Index denominator', `${money(data.normalization.denominator)} of underlying notional`]]) evidence.append(node('dt', label), node('dd', value));
  text('assumptions', `${data.assumptions.horizonCalendarDays.toFixed(2)} calendar-day effective horizon. ${data.assumptions.pricing}. Estimated exit cost ${money(data.assumptions.estimatedExitCost)} per contract. ${data.assumptions.costReference}`);
  const head = document.getElementById('scenarioHead'), tbody = document.getElementById('scenarios'); head.replaceChildren(); tbody.replaceChildren();
  const hr = document.createElement('tr');
  for (const label of ['Underlying move', 'IV change (pp)', ...data.scores.map(s => `${s.side === 'long' ? 'Buyer' : 'Seller'} P/L`)]) hr.append(node('th', label));
  head.append(hr);
  data.scores[0].scenarios.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.append(node('td', `${(s.spotShock * 100).toFixed(0)}%`), node('td', (s.ivChange * 100).toFixed(1)));
    for (const score of data.scores) { const pnl = score.scenarios[i].pnl; tr.append(node('td', money(pnl), pnl < 0 ? 'negative' : 'positive')); }
    tbody.append(tr);
  });
  output.hidden = false;
}
document.getElementById('download').addEventListener('click', () => {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'option-risk-index.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
initialize();
