(() => {
  const checkbox = document.getElementById('enabled'), save = document.getElementById('save'), message = document.getElementById('message');
  const form = document.getElementById('preferences'), state = document.getElementById('preference-state'), open = document.getElementById('open-risk'), reload = document.getElementById('reload');
  const daily = document.getElementById('daily-enabled'), activity = document.getElementById('activity-enabled');
  let savedActivity, savedDaily, saved, revision, busy = false;
  function render() {
    checkbox.disabled = busy || saved === undefined;
    daily.disabled = busy || savedDaily === undefined;
    activity.disabled = busy || savedActivity === undefined;
    save.disabled = busy || saved === undefined || (saved === checkbox.checked && savedDaily === daily.checked && savedActivity === activity.checked);
    reload.disabled = busy;
    state.textContent = saved === undefined ? 'Preference unavailable' : checkbox.checked ? 'Risk will appear in your workspace' : 'Risk is hidden from your workspace';
    open.hidden = !saved;
    form.setAttribute('aria-busy', String(busy));
  }
  async function read(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Could not load settings. Please retry.');
    return body;
  }
  async function load() {
    busy = true; render(); message.classList.remove('error'); message.textContent = 'Loading your settings…';
    try {
      const result = await read(await fetch('/api/domain/invage/experience-settings', {credentials:'include'}));
      savedDaily = result.show_daily_changes === true; daily.checked = savedDaily;
      savedActivity = result.show_broker_activity === true; activity.checked = savedActivity;
      saved = result.account_risk === true; revision = result.revision; checkbox.checked = saved;
      message.textContent = saved ? 'Account Risk is on for your account.' : 'Account Risk is off. You can turn it on whenever you need it.';
    } catch (error) {message.textContent = error.message; message.classList.add('error');}
    finally {busy = false; render();}
  }
  checkbox.addEventListener('change', () => {message.textContent = 'You have unsaved changes.';message.classList.remove('error');render();});
  daily.addEventListener('change', () => {message.textContent = 'You have unsaved changes.';message.classList.remove('error');render();});
  activity.addEventListener('change', () => {message.textContent = 'You have unsaved changes.';message.classList.remove('error');render();});
  reload.addEventListener('click', load);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (save.disabled) return;
    busy = true; render(); message.textContent = 'Saving your preferences…';
    try {
      const result = await read(await fetch('/api/domain/invage/experience-settings', {method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_risk:checkbox.checked,show_daily_changes:daily.checked,show_broker_activity:activity.checked,revision})}));
      savedDaily = result.show_daily_changes === true;
      savedActivity = result.show_broker_activity === true;
      saved = result.account_risk; revision = result.revision;
      message.textContent = 'Saved. Updating your workspace…';
      // A fresh manifest prevents another user's preferences being retained in the shell.
      if (window.parent !== window) window.parent.location.reload();
      else message.textContent = 'Saved. Your workspace will use this preference on its next load.';
    } catch (error) {message.textContent = error.message;message.classList.add('error');}
    finally {busy = false;render();}
  });
  void load();
})();
