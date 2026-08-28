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
  '#c084c0', '#ff6b6b', '#4ecdc4', '#45b7d1', '#ffeaa7', '#98d8c8',
  '#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#6b7280',
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

function daysToExpiry(expiry, asOf) {
  if (!expiry) return null;
  const e = Date.parse(`${expiry}T00:00:00Z`);
  const a = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(e) || !Number.isFinite(a)) return null;
  return Math.round((e - a) / 86400000);
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

function metricsForView(view) {
  const all = payload?.connectionMetrics || {};
  if (view.channelView !== MERGED_CHANNEL_VIEW) {
    return all[view.channelView] ? [all[view.channelView]] : [];
  }
  return Object.values(all);
}

function sumMetric(rows, key) {
  const nums = rows.map((r) => r[key]).filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (nums.length === 0) return null;
  const ccys = [...new Set(rows.filter((r) => r[key] != null).map((r) => r.currency))];
  if (ccys.length > 1) return null;
  return { amount: nums.reduce((s, n) => s + n, 0), currency: ccys[0] };
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
    el.deskEyebrow.textContent =
      view.channelView === MERGED_CHANNEL_VIEW
        ? `Multi-broker${channels.length ? ` · ${channels.length} channel${channels.length === 1 ? '' : 's'}` : ''}`
        : `Channel · ${view.channelLabel || view.channelView}`;
  }
  if (el.heroDate) {
    el.heroDate.textContent = longDateLabel(asOf);
  }
  if (el.heroLead) {
    el.heroLead.textContent = brokerNames
      ? `Unified view across ${brokerNames}. Pick a date to replay the numbers captured at that day's close.`
      : 'Unified view of recorded holdings and cash. Pick a date to replay numbers captured at that day’s close.';
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
  }

  const metrics = metricsForView(view);
  const buying = sumMetric(metrics, 'buying_power');
  const maint = sumMetric(metrics, 'maintenance_margin');
  const excess = sumMetric(metrics, 'excess_liquidity');
  let marginPct = null;
  if (maint && excess && maint.amount + excess.amount > 0) {
    marginPct = (maint.amount / (maint.amount + excess.amount)) * 100;
  } else if (maint && buying && buying.amount > 0) {
    marginPct = (maint.amount / buying.amount) * 100;
  }

  const cashCcy = view.cashCurrency || repCcy;
  const optionPl =
    (view.positions || [])
      .filter((p) => p.instrument === 'option')
      .reduce((s, p) => s + Number(p.pl || 0), 0);

  if (el.kpiRow) {
    el.kpiRow.innerHTML = [
      metricCardHtml(
        'Premium · open',
        view.optionCount
          ? fmtPrettyMoney(optionPl, repCcy, 0)
          : '—',
        view.optionCount
          ? `${view.optionCount} option lot${view.optionCount === 1 ? '' : 's'} · open P/L, not a day blotter`
          : 'No option lots',
        'Open option mark-to-market vs book premium. Daily premium is not stored.',
        optionPl > 0 ? 'up' : optionPl < 0 ? 'down' : '',
      ),
      metricCardHtml(
        'Buying power',
        buying ? fmtPrettyMoney(buying.amount, buying.currency, 0) : '—',
        buying ? 'From broker margin snapshot' : 'Not recorded on this channel',
        'broker_connections.<id>.metrics.buying_power. Never invented from cash.',
      ),
      metricCardHtml(
        'Cash available',
        view.cashAmount != null ? fmtPrettyMoney(view.cashAmount, cashCcy, 0) : '—',
        view.cashAmount != null ? 'Free cash (not deposits)' : 'Cash not recorded',
        'YAML cash.amount. Missing cash is unknown, not zero.',
      ),
      metricCardHtml(
        'Margin used',
        marginPct != null ? `${marginPct.toFixed(0)}%` : '—',
        maint
          ? `Maint. ${fmtPrettyMoney(maint.amount, maint.currency, 0)}`
          : 'Need maintenance_margin on the connection',
        'maintenance_margin / (maintenance_margin + excess_liquidity) when both are set.',
      ),
    ].join('');
  }

  renderExpiryRisk(view, asOf, buying);
  renderChannelPills(view);
}

function renderExpiryRisk(view, asOf, buying) {
  if (!el.expiryRow) return;
  const prices = payload?.equityPrices || {};
  const shorts = (view.positions || []).filter(
    (p) => p.instrument === 'option' && p.option?.side === 'short',
  );
  let itmExposure = 0;
  let itmKnown = false;
  let unknownItm = 0;
  for (const p of shorts) {
    const uSym = p.option?.underlying;
    const strike = p.option?.strike;
    const px = uSym ? prices[uSym] : null;
    const cashIf = Number(p.contingentCashObligation || 0);
    if (p.option?.right === 'put' && px != null && strike != null) {
      itmKnown = true;
      if (px < strike) itmExposure += cashIf;
    } else if (p.option?.right === 'call' && px != null && strike != null) {
      itmKnown = true;
      if (px > strike) itmExposure += Number(p.contingentShareObligation || 0) * px;
    } else {
      unknownItm += 1;
    }
  }
  const contingent = Number(view.contingentCashObligation || 0);
  const cash = view.cashAmount;
  const bp = buying ? buying.amount : null;
  const dry = cash != null && bp != null ? cash + bp : cash != null ? cash : bp;
  const cover =
    itmKnown && itmExposure > 0 && cash != null ? (cash / itmExposure) * 100 : null;

  if (el.expiryLead) {
    const n = shorts.length;
    el.expiryLead.textContent =
      n === 0
        ? 'No short option lots in this view. Section 03 (holdings table) lists every open position.'
        : `Only short option lots from books. ITM uses live underlying vs strike when a quote exists. Assignment probability is not modeled. ${unknownItm ? `${unknownItm} short lot${unknownItm === 1 ? '' : 's'} have no underlying quote.` : ''}`;
  }

  el.expiryRow.innerHTML = [
    metricCardHtml(
      'High-risk ITM exposure',
      itmKnown ? fmtPrettyMoney(itmExposure, reportingCcyCode(view), 0) : '—',
      itmKnown ? 'ITM vs live underlying quote' : 'Need an underlying quote to classify ITM',
      'Short put ITM if last < strike; short call ITM if last > strike. Not a probability.',
    ),
    metricCardHtml(
      'Probability-weighted exposure',
      '—',
      'Not modeled — no assignment probability on the books',
      'Would require an explicit probability model. We do not invent one.',
      'down',
    ),
    metricCardHtml(
      'Cash + buying power',
      dry != null ? fmtPrettyMoney(dry, view.cashCurrency || buying?.currency || reportingCcyCode(view), 0) : '—',
      cash != null && bp != null
        ? `Cash ${fmtPrettyMoney(cash, view.cashCurrency, 0)} + BP ${fmtPrettyMoney(bp, buying.currency, 0)}`
        : cash != null
          ? 'Buying power not recorded'
          : 'Cash and/or buying power unknown',
      'Sum only of recorded figures. Missing legs stay omitted.',
    ),
    metricCardHtml(
      'High-risk coverage',
      cover != null ? `${cover.toFixed(0)}%` : '—',
      cover != null
        ? 'Free cash / ITM assignment cash'
        : contingent > 0
          ? `Contingent cash ${fmtPrettyMoney(contingent, reportingCcyCode(view), 0)}`
          : 'No short-put assignment cash',
      'cash.amount ÷ ITM contingent cash. Not a margin-requirement ratio.',
      cover != null && cover < 100 ? 'down' : '',
    ),
  ].join('');
}

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

  destroyCharts();
  renderWarnings();
  // High-level first, then charts, then detail tables.
  renderOverview(view);
  renderAllocation(view);
  renderBar(view);
  renderCharts(view);
  renderInsights(view);
  renderDetailTables(view);
  renderDepositsTable(view);
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
      metricCardHtml('Premium · open', '—', 'No option lots', ''),
      metricCardHtml('Buying power', '—', 'Not recorded', ''),
      metricCardHtml('Cash available', '—', 'Cash not recorded', ''),
      metricCardHtml('Margin used', '—', 'Not recorded', ''),
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
  destroyCharts();
  if (el.channelDetailBody) {
    el.channelDetailBody.innerHTML =
      `<tr><td colspan="13" class="muted" style="text-align:center;padding:1.5rem">${escapeHtml(body.message || 'No holdings yet.')}</td></tr>`;
  }
  if (el.channelDetailMeta) el.channelDetailMeta.textContent = '';
  if (el.holdingsDetailBody) {
    el.holdingsDetailBody.innerHTML =
      '<tr><td colspan="15" class="muted" style="text-align:center;padding:1.5rem">No holdings yet.</td></tr>';
  }
  if (el.holdingsDetailMeta) el.holdingsDetailMeta.textContent = '';
  el.allocationGrid.innerHTML = '';
  el.barGrid.innerHTML = '';
  el.chartGrid.innerHTML = '';
  el.insightGrid.innerHTML = '';
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
    selectedChannel = btn.getAttribute('data-channel');
    if (el.channelSelect) el.channelSelect.value = selectedChannel;
    renderDate(selectedDate, selectedChannel);
  });
}
el.refreshBtn.addEventListener('click', () => void load());
el.autoRefresh.addEventListener('change', syncTimer);

void load();
