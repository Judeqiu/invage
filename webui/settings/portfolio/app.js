const API = '/api/domain/invage/portfolio-settings';
const form = document.getElementById('form');
const currency = document.getElementById('currency');
const save = document.getElementById('save');
const message = document.getElementById('message');
let saved = null;

function status(text, error = false) {
  message.textContent = text;
  message.classList.toggle('error', error);
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}

async function load() {
  try {
    const body = await readResponse(await fetch(API, { credentials: 'include' }));
    saved = body.reporting_currency;
    if (saved && ![...currency.options].some(option => option.value === saved)) {
      currency.add(new Option(`${saved} — current`, saved));
    }
    currency.value = saved || '';
    currency.disabled = false;
    save.disabled = true;
    status(saved ? `Current reporting currency: ${saved}` : 'Choose a reporting currency to calculate multi-currency totals.');
  } catch (error) {
    status(error instanceof Error ? error.message : String(error), true);
  }
}

currency.addEventListener('change', () => { save.disabled = !currency.value || currency.value === saved; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currency.value || currency.value === saved) return;
  currency.disabled = true;
  save.disabled = true;
  status('Saving…');
  try {
    const body = await readResponse(await fetch(API, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reporting_currency: currency.value }),
    }));
    saved = body.reporting_currency;
    status(`Saved ${saved}. Refresh the dashboard to see updated totals.`);
  } catch (error) {
    status(error instanceof Error ? error.message : String(error), true);
  } finally {
    currency.disabled = false;
    save.disabled = !currency.value || currency.value === saved;
  }
});

void load();
