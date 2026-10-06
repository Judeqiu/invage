const bookEl = {
  error: document.getElementById('error'),
  status: document.getElementById('status'),
  metrics: document.getElementById('metrics'),
  accounts: document.getElementById('accounts'),
  journal: document.getElementById('journal'),
  updates: document.getElementById('updates'),
  count: document.getElementById('journal-count'),
  page: document.getElementById('page-label'),
  previous: document.getElementById('previous'),
  next: document.getElementById('next'),
  channel: document.getElementById('channel'),
  currency: document.getElementById('currency'),
  type: document.getElementById('entry-type'),
  from: document.getElementById('from'),
  to: document.getElementById('to'),
  scope: document.getElementById('account-scope'),
  search: document.getElementById('account-search'),
};

const pageSize = 25;
let payload = null;
let offset = 0;
let requestNumber = 0;
let applied = { channel: '__all__', currency: '', type: '', from: '', to: '' };

function formatMinor(raw) {
  const amount = BigInt(raw);
  const abs = amount < 0n ? -amount : amount;
  const whole = (abs / 1000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (abs % 1000000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${amount < 0n ? '−' : ''}${whole}.${fraction}`;
}

function quantity(raw) {
  if (raw == null) return '—';
  const value = String(raw).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return value === '0' ? '—' : value;
}

function humanize(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function localTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function accountName(account) {
  return account.label || account.external_key ||
    `${humanize(account.kind)} ${account.channel || 'unassigned'}`;
}

function optionList(select, choices, allLabel, allValue, selected, labelFor) {
  const options = [new Option(allLabel, allValue)];
  for (const value of choices) options.push(new Option(labelFor(value), value));
  select.replaceChildren(...options);
  select.value = selected;
}

function renderOptions(data) {
  optionList(bookEl.channel, data.options.channels, 'All channels', '__all__', applied.channel,
    value => value || 'Unassigned');
  optionList(bookEl.currency, data.options.currencies, 'All currencies', '', applied.currency, value => value);
  optionList(bookEl.type, data.options.entry_types, 'All types', '', applied.type, humanize);
  bookEl.from.value = applied.from;
  bookEl.to.value = applied.to;
}

function renderMetrics(data) {
  const s = data.summary;
  const currencies = data.options.currencies;
  bookEl.metrics.innerHTML =
    metricCard('Journal entries', s.journal_count.toLocaleString(), 'All recorded entries') +
    metricCard('Active accounts', s.active_accounts.toLocaleString(), 'Accounts with non-zero balance or quantity') +
    metricCard('Last posting', s.latest_booked_at ? localTime(s.latest_booked_at) : '—', 'Booking time, shown in your local timezone') +
    metricCard('Currencies', currencies.length ? currencies.join(' · ') : '—', 'Amounts are not combined across currencies');
}

function renderAccounts() {
  if (!payload) return;
  const search = bookEl.search.value.trim().toLowerCase();
  const assetKinds = new Set(['cash', 'deposit', 'position']);
  const accounts = payload.accounts.filter(account =>
    (bookEl.scope.value === 'all' || assetKinds.has(account.kind)) &&
    (applied.channel === '__all__' || account.channel === applied.channel) &&
    (!applied.currency || account.currency === applied.currency) &&
    (!search || `${accountName(account)} ${account.external_key} ${account.channel} ${account.kind}`.toLowerCase().includes(search)));
  if (accounts.length === 0) {
    bookEl.accounts.innerHTML = '<div class="empty">No account balances match this view.</div>';
    return;
  }
  bookEl.accounts.innerHTML = `<div class="table-scroll"><table class="report book-account-table">
    <thead><tr><th>Account</th><th>Kind</th><th>Channel</th><th>Currency</th><th>Units</th><th>Book balance</th></tr></thead>
    <tbody>${accounts.map(account => `<tr>
      <td data-label="Account"><span class="book-account-name">${esc(accountName(account))}</span>
        ${account.external_key && account.external_key !== accountName(account) ? `<span class="book-account-key">${esc(account.external_key)}</span>` : ''}</td>
      <td data-label="Kind"><span class="book-kind ${esc(account.kind)}">${esc(humanize(account.kind))}${account.instrument ? ` · ${esc(account.instrument)}` : ''}</span></td>
      <td data-label="Channel">${esc(account.channel || 'Unassigned')}</td>
      <td data-label="Currency">${esc(account.currency)}</td>
      <td data-label="Units" class="num">${esc(quantity(account.quantity))}</td>
      <td data-label="Book balance" class="num">${esc(formatMinor(account.balance_minor))}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function entryTable(entry) {
  return `<div class="table-scroll"><table class="report">
    <thead><tr><th>Account</th><th>Kind</th><th>Channel</th><th>Currency</th><th>Quantity</th><th>Unit cost</th><th>Debit</th><th>Credit</th></tr></thead>
    <tbody>${entry.lines.map(line => {
      const amount = BigInt(line.amount_minor);
      return `<tr>
        <td data-label="Account">${esc(line.label || line.external_key || humanize(line.kind))}</td>
        <td data-label="Kind">${esc(humanize(line.kind))}</td>
        <td data-label="Channel">${esc(line.channel || 'Unassigned')}</td>
        <td data-label="Currency">${esc(line.currency)}</td>
        <td data-label="Quantity" class="num">${esc(quantity(line.quantity))}</td>
        <td data-label="Unit cost" class="num">${line.unit_cost_minor == null ? '—' : esc(formatMinor(line.unit_cost_minor))}</td>
        <td data-label="Debit" class="num">${amount > 0n ? esc(formatMinor(line.amount_minor)) : '—'}</td>
        <td data-label="Credit" class="num">${amount < 0n ? esc(formatMinor(-amount)) : '—'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function renderJournal(data) {
  const journal = data.journal;
  bookEl.count.textContent = `${journal.total.toLocaleString()} matching entries`;
  if (journal.entries.length === 0) {
    bookEl.journal.innerHTML = '<div class="metric-card empty">No journal entries match these filters.</div>';
  } else {
    bookEl.journal.innerHTML = journal.entries.map(entry => {
      const source = entry.tool_name || entry.created_by;
      const memo = entry.memo || `${humanize(entry.entry_type)} · ${entry.lines.length} lines`;
      return `<details class="book-entry">
        <summary>
          <span class="book-entry-date">${esc(entry.value_date)}</span>
          <span class="book-entry-type">${esc(humanize(entry.entry_type))}</span>
          <span class="book-entry-memo" title="${esc(memo)}">${esc(memo)}</span>
          <span class="book-entry-source">${esc(source)}</span>
          <span class="book-entry-chevron" aria-hidden="true">+</span>
        </summary>
        <div class="book-entry-body">
          <div class="book-entry-meta">
            <span>Booked <code>${esc(localTime(entry.booked_at))}</code></span>
            <span>By <code>${esc(entry.created_by)}</code></span>
            ${entry.external_ref ? `<span>Source <code>${esc(entry.external_ref)}</code></span>` : ''}
            <span>Request <code>${esc(entry.request_id)}</code></span>
          </div>
          ${entryTable(entry)}
        </div>
      </details>`;
    }).join('');
  }
  const start = journal.total ? journal.offset + 1 : 0;
  const end = Math.min(journal.total, journal.offset + journal.entries.length);
  bookEl.page.textContent = `Showing ${start}–${end} of ${journal.total.toLocaleString()}`;
  bookEl.previous.disabled = journal.offset === 0;
  bookEl.next.disabled = journal.offset + journal.limit >= journal.total;
}

function renderUpdates(data) {
  if (!data.updates.length) {
    bookEl.updates.innerHTML = '<div class="empty">No portfolio save audit events yet.</div>';
    return;
  }
  bookEl.updates.innerHTML = `<div class="table-scroll"><table class="report book-updates-table">
    <thead><tr><th>Recorded</th><th>State revision</th><th>Monetary entries</th><th>Audit request</th></tr></thead>
    <tbody>${data.updates.map(update => `<tr>
      <td data-label="Recorded">${esc(localTime(update.created_at))}</td>
      <td data-label="State revision" class="num">${update.revision == null ? '—' : esc(update.revision)}</td>
      <td data-label="Monetary entries" class="num">${update.journals == null ? '—' : esc(update.journals)}</td>
      <td data-label="Audit request" class="book-request" title="${esc(update.request_id)}">${esc(update.request_id)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function queryString() {
  const params = new URLSearchParams({ offset: String(offset), limit: String(pageSize) });
  if (applied.channel !== '__all__') params.set('channel', applied.channel);
  if (applied.currency) params.set('currency', applied.currency);
  if (applied.type) params.set('type', applied.type);
  if (applied.from) params.set('from', applied.from);
  if (applied.to) params.set('to', applied.to);
  return params.toString();
}

async function loadBook() {
  const request = ++requestNumber;
  bookEl.status.textContent = 'Reading the journal database…';
  showError(bookEl.error, '');
  try {
    const data = await readJson(await fetch(`/api/domain/invage/book?${queryString()}`, { credentials: 'include' }));
    if (request !== requestNumber) return;
    payload = data;
    renderOptions(data);
    renderMetrics(data);
    renderAccounts();
    renderJournal(data);
    renderUpdates(data);
    bookEl.status.textContent = `Book refreshed ${localTime(new Date().toISOString())}`;
  } catch (error) {
    if (request !== requestNumber) return;
    bookEl.status.textContent = '';
    showError(bookEl.error, error instanceof Error ? error.message : String(error));
  }
}

document.getElementById('filters').addEventListener('submit', event => {
  event.preventDefault();
  applied = {
    channel: bookEl.channel.value,
    currency: bookEl.currency.value,
    type: bookEl.type.value,
    from: bookEl.from.value,
    to: bookEl.to.value,
  };
  offset = 0;
  loadBook();
});
document.getElementById('clear-filters').addEventListener('click', () => {
  applied = { channel: '__all__', currency: '', type: '', from: '', to: '' };
  offset = 0;
  loadBook();
});
document.getElementById('refresh').addEventListener('click', loadBook);
bookEl.scope.addEventListener('change', renderAccounts);
bookEl.search.addEventListener('input', renderAccounts);
bookEl.previous.addEventListener('click', () => { offset = Math.max(0, offset - pageSize); loadBook(); });
bookEl.next.addEventListener('click', () => { offset += pageSize; loadBook(); });
loadBook();
