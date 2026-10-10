import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runQuery } from '../src/data-query/engine.js';
import { loadQueryCatalog, parseSourceRecords, queryDatasets } from '../src/data-query/sources.js';
import { financialRecords } from '../src/data-query/records.js';
import { recordBrokerSyncRun } from '../src/brokers/sync-history.js';
import { createDataQueryTools } from '../src/tools/data_query.js';
import { resolveInvestorFromChannel } from '../src/tools/channel.js';
import { addBrokerSource, addBrokerAccount } from '../src/brokers/accounts.js';
import type { InvestorSnapshot } from '../src/state/investor-store.js';

vi.mock('../src/tools/channel.js', async original => ({
  ...await original<typeof import('../src/tools/channel.js')>(), resolveInvestorFromChannel: vi.fn(),
}));
const alice = '11111111-2222-4333-8444-555555555555';
const bob = '22222222-2222-4333-8444-555555555555';
let root: string;
let snapshot: InvestorSnapshot;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'query-sources-')); process.env.UTARUS_DATA_ROOT = root;
  snapshot = { revision: 7, state: { user: { id: alice, created_at: '2026-01-01', auth_token: 'AUTH_SECRET' },
    profile: { display_name: 'Test', contact_email: '' }, log: [],
    portfolio: { 'AMD@ibkr': { instrument: 'equity', units: 100, avg_price: 120, currency: 'USD', channel: 'ibkr',
      encumbrance: { kind: 'lent', units: 20 }, broker_ref: { native_id: '123', listing_exchange: 'NASDAQ' } } },
  } };
  vi.mocked(resolveInvestorFromChannel).mockResolvedValue(snapshot);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); delete process.env.UTARUS_DATA_ROOT; });
function file(userId: string, id: string, body: string) {
  const path = join(root, 'drive', userId, id); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, body);
}
async function query(raw: unknown) { return runQuery(snapshot, raw, await loadQueryCatalog(snapshot, raw)); }

describe('all financial data through one query interface', () => {
  it('scopes large financial state before expansion, including nested roots, without exposing auth paths', async () => {
    Object.assign(snapshot.state, { option_observations: Array.from({ length: 3000 }, () =>
      Object.fromEntries(Array.from({ length: 20 }, (_, index) => ['field' + index, index]))) });
    await expect(query({ from: 'financial_state', limit: 1 })).rejects.toThrow(/record\/depth limit/);
    const scoped = await query({ from: 'financial_state', where: { field: 'root', op: 'eq', value: 'portfolio' } });
    expect(scoped.available).toBe(true);
    expect(scoped.rows).toContainEqual(expect.objectContaining({ path: '/portfolio/AMD@ibkr/units', number_value: 100 }));
    expect(scoped.source).toBe('investor_state:/portfolio');
    const nested = await query({ from: 'financial_state', source: { path: '/option_observations/0' } });
    expect(nested.source_rows).toBe(20);
    const missing = await query({ from: 'financial_state', source: { path: '/portfolio/missing' } });
    expect(missing).toMatchObject({ available: false, rows: [] });
    for (const path of ['/user/auth_token', '/broker_sources/0/credentials', '/portfolio/~bad']) {
      if (path.includes('credentials')) expect((await query({ from: 'financial_state', source: { path } })).rows).toEqual([]);
      else await expect(query({ from: 'financial_state', source: { path } })).rejects.toThrow(/financial root|JSON Pointer/);
    }
    const any = { from: 'financial_state', where: { any: [{ field: 'root', op: 'eq', value: 'portfolio' }, { field: 'root', op: 'eq', value: 'option_observations' }] } };
    await expect(query(any)).rejects.toThrow(/record\/depth limit/);
  });

  it('keeps full stock/fund fields and nested future holding fields visible, excluding auth and broker secrets', () => {
    const sourceId = addBrokerSource(snapshot.state, 'ibkr', { token: 'BROKER_SECRET' });
    addBrokerAccount(snapshot.state, { source_id: sourceId, account_id: 'U1', label: 'IBKR', config: { activity_query_id: '123' } });
    Object.assign(snapshot.state.portfolio!['AMD@ibkr'], { additional_broker_field: { original: 'kept' } });
    const rows = financialRecords(snapshot.state);
    expect(rows).toContainEqual(expect.objectContaining({ path: '/portfolio/AMD@ibkr/avg_price', number_value: 120 }));
    expect(rows).toContainEqual(expect.objectContaining({ path: '/portfolio/AMD@ibkr/additional_broker_field/original', text_value: 'kept' }));
    expect(JSON.stringify(rows)).not.toMatch(/AUTH_SECRET|BROKER_SECRET|activity_query_id|contact_email/);
    expect(runQuery(snapshot, { from: 'positions', select: ['key', 'instrument', 'encumbered_units', 'listing_exchange'] }).rows)
      .toEqual([{ key: 'AMD@ibkr', instrument: 'equity', encumbered_units: 20, listing_exchange: 'NASDAQ' }]);
    snapshot.state.portfolio!.fund = { instrument: 'fund', units: 2, avg_price: 5, currency: 'USD', fund: { quote_source: 'manual', mark: 6, name: 'Fund' } };
    expect(runQuery(snapshot, { from: 'positions', select: ['fund_mark'], where: { field: 'instrument', op: 'eq', value: 'fund' } }).rows).toEqual([{ fund_mark: 6 }]);
  });

  it('discovers accounting, snapshots, archives and all financial roots without loading their content', async () => {
    const result = await createDataQueryTools()[0].execute('dict', { user_id: alice });
    const text = JSON.stringify(result.details);
    for (const name of ['financial_state', 'valuation_snapshots', 'broker_sync_runs', 'raw_files', 'source_records',
      'books_accounts', 'books_journal_entries', 'books_journal_lines', 'books_account_balances', 'books_position_meta', 'books_deposit_meta', 'books_audit_events']) expect(text).toContain(name);
    expect(text).not.toContain('AUTH_SECRET');
  });

  it('queries stock trades, dividends and daily NAV that the options import omits from archived XML', async () => {
    file(alice, 'ibkr-flex/activity.xml', '<FlexStatement accountId="U1"><Trades><Trade assetCategory="STK" symbol="AMD" proceeds="9007199254740993.01"/><Trade assetCategory="OPT" symbol="AMD CALL"/></Trades><CashTransaction type="Dividend" amount="12.34"/><EquitySummaryByReportDateInBase total="123456.78"/></FlexStatement>');
    file(bob, 'private.xml', '<secret/>');
    const inventory = await query({ from: 'raw_files' });
    expect(inventory.rows).toHaveLength(1);
    const source = { file_id: inventory.rows[0].id, version: inventory.rows[0].version };
    const trades = await query({ from: 'source_records', source, where: { field: 'root', op: 'eq', value: 'Trade' } });
    expect(trades.rows).toContainEqual(expect.objectContaining({ text_value: 'STK' }));
    expect(trades.rows).toContainEqual(expect.objectContaining({ text_value: '9007199254740993.01' }));
    const dividend = await query({ from: 'source_records', source, where: { field: 'root', op: 'eq', value: 'CashTransaction' } });
    expect(dividend.rows).toContainEqual(expect.objectContaining({ text_value: '12.34' }));
    const nav = await query({ from: 'source_records', source, where: { field: 'root', op: 'eq', value: 'EquitySummaryByReportDateInBase' } });
    expect(nav.rows).toContainEqual(expect.objectContaining({ text_value: '123456.78' }));
  });

  it('pins independent source versions and refuses changed or unpinned pages', async () => {
    file(alice, 'broker.json', '{"stocks":[{"symbol":"AMD","cost":120},{"symbol":"AAPL","cost":100}]}');
    const inventory = await query({ from: 'raw_files' });
    const source = { file_id: inventory.rows[0].id, version: inventory.rows[0].version };
    const raw = { from: 'source_records', source, limit: 1 };
    const first = await query(raw);
    await expect(query({ ...raw, offset: 1, expected_revision: 7 })).rejects.toThrow(/expected_source_version/);
    expect((await query({ ...raw, offset: 1, expected_revision: 7, expected_source_version: first.source_version })).rows).toHaveLength(1);
    file(alice, 'broker.json', '{"changed":true}');
    await expect(query(raw)).rejects.toThrow(/changed/);
    await expect(query({ from: 'raw_files', offset: 1, expected_revision: 7, expected_source_version: inventory.source_version })).rejects.toThrow(/Source data changed/);
  });

  it('queries complete saved valuations and retained sync runs even after a channel is disconnected', async () => {
    file(alice, 'snapshots.json', '["snapshot-2026-10-10.json"]');
    file(alice, 'snapshot-2026-10-10.json', '{"date":"2026-10-10","positions":[{"ticker":"AMD","price":200,"pl":8000}],"fxRates":{"USD":1}}');
    const values = await query({ from: 'valuation_snapshots', where: { field: 'path', op: 'contains', value: '/positions/' } });
    expect(values.rows).toContainEqual(expect.objectContaining({ path: '/0/positions/0/pl', number_value: 8000 }));
    recordBrokerSyncRun(alice, 'retired-channel', { at: '2026-10-10T00:00:00Z', trigger: 'manual', ok: false, error: 'Missing history' });
    expect((await query({ from: 'broker_sync_runs' })).rows).toContainEqual(expect.objectContaining({ text_value: 'retired-channel' }));
  });

  it('refuses cross-user paths, symlinks, malicious snapshot indices, and unsupported source formats', async () => {
    file(alice, 'own.json', '{}'); file(bob, 'secret.json', '{"secret":true}');
    await expect(query({ from: 'source_records', source: { file_id: `../${bob}/secret.json`, version: 'anything' } })).rejects.toThrow(/Invalid relative/);
    symlinkSync(join(root, 'drive', bob, 'secret.json'), join(root, 'drive', alice, 'link.json'));
    await expect(query({ from: 'raw_files' })).rejects.toThrow(/Symlink/);
    rmSync(join(root, 'drive', alice, 'link.json'));
    file(alice, 'snapshots.json', `["../${bob}/secret.json"]`);
    await expect(query({ from: 'valuation_snapshots' })).rejects.toThrow(/filename/);
    expect(() => parseSourceRecords('report.pdf', 'binary')).toThrow(/fetch_raw_data/);
  });

  it('preserves JSON nulls/empty values, exact YAML integers, and CSV quoted newlines; rejects dangerous/malformed XML', () => {
    expect(parseSourceRecords('raw.json', '{"empty":[],"unknown":null,"flag":false}')).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/empty', value_type: 'empty_array' }), expect.objectContaining({ path: '/unknown', value_type: 'null' }),
      expect.objectContaining({ path: '/flag', boolean_value: false }),
    ]));
    expect(parseSourceRecords('raw.yaml', 'amount: 9007199254740993\n')).toContainEqual(expect.objectContaining({ text_value: '9007199254740993' }));
    expect(parseSourceRecords('raw.csv', 'symbol,note\r\nAMD,"line1\nline2"\r\n')).toContainEqual(expect.objectContaining({ path: '/1/1', text_value: 'line1\nline2' }));
    expect(() => parseSourceRecords('raw.csv', '"unfinished')).toThrow(/Unterminated/);
    expect(() => parseSourceRecords('raw.xml', '<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><foo>&x;</foo>')).toThrow(/document types/);
    expect(() => parseSourceRecords('raw.xml', '<broken>')).toThrow();
    expect(() => parseSourceRecords('raw.json', '{"id":9007199254740993}')).toThrow(/unsafe numeric/);
  });

  it('keeps Drive contents inaccessible through queries in incognito', async () => {
    const tools = createDataQueryTools({ allowDrive: false });
    expect(JSON.stringify((await tools[0].execute('dict', {})).details)).not.toContain('"source_records":');
    for (const from of ['raw_files', 'source_records', 'valuation_snapshots']) {
      const result = await tools[1].execute('query', { query: { from } });
      expect(result.details).toBeNull();
    }
    expect(Object.keys(queryDatasets)).toContain('source_records');
    const { buildFrameworkAgentList } = await import('../src/agents/framework-agents.js');
    for (const agent of buildFrameworkAgentList('consultant')) {
      if (typeof agent.extension.tools !== 'function') throw new Error('Expected authenticated tool factory.');
      const bound = await agent.extension.tools(alice, false, true);
      const result = await bound.find(tool => tool.name === 'query_data')!.execute('query', { query: { from: 'source_records' } });
      expect(result.details).toBeNull();
    }
  });
});
