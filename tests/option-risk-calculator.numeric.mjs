import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRisk, priceOption } from '../webui/option-risk/model.js';

const base = { right: 'put', side: 'short', style: 'european', spot: 100, strike: 100,
  premium: 5, contracts: 1, multiplier: 100, days: 365, horizon: 5, iv: .2,
  rate: .05, dividendYield: 0, equity: 10000, spotShock: .3, ivShock: .2, exitCost: 0 };
const near = (actual, expected, tolerance = .0001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

describe('standalone option stress calculator', () => {
  it('matches the standard European Black–Scholes benchmark and put-call parity', () => {
    const call = priceOption({ ...base, right: 'call' });
    const put = priceOption(base);
    near(call, 10.45058357);
    near(put, 5.57352602);
    near(call - put, 100 - 100 * Math.exp(-.05));
  });
  it('prices early exercise: American put exceeds European and is near its benchmark', () => {
    const american = priceOption({ ...base, style: 'american' });
    assert.ok(american > priceOption(base));
    near(american, 6.09, .05);
    near(priceOption({ ...base, style: 'american', right: 'call' }), 10.45, .05);
    assert.ok(priceOption({ ...base, style: 'american', spot: 20 }) >= 80);
  });
  it('uses exact expiry payoffs and caps the effective horizon at expiry', () => {
    const r = calculateRisk({ ...base, days: 1, horizon: 5, strike: 95, premium: 2 });
    assert.equal(r.horizon, 1);
    assert.equal(r.worst.price, 25);
    assert.equal(r.stressLoss, 2300);
    assert.equal(r.index, 23);
    assert.equal(r.maximumLoss, 9300);
    assert.equal(r.grossPutFunding, 9500);
    assert.equal(r.expectedShortfall, null);
  });
  it('reverses long/short P&L, applies costs once and scales with size and equity', () => {
    const short = calculateRisk(base), long = calculateRisk({ ...base, side: 'long' });
    assert.equal(short.scenarios.length, 15);
    short.scenarios.forEach((s, i) => near(s.pnl, -long.scenarios[i].pnl));
    near(calculateRisk({ ...base, contracts: 3 }).index, short.index * 3);
    near(calculateRisk({ ...base, equity: 20000 }).index, short.index / 2);
    near(calculateRisk({ ...base, exitCost: 10 }).stressLoss, short.stressLoss + 10);
    assert.equal(long.maximumLoss, 500);
    assert.equal(long.grossPutFunding, null);
  });
  it('retains unbounded-call exposure even if the finite stress score is small', () => {
    const r = calculateRisk({ ...base, right: 'call', equity: 1 });
    assert.equal(r.unlimited, true);
    assert.equal(r.maximumLoss, null);
    assert.equal(r.callDeliveryShares, 100);
    assert.ok(r.index > 100);
  });
  it('rejects missing, nonfinite, fractional and out-of-range financial inputs', () => {
    for (const patch of [{ premium: NaN }, { equity: 0 }, { spot: Infinity }, { contracts: 1.5 },
      { multiplier: 0 }, { iv: 0 }, { side: 'buy' }, { days: 0 }, { horizon: 1.5 }, { spotShock: 1 }, { rate: undefined }])
      assert.throws(() => calculateRisk({ ...base, ...patch }));
  });
});
