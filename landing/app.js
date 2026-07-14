const form = document.getElementById('register-form');
const submitBtn = document.getElementById('submit-btn');
const formError = document.getElementById('form-error');
const formSection = document.getElementById('form-section');
const successSection = document.getElementById('success-section');
const slackLink = document.getElementById('slack-link');
const bindCommand = document.getElementById('bind-command');
const expiresAt = document.getElementById('expires-at');
const copyBtn = document.getElementById('copy-bind');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const displayName = form.display_name.value.trim();
  const email = form.email.value.trim();

  submitBtn.disabled = true;
  submitBtn.textContent = 'Connecting…';

  let res;
  try {
    res = await fetch('/api/onboard/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName, email }),
    });
  } catch (err) {
    showError('Network error. Check your connection and try again.');
    resetButton();
    return;
  }

  if (res.status === 400) {
    const body = await res.json().catch(() => ({ error: 'Invalid input.' }));
    showError(body.error ?? 'Invalid input.');
    resetButton();
    return;
  }
  if (!res.ok) {
    showError(`Server error (${res.status}). Please try again in a moment.`);
    resetButton();
    return;
  }

  const data = await res.json();
  showSuccess(data);
});

function resetButton() {
  submitBtn.disabled = false;
  submitBtn.textContent = 'Connect on Slack';
}

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
}

function hideError() {
  formError.hidden = true;
  formError.textContent = '';
}

function showSuccess(data) {
  formSection.hidden = true;
  successSection.hidden = false;
  slackLink.href = data.workspace_invite_url;
  bindCommand.textContent = data.bind_command;
  const expires = new Date(data.expires_at);
  expiresAt.textContent = expires.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

copyBtn.addEventListener('click', async () => {
  const text = bindCommand.textContent;
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied';
    setTimeout(() => { copyBtn.textContent = 'Copy command'; }, 1500);
  } catch (err) {
    const range = document.createRange();
    range.selectNodeContents(bindCommand);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    copyBtn.textContent = 'Selected — press ⌘C / Ctrl+C';
    setTimeout(() => { copyBtn.textContent = 'Copy command'; }, 2000);
  }
});
