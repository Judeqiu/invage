/* Shared native-currency option valuation and execution cash-flow conventions. */
(() => {
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function valuation(position, broker = true) {
    const option = position?.option;
    if (!option || !['long', 'short'].includes(option.side)) return null;
    const mark = broker && finite(position.brokerMark) ? position.brokerMark
      : finite(position.price) ? position.price : option.mark;
    if (![mark, position.units, position.avgCost].every(finite)) return null;
    // Marks and average costs are already per contract, not per share.
    const direction = option.side === 'short' ? -1 : 1;
    const cost = direction * position.avgCost * position.units;
    const value = direction * mark * position.units;
    return { mark, cost, value, pnl: value - cost };
  }
  function cashFlow(trade) {
    if (!trade || !/^[A-Z]{3,4}$/.test(trade.currency || '')) return null;
    const rolled = Boolean(trade.rollDate) || trade.rollPremium !== undefined;
    const value = rolled ? trade.rollPremium : trade.stoGrossPremium ?? trade.openingGrossPremium;
    return finite(value) ? value : null;
  }
  globalThis.OptionPosition = Object.freeze({ valuation, cashFlow });
})();
