import { expect, it } from 'vitest';
import { buildRecordedOptionAnalytics } from '../src/webapp/option-analytics.js';
import type { OptionExecution } from '../src/brokers/option-executions.js';
import type { OptionLifecycleEvent } from '../src/brokers/option-events.js';

const open: OptionExecution = { channel: 'ibkr', account_id: 'A', execution_id: 'open', contract_id: 'AMD-P',
  executed_at: '2026-08-01T10:00:00', underlying: 'AMD', right: 'put', strike: '100', expiry: '2026-12-18',
  multiplier: '100', contracts: '2', side: 'sell', effect: 'open', currency: 'USD', gross_premium: '600', commission: '-2' };
const close = (patch: Partial<OptionExecution> = {}): OptionExecution => ({ ...open, execution_id: 'close',
  executed_at: '2026-09-15T10:00:00', contracts: '1', side: 'buy', effect: 'close', gross_premium: '-50', commission: '-1', ...patch });
const expiry: OptionLifecycleEvent = { id: 'expired', broker_id: 'ibkr', channel: 'ibkr', account_id: 'A',
  underlying: 'AMD', right: 'put', strike: '100', expiry: '2026-12-18', multiplier: '100', date: '2026-12-18',
  kind: 'expiration', contracts: '1', currency: 'USD', settlement: 'physical', source: 'ibkr_flex', fees: '0' };

it('allocates partial-close opening cash and fees and realizes in closing month, not expiry month', () => {
  const result = buildRecordedOptionAnalytics([open, close(), close({ execution_id: 'last', executed_at: '2026-10-15T10:00:00', gross_premium: '-100' })]);
  expect(result.profits).toMatchObject([{ date: '2026-09-15', gross: 250, net: 248 }, { date: '2026-10-15', gross: 200, net: 198 }]);
  expect(result.gaps).toEqual([]);
});

it('isolates accounts and refuses unmatched closing quantities', () => {
  const result = buildRecordedOptionAnalytics([open, close({ account_id: 'B' }), close({ execution_id: 'too-many', contracts: '3' })]);
  expect(result.profits).toEqual([]);
  expect(result.gaps).toHaveLength(2);
});

it('keeps missing fees unknown while preserving before-fees P&L, including long hedges', () => {
  expect(buildRecordedOptionAnalytics([{ ...open, commission: null }, close()]).profits[0]).toMatchObject({ gross: 250, net: null });
  const longOpen = { ...open, side: 'buy' as const, gross_premium: '-600' };
  expect(buildRecordedOptionAnalytics([longOpen, close({ side: 'sell', gross_premium: '400' })]).profits[0]).toMatchObject({ gross: 100, net: 98 });
});

it('realizes explicit expirations without inferring expiration from disappearance', () => {
  expect(buildRecordedOptionAnalytics([open]).profits).toEqual([]);
  expect(buildRecordedOptionAnalytics([open, close()], [expiry]).profits).toMatchObject([
    { gross: 250, date: '2026-09-15' }, { gross: 300, net: 299, date: '2026-12-18' },
  ]);
});

it('does not label physical assignment cash as realized option profit', () => {
  const assignment = { ...expiry, kind: 'assignment' as const, contracts: '2' };
  expect(buildRecordedOptionAnalytics([open], [assignment]).profits).toEqual([]);
  expect(buildRecordedOptionAnalytics([open], [{ ...assignment, broker_realized_pl: '0' }]).profits[0]).toMatchObject({ gross: null, net: 0, source: 'broker_event' });
  expect(buildRecordedOptionAnalytics([], [{ ...assignment, broker_realized_pl: '125' }])).toMatchObject({
    profits: [{ net: 125, source: 'broker_event' }], gaps: [],
  });
});
