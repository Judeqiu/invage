(() => {
  const $ = id => document.getElementById(id), M = globalThis.InsightsV2;
  let payload = null, channel = channelFromQuery(), loading = false;
  if (channel === 'merged') channel = 'all';
  const name = ch => ({all:'All platforms',ibkr:'IBKR',moomoo:'moomoo',tiger:'Tiger',webull:'Webull',default:'Unassigned'})[ch] || ch;
  const num = n => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US',{maximumFractionDigits:2});
  const amount = (n,c) => n == null || !Number.isFinite(n) || !c ? '—' : money(n,c);
  const signed = (n,c) => n == null || !Number.isFinite(n) || !c ? '—' : signedMoney(n,c);
  const pct = n => n == null ? '—' : `${num(n)}%`;
  const tone = n => n == null ? '' : n > 0 ? 'up' : n < 0 ? 'down' : '';
  const card = (label,value,sub = '',className = '',help = '') => `<div class="metric-card ${className}"><div class="label-eyebrow">${esc(label)}${help ? ` <button type="button" class="help-dot" aria-label="About ${esc(label)}" data-help="${esc(help)}">?</button>` : ''}</div><div class="metric-value">${esc(value)}</div><div class="metric-sub">${esc(sub)}</div></div>`;
  const contract = p => `${name(p.channel)} · ${p.ticker} ${p.side.toUpperCase()} ${p.right.toUpperCase()} ${amount(p.strike,p.nativeCurrency)} · ${formatReportDate(p.expiry)} ×${num(p.units)}`;
  const messageCard = (label,text,style = 'pattern-card') => `<div class="metric-card ${style}"><div class="label-eyebrow">${esc(label)}</div><p>${esc(text)}</p></div>`;
  function render() {
    const v = payload?.pageProjections?.insights?.[channel];
    if (!v) { if (channel !== 'all') { channel = 'all'; return render(); } throw new Error('Saved insights are unavailable. Sync your brokers and retry.'); }
    if (channel !== 'all' && !v.channels.includes(channel)) {channel = 'all';writeChannelQuery(channel);return render();}
    $('brokers').innerHTML = ['all',...v.channels].map(ch => `<button type="button" class="chip-btn${ch === channel ? ' on' : ''}" aria-pressed="${ch === channel}" data-channel="${esc(ch)}">${esc(name(ch))}</button>`).join('');
    $('eyebrow').textContent = `Daily briefing · ${formatReportDate(payload?.generatedAt) || 'Snapshot date unavailable'}`;
    $('summary').textContent = !payload?.model?.live ? payload?.message || 'No portfolio records are available yet.' : `${v.options} option lines · ${v.equities} equity lots${v.funds ? ' · ' + v.funds + ' fund lots' : ''} · ${name(channel)}`;
    const unitemized = brokerFundAssets(payload,channel).some(r => r.amount > 0);
    $('metrics').innerHTML = card(unitemized ? 'Itemized NAV' : 'NAV',amount(v.nav,v.ccy),v.ccy || 'Reporting currency unavailable') +
      card('Unrealized P&L',signed(v.totalPnl,v.ccy),'All recorded holdings',tone(v.totalPnl)) +
      card('Cash',amount(v.cash,v.ccy),'Recorded free cash; not buying power') +
      card('Assignment cash',amount(v.obligation,v.ccy),'Gross physical-delivery short-put obligation') + brokerFundAssetsCards(payload,channel);
    const risks = v.risks.map((p,i) => messageCard(`Risk ${String(i+1).padStart(2,'0')}`,
      `${contract(p)} — ${p.probability == null ? 'Currently in the money; expiry probability unavailable' : 'Estimated Prob. ITM ' + pct(p.probability*100)} with ${num(p.dte)} days left.${p.obligation == null ? '' : ' Gross put assignment cash: ' + amount(p.obligation,v.ccy) + '.'}`,
      `risk-card${p.dte <= 21 ? ' urgent' : ''}`));
    if (v.cashGap > 0) risks.push(messageCard('Cash vs assignment',`Gross short-put purchase obligations of ${amount(v.obligation,v.ccy)} exceed recorded cash of ${amount(v.cash,v.ccy)} by ${amount(v.cashGap,v.ccy)}. Check collateral and funding at each broker; this comparison does not establish available margin.`,'risk-card'));
    if (v.expired) risks.push(messageCard('Past-expiry records',`${v.expired} option lines remain recorded past expiry. Refresh their broker records and verify the outcome; expiration or assignment is not inferred.`,'risk-card'));
    $('risks').innerHTML = risks.join('') || messageCard(v.options ? 'Assessed positions' : 'No option holdings',v.options ? 'No matching elevated-probability or near-expiry ITM risks were identified in the assessed positions. Review the coverage notes below.' : 'No recorded option positions in this broker scope.');
    $('riskCoverage').textContent = `${v.shorts-v.unscored} of ${v.shorts} short-option lines scored · ${v.unscored} unscored. Prob. ITM estimates finishing in the money, not the probability of early assignment. ${v.dates.length ? v.dates.map(([ch,date]) => name(ch) + ' as of ' + formatReportDate(date)).join(' · ') : 'Broker position dates unavailable.'}`;
    $('patterns').innerHTML = messageCard('Expiry profile',`${v.nearLines} of ${v.options} recorded option lines expire in the next 30 days, with ${amount(v.nearPremium,v.ccy)} of reconciled remaining short premium. Past-expiry records are counted separately.`) +
      messageCard('Concentration',v.concentration ? `${v.concentration.ticker} has the largest gross marked exposure: ${amount(v.concentration.value,v.ccy)}, or ${pct(v.concentration.navPct)} of NAV. This adds absolute market values across its holdings; it is not stock-equivalent notional or a normalized portfolio weight.` : 'Concentration cannot be ranked until all holdings in this scope have comparable marks and NAV.');
    $('actions').innerHTML = v.actions.map((p,i) => `<li><span class="rank">${String(i+1).padStart(2,'0')}</span><div>${esc(contract(p))}<br><strong>${esc(pct(p.capture))}</strong> of gross opening premium retained at the displayed mark. Review closing or rolling costs, liquidity and assignment exposure before deciding.<br><a target="_parent" href="/trades?channel=${encodeURIComponent(p.channel)}">Review ${esc(name(p.channel))} trades →</a></div></li>`).join('') || '<li class="empty">No review candidates meet the 50% retained-premium threshold with reconciled opening cash, a current comparable mark and a recent broker date. This is not a recommendation to hold.</li>';
    const rankingNote = v.rankingIncomplete ? 'Complete comparable P&L required' : 'No qualifying contributor';
    const bestSub = r => r ? `${signed(r.pnl,v.ccy)} open P&L · ${num(r.lines)} lines / ${num(r.contracts)} contracts` : rankingNote;
    $('statistics').innerHTML = [
      card(M.statLabels[0],v.best?.ticker || '—',bestSub(v.best)),
      card(M.statLabels[1],v.worst?.ticker || '—',bestSub(v.worst)),
      card(M.statLabels[2],pct(v.profitPct),v.profitable == null ? 'Complete marks required' : `${v.profitable} of ${v.options} open lines`,'','Percentage of current option rows with positive unrealized P&L. Rows can contain multiple contracts. Not a historical win rate.'),
      card(M.statLabels[3],v.averageDte == null ? '—' : num(v.averageDte) + 'd',`${v.nearLines} lines expire within 30 days`,'','Arithmetic mean across current option rows, not weighted by contract quantity. Past-expiry records can make this lower; verify their status.'),
      card(M.statLabels[4],amount(v.averagePremium,v.ccy),'Per remaining short-option line · before fees'),
      card(M.statLabels[5],`${v.puts} / ${v.calls}`,'Short put lines vs short call lines'),
      card(M.statLabels[6],num(v.leapContracts),`${v.leapLines} lines · expiry beyond 365 days`),
      card(M.statLabels[7],pct(v.cashWeight),`${amount(v.cash,v.ccy)} recorded free cash`),
    ].join('');
    $('underlyings').innerHTML = `<table class="insights-table"><caption class="sr-only">Option book in ${esc(v.ccy || 'unavailable reporting currency')}</caption><thead><tr>${M.columns.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${v.rows.map(r => `<tr><th scope="row" title="${esc(r.ticker)}">${esc(r.ticker)}</th><td>${num(r.lines)}<small>${num(r.contracts)} contracts${r.longLines ? ' · ' + r.longLines + ' long lines' : ''}</small></td><td>${esc(amount(r.premium,v.ccy))}${r.missingPremium ? `<small>${r.missingPremium} unmatched · known ${esc(amount(r.premiumSubtotal,v.ccy))}</small>` : ''}</td><td class="${tone(r.pnl)}">${esc(signed(r.pnl,v.ccy))}${r.missingPnl ? `<small>${r.missingPnl} lines unvalued</small>` : ''}</td><td><span class="signal ${r.pnl == null || r.pnl < 0 || r.highRisk ? 'warning' : 'positive'}">${esc(r.signal)}</span></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No recorded option underlyings in this view.</td></tr>'}</tbody></table>`;
    $('availability').hidden = !v.warnings.length;
    $('availability').querySelector('ul').innerHTML = [...new Set(v.warnings)].map(w => `<li>${esc(w)}</li>`).join('');
    const figures = (node, title, values) => {
      if (!node) return;
      node.dataset.explainTitle = title; node.dataset.explainFigures = JSON.stringify(values);
    };
    const stats = [...$('statistics').children];
    for (const [i, contributor] of [[0, v.best], [1, v.worst]]) figures(stats[i], M.statLabels[i], contributor ? [
      `${contributor.ticker} · open P&L — ${signed(contributor.pnl,v.ccy)}`,
      `${contributor.ticker} · option lines — ${num(contributor.lines)}`,
      `${contributor.ticker} · contracts — ${num(contributor.contracts)}`,
    ] : [`${M.statLabels[i]} — unavailable (${rankingNote})`]);
    figures(stats[2], M.statLabels[2], [`Contracts in profit — ${pct(v.profitPct)}`, `Profitable option lines — ${num(v.profitable)}`, `Recorded option lines — ${num(v.options)}`]);
    figures(stats[3], M.statLabels[3], [`Average DTE — ${num(v.averageDte)} days`, `Lines expiring within 30 days — ${num(v.nearLines)}`]);
    figures(stats[4], M.statLabels[4], [`Average remaining short premium per line — ${amount(v.averagePremium,v.ccy)}`]);
    figures(stats[5], M.statLabels[5], [`Short put lines — ${num(v.puts)}`, `Short call lines — ${num(v.calls)}`]);
    figures(stats[6], M.statLabels[6], [`Contracts beyond 365 days — ${num(v.leapContracts)}`, `Lines beyond 365 days — ${num(v.leapLines)}`]);
    figures(stats[7], M.statLabels[7], [`Cash weight — ${pct(v.cashWeight)}`, `Recorded free cash — ${amount(v.cash,v.ccy)}`]);
    figures($('patterns').children[0], 'Expiry profile', [`Lines expiring within 30 days — ${num(v.nearLines)}`, `Recorded option lines — ${num(v.options)}`, `Reconciled remaining short premium within 30 days — ${amount(v.nearPremium,v.ccy)}`]);
    figures($('patterns').children[1], 'Concentration', v.concentration ? [`${v.concentration.ticker} · gross marked exposure — ${amount(v.concentration.value,v.ccy)}`, `${v.concentration.ticker} · gross exposure / NAV — ${pct(v.concentration.navPct)}`] : ['Concentration — unavailable; complete comparable marks and NAV required']);
    [...$('risks').children].forEach((node, i) => {
      const risk = v.risks[i];
      if (risk) figures(node, contract(risk), [`${contract(risk)} · Prob. ITM — ${pct(risk.probability == null ? null : risk.probability * 100)}`, `Days to expiry — ${num(risk.dte)}`, `Gross put assignment cash — ${amount(risk.obligation,v.ccy)}`]);
      const title = node.querySelector('.label-eyebrow')?.textContent;
      if (title === 'Cash vs assignment') figures(node, title, [`Gross put assignment cash — ${amount(v.obligation,v.ccy)}`, `Recorded cash — ${amount(v.cash,v.ccy)}`, `Cash shortfall vs gross assignment — ${amount(v.cashGap,v.ccy)}`]);
      if (title === 'Past-expiry records') figures(node, title, [`Past-expiry option lines — ${num(v.expired)}`]);
    });
    [...$('underlyings').querySelectorAll('tbody tr')].forEach((node, i) => {
      const row = v.rows[i]; if (!row) return;
      figures(node, `${row.ticker} option book`, [
        `${row.ticker} · option lines — ${num(row.lines)}`, `${row.ticker} · contracts — ${num(row.contracts)}`,
        `${row.ticker} · premium received — ${amount(row.premium,v.ccy)}`, `${row.ticker} · open P&L — ${signed(row.pnl,v.ccy)}`,
        ...(row.missingPremium ? [`${row.ticker} · known premium subtotal — ${amount(row.premiumSubtotal,v.ccy)} (${row.missingPremium} unmatched lines)`] : []),
      ]);
    });
    figures($('actions').parentElement, 'Review candidates', v.actions.map(p => `${contract(p)} · premium retained — ${pct(p.capture)}`));
    InsightsExplain.install({ payload, channel, ccy: v.ccy, notes: [
      'Current recorded holdings only. Premium received is reconciled opening cash for remaining short contracts, before fees. Open P&L includes long and short options and is unrealized, not historical trading performance. Counts of lines differ from contract quantities. Assignment cash is the gross physical-delivery short-put purchase obligation, not broker margin or net spread risk. Cash is recorded free cash, not buying power. Average DTE is the unweighted arithmetic mean of option rows; LEAPs expire beyond 365 days. Average premium is per remaining short-option line. Concentration sums absolute marked values by underlying and divides by NAV. Rankings require complete comparable P&L.',
      ...v.warnings,
    ].join(' ') });
    $('content').setAttribute('aria-busy','false');
  }
  $('brokers').addEventListener('click',event => {
    const button = event.target.closest('[data-channel]');if (!button) return;
    channel = button.dataset.channel;writeChannelQuery(channel);render();$('brokers').querySelector(`[data-channel="${CSS.escape(channel)}"]`)?.focus();
  });
  async function load(refresh = false) {
    if (loading) return;
    loading = true;$('refresh').disabled = $('retry').disabled = true;$('error').hidden = true;$('progress').hidden = false;
    $('status').textContent = 'Reading your portfolio and updating prices…';$('progress').setAttribute('aria-valuenow','0');$('progress').firstElementChild.style.width = '0%';
    const controller = new AbortController(),timer = setTimeout(() => controller.abort(),180000);
    try {
      const fresh = await globalThis.PortfolioLoader.load({refresh,signal:controller.signal,
        onSnapshot:cached => {payload = cached;render();$('status').textContent = `Snapshot ${formatReportDate(cached.generatedAt) || 'from the previous successful load'} · Loading saved calculations…`;},
        onProgress:p => {const n = Math.max(0,Math.min(6,p.completedStages || 0));$('progress').setAttribute('aria-valuenow',String(n));$('progress').firstElementChild.style.width = `${n/6*100}%`;if (!payload) $('status').textContent = `Preparing briefing · ${p.stage || 'records'}`;},
      });
      payload = fresh;render();$('status').textContent = `Portfolio valued ${formatReportDate(fresh.generatedAt) || 'date unavailable'} · Broker position dates and data coverage shown below`;
    } catch(error) {
      $('error').hidden = false;$('error').querySelector('p').textContent = error.name === 'AbortError' ? 'Briefing loading timed out. Please retry.' : error.message || 'Could not load the briefing.';
      $('status').textContent = payload ? `Update failed · Showing snapshot ${formatReportDate(payload.generatedAt) || 'from the previous load'}` : 'Briefing unavailable · Retry loading.';
      if (!payload) { $('risks').innerHTML = '<p class="empty">Insights are unavailable. Use Retry loading above.</p>'; }
      $('content').setAttribute('aria-busy','false');
    } finally {clearTimeout(timer);loading = false;$('refresh').disabled = $('retry').disabled = false;$('progress').hidden = true;}
  }
  $('refresh').addEventListener('click',() => void load(true));$('retry').addEventListener('click',() => void load());
  void load();
})();
