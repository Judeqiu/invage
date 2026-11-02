(function () {
  'use strict';
  const base = '/api/domain/invage/academy-signup/admin/submissions';
  const $ = id => document.getElementById(id);
  const sgt = new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
  let submissions = [], mailConfigured = false, detail = null, generation = 0, reviewGeneration = 0, busy = false, proofUrl, pdfTask, pdfDocument, pdfPage = 1, pdfGeneration = 0;
  const dateTime = value => value ? sgt.format(new Date(value)) : '—';
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  const errorText = error => error instanceof Error ? error.message : 'Something went wrong. Refresh and try again.';
  const notify = (id, text, error = false) => { $(id).textContent = text; $(id).dataset.error = String(error); };
  async function api(path = '', options = {}) {
    const response = await fetch(base + path, { credentials: 'same-origin', cache: 'no-store', ...options });
    if (response.status === 401) throw new Error('Sign in to Management with an administrator account.');
    if (response.status === 403) throw new Error('Administrator access and a same-origin request are required.');
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'The operation could not be completed.');
    return body;
  }
  function emailLabel(row) {
    if (row.status !== 'approved') return 'Not queued';
    return { pending: mailConfigured ? 'Queued · ready to send' : 'Awaiting email setup', sending: 'Attempt in progress · refresh to check',
      sent: 'Accepted by email provider', failed: 'Send failed · retry available', unknown: 'Outcome unconfirmed · review required' }[row.email_status] || row.email_status;
  }
  function renderRows() {
    const filter = $('status-filter').value;
    const filtered = submissions.filter(row => filter === 'all' || (filter === 'awaiting-email' ? row.status === 'approved' && row.email_status !== 'sent' : row.status === filter));
    const fragment = document.createDocumentFragment();
    for (const row of filtered) {
      const tr = node('tr');
      const customer = node('td'); customer.append(node('strong', row.customer_name), node('small', row.customer_email), node('small', row.reference));
      const pkg = node('td'); pkg.append(node('strong', row.package_name), node('small', 'SGD ' + row.amount_sgd));
      const session = node('td'); session.append(node('strong', (row.confirmed_session_date || row.session_date) + ' · ' + (row.confirmed_session_time || row.session_time)), node('small', row.status === 'approved' ? 'Confirmed' : 'Requested'));
      const status = node('td'); status.append(node('span', row.status === 'approved' ? 'Approved' : 'Needs review', 'badge ' + row.status), node('small', emailLabel(row)));
      const action = node('td'); const button = node('button', row.status === 'approved' ? 'View signup' : 'Review');
      button.type = 'button'; button.addEventListener('click', () => openReview(row.id)); action.append(button);
      tr.append(customer, pkg, session, node('td', dateTime(row.created_at)), status, action); fragment.append(tr);
    }
    $('rows').replaceChildren(fragment);
    notify('message', filtered.length ? filtered.length + ' signup(s) shown.' : 'No signups match this view. Try another status or search.');
  }
  async function load() {
    const current = ++generation;
    $('refresh').disabled = true; notify('message', 'Loading submissions…');
    try {
      const body = await api('?q=' + encodeURIComponent($('search').value.trim()));
      if (current !== generation) return;
      submissions = body.submissions; mailConfigured = body.mailConfigured;
      $('mail-setup').hidden = mailConfigured; renderRows();
    } catch (error) { if (current === generation) notify('message', errorText(error), true); }
    finally { if (current === generation) $('refresh').disabled = false; }
  }
  function setBusy(value) {
    busy = value;
    for (const control of $('review').querySelectorAll('button, input, select')) control.disabled = value;
    if (!value && pdfDocument) { $('pdf-previous').disabled = pdfPage <= 1; $('pdf-next').disabled = pdfPage >= pdfDocument.numPages; }
    if (!value && detail?.submission.status === 'approved') $('send-email').disabled = !detail.mailConfigured || detail.submission.email_status === 'sent';
    $('review').setAttribute('aria-busy', String(value));
  }
  function releaseProof() {
    if (proofUrl) { URL.revokeObjectURL(proofUrl); proofUrl = undefined; }
    ++pdfGeneration;
    if (pdfTask) { void pdfTask.destroy().catch(() => {}); pdfTask = undefined; }
    pdfDocument = undefined;
  }
  async function renderPdfPage(pageNumber) {
    const document = pdfDocument;
    if (!document) return;
    const current = ++pdfGeneration;
    $('pdf-previous').disabled = true; $('pdf-next').disabled = true;
    $('pdf-page').textContent = 'Loading page ' + pageNumber + '…';
    try {
      const page = await document.getPage(pageNumber);
      const natural = page.getViewport({scale:1});
      const width = Math.max(240,$('proof-preview').clientWidth - 24);
      const viewport = page.getViewport({scale:width / natural.width});
      const canvas = node('canvas'); const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = '100%'; canvas.style.height = 'auto';
      canvas.setAttribute('role','img'); canvas.setAttribute('aria-label','Payment evidence page ' + pageNumber + ' of ' + document.numPages);
      await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]}).promise;
      if (current !== pdfGeneration) return;
      pdfPage = pageNumber; $('proof-preview').replaceChildren(canvas);
      $('pdf-page').textContent = 'Page ' + pageNumber + ' of ' + document.numPages;
    } catch (error) {
      if (current === pdfGeneration) $('proof-preview').replaceChildren(node('p','This PDF could not be rendered. Use Open original or Download to review it.'));
    } finally {
      if (current === pdfGeneration) { $('pdf-previous').disabled = pdfPage <= 1; $('pdf-next').disabled = pdfPage >= document.numPages; }
    }
  }
  async function loadProof(id, current) {
    releaseProof(); $('proof-preview').replaceChildren(node('p', 'Loading private payment evidence…')); $('zoom-controls').hidden = true; $('pdf-controls').hidden = true;
    try {
      const response = await fetch(base + '/' + id + '/proof?preview=true', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Payment evidence could not be loaded. Use Open original or Download, or refresh the review.');
      const type = response.headers.get('content-type')?.split(';')[0];
      if (current !== reviewGeneration || !$('review').open) return;
      if (type === 'application/pdf') {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import(base + '/pdfjs/pdf.mjs');
        if (current !== reviewGeneration || !$('review').open) return;
        pdfjs.GlobalWorkerOptions.workerSrc = base + '/pdfjs/pdf.worker.mjs';
        pdfTask = pdfjs.getDocument({data:bytes,isEvalSupported:false,enableXfa:false,useSystemFonts:true});
        const document = await pdfTask.promise;
        if (current !== reviewGeneration || !$('review').open) { void document.destroy(); return; }
        pdfDocument = document; pdfPage = 1; $('pdf-controls').hidden = false;
        await renderPdfPage(1);
      } else if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) {
        const blob = await response.blob(); if (current !== reviewGeneration || !$('review').open) return;
        proofUrl = URL.createObjectURL(blob);
        const image = node('img'); image.alt = 'Submitted payment evidence'; image.src = proofUrl;
        image.onerror = () => { if (current === reviewGeneration) $('proof-preview').replaceChildren(node('p', 'This image could not be decoded. Download the original to inspect it.')); };
        $('proof-preview').replaceChildren(image); $('zoom-controls').hidden = false;
      } else $('proof-preview').replaceChildren(node('p', 'This file type cannot be previewed safely. Download the original to review it.'));
    } catch (error) { if (current === reviewGeneration) $('proof-preview').replaceChildren(node('p', errorText(error))); }
  }
  function addDetails(target, values) {
    target.replaceChildren(...values.map(([label, value]) => { const row = node('div', undefined, 'detail-row'); row.append(node('dt', label), node('dd', value || '—')); return row; }));
  }
  function warnings(data) {
    const entries = data.relatedSubmissions.map(row => row.reason + ' · ' + row.reference);
    entries.push(...data.sessionConflicts.map(row => 'Another approved signup has this onboarding time · ' + row.reference));
    const date = $('session-date').value, time = $('session-time').value;
    if (Date.parse(date + 'T' + time + ':00+08:00') <= Date.now()) entries.push('This onboarding time is in the past. Choose a new time or confirm your reviewed decision explicitly.');
    if (data.existingAccount?.inactive) entries.push('This email belongs to an inactive account. Resolve it before approving.');
    $('warnings').replaceChildren(...(entries.length ? entries.map(text => node('li', text)) : [node('li', 'No matching submissions or approved-session conflicts found.', 'clear')]));
    $('warnings-wrap').hidden = entries.length === 0;
    return entries.length > 0;
  }
  function renderDetail(data, reset) {
    detail = data; mailConfigured = data.mailConfigured;
    const row = data.submission;
    $('review-reference').textContent = row.reference;
    $('review-title').textContent = row.status === 'approved' ? 'Approved signup' : 'Review signup';
    $('review-content').hidden = false;
    addDetails($('customer-details'), [['Customer', row.customer_name], ['Email', row.customer_email], ['Phone', row.customer_phone],
      ['Package', row.package_name], ['Amount', 'SGD ' + row.amount_sgd], ['Bank transaction', row.bank_transaction_id],
      ['Requested session', row.session_date + ' · ' + row.session_time + ' SGT'], ['Submitted', dateTime(row.created_at)]]);
    if (reset) {
      $('session-date').value = row.confirmed_session_date || row.session_date;
      $('session-time').value = row.confirmed_session_time || row.session_time;
      for (const id of ['payment-verified','session-confirmed','link-existing','warnings-ack','unknown-ack']) $(id).checked = false;
      $('approval-confirm').hidden = true; $('approval-action').hidden = false;
    }
    warnings(data);
    const existing = data.existingAccount;
    $('account-plan').textContent = row.account_kind === 'new' ? 'A new customer account was created. Its access message is available below for manual sharing.' :
      existing ? 'An account already uses this email. Link it explicitly; its password and existing data will stay unchanged.' :
      'Approval will create one customer account and a securely generated temporary password. The email recommends changing it after login.';
    $('link-existing-wrap').hidden = !existing || row.status === 'approved';
    $('link-existing-copy').textContent = existing ? 'Link the existing account for ' + existing.name + ' (' + existing.email + '). Do not change its password.' : '';
    $('email-to').textContent = 'To: ' + row.customer_email;
    $('email-subject').textContent = data.emailPreview.subject;
    $('email-preview').textContent = data.emailPreview.text;
    $('email-title').textContent = row.status === 'approved' ? 'Access message · ready to share' : 'Access email preview';
    $('email-caption').textContent = row.status === 'approved'
      ? 'Copy this message to share the login instructions yourself. Copying does not send an email or change its delivery status.'
      : data.mailConfigured ? 'This transactional email is sent after approval. Provider acceptance is recorded separately from inbox delivery.'
      : 'Email is awaiting sender setup. Approval will queue these access details securely; it will not report them as sent.';
    $('access-notice').hidden = !data.accessMessageNotice;
    $('access-notice').textContent = data.accessMessageNotice || '';
    $('copy-access').hidden = row.status !== 'approved' || !data.manualShareAvailable;
    $('copy-message').textContent = '';
    $('approval-fields').hidden = row.status === 'approved'; $('approval-action').hidden = row.status === 'approved';
    $('approved-state').hidden = row.status !== 'approved';
    $('approve').textContent = data.mailConfigured ? 'Approve & send access email' : 'Approve & queue access email';
    if (row.status === 'approved') {
      $('approval-confirm').hidden = true;
      let actor = row.approved_by; try { actor = JSON.parse(actor).name; } catch { /* legacy display */ }
      addDetails($('approved-details'), [['Approved', dateTime(row.approved_at)], ['Reviewed by', actor], ['Account', row.account_kind === 'new' ? 'Created' : 'Existing account linked'],
        ['Confirmed session', row.confirmed_session_date + ' · ' + row.confirmed_session_time + ' SGT'], ['Access email', emailLabel(row)],
        ['Last attempt', dateTime(row.email_attempted_at)], ['Provider accepted', dateTime(row.email_accepted_at)], ['Message ID', row.email_message_id]]);
      $('email-problem').hidden = !row.email_error; $('email-problem').textContent = row.email_error || '';
      $('unknown-wrap').hidden = !['unknown','sending'].includes(row.email_status);
      $('send-email').hidden = row.email_status === 'sent';
      $('send-email').textContent = ['failed','unknown','sending'].includes(row.email_status) ? 'Retry access email' : 'Send queued email';
    }
    $('history').replaceChildren(node('li', 'Signup and private payment evidence received · ' + dateTime(row.created_at)), ...data.history.map(event => {
      let actor = event.actor; try { actor = JSON.parse(actor).name; } catch { /* legacy display */ }
      const li = node('li', event.event); li.append(node('small', dateTime(event.created_at) + ' · ' + actor)); return li;
    }));
    setBusy(false);
  }
  async function openReview(id) {
    const current = ++reviewGeneration;
    $('review-content').hidden = true; $('review').showModal(); notify('review-message', 'Loading signup…'); detail = null;
    try {
      const data = await api('/' + id); if (current !== reviewGeneration || !$('review').open) return;
      renderDetail(data, true); notify('review-message', '');
      $('proof-name').textContent = data.submission.proof_filename;
      $('open-proof').href = base + '/' + id + '/proof?preview=true';
      $('download-proof').href = base + '/' + id + '/proof'; $('download-proof').download = data.submission.proof_filename;
      void loadProof(id, current);
    } catch (error) { if (current === reviewGeneration) notify('review-message', errorText(error), true); }
  }
  function decision() {
    if (!$('decision-form').reportValidity()) throw new Error('Check the session details.');
    if (!$('payment-verified').checked || !$('session-confirmed').checked) throw new Error('Confirm that you verified the payment and the onboarding session.');
    if (detail.existingAccount && !$('link-existing').checked) throw new Error('Confirm linking the existing account without changing its password.');
    if (!$('warnings-wrap').hidden && !$('warnings-ack').checked) throw new Error('Review and acknowledge the duplicate or booking warnings.');
    return {paymentVerified:true,sessionConfirmed:true,sessionDate:$('session-date').value,sessionTime:$('session-time').value,
      warningsAcknowledged:$('warnings-ack').checked,
      ...(detail.existingAccount ? {linkExistingUserId:detail.existingAccount.userId} : {})};
  }
  $('review-approval').addEventListener('click', async () => {
    if (busy || !detail) return;
    try {
      const input = decision(); setBusy(true); notify('review-message', 'Checking the latest signup and session details…');
      const updated = await api('/' + detail.submission.id + '?sessionDate=' + encodeURIComponent(input.sessionDate) + '&sessionTime=' + encodeURIComponent(input.sessionTime));
      renderDetail(updated, false);
      if (updated.submission.status === 'approved') { notify('review-message','This signup was already approved. Its saved status is shown below.'); return; }
      decision();
      $('confirm-summary').textContent = 'Approve ' + updated.submission.customer_name + ' · SGD ' + updated.submission.amount_sgd +
        '. Confirm ' + input.sessionDate + ' at ' + input.sessionTime + ' SGT. ' + (updated.mailConfigured ? 'Send the access email to ' : 'Queue the access email for ') + updated.submission.customer_email + '.';
      $('approval-confirm').hidden = false; $('approval-action').hidden = true; notify('review-message', 'Review the email preview, then confirm approval.'); $('approve').focus();
    } catch (error) { notify('review-message', errorText(error), true); }
    finally { setBusy(false); }
  });
  $('decision-form').addEventListener('change', () => { $('approval-confirm').hidden = true; $('approval-action').hidden = detail?.submission.status === 'approved'; });
  $('cancel-confirm').addEventListener('click', () => { $('approval-confirm').hidden = true; $('approval-action').hidden = false; $('review-approval').focus(); });
  async function mutate(path, body, progress) {
    setBusy(true); notify('review-message', progress);
    try {
      const data = await api('/' + detail.submission.id + path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      renderDetail(data, true);
      notify('review-message', data.submission.email_status === 'sent' ? 'Signup approved. The access email was accepted by the email provider.' :
        data.submission.email_status === 'pending' ? 'Signup approved and account ready. The access email is queued' + (data.mailConfigured ? '.' : ' while email setup is pending.') :
        'Signup approved and account ready. The email needs attention; see its saved status below.');
      void load();
    } catch (error) {
      const message = errorText(error);
      try { renderDetail(await api('/' + detail.submission.id), false); void load(); } catch { /* keep review; refresh is available */ }
      notify('review-message', message, true);
    } finally { setBusy(false); }
  }
  $('decision-form').addEventListener('submit', event => {
    event.preventDefault(); if (busy || $('approval-confirm').hidden || !detail) return;
    try { const input = decision(); void mutate('/approve', input, 'Saving approval and preparing account access…'); }
    catch (error) { notify('review-message', errorText(error), true); }
  });
  $('send-email').addEventListener('click', () => {
    if (busy || !detail) return;
    if (!$('unknown-wrap').hidden && !$('unknown-ack').checked) { notify('review-message','Check the mail provider and acknowledge a possible duplicate before retrying.',true); return; }
    void mutate('/send-email', {acknowledgeUnknown:$('unknown-ack').checked}, 'Sending the queued access email…');
  });
  $('copy-access').addEventListener('click', async () => {
    if (busy || !detail?.manualShareAvailable) return;
    const message = 'To: ' + detail.submission.customer_email + '\nSubject: ' + detail.emailPreview.subject + '\n\n' + detail.emailPreview.text;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(message);
      $('copy-message').textContent = 'Access message copied. You can paste it into your message to the customer.';
    } catch {
      const text = node('textarea'); text.value = message; text.readOnly = true;
      text.style.position = 'fixed'; text.style.opacity = '0'; $('review').append(text); text.select();
      let copied = false; try { copied = document.execCommand('copy'); } catch { /* allow manual selection */ }
      text.remove(); $('copy-access').focus();
      $('copy-message').textContent = copied ? 'Access message copied. You can paste it into your message to the customer.' : 'Clipboard access was denied. Select the message above and copy it manually.';
    }
  });
  $('pdf-previous').addEventListener('click', () => { if (pdfDocument && pdfPage > 1) void renderPdfPage(pdfPage - 1); });
  $('pdf-next').addEventListener('click', () => { if (pdfDocument && pdfPage < pdfDocument.numPages) void renderPdfPage(pdfPage + 1); });
  $('zoom-in').addEventListener('click', () => { const image = $('proof-preview').querySelector('img'); if (image) image.style.width = (parseFloat(image.style.width) || 100) + 50 + '%'; });
  $('zoom-reset').addEventListener('click', () => { const image = $('proof-preview').querySelector('img'); if (image) image.style.width = '100%'; });
  $('close-review').addEventListener('click', () => { if (!busy) $('review').close(); });
  $('review').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('review').addEventListener('close', () => { ++reviewGeneration; releaseProof(); detail = null; $('email-preview').textContent = ''; $('copy-message').textContent = ''; });
  $('search-form').addEventListener('submit', event => { event.preventDefault(); void load(); });
  $('status-filter').addEventListener('change', renderRows);
  $('refresh').addEventListener('click', () => { void load(); });
  void load();
})();
