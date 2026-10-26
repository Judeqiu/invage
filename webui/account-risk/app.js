(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = (value, ccy, digits = 0) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || !ccy) return '—';
    try {return new Intl.NumberFormat('en', {style:'currency',currency:ccy,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);}
    catch {return `${new Intl.NumberFormat('en',{maximumFractionDigits:0}).format(value)} ${ccy}`;}
  };
  const date = value => value ? value.slice(0,10) : '—';
  let payload, selected, pending = false, generation = 0;
  const help = (label, text) => `<button class="help-dot" type="button" aria-label="${esc('Explain ' + label)}" data-help="${esc(text)}">?</button>`;
  function metric(label, value, note, explanation, tone = '') {
    return `<div class="risk-metric"><div class="metric-head"><span class="label-eyebrow">${esc(label)}</span>${help(label,explanation)}</div><div class="metric-value ${tone}">${esc(value)}</div><span class="small">${esc(note)}</span></div>`;
  }
  function findingLabel(a, f) {
    if (f.kind === 'margin') return f.priority === 100 ? a.excess < 0 ? 'Margin deficit' : 'Margin exhausted' : 'Buying power';
    if (f.kind === 'assignment') return 'Put funding gap';
    if (f.kind === 'delivery') return 'Call delivery';
    if (f.kind === 'expiry') return a.expiries[0]?.dte === 0 ? 'Expiry today' : a.expiries[0]?.dte === 1 ? 'Expiry tomorrow' : 'Upcoming expiries';
    if (f.kind === 'concentration') return `${a.concentration[0]?.underlying || ''} concentration`;
    return f.kind;
  }
  function renderFunding() {
    const a = payload?.accounts.find(a => a.channel === selected);
    if (!a) return;
    const known = a.metricsFresh && a.excess !== null && a.metricsCurrency;
    $('funding').disabled = !known;
    $('funding-currency').textContent = a.metricsCurrency ? `(${a.metricsCurrency})` : '';
    if (!known) {$('funding-result').textContent = 'A current excess-liquidity snapshot is needed.';return;}
    const amount = $('funding').valueAsNumber;
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) {$('funding-result').textContent = 'Enter an amount from 0 to 1,000,000,000.';return;}
    $('funding-result').textContent = `${money(a.excess,a.metricsCurrency)} → ${money(a.excess+amount,a.metricsCurrency)} illustrative cushion`;
  }
  function evidence(a, kind) {
    if (kind === 'margin' && a.excessCalculated) return `<p>Broker net assets ${esc(money(a.brokerNetAssets,a.metricsCurrency,4))} − maintenance margin ${esc(money(a.maintenanceMargin,a.metricsCurrency,4))} = ${esc(money(a.excess,a.metricsCurrency,2))} (rounded). Snapshot: ${esc(date(a.metricsAsOf))}.</p><p>Calculated from the same broker funds response, not a directly reported excess-liquidity field. Verify the broker’s live risk status and liquidation requirements.</p>`;
    if (kind === 'margin') return `<p>Broker-reported excess liquidity: ${esc(money(a.excess,a.metricsCurrency))}. Buying power: ${esc(money(a.buyingPower,a.metricsCurrency))}. Maintenance margin: ${esc(money(a.maintenanceMargin,a.metricsCurrency))}. Snapshot: ${esc(date(a.metricsAsOf))}.</p><p>Neither cash nor total account value establishes equity with loan value. The broker’s warning threshold and precise trigger are unavailable.</p>`;
    if (kind === 'assignment') return `<p>${esc(money(a.grossPutObligation,a.currency))} gross purchases against ${esc(money(a.cash,a.currency))} recorded cash. Long-option offsets are not deducted; this does not establish that the puts are uncovered.</p><ul class="obligation-list">${a.putLines.map(p => `<li><div>${esc(p.underlying)} ${esc(p.strike)}P × ${esc(p.contracts)}<br><span>${esc(p.expiry)}</span></div><strong>${esc(money(p.obligation,a.currency))}</strong></li>`).join('')}</ul>`;
    if (kind === 'concentration') return a.concentration.map(p => `<p>${esc(p.underlying)} · ${Math.round(p.share*100)}% of gross put obligations · ${esc(money(p.amount,a.currency))}</p><div class="exposure-bar" role="img" aria-label="${esc(p.underlying)}: ${Math.round(p.share*100)} percent of gross put obligations"><div style="width:${Math.max(0,Math.min(100,p.share*100))}%"></div></div>`).join('');
    if (kind === 'delivery') return `<ul class="obligation-list">${a.callDeliveries.map(p => `<li><span>${esc(p.underlying)} · ${esc(p.expiry)}</span><strong>${p.shares === null ? 'Size unavailable' : esc(p.shares.toLocaleString()) + ' shares'}</strong></li>`).join('')}</ul><p>Gross delivery only. Shares and long-option offsets are not verified; this does not establish an uncovered call. An unhedged short call can have unlimited loss.</p>`;
    if (kind === 'expiry') return `<ul class="obligation-list">${a.expiries.map(p => `<li><div>${esc(p.underlying)} ${esc(p.right)} × ${esc(p.contracts)}<br><span>${esc(p.settlement)} settlement</span></div><strong>${esc(p.expiry)} · ${p.dte} days</strong></li>`).join('')}</ul>`;
    return '';
  }
  function render() {
    const a = payload.accounts.find(a => a.channel === selected);
    $('accounts').innerHTML = payload.accounts.map(account => `<button class="chip-btn" type="button" data-channel="${esc(account.channel)}" aria-pressed="${account.channel===selected}">${esc(account.label)}</button>`).join('');
    $('overview').hidden = !a;
    document.querySelector('.risk-body').hidden = !a;
    if (!a) {
      $('overlap').textContent = 'No account snapshots';
      $('account-table').replaceChildren();
      $('coverage').innerHTML = '<li>Connect and sync a broker to begin.</li>';
      return;
    }
    const top = a.findings[0];
    const marginHelp = a.excessCalculated
      ? `Calculated from the same broker funds response: net assets ${money(a.brokerNetAssets,a.metricsCurrency,4)} minus maintenance margin ${money(a.maintenanceMargin,a.metricsCurrency,4)}. Snapshot ${date(a.metricsAsOf)}. Verify the broker’s live margin status.`
      : a.excess === null && a.brokerId === 'ibkr'
        ? 'IBKR Flex reports do not supply excess liquidity or maintenance margin. A margin report or authenticated account-summary API is needed. Cash and portfolio NAV cannot establish margin capacity.'
        : `Broker-reported excess liquidity, in ${a.metricsCurrency || 'the broker currency'}. Snapshot ${date(a.metricsAsOf)}. Cash is not available margin. Verify live margin requirements with the broker.`;
    $('severity').textContent = a.status === 'urgent' ? 'Critical' : a.status === 'review' ? 'Review' : 'Incomplete';
    $('severity').className = 'tag ' + a.status;
    $('as-of').textContent = `${a.label} · ${date(a.asOf)}${a.holdingsFresh ? '' : ' · Outdated'}`;
    $('headline').textContent = top ? findingLabel(a,top) : a.holdingsFresh ? 'Assessment incomplete' : 'Snapshot outdated';
    $('headline-help').innerHTML = help('account assessment', top ? `${top.body} ${top.action}` : 'No current structural alert is identified. Live margin and market risks still need verification. Sync outdated holdings before relying on this assessment.');
    const nearest = a.holdingsFresh ? a.expiries[0] : null;
    $('metrics').innerHTML = metric('Excess liquidity',money(a.excess,a.metricsCurrency,2),`${a.excessCalculated ? 'Calculated' : a.excess === null ? 'Unavailable' : 'Reported'} · ${date(a.metricsAsOf)}${a.metricsFresh ? '' : ' · Unverified'}`,marginHelp,a.metricsFresh && a.excess < 0 ? 'negative' : '')
      + metric('Put funding gap',money(a.assignmentCashGap,a.currency),'Gross · Before offsets','All-assigned scenario: gross physical short-put purchases minus recorded cash, floored at zero. Hedge offsets are excluded. This is not a margin requirement or loss forecast.',a.holdingsFresh && a.assignmentCashGap > 0 ? 'attention' : '')
      + metric('Next expiry',nearest ? nearest.dte === 0 ? 'Today' : `${nearest.dte}d` : a.holdingsFresh ? '—' : 'Unverified',nearest ? nearest.expiry : '14-day window','Nearest recorded long or short option expiry in the next 14 calendar days. Uses the New York date. Confirm the product’s last trading time and broker exercise cutoff.');
    const gross = a.grossPutObligation, cash = a.cash;
    const ratio = gross > 0 && cash !== null ? Math.max(0,Math.min(100,cash/gross*100)) : 0;
    $('funding-strip').innerHTML = `<div class="funding-label"><span>Cash <strong>${esc(money(cash,a.currency))}</strong></span><span>Put obligations <strong>${esc(money(gross,a.currency))}</strong>${help('put obligations','Gross physical short-put purchases if every recorded put is assigned. Strike × multiplier × contracts. Excludes hedge offsets; this is neither maximum loss nor required margin. Cash and collateral remain account-specific.')}</span></div>${gross > 0 && cash !== null ? `<div class="funding-track" role="img" aria-label="Recorded cash covers ${Math.round(ratio)} percent of gross put purchases"><span style="width:${ratio}%"></span></div>` : ''}`;
    $('findings').innerHTML = a.findings.map((f,index) => {
      const label = findingLabel(a,f);
      const signal = f.kind === 'assignment' ? money(a.assignmentCashGap,a.currency) : f.kind === 'concentration' ? `${Math.round(a.concentration[0].share*100)}%` : f.kind === 'margin' ? money(f.priority === 100 ? a.excess : a.buyingPower,a.metricsCurrency,2) : f.kind === 'expiry' ? a.expiries[0]?.expiry : `${a.callDeliveries.length} lines`;
      return `<article class="alert-card ${f.priority === 100 ? 'urgent' : 'review'}"><div class="alert-row"><span class="rank">${String(index+1).padStart(2,'0')}</span><h3>${esc(label)}</h3><strong class="alert-value">${esc(signal)}</strong>${help(label,`${f.body} ${f.action}`)}</div><details class="finding"><summary>Details</summary><div class="detail">${evidence(a,f.kind)}</div></details></article>`;
    }).join('') || `<div class="empty-alert">No structural alerts ${help('structural alerts','No alert in the available snapshot is not confirmation of account safety. Review the unassessed risks in Coverage.')}</div>`;
    $('expiry-watch').innerHTML = !a.holdingsFresh ? '<p class="small">Snapshot outdated</p>' : a.expiries.length ? `<div class="table-wrap"><table><thead><tr><th>Contract</th><th>Expiry</th><th>Due</th></tr></thead><tbody>${a.expiries.map(p => `<tr><td><strong>${esc(p.underlying)} ${esc(p.strike)}${p.right === 'put' ? 'P' : 'C'}</strong><small>${esc(p.side)} × ${esc(p.contracts)} · ${esc(p.settlement || 'Unverified')}</small></td><td>${esc(p.expiry)}</td><td><span class="${p.dte <= 1 ? 'deadline-now' : ''}">${p.dte === 0 ? 'Today' : `${p.dte}d`}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="small">No expiries in 14 days</p>';
    const check = (label, state, known) => `<div><span>${esc(label)}</span><strong class="${known ? '' : 'unknown'}">${esc(state)}</strong></div>`;
    $('checks').innerHTML = check('Holdings',a.holdingsFresh ? 'Snapshot' : 'Outdated',a.holdingsFresh)
      + check('Margin',a.metricsFresh && a.excess !== null && a.metricsCurrency ? a.excessCalculated ? 'Calculated' : 'Reported' : 'Unavailable',a.metricsFresh && a.excess !== null && a.metricsCurrency)
      + check('Put obligations',gross !== null ? 'Calculated' : 'Incomplete',gross !== null)
      + check('Price / IV stress','Not assessed',false)
      + check('Events / dividends','Not assessed',false)
      + check('Exit liquidity','Not assessed',false);
    $('account-table').innerHTML = payload.accounts.map(row => `<tr><td>${esc(row.label)}<small>${esc(date(row.asOf))}${row.holdingsFresh ? '' : ' · Outdated'}</small></td><td>${esc(money(row.cash,row.currency))}</td><td>${esc(money(row.excess,row.metricsCurrency,2))}<small>${esc(date(row.metricsAsOf))}${row.excessCalculated ? ' · Calculated' : ''}${row.metricsFresh ? '' : ' · Unverified'}</small></td><td>${esc(money(row.grossPutObligation,row.currency))}</td><td>${row.status === 'urgent' ? 'Critical' : row.status === 'review' ? 'Review' : 'Incomplete'}</td></tr>`).join('');
    $('overlap').innerHTML = `${payload.overlaps.length ? payload.overlaps.map(p => `${esc(p.underlying)} · ${p.channels.length} accounts`).join(' / ') : 'No shared put names'} ${help('shared exposure','Shared physical short-put underlyings across accounts. Different strikes and expiries can share underlying exposure. Account cash and collateral remain separate. This is not a full portfolio correlation assessment.')}`;
    $('coverage').innerHTML = a.coverage.map(note => `<li>${esc(note)}</li>`).join('');
    $('footer').textContent = `Snapshot ${new Date(payload.calculatedAt).toLocaleString('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'})}`;
    renderFunding();
  }
  async function load() {
    if (pending) return;pending = true;const current = ++generation;
    $('refresh').disabled = true; $('retry').disabled = true;
    // Never retain another session's or a disabled page's financial snapshot.
    $('content').hidden = true; $('disabled').hidden = true; $('failed').hidden = true;
    $('status').textContent = 'Reading your account snapshots…';
    try {
      const response = await fetch('/api/domain/invage/account-risk',{credentials:'include',cache:'no-store'});
      const body = await response.json().catch(() => ({}));
      if (current !== generation) return;
      if (response.status === 403 && body.error === 'page_disabled') {payload=null;$('disabled').hidden=false;$('status').textContent='';return;}
      if (!response.ok) throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : body.message || 'Could not load account data. Please retry.');
      payload = body; selected = body.accounts.some(a => a.channel===selected) ? selected : body.accounts[0]?.channel;
      render(); $('content').hidden=false;
      $('status').textContent = '';
    } catch (error) {payload=null;$('failed').hidden=false;$('failure-copy').textContent=error.message;$('status').textContent='';}
    finally {pending=false;$('refresh').disabled=false;$('retry').disabled=false;}
  }
  $('accounts').addEventListener('click', event => {const button=event.target.closest('[data-channel]');if (!button) return;selected=button.dataset.channel;$('funding').value='0';render();});
  $('funding').addEventListener('input',renderFunding);$('refresh').addEventListener('click',load);$('retry').addEventListener('click',load);
  window.addEventListener('pageshow', event => {if(event.persisted) void load();});
  // Recheck preference after a change in another tab before revealing the existing snapshot.
  document.addEventListener('visibilitychange', () => {if(document.hidden) $('content').hidden=true;else void load();});
  void load();
})();
