/**
 * Dynamic portfolio dashboard client.
 * Fetches /api/domain/invage/dashboard (session cookie) and renders:
 * high-level KPI overview + channel chips, allocation/performance charts,
 * then detail tables (channels, holdings, deposits). Archive dates rebuild
 * from snapshot positions client-side.
 */

const API = '/api/domain/invage/dashboard';
const isWheelDesk = document.body.dataset.dashboardVersion === 'v2';

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
  totalPremiumCard: document.getElementById('totalPremiumCard'),
  totalPremiumValue: document.getElementById('totalPremiumValue'),
  totalPremiumMeta: document.getElementById('totalPremiumMeta'),
  realizedPnlCard: document.getElementById('realizedPnlCard'),
  realizedPnlValue: document.getElementById('realizedPnlValue'),
  realizedPnlMeta: document.getElementById('realizedPnlMeta'),
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
  optionRollsTab: document.getElementById('optionRollsTab'),
  optionRollsPanel: document.getElementById('optionRollsPanel'),
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
};

let payload = null;
let portfolioPayload = null;
let selectedDate = 'live';
let selectedChannel = MERGED_CHANNEL_VIEW;
let optionRightFilter = 'all';
let riskRightFilter = 'all';
let riskBrokerFilter = 'all';
let riskLevelFilter = 'all';
let optionBrokerFilter = 'all';
let optionSearch = '';
let optionSearchTimer;
let riskSearch = '';
let riskSearchTimer;
let highlightedUnderlying = null;
let optionTab = 'open';
let optionDefaultApplied = false;
let optionHistory = { episodes: [], connections: [], next_offset: null, total: 0, history_started: false, gaps: [] };
let optionHistoryError = '';
let optionHistoryRequest = 0;
let historySearchTimer = null;
const collapsedOptionMonths = new Set();
// Keep each chart's disclosure choice when filters or refreshed data redraw it.
const premiumChartExpansion = new Map();
el.premiumEngine?.addEventListener('toggle', event => {
  const details = event.target;
  if (details.matches?.('details.bar-more')) {
    premiumChartExpansion.set(details.closest('.metric-card').id, details.open);
  }
}, true);


function selectedBroker(key = selectedChannel) {
  const id = key?.startsWith('broker:') ? key.slice(7) : null;
  return id ? portfolioPayload?.brokerAggregates?.[id] ?? null : null;
}
function selectionOptions() {
  const source = portfolioPayload || payload;
  const channels = source?.model?.live?.channels || [];
  return [{ id: MERGED_CHANNEL_VIEW, label: 'All accounts' },
    ...channels.map(id => ({ id, label: id === DEFAULT_CHANNEL ? 'Unassigned' :
      (source.brokerChannels?.[id] ? (brokerNames[source.brokerChannels[id].brokerId] || source.brokerChannels[id].brokerId) + ' · ' + source.brokerChannels[id].label : id) }))];
}
function activateSelection() {
  const broker = selectedBroker();
  payload = broker?.dashboard ? { ...broker.dashboard, aggregatedViews: broker.scopes, pageProjections: broker.pages,
    brokerAggregates: portfolioPayload.brokerAggregates,
    dashboardConfig: portfolioPayload.dashboardConfig, analysisContextId: portfolioPayload.analysisContextId,
    productProfile: portfolioPayload.productProfile, productName: portfolioPayload.productName,
    displayName: portfolioPayload.displayName } : portfolioPayload;
  if (broker) selectedDate = 'live';
}
function selectionMatches(channel, key) {
  if (!key || key === 'all' || key === MERGED_CHANNEL_VIEW) return true;
  const broker = selectedBroker(key);
  return broker ? broker.channels.includes(channel) : key === channel;
}
function scopedHistorySelection(value) {
  const broker = selectedBroker();
  return broker && value !== selectedChannel && !broker.channels.includes(value) ? selectedChannel : value;
}
function historySelectionOptions(connections) {
  return [{ channel: '', label: 'All accounts' }, ...connections]
    .map(row => `<option value="${escapeHtml(row.channel)}">${escapeHtml(row.label || row.broker_id || row.channel)}</option>`).join('');
}
function selectionLabel() {
  const broker = selectedBroker();
  return broker ? brokerNames[broker.brokerId] || broker.brokerId : selectedChannel;
}
function selectionPreference(value) {
  const key = 'invage:dashboard-scope:' + (portfolioPayload?.slug || portfolioPayload?.displayName || 'default');
  try {
    if (value !== undefined) sessionStorage.setItem(key, value);
    return sessionStorage.getItem(key);
  } catch { return null; }
}
function requestedSelection() {
  const query = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.slice(1));
  return normalizeChannelId(query.has('channel') || hash.has('channel') ? channelFromQuery() : selectionPreference() || channelFromQuery());
}
function applySelection(value) {
  const next = normalizeChannelId(value);
  if (next === selectedChannel) return;
  selectedChannel = next;
  optionBrokerFilter = 'all'; riskBrokerFilter = 'all';
  rollContext = '';
  activateSelection();
  if (el.channelSelect) el.channelSelect.value = selectedChannel;
  writeChannelQuery(selectedChannel === MERGED_CHANNEL_VIEW ? 'all' : selectedChannel);
  selectionPreference(selectedChannel);
  // Clear prior results immediately; late responses are rejected by request IDs.
  optionHistoryRequest++; rollRequest++;
  optionHistory.episodes = []; rollData.groups = []; el.optionHistoryDetail.innerHTML = '';
  renderDate(selectedDate, selectedChannel);
  if (optionTab === 'history') followHistoryBroker(selectedChannel);
}

function normalizeChannelId(raw) {
  if (!raw || raw === 'all' || raw === MERGED_CHANNEL_VIEW) return MERGED_CHANNEL_VIEW;
  const source = portfolioPayload || payload;
  return !source?.model?.live?.channels?.includes(raw) && source?.brokerAggregates?.[raw] ? 'broker:' + raw : raw;
}
let charts = {};
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
  return optionDateLabel(ymd);
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

function savedDashboardScope(view) {
  const scope = payload?.aggregatedViews?.[view.isLive ? 'live' : view.label]?.[selectedBroker() ? MERGED_CHANNEL_VIEW : view.channelView];
  if (!scope) throw new Error('Saved portfolio calculations are unavailable. Sync your brokers and retry.');
  return scope;
}
function recordedPremiumForView(view) { return savedDashboardScope(view).premium; }
function recordedRealizedForView(view, _date, from = '') { return savedDashboardScope(view).realized[from]; }

function entrySpotHtml(trade, ccy) {
  const entry = trade?.entrySpot;
  return entry ? `<span title="${escapeHtml(`${entry.basis === 'execution' ? 'Underlying price at execution' : 'Opening-day adjusted close; not the execution-time price'} · ${optionDateLabel(entry.date)}`)}">${fmtPrettyMoney(entry.price, ccy, 2)}<small class="entry-basis${isWheelDesk ? ' visually-hidden' : ''}">${entry.basis === 'execution' ? 'At execution' : 'Adj. close'}</small></span>`
    : '<span title="No verified opening price is available">—</span>';
}

// Shared by both dashboard layouts and monthly totals. Never replace an
// unavailable roll cash flow with the replacement leg's STO or book cost.
function optionTradeCashFlow(trade) {
  if (!trade || !/^[A-Z]{3,4}$/.test(trade.currency || '')) return null;
  const rolled = Boolean(trade.rollDate) || trade.rollPremium !== undefined;
  const value = rolled ? trade.rollPremium : trade.stoGrossPremium ?? trade.openingGrossPremium;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionTradeCashFlowTotal(trades) {
  if (!trades.length) return null;
  const values = trades.map(optionTradeCashFlow);
  if (values.some(value => value == null) || new Set(trades.map(trade => trade.currency)).size !== 1) return null;
  const value = values.reduce((sum, amount) => sum + amount, 0);
  return Number.isFinite(value) ? { value, currency: trades[0].currency } : null;
}

function openingPremiumHtml(trade) {
  const value = optionTradeCashFlow(trade);
  const rolled = Boolean(trade?.rollDate) || trade?.rollPremium !== undefined;
  return value == null ? `<span title="${rolled ? 'Latest roll cash flow is unverified; opening premium is not substituted' : 'Matching opening fills or their currency are unavailable'}">—</span>`
    : `<span title="${rolled ? 'Latest roll: replacement opening proceeds plus closing-leg cash flow' : 'Reconciled opening cash flow'} · before fees">${fmtPrettyMoney(value, trade.currency, 2)}</span><small class="entry-basis${isWheelDesk ? ' visually-hidden' : ''}">${rolled ? 'Latest roll' : 'Opening'}</small>`;
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

const brokerNames = { ibkr: 'IBKR', moomoo: 'moomoo', tiger: 'Tiger Brokers', webull: 'Webull', futubull: 'Futubull' };
function brokerIdentity(channel) {
  const meta = (portfolioPayload || payload)?.brokerChannels?.[channel];
  const id = meta?.brokerId || /^(ibkr|moomoo|tiger|webull|futubull)(?:[-_:]|$)/i.exec(channel || '')?.[1].toLowerCase();
  return { id: id || channel, name: brokerNames[id] || (channel === DEFAULT_CHANNEL ? 'Unassigned' : channel), account: meta?.label || channel };
}
function brokerLabel(channel) {
  const broker = brokerIdentity(channel);
  return `<span class="broker-name broker-${escapeHtml(brokerNames[broker.id] ? broker.id : 'other')}" title="${escapeHtml(broker.account)}">${escapeHtml(broker.name)}</span>`;
}
function brokerFilters(kind, selected, positions) {
  const accounts = selectionOptions().filter(option => positions.some(p => p.channel === option.id));
  return `<div class="option-filter-group broker-filters" role="group" aria-label="Filter by broker account"><span class="label-eyebrow">Broker account</span>${[{ id: 'all', label: 'All' }, ...accounts].map(({id, label}) => `<button type="button" class="chip-btn broker-filter${selected === id ? ' on' : ''}" data-${kind}-broker="${escapeHtml(id)}" aria-pressed="${selected === id}">${isWheelDesk && id !== 'all' ? brokerLabel(id) : escapeHtml(label)}</button>`).join('')}</div>`;
}
function riskLevel(probability) {
  return probability == null ? 'muted' : probability > 0.6 ? 'danger' : probability >= 0.45 ? 'warning' : 'ok';
}
function optionInstrumentLabel(p) {
  const o = p.option;
  return `${optionUnderlyingLabel(o)} ${o.right.toUpperCase()} ${fmtPrettyMoney(o.strike, p.currency, Number.isInteger(o.strike) ? 0 : 2)} ${optionDateLabel(o.expiry).toUpperCase()}`;
}
function optionInstrumentButton(p, view, asOf) {
  const label = optionInstrumentLabel(p);
  const key = JSON.stringify([p.ticker, p.channel, view.isLive ? 'latest' : asOf]);
  return `<button type="button" class="option-instrument-link" aria-expanded="false" data-option-key="${escapeHtml(key)}" data-option-label="${escapeHtml(label)}" data-option-title="${escapeHtml(label)}" data-option-context="${escapeHtml(`${p.channel} · ${p.units} contracts · Snapshot ${asOf}`)}" data-option-discuss="${escapeHtml(optionDiscussionPrompt(p, view, asOf))}" aria-label="Discuss ${escapeHtml(label)}, ${escapeHtml(p.channel)}" title="Discuss with AI"${pendingDiscussions.has(key) ? ' disabled' : ''}>${escapeHtml(label)}</button>`;
}

function dailyChangeText(key, view) {
  if (payload?.dashboardConfig?.showDailyChanges !== true || !view?.isLive) return '';
  const daily = savedDashboardScope(view).dailyChanges;
  const metric = daily?.metrics?.[key];
  if (!metric) return '';
  const amount = metric.unit === 'pp' ? `${fmtSigned(metric.delta)} pp`
    : metric.unit === 'points' ? `${fmtSigned(metric.delta)} pts` : metric.unit === 'count' ? fmtSigned(metric.delta, 0) : `${metric.delta >= 0 ? '+' : ''}${fmtPrettyMoney(metric.delta, metric.unit, 2)}`;
  return `${amount}${metric.percent == null ? '' : ` (${fmtSigned(metric.percent)}%)`} · Daily vs ${optionDateLabel(daily.previousDate)}`;
}
const dailyCardKeys = {
  'Earned premium · Daily': 'realizedDaily', 'Earned premium · MTD': 'realizedMtd',
  'Net premium · Daily': 'premium.daily', 'Net premium · MTD': 'premium.mtd',
  'Brokerage fees · MTD': 'premium.fees', 'Cash available': 'cashAmount',
  'Max assignment obligation': 'assignmentObligation', 'High-risk ITM exposure': 'risk.wheel.exposure',
  'Probability-weighted exposure': 'risk.wheel.weighted', 'High-risk coverage': 'risk.wheel.cover',
};
function metricCardHtml(label, value, sub, help, valueClass) {
  const view = payload?.model ? buildView(selectedDate, selectedChannel) : null;
  const key = dailyCardKeys[label];
  const change = dailyChangeText(!isWheelDesk && key?.startsWith('risk.wheel.') ? key.replace('risk.wheel.', 'risk.matching.') : key, view);
  const vcls = ['metric-value', valueClass || ''].filter(Boolean).join(' ');
  const helpBtn = help
    ? `<button type="button" class="help-dot" aria-label="Explanation" data-help="${escapeHtml(help)}">?</button>`
    : '';
  return `<div class="metric-card">
    <div class="metric-head">
      <div class="label-eyebrow">${escapeHtml(label)}</div>
      ${helpBtn}
    </div>
    <div class="${vcls}">${value}</div>
    ${sub ? `<div class="metric-sub">${sub}</div>` : ''}
    ${change ? `<div class="metric-sub daily-change">${escapeHtml(change)}</div>` : ''}
  </div>`;
}

function fmtSigned(n, digits = 2) {
  return (n > 0 ? '+' : '') + Number(n).toFixed(digits);
}

function fmtSignedMoney0(n, ccy) {
  return (Number(n) >= 0 ? '+' : '') + fmtPrettyMoney(n, ccy, 0);
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
  tab = ['open', 'timeline', 'history', 'rolls'].includes(tab) ? tab : 'open';
  optionTab = tab;
  if (isWheelDesk) {
    document.body.dataset.optionView = tab;
    const title = document.getElementById('optionWorkspaceTitle');
    if (title) title.textContent = tab === 'open' ? 'Open options positions · broker view' : tab === 'timeline' ? 'Options timeline' : tab === 'history' ? 'Option position history' : 'Option rolls';
  }
  document.getElementById('optionTimelineTab').classList.toggle('on', tab === 'timeline');
  document.getElementById('optionTimelineTab').setAttribute('aria-pressed', String(tab === 'timeline'));
  document.getElementById('optionTimelinePanel').classList.toggle('hidden', tab !== 'timeline');
  const showHistory = tab === 'history';
  const showRolls = tab === 'rolls';
  el.optionOpenTab.classList.toggle('on', tab === 'open');
  el.optionHistoryTab.classList.toggle('on', showHistory);
  el.optionOpenTab.setAttribute('aria-pressed', String(tab === 'open'));
  el.optionHistoryTab.setAttribute('aria-pressed', String(showHistory));
  el.optionRollsTab.classList.toggle('on', showRolls);
  el.optionRollsTab.setAttribute('aria-pressed', String(showRolls));
  el.optionRollsPanel.classList.toggle('hidden', !showRolls);
  el.optionHistoryPanel.classList.toggle('hidden', !showHistory);
  const view = payload?.model ? buildView(selectedDate, selectedChannel) : null;
  const hasOpen = Boolean(view?.positions?.some(p => p.instrument === 'option' && p.option));
  el.optionOpenEmpty.classList.toggle('hidden', tab !== 'open' || hasOpen);
  if (el.openOptionsBlock) el.openOptionsBlock.classList.toggle('hidden', tab !== 'open' || !hasOpen);
  if (showRolls) followRollContext();
  if (tab === 'timeline') void optionTimeline.load();
}

function followHistoryBroker(channel) {
  const broker = channel === 'all' || channel === MERGED_CHANNEL_VIEW ? '' : channel;
  if (el.historyBroker.value === broker) return;
  if (broker && !Array.from(el.historyBroker.options).some(option => option.value === broker)) {
    const option = document.createElement('option'); option.value = broker; option.textContent = selectionLabel(); el.historyBroker.append(option);
  }
  el.historyBroker.value = broker;
  el.optionHistoryDetail.innerHTML = '';
  renderOptionHistory();
  void loadOptionHistory();
}

function renderOptionFreshness() {
  if (!el.optionFreshness) return;
  const rows = (optionHistory.connections || []).filter(row => selectionMatches(row.channel, selectedChannel));
  const summary = rows.length ? rows.map(row => {
    const name = row.label || row.broker_id.toUpperCase();
    const confirmed = row.position_as_of ? `positions as of ${optionDateLabel(row.position_as_of)}` : 'no confirmed position date';
    const failed = row.last_attempt?.ok === false ? `; last attempt failed ${optionDateLabel(row.last_attempt.at.slice(0, 10))}` : '';
    const schedule = row.schedule ? `; ${row.schedule} sync` : '; manual sync';
    const interval = row.schedule === 'hourly' ? 1 : row.schedule === 'daily' ? 24 : row.schedule === 'weekly' ? 168 : null;
    const late = interval && row.last_success_at && Date.now() - Date.parse(row.last_success_at) > (interval + 1) * 3600000 ? '; sync overdue' : '';
    return `${name}: ${confirmed}${failed}${schedule}${late}${row.enabled ? '' : '; paused'}`;
  }).join(' · ') : 'Option history begins with broker observations. Valuation snapshots do not confirm position status.';
  el.optionFreshness.textContent = summary;
}

function historyContractLabel(row) {
  const c = row.contract;
  return `${c.underlying} ${c.side.toUpperCase()} ${c.right.toUpperCase()} ${c.strike} ${optionDateLabel(c.expiry)}`;
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
  const broker = scopedHistorySelection(el.historyBroker.value);
  const right = el.historyRight.value;
  const status = el.historyStatus.value;
  const search = el.historySearch.value.trim().toUpperCase();
  const from = el.historyFrom.value;
  const to = el.historyTo.value;
  const rows = optionHistory.episodes.filter(row =>
    selectionMatches(row.channel, broker) && (!right || row.contract.right === right) &&
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
        <td>${optionDateLabel(row.last_seen_open)}</td><td>${row.first_seen_absent ? optionDateLabel(row.first_seen_absent) : '—'}</td>
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
    <p><strong>Evidence:</strong> Last observed open ${optionDateLabel(row.last_seen_open)}${row.first_seen_absent ? `; first observed absent ${optionDateLabel(row.first_seen_absent)}` : ''}. ${row.matched_trade_pl ? 'Imported opening and closing fills reconcile to a flat position.' : row.events?.length ? 'Broker lifecycle records are listed below; partial or conflicting records do not establish a complete outcome.' : 'Disappearance alone does not establish a close, expiry, or assignment.'}</p>
    <p><strong>Broker observations:</strong></p><ul>${row.observations.map(o => `<li>${escapeHtml(o.as_of)} · ${o.units} contract${o.units === 1 ? '' : 's'} · broker mark ${fmtPrettyMoney(o.mark, row.contract.currency)}${o.source === 'prior_books' ? ' · prior books' : ''}</li>`).join('')}</ul>
    <p><strong>Imported fills for this contract:</strong> ${row.executions.length ? `${row.executions.length} execution${row.executions.length === 1 ? '' : 's'}. Dates can precede the first position observation; a same-day reopen may share fills across episodes.` : 'None available.'}</p>
    ${row.executions.length ? `<ul>${row.executions.map(fill => `<li>${escapeHtml(`${optionDateLabel(fill.executed_at.slice(0, 10))} ${fill.executed_at.slice(11)}`)} · ${escapeHtml(fill.side.toUpperCase())} to ${escapeHtml(fill.effect)} · ${escapeHtml(fill.contracts)} contracts · gross ${escapeHtml(fill.gross_premium)} ${escapeHtml(fill.currency)} · commission ${fill.commission == null ? 'not reported' : `${escapeHtml(fill.commission)} ${escapeHtml(fill.currency)}`}</li>`).join('')}</ul>` : ''}
    <p><strong>Broker lifecycle events:</strong> ${row.events?.length ? `${row.events.length} record${row.events.length === 1 ? '' : 's'}.` : row.broker_id === 'ibkr' ? 'None imported. Include Option Exercises, Assignments &amp; Expirations in the Activity Flex query to capture them.' : 'None imported. This broker connection currently supplies position snapshots only.'}</p>
    ${row.events?.length ? `<ul>${row.events.map(event => `<li>${optionDateLabel(event.date)} · ${escapeHtml(event.kind.replaceAll('_', ' '))} · ${escapeHtml(event.contracts)} contracts · ${escapeHtml(event.settlement)} settlement${event.proceeds !== undefined ? ` · proceeds ${escapeHtml(event.proceeds)} ${escapeHtml(event.currency)}` : ''}${event.broker_realized_pl !== undefined ? ` · broker option P&amp;L ${escapeHtml(event.broker_realized_pl)} ${escapeHtml(event.currency)}` : ''}</li>`).join('')}</ul>` : ''}
    ${row.matched_trade_pl ? `<p><strong>Matched trade P&amp;L:</strong> ${escapeHtml(row.matched_trade_pl.amount)} ${escapeHtml(row.matched_trade_pl.currency)} from ${escapeHtml(row.matched_trade_pl.opened)} opened and ${escapeHtml(row.matched_trade_pl.closed)} closed contracts, including ${escapeHtml(row.matched_trade_pl.fees)} ${escapeHtml(row.matched_trade_pl.currency)} in reported commissions. Other taxes or charges outside these fills are not included.</p>` : ''}
    ${row.broker_event_pl ? `<p><strong>Broker-reported option event P&amp;L:</strong> ${escapeHtml(row.broker_event_pl.amount)} ${escapeHtml(row.broker_event_pl.currency)}. This is the broker's event amount, not a calculation from position disappearance.</p>` : ''}
    ${(row.status === 'assigned' || row.status === 'exercised') && row.events?.every(event => event.settlement === 'physical') ? '<p>Physical delivery changes the underlying transaction basis or proceeds. The option row alone does not establish combined trade P&amp;L.</p>' : ''}
    <p><strong>Saved valuation checkpoints:</strong> ${checkpoints.length ? escapeHtml(checkpoints.map(optionDateLabel).join(', ')) : 'None. A checkpoint is a valuation, not broker confirmation.'}</p>
    <button type="button" class="chip-btn" data-roll-contract="${escapeHtml(row.contract.underlying)}" data-roll-channel="${escapeHtml(row.channel)}" data-roll-strike="${escapeHtml(row.contract.strike)}" data-roll-expiry="${escapeHtml(row.contract.expiry)}">Check roll relationships</button>
  </div>`;
}

async function loadOptionHistory(more = false, signal, channelOverride) {
  const offset = more ? optionHistory.next_offset : 0;
  if (more && offset == null) return;
  const request = ++optionHistoryRequest;
  const params = new URLSearchParams({ offset: String(offset), limit: '100' });
  const channel = scopedHistorySelection(channelOverride ?? el.historyBroker.value);
  if (channel) params.set('channel', channel);
  if (el.historyRight.value) params.set('right', el.historyRight.value);
  if (el.historyStatus.value !== 'all') params.set('status', el.historyStatus.value);
  if (el.historyFrom.value) params.set('from', el.historyFrom.value);
  if (el.historyTo.value) params.set('to', el.historyTo.value);
  if (el.historySearch.value.trim()) params.set('q', el.historySearch.value.trim());
  try {
    const res = await fetch(`/api/domain/invage/option-history?${params}`, { credentials: 'include', signal });
    const body = await res.json();
    if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
    if (request !== optionHistoryRequest) return;
    optionHistory = { ...body, episodes: more ? [...optionHistory.episodes, ...body.episodes] : body.episodes };
    optionHistoryError = '';
    const selected = scopedHistorySelection(channelOverride ?? el.historyBroker.value);
    el.historyBroker.innerHTML = historySelectionOptions(body.connections);
    el.historyBroker.value = selected;
  } catch (error) {
    if (request !== optionHistoryRequest) return;
    optionHistoryError = error instanceof Error ? error.message : String(error);
  }
  renderOptionHistory();
}



const optionTimeline = window.createOptionTimeline(() => ({
  channel: ['all', MERGED_CHANNEL_VIEW].includes(selectedChannel) ? '' : selectedChannel,
  asOf: selectedDate === 'live' ? (payload?.generatedAt || new Date().toISOString()).slice(0, 10) : selectedDate,
  replay: selectedDate !== 'live',
  positions: payload?.model ? buildView(selectedDate, selectedChannel)?.positions || [] : [],
  channels: selectedBroker()?.channels,
  tradeDetails: selectedDate === 'live' ? payload?.optionTradeDetails || {} : {},
  brokerAsOf: payload?.brokerAsOf || {},
}));
document.getElementById('optionTimelineTab').addEventListener('click', () => setOptionTab('timeline'));

el.optionOpenTab?.addEventListener('click', () => setOptionTab('open'));
el.optionHistoryTab?.addEventListener('click', () => {
  followHistoryBroker(selectedChannel);
  setOptionTab('history');
});
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

/* Foldable option relationships. Server links raw evidence; the client never guesses rolls. */
const rollEl = Object.fromEntries(['Broker', 'Search', 'Evidence', 'From', 'To', 'Expand', 'Collapse', 'Status', 'Retry', 'Groups', 'More']
  .map(name => [name.toLowerCase(), document.getElementById(`roll${name}`)]));
let rollData = { groups: [], connections: [], gaps: [], coverage: [], total: 0, next_offset: null };
let rollRequest = 0, rollContext = '', rollError = '', rollLoading = false, rollSearchTimer;
let rollTarget = null;
const rollDisclosure = new Map();
const rollEvidenceLabel = { order: 'Order-linked', execution: 'Execution-linked', possible: 'Possible', review: 'Needs review' };
function rollContract(c) { return `${c.underlying} ${c.strike} ${c.right} · ${optionDateLabel(c.expiry)}`; }
function followRollContext() {
  const channel = selectedChannel === MERGED_CHANNEL_VIEW || selectedChannel === 'all' ? '' : selectedChannel;
  const key = `${channel}:${selectedDate}`;
  if (key === rollContext) return;
  rollContext = key;
  // A broker option may not have been populated until the first request returns.
  if (channel && !Array.from(rollEl.broker.options).some(o => o.value === channel)) {
    const option = document.createElement('option'); option.value = channel; option.textContent = channel; rollEl.broker.append(option);
  }
  rollEl.broker.value = channel;
  void loadRollRelationships();
}
function rollNode(r) {
  const id = `roll-${r.id}`;
  const closing = r.side === 'short' ? 'Buy to close' : 'Sell to close';
  const replacementSide = r.side === 'short' ? 'Sell' : 'Buy';
  const opening = r.replacement_effect === 'open' ? `${replacementSide} to open` : `${replacementSide} · ${r.replacement_effect === 'close' ? 'closing effect; needs review' : 'position effect unverified'}`;
  const sourceId = `sources-${r.id}`;
  const historyButton = c => `<button type="button" class="chip-btn" data-history-from-roll="${escapeHtml(c.underlying)}" data-history-channel="${escapeHtml(r.channel)}" data-history-right="${escapeHtml(c.right)}" data-history-strike="${escapeHtml(c.strike)}" data-history-expiry="${escapeHtml(c.expiry)}">Position history</button>`;
  const cash = r.cash == null ? 'Cash flow unavailable' : `${fmtPrettyMoney(r.cash, r.old.currency)} · ${r.old.currency} · ${r.cash_basis === 'net' ? 'reported net cash' : 'before fees'}`;
  return `<details class="roll-node" data-roll-disclosure="${id}" ${rollDisclosure.get(id) ? 'open' : ''}>
    <summary><span class="roll-chevron" aria-hidden="true">›</span><time datetime="${escapeHtml(r.at)}">${optionDateLabel(r.at.slice(0, 10))}</time>
      <span class="roll-transition">${escapeHtml(rollContract(r.old))}<span class="roll-arrow" aria-label="replaced by">→</span>${escapeHtml(rollContract(r.replacement))}</span>
      <span class="roll-tag">${rollEvidenceLabel[r.evidence]}</span></summary>
    <div class="roll-node-body"><div class="roll-legs"><div><span class="roll-leg-label">${closing} · ${escapeHtml(r.closed_quantity)} contracts</span><strong>${escapeHtml(rollContract(r.old))}</strong>${historyButton(r.old)}</div>
      <span class="roll-arrow" aria-label="replaced by">→</span><div><span class="roll-leg-label">${opening} · ${escapeHtml(r.opened_quantity)} contracts</span><strong>${escapeHtml(rollContract(r.replacement))}</strong>${historyButton(r.replacement)}</div></div>
      <p class="roll-cash">${escapeHtml(cash)}</p><p>${escapeHtml(r.reason)}</p>
      <p class="option-freshness">${optionDateLabel(r.at.slice(0, 10))} ${escapeHtml(r.at.slice(11))}${r.through !== r.at ? ` – ${optionDateLabel(r.through.slice(0, 10))} ${escapeHtml(r.through.slice(11))}` : ''} · ${escapeHtml(r.clock)}</p>
      <details class="roll-evidence" data-roll-disclosure="${sourceId}" ${rollDisclosure.get(sourceId) ? 'open' : ''}><summary><span class="roll-chevron" aria-hidden="true">›</span>Source evidence</summary>
        <div class="roll-sources"><p>Orders: ${escapeHtml(r.orders.join(' / '))}${r.parent ? `<br>Parent: ${escapeHtml(r.parent)}` : ''}</p>
          <p>Closing records: ${escapeHtml(r.closing_fills.join(', '))}<br>Opening records: ${escapeHtml(r.opening_fills.join(', '))}</p>
          <ul>${r.sources.map(s => `<li>${escapeHtml(s.id)}<br><span class="option-freshness">Source version: ${escapeHtml(s.version)}</span></li>`).join('')}</ul></div></details>
    </div></details>`;
}
function renderRollRelationships() {
  rollEl.retry.classList.toggle('hidden', !rollError);
  rollEl.more.classList.toggle('hidden', rollData.next_offset == null || !!rollError || rollLoading);
  const replay = selectedDate === 'live' ? '' : ` · trades through ${optionDateLabel(selectedDate)}`;
  rollEl.status.textContent = rollLoading ? 'Reading archived execution evidence…' : rollError ? `Could not load relationships: ${rollError}` :
    `${rollData.total} contract groups${replay}`;
  if (rollError && !rollData.groups.length) { rollEl.groups.innerHTML = ''; return; }
  rollEl.groups.innerHTML = (rollData.groups.length ? rollData.groups.map(g => {
      const id = `group-${g.id}`;
      const possible = g.relationships.some(r => r.evidence === 'possible');
      const review = g.relationships.some(r => r.evidence === 'review');
      const count = review ? 'Needs review' : possible ? 'Possible roll' : `${g.relationships.length} roll${g.relationships.length === 1 ? '' : 's'}`;
      return `<details class="roll-folder${possible || review ? ' roll-uncertain' : ''}" data-roll-disclosure="${id}" ${rollDisclosure.get(id) ? 'open' : ''}>
        <summary><span class="roll-chevron" aria-hidden="true">›</span><span><strong class="roll-ticker">${escapeHtml(g.underlying)}</strong><br><span class="option-freshness">${escapeHtml(g.broker_id.toUpperCase())} · ${escapeHtml(g.account_id)}</span></span>
          <span class="roll-latest"><strong>${escapeHtml(g.latest.strike)} ${escapeHtml(g.latest.right)} · ${optionDateLabel(g.latest.expiry)}</strong><br><span class="option-freshness">Latest replacement in these records · ${escapeHtml(g.latest_quantity)} contracts</span></span>
          <span class="roll-count">${count}<br><span class="option-freshness">${optionDateLabel(g.last_at.slice(0, 10))}</span></span></summary>
        <div class="roll-history"><div class="label-eyebrow">${possible ? 'Possible relationship' : review ? 'Relationship needs review' : 'Roll history · newest first'}</div><div class="roll-branch">${g.relationships.map(rollNode).join('')}</div>
          ${g.relationships.length > 1 ? '<p class="option-freshness">Linked transitions form an apparent path. Continuous ownership and current position status remain unverified.</p>' : ''}</div></details>`;
    }).join('') : rollLoading ? '' : '<div class="empty">No linked rolls in these records. Missing execution history does not mean no rolls were traded.</div>');
}
async function loadRollRelationships(more = false) {
  const offset = more ? rollData.next_offset : 0;
  if (more && (offset == null || rollLoading)) return;
  const request = ++rollRequest;
  const params = new URLSearchParams({ offset: String(offset), limit: '50' });
  for (const [key, control] of [['channel', 'broker'], ['q', 'search'], ['evidence', 'evidence'], ['from', 'from'], ['to', 'to']]) {
    if (rollEl[control].value.trim()) params.set(key, rollEl[control].value.trim());
  }
  const scopedChannel = scopedHistorySelection(params.get('channel') || '');
  if (scopedChannel) params.set('channel', scopedChannel);
  if (selectedDate !== 'live') params.set('as_of', selectedDate);
  if (!more) rollData = { ...rollData, groups: [], gaps: [], coverage: [], total: 0, next_offset: null };
  rollLoading = true; rollError = ''; renderRollRelationships();
  try {
    const response = await fetch(`/api/domain/invage/option-relationships?${params}`, { credentials: 'include' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    if (request !== rollRequest) return;
    rollData = { ...body, groups: more ? [...rollData.groups, ...body.groups] : body.groups };
    if (rollTarget) {
      for (const group of body.groups) for (const r of group.relationships) {
        if ([r.old, r.replacement].some(c => c.underlying === rollTarget.underlying && c.expiry === rollTarget.expiry && Number(c.strike) === Number(rollTarget.strike))) {
          rollDisclosure.set(`group-${group.id}`, true); rollDisclosure.set(`roll-${r.id}`, true);
        }
      }
      rollTarget = null;
    }
    const selected = scopedHistorySelection(rollEl.broker.value);
    rollEl.broker.innerHTML = historySelectionOptions(body.connections);
    rollEl.broker.value = selected;
  } catch (error) { if (request !== rollRequest) return; rollError = error instanceof Error ? error.message : String(error); }
  if (request !== rollRequest) return;
  rollLoading = false; renderRollRelationships();
}
el.optionRollsTab.addEventListener('click', () => setOptionTab('rolls'));
for (const control of ['broker', 'search', 'evidence', 'from', 'to']) rollEl[control].addEventListener(control === 'search' ? 'input' : 'change', () => {
  clearTimeout(rollSearchTimer);
  // Invalidate older responses as soon as the user changes the filter, before debouncing.
  ++rollRequest;
  if (control === 'search') rollSearchTimer = setTimeout(() => loadRollRelationships(), 250);
  else void loadRollRelationships();
});
rollEl.groups.addEventListener('toggle', event => {
  if (event.target.dataset.rollDisclosure) rollDisclosure.set(event.target.dataset.rollDisclosure, event.target.open);
}, true);
rollEl.expand.addEventListener('click', () => rollEl.groups.querySelectorAll('.roll-folder').forEach(d => { d.open = true; rollDisclosure.set(d.dataset.rollDisclosure, true); }));
rollEl.collapse.addEventListener('click', () => { rollEl.groups.querySelectorAll('details').forEach(d => d.open = false); rollDisclosure.clear(); });
rollEl.retry.addEventListener('click', () => loadRollRelationships());
rollEl.more.addEventListener('click', () => loadRollRelationships(true));
document.addEventListener('click', event => {
  const history = event.target.closest('[data-history-from-roll]');
  if (history) {
    const channel = history.dataset.historyChannel, underlying = history.dataset.historyFromRoll;
    if (!Array.from(el.historyBroker.options).some(o => o.value === channel)) {
      const option = document.createElement('option'); option.value = channel; option.textContent = channel; el.historyBroker.append(option);
    }
    el.historyBroker.value = channel; el.historySearch.value = underlying;
    el.historyRight.value = history.dataset.historyRight; el.historyStatus.value = 'all';
    el.historyFrom.value = ''; el.historyTo.value = '';
    setOptionTab('history');
    void loadOptionHistory().then(() => {
      if (optionTab !== 'history' || el.historyBroker.value !== channel || el.historySearch.value !== underlying) return;
      const episode = optionHistory.episodes.find(row => row.channel === channel && row.contract.underlying === underlying &&
        row.contract.right === history.dataset.historyRight && row.contract.expiry === history.dataset.historyExpiry &&
        Number(row.contract.strike) === Number(history.dataset.historyStrike));
      if (episode) showOptionHistoryDetail(episode.id);
    });
    return;
  }
  const button = event.target.closest('[data-roll-contract]');
  if (!button) return;
  clearTimeout(rollSearchTimer);
  rollEl.evidence.value = ''; rollEl.from.value = ''; rollEl.to.value = '';
  const channel = button.dataset.rollChannel;
  if (!Array.from(rollEl.broker.options).some(o => o.value === channel)) {
    const option = document.createElement('option'); option.value = channel; option.textContent = channel; rollEl.broker.append(option);
  }
  rollEl.broker.value = channel; rollEl.search.value = button.dataset.rollContract;
  rollTarget = { underlying: button.dataset.rollContract, strike: button.dataset.rollStrike, expiry: button.dataset.rollExpiry };
  const globalChannel = selectedChannel === MERGED_CHANNEL_VIEW || selectedChannel === 'all' ? '' : selectedChannel;
  rollContext = `${globalChannel}:${selectedDate}`;
  setOptionTab('rolls'); void loadRollRelationships();
  el.optionRollsPanel.scrollIntoView({ block: 'start', behavior: 'auto' });
});

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

/** Date and account views are calculated during sync, including historical totals. */
function buildView(dateKey, channelKey = selectedChannel) {
  return payload?.aggregatedViews?.[dateKey]?.[selectedBroker(channelKey) ? MERGED_CHANNEL_VIEW : channelKey]?.view ?? null;
}

/** Timeline points up to (and including) the selected date. Live adds a 'Now' point. */
function buildTimeline(view) { return savedDashboardScope(view).timeline; }
function buildPositionTimeline(ticker, view) { return savedDashboardScope(view).positionTimelines[ticker] || []; }

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
function channelRowsForView(view) { return savedDashboardScope(view).channelRows; }

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
      `${scope} · Cost base ${baseDate} · Positions cost ${view.navComplete === false ? 'unavailable' : fmtMoney0(view.totalCost, repCcy)}` +
      ` · NAV ${view.navComplete === false ? 'unavailable' : fmtMoney0(view.totalValue, repCcy)}` +
      ` · Fund idx ${dashOrIndex(view.fundIndex)}` +
      (view.benchmarkIndex != null
        ? ` · Bench ${dashOrIndex(view.benchmarkIndex)} (${fmtSigned(view.diff)})`
        : ' · Bench n/a') +
      fxFootnote(view);
  }

  const bodyRows = rows.map((c) => {
    const money = (amount) => c.navComplete === false ? '—' : fmtMoney0(amount, repCcy);
    const signedMoney = (amount) => c.navComplete === false ? '—' : fmtSignedMoney0(amount, repCcy);
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
        ? `${money(c.depositsAmount)}${
            c.depositCount
              ? `<div class="muted">${c.depositCount} term${c.depositCount === 1 ? '' : 's'}</div>`
              : ''
          }`
        : '—';
    return `<tr>
      <td>${channelBadgeHtml(c.channel)}</td>
      <td class="num">${c.positionCount}</td>
      <td class="num">${mix}</td>
      <td class="num">${money(c.positionsValue)}</td>
      <td class="num">${money(c.totalCost)}</td>
      <td class="num ${plClass(c.totalPL)}">${signedMoney(c.totalPL)}</td>
      <td class="num ${plClass(c.totalPLPct)}">${dashOrPct(c.totalPLPct)}</td>
      <td class="num">${cashCell}</td>
      <td class="num">${fdCell}</td>
      <td class="num">${money(c.totalValue)}</td>
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
      <td class="num">${fmtMoney0(view.positionsValue ?? 0, repCcy)}</td>
      <td class="num">${fmtMoney0(view.totalCost, repCcy)}</td>
      <td class="num ${plClass(view.totalPL)}">${fmtSignedMoney0(view.totalPL, repCcy)}</td>
      <td class="num ${plClass(view.totalPLPct)}">${dashOrPct(view.totalPLPct)}</td>
      <td class="num">${
        view.cashAmount != null
          ? fmtMoney0(view.cashAmount, view.cashCurrency)
          : '—'
      }</td>
      <td class="num">${
        Number(view.depositsAmount || 0) > 0 ? fmtMoney0(view.depositsAmount, repCcy) : '—'
      }</td>
      <td class="num">${view.navComplete === false ? '—' : fmtMoney0(view.totalValue, repCcy)}</td>
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

function positionNotes(p, reportingCurrency) {
  const notes = [];
  if (p.instrument === 'option') {
    if (p.option?.side) notes.push(p.option.side);
    if (p.option?.right) notes.push(p.option.right);
    if (p.option?.expiry) notes.push(`exp ${p.option.expiry}`);
    if (p.option?.strike != null) notes.push(`K ${p.option.strike}`);
    if (p.contingentCashObligation > 0) {
      notes.push(`if assigned cash ${fmtPrettyMoney(p.contingentCashObligation, reportingCurrency, 0)}`);
    }
    if (p.contingentShareObligation > 0) {
      notes.push(`if assigned ${p.contingentShareObligation} sh`);
    }
    if (p.premiumAbsolute) notes.push(`prem abs ${fmtPrettyMoney(p.premiumAbsolute, reportingCurrency)}`);
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
        ? view.navComplete === false
          ? ` · ${view.optionCount} option · totals unavailable until FX is complete`
          : ` · ${view.optionCount} option · prem coll. ${fmtMoney0(view.optionsPremiumCollected || 0, reportingCcyCode(view))} · oblig. ${fmtMoney0(view.contingentCashObligation || 0, reportingCcyCode(view))}`
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
    const reportingCurrency = reportingCcyCode(view);
    const valueCurrency = p.currency && reportingCurrency &&
      (p.currency === reportingCurrency || view.fxRates?.[p.currency])
      ? reportingCurrency : p.currency;
    const notes = positionNotes(p, valueCurrency);
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
      <td class="num">${fmtPrettyMoney(p.avgCost, p.currency || reportingCurrency)}</td>
      <td class="num">${fmtPrettyMoney(p.price, p.currency || reportingCurrency)}</td>
      <td class="num">${fmtPrettyMoney(p.cost, valueCurrency, 0)}</td>
      <td class="num">${fmtPrettyMoney(p.value, valueCurrency, 0)}</td>
      <td class="num">${Number(p.weightPct || 0).toFixed(1)}%</td>
      <td class="num ${plClass(p.pl)}">${fmtPrettyMoney(p.pl, valueCurrency, 0)}</td>
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
        <td class="num">${fmtPrettyMoney(d.amount, d.currency)}</td>
        <td class="num">—</td>
        <td class="num pl-flat">—</td>
        <td class="num pl-flat">—</td>
        <td class="num">—</td>
        <td>principal</td>
        <td>${escapeHtml(d.start_date)} → ${escapeHtml(d.end_date)} · interest ${fmtPrettyMoney(d.interest, d.currency)} · ${status}</td>
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
      <td class="num">${fmtMoney0(view.depositsAmount, reportingCcyCode(view))}</td>
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
  const fundAssets = view.isLive ? brokerFundAssets(payload, view.channelView) : [];
  const hasUnitemizedFunds = fundAssets.some(row => row.amount > 0);
  const navLabel = document.getElementById('navLabel');
  if (navLabel) navLabel.textContent = hasUnitemizedFunds ? 'Itemized net asset value (NAV)' : 'Net asset value (NAV)';
  const channels = Array.isArray(view.channels) ? view.channels : [];
  const asOf = view.isLive
    ? (payload.generatedAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    : view.label;
  const brokerNames = channels
    .filter((c) => c && c !== DEFAULT_CHANNEL)
    .join(', ');

  if (el.deskEyebrow) {
    const consultant = payload.productProfile === 'consultant';
    if (selectedBroker()) {
      el.deskEyebrow.textContent = selectionLabel() + ' desk';
    } else if (view.channelView === MERGED_CHANNEL_VIEW) {
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
    const e = view.equityCount || 0;
    const o = view.optionCount || 0;
    const f = view.fundCount || 0;
    const n = e + o + f;
    const archive = view.isLive ? '' : (() => {
      const row = payload.model?.history?.find(item => item.date === view.label);
      const dates = Object.entries(row?.brokerAsOf || {});
      return dates.length
        ? ` Broker positions as of ${dates.map(([channel, date]) => `${channel} ${optionDateLabel(date)}`).join(', ')}.`
        : ' Broker position dates unavailable for this older snapshot.';
    })();
    const positionDates = view.isLive ? Object.entries(payload.brokerAsOf || {})
      .filter(([channel]) => view.channelView === MERGED_CHANNEL_VIEW || channel === view.channelView)
      .map(([channel, date]) => `${channel.toUpperCase()} ${optionDateLabel(date)}`) : [];
    const fundCountLabel = hasUnitemizedFunds && f === 0 ? '' : `, ${f} fund`;
    el.heroLead.textContent = `${n} ${n === 1 ? 'position' : 'positions'} — ${e} equity, ${o} option${fundCountLabel}.${archive}${view.isLive && positionDates.length ? ` Broker positions as of ${positionDates.join(' · ')}.` : ''}`;
  }
  if (el.navValue) el.navValue.textContent = view.navComplete === false
    ? '—' : fmtPrettyMoney(view.totalValue, repCcy, 2);
  if (el.navDelta) {
    if (view.navComplete === false) {
      el.navDelta.className = 'metric-sub down';
      el.navDelta.textContent = 'NAV unavailable · missing currency or FX data';
    } else {
    const change = dailyChangeText('totalValue', view);
    const delta = change ? savedDashboardScope(view).dailyChanges?.metrics?.totalValue?.delta : null;
    el.navDelta.className = 'metric-sub' + (change ? ' daily-change ' : ' ') + (delta > 0 ? 'up' : delta < 0 ? 'down' : '');
    el.navDelta.textContent = change || (view.isLive ? 'Live marks' : `Archived ${optionDateLabel(view.label)} · original currency and FX`);
    if (unverifiedOptionChannels(view).length) {
      el.navDelta.textContent += ' · option positions unverified';
    }
    }
  }

  const cashCcy = view.cashCurrency || repCcy;
  const premiumDate = view.isLive ? (payload.generatedAt || '').slice(0, 10) : view.label;
  const premium = recordedPremiumForView(view, premiumDate);
  if (el.totalPremiumCard) {
    el.totalPremiumCard.classList.toggle('hidden', payload.dashboardConfig?.showTotalPremium === false);
    el.totalPremiumValue.textContent = premium.total == null ? '—' : fmtPrettyMoney(premium.total, repCcy, 2);
    el.totalPremiumMeta.textContent = premium.total == null ? premium.totalReason
      : `Before fees · buys + sells · ${premium.firstTrade ? optionDateLabel(premium.firstTrade) : 'Recorded history'} through ${premium.lastTrade ? optionDateLabel(premium.lastTrade) : optionDateLabel(premiumDate)}${premium.partial ? ' · Partial history' : ''}`;
  }
  if (el.realizedPnlCard) {
    el.realizedPnlCard.classList.toggle('hidden', payload.dashboardConfig?.showRealizedPnl === false);
    const realized = recordedRealizedForView(view, premiumDate);
    el.realizedPnlValue.textContent = realized.value == null ? '—' : fmtPrettyMoney(realized.value, repCcy, 2);
    el.realizedPnlValue.className = 'metric-value ' + (realized.value > 0 ? 'up' : realized.value < 0 ? 'down' : '');
    el.realizedPnlMeta.textContent = realized.reason;
    el.realizedPnlCard.querySelector('.daily-change')?.remove();
    const change = dailyChangeText('realizedTotal', view);
    if (change) el.realizedPnlMeta.insertAdjacentHTML('afterend', `<div class="metric-sub daily-change">${escapeHtml(change)}</div>`);
  }
  const totalChange = dailyChangeText('premium.total', view);
  el.totalPremiumCard?.querySelector('.daily-change')?.remove();
  if (totalChange && el.totalPremiumMeta) el.totalPremiumMeta.insertAdjacentHTML('afterend', `<div class="metric-sub daily-change">${escapeHtml(totalChange)}</div>`);
  const { stalePuts, assignmentObligation } = savedDashboardScope(view);

  if (el.kpiRow) {
    el.kpiRow.innerHTML = [
      metricCardHtml('Net premium · Daily', premium.daily == null ? '—' : fmtPrettyMoney(premium.daily, repCcy, 0),
        premium.daily == null ? premium.reason : `${optionDateLabel(premium.dailyFrom)} – ${optionDateLabel(premium.dailyDate)} · Before fees${premium.partial ? ' · Partial history' : ''}`,
        'Money received from selling options, minus money paid to buy options, including opening and closing trades for long and short options, from the calendar day before the dashboard date (T−1) through the dashboard date (T), inclusive. Older trades are excluded. Brokerage fees are shown separately; missing trades can make the amount incomplete.',
        premium.daily > 0 ? 'up' : premium.daily < 0 ? 'down' : ''),
      metricCardHtml('Net premium · MTD', premium.mtd == null ? '—' : fmtPrettyMoney(premium.mtd, repCcy, 0),
        `Before fees${premium.partial ? ' · Partial history' : ''}`,
        'MTD means month to date. This is money received from selling options, minus money paid to buy options, including opening and closing trades for long and short options, from the start of the displayed month through the dashboard date. Brokerage fees are shown separately. Includes recorded trades only.',
        premium.mtd > 0 ? 'up' : premium.mtd < 0 ? 'down' : ''),
      metricCardHtml('Brokerage fees · MTD', premium.fees == null ? '—' : fmtPrettyMoney(premium.fees, repCcy, 2),
        premium.missingFees ? `Known fees only · ${premium.missingFees} fills with fees unreported` : 'Recorded option fill fees',
        'MTD means month to date. This totals the fees reported for recorded option trades in the displayed month. A positive amount is a cost; a negative amount is a refund or rebate. Fees that a broker has not reported are excluded, so the final cost may be higher.'),
      metricCardHtml('Cash available', view.cashAmount != null ? fmtPrettyMoney(view.cashAmount, cashCcy, 0) : '—',
        view.cashAmount != null ? 'Recorded cash · not deposits' : 'Cash not recorded',
        'Cash shown in your latest broker snapshot, excluding fixed deposits. It does not include extra borrowing capacity. Whether you can use or withdraw it immediately depends on the broker and whether trades have settled.'),
      metricCardHtml('Max assignment obligation', assignmentObligation == null ? '—' : fmtPrettyMoney(assignmentObligation, cashCcy, 0),
        assignmentObligation == null ? (stalePuts ? 'Put positions need a fresh broker sync' : 'Put currency or FX unavailable') : 'Gross short-put obligation',
        'Cash needed to buy the shares if all recorded short puts are assigned. For example, one put with a $100 strike covering 100 shares needs $10,000. The total does not subtract cash, premium received, or protection from other options. Compare it with your cash available.'),
    ].join('') + (view.isLive ? brokerFundAssetsCards(payload, view.channelView) : '');
  }

  const navCard = el.navValue?.closest('.metric-card');
  navCard?.querySelector('.daily-aggregate-changes')?.remove();
  const metrics = payload.dashboardConfig?.showDailyChanges === true && view.isLive ? savedDashboardScope(view).dailyChanges?.metrics : null;
  if (navCard && metrics && Object.keys(metrics).length) {
    const details = document.createElement('details');
    details.className = 'daily-aggregate-changes';
    details.innerHTML = '<summary>Daily aggregate changes</summary><p class="metric-sub">Changes in saved values; deposits, withdrawals and trades can affect these amounts.</p>' +
      Object.entries(metrics).map(([key, metric]) => `<p class="metric-sub"><strong>${escapeHtml(metric.label)}</strong><br>${escapeHtml(dailyChangeText(key, view))}</p>`).join('');
    navCard.append(details);
  }
  renderExpiryRisk(view, asOf);
  renderChannelPills(view);
  installCardExplainButtons();
}

function netRiskCapitalCard(view) {
  const risk = window.NetRiskCapital.calculate(view);
  return metricCardHtml('Net risk capital', risk.unbounded ? 'Unbounded' : risk.value == null ? '—' : fmtPrettyMoney(risk.value, reportingCcyCode(view), 0),
    'Estimated maximum loss across open options strategies', risk.reason);
}

function explanationScope(button) {
  return button.dataset.sectionTitle ? button.closest('.v2-group, #section01ExistingPanel') : button.closest('.metric-card');
}

function installSectionExplanations() {
  const sections = [...document.querySelectorAll('.v2-group')].map(section => [section, section.querySelector('h2')]);
  sections.push([document.getElementById('section01ExistingPanel'), el.expiryTitle]);
  for (const [section, heading] of sections) {
    if (!section || !heading) continue;
    section.querySelectorAll('[data-card-explain]').forEach(button => button.remove());
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'section-explain'; button.dataset.cardExplain = '';
    button.dataset.sectionTitle = heading.textContent.trim(); button.textContent = 'Explain';
    button.setAttribute('aria-label', 'Explain ' + button.dataset.sectionTitle);
    heading.append(button); prepareCardExplanation(button);
  }
}

// The V2 overview reuses the calculated portfolio values and recorded premium figures.
function renderV2Overview() {
  const summary = document.getElementById('v2Summary');
  if (!summary) return;
  const copy = node => {
    if (!node || node.classList.contains('hidden')) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll('[id]').forEach(item => item.removeAttribute('id'));
    clone.removeAttribute('id');
    clone.querySelectorAll('[data-card-explain]').forEach(item => item.remove());
    clone.dataset.calculationNotes = [...clone.querySelectorAll('.metric-sub')].map(n => n.textContent).join(' · ');
    clone.querySelectorAll('.metric-sub:not(.daily-change)').forEach(item => {
      if (!item.closest('.daily-aggregate-changes')) item.remove();
    });
    return clone.outerHTML;
  };
  const kpis = [...el.kpiRow.children];
  const stat = (node, label) => {
    if (!node || node.classList.contains('hidden')) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll('[data-card-explain]').forEach(item => item.remove());
    clone.dataset.calculationNotes = [...clone.querySelectorAll('.metric-sub')].map(n => n.textContent).join(' · ');
    clone.querySelectorAll('.metric-sub:not(.daily-change)').forEach(item => {
      if (!item.closest('.daily-aggregate-changes')) item.remove();
    });
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(item => item.removeAttribute('id'));
    clone.className = 'v2-stat';
    if (label) clone.querySelector('.label-eyebrow').textContent = label;
    return clone.outerHTML;
  };
  const group = (title, content, className = '') => `<section class="v2-group ${className}"><h2 class="label-eyebrow">${title}</h2><div class="v2-group-body">${content}</div></section>`;
  const view = payload?.model ? buildView(selectedDate, selectedChannel) : null;
  const premiumData = view ? recordedPremiumForView(view) : null;
  const feeLine = (label, value, missing) => `<p class="v2-fees">${label}: ${value == null ? '—' : escapeHtml(fmtPrettyMoney(value, reportingCcyCode(view), 2))}${missing ? ' <button type="button" class="help-dot" data-help="Known reported fees only; some recorded fills have unreported fees. This subtotal may be incomplete." aria-label="Fee availability">i</button>' : ''}</p>`;
  const premium = `<div class="metric-card v2-premium-card">${stat(kpis[0])}<div class="v2-premium-period">${stat(kpis[1])}${feeLine('Brokerage fees · MTD', premiumData?.fees, premiumData?.missingFees)}</div><div class="v2-premium-period">${stat(el.totalPremiumCard, 'Total premium · Net')}${el.totalPremiumCard.classList.contains('hidden') ? '' : feeLine('Brokerage fees · Total', premiumData?.totalFees, premiumData?.totalMissingFees)}</div></div>`;
  let earnings = '';
  if (!el.realizedPnlCard.classList.contains('hidden')) {
    const view = payload?.model ? buildView(selectedDate, selectedChannel) : null;
    const date = view?.isLive ? (payload.generatedAt || '').slice(0, 10) : view?.label;
    const premiumData = view ? recordedPremiumForView(view, date) : null;
    const period = (label, from) => {
      const result = view ? recordedRealizedForView(view, date, from) : { value: null, reason: 'No recorded completed results' };
      const html = metricCardHtml(label, result.value == null ? '—' : fmtPrettyMoney(result.value, reportingCcyCode(view), 0),
        escapeHtml(`${from ? optionDateLabel(from) : ''} – ${date ? optionDateLabel(date) : ''} · ${result.reason}`), '', result.value > 0 ? 'up' : result.value < 0 ? 'down' : '');
      const node = document.createElement('div'); node.innerHTML = html;
      return stat(node.firstElementChild);
    };
    earnings = `<div class="metric-card v2-premium-card">${period('Earned premium · Daily', premiumData?.dailyFrom)}${period('Earned premium · MTD', date?.slice(0, 7) + '-01')}${stat(el.realizedPnlCard, 'Earned premium · Total')}</div>`;
  }
  const funds = kpis.slice(5).map(copy).join('') || metricCardHtml('Fund assets · Broker', '—',
    'Not reported separately · Itemized funds remain included in NAV.',
    'This card shows a separately reported broker fund balance when available. An unavailable balance is not zero. Itemized fund holdings are already included in NAV; do not add them again.');
  summary.innerHTML = group('Premium & earnings', premium + earnings, 'v2-earnings') +
    group('Account value', copy(el.navValue.closest('.metric-card')) + funds) +
    group('Cash & exposure', copy(kpis[3]) + copy(kpis[4]).replace('Max assignment obligation', 'Net assignment obligations') + netRiskCapitalCard(view));
}

function cardExplanationTargets(card) {
  const stats = [...card.querySelectorAll('.v2-stat')];
  if (stats.length) return stats.map(node => [...node.querySelectorAll('.label-eyebrow, .metric-value')].map(part => part.textContent.trim()).join(' — '));
  const bars = [...card.querySelectorAll('.bar-meta')];
  if (bars.length) return bars.map(node => [...node.children].map(part => part.textContent.trim()).join(' — '));
  const metrics = [...card.querySelectorAll('.metric-card')].filter(node => node.querySelector('.metric-value'));
  const metricTargets = metrics.map(node => [...node.querySelectorAll('.label-eyebrow, .metric-value')].map(part => part.textContent.trim()).join(' — '));
  const rows = [...card.querySelectorAll('tbody tr')].filter(row => row.cells.length > 1);
  const headers = [...card.querySelectorAll('thead th')].map(cell => cell.textContent.replace(/\s+/g, ' ').trim());
  return metricTargets.concat(rows.flatMap(row => {
    const label = row.cells[0].cloneNode(true);
    label.querySelectorAll('button').forEach(button => button.replaceWith(button.dataset.optionLabel || ''));
    return [...row.cells].slice(1).flatMap((cell, i) => {
      const value = cell.textContent.replace(/\s+/g, ' ').trim();
      return /[0-9]/.test(value) || value === '—'
        ? [`${label.textContent.replace(/\s+/g, ' ').trim()} · ${headers[i + 1] || 'Value'} — ${value}`] : [];
    });
  }));
}

function chooseCardExplanation(button) {
  const targets = cardExplanationTargets(explanationScope(button));
  if (targets.length < 2) { prepareCardExplanation(button); void startOptionDiscussion(button); return; }
  let dialog = document.getElementById('explainChoice');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'explainChoice';
    dialog.className = 'explain-choice';
    dialog.setAttribute('aria-labelledby', 'explainChoiceTitle');
    dialog.innerHTML = '<form method="dialog"><h2 id="explainChoiceTitle">Which number would you like explained?</h2><p>Choose a figure from this section so the explanation focuses on what you need.</p><label for="explainMetric">Dashboard figure</label><select id="explainMetric" required></select><div class="explain-choice-actions"><button value="cancel" class="chip-btn">Cancel</button><button value="explain" class="chip-btn on">Explain this number</button></div></form>';
    document.body.appendChild(dialog);
  }
  dialog.querySelector('select').replaceChildren(...targets.map((label, i) => new Option(label, String(i))));
  dialog.onclose = () => {
    if (dialog.returnValue === 'explain') {
      prepareCardExplanation(button, targets[Number(dialog.querySelector('select').value)]);
      void startOptionDiscussion(button);
    }
    button.focus();
  };
  dialog.returnValue = 'cancel';
  dialog.showModal();
}

// Read the rendered values so the explanation matches the current dashboard filters.
function installCardExplainButtons() {
  renderV2Overview();
  el.dashboard.querySelectorAll('.metric-card').forEach(card => {
    if (isWheelDesk && (card.closest('#v2Summary') || card.closest('#expiryBlock'))) return;
    if (card.closest('[inert]')) return;
    const heading = card.querySelector('.label-eyebrow, h3');
    if (!heading) return;
    const existing = card.querySelector('[data-card-explain]');
    if (existing) { prepareCardExplanation(existing); return; }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card-explain';
    button.dataset.cardExplain = '';
    button.textContent = 'Explain';
    button.setAttribute('aria-label', `Explain ${card.classList.contains('risk-card') ? 'Expiry & assignment' : heading.textContent.trim()}`);
    button.setAttribute('aria-expanded', 'false');
    card.appendChild(button);
    prepareCardExplanation(button);
  });
  if (isWheelDesk) installSectionExplanations();
  syncDiscussionButtons();
  highlightOptionDiscussion();
}

function prepareCardExplanation(button, selectedFigure) {
  const card = explanationScope(button);
  const title = button.dataset.sectionTitle || (card.classList.contains('risk-card') ? 'Expiry & assignment' : card.querySelector('.label-eyebrow, h3').textContent.trim());
  const content = card.cloneNode(true);
  content.querySelectorAll('button, svg, summary').forEach(node => node.remove());
  content.querySelectorAll('div, p, td, th, li, span').forEach(node => node.append(' '));
  const values = content.textContent.replace(/\s+/g, ' ').trim();
  const notes = [...card.querySelectorAll('[data-help], [data-calculation-notes]')].map(node => node.dataset.help || node.dataset.calculationNotes).join(' ');
  const asOf = selectedDate === 'live' ? payload?.generatedAt || 'latest' : selectedDate;
  const channel = selectedChannel === MERGED_CHANNEL_VIEW ? 'All brokers (merged)' : selectionLabel();
  const context = `${channel} · ${selectedDate === 'live' ? 'Latest view' : 'Historical snapshot'} · ${asOf}`;
  const prompt = [
    `Explain the number${card.querySelector('.metric-value') ? '' : 's'} on my dashboard card "${title}" in plain language.`,
    `Displayed card: ${values}`,
    selectedFigure ? `Selected figure to explain: ${selectedFigure}. Focus on this figure.`
      : cardExplanationTargets(card).length > 1 || !cardExplanationTargets(card).length && !card.querySelector('.metric-value')
        ? 'This section contains multiple numbers. FIRST ask me which specific number or labeled figure I want explained, and wait for my answer before explaining or reconciling any figures.' : '',
    `Selected dashboard: ${context}. Reporting currency: ${payload?.model ? reportingCcyCode(buildView(selectedDate, selectedChannel)) : 'unavailable'}.`,
    `Broker snapshot dates: ${JSON.stringify(selectedDate === 'live' ? payload?.brokerAsOf || {} : payload?.model?.history?.find(row => row.date === selectedDate)?.brokerAsOf || {})}.`,
    notes ? `Calculation notes: ${notes}` : '',
    'Explain what the displayed amount means, how it is calculated, and which recorded components contribute to it. Use my portfolio records to reconcile the number where possible. Explain missing data, currency conversion, fees, and date ranges where relevant. If a value is unavailable or cannot be reconciled, say why without inventing figures. Treat the displayed value as the selected snapshot, which may differ from current data.',
  ].filter(Boolean).join('\n\n');
  button.dataset.optionKey = `explain:${prompt}`;
  button.dataset.optionTitle = `Explain · ${title}`;
  button.dataset.optionContext = context;
  button.dataset.cardPrompt = prompt;
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-card-explain], [data-option-risk-discuss]');
  if (!button) return;
  if (button.hasAttribute('data-card-explain')) { chooseCardExplanation(button); return; }
  void startOptionDiscussion(button);
});

const pendingDiscussions = new Set();
// Retain an immutable launch context so retry still targets its original snapshot.
const discussionRequests = new Map();
const optionDiscussions = new Map();
let activeOptionDiscussionKey = null;
let optionDiscussionTrigger = null;

function sendOptionPanelMessage(message) {
  window.parent.postMessage(message, window.location.origin);
}

function syncDiscussionButtons() {
  el.dashboard.querySelectorAll('[data-option-discuss], [data-card-explain]').forEach(button => {
    const pending = pendingDiscussions.has(button.dataset.optionKey);
    button.disabled = pending;
    button.textContent = pending ? 'Opening…' : button.dataset.optionLabel || (button.hasAttribute('data-card-explain') ? 'Explain' : 'Discuss');
  });
}

function highlightOptionDiscussion() {
  el.dashboard.querySelectorAll('[data-option-discuss], [data-card-explain]').forEach(button => {
    const selected = button.dataset.optionKey === activeOptionDiscussionKey;
    button.classList.toggle('option-discuss-active', selected);
    button.setAttribute('aria-expanded', String(selected));
  });
}

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.source !== window.parent ||
      !event.data) return;
  if (event.data.type === 'utarus:chat-panel:retry') {
    const trigger = discussionRequests.get(event.data.requestId);
    if (trigger) void startOptionDiscussion(trigger, event.data.requestId);
    return;
  }
  if (event.data.type === 'utarus:chat-panel:activated') {
    const match = [...optionDiscussions].find(([, discussion]) => discussion.requestId === event.data.requestId);
    if (match) {
      activeOptionDiscussionKey = match[0];
      optionDiscussionTrigger = discussionRequests.get(event.data.requestId);
      highlightOptionDiscussion();
    }
    return;
  }
  if (event.data.type !== 'utarus:chat-panel:closed') return;
  const previousKey = activeOptionDiscussionKey;
  activeOptionDiscussionKey = null;
  highlightOptionDiscussion();
  const trigger = optionDiscussionTrigger?.isConnected ? optionDiscussionTrigger
    : [...el.dashboard.querySelectorAll('[data-option-discuss], [data-card-explain]')].find(button => button.dataset.optionKey === previousKey);
  trigger?.focus({ preventScroll: true });
});

function optionDiscussionPrompt(p, view, asOf) {
  const o = p.option;
  const brokerDate = view.isLive ? payload.brokerAsOf?.[p.channel]
    : payload.model?.history?.find(row => row.date === view.label)?.brokerAsOf?.[p.channel];
  return [
    `Let's discuss this specific option position: ${optionUnderlyingLabel(o)} ${o.side} ${o.right}, strike ${o.strike}${p.currency ? ` ${p.currency}` : ''}, expiry ${o.expiry}.`,
    `Position identifier: ${p.ticker}. Broker/channel: ${p.channel}. Quantity: ${p.units} contracts. Multiplier: ${o.multiplier}.`,
    `Selected dashboard: ${view.isLive ? 'latest view' : 'historical snapshot'} as of ${asOf}. Broker positions as of ${brokerDate || 'unknown'}. These are snapshot details; verify the current holding and quotes before assessing it.`,
    'Research this exact contract and broker position and recommend how to manage its risk. Start with a concise recommendation and the main reason, then show the supporting evidence and calculations. Use the available options specialist and research tools; complete the analysis with available evidence before asking a follow-up question.',
    'Verify the current position, underlying spot and timestamped option-chain bid/ask, liquidity, implied volatility and remaining time to expiry. Check same-account cash, share coverage, related option legs and portfolio concentration before assuming this is cash-secured, covered, naked or part of a spread. Treat unavailable data as unknown, never zero. If the position has expired or is no longer held, distinguish a historical review from a current decision and verify any recorded close, exercise or assignment rather than assuming it.',
    'Research the underlying outlook over the remaining option life: relevant earnings, ex-dividend dates, company filings/news and material sector or macro events. Cite source links and dates for material findings and distinguish observed facts from your outlook. Connect the catalysts to this contract\'s downside, upside and early-assignment or exercise risks where applicable; do not substitute a generic company summary.',
    'Build a compact bear/base/bull scenario table over the remaining option life with explicit underlying-price assumptions, their rationale, and the resulting expiry payoff and position P&L for the actual side, quantity, multiplier and currency. Separate remaining gains/losses from today from total P&L since entry; use verified entry premium only when available. Show breakeven, maximum gain/loss (including unlimited exposure where applicable), assignment funding or share delivery and the effect on portfolio exposure. Assignment funding is not itself a loss. Label scenarios as conditional illustrations, not forecasts or probabilities; label any sourced or model-derived probabilities with method and limitations. Do not invent Greeks, quotes, costs or precision, and do not use expiry payoff as a pre-expiry mark.',
    'Compare holding, closing or reducing, rolling, and a defined-risk hedge where appropriate. For each viable choice, show the risk reduced, risk retained or added, estimated cash credit/debit, capital or shares required, and the outcome under the same underlying-price scenarios. Use fresh bid/ask for the exact replacement or hedge contracts, specify strike/expiry/quantity, and label fees/slippage estimates. If expiries differ, disclose the comparison horizon and any unvalued residual exposure. A roll realizes the old leg\'s P&L and opens new risk; a net credit is not profit or proof of lower risk. If usable quotes are unavailable, give conditional decision rules rather than fabricated prices or an executable trade.',
    'Finish with a ranked, practical recommendation: preferred action and why, a reasonable alternative, specific price/date/event triggers to act or reassess, and what evidence would change your view. Tailor it to the recorded risk limits, available capital and willingness to own or deliver shares. Where those preferences are unknown, state your assumptions and give a conditional recommendation; ask at most one decision-critical follow-up question after the analysis. Keep the answer focused, use a compact comparison table, identify material data gaps, and do not execute trades.',
  ].join('\n\n');
}

async function startOptionDiscussion(button, retryRequestId) {
  const key = button.dataset.optionKey;
  if (pendingDiscussions.has(key)) return;
  let discussion = optionDiscussions.get(key);
  if (discussion) {
    document.getElementById('optionChatStatus').textContent = '';
    button.dataset.optionRequestId = discussion.requestId;
    discussionRequests.set(discussion.requestId, button.cloneNode(true));
    activeOptionDiscussionKey = key;
    optionDiscussionTrigger = button;
    sendOptionPanelMessage({ type: 'utarus:chat-panel:open', ...discussion });
    highlightOptionDiscussion();
    return;
  }
  pendingDiscussions.add(key);
  discussion = { requestId: retryRequestId || crypto.randomUUID(), title: button.dataset.optionTitle, context: button.dataset.optionContext };
  button.dataset.optionRequestId = discussion.requestId;
  discussionRequests.set(discussion.requestId, button.cloneNode(true));
  optionDiscussions.set(key, discussion);
  activeOptionDiscussionKey = key;
  optionDiscussionTrigger = button;
  sendOptionPanelMessage({ type: 'utarus:chat-panel:open', ...discussion });
  highlightOptionDiscussion();
  const status = document.getElementById('optionChatStatus');
  status.textContent = button.hasAttribute('data-card-explain') ? 'Starting your explanation…' : 'Starting your option discussion…';
  status.classList.remove('error');
  syncDiscussionButtons();
  try {
    // Omitting conversationId starts a focused conversation without a generic opener.
    const response = await fetch('/api/chat/messages', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: button.dataset.cardPrompt ?? button.dataset.optionDiscuss, composeSource: { kind: 'host_seed' } }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || body.error || 'Chat is unavailable.');
    if (typeof body.conversationId !== 'string' || !body.conversationId.trim()) {
      throw new Error('The chat did not return a conversation.');
    }
    discussion.conversationId = body.conversationId;
    sendOptionPanelMessage({ type: 'utarus:chat-panel:ready', requestId: discussion.requestId, conversationId: body.conversationId });
    status.textContent = '';
    // Standalone report previews have no shell to host the panel.
    if (window.parent === window) window.location.assign(`/?c=${encodeURIComponent(body.conversationId)}`);
  } catch (error) {
    optionDiscussions.delete(key);
    sendOptionPanelMessage({ type: 'utarus:chat-panel:error', requestId: discussion.requestId, error: error instanceof Error ? error.message : 'Please try again.' });
    status.textContent = `Couldn't open the discussion. ${error instanceof Error ? error.message : 'Please try again.'}`;
    status.classList.add('error');
  } finally {
    pendingDiscussions.delete(key);
    syncDiscussionButtons();
  }
}

function wheelRiskTable(rows, radar, view, asOf) {
  const eligible = rows.filter(r => r.estimate.probability != null || (r.days >= 0 && r.days <= 7));
  const filtered = eligible.filter(r =>
    (riskRightFilter === 'all' || r.p.option.right === riskRightFilter) &&
    (riskBrokerFilter === 'all' || r.p.channel === riskBrokerFilter) &&
    (riskLevelFilter === 'all' || riskLevel(r.estimate.probability) === riskLevelFilter) &&
    (!riskSearch || optionInstrumentLabel(r.p).toLowerCase().includes(riskSearch.toLowerCase()))
  ).sort((a,b) => (a.days ?? Infinity) - (b.days ?? Infinity) || (b.estimate.probability ?? -1) - (a.estimate.probability ?? -1));
  const right = ['all','put','call'].map(value => `<button type="button" class="chip-btn${riskRightFilter === value ? ' on' : ''}" data-risk-right="${value}" aria-pressed="${riskRightFilter === value}">${value === 'all' ? 'All' : value.toUpperCase()}</button>`).join('');
  const levels = [['all','All'],['danger','Act now >60%'],['warning','Caution 45–60%'],['ok','Comfortable']].map(([value,label]) => `<button type="button" class="risk-filter risk-filter-${value}${riskLevelFilter === value ? ' on' : ''}" data-risk-level="${value}" aria-pressed="${riskLevelFilter === value}">${escapeHtml(label)}</button>`).join('');
  const columns = ['FIN INSTRUMENT','Pos','Days','Spot','Strike','Moneyness %','IV','If Assigned','Prob. ITM','Last ($)','Avg Px','Market Value','Unrealized P&L (%)','Broker'];
  const body = filtered.map(({p,spot,days,estimate,exposure}) => {
    const o = p.option, multiplier = Number(o.multiplier || 100);
    const mark = Number.isFinite(p.brokerMark) ? p.brokerMark : Number(o.mark);
    const value = -mark * Number(p.units);
    const cost = Number(p.avgCost) * Number(p.units);
    const pl = value + cost;
    const pct = cost > 0 ? pl / cost * 100 : null;
    const probability = estimate.probability;
    const tone = riskLevel(probability);
    const label = tone === 'danger' ? 'Act now' : tone === 'warning' ? 'Caution' : 'Comfortable';
    const moneyness = spot > 0 && o.strike > 0 ? (spot - o.strike) / o.strike * 100 : null;
    const itm = moneyness != null && (o.right === 'put' ? moneyness < 0 : moneyness > 0);
    const money = (n,digits=0) => Number.isFinite(n) ? fmtPrettyMoney(n,p.currency || reportingCcyCode(view),digits) : '—';
    return `<tr class="risk-row risk-row-${tone}" data-risk-underlying="${escapeHtml(o.underlying)}" tabindex="0" aria-label="Highlight ${escapeHtml(o.underlying)} in open options">
      <td>${optionInstrumentButton(p,view,asOf)}</td><td class="num">${-Number(p.units)}</td><td class="num">${days == null ? '—' : `${days}d`}</td>
      <td class="num">${spot > 0 ? Number(spot).toFixed(2) : '—'}</td><td class="num">${money(Number(o.strike))}</td>
      <td class="num ${itm ? 'down' : 'muted'}">${moneyness == null ? '—' : fmtSigned(moneyness,1)+'%'}</td>
      <td class="num muted">${estimate.iv == null ? '—' : (estimate.iv*100).toFixed(0)+'%'}</td>
      <td class="num">${Number.isFinite(exposure) ? fmtPrettyMoney(exposure,reportingCcyCode(view),0) : '—'}</td>
      <td title="${escapeHtml(probability == null ? estimate.reason : 'Black–Scholes estimate from this contract’s broker mark and available underlying spot; r = 4%, q = 0, T = DTE/365.')}">${riskPill(tone, probability == null ? '—' : `${(probability*100).toFixed(1)}% · ${label}`)}</td>
      <td class="num">${Number.isFinite(mark) ? (mark/multiplier).toFixed(2) : '—'}</td><td class="num">${(Number(p.avgCost)/multiplier).toFixed(2)}</td>
      <td class="num">${money(value)}</td><td class="num ${plClass(pl)}">${money(pl)}${pct == null ? '' : ` (${pct.toFixed(1)}%)`}</td><td>${brokerLabel(p.channel)}</td>
    </tr>`;
  }).join('');
  return `<div class="metric-card table-card risk-card">
    <div class="risk-toolbar">${brokerFilters('risk',riskBrokerFilter,rows.map(r=>r.p))}
      <div class="option-filter-group"><span class="label-eyebrow">Right</span>${right}</div>
      <label class="risk-search"><span class="visually-hidden">Search contracts</span><input id="riskSearch" type="search" placeholder="Ticker, strike, expiry" value="${escapeHtml(riskSearch)}" /></label>
      <div class="risk-legend" role="group" aria-label="Filter by risk">${levels}</div>
      <p class="risk-filter-count" role="status">${filtered.length} of ${eligible.length} contracts · ${radar.length} flagged${riskLevelFilter === 'all' ? ' · All risks' : ''}</p>
    </div>
    <div class="table-scroll"><table class="report risk-table"><thead><tr>${columns.map((label,i)=>`<th scope="col">${escapeHtml(label)}${i===0 ? ' <span class="instrument-hint">(Discuss)</span>' : ''}${label==='Last ($)' || label==='Avg Px' ? '<button type="button" class="help-dot" data-help="Price per underlying share. Position totals include the contract multiplier and quantity." aria-label="Explain option price units">?</button>' : ''}</th>`).join('')}</tr></thead>
    <tbody>${body || `<tr><td colspan="14" class="empty">No contracts match these filters.</td></tr>`}</tbody></table></div>
    <details class="risk-method"><summary>How Prob. ITM is calculated</summary><p>Implied volatility is solved from each contract’s own broker mark by bisection on Black–Scholes (r = 4%, q = 0, T = DTE/365). The risk-neutral probability of finishing in the money is N(−d₂) for puts and N(d₂) for calls. Contracts without an available underlying spot or a usable broker mark show “—” and still appear here when they expire within 7 days. This estimates finishing in the money, not early assignment. The exposure cards include contracts above 30% and contracts expiring within 7 days; probability-weighted exposure stays unavailable if any included contract cannot be scored.</p></details>
  </div>`;
}

function renderExpiryRisk(view, asOf) {
  if (!el.expiryRow) return;
  const hasOptions = (view.optionCount || 0) > 0;
  if (el.expiryBlock) el.expiryBlock.classList.toggle('hidden', !hasOptions);
  window.OptionRiskView?.update({ payload, hasOptions, channel: selectedChannel, accountChannels: selectedBroker()?.channels.filter(channel => payload.model.live.positions.some(row => row.channel === channel)), date: selectedDate, isLive: view.isLive });
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
  const savedRisk = savedDashboardScope(view).risk[isWheelDesk ? 'wheel' : 'matching'];
  const rows = savedRisk.rows.map(row => ({ ...row, exposure: row.exposure ?? NaN }));
  const shorts = rows.map(row => row.p);
  const radar = rows.filter(row => row.flagged);
  const { missing, exposure, weighted, cover } = savedRisk;
  const cash = view.navComplete === false ? null : view.cashAmount;


  if (el.expiryLead) {
    el.expiryLead.textContent =
      shorts.length === 0
        ? 'No short option lots in this view. Section 03 (holdings table) lists every open position.'
        : `Monitor your options contracts approaching expiry and identify those with the highest assignment risk. Contracts with a probability of expiring in the money above 30%, plus confirmed ITM contracts expiring within 21 days, are prioritised by nearest expiry, followed by risk level. Discuss: start a chat to review a contract and its details. Click a ticker: highlight the same stock in Section 03.${missing ? ` ${missing} contracts could not be scored; view them in Section 03.` : ''}`;
  }

  el.expiryRow.innerHTML = [
    metricCardHtml(
      'High-risk ITM exposure',
      radar.length && exposure != null ? fmtPrettyMoney(exposure, reportingCcyCode(view), 0) : '—',
      '',
      `Total value of shares you could have to buy for short puts, or deliver for short calls, if every contract in this risk list is assigned. ${isWheelDesk ? 'The list includes contracts above 30% probability of finishing in the money and contracts expiring within 7 days.' : 'The list includes contracts with an estimated chance above 30% of finishing in the money, and confirmed ITM contracts expiring within 21 days.'} This is a possible exposure, not a forecast.`,
    ),
    metricCardHtml(
      'Probability-weighted exposure',
      radar.length && weighted != null ? fmtPrettyMoney(weighted, reportingCcyCode(view), 0) : '—',
      '',
      'Each contract’s assignment value multiplied by its estimated chance of finishing in the money, then added together. For example, $10,000 at a 40% chance contributes $4,000. This is a model estimate, not the cash you will actually need.',
      radar.length ? 'down' : '',
    ),
    metricCardHtml(
      'Cash available',
      cash != null ? fmtPrettyMoney(cash, view.cashCurrency || reportingCcyCode(view), 0) : '—',
      '',
      'Uninvested cash reported when the broker data was last fetched. It excludes extra borrowing capacity and may differ from your balance now.',
    ),
    metricCardHtml(
      'High-risk coverage',
      cover != null ? `${cover.toFixed(0)}%` : '—',
      '',
      'How much of the assignment value in this risk list your recorded cash could cover. For example, $5,000 cash against $10,000 exposure gives 50% coverage. It does not tell you the broker’s margin requirement.',
      cover != null && cover < 100 ? 'down' : '',
    ),
  ].join('');

  if (el.expiryTable) {
    if (isWheelDesk) {
      el.expiryTable.innerHTML = wheelRiskTable(rows, radar, view, asOf);
    } else if (shorts.length === 0) {
      el.expiryTable.innerHTML = emptyCard('No short option lots in this view.');
    } else {
      const chip = (kind, value, label, selected) =>
        `<button type="button" class="chip-btn${selected ? ' on' : ''}" data-risk-${kind}="${escapeHtml(value)}" aria-pressed="${selected}">${escapeHtml(label)}</button>`;
      const filtered = radar.filter((r) =>
        (riskRightFilter === 'all' || r.p.option.right === riskRightFilter) && (!riskSearch || `${optionUnderlyingLabel(r.p.option)} ${r.p.option.strike} ${r.p.option.expiry}`.toLowerCase().includes(riskSearch.toLowerCase())),
      ).sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || (b.estimate.probability ?? -1) - (a.estimate.probability ?? -1));
      const head = ['Contract', 'Entry Spot', 'Current Spot', 'Strike', 'Moneyness %', 'Expiry', 'DTE', 'IV', 'Premium', 'If assigned', 'Prob. ITM', 'Broker'];
      el.expiryTable.innerHTML = `<div class="metric-card table-card risk-card">
        <div class="risk-toolbar">
          <div class="option-filter-group"><span class="label-eyebrow">Right</span>
            ${['all', 'put', 'call'].map((r) => chip('right', r, r === 'all' ? 'All' : r.toUpperCase(), riskRightFilter === r)).join('')}
          </div>
          <label class="risk-search">Search contracts <input id="riskSearch" type="search" placeholder="Ticker, strike, expiry" value="${escapeHtml(riskSearch)}" /></label>
          <div class="risk-legend"><span title="High risk. Review your potential assignment and cash requirements.">${riskPill('danger', 'Act Now >60%')}</span><span title="Moderate risk. Review whether you are comfortable with the potential assignment.">${riskPill('warning', 'Caution 45–60%')}</span><span title="Lower risk based on the current probability.">${riskPill('ok', 'Comfortable')}</span><span>${radar.length} of ${shorts.length} flagged</span></div>
        </div>${radar.length === 0 ? `<div class="risk-empty-note">No contracts are currently scored above 30%. All open contracts remain available in Section 03. ${missing ? `${missing} could not be scored from the available quote and mark.` : 'All scored contracts are below the threshold.'}</div>` : ''}<div class="table-scroll"><table class="report risk-table">
        <thead><tr>${head.map((h) => `<th scope="col">${escapeHtml(h)}${h === 'Premium' ? '<small class="premium-column-basis">Opening / latest roll credit<br>Before fees</small>' : ''}</th>`).join('')}</tr></thead>
        <tbody>${filtered.length ? filtered.map(({ p, spot, days, estimate, exposure: assigned }) => {
            const o = p.option;
            const probability = estimate.probability == null ? null : estimate.probability * 100;
            const tone = probability == null ? 'muted' : probability > 60 ? 'danger' : probability >= 45 ? 'warning' : 'ok';
            const status = probability == null ? estimate.reason : probability > 60 ? 'Act now' : probability >= 45 ? 'Caution' : probability > 30 ? 'Comfortable' : 'Below 30%';
            const moneyness = spot > 0 && o.strike > 0 ? ((spot - o.strike) / o.strike) * 100 : null;
            const itm = moneyness != null && (o.right === 'put' ? moneyness < 0 : moneyness > 0);
            const trade = view.isLive ? payload.optionTradeDetails?.[p.ticker] : null;
            return `<tr class="risk-row risk-row-${tone}" data-risk-underlying="${escapeHtml(o.underlying)}" tabindex="0" aria-label="Highlight ${escapeHtml(o.underlying)} in open options">
              <td><span class="risk-contract">${tone === 'danger' ? '<span class="pulse-dot" aria-hidden="true"></span>' : ''}<strong>${escapeHtml(o.underlying || p.ticker)}</strong><span class="risk-contract-meta">${escapeHtml(o.right.toUpperCase())} · ${o.right === 'put' ? 'CSP' : 'CC'} · ${p.units}x</span></span>
                <button type="button" class="option-discuss" aria-expanded="false" data-option-key="${escapeHtml(JSON.stringify([p.ticker, p.channel, view.isLive ? 'latest' : asOf]))}" data-option-title="${escapeHtml(`${optionUnderlyingLabel(o)} · ${o.strike} ${o.right.toUpperCase()} · ${o.expiry}`)}" data-option-context="${escapeHtml(`${p.channel} · ${p.units} contracts · Snapshot ${asOf}`)}" data-option-discuss="${escapeHtml(optionDiscussionPrompt(p, view, asOf))}" aria-label="Discuss ${escapeHtml(`${optionUnderlyingLabel(o)} ${o.side} ${o.right}, strike ${o.strike}, expiry ${o.expiry}, ${p.channel}`)}" title="Discuss this contract in the chat panel"${pendingDiscussions.has(JSON.stringify([p.ticker, p.channel, view.isLive ? 'latest' : asOf])) ? ' disabled' : ''}>Discuss</button>
              </td>
              <td class="num">${entrySpotHtml(trade, p.currency)}</td>
              <td class="num">${spot > 0 ? Number(spot).toFixed(2) : '—'}</td>
              <td class="num">${fmtPrettyMoney(o.strike, p.currency || reportingCcyCode(view), 0)}</td>
              <td class="num ${itm ? 'down' : 'muted'}">${moneyness == null ? '—' : `${moneyness >= 0 ? '+' : ''}${moneyness.toFixed(1)}%`}</td>
              <td class="num">${optionDateLabel(o.expiry)}</td>
              <td class="num">${days == null ? '—' : `${days}d`}</td>
              <td class="num muted">${estimate.iv == null ? '—' : `${Math.round(estimate.iv * 100)}%`}</td>
              <td class="num">${openingPremiumHtml(trade, p.currency, true)}</td>
              <td class="num muted">${Number.isFinite(assigned) && assigned > 0 ? fmtPrettyMoney(assigned, view.navComplete === false ? p.currency : reportingCcyCode(view), 0) : '—'}</td>
              <td title="${escapeHtml(p.probabilityQuote ? `Estimate uses option trade at ${p.probabilityQuote.optionAsOf} and stock quote at ${p.probabilityQuote.spotAsOf}. Current Spot may be newer.` : 'A timestamped option trade and a stock quote within 15 minutes are required.')}">${riskPill(tone, probability == null ? `— · ${status}` : `${probability.toFixed(1)}% · ${status}`)}</td>
              <td>${escapeHtml(p.channel === DEFAULT_CHANNEL ? 'Unassigned' : p.channel.toUpperCase())}</td>
            </tr>`;
          }).join('') : '<tr><td colspan="12" class="empty">No flagged contracts match these filters.</td></tr>'}</tbody></table></div>
        <div class="risk-method">How Prob. ITM is calculated: Implied volatility is derived from a timestamped option trade paired with the regular-session stock quote from the same options-chain response (within 15 minutes, on the same date). Before the market opens, these may be the last regular-session prices. Hover over Prob. ITM for both quote times; Current Spot may be newer. Stored broker marks and untimestamped bid/ask prices are not used for this estimate. If matching quotes are unavailable, the probability stays blank. Implied volatility is used in the Black–Scholes model to estimate the probability of expiring in the money: N(−d₂) for puts and N(d₂) for calls, assuming a zero risk-free interest rate and no dividend adjustment. Contracts cannot be scored when the underlying quote or a usable mark is missing, contract terms are incomplete, or the mark cannot produce a valid IV. Confirmed ITM contracts expiring within 21 days remain in this radar even without a probability estimate. Their assignment exposure is included, while probability-weighted exposure stays unavailable. Other unscored contracts remain available in Section 03. Premium is the opening credit, or replacement STO minus old-contract BTC for the latest verified roll, before fees; it is not realized profit.</div>
      </div>`;
    }
  }
  renderPremiumEngine(view);
  renderOpenOptions(view);
  installCardExplainButtons();
  highlightOptionDiscussion();
}

el.expiryTable?.addEventListener('click', (event) => {
  const chip = event.target.closest('button');
  if (chip?.dataset.optionDiscuss != null) {
    void startOptionDiscussion(chip);
    return;
  }
  if (chip?.dataset.riskRight != null) riskRightFilter = chip.dataset.riskRight;
  else if (chip?.dataset.riskBroker != null) riskBrokerFilter = chip.dataset.riskBroker;
  else if (chip?.dataset.riskLevel != null) riskLevelFilter = chip.dataset.riskLevel;
  else {
    const row = event.target.closest('[data-risk-underlying]');
    if (!row) return;
    highlightedUnderlying = row.dataset.riskUnderlying;
    optionRightFilter = 'all';
    const view = buildView(selectedDate, selectedChannel);
    setOptionTab('open');
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

function recordedMonthlyData(view) {
  const saved = savedDashboardScope(view).monthly;
  return { ...saved, byMonth: new Map(saved.byMonth), byUnderlying: new Map(saved.byUnderlying),
    realized: new Map(saved.realized), monthly: new Map(saved.monthly.map(([month, stats]) => [month, { ...stats, contributions: new Map(stats.contributions) }])) };
}

function monthLabel(month) {
  const [year, number] = month.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(number) - 1]} ${year}`;
}

function monthlyLineCard(title, data, ccy, help) {
  const entries = [...data.monthly].sort(([a], [b]) => a.localeCompare(b));
  const available = entries.filter(([, stats]) => stats.value != null);
  const max = Math.max(1, ...available.map(([, stats]) => Math.abs(stats.value)));
  const x = i => 95 + i * 610 / Math.max(1, entries.length - 1);
  const y = n => 130 - n / max * 90;
  const lines = entries.slice(1).map(([, stats], index) => {
    const previous = entries[index][1];
    if (stats.value == null || previous.value == null) return '';
    return `<line x1="${x(index)}" y1="${y(previous.value)}" x2="${x(index + 1)}" y2="${y(stats.value)}" stroke="var(--brand)" stroke-width="2"${stats.partial || previous.partial ? ' stroke-dasharray="5 5"' : ''} />`;
  }).join('');
  const feeLabel = basis => basis === 'net' ? 'After reported fees' : basis === 'gross' ? 'Before fees' : 'Fees partly included';
  const rows = entries.map(([month, stats]) => `<tr data-pnl-month="${escapeHtml(month)}">
    <td>${escapeHtml(monthLabel(month))}</td>
    <td class="num ${stats.value == null ? '' : plClass(stats.value)}">${stats.value == null ? 'Not available' : fmtPrettyMoney(stats.value, ccy)}${stats.value != null && stats.partial ? '<small class="pnl-partial">Partial subtotal</small>' : ''}</td>
    <td>${stats.value == null ? stats.excluded ? 'Missing trade history' : 'No completed result recorded' : feeLabel(stats.basis)}</td>
    <td>${stats.count ? `<details class="pnl-month-detail"><summary>${stats.count} trade result${stats.count === 1 ? '' : 's'}${stats.excluded ? ` · ${stats.excluded} excluded` : ''}</summary><ul>${[...stats.contributions].sort(([, a], [, b]) => a.value - b.value).map(([name, row]) => `<li><span>${escapeHtml(name)}</span><strong>${fmtPrettyMoney(row.value, ccy)}</strong></li>`).join('')}</ul><p>Option profit/loss only. Stock gains and losses are separate.</p></details>` : stats.excluded ? `${stats.excluded} record${stats.excluded === 1 ? '' : 's'} cannot yet be calculated` : 'No completed trades recorded'}</td>
  </tr>`).join('');
  const ticks = entries.map(([month], i) => i === 0 || i === entries.length - 1 || i % Math.max(1, Math.ceil(entries.length / 6)) === 0
    ? `<text class="pnl-axis" x="${x(i)}" y="247" text-anchor="middle">${escapeHtml(monthLabel(month))}</text>` : '').join('');
  return `<div class="metric-card pnl-card"><div class="metric-head"><h3>${escapeHtml(title)}</h3><button class="help-dot" type="button" aria-label="Explain monthly profit and loss" data-help="${escapeHtml(help)}">?</button></div>
    <p class="pnl-caption">Profit or loss from recorded completed option trades, shown in the month they ended. This is not your full account profit or loss.</p>
    ${available.length ? `<div class="pnl-chart-scroll"><svg class="monthly-line" viewBox="0 0 760 270" role="img" aria-label="Monthly option profit and loss in ${escapeHtml(ccy || 'reporting currency')}. Values and partial months are listed in the table below."><text class="pnl-axis" x="12" y="18">P&amp;L (${escapeHtml(ccy || 'reporting currency')})</text>${[-max, 0, max].map(value => `<line x1="90" y1="${y(value)}" x2="720" y2="${y(value)}" stroke="currentColor" opacity="${value === 0 ? '.4' : '.12'}" /><text class="pnl-axis" x="80" y="${y(value) + 4}" text-anchor="end">${escapeHtml(fmtPrettyMoney(value, ccy, 0))}</text>`).join('')}${lines}${entries.map(([month, stats], i) => stats.value == null ? `<text class="pnl-missing" x="${x(i)}" y="225" text-anchor="middle">—</text>` : `<circle class="${stats.partial ? 'pnl-point-partial' : 'pnl-point'}" cx="${x(i)}" cy="${y(stats.value)}" r="5"><title>${escapeHtml(monthLabel(month))}: ${escapeHtml(fmtPrettyMoney(stats.value, ccy))}${stats.partial ? ' · Partial subtotal' : ''} · ${feeLabel(stats.basis)}</title></circle>`).join('')}${ticks}</svg></div><p class="pnl-scroll-hint">Swipe the chart to see all months.</p><p class="pnl-legend"><span>● Recorded result</span><span>○ Partial subtotal</span><span>— No result available</span><span>Dashed line: partial results</span></p>` : '<p class="empty">No completed option results can be calculated yet. Open positions are shown in Section 03.</p>'}
    ${entries.length ? `<div class="table-scroll"><table class="report pnl-table"><thead><tr><th>Month</th><th>Recorded P&amp;L</th><th>Fees / availability</th><th>What is included</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
  </div>`;
}

// Position economics (cost, value and P&L) are already in reporting currency.
// Never apply FX twice or mix unconverted positions into a chart subtotal.
function openBookPremiumData(view) {
  const saved = savedDashboardScope(view).openBook;
  return Object.fromEntries(Object.entries(saved).map(([key, entries]) => [key, new Map(entries)]));
}

function premiumChartCard(title, entries, caption, options = {}) {
  const sorted = [...entries].sort(([a, av], [b, bv]) => options.monthly ? a.localeCompare(b)
    : av == null || bv == null ? (av == null) - (bv == null) || a.localeCompare(b) : Math.abs(bv) - Math.abs(av) || a.localeCompare(b));
  const rows = sorted.map(([label, value]) => ({
    label: options.monthly && /^\d{4}-\d{2}$/.test(label) ? monthLabel(label) : label,
    value, display: value == null ? 'Unavailable' : options.percent ? `${value.toFixed(1)}%` : fmtPrettyMoney(value, options.ccy),
  }));
  const known = rows.filter(r => r.value != null);
  const chartLabel = `${title}. ${caption}. Exact values are listed below.`;
  const colors = ['#8985ff', '#e0e3ea', '#9299a8', '#29c982', '#efb83e', '#f15368', '#63c9eb', '#b19afa'];
  let visual = '';
  if (!known.length) {
    visual = `<p class="empty">${rows.length ? 'Values unavailable for this view. Check valuation and currency coverage.' : options.percent ? 'No holdings in this view.' : 'No open option positions in this view.'}</p>`;
  } else if (options.percent) {
    const total = known.reduce((sum, r) => sum + Math.abs(r.value), 0);
    let offset = 0;
    const arcs = known.map((r, i) => {
      const length = total ? Math.abs(r.value) / total * 100 : 0;
      const arc = `<circle class="premium-donut-segment" cx="120" cy="120" r="78" fill="none" stroke="${r.value < 0 ? 'var(--danger)' : colors[i % colors.length]}" stroke-width="40" pathLength="100" stroke-dasharray="${length} ${100 - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 120 120)" tabindex="0" role="img" aria-label="${escapeHtml(r.label + ': ' + r.display)}"><title>${escapeHtml(r.label + ': ' + r.display)}</title></circle>`;
      offset += length;
      return arc;
    }).join('');
    const legend = rows.map((r, i) => `<li><span class="premium-legend-label"><i style="background:${r.value == null ? 'var(--muted-foreground)' : r.value < 0 ? 'var(--danger)' : colors[i % colors.length]}"></i>${escapeHtml(r.label)}</span><span class="num${r.value < 0 ? ' down' : ''}">${escapeHtml(r.display)}</span></li>`);
    visual = `<svg class="premium-donut" viewBox="0 0 240 240" role="group" aria-label="${escapeHtml(chartLabel)}"><circle cx="120" cy="120" r="78" fill="none" stroke="var(--muted)" stroke-width="40" />${arcs}</svg><ul class="premium-legend">${legend.slice(0, 9).join('')}</ul>${legend.length > 9 ? `<details class="premium-values"><summary>Show ${legend.length - 9} more holdings</summary><ul class="premium-legend">${legend.slice(9).join('')}</ul></details>` : ''}`;
  } else {
    const width = Math.max(640, rows.length * (options.monthly ? 65 : 48) + 90);
    const left = 78, right = width - 18, top = 20, bottom = 250;
    const low = Math.min(0, ...known.map(r => r.value)), high = Math.max(0, ...known.map(r => r.value));
    const span = high - low || 1;
    const rough = span / 4, power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map(n => n * power).find(n => n >= rough);
    const min = Math.floor(low / step) * step, max = Math.ceil(high / step) * step || step;
    const y = value => bottom - (value - min) / (max - min) * (bottom - top);
    const slot = (right - left) / Math.max(1, rows.length);
    const x = i => options.type === 'area' && rows.length > 1
      ? left + i * (right - left) / (rows.length - 1) : left + slot * (i + .5);
    const zero = y(0);
    let grid = '';
    for (let value = min; value <= max + step / 2; value += step) {
      grid += `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="premium-gridline${Math.abs(value) < step / 100 ? ' premium-zero' : ''}" /><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end" class="premium-axis">${escapeHtml(fmtPrettyMoney(value, options.ccy, 0))}</text>`;
    }
    const tickEvery = Math.max(1, Math.ceil(rows.length / (width / 65)));
    const ticks = rows.map((r, i) => i % tickEvery === 0 || i === rows.length - 1 ? `<text x="${x(i)}" y="274" text-anchor="middle" class="premium-axis">${escapeHtml(r.label)}</text>` : '').join('');
    let marks = '';
    if (options.type === 'area') {
      // Separate paths at missing values; curves stay within the adjacent values.
      const segments = []; let segment = [];
      rows.forEach((r, i) => { if (r.value == null) { if (segment.length) segments.push(segment); segment = []; } else segment.push({ x: x(i), y: y(r.value) }); });
      if (segment.length) segments.push(segment);
      marks = segments.map(points => {
        let path = `M ${points[0].x} ${points[0].y}`;
        points.slice(1).forEach((p, i) => { const prev = points[i], mid = (prev.x + p.x) / 2; path += ` C ${mid} ${prev.y}, ${mid} ${p.y}, ${p.x} ${p.y}`; });
        return `<path class="premium-area-fill" d="${path} L ${points.at(-1).x} ${zero} L ${points[0].x} ${zero} Z" /><path class="premium-area-line" d="${path}" />`;
      }).join('') + rows.map((r, i) => r.value == null ? '' : `<circle class="premium-area-point${known.length === 1 ? ' premium-area-point-single' : ''}" cx="${x(i)}" cy="${y(r.value)}" r="4" tabindex="0" role="img" aria-label="${escapeHtml(r.label + ': ' + r.display)}"><title>${escapeHtml(r.label + ': ' + r.display)}</title></circle>`).join('');
    } else {
      marks = rows.map((r, i) => r.value == null ? '' : `<rect class="premium-column${options.type === 'pnl' ? r.value < 0 ? ' premium-column-loss' : ' premium-column-gain' : ''}" x="${x(i) - slot * .36}" y="${Math.min(zero, y(r.value))}" width="${slot * .72}" height="${Math.max(1, Math.abs(zero - y(r.value)))}" rx="4" tabindex="0" role="img" aria-label="${escapeHtml(r.label + ': ' + r.display)}"><title>${escapeHtml(r.label + ': ' + r.display)}</title></rect>`).join('');
    }
    visual = `<div class="premium-plot-scroll" tabindex="0" role="region" aria-label="${escapeHtml(title)} chart, scroll horizontally for all categories"><svg class="premium-plot premium-plot-${escapeHtml(options.type || 'bar')}" style="min-width:${width}px" viewBox="0 0 ${width} 295" role="group" aria-label="${escapeHtml(chartLabel)}">${grid}${marks}${ticks}</svg></div><p class="premium-scroll-hint">Swipe the chart to see all categories, or expand exact values.</p><details class="premium-values"><summary>View exact values${rows.some(r => r.value == null) ? ' · some values unavailable' : ''}</summary><table><thead><tr><th>${options.monthly ? 'Expiry month' : 'Underlying'}</th><th>Amount</th></tr></thead><tbody>${rows.map(r => `<tr><td>${escapeHtml(r.label)}</td><td class="num${r.value < 0 ? ' down' : ''}">${escapeHtml(r.display)}</td></tr>`).join('')}</tbody></table></details>`;
  }
  return `<div class="metric-card premium-chart${options.percent ? ' premium-concentration' : ''}" id="${escapeHtml(options.id)}"><div class="label-eyebrow">${escapeHtml(title)}</div>${visual}<div class="metric-sub premium-chart-caption">${options.help ? `<button class="help-dot" type="button" aria-label="Explain ${escapeHtml(title)}" data-help="${escapeHtml(options.help)}">?</button> ` : ''}${escapeHtml(caption)}</div></div>`;
}

function renderPremiumEngine(view) {
  if (!el.premiumEngine || !el.premiumBlock) return;
  el.premiumBlock.classList.remove('hidden');
  const date = view.isLive ? (payload.generatedAt || '').slice(0, 10) : view.label;
  const data = recordedMonthlyData(view, date);
  const ccy = reportingCcyCode(view);
  const showRecordedPnlByMonth = payload.dashboardConfig?.showRecordedPnlByMonth === true;
  el.premiumHead.innerHTML = sectionHead('Section 02', 'Premium engine',
    'Explore net option premium, NAV concentration and unrealized P&L from the selected open book.');
  const rows = (entries, byAmount = false) => [...entries].sort(([a, av], [b, bv]) => {
    if (!byAmount) return b.localeCompare(a);
    if (av == null || bv == null) return av == null && bv == null ? a.localeCompare(b) : av == null ? 1 : -1;
    return bv - av || a.localeCompare(b);
  }).map(([label, value]) => ({ label, value: value ?? 0, display: value == null ? 'Unknown' : fmtPrettyMoney(value, ccy) }));
  const premiumHelp = 'Money received from selling options, minus money paid to buy options, grouped by the stock each option is based on. Includes recorded opening, closing and protective option trades, before brokerage fees. This is cash flow, not profit; missing history can make it incomplete.';
  const plHelp = 'Profit or loss from completed option trades, grouped by the month they ended. It is calculated from matched opening and closing trades, or reported directly by the broker. Partial subtotals exclude records that cannot be calculated. Fee treatment is shown for each month. Open positions and stock profit or loss are not included. Expand a month to see which stocks and brokers contribute.';
  const book = openBookPremiumData(view);
  const common = { ccy };
  const openHelp = 'For live rolled positions, uses the latest verified replacement opening credit plus the old-contract closing debit, once and before fees. Does not add the replacement opening credit again. An unverified roll is unavailable. Other positions use signed opening cost. Archived views use snapshot cost basis because live roll records cannot establish a historical roll. Grouped by current expiry or underlying, not trade date; this is not lifetime cash flow or realized profit.';
  const chart = (title, values, caption, options) => {
    if (!isWheelDesk) return premiumChartCard(title, values, caption, options);
    const entries = [...values].map(([label, row]) => ({ label: options.monthly ? monthLabel(label) : label, value: row,
      display: row == null ? '—' : options.percent ? row.toFixed(1) + '%' : fmtPrettyMoney(row, ccy, 2) }));
    return cssBarCard(title, entries, caption, { ...options, limit: 5, expanded: premiumChartExpansion.get(options.id) === true });
  };
  const openCards = chart('Net option premium by expiry month', book.premiumByExpiry, view.isLive ? 'Open book · net of verified roll buybacks' : 'Archived opening cost basis', { ...common, id: 'openPremiumExpiryCard', type: 'area', monthly: true, help: openHelp }) +
    chart('NAV concentration', book.concentration, 'Signed market value as % of NAV', { id: 'premiumConcentrationCard', percent: true, help: 'Signed market value divided by NAV, including option liabilities. Unavailable when NAV is incomplete or non-positive.' }) +
    chart('Net option premium by underlying', book.premiumByUnderlying, view.isLive ? 'Open book · net of verified roll buybacks' : 'Archived opening cost basis', { ...common, id: 'openPremiumUnderlyingCard', help: openHelp }) +
    chart('Open P&L by expiry month', book.pnlByExpiry, 'Unrealized · before fees', { ...common, id: 'openPnlExpiryCard', type: 'pnl', monthly: true, help: 'Signed option market value minus signed opening cost, grouped by expiry month.' });
  if (isWheelDesk) { el.premiumEngine.innerHTML = openCards; return; }
  const historyCards = cssBarCard('Net Option Premium by Month', rows(data.byMonth), 'Before fees · recorded trades', { id: 'monthlyPremiumCard', limit: 5 }) +
    cssBarCard('Net Option Premium by Underlying', rows(data.byUnderlying, true), 'Before fees · includes recorded option purchases and sales', { id: 'underlyingPremiumCard', limit: 5, help: premiumHelp }) +
    (showRecordedPnlByMonth ? monthlyLineCard('Recorded P&L by Month', data, ccy, plHelp) : '');
  const historyOpen = el.premiumEngine.querySelector('.premium-history')?.open || false;
  el.premiumEngine.innerHTML = openCards + `<details class="premium-history"${historyOpen ? ' open' : ''}><summary>Recorded trade history <span>Cash flow by trade date${showRecordedPnlByMonth ? ' · completed-trade P&L' : ''}</span></summary><div class="grid-2 premium-history-grid">${historyCards || '<p class="empty">No recorded option trades in this view yet.</p>'}</div></details>`;

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
    el.openOptionsHead.innerHTML = isWheelDesk ? '' : sectionHead(
      '',
      'Open options positions · broker view',
      `View all open option positions, grouped by expiry month. Cash flow is the opening credit or debit, or the latest verified roll including its closing leg, before fees. Verified vertical spreads show their combined opening cash flow above their legs. Missing or unreconciled data is shown as unknown. Entry Spot uses the execution price where recorded, otherwise the opening-day adjusted close. ${dates.length ? `Broker positions as of ${dates.join(' · ')}.` : 'Broker position date unavailable.'}`,
    );
  }
  const opts = allOptions.filter((p) =>
    (optionRightFilter === 'all' || p.option.right === optionRightFilter) &&
    (!isWheelDesk || optionBrokerFilter === 'all' || p.channel === optionBrokerFilter) &&
    (!isWheelDesk || !optionSearch || optionInstrumentLabel(p).toLowerCase().includes(optionSearch.toLowerCase())),
  );
  const chip = (kind, value, label, selected) =>
    `<button type="button" class="chip-btn${selected ? ' on' : ''}" data-option-${kind}="${escapeHtml(value)}" aria-pressed="${selected}">${escapeHtml(label)}</button>`;
  const filters = `<div class="option-ledger-filters">${isWheelDesk ? brokerFilters('option',optionBrokerFilter,allOptions) : ''}
    <div class="option-filter-group"><span class="label-eyebrow">Right</span>
      ${['all', 'put', 'call'].map((r) => chip('right', r, r.toUpperCase() === 'ALL' ? 'All' : r.toUpperCase(), optionRightFilter === r)).join('')}
    </div>${isWheelDesk ? `<label class="risk-search"><span class="visually-hidden">Search open contracts</span><input id="optionSearch" type="search" placeholder="Ticker, strike, expiry" value="${escapeHtml(optionSearch)}" /></label><span class="option-filter-count" role="status">${opts.length} of ${allOptions.length} contracts</span>` : ''}
  </div>`;
  const groups = new Map();
  for (const p of opts) {
    const m = p.option.expiry.slice(0, 7);
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(p);
  }
  const months = [...groups.keys()].sort();
  const ccy = reportingCcyCode(view);
  const prices = view.isLive ? payload?.equityPrices || {} : {};
  const columns = isWheelDesk ? ['FIN INSTRUMENT','Pos','Last ($)','PREMIUM / ROLL','Avg Px','MKT Value','Unrealized P&L (%)','Days','Opened','Spot','Entry Spot','Assignment','Broker'] : ['Financial instrument', 'Pos', 'Opened', 'Entry\nSpot', 'Current\nSpot', 'Assignment\nexposure', 'DTE', 'Trade cash flow ·\nBefore Fees', 'Open cost /\ncontract', 'Mark /\ncontract', 'Market\nvalue', 'Unrealized\nP&L', '% of max', 'Broker'];
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
    const cashFlowTotal = optionTradeCashFlowTotal(values.map(x => x.trade));
    const totalCredit = cashFlowTotal ? fmtPrettyMoney(cashFlowTotal.value, cashFlowTotal.currency, 2) : '—';
    const monthPct = currencies.length === 1 && sum('premium') > 0 ? sum('pl')/sum('premium')*100 : null;
    body += isWheelDesk ? `<tr class="option-month-total" data-month="${m}">
      <td><button type="button" class="option-month-toggle" data-option-month="${m}" aria-expanded="${!collapsedOptionMonths.has(m)}"><span aria-hidden="true">${collapsedOptionMonths.has(m) ? '▶' : '▼'}</span> TOTAL ${monthLabel} <span class="option-month-count">(${rows.length})</span></button></td>
      <td class="num">${sum('position')}</td><td></td><td class="num">${totalCredit}</td><td></td>
      <td class="num">${totalMoney(sum('marketValue'),0)}</td><td class="num ${plClass(sum('pl'))}">${totalMoney(sum('pl'),0)}${monthPct == null ? '' : ` (${monthPct.toFixed(1)}%)`}</td>
      <td class="num">${Number.isFinite(earliest) ? earliest+'d' : '—'}</td><td></td><td></td><td></td><td class="num">${totalMoney(sum('exposure'),0)}</td><td></td>
    </tr>` : `<tr class="option-month-total" data-month="${m}">
      <td><button type="button" class="option-month-toggle" data-option-month="${m}" aria-expanded="${!collapsedOptionMonths.has(m)}"><span aria-hidden="true">${collapsedOptionMonths.has(m) ? '▶' : '▼'}</span> TOTAL ${monthLabel} <span class="option-month-count">(${rows.length})</span></button></td>
      <td class="num">${sum('position')}</td>
      <td></td><td></td><td></td>
      <td class="num">${totalMoney(sum('exposure'), 0)}</td>
      <td class="num">${Number.isFinite(earliest) ? `${earliest}d earliest` : '—'}</td>
      <td class="num">${totalCredit}</td>
      <td></td><td></td><td class="num">${totalMoney(sum('marketValue'))}</td>
      <td class="num ${plClass(sum('pl'))}">${totalMoney(sum('pl'))}</td><td></td><td></td>
    </tr>`;
    if (collapsedOptionMonths.has(m)) continue;
    const shownSpreads = new Set();
    body += values.map(({ p, position, premium, mark, marketValue, pl, exposure, dte, captured, trade }) => {
      const o = p.option;
      const rowMoney = (n, digits = 2) => fmtPrettyMoney(n, p.currency || ccy, digits);
      const spot = prices[o.underlying];
      const label = `${optionUnderlyingLabel(o)} ${o.side === 'short' ? 'Short' : 'Long'} ${o.right === 'put' ? 'Put' : 'Call'} ${rowMoney(o.strike, Number.isInteger(o.strike) ? 0 : 2)} · ${optionDateLabel(o.expiry)} · ×${p.units}`;
      const opened = trade ? `${optionDateLabel(trade.openedFrom)}${trade.openedTo !== trade.openedFrom ? ` to ${optionDateLabel(trade.openedTo)}` : ''}` : '—';
      const spread = trade?.spread;
      const spreadRow = spread && !shownSpreads.has(spread.id)
        ? `<tr class="option-spread-summary"><td colspan="7">${escapeHtml(`${optionUnderlyingLabel(o)} ${spread.longStrike}/${spread.shortStrike} ${o.right} vertical spread · ${optionDateLabel(o.expiry)} · ×${spread.quantity}`)}</td><td class="num">${spread.grossPremium == null ? 'Unknown' : rowMoney(spread.grossPremium)}<small class="entry-basis">Combined opening ${spread.grossPremium < 0 ? 'debit' : 'credit'}</small></td><td colspan="6"></td></tr>` : '';
      if (spread) shownSpreads.add(spread.id);
      if (isWheelDesk) {
        const asOf = view.isLive ? (payload.generatedAt || '').slice(0,10) : view.label;
        const pct = premium > 0 ? pl/premium*100 : null;
        const multiplier = Number(o.multiplier || 100);
        const roll = `<button type="button" class="option-roll-link" data-roll-contract="${escapeHtml(o.underlying)}" data-roll-channel="${escapeHtml(p.channel)}" data-roll-strike="${escapeHtml(o.strike)}" data-roll-expiry="${escapeHtml(o.expiry)}" aria-label="Check roll relationships for ${escapeHtml(optionInstrumentLabel(p))}" title="Check roll relationships">↗</button>`;
        const spreadSummary = spread && spreadRow ? `<tr class="option-spread-summary"><td colspan="13">${escapeHtml(`${optionUnderlyingLabel(o)} ${spread.longStrike}/${spread.shortStrike} ${o.right} vertical spread · ${optionDateLabel(o.expiry)} · ×${spread.quantity}`)} · Combined recorded opening ${spread.grossPremium == null ? 'cash flow unavailable' : (spread.grossPremium < 0 ? 'debit ' : 'credit ')+rowMoney(spread.grossPremium)}</td></tr>` : '';
        return spreadSummary + `<tr class="option-ledger-row${highlightedUnderlying === o.underlying ? ' option-underlying-highlight' : ''}" data-option-underlying="${escapeHtml(o.underlying)}">
          <td class="option-instrument">${optionInstrumentButton(p,view,asOf)}${roll}</td><td class="num">${position}</td>
          <td class="num">${Number.isFinite(mark) ? (mark/multiplier).toFixed(2) : '—'}</td>
          <td class="num">${openingPremiumHtml(trade)}</td><td class="num">${(Number(p.avgCost)/multiplier).toFixed(2)}</td>
          <td class="num">${rowMoney(marketValue,0)}</td><td class="num ${plClass(pl)}">${rowMoney(pl,0)}${pct == null ? '' : ` (${pct.toFixed(1)}%)`}</td>
          <td class="num">${dte == null ? '—' : dte+'d'}</td><td class="option-opened">${opened}</td><td class="num">${Number.isFinite(spot) && spot > 0 ? Number(spot).toFixed(2) : '—'}</td>
          <td class="num">${entrySpotHtml(trade,p.currency || ccy)}</td><td class="num">${exposure ? rowMoney(exposure,0) : '—'}</td><td>${brokerLabel(p.channel)}</td>
        </tr>`;
      }
      return spreadRow + `<tr class="option-ledger-row${highlightedUnderlying === o.underlying ? ' option-underlying-highlight' : ''}" data-option-underlying="${escapeHtml(o.underlying)}">
        <td class="option-instrument">${escapeHtml(label)}<br><button type="button" class="chip-btn" data-roll-contract="${escapeHtml(o.underlying)}" data-roll-channel="${escapeHtml(p.channel)}" data-roll-strike="${escapeHtml(o.strike)}" data-roll-expiry="${escapeHtml(o.expiry)}">Check roll relationships</button></td>
        <td class="num">${position}</td>
        <td class="option-opened">${opened}</td>
        <td class="num">${entrySpotHtml(trade, p.currency || ccy)}</td>
        <td class="num">${Number.isFinite(spot) && spot > 0 ? rowMoney(spot) : '—'}</td>
        <td class="num">${exposure ? rowMoney(exposure, 0) : '—'}</td>
        <td class="num">${dte == null ? '—' : `${dte}d`}</td>
        <td class="num">${openingPremiumHtml(trade)}</td>
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
    ? 'The estimated price of one whole option contract in the broker snapshot. It includes the number of shares covered by that contract. For a short option, this estimates the cost to buy it back; its position value is shown as negative.'
    : 'The estimated price of one whole option contract saved in this snapshot. For a short option, this estimates the cost to buy it back; its position value is shown as negative.';
  el.openOptions.innerHTML = `${freshnessWarning}${filters}<div class="metric-card table-card option-ledger-card"><div class="table-scroll"><table class="report option-ledger">
    <thead><tr>${columns.map((h) => `<th scope="col"><span class="option-column-title">${h.split('\n').map(line => `<span class="option-column-label">${escapeHtml(line)}</span>`).join(' ')}</span>${isWheelDesk && h === 'Entry Spot' ? '<button type="button" class="help-dot" data-help="Entry spot is the opening-day adjusted close, not the execution-time price, unless execution evidence is explicitly available. Hover over a value for its source and date." aria-label="Explain entry spot">i</button>' : ''}${isWheelDesk && h === 'PREMIUM / ROLL' ? '<button type="button" class="help-dot" data-help="Recorded trade cash flow before fees: latest verified roll cash flow (replacement opening proceeds plus the closing leg), otherwise reconciled opening proceeds or cost. Credits are positive; debits are negative. Known but unverified rolls show unavailable, not the STO alone. Month totals use these same values and require complete data in one currency. Average price and unrealized P&amp;L retain their separate position cost basis." aria-label="Explain premium and roll cash flow">?</button>' : ''}${isWheelDesk && ['Last ($)','Avg Px'].includes(h) ? '<button type="button" class="help-dot" data-help="Price per underlying share. Market value and cost basis include the contract multiplier and quantity." aria-label="Explain option price units">?</button>' : ''}${h === 'Mark /\ncontract' ? `<button type="button" class="help-dot" data-help="${escapeHtml(markHelp)}" aria-label="What Mark means">?</button>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${body || `<tr><td colspan="${columns.length}" class="empty">No open option positions match these filters.</td></tr>`}</tbody>
  </table></div></div>`;
}

el.openOptions?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.optionDiscuss != null) { void startOptionDiscussion(button); return; }
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
  el.channelPills.innerHTML = selectionOptions()
    .map(p => `<button type="button" class="chip-btn${p.id === selectedChannel ? ' on' : ''}" data-channel="${escapeHtml(p.id)}" aria-pressed="${p.id === selectedChannel}" title="${escapeHtml(p.label)}">${isWheelDesk && !['merged', 'all'].includes(p.id) ? brokerLabel(p.id) : escapeHtml(p.label)}</button>`)
    .join('');
}

function renderAllocation(view) {
  el.allocationGrid.innerHTML = '';
  if (view.navComplete === false) {
    el.allocationGrid.innerHTML = '<div class="allocation-card">Allocation unavailable until every currency has a valid FX rate.</div>';
    return;
  }
  const ccy = reportingCcyCode(view);
  const navText = view.navComplete === false ? '—' : fmtMoney0(view.totalValue, ccy);

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
      <div class="total-value">${navText}</div>
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
              <div style="font-size:0.75rem;color:#6b7280">${pct}% (NAV ${fmtMoney0(s.signed, ccy)})</div>
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
                  return `${ctx.label}: ${pct}% (NAV ${fmtMoney0(ctx.raw, ccy)})`;
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
            Positions MTM: ${fmtMoney0(posMtm, ccy)}` +
        (view.cashAmount != null
          ? ` · Cash: ${fmtMoney0(view.cashAmount, ccy)}` +
            (view.cashWeightPct != null ? ` (${view.cashWeightPct.toFixed(1)}%)` : '') +
            (view.cashChannel ? ` · ch ${escapeHtml(view.cashChannel)}` : '')
          : '') +
        (Number(view.depositsAmount || 0) > 0
          ? ` · FD principal: ${fmtMoney0(view.depositsAmount, ccy)}`
          : '') +
        `</div>`
      : '';

  const wrapper = document.createElement('div');
  wrapper.className = 'allocation-card';
  wrapper.innerHTML = `
    <h3>Allocation ${escapeHtml(scope)}</h3>
    <div class="total-label">${view.isLive ? 'Current NAV (positions + cash + deposits)' : 'NAV · ' + escapeHtml(view.label)}</div>
    <div class="total-value">${navText}</div>
    ${navBreakdown}
    ${
      (view.optionCount || 0) > 0
        ? `<div style="font-size:0.8rem;color:#6b7280;margin:4px 0 8px">
            Premium collected: ${fmtMoney0(view.optionsPremiumCollected || 0, ccy)} ·
            Contingent obligation: ${fmtMoney0(view.contingentCashObligation || 0, ccy)}
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
          <div style="font-size:0.75rem;color:#6b7280">${pct}% (MTM ${fmtMoney0(s.signed, ccy)})</div>
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
              return `${ctx.label}: ${pct}% (|MTM| ${fmtMoney0(ctx.raw, ccy)})`;
            },
          },
        },
      },
    },
  });
}

function renderBar(view) {
  if (view.navComplete === false) {
    el.barGrid.innerHTML = '<div class="bar-card">Value comparison unavailable until every currency has a valid FX rate.</div>';
    return;
  }
  const ccy = reportingCcyCode(view);
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
        <div class="bar-summary-value">${fmtMoney0(view.totalCost, ccy)}</div>
      </div>
      <div class="bar-summary-item">
        <div class="bar-summary-label">Current</div>
        <div class="bar-summary-value">${view.navComplete === false ? '—' : fmtMoney0(view.totalValue, ccy)}</div>
      </div>
      <div class="bar-summary-item">
        <div class="bar-summary-label">P&amp;L</div>
        <div class="bar-summary-value" style="color:${plColor}">
          ${fmtSignedMoney0(view.totalPL, ccy)} (${fmtSigned(view.totalPLPct, 1)}%)
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
            label: (ctx) => `${ctx.dataset.label}: ${fmtMoney0(ctx.raw, ccy)}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#f0f0f0' },
          ticks: { font: { size: 10 }, callback: (val) => fmtMoney0(val / 1000, ccy) + 'K' },
          title: { display: true, text: `Value (${ccy || 'currency unknown'})`, font: { size: 11, weight: 'bold' } },
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
        <td class="num">${fmtPrettyMoney(d.amount, d.currency)}</td>
        <td class="num">${fmtPrettyMoney(d.interest, d.currency)}</td>
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
        `with ${fmtMoney0(amt, reportingCcyCode(view))} principal in NAV (not free cash).` +
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
      title: selectedBroker() ? selectionLabel() + ' accounts' : 'Multi-channel portfolio',
      text: selectedBroker() ? `Showing all ${(view.channels || []).length} accounts at ${selectionLabel()}. Select an account to inspect its own totals.` : `Merged view across: ${(view.channels || []).join(', ')}. Use the Channel control to isolate one broker. Unassigned holdings appear under "${DEFAULT_CHANNEL}".`,
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
    text: `${view.isLive ? 'Saved valuation' : 'Archive view of ' + view.label} · generated ${new Date(payload.generatedAt).toLocaleString()}. Fund baseline uses actual purchase prices (cost basis).`,
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
  activateSelection();
  if (selectedBroker()) dateKey = 'live';
  if (!payload) return;
  if (!payload.model) { renderEmpty(payload); initChannelSelect(); renderChannelPills(); syncDateControls(); return; }
  const view = buildView(dateKey, channelKey);
  if (!view) return;

  const chLabel = selectedBroker() ? selectionLabel() + ' · All accounts' :
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

  renderOverview(view);
  if (selectedBroker() && el.heroLead) el.heroLead.textContent += ' Broker totals reflect the latest sync; choose an account for saved dates.';
  setOptionTab(optionTab);
}

function historyDates() {
  return (payload?.model?.history || []).map((h) => h.date).sort();
}

function syncDateControls() {
  const dates = historyDates();
  const brokerMode = !!selectedBroker();
  if (el.dateSelect) {
    el.dateSelect.replaceChildren(...['live', ...dates.slice().reverse()].map(date => { const node = document.createElement('option'); node.value = date; node.textContent = date === 'live' ? 'Live' : date; return node; }));
    el.dateSelect.disabled = brokerMode;
    el.dateSelect.value = selectedDate;
    el.dateSelect.title = brokerMode ? 'Broker totals show the latest sync. Select an account for saved dates.' : '';
  }
  if (el.dateInput) { el.dateInput.disabled = brokerMode; el.dateInput.title = el.dateSelect?.title || ''; }
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
  const options = selectionOptions();
  if (!options.some(option => option.id === selectedChannel)) selectedChannel = MERGED_CHANNEL_VIEW;
  if (el.channelSelect) {
    el.channelSelect.replaceChildren(...options.map(option => {
      const node = document.createElement('option'); node.value = option.id; node.textContent = option.label; return node;
    }));
    el.channelSelect.value = selectedChannel;
  }
}

function initDashboard(preserveSelection = false) {
  portfolioPayload = payload;
  const requested = preserveSelection ? selectedChannel : requestedSelection();
  selectedChannel = selectionOptions().some(option => option.id === requested) ? requested : MERGED_CHANNEL_VIEW;
  if (selectedChannel !== requested) writeChannelQuery('all');
  selectionPreference(selectedChannel);
  activateSelection();
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

  el.error.classList.add('hidden');
  el.dashboard.classList.remove('hidden');

  renderDate(selectedDate, selectedChannel);
}

function renderEmpty(body) {
  el.navValue?.closest('.metric-card')?.querySelector('.daily-aggregate-changes')?.remove();
  window.OptionRiskView?.update({ payload: body, hasOptions: false, channel: selectedChannel, date: selectedDate, isLive: true });
  el.subtitle.textContent = `${body.displayName || body.slug} · empty portfolio`;
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
      body.message || 'No holdings or cash recorded yet. Add positions in chat, then reload the dashboard.';
  }
  if (el.navValue) el.navValue.textContent = '—';
  if (el.navDelta) el.navDelta.textContent = 'Empty books';
  if (el.totalPremiumCard) el.totalPremiumCard.classList.add('hidden');
  if (el.realizedPnlCard) el.realizedPnlCard.classList.add('hidden');
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
      metricCardHtml('Brokerage fees · MTD', '—', 'No recorded fees', ''),
      metricCardHtml('Cash available', '—', 'Cash not recorded', ''),
      metricCardHtml('Max assignment obligation', '—', 'No recorded positions', ''),
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
      '<button type="button" class="chip-btn on" data-channel="merged">All accounts</button>';
  }
  if (el.expiryBlock) el.expiryBlock.classList.add('hidden');
  if (el.premiumBlock) el.premiumBlock.classList.add('hidden');
  if (el.openOptionsBlock) el.openOptionsBlock.classList.add('hidden');
  if (el.expiryTable) el.expiryTable.innerHTML = '';
  setOptionTab(optionTab);
  installCardExplainButtons();
}

let syncingBrokers = false;
let pendingHeaderSync = false;
const handledSyncJobs = new Set();
let refreshingAfterSync = false;
const syncPanel = document.getElementById('brokerSyncPanel');
const syncStatus = document.getElementById('brokerSyncStatus');
const syncProgress = document.getElementById('brokerSyncProgress');
const syncDetails = document.getElementById('brokerSyncDetails');

function updateActionButtons() {
  document.getElementById('dashboardRetry').disabled = loading || syncingBrokers;
  if (!loading && !syncingBrokers && pendingHeaderSync) void followHeaderSync();
}
async function brokerSyncRequest() {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch('/api/domain/invage/broker-sync', {
        credentials: 'include', signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw Object.assign(new Error(response.status === 401 || response.status === 403
        ? 'Your session has ended. Sign in again.' : 'Could not check broker sync. Click Sync brokers to reconnect.'),
        { retryable: response.status >= 500 || response.status === 429 });
      return await response.json();
    } catch (error) {
      const transient = error?.retryable === true || error?.name === 'TimeoutError' || error?.name === 'AbortError' || error instanceof TypeError;
      if (!transient) throw error;
      syncPanel.classList.remove('hidden');
      syncStatus.textContent = 'Sync continues · Reconnecting to progress…';
      syncDetails.textContent = 'Progress is temporarily unavailable. Reconnecting automatically; you do not need to start another sync.';
      await new Promise(resolve => setTimeout(resolve, Math.min(1000 * (attempt + 1), 5000)));
    }
  }
}
async function syncBrokers(existingJob) {
  if (loading || syncingBrokers) return;
  syncingBrokers = true;
  updateActionButtons();
  syncPanel.classList.remove('hidden');
  syncProgress.classList.remove('hidden');
  syncProgress.value = 0;
  syncStatus.textContent = 'Starting broker sync…';
  syncDetails.textContent = 'Syncing enabled broker accounts, saving totals and a dated snapshot, then refreshing your dashboard.';
  try {
    let job = existingJob;
    const jobId = job.id;
    while (true) {
      if (!job || job.id !== jobId) throw new Error('The sync job is no longer available. Click Sync brokers to start again.');
      const completed = job.accounts.filter(a => a.status === 'succeeded' || a.status === 'failed').length;
      const current = job.accounts.find(a => a.status === 'running');
      syncProgress.value = job.accounts.length ? completed / job.accounts.length * 80 : 80;
      syncStatus.textContent = `Syncing brokers · ${completed} of ${job.accounts.length} accounts finished`;
      syncDetails.textContent = current ? `Importing ${current.label}…` : 'Saving portfolio totals and snapshot…';
      if (job.status === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
      job = await brokerSyncRequest();
    }
    const failed = job.accounts.filter(a => a.status === 'failed');
    const succeeded = job.accounts.filter(a => a.status === 'succeeded').length;
    syncStatus.textContent = 'Broker sync finished · Refreshing dashboard…';
    syncDetails.textContent = failed.length
      ? `${failed.map(a => a.label).join(', ')} failed to sync. Check Settings → Brokers for details.`
      : job.accounts.length ? `${succeeded} accounts synced.` : 'No enabled broker accounts. Connect a broker in Settings → Brokers.';
    refreshingAfterSync = true;
    const refreshed = await load(true);
    if (!refreshed) throw new Error('Broker sync finished, but the dashboard refresh failed. Use Retry loading to try again.');
    if (job.error) throw new Error(job.error);
    if (job.calculationStatus === 'failed') throw new Error('Broker sync finished, but saved aggregate calculations failed. Sync brokers again to retry.');
    if (job.calculationStatus === 'pending') throw new Error('Broker sync finished. Saved aggregate calculations are still being prepared; retry loading shortly.');
    handledSyncJobs.add(jobId);
    syncProgress.value = 100;
    syncStatus.textContent = failed.length
      ? `Dashboard refreshed · ${succeeded} synced, ${failed.length} failed`
      : 'Dashboard refreshed · Broker sync complete';
    if (!failed.length && job.accounts.length) syncPanel.classList.add('hidden');
  } catch (error) {
    syncStatus.textContent = error instanceof Error ? error.message : 'Broker sync was interrupted. Click Sync brokers to reconnect.';
    syncDetails.textContent = 'Your existing portfolio remains available. Check the sync status above or retry loading.';
  } finally {
    syncProgress.classList.add('hidden');
    refreshingAfterSync = false;
    syncingBrokers = false;
    updateActionButtons();
  }
}

async function followHeaderSync() {
  if (!pendingHeaderSync || loading || syncingBrokers) return;
  pendingHeaderSync = false;
  try {
    const job = await brokerSyncRequest();
    if (job && !handledSyncJobs.has(job.id)) await syncBrokers(job);
  } catch (error) {
    syncPanel.classList.remove('hidden');
    syncStatus.textContent = error instanceof Error ? error.message : 'Could not check broker sync.';
  }
}
window.addEventListener('message', event => {
  if (window.parent === window || event.origin !== location.origin || event.source !== window.parent) return;
  if (event.data?.type === 'utarus:header-sync:activity') {
    pendingHeaderSync = true;
    void followHeaderSync();
  }
});

const loadStages = [
  'Reading your portfolio records',
  'Checking market prices and currencies',
  'Preparing portfolio values and performance history',
  'Reviewing broker balances and option trades',
  'Checking opening-day stock prices',
  'Calculating premiums and completed-trade results',
  'Drawing your dashboard',
  'Loading option history',
];
const loadUi = {
  stage: document.getElementById('loadStage'),
  elapsed: document.getElementById('loadElapsed'),
  progress: document.getElementById('loadProgress'),
  fill: document.getElementById('loadProgressFill'),
  step: document.getElementById('loadStep'),
  insights: document.getElementById('loadInsights'),
  hint: document.getElementById('loadHint'),
  error: document.getElementById('dashboardErrorMessage'),
};
let loadStartedAt = 0;
let loadPosition = 0;
let loadCounts = {};
function loadDuration() {
  const seconds = Math.floor((performance.now() - loadStartedAt) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function loadingClock() {
  loadUi.elapsed.textContent = `${loadDuration()} elapsed`;
  if (!loadUi.progress.classList.contains('failed') && performance.now() - loadStartedAt >= 10000) {
    loadUi.hint.textContent = 'Large histories and stock-price lookups can take longer. You can keep this page open.';
  }
}
function updateLoading(step, info = {}) {
  if (!Number.isInteger(step) || step < 0 || step > 7) return;
  let fraction = 0;
  if (step === 4 && Number.isInteger(info.total) && info.total > 0 && Number.isInteger(info.processed)) {
    fraction = Math.max(0, Math.min(1, info.processed / info.total));
  }
  loadPosition = Math.max(loadPosition, step + fraction);
  loadUi.progress.setAttribute('aria-valuenow', String(loadPosition));
  loadUi.progress.setAttribute('aria-valuetext', `Step ${step + 1} of 8: ${loadStages[step]}`);
  loadUi.fill.style.width = `${loadPosition / 8 * 100}%`;
  if (refreshingAfterSync) {
    syncProgress.value = 80 + loadPosition / 8 * 19;
    syncStatus.textContent = `Refreshing dashboard · ${loadStages[step]}`;
  }
  if (loadUi.stage.textContent !== loadStages[step]) loadUi.stage.textContent = loadStages[step];
  loadUi.step.textContent = `Step ${step + 1} of 8`;
  for (const key of ['positions', 'tradeRecords', 'snapshots']) {
    if (Number.isInteger(info[key]) && info[key] >= 0) loadCounts[key] = info[key];
  }
  const details = [];
  if (loadCounts.positions != null) details.push(`${loadCounts.positions.toLocaleString()} positions`);
  if (loadCounts.tradeRecords != null) details.push(`${loadCounts.tradeRecords.toLocaleString()} option trade records`);
  if (loadCounts.snapshots != null) details.push(`${loadCounts.snapshots.toLocaleString()} saved snapshots`);
  if (step === 4 && info.total > 0) details.push(`Opening prices checked for ${info.processed} of ${info.total} stocks`);
  loadUi.insights.textContent = details.join(' · ') || 'Preparing your dashboard…';
}
async function fetchDashboardWithProgress(signal, force = false, onSnapshot) {
  const response = await fetch(`${API}?progress=1${force ? '&refresh=1' : '&preview=1'}`, { credentials: 'include', signal, headers: { Accept: 'text/event-stream' } });
  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Your session has ended. Sign in again, then retry.' : 'The dashboard could not load. Please retry.');
  }
  // Older hosts and fixtures can still return the existing JSON response.
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
    try { return await response.json(); } catch { throw new Error('The dashboard response was interrupted. Please retry.'); }
  }
  if (!response.body) throw new Error('No dashboard data was received. Please retry.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let parts = [], result = null;
  const consume = line => {
    if (!line.startsWith('data:')) return;
    let event;
    try { event = JSON.parse(line.slice(5)); } catch { throw new Error('The dashboard response was interrupted. Please retry.'); }
    if (event.type === 'snapshot' && !force && onSnapshot) onSnapshot(event.payload);
    else if (event.type === 'progress') updateLoading(event.completedStages, event);
    else if (event.type === 'result') result = event.payload;
    else if (event.type === 'error') throw new Error(event.message || 'The dashboard could not finish loading. Please retry.');
  };
  const consumeChunk = text => {
    const lines = text.split('\n');
    lines.forEach((part, i) => {
      if (i === lines.length - 1) { if (part) parts.push(part); }
      else { consume(parts.join('') + part); parts = []; }
    });
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { consumeChunk(decoder.decode()); if (parts.length) consume(parts.join('')); break; }
      consumeChunk(decoder.decode(value, { stream: true }));
    }
  } finally { reader.releaseLock(); }
  if (!result || typeof result !== 'object') throw new Error('Loading stopped before the dashboard was ready. Please retry.');
  return result;
}

function paintLoadingStage() {
  if (document.hidden) return new Promise(resolve => setTimeout(resolve, 0));
  return new Promise(resolve => {
    let first, second;
    const fallback = setTimeout(() => { cancelAnimationFrame(first); cancelAnimationFrame(second); resolve(); }, 100);
    first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => { clearTimeout(fallback); resolve(); });
    });
  });
}

let historyLoadController;
function loadHistoryInBackground() {
  historyLoadController?.abort();
  const controller = new AbortController();
  historyLoadController = controller;
  const timeout = setTimeout(() => controller.abort(), 60000);
  if (el.optionFreshness) el.optionFreshness.textContent = 'Loading option history…';
  const channel = selectedChannel !== MERGED_CHANNEL_VIEW ? selectedChannel : undefined;
  void loadOptionHistory(false, controller.signal, channel).finally(() => {
    clearTimeout(timeout);
    if (historyLoadController === controller) historyLoadController = undefined;
  });
  if (optionTab === 'timeline') void optionTimeline.load(true);
  if (optionTab === 'rolls') void loadRollRelationships();
}

async function load(force = false) {
  if (loading) return;
  loading = true;
  updateActionButtons();
  let showingSnapshot = payload != null && !el.dashboard.classList.contains('hidden');
  let historyStarted = false;
  loadStartedAt = performance.now(); loadPosition = 0; loadCounts = {};
  el.error.classList.add('hidden');
  el.loading.classList.toggle('hidden', showingSnapshot);
  el.dashboard.setAttribute('aria-busy', showingSnapshot ? 'false' : 'true');
  loadUi.progress.classList.remove('failed');
  loadUi.hint.textContent = 'Progress advances as each step finishes.';
  updateLoading(0); loadingClock();
  const timer = setInterval(loadingClock, 1000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const body = await fetchDashboardWithProgress(controller.signal, force, cached => {
      payload = cached; portfolioPayload = cached;
      if (cached.empty || !cached.model) renderEmpty(cached);
      else initDashboard(showingSnapshot);
      showingSnapshot = true;
      optionDefaultApplied = true;
      el.loading.classList.add('hidden');
      el.dashboard.setAttribute('aria-busy', 'false');
      loadHistoryInBackground();
      historyStarted = true;
    });
    payload = body; portfolioPayload = body;
    updateLoading(6, { positions: body.model?.live?.positions?.length, tradeRecords: body.optionAnalytics?.executions?.length, snapshots: body.model?.history?.length });
    await paintLoadingStage();
    if (!optionDefaultApplied) {
      optionTab = 'open';
      optionDefaultApplied = true;
    }
    if (body.empty || !body.model) renderEmpty(body);
    else initDashboard(showingSnapshot);
    loadUi.progress.setAttribute('aria-valuenow', '8');
    loadUi.progress.setAttribute('aria-valuetext', 'Dashboard ready');
    loadUi.fill.style.width = '100%';
    el.loading.classList.add('hidden');
    el.dashboard.setAttribute('aria-busy', 'false');
    // History has its own deadline and request lifecycle; it cannot block valuation.
    if (selectedChannel !== MERGED_CHANNEL_VIEW && el.historyBroker.value !== selectedChannel) {
      el.optionHistoryDetail.innerHTML = '';
      historyStarted = false;
    }
    if (!historyStarted) loadHistoryInBackground();
    return true;
  } catch (e) {
    loadUi.progress.classList.add('failed');
    loadUi.progress.setAttribute('aria-valuetext', 'Dashboard loading interrupted');
    loadUi.stage.textContent = 'Dashboard loading interrupted';
    loadUi.hint.textContent = 'You can retry loading below.';
    loadUi.error.textContent = e?.name === 'AbortError' ? 'Loading took longer than expected. Please retry.' : e instanceof Error ? e.message : 'The dashboard could not load. Please retry.';
    if (showingSnapshot) loadUi.error.textContent = `Update failed; showing the previous figures. ${loadUi.error.textContent}`;
    el.error.classList.remove('hidden');
    return false;
  } finally {
    clearInterval(timer); clearTimeout(timeout); controller.abort();
    loadingClock();
    el.dashboard.setAttribute('aria-busy', 'false');
    loading = false;
    updateActionButtons();
  }
}
document.getElementById('dashboardRetry').addEventListener('click', () => void load(true));

el.dateSelect.addEventListener('change', (e) => {
  selectedDate = e.target.value;
  renderDate(selectedDate, selectedChannel);
});
el.channelSelect.addEventListener('change', (e) => {
  applySelection(e.target.value);
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
    applySelection(btn.getAttribute('data-channel'));
  });
}

void (async () => {
  await load();
  await followHeaderSync();
  // Reattach after a reload; closing this page does not cancel the background job.
  try {
    const job = await brokerSyncRequest();
    if (job?.status === 'running') await syncBrokers(job);
  } catch { /* The explicit Sync brokers action reports connection errors. */ }
})();

el.openOptions?.addEventListener('input', event => {
  if (event.target.id !== 'optionSearch') return;
  optionSearch = event.target.value;
  clearTimeout(optionSearchTimer);
  optionSearchTimer = setTimeout(() => {
    const view = buildView(selectedDate,selectedChannel);
    if (view) renderOpenOptions(view);
    document.getElementById('optionSearch')?.focus();
  },150);
});

el.expiryTable?.addEventListener('input', event => {
  if (event.target.id !== 'riskSearch') return;
  riskSearch = event.target.value;
  const cursor = event.target.selectionStart;
  clearTimeout(riskSearchTimer);
  riskSearchTimer = setTimeout(() => {
    const view = buildView(selectedDate, selectedChannel);
    if (!view) return;
    renderExpiryRisk(view, view.isLive ? payload.generatedAt.slice(0, 10) : view.label);
    const input = document.getElementById('riskSearch');
    input?.focus();
    if (input && cursor != null) input.setSelectionRange(cursor, cursor);
  }, 150);
});
