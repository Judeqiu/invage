const el = {
  error: document.getElementById('error'),
  eyebrow: document.getElementById('eyebrow'),
  hello: document.getElementById('hello'),
  filters: document.getElementById('filters'),
  metrics: document.getElementById('metrics'),
  section1: document.getElementById('section1'),
  table1: document.getElementById('table1'),
  section2: document.getElementById('section2'),
  oblMetrics: document.getElementById('oblMetrics'),
  table2: document.getElementById('table2'),
};

let dash = null;
let channel = 'all';

function bindFilters(live) {
  if (!el.filters) return;
  const channels = [...(live && live.channels ? live.channels : [])];
  if (channels.length <= 1) {
    el.filters.innerHTML = '';
    return;
  }
  el.filters.innerHTML =
    `<span class="label-eyebrow">Broker</span>` + channelButtons(channels, channel, 'data-pos-top="1"');
  el.filters.querySelectorAll('[data-pos-top]').forEach((btn) => {
    btn.addEventListener('click', () => {
      channel = btn.getAttribute('data-channel');
      writeChannelQuery(channel);
      render();
    });
  });
}

function equityRows(live) {
  return live.positions.filter((p) => p.instrument === 'equity' || p.instrument === 'fund');
}

function render() {
  showError(el.error, '');
  const consultant = productProfileOf(dash) === 'consultant';
  if (el.hello) {
    el.hello.textContent = consultant
      ? 'Shares you own, and what you owe.'
      : 'Shares and funds you own.';
  }
  const raw = liveSlice(dash);
  bindFilters(raw);
  const live = sliceLive(raw, channel);
  if (!live) {
    el.eyebrow.textContent = 'Equity book · empty';
    el.metrics.innerHTML = '';
    el.section1.innerHTML = '';
    el.table1.innerHTML = emptyCard(dash.message || 'No holdings yet.');
    el.section2.innerHTML = '';
    el.oblMetrics.innerHTML = '';
    el.table2.innerHTML = '';
    return;
  }
  const ccy = ccyOf(live);
  const all = equityRows(live);
  const rows = all;
  const marketValue = rows.reduce((s, p) => s + p.value, 0);
  const costValue = rows.reduce((s, p) => s + p.cost, 0);
  const unrealized = marketValue - costValue;
  const shares = rows.reduce((s, p) => s + p.units, 0);
  el.eyebrow.textContent =
    channel === 'all'
      ? `Equity book · ${rows.length} holdings`
      : `${channelLabel(channel)} · ${rows.length} holdings`;
  el.metrics.innerHTML =
    metricCard('Market value', money(marketValue, ccy), 'Long equity and funds on this filter.') +
    metricCard('Cost basis', money(costValue, ccy), 'Book cost of those lots.') +
    metricCard(
      'Unrealized P&L',
      signedMoney(unrealized, ccy),
      null,
      unrealized > 0 ? 'up' : unrealized < 0 ? 'down' : undefined,
    ) +
    metricCard('Lots', String(rows.length), `${shares.toLocaleString()} units`);
  el.section1.innerHTML = sectionHead(
    'Section 01',
    'Long stock & fund positions',
    'Every equity and fund lot currently on the books. Options are on Trades. Channel filter uses recorded custody tags only.',
  );
  const head = ['Ticker', 'Instrument', 'Units', 'Avg cost', 'Total cost', 'Last', 'Market value', 'Unrealized P&L', 'Return', 'Channel'];
  el.table1.innerHTML = `
    <div class="metric-card table-card">
      <div class="table-scroll">
        <table class="report">
          <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${
              rows.length === 0
                ? `<tr><td colspan="${head.length}" class="empty">No long stock or fund lots on this channel.</td></tr>`
                : rows
                    .map((p) => {
                      const ret = p.cost !== 0 ? (p.pl / p.cost) * 100 : 0;
                      return `<tr>
                        <td><strong>${esc(p.ticker)}</strong><div class="metric-sub">${esc(p.label || '')}</div></td>
                        <td>${esc(p.instrument)}</td>
                        <td class="num">${p.units.toLocaleString()}</td>
                        <td class="num">${money(p.avgCost, ccy)}</td>
                        <td class="num">${money(p.cost, ccy)}</td>
                        <td class="num">${money(p.price, ccy)}</td>
                        <td class="num">${money(p.value, ccy)}</td>
                        <td class="num ${toneClass(p.pl)}">${signedMoney(p.pl, ccy)}</td>
                        <td class="num ${toneClass(ret)}">${ret >= 0 ? '+' : '−'}${Math.abs(ret).toFixed(1)}%</td>
                        <td>${esc(p.channel === 'default' ? 'unassigned' : p.channel)}</td>
                      </tr>`;
                    })
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </div>`;
  renderObligations(live, ccy);
}

function renderObligations(live, ccy) {
  const hasOptions = live.optionCount > 0;
  if (!hasOptions) {
    el.section2.innerHTML = '';
    el.oblMetrics.innerHTML = '';
    el.table2.innerHTML = '';
    return;
  }
  el.section2.innerHTML = sectionHead(
    'Section 02',
    'Assignment obligations',
    'If assigned: short puts become a cash bill; short calls become share delivery. Coverage uses long equity vs short-call deliverable shares. Cells stay blank when a leg is missing — never shown as 0%.',
  );
  const shorts = live.positions.filter((p) => p.instrument === 'option' && p.option && p.option.side === 'short');
  const cashIf = shorts
    .filter((p) => p.option.right === 'put')
    .reduce((s, p) => s + Number(p.contingentCashObligation || 0), 0);
  const sharesCall = shorts
    .filter((p) => p.option.right === 'call')
    .reduce((s, p) => s + Number(p.contingentShareObligation || 0), 0);
  const coverVsCash =
    live.cashAmount != null && cashIf > 0 ? `${((live.cashAmount / cashIf) * 100).toFixed(0)}%` : '—';
  el.oblMetrics.innerHTML =
    metricCard('Cash if all puts assigned', money(cashIf, ccy), 'Sum of contingentCashObligation') +
    metricCard('Shares callable', sharesCall.toLocaleString(), 'Short-call deliverable shares') +
    metricCard(
      'Coverage vs free cash',
      coverVsCash,
      live.cashAmount == null ? 'Cash not recorded' : 'Free cash / put assignment cash',
    ) +
    metricCard('Short lots', String(shorts.length), 'Calls and puts');

  if (shorts.length === 0) {
    el.table2.innerHTML = emptyCard('No short options — nothing to assign.');
    return;
  }

  const byU = {};
  for (const p of live.positions) {
    if (p.instrument === 'equity') {
      const u = p.ticker;
      if (!byU[u]) byU[u] = { long: 0, putCash: 0, callD: 0 };
      byU[u].long += p.units;
    } else if (p.instrument === 'option' && p.option && p.option.side === 'short') {
      const u = p.option.underlying || p.ticker;
      if (!byU[u]) byU[u] = { long: 0, putCash: 0, callD: 0 };
      if (p.option.right === 'put') byU[u].putCash += Number(p.contingentCashObligation || 0);
      if (p.option.right === 'call') byU[u].callD += Number(p.contingentShareObligation || 0);
    }
  }
  const keys = Object.keys(byU).filter((u) => byU[u].putCash > 0 || byU[u].callD > 0).sort();
  const head = ['Underlying', 'Long shares', 'Short-put cash', 'Short-call deliverable', 'Covered', 'Uncovered', 'Coverage'];
  el.table2.innerHTML = `
    <div class="metric-card table-card"><div class="table-scroll"><table class="report">
      <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>
        ${
          keys.length === 0
            ? `<tr><td colspan="${head.length}" class="empty">No short options — nothing to assign.</td></tr>`
            : keys
                .map((u) => {
                  const g = byU[u];
                  const cov = coverageForUnderlying(g.long, g.callD);
                  return `<tr>
                    <td><strong>${esc(u)}</strong></td>
                    <td class="num">${g.long ? g.long.toLocaleString() : '—'}</td>
                    <td class="num">${g.putCash ? money(g.putCash, ccy) : '—'}</td>
                    <td class="num">${g.callD ? g.callD.toLocaleString() : '—'}</td>
                    <td class="num">${cov ? cov.coveredShares.toLocaleString() : '—'}</td>
                    <td class="num">${cov ? cov.uncoveredShares.toLocaleString() : '—'}</td>
                    <td class="num">${cov ? `${(cov.coveragePct * 100).toFixed(0)}%` : '—'}</td>
                  </tr>`;
                })
                .join('')
        }
      </tbody>
    </table></div></div>`;
}

async function load() {
  try {
    dash = await loadDashboard();
    channel = channelFromQuery();
    if (channel === 'merged') channel = 'all';
    render();
  } catch (e) {
    showError(el.error, e instanceof Error ? e.message : String(e));
  }
}

load();
