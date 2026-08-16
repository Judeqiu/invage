/**
 * Watch List page — playbook universe chips + named product quotes.
 * GET /api/domain/invage/watchlist (session cookie).
 */

const API = '/api/domain/invage/watchlist';

const el = {
  subtitle: document.getElementById('subtitle'),
  status: document.getElementById('status'),
  refreshBtn: document.getElementById('refreshBtn'),
  error: document.getElementById('error'),
  page: document.getElementById('page'),
  markets: document.getElementById('markets'),
  sectors: document.getElementById('sectors'),
  themes: document.getElementById('themes'),
  tbody: document.getElementById('tbody'),
  empty: document.getElementById('empty'),
};

let loading = false;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n, digits) {
  if (n == null || typeof n !== 'number' || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function signedClass(n) {
  if (n == null || typeof n !== 'number' || n === 0) return 'muted';
  return n > 0 ? 'pos' : 'neg';
}

function renderChips(node, values) {
  if (!values.length) {
    node.innerHTML = '<span class="chip muted">none set</span>';
    return;
  }
  node.innerHTML = values.map((v) => `<span class="chip">${esc(v)}</span>`).join('');
}

function render(payload) {
  const when = payload.generatedAt
    ? new Date(payload.generatedAt).toLocaleString()
    : '';
  el.subtitle.textContent = `${payload.displayName} · ${when}`;
  renderChips(el.markets, payload.watchlists.markets);
  renderChips(el.sectors, payload.watchlists.sectors);
  renderChips(el.themes, payload.watchlists.themes);

  const products = payload.products ?? [];
  if (products.length === 0) {
    el.tbody.innerHTML = '';
    el.empty.classList.remove('hidden');
  } else {
    el.empty.classList.add('hidden');
    el.tbody.innerHTML = products
      .map((p) => {
        if (p.quoteError) {
          return `<tr>
            <td>${esc(p.symbol)}</td>
            <td class="num muted" colspan="3">unavailable</td>
            <td class="muted">${esc(p.note ?? '')}</td>
            <td class="muted">${esc(p.added_at)}</td>
          </tr>`;
        }
        const chCls = signedClass(p.change);
        const pct = p.changePct == null ? '—' : `${p.changePct > 0 ? '+' : ''}${fmtNum(p.changePct, 2)}%`;
        const ch = p.change == null ? '—' : `${p.change > 0 ? '+' : ''}${fmtNum(p.change, 2)}`;
        return `<tr>
          <td>${esc(p.symbol)}</td>
          <td class="num">${fmtNum(p.price, 2)}</td>
          <td class="num ${chCls}">${ch}</td>
          <td class="num ${chCls}">${pct}</td>
          <td class="muted">${esc(p.note ?? '')}</td>
          <td class="muted">${esc(p.added_at)}</td>
        </tr>`;
      })
      .join('');
  }
  el.page.classList.remove('hidden');
  el.error.classList.add('hidden');
}

async function load() {
  if (loading) return;
  loading = true;
  el.refreshBtn.disabled = true;
  el.status.className = 'status';
  el.status.textContent = 'Fetching quotes…';
  try {
    const res = await fetch(API, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message || body.error || `HTTP ${res.status}`);
    }
    render(body);
    el.status.textContent = `Last refresh ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    el.status.className = 'status error';
    el.status.textContent = e instanceof Error ? e.message : String(e);
    el.error.classList.remove('hidden');
  } finally {
    loading = false;
    el.refreshBtn.disabled = false;
  }
}

el.refreshBtn.addEventListener('click', () => void load());
void load();
