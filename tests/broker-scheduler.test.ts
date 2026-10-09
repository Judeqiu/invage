import { describe, expect, it, vi } from 'vitest';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { addBrokerAccount, addBrokerSource, patchBrokerAccount, readBrokerAccountModel,
  persistBrokerAccountModel } from '../src/brokers/accounts.js';
import { runDueBrokerSyncs } from '../src/brokers/scheduler.js';

describe('broker sync scheduler', () => {
  it('claims a due account once and executes its scheduled sync', async () => {
    let stored: InvestorState = {
      user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' },
      profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [],
    };
    const source = addBrokerSource(stored, 'ibkr', { token: 'secret1234' });
    const id = addBrokerAccount(stored, { source_id: source, account_id: 'U1', label: 'Main',
      config: { activity_query_id: '111' } });
    patchBrokerAccount(stored, id, { sync_frequency: 'hourly' });
    const model = readBrokerAccountModel(stored);
    model.connections[id].sync_schedule!.next_run_at = '2026-10-01T00:00:00Z';
    persistBrokerAccountModel(stored, model);
    let revision = 0;
    const sync = vi.fn(async () => ({ applied: {} as never }));
    const deps = {
      listUserIds: async () => ['alice'],
      loadInvestor: async () => ({ state: structuredClone(stored), revision }),
      saveInvestor: async (snapshot: { state: InvestorState; revision: number }) => {
        if (snapshot.revision !== revision) throw new Error('revision conflict');
        stored = structuredClone(snapshot.state);
        revision += 1;
        snapshot.revision = revision;
      },
      syncBrokerAccount: sync,
    };
    const now = new Date('2026-10-01T01:00:00Z');
    await runDueBrokerSyncs(now, deps);
    expect(sync).toHaveBeenCalledOnce();
    expect(sync.mock.calls[0]?.[1]).toBe(id);
    expect(sync.mock.calls[0]?.[3]).toBe('scheduled');
    expect(readBrokerAccountModel(stored).connections[id].sync_schedule?.next_run_at).toBe('2026-10-01T02:00:00.000Z');
    await runDueBrokerSyncs(now, deps);
    expect(sync).toHaveBeenCalledOnce();
  });
});
