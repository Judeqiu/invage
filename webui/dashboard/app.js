/**
 * Dynamic portfolio dashboard client.
 * Fetches /api/domain/invage/dashboard (session cookie) and renders the model.
 */

const API = '/api/domain/invage/dashboard';

const el = {
  root: document.getElementById('root'),
  subtitle: document.getElementById('subtitle'),
  status: document.getElementById('status'),
  refreshBtn: document.getElementById('refreshBtn'),
  autoRefresh: document.getElementById('autoRefresh'),
};

let timer = null;
let loading = false;

function formatUsd(n) {
  return (
    '$' +
    Number(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function formatPct(n) {
  const v = Number(n);
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function signedClass(n) {
  return Number(n) >= 0 ? 'up' : 'down';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sparklineSvg(values, width = 360, height = 72) {
  if (!values || values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const pad = 4;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * innerW;
      const y =
        range === 0 ? pad + innerH / 2 : pad + innerH - ((v - min) / range) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const stroke = values[values.length - 1] >= values[0] ? '#15803d' : '#b91c1c';
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Value over time">
    <polyline fill="none" stroke="${stroke}" stroke-width="2" points="${points}" />
  </svg>`;
}

function renderEmpty(payload) {
  el.subtitle.textContent = `${payload.displayName || payload.slug} · empty portfolio`;
  el.root.innerHTML = `
    <div class="card empty">
      ${escapeHtml(payload.message || 'No holdings yet.')}
    </div>`;
}

function renderModel(payload) {
  const model = payload.model;
  const live = model.live;
  const period = model.periodChange;
  const last = model.lastSnapshot;

  el.subtitle.textContent =
    `${payload.displayName || payload.slug} · updated ${new Date(payload.generatedAt).toLocaleString()}`;

  const periodHtml =
    period == null
      ? `<div class="value" style="font-size:0.95rem;color:var(--muted)">—</div>
         <div class="hint">Need ≥2 snapshots for period change</div>`
      : `<div class="value ${signedClass(period.deltaValue)}">${formatPct(period.deltaPct)}</div>
         <div class="hint ${signedClass(period.deltaValue)}">${formatUsd(period.deltaValue)}</div>
         <div class="hint">${escapeHtml(period.fromDate)} → ${escapeHtml(period.toDate)}</div>`;

  const snapLine =
    last == null
      ? 'No snapshots on file yet. Ask the agent to take a snapshot for history.'
      : `Last snapshot: ${escapeHtml(last.date)} · ${formatUsd(last.totalValue)} (may differ from live)`;

  const histValues = (model.history || []).map((h) => h.totalValue);
  const spark = sparklineSvg(histValues);

  const historyRows =
    !model.history || model.history.length === 0
      ? `<tr><td colspan="5" class="empty">No snapshots yet. Use save_snapshot in chat to build history.</td></tr>`
      : model.history
          .map((r) => {
            const dVal =
              r.deltaValue == null
                ? '—'
                : `<span class="${signedClass(r.deltaValue)}">${formatUsd(r.deltaValue)}</span>`;
            const dPct =
              r.deltaPct == null
                ? '—'
                : `<span class="${signedClass(r.deltaPct)}">${formatPct(r.deltaPct)}</span>`;
            return `<tr>
              <td>${escapeHtml(r.date)}</td>
              <td class="num right">${formatUsd(r.totalValue)}</td>
              <td class="num right ${signedClass(r.totalPL)}">${formatPct(r.totalPLPct)}</td>
              <td class="num right">${dVal}</td>
              <td class="num right">${dPct}</td>
            </tr>`;
          })
          .join('');

  const holdRows = live.positions
    .map(
      (p) => `<tr>
        <td><strong>${escapeHtml(p.ticker)}</strong></td>
        <td class="num right">${p.units}</td>
        <td class="num right">${formatUsd(p.avgCost)}</td>
        <td class="num right">${formatUsd(p.price)}</td>
        <td class="num right">${formatUsd(p.value)}</td>
        <td class="num right">${p.weightPct.toFixed(1)}%</td>
        <td class="num right ${signedClass(p.pl)}">${formatUsd(p.pl)}</td>
        <td class="num right ${signedClass(p.plPct)}">${formatPct(p.plPct)}</td>
      </tr>`,
    )
    .join('');

  el.root.innerHTML = `
    <div class="banner">${snapLine}</div>
    <div class="hero">
      <div class="card">
        <div class="label">Positions</div>
        <div class="value">${live.positionCount}</div>
      </div>
      <div class="card">
        <div class="label">Live value</div>
        <div class="value num">${formatUsd(live.totalValue)}</div>
      </div>
      <div class="card">
        <div class="label">P/L vs cost</div>
        <div class="value num ${signedClass(live.totalPL)}">${formatPct(live.totalPLPct)}</div>
        <div class="hint ${signedClass(live.totalPL)}">${formatUsd(live.totalPL)}</div>
      </div>
      <div class="card">
        <div class="label">Period change</div>
        ${periodHtml}
      </div>
    </div>

    <section class="card">
      <h2>Value history</h2>
      ${
        spark
          ? `<div class="sparkline-wrap">${spark}</div>`
          : `<p class="sub" style="margin:0 0 12px">Sparkline appears after at least two snapshots.</p>`
      }
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th class="right">Total value</th>
            <th class="right">P/L %</th>
            <th class="right">Δ $</th>
            <th class="right">Δ %</th>
          </tr>
        </thead>
        <tbody>${historyRows}</tbody>
      </table>
    </section>

    <section class="card">
      <h2>Holdings (${live.positionCount})</h2>
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th class="right">Units</th>
            <th class="right">Avg cost</th>
            <th class="right">Price</th>
            <th class="right">Value</th>
            <th class="right">Weight</th>
            <th class="right">P/L $</th>
            <th class="right">P/L %</th>
          </tr>
        </thead>
        <tbody>${holdRows}</tbody>
      </table>
    </section>
  `;
}

async function load() {
  if (loading) return;
  loading = true;
  el.refreshBtn.disabled = true;
  el.status.className = 'status';
  el.status.textContent = 'Fetching live prices…';
  try {
    const res = await fetch(API, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message || body.error || `HTTP ${res.status}`);
    }
    if (body.empty || !body.model) {
      renderEmpty(body);
    } else {
      renderModel(body);
    }
    el.status.textContent = `Last refresh ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    el.status.className = 'status error';
    el.status.textContent = e instanceof Error ? e.message : String(e);
    if (!el.root.innerHTML.trim()) {
      el.root.innerHTML = `<div class="card empty">Could not load dashboard. Sign in and try again.</div>`;
    }
  } finally {
    loading = false;
    el.refreshBtn.disabled = false;
  }
}

function syncTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (el.autoRefresh.checked) {
    timer = setInterval(() => void load(), 60_000);
  }
}

el.refreshBtn.addEventListener('click', () => void load());
el.autoRefresh.addEventListener('change', syncTimer);

void load();
