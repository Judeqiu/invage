import { expect, it } from 'vitest';
import { attachDailyChanges, singaporeDate } from '../src/report/daily-changes.js';
import type { PortfolioProjection } from '../src/state/projection-store.js';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
import { buildPageProjections } from '../src/report/page-projections.js';
function fixture(at = '2026-10-22T06:00:00Z', amount = 100) {
  const scope = (value: number, channels = ['one']) => ({ view: { totalValue: value, totalCost: 50, totalPL: value - 50,
    totalPLPct: value - 50, cashAmount: 0, cashCurrency: 'USD', reportingCurrency: 'USD', navComplete: true, channels },
    premium: { total: value, daily: 0 }, risk: { wheel: { cover: 80 } } });
  return { calculatedAt: at, dashboard: { aggregatedViews: { live: { merged: scope(amount, ['one', 'two']), one: scope(amount / 2) } } },
    brokers: { ibkr: { scopes: { live: { merged: scope(amount / 2) } } }, tiger: { scopes: { live: { merged: scope(amount / 4, ['two']) } } } } } as unknown as PortfolioProjection;
}
const changes = (e: PortfolioProjection, channel = 'merged') => (e.dashboard.aggregatedViews!.live[channel] as any).dailyChanges;
it('uses Singapore dates and the previous day close, never an earlier same-day sync', () => {
  expect(singaporeDate('2026-10-22T16:00:00Z')).toBe('2026-10-23');
  const yesterday = fixture(); attachDailyChanges(yesterday);
  expect(changes(yesterday).metrics).toEqual({});
  const today = fixture('2026-10-22T16:00:00Z', 120); attachDailyChanges(today, yesterday.dailyAggregateHistory);
  expect(changes(today).metrics.totalValue).toMatchObject({ delta: 20, percent: 20, unit: 'USD' });
  expect(changes(today, 'one').metrics.totalValue.delta).toBe(10);
  expect((today.brokers.ibkr.scopes.live.merged as any).dailyChanges.metrics.totalValue.delta).toBe(10);
  expect((today.brokers.tiger.scopes.live.merged as any).dailyChanges.metrics.totalValue.delta).toBe(5);
  const later = fixture('2026-10-23T07:00:00Z', 130); attachDailyChanges(later, today.dailyAggregateHistory);
  expect(changes(later).metrics.totalValue.delta).toBe(30);
  const tomorrow = fixture('2026-10-24T06:00:00Z', 140); attachDailyChanges(tomorrow, later.dailyAggregateHistory);
  expect(changes(tomorrow).metrics.totalValue.delta).toBe(10);
  expect(changes(today).metrics.cashAmount).toMatchObject({ delta: 0, percent: null });
  expect(changes(today).metrics.totalPLPct.percent).toBeNull();
});
it('withholds missing-day, incomplete, changed currency and changed membership comparisons', () => {
  const old = fixture(); attachDailyChanges(old);
  const skipped = fixture('2026-10-24T06:00:00Z'); attachDailyChanges(skipped, old.dailyAggregateHistory);
  expect(changes(skipped).metrics).toEqual({});
  for (const patch of [{ navComplete: false }, { reportingCurrency: 'SGD' }, { channels: ['one', 'two', 'new'] }]) {
    const today = fixture('2026-10-23T06:00:00Z');
    Object.assign((today.dashboard.aggregatedViews!.live.merged as any).view, patch);
    attachDailyChanges(today, old.dailyAggregateHistory);
    expect(changes(today).metrics).toEqual({});
    expect(changes(today, 'one').metrics.totalValue.delta).toBe(0);
  }
});
it('does not publish a delta against an unavailable previous value and bounds retained history', () => {
  const old = fixture(); (old.dashboard.aggregatedViews!.live.merged as any).view.navComplete = false; attachDailyChanges(old);
  const today = fixture('2026-10-23T06:00:00Z'); attachDailyChanges(today, old.dailyAggregateHistory);
  expect(changes(today).metrics).toEqual({});
  let history = today.dailyAggregateHistory;
  for (let i = 0; i < 40; i++) {
    const entry = fixture(new Date(Date.parse('2026-10-24T06:00:00Z') + i * 86400_000).toISOString());
    attachDailyChanges(entry, history); history = entry.dailyAggregateHistory;
  }
  expect(Object.keys(history!)).toHaveLength(35);
});
it('uses explicit comparable portfolio snapshot values, without inventing broker cash history', () => {
  const entry = fixture('2026-10-23T06:00:00Z', 120);
  (entry.dashboard as any).model = { history: [{ date: '2026-10-22', reportingCurrency: 'USD',
    positions: [{ channel: 'one' }, { channel: 'two' }], totalValue: 100, totalCost: 50, totalPL: 50 }] };
  attachDailyChanges(entry);
  expect(changes(entry).metrics.totalValue.delta).toBe(20);
  expect(changes(entry).metrics.cashAmount).toBeUndefined();
  expect(changes(entry, 'one').metrics).toEqual({});
  expect((entry.brokers.ibkr.scopes.live.merged as any).dailyChanges.metrics).toEqual({});
});

it('recovers the previous daily-sync baseline without treating combined cash as an extra account', () => {
  const live = buildLivePositions({
    AAPL: { channel: 'one', currency: 'USD', units: 1, avg_price: 50 },
    MSFT: { channel: 'two', currency: 'USD', units: 1, avg_price: 100 },
  }, { AAPL: 100, MSFT: 200 }, {}, [
    { channel: 'one', currency: 'USD', amount: 50 }, { channel: 'two', currency: 'USD', amount: 50 },
  ], [], '2026-10-23', { reportingCurrency: 'USD', fxRates: {} });
  const prior = { date: '2026-10-22', reportingCurrency: 'USD', totalValue: 380, totalCost: 150,
    totalPL: 130, totalPLPct: 130 / 150 * 100, cashAmount: 100, cashCurrency: 'USD',
    positions: live.positions.map(p => ({ ...p, value: p.value - 10, pl: p.pl - 10 })) };
  for (const cashChannel of [undefined, 'default']) {
    const dashboard: any = { generatedAt: '2026-10-23T06:00:00Z',
      model: buildDashboardModel(live, [{ ...prior, cashChannel }]) };
    dashboard.aggregatedViews = buildPageProjections(dashboard).dashboard;
    const entry = { calculatedAt: dashboard.generatedAt, dashboard, brokers: {} } as PortfolioProjection;
    attachDailyChanges(entry);
    if (cashChannel === undefined) {
      expect(changes(entry).metrics.totalValue.delta).toBe(20);
      expect(changes(entry).metrics.cashAmount.delta).toBe(0);
      expect((dashboard.aggregatedViews['2026-10-22'].merged as any).view.channels).not.toContain('default');
    } else {
      // A genuinely attributed unassigned cash account is still a different scope.
      expect(changes(entry).metrics).toEqual({});
    }
    expect(changes(entry, 'one').metrics).toEqual({});
    expect(changes(entry, 'two').metrics).toEqual({});
  }
});

it('handles newly empty scopes with no reporting currency', () => {
  const entry = fixture();
  Object.assign((entry.dashboard.aggregatedViews!.live.merged as any).view, { reportingCurrency: null, cashCurrency: null });
  expect(() => attachDailyChanges(entry)).not.toThrow();
  expect(changes(entry).metrics).toEqual({});
});
