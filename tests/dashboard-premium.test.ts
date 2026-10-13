import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { buildExecutionJournal, type OptionExecution } from '../src/brokers/option-executions.js';

const source = readFileSync('webui/dashboard/app.js', 'utf8');
const calculator = source.slice(source.indexOf('function selectedTradeChannels('), source.indexOf('\nfunction unverifiedOptionChannels'));
const execution: OptionExecution = {
  channel: 'ibkr', account_id: 'A', execution_id: '1', contract_id: 'AMD-P',
  executed_at: '2026-08-01T10:00:00', underlying: 'AMD', right: 'put',
  expiry: '2026-09-18', strike: '100', multiplier: '100', contracts: '1',
  side: 'sell', effect: 'open', currency: 'USD', gross_premium: '400', commission: '-1',
};
const fills = [execution,
  { ...execution, execution_id: '2', executed_at: '2026-08-10T10:00:00', side: 'buy', effect: 'close', gross_premium: '-50' },
  { ...execution, execution_id: '3', executed_at: '2026-09-10T10:00:00', gross_premium: '200' },
  { ...execution, execution_id: '4', executed_at: '2026-10-10T10:00:00', gross_premium: '900' },
] as OptionExecution[];
function calculate(records = fills, view: Record<string, unknown> = {}, date = '2026-09-16') {
  const journal = buildExecutionJournal(records);
  return runInNewContext(`${calculator}\nrecordedPremiumForView(view, date)`, {
    payload: { premiumJournal: { ...journal, channels: [...new Set(records.map(r => r.channel))] }, optionAnalytics: { executions: records }, premiumSupportedChannels: ['ibkr', 'tiger'] },
    view: { channelView: 'ibkr', reportingCurrency: 'USD', ...view }, date,
    MERGED_CHANNEL_VIEW: 'merged', reportingCcyCode: (v: any) => v.reportingCurrency,
    optionDateLabel: (d: string) => d,
  });
}
it('sums before-fees opening credits and closing costs across months without counting future fills', () => {
  const result = calculate();
  expect(result.total).toBe(550);
  expect(result.mtd).toBe(200);
  expect(result.daily).toBe(200);
  expect(result.dailyDate).toBe('2026-09-10');
  expect(calculate(fills, {}, '2026-08-05').total).toBe(400);
});
it('includes closed-only brokers in the merged total and respects a selected broker', () => {
  const records = [...fills, { ...execution, channel: 'tiger', execution_id: 'closed', gross_premium: '100' }];
  expect(calculate(records, { channelView: 'merged', channels: ['ibkr'] }).total).toBe(650);
  expect(calculate(records).total).toBe(550);
});
it('converts historical currencies and refuses to combine them without FX', () => {
  const records = [...fills, { ...execution, execution_id: 'foreign', currency: 'SGD', gross_premium: '101' }];
  expect(calculate(records).total).toBeNull();
  expect(calculate(records).totalReason).toContain('without FX');
  expect(calculate(records, { fxApplied: true, fxRates: { SGD: 0.75 } }).total).toBe(625.75);
  expect(calculate(records, { fxApplied: false, fxRates: { SGD: 0.75 } }).total).toBe(625.75);
});
it('keeps unknown historical fees distinct from verified current-month premium', () => {
  const records = fills.map((r, i) => i === 0 ? { ...r, commission: null } : r);
  const result = calculate(records);
  expect(result.total).toBe(550);
  expect(result.totalBasis).toBe('gross');
  expect(calculate().totalBasis).toBe('gross');
  expect(result.mtd).toBe(200);
  expect(calculate([], { channelView: 'merged', channels: ['ibkr'] }).total).toBeNull();
  expect(calculate(fills, { channelView: 'merged', channels: ['ibkr', 'unsupported'] }).total).toBe(550);
  expect(calculate(fills, { channelView: 'merged', channels: ['ibkr', 'unsupported'] }).partial).toBe(true);
});

it('uses one consistent before-fees basis when a closing fee is missing, with fees separate from premium', () => {
  const records = fills.map((row, i) => i === 1 || i === 2 ? { ...row, commission: null } : row);
  const result = calculate(records);
  expect(result.total).toBe(550);
  expect(result.totalBasis).toBe('gross');
  expect(result.mtd).toBe(200);
  expect(result.missingFees).toBe(1);
  expect(result.reason).toContain('before fees');
  const journal = buildExecutionJournal(records);
  expect(journal.daily.find(row => row.date === '2026-08-10')?.gross_premium).toBe('-50');
  expect(journal.cumulative[0].gross_premium).toBe('1450');
});

it('buckets recorded cash flow and realized profit by trade month and excludes future evidence', () => {
  const helper = source.slice(source.indexOf('function selectedTradeChannels('), source.indexOf('function recordedPremiumForView('));
  const monthly = source.slice(source.indexOf('function recordedMonthlyData('), source.indexOf('function monthlyLineCard('));
  const result = runInNewContext(`${helper}\n${monthly}\nrecordedMonthlyData(view, date)`, {
    payload: { premiumJournal: { channels: ['ibkr'] }, optionAnalytics: { executions: fills,
      profits: [{ channel: 'ibkr', date: '2026-08-10', currency: 'USD', gross: 350, net: 348 },
        { channel: 'ibkr', date: '2026-10-10', currency: 'USD', gross: 900, net: 899 }], gaps: [] } },
    view: { channelView: 'ibkr', reportingCurrency: 'USD' }, date: '2026-09-16',
    MERGED_CHANNEL_VIEW: 'merged', reportingCcyCode: (v: any) => v.reportingCurrency,
  });
  expect([...result.byMonth]).toEqual([['2026-08', 350], ['2026-09', 200]]);
  expect([...result.byUnderlying]).toEqual([['AMD', 550]]);
  expect(result.realized.get('2026-08')).toBe(348);
  expect(result.realized.has('2026-09')).toBe(false);
});

it('shows zero recorded MTD flow in a month without trades while retaining the latest daily trade', () => {
  const result = calculate(fills, {}, '2026-11-01');
  expect(result.mtd).toBe(0);
  expect(result.daily).toBe(900);
  expect(result.dailyDate).toBe('2026-10-10');
  expect(result.fees).toBe(0);
});

function monthlyResult(profits: unknown[], gaps: unknown[] = [], fxRates: unknown = undefined) {
  const helper = source.slice(source.indexOf('function selectedTradeChannels('), source.indexOf('function recordedPremiumForView('));
  const monthly = source.slice(source.indexOf('function recordedMonthlyData('), source.indexOf('function monthLabel('));
  return runInNewContext(`${helper}\n${monthly}\nrecordedMonthlyData(view, date)`, {
    payload: { optionAnalytics: { executions: [], profits, gaps } },
    view: { channelView: 'ibkr', reportingCurrency: 'USD', fxRates }, date: '2026-10-13',
    MERGED_CHANNEL_VIEW: 'merged', reportingCcyCode: (v: any) => v.reportingCurrency,
  });
}

it('keeps calculable monthly results as partial subtotals when opening history is missing', () => {
  const result = monthlyResult([
    { channel: 'ibkr', underlying: 'AMD', date: '2026-05-10', currency: 'USD', gross: 100, net: 98 },
    { channel: 'ibkr', underlying: 'AMD', date: '2026-05-11', currency: 'USD', gross: -40, net: null },
    { channel: 'other', date: '2026-05-10', currency: 'USD', gross: 500, net: 499 },
    { channel: 'ibkr', date: '2026-11-10', currency: 'USD', gross: 500, net: 499 },
  ], [{ channel: 'ibkr', date: '2026-05-12', reason: 'Closing quantity has no complete matching opening fills' }]);
  expect(result.realized.get('2026-05')).toBe(60);
  expect(result.monthly.get('2026-05')).toMatchObject({ partial: true, excluded: 1, count: 2, basis: 'gross' });
  expect(result.monthly.get('2026-05').contributions.get('AMD · IBKR').value).toBe(60);
  expect(result.monthly.size).toBe(1);
});

it('retains broker-reported after-fee results, identifies mixed fees, and leaves empty months unavailable', () => {
  const result = monthlyResult([
    { channel: 'ibkr', date: '2026-05-10', currency: 'USD', gross: null, net: 15 },
    { channel: 'ibkr', date: '2026-05-11', currency: 'USD', gross: 20, net: 18 },
    { channel: 'ibkr', date: '2026-07-10', currency: 'USD', gross: null, net: 10 },
    { channel: 'ibkr', date: '2026-07-11', currency: 'USD', gross: -5, net: null },
  ]);
  expect(result.realized.get('2026-05')).toBe(33);
  expect(result.monthly.get('2026-05').basis).toBe('net');
  expect(result.realized.get('2026-06')).toBeNull();
  expect(result.realized.get('2026-07')).toBe(5);
  expect(result.monthly.get('2026-07')).toMatchObject({ basis: 'mixed', partial: true });
});

it('excludes unconvertible profit without losing a known subtotal or treating missing records as zero', () => {
  const result = monthlyResult([
    { channel: 'ibkr', date: '2026-05-10', currency: 'USD', gross: 20, net: 18 },
    { channel: 'ibkr', date: '2026-05-11', currency: 'EUR', gross: 100, net: 98 },
  ], [{ channel: 'ibkr', date: '2026-04-10', reason: 'Closing quantity has no complete matching opening fills' }]);
  expect(result.realized.get('2026-05')).toBe(18);
  expect(result.monthly.get('2026-05')).toMatchObject({ count: 1, excluded: 1, partial: true });
  expect(result.realized.get('2026-04')).toBeNull();
});
