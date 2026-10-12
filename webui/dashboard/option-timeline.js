/* Read-only timeline. Contract tracks collect evidence, never infer a roll or a close. */
(function () {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = value => String(value || '').slice(0, 10);
  const stamp = value => Date.parse(`${day(value)}T00:00:00Z`);
  const contractKey = (channel, account, c, side) => JSON.stringify([channel, account, c.underlying?.toUpperCase(), c.right, side, Number(c.strike), c.expiry, Number(c.multiplier)]);

  function buildTracks(episodes, groups, context) {
    const tracks = new Map(), links = [];
    const visible = date => date && day(date) <= context.asOf;
    function track(channel, account, c, side) {
      const key = contractKey(channel, account, c, side);
      if (!tracks.has(key)) tracks.set(key, { key, channel, account, contract: c, side, events: [], spans: [], notes: [] });
      return tracks.get(key);
    }
    function event(t, id, date, kind, label) {
      if (visible(date) && !t.events.some(e => e.id === id)) t.events.push({ id, date: day(date), kind, label });
    }
    for (const row of episodes) {
      if (context.channel && row.channel !== context.channel) continue;
      if (!visible(row.first_seen) && !(row.executions || []).some(e => visible(e.executed_at)) && !(row.events || []).some(e => visible(e.date))) continue;
      const t = track(row.channel, row.account_id, row.contract, row.contract.side);
      const observations = row.observations.filter(o => visible(o.as_of));
      if (observations.length) {
        const dates = observations.map(o => o.as_of).sort();
        t.spans.push({ from: dates[0], to: dates.at(-1), projected: false });
        const stillObserved = !visible(row.first_seen_absent);
        if (stillObserved && row.contract.expiry > dates.at(-1)) {
          t.spans.push({ from: dates.at(-1), to: row.contract.expiry, projected: true });
        }
      }
      t.notes.push(context.replay ? observations.length ? `Observed through ${observations.map(o => o.as_of).sort().at(-1)}` : 'Recorded activity; no position observation by the selected date'
        : `${row.status.replaceAll('_', ' ')} · last observed ${row.last_seen_open}`);
      for (const fill of row.executions || []) {
        event(t, `fill:${fill.execution_id}`, fill.executed_at, fill.effect,
          `${fill.side.toUpperCase()} to ${fill.effect} · ${fill.contracts} contracts · ${fill.executed_at}`);
      }
      for (const e of row.events || []) event(t, `event:${e.id}`, e.date, 'terminal', `${e.kind.replaceAll('_', ' ')} · ${e.contracts} contracts · ${e.date}`);
      if (visible(row.first_seen_absent)) event(t, `absent:${row.id}`, row.first_seen_absent, 'absent', 'First observed absent; this alone does not establish a close');
    }
    for (const group of groups) for (const r of group.relationships) {
      if (!visible(r.through) || context.channel && r.channel !== context.channel) continue;
      const old = track(r.channel, r.account_id, r.old, r.side);
      const next = track(r.channel, r.account_id, r.replacement, r.side);
      // Archive-only tracks represent trade evidence, not a current position.
      event(old, `roll-close:${r.id}`, r.at, 'close', `Roll closing leg · ${r.closed_quantity} contracts`);
      event(next, `roll-open:${r.id}`, r.through, r.replacement_effect === 'open' ? 'open' : 'unknown', `Replacement leg · ${r.opened_quantity} contracts · effect ${r.replacement_effect}`);
      links.push({ from: old.key, to: next.key, date: day(r.at), through: day(r.through), evidence: r.evidence, reason: r.reason, id: r.id });
    }
    for (const p of context.positions || []) {
      if (p.instrument !== 'option' || !p.option) continue;
      // Match only within the selected channel; do not attach an unknown account to another account's history.
      const candidates = [...tracks.values()].filter(t => t.channel === p.channel &&
        contractKey('', '', t.contract, t.side) === contractKey('', '', p.option, p.option.side));
      if (candidates.length === 1 && candidates[0].spans.length) continue;
      const c = { ...p.option, currency: p.currency };
      const t = track(p.channel, '', c, c.side);
      const detail = context.tradeDetails[p.ticker];
      const observed = context.replay ? context.asOf : context.brokerAsOf[p.channel];
      if (observed && visible(observed)) {
        t.spans.push({ from: detail?.openedFrom && detail.openedFrom <= observed ? detail.openedFrom : observed, to: observed, projected: false });
        if (c.expiry > observed) t.spans.push({ from: observed, to: c.expiry, projected: true });
      }
      if (detail) {
        event(t, `position:${p.ticker}`, detail.openedFrom, 'open', `Matched opening fills · ${detail.openedFrom}${detail.openedTo !== detail.openedFrom ? ` to ${detail.openedTo}` : ''}`);
      }
      t.notes.push(context.replay ? 'Saved valuation position; not broker confirmation' : observed ? `Position as of ${observed}` : 'Opening date and broker position date unavailable');
    }
    for (const t of tracks.values()) {
      const recorded = [...t.events.map(e => e.date), ...t.spans.filter(s => !s.projected).map(s => s.from)].sort();
      const first = recorded[0];
      // This is an evidence boundary, not an estimated opening date or holding period.
      t.unknownStart = first && !t.events.some(e => e.kind === 'open' && e.date <= first) ? first : null;
    }
    return { tracks: [...tracks.values()].sort((a, b) => a.contract.underlying.localeCompare(b.contract.underlying) || a.channel.localeCompare(b.channel) || a.contract.expiry.localeCompare(b.contract.expiry)), links };
  }

  window.createOptionTimeline = function (getContext) {
    const chart = document.getElementById('timelineChart'), status = document.getElementById('timelineStatus'), detail = document.getElementById('timelineDetail');
    const search = document.getElementById('timelineSearch'), right = document.getElementById('timelineRight');
    let data = { episodes: [], groups: [], gaps: [] }, request = 0, loadedKey = '', pendingKey = '', limited = false;
    let current = { tracks: [], links: [] };
    const label = t => `${t.contract.underlying} ${t.side} ${t.contract.right} ${t.contract.strike} · ${t.contract.expiry}`;
    function render() {
      const context = getContext();
      current = buildTracks(data.episodes, data.groups, context);
      const q = search.value.trim().toUpperCase();
      current.tracks = current.tracks.filter(t => (!right.value || t.contract.right === right.value) && (!q || label(t).toUpperCase().includes(q)));
      if (!current.tracks.length) {
        chart.innerHTML = '<div class="metric-card empty">No option records match this timeline. Broker syncs and imported fills provide the history.</div>';
        return;
      }
      const rows = current.tracks;
      const dates = [context.asOf, ...rows.flatMap(t => [t.contract.expiry, ...t.events.map(e => e.date), ...t.spans.flatMap(s => [s.from, s.to])])].map(stamp).filter(Number.isFinite);
      const firstDate = Math.min(...dates), lastDate = Math.max(...dates);
      const leadInRoom = rows.some(t => t.unknownStart) ? (lastDate - firstDate) * 0.09 : 0;
      const start = firstDate - Math.max(3 * 86400000, leadInRoom), end = lastDate + 3 * 86400000;
      const left = 290, width = 1080, plot = width - left - 36, rowHeight = 68, height = 80 + rows.length * rowHeight;
      const x = d => left + (stamp(d) - start) / (end - start) * plot;
      const y = i => 87 + i * rowHeight;
      const ticks = Array.from({ length: 7 }, (_, i) => new Date(start + i * (end - start) / 6).toISOString().slice(0, 10));
      const grid = ticks.map(d => `<line class="timeline-grid" x1="${x(d)}" x2="${x(d)}" y1="50" y2="${height}"/><text class="timeline-tick" x="${x(d)}" y="37" text-anchor="middle">${d}</text>`).join('');
      const lanes = rows.map((t, i) => {
        const cy = y(i), c = t.contract;
        const spans = t.spans.map(s => `<line class="timeline-span${s.projected ? ' projected' : ''}" x1="${x(s.from)}" x2="${x(s.to)}" y1="${cy}" y2="${cy}"><title>${esc(`${s.projected ? 'Remaining time to expiry' : 'Observed position'}: ${s.from} to ${s.to}`)}</title></line>`).join('');
        const leadX = t.unknownStart ? Math.max(left, x(t.unknownStart) - 56) : 0;
        const leadIn = t.unknownStart ? `<g class="timeline-unknown-start"><title>Earlier history unavailable; opening date is unknown before ${esc(t.unknownStart)}</title>
          <line x1="${leadX}" x2="${x(t.unknownStart)}" y1="${cy}" y2="${cy}"/>
          <path d="M ${leadX + 5} ${cy - 4} L ${leadX} ${cy} L ${leadX + 5} ${cy + 4}"/></g>` : '';
        const events = [...t.events].sort((a, b) => Number(a.kind !== 'absent') - Number(b.kind !== 'absent')).map(e => `<circle class="timeline-event ${esc(e.kind)}" cx="${x(e.date)}" cy="${cy}" r="5"><title>${esc(e.label)}</title></circle>`).join('');
        return `<g data-timeline-row="${i}" tabindex="0" role="button" aria-label="${esc(label(t))}. Show evidence">
          <rect class="timeline-lane" x="0" y="${cy - 25}" width="${width}" height="${rowHeight - 2}"/>
          <text class="timeline-label" x="12" y="${cy - 6}">${esc(`${c.underlying} · ${t.side} ${c.right} ${c.strike}`)}</text>
          <text class="timeline-sub" x="12" y="${cy + 14}">${esc(`${t.channel}${t.account ? ` / ${t.account}` : ''} · expiry ${c.expiry}`)}</text>
          ${leadIn}${spans}${events}<path class="timeline-expiry" d="M ${x(c.expiry)} ${cy - 6} l 6 6 -6 6 -6 -6 Z"><title>Contract expiry ${esc(c.expiry)}; not confirmation of expiration</title></path>
        </g>`;
      }).join('');
      const links = current.links.map(l => {
        const a = rows.findIndex(t => t.key === l.from), b = rows.findIndex(t => t.key === l.to);
        if (a < 0 || b < 0) return '';
        const x1 = x(l.date), x2 = x(l.through), y1 = y(a) + 8, y2 = y(b) - 8;
        return `<path class="timeline-roll ${['possible', 'review'].includes(l.evidence) ? 'possible' : ''}" d="M ${x1} ${y1} C ${x1 + 24} ${y1}, ${x2 + 24} ${y2}, ${x2} ${y2}" marker-end="url(#timelineArrow)"><title>${esc(`${l.evidence} roll relationship: ${l.reason}`)}</title></path>`;
      }).join('');
      chart.innerHTML = `<div class="timeline-legend"><span class="timeline-open-key">● Open</span><span class="timeline-close-key">● Close</span><span>◇ Expiry date</span><span>○ First absent / unverified effect</span><span>↳ Roll relationship</span><span>⋯ Earlier history unavailable</span></div>
        <div class="timeline-scroll" tabindex="0" role="region" aria-label="Option timeline; scroll horizontally to explore dates"><svg class="option-timeline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Option activity through ${context.asOf}">
        <defs><marker id="timelineArrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor"/></marker></defs>${grid}${lanes}${links}
        <line class="timeline-today" x1="${x(context.asOf)}" x2="${x(context.asOf)}" y1="48" y2="${height}"/><text class="timeline-tick" x="${x(context.asOf)}" y="17" text-anchor="middle">${context.replay ? 'As of' : 'Today'} ${context.asOf}</text></svg></div>`;
    }
    async function pages(endpoint, field, params, id) {
      const out = [], gaps = []; let offset = 0;
      for (let page = 0; page < 10; page++) {
        params.set('offset', String(offset)); params.set('limit', '100');
        const response = await fetch(`/api/domain/invage/${endpoint}?${params}`, { credentials: 'include' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
        if (id !== request) return null;
        out.push(...body[field]); if (page === 0) gaps.push(...(body.gaps || []));
        if (body.next_offset == null) return { rows: out, gaps, limited: false };
        offset = body.next_offset;
      }
      return { rows: out, gaps, limited: true };
    }
    async function load(force = false) {
      const context = getContext(), key = JSON.stringify([context.channel, context.asOf, context.replay]);
      if (!force && pendingKey === key) return;
      if (!force && loadedKey === key) { render(); return; }
      const id = ++request; pendingKey = key; status.textContent = 'Loading option timeline…'; detail.innerHTML = ''; chart.innerHTML = '';
      const historyParams = new URLSearchParams({ status: 'all' });
      const rollParams = new URLSearchParams({ as_of: context.asOf });
      if (context.channel) { historyParams.set('channel', context.channel); rollParams.set('channel', context.channel); }
      try {
        const results = await Promise.allSettled([pages('option-history', 'episodes', historyParams, id), pages('option-relationships', 'groups', rollParams, id)]);
        if (id !== request) return;
        const history = results[0].status === 'fulfilled' ? results[0].value : null;
        const rolls = results[1].status === 'fulfilled' ? results[1].value : null;
        data = { episodes: history?.rows || [], groups: rolls?.rows || [], gaps: [...(history?.gaps || []), ...(rolls?.gaps || [])] };
        limited = Boolean(history?.limited || rolls?.limited);
        loadedKey = results.every(r => r.status === 'fulfilled') ? key : '';
        const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
        render();
        status.textContent = `${current.tracks.length} contract tracks · history through ${context.asOf}${limited ? ' · Showing up to 1,000 history records and 1,000 roll groups; select a broker to narrow the view' : ''}${data.gaps.length ? ` · ${data.gaps.length} history coverage gaps` : ''}${errors.length ? ` · Partial timeline: ${errors.join('; ')}. Use Refresh timeline to retry.` : ''}`;
      } finally { if (id === request) pendingKey = ''; }
    }
    function showEvidence(target) {
      const node = target.closest('[data-timeline-row]'); if (!node) return;
      const t = current.tracks[Number(node.dataset.timelineRow)];
      const links = current.links.filter(l => l.from === t.key || l.to === t.key);
      detail.innerHTML = `<div class="metric-card timeline-detail"><h3>${esc(label(t))}</h3><p>${esc(t.channel)}${t.account ? ` / ${esc(t.account)}` : ''}</p>
        <p>${esc([...new Set(t.notes)].join(' · ') || 'Archive trade evidence; current position status is not confirmed.')}</p>
        ${t.unknownStart ? '<p><strong>Earlier history unavailable.</strong> The dashed lead-in indicates missing opening records; its length does not represent a known holding period.</p>' : ''}
        <ul>${t.events.map(e => `<li>${esc(e.date)} · ${esc(e.label)}</li>`).join('')}</ul>
        ${links.map(l => `<p><strong>${esc(l.evidence)} roll relationship</strong> · ${esc(l.date)}: ${esc(l.reason)}</p>`).join('')}</div>`;
    }
    chart.addEventListener('click', e => showEvidence(e.target));
    chart.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key) && e.target.closest('[data-timeline-row]')) { e.preventDefault(); showEvidence(e.target); } });
    search.addEventListener('input', () => { detail.innerHTML = ''; render(); });
    right.addEventListener('change', () => { detail.innerHTML = ''; render(); });
    document.getElementById('timelineRefresh').addEventListener('click', () => load(true));
    return { load };
  };
  // Pure evidence transformation is also available to fixture-based browser tests.
  window.buildOptionTimelineTracks = buildTracks;
})();
