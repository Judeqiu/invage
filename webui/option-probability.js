// Shared by the dashboard and Positions v2; accepts only validated matching quotes.
(() => {
function daysToExpiry(expiry, asOf) {
  if (!expiry) return null;
  const e = Date.parse(`${expiry}T00:00:00Z`);
  const a = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(e) || !Number.isFinite(a)) return null;
  return Math.round((e - a) / 86400000);
}

// Normal CDF approximation, used with Black–Scholes d2 below.
function normalCdf(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * z);
  const density = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const tail = density * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}

function optionFinishItmProbability(position, spot, days) {
  const o = position.option;
  const strike = Number(o?.strike);
  const multiplier = Number(o?.multiplier || 100);
  const quote = position.probabilityQuote;
  const mark = quote?.mark;
  const unavailable = (reason) => ({ probability: null, iv: null, reason });
  if (!quote) return unavailable('Waiting for matching prices');
  spot = quote.spot;
  days = daysToExpiry(o?.expiry, quote.spotAsOf.slice(0, 10));
  if (!(spot > 0)) return unavailable('No spot quote');
  if (!(strike > 0 && multiplier > 0) || days == null) return unavailable('Incomplete contract');
  if (position.pricingMode === 'cost' || position.markSource === 'cost' || !Number.isFinite(mark)) return unavailable('No market mark');
  if (mark <= 0) return unavailable('Zero market mark');
  if (days <= 0) return { probability: o.right === 'put' ? Number(spot < strike) : Number(spot > strike), iv: null };
  const years = Math.max(days, 1) / 365.25;
  const premium = mark / multiplier;
  const intrinsic = o.right === 'put' ? Math.max(strike - spot, 0) : Math.max(spot - strike, 0);
  const upper = o.right === 'put' ? strike : spot;
  if (premium < intrinsic - 0.01 || premium >= upper) return unavailable('Matching prices fail value check');
  const priceAt = (vol) => {
    const vsqrt = vol * Math.sqrt(years);
    const d1 = (Math.log(spot / strike) + vsqrt * vsqrt / 2) / vsqrt;
    const d2 = d1 - vsqrt;
    return o.right === 'put'
      ? strike * normalCdf(-d2) - spot * normalCdf(-d1)
      : spot * normalCdf(d1) - strike * normalCdf(d2);
  };
  let lo = 0.0001;
  let hi = 10;
  if (premium < priceAt(lo) - 0.01 || premium > priceAt(hi)) return unavailable('Cannot solve IV');
  for (let i = 0; i < 65; i += 1) {
    const mid = (lo + hi) / 2;
    if (priceAt(mid) < premium) lo = mid;
    else hi = mid;
  }
  const iv = (lo + hi) / 2;
  const vsqrt = iv * Math.sqrt(years);
  const d2 = (Math.log(spot / strike) - vsqrt * vsqrt / 2) / vsqrt;
  return { probability: Math.max(0, Math.min(1, o.right === 'put' ? normalCdf(-d2) : normalCdf(d2))), iv };
}

// Calibrate IV from matched option/stock prices, then use the latest spot from
// any trading session. Broker valuation marks remain unchanged.
function currentSpotItmProbability(position, spot, days) {
  const o = position.option;
  const strike = Number(o?.strike);
  const multiplier = Number(o?.multiplier ?? 100);
  const quote = position.probabilityQuote;
  const mark = quote?.mark;
  const unavailable = reason => ({ probability: null, iv: null, reason });
  if (!(Number.isFinite(spot) && spot > 0)) return unavailable('No spot quote');
  if (!(Number.isFinite(strike) && strike > 0 && Number.isFinite(multiplier) && multiplier > 0) || !Number.isFinite(days) || !['put', 'call'].includes(o?.right)) return unavailable('Incomplete contract');
  if (days <= 0) return { probability: o.right === 'put' ? Number(spot < strike) : Number(spot > strike), iv: null };
  if (!quote) return unavailable('Waiting for matching prices');
  const optionTime = Date.parse(quote.optionAsOf), spotTime = Date.parse(quote.spotAsOf);
  if (!Number.isFinite(optionTime) || !Number.isFinite(spotTime) ||
    Math.abs(optionTime - spotTime) > 15 * 60_000 ||
    quote.optionAsOf.slice(0, 10) !== quote.spotAsOf.slice(0, 10)) return unavailable('Prices are not time matched');
  if (!Number.isFinite(mark) || mark <= 0) return unavailable('No usable matched option price');
  const currentSpot = spot, currentYears = days / 365;
  spot = quote.spot;
  const quoteDays = daysToExpiry(o.expiry, quote.spotAsOf.slice(0, 10));
  if (!(Number.isFinite(spot) && spot > 0 && quoteDays > 0)) return unavailable('No valid calibration spot or expiry');
  const years = quoteDays / 365;
  const discountedStrike = strike * Math.exp(-0.04 * years);
  const premium = mark / multiplier;
  const lower = o.right === 'put' ? Math.max(discountedStrike - spot, 0) : Math.max(spot - discountedStrike, 0);
  const upper = o.right === 'put' ? discountedStrike : spot;
  if (premium < lower - 0.000001 || premium >= upper) return unavailable('Matching prices fail value check');
  const priceAt = vol => {
    const v = vol * Math.sqrt(years);
    const d1 = (Math.log(spot / strike) + (0.04 + vol * vol / 2) * years) / v;
    const d2 = d1 - v;
    return o.right === 'put'
      ? discountedStrike * normalCdf(-d2) - spot * normalCdf(-d1)
      : spot * normalCdf(d1) - discountedStrike * normalCdf(d2);
  };
  let lo = 0.0001, hi = 10;
  if (premium < priceAt(lo) - 0.000001 || premium > priceAt(hi)) return unavailable('Cannot solve IV');
  for (let i = 0; i < 65; i++) {
    const mid = (lo + hi) / 2;
    if (priceAt(mid) < premium) lo = mid;
    else hi = mid;
  }
  const iv = (lo + hi) / 2;
  const d2 = (Math.log(currentSpot / strike) + (0.04 - iv * iv / 2) * currentYears) / (iv * Math.sqrt(currentYears));
  return { probability: Math.max(0, Math.min(1, o.right === 'put' ? normalCdf(-d2) : normalCdf(d2))), iv, optionAsOf: quote.optionAsOf, spotAsOf: quote.spotAsOf };
}

function riskLevel(probability) {
  return probability == null ? 'warning' : probability > .6 ? 'danger' : probability >= .45 ? 'warning' : 'ok';
}

globalThis.OptionProbability = Object.freeze({ riskLevel, finishItmProbability: optionFinishItmProbability, currentSpotItmProbability, daysToExpiry });
})();
