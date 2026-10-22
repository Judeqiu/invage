import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync('webui/dashboard/app.js', 'utf8');
const calculator = source.slice(source.indexOf('function openBookPremiumData('), source.indexOf('function premiumBarCard('));
const option = (overrides = {}) => ({
  ticker: 'AAPL PUT', instrument: 'option', currency: 'USD', cost: -600, value: -200, pl: 400,
  option: { underlying: 'AAPL', expiry: '2026-11-20', side: 'short' }, ...overrides,
});
function calculate(overrides = {}) {
  return runInNewContext(`${calculator}\nopenBookPremiumData(view)`, {
    view: { positions: [], totalValue: 10000, reportingCurrency: 'USD', ...overrides },
    reportingCcyCode: (view: any) => view.reportingCurrency,
    optionUnderlyingLabel: (o: any) => o.underlying,
  });
}

it('nets long and short opening cost by expiry and underlying, without converting reporting values twice', () => {
  const result = calculate({ fxRates: { SGD: 0.75 }, positions: [
    option(),
    option({ currency: 'SGD', cost: 150, value: 75, pl: -75, option: { underlying: 'AAPL', expiry: '2026-11-20', side: 'long' } }),
    option({ cost: -100, value: -150, pl: -50, option: { underlying: 'MSFT', expiry: '2026-12-18', side: 'short' } }),
    { ticker: 'AAPL', instrument: 'equity', currency: 'USD', cost: 1000, value: 1200, pl: 200 },
  ], cashAmount: 9075, depositsAmount: 0 });
  expect([...result.premiumByExpiry]).toEqual([['2026-11', 450], ['2026-12', 100]]);
  expect([...result.premiumByUnderlying]).toEqual([['AAPL', 450], ['MSFT', 100]]);
  expect([...result.pnlByExpiry]).toEqual([['2026-11', 325], ['2026-12', -50]]);
  expect(result.concentration.get('AAPL')).toBe(10.75);
  expect(result.concentration.get('MSFT')).toBe(-1.5);
  expect(result.concentration.get('Cash')).toBe(90.75);
});

it('keeps incomplete buckets unavailable and does not report cost-only marks as zero profit', () => {
  const result = calculate({ positions: [option(), option({ currency: 'SGD' }),
    option({ markSource: 'cost', option: { underlying: 'MSFT', expiry: '2026-12-18' } })], navComplete: false });
  expect(result.premiumByExpiry.get('2026-11')).toBeNull();
  expect(result.pnlByExpiry.get('2026-11')).toBeNull();
  expect(result.pnlByExpiry.get('2026-12')).toBeNull();
  expect(result.premiumByExpiry.get('2026-12')).toBe(600);
  expect([...result.concentration.values()]).toEqual([null, null]);
});

it('preserves zero and negative results, unknown expiries and NAV weights above 100%', () => {
  const result = calculate({ positions: [option({ cost: 0, pl: 0, value: 12000 }),
    option({ cost: 100, value: -2000, pl: -2100, option: { underlying: 'MSFT' } })] });
  expect(result.premiumByExpiry.get('2026-11')).toBe(0);
  expect(result.pnlByExpiry.get('2026-11')).toBe(0);
  expect(result.premiumByExpiry.get('Unknown expiry')).toBe(-100);
  expect(result.concentration.get('AAPL')).toBe(120);
  expect(result.concentration.get('MSFT')).toBe(-20);
  expect(calculate({ positions: [option()], totalValue: 0 }).concentration.get('AAPL')).toBeNull();
});
