const API = '/api/domain/invage/broker-connections';

const el = {
  error: document.getElementById('error'),
  toc: document.getElementById('toc'),
  brokers: document.getElementById('brokers'),
};

function showError(message) {
  el.error.hidden = !message;
  el.error.textContent = message || '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function requiredLabel(field) {
  return field.required ? 'Required' : 'Optional';
}

function sectionHash() {
  let hash = window.location.hash;
  if (!hash) {
    try {
      if (window.parent !== window) hash = window.parent.location.hash;
    } catch {
      /* cross-origin parent */
    }
  }
  return decodeURIComponent((hash || '').replace(/^#/, ''));
}

function scrollToSection() {
  const id = sectionHash();
  if (!id) return;
  document.getElementById(id)?.scrollIntoView();
}

function render(connectors) {
  el.toc.innerHTML = connectors
    .map(
      (c) =>
        `<a href="#${encodeURIComponent(c.id)}">${escapeHtml(c.display_name)}</a>`,
    )
    .join('');
  el.brokers.innerHTML = connectors
    .map((c) => {
      const fields = (c.credential_fields || [])
        .map(
          (f) => `
            <div class="field">
              <strong>${escapeHtml(f.label)} · ${requiredLabel(f)}</strong>
              <span>${escapeHtml(f.help || '')}</span>
            </div>`,
        )
        .join('');
      const steps = (c.help_steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
      const notes = (c.help_notes || []).map((n) => `<p>${escapeHtml(n)}</p>`).join('');
      const docs = c.help_href
        ? `<p class="notes"><a href="${escapeHtml(c.help_href)}" target="_blank" rel="noopener">${escapeHtml(c.help_href_label || 'OpenAPI docs')}</a></p>`
        : '';
      return `
        <article class="card" id="${escapeHtml(c.id)}">
          <div class="label-eyebrow">${escapeHtml(c.id)} · channel ${escapeHtml(c.channel)}</div>
          <h3 style="margin-top:0.35rem">${escapeHtml(c.display_name)}</h3>
          <p class="notes">${escapeHtml(c.capability)}</p>
          <ol>${steps}</ol>
          <div class="fields">${fields}</div>
          <div class="notes">${notes}</div>
          ${docs}
        </article>`;
    })
    .join('');
}

fetch(API, { credentials: 'include' })
  .then(async (res) => {
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Invalid JSON (${res.status})`);
    }
    if (!res.ok) {
      throw new Error((body && body.message) || text || `HTTP ${res.status}`);
    }
    const connectors = body.connectors || [];
    if (connectors.length === 0) throw new Error('Broker catalog returned no connectors.');
    render(connectors);
    scrollToSection();
  })
  .catch((e) => {
    showError(e instanceof Error ? e.message : String(e));
  });
