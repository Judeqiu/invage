(() => {
  const $ = id => document.getElementById(id);
  let payload = null, channel = channelFromQuery(), loading = false;
  if (channel === 'merged') channel = 'all';
  const name = ch => ({ all:'All', ibkr:'IBKR', moomoo:'MooMoo', tiger:'Tiger', webull:'Webull', default:'Unassigned' })[ch] || ch;
  const number = value => value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits:2 });
  const amount = (value, ccy) => value == null || !ccy ? '—' : money(value, ccy);
  const percent = (value, signed = false) => value == null ? '—' : `${signed && value > 0 ? '+' : ''}${value.toFixed(1)}%`;
  const safeSigned = (value, ccy) => value == null || !ccy ? '—' : signedMoney(value, ccy);
  const badge = (value, tone = 'muted') => `<span class="pill pill-${tone}">${esc(value)}</span>`;
  function table(columns, rows, totals = {}, helps = {}, caption = '') {
    return `<table class="positions-table"><caption class="sr-only">${esc(caption)}</caption><thead><tr>${columns.map(label => `<th scope="col"><span class="col-label">${esc(label)}${helps[label] ? ` <button type="button" class="help-dot" aria-label="About ${esc(label)}" data-help="${esc(helps[label])}">?</button>` : ''}</span>${totals[label] != null ? `<span class="column-total">${esc(totals[label])}</span>` : ''}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${columns.length}" class="empty">No recorded positions in this view.</td></tr>`}</tbody></table>`;
  }
  function stocksTable(rows, view, headerTotals = false) {
    const totals = view.totals;
    const markup = rows.map(row => `<tr><td><strong>${esc(row.ticker)}</strong></td><td>${number(row.shares)}</td><td>${amount(row.avgCost, view.ccy)}</td><td>${amount(row.cost, view.ccy)}</td><td>${amount(row.last, view.ccy)}${row.estimated ? '<small class="metric-sub">Market quote unavailable</small>' : ''}</td><td>${amount(row.value, view.ccy)}</td><td class="${toneClass(row.pnl)}">${safeSigned(row.pnl, view.ccy)}</td><td class="${toneClass(row.returnPct)}">${percent(row.returnPct, true)}</td><td>${percent(row.navPct)}</td><td>${row.covered == null ? '—' : `${number(row.covered)} / ${number(row.shares)}${row.idle > 0 ? ' ' + badge(number(row.idle) + ' idle', 'warning') : ''}`}</td><td>${esc(row.brokers.map(name).join(' · '))}</td></tr>`).join('');
    return table(globalThis.PositionsV2.equityColumns, markup, headerTotals ? {
      Shares:number(totals.shares), 'Total cost':amount(totals.cost, view.ccy), 'Market value':amount(totals.value, view.ccy),
      'Unrealized P&L':safeSigned(totals.pnl, view.ccy), Return:percent(totals.returnPct, true), Covered:totals.coveragePct == null ? '—' : percent(totals.coveragePct) + ' covered',
    } : {}, { Covered:'Recorded physical-delivery short calls matched to shares at the same broker channel. Coverage is capped at the shares held there. Missing or stale call records make coverage unavailable. This is not the broker’s collateral reservation.', '% of NAV':'Stock market value divided by NAV for the selected broker scope. A percentage above 100% is possible when short-option liabilities reduce NAV.' }, 'Long holdings in reporting currency');
  }
  function render() {
    const view = globalThis.PositionsV2.build(payload, channel);
    if (channel !== 'all' && !view.channels.includes(channel)) { channel = 'all'; writeChannelQuery(channel); return render(); }
    $('positionsFilters').innerHTML = `<span class="label-eyebrow">Broker</span>${['all', ...view.channels].map(ch => `<button type="button" class="chip-btn${ch === channel ? ' on' : ''}" data-channel="${esc(ch)}" aria-pressed="${ch === channel}">${esc(name(ch))}</button>`).join('')}`;
    $('positionsFreshness').textContent = `${view.stocks.length} ${view.stocks.length === 1 ? 'stock' : 'stocks'} · ${channel === 'all' ? 'combined across all brokers' : name(channel)} · ${view.dates.length ? view.dates.map(([ch, date]) => name(ch) + ' as of ' + date).join(' · ') : 'Broker dates unavailable'}`;
    $('stocksTable').innerHTML = stocksTable(view.stocks, view, true);
    $('positionsCash').innerHTML = `<span>Cash available <strong>${esc(amount(view.cash, view.ccy))}</strong> · ${esc(channel === 'all' ? 'All brokers' : name(channel))}</span><span>${esc(view.ccy || 'Currency unavailable')} · Recorded cash; not buying power</span>`;
    const rows = view.obligations.map(row => `<tr class="${row.highRisk ? 'risk-row' : ''}"><td><strong>${esc(row.ticker)}</strong>${row.stale ? '<small class="metric-sub">Broker date unverified</small>' : ''}</td><td>${amount(row.last, view.ccy)}</td><td>${number(row.shares)}</td><td>${number(row.putContracts)}</td><td>${amount(row.cashIfAssigned, view.ccy)}</td><td>${number(row.callContracts)}</td><td>${number(row.sharesIfCalled)}</td><td>${amount(row.premium, view.ccy)}${row.missingPremium ? `<small class="metric-sub">${row.missingPremium} unmatched; ${row.knownPremium ? 'known subtotal ' + esc(amount(row.premiumSubtotal, view.ccy)) : 'opening fills unavailable'}</small>` : ''}</td><td class="${toneClass(row.pnl)}">${safeSigned(row.pnl, view.ccy)}</td><td>${row.nearestDte == null ? '—' : row.nearestDte < 0 ? badge('Past expiry', 'warning') : `${row.nearestDte}d`}</td><td>${row.highRisk ? badge(`${row.highRisk} above 60%`, 'danger') : row.unscored ? badge('Unknown', 'muted') : badge('Clear', 'success')}${row.unscored ? `<small class="metric-sub">${row.unscored} unscored</small>` : ''}</td></tr>`).join('');
    $('obligationsTable').innerHTML = table(globalThis.PositionsV2.obligationColumns, rows,
      { 'Cash if assigned':amount(view.totals.cashIfAssigned, view.ccy), Premium:amount(view.totals.premium, view.ccy) },
      { Premium:'Reconciled opening proceeds, before fees, for still-open short options. Missing opening fills or FX leave the total unavailable; known subtotals are shown separately.', 'High risk':'Number of open short-option rows with matched-quote Prob. ITM above 60%. Missing matching quotes are unscored, never assumed safe.', 'Cash if assigned':'Gross physical-delivery short-put strike obligation, in reporting currency. Does not subtract available cash, premium or long-option protection.' }, 'Gross short-option assignment obligations');
    $('positionsFunds').hidden = !view.funds.length;
    $('fundsTable').innerHTML = view.funds.length ? stocksTable(view.funds, view) : '';
    $('positionsWarnings').hidden = !view.warnings.length;
    $('positionsWarnings').querySelector('ul').innerHTML = view.warnings.map(message => `<li>${esc(message)}</li>`).join('');
    $('positionsContent').setAttribute('aria-busy', 'false');
  }
  $('positionsFilters').addEventListener('click', event => {
    const button = event.target.closest('[data-channel]'); if (!button) return;
    channel = button.dataset.channel; writeChannelQuery(channel); render();
    $('positionsFilters').querySelector(`[data-channel="${CSS.escape(channel)}"]`)?.focus();
  });
  async function load(refresh = false) {
    if (loading) return;
    loading = true; $('positionsRefresh').disabled = true; $('positionsRetry').disabled = true;
    $('positionsError').hidden = true; $('positionsProgress').hidden = false;
    $('positionsProgress').setAttribute('aria-valuenow', '0'); $('positionsProgress').firstElementChild.style.width = '0%';
    $('positionsStatus').textContent = payload ? 'Updating prices and portfolio…' : 'Reading your portfolio records…';
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000);
    try {
      const fresh = await globalThis.PortfolioLoader.load({ refresh, signal:controller.signal,
        onSnapshot: cached => { payload = cached; render(); $('positionsStatus').textContent = `Snapshot ${cached.generatedAt || 'from the last successful load'} · Updating prices and portfolio…`; },
        onProgress: progress => {
          const value = Math.max(0, Math.min(6, progress.completedStages || 0));
          $('positionsProgress').setAttribute('aria-valuenow', String(value)); $('positionsProgress').firstElementChild.style.width = `${value / 6 * 100}%`;
          if (!payload) $('positionsStatus').textContent = `Loading portfolio · ${progress.stage || 'records'}${progress.positions != null ? ' · ' + number(progress.positions) + ' positions' : ''}`;
        },
      });
      payload = fresh; render();
      $('positionsStatus').textContent = `Portfolio valued ${fresh.generatedAt || 'now'} · Broker position dates shown below`;
      $('positionsProgress').setAttribute('aria-valuenow', '6');
    } catch (error) {
      $('positionsError').hidden = false;
      $('positionsError').querySelector('p').textContent = error.name === 'AbortError' ? 'Portfolio loading timed out. Please retry.' : error.message || 'Could not load positions.';
      $('positionsStatus').textContent = payload ? `Update failed · Showing snapshot ${payload.generatedAt || 'from the previous load'}` : 'Positions could not be loaded.';
      if (!payload) {
        const unavailable = '<p class="empty">Positions are unavailable. Use Retry loading above.</p>';
        $('stocksTable').innerHTML = unavailable; $('obligationsTable').innerHTML = unavailable;
      }
      $('positionsContent').setAttribute('aria-busy', 'false');
    } finally { clearTimeout(timer); loading = false; $('positionsRefresh').disabled = false; $('positionsRetry').disabled = false; $('positionsProgress').hidden = true; }
  }
  $('positionsRefresh').addEventListener('click', () => void load(true));
  $('positionsRetry').addEventListener('click', () => void load());
  void load();
})();
