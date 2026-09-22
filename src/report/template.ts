import type { AnalysisResult, PositionAnalysis } from '../market/index.js';
import {
  dropCaption,
  emailMetric,
  emailSection,
  enforceEmailSize,
  escapeHtml,
  footerLine,
  formatPct,
  formatUsd,
  HEX_TOKENS,
  signedColor,
  tdStyle,
  thStyle,
  wrapReportHtml,
  type ReportOpts,
} from './html-kit.js';

function metricFor(s: PositionAnalysis, showMetric: 'upside' | 'premium' | 'overhead'): string {
  if (showMetric === 'upside' && s.upsideToMedian != null) return `Upside: ${formatPct(s.upsideToMedian)}`;
  if (showMetric === 'premium' && s.targetMedian) {
    return `Premium: +${(((s.price - s.targetMedian) / s.targetMedian) * 100).toFixed(1)}%`;
  }
  if (showMetric === 'overhead' && s.costVsHigh != null) return `Overhead: ${formatPct(s.costVsHigh)}`;
  return '';
}

function driveAxisRows(positions: PositionAnalysis[], showMetric: 'upside' | 'premium' | 'overhead'): string {
  if (positions.length === 0) {
    return '<tr><td colspan="6" class="empty">No positions</td></tr>';
  }
  return positions
    .map((s) => {
      const tone = s.plPct >= 0 ? 'up' : 'down';
      return `<tr data-ch="${escapeHtml(s.channel ?? 'default')}">
      <td><strong>${escapeHtml(s.ticker)}</strong></td>
      <td>${escapeHtml(s.company)}</td>
      <td class="num ${tone}">${formatPct(s.plPct)}</td>
      <td class="num">${formatUsd(s.price)}</td>
      <td>${escapeHtml(metricFor(s, showMetric))}</td>
      <td>${escapeHtml(s.recommendation ?? '—')}</td>
    </tr>`;
    })
    .join('\n');
}

function emailAxisRows(positions: PositionAnalysis[], showMetric: 'upside' | 'premium' | 'overhead'): string {
  if (positions.length === 0) {
    return `<tr><td colspan="6" style="${tdStyle('text-align:center;color:' + HEX_TOKENS.mutedForeground)}">No positions</td></tr>`;
  }
  return positions
    .map((s) => {
      const c = signedColor(s.plPct);
      return `<tr>
      <td style="${tdStyle()}">${escapeHtml(s.ticker)}</td>
      <td style="${tdStyle()}">${escapeHtml(s.company)}</td>
      <td style="${tdStyle('color:' + c)}">${formatPct(s.plPct)}</td>
      <td style="${tdStyle()}">${formatUsd(s.price)}</td>
      <td style="${tdStyle()}">${escapeHtml(metricFor(s, showMetric))}</td>
      <td style="${tdStyle()}">${escapeHtml(s.recommendation ?? '—')}</td>
    </tr>`;
    })
    .join('\n');
}

function topByAbsPlPct(positions: PositionAnalysis[], n: number): PositionAnalysis[] {
  return [...positions].sort((a, b) => Math.abs(b.plPct) - Math.abs(a.plPct)).slice(0, n);
}

function driveFullRows(positions: PositionAnalysis[]): string {
  return [...positions]
    .sort((a, b) => b.plPct - a.plPct)
    .map((s, i) => {
      const kind = s.instrument === 'option' ? 'OPT' : 'EQ';
      const tone = s.plPct >= 0 ? 'up' : 'down';
      return `<tr data-ch="${escapeHtml(s.channel ?? 'default')}">
      <td class="muted">${i + 1}</td>
      <td class="muted">${kind}</td>
      <td><strong>${escapeHtml(s.ticker)}</strong></td>
      <td>${escapeHtml(s.company)}</td>
      <td class="num">${formatUsd(s.avgCost)}</td>
      <td class="num">${formatUsd(s.price)}</td>
      <td class="num ${tone}">${formatPct(s.plPct)}</td>
      <td class="num ${tone}">${formatUsd(s.pl)}</td>
    </tr>`;
    })
    .join('\n');
}

function emailFullRows(positions: PositionAnalysis[]): string {
  return [...positions]
    .sort((a, b) => b.plPct - a.plPct)
    .map((s, i) => {
      const kind = s.instrument === 'option' ? 'OPT' : 'EQ';
      const c = signedColor(s.pl);
      return `<tr>
      <td style="${tdStyle()}">${i + 1}</td>
      <td style="${tdStyle()}">${kind}</td>
      <td style="${tdStyle()}">${escapeHtml(s.ticker)}</td>
      <td style="${tdStyle()}">${escapeHtml(s.company)}</td>
      <td style="${tdStyle()}">${formatUsd(s.avgCost)}</td>
      <td style="${tdStyle()}">${formatUsd(s.price)}</td>
      <td style="${tdStyle('color:' + c)}">${formatPct(s.plPct)}</td>
      <td style="${tdStyle('color:' + c)}">${formatUsd(s.pl)}</td>
    </tr>`;
    })
    .join('\n');
}

function optionsDrive(positions: PositionAnalysis[]): string {
  const opts = positions.filter((s) => s.instrument === 'option');
  if (opts.length === 0) return '';
  let contingentCash = 0;
  let premiumCollected = 0;
  let premiumPaid = 0;
  const rows = opts
    .map((s) => {
      const o = s.option;
      contingentCash += s.contingentCashObligation ?? 0;
      if (o?.side === 'short') premiumCollected += s.premiumAbsolute ?? 0;
      else premiumPaid += s.premiumAbsolute ?? 0;
      const oblig =
        (s.contingentCashObligation ?? 0) > 0
          ? formatUsd(s.contingentCashObligation!)
          : (s.contingentShareObligation ?? 0) > 0
            ? `${s.contingentShareObligation} sh`
            : '—';
      const tone = s.pl >= 0 ? 'up' : 'down';
      return `<tr data-ch="${escapeHtml(s.channel ?? 'default')}">
      <td><strong>${escapeHtml(s.ticker)}</strong></td>
      <td>${escapeHtml(s.company)}</td>
      <td class="num">${formatUsd(s.premiumAbsolute ?? 0)}</td>
      <td class="num">${formatUsd(s.price)}</td>
      <td class="num">${formatUsd(s.value)}</td>
      <td class="num ${tone}">${formatUsd(s.pl)}</td>
      <td>${oblig}</td>
    </tr>`;
    })
    .join('\n');
  return `<div class="metric-card" style="border-left:4px solid var(--brand);margin:1.25rem 0">
  <h2>Options (${opts.length})</h2>
  <p class="metric-sub">Premium collected: ${formatUsd(premiumCollected)} · Paid: ${formatUsd(premiumPaid)} · Contingent cash obligation: ${formatUsd(contingentCash)}</p>
  <div class="table-scroll"><table class="report">
    <thead><tr><th>Key</th><th>Contract</th><th>Premium $</th><th>Mark</th><th>MTM</th><th>P/L</th><th>Obligation</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</div>`;
}

function optionsEmail(positions: PositionAnalysis[]): string {
  const opts = positions.filter((s) => s.instrument === 'option');
  if (opts.length === 0) return '';
  let contingentCash = 0;
  let premiumCollected = 0;
  let premiumPaid = 0;
  const rows = opts
    .map((s) => {
      const o = s.option;
      contingentCash += s.contingentCashObligation ?? 0;
      if (o?.side === 'short') premiumCollected += s.premiumAbsolute ?? 0;
      else premiumPaid += s.premiumAbsolute ?? 0;
      const oblig =
        (s.contingentCashObligation ?? 0) > 0
          ? formatUsd(s.contingentCashObligation!)
          : (s.contingentShareObligation ?? 0) > 0
            ? `${s.contingentShareObligation} sh`
            : '—';
      return `<tr>
      <td style="${tdStyle()}">${escapeHtml(s.ticker)}</td>
      <td style="${tdStyle()}">${escapeHtml(s.company)}</td>
      <td style="${tdStyle()}">${formatUsd(s.premiumAbsolute ?? 0)}</td>
      <td style="${tdStyle()}">${formatUsd(s.price)}</td>
      <td style="${tdStyle()}">${formatUsd(s.value)}</td>
      <td style="${tdStyle('color:' + signedColor(s.pl))}">${formatUsd(s.pl)}</td>
      <td style="${tdStyle()}">${oblig}</td>
    </tr>`;
    })
    .join('\n');
  return emailSection(
    `Options (${opts.length})`,
    `<div style="font-size:12px;color:${HEX_TOKENS.mutedForeground};margin-bottom:8px">Premium collected: ${formatUsd(premiumCollected)} · Paid: ${formatUsd(premiumPaid)} · Contingent cash: ${formatUsd(contingentCash)}</div>
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<th style="${thStyle()}">Key</th><th style="${thStyle()}">Contract</th><th style="${thStyle()}">Premium $</th><th style="${thStyle()}">Mark</th><th style="${thStyle()}">MTM</th><th style="${thStyle()}">P/L</th><th style="${thStyle()}">Obligation</th>
</tr>${rows}</table>`,
  );
}

function buildAnalysisBody(
  result: AnalysisResult,
  userName: string,
  opts: ReportOpts,
  limits: { axis: number | null; full: number | null },
): string {
  const totalCost = result.fullAnalysis.reduce((sum, s) => sum + s.cost, 0);
  const totalValue = result.fullAnalysis.reduce((sum, s) => sum + s.value, 0);
  const totalPL = totalValue - totalCost;
  const totalPLPct = totalCost !== 0 ? (totalPL / Math.abs(totalCost)) * 100 : 0;
  const optionCount = result.fullAnalysis.filter((s) => s.instrument === 'option').length;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const foot = footerLine(opts.productName);
  const laggards =
    limits.axis == null ? result.laggards : topByAbsPlPct(result.laggards, limits.axis);
  const overpriced =
    limits.axis == null ? result.overpriced : topByAbsPlPct(result.overpriced, limits.axis);
  const opps =
    limits.axis == null
      ? result.buyOpportunities
      : topByAbsPlPct(result.buyOpportunities, limits.axis);
  const full =
    limits.full == null ? result.fullAnalysis : topByAbsPlPct(result.fullAnalysis, limits.full);
  const cap = (shown: number, total: number) =>
    shown < total ? `<div class="metric-sub">${dropCaption(shown, total)}</div>` : '';

  if (opts.surface === 'email') {
    const t = HEX_TOKENS;
    const axisTable = (
      title: string,
      rows: PositionAnalysis[],
      kind: 'upside' | 'premium' | 'overhead',
      all: PositionAnalysis[],
    ) =>
      emailSection(
        title,
        `${all.length > rows.length ? `<div style="font-size:12px;color:${t.mutedForeground};margin-bottom:6px">${dropCaption(rows.length, all.length)}</div>` : ''}
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<th style="${thStyle()}">Ticker</th><th style="${thStyle()}">Company</th><th style="${thStyle()}">P/L</th><th style="${thStyle()}">Price</th><th style="${thStyle()}">Metric</th><th style="${thStyle()}">Recommendation</th>
</tr>${emailAxisRows(rows, kind)}</table>`,
      );
    return `
<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${t.mutedForeground}">Analysis report</div>
<div style="font-size:24px;color:${t.ink};margin:8px 0">${escapeHtml(userName)}</div>
<div style="font-size:13px;color:${t.mutedForeground};margin-bottom:12px">${escapeHtml(opts.productName)} · ${now} UTC</div>
${emailMetric('Positions', String(result.fullAnalysis.length), optionCount > 0 ? `${optionCount} option` : undefined)}
${emailMetric('Total value', formatUsd(totalValue))}
${emailMetric('Total P/L', `${formatPct(totalPLPct)} · ${formatUsd(totalPL)}`, undefined, signedColor(totalPL))}
${emailMetric('Opportunities', String(result.buyOpportunities.length))}
${optionsEmail(result.fullAnalysis)}
${axisTable(`Laggards — Cost > Analyst High Target (${result.laggards.length})`, laggards, 'overhead', result.laggards)}
${axisTable(`Overpriced — Price Above Median Target (${result.overpriced.length})`, overpriced, 'premium', result.overpriced)}
${axisTable(`Buy Opportunities — >15% Upside (${result.buyOpportunities.length})`, opps, 'upside', result.buyOpportunities)}
${emailSection(
  `Full Portfolio (${result.fullAnalysis.length})`,
  `${full.length < result.fullAnalysis.length ? `<div style="font-size:12px;color:${t.mutedForeground};margin-bottom:6px">${dropCaption(full.length, result.fullAnalysis.length)}</div>` : ''}
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<th style="${thStyle()}">#</th><th style="${thStyle()}">Type</th><th style="${thStyle()}">Ticker</th><th style="${thStyle()}">Company</th><th style="${thStyle()}">Avg</th><th style="${thStyle()}">Mark</th><th style="${thStyle()}">P/L %</th><th style="${thStyle()}">P/L $</th>
</tr>${emailFullRows(full)}</table>`,
)}
<div style="font-size:11px;color:${t.mutedForeground};text-align:center;margin-top:16px">${escapeHtml(foot)}</div>`;
  }

  const plTone = totalPL >= 0 ? 'up' : 'down';
  const channels = [...new Set(result.fullAnalysis.map((s) => s.channel ?? 'default'))].sort();
  const chips =
    channels.length > 1
      ? `<div class="filters" id="channel-filter" style="margin:1rem 0">
    <span class="label-eyebrow">Broker</span>
    <button type="button" class="chip-btn on" data-channel="all">All platforms</button>
    ${channels
      .map((id) => {
        const label = id === 'default' ? 'Unassigned' : id;
        return `<button type="button" class="chip-btn" data-channel="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
      })
      .join('')}
  </div>`
      : '';
  const filterScript =
    channels.length > 1
      ? `<script>
(function(){
  var chips = document.getElementById('channel-filter');
  if (!chips) return;
  var selected = 'all';
  function apply(){
    var rows = document.querySelectorAll('tr[data-ch]');
    for (var i=0;i<rows.length;i++){
      rows[i].hidden = selected !== 'all' && rows[i].getAttribute('data-ch') !== selected;
    }
    var btns = chips.querySelectorAll('[data-channel]');
    for (var j=0;j<btns.length;j++){
      if (btns[j].getAttribute('data-channel')===selected) btns[j].classList.add('on');
      else btns[j].classList.remove('on');
    }
  }
  chips.addEventListener('click', function(e){
    var btn = e.target.closest('[data-channel]');
    if (!btn) return;
    selected = btn.getAttribute('data-channel') || 'all';
    apply();
  });
})();
</script>`
      : '';
  const axisCard = (
    title: string,
    accent: string,
    rows: PositionAnalysis[],
    kind: 'upside' | 'premium' | 'overhead',
    all: PositionAnalysis[],
  ) =>
    `<div class="metric-card" style="border-left:4px solid ${accent};margin-bottom:1.25rem">
  <h2>${escapeHtml(title)}</h2>
  ${cap(rows.length, all.length)}
  <div class="table-scroll"><table class="report">
    <thead><tr><th>Ticker</th><th>Company</th><th>P/L</th><th>Price</th><th>Metric</th><th>Recommendation</th></tr></thead>
    <tbody>${driveAxisRows(rows, kind)}</tbody>
  </table></div>
</div>`;

  return `
<div class="breadcrumb label-eyebrow">Analysis report</div>
<div class="hero">
  <h1>Portfolio Analysis Report</h1>
  <p>${escapeHtml(userName)} · ${now} UTC · ${escapeHtml(opts.productName)}</p>
  ${chips}
</div>
<div class="grid-4" style="margin:1.25rem 0">
  <div class="metric-card"><div class="label-eyebrow">Positions</div><div class="metric-value">${result.fullAnalysis.length}</div>${optionCount > 0 ? `<div class="metric-sub">${optionCount} option</div>` : ''}</div>
  <div class="metric-card"><div class="label-eyebrow">Total value</div><div class="metric-value">${formatUsd(totalValue)}</div></div>
  <div class="metric-card"><div class="label-eyebrow">Total P/L</div><div class="metric-value ${plTone}">${formatPct(totalPLPct)}</div><div class="metric-sub ${plTone}">${formatUsd(totalPL)}</div></div>
  <div class="metric-card"><div class="label-eyebrow">Opportunities</div><div class="metric-value up">${result.buyOpportunities.length}</div></div>
</div>
${optionsDrive(result.fullAnalysis)}
${axisCard(`Laggards — Cost > Analyst High Target (${result.laggards.length})`, 'var(--danger)', laggards, 'overhead', result.laggards)}
${axisCard(`Overpriced — Price Above Median Target (${result.overpriced.length})`, 'var(--warning)', overpriced, 'premium', result.overpriced)}
${axisCard(`Buy Opportunities — >15% Upside (${result.buyOpportunities.length})`, 'var(--success)', opps, 'upside', result.buyOpportunities)}
<div class="metric-card table-card">
  <h2>Full Portfolio (${result.fullAnalysis.length})</h2>
  ${cap(full.length, result.fullAnalysis.length)}
  <div class="table-scroll"><table class="report">
    <thead><tr><th>#</th><th>Type</th><th>Ticker</th><th>Company</th><th>Avg/Prem</th><th>Mark</th><th>P/L %</th><th>P/L $</th></tr></thead>
    <tbody>${driveFullRows(full)}</tbody>
  </table></div>
</div>
<p class="metric-sub" style="text-align:center;margin-top:1.5rem">${escapeHtml(foot)}</p>
${filterScript}`;
}

export function buildAnalysisReport(
  result: AnalysisResult,
  userName: string,
  opts: ReportOpts,
): string {
  const html = wrapReportHtml({
    title: 'Portfolio Analysis Report',
    surface: opts.surface,
    maxWidthPx: opts.surface === 'email' ? 640 : 800,
    body: buildAnalysisBody(result, userName, opts, { axis: null, full: null }),
  });
  if (opts.surface !== 'email') return html;
  return enforceEmailSize(html, () =>
    wrapReportHtml({
      title: 'Portfolio Analysis Report',
      surface: 'email',
      maxWidthPx: 640,
      body: buildAnalysisBody(result, userName, opts, { axis: 15, full: 25 }),
    }),
  );
}
