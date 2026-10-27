import { describe, expect, it, vi } from 'vitest';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { brokerSyncFacts, captureBrokerSyncSnapshot, fallbackBrokerSyncSummary,
  withBrokerSyncBatchNotifications, publishBrokerSyncSuccess, publishBrokerSyncFailure } from '../src/brokers/sync-notification.js';
import type { BrokerApplyResult } from '../src/brokers/statement.js';
import { HISTORY_PENDING_REASON, HISTORY_REVIEW_REASON } from '../src/brokers/statement.js';

function state(): InvestorState {
  return { user: { id: 'u', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [] };
}
const applied: BrokerApplyResult = { accountId: 'U1', asOf: '2026-10-02', channel: 'ibkr-1',
  lotsUpserted: 2, lotsRemoved: 1, cash: [], skipped: [], };

it.each([HISTORY_PENDING_REASON,HISTORY_REVIEW_REASON])('does not label a saved snapshot with unfinished history as complete: %s',async reason=>{
  const notify=vi.fn(async()=>({notification:{} as never,delivery:[]})),summarize=vi.fn(async()=> 'Current positions and cash saved.');
  const facts=brokerSyncFacts('Tiger Brokers','Main',captureBrokerSyncSnapshot(state(),'tiger'),captureBrokerSyncSnapshot(state(),'tiger'),
    {...applied,skipped:[{kind:'event',reason}]},true);
  await publishBrokerSyncSuccess('alice',false,facts,{notify,summarize});
  expect(notify.mock.calls[0][0].title).toMatch(/snapshot saved; history/);
  expect(notify.mock.calls[0][0].status_hint).toBeUndefined();
  expect(notify.mock.calls[0][0].body).toContain(reason);
});

it('does not report a daily batch with a history conflict as completely synced',async()=>{
  const notify=vi.fn(async()=>({notification:{} as never,delivery:[]})),summarize=vi.fn(async()=> 'unused');
  const facts=brokerSyncFacts('Tiger Brokers','Main',captureBrokerSyncSnapshot(state(),'tiger'),captureBrokerSyncSnapshot(state(),'tiger'),
    {...applied,skipped:[{kind:'event',reason:HISTORY_REVIEW_REASON}]},true);
  await withBrokerSyncBatchNotifications({userId:'alice',date:'2026-10-27',accounts:[{label:'Tiger',status:'succeeded'}]},async()=>{
    await publishBrokerSyncSuccess('alice',false,facts,{notify,summarize});
  },notify);
  expect(notify).toHaveBeenCalledOnce();
  expect(notify.mock.calls[0][0]).toMatchObject({title:'Broker snapshots saved; history needs review',severity:'medium'});
  expect(notify.mock.calls[0][0].status_hint).toBeUndefined();
  expect(notify.mock.calls[0][0].body).not.toContain('automatic retry');
});

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
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ userId: 'alice', body: 'The first IBKR snapshot has no holdings.',
      status_hint: 'success', href: '/settings/brokers' });
    summarize.mockRejectedValueOnce(new Error('model unavailable'));
    await publishBrokerSyncSuccess('alice', false, facts, { summarize, notify });
    expect(notify.mock.calls[1]?.[0].body).toContain('Initial snapshot');
    await publishBrokerSyncFailure('alice', 'IBKR', 'Main', 'fetch failed', { notify });
    expect(notify.mock.calls[2]?.[0]).toMatchObject({ status_hint: 'failure', severity: 'medium' });
  });

  it('explains the retry plan only when an automatic retry is scheduled', async () => {
    const notify = vi.fn(async () => ({ notification: {} as never, delivery: [] }));
    await publishBrokerSyncFailure('alice', 'IBKR', 'Main', 'fetch failed', { notify, retryScheduled: true });
    expect(notify.mock.calls[0]?.[0].body).toContain("We'll retry automatically. Your regular sync frequency stays the same.");
    expect(notify.mock.calls[0]?.[0].body).not.toContain('30 minutes');
    expect(notify.mock.calls[0]?.[0].body).toContain('Check Settings → Brokers → Sync history.');
    await publishBrokerSyncFailure('alice', 'IBKR', 'Main', 'fetch failed', { notify });
    expect(notify.mock.calls[1]?.[0].body).not.toContain('retry');
  });

  it('includes each coverage note once in notifications even when the LLM omits it or fails', async () => {
    const note = 'Fund assets 1198.16 USD recorded as an account total only; individual fund holdings are unavailable.';
    const facts = brokerSyncFacts('Moomoo', 'Main', captureBrokerSyncSnapshot(state(), 'moomoo'),
      captureBrokerSyncSnapshot(state(), 'moomoo'), { ...applied,
        skipped: [{ kind: 'position', reason: note }, { kind: 'position', reason: note }] }, true);
    expect(facts.coverage_notes).toEqual([note]);
    const notify = vi.fn(async () => ({ notification: {} as never, delivery: [] }));
    const summarize = vi.fn(async () => 'Moomoo sync complete.');
    await publishBrokerSyncSuccess('alice', false, facts, { summarize, notify });
    expect(notify.mock.calls[0]?.[0].body).toBe(`Moomoo sync complete.\n\nData notes:\n${note}`);
    expect(summarize.mock.calls[0]?.[2]).not.toHaveProperty('coverage_notes');
    summarize.mockRejectedValueOnce(new Error('model unavailable'));
    await publishBrokerSyncSuccess('alice', false, facts, { summarize, notify });
    const body = notify.mock.calls[1]?.[0].body ?? '';
    expect(body.split(note)).toHaveLength(2);
    expect(body).toContain('No holdings or cash changes');
  });
});

it('sends one combined notice after all brokers finish, preserving failures and coverage notes', async () => {
  const notify = vi.fn(async () => ({ notification: {} as never, delivery: [] }));
  const summarize = vi.fn(async () => 'unused');
  const facts = brokerSyncFacts('IBKR', 'Main', captureBrokerSyncSnapshot(state(), 'ibkr-1'), captureBrokerSyncSnapshot(state(), 'ibkr-1'), applied, true);
  facts.coverage_notes = ['One source row was unavailable'];
  const notice = { userId: 'alice', date: '2026-10-23', accounts: [
    { label: 'IBKR · Main', status: 'succeeded' }, { label: 'Tiger · Savings', status: 'failed' }], snapshotStatus: 'skipped' as const };
  await withBrokerSyncBatchNotifications(notice, async () => {
    await publishBrokerSyncSuccess('alice', false, facts, { notify, summarize });
    await publishBrokerSyncFailure('alice', 'Tiger', 'Savings', 'Broker unavailable', { notify });
    expect(notify).not.toHaveBeenCalled();
  }, notify);
  expect(summarize).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledOnce();
  expect(notify.mock.calls[0][0]).toMatchObject({ userId: 'alice', status_hint: 'failure', title: 'Broker sync needs attention' });
  expect(notify.mock.calls[0][0].body).toContain('IBKR');
  expect(notify.mock.calls[0][0].body).toContain('Tiger Savings: Broker unavailable');
  expect(notify.mock.calls[0][0].body.split('One source row was unavailable')).toHaveLength(2);
});

it('isolates simultaneous users and leaves standalone sync notifications enabled', async () => {
  const notify = vi.fn(async () => ({ notification: {} as never, delivery: [] }));
  const summarize = vi.fn(async (_user, _admin, facts) => facts.broker + ' standalone');
  const facts = brokerSyncFacts('IBKR', 'Main', captureBrokerSyncSnapshot(state(), 'ibkr-1'), captureBrokerSyncSnapshot(state(), 'ibkr-1'), applied, true);
  const run = (userId: string) => withBrokerSyncBatchNotifications({ userId, date: '2026-10-23', accounts: [{ label: userId, status: 'succeeded' }] }, async () => {
    await Promise.resolve();
    await publishBrokerSyncSuccess(userId, false, { ...facts, account: userId }, { notify, summarize });
  }, notify);
  await Promise.all([run('alice'), run('bob')]);
  expect(notify).toHaveBeenCalledTimes(2);
  expect(notify.mock.calls.find(([notice]) => notice.userId === 'alice')![0].body).not.toContain('IBKR bob');
  await publishBrokerSyncSuccess('outside', false, facts, { notify, summarize });
  expect(notify).toHaveBeenCalledTimes(3);
  expect(summarize).toHaveBeenCalledOnce();
});

it('does not notify for an empty batch, and notification failure does not fail synced data', async () => {
  const notify = vi.fn(async () => { throw new Error('delivery unavailable'); });
  const notice = { userId: 'alice', date: '2026-10-23', accounts: [] as { label: string; status: string }[] };
  await withBrokerSyncBatchNotifications(notice, async () => {}, notify);
  expect(notify).not.toHaveBeenCalled();
  notice.accounts.push({ label: 'IBKR', status: 'succeeded' });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { await expect(withBrokerSyncBatchNotifications(notice, async () => 'saved', notify)).resolves.toBe('saved'); }
  finally { log.mockRestore(); }
  expect(notify).toHaveBeenCalledOnce();
});
