import { calculateRisk } from './model.js';

const form = document.getElementById('calculator');
const output = document.getElementById('output');
const status = document.getElementById('status');
const error = document.getElementById('error');
let result = null;
const percentKeys = new Set(['iv', 'rate', 'dividendYield', 'spotShock', 'ivShock']);
const stringKeys = new Set(['right', 'side', 'style', 'symbol', 'currency']);
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

function invalidate() {
  result = null;
  output.hidden = true;
  error.hidden = true;
  status.textContent = 'Inputs changed. Calculate to see the updated index.';
}
form.addEventListener('input', invalidate);
form.addEventListener('change', invalidate);
document.getElementById('example').addEventListener('click', () => {
  invalidate();
  for (const [key, value] of Object.entries({ symbol: 'EXAMPLE', currency: 'USD', right: 'put', side: 'short', style: 'american', spot: 100, strike: 95, premium: 1.34, contracts: 1, multiplier: 100, days: 30, iv: 30, rate: 4, dividendYield: 0, equity: 25000, horizon: 5, spotShock: 30, ivShock: 20, exitCost: 2 }))
    form.elements.namedItem(key).value = String(value);
  status.textContent = 'Illustrative example loaded. These are not live quotes. Select Calculate index.';
});

form.addEventListener('submit', event => {
  event.preventDefault();
  invalidate();
  try {
    const input = {};
    for (const [key, value] of new FormData(form)) {
      if (!stringKeys.has(key) && !String(value).trim()) throw new Error(`Enter ${key}.`);
      input[key] = stringKeys.has(key) ? String(value).trim() : Number(value) / (percentKeys.has(key) ? 100 : 1);
    }
    result = calculateRisk(input);
    result.calculatedAt = new Date().toISOString();
    const money = value => `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${input.currency}`;
    const text = (id, value) => { document.getElementById(id).textContent = value; };
    text('score', `${result.index.toFixed(2)}%`);
    text('interpretation', `${input.symbol || 'Option'} · ${input.contracts} ${input.side} ${input.right} contract(s) · ${result.horizon} calendar-day horizon. Standalone option exposure.`);
    text('loss', money(result.stressLoss));
    text('worst', `Underlying ${pct(result.worst.spotShock)}; IV ${(result.worst.ivChange * 100).toFixed(1)} percentage points.`);
    text('maximum', result.unlimited ? 'Unbounded' : money(result.maximumLoss));
    const warnings = document.getElementById('warnings');
    warnings.replaceChildren();
    const note = (message, strong = false) => {
      const p = document.createElement('p');
      if (strong) { const b = document.createElement('strong'); b.textContent = message; p.append(b); }
      else p.textContent = message;
      warnings.append(p);
    };
    if (result.unlimited) note(`Uncovered short call: loss is unbounded. Delivery exposure is ${result.callDeliveryShares.toLocaleString()} shares. This calculator does not account for covering stock or margin.`, true);
    if (result.grossPutFunding !== null) note(`Gross short-put assignment obligation: ${money(result.grossPutFunding)}. Available cash is unknown; this is not a margin requirement or a loss estimate.`);
    if (input.side === 'long') note('The option premium can be lost in full. Exercising into stock creates additional exposure outside this calculation.');
    if (input.style === 'american') note('American pricing is a binomial approximation with continuous dividends. Discrete dividends and actual assignment timing can materially change results.');
    note(`Current theoretical premium: ${money(result.modelPrice)} per share; entered premium: ${money(input.premium)} per share.`);
    if (Math.abs(result.modelPrice - input.premium) / input.premium > .1) note('Quote/model mismatch exceeds 10%. Recheck price, IV, dividend yield and contract terms before interpreting this index.', true);
    if (result.index === 0) note('No loss in this grid does not establish that this position is safe.', true);
    note('Expected Shortfall: unavailable. No calibrated loss probabilities. Portfolio hedges, stressed liquidity costs and margin funding are not modeled.');
    const tbody = document.getElementById('scenarios');
    tbody.replaceChildren();
    for (const scenario of result.scenarios) {
      const tr = document.createElement('tr');
      for (const value of [pct(scenario.spotShock), (scenario.ivChange * 100).toFixed(1), money(scenario.price), money(scenario.pnl)]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      tr.lastChild.className = scenario.pnl < 0 ? 'negative' : 'positive';
      tbody.append(tr);
    }
    output.hidden = false;
    status.textContent = `Calculated from manual inputs · ${new Date(result.calculatedAt).toLocaleString()}.`;
  } catch (e) {
    result = null;
    error.textContent = e.message || 'Unable to calculate. Check the inputs.';
    error.hidden = false;
    status.textContent = 'Calculation unavailable.';
  }
});

document.getElementById('download').addEventListener('click', () => {
  if (!result) return;
  const data = { ...result, methodology: 'Worst loss in a 15-scenario price/IV grid divided by account equity. Not a probability or maximum-loss guarantee. ES unavailable; no calibrated probabilities. Manual prices; approximate vanilla option model; no portfolio offsets or broker margin model.' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'option-risk-calculation.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
