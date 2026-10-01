import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InvestorState } from '../src/state/portfolio-state.js';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../src/state/investor-store.js', () => ({ loadInvestor: mocks.load, saveInvestor: mocks.save }));

const { addBrokerAccount, addBrokerSource, readBrokerAccountModel, syncBrokerAccount } = await import('../src/brokers/accounts.js');
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
  stored = { user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [] };
  const source = addBrokerSource(stored, 'ibkr', { token: 'secret1234' });
  id = addBrokerAccount(stored, { source_id: source, account_id: 'U1', label: 'Main',
    config: { activity_query_id: '111' } });
  revision = 1;
  mocks.load.mockImplementation(async () => ({ state: structuredClone(stored), revision }));
  mocks.save.mockImplementation(async snapshot => {
    stored = structuredClone(snapshot.state);
    snapshot.revision = ++revision;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); rmSync(root, { recursive: true, force: true });
  delete process.env.UTARUS_DATA_ROOT; });

it('records successful and failed sync attempts with their original raw responses', async () => {
  const valid = `<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20260930" toDate="20261001"><OpenPositions/><CashReport><CashReportCurrency accountId="U1" currency="USD" endingCash="100"/></CashReport></FlexStatement></FlexStatements></FlexQueryResponse>`;
  const fetch = vi.spyOn(adapters.ibkr, 'fetchRaw').mockResolvedValue({ kind: 'xml', body: Buffer.from(valid) });
  await syncBrokerAccount({ state: structuredClone(stored), revision }, id, undefined, 'scheduled');
  const channel = readBrokerAccountModel(stored).connections[id].channel;
  expect(readBrokerAccountModel(stored).connections[id].last_sync?.ok).toBe(true);
  fetch.mockResolvedValue({ kind: 'xml', body: Buffer.from('<bad>raw response</bad>') });
  await expect(syncBrokerAccount({ state: structuredClone(stored), revision }, id)).rejects.toThrow();
  const runs = listBrokerSyncRuns('alice', channel).runs;
  expect(runs).toHaveLength(2);
  expect(runs.map(run => [run.trigger, run.ok])).toEqual([['manual', false], ['scheduled', true]]);
  for (const run of runs) {
    const file = brokerRawDataFile('alice', channel, run.raw_data_id!);
    expect(file).not.toBeNull();
    const body = fetchRawData('alice', file!.id, file!.version, 0, 65536, 'base64').content;
    expect(Buffer.from(body, 'base64').toString()).toContain(run.ok ? 'FlexQueryResponse' : 'raw response');
  }
});
