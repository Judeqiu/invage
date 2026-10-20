(() => {
  const $ = id => document.getElementById(id), M = globalThis.InsightsV2;
  let payload = null, channel = channelFromQuery(), loading = false;
  if (channel === 'merged') channel = 'all';
  const name = ch => ({all:'All platforms',ibkr:'IBKR',moomoo:'MooMoo',tiger:'Tiger',webull:'Webull',default:'Unassigned'})[ch] || ch;
  const num = n => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US',{maximumFractionDigits:2});
  const amount = (n,c) => n == null || !Number.isFinite(n) || !c ? '—' : money(n,c);
  const signed = (n,c) => n == null || !Number.isFinite(n) || !c ? '—' : signedMoney(n,c);
  const pct = n => n == null ? '—' : `${num(n)}%`;
  const tone = n => n == null ? '' : n > 0 ? 'up' : n < 0 ? 'down' : '';
  const card = (label,value,sub = '',className = '',help = '') => `<div class="metric-card ${className}"><div class="label-eyebrow">${esc(label)}${help ? ` <button type="button" class="help-dot" aria-label="About ${esc(label)}" data-help="${esc(help)}">?</button>` : ''}</div><div class="metric-value">${esc(value)}</div><div class="metric-sub">${esc(sub)}</div></div>`;
  const contract = p => `${name(p.channel)} · ${p.ticker} ${p.side.toUpperCase()} ${p.right.toUpperCase()} ${amount(p.strike,p.nativeCurrency)} · ${p.expiry} ×${num(p.units)}`;
  const messageCard = (label,text,style = 'pattern-card') => `<div class="metric-card ${style}"><div class="label-eyebrow">${esc(label)}</div><p>${esc(text)}</p></div>`;
  function render() {
    const v = M.build(payload,channel);
    if (channel !== 'all' && !v.channels.includes(channel)) {channel = 'all';writeChannelQuery(channel);return render();}
    $('brokers').innerHTML = ['all',...v.channels].map(ch => `<button type="button" class="chip-btn${ch === channel ? ' on' : ''}" aria-pressed="${ch === channel}" data-channel="${esc(ch)}">${esc(name(ch))}</button>`).join('');
    $('eyebrow').textContent = `Daily briefing · ${payload?.generatedAt || 'Snapshot date unavailable'}`;
    $('summary').textContent = !payload?.model?.live ? payload?.message || 'No portfolio records are available yet.' : `${v.options} open option lines (${v.shorts} short, ${v.longs} long) and ${v.equities} equity lots${v.funds ? ", " + v.funds + " fund lots" : ""} across ${name(channel).toLowerCase()}. Recorded cash is ${amount(v.cash,v.ccy)} (${pct(v.cashWeight)} of NAV). Reconciled remaining short-option premium is ${amount(v.premium,v.ccy)}, with ${signed(v.optionPnl,v.ccy)} open option P&L. ${v.highRisk} short-option lines have an estimated Prob. ITM above 60%; ${v.unscored} are unscored.`;
    const unitemized = brokerFundAssets(payload,channel).some(r => r.amount > 0);
    $('metrics').innerHTML = card(unitemized ? 'Itemized NAV' : 'NAV',amount(v.nav,v.ccy),v.ccy || 'Reporting currency unavailable') +
      card('Unrealized P&L',signed(v.totalPnl,v.ccy),'All recorded holdings',tone(v.totalPnl)) +
      card('Cash',amount(v.cash,v.ccy),'Recorded free cash; not buying power') +
      card('Assignment cash',amount(v.obligation,v.ccy),'Gross physical-delivery short-put obligation') + brokerFundAssetsCards(payload,channel);
    const risks = v.risks.slice(0,3).map((p,i) => messageCard(`Risk ${String(i+1).padStart(2,'0')}`,
      `${contract(p)} — ${p.probability == null ? 'Currently in the money; expiry probability unavailable' : 'Estimated Prob. ITM ' + pct(p.probability*100)} with ${num(p.dte)} days left.${p.obligation == null ? '' : ' Gross put assignment cash: ' + amount(p.obligation,v.ccy) + '.'}`,
      `risk-card${p.dte <= 21 ? ' urgent' : ''}`));
    if (v.cashGap > 0) risks.push(messageCard('Cash vs assignment',`Gross short-put purchase obligations of ${amount(v.obligation,v.ccy)} exceed recorded cash of ${amount(v.cash,v.ccy)} by ${amount(v.cashGap,v.ccy)}. Check collateral and funding at each broker; this comparison does not establish available margin.`,'risk-card'));
    if (v.expired) risks.push(messageCard('Past-expiry records',`${v.expired} option lines remain recorded past expiry. Refresh their broker records and verify the outcome; expiration or assignment is not inferred.`,'risk-card'));
    $('risks').innerHTML = risks.join('') || messageCard(v.options ? 'Assessed positions' : 'No option holdings',v.options ? 'No matching elevated-probability or near-expiry ITM risks were identified in the assessed positions. Review the coverage notes below.' : 'No recorded option positions in this broker scope.');
    $('riskCoverage').textContent = `${v.shorts-v.unscored} of ${v.shorts} short-option lines scored · ${v.unscored} unscored${v.risks.length > 3 ? ' · Showing the first 3 of ' + v.risks.length + ' flagged lines' : ''}. Prob. ITM estimates finishing in the money, not the probability of early assignment. ${v.dates.length ? v.dates.map(([ch,date]) => name(ch) + ' as of ' + date).join(' · ') : 'Broker position dates unavailable.'}`;
    $('patterns').innerHTML = messageCard('Expiry profile',`${v.nearLines} of ${v.options} recorded option lines expire in the next 30 days, with ${amount(v.nearPremium,v.ccy)} of reconciled remaining short premium. Past-expiry records are counted separately.`) +
      messageCard('Concentration',v.concentration ? `${v.concentration.ticker} has the largest gross marked exposure: ${amount(v.concentration.value,v.ccy)}, or ${pct(v.concentration.navPct)} of NAV. This adds absolute market values across its holdings; it is not stock-equivalent notional or a normalized portfolio weight.` : 'Concentration cannot be ranked until all holdings in this scope have comparable marks and NAV.');
    $('actions').innerHTML = v.actions.slice(0,3).map((p,i) => `<li><span class="rank">${String(i+1).padStart(2,'0')}</span><div>${esc(contract(p))}<br><strong>${esc(pct(p.capture))}</strong> of gross opening premium retained at the displayed mark. Review closing or rolling costs, liquidity and assignment exposure before deciding.<br><a target="_parent" href="/trades?channel=${encodeURIComponent(p.channel)}">Review ${esc(name(p.channel))} trades →</a></div></li>`).join('') || '<li class="empty">No review candidates meet the 50% retained-premium threshold with reconciled opening cash, a current comparable mark and a recent broker date. This is not a recommendation to hold.</li>';
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
        onSnapshot:cached => {payload = cached;render();$('status').textContent = `Snapshot ${cached.generatedAt || 'from the previous successful load'} · Updating prices…`;},
        onProgress:p => {const n = Math.max(0,Math.min(6,p.completedStages || 0));$('progress').setAttribute('aria-valuenow',String(n));$('progress').firstElementChild.style.width = `${n/6*100}%`;if (!payload) $('status').textContent = `Preparing briefing · ${p.stage || 'records'}`;},
      });
      payload = fresh;render();$('status').textContent = `Portfolio valued ${fresh.generatedAt || 'now'} · Broker position dates and data coverage shown below`;
    } catch(error) {
      $('error').hidden = false;$('error').querySelector('p').textContent = error.name === 'AbortError' ? 'Briefing loading timed out. Please retry.' : error.message || 'Could not load the briefing.';
      $('status').textContent = payload ? `Update failed · Showing snapshot ${payload.generatedAt || 'from the previous load'}` : 'Briefing unavailable · Retry loading.';
      if (!payload) { $('risks').innerHTML = '<p class="empty">Insights are unavailable. Use Retry loading above.</p>'; }
      $('content').setAttribute('aria-busy','false');
    } finally {clearTimeout(timer);loading = false;$('refresh').disabled = $('retry').disabled = false;$('progress').hidden = true;}
  }
  $('refresh').addEventListener('click',() => void load(true));$('retry').addEventListener('click',() => void load());
  void load();
})();
