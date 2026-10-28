(() => {
  const $ = id => document.getElementById(id), M = globalThis.TradesV2;
  const state = { open:null, history:null, view:'open', busy:false, channel:channelFromQuery(), strategy:'all', status:'all', collapsedMonths:new Set() };
  if (state.channel === 'merged') state.channel = 'all';
  const name = ch => ({ all:'All platforms', ibkr:'IBKR', moomoo:'moomoo', tiger:'Tiger', webull:'Webull', default:'Unassigned' })[ch] || ch;
  const num = v => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US',{ maximumFractionDigits:4 });
  const amt = (v, c) => v == null || !c || !Number.isFinite(Number(v)) ? '—' : money(Number(v),c);
  const pct = v => v == null ? '—' : `${v.toFixed(2)}%`;
  const tone = v => v == null ? '' : Number(v) > 0 ? 'up' : Number(v) < 0 ? 'down' : '';
  const badge = (s, c = '') => `<span class="journal-badge ${c}">${esc(s)}</span>`;
  const help = (label,text) => ` <button class="help-dot" type="button" aria-label="About ${esc(label)}" data-help="${esc(text)}">?</button>`;
  const dateId = date => date ? `${date.slice(8,10)}${date.slice(5,7)}${date.slice(2,4)}` : 'unknown';
  const labelId = r => `${r.underlying}-${r.right === 'put' ? 'P' : 'C'}${num(r.strike)}-${dateId(r.entryDate)}/${dateId(r.expiry)}-${({ibkr:'IB',moomoo:'MM',tiger:'TB',webull:'WB'})[r.channel] || name(r.channel)}`;
  const rowDate = r => formatReportDate(r.entryDate);
  const dataRows = () => state.view === 'open' ? state.open?.rows || [] : (state.history?.rows || []).filter(r => !M.isOpen(r));
  function selectOptions(id, values, title) {
    const value = $(id).value;
    $(id).innerHTML = `<option value="all">${esc(title)}</option>${values.map(v => `<option value="${esc(v)}">${esc(v === 'unknown' ? 'Unknown currency' : v)}</option>`).join('')}`;
    $(id).value = values.includes(value) ? value : 'all';
  }
  function filters() {
    return { channel:state.channel, strategy:state.view === 'open' ? state.strategy : 'all', status:state.view === 'history' ? state.status : 'all',
      ...Object.fromEntries(['ticker','right','year','month','currency'].map(id => [id,$(id).value])) };
  }
  function controls() {
    const rows = dataRows(), unique = key => [...new Set(rows.map(r => r[key]))].sort();
    selectOptions('ticker', unique('underlying'), 'All tickers');
    selectOptions('year', [...new Set(rows.flatMap(r => (r.entryDate || r.lastTrade) ? [(r.entryDate || r.lastTrade).slice(0,4)] : []))].sort().reverse(), 'All years');
    selectOptions('currency', [...new Set(rows.map(r => r.currency || 'unknown'))].sort(), 'All currencies');
    const months = Array.from({length:12},(_,i) => String(i+1).padStart(2,'0'));
    selectOptions('month', months, 'All months');
    const channels = [...new Set([...(state.open?.rows || []), ...(state.history?.rows || [])].map(r => r.channel))].sort();
    if (state.channel !== 'all' && !channels.includes(state.channel)) state.channel = 'all';
    $('brokerFilters').innerHTML = ['all',...channels].map(ch => `<button type="button" class="chip-btn${ch === state.channel ? ' on' : ''}" aria-pressed="${ch === state.channel}" data-channel="${esc(ch)}">${esc(name(ch))}</button>`).join('');
    const options = state.view === 'open' ? ['all',...new Set(rows.map(M.strategies))] : ['all','Rolled','Closed','Expired / assigned','Needs review'];
    if (state.view === 'open' && !options.includes(state.strategy)) state.strategy = 'all';
    const selected = state.view === 'open' ? state.strategy : state.status;
    $('strategyFilters').setAttribute('aria-label', state.view === 'open' ? 'Strategy filter' : 'History status filter');
    $('strategyFilters').innerHTML = options.map(v => `<button type="button" class="chip-btn${v === selected ? ' on' : ''}" aria-pressed="${v === selected}" data-choice="${esc(v)}">${esc(v === 'all' ? 'All' : v)}</button>`).join('');
    $('openTab').textContent = `Open book${state.open ? ' · ' + state.open.rows.length : ''}`;
    $('historyTab').textContent = `History${state.history ? ' · ' + state.history.rows.filter(r => !M.isOpen(r)).length : ''}`;
    for (const view of ['open','history']) { $(view+'Tab').classList.toggle('on',state.view === view); $(view+'Tab').setAttribute('aria-pressed',String(state.view === view)); }
    $('journalTitle').textContent = state.view === 'open' ? 'Every open contract, journaled.' : 'Every outcome, with evidence.';
    $('description').textContent = state.view === 'open' ? 'Open option contracts across your brokers. Select a row for fills, broker facts and your thesis.' : 'Completed contracts and unresolved history, built from imported executions and explicit broker events. A disappearing position does not prove assignment.';
    $('basis').textContent = state.view === 'open'
      ? 'Premium is reconciled opening cash for the remaining open contracts, before fees. Returns % = premium ÷ strike notional; it is not annualized or a return on collateral. Entry dates are confirmed from fills; missing evidence remains unavailable.'
      : 'Realised P&L is shown only for complete matching fills or supported settlement evidence. “Before fees” identifies missing commissions. Assignment may move premium into stock basis. Rolls require verified broker order or execution links. Native currencies are never combined.';
  }
  function openRow(r, balances) {
    return `<tr data-row="${esc(r.id)}"><td>${esc(rowDate(r))}${r.entryDate && r.entryThrough !== r.entryDate ? '<small>Multiple opening dates</small>' : ''}</td><td><button type="button" class="row-link mono" data-detail="${esc(r.id)}" title="${esc(r.optionId)}">${esc(labelId(r))}</button></td><td><strong class="ticker-name" title="${esc(r.underlying)}">${esc(r.underlying)}</strong></td><td>${badge(M.strategies(r),r.right)}</td><td>${esc(amt(r.strike,r.currency))}</td><td>${esc(formatReportDate(r.expiry))}</td><td>${esc(num(r.contracts))}</td><td class="${tone(r.premium)}">${esc(amt(r.premium,r.currency))}</td><td>${esc(pct(r.returnsPct))}</td><td>${esc(amt(balances.get(r.id),r.currency))}</td><td>${esc(name(r.channel))}<span class="broker-date help-dot" tabindex="0" data-help="${esc(r.brokerDate ? 'As of ' + formatReportDate(r.brokerDate) : 'Position date unavailable')}" aria-label="Broker position date">ⓘ</span></td></tr>`;
  }
  function historyRow(r) {
    return `<tr data-row="${esc(r.id)}"><td><button type="button" class="row-link" data-detail="${esc(r.id)}">${esc(`${r.underlying} ${formatReportDate(r.expiry)} ${num(r.strike)} ${r.right.toUpperCase()}`)}</button><small>${esc(M.strategies(r))}</small></td><td>${badge(r.rolled ? 'Rolled' : r.status, /review|Incomplete|Unverified|conflict|observed/i.test(r.status) ? 'warning' : '')}</td><td>${esc(rowDate(r))}${!r.entryDate && r.observedSince ? `<small>First seen ${esc(formatReportDate(r.observedSince))}</small>` : ''}</td><td>${esc(formatReportDate(r.lastTrade))}</td><td>${esc(num(r.contracts))}</td><td class="${tone(r.premium)}">${esc(amt(r.premium,r.currency))}</td><td>${esc(amt(r.paidToClose,r.currency))}</td><td class="${tone(r.realizedPnl)}">${esc(amt(r.realizedPnl,r.currency))}${r.realizedPnl !== null ? `<small>${r.feeBasis === 'broker' ? 'Broker reported · fee basis unspecified' : r.feeBasis === 'gross' ? 'Before fees · incomplete commissions' : 'After reported fees'}</small>` : ''}</td><td>${esc(name(r.channel))}</td></tr>`;
  }
  function render() {
    controls();
    const selected = filters(), rows = M.filter(dataRows(),selected);
    // Calendar filters only change visibility; keep earlier opening cash in the running balance.
    const balanceRows = M.filter(dataRows(),{...selected,year:'all',month:'all'});
    const currencies = [...new Set(balanceRows.map(r => r.currency))];
    const balances = M.cashBalances(balanceRows,0);
    const columns = state.view === 'open' ? M.openColumns : M.historyColumns;
    const tips = { ID:'Application-owned option-book ID, scoped to broker channel, account and contract terms. It stays the same across partial fills and repeated trades. Each execution has its own immutable system ID in details.',
      'Returns %':'Opening premium before fees divided by strike × remaining contracts × contract multiplier, for short options. Not annualized, collateral return, or realized P&L.',
      'Net cash':'Cumulative dated opening premiums starting at zero in the selected broker, strategy, ticker, right and currency scope, before fees. Year/month filters and collapsed months retain earlier cash carry. A single native currency is required. Same-day rows use stable ID order, not execution time. Missing cash or multiple opening dates make subsequent balances unavailable.',
      'Premium in':'Signed opening option cash before fees. Long option purchases are negative. Snapshot cost is never substituted for missing fills.' };
    let body = '';
    if (state.view === 'history') body = `<tbody>${rows.map(historyRow).join('')}</tbody>`;
    else for (const year of M.groups(rows)) {
      const count = n => `${n} ${n === 1 ? 'entry' : 'entries'}`;
      body += `<tbody class="year-group"><tr class="group"><th colspan="11" scope="rowgroup"><span>${esc(year.year === 'Unknown' ? 'Entry date unavailable' : year.year)} <span class="group-count">· ${count(year.count)}</span></span></th></tr></tbody>`;
      for (const group of year.months) {
        if (group.month === 'Unknown') {body += `<tbody aria-label="Entries with no confirmed opening date">${group.entries.map(r => openRow(r,balances)).join('')}</tbody>`;continue;}
        const title = new Date(group.month+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'short',timeZone:'UTC'}).toUpperCase()+'-'+year.year;
        const expanded = !state.collapsedMonths.has(group.month), bodyId = 'month-entries-'+group.month;
        const totals = M.monthTotals(group.entries,balances);
        body += `<tbody class="month-summary-group" aria-label="${esc(title)} totals">` + totals.map((total,i) => {
          const currency = total.currency === 'unknown' ? '' : total.currency;
          const heading = i === 0 ? `<button type="button" class="month-toggle" data-month-toggle="${esc(group.month)}" aria-expanded="${expanded}" aria-controls="${bodyId}"><span class="month-chevron" aria-hidden="true">${expanded ? '▾' : '▸'}</span>${esc(title)} <span class="group-count">· ${count(group.entries.length)}</span></button>` : '<span class="currency-label">Currency subtotal</span>';
          return `<tr class="month-summary"><th colspan="6" scope="rowgroup">${heading}${totals.length > 1 || !currency ? `<span class="currency-label">${esc(total.currency)}</span>` : ''}</th><td title="Total contracts · ${esc(total.currency)}">${num(total.contracts)}</td><td title="Total premium before fees · ${esc(total.currency)}">${esc(total.missing ? '—' : amt(total.premium,currency))}${total.missing ? `<small>${total.missing} unavailable</small>` : ''}</td><td title="Blended returns: premium divided by strike × contracts × multiplier">${esc(pct(total.returnsPct))}</td><td title="Final net cash for this month, before fees">${esc(amt(total.netCash,currency))}</td><td></td></tr>`;
        }).join('') + '</tbody>';
        body += `<tbody id="${bodyId}" data-month-entries="${esc(group.month)}" aria-label="${esc(title)} entries"${expanded ? '' : ' hidden'}>${group.entries.map(r => openRow(r,balances)).join('')}</tbody>`;
      }
    }
    const loaded = state.view === 'open' ? state.open : state.history;
    if (!rows.length) body = `<tbody><tr><td class="empty" colspan="${columns.length}">${!loaded ? 'Loading journal records…' : dataRows().length ? 'No entries match these filters.' : state.view === 'open' ? 'No open options on the books.' : 'No completed contracts or unresolved history recorded yet.'}</td></tr></tbody>`;
    $('journalTable').innerHTML = `<table class="journal-table"><caption class="sr-only">${state.view === 'open' ? 'Open option book grouped by opening year and month' : 'Option history'} in each broker’s native currency</caption><thead><tr>${columns.map(c => `<th scope="col"><span class="col-label">${esc(c)}</span>${tips[c] ? help(c,tips[c]) : ''}</th>`).join('')}</tr></thead>${body}</table>`;
    $('journalTable').setAttribute('aria-busy',String(!loaded));
    markSelection();
    $('entryCount').textContent = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`;
    const useSavedTotals = [selected.year, selected.month, selected.ticker, selected.right, selected.currency, selected.strategy, selected.status].every(value => !value || value === 'all');
    const summary = useSavedTotals ? loaded?.aggregates?.[state.channel]?.totals : M.totals(rows);
    $('totals').innerHTML = (summary || []).map(t => `<div><span class="label-eyebrow">${esc(t.currency)}</span><br>Contracts <strong>${num(t.contracts)}</strong> · Opening premium <strong>${esc(t.missing || t.currency === 'unknown' ? '—' : amt(t.premium,t.currency))}</strong>${t.missing ? `<br>${t.missing} rows lack opening cash; known subtotal ${esc(amt(t.premium,t.currency === 'unknown' ? '' : t.currency))}` : ''}${state.view === 'history' ? `<br>Realised P&L <strong>${esc(t.missingPnl || t.mixedBasis || t.currency === 'unknown' ? '—' : amt(t.pnl,t.currency))}</strong>${t.mixedBasis ? `<br>After-fee subtotal ${esc(amt(t.netSubtotal,t.currency))}<br>Before-fee subtotal ${esc(amt(t.grossSubtotal,t.currency))}${t.brokerPnl ? '<br>Broker-reported subtotal ' + esc(amt(t.brokerSubtotal,t.currency)) : ''}` : t.grossPnl ? ' · Before fees' : t.brokerPnl ? ' · Broker reported' : ''}${t.missingPnl ? `<br>${t.missingPnl} unresolved${t.mixedBasis ? '' : '; known subtotal ' + esc(amt(t.pnl,t.currency === 'unknown' ? '' : t.currency))}` : ''}` : ''}</div>`).join('');
    const gaps = state.history?.gaps || [];
    $('availability').hidden = !gaps.length;
    $('availability').querySelector('ul').innerHTML = [...new Set(gaps.map(g => `${name(g.channel)}: ${g.reason}`))].map(g => `<li>${esc(g)}</li>`).join('');
  }
  let opener = null, detailOptionId = null, detailRevision = null, selectedRowId = null;
  const drafts = new Map();
  function rememberDraft() {
    if (detailOptionId && $('thesis')) drafts.set(detailOptionId,$('thesis').value);
  }
  function markSelection() {
    for (const row of $('journalTable').querySelectorAll('[data-row]')) {
      const selected = $('tradeDetail').open && row.dataset.row === selectedRowId;
      row.toggleAttribute('data-selected',selected);
      const button = row.querySelector('[data-detail]');
      button.setAttribute('aria-controls','tradeDetail');
      button.setAttribute('aria-expanded',String(selected));
    }
  }
  function panelMode(mode) {
    $('tradeDetail').dataset.mode = mode;
    $('detailBody').hidden = mode === 'minimized';
    document.body.classList.toggle('detail-open',$('tradeDetail').open && mode === 'side');
    const minimized = mode === 'minimized', maximized = mode === 'maximized';
    $('minimizeDetail').setAttribute('aria-expanded',String(!minimized));
    $('minimizeDetail').setAttribute('aria-label',minimized ? 'Restore trade details' : 'Minimize trade details');
    $('minimizeDetail').title = minimized ? 'Restore' : 'Minimize';
    $('minimizeDetail').firstElementChild.textContent = minimized ? '+' : '−';
    $('maximizeDetail').setAttribute('aria-pressed',String(maximized));
    $('maximizeDetail').setAttribute('aria-label',maximized ? 'Restore side panel' : 'Maximize trade details');
    $('maximizeDetail').title = maximized ? 'Restore side panel' : 'Maximize';
  }
  function showDetail(id, trigger) {
    const r = [...(state.open?.rows || []),...(state.history?.rows || [])].find(r => r.id === id); if (!r) return;
    rememberDraft();
    selectedRowId = id;
    opener = trigger; detailOptionId = r.optionId; detailRevision = state[state.view].revision;
    $('detailTitle').textContent = `${r.underlying} · ${M.strategies(r)}`;
    $('detailSubtitle').textContent = `${formatReportDate(r.expiry)} · ${name(r.channel)} · ${r.currency || 'Unknown currency'}`;
    const fact = (k,v) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
    $('detailBody').innerHTML = `<p class="detail-id">Option ID · ${esc(r.optionId)}</p><p>This option-book ID belongs to ${esc(name(r.channel))}${r.accountId ? ', account ' + esc(r.accountId) : ' · account identity unavailable'}. Each fill below retains both its broker ID and its own system ID. Reopened trades share the option-book ID and have different execution IDs.</p><dl class="detail-grid">${fact('Strike',amt(r.strike,r.currency))}${fact('Contracts / multiplier',`${num(r.contracts)} × ${r.multiplier == null ? 'Unknown' : num(r.multiplier)}`)}${fact('Status',r.rolled ? 'Rolled · confirmed links' : r.status)}${fact('Opening date',r.entryDate ? r.entryDate === r.entryThrough ? formatReportDate(r.entryDate) : `${formatReportDate(r.entryDate)} to ${formatReportDate(r.entryThrough)}` : 'Unavailable')}${fact('Opening premium · before fees',amt(r.premium,r.currency))}${fact('Opening cash · after fees',amt(r.netCash,r.currency))}${fact('Broker position date',formatReportDate(r.brokerDate))}${fact('First observed',formatReportDate(r.observedSince))}${fact('Currency',r.currency || 'Unknown')}</dl>${r.notes.length ? `<ul>${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}<h3>Source executions · ${r.executions.length}</h3>${r.executions.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Source executions"><table><thead><tr><th>Executed · broker clock</th><th>Action</th><th>Contracts</th><th>Gross cash</th><th>Fees / rebate</th><th>Broker execution ID</th><th>System execution ID</th><th>Broker contract ID</th></tr></thead><tbody>${r.executions.map(e => `<tr><td>${esc(formatReportDate(e.executed_at) + ' ' + e.executed_at.slice(11))}</td><td>${esc(e.side+' to '+e.effect)}</td><td>${esc(e.contracts)}</td><td>${esc(e.gross_premium)} ${esc(e.currency)}</td><td>${esc(e.commission ?? 'Unknown')}</td><td>${esc(e.execution_id)}</td><td>${esc(e.id)}</td><td>${esc(e.contract_id)}</td></tr>`).join('')}</tbody></table></div><p>Source fills show their full original quantities. Open-book premium allocates only the contracts that remain open.</p>` : r.sourceExecutions?.length ? '' : '<p>No fully reconciled opening fills are available for this record.</p>'}${r.orderFees?.length ? `<h3>Reported order fees</h3><p>Each total covers the entire order, including any other fills or option legs. It may also appear on another trade. Allocated execution fees above are included in this total. Unknown leg fees remain unknown.</p><ul>${r.orderFees.map(f => `<li>Order ${esc(f.orderId)} · Total ${esc(f.total)} ${esc(f.currency ?? 'currency unknown')}${f.items.length ? `<ul>${f.items.map(i => `<li>${esc(i.type)}: ${esc(i.amount)} ${esc(f.currency ?? 'currency unknown')}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>` : ''}${r.events.length ? `<h3>Explicit lifecycle events</h3><ul>${r.events.map(e => `<li>${esc(formatReportDate(e.date))} · ${esc(e.kind.replaceAll('_',' '))} · ${esc(e.contracts)} contracts · Broker event ${esc(e.id)}${e.broker_realized_pl !== undefined ? ' · Reported option P&L ' + esc(e.broker_realized_pl) + ' ' + esc(e.currency) : ''}</li>`).join('')}</ul>` : ''}`;
    if (r.sourceExecutions?.length) $('detailBody').insertAdjacentHTML('beforeend', `<h3>Retained broker fills · ${r.sourceExecutions.length}</h3><div class="table-scroll"><table><thead><tr><th>Executed · broker clock</th><th>Action</th><th>Contracts</th><th>Unit price</th><th>Multiplier</th><th>Gross cash</th><th>Fees / rebate</th><th>Broker execution ID</th><th>Broker contract ID</th></tr></thead><tbody>${r.sourceExecutions.map(e => `<tr><td>${esc(formatReportDate(e.executed_at) + ' ' + e.executed_at.slice(11))}</td><td>${esc(e.side + ' to ' + e.effect)}</td><td>${esc(e.quantity)}</td><td>${esc(e.price ?? 'Unknown')}</td><td>${esc(e.multiplier ?? 'Unknown')}</td><td>${esc(e.gross_cash ?? 'Unknown')} ${esc(e.currency ?? '')}</td><td>${esc(e.fee_cash ?? 'Unknown')}</td><td>${esc(e.id)}</td><td>${esc(e.native_symbol)}</td></tr>`).join('')}</tbody></table></div><p>Notes become available when this fill can be linked to a verified option-book identity.</p>`);
    else $('detailBody').insertAdjacentHTML('beforeend',`<div class="note-editor"><label for="thesis">Option book thesis</label><p>Saved to this option-book ID across its fills and reopenings at this broker account.</p><textarea id="thesis" maxlength="8000" placeholder="Why this contract? Entry thesis, planned exit, and what would change your view…">${esc(drafts.get(r.optionId) ?? r.thesis ?? '')}</textarea><button type="button" id="saveNote" class="chip-btn">Save note</button><p id="noteStatus" role="status" aria-live="polite">${r.noteUpdatedAt ? 'Last saved ' + esc(formatReportDate(r.noteUpdatedAt)) : 'Private to your account'}</p></div>`);
    if (!$('tradeDetail').open) $('tradeDetail').show();
    panelMode($('tradeDetail').dataset.mode === 'maximized' ? 'maximized' : 'side');
    markSelection();
    $('detailBody').scrollTop = 0;
    $('tradeDetail').focus({preventScroll:true});
  }
  $('detailBody').addEventListener('click',async event => {
    if (!event.target.closest('#saveNote')) return;
    const button = $('saveNote'), text = $('thesis').value, optionId = detailOptionId, revision = detailRevision;
    button.disabled = true; $('noteStatus').textContent = 'Saving note…';
    try {
      const result = await readJson(await fetch('/api/domain/invage/trades-v2/' + encodeURIComponent(optionId) + '/note',{
        method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text,revision}),
      }));
      for (const data of [state.open,state.history]) if (data?.revision === revision) data.revision = result.revision;
      if (detailOptionId === optionId) detailRevision = result.revision;
      for (const row of [...state.open.rows,...(state.history?.rows || [])]) if (row.optionId === optionId) {row.thesis = result.text;row.noteUpdatedAt = result.updatedAt;}
      if (detailOptionId === optionId && $('thesis').value === text) $('noteStatus').textContent = 'Note saved.';
    } catch(error) {if (detailOptionId === optionId) $('noteStatus').textContent = error.message || 'Could not save. Your draft is still shown.';}
    finally {button.disabled = false;}
  });
  $('minimizeDetail').addEventListener('click',() => panelMode($('tradeDetail').dataset.mode === 'minimized' ? 'side' : 'minimized'));
  $('maximizeDetail').addEventListener('click',() => panelMode($('tradeDetail').dataset.mode === 'maximized' ? 'side' : 'maximized'));
  $('closeDetail').addEventListener('click',closeDetail);
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape' && $('tradeDetail').open && !event.defaultPrevented) {
      event.preventDefault(); closeDetail();
    }
  });
  function closeDetail() {
    $('tradeDetail').close();
    rememberDraft(); document.body.classList.remove('detail-open'); markSelection();
    const target = opener?.isConnected ? opener : [...$('journalTable').querySelectorAll('[data-detail]')].find(b => b.dataset.detail === selectedRowId);
    target?.focus({preventScroll:true});
  }
  $('journalTable').addEventListener('click',event => {
    const toggle = event.target.closest('[data-month-toggle]');
    if (toggle) {
      const month = toggle.dataset.monthToggle, expanded = state.collapsedMonths.has(month);
      if (expanded) state.collapsedMonths.delete(month);else state.collapsedMonths.add(month);
      $(toggle.getAttribute('aria-controls')).hidden = !expanded;
      toggle.setAttribute('aria-expanded',String(expanded));toggle.querySelector('.month-chevron').textContent = expanded ? '▾' : '▸';
      return;
    }
    if (event.target.closest('.help-dot')) return;
    const row = event.target.closest('[data-row]');
    if (row) showDetail(row.dataset.row,row.querySelector('[data-detail]'));
  });
  $('brokerFilters').addEventListener('click',event => {
    const b = event.target.closest('[data-channel]'); if (!b) return;
    state.channel = b.dataset.channel; writeChannelQuery(state.channel); render();
    $('brokerFilters').querySelector(`[data-channel="${CSS.escape(state.channel)}"]`)?.focus();
  });
  $('strategyFilters').addEventListener('click',event => {
    const b = event.target.closest('[data-choice]'); if (!b) return;
    state[state.view === 'open' ? 'strategy' : 'status'] = b.dataset.choice; render();
    $('strategyFilters').querySelector(`[data-choice="${CSS.escape(b.dataset.choice)}"]`)?.focus();
  });
  for (const id of ['ticker','right','year','month','currency']) $(id).addEventListener('change',render);
  $('clear').addEventListener('click',() => {
    state.channel = state.strategy = state.status = 'all'; writeChannelQuery('all');
    for (const id of ['ticker','right','year','month','currency']) $(id).value = 'all';
    render();
  });
  async function get(path) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),120000);
    try { const res = await fetch('/api/domain/invage/'+path,{ signal:controller.signal,cache:'no-store',credentials:'same-origin' }); return await readJson(res); }
    finally { clearTimeout(timer); }
  }
  async function load(refresh = false) {
    if (state.busy) return;
    state.busy = true; $('refresh').disabled = true; $('retry').disabled = true; $('historyFile').disabled = true; $('error').hidden = true;
    $('status').textContent = state.view === 'history' ? 'Checking imported fills and retained broker evidence…' : 'Reading your option book…';
    try {
      if (!state.open || refresh) { state.open = await get('trades-v2' + (refresh ? '?refresh=1' : '')); render(); }
      if (state.view === 'history' && (!state.history || refresh)) { state.history = await get('trades-v2/history' + (refresh ? '?refresh=1' : '')); render(); }
      else if (refresh) state.history = null;
      render();
      $('status').textContent = `Recorded journal · ${state.open.rows.length} open positions · Broker dates shown on each row · Refreshed ${new Date().toLocaleTimeString()}`;
    } catch(error) {
      $('error').hidden = false; $('error').querySelector('p').textContent = error.name === 'AbortError' ? 'Journal loading timed out. Please retry.' : error.message || 'Could not load the journal.';
      $('status').textContent = (state.view === 'open' ? state.open : state.history) ? 'Update failed · Showing the last loaded journal.' : 'Journal unavailable · Retry loading.';
      if (!(state.view === 'open' ? state.open : state.history)) { $('journalTable').innerHTML = '<p class="empty">Journal records are unavailable. Use Retry loading above.</p>'; $('journalTable').setAttribute('aria-busy','false'); }
    } finally { state.busy = false; $('refresh').disabled = false; $('retry').disabled = false; $('historyFile').disabled = false; }
  }
  async function setView(view) {
    if (state.busy) return;
    state.view = view; render();
    if (view === 'history' && !state.history) await load();
  }
  $('openTab').addEventListener('click',() => void setView('open'));
  $('historyTab').addEventListener('click',() => void setView('history'));
  $('refresh').addEventListener('click',() => void load(true));
  $('retry').addEventListener('click',() => void load(true));
  $('historyFile').addEventListener('change',async () => {
    const file = $('historyFile').files?.[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) { $('importStatus').textContent = 'Choose an XML file smaller than 10 MB.'; return; }
    $('historyFile').disabled = true; $('importStatus').textContent = 'Importing execution history…';
    try {
      const result = await readJson(await fetch('/api/domain/invage/trades/import',{ method:'POST',headers:{'Content-Type':'application/xml'},body:await file.text(),credentials:'same-origin' }));
      $('importStatus').textContent = result.message || 'Execution history imported. Updating journal…';
      state.history = null; await load(true);
    } catch(error) { $('importStatus').textContent = error.message || 'Import failed. Existing records are retained.'; }
    finally { $('historyFile').disabled = false; $('historyFile').value = ''; }
  });
  render(); void load();
})();
