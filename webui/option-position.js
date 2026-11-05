/* Shared native-currency option valuation and execution cash-flow conventions. */
(() => {
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function valuation(position, broker = true) {
    const option = position?.option;
    if (!option || !['long', 'short'].includes(option.side)) return null;
    const reported = broker && position.brokerValues?.units === position.units && position.brokerValues?.avg_price === position.avgCost ? position.brokerValues : null;
    const mark = finite(reported?.mark) ? reported.mark : broker && finite(position.brokerMark) ? position.brokerMark
      : finite(position.price) ? position.price : option.mark;
    if (![mark, position.units, position.avgCost].every(finite)) return null;
    // Marks and average costs are already per contract, not per share.
    const direction = option.side === 'short' ? -1 : 1;
    const cost = direction * position.avgCost * position.units;
    const value = finite(reported?.market_value) ? reported.market_value : direction * mark * position.units;
    return { mark, cost, value, pnl: finite(reported?.unrealized_pl) ? reported.unrealized_pl : value - cost };
  }
  function cashFlow(trade) {
    if (!trade || !/^[A-Z]{3,4}$/.test(trade.currency || '')) return null;
    const rolled = Boolean(trade.rollDate) || trade.rollPremium !== undefined;
    const value = rolled ? trade.rollPremium : trade.stoGrossPremium ?? trade.openingGrossPremium;
    return finite(value) ? value : null;
  }
  globalThis.OptionPosition = Object.freeze({ valuation, cashFlow });
})();
