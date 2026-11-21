(() => {
  const form = document.getElementById('preferences');
  const toggle = document.getElementById('enabled');
  const save = document.getElementById('save');
  const reload = document.getElementById('reload');
  const message = document.getElementById('message');
  const url = '/api/domain/invage/experience-settings';
  let saved, revision, busy = false;

  function render() {
    form.setAttribute('aria-busy', String(busy));
    toggle.disabled = busy || saved === undefined;
    save.disabled = toggle.disabled || toggle.checked === saved;
    reload.disabled = busy;
  }

  async function update(method) {
    const checked = toggle.checked;
    busy = true;
    render();
    message.classList.remove('error');
    message.textContent = method === 'GET' ? 'Loading your setting…' : 'Saving your setting…';
    try {
      const response = await fetch(url, { method, credentials: 'include', ...(method === 'PUT' ? {
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({premarket_options: checked, revision}),
      } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not load your setting.');
      saved = result.premarket_options === true;
      toggle.checked = saved;
      revision = result.revision;
      message.textContent = saved ? 'Daily short-put scan is on.' : 'Daily short-put scan is off.';
    } catch (error) {
      if (method === 'GET') saved = undefined;
      message.textContent = error.message;
      message.classList.add('error');
    } finally {
      busy = false;
      render();
    }
  }

  toggle.addEventListener('change', () => { message.textContent = 'You have an unsaved change.'; render(); });
  reload.addEventListener('click', () => { void update('GET'); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!save.disabled) void update('PUT');
  });
  void update('GET');
})();
