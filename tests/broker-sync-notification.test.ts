import { describe, expect, it, vi } from 'vitest';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { brokerSyncFacts, captureBrokerSyncSnapshot, fallbackBrokerSyncSummary,
  publishBrokerSyncSuccess, publishBrokerSyncFailure } from '../src/brokers/sync-notification.js';
import type { BrokerApplyResult } from '../src/brokers/statement.js';

function state(): InvestorState {
  return { user: { id: 'u', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [] };
}
const applied: BrokerApplyResult = { accountId: 'U1', asOf: '2026-10-02', channel: 'ibkr-1',
  lotsUpserted: 2, lotsRemoved: 1, cash: [], skipped: [], };

describe('broker sync notification', () => {
  it('identifies position and cash changes only on the synced channel', () => {
    const before = state();
    before.portfolio = {
      'AAPL@ibkr-1': { channel: 'ibkr-1', units: 10, avg_price: 100 },
      'MSFT@ibkr-1': { channel: 'ibkr-1', units: 2, avg_price: 200 },
      'SPY@other': { channel: 'other', units: 4, avg_price: 300 },
    };
    before.cash = [{ channel: 'ibkr-1', currency: 'USD', amount: 50, updated_at: '2026-10-01' }];
    const after = structuredClone(before);
    after.portfolio = {
      'AAPL@ibkr-1': { channel: 'ibkr-1', units: 12, avg_price: 100 },
      'TSLA@ibkr-1': { channel: 'ibkr-1', units: 3, avg_price: 250 },
      'SPY@other': { channel: 'other', units: 8, avg_price: 300 },
    };
    after.cash = [{ channel: 'ibkr-1', currency: 'USD', amount: 75, updated_at: '2026-10-02' }];
    const facts = brokerSyncFacts('IBKR', 'Main', captureBrokerSyncSnapshot(before, 'ibkr-1'),
      captureBrokerSyncSnapshot(after, 'ibkr-1'), applied, true);
    expect(facts.added).toEqual(['TSLA 3 units']);
    expect(facts.removed).toEqual(['MSFT 2 units']);
    expect(facts.changed).toEqual(['AAPL: units 10 → 12']);
    expect(facts.cash).toEqual(['USD 50 → 75']);
    expect(fallbackBrokerSyncSummary(facts)).not.toContain('SPY');
  });

  it('publishes the LLM summary and falls back to facts when the model fails', async () => {
    const facts = brokerSyncFacts('IBKR', 'Main', captureBrokerSyncSnapshot(state(), 'ibkr-1'),
      captureBrokerSyncSnapshot(state(), 'ibkr-1'), applied, false);
    const notify = vi.fn(async () => ({ notification: {} as never, delivery: [] }));
    const summarize = vi.fn(async () => 'The first IBKR snapshot has no holdings.');
    await publishBrokerSyncSuccess('alice', false, facts, { summarize, notify });
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ slug: 'alice', body: 'The first IBKR snapshot has no holdings.',
      status_hint: 'success', href: '/settings/brokers' });
    summarize.mockRejectedValueOnce(new Error('model unavailable'));
    await publishBrokerSyncSuccess('alice', false, facts, { summarize, notify });
    expect(notify.mock.calls[1]?.[0].body).toContain('Initial snapshot');
    await publishBrokerSyncFailure('alice', 'IBKR', 'Main', 'fetch failed', notify);
    expect(notify.mock.calls[2]?.[0]).toMatchObject({ status_hint: 'failure', severity: 'medium' });
  });
});
