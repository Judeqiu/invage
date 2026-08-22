const el = {
  error: document.getElementById('error'),
  eyebrow: document.getElementById('eyebrow'),
  hello: document.getElementById('hello'),
  summary: document.getElementById('summary'),
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

function render(dash) {
  showError(el.error, '');
  const name = dash.displayName || 'Investor';
  const live = liveSlice(dash);
  el.hello.textContent = `Hello, ${name}.`;
  if (!live) {
    el.eyebrow.textContent = 'Daily briefing';
    el.summary.textContent = dash.message || 'No holdings or deposits on the books yet.';
    el.metrics.innerHTML = '';
    el.s1.innerHTML = sectionHead('Section 01', "Today's risks");
    el.risks.innerHTML = '<div class="metric-card empty">Nothing to flag until lots exist.</div>';
    el.s2.innerHTML = sectionHead('Section 02', 'Concentration');
    el.conc.innerHTML = '';
    el.s3.innerHTML = sectionHead('Section 03', 'Recommended actions');
    el.actions.innerHTML =
      '<div class="metric-card empty">No actions — the books have no positions to reconcile.</div>';
    el.s4.innerHTML = sectionHead('Section 04', 'Your personal edge');
    el.edge.innerHTML =
      '<div class="metric-card empty">No closed-trade statistics. Wallet Street does not invent win rates or DTE edges.</div>';
    el.s5.innerHTML = sectionHead('Section 05', 'Emotion vs profitability');
    el.emotion.innerHTML =
      '<div class="metric-card empty">No emotion journal on these books.</div>';
    return;
  }
  const ccy = ccyOf(live);
  const when = dash.generatedAt ? dash.generatedAt.slice(0, 10) : '';
  el.eyebrow.textContent = `Books briefing · ${when}`;
  el.summary.textContent = `${name}'s live books: ${live.positionCount} lots, NAV ${money(live.totalValue, ccy)}. Insights below are computed from that slice only.`;
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
  el.s1.innerHTML = sectionHead('Section 01', "Today's risks");
  el.risks.innerHTML =
    issues.length === 0
      ? '<div class="metric-card empty">No dashboard warnings on this slice.</div>'
      : issues
          .map(
            (w, i) => `
      <div class="metric-card" style="border-left:4px solid var(--warning)">
        <div class="label-eyebrow">Risk ${String(i + 1).padStart(2, '0')}</div>
        <p style="margin-top:0.5rem;font-size:0.875rem">${esc(w.message || w.code)}</p>
      </div>`,
          )
          .join('');
  const top = [...live.positions].sort((a, b) => b.weightPct - a.weightPct).slice(0, 6);
  el.s2.innerHTML = sectionHead(
    'Section 02',
    'Concentration',
    'Largest weights in the live slice. Not a strategy recommendation.',
  );
  el.conc.innerHTML = top
    .map(
      (p) => `
      <div class="metric-card">
        <div class="label-eyebrow">${esc(p.ticker)}</div>
        <div class="metric-value">${p.weightPct.toFixed(1)}%</div>
        <div class="metric-sub">${esc(p.instrument)} · ${money(p.value, ccy)} · ${esc(p.channel === 'default' ? 'unassigned' : p.channel)}</div>
      </div>`,
    )
    .join('');
  el.s3.innerHTML = sectionHead('Section 03', 'Recommended actions');
  const actions = [];
  if (live.cashAmount == null) {
    actions.push('Record free cash (channel + currency) so NAV is complete.');
  }
  if (issues.some((i) => i.code === 'missing_price')) {
    actions.push('Missing live marks are priced at cost on the dashboard — check those tickers.');
  }
  if (live.optionCount === 0 && live.equityCount > 0) {
    actions.push('No option lots. Assignment radar on Dashboard/Trades stays empty until options are journaled.');
  }
  el.actions.innerHTML =
    actions.length === 0
      ? '<div class="metric-card empty">No books actions flagged from this slice.</div>'
      : `<div class="metric-card"><ol style="margin-left:1.1rem;display:grid;gap:0.75rem">${actions
          .map((a, i) => `<li><span class="label-eyebrow" style="color:var(--brand)">${String(i + 1).padStart(2, '0')}</span> ${esc(a)}</li>`)
          .join('')}</ol></div>`;
  el.s4.innerHTML = sectionHead(
    'Section 04',
    'Your personal edge',
    'Continuous learning from closed trades is not on these books. Figures below are live inventory counts, not win rates.',
  );
  el.edge.innerHTML =
    metricCard('Equity lots', String(live.equityCount)) +
    metricCard('Fund lots', String(live.fundCount)) +
    metricCard('Option lots', String(live.optionCount)) +
    metricCard('Channels', String(live.channels.length), live.channels.join(', ') || null);
  el.s5.innerHTML = sectionHead('Section 05', 'Emotion vs profitability');
  el.emotion.innerHTML =
    '<div class="metric-card empty">No emotion tags are stored on household books. This table stays empty until a journal exists.</div>';
}

async function load() {
  try {
    const dash = await loadDashboard();
    render(dash);
  } catch (e) {
    showError(el.error, e instanceof Error ? e.message : String(e));
  }
}

load();
