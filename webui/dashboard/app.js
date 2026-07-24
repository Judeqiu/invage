/**
 * Dynamic portfolio dashboard client.
 * Fetches /api/domain/invage/dashboard (session cookie) and renders the model:
 * summary cards, allocation donut, invested-vs-current bars, fund-vs-benchmark
 * timeline, insights. Archive dates render from snapshot positions client-side.
 */

const API = '/api/domain/invage/dashboard';

const COLORS = [
  '#c084c0', '#ff6b6b', '#4ecdc4', '#45b7d1', '#ffeaa7', '#98d8c8',
  '#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#6b7280',
];

const el = {
  subtitle: document.getElementById('subtitle'),
  dateSelect: document.getElementById('dateSelect'),
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

/** Build the per-date view: 'live' or a snapshot date from model.history. */
function buildView(dateKey) {
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
    };
    const fIdx = portfolioFundIndex(viewBase);
    const bIdx = benchIndexAt('live');
    return {
      ...viewBase,
      fundIndex: fIdx,
      benchmarkIndex: bIdx,
      diff: bIdx == null ? null : fIdx - bIdx,
    };
  }
  const row = model.history.find((h) => h.date === dateKey);
  if (!row) return null;
  const absSum = (row.positions || []).reduce((s, p) => s + Math.abs(p.value), 0);
  const positions = (row.positions || [])
    .map((p) => ({
      ...p,
      label: p.label || p.ticker,
      instrument: p.instrument || 'equity',
      weightPct: absSum > 0 ? (Math.abs(p.value) / absSum) * 100 : 0,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const viewBase = {
    isLive: false,
    label: row.date,
    positions,
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
    optionCount: positions.filter((p) => p.instrument === 'option').length,
    equityCount: positions.filter((p) => p.instrument !== 'option').length,
  };
  const fIdx = portfolioFundIndex(viewBase);
  const bIdx = benchIndexAt(dateKey);
  return {
    ...viewBase,
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

  const cardHtml = (title, fIdx, bIdx, diff, footer) => {
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
          <span class="card-badge badge-benchmark">${escapeHtml(benchTicker)}</span>
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

  cards.push(
    cardHtml(
      'Overall Portfolio',
      view.fundIndex,
      view.benchmarkIndex,
      view.diff,
      `Base: ${escapeHtml(baseDate)} | ${view.positions.length} holdings | Cost: ${fmtUsd0(view.totalCost)}${optionNote}`,
    ),
  );

  view.positions.forEach((p) => {
    const isOpt = p.instrument === 'option';
    // Options: show premium P/L % as index-style (100 + plPct); equities: value/cost.
    const pIdx = isOpt
      ? 100 + (p.plPct || 0)
      : fundIndex(p.value, p.cost);
    const pDiff = isOpt || view.benchmarkIndex == null ? null : pIdx - view.benchmarkIndex;
    const title = isOpt ? p.label || p.ticker : p.ticker;
    const footer = isOpt
      ? `${p.units} ct @ ${fmtUsd2(p.avgCost)}/ct prem | MTM ${fmtUsd0(p.value)} | P/L ${fmtSignedUsd0(p.pl)}` +
        (p.contingentCashObligation > 0
          ? ` | If assigned ${fmtUsd0(p.contingentCashObligation)}`
          : '')
      : `${p.units} units @ ${fmtUsd2(p.avgCost)} | Cost: ${fmtUsd0(p.cost)}`;
    cards.push(cardHtml(title, pIdx, isOpt ? null : view.benchmarkIndex, pDiff, footer));
  });

  el.summaryCards.innerHTML = cards.join('');
}

function renderAllocation(view) {
  // Use |value| so short options appear in the donut without negative slices.
  const sectors = view.positions.map((p, i) => ({
    label: p.label || p.ticker,
    value: Math.abs(p.value),
    signed: p.value,
    color: COLORS[i % COLORS.length],
  }));
  const absTotal = sectors.reduce((s, x) => s + x.value, 0);

  const wrapper = document.createElement('div');
  wrapper.className = 'allocation-card';
  wrapper.innerHTML = `
    <h3>Allocation by Position</h3>
    <div class="total-label">${view.isLive ? 'Current Market Value (MTM)' : 'Market Value · ' + escapeHtml(view.label)}</div>
    <div class="total-value">${fmtUsd0(view.totalValue)}</div>
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
  el.allocationGrid.innerHTML = '';
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

function renderInsights(view) {
  const benchTicker = payload.benchmark?.ticker || 'SPY';
  const insights = [];

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

function renderDate(dateKey) {
  if (!payload?.model) return;
  const view = buildView(dateKey);
  if (!view) return;

  el.subtitle.textContent =
    `${payload.displayName || payload.slug} · Data Date: ${view.label} · ${view.isLive ? 'Latest' : 'Archived'}`;
  el.statusBadge.className = view.isLive ? 'live-badge' : 'archive-badge';
  el.statusBadge.textContent = view.isLive ? 'LIVE' : 'ARCHIVE';

  destroyCharts();
  renderCards(view);
  renderAllocation(view);
  renderBar(view);
  renderCharts(view);
  renderInsights(view);
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

  el.loading.classList.add('hidden');
  el.error.classList.add('hidden');
  el.dashboard.classList.remove('hidden');

  renderDate(selectedDate);
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
  renderDate(selectedDate);
});
el.refreshBtn.addEventListener('click', () => void load());
el.autoRefresh.addEventListener('change', syncTimer);

void load();
