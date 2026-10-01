import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { brokerRawDataFile } from '../src/raw-data/store.js';
import { getBrokerSyncRun, listBrokerSyncRuns, recordBrokerSyncRun } from '../src/brokers/sync-history.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'broker-history-')); process.env.UTARUS_DATA_ROOT = root; });
afterEach(() => { rmSync(root, { recursive: true, force: true }); delete process.env.UTARUS_DATA_ROOT; });

describe('broker sync history', () => {
  it('keeps distinct successful and failed runs with per-run raw downloads', () => {
    const rawDir = join(root, 'drive', 'alice', 'broker-sync', 'ibkr-abc');
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, 'first.xml'), '<first/>');
    writeFileSync(join(rawDir, 'second.xml'), '<second/>');
    const first = recordBrokerSyncRun('alice', 'ibkr-abc', { at: '2026-10-01T01:00:00Z', trigger: 'scheduled', ok: true,
      as_of: '2026-10-01', raw_data_id: 'broker-sync/ibkr-abc/first.xml' });
    const second = recordBrokerSyncRun('alice', 'ibkr-abc', { at: '2026-10-01T02:00:00Z', trigger: 'manual', ok: false,
      error: 'Parse failed', raw_data_id: 'broker-sync/ibkr-abc/second.xml' });
    const page = listBrokerSyncRuns('alice', 'ibkr-abc', 0, 1);
    expect(page.runs.map(run => run.id)).toEqual([second.id]);
    expect(page.next_offset).toBe(1);
    expect(listBrokerSyncRuns('alice', 'ibkr-abc', 1, 1).runs.map(run => run.id)).toEqual([first.id]);
    expect(getBrokerSyncRun('alice', 'ibkr-abc', first.id)?.raw_data_id).toBe('broker-sync/ibkr-abc/first.xml');
    expect(brokerRawDataFile('alice', 'ibkr-abc', second.raw_data_id!)?.id).toBe(second.raw_data_id);
    expect(brokerRawDataFile('alice', 'other', second.raw_data_id!)).toBeNull();
    expect(getBrokerSyncRun('bob', 'ibkr-abc', first.id)).toBeNull();
  });
});
