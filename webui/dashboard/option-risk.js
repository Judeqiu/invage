/** Optional, isolated Section 01 controller. No legacy quote/data refreshes. */
(() => {
  'use strict';
  const base = '/api/domain/invage/option-risk';
  const $ = id => document.getElementById(id);
  const tabs = $('section01ViewTabs'), existing = $('section01ExistingTab'), risk = $('section01RiskTab');
  if (!tabs || !existing || !risk) return;
  let context, contextKey = '', generation = 0, section01View = 'existing', enabled = false;
  let controller = new AbortController(), timer, capabilitiesTimer, job, result, resultStale = false, busy = false, checking = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const money = (v, unit) => v == null ? 'Unavailable' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
  function status(message) { $('optionRiskStatus').textContent = message; }
  function stop() { clearTimeout(timer); controller.abort(); controller = new AbortController(); generation++; busy = false; }
  function switchView(view, focus = false) {
    section01View = view;
    for (const [button, selected] of [[existing, view === 'existing'], [risk, view === 'risk']]) {
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('on', selected);
    }
    $('section01ExistingPanel').classList.toggle('hidden', view !== 'existing');
    $('section01RiskPanel').classList.toggle('hidden', view !== 'risk');
    if (focus) (view === 'risk' ? risk : existing).focus();
    stop();
    if (view === 'risk') void activate();
  }
  function disable() {
    const hadFocus = $('section01RiskPanel').contains(document.activeElement) || tabs.contains(document.activeElement);
    enabled = false; job = null; result = null;
    switchView('existing'); tabs.classList.add('hidden'); $('optionRiskOutput').replaceChildren();
    if (hadFocus) { const target = context?.hasOptions ? $('expiryTitle') : $('dashboardRefresh'); target.tabIndex = -1; target.focus(); }
  }
  async function request(path, options = {}, signal = controller.signal) {
    const response = await fetch(base + path, { credentials: 'same-origin', signal, ...options });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 404) disable();
      const error = new Error(body.error || 'Risk analysis unavailable');
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return body;
  }
  function input(refresh = false) {
    const all = ['merged', 'all'].includes(context.channel);
    return { analysisContextId: context.payload.analysisContextId, accountScope: { kind: all ? 'all' : 'selected', accountIds: all ? [] : [context.channel] },
      horizonTradingDays: Number($('optionRiskHorizon').value), scenarioSet: 'equity-options-standard-v1', mode: 'conditional', refresh };
  }
  function params() {
    const r = input();
    return new URLSearchParams({ analysisContextId: r.analysisContextId, kind: r.accountScope.kind, accountIds: JSON.stringify(r.accountScope.accountIds),
      horizonTradingDays: String(r.horizonTradingDays), ...(!context.isLive ? { date: context.date } : {}) });
  }
  async function checkCapabilities() {
    if (!context || document.hidden || checking) return;
    // A static/saved report must have neither an authenticated context nor access
    // to this controller through stale serialized report data.
    if (!['/domain-assets/invage/dashboard/index.html', '/dashboard/', '/dashboard/index.html', '/domain-assets/invage/dashboard/v2.html', '/dashboard/v2.html'].includes(location.pathname)) return disable();
    if (!context.payload.dashboardConfig?.showOptionRiskModelView || context.payload.productProfile !== 'consultant') return disable();
    checking = true;
    const key = contextKey;
    try {
      const cap = await request('/capabilities', {}, null);
      if (key !== contextKey) return;
      if (!cap.enabled) return disable();
      enabled = true;
      tabs.classList.toggle('hidden', !context.hasOptions);
      if (!cap.available) status(cap.reason || 'Analysis service is not configured.');
    } catch { if (key === contextKey) disable(); }
    finally {
      checking = false;
      // Cached and fresh dashboard renders can overlap this request. Recheck
      // the current context immediately instead of leaving its tabs hidden.
      if (key !== contextKey) void checkCapabilities();
    }
  }
  function render(value) {
    if (result !== value) resultStale = false;
    result = value;
    // Quote age is informational; it no longer suppresses or labels usable results.
    const c = value.coverage;
    const partial = value.status === 'partial' ? 'Covered positions only · ' : '';
    const unavailable = value.status === 'unavailable' || c.supportedContracts === 0;
    status(`${resultStale ? 'Recalculating · ' : ''}${partial}${unavailable ? 'Analysis not ready' : 'Ready'} · ${c.supportedContracts}/${c.totalContracts} option positions · ${c.supportedQuantity}/${c.totalQuantity} contracts covered`);
    const evidence = `<details class="risk-evidence"><summary>Coverage and data sources</summary><p>Accounts: ${esc(value.scope.accountIds.join(', ') || context.channel)}. Generated: ${esc(value.generatedAt)}.</p><p>Model: ${esc(value.model.id)} ${esc(value.model.version)}. Holdings revision: ${esc(value.portfolioRevision)}. Market snapshot: ${esc(value.marketSnapshotId)}. Metadata: ${esc(value.metadataVersion)}.</p>${(value.inputEvidence || []).length ? `<ul>${value.inputEvidence.map(e => `<li><strong>${esc(e.id)}</strong><br>${esc(e.source)}<br>Option quote: ${esc(e.quoteAsOf)} · Underlying quote: ${esc(e.spotAsOf)}<br>${esc(e.rateReference)}<br>${esc(e.dividendReference)}</li>`).join('')}</ul>` : ''}<ul>${c.exclusions.map(x => `<li>${esc(x.id)} (${esc(x.quantity)} contracts): ${esc(x.reason)}</li>`).join('')}${value.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>`;
    $('optionRiskRun').textContent = unavailable ? 'Check data again' : 'Recalculate';
    if (unavailable) {
      const missingFeed = value.marketSnapshotId === 'unavailable';
      $('optionRiskOutput').innerHTML = `<section class="risk-empty-state" data-option-risk-empty>
        <div class="label-eyebrow">Model inputs unavailable</div><h3>${missingFeed ? 'Market data is not connected' : 'No positions have usable model inputs'}</h3>
        <p>Your holdings are loaded. ${missingFeed ? 'A verified market-data feed has not been connected to this analysis.' : 'The supplied market data does not yet meet the model’s required price and contract checks.'} Risk numbers will appear when those inputs are available.</p>
        <dl class="risk-input-summary"><div><dt>Option positions</dt><dd>${esc(c.totalContracts)}</dd></div><div><dt>Contracts held</dt><dd>${esc(c.totalQuantity)}</dd></div><div><dt>Broker accounts</dt><dd>${esc(value.scope.accountIds.length)}</dd></div></dl>
        <div class="risk-input-needs"><h4>What this analysis needs</h4><ul><li>Time-stamped option and underlying prices</li><li>Verified exercise, expiry and settlement terms</li><li>Interest rates and announced dividends or a distribution-yield estimate</li></ul></div>
        <p class="risk-note">Refreshing checks the available inputs again. It does not connect a missing data feed. Your expiry and assignment view remains available.</p>
      </section>${evidence}`;
      return;
    }
    const metric = (label, m, note = '') => `<div class="metric-card"><div class="label-eyebrow">${esc(label)}</div><div class="metric-value">${esc(money(m.value, m.unit))}</div><p class="risk-note">${esc(m.reason || note)}</p></div>`;
    const section = (title, content, note = '') => `<section class="risk-result-section"><div class="risk-section-head"><h3>${esc(title)}</h3>${note ? `<p>${esc(note)}</p>` : ''}</div>${content}</section>`;
    const table = (headers, rows) => `<div class="table-scroll"><table class="report"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
    const scenarios = value.scenarios.flatMap(s => s.byCurrency.map(v => `<tr><td>${esc((s.spotShock * 100).toFixed(0))}% / ${esc(s.volatilityPointShock)} vol points</td><td>${esc(v.currency)}</td><td>${esc(money(v.optionPnl, v.currency))}</td><td>${esc(money(v.combinedPnl, v.currency))}</td></tr>`)).join('');
    const contributors = value.contributors.map(c => `<tr><td>${esc(c.id)}<span class="risk-account">${esc(c.accountId)}</span></td><td>${esc(money(c.dollarDelta, c.currency))}</td><td>${esc(money(c.vega, c.currency))}</td><td>${esc(money(c.theta, c.currency))}</td></tr>`).join('');
    const coverageMetric = { value: c.supportedContracts, unit: `of ${c.totalContracts} positions`, reason: `${c.supportedQuantity} of ${c.totalQuantity} contracts covered` };
    $('optionRiskOutput').innerHTML = `<div class="risk-asof">${value.marketAsOf ? `Market data as of ${esc(new Date(value.marketAsOf).toLocaleString())} · ${esc(Math.max(0, Math.floor((Date.now() - Date.parse(value.marketAsOf)) / 60000)))} minutes old` : 'Market quote time unavailable'} · ${esc(value.scope.accountIds.length)} broker accounts${value.valuationDate ? ` · Valuation date ${esc(value.valuationDate)} (New York)` : ''}</div>
      <div class="kpi-row">${metric('Scenario loss', value.metrics.stressLoss, 'Largest loss across the tested shocks; covered positions only')}${metric('Options dollar delta', value.metrics.dollarDelta, 'Option exposure only; excludes underlying shares')}${metric('Positions covered', coverageMetric)}</div>
      ${scenarios ? section('Conditional scenarios', table(['Spot / volatility shock', 'Currency', 'Options P/L', 'Options + shares P/L'], scenarios), 'Signed profit or loss under each shock. These scenarios have no forecast probabilities.') : ''}
      ${value.funding.length ? section('Cash and share requirements', `<div class="risk-funding-grid">${value.funding.map(f => `<article class="risk-funding-card"><h4>${esc(f.accountId)}</h4><dl><div><dt>Short-put funding</dt><dd>${esc(money(f.grossPutFunding, f.currency))}</dd></div><div><dt>Recorded cash</dt><dd>${esc(money(f.cash, f.currency))}</dd></div><div><dt>Funding gap</dt><dd>${esc(money(f.fundingGap, f.currency))}</dd></div></dl><p class="risk-note">Cash as of ${esc(f.cashAsOf || 'unknown')}${f.delivery.map(d => ` · ${esc(d.underlying)}: ${esc(d.requiredShares)} call-delivery shares required; ${esc(d.availableShares)} available`).join('')}</p></article>`).join('')}</div>`, 'Gross assignment requirements, rather than a loss estimate. Broker collateral netting is excluded.') : ''}
      ${value.payoffBounds.length ? section('Expiry payoff bounds', table(['Account / underlying', 'Expiry', 'Minimum P/L', 'Maximum P/L'], value.payoffBounds.map(b => `<tr><td>${esc(b.underlying)}<span class="risk-account">${esc(b.accountId)}</span></td><td>${esc(b.expiryAt)}</td><td>${b.unlimitedLoss ? 'Unlimited loss' : esc(money(b.minPnl, b.currency))}</td><td>${b.unlimitedGain ? 'Unlimited gain' : esc(money(b.maxPnl, b.currency))}</td></tr>`).join('')), 'Standalone option legs grouped by account, underlying and expiry. Excludes costs and early exercise.') : ''}
      ${contributors ? section('Option exposures', table(['Contract / account', 'Dollar delta', 'Vega / volatility point', 'Theta / calendar day'], contributors), 'Expiry-day Greeks use intrinsic value; remaining intraday time value is not modelled.') : ''}
      ${section('Physical forecast', value.forecast?.metrics?.length ? table(['Currency', '95% VaR', '95% expected shortfall', 'Probability of profit', 'Expected P/L', 'ES sampling interval'], value.forecast.metrics.map(m => `<tr><td>${esc(m.currency)}</td><td>${esc(money(m.var,m.currency))}</td><td>${esc(money(m.expectedShortfall,m.currency))}</td><td>${esc((m.probabilityOfProfit*100).toFixed(1))}%</td><td>${esc(money(m.expectedPnl,m.currency))}</td><td>${esc(money(m.samplingInterval.lower,m.currency))} – ${esc(money(m.samplingInterval.upper,m.currency))}</td></tr>`).join('')) : `<p>${esc(value.forecast?.reason || value.metrics.expectedShortfall.reason)}</p>`, `${value.scope.horizonTradingDays} trading days. Physical model estimates; conditional shocks above have no probabilities.`)}
      ${value.forecast ? `<details><summary>Forecast coverage and validation</summary><p>${esc(value.forecast.coverage.supportedPositions)} / ${esc(value.forecast.coverage.totalPositions)} priced positions. ${esc(value.forecast.validation.status)}: ${esc(value.forecast.validation.reason)}. ${esc(value.forecast.validation.observations)} observations; ${esc(value.forecast.validation.validationCases)} validation origins and ${esc(value.forecast.validation.holdoutCases)} final holdout origins.</p><p>${esc(value.forecast.validation.calibrationTarget)}</p><ul>${value.forecast.coverage.exclusions.map(x=>`<li>${esc(x.id)}: ${esc(x.reason)}</li>`).join('')}${value.forecast.assumptions.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      ${value.actions?.length ? section('Hold, close and hedge comparisons', table(['Action / account', 'Initial cash flow', 'Estimated fee', 'Tested scenario loss', '95% ES', 'Funding / displayed depth', 'Assumptions'], value.actions.map(a=>`<tr><td>${esc(a.label)}<span class="risk-account">${esc(a.accountId || 'Selected scope')}</span></td><td>${esc(money(a.initialCashFlow,a.currency))}</td><td>${esc(money(a.estimatedInitialFees,a.currency))}</td><td>${esc(money(a.stressLoss,a.currency))}</td><td>${esc(money(a.forecast?.expectedShortfall ?? null,a.currency))}</td><td>${esc(a.funding)} / ${esc(a.liquidity)}</td><td>${esc(a.reason)} Fee ${esc(a.costModel.feePerContract)} / contract, minimum ${esc(a.costModel.minimumOrderFee)} / order, slippage ${esc(a.costModel.slippageBps)} bps.${a.quote ? ` Bid ${esc(a.quote.bid)}, ask ${esc(a.quote.ask)}; fetched ${esc(a.quote.fetchedAt)}. ${esc(a.quote.source)}` : ''}</td></tr>`).join('')), 'Each row changes one leg in the covered currency portfolio. Estimates, not broker charges or guaranteed fills. Initial costs counted once; terminal holdings are marked, without future liquidation costs. Analysis only; no orders are placed.') : ''}
      ${evidence}
      <button type="button" class="chip-btn risk-discuss" aria-expanded="false" data-option-risk-discuss data-option-key="${esc(JSON.stringify(['risk', value.id]))}" data-option-discuss="${esc(`@OptionsExpert Explain saved risk analysis ${value.id}. Retrieve it with get_option_risk_result before making numerical claims. Account ${value.scope.accountIds.join(', ')}, revision ${value.portfolioRevision}, horizon ${value.scope.horizonTradingDays} trading days, model ${value.model.version}, as of ${value.marketAsOf}. Explain assumptions and exclusions; state staleness first. No trade execution.`)}" data-option-title="Risk &amp; scenarios" data-option-context="${esc(value.id)}">Discuss analysis</button>`;
  }

  async function poll(token) {
    if (!job || token !== generation || section01View !== 'risk' || document.hidden || !enabled) return;
    try {
      const current = await request('/jobs/' + encodeURIComponent(job.id));
      if (token !== generation) return;
      job = current;
      if (job.result) return render(job.result);
      if (['failed', 'cancelled'].includes(job.status)) { status((result ? 'Stale result retained · ' : '') + (job.error || 'Analysis cancelled. Retry.')); return; }
      status(`${result ? 'Stale result retained · ' : ''}${job.status === 'queued' ? 'Queued' : 'Running'}…`);
      timer = setTimeout(() => void poll(token), 2000);
    } catch (e) { if (token === generation && e.name !== 'AbortError') status((result ? 'Stale result retained · ' : '') + e.message + (e.retryable === false ? '' : ' · Retry available.')); }
  }
  async function submit(refresh = false) {
    if (!enabled || !context?.isLive || !context.payload.analysisContextId || busy) return;
    busy = true; resultStale = !!result; const token = generation;
    status(result ? 'Stale result retained · Recalculating…' : 'Submitting analysis…');
    try {
      const next = await request('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input(refresh)) });
      if (token !== generation) return;
      job = next;
      if (job.result) render(job.result); else void poll(token);
    } catch (e) { if (token === generation && e.name !== 'AbortError') status((result ? 'Stale result retained · ' : '') + e.message + (e.retryable === false ? '' : ' · Retry available.')); }
    finally { if (token === generation) busy = false; }
  }
  async function activate() {
    if (!enabled || !context) return;
    if (!context.payload.analysisContextId) return status('Analysis service is not configured.');
    if (job && !['failed', 'cancelled', 'complete'].includes(job.status)) return void poll(generation);
    if (result) return render(result);
    const token = generation;
    status('Loading saved analysis…');
    try {
      const saved = await request('/latest?' + params());
      if (token !== generation) return;
      if (saved.job?.result) { job = saved.job; return render(saved.job.result); }
      if (!context.isLive) return status('No saved risk analysis for this date');
      void submit();
    } catch (e) { if (token === generation && e.name !== 'AbortError') status((result ? 'Stale result retained · ' : '') + e.message + (e.retryable === false ? '' : ' · Retry available.')); }
  }
  window.OptionRiskView = { update(next) {
    const key = JSON.stringify([next.payload.analysisContextId, next.payload.generatedAt, next.channel, next.date, next.hasOptions]);
    context = next;
    if (key !== contextKey) {
      stop(); contextKey = key; job = null; result = null; $('optionRiskOutput').replaceChildren(); status('Select Risk & scenarios to load analysis.');
      $('optionRiskRun').disabled = !next.isLive;
      void checkCapabilities().then(() => { if (enabled && section01View === 'risk') void activate(); });
    }
    if (!next.hasOptions || !next.payload.dashboardConfig?.showOptionRiskModelView || next.payload.productProfile !== 'consultant') disable();
    if (!capabilitiesTimer && next.payload.dashboardConfig?.showOptionRiskModelView) capabilitiesTimer = setInterval(() => void checkCapabilities(), 60_000);
  } };
  existing.addEventListener('click', () => switchView('existing'));
  risk.addEventListener('click', () => { if (enabled) switchView('risk'); });
  tabs.addEventListener('keydown', e => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    e.preventDefault(); switchView(e.key === 'Home' ? 'existing' : e.key === 'End' ? 'risk' : section01View === 'existing' ? 'risk' : 'existing', true);
  });
  $('optionRiskHorizon').addEventListener('change', () => { stop(); job = null; result = null; $('optionRiskOutput').replaceChildren(); if (section01View === 'risk') void activate(); });
  $('optionRiskRun').addEventListener('click', () => { stop(); void submit(true); });
  window.addEventListener('focus', () => void checkCapabilities());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else void checkCapabilities().then(() => { if (section01View === 'risk') void activate(); });
  });
})();
