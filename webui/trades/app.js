const el = {
  error: document.getElementById('error'),
  eyebrow: document.getElementById('eyebrow'),
  hello: document.getElementById('hello'),
  filters: document.getElementById('filters'),
  table: document.getElementById('table'),
};

let dash = null;
let channel = 'all';
let right = 'all';
let ticker = 'all';
let strategy = 'all';
let journal = null;
let view = null;

function optionStrategy(p) {
  if (p.option.side !== 'short') return p.option.right === 'put' ? 'Long put' : 'Long call';
  return p.option.right === 'put' ? 'Short put' : 'Short call';
}

function optionRows(live) {
  return live.positions.filter((p) => p.instrument === 'option' && p.option);
}

function setViewChrome() {
  const journalBtn = document.getElementById('journal-view');
  const posBtn = document.getElementById('positions-view');
  document.getElementById('tradeDescription').textContent = view === 'positions'
    ? 'Every open option contract across your recorded broker positions. Expand a contract to review its recorded premium, mark, and assignment obligation.'
    : 'Individual option premiums and exact signed commissions. Times use the broker report’s clock. Totals cover imported executions only.';
  journalBtn.classList.toggle('on', view === 'journal');
  posBtn.classList.toggle('on', view === 'positions');
  const consultant = productProfileOf(dash) === 'consultant';
  if (el.hello) {
    if (view === 'journal') {
      el.hello.textContent = consultant ? 'Each trade, recorded separately.' : 'Option fills.';
    } else {
      const live = liveSlice(dash);
      el.hello.textContent =
        live && live.optionCount > 0
          ? consultant
            ? 'Every open contract, journaled.'
            : 'Open option lots.'
          : 'No option lots on the books.';
    }
  }
}

function pickDefaultView() {
  const live = liveSlice(dash);
  const optionCount = live ? live.optionCount : 0;
  const journalOk = journal && journal.available;
  if (productProfileOf(dash) === 'consultant') {
    return optionCount > 0 ? 'positions' : 'journal';
  }
  return journalOk ? 'journal' : 'positions';
}

function render() {
  showError(el.error, '');
  if (!view) view = pickDefaultView();
  setViewChrome();
  if (view === 'journal') { renderJournal(); return; }
  const live = liveSlice(dash);
  if (!live) {
    el.eyebrow.textContent = 'Open lots · 0 options';
    el.filters.innerHTML = '';
    el.table.innerHTML = emptyCard(dash && dash.message ? dash.message : 'No option lots on the books.');
    return;
  }
  const ccy = ccyOf(live);
  const all = optionRows(live);
  const channels = [...new Set(all.map((p) => p.channel))].sort();
  let rows = filterChannel(all, channel);
  if (ticker !== 'all') rows = rows.filter(p => positionSymbol(p.option.underlying || p.ticker) === ticker);
  if (strategy !== 'all') rows = rows.filter(p => optionStrategy(p) === strategy);
  if (right !== 'all') {
    rows = rows.filter((p) => p.option.right === right);
  }
  el.eyebrow.textContent = `Open lots · ${rows.length} option lots`;
  el.filters.innerHTML = `
    <span class="label-eyebrow">Strategy</span>
    ${['all', ...new Set(all.map(optionStrategy))].map(v => `<button type="button" class="chip-btn${strategy === v ? ' on' : ''}" data-strategy="${esc(v)}">${esc(v === 'all' ? 'All strategies' : v)}</button>`).join('')}
    <label class="label-eyebrow">Ticker <select id="tradeTicker"><option value="all">All tickers</option>${[...new Set(all.map(p => positionSymbol(p.option.underlying || p.ticker)))].sort().map(v => `<option value="${esc(v)}"${ticker === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <span class="label-eyebrow">Broker</span>
    ${channelButtons(channels, channel, 'data-tr-ch="1"')}
    <span class="label-eyebrow">Right</span>
    ${['all', 'put', 'call']
      .map((r) => {
        const on = r === right ? ' on' : '';
        const label = r === 'all' ? 'All rights' : r.toUpperCase();
        return `<button type="button" class="chip-btn${on}" data-right="${r}">${label}</button>`;
      })
      .join('')}
  `;
  el.filters.querySelectorAll('[data-tr-ch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      channel = btn.getAttribute('data-channel');
      writeChannelQuery(channel);
      render();
    });
  });
  el.filters.querySelectorAll('[data-right]').forEach((btn) => {
    btn.addEventListener('click', () => {
      right = btn.getAttribute('data-right');
      render();
    });
  });
  el.filters.querySelectorAll('[data-strategy]').forEach(btn => btn.addEventListener('click', () => {
    strategy = btn.dataset.strategy;
    render();
  }));
  document.getElementById('tradeTicker').addEventListener('change', event => {
    ticker = event.target.value;
    render();
  });
  const head = ['ID', 'Ticker', 'Strategy', 'Strike', 'Expiry', 'Contracts', 'Premium', 'Broker'];
  rows.sort((a, b) => a.option.expiry.localeCompare(b.option.expiry) || a.ticker.localeCompare(b.ticker));
  el.table.innerHTML = `<div class="metric-card table-card"><div class="table-scroll"><table class="report">
    <thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
    ${rows.length ? rows.map(p => {
      const o = p.option;
      const u = positionSymbol(o.underlying || p.ticker);
      const trade = dash.optionTradeDetails?.[p.ticker];
      const premium = o.side === 'short' ? trade?.stoGrossPremium ?? p.premiumAbsolute : null;
      return `<tr>
        <td><details><summary>${esc(`${u}-${o.right === 'put' ? 'P' : 'C'}${o.strike}-${o.expiry}`)}</summary>
          <div class="metric-sub">${esc(p.label)}<br>Recorded average premium / contract: ${money(p.avgCost, ccy)}<br>Mark / contract: ${money(p.price, ccy)}<br>Open P&amp;L: ${signedMoney(p.pl, ccy)}<br>If assigned: ${o.side !== 'short' ? '—' : o.right === 'put' ? (Number.isFinite(p.contingentCashObligation) ? money(p.contingentCashObligation, ccy) : '—') : `${p.contingentShareObligation ?? '—'} shares`}</div></details></td>
        <td><strong>${esc(u)}</strong></td><td>${esc(optionStrategy(p))}</td>
        <td class="num">${money(o.strike, p.currency || ccy)}</td><td>${esc(expiryLabel(o.expiry))}</td>
        <td class="num">${p.units.toLocaleString()}</td>
        <td class="num">${premium == null ? '—' : money(premium, trade?.currency || ccy)}<div class="metric-sub">${premium == null ? 'No short credit' : trade?.stoGrossPremium != null ? 'Recorded opening credit · before fees' : 'Recorded book premium'}</div></td>
        <td>${esc(channelLabel(p.channel))}</td></tr>`;
    }).join('') : `<tr><td colspan="8" class="empty">No open option lots for this filter.</td></tr>`}
    </tbody></table></div></div>`;
}

async function load() {
  try {
    const [j, d] = await Promise.all([
      readJson(await fetch('/api/domain/invage/trades', { credentials: 'include' })),
      loadDashboard().catch(() => ({ empty: true, model: null, message: 'No open positions.', productProfile: 'full' })),
    ]);
    journal = j;
    dash = d;
    const q = channelFromQuery();
    channel = q === 'merged' ? 'all' : q;
    if (!view) view = pickDefaultView();
    render();
  } catch (e) {
    showError(el.error, e instanceof Error ? e.message : String(e));
  }
}

function expiryLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid expiry date');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid expiry date');
  return `${value.slice(8)}-${date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase()}-${value.slice(0, 4)}`;
}

function renderJournal() {
  if (!journal) throw new Error('Execution journal has not loaded');
  el.eyebrow.textContent = `Journal · ${journal.executions.length} imported executions`;
  el.filters.innerHTML = '';
  if (!journal.available) {
    el.table.innerHTML = '<div class="metric-card empty">Execution history is unavailable. Import historical Activity Flex XML, or include Trades at Executions level in your IBKR Activity query and sync.</div>';
    return;
  }
  const channels = [...new Set(journal.executions.map(row => row.channel))].sort();
  el.filters.innerHTML = channelButtons(channels, channel, 'data-history-channel="1"');
  el.filters.querySelectorAll('[data-history-channel]').forEach(btn => btn.addEventListener('click', () => { channel = btn.getAttribute('data-channel'); writeChannelQuery(channel); render(); }));
  const rows = filterChannel(journal.executions, channel);
  const daily = filterChannel(journal.daily, channel);
  const heads = ['Date / time (broker)', 'Trade ID', 'Ticker / contract ID', 'Action', 'Strike', 'Expiry', 'Contracts', 'Gross premium', 'Commission (signed)', 'Net premium', 'Currency', 'Account / channel'];
  const cells = rows.map(row => [row.executed_at.replace('T', ' '), row.execution_id, `${row.underlying} ${row.right} · ${row.contract_id}`, `${row.side} to ${row.effect}`, row.strike, expiryLabel(row.expiry), row.contracts, row.gross_premium, row.commission, row.net_premium, row.currency, `${row.account_id} / ${row.channel}`]);
  const table = (headers, values) => `<div class="metric-card table-card"><div class="table-scroll"><table class="report"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${values.length ? values.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty">No executions for this selection.</td></tr>`}</tbody></table></div></div>`;
  el.table.innerHTML = table(heads, cells) + '<h2>Daily short-option net premium</h2><p>Sell to open plus buy to close, including signed commissions. Grouped by broker date, account and currency. This is premium cash flow, not realized P&amp;L.</p>' + table(['Date', 'Account', 'Channel', 'Currency', 'Net premium'], daily.map(row => [row.date, row.account_id, row.channel, row.currency, row.net_premium])) + '<details><summary>Cumulative short-option premium · imported history reference</summary>' + table(['Account', 'Channel', 'Currency', 'Net premium'], filterChannel(journal.cumulative, channel).map(row => [row.account_id, row.channel, row.currency, row.net_premium])) + '</details>';
}

document.getElementById('journal-view').addEventListener('click', () => {
  view = 'journal';
  document.getElementById('journal-view').classList.add('on');
  document.getElementById('positions-view').classList.remove('on');
  load();
});
document.getElementById('positions-view').addEventListener('click', async () => {
  try {
    dash = await loadDashboard();
    view = 'positions';
    document.getElementById('positions-view').classList.add('on');
    document.getElementById('journal-view').classList.remove('on');
    render();
  } catch (e) { showError(el.error, e instanceof Error ? e.message : String(e)); }
});
document.getElementById('history-file').addEventListener('change', async event => {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  input.disabled = true;
  document.getElementById('import-result').textContent = '';
  try {
    journal = await readJson(await fetch('/api/domain/invage/trades/import', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/xml' }, body: await file.text() }));
    view = 'journal';
    document.getElementById('journal-view').classList.add('on');
    document.getElementById('positions-view').classList.remove('on');
    render();
    document.getElementById('import-result').textContent = `Imported ${journal.added} new executions.`;
  } catch (e) { showError(el.error, e instanceof Error ? e.message : String(e)); }
  finally { input.disabled = false; input.value = ''; }
});

load();
