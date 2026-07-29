/**
 * Dynamic portfolio dashboard client.
 * Fetches /api/domain/invage/dashboard (session cookie) and renders the model:
 * summary cards, allocation donut, invested-vs-current bars, fund-vs-benchmark
 * timeline, insights. Archive dates render from snapshot positions client-side.
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
  channelSelect: document.getElementById('channelSelect'),
  statusBadge: document.getElementById('statusBadge'),
  status: document.getElementById('status'),
  refreshBtn: document.getElementById('refreshBtn'),
  autoRefresh: document.getElementById('autoRefresh'),
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  dashboard: document.getElementById('dashboard'),
  summaryCards: document.getElementById('summaryCards'),
  allocationGrid: document.getElementById('allocationGrid'),
  barGrid: document.getElementById('barGrid'),
  chartGrid: document.getElementById('chartGrid'),
  insightGrid: document.getElementById('insightGrid'),
};

let payload = null;
let selectedDate = 'live';
let selectedChannel = MERGED_CHANNEL_VIEW;
let charts = {};
let timer = null;
let loading = false;

/* ---------- formatting ---------- */

function fmtUsd0(n) {
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtUsd2(n) {
  return (
    '$' +
    Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function fmtSigned(n, digits = 2) {
  return (n > 0 ? '+' : '') + Number(n).toFixed(digits);
}

function fmtSignedUsd0(n) {
  const v = Number(n);
  const abs = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (v < 0 ? '-$' : '+$') + abs;
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

function renderCards(view) {
  const benchTicker = payload.benchmark?.ticker || 'SPY';
  const baseDate = payload.benchmark?.baseDate || 'cost basis';
  const cards = [];

  const cardHtml = (title, fIdx, bIdx, diff, footer, extraBadgeHtml = '') => {
    const d = diff == null ? 0 : diff;
    const isNeutral = Math.abs(d) < 1;
    const cardClass = diff == null ? 'neutral' : isNeutral ? 'neutral' : d > 0 ? 'positive' : 'negative';
    const diffHtml =
      diff == null
        ? `<div class="diff-indicator" style="background:#f3f4f6;color:#6b7280">vs benchmark n/a</div>`
        : `<div class="diff-indicator ${d >= 0 ? 'diff-positive' : 'diff-negative'}">
             ${d >= 0 ? '▲' : '▼'} ${fmtSigned(d)}
           </div>`;
    return `
      <div class="card ${cardClass}">
        <div class="card-header">
          <div class="card-title">${escapeHtml(title)}</div>
          <div style="display:flex;gap:0.35rem;flex-wrap:wrap;justify-content:flex-end">
            ${extraBadgeHtml}
            <span class="card-badge badge-benchmark">${escapeHtml(benchTicker)}</span>
          </div>
        </div>
        <div class="card-values">
          <div class="fund-value">${fIdx.toFixed(2)}</div>
          <div class="bench-value">${bIdx == null ? 'vs —' : 'vs ' + bIdx.toFixed(2)}</div>
        </div>
        ${diffHtml}
        <div class="card-footer">${footer}</div>
      </div>`;
  };

  const optionNote =
    (view.optionCount || 0) > 0
      ? ` | ${view.optionCount} option · prem coll. ${fmtUsd0(view.optionsPremiumCollected || 0)} · oblig. ${fmtUsd0(view.contingentCashObligation || 0)}`
      : '';
  const cashNote =
    view.cashAmount != null
      ? ` | Cash ${fmtUsd0(view.cashAmount)}${view.cashCurrency ? ' ' + view.cashCurrency : ''}` +
        (view.cashWeightPct != null ? ` (${view.cashWeightPct.toFixed(1)}%)` : '') +
        (view.cashChannel ? ` · ch ${view.cashChannel}` : '')
      : '';
  const depAmount = Number(view.depositsAmount || 0);
  const depositNote =
    depAmount > 0 || (view.depositCount || 0) > 0
      ? ` | FD principal ${fmtUsd0(depAmount)}` +
        (view.depositsCurrency ? ' ' + view.depositsCurrency : '') +
        ` · ${view.depositCount || 0} term${(view.depositCount || 0) === 1 ? '' : 's'}`
      : '';
  const channelNote =
    view.channelView === MERGED_CHANNEL_VIEW
      ? ` | Channels: ${(view.channels || []).join(', ') || DEFAULT_CHANNEL}`
      : ` | Channel: ${view.channelLabel || view.channelView}`;

  cards.push(
    cardHtml(
      view.channelView === MERGED_CHANNEL_VIEW
        ? 'Overall Portfolio (merged)'
        : `Portfolio · ${view.channelLabel || view.channelView}`,
      view.fundIndex,
      view.benchmarkIndex,
      view.diff,
      `Base: ${escapeHtml(baseDate)} | ${view.positions.length} holdings | Cost: ${fmtUsd0(view.totalCost)}${optionNote}${cashNote}${depositNote}${channelNote}`,
    ),
  );

  if ((view.deposits || []).length > 0) {
    const interestTotal = view.deposits.reduce((s, d) => s + Number(d.interest || 0), 0);
    const maturedN = view.deposits.filter((d) => d.matured).length;
    cards.push(`
      <div class="card">
        <div class="card-header">
          <div class="card-title">Fixed deposits</div>
          <span class="card-badge badge-channel">FD</span>
        </div>
        <div class="card-values">
          <div class="fund-value">${fmtUsd0(depAmount)}</div>
          <div class="bench-value">principal</div>
        </div>
        <div class="diff-indicator" style="background:#f3e8ff;color:#7c3aed">
          ${view.deposits.length} term${view.deposits.length === 1 ? '' : 's'} · interest at maturity ${fmtUsd0(interestTotal)}${
            maturedN > 0 ? ` · ${maturedN} matured` : ''
          }
        </div>
        <div class="card-footer">Locked capital · not free cash · in NAV</div>
      </div>`);
  }

  // When merged and multi-channel, surface per-channel summary cards.
  if (
    view.channelView === MERGED_CHANNEL_VIEW &&
    Array.isArray(view.byChannel) &&
    view.byChannel.length > 1
  ) {
    view.byChannel.forEach((c) => {
      const chIdx = portfolioFundIndex({
        equityCost: c.equityCost,
        equityValue: c.equityValue,
        totalValue: c.totalValue,
        totalCost: c.totalCost,
      });
      const chDiff = view.benchmarkIndex == null ? null : chIdx - view.benchmarkIndex;
      cards.push(
        cardHtml(
          `Channel · ${c.channel}`,
          chIdx,
          view.benchmarkIndex,
          chDiff,
          `${c.positionCount} holdings | NAV ${fmtUsd0(c.totalValue)} | P/L ${fmtSignedUsd0(c.totalPL)}` +
            (c.cashAmount != null
              ? ` | Cash ${fmtUsd0(c.cashAmount)}${c.cashCurrency ? ' ' + c.cashCurrency : ''}`
              : '') +
            (c.depositsAmount != null && c.depositsAmount > 0
              ? ` | FD ${fmtUsd0(c.depositsAmount)}`
              : ''),
        ),
      );
    });
  }

  view.positions.forEach((p) => {
    const isOpt = p.instrument === 'option';
    const isFund = p.instrument === 'fund';
    // Options: show premium P/L % as index-style (100 + plPct); equities/funds: value/cost.
    const pIdx = isOpt
      ? 100 + (p.plPct || 0)
      : fundIndex(p.value, p.cost);
    const pDiff = isOpt || view.benchmarkIndex == null ? null : pIdx - view.benchmarkIndex;
    const title = isOpt || isFund ? p.label || p.ticker : p.ticker;
    const ch = resolveDashboardChannel(p.channel);
    const footer = isOpt
      ? `${p.units} ct @ ${fmtUsd2(p.avgCost)}/ct prem | MTM ${fmtUsd0(p.value)} | P/L ${fmtSignedUsd0(p.pl)}` +
        (p.contingentCashObligation > 0
          ? ` | If assigned ${fmtUsd0(p.contingentCashObligation)}`
          : '') +
        ` | ${ch}`
      : isFund
        ? `FUND ${p.units} u @ ${fmtUsd2(p.avgCost)} | Cost: ${fmtUsd0(p.cost)} | ${ch}`
        : `${p.units} units @ ${fmtUsd2(p.avgCost)} | Cost: ${fmtUsd0(p.cost)} | ${ch}`;
    cards.push(
      cardHtml(title, pIdx, isOpt ? null : view.benchmarkIndex, pDiff, footer, channelBadgeHtml(ch)),
    );
  });

  el.summaryCards.innerHTML = cards.join('');
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
  el.subtitle.textContent =
    `${payload.displayName || payload.slug} · ${view.label} · ${view.isLive ? 'Latest' : 'Archived'} · ${chLabel}`;
  el.statusBadge.className = view.isLive ? 'live-badge' : 'archive-badge';
  el.statusBadge.textContent = view.isLive ? 'LIVE' : 'ARCHIVE';

  destroyCharts();
  renderCards(view);
  renderAllocation(view);
  renderDepositsTable(view);
  renderBar(view);
  renderCharts(view);
  renderInsights(view);
}

function initChannelSelect() {
  const live = payload.model.live;
  const channels = Array.isArray(live.channels) && live.channels.length > 0
    ? live.channels
    : [DEFAULT_CHANNEL];

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

  const stillValid =
    selectedChannel === MERGED_CHANNEL_VIEW || channels.includes(selectedChannel);
  if (!stillValid) selectedChannel = MERGED_CHANNEL_VIEW;
  el.channelSelect.value = selectedChannel;
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
  destroyCharts();
  el.summaryCards.innerHTML = '';
  el.allocationGrid.innerHTML = '';
  el.barGrid.innerHTML = '';
  el.chartGrid.innerHTML = '';
  el.insightGrid.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'empty-box';
  box.textContent = body.message || 'No holdings yet.';
  el.summaryCards.appendChild(box);
}

async function load() {
  if (loading) return;
  loading = true;
  el.refreshBtn.disabled = true;
  el.status.className = 'status';
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
    el.status.className = 'status error';
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
el.refreshBtn.addEventListener('click', () => void load());
el.autoRefresh.addEventListener('change', syncTimer);

void load();
