import { registerPortfolioRefresher } from '../src/state/projection-events.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InvestorState } from '../src/state/portfolio-state.js';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
const notices = vi.hoisted(() => ({ success: vi.fn(), failure: vi.fn() }));
vi.mock('../src/state/investor-store.js', () => ({ loadInvestor: mocks.load, saveInvestor: mocks.save }));
vi.mock('../src/brokers/sync-notification.js', async importOriginal => ({
  ...await importOriginal<object>(), publishBrokerSyncSuccess: notices.success,
  publishBrokerSyncFailure: notices.failure,
}));

const { addBrokerAccount, addBrokerSource, patchBrokerAccount, readBrokerAccountModel, syncBrokerAccount } = await import('../src/brokers/accounts.js');
const { listBrokerSyncRuns } = await import('../src/brokers/sync-history.js');
const { brokerRawDataFile, fetchRawData } = await import('../src/raw-data/store.js');
const { adapters } = await import('../src/brokers/adapter.js');

let root: string;
let stored: InvestorState;
let revision: number;
let id: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'broker-sync-run-'));
  process.env.UTARUS_DATA_ROOT = root;
  stored = { user: { id: '11111111-1111-4111-8111-111111111111', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [] };
  const source = addBrokerSource(stored, 'ibkr', { token: 'secret1234' });
  id = addBrokerAccount(stored, { source_id: source, account_id: 'U1', label: 'Main',
    config: { activity_query_id: '111' } });
  revision = 1;
  mocks.load.mockImplementation(async () => ({ state: structuredClone(stored), revision }));
  notices.success.mockResolvedValue(undefined);
  notices.failure.mockResolvedValue(undefined);
  mocks.save.mockImplementation(async snapshot => {
    stored = structuredClone(snapshot.state);
    snapshot.revision = ++revision;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); rmSync(root, { recursive: true, force: true });
  delete process.env.UTARUS_DATA_ROOT; });

it.each(['manual', 'scheduled'] as const)('does not create an account retry schedule after a failed %s sync', async trigger => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T01:00:00Z'));
  vi.spyOn(adapters.ibkr, 'fetchRaw').mockImplementation(async () => {
    // Slow failures must not recreate the retired retry schedule.
    vi.setSystemTime(new Date(Date.now() + 5 * 60 * 1000));
    throw new Error('Broker unavailable');
  });
  await expect(syncBrokerAccount({ state: structuredClone(stored), revision }, id, undefined, trigger))
    .rejects.toThrow('Broker unavailable');
  expect(readBrokerAccountModel(stored).connections[id].sync_schedule).toBeUndefined();
  expect(notices.failure).toHaveBeenLastCalledWith(stored.user.id, 'Interactive Brokers', 'Main',
    'Broker unavailable', { retryScheduled: false });

  vi.setSystemTime(new Date('2026-10-15T01:35:00Z'));
  await expect(syncBrokerAccount({ state: structuredClone(stored), revision }, id, undefined, 'scheduled'))
    .rejects.toThrow('Broker unavailable');
  expect(readBrokerAccountModel(stored).connections[id].sync_schedule).toBeUndefined();
});

it('preserves automatic sync being turned off while a sync is failing', async () => {
  vi.spyOn(adapters.ibkr, 'fetchRaw').mockImplementation(async () => {
    patchBrokerAccount(stored, id, { sync_frequency: null });
    throw new Error('Broker unavailable');
  });
  await expect(syncBrokerAccount({ state: structuredClone(stored), revision }, id))
    .rejects.toThrow('Broker unavailable');
  expect(readBrokerAccountModel(stored).connections[id].sync_schedule).toBeUndefined();
  expect(notices.failure).toHaveBeenLastCalledWith(stored.user.id, 'Interactive Brokers', 'Main',
    'Broker unavailable', { retryScheduled: false });
});

it('does not announce a retry if saving failure status fails', async () => {
  vi.spyOn(adapters.ibkr, 'fetchRaw').mockRejectedValue(new Error('Broker unavailable'));
  mocks.save.mockRejectedValueOnce(new Error('State unavailable'));
  await expect(syncBrokerAccount({ state: structuredClone(stored), revision }, id))
    .rejects.toThrow('State unavailable');
  expect(notices.failure).toHaveBeenLastCalledWith(stored.user.id, 'Interactive Brokers', 'Main',
    'Broker unavailable', { retryScheduled: false });
});

it('records successful and failed sync attempts with their original raw responses', async () => {
  const valid = `<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20260930" toDate="20261001"><OpenPositions/><CashReport><CashReportCurrency accountId="U1" currency="USD" endingCash="100"/></CashReport></FlexStatement></FlexStatements></FlexQueryResponse>`;
  const fetch = vi.spyOn(adapters.ibkr, 'fetchRaw').mockResolvedValue({ kind: 'xml', body: Buffer.from(valid) });
  await syncBrokerAccount({ state: structuredClone(stored), revision }, id, undefined, 'scheduled');
  const channel = readBrokerAccountModel(stored).connections[id].channel;
  expect(readBrokerAccountModel(stored).connections[id].last_sync?.ok).toBe(true);
  expect(stored.option_observations).toHaveLength(1);
  expect(stored.option_observations?.[0]).toMatchObject({
    channel, account_id: 'U1', as_of: '2026-10-01', complete: true, options: [],
  });
  expect(notices.success).toHaveBeenCalledOnce();
  expect(notices.success.mock.calls[0]?.[2]).toMatchObject({ initial: true, positions_total: 0 });
  fetch.mockResolvedValue({ kind: 'xml', body: Buffer.from('<bad>raw response</bad>') });
  await expect(syncBrokerAccount({ state: structuredClone(stored), revision }, id)).rejects.toThrow();
  expect(notices.failure).toHaveBeenCalledOnce();
  const runs = listBrokerSyncRuns(stored.user.id, channel).runs;
  expect(runs).toHaveLength(2);
  expect(runs.map(run => [run.trigger, run.ok])).toEqual([['manual', false], ['scheduled', true]]);
  expect(stored.option_observations?.map(row => row.id)).toEqual([runs[1].id]);
  for (const run of runs) {
    const file = brokerRawDataFile(stored.user.id, channel, run.raw_data_id!);
    expect(file).not.toBeNull();
    const body = fetchRawData(stored.user.id, file!.id, file!.version, 0, 65536, 'base64').content;
    expect(Buffer.from(body, 'base64').toString()).toContain(run.ok ? 'FlexQueryResponse' : 'raw response');
  }
});

it('keeps a completed sync successful when notification delivery fails', async () => {
  const valid = `<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20260930" toDate="20261001"><OpenPositions/><CashReport><CashReportCurrency accountId="U1" currency="USD" endingCash="100"/></CashReport></FlexStatement></FlexStatements></FlexQueryResponse>`;
  vi.spyOn(adapters.ibkr, 'fetchRaw').mockResolvedValue({ kind: 'xml', body: Buffer.from(valid) });
  notices.success.mockRejectedValueOnce(new Error('inbox unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await syncBrokerAccount({ state: structuredClone(stored), revision }, id);
  expect(result.applied.accountId).toBe('U1');
  expect(readBrokerAccountModel(stored).connections[id].last_sync?.ok).toBe(true);
  expect(notices.failure).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith('[broker/sync-notification] comparison failed:', expect.any(Error));
});

const emptyReport = `<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20260930" toDate="20261001"><OpenPositions/><CashReport><CashReportCurrency accountId="U1" currency="USD" endingCash="100"/></CashReport></FlexStatement></FlexStatements></FlexQueryResponse>`;

it('reloads the profile after a long fetch and preserves concurrent settings edits', async () => {
  const snapshot={state:structuredClone(stored),revision};
  vi.spyOn(adapters.ibkr,'fetchRaw').mockImplementation(async()=>{
    stored.profile.display_name='Updated during fetch';
    patchBrokerAccount(stored,id,{label:'Renamed during fetch',sync_frequency:null});
    revision++;
    return {kind:'xml',body:Buffer.from(emptyReport)};
  });
  mocks.save.mockImplementation(async current=>{
    expect(current.revision).toBe(revision);
    stored=structuredClone(current.state);current.revision=++revision;
  });
  await syncBrokerAccount(snapshot,id);
  expect(snapshot.state.profile.display_name).toBe('Updated during fetch');
  expect(readBrokerAccountModel(stored).connections[id]).toMatchObject({label:'Renamed during fetch',last_sync:{ok:true}});
  expect(readBrokerAccountModel(stored).connections[id].sync_schedule).toBeUndefined();
});

it.each([{enabled:false},{account_id:'U2'}])('rejects a connection changed during the fetch: %j', async patch=>{
  vi.spyOn(adapters.ibkr,'fetchRaw').mockImplementation(async()=>{
    patchBrokerAccount(stored,id,patch);revision++;
    return {kind:'xml',body:Buffer.from(emptyReport)};
  });
  await expect(syncBrokerAccount({state:structuredClone(stored),revision},id)).rejects.toThrow('connection changed during synchronization');
  expect(stored.log).toEqual([]);
  expect(stored.option_observations).toBeUndefined();
  expect(readBrokerAccountModel(stored).connections[id]).toMatchObject(patch);
});

it.each(['manual', 'scheduled'] as const)('awaits persisted aggregates after a successful %s import', async trigger => {
  vi.spyOn(adapters.ibkr, 'fetchRaw').mockResolvedValue({ kind: 'xml', body: Buffer.from(emptyReport) });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const refresh = vi.fn(async userId => {
    expect(userId).toBe(stored.user.id);
    expect(readBrokerAccountModel(stored).connections[id].last_sync?.ok).toBe(true);
    expect(listBrokerSyncRuns(stored.user.id, readBrokerAccountModel(stored).connections[id].channel).runs[0].ok).toBe(true);
    await gate;
  });
  const unregister = registerPortfolioRefresher(refresh);
  try {
    let done = false;
    const work = syncBrokerAccount({ state: structuredClone(stored), revision }, id, undefined, trigger).then(result => { done = true; return result; });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(done).toBe(false);
    release();
    expect((await work).aggregation).toEqual({ status: 'ready' });
  } finally { release(); unregister(); }
});

it('retains a successful broker import when the aggregate refresh fails', async () => {
  vi.spyOn(adapters.ibkr, 'fetchRaw').mockResolvedValue({ kind: 'xml', body: Buffer.from(emptyReport) });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const unregister = registerPortfolioRefresher(async () => { throw new Error('calculation failed'); });
  try {
    const result = await syncBrokerAccount({ state: structuredClone(stored), revision }, id, undefined, 'manual', true);
    expect(result.aggregation).toEqual({ status: 'failed' });
    expect(readBrokerAccountModel(stored).connections[id].last_sync?.ok).toBe(true);
    expect(notices.failure).not.toHaveBeenCalled();
  } finally { unregister(); }
});
