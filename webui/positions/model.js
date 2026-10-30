/* Read-only projection of the same valued portfolio used by the dashboard. */
(() => {
  const equityColumns = ['Ticker', 'Shares', 'Avg cost', 'Total cost', 'Last', 'Market value', 'Unrealized P&L', 'Return', '% of NAV', 'Covered', 'Broker'];
  const obligationColumns = ['Ticker', 'Last', 'Shares held', 'Put contracts', 'Cash if assigned', 'Call contracts', 'Shares if called', 'Premium', 'Open P&L', 'Nearest expiry', 'High risk'];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const sum = values => values.every(finite) ? values.reduce((a, b) => a + b, 0) : null;
  const symbol = value => String(value || '').split('@')[0].trim().toUpperCase();
  function build(payload, channel = 'all') {
    const live = payload?.model?.live;
    const all = channel === 'all' || channel === 'merged';
    const ccy = live?.reportingCurrency || live?.cashCurrency || null;
    const positions = (live?.positions || []).filter(p => all || p.channel === channel);
    const channels = [...new Set([...(live?.channels || []), ...(live?.positions || []).map(p => p.channel)])].filter(Boolean);
    const asOf = (payload?.generatedAt || '').slice(0, 10);
    const fresh = p => {
      const date = payload?.brokerAsOf?.[p.channel];
      const days = globalThis.OptionProbability.daysToExpiry(asOf, date);
      return date && days != null && days >= 0 && days <= 4;
    };
    const comparable = p => ccy && p.currency && (p.currency === ccy || live?.fxApplied && finite(live?.fxRates?.[p.currency]) && live.fxRates[p.currency] > 0);
    const valued = p => comparable(p) && p.pricingMode !== 'cost';
    const convert = (value, currency) => {
      if (!finite(value) || !currency || !ccy) return null;
      const rate = currency === ccy ? 1 : live?.fxRates?.[currency];
      return finite(rate) && rate > 0 ? value * rate : null;
    };
    const shorts = positions.filter(p => p.instrument === 'option' && p.option?.side === 'short');
    const equity = positions.filter(p => p.instrument === 'equity' && p.units > 0);
    const funds = positions.filter(p => p.instrument === 'fund' && p.units > 0);
    const bySymbol = list => {
      const map = new Map();
      for (const p of list) {
        const ticker = symbol(p.option?.underlying || p.ticker);
        const group = map.get(ticker) || []; group.push(p); map.set(ticker, group);
      }
      return map;
    };
    const shortGroups = bySymbol(shorts);
    const channelNav = all ? live : live?.byChannel?.find(row => row.channel === channel);
    const nav = channelNav?.navComplete !== false && finite(channelNav?.totalValue) && channelNav.totalValue > 0 ? channelNav.totalValue : null;
    const stockRows = (list, isFund = false) => [...bySymbol(list)].map(([ticker, lines]) => {
      const shares = sum(lines.map(p => p.units));
      const cost = sum(lines.map(p => comparable(p) ? p.cost : null));
      const value = sum(lines.map(p => valued(p) ? p.value : null));
      const pnl = cost != null && value != null ? value - cost : null;
      const calls = (shortGroups.get(ticker) || []).filter(p => p.option.right === 'call');
      // Coverage is local to a broker channel (the bound custody account), then summed.
      // A call at one broker cannot consume shares held at another broker.
      let covered = isFund ? null : 0;
      if (!isFund) for (const ch of new Set(lines.map(p => p.channel))) {
        const owned = sum(lines.filter(p => p.channel === ch).map(p => p.units));
        const channelCalls = calls.filter(p => p.channel === ch);
        const delivery = sum(channelCalls.map(p => !fresh(p) ? null : p.option.settlement === 'cash' ? 0 : p.option.settlement === 'physical' ? p.contingentShareObligation : null));
        if (delivery == null) { covered = null; break; }
        covered += Math.min(owned, delivery);
      }
      return { ticker, shares, avgCost: cost != null && shares > 0 ? cost / shares : null,
        cost, last: value != null && shares > 0 ? value / shares : null, value, pnl,
        returnPct: pnl != null && cost > 0 ? pnl / cost * 100 : null,
        navPct: nav != null && value != null ? value / nav * 100 : null,
        covered, idle: covered != null ? shares - covered : null,
        brokers: [...new Set(lines.map(p => p.channel))].sort(), estimated: lines.some(p => p.pricingMode === 'cost') };
    }).sort((a, b) => a.ticker.localeCompare(b.ticker));
    const stocks = stockRows(equity), fundRows = stockRows(funds, true);
    const obligations = [...shortGroups].map(([ticker, lines]) => {
      const puts = lines.filter(p => p.option.right === 'put'), calls = lines.filter(p => p.option.right === 'call');
      const premiums = lines.map(p => {
        const detail = payload?.optionTradeDetails?.[p.ticker];
        return fresh(p) ? convert(detail?.stoGrossPremium, detail?.currency) : null;
      });
      const assessments = lines.map(p => !fresh(p) ? { probability:null, reason:'Broker position date is stale or unavailable' }
        : globalThis.OptionProbability.daysToExpiry(p.option.expiry, asOf) < 0 ? { probability:null, reason:'Past-expiry position requires broker confirmation' }
        : globalThis.OptionProbability.currentSpotItmProbability(p, payload?.equityPrices?.[ticker],
          globalThis.OptionProbability.daysToExpiry(p.option.expiry, asOf)));
      const probabilities = assessments.map(a => a.probability);
      const riskGaps = assessments.flatMap((a, i) => a.probability == null ? [`${lines[i].channel}: ${lines[i].ticker} — ${a.reason || 'Incomplete contract or quote'}`] : []);
      const premiumGaps = lines.flatMap((p, i) => premiums[i] == null ? [`${p.channel}: ${p.ticker} — ${!fresh(p) ? 'Broker position date is stale or unavailable' : !finite(payload?.optionTradeDetails?.[p.ticker]?.stoGrossPremium) ? 'Opening fills do not reconcile to the remaining quantity' : 'Reporting currency conversion unavailable'}`] : []);
      const spot = payload?.equityPrices?.[ticker];
      const days = lines.map(p => globalThis.OptionProbability.daysToExpiry(p.option.expiry, asOf));
      return { ticker, last: finite(spot) && spot > 0 && lines.every(p => p.currency === ccy) ? spot : null,
        shares: sum(equity.filter(p => symbol(p.ticker) === ticker).map(p => p.units)),
        putContracts: sum(puts.map(p => p.units)), callContracts: sum(calls.map(p => p.units)),
        cashIfAssigned: sum(puts.map(p => fresh(p) && comparable(p) && p.option.settlement === 'physical' ? p.contingentCashObligation : null)),
        sharesIfCalled: sum(calls.map(p => !fresh(p) ? null : p.option.settlement === 'cash' ? 0 : p.option.settlement === 'physical' ? p.contingentShareObligation : null)),
        premium: sum(premiums), premiumSubtotal: premiums.filter(finite).reduce((a, b) => a + b, 0),
        missingPremium: premiums.filter(p => p == null).length, knownPremium: premiums.filter(finite).length,
        pnl: sum(lines.map(p => valued(p) && fresh(p)
          ? convert(globalThis.OptionPosition.valuation(p)?.pnl, p.currency) : null)),
        nearestDte: days.every(finite) ? Math.min(...days) : null,
        highRisk: probabilities.filter(p => p != null && p > 0.6).length,
        unscored: probabilities.filter(p => p == null).length, riskGaps, premiumGaps,
        stale: lines.some(p => !fresh(p)), nonPhysical: lines.some(p => p.option.settlement !== 'physical') };
    }).sort((a, b) => (a.cashIfAssigned == null) - (b.cashIfAssigned == null) || (b.cashIfAssigned || 0) - (a.cashIfAssigned || 0) || a.ticker.localeCompare(b.ticker));
    const totalCost = sum(stocks.map(p => p.cost)), totalValue = sum(stocks.map(p => p.value));
    const totalPnl = totalCost != null && totalValue != null ? totalValue - totalCost : null;
    const totalShares = sum(stocks.map(p => p.shares)), totalCovered = sum(stocks.map(p => p.covered));
    return { ccy, channels, stocks, funds: fundRows, obligations,
      dates: Object.entries(payload?.brokerAsOf || {}).filter(([ch]) => all || ch === channel),
      cash: channelNav?.navComplete !== false && (all || channelNav) && finite(channelNav?.cashAmount) ? channelNav.cashAmount : null,
      totals: { shares: totalShares, cost: totalCost, value: totalValue, pnl: totalPnl,
        returnPct: totalPnl != null && totalCost > 0 ? totalPnl / totalCost * 100 : null,
        coveragePct: totalCovered != null && totalShares > 0 ? totalCovered / totalShares * 100 : null,
        cashIfAssigned: sum(obligations.map(p => p.cashIfAssigned)), premium: sum(obligations.map(p => p.premium)) },
      warnings: [...new Set([
        ...((live?.issues || []).filter(issue => !issue.key || positions.some(p => p.ticker === issue.key || p.channel === issue.key)).map(issue => issue.message)),
        ...(obligations.some(p => p.stale) ? ['Some option positions lack a recent confirmed broker date; assignment, premium, P&L and risk figures remain unavailable for those rows.'] : []),
        ...(obligations.some(p => p.nonPhysical) ? ['Cash-settled or unknown-settlement options do not imply physical share delivery or a strike-times-shares purchase obligation.'] : []),
      ])] };
  }
  globalThis.PositionsV2 = Object.freeze({ build, equityColumns, obligationColumns });
})();
