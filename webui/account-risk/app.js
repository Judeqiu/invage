(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = (value, ccy) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || !ccy) return 'Not available';
    try {return new Intl.NumberFormat('en', {style:'currency',currency:ccy,maximumFractionDigits:0}).format(value);}
    catch {return `${new Intl.NumberFormat('en',{maximumFractionDigits:0}).format(value)} ${ccy}`;}
  };
  const date = value => value ? value.slice(0,10) : 'Not supplied';
  let payload, selected, pending = false, generation = 0;
  function metric(label, value, note) {return `<div><div class="label-eyebrow">${esc(label)}</div><div class="metric-value">${esc(value)}</div><span class="small">${esc(note)}</span></div>`;}
  function renderFunding() {
    const a = payload?.accounts.find(a => a.channel === selected);
    if (!a) return;
    const known = a.metricsFresh && a.excess !== null && a.metricsCurrency;
    $('funding').disabled = !known;
    $('funding-currency').textContent = a.metricsCurrency ? `(${a.metricsCurrency})` : '';
    if (!known) {$('funding-result').textContent = 'A current excess-liquidity snapshot is needed.';return;}
    const amount = $('funding').valueAsNumber;
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) {$('funding-result').textContent = 'Enter an amount from 0 to 1,000,000,000.';return;}
    $('funding-result').textContent = `${money(a.excess,a.metricsCurrency)} → ${money(a.excess+amount,a.metricsCurrency)} illustrative excess liquidity`;
  }
  function evidence(a, kind) {
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
    if (!a) {
      $('overview').hidden = true;document.querySelector('.risk-body').hidden = true;
      $('overlap').textContent = 'No account snapshots yet. Connect a broker in Settings, then sync to start your review.';
      $('account-table').replaceChildren(); $('coverage').innerHTML = '<li>No recorded account data is available.</li>';
      return;
    }
    $('overview').hidden = false;document.querySelector('.risk-body').hidden = false;
    $('severity').textContent = a.status === 'urgent' ? 'Check broker now' : a.status === 'review' ? 'Needs review' : 'Assessment incomplete';
    $('severity').className = 'tag ' + a.status;
    $('as-of').textContent = `${a.label} · Holdings ${date(a.asOf)}${a.holdingsFresh ? '' : ' · Out of date / unverified'}`;
    $('headline').textContent = a.findings[0]?.title || (a.holdingsFresh ? 'No structural alert identified.' : 'Sync to assess this account.');
    $('summary').textContent = a.findings[0]?.action || 'Assessment incomplete: verify live margin and option prices with your broker.';
    const nearest = a.holdingsFresh ? a.expiries[0] : null;
    $('metrics').innerHTML = metric('Excess liquidity',money(a.excess,a.metricsCurrency),`${date(a.metricsAsOf)}${a.metricsFresh ? ' · Broker snapshot' : ' · Unverified / old'}`)
      + metric('Put assignment cash gap',money(a.assignmentCashGap,a.currency),a.holdingsFresh ? 'All puts assigned · Before offsets' : 'Historical / unverified holdings')
      + metric('Next option expiry',nearest ? nearest.dte === 0 ? 'Today' : `${nearest.dte} days` : a.holdingsFresh ? 'None in 14 days' : 'Unverified',nearest ? `${nearest.expiry} · New York calendar` : 'Long + short options');
    const gross = a.grossPutObligation, cash = a.cash;
    const ratio = gross > 0 && cash !== null ? Math.max(0,Math.min(100,cash/gross*100)) : 0;
    $('funding-strip').innerHTML = `<div class="funding-label"><span>Cash <strong>${esc(money(cash,a.currency))}</strong></span><span>Gross put purchases <strong>${esc(money(gross,a.currency))}</strong></span></div>${gross > 0 && cash !== null ? `<div class="funding-track" role="img" aria-label="Recorded cash covers ${Math.round(ratio)} percent of gross put purchases"><span style="width:${ratio}%"></span></div>` : ''}<p class="small">All-assigned illustration · Cash is not margin · Hedge offsets excluded</p>`;
    $('findings').innerHTML = a.findings.map((f,index) => {
      const signal = f.kind === 'assignment' ? money(a.assignmentCashGap,a.currency) + ' gap' : f.kind === 'concentration' ? money(a.concentration[0]?.amount,a.currency) : f.kind === 'margin' ? money(f.priority === 100 ? a.excess : a.buyingPower,a.metricsCurrency) : f.kind === 'expiry' ? a.expiries[0]?.expiry : 'Verify coverage';
      return `<article class="alert-card ${f.priority === 100 ? 'urgent' : 'review'}"><div class="alert-top"><span class="rank">${String(index+1).padStart(2,'0')} / ${f.priority === 100 ? 'Check now' : f.kind === 'expiry' ? 'Deadline' : 'Review'}</span><strong>${esc(signal)}</strong></div><h3>${esc(f.title)}</h3><p class="alert-action">${esc(f.action)}</p><details class="finding"><summary>Evidence &amp; limits</summary><div class="detail"><p>${esc(f.body)}</p>${evidence(a,f.kind)}</div></details></article>`;
    }).join('') || '<div class="empty-alert">No current structural alerts. Live margin and market risks still need verification.</div>';
    $('expiry-watch').innerHTML = !a.holdingsFresh ? '<p class="small">Sync holdings to update settlement deadlines.</p>' : a.expiries.length ? `<div class="table-wrap"><table><thead><tr><th>Contract</th><th>Expiry</th><th>Time left</th></tr></thead><tbody>${a.expiries.map(p => `<tr><td><strong>${esc(p.underlying)} ${esc(p.strike)}${p.right === 'put' ? 'P' : 'C'}</strong><small>${esc(p.side)} × ${esc(p.contracts)} · ${esc(p.settlement || 'Unverified')} settlement</small></td><td>${esc(p.expiry)}</td><td><span class="${p.dte <= 1 ? 'deadline-now' : ''}">${p.dte === 0 ? 'Today' : `${p.dte}d`}</span></td></tr>`).join('')}</tbody></table></div><p class="small">Confirm exercise cutoffs. Protective legs may need separate instructions.</p>` : '<p class="small">No recorded options expire within 14 days.</p>';
    const check = (label, state, known) => `<div><span>${esc(label)}</span><strong class="${known ? '' : 'unknown'}">${esc(state)}</strong></div>`;
    $('checks').innerHTML = check('Holdings',a.holdingsFresh ? 'Snapshot available' : 'Sync needed',a.holdingsFresh)
      + check('Broker margin',a.metricsFresh && a.excess !== null && a.metricsCurrency ? 'Snapshot available' : 'Incomplete',a.metricsFresh && a.excess !== null && a.metricsCurrency)
      + check('Put purchase total',gross !== null ? 'Calculated' : 'Incomplete',gross !== null)
      + check('Live price / IV stress','Not assessed',false)
      + check('Dividend / event risk','Not assessed',false)
      + check('Exit liquidity / spread','Not assessed',false)
      + '<p class="small">No overall safety score. Missing checks can hide material risk.</p>';
    $('account-table').innerHTML = payload.accounts.map(row => `<tr><td>${esc(row.label)}<small>Holdings ${esc(date(row.asOf))}${row.holdingsFresh ? '' : ' · Out of date / unverified'}</small></td><td>${esc(money(row.cash,row.currency))}</td><td>${esc(money(row.excess,row.metricsCurrency))}<small>${esc(date(row.metricsAsOf))}${row.metricsFresh ? '' : ' · Out of date / unverified'}</small></td><td>${esc(money(row.grossPutObligation,row.currency))}</td><td>${row.status === 'urgent' ? 'Check broker now' : row.status === 'review' ? 'Needs review' : 'Incomplete'}</td></tr>`).join('');
    $('overlap').textContent = payload.overlaps.length ? payload.overlaps.map(p => `${p.underlying} appears in physical short puts across ${p.channels.length} accounts`).join('. ') + '. Cash and collateral remain separate.' : 'No shared short-put names recorded. Cross-asset correlation is not assessed.';
    $('coverage').innerHTML = a.coverage.map(note => `<li>${esc(note)}</li>`).join('');
    $('footer').textContent = `Portfolio snapshot prepared ${new Date(payload.calculatedAt).toLocaleString('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'})} · Educational account review`;
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
      $('status').textContent = 'Saved snapshots · Reload does not sync brokers.';
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
