const $ = id => document.getElementById(id);
async function refresh() {
  $('refresh').disabled = true;
  $('balance').hidden = true;
  $('message').textContent = 'Loading your credits…';
  try {
    const response = await fetch('/api/domain/invage/credits', {credentials:'same-origin',cache:'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Could not load your credits.');
    if (data.unlimited) { $('message').textContent = 'Admin accounts have unlimited credits.'; return; }
    $('remaining').textContent = data.remaining.toLocaleString('en-SG');
    $('used').textContent = `${data.used.toLocaleString('en-SG')} of ${data.limit.toLocaleString('en-SG')} credits used this week`;
    $('progress').max = data.limit;
    $('progress').value = data.used;
    const date = new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',weekday:'long',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(data.resetsAt));
    $('reset').textContent = `Next reset: ${date} (Singapore time)`;
    $('message').textContent = data.blocked ? 'Your weekly credits are used. AI chat will resume at the next reset.' : '';
    $('balance').hidden = false;
  } catch (error) {
    $('message').textContent = error.message || 'Could not load your credits. Please try again.';
  } finally { $('refresh').disabled = false; }
}
$('refresh').addEventListener('click', refresh);
refresh();
