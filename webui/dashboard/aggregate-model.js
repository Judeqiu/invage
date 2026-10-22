/* Pure sync-time financial projections shared with the server. No DOM or network access. */
(() => {
  function build(payload) {
    payload = { ...payload, model: payload.model ? { ...payload.model, history: payload.model.history || [] } : null };
    const DEFAULT_CHANNEL = 'default', MERGED_CHANNEL_VIEW = 'merged', selectedChannel = 'merged';
function reportingCcyCode(view) {
  if (view && view.fxApplied && view.reportingCurrency) return view.reportingCurrency;
  if (view && view.reportingCurrency) return view.reportingCurrency;
  if (view && view.cashCurrency) return view.cashCurrency;
  return null;
}

function optionDateLabel(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '—';
  const [year, month, day] = ymd.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1];
  return mon ? `${day}-${mon}-${year}` : '—';
}

function resolveDashboardChannel(raw) {
  if (raw == null) return DEFAULT_CHANNEL;
  const t = String(raw).trim();
  return t.length === 0 ? DEFAULT_CHANNEL : t;
}

function optionUnderlyingLabel(option) {
  const raw = String(option.underlying || '').trim().toUpperCase();
  const embedded = raw.match(/^([A-Z][A-Z0-9.]*?)\s*(\d{6})([CP])(\d{8})$/);
  if (!embedded) return raw;
  const encodedDate = `20${embedded[2].slice(0, 2)}-${embedded[2].slice(2, 4)}-${embedded[2].slice(4, 6)}`;
  const encodedStrike = Number(embedded[4]) / 1000;
  return encodedDate === option.expiry && embedded[3] === (option.right === 'put' ? 'P' : 'C') &&
    encodedStrike === Number(option.strike) ? embedded[1] : raw;
}

function selectedTradeChannels(view) {
  return view.channelView === MERGED_CHANNEL_VIEW
    ? [...new Set([...(view.channels || []), ...(payload?.premiumJournal?.channels || [])])]
    : [view.channelView];
}

function tradeAmount(view, row, amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  const currency = reportingCcyCode(view);
  if (!currency) return null;
  const rate = row.currency === currency ? 1 : view.fxRates?.[row.currency];
  return Number.isFinite(rate) && rate > 0 ? Number(amount) * rate : null;
}

function recordedPremiumForView(view, date) {
  const journal = payload?.premiumJournal;
  const channels = selectedTradeChannels(view);
  const observed = new Set(journal?.channels || []);
  const missing = channels.filter(ch => !observed.has(ch));
  const rows = (journal?.daily || []).filter(row => channels.includes(row.channel) && row.date <= date);
  const conflictingRecords = (payload?.optionHistoryGaps || []).some(g => channels.includes(g.channel) && g.blocksTotals);
  const previousDay = new Date(`${date}T00:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const dailyFrom = previousDay.toISOString().slice(0, 10);
  const sum = (from, through) => {
    const selected = rows.filter(row => row.date >= from && row.date <= through);
    if (!journal?.available || !rows.length || conflictingRecords) return null;
    const amounts = selected.map(row => tradeAmount(view, row, row.gross_premium));
    return amounts.every(n => n != null) ? amounts.reduce((a, b) => a + b, 0) : null;
  };
  const fills = (payload?.optionAnalytics?.executions || []).filter(row => channels.includes(row.channel) && row.executed_at.slice(0, 10) <= date);
  const fees = fills.filter(row => row.executed_at.slice(0, 10) >= `${date.slice(0, 7)}-01`);
  const knownFees = fees.filter(row => row.commission != null).map(row => tradeAmount(view, row, -Number(row.commission)));
  const missingFees = fees.filter(row => row.commission == null).length;
  const historyGaps = (payload?.optionHistoryGaps || []).filter(g => channels.includes(g.channel));
  const dates = fills.map(row => row.executed_at.slice(0, 10)).sort();
  return { daily: sum(dailyFrom, date), dailyFrom, dailyDate: date,
    mtd: sum(`${date.slice(0, 7)}-01`, date), total: sum('', date), totalBasis: 'gross',
    fees: conflictingRecords ? null : fills.length && !fees.length ? 0 : fees.length && knownFees.length && knownFees.every(n => n != null) ? knownFees.reduce((a, b) => a + b, 0) : null,
    missingFees, partial: missing.length > 0 || historyGaps.length > 0, firstTrade: dates[0], lastTrade: dates.at(-1),
    reason: missing.length || historyGaps.length ? 'Recorded trades only · incomplete history · before fees' : 'Recorded option trades · before fees',
    totalReason: conflictingRecords ? 'Conflicting broker records need reconciliation' : 'No recorded option cash flow or currencies cannot be combined without FX' };
}

function recordedRealizedForView(view, date, from = '') {
  const channels = selectedTradeChannels(view);
  const historyGaps = (payload?.optionHistoryGaps || []).filter(g => channels.includes(g.channel));
  if (historyGaps.some(g => g.blocksTotals)) {
    return { value: null, reason: 'Conflicting broker records need reconciliation' };
  }
  const rows = (payload?.optionAnalytics?.profits || []).filter(r => channels.includes(r.channel) && r.date >= from && r.date <= date);
  const gaps = (payload?.optionAnalytics?.gaps || []).filter(g => channels.includes(g.channel) && g.date >= from && g.date <= date);
  const basis = rows.length ? rows.every(r => r.net != null) ? 'net'
    : rows.every(r => r.gross != null) ? 'gross' : 'mixed' : null;
  let value = null, excluded = gaps.length;
  for (const row of rows) {
    const amount = tradeAmount(view, row, basis === 'net' ? row.net : basis === 'gross' ? row.gross : row.gross ?? row.net);
    if (amount == null) { excluded++; continue; }
    value = (value ?? 0) + amount;
  }
  const observed = new Set(payload?.premiumJournal?.channels || []);
  const partial = excluded > 0 || historyGaps.length > 0 || basis === 'mixed' || channels.some(ch => !observed.has(ch));
  const feeLabel = basis === 'net' ? 'After reported fees' : basis === 'gross' ? 'Before fees' : 'Fees partly included';
  return { value, basis, partial, excluded,
    reason: value == null ? 'No calculable completed option results or FX unavailable'
      : `${feeLabel} · Recorded history through ${optionDateLabel(date)}${partial ? ' · Partial subtotal' : ''}` };
}

function fundIndex(value, cost) {
  // Short-option credits make totalCost non-positive; use abs only when cost is
  // strictly positive (equity-style). Otherwise treat as flat 100 base.
  if (cost > 0) return (value / cost) * 100;
  if (cost < 0) return cost !== 0 ? (value / Math.abs(cost)) * 100 : 100;
  return 100;
}

/** Prefer equity-only cost/value for SPY fund-index when options are present. */
function portfolioFundIndex(view) {
  if (view.equityCost != null && view.equityCost > 0 && view.equityValue != null) {
    return fundIndex(view.equityValue, view.equityCost);
  }
  return fundIndex(view.totalValue, view.totalCost);
}

/* ---------- benchmark ---------- */

function benchBase() {
  const b = payload?.benchmark;
  if (!b) return null;
  const base = b.closes?.[b.baseDate];
  return base != null && base > 0 ? base : null;
}

/** SPY price for a view date: live → current price, archive → close map. */
function benchPriceAt(dateKey) {
  const b = payload?.benchmark;
  if (!b) return null;
  if (dateKey === 'live') return b.currentPrice ?? null;
  return b.closes?.[dateKey] ?? null;
}

function benchIndexAt(dateKey) {
  const base = benchBase();
  const price = benchPriceAt(dateKey);
  if (base == null || price == null) return null;
  return (price / base) * 100;
}

/* ---------- view model ---------- */

function reweightPositions(positions, cashAmount, depositsAmount = 0) {
  const absPositions = positions.reduce((s, p) => s + Math.abs(p.value), 0);
  const absSum =
    absPositions +
    (cashAmount != null ? Number(cashAmount) : 0) +
    (depositsAmount != null ? Number(depositsAmount) : 0);
  return positions
    .map((p) => ({
      ...p,
      channel: resolveDashboardChannel(p.channel),
      label: p.label || p.ticker,
      instrument: p.instrument || 'equity',
      weightPct: absSum > 0 ? (Math.abs(p.value) / absSum) * 100 : 0,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function normalizeDeposits(list) {
  return (list || []).map((d) => ({
    ...d,
    channel: resolveDashboardChannel(d.channel),
  }));
}

/**
 * Apply channel filter to a base view (merged or single channel).
 * Missing channel tags become DEFAULT_CHANNEL.
 * Multi-channel cash: prefer byChannel row for the selected channel.
 */
function applyChannelFilter(base, channelKey) {
  const allPositions = (base.positions || []).map((p) => ({
    ...p,
    channel: resolveDashboardChannel(p.channel),
  }));
  const allDeposits = normalizeDeposits(base.deposits);
  const byChannel = base.byChannel || [];
  const cashChannel =
    base.cashAmount != null && base.cashChannel != null
      ? resolveDashboardChannel(base.cashChannel)
      : null;

  const channels = base.channels
    ? [...base.channels]
    : [...new Set([
        ...allPositions.map((p) => p.channel),
        ...byChannel.map((c) => resolveDashboardChannel(c.channel)),
        ...allDeposits.map((d) => d.channel),
        ...(cashChannel != null ? [cashChannel] : []),
      ])].sort((a, b) => {
        if (a === DEFAULT_CHANNEL) return -1;
        if (b === DEFAULT_CHANNEL) return 1;
        return a.localeCompare(b);
      });

  if (channelKey === MERGED_CHANNEL_VIEW) {
    const depositsAmount = Number(base.depositsAmount || 0);
    const positions = reweightPositions(
      allPositions,
      base.cashAmount ?? null,
      depositsAmount,
    );
    return {
      ...base,
      positions,
      deposits: allDeposits,
      depositsAmount,
      depositsCurrency: base.depositsCurrency ?? null,
      depositCount: allDeposits.length,
      channelView: MERGED_CHANNEL_VIEW,
      channelLabel: 'All (merged)',
      channels,
      cashChannel,
      byChannel,
    };
  }

  const filtered = allPositions.filter((p) => p.channel === channelKey);
  const deposits = allDeposits.filter((d) => d.channel === channelKey);
  const chRow = byChannel.find((c) => resolveDashboardChannel(c.channel) === channelKey);
  // Prefer per-channel cash from byChannel (multi-cash); fall back to single cashChannel match.
  let cashAmount = null;
  let cashCurrency = null;
  if (chRow != null && chRow.cashAmount != null) {
    cashAmount = chRow.cashAmount;
    cashCurrency = chRow.cashCurrency ?? null;
  } else if (cashChannel != null && cashChannel === channelKey) {
    cashAmount = base.cashAmount;
    cashCurrency = base.cashCurrency;
  }

  let depositsAmount = 0;
  let depositsCurrency = null;
  if (chRow != null && chRow.depositsAmount != null && chRow.depositsAmount > 0) {
    depositsAmount = chRow.depositsAmount;
    depositsCurrency = chRow.depositsCurrency ?? null;
  } else if (deposits.length > 0) {
    depositsAmount = deposits.reduce((s, d) => s + Number(d.amount), 0);
    depositsCurrency = deposits[0].currency;
  }

  let positionsValue = 0;
  let totalCost = 0;
  let equityValue = 0;
  let equityCost = 0;
  let optionsPremiumCollected = 0;
  let optionsPremiumPaid = 0;
  let contingentCashObligation = 0;
  let contingentShareObligation = 0;
  let optionCount = 0;
  let equityCount = 0;
  let fundCount = 0;

  for (const p of filtered) {
    positionsValue += p.value;
    totalCost += p.cost;
    if (p.instrument === 'option') {
      optionCount += 1;
      contingentCashObligation += p.contingentCashObligation || 0;
      contingentShareObligation += p.contingentShareObligation || 0;
      if (p.option?.side === 'short') optionsPremiumCollected += p.premiumAbsolute || 0;
      else optionsPremiumPaid += p.premiumAbsolute || 0;
    } else if (p.instrument === 'fund') {
      fundCount += 1;
      equityValue += p.value;
      equityCost += p.cost;
    } else {
      equityCount += 1;
      equityValue += p.value;
      equityCost += p.cost;
    }
  }

  const totalPL = positionsValue - totalCost;
  let totalValue = positionsValue;
  if (cashAmount != null) totalValue += cashAmount;
  totalValue += depositsAmount;
  const cashWeightPct =
    cashAmount != null && totalValue !== 0
      ? (cashAmount / totalValue) * 100
      : cashAmount != null
        ? 0
        : null;
  const positions = reweightPositions(filtered, cashAmount, depositsAmount);

  return {
    ...base,
    positions,
    totalValue,
    totalCost,
    totalPL,
    totalPLPct: totalCost !== 0 ? (totalPL / Math.abs(totalCost)) * 100 : 0,
    equityValue,
    equityCost,
    optionsPremiumCollected,
    optionsPremiumPaid,
    contingentCashObligation,
    contingentShareObligation,
    optionCount,
    equityCount,
    fundCount,
    cashAmount,
    cashCurrency,
    cashChannel: cashAmount != null ? channelKey : null,
    positionsValue,
    cashWeightPct,
    navComplete: chRow?.navComplete ?? base.navComplete,
    deposits,
    depositsAmount,
    depositsCurrency,
    depositCount: deposits.length,
    channelView: channelKey,
    channelLabel: channelKey,
    channels,
    byChannel,
  };
}

/** Build the per-date view: 'live' or a snapshot date from model.history. */
function buildView(dateKey, channelKey = selectedChannel) {
  const model = payload.model;
  if (dateKey === 'live') {
    const live = model.live;
    const viewBase = {
      isLive: true,
      label: 'Live',
      positions: live.positions,
      totalValue: live.totalValue,
      totalCost: live.totalCost,
      totalPL: live.totalPL,
      totalPLPct: live.totalPLPct,
      equityValue: live.equityValue,
      equityCost: live.equityCost,
      optionsPremiumCollected: live.optionsPremiumCollected ?? 0,
      optionsPremiumPaid: live.optionsPremiumPaid ?? 0,
      contingentCashObligation: live.contingentCashObligation ?? 0,
      contingentShareObligation: live.contingentShareObligation ?? 0,
      optionCount: live.optionCount ?? 0,
      equityCount: live.equityCount ?? live.positions.length,
      fundCount: live.fundCount ?? 0,
      cashAmount: live.cashAmount ?? null,
      cashCurrency: live.cashCurrency ?? null,
      cashChannel: live.cashChannel ?? null,
      positionsValue: live.positionsValue ?? live.totalValue,
      cashWeightPct: live.cashWeightPct ?? null,
      deposits: live.deposits ?? [],
      depositsAmount: live.depositsAmount ?? 0,
      depositsCurrency: live.depositsCurrency ?? null,
      depositCount: live.depositCount ?? (live.deposits ? live.deposits.length : 0),
      channels: live.channels ?? [],
      byChannel: live.byChannel ?? [],
      reportingCurrency: live.reportingCurrency ?? null,
      fxRates: live.fxRates ?? null,
      fxApplied: live.fxApplied === true,
      navComplete: live.navComplete !== false,
    };
    const filtered = applyChannelFilter(viewBase, channelKey);
    const fIdx = portfolioFundIndex(filtered);
    const bIdx = benchIndexAt('live');
    return {
      ...filtered,
      fundIndex: fIdx,
      benchmarkIndex: bIdx,
      diff: bIdx == null ? null : fIdx - bIdx,
    };
  }
  const row = model.history.find((h) => h.date === dateKey);
  if (!row) return null;
  const rawPositions = (row.positions || []).map((p) => ({
    ...p,
    label: p.label || p.ticker,
    instrument: p.instrument || 'equity',
    channel: resolveDashboardChannel(p.channel),
  }));
  const viewBase = {
    isLive: false,
    label: row.date,
    positions: rawPositions,
    totalValue: row.totalValue,
    totalCost: row.totalCost,
    totalPL: row.totalPL,
    totalPLPct: row.totalPLPct,
    equityValue: row.equityValue,
    equityCost: row.equityCost,
    optionsPremiumCollected: row.optionsPremiumCollected ?? 0,
    optionsPremiumPaid: row.optionsPremiumPaid ?? 0,
    contingentCashObligation: row.contingentCashObligation ?? 0,
    contingentShareObligation: 0,
    optionCount: rawPositions.filter((p) => p.instrument === 'option').length,
    equityCount: rawPositions.filter((p) => p.instrument !== 'option' && p.instrument !== 'fund')
      .length,
    fundCount: rawPositions.filter((p) => p.instrument === 'fund').length,
    cashAmount: row.cashAmount ?? null,
    cashCurrency: row.cashCurrency ?? null,
    cashChannel: row.cashAmount != null ? resolveDashboardChannel(row.cashChannel) : null,
    positionsValue: row.positionsValue ?? row.totalValue,
    cashWeightPct:
      row.cashAmount != null && row.totalValue
        ? (row.cashAmount / row.totalValue) * 100
        : null,
    reportingCurrency: row.reportingCurrency || row.cashCurrency || null,
    fxRates: row.fxRates || null,
    fxApplied: !!row.fxRates && Object.keys(row.fxRates).length > 0,
    deposits: row.deposits || [],
    depositsAmount: row.depositsAmount || 0,
    depositsCurrency: row.depositsCurrency || null,
    channels: null,
    byChannel: null,
  };
  const filtered = applyChannelFilter(viewBase, channelKey);
  const fIdx = portfolioFundIndex(filtered);
  const bIdx = benchIndexAt(dateKey);
  return {
    ...filtered,
    fundIndex: fIdx,
    benchmarkIndex: bIdx,
    diff: bIdx == null ? null : fIdx - bIdx,
  };
}

function recordedMonthlyData(view, date) {
  const analytics = payload?.optionAnalytics;
  const channels = selectedTradeChannels(view);
  const fills = (analytics?.executions || []).filter(r => channels.includes(r.channel) && r.executed_at.slice(0, 10) <= date);
  const profits = (analytics?.profits || []).filter(r => channels.includes(r.channel) && r.date <= date);
  const gaps = (analytics?.gaps || []).filter(g => channels.includes(g.channel) && g.date <= date);
  const conflictingChannels = new Set((payload?.optionHistoryGaps || []).filter(g => g.blocksTotals).map(g => g.channel));
  const byMonth = new Map(), byUnderlying = new Map(), monthly = new Map(), realized = new Map();
  const sum = (map, key, value) => map.set(key, value == null || map.get(key) === null ? null : (map.get(key) || 0) + value);
  const monthFor = month => {
    if (!monthly.has(month)) monthly.set(month, { rows: [], gaps: [], count: 0, excluded: 0, value: null, basis: null, contributions: new Map() });
    return monthly.get(month);
  };
  for (const row of fills) {
    const amount = conflictingChannels.has(row.channel) ? null : tradeAmount(view, row, row.gross_premium);
    sum(byMonth, row.executed_at.slice(0, 7), amount);
    sum(byUnderlying, row.underlying, amount);
  }
  for (const row of profits) {
    if (conflictingChannels.has(row.channel)) gaps.push({ channel: row.channel, date: row.date, reason: 'Conflicting broker records need reconciliation' });
    else monthFor(row.date.slice(0, 7)).rows.push(row);
  }
  for (const gap of gaps) monthFor(gap.date.slice(0, 7)).gaps.push(gap);
  // Keep empty calendar months as gaps rather than joining nonadjacent results.
  const keys = [...monthly.keys()].sort();
  if (keys.length) {
    const cursor = new Date(keys[0] + '-01T00:00:00Z');
    while (cursor.toISOString().slice(0, 7) <= keys[keys.length - 1]) {
      monthFor(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  for (const [month, stats] of monthly) {
    stats.basis = stats.rows.length ? stats.rows.every(row => row.net != null) ? 'net'
      : stats.rows.every(row => row.gross != null) ? 'gross' : 'mixed' : null;
    for (const row of stats.rows) {
      const amount = stats.basis === 'net' ? row.net : stats.basis === 'gross' ? row.gross : row.gross ?? row.net;
      const value = tradeAmount(view, row, amount);
      if (value == null) { stats.excluded++; continue; }
      stats.value = (stats.value ?? 0) + value;
      stats.count++;
      const broker = { ibkr: 'IBKR', tiger: 'Tiger', moomoo: 'MooMoo', futubull: 'Futubull', webull: 'Webull' }[row.channel.split('-')[0]] || row.channel;
      const name = `${row.underlying || 'Unspecified stock'} · ${broker}`;
      const contribution = stats.contributions.get(name) || { value: 0, count: 0 };
      contribution.value += value; contribution.count++;
      stats.contributions.set(name, contribution);
    }
    stats.excluded += stats.gaps.length;
    stats.partial = stats.excluded > 0 || stats.basis === 'mixed';
    realized.set(month, stats.value);
  }
  return { byMonth, byUnderlying, realized, monthly, gaps, fills, profits };
}


function openBookPremiumData(view) {
  const premiumByExpiry = new Map(), premiumByUnderlying = new Map();
  const pnlByExpiry = new Map(), concentration = new Map();
  const ccy = reportingCcyCode(view);
  const sum = (map, key, value) => map.set(key,
    value == null || map.get(key) === null ? null : (map.get(key) || 0) + value);
  const number = value => value != null && Number.isFinite(Number(value)) ? Number(value) : null;
  for (const p of view.positions || []) {
    const converted = ccy && (p.currency === ccy ||
      (p.currency && Number.isFinite(view.fxRates?.[p.currency]) && view.fxRates[p.currency] > 0));
    const value = converted ? number(p.value) : null;
    const underlying = p.option ? optionUnderlyingLabel(p.option) : p.ticker;
    sum(concentration, underlying || 'Unspecified', value);
    if (p.instrument !== 'option' || !p.option) continue;
    const month = /^\d{4}-\d{2}-\d{2}$/.test(p.option.expiry || '') ? p.option.expiry.slice(0, 7) : 'Unknown expiry';
    const cost = converted ? number(p.cost) : null;
    const premium = cost == null ? null : -cost;
    const pnl = converted && p.pricingMode !== 'cost' && p.markSource !== 'cost' ? number(p.pl) : null;
    sum(premiumByExpiry, month, premium);
    sum(premiumByUnderlying, underlying || 'Unspecified', premium);
    sum(pnlByExpiry, month, pnl);
  }
  if (view.cashAmount != null) sum(concentration, 'Cash', number(view.cashAmount));
  if (view.depositCount || view.depositsAmount) sum(concentration, 'Fixed deposits', number(view.depositsAmount));
  const nav = view.navComplete !== false && Number.isFinite(view.totalValue) && view.totalValue > 0 ? view.totalValue : null;
  return { premiumByExpiry, premiumByUnderlying, pnlByExpiry,
    concentration: new Map([...concentration].map(([name, value]) => [name, value == null || nav == null ? null : value / nav * 100])) };
}

function channelRowsForView(view) {
  if (Array.isArray(view.byChannel) && view.byChannel.length > 0) {
    if (view.channelView === MERGED_CHANNEL_VIEW) {
      return view.byChannel.map((c) => ({ ...c, channel: resolveDashboardChannel(c.channel) }));
    }
    const one = view.byChannel.find(
      (c) => resolveDashboardChannel(c.channel) === view.channelView,
    );
    if (one) return [{ ...one, channel: resolveDashboardChannel(one.channel) }];
  }

  // Rebuild from filtered view (archive dates or missing byChannel).
  const channels =
    view.channelView === MERGED_CHANNEL_VIEW
      ? view.channels && view.channels.length > 0
        ? view.channels
        : [...new Set(view.positions.map((p) => resolveDashboardChannel(p.channel)))].sort(
            (a, b) => {
              if (a === DEFAULT_CHANNEL) return -1;
              if (b === DEFAULT_CHANNEL) return 1;
              return a.localeCompare(b);
            },
          )
      : [view.channelView];

  return channels.map((ch) => {
    const pos = view.positions.filter((p) => resolveDashboardChannel(p.channel) === ch);
    let positionsValue = 0;
    let totalCost = 0;
    let equityValue = 0;
    let equityCost = 0;
    let equityCount = 0;
    let optionCount = 0;
    let fundCount = 0;
    let optionsPremiumCollected = 0;
    let optionsPremiumPaid = 0;
    let contingentCashObligation = 0;
    let contingentShareObligation = 0;
    for (const p of pos) {
      positionsValue += p.value;
      totalCost += p.cost;
      if (p.instrument === 'option') {
        optionCount += 1;
        contingentCashObligation += p.contingentCashObligation || 0;
        contingentShareObligation += p.contingentShareObligation || 0;
        if (p.option?.side === 'short') optionsPremiumCollected += p.premiumAbsolute || 0;
        else optionsPremiumPaid += p.premiumAbsolute || 0;
      } else if (p.instrument === 'fund') {
        fundCount += 1;
        equityValue += p.value;
        equityCost += p.cost;
      } else {
        equityCount += 1;
        equityValue += p.value;
        equityCost += p.cost;
      }
    }
    const deposits = (view.deposits || []).filter(
      (d) => resolveDashboardChannel(d.channel) === ch,
    );
    const depositsAmount = deposits.reduce((s, d) => s + Number(d.amount), 0);
    const depositsCurrency =
      deposits.length > 0 ? deposits[0].currency : view.depositsCurrency ?? null;
    let cashAmount = null;
    let cashCurrency = null;
    if (view.channelView !== MERGED_CHANNEL_VIEW) {
      cashAmount = view.cashAmount ?? null;
      cashCurrency = view.cashCurrency ?? null;
    } else if (view.cashChannel != null && resolveDashboardChannel(view.cashChannel) === ch) {
      cashAmount = view.cashAmount ?? null;
      cashCurrency = view.cashCurrency ?? null;
    }
    const totalPL = positionsValue - totalCost;
    let totalValue = positionsValue;
    if (cashAmount != null) totalValue += cashAmount;
    totalValue += depositsAmount;
    return {
      channel: ch,
      positionCount: pos.length,
      equityCount,
      optionCount,
      fundCount,
      positionsValue,
      totalCost,
      totalPL,
      totalPLPct: totalCost !== 0 ? (totalPL / Math.abs(totalCost)) * 100 : 0,
      cashAmount,
      cashCurrency,
      depositsAmount,
      depositsCurrency,
      depositCount: deposits.length,
      totalValue,
      cashWeightPct:
        cashAmount != null && totalValue !== 0 ? (cashAmount / totalValue) * 100 : null,
      equityValue,
      equityCost,
      optionsPremiumCollected,
      optionsPremiumPaid,
      contingentCashObligation,
      contingentShareObligation,
    };
  });
}

function buildTimeline(view) {
  const model = payload.model;
  const points = model.history
    .filter((h) => view.isLive || h.date <= view.label)
    .map((h) => ({
      label: h.date,
      fund: fundIndex(h.totalValue, h.totalCost),
      bench: benchIndexAt(h.date),
    }));
  if (view.isLive) {
    points.push({
      label: 'Now',
      fund: view.fundIndex,
      bench: view.benchmarkIndex,
    });
  }
  return points;
}

/** Per-position fund-index timeline from snapshot positions + live point. */
function buildPositionTimeline(ticker, view) {
  const model = payload.model;
  const points = [];
  for (const h of model.history) {
    if (!view.isLive && h.date > view.label) continue;
    const p = (h.positions || []).find((x) => x.ticker === ticker);
    if (p) points.push({ label: h.date, fund: fundIndex(p.value, p.cost) });
  }
  if (view.isLive) {
    const live = model.live.positions.find((x) => x.ticker === ticker);
    if (live) points.push({ label: 'Now', fund: fundIndex(live.value, live.cost) });
  }
  return points;
}

function legacySlice(live, channel) {
  if (!live) return null;
  if (!channel || channel === 'all' || channel === 'merged') return live;
  const positions = (live.positions || []).filter((p) => p.channel === channel);
  const deposits = (live.deposits || []).filter((d) => d.channel === channel);
  const chRow = (live.byChannel || []).find((c) => c.channel === channel);
  let positionsValue = 0;
  let totalCost = 0;
  let equityValue = 0;
  let equityCost = 0;
  let optionsPremiumCollected = 0;
  let optionsPremiumPaid = 0;
  let contingentCashObligation = 0;
  let contingentShareObligation = 0;
  let optionCount = 0;
  let equityCount = 0;
  let fundCount = 0;
  for (const p of positions) {
    positionsValue += Number(p.value || 0);
    totalCost += Number(p.cost || 0);
    if (p.instrument === 'option') {
      optionCount += 1;
      contingentCashObligation += Number(p.contingentCashObligation || 0);
      contingentShareObligation += Number(p.contingentShareObligation || 0);
      if (p.option && p.option.side === 'short') optionsPremiumCollected += Number(p.premiumAbsolute || 0);
      else optionsPremiumPaid += Number(p.premiumAbsolute || 0);
    } else if (p.instrument === 'fund') {
      fundCount += 1;
      equityValue += Number(p.value || 0);
      equityCost += Number(p.cost || 0);
    } else {
      equityCount += 1;
      equityValue += Number(p.value || 0);
      equityCost += Number(p.cost || 0);
    }
  }
  const cashAmount = chRow && chRow.cashAmount != null ? chRow.cashAmount : null;
  const cashCurrency = chRow && chRow.cashCurrency != null ? chRow.cashCurrency : null;
  const depositsAmount =
    chRow && chRow.depositsAmount != null
      ? chRow.depositsAmount
      : deposits.reduce((s, d) => s + Number(d.amount || 0), 0);
  const totalPL = chRow ? chRow.totalPL : positionsValue - totalCost;
  const totalValue = chRow
    ? chRow.totalValue
    : positionsValue + (cashAmount != null ? cashAmount : 0) + depositsAmount;
  const absSum =
    positions.reduce((s, p) => s + Math.abs(Number(p.value || 0)), 0) +
    (cashAmount != null ? cashAmount : 0) +
    depositsAmount;
  const reweighted = positions
    .map((p) => ({
      ...p,
      weightPct: absSum > 0 ? (Math.abs(Number(p.value || 0)) / absSum) * 100 : 0,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return {
    ...live,
    positions: reweighted,
    totalValue,
    totalCost: chRow ? chRow.totalCost : totalCost,
    totalPL,
    totalPLPct: chRow
      ? chRow.totalPLPct
      : totalCost !== 0
        ? (totalPL / Math.abs(totalCost)) * 100
        : 0,
    positionCount: chRow ? chRow.positionCount : positions.length,
    equityValue: chRow ? chRow.equityValue : equityValue,
    equityCost: chRow ? chRow.equityCost : equityCost,
    optionsPremiumCollected: chRow ? chRow.optionsPremiumCollected : optionsPremiumCollected,
    optionsPremiumPaid: chRow ? chRow.optionsPremiumPaid : optionsPremiumPaid,
    contingentCashObligation: chRow ? chRow.contingentCashObligation : contingentCashObligation,
    contingentShareObligation: chRow ? chRow.contingentShareObligation : contingentShareObligation,
    optionCount: chRow ? chRow.optionCount : optionCount,
    equityCount: chRow ? chRow.equityCount : equityCount,
    fundCount: chRow ? chRow.fundCount : fundCount,
    cashAmount,
    cashCurrency,
    cashChannel: cashAmount != null ? channel : null,
    positionsValue: chRow ? chRow.positionsValue : positionsValue,
    cashWeightPct:
      cashAmount != null && totalValue !== 0 ? (cashAmount / totalValue) * 100 : cashAmount != null ? 0 : null,
    deposits,
    depositsAmount,
    depositsCurrency: chRow ? chRow.depositsCurrency : deposits[0] ? deposits[0].currency : null,
    depositCount: chRow ? chRow.depositCount : deposits.length,
  };
}

    const result = {};
    if (!payload.model) return result;
    const channels = [...new Set(['merged', ...(payload.model.live.channels || []),
      ...(payload.premiumJournal?.channels || []),
      ...payload.model.history.flatMap(row => (row.positions || []).map(p => resolveDashboardChannel(p.channel)))])];
    for (const dateKey of ['live', ...payload.model.history.map(row => row.date)]) {
      result[dateKey] = {};
      for (const channel of channels) {
        const view = buildView(dateKey, channel);
        view.positionCount = view.positions.length;
        const date = view.isLive ? payload.generatedAt.slice(0, 10) : view.label;
        const puts = (view.positions || []).filter(p => p.instrument === 'option' && p.option?.side === 'short' && p.option.right === 'put');
        const putAmounts = puts.map(p => tradeAmount(view, p, Number(p.option.strike) * Number(p.option.multiplier) * Number(p.units)));
        const stalePuts = view.isLive && puts.some(p => {
          const asOf = payload.brokerAsOf?.[p.channel];
          return !asOf || (globalThis.OptionProbability.daysToExpiry(date, asOf) ?? 999) > 4;
        });
        const assignmentObligation = stalePuts || putAmounts.some(amount => amount == null) ? null : putAmounts.reduce((total, amount) => total + amount, 0);
        const riskRows = {};
        for (const mode of ['wheel', 'matching']) riskRows[mode] = (view.positions || []).filter(p => p.instrument === 'option' && p.option?.side === 'short').map(p => {
          const o = p.option, spot = view.isLive ? payload.equityPrices?.[o.underlying] : undefined;
          const days = globalThis.OptionProbability.daysToExpiry(o.expiry, date);
          const estimate = view.isLive && days < 0 ? { probability: null, iv: null, reason: 'Past expiry; broker status unverified' }
            : mode === 'wheel' ? globalThis.OptionProbability.brokerMarkItmProbability(p, spot, days) : globalThis.OptionProbability.finishItmProbability(p, spot, days);
          const rate = view.isLive && view.fxApplied && p.currency ? p.currency === view.reportingCurrency ? 1 : view.fxRates?.[p.currency] : 1;
          const exposure = view.navComplete === false ? null : o.right === 'put' ? Number(p.contingentCashObligation || 0)
            : Number.isFinite(rate) ? Number(o.strike) * Number(p.contingentShareObligation || 0) * rate : null;
          const itm = typeof spot === 'number' && Number.isFinite(spot) && typeof o.strike === 'number' && (o.right === 'put' ? spot < o.strike : spot > o.strike);
          const flagged = estimate.probability > .3 || typeof days === 'number' && days >= 0 && (mode === 'wheel' ? days <= 7 : days <= 21 && itm);
          return { p, spot: spot ?? null, days, estimate, exposure, flagged };
        });
        const risk = {};
        for (const [mode, rows] of Object.entries(riskRows)) {
          const radar = rows.filter(row => row.flagged), scored = radar.filter(row => Number.isFinite(row.exposure) && row.exposure > 0);
          const exposure = scored.length === radar.length ? scored.reduce((sum, row) => sum + row.exposure, 0) : null;
          const weighted = scored.length === radar.length && radar.every(row => row.estimate.probability != null) ? scored.reduce((sum, row) => sum + row.exposure * row.estimate.probability, 0) : null;
          risk[mode] = { rows, missing: rows.filter(row => row.estimate.probability == null).length, exposure, weighted,
            cover: exposure > 0 && view.navComplete !== false && view.cashAmount != null ? view.cashAmount / exposure * 100 : null };
        }
        const openBook = Object.fromEntries(Object.entries(openBookPremiumData(view)).map(([key, entries]) => [key, [...entries]]));
        const equities = view.positions.filter(p => p.instrument === 'equity' || p.instrument === 'fund');
        const options = view.positions.filter(p => p.instrument === 'option' && p.option);
        const shortOptions = options.filter(p => p.option.side === 'short');
        const dte = p => globalThis.OptionProbability.daysToExpiry(p.option.expiry, date);
        const legacy = {
          equityValue: equities.reduce((sum, p) => sum + p.value, 0), equityCost: equities.reduce((sum, p) => sum + p.cost, 0),
          shares: equities.reduce((sum, p) => sum + p.units, 0),
          cashIf: shortOptions.filter(p => p.option.right === 'put').reduce((sum, p) => sum + Number(p.contingentCashObligation || 0), 0),
          sharesCall: shortOptions.filter(p => p.option.right === 'call').reduce((sum, p) => sum + Number(p.contingentShareObligation || 0), 0),
          puts: options.filter(p => p.option.right === 'put').length, calls: options.filter(p => p.option.right === 'call').length,
          dteAvg: options.length ? options.reduce((sum, p) => sum + dte(p), 0) / options.length : null,
          leaps: options.filter(p => dte(p) > 365).length, near30: options.filter(p => dte(p) <= 30),
          top: [...view.positions].sort((a, b) => b.weightPct - a.weightPct)[0] ?? null,
          itmNear: shortOptions.filter(p => {
            const spot = payload.equityPrices?.[p.option.underlying];
            return typeof spot === 'number' && Number.isFinite(spot) && (p.option.right === 'put' ? spot < p.option.strike : spot > p.option.strike) && dte(p) <= 21;
          }).map(p => ({ ...p, dte: dte(p) })),
        };
        const premium = recordedPremiumForView(view, date);
        const monthly = recordedMonthlyData(view, date);
        const realized = {};
        for (const from of ['', premium.dailyFrom, date.slice(0, 7) + '-01']) realized[from] = recordedRealizedForView(view, date, from);
        const timeline = buildTimeline(view), channelRows = channelRowsForView(view);
        const positionTimelines = Object.fromEntries(view.positions.map(p => [p.ticker, buildPositionTimeline(p.ticker, view)]));
        result[dateKey][channel] = { view, legacyView: view.isLive ? legacySlice(payload.model.live, channel) : view, timeline, channelRows, positionTimelines, legacy, premium, realized, stalePuts, assignmentObligation, risk, openBook,
          monthly: { ...monthly, byMonth: [...monthly.byMonth], byUnderlying: [...monthly.byUnderlying],
            realized: [...monthly.realized], monthly: [...monthly.monthly].map(([month, stats]) => [month, {...stats, contributions: [...stats.contributions]}]) } };
      }
    }
    return result;
  }
  globalThis.DashboardAggregates = Object.freeze({ build });
})();
