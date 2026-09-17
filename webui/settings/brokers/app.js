const API = '/api/domain/invage/broker-connections';

const el = {
  error: document.getElementById('error'),
  list: document.getElementById('list'),
};

/** @type {object | null} */
let payload = null;
/** @type {Record<string, { enabled: boolean, values: Record<string, string>, dirty: boolean, expanded: boolean }>} */
let forms = {};
let inFlight = false;
let abortWait = false;

function showError(message) {
  el.error.hidden = !message;
  el.error.textContent = message || '';
}

function statusLabel(status) {
  if (status === 'off') return 'Off';
  if (status === 'needs_credentials') return 'Needs credentials';
  if (status === 'connected') return 'Connected';
  if (status === 'error') return 'Error';
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

async function load() {
  const res = await fetch(API, { credentials: 'include' });
  payload = await readJson(res);
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
}

function markDirty(id) {
  forms[id].dirty = true;
  render();
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

function primaryLabel(status) {
  if (status === 'connected') return 'Manage';
  if (status === 'error') return 'Reconnect';
  if (status === 'needs_credentials') return 'Finish setup';
  if (status === 'off') return 'Connect';
  throw new Error(`Unknown connector status: ${status}`);
}

function fieldInput(conn, field) {
  const form = forms[conn.id];
  const cred = conn.credentials[field.id];
  const inputId = `${conn.id}-${field.id}`;
  const type = field.type === 'secret' ? 'password' : 'text';
  let placeholder = '';
  if (field.type === 'secret' && cred.configured) {
    placeholder = cred.last4 ? `••••${cred.last4}` : 'configured';
  } else if (cred.configured && cred.value) {
    placeholder = '';
  }
  const value =
    form.values[field.id] != null
      ? form.values[field.id]
      : field.type === 'secret'
        ? ''
        : cred.value || '';
  const useTextarea = field.widget === 'textarea' || field.format === 'pem';
  const control = useTextarea
    ? `<textarea id="${inputId}" data-conn="${escapeHtml(conn.id)}" data-field="${escapeHtml(field.id)}" data-secret="${field.type === 'secret' ? '1' : '0'}" autocomplete="off" placeholder="${escapeAttr(placeholder)}" ${inFlight ? 'disabled' : ''}>${escapeHtml(field.type === 'secret' ? '' : value)}</textarea>`
    : `<input id="${inputId}" data-conn="${escapeHtml(conn.id)}" data-field="${escapeHtml(field.id)}" data-secret="${field.type === 'secret' ? '1' : '0'}" type="${type}" autocomplete="off" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" ${inFlight ? 'disabled' : ''} />`;
  const help = field.help ? `<span class="help">${escapeHtml(field.help)}</span>` : '';
  return `
    <label class="field" for="${inputId}">${escapeHtml(field.label)}
      ${help}
      ${control}
    </label>`;
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

function lastSyncLine(conn) {
  if (conn.last_sync == null) return 'Never synced';
  if (conn.last_sync.ok === false) {
    return `Last sync failed: ${conn.last_sync.error || 'error'}`;
  }
  const bits = [`Last sync ${conn.last_sync.as_of || conn.last_sync.at}`];
  if (conn.last_sync.account_id) bits.push(`account ${conn.last_sync.account_id}`);
  if (conn.last_sync.lots_upserted != null) bits.push(`${conn.last_sync.lots_upserted} lots`);
  if (Array.isArray(conn.last_sync.not_imported) && conn.last_sync.not_imported.length > 0) {
    bits.push(`${conn.last_sync.not_imported.length} not imported: ${conn.last_sync.not_imported.join('; ')}`);
  }
  return bits.join(' · ');
}

function managePanel(conn) {
  const form = forms[conn.id];
  const saveDisabled = inFlight;
  const syncDisabled = inFlight || abortWait || form.dirty || !serverSyncEnabled(conn);
  const syncHint = form.dirty ? 'Save before sync' : '';
  return `
    <div class="manage">
      <div class="row">
        <label class="toggle"><input type="checkbox" data-toggle="${escapeHtml(conn.id)}" ${form.enabled ? 'checked' : ''} ${inFlight ? 'disabled' : ''} /> Enable channel</label>
      </div>
      <p class="hint" style="margin:8px 0 0">Stops ${escapeHtml(conn.display_name)} pulls. Holdings tagged ${escapeHtml(conn.channel)} stay on the dashboard.</p>
      ${conn.credential_fields.map((f) => fieldInput(conn, f)).join('')}
      <details>
        <summary>How to get ${escapeHtml(conn.display_name)} credentials</summary>
        <ol>
          ${(conn.help_steps || []).map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
          ${conn.ip_whitelist_help ? `<li>${escapeHtml(ipHelp(conn, payload.egress_ipv4))}</li>` : ''}
        </ol>
        ${(conn.help_notes || []).map((n) => `<p>${escapeHtml(n)}</p>`).join('')}
        ${conn.help_href ? `<p><a href="${escapeAttr(conn.help_href)}" target="_blank" rel="noopener">${escapeHtml(hrefLabel(conn))}</a></p>` : ''}
      </details>
      <div class="last">${escapeHtml(lastSyncLine(conn))}${syncHint ? ` · ${syncHint}` : ''}${abortWait ? ' · Request still running on the server — wait, then Refresh.' : ''}</div>
      <div class="actions">
        <button type="button" class="primary" data-save="${escapeHtml(conn.id)}" ${saveDisabled ? 'disabled' : ''}>Save</button>
        <button type="button" data-sync="${escapeHtml(conn.id)}" ${syncDisabled ? 'disabled' : ''}>Sync now</button>
        <button type="button" data-refresh="1" ${inFlight ? 'disabled' : ''}>Refresh</button>
      </div>
    </div>`;
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
    if (!form) continue;
    const wrap = document.createElement('div');
    wrap.className = 'connector';
    const showSync = serverSyncEnabled(conn) || conn.status === 'connected' || conn.status === 'error';
    const syncDisabled = inFlight || abortWait || form.dirty || !serverSyncEnabled(conn);
    wrap.innerHTML = `
      <div class="card-head">
        <div>
          <div class="title">${escapeHtml(conn.display_name)}</div>
          <div class="cap">${escapeHtml(conn.capability)}</div>
        </div>
        <span class="chip ${escapeHtml(conn.status)}">${escapeHtml(statusLabel(conn.status))}</span>
      </div>
      <div class="actions">
        <button type="button" class="primary" data-manage="${escapeHtml(conn.id)}" ${inFlight ? 'disabled' : ''}>${escapeHtml(primaryLabel(conn.status))}</button>
        ${showSync ? `<button type="button" data-sync="${escapeHtml(conn.id)}" ${syncDisabled ? 'disabled' : ''}>Sync now</button>` : ''}
        <a href="/brokers/guide#${encodeURIComponent(conn.id)}" target="_parent">Setup guide</a>
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
    });
  });
  el.list.querySelectorAll('input[data-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.getAttribute('data-toggle');
      forms[id].enabled = input.checked;
      markDirty(id);
    });
  });
  el.list.querySelectorAll('input[data-field], textarea[data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.getAttribute('data-conn');
      const field = input.getAttribute('data-field');
      forms[id].values[field] = input.value;
      forms[id].dirty = true;
    });
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
  return body;
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
  if (forms && Object.values(forms).some((f) => f.dirty)) {
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

load().catch((e) => {
  showError(e instanceof Error ? e.message : String(e));
});
