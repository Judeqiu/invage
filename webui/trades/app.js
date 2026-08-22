const el = {
  error: document.getElementById('error'),
  eyebrow: document.getElementById('eyebrow'),
  filters: document.getElementById('filters'),
  table: document.getElementById('table'),
};

let dash = null;
let channel = 'all';
let right = 'all';

function optionRows(live) {
  return live.positions.filter((p) => p.instrument === 'option' && p.option);
}

function render() {
  showError(el.error, '');
  const live = liveSlice(dash);
  if (!live) {
    el.eyebrow.textContent = 'Journal · 0 options';
    el.filters.innerHTML = '';
    el.table.innerHTML = `<div class="metric-card empty">${esc(dash.message || 'No option lots on the books.')}</div>`;
    return;
  }
  const ccy = ccyOf(live);
  const all = optionRows(live);
  const channels = [...new Set(all.map((p) => p.channel))].sort();
  let rows = filterChannel(all, channel);
  if (right !== 'all') {
    rows = rows.filter((p) => p.option.right === right);
  }
  el.eyebrow.textContent = `Journal · ${rows.length} open option lots`;
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
      render();
    });
  });
  el.filters.querySelectorAll('[data-right]').forEach((btn) => {
    btn.addEventListener('click', () => {
      right = btn.getAttribute('data-right');
      render();
    });
  });
  const head = ['Ticker', 'Right', 'Side', 'Strike', 'Expiry', 'DTE', 'Contracts', 'Avg premium', 'Mark', 'P&L', 'If assigned', 'Channel'];
  el.table.innerHTML = `
    <div class="metric-card table-card">
      <div class="table-scroll">
        <table class="report">
          <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${
              rows.length === 0
                ? `<tr><td colspan="${head.length}" class="empty">No open option lots for this filter.</td></tr>`
                : rows
                    .map((p) => {
                      const o = p.option;
                      const days = dteDays(o.expiry);
                      const assigned = p.contingentCashObligation;
                      const rowClass =
                        assigned > 0 && days <= 21 ? 'risk-warning' : '';
                      return `<tr class="${rowClass}">
                        <td><strong>${esc(o.underlying || p.ticker)}</strong><div class="metric-sub">${esc(p.label)}</div></td>
                        <td>${esc(o.right)}</td>
                        <td>${esc(o.side)}</td>
                        <td class="num">${money(o.strike, ccy)}</td>
                        <td class="num">${esc(o.expiry)}</td>
                        <td class="num">${days}d</td>
                        <td class="num">${p.units.toLocaleString()}</td>
                        <td class="num">${money(p.avgCost, ccy)}</td>
                        <td class="num">${money(p.price, ccy)}</td>
                        <td class="num ${toneClass(p.pl)}">${signedMoney(p.pl, ccy)}</td>
                        <td class="num">${assigned ? money(assigned, ccy) : ''}</td>
                        <td>${esc(p.channel === 'default' ? 'unassigned' : p.channel)}</td>
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
    render();
  } catch (e) {
    showError(el.error, e instanceof Error ? e.message : String(e));
  }
}

load();
