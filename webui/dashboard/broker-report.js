/* Read-only broker evidence. Source numbers remain strings; no activity totals. */
(() => {
  'use strict';
  const host = document.getElementById('brokerActivity');
  const status = document.getElementById('brokerReportStatus');
  if (!host || !status) return;
  const api = '/api/domain/invage';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let report, selection = 'merged', reportDate = 'live';
  const filters = {search:'',category:'',instrument:'',account:''};
  let request;
  const matches = row => !selection || selection === 'merged' || selection === 'all' ||
    (selection.startsWith('broker:') ? row.brokerId === selection.slice(7) : row.channel === selection);
  async function get(path) {
    const response = await fetch(api + path, {credentials:'same-origin',cache:'no-store'});
    if (!response.ok) throw new Error('Broker source data could not be loaded. Retry to reload it.');
    return response.json();
  }
  const field = (row,key) => {
    const data = row.fields[key];
    if (!data?.values?.length) return 'Source not provided';
    const values = [...new Set(data.values.map(v => v.value))];
    return data.values.map(v => `${esc(v.value)}${v.scale ? ` (scale ${esc(v.scale.value)})` : ''}<small>${esc(v.field)}</small>`).join('<br>') + (values.length > 1 ? '<small>Multiple reported values</small>' : '') +
      (data.missing ? '<small>Absent in some observations</small>' : '');
  };
  function render() {
    if (!report) return;
    const accounts = report.accounts.filter(matches);
    status.innerHTML = `<h2>Broker freshness and history coverage</h2><p>Report selection: ${esc(reportDate === 'live' ? 'latest calculated report' : reportDate)}. Source status below is current; captured activity includes all recorded dates.</p>` + accounts.map(a =>
      `<article class="metric-card"><strong>${esc(a.label || a.brokerId)} · ${esc(a.accountId || a.channel)}</strong>
      <p>Last successful position snapshot: ${esc(a.snapshotDate || 'Unavailable')}</p>
      <p>Latest sync: ${a.lastSync ? `${a.lastSync.ok ? 'Succeeded' : 'Failed'} · ${esc(a.lastSync.at)}` : 'Not recorded'}${a.lastSync?.error ? ` · ${esc(a.lastSync.error)}` : ''}</p>
      <details><summary>History: ${a.history ? `${esc(a.history.status)} · ${esc(a.history.from)} through ${esc(a.history.through)}` : 'Coverage not established'}</summary>
      ${(a.history?.gaps || []).map(g => `<p class="broker-gap">${esc(g.reason)}</p>`).join('')}
      ${(a.lastSync?.not_imported || []).map(g => `<p class="broker-gap">${esc(g)}</p>`).join('')}</details></article>`).join('');
    const rows = report.activities.filter(matches);
    for (const name of ['category','instrument','account']) {
      if (filters[name] && !rows.some(r => name === 'instrument' ? r.instruments.includes(filters[name]) : (name === 'account' ? r.accountId : r.category) === filters[name])) filters[name] = '';
    }
    const choices = (name,values,label) => `<label>${label} <select data-activity-filter="${name}"><option value="">All</option>${[...new Set(values)].sort().map(v => `<option${filters[name] === v ? ' selected' : ''} value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label>`;
    const visible = rows.filter(r => (!filters.category || r.category === filters.category) &&
      (!filters.instrument || r.instruments.includes(filters.instrument)) && (!filters.account || r.accountId === filters.account) &&
      (!filters.search || JSON.stringify([r.accountId,r.category,r.sourceId,r.instruments,r.fields]).toLowerCase().includes(filters.search.toLowerCase())));
    host.innerHTML = `<h2>Broker Activity</h2><p>Captured broker records · read only · amounts and dates as reported. Orders show cumulative order values, not individual executions. Repeated records with the same broker, account, category and source ID are grouped; every observed version remains available. Records without an ID remain separate. No financial totals are inferred from these observations.</p>
      <p>Dividends, interest and transfers have no verified complete coverage. Missing source values show “Source not provided”; this does not mean zero.</p>
      <div class="broker-activity-controls"><label>Search <input type="search" data-activity-search placeholder="Symbol, source date, ID, amount…" value="${esc(filters.search)}"></label>
      ${choices('category',rows.map(r=>r.category),'Record type')}${choices('instrument',rows.flatMap(r=>r.instruments),'Instrument')}${choices('account',rows.map(r=>r.accountId),'Account')}
      <button type="button" class="chip-btn" data-activity-reload>Reload source data</button></div>
      <p role="status">${visible.length} of ${rows.length} grouped records${report.available ? '' : ` · ${esc(report.message)}`}</p>
      ${(report.capture || []).filter(c => matches({brokerId:c.broker_id,channel:c.channel})).map(c => `<details><summary>${esc(c.broker_id)} · ${esc(c.account_id)} · ${esc(c.status)} · ${c.documents} source documents</summary><pre>${esc(JSON.stringify(c.gaps,null,2))}</pre></details>`).join('')}
      <div class="table-scroll"><table class="report"><thead><tr>${['Account','Type / instrument','Reported date','Symbol','Side / status','Quantity','Price','Amount','Currency','Fee','Source'].map(t=>`<th scope="col">${t}</th>`).join('')}</tr></thead><tbody>${visible.map(r => `<tr><td>${esc(r.brokerId)}<br>${esc(r.accountId)}</td><td>${esc(r.category)}<br>${r.instruments.map(esc).join(', ')}${r.category === 'lifecycle' ? `<small>${field(r,'lifecycle')}</small>` : ''}</td><td>${field(r,'date')}</td><td>${field(r,'symbol')}</td><td>${field(r,'side')}<br>${field(r,'status')}</td><td>${field(r,'quantity')}</td><td>${field(r,'price')}</td><td>${field(r,'amount')}</td><td>${field(r,'currency')}</td><td>${field(r,'fee')}</td><td><button type="button" class="chip-btn" data-activity-key="${esc(r.key)}">Source details</button><small>${esc(r.sourceId || 'No source ID')} · ${r.observations} observations · ${r.versions} versions</small></td></tr>`).join('') || '<tr><td colspan="11">No captured activity matches this selection.</td></tr>'}</tbody></table></div>`;
  }
  async function reload() {
    if (request) return request;
    status.setAttribute('aria-busy','true');
    request = get('/broker-activity').then(value => {report=value;render();}).catch(error => {
      status.innerHTML = `<p role="alert">${esc(error.message)}${report ? ' Previously loaded source data remains below.' : ''}</p><button type="button" class="chip-btn" data-activity-reload>Retry</button>`;
    }).finally(()=>{request=null;status.removeAttribute('aria-busy');});
    return request;
  }
  const dialog = document.createElement('dialog');
  dialog.className='broker-source-dialog';
  document.body.append(dialog);
  let detailRequest = 0;
  dialog.addEventListener('cancel',()=>{detailRequest++;});
  async function details(path,title) {
    const id = ++detailRequest;
    dialog.innerHTML=`<button type="button" class="chip-btn" data-source-close>Close</button><h2>${esc(title)}</h2><p>Loading source evidence…</p>`;
    if (!dialog.open) dialog.showModal();
    try {
      const data = await get(path);
      if (id !== detailRequest) return;
      dialog.innerHTML=`<button type="button" class="chip-btn" data-source-close>Close</button><h2>${esc(title)}</h2><p>Broker fields below are preserved as reported, including signed values and reported P/L percentages. They are separate from calculated report P/L and may use a different mark or timestamp. All captured versions are shown; no version is selected as the financial total.</p><pre>${esc(JSON.stringify(data,null,2))}</pre>`;
    } catch (error) {
      if (id === detailRequest) dialog.innerHTML=`<button type="button" class="chip-btn" data-source-close>Close</button><p role="alert">${esc(error.message)}</p><button type="button" class="chip-btn" data-source-retry>Retry</button>`;
    }
    dialog.querySelector('[data-source-retry]')?.addEventListener('click',()=>details(path,title));
  }
  document.addEventListener('click', event => {
    const button=event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-activity-reload')) reload();
    if (button.hasAttribute('data-source-close')) { detailRequest++; dialog.close(); }
    if (button.dataset.activityKey) details('/broker-activity?key='+encodeURIComponent(button.dataset.activityKey),'Broker activity source');
    if (button.dataset.brokerPosition) details('/broker-position-report?position='+encodeURIComponent(button.dataset.brokerPosition),'Exact broker position snapshot');
  });
  host.addEventListener('change',event=>{if(event.target.dataset.activityFilter){filters[event.target.dataset.activityFilter]=event.target.value;render();}});
  host.addEventListener('input',event=>{
    if (!event.target.hasAttribute('data-activity-search')) return;
    const position=event.target.selectionStart;
    filters.search=event.target.value; render();
    const input=host.querySelector('[data-activity-search]');input.focus();input.setSelectionRange(position,position);
  });
  window.BrokerReport = {setScope(value,date){selection=value;reportDate=date;render();},reload};
  window.addEventListener('message',event=>{if(event.origin===location.origin && event.data?.type==='utarus:header-sync:activity') reload();});
  reload();
})();
