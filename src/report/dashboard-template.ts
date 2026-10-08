import {
  DEFAULT_CHANNEL,
  filterLiveByChannel,
  type ChannelTotals,
  type DashboardModel,
  type HistoryRow,
  type LiveDashboardSlice,
  type LivePosition,
} from './dashboard-model.js';
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

type MoneyFormatter = (amount: number, currency?: string) => string;

function holdingKind(p: LivePosition): string {
  return p.instrument === 'option' ? 'OPT' : p.instrument === 'fund' ? 'FUND' : 'EQ';
}

function unitsLabel(p: LivePosition): string {
  if (p.instrument === 'option') {
    return `${p.units} ct` + (p.option ? ` ×${p.option.multiplier}` : '');
  }
  if (p.instrument === 'fund') return `${p.units} u`;
  return String(p.units);
}

function topByAbsValue(positions: LivePosition[], n: number): LivePosition[] {
  return [...positions].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, n);
}

function concentrationBars(positions: LivePosition[], cashWeight: number | null): string {
  const rows = positions
    .map((p) => ({ label: p.ticker, value: p.weightPct, display: `${p.weightPct.toFixed(1)}%` }))
    .sort((a, b) => b.value - a.value);
  if (cashWeight != null) {
    rows.push({ label: 'Cash', value: cashWeight, display: `${cashWeight.toFixed(1)}%` });
    rows.sort((a, b) => b.value - a.value);
  }
  const top = rows.slice(0, 8);
  if (top.length === 0) return '';
  const max = Math.max(...top.map((r) => Math.abs(r.value)));
  const items = top
    .map((r) => {
      const pct = max > 0 ? (Math.abs(r.value) / max) * 100 : 0;
      return `<div class="bar-row">
        <div class="bar-meta"><span>${escapeHtml(r.label)}</span><span>${escapeHtml(r.display)}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${HEX_TOKENS.brand}"></div></div>
      </div>`;
    })
    .join('');
  return `<div class="metric-card"><div class="label-eyebrow">NAV concentration</div><div class="bar-list" style="margin-top:0.75rem">${items}</div><div class="metric-sub">Top 8 weights</div></div>`;
}

function emailConcentration(positions: LivePosition[]): string {
  const top = [...positions].sort((a, b) => b.weightPct - a.weightPct).slice(0, 8);
  if (top.length === 0) return '';
  const max = Math.max(...top.map((p) => p.weightPct), 0.01);
  const rows = top
    .map((p) => {
      const w = Math.max(2, Math.round((p.weightPct / max) * 100));
      return `<tr>
        <td style="${tdStyle()}">${escapeHtml(p.ticker)}</td>
        <td style="${tdStyle()}">${p.weightPct.toFixed(1)}%</td>
        <td style="${tdStyle()}"><div style="height:8px;width:${w}%;background:${HEX_TOKENS.brand}"></div></td>
      </tr>`;
    })
    .join('');
  return emailSection(
    'NAV concentration (top 8)',
    `<table width="100%" cellpadding="0" cellspacing="0"><tr><th style="${thStyle()}">Position</th><th style="${thStyle()}">Weight</th><th style="${thStyle()}"></th></tr>${rows}</table>`,
  );
}

function driveHoldings(positions: LivePosition[], money: MoneyFormatter): string {
  if (positions.length === 0) {
    return '<tr><td colspan="10" class="empty">No positions</td></tr>';
  }
  return positions
    .map((p) => {
      const name = p.instrument === 'option' || p.instrument === 'fund' ? p.label : p.ticker;
      const tone = p.pl >= 0 ? 'up' : 'down';
      return `<tr data-ch="${escapeHtml(p.channel)}">
      <td>${holdingKind(p)}</td>
      <td><strong>${escapeHtml(name)}</strong><div class="metric-sub">${escapeHtml(p.ticker)}</div></td>
      <td>${escapeHtml(p.channel)}</td>
      <td class="num">${escapeHtml(unitsLabel(p))}</td>
      <td class="num">${money(p.avgCost, p.currency)}</td>
      <td class="num">${money(p.price, p.currency)}</td>
      <td class="num">${money(p.value)}</td>
      <td class="num">${p.weightPct.toFixed(1)}%</td>
      <td class="num ${tone}">${money(p.pl)}</td>
      <td class="num ${tone}">${formatPct(p.plPct)}</td>
    </tr>`;
    })
    .join('\n');
}

function emailHoldingsGrouped(positions: LivePosition[], money: MoneyFormatter): string {
  const order: string[] = [];
  const groups = new Map<string, LivePosition[]>();
  for (const p of positions) {
    if (!groups.has(p.channel)) {
      groups.set(p.channel, []);
      order.push(p.channel);
    }
    groups.get(p.channel)!.push(p);
  }
  if (order.length <= 1) return emailHoldings(positions, money);
  return order
    .map((ch) => {
      const rows = groups.get(ch) ?? [];
      const label = ch === DEFAULT_CHANNEL ? 'Unassigned' : ch;
      return `<tr><td colspan="10" style="${tdStyle(`background:${HEX_TOKENS.muted};font-weight:700`)}">${escapeHtml(label)} · ${rows.length} lots</td></tr>${emailHoldings(rows, money)}`;
    })
    .join('\n');
}

function driveChips(channels: string[]): string {
  if (channels.length <= 1) return '';
  const ids = ['all', ...channels];
  return `<div class="filters" id="channel-filter" style="margin:1rem 0">
    <span class="label-eyebrow">Broker</span>
    ${ids
      .map((id) => {
        const label = id === 'all' ? 'All platforms' : id === DEFAULT_CHANNEL ? 'Unassigned' : id;
        const on = id === 'all' ? ' on' : '';
        return `<button type="button" class="chip-btn${on}" data-channel="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
      })
      .join('')}
  </div>`;
}

function driveHeroSlice(slice: LiveDashboardSlice, viewId: string, hidden: boolean, money: MoneyFormatter): string {
  const plTone = slice.totalPL >= 0 ? 'up' : 'down';
  const optLine =
    slice.optionCount === 0
      ? ''
      : `Short option lots: ${slice.optionCount} · contingent cash: ${money(slice.contingentCashObligation)}.`;
  const optionsStrip =
    slice.optionCount === 0
      ? ''
      : `<div class="grid-3" style="margin:1.25rem 0">
  <div class="metric-card"><div class="label-eyebrow">Options</div><div class="metric-value">${slice.optionCount}</div><div class="metric-sub">${slice.equityCount} equity · ${slice.fundCount} fund</div></div>
  <div class="metric-card"><div class="label-eyebrow">Premium collected</div><div class="metric-value up">${money(slice.optionsPremiumCollected)}</div><div class="metric-sub">Open book, not lifetime</div></div>
  <div class="metric-card"><div class="label-eyebrow">Contingent cash</div><div class="metric-value">${money(slice.contingentCashObligation)}</div><div class="metric-sub">${escapeHtml(optLine)}</div></div>
</div>`;
  return `<div class="channel-view" data-view="${escapeHtml(viewId)}"${hidden ? ' hidden' : ''}>
<div class="grid-4" style="margin-top:1.25rem">
  <div class="metric-card"><div class="label-eyebrow">Positions</div><div class="metric-value">${slice.positionCount}</div></div>
  <div class="metric-card"><div class="label-eyebrow">Live NAV</div><div class="metric-value">${money(slice.totalValue)}</div></div>
  <div class="metric-card"><div class="label-eyebrow">Total P/L (vs cost)</div><div class="metric-value ${plTone}">${formatPct(slice.totalPLPct)}</div><div class="metric-sub ${plTone}">${money(slice.totalPL)}</div></div>
  <div class="metric-card"><div class="label-eyebrow">Cash</div><div class="metric-value">${slice.cashAmount == null ? '—' : money(slice.cashAmount)}</div><div class="metric-sub">${slice.cashAmount == null ? 'Not recorded on this channel' : escapeHtml(slice.cashCurrency || '')}</div></div>
</div>
${optionsStrip}
${concentrationBars(slice.positions, slice.cashWeightPct)}
</div>`;
}

function driveFilterScript(): string {
  return `<script>
(function () {
  var chips = document.getElementById('channel-filter');
  if (!chips) return;
  var selected = 'all';
  function apply() {
    var views = document.querySelectorAll('.channel-view');
    for (var i = 0; i < views.length; i++) {
      views[i].hidden = views[i].getAttribute('data-view') !== selected;
    }
    var rows = document.querySelectorAll('tr[data-ch]');
    for (var j = 0; j < rows.length; j++) {
      var ch = rows[j].getAttribute('data-ch');
      rows[j].hidden = selected !== 'all' && ch !== selected;
    }
    var btns = chips.querySelectorAll('[data-channel]');
    for (var k = 0; k < btns.length; k++) {
      if (btns[k].getAttribute('data-channel') === selected) btns[k].classList.add('on');
      else btns[k].classList.remove('on');
    }
    var cap = document.getElementById('holdings-view-label');
    if (cap) cap.textContent = selected === 'all' ? 'Merged' : selected === 'default' ? 'Unassigned' : selected;
  }
  chips.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-channel]');
    if (!btn) return;
    selected = btn.getAttribute('data-channel') || 'all';
    apply();
  });
})();
</script>`;
}

function emailHoldings(positions: LivePosition[], money: MoneyFormatter): string {
  if (positions.length === 0) {
    return `<tr><td colspan="10" style="${tdStyle('text-align:center;color:' + HEX_TOKENS.mutedForeground)}">No positions</td></tr>`;
  }
  return positions
    .map((p) => {
      const name = p.instrument === 'option' || p.instrument === 'fund' ? p.label : p.ticker;
      const c = signedColor(p.pl);
      return `<tr>
      <td style="${tdStyle()}">${holdingKind(p)}</td>
      <td style="${tdStyle()}">${escapeHtml(name)}</td>
      <td style="${tdStyle()}">${escapeHtml(p.channel)}</td>
      <td style="${tdStyle()}">${escapeHtml(unitsLabel(p))}</td>
      <td style="${tdStyle()}">${money(p.avgCost, p.currency)}</td>
      <td style="${tdStyle()}">${money(p.price, p.currency)}</td>
      <td style="${tdStyle()}">${money(p.value)}</td>
      <td style="${tdStyle()}">${p.weightPct.toFixed(1)}%</td>
      <td style="${tdStyle('color:' + c)}">${money(p.pl)}</td>
      <td style="${tdStyle('color:' + c)}">${formatPct(p.plPct)}</td>
    </tr>`;
    })
    .join('\n');
}

function driveChannels(byChannel: ChannelTotals[], money: MoneyFormatter): string {
  if (byChannel.length === 0) {
    return '<tr><td colspan="6" class="empty">No channels</td></tr>';
  }
  return byChannel
    .map((c) => {
      const cashCell =
        c.cashAmount != null
          ? money(c.cashAmount, c.cashCurrency ?? undefined)
          : '—';
      const tone = c.totalPL >= 0 ? 'up' : 'down';
      return `<tr data-ch="${escapeHtml(c.channel)}">
      <td><strong>${escapeHtml(c.channel)}</strong></td>
      <td class="num">${c.positionCount}</td>
      <td class="num">${money(c.positionsValue)}</td>
      <td class="num">${cashCell}</td>
      <td class="num">${money(c.totalValue)}</td>
      <td class="num ${tone}">${money(c.totalPL)} (${formatPct(c.totalPLPct)})</td>
    </tr>`;
    })
    .join('\n');
}

function emailChannels(byChannel: ChannelTotals[], money: MoneyFormatter): string {
  if (byChannel.length === 0) {
    return `<tr><td colspan="6" style="${tdStyle('text-align:center;color:' + HEX_TOKENS.mutedForeground)}">No channels</td></tr>`;
  }
  return byChannel
    .map((c) => {
      const cashCell =
        c.cashAmount != null
          ? money(c.cashAmount, c.cashCurrency ?? undefined)
          : '—';
      const col = signedColor(c.totalPL);
      return `<tr>
      <td style="${tdStyle()}">${escapeHtml(c.channel)}</td>
      <td style="${tdStyle()}">${c.positionCount}</td>
      <td style="${tdStyle()}">${money(c.positionsValue)}</td>
      <td style="${tdStyle()}">${cashCell}</td>
      <td style="${tdStyle()}">${money(c.totalValue)}</td>
      <td style="${tdStyle('color:' + col)}">${money(c.totalPL)} (${formatPct(c.totalPLPct)})</td>
    </tr>`;
    })
    .join('\n');
}

function driveHistory(rows: HistoryRow[], money: MoneyFormatter): string {
  if (rows.length === 0) {
    return '<tr><td colspan="5" class="empty">No snapshots yet. Use save_snapshot periodically to build value history.</td></tr>';
  }
  return rows
    .map((r) => {
      const delta =
        r.deltaValue == null || r.deltaPct == null
          ? '<td class="muted">—</td><td class="muted">—</td>'
          : `<td class="num ${r.deltaValue >= 0 ? 'up' : 'down'}">${money(r.deltaValue, r.reportingCurrency ?? 'USD')}</td>
      <td class="num ${r.deltaPct >= 0 ? 'up' : 'down'}">${formatPct(r.deltaPct)}</td>`;
      return `<tr>
      <td>${escapeHtml(r.date)}</td>
      <td class="num">${money(r.totalValue, r.reportingCurrency ?? 'USD')}</td>
      <td class="num ${r.totalPL >= 0 ? 'up' : 'down'}">${formatPct(r.totalPLPct)}</td>
      ${delta}
    </tr>`;
    })
    .join('\n');
}

function emailHistory(rows: HistoryRow[], money: MoneyFormatter): string {
  if (rows.length === 0) {
    return `<tr><td colspan="5" style="${tdStyle('text-align:center;color:' + HEX_TOKENS.mutedForeground)}">No snapshots yet. Use save_snapshot periodically to build value history.</td></tr>`;
  }
  return rows
    .map((r) => {
      const delta =
        r.deltaValue == null || r.deltaPct == null
          ? `<td style="${tdStyle('color:' + HEX_TOKENS.mutedForeground)}">—</td><td style="${tdStyle('color:' + HEX_TOKENS.mutedForeground)}">—</td>`
          : `<td style="${tdStyle('color:' + signedColor(r.deltaValue))}">${money(r.deltaValue, r.reportingCurrency ?? 'USD')}</td>
      <td style="${tdStyle('color:' + signedColor(r.deltaPct))}">${formatPct(r.deltaPct)}</td>`;
      return `<tr>
      <td style="${tdStyle()}">${escapeHtml(r.date)}</td>
      <td style="${tdStyle()}">${money(r.totalValue, r.reportingCurrency ?? 'USD')}</td>
      <td style="${tdStyle('color:' + signedColor(r.totalPL))}">${formatPct(r.totalPLPct)}</td>
      ${delta}
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

  const stroke = values[values.length - 1] >= values[0] ? HEX_TOKENS.success : HEX_TOKENS.danger;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Portfolio value over time">
  <polyline fill="none" stroke="${stroke}" stroke-width="2" points="${points}" />
</svg>`;
}

function buildDashboardBody(
  model: DashboardModel,
  userName: string,
  opts: ReportOpts,
  limits: { history: number | null; holdings: number | null },
): string {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const { live, history, periodChange, lastSnapshot } = model;
  const reportingCurrency = live.reportingCurrency || 'USD';
  const money: MoneyFormatter = (amount, currency = reportingCurrency) =>
    currency === 'USD' ? formatUsd(amount) : `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  const histKeep =
    limits.history == null ? history : history.slice(Math.max(0, history.length - limits.history));
  const sparkSrc = histKeep.map((h) => h.totalValue);
  const comparableHistory = new Set(histKeep.map((h) => h.reportingCurrency ?? 'USD')).size <= 1;
  const sparkline = comparableHistory ? buildSparklineSvg(sparkSrc) : '';
  const sparklineNote = comparableHistory
    ? 'Sparkline appears after at least two snapshots.'
    : 'Sparkline unavailable across different reporting currencies.';
  const holdSrc =
    limits.holdings == null ? live.positions : topByAbsValue(live.positions, limits.holdings);
  const holdCaption =
    limits.holdings != null && live.positions.length > limits.holdings
      ? dropCaption(holdSrc.length, live.positions.length)
      : '';
  const channelList = live.channels.length > 0 ? live.channels.join(', ') : DEFAULT_CHANNEL;
  const multiChannel = live.channels.length > 1;
  const periodSub =
    periodChange == null
      ? 'No prior snapshot for period change'
      : `${escapeHtml(periodChange.fromDate)} → ${escapeHtml(periodChange.toDate)}`;
  const periodVal =
    periodChange == null ? '—' : `${formatPct(periodChange.deltaPct)} · ${money(periodChange.deltaValue, history.at(-1)?.reportingCurrency ?? 'USD')}`;
  const lastSnap =
    lastSnapshot == null
      ? 'No snapshots on file yet.'
      : `Last snapshot: ${escapeHtml(lastSnapshot.date)} · ${money(lastSnapshot.totalValue, history.at(-1)?.reportingCurrency ?? 'USD')} (may differ from live value)`;
  const optLine =
    live.optionCount === 0
      ? ''
      : `Short option lots: ${live.optionCount} · contingent cash: ${money(live.contingentCashObligation)}. ITM vs spot is live-dashboard only.`;
  const foot = footerLine(opts.productName);
  const fxNote = Object.entries(live.fxRates ?? {})
    .filter(([currency]) => currency !== reportingCurrency)
    .map(([currency, rate]) => `${currency}→${reportingCurrency} ${rate.toPrecision(5)}`)
    .join(' · ');

  if (opts.surface === 'email') {
    const t = HEX_TOKENS;
    const optBlock =
      live.optionCount === 0
        ? ''
        : emailMetric('Options', String(live.optionCount), optLine) +
          emailMetric('Premium collected', money(live.optionsPremiumCollected), 'Open book, not lifetime') +
          emailMetric('Contingent cash', money(live.contingentCashObligation), 'Short puts if assigned');
    return `
<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${t.mutedForeground}">Dashboard</div>
<div style="font-size:26px;color:${t.ink};margin:8px 0 4px">Portfolio snapshot</div>
<div style="font-size:13px;color:${t.mutedForeground};margin-bottom:12px">${escapeHtml(opts.productName)} · ${escapeHtml(userName)} · ${now} UTC · Merged · ${escapeHtml(channelList)} · Totals in ${escapeHtml(reportingCurrency)}${fxNote ? ` · FX ${escapeHtml(fxNote)}` : ''}</div>
<div style="font-size:12px;color:${t.mutedForeground};margin-bottom:12px">${lastSnap}</div>
${emailMetric('Positions', String(live.positionCount))}
${emailMetric('Live NAV', money(live.totalValue))}
${emailMetric('Total P/L (vs cost)', `${formatPct(live.totalPLPct)} · ${money(live.totalPL)}`, undefined, signedColor(live.totalPL))}
${emailMetric('Period change', periodVal, periodSub, periodChange ? signedColor(periodChange.deltaValue) : undefined)}
${optBlock}
${emailConcentration(holdSrc)}
${emailSection(
  'By Channel',
  `<div style="font-size:12px;color:${t.mutedForeground};margin-bottom:8px">Positions and cash without a broker tag are under ${DEFAULT_CHANNEL}. ${multiChannel ? 'Merged view across all channels.' : 'Single channel.'}</div>
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<th style="${thStyle()}">Channel</th><th style="${thStyle()}">Positions</th><th style="${thStyle()}">MTM</th><th style="${thStyle()}">Cash</th><th style="${thStyle()}">NAV</th><th style="${thStyle()}">P/L</th>
</tr>${emailChannels(live.byChannel, money)}</table>`,
)}
${emailSection(
  'Value History',
  `${sparkline ? `<div style="margin-bottom:8px">${sparkline}</div>` : `<div style="color:${t.mutedForeground};font-size:13px">${sparklineNote}</div>`}
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<th style="${thStyle()}">Date</th><th style="${thStyle()}">Total Value</th><th style="${thStyle()}">P/L %</th><th style="${thStyle()}">Δ value</th><th style="${thStyle()}">Δ %</th>
</tr>${emailHistory(histKeep, money)}</table>`,
)}
${emailSection(
  `Holdings (${live.positionCount})${multiChannel ? ' — by broker' : ' — Merged'}`,
  `${holdCaption ? `<div style="font-size:12px;color:${t.mutedForeground};margin-bottom:8px">${escapeHtml(holdCaption)}</div>` : ''}
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<th style="${thStyle()}">Type</th><th style="${thStyle()}">Position</th><th style="${thStyle()}">Channel</th><th style="${thStyle()}">Size</th><th style="${thStyle()}">Avg</th><th style="${thStyle()}">Mark</th><th style="${thStyle()}">Value</th><th style="${thStyle()}">Wt</th><th style="${thStyle()}">P/L value</th><th style="${thStyle()}">P/L %</th>
</tr>${emailHoldingsGrouped(holdSrc, money)}</table>`,
)}
<div style="font-size:11px;color:${t.mutedForeground};text-align:center;margin-top:16px">${escapeHtml(foot)}</div>`;
  }

  const periodTone =
    periodChange == null ? undefined : periodChange.deltaValue >= 0 ? 'up' : 'down';
  const channelHeroes = [
    driveHeroSlice(live, 'all', false, money),
    ...live.channels.map((ch) =>
      driveHeroSlice(filterLiveByChannel(live, ch), ch, true, money),
    ),
  ].join('\n');

  return `
<div class="breadcrumb label-eyebrow">Dashboard / Portfolio overview</div>
<div class="hero">
  <div class="label-eyebrow">${escapeHtml(opts.productName)}</div>
  <h1>Portfolio snapshot</h1>
  <p>${escapeHtml(userName)} · ${now} UTC · Channels: ${escapeHtml(channelList)} · Totals in ${escapeHtml(reportingCurrency)}${fxNote ? ` · FX ${escapeHtml(fxNote)}` : ''}</p>
  <p class="metric-sub">${lastSnap}</p>
  ${driveChips(live.channels)}
</div>
<div class="grid-4" style="margin-top:1.25rem">
  <div class="metric-card"><div class="label-eyebrow">Period change</div><div class="metric-value${periodTone ? ' ' + periodTone : ''}">${periodChange == null ? '—' : formatPct(periodChange.deltaPct)}</div><div class="metric-sub">${periodSub} · merged history</div></div>
</div>
${channelHeroes}
<div class="section-gap"><div class="label-eyebrow" style="color:var(--brand)">By channel</div><h2><span class="bar"></span>By Channel</h2>
<p>Positions and cash without a broker tag are under <code>${DEFAULT_CHANNEL}</code>. Use the broker chips to slice NAV, options, and holdings. Snapshot history stays merged.</p></div>
<div class="metric-card table-card"><div class="table-scroll"><table class="report">
<thead><tr><th>Channel</th><th>Positions</th><th>Positions MTM</th><th>Cash</th><th>NAV</th><th>P/L</th></tr></thead>
<tbody>${driveChannels(live.byChannel, money)}</tbody>
</table></div></div>
<div class="section-gap"><h2><span class="bar"></span>Value History</h2>
<p>Household-merged snapshots (all brokers). Not split by channel.</p></div>
<div class="metric-card">
  ${sparkline ? `<div style="margin-bottom:16px;overflow-x:auto">${sparkline}</div>` : `<p class="metric-sub">${sparklineNote}</p>`}
  <div class="table-scroll"><table class="report">
  <thead><tr><th>Date</th><th>Total Value</th><th>P/L %</th><th>Δ value</th><th>Δ %</th></tr></thead>
  <tbody>${driveHistory(histKeep, money)}</tbody>
  </table></div>
</div>
<div class="section-gap"><h2><span class="bar"></span>Holdings (<span id="holdings-view-label">Merged</span>)</h2>
<p>Options: avg / mark = premium in each contract's native currency; units = contracts. Channel column: broker tag or <code>${DEFAULT_CHANNEL}</code> when unassigned. ${holdCaption ? escapeHtml(holdCaption) : ''}</p></div>
<div class="metric-card table-card"><div class="table-scroll"><table class="report">
<thead><tr><th>Type</th><th>Position</th><th>Channel</th><th>Size</th><th>Avg / Prem</th><th>Mark</th><th>Value</th><th>Weight</th><th>P/L value</th><th>P/L %</th></tr></thead>
<tbody>${driveHoldings(holdSrc, money)}</tbody>
</table></div></div>
<p class="metric-sub" style="text-align:center;margin-top:1.5rem">${escapeHtml(foot)}</p>
${multiChannel ? driveFilterScript() : ''}`;
}

export function buildDashboardReport(
  model: DashboardModel,
  userName: string,
  opts: ReportOpts,
): string {
  const drive = wrapReportHtml({
    title: 'Portfolio Dashboard',
    surface: opts.surface,
    maxWidthPx: opts.surface === 'email' ? 720 : 900,
    body: buildDashboardBody(model, userName, opts, { history: null, holdings: null }),
  });
  if (opts.surface !== 'email') return drive;
  return enforceEmailSize(drive, () =>
    wrapReportHtml({
      title: 'Portfolio Dashboard',
      surface: 'email',
      maxWidthPx: 720,
      body: buildDashboardBody(model, userName, opts, { history: 8, holdings: 25 }),
    }),
  );
}
