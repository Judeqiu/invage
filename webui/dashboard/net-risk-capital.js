/* Expiry payoff bounds for open option strategies. Cost is already in reporting currency. */
(function (root) {
  // Brokers may report an OCC contract code in place of the underlying ticker.
  // Use its root only when all encoded terms agree with this leg.
  function underlyingKey(option) {
    const raw = String(option.underlying || '').trim().toUpperCase();
    const code = raw.replace(/\s+/g, '').match(/^([A-Z][A-Z0-9.]*?)(\d{6})([CP])(\d{1,8})$/);
    if (!code) return raw;
    const expiry = `20${code[2].slice(0, 2)}-${code[2].slice(2, 4)}-${code[2].slice(4, 6)}`;
    return expiry === option.expiry && code[3] === (option.right === 'put' ? 'P' : 'C') &&
      Number(code[4]) / 1000 === option.strike ? code[1] : null;
  }
  function calculate(view) {
    if (!view || view.navComplete === false) return { value: null, reason: 'Position currency or FX unavailable.' };
    const groups = new Map(), shares = new Map();
    const coverKey = (channel, underlying, currency) => JSON.stringify([channel, underlying, currency]);
    for (const p of view.positions || []) {
      if (p.instrument !== 'equity' || !(p.units > 0)) continue;
      const ticker = String(p.ticker || '');
      const at = ticker.lastIndexOf('@');
      const underlying = (at > 0 ? ticker.slice(0, at) : ticker).trim().toUpperCase();
      const key = coverKey(p.channel, underlying, p.currency);
      const lot = shares.get(key) || { units: 0, cost: 0 };
      lot.units += Number(p.units);
      lot.cost = p.cost == null ? NaN : lot.cost + Number(p.cost);
      shares.set(key, lot);
    }
    for (const p of view.positions || []) {
      if (p.instrument !== 'option') continue;
      const o = p.option, units = Number(p.units), cost = Number(p.cost);
      const currency = view.reportingCurrency || view.cashCurrency;
      const rate = p.currency && p.currency === currency ? 1 : view.fxRates?.[p.currency];
      if (!o || !['long', 'short'].includes(o.side) || !['put', 'call'].includes(o.right) ||
          !o.underlying || !o.expiry || !(o.strike > 0) || !(o.multiplier > 0) || !(units > 0) ||
          p.cost == null || ![cost, units, o.strike, o.multiplier, rate].every(Number.isFinite) || !(rate > 0)) return { value: null, reason: 'Option terms, opening cost or FX unavailable.' };
      const underlying = underlyingKey(o);
      if (!underlying) return { value: null, reason: 'Option underlying code disagrees with its contract terms.' };
      const key = JSON.stringify([p.channel, underlying, o.expiry, p.currency]);
      if (!groups.has(key)) groups.set(key, { legs: [], cover: coverKey(p.channel, underlying, p.currency) });
      groups.get(key).legs.push({ right: o.right, strike: o.strike, size: units * o.multiplier * (o.side === 'long' ? 1 : -1), cost, rate });
    }
    // Reserve distinct shares for each expiry; the same shares cannot cover
    // multiple assignments. Only the cost of shares backing calls is included.
    const requiredShares = new Map();
    for (const group of groups.values()) {
      group.shares = Math.max(0, -group.legs.filter(l => l.right === 'call').reduce((n, l) => n + l.size, 0));
      requiredShares.set(group.cover, (requiredShares.get(group.cover) || 0) + group.shares);
    }
    for (const [key, required] of requiredShares) {
      if (required === 0) continue;
      const lot = shares.get(key);
      if (!lot || !Number.isFinite(lot.units) || lot.units < required)
        return { value: null, unbounded: true, reason: 'Short calls exceed matching long calls and recorded shares in the same account. There is no finite maximum expiry loss for the uncovered quantity.' };
      if (!Number.isFinite(lot.cost)) return { value: null, reason: 'Cost basis for shares backing short calls is unavailable.' };
    }
    let value = 0;
    for (const group of groups.values()) {
      const legs = group.legs, lot = shares.get(group.cover);
      const stockCost = group.shares ? lot.cost * group.shares / lot.units : 0;
      const cost = legs.reduce((n, l) => n + l.cost, stockCost);
      const payoff = spot => group.shares * spot * legs[0].rate + legs.reduce((n, l) => n + l.size * Math.max(0, l.right === 'put' ? l.strike - spot : spot - l.strike) * l.rate, 0) - cost;
      value += Math.max(0, -Math.min(...[0, ...legs.map(l => l.strike)].map(payoff)));
    }
    return { value, reason: 'Estimated maximum expiry loss from recorded signed opening costs, before fees. Matching long options offset short options within the same account, underlying, expiry and currency. Covered calls include the proportional recorded cost of backing shares in the same account and currency; shares are never reused across expiries. Sums strategy maxima conservatively; excludes other shares, cash collateral and early assignment effects.' };
  }
  root.NetRiskCapital = { calculate };
})(globalThis);
