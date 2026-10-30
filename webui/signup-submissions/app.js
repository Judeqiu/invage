(function () {
  'use strict';
  const base = '/api/domain/invage/academy-signup/admin/submissions';
  const form = document.getElementById('search-form');
  const search = document.getElementById('search');
  const rows = document.getElementById('rows');
  const message = document.getElementById('message');
  const buttons = [...document.querySelectorAll('button')];
  const sgt = new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
  let generation = 0;

  async function load() {
    const current = ++generation;
    buttons.forEach(button => { button.disabled = true; });
    message.dataset.error = 'false';
    message.textContent = 'Loading submissions…';
    rows.replaceChildren();
    try {
      const response = await fetch(base + '?q=' + encodeURIComponent(search.value.trim()), { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) throw new Error('Sign in to Management with an administrator account to view submissions.');
      if (response.status === 403) throw new Error('Administrator access is required to view submissions.');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Submissions could not be loaded.');
      if (current !== generation) return;
      for (const submission of body.submissions) {
        const row = document.createElement('tr');
        const values = [sgt.format(new Date(submission.created_at)), submission.reference, submission.customer_name,
          submission.customer_email, submission.customer_phone, submission.package_name, submission.amount_sgd,
          submission.session_date + ' ' + submission.session_time, submission.bank_transaction_id, submission.status];
        for (const value of values) {
          const cell = document.createElement('td');
          cell.textContent = value || '—';
          row.appendChild(cell);
        }
        const cell = document.createElement('td');
        const link = document.createElement('a');
        link.href = base + '/' + encodeURIComponent(submission.id) + '/proof';
        link.textContent = submission.proof_filename;
        link.download = submission.proof_filename;
        cell.appendChild(link); row.appendChild(cell); rows.appendChild(row);
      }
      message.textContent = body.submissions.length ? body.submissions.length + ' submission(s) found.' : 'No submissions found.';
    } catch (error) {
      if (current !== generation) return;
      message.dataset.error = 'true';
      message.textContent = error instanceof Error ? error.message : 'Submissions could not be loaded.';
    } finally {
      if (current === generation) buttons.forEach(button => { button.disabled = false; });
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void load(); });
  document.getElementById('refresh').addEventListener('click', () => { void load(); });
  void load();
})();
