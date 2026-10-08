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
let journal = null;
let view = null;

function optionRows(live) {
  return live.positions.filter((p) => p.instrument === 'option' && p.option);
}

function setViewChrome() {
  const journalBtn = document.getElementById('journal-view');
  const posBtn = document.getElementById('positions-view');
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
  if (right !== 'all') {
    rows = rows.filter((p) => p.option.right === right);
  }
  el.eyebrow.textContent = `Open lots · ${rows.length} option lots`;
  el.filters.innerHTML = `
    <span class="label-eyebrow">Channel</span>
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
  const head = ['Ticker', 'Right', 'Side', 'Strike', 'Expiry', 'DTE', 'Contracts', 'Avg premium / contract', 'Mark / contract', 'P&L', 'Mark / premium received', 'If assigned', 'Channel'];
  const prices = (dash && dash.equityPrices) || {};
  const groups = {};
  for (const p of rows) {
    const m = p.option.expiry.slice(0, 7);
    if (!groups[m]) groups[m] = [];
    groups[m].push(p);
  }
  const months = Object.keys(groups).sort();
  if (rows.length === 0) {
    el.table.innerHTML = `<div class="metric-card table-card"><div class="table-scroll"><table class="report">
      <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody><tr><td colspan="${head.length}" class="empty">No open option lots for this filter.</td></tr></tbody>
    </table></div></div>`;
    return;
  }
  el.table.innerHTML = months
    .map((m) => {
      const g = groups[m];
      const prem = g.reduce((s, p) => s + (p.option.side === 'short' ? Number(p.premiumAbsolute || 0) : 0), 0);
      const pl = g.reduce((s, p) => s + Number(p.pl || 0), 0);
      const cash = g.reduce((s, p) => s + Number(p.contingentCashObligation || 0), 0);
      const dtes = g.map((p) => dteDays(p.option.expiry));
      const earliest = Math.min(...dtes);
      const body = g
        .map((p) => {
          const o = p.option;
          const days = dteDays(o.expiry);
          const assigned = p.contingentCashObligation;
          const itm = optionItmState(p, prices);
          const rowClass =
            itm === 'itm' || days <= 7 ? 'risk-danger' : days <= 21 ? 'risk-warning' : '';
          const ratio = shortMarkOverPremium(p);
          const ifAsg =
            o.right === 'put'
              ? assigned
                ? money(assigned, ccy)
                : '—'
              : p.contingentShareObligation
                ? `${p.contingentShareObligation} sh`
                : '—';
          return `<tr class="${rowClass}">
            <td><strong>${esc(o.underlying || p.ticker)}</strong><div class="metric-sub">${esc(p.label)}</div></td>
            <td>${esc(o.right)}</td>
            <td>${esc(o.side)}</td>
            <td class="num">${money(o.strike, ccy)}</td>
            <td class="num">${esc(expiryLabel(o.expiry))}</td>
            <td class="num">${days}d</td>
            <td class="num">${p.units.toLocaleString()}</td>
            <td class="num">${money(p.avgCost, ccy)}</td>
            <td class="num">${money(p.price, ccy)}</td>
            <td class="num ${toneClass(p.pl)}">${signedMoney(p.pl, ccy)}</td>
            <td class="num">${formatMarkOverPremium(ratio)}</td>
            <td class="num">${ifAsg}</td>
            <td>${esc(p.channel === 'default' ? 'unassigned' : p.channel)}</td>
          </tr>`;
        })
        .join('');
      return `<div class="metric-card table-card" style="margin-bottom:1rem">
        <div class="filters" style="padding:0.75rem 1.1rem;border-bottom:1px solid var(--border)">
          <strong>${esc(m)}</strong>
          <span class="metric-sub">${g.length} lots · earliest DTE ${earliest}d · premium ${money(prem, ccy)} · P/L ${signedMoney(pl, ccy)} · if-assigned ${money(cash, ccy)}</span>
        </div>
        <div class="table-scroll"><table class="report">
          <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table></div>
      </div>`;
    })
    .join('');
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
