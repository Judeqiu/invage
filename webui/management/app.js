(function () {
  'use strict';
  const $ = id => document.getElementById(id), base = '/api/domain/invage/management';
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const status = (section, text, kind = '') => {
    const element = $(section + '-status');
    element.textContent = text;
    element.dataset.error = String(kind === 'error');
    element.dataset.success = String(kind === 'success');
  };
  const sections = ['users', 'access', 'dates'];
  let selected = 'users', locked = false, inviteLink = '', selectedGeneration = 0;
  const loaded = {users:false, access:false, dates:false};
  const inFlight = {}, scroll = {users:0, access:0, dates:0};
  let subscribers = [], billingEnabled = false, inviteCodes = [], userGeneration = 0;
  let confirmedDates = new Set(), datesRevision = 0;
  const pendingDates = new Map(), dateFailures = new Map();
  const singaporeToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const today = singaporeToday();
  let month = new Date(today.slice(0, 7) + '-01T00:00:00Z'), calendarFocus = today;
  const dateLabel = date => new Intl.DateTimeFormat('en-SG', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date + 'T00:00:00Z'));
  const weekdayLabel = date => new Intl.DateTimeFormat('en-SG', {weekday:'long',timeZone:'UTC'}).format(new Date(date + 'T00:00:00Z'));
  const dateTimeLabel = value => {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-SG', {day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Singapore'}).format(date) : String(value);
  };
  const subscription = user => !billingEnabled ? 'Billing off' : user.subscription ? user.subscription.planId + ' · ' + user.subscription.status : 'Not recorded';
  function denyAccess(message) {
    locked = true;
    subscribers = [];inviteCodes = [];confirmedDates.clear();pendingDates.clear();
    for (const name of sections) $(name + '-section').hidden = true;
    $('users').replaceChildren();$('invites').replaceChildren();$('disabled-dates').replaceChildren();
    $('calendar-days').replaceChildren();$('details').replaceChildren();$('new-invite').hidden = true;
    $('user-details').close();$('details-title').textContent = '';$('details-email').textContent = '';inviteLink = '';
    $('new-code').textContent = '';$('invite-link').removeAttribute('href');$('message').textContent = message;$('message').hidden = false;
  }
  async function api(path, options = {}) {
    const response = await fetch(base + path, {credentials:'same-origin',cache:'no-store',...options});
    let data;
    try { data = await response.json(); } catch {
      if ([401,403].includes(response.status)) denyAccess('Your manager access has changed. Please sign in again.');
      throw new Error('The server response could not be confirmed. Refresh and try again.');
    }
    if (!response.ok) {
      if ([401,403].includes(response.status)) denyAccess(data.error || 'Your manager access has changed. Please sign in again.');
      throw new Error(data.error || 'Management is unavailable. Please retry.');
    }
    if (locked) throw new Error('Your manager access has changed. Please sign in again.');
    return data;
  }
  function emptyRow(columns, message) {
    const row = node('tr'), cell = node('td', message, 'empty-state');cell.colSpan = columns;row.append(cell);return row;
  }
  function renderUsers() {
    $('users').replaceChildren(...subscribers.map(user => {
      const row = node('tr'), name = node('td'), identity = node('div', undefined, 'user-name');
      const initials = (user.displayName || '?').trim().split(/\s+/).map(part => part[0]).slice(0,2).join('').toUpperCase();
      const avatar = node('span', initials, 'avatar');avatar.setAttribute('aria-hidden','true');
      const contact = node('div');contact.append(node('strong', user.displayName), node('small', user.email));identity.append(avatar, contact);name.append(identity);
      const plan = node('td');plan.append(node('span', subscription(user), 'badge'));
      const reference = node('td');reference.append(node('span', user.reference || '—', user.reference ? 'badge reference' : 'muted'));
      const usage = node('td');usage.append(node('strong', user.usage ? String(user.usage.lifetimeCredits) : 'Not recorded'));
      if (user.usage) usage.append(node('small', user.usage.periodCredits + ' this period'));
      const action = node('td'), button = node('button', 'View', 'secondary row-action');button.type = 'button';
      button.setAttribute('aria-label','View ' + user.displayName);button.addEventListener('click', () => void showUser(user.userId));action.append(button);
      row.append(name, plan, reference, usage, node('td', dateTimeLabel(user.createdAt)), action);return row;
    }));
    if (!subscribers.length) $('users').append(emptyRow(6,'No subscribers match this search.'));
    $('user-count').textContent = subscribers.length + (subscribers.length === 1 ? ' subscriber' : ' subscribers') + ' shown';
  }
  function renderDetails(user) {
    $('details-title').textContent = user.displayName;$('details-email').textContent = user.email;
    const values = [['User ID', user.userId], ['Joined', dateTimeLabel(user.createdAt)], ['Reference', user.reference],
      ['Subscription', subscription(user)], ['Period end', user.subscription?.currentPeriodEnd ? dateTimeLabel(user.subscription.currentPeriodEnd) : null],
      ['Credits this period', user.usage?.periodCredits], ['Lifetime credits', user.usage?.lifetimeCredits]];
    $('details').replaceChildren(...values.map(([label,value]) => {
      const row = node('div');row.append(node('dt',label), node('dd',value == null || value === '' ? 'Not recorded' : String(value)));return row;
    }));
  }
  async function showUser(id) {
    const current = ++selectedGeneration, user = subscribers.find(value => value.userId === id);
    if (!user || locked) return;
    renderDetails(user);status('details','Checking latest details…');$('user-details').showModal();document.body.style.overflow = 'hidden';
    try {
      const data = await api('/users/' + encodeURIComponent(id));
      if (current !== selectedGeneration || !$('user-details').open) return;
      billingEnabled = data.billingEnabled;renderDetails(data.user);status('details','Up to date');
    } catch (error) {
      if (current === selectedGeneration) status('details',error.message,'error');
    }
  }
  async function users() {
    const current = ++userGeneration, query = $('search').value.trim();
    $('refresh-users').disabled = true;status('users',loaded.users ? 'Updating subscribers…' : 'Loading subscribers…');
    if (!loaded.users) $('users').replaceChildren(emptyRow(6,'Loading subscribers…'));
    try {
      const data = await api('/users?q=' + encodeURIComponent(query));
      if (current !== userGeneration) return;
      subscribers = data.users;billingEnabled = data.billingEnabled;loaded.users = true;renderUsers();status('users','');
    } catch (error) {
      if (current === userGeneration) {
        status('users',error.message,'error');
        if (!loaded.users) $('users').replaceChildren(emptyRow(6,'Subscribers could not be loaded. Use Refresh to retry.'));
      }
    }
    finally { if (current === userGeneration) $('refresh-users').disabled = false; }
  }
  function renderInvites() {
    $('invites').replaceChildren(...inviteCodes.map(code => {
      const row = node('tr'), state = node('td');state.append(node('span',code.usedAt ? 'Used' : 'Unused','badge' + (code.usedAt ? '' : ' available')));
      row.append(node('td',code.code,'code'), node('td',code.recipientEmail || 'Generated at signup'),node('td',dateTimeLabel(code.createdAt)),node('td',code.comment || '—'),state);return row;
    }));
    if (!inviteCodes.length) $('invites').append(emptyRow(5,'No invites yet. Create a signup invite above.'));
    $('invite-count').textContent = inviteCodes.length + (inviteCodes.length === 1 ? ' invite' : ' invites');
  }
  let inviteRevision = 0;
  async function invites() {
    if (inFlight.access) return inFlight.access;
    const revision = inviteRevision;
    $('refresh-invites').disabled = true;status('access', loaded.access ? 'Updating invites…' : 'Loading invites…');
    const request = (async () => {
      try {
        const data = await api('/invites');
        const serverCodes = new Set(data.codes.map(code => code.code));
        inviteCodes = revision === inviteRevision ? data.codes : [...inviteCodes.filter(code => !serverCodes.has(code.code)),...data.codes];
        loaded.access = true;renderInvites();
        if (revision === inviteRevision) status('access','');
      } catch (error) { if (revision === inviteRevision) status('access',error.message,'error'); }
      finally { $('refresh-invites').disabled = false;delete inFlight.access; }
    })();
    inFlight.access = request;return request;
  }
  function visibleDisabledDates() {
    const dates = new Set(confirmedDates);
    for (const [date,enabled] of pendingDates) { if (enabled) dates.delete(date);else dates.add(date); }
    return dates;
  }
  function renderCalendar(focusDate = document.activeElement?.dataset.date) {
    const listFocus = document.activeElement?.dataset.reenable;
    const dates = visibleDisabledDates(), year = month.getUTCFullYear(), index = month.getUTCMonth();
    $('calendar-month').textContent = new Intl.DateTimeFormat('en-SG',{month:'long',year:'numeric',timeZone:'UTC'}).format(month);
    const prefix = year + '-' + String(index + 1).padStart(2,'0') + '-';
    calendarFocus = [focusDate,calendarFocus,today].find(date => date?.startsWith(prefix)) || prefix + '01';
    const days = [], leading = (month.getUTCDay() + 6) % 7, count = new Date(Date.UTC(year,index + 1,0)).getUTCDate();
    for (let day = 0;day < leading;day++) { const spacer = node('span');spacer.setAttribute('aria-hidden','true');days.push(spacer); }
    for (let day = 1;day <= count;day++) {
      const date = year + '-' + String(index + 1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
      const disabled = dates.has(date), pending = pendingDates.has(date), button = node('button',undefined,'day');
      button.type = 'button';button.tabIndex = date === calendarFocus ? 0 : -1;button.dataset.date = date;button.dataset.disabled = String(disabled);button.dataset.pending = String(pending);button.dataset.today = String(date === today);
      button.disabled = !loaded.dates;button.setAttribute('aria-disabled',String(!loaded.dates || pending));
      button.setAttribute('aria-pressed',String(disabled));button.setAttribute('aria-busy',String(pending));
      button.setAttribute('aria-label',dateLabel(date) + ', ' + weekdayLabel(date) + ': ' + (pending ? 'saving' : disabled ? 'disabled; enable date' : 'enabled; disable date'));
      button.append(node('span',String(day),'day-number'),node('span',pending ? 'Saving…' : disabled ? 'Disabled' : 'Enabled','day-state'));
      button.addEventListener('click',() => void saveDate(date,disabled));
      button.addEventListener('focus',() => {calendarFocus = date;for (const day of $('calendar-days').querySelectorAll('button')) day.tabIndex = day === button ? 0 : -1;});
      days.push(button);
    }
    $('calendar-days').replaceChildren(...days);
    if (focusDate) $('calendar-days').querySelector('[data-date="' + focusDate + '"]')?.focus();
    $('disabled-count').textContent = String(dates.size);
    $('disabled-dates').replaceChildren(...[...dates].sort().map(date => {
      const row = node('li'), label = node('div'), pending = pendingDates.has(date);
      label.append(node('strong',dateLabel(date)),node('small',pending ? 'Saving…' : weekdayLabel(date)));
      const button = node('button',pending ? 'Saving…' : 'Enable','secondary row-action');button.type = 'button';button.disabled = pending;button.dataset.reenable = date;
      button.setAttribute('aria-label','Enable ' + dateLabel(date));button.addEventListener('click',() => void saveDate(date,true));row.append(label,button);return row;
    }));
    $('dates-empty').hidden = dates.size !== 0 || !loaded.dates;
    if (listFocus) {
      const next = $('disabled-dates').querySelector('[data-reenable="' + listFocus + '"]:not([disabled])') || $('disabled-dates').querySelector('button:not([disabled])') || $('disabled-title');
      next.focus();
    }
  }
  async function dates() {
    if (inFlight.dates || pendingDates.size) return inFlight.dates;
    const revision = datesRevision;
    $('refresh-dates').disabled = true;status('dates',loaded.dates ? 'Updating availability…' : 'Loading availability…');
    const request = (async () => {
      try {
        const data = await api('/signup-dates');
        if (revision !== datesRevision) return;
        confirmedDates = new Set(data.disabledDates);dateFailures.clear();loaded.dates = true;renderCalendar();
        status('dates',confirmedDates.size ? 'Availability is up to date.' : 'All dates are enabled, including weekends.');
      } catch (error) { if (revision === datesRevision) status('dates',error.message,'error'); }
      finally { $('refresh-dates').disabled = pendingDates.size > 0;delete inFlight.dates; }
    })();
    inFlight.dates = request;return request;
  }
  async function saveDate(date,enabled) {
    if (locked || !loaded.dates || pendingDates.has(date)) return;
    datesRevision++;dateFailures.delete(date);pendingDates.set(date,enabled);$('refresh-dates').disabled = true;
    renderCalendar();status('dates',dateLabel(date) + ': saving…');
    try {
      await api('/signup-dates/' + encodeURIComponent(date),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled})});
      if (enabled) confirmedDates.delete(date);else confirmedDates.add(date);
      status('dates',dateLabel(date) + (enabled ? ' is enabled.' : ' is disabled.') + (pendingDates.size > 1 ? ' Other changes are still saving…' : ' Saved.'),'success');
    } catch (error) {
      dateFailures.set(date,dateLabel(date) + ': ' + error.message + ' The previous display has been restored. Refresh to confirm the saved state before retrying.');
    } finally {
      pendingDates.delete(date);datesRevision++;
      if (dateFailures.size) status('dates',[...dateFailures.values()].join(' ') + (pendingDates.size ? ' Other changes are still saving…' : ''),'error');
      if (!locked) {
        const focused = document.activeElement?.dataset.date;
        renderCalendar(focused);$('refresh-dates').disabled = pendingDates.size > 0 || Boolean(inFlight.dates);
      }
    }
  }
  function tab(name, focus = false) {
    if (locked) return;
    scroll[selected] = window.scrollY;selected = name;
    for (const section of sections) {
      $(section + '-section').hidden = section !== name;
      $(section + '-tab').setAttribute('aria-selected',String(section === name));
      $(section + '-tab').tabIndex = section === name ? 0 : -1;
    }
    if (focus) $(name + '-tab').focus();
    window.scrollTo(0,scroll[name]);
    // Render retained content immediately; fetch current data without blanking it.
    if (name === 'users') void users();else if (name === 'access') void invites();else void dates();
  }
  for (const name of sections) {
    $(name + '-tab').addEventListener('click',() => tab(name));
    $(name + '-tab').addEventListener('keydown',event => {
      const index = sections.indexOf(name);
      const next = event.key === 'ArrowRight' ? sections[(index + 1) % sections.length] : event.key === 'ArrowLeft' ? sections[(index + sections.length - 1) % sections.length] : event.key === 'Home' ? sections[0] : event.key === 'End' ? sections.at(-1) : null;
      if (next) {event.preventDefault();tab(next,true);}
    });
  }
  for (const [id,delta] of [['previous-month',-1],['next-month',1]]) $(id).addEventListener('click',() => {month = new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth() + delta,1));renderCalendar();});
  $('current-month').addEventListener('click',() => {month = new Date(singaporeToday().slice(0,7) + '-01T00:00:00Z');renderCalendar();});
  $('calendar-days').addEventListener('keydown',event => {
    const date = event.target.dataset.date;
    const delta = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
    if (!date || !delta) return;
    event.preventDefault();const next = new Date(date + 'T00:00:00Z');next.setUTCDate(next.getUTCDate() + delta);
    month = new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth(),1));renderCalendar(next.toISOString().slice(0,10));
  });
  $('refresh-dates').addEventListener('click',() => void dates());
  $('refresh-invites').addEventListener('click',() => void invites());
  $('search-form').addEventListener('submit',event => {event.preventDefault();void users();});
  $('refresh-users').addEventListener('click',() => void users());
  $('close-details').addEventListener('click',() => $('user-details').close());
  $('user-details').addEventListener('close',() => {selectedGeneration++;document.body.style.overflow = '';});
  $('user-details').addEventListener('keydown',event => {
    if (event.key !== 'Tab') return;
    // A native dialog inside an iframe can otherwise tab into the parent shell.
    const elements = [...$('user-details').querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = elements[0], last = elements.at(-1);
    if (!first) {event.preventDefault();return;}
    if (event.shiftKey && (document.activeElement === first || !$('user-details').contains(document.activeElement))) {event.preventDefault();last.focus();}
    else if (!event.shiftKey && (document.activeElement === last || !$('user-details').contains(document.activeElement))) {event.preventDefault();first.focus();}
  });
  $('user-details').addEventListener('click',event => {if (event.target === $('user-details') && event.clientX < $('user-details').getBoundingClientRect().left) $('user-details').close();});
  $('invite-form').addEventListener('submit',async event => {
    event.preventDefault();if ($('create-invite').disabled || locked) return;
    $('create-invite').disabled = true;$('create-invite').textContent = 'Creating…';status('access','Creating signup invite…');
    inviteRevision++;
    try {
      const data = await api('/invites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comment:$('comment').value,recipientEmail:$('recipient-email').value,prefix:$('invite-prefix').value})});
      inviteRevision++;inviteLink = data.onboardUrl;$('new-code').textContent = data.code;$('invite-link').href = inviteLink;$('new-invite').hidden = false;
      inviteCodes = [data,...inviteCodes.filter(code => code.code !== data.code)];renderInvites();status('access','Signup invite created. Copy the link to share it.','success');
    } catch (error) { status('access',error.message + ' Refresh the invite list before retrying if the result is uncertain.','error'); }
    finally { $('create-invite').disabled = false;$('create-invite').textContent = 'Create signup invite'; }
  });
  $('copy-invite').addEventListener('click',async () => {
    try {await navigator.clipboard.writeText(inviteLink);status('access','Signup link copied.','success');}
    catch {status('access','Clipboard unavailable. Use Open signup link to copy its address.','error');}
  });
  renderCalendar();void users();
})();
