const DASHBOARD_API = '/api/domain/invage/dashboard';
const WATCHLIST_API = '/api/domain/invage/watchlist';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n, ccy) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error('money(): amount must be a finite number.');
  }
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = n < 0 ? '−' : '';
  if (ccy && ccy !== 'USD') return `${sign}${abs} ${ccy}`;
  return `${sign}$${abs}`;
}

function signedMoney(n, ccy) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error('signedMoney(): amount must be a finite number.');
  }
  const body = money(Math.abs(n), ccy);
  if (n > 0) return `+${body}`;
  if (n < 0) return `−${body.replace('−', '')}`;
  return body;
}

function dteDays(expiry) {
  if (typeof expiry !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    throw new Error(`Option expiry must be YYYY-MM-DD, got "${expiry}"`);
  }
  const t = Date.parse(`${expiry}T00:00:00Z`);
  const now = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.round((t - now) / 86400000);
}

function toneClass(n) {
  if (!(typeof n === 'number') || n === 0) return '';
  return n > 0 ? 'up' : 'down';
}

async function readJson(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const message = body && typeof body.message === 'string' ? body.message : text;
    throw new Error(message || `HTTP ${res.status}`);
  }
  return body;
}

async function loadDashboard() {
  const res = await fetch(DASHBOARD_API, { credentials: 'include' });
  return readJson(res);
}

async function loadWatchlist() {
  const res = await fetch(WATCHLIST_API, { credentials: 'include' });
  return readJson(res);
}

function liveSlice(payload) {
  if (!payload || payload.empty === true || !payload.model || !payload.model.live) {
    return null;
  }
  return payload.model.live;
}

function ccyOf(live) {
  if (live.reportingCurrency) return live.reportingCurrency;
  if (live.cashCurrency) return live.cashCurrency;
  return null;
}

function filterChannel(rows, channel) {
  if (channel === 'all') return rows;
  return rows.filter((r) => r.channel === channel);
}

function channelButtons(channels, selected, onClickAttr) {
  const ids = ['all', ...channels];
  return ids
    .map((id) => {
      const label = id === 'all' ? 'All platforms' : id === 'default' ? 'Unassigned' : id;
      const on = id === selected ? ' on' : '';
      return `<button type="button" class="chip-btn${on}" data-channel="${esc(id)}" ${onClickAttr}>${esc(label)}</button>`;
    })
    .join('');
}

function sectionHead(index, title, desc) {
  return `
    <div class="section-gap">
      <div class="label-eyebrow" style="color: var(--brand)">${esc(index)}</div>
      <h2><span class="bar" aria-hidden="true"></span>${esc(title)}</h2>
      ${desc ? `<p>${esc(desc)}</p>` : ''}
    </div>`;
}

function metricCard(label, value, sub, tone) {
  const t = tone === 'up' ? ' up' : tone === 'down' ? ' down' : '';
  return `
    <div class="metric-card">
      <div class="label-eyebrow">${esc(label)}</div>
      <div class="metric-value${t}">${esc(value)}</div>
      ${sub ? `<div class="metric-sub">${esc(sub)}</div>` : ''}
    </div>`;
}

function showError(node, message) {
  node.hidden = !message;
  node.textContent = message || '';
}
