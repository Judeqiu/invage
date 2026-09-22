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
  if (channel === 'all' || channel === 'merged') return rows;
  return rows.filter((r) => r.channel === channel);
}

function channelLabel(id) {
  if (id === 'all' || id === 'merged') return 'All platforms';
  if (id === 'default') return 'Unassigned';
  return id;
}

/** Filter a dashboard live slice to one broker channel. `all`/`merged` returns live as-is. */
function sliceLive(live, channel) {
  if (!live) return null;
  if (!channel || channel === 'all' || channel === 'merged') return live;
  const positions = (live.positions || []).filter((p) => p.channel === channel);
  const deposits = (live.deposits || []).filter((d) => d.channel === channel);
  const chRow = (live.byChannel || []).find((c) => c.channel === channel);
  let positionsValue = 0;
  let totalCost = 0;
  let equityValue = 0;
  let equityCost = 0;
  let optionsPremiumCollected = 0;
  let optionsPremiumPaid = 0;
  let contingentCashObligation = 0;
  let contingentShareObligation = 0;
  let optionCount = 0;
  let equityCount = 0;
  let fundCount = 0;
  for (const p of positions) {
    positionsValue += Number(p.value || 0);
    totalCost += Number(p.cost || 0);
    if (p.instrument === 'option') {
      optionCount += 1;
      contingentCashObligation += Number(p.contingentCashObligation || 0);
      contingentShareObligation += Number(p.contingentShareObligation || 0);
      if (p.option && p.option.side === 'short') optionsPremiumCollected += Number(p.premiumAbsolute || 0);
      else optionsPremiumPaid += Number(p.premiumAbsolute || 0);
    } else if (p.instrument === 'fund') {
      fundCount += 1;
      equityValue += Number(p.value || 0);
      equityCost += Number(p.cost || 0);
    } else {
      equityCount += 1;
      equityValue += Number(p.value || 0);
      equityCost += Number(p.cost || 0);
    }
  }
  const cashAmount = chRow && chRow.cashAmount != null ? chRow.cashAmount : null;
  const cashCurrency = chRow && chRow.cashCurrency != null ? chRow.cashCurrency : null;
  const depositsAmount =
    chRow && chRow.depositsAmount != null
      ? chRow.depositsAmount
      : deposits.reduce((s, d) => s + Number(d.amount || 0), 0);
  const totalPL = chRow ? chRow.totalPL : positionsValue - totalCost;
  const totalValue = chRow
    ? chRow.totalValue
    : positionsValue + (cashAmount != null ? cashAmount : 0) + depositsAmount;
  const absSum =
    positions.reduce((s, p) => s + Math.abs(Number(p.value || 0)), 0) +
    (cashAmount != null ? cashAmount : 0) +
    depositsAmount;
  const reweighted = positions
    .map((p) => ({
      ...p,
      weightPct: absSum > 0 ? (Math.abs(Number(p.value || 0)) / absSum) * 100 : 0,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return {
    ...live,
    positions: reweighted,
    totalValue,
    totalCost: chRow ? chRow.totalCost : totalCost,
    totalPL,
    totalPLPct: chRow
      ? chRow.totalPLPct
      : totalCost !== 0
        ? (totalPL / Math.abs(totalCost)) * 100
        : 0,
    positionCount: chRow ? chRow.positionCount : positions.length,
    equityValue: chRow ? chRow.equityValue : equityValue,
    equityCost: chRow ? chRow.equityCost : equityCost,
    optionsPremiumCollected: chRow ? chRow.optionsPremiumCollected : optionsPremiumCollected,
    optionsPremiumPaid: chRow ? chRow.optionsPremiumPaid : optionsPremiumPaid,
    contingentCashObligation: chRow ? chRow.contingentCashObligation : contingentCashObligation,
    contingentShareObligation: chRow ? chRow.contingentShareObligation : contingentShareObligation,
    optionCount: chRow ? chRow.optionCount : optionCount,
    equityCount: chRow ? chRow.equityCount : equityCount,
    fundCount: chRow ? chRow.fundCount : fundCount,
    cashAmount,
    cashCurrency,
    cashChannel: cashAmount != null ? channel : null,
    positionsValue: chRow ? chRow.positionsValue : positionsValue,
    cashWeightPct:
      cashAmount != null && totalValue !== 0 ? (cashAmount / totalValue) * 100 : cashAmount != null ? 0 : null,
    deposits,
    depositsAmount,
    depositsCurrency: chRow ? chRow.depositsCurrency : deposits[0] ? deposits[0].currency : null,
    depositCount: chRow ? chRow.depositCount : deposits.length,
  };
}

function channelFromQuery() {
  try {
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    const raw = (q.get('channel') || h.get('channel') || 'all').trim();
    return raw || 'all';
  } catch {
    return 'all';
  }
}

function writeChannelQuery(channel) {
  try {
    const url = new URL(location.href);
    if (!channel || channel === 'all' || channel === 'merged') url.searchParams.delete('channel');
    else url.searchParams.set('channel', channel);
    history.replaceState(null, '', url);
  } catch {
    /* ignore */
  }
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

function productProfileOf(payload) {
  return payload && payload.productProfile === 'consultant' ? 'consultant' : 'full';
}

function riskPill(kind, label) {
  const cls =
    kind === 'ok'
      ? 'pill-success'
      : kind === 'warning'
        ? 'pill-warning'
        : kind === 'danger'
          ? 'pill-danger'
          : kind === 'brand'
            ? 'pill-brand'
            : 'pill-muted';
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

function emptyCard(text) {
  return `<div class="metric-card empty">${esc(text)}</div>`;
}

function shortMarkOverPremium(p) {
  if (!p || !p.option || p.option.side !== 'short') return null;
  if (!(typeof p.avgCost === 'number') || p.avgCost <= 0) return null;
  if (!(typeof p.price === 'number') || !Number.isFinite(p.price)) return null;
  return p.price / p.avgCost;
}

function formatMarkOverPremium(ratio) {
  if (ratio == null) return '—';
  const pct = ratio * 100;
  if (!Number.isFinite(pct)) return '—';
  const shown = Math.min(Math.abs(pct), 999);
  return `${pct < 0 ? '−' : ''}${shown.toFixed(0)}%`;
}

function optionItmState(p, prices) {
  const o = p && p.option;
  if (!o) return 'unknown';
  const px = prices && o.underlying ? prices[o.underlying] : null;
  if (typeof px !== 'number' || !Number.isFinite(px) || typeof o.strike !== 'number') return 'unknown';
  if (o.right === 'put') return px < o.strike ? 'itm' : 'otm';
  if (o.right === 'call') return px > o.strike ? 'itm' : 'otm';
  return 'unknown';
}

function cssBarCard(title, rows, caption) {
  if (!rows || rows.length === 0) return '';
  const max = Math.max(...rows.map((r) => Math.abs(r.value)));
  const body = rows
    .map((r) => {
      const pct = max > 0 ? (Math.abs(r.value) / max) * 100 : 0;
      const down = r.value < 0 ? ' down' : '';
      return `<div class="bar-row">
        <div class="bar-meta"><span>${esc(r.label)}</span><span class="num ${r.value < 0 ? 'down' : ''}">${esc(r.display)}</span></div>
        <div class="bar-track"><div class="bar-fill${down}" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
    })
    .join('');
  return `<div class="metric-card">
    <div class="label-eyebrow">${esc(title)}</div>
    <div class="bar-list" style="margin-top:0.75rem">${body}</div>
    ${caption ? `<div class="metric-sub" style="margin-top:0.6rem">${esc(caption)}</div>` : ''}
  </div>`;
}

function coverageForUnderlying(longUnits, shortCallDeliverable) {
  if (!(typeof longUnits === 'number') || !(typeof shortCallDeliverable === 'number')) return null;
  if (longUnits <= 0 || shortCallDeliverable <= 0) return null;
  return {
    coveragePct: Math.min(1, longUnits / shortCallDeliverable),
    uncoveredShares: Math.max(0, shortCallDeliverable - longUnits),
    coveredShares: Math.min(longUnits, shortCallDeliverable),
  };
}
