import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addBrokerAccount, addBrokerSource, readBrokerAccountModel } from '../src/brokers/accounts.js';
import { runQuery } from '../src/data-query/engine.js';
import { loadQueryCatalog } from '../src/data-query/sources.js';
import { createDataQueryTools, DATA_QUERY_GUIDE } from '../src/tools/data_query.js';
import { bindDomainToolsToUser } from '../src/tools/bound-identity.js';
import { resolveInvestorFromChannel } from '../src/tools/channel.js';
import type { InvestorSnapshot } from '../src/state/investor-store.js';

vi.mock('../src/tools/channel.js', async original => ({
  ...await original<typeof import('../src/tools/channel.js')>(), resolveInvestorFromChannel: vi.fn(),
}));
const owner = '11111111-2222-4333-8444-555555555555';
const other = '22222222-2222-4333-8444-555555555555';
let root: string, snapshot: InvestorSnapshot, channel: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'query-rolls-')); process.env.UTARUS_DATA_ROOT = root;
  snapshot = { revision: 7, state: { user: { id: owner, created_at: '2026-01-01' },
    profile: { display_name: 'Test', contact_email: '' }, log: [], portfolio: {},
  } };
  const source = addBrokerSource(snapshot.state, 'ibkr', { token: 'BROKER_SECRET' });
  addBrokerAccount(snapshot.state, { source_id: source, account_id: 'A', label: 'IBKR', config: { activity_query_id: '123' } });
  channel = Object.values(readBrokerAccountModel(snapshot.state).connections)[0].channel;
  vi.mocked(resolveInvestorFromChannel).mockResolvedValue(snapshot);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); delete process.env.UTARUS_DATA_ROOT; vi.clearAllMocks(); });
function archive(user = owner, day = '20261001', quantity = '1') {
  const dir = join(root, 'drive', user, 'broker-sync', channel); mkdirSync(dir, { recursive: true });
  const leg = (id: string, expiry: string, side: string, effect: string, cash: string, qty: string) =>
    `<Trade accountId="A" assetCategory="OPT" levelOfDetail="EXECUTION" transactionType="ExchTrade" tradeID="${id}${day}" ibOrderID="${id}${day}" brokerageOrderID="parent${day}" dateTime="${day};100000" underlyingSymbol="AMD" putCall="C" expiry="${expiry}" strike="200" multiplier="100" currency="USD" ibCommissionCurrency="USD" quantity="${side === 'SELL' ? '-' : ''}${qty}" buySell="${side}" openCloseIndicator="${effect}" netCash="${cash}"/>`;
  const xml = `<FlexStatement accountId="A"><Trades>${leg('c', '20261120', 'BUY', 'C', '-10', '1')}${leg('o', '20270115', 'SELL', 'O', '30.0000000000000001', quantity)}</Trades></FlexStatement>`;
  writeFileSync(join(dir, `${day}.xml`), xml);
  return { dir, xml };
}
async function query(raw: unknown) { return runQuery(snapshot, raw, await loadQueryCatalog(snapshot, raw)); }

it('discovers typed relationship semantics without scanning archives and guides all agents through generic queries', async () => {
  const { dir } = archive(); writeFileSync(join(dir, 'bad.xml'), '<bad');
  const result = await createDataQueryTools()[0].execute('dict', { user_id: owner });
  const text = JSON.stringify(result.details);
  for (const name of ['option_relationships', 'option_relationship_fills', 'option_relationship_sources', 'option_relationship_coverage', 'option_relationship_gaps']) expect(text).toContain(name);
  expect(text).toContain('cash_basis'); expect(text).toContain('never realized P/L');
  expect(text).not.toContain('BROKER_SECRET'); expect(DATA_QUERY_GUIDE).toContain('query option_relationships first');
  expect(DATA_QUERY_GUIDE).toContain('not no rolls traded');
});

it('reads the dashboard relationships for closed contracts, with exact cash and linked archive/fill evidence', async () => {
  archive(); archive(other, '20261002');
  const result = await query({ from: 'option_relationships' });
  expect(result.rows).toHaveLength(1);
  const r = result.rows[0];
  expect(r).toMatchObject({ channel, account_id: 'A', underlying: 'AMD', evidence: 'order',
    old_expiry: '2026-11-20', replacement_expiry: '2027-01-15', replacement_effect: 'open',
    continuity: 'unverified', cash: '20.0000000000000001', cash_basis: 'net' });
  expect((await query({ from: 'positions' })).rows).toEqual([]);
  const where = { field: 'relationship_id', op: 'eq', value: r.id };
  expect((await query({ from: 'option_relationship_fills', where })).rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: 'closing', effect: 'close', fill_id: 'c20261001' }),
    expect.objectContaining({ role: 'replacement', effect: 'open', fill_id: 'o20261001' }),
  ]));
  const sources = await query({ from: 'option_relationship_sources', where });
  const s = sources.rows[0];
  const original = await query({ from: 'source_records', source: { file_id: s.archive_id, version: s.archive_version } });
  expect(original.rows).toContainEqual(expect.objectContaining({ text_value: 'parent20261001' }));
  expect(JSON.stringify(result)).not.toContain('BROKER_SECRET');
});

it('filters dates/confidence, counts transitions, and prevents mixed cash aggregation', async () => {
  archive(); archive(owner, '20261002', '2');
  const review = await query({ from: 'option_relationships', where: { field: 'evidence', op: 'eq', value: 'review' } });
  expect(review.rows).toHaveLength(1); expect(review.rows[0].cash).toBeNull();
  const dated = await query({ from: 'option_relationships', where: { field: 'through_date', op: 'lte', value: '2026-10-01' }, select: ['id', 'evidence'] });
  expect(dated.rows).toHaveLength(1); expect(dated.rows[0].evidence).toBe('order');
  const count = await query({ from: 'option_relationships', group_by: ['evidence'], aggregates: [{ op: 'count', as: 'transitions' }] });
  expect(count.rows).toContainEqual({ evidence: 'review', transitions: 1 });
  await expect(query({ from: 'option_relationships', aggregates: [{ op: 'sum', field: 'cash', as: 'credit' }] })).rejects.toThrow(/requires group_by/);
  const sum = await query({ from: 'option_relationships', group_by: ['channel', 'account_id', 'currency', 'cash_basis', 'evidence'], aggregates: [{ op: 'sum', field: 'cash', as: 'credit' }] });
  expect(sum.rows).toContainEqual(expect.objectContaining({ evidence: 'order', credit: '20.0000000000000001' }));
  expect(sum.rows).toContainEqual(expect.objectContaining({ evidence: 'review', credit: null }));
});

it('pins pages to investor revision and independently changing archive evidence', async () => {
  archive(); archive(owner, '20261002');
  const raw = { from: 'option_relationships', limit: 1 };
  const first = await query(raw); expect(first.next_offset).toBe(1);
  await expect(query({ ...raw, offset: 1, expected_revision: 7 })).rejects.toThrow(/expected_source_version/);
  const next = { ...raw, offset: 1, expected_revision: 7, expected_source_version: first.source_version };
  expect((await query(next)).rows[0].id).not.toBe(first.rows[0].id);
  archive(owner, '20261003');
  await expect(query(next)).rejects.toThrow(/Source data changed/);
});

it('narrows only mandatory account filters, retaining OR/NOT query semantics', async () => {
  archive();
  const source = addBrokerSource(snapshot.state, 'ibkr', { token: 'SECOND_SECRET' });
  addBrokerAccount(snapshot.state, { source_id: source, account_id: 'B', label: 'Second', config: { activity_query_id: '123' } });
  const channelFilter = { field: 'channel', op: 'eq', value: channel };
  const scoped = await query({ from: 'option_relationship_coverage', where: { all: [channelFilter, { field: 'history_available', op: 'eq', value: true }] } });
  expect(scoped.source_rows).toBe(1); expect(scoped.rows).toHaveLength(1);
  const either = await query({ from: 'option_relationship_coverage', where: { any: [channelFilter, { field: 'account_id', op: 'eq', value: 'B' }] } });
  expect(either.source_rows).toBe(2); expect(either.rows).toHaveLength(2);
  const negated = await query({ from: 'option_relationship_coverage', where: { not: channelFilter } });
  expect(negated.source_rows).toBe(2); expect(negated.rows[0].account_id).toBe('B');
});

it('reports missing/malformed/corrected history through generic coverage and gaps', async () => {
  expect((await query({ from: 'option_relationships' })).rows).toEqual([]);
  expect((await query({ from: 'option_relationship_coverage' })).rows[0]).toMatchObject({ history_available: false, first_trade: null });
  expect((await query({ from: 'option_relationship_gaps' })).rows[0].reason).toContain('No usable');
  const { dir, xml } = archive(); writeFileSync(join(dir, 'bad.xml'), '<bad');
  expect((await query({ from: 'option_relationship_gaps' })).rows).toContainEqual(expect.objectContaining({ archive_id: expect.stringContaining('bad.xml') }));
  writeFileSync(join(dir, 'correction.xml'), xml.replace('tradeID="c20261001"', 'origTradeID="old" tradeID="c20261001"'));
  expect((await query({ from: 'option_relationships' })).rows).toEqual([]);
  expect((await query({ from: 'option_relationship_gaps' })).rows).toContainEqual(expect.objectContaining({ reason: expect.stringContaining('withheld') }));
});

it('binds generic relationship queries to the authenticated user and blocks archive-derived data in incognito', async () => {
  archive(); archive(other, '20261002');
  const tools = bindDomainToolsToUser(createDataQueryTools(), owner);
  const result = await tools[1].execute('query', { user_id: other, query: { from: 'option_relationships' } });
  expect(resolveInvestorFromChannel).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: owner }));
  expect((result.details as { rows: unknown[] }).rows).toHaveLength(1);
  const restricted = createDataQueryTools({ allowDrive: false });
  const dictionary = JSON.stringify((await restricted[0].execute('dict', {})).details);
  expect(dictionary).not.toContain('"option_relationships":');
  for (const from of ['option_relationships', 'option_relationship_sources', 'option_relationship_fills', 'option_relationship_coverage', 'option_relationship_gaps']) {
    expect((await restricted[1].execute('query', { query: { from } })).details).toBeNull();
  }
  const { buildFrameworkAgentList } = await import('../src/agents/framework-agents.js');
  for (const agent of buildFrameworkAgentList('consultant')) {
    expect(agent.extension.purpose).toContain('query option_relationships first');
    if (typeof agent.extension.tools !== 'function') throw new Error('Expected authenticated tool factory');
    const normal = await agent.extension.tools(owner, false, false);
    expect(normal.some(t => t.name === 'query_data')).toBe(true);
    expect(normal.some(t => t.name === 'list_option_relationships')).toBe(false);
    const hidden = await agent.extension.tools(owner, false, true);
    expect((await hidden.find(t => t.name === 'query_data')!.execute('query', { query: { from: 'option_relationships' } })).details).toBeNull();
  }
});
