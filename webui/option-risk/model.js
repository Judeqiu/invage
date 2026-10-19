/** Indicative standalone vanilla option stress model. All prices are per share. */
const normal = x => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) *
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
};
const intrinsic = (right, spot, strike) => Math.max(0, right === 'call' ? spot - strike : strike - spot);

export function priceOption({ right, style, spot, strike, days, iv, rate, dividendYield }) {
  if (days <= 0) return intrinsic(right, spot, strike);
  const years = days / 365, sigmaT = iv * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate - dividendYield + iv * iv / 2) * years) / sigmaT;
  const d2 = d1 - sigmaT;
  const discountedSpot = spot * Math.exp(-dividendYield * years), discountedStrike = strike * Math.exp(-rate * years);
  const european = Math.max(0, right === 'call'
    ? discountedSpot * normal(d1) - discountedStrike * normal(d2)
    : discountedStrike * normal(-d2) - discountedSpot * normal(-d1));
  if (style === 'european') return european;
  // Equal-probability (Jarrow–Rudd) tree; continuous yield, early exercise at each node.
  const steps = 200, dt = years / steps, discount = Math.exp(-rate * dt);
  const drift = (rate - dividendYield - iv * iv / 2) * dt;
  const up = Math.exp(drift + iv * Math.sqrt(dt)), down = Math.exp(drift - iv * Math.sqrt(dt));
  const values = Array.from({ length: steps + 1 }, (_, j) => intrinsic(right, spot * up ** j * down ** (steps - j), strike));
  for (let n = steps - 1; n >= 0; n--) {
    for (let j = 0; j <= n; j++) {
      values[j] = Math.max(discount * (values[j] + values[j + 1]) / 2,
        intrinsic(right, spot * up ** j * down ** (n - j), strike));
    }
  }
  return Math.max(european, values[0]);
}

export function calculateRisk(input) {
  const p = { ...input };
  for (const [key, min, max] of [
    ['spot', 0.01, 1e7], ['strike', 0.01, 1e7], ['premium', 0.0001, 1e7],
    ['contracts', 1, 1e6], ['multiplier', 1, 1e6], ['days', 1, 1825],
    ['horizon', 1, 1825], ['iv', 0.01, 5], ['rate', -0.05, 0.2],
    ['dividendYield', 0, 0.5], ['equity', 0.01, 1e15], ['spotShock', 0.01, 0.95],
    ['ivShock', 0, 2], ['exitCost', 0, 1e9],
  ]) {
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] < min || p[key] > max)
      throw new Error(`Invalid ${key}: enter a number between ${min} and ${max}.`);
  }
  if (!['call', 'put'].includes(p.right) || !['long', 'short'].includes(p.side) || !['american', 'european'].includes(p.style))
    throw new Error('Choose a valid option type, side and exercise style.');
  if (![p.contracts, p.multiplier, p.days, p.horizon].every(Number.isInteger))
    throw new Error('Contracts, multiplier and days must be whole numbers.');
  const size = p.contracts * p.multiplier, sign = p.side === 'long' ? 1 : -1;
  const horizon = Math.min(p.horizon, p.days), modelPrice = priceOption(p);
  const scenarios = [];
  for (const spotShock of [-p.spotShock, -p.spotShock / 2, 0, p.spotShock / 2, p.spotShock]) {
    for (const ivShock of [-p.ivShock, 0, p.ivShock]) {
      const iv = Math.max(0.01, p.iv + ivShock);
      const price = priceOption({ ...p, spot: p.spot * (1 + spotShock), iv, days: p.days - horizon });
      scenarios.push({ spotShock, ivChange: iv - p.iv, price, pnl: sign * (price - p.premium) * size - p.exitCost });
    }
  }
  const worst = scenarios.reduce((a, b) => a.pnl < b.pnl ? a : b);
  const stressLoss = Math.max(0, -worst.pnl);
  const unlimited = p.side === 'short' && p.right === 'call';
  // Bounds measured from the entered current mark, excluding positions after exercise.
  const maximumLoss = unlimited ? null : (p.side === 'long' ? p.premium : Math.max(0, p.strike - p.premium)) * size + p.exitCost;
  return {
    version: 'standalone-stress-v1', input: p, horizon, modelPrice, scenarios, worst, stressLoss,
    index: stressLoss / p.equity * 100, maximumLoss, unlimited,
    currentPremium: p.premium * size,
    grossPutFunding: p.side === 'short' && p.right === 'put' ? p.strike * size : null,
    callDeliveryShares: unlimited ? size : null,
    expectedShortfall: null,
  };
}
