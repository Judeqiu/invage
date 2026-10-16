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
      throw new Error(body.error || 'Risk analysis unavailable');
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
    if (!['/domain-assets/invage/dashboard/index.html', '/dashboard/', '/dashboard/index.html'].includes(location.pathname)) return disable();
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
    finally { checking = false; }
  }
  function render(value, stale = false) {
    if (result !== value) resultStale = false;
    result = value;
    stale = stale || resultStale || !!value.marketAsOf && Date.now() - Date.parse(value.marketAsOf) > 900000;
    const c = value.coverage;
    const partial = value.status === 'partial' ? 'Covered positions only · ' : '';
    status(`${stale ? 'Stale · ' : ''}${partial}${value.status === 'unavailable' ? 'Unavailable: validated inputs missing' : 'Ready'} · ${c.supportedContracts}/${c.totalContracts} contracts · ${c.supportedQuantity}/${c.totalQuantity} absolute quantity`);
    const metric = (label, m) => `<div class="metric-card"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(money(m.value, m.unit))}</div><p>${esc(m.reason)}</p></div>`;
    $('optionRiskOutput').innerHTML = `<p>As of ${esc(value.marketAsOf || 'Unavailable')} · Quote age ${value.marketAsOf ? esc(Math.max(0, Math.floor((Date.now() - Date.parse(value.marketAsOf)) / 60000))) + ' minutes' : 'unknown'} · Account ${esc(value.scope.accountIds.join(', ') || context.channel)} · Model ${esc(value.model.id)} ${esc(value.model.version)} · Holdings revision ${esc(value.portfolioRevision)}</p>
      <div class="kpi-row">${metric('Conditional stress loss (positive magnitude)', value.metrics.stressLoss)}${metric('Standalone option dollar delta', value.metrics.dollarDelta)}${metric('Expected shortfall', value.metrics.expectedShortfall)}</div>
      <h3>Conditional scenarios · signed P/L</h3><div class="table-scroll"><table class="report"><thead><tr><th>Spot / IV shock</th><th>Currency</th><th>Standalone options</th><th>Options + related shares</th></tr></thead><tbody>${value.scenarios.flatMap(s => s.byCurrency.map(v => `<tr><td>${esc((s.spotShock * 100).toFixed(0))}% / ${esc(s.volatilityPointShock)} vol points</td><td>${esc(v.currency)}</td><td>${esc(money(v.optionPnl, v.currency))}</td><td>${esc(money(v.combinedPnl, v.currency))}</td></tr>`)).join('')}</tbody></table></div>
      <h3>Assignment branches · gross funding, not loss</h3>${value.funding.map(f => `<p>${esc(f.accountId)} · Short put funding ${esc(money(f.grossPutFunding, f.currency))} · Recorded cash ${esc(money(f.cash, f.currency))} as of ${esc(f.cashAsOf || 'unknown')} · Funding gap ${esc(money(f.fundingGap, f.currency))} ${f.delivery.map(d => ` · ${esc(d.underlying)} call delivery ${esc(d.requiredShares)} shares; available ${esc(d.availableShares)}`).join('')}.</p>`).join('')}
      <h3>Option expiry payoff bounds</h3><p>Standalone legs grouped by account, underlying and expiry; excludes costs and early exercise.</p>${value.payoffBounds.map(b => `<p>${esc(b.accountId)} · ${esc(b.underlying)} · ${esc(b.expiryAt)} · Minimum ${b.unlimitedLoss ? 'Unlimited loss' : esc(money(b.minPnl, b.currency))} · Maximum ${b.unlimitedGain ? 'Unlimited gain' : esc(money(b.maxPnl, b.currency))}</p>`).join('')}
      <h3>Option exposures</h3><div class="table-scroll"><table class="report"><thead><tr><th>Contract / account</th><th>Dollar delta</th><th>Vega / vol point</th><th>Theta / calendar day</th></tr></thead><tbody>${value.contributors.map(c => `<tr><td>${esc(c.id)} · ${esc(c.accountId)}</td><td>${esc(money(c.dollarDelta, c.currency))}</td><td>${esc(money(c.vega, c.currency))}</td><td>${esc(money(c.theta, c.currency))}</td></tr>`).join('')}</tbody></table></div>
      <h3>Possible actions</h3><p>Hold scenarios shown. Close and hedge comparisons require fresh, validated executable quotes and costs.</p>
      <details><summary>Coverage, assumptions and input evidence</summary><p>Market snapshot ${esc(value.marketSnapshotId)} · Metadata ${esc(value.metadataVersion)} · Generated ${esc(value.generatedAt)}</p><ul>${c.exclusions.map(x => `<li>${esc(x.id)} (${esc(x.quantity)} contracts): ${esc(x.reason)}</li>`).join('')}${value.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>
      <button type="button" class="chip-btn" aria-expanded="false" data-option-risk-discuss data-option-key="${esc(JSON.stringify(['risk', value.id]))}" data-option-discuss="${esc(`@OptionsExpert Explain saved risk analysis ${value.id}. Retrieve it with get_option_risk_result before making numerical claims. Account ${value.scope.accountIds.join(', ')}, revision ${value.portfolioRevision}, horizon ${value.scope.horizonTradingDays} trading days, model ${value.model.version}, as of ${value.marketAsOf}. Explain assumptions and exclusions; state staleness first. No trade execution.`)}" data-option-title="Risk &amp; scenarios" data-option-context="${esc(value.id)}">Discuss analysis</button>`;
    $('optionRiskRun').textContent = 'Recalculate';
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
    } catch (e) { if (token === generation && e.name !== 'AbortError') status((result ? 'Stale result retained · ' : '') + e.message + ' · Retry available.'); }
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
    } catch (e) { if (token === generation && e.name !== 'AbortError') status((result ? 'Stale result retained · ' : '') + e.message + ' · Retry available.'); }
    finally { if (token === generation) busy = false; }
  }
  async function activate() {
    if (!enabled || !context) return;
    if (!context.payload.analysisContextId) return status('Analysis service is not configured.');
    if (job && !['failed', 'cancelled', 'complete'].includes(job.status)) return void poll(generation);
    if (result) return render(result, Date.now() - Date.parse(result.marketAsOf || result.generatedAt) > 900000);
    const token = generation;
    status('Loading saved analysis…');
    try {
      const saved = await request('/latest?' + params());
      if (token !== generation) return;
      if (saved.job?.result) { job = saved.job; return render(saved.job.result, saved.stale); }
      if (!context.isLive) return status('No saved risk analysis for this date');
      void submit();
    } catch (e) { if (token === generation && e.name !== 'AbortError') status((result ? 'Stale result retained · ' : '') + e.message + ' · Retry available.'); }
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
