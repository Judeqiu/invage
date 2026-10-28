import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync('webui/dashboard/aggregate-model.js', 'utf8');
const OptionPosition = runInNewContext(readFileSync('webui/option-position.js', 'utf8') + '; OptionPosition');
const calculator = source.slice(source.indexOf('function openBookPremiumData('), source.indexOf('    const result = {}'));
const option = (overrides = {}) => ({
  ticker: 'AAPL PUT', instrument: 'option', currency: 'USD', cost: -600, value: -200, pl: 400,
  option: { underlying: 'AAPL', expiry: '2026-11-20', side: 'short' }, ...overrides,
});
function calculate(overrides = {}, payload = {}) {
  return runInNewContext(`${calculator}\nopenBookPremiumData(view)`, {
    payload, OptionPosition,
    tradeAmount: (view: any, row: any, amount: number) => {
      const rate = row.currency === view.reportingCurrency ? 1 : view.fxRates?.[row.currency];
      return typeof amount === 'number' && Number.isFinite(amount) && Number.isFinite(rate) && rate > 0 ? amount * rate : null;
    },
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


it('counts a verified replacement roll net once instead of the full opening credit', () => {
  const position = option({ ticker: 'AVGO CALL', units: 1, avgCost: 1950, price: 630, cost: -1950, value: -630, pl: 1320,
    option: { underlying: 'AVGO', expiry: '2026-12-18', side: 'short' } });
  const result = calculate({ isLive: true, positions: [position] }, {
    optionTradeDetails: { 'AVGO CALL': { currency: 'USD', stoGrossPremium: 1950, rollPremium: 815, rollDate: '2026-10-07' } },
  });
  expect(result.premiumByExpiry.get('2026-12')).toBe(815);
  expect(result.premiumByUnderlying.get('AVGO')).toBe(815);
  expect(result.pnlByExpiry.get('2026-12')).toBe(1320);
  expect(result.concentration.get('AVGO')).toBe(-6.3);
});

it('preserves roll debits, zero, account-specific rows and native-to-reporting conversion exactly once', () => {
  const positions = [option({ ticker: 'A', channel: 'first' }),
    option({ ticker: 'B', channel: 'second', currency: 'SGD', cost: -450 }), option({ ticker: 'C' })];
  const details = { A: { currency: 'USD', rollPremium: 815, rollDate: '2026-10-07' },
    B: { currency: 'SGD', rollPremium: -50, rollDate: '2026-10-07' },
    C: { currency: 'USD', rollPremium: 0, rollDate: '2026-10-07' } };
  const result = calculate({ isLive: true, positions, fxRates: { SGD: .75 } }, { optionTradeDetails: details });
  expect(result.premiumByExpiry.get('2026-11')).toBe(777.5);
  expect(result.premiumByUnderlying.get('AAPL')).toBe(777.5);
});

it('withholds an affected bucket when a known roll cannot be verified, without falling back to its STO', () => {
  for (const rollPremium of [null, undefined, NaN, Infinity, '815']) {
    const result = calculate({ isLive: true, positions: [option()] }, {
      optionTradeDetails: { 'AAPL PUT': { currency: 'USD', stoGrossPremium: 1950, rollDate: '2026-10-07', rollPremium } },
    });
    expect(result.premiumByExpiry.get('2026-11')).toBeNull();
    expect(result.premiumByUnderlying.get('AAPL')).toBeNull();
  }
  const missingFx = calculate({ isLive: true, positions: [option()] }, {
    optionTradeDetails: { 'AAPL PUT': { currency: 'SGD', rollDate: '2026-10-07', rollPremium: 815 } },
  });
  expect(missingFx.premiumByExpiry.get('2026-11')).toBeNull();
});

it("never applies today's roll evidence to an archived snapshot", () => {
  const result = calculate({ isLive: false, positions: [option()] }, {
    optionTradeDetails: { 'AAPL PUT': { currency: 'USD', rollDate: '2026-10-07', rollPremium: 815 } },
  });
  expect(result.premiumByExpiry.get('2026-11')).toBe(600);
});
