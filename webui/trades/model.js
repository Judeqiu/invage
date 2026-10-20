(() => {
  const openColumns = ['Entry date','ID','Ticker','Strategy','Strike','Expiry','Contracts','Premium','Returns %','Net cash','Broker'];
  const historyColumns = ['Contract','Status','Opened','Last trade','Contracts','Premium in','Paid to close','Realised P&L','Broker'];
  const strategies = row => row.side === 'unknown' ? 'Unknown side' : `${row.side === 'short' ? 'Short' : 'Long'} ${row.right}`;
  const isOpen = row => ['Open in recorded fills','Observed open'].includes(row.status);
  function filter(rows, f) {
    return rows.filter(r => (f.channel === 'all' || r.channel === f.channel) && (f.ticker === 'all' || r.underlying === f.ticker) &&
      (f.right === 'all' || r.right === f.right) && (f.currency === 'all' || (r.currency || 'unknown') === f.currency) &&
      (f.strategy === 'all' || strategies(r) === f.strategy) &&
      (f.status === 'all' || (f.status === 'Rolled' ? r.rolled : f.status === 'Expired / assigned' ? ['Expired','Assigned','Exercised','Cash settled','Mixed outcomes'].includes(r.status) :
        f.status === 'Needs review' ? !['Closed','Expired','Assigned','Exercised','Cash settled','Mixed outcomes'].includes(r.status) : r.status === f.status)) &&
      (f.year === 'all' || r.entryDate?.slice(0,4) === f.year) && (f.month === 'all' || r.entryDate?.slice(5,7) === f.month));
  }
  function cashBalances(rows, seed) {
    const result = new Map();
    const currencies = new Set(rows.map(r => r.currency));
    if (seed === null || !Number.isFinite(seed) || currencies.size !== 1 || ![...currencies][0]) return result;
    let balance = seed;
    for (const r of [...rows].filter(r => r.entryDate).sort((a,b) => a.entryDate.localeCompare(b.entryDate) || a.id.localeCompare(b.id))) {
      if (r.premium === null || r.entryDate !== r.entryThrough) balance = NaN;
      else balance += Number(r.premium);
      result.set(r.id, Number.isFinite(balance) ? balance : null);
    }
    return result;
  }
  function groups(rows) {
    const years = new Map();
    for (const r of [...rows].sort((a,b) => (b.entryDate ?? '').localeCompare(a.entryDate ?? '') || a.id.localeCompare(b.id))) {
      const year = r.entryDate?.slice(0,4) || 'Unknown', month = r.entryDate?.slice(0,7) || 'Unknown';
      if (!years.has(year)) years.set(year,new Map());
      const months = years.get(year);
      if (!months.has(month)) months.set(month,[]);
      months.get(month).push(r);
    }
    return [...years].map(([year,months]) => ({year,count:[...months.values()].reduce((n,entries) => n+entries.length,0),
      months:[...months].map(([month,entries]) => ({month,entries}))}));
  }
  function monthTotals(rows,balances) {
    return totals(rows).map(total => {
      const last = [...rows].filter(r => (r.currency || 'unknown') === total.currency && r.entryDate)
        .sort((a,b) => a.entryDate.localeCompare(b.entryDate) || a.id.localeCompare(b.id)).at(-1);
      return {...total,netCash:last ? balances.get(last.id) ?? null : null};
    });
  }
  function totals(rows) {
    const byCurrency = new Map();
    for (const r of rows) {
      const currency = r.currency || 'unknown';
      if (!byCurrency.has(currency)) byCurrency.set(currency, { currency, contracts:0, premium:0, missing:0, pnl:0, missingPnl:0, grossPnl:false, netPnl:false, brokerPnl:false, brokerSubtotal:0, grossSubtotal:0, netSubtotal:0, denominator:0, shortOnly:true });
      const t = byCurrency.get(currency); t.contracts += Number(r.contracts);
      t.shortOnly &&= r.side === 'short';
      if (r.premium === null) t.missing++; else t.premium += Number(r.premium);
      if (r.realizedPnl === null) t.missingPnl++; else {
        t.pnl += Number(r.realizedPnl); t.grossPnl ||= r.feeBasis === 'gross'; t.netPnl ||= r.feeBasis === 'net'; t.brokerPnl ||= r.feeBasis === 'broker';
        if (r.feeBasis === 'gross') t.grossSubtotal += Number(r.realizedPnl); else if (r.feeBasis === 'broker') t.brokerSubtotal += Number(r.realizedPnl); else t.netSubtotal += Number(r.realizedPnl);
      }
      t.denominator += Number(r.strike) * Number(r.contracts) * Number(r.multiplier);
    }
    return [...byCurrency.values()].map(t => ({ ...t, mixedBasis:[t.grossPnl,t.netPnl,t.brokerPnl].filter(Boolean).length > 1, returnsPct:!t.missing && t.shortOnly && t.denominator > 0 ? t.premium / t.denominator * 100 : null }));
  }
  globalThis.TradesV2 = { openColumns, historyColumns, strategies, isOpen, filter, cashBalances, groups, monthTotals, totals };
})();
