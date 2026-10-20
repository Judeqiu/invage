/* Read-only briefing over the same reconciled holdings, quotes and FX as Positions v2. */
(() => {
  const columns = ['Underlying','Contract lines','Premium received','Open P&L','Signal'];
  const statLabels = ['Best contributor','Biggest drag','Contracts in profit','Average DTE','Average premium','Put / call split','LEAP exposure','Cash weight'];
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const sum = ns => ns.every(finite) ? ns.reduce((a,b) => a+b,0) : null;
  const mean = ns => ns.length && sum(ns) !== null ? sum(ns)/ns.length : null;
  const symbol = s => String(s || '').split('@')[0].trim().toUpperCase();
  function build(payload, channel = 'all') {
    const portfolio = globalThis.PositionsV2.build(payload,channel), live = payload?.model?.live;
    const all = channel === 'all' || channel === 'merged', ccy = portfolio.ccy;
    const scope = all ? live : live?.byChannel?.find(r => r.channel === channel);
    const positions = (live?.positions || []).filter(p => all || p.channel === channel);
    const asOf = payload?.generatedAt?.slice(0,10);
    const comparable = p => ccy && p.currency && (p.currency === ccy || live?.fxApplied && finite(live?.fxRates?.[p.currency]) && live.fxRates[p.currency] > 0);
    const fresh = p => {const age = globalThis.OptionProbability.daysToExpiry(asOf,payload?.brokerAsOf?.[p.channel]);return age != null && age >= 0 && age <= 4;};
    const valued = p => comparable(p) && p.pricingMode !== 'cost' && p.markSource !== 'cost' && finite(p.value);
    const convert = (n,currency) => {const rate = currency === ccy ? 1 : live?.fxRates?.[currency];return finite(n) && currency && ccy && finite(rate) && rate > 0 ? n*rate : null;};
    const options = positions.filter(p => p.instrument === 'option' && p.option);
    const shorts = options.filter(p => p.option.side === 'short');
    const lines = options.map(p => {
      const detail = payload?.optionTradeDetails?.[p.ticker];
      const short = p.option.side === 'short';
      const premium = short && fresh(p) && comparable(p) ? convert(detail?.stoGrossPremium,detail?.currency) : null;
      const pnl = fresh(p) && valued(p) && finite(p.pl) ? p.pl : null;
      const dte = globalThis.OptionProbability.daysToExpiry(p.option.expiry,asOf);
      const quoteAge = globalThis.OptionProbability.daysToExpiry(asOf,p.probabilityQuote?.spotAsOf?.slice(0,10));
      const probability = short && fresh(p) && dte != null && dte >= 0 && quoteAge != null && quoteAge >= 0 && quoteAge <= 4
        ? globalThis.OptionProbability.finishItmProbability(p).probability : null;
      const capture = short && fresh(p) && valued(p) && p.value <= 0 && premium > 0 ? (premium+p.value)/premium*100 : null;
      const spot = payload?.equityPrices?.[symbol(p.option.underlying)] ?? (quoteAge != null && quoteAge >= 0 && quoteAge <= 4 ? p.probabilityQuote?.spot : null);
      const itm = fresh(p) && finite(spot) && spot > 0 ? p.option.right === 'put' ? spot < p.option.strike : spot > p.option.strike : null;
      return { key:p.ticker,ticker:symbol(p.option.underlying),channel:p.channel,right:p.option.right,side:p.option.side,
        strike:p.option.strike,expiry:p.option.expiry,units:p.units,multiplier:p.option.multiplier,nativeCurrency:p.currency,
        dte,premium,pnl,probability,capture,itm,
        obligation:short && fresh(p) && comparable(p) && p.option.settlement === 'physical' && p.option.right === 'put' && finite(p.contingentCashObligation) ? p.contingentCashObligation : null };
    });
    const shortLines = lines.filter(p => p.side === 'short');
    const risks = shortLines.filter(p => p.probability > .6 || p.itm && p.dte >= 0 && p.dte <= 21)
      .sort((a,b) => (a.dte ?? Infinity)-(b.dte ?? Infinity) || (b.probability ?? -1)-(a.probability ?? -1) || a.key.localeCompare(b.key));
    const actions = shortLines.filter(p => p.capture != null && p.capture >= 50 && p.dte >= 0)
      .sort((a,b) => b.capture-a.capture || a.dte-b.dte || a.key.localeCompare(b.key));
    const groups = new Map();
    for (const line of lines) {if (!groups.has(line.ticker)) groups.set(line.ticker,[]);groups.get(line.ticker).push(line);}
    const rows = [...groups].map(([ticker,entries]) => ({ticker,lines:entries.length,contracts:sum(entries.map(p => p.units)),
      premium:sum(entries.filter(p => p.side === 'short').map(p => p.premium)),
      missingPremium:entries.filter(p => p.side === 'short' && p.premium === null).length,
      premiumSubtotal:entries.filter(p => p.side === 'short' && finite(p.premium)).reduce((s,p) => s+p.premium,0),
      pnl:sum(entries.map(p => p.pnl)),missingPnl:entries.filter(p => p.pnl === null).length,
      longLines:entries.filter(p => p.side === 'long').length,
      highRisk:entries.filter(p => p.probability > .6).length,
    })).map(r => ({...r,signal:r.pnl === null ? 'Data incomplete' : r.highRisk > 0 ? 'Elevated expiry risk' : r.pnl < 0 ? 'Underwater · review exposure' : 'Positive open P&L'}))
      .sort((a,b) => (a.premium === null)-(b.premium === null) || (b.premium ?? 0)-(a.premium ?? 0) || a.ticker.localeCompare(b.ticker));
    // Rankings require the complete same-basis book, never winners from only its known subset.
    const ranked = rows.every(r => r.pnl !== null) ? [...rows].sort((a,b) => b.pnl-a.pnl || a.ticker.localeCompare(b.ticker)) : [];
    const nav = scope?.navComplete !== false && finite(scope?.totalValue) && scope.totalValue > 0 ? scope.totalValue : null;
    const cash = portfolio.cash;
    const grossGroups = new Map();
    for (const p of positions) {const ticker = symbol(p.option?.underlying || p.ticker);const previous = grossGroups.get(ticker) ?? 0;grossGroups.set(ticker,previous === null || !valued(p) || p.instrument === 'option' && !fresh(p) ? null : previous+Math.abs(p.value));}
    const concentration = [...grossGroups.values()].every(finite) && nav != null ? [...grossGroups].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))[0] : null;
    const near = lines.filter(p => p.dte != null && p.dte >= 0 && p.dte <= 30), leap = lines.filter(p => p.dte > 365);
    const profitKnown = lines.every(p => p.pnl !== null);
    return {ccy,channels:portfolio.channels,dates:portfolio.dates,asOf,positions:positions.length,equities:positions.filter(p => p.instrument === 'equity').length,funds:positions.filter(p => p.instrument === 'fund').length,
      options:options.length,shorts:shorts.length,longs:options.length-shorts.length,nav,cash,
      totalPnl:sum(positions.map(p => valued(p) && (p.instrument !== 'option' || fresh(p)) && finite(p.pl) ? p.pl : null)),
      premium:sum(shortLines.map(p => p.premium)),optionPnl:sum(lines.map(p => p.pnl)),obligation:portfolio.totals.cashIfAssigned,
      highRisk:shortLines.filter(p => p.probability > .6).length,unscored:shortLines.filter(p => p.probability === null).length,
      expired:lines.filter(p => p.dte != null && p.dte < 0).length,risks,actions,rows,
      best:ranked.find(r => r.pnl > 0) ?? null,worst:[...ranked].reverse().find(r => r.pnl < 0) ?? null,
      rankingIncomplete:rows.some(r => r.pnl === null),profitPct:lines.length && profitKnown ? lines.filter(p => p.pnl > 0).length/lines.length*100 : null,
      profitable:profitKnown ? lines.filter(p => p.pnl > 0).length : null,
      averageDte:mean(lines.map(p => p.dte)),
      nearLines:near.length,nearPremium:sum(near.filter(p => p.side === 'short').map(p => p.premium)),
      averagePremium:mean(shortLines.map(p => p.premium)),
      puts:shortLines.filter(p => p.right === 'put').length,calls:shortLines.filter(p => p.right === 'call').length,
      leapContracts:sum(leap.map(p => p.units)),leapLines:leap.length,cashWeight:nav != null && cash !== null ? cash/nav*100 : null,
      concentration:concentration ? {ticker:concentration[0],value:concentration[1],navPct:concentration[1]/nav*100} : null,
      cashGap:cash != null && portfolio.totals.cashIfAssigned != null ? Math.max(0,portfolio.totals.cashIfAssigned-cash) : null,
      warnings:[...portfolio.warnings,...(lines.some(p => p.premium === null && p.side === 'short') ? ['Some short options have no reconciled opening cash; premium totals and averages remain unavailable.'] : []),
        ...(lines.some(p => p.pnl === null) ? ['Some option marks, broker dates or FX are incomplete; P&L rankings and the percentage in profit remain unavailable.'] : []),
        ...(shortLines.some(p => p.probability === null) ? ['Some short options lack recent matching quotes. Their expiry probability is unknown, never assumed safe.'] : [])],
    };
  }
  globalThis.InsightsV2 = Object.freeze({build,columns,statLabels});
})();
