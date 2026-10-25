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
    if (kind === 'expiry') return `<ul class="obligation-list">${a.upcoming.map(p => `<li><div>${esc(p.underlying)} ${esc(p.right)} × ${esc(p.contracts)}<br><span>${esc(p.settlement)} settlement</span></div><strong>${esc(p.expiry)} · ${p.dte} days</strong></li>`).join('')}</ul>`;
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
    $('headline').textContent = a.findings[0]?.title || (a.holdingsFresh ? 'The full margin picture is not available.' : 'A current account snapshot is needed.');
    $('summary').textContent = a.findings[0]?.body || 'Review the available figures below. Missing broker inputs prevent an overall safety assessment; no warning here is not a confirmation that the account is safe.';
    $('metrics').innerHTML = metric('Margin cushion',money(a.excess,a.metricsCurrency),`Excess liquidity · ${date(a.metricsAsOf)}${a.metricsFresh ? '' : ' · Out of date / unverified'}`)
      + metric('Cash balance',money(a.cash,a.currency),`Account cash · ${date(a.asOf)} · Not available margin`)
      + metric('Put purchase obligation',money(a.grossPutObligation,a.currency),`${a.putLines.length} physical short-put lines · Before hedge offsets`);
    const displayed = a.findings.slice(0,3);
    $('findings').innerHTML = displayed.map((f,index) => `<details class="finding"><summary><span class="rank">0${index+1}</span><div><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p></div></summary><div class="detail">${evidence(a,f.kind)}</div></details>`).join('') || '<div class="finding"><h3>Verify margin coverage with your broker</h3><p>Current records do not establish the broker’s risk status. Check excess liquidity, equity with loan value, and the broker’s stated warning trigger.</p></div>';
    if (a.findings.length > displayed.length) $('findings').innerHTML += `<details class="finding"><summary><h3>${a.findings.length-displayed.length} more item to review</h3></summary>${a.findings.slice(3).map(f => `<div class="detail"><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p>${evidence(a,f.kind)}</div>`).join('')}</details>`;
    if (!a.holdingsFresh) $('findings').innerHTML += '<p class="small">Sync your broker before relying on these holdings. Historical figures remain visible for reference.</p>';
    $('account-table').innerHTML = payload.accounts.map(row => `<tr><td>${esc(row.label)}<small>Holdings ${esc(date(row.asOf))}${row.holdingsFresh ? '' : ' · Out of date / unverified'}</small></td><td>${esc(money(row.cash,row.currency))}</td><td>${esc(money(row.excess,row.metricsCurrency))}<small>${esc(date(row.metricsAsOf))}${row.metricsFresh ? '' : ' · Out of date / unverified'}</small></td><td>${esc(money(row.grossPutObligation,row.currency))}</td><td>${row.status === 'urgent' ? 'Check broker now' : row.status === 'review' ? 'Needs review' : 'Incomplete'}</td></tr>`).join('');
    $('overlap').textContent = payload.overlaps.length ? payload.overlaps.map(p => `${p.underlying} appears in physical short puts across ${p.channels.length} accounts`).join('. ') + '. Shared underlyings may come under pressure together; account cash and margin remain separate.' : 'No shared physical short-put underlyings found in the recorded accounts. This is not a full correlation assessment.';
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
      $('status').textContent = 'Saved broker snapshots · Refresh view reloads saved data. Use Sync brokers for a new broker snapshot.';
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
