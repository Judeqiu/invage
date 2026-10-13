import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { buildExecutionJournal, type OptionExecution } from '../src/brokers/option-executions.js';

const source = readFileSync('webui/dashboard/app.js', 'utf8');
const calculator = source.slice(source.indexOf('function recordedPremiumForView('), source.indexOf('\nfunction unverifiedOptionChannels'));
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
    payload: { premiumJournal: { ...journal, channels: [...new Set(records.map(r => r.channel))] }, premiumSupportedChannels: ['ibkr', 'tiger'] },
    view: { channelView: 'ibkr', reportingCurrency: 'USD', ...view }, date,
    MERGED_CHANNEL_VIEW: 'merged', reportingCcyCode: (v: any) => v.reportingCurrency,
    optionDateLabel: (d: string) => d,
  });
}
it('sums net opening credits and closing costs across months without counting future fills', () => {
  const result = calculate();
  expect(result.total).toBe(547);
  expect(result.mtd).toBe(199);
  expect(result.daily).toBeNull();
  expect(calculate(fills, {}, '2026-08-05').total).toBe(399);
});
it('includes closed-only brokers in the merged total and respects a selected broker', () => {
  const records = [...fills, { ...execution, channel: 'tiger', execution_id: 'closed', gross_premium: '100' }];
  expect(calculate(records, { channelView: 'merged', channels: ['ibkr'] }).total).toBe(646);
  expect(calculate(records).total).toBe(547);
});
it('converts historical currencies and refuses to combine them without FX', () => {
  const records = [...fills, { ...execution, execution_id: 'foreign', currency: 'SGD', gross_premium: '101' }];
  expect(calculate(records).total).toBeNull();
  expect(calculate(records).totalReason).toContain('without FX');
  expect(calculate(records, { fxApplied: true, fxRates: { SGD: 0.75 } }).total).toBe(622);
  expect(calculate(records, { fxApplied: false, fxRates: { SGD: 0.75 } }).total).toBe(622);
});
it('keeps unknown historical fees distinct from verified current-month premium', () => {
  const records = fills.map((r, i) => i === 0 ? { ...r, commission: null } : r);
  const result = calculate(records);
  expect(result.total).toBeNull();
  expect(result.totalReason).toContain('fees are unavailable');
  expect(result.mtd).toBe(199);
  expect(calculate([], { channelView: 'merged', channels: ['ibkr'] }).total).toBeNull();
  expect(calculate(fills, { channelView: 'merged', channels: ['ibkr', 'unsupported'] }).total).toBeNull();
});
