/**
 * Dynamic portfolio dashboard client.
 * Fetches /api/domain/invage/dashboard (session cookie) and renders:
 * high-level KPI overview + channel chips, allocation/performance charts,
 * then detail tables (channels, holdings, deposits). Archive dates rebuild
 * from snapshot positions client-side.
 */

const API = '/api/domain/invage/dashboard';

/** Unassigned broker tags resolve to this channel on the dashboard. */
const DEFAULT_CHANNEL = 'default';
/** Combined multi-broker view. */
const MERGED_CHANNEL_VIEW = 'merged';

const COLORS = [
  '#5b50f8', '#00b4ca', '#00a852', '#eb9500', '#ea0030', '#626c81',
  '#3b82f6', '#171f30', '#8b5cf6', '#10b981', '#ef4444', '#6b7280',
];

const el = {
  subtitle: document.getElementById('subtitle'),
  dateSelect: document.getElementById('dateSelect'),
  dateInput: document.getElementById('dateInput'),
  datePrev: document.getElementById('datePrev'),
  dateNext: document.getElementById('dateNext'),
  dateLatest: document.getElementById('dateLatest'),
  channelSelect: document.getElementById('channelSelect'),
  channelPills: document.getElementById('channelPills'),
  deskEyebrow: document.getElementById('deskEyebrow'),
  heroDate: document.getElementById('heroDate'),
  heroLead: document.getElementById('heroLead'),
  navValue: document.getElementById('navValue'),
  navDelta: document.getElementById('navDelta'),
  kpiRow: document.getElementById('kpiRow'),
  expiryRow: document.getElementById('expiryRow'),
  expiryLead: document.getElementById('expiryLead'),
  expiryTitle: document.getElementById('expiryTitle'),
  expiryBlock: document.getElementById('expiryBlock'),
  expiryTable: document.getElementById('expiryTable'),
  premiumBlock: document.getElementById('premiumBlock'),
  premiumHead: document.getElementById('premiumHead'),
  premiumEngine: document.getElementById('premiumEngine'),
  openOptionsBlock: document.getElementById('openOptionsBlock'),
  openOptionsHead: document.getElementById('openOptionsHead'),
  openOptions: document.getElementById('openOptions'),
  optionOpenTab: document.getElementById('optionOpenTab'),
  optionHistoryTab: document.getElementById('optionHistoryTab'),
  optionHistoryPanel: document.getElementById('optionHistoryPanel'),
  optionHistoryTable: document.getElementById('optionHistoryTable'),
  optionHistoryDetail: document.getElementById('optionHistoryDetail'),
  optionFreshness: document.getElementById('optionFreshness'),
  optionOpenEmpty: document.getElementById('optionOpenEmpty'),
  historyBroker: document.getElementById('historyBroker'),
  historyRight: document.getElementById('historyRight'),
  historyStatus: document.getElementById('historyStatus'),
  historyFrom: document.getElementById('historyFrom'),
  historyTo: document.getElementById('historyTo'),
  historySearch: document.getElementById('historySearch'),
  historyMore: document.getElementById('historyMore'),
  statusBadge: document.getElementById('statusBadge'),
  status: document.getElementById('status'),
  refreshBtn: document.getElementById('refreshBtn'),
  autoRefresh: document.getElementById('autoRefresh'),
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  dashboard: document.getElementById('dashboard'),
  kpiGrid: document.getElementById('kpiGrid'),
  overviewMeta: document.getElementById('overviewMeta'),
  channelStrip: document.getElementById('channelStrip'),
  channelDetailBody: document.getElementById('channelDetailBody'),
  channelDetailMeta: document.getElementById('channelDetailMeta'),
  holdingsDetailBody: document.getElementById('holdingsDetailBody'),
  holdingsDetailMeta: document.getElementById('holdingsDetailMeta'),
  allocationGrid: document.getElementById('allocationGrid'),
  barGrid: document.getElementById('barGrid'),
  chartGrid: document.getElementById('chartGrid'),
  insightGrid: document.getElementById('insightGrid'),
  warningsBanner: document.getElementById('warningsBanner'),
};

let payload = null;
let selectedDate = 'live';
let selectedChannel = MERGED_CHANNEL_VIEW;
let optionBrokerFilter = 'all';
let optionRightFilter = 'all';
let riskBrokerFilter = 'all';
let riskRightFilter = 'all';
let riskShowAll = false;
let highlightedUnderlying = null;
let optionTab = 'open';
let optionHistory = { episodes: [], connections: [], next_offset: null, total: 0, history_started: false, gaps: [] };
let optionHistoryError = '';
let optionHistoryRequest = 0;
let historySearchTimer = null;
const collapsedOptionMonths = new Set();

function normalizeChannelId(raw) {
  if (!raw || raw === 'all' || raw === MERGED_CHANNEL_VIEW) return MERGED_CHANNEL_VIEW;
  return raw;
}
let charts = {};
let timer = null;
let loading = false;

/* ---------- formatting ---------- */

function reportingCcyCode(view) {
  if (view && view.fxApplied && view.reportingCurrency) return view.reportingCurrency;
  if (view && view.reportingCurrency) return view.reportingCurrency;
  if (view && view.cashCurrency) return view.cashCurrency;
  return null;
}

function fmtMoney0(n, ccy) {
  const abs = Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (ccy && ccy !== 'USD') return `${abs} ${ccy}`;
  return '$' + abs;
}

function fmtUsd0(n) {
  return fmtMoney0(n, null);
}

function fmtUsd2(n) {
  return (
    '$' +
    Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function fmtPrettyMoney(n, ccy, digits = 2) {
  const v = Number(n);
  const abs = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = v < 0 ? '-' : '';
  const code = (ccy || '').toUpperCase();
  if (code === 'SGD') return `${sign}S$${abs}`;
  if (!code || code === 'USD') return `${sign}$${abs}`;
  return `${sign}${abs} ${code}`;
}

function longDateLabel(ymd) {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function optionDateLabel(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '—';
  const [year, month, day] = ymd.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1];
  return mon ? `${day}-${mon}-${year}` : '—';
}

function optionUnderlyingLabel(option) {
  const raw = String(option.underlying || '').trim().toUpperCase();
  const embedded = raw.match(/^([A-Z][A-Z0-9.]*?)\s*(\d{6})([CP])(\d{8})$/);
  if (!embedded) return raw;
  const encodedDate = `20${embedded[2].slice(0, 2)}-${embedded[2].slice(2, 4)}-${embedded[2].slice(4, 6)}`;
  const encodedStrike = Number(embedded[4]) / 1000;
  return encodedDate === option.expiry && embedded[3] === (option.right === 'put' ? 'P' : 'C') &&
    encodedStrike === Number(option.strike) ? embedded[1] : raw;
}

function recordedPremiumForView(view, date) {
  const journal = payload?.premiumJournal;
  const supported = new Set(payload?.premiumSupportedChannels || []);
  const observed = new Set(journal?.channels || []);
  const channels = view.channelView === MERGED_CHANNEL_VIEW
    ? (view.channels?.length ? view.channels : [...new Set((view.positions || []).map(p => p.channel))])
    : [view.channelView];
  if (!journal?.available || !channels.length || channels.some(ch => !supported.has(ch) || !observed.has(ch))) {
    return { daily: null, mtd: null, reason: 'Complete trade history unavailable for this view' };
  }
  const start = `${date.slice(0, 7)}-01`;
  const rows = (journal.daily || []).filter(row => channels.includes(row.channel) && row.date >= start && row.date <= date);
  const currency = reportingCcyCode(view);
  const convert = (row) => {
    if (!currency) return null;
    if (row.currency === currency) return Number(row.net_premium);
    const rate = view.fxApplied ? view.fxRates?.[row.currency] : null;
    return Number.isFinite(rate) && rate > 0 ? Number(row.net_premium) * rate : null;
  };
  if (rows.some(row => convert(row) == null)) return { daily: null, mtd: null, reason: 'Trade currencies cannot be combined without FX' };
  const sum = list => list.length ? list.reduce((total, row) => total + convert(row), 0) : null;
  return { daily: sum(rows.filter(row => row.date === date)), mtd: sum(rows),
    reason: `Recorded fills through ${optionDateLabel(date)} · broker report dates` };
}

function unverifiedOptionChannels(view) {
  if (!view.isLive) return [];
  const today = (payload.generatedAt || '').slice(0, 10);
  return [...new Set((view.positions || []).filter(p => p.instrument === 'option')
    .map(p => p.channel || DEFAULT_CHANNEL))].filter(channel => {
      const asOf = payload.brokerAsOf?.[channel];
      return !asOf || (daysToExpiry(today, asOf) ?? 999) > 4;
    });
}

function daysToExpiry(expiry, asOf) {
  if (!expiry) return null;
  const e = Date.parse(`${expiry}T00:00:00Z`);
  const a = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(e) || !Number.isFinite(a)) return null;
  return Math.round((e - a) / 86400000);
}

// Normal CDF approximation, used with Black–Scholes d2 below.
function normalCdf(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * z);
  const density = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const tail = density * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}

function optionFinishItmProbability(position, spot, days) {
  const o = position.option;
  const strike = Number(o?.strike);
  const multiplier = Number(o?.multiplier || 100);
  const mark = Number.isFinite(position.brokerMark) ? position.brokerMark : position.price;
  const unavailable = (reason) => ({ probability: null, iv: null, reason });
  if (!(spot > 0)) return unavailable('No spot quote');
  if (!(strike > 0 && multiplier > 0) || days == null) return unavailable('Incomplete contract');
  if (position.pricingMode === 'cost' || position.markSource === 'cost' || !Number.isFinite(mark)) return unavailable('No market mark');
  if (mark <= 0) return unavailable('Zero market mark');
  if (days <= 0) return { probability: o.right === 'put' ? Number(spot < strike) : Number(spot > strike), iv: null };
  const years = Math.max(days, 1) / 365.25;
  const premium = mark / multiplier;
  const intrinsic = o.right === 'put' ? Math.max(strike - spot, 0) : Math.max(spot - strike, 0);
  const upper = o.right === 'put' ? strike : spot;
  if (premium < intrinsic - 0.01 || premium >= upper) return unavailable('Mark and spot disagree');
  const priceAt = (vol) => {
    const vsqrt = vol * Math.sqrt(years);
    const d1 = (Math.log(spot / strike) + vsqrt * vsqrt / 2) / vsqrt;
    const d2 = d1 - vsqrt;
    return o.right === 'put'
      ? strike * normalCdf(-d2) - spot * normalCdf(-d1)
      : spot * normalCdf(d1) - strike * normalCdf(d2);
  };
  let lo = 0.0001;
  let hi = 10;
  if (premium < priceAt(lo) - 0.01 || premium > priceAt(hi)) return unavailable('Cannot solve IV');
  for (let i = 0; i < 65; i += 1) {
    const mid = (lo + hi) / 2;
    if (priceAt(mid) < premium) lo = mid;
    else hi = mid;
  }
  const iv = (lo + hi) / 2;
  const vsqrt = iv * Math.sqrt(years);
  const d2 = (Math.log(spot / strike) - vsqrt * vsqrt / 2) / vsqrt;
  return { probability: Math.max(0, Math.min(1, o.right === 'put' ? normalCdf(-d2) : normalCdf(d2))), iv };
}

function metricCardHtml(label, value, sub, help, valueClass) {
  const vcls = ['metric-value', valueClass || ''].filter(Boolean).join(' ');
  const helpBtn = help
    ? `<button type="button" class="help-dot" title="${escapeHtml(help)}">?</button>`
    : '';
  return `<div class="metric-card">
    <div class="metric-head">
      <div class="label-eyebrow">${escapeHtml(label)}</div>
      ${helpBtn}
    </div>
    <div class="${vcls}">${value}</div>
    ${sub ? `<div class="metric-sub">${sub}</div>` : ''}
  </div>`;
}

function fmtSigned(n, digits = 2) {
  return (n > 0 ? '+' : '') + Number(n).toFixed(digits);
}

function fmtSignedUsd0(n) {
  const v = Number(n);
  const abs = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (v < 0 ? '-$' : '+$') + abs;
}

function fxFootnote(view) {
  if (!view || !view.fxApplied || !view.fxRates || !view.reportingCurrency) return '';
  const parts = Object.entries(view.fxRates)
    .filter(([c]) => c !== view.reportingCurrency)
    .map(([c, r]) => `${c} ${Number(r).toPrecision(4)}`);
  if (parts.length === 0) return '';
  return ` · Totals in ${view.reportingCurrency} (live FX: ${parts.join(', ')})`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveDashboardChannel(raw) {
  if (raw == null) return DEFAULT_CHANNEL;
  const t = String(raw).trim();
  return t.length === 0 ? DEFAULT_CHANNEL : t;
}

function channelBadgeHtml(channel) {
  const ch = resolveDashboardChannel(channel);
  const cls = ch === DEFAULT_CHANNEL ? 'badge-channel-default' : 'badge-channel';
  return `<span class="card-badge ${cls}">${escapeHtml(ch)}</span>`;
}

function setOptionTab(tab) {
  optionTab = tab;
  const showHistory = tab === 'history';
  el.optionOpenTab.classList.toggle('on', !showHistory);
  el.optionHistoryTab.classList.toggle('on', showHistory);
  el.optionOpenTab.setAttribute('aria-pressed', String(!showHistory));
  el.optionHistoryTab.setAttribute('aria-pressed', String(showHistory));
  el.optionHistoryPanel.classList.toggle('hidden', !showHistory);
  const view = payload?.model ? buildView(selectedDate, selectedChannel) : null;
  const hasOpen = Boolean(view?.positions?.some(p => p.instrument === 'option' && p.option));
  el.optionOpenEmpty.classList.toggle('hidden', showHistory || hasOpen);
  if (el.openOptionsBlock) el.openOptionsBlock.classList.toggle('hidden', showHistory || !hasOpen);
}

function renderOptionFreshness() {
  if (!el.optionFreshness) return;
  const rows = optionHistory.connections || [];
  const summary = rows.length ? rows.map(row => {
    const name = row.label || row.broker_id.toUpperCase();
    const confirmed = row.position_as_of ? `positions as of ${row.position_as_of}` : 'no confirmed position date';
    const failed = row.last_attempt?.ok === false ? `; last attempt failed ${row.last_attempt.at.slice(0, 10)}` : '';
    const schedule = row.schedule ? `; ${row.schedule} sync` : '; manual sync';
    const interval = row.schedule === 'hourly' ? 1 : row.schedule === 'daily' ? 24 : row.schedule === 'weekly' ? 168 : null;
    const late = interval && row.last_success_at && Date.now() - Date.parse(row.last_success_at) > (interval + 1) * 3600000 ? '; sync overdue' : '';
    return `${name}: ${confirmed}${failed}${schedule}${late}${row.enabled ? '' : '; paused'}`;
  }).join(' · ') : 'Option history begins with broker observations. Valuation snapshots do not confirm position status.';
  const gaps = optionHistory.gaps?.length ? ` · ${optionHistory.gaps.length} older sync${optionHistory.gaps.length === 1 ? '' : 's'} could not be reconstructed` : '';
  el.optionFreshness.textContent = summary + gaps;
}

function historyContractLabel(row) {
  const c = row.contract;
  return `${c.underlying} ${c.side.toUpperCase()} ${c.right.toUpperCase()} ${c.strike} ${c.expiry}`;
}

function optionHistoryStatus(row) {
  return ({ closed_by_fills: 'Closed by fills', expired: 'Expired', assigned: 'Assigned',
    exercised: 'Exercised', cash_settled: 'Cash settled', mixed_outcomes: 'Mixed outcomes',
    partially_explained: 'Partly explained', conflicting_evidence: 'Conflicting evidence',
    no_longer_observed: 'No longer observed', unverified: 'Status unverified',
    open: 'Open as of date' })[row.status] || 'Status unknown';
}

function optionHistoryOutcome(row) {
  if (row.matched_trade_pl) return `Matched trade P&amp;L ${fmtPrettyMoney(Number(row.matched_trade_pl.amount), row.matched_trade_pl.currency)}`;
  if (row.broker_event_pl) return `Broker event P&amp;L ${fmtPrettyMoney(Number(row.broker_event_pl.amount), row.broker_event_pl.currency)}`;
  if ((row.status === 'assigned' || row.status === 'exercised') && row.events?.every(event => event.settlement === 'physical')) {
    return 'Underlying delivery · combined P&amp;L pending';
  }
  return 'P&amp;L unavailable';
}

function renderOptionHistory() {
  renderOptionFreshness();
  if (!el.optionHistoryTable) return;
  if (optionHistoryError) {
    el.optionHistoryTable.innerHTML = `<div class="metric-card empty">${escapeHtml(optionHistoryError)}</div>`;
    return;
  }
  const broker = el.historyBroker.value;
  const right = el.historyRight.value;
  const status = el.historyStatus.value;
  const search = el.historySearch.value.trim().toUpperCase();
  const from = el.historyFrom.value;
  const to = el.historyTo.value;
  const rows = optionHistory.episodes.filter(row =>
    (!broker || row.channel === broker) && (!right || row.contract.right === right) &&
    (status === 'all' || status === 'historical' && row.first_seen_absent || row.status === status) &&
    (!search || historyContractLabel(row).toUpperCase().includes(search)) &&
    (!from || (row.first_seen_absent || row.last_seen_open) >= from) &&
    (!to || (row.first_seen_absent || row.last_seen_open) <= to));
  if (!rows.length) {
    el.optionHistoryTable.innerHTML = `<div class="metric-card empty">${optionHistory.history_started
      ? 'No option records match these filters. A missing contract is recorded only after a complete successful broker sync.'
      : 'No broker option observations have been saved yet. The next successful sync starts this history.'}</div>`;
  } else {
    el.optionHistoryTable.innerHTML = `<div class="metric-card table-card"><div class="table-scroll"><table class="report history-table">
      <thead><tr><th>Contract</th><th>Broker / account</th><th>Last seen open</th><th>First seen absent</th><th>Status</th><th>Outcome / P&amp;L</th><th></th></tr></thead>
      <tbody>${rows.map(row => `<tr><td>${escapeHtml(historyContractLabel(row))}</td>
        <td>${escapeHtml(row.broker_id.toUpperCase())} · ${escapeHtml(row.account_id)}</td>
        <td>${escapeHtml(row.last_seen_open)}</td><td>${row.first_seen_absent ? escapeHtml(row.first_seen_absent) : '—'}</td>
        <td>${optionHistoryStatus(row)}</td>
        <td>${optionHistoryOutcome(row)}</td><td><button type="button" class="chip-btn" data-history-id="${escapeHtml(row.id)}">Details</button></td>
      </tr>`).join('')}</tbody></table></div></div>`;
  }
  el.historyMore.classList.toggle('hidden', optionHistory.next_offset == null);
}

function showOptionHistoryDetail(id) {
  const row = optionHistory.episodes.find(item => item.id === id);
  if (!row) return;
  const checkpoints = (payload?.model?.history || []).filter(snapshot =>
    snapshot.positions?.some(p => p.instrument === 'option' && p.option &&
      p.channel === row.channel && p.option.underlying === row.contract.underlying &&
      p.option.right === row.contract.right && p.option.side === row.contract.side &&
      p.option.strike === row.contract.strike && p.option.expiry === row.contract.expiry)).map(s => s.date);
  el.optionHistoryDetail.innerHTML = `<div class="history-detail"><h3>${escapeHtml(historyContractLabel(row))}</h3>
    <p><strong>Evidence:</strong> Last observed open ${escapeHtml(row.last_seen_open)}${row.first_seen_absent ? `; first observed absent ${escapeHtml(row.first_seen_absent)}` : ''}. ${row.matched_trade_pl ? 'Imported opening and closing fills reconcile to a flat position.' : row.events?.length ? 'Broker lifecycle records are listed below; partial or conflicting records do not establish a complete outcome.' : 'Disappearance alone does not establish a close, expiry, or assignment.'}</p>
    ${row.uncertain_as_of ? `<p><strong>Coverage gap:</strong> The ${escapeHtml(row.uncertain_as_of)} response did not confirm this contract. ${row.uncertain_skips?.length ? escapeHtml(row.uncertain_skips.map(skip => `${skip.symbol || 'Unidentified row'}: ${skip.reason}`).join('; ')) : 'One or more position rows were skipped.'}</p>` : ''}
    ${row.event_coverage_gap ? `<p><strong>Event coverage gap:</strong> ${escapeHtml(row.event_coverage_gap)}</p>` : ''}
    <p><strong>Broker observations:</strong></p><ul>${row.observations.map(o => `<li>${escapeHtml(o.as_of)} · ${o.units} contract${o.units === 1 ? '' : 's'} · broker mark ${fmtPrettyMoney(o.mark, row.contract.currency)}${o.source === 'prior_books' ? ' · prior books' : ''}</li>`).join('')}</ul>
    <p><strong>Imported fills for this contract:</strong> ${row.executions.length ? `${row.executions.length} execution${row.executions.length === 1 ? '' : 's'}. Dates can precede the first position observation; a same-day reopen may share fills across episodes.` : 'None available.'}</p>
    ${row.executions.length ? `<ul>${row.executions.map(fill => `<li>${escapeHtml(fill.executed_at.replace('T', ' '))} · ${escapeHtml(fill.side.toUpperCase())} to ${escapeHtml(fill.effect)} · ${escapeHtml(fill.contracts)} contracts · gross ${escapeHtml(fill.gross_premium)} ${escapeHtml(fill.currency)} · commission ${escapeHtml(fill.commission)} ${escapeHtml(fill.currency)}</li>`).join('')}</ul>` : ''}
    <p><strong>Broker lifecycle events:</strong> ${row.events?.length ? `${row.events.length} record${row.events.length === 1 ? '' : 's'}.` : row.broker_id === 'ibkr' ? 'None imported. Include Option Exercises, Assignments &amp; Expirations in the Activity Flex query to capture them.' : 'None imported. This broker connection currently supplies position snapshots only.'}</p>
    ${row.events?.length ? `<ul>${row.events.map(event => `<li>${escapeHtml(event.date)} · ${escapeHtml(event.kind.replaceAll('_', ' '))} · ${escapeHtml(event.contracts)} contracts · ${escapeHtml(event.settlement)} settlement${event.proceeds !== undefined ? ` · proceeds ${escapeHtml(event.proceeds)} ${escapeHtml(event.currency)}` : ''}${event.broker_realized_pl !== undefined ? ` · broker option P&amp;L ${escapeHtml(event.broker_realized_pl)} ${escapeHtml(event.currency)}` : ''}</li>`).join('')}</ul>` : ''}
    ${row.matched_trade_pl ? `<p><strong>Matched trade P&amp;L:</strong> ${escapeHtml(row.matched_trade_pl.amount)} ${escapeHtml(row.matched_trade_pl.currency)} from ${escapeHtml(row.matched_trade_pl.opened)} opened and ${escapeHtml(row.matched_trade_pl.closed)} closed contracts, including ${escapeHtml(row.matched_trade_pl.fees)} ${escapeHtml(row.matched_trade_pl.currency)} in reported commissions. Other taxes or charges outside these fills are not included.</p>` : ''}
    ${row.broker_event_pl ? `<p><strong>Broker-reported option event P&amp;L:</strong> ${escapeHtml(row.broker_event_pl.amount)} ${escapeHtml(row.broker_event_pl.currency)}. This is the broker's event amount, not a calculation from position disappearance.</p>` : ''}
    ${(row.status === 'assigned' || row.status === 'exercised') && row.events?.every(event => event.settlement === 'physical') ? '<p>Physical delivery changes the underlying transaction basis or proceeds. The option row alone does not establish combined trade P&amp;L.</p>' : ''}
    <p><strong>Saved valuation checkpoints:</strong> ${checkpoints.length ? escapeHtml(checkpoints.join(', ')) : 'None. A checkpoint is a valuation, not broker confirmation.'}</p>
  </div>`;
}

async function loadOptionHistory(more = false) {
  const offset = more ? optionHistory.next_offset : 0;
  if (more && offset == null) return;
  const request = ++optionHistoryRequest;
  const params = new URLSearchParams({ offset: String(offset), limit: '100' });
  if (el.historyBroker.value) params.set('channel', el.historyBroker.value);
  if (el.historyRight.value) params.set('right', el.historyRight.value);
  if (el.historyStatus.value !== 'all') params.set('status', el.historyStatus.value);
  if (el.historyFrom.value) params.set('from', el.historyFrom.value);
  if (el.historyTo.value) params.set('to', el.historyTo.value);
  if (el.historySearch.value.trim()) params.set('q', el.historySearch.value.trim());
  try {
    const res = await fetch(`/api/domain/invage/option-history?${params}`, { credentials: 'include' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
    if (request !== optionHistoryRequest) return;
    optionHistory = { ...body, episodes: more ? [...optionHistory.episodes, ...body.episodes] : body.episodes };
    optionHistoryError = '';
    const selected = el.historyBroker.value;
    el.historyBroker.innerHTML = `<option value="">All brokers</option>${body.connections.map(row => `<option value="${escapeHtml(row.channel)}">${escapeHtml(row.label || row.broker_id)}</option>`).join('')}`;
    el.historyBroker.value = selected;
  } catch (error) {
    if (request !== optionHistoryRequest) return;
    optionHistoryError = error instanceof Error ? error.message : String(error);
  }
  renderOptionHistory();
}

el.optionOpenTab?.addEventListener('click', () => setOptionTab('open'));
el.optionHistoryTab?.addEventListener('click', () => setOptionTab('history'));
for (const control of [el.historyBroker, el.historyRight, el.historyStatus, el.historyFrom, el.historyTo, el.historySearch]) {
  control?.addEventListener(control === el.historySearch ? 'input' : 'change', () => {
    renderOptionHistory();
    if (control === el.historySearch) {
      clearTimeout(historySearchTimer);
      historySearchTimer = setTimeout(() => loadOptionHistory(), 250);
    } else loadOptionHistory();
  });
}
el.optionHistoryTable?.addEventListener('click', event => {
  const id = event.target.closest('[data-history-id]')?.dataset.historyId;
  if (id) showOptionHistoryDetail(id);
});
el.historyMore?.addEventListener('click', () => loadOptionHistory(true));

function fundIndex(value, cost) {
  // Short-option credits make totalCost non-positive; use abs only when cost is
  // strictly positive (equity-style). Otherwise treat as flat 100 base.
  if (cost > 0) return (value / cost) * 100;
  if (cost < 0) return cost !== 0 ? (value / Math.abs(cost)) * 100 : 100;
  return 100;
}

/** Prefer equity-only cost/value for SPY fund-index when options are present. */
function portfolioFundIndex(view) {
  if (view.equityCost != null && view.equityCost > 0 && view.equityValue != null) {
    return fundIndex(view.equityValue, view.equityCost);
  }
  return fundIndex(view.totalValue, view.totalCost);
}

/* ---------- benchmark ---------- */

function benchBase() {
  const b = payload?.benchmark;
  if (!b) return null;
  const base = b.closes?.[b.baseDate];
  return base != null && base > 0 ? base : null;
}

/** SPY price for a view date: live → current price, archive → close map. */
function benchPriceAt(dateKey) {
  const b = payload?.benchmark;
  if (!b) return null;
  if (dateKey === 'live') return b.currentPrice ?? null;
  return b.closes?.[dateKey] ?? null;
}

function benchIndexAt(dateKey) {
  const base = benchBase();
  const price = benchPriceAt(dateKey);
  if (base == null || price == null) return null;
  return (price / base) * 100;
}

/* ---------- view model ---------- */

function reweightPositions(positions, cashAmount, depositsAmount = 0) {
  const absPositions = positions.reduce((s, p) => s + Math.abs(p.value), 0);
  const absSum =
    absPositions +
    (cashAmount != null ? Number(cashAmount) : 0) +
    (depositsAmount != null ? Number(depositsAmount) : 0);
  return positions
    .map((p) => ({
      ...p,
      channel: resolveDashboardChannel(p.channel),
      label: p.label || p.ticker,
      instrument: p.instrument || 'equity',
      weightPct: absSum > 0 ? (Math.abs(p.value) / absSum) * 100 : 0,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function normalizeDeposits(list) {
  return (list || []).map((d) => ({
    ...d,
    channel: resolveDashboardChannel(d.channel),
  }));
}

/**
 * Apply channel filter to a base view (merged or single channel).
 * Missing channel tags become DEFAULT_CHANNEL.
 * Multi-channel cash: prefer byChannel row for the selected channel.
 */
function applyChannelFilter(base, channelKey) {
  const allPositions = (base.positions || []).map((p) => ({
    ...p,
    channel: resolveDashboardChannel(p.channel),
  }));
  const allDeposits = normalizeDeposits(base.deposits);
  const byChannel = base.byChannel || [];
  const cashChannel =
    base.cashAmount != null && base.cashChannel != null
      ? resolveDashboardChannel(base.cashChannel)
      : null;

  const channels = base.channels
    ? [...base.channels]
    : [...new Set([
        ...allPositions.map((p) => p.channel),
        ...byChannel.map((c) => resolveDashboardChannel(c.channel)),
        ...allDeposits.map((d) => d.channel),
        ...(cashChannel != null ? [cashChannel] : []),
      ])].sort((a, b) => {
        if (a === DEFAULT_CHANNEL) return -1;
        if (b === DEFAULT_CHANNEL) return 1;
        return a.localeCompare(b);
      });

  if (channelKey === MERGED_CHANNEL_VIEW) {
    const depositsAmount = Number(base.depositsAmount || 0);
    const positions = reweightPositions(
      allPositions,
      base.cashAmount ?? null,
      depositsAmount,
    );
    return {
      ...base,
      positions,
      deposits: allDeposits,
      depositsAmount,
      depositsCurrency: base.depositsCurrency ?? null,
      depositCount: allDeposits.length,
      channelView: MERGED_CHANNEL_VIEW,
      channelLabel: 'All (merged)',
      channels,
      cashChannel,
      byChannel,
    };
  }

  const filtered = allPositions.filter((p) => p.channel === channelKey);
  const deposits = allDeposits.filter((d) => d.channel === channelKey);
  const chRow = byChannel.find((c) => resolveDashboardChannel(c.channel) === channelKey);
  // Prefer per-channel cash from byChannel (multi-cash); fall back to single cashChannel match.
  let cashAmount = null;
  let cashCurrency = null;
  if (chRow != null && chRow.cashAmount != null) {
    cashAmount = chRow.cashAmount;
    cashCurrency = chRow.cashCurrency ?? null;
  } else if (cashChannel != null && cashChannel === channelKey) {
    cashAmount = base.cashAmount;
    cashCurrency = base.cashCurrency;
  }

  let depositsAmount = 0;
  let depositsCurrency = null;
  if (chRow != null && chRow.depositsAmount != null && chRow.depositsAmount > 0) {
    depositsAmount = chRow.depositsAmount;
    depositsCurrency = chRow.depositsCurrency ?? null;
  } else if (deposits.length > 0) {
    depositsAmount = deposits.reduce((s, d) => s + Number(d.amount), 0);
    depositsCurrency = deposits[0].currency;
  }

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

  for (const p of filtered) {
    positionsValue += p.value;
    totalCost += p.cost;
    if (p.instrument === 'option') {
      optionCount += 1;
      contingentCashObligation += p.contingentCashObligation || 0;
      contingentShareObligation += p.contingentShareObligation || 0;
      if (p.option?.side === 'short') optionsPremiumCollected += p.premiumAbsolute || 0;
      else optionsPremiumPaid += p.premiumAbsolute || 0;
    } else if (p.instrument === 'fund') {
      fundCount += 1;
      equityValue += p.value;
      equityCost += p.cost;
    } else {
      equityCount += 1;
      equityValue += p.value;
      equityCost += p.cost;
    }
  }

  const totalPL = positionsValue - totalCost;
  let totalValue = positionsValue;
  if (cashAmount != null) totalValue += cashAmount;
  totalValue += depositsAmount;
  const cashWeightPct =
    cashAmount != null && totalValue !== 0
      ? (cashAmount / totalValue) * 100
      : cashAmount != null
        ? 0
        : null;
  const positions = reweightPositions(filtered, cashAmount, depositsAmount);

  return {
    ...base,
    positions,
    totalValue,
    totalCost,
    totalPL,
    totalPLPct: totalCost !== 0 ? (totalPL / Math.abs(totalCost)) * 100 : 0,
    equityValue,
    equityCost,
    optionsPremiumCollected,
    optionsPremiumPaid,
    contingentCashObligation,
    contingentShareObligation,
    optionCount,
    equityCount,
    fundCount,
    cashAmount,
    cashCurrency,
    cashChannel: cashAmount != null ? channelKey : null,
    positionsValue,
    cashWeightPct,
    deposits,
    depositsAmount,
    depositsCurrency,
    depositCount: deposits.length,
    channelView: channelKey,
    channelLabel: channelKey,
    channels,
    byChannel,
  };
}

/** Build the per-date view: 'live' or a snapshot date from model.history. */
function buildView(dateKey, channelKey = selectedChannel) {
  const model = payload.model;
  if (dateKey === 'live') {
    const live = model.live;
    const viewBase = {
      isLive: true,
      label: 'Live',
      positions: live.positions,
      totalValue: live.totalValue,
      totalCost: live.totalCost,
      totalPL: live.totalPL,
      totalPLPct: live.totalPLPct,
      equityValue: live.equityValue,
      equityCost: live.equityCost,
      optionsPremiumCollected: live.optionsPremiumCollected ?? 0,
      optionsPremiumPaid: live.optionsPremiumPaid ?? 0,
      contingentCashObligation: live.contingentCashObligation ?? 0,
      contingentShareObligation: live.contingentShareObligation ?? 0,
      optionCount: live.optionCount ?? 0,
      equityCount: live.equityCount ?? live.positions.length,
      fundCount: live.fundCount ?? 0,
      cashAmount: live.cashAmount ?? null,
      cashCurrency: live.cashCurrency ?? null,
      cashChannel: live.cashChannel ?? null,
      positionsValue: live.positionsValue ?? live.totalValue,
      cashWeightPct: live.cashWeightPct ?? null,
      deposits: live.deposits ?? [],
      depositsAmount: live.depositsAmount ?? 0,
      depositsCurrency: live.depositsCurrency ?? null,
      depositCount: live.depositCount ?? (live.deposits ? live.deposits.length : 0),
      channels: live.channels ?? [],
      byChannel: live.byChannel ?? [],
      reportingCurrency: live.reportingCurrency ?? null,
      fxRates: live.fxRates ?? null,
      fxApplied: live.fxApplied === true,
    };
    const filtered = applyChannelFilter(viewBase, channelKey);
    const fIdx = portfolioFundIndex(filtered);
    const bIdx = benchIndexAt('live');
    return {
      ...filtered,
      fundIndex: fIdx,
      benchmarkIndex: bIdx,
      diff: bIdx == null ? null : fIdx - bIdx,
    };
  }
  const row = model.history.find((h) => h.date === dateKey);
  if (!row) return null;
  const rawPositions = (row.positions || []).map((p) => ({
    ...p,
    label: p.label || p.ticker,
    instrument: p.instrument || 'equity',
    channel: resolveDashboardChannel(p.channel),
  }));
  const viewBase = {
    isLive: false,
    label: row.date,
    positions: rawPositions,
    totalValue: row.totalValue,
    totalCost: row.totalCost,
    totalPL: row.totalPL,
    totalPLPct: row.totalPLPct,
    equityValue: row.equityValue,
    equityCost: row.equityCost,
    optionsPremiumCollected: row.optionsPremiumCollected ?? 0,
    optionsPremiumPaid: row.optionsPremiumPaid ?? 0,
    contingentCashObligation: row.contingentCashObligation ?? 0,
    contingentShareObligation: 0,
    optionCount: rawPositions.filter((p) => p.instrument === 'option').length,
    equityCount: rawPositions.filter((p) => p.instrument !== 'option' && p.instrument !== 'fund')
      .length,
    fundCount: rawPositions.filter((p) => p.instrument === 'fund').length,
    cashAmount: row.cashAmount ?? null,
    cashCurrency: row.cashCurrency ?? null,
    cashChannel: row.cashAmount != null ? resolveDashboardChannel(row.cashChannel) : null,
    positionsValue: row.positionsValue ?? row.totalValue,
    cashWeightPct:
      row.cashAmount != null && row.totalValue
        ? (row.cashAmount / row.totalValue) * 100
        : null,
    channels: null,
    byChannel: null,
  };
  const filtered = applyChannelFilter(viewBase, channelKey);
  const fIdx = portfolioFundIndex(filtered);
  const bIdx = benchIndexAt(dateKey);
  return {
    ...filtered,
    fundIndex: fIdx,
    benchmarkIndex: bIdx,
    diff: bIdx == null ? null : fIdx - bIdx,
  };
}

/** Timeline points up to (and including) the selected date. Live adds a 'Now' point. */
function buildTimeline(view) {
  const model = payload.model;
  const points = model.history
    .filter((h) => view.isLive || h.date <= view.label)
    .map((h) => ({
      label: h.date,
      fund: fundIndex(h.totalValue, h.totalCost),
      bench: benchIndexAt(h.date),
    }));
  if (view.isLive) {
    points.push({
      label: 'Now',
      fund: view.fundIndex,
      bench: view.benchmarkIndex,
    });
  }
  return points;
}

/** Per-position fund-index timeline from snapshot positions + live point. */
function buildPositionTimeline(ticker, view) {
  const model = payload.model;
  const points = [];
  for (const h of model.history) {
    if (!view.isLive && h.date > view.label) continue;
    const p = (h.positions || []).find((x) => x.ticker === ticker);
    if (p) points.push({ label: h.date, fund: fundIndex(p.value, p.cost) });
  }
  if (view.isLive) {
    const live = model.live.positions.find((x) => x.ticker === ticker);
    if (live) points.push({ label: 'Now', fund: fundIndex(live.value, live.cost) });
  }
  return points;
}

/* ---------- chart helpers ---------- */

function destroyCharts() {
  Object.values(charts).forEach((c) => c.destroy());
  charts = {};
}

function chartAvailable() {
  return typeof Chart !== 'undefined';
}

/* ---------- renderers ---------- */

function plClass(n) {
  if (n > 0) return 'pl-pos';
  if (n < 0) return 'pl-neg';
  return 'pl-flat';
}

function typeBadgeHtml(kind) {
  const k = kind || 'equity';
  const cls =
    k === 'option'
      ? 'badge-type-option'
      : k === 'fund'
        ? 'badge-type-fund'
        : k === 'cash'
          ? 'badge-type-cash'
          : k === 'deposit'
            ? 'badge-type-deposit'
            : 'badge-type-equity';
  return `<span class="badge-type ${cls}">${escapeHtml(k)}</span>`;
}

function dashOrPct(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${fmtSigned(n, digits)}%`;
}

function dashOrIndex(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(2);
}

/**
 * Build per-channel rows for the channel detail table.
 * Prefer server `byChannel` on live; on archive / filter rebuild from positions.
 */
function channelRowsForView(view) {
  if (Array.isArray(view.byChannel) && view.byChannel.length > 0) {
    if (view.channelView === MERGED_CHANNEL_VIEW) {
      return view.byChannel.map((c) => ({ ...c, channel: resolveDashboardChannel(c.channel) }));
    }
    const one = view.byChannel.find(
      (c) => resolveDashboardChannel(c.channel) === view.channelView,
    );
    if (one) return [{ ...one, channel: resolveDashboardChannel(one.channel) }];
  }

  // Rebuild from filtered view (archive dates or missing byChannel).
  const channels =
    view.channelView === MERGED_CHANNEL_VIEW
      ? view.channels && view.channels.length > 0
        ? view.channels
        : [...new Set(view.positions.map((p) => resolveDashboardChannel(p.channel)))].sort(
            (a, b) => {
              if (a === DEFAULT_CHANNEL) return -1;
              if (b === DEFAULT_CHANNEL) return 1;
              return a.localeCompare(b);
            },
          )
      : [view.channelView];

  return channels.map((ch) => {
    const pos = view.positions.filter((p) => resolveDashboardChannel(p.channel) === ch);
    let positionsValue = 0;
    let totalCost = 0;
    let equityValue = 0;
    let equityCost = 0;
    let equityCount = 0;
    let optionCount = 0;
    let fundCount = 0;
    let optionsPremiumCollected = 0;
    let optionsPremiumPaid = 0;
    let contingentCashObligation = 0;
    let contingentShareObligation = 0;
    for (const p of pos) {
      positionsValue += p.value;
      totalCost += p.cost;
      if (p.instrument === 'option') {
        optionCount += 1;
        contingentCashObligation += p.contingentCashObligation || 0;
        contingentShareObligation += p.contingentShareObligation || 0;
        if (p.option?.side === 'short') optionsPremiumCollected += p.premiumAbsolute || 0;
        else optionsPremiumPaid += p.premiumAbsolute || 0;
      } else if (p.instrument === 'fund') {
        fundCount += 1;
        equityValue += p.value;
        equityCost += p.cost;
      } else {
        equityCount += 1;
        equityValue += p.value;
        equityCost += p.cost;
      }
    }
    const deposits = (view.deposits || []).filter(
      (d) => resolveDashboardChannel(d.channel) === ch,
    );
    const depositsAmount = deposits.reduce((s, d) => s + Number(d.amount), 0);
    const depositsCurrency =
      deposits.length > 0 ? deposits[0].currency : view.depositsCurrency ?? null;
    let cashAmount = null;
    let cashCurrency = null;
    if (view.channelView !== MERGED_CHANNEL_VIEW) {
      cashAmount = view.cashAmount ?? null;
      cashCurrency = view.cashCurrency ?? null;
    } else if (view.cashChannel != null && resolveDashboardChannel(view.cashChannel) === ch) {
      cashAmount = view.cashAmount ?? null;
      cashCurrency = view.cashCurrency ?? null;
    }
    const totalPL = positionsValue - totalCost;
    let totalValue = positionsValue;
    if (cashAmount != null) totalValue += cashAmount;
    totalValue += depositsAmount;
    return {
      channel: ch,
      positionCount: pos.length,
      equityCount,
      optionCount,
      fundCount,
      positionsValue,
      totalCost,
      totalPL,
      totalPLPct: totalCost !== 0 ? (totalPL / Math.abs(totalCost)) * 100 : 0,
      cashAmount,
      cashCurrency,
      depositsAmount,
      depositsCurrency,
      depositCount: deposits.length,
      totalValue,
      cashWeightPct:
        cashAmount != null && totalValue !== 0 ? (cashAmount / totalValue) * 100 : null,
      equityValue,
      equityCost,
      optionsPremiumCollected,
      optionsPremiumPaid,
      contingentCashObligation,
      contingentShareObligation,
    };
  });
}

function renderChannelDetailTable(view) {
  if (!el.channelDetailBody) return;
  const rows = channelRowsForView(view);
  const baseDate = payload.benchmark?.baseDate || 'cost basis';
  const repCcy = reportingCcyCode(view);
  const scope =
    view.channelView === MERGED_CHANNEL_VIEW
      ? `All channels (merged) · ${rows.length} channel${rows.length === 1 ? '' : 's'}`
      : `Channel: ${view.channelLabel || view.channelView}`;

  if (el.channelDetailMeta) {
    el.channelDetailMeta.textContent =
      `${scope} · Cost base ${baseDate} · Positions cost ${fmtMoney0(view.totalCost, repCcy)}` +
      ` · NAV ${fmtMoney0(view.totalValue, repCcy)}` +
      ` · Fund idx ${dashOrIndex(view.fundIndex)}` +
      (view.benchmarkIndex != null
        ? ` · Bench ${dashOrIndex(view.benchmarkIndex)} (${fmtSigned(view.diff)})`
        : ' · Bench n/a') +
      fxFootnote(view);
  }

  const bodyRows = rows.map((c) => {
    const chIdx = portfolioFundIndex({
      equityCost: c.equityCost,
      equityValue: c.equityValue,
      totalValue: c.totalValue,
      totalCost: c.totalCost,
    });
    const chDiff = view.benchmarkIndex == null ? null : chIdx - view.benchmarkIndex;
    const mix = `${c.equityCount || 0} / ${c.optionCount || 0} / ${c.fundCount || 0}`;
    const cashCell =
      c.cashAmount != null ? fmtMoney0(c.cashAmount, c.cashCurrency) : '—';
    const fdCell =
      c.depositsAmount != null && c.depositsAmount > 0
        ? `${fmtUsd0(c.depositsAmount)}${
            c.depositCount
              ? `<div class="muted">${c.depositCount} term${c.depositCount === 1 ? '' : 's'}</div>`
              : ''
          }`
        : '—';
    return `<tr>
      <td>${channelBadgeHtml(c.channel)}</td>
      <td class="num">${c.positionCount}</td>
      <td class="num">${mix}</td>
      <td class="num">${fmtUsd0(c.positionsValue)}</td>
      <td class="num">${fmtUsd0(c.totalCost)}</td>
      <td class="num ${plClass(c.totalPL)}">${fmtSignedUsd0(c.totalPL)}</td>
      <td class="num ${plClass(c.totalPLPct)}">${dashOrPct(c.totalPLPct)}</td>
      <td class="num">${cashCell}</td>
      <td class="num">${fdCell}</td>
      <td class="num">${fmtUsd0(c.totalValue)}</td>
      <td class="num">${c.cashWeightPct != null ? c.cashWeightPct.toFixed(1) + '%' : '—'}</td>
      <td class="num">${dashOrIndex(chIdx)}</td>
      <td class="num ${chDiff == null ? 'pl-flat' : plClass(chDiff)}">${
        chDiff == null ? '—' : fmtSigned(chDiff)
      }</td>
    </tr>`;
  });

  // Totals row when showing more than one channel.
  if (rows.length > 1) {
    bodyRows.push(`<tr class="totals-row">
      <td>All (merged)</td>
      <td class="num">${view.positions.length}</td>
      <td class="num">${view.equityCount || 0} / ${view.optionCount || 0} / ${view.fundCount || 0}</td>
      <td class="num">${fmtUsd0(view.positionsValue ?? 0)}</td>
      <td class="num">${fmtUsd0(view.totalCost)}</td>
      <td class="num ${plClass(view.totalPL)}">${fmtSignedUsd0(view.totalPL)}</td>
      <td class="num ${plClass(view.totalPLPct)}">${dashOrPct(view.totalPLPct)}</td>
      <td class="num">${
        view.cashAmount != null
          ? fmtMoney0(view.cashAmount, view.cashCurrency)
          : '—'
      }</td>
      <td class="num">${
        Number(view.depositsAmount || 0) > 0 ? fmtUsd0(view.depositsAmount) : '—'
      }</td>
      <td class="num">${fmtUsd0(view.totalValue)}</td>
      <td class="num">${
        view.cashWeightPct != null ? view.cashWeightPct.toFixed(1) + '%' : '—'
      }</td>
      <td class="num">${dashOrIndex(view.fundIndex)}</td>
      <td class="num ${view.diff == null ? 'pl-flat' : plClass(view.diff)}">${
        view.diff == null ? '—' : fmtSigned(view.diff)
      }</td>
    </tr>`);
  }

  if (bodyRows.length === 0) {
    el.channelDetailBody.innerHTML =
      '<tr><td colspan="13" class="muted" style="text-align:center;padding:1.5rem">No channel data for this view.</td></tr>';
    return;
  }
  el.channelDetailBody.innerHTML = bodyRows.join('');
}

function positionNotes(p) {
  const notes = [];
  if (p.instrument === 'option') {
    if (p.option?.side) notes.push(p.option.side);
    if (p.option?.right) notes.push(p.option.right);
    if (p.option?.expiry) notes.push(`exp ${p.option.expiry}`);
    if (p.option?.strike != null) notes.push(`K ${p.option.strike}`);
    if (p.contingentCashObligation > 0) {
      notes.push(`if assigned cash ${fmtUsd0(p.contingentCashObligation)}`);
    }
    if (p.contingentShareObligation > 0) {
      notes.push(`if assigned ${p.contingentShareObligation} sh`);
    }
    if (p.premiumAbsolute) notes.push(`prem abs ${fmtUsd2(p.premiumAbsolute)}`);
    if (p.contractSymbol) notes.push(p.contractSymbol);
  }
  if (p.instrument === 'fund' && p.fund?.quote_source) {
    notes.push(`quote ${p.fund.quote_source}`);
  }
  if (p.markNote) notes.push(p.markNote);
  if (p.pricingMode === 'cost' || p.markSource === 'cost') {
    notes.push('book cost (no live quote)');
  }
  return notes.join(' · ');
}

function pricingLabel(p) {
  if (p.pricingMode) return p.pricingMode;
  if (p.markSource) return p.markSource;
  return 'live';
}

function renderHoldingsDetailTable(view) {
  if (!el.holdingsDetailBody) return;
  const positions = [...(view.positions || [])].sort((a, b) => {
    const ca = resolveDashboardChannel(a.channel);
    const cb = resolveDashboardChannel(b.channel);
    if (ca !== cb) {
      if (ca === DEFAULT_CHANNEL) return -1;
      if (cb === DEFAULT_CHANNEL) return 1;
      return ca.localeCompare(cb);
    }
    return Math.abs(b.value) - Math.abs(a.value);
  });

  if (el.holdingsDetailMeta) {
    const optNote =
      (view.optionCount || 0) > 0
        ? ` · ${view.optionCount} option · prem coll. ${fmtUsd0(view.optionsPremiumCollected || 0)} · oblig. ${fmtUsd0(view.contingentCashObligation || 0)}`
        : '';
    el.holdingsDetailMeta.textContent =
      `${positions.length} holding${positions.length === 1 ? '' : 's'}` +
      (view.channelView === MERGED_CHANNEL_VIEW
        ? ` across ${(view.channels || []).join(', ') || DEFAULT_CHANNEL}`
        : ` on ${view.channelLabel || view.channelView}`) +
      optNote;
  }

  if (positions.length === 0) {
    el.holdingsDetailBody.innerHTML =
      '<tr><td colspan="15" class="muted" style="text-align:center;padding:1.5rem">No holdings in this view.</td></tr>';
    return;
  }

  const showGroup =
    view.channelView === MERGED_CHANNEL_VIEW &&
    new Set(positions.map((p) => resolveDashboardChannel(p.channel))).size > 1;

  const parts = [];
  let lastCh = null;
  for (const p of positions) {
    const ch = resolveDashboardChannel(p.channel);
    if (showGroup && ch !== lastCh) {
      parts.push(
        `<tr class="channel-group"><td colspan="15">${channelBadgeHtml(ch)} · channel detail</td></tr>`,
      );
      lastCh = ch;
    }
    const isOpt = p.instrument === 'option';
    const isFund = p.instrument === 'fund';
    const atCost = p.pricingMode === 'cost' || p.markSource === 'cost';
    const pIdx = isOpt ? 100 + (p.plPct || 0) : fundIndex(p.value, p.cost);
    const title = isOpt || isFund ? p.label || p.ticker : p.ticker;
    const unitsLabel = isOpt ? `${p.units} ct` : String(p.units);
    const notes = positionNotes(p);
    const pricing =
      (atCost ? '<span class="badge-cost">BOOK COST</span> ' : '') +
      escapeHtml(pricingLabel(p));

    parts.push(`<tr class="sub-row">
      <td>${channelBadgeHtml(ch)}</td>
      <td>
        <div style="font-weight:600">${escapeHtml(title)}</div>
        ${
          title !== p.ticker
            ? `<div class="muted">${escapeHtml(p.ticker)}</div>`
            : ''
        }
      </td>
      <td>${typeBadgeHtml(p.instrument || 'equity')}</td>
      <td>${escapeHtml(p.category || '—')}</td>
      <td class="num">${escapeHtml(unitsLabel)}</td>
      <td class="num">${fmtUsd2(p.avgCost)}</td>
      <td class="num">${fmtUsd2(p.price)}</td>
      <td class="num">${fmtUsd0(p.cost)}</td>
      <td class="num">${fmtUsd0(p.value)}</td>
      <td class="num">${Number(p.weightPct || 0).toFixed(1)}%</td>
      <td class="num ${plClass(p.pl)}">${fmtSignedUsd0(p.pl)}</td>
      <td class="num ${plClass(p.plPct)}">${dashOrPct(p.plPct)}</td>
      <td class="num">${dashOrIndex(pIdx)}</td>
      <td>${pricing}</td>
      <td>${notes ? escapeHtml(notes) : '—'}</td>
    </tr>`);
  }

  // Cash + FD as trailing rows: per channel when multi-broker, else single summary.
  const channelRows = channelRowsForView(view);
  const multiCash =
    channelRows.filter((c) => c.cashAmount != null && c.cashAmount !== 0).length > 1;
  if (multiCash) {
    for (const c of channelRows) {
      if (c.cashAmount == null) continue;
      const wt =
        view.totalValue !== 0 ? (c.cashAmount / view.totalValue) * 100 : null;
      parts.push(`<tr class="sub-row">
        <td>${channelBadgeHtml(c.channel)}</td>
        <td><div style="font-weight:600">Free cash</div></td>
        <td>${typeBadgeHtml('cash')}</td>
        <td>Cash</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">${fmtMoney0(c.cashAmount, c.cashCurrency)}</td>
        <td class="num">${wt != null ? wt.toFixed(1) + '%' : '—'}</td>
        <td class="num pl-flat">—</td>
        <td class="num pl-flat">—</td>
        <td class="num">—</td>
        <td>cash</td>
        <td>Deployable · not positions MTM</td>
      </tr>`);
    }
  } else if (view.cashAmount != null) {
    parts.push(`<tr class="sub-row">
      <td>${view.cashChannel ? channelBadgeHtml(view.cashChannel) : '—'}</td>
      <td><div style="font-weight:600">Free cash</div></td>
      <td>${typeBadgeHtml('cash')}</td>
      <td>Cash</td>
      <td class="num">—</td>
      <td class="num">—</td>
      <td class="num">—</td>
      <td class="num">—</td>
      <td class="num">${fmtMoney0(view.cashAmount, view.cashCurrency)}</td>
      <td class="num">${
        view.cashWeightPct != null ? view.cashWeightPct.toFixed(1) + '%' : '—'
      }</td>
      <td class="num pl-flat">—</td>
      <td class="num pl-flat">—</td>
      <td class="num">—</td>
      <td>cash</td>
      <td>Deployable · not positions MTM</td>
    </tr>`);
  }

  const deposits = view.deposits || [];
  if (deposits.length > 0) {
    for (const d of deposits) {
      const ch = resolveDashboardChannel(d.channel);
      const label = d.label || d.id;
      const status = d.matured
        ? 'matured'
        : `${d.daysRemaining}d to maturity`;
      parts.push(`<tr class="sub-row">
        <td>${channelBadgeHtml(ch)}</td>
        <td>
          <div style="font-weight:600">${escapeHtml(label)}</div>
          <div class="muted">${escapeHtml(d.id)}</div>
        </td>
        <td>${typeBadgeHtml('deposit')}</td>
        <td>Deposits</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">${fmtUsd2(d.amount)}</td>
        <td class="num">—</td>
        <td class="num pl-flat">—</td>
        <td class="num pl-flat">—</td>
        <td class="num">—</td>
        <td>principal</td>
        <td>${escapeHtml(d.start_date)} → ${escapeHtml(d.end_date)} · interest ${fmtUsd2(d.interest)} · ${status}</td>
      </tr>`);
    }
  } else if (Number(view.depositsAmount || 0) > 0) {
    parts.push(`<tr class="sub-row">
      <td>—</td>
      <td>
        <div style="font-weight:600">Fixed deposits</div>
        <div class="muted">${view.depositCount || 0} term${(view.depositCount || 0) === 1 ? '' : 's'}</div>
      </td>
      <td>${typeBadgeHtml('deposit')}</td>
      <td>Deposits</td>
      <td class="num">—</td>
      <td class="num">—</td>
      <td class="num">—</td>
      <td class="num">—</td>
      <td class="num">${fmtUsd0(view.depositsAmount)}</td>
      <td class="num">—</td>
      <td class="num pl-flat">—</td>
      <td class="num pl-flat">—</td>
      <td class="num">—</td>
      <td>principal</td>
      <td>In NAV · not free cash · interest display-only</td>
    </tr>`);
  }

  el.holdingsDetailBody.innerHTML = parts.join('');
}

function renderDetailTables(view) {
  renderChannelDetailTable(view);
  renderHoldingsDetailTable(view);
}

/**
 * Snapshot hero + KPI cards (Wheel Desk layout). Unknown broker metrics stay "—".
 */
function renderOverview(view) {
  const repCcy = reportingCcyCode(view);
  const channels = Array.isArray(view.channels) ? view.channels : [];
  const asOf = view.isLive
    ? (payload.generatedAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    : view.label;
  const brokerNames = channels
    .filter((c) => c && c !== DEFAULT_CHANNEL)
    .join(', ');

  if (el.deskEyebrow) {
    const consultant = payload.productProfile === 'consultant';
    if (view.channelView === MERGED_CHANNEL_VIEW) {
      el.deskEyebrow.textContent = consultant
        ? channels.length > 1
          ? 'Multi-broker desk'
          : channels[0] && channels[0] !== DEFAULT_CHANNEL
            ? `${channels[0]} desk`
            : 'Desk'
        : 'Multi-broker';
    } else {
      el.deskEyebrow.textContent = consultant
        ? `${view.channelLabel || view.channelView} desk`
        : `Channel · ${view.channelLabel || view.channelView}`;
    }
  }
  if (el.heroDate) {
    el.heroDate.textContent = longDateLabel(asOf);
  }
  if (el.heroLead) {
    const n = view.positionCount || 0;
    const e = view.equityCount || 0;
    const o = view.optionCount || 0;
    const f = view.fundCount || 0;
    const archive = view.isLive ? '' : (() => {
      const row = payload.model?.history?.find(item => item.date === view.label);
      const dates = Object.entries(row?.brokerAsOf || {});
      return dates.length
        ? ` Broker positions as of ${dates.map(([channel, date]) => `${channel} ${date}`).join(', ')}.`
        : ' Broker position dates unavailable for this older snapshot.';
    })();
    const positionDates = view.isLive ? Object.entries(payload.brokerAsOf || {})
      .filter(([channel]) => view.channelView === MERGED_CHANNEL_VIEW || channel === view.channelView)
      .map(([channel, date]) => `${channel.toUpperCase()} ${optionDateLabel(date)}`) : [];
    el.heroLead.textContent = `${n} holdings — ${e} equity, ${o} option, ${f} fund. Pick a date to replay saved valuations.${archive}${view.isLive && positionDates.length ? ` Broker positions as of ${positionDates.join(' · ')}.` : ''}`;
  }
  if (el.navValue) {
    el.navValue.textContent = fmtPrettyMoney(view.totalValue, repCcy, 2);
  }
  if (el.navDelta) {
    const hist = payload.model?.history || [];
    const prior = [...hist].reverse().find((h) => h.date < asOf) || hist[hist.length - 1];
    if (view.isLive && hist.length > 0) {
      const last = hist[hist.length - 1];
      const delta = view.totalValue - last.totalValue;
      const pct = last.totalValue ? (delta / last.totalValue) * 100 : null;
      el.navDelta.className = 'metric-sub ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '');
      el.navDelta.textContent =
        `${fmtSignedUsd0(delta)}` +
        (pct != null ? ` · ${fmtSigned(pct, 2)}% on ${last.date}` : ` vs ${last.date}`);
    } else if (prior && prior.date !== asOf) {
      const delta = view.totalValue - prior.totalValue;
      el.navDelta.className = 'metric-sub ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '');
      el.navDelta.textContent = `${fmtSignedUsd0(delta)} vs ${prior.date}`;
    } else {
      el.navDelta.className = 'metric-sub';
      el.navDelta.textContent = view.isLive ? 'Live marks' : `Archived ${view.label}`;
    }
    if (unverifiedOptionChannels(view).length) {
      el.navDelta.textContent += ' · option positions unverified';
    }
  }

  const cashCcy = view.cashCurrency || repCcy;
  const premiumDate = view.isLive ? (payload.generatedAt || '').slice(0, 10) : view.label;
  const premium = recordedPremiumForView(view, premiumDate);
  const puts = (view.positions || []).filter(p => p.instrument === 'option' && p.option?.side === 'short' && p.option.right === 'put');
  const putAmounts = puts.map(p => {
    if (!p.currency || !cashCcy) return null;
    const amount = Number(p.contingentCashObligation || 0);
    if (p.currency === cashCcy) return amount;
    const rate = view.fxApplied ? view.fxRates?.[p.currency] : null;
    return Number.isFinite(rate) && rate > 0 ? amount * rate : null;
  });
  const putObligation = putAmounts.every(amount => amount != null)
    ? putAmounts.reduce((total, amount) => total + amount, 0) : null;
  const stalePuts = unverifiedOptionChannels(view).some(channel => puts.some(p => p.channel === channel));
  const cashAfter = view.cashAmount == null || putObligation == null || stalePuts
    ? null : view.cashAmount - putObligation;

  if (el.kpiRow) {
    el.kpiRow.innerHTML = [
      metricCardHtml('Net premium · Daily', premium.daily == null ? '—' : fmtPrettyMoney(premium.daily, repCcy, 0),
        premium.daily == null ? premium.reason : `Recorded net option fills · ${optionDateLabel(premiumDate)}`,
        'Sell-to-open plus buy-to-close cash flow, including commissions, from imported executions only. Missing fills are not treated as zero.',
        premium.daily > 0 ? 'up' : premium.daily < 0 ? 'down' : ''),
      metricCardHtml('Net premium · MTD', premium.mtd == null ? '—' : fmtPrettyMoney(premium.mtd, repCcy, 0),
        premium.mtd == null ? premium.reason : `Recorded net option fills · ${optionDateLabel(`${premiumDate.slice(0, 7)}-01`)} to ${optionDateLabel(premiumDate)}`,
        'Month-to-date sell-to-open plus buy-to-close cash flow, including commissions, from imported executions only.',
        premium.mtd > 0 ? 'up' : premium.mtd < 0 ? 'down' : ''),
      metricCardHtml(
        'Cash available',
        view.cashAmount != null ? fmtPrettyMoney(view.cashAmount, cashCcy, 0) : '—',
        view.cashAmount != null ? 'Free cash (not deposits)' : 'Cash not recorded',
        'Recorded free cash, excluding fixed deposits. Missing cash is unknown, not zero.',
      ),
      metricCardHtml('Cash after all puts assigned', cashAfter == null ? '—' : fmtPrettyMoney(cashAfter, cashCcy, 0),
        cashAfter == null ? (view.cashAmount == null ? 'Cash not recorded' : stalePuts ? 'Put positions need a fresh broker sync' : 'Put currency or FX unavailable') : `Free cash less ${fmtPrettyMoney(putObligation, cashCcy, 0)} put obligation`,
        'Scenario: every open short put is assigned. Negative means a cash shortfall; margin capacity is excluded.',
        cashAfter != null && cashAfter < 0 ? 'down' : ''),
    ].join('');
  }

  renderExpiryRisk(view, asOf);
  renderChannelPills(view);
}

function renderExpiryRisk(view, asOf) {
  if (!el.expiryRow) return;
  const hasOptions = (view.optionCount || 0) > 0;
  if (el.expiryBlock) el.expiryBlock.classList.toggle('hidden', !hasOptions);
  if (el.expiryTitle) {
    const consultant = payload.productProfile === 'consultant';
    el.expiryTitle.innerHTML = consultant
      ? '<span class="bar"></span>Expiry calendar &amp; assignment risk'
      : '<span class="bar"></span>Option expiries &amp; obligations';
  }
  if (!hasOptions) {
    if (el.expiryTable) el.expiryTable.innerHTML = '';
    renderPremiumEngine(view);
    renderOpenOptions(view);
    return;
  }
  const prices = view.isLive ? payload?.equityPrices || {} : {};
  const shorts = (view.positions || []).filter(
    (p) => p.instrument === 'option' && p.option?.side === 'short',
  );
  const rows = shorts.map((p) => {
    const o = p.option;
    const spot = prices[o.underlying];
    const days = daysToExpiry(o.expiry, asOf);
    const estimate = view.isLive && days < 0
      ? { probability: null, iv: null, reason: 'Past expiry; broker status unverified' }
      : optionFinishItmProbability(p, spot, days);
    const exposure = o.right === 'put'
      ? Number(p.contingentCashObligation || 0)
      : Number(o.strike) * Number(p.contingentShareObligation || 0);
    return { p, spot, days, estimate, exposure };
  });
  const radar = rows.filter((r) => r.estimate.probability > 0.3 && Number.isFinite(r.exposure) && r.exposure > 0);
  const missing = rows.filter((r) => r.estimate.probability == null).length;
  const exposure = radar.reduce((sum, r) => sum + r.exposure, 0);
  const weighted = radar.reduce((sum, r) => sum + r.exposure * r.estimate.probability, 0);
  const cash = view.cashAmount;
  const cover = exposure > 0 && cash != null ? (cash / exposure) * 100 : null;

  if (el.expiryLead) {
    el.expiryLead.textContent =
      shorts.length === 0
        ? 'No short option lots in this view. Section 03 (holdings table) lists every open position.'
        : `The risk radar prioritizes open contracts with probability of finishing in the money above 30%, sorted by nearest expiry first and then by risk. Use All open to inspect the other contracts; when none qualify, they appear automatically. Section 03 contains the complete open-positions ledger. Click a ticker to highlight the same underlying in Section 03.${missing ? ` ${missing} contract${missing === 1 ? '' : 's'} could not be scored from the available quote and mark.` : ''}`;
  }

  el.expiryRow.innerHTML = [
    metricCardHtml(
      'High-risk ITM exposure',
      radar.length ? fmtPrettyMoney(exposure, reportingCcyCode(view), 0) : '—',
      '',
      'Capital involved if every contract in this high-risk list finished in the money and was assigned or called away. This is the theoretical ceiling for the filtered radar, not the expected outcome.',
    ),
    metricCardHtml(
      'Probability-weighted exposure',
      radar.length ? fmtPrettyMoney(weighted, reportingCcyCode(view), 0) : '—',
      '',
      'Assignment capital weighted by each contract’s modeled probability of finishing in the money.',
      radar.length ? 'down' : '',
    ),
    metricCardHtml(
      'Cash available',
      cash != null ? fmtPrettyMoney(cash, view.cashCurrency || reportingCcyCode(view), 0) : '—',
      '',
      'Free cash in the account at the time of the broker pull. Margin capacity is separate from free cash.',
    ),
    metricCardHtml(
      'High-risk coverage',
      cover != null ? `${cover.toFixed(0)}%` : '—',
      '',
      'Share of the high-risk bill that recorded free cash could cover. This is not a margin-requirement ratio.',
      cover != null && cover < 100 ? 'down' : '',
    ),
  ].join('');

  if (el.expiryTable) {
    if (shorts.length === 0) {
      el.expiryTable.innerHTML = emptyCard('No short option lots in this view.');
    } else {
      const brokers = [...new Set(shorts.map((p) => p.channel))].sort();
      if (riskBrokerFilter !== 'all' && !brokers.includes(riskBrokerFilter)) riskBrokerFilter = 'all';
      const chip = (kind, value, label, selected) =>
        `<button type="button" class="chip-btn${selected ? ' on' : ''}" data-risk-${kind}="${escapeHtml(value)}" aria-pressed="${selected}">${escapeHtml(label)}</button>`;
      const showAll = riskShowAll || radar.length === 0;
      const filtered = (showAll ? rows : radar).filter((r) =>
        (riskBrokerFilter === 'all' || r.p.channel === riskBrokerFilter) &&
        (riskRightFilter === 'all' || r.p.option.right === riskRightFilter),
      ).sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || (b.estimate.probability ?? -1) - (a.estimate.probability ?? -1));
      const head = ['Contract', 'Spot', 'Strike', 'Moneyness %', 'Expiry', 'DTE', 'IV', 'Premium', 'If assigned', 'Prob. ITM', 'Broker'];
      el.expiryTable.innerHTML = `<div class="metric-card table-card risk-card">
        <div class="risk-toolbar">
          <div class="option-filter-group"><span class="label-eyebrow">Broker</span>
            ${chip('broker', 'all', 'All', riskBrokerFilter === 'all')}
            ${brokers.map((b) => chip('broker', b, b === DEFAULT_CHANNEL ? 'Unassigned' : b.toUpperCase(), riskBrokerFilter === b)).join('')}
          </div>
          <div class="option-filter-group"><span class="label-eyebrow">Right</span>
            ${['all', 'put', 'call'].map((r) => chip('right', r, r === 'all' ? 'All' : r.toUpperCase(), riskRightFilter === r)).join('')}
          </div>
          <div class="option-filter-group"><span class="label-eyebrow">Show</span>
            ${chip('scope', 'high', 'Above 30%', !showAll)}${chip('scope', 'all', 'All open', showAll)}
          </div>
          <div class="risk-legend">${riskPill('danger', 'Act now >60%')}${riskPill('warning', 'Caution 45–60%')}${riskPill('ok', 'Comfortable')}<span>${radar.length} of ${shorts.length} above 30%</span></div>
        </div>${radar.length === 0 ? `<div class="risk-empty-note">No contracts are currently scored above 30%; showing all ${shorts.length} open short contracts. ${missing ? `${missing} could not be scored from the available quote and mark.` : 'All scored contracts are below the threshold.'}</div>` : ''}<div class="table-scroll"><table class="report risk-table">
        <thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${filtered.length ? filtered.map(({ p, spot, days, estimate, exposure: assigned }) => {
            const o = p.option;
            const probability = estimate.probability == null ? null : Math.round(estimate.probability * 100);
            const tone = probability == null ? 'muted' : probability > 60 ? 'danger' : probability >= 45 ? 'warning' : 'ok';
            const status = probability == null ? estimate.reason : probability > 60 ? 'Act now' : probability >= 45 ? 'Watch' : probability > 30 ? 'OK' : 'Below 30%';
            const moneyness = spot > 0 && o.strike > 0 ? ((spot - o.strike) / o.strike) * 100 : null;
            const itm = moneyness != null && (o.right === 'put' ? moneyness < 0 : moneyness > 0);
            const premium = Number(p.premiumAbsolute || Number(p.avgCost) * Number(p.units));
            return `<tr class="risk-row risk-row-${tone}" data-risk-underlying="${escapeHtml(o.underlying)}" tabindex="0" aria-label="Highlight ${escapeHtml(o.underlying)} in open options">
              <td><span class="risk-contract">${tone === 'danger' ? '<span class="pulse-dot" aria-hidden="true"></span>' : ''}<strong>${escapeHtml(o.underlying || p.ticker)}</strong><span class="risk-contract-meta">${escapeHtml(o.right.toUpperCase())} · ${o.right === 'put' ? 'CSP' : 'CC'} · ${p.units}x</span></span></td>
              <td class="num">${spot > 0 ? Number(spot).toFixed(2) : '—'}</td>
              <td class="num">${fmtPrettyMoney(o.strike, reportingCcyCode(view), 0)}</td>
              <td class="num ${itm ? 'down' : 'muted'}">${moneyness == null ? '—' : `${moneyness >= 0 ? '+' : ''}${moneyness.toFixed(1)}%`}</td>
              <td class="num">${escapeHtml(new Date(`${o.expiry}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replaceAll(' ', '-').toUpperCase())}</td>
              <td class="num">${days == null ? '—' : `${days}d`}</td>
              <td class="num muted">${estimate.iv == null ? '—' : `${Math.round(estimate.iv * 100)}%`}</td>
              <td class="num">${Number.isFinite(premium) ? fmtPrettyMoney(premium, reportingCcyCode(view), 2) : '—'}</td>
              <td class="num muted">${Number.isFinite(assigned) && assigned > 0 ? fmtPrettyMoney(assigned, reportingCcyCode(view), 0) : '—'}</td>
              <td>${riskPill(tone, probability == null ? `— · ${status}` : `${probability}% · ${status}`)}</td>
              <td>${escapeHtml(p.channel === DEFAULT_CHANNEL ? 'Unassigned' : p.channel.toUpperCase())}</td>
            </tr>`;
          }).join('') : '<tr><td colspan="11" class="empty">No open short contracts match these filters.</td></tr>'}</tbody></table></div>
        <div class="risk-method">How Prob. ITM is calculated — implied volatility is solved from each contract’s mark, then used in Black–Scholes N(−d₂) for puts or N(d₂) for calls, with a zero rate and no dividend adjustment. Unscored contracts remain visible in All open and are excluded from risk totals.</div>
      </div>`;
    }
  }
  renderPremiumEngine(view);
  renderOpenOptions(view);
}

el.expiryTable?.addEventListener('click', (event) => {
  const chip = event.target.closest('button');
  if (chip?.dataset.riskBroker != null) riskBrokerFilter = chip.dataset.riskBroker;
  else if (chip?.dataset.riskRight != null) riskRightFilter = chip.dataset.riskRight;
  else if (chip?.dataset.riskScope != null) riskShowAll = chip.dataset.riskScope === 'all';
  else {
    const row = event.target.closest('[data-risk-underlying]');
    if (!row) return;
    highlightedUnderlying = row.dataset.riskUnderlying;
    optionBrokerFilter = 'all';
    optionRightFilter = 'all';
    const view = buildView(selectedDate, selectedChannel);
    if (view) renderOpenOptions(view);
    const match = [...el.openOptions.querySelectorAll('[data-option-underlying]')]
      .find((item) => item.dataset.optionUnderlying === highlightedUnderlying);
    match?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const view = buildView(selectedDate, selectedChannel);
  if (view) renderExpiryRisk(view, view.isLive ? (payload.generatedAt || '').slice(0, 10) : view.label);
});

el.expiryTable?.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-risk-underlying]')) {
    event.preventDefault();
    event.target.click();
  }
});

function renderPremiumEngine(view) {
  if (!el.premiumEngine || !el.premiumBlock) return;
  const opts = (view.positions || []).filter((p) => p.instrument === 'option' && p.option);
  if (opts.length === 0) {
    el.premiumBlock.classList.add('hidden');
    el.premiumEngine.innerHTML = '';
    return;
  }
  el.premiumBlock.classList.remove('hidden');
  const consultant = payload.productProfile === 'consultant';
  if (el.premiumHead) {
    el.premiumHead.innerHTML = sectionHead(
      'Section 02',
      consultant ? 'Premium engine' : 'Premium by expiry',
      'Premium sold and open P&L bucketed by expiry month from the current open book. Not lifetime premium.',
    );
  }
  const byMonth = {};
  const byUnd = {};
  for (const p of opts) {
    const m = p.option.expiry.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { prem: 0, pl: 0 };
    if (p.option.side === 'short') byMonth[m].prem += Number(p.premiumAbsolute || 0);
    byMonth[m].pl += Number(p.pl || 0);
    const u = p.option.underlying || p.ticker;
    if (!byUnd[u]) byUnd[u] = 0;
    if (p.option.side === 'short') byUnd[u] += Number(p.premiumAbsolute || 0);
  }
  const months = Object.keys(byMonth).sort();
  const ccy = reportingCcyCode(view);
  const premRows = months.map((m) => ({
    label: m,
    value: byMonth[m].prem,
    display: fmtPrettyMoney(byMonth[m].prem, ccy, 0),
  }));
  const plRows = months.map((m) => ({
    label: m,
    value: byMonth[m].pl,
    display: fmtPrettyMoney(byMonth[m].pl, ccy, 0),
  }));
  const undRows = Object.entries(byUnd)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value, display: fmtPrettyMoney(value, ccy, 0) }));
  const concSrc = [...(view.positions || [])]
    .map((p) => ({ label: p.ticker, value: Number(p.weightPct || 0), display: `${Number(p.weightPct || 0).toFixed(1)}%` }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  if (view.cashWeightPct != null) {
    concSrc.push({
      label: 'Cash',
      value: view.cashWeightPct,
      display: `${view.cashWeightPct.toFixed(1)}%`,
    });
    concSrc.sort((a, b) => b.value - a.value);
  }
  el.premiumEngine.innerHTML =
    cssBarCard('Premium sold by expiry month', premRows) +
    cssBarCard('NAV concentration', concSrc.slice(0, 8), concSrc.length ? 'Top 8 weights' : '') +
    cssBarCard('Premium by underlying', undRows, 'Top 8 underlyings') +
    cssBarCard('Open P&L by expiry month', plRows);
}

function renderOpenOptions(view) {
  if (!el.openOptions || !el.openOptionsBlock) return;
  const allOptions = (view.positions || []).filter((p) => p.instrument === 'option' && p.option);
  if (allOptions.length === 0) {
    el.openOptionsBlock.classList.add('hidden');
    el.openOptions.innerHTML = '';
    return;
  }
  el.openOptionsBlock.classList.remove('hidden');
  const unverified = unverifiedOptionChannels(view);
  const freshnessWarning = unverified.length
    ? `<div class="option-freshness-warning" role="status">Current position status is unverified for ${unverified.map(channel => `${escapeHtml(channel.toUpperCase())} (last confirmed ${optionDateLabel(payload.brokerAsOf?.[channel])})`).join(' · ')}. Refresh that broker account before treating these contracts as open today.</div>`
    : '';
  if (el.openOptionsHead) {
    const dates = view.isLive ? Object.entries(payload.brokerAsOf || {})
      .filter(([channel]) => view.channelView === MERGED_CHANNEL_VIEW || channel === view.channelView)
      .map(([channel, date]) => `${channel.toUpperCase()} ${optionDateLabel(date)}`) : [];
    el.openOptionsHead.innerHTML = sectionHead(
      'Section 03',
      'Open options positions · broker view',
      `The full open option book, grouped by expiry month. Opening dates and STO net credits require matching recorded fills; missing values stay unknown. ${dates.length ? `Broker positions as of ${dates.join(' · ')}.` : 'Broker position date unavailable.'}`,
    );
  }
  const brokers = [...new Set(allOptions.map((p) => p.channel || DEFAULT_CHANNEL))].sort();
  if (optionBrokerFilter !== 'all' && !brokers.includes(optionBrokerFilter)) optionBrokerFilter = 'all';
  const opts = allOptions.filter((p) =>
    (optionBrokerFilter === 'all' || p.channel === optionBrokerFilter) &&
    (optionRightFilter === 'all' || p.option.right === optionRightFilter),
  );
  const chip = (kind, value, label, selected) =>
    `<button type="button" class="chip-btn${selected ? ' on' : ''}" data-option-${kind}="${escapeHtml(value)}" aria-pressed="${selected}">${escapeHtml(label)}</button>`;
  const filters = `<div class="option-ledger-filters">
    <div class="option-filter-group"><span class="label-eyebrow">Broker</span>
      ${chip('broker', 'all', 'All', optionBrokerFilter === 'all')}
      ${brokers.map((b) => chip('broker', b, b === DEFAULT_CHANNEL ? 'Unassigned' : b.toUpperCase(), optionBrokerFilter === b)).join('')}
    </div>
    <div class="option-filter-group"><span class="label-eyebrow">Right</span>
      ${['all', 'put', 'call'].map((r) => chip('right', r, r.toUpperCase() === 'ALL' ? 'All' : r.toUpperCase(), optionRightFilter === r)).join('')}
    </div>
  </div>`;
  const groups = new Map();
  for (const p of opts) {
    const m = p.option.expiry.slice(0, 7);
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(p);
  }
  const months = [...groups.keys()].sort();
  const ccy = reportingCcyCode(view);
  const columns = ['Financial instrument', 'Pos', 'Opened', 'Assignment exposure', 'DTE', 'STO net credit', 'Open cost / contract', 'Mark / contract', 'Market value', 'Unrealized P&L', '% of max', 'Broker'];
  const details = (p) => {
    const o = p.option;
    const units = Number(p.units);
    const direction = o.side === 'short' ? -1 : 1;
    const mark = view.isLive && Number.isFinite(p.brokerMark) ? p.brokerMark : Number(p.price);
    const premium = Number(p.avgCost) * units;
    const marketValue = direction * mark * units;
    const pl = marketValue - direction * premium;
    const exposure = o.side === 'short'
      ? (o.right === 'put' ? 1 : -1) * o.strike * o.multiplier * units
      : 0;
    const asOf = view.isLive ? (payload?.generatedAt || '').slice(0, 10) : view.label;
    const trade = view.isLive ? payload.optionTradeDetails?.[p.ticker] : null;
    return { position: direction * units, premium, mark, marketValue, pl, exposure, trade,
      dte: daysToExpiry(o.expiry, asOf),
      captured: o.side === 'short' && premium > 0 ? (pl / premium) * 100 : null };
  };
  let body = '';
  for (const m of months) {
    const rows = groups.get(m).sort((a, b) =>
      a.option.expiry.localeCompare(b.option.expiry) ||
      a.option.underlying.localeCompare(b.option.underlying) ||
      a.option.strike - b.option.strike,
    );
    const values = rows.map((p) => ({ p, ...details(p) }));
    const sum = (key) => values.reduce((s, x) => s + x[key], 0);
    const currencies = [...new Set(values.map(x => x.p.currency || ccy))];
    const totalMoney = (n, digits = 2) => currencies.length === 1 && currencies[0]
      ? fmtPrettyMoney(n, currencies[0], digits) : '—';
    const monthLabel = new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).toUpperCase().replace(' ', " '");
    const earliest = Math.min(...values.map((x) => x.dte ?? Infinity));
    const credits = values.filter(x => x.p.option.side === 'short');
    const creditCurrencies = [...new Set(credits.map(x => x.trade?.currency))];
    const totalCredit = credits.length && credits.every(x => x.trade?.stoNetPremium != null) && creditCurrencies.length === 1
      ? fmtPrettyMoney(credits.reduce((sum, x) => sum + x.trade.stoNetPremium, 0), creditCurrencies[0], 2) : '—';
    body += `<tr class="option-month-total" data-month="${m}">
      <td><button type="button" class="option-month-toggle" data-option-month="${m}" aria-expanded="${!collapsedOptionMonths.has(m)}"><span aria-hidden="true">${collapsedOptionMonths.has(m) ? '▶' : '▼'}</span> TOTAL ${monthLabel} <span class="option-month-count">(${rows.length})</span></button></td>
      <td class="num">${sum('position')}</td>
      <td></td>
      <td class="num">${totalMoney(sum('exposure'), 0)}</td>
      <td class="num">${Number.isFinite(earliest) ? `${earliest}d earliest` : '—'}</td>
      <td class="num">${totalCredit}</td>
      <td></td><td></td><td class="num">${totalMoney(sum('marketValue'))}</td>
      <td class="num ${plClass(sum('pl'))}">${totalMoney(sum('pl'))}</td><td></td><td></td>
    </tr>`;
    if (collapsedOptionMonths.has(m)) continue;
    body += values.map(({ p, position, mark, marketValue, pl, exposure, dte, captured, trade }) => {
      const o = p.option;
      const rowMoney = (n, digits = 2) => fmtPrettyMoney(n, p.currency || ccy, digits);
      const label = `${optionUnderlyingLabel(o)} ${o.side === 'short' ? 'Short' : 'Long'} ${o.right === 'put' ? 'Put' : 'Call'} ${rowMoney(o.strike, Number.isInteger(o.strike) ? 0 : 2)} · ${optionDateLabel(o.expiry)} · ×${p.units}`;
      const opened = trade ? `${optionDateLabel(trade.openedFrom)}${trade.openedTo !== trade.openedFrom ? ` to ${optionDateLabel(trade.openedTo)}` : ''}` : '—';
      const closeButton = trade && trade.openedFrom === trade.openedTo
        ? `<button type="button" class="option-close-lookup" data-option-price="${escapeHtml(p.ticker)}" title="Look up the underlying adjusted daily close on the opening date">Daily close</button>` : '';
      return `<tr class="option-ledger-row${highlightedUnderlying === o.underlying ? ' option-underlying-highlight' : ''}" data-option-underlying="${escapeHtml(o.underlying)}">
        <td class="option-instrument">${escapeHtml(label)}</td>
        <td class="num">${position}</td>
        <td class="option-opened">${opened}${closeButton}</td>
        <td class="num">${exposure ? rowMoney(exposure, 0) : '—'}</td>
        <td class="num">${dte == null ? '—' : `${dte}d`}</td>
        <td class="num">${o.side === 'short' && trade?.stoNetPremium != null ? fmtPrettyMoney(trade.stoNetPremium, trade.currency, 2) : '—'}</td>
        <td class="num">${rowMoney(Number(p.avgCost))}</td>
        <td class="num">${rowMoney(mark)}</td>
        <td class="num">${rowMoney(marketValue)}</td>
        <td class="num ${plClass(pl)}">${rowMoney(pl)}</td>
        <td class="num ${plClass(captured)}">${captured == null ? '—' : `${captured.toFixed(1)}%`}</td>
        <td>${escapeHtml(p.channel === DEFAULT_CHANNEL ? 'Unassigned' : p.channel.toUpperCase())}</td>
      </tr>`;
    }).join('');
  }
  const markHelp = view.isLive
    ? 'Broker snapshot mark per contract when available; otherwise the displayed position mark per contract. A short option’s market value is negative.'
    : 'Captured position mark per contract. A short option’s market value is negative.';
  el.openOptions.innerHTML = `${freshnessWarning}${filters}<div class="metric-card table-card option-ledger-card"><div class="table-scroll"><table class="report option-ledger">
    <thead><tr>${columns.map((h) => `<th>${escapeHtml(h)}${h === 'Mark / contract' ? `<button type="button" class="help-dot" title="${escapeHtml(markHelp)}" aria-label="What Mark means">?</button>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${body || `<tr><td colspan="12" class="empty">No open option positions match these filters.</td></tr>`}</tbody>
  </table></div></div>`;
}

el.openOptions?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.optionPrice != null) {
    const position = button.dataset.optionPrice;
    button.disabled = true;
    button.textContent = 'Loading…';
    fetch(`/api/domain/invage/option-open-close?position=${encodeURIComponent(position)}`, { credentials: 'include' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
        button.textContent = `Adjusted close ${Number(body.adjusted_close).toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
        button.title = `${body.underlying} adjusted daily close on ${optionDateLabel(body.date)}; not the execution-time price`;
      })
      .catch(error => { button.textContent = 'Price unavailable'; button.title = error.message || String(error); });
    return;
  }
  if (button.dataset.optionBroker != null) optionBrokerFilter = button.dataset.optionBroker;
  else if (button.dataset.optionRight != null) optionRightFilter = button.dataset.optionRight;
  else if (button.dataset.optionMonth != null) {
    const month = button.dataset.optionMonth;
    if (collapsedOptionMonths.has(month)) collapsedOptionMonths.delete(month);
    else collapsedOptionMonths.add(month);
  } else return;
  const view = buildView(selectedDate, selectedChannel);
  if (view) renderOpenOptions(view);
});

function renderChannelPills(view) {
  if (!el.channelPills) return;
  const live = payload.model.live;
  const channels =
    Array.isArray(live.channels) && live.channels.length > 0 ? live.channels : [DEFAULT_CHANNEL];
  const pills = [
    { id: MERGED_CHANNEL_VIEW, label: 'All platforms' },
    ...channels.map((ch) => ({
      id: ch,
      label: ch === DEFAULT_CHANNEL ? 'Unassigned' : ch,
    })),
  ];
  el.channelPills.innerHTML = pills
    .map((p) => {
      const on = p.id === selectedChannel ? ' on' : '';
      return `<button type="button" class="chip-btn${on}" data-channel="${escapeHtml(p.id)}">${escapeHtml(p.label)}</button>`;
    })
    .join('');
}

function renderWarnings() {
  const banner = el.warningsBanner;
  if (!banner) return;
  const list = [
    ...(Array.isArray(payload?.warnings) ? payload.warnings : []),
    ...(Array.isArray(payload?.model?.live?.issues) ? payload.model.live.issues : []),
  ];
  // Dedupe by message
  const seen = new Set();
  const unique = list.filter((w) => {
    const m = w && w.message ? String(w.message) : '';
    if (!m || seen.has(m)) return false;
    seen.add(m);
    return true;
  });
  if (unique.length === 0) {
    banner.classList.remove('visible');
    banner.innerHTML = '';
    return;
  }
  banner.classList.add('visible');
  banner.innerHTML =
    `<strong>Data notes (${unique.length}) — dashboard still loaded</strong><ul>` +
    unique
      .map((w) => {
        const key = w.key ? `<code>${escapeHtml(w.key)}</code>: ` : '';
        return `<li>${key}${escapeHtml(w.message)}</li>`;
      })
      .join('') +
    '</ul>';
}

function renderAllocation(view) {
  el.allocationGrid.innerHTML = '';

  // When merged with multiple channels, also show allocation by channel.
  if (
    view.channelView === MERGED_CHANNEL_VIEW &&
    Array.isArray(view.byChannel) &&
    view.byChannel.length > 1
  ) {
    const chSectors = view.byChannel.map((c, i) => ({
      label: c.channel,
      value: Math.abs(c.totalValue),
      signed: c.totalValue,
      color: COLORS[i % COLORS.length],
    }));
    const chTotal = chSectors.reduce((s, x) => s + x.value, 0);
    const chWrapper = document.createElement('div');
    chWrapper.className = 'allocation-card';
    chWrapper.innerHTML = `
      <h3>Allocation by Channel (merged)</h3>
      <div class="total-label">NAV across brokers</div>
      <div class="total-value">${fmtUsd0(view.totalValue)}</div>
      <div class="donut-container"><canvas id="allocChannelChart"></canvas></div>
      <div class="legend-grid">
        ${chSectors
          .map((s) => {
            const pct = chTotal > 0 ? ((s.value / chTotal) * 100).toFixed(1) : '0.0';
            return `
          <div class="legend-item">
            <div class="legend-color" style="background:${s.color}"></div>
            <div>
              <div style="font-weight:600">${escapeHtml(s.label)}</div>
              <div style="font-size:0.75rem;color:#6b7280">${pct}% (NAV ${fmtUsd0(s.signed)})</div>
            </div>
          </div>`;
          })
          .join('')}
      </div>`;
    el.allocationGrid.appendChild(chWrapper);
    if (chartAvailable()) {
      charts.allocChannel = new Chart(document.getElementById('allocChannelChart').getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: chSectors.map((s) => s.label),
          datasets: [
            {
              data: chSectors.map((s) => s.value),
              backgroundColor: chSectors.map((s) => s.color),
              borderColor: '#ffffff',
              borderWidth: 3,
              hoverOffset: 8,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '50%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const pct = chTotal > 0 ? ((ctx.raw / chTotal) * 100).toFixed(1) : '0.0';
                  return `${ctx.label}: ${pct}% (NAV ${fmtUsd0(ctx.raw)})`;
                },
              },
            },
          },
        },
      });
    }
  }

  // Use |value| so short options appear in the donut without negative slices.
  const sectors = view.positions.map((p, i) => ({
    label:
      (p.label || p.ticker) +
      (view.channelView === MERGED_CHANNEL_VIEW
        ? ` · ${resolveDashboardChannel(p.channel)}`
        : ''),
    value: Math.abs(p.value),
    signed: p.value,
    color: COLORS[i % COLORS.length],
  }));
  if (view.cashAmount != null && view.cashAmount > 0) {
    sectors.push({
      label: `Cash${view.cashCurrency ? ' (' + view.cashCurrency + ')' : ''}${
        view.cashChannel ? ' · ' + view.cashChannel : ''
      }`,
      value: view.cashAmount,
      signed: view.cashAmount,
      color: COLORS[sectors.length % COLORS.length],
    });
  }
  if (Number(view.depositsAmount || 0) > 0) {
    sectors.push({
      label: `Fixed deposits${view.depositsCurrency ? ' (' + view.depositsCurrency + ')' : ''}`,
      value: Number(view.depositsAmount),
      signed: Number(view.depositsAmount),
      color: COLORS[sectors.length % COLORS.length],
    });
  }
  const absTotal = sectors.reduce((s, x) => s + x.value, 0);

  const scope =
    view.channelView === MERGED_CHANNEL_VIEW
      ? 'by Position (merged)'
      : `by Position · ${view.channelLabel || view.channelView}`;

  const posMtm = view.positionsValue ?? 0;
  const navBreakdown =
    view.cashAmount != null || Number(view.depositsAmount || 0) > 0
      ? `<div style="font-size:0.8rem;color:#6b7280;margin:4px 0 4px">
            Positions MTM: ${fmtUsd0(posMtm)}` +
        (view.cashAmount != null
          ? ` · Cash: ${fmtUsd0(view.cashAmount)}${view.cashCurrency ? ' ' + escapeHtml(view.cashCurrency) : ''}` +
            (view.cashWeightPct != null ? ` (${view.cashWeightPct.toFixed(1)}%)` : '') +
            (view.cashChannel ? ` · ch ${escapeHtml(view.cashChannel)}` : '')
          : '') +
        (Number(view.depositsAmount || 0) > 0
          ? ` · FD principal: ${fmtUsd0(view.depositsAmount)}${view.depositsCurrency ? ' ' + escapeHtml(view.depositsCurrency) : ''}`
          : '') +
        `</div>`
      : '';

  const wrapper = document.createElement('div');
  wrapper.className = 'allocation-card';
  wrapper.innerHTML = `
    <h3>Allocation ${escapeHtml(scope)}</h3>
    <div class="total-label">${view.isLive ? 'Current NAV (positions + cash + deposits)' : 'NAV · ' + escapeHtml(view.label)}</div>
    <div class="total-value">${fmtUsd0(view.totalValue)}</div>
    ${navBreakdown}
    ${
      (view.optionCount || 0) > 0
        ? `<div style="font-size:0.8rem;color:#6b7280;margin:4px 0 8px">
            Premium collected: ${fmtUsd0(view.optionsPremiumCollected || 0)} ·
            Contingent obligation: ${fmtUsd0(view.contingentCashObligation || 0)}
          </div>`
        : ''
    }
    <div class="donut-container"><canvas id="allocChart"></canvas></div>
    <div class="legend-grid">
      ${sectors
        .map((s) => {
          const pct = absTotal > 0 ? ((s.value / absTotal) * 100).toFixed(1) : '0.0';
          return `
        <div class="legend-item">
          <div class="legend-color" style="background:${s.color}"></div>
          <div>
            <div style="font-weight:600">${escapeHtml(s.label)}</div>
            <div style="font-size:0.75rem;color:#6b7280">${pct}% (MTM ${fmtUsd0(s.signed)})</div>
          </div>
        </div>`;
        })
        .join('')}
    </div>`;
  el.allocationGrid.appendChild(wrapper);

  if (!chartAvailable()) return;
  charts.alloc = new Chart(document.getElementById('allocChart').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: sectors.map((s) => s.label),
      datasets: [
        {
          data: sectors.map((s) => s.value),
          backgroundColor: sectors.map((s) => s.color),
          borderColor: '#ffffff',
          borderWidth: 3,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '50%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = absTotal > 0 ? ((ctx.raw / absTotal) * 100).toFixed(1) : '0.0';
              return `${ctx.label}: ${pct}% (|MTM| ${fmtUsd0(ctx.raw)})`;
            },
          },
        },
      },
    },
  });
}

function renderBar(view) {
  const labels = view.positions.map((p) => p.label || p.ticker);
  const invested = view.positions.map((p) => p.cost);
  const current = view.positions.map((p) => p.value);
  const plColor = view.totalPL >= 0 ? '#10b981' : '#ef4444';
  const spyCell =
    view.benchmarkIndex == null ? '—' : fmtSigned(view.benchmarkIndex - 100, 1) + '%';

  const wrapper = document.createElement('div');
  wrapper.className = 'bar-card';
  wrapper.innerHTML = `
    <h3>Invested vs Current by Position</h3>
    <div class="bar-summary">
      <div class="bar-summary-item">
        <div class="bar-summary-label">Invested</div>
        <div class="bar-summary-value">${fmtUsd0(view.totalCost)}</div>
      </div>
      <div class="bar-summary-item">
        <div class="bar-summary-label">Current</div>
        <div class="bar-summary-value">${fmtUsd0(view.totalValue)}</div>
      </div>
      <div class="bar-summary-item">
        <div class="bar-summary-label">P&amp;L</div>
        <div class="bar-summary-value" style="color:${plColor}">
          ${fmtSignedUsd0(view.totalPL)} (${fmtSigned(view.totalPLPct, 1)}%)
        </div>
      </div>
      <div class="bar-summary-item">
        <div class="bar-summary-label">${escapeHtml(payload.benchmark?.ticker || 'SPY')}</div>
        <div class="bar-summary-value">${spyCell}</div>
      </div>
      <div class="bar-summary-item">
        <div class="bar-summary-label">Portfolio</div>
        <div class="bar-summary-value">${fmtSigned(view.totalPLPct, 1)}%</div>
      </div>
    </div>
    <div class="bar-container"><canvas id="barChart"></canvas></div>`;
  el.barGrid.innerHTML = '';
  el.barGrid.appendChild(wrapper);

  if (!chartAvailable()) return;
  charts.bar = new Chart(document.getElementById('barChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Invested', data: invested, backgroundColor: '#3b82f6', borderRadius: 4, barPercentage: 0.7 },
        { label: 'Current Value', data: current, backgroundColor: '#10b981', borderRadius: 4, barPercentage: 0.7 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtUsd0(ctx.raw)}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#f0f0f0' },
          ticks: { font: { size: 10 }, callback: (val) => '$' + (val / 1000).toFixed(0) + 'K' },
          title: { display: true, text: 'Value (USD)', font: { size: 11, weight: 'bold' } },
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

function lineChart(canvasId, title, badge, meta, labels, fundData, benchData, diff) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chart-card';
  wrapper.innerHTML = `
    <h3>${escapeHtml(title)}<span class="card-badge badge-benchmark">${escapeHtml(badge)}</span></h3>
    <div class="chart-meta">${meta}</div>
    <div class="chart-container"><canvas id="${canvasId}"></canvas></div>`;
  el.chartGrid.appendChild(wrapper);

  if (!chartAvailable()) return;
  const diffColor = diff != null && diff < 0 ? '#ef4444' : '#10b981';
  const datasets = [
    {
      label: 'Fund Index',
      data: fundData,
      borderColor: diffColor,
      backgroundColor: diffColor + '20',
      fill: false,
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6,
    },
  ];
  if (benchData.some((v) => v != null)) {
    datasets.push({
      label: `${badge} Index`,
      data: benchData,
      borderColor: '#6b7280',
      backgroundColor: '#6b728020',
      borderDash: [5, 5],
      fill: false,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5,
      spanGaps: true,
    });
  }
  charts[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw == null ? '—' : ctx.raw.toFixed(2)}`,
          },
        },
      },
      scales: {
        y: { beginAtZero: false, grid: { color: '#f0f0f0' }, ticks: { font: { size: 10 } } },
        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } },
      },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
    },
  });
}

function renderCharts(view) {
  el.chartGrid.innerHTML = '';
  const benchTicker = payload.benchmark?.ticker || 'SPY';

  const timeline = buildTimeline(view);
  if (timeline.length < 2) {
    el.chartGrid.innerHTML = `
      <div class="chart-card">
        <h3>Overall Portfolio</h3>
        <div class="empty-box" style="padding:2rem">
          No performance history yet. Ask the agent to <code>save_snapshot</code> periodically
          to build fund-vs-benchmark history.
        </div>
      </div>`;
    return;
  }

  const labels = timeline.map((t) => t.label);
  const fundData = timeline.map((t) => t.fund);
  const benchData = timeline.map((t) => t.bench);
  const lastFund = fundData[fundData.length - 1];
  const lastBench = benchData[benchData.length - 1];
  const diff = lastBench == null ? null : lastFund - lastBench;

  lineChart(
    'chart-overall',
    'Overall Portfolio',
    benchTicker,
    `Fund: ${lastFund.toFixed(2)} | Benchmark: ${lastBench == null ? '—' : lastBench.toFixed(2)} | Diff: ${diff == null ? '—' : fmtSigned(diff)}`,
    labels,
    fundData,
    benchData,
    diff,
  );

  view.positions.forEach((p) => {
    const pts = buildPositionTimeline(p.ticker, view);
    if (pts.length < 2) return;
    const fIdx = pts[pts.length - 1].fund;
    const pDiff = view.benchmarkIndex == null ? null : fIdx - view.benchmarkIndex;
    lineChart(
      'chart-' + p.ticker.replace(/[^A-Za-z0-9-]/g, '-'),
      p.ticker,
      benchTicker,
      `Fund: ${fIdx.toFixed(2)} | Benchmark: ${view.benchmarkIndex == null ? '—' : view.benchmarkIndex.toFixed(2)} | Diff: ${pDiff == null ? '—' : fmtSigned(pDiff)}`,
      pts.map((t) => t.label),
      pts.map((t) => t.fund),
      pts.map((t) => (t.label === 'Now' ? view.benchmarkIndex : benchIndexAt(t.label))),
      pDiff,
    );
  });
}

function renderDepositsTable(view) {
  const section = document.getElementById('depositsSection');
  const body = document.getElementById('depositsTableBody');
  if (!section || !body) return;
  const deposits = view.deposits || [];
  if (deposits.length === 0 || !view.isLive) {
    section.classList.add('hidden');
    body.innerHTML = '';
    return;
  }
  section.classList.remove('hidden');
  body.innerHTML = deposits
    .map((d) => {
      const label = d.label ? escapeHtml(d.label) : escapeHtml(d.id);
      const days = d.matured
        ? '<span class="badge-matured">matured</span>'
        : `${d.daysRemaining}d left`;
      return `<tr>
        <td>${label}<div class="muted">${escapeHtml(d.id)}</div></td>
        <td>${channelBadgeHtml(d.channel)}</td>
        <td class="num">${fmtUsd2(d.amount)}</td>
        <td class="num">${fmtUsd2(d.interest)}</td>
        <td>${escapeHtml(d.start_date)} → ${escapeHtml(d.end_date)}</td>
        <td>${days}</td>
      </tr>`;
    })
    .join('');
}

function renderInsights(view) {
  const benchTicker = payload.benchmark?.ticker || 'SPY';
  const insights = [];

  if ((view.deposits || []).length > 0) {
    const amt = Number(view.depositsAmount || 0);
    const matured = view.deposits.filter((d) => d.matured).length;
    insights.push({
      title: 'Fixed deposits',
      text:
        `${view.deposits.length} term deposit${view.deposits.length === 1 ? '' : 's'} ` +
        `with ${fmtUsd0(amt)} principal in NAV (not free cash).` +
        (matured > 0
          ? ` ${matured} matured — consider remove_deposit / roll to cash.`
          : ' Principal is locked until end date.'),
      color: '#7c3aed',
    });
  }

  if (view.positions.length > 0) {
    const best = view.positions.reduce((a, b) => (a.plPct >= b.plPct ? a : b));
    insights.push({
      title: 'Best Performer',
      text: `${best.ticker} leads at ${fmtSigned(fundIndex(best.value, best.cost))} index (${fmtSigned(best.plPct, 1)}% vs cost).`,
      color: '#10b981',
    });

    const worst = view.positions.reduce((a, b) => (a.plPct <= b.plPct ? a : b));
    if (worst.ticker !== best.ticker) {
      insights.push({
        title: worst.plPct < 0 ? 'Weakest Position' : 'Lagging Position',
        text: `${worst.ticker} trails at ${fmtSigned(fundIndex(worst.value, worst.cost))} index (${fmtSigned(worst.plPct, 1)}% vs cost).`,
        color: worst.plPct < 0 ? '#ef4444' : '#f59e0b',
      });
    }

    const top = view.positions[0];
    if (top && top.weightPct >= 40) {
      insights.push({
        title: 'Concentration',
        text: `${top.ticker} is ${top.weightPct.toFixed(1)}% of the portfolio — performance is dominated by a single holding.`,
        color: '#f59e0b',
      });
    }
  }

  if (view.diff != null) {
    const trend = view.diff >= 0 ? 'outperforming' : 'underperforming';
    insights.push({
      title: 'Overall Portfolio',
      text: `Fund at ${view.fundIndex.toFixed(2)} is ${trend} ${benchTicker} (${view.benchmarkIndex.toFixed(2)}) by ${fmtSigned(view.diff)} points.`,
      color: view.diff >= 0 ? '#10b981' : '#ef4444',
    });
  } else {
    insights.push({
      title: 'Benchmark Not Available',
      text: `Save at least one snapshot to anchor a ${benchTicker} base date for fund-vs-benchmark comparison.`,
      color: '#6b7280',
    });
  }

  if (view.channelView === MERGED_CHANNEL_VIEW && (view.channels || []).length > 1) {
    insights.push({
      title: 'Multi-channel portfolio',
      text: `Merged view across: ${(view.channels || []).join(', ')}. Use the Channel control to isolate one broker. Unassigned holdings appear under "${DEFAULT_CHANNEL}".`,
      color: '#7c3aed',
    });
  } else if (view.channelView === DEFAULT_CHANNEL) {
    insights.push({
      title: 'Default channel',
      text: `Showing holdings without an explicit broker tag (channel "${DEFAULT_CHANNEL}"). Tag positions with add_holding/update_holding channel=… when you know the broker.`,
      color: '#6b7280',
    });
  } else if (view.channelView !== MERGED_CHANNEL_VIEW) {
    insights.push({
      title: `Channel ${view.channelLabel || view.channelView}`,
      text: `Filtered to one broker channel. Switch to All (merged) to see the full portfolio.`,
      color: '#7c3aed',
    });
  }

  insights.push({
    title: 'Data Note',
    text: `${view.isLive ? 'Live prices' : 'Archive view of ' + view.label} · generated ${new Date(payload.generatedAt).toLocaleString()}. Fund baseline uses actual purchase prices (cost basis).`,
    color: '#6b7280',
  });

  el.insightGrid.innerHTML = insights
    .map(
      (i) => `
    <div class="insight-card" style="border-left-color:${i.color}">
      <h4 style="color:${i.color}">${escapeHtml(i.title)}</h4>
      <p>${escapeHtml(i.text)}</p>
    </div>`,
    )
    .join('');
}

/* ---------- orchestration ---------- */

function renderDate(dateKey, channelKey = selectedChannel) {
  // deposits table rendered inside after view is built
  if (!payload?.model) return;
  const view = buildView(dateKey, channelKey);
  if (!view) return;

  const chLabel =
    view.channelView === MERGED_CHANNEL_VIEW
      ? 'All channels (merged)'
      : `Channel: ${view.channelLabel || view.channelView}`;
  if (el.subtitle) {
    el.subtitle.textContent =
      `${payload.displayName || payload.slug} · ${view.label} · ${view.isLive ? 'Latest' : 'Archived'} · ${chLabel}`;
  }
  if (el.statusBadge) {
    el.statusBadge.className = view.isLive ? 'live-badge' : 'archive-badge';
    el.statusBadge.textContent = view.isLive ? 'LIVE' : 'ARCHIVE';
  }
  syncDateControls();

  renderWarnings();
  renderOverview(view);
  setOptionTab(optionTab);
}

function historyDates() {
  return (payload?.model?.history || []).map((h) => h.date).sort();
}

function syncDateControls() {
  const dates = historyDates();
  const inputYmd =
    selectedDate === 'live'
      ? dates[dates.length - 1] || new Date().toISOString().slice(0, 10)
      : selectedDate;
  if (el.dateInput) {
    el.dateInput.max = dates[dates.length - 1] || inputYmd;
    el.dateInput.value = inputYmd;
  }
  const idx = dates.indexOf(inputYmd);
  if (el.datePrev) el.datePrev.disabled = dates.length === 0 || idx <= 0;
  if (el.dateNext) {
    el.dateNext.disabled =
      selectedDate === 'live' || dates.length === 0 || idx >= dates.length - 1;
  }
}

function initChannelSelect() {
  const live = payload.model.live;
  const channels = Array.isArray(live.channels) && live.channels.length > 0
    ? live.channels
    : [DEFAULT_CHANNEL];

  if (el.channelSelect) {
    el.channelSelect.innerHTML = '';
    const mergedOpt = document.createElement('option');
    mergedOpt.value = MERGED_CHANNEL_VIEW;
    mergedOpt.textContent = 'All (merged)';
    el.channelSelect.appendChild(mergedOpt);

    channels.forEach((ch) => {
      const opt = document.createElement('option');
      opt.value = ch;
      opt.textContent = ch === DEFAULT_CHANNEL ? 'default (unassigned)' : ch;
      el.channelSelect.appendChild(opt);
    });
  }

  const stillValid =
    selectedChannel === MERGED_CHANNEL_VIEW || channels.includes(selectedChannel);
  if (!stillValid) selectedChannel = MERGED_CHANNEL_VIEW;
  if (el.channelSelect) el.channelSelect.value = selectedChannel;
}

function initDashboard() {
  const requested = normalizeChannelId(channelFromQuery());
  const liveChannels = payload.model.live.channels || [];
  selectedChannel =
    requested === MERGED_CHANNEL_VIEW || liveChannels.includes(requested)
      ? requested
      : MERGED_CHANNEL_VIEW;
  const dates = payload.model.history.map((h) => h.date).sort().reverse();
  const stillValid = selectedDate === 'live' || dates.includes(selectedDate);
  if (!stillValid) selectedDate = 'live';

  el.dateSelect.innerHTML = '';
  const liveOpt = document.createElement('option');
  liveOpt.value = 'live';
  liveOpt.textContent = 'Live';
  el.dateSelect.appendChild(liveOpt);
  dates.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    el.dateSelect.appendChild(opt);
  });
  el.dateSelect.value = selectedDate;

  initChannelSelect();

  el.loading.classList.add('hidden');
  el.error.classList.add('hidden');
  el.dashboard.classList.remove('hidden');

  renderDate(selectedDate, selectedChannel);
}

function renderEmpty(body) {
  el.subtitle.textContent = `${body.displayName || body.slug} · empty portfolio`;
  el.loading.classList.add('hidden');
  el.error.classList.add('hidden');
  el.dashboard.classList.remove('hidden');
  if (el.deskEyebrow) {
    el.deskEyebrow.textContent = body.productProfile === 'consultant' ? 'Desk' : 'Household books';
  }
  if (el.heroDate) {
    el.heroDate.textContent = longDateLabel(new Date().toISOString().slice(0, 10));
  }
  if (el.heroLead) {
    el.heroLead.textContent =
      body.message || 'No holdings or cash recorded yet. Add positions in chat, then refresh.';
  }
  if (el.navValue) el.navValue.textContent = '—';
  if (el.navDelta) el.navDelta.textContent = 'Empty books';
  if (el.dateInput) {
    const today = new Date().toISOString().slice(0, 10);
    el.dateInput.value = today;
    el.dateInput.max = today;
  }
  if (el.datePrev) el.datePrev.disabled = true;
  if (el.dateNext) el.dateNext.disabled = true;
  if (el.kpiRow) {
    el.kpiRow.innerHTML = [
      metricCardHtml('Net premium · Daily', '—', 'No recorded fills', ''),
      metricCardHtml('Net premium · MTD', '—', 'No recorded fills', ''),
      metricCardHtml('Cash available', '—', 'Cash not recorded', ''),
      metricCardHtml('Cash after all puts assigned', '—', 'Cash not recorded', ''),
    ].join('');
  }
  if (el.expiryRow) {
    el.expiryRow.innerHTML = [
      metricCardHtml('High-risk ITM exposure', '—', 'No short options', ''),
      metricCardHtml('Probability-weighted exposure', '—', 'Not modeled', ''),
      metricCardHtml('Cash + buying power', '—', 'Unknown', ''),
      metricCardHtml('High-risk coverage', '—', 'No assignment cash', ''),
    ].join('');
  }
  if (el.channelPills) {
    el.channelPills.innerHTML =
      '<button type="button" class="chip-btn on" data-channel="merged">All platforms</button>';
  }
  if (el.expiryBlock) el.expiryBlock.classList.add('hidden');
  if (el.premiumBlock) el.premiumBlock.classList.add('hidden');
  if (el.openOptionsBlock) el.openOptionsBlock.classList.add('hidden');
  if (el.expiryTable) el.expiryTable.innerHTML = '';
  setOptionTab(optionTab);
}

async function load() {
  if (loading) return;
  loading = true;
  el.refreshBtn.disabled = true;
  el.status.className = 'status-line';
  el.status.textContent = 'Fetching live prices…';
  try {
    const res = await fetch(API, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message || body.error || `HTTP ${res.status}`);
    }
    payload = body;
    if (body.empty || !body.model) {
      renderEmpty(body);
    } else {
      initDashboard();
    }
    await loadOptionHistory();
    el.status.textContent = `Last refresh ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    el.status.className = 'status-line error';
    el.status.textContent = e instanceof Error ? e.message : String(e);
    el.loading.classList.add('hidden');
    if (!payload) {
      el.error.textContent = 'Could not load dashboard. Sign in and try again.';
      el.error.classList.remove('hidden');
    }
  } finally {
    loading = false;
    el.refreshBtn.disabled = false;
  }
}

function syncTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (el.autoRefresh.checked) {
    timer = setInterval(() => void load(), 60_000);
  }
}

el.dateSelect.addEventListener('change', (e) => {
  selectedDate = e.target.value;
  renderDate(selectedDate, selectedChannel);
});
el.channelSelect.addEventListener('change', (e) => {
  selectedChannel = e.target.value;
  renderDate(selectedDate, selectedChannel);
});
if (el.dateInput) {
  el.dateInput.addEventListener('change', (e) => {
    const ymd = e.target.value;
    const dates = historyDates();
    if (dates.length > 0 && ymd === dates[dates.length - 1] && selectedDate === 'live') {
      selectedDate = 'live';
    } else {
      selectedDate = ymd;
    }
    if (el.dateSelect) el.dateSelect.value = selectedDate;
    renderDate(selectedDate, selectedChannel);
  });
}
if (el.datePrev) {
  el.datePrev.addEventListener('click', () => {
    const dates = historyDates();
    const cur =
      selectedDate === 'live' ? dates[dates.length - 1] : selectedDate;
    const idx = dates.indexOf(cur);
    if (idx > 0) {
      selectedDate = dates[idx - 1];
      if (el.dateSelect) el.dateSelect.value = selectedDate;
      renderDate(selectedDate, selectedChannel);
    }
  });
}
if (el.dateNext) {
  el.dateNext.addEventListener('click', () => {
    const dates = historyDates();
    if (selectedDate === 'live') return;
    const idx = dates.indexOf(selectedDate);
    if (idx >= 0 && idx < dates.length - 1) {
      selectedDate = dates[idx + 1];
      if (el.dateSelect) el.dateSelect.value = selectedDate;
      renderDate(selectedDate, selectedChannel);
    }
  });
}
if (el.dateLatest) {
  el.dateLatest.addEventListener('click', () => {
    selectedDate = 'live';
    if (el.dateSelect) el.dateSelect.value = 'live';
    renderDate(selectedDate, selectedChannel);
  });
}
if (el.channelPills) {
  el.channelPills.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-channel]');
    if (!btn) return;
    selectedChannel = normalizeChannelId(btn.getAttribute('data-channel'));
    if (el.channelSelect) el.channelSelect.value = selectedChannel;
    writeChannelQuery(selectedChannel === MERGED_CHANNEL_VIEW ? 'all' : selectedChannel);
    renderDate(selectedDate, selectedChannel);
  });
}
el.refreshBtn.addEventListener('click', () => void load());
el.autoRefresh.addEventListener('change', syncTimer);

void load();
