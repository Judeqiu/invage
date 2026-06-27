import type { AnalysisResult, PositionAnalysis } from '../market/index.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatPct(value: number): string {
  return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
}

function formatUsd(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sectionRows(positions: PositionAnalysis[], showMetric: 'upside' | 'premium' | 'overhead'): string {
  if (positions.length === 0) return '<tr><td colspan="6" style="text-align:center;color:#8b949e;padding:16px">No positions</td></tr>';
  return positions.map(s => {
    let metric = '';
    if (showMetric === 'upside' && s.upsideToMedian != null) metric = `Upside: ${formatPct(s.upsideToMedian)}`;
    else if (showMetric === 'premium' && s.targetMedian) metric = `Premium: +${((s.price - s.targetMedian) / s.targetMedian * 100).toFixed(1)}%`;
    else if (showMetric === 'overhead' && s.costVsHigh != null) metric = `Overhead: ${formatPct(s.costVsHigh)}`;

    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #21262d;font-weight:600">${escapeHtml(s.ticker)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #21262d;color:#8b949e">${escapeHtml(s.company)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #21262d;${s.plPct >= 0 ? 'color:#3fb950' : 'color:#f85149'}">${formatPct(s.plPct)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #21262d">${formatUsd(s.price)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #21262d;color:#8b949e">${metric}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #21262d;font-size:12px">${escapeHtml(s.recommendation ?? '—')}</td>
    </tr>`;
  }).join('\n');
}

function fullPortfolioRows(positions: PositionAnalysis[]): string {
  return [...positions]
    .sort((a, b) => b.plPct - a.plPct)
    .map((s, i) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;color:#8b949e">${i + 1}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;font-weight:600">${escapeHtml(s.ticker)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;color:#8b949e">${escapeHtml(s.company)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d">${formatUsd(s.avgCost)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d">${formatUsd(s.price)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;${s.plPct >= 0 ? 'color:#3fb950' : 'color:#f85149'}">${formatPct(s.plPct)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;${s.pl >= 0 ? 'color:#3fb950' : 'color:#f85149'}">${formatUsd(s.pl)}</td>
    </tr>`)
    .join('\n');
}

export function buildAnalysisReport(result: AnalysisResult, userName: string): string {
  const totalCost = result.fullAnalysis.reduce((sum, s) => sum + s.cost, 0);
  const totalValue = result.fullAnalysis.reduce((sum, s) => sum + s.value, 0);
  const totalPL = totalValue - totalCost;
  const totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#e6edf3">
<div style="max-width:800px;margin:0 auto;padding:24px">

<h1 style="font-size:24px;margin:0 0 8px">Portfolio Analysis Report</h1>
<p style="color:#8b949e;margin:0 0 24px">${escapeHtml(userName)} · ${now}</p>

<div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
  <div style="flex:1;min-width:140px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center">
    <div style="color:#8b949e;font-size:12px;margin-bottom:4px">POSITIONS</div>
    <div style="font-size:28px;font-weight:700">${result.fullAnalysis.length}</div>
  </div>
  <div style="flex:1;min-width:140px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center">
    <div style="color:#8b949e;font-size:12px;margin-bottom:4px">TOTAL VALUE</div>
    <div style="font-size:28px;font-weight:700">${formatUsd(totalValue)}</div>
  </div>
  <div style="flex:1;min-width:140px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center">
    <div style="color:#8b949e;font-size:12px;margin-bottom:4px">TOTAL P/L</div>
    <div style="font-size:28px;font-weight:700;${totalPL >= 0 ? 'color:#3fb950' : 'color:#f85149'}">${formatPct(totalPLPct)}</div>
    <div style="font-size:14px;${totalPL >= 0 ? 'color:#3fb950' : 'color:#f85149'}">${formatUsd(totalPL)}</div>
  </div>
  <div style="flex:1;min-width:140px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center">
    <div style="color:#8b949e;font-size:12px;margin-bottom:4px">OPPORTUNITIES</div>
    <div style="font-size:28px;font-weight:700;color:#3fb950">${result.buyOpportunities.length}</div>
  </div>
</div>

<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:20px;border-left:4px solid #f85149">
  <h2 style="font-size:16px;margin:0 0 12px">🔴 Laggards — Cost > Analyst High Target (${result.laggards.length})</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr style="text-align:left;color:#8b949e;font-size:11px">
      <th style="padding:6px 12px">Ticker</th><th>Company</th><th>P/L</th><th>Price</th><th>Metric</th><th>Recommendation</th>
    </tr>
    ${sectionRows(result.laggards, 'overhead')}
  </table>
</div>

<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:20px;border-left:4px solid #d29922">
  <h2 style="font-size:16px;margin:0 0 12px">🟡 Overpriced — Price Above Median Target (${result.overpriced.length})</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr style="text-align:left;color:#8b949e;font-size:11px">
      <th style="padding:6px 12px">Ticker</th><th>Company</th><th>P/L</th><th>Price</th><th>Metric</th><th>Recommendation</th>
    </tr>
    ${sectionRows(result.overpriced, 'premium')}
  </table>
</div>

<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:20px;border-left:4px solid #3fb950">
  <h2 style="font-size:16px;margin:0 0 12px">🟢 Buy Opportunities — >15% Upside (${result.buyOpportunities.length})</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr style="text-align:left;color:#8b949e;font-size:11px">
      <th style="padding:6px 12px">Ticker</th><th>Company</th><th>P/L</th><th>Price</th><th>Upside</th><th>Recommendation</th>
    </tr>
    ${sectionRows(result.buyOpportunities, 'upside')}
  </table>
</div>

<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:20px">
  <h2 style="font-size:16px;margin:0 0 12px">Full Portfolio (${result.fullAnalysis.length})</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr style="text-align:left;color:#8b949e;font-size:11px">
      <th style="padding:6px 10px">#</th><th>Ticker</th><th>Company</th><th>Cost</th><th>Price</th><th>P/L %</th><th>P/L $</th>
    </tr>
    ${fullPortfolioRows(result.fullAnalysis)}
  </table>
</div>

<p style="color:#8b949e;font-size:11px;text-align:center;margin-top:24px">
  Generated by Invester · Data from Yahoo Finance · Not financial advice
</p>

</div>
</body>
</html>`;
}
