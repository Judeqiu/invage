const DASHBOARD_API = '/api/domain/invage/dashboard';
const WATCHLIST_API = '/api/domain/invage/watchlist';

// Delegation also covers help buttons inserted when dashboard cards redraw.
(() => {
  const bubble = document.createElement('div');
  bubble.id = 'reportHelpTooltip';
  bubble.className = 'report-help-tooltip';
  bubble.setAttribute('role', 'tooltip');
  bubble.hidden = true;
  document.body.appendChild(bubble);
  let trigger = null;
  let closeTimer;
  function hide() {
    clearTimeout(closeTimer);
    trigger?.removeAttribute('aria-describedby');
    trigger = null;
    bubble.hidden = true;
  }
  function show(button) {
    if (!button?.dataset.help) return;
    clearTimeout(closeTimer);
    trigger?.removeAttribute('aria-describedby');
    trigger = button;
    if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', 'Explanation');
    button.setAttribute('aria-describedby', bubble.id);
    bubble.textContent = button.dataset.help;
    bubble.hidden = false;
    const anchor = button.getBoundingClientRect();
    const box = bubble.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8));
    const below = anchor.bottom + 8;
    const top = below + box.height <= window.innerHeight - 8
      ? below : Math.max(8, anchor.top - box.height - 8);
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  }
  const buttonFor = event => event.target instanceof Element ? event.target.closest('.help-dot[data-help]') : null;
  document.addEventListener('mouseover', event => {
    if (bubble.contains(event.target)) clearTimeout(closeTimer);
    else if (buttonFor(event)) show(buttonFor(event));
  });
  document.addEventListener('mouseout', event => {
    if (!buttonFor(event) && !bubble.contains(event.target)) return;
    if (trigger?.contains(event.relatedTarget) || bubble.contains(event.relatedTarget)) return;
    closeTimer = setTimeout(hide, 150);
  });
  document.addEventListener('focusin', event => show(buttonFor(event)));
  document.addEventListener('focusout', event => { if (buttonFor(event)) hide(); });
  document.addEventListener('click', event => {
    const button = buttonFor(event);
    if (button) show(button);
    else if (!bubble.contains(event.target)) hide();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  document.addEventListener('scroll', event => {
    if (!trigger || bubble.contains(event.target)) return;
    const box = trigger.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) hide();
    else show(trigger);
  }, true);
  window.addEventListener('resize', hide);
  new MutationObserver(() => { if (trigger && !trigger.isConnected) hide(); })
    .observe(document.body, { childList: true, subtree: true });
})();

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

function positionSymbol(ticker) {
  return String(ticker || '').split('@')[0].trim().toUpperCase();
}

async function cachedDashboard() {
  const res = await fetch('/api/domain/invage/dashboard-cache', { credentials: 'include' });
  if (res.status === 404) return null;
  return readJson(res);
}

async function loadDashboard() {
  const cached = await cachedDashboard();
  if (cached) return cached;
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

/** Account fund totals are separate from itemized holdings and their cost/P&L. */
function brokerFundAssets(dash, channel) {
  return Object.entries(dash?.connectionMetrics || {})
    .filter(([ch, m]) => (!channel || channel === 'all' || channel === 'merged' || ch === channel) &&
      Number.isFinite(m.fund_assets) && /^[A-Z]{3,4}$/.test(m.currency))
    .map(([ch, m]) => ({ channel: ch, amount: m.fund_assets, currency: m.currency, asOf: m.as_of }));
}

function brokerFundAssetsCards(dash, channel) {
  return brokerFundAssets(dash, channel).map(row => metricCard('Fund assets · broker',
    money(row.amount, row.currency), `${channelLabel(row.channel)} · ${row.asOf}`)).join('');
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

function cssBarCard(title, rows, caption, options = {}) {
  if (!rows || rows.length === 0) return '';
  const max = Math.max(...rows.map((r) => Math.abs(r.value)));
  const renderRow = r => {
    const pct = max > 0 ? (Math.abs(r.value) / max) * 100 : 0;
    const down = r.value < 0 ? ' down' : '';
    return `<div class="bar-row">
      <div class="bar-meta"><span>${esc(r.label)}</span><span class="num ${r.value < 0 ? 'down' : ''}">${esc(r.display)}</span></div>
      <div class="bar-track"><div class="bar-fill${down}" style="width:${pct.toFixed(1)}%"></div></div>
    </div>`;
  };
  const limit = options.limit || rows.length;
  const more = rows.slice(limit);
  return `<div class="metric-card"${options.id ? ` id="${esc(options.id)}"` : ''}>
    <div class="label-eyebrow">${esc(title)}</div>
    <div class="bar-list" style="margin-top:0.75rem">${rows.slice(0, limit).map(renderRow).join('')}</div>
    ${more.length ? `<details class="bar-more"${options.expanded ? ' open' : ''}><summary><span class="bar-expand-label">Show ${more.length} more</span><span class="bar-collapse-label">Show less</span></summary><div class="bar-list">${more.map(renderRow).join('')}</div></details>` : ''}
    ${caption ? `<div class="metric-sub bar-caption">${options.help ? `<button class="help-dot" type="button" aria-label="Explain option premium by stock" data-help="${esc(options.help)}">?</button> ` : ''}${esc(caption)}</div>` : ''}
  </div>`;
}

function coverageForUnderlying(longUnits, shortCallDeliverable) {
  if (!(typeof longUnits === 'number') || !(typeof shortCallDeliverable === 'number')) return null;
  if (!Number.isFinite(longUnits) || !Number.isFinite(shortCallDeliverable) || longUnits < 0 || shortCallDeliverable <= 0) return null;
  return {
    coveragePct: Math.min(1, longUnits / shortCallDeliverable),
    uncoveredShares: Math.max(0, shortCallDeliverable - longUnits),
    coveredShares: Math.min(longUnits, shortCallDeliverable),
  };
}

// A stable date-only display independent of browser locale and timezone.
function formatReportDate(value) {
  if (!value) return '—';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (!match) return String(value);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[Number(match[2])-1] ? `${Number(match[3])} ${months[Number(match[2])-1]} ${match[1]}` : String(value);
}
