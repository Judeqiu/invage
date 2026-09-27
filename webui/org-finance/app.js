const error = document.getElementById('error');
const summary = document.getElementById('summary');
const content = document.getElementById('content');

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

function section(title, headers, rows) {
  const wrapper = node('section', null, 'section-gap');
  wrapper.append(node('h2', title));
  if (!rows.length) {
    wrapper.append(node('div', 'No records.', 'metric-card empty'));
    return wrapper;
  }
  const card = node('div', null, 'metric-card table-card');
  const scroll = node('div', null, 'table-scroll');
  const table = node('table', null, 'report');
  const head = node('thead');
  const heading = node('tr');
  headers.forEach(label => heading.append(node('th', label)));
  head.append(heading);
  table.append(head);
  const body = node('tbody');
  rows.forEach(values => {
    const row = node('tr');
    values.forEach(value => row.append(node('td', value == null ? '—' : value)));
    body.append(row);
  });
  table.append(body);
  scroll.append(table);
  card.append(scroll);
  wrapper.append(card);
  return wrapper;
}

function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
}

async function load() {
  const response = await fetch('/api/domain/invage/org-finance', { credentials: 'same-origin' });
  if (!response.ok) {
    if (response.status === 403) throw new Error('Your organization finance access has not been granted.');
    if (response.status === 404) throw new Error('Your account is not in a financial organization.');
    if (response.status === 503) throw new Error('Organization finance is not ready yet.');
    throw new Error(`Unable to load organization assets (${response.status}).`);
  }
  const data = await response.json();
  if (!data.organization) throw new Error('Organization finance is not initialized.');
  if (!data.current) {
    error.hidden = false;
    error.textContent = `This view may be out of date${data.importedAt ? ` (imported ${date(data.importedAt)})` : ''}. Use the Dashboard for the latest figures.`;
  }
  document.getElementById('org-kind').textContent =
    `${data.organization.kind} · ${data.organization.reporting_currency || 'reporting currency unset'}`;
  const accounts = new Map(data.accounts.map(account => [account.id, account]));
  const assets = new Map(data.assets.map(asset => [asset.id, asset]));
  for (const [label, count] of [
    ['Accounts', data.accounts.length], ['Positions', data.positions.length],
    ['Deposits', data.deposits.length], ['Properties', data.properties.length],
  ]) {
    const card = node('div', null, 'metric-card');
    card.append(node('div', label, 'metric-label'), node('div', count, 'metric-value'));
    summary.append(card);
  }
  content.append(section('Positions', ['Asset', 'Type', 'Account', 'Quantity', 'As of'],
    data.positions.map(position => [assets.get(position.asset_id)?.name || position.asset_id,
      assets.get(position.asset_id)?.kind, accounts.get(position.account_id)?.label || position.account_id,
      position.quantity, date(position.as_of)])));
  content.append(section('Cash by account', ['Account', 'Currency', 'Amount', 'As of'],
    data.cash.map(balance => [accounts.get(balance.account_id)?.label || balance.account_id,
      balance.currency, balance.amount, date(balance.as_of)])));
  content.append(section('Deposits', ['Asset', 'Account', 'Principal', 'Currency', 'Matures'],
    data.deposits.map(deposit => [assets.get(deposit.asset_id)?.name || deposit.asset_id,
      accounts.get(deposit.account_id)?.label || deposit.account_id,
      deposit.principal, deposit.currency, date(deposit.maturity_date)])));
  const latestValue = new Map();
  for (const valuation of data.valuations) {
    if (!latestValue.has(valuation.asset_id)) latestValue.set(valuation.asset_id, valuation);
  }
  content.append(section('Property', ['Asset', 'Value', 'Currency', 'Valued on'],
    data.properties.map(property => {
      const value = latestValue.get(property.asset_id);
      return [assets.get(property.asset_id)?.name || property.asset_id,
        value?.amount, value?.currency, date(value?.observed_at)];
    })));
  content.append(section('Liabilities', ['Name', 'Type', 'Principal', 'Currency'],
    data.liabilities.map(liability => [liability.label || liability.id,
      liability.kind, liability.principal, liability.currency])));
}

load().catch(failure => {
  error.hidden = false;
  error.textContent = failure.message || String(failure);
});
