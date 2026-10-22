import { describe, expect, it, vi } from 'vitest';
import type { InvestorSnapshot } from '../src/state/investor-store.js';
import { addBrokerAccount, addBrokerSource, patchBrokerAccount } from '../src/brokers/accounts.js';
import { runDailyBrokerSyncs } from '../src/brokers/daily-sync.js';

function fixture() {
  const users = new Map<string, InvestorSnapshot>();
  function addUser(slug: string) {
    const snapshot: InvestorSnapshot = { state: {
      user: { id: slug, slug, created_at: '2026-01-01' },
      profile: { display_name: slug, contact_email: 'a@example.com' }, log: [],
    }, revision: 0 };
    const source = addBrokerSource(snapshot.state, 'ibkr', { token: 'secret-token' });
    const ids = ['A', 'B', 'paused'].map(account_id => addBrokerAccount(snapshot.state,
      { source_id: source, account_id, label: account_id, config: { activity_query_id: '123' } }));
    patchBrokerAccount(snapshot.state, ids[2], { enabled: false });
    users.set(slug, snapshot);
    return { ids, source };
  }
  const alice = addUser('alice');
  const events: string[] = [];
  const deps = {
    listUserIds: async () => [...users.keys()],
    loadInvestor: async (slug: string) => structuredClone(users.get(slug)!),
    saveInvestor: async (snapshot: InvestorSnapshot) => {
      const prior = users.get(snapshot.state.user.id)!;
      if (snapshot.revision !== prior.revision) throw new Error('revision conflict');
      snapshot.revision++;
      users.set(snapshot.state.user.id, structuredClone(snapshot));
    },
    syncBrokerAccount: vi.fn(async (snapshot: InvestorSnapshot, id: string) => {
      events.push(`sync:${snapshot.state.user.id}:${id}`);
      return { applied: {} as never };
    }),
    brokerSyncInProgress: vi.fn(() => false),
    capturePortfolioSnapshot: vi.fn(async (state, date) => { events.push(`snapshot:${state.user.id}:${date}`); return {} as never; }),
  };
  return { users, alice, addUser, deps, events };
}
const at = (time = '06:00:00', date = '2026-10-23') => new Date(`${date}T${time}Z`);

describe('daily 2 pm Singapore broker sync', () => {
  it('runs at 06:00 UTC for all users without account schedules and snapshots after all imports', async () => {
    const f = fixture();
    f.addUser('bob');
    await runDailyBrokerSyncs(at('05:59:59'), f.deps);
    expect(f.deps.syncBrokerAccount).not.toHaveBeenCalled();
    await runDailyBrokerSyncs(at(), f.deps);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(4);
    expect(f.deps.syncBrokerAccount.mock.calls.every(call => call[3] === 'scheduled')).toBe(true);
    expect(f.events).toEqual([
      ...f.alice.ids.slice(0, 2).map(id => `sync:alice:${id}`), 'snapshot:alice:2026-10-23',
      ...Object.keys(f.users.get('bob')!.state.broker_connections!).slice(0, 2).map(id => `sync:bob:${id}`),
      'snapshot:bob:2026-10-23',
    ]);
    await runDailyBrokerSyncs(at('06:01:00'), f.deps);
    expect(f.deps.capturePortfolioSnapshot).toHaveBeenCalledTimes(2);
    await runDailyBrokerSyncs(at('05:59:59', '2026-10-24'), f.deps);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(4);
    await runDailyBrokerSyncs(at('06:00:00', '2026-10-24'), f.deps);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(8);
  });

  it('includes newly created users and newly linked accounts automatically', async () => {
    const f = fixture();
    await runDailyBrokerSyncs(at(), f.deps);
    f.addUser('new-user');
    const state = f.users.get('alice')!.state;
    const id = addBrokerAccount(state, { source_id: f.alice.source, account_id: 'NEW', label: 'New', config: { activity_query_id: '123' } });
    await runDailyBrokerSyncs(at('06:01:00'), f.deps);
    expect(f.deps.syncBrokerAccount.mock.calls.map(call => call[1])).toContain(id);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(5);
    expect(f.deps.capturePortfolioSnapshot).toHaveBeenCalledTimes(3);
  });

  it('continues after failure, retries only failed accounts, and retains the original date across Singapore midnight', async () => {
    const f = fixture();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    f.deps.syncBrokerAccount.mockRejectedValueOnce(new Error('broker offline'));
    await runDailyBrokerSyncs(at('15:50:00'), f.deps);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(2);
    expect(f.deps.capturePortfolioSnapshot).not.toHaveBeenCalled();
    await runDailyBrokerSyncs(at('16:00:00'), f.deps);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(2);
    await runDailyBrokerSyncs(at('16:20:00'), f.deps);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(3);
    expect(f.events.at(-1)).toBe('snapshot:alice:2026-10-23');
    errors.mockRestore();
  });

  it('starts a fresh batch the next afternoon even if yesterday never completed', async () => {
    const f = fixture();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    f.deps.syncBrokerAccount.mockRejectedValueOnce(new Error('broker offline'));
    await runDailyBrokerSyncs(at(), f.deps);
    expect(f.deps.capturePortfolioSnapshot).not.toHaveBeenCalled();
    await runDailyBrokerSyncs(at('06:00:00', '2026-10-24'), f.deps);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(4);
    expect(f.events.at(-1)).toBe('snapshot:alice:2026-10-24');
    errors.mockRestore();
  });

  it('defers busy accounts and retries snapshot failures without reimporting', async () => {
    const f = fixture();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    f.deps.brokerSyncInProgress.mockReturnValueOnce(true);
    await runDailyBrokerSyncs(at(), f.deps);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(1);
    expect(f.deps.capturePortfolioSnapshot).not.toHaveBeenCalled();
    f.deps.capturePortfolioSnapshot.mockRejectedValueOnce(new Error('quotes unavailable'));
    await runDailyBrokerSyncs(at('06:30:00'), f.deps);
    expect(f.users.get('alice')!.state.daily_broker_sync?.completed_at).toBeUndefined();
    await runDailyBrokerSyncs(at('07:00:00'), f.deps);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(2);
    expect(f.deps.capturePortfolioSnapshot).toHaveBeenCalledTimes(2);
    expect(f.users.get('alice')!.state.daily_broker_sync?.completed_at).toBeTruthy();
    errors.mockRestore();
  });

  it('claims a batch once across overlapping schedulers and resumes after an expired lease', async () => {
    const f = fixture();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await Promise.all([runDailyBrokerSyncs(at(), f.deps), runDailyBrokerSyncs(at(), f.deps)]);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(2);
    expect(f.deps.capturePortfolioSnapshot).toHaveBeenCalledOnce();
    f.users.get('alice')!.state.daily_broker_sync = {
      date: '2026-10-24', synced_accounts: {}, lease_until: '2026-10-24T07:00:00Z',
    };
    await runDailyBrokerSyncs(at('06:00:00', '2026-10-24'), f.deps);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(2);
    await runDailyBrokerSyncs(at('07:00:00', '2026-10-24'), f.deps);
    expect(f.deps.syncBrokerAccount).toHaveBeenCalledTimes(4);
    errors.mockRestore();
  });
});
