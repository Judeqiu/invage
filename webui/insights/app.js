const el = {
  error: document.getElementById('error'),
  eyebrow: document.getElementById('eyebrow'),
  hello: document.getElementById('hello'),
  summary: document.getElementById('summary'),
  filters: document.getElementById('filters'),
  metrics: document.getElementById('metrics'),
  s1: document.getElementById('s1'),
  risks: document.getElementById('risks'),
  s2: document.getElementById('s2'),
  conc: document.getElementById('conc'),
  s3: document.getElementById('s3'),
  actions: document.getElementById('actions'),
  s4: document.getElementById('s4'),
  edge: document.getElementById('edge'),
  s5: document.getElementById('s5'),
  emotion: document.getElementById('emotion'),
};

let dashPayload = null;
let channel = 'all';

function bindFilters(live) {
  if (!el.filters) return;
  const channels = [...(live && live.channels ? live.channels : [])];
  if (channels.length <= 1) {
    el.filters.innerHTML = '';
    return;
  }
  el.filters.innerHTML =
    `<span class="label-eyebrow">Broker</span>` + channelButtons(channels, channel, 'data-ins-ch="1"');
  el.filters.querySelectorAll('[data-ins-ch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      channel = btn.getAttribute('data-channel');
      writeChannelQuery(channel);
      render(dashPayload);
    });
  });
}

function render(dash) {
  dashPayload = dash;
  showError(el.error, '');
  const consultant = productProfileOf(dash) === 'consultant';
  const raw = liveSlice(dash);
  bindFilters(raw);
  const live = sliceLive(raw, channel);
  el.hello.textContent = consultant ? 'Where the book stands.' : 'Where the books stand.';
  if (!live) {
    el.eyebrow.textContent = 'Daily briefing';
    el.summary.textContent = dash.message || 'No holdings or deposits on the books yet.';
    el.metrics.innerHTML = '';
    el.s1.innerHTML = sectionHead('Section 01', "Today's risks");
    el.risks.innerHTML = emptyCard('No actions — the books have no positions to reconcile.');
    el.s2.innerHTML = '';
    el.conc.innerHTML = '';
    el.s3.innerHTML = sectionHead('Section 03', 'Recommended actions');
    el.actions.innerHTML = emptyCard('No actions — the books have no positions to reconcile.');
    el.s4.innerHTML = sectionHead(
      'Section 04',
      'Book statistics',
      'Live inventory counts from this slice, not win rates or closed-trade edge.',
    );
    el.edge.innerHTML = emptyCard('No lots to count.');
    el.s5.innerHTML = '';
    el.emotion.innerHTML = consultant
      ? emptyCard('No emotion tags are stored on these books.')
      : '';
    return;
  }
  const ccy = ccyOf(live);
  const when = dash.generatedAt ? dash.generatedAt.slice(0, 10) : '';
  el.eyebrow.textContent = `Books briefing · ${when}`;
  const chNote = channel === 'all' ? 'all platforms' : channelLabel(channel);
  el.summary.textContent = `${live.positionCount} lots, NAV ${money(live.totalValue, ccy)} · ${chNote}. Insights below are computed from that slice only.`;
  el.metrics.innerHTML =
    metricCard('NAV', money(live.totalValue, ccy), live.fxApplied ? `in ${ccy}` : null) +
    metricCard(
      'Unrealized P&L',
      signedMoney(live.totalPL, ccy),
      `${live.totalPLPct.toFixed(1)}%`,
      live.totalPL > 0 ? 'up' : live.totalPL < 0 ? 'down' : undefined,
    ) +
    metricCard(
      'Cash',
      live.cashAmount == null ? 'unknown' : money(live.cashAmount, live.cashCurrency || ccy),
      live.cashAmount == null ? 'cash block omitted' : null,
    ) +
    metricCard(
      'Assignment cash',
      money(live.contingentCashObligation, ccy),
      `${live.optionCount} option lots`,
    );
  const issues = [...(dash.warnings || []), ...(live.issues || [])];
  const prices = dash.equityPrices || {};
  const shorts = live.positions.filter((p) => p.instrument === 'option' && p.option && p.option.side === 'short');
  const itmNear = shorts.filter((p) => {
    const dte = dteDays(p.option.expiry);
    return optionItmState(p, prices) === 'itm' && dte <= 21;
  });
  const cashVsCont =
    live.cashAmount != null && live.contingentCashObligation > live.cashAmount;
  const riskCards = [];
  for (const w of issues) {
    riskCards.push(`<div class="metric-card" style="border-left:4px solid var(--warning)">
      <div class="label-eyebrow">${esc(w.code || 'warning')}</div>
      <p style="margin-top:0.5rem;font-size:0.875rem">${esc(w.message || w.code)}</p>
    </div>`);
  }
  for (const p of itmNear) {
    riskCards.push(`<div class="metric-card risk-danger">
      <div class="label-eyebrow">ITM · DTE ${dteDays(p.option.expiry)}d</div>
      <p style="margin-top:0.5rem;font-size:0.875rem">${esc(p.label)} is ITM vs last vs strike.</p>
    </div>`);
  }
  if (cashVsCont) {
    riskCards.push(`<div class="metric-card risk-warning">
      <div class="label-eyebrow">Cash vs assignment</div>
      <p style="margin-top:0.5rem;font-size:0.875rem">Contingent cash ${money(live.contingentCashObligation, ccy)} exceeds recorded free cash.</p>
    </div>`);
  }
  el.s1.innerHTML = sectionHead('Section 01', "Today's risks");
  el.risks.innerHTML =
    riskCards.length === 0 ? emptyCard('No books risks on this slice.') : riskCards.join('');

  const patterns = [];
  const near30 = live.positions.filter(
    (p) => p.instrument === 'option' && p.option && dteDays(p.option.expiry) <= 30,
  );
  if (live.optionCount > 0) {
    patterns.push(`${near30.length} of ${live.optionCount} contracts expire within 30 days`);
  }
  const top = [...live.positions].sort((a, b) => b.weightPct - a.weightPct)[0];
  if (top) {
    patterns.push(`Largest weight: ${top.ticker} ${top.weightPct.toFixed(1)}% NAV`);
  }
  if (patterns.length === 0) {
    el.s2.innerHTML = '';
    el.conc.innerHTML = '';
  } else {
    el.s2.innerHTML = sectionHead('Section 02', 'Book patterns', 'Countable facts from this slice. Not psychology.');
    el.conc.innerHTML = patterns
      .map(
        (t) => `<div class="metric-card"><div class="label-eyebrow">Pattern</div><div class="metric-value" style="font-size:1.15rem">${esc(t)}</div></div>`,
      )
      .join('');
  }

  el.s3.innerHTML = sectionHead('Section 03', 'Recommended actions');
  const actions = [];
  if (live.cashAmount == null) {
    actions.push('Record free cash (channel + currency) so NAV is complete.');
  }
  if (issues.some((i) => i.code === 'missing_price')) {
    actions.push('Missing live marks are priced at cost on the dashboard — check those tickers.');
  }
  for (const p of shorts) {
    const r = shortMarkOverPremium(p);
    if (r != null && r <= 0.1) {
      actions.push(`${p.label} mark is ${(r * 100).toFixed(0)}% of premium received.`);
    }
  }
  el.actions.innerHTML =
    actions.length === 0
      ? emptyCard('No books actions flagged from this slice.')
      : `<div class="metric-card"><ol style="margin-left:1.1rem;display:grid;gap:0.75rem">${actions
          .map((a, i) => `<li><span class="label-eyebrow" style="color:var(--brand)">${String(i + 1).padStart(2, '0')}</span> ${esc(a)}</li>`)
          .join('')}</ol></div>`;

  const opts = live.positions.filter((p) => p.instrument === 'option' && p.option);
  const puts = opts.filter((p) => p.option.right === 'put').length;
  const calls = opts.filter((p) => p.option.right === 'call').length;
  const dteAvg =
    opts.length === 0
      ? null
      : opts.reduce((s, p) => s + dteDays(p.option.expiry), 0) / opts.length;
  const leaps = opts.filter((p) => dteDays(p.option.expiry) > 365).length;
  el.s4.innerHTML = sectionHead(
    'Section 04',
    'Book statistics',
    'Live inventory counts from this slice, not win rates or closed-trade edge.',
  );
  el.edge.innerHTML =
    metricCard('Equity lots', String(live.equityCount)) +
    metricCard('Fund lots', String(live.fundCount)) +
    metricCard('Option lots', String(live.optionCount), opts.length ? `${puts} put · ${calls} call` : null) +
    metricCard(
      'Avg DTE / LEAPs',
      dteAvg == null ? '—' : `${dteAvg.toFixed(0)}d`,
      opts.length ? `${leaps} expiry > 365d` : 'No option lots',
    );

  if (live.optionCount === 0) {
    el.s5.innerHTML = '';
    el.emotion.innerHTML = consultant
      ? emptyCard('No emotion tags are stored on these books.')
      : '';
  } else {
    const byU = {};
    for (const p of opts) {
      const u = p.option.underlying || p.ticker;
      if (!byU[u]) byU[u] = { prem: 0, pl: 0 };
      if (p.option.side === 'short') byU[u].prem += Number(p.premiumAbsolute || 0);
      byU[u].pl += Number(p.pl || 0);
    }
    const und = Object.entries(byU).sort((a, b) => b[1].prem - a[1].prem);
    el.s5.innerHTML = sectionHead('Section 05', 'Premium and P&L by underlying');
    el.emotion.innerHTML = `<div class="metric-card table-card"><div class="table-scroll"><table class="report">
      <thead><tr><th>Underlying</th><th>Premium (short, open)</th><th>Open P&L</th></tr></thead>
      <tbody>${und
        .map(
          ([u, v]) => `<tr><td>${esc(u)}</td><td class="num">${money(v.prem, ccy)}</td><td class="num ${toneClass(v.pl)}">${signedMoney(v.pl, ccy)}</td></tr>`,
        )
        .join('')}</tbody></table></div></div>
      ${consultant ? emptyCard('No emotion tags are stored on these books.') : ''}`;
  }
}

async function load() {
  try {
    const dash = await loadDashboard();
    channel = channelFromQuery();
    if (channel === 'merged') channel = 'all';
    render(dash);
  } catch (e) {
    showError(el.error, e instanceof Error ? e.message : String(e));
  }
}

load();
