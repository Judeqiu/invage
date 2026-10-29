import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
import { buildPageProjections } from '../src/report/page-projections.js';
import type { Holding, OptionSpec } from '../src/market/types.js';

const source = readFileSync('webui/dashboard/aggregate-model.js', 'utf8');
const helpers = source.slice(source.indexOf('function reportingCcyCode('), source.indexOf('function selectedTradeChannels('));
const settlement = source.slice(source.indexOf('function tradeAmount('), source.indexOf('function recordedPremiumForView('));
const calculate = runInNewContext(`${helpers}\n${settlement}\nnetPutSettlement`);
const leg = (side: 'short' | 'long', strike: number, units = 1, extra: Partial<OptionSpec> = {}, position = {}) => ({
  instrument: 'option', channel: 'account-a', currency: 'USD', units,
  option: { side, right: 'put', strike, multiplier: 100, underlying: 'SPX', expiry: '2028-06-16', settlement: 'cash', ...extra },
  ...position,
});
const june = [leg('short', 7675, 2), leg('long', 7650), leg('long', 7625)];
const december = [leg('short', 7650, 1, { expiry: '2028-12-15' }), leg('long', 7600, 1, { expiry: '2028-12-15' })];
const spx = [...june, ...december];
const spy = leg('short', 500, 1, { underlying: 'SPY', expiry: '2029-01-19', settlement: 'physical' });
const view = (positions = spx, extra = {}) => ({ positions, reportingCurrency: 'USD', ...extra });

it('reproduces the document quantities without reusing the single 7650 long put', () => {
  expect(calculate(view(june))).toBe(7500);
  expect(calculate(view(december))).toBe(5000);
  expect(calculate(view())).toBe(12500);
  expect(calculate(view([...spx, spy]))).toBe(62500);
  // Settlement excludes premiums, reported costs, fees, cash, shares and marks.
  expect(calculate(view(spx.map(p => ({ ...p, cost: 999999, value: -99999 })), { cashAmount: 100000 }))).toBe(12500);
});

it('finds an interior strike maximum for ratio positions and respects fractional lots and multipliers', () => {
  expect(calculate(view([leg('short', 100), leg('long', 90, 2)]))).toBe(1000);
  expect(calculate(view([leg('short', 100, .5), leg('long', 90, .5)]))).toBe(500);
  expect(calculate(view([leg('short', 100, 1, { multiplier: 10 }), leg('long', 90, 1, { multiplier: 10 })]))).toBe(100);
  expect(calculate(view([leg('short', 100, 2), leg('long', 90)]))).toBe(11000);
  expect(calculate(view([leg('short', 100), leg('long', 110)]))).toBe(0);
});

it('keeps account, currency, expiry, underlying and settlement groups independent', () => {
  for (const protection of [
    leg('long', 90, 1, {}, { channel: 'account-b' }),
    leg('long', 90, 1, {}, { currency: 'SGD' }),
    leg('long', 90, 1, { expiry: '2028-12-15' }),
    leg('long', 90, 1, { underlying: 'SPY' }),
    leg('long', 90, 1, { settlement: 'physical' }),
  ]) expect(calculate(view([leg('short', 100), protection]))).toBe(10000);
  // AM and PM contracts cannot net even on the same calendar date.
  expect(calculate(view([
    { ...leg('short', 100), option: { ...leg('short', 100).option, settlement_class: 'SPX' } },
    { ...leg('long', 90), option: { ...leg('long', 90).option, settlement_class: 'SPXW' } },
  ]))).toBe(10000);
});

it('converts native settlement once and leaves missing evidence unavailable', () => {
  expect(calculate(view(spx, { reportingCurrency: 'SGD', fxRates: { USD: 1.3 } }))).toBe(16250);
  expect(calculate(view(spx, { reportingCurrency: 'SGD' }))).toBeNull();
  expect(calculate(view([leg('short', 100, 1, { multiplier: undefined })]))).toBeNull();
  expect(calculate(view([leg('short', 100, 1, { settlement: undefined })]))).toBeNull();
  expect(calculate(view([]))).toBe(0);
});

it('saves the corrected result for both combined and account views and checks protective-leg freshness', () => {
  const holdings: Record<string, Holding> = {};
  for (const [index, p] of [...spx, spy].entries()) holdings['leg-' + index] = {
    instrument: 'option', channel: p.channel, currency: p.currency, units: p.units, avg_price: 0,
    option: { ...p.option, mark: 0 } as OptionSpec,
  };
  const model = buildDashboardModel(buildLivePositions(holdings, {}, {},
    [{ channel: 'account-a', currency: 'USD', amount: 0 }], [], '2026-10-29', { reportingCurrency: 'USD', fxRates: {} }), []);
  const payload: any = { model, generatedAt: '2026-10-29T09:39:54.437Z', brokerAsOf: { 'account-a': '2026-10-28' } };
  const scopes = buildPageProjections(payload).dashboard.live as any;
  expect(scopes.merged.assignmentObligation).toBe(62500);
  expect(scopes['account-a'].assignmentObligation).toBe(62500);
  payload.brokerAsOf['account-a'] = '2026-10-20';
  expect((buildPageProjections(payload).dashboard.live.merged as any).assignmentObligation).toBeNull();
});
