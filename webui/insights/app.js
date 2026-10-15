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
    el.s3.innerHTML = '';
    el.actions.innerHTML = '';
    el.s4.innerHTML = sectionHead(
      'Section 04',
      'Book statistics',
      'Shows current portfolio holdings and position counts based on available records. These figures reflect existing positions, not historical win rates nor realized trading performance.',
    );
    el.edge.innerHTML = emptyCard('No lots to count.');
    el.s5.innerHTML = '';
    el.emotion.innerHTML = '';
    return;
  }
  const ccy = ccyOf(live);
  const hasUnitemizedFunds = brokerFundAssets(dash, channel).some(row => row.amount > 0);
  const when = dash.generatedAt ? dash.generatedAt.slice(0, 10) : '';
  el.eyebrow.textContent = `Books briefing · ${when}`;
  const chNote = channel === 'all' ? 'All Platforms' : channelLabel(channel);
  el.summary.textContent = `${live.positionCount} itemized lots · ${hasUnitemizedFunds ? 'Itemized NAV (excludes broker fund total)' : 'NAV'}: ${money(live.totalValue, ccy)} · ${chNote}. All insights below are calculated using this portfolio data only.`;
  el.metrics.innerHTML =
    metricCard(hasUnitemizedFunds ? 'Itemized NAV' : 'NAV', money(live.totalValue, ccy), hasUnitemizedFunds ? 'Excludes broker fund total shown separately' : live.fxApplied ? `in ${ccy}` : null) +
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
    ) + brokerFundAssetsCards(dash, channel);
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
    el.s2.innerHTML = sectionHead('Section 02', 'Book patterns', 'Objective insights based on recorded portfolio data, not assumptions about investor behaviour or psychology.');
    el.conc.innerHTML = patterns
      .map(
        (t) => `<div class="metric-card"><div class="label-eyebrow">Pattern</div><div class="metric-value" style="font-size:1.15rem">${esc(t)}</div></div>`,
      )
      .join('');
  }

  el.s3.innerHTML = '';
  el.actions.innerHTML = '';

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
    'Shows current portfolio holdings and position counts based on available records. These figures reflect existing positions, not historical win rates nor realized trading performance.',
  );
  el.edge.innerHTML =
    metricCard('Equity lots', String(live.equityCount)) +
    (hasUnitemizedFunds && live.fundCount === 0 ? '' : metricCard('Fund lots', String(live.fundCount),
      hasUnitemizedFunds ? 'Itemized fund holdings only' : null)) +
    metricCard('Option lots', String(live.optionCount), opts.length ? `${puts} put · ${calls} call` : null) +
    metricCard(
      'Avg DTE / LEAPs',
      dteAvg == null ? '—' : `${dteAvg.toFixed(0)}d`,
      opts.length ? `${leaps} expiry > 365d` : 'No option lots',
    );

  el.s5.innerHTML = '';
  el.emotion.innerHTML = '';
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
