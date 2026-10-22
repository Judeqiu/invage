import { persistPortfolioFixture } from './helpers/portfolio-projection.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { addBrokerAccount, addBrokerSource, readBrokerAccountModel } from '../src/brokers/accounts.js';
import { optionRelationshipsForState } from '../src/webapp/option-relationships-data.js';
import { createDashboardApiRouter } from '../src/webapp/dashboard-api.js';
import { loadInvestor } from '../src/state/investor-store.js';
import { parseRelationshipArchive } from '../src/brokers/option-relationships.js';

vi.mock('../src/state/investor-store.js', () => ({ loadInvestor: vi.fn(), saveInvestor: vi.fn() }));
const owner = '00000000-0000-4000-8000-000000000071';
const other = '00000000-0000-4000-8000-000000000072';
let root: string, state: InvestorState;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'roll-api-')); process.env.UTARUS_DATA_ROOT = root;
  state = { user: { id: owner, slug: 'owner', created_at: '2026-01-01' }, profile: { display_name: 'Owner', contact_email: 'test@example.com' }, log: [] };
  const s = addBrokerSource(state, 'ibkr', { token: 'test-token' });
  addBrokerAccount(state, { source_id: s, account_id: 'A', label: 'Main', config: { activity_query_id: '1' } });
  vi.mocked(loadInvestor).mockImplementation(async user => { if (user !== owner) throw new Error('Wrong tenant'); return { state, revision: 0 }; });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.clearAllMocks(); });
function archive(user: string, date = '20261001', price = '30') {
  const channel = Object.values(readBrokerAccountModel(state).connections)[0].channel;
  const dir = join(root, 'drive', user, 'broker-sync', channel); mkdirSync(dir, { recursive: true });
  const row = (id: string, expiry: string, side: string, effect: string, cash: string) => `<Trade accountId="A" assetCategory="OPT" levelOfDetail="EXECUTION" transactionType="ExchTrade" tradeID="${id}" ibOrderID="${id}" brokerageOrderID="p${date}" ibExecID="a.b.02.01" dateTime="${date};100000" underlyingSymbol="AMD" putCall="C" expiry="${expiry}" strike="200" multiplier="100" currency="USD" ibCommissionCurrency="USD" quantity="${side === 'SELL' ? '-' : ''}1" buySell="${side}" openCloseIndicator="${effect}" netCash="${cash}"/>`;
  writeFileSync(join(dir, `${date}.xml`), `<FlexStatement accountId="A"><Trades>${row(`c${date}`, '20261120', 'BUY', 'C', '-10')}${row(`o${date}`, '20270115', 'SELL', 'O', price)}</Trades></FlexStatement>`);
}
function app(auth = true) {
  const app = express(); if (auth) app.use((req, _res, next) => { Object.assign(req, { user: { userId: owner } }); next(); });
  app.use(createDashboardApiRouter()); return app;
}
it('pages timeline executions even when no position snapshot exists and keeps tenant and contract filters', async () => {
  const channel = Object.values(readBrokerAccountModel(state).connections)[0].channel;
  const fill = { channel, account_id: 'A', contract_id: 'put310', underlying: 'AVGO', right: 'put' as const,
    expiry: '2026-10-23', strike: '310', multiplier: '100', contracts: '2', currency: 'USD', commission: null };
  state.option_executions = [
    { ...fill, execution_id: 'open', executed_at: '2026-09-04T11:32:40', side: 'sell', effect: 'open', gross_premium: '666' },
    { ...fill, execution_id: 'close', executed_at: '2026-10-05T11:05:44', side: 'buy', effect: 'close', gross_premium: '-96' },
    { ...fill, execution_id: 'other-channel', channel: 'other', executed_at: '2026-10-06T11:05:44', side: 'buy', effect: 'close', gross_premium: '-96' },
  ];
  const before = JSON.stringify(state);
  await persistPortfolioFixture(state);
  const url = `/option-history?include_executions=true&channel=${channel}&q=AVGO&right=put&to=2026-10-05&limit=1`;
  const first = await request(app()).get(url);
  expect(first.status).toBe(200);
  expect(first.body.episodes).toEqual([]);
  expect(first.body.executions.map((e: any) => e.execution_id)).toEqual(['close']);
  expect(first.body.execution_total).toBe(2);
  expect(first.body.next_offset).toBe(1);
  const second = await request(app()).get(url + '&offset=1');
  expect(second.body.executions.map((e: any) => e.execution_id)).toEqual(['open']);
  expect(second.body.next_offset).toBeNull();
  const replay = await request(app()).get(`/option-history?include_executions=true&channel=${channel}&as_of=2026-09-15`);
  expect(replay.body.executions.map((e: any) => e.execution_id)).toEqual(['open']);
  expect((await request(app()).get('/option-history?as_of=invalid')).status).toBe(400);
  expect((await request(app()).get('/option-history')).body.executions).toBeUndefined();
  expect((await request(app(false)).get(url)).status).toBe(401);
  expect(JSON.stringify(state)).toBe(before);
});
it('reads only the authenticated tenant and deduplicates source records', async () => {
  archive(owner); archive(other, '20261002', '999');
  await persistPortfolioFixture(state);
  const response = await request(app()).get('/option-relationships');
  expect(response.status).toBe(200); expect(loadInvestor).toHaveBeenCalledWith(owner);
  expect(response.body.total).toBe(1); expect(response.body.groups[0].relationships[0].cash).toBe('20');
  expect(response.headers['cache-control']).toBe('private, no-store');
});
it('requires authentication and validates filters before loading state', async () => {
  expect((await request(app(false)).get('/option-relationships')).status).toBe(401);
  for (const query of ['limit=0', 'offset=-1', 'evidence=confirmed', 'from=2026-02-30', 'as_of=tomorrow', 'from=2026-10-03&to=2026-10-01', 'q[]=AMD']) {
    expect((await request(app()).get(`/option-relationships?${query}`)).status).toBe(400);
  }
  expect(loadInvestor).not.toHaveBeenCalled();
});
it('filters future relationships from dated replay and paginates matching groups', async () => {
  archive(owner); archive(owner, '20261002');
  await persistPortfolioFixture(state);
  expect(optionRelationshipsForState(state, { asOf: '2026-09-30' }).groups).toEqual([]);
  const page = await request(app()).get('/option-relationships?as_of=2026-10-01&limit=1');
  expect(page.body.total).toBe(1); expect(page.body.next_offset).toBeNull();
  const first = await request(app()).get('/option-relationships?limit=1');
  expect(first.body.total).toBe(2); expect(first.body.next_offset).toBe(1);
  const second = await request(app()).get('/option-relationships?limit=1&offset=1');
  expect(second.body.groups[0].id).not.toBe(first.body.groups[0].id);
});
it('shows empty and malformed archive coverage without inventing zero trading', () => {
  expect(optionRelationshipsForState(state).gaps[0].reason).toContain('No usable');
  archive(owner); const channel = Object.values(readBrokerAccountModel(state).connections)[0].channel;
  writeFileSync(join(root, 'drive', owner, 'broker-sync', channel, 'bad.xml'), '<not-valid');
  const result = optionRelationshipsForState(state); expect(result.groups).toHaveLength(1); expect(result.gaps.some(g => g.source?.endsWith('bad.xml'))).toBe(true);
});

it('flags archived fills missing from normalized history without changing the user state', () => {
  archive(owner);
  const before = JSON.stringify(state);
  const result = optionRelationshipsForState(state);
  expect(result.historyGaps[0].reason).toContain('2 archived option fills');
  expect(JSON.stringify(state)).toBe(before);
  expect(optionRelationshipsForState(state, { asOf: '2026-09-30' }).historyGaps).toEqual([]);
});

it('invalidates cached relationships when an archived trade changes', () => {
  archive(owner);
  const first = optionRelationshipsForState(state);
  expect(first.groups[0].relationships[0].cash).toBe('20');
  first.groups[0].relationships[0].cash = '999';
  expect(optionRelationshipsForState(state).groups[0].relationships[0].cash).toBe('20');
  archive(owner, '20261001', '50');
  expect(optionRelationshipsForState(state).groups[0].relationships[0].cash).toBe('40');
});

it('compares exact gross cash despite different decimal scales and withholds conflicting roll evidence', () => {
  archive(owner);
  const channel = Object.values(readBrokerAccountModel(state).connections)[0].channel;
  const path = join(root, 'drive', owner, 'broker-sync', channel, '20261001.xml');
  const xml = readFileSync(path, 'utf8').replace('netCash="-10"', 'netCash="-10" proceeds="-10.00"')
    .replace('netCash="30"', 'netCash="30" proceeds="30.00"');
  writeFileSync(path, xml);
  const fills = parseRelationshipArchive('ibkr', Buffer.from(xml), 'A', { id: 'archive', version: '1' });
  state.option_executions = fills.map(f => ({ channel, account_id: 'A', execution_id: f.id, contract_id: f.id,
    executed_at: f.at, underlying: f.contract.underlying, right: f.contract.right, expiry: f.contract.expiry,
    strike: f.contract.strike, multiplier: f.contract.multiplier, contracts: f.quantity,
    side: f.side, effect: f.effect as 'open' | 'close', currency: f.contract.currency,
    gross_premium: f.gross_cash!.replace(/\.00$/, ''), commission: null }));
  expect(optionRelationshipsForState(state).historyGaps).toEqual([]);
  state.option_executions[0].gross_premium = '-11';
  const conflicted = optionRelationshipsForState(state);
  expect(conflicted.historyGaps.some(g => g.reason.includes('1 imported option fills disagree'))).toBe(true);
  expect(conflicted.groups).toEqual([]);
});
it('withholds earlier relationships when a newer archive contains corrections needing reconciliation', () => {
  archive(owner); const channel = Object.values(readBrokerAccountModel(state).connections)[0].channel;
  const dir = join(root, 'drive', owner, 'broker-sync', channel);
  const original = readFileSync(join(dir, '20261001.xml'), 'utf8');
  writeFileSync(join(dir, 'correction.xml'), original.replace('tradeID="c20261001"', 'origTradeID="older" tradeID="c20261001"'));
  const result = optionRelationshipsForState(state);
  expect(result.groups).toEqual([]);
  expect(result.gaps.some(g => g.reason.includes('withheld'))).toBe(true);
});

it('filters timeline fills to every account of the selected broker without leaking other channels', async () => {
  const first = Object.values(readBrokerAccountModel(state).connections)[0];
  const secondId = addBrokerAccount(state, { source_id: first.source_id, account_id: 'B', label: 'Savings', config: { activity_query_id: '1' } });
  const second = readBrokerAccountModel(state).connections[secondId];
  const fill = { contract_id: 'AMD-put', underlying: 'AMD', right: 'put' as const, expiry: '2027-01-15', strike: '100',
    multiplier: '100', contracts: '1', currency: 'USD', commission: '-1', gross_premium: '100', side: 'sell' as const,
    effect: 'open' as const, executed_at: '2026-10-01T10:00:00', execution_id: 'open' };
  state.option_executions = [{ ...fill, channel: first.channel, account_id: 'A' },
    { ...fill, channel: second.channel, account_id: 'B' }, { ...fill, channel: 'outside', account_id: 'T' }];
  await persistPortfolioFixture(state);
  const response = await request(app()).get('/option-history?channel=broker:ibkr&include_executions=true');
  expect(response.status).toBe(200);
  expect(response.body.executions.map((row: any) => row.account_id).sort()).toEqual(['A', 'B']);
  expect((await request(app()).get(`/option-history?channel=${first.channel}&include_executions=true`)).body.execution_total).toBe(1);
  expect((await request(app()).get('/option-history?channel=broker:unknown&include_executions=true')).body.execution_total).toBe(0);
  expect((await request(app()).get('/option-history?channel[]=ibkr')).status).toBe(400);
});

it('filters roll groups, coverage and gaps by selected broker across custom account channels', async () => {
  const first = Object.values(readBrokerAccountModel(state).connections)[0];
  const secondId = addBrokerAccount(state, { source_id: first.source_id, account_id: 'B', label: 'Savings', config: { activity_query_id: '1' } });
  const second = readBrokerAccountModel(state).connections[secondId];
  state.broker_sources!.outside = { broker_id: 'tiger', credentials: {} };
  state.broker_connections!.outside = { broker_id: 'tiger', source_id: 'outside', enabled: true, account_id: 'T',
    label: 'Other broker', channel: 'outside', config: { account: 'T' } };
  archive(owner);
  const file = join(root, 'drive', owner, 'broker-sync', first.channel, '20261001.xml');
  const directory = join(root, 'drive', owner, 'broker-sync', second.channel); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, '20261001.xml'), readFileSync(file, 'utf8').replaceAll('accountId="A"', 'accountId="B"'));
  await persistPortfolioFixture(state);
  const response = await request(app()).get('/option-relationships?channel=broker:ibkr');
  expect(response.status).toBe(200);
  expect(response.body.groups.map((row: any) => row.account_id).sort()).toEqual(['A', 'B']);
  expect(response.body.coverage.map((row: any) => row.account_id).sort()).toEqual(['A', 'B']);
  expect(response.body.gaps.every((row: any) => row.channel !== 'outside')).toBe(true);
  const unknown = await request(app()).get('/option-relationships?channel=broker:unknown');
  expect(unknown.body.groups).toEqual([]);
  expect(unknown.body.coverage).toEqual([]);
});
