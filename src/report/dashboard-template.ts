import type { DashboardModel, HistoryRow, LivePosition } from './dashboard-model.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatPct(value: number): string {
  return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
}

function formatUsd(value: number): string {
  return (
    '$' +
    value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function signedColor(value: number): string {
  return value >= 0 ? 'color:#3fb950' : 'color:#f85149';
}

function holdingRows(positions: LivePosition[]): string {
  if (positions.length === 0) {
    return '<tr><td colspan="9" style="text-align:center;color:#8b949e;padding:16px">No positions</td></tr>';
  }
  return positions
    .map((p) => {
      const kind = p.instrument === 'option' ? 'OPT' : 'EQ';
      const name = p.instrument === 'option' ? p.label : p.ticker;
      const unitsLabel =
        p.instrument === 'option'
          ? `${p.units} ct` + (p.option ? ` ×${p.option.multiplier}` : '')
          : String(p.units);
      return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;color:#8b949e;font-size:11px">${kind}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;font-weight:600">${escapeHtml(name)}<div style="font-size:11px;color:#8b949e;font-weight:400">${escapeHtml(p.ticker)}</div></td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d">${escapeHtml(unitsLabel)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d">${formatUsd(p.avgCost)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d">${formatUsd(p.price)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d">${formatUsd(p.value)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;color:#8b949e">${p.weightPct.toFixed(1)}%</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;${signedColor(p.pl)}">${formatUsd(p.pl)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;${signedColor(p.plPct)}">${formatPct(p.plPct)}</td>
    </tr>`;
    })
    .join('\n');
}

function historyRows(rows: HistoryRow[]): string {
  if (rows.length === 0) {
    return '<tr><td colspan="5" style="text-align:center;color:#8b949e;padding:16px">No snapshots yet. Use save_snapshot periodically to build value history.</td></tr>';
  }
  return rows
    .map((r) => {
      const deltaCell =
        r.deltaValue == null || r.deltaPct == null
          ? '<td style="padding:6px 10px;border-bottom:1px solid #21262d;color:#8b949e">—</td><td style="padding:6px 10px;border-bottom:1px solid #21262d;color:#8b949e">—</td>'
          : `<td style="padding:6px 10px;border-bottom:1px solid #21262d;${signedColor(r.deltaValue)}">${formatUsd(r.deltaValue)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;${signedColor(r.deltaPct)}">${formatPct(r.deltaPct)}</td>`;
      return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d">${escapeHtml(r.date)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d">${formatUsd(r.totalValue)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #21262d;${signedColor(r.totalPL)}">${formatPct(r.totalPLPct)}</td>
      ${deltaCell}
    </tr>`;
    })
    .join('\n');
}

/** Inline SVG sparkline from total-value series. Empty string if fewer than 2 points. */
export function buildSparklineSvg(values: number[], width = 320, height = 64): string {
  if (values.length < 2) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const pad = 4;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * innerW;
      const y =
        range === 0
          ? pad + innerH / 2
          : pad + innerH - ((v - min) / range) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const stroke = values[values.length - 1] >= values[0] ? '#3fb950' : '#f85149';

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Portfolio value over time">
  <polyline fill="none" stroke="${stroke}" stroke-width="2" points="${points}" />
</svg>`;
}

export function buildDashboardReport(model: DashboardModel, userName: string): string {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const { live, history, periodChange, lastSnapshot } = model;
  const sparkline = buildSparklineSvg(history.map((h) => h.totalValue));

  const periodBlock =
    periodChange == null
      ? `<div style="color:#8b949e;font-size:13px;margin-top:4px">No prior snapshot for period change</div>`
      : `<div style="font-size:28px;font-weight:700;${signedColor(periodChange.deltaValue)}">${formatPct(periodChange.deltaPct)}</div>
    <div style="font-size:14px;${signedColor(periodChange.deltaValue)}">${formatUsd(periodChange.deltaValue)}</div>
    <div style="color:#8b949e;font-size:11px;margin-top:4px">${escapeHtml(periodChange.fromDate)} → ${escapeHtml(periodChange.toDate)}</div>`;

  const lastSnapLine =
    lastSnapshot == null
      ? `<p style="color:#8b949e;margin:0 0 24px;font-size:13px">No snapshots on file yet.</p>`
      : `<p style="color:#8b949e;margin:0 0 24px;font-size:13px">Last snapshot: ${escapeHtml(lastSnapshot.date)} · ${formatUsd(lastSnapshot.totalValue)} (may differ from live value)</p>`;

  const optionsBlock =
    live.optionCount === 0
      ? ''
      : `<div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
  <div style="flex:1;min-width:140px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center">
    <div style="color:#8b949e;font-size:12px;margin-bottom:4px">OPTIONS</div>
    <div style="font-size:28px;font-weight:700">${live.optionCount}</div>
    <div style="color:#8b949e;font-size:11px;margin-top:4px">${live.equityCount} equity · ${live.optionCount} option</div>
  </div>
  <div style="flex:1;min-width:140px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center">
    <div style="color:#8b949e;font-size:12px;margin-bottom:4px">PREMIUM COLLECTED</div>
    <div style="font-size:28px;font-weight:700;color:#3fb950">${formatUsd(live.optionsPremiumCollected)}</div>
    ${
      live.optionsPremiumPaid > 0
        ? `<div style="color:#8b949e;font-size:11px;margin-top:4px">Paid (longs): ${formatUsd(live.optionsPremiumPaid)}</div>`
        : ''
    }
  </div>
  <div style="flex:1;min-width:140px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center">
    <div style="color:#8b949e;font-size:12px;margin-bottom:4px">CONTINGENT OBLIGATION</div>
    <div style="font-size:28px;font-weight:700;color:#f0883e">${formatUsd(live.contingentCashObligation)}</div>
    <div style="color:#8b949e;font-size:11px;margin-top:4px">Short puts if assigned</div>
    ${
      live.contingentShareObligation > 0
        ? `<div style="color:#8b949e;font-size:11px;margin-top:2px">Short calls: ${live.contingentShareObligation} sh deliverable</div>`
        : ''
    }
  </div>
</div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Portfolio Dashboard</title></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#e6edf3">
<div style="max-width:900px;margin:0 auto;padding:24px">

<h1 style="font-size:24px;margin:0 0 8px">Portfolio Dashboard</h1>
<p style="color:#8b949e;margin:0 0 4px">${escapeHtml(userName)} · ${now} UTC</p>
${lastSnapLine}

<div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
  <div style="flex:1;min-width:140px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center">
    <div style="color:#8b949e;font-size:12px;margin-bottom:4px">POSITIONS</div>
    <div style="font-size:28px;font-weight:700">${live.positionCount}</div>
  </div>
  <div style="flex:1;min-width:140px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center">
    <div style="color:#8b949e;font-size:12px;margin-bottom:4px">LIVE VALUE (MTM)</div>
    <div style="font-size:28px;font-weight:700">${formatUsd(live.totalValue)}</div>
    <div style="color:#8b949e;font-size:11px;margin-top:4px">Equity MTM ${formatUsd(live.equityValue)}</div>
  </div>
  <div style="flex:1;min-width:140px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center">
    <div style="color:#8b949e;font-size:12px;margin-bottom:4px">TOTAL P/L (VS COST)</div>
    <div style="font-size:28px;font-weight:700;${signedColor(live.totalPL)}">${formatPct(live.totalPLPct)}</div>
    <div style="font-size:14px;${signedColor(live.totalPL)}">${formatUsd(live.totalPL)}</div>
  </div>
  <div style="flex:1;min-width:140px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center">
    <div style="color:#8b949e;font-size:12px;margin-bottom:4px">PERIOD CHANGE</div>
    ${periodBlock}
  </div>
</div>

${optionsBlock}

<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:20px">
  <h2 style="font-size:16px;margin:0 0 12px">Value History</h2>
  ${
    sparkline
      ? `<div style="margin-bottom:16px;overflow-x:auto">${sparkline}</div>`
      : `<p style="color:#8b949e;font-size:13px;margin:0 0 12px">Sparkline appears after at least two snapshots.</p>`
  }
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr style="text-align:left;color:#8b949e;font-size:11px">
      <th style="padding:6px 10px">Date</th>
      <th style="padding:6px 10px">Total Value</th>
      <th style="padding:6px 10px">P/L %</th>
      <th style="padding:6px 10px">Δ $</th>
      <th style="padding:6px 10px">Δ %</th>
    </tr>
    ${historyRows(history)}
  </table>
</div>

<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:20px">
  <h2 style="font-size:16px;margin:0 0 12px">Holdings (${live.positionCount})</h2>
  <p style="color:#8b949e;font-size:12px;margin:0 0 12px">
    Options: avg cost / price = premium per share; units = contracts; value uses direction (short = liability).
    Contingent obligation is not subtracted from live MTM — shown in the options cards above.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr style="text-align:left;color:#8b949e;font-size:11px">
      <th style="padding:6px 10px">Type</th>
      <th style="padding:6px 10px">Position</th>
      <th style="padding:6px 10px">Size</th>
      <th style="padding:6px 10px">Avg / Prem</th>
      <th style="padding:6px 10px">Mark</th>
      <th style="padding:6px 10px">Value</th>
      <th style="padding:6px 10px">Weight</th>
      <th style="padding:6px 10px">P/L $</th>
      <th style="padding:6px 10px">P/L %</th>
    </tr>
    ${holdingRows(live.positions)}
  </table>
</div>

<p style="color:#8b949e;font-size:11px;text-align:center;margin-top:24px">
  Generated by Invester · Equities: Yahoo Finance · Options: stored marks · Not financial advice
</p>

</div>
</body>
</html>`;
}
