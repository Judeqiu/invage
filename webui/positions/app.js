const el = {
  error: document.getElementById('error'),
  eyebrow: document.getElementById('eyebrow'),
  metrics: document.getElementById('metrics'),
  section1: document.getElementById('section1'),
  table1: document.getElementById('table1'),
  section2: document.getElementById('section2'),
  wlMeta: document.getElementById('wlMeta'),
  table2: document.getElementById('table2'),
};

let dash = null;
let watch = null;
let channel = 'all';

function equityRows(live) {
  return live.positions.filter((p) => p.instrument === 'equity' || p.instrument === 'fund');
}

function render() {
  showError(el.error, '');
  const live = liveSlice(dash);
  if (!live) {
    el.eyebrow.textContent = 'Equity book · empty';
    el.metrics.innerHTML = '';
    el.section1.innerHTML = '';
    el.table1.innerHTML = `<div class="metric-card empty">${esc(dash.message || 'No holdings yet.')}</div>`;
    el.section2.innerHTML = '';
    el.table2.innerHTML = '';
    renderWatch();
    return;
  }
  const ccy = ccyOf(live);
  const all = equityRows(live);
  const rows = filterChannel(all, channel);
  const marketValue = rows.reduce((s, p) => s + p.value, 0);
  const costValue = rows.reduce((s, p) => s + p.cost, 0);
  const unrealized = marketValue - costValue;
  const shares = rows.reduce((s, p) => s + p.units, 0);
  el.eyebrow.textContent = `Equity book · ${rows.length} holdings`;
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
  const channels = [...new Set(all.map((p) => p.channel))].sort();
  const head = ['Ticker', 'Instrument', 'Units', 'Avg cost', 'Total cost', 'Last', 'Market value', 'Unrealized P&L', 'Return', 'Channel'];
  el.table1.innerHTML = `
    <div class="metric-card table-card">
      <div class="filters" style="padding:0.75rem 1.1rem;border-bottom:1px solid var(--border)">
        <span class="label-eyebrow">Filter</span>
        ${channelButtons(channels, channel, 'data-pos-ch="1"')}
        <span class="metric-sub" style="margin-left:auto">${rows.length} of ${all.length} holdings</span>
      </div>
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
  el.table1.querySelectorAll('[data-pos-ch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      channel = btn.getAttribute('data-channel');
      render();
    });
  });
  renderWatch();
}

function renderWatch() {
  el.section2.innerHTML = sectionHead(
    'Section 02',
    'Watchlist · named products',
    'Playbook product names with live Yahoo quotes when available. Missing quotes are marked unavailable — prices are not invented.',
  );
  if (!watch) {
    el.wlMeta.innerHTML = '';
    el.table2.innerHTML = '<div class="metric-card empty">Watch List did not load. Positions above are still from the books.</div>';
    return;
  }
  const products = watch.products || [];
  const chips = [
    ...(watch.watchlists?.markets || []).map((m) => `market:${m}`),
    ...(watch.watchlists?.sectors || []).map((m) => `sector:${m}`),
    ...(watch.watchlists?.themes || []).map((m) => `theme:${m}`),
  ];
  el.wlMeta.innerHTML =
    chips.length === 0
      ? '<span class="metric-sub">No playbook market/sector/theme chips set.</span>'
      : chips.map((c) => `<span class="pill pill-muted">${esc(c)}</span>`).join('');
  const head = ['Symbol', 'Last', 'Change', 'Note', 'Added'];
  el.table2.innerHTML = `
    <div class="metric-card table-card">
      <div class="table-scroll">
        <table class="report">
          <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${
              products.length === 0
                ? `<tr><td colspan="${head.length}" class="empty">No named products on the Watch List.</td></tr>`
                : products
                    .map((p) => {
                      if (p.quoteError) {
                        return `<tr>
                          <td>${esc(p.symbol)}</td>
                          <td colspan="2" class="metric-sub">unavailable: ${esc(p.quoteError)}</td>
                          <td>${esc(p.note || '')}</td>
                          <td>${esc(p.added_at || '')}</td>
                        </tr>`;
                      }
                      const ch = p.changePct;
                      return `<tr>
                        <td>${esc(p.symbol)}</td>
                        <td class="num">${typeof p.price === 'number' ? money(p.price, p.currency) : ''}</td>
                        <td class="num ${toneClass(ch)}">${ch == null ? '' : `${ch >= 0 ? '+' : '−'}${Math.abs(ch).toFixed(2)}%`}</td>
                        <td>${esc(p.note || '')}</td>
                        <td>${esc(p.added_at || '')}</td>
                      </tr>`;
                    })
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </div>`;
}

async function load() {
  try {
    dash = await loadDashboard();
    try {
      watch = await loadWatchlist();
    } catch (e) {
      watch = null;
      showError(el.error, e instanceof Error ? e.message : String(e));
    }
    render();
  } catch (e) {
    showError(el.error, e instanceof Error ? e.message : String(e));
  }
}

load();
