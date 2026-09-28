const API = '/api/domain/invage/broker-connections';

const IMPORTS = [
  ['Open positions', 'Equity / fund / option lots, cost, mark, and P/L on that connector channel. Empty positions is a flat book.'],
  ['Cash', 'ISO currency sleeves on that channel only. Other brokers stay untouched.'],
  ['Channel snapshot', 'Sync replaces lots and cash on the connector channel only.'],
  ['Marks', 'Dashboard marks stay Yahoo. Broker snapshot time is the UTC date of Sync (IBKR Flex is prior-day).'],
  ['Assignment size', 'Computed from strike × multiplier × contracts. Not a vendor probability or IV metric.'],
  ['Account metrics', 'Buying power, excess liquidity, and maintenance margin when the connector recorded them.'],
  ['Fills', 'IBKR Flex Trades at Executions level only. Tiger, MooMoo, and Webull omit option_executions.'],
  ['Not imported', 'Futures, short stock, combo options, and incomplete option rows are listed after sync. Never invented as holdings.'],
  ['Secrets', 'Reporting-only credentials. Never echoed. Off does not delete lots.'],
];

const el = {
  error: document.getElementById('error'),
  list: document.getElementById('list'),
  imports: document.getElementById('imports'),
};

/** @type {object | null} */
let payload = null;
/** @type {Record<string, { enabled: boolean, values: Record<string, string>, dirty: boolean, expanded: boolean }>} */
let forms = {};
let inFlight = false;
let abortWait = false;
let moomooAccounts = null;
let moomooAccountsLoading = false;
let moomooAccountsError = '';

function showError(message) {
  el.error.hidden = !message;
  el.error.textContent = message || '';
}

function statusLabel(status) {
  if (status === 'off') return 'Not connected';
  if (status === 'needs_credentials') return 'Needs credentials';
  if (status === 'connected') return 'Connected';
  if (status === 'error') return 'Error';
  throw new Error(`Unknown connector status: ${status}`);
}

function pillClass(status) {
  if (status === 'connected') return 'pill pill-success';
  if (status === 'needs_credentials') return 'pill pill-warning';
  if (status === 'error') return 'pill pill-danger';
  if (status === 'off') return 'pill pill-muted';
  throw new Error(`Unknown connector status: ${status}`);
}

function primaryLabel(status) {
  if (status === 'connected') return 'Manage';
  if (status === 'error') return 'Reconnect';
  if (status === 'needs_credentials') return 'Finish setup';
  if (status === 'off') return 'Connect';
  throw new Error(`Unknown connector status: ${status}`);
}

function requiredComplete(conn) {
  return conn.credential_fields
    .filter((f) => f.required)
    .every((f) => conn.credentials[f.id]?.configured === true);
}

function serverSyncEnabled(conn) {
  return conn.enabled === true && requiredComplete(conn);
}

async function readJson(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const message = body && typeof body.message === 'string' ? body.message : text;
    throw new Error(message || `HTTP ${res.status}`);
  }
  return body;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

function ipHelp(conn, egress) {
  if (conn.id === 'ibkr') {
    if (typeof egress === 'string' && egress.length > 0) {
      return `Paste this IPv4 into Client Portal → Flex Web Service → Valid for IP Address: ${egress}. A stolen token then fails from elsewhere (IBKR 1013).`;
    }
    return 'Leave Valid for IP Address blank unless ops gave you a static egress IP. Setting an IP with rotating egress returns IBKR 1013.';
  }
  if (typeof egress === 'string' && egress.length > 0) {
    return `Paste this IPv4 into Tiger developer portal IP whitelist: ${egress}.`;
  }
  return 'Leave Tiger IP whitelist blank unless ops gave you a static egress IP.';
}

function hrefLabel(conn) {
  if (conn.help_href_label) return conn.help_href_label;
  if (conn.id === 'ibkr') return 'Flex Web Service docs';
  return 'OpenAPI docs';
}

function lastSyncSub(conn) {
  if (conn.last_sync == null) return 'no account yet · never synced';
  const account = conn.last_sync.account_id
    ? `account ${conn.last_sync.account_id}`
    : 'no account yet';
  if (conn.last_sync.ok === false) {
    return `${account} · last sync failed`;
  }
  const when = conn.last_sync.as_of || conn.last_sync.at;
  return `${account} · last sync ${when}`;
}

function syncSummary(conn) {
  const sync = conn.last_sync;
  if (!sync) return '<p class="sync-summary">Never synced</p>';
  if (sync.ok === false) return `<p class="sync-summary sync-failed">Last sync failed: ${escapeHtml(sync.error || 'Unknown error')}</p>`;
  const skipped = Array.isArray(sync.not_imported) ? sync.not_imported : [];
  return `<div class="sync-summary">
    <div class="sync-heading">${skipped.length ? 'Sync complete · some items not imported' : 'Sync complete'}</div>
    <p>${escapeHtml(sync.as_of || sync.at)}${sync.lots_upserted != null ? ` · ${escapeHtml(sync.lots_upserted)} positions imported` : ''}</p>
    ${skipped.length ? `<details class="sync-issues"><summary>${skipped.length} items not imported</summary><ul>${skipped.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}

function fieldInput(conn, field) {
  const form = forms[conn.id];
  const cred = conn.credentials[field.id];
  const inputId = `${conn.id}-${field.id}`;
  const type = field.type === 'secret' ? 'password' : 'text';
  let placeholder = '';
  if (field.type === 'secret' && cred.configured) {
    placeholder = cred.last4 ? `••••${cred.last4}` : 'configured';
  }
  const value =
    form.values[field.id] != null
      ? form.values[field.id]
      : field.type === 'secret'
        ? ''
        : cred.value || '';
  const help = field.help ? `<span class="help" id="${inputId}-help">${escapeHtml(field.help)}</span>` : '';
  const useTextarea = field.widget === 'textarea' || field.format === 'pem';
  const control = useTextarea
    ? `<textarea id="${inputId}" data-conn="${escapeAttr(conn.id)}" data-field="${escapeAttr(field.id)}" autocomplete="off" spellcheck="false" aria-describedby="${inputId}-help" placeholder="${escapeAttr(placeholder)}" ${inFlight ? 'disabled' : ''}>${escapeHtml(field.type === 'secret' ? '' : value)}</textarea>`
    : `<input id="${inputId}" data-conn="${escapeAttr(conn.id)}" data-field="${escapeAttr(field.id)}" type="${type}" autocomplete="off" aria-describedby="${inputId}-help" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" ${inFlight ? 'disabled' : ''} />`;
  return `
    <label class="field" for="${inputId}">${escapeHtml(field.label)}
      ${control}
      ${help}
    </label>`;
}

function moomooAccountPicker(conn) {
  const form = forms.moomoo;
  const ready = conn.credentials.app_key?.configured && conn.credentials.private_key?.configured;
  const selected = form.values.acc_id ?? conn.credentials.acc_id?.value ?? '';
  const accounts = moomooAccounts;
  const options = accounts?.map((account) => {
    const suffix = account.trading_card_last4 || account.card_last4;
    const label = [account.security_firm, suffix ? `account ••${suffix}` : '', account.account_id].filter(Boolean).join(' · ');
    return `<option value="${escapeAttr(account.account_id)}" ${selected === account.account_id ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('') || '';
  const chosen = accounts?.some((account) => account.account_id === selected) ? selected : '';
  const requiresChoice = accounts && accounts.length > 1;
  return `<div class="account-picker">
    <label class="field" for="moomoo-account-choice">Trading account
      <select id="moomoo-account-choice" data-account-choice="moomoo" ${!ready || !accounts?.length || inFlight ? 'disabled' : ''}>
        <option value="" ${!chosen ? 'selected' : ''}>${requiresChoice ? 'Choose an account' : 'Automatically select the only account'}</option>
        ${options}
      </select>
    </label>
    <p class="help">${ready ? 'Accounts are retrieved from Moomoo using your AppKey. No ID needs to be typed.' : 'Save your AppKey and private key to find accounts.'}</p>
    ${accounts?.length === 0 ? '<p class="account-message">Moomoo returned no authorized trading accounts for this AppKey.</p>' : ''}
    ${moomooAccountsError ? `<p class="account-message">${escapeHtml(moomooAccountsError)}</p>` : ''}
    <button type="button" class="ghost" data-discover-accounts="1" ${!ready || moomooAccountsLoading || inFlight ? 'disabled' : ''}>${moomooAccountsLoading ? 'Finding accounts…' : 'Refresh accounts'}</button>
  </div>`;
}

function managePanel(conn) {
  const form = forms[conn.id];
  const saveDisabled = inFlight;
  const syncHint = form.dirty ? 'Save before sync.' : '';
  return `
    <div class="manage">
      <label class="toggle">
        <input type="checkbox" data-toggle="${escapeAttr(conn.id)}" ${form.enabled ? 'checked' : ''} ${inFlight ? 'disabled' : ''} />
        Enable channel
      </label>
      <p class="card-sub">Turning this off stops ${escapeHtml(conn.display_name)} syncs. Holdings tagged ${escapeHtml(conn.channel)} stay on the dashboard.</p>
      <div class="credential-fields">${conn.credential_fields.filter((f) => f.id !== 'acc_id' || conn.id !== 'moomoo').map((f) => fieldInput(conn, f)).join('')}</div>
      ${conn.id === 'moomoo' ? moomooAccountPicker(conn) : ''}
      <details>
        <summary>How to get ${escapeHtml(conn.display_name)} credentials</summary>
        <ol>
          ${(conn.help_steps || []).map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
          ${conn.ip_whitelist_help ? `<li>${escapeHtml(ipHelp(conn, payload.egress_ipv4))}</li>` : ''}
        </ol>
        ${(conn.help_notes || []).map((n) => `<p>${escapeHtml(n)}</p>`).join('')}
        ${conn.help_href ? `<p><a href="${escapeAttr(conn.help_href)}" target="_blank" rel="noopener">${escapeHtml(hrefLabel(conn))}</a></p>` : ''}
      </details>
      ${syncSummary(conn)}
      ${syncHint || abortWait ? `<p class="card-sub" role="status">${syncHint} ${abortWait ? 'Request still running on the server — wait, then Refresh.' : ''}</p>` : ''}
      <div class="actions">
        <button type="button" class="primary" data-save="${escapeAttr(conn.id)}" ${saveDisabled ? 'disabled' : ''}>Save</button>
        <button type="button" class="ghost" data-refresh="1" ${inFlight ? 'disabled' : ''}>Refresh</button>
      </div>
    </div>`;
}

function renderImports() {
  el.imports.innerHTML = IMPORTS.map(
    ([t, d]) => `
      <div class="metric-card">
        <div class="label-eyebrow import-title">${escapeHtml(t)}</div>
        <p class="import-body">${escapeHtml(d)}</p>
      </div>`,
  ).join('');
}

function render() {
  if (!payload) return;
  el.list.replaceChildren();
  if (!Array.isArray(payload.connectors) || payload.connectors.length === 0) {
    showError('Broker catalog returned no connectors.');
    return;
  }
  for (const conn of payload.connectors) {
    const form = forms[conn.id];
    const wrap = document.createElement('div');
    wrap.className = 'metric-card broker-card';
    const selectedAccount = form.values.acc_id ?? conn.credentials.acc_id?.value ?? '';
    const moomooNeedsChoice = conn.id === 'moomoo' && moomooAccounts?.length > 1 &&
      !moomooAccounts.some((account) => account.account_id === selectedAccount);
    const syncDisabled = inFlight || abortWait || form.dirty || !serverSyncEnabled(conn) || moomooNeedsChoice;
    const showSync = serverSyncEnabled(conn) || conn.status === 'connected' || conn.status === 'error';
    wrap.innerHTML = `
      <div class="card-head">
        <div>
          <div class="card-name">${escapeHtml(conn.display_name)}</div>
          <div class="card-sub">${escapeHtml((conn.capability || '').split('.')[0])}. ${escapeHtml(lastSyncSub(conn))}</div>
        </div>
        <span class="${pillClass(conn.status)}">${escapeHtml(statusLabel(conn.status))}</span>
      </div>
      <div class="actions">
        <button type="button" class="primary" data-manage="${escapeAttr(conn.id)}" ${inFlight ? 'disabled' : ''}>${escapeHtml(primaryLabel(conn.status))}</button>
        ${showSync ? `<button type="button" class="ghost" data-sync="${escapeAttr(conn.id)}" ${syncDisabled ? 'disabled' : ''}>Force sync</button>` : ''}
        ${conn.latest_raw_data
          ? `<a class="ghost" href="${API}/${encodeURIComponent(conn.id)}/raw-data" download>Download latest raw data</a>`
          : '<button type="button" class="ghost" disabled title="No saved raw data yet">Download latest raw data</button>'}
        <a class="ghost" href="/brokers/guide#${encodeURIComponent(conn.id)}" target="_parent" style="display:inline-flex;align-items:center;font-size:0.75rem;font-weight:600;text-decoration:none;color:inherit;border:1px solid var(--border);border-radius:0.4rem;padding:0.4rem 0.75rem;">Setup guide</a>
      </div>
      ${form.expanded ? managePanel(conn) : ''}
    `;
    el.list.appendChild(wrap);
  }
  bind();
}

function bind() {
  el.list.querySelectorAll('button[data-manage]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-manage');
      const conn = payload.connectors.find((c) => c.id === id);
      if (!conn) throw new Error(`Unknown connector ${id}`);
      if (conn.status === 'off' && !forms[id].enabled) {
        forms[id].enabled = true;
        forms[id].dirty = true;
      }
      forms[id].expanded = !forms[id].expanded;
      render();
      if (id === 'moomoo' && forms[id].expanded && moomooAccounts === null) void discoverMoomooAccounts();
    });
  });
  el.list.querySelectorAll('input[data-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.getAttribute('data-toggle');
      forms[id].enabled = input.checked;
      forms[id].dirty = true;
      render();
    });
  });
  el.list.querySelectorAll('input[data-field], textarea[data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.getAttribute('data-conn');
      const field = input.getAttribute('data-field');
      forms[id].values[field] = input.value;
      if (id === 'moomoo' && (field === 'app_key' || field === 'private_key')) {
        forms[id].values.acc_id = '';
      }
      forms[id].dirty = true;
    });
  });
  el.list.querySelectorAll('select[data-account-choice]').forEach((select) => {
    select.addEventListener('change', () => {
      forms.moomoo.values.acc_id = select.value;
      forms.moomoo.dirty = true;
      render();
    });
  });
  el.list.querySelectorAll('button[data-discover-accounts]').forEach((btn) => {
    btn.addEventListener('click', () => void discoverMoomooAccounts());
  });
  el.list.querySelectorAll('button[data-save]').forEach((btn) => {
    btn.addEventListener('click', () => void save(btn.getAttribute('data-save')));
  });
  el.list.querySelectorAll('button[data-sync]').forEach((btn) => {
    btn.addEventListener('click', () => void syncNow(btn.getAttribute('data-sync')));
  });
  el.list.querySelectorAll('button[data-refresh]').forEach((btn) => {
    btn.addEventListener('click', () => void refresh());
  });
}

function patchBody(id, conn) {
  const form = forms[id];
  /** @type {{ enabled: boolean, credentials: Record<string, string | null> }} */
  const body = { enabled: form.enabled, credentials: {} };
  for (const field of conn.credential_fields) {
    const typed = form.values[field.id];
    if (typed == null) continue;
    const trimmed = typed.trim();
    if (field.type === 'secret') {
      if (trimmed) body.credentials[field.id] = trimmed;
      continue;
    }
    if (trimmed) body.credentials[field.id] = trimmed;
    else if (!field.required && conn.credentials[field.id]?.configured) {
      body.credentials[field.id] = null;
    }
  }
  if (id === 'moomoo' && (body.credentials.app_key || body.credentials.private_key) &&
      form.values.acc_id == null && conn.credentials.acc_id?.configured) {
    body.credentials.acc_id = null;
  }
  return body;
}

async function discoverMoomooAccounts() {
  const conn = payload?.connectors.find((item) => item.id === 'moomoo');
  if (!conn?.credentials.app_key?.configured || !conn.credentials.private_key?.configured) return;
  moomooAccountsLoading = true;
  moomooAccountsError = '';
  render();
  try {
    const res = await fetch(`${API}/moomoo/accounts`, { credentials: 'include' });
    const body = await readJson(res);
    moomooAccounts = body.accounts;
  } catch (error) {
    moomooAccountsError = error instanceof Error ? error.message : String(error);
  } finally {
    moomooAccountsLoading = false;
    render();
  }
}

async function load() {
  const res = await fetch(API, { credentials: 'include' });
  payload = await readJson(res);
  moomooAccounts = null;
  forms = {};
  for (const conn of payload.connectors) {
    forms[conn.id] = {
      enabled: conn.enabled,
      values: {},
      dirty: false,
      expanded: conn.status === 'needs_credentials' || conn.status === 'error',
    };
  }
  abortWait = false;
  render();
  if (forms.moomoo?.expanded) void discoverMoomooAccounts();
}

async function save(id) {
  const conn = payload.connectors.find((c) => c.id === id);
  if (!conn) throw new Error(`Unknown connector ${id}`);
  inFlight = true;
  showError('');
  render();
  try {
    const res = await fetch(`${API}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody(id, conn)),
    });
    const view = await readJson(res);
    const idx = payload.connectors.findIndex((c) => c.id === id);
    payload.connectors[idx] = view;
    forms[id] = { enabled: view.enabled, values: {}, dirty: false, expanded: true };
    if (id === 'moomoo') {
      moomooAccounts = null;
      void discoverMoomooAccounts();
    }
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  } finally {
    inFlight = false;
    render();
  }
}

async function syncNow(id) {
  inFlight = true;
  showError('');
  render();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90_000);
  try {
    const res = await fetch(`${API}/${encodeURIComponent(id)}/sync`, {
      method: 'POST',
      credentials: 'include',
      signal: ac.signal,
    });
    const view = await readJson(res);
    const idx = payload.connectors.findIndex((c) => c.id === id);
    payload.connectors[idx] = { ...payload.connectors[idx], ...view };
    abortWait = false;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      abortWait = true;
      showError('Request still running on the server — wait, then Refresh.');
    } else {
      showError(e instanceof Error ? e.message : String(e));
    }
  } finally {
    clearTimeout(timer);
    inFlight = false;
    render();
  }
}

async function refresh() {
  if (Object.values(forms).some((f) => f.dirty)) {
    if (!window.confirm('Discard unsaved broker changes?')) return;
  }
  inFlight = true;
  showError('');
  render();
  try {
    await load();
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
    inFlight = false;
    render();
  }
}

renderImports();
load().catch((e) => {
  showError(e instanceof Error ? e.message : String(e));
});
