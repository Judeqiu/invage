/* Expiry payoff bounds for open option strategies. Cost is already in reporting currency. */
(function (root) {
  function calculate(view) {
    if (!view || view.navComplete === false) return { value: null, reason: 'Position currency or FX unavailable.' };
    const groups = new Map();
    for (const p of view.positions || []) {
      if (p.instrument !== 'option') continue;
      const o = p.option, units = Number(p.units), cost = Number(p.cost);
      const currency = view.reportingCurrency || view.cashCurrency;
      const rate = p.currency && p.currency === currency ? 1 : view.fxRates?.[p.currency];
      if (!o || !['long', 'short'].includes(o.side) || !['put', 'call'].includes(o.right) ||
          !o.underlying || !o.expiry || !(o.strike > 0) || !(o.multiplier > 0) || !(units > 0) ||
          p.cost == null || ![cost, units, o.strike, o.multiplier, rate].every(Number.isFinite) || !(rate > 0)) return { value: null, reason: 'Option terms, opening cost or FX unavailable.' };
      const key = JSON.stringify([p.channel, o.underlying, o.expiry, p.currency]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ right: o.right, strike: o.strike, size: units * o.multiplier * (o.side === 'long' ? 1 : -1), cost, rate });
    }
    let value = 0;
    for (const legs of groups.values()) {
      if (legs.filter(l => l.right === 'call').reduce((n, l) => n + l.size, 0) < 0)
        return { value: null, unbounded: true, reason: 'Net short calls have unbounded options-only expiry loss; shares are excluded.' };
      const cost = legs.reduce((n, l) => n + l.cost, 0);
      const payoff = spot => legs.reduce((n, l) => n + l.size * Math.max(0, l.right === 'put' ? l.strike - spot : spot - l.strike) * l.rate, 0) - cost;
      value += Math.max(0, -Math.min(...[0, ...legs.map(l => l.strike)].map(payoff)));
    }
    return { value, reason: 'Estimated maximum expiry loss across open options, from recorded signed opening costs, before fees. Offsets apply only within the same broker account, underlying, expiry and currency. Sums strategy maxima conservatively; excludes shares, cash collateral and early assignment effects.' };
  }
  root.NetRiskCapital = { calculate };
})(globalThis);
