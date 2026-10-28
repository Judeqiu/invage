import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const context: any = {};
runInNewContext(readFileSync('webui/dashboard/net-risk-capital.js', 'utf8'), context);
const leg = (side: string, right: string, strike: number, cost: number, extra = {}) => ({
  instrument: 'option', channel: 'ibkr', currency: 'USD', units: 1, cost,
  option: { side, right, strike, multiplier: 100, underlying: 'AAPL', expiry: '2026-11-20' }, ...extra,
});
const risk = (positions: any[], extra = {}) => context.NetRiskCapital.calculate({ positions, reportingCurrency: 'USD', ...extra });
it('bounds a cash-secured put, long option and credit vertical using signed costs', () => {
  expect(risk([leg('short', 'put', 100, -300)]).value).toBe(9700);
  expect(risk([leg('long', 'call', 100, 300)]).value).toBe(300);
  expect(risk([leg('short', 'put', 100, -300), leg('long', 'put', 90, 100)]).value).toBe(800);
});
it('recognizes call spreads and unbounded net short calls', () => {
  expect(risk([leg('short', 'call', 100, -300), leg('long', 'call', 110, 100)]).value).toBe(800);
  expect(risk([leg('short', 'call', 100, -300)]).unbounded).toBe(true);
});
it('offsets protective legs whose underlying is reported as a verified broker contract code', () => {
  const short = leg('short', 'call', 100, -300);
  const long = leg('long', 'call', 105, 100);
  for (const underlying of ['AAPL 261120C00105000', 'aapl261120c105000', ' aapl ']) {
    expect(risk([short, { ...long, option: { ...long.option, underlying } }]).value).toBe(300);
  }
  // Mismatched terms must not turn an unrelated contract into protection.
  const mismatch = { ...long, option: { ...long.option, underlying: 'AAPL 261120C00110000' } };
  expect(risk([short, mismatch]).value).toBeNull();
  expect(risk([short, { ...long, channel: 'other-account' }]).unbounded).toBe(true);
});
it('does not offset contracts across broker accounts or expiries', () => {
  expect(risk([leg('short', 'put', 100, -300), leg('long', 'put', 90, 100, { channel: 'tiger' })]).value).toBe(9800);
  const other = leg('long', 'call', 110, 100); other.option.expiry = '2026-12-18';
  expect(risk([leg('short', 'call', 100, -300), other]).unbounded).toBe(true);
});
it('converts strike payoffs once, preserves converted cost, and rejects missing FX', () => {
  expect(risk([leg('short', 'put', 100, -600, { currency: 'SGD' })], { fxRates: { SGD: 2 } }).value).toBe(19400);
  expect(risk([leg('short', 'put', 100, -600, { currency: 'SGD' })]).value).toBeNull();
  expect(risk([], { navComplete: false }).value).toBeNull();
  expect(risk([]).value).toBe(0);
});
