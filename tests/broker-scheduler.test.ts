vi.mock('utarus', async original => ({ ...await original<typeof import('utarus')>(), notifyUser: vi.fn(async () => ({ notification: {}, delivery: [] })) }));
import { notifyUser } from 'utarus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { addBrokerAccount, addBrokerSource, patchBrokerAccount, readBrokerAccountModel,
  persistBrokerAccountModel } from '../src/brokers/accounts.js';
import { runDueBrokerSyncs } from '../src/brokers/scheduler.js';

beforeEach(() => vi.mocked(notifyUser).mockClear());
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

it('groups due accounts into one notice and advances schedules already satisfied by a daily sync', async () => {
  let stored: InvestorState = { user: { id: 'alice', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [] };
  const source = addBrokerSource(stored, 'ibkr', { token: 'secret' });
  const ids = ['Main', 'Savings', 'Already synced'].map((label, i) => addBrokerAccount(stored,
    { source_id: source, account_id: 'A' + i, label, config: { activity_query_id: '111' } }));
  for (const id of ids) patchBrokerAccount(stored, id, { sync_frequency: 'hourly' });
  const model = readBrokerAccountModel(stored);
  for (const id of ids) model.connections[id].sync_schedule!.next_run_at = '2026-10-23T06:00:00Z';
  model.connections[ids[2]].last_sync = { ok: true, at: '2026-10-23T06:00:10Z' };
  persistBrokerAccountModel(stored, model);
  let revision = 0;
  const syncBrokerAccount = vi.fn(async () => ({ applied: {} as never, aggregation: { status: 'ready' as const } }));
  const deps = { listUserIds: async () => ['alice'], loadInvestor: async () => ({ state: structuredClone(stored), revision }),
    saveInvestor: async (snapshot: { state: InvestorState; revision: number }) => {
      stored = structuredClone(snapshot.state); snapshot.revision = ++revision;
    }, syncBrokerAccount };
  await runDueBrokerSyncs(new Date('2026-10-23T06:01:00Z'), deps);
  expect(syncBrokerAccount).toHaveBeenCalledTimes(2);
  expect(notifyUser).toHaveBeenCalledOnce();
  const body = vi.mocked(notifyUser).mock.calls[0][0].body;
  expect(body).toContain('Main: synced'); expect(body).toContain('Savings: synced');
  expect(body).not.toContain('Already synced');
  expect(readBrokerAccountModel(stored).connections[ids[2]].sync_schedule?.next_run_at).toBe('2026-10-23T07:01:00.000Z');
  await runDueBrokerSyncs(new Date('2026-10-23T06:02:00Z'), deps);
  expect(notifyUser).toHaveBeenCalledOnce();
});
