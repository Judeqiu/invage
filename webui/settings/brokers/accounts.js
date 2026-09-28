const ROOT = '/api/domain/invage';
const el = {
  error: document.getElementById('error'),
  list: document.getElementById('list'),
};
let data = null;
let busy = false;
let managed = '';
let wizard = null;
let preview = {};
let managedAccounts = {};
let dirty = new Set();

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function error(message) {
  el.error.hidden = !message;
  el.error.textContent = message || '';
}
async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}
async function call(path, method = 'GET', body) {
  return json(await fetch(ROOT + path, {
    method, credentials: 'include',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }));
}
async function run(task) {
  if (busy) return;
  if (wizard) {
    wizard.config = values('config', broker(wizard.broker_id));
    wizard.account = document.getElementById('new-account')?.value.trim() || wizard.account || '';
    wizard.label = document.getElementById('new-label')?.value || wizard.label || '';
  }
  busy = true;
  error('');
  el.list.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try {
    await task();
    await load();
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
  } finally {
    busy = false;
    render();
  }
}
async function load() {
  data = await call('/broker-accounts');
  render();
}
function broker(id) { return data.catalog.find(c => c.id === id); }
function source(id) { return data.sources.find(s => s.id === id); }
function fields(b, role) { return b.fields.filter(f => f.role === role); }
function fieldHtml(f, value, prefix) {
  const existing = value?.[f.id];
  const configured = existing?.configured;
  const shown = f.type === 'secret' ? '' : (existing?.value || '');
  const placeholder = f.type === 'secret' && configured
    ? existing.last4 ? `Saved ····${existing.last4}` : 'Saved'
    : '';
  const id = `${prefix}-${f.id}`;
  const hint = f.help ? `<span class="help">${esc(f.help)}</span>` : '';
  const control = f.widget === 'textarea'
    ? `<textarea id="${esc(id)}" data-field="${esc(f.id)}" data-role="${esc(prefix)}" autocomplete="off" placeholder="${esc(placeholder)}" ${busy ? 'disabled' : ''}>${esc(shown)}</textarea>`
    : `<input id="${esc(id)}" data-field="${esc(f.id)}" data-role="${esc(prefix)}" type="${f.type === 'secret' ? 'password' : 'text'}" autocomplete="off" value="${esc(shown)}" placeholder="${esc(placeholder)}" ${busy ? 'disabled' : ''}>`;
  return `<label class="field" for="${esc(id)}">${esc(f.label)}${f.required ? ' · Required' : ' · Optional'}${hint}${control}</label>`;
}
function values(role, b, configured) {
  const out = {};
  for (const f of fields(b, role === 'access' ? 'source' : 'connection')) {
    const input = document.getElementById(`${role}-${f.id}`);
    if (!input) continue;
    const value = input.value.trim();
    if (value) out[f.id] = value;
    else if (f.type !== 'secret' && !f.required && configured?.[f.id]?.configured) out[f.id] = null;
  }
  return out;
}
function guide(b) {
  return `<details><summary>Setup instructions for ${esc(b.display_name)}</summary>
    <ol>${(b.help_steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    ${(b.help_notes || []).map(s => `<p>${esc(s)}</p>`).join('')}
    ${b.help_href ? `<p><a href="${esc(b.help_href)}" target="_blank" rel="noopener">Broker documentation</a></p>` : ''}
    ${b.id === 'ibkr' && data.egress_ipv4 ? `<p>Static egress IPv4 for Flex IP restriction: ${esc(data.egress_ipv4)}</p>` : ''}
  </details>`;
}
function existingCard(c) {
  const b = broker(c.broker_id);
  const s = source(c.source_id);
  const open = managed === c.id;
  const last = c.last_sync?.ok === false ? `Last sync failed: ${c.last_sync.error}`
    : c.last_sync?.ok === true ? `Last sync: ${c.last_sync.as_of || c.last_sync.at}` : 'Never synced';
  const status = c.status === 'needs_setup' ? c.account_id ? 'Access incomplete' : 'Select account'
    : c.status === 'ready' ? 'Ready to validate' : c.status === 'verified' ? 'Synced'
    : c.status === 'paused' ? 'Paused' : 'Sync error';
  return `<section class="connector">
    <div class="card-head"><div><div class="title">${esc(c.label)}</div>
      <div class="cap">${esc(b.display_name)} · ${esc(c.account_id || 'Account selection needed')} · ${esc(c.channel)}</div></div>
      <span class="chip ${c.status === 'paused' ? 'off' : c.status === 'error' ? 'error' : c.status === 'verified' ? 'connected' : 'needs_credentials'}">${esc(status)}</span></div>
    <p class="hint">${esc(last)}</p>
    <div class="actions">
      <button data-action="manage" data-id="${esc(c.id)}">${open ? 'Close' : 'Manage'}</button>
      <button data-action="preview" data-id="${esc(c.id)}" ${busy || dirty.has(c.id) || !c.account_id ? 'disabled' : ''}>Preview</button>
      <button data-action="sync" data-id="${esc(c.id)}" ${busy || dirty.has(c.id) || !c.enabled || !c.account_id || (!c.last_sync && !preview[c.id]) ? 'disabled' : ''}>Sync now</button>
      ${c.latest_raw_data ? `<a href="${ROOT}/broker-accounts/${encodeURIComponent(c.id)}/raw-data" download>Download latest raw</a>` : ''}
    </div>
    ${dirty.has(c.id) ? '<p class="hint">Save changes before preview or sync.</p>' : ''}
    ${preview[c.id] ? `<p class="hint">Preview ${esc(preview[c.id].as_of)} · ${esc(preview[c.id].lots)} incoming lots · ${esc(preview[c.id].would_remove)} existing lots would be removed · ${esc(preview[c.id].currencies.join(', '))} cash${preview[c.id].not_imported.length ? ` · ${esc(preview[c.id].not_imported.length)} skipped` : ''}</p>
      ${preview[c.id].not_imported.length ? `<details><summary>Skipped rows</summary><ul>${preview[c.id].not_imported.map(item => `<li>${esc(item)}</li>`).join('')}</ul></details>` : ''}` : ''}
    ${open ? `<div class="manage">
      <label class="field" for="account-label">Account label<input id="account-label" type="text" value="${esc(c.label)}"></label>
      ${c.account_binding_editable ? `<div class="actions"><button data-action="find-binding" data-id="${esc(c.id)}" ${busy || b.id === 'tiger' || dirty.has(c.id) ? 'disabled' : ''}>Find accounts</button></div>
        <label class="field" for="account-binding">Confirm account ID
        ${managedAccounts[c.id]?.length ? `<select id="account-binding"><option value="">Choose account</option>${managedAccounts[c.id].map(a => `<option value="${esc(a.account_id)}" ${a.account_id === c.account_id ? 'selected' : ''}>${esc(a.account_id)}</option>`).join('')}</select>`
        : `<input id="account-binding" type="text" placeholder="Account ID returned by broker" value="${esc(c.account_id || '')}">`}
        </label>` : ''}
      <label class="toggle"><input id="account-enabled" type="checkbox" ${c.enabled ? 'checked' : ''}> Enable this account</label>
      <p class="hint">Pausing stops pulls. Existing holdings on ${esc(c.channel)} stay visible.</p>
      <h3>Access</h3>
      ${fields(b, 'source').map(f => fieldHtml(f, s.credentials, 'access')).join('')}
      <div class="actions"><button data-action="save-access" data-id="${esc(c.id)}" ${busy ? 'disabled' : ''}>Save access</button>
      ${b.id === 'webull' ? `<button data-action="token-create" data-id="${esc(c.id)}" ${busy ? 'disabled' : ''}>Create token</button>
      <button data-action="token-check" data-id="${esc(c.id)}" ${busy ? 'disabled' : ''}>Check token</button>` : ''}</div>
      <h3>Account settings</h3>
      ${fields(b, 'connection').filter(f => f.id !== 'acc_id' && f.id !== 'account_id' && f.id !== 'account').map(f => fieldHtml(f, c.config, 'config')).join('')}
      <div class="actions"><button data-action="save-account" data-id="${esc(c.id)}" ${busy ? 'disabled' : ''}>Save account</button></div>
      ${guide(b)}
    </div>` : ''}
  </section>`;
}
function wizardHtml() {
  if (!wizard) return '';
  const b = broker(wizard.broker_id);
  const compatible = data.sources.filter(s => s.broker_id === b.id);
  const selectedSource = wizard.source_id ? source(wizard.source_id) : null;
  return `<section class="connector">
    <div class="card-head"><div class="title">Add ${esc(b.display_name)} account</div>
      <button data-action="cancel">Close</button></div>
    <p class="hint">${esc(b.capability)}</p>
    ${guide(b)}
    <label class="field" for="source-choice">Access source
      <select id="source-choice">
        <option value="">Create new access</option>
        ${compatible.map((s, i) => {
          const last4 = Object.values(s.credentials).find(v => v.last4)?.last4;
          return `<option value="${esc(s.id)}" ${s.id === wizard.source_id ? 'selected' : ''}>${esc(b.display_name)} access ${i + 1}${last4 ? ' ····' + esc(last4) : ''}</option>`;
        }).join('')}
      </select></label>
    ${selectedSource ? '<p class="hint">Using saved access. Rotate its credentials from an existing account card.</p>'
      : fields(b, 'source').map(f => fieldHtml(f, null, 'access')).join('') +
        `<div class="actions"><button data-action="create-access" ${busy ? 'disabled' : ''}>Save access</button></div>`}
    ${wizard.source_id ? `<h3>Account details</h3>
      ${b.id === 'webull' ? `<p class="hint">If Webull requires app approval, create a token here, approve it in the Webull app, then check its status before finding accounts.</p>
        ${wizard.tokenStatus ? `<p class="hint">Token status: ${esc(wizard.tokenStatus)}</p>` : ''}
        <div class="actions"><button data-action="wizard-token-create" ${busy ? 'disabled' : ''}>Create token</button>
        <button data-action="wizard-token-check" ${busy ? 'disabled' : ''}>Check token</button></div>` : ''}
      ${fields(b, 'connection').filter(f => !['acc_id', 'account_id', 'account'].includes(f.id)).map(f => fieldHtml(f, wizard.config && Object.fromEntries(Object.entries(wizard.config).map(([k, v]) => [k, { configured: true, value: v }])), 'config')).join('')}
      <div class="actions"><button data-action="discover" ${busy || b.id === 'tiger' ? 'disabled' : ''}>Find accounts</button></div>
      ${b.id === 'tiger' ? '<p class="hint">Tiger requires the trading account ID from its developer portal.</p>' : ''}
      <label class="field" for="new-account">Broker account
      ${wizard.accounts?.length ? `<select id="new-account"><option value="">Choose an account</option>
        ${wizard.accounts.map(a => `<option value="${esc(a.account_id)}" ${a.account_id === wizard.account ? 'selected' : ''}>${esc(a.security_firm || '')} ${esc(a.trading_card_last4 ? '··' + a.trading_card_last4 : '')} ${esc(a.account_id)}</option>`).join('')}</select>`
      : `<input id="new-account" type="text" placeholder="Account ID" value="${esc(wizard.account || '')}">`}
      </label>
      <label class="field" for="new-label">Name this account<input id="new-label" type="text" placeholder="e.g. Personal IBKR" value="${esc(wizard.label || '')}"></label>
      <div class="actions"><button data-action="create-account" ${busy ? 'disabled' : ''}>Add account</button></div>
    ` : ''}
  </section>`;
}
function render() {
  if (!data) return;
  el.list.innerHTML = `<div class="actions"><button class="primary" data-action="start" ${busy ? 'disabled' : ''}>Add broker account</button>
    <button data-action="refresh" ${busy ? 'disabled' : ''}>Refresh</button></div>
    ${!wizard ? `<div class="manage" id="broker-choices" hidden>
      ${data.catalog.map(b => `<button data-action="choose-broker" data-id="${esc(b.id)}">${esc(b.display_name)}</button>`).join('')}</div>` : ''}
    ${wizard ? wizardHtml() : ''}
    ${data.connections.length ? data.connections.map(existingCard).join('') : '<p class="hint">No broker accounts connected yet.</p>'}`;
  el.list.querySelectorAll('[data-action]').forEach(node => node.addEventListener('click', () => action(node)));
  for (const input of el.list.querySelectorAll('.connector .manage input, .connector .manage textarea, .connector .manage select')) {
    input.addEventListener('input', () => {
      if (!managed) return;
      dirty.add(managed);
      for (const button of el.list.querySelectorAll(`[data-action="preview"][data-id="${managed}"], [data-action="sync"][data-id="${managed}"]`)) button.disabled = true;
    });
  }
  el.list.querySelector('#source-choice')?.addEventListener('change', e => {
    wizard.source_id = e.target.value;
    wizard.accounts = null;
    wizard.account = '';
    render();
  });
}
async function action(node) {
  if (busy) return;
  const a = node.dataset.action;
  const id = node.dataset.id;
  if (a === 'start') { el.list.querySelector('#broker-choices').hidden = false; return; }
  if (a === 'choose-broker') { wizard = { broker_id: id, source_id: '', accounts: null }; render(); return; }
  if (a === 'cancel') { wizard = null; render(); return; }
  if (a === 'manage') {
    if (managed === id && dirty.has(id)) {
      if (!window.confirm('Discard unsaved broker changes?')) return;
      dirty.delete(id);
    }
    managed = managed === id ? '' : id;
    render();
    return;
  }
  if (a === 'refresh') {
    if (dirty.size && !window.confirm('Discard unsaved broker changes?')) return;
    dirty.clear();
    await run(async () => {});
    return;
  }
  if (a === 'create-access') {
    const b = broker(wizard.broker_id);
    await run(async () => {
      const created = await call('/broker-access', 'POST', {
        broker_id: b.id, credentials: values('access', b),
      });
      wizard.source_id = created.id;
    });
    return;
  }
  if (a === 'discover') {
    const b = broker(wizard.broker_id);
    wizard.config = values('config', b);
    await run(async () => {
      const found = await call(`/broker-access/${encodeURIComponent(wizard.source_id)}/discover`, 'POST',
        { config: wizard.config });
      wizard.accounts = found.accounts;
    });
    return;
  }
  if (a === 'wizard-token-create' || a === 'wizard-token-check') {
    wizard.config = values('config', broker(wizard.broker_id));
    await run(async () => {
      const result = await call(`/broker-access/${encodeURIComponent(wizard.source_id)}/webull-token`,
        a === 'wizard-token-create' ? 'POST' : 'GET');
      wizard.tokenStatus = result.status;
    });
    return;
  }
  if (a === 'create-account') {
    const b = broker(wizard.broker_id);
    const account = document.getElementById('new-account')?.value.trim();
    const label = document.getElementById('new-label')?.value.trim() || `${b.display_name} ${account}`;
    const config = values('config', b);
    await run(async () => {
      await call('/broker-accounts', 'POST', { source_id: wizard.source_id, account_id: account, label, config });
      wizard = null;
    });
    return;
  }
  const c = data.connections.find(item => item.id === id);
  if (!c) return;
  const b = broker(c.broker_id);
  if (a === 'save-access') {
    await run(async () => {
      await call(`/broker-access/${encodeURIComponent(c.source_id)}`, 'PATCH',
        { credentials: values('access', b, source(c.source_id).credentials) });
      dirty.delete(id);
      preview = {};
    });
  } else if (a === 'find-binding') {
    const config = Object.fromEntries(Object.entries(c.config).filter(([, v]) => v.value).map(([k, v]) => [k, v.value]));
    await run(async () => {
      managedAccounts[id] = (await call(`/broker-access/${encodeURIComponent(c.source_id)}/discover`, 'POST', { config })).accounts;
    });
  } else if (a === 'save-account') {
    await run(async () => {
      await call(`/broker-accounts/${encodeURIComponent(id)}`, 'PATCH', {
        label: document.getElementById('account-label').value.trim(),
        enabled: document.getElementById('account-enabled').checked,
        ...(!c.account_binding_editable || !document.getElementById('account-binding')?.value.trim() ? {}
          : { account_id: document.getElementById('account-binding').value.trim() }),
        config: values('config', b, c.config),
      });
      dirty.delete(id);
      preview[id] = undefined;
    });
  } else if (a === 'preview') {
    await run(async () => { preview[id] = await call(`/broker-accounts/${encodeURIComponent(id)}/preview`, 'POST'); });
  } else if (a === 'sync') {
    await run(() => call(`/broker-accounts/${encodeURIComponent(id)}/sync`, 'POST'));
  } else if (a === 'token-create' || a === 'token-check') {
    await run(async () => {
      const got = await call(`/broker-access/${encodeURIComponent(c.source_id)}/webull-token`,
        a === 'token-create' ? 'POST' : 'GET');
      error(`Webull token status: ${got.status}`);
    });
  }
}
load().catch(e => error(e instanceof Error ? e.message : String(e)));
